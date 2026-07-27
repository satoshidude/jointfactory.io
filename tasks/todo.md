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

## Phase 1 — Gast-Onboarding (Entscheidungen 2026-07-27)

**Befund:** Der dritte Manager verlangt `isLoggedIn && totalDeposited >= 50` —
eine echte Lightning-Einzahlung. Die Lotterie verlangt 3 Manager. Damit hängt die
gesamte Belohnungsschleife an einer Einzahlung, **und die Registrierung selbst
schaltet nichts frei** — der Funnel hat eine Stufe ohne Gegenleistung.

**Zielmodell — drei Stufen, jede mit eigener Gegenleistung:**

| Stufe | Bekommt |
|---|---|
| Gast | Volle Kette mit 3 Gratis-Managern, läuft automatisch. Fortschritt in localStorage. Sieht Pot, Countdown, Leaderboard. |
| Angemeldet | + Lose kaufen (kosten **Joints**), + Leaderboard-Eintrag, + geräteübergreifend, + Invite-Links |
| Eingezahlt | + Sats für Boosts/Speed, + Auszahlung |

Einzahlung ist für nichts mehr zwingend, nur noch Beschleuniger.

**Sats-Regel: keine geschenkten Sats.** Sats gelangen ausschließlich über eine
echte Einzahlung oder einen Lotteriegewinn in ein Spielerguthaben. Kein
Startzuschuss, kein Anmeldebonus. Der freie Weg in die Belohnungsschleife läuft
über Joints: spielen → Joints → Los kaufen → ggf. Sats gewinnen. Damit erübrigt
sich auch die Faucet-Absicherung — es gibt nichts abzuschöpfen.

### Umsetzung — erledigt 2026-07-27
- [x] `FREE_MANAGERS = 3` aus `shared/economy.js` statt hartcodierter `2`
- [x] `totalDeposited >= 50`-Gate ersatzlos raus (3 Komponenten, je 2 Zweige)
- [x] `totalDeposited`-Prop aus `StationCard`/`MobileGame` entfernt
- [x] Gäste sehen ab dem 4. Manager „Log in" statt eines toten Sats-Buttons —
      ein Gast kann nie Sats bekommen, der Button wäre eine Sackgasse
- [x] `server/auth.js:70` unverändert bei `sats = 0`
- [x] Vierte Kopie der Manager-Zählung in `MobileGame.tsx` durch
      `countLotteryManagers` ersetzt; `server/index.js` nutzt dieselbe Funktion

### Dabei gefunden und behoben: Sats-Abzug lief ins Leere
`server/game.js:44` zog Sats nur ab, wenn `countManagers(gameState) >= 3` —
gezählt wurden aber nur Plantage #1, Kurier und Fabrik. Wer die Kette noch nicht
komplett automatisiert hatte, bekam **jeden Sats-Kauf geschenkt**: Speed-Level
und bezahlte Manager landeten im Spielstand, das Guthaben blieb unberührt.
Empirisch gegen eine DB-Kopie nachgewiesen (`probe.mjs`: 1000 Sats vorher,
1000 Sats nachher, speedLevel 7 gespeichert), nach dem Fix korrekt 1000 → 900.
Der Abzug ist jetzt bedingungslos und atomar; das Gate schützte nichts, denn ein
zu hoch gemeldeter Betrag kostet nur den Spieler selbst.

### Zielhinweise — erledigt
- [x] `src/game/objectives.ts` mit `nextObjective(state, isLoggedIn, canAfford)`
- [x] `.mgp-objective` über beiden Spalten, `grid-column: 1 / -1`
- [x] Verifiziert: frischer Gast → „Tippe auf Grow" → nach dem Klick
      „Schick den Kurier los" 

### Zielhinweise (`src/game/objectives.ts`, reine Funktion)
- [ ] `nextObjective(state, auth)` → eine Zeile über der Kette:
      kein Cannabis → „Tippe Grow" · Cannabis liegt → „Schick den Kurier"
      · Weed an der Fabrik → „Roll die Joints" · < 3 Manager → „Stell einen
      Manager ein" · 3 Manager + nicht angemeldet → „Melde dich an und spiel um
      echte Sats" · genug Joints → „Du kannst ein Los kaufen" · sonst `null`
- [ ] Kein Overlay, kein Klickzwang; verschwindet dauerhaft nach dem ersten Los
- [ ] Tote Buttons: gesperrte Zustände nennen die Bedingung, nicht „Deposit"

### Folge der Sats-Regel: der Pot braucht eine gedeckte Quelle
Ohne Startzuschuss kann ein Spieler ohne Einzahlung nur über einen Lotteriegewinn
an Sats kommen. Der Pot speist sich aber aus 80 % der Sats-Ausgaben — eine Kohorte
ohne Einzahlungen erzeugt also einen 0-Sats-Pot und gewinnt nichts. Zwei Quellen
bleiben, beide gedeckt:

1. **Echte Einzahlungen** anderer Spieler (über Boosts in den Pot)
2. **House-Ledger-Seeding** aus dem 20-%-Cut (historisch ~4.900 Sats) — das ist
   kein Geschenk an Spieler, sondern Rückführung des Hauseinbehalts; gewonnen
   werden muss er trotzdem. Ersetzt das heutige Seeding aus dem Nichts (8/12/21
   Sats pro Runde). Steht in Phase 5.

### Weitere Stelle, die gegen die Sats-Regel verstößt
`server/auth.js:101` schöpft 20 Sats für den Werber, sobald ein Geworbener 50+
Sats einzahlt — ebenfalls aus dem Nichts. Sollte aus dem House-Ledger gebucht
werden statt gemintet. Nicht Teil von Phase 1, gehört zu Phase 5.

## Phase 2 — Sats-Sink wiederkehrend machen — erledigt 2026-07-27
- [x] Tabelle `active_boosts` (PK npub+type) in `server/db.js`
- [x] `server/boosts.js` — atomarer Abzug, Pot-Gutschrift, Verlängerung statt
      Stapelung; Ablauf liegt serverseitig
- [x] `POST /api/game/boost`, Boosts in `GET /api/game/state`
- [x] Client wendet die Multiplikatoren im Loop an (Plantage, Kurier, Fabrik)
- [x] `BoostBar` in der Spielseite, für Gäste gesperrt
- [x] `scripts/test-boosts.mjs` — 15 Checks
- [ ] **Speed-Upgrades verschoben zu Phase 5.** Die neue Kurve (60 Level, 1×→3×)
      würde bestehende `speedLevel`-Werte auf der neuen Skala interpretieren:
      das höchste Einzellevel (11) spränge von 1,08× auf 1,37× — ein stiller
      Buff mitten in der Season. Gehört zum Season-Reset, wo
      `migrateSpeedLevel()` atomar umrechnet.

### Dabei gefunden und behoben
- **Hausanteil wurde doppelt abgezogen.** Sats-Ausgaben flossen bereits um 20 %
  gekürzt in `total_sats_collected`, die Ziehung nahm nochmals 20 % — beworben
  sind 80 %, zurück kamen 57–64 %. Jetzt fließt der Bruttobetrag in den Pot, der
  Schnitt fällt einmal bei der Auszahlung. Die 0.8 lag an sechs Stellen
  hartcodiert; jetzt `POT_PAYOUT_SHARE` / `potPayout()` in `shared/economy.js`.
- **WebSocket zeigte auf Port 3420**, der Server läuft auf 3421 — in sechs
  Dateien kopiert. Live-Updates funktionierten lokal nie. Jetzt `wsUrl()` in
  `src/lib/api.ts` über den Vite-Proxy.
- **Stationskarten zeigten ungeboostete Raten**, während der Loop bereits
  geboostet produzierte. Karten bekommen die Boosts und rechnen mit.
- `courierTripTime`/`fabrikCycleTime` doppelt vorhanden — `useGameLoop`
  re-exportiert jetzt die gemeinsame Version.

### Phase-0-Rest miterledigt
- [x] `totalJointsPerSec` nutzt `throughput()` — echter Bottleneck statt
      Plantagensumme, Boosts eingerechnet. Verifiziert: Testspieler mit
      Plantagenrate 225/s meldet 2,5/s, weil der Kurier (Kapazität 20 / 8 s)
      der Flaschenhals ist. Vorher hätte dort 225/s gestanden.

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

## Lokale Testumgebung
- [x] DB-Snapshot von der VPS nach `data/jointfactory.db` (gitignored)
- [x] `.env.example` + lokale `.env`, `JF_NOSTR_OFFLINE=1` gegen Relay-Posts
- [x] Vite-Proxy auf `localhost:3421` (vorher: Produktion)
- [x] Lokaler Server startet gegen die Kopie, Ziehungslabel korrekt

Start: `npm run dev:server` (API 3421) + `npm run dev` (Vite)
Live-Daten ansehen: `VITE_API_TARGET=https://jointfactory.io npm run dev`

## Deployed 2026-07-27
- [x] Ziehungsplan Di/Do/Sa 21:00 live, offene Runde 902 auf neuen Termin gezogen
- [x] Miner-Namen live behoben (verifiziert im Browser)
- [x] Countdown zeigt Wochentag + Tage („Di., 21:00 · 1d 04:33:59")

## Verifikation (Phasen 1–6)
- [x] `scripts/sim-economy.mjs` — trifft mit 1.28 die Live-Realität (1,39 B/s nach 30d)
- [ ] Neuer Account bis zum ersten Ticket ohne Deposit
- [ ] Durchsatz-Check, Bot-Check, Cheat-Check

## Review
_(wird am Ende gefüllt)_
