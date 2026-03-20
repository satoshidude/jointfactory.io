import { useEffect, useState, useRef, useCallback } from 'react';
import { Trophy, ChevronLeft, ChevronRight, Circle, Ticket } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { nip19 } from 'nostr-tools';
import './Players.css';

interface Player {
  npub: string;
  display_name: string | null;
  joints: number;
  total_joints_earned: number;
  joints_per_sec: number;
  last_seen_at: number;
  is_online: boolean;
  total_won_sats: number;
}

interface ZapRecord {
  round_id: number;
  recipient_npub: string;
  amount_sats: number;
  nostr_event_id?: string;
  created_at: number;
}

interface LotteryWin {
  round_id: number;
  sats: number;
  draws_at: number;
}

interface LivePlayer extends Player {
  _liveJoints: number;
  _liveTotalEarned: number;
  _updatedAt: number;
  _lastZap?: ZapRecord;
  _totalZapSats: number;
  _lastWin?: LotteryWin;
}

const PER_PAGE = 100;

function fmtShort(n: number): string {
  if (n >= 1e15) return (n / 1e15).toFixed(1) + '\u2009Qa';
  if (n >= 1e12) return (n / 1e12).toFixed(1) + '\u2009T';
  if (n >= 1e9)  return (n / 1e9).toFixed(1) + '\u2009B';
  if (n >= 1e6)  return (n / 1e6).toFixed(1) + '\u2009M';
  if (n >= 1e3)  return (n / 1e3).toFixed(1) + '\u2009K';
  return Math.floor(n).toLocaleString();
}

function fmtNum(n: number): string {
  if (n >= 1e15) return (n / 1e15).toFixed(6) + '\u2009Qa';
  if (n >= 1e12) return (n / 1e12).toFixed(6) + '\u2009T';
  if (n >= 1e9)  return (n / 1e9).toFixed(6) + '\u2009B';
  if (n >= 1e6)  return (n / 1e6).toFixed(6) + '\u2009M';
  if (n >= 1e3)  return (n / 1e3).toFixed(6) + '\u2009K';
  return Math.floor(n).toLocaleString();
}


