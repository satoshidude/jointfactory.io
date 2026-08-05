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

## Phase 3 — Joints-Sink an Produktion koppeln — erledigt 2026-07-27
- [x] `ticketPrice(n, rate)` in shared; Preis = max(Bodenkurve, Rate × Sekunden)
- [x] `server/lottery.js` rechnet die Rate **serverseitig** aus `game_state`
      statt aus `players.joints_per_sec` — die Spalte hält, was der Client
      zuletzt gemeldet hat; ein Spieler könnte 0 melden und ewig zum
      Bodenpreis kaufen. Boosts zählen bewusst nicht mit, damit ein Boost die
      Lose nicht verteuert.
- [x] Preis wird innerhalb der Kauf-Transaktion aus demselben Zustand berechnet
- [x] `/api/lottery/current` + Preview; anonyme Besucher sehen die Bodenkurve
- [x] Hartcodierte Kurvenkopie in `server/zap.js` entfernt — Bots zahlen jetzt
      denselben skalierten Preis
- [x] Zielhinweis prüft gegen den eigenen skalierten Preis statt gegen den Boden
- [x] `scripts/test-ticket-price.mjs` — 9 Checks

### Nachgeschärft: Tageskontingent (Vorgabe 2026-07-27)
Zielwerte: **Top-Spieler höchstens 4 Lose pro Tag, Einsteiger höchstens 1 alle
2 Tage.** Eine feste Sekundenzahl pro Los kann das nicht leisten — sie gibt
jedem dieselbe Anzahl pro Tag, egal wie groß er ist. Der Maßstab wandert daher
mit der Spielgröße:

- `ticketScale(rate)` — log-interpoliert zwischen den Ankern 1,25/s (Einsteiger)
  und 1,6 Mrd/s (heutige Top-Spieler), Faktor 13,3 → 1,0
- `TICKET_DAY_SHARE = [0.15, 0.22, 0.28, 0.35]` — die vier Tageslose steigen im
  Preis und kosten zusammen genau einen Produktionstag des Top-Spielers
- `MAX_TICKETS_PER_DAY = 4`, geprüft über ein rollendes 24-h-Fenster **innerhalb
  der Kauf-Transaktion**, damit zwei gleichzeitige Käufe nicht beide durchgehen
- Der Bot in `zap.js` kaufte 3–12 Lose am Stück — unterliegt jetzt demselben Limit

Gemessen: Einsteiger 0,50 Lose/Tag, Top-Spieler exakt 4,00.

Das harte Limit ist nötig, weil die Preisgestaltung allein nicht reicht: die
Altbestände stammen aus dem alten Regime, der größte entspricht ~13
Produktionstagen. Ohne Limit hätte ein Horter die Runde am ersten Tag leergekauft.

### Wirkung auf die Bestandsspieler (Ticket #1, vor dem Tageskontingent)
| Spieler | Rate | alt | neu | Anteil seines Bestands |
|---|---|---|---|---|
| Hakuna | 1,6 Mrd/s | 500 | 467,3 Mrd | 0,03 % |
| SpookyPayment | 1,6 Mrd/s | 500 | 486,8 Mrd | 89,9 % |
| satoshidude | 1,6 Mrd/s | 500 | 477,4 Mrd | 1,8 % |
| boyscout | 1,5 Mrd/s | 500 | 447,1 Mrd | **642 %** |

Die Skalierung greift an der *Rate*, die Altbestände an *Joints* stammen aber
aus dem alten Regime — für Horter bleibt es billig, für andere wird es
unbezahlbar. Der Season-Reset (Phase 5) setzt `players.joints` auf 0 und löst
das; bis dahin ist die Verzerrung bekannt und gewollt in Kauf genommen.

## Ziehung — Gewinnerquote (Entscheidung 2026-07-27)

