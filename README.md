# GoalVault

**Stake GEN on your own public goal. Hit it, and you split the stakes of everyone in your epoch who didn't.**

GoalVault is a commitment staking pool built on a GenLayer Intelligent Contract (Bradbury testnet, chain 4221). You lock GEN behind a goal you set for yourself, publish proof on a public page when you're done, and a GenLayer validator jury reads that page and decides — against the criteria you wrote when you staked — whether you achieved it. Achievers get their own stake back plus an equal share of the failed stakes in the same epoch. No achievers, no payout: the pool rolls forward.

## Live app

**https://goalvault-ameer-hamza-s-projects2.vercel.app**

## Contracts

| | Address |
|---|---|
| Production | `0xa1efCA44DeA5135e3fD86c68155c44C2106166c5` |
| Proof twin | `0x72e21553415eD191D7d3883d63300a4705F01d42` |

## How it works

Time is divided into **epochs** (30 days on production). Inside an epoch:

1. **Create a goal** — `create_goal(title, criteria, deadline_ts)` with at least the minimum stake (0.001 GEN on production). The deadline must sit inside the current epoch, at least the minimum lead time ahead. The contract issues your goal a public proof token (`GV-<goal>-<staker prefix>`).
2. **Publish your proof** — put the proof token on a public web page that shows you met your own criteria, then call `submit_proof(goal_id, proof_url)`. The contract hashes the page content at submission time, so the proof the jury later reads is the proof you filed.
3. **Jury assessment** — anyone can call `assess(goal_id)`. The jury fetches your proof page, checks the token and the evidence against your stated criteria, and records a verdict on-chain: `ACHIEVED` with a reason code, or a not-achieved verdict with its own code.
4. **Epoch finalization** — after the epoch ends and its assessment window closes, the epoch freezes: the failed stakes form the epoch's bonus pool.
5. **Credit & withdraw** — `credit(goal_id)` pays an achiever their stake back plus their share of the frozen failed pool; if the pool can't be divided exactly, the leftover dust can be rolled into the open epoch with `roll_dust(epoch)`. Credited balances are withdrawn with `withdraw()`. A goal nobody assesses in time has a hard exit too: after the assessment window it can be marked failed, so stakes are never stuck.

## Features

- **Self-set criteria, jury-verified** — you write the success criteria when you stake; the jury judges your public proof against exactly that text.
- **Proof binding** — the proof page is content-hashed when filed, so swapping the page after filing doesn't change what gets judged.
- **Epoch pool accounting** — stakes, verdicts and the bonus pool are tracked per epoch; every payout is computed from frozen, on-chain figures.
- **Permissionless assessment and crediting** — anyone can trigger a verdict or a payout once the state allows it; nobody needs the contract owner's help to settle an epoch.
- **No dead ends** — unassessed goals exit through the failed path after the window, and sub-minimum dust rolls into the next epoch instead of stranding.

## Contract methods

Writes: `create_goal`, `submit_proof`, `assess`, `mark_failed`, `credit`, `roll_dust`, `withdraw`

Reads: `get_config`, `get_goal`, `list_goals`, `get_epoch_stats`, `get_balance`

## The dApp

The board in this repo (`src/`) is a Vite + React app that talks to the production contract through genlayer-js: an epoch countdown and pool panel, goal cards with stake / deadline / verdict state, a create-goal form, proof submission, and a balance panel for credits and withdrawals. Every number on the page is read from the chain, and every action calls the contract method of the same name.

## Run it locally

```bash
npm install
npm run dev      # local board
npm run build    # production build to dist/
```

The contract address defaults to production; set `VITE_CONTRACT_ADDRESS` to point the board at another deployment.
