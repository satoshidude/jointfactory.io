# Joint Factory — Analyse & Anschlusskonzept

Stand: 2026-08-02 | Version: v0.3 | Branch: main

> Abschnitt 1–3 beschreiben das Spiel, wie es heute laeuft. Abschnitt 5 ist die
> Analyse vom 2026-06-07, die den Umbau ausgeloest hat — sie bleibt als Beleg
> stehen, mit dem Stand der Umsetzung dahinter.

---

## 1. Feature-Uebersicht

### Kernfeatures

| Feature | Beschreibung |
|---------|-------------|
| **Plantagen-System** | 6 Plots (Balcony Grow → MegaFarm), Level kosten Joints, Meilensteine verdoppeln — gedeckelt bei zehn Verdopplungen (x1024, Level 145) |
| **Courier** | Transportiert Cannabis zur Fabrik, Kapazitaet mit Joints upgradebar |
| **Fabrik** | Verarbeitet Cannabis zu Joints, Batch-Groesse mit Joints upgradebar |
| **Manager** | Auto-Betrieb je Station, **erste 3 gratis** (auch fuer Gaeste), danach 90/60/30/21 Sats je nach abgeschlossenen Runden; gelten nur fuer die laufende Runde |
| **Speed** | +5 % auf die ganze Kette je Stufe, bis zum Rundenende, bezahlt in **Joints**, Preis in Sekunden der eigenen Produktion (Deckel 3,26 Tage/Stufe) |
| **Boosts** | Zeitlich begrenzte Multiplikatoren fuer **Sats**, je 30 min: 2x Grow / 3x Courier / 2x Factory je 10 Sats, Full Throttle 2x alles 21 Sats |
| **Lightning Lottery** | Di/Do/Sa 21:00, max. 4 Lose je Ziehung, Preis als Anteil eines Tagesausstoßes, Gewinne nach Rang gestaffelt (80/20 Split). Voraussetzung: Kette automatisiert **und** Sats dieser Runde im Pot (Boost oder Manager) |
| **Lightning Wallet** | Deposit (LNbits Invoice) + Withdraw (LNURL), jede Gutschrift gegen LNbits verifiziert |
| **Runden** | Eine Runde endet bei 1 Q Joints. Reset bringt einen Stern, loescht Joints, Kette und Speed, laesst Sats unberuehrt. Sterne geben keinen Spielvorteil |
| **Standings** | Eine Tabelle mit Podest: Sterne, beste Zeit zur Quadrillion, Joints der laufenden Runde (danach sortiert) |
| **Race to 1 Q** | Bahnen auf der Grow-Seite: Position ist der Rundenfortschritt, Rang und Zahl die **hochgerechnete Rundenzeit** (verstrichen + Rest beim aktuellen Tempo) |
| **Invite-System** | Referral-Links (/r/CODE); jeder Geworbene, der seine Kette automatisiert, schaltet **eine Stunde Full Throttle** frei — keine Sats |
| **Nostr-Login** | NIP-07 (Browser Extension) oder nsec-Eingabe, kein Email/Passwort |
| **Nostr-Bot** | Lottery-Erinnerungen, Gewinner-Notes, Owner-Reports, Broadcast-DMs aus dem Admin |
| **Admin** | `/admin` (nur Owner): Rundmail an alle Spieler mit Trockenlauf, Kampagnen-Log und Wiederaufnahme |
| **Monitoring** | `events`-Log je Spielerentscheidung, Tagesaggregate in `daily_stats`, `/api/health/metrics` |
| **Offline Catch-Up** | Simuliert Produktion bei Rueckkehr (Bottleneck-basiert, ohne Boosts) |

### Sicherheit

- **PoW-Challenge** bei Registrierung (4 leading zeros SHA256)
- **Honeypot-Feld** gegen einfache Bots
- **Atomare DB-Transaktionen** fuer alle kritischen Operationen (Tickets, Deposits, Boosts, Speed)
- **NIP-98 Auth** mit Zeitfenster-Validierung (±10s)
- **Speicher-Schranke** (`saveState`): der Client meldet seinen Kontostand absolut,
  der Server begrenzt ihn auf das, was der *gespeicherte* Stand in der Zwischenzeit
  produziert haben kann — inklusive Boosts, Handbetrieb und Haldenabbau — abzueglich
  der Kosten jedes Ausbaus, den der neue Stand behauptet (`progressCost`). Das
  Ergebnis geht in der Antwort zurueck, der Client uebernimmt es.
