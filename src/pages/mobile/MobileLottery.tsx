import React, { useEffect, useState, useRef, useCallback } from 'react'
import { Zap, Ticket, Users, Timer, Trophy, TrendingUp, ExternalLink, ChevronLeft, ChevronRight, Cannabis } from 'lucide-react'
import { apiFetch } from '../../lib/api'
import { useAuth } from '../../stores/authStore'
import { useGameDisplay } from '../../stores/gameDisplayStore'
import { nip19 } from 'nostr-tools'
import './MobileLottery.css'

const JUMBLE_URL = 'https://jumble.nsnip.io'

interface LotteryRound {
  id: number
  draws_at: number
  pot_sats: number
  total_tickets: number
  unique_players: number
  total_sats_collected: number
  max_winners: number
  sat_per_ticket: number
}

interface PricePreview { n: number; cost: number }

interface HistoryRound {
  id: number
  draws_at: number
  winner_npub: string | null
  winner_payout_sats: number | null
  winner_payouts: Record<string, number>
  tickets_per_player: Record<string, number>
  winner_names: Record<string, string | null>
  winner_paid_at: number | null
  total_sats_collected: number
  tickets_sold: number
}

interface ZapRecord {
  round_id: number
  recipient_npub: string
  amount_sats: number
  nostr_event_id: string
  display_name: string | null
  created_at: number
}

function fmtSats(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + '\u2009M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + '\u2009K'
  return n.toLocaleString()
}

function fmtCountdown(seconds: number): string {
  if (seconds <= 0) return '00:00:00'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function shortenNpub(npub: string): string {
  if (npub.length <= 19) return npub
  return npub.slice(0, 10) + '...' + npub.slice(-6)
}

function fmtTime(ts: number): string {
  const d = new Date(ts * 1000)
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })
    + ' ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
}

