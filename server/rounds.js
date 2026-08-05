/**
 * Rounds, resets and prestige.
 *
 * A round runs from a fresh chain to ROUND_TARGET — about a week with managers
 * and a few visits a day. Reaching it does not end anything: the player keeps
 * playing until they choose to reset, and the further they push first, the more
 * prestige the reset banks.
 *
 * A reset grants no production bonus of any kind, so every round is the same
 * race and the times in the Billionaires Club stay comparable. Sats are never
 * touched — they are real money.
 *
 * Managers are *not* carried over, and that is deliberate. They are the one
 * recurring sats sink in the game and every sat spent on one goes into the
 * lottery pot; keeping them would have made the second round free and dried the
 * pot out with it. What makes the reset affordable instead is the price falling
 * with each round finished — 90, 60, 30, then 21 — and Outdoor, Indoor and
 * Hydroponic stopping to cost anything after the first, second and third round.
 * See managerCost() in shared/economy.js.
 *
 * The target is detected server-side, in saveState — see noteProgress. A client
 * that reports crossing the line is a client that can claim a record.
 */

import { db, logEvent } from './db.js'
import { initialState, prestigePoints, ROUND_TARGET, PLANTATION_DEFS, managerPrice } from '../shared/economy.js'

/**
 * Managers a save has hired, as station keys.
 *
 * @param {any} gs game state (object or JSON string)
 * @returns {string[]}
 */
export function managersFromState(gs) {
  let state = gs
  if (typeof state === 'string') {
    try { state = JSON.parse(state) } catch { return [] }
  }
  if (!state) return []
  const owned = []
  for (const p of state.plantagen || []) {
    if (p?.managerLevel > 0 && Number.isInteger(p.id)) owned.push(String(p.id))
  }
  if (state.courier?.mgrLevel > 0) owned.push('courier')
  if (state.fabrik?.mgrLevel > 0) owned.push('fabrik')
  return owned
}

/** The player's open round, created on first sight. */
/** @param {string} npub @returns {any} */
export function currentRound(npub) {
  const open = db.prepare('SELECT * FROM rounds WHERE npub = ? AND ended_at IS NULL').get(npub)
  if (open) return open

  // Started when the account did, so a player who was already mid-round when
  // rounds were introduced is not credited with a time they did not run.
  const created = db.prepare('SELECT created_at FROM players WHERE npub = ?').get(npub)?.created_at
  const last = db.prepare('SELECT MAX(round_no) n FROM rounds WHERE npub = ?').get(npub)?.n || 0
  db.prepare('INSERT INTO rounds (npub, round_no, started_at) VALUES (?, ?, ?)')
    .run(npub, last + 1, created || Math.floor(Date.now() / 1000))
  return db.prepare('SELECT * FROM rounds WHERE npub = ? AND ended_at IS NULL').get(npub)
}

/**
 * Record what a save reveals about the open round: the moment the target fell,
 * and the moment the sixth plot opened.
 *
 * Called from inside the saveState transaction, after the balance has been
 * bounded — so the total it reads is the one the guard let through.
 *
 * @param {string} npub
 * @param {number} totalEarned lifetime joints of the round
 * @param {any} gameState
 * @returns {void}
 */
export function noteProgress(npub, totalEarned, gameState) {
  let round
  try { round = currentRound(npub) } catch { return }
  if (!round) return

  const now = Math.floor(Date.now() / 1000)

  if (!round.reached_target_at && totalEarned >= ROUND_TARGET) {
    db.prepare('UPDATE rounds SET reached_target_at = ?, seconds_to_target = ? WHERE id = ?')
      .run(now, Math.max(0, now - round.started_at), round.id)
    logEvent(npub, 'round_target', Math.floor(totalEarned), {
      round: round.round_no, seconds: Math.max(0, now - round.started_at),
    })
  }

  if (!round.megafarm_at && (gameState?.plantagen?.length || 0) >= PLANTATION_DEFS.length) {
    db.prepare('UPDATE rounds SET megafarm_at = ? WHERE id = ?').run(now - round.started_at, round.id)
  }
}

