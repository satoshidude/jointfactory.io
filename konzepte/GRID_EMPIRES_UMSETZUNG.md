# Grid Empires — Technisches & Visuelles Umsetzungskonzept

Eigenstaendiges Projekt. Nostr + Lightning native.
Stand: 2026-03-13

---

## 1. Projektstruktur

```
grid-empires/
├── server/
│   ├── index.js              — Fastify + WS + Routen
│   ├── db.js                 — SQLite Schema + Migrations
│   ├── auth.js               — Nostr Login (NIP-07/NIP-98) [von JF]
│   ├── lightning.js           — LNbits Deposit + Zap-Payouts [erweitert]
│   ├── world.js               — Karten-Generator, Hex-Welt, Terrain
│   ├── actions.js             — Aktions-System (Angriff, Verschieben, Upgrade, Spaeher)
│   ├── combat.js              — Kampf-Resolver, Verlust-Berechnung
│   ├── production.js          — Truppen-Produktion (Idle-Tick)
│   ├── rounds.js              — Runden-Management, Ranking, Auszahlung
│   ├── diplomacy.js           — Allianzen, Friedensvertraege, Kopfgelder
│   ├── bots.js                — Bot-AI, Strategie-Typen
│   ├── zap.js                 — Nostr-Bot, Announcements, Zap-Payouts
│   ├── ws.js                  — WebSocket Hub
│   └── cron.js                — Timer: Produktions-Tick, Aktions-Queue, Runden
│
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── lib/
│   │   ├── api.ts
│   │   ├── nostr.ts           — NIP-07, NIP-98 [von JF]
│   │   ├── ws.ts              — WebSocket Client
│   │   ├── hex.ts             — Hex-Grid Mathe (Cube Coords, Neighbors, Pathfinding)
│   │   ├── fog.ts             — Fog of War Berechnung (Client-Side)
│   │   └── format.ts
│   ├── stores/
│   │   ├── AuthProvider.tsx    — Nostr Auth Context [von JF]
│   │   ├── MapStore.ts        — Zustand: Karte, Fog, sichtbare Regionen
│   │   ├── EmpireStore.ts     — Zustand: eigene Regionen, Truppen, Aktionen
│   │   ├── RoundStore.ts      — Zustand: Runde, Timer, Ranking
│   │   └── DiplomacyStore.ts  — Zustand: Allianzen, Kopfgelder
│   ├── pages/
│   │   ├── WarMap.tsx          — Hauptscreen: Hex-Karte mit Fog of War
│   │   ├── Empire.tsx          — Eigenes Imperium: Regionen, Truppen, Upgrades
│   │   ├── Diplomacy.tsx       — Allianzen, Vertraege, Kopfgelder
│   │   ├── RoundInfo.tsx       — Runden-Status, Ranking, Pot
│   │   ├── BattleLog.tsx       — Kampf-Verlauf, Replay
│   │   ├── Wallet.tsx          — Deposit + Zap-History
│   │   ├── Profile.tsx
│   │   └── Info.tsx
│   ├── components/
│   │   ├── HexGrid.tsx         — Canvas-basierter Hex-Renderer mit Fog
│   │   ├── HexTile.tsx         — Tile: Terrain + Owner + Truppen
│   │   ├── FogOverlay.tsx      — Fog of War Layer (Canvas)
│   │   ├── TroopBadge.tsx      — Truppen-Anzeige auf Hex
│   │   ├── ActionMenu.tsx      — Radial-Menue bei Tap auf eigene Region
│   │   ├── AttackArrow.tsx     — Animierte Angriffs-Linie
│   │   ├── CombatResult.tsx    — Kampf-Ergebnis Overlay
│   │   ├── ActionQueue.tsx     — Queue-Anzeige (verbleibende Aktionen)
│   │   ├── RoundTimer.tsx      — Runden-Countdown
│   │   ├── AllianceBadge.tsx   — Allianz-Markierung auf Karte
│   │   ├── BountyBoard.tsx     — Kopfgeld-Uebersicht
│   │   ├── Header.tsx
│   │   ├── BottomNav.tsx
│   │   └── ui/
│   └── animations/
│       ├── combat.ts           — Kampf-Effekte (Blitze, Schwerter)
│       ├── conquer.ts          — Eroberungs-Uebergang (Farbwechsel)
│       ├── march.ts            — Truppen-Bewegung auf Karte
│       └── fog.ts              — Fog reveal/hide Transitions
│
├── public/
│   └── sprites/                — Terrain-Texturen, Truppen-Icons, Wappen
├── package.json
├── vite.config.ts
└── tailwind.config.ts
```

---

## 2. Datenbank-Schema

