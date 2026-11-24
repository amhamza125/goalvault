// GenLayer client for GoalVault on Bradbury (genlayer-js 2.0.0).
// Reads are walletless against the node RPC (the only endpoint that serves
// gen_call). Writes go through the user's injected wallet after switching
// it to Bradbury.
//
// FEE POLICY (same measured policy as the GrantFlow dApp):
// - Plain writes (create_goal, submit_proof, assess, mark_failed, credit,
//   roll_dust) never emit a payout message — they use baseFees().
// - withdraw() is the ONLY method that emits a native transfer (_pay), so
//   it must carry the external message allocation: recipient = the payee,
//   callKey = CALL_KEY_UNNAMED (32 zero bytes), budget = 0.0012 GEN =
//   exactly 20x (gasLimit 200000 x maxGasPrice 300000000), and
//   feeValue = roundFees + budget. Without the allocation the payout
//   message is emitted but never executes — and a FINISHED_WITH_RETURN
//   receipt does NOT prove a payout; only the recipient's balance does.

import { createClient, encodeExternalMessageFeeParams, MessageType, CALL_KEY_UNNAMED } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";
import { createPublicClient, http, parseAbi } from "viem";
import {
  CHAIN_ID,
  CHAIN_ID_HEX,
  CHAIN_NAME,
  NODE_RPC_URL,
  EXPLORER_URL,
  CONTRACT_ADDRESS,
} from "./config.js";

const FEE_DISTRIBUTION = {
  leaderTimeunitsAllocation: 100n,
  validatorTimeunitsAllocation: 200n,
  appealRounds: 0n,
  executionBudgetPerRound: 25000000000000000n,
  executionConsumed: 0n,
  totalMessageFees: 0n,
  rotations: [3n],
  maxPriceGenPerTimeUnit: 2n,
  storageFeeMaxGasPrice: 300000000n,
  receiptFeeMaxGasPrice: 300000000n,
};
const BASE_FEE_VALUE = 100000000000010352n; // roundFees with zero message budget

const PAYOUT_GAS_LIMIT = 200000n;
const PAYOUT_MAX_GAS_PRICE = 300000000n;
export const PAYOUT_BUDGET = 1200000000000000n; // 0.0012 GEN

const FEE_MANAGER_ABI = parseAbi([
  "function calculateRoundFees((uint256 leaderTimeunitsAllocation, uint256 validatorTimeunitsAllocation, uint256 appealRounds, uint256 executionBudgetPerRound, uint256 executionConsumed, uint256 totalMessageFees, uint256[] rotations, uint256 maxPriceGenPerTimeUnit, uint256 storageFeeMaxGasPrice, uint256 receiptFeeMaxGasPrice) _feesDistribution, uint256 _numOfValidators, uint256 round) view returns (uint256 totalFeesToPay)",
]);

/** Plain fees for calls that never move funds out of the contract. */
export function baseFees() {
  return {
    distribution: { ...FEE_DISTRIBUTION, rotations: [...FEE_DISTRIBUTION.rotations] },
    messageAllocations: [],
    feeValue: BASE_FEE_VALUE,
  };
}

/** Live roundFees from the FeeManager; falls back to the measured constant. */
async function liveRoundFees(totalMessageFees) {
  try {
    const pc = createPublicClient({ chain: testnetBradbury, transport: http(NODE_RPC_URL) });
    const distribution = {
      ...FEE_DISTRIBUTION,
      rotations: [...FEE_DISTRIBUTION.rotations],
      totalMessageFees,
    };
    const roundFees = await pc.readContract({
      address: testnetBradbury.feeManagerContract.address,
      abi: FEE_MANAGER_ABI,
      functionName: "calculateRoundFees",
      args: [distribution, 5n, 0n],
    });
    return BigInt(roundFees);
  } catch {
    return BASE_FEE_VALUE;
  }
}

/** Fees for withdraw() — the one _pay-emitting call. Payee = the caller. */
export async function payoutFees(payee) {
  const roundFees = await liveRoundFees(PAYOUT_BUDGET);
  const feeParams = encodeExternalMessageFeeParams({
    gasLimit: PAYOUT_GAS_LIMIT,
    maxGasPrice: PAYOUT_MAX_GAS_PRICE,
  });
  return {
    distribution: {
      ...FEE_DISTRIBUTION,
      rotations: [...FEE_DISTRIBUTION.rotations],
      totalMessageFees: PAYOUT_BUDGET,
    },
    messageAllocations: [
      {
        messageType: MessageType.External,
        onAcceptance: false,
        parentIndex: (1n << 256n) - 1n, // root
        recipient: payee,
        callKey: CALL_KEY_UNNAMED, // bare transfer: empty calldata -> zero key
        budget: PAYOUT_BUDGET,
        feeParams,
      },
    ],
    feeValue: roundFees + PAYOUT_BUDGET,
  };
}