/** Sats the player spent on boosts since a given time — the visible cost of a place. */
function boostSatsSince(npub, since) {
  return db.prepare(
    `SELECT COALESCE(SUM(amount), 0) s FROM events WHERE npub = ? AND type = 'boost' AND ts >= ?`
  ).get(npub, since)?.s || 0
}

const _resetTx = db.transaction((npub) => {
  const player = db.prepare(
    'SELECT joints, total_joints_earned, lifetime_joints, sats, game_state FROM players WHERE npub = ?'
  ).get(npub)
  if (!player) return { ok: false, reason: 'unknown_player' }

  const earned = Math.floor(player.total_joints_earned || 0)
  if (earned < ROUND_TARGET) return { ok: false, reason: 'target_not_reached', needed: ROUND_TARGET, earned }

  const round = currentRound(npub)
  const now = Math.floor(Date.now() / 1000)
  const points = prestigePoints(earned)
  const boostSats = boostSatsSince(npub, round.started_at)

  db.prepare(`
    UPDATE rounds SET ended_at = ?, joints_earned = ?, boost_sats = ?, prestige_points = ?
    WHERE id = ?
  `).run(now, earned, boostSats, points, round.id)

  // A clean chain: the managers are hired again next round, at next round's
  // price. Nothing about the round survives it.
  const fresh = initialState()

  db.prepare(`
    UPDATE players SET
      game_state = ?,
      joints = 0,
      total_joints_earned = 0,
      joints_per_sec = 0,
      speed_level = 0,
      lifetime_joints = COALESCE(lifetime_joints, 0) + ?,
      prestige_points = COALESCE(prestige_points, 0) + ?,
      rounds_completed = COALESCE(rounds_completed, 0) + 1,
      joints_rev = joints_rev + 1,
      state_saved_at = unixepoch(),
      last_seen_at = unixepoch()
    WHERE npub = ?
  `).run(JSON.stringify(fresh), earned, points, npub)

  db.prepare('INSERT INTO rounds (npub, round_no, started_at) VALUES (?, ?, ?)')
    .run(npub, round.round_no + 1, now)

  logEvent(npub, 'reset', earned, {
    round: round.round_no, points, boost_sats: boostSats,
    seconds_to_target: round.seconds_to_target,
  })

  const after = db.prepare(
    'SELECT joints_rev, prestige_points, rounds_completed, lifetime_joints FROM players WHERE npub = ?'
  ).get(npub)

  return {
    ok: true,
    round: round.round_no,
    next_round: round.round_no + 1,
    points_awarded: points,
    joints_earned: earned,
    seconds_to_target: round.seconds_to_target,
    gameState: fresh,
    ...after,
  }
})

/**
 * Close the open round and start the next one.
 *
 * The joints_rev bump is load-bearing: a client that is still open holds the old
 * balance, and without it the next autosave posts that figure with a matching
 * revision and quietly undoes the reset. Bumping makes that save stale, so the
 * server keeps the fresh state and the client adopts it.
 *
 * @param {string} npub
 */
export function resetRound(npub) {
  return _resetTx(npub)
}

/**
 * The two boards.
 *
 * Raw time ranks the Billionaires Club; the sats spent on boosts sit beside it
 * rather than being subtracted, so a bought place is visible without being
 * disqualified. Rounds that never reached the target — including the histories
 * from before rounds existed — have no time and do not appear.
 *
 * @param {number} [limit]
 */
