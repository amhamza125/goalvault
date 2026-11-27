"""Offline negative suite for GoalVault v2 (stubbed GenVM).

Run: python3 tests_offline.py

v2 adds the steward-response coverage (PAPITO, 2026-11-27): the jury
receives the goal's stored creation time and deadline and must require
completion inside that interval — gv32 proves prior work, late completion
and proof without timing can never receive ACHIEVED (new reason code
TIMING_NOT_ESTABLISHED), and gv33 proves the stake-weighted bonus for two
achievers with different stakes to the wei (README corrected from the old
"equal share" wording to the contract's real behaviour).

Covers every negative test in SPEC v2 (frozen 2026-11-23) plus the positive
controls, with fund conservation asserted to the wei after every settlement
branch (achieved split, not-achieved, fail-by-omission, stuck-PROOF_IN
force-fail, exact dust roll, final_A == 0 roll): non-staker submit; proof
after grace; create outside the entry window; deadline < min_lead; deadline
in the next epoch; double credit (exact error, zero movement); roll_dust
before credited_count == achieved_count; double roll_dust; inconsistent
verdict/code pairing rejected with no state change; withdraw with zero
balance; mark_failed too early (both variants); hash mismatch never
ACHIEVED (jury never called); tautological criteria verdict; token-absent
proof -> NOT_ACHIEVED / PROOF_UNRELATED; undetermined outcomes change
nothing; unsolicited funds are never counted or distributed.
"""
import sys, json, calendar
sys.path.insert(0, "/home/hatch/workspace/week-nov23/builds/goalvault")
import harness
from harness import (fresh, call, expect_err, conserve, UserError,
                     S1, S2, S3, S4, OUT, A)

T0 = calendar.timegm((2026, 11, 23, 0, 0, 0))
PASS = []
FAIL = []

def check(name, fn):
    try:
        fn()
        PASS.append(name)
        print("PASS", name)
    except Exception as e:
        FAIL.append((name, repr(e)))
        print("FAIL", name, "->", repr(e))

def stub(verdict, reason):
    def fn(prompt, images):
        return {"verdict": verdict, "reason_code": reason}
    return fn

def jury_by_token(mapping):
    """mapping: token substring -> (verdict, reason)."""
    def fn(prompt, images):
        for tok, vr in mapping.items():
            if tok in prompt:
                return {"verdict": vr[0], "reason_code": vr[1]}
        raise AssertionError("no token matched the prompt")
    return fn

def goal(c, gid):
    return json.loads(c.get_goal(gid))

def stats(c, e):
    return json.loads(c.get_epoch_stats(e))

def mk(c, sender, stake, deadline, title="Run 10k", criteria="A public page shows the run completed"):
    return int(call(c, sender, c.create_goal, title, criteria, deadline, value=stake))

def prove(c, sender, gid, url, page):
    harness.WEB[url] = page
    return call(c, sender, c.submit_proof, gid, url)

def page_for(token, extra=b""):
    return (b"<html><body><h1>Proof</h1><p>Goal token: " + token.encode()
            + b"</p><p>The work is done.</p>" + extra + b"</body></html>")

U1 = "https://proof.example.com/g1"
U2 = "https://proof.example.com/g2"
U3 = "https://proof.example.com/g3"
U4 = "https://proof.example.com/g4"

# ---------------------------------------------------------------- tests

def gv01_happy_path_exact_split():
    harness.set_time(T0)
    c = fresh()
    g1 = mk(c, S1, 10000, T0 + 300)
    g2 = mk(c, S2, 30000, T0 + 300)
    assert (g1, g2) == (1, 2)
    assert goal(c, g1)["token"] == "GV-1-" + S1[:8]
    conserve(c)
    prove(c, S1, g1, U1, page_for(goal(c, g1)["token"]))
    prove(c, S2, g2, U2, page_for(goal(c, g2)["token"]))
    conserve(c)
    harness.PROMPT_FN = jury_by_token({
        "GV-1-": ("ACHIEVED", "CRITERIA_MET"),
        "GV-2-": ("NOT_ACHIEVED", "CRITERIA_NOT_MET")})
    call(c, OUT, c.assess, g1)   # anyone may assess
    call(c, OUT, c.assess, g2)
    assert goal(c, g1)["status"] == "ACHIEVED"
    assert goal(c, g2)["status"] == "NOT_ACHIEVED"
    assert goal(c, g2)["reason_code"] == "CRITERIA_NOT_MET"
    st = stats(c, 0)
    assert st["failed_pool"] == "30000" and st["achieved_stake"] == "10000"
    conserve(c)
    harness.set_time(T0 + 781)
    out = call(c, OUT, c.credit, g1)   # anyone may credit
    assert goal(c, g1)["status"] == "CREDITED"
    assert goal(c, g1)["payout"] == "40000"          # 10000 + 30000*10000/10000
    assert c.get_balance(S1) == "40000"
    conserve(c)
    call(c, S1, c.withdraw)
    assert harness.TRANSFERS == [(S1, 40000)]
    assert c.get_balance(S1) == "0"
    assert int(c.balance) == 0
    conserve(c)

