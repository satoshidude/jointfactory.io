# Lightning Mines — Game & UI/UX Konzept

Standalone-Projekt auf Basis der Joint Factory Infrastruktur.
Stand: 2026-03-13

---

## 1. Vision

**Lightning Mines** ist ein Multiplayer-Minesweeper mit echten Bitcoin Sats. Spieler treten in Echtzeit auf einem geteilten Minenfeld gegeneinander an — rundenbasiert, visuell dynamisch, mit steigender Spannung pro aufgedecktem Feld. Wer zu gierig ist, verliert alles. Wer zu frueh aussteigt, verschenkt Gewinn.

**Kernemotion:** "Soll ich noch ein Feld aufdecken — oder jetzt auscashen?"

**Positionierung:** Einziges Multiplayer-Minesweeper mit Lightning Sats + Nostr-Login im gesamten Bitcoin-Ökosystem.

---

## 2. Spielmodi

### 2.1 Arena Mode (Multiplayer Hauptmodus)

```
┌──────────────────────────────────────────┐
│  2-6 Spieler · Geteiltes 7×7 Feld       │
│  Rundenbasiert · Echtzeit via WebSocket  │
│  Einsatz: 10-1000 Sats                   │
└──────────────────────────────────────────┘
```

**Ablauf:**

1. **Lobby** — Spieler waehlen Tisch (Einsatz-Level) und treten bei
2. **Countdown** — 10s Wartezeit, dann Start (min. 2 Spieler)
3. **Spielphase** — Reihum deckt jeder Spieler ein Feld auf:
   - Sicher → Multiplier steigt, naechster Spieler ist dran
   - Mine → Spieler ist raus, verliert Einsatz
   - **Cash Out** jederzeit statt Feld aufdecken → Gewinn = Einsatz × persoenlicher Multiplier
4. **Ende** — Alle ausgecasht oder eliminiert. Pot wird verteilt.

**Multiplier-Mechanik:**
- Jedes sichere Feld das DU aufdeckst erhoeht DEINEN Multiplier
- Felder die andere aufdecken erhoehen deren Multiplier, nicht deinen
- ABER: Jedes aufgedeckte Feld macht die verbleibenden gefaehrlicher (weniger sichere Felder uebrig)
- Du profitierst also indirekt davon, dass andere Risiken eingehen

**Pot-Verteilung:**
- Eliminierte Spieler: Einsatz geht in den Pot
- Ausgecashte Spieler: Erhalten Einsatz × Multiplier aus dem Pot
- Uebriger Pot-Rest: 3% House Edge, Rest proportional an ausgecashte Spieler

**Tische (Lobbies):**

| Tisch | Einsatz | Minen | Feld | Max Spieler |
|-------|---------|-------|------|-------------|
| Seedling | 10 Sats | 8 | 5×5 | 4 |
| Grower | 50 Sats | 10 | 6×6 | 4 |
| Hustler | 100 Sats | 12 | 7×7 | 6 |
| Whale | 500 Sats | 15 | 7×7 | 6 |
| High Roller | 1000 Sats | 18 | 8×8 | 6 |

**Zeitlimit pro Zug:** 15 Sekunden. Timeout = automatischer Cash Out.

### 2.2 Solo Mode

Klassisches Mines-Gameplay fuer Einzelspieler:
- Waehle Einsatz + Minenanzahl (1-24 auf 5×5)
- Decke Felder auf, cashe jederzeit aus
- Provably Fair (Server-Seed + Client-Seed + Nonce)
- Kein Zeitdruck, kein Gegner

### 2.3 Spectator Mode

- Laufende Arena-Spiele live beobachten
- Feed aller laufenden Tische mit Spieleranzahl und Pot
- Click → Live-View des Spielfelds + Chat
- Spaeter erweiterbar: Spectator-Wetten auf Gewinner

---

## 3. UI/UX Design

### 3.1 Design-Sprache

Baut auf dem Joint Factory Aesthetic auf, aber mit eigenem Charakter:

**Farbpalette:**

| Rolle | Farbe | Hex | Verwendung |
|-------|-------|-----|-----------|
| Primary | Electric Blue | `#00d4ff` | Sichere Felder, UI-Akzente |
| Danger | Mine Red | `#ff2244` | Minen, Explosionen, Eliminierung |
| Success | Cash Green | `#39ff14` | Cash Out, Gewinne, sichere Aufdeckung |
| Gold | Sats Gold | `#ffd700` | Einsaetze, Multiplier, Pot |
| Player 1 | Cyan | `#00d4ff` | Spieler-Markierung |
| Player 2 | Magenta | `#ff44cc` | Spieler-Markierung |
| Player 3 | Lime | `#aaff00` | Spieler-Markierung |
| Player 4 | Orange | `#ff8800` | Spieler-Markierung |
| Player 5 | Purple | `#aa44ff` | Spieler-Markierung |
| Player 6 | Pink | `#ff6688` | Spieler-Markierung |
| Background | Deep Black | `#0a0a0f` | Haupthintergrund |
| Card BG | Dark Blue-Black | `rgba(12,14,24,.95)` | Karten, Panels |
| Border | Steel | `#1a1e2e` | Trennlinien |
| Text Primary | Light Silver | `#d0d8e8` | Haupttext |
| Text Muted | Slate | `#6a7490` | Sekundaertext |