- **Lightning verifiziert**: Einzahlungen werden nie auf Zuruf gutgeschrieben, sondern
  bei LNbits nachgefragt; Auszahlungsrechnungen werden vor dem Bezahlen dekodiert und
  auf den Betrag geprueft; der Webhook traegt ein Token.
- **House-Ledger** (`server/house.js`): jede gutgeschriebene Sat hat eine Herkunft,
  stuendliche Solvenzpruefung.
- **Ratenbegrenzung** 120/min je Adresse (Fastify hinter Caddy, `trustProxy`).

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

Der Ausstoß ist das **Minimum** der drei Stufen, keine Summe: eine Plantage, die
dem Kurier davonwaechst, bringt nichts. Genau das benennt die Fabrik-Karte auch,
wenn sie stockt — sie zeigt die langsamste Stufe davor.

**Plantagen** produzieren Cannabis in Zyklen. Jede Plantage hat:
- **Level** (Kosten `upgBase × 1,12^level`, in Joints)
- **Meilensteine**: Verdopplung alle 10, dann 15, dann 20 Level im Wechsel,
  **hoechstens zehn** — ab x1024 (Level 145) waechst nur noch der lineare Anteil
- Alte Per-Station-Speed-Stufen bleiben unter Bestandsschutz wirksam, werden aber
  nicht mehr verkauft — die globale Speed-Leiter hat sie ersetzt

**Courier** holt Cannabis ab und liefert an die Fabrik:
- State-Machine: idle → toFactory → toPlant → idle
- Upgrade: Kapazitaet (x2) fuer Joints — der Preis steigt gestaffelt: x2,5 fuer die
  ersten zwoelf Ausbauten, dann x3,4, ab dem 22. x3,9

**Fabrik** rollt Joints:
- Batch-Verarbeitung mit Timer
- Upgrade: Kapazitaet (x2) fuer Joints, dieselbe Staffel

Diese Staffel bestimmt das Tempo des ganzen Spiels. Flach bei x2,5 erreichte ein
zielstrebiger Spieler eine Quadrillion Joints in zwoelf Tagen — danach sagen die
Zahlen niemandem mehr etwas. Gestaffelt sind es 169 Tage, ohne dass die erste
Stunde langsamer wird (zweite Plantage weiterhin nach 1,4 h). Nachgerechnet mit
`scripts/tune-pacing.mjs`.

### Waehrungssystem (Dual Currency)

| | Joints | Sats |
|--|--------|------|
| **Herkunft** | Fabrik-Produktion | Lightning Deposit, Lottery-Gewinn |
| **Ausgabe** | Plantagen-Level, Kurier-/Fabrik-Kapazitaet, **Speed**, Lottery-Tickets | **Boosts**, Manager ab dem 4. |
| **Konvertierung** | Nie direkt in Sats — nur ueber die Lottery als Chance | Auszahlbar per LNURL |
| **Preisbildung** | Los und Speed kosten einen Anteil der **eigenen** Tagesproduktion | Feste Sats-Preise |
| **Tracking** | Lifetime-Total fuer Leaderboard | Wallet-Balance, House-Ledger |

Nichts erzeugt Sats aus dem Nichts: es gibt kein Startguthaben, keine Gratis-Sats
fuer Invites und keine Bot-Gewinne auf echten Konten.

### Lottery-Mechanik

- **Zeitplan**: Di, Do, Sa um 21:00 Berlin (DST-sicher, `shared/schedule.js`)
- **Lose**: hoechstens **4 je Ziehung**, Preis 10/18/28/44 % eines Tagesausstoßes
  des Kaeufers — vier Lose kosten also genau einen Tag, und das erste rund
  zweieinhalb Stunden Produktion, egal auf welcher Stufe der Runde. Der frueher
  aufgeschlagene Einsteiger-Faktor (20x bei 1 Joint/s, 1x bei 20 Mrd./s) ist
  entfallen: er war fuer eine Runde bis 1 Mrd. kalibriert, und seit dem Ziel von
  1 Q spannt eine einzelne Runde genau diesen Bereich — er mass nur noch den
  Rundenfortschritt und traf jeden nach jedem Reset erneut.