def gv02_non_staker_submit():
    harness.set_time(T0)
    c = fresh()
    g1 = mk(c, S1, 10000, T0 + 300)
    harness.WEB[U1] = page_for(goal(c, g1)["token"])
    expect_err(c, OUT, c.submit_proof, g1, U1, code="NOT_STAKER")
    expect_err(c, S2, c.submit_proof, g1, U1, code="NOT_STAKER")
    assert goal(c, g1)["status"] == "ACTIVE"
    call(c, S1, c.submit_proof, g1, U1)
    assert goal(c, g1)["status"] == "PROOF_IN"
    conserve(c)

def gv03_proof_after_grace():
    harness.set_time(T0)
    c = fresh()
    g1 = mk(c, S1, 10000, T0 + 300)
    g2 = mk(c, S2, 10000, T0 + 300)
    harness.set_time(T0 + 360)   # exactly deadline + grace: still allowed
    prove(c, S1, g1, U1, page_for(goal(c, g1)["token"]))
    harness.set_time(T0 + 361)
    harness.WEB[U2] = page_for(goal(c, g2)["token"])
    expect_err(c, S2, c.submit_proof, g2, U2, code="PROOF_TOO_LATE")
    assert goal(c, g2)["status"] == "ACTIVE"
    conserve(c)

def gv04_create_outside_entry_window():
    harness.set_time(T0 + 299)   # last second of the entry window
    c = fresh()
    # genesis lands on the harness clock at construction; rebuild at T0:
    harness.set_time(T0)
    c = fresh()
    harness.set_time(T0 + 299)
    mk(c, S1, 10000, T0 + 500)
    harness.set_time(T0 + 300)   # second half of the epoch
    expect_err(c, S2, c.create_goal, "Late", "Too late", T0 + 500,
               code="ENTRY_CLOSED", value=10000)
    conserve(c)

def gv05_create_deadline_too_soon():
    harness.set_time(T0)
    c = fresh()
    expect_err(c, S1, c.create_goal, "Soon", "Criteria", T0 + 119,
               code="DEADLINE_TOO_SOON", value=10000)
    mk(c, S1, 10000, T0 + 120)   # exactly min_lead: allowed
    conserve(c)

def gv06_create_deadline_next_epoch():
    harness.set_time(T0)
    c = fresh()
    expect_err(c, S1, c.create_goal, "Far", "Criteria", T0 + 601,
               code="DEADLINE_PAST_EPOCH", value=10000)
    mk(c, S1, 10000, T0 + 600)   # exactly epoch end: allowed
    conserve(c)

def gv07_create_input_gates():
    harness.set_time(T0)
    c = fresh()
    expect_err(c, S1, c.create_goal, "Ok", "Criteria", T0 + 300,
               code="STAKE_TOO_SMALL", value=999)
    expect_err(c, S1, c.create_goal, "", "Criteria", T0 + 300,
               code="BAD_TITLE", value=10000)
    expect_err(c, S1, c.create_goal, "x" * 121, "Criteria", T0 + 300,
               code="BAD_TITLE", value=10000)
    expect_err(c, S1, c.create_goal, "Ok", "", T0 + 300,
               code="BAD_CRITERIA", value=10000)
    expect_err(c, S1, c.create_goal, "Ok", "x" * 501, T0 + 300,
               code="BAD_CRITERIA", value=10000)
    assert json.loads(c.get_config())["next_goal_id"] == "1"
    conserve(c)

def gv08_double_credit_and_bad_states():
    harness.set_time(T0)
    c = fresh()
    g1 = mk(c, S1, 10000, T0 + 300)
    g2 = mk(c, S2, 10000, T0 + 300)
    prove(c, S1, g1, U1, page_for(goal(c, g1)["token"]))
    prove(c, S2, g2, U2, page_for(goal(c, g2)["token"]))
    harness.PROMPT_FN = jury_by_token({
        "GV-1-": ("ACHIEVED", "CRITERIA_MET"),
        "GV-2-": ("NOT_ACHIEVED", "CRITERIA_NOT_MET")})
    call(c, OUT, c.assess, g1)
    call(c, OUT, c.assess, g2)
    expect_err(c, OUT, c.credit, g2, code="BAD_STATE")       # NOT_ACHIEVED
    harness.set_time(T0 + 781)
    call(c, OUT, c.credit, g1)
    bal = int(c.balance)
    expect_err(c, OUT, c.credit, g1, code="ALREADY_CREDITED")  # zero movement
    assert int(c.balance) == bal
    assert c.get_balance(S1) == "20000"
    conserve(c)