**Befund:** Die Ziehung nahm `min(21, Teilnehmer)` Gewinner. Bei 21 oder weniger
Teilnehmern gewann damit *jeder*, der Pot wurde streng nach Losanzahl geteilt —
kein Zufall. In 468 Runden mit Losen lag die höchste Teilnehmerzahl bei **8**,
die 21er-Grenze hat also nie gegriffen: es hat noch nie eine echte Ziehung
gegeben. Die skalierten Ticketpreise verschärften das, weil gleich aktive
Spieler nun gleich viele Lose kaufen und die Aufteilung dadurch immer flacher
wird.

- [x] `winnerCount(teilnehmer)` in `shared/economy.js`: ein Drittel, mindestens
      einer, gedeckelt bei 21. 3 → 1, 10 → 4, 30 → 10, ab 63 → 21
- [x] `runDraw` nutzt die Quote; Chance bleibt proportional zu den Losen
- [x] `/api/lottery/current` meldet die Gewinnerzahl *dieser* Runde statt der
      absoluten Obergrenze
- [x] `scripts/test-draw.mjs` — inkl. 3000-Ziehungen-Stichprobe: Gewinnfrequenz
      trifft den Losanteil auf unter 1 Prozentpunkt genau
- [x] Letzte hartcodierte `* 0.8`-Kopie im Frontend durch `potPayout()` ersetzt

Auszahlung unter den Gewinnern bleibt proportional zu deren Losen — bei einem
Gewinner ohnehin identisch. Falls das später zu stark wirkt (Lose zählen dann
doppelt: für die Chance *und* für den Anteil), wäre die gleichmäßige Teilung
unter den Gewinnern die Alternative.

## Prestige durch Speed ersetzt (Entscheidung 2026-07-29)

Prestige/Harvest ist zweimal an der Verständlichkeit gescheitert — nicht an der
Erklärung, sondern an der Mechanik: Seeds waren eine zweite abstrakte Währung,
die man nur durch einen Reset bekam, in Quadrillionen Lifetime-Joints gemessen
wurde, und deren Nutzen mit jedem weiteren Seed gegen null ging (bei 343 Seeds
noch +0,28 %).

**Ersetzt durch: Joints kaufen dauerhaften Speed.** Damit hat das Spiel zwei
Währungen mit je klaren Verwendungen — Joints für Lose, Speed, Level und
Kapazität; Sats für Boosts und Manager.

### Warum der Preis in Produktionszeit steht
Eine feste Joint-Kurve hält keine Obergrenze: das Einkommen wächst über 30 Tage
um etwa Faktor 10¹², jede feste Kurve wird überholt. Ein erster Entwurf zielte
auf +20 %/Monat und simulierte auf ×51. Der Preis ist deshalb ein Anteil der
**eigenen Produktion** — genau wie beim Ticket.

- erste Stufe: 5 min Produktion · Stufe 20: 1,0 d · ab Stufe 24: Deckel 3,26 d
- Deckel direkt aus der Vorgabe abgeleitet: 30 Produktionstage ÷ 9,2 Stufen
  = +20 % im Monat
- Anlaufphase aus dem Stand: 29 Stufen ≈ ×1,78 im ersten Monat, danach ×1,195

### Was die Bestandsspieler bekommen
Nicht die Größe der Halde zählt, sondern wie viele Produktionstage sie ist:

| Spieler | Vorrat | = Produktionszeit | Stufen | Speed |
|---|---|---|---|---|
| Hakuna | 1,77 Q | 13,2 d | 24 | ×1,61 |
| akki | 158,2 T | 3,9 d | 19 | ×1,46 |
| satoshidude | 26,4 T | 4,6 h | 10 | ×1,22 |
| boyscout | 69,6 B | 0,0 h | 0 | ×1,00 |

Spanne ×1,00–×1,61 statt ×11–×19 bei den Seeds. Hakuna hat 25.000-mal so viele
Joints wie boyscout und liegt trotzdem nur 61 % vorn.

### Kein Season-Reset mehr nötig
Die Halden werden über die Leiter zur Startausstattung, statt weggeschnitten und
per Legacy-Formel neu zugeteilt zu werden. Ticketpreise korrigieren sich selbst
(sie skalieren mit der Rate, die durch Speed steigt). `scripts/season-reset.mjs`
ist gelöscht.