```sql
-- Spieler
CREATE TABLE players (
  npub                TEXT PRIMARY KEY,
  display_name        TEXT,
  avatar              TEXT,
  lightning_address   TEXT,           -- Fuer Zap-Payouts!
  nip05               TEXT,
  sats                INTEGER NOT NULL DEFAULT 0,
  color               TEXT,            -- Zugewiesene Imperiums-Farbe
  rounds_played       INTEGER NOT NULL DEFAULT 0,
  rounds_won          INTEGER NOT NULL DEFAULT 0,
  total_conquests     INTEGER NOT NULL DEFAULT 0,
  total_sats_won      INTEGER NOT NULL DEFAULT 0,
  is_bot              INTEGER NOT NULL DEFAULT 0,
  invite_code         TEXT UNIQUE,
  referred_by         TEXT,
  created_at          INTEGER NOT NULL DEFAULT (unixepoch()),
  last_seen_at        INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Runden
CREATE TABLE rounds (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  map_seed            TEXT NOT NULL,       -- Seed fuer deterministische Karten-Generierung
  map_size            INTEGER NOT NULL,    -- Hex-Radius
  status              TEXT NOT NULL DEFAULT 'active',  -- active/finished
  pot_sats            INTEGER NOT NULL DEFAULT 0,
  starts_at           INTEGER NOT NULL,
  ends_at             INTEGER NOT NULL,    -- starts_at + 48h
  winner_npub         TEXT,                -- >50% Karte → fruehes Ende
  finished_at         INTEGER
);

-- Hex-Karte (pro Runde)
CREATE TABLE map_hexes (
  round_id            INTEGER NOT NULL,
  q                   INTEGER NOT NULL,
  r                   INTEGER NOT NULL,
  terrain             TEXT NOT NULL,        -- plain/mountain/forest/water/city
  owner_npub          TEXT,                 -- NULL = neutral
  troops              INTEGER NOT NULL DEFAULT 0,
  garrison_max        INTEGER NOT NULL,     -- Je nach Terrain
  production_rate     INTEGER NOT NULL,     -- Truppen/h
  fortified           INTEGER NOT NULL DEFAULT 0,  -- 0 oder 1
  fortified_sats      INTEGER NOT NULL DEFAULT 0,  -- Sats-Festung (extra stark)
  PRIMARY KEY (round_id, q, r)
);
CREATE INDEX idx_hexes_round_owner ON map_hexes(round_id, owner_npub);

-- Spieler-Runden-State
CREATE TABLE round_players (
  round_id            INTEGER NOT NULL,
  npub                TEXT NOT NULL,
  capital_q           INTEGER NOT NULL,
  capital_r           INTEGER NOT NULL,
  regions_count       INTEGER NOT NULL DEFAULT 1,
  total_troops        INTEGER NOT NULL DEFAULT 0,
  conquests           INTEGER NOT NULL DEFAULT 0,
  losses              INTEGER NOT NULL DEFAULT 0,
  morale              REAL NOT NULL DEFAULT 1.0,   -- 0.5 - 1.3
  actions_available   INTEGER NOT NULL DEFAULT 3,
  actions_next_refill INTEGER NOT NULL,             -- Unix timestamp
  is_eliminated       INTEGER NOT NULL DEFAULT 0,
  rank                INTEGER,
  payout_sats         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (round_id, npub)
);

-- Aktions-Queue
CREATE TABLE action_queue (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id            INTEGER NOT NULL,
  npub                TEXT NOT NULL,
  action_type         TEXT NOT NULL,        -- attack/move/upgrade/scout/mercenary
  params              TEXT NOT NULL,         -- JSON: {from_q, from_r, to_q, to_r, ...}
  status              TEXT NOT NULL DEFAULT 'queued',  -- queued/executing/done/failed
  execute_at          INTEGER NOT NULL DEFAULT (unixepoch()),
  result              TEXT,                  -- JSON: Kampf-Ergebnis etc.
  created_at          INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_queue_execute ON action_queue(round_id, status, execute_at);

-- Kampf-Log
CREATE TABLE battles (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id            INTEGER NOT NULL,
  attacker_npub       TEXT NOT NULL,
  defender_npub       TEXT,                  -- NULL = neutral
  hex_q               INTEGER NOT NULL,
  hex_r               INTEGER NOT NULL,
  attacker_troops     INTEGER NOT NULL,
  defender_troops     INTEGER NOT NULL,
  attacker_morale     REAL NOT NULL,
  defender_morale     REAL NOT NULL,
  terrain_bonus       REAL NOT NULL DEFAULT 1.0,
  fortification_bonus REAL NOT NULL DEFAULT 1.0,
  result              TEXT NOT NULL,          -- 'attacker_wins' oder 'defender_wins'
  attacker_losses     INTEGER NOT NULL,
  defender_losses     INTEGER NOT NULL,
  conquered           INTEGER NOT NULL DEFAULT 0,
  created_at          INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_battles_round ON battles(round_id);

-- Allianzen
CREATE TABLE alliances (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id            INTEGER NOT NULL,
  player1_npub        TEXT NOT NULL,
  player2_npub        TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending',  -- pending/active/broken
  created_at          INTEGER NOT NULL DEFAULT (unixepoch()),
  broken_at           INTEGER,
  broken_by           TEXT                    -- npub des Verraeter
);

-- Kopfgelder
CREATE TABLE bounties (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id            INTEGER NOT NULL,
  poster_npub         TEXT NOT NULL,
  target_npub         TEXT NOT NULL,
  amount_sats         INTEGER NOT NULL,
  status              TEXT NOT NULL DEFAULT 'active',  -- active/claimed/expired
  claimed_by          TEXT,
  created_at          INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Zap-Payouts (identisch zu Garden)
CREATE TABLE zap_payouts (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  npub                TEXT NOT NULL,
  amount_sats         INTEGER NOT NULL,
  reason              TEXT NOT NULL,
  lightning_address   TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending',
  payment_hash        TEXT,
  created_at          INTEGER NOT NULL DEFAULT (unixepoch()),
  sent_at             INTEGER
);

-- Lightning Deposits (von JF)
CREATE TABLE lightning_payments (
  payment_hash        TEXT PRIMARY KEY,
  npub                TEXT NOT NULL,
  amount_sats         INTEGER NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending',
  created_at          INTEGER NOT NULL DEFAULT (unixepoch()),
  paid_at             INTEGER
);

-- KV Store
CREATE TABLE kv_store (
  key                 TEXT PRIMARY KEY,
  value               TEXT
);
```