export function roundLeaderboards(limit = 50) {
  const club = db.prepare(`
    SELECT r.npub, p.display_name, p.avatar, r.round_no, r.seconds_to_target,
           r.boost_sats, r.megafarm_at, r.reached_target_at
    FROM rounds r JOIN players p ON p.npub = r.npub
    WHERE r.seconds_to_target IS NOT NULL AND COALESCE(p.is_bot, 0) = 0
    ORDER BY r.seconds_to_target ASC
    LIMIT ?
  `).all(limit)

  const prestige = db.prepare(`
    SELECT npub, display_name, avatar,
           COALESCE(prestige_points, 0) points,
           COALESCE(rounds_completed, 0) rounds,
           COALESCE(lifetime_joints, 0) lifetime
    FROM players
    WHERE COALESCE(is_bot, 0) = 0 AND COALESCE(prestige_points, 0) > 0
    ORDER BY points DESC, rounds DESC
    LIMIT ?
  `).all(limit)

  return { club, prestige, target: ROUND_TARGET }
}

/** Round fields for /api/game/state. */
/** @param {string} npub */
export function roundStatus(npub) {
  const row = db.prepare(
    'SELECT total_joints_earned, prestige_points, rounds_completed, lifetime_joints FROM players WHERE npub = ?'
  ).get(npub)
  if (!row) return null
  const round = currentRound(npub)
  const earned = Math.floor(row.total_joints_earned || 0)

  // Where this run would stand in the club. The open round already carries its
  // time once the target falls, so it is counted like any other — which is the
  // whole point of showing it: a rank is what there is to push.
  let clubRank = null, clubSize = 0
  if (round.seconds_to_target != null) {
    clubSize = db.prepare(`
      SELECT COUNT(*) c FROM rounds r JOIN players p ON p.npub = r.npub
      WHERE r.seconds_to_target IS NOT NULL AND COALESCE(p.is_bot, 0) = 0
    `).get()?.c || 0
    clubRank = (db.prepare(`
      SELECT COUNT(*) c FROM rounds r JOIN players p ON p.npub = r.npub
      WHERE r.seconds_to_target IS NOT NULL AND COALESCE(p.is_bot, 0) = 0
        AND r.seconds_to_target < ?
    `).get(round.seconds_to_target)?.c || 0) + 1
  }

  return {
    boost_sats: boostSatsSince(npub, round.started_at),
    club_rank: clubRank,
    club_size: clubSize,
    round_no: round.round_no,
    started_at: round.started_at,
    target: ROUND_TARGET,
    reached_target_at: round.reached_target_at,
    seconds_to_target: round.seconds_to_target,
    megafarm_at: round.megafarm_at,
    // What a manager costs in this round, so the buttons can say so without the
    // client having to know the ladder.
    manager_price: managerPrice(row.rounds_completed || 0),
    can_reset: earned >= ROUND_TARGET,
    points_if_reset: prestigePoints(earned),
    prestige_points: row.prestige_points || 0,
    rounds_completed: row.rounds_completed || 0,
    lifetime_joints: row.lifetime_joints || 0,
  }
}

// ── The switch: from the old economy into rounds ─────────────────────────────
//
// Accounts that predate rounds are frozen (`switch_pending`) until their owner
// confirms. What they had cannot be carried across — the curve underneath it is
// gone — so the offer is made worth taking instead: three rounds credited, three
// stars, and with them managers at the floor price of 21 sats with Outdoor,
// Indoor and Hydroponic free for good. A full chain costs 42 sats from then on
// instead of 450.
//
// Credited in proportion to what the account actually earned — one round per
// round's worth of joints — and never more than three. The cap is what keeps
// prestige comparable with rounds played from here on: an account that banked
// fourteen quadrillion on a curve that no longer exists would otherwise sit at
// the top of a board it never raced on.

/** Most rounds the first switch will credit, however much the account earned. */
export const SWITCH_ROUNDS_MAX = 3

/**
 * Rounds credited for a lifetime figure from the old economy.
 *
 * @param {number} lifetime joints earned before the switch
 * @returns {number} 0 to SWITCH_ROUNDS_MAX
 */
export function switchRoundsFor(lifetime) {
  return Math.min(SWITCH_ROUNDS_MAX, Math.floor(Math.max(0, lifetime || 0) / ROUND_TARGET))
}

