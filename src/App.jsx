import { useCallback, useEffect, useState } from "react";
import WalletBar from "./components/WalletBar.jsx";
import Hero from "./components/Hero.jsx";
import PoolPanel from "./components/PoolPanel.jsx";
import GoalCard from "./components/GoalCard.jsx";
import CreateGoalForm from "./components/CreateGoalForm.jsx";
import BalancePanel from "./components/BalancePanel.jsx";
import {
  baseFees,
  ethBalance,
  friendlyError,
  getConfig,
  getCreditedBalance,
  getEpochStats,
  getGoal,
  listGoals,
  payoutFees,
  sendWrite,
  setWalletProvider,
} from "./lib/genlayer.js";
import { CONTRACT_ADDRESS, explorerAddressUrl, explorerTxUrl } from "./lib/config.js";
import { epochOf, nowSeconds } from "./lib/format.js";

// GoalVault board. Every number on this page comes from a live read of
// the production contract (get_config / get_epoch_stats / list_goals /
// get_balance); every action is a real write with the exact contract
// method name. Board state refreshes after each finalized write.
export default function App() {
  const [config, setConfig] = useState(null);
  const [currentEpoch, setCurrentEpoch] = useState(null);
  const [currentStats, setCurrentStats] = useState(null);
  const [viewEpoch, setViewEpoch] = useState(null);
  const [stats, setStats] = useState(null);
  const [goals, setGoals] = useState([]);
  const [loadError, setLoadError] = useState("");
  const [account, setAccount] = useState(null);
  const [walletName, setWalletName] = useState("");
  const [chooserOpen, setChooserOpen] = useState(false);
  const [creditedWei, setCreditedWei] = useState(null);
  const [nativeWei, setNativeWei] = useState(null);
  const [busyKey, setBusyKey] = useState(null);
  const [notice, setNotice] = useState(null); // { kind, text, hash }
  const [now, setNow] = useState(nowSeconds());

  // 1-second tick for the countdowns and time-based action gates.
  useEffect(() => {
    const t = setInterval(() => setNow(nowSeconds()), 1000);
    return () => clearInterval(t);
  }, []);

  const loadEpoch = useCallback(async (epoch) => {
    const [s, g] = await Promise.all([getEpochStats(epoch), listGoals(epoch, 0, 100)]);
    return { s, g };
  }, []);

  const refreshBoard = useCallback(
    async (cfg, curEp, viewEp) => {
      try {
        const [cur, view] = await Promise.all([loadEpoch(curEp), loadEpoch(viewEp)]);
        setCurrentStats(cur.s);
        setStats(view.s);
        setGoals(view.g);
        setLoadError("");
      } catch (e) {
        setLoadError(friendlyError(e));
      }
    },
    [loadEpoch]
  );

  // Initial load: config first (genesis + durations define the epochs),
  // then the current epoch's board.
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const raw = await getConfig();
        if (!live || !raw) return;
        const cfg = {
          genesis: Number(raw.genesis_ts),
          epochDuration: Number(raw.epoch_duration),
          grace: Number(raw.grace),
          assessWindow: Number(raw.assess_window),
          minLead: Number(raw.min_lead),
          minStakeWei: BigInt(raw.min_stake),
        };
        const cur = epochOf(nowSeconds(), cfg.genesis, cfg.epochDuration);
        setConfig(cfg);
        setCurrentEpoch(cur);
        setViewEpoch(cur);
        const { s, g } = await loadEpoch(cur);
        if (!live) return;
        setCurrentStats(s);
        setStats(s);
        setGoals(g);
      } catch (e) {
        if (live) setLoadError(friendlyError(e));
      }
    })();
    return () => {
      live = false;
    };
  }, [loadEpoch]);

  // When the clock crosses into a new epoch, follow it if the user is
  // still looking at the (previously) current one.
  useEffect(() => {
    if (!config || currentEpoch === null) return;
    const cur = epochOf(now, config.genesis, config.epochDuration);
    if (cur !== currentEpoch) {
      setCurrentEpoch(cur);
      setViewEpoch((v) => (v === currentEpoch ? cur : v));
    }
  }, [now, config, currentEpoch]);

  // Reload the viewed epoch when the switcher moves.
  useEffect(() => {
    if (!config || viewEpoch === null || currentEpoch === null) return;
    let live = true;
    (async () => {
      try {
        const [view, cur] = await Promise.all([
          loadEpoch(viewEpoch),
          viewEpoch === currentEpoch ? Promise.resolve(null) : loadEpoch(currentEpoch),
        ]);
        if (!live) return;
        setStats(view.s);
        setGoals(view.g);
        if (cur) setCurrentStats(cur.s);
        else setCurrentStats(view.s);
      } catch (e) {
        if (live) setLoadError(friendlyError(e));
      }
    })();
    return () => {
      live = false;
    };
  }, [viewEpoch, config, currentEpoch, loadEpoch]);

  const loadBalances = useCallback(async (addr) => {
    if (!addr) {
      setCreditedWei(null);
      setNativeWei(null);
      return;
    }
    try {
      const [c, n] = await Promise.all([getCreditedBalance(addr), ethBalance(addr)]);
      setCreditedWei(c);
      setNativeWei(n);
    } catch {
      // Balance reads are best-effort beside the board; a failed read
      // leaves the last values in place rather than blanking the panel.
    }
  }, []);

  useEffect(() => {
    loadBalances(account);
  }, [account, loadBalances]);

  function handleConnect(addr, name) {
    setAccount(addr);
    setWalletName(name || "");
  }

  function handleDisconnect() {
    setAccount(null);
    setWalletName("");
    setWalletProvider(null);
  }

  // One write path for every action: busy state, a pending notice with
  // the explorer link as soon as the hash exists, then the execution
  // outcome from the finalized receipt, then a full board refresh.
  async function runWrite(key, label, send) {
    if (!account || busyKey) return;
    setBusyKey(key);
    setNotice({ kind: "pending", text: `${label} — sent to your wallet…`, hash: null });
    try {
      const { hash, receipt } = await send((h) =>
        setNotice({ kind: "pending", text: `${label} — in consensus, this can take a few minutes…`, hash: h })
      );
      if (receipt && receipt.execName === "FINISHED_WITH_ERROR") {
        setNotice({
          kind: "error",
          text: `${label} — the contract rejected this transaction. No state changed.`,
          hash,
        });
      } else if (receipt) {
        setNotice({ kind: "ok", text: `${label} — finalized on Bradbury.`, hash });
      } else {
        setNotice({
          kind: "pending",
          text: `${label} — submitted; consensus is still running. The board will catch up on refresh.`,
          hash,
        });
      }
      if (config && currentEpoch !== null && viewEpoch !== null) {
        await refreshBoard(config, currentEpoch, viewEpoch);
      }
      await loadBalances(account);
    } catch (e) {
      setNotice({ kind: "error", text: `${label} — ${friendlyError(e)}`, hash: null });
    } finally {
      setBusyKey(null);
    }
  }

  const handleCreate = ({ title, criteria, deadlineTs, stakeWei }) =>
    runWrite("create", "Create goal", (onHash) =>
      sendWrite(account, "create_goal", [title, criteria, BigInt(deadlineTs)], stakeWei, baseFees(), { onHash })
    );

  const handleSubmitProof = async (goalId, url) => {
    // Client-side hardening before any wallet prompt: validate the URL
    // the way the contract does (https only, non-empty, <= 512 chars),
    // then re-read the goal fresh — a stale board must never send a
    // transaction the contract will revert.
    const u = (url || "").trim();
    if (!u) {
      setNotice({ kind: "error", text: "Submit proof — enter your public proof page URL.", hash: null });
      return;
    }
    if (u.length > 512) {
      setNotice({
        kind: "error",
        text: "Submit proof — the proof URL is too long (512 characters maximum). Shorten it and try again.",
        hash: null,
      });
      return;
    }
    if (!u.startsWith("https://") || u.length <= "https://".length || /\s/.test(u)) {
      setNotice({
        kind: "error",
        text: "Submit proof — the proof URL must be a complete https:// address with no spaces.",
        hash: null,
      });
      return;
    }
    let fresh;
    try {
      fresh = await getGoal(goalId);
    } catch (e) {
      setNotice({ kind: "error", text: `Submit proof — could not re-read goal #${goalId} from the chain: ${friendlyError(e)}`, hash: null });
      return;
    }
    if (!fresh) {
      setNotice({ kind: "error", text: `Submit proof — goal #${goalId} could not be re-read from the chain. Nothing was sent.`, hash: null });
      return;
    }
    if (fresh.status !== "ACTIVE") {
      setNotice({
        kind: "error",
        text: `Submit proof — goal #${goalId} is no longer ACTIVE (it is now ${fresh.status}). Nothing was sent.`,
        hash: null,
      });
      return;
    }
    const graceSecs = config ? config.grace : 0;
    if (nowSeconds() > Number(fresh.deadline) + graceSecs) {
      setNotice({
        kind: "error",
        text: `Submit proof — goal #${goalId} is past its deadline + grace period, so proof can no longer be submitted. Nothing was sent.`,
        hash: null,
      });
      return;
    }
    return runWrite(`goal-${goalId}`, "Submit proof", (onHash) =>
      sendWrite(account, "submit_proof", [BigInt(goalId), u], 0n, baseFees(), { onHash })
    );
  };

  const handleRollDust = (epoch) =>
    runWrite(`roll-${epoch}`, "Roll dust", (onHash) =>
      sendWrite(account, "roll_dust", [BigInt(epoch)], 0n, baseFees(), { onHash })
    );

  const handleAssess = (goalId) =>
    runWrite(`goal-${goalId}`, "Assess goal", (onHash) =>
      sendWrite(account, "assess", [BigInt(goalId)], 0n, baseFees(), { onHash })
    );

  const handleMarkFailed = (goalId) =>
    runWrite(`goal-${goalId}`, "Settle as failed", (onHash) =>
      sendWrite(account, "mark_failed", [BigInt(goalId)], 0n, baseFees(), { onHash })
    );

  const handleCredit = (goalId) =>
    runWrite(`goal-${goalId}`, "Credit payout", (onHash) =>
      sendWrite(account, "credit", [BigInt(goalId)], 0n, baseFees(), { onHash })
    );

  const handleWithdraw = async () => {
    if (!account || busyKey) return;
    // withdraw() is the one _pay-emitting call: it needs the payout fee
    // allocation addressed to the caller, built before the write.
    setBusyKey("withdraw");
    setNotice({ kind: "pending", text: "Withdraw — preparing the payout…", hash: null });
    try {
      const fees = await payoutFees(account);
      const { hash, receipt } = await sendWrite(account, "withdraw", [], 0n, fees, {
        onHash: (h) =>
          setNotice({ kind: "pending", text: "Withdraw — in consensus, this can take a few minutes…", hash: h }),
      });
      if (receipt && receipt.execName === "FINISHED_WITH_ERROR") {
        setNotice({ kind: "error", text: "Withdraw — the contract rejected this transaction.", hash });
      } else if (receipt) {
        setNotice({
          kind: "ok",
          text: "Withdraw — finalized. The GEN transfer settles to your wallet from the contract.",
          hash,
        });
      } else {
        setNotice({ kind: "pending", text: "Withdraw — submitted; consensus is still running.", hash });
      }
      await loadBalances(account);
    } catch (e) {
      setNotice({ kind: "error", text: `Withdraw — ${friendlyError(e)}`, hash: null });
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="min-h-screen font-body">
      <WalletBar
        account={account}
        walletName={walletName}
        onConnect={handleConnect}
        onDisconnect={handleDisconnect}
        chooserOpen={chooserOpen}
        setChooserOpen={setChooserOpen}
      />

      <Hero config={config} stats={currentStats} now={now} />

      {notice && (
        <div className="mx-auto mt-4 w-full max-w-7xl px-4 sm:px-6">
          <div
            className={`flex flex-wrap items-center gap-2 rounded-2xl border px-4 py-3 text-sm ${
              notice.kind === "error"
                ? "border-[#e08a7a]/40 bg-[#e08a7a]/5 text-[#eec0b5]"
                : notice.kind === "ok"
                  ? "border-pine-500/50 bg-pine-600/10 text-pine-100"
                  : "border-line bg-pine-900/80 text-cream"
            }`}
          >
            <span>{notice.text}</span>
            {notice.hash && (
              <a
                href={explorerTxUrl(notice.hash)}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-xs text-gold-300 underline decoration-gold-600/60 underline-offset-2"
              >
                View transaction
              </a>
            )}
            <button
              onClick={() => setNotice(null)}
              className="ml-auto text-xs font-semibold text-sage hover:text-cream"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {loadError && (
        <div className="mx-auto mt-4 w-full max-w-7xl px-4 sm:px-6">
          <div className="rounded-2xl border border-[#e08a7a]/40 bg-[#e08a7a]/5 px-4 py-3 text-sm text-[#eec0b5]">
            Could not read the board from Bradbury: {loadError}{" "}
            <button
              className="font-semibold underline underline-offset-2"
              onClick={() => config && currentEpoch !== null && viewEpoch !== null && refreshBoard(config, currentEpoch, viewEpoch)}
            >
              Retry
            </button>
          </div>
        </div>
      )}

      <main className="mx-auto grid w-full max-w-7xl gap-5 px-4 py-6 sm:px-6 lg:grid-cols-[380px_1fr]">
        <div className="space-y-5">
          <CreateGoalForm
            config={config}
            currentStats={currentStats}
            account={account}
            now={now}
            busy={busyKey === "create"}
            onCreate={handleCreate}
            onConnectClick={() => setChooserOpen(true)}
          />
          <BalancePanel
            account={account}
            creditedWei={creditedWei}
            nativeWei={nativeWei}
            busy={busyKey === "withdraw"}
            onWithdraw={handleWithdraw}
            onConnectClick={() => setChooserOpen(true)}
          />
        </div>

        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-display text-2xl font-bold text-cream">
              {viewEpoch !== null && viewEpoch === currentEpoch ? "This epoch's board" : `Epoch ${viewEpoch} board`}
            </h2>
            <div className="ml-auto flex items-center gap-2">
              <button
                disabled={viewEpoch === null || viewEpoch <= 0}
                onClick={() => setViewEpoch((e) => Math.max(0, e - 1))}
                className="rounded-full border border-lineSoft px-3 py-1.5 text-sm font-semibold text-sage transition hover:border-line hover:text-cream disabled:opacity-40"
              >
                ← Earlier
              </button>
              <span className="font-mono text-sm text-cream">Epoch {viewEpoch ?? "…"}</span>
              <button
                disabled={viewEpoch === null || currentEpoch === null || viewEpoch >= currentEpoch}
                onClick={() => setViewEpoch((e) => e + 1)}
                className="rounded-full border border-lineSoft px-3 py-1.5 text-sm font-semibold text-sage transition hover:border-line hover:text-cream disabled:opacity-40"
              >
                Later →
              </button>
              <button
                onClick={() => config && currentEpoch !== null && viewEpoch !== null && refreshBoard(config, currentEpoch, viewEpoch)}
                className="rounded-full border border-lineSoft px-3 py-1.5 text-sm font-semibold text-sage transition hover:border-line hover:text-cream"
              >
                Refresh
              </button>
            </div>
          </div>

          <PoolPanel
            stats={stats}
            now={now}
            account={account}
            busy={stats ? busyKey === `roll-${stats.epoch}` : false}
            onRollDust={handleRollDust}
          />

          {goals.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-line bg-pine-900/50 px-6 py-12 text-center">
              <div className="font-display text-xl font-bold text-cream">No goals on this board yet</div>
              <p className="mx-auto mt-2 max-w-md text-sm text-sage">
                {viewEpoch === currentEpoch
                  ? "Be the first to stake on a goal this epoch — the form is on the left."
                  : "Nobody staked a goal in this epoch."}
              </p>
            </div>
          ) : (
            <div className="grid gap-5 md:grid-cols-2">
              {goals.map((g) => (
                <GoalCard
                  key={g.id}
                  goal={g}
                  stats={stats}
                  config={config}
                  account={account}
                  now={now}
                  busyKey={busyKey}
                  onSubmitProof={handleSubmitProof}
                  onAssess={handleAssess}
                  onMarkFailed={handleMarkFailed}
                  onCredit={handleCredit}
                />
              ))}
            </div>
          )}
        </div>
      </main>

      <footer className="mx-auto w-full max-w-7xl px-4 pb-10 sm:px-6">
        <div className="flex flex-wrap items-center gap-2 border-t border-lineSoft pt-4 text-xs text-sage">
          <span>GoalVault contract</span>
          <a
            href={explorerAddressUrl(CONTRACT_ADDRESS)}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-gold-300 underline decoration-gold-600/60 underline-offset-2"
          >
            {CONTRACT_ADDRESS}
          </a>
          <span>· GenLayer Bradbury (chain 4221) · Verdicts by the validator jury under the equivalence principle</span>
        </div>
      </footer>
    </div>
  );
}
