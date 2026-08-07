import { db, logEvent } from './db.js';
import { getActiveBoosts } from './boosts.js';
import { rehydrate, throughput, countManagers, progressBreakdown, maxLevelJump, chainRegressed,
         MAX_LEVEL_STEP, MAX_PLANT_LEVEL, initialState, managerSpend, ROUND_TARGET } from '../shared/economy.js';
import { noteProgress } from './rounds.js';

/**
 * Put back the managers of the stored state — used when the account cannot pay
 * for the ones the incoming state claims. Only the manager fields are touched;
 * everything else the save brought along is honest and stays.
 */
function restoreManagers(next, stored) {
  const was = new Map();
  for (const p of stored?.plantagen || []) if (Number.isInteger(p?.id)) was.set(String(p.id), p.managerLevel || 0);
  for (const p of next?.plantagen || []) if (Number.isInteger(p?.id)) p.managerLevel = was.get(String(p.id)) || 0;
  if (next?.courier) next.courier.mgrLevel = stored?.courier?.mgrLevel || 0;
  if (next?.fabrik) next.fabrik.mgrLevel = stored?.fabrik?.mgrLevel || 0;
}

export function loadState(npub) {
  const player = db.prepare('SELECT * FROM players WHERE npub = ?').get(npub);
  if (!player) return null;

  let gameState = {};
  try { gameState = JSON.parse(player.game_state || '{}'); } catch(e) {}
  // Definition fields (name, icon, baseProd, upgMult …) come from the defs, not
  // from the save — see rehydrate() in shared/economy.js.
  rehydrate(gameState);

  return {
    npub: player.npub,
    display_name: player.display_name,
    avatar: player.avatar,
    lightning_address: player.lightning_address,
    nip05: player.nip05,
    joints: player.joints,
    sats: player.sats,
    total_joints_earned: player.total_joints_earned,
    total_deposited: player.total_deposited || 0,
    speed_level: player.speed_level || 0,
    joints_rev: player.joints_rev || 0,
    gameState,
  };
}

