# Joint Factory

A Bitcoin-native idle game. Build a cannabis production chain from plantation to
factory, collect joints, and play them for real sats in a Lightning lottery drawn
Tuesday, Thursday and Saturday at 21:00 Berlin time.

Play runs in **rounds**: a round ends at a quadrillion joints — about a week with
managers and a few visits a day — and then you may start over for prestige.

Login is **Nostr** (NIP-07 extension, nsec import, or a keypair generated in the
browser). No account, no email, no password.

Live at [jointfactory.io](https://jointfactory.io).

---

## How the economy works

Four ideas carry the whole design:

**Output is a bottleneck, not a sum.** The chain produces whatever its slowest
stage manages, so a plantation that outgrows the courier earns nothing extra.

**A round ends.** The old curve ran to a quadrillion in 169 days and then went
nowhere; a player at the top had nothing left to do and the numbers had stopped
meaning anything. A round finishes at `ROUND_TARGET` — one quadrillion — and
counting stops there, so the numbers cannot run past the range the game was built
for. Resetting banks a star. Nothing carries over into the next round except what real money
paid for.

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

- **The round** — one quadrillion joints from a standing start of one a second,
  all six plots, MegaFarm included. Measured with `node scripts/tune-pacing.mjs`
  against a player who always buys optimally: 3.7 days round the clock, 8 days at
  eight hours, 14 days at four. Real players are slower. Past the target nothing
  more is counted — the chain keeps running, the round is simply over.
- **Plot levels** — a level costs joints and adds output; milestones double a
  plot every 10, then 15, then 20 levels, repeating, up to ten doublings. A single
  plot stops at level 50: the way on is the next plantation, not more of the same
  one.
- **The first session** — the third plot (Indoor Room, 8 000 joints) has to be
  open inside the first eight hours for someone playing ordinarily, not
  optimally. Miss that and it slips a whole day, because the session is over. It
  costs the round nothing: with inheritance a plot is worth the same whenever it
  opens, so the difference simply goes into capacity instead.
- **Unlocking a plot** — a new plantation opens on **half the highest level you
  already have**. On level 1 it would carry no milestone multiplier and produce a
  rounding error next to a developed plot, which is why the last two plantations
  were unreachable before: levelling an old plot was always the better buy, and
  only 169 days of runway ever got anyone to MegaFarm.
- **Courier and factory** — one upgrade doubles capacity; the next one costs 2.5×
  as much for the first twelve, then 3.4×, then 3.9× past twenty-two. Tune with
  `node scripts/tune-pacing.mjs`, override with `JF_CAP_TIERS=0:2.5,12:3.4,22:3.9`.
- **Managers** — the first three are free for everyone, guests included, so the
  whole chain can be automated without depositing anything. Beyond that the price
  falls with every round finished: **90 sats in the first round, 60 in the
  second, 30 in the third, 21 from the fourth on**. Outdoor, Indoor and
  Hydroponic stop costing anything after the first, second and third round;
  Greenhouse and MegaFarm are bought every round. Staffing a whole chain
  therefore costs 450 sats in round one and 42 from round four.

  They do **not** survive a reset, and that is the point: managers are the one
  recurring sats sink and every sat spent on one goes into the lottery pot.
  Carrying them over would have made the second round free and dried the pot out
  with it. The server prices each hire from the stored state (`managerSpend` in
  `shared/economy.js`) rather than believing what the client reports.
- **Speed** — permanent +5 % on the entire chain per step, paid in joints, capped
  at 3.26 days of production per step, which holds growth at roughly +20 % a
  month however large the player gets.
- **Boosts** — half an hour each: Fertilizer (2× grow), Express Run (3× courier)
  and Double Shift (2× factory) at **10 sats**, Full Throttle (2× everything) at
  **21 sats** — all three at once for about what all three would cost. Buying an
  active boost extends it instead of stacking. Every sat feeds the lottery pot.
- **Lottery** — two things unlock a ticket, and they ask different questions.
  The chain has to be automated on all three stations, because the price is a
  share of production and an idle account would pay the one-joint floor. And at
  least one manager has to have been bought **with sats** in the round being
  played, because every one of those sats goes into the pot being drawn
  (`ticketGate` in `shared/economy.js`). The free quota covers three managers and
  three is exactly what the chain needs, so for a while the gate stood open: a
  chain automated entirely for free could draw from a pot it had never paid into.

  Beyond that: at most four tickets per player **per draw**, costing 10 / 18 /
  28 / 44 % of a day's output — the first one two and a half hours of production,
  the four together exactly one day, whatever the player's rate. There used to be
  a second factor on top, a beginner markup running from 20× at one joint a
  second down to 1× at twenty billion. It was calibrated when a round ended at a
  billion; once the round ended at a quadrillion it spanned that whole range by
  itself, so the ramp stopped telling a newcomer from a veteran and started
  measuring how far into their round somebody was — and managers do not survive a
  reset, so everyone is a beginner again every round. A player at eight thousand
  a second paid 12.8×, which put one draw's four tickets at 12.8 days of
  production inside a seven-day round. What the markup was for is the gate's job
  now. 80 % of the pot is paid out; the number of winners
  is a third of the entrants, never fewer than two and never more than 21, and
  the pot splits by rank (70/30 for two, 60/25/15 for three, and so on). Odds of
  being drawn first are exactly your share of the tickets. A draw needs two
  players — with one, pot and tickets carry into the next round; with none, the
  pot settles to the house. Every sats spend feeds the pot gross; the cut is
  taken once, at payout.
- **Invites** — every player who signs up through your link appears as a tile in
  your boost card, unlocks once they automate all three stations, and one click
  starts half an hour of Full Throttle. They stack. No sats involved.
- **Reset and prestige** — available once the round target is passed, never
  forced. It clears joints, chain and speed; sats are never touched. A reset banks
  exactly one star, because counting stops at the target and there is nothing
  past it to reward. A star is a round. Prestige buys
  no advantage of any kind: every round is the same race, which is what keeps the
  times comparable.
- **One board** — *Standings* under Ranking, top three on a podium: stars for
  rounds finished, the fastest quadrillion the player ever rolled, and the joints
  of the round they are in, which is what it ranks by. It was three tabs listing
  the same twenty people by three numbers, which made the reader click to compare
  facts that fit in one row.
- **The race** — lanes on the Grow page, above the chain they are about. Position
  is progress through the round, but nobody starts at the same moment, so being
  furthest only means having started earliest: the rank and the big number are the
  **projected round time** — time already run plus what is left at the current
  rate. That is the same figure the club records, so the live race and the
  highscore measure one thing. A round that has been won stops its clock.

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
node scripts/test-rounds.mjs        # target detection, reset, prestige, boards
node scripts/test-switch.mjs        # the one-time switch of accounts predating rounds
node scripts/test-schedule.mjs      # Tue/Thu/Sat 21:00 across DST
node scripts/sim-economy.mjs 30     # 30-day simulation of a greedy player
node scripts/tune-pacing.mjs        # how long a round takes, against its criteria
```

`tune-pacing.mjs` exits non-zero when the round misses what it was designed for —
at least three days round the clock, six at four hours a day, all six plots used,
MegaFarm needed to finish, a first upgrade inside a minute of tapping, and the
third plot open inside the first eight-hour session for an ordinary player. Run
it after touching any curve.

### Accounts from before rounds

They are not converted behind their owners' backs. `scripts/migrate-rounds.mjs
--apply` only sets `switch_pending` on every account that existed, which freezes
it: `saveState` refuses, and the client shows a screen stating the trade in both
directions. Confirming credits **three rounds and three stars** — so managers
start at the floor price of 21 sats and three of the plots never cost anything —
and starts round four on a fresh chain. Sats, deposits, invite codes and
referrals are untouched.

There is no deadline. An account that never confirms stays exactly as it is; the
wallet and the info page stay reachable so nobody has to agree to anything to
withdraw their own sats. Bots are reset directly — they cannot press a button.

### What the server decides

The client owns its joint count and posts an absolute figure, so the server bounds
it (`saveState` in `server/game.js`): a balance may only grow by what the *stored*
state could have produced in the meantime — including boosts, hand play and a
backlog being drained — minus the cost of any upgrade the incoming state claims
(`progressCost` in `shared/economy.js`). Whatever it decides comes back in the
response and the client adopts it, so a divergence corrects itself within one
save instead of growing. Everything priced in real money is server-side outright:
tickets, speed, boosts, deposits and payouts.

The switch into rounds is one-way and wipes a chain someone spent weeks on, so a
bare POST must not be enough to fire it: `POST /api/game/switch` refuses anything
that does not carry `{"confirm": true}`. Accounts were seen switching in
development without anyone pressing the button and the cause was never found —
whatever it was, it cannot reach a request that has to say what it means.

### Data for balancing

`events` records what players decide — signups, sessions, plot levels and
capacity (itemised: how many, at what cost), speed steps, boosts, tickets,
managers, deposits, withdrawals, draws, wins, invites, and every correction the
save guard made. `server/metrics.js` folds each Berlin day into one row of
`daily_stats`, including where the joints went and which stage bottlenecks each
chain; `GET /api/health/metrics` returns the last n days (owner only, aggregates
without npubs).

```bash
node scripts/report-decisions.mjs 30   # what players spend on, what limits them,
                                       # who returns, where newcomers stop
node scripts/backfill-events.mjs       # reconstruct history from the older tables
```

The report is built around the five questions a balance change should answer
before it is made: where earned joints go, what holds each chain back, whether
the sats loop turns, who comes back and after how long, and where new players
stop.

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