def gv09_credit_before_finalization():
    harness.set_time(T0)
    c = fresh()
    g1 = mk(c, S1, 10000, T0 + 300)
    prove(c, S1, g1, U1, page_for(goal(c, g1)["token"]))
    harness.PROMPT_FN = stub("ACHIEVED", "CRITERIA_MET")
    call(c, OUT, c.assess, g1)
    harness.set_time(T0 + 780)   # exactly finalization: not yet (gate is >)
    expect_err(c, OUT, c.credit, g1, code="NOT_FINALIZED")
    harness.set_time(T0 + 781)
    call(c, OUT, c.credit, g1)
    assert c.get_balance(S1) == "10000"   # no failures: stake back, no bonus
    conserve(c)

def gv10_withdraw_zero_balance():
    harness.set_time(T0)
    c = fresh()
    expect_err(c, OUT, c.withdraw, code="NOTHING_TO_WITHDRAW")
    expect_err(c, S1, c.withdraw, code="NOTHING_TO_WITHDRAW")
    conserve(c)

def gv11_roll_dust_before_all_credited():
    harness.set_time(T0)
    c = fresh()
    g1 = mk(c, S1, 10000, T0 + 300)
    g2 = mk(c, S2, 10000, T0 + 300)
    g3 = mk(c, S3, 10000, T0 + 300)
    prove(c, S1, g1, U1, page_for(goal(c, g1)["token"]))
    prove(c, S2, g2, U2, page_for(goal(c, g2)["token"]))
    prove(c, S3, g3, U3, page_for(goal(c, g3)["token"]))
    harness.PROMPT_FN = jury_by_token({
        "GV-1-": ("ACHIEVED", "CRITERIA_MET"),
        "GV-2-": ("ACHIEVED", "CRITERIA_MET"),
        "GV-3-": ("NOT_ACHIEVED", "CRITERIA_NOT_MET")})
    for g in (g1, g2, g3):
        call(c, OUT, c.assess, g)
    harness.set_time(T0 + 781)
    expect_err(c, OUT, c.roll_dust, 0, code="DUST_NOT_READY")
    call(c, OUT, c.credit, g1)
    expect_err(c, OUT, c.roll_dust, 0, code="DUST_NOT_READY")
    call(c, OUT, c.credit, g2)
    call(c, OUT, c.roll_dust, 0)   # exact split (5000 each): dust is 0, still rolls once
    st = stats(c, 0)
    assert st["credited_bonus_total"] == "10000" and st["dust_rolled"] == "1"
    conserve(c)

def gv12_double_roll_dust():
    harness.set_time(T0)
    c = fresh()
    g1 = mk(c, S1, 10000, T0 + 300)
    harness.set_time(T0 + 361)
    call(c, OUT, c.mark_failed, g1)
    harness.set_time(T0 + 800)
    call(c, OUT, c.roll_dust, 0)
    expect_err(c, OUT, c.roll_dust, 0, code="DUST_ALREADY_ROLLED")
    conserve(c)

def gv13_inconsistent_pairing_rejected():
    harness.set_time(T0)
    c = fresh()
    g1 = mk(c, S1, 10000, T0 + 300)
    prove(c, S1, g1, U1, page_for(goal(c, g1)["token"]))
    harness.PROMPT_FN = stub("ACHIEVED", "PROOF_UNRELATED")   # impossible pair
    expect_err(c, OUT, c.assess, g1, code="JURY_MALFORMED")
    assert goal(c, g1)["status"] == "PROOF_IN"
    assert goal(c, g1)["failures"] == "0"
    harness.PROMPT_FN = stub("NOT_ACHIEVED", "CRITERIA_MET")  # impossible pair
    expect_err(c, OUT, c.assess, g1, code="JURY_MALFORMED")
    harness.PROMPT_FN = lambda p, i: "not json at all"
    expect_err(c, OUT, c.assess, g1, code="JURY_MALFORMED")
    assert goal(c, g1)["status"] == "PROOF_IN"
    harness.PROMPT_FN = stub("ACHIEVED", "CRITERIA_MET")
    call(c, OUT, c.assess, g1)
    assert goal(c, g1)["status"] == "ACHIEVED"
    conserve(c)

def gv14_mark_failed_too_early():
    harness.set_time(T0)
    c = fresh()
    g1 = mk(c, S1, 10000, T0 + 300)
    g2 = mk(c, S2, 10000, T0 + 300)
    prove(c, S2, g2, U2, page_for(goal(c, g2)["token"]))
    harness.set_time(T0 + 360)   # exactly deadline + grace: too early (gate is >)
    expect_err(c, OUT, c.mark_failed, g1, code="TOO_EARLY")
    harness.set_time(T0 + 780)   # exactly finalization: too early for PROOF_IN
    expect_err(c, OUT, c.mark_failed, g2, code="TOO_EARLY")
    assert goal(c, g1)["status"] == "ACTIVE"
    assert goal(c, g2)["status"] == "PROOF_IN"
    conserve(c)