---

## 3. Server-Logik

### 3.1 Karten-Generator (world.js)

Deterministische Generierung aus `map_seed`:

```
function generateMap(seed, radius) {
  const rng = seedRandom(seed);

  for each hex (q, r) within radius:
    // Perlin-Noise fuer Terrain
    noise = perlinNoise(q, r, rng);

    if noise < -0.3:     terrain = 'water'      // ~15% — unpassierbar
    else if noise < 0.0:  terrain = 'forest'     // ~15% — Tarnung
    else if noise < 0.5:  terrain = 'plain'      // ~35% — Standard
    else if noise < 0.8:  terrain = 'mountain'   // ~20% — Verteidigung
    else:                  terrain = 'city'       // ~15% — Produktion

  // Hauptstaedte platzieren: max. Abstand voneinander
  // Neutrale Garnisonen: 3-8 Truppen auf allen nicht-Wasser Hexes
}
```

**Terrain-Werte:**

| Terrain | Produktion/h | Max Garnison | Verteidigungsbonus | Besonderheit |
|---------|-------------|-------------|-------------------|--------------|
| Plain | 2 | 20 | ×1.0 | Standard |
| Forest | 1 | 15 | ×1.2 | Unsichtbar fuer Feind (kein Truppen-Count) |
| Mountain | 1 | 25 | ×1.5 | Schwer einzunehmen |
| City | 4 | 40 | ×1.0 | Doppelte Produktion |
| Capital | 3 | 50 | ×1.3 | Nicht verlierbar (Spieler erst eliminiert wenn 0 andere Regionen) |
| Water | — | — | — | Unpassierbar |

### 3.2 Aktions-Verarbeitung (actions.js)

Laeuft jede Minute via Cron:

```
1. Aktions-Refill pruefen:
   - Alle Spieler mit actions_next_refill <= now
   - actions_available = min(6, actions_available + 3)
   - actions_next_refill = now + 3600

2. Queue abarbeiten:
   - SELECT * FROM action_queue WHERE status = 'queued' AND execute_at <= now ORDER BY execute_at
   - Fuer jede Aktion:

   ATTACK:
     a. Validierung: Quell-Region gehoert Spieler, hat Truppen, Ziel benachbart
     b. Truppen aufteilen: 80% greifen an, 20% bleiben als Garnison
     c. Kampf aufloesen (combat.js)
     d. Ergebnis speichern (battles), Karte updaten
     e. Moral anpassen
     f. WS Broadcast an betroffene Spieler

   MOVE:
     a. Validierung: Beide Regionen gehoeren Spieler, benachbart
     b. Truppen verschieben
     c. WS Update

   UPGRADE:
     a. Region befestigen: fortified = 1 (+25% Verteidigung)
     b. Oder Produktion +1/h (max 2 Upgrades pro Region)

   SCOUT:
     a. Alle Hexes in 3er-Radius temporaer sichtbar (1h)
     b. WS: Fog-Reveal fuer Spieler

   MERCENARY:
     a. Sats von Spieler abziehen
     b. 10-50 Truppen sofort in Region
     c. 80% der Sats → Runden-Pot
```

### 3.3 Kampf-Resolver (combat.js)

