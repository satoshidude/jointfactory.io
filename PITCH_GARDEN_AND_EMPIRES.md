# Pitch-Konzepte: The Garden & Grid Empires

Grundlage fuer technisches und visuelles Umsetzungskonzept.
Stand: 2026-03-13

---

# A. THE GARDEN — Shared Persistent Growing World

## Pitch (1 Satz)

Eine lebendige, geteilte Gartenwelt auf einer Hex-Map, in der Spieler Pflanzen anbauen, ernten, handeln und um seltene Mutationen konkurrieren — mit echten Sats als Belohnung, auch wenn sie offline sind.

## Core Loop

```
Pflanzen → Wachsen (auch offline) → Ernten → Verkaufen/Mutieren
    ↑                                              ↓
    └──────── Seeds kaufen ← Joints + Sats ────────┘
```

**Minute-to-Minute:** Tap auf leeren Plot → Seed waehlen → Pflanze waechst (Timer). Nachbar-Pflanzen interagieren (Boost oder Schaden). Ernte wenn reif.

**Hour-to-Hour:** Seltene Mutationen entdecken, Garten optimieren (welche Pflanzen neben welche?), Nachbarn beobachten, Markt checken.

**Day-to-Day:** Saison-Wettbewerbe, seltene Seeds ergattern, Garten-Ranking klettern, Sats auszahlen.

## Die Welt

- **Hex-Grid**, persistent, eine Welt fuer alle Spieler
- Startgroesse: 200 Hexes, waechst mit Spielerzahl
- Jeder Spieler bekommt bei Start **3 Plots** (zusammenhaengend)
- Plots sind auf der Map sichtbar — jeder sieht jeden Garten
- **Biome**: Verschiedene Zonen (Tropen, Trocken, Indoor-Lab) mit unterschiedlichen Wachstumsboni
- Neue Plots koennen gekauft werden (Joints) — aber nur angrenzend an eigene

## Pflanzen-System

### Typen (aufsteigend nach Seltenheit)

| Tier | Pflanze | Wachstumszeit | Ertrag (Joints) | Besonderheit |
|------|---------|---------------|-----------------|--------------|
| Common | Basilikum | 30 Min | 50 | Boosted Nachbarn +10% |
| Common | Wildgras | 1h | 120 | Breitet sich aus (gratis Nachbar-Seed) |
| Uncommon | Kaktus | 2h | 400 | Braucht kein Wasser, Trocken-Biom Bonus |
| Uncommon | Farn | 3h | 700 | Boosted alle Nachbarn +20% |
| Rare | Lotus | 6h | 2.000 | Zieht Bienen an (globaler Boost) |
| Rare | Pilz-Kolonie | 8h | 3.500 | Kann Nachbar-Plots "infizieren" (Spread) |
| Epic | Neon-Orchidee | 12h | 10.000 | Leuchtet auf der Map, zieht Besucher an |
| Legendary | Mutant-Bloom | 24h | 50.000 | Nur durch Mutation, Sats-Reward bei Ernte |

### Mutations-Mechanik

Wenn zwei bestimmte Pflanzen nebeneinander stehen, besteht eine **Chance auf Mutation** bei der naechsten Ernte:

```
Basilikum + Pilz-Kolonie → 5% Chance auf "Leucht-Moos" (Rare)
Lotus + Neon-Orchidee    → 2% Chance auf "Mutant-Bloom" (Legendary)
Kaktus + Kaktus + Kaktus → 8% Chance auf "Mega-Kaktus" (Epic)
```

Mutationen sind das Endgame. Spieler experimentieren mit Kombinationen. Rezepte werden in der Community geteilt (Nostr!).

### Nachbar-Interaktionen

- **Symbiose**: Bestimmte Pflanzen boosten sich gegenseitig (schnelleres Wachstum, mehr Ertrag)
- **Parasit**: Manche Pflanzen (Pilz, Wildgras) koennen auf Nachbar-Plots ueberspringen — auch auf fremde!
- **Beschattung**: Grosse Pflanzen (Epic+) reduzieren Ertrag benachbarter kleiner Pflanzen
- **Bestaeubung**: Bienen-Events (von Lotus) geben allen Pflanzen im Radius +15% Ertrag

## Offline-Praesenz