**Typografie:**
- Titel/Zahlen: `Press Start 2P` (Retro, konsistent mit JF)
- Body: `Space Mono` (technisch, lesbar)
- Multiplier-Display: `Press Start 2P`, gross, mit Glow

**Neon-Glow System:**
```css
/* Sichere Aufdeckung */
.tile-safe { box-shadow: 0 0 12px rgba(0,212,255,.4), inset 0 0 8px rgba(0,212,255,.15); }

/* Mine explodiert */
.tile-mine { box-shadow: 0 0 20px rgba(255,34,68,.6), 0 0 40px rgba(255,34,68,.3); }

/* Cash Out Glow */
.cash-out { box-shadow: 0 0 15px rgba(57,255,20,.5), 0 0 30px rgba(57,255,20,.2); }

/* Multiplier Glow (skaliert mit Wert) */
.multiplier { text-shadow: 0 0 calc(8px + var(--mult) * 2px) rgba(255,215,0,.6); }
```

### 3.2 Screen-Architektur (Mobile-First, 393×852)

```
┌─────────────────────────────┐
│  HEADER (Compact)           │  48px
│  Logo · Sats · Online       │
├─────────────────────────────┤
│                             │
│        MAIN CONTENT         │  Scrollable
│     (je nach Screen)        │
│                             │
├─────────────────────────────┤
│  BOTTOM NAV                 │  56px
│  Play · Arena · Solo · More │
└─────────────────────────────┘
```

### 3.3 Screens im Detail

#### Screen 1: Home / Lobby

```
┌─────────────────────────────┐
│ ⚡ LIGHTNING MINES     42 ⚡│  Header
├─────────────────────────────┤
│                             │
│   ┌───────────────────┐     │
│   │  LIVE ARENA       │     │  Live-Spiele Ticker
│   │  3 Spiele laufen  │     │  (horizontal scrollbar)
│   │  → 120 Sats Pot   │     │
│   │  → 350 Sats Pot   │     │
│   └───────────────────┘     │
│                             │
│   TISCHE                    │
│   ┌─────────┬─────────┐    │
│   │Seedling │ Grower  │    │  2-Spalten Grid
│   │ 10 Sats │ 50 Sats │    │  Jeder Tisch = Karte
│   │ 5×5 · 8 │ 6×6 · 10│    │  mit Spielerzahl
│   │ 2/4 ●●○○│ 0/4     │    │  + Join-Button
│   │ [JOIN]  │ [JOIN]  │    │
│   ├─────────┼─────────┤    │
│   │Hustler  │ Whale   │    │
│   │100 Sats │500 Sats │    │
│   │ 7×7 · 12│ 7×7 · 15│    │
│   │ 3/6 ●●●○│ 1/6 ●   │    │
│   │ [JOIN]  │ [JOIN]  │    │
│   └─────────┴─────────┘    │
│                             │
│   DEINE STATS               │
│   ┌───────────────────┐     │
│   │ Spiele: 47        │     │
│   │ Gewonnen: 18 (38%)│     │
│   │ Profit: +340 Sats │     │
│   │ Bester Mult: 4.2x │     │
│   └───────────────────┘     │
│                             │
│   LETZTE GEWINNER           │
│   gorilla    +120 Sats 2m   │
│   nostr      +50 Sats  5m   │
│   boyscout   +200 Sats 8m   │
│                             │
├─────────────────────────────┤
│  Play · Arena · Solo · More │
└─────────────────────────────┘
```

#### Screen 2: Arena-Spiel (Kernscreen)

Das Herzstück — alles muss auf einen Blick erfassbar sein:

```
┌─────────────────────────────┐
│ ⚡ MINES    Hustler · 100⚡ │  Tisch-Name + Einsatz
├─────────────────────────────┤
│                             │
│  SPIELER-LEISTE (horizontal)│
│  ┌──┐ ┌──┐ ┌──┐ ┌──┐      │
│  │DU│ │P2│ │P3│ │P4│      │  Avatare mit Farb-Ring
│  │●●│ │● │ │●●│ │💀│      │  Punkte = aufgedeckte Felder
│  │2x│ │1x│ │2x│ │OUT│     │  Multiplier unter Avatar
│  └──┘ └──┘ └──┘ └──┘      │  Eliminiert = Totenkopf
│                             │
│  ┌─┬─┬─┬─┬─┬─┬─┐          │
│  │?│?│?│●│?│?│?│  ← 7×7   │  SPIELFELD
│  ├─┼─┼─┼─┼─┼─┼─┤          │  ? = verdeckt
│  │?│◆│?│?│?│◆│?│          │  ● = von dir aufgedeckt
│  ├─┼─┼─┼─┼─┼─┼─┤          │  ◆ = von P2 aufgedeckt
│  │?│?│?│?│?│?│?│          │  ◇ = von P3 aufgedeckt
│  ├─┼─┼─┼─┼─┼─┼─┤          │  💣 = Mine (explodiert)
│  │?│?│◇│?│?│?│?│          │
│  ├─┼─┼─┼─┼─┼─┼─┤          │  Farbcodiert pro Spieler
│  │?│?│?│?│?│?│?│          │  Glow-Effekt bei Aufdeckung
│  ├─┼─┼─┼─┼─┼─┼─┤          │
│  │?│?│?│?│●│?│?│          │
│  ├─┼─┼─┼─┼─┼─┼─┤          │
│  │?│?│?│?│?│?│?│          │
│  └─┴─┴─┴─┴─┴─┴─┘          │
│                             │
│  ┌───────────────────┐      │
│  │  DEIN MULTIPLIER  │      │  Grosses Display
│  │     ×2.40         │      │  Gold-Glow, pulsiert
│  │  Gewinn: 240 Sats │      │  bei Erhoehung
│  └───────────────────┘      │
│                             │
│  ┌───────────┬───────────┐  │
│  │  AUFDECKEN │ CASH OUT  │  │  Zwei grosse Buttons
│  │  (dein Zug)│  240 ⚡   │  │  Gruen/Gold
│  └───────────┴───────────┘  │
│                             │
│  Timer: ████████░░ 8s       │  Zeitbalken
│                             │
│  POT: 600 ⚡ · 12/49 frei  │  Footer-Info
│                             │
├─────────────────────────────┤
│  Play · Arena · Solo · More │
└─────────────────────────────┘
```

#### Screen 3: Solo Mode

```
┌─────────────────────────────┐
│ ⚡ SOLO MINES          42⚡ │
├─────────────────────────────┤
│                             │
│  EINSATZ                    │
│  [10] [25] [50] [100] [___]│  Preset + Custom
│                             │
│  MINEN: ■■■■■□□□□□ (5/24)  │  Slider
│  Felder: 5×5 = 25           │
│                             │
│  MAX MULTIPLIER: ×24.75     │  Berechnet aus Minen
│                             │
│  ┌─┬─┬─┬─┬─┐              │
│  │?│?│●│?│?│              │  5×5 Spielfeld
│  ├─┼─┼─┼─┼─┤              │  (groessere Tiles als Arena)
│  │?│●│?│?│?│              │
│  ├─┼─┼─┼─┼─┤              │
│  │?│?│?│?│?│              │
│  ├─┼─┼─┼─┼─┤              │
│  │?│?│?│?│?│              │
│  ├─┼─┼─┼─┼─┤              │
│  │?│?│?│?│?│              │
│  └─┴─┴─┴─┴─┘              │
│                             │
│  ×1.60  →  Gewinn: 80 ⚡    │
│                             │
│  [ CASH OUT — 80 ⚡ ]       │  Grosser Button
│                             │
│  HISTORY                    │
│  ×2.4 +120⚡ · ×0 -50⚡     │  Letzte Spiele
│  ×1.8 +90⚡  · ×3.1 +155⚡  │
│                             │
├─────────────────────────────┤
│  Play · Arena · Solo · More │
└─────────────────────────────┘
```

#### Screen 4: Ergebnis-Screen (nach Arena-Runde)

```
┌─────────────────────────────┐
│         ROUND OVER          │
├─────────────────────────────┤
│                             │
│      ┌─────────────┐       │
│      │   YOU WON    │       │  oder "ELIMINATED"
│      │   +240 ⚡    │       │  Grosser Glow-Effekt
│      │   ×2.40      │       │  Konfetti-Animation
│      └─────────────┘       │  (oder Explosion)
│                             │
│  ERGEBNIS                   │
│  ┌───────────────────────┐  │
│  │ 1. DU      ×2.4 +240 │  │  Sortiert nach Gewinn
│  │ 2. nostr   ×1.8 +180 │  │
│  │ 3. gorilla ×1.2 +120 │  │
│  │ 4. scout   💀  -100   │  │  Eliminiert = rot
│  └───────────────────────┘  │
│                             │
│  AUFGELOESTES FELD          │
│  ┌─┬─┬─┬─┬─┬─┬─┐          │  Alle Minen sichtbar
│  │ │ │ │●│ │ │ │          │  Aufgedeckte Felder
│  │ │◆│ │ │ │◆│💣│          │  farbig markiert
│  │ │ │ │💣│ │ │ │          │  Minen rot pulsierend
│  │ │ │◇│ │ │ │💣│          │
│  │💣│ │ │ │ │ │ │          │
│  │ │ │ │ │●│ │ │          │
│  │ │💣│ │ │ │ │ │          │
│  └─┴─┴─┴─┴─┴─┴─┘          │
│                             │
│  [ NOCHMAL ]  [ LOBBY ]    │
│                             │
├─────────────────────────────┤
│  Play · Arena · Solo · More │
└─────────────────────────────┘
```

### 3.4 Dynamische Animationen

#### Feld-Aufdeckung (sichere Tile)

