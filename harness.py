"""Offline harness: stub genlayer runtime, load GoalVault.py, drive it.

Mirrors ~/workspace/week-nov23/builds/certcheck/harness.py (which mirrors
FlightCover's), including the GenerationError-raising TreeMap stub: generic
storage classes may only be allocated by the harness's fresh() (playing the
GenVM's inmem_allocate role for the annotated fields) — a bare TreeMap()
inside the contract's __init__ dies here, offline, instead of at deploy.

The chain model in call() follows SkillBond's harness: the sent value lands
in the contract balance first and stays there even when the call reverts
(runner behaviour — the GenVM stray); transfers emitted during a call leave
the balance immediately (a "landed" emission).

WEB maps URL -> bytes (status 200) | (status, bytes); a missing key raises,
like an unreachable host. PROMPT_FN stubs the jury; PROMPT_CALLS counts jury
invocations (the hash gate must keep the jury uncalled on changed content).
EQ_FN optionally overrides strict_eq (undetermined-outcome tests).
"""
import sys, os, types, json, hashlib

TRANSFERS = []          # (recipient, amount) emitted via _Recipient.emit_transfer
WEB = {}                # url -> bytes | (status, bytes); missing key = fetch failure
PROMPT_FN = None        # callable(prompt, images) -> jury verdict stub
PROMPT_CALLS = {"n": 0}
EQ_FN = None            # optional override for strict_eq
CLOCK = {"iso": "2026-11-23T00:00:00"}

class UserError(Exception):
    pass

class _Msg:
    sender_address = "0x" + "a" * 40
    value = 0
    @property
    def datetime(self):
        return CLOCK["iso"]

class _Resp:
    def __init__(self, body, status=200, url=None):
        self.body = body
        self.status = status
        self.url = url

class _Web:
    @staticmethod
    def get(url):
        if url not in WEB:
            raise Exception("unreachable: " + str(url))
        v = WEB[url]
        if isinstance(v, tuple):
            return _Resp(v[1], v[0], url)
        return _Resp(v, 200, url)

class _Nondet:
    web = _Web()
    @staticmethod
    def exec_prompt(prompt, response_format=None, images=None):
        assert PROMPT_FN is not None, "no jury stub set"
        PROMPT_CALLS["n"] += 1
        return PROMPT_FN(prompt, images)

class _Eq:
    @staticmethod
    def strict_eq(fn):
        if EQ_FN is not None:
            return EQ_FN(fn)
        return fn()

class _Public:
    def write(self, fn):
        return fn
    write.payable = staticmethod(lambda fn: fn)
    def view(self, fn):
        return fn

class _Recipient:
    def __init__(self, addr):
        self.addr = str(addr)
    def emit_transfer(self, value=None):
        TRANSFERS.append((self.addr, int(value)))

def _contract_interface(cls):
    return _Recipient

class _Contract:
    balance = 0

gl = types.ModuleType("genlayer")
gl.contract = types.SimpleNamespace(Contract=_Contract)
gl.public = _Public()
gl.vm = types.SimpleNamespace(UserError=UserError)
gl.message = _Msg()
gl.nondet = _Nondet()
gl.eq_principle = _Eq()
gl.evm = types.SimpleNamespace(contract_interface=_contract_interface)
storage = types.ModuleType("genlayer.storage")

class GenerationError(Exception):
    """Stub of genlayer.storage._internal.generate.GenerationError."""

_ALLOCATING = {"on": False}

class TreeMap(dict):
    def __init__(self, *args, **kwargs):
        if not _ALLOCATING["on"]:
            raise GenerationError(
                "generic storage classes can not be instantiated with "
                "__init__, please, use gl.storage.inmem_allocate")
        super().__init__(*args, **kwargs)

def _inmem_allocate(cls, *args, **kwargs):
    _ALLOCATING["on"] = True
    try:
        return cls(*args, **kwargs)
    finally:
        _ALLOCATING["on"] = False

storage.TreeMap = TreeMap
storage.GenerationError = GenerationError
storage.inmem_allocate = _inmem_allocate
gtypes = types.ModuleType("genlayer.types")
gtypes.Address = lambda a: str(a)
gtypes.u256 = int
gtypes.bigint = int
sys.modules["genlayer"] = gl
sys.modules["genlayer.storage"] = storage
sys.modules["genlayer.types"] = gtypes

SRC_PATH = os.environ.get("GV_SRC", os.path.join(os.path.dirname(os.path.abspath(__file__)), "GoalVault.py"))
SRC = open(SRC_PATH).read()
ns = {}
exec(compile(SRC, SRC_PATH, "exec"), ns)
GoalVault = ns["GoalVault"]