// --- wallet ---------------------------------------------------------------
// The active EIP-1193 provider, chosen in the connect flow (EIP-6963 or the
// legacy window.ethereum). Writes never assume window.ethereum directly.
let activeProvider = null;
export function setWalletProvider(p) {
  activeProvider = p || null;
}
export function walletProvider() {
  return activeProvider || (typeof window !== "undefined" ? window.ethereum : null);
}

export async function connectWallet(provider) {
  const eth = provider || walletProvider();
  if (!eth) {
    throw new Error("No EVM wallet detected. Install MetaMask or Rabby first.");
  }
  // ORDER MATTERS — accounts FIRST, chain switch second. Some in-app
  // wallet browsers (OKX) silently drop a chain-switch call from a site
  // that is not connected yet, and the promise never settles.
  const accounts = await requestWithTimeout(eth, "eth_requestAccounts", null, "accounts");
  if (!accounts || accounts.length === 0) {
    throw new Error("No accounts authorized in wallet.");
  }
  await switchToBradbury(eth);
  return accounts[0];
}

/** Ask the wallet to switch to Bradbury, adding the chain if unknown. */
async function switchToBradbury(eth) {
  try {
    await requestWithTimeout(eth, "wallet_switchEthereumChain", [{ chainId: CHAIN_ID_HEX }], "chain switch");
  } catch (err) {
    // Standard 4902, plus the wrapped shapes some mobile wallets use for
    // "chain not added yet" — all of them mean: add the chain.
    const code = err && err.code;
    const nestedCode = err && err.data && err.data.originalError && err.data.originalError.code;
    const msg = (err && err.message) || "";
    const chainNotAdded =
      code === 4902 ||
      code === -32603 ||
      nestedCode === 4902 ||
      /unrecognized chain|chain.*not added|4902/i.test(msg);
    if (chainNotAdded) {
      await requestWithTimeout(
        eth,
        "wallet_addEthereumChain",
        [
          {
            chainId: CHAIN_ID_HEX,
            chainName: CHAIN_NAME,
            rpcUrls: [NODE_RPC_URL],
            nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 },
            blockExplorerUrls: [EXPLORER_URL],
          },
        ],
        "add chain"
      );
    } else {
      throw err;
    }
  }
}

/**
 * Network guard for writes. Connecting switches the wallet to Bradbury,
 * but the user can switch networks inside the wallet afterwards — so
 * every write re-checks the live chain first. On the wrong chain the
 * write is blocked: the wallet is prompted to switch, and if it still
 * isn't on Bradbury after that, the write throws before anything is
 * sent. Reads never pass through here and stay available on any chain.
 */
export async function assertBradburyForWrite() {
  const eth = walletProvider();
  if (!eth) {
    throw new Error(`No wallet connected. Connect a wallet on ${CHAIN_NAME} (chain ${CHAIN_ID}) first.`);
  }
  const currentChainId = async () => {
    const id = await requestWithTimeout(eth, "eth_chainId", null, "network check");
    if (typeof id === "number") return `0x${id.toString(16)}`;
    return String(id || "").toLowerCase();
  };
  if ((await currentChainId()) === CHAIN_ID_HEX) return;
  await switchToBradbury(eth);
  if ((await currentChainId()) !== CHAIN_ID_HEX) {
    throw new Error(
      `Your wallet is not on ${CHAIN_NAME} (chain ${CHAIN_ID}). Switch networks in your wallet, then try again — nothing was sent.`
    );
  }
}

// A hung provider request must surface, never hang the tap: every wallet
// call races a timeout with a step-specific error.
function requestWithTimeout(provider, method, params, stepLabel, timeoutMs = 12000) {
  return Promise.race([
    provider.request(params ? { method, params } : { method }),
    new Promise((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              `The wallet did not answer the ${stepLabel} request. No approval appeared — the wallet may be locked, or the request was blocked. Try again.`
            )
          ),
        timeoutMs
      )
    ),
  ]);
}