def gv15_hash_mismatch_never_achieved():
    harness.set_time(T0)
    c = fresh()
    g1 = mk(c, S1, 10000, T0 + 300)
    tok = goal(c, g1)["token"]
    prove(c, S1, g1, U1, page_for(tok))
    harness.WEB[U1] = page_for(tok, b" EDITED")   # content swapped after binding
    harness.PROMPT_FN = stub("ACHIEVED", "CRITERIA_MET")
    out = call(c, OUT, c.assess, g1)
    assert out.startswith("PROOF_IN")
    assert goal(c, g1)["status"] == "PROOF_IN"
    assert goal(c, g1)["failures"] == "1"
    assert harness.PROMPT_CALLS["n"] == 0          # jury never called
    call(c, OUT, c.assess, g1)
    assert goal(c, g1)["failures"] == "2"
    harness.WEB[U1] = page_for(tok)                # original content restored
    call(c, OUT, c.assess, g1)
    assert goal(c, g1)["status"] == "ACHIEVED"
    assert goal(c, g1)["failures"] == "2"          # diagnostic counter kept
    conserve(c)

def gv16_fetch_failure_at_assess():
    harness.set_time(T0)
    c = fresh()
    g1 = mk(c, S1, 10000, T0 + 300)
    prove(c, S1, g1, U1, page_for(goal(c, g1)["token"]))
    del harness.WEB[U1]                            # host unreachable
    harness.PROMPT_FN = stub("ACHIEVED", "CRITERIA_MET")
    out = call(c, OUT, c.assess, g1)
    assert out.startswith("PROOF_IN")
    assert goal(c, g1)["failures"] == "1"
    assert harness.PROMPT_CALLS["n"] == 0
    harness.WEB[U1] = (500, b"server error")       # non-200 also fails closed
    call(c, OUT, c.assess, g1)
    assert goal(c, g1)["failures"] == "2"
    harness.WEB[U1] = page_for(goal(c, g1)["token"])
    harness.PROMPT_FN = stub("NOT_ACHIEVED", "CRITERIA_NOT_MET")
    call(c, OUT, c.assess, g1)
    assert goal(c, g1)["status"] == "NOT_ACHIEVED"
    conserve(c)

def gv17_submit_fetch_failure():
    harness.set_time(T0)
    c = fresh()
    g1 = mk(c, S1, 10000, T0 + 300)
    expect_err(c, S1, c.submit_proof, g1, U1, code="FETCH_FAILED")
    d = goal(c, g1)
    assert d["status"] == "ACTIVE" and d["proof_url"] == "" and d["proof_hash"] == ""
    expect_err(c, S1, c.submit_proof, g1, "http://proof.example.com/x", code="BAD_URL")
    prove(c, S1, g1, U1, page_for(d["token"]))
    assert goal(c, g1)["status"] == "PROOF_IN"
    conserve(c)

def gv18_tautological_verdict():
    harness.set_time(T0)
    c = fresh()
    g1 = mk(c, S1, 10000, T0 + 300, title="Breathe", criteria="I will exist")
    prove(c, S1, g1, U1, page_for(goal(c, g1)["token"]))
    harness.PROMPT_FN = stub("NOT_ACHIEVED", "TAUTOLOGICAL")
    call(c, OUT, c.assess, g1)
    d = goal(c, g1)
    assert d["status"] == "NOT_ACHIEVED" and d["reason_code"] == "TAUTOLOGICAL"
    assert "tautological" in d["reason_text"]
    assert stats(c, 0)["failed_pool"] == "10000"   # can never draw a bonus
    conserve(c)

def gv19_token_absent_proof_unrelated():
    harness.set_time(T0)
    c = fresh()
    g1 = mk(c, S1, 10000, T0 + 300)
    prove(c, S1, g1, U1, b"<html><body>Someone else's page entirely.</body></html>")
    seen = {}
    def jury(prompt, images):
        seen["prompt"] = prompt
        assert goal(c, g1)["token"] in prompt       # jury receives the token
        return {"verdict": "NOT_ACHIEVED", "reason_code": "PROOF_UNRELATED"}
    harness.PROMPT_FN = jury
    call(c, OUT, c.assess, g1)
    d = goal(c, g1)
    assert d["status"] == "NOT_ACHIEVED" and d["reason_code"] == "PROOF_UNRELATED"
    assert "BEGIN_DATA" in seen["prompt"]           # evidence delimited as data
    conserve(c)