### Bewusster Zielkonflikt
Vier Tageslose kosten einen Top-Spieler bereits einen vollen Produktionstag.
Speed und Lose greifen auf dieselben Joints zu — man muss sich entscheiden.
Die +20 % im Monat erreicht nur, wer auf die Lotterie verzichtet.

### Umsetzung
- [x] `shared/economy.js`: `speedCost`, `speedCostSeconds`, `speedMultiplier`;
      `throughput()` nimmt `speedLevel`; Prestige-API und die tote
      Per-Station-Speed-API entfernt
- [x] `server/speed.js` + `POST /api/game/speed`, Preis in der Transaktion aus
      dem gespeicherten Zustand; `playerRate()` dient auch der Ticket-Preisung
- [x] Spalte `speed_level`; `server/prestige.js` gelöscht
- [x] `SpeedCard` ersetzt `HarvestCard`
- [x] `scripts/test-speed.mjs` (18 Checks), `sim-economy.mjs` umgestellt,
      `test-ticket-price.mjs` prüft jetzt Speed statt Seeds
- [x] Im Browser: drei Käufe → Stufe 3, ×1,06, Preis 375 → 979, Rate 1,25 → 1,327/s

## Phase 4 — Prestige (2026-07-28, ersetzt — siehe oben)
- [x] Spalte `prestige_seeds`; `season_joints_earned` entfällt, weil die Seeds
      aus dem All-Time-`total_joints_earned` abgeleitet werden und damit monoton
      sind — Altkonten konvertieren beim Season-Reset von allein
- [x] `server/prestige.js` + `POST /api/game/prestige`, serverautoritativ
- [x] Reset-Regel: alles Joint-Gekaufte zurück (Level, Kapazitäten, Unlocks,
      Joints), alles Sats-Gekaufte bleibt (Speed-Level, Manager, Wallet).
      Sats-Upgrades gesperrter Plantagen werden geparkt und beim erneuten
      Freischalten zurückgegeben (`takeParkedUpgrades`, genau einmal einlösbar)
- [x] Multiplikator wirkt kettenweit — Plantagen-Output, Kurier-Ladung,
      Fabrik-Charge — im Loop, in `throughput()` und in den Kartenanzeigen
- [x] `simulateOffline` kennt die Seeds; Boosts bleiben dort bewusst außen vor,
      weil sie an der Wanduhr ablaufen
- [x] `HarvestCard` mit Bestätigungsschritt, der ausdrücklich benennt, was
      erhalten bleibt
- [x] `scripts/test-prestige.mjs` — 24 Checks
- [x] Im Browser durchgespielt: 50 Mrd Joints → 0, Level 41 → 1, Sats 200
      unverändert, Speed-Level erhalten, 169 Seeds = ×9,45, Rate 1/s → 14/s

- [ ] **`upgMult` 1.28 → 1.12 weiterhin offen** — gehört zum Season-Reset
      (Phase 5), weil `rehydrate()` die Defs auf jeden Spielstand schreibt und
      die Änderung sonst 34 Konten mitten in der Season umpreist

## Phase 5 — Season-Reset, Bots, Deckung — erledigt 2026-07-28
- [x] `is_bot` Spalte, `scripts/seed-bots.mjs` legt 6 dedizierte Konten an
      (deterministische IDs, idempotent)
- [x] `FAKE_PLAYERS` (7 echte Spieler-Präfixe) ersetzt durch `is_bot`-Abfrage
- [x] Bot-Gewinne fließen in den Folge-Pot statt in ein auszahlbares Guthaben
- [x] `is_bot`-Filter in Leaderboard, Growth Race und Owner-Report
- [x] `server/house.js` — Ledger aus dem 20 %-Cut, atomarer Abzug
- [x] Pot-Seeding und Referral-Prämie werden aus dem Ledger gebucht; reicht er
      nicht, unterbleiben sie
