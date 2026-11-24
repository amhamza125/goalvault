import { useState } from "react";
import { formatDateTime, formatDuration, sameAddress, shortAddress, weiToGen } from "../lib/format.js";

const PILL = {
  ACTIVE: "border-gold-500/60 text-gold-300",
  PROOF_IN: "border-pine-300/50 text-pine-200",
  ACHIEVED: "bg-pine-600 text-cream border-pine-500",
  NOT_ACHIEVED: "border-[#e08a7a]/50 text-[#e08a7a]",
  FAILED: "border-lineSoft text-sage",
  CREDITED: "bg-gold-500 text-pine-950 border-gold-400",
};

// One goal on the board. Actions render only when the connected wallet
// and the goal's on-chain state actually allow them:
// - submit_proof: the staker, ACTIVE, inside deadline + grace
// - assess: anyone, PROOF_IN, before finalization
// - mark_failed: anyone, ACTIVE past deadline + grace, or PROOF_IN past
//   finalization
// - credit: anyone, ACHIEVED, after finalization (never on CREDITED)
// The proof token is shown MASKED, and only to the connected staker who
// owns the goal; clicking it copies the full token. Other viewers do not
// see the token at all.
const MAX_PROOF_URL_LEN = 512; // mirrors the contract's MAX_URL_LEN

function maskToken(token) {
  if (!token) return "";
  if (token.length <= 10) return token;
  return `${token.slice(0, 9)}…${token.slice(-3)}`;
}

function proofUrlError(url) {
  const u = (url || "").trim();
  if (!u) return "Enter your public proof page URL.";
  if (u.length > MAX_PROOF_URL_LEN) return `Proof URL is too long — keep it to ${MAX_PROOF_URL_LEN} characters or fewer.`;
  if (!u.startsWith("https://")) return "Proof URL must start with https://";
  if (u.length <= "https://".length) return "Enter a complete https:// proof page URL.";
  if (/\s/.test(u)) return "Proof URL must not contain spaces.";
  return "";
}