```
Phase 1 (0-100ms): Tile dreht sich (3D flip, rotateY 0→90°)
Phase 2 (100-200ms): Farbe wechselt, Spieler-Farbe erscheint
Phase 3 (200-400ms): Glow expandiert (box-shadow 0→12px)
Phase 4 (400-600ms): Glow settled (12px→8px)
Gleichzeitig: Zahl in Tile fadet ein (Minen-Nachbar-Count)
```

```css
@keyframes tile-reveal {
  0%   { transform: rotateY(0deg); }
  40%  { transform: rotateY(90deg); background: var(--player-color); }
  60%  { transform: rotateY(0deg); box-shadow: 0 0 16px var(--player-glow); }
  100% { transform: rotateY(0deg); box-shadow: 0 0 8px var(--player-glow); }
}
```

#### Minen-Explosion (Eliminierung)

```
Phase 1 (0-50ms): Tile faerbt sich rot
Phase 2 (50-200ms): Shockwave-Ring expandiert vom Tile aus
Phase 3 (200-500ms): Partikel-Explosion (8-12 Fragmente radial)
Phase 4 (300-600ms): Screen-Shake (2px random offset, 5 Frames)
Phase 5 (500-800ms): Spieler-Avatar wird grau, Totenkopf-Overlay
Phase 6 (800-1200ms): Alle Tiles des eliminierten Spielers dimmen (opacity 0.4)
```

```css
@keyframes mine-explode {
  0%   { transform: scale(1); background: #ff2244; }
  20%  { transform: scale(1.3); box-shadow: 0 0 30px #ff2244, 0 0 60px #ff4444; }
  40%  { transform: scale(0.9); }
  100% { transform: scale(1); background: #441111; opacity: 0.6; }
}

@keyframes shockwave {
  0%   { width: 0; height: 0; opacity: 0.8; border: 2px solid #ff2244; }
  100% { width: 200px; height: 200px; opacity: 0; border: 1px solid #ff2244; }
}

@keyframes screen-shake {
  0%, 100% { transform: translate(0); }
  20%      { transform: translate(-2px, 1px); }
  40%      { transform: translate(2px, -1px); }
  60%      { transform: translate(-1px, 2px); }
  80%      { transform: translate(1px, -2px); }
}
```

#### Cash-Out Animation

```
Phase 1 (0-200ms): Button pulst gruen
Phase 2 (200-600ms): Sats-Zahl zaehlt hoch (animated counter)
Phase 3 (400-800ms): Goldene Partikel steigen nach oben
Phase 4 (600-1000ms): Spieler-Rahmen wird gruen-golden
```

#### Multiplier-Update

```
Bei jedem aufgedeckten Feld:
Phase 1 (0-100ms): Alte Zahl scale(1) → scale(0.8), opacity 1→0
Phase 2 (100-300ms): Neue Zahl scale(1.3) → scale(1), opacity 0→1
Phase 3 (200-500ms): Glow intensiviert (proportional zum Multiplier)
Farbe: <2x gold, 2-4x hell-gold, >4x weiss-gold mit starkem Glow
```

#### Warte-Countdown (Zug-Timer)

```
- Kreisfoermiger Progress-Ring um den "Aufdecken"-Button
- Letzten 5s: Ring wird rot, pulst schneller
- Letzten 3s: Tick-Sound + Ring blinkt
- 0s: Auto-Cash-Out mit spezieller Animation
```

#### Turn Indicator

```
Wenn DU dran bist:
- Dein Avatar bekommt pulsierenden Ring (2s infinite)
- "DEIN ZUG" Banner faehrt von oben ein (translateY -40→0)
- Subtiler Glow auf dem gesamten Spielfeld
- Vibration auf Mobile (navigator.vibrate(50))

Wenn ANDERE dran sind:
- Deren Avatar pulsiert in deren Farbe
- Spielfeld leicht gedimmt (opacity 0.85)
- Buttons disabled (greyed out)
```

### 3.5 Tile-Design

```
VERDECKT:
┌───────┐
│       │  Dunkel, subtile Textur
│   ?   │  Fragezeichen oder Minen-Icon
│       │  Hover: leichter Glow
└───────┘

SICHER (aufgedeckt):
┌───────┐
│  ●2   │  Spieler-Farbrand
│       │  Zahl = benachbarte Minen
│  cyan │  Hintergrund = Spielerfarbe (gedimmt)
└───────┘

MINE (explodiert):
┌───────┐
│  💣   │  Rot pulsierend
│       │  Partikel-Effekt
│  rot  │  Dunkler nach Explosion
└───────┘

MINE (aufgelöst, Ende):
┌───────┐
│  ●    │  Dunkelrot, statisch
│       │  Zeigt wo Minen waren
│ #331  │
└───────┘
```

**Tile-Groessen (responsive):**

| Feld | Mobile (393px) | Tablet (768px) | Desktop (1200px) |
|------|---------------|----------------|------------------|
| 5×5 | 64×64px | 72×72px | 80×80px |
| 6×6 | 52×52px | 60×60px | 68×68px |
| 7×7 | 44×44px | 52×52px | 60×60px |
| 8×8 | 38×38px | 46×46px | 54×54px |

Gap zwischen Tiles: 3-4px (neon-line Effekt im Gap sichtbar)

