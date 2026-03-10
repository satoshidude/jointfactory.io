# Joint Factory

A Bitcoin-native idle game with Lightning Network integration. Build a cannabis production chain from plantation to factory, collect joints, and win sats in hourly Lightning lotteries.

---

## Concept

Joint Factory is a browser-based idle/clicker game inspired by Cookie Clicker — with a Bitcoin/Lightning twist. Players grow cannabis on plantations, send a courier to the factory, and roll joints. Joints are the in-game currency for upgrades and lottery tickets. Real sats flow in and out via Lightning Network.

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
- Multiple plantation types unlockable (Outdoor, Indoor, Hydroponic, Greenhouse XXL)
- Each plantation has its own level, production rate, and cycle time
- Manual "Grow" button or hire a manager for automation
- Level upgrades (joints) and speed upgrades (sats)

### Courier
- Animated courier figure walking between plantation and factory
- Visual track with Cannabis and Factory endpoint icons
- Capacity and speed upgrades
- Auto-courier manager available (costs sats)

### Joint Factory
- Batch conversion: cannabis -> joints over a timed cycle
- Vape smoke effect when cycle completes, green pulse animation
- Capacity and speed upgrades
- Auto-roller manager available (costs sats)
- Stats: stock, batch rate, speed, all-time production

### Lightning Lottery
- Hourly draws with dynamic ticket pricing (dips and peaks)
- Up to 21 participants per round
- Manager purchases (sats) feed into the prize pool
- 50% of sat revenue paid out to the winner via Lightning
- Buy tickets from the header widget or the dedicated lottery page
- Full draw history and pot history charts

### Leaderboard
- Global player rankings by total joints earned
- Nostr profile display (name, npub)

### Two Currencies
- **Joints** (in-game): earned by playing, used for upgrades + lottery tickets
- **Satoshis** (real BTC): deposited via Lightning, used exclusively for managers/automation

### Nostr Login & Wallet
- Login via NIP-07 extension (Alby, nos2x, Flamingo), nsec import, or new keypair generation
- 80 sats welcome bonus on first login
- Guest mode: full gameplay, upgrade buttons show "Auto — Login" hints
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
- [ ] More plantation types and unlock progression
- [ ] Prestige system / rebirth
- [ ] Achievements & milestones
- [ ] Production multipliers and boosts
- [ ] Seasonal events / special rounds

### Lightning & Sats
- [ ] Production-ready withdraw endpoint testing
- [ ] Sats as premium currency for special upgrades
- [ ] Lottery history page for completed rounds

### Tech
- [ ] WebSocket for real-time updates (lottery countdown, winner notifications)
- [ ] Mobile layout (tab nav, touch events)
- [ ] Rate limiting on API endpoints
- [ ] Admin dashboard (manage rounds, player stats)
- [ ] Automated deployment via GitHub Actions

### UX
- [ ] Onboarding tutorial for new players
- [ ] Winner notification via Nostr DM
- [ ] Lottery result toast with confetti
- [ ] Leaderboard with zap tracking

---

## Setup

```bash
# Install dependencies
npm install

# Create .env
cp .env.example .env
# Set LNBITS_URL, LNBITS_API_KEY, JWT_SECRET

# Start production server
npm start

# Dev mode (Vite + hot reload)
npm run dev
```

Caddy reverse proxy on port 3000, PM2 for process management.

---

## License

Private — all rights reserved.