- **Voraussetzung**: zwei Bedingungen, serverseitig geprueft (`ticketGate` in
  `shared/economy.js`). Erstens die automatisierte Kette — ohne sie faellt der
  Preis auf den Boden von einem Joint. Zweitens **Sats in den Pot dieser Runde** —
  ein Boost ab 10 Sats oder ein Manager, eines von beiden genuegt, denn das sind
  die einzigen zwei Dinge, die Sats kaufen, und beide fliessen brutto in den Pot.
  Die Gratis-Quote deckt drei Manager und drei sind genau das, was die Kette
  braucht, also stand das Tor offen — eine komplett kostenlos automatisierte
  Kette konnte aus einem Pot ziehen, in den sie nie eingezahlt hatte.
- **Gewinnerzahl**: ein aufgerundetes Drittel der Teilnehmer, **mindestens zwei**,
  hoechstens 21 und nie mehr als Teilnehmer
- **Verteilung nach Rang**: 70/30, 60/25/15, 50/25/15/10 … Die Ziehung ist nach
  Losen gewichtet und bestimmt die Reihenfolge; Platz 1 folgt exakt dem Losanteil.
- **Split**: 80 % an die Gewinner, 20 % ins House-Ledger — der Schnitt faellt
  genau einmal, beim Auszahlen
- **Pot**: gespeist aus Sats-Ausgaben (Boosts, Manager), brutto
- **Zu wenige Teilnehmer**: unter zwei Spielern wird nicht gezogen — Pot **und**
  Lose wandern in die naechste Runde. Ohne jedes Los faellt der Pot ans Haus.
- **Bot-Aktivitaet**: nur auf eigens angelegten Konten (`is_bot`), Gewinne fliessen
  in den Pot zurueck statt auf ein Guthaben
- **Nostr-Announcements**: Erinnerung eine Stunde vorher, Gewinner-Note danach

### Progression

1. Spieler startet mit einer Plantage (Balcony Grow), **ohne Startguthaben**
2. Von Hand: Grow → Courier → Roll. Die ersten **drei Manager sind gratis**, damit
   die Kette ohne Einzahlung laufen kann — das ist zugleich die Bedingung fuer die
   Lottery
3. Mit Joints: Level, Kapazitaet, neue Plantagen, dauerhafter Speed, Lose
4. Mit Sats: Boosts (die wiederkehrende Senke) und Manager ab dem vierten
5. **Rundenziel: 1 Billiarde Joints (1 Q)** — alle sechs Plantagen inklusive MegaFarm,
   mit Managern und ein paar Blicken am Tag rund eine Woche
6. Danach freiwilliger Reset: ein Stern, dazu die Rundenzeit als Bestzeit in den Standings
   und die naechste Runde von vorn

### Runden (seit 2026-08)

Die Kurve hatte vorher kein Ende — 1 Quadrillion nach 169 Tagen, danach nichts.
Drei Eingriffe machen daraus eine Runde:

1. **Erbschaft beim Freischalten.** Eine neue Plantage startet auf halbem Level
   der hoechsten vorhandenen. Auf Level 1 traegt sie keinen Meilenstein-
   Multiplikator und ist gegen eine ausgebaute Plantage chancenlos — deshalb
   wurden die letzten beiden Plantagen frueher praktisch nie gekauft.
2. **Produktion durch zehn.** Gleiche Kaufreihenfolge, zehnfache Wartezeiten.
   Der einzige Regler, der die Uhr verstellt, ohne das Spiel umzubauen.
3. **Levelgrenze 50 je Plantage.** Kostet den optimalen Spieler nichts (er
   erreicht 38/12/16/19/19/19) und schliesst das Hochziehen einer einzigen
   Plantage aus.

Was der Reset **nicht** anfasst: Sats. Prestige gibt **keinen** Spielvorteil —
sonst waeren die Rundenzeiten ueber Runden hinweg nicht mehr vergleichbar.

**Manager werden dagegen jede Runde neu bezahlt** — sie sind die einzige
wiederkehrende Sats-Senke, und jeder Sat dafuer geht in den Lottery-Pot. Was den
Reset trotzdem bezahlbar macht, ist der fallende Preis: 90 Sats in der ersten
Runde, 60 in der zweiten, 30 in der dritten, ab der vierten 21. Outdoor, Indoor
und Hydroponic kosten nach der ersten, zweiten und dritten Runde nichts mehr;
Greenhouse und MegaFarm immer. Eine volle Kette kostet damit 450 Sats in Runde 1
und 42 ab Runde 4.