def gv20_final_a_zero_roll():
    harness.set_time(T0)
    c = fresh()
    g1 = mk(c, S1, 10000, T0 + 300)
    g2 = mk(c, S2, 30000, T0 + 300)
    prove(c, S1, g1, U1, page_for(goal(c, g1)["token"]))
    harness.PROMPT_FN = stub("NOT_ACHIEVED", "CRITERIA_NOT_MET")
    call(c, OUT, c.assess, g1)
    harness.set_time(T0 + 361)
    call(c, OUT, c.mark_failed, g2)                # fail by omission
    assert stats(c, 0)["frozen_failed_total"] == "40000"
    conserve(c)
    harness.set_time(T0 + 800)                     # epoch 1, inside its entry window
    out = call(c, OUT, c.roll_dust, 0)
    assert "40000" in out
    st1 = stats(c, 1)
    assert st1["rolled_in"] == "40000" and st1["failed_pool"] == "40000"
    assert stats(c, 0)["dust_available"] == "0"
    conserve(c)
    # The rolled pool is real money for epoch 1's accounting:
    g3 = mk(c, S3, 5000, T0 + 1000)
    prove(c, S3, g3, U3, page_for(goal(c, g3)["token"]))
    harness.PROMPT_FN = stub("NOT_ACHIEVED", "CRITERIA_NOT_MET")
    call(c, OUT, c.assess, g3)
    assert stats(c, 1)["failed_pool"] == "45000"
    assert int(c.balance) == 45000
    conserve(c)

def gv21_dust_roll_exact():
    harness.set_time(T0)
    c = fresh(min_stake=1)
    g1 = mk(c, S1, 3, T0 + 300)
    g2 = mk(c, S2, 3, T0 + 300)
    g3 = mk(c, S3, 3, T0 + 300)
    g4 = mk(c, S4, 100, T0 + 300)
    prove(c, S1, g1, U1, page_for(goal(c, g1)["token"]))
    prove(c, S2, g2, U2, page_for(goal(c, g2)["token"]))
    prove(c, S3, g3, U3, page_for(goal(c, g3)["token"]))
    prove(c, S4, g4, U4, page_for(goal(c, g4)["token"]))
    harness.PROMPT_FN = jury_by_token({
        "GV-1-": ("ACHIEVED", "CRITERIA_MET"),
        "GV-2-": ("ACHIEVED", "CRITERIA_MET"),
        "GV-3-": ("ACHIEVED", "CRITERIA_MET"),
        "GV-4-": ("NOT_ACHIEVED", "CRITERIA_NOT_MET")})
    for g in (g1, g2, g3, g4):
        call(c, OUT, c.assess, g)
    harness.set_time(T0 + 781)
    for g in (g1, g2, g3):
        call(c, OUT, c.credit, g)
        assert goal(c, g)["payout"] == "36"        # 3 + 100*3//9 = 3 + 33
    st = stats(c, 0)
    assert st["credited_bonus_total"] == "99"
    assert st["dust_available"] == "1"             # the exact rounding wei
    conserve(c)
    harness.set_time(T0 + 800)
    out = call(c, OUT, c.roll_dust, 0)
    assert out.startswith("ROLLED: 1 wei")
    assert stats(c, 1)["rolled_in"] == "1"
    assert stats(c, 0)["dust_available"] == "0"
    for s in (S1, S2, S3):
        call(c, s, c.withdraw)
    assert int(c.balance) == 1                     # only the rolled wei remains, now epoch 1's
    assert sorted(harness.TRANSFERS) == sorted([(S1, 36), (S2, 36), (S3, 36)])
    conserve(c)

def gv22_stuck_proof_in_force_fail():
    harness.set_time(T0)
    c = fresh()
    g1 = mk(c, S1, 10000, T0 + 300)
    prove(c, S1, g1, U1, page_for(goal(c, g1)["token"]))
    harness.set_time(T0 + 781)                     # never assessed; window closed
    call(c, OUT, c.mark_failed, g1)
    assert goal(c, g1)["status"] == "FAILED"
    assert stats(c, 0)["failed_pool"] == "10000"
    expect_err(c, OUT, c.assess, g1, code="BAD_STATE")
    conserve(c)

def gv23_fail_by_omission():
    harness.set_time(T0)
    c = fresh()
    g1 = mk(c, S1, 10000, T0 + 300)
    harness.set_time(T0 + 361)
    call(c, OUT, c.mark_failed, g1)                # anyone may trigger it
    assert goal(c, g1)["status"] == "FAILED"
    assert stats(c, 0)["failed_pool"] == "10000"
    conserve(c)

def gv24_assess_after_finalization():
    harness.set_time(T0)
    c = fresh()
    g1 = mk(c, S1, 10000, T0 + 300)
    prove(c, S1, g1, U1, page_for(goal(c, g1)["token"]))
    harness.set_time(T0 + 781)
    expect_err(c, OUT, c.assess, g1, code="ASSESS_CLOSED")
    assert goal(c, g1)["status"] == "PROOF_IN"
    conserve(c)

def gv25_unsolicited_surplus_never_counted():
    harness.set_time(T0)
    c = fresh(balance=777)                         # stray funds in the contract
    g1 = mk(c, S1, 10000, T0 + 300)
    g2 = mk(c, S2, 10000, T0 + 300)
    prove(c, S1, g1, U1, page_for(goal(c, g1)["token"]))
    prove(c, S2, g2, U2, page_for(goal(c, g2)["token"]))
    harness.PROMPT_FN = jury_by_token({
        "GV-1-": ("ACHIEVED", "CRITERIA_MET"),
        "GV-2-": ("NOT_ACHIEVED", "CRITERIA_NOT_MET")})
    call(c, OUT, c.assess, g1)
    call(c, OUT, c.assess, g2)
    conserve(c, excess=777)
    harness.set_time(T0 + 781)
    call(c, OUT, c.credit, g1)
    assert c.get_balance(S1) == "20000"            # surplus not distributed
    call(c, S1, c.withdraw)
    harness.set_time(T0 + 800)
    call(c, OUT, c.roll_dust, 0)
    assert int(c.balance) == 777                   # surplus untouched throughout
    conserve(c, excess=777)

