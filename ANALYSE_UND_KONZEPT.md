# Joint Factory — Analyse & Anschlusskonzept

Stand: 2026-06-07 | Version: v0.3 (Retention-Pivot) | Branch: dev/mobile

---

## 1. Feature-Uebersicht

### Kernfeatures

| Feature | Beschreibung |
|---------|-------------|
| **Plantagen-System** | 6 Stufen (Balcony Grow → MegaFarm), je mit Level, Speed, Multiplier-Meilensteinen |
| **Courier** | Transportiert Cannabis von Plantagen zur Fabrik, Kapazitaet/Speed upgradebar |
| **Fabrik** | Verarbeitet Cannabis zu Joints (In-Game-Waehrung), Batch-Groesse + Speed upgradebar |
| **Manager** | Auto-Betrieb fuer Plantagen/Courier/Fabrik, erste 2 gratis, ab 3. kosten Sats |
| **Lightning Lottery** | 6 Ziehungen taeglich, Tickets kosten Joints, Gewinne in echten Sats (80/20 Split) |
| **Lightning Wallet** | Deposit (LNbits Invoice) + Withdraw (LNURL), echte Bitcoin-Transaktionen |
| **Leaderboard** | Ranking nach Lifetime-Joints + Earnings (Sats), paginiert |
| **Growth Race** | Live-Chart der Produktionsraten aller Spieler (letzten 6h) |
| **Invite-System** | Referral-Links (/r/CODE), +10 Sats bei Deposit, Free Manager fuer ersten Referral |
| **Nostr-Login** | NIP-07 (Browser Extension) oder nsec-Eingabe, kein Email/Passwort |
| **Nostr-Bot** | Postet Lottery-Gewinner, Erinnerungen, DM-Reports an Owner |
| **Profil-Manager** | Nostr-Profil direkt in der App bearbeiten |
| **Offline Catch-Up** | Simuliert Produktion bei Rueckkehr (Speed=1, Bottleneck-basiert) |

### Sicherheit

- **PoW-Challenge** bei Registrierung (4 leading zeros SHA256)
- **Honeypot-Feld** gegen einfache Bots
- **Atomare DB-Transaktionen** fuer alle kritischen Operationen (Tickets, Deposits, Referrals)
- **NIP-98 Auth** mit Zeitfenster-Validierung (±10s)

### Echtzeit

- **WebSocket-Hub** mit ~30fps Broadcasts (Lottery-Countdown, Pot, Spielerzahl)
- **Live-Updates** bei Joints/Sats-Aenderungen an alle Clients
- **Heartbeat** (30s Ping/Pong) fuer Connection-Management

---

## 2. Gameplay-Mechanik

### Produktionskette

```
Plantagen → Courier → Fabrik → Joints
(Cannabis)   (Transport)  (Verarbeitung)  (Waehrung)
```

**Plantagen** produzieren Cannabis in Zyklen. Jede Plantage hat:
- **Level** (Kapazitaet, exponentiell steigend)
- **Speed** (Zykluszeit, 1000 Stufen a 20-500 Sats)
- **Multiplier-Meilensteine** (z.B. "4x in 17 Levels")

**Courier** holt Cannabis ab und liefert an die Fabrik:
- State-Machine: idle → toFactory → toPlant → idle
- Upgrade: Kapazitaet (x2) und Speed (+1%)

**Fabrik** rollt Joints:
- Batch-Verarbeitung mit Timer
- Upgrade: Kapazitaet (x2) und Speed (+1%)

### Waehrungssystem (Dual Currency)

| | Joints | Sats |
|--|--------|------|
| **Herkunft** | Fabrik-Produktion | Lightning Deposit, Lottery-Gewinn, Referral |
| **Ausgabe** | Lottery-Tickets, Plantagen-Level | Speed-Upgrades, Manager (ab 3.) |
| **Konvertierung** | Nie in Sats umwandelbar | — |
| **Tracking** | Lifetime-Total fuer Leaderboard | Wallet-Balance |

### Lottery-Mechanik

