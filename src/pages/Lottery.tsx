import React, { useEffect, useState, useRef, useCallback } from 'react';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Ticket, Trophy, Zap, Timer, Users, TrendingUp, ExternalLink } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../stores/authStore';
import { useGameDisplay } from '../stores/gameDisplayStore';
import { nip19 } from 'nostr-tools';

const JUMBLE_URL = 'https://jumble.nsnip.io';
import './Lottery.css';

// -- Types --

interface LotteryRound {
  id: number;
  draws_at: number;
  pot_sats: number;
  total_tickets: number;
  unique_players: number;
  total_sats_collected: number;
  max_winners: number;
  sat_per_ticket: number;
}

interface PricePreview {
  n: number;
  cost: number;
}

interface HistoryRound {
  id: number;
  draws_at: number;
  winner_npub: string | null;
  winner_payout_sats: number | null;
  winner_payouts: Record<string, number>;
  tickets_per_player: Record<string, number>;
  winner_names: Record<string, string | null>;
  winner_paid_at: number | null;
  total_sats_collected: number;
  tickets_sold: number;
}

interface ZapRecord {
  round_id: number;
  recipient_npub: string;
  amount_sats: number;
  nostr_event_id: string;
  display_name: string | null;
  created_at: number;
}

// -- Helpers --

function fmtSats(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + '\u2009M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + '\u2009K';
  return n.toLocaleString();
}

function fmtCountdown(seconds: number): string {
  if (seconds <= 0) return '00:00:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function shortenNpub(npub: string, pre = 10, post = 6): string {
  if (npub.length <= pre + post + 3) return npub;
  return npub.slice(0, pre) + '...' + npub.slice(-post);
}

function fmtTime(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })
    + ' ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

// -- Component --