def gv26_reverted_payable_stray():
    harness.set_time(T0)
    c = fresh()
    try:
        call(c, S1, c.create_goal, "", "Criteria", T0 + 300, value=5000)
        raise AssertionError("create should have reverted")
    except UserError as e:
        assert str(e) == "BAD_TITLE"
    assert int(c.balance) == 5000                  # the sent value stays (runner stray)
    assert json.loads(c.get_config())["next_goal_id"] == "1"
    conserve(c, excess=5000)

def gv27_bad_config():
    harness.set_time(T0)
    for bad in ({"epoch_duration": 0}, {"min_stake": 0}, {"grace": -1}):
        try:
            fresh(**bad)
            raise AssertionError(f"config {bad} should have reverted")
        except UserError as e:
            assert str(e) == "BAD_CONFIG"

def gv28_views_and_config():
    harness.set_time(T0)
    c = fresh()
    cfg = json.loads(c.get_config())
    assert cfg["epoch_duration"] == "600" and cfg["min_stake"] == "1000"
    assert cfg["genesis_ts"] == str(T0)
    st = stats(c, 0)
    assert st["epoch_start"] == str(T0) and st["epoch_end"] == str(T0 + 600)
    assert st["finalization_ts"] == str(T0 + 780)
    g1 = mk(c, S1, 10000, T0 + 300)
    g2 = mk(c, S2, 10000, T0 + 300)
    g3 = mk(c, S3, 10000, T0 + 300)
    page1 = json.loads(c.list_goals(0, 0, 2))
    page2 = json.loads(c.list_goals(0, 2, 2))
    assert [d["id"] for d in page1] == ["1", "2"]
    assert [d["id"] for d in page2] == ["3"]
    assert c.get_balance(OUT) == "0"
    expect_err(c, OUT, c.get_goal, 99, code="GOAL_NOT_FOUND")
    # production parameters land as documented
    cp = fresh(**harness.PROD)
    cfgp = json.loads(cp.get_config())
    assert cfgp["epoch_duration"] == "2592000" and cfgp["grace"] == "86400"
    assert cfgp["assess_window"] == "604800" and cfgp["min_lead"] == "259200"
    assert cfgp["min_stake"] == "1000000000000000"
    conserve(c)

def gv29_undetermined_outcome_changes_nothing():
    harness.set_time(T0)
    c = fresh()
    g1 = mk(c, S1, 10000, T0 + 300)
    def boom(fn):
        raise Exception("NO_CONSENSUS")
    harness.EQ_FN = boom
    try:
        call(c, S1, c.submit_proof, g1, U1)
        raise AssertionError("submit should have propagated")
    except Exception as e:
        assert "NO_CONSENSUS" in str(e)
    assert goal(c, g1)["status"] == "ACTIVE"
    harness.EQ_FN = None
    prove(c, S1, g1, U1, page_for(goal(c, g1)["token"]))
    harness.EQ_FN = boom
    harness.PROMPT_FN = stub("ACHIEVED", "CRITERIA_MET")
    try:
        call(c, OUT, c.assess, g1)
        raise AssertionError("assess should have propagated")
    except Exception as e:
        assert "NO_CONSENSUS" in str(e)
    d = goal(c, g1)
    assert d["status"] == "PROOF_IN" and d["failures"] == "0"
    harness.EQ_FN = None
    call(c, OUT, c.assess, g1)
    assert goal(c, g1)["status"] == "ACHIEVED"
    conserve(c)

def gv30_bad_state_paths():
    harness.set_time(T0)
    c = fresh()
    g1 = mk(c, S1, 10000, T0 + 300)
    expect_err(c, OUT, c.assess, g1, code="BAD_STATE")          # ACTIVE
    expect_err(c, OUT, c.credit, g1, code="BAD_STATE")          # ACTIVE
    prove(c, S1, g1, U1, page_for(goal(c, g1)["token"]))
    expect_err(c, S1, c.submit_proof, g1, U1, code="BAD_STATE") # already PROOF_IN
    expect_err(c, OUT, c.credit, g1, code="BAD_STATE")          # PROOF_IN
    harness.set_time(T0 + 781)
    call(c, OUT, c.mark_failed, g1)
    expect_err(c, OUT, c.mark_failed, g1, code="BAD_STATE")     # already FAILED
    expect_err(c, OUT, c.roll_dust, 5, code="NOT_FINALIZED")   # future epoch
    conserve(c)