- **Zeitplan**: 0:00, 5:00, 11:00, 16:00, 19:00, 21:00 Uhr (Berlin)
- **Ticket-Preiskurve**: 21 Tickets pro Runde, Start bei 500 Joints, Peak bei 7.000
- **Gewinner**: Bis zu 21 unique Spieler, Auszahlung proportional zu Tickets
- **Split**: 80% an Gewinner, 20% House
- **Fake-Aktivitaet**: 40% der Runden generieren 2-3 Fake-Spieler (psychologischer Effekt)
- **Nostr-Announcements**: Gewinner werden gepostet, alte Notes nach 6 Stueck geloescht

### Progression

1. Spieler startet mit 1 Plantage (Balcony Grow) + 210 Sats Startguthaben
2. Cannabis produzieren → Courier → Fabrik → Joints sammeln
3. Mit Joints: Plantagen leveln, neue Plantagen freischalten, Lottery-Tickets kaufen
4. Mit Sats: Speed-Upgrades, Manager (Automatisierung), Withdraw
5. Langzeitziel: Alle 6 Plantagen + maximale Speed + Leaderboard-Rang

---

## 3. Tech Stack

### Frontend

| Technologie | Version | Zweck |
|------------|---------|-------|
| React | 19 | UI-Framework |
| TypeScript | 5.x | Typsicherheit |
| Vite | 7 | Build-Tool + Dev-Server |
| Tailwind CSS | 4 | Styling |
| Zustand | — | State Management (Auth, Display) |
| Recharts | — | Growth Race Chart |
| Lucide React | — | Icons (Cannabis = Waehrungssymbol) |
| nostr-tools | — | NIP-07/NIP-98 Signing |

### Backend

| Technologie | Version | Zweck |
|------------|---------|-------|
| Fastify | 5 | HTTP-Server + WebSocket |
| better-sqlite3 | — | Datenbank (WAL-Mode) |
| node-cron | — | Lottery-Draws, Reminders, Reports |
| nostr-tools | — | Bot-Events, Multi-Relay Publishing |
| websocket-polyfill | — | Relay-Verbindungen |
| @fastify/websocket | — | WebSocket-Hub |

### Infrastruktur

| Komponente | Detail |
|-----------|--------|
| **VPS** | Hetzner (nsnip) |
| **Prozess** | PM2 (Port 3421) |
| **Reverse Proxy** | Caddy (TLS) |
| **Lightning** | LNbits (Docker, Port 5000) |
| **Nostr Relay** | strfry (Port 7777, Whitelist) |
| **Analytics** | GoatCounter (Port 8093) |
| **DB** | SQLite mit 8 Tabellen |

### Datenbank-Schema (8 Tabellen)

- `players` — Spielerdaten, Joints/Sats, Game State (JSON), Invite-Code
- `lottery_rounds` — Runden-Status, Pot, Gewinner
- `lottery_tickets` — Ticket-Kaeufe pro Runde
- `lightning_payments` — Deposit-Invoices + Status
- `withdrawals` — Auszahlungslog
- `rate_log` — Produktionsraten fuer Growth Race
- `zap_receipts` — Legacy (Kompatibilitaet)
- `kv_store` — Bot-State (Win-Note-IDs, Report-Timestamps)

---

## 4. Verbesserungsvorschlaege

### A. Gameplay-Tiefe

| Verbesserung | Aufwand | Impact |
|-------------|---------|--------|
| **Prestige/Reset-System** — Alles zuruecksetzen fuer permanente Multiplier | Mittel | Hoch — gibt Langzeit-Motivation |
| **Achievements** — Meilensteine mit Belohnungen (z.B. "1M Joints produziert") | Gering | Mittel — Dopamin-Hits |
| **Tages-Quests** — "Kaufe 3 Lottery-Tickets", "Erreiche Level 50" | Mittel | Hoch — taegliche Retention |
| **Plantagen-Spezialisierung** — Verschiedene Sorten mit Traits (Speed vs. Ertrag) | Mittel | Mittel — strategische Tiefe |
| **Offline-Earnings Cap** — Maximum begrenzen, um aktive Spieler zu belohnen | Gering | Gering |

