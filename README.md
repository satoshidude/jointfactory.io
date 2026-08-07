# Joint Factory

A Bitcoin-native idle game. Build a cannabis production chain from plantation to
factory, collect joints, and play them for real sats in a Lightning lottery drawn
Tuesday, Thursday and Saturday at 21:00 Berlin time.

Play runs in **rounds**: a round ends at a quadrillion joints — about a week with
managers and a few visits a day — and then you may start over for a star.

Login is **Nostr** (NIP-07 extension, nsec import, or a keypair generated in the
browser). No account, no email, no password.

Live at [jointfactory.io](https://jointfactory.io).

---

## How the economy works

Four ideas carry the design. Every number that implements them lives in
[`shared/economy.js`](shared/economy.js), commented with the reasoning; this is
the summary, not the reference.

**Output is a bottleneck, not a sum.** The chain produces whatever its slowest
stage manages, so a plantation that outgrows the courier earns nothing extra.

**A round ends.** Counting stops at `ROUND_TARGET`, so the numbers cannot run
past the range the game was built for. Resetting banks a star and clears joints,
chain and speed. Prestige buys no advantage of any kind — every round is the same
race, which is what keeps the times comparable.

**The two big prices are denominated in production time.** A lottery ticket and a
speed step cost a share of a day of *the buyer's own* output. Income grows by
orders of magnitude over a round; any fixed price gets outrun, and a hoard from
an earlier era buys the whole ladder outright.

**Two currencies, two jobs each.**

| | earned by | spent on |
|---|---|---|
| **Joints** | playing | plot levels, courier and factory capacity, speed, lottery tickets |
| **Sats** | deposits, lottery wins | timed boosts, managers beyond the free three |

Nothing mints sats. Everything credited is backed by a deposit or a pot payout,
tracked in a house ledger (`server/house.js`) and checked hourly. The pot is
exactly what players spent on boosts and managers, gross; the house cut is taken
once, at payout.

A ticket needs two things: the chain automated on all three stations, and sats
put into the pot during the round — a boost or a manager, either one.

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

Every rule the economy relies on has a script, each against a throwaway database:

```bash
for f in scripts/test-*.mjs; do node "$f" || break; done
node scripts/tune-pacing.mjs        # how long a round takes, against its criteria
node scripts/sim-economy.mjs 30     # 30-day simulation of a greedy player
node scripts/report-decisions.mjs 30  # what players spend on, what limits them
```

`tune-pacing.mjs` exits non-zero when the round misses what it was designed for —
length at three play intensities, all six plots used, MegaFarm needed to finish,
a first upgrade inside a minute, the third plot inside the first session. Run it
after touching any curve.

---

## What the server decides

Everything priced in real money is server-side outright: tickets, speed, boosts,
managers, deposits and payouts. Three rules carry the rest.

**The client's balance is bounded, not believed.** It posts an absolute figure;
`saveState` in `server/game.js` allows only what the *stored* state could have
produced since the last save, minus the cost of any upgrade the incoming state
claims. Whatever the server decides comes back in the response and the client
adopts it, so a divergence corrects itself within one save instead of growing.

**One client at a time.** Two clients on one account both simulate and both
write; the guard then clamps each against what the other stored, and an upgrade
bought in one is invisible to the other, which buys it again. The newest page
load owns the account (`server/session.js`); older ones are refused before the
guard runs and freeze with a bar offering to take it back.

**Irreversible things have to say so.** `POST /api/game/switch` — the one-way
move of a pre-rounds account into the round economy — refuses any request that
does not carry `{"confirm": true}`.

`events` records what players decide, down to the itemised cost of every purchase
and every correction the guard made; `server/metrics.js` folds each Berlin day
into `daily_stats`. Both feed `report-decisions.mjs` and the owner-only
`GET /api/health/metrics`.

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