### 3.6 Sound-Design (Optional, On/Off Toggle)

| Event | Sound | Dauer |
|-------|-------|-------|
| Tile aufdecken (sicher) | Soft digital "click" + aufsteigende Note | 200ms |
| Mine explodiert | Bass-heavy "boom" + Glassplitter | 500ms |
| Cash Out | Coin-Cascade ("ka-ching" × 3) | 600ms |
| Dein Zug | Kurzer Ping (aufsteigende Quinte) | 150ms |
| Timer letzte 5s | Metronom-Tick, beschleunigend | 5s |
| Runde gewonnen | Fanfare (4 aufsteigende Noten) | 800ms |
| Runde verloren | Absteigender Ton + Stille | 400ms |

---

## 4. Multiplayer-Architektur

### 4.1 WebSocket-Protokoll

Baut auf dem bestehenden WS-Hub-Pattern auf (Fastify WebSocket).

**Client → Server:**

```json
// Tisch beitreten
{ "type": "join_table", "table_id": "hustler", "bet_sats": 100 }

// Feld aufdecken
{ "type": "reveal", "game_id": "abc123", "x": 3, "y": 5 }

// Cash Out
{ "type": "cashout", "game_id": "abc123" }

// Lobby verlassen
{ "type": "leave_table" }
```

**Server → Alle im Spiel:**

```json
// Spieler beigetreten
{ "type": "player_joined", "game_id": "abc123", "player": { "npub": "...", "name": "gorilla", "color": "#00d4ff" }, "players_count": 3 }

// Spiel startet
{ "type": "game_start", "game_id": "abc123", "grid_size": 7, "mines_count": 12, "players": [...], "first_turn": "npub_xyz", "grid_hash": "sha256..." }

// Feld aufgedeckt (sicher)
{ "type": "tile_revealed", "game_id": "abc123", "x": 3, "y": 5, "by": "npub_xyz", "adjacent_mines": 2, "multiplier": 1.8, "remaining_safe": 30 }

// Mine getroffen
{ "type": "mine_hit", "game_id": "abc123", "x": 3, "y": 5, "by": "npub_xyz", "lost_sats": 100 }

// Spieler casht aus
{ "type": "player_cashout", "game_id": "abc123", "npub": "npub_xyz", "multiplier": 2.4, "payout_sats": 240 }

// Naechster Zug
{ "type": "turn", "game_id": "abc123", "npub": "npub_xyz", "time_limit": 15 }

// Timer-Tick (jede Sekunde)
{ "type": "turn_tick", "game_id": "abc123", "remaining_s": 8 }

// Spiel vorbei
{ "type": "game_over", "game_id": "abc123", "results": [...], "revealed_grid": [[...]], "mine_positions": [[x,y],...] }
```

**Server → Einzelner Spieler:**

```json
// Dein Zug
{ "type": "your_turn", "game_id": "abc123", "time_limit": 15 }

// Gewinn bestaetigt
{ "type": "payout", "amount_sats": 240, "new_balance": 582 }
```

### 4.2 Server-Side Game State

```javascript
// In-Memory waehrend des Spiels, DB fuer Ergebnisse
const activeGames = new Map(); // game_id → GameInstance

class GameInstance {
  id: string
  table: TableConfig
  grid: number[][]           // -1 = Mine, 0-8 = benachbarte Minen
  gridHash: string           // SHA256 fuer Provably Fair
  serverSeed: string
  players: Map<npub, PlayerState>
  turnOrder: npub[]
  currentTurn: number        // Index in turnOrder
  turnTimer: NodeJS.Timeout
  status: 'waiting' | 'playing' | 'finished'
  revealedTiles: Set<string> // "x,y" → npub der aufgedeckt hat
  pot: number                // Sats im Pot
  createdAt: number
}

class PlayerState {
  npub: string
  displayName: string
  color: string              // Zugewiesene Spielerfarbe
  betSats: number
  revealedCount: number      // Eigene aufgedeckte Felder
  multiplier: number         // Aktueller Multiplier
  status: 'playing' | 'cashout' | 'eliminated'
  payoutSats: number
}
```

### 4.3 Multiplier-Berechnung

Basiert auf der Wahrscheinlichkeit, kein sicheres Feld zu treffen:

```
Nach n eigenen Aufdeckungen auf einem Feld mit T Tiles und M Minen:

p(sicher) = (T - M - aufgedeckt_gesamt) / (T - aufgedeckt_gesamt)

multiplier = (1 / p_kumulativ) × (1 - house_edge)

Beispiel (7×7, 12 Minen, 3 schon aufgedeckt insgesamt):
- Vor deinem 1. Zug: p = (49-12-3)/(49-3) = 34/46 = 73.9%
- Dein Multiplier nach 1 sicher: 1 / 0.739 × 0.97 = ×1.31
- Nach 2 sicher: kumulativ hoeher
```

### 4.4 Provably Fair

