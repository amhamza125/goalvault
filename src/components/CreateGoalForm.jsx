import { useEffect, useMemo, useState } from "react";
import { formatDateTime, genToWei, nowSeconds, toLocalInputValue, weiToGen } from "../lib/format.js";

// Create a goal in the CURRENT epoch. The contract gates are mirrored
// here so the form explains itself before the wallet is ever asked:
// entry window = first half of the epoch; deadline at least min_lead
// ahead and no later than the epoch end; stake at least min_stake.
// The chain re-checks every one of them — this form never fakes a pass.
export default function CreateGoalForm({ config, currentStats, account, now, busy, onCreate, onConnectClick }) {
  const [title, setTitle] = useState("");
  const [criteria, setCriteria] = useState("");
  const [stake, setStake] = useState("");
  const [deadline, setDeadline] = useState("");
  const [error, setError] = useState("");

  const ready = !!config && !!currentStats;
  const epochStart = currentStats ? Number(currentStats.epoch_start) : 0;
  const epochEnd = currentStats ? Number(currentStats.epoch_end) : 0;
  const entryClose = config ? epochStart + Math.floor(config.epochDuration / 2) : 0;
  const entriesOpen = ready && now < entryClose;
  const minDeadline = config ? now + config.minLead : 0;

  // Sensible default deadline: halfway between the earliest allowed and
  // the epoch end. Recomputed when the board first loads.
  useEffect(() => {
    if (!ready || deadline) return;
    const def = Math.min(epochEnd, minDeadline + Math.floor((epochEnd - minDeadline) / 2));
    if (def > minDeadline) setDeadline(toLocalInputValue(def));
    if (!stake && config) setStake(weiToGen(config.minStakeWei));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const deadlineTs = useMemo(() => {
    if (!deadline) return 0;
    const t = Math.floor(new Date(deadline).getTime() / 1000);
    return Number.isFinite(t) ? t : 0;
  }, [deadline]);

  // The exact value that will be submitted, shown in UTC beside the
  // (local-time) picker so there is no timezone ambiguity.
  const deadlineUtcLabel = useMemo(() => {
    if (!deadlineTs) return "";
    const d = new Date(deadlineTs * 1000);
    if (Number.isNaN(d.getTime())) return "";
    const p = (n) => String(n).padStart(2, "0");
    return `Deadline (UTC): ${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC (Unix: ${deadlineTs})`;
  }, [deadlineTs]);

  function validate() {
    if (!title.trim() || title.trim().length > 120) return "Give the goal a title of 1–120 characters.";
    if (!criteria.trim() || criteria.trim().length > 500) return "Write the success criteria in 1–500 characters.";
    let wei;
    try {
      wei = genToWei(stake);
    } catch (e) {
      return e.message;
    }
    if (wei < config.minStakeWei) return `Stake must be at least ${weiToGen(config.minStakeWei)} GEN.`;
    if (!deadlineTs) return "Pick a deadline.";
    if (deadlineTs < nowSeconds() + config.minLead)
      return `Deadline must be at least ${Math.round(config.minLead / 86400)} days ahead (from ${formatDateTime(minDeadline)}).`;
    if (deadlineTs > epochEnd) return `Deadline must fall inside this epoch — by ${formatDateTime(epochEnd)}.`;
    return "";
  }

  function submit(e) {
    e.preventDefault();
    const v = validate();
    setError(v);
    if (v) return;
    onCreate({ title: title.trim(), criteria: criteria.trim(), deadlineTs, stakeWei: genToWei(stake) });
  }

  return (
    <section className="rounded-3xl border border-line bg-pine-900/80 p-5 shadow-vault">
      <h2 className="font-display text-xl font-bold text-cream">Stake on a new goal</h2>
      {!ready && <p className="mt-2 text-sm text-sage">Reading the current epoch…</p>}
      {ready && !entriesOpen && (
        <div className="mt-3 rounded-xl border border-lineSoft bg-pine-950/60 p-3 text-sm text-cream">
          Entries for epoch {currentStats.epoch} closed at {formatDateTime(entryClose)} — goals are only
          taken in the first half of an epoch. The next epoch opens at {formatDateTime(epochEnd)}.
        </div>
      )}
      {ready && entriesOpen && (
        <form onSubmit={submit} className="mt-4 space-y-3">
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wider text-sage">Goal title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
              placeholder="Run a 10k in under 50 minutes"
              className="mt-1 w-full rounded-xl border border-lineSoft bg-pine-950 px-3 py-2.5 text-sm text-cream placeholder:text-sage/60 focus:border-line focus:outline-none"
            />
          </div>
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wider text-sage">
              Success criteria — the jury judges your proof against exactly this
            </label>
            <textarea
              value={criteria}
              onChange={(e) => setCriteria(e.target.value)}
              maxLength={500}
              rows={4}
              placeholder="My public race result page shows my name, the 10k distance, and a finish time under 50:00."
              className="mt-1 w-full resize-y rounded-xl border border-lineSoft bg-pine-950 px-3 py-2.5 text-sm text-cream placeholder:text-sage/60 focus:border-line focus:outline-none"
            />
            <div className="mt-1 text-right text-xs text-sage">{criteria.length}/500</div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-sage">Stake (GEN)</label>
              <input
                value={stake}
                onChange={(e) => setStake(e.target.value)}
                inputMode="decimal"
                placeholder={config ? weiToGen(config.minStakeWei) : "0.001"}
                className="tnum mt-1 w-full rounded-xl border border-lineSoft bg-pine-950 px-3 py-2.5 font-mono text-sm text-cream placeholder:text-sage/60 focus:border-line focus:outline-none"
              />
              <div className="mt-1 text-xs text-sage">Minimum {config ? weiToGen(config.minStakeWei) : "—"} GEN</div>
            </div>
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-sage">Deadline</label>
              <input
                type="datetime-local"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                className="tnum mt-1 w-full rounded-xl border border-lineSoft bg-pine-950 px-3 py-2.5 font-mono text-sm text-cream focus:border-line focus:outline-none"
              />
              <div className="mt-1 text-xs text-sage">By {formatDateTime(epochEnd)} at the latest</div>
              {deadlineUtcLabel && (
                <div className="tnum mt-1 font-mono text-xs text-cream">{deadlineUtcLabel}</div>
              )}
            </div>
          </div>
          {error && <div className="rounded-xl border border-[#e08a7a]/40 bg-[#e08a7a]/5 px-3 py-2 text-sm text-[#eec0b5]">{error}</div>}
          {account ? (
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-xl bg-gold-500 px-4 py-3 text-sm font-bold text-pine-950 transition hover:bg-gold-400 disabled:opacity-50"
            >
              {busy ? "Locking your stake…" : "Lock the stake & open the goal"}
            </button>
          ) : (
            <button
              type="button"
              onClick={onConnectClick}
              className="w-full rounded-xl bg-gold-500 px-4 py-3 text-sm font-bold text-pine-950 transition hover:bg-gold-400"
            >
              Connect wallet to stake
            </button>
          )}
          <p className="text-xs leading-relaxed text-sage">
            If the jury verifies your proof, you are credited your stake back plus a share of this
            epoch&rsquo;s failed stakes. If not, your stake feeds the achievers. Criteria that cannot be
            proven false can never draw a bonus.
          </p>
        </form>
      )}
    </section>
  );
}