### B. Social & Engagement

| Verbesserung | Aufwand | Impact |
|-------------|---------|--------|
| **Nostr-Feed im Spiel** — Zeige Posts mit #JointFactory Hashtag | Mittel | Hoch — Community-Gefuehl |
| **Spieler-vs-Spieler Wetten** — Direktes Duell um Sats | Hoch | Hoch — Engagement + Sats-Umlauf |
| **Gilden/Crews** — Gemeinsame Lottery-Pools | Hoch | Hoch — Retention durch soziale Bindung |
| **Chat** — Einfacher Nostr-basierter In-Game Chat (Kind 42) | Mittel | Mittel |
| **Profilseiten** — Oeffentliche Spielerprofile mit Stats | Gering | Gering |

### C. Monetarisierung & Economy

| Verbesserung | Aufwand | Impact |
|-------------|---------|--------|
| **Sat-Sink erweitern** — Mehr Gruende Sats auszugeben (Cosmetics, Boosts) | Mittel | Hoch — gesunde Economy |
| **Temporaere Boosts** — 2x Production fuer 1h (kostet Sats) | Gering | Mittel |
| **Premium-Plantage** — Nur mit Sats kaufbar, hoher Output | Gering | Mittel |
| **Lottery-Sidebet** — Wette auf Gewinnerzahl (Over/Under) | Mittel | Mittel |

### D. Technisch

| Verbesserung | Aufwand | Impact |
|-------------|---------|--------|
| **PWA + Push Notifications** — Lottery-Erinnerungen als Browser-Push | Mittel | Hoch — Retention |
| **Rate Limiting** — API-Endpunkte absichern (aktuell nur PoW bei Signup) | Gering | Hoch — Sicherheit |
| **Error Monitoring** — Sentry o.ae. fuer Production-Fehler | Gering | Mittel |
| **DB Backup Cron** — Automatisches SQLite-Backup | Gering | Hoch — Datensicherheit |
| **Tab-Sync** — Erkennung mehrerer offener Tabs (localStorage Lock) | Gering | Gering |
| **Unit Tests** — Zumindest fuer Lottery-Logik und Waehrungs-Operationen | Mittel | Mittel |
| **useGameLoop aufteilen** — 910 Zeilen in kleinere Hooks splitten | Mittel | Mittel — Wartbarkeit |

---

## 5. Anschlusskonzept: Retention vor Expansion

> Aktualisiert 2026-06-07 auf Basis der Live-Daten (siehe 5.1). Der urspruengliche
> Plan "Mini-Gaming-Plattform mit Dice/Mines/Crash/Plinko" ist **zurueckgestellt**:
> Mehr Spiele auf einer Basis ohne Spielerbindung zu bauen vervielfacht den
> Wartungsaufwand, ohne das Kernproblem zu loesen. Erst Retention, dann Expansion.

### 5.1 Ist-Daten (Stand 2026-06-07)

Auswertung der Produktions-DB (31 Spieler):

| Zeitraum | Aktiv/Tag | Lottery-Sats/Woche | Echte Deposits |
|----------|-----------|--------------------|----------------|
| KW 9-11 (Launch, Maerz) | bis 11 | bis 2.028 | 14x / 3.400 Sats |
| KW 17 (April) | wenige | ~430 | letzter Deposit |
| KW 22-23 (jetzt, Juni) | **2** | ~250-310 (Bot-getragen) | **0 seit April** |

- **Echtes Geld total:** 25 Deposits = 10.150 Sats rein, 7 Withdrawals = 808 Sats raus — alles vor Mitte April.
- **Signups:** 0 neue Spieler in den letzten 7 Tagen.
- **Zap-Receipts:** 0 (Zap-Voting nie gebaut).
- **Idle-Inflation:** Lifetime-Joints bis 7,9 Qa — Zahlen wachsen, Spielerbasis nicht.
- **Fazit:** Das Spiel haelt keine Spieler. Die Lottery wirkt nur durch Fake-/Bot-Aktivitaet belebt.

