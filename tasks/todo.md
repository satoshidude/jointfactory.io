# Spiellogik-Überholung — Umsetzung

Plan: `~/.claude/plans/sorted-percolating-metcalfe.md`
Branch: `dev/mobile`

## Phase 0 — Fundament: gemeinsame Ökonomie-Quelle
- [x] `shared/economy.js` anlegen (Kurven, Formeln, Durchsatz, Boosts, Prestige)
- [x] `scripts/sim-economy.mjs` — Balance-Simulation als Tuning-Werkzeug
- [ ] `tsconfig.app.json` + `vite.config.ts` für `shared/` öffnen
- [ ] `useGameLoop.ts` auf `shared/economy.js` umstellen (Re-Exports für bestehende Importpfade)
- [ ] `throughput()` ersetzt `totalJointsPerSec()` — echter Bottleneck statt Plantagen-Rate
- [ ] `countManagers`-Duplikate in `server/game.js` + `server/index.js` durch shared ersetzen
- [x] `rehydrate()` — Def-Daten (name/icon/upgMult/…) beim Laden aus PLANTATION_DEFS
      überschreiben statt aus dem Save zu lesen
- [ ] `rehydrate()` in Client- und Server-Ladepfad einhängen

## Zusatz — Ziehungsplan (Nutzerwunsch 2026-07-27)
- [x] `shared/schedule.js` — Di/Do/Sa 21:00 Berlin, DST- und jahresgrenzenfest
- [x] `server/db.js` nutzt das Modul, Zeitlogik aus der DB-Datei gelöst
- [x] `scripts/test-schedule.mjs` — 11 Checks, alle grün
- [x] `fmtCountdown`/`fmtDrawTime` in `src/lib/format.ts` (4 Duplikate entfernt),
      Countdown zeigt jetzt Tage, Ziehungszeit den Wochentag
- [x] Texte „6 draws daily" → „Tue · Thu · Sat, 21:00"

## Phase 1 — Onboarding-Paywall entfernen
- [ ] 3 Manager gratis statt 2 (Client + Server)
- [ ] 21 Sats Startguthaben in `server/auth.js`

## Phase 2 — Sats-Sink wiederkehrend machen
- [ ] Tabelle `active_boosts` + Migration in `server/db.js`
- [ ] `POST /api/game/boost` (atomarer Abzug + 80 % Pot)
- [ ] Boosts in `GET /api/game/state` ausliefern
- [ ] Client wendet Boosts im Loop an
- [ ] Speed-Upgrades neu skalieren (60 Level, 1×→3×, 21–210 Sats)

## Phase 3 — Joints-Sink an Produktion koppeln
- [ ] `ticketPrice(n, jps)` in shared, `server/lottery.js` umstellen
- [ ] `/api/lottery/current` + Preview auf neue Preise
- [ ] Hartcodierte Kurvenkopie in `server/zap.js:451` entfernen

## Phase 4 — Kurve senken + Prestige
- [ ] `upgMult` 1.28 → 1.12
- [ ] `prestige_seeds` / `season_joints_earned` Spalten
- [ ] `POST /api/game/prestige` (serverautoritativ, resettet nur Joint-Gekauftes)
- [ ] Prestige-Multiplikator im Produktionspfad

## Phase 5 — Season-Reset, Bots, Deckung
- [ ] `is_bot` Spalte + dedizierte Bot-Accounts
- [ ] `FAKE_PLAYERS` umstellen, Bot-Gewinne zurück in den Pot
- [ ] `is_bot`-Filter in Leaderboard / rate-log / Nostr-Report
- [ ] `house_sats` Ledger aus dem 20 %-Cut
- [ ] Pot-Seeding + Startguthaben aus dem Ledger buchen
- [ ] Solvenz-Check im Cron
- [ ] Season-Reset-Migration inkl. Legacy-Bonus (erst nach lokaler Verifikation)

## Phase 6 — Server-Autorität für Joints
- [ ] Joints-Zuwachs gegen `serverJps × elapsed × 1.5` klemmen
- [ ] Offline-Simulation auf 24 h deckeln, `_ts` gegen `last_seen_at` klemmen

## Verifikation
- [ ] `scripts/sim-economy.mjs` — Kurven über 30 Tage durchrechnen
- [ ] Lokaler Server + DB-Kopie (Vite-Proxy zeigt aktuell auf **Produktion**!)
- [ ] Neuer Account bis zum ersten Ticket ohne Deposit
- [ ] Durchsatz-Check, Bot-Check, Cheat-Check

## Review
_(wird am Ende gefüllt)_
