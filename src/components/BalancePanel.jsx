import { shortAddress, weiToGen } from "../lib/format.js";

// "My balance": the GEN the contract has credited to the connected wallet
// (payouts from credited goals), plus the wallet's native GEN balance for
// reference. The withdraw preview always names the amount and the
// destination wallet; the button is disabled while disconnected or when
// the credited balance is 0 — the contract rejects a zero withdrawal.
export default function BalancePanel({ account, creditedWei, nativeWei, busy, onWithdraw, onConnectClick }) {
  const withdrawableWei = creditedWei === null ? 0n : creditedWei;
  const withdrawDisabled = !account || busy || creditedWei === null || creditedWei === 0n;
  return (
    <section className="rounded-3xl border border-lineSoft bg-pine-900/80 p-5 shadow-card">
      <h2 className="font-display text-xl font-bold text-cream">My vault balance</h2>
      {!account && (
        <div className="mt-3">
          <p className="text-sm text-sage">Connect your wallet to see what the vault owes you.</p>
          <div className="tnum mt-3 text-sm text-cream">
            Withdrawable: {weiToGen(0n)} GEN → <span className="text-sage">no wallet connected</span>
          </div>
          <button
            disabled
            className="mt-3 w-full rounded-xl bg-gold-500 px-4 py-3 text-sm font-bold text-pine-950 opacity-50"
          >
            Withdraw {weiToGen(0n)} GEN
          </button>
          <button
            onClick={onConnectClick}
            className="mt-3 w-full rounded-xl border border-line px-4 py-2.5 text-sm font-bold text-gold-300 transition hover:bg-pine-800"
          >
            Connect wallet
          </button>
        </div>
      )}
      {account && (
        <div className="mt-3 space-y-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-sage">
              Credited to {shortAddress(account)}
            </div>
            <div className="tnum mt-1 font-display text-4xl font-black text-gold-300">
              {creditedWei === null ? "…" : `${weiToGen(creditedWei)} GEN`}
            </div>
          </div>
          <div className="flex items-center justify-between border-t border-lineSoft pt-3 text-sm">
            <span className="text-sage">Wallet balance</span>
            <span className="tnum font-mono text-cream">
              {nativeWei === null ? "…" : `${weiToGen(nativeWei)} GEN`}
            </span>
          </div>
          <div className="tnum border-t border-lineSoft pt-3 text-sm text-cream">
            Withdrawable: {creditedWei === null ? "…" : `${weiToGen(withdrawableWei)} GEN`} →{" "}
            <span className="font-mono text-[13px]">{shortAddress(account)}</span>
          </div>
          <button
            disabled={withdrawDisabled}
            onClick={onWithdraw}
            className="w-full rounded-xl bg-gold-500 px-4 py-3 text-sm font-bold text-pine-950 transition hover:bg-gold-400 disabled:opacity-50"
          >
            {busy ? "Withdrawing…" : `Withdraw ${weiToGen(withdrawableWei)} GEN`}
          </button>
          {creditedWei === 0n && (
            <p className="text-xs text-sage">
              Nothing credited yet — payouts land here when one of your goals is credited after its epoch
              finalizes.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