// Atomic saveState transaction
const _saveStateTx = db.transaction((npub, payload) => {
  const { gameState, joints, total_joints_earned, joints_per_sec, joints_rev } = payload;
  let potUpdated = false;

  const existing = db.prepare(
    `SELECT joints, total_joints_earned, speed_level, last_seen_at, joints_rev, game_state, sats,
            COALESCE(rounds_completed, 0) AS rounds_completed,
            COALESCE(switch_pending, 0) AS switch_pending,
            COALESCE(state_saved_at, last_seen_at) AS state_saved_at FROM players WHERE npub = ?`
  ).get(npub);

  // An account that predates rounds does not play until its owner has confirmed
  // the switch. Refused here, before anything is priced or written: the tab that
  // was open yesterday would otherwise post a chain built on a curve that no
  // longer exists, over a state the player has not agreed to yet.
  if (existing?.switch_pending) {
    return { ok: false, reason: 'switch_required' };
  }

  // Managers the incoming state has that the stored one did not, priced here.
  //
  // The client used to report what it had spent and the server deducted that
  // number, which meant a client reporting nothing got its managers for nothing.
  // The price is not the client's to know anyway now: it falls with every round
  // the player finishes, and three of the plots stop costing anything at all.
  //
  // Unaffordable hires are undone rather than given away — the state goes back to
  // the managers the account actually has.
  let managerRefused = false;
  if (existing) {
    let stored = {};
    try { stored = JSON.parse(existing.game_state || '{}'); rehydrate(stored); } catch { /* empty */ }
    const spend = managerSpend(stored, gameState, existing.rounds_completed);
    if (spend.cost > 0) {
      const deducted = db.prepare(`UPDATE players SET sats = sats - ? WHERE npub = ? AND sats >= ?`)
        .run(spend.cost, npub, spend.cost);
      if (deducted.changes > 0) {
        // Gross into the pot — the house cut is taken once, at payout.
        db.prepare(`UPDATE lottery_rounds SET total_sats_collected = total_sats_collected + ?
                    WHERE id = (SELECT id FROM lottery_rounds WHERE status = 'open' ORDER BY id DESC LIMIT 1)`).run(spend.cost);
        console.log(`[Lottery] Adding ${spend.cost} sats from ${npub.slice(0, 8)}... to pot`);
        logEvent(npub, 'manager', spend.cost, {
          hired: spend.hired, round: existing.rounds_completed + 1, managers: countManagers(gameState),
        });
        potUpdated = true;
      } else {
        console.warn(`[Game] ${npub.slice(0, 12)}… hired ${spend.hired.join(', ')} for ${spend.cost} sats with ${existing.sats} — refused`);
        restoreManagers(gameState, stored);
        managerRefused = true;
      }
    }
  }

  // One row per player per session, for retention: last_seen_at only ever holds
  // the latest visit, so how often anyone came back was unrecoverable. A gap of
  // half an hour counts as a new session.
  if (existing && (Math.floor(Date.now() / 1000) - (existing.last_seen_at || 0)) > 1800) {
    logEvent(npub, 'active', 0, { away_hours: Math.round((Date.now() / 1000 - (existing.last_seen_at || 0)) / 360) / 10 });
  }

  // Guard: reject saves that would reset a player's progress to zero
  const incomingTotal = Math.floor(total_joints_earned || 0);
  if (incomingTotal === 0 && existing && existing.total_joints_earned > 0) {
    console.warn(`[Game] BLOCKED state reset for ${npub.slice(0, 12)}… (server: ${existing.total_joints_earned}, incoming: 0)`);
    return { ok: false, reason: 'state_reset_blocked' };
  }

  // Cap the reported balance at what the stored one could plausibly have grown
  // into since the last save.
  //
  // The client owns its joint count and posts an absolute figure. Without a cap
  // any server-side deduction is undone by the very next autosave — buying a
  // ticket or a speed level appeared to cost nothing, because thirty seconds
  // later the client reported the balance it still believed it had. It is also
  // the cheat surface: joints convert to real sats through the lottery.
  //
  // Generous on purpose. The factor covers boosts and clock drift, and the flat
  // term keeps small balances from tripping over rounding; the point is to bound
  // the number, not to recompute it.
  let plausible = Math.floor(joints || 0);
  // Set when the incoming state is not a purchase history at all. The balance was
  // already protected; the *state* was not, and it was persisted anyway — so a
  // rejected claim still became the baseline the next save is measured against.
  let keepStoredState = false;
  // Ceiling for the lifetime counter, which was never bounded at all. It only
  // fed a leaderboard before; it now decides when a round is finished, how many
  // prestige points it pays and what time goes into the Billionaires Club — so a
  // client that simply reports a larger number could claim a record it never ran.
  // It grows with production, exactly like the balance, so the same allowance fits.
  let totalCeiling = Infinity;

  // A purchase made since the client last read its balance bumps joints_rev.
  // The client echoes the revision it knows; a mismatch means it is about to
  // post a figure from before the deduction, so the balance stays as it is and
  // the rest of the state still saves. Without this a ticket or speed purchase
  // refunded itself on the next autosave — the plausibility ceiling below is
  // far too generous to catch it, by design.
  const reported = plausible;
  let bought = null;
  // What the ceiling was built from, for the clamp event.
  let guard = null;
  const staleBalance = existing && joints_rev !== undefined && joints_rev !== existing.joints_rev;
  if (staleBalance) {
    console.warn(`[Game] Stale balance from ${npub.slice(0, 12)}… (rev ${joints_rev} vs ${existing.joints_rev}) — keeping server figure`);
    plausible = existing.joints;
    // The lifetime figure in that same post is just as stale, and leaving it
    // unbounded here would be the way around the ceiling below.
    totalCeiling = existing.total_joints_earned || 0;
    // So is the chain. A stale post is a snapshot from before something the
    // client has not seen yet, and the largest such thing is a round reset: the
    // open tab posted its finished six-plot chain a moment after the reset and
    // wrote it straight over the fresh one, leaving an account with no joints
    // and an endgame factory. Costs nothing in the ordinary case — the client
    // adopts the revision from this same answer and its next save goes through.
    keepStoredState = true;
  } else if (existing) {
    // Since the last *save*, not since the last sign-in: logging in sets
    // last_seen_at to now, so measuring against it charged a returning player
    // for the entire time they were away.
    // Since the last *save*, with a floor of a few seconds.
    //
    // Saves land about a second apart while a player is clicking, and stamped in
    // whole seconds two of them can fall in the same one — the window rounds to
    // zero and the production of that second is confiscated. Spooky lost 53.7 B
    // and 10.7 B that way mid-purchase, which is exactly the sort of thing the
    // event log was built to surface.
    const sinceSave = Math.floor(Date.now() / 1000) - (existing.state_saved_at || existing.last_seen_at || 0);
    const elapsed = Math.max(3, sinceSave);

    // The ceiling is built from the *stored* state, never the incoming one.
    // Reading the rate out of the state being validated let a client raise its
    // own allowance: claim higher levels, and the ceiling that is supposed to
    // check them rises with the claim.
    let stored = {};
    try { stored = JSON.parse(existing.game_state || '{}'); rehydrate(stored); } catch { /* empty */ }
    // A first save has nothing stored yet, and an empty baseline means a rate of
    // zero — which would confiscate everything a new player tapped for in their
    // first minutes. A fresh chain is the right floor: it is exactly what they
    // could have made.
    if (!stored.plantagen?.length) stored = initialState();

    const opts = {
      speedLevel: existing.speed_level || 0,
      boosts: getActiveBoosts(npub),
      nowSec: Math.floor(Date.now() / 1000),
      // What the chain could do with every station running, not just the
      // automated ones: tapping by hand is legitimate production, and a player
      // who has not hired all three managers had a modelled rate of zero — so
      // everything they earned by hand was clamped away.
      ignoreManagers: true,
    };

    let rate = 0, courierRate = 0, fabrikRate = 0;
    try {
      const t = throughput(stored, opts);
      rate = t.jointsPerSec;
      courierRate = t.courier || 0;
      fabrikRate = t.fabrik || 0;
    } catch { /* no output */ }

    // Harvested stock is converted faster than the chain's steady rate whenever
    // an upstream stage is the slow one — a player draining a backlog is
    // producing legitimately, and the guard used to price steady state only.
    // Akki had 3.4 trillion cannabis in the fields and was clamped 34 times in
    // an hour for turning it into joints.
    //
    // The two piles do not travel the same road. Weed in the fields still has to
    // pass the courier *and* the factory; weed already delivered only has to
    // pass the factory. Bounding both by min(courier, factory) understated a
    // courier-limited chain draining its factory backlog by exactly the
    // difference between the two stages.
    //
    // Whatever the source, everything above the steady rate has to fit through
    // the factory's spare capacity, so that is the ceiling on the whole term.
    const field = Math.max(0, stored.cannabis || 0);
    const delivered = Math.max(0, stored.cannabisAtFactory || 0) + Math.max(0, stored.fabrik?._currentCharge || 0);
    const reachable = delivered + Math.min(field, Math.max(0, Math.min(courierRate, fabrikRate) - rate) * elapsed);
    const fromStock = Math.min(reachable, Math.max(0, fabrikRate - rate) * elapsed);

    // Anything the incoming state claims to have bought has to have been paid
    // for. Priced from the stored state, so the cost is what the player would
    // actually have been charged.
    let spent = 0;
    try { bought = progressBreakdown(stored, gameState); spent = bought.cost; } catch { /* unreadable */ }

    const allowance = (rate * elapsed + fromStock) * 1.5 + 1000;
    guard = {
      elapsed: Math.round(elapsed),
      rate: Math.round(rate),
      stock: Math.round(fromStock),
      spent: Math.round(spent),
      allowance: Math.round(allowance),
    };
    // Never past the round target: counting stops there, so a client reporting
    // more has either lost track or is trying it on.
    totalCeiling = Math.min(ROUND_TARGET, (existing.total_joints_earned || 0) + allowance);

    // A claim the account could not have afforded, or a level jump no amount of
    // clicking explains: the incoming state is not a purchase history, so the
    // balance simply stays where the server had it. Zeroing the account would
    // punish, and the guard is here to refuse a gain, not to take what is there.
    const jump = maxLevelJump(stored, gameState);
    // Levels past the ceiling are not for sale. A newly unlocked plot arrives on
    // an inherited level (see inheritedLevel), so the jump check alone would wave
    // one through at any height.
    const overCap = (gameState?.plantagen || []).some(p => (p?.level || 0) > MAX_PLANT_LEVEL);
    // A chain that shrank is an old client talking, and storing it throws away
    // everything bought since — which is not a theory: three capacity steps were
    // charged on a live account, 3.65 million joints, and the stored chain went
    // back to what it was before them.
    const regressed = chainRegressed(stored, gameState);
    const impossible = regressed || jump > MAX_LEVEL_STEP || overCap || spent > existing.joints + allowance;
    if (impossible) {
      console.warn(`[Game] ${npub.slice(0, 12)}… claims ${regressed ? `a smaller chain (${regressed})` : overCap ? 'a level past the cap' : jump > MAX_LEVEL_STEP ? `+${jump} levels` : `${spent} joints of upgrades`} in one save — state and balance kept`);
      plausible = Math.min(plausible, existing.joints);
      // The stored state stays as well. Keeping only the balance left the
      // rejected chain in the database, and every ceiling after that is built
      // from the stored state — so a refused claim quietly became the baseline
      // for the next one.
      keepStoredState = true;
    } else {
      // Half again on top of what the model says, not triple.
      //
      // The old factor of three was headroom for everything the model did not
      // know: boosts, hand play, a backlog being drained. All three are
      // accounted for above now, so the slack can shrink — and it has to,
      // because slack is also where an unpaid upgrade hides. At three times,
      // anything costing less than two windows of production was invisible.
      const ceiling = existing.joints + allowance - spent;
      if (plausible > ceiling) {
        console.warn(`[Game] Clamped joints for ${npub.slice(0, 12)}…: reported ${plausible}, ceiling ${Math.floor(ceiling)}${spent > 0 ? ` (upgrades ${spent})` : ''}`);
        plausible = Math.max(0, Math.floor(ceiling));
      }
    }
  }

  // Whatever the server decided is what the account has. Telling the client is
  // the half that was missing: a clamped client kept its own inflated figure,
  // re-posted it every thirty seconds, and showed a balance that did not exist.
  // Purchases then failed for "not enough joints" against a number the player
  // could see on screen — which reads as being robbed, not as being corrected.
  // What the player bought since the last save. This is the biggest joints sink
  // in the game and it happens entirely in the client — without recording it
  // here, no later analysis can say what people actually spend on.
  // Nur was auch bezahlt wurde. Ein abgelehnter Ausbau landete hier trotzdem,
  // und weil der Client ihn jede halbe Minute erneut schickte, stand derselbe
  // Kauf neunmal im Protokoll — was wie neunmal abgebucht aussah, ohne es zu
  // sein. Die Analyse las daraus, wofür Spieler Joints ausgeben.
  if (bought && bought.cost > 0 && !keepStoredState) {
    logEvent(npub, 'upgrade', bought.cost, {
      levels: bought.levels, level_cost: bought.level_cost,
      capacity: bought.capacity, capacity_cost: bought.capacity_cost,
      unlocks: bought.unlocks, unlock_cost: bought.unlock_cost,
    });
  }

  const corrected = plausible !== reported;
  if (corrected) logEvent(npub, 'clamp', reported - plausible, {
    reported, kept: plausible, stale: !!staleBalance,
    // What the ceiling was built from. A clamp without these is a number nobody
    // can check afterwards — which is how this one went unexplained for a day.
    ...(guard || {}),
  });

  const savedState = keepStoredState ? existing.game_state : JSON.stringify(gameState || {});
  // Never below what is stored: the counter only ever grows, and the wipe guard
  // above has already refused an incoming zero.
  const savedTotal = keepStoredState
    ? (existing.total_joints_earned || 0)
    : Math.max(existing?.total_joints_earned || 0,
               Math.min(Math.floor(total_joints_earned || 0), Math.floor(totalCeiling)));

  // Save game state — sats is NEVER written from client
  db.prepare(`
    UPDATE players SET
      game_state = ?,
      joints = ?,
      total_joints_earned = ?,
      joints_per_sec = ?,
      last_seen_at = unixepoch(),
      state_saved_at = unixepoch()
    WHERE npub = ?
  `).run(
    savedState,
    plausible,
    savedTotal,
    joints_per_sec || 0,
    npub
  );

  // When the round's target fell, and when the sixth plot opened. Read from what
  // the guard let through, never from a client's own claim to a record.
  try { noteProgress(npub, savedTotal, keepStoredState ? null : gameState); } catch (err) {
    console.warn('[Rounds] progress note failed:', err.message);
  }

  const rev = db.prepare('SELECT joints_rev FROM players WHERE npub = ?').get(npub)?.joints_rev ?? 0;
  // manager_refused tells the client its optimistic hire did not go through, so
  // it can put the sats back on screen instead of showing a manager it has not
  // got.
  // Der Client behielt seine abgelehnte Kette und schickte sie im nächsten Save
  // wieder — dieselbe Ablehnung, dieselbe Klemmung, endlos. Er kann das nicht
  // wissen, solange ihm niemand sagt, dass sein Stand nicht der gespeicherte
  // ist; mit dem Flag holt er sich den echten.
  return { ok: true, potUpdated, joints: plausible, joints_rev: rev, corrected,
           state_rejected: keepStoredState, manager_refused: managerRefused };
});