Wenn ein Spieler offline geht:
- **Pflanzen wachsen weiter** (Timer laeuft server-side)
- Reife Pflanzen **warten auf Ernte** (verfallen nicht, aber produzieren nichts Neues)
- Parasitaere Pflanzen von Nachbarn **koennen sich ausbreiten** auf leere Plots
- Andere Spieler **sehen deinen Garten** auf der Map (mit "offline" Badge)
- **Bienen und Boosts** deiner Pflanzen wirken weiterhin auf Nachbarn
- Beim Rueckkommen: Zusammenfassung "Waehrend du weg warst: 3 Pflanzen reif, 1 Pilz von nostr hat sich ausgebreitet, +2.400 Joints geerntet"

**Effekt:** Offline-Spieler sind lebendige Nachbarn. Ihre Gaerten produzieren, ihre Pflanzen interagieren, sie sind Teil des Oekosystems.

## Sats-Economy

### Sats verdienen

| Aktion | Sats | Frequenz |
|--------|------|----------|
| **Saison-Wettbewerb Platz 1-3** | 50 / 25 / 10 | Alle 24h |
| **Mutation entdecken (Rare)** | 5 | Pro Entdeckung |
| **Mutation entdecken (Epic)** | 15 | Pro Entdeckung |
| **Mutation entdecken (Legendary)** | 50 | Pro Entdeckung |
| **Wochen-Harvest-Ranking Top 10** | 10-100 | Woechentlich |
| **Ernte-Lottery** | Pot-abhaengig | Taeglich (18:00) |
| **Seltene Pflanze auf Markt verkaufen** | Kaeufer zahlt | Jederzeit |

### Sats ausgeben

| Aktion | Kosten | Effekt |
|--------|--------|--------|
| **Premium-Seed kaufen** | 5-20 Sats | Rare+ Seed sofort verfuegbar |
| **Extra Plot** | 10 Sats | Dauerhaft, max 12 Plots |
| **Biom-Wechsel** | 15 Sats | Plot in anderes Biom verschieben |
| **Schnell-Wachstum** | 3 Sats | 1 Pflanze: Restzeit halbieren |
| **Schutzschild** | 5 Sats/24h | Verhindert Parasiten-Spread auf deine Plots |
| **Markt-Listing** | 1 Sat | Pflanze/Seed zum Verkauf anbieten |

### Ernte-Lottery (Taeglich)

- Jede Ernte einer reifen Pflanze = 1 Ticket (automatisch)
- Taeglich um 18:00 Ziehung aus Ticket-Pool
- Pot = 80% der Sats aus Schnell-Wachstum + Markt-Gebuehren + Plot-Kaeufe
- 3 Gewinner: 50% / 30% / 20% vom Pot

### Marktplatz

Peer-to-Peer Handel:
- Spieler listen Seeds oder geerntete Pflanzen
- Preis in Joints ODER Sats (Verkaeufer waehlt)
- Kaeufer bezahlt, Item wechselt Besitzer
- 10% Gebuehr auf Sats-Trades → fliesst in Lottery-Pot

## Bot-Spieler

### Zweck
- Welt fuehlt sich belebt an, auch bei wenigen echten Spielern
- Erzeugen Nachbar-Interaktionen (Symbiose, Parasiten)
- Kaufen gelegentlich auf dem Markt (Demand erzeugen)
- Nehmen an Wettbewerben teil (aber gewinnen selten Sats)

### Verhalten

**5-10 Bots aktiv**, skaliert mit echten Spielern (mehr echte = weniger Bots):

| Bot-Typ | Verhalten | Erkennung |
|---------|-----------|-----------|
| **Casual Bot** | Pflanzt Common/Uncommon, erntet puenktlich, kein Markt | "Online" 2-4h/Tag |
| **Experimentier-Bot** | Probiert Kombinationen, entdeckt gelegentlich Mutationen | Postet Discoveries auf Nostr |
| **Chaos Bot** | Pflanzt Parasiten neben echte Spieler, breitet sich aus | Erzeugt Dynamik/Bedrohung |
| **Sammler Bot** | Kauft guenstige Seeds auf dem Markt, hortet seltene Pflanzen | Haelt Markt aktiv |

**Bots haben Nostr-npubs** (wie bei JF), Profil mit generiertem Namen + Avatar. Nicht als Bot erkennbar.

**Regeln:**
- Bots gewinnen NIE Sats (Lottery/Wettbewerbe schliessen Bot-npubs aus)
- Bots erzeugen aber Tickets/Teilnahmen (Pool wirkt groesser)
- Bot-Aktivitaet passt sich Tageszeit an (mehr aktiv wenn wenige echte Spieler online)

## Saison-System