```
1. Server generiert: server_seed (32 Bytes random)
2. Server sendet: SHA256(server_seed) als grid_hash bei game_start
3. Client kann eigenen client_seed setzen (optional, default = random)
4. Minenplatzierung: deterministisch aus HMAC-SHA256(server_seed, client_seeds_concat)
5. Nach Spiel-Ende: server_seed wird offengelegt
6. Jeder kann verifizieren: Hash stimmt + Minen-Positionen stimmen
```

---

## 5. Datenmodell

### 5.1 Neue Tabellen

```sql
-- Spiel-Ergebnisse
CREATE TABLE mines_games (
  id            TEXT PRIMARY KEY,          -- UUID
  table_id      TEXT NOT NULL,             -- 'seedling', 'grower', etc.
  grid_size     INTEGER NOT NULL,          -- 5, 6, 7, 8
  mines_count   INTEGER NOT NULL,
  server_seed   TEXT NOT NULL,             -- Offengelegt nach Spielende
  grid_hash     TEXT NOT NULL,             -- SHA256(server_seed)
  pot_sats      INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'waiting',  -- waiting/playing/finished
  started_at    INTEGER,
  finished_at   INTEGER,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Spieler-Teilnahmen
CREATE TABLE mines_players (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id       TEXT NOT NULL REFERENCES mines_games(id),
  npub          TEXT NOT NULL,
  bet_sats      INTEGER NOT NULL,
  color         TEXT NOT NULL,              -- Zugewiesene Farbe
  revealed      INTEGER NOT NULL DEFAULT 0, -- Eigene aufgedeckte Felder
  multiplier    REAL NOT NULL DEFAULT 1.0,
  status        TEXT NOT NULL DEFAULT 'playing', -- playing/cashout/eliminated
  payout_sats   INTEGER NOT NULL DEFAULT 0,
  turn_order    INTEGER NOT NULL,           -- Position in Zugreihenfolge
  UNIQUE(game_id, npub)
);

-- Einzelne Zuege (fuer Replay + Verifikation)
CREATE TABLE mines_moves (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id       TEXT NOT NULL REFERENCES mines_games(id),
  npub          TEXT NOT NULL,
  action        TEXT NOT NULL,              -- 'reveal' oder 'cashout'
  x             INTEGER,                    -- Tile-Position (null bei cashout)
  y             INTEGER,
  result        TEXT,                       -- 'safe', 'mine', 'cashout'
  multiplier    REAL,                       -- Multiplier nach Zug
  created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Spieler-Statistiken (aggregiert)
CREATE TABLE mines_stats (
  npub          TEXT PRIMARY KEY,
  games_played  INTEGER NOT NULL DEFAULT 0,
  games_won     INTEGER NOT NULL DEFAULT 0, -- Ausgecasht (nicht eliminiert)
  total_bet     INTEGER NOT NULL DEFAULT 0,
  total_won     INTEGER NOT NULL DEFAULT 0,
  best_mult     REAL NOT NULL DEFAULT 0,
  streak_current INTEGER NOT NULL DEFAULT 0, -- Aktuelle Gewinnserie
  streak_best   INTEGER NOT NULL DEFAULT 0
);

-- Solo-Spiele (separater Modus)
CREATE TABLE mines_solo (
  id            TEXT PRIMARY KEY,
  npub          TEXT NOT NULL,
  grid_size     INTEGER NOT NULL DEFAULT 5,
  mines_count   INTEGER NOT NULL,
  bet_sats      INTEGER NOT NULL,
  server_seed   TEXT NOT NULL,
  client_seed   TEXT,
  nonce         INTEGER NOT NULL DEFAULT 0,
  revealed      INTEGER NOT NULL DEFAULT 0,
  multiplier    REAL NOT NULL DEFAULT 1.0,
  status        TEXT NOT NULL DEFAULT 'playing', -- playing/cashout/mine
  payout_sats   INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  finished_at   INTEGER
);

-- Indizes
CREATE INDEX idx_mines_games_status ON mines_games(status);
CREATE INDEX idx_mines_players_npub ON mines_players(npub);
CREATE INDEX idx_mines_stats_won ON mines_stats(total_won DESC);
CREATE INDEX idx_mines_solo_npub ON mines_solo(npub);
```

### 5.2 Bestehende Tabellen (wiederverwendet)

- `players` — Nostr-Login, Sats-Balance, Profil
- `lightning_payments` — Deposits
- `withdrawals` — Auszahlungen
- `kv_store` — Bot-State, Config

---

## 6. API-Endpunkte

### Mines-spezifisch

```
GET  /api/mines/tables          — Verfuegbare Tische + wartende Spieler
GET  /api/mines/live             — Laufende Spiele (fuer Spectator)
GET  /api/mines/game/:id         — Spiel-Details (Ergebnis, Zuege, Verifikation)
GET  /api/mines/history          — Eigene Spiel-Historie
GET  /api/mines/stats            — Eigene Statistiken
GET  /api/mines/leaderboard      — Top-Spieler nach Gewinn

POST /api/mines/solo/start       — Solo-Spiel starten { mines, bet_sats }
POST /api/mines/solo/reveal      — Solo: Feld aufdecken { game_id, x, y }
POST /api/mines/solo/cashout     — Solo: Auscashen { game_id }
GET  /api/mines/solo/verify/:id  — Solo: Provably Fair verifizieren
```