export default function MobileLottery() {
  const auth = useAuth()
  const gd = useGameDisplay()

  const [round, setRound] = useState<LotteryRound | null>(null)
  const [myTickets, setMyTickets] = useState(0)
  const [nextCost, setNextCost] = useState(0)
  const [pricePreview, setPricePreview] = useState<PricePreview[]>([])
  const [countdown, setCountdown] = useState(0)
  const [loading, setLoading] = useState(true)
  const [buying, setBuying] = useState(false)
  const [buyError, setBuyError] = useState<string | null>(null)

  const [history, setHistory] = useState<HistoryRound[]>([])
  const [zapMap, setZapMap] = useState<Map<number, ZapRecord>>(new Map())
  const [histPage, setHistPage] = useState(0)
  const HIST_PER_PAGE = 3

  const drawAtRef = useRef(0)

  const fetchCurrent = useCallback(() => {
    apiFetch('/lottery/current').then(res => {
      if (res.round) {
        setRound(res.round as LotteryRound)
        setMyTickets(res.my_tickets ?? 0)
        setNextCost(res.next_ticket_cost ?? 0)
        setPricePreview(res.price_preview ?? [])
        drawAtRef.current = res.round.draws_at
      }
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const fetchHistory = useCallback(() => {
    apiFetch('/lottery/history').then(res => {
      if (res.rounds) setHistory(res.rounds as HistoryRound[])
    }).catch(() => {})
  }, [])

  const fetchZaps = useCallback(() => {
    apiFetch('/lottery/zaps').then(res => {
      if (res.zaps) {
        const list = res.zaps as ZapRecord[]
        const map = new Map<number, ZapRecord>()
        list.forEach(z => map.set(z.round_id, z))
        setZapMap(map)
      }
    }).catch(() => {})
  }, [])

  useEffect(() => { fetchCurrent(); fetchHistory(); fetchZaps() }, [fetchCurrent, fetchHistory, fetchZaps])

  useEffect(() => {
    const tick = () => {
      const now = Math.floor(Date.now() / 1000)
      setCountdown(Math.max(0, drawAtRef.current - now))
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = location.hostname === 'localhost' ? 'localhost:3420' : location.host
    const ws = new WebSocket(`${proto}//${host}/ws`)
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.type === 'lottery_tick') {
          setRound(prev => prev ? {
            ...prev,
            pot_sats: msg.pot_sats ?? prev.pot_sats,
            total_tickets: msg.total_tickets ?? prev.total_tickets,
            unique_players: msg.unique_players ?? prev.unique_players,
          } : prev)
          if (msg.draws_at !== undefined) drawAtRef.current = msg.draws_at
        }
        if (msg.type === 'lottery_result') { fetchCurrent(); fetchHistory(); fetchZaps() }
      } catch (_) {}
    }
    return () => ws.close()
  }, [fetchCurrent, fetchHistory, fetchZaps])

  const handleBuy = async () => {
    if (!auth.isLoggedIn || buying) return
    setBuying(true)
    setBuyError(null)
    try {
      const res = await apiFetch('/lottery/buy', { method: 'POST' })
      if (res.error || res.reason) {
        setBuyError(res.error || res.reason)
      } else if (res.ok) {
        setMyTickets(res.my_tickets || 0)
        setNextCost(res.next_ticket_cost || 0)
        if (res.price_curve) setPricePreview(res.price_curve)
        fetchCurrent()
      }
    } catch {
      setBuyError('Purchase failed')
    } finally {
      setBuying(false)
    }
  }

  const canBuy = auth.isLoggedIn && auth.joints >= nextCost && nextCost > 0 && !buying && gd.eligible
  const drawTime = drawAtRef.current
    ? new Date(drawAtRef.current * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '--:--'

  if (loading) return <div className="ml-page"><div className="ml-card"><p className="ml-empty">Loading Lottery...</p></div></div>

  return (
    <div className="ml-page">
      {/* ── Hero ──────────────────────────────────────── */}
      <div className="ml-hero">
        <div className="ml-hero-glow ml-hero-glow-gold"></div>
        <div className="ml-hero-icon-wrap">
          <div className="ml-hero-icon ml-hero-icon-gold">
            <Zap size={48} />
          </div>
        </div>
        <h1 className="ml-hero-title ml-gold">Lightning Lottery</h1>
        <p className="ml-hero-subtitle">Buy tickets with Joints, win real sats</p>
        <div className="ml-hero-perks">
          <div className="ml-hero-perk gold"><Zap size={20} /> 80% payout</div>
          <div className="ml-hero-perk gold"><Timer size={20} /> 6 draws daily</div>
        </div>
      </div>

      {/* ── Current Round ─────────────────────────────── */}
      <div className="ml-card">
        <div className="ml-section-header">
          <Zap size={24} className="ml-icon-gold" />
          <span className="ml-section-title ml-gold">Current Round</span>
          {round && <span className="ml-round-badge">#{round.id}</span>}
        </div>

        {round ? (
          <>
            <div className="ml-countdown">
              <Timer size={16} className="ml-icon-muted" />
              <span className="ml-countdown-time">{drawTime}</span>
              <span className="ml-countdown-remaining">{fmtCountdown(countdown)}</span>
            </div>

            <div className="ml-stats">
              <div className="ml-stat">
                <span className="ml-stat-label">Pot</span>
                <span className="ml-stat-value ml-gold"><Zap size={14} /> {fmtSats(round.pot_sats)}</span>
              </div>
              <div className="ml-stat">
                <span className="ml-stat-label">Tickets</span>
                <span className="ml-stat-value"><Ticket size={14} /> {round.total_tickets}</span>
              </div>
              <div className="ml-stat">
                <span className="ml-stat-label">Players</span>
                <span className="ml-stat-value"><Users size={14} /> {round.unique_players}</span>
              </div>
            </div>

            {pricePreview.length > 0 && (
              <div className="ml-price-curve">
                <div className="ml-price-curve-header">
                  <TrendingUp size={14} /> Price Curve
                </div>
                <div className="ml-price-steps">
                  {pricePreview.map((p, i) => (
                    <div key={i} className="ml-price-step">
                      <span className="ml-price-step-n">#{p.n}</span>
                      <span className="ml-price-step-cost"><Cannabis size={12} className="ml-icon-green" /> {fmtSats(p.cost)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!auth.isLoggedIn ? (
              <p className="ml-login-hint">Log in to buy tickets</p>
            ) : (
              <div className="ml-buy">
                {myTickets > 0 && (
                  <span className="ml-my-tickets">Your tickets: {myTickets}</span>
                )}
                <button className="ml-buy-btn" onClick={handleBuy} disabled={!canBuy}>
                  {buying ? 'Buying...' : `Buy Ticket — ${fmtSats(nextCost)} Joints`}
                </button>
                {!gd.eligible && (
                  <span className="ml-hint">
                    Hire {gd.upgradesNeeded} more manager{(gd.upgradesNeeded || 0) !== 1 ? 's' : ''} to unlock
                  </span>
                )}
                {nextCost > auth.joints && gd.eligible && (
                  <span className="ml-hint">Need {fmtSats(nextCost - Math.floor(auth.joints))} more Joints</span>
                )}
                {buyError && <span className="ml-error">{buyError}</span>}
              </div>
            )}
          </>
        ) : (
          <p className="ml-empty">No active round.</p>
        )}
      </div>

      {/* ── Winner History ────────────────────────────── */}
      {(() => {
        const filtered = history.filter(h => h.tickets_sold > 0)
        const totalPages = Math.ceil(filtered.length / HIST_PER_PAGE)
        const paged = filtered.slice(histPage * HIST_PER_PAGE, (histPage + 1) * HIST_PER_PAGE)
        return (
          <div className="ml-card">
            <div className="ml-section-header">
              <Trophy size={24} className="ml-icon-gold" />
              <span className="ml-section-title ml-gold">Winner History</span>
              {totalPages > 1 && (
                <div className="ml-pagination">
                  <button className="ml-page-btn" disabled={histPage === 0} onClick={() => setHistPage(p => p - 1)}>
                    <ChevronLeft size={16} />
                  </button>
                  <span className="ml-page-info">{histPage + 1} / {totalPages}</span>
                  <button className="ml-page-btn" disabled={histPage >= totalPages - 1} onClick={() => setHistPage(p => p + 1)}>
                    <ChevronRight size={16} />
                  </button>
                </div>
              )}
            </div>

            {filtered.length === 0 ? (
              <p className="ml-empty">No completed rounds yet.</p>
            ) : (
              <>
                <div className="ml-history">
                  {paged.map(h => {
                    const winners = h.winner_npub ? h.winner_npub.split(',') : []
                    const zap = zapMap.get(h.id)
                    const potSats = Math.floor(h.total_sats_collected * 0.8)
                    return (
                      <div key={h.id} className="ml-history-card">
                        <div className="ml-history-header">
                          <span className="ml-history-round">#{h.id}</span>
                          <span className="ml-history-time">{fmtTime(h.draws_at)}</span>
                          <span className="ml-history-meta"><Ticket size={12} /> {h.tickets_sold}</span>
                          <span className="ml-history-meta ml-gold"><Zap size={12} /> {fmtSats(potSats)}</span>
                          {zap && (() => {
                            let noteId = zap.nostr_event_id
                            try { noteId = nip19.noteEncode(zap.nostr_event_id) } catch {}
                            return (
                              <a href={`${JUMBLE_URL}/events/${noteId}`} target="_blank" rel="noopener noreferrer" className="ml-zap-link">
                                <Zap size={12} className="ml-zap-icon" /> <ExternalLink size={10} />
                              </a>
                            )
                          })()}
                        </div>
                        <div className="ml-history-winners">
                          {winners.length === 0 ? (
                            <span className="ml-no-winner">No winner</span>
                          ) : (
                            winners.map((npub, i) => (
                              <div key={i} className="ml-winner-row">
                                <Trophy size={14} className="ml-icon-gold" />
                                <a className="ml-winner-name" href={`/u/${(() => { try { return nip19.npubEncode(npub) } catch { return npub } })()}`}>
                                  {h.winner_names?.[npub] || shortenNpub(npub)}
                                </a>
                                <span className="ml-winner-tickets">{h.tickets_per_player?.[npub] || '-'}x</span>
                                <span className="ml-winner-payout">
                                  <Zap size={12} /> {h.winner_payouts?.[npub] ? fmtSats(h.winner_payouts[npub]) : '-'}
                                </span>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>

              </>
            )}
          </div>
        )
      })()}
    </div>
  )
}