- **Saison = 7 Tage** (Montag 00:00 → Sonntag 23:59 Berlin)
- Jede Saison hat ein **Thema** (z.B. "Pilz-Woche": Pilze wachsen 50% schneller)
- **Saison-Wettbewerb**: Wer erntet die meisten Joints in der Saison?
- **Saison-Mutation**: 1 geheime neue Mutation nur in dieser Saison entdeckbar
- Am Ende: Rangliste + Sats-Auszahlung + neue Saison startet

---

# B. GRID EMPIRES — Async Hex Strategy

## Pitch (1 Satz)

Eine persistente Hex-Weltkarte auf der Spieler Regionen kontrollieren, Armeen aufbauen und Nachbarn angreifen — mit begrenzten Aktionen pro Stunde, sodass Strategie ueber Aktivitaet siegt und jedes Imperium auch offline weiterlebt.

## Core Loop

```
Regionen halten → Truppen produzieren (idle) → Expandieren/Angreifen
       ↑                                              ↓
       └──────── Regionen verteidigen ← Sieg/Niederlage ──┘
```

**Minute-to-Minute:** Karte checken, Aktionen planen (Angriff, Verteidigung, Upgrade), ausfuehren.

**Hour-to-Hour:** 3 Aktionen pro Stunde verbrauchen, Truppenbewegungen beobachten, auf Angriffe reagieren, Allianzen pflegen.

**Day-to-Day:** Imperium wachsen sehen, Runden-Ergebnis checken, Sats kassieren, neue Runde starten.

## Die Welt

- **Hex-Grid**, ~300-500 Hexes (skaliert mit Spielerzahl)
- **Persistente Runden**: 1 Runde = 48h, dann Reset + Abrechnung
- **Terrain-Typen**: Ebene (Standard), Berg (Verteidigungsbonus +50%), Wald (Tarnung), Wasser (unpassierbar), Stadt (doppelte Produktion)
- Jeder Spieler startet mit **1 Hauptstadt** (zufaellig platziert, mind. 5 Hexes Abstand)
- Neutrale Regionen mit Garnisonen (leicht einzunehmen, Training-Gegner)
- **Fog of War**: Nur eigene Regionen + 1 Hex Radius sichtbar. Spaeher erweitern Sicht.

## Aktions-System

**3 Aktionen pro Stunde**, max. Queue von 6 (2h Vorrat):

| Aktion | Effekt | Kosten |
|--------|--------|--------|
| **Angriff** | Truppen von Region A greifen Nachbar-Region B an | 1 Aktion |
| **Verschieben** | Truppen von A nach B bewegen (eigene Regionen) | 1 Aktion |
| **Upgrade** | Region befestigen (+25% Verteidigung) oder Produktion erhoehen | 1 Aktion |
| **Spaehen** | 3 Hexes in eine Richtung aufdecken (temporaer, 1h) | 1 Aktion |
| **Soeldner** | Bonus-Truppen kaufen (kostet Sats) | 1 Aktion + Sats |
| **Diplomatie** | Allianz-Anfrage oder Friedensangebot an Nachbar | 0 Aktionen (frei) |

**Warum begrenzte Aktionen?**
- Gleicht aktive und gelegentliche Spieler aus
- Verhindert dass ein Spieler in 5 Minuten alles dominiert
- Erzeugt strategische Entscheidungen: "Greife ich an oder upgrade ich?"
- Queued Actions laufen auch offline ab

## Kampf-System

Einfach, deterministisch, transparent:

```
Angreifer: Truppen × Moral × Terrain-Malus (Angriff auf Berg: ×0.7)
Verteidiger: Truppen × Moral × Terrain-Bonus × Befestigung

Ergebnis: Hoeherer Wert gewinnt.
Verluste: Verlierer verliert 60-80% Truppen, Gewinner verliert 20-40%.
Eroberung: Bei Sieg wechselt Region den Besitzer.
```

**Moral:**
- Steigt mit Siegen (+5% pro Sieg, max +30%)
- Sinkt bei Niederlagen (-10%)
- Sinkt wenn Hauptstadt bedroht wird (-20%)
- Reset auf 100% bei Runden-Start

## Truppen-Produktion (Idle)

Jede kontrollierte Region produziert automatisch Truppen:

| Region-Typ | Truppen/Stunde | Max Garnison |
|------------|---------------|-------------|
| Ebene | 2 | 20 |
| Wald | 1 | 15 |
| Berg | 1 | 25 |
| Stadt | 4 | 40 |
| Hauptstadt | 3 | 50 |
| Upgrade (+1) | +1/h | +10 |

Produktion laeuft immer — online und offline. Spieler mit mehr Regionen produzieren mehr Truppen.

