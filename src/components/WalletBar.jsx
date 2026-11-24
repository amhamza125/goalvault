import { useEffect, useState } from "react";
import { CONTRACT_ADDRESS, explorerAddressUrl } from "../lib/config.js";
import { shortAddress } from "../lib/format.js";
import { discoverInjectedWallets, connectInjected } from "../lib/wallet.js";
import { friendlyError } from "../lib/genlayer.js";

// Top bar: brand, contract chip, and the wallet connect control. When
// disconnected, "Connect wallet" opens a chooser listing every injected
// wallet found via EIP-6963 — the user picks the wallet they actually use.
export default function WalletBar({ account, walletName, onConnect, onDisconnect, chooserOpen, setChooserOpen }) {
  const [wallets, setWallets] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!chooserOpen) return;
    let live = true;
    setWallets(null);
    setError("");
    discoverInjectedWallets().then((list) => {
      if (live) setWallets(list);
    });
    return () => {
      live = false;
    };
  }, [chooserOpen]);

  async function pick(w) {
    setBusy(true);
    setError("");
    try {
      const addr = await connectInjected(w.provider);
      onConnect(addr, w.name);
      setChooserOpen(false);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <header className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-3 px-4 pt-5 sm:px-6">
      <div className="flex items-center gap-3">
        <svg viewBox="0 0 64 64" className="h-10 w-10 shrink-0" aria-hidden="true">
          <rect x="4" y="10" width="56" height="44" rx="8" fill="#0a2e22" stroke="#c9a227" strokeWidth="3" />
          <circle cx="32" cy="32" r="11" fill="none" stroke="#c9a227" strokeWidth="4" />
          <circle cx="32" cy="32" r="3.5" fill="#e8c85a" />
          <rect x="29" y="14" width="6" height="7" fill="#c9a227" />
        </svg>
        <div>
          <div className="font-display text-2xl font-black leading-none tracking-tight text-cream">
            Goal<span className="text-gold-400">Vault</span>
          </div>
          <div className="mt-1 text-[11px] font-medium uppercase tracking-[0.18em] text-sage">
            Stake on your goal · GenLayer Bradbury
          </div>
        </div>
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        <a
          href={explorerAddressUrl(CONTRACT_ADDRESS)}
          target="_blank"
          rel="noreferrer"
          className="hidden rounded-full border border-lineSoft bg-pine-900/70 px-3 py-1.5 font-mono text-xs text-sage transition hover:border-line hover:text-cream md:block"
          title="View the GoalVault contract in the explorer"
        >
          {shortAddress(CONTRACT_ADDRESS)}
        </a>
        {account ? (
          <div className="flex items-center gap-2">
            <div className="rounded-full border border-line bg-pine-900 px-3 py-1.5 font-mono text-xs text-cream">
              <span className="mr-2 inline-block h-2 w-2 rounded-full bg-pine-500 align-middle" />
              {shortAddress(account)}
              {walletName ? <span className="ml-2 text-sage">{walletName}</span> : null}
            </div>
            <button
              onClick={onDisconnect}
              className="rounded-full border border-lineSoft px-3 py-1.5 text-xs font-semibold text-sage transition hover:border-line hover:text-cream"
            >
              Disconnect
            </button>
          </div>
        ) : (
          <button
            onClick={() => setChooserOpen(true)}
            className="rounded-full bg-gold-500 px-4 py-2 text-sm font-bold text-pine-950 shadow-goldline transition hover:bg-gold-400"
          >
            Connect wallet
          </button>
        )}
      </div>

      {chooserOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 sm:items-center"
          onClick={() => !busy && setChooserOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-line bg-pine-900 p-5 shadow-vault"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="font-display text-lg font-bold text-cream">Choose your wallet</div>
            <p className="mt-1 text-sm text-sage">
              GoalVault writes to GenLayer Bradbury (chain 4221). Your wallet will ask you to switch chains.
            </p>
            <div className="mt-4 space-y-2">
              {wallets === null && <div className="text-sm text-sage">Looking for wallets…</div>}
              {wallets !== null && wallets.length === 0 && (
                <div className="rounded-xl border border-lineSoft bg-pine-950/60 p-3 text-sm text-cream">
                  No browser wallet found. Install MetaMask or Rabby, or open this page inside your
                  wallet app&rsquo;s browser, then try again.
                </div>
              )}
              {(wallets || []).map((w) => (
                <button
                  key={w.id}
                  disabled={busy}
                  onClick={() => pick(w)}
                  className="flex w-full items-center justify-between rounded-xl border border-lineSoft bg-pine-800 px-4 py-3 text-left text-sm font-semibold text-cream transition hover:border-line disabled:opacity-50"
                >
                  {w.name}
                  <span className="text-xs font-medium text-gold-400">{busy ? "Connecting…" : "Connect"}</span>
                </button>
              ))}
            </div>
            {error && <div className="mt-3 text-sm text-[#e08a7a]">{error}</div>}
            <button
              onClick={() => !busy && setChooserOpen(false)}
              className="mt-4 w-full rounded-xl border border-lineSoft px-4 py-2.5 text-sm font-semibold text-sage transition hover:text-cream"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </header>
  );
}
