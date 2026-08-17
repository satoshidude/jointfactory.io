-- players
CREATE TABLE IF NOT EXISTS players (
  npub TEXT PRIMARY KEY,
  display_name TEXT,
  lightning_address TEXT,
  joints INTEGER DEFAULT 0,
  sats INTEGER DEFAULT 210,
  game_state JSON,
  total_joints_earned INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (unixepoch()),
  last_seen_at INTEGER DEFAULT (unixepoch())
);

-- lottery_rounds
CREATE TABLE IF NOT EXISTS lottery_rounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  starts_at INTEGER DEFAULT (unixepoch()),
  draws_at INTEGER,
  status TEXT DEFAULT 'open',
  total_sats_collected INTEGER DEFAULT 0,
  winner_npub TEXT,
  winner_payout_sats INTEGER,
  winner_paid_at INTEGER
);

-- lottery_tickets
CREATE TABLE IF NOT EXISTS lottery_tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id INTEGER REFERENCES lottery_rounds(id),
  npub TEXT,
  joints_cost INTEGER,
  purchased_at INTEGER DEFAULT (unixepoch())
);

-- lightning_payments
CREATE TABLE IF NOT EXISTS lightning_payments (
  payment_hash TEXT PRIMARY KEY,
  npub TEXT,
  amount_sats INTEGER,
  pack_id TEXT,
  status TEXT DEFAULT 'pending',
  created_at INTEGER DEFAULT (unixepoch()),
  paid_at INTEGER
);

-- redemptions
CREATE TABLE IF NOT EXISTS redemptions (
  token TEXT PRIMARY KEY,
  npub TEXT,
  reward_type TEXT,
  joints_cost INTEGER,
  expires_at INTEGER,
  redeemed_at INTEGER
);