/** What the switch screen shows, or null for an account that is not pending. */
/** @param {string} npub */
export function switchPreview(npub) {
  const row = db.prepare(
    `SELECT COALESCE(switch_pending, 0) pending, total_joints_earned, joints, sats, speed_level
     FROM players WHERE npub = ?`
  ).get(npub)
  if (!row || !row.pending) return null
  const lifetime = Math.floor(row.total_joints_earned || 0)
  const rounds = switchRoundsFor(lifetime)
  return {
    lifetime_joints: lifetime,
    joints: Math.floor(row.joints || 0),
    sats: row.sats || 0,
    speed_level: row.speed_level || 0,
    rounds_credited: rounds,
    points_credited: rounds,
    max_rounds: SWITCH_ROUNDS_MAX,
    // What the credited rounds are actually worth, which is the point of the offer.
    manager_price_before: managerPrice(0),
    manager_price_after: managerPrice(rounds),
    target: ROUND_TARGET,
  }
}

const _switchTx = db.transaction((npub) => {
  const row = db.prepare(
    `SELECT COALESCE(switch_pending, 0) pending, total_joints_earned, sats FROM players WHERE npub = ?`
  ).get(npub)
  if (!row) return { ok: false, reason: 'unknown_player' }
  if (!row.pending) return { ok: false, reason: 'already_switched' }

  const now = Math.floor(Date.now() / 1000)
  const earned = Math.floor(row.total_joints_earned || 0)
  const rounds = switchRoundsFor(earned)
  const share = rounds > 0 ? Math.floor(earned / rounds) : 0

  // Whatever rounds machinery already touched this account goes; the credited
  // rounds are the whole history from here.
  db.prepare('DELETE FROM rounds WHERE npub = ?').run(npub)
  for (let n = 1; n <= rounds; n++) {
    // No seconds_to_target: these were never run against this curve, and a
    // Billionaires Club whose records come from a game that no longer exists is
    // worse than an empty one.
    db.prepare(`
      INSERT INTO rounds (npub, round_no, started_at, ended_at, joints_earned, prestige_points)
      VALUES (?, ?, ?, ?, ?, 1)
    `).run(npub, n, now, now, share)
  }
  db.prepare('INSERT INTO rounds (npub, round_no, started_at) VALUES (?, ?, ?)')
    .run(npub, rounds + 1, now)

  db.prepare(`
    UPDATE players SET
      game_state = ?,
      joints = 0,
      total_joints_earned = 0,
      joints_per_sec = 0,
      speed_level = 0,
      lifetime_joints = COALESCE(lifetime_joints, 0) + ?,
      prestige_points = COALESCE(prestige_points, 0) + ?,
      rounds_completed = ?,
      switch_pending = 0,
      joints_rev = joints_rev + 1,
      state_saved_at = unixepoch(),
      last_seen_at = unixepoch()
    WHERE npub = ?
  `).run(JSON.stringify(initialState()), earned, rounds, rounds, npub)

  logEvent(npub, 'switch', earned, { rounds, points: rounds })

  return {
    ok: true,
    rounds_credited: rounds,
    points_credited: rounds,
    lifetime_joints: earned,
    sats: row.sats,
    next_round: rounds + 1,
    manager_price: managerPrice(rounds),
  }
})

/**
 * Take an account off the old economy and into rounds. Idempotent: a second call
 * answers `already_switched` and changes nothing.
 *
 * Sats, deposits, invite code, referrals and open boost grants are untouched —
 * everything real money paid for stays.
 *
 * @param {string} npub
 */
export function switchToRounds(npub) {
  return _switchTx(npub)
}

/** @param {string} npub @returns {boolean} */
export function switchPending(npub) {
  return !!db.prepare('SELECT COALESCE(switch_pending, 0) p FROM players WHERE npub = ?').get(npub)?.p
}