```
function resolveCombat(attacker, defender, hex) {
  // Staerke berechnen
  const atkStrength = attacker.troops * attacker.morale;
  const defStrength = defender.troops * defender.morale
                      * hex.terrainBonus
                      * (hex.fortified ? 1.25 : 1.0)
                      * (hex.fortified_sats > 0 ? 1.5 : 1.0);

  // Ergebnis
  const attackerWins = atkStrength > defStrength;
  const ratio = attackerWins
    ? defStrength / atkStrength    // 0..1 (je naeher an 1, desto knapper)
    : atkStrength / defStrength;

  // Verluste (proportional zur Knappheit)
  const winnerLossPct = 0.2 + ratio * 0.3;   // 20-50%
  const loserLossPct  = 0.6 + ratio * 0.2;   // 60-80%

  return {
    result: attackerWins ? 'attacker_wins' : 'defender_wins',
    attacker_losses: floor(attacker.troops * (attackerWins ? winnerLossPct : loserLossPct)),
    defender_losses: floor(defender.troops * (attackerWins ? loserLossPct : winnerLossPct)),
    conquered: attackerWins
  };
}
```

### 3.4 Truppen-Produktion (production.js)

Laeuft alle 10 Minuten via Cron:

```
// Alle kontrollierten Regionen produzieren (1/6 der Stundenrate pro 10-Min-Tick)
UPDATE map_hexes
SET troops = MIN(troops + CEIL(production_rate / 6.0), garrison_max)
WHERE round_id = ? AND owner_npub IS NOT NULL AND troops < garrison_max;
```

Produktion laeuft immer — online und offline. Kein Client noetig.

### 3.5 Runden-Ende (rounds.js)

**Trigger:** Cron prueft jede Minute.

```
// Fruehes Ende: >50% der Karte
SELECT owner_npub, COUNT(*) as regions
FROM map_hexes WHERE round_id = ? AND owner_npub IS NOT NULL
GROUP BY owner_npub
HAVING regions > (total_hexes * 0.5);

// Oder: Zeitlimit erreicht (48h)
```

**Abrechnung:**

```
1. Ranking berechnen:
   Score = regions_count × 10 + conquests × 5 + total_troops

2. Pot verteilen (80% Auszahlung, 20% House):
   Platz 1: 40% vom Pot
   Platz 2: 25%
   Platz 3: 15%
   Platz 4-5: je 5%
   "Ueberlebende" (>5 Regionen): je 2% (Rest)

3. Sats-Payouts via Zap:
   - Fuer jeden Gewinner: zapPayout(npub, amount, 'round_rank')
   - Offene Kopfgelder: zurueck an Poster

4. Nostr Announcement:
   "Round #12 ended! Winner: gorilla (47 regions, 230 troops).
    Top 5: gorilla +100⚡, nostr +60⚡, scout +35⚡..."

5. Neue Runde starten:
   - Neuer map_seed
   - Karte generieren
   - Aktive Spieler automatisch einschreiben
   - Bots platzieren
```

### 3.6 Zap-Payout System (lightning.js)

Identisch zum Garden — gewonnene Sats gehen als Zap raus:

```
Payout-Trigger:

| Event                     | Timing          | Empfaenger           |
|---------------------------|-----------------|----------------------|
| Runden-Ranking Top 5      | Bei Rundenende  | Top 5 Spieler        |
| Kopfgeld kassiert          | Sofort          | Eliminierer          |
| Friedensvertrag            | Sofort          | Vertrags-Empfaenger  |

Flow:
1. Player hat lightning_address? → Zap via LNbits LNURL-Pay
2. Kein LN-Address? → Intern gutschreiben (Fallback)
3. Zap fehlgeschlagen? → Retry 3×, dann intern gutschreiben
4. WS Notification: { type: 'zap_received', amount_sats, reason }
5. Optional: NIP-57 Zap Receipt auf Nostr publishen
```

### 3.7 Bot-AI (bots.js)

```
// Alle 10 Minuten (zusammen mit Produktions-Tick)
function botTick(round_id) {
  const bots = getActiveBots(round_id);

  for (const bot of bots) {
    // Aktionen verbrauchen (wie echte Spieler, 3/h)
    if (bot.actions_available <= 0) continue;

    switch (bot.type) {
      case 'farmer':
        // Expandiere in neutrale Nachbar-Regionen (schwaechste zuerst)
        // Greife nie echte Spieler an
        // Upgrade Regionen wenn nichts zum Expandieren
        expandToNeutral(bot, round_id);
        break;

      case 'guardian':
        // Halte 5-8 Regionen stabil
        // Verschiebe Truppen zur bedrohten Grenze
        // Greife nur an wenn stark ueberlegen (3:1)
        defendAndHold(bot, round_id);
        break;

      case 'barbarian':
        // Expandiere aggressiv (auch gegen echte Spieler)
        // Greife schwaechsten Nachbarn an
        // Schlechte Verteidigung (verteilt Truppen duenn)
        aggressiveExpand(bot, round_id);
        break;

      case 'emperor':
        // Balanced: Expand + Defend + Upgrade
        // Bildet Allianzen mit anderen Bots
        // Greift isolierte Spieler an
        strategicPlay(bot, round_id);
        break;
    }
  }
}
```

