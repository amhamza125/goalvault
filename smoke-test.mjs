// Live READ smoke test for the GoalVault dApp against production.
// Contract: 0xa1efCA44DeA5135e3fD86c68155c44C2106166c5 (Bradbury, chain 4221)
// Reads only — no wallet, no writes. Uses the same calls the page makes:
// get_config, get_epoch_stats(0), list_goals(0) — and asserts goal 1 is
// there with the fields the UI renders.
import { createClient } from "genlayer-js";
import { testnetBradbury } from "genlayer-js/chains";

const ADDR = "0xa1efCA44DeA5135e3fD86c68155c44C2106166c5";
const client = createClient({ chain: testnetBradbury, endpoint: "https://rpc-bradbury.genlayer.com" });

function parse(raw) {
  let s = raw;
  if (typeof s === "string") {
    const t = s.trim();
    if (t.startsWith('"') && t.endsWith('"')) {
      try {
        s = JSON.parse(t);
      } catch {
        s = t.slice(1, -1);
      }
    }
  }
  if (typeof s === "string") {
    try {
      return JSON.parse(s);
    } catch {
      return s;
    }
  }
  return s;
}

let fail = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
  if (!ok) fail++;
};

const cfg = parse(await client.readContract({ address: ADDR, functionName: "get_config", args: [] }));
console.log("get_config:", JSON.stringify(cfg));
check("config has genesis + durations", !!cfg && Number(cfg.epoch_duration) === 2592000 && Number(cfg.grace) === 86400, `epoch_duration=${cfg?.epoch_duration} grace=${cfg?.grace} assess_window=${cfg?.assess_window} min_lead=${cfg?.min_lead}`);
check("config min_stake is 0.001 GEN", cfg && cfg.min_stake === "1000000000000000", `min_stake=${cfg?.min_stake}`);
check("config next_goal_id >= 2", !!cfg && Number(cfg.next_goal_id) >= 2, `next_goal_id=${cfg?.next_goal_id}`);

const stats = parse(await client.readContract({ address: ADDR, functionName: "get_epoch_stats", args: [0n] }));
console.log("get_epoch_stats(0):", JSON.stringify(stats));
check("epoch 0 stats present", !!stats && stats.epoch === "0", `epoch=${stats?.epoch}`);
check("epoch 0 has goal 1 in ids", !!stats && Array.isArray(stats.ids) && stats.ids.includes("1"), `ids=${JSON.stringify(stats?.ids)}`);
check("epoch 0 unsettled stake is goal 1's 0.001 GEN", !!stats && stats.unsettled_stake === "1000000000000000", `unsettled_stake=${stats?.unsettled_stake}`);

const goals = parse(await client.readContract({ address: ADDR, functionName: "list_goals", args: [0n, 0n, 100n] }));
console.log("list_goals(0):", JSON.stringify(goals, null, 2));
const g1 = Array.isArray(goals) ? goals.find((g) => g.id === "1") : null;
check("list_goals(0) returns goal 1", !!g1, g1 ? `title="${g1.title}" status=${g1.status}` : "goal 1 missing");
if (g1) {
  check("goal 1 is ACTIVE with 0.001 GEN stake", g1.status === "ACTIVE" && g1.stake === "1000000000000000", `status=${g1.status} stake=${g1.stake}`);
  check("goal 1 carries its proof token", typeof g1.token === "string" && g1.token.startsWith("GV-1-"), `token=${g1.token}`);
  check("goal 1 deadline inside epoch 0", Number(g1.deadline) > Number(stats.epoch_start) && Number(g1.deadline) <= Number(stats.epoch_end), `deadline=${g1.deadline}`);
}

console.log(fail ? `\n${fail} check(s) FAILED` : "\nAll smoke checks passed");
process.exit(fail ? 1 : 0);
