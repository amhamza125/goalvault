import { weiToGen } from "../lib/format.js";

// The epoch pool band: every figure is a field of get_epoch_stats for the
// epoch being viewed — unsettled stakes still in play, the failed pool
// shown two ways (the already-failed portion on its own line, and the
// frozen total = settled failures + stakes that can now only fail), what
// achievers have locked, and the goal/credit counts.
export default function PoolPanel({ stats, now, account, busy, onRollDust }) {
  if (!stats) return null;
  const finalized = now > Number(stats.finalization_ts);
  // roll_dust gating mirrors GoalVault.roll_dust exactly: the epoch must
  // be finalized (now > finalization_ts), dust must not already be rolled,
  // every achiever must be credited (credited_count == achieved_count),
  // and the computed remainder must be > 0. The call is permissionless —
  // any connected wallet may roll it, not only a staker.
  let dustWei = 0n;
  try {
    dustWei = BigInt(stats.dust_available || "0");
  } catch {
    dustWei = 0n;
  }
  const dustAlreadyRolled = String(stats.dust_rolled ?? "0") === "1";
  const allCredited = Number(stats.credited_count) === Number(stats.achieved_count);
  const canRollDust = finalized && dustWei > 0n && !dustAlreadyRolled && allCredited;
  const items = [
    { label: "In play · unsettled stakes", value: `${weiToGen(stats.unsettled_stake)} GEN`, sub: `${stats.unsettled_count} goal(s) open` },
    { label: "Already failed · locked in the failed pool", value: `${weiToGen(stats.failed_pool)} GEN`, sub: "settled as failed — this part is final" },
    {
      label: finalized ? "Failed pool · frozen total" : "Failed pool · if all open goals fail",
      value: `${weiToGen(stats.frozen_failed_total)} GEN`,
      sub: finalized ? "the failed pool's final total" : "the total if every open goal also fails",
    },
    { label: "Achieved stakes", value: `${weiToGen(stats.achieved_stake)} GEN`, sub: `${stats.achieved_count} achiever(s)` },
    { label: "Credited payouts", value: `${stats.credited_count} / ${stats.achieved_count}`, sub: "achievers credited so far" },
    { label: "Goals this epoch", value: String((stats.ids || []).length), sub: `epoch ${stats.epoch}` },
  ];
  if (BigInt(stats.rolled_in || "0") > 0n) {
    items.push({
      label: "Rolled in",
      value: `${weiToGen(stats.rolled_in)} GEN`,
      sub: "dust + unclaimed pools from earlier epochs",
    });
  }
  if (finalized && dustWei > 0n) {
    items.push({
      label: "Remainder below min-stake (dust)",
      value: `${weiToGen(stats.dust_available)} GEN`,
      sub: "sub-minimum remainder, rollable once all achievers are credited",
    });
  }
  return (
    <section className="rounded-3xl border border-lineSoft bg-pine-900/70 px-5 py-4 shadow-card">
      <div className="grid grid-cols-2 gap-x-4 gap-y-4 md:grid-cols-3 xl:grid-cols-6">
        {items.map((it) => (
          <div key={it.label}>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-sage">{it.label}</div>
            <div className="tnum mt-1 font-display text-2xl font-bold text-cream">{it.value}</div>
            <div className="mt-0.5 text-xs text-sage">{it.sub}</div>
          </div>
        ))}
      </div>
      {canRollDust && (
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-lineSoft pt-4">
          <div className="text-sm text-cream">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-sage">
              Remainder below min-stake (dust) ·{" "}
            </span>
            <span className="tnum font-mono font-semibold text-gold-300">{weiToGen(dustWei)} GEN</span>
          </div>
          <button
            disabled={!account || !!busy}
            onClick={() => onRollDust && onRollDust(Number(stats.epoch))}
            className="rounded-xl bg-gold-500 px-4 py-2.5 text-sm font-bold text-pine-950 transition hover:bg-gold-400 disabled:opacity-50"
          >
            {busy ? "Rolling…" : "Roll dust"}
          </button>
          {!account && <span className="text-xs text-sage">Connect a wallet to roll the dust.</span>}
          <p className="w-full text-xs text-sage">
            Dust is the sub-minimum remainder rolled into the currently open epoch&rsquo;s failed pool.
          </p>
        </div>
      )}
    </section>
  );
}