export default function GoalCard({ goal, stats, config, account, now, busyKey, onSubmitProof, onAssess, onMarkFailed, onCredit }) {
  const [proofUrl, setProofUrl] = useState("");
  const [showProof, setShowProof] = useState(false);
  const [proofError, setProofError] = useState("");
  const [tokenCopied, setTokenCopied] = useState(false);

  const status = goal.status;
  const deadline = Number(goal.deadline);
  const grace = config ? config.grace : 0;
  const finTs = stats ? Number(stats.finalization_ts) : 0;
  const isStaker = sameAddress(account, goal.staker);
  const busy = busyKey === `goal-${goal.id}`;

  const canSubmit = !!account && isStaker && status === "ACTIVE" && now <= deadline + grace;
  const canAssess = !!account && status === "PROOF_IN" && now <= finTs;
  const canMarkFailed =
    !!account &&
    ((status === "ACTIVE" && now > deadline + grace) || (status === "PROOF_IN" && now > finTs));
  const canCredit = !!account && status === "ACHIEVED" && now > finTs;
  const hasActions = canSubmit || canAssess || canMarkFailed || canCredit;

  const deadlineNote =
    deadline > now ? `in ${formatDuration(deadline - now)}` : `${formatDuration(now - deadline)} ago`;

  return (
    <article className="flex flex-col rounded-3xl border border-lineSoft bg-pine-900/80 p-5 shadow-card animate-fade-up">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-display text-xl font-bold leading-snug text-cream">{goal.title}</h3>
        <span
          className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider ${PILL[status] || PILL.FAILED}`}
        >
          {status.replace("_", " ")}
        </span>
      </div>

      <p className="mt-2 line-clamp-3 whitespace-pre-line text-sm leading-relaxed text-sage">{goal.criteria}</p>

      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-sage">Stake</div>
          <div className="tnum mt-0.5 font-mono text-base text-gold-300">{weiToGen(goal.stake)} GEN</div>
        </div>
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-sage">Deadline</div>
          <div className="mt-0.5 font-mono text-[13px] text-cream">
            {formatDateTime(deadline)} <span className="text-sage">· {deadlineNote}</span>
          </div>
        </div>
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-sage">Staker</div>
          <div className="mt-0.5 font-mono text-[13px] text-cream">
            {shortAddress(goal.staker)}
            {isStaker && <span className="ml-1 text-gold-400">(you)</span>}
          </div>
        </div>
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-sage">Goal</div>
          <div className="mt-0.5 font-mono text-[13px] text-cream">#{goal.id} · epoch {goal.epoch}</div>
        </div>
      </div>

      {isStaker && (status === "ACTIVE" || status === "PROOF_IN") && goal.token && (
        <div className="mt-3 rounded-xl border border-dashed border-line bg-pine-950/60 px-3 py-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-sage">Proof token — </span>
          <button
            type="button"
            title="Copy the full proof token"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(goal.token);
                setTokenCopied(true);
                setTimeout(() => setTokenCopied(false), 2000);
              } catch {
                setTokenCopied(false);
              }
            }}
            className="font-mono text-[13px] font-semibold text-gold-300 underline decoration-gold-600/60 underline-offset-2 hover:text-gold-400"
          >
            {maskToken(goal.token)}
          </button>
          {tokenCopied && <span className="ml-2 text-xs font-semibold text-pine-200">Copied</span>}
          <div className="mt-0.5 text-xs text-sage">Embed this exact token in your proof page before submitting.</div>
          <div className="mt-0.5 text-xs text-sage">Tap the token to copy the full token.</div>
        </div>
      )}

      {goal.proof_url && (
        <div className="mt-3 text-sm">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-sage">Proof page · </span>
          <a
            href={goal.proof_url}
            target="_blank"
            rel="noreferrer"
            className="break-all font-mono text-[13px] text-pine-200 underline decoration-pine-500/60 underline-offset-2 hover:text-cream"
          >
            {goal.proof_url}
          </a>
          {Number(goal.failures) > 0 && (
            <div className="mt-1 text-xs text-[#e08a7a]">
              {goal.failures} assessment attempt(s) could not read the page or found it changed — the goal stays open for assessment until finalization.
            </div>
          )}
        </div>
      )}

      {status === "NOT_ACHIEVED" && goal.reason_text && (
        <div className="mt-3 rounded-xl border border-[#e08a7a]/30 bg-[#e08a7a]/5 px-3 py-2 text-sm text-[#eec0b5]">
          Jury: {goal.reason_text}
        </div>
      )}
      {status === "ACHIEVED" && goal.reason_text && (
        <div className="mt-3 rounded-xl border border-pine-500/40 bg-pine-600/10 px-3 py-2 text-sm text-pine-100">
          Jury: {goal.reason_text}
          {now <= finTs && <span className="text-sage"> Payout can be credited after finalization ({formatDateTime(finTs)}).</span>}
        </div>
      )}
      {status === "CREDITED" && goal.payout && (
        <div className="mt-3 rounded-xl border border-gold-500/40 bg-gold-500/10 px-3 py-2 text-sm text-gold-200">
          Credited: <span className="tnum font-mono font-semibold">{weiToGen(goal.payout)} GEN</span> to balance
          <span className="text-gold-200/80"> — ready to withdraw.</span>
        </div>
      )}

      {hasActions && (
        <div className="mt-4 border-t border-lineSoft pt-4">
          {canSubmit && !showProof && (
            <button
              disabled={busy}
              onClick={() => setShowProof(true)}
              className="w-full rounded-xl bg-gold-500 px-4 py-2.5 text-sm font-bold text-pine-950 transition hover:bg-gold-400 disabled:opacity-50"
            >
              Submit proof
            </button>
          )}
          {canSubmit && showProof && (
            <div className="space-y-2">
              <input
                value={proofUrl}
                onChange={(e) => {
                  setProofUrl(e.target.value);
                  if (proofError) setProofError("");
                }}
                placeholder="https://… your public proof page"
                className="w-full rounded-xl border border-lineSoft bg-pine-950 px-3 py-2.5 font-mono text-sm text-cream placeholder:text-sage/60 focus:border-line focus:outline-none"
              />
              {proofError && (
                <div className="rounded-xl border border-[#e08a7a]/40 bg-[#e08a7a]/5 px-3 py-2 text-sm text-[#eec0b5]">
                  {proofError}
                </div>
              )}
              <div className="flex gap-2">
                <button
                  disabled={busy || !proofUrl.trim()}
                  onClick={() => {
                    const err = proofUrlError(proofUrl);
                    setProofError(err);
                    if (err) return;
                    onSubmitProof(goal.id, proofUrl.trim());
                  }}
                  className="flex-1 rounded-xl bg-gold-500 px-4 py-2.5 text-sm font-bold text-pine-950 transition hover:bg-gold-400 disabled:opacity-50"
                >
                  {busy ? "Submitting…" : "Bind this page as my proof"}
                </button>
                <button
                  disabled={busy}
                  onClick={() => setShowProof(false)}
                  className="rounded-xl border border-lineSoft px-3 py-2.5 text-sm font-semibold text-sage transition hover:text-cream"
                >
                  Cancel
                </button>
              </div>
              <p className="text-xs text-sage">
                The page is fetched and hash-bound the moment you submit — changing it afterwards can never
                settle as achieved.
              </p>
            </div>
          )}
          {canAssess && (
            <button
              disabled={busy}
              onClick={() => onAssess(goal.id)}
              className="w-full rounded-xl bg-pine-600 px-4 py-2.5 text-sm font-bold text-cream transition hover:bg-pine-500 disabled:opacity-50"
            >
              {busy ? "Jury is reading…" : "Ask the jury to assess"}
            </button>
          )}
          {canMarkFailed && (
            <button
              disabled={busy}
              onClick={() => onMarkFailed(goal.id)}
              className="w-full rounded-xl border border-[#e08a7a]/40 px-4 py-2.5 text-sm font-bold text-[#e08a7a] transition hover:bg-[#e08a7a]/10 disabled:opacity-50"
            >
              {busy ? "Settling…" : "Settle as failed"}
            </button>
          )}
          {canCredit && (
            <>
              <button
                disabled={busy}
                onClick={() => onCredit(goal.id)}
                className="w-full rounded-xl bg-gold-500 px-4 py-2.5 text-sm font-bold text-pine-950 transition hover:bg-gold-400 disabled:opacity-50"
              >
                {busy ? "Crediting…" : "Credit the payout"}
              </button>
              <p className="mt-2 text-xs text-sage">
                Crediting only moves the payout into the on-chain balance (internal accounting) — the GEN
                reaches your wallet only when you withdraw it.
              </p>
            </>
          )}
        </div>
      )}

      {!account && (status === "ACTIVE" || status === "PROOF_IN" || status === "ACHIEVED") && (
        <div className="mt-4 border-t border-lineSoft pt-3 text-xs text-sage">
          Connect a wallet to act on this goal.
        </div>
      )}
    </article>
  );
}