**Bot-Skalierung pro Runde:**

| Echte Spieler | Farmer | Guardian | Barbarian | Emperor | Karte |
|--------------|--------|----------|-----------|---------|-------|
| 1-3 | 3 | 2 | 2 | 1 | Radius 8 (~200 Hexes) |
| 4-10 | 2 | 1 | 2 | 1 | Radius 10 (~300 Hexes) |
| 11-30 | 1 | 1 | 1 | 0 | Radius 12 (~430 Hexes) |
| 31+ | 0 | 1 | 0 | 0 | Radius 14 (~580 Hexes) |

---

## 4. API-Endpunkte

```
AUTH (von JF)
  POST /api/auth/challenge
  POST /api/auth/nostr

KARTE
  GET  /api/map/visible             — Sichtbare Hexes (eigene + Radius, ohne Fog)
  GET  /api/map/full                — Komplette Karte (nur Terrain, ohne Truppen/Owner im Fog)

AKTIONEN
  POST /api/action/attack           — { from_q, from_r, to_q, to_r }
  POST /api/action/move             — { from_q, from_r, to_q, to_r }
  POST /api/action/upgrade          — { q, r, type: 'fortify' | 'production' }
  POST /api/action/scout            — { q, r, direction_q, direction_r }
  POST /api/action/mercenary        — { q, r, amount: 10|25|50 }
  GET  /api/action/queue            — Eigene gequeuete Aktionen

IMPERIUM
  GET  /api/empire/status           — Eigene Regionen, Truppen, Moral, Aktionen
  GET  /api/empire/log              — Kampf-Log (letzte 50)
  GET  /api/empire/summary          — "Waehrend du weg warst..." Zusammenfassung

DIPLOMATIE
  POST /api/diplomacy/alliance      — Allianz-Anfrage { target_npub }
  POST /api/diplomacy/respond       — Annehmen/Ablehnen { alliance_id, accept }
  POST /api/diplomacy/bounty        — Kopfgeld setzen { target_npub, amount_sats }
  GET  /api/diplomacy/alliances     — Aktive Allianzen
  GET  /api/diplomacy/bounties      — Offene Kopfgelder

RUNDE
  GET  /api/round/current           — Aktuelle Runde + Timer + Pot
  GET  /api/round/ranking           — Live-Ranking
  GET  /api/round/history           — Vergangene Runden

LIGHTNING (identisch zu Garden)
  GET  /api/lightning/packs
  POST /api/lightning/invoice
  POST /api/lightning/webhook
  GET  /api/player/payouts

PROFIL
  GET  /api/player/stats
  POST /api/player/profile
  GET  /api/player/:npub/public
  GET  /api/leaderboard             — Allzeit-Ranking

WEBSOCKET
  /ws
```

---

## 5. WebSocket-Protokoll

**Client → Server:**
```json
{ "type": "auth", "npub": "..." }
{ "type": "viewport", "center_q": 0, "center_r": 0, "radius": 8 }
```

**Server → Betroffene Spieler (Sichtbereich):**
```json
// Kampf stattgefunden
{
  "type": "battle",
  "q": 5, "r": -3,
  "attacker": { "npub": "...", "name": "gorilla", "troops_before": 15, "losses": 4 },
  "defender": { "npub": "...", "name": "nostr", "troops_before": 8, "losses": 8 },
  "result": "attacker_wins",
  "conquered": true
}

// Region erobert (Farbwechsel auf Karte)
{ "type": "region_changed", "q": 5, "r": -3, "new_owner": "npub...", "color": "#ff8800", "troops": 11 }

// Truppen bewegt
{ "type": "troops_moved", "from_q": 3, "from_r": 0, "to_q": 4, "to_r": 0, "npub": "...", "count": 10 }

// Fog reveal (Scout)
{ "type": "fog_reveal", "hexes": [{"q":1,"r":2,"terrain":"mountain","owner":"npub...","troops":12}, ...], "duration_s": 3600 }
```

**Server → Einzelner Spieler:**
```json
// Du wurdest angegriffen
{ "type": "attacked", "q": 5, "r": -3, "by": "npub...", "by_name": "barbarian", "result": "defender_wins", "troops_lost": 3 }

// Region verloren
{ "type": "region_lost", "q": 5, "r": -3, "to": "npub...", "to_name": "gorilla" }

// Aktionen aufgefuellt
{ "type": "actions_refilled", "available": 6 }

// Zap erhalten
{ "type": "zap_received", "amount_sats": 100, "reason": "round_rank_1" }

// Kopfgeld auf dich gesetzt
{ "type": "bounty_placed", "by_name": "nostr", "amount_sats": 15 }

// "Waehrend du weg warst"
{ "type": "absence_summary", "attacks_received": 3, "attacks_repelled": 2, "regions_lost": 1, "troops_produced": 45 }
```