A = "0xd2af69bb67d446526661a80a280820599c601ed3"   # deployer (no special rights)
S1 = "0x0bba411375d7074178980e610b5311dd6ed34d74"  # staker 1
S2 = "0x6fa23bd191266a8680c195ec6a618d2d9d584cab"  # staker 2
S3 = "0x" + "2" * 40                               # staker 3
S4 = "0x" + "3" * 40                               # staker 4
OUT = "0x" + "1" * 40                              # unrelated stranger
DAY = 86400
# Twin parameters (fast-clock proof deployment values from the spec).
TWIN = {"epoch_duration": 600, "grace": 60, "assess_window": 120,
        "min_lead": 120, "min_stake": 1000}
PROD = {"epoch_duration": 2592000, "grace": 86400, "assess_window": 604800,
        "min_lead": 259200, "min_stake": 1000000000000000}

def set_time(unix):
    import datetime as _dt
    CLOCK["iso"] = _dt.datetime.utcfromtimestamp(unix).strftime("%Y-%m-%dT%H:%M:%S")

def now_unix():
    import calendar as _cal
    s = CLOCK["iso"]
    return _cal.timegm((int(s[0:4]), int(s[5:7]), int(s[8:10]), int(s[11:13]), int(s[14:16]), int(s[17:19])))

_MAPS = ("goals", "balances", "epochs")
_SCALARS = ("next_id", "genesis", "epoch_dur", "grace", "assess_win", "min_lead", "min_stake")

def fresh(balance=0, genesis_ts=0, **params):
    """New contract at the harness clock (tests set_time(T0) first, so a
    genesis_ts of 0 lands genesis exactly on T0)."""
    TRANSFERS.clear()
    WEB.clear()
    PROMPT_CALLS["n"] = 0
    globals()["PROMPT_FN"] = None
    globals()["EQ_FN"] = None
    gl.message.sender_address = A
    p = dict(TWIN)
    p.update(params)
    c = GoalVault.__new__(GoalVault)
    _ALLOCATING["on"] = True
    try:
        for m in _MAPS:
            setattr(c, m, TreeMap())
    finally:
        _ALLOCATING["on"] = False
    GoalVault.__init__(c, p["epoch_duration"], p["grace"], p["assess_window"],
                       p["min_lead"], p["min_stake"], genesis_ts)
    c.balance = balance
    return c

def call(c, sender, fn, *args, value=0):
    """Run one top-level call the way the chain would: value lands first,
    transfers emitted during the call leave the contract balance."""
    gl.message.sender_address = sender
    gl.message.value = value
    if value:
        c.balance += value
    before = len(TRANSFERS)
    try:
        out = fn(*args)
    finally:
        for (_r, amt) in TRANSFERS[before:]:
            c.balance -= amt
    return out

def _snap(c):
    parts = [json.dumps({k: v for k, v in getattr(c, m).items()}, sort_keys=True) for m in _MAPS]
    parts += [str(getattr(c, s)) for s in _SCALARS]
    parts.append(str(len(TRANSFERS)))
    return tuple(parts)

def expect_err(c, sender, fn, *args, code, value=0):
    """Assert the exact error, unchanged stored state, and zero fund
    movement. For value-bearing calls the sent value stays in the balance
    (the GenVM stray); it is accounted away before returning."""
    snap = _snap(c)
    bal = int(c.balance)
    try:
        call(c, sender, fn, *args, value=value)
    except UserError as e:
        assert str(e) == code, f"expected {code}, got {e}"
        assert _snap(c) == snap, f"state changed on {code}"
        if value:
            assert int(c.balance) == bal + value, "payable stray missing"
            c.balance = bal
        else:
            assert int(c.balance) == bal, f"balance moved on {code}"
        return
    raise AssertionError(f"expected UserError {code}, call succeeded")

def accounted(c):
    """The spec's conservation invariant, computed by scanning storage
    (tests may scan; the contract itself never does):
      sum over epochs of (frozen failed total - credited bonuses - rolled)
      + stakes of ACHIEVED-but-uncredited goals
      + credited balances awaiting withdraw.
    Unsolicited funds are never part of this — they show up as excess."""
    total = 0
    for raw in c.epochs.values():
        rec = json.loads(raw)
        frozen_f = int(rec["failed_pool"]) + int(rec["unsettled_stake"])
        total += frozen_f - int(rec["credited_bonus_total"]) - int(rec["rolled_total"])
    for raw in c.goals.values():
        d = json.loads(raw)
        if d["status"] == "ACHIEVED":
            total += int(d["stake"])
    for v in c.balances.values():
        total += int(v)
    return total

def conserve(c, excess=0):
    got = int(c.balance) - accounted(c)
    assert got == excess, f"conservation broken: balance-accounted={got} expected excess={excess} " \
        f"(bal={c.balance} accounted={accounted(c)})"

def sha(b):
    return hashlib.sha256(b).hexdigest()