### 5.2 Diagnose — warum Retention scheitert

1. **Kein Rueckkehr-Hook.** Keine PWA, kein Push. Wer den Tab schliesst, hat keinen
   Grund (und keine Erinnerung) zurueckzukommen. Lottery-Reminder laufen nur als
   Nostr-Post — erreicht niemanden direkt.
2. **Idle-Decke frueh erreicht.** Ohne Prestige/Soft-Reset endet die Progression nach
   den 6 Plantagen + Max-Speed. Danach passiert nichts Neues.
3. **Onboarding-Reibung.** PoW-Challenge + nsec/Extension-Huerde direkt beim Einstieg,
   bevor der Spieler den Wert sieht.
4. **Keine echte soziale Schleife.** Leaderboard ist passiv; Zap-Voting (der
   eigentliche soziale/oekonomische Kern) wurde nie gebaut. Kein Grund, mit anderen
   zu interagieren.
5. **Tote Relays** (relay.nostr.band, snort.social) — Announcements kamen teils gar
   nicht raus. **Behoben am 2026-06-07.**

### 5.3 Retention-Roadmap (priorisiert)

| # | Massnahme | Aufwand | Warum |
|---|-----------|---------|-------|
| 1 | **PWA + Web-Push** | Mittel | Der wichtigste Hebel: installierbar + direkte Lottery-/"deine Ernte wartet"-Pushes. Ohne Rueckkehr-Hook bleibt alles andere wirkungslos. |
| 2 | **Onboarding entschaerfen** | Gering | Read-only-Vorschau ohne Login; PoW nur bei Verdacht; "spielen, dann anmelden". |
| 3 | **Daily-Login-Reward + Tages-Quests** | Mittel | Gibt einen taeglichen Grund zurueckzukommen. |
| 4 | **Prestige/Soft-Reset** | Mittel | Durchbricht die Idle-Decke, schafft Langzeitziel. |
| 5 | **Zap-Voting endlich bauen** | Mittel-Hoch | Der urspruengliche soziale/oekonomische Kern — Spieler zappen Spieler, echter Sats-Umlauf statt Bot-Lottery. |
| 6 | **Nostr-DM-Reaktivierung** | Gering | "Deine Plantage produziert seit 3 Tagen ungeerntet" als NIP-04-DM an inaktive Spieler. |

### 5.4 Erfolgsmessung

Vor jeder Expansion muessen diese Zahlen stabil sein:
- **D1/D7-Retention** messbar (aktuell kein Tracking dafuer → GoatCounter-Events oder DB-Cohort).
- **Wiederkehrende Spieler** > Neuanmeldungen.
- **Realer Sats-Fluss** wieder positiv (Deposits nach April > 0).

Erst wenn ein Spiel Menschen haelt, lohnt die Plattform-Idee. Der alte Spiele-Katalog
(Dice, Mines, Crash, Plinko) bleibt als **Backlog** in der Git-History (Stand bis
2026-03) erhalten — nicht geloescht, nur nachgelagert.

---

## 6. Zusammenfassung

**Joint Factory** ist technisch solide (Nostr-native Auth + echte Lightning-Sats,
sauberes Dual-Currency-Design). Das Problem ist nicht die Technik, sondern die
**Spielerbindung**: Nach dem Maerz-Launch ist die aktive Basis auf 2 Spieler gefallen,
realer Sats-Fluss steht seit April still.

**Konsequenz:** Fokus von "mehr Spiele" auf "Spieler halten".

**Top-Prioritaeten:**
1. PWA + Web-Push (Rueckkehr-Hook) — ohne das wirkt nichts anderes
2. Onboarding-Reibung senken (read-only Vorschau, PoW nur bei Verdacht)
3. Daily-Reward + Prestige (taeglicher + langfristiger Grund)
4. Zap-Voting bauen (echter sozialer/oekonomischer Kern statt Bot-Lottery)
5. DB-Backup-Cron (Datensicherheit)

Multi-Game-Plattform: zurueckgestellt bis Retention messbar stabil.