export default function LotteryPage() {
  const auth = useAuth();

  // Current round state
  const [round, setRound] = useState<LotteryRound | null>(null);
  const [myTickets, setMyTickets] = useState(0);
  const [nextCost, setNextCost] = useState(0);
  const [pricePreview, setPricePreview] = useState<PricePreview[]>([]);
  const [countdown, setCountdown] = useState(0);
  const [loading, setLoading] = useState(true);
  const [buying, setBuying] = useState(false);
  const [buyError, setBuyError] = useState<string | null>(null);

  // History state
  const [history, setHistory] = useState<HistoryRound[]>([]);
  const [zapList, setZapList] = useState<ZapRecord[]>([]);
  const [zapMap, setZapMap] = useState<Map<number, ZapRecord>>(new Map());

  // Refs for countdown interval
  const drawAtRef = useRef(0);

  // Fetch current round data
  const fetchCurrent = useCallback(() => {
    apiFetch('/lottery/current').then(res => {
      if (res.round) {
        setRound(res.round as LotteryRound);
        setMyTickets(res.my_tickets ?? 0);
        setNextCost(res.next_ticket_cost ?? 0);
        setPricePreview(res.price_preview ?? []);
        drawAtRef.current = res.round.draws_at;
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  // Fetch history
  const fetchHistory = useCallback(() => {
    apiFetch('/lottery/history').then(res => {
      if (res.rounds) setHistory(res.rounds as HistoryRound[]);
    }).catch(() => {});
  }, []);

  // Fetch zap receipts
  const fetchZaps = useCallback(() => {
    apiFetch('/lottery/zaps').then(res => {
      if (res.zaps) {
        const list = res.zaps as ZapRecord[];
        setZapList(list);
        const map = new Map<number, ZapRecord>();
        list.forEach(z => map.set(z.round_id, z));
        setZapMap(map);
      }
    }).catch(() => {});
  }, []);

  // Initial load
  useEffect(() => {
    fetchCurrent();
    fetchHistory();
    fetchZaps();
  }, [fetchCurrent, fetchHistory, fetchZaps]);

  // Countdown timer (ticks every second)
  useEffect(() => {
    const tick = () => {
      const now = Math.floor(Date.now() / 1000);
      const remaining = Math.max(0, drawAtRef.current - now);
      setCountdown(remaining);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // WebSocket for real-time lottery updates
  useEffect(() => {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = location.hostname === 'localhost' ? 'localhost:3420' : location.host;
    const ws = new WebSocket(`${proto}//${host}/ws`);

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'lottery_tick') {
          setRound(prev => prev ? {
            ...prev,
            pot_sats: msg.pot_sats ?? prev.pot_sats,
            total_tickets: msg.total_tickets ?? prev.total_tickets,
            unique_players: msg.unique_players ?? prev.unique_players,
          } : prev);
          if (msg.draws_at !== undefined) {
            drawAtRef.current = msg.draws_at;
          }
        }
        if (msg.type === 'lottery_result') {
          // A draw just happened, refresh everything
          fetchCurrent();
          fetchHistory();
          fetchZaps();
        }
      } catch (_) {}
    };

    return () => ws.close();
  }, [fetchCurrent, fetchHistory, fetchZaps]);

  // Buy ticket handler
  const handleBuy = async () => {
    if (!auth.isLoggedIn || buying) return;
    setBuying(true);
    setBuyError(null);

    try {
      const res = await apiFetch('/lottery/buy', { method: 'POST' });
      if (res.error || res.reason) {
        setBuyError(res.error || res.reason);
      } else if (res.ok) {
        handleBuySuccess(res);
        fetchCurrent();
      }
    } catch {
      setBuyError('Purchase failed');
    } finally {
      setBuying(false);
    }
  };

  // Update joints from server after buy
  const handleBuySuccess = async (res: any) => {
    if (res.ok) {
      setMyTickets(res.my_tickets || 0);
      setNextCost(res.next_ticket_cost || 0);
      if (res.price_curve) setPricePreview(res.price_curve);
    }
  };

  const gd = useGameDisplay();
  const canBuy = auth.isLoggedIn && auth.joints >= nextCost && nextCost > 0 && !buying && gd.eligible;

  if (loading) {
    return (
      <div className="lottery-page">
        <div className="card">
          <p className="lottery-loading">Loading Lottery...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="lottery-page">
      {/* Current Round Status — top */}
      <div className="card lottery-status-card">
        <div className="lottery-section-header">
          <Zap size={32} className="title-gold" />
          <span className="station-title title-gold">Lightning Lottery</span>
          {round && <span className="lottery-round-badge">Round #{round.id}</span>}
        </div>

        {round ? (
          <>
            <div className="lottery-countdown-row">
              <Timer size={20} className="lottery-timer-icon" />
              <div className="lottery-countdown">
                <span className="lottery-countdown-value">
                  {drawAtRef.current ? new Date(drawAtRef.current * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--'}
                  <span style={{ fontSize: '0.5em', fontWeight: 400, color: 'var(--text-secondary)', marginLeft: 8 }}>
                    ({fmtCountdown(countdown)})
                  </span>
                </span>
                <span className="lottery-countdown-label">until draw</span>
              </div>
            </div>

            <div className="lottery-stats-grid">
              <div className="lottery-stat">
                <span className="lottery-stat-label">Pot</span>
                <span className="lottery-stat-value lottery-pot">{fmtSats(round.pot_sats)} sats</span>
              </div>
              <div className="lottery-stat">
                <span className="lottery-stat-label">Tickets</span>
                <span className="lottery-stat-value">
                  <Ticket size={14} /> {round.total_tickets}
                </span>
              </div>
              <div className="lottery-stat">
                <span className="lottery-stat-label">Players</span>
                <span className="lottery-stat-value">
                  <Users size={14} /> {round.unique_players}
                </span>
              </div>
            </div>

            {/* Price curve preview */}
            {pricePreview.length > 0 && (
              <div className="lottery-price-preview">
                <div className="lottery-price-preview-header">
                  <TrendingUp size={14} />
                  <span>Price Curve</span>
                </div>
                <div className="lottery-price-steps">
                  {pricePreview.map((p, i) => (
                    <div key={i} className="lottery-price-step">
                      <span className="lottery-price-step-pos">Ticket #{p.n}</span>
                      <span className="lottery-price-step-cost">{fmtSats(p.cost)} Joints</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Buy Tickets — integrated */}
            {!auth.isLoggedIn ? (
              <p className="lottery-login-hint">Log in to buy tickets.</p>
            ) : (
              <div className="lottery-buy-section">
                <div className="lottery-my-tickets">
                  <span className="lottery-my-tickets-label">Your Tickets:</span>
                  <span className="lottery-my-tickets-value">{myTickets}</span>
                </div>

                <div className="lottery-buy-row">
                  <button
                    className="lottery-buy-btn"
                    onClick={handleBuy}
                    disabled={!canBuy}
                  >
                    {buying ? 'Buying...' : `Buy Ticket (${fmtSats(nextCost)} Joints)`}
                  </button>
                </div>
                {!gd.eligible && auth.isLoggedIn && (
                  <p className="lottery-elig-hint">
                    {gd.upgradesNeeded} auto-manager{(gd.upgradesNeeded||0) !== 1 ? 's' : ''} left to buy tickets!
                  </p>
                )}

                {nextCost > auth.joints && (
                  <p className="lottery-insufficient">
                    Not enough Joints ({Math.floor(auth.joints).toLocaleString()} available)
                  </p>
                )}

                {buyError && (
                  <p className="lottery-error">{buyError}</p>
                )}
              </div>
            )}
          </>
        ) : (
          <p className="lottery-empty">No active round.</p>
        )}
      </div>

      {/* Winner History */}
      <div className="card lottery-history-card">
        <div className="lottery-section-header">
          <Trophy size={32} className="title-gold" />
          <span className="station-title title-gold">Winner History</span>
        </div>

        {history.length === 0 ? (
          <p className="lottery-empty">No completed rounds yet.</p>
        ) : (
          <div className="lottery-table-wrap">
            <table className="lottery-table">
              <thead>
                <tr>
                  <th>Winner</th>
                  <th>Tickets</th>
                  <th>Payout</th>
                </tr>
              </thead>
              <tbody>
                {history.filter(h => h.tickets_sold > 0).map(h => {
                  const winners = h.winner_npub ? h.winner_npub.split(',') : [];
                  const zap = zapMap.get(h.id);
                  const potSats = Math.floor(h.total_sats_collected * 0.8);
                  return (
                    <React.Fragment key={h.id}>
                      <tr className="lottery-group-header">
                        <td colSpan={2}>
                          <div className="lottery-group-info">
                            <span className="lottery-group-round">#{h.id}</span>
                            <span className="lottery-group-time">{fmtTime(h.draws_at)}</span>
                            <span className="lottery-group-meta">
                              <Ticket size={12} /> {h.tickets_sold}
                            </span>
                            <span className="lottery-group-meta lottery-group-pot">
                              <Zap size={12} /> {fmtSats(potSats)} sats
                            </span>
                            {zap && (() => {
                              let noteId = zap.nostr_event_id;
                              try { noteId = nip19.noteEncode(zap.nostr_event_id); } catch {}
                              return (
                                <a
                                  href={`${JUMBLE_URL}/events/${noteId}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="lottery-zap-link"
                                  title={`Zap: ${zap.amount_sats} sats — View on Nostr`}
                                >
                                  <Zap size={12} className="lottery-zap-icon" />
                                  <ExternalLink size={10} />
                                </a>
                              );
                            })()}
                          </div>
                        </td>
                      </tr>
                      {winners.length === 0 ? (
                        <tr key={`${h.id}-none`} className="lottery-history-row">
                          <td className="lottery-history-winner"><span className="lottery-no-winner">No winner</span></td>
                          <td className="lottery-history-tickets">-</td>
                          <td className="lottery-history-payout"><span className="lottery-no-winner">-</span></td>
                        </tr>
                      ) : (
                        winners.map((npub, i) => (
                          <tr key={`${h.id}-${i}`} className="lottery-history-row">
                            <td className="lottery-history-winner">
                              <a className="lottery-winner-link" href={`/u/${(() => { try { return nip19.npubEncode(npub); } catch { return npub; } })()}`}>
                                {h.winner_names?.[npub] || shortenNpub(npub)}
                              </a>
                            </td>
                            <td className="lottery-history-tickets">{h.tickets_per_player?.[npub] || '-'}</td>
                            <td className="lottery-history-payout">
                              {h.winner_payouts?.[npub] ? (
                                <span className="lottery-payout-value">{fmtSats(h.winner_payouts[npub])} sats</span>
                              ) : (
                                <span className="lottery-no-winner">-</span>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Nostr Zap Feed */}
      <div className="card lottery-zap-feed-card">
        <div className="lottery-section-header">
          <Zap size={32} className="title-gold" />
          <span className="station-title title-gold">Nostr Zap Feed</span>
          <a
            href={`${JUMBLE_URL}/users/npub17a7rs2vcdqs9xhsl2w4qeydafaflllh5475su48y0utes9tufffqs83r9s`}
            target="_blank"
            rel="noopener noreferrer"
            className="lottery-jumble-link"
          >
            All Zaps on Jumble <ExternalLink size={12} />
          </a>
        </div>

        {zapList.length === 0 ? (
          <p className="lottery-empty">No zaps published yet.</p>
        ) : (
          <div className="lottery-zap-list">
            {zapList.map((z, i) => {
              let noteId = z.nostr_event_id;
              try { noteId = nip19.noteEncode(z.nostr_event_id); } catch {}
              return (
                <div key={i} className="lottery-zap-item">
                  <div className="lottery-zap-item-left">
                    <Zap size={16} className="lottery-zap-icon" />
                    <div>
                      <a className="lottery-winner-link" href={`/u/${(() => { try { return nip19.npubEncode(z.recipient_npub); } catch { return z.recipient_npub; } })()}`}>
                        {z.display_name || shortenNpub(z.recipient_npub)}
                      </a>
                      <span className="lottery-zap-item-detail">
                        {fmtSats(z.amount_sats)} sats &middot; Round #{z.round_id} &middot; {fmtTime(z.created_at)}
                      </span>
                    </div>
                  </div>
                  <a
                    href={`${JUMBLE_URL}/events/${noteId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="lottery-zap-item-link"
                    title="View on Nostr"
                  >
                    <ExternalLink size={14} />
                  </a>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