// --- clients --------------------------------------------------------------
export function readClient() {
  return createClient({ chain: testnetBradbury, endpoint: NODE_RPC_URL });
}

export function writeClient(account) {
  return createClient({ chain: testnetBradbury, account, provider: walletProvider() });
}

// --- reads ----------------------------------------------------------------
// GoalVault views return JSON strings (get_balance returns a bare wei
// string). genlayer-js may hand back the string raw or JSON-quoted —
// parseResult unwraps one quoting layer, parseJson then parses the JSON.
export function parseResult(raw) {
  if (typeof raw !== "string") return raw;
  const s = raw.trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    try {
      return JSON.parse(s);
    } catch {
      return s.slice(1, -1);
    }
  }
  return s;
}

export function parseJson(raw) {
  const s = parseResult(raw);
  if (typeof s !== "string") return s;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export async function readView(functionName, args = []) {
  const client = readClient();
  return client.readContract({ address: CONTRACT_ADDRESS, functionName, args });
}

export async function readJsonView(functionName, args = []) {
  return parseJson(await readView(functionName, args));
}

export async function getConfig() {
  return readJsonView("get_config", []);
}

export async function getEpochStats(epoch) {
  return readJsonView("get_epoch_stats", [BigInt(epoch)]);
}

export async function listGoals(epoch, offset = 0, limit = 100) {
  const v = await readJsonView("list_goals", [BigInt(epoch), BigInt(offset), BigInt(limit)]);
  return Array.isArray(v) ? v : [];
}

export async function getGoal(goalId) {
  return readJsonView("get_goal", [BigInt(goalId)]);
}

/** GEN credited to this address inside the contract (wei, BigInt). */
export async function getCreditedBalance(address) {
  const v = parseResult(await readView("get_balance", [address]));
  try {
    return BigInt(v ?? "0");
  } catch {
    return 0n;
  }
}

/** The wallet's native GEN balance (wei, BigInt) via the node RPC. */
export async function ethBalance(address) {
  const r = await fetch(NODE_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [address, "latest"] }),
  });
  const j = await r.json();
  if (typeof j.result !== "string") throw new Error("eth_getBalance failed");
  return BigInt(j.result);
}

// --- writes ---------------------------------------------------------------
/**
 * Send a write and wait for FINALIZED consensus.
 * `fees` must be payoutFees(payee) for withdraw(), baseFees() otherwise.
 * `opts.onHash` fires with the tx hash as soon as the wallet returns it,
 * before the receipt wait, so the UI can show the explorer link while
 * consensus runs (an assess takes minutes).
 * Resolves with { hash, receipt }; receipt.execName is the execution
 * outcome (FINISHED_WITH_RETURN / FINISHED_WITH_ERROR), receipt.statusName
 * the consensus status. A receipt-poll timeout does not fail the flow —
 * the hash stays usable in the explorer.
 */
export async function sendWrite(account, functionName, args = [], value = 0n, fees = null, opts = {}) {
  // Every write in the app funnels through here (create_goal,
  // submit_proof, assess, mark_failed, credit, roll_dust, withdraw) —
  // the Bradbury network guard lives at this single choke point.
  await assertBradburyForWrite();
  const client = writeClient(account);
  const hash = await client.writeContract({
    address: CONTRACT_ADDRESS,
    functionName,
    args,
    value,
    fees: fees || baseFees(),
  });
  if (typeof opts.onHash === "function") {
    try {
      opts.onHash(hash);
    } catch {
      // A progress hook must never break the write.
    }
  }
  let receipt = null;
  try {
    receipt = await client.waitForTransactionReceipt({
      hash,
      waitUntil: "finalized",
      retries: 360,
      interval: 5000,
    });
  } catch {
    // Receipt polling can time out on slow consensus; the tx hash is
    // still usable in the explorer.
  }
  if (receipt) {
    receipt.execName = receipt.txExecutionResultName || receipt.execName || null;
    receipt.statusName = receipt.statusName || receipt.status_name || null;
  }
  return { hash, receipt };
}

export function friendlyError(err) {
  const msg = (err && (err.shortMessage || err.message)) || "Transaction failed.";
  return msg.length > 220 ? msg.slice(0, 220) + "…" : msg;
}

export { CONTRACT_ADDRESS };
