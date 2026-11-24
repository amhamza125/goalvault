// Wallet discovery for GoalVault — injected browser wallets only.
// Wallets are discovered via EIP-6963 (MetaMask, Rabby, Brave, OKX, …)
// with the legacy window.ethereum as fallback, and listed by name so the
// user picks the wallet they actually use. Connect = accounts first,
// then the Bradbury chain switch (see genlayer.js connectWallet).
import { connectWallet, setWalletProvider } from "./genlayer.js";

/**
 * Discover injected wallets via EIP-6963. Listens for announceProvider
 * events for a short window, then falls back to window.ethereum (named
 * from its flags when known). Returns [{ id, name, provider }].
 * Never throws: an empty list means "no injected wallet found".
 */
export function discoverInjectedWallets(timeoutMs = 700) {
  return new Promise((resolve) => {
    const found = new Map(); // provider object -> { id, name, provider }
    const guessName = (eth) => {
      if (!eth) return "Injected wallet";
      if (eth.isOkxWallet || eth.isOKExWallet) return "OKX Wallet";
      if (eth.isMetaMask) return "MetaMask";
      if (eth.isRabby) return "Rabby";
      if (eth.isBraveWallet) return "Brave Wallet";
      if (eth.isCoinbaseWallet) return "Coinbase Wallet";
      if (eth.isTrust) return "Trust Wallet";
      return "Browser wallet";
    };
    const add = (provider, name, id) => {
      if (!provider || typeof provider.request !== "function") return;
      if (found.has(provider)) return;
      found.set(provider, { id: id || `injected-${found.size}`, name, provider });
    };
    const onAnnounce = (event) => {
      const detail = event?.detail || {};
      if (detail.provider) {
        add(detail.provider, detail.info?.name || "Injected wallet", detail.info?.rdns || detail.info?.uuid);
      }
    };
    try {
      window.addEventListener("eip6963:announceProvider", onAnnounce);
      window.dispatchEvent(new window.Event("eip6963:requestProvider"));
    } catch {
      // EIP-6963 unsupported — the legacy fallback below still runs.
    }
    setTimeout(() => {
      try {
        window.removeEventListener("eip6963:announceProvider", onAnnounce);
      } catch {}
      if (typeof window !== "undefined" && window.ethereum) {
        add(window.ethereum, guessName(window.ethereum), "legacy-ethereum");
      }
      resolve([...found.values()]);
    }, timeoutMs);
  });
}

/** Connect an injected provider: switch/add Bradbury, request accounts. */
export async function connectInjected(provider) {
  setWalletProvider(provider);
  return connectWallet(provider);
}