**Server → Alle (Broadcast):**
```json
// Runden-Ticker (alle 60s)
{ "type": "round_tick", "remaining_s": 84200, "pot_sats": 340, "players_active": 18, "top_player": "gorilla", "top_regions": 23 }

// Grosser Kampf (>20 Truppen beteiligt)
{ "type": "major_battle", "attacker_name": "gorilla", "defender_name": "nostr", "result": "attacker_wins", "total_troops": 38 }

// Spieler eliminiert
{ "type": "player_eliminated", "npub": "...", "name": "boyscout", "by": "gorilla", "regions_absorbed": 5 }

// Runde vorbei
{ "type": "round_over", "winner": "gorilla", "rankings": [...], "pot_sats": 340 }
```

---

## 6. Visuelles Konzept

### 6.1 Hex-Grid Rendering

**Technologie:** HTML Canvas (2D Context), Fog als separater Layer.

```
Hex-Groesse: 40px Radius (flat-top)
Sichtbar: ~8-10 Hex Radius (~200-300 Hexes)
Fog of War: Dunkle Overlay-Tiles, nur eigene + Radius 1 aufgedeckt
Zoom: 3 Stufen (Pinch-Zoom)
Pan: Touch-Drag, Inertia
```

### 6.2 Farbpalette

| Element | Farbe | Hex |
|---------|-------|-----|
| **Terrain: Plain** | Olivgruen | `#2a3a1a` |
| **Terrain: Forest** | Tiefgruen | `#1a2a12` |
| **Terrain: Mountain** | Steingrau | `#3a3a3a` |
| **Terrain: City** | Warm Braun | `#3a2a1a` mit goldenen Akzenten |
| **Terrain: Water** | Dunkelblau | `#0a1a2a` |
| **Terrain: Capital** | Spielerfarbe + Krone | Intensiver als normal |
| **Fog of War** | Schwarz, 85% Opazitaet | `rgba(5,5,10,.85)` |
| **Fog-Rand** | Weicher Gradient | 3px Blur am Rand |
| **Eigenes Imperium** | Spielerfarbe (zugewiesen) | Satte Variante |
| **Feindliches Imperium** | Deren Farbe | Sichtbar nur ohne Fog |
| **Neutrales Gebiet** | Grau-Braun | `#4a4a3a` |
| **Truppen-Badge** | Weiss auf dunklem Kreis | Zahl zentriert |
| **Befestigung** | Schild-Icon + Steinrand | Hellgrau |
| **Kampf-Effekt** | Rot-Orange Blitz | `#ff4400` |
| **UI Background** | Tiefes Blau-Schwarz | `#08080f` |
| **UI Cards** | Dunkles Schieferblau | `rgba(16,18,28,.92)` |
| **Text Primary** | Silber-Weiss | `#d0d4e0` |
| **Text Secondary** | Blaugrau | `#6a6e80` |
| **Sats Gold** | Wie JF | `#ffd700` |
| **Danger Red** | Kampf, Verlust | `#ff3344` |
| **Alliance Blue** | Allianz-Markierung | `#4488ff` |

**Spielerfarben (Pool, wird bei Beitritt zugewiesen):**
```
#ff4444 (Rot), #ff8800 (Orange), #ffcc00 (Gelb),
#44cc44 (Gruen), #00cccc (Teal), #4488ff (Blau),
#8844ff (Violett), #ff44cc (Pink), #cc8844 (Bronze),
#88ccff (Hellblau)
```

### 6.3 Hex-Tile Darstellung

```
┌───────────────────────┐
│  TERRAIN-TEXTUR       │  Farbe je nach Typ
│                       │
│   ⛰️ / 🏰 / 🌲       │  Terrain-Icon (klein, zentriert)
│                       │
│   [12]                │  Truppen-Badge (rechts unten)
│   ═══                 │  Befestigungs-Markierung (falls vorhanden)
│                       │
│  ▬▬▬ SPIELERFARBE ▬▬▬ │  Rand in Spielerfarbe (3px)
└───────────────────────┘

Im Fog:
┌───────────────────────┐
│ ░░░░░░░░░░░░░░░░░░░░ │  Dunkel, undurchsichtig
│ ░░░░░░░░░░░░░░░░░░░░ │  Terrain-Typ sichtbar (Silhouette)
│ ░░░░░ ⛰️ ░░░░░░░░░░░ │  Keine Truppen, kein Owner
│ ░░░░░░░░░░░░░░░░░░░░ │
└───────────────────────┘
```

### 6.4 Animationen