Arena-Aktionen laufen komplett ueber WebSocket (Echtzeit).

### Wiederverwendet von Joint Factory

```
POST /api/auth/nostr             — Login (identisch)
POST /api/auth/challenge         — PoW (identisch)
GET  /api/lightning/packs        — Deposit-Optionen
POST /api/lightning/invoice       — Invoice erstellen
POST /api/lightning/webhook       — Zahlung bestaetigen
POST /api/game/withdraw           — Sats auszahlen
GET  /api/player/:npub/public    — Oeffentliches Profil
```

---

## 7. Frontend-Architektur

### 7.1 Projekt-Struktur

```
lightning-mines/
├── server/
│   ├── index.js              — Fastify + WS + Routes
│   ├── db.js                 — SQLite Schema
│   ├── auth.js               — Nostr Auth (kopiert/shared)
│   ├── lightning.js           — LNbits (kopiert/shared)
│   ├── mines-arena.js         — Arena Spiellogik
│   ├── mines-solo.js          — Solo Spiellogik
│   ├── mines-fair.js          — Provably Fair (Seed, Grid, Verify)
│   ├── ws.js                  — WebSocket Hub (erweitert)
│   └── bot.js                 — Nostr-Bot (Gewinner-Posts)
│
├── src/
│   ├── main.tsx
│   ├── App.tsx                — Router
│   ├── lib/
│   │   ├── api.ts
│   │   ├── nostr.ts
│   │   ├── sounds.ts          — Sound-Manager
│   │   └── ws.ts              — WebSocket Client Hook
│   ├── stores/
│   │   ├── AuthProvider.tsx
│   │   ├── GameStore.tsx       — Aktives Spiel-State (Zustand)
│   │   └── LobbyStore.tsx      — Tisch/Lobby-State
│   ├── pages/
│   │   ├── Home.tsx            — Lobby + Live-Ticker
│   │   ├── Arena.tsx           — Arena-Spiel Screen
│   │   ├── Solo.tsx            — Solo-Modus
│   │   ├── Results.tsx         — Ergebnis-Screen
│   │   ├── Profile.tsx         — Stats + History
│   │   ├── Wallet.tsx          — Deposit/Withdraw
│   │   └── Verify.tsx          — Provably Fair Checker
│   ├── components/
│   │   ├── MineGrid.tsx        — Das Spielfeld (Core)
│   │   ├── Tile.tsx            — Einzelne Tile mit Animationen
│   │   ├── PlayerBar.tsx       — Spieler-Leiste (Arena)
│   │   ├── MultiplierDisplay.tsx — Grosser Multiplier
│   │   ├── TurnTimer.tsx       — Countdown-Ring
│   │   ├── ActionButtons.tsx   — Reveal + Cash Out
│   │   ├── TableCard.tsx       — Tisch in der Lobby
│   │   ├── LiveTicker.tsx      — Laufende Spiele
│   │   ├── ResultsBoard.tsx    — Ergebnis-Tabelle
│   │   ├── BetSelector.tsx     — Einsatz-Wahl (Solo)
│   │   ├── MineSlider.tsx      — Minen-Anzahl (Solo)
│   │   ├── Header.tsx
│   │   ├── BottomNav.tsx
│   │   └── ui/                 — Shared UI (Button, Card, etc.)
│   └── animations/
│       ├── explosions.ts       — Canvas Partikel-System
│       ├── confetti.ts         — Gewinn-Konfetti
│       └── shockwave.ts       — Minen-Shockwave
│
├── public/
│   └── sounds/                 — Audio-Dateien
├── package.json
├── vite.config.ts
└── tailwind.config.ts
```

### 7.2 State Management

```
┌─────────────────────────────────────┐
│           AuthProvider              │  Nostr-Login, Sats-Balance
│  (React Context, wie Joint Factory) │
├─────────────────────────────────────┤
│           GameStore (Zustand)       │  Aktives Spiel
│  - gameId, players, grid           │
│  - myTurn, myMultiplier            │
│  - revealedTiles, minePositions    │
│  - status, turnTimer               │
├─────────────────────────────────────┤
│           LobbyStore (Zustand)     │  Tisch-Uebersicht
│  - tables, waitingPlayers          │
│  - liveGames, recentResults        │
├─────────────────────────────────────┤
│           WebSocket Hook           │  Verbindung + Dispatch
│  - useWS() → message handler       │
│  - Auto-reconnect, auth on connect │
└─────────────────────────────────────┘
```

### 7.3 Core Component: MineGrid

