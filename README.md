# Joint Factory

A Bitcoin-native idle game with Lightning Network integration. Build a cannabis production chain from plantation to factory, collect joints, and win sats in the Lightning lottery — drawn Tuesday, Thursday and Saturday at 21:00 Berlin time.

---

## Concept

Joint Factory is a browser-based idle/clicker game inspired by Cookie Clicker — with a Bitcoin/Lightning twist. Players grow cannabis on plantations, send a courier to the factory, and roll joints. Joints are the in-game currency for upgrades, permanent speed and lottery tickets. Real sats flow in and out via Lightning Network.

Output is a **bottleneck**, not a sum: the chain produces whatever its slowest stage manages, so a plantation that outgrows the courier earns nothing extra.

Two prices are denominated in **seconds of the buyer's own production** rather than in absolute joints — lottery tickets and speed steps. That is what keeps them meaningful as income grows by orders of magnitude, and it means a beginner and the leader pay the same share of a day's work for the same thing.

Authentication is handled via **Nostr** (NIP-07 browser extension, nsec import, or generate a new keypair in-browser). No account, no email, no password.

---

## Stack

- **Frontend:** React 19 + TypeScript + Vite + Tailwind CSS
- **Backend:** Fastify + better-sqlite3
- **Auth:** Nostr NIP-07 + NIP-98 (signed events as JWT)
- **Lightning:** LNbits for deposits, withdrawals & lottery payouts
- **Design:** 80s retro neon theme (dark/light mode) with Press Start 2P, Space Mono & Permanent Marker fonts
- **Deployment:** PM2 + Caddy reverse proxy on Hetzner VPS

---

## Features

### Game Loop
- Three-station production chain: Plantations -> Courier -> Joint Factory
- Real-time game loop at ~30fps with smooth interpolation
- Immediate UI feedback on every action click (flush mechanism)
- Game state persisted to localStorage with server sync

### Plantations
- Six plots, unlocked in order (Balcony, Outdoor, Indoor, Hydroponic, Greenhouse, MegaFarm)
- Each plot has its own level, production rate and cycle time
- Levels cost joints; every tenth level hits a milestone that multiplies that plot
- Manual "Grow" button or a manager for automation

### Courier
- Animated courier figure walking between plantation and factory
- Capacity upgrades (joints) — a courier that under-delivers starves the factory
- The factory card names the bottleneck when that happens

### Joint Factory
- Batch conversion: cannabis -> joints over a timed cycle
- Vape smoke effect when a cycle completes, green pulse animation
- Capacity upgrades (joints)
- Stats: stock ready to roll, batch size, queued batches

### Managers
- The first three are free for everyone, guests included — the whole chain can be
  automated without depositing anything
- Beyond that: 100, 150, 200, 250, 300 sats, all of it into the lottery pot

### Speed
- Permanent +2 % on the entire chain per step, bought with joints, never expires
- Priced in seconds of the buyer's own production, capped at 3.26 days per step,
  which holds the ceiling at roughly +20 % per month
- Each step raises the rate the next step is priced against

### Boosts
- Timed multipliers bought with sats — the recurring sink that keeps the pot fed
- Fertilizer 2x grow, Express Run 3x courier, Double Shift 2x factory: 21 sats / 30 min
- Full Throttle 2x everything: 50 sats / 60 min
- Buying an active boost extends it rather than stacking a second multiplier

### Lightning Lottery
- Draws Tue, Thu & Sat at 21:00 Berlin (DST-safe), announced on Nostr an hour ahead
- Tickets cost joints, at most four per player per day, priced as a share of a day
  of that player's own production (15 / 22 / 28 / 35 %)
- Every sats spend — managers, boosts — feeds the pot gross; the house cut is
  taken once, at payout
- 80 % of the pot is paid out via Lightning, split among up to a third of the
  round's participants, capped at 21 winners
- Unclaimed pots roll over into the next round
- Full draw history and pot history charts

### Invites
- Every player who signs up through your link appears as a tile in your boost card
- The tile unlocks once they automate all three stations; one click starts an hour
  of Full Throttle. Several buddies stack as duration
- No sats change hands, and no deposit is involved on either side

### Leaderboard
- Global player rankings by total joints earned
- Speed level shown per player; the growth chart marks stretches with a boost running
- Nostr profile display (name, npub)

### Two Currencies
- **Joints** (in-game): earned by playing — plot levels, courier and factory
  capacity, permanent speed, lottery tickets
- **Satoshis** (real BTC): deposited via Lightning — boosts and managers beyond
  the free three. Won back through the lottery, withdrawable at any time

### Nostr Login & Wallet
- Login via NIP-07 extension (Alby, nos2x, Flamingo), nsec import, or new keypair generation
- No free sats: everything credited is backed by a deposit or a pot payout,
  tracked in a house ledger (`server/house.js`)
- Guest mode: full gameplay including all three free managers
- Sats balance in header with deposit/withdraw buttons
- Lightning invoice deposits via LNbits
- Withdrawals to your Lightning address

### UI & Theme
- 80s retro dark theme with warm earthy tones and neon accents
- Light theme alternative
- Consistent card header styling with Permanent Marker display font
- Color-coded stations: green (plantations), purple (factory), flamingo (courier), gold (lottery)
- Bitcoin orange auto-manager badges
- Responsive sidebar navigation

### Save System
- localStorage for instant offline access
- Server sync on every upgrade and every 30s auto-save
- Beacon save on page close
- Full session cleanup on logout for clean multi-account switching

---

## TODO

### Gameplay
- [ ] Achievements & milestones
- [ ] Seasonal events / special rounds
- [x] Production multipliers and boosts
- [x] A scaling joints sink (speed) — replaced the rejected prestige/seed design

### Lightning & Sats
- [ ] Production-ready withdraw endpoint testing
- [x] House ledger backing every credited sat
- [x] Lottery history page for completed rounds

### Tech
- [ ] Admin dashboard (manage rounds, player stats)
- [ ] Automated deployment via GitHub Actions
- [x] WebSocket for real-time updates (lottery countdown, pot, winner notifications)
- [ ] Mobile layout (tab nav, touch events) — in progress on `dev/mobile`
- [x] Rate limiting on API endpoints

### UX
- [ ] Onboarding tutorial for new players
- [ ] Lottery result toast with confetti
- [x] Winner notification via Nostr
- [ ] Leaderboard with zap tracking

---

## Setup

```bash
# Install dependencies
npm install

# Create .env
cp .env.example .env
# Set LNBITS_URL, LNBITS_API_KEY, JWT_SECRET
# Local dev: set JF_NOSTR_OFFLINE=1 so the bot never posts under the live identity

# Start production server
npm start

# Dev mode: API on 3421, Vite on 5173 with /api and /ws proxied
npm run dev:server
npm run dev
npm run dev:lan      # same, reachable from other machines on the LAN
```

Caddy reverse proxy, PM2 for process management.

### Checks

The economy is covered by standalone scripts, each against a throwaway database:

```bash
node scripts/test-speed.mjs         # price curve, atomic deduction, chain-wide effect
node scripts/test-ticket-price.mjs  # four a day, beginner vs. leader
node scripts/test-draw.mjs          # winner quota, payout split, rollover
node scripts/test-boosts.mjs        # expiry, extension, pot share
node scripts/test-invite.mjs        # locked -> unlocked -> claimed, no sats
node scripts/test-ledger.mjs        # every credited sat has a source
node scripts/test-schedule.mjs      # Tue/Thu/Sat 21:00 across DST
node scripts/sim-economy.mjs 30     # 30-day simulation of a greedy player
```

---

## License

Private — all rights reserved.