**Kampf (auf Hex):**
```css
@keyframes battle-clash {
  0%   { filter: brightness(1); }
  15%  { filter: brightness(2); box-shadow: 0 0 20px #ff4400; }
  30%  { filter: brightness(0.8); }
  50%  { filter: brightness(1.5); box-shadow: 0 0 30px #ff4400; }
  100% { filter: brightness(1); box-shadow: none; }
}
/* 800ms, + Schwerter-Kreuz Icon kurz einblenden */
```

**Eroberung (Farbwechsel):**
```css
@keyframes conquer-wave {
  0%   { /* Alte Farbe */ }
  30%  { filter: brightness(0.3); /* Kurz dunkel */ }
  60%  { /* Neue Farbe fadet ein */ opacity: 0.5; }
  100% { /* Neue Farbe voll */ opacity: 1; }
}
/* 600ms ease-out, von Angriffsrichtung her */
```

**Truppen-Marsch (Hex zu Hex):**
```css
/* SVG-Linie von Quell-Hex zu Ziel-Hex */
@keyframes march-line {
  0%   { stroke-dashoffset: 100%; stroke: var(--player-color); }
  100% { stroke-dashoffset: 0%; }
}
/* 400ms, + kleine Truppen-Icons entlang der Linie */
```

**Fog Reveal (Scout):**
```css
@keyframes fog-dissolve {
  0%   { opacity: 0.85; }
  100% { opacity: 0; }
}
/* 500ms pro Hex, gestaffelt vom Zentrum nach aussen */
```

**Region verloren (Notification):**
```css
@keyframes alert-shake {
  0%, 100% { transform: translateX(0); }
  20%      { transform: translateX(-4px); }
  40%      { transform: translateX(4px); }
  60%      { transform: translateX(-2px); }
  80%      { transform: translateX(2px); }
}
/* 400ms + roter Flash am oberen Rand */
```

### 6.5 Mobile Screens (393×852)

#### Hauptscreen: Weltkarte

```
┌─────────────────────────────┐
│ ⚔ GRID EMPIRES  R#12 · 68⚡│  Runde + Sats
├─────────────────────────────┤
│ ┌───────────────────────┐   │
│ │ Aktionen: ●●●○○○ 3/6 │   │  Aktions-Leiste
│ │ Naechste in 42 Min    │   │
│ └───────────────────────┘   │
│                             │
│    ░░░░░░╱╲░░░░░░          │  Hex-Karte mit Fog
│   ░░░░░╱12╲░░░░░          │
│    ░░░╱╲──╱╲░░░            │  Eigene: Farbe + Truppen
│   ░░╱ 8╲╱15╲░░            │  Feind: Deren Farbe
│    ╱╲──╱╲──╱╲              │  Fog: Dunkel
│   ╱ 5╲╱20╲╱ 6╲            │
│   ╲──╱╲──╱╲──╱             │  Tap: Auswahl
│    ╲╱ 3╲╱18╲╱              │  Long-Press: Aktionsmenue
│     ╲──╱╲──╱               │
│      ╲╱  ╲╱                │
│                             │
│  ┌─────────────────────┐    │  Mini-Info Footer
│  │ Pot: 340⚡ · 18 Spieler│  │
│  │ Ende in 1d 14h       │   │
│  │ Du: #3 · 12 Regionen │   │
│  └─────────────────────┘    │
│                             │
├─────────────────────────────┤
│  Map · Empire · Diplo · Me  │
└─────────────────────────────┘
```

#### Aktionsmenue (Long-Press auf eigene Region)

```
        ┌─────────┐
        │  SCOUT  │
        └────┬────┘
 ┌───────┐   │   ┌────────┐
 │ MOVE  │───●───│ ATTACK │     Radial-Menue
 └───────┘   │   └────────┘     um die Region
        ┌────┴────┐
        │UPGRADE  │
        └─────────┘

Tap auf "ATTACK" → Nachbar-Hexes blinken als Ziele
Tap auf Ziel → Bestaetigung + Kampf-Vorschau
```

**Kampf-Vorschau (vor Bestaetigung):**
```
┌───────────────────────────┐
│       KAMPF-VORSCHAU      │
├───────────────────────────┤
│                           │
│  DU          vs    nostr  │
│  15 Truppen      8 Trpn  │
│  ×1.1 Moral     ×1.0     │
│                  ×1.5 Berg│
│                           │
│  Deine Staerke:  16.5     │
│  Feind Staerke:  12.0     │
│  Chance:  ~72%            │
│                           │
│  [ANGREIFEN]  [ABBRECHEN] │
└───────────────────────────┘
```

#### Empire Screen

