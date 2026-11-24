import { durationParts, formatDateTime } from "../lib/format.js";

// The epoch hero: a big serif epoch number, a live countdown (to the
// entry-window close while entries are open, otherwise to the epoch end),
// and the three times that govern this epoch — all from chain reads.
export default function Hero({ config, stats, now }) {
  if (!config || !stats) {
    return (
      <section className="mx-auto mt-6 w-full max-w-7xl px-4 sm:px-6">
        <div className="rounded-3xl border border-line bg-pine-900/80 px-6 py-10 shadow-vault">
          <div className="text-sm text-sage">Reading the vault from Bradbury…</div>
        </div>
      </section>
    );
  }

  const epoch = Number(stats.epoch);
  const epochStart = Number(stats.epoch_start);
  const epochEnd = Number(stats.epoch_end);
  const finTs = Number(stats.finalization_ts);
  const entryClose = epochStart + Math.floor(config.epochDuration / 2);
  const entriesOpen = now < entryClose;
  const target = entriesOpen ? entryClose : epochEnd;
  const parts = durationParts(target - now);
  const pad = (n) => String(n).padStart(2, "0");

  const cells = [
    { v: pad(parts.d), l: "days" },
    { v: pad(parts.h), l: "hours" },
    { v: pad(parts.m), l: "min" },
    { v: pad(parts.s), l: "sec" },
  ];

  return (
    <section className="mx-auto mt-6 w-full max-w-7xl px-4 sm:px-6">
      <div className="animate-fade-up overflow-hidden rounded-3xl border border-line bg-pine-900/80 shadow-vault">
        <div className="grid gap-6 px-6 py-7 sm:px-8 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-display text-5xl font-black leading-none text-cream sm:text-6xl">
                Epoch {epoch}
              </span>
              <span
                className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider ${
                  entriesOpen
                    ? "bg-gold-500 text-pine-950"
                    : "border border-line text-gold-300"
                }`}
              >
                {entriesOpen ? "Entries open" : "Entries closed"}
              </span>
            </div>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-sage">
              Stake GEN on a goal you set for yourself. Publish proof, let the validator jury check it
              against your own criteria, and achievers split the stakes of everyone in this epoch who
              did not make it.
            </p>
            <div className="mt-4 grid max-w-xl grid-cols-1 gap-2 text-sm sm:grid-cols-3">
              <div className="rounded-xl border border-lineSoft bg-pine-950/50 px-3 py-2">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-sage">Entry window closes</div>
                <div className="mt-0.5 font-mono text-[13px] text-cream">{formatDateTime(entryClose)}</div>
              </div>
              <div className="rounded-xl border border-lineSoft bg-pine-950/50 px-3 py-2">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-sage">Epoch ends</div>
                <div className="mt-0.5 font-mono text-[13px] text-cream">{formatDateTime(epochEnd)}</div>
              </div>
              <div className="rounded-xl border border-lineSoft bg-pine-950/50 px-3 py-2">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-sage">Payouts finalize</div>
                <div className="mt-0.5 font-mono text-[13px] text-cream">{formatDateTime(finTs)}</div>
              </div>
            </div>
          </div>

          <div className="lg:text-right">
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gold-400">
              {entriesOpen ? "Entry window closes in" : "Epoch ends in"}
            </div>
            <div className="mt-2 flex items-start justify-start gap-2 lg:justify-end">
              {cells.map((c, i) => (
                <div key={c.l} className="flex items-start gap-2">
                  <div className="rounded-2xl border border-line bg-pine-950/70 px-3 py-2 text-center shadow-card">
                    <div className="tnum font-display text-4xl font-black leading-none text-gold-300 sm:text-5xl">
                      {c.v}
                    </div>
                    <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-sage">{c.l}</div>
                  </div>
                  {i < cells.length - 1 && (
                    <div className="animate-tick-pulse pt-1 font-display text-3xl font-black text-gold-600">:</div>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-3 font-mono text-xs text-sage">
              Epoch runs {formatDateTime(epochStart)} → {formatDateTime(epochEnd)}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