def gv31_value_on_nonpayable_rejected():
    harness.set_time(T0)
    c = fresh()
    g1 = mk(c, S1, 10000, T0 + 300)
    expect_err(c, OUT, c.mark_failed, g1, code="BAD_AMOUNT", value=1000)
    expect_err(c, OUT, c.withdraw, code="BAD_AMOUNT", value=1000)
    expect_err(c, OUT, c.roll_dust, 0, code="BAD_AMOUNT", value=1000)
    conserve(c)

def gv32_timing_negatives():
    # v2 (steward response): the jury receives the goal's stored creation
    # time and deadline and must require completion inside that interval.
    # timing_jury mirrors the prompt's timing rule: it reads created_at /
    # deadline out of the prompt and the completion date out of the proof
    # page, and returns TIMING_NOT_ESTABLISHED for prior work, late
    # completion, or a page with no date at all.
    import re
    def timing_jury(prompt, images):
        m1 = re.search(r"created_at: (\d{4}-\d{2}-\d{2})T\d{2}:\d{2}:\d{2} \(unix \d+\)", prompt)
        m2 = re.search(r"deadline: (\d{4}-\d{2}-\d{2})T\d{2}:\d{2}:\d{2} \(unix \d+\)", prompt)
        assert m1 and m2, "prompt must carry created_at and deadline"
        created, deadline = m1.group(1), m2.group(1)
        body = prompt.split("BEGIN_DATA", 1)[1].split("END_DATA", 1)[0]
        dates = re.findall(r"\d{4}-\d{2}-\d{2}", body)
        if not dates:
            return {"verdict": "NOT_ACHIEVED", "reason_code": "TIMING_NOT_ESTABLISHED"}
        done = dates[0]
        if done < created or done > deadline:
            return {"verdict": "NOT_ACHIEVED", "reason_code": "TIMING_NOT_ESTABLISHED"}
        return {"verdict": "ACHIEVED", "reason_code": "CRITERIA_MET"}
    def run_case(completion_line, expect_achieved):
        harness.set_time(T0)
        c = fresh()
        g1 = mk(c, S1, 10000, T0 + 300)
        d = goal(c, g1)
        assert d["created_at"] == str(T0) and d["deadline"] == str(T0 + 300)
        page = (b"<html><body><p>Goal token: " + d["token"].encode() + b"</p><p>"
                + completion_line.encode() + b"</p></body></html>")
        prove(c, S1, g1, U1, page)
        seen = {}
        def jury(prompt, images):
            seen["prompt"] = prompt
            return timing_jury(prompt, images)
        harness.PROMPT_FN = jury
        call(c, OUT, c.assess, g1)
        assert "created_at: 2026-11-23T00:00:00 (unix %d)" % T0 in seen["prompt"]
        assert "deadline: 2026-11-23T00:05:00 (unix %d)" % (T0 + 300) in seen["prompt"]
        assert "TIMING_NOT_ESTABLISHED" in seen["prompt"]
        got = goal(c, g1)
        if expect_achieved:
            assert got["status"] == "ACHIEVED" and got["reason_code"] == "CRITERIA_MET"
            assert "timing" not in got["reason_text"].lower()
        else:
            assert got["status"] == "NOT_ACHIEVED", got
            assert got["reason_code"] == "TIMING_NOT_ESTABLISHED", got
            assert "creation time" in got["reason_text"]
            assert stats(c, 0)["failed_pool"] == "10000"
        conserve(c)
    # (a) prior work: completed 2026-11-20, goal created 2026-11-23
    run_case("I completed a 5 kilometre run on 2026-11-20, finishing in 31 minutes.", False)
    # (b) late completion: completed 2026-11-24, deadline 2026-11-23T00:05
    run_case("I completed a 5 kilometre run on 2026-11-24, finishing in 31 minutes.", False)
    # (c) proof that does not establish timing: no date anywhere
    run_case("The work is done. I ran five kilometres and finished.", False)
    # (d) positive control: completed 2026-11-23, inside [created, deadline]
    run_case("I completed a 5 kilometre run on 2026-11-23, finishing in 31 minutes.", True)
    # (e) pairing guard: TIMING_NOT_ESTABLISHED can never pair with ACHIEVED
    harness.set_time(T0)
    c = fresh()
    g1 = mk(c, S1, 10000, T0 + 300)
    prove(c, S1, g1, U1, page_for(goal(c, g1)["token"]))
    harness.PROMPT_FN = stub("ACHIEVED", "TIMING_NOT_ESTABLISHED")
    expect_err(c, OUT, c.assess, g1, code="JURY_MALFORMED")
    assert goal(c, g1)["status"] == "PROOF_IN"
    conserve(c)