- [x] `/api/health/solvency` + stündlicher Cron
- [x] `scripts/season-reset.mjs`, Dry-Run als Standard

### Dabei gefunden und behoben
- **Der Pot wurde nicht übertragen.** Die Oberfläche sagt „No winner — pot rolls
  over!", der Code schloss die Runde und startete die nächste bei 0. Historisch
  40 Sats verloren, bei 3 Ziehungen/Woche künftig deutlich mehr. Jetzt echter
  Übertrag.
- **`cp` auf eine WAL-Datenbank liefert einen veralteten Stand** — gelöschte
  Zeilen tauchten in der Kopie wieder auf, weil die Änderung noch im `-wal` lag.
  Für Snapshots ausschließlich `sqlite3 .backup` verwenden.
- **Speed-Umrechnung war wertvernichtend.** Proportional (0–1000 → 0–60) hätte
  das höchste Live-Level von 11 auf 1 gedrückt. Speed-Level werden mit Sats
  gekauft, also gilt dieselbe Regel wie beim Prestige: jetzt wird der bezahlte
  Betrag hochgerechnet und auf der neuen Kurve neu ausgegeben. 58 bezahlte
  Stationen geprüft, keine verloren.
- **Client rechnete noch mit 1000 Speed-Leveln**, `shared` mit 60. Der Client
  ist jetzt umgestellt — Code und Migration müssen deshalb **gemeinsam** live.

### Verschobene Kurvenänderungen jetzt aktiv
- [x] `upgMult` 1.28 → 1.12
- [x] Speed-Kurve 60 Level, 1×→3×, 21–210 Sats

## Speed-Upgrades entfernt (Entscheidung 2026-07-29)
Boosts sind der bessere und übersichtlichere Sats-Sink, also fallen die
permanenten Speed-Upgrades **überall** weg — Plantagen, Kurier, Fabrik.

Sats haben danach genau zwei Verwendungen: Boosts (wiederkehrend) und Manager
ab dem vierten (einmalig). Damit versickert keine Kaufkraft mehr in dauerhaften
Upgrades, und jeder ausgegebene Sat läuft durch den Pot-Kreislauf.

**Bestandsschutz statt Rückerstattung.** 16 Spieler haben 3.694 Sats in
Speed-Level gesteckt. Eine Rückzahlung würde den Solvenz-Spielraum von 1.117
sprengen und das Spiel mit −2.577 ins Minus drehen. Stattdessen verschwindet
nur die Kaufmöglichkeit: `speed` teilt weiterhin jede Zykluszeit, gekaufte
Level bleiben also wirksam. Nichts vernichtet, nichts geschöpft.

- [x] Kauf-Aktionen `upgradePlantSpeed` / `upgradeCourierSpeed` /
      `upgradeFabrikSpeed` entfernt
- [x] Speed-Buttons aus `StationCard` und aus der alten `Game.tsx`
- [x] `getSpeedUpgrade` bleibt in `shared`, wird nur noch von
      `migrateSpeedLevel` für die Season-Umrechnung gebraucht

## Lokaler Probelauf 2026-07-29 — bestanden
Migration auf `data/jointfactory.db` gefahren, Rückweg unter `data/pre-season1.db`.
Als `satoshidude` (343 Seeds, ×18,15) im Browser geprüft: Kurier-Kapazität 363
statt 20, Speed +3 % für 21 Sats auf der neuen Kurve, Level-Kosten 8 statt 94
Joints, Leaderboard und Growth Race ohne Bots, Solvenz-Lücke +1117.

### Dabei gefunden und behoben
- **Ticketpreis ignorierte das Prestige.** `playerRate` rechnete `throughput()`
  ohne Seeds — ein Spieler mit ×18 Produktion zahlte, als produziere er 1,3/s.
  Lose waren damit **15,8× zu billig**. Seeds sind dauerhafte Kapazität wie
  Plantagenlevel und gehören in den Preis; Boosts weiterhin nicht.