## Offline-Praesenz

Wenn ein Spieler offline geht:
- **Regionen bleiben bestehen** mit vollen Garnisonen
- **Truppen-Produktion laeuft weiter** (bis Max-Garnison)
- **Gequeuete Aktionen werden ausgefuehrt** (bis Queue leer)
- **Verteidigung ist automatisch** — Garnisonen wehren Angriffe ab
- Andere Spieler **sehen dein Imperium** und muessen es in ihre Strategie einbeziehen
- **Befestigte Regionen** sind schwer einzunehmen (Offline-Schutz durch Upgrade)
- Beim Rueckkommen: Kampf-Log ("3 Angriffe abgewehrt, 1 Region verloren, +45 Truppen produziert")

**Effekt:** Offline-Imperien sind Hindernisse, Puffer, Bedrohungen. Sie formen die Karte genauso wie aktive Spieler. Ein gut befestigtes Imperium kann tagelang halten.

## Sats-Economy

### Sats verdienen

| Aktion | Sats | Frequenz |
|--------|------|----------|
| **Runden-Ranking Platz 1-5** | 100 / 50 / 25 / 15 / 10 | Alle 48h (Rundenende) |
| **Meiste Regionen bei Rundenende** | 50 | Pro Runde |
| **Meiste Eroberungen** | 30 | Pro Runde |
| **"Ueberlebender"** (>5 Regionen bei Ende) | 5 | Pro Runde |
| **Kopfgeld kassieren** | Bounty-Betrag | Bei Eliminierung des Ziels |
| **Friedensvertrag** | Verhandelt | P2P (anderer Spieler zahlt) |

### Sats ausgeben

| Aktion | Kosten | Effekt |
|--------|--------|--------|
| **Soeldner** | 5-20 Sats | 10-50 Bonus-Truppen sofort in einer Region |
| **Festungsbau** | 10 Sats | Permanentes Upgrade einer Region (+50% Verteidigung) |
| **Kopfgeld setzen** | 5+ Sats | Bounty auf einen Spieler — jeder der ihn eliminiert kassiert |
| **Spionage** | 3 Sats | Genaue Truppenzahl einer feindlichen Region sehen |
| **Schnelle Aktion** | 2 Sats | 1 Extra-Aktion sofort (max 3/Tag) |

### Runden-Pot

- Alle Sats-Ausgaben fliessen zu 80% in den **Runden-Pot**
- Am Rundenende (48h): Pot wird an Top-5 verteilt
- 20% House Edge
- Runden mit mehr Spielern = groesserer Pot
- Mindest-Pot: 50 Sats (vom House gefoerdert bei kleinen Runden)

### Diplomatie als Economy

- **Friedensvertraege**: "Ich zahle dir 10 Sats wenn du mich 24h nicht angreifst" → P2P Sats-Transfer
- **Allianz-Kaeufe**: Spieler koennen sich zu Allianzen zusammenschliessen (Nostr DMs fuer Koordination)
- **Verrat lohnt sich**: Allianz brechen und den Ally angreifen → aber Moral-Malus

## Bot-Spieler

### Zweck
- Fuellen die Karte, damit sie nie leer wirkt
- Erzeugen Druck auf echte Spieler (muessen verteidigen)
- Bieten "einfache" Gegner fuer Neulinge
- Simulieren eine lebendige Welt auch bei 1-5 echten Spielern

### Bot-Skalierung

| Echte Spieler | Bots | Karten-Groesse |
|--------------|------|---------------|
| 1-3 | 8-12 | 200 Hexes |
| 4-10 | 5-8 | 300 Hexes |
| 11-30 | 3-5 | 400 Hexes |
| 31-100 | 0-3 | 500 Hexes |

### Bot-Typen

| Bot-Typ | Verhalten | Funktion |
|---------|-----------|----------|
| **Friedlicher Farmer** | Expandiert langsam in neutrale Regionen, greift nie an, verteidigt schwach | Training-Gegner, leichte Beute |
| **Grenzwaechter** | Haelt 5-8 Regionen stabil, verteidigt aggressiv, greift nie an | Passives Hindernis, formt die Karte |
| **Aggressiver Barbar** | Expandiert schnell, greift Nachbarn an, aber schwache Verteidigung | Erzeugt Druck und Spannung |
| **Imperator** | Baut systematisch auf, balanced Angriff/Verteidigung, bildet Allianzen mit anderen Bots | Ernstzunehmender Gegner |

