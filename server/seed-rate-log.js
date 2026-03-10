/**
 * One-time script to seed rate_log with synthetic historical data
 * derived from current player stats. Run on VPS then delete.
 */
import Database from 'better-sqlite3';

const db = new Database('./data/jointfactory.db');
const now = Math.floor(Date.now() / 1000);
const h48ago = now - 48 * 3600;

const players = db.prepare(`
  SELECT npub, joints_per_sec, total_joints_earned, created_at, last_seen_at
  FROM players WHERE total_joints_earned > 100
  ORDER BY total_joints_earned DESC
`).all();

console.log(`Seeding rate_log for ${players.length} players...`);

// Clear existing synthetic data
db.exec(`DELETE FROM rate_log WHERE ts >= ${h48ago}`);

const insert = db.prepare(`INSERT INTO rate_log (npub, ts, rate, total) VALUES (?, ?, ?, ?)`);
const insertMany = db.transaction((entries) => {
  for (const e of entries) insert.run(e.npub, e.ts, e.rate, e.total);
});

const allEntries = [];

for (const p of players) {
  const { npub, joints_per_sec: currentRate, total_joints_earned: totalNow, created_at, last_seen_at } = p;
  if (currentRate <= 0 && totalNow < 100) continue;

  const startedAt = Math.max(created_at, h48ago);
  const activeHours = Math.max(0.5, (last_seen_at - startedAt) / 3600);
  const isCurrentlyActive = (now - last_seen_at) < 600; // active in last 10min

  // Simulate rate growth: player started low and grew to current rate
  // through ~4-8 upgrade steps over their active period
  const numSteps = Math.min(8, Math.max(3, Math.floor(activeHours / 2)));

  // Generate session pattern: 2-4 sessions with gaps
  const numSessions = Math.min(4, Math.max(1, Math.floor(activeHours / 6)));
  const sessionDuration = activeHours / numSessions * 0.7; // 70% active per session block
  const gapDuration = activeHours / numSessions * 0.3; // 30% offline gaps

  let currentTs = startedAt;
  let currentTotal = Math.max(0, totalNow - currentRate * activeHours * 3600 * 0.5); // rough start total
  if (currentTotal < 0) currentTotal = 0;

  // Distribute rate upgrades across sessions
  const rateSteps = [];
  for (let s = 0; s < numSteps; s++) {
    // Exponential growth from ~5% to 100% of current rate
    const frac = (s + 1) / numSteps;
    const rate = currentRate * (0.05 + 0.95 * Math.pow(frac, 1.5));
    rateSteps.push(Math.round(rate * 100) / 100);
  }

  let stepIdx = 0;
  for (let ses = 0; ses < numSessions; ses++) {
    const sessionStart = currentTs;
    const sessionEnd = Math.min(now, currentTs + sessionDuration * 3600);

    // Login event
    const loginRate = rateSteps[Math.min(stepIdx, rateSteps.length - 1)];
    allEntries.push({ npub, ts: Math.floor(sessionStart), rate: loginRate, total: Math.floor(currentTotal) });

    // Rate upgrades during this session
    const upgradesInSession = Math.ceil(numSteps / numSessions);
    for (let u = 1; u < upgradesInSession && stepIdx + 1 < rateSteps.length; u++) {
      stepIdx++;
      const upgradeTs = sessionStart + (u / upgradesInSession) * (sessionEnd - sessionStart);
      const prevRate = rateSteps[stepIdx - 1];
      currentTotal += prevRate * (upgradeTs - (allEntries[allEntries.length - 1]?.ts || sessionStart));
      allEntries.push({ npub, ts: Math.floor(upgradeTs), rate: rateSteps[stepIdx], total: Math.floor(currentTotal) });
    }

    // Production during rest of session
    const lastEntry = allEntries[allEntries.length - 1];
    const activeRate = lastEntry.rate;
    currentTotal += activeRate * (sessionEnd - lastEntry.ts);

    // Logout event (rate=0) — skip if this is the last session and player is currently active
    if (ses < numSessions - 1 || !isCurrentlyActive) {
      allEntries.push({ npub, ts: Math.floor(sessionEnd), rate: 0, total: Math.floor(currentTotal) });
    }

    stepIdx++;
    // Gap (offline)
    currentTs = sessionEnd + gapDuration * 3600;
  }

  // If currently active, ensure last entry has current rate
  if (isCurrentlyActive) {
    const lastEntry = allEntries.filter(e => e.npub === npub).pop();
    if (lastEntry && lastEntry.rate !== currentRate) {
      // Add a recent upgrade to current rate
      const recentTs = now - 300; // 5 min ago
      currentTotal = totalNow - currentRate * 300;
      allEntries.push({ npub, ts: recentTs, rate: Math.round(currentRate * 100) / 100, total: Math.floor(currentTotal) });
    }
  }
}

// Fix totals: ensure final entry for each player roughly matches their actual total
for (const p of players) {
  const entries = allEntries.filter(e => e.npub === p.npub);
  if (entries.length === 0) continue;
  const lastNonZero = [...entries].reverse().find(e => e.rate > 0);
  if (!lastNonZero) continue;

  // Scale all totals proportionally so the last one matches reality
  const lastTotal = lastNonZero.total + lastNonZero.rate * (now - lastNonZero.ts);
  const scale = lastTotal > 0 ? p.total_joints_earned / lastTotal : 1;
  for (const e of entries) {
    e.total = Math.floor(e.total * scale);
  }
}

insertMany(allEntries);
console.log(`Inserted ${allEntries.length} rate_log entries`);

// Show summary
for (const p of players) {
  const count = allEntries.filter(e => e.npub === p.npub).length;
  console.log(`  ${p.npub.slice(0, 8)}... : ${count} entries, rate=${p.joints_per_sec}, total=${p.total_joints_earned}`);
}

db.close();