- **Vite starb bei jedem Backend-Neustart.** Der `/ws`-Proxy warf ein
  unbehandeltes EPIPE, sobald der API-Server verschwand. Fehler-Handler in
  `vite.config.ts`.

## Deployment-Ablauf (Phase 5, wenn freigegeben)
Code und Migration gehören in **einen** Wartungsschritt, sonst liest der neue
Client alte Werte auf der neuen Skala.

1. `pm2 stop jointfactory`
2. `sqlite3 data/jointfactory.db ".backup 'data/pre-season1.db'"` — Rückweg
3. `git pull && npm run build`
4. `node scripts/seed-bots.mjs`
5. `node scripts/season-reset.mjs` (Dry-Run prüfen)
6. `node scripts/season-reset.mjs --commit`
7. `pm2 start jointfactory`
8. `curl localhost:3421/api/health/solvency` — Lücke muss ≥ 0 sein

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

## Runden-Release v0.4 (2026-08-05)

Die Kurve hatte kein Ende: 1 Quadrillion nach 169 Tagen, danach nichts. Daraus
ist eine Runde geworden, die in etwa einer Woche gespielt wird und wieder von
vorn beginnt.

### Ökonomie
- [x] `ROUND_TARGET = 1 Q`, Kurve neu gebaut — Start bei ~1 Joint/s, alle sechs
      Plots noetig, MegaFarm traegt 45–57 % der Runde
- [x] Erbschaft beim Freischalten (halbes Hoechstlevel), Levelgrenze 50,
      Produktion durch zehn — die drei Regler in `shared/economy.js`
- [x] Manager kosten je Runde neu: 90/60/30/21 Sats, Outdoor/Indoor/Hydroponic
      werden nach der 1./2./3. Runde dauerhaft frei. Serverseitig bepreist
      (`managerSpend`), nicht nach Angabe des Clients
- [x] Speed-Stufen (+5 %) in die Pacing-Rechnung aufgenommen
- [x] Acht Kriterien in `scripts/tune-pacing.mjs`, bricht ab, wenn die Runde sie
      verfehlt — 3,7 d rund um die Uhr, 8,0 d bei acht Stunden, 14,0 d bei vier

### Lottery
- [x] Ticket-Tor serverseitig: Kette automatisiert **und** ein Manager der
      laufenden Runde fuer Sats gekauft (`ticketGate`). Die drei Gratis-Manager
      sind genau die drei, die die Kette braucht — das Tor stand offen
- [x] Grund steht unter dem Knopf, auf der Grow-Seite und der Lottery-Seite

### Oberflaeche
- [x] Round-Karte in die Race-Karte gezogen, eine Umrandung statt zwei
- [x] Race als Bahnen: Position ist Rundenfortschritt, Rang und Zahl die
      hochgerechnete Rundenzeit — sonst gewinnt, wer nur frueher angefangen hat
- [x] Ranking-Seite: eine Tabelle statt drei Reiter, Podest mit Stufen
- [x] Kapazitaets-Knoepfe nennen die naechste Menge statt „Cap x2"
- [x] Feuerwerk beim Erreichen der Quadrillion, Ringe frieren danach ein

### Bestandskonten
- [x] `switch_pending` friert jedes Konto ein, bis sein Besitzer bestaetigt;
      `saveState` weist Speicherungen ab, Wallet und Info bleiben erreichbar
- [x] Bestaetigen bringt 3 Runden und 3 Sterne (max., ab 1 Q Lebenssumme)
- [x] `POST /api/game/switch` verlangt `{"confirm": true}` — in der Entwicklung
      sind Konten umgestiegen, ohne dass jemand den Knopf gedrueckt hat, und die
      Ursache blieb offen. Ein nackter POST reicht seitdem nicht mehr

### Offen
- [ ] GitHub-PAT in `.git/config` rotieren (steht im Klartext)
- [ ] Drei getrennte `/api/game/state`-Anfragen beim Seitenaufbau zusammenlegen
- [ ] Auszahlungslimits

## Review
_(wird am Ende gefüllt)_