export function saveState(npub, payload) {
  return _saveStateTx(npub, payload);
}

// Atomic delete: remove player and all dependencies, keep invited buddies
const _deletePlayerTx = db.transaction((npub) => {
  const player = db.prepare('SELECT npub, display_name FROM players WHERE npub = ?').get(npub);
  if (!player) return { ok: false, reason: 'Player not found' };

  // Clear referral link for invited buddies (they stay, just lose the link)
  db.prepare('UPDATE players SET referred_by = NULL WHERE referred_by = ?').run(npub);

  // Delete from all dependent tables
  db.prepare('DELETE FROM lottery_tickets WHERE npub = ?').run(npub);
  db.prepare('DELETE FROM lightning_payments WHERE npub = ?').run(npub);
  db.prepare('DELETE FROM redemptions WHERE npub = ?').run(npub);
  db.prepare('DELETE FROM zap_receipts WHERE recipient_npub = ?').run(npub);
  db.prepare('DELETE FROM rate_log WHERE npub = ?').run(npub);
  db.prepare('DELETE FROM withdrawals WHERE npub = ?').run(npub);

  // Delete the player
  db.prepare('DELETE FROM players WHERE npub = ?').run(npub);

  console.log(`[Game] Deleted player ${player.display_name || npub.slice(0, 12)}`);
  return { ok: true, display_name: player.display_name };
});

export function deletePlayer(npub) {
  return _deletePlayerTx(npub);
}

export function updateProfile(npub, { display_name, avatar, lightning_address, nip05 }) {
  const fields = [];
  const vals = [];
  if (display_name !== undefined) { fields.push('display_name = ?'); vals.push(display_name); }
  if (avatar !== undefined) { fields.push('avatar = ?'); vals.push(avatar); }
  if (lightning_address !== undefined) { fields.push('lightning_address = ?'); vals.push(lightning_address); }
  if (nip05 !== undefined) { fields.push('nip05 = ?'); vals.push(nip05); }
  if (fields.length === 0) return { ok: false, reason: 'Nothing to update' };
  vals.push(npub);
  db.prepare(`UPDATE players SET ${fields.join(', ')} WHERE npub = ?`).run(...vals);
  return { ok: true };
}
