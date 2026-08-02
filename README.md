# Joint Factory

A Bitcoin-native idle game. Build a cannabis production chain from plantation to
factory, collect joints, and play them for real sats in a Lightning lottery drawn
Tuesday, Thursday and Saturday at 21:00 Berlin time.

Login is **Nostr** (NIP-07 extension, nsec import, or a keypair generated in the
browser). No account, no email, no password.

Live at [jointfactory.io](https://jointfactory.io).

---

## How the economy works

Three ideas carry the whole design:

**Output is a bottleneck, not a sum.** The chain produces whatever its slowest
stage manages, so a plantation that outgrows the courier earns nothing extra.

**The two big prices are denominated in production time.** A lottery ticket and a
speed step cost a share of a day of *the buyer's own* output, not a fixed number
of joints. Income grows by orders of magnitude over a month; any fixed price gets
outrun, and a hoard from an earlier era buys the whole ladder outright. Measured
in production time, a beginner and the leader pay the same for the same thing.

**Two currencies, two jobs each.**

| | earned by | spent on |
|---|---|---|
| **Joints** | playing | plot levels, courier and factory capacity, permanent speed, lottery tickets |
| **Sats** | deposits, lottery wins | timed boosts, managers beyond the free three |

Nothing mints sats. Everything credited is backed by a deposit or a pot payout,
tracked in a house ledger (`server/house.js`) and checked hourly.

### The numbers

- **Plot levels** — a level costs joints and adds output; milestones double a
  plot every 10, then 15, then 20 levels, repeating, up to ten doublings. Past
  ×1024 a level still adds output, just not another factor. The multipliers used
  to be ×2/×3/×4 uncapped, which compounds ×24 every 45 levels — a plot at level
  145 carried ×27,600 and one click could quadruple a chain.
- **Managers** — the first three are free for everyone, guests included, so the
  whole chain can be automated without depositing anything. Beyond that: 100,
  150, 200, 250, 300 sats.
- **Speed** — permanent +2 % on the entire chain per step, paid in joints, capped
  at 3.26 days of production per step, which holds growth at roughly +20 % a
  month however large the player gets.
- **Boosts** — Fertilizer (2× grow), Express Run (3× courier), Double Shift
  (2× factory) at 21 sats for 30 min; Full Throttle (2× everything) at 50 sats
  for an hour. Buying an active boost extends it instead of stacking.
- **Lottery** — at most four tickets per player **per draw**, costing 10 / 18 /
  28 / 44 % of a day's output. 80 % of the pot is paid out; the number of winners
  is a third of the entrants, never fewer than two and never more than 21, and
  the pot splits by rank (70/30 for two, 60/25/15 for three, and so on). Odds of
  being drawn first are exactly your share of the tickets. A draw needs two
  players — with one, pot and tickets carry into the next round; with none, the
  pot settles to the house. Every sats spend feeds the pot gross; the cut is
  taken once, at payout.
- **Invites** — every player who signs up through your link appears as a tile in
  your boost card, unlocks once they automate all three stations, and one click
  starts an hour of Full Throttle. Hours stack. No sats involved.

---

## Stack

- **Frontend** React 19 + TypeScript + Vite, mobile-first
- **Backend** Fastify 5 + better-sqlite3, WebSocket for pot and rate updates
- **Shared** `shared/economy.js` and `shared/schedule.js` — plain ESM imported by
  both the browser and Node, so a curve or a draw time exists exactly once
- **Auth** Nostr NIP-07 / NIP-98 signed events, exchanged for a JWT
- **Lightning** LNbits for deposits, withdrawals and payouts
- **Nostr bot** lottery reminders, win notes, profile and NIP-65 relay list
- **Deployment** PM2 behind Caddy on a Hetzner VPS

---

## Development

```bash
npm install
cp .env.example .env      # LNBITS_*, JWT_SECRET, JF_NOSTR_OFFLINE=1

npm run dev:server        # API on 3421
npm run dev               # Vite on 5173, proxies /api and /ws
npm run dev:lan           # same, reachable from other machines
```

Set `JF_NOSTR_OFFLINE=1` locally — without it a dev server posts to the real
relays under the production identity.

To test against real data, pull a snapshot with `sqlite3 … ".backup"` rather than
`cp`: the database runs in WAL mode, and a plain copy is a stale one.

### Checks

The economy is covered by standalone scripts, each against a throwaway database:

```bash
node scripts/test-save-clamp.mjs    # what a client may claim to have earned
node scripts/test-lightning.mjs     # forged webhooks, overreaching payout invoices
node scripts/test-draw.mjs          # winner count, prize ladder, carried rounds
node scripts/test-ticket-price.mjs  # four per draw, beginner vs. leader, eligibility
node scripts/test-speed.mjs         # price curve, atomic deduction, chain-wide effect
node scripts/test-boosts.mjs        # expiry, extension, pot share
node scripts/test-invite.mjs        # locked → unlocked → claimed, no sats
node scripts/test-broadcast.mjs     # owner DMs: dry run, resume, no double send
node scripts/test-ledger.mjs        # every credited sat has a source
node scripts/test-schedule.mjs      # Tue/Thu/Sat 21:00 across DST
node scripts/sim-economy.mjs 30     # 30-day simulation of a greedy player
```

### What the server decides

The client owns its joint count and posts an absolute figure, so the server bounds
it (`saveState` in `server/game.js`): a balance may only grow by what the *stored*
state could have produced in the meantime — including boosts, hand play and a
backlog being drained — minus the cost of any upgrade the incoming state claims
(`progressCost` in `shared/economy.js`). Whatever it decides comes back in the
response and the client adopts it, so a divergence corrects itself within one
save instead of growing. Everything priced in real money is server-side outright:
tickets, speed, boosts, deposits and payouts.

### Data for balancing

`events` records what players decide — signups, sessions, managers, speed steps,
boosts, tickets, deposits, withdrawals, draws, wins, invites. `server/metrics.js`
folds each Berlin day into one row of `daily_stats`; `GET /api/health/metrics`
returns the last n days (owner only, aggregates without npubs).
`scripts/backfill-events.mjs` reconstructs history from the tables that carry
timestamps.

---

## Admin

`/admin` is owner-only and unlisted. It sends one encrypted Nostr DM per player —
dry run first, campaign name typed back to unlock the real send, and a log that
makes a second run resume rather than repeat. `GET /api/health/metrics` and
`/api/health/solvency` answer for the same owner npub.

---

## Deployment

```bash
git push origin main
# on the server:
git pull --ff-only && npm run build && pm2 restart jointfactory
```

`server/db.js` adds missing columns and tables on startup, so a deploy migrates
itself. Back the database up first, outside the working tree — git never touches
it (`data/`, `backups/` and every `*.db` are ignored), which also means it is
yours to lose.

---

## License

Private — all rights reserved.