def gv33_two_achievers_stake_weighted():
    # Worked example from the README (v2: docs corrected to the contract's
    # real stake-weighted bonus): A stakes 10000, B stakes 30000, both
    # achieve; C stakes 30000 and fails, so final_F = 30000, final_A = 40000.
    # A: 10000 + 30000*10000//40000 = 17500. B: 30000 + 30000*30000//40000
    # = 52500. Equal sharing would have paid 25000 / 45000 — this test
    # distinguishes the two policies to the wei.
    harness.set_time(T0)
    c = fresh()
    g1 = mk(c, S1, 10000, T0 + 300)
    g2 = mk(c, S2, 30000, T0 + 300)
    g3 = mk(c, S3, 30000, T0 + 300)
    prove(c, S1, g1, U1, page_for(goal(c, g1)["token"]))
    prove(c, S2, g2, U2, page_for(goal(c, g2)["token"]))
    prove(c, S3, g3, U3, page_for(goal(c, g3)["token"]))
    harness.PROMPT_FN = jury_by_token({
        "GV-1-": ("ACHIEVED", "CRITERIA_MET"),
        "GV-2-": ("ACHIEVED", "CRITERIA_MET"),
        "GV-3-": ("NOT_ACHIEVED", "CRITERIA_NOT_MET")})
    for g in (g1, g2, g3):
        call(c, OUT, c.assess, g)
    st = stats(c, 0)
    assert st["failed_pool"] == "30000" and st["achieved_stake"] == "40000"
    harness.set_time(T0 + 781)
    call(c, OUT, c.credit, g1)
    assert goal(c, g1)["payout"] == "17500"      # NOT 25000 (equal share)
    call(c, OUT, c.credit, g2)
    assert goal(c, g2)["payout"] == "52500"      # NOT 45000 (equal share)
    st = stats(c, 0)
    assert st["credited_bonus_total"] == "30000" and st["dust_available"] == "0"
    assert c.get_balance(S1) == "17500" and c.get_balance(S2) == "52500"
    call(c, S1, c.withdraw)
    call(c, S2, c.withdraw)
    assert sorted(harness.TRANSFERS) == sorted([(S1, 17500), (S2, 52500)])
    assert int(c.balance) == 0
    conserve(c)

TESTS = [
    ("gv01_happy_path_exact_split", gv01_happy_path_exact_split),
    ("gv02_non_staker_submit", gv02_non_staker_submit),
    ("gv03_proof_after_grace", gv03_proof_after_grace),
    ("gv04_create_outside_entry_window", gv04_create_outside_entry_window),
    ("gv05_create_deadline_too_soon", gv05_create_deadline_too_soon),
    ("gv06_create_deadline_next_epoch", gv06_create_deadline_next_epoch),
    ("gv07_create_input_gates", gv07_create_input_gates),
    ("gv08_double_credit_and_bad_states", gv08_double_credit_and_bad_states),
    ("gv09_credit_before_finalization", gv09_credit_before_finalization),
    ("gv10_withdraw_zero_balance", gv10_withdraw_zero_balance),
    ("gv11_roll_dust_before_all_credited", gv11_roll_dust_before_all_credited),
    ("gv12_double_roll_dust", gv12_double_roll_dust),
    ("gv13_inconsistent_pairing_rejected", gv13_inconsistent_pairing_rejected),
    ("gv14_mark_failed_too_early", gv14_mark_failed_too_early),
    ("gv15_hash_mismatch_never_achieved", gv15_hash_mismatch_never_achieved),
    ("gv16_fetch_failure_at_assess", gv16_fetch_failure_at_assess),
    ("gv17_submit_fetch_failure", gv17_submit_fetch_failure),
    ("gv18_tautological_verdict", gv18_tautological_verdict),
    ("gv19_token_absent_proof_unrelated", gv19_token_absent_proof_unrelated),
    ("gv20_final_a_zero_roll", gv20_final_a_zero_roll),
    ("gv21_dust_roll_exact", gv21_dust_roll_exact),
    ("gv22_stuck_proof_in_force_fail", gv22_stuck_proof_in_force_fail),
    ("gv23_fail_by_omission", gv23_fail_by_omission),
    ("gv24_assess_after_finalization", gv24_assess_after_finalization),
    ("gv25_unsolicited_surplus_never_counted", gv25_unsolicited_surplus_never_counted),
    ("gv26_reverted_payable_stray", gv26_reverted_payable_stray),
    ("gv27_bad_config", gv27_bad_config),
    ("gv28_views_and_config", gv28_views_and_config),
    ("gv29_undetermined_outcome_changes_nothing", gv29_undetermined_outcome_changes_nothing),
    ("gv30_bad_state_paths", gv30_bad_state_paths),
    ("gv31_value_on_nonpayable_rejected", gv31_value_on_nonpayable_rejected),
    ("gv32_timing_negatives", gv32_timing_negatives),
    ("gv33_two_achievers_stake_weighted", gv33_two_achievers_stake_weighted),
]

for name, fn in TESTS:
    check(name, fn)

print()
print(f"{len(PASS)}/{len(TESTS)} passed")
if FAIL:
    print("FAILURES:")
    for name, err in FAIL:
        print(" ", name, "->", err)
    sys.exit(1)