```tsx
// Konzept-Pseudocode
function MineGrid({ size, tiles, onReveal, myTurn, players }) {
  return (
    <div className="mine-grid" style={{ gridTemplateColumns: `repeat(${size}, 1fr)` }}>
      {tiles.map((tile, i) => (
        <Tile
          key={i}
          state={tile.state}           // 'hidden' | 'revealed' | 'mine'
          owner={tile.revealedBy}       // npub oder null
          ownerColor={players[tile.revealedBy]?.color}
          adjacentMines={tile.adjacent}
          canClick={myTurn && tile.state === 'hidden'}
          onClick={() => onReveal(tile.x, tile.y)}
          animationDelay={tile.justRevealed ? 0 : null}
        />
      ))}
    </div>
  );
}

// Tile mit 3D-Flip Animation
function Tile({ state, ownerColor, adjacentMines, canClick, onClick }) {
  return (
    <button
      className={cn(
        'tile',
        state === 'hidden' && 'tile-hidden',
        state === 'hidden' && canClick && 'tile-clickable',
        state === 'revealed' && 'tile-safe',
        state === 'mine' && 'tile-mine',
      )}
      style={{
        '--player-color': ownerColor,
        '--player-glow': ownerColor + '80',
      }}
      disabled={!canClick}
      onClick={onClick}
    >
      {state === 'revealed' && adjacentMines > 0 && (
        <span className="tile-number">{adjacentMines}</span>
      )}
      {state === 'mine' && <MineExplosion />}
    </button>
  );
}
```

---

## 8. Nostr-Integration

### Bot-Events

| Event | Kind | Inhalt |
|-------|------|--------|
| Gewinner-Post | 1 | "gorilla just survived 8 mines and cashed out ×3.2 (+320 sats) on Lightning Mines!" |
| Grosser Gewinn (>500 Sats) | 1 | Spezieller Post mit mehr Details + Spielfeld-Snapshot |
| Taegliche Stats | 1 | "24h Stats: 47 arena games, 1,200 sats paid out, biggest win: ×5.1 by nostr" |

### Replay-Sharing

Spieler koennen Ergebnis als Nostr-Note teilen:
```
I just hit ×3.8 on Lightning Mines (7×7, 12 mines)!

Verify: https://mines.jointfactory.io/verify/abc123

#LightningMines #Bitcoin #Nostr
```

---

## 9. Hosting & Deployment

### Option A: Subdomain (empfohlen)

```
mines.jointfactory.io → Port 3422
```
- Eigener PM2-Prozess
- Eigene SQLite-DB
- Shared LNbits-Instance
- Caddy-Eintrag analog zu jointfactory.io

### Option B: Same Origin, Route-basiert

```
jointfactory.io/mines/* → Selber Fastify-Server
```
- Weniger Overhead, aber Code-Kopplung
- Nicht empfohlen fuer ein "komplett neues Projekt"

### Empfehlung: Option A

Eigenes Repo, eigener Prozess, eigene DB. Shared: LNbits, Nostr-Relay, Caddy-Config.

---

## 10. Abgrenzung zu Joint Factory

| Aspekt | Joint Factory | Lightning Mines |
|--------|--------------|-----------------|
| Genre | Idle/Clicker | Strategie/Risiko |
| Tempo | Langsam (Stunden) | Schnell (Minuten) |
| Multiplayer | Indirekt (Leaderboard) | Direkt (geteiltes Feld) |
| Sats-Einsatz | Lottery-Tickets (indirekt) | Direkter Einsatz |
| Session-Laenge | Endlos (Idle) | 2-5 Minuten pro Runde |
| Skill-Faktor | Optimierung | Risiko-Bewertung |
| Suchtmechanik | Progression | Spannungskurve |
| Zielgruppe | Casual, Nostr-Einsteiger | Gambling-affin, Wettbewerb |

---

## 11. MVP-Scope (Phase 1)

Fuer den ersten Launch reicht:

1. **Solo Mode** — Provably Fair, Sats-Einsatz, 5×5 Grid
2. **Nostr Login** — Identisch zu Joint Factory
3. **Lightning Wallet** — Deposit + Withdraw
4. **Basis-UI** — Grid, Tiles, Multiplier, Cash Out
5. **Leaderboard** — Top-Spieler nach Gewinn
6. **Provably Fair Page** — Seed-Verifikation

**Nicht in Phase 1:**
- Arena Mode (Phase 2)
- Spectator Mode (Phase 3)
- Sound (Phase 2)
- Nostr-Bot Posts (Phase 2)
- Partikel-Animationen (Phase 2, CSS-only in Phase 1)

**Geschaetzter Aufwand Phase 1:** 3-5 Tage

---

## 12. Zusammenfassung

Lightning Mines erweitert das Joint Factory Universum um ein schnelles, spannendes Multiplayer-Erlebnis. Die technische Basis (Nostr Auth, Lightning Wallet, WebSocket) ist bereits vorhanden und muss nur portiert werden. Der Kern-Mehrwert ist das Arena-Format: Echte Spieler auf einem geteilten Minenfeld, mit echten Sats auf dem Spiel, in Echtzeit. Das existiert nirgendwo im Bitcoin/Nostr-Oekosystem.

**Einzigartige Selling Points:**
- Einziges Multiplayer-Minesweeper mit Lightning
- Nostr-native (kein Account, keine Email)
- Provably Fair (verifizierbar)
- Visuell ansprechend (Neon-Aesthetic, Animationen)
- Schnelle Runden (2-5 Min) → hohe Retention
- Social (Spectator, Nostr-Sharing, Arena-Pressure)