**Bestandskonten werden nicht ueberfahren.** Sie werden beim Deploy nur gesperrt
(`switch_pending`) und bestaetigen einmal selbst. Wer bestaetigt, bekommt drei
angerechnete Runden und drei Sterne — also sofort den Bodenpreis bei den Managern
— und startet Runde 4 mit frischer Kette. Sats bleiben unangetastet, es gibt
keine Frist, und Wallet sowie Info bleiben waehrend der Sperre erreichbar.

Der Einstieg ist getrennt kalibriert: die dritte Plantage (Indoor Room, 8.000
Joints) muss in den ersten acht Stunden fallen — bei *moderater*, nicht optimaler
Spielweise. Wer sie verpasst, wartet einen ganzen Tag, weil die Sitzung vorbei
ist. Die Rundenlaenge aendert das nicht: dank Erbschaft ist eine Plantage gleich
viel wert, wann immer sie geoeffnet wird.

Kalibriert und nachpruefbar mit `node scripts/tune-pacing.mjs` (bricht ab, wenn
die Runde ihre Kriterien verfehlt).

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

### Datenbank-Schema

- `players` — Spielerdaten, Joints/Sats, Game State (JSON), Invite-Code,
  `speed_level`, `joints_rev` (Revision je serverseitiger Abbuchung),
  `referral_rewarded`/`referral_claimed_at`, `is_bot`,
  `lifetime_joints`/`prestige_points`/`rounds_completed` (ueberdauern den Reset),
  `managers_owned` (mit Sats bezahlte Manager, kommen in jeder Runde zurueck)
- `rounds` — eine Zeile je Spieler und Runde: Start, Ende, Zeit bis zur Quadrillion
  (`seconds_to_target`, die Bestzeit in den Standings), MegaFarm-Zeitpunkt,
  Boost-Sats der Runde, Prestige-Punkte
- `lottery_rounds` — Runden-Status, Pot (brutto), Gewinner + Auszahlung je Rang
- `lottery_tickets` — Loskaeufe je Runde
- `active_boosts` — laufende Boosts je Spieler und Typ (Ablauf serverseitig)
- `lightning_payments` — Deposit-Invoices + Status
- `withdrawals` — Auszahlungslog
- `rate_log` — Produktionsraten fuer Trend und Aktivitaet im Rennen, inkl. Boost-Faktor
- `events` — Ereignislog je Spielerentscheidung (Signup, Manager, Speed, Boost,
  Ticket, Deposit, Withdraw, Draw, Win, Invite, Clamp, DM)
- `daily_stats` — Tagesaggregat je Berliner Tag (`server/metrics.js`)
- `dm_log` — verschickte Broadcast-DMs je Kampagne (macht Wiederholungen sicher)
- `zap_receipts` — Legacy (Kompatibilitaet)
- `kv_store` — Bot-State (Note-IDs, Report-Timestamps) und House-Ledger

---

## 4. Verbesserungsvorschlaege

### A. Gameplay-Tiefe

| Verbesserung | Aufwand | Impact |
|-------------|---------|--------|
| ~~Prestige/Reset-System~~ — **umgesetzt** (2026-08), nachdem es zweimal an der Verstaendlichkeit gescheitert war. Was es tragfaehig gemacht hat: ein Ziel, das erreichbar ist (1 Q statt einer offenen Kurve), und ein Stern, der **nichts** kann — kein Multiplikator, keine Abkuerzung, nur ein Zaehler. Die Speed-Leiter blieb daneben bestehen | — | umgesetzt |
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
| ~~Sat-Sink erweitern~~ — **umgesetzt**: Boosts sind die wiederkehrende Senke, 80 % jeder Ausgabe landen im Pot | — | umgesetzt |
| ~~Temporaere Boosts~~ — **umgesetzt**: 10 Sats / 30 min je Station, Full Throttle 21 Sats / 30 min | — | umgesetzt |
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
| ~~Unit Tests~~ — **umgesetzt**: zwoelf `scripts/test-*.mjs`, jedes gegen eine Wegwerf-Datenbank, dazu `tune-pacing.mjs` als Kurven-Waechter | — | umgesetzt |
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
   **Behoben am 2026-08-03** — siehe Runden oben.
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
| 4 | ~~**Prestige/Soft-Reset**~~ **erledigt 2026-08-03** | — | Runde endet bei 1 Q (~1 Woche), Reset bankt Prestige-Punkte, zwei Ranglisten. Durchbricht die Idle-Decke und gibt der Rueckkehr ein Ziel. |
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