export default function LeaderboardPage() {
  const [players, setPlayers] = useState<LivePlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const playersRef = useRef<LivePlayer[]>([]);

  // Fetch from API
  const fetchPlayers = useCallback(() => {
    Promise.all([apiFetch('/players'), apiFetch('/lottery/zaps'), apiFetch('/lottery/history')]).then(([res, zapRes, historyRes]) => {
      if (!res.players) return;
      // Build maps: npub → latest zap + total sats
      const lastZapMap = new Map<string, ZapRecord>();
      const totalZapMap = new Map<string, number>();
      if (zapRes?.zaps) {
        for (const z of zapRes.zaps as ZapRecord[]) {
          const existing = lastZapMap.get(z.recipient_npub);
          if (!existing || z.created_at > existing.created_at) {
            lastZapMap.set(z.recipient_npub, z);
          }
          totalZapMap.set(z.recipient_npub, (totalZapMap.get(z.recipient_npub) || 0) + z.amount_sats);
        }
      }
      // Build map: npub → latest lottery win
      const lastWinMap = new Map<string, LotteryWin>();
      if (historyRes?.rounds) {
        for (const r of historyRes.rounds as { id: number; draws_at: number; winner_payouts: Record<string, number> }[]) {
          for (const [npub, sats] of Object.entries(r.winner_payouts || {})) {
            if (sats > 0 && !lastWinMap.has(npub)) {
              lastWinMap.set(npub, { round_id: r.id, sats, draws_at: r.draws_at });
            }
          }
        }
      }
      const now = Date.now();
      const updated: LivePlayer[] = (res.players as Player[]).map(p => {
        const existing = playersRef.current.find(e => e.npub === p.npub);
        return {
          ...p,
          _liveJoints: p.joints,
          _liveTotalEarned: p.total_joints_earned,
          _updatedAt: now,
          joints_per_sec: p.joints_per_sec || existing?.joints_per_sec || 0,
          _lastZap: lastZapMap.get(p.npub) || existing?._lastZap,
          _totalZapSats: totalZapMap.get(p.npub) || existing?._totalZapSats || 0,
          _lastWin: lastWinMap.get(p.npub) || existing?._lastWin,
        };
      });
      updated.sort((a, b) => b._liveJoints - a._liveJoints);
      playersRef.current = updated;
      setPlayers(updated);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  // Initial load + periodic refresh
  useEffect(() => {
    fetchPlayers();
    const interval = setInterval(fetchPlayers, 30000);
    return () => clearInterval(interval);
  }, [fetchPlayers]);

  // WebSocket for live updates
  useEffect(() => {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = location.hostname === 'localhost' ? 'localhost:3420' : location.host;
    const ws = new WebSocket(`${proto}//${host}/ws`);
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'player_update') {
          const now = Date.now();
          playersRef.current = playersRef.current.map(p =>
            p.npub === msg.npub
              ? { ...p, joints: msg.joints, total_joints_earned: msg.total_joints_earned, joints_per_sec: msg.joints_per_sec || p.joints_per_sec, _liveJoints: msg.joints, _liveTotalEarned: msg.total_joints_earned, _updatedAt: now, is_online: true }
              : p
          ).sort((a, b) => b._liveJoints - a._liveJoints);
          setPlayers([...playersRef.current]);
        }
      } catch (_) {}
    };
    return () => ws.close();
  }, []);

  // Client-side interpolation at ~10fps
  useEffect(() => {
    let animId: number;
    let lastRender = 0;
    const tick = (now: number) => {
      // Throttle to ~10fps
      if (now - lastRender < 100) { animId = requestAnimationFrame(tick); return; }
      lastRender = now;
      const wallNow = Date.now();
      let changed = false;
      for (const p of playersRef.current) {
        // Active = online OR recently seen (< 2min) with a production rate
        const recentlySeen = (wallNow / 1000 - p.last_seen_at) < 120;
        const isActive = p.is_online || (recentlySeen && p.joints_per_sec > 0);
        if (isActive && p.joints_per_sec > 0) {
          const elapsed = (wallNow - p._updatedAt) / 1000;
          const delta = elapsed * p.joints_per_sec;
          p._liveJoints = p.joints + delta;
          p._liveTotalEarned = p.total_joints_earned + delta;
          changed = true;
        }
      }
      if (changed) setPlayers([...playersRef.current]);
      animId = requestAnimationFrame(tick);
    };
    animId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animId);
  }, []);

  const totalPages = Math.max(1, Math.ceil(players.length / PER_PAGE));
  const pageSlice = players.slice(page * PER_PAGE, (page + 1) * PER_PAGE);

  return (
    <div className="players-page">
      <div className="card">
        <div className="players-header">
          <Trophy size={32} className="title-gold" />
          <span className="station-title title-gold">Leaderboard</span>
          <span className="players-count">{players.length} players</span>
        </div>

        {loading ? (
          <p className="players-loading">Loading...</p>
        ) : players.length === 0 ? (
          <p className="players-empty">No players yet.</p>
        ) : (
          <>
            <table className="players-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Name</th>
                  <th>Live Joints</th>
                  <th>Joints Total</th>
                  <th>Latest Win</th>
                  <th>Last Zap / Total</th>
                </tr>
              </thead>
              <tbody>
                {pageSlice.map((p, i) => {
                  const rank = page * PER_PAGE + i;
                  const recentlySeen = (Date.now() / 1000 - p.last_seen_at) < 120;
                  const isActive = p.is_online || (recentlySeen && p.joints_per_sec > 0);
                  const rankClass = rank === 0 ? 'rank-1' : rank === 1 ? 'rank-2' : rank === 2 ? 'rank-3' : '';
                  return (
                    <tr key={p.npub} className={`${isActive ? 'player-online' : ''} ${rankClass}`}>
                      <td className="players-rank">
                        {rank === 0 ? <Trophy size={14} className="rank-gold" /> :
                         rank === 1 ? <Trophy size={14} className="rank-silver" /> :
                         rank === 2 ? <Trophy size={14} className="rank-bronze" /> :
                         rank + 1}
                      </td>
                      <td className="players-name">
                        <a
                          className="players-name-link"
                          href={`/u/${(() => { try { return nip19.npubEncode(p.npub); } catch { return p.npub; } })()}`}
                        >
                          {isActive && <Circle size={8} className="online-dot" />}
                          {p.display_name || <span className="players-noname">noname</span>}
                        </a>
                      </td>
                      <td className="players-joints">
                        <span className="players-joints-value">{fmtNum(p._liveJoints)}</span>
                      </td>
                      <td className="players-joints">
                        <span className="players-total-value">{fmtNum(p._liveTotalEarned)}</span>
                      </td>
                      <td className="players-win">
                        {p._lastWin ? (
                          <span className="players-win-value">
                            <Ticket size={12} className="players-win-icon" />
                            {fmtShort(p._lastWin.sats)} sats
                          </span>
                        ) : (
                          <span className="players-none">-</span>
                        )}
                      </td>
                      <td className="players-zap">
                        {p._lastZap ? (
                          <a
                            className="players-zap-link"
                            href={p._lastZap.nostr_event_id
                              ? `https://njump.me/${(() => { try { return nip19.noteEncode(p._lastZap.nostr_event_id!); } catch { return p._lastZap.nostr_event_id; } })()}`
                              : `https://njump.me/${(() => { try { return nip19.npubEncode(p.npub); } catch { return p.npub; } })()}`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {fmtShort(p._lastZap.amount_sats)} sats
                            <span className="players-zap-total"> / {fmtShort(p._totalZapSats)} sats</span>
                          </a>
                        ) : (
                          <span className="players-none">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {totalPages > 1 && (
              <div className="players-pagination">
                <button disabled={page === 0} onClick={() => setPage(p => p - 1)}>
                  <ChevronLeft size={14} />
                </button>
                <span>{page + 1} / {totalPages}</span>
                <button disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
                  <ChevronRight size={14} />
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