**Regeln:**
- Bots haben Nostr-npubs, generierte Namen + Wappen-Avatar
- Bots gewinnen NIE den Runden-Pot (Sats-Ranking schliesst sie aus)
- Bots kassieren keine Kopfgelder
- Bot-Regionen geben echten Spielern bei Eroberung +1 Bonus-Truppen (Belohnung)
- Bot-Schwierigkeit skaliert mit Runden-Nummer (Runde 1 = einfach, Runde 10+ = schlauer)

## Runden-System

- **Runde = 48 Stunden** (Start: Dienstag 00:00 + Donnerstag 00:00 Berlin)
- **Frueher Sieg**: Wenn ein Spieler >50% der Karte kontrolliert → sofortiges Rundenende
- **Am Ende**: Ranking nach kontrollierte Regionen × Truppen × Eroberungen
- **Reset**: Neue Karte, neue Startpositionen, Sats bleiben
- **Legacy**: Gewonnene Runden zaehlen fuer Allzeit-Leaderboard

## Allianzen via Nostr

- **Allianz-Anfrage**: In-Game Button → sendet Nostr DM (NIP-04)
- **Allianz-Chat**: Gruppenchat ueber Nostr (NIP-28 oder Custom)
- **Allianz-Markierung**: Alliierte Regionen haben subtilen Farb-Overlay auf der Map
- **Verrat-Benachrichtigung**: Wenn ein Ally dich angreift, wird das als Nostr-Note gepostet

---

# C. Gemeinsame Infrastruktur (beide Spiele)

## Von Joint Factory uebernommen

| Komponente | Quelle | Anpassung |
|-----------|--------|-----------|
| **Nostr Login** | server/auth.js | Identisch |
| **Lightning Wallet** | server/lightning.js | Identisch (LNbits) |
| **WebSocket Hub** | server/ws.js | Erweitert um Spiel-Channels |
| **Bot Framework** | server/zap.js | Bot-Profile + Announcements |
| **PoW + Honeypot** | server/auth.js | Identisch |
| **Player-Tabelle** | server/db.js | Erweitert um Spiel-Stats |
| **Invite System** | server/auth.js | Identisch |

## Neu zu bauen (pro Spiel)

| Komponente | Garden | Empires |
|-----------|--------|---------|
| **Hex-Grid Renderer** | Canvas/SVG + Touch | Canvas/SVG + Touch |
| **Server-Side Game State** | Welt-State (Plots, Pflanzen) | Karten-State (Regionen, Truppen) |
| **Bot AI** | Timer-basiert (pflanzen, ernten) | Strategie-AI (expandieren, angreifen) |
| **Saison/Runden-System** | 7-Tage Saisons | 48h Runden |
| **Marktplatz** | P2P Trade | Diplomatie-System |
| **Push/Notify** | "Pflanze reif", "Parasit!" | "Angriff!", "Region verloren" |

## Tech Stack (identisch fuer beide)

```
Frontend: React 19 + TypeScript + Vite + Tailwind
          + Canvas (Hex-Grid Rendering)
          + Touch-Events (Pinch-Zoom, Pan, Tap)
Backend:  Fastify 5 + SQLite + WebSocket
          + node-cron (Saison/Runden-Timer)
Auth:     Nostr NIP-07 / NIP-98
Payment:  LNbits (Lightning)
Hosting:  PM2 + Caddy (eigene Subdomain)
```

---

# D. Empfehlung

| Kriterium | The Garden | Grid Empires |
|-----------|-----------|--------------|
| **Einstiegshuerde** | Sehr niedrig (pflanzen = intuitiv) | Mittel (Strategie muss verstanden werden) |
| **Erste Session** | Sofort befriedigend (Pflanze waechst) | Langsamer Start (Truppen aufbauen) |
| **Langzeit-Tiefe** | Mutations-Rezepte, Markt-Meta | Allianzen, Karten-Politik |
| **Offline-Relevanz** | Hoch (Pflanzen wachsen) | Sehr hoch (Imperium lebt) |
| **Adrenalin-Momente** | Mutation entdeckt! Parasit! | Angriff! Region verloren! |
| **Nostr-Synergie** | Mutations-Sharing, Markt | Allianzen via DM, Verrats-Posts |
| **Dev-Aufwand MVP** | 1-2 Wochen | 2-3 Wochen |
| **Monetarisierung** | Organisch (Markt-Fees, Boosts) | Event-basiert (Runden-Pot, Soeldner) |
| **Zielgruppe** | Breit, Casual, JF-Spieler | Strategie-Fans, Kompetitiv |