```
┌─────────────────────────────┐
│         DEIN IMPERIUM       │
├─────────────────────────────┤
│                             │
│  ┌───────────┬───────────┐  │
│  │ Regionen  │ Truppen   │  │
│  │    12     │   186     │  │
│  ├───────────┼───────────┤  │
│  │ Moral     │ Eroberungen│ │
│  │  ×1.15    │    8      │  │
│  └───────────┴───────────┘  │
│                             │
│  REGIONEN (sortiert):       │
│  ┌─────────────────────┐    │
│  │ ⛰ Berg (3,-1) · 25  │   │  Terrain, Coords, Truppen
│  │ ═ Befestigt · +2/h  │   │  Status + Produktion
│  ├─────────────────────┤    │
│  │ 🏰 Stadt (5,0) · 38 │   │
│  │ +4/h · Upgrade mgl. │   │
│  ├─────────────────────┤    │
│  │ 🌲 Wald (4,-1) · 12 │   │
│  │ Getarnt · +1/h      │   │
│  └─────────────────────┘    │
│                             │
│  KAMPF-LOG                  │
│  ⚔ nostr griff (3,-1) an   │
│    Abgewehrt! -3 Truppen    │  Farbcodiert
│  ⚔ Du erobertest (5,0)      │
│    Stadt! +4/h Produktion   │  Gruen = Sieg
│                             │
├─────────────────────────────┤
│  Map · Empire · Diplo · Me  │
└─────────────────────────────┘
```

#### Runden-Ende Screen

```
┌─────────────────────────────┐
│        RUNDE #12 VORBEI     │
├─────────────────────────────┤
│                             │
│     ┌─────────────────┐     │
│     │   DU: PLATZ 3    │    │  Grosser Rang
│     │   +35 ⚡ GEZAPPT │    │  Sats als Zap erhalten
│     │   12 Regionen    │    │
│     │   8 Eroberungen  │    │
│     └─────────────────┘     │
│                             │
│  RANGLISTE                  │
│  1. gorilla  23 Reg  +100⚡ │
│  2. nostr    18 Reg  +60⚡  │
│  3. DU       12 Reg  +35⚡  │  Hervorgehoben
│  4. scout     9 Reg  +15⚡  │
│  5. emperor   7 Reg  +10⚡  │
│  ---                        │
│  6. farmer    5 Reg         │  Kein Payout
│  💀 barbarian (eliminiert)  │
│                             │
│  KARTE (aufgedeckt)         │
│  [Komplette Karte ohne Fog] │  Alle Imperien sichtbar
│                             │
│  [ NAECHSTE RUNDE ]         │  Auto-Join in 5 Min
│                             │
├─────────────────────────────┤
│  Map · Empire · Diplo · Me  │
└─────────────────────────────┘
```

---

## 7. Nostr-Integration

### Bot-Events (Kind 1)

```
Runden-Start:
"Grid Empires Round #13 has begun! 18 players, 300 hexes, 340 sats pot. Join now: empires.jointfactory.io"

Grosser Kampf:
"gorilla conquered nostr's mountain fortress with 25 troops! The balance of power shifts..."

Spieler eliminiert:
"boyscout has been eliminated by gorilla! 5 regions absorbed. Only 12 empires remain."

Runden-Ende:
"Round #12 winner: gorilla (23 regions, 8 conquests). Payouts: gorilla +100⚡, nostr +60⚡, scout +35⚡"
```

### Allianzen via Nostr DM (NIP-04)

- Allianz-Anfrage → verschluesselte DM an Ziel-Spieler
- Spieler ohne offene App erhaelt DM via Nostr-Client
- Antwort in-App oder via DM

### Kopfgelder

Oeffentlich gepostet:
```
"Bounty: 15⚡ on gorilla's head! Placed by nostr. Eliminate them to claim."
```

---

## 8. Hosting

```
Subdomain: empires.jointfactory.io
Port:      3424
PM2:       grid-empires
DB:        /data/grid-empires.db
LNbits:    Shared Instance (lnbits.nsnip.io)
Caddy:     empires.jointfactory.io → localhost:3424
```

---

## 9. MVP-Scope

**Phase 1 (Woche 1-2):**
- Hex-Grid Renderer (Canvas + Fog of War + Touch)
- Karten-Generator (Terrain, 5 Typen)
- Nostr Login + Lightning Deposit
- Aktions-System: Attack + Move + Upgrade (3/h)
- Kampf-Resolver (einfach, deterministisch)
- Truppen-Produktion (idle)
- 4-6 Bots (Farmer + Barbarian)
- 48h Runden mit Ranking
- Zap-Payout an Top 3
- Basis-UI (Map, Empire, Ranking)

**Phase 2 (Woche 3):**
- Fog of War + Scout-Aktion
- Soeldner (Sats)
- Kopfgelder
- Allianzen (In-App + Nostr DM)
- Kampf-Vorschau + Kampf-Log
- Alle 4 Bot-Typen
- Nostr-Bot Announcements

**Phase 3 (Woche 4+):**
- Sats-Festungen (starke Verteidigung)
- Friedensvertraege (P2P Sats)
- Runden-History + Replay
- Sound-Effekte
- Spectator-Mode
- Allzeit-Leaderboard
