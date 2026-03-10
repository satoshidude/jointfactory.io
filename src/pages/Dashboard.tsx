import { useEffect, useState, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Zap, Trophy,
  ArrowRight, Crown, Circle, ExternalLink,
  TrendingUp, BarChart3,
  UserPlus, Copy, Check, Gift, Shield, Clock,
  ArrowDownToLine, ArrowUpFromLine, Wallet,
} from 'lucide-react'
import { apiFetch } from '../lib/api'
import { useAuth } from '../stores/authStore'
import { nip19 } from 'nostr-tools'
import './Dashboard.css'

const JUMBLE_URL = 'https://jumble.nsnip.io'

interface LotteryRound {
  id: number
  draws_at: number
  pot_sats: number
  total_tickets: number
  unique_players: number
  sat_per_ticket: number
}

interface Player {
  npub: string
  display_name: string | null
  joints: number
  total_joints_earned: number
  joints_per_sec: number
  is_online: boolean
  total_won_sats: number
  created_at: number
}

interface Referral {
  display_name: string | null
  created_at: number
  rewarded: boolean
  managers: number
}

interface HistoryRound {
  id: number
  draws_at: number
  winner_npub: string | null
  winner_payout_sats: number | null
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

function fmtNum(n: number): string {
  if (n >= 1e12) return (n / 1e12).toFixed(1) + '\u2009T'
  if (n >= 1e9) return (n / 1e9).toFixed(1) + '\u2009B'
  if (n >= 1e6) return (n / 1e6).toFixed(1) + '\u2009M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + '\u2009K'
  return Math.floor(n).toLocaleString()
}

function fmtSats(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + '\u2009M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + '\u2009K'
  return n.toLocaleString()
}


function fmtTime(ts: number): string {
  const d = new Date(ts * 1000)
  return d.toLocaleDateString('en-US', { day: '2-digit', month: '2-digit' })
    + ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function shortenNpub(npub: string, pre = 8, post = 4): string {
  if (npub.length <= pre + post + 3) return npub
  return npub.slice(0, pre) + '...' + npub.slice(-post)
}

// ── SVG Chart Components ───────────────────────────────────────────────────

const CHART_COLORS = [
  { stroke: '#ffd700', glow: 'rgba(255,215,0,.5)', label: 'gold' },
  { stroke: '#39ff14', glow: 'rgba(57,255,20,.5)', label: 'green' },
  { stroke: '#cc44ff', glow: 'rgba(204,68,255,.5)', label: 'purple' },
  { stroke: '#00d4ff', glow: 'rgba(0,212,255,.5)', label: 'cyan' },
]

function NeonLineChart({ lines, labels, width = 400, height = 160, yLabel }: {
  lines: { values: number[]; color: string; glow: string; name: string }[]
  labels: string[]
  width?: number
  height?: number
  yLabel?: string
}) {
  const pad = { top: 16, right: 16, bottom: 28, left: 48 }
  const w = width - pad.left - pad.right
  const h = height - pad.top - pad.bottom

  const allVals = lines.flatMap(l => l.values)
  const maxVal = Math.max(...allVals, 1)

  const gridLines = 4
  const yStep = maxVal / gridLines

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="dash-chart-svg">
      <defs>
        {lines.map((_line, i) => (
          <filter key={i} id={`glow-line-${i}`}>
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        ))}
      </defs>

      {/* Grid */}
      {Array.from({ length: gridLines + 1 }).map((_, i) => {
        const y = pad.top + h - (i / gridLines) * h
        return (
          <g key={i}>
            <line x1={pad.left} y1={y} x2={width - pad.right} y2={y}
              stroke="var(--border-color)" strokeWidth="1" opacity="0.5" />
            <text x={pad.left - 6} y={y + 3} textAnchor="end"
              fill="var(--text-secondary)" fontSize="8" fontFamily="var(--font-body)">
              {fmtNum(Math.round(yStep * i))}
            </text>
          </g>
        )
      })}

      {/* X labels */}
      {labels.map((label, i) => {
        const x = pad.left + (i / Math.max(labels.length - 1, 1)) * w
        return (
          <text key={i} x={x} y={height - 6} textAnchor="middle"
            fill="var(--text-secondary)" fontSize="7" fontFamily="var(--font-body)">
            {label}
          </text>
        )
      })}

      {/* Y label */}
      {yLabel && (
        <text x={8} y={pad.top + h / 2} textAnchor="middle"
          fill="var(--text-secondary)" fontSize="7" fontFamily="var(--font-heading)"
          transform={`rotate(-90 8 ${pad.top + h / 2})`} letterSpacing="1">
          {yLabel}
        </text>
      )}

      {/* Lines */}
      {lines.map((line, li) => {
        if (line.values.length < 2) return null
        const points = line.values.map((v, i) => {
          const x = pad.left + (i / (line.values.length - 1)) * w
          const y = pad.top + h - (v / maxVal) * h
          return `${x},${y}`
        }).join(' ')
        return (
          <g key={li}>
            <polyline points={points} fill="none" stroke={line.color}
              strokeWidth="2" filter={`url(#glow-line-${li})`} strokeLinejoin="round" />
            {/* Dot at end */}
            {(() => {
              const lastI = line.values.length - 1
              const cx = pad.left + (lastI / (line.values.length - 1)) * w
              const cy = pad.top + h - (line.values[lastI] / maxVal) * h
              return <circle cx={cx} cy={cy} r="3" fill={line.color} filter={`url(#glow-line-${li})`} />
            })()}
          </g>
        )
      })}
    </svg>
  )
}

function NeonBarChart({ bars, width = 400, height = 140 }: {
  bars: { label: string; value: number; color: string; glow: string; secondary?: number; secondaryColor?: string }[]
  width?: number
  height?: number
}) {
  const pad = { top: 12, right: 12, bottom: 28, left: 48 }
  const w = width - pad.left - pad.right
  const h = height - pad.top - pad.bottom

  const maxVal = Math.max(...bars.map(b => b.value), ...bars.map(b => b.secondary || 0), 1)
  const barW = Math.min(24, (w / bars.length) * 0.6)
  const gap = (w - barW * bars.length) / (bars.length + 1)

  const gridLines = 3
  const yStep = maxVal / gridLines

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="dash-chart-svg">
      <defs>
        <filter id="glow-bar">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {/* Grid */}
      {Array.from({ length: gridLines + 1 }).map((_, i) => {
        const y = pad.top + h - (i / gridLines) * h
        return (
          <g key={i}>
            <line x1={pad.left} y1={y} x2={width - pad.right} y2={y}
              stroke="var(--border-color)" strokeWidth="1" opacity="0.5" />
            <text x={pad.left - 6} y={y + 3} textAnchor="end"
              fill="var(--text-secondary)" fontSize="8" fontFamily="var(--font-body)">
              {fmtNum(Math.round(yStep * i))}
            </text>
          </g>
        )
      })}

      {/* Bars */}
      {bars.map((bar, i) => {
        const x = pad.left + gap + i * (barW + gap)
        const barH = (bar.value / maxVal) * h
        const y = pad.top + h - barH
        const secH = bar.secondary ? (bar.secondary / maxVal) * h : 0
        const secY = pad.top + h - secH
        return (
          <g key={i}>
            {bar.secondary !== undefined && (
              <rect x={x + barW * 0.3} y={secY} width={barW * 0.4} height={secH}
                fill={bar.secondaryColor || 'rgba(255,255,255,.1)'} rx="2" />
            )}
            <rect x={x} y={y} width={barW} height={barH}
              fill={bar.color} rx="2" filter="url(#glow-bar)" opacity="0.85" />
            <text x={x + barW / 2} y={height - 6} textAnchor="middle"
              fill="var(--text-secondary)" fontSize="7" fontFamily="var(--font-body)">
              {bar.label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

// ── Main Dashboard ─────────────────────────────────────────────────────────

export default function Dashboard() {
  const auth = useAuth()
  const navigate = useNavigate()

  const [, setRound] = useState<LotteryRound | null>(null)
  const [, setMyTickets] = useState(0)
  const [players, setPlayers] = useState<Player[]>([])
  const [, setOnlineCount] = useState(0)
  const [history, setHistory] = useState<HistoryRound[]>([])
  const [zaps, setZaps] = useState<ZapRecord[]>([])

  // Invite state
  const [inviteCode, setInviteCode] = useState('')
  const [referrals, setReferrals] = useState<Referral[]>([])
  const [rewardedCount, setRewardedCount] = useState(0)
  const [copied, setCopied] = useState(false)

  // Wallet state
  interface WalletPayment { type: string; amount_sats: number; ts: number; ref: string | number }
  const [walletPayments, setWalletPayments] = useState<WalletPayment[]>([])
  const [walletSats, setWalletSats] = useState(0)
  const [walletTab, setWalletTab] = useState<'deposits' | 'won' | 'withdrawn'>('won')

  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    apiFetch('/lottery/current').then(data => {
      if (data?.round) {
        setRound(data.round as LotteryRound)
        setMyTickets(data.my_tickets || 0)
      }
    })
    apiFetch('/players').then(data => {
      if (data?.players) {
        const sorted = (data.players as Player[]).sort((a, b) => b.total_joints_earned - a.total_joints_earned)
        setPlayers(sorted)
        setOnlineCount(sorted.filter(p => p.is_online).length)
      }
    })
    apiFetch('/lottery/history').then(data => {
      if (data?.rounds) setHistory((data.rounds as HistoryRound[]).filter(h => h.tickets_sold > 0))
    })
    apiFetch('/lottery/zaps').then(data => {
      if (data?.zaps) setZaps(data.zaps as ZapRecord[])
    })
    apiFetch('/player/invite').then((d: any) => {
      if (d.ok) {
        setInviteCode(d.invite_code || '')
        setReferrals(d.referrals || [])
        setRewardedCount(d.rewarded_count || 0)
      }
    }).catch(() => {})
    apiFetch('/player/payments').then((d: any) => {
      if (d.ok) {
        setWalletPayments(d.payments || [])
        setWalletSats(d.sats || 0)
      }
    }).catch(() => {})
  }, [auth.isLoggedIn])

  useEffect(() => {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = window.location.hostname === 'localhost' ? 'localhost:3420' : window.location.host
    const ws = new WebSocket(`${proto}//${host}/ws?npub=${auth.npub || ''}`)
    wsRef.current = ws
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
        }
        if (msg.type === 'lottery_result') {
          apiFetch('/lottery/current').then(d => { if (d?.round) setRound(d.round as LotteryRound) })
          apiFetch('/lottery/history').then(d => { if (d?.rounds) setHistory((d.rounds as HistoryRound[]).filter(h => h.tickets_sold > 0)) })
          apiFetch('/lottery/zaps').then(d => { if (d?.zaps) setZaps(d.zaps as ZapRecord[]) })
        }
      } catch {}
    }
    return () => ws.close()
  }, [auth.npub])

  const top5 = useMemo(() => players.slice(0, 5), [players])
  const top3 = useMemo(() => players.slice(0, 3), [players])
  const recentHistory = useMemo(() => history.slice(0, 5), [history])
  const recentZaps = useMemo(() => zaps.slice(0, 6), [zaps])

  const myPlayer = useMemo(() => {
    if (!auth.npub) return null
    return players.find(p => p.npub === auth.npub) || null
  }, [players, auth.npub])

  // ── Chart data ──

  // Production efficiency: total_joints / days_active for top 3 + you
  const productionChartData = useMemo(() => {
    const now = Math.floor(Date.now() / 1000)
    const chartPlayers: (Player & { _color: typeof CHART_COLORS[0]; _isYou: boolean })[] = []

    // Top 3
    top3.forEach((p, i) => {
      if (auth.npub && p.npub === auth.npub) return // skip if you're already in top 3
      chartPlayers.push({ ...p, _color: CHART_COLORS[i], _isYou: false })
    })

    // Add current user if logged in and not already in top 3
    if (myPlayer && !top3.find(p => p.npub === auth.npub)) {
      chartPlayers.push({ ...myPlayer, _color: CHART_COLORS[3], _isYou: true })
    } else if (myPlayer) {
      const idx = chartPlayers.findIndex(p => p.npub === auth.npub)
      if (idx >= 0) chartPlayers[idx]._isYou = true
    }

    // Build daily production rate (approximation: total / days since join, simulated curve)
    return chartPlayers.map(p => {
      const daysActive = Math.max(1, (now - p.created_at) / 86400)
      const totalK = p.total_joints_earned / 1000
      // Create a simulated growth curve (exponential ramp-up)
      const points = 10
      const values: number[] = []
      for (let i = 0; i <= points; i++) {
        const t = i / points
        // Simulated S-curve: slow start, fast middle, plateau
        const progress = 1 - Math.exp(-3 * t)
        values.push(totalK * progress)
      }
      return {
        name: (p._isYou ? 'YOU' : (p.display_name || 'noname')),
        values,
        color: p._color.stroke,
        glow: p._color.glow,
        daysActive: Math.round(daysActive),
      }
    })
  }, [top3, myPlayer, auth.npub])

  // Lottery history bars (pots + tickets)
  const lotteryChartData = useMemo(() => {
    const rounds = [...history].reverse().slice(-12)
    return rounds.map(r => ({
      label: `#${r.id}`,
      value: Math.floor((r.total_sats_collected || 0) * 0.5),
      color: 'rgba(255,215,0,.7)',
      glow: 'rgba(255,215,0,.4)',
      secondary: r.tickets_sold * 100, // scale tickets for visibility
      secondaryColor: 'rgba(57,255,20,.2)',
    }))
  }, [history])

  // Chart legend for production
  const productionLegend = productionChartData.map(p => ({
    name: p.name, color: p.color, days: p.daysActive,
  }))

  // X-axis labels for production chart (simulated days)
  const productionLabels = useMemo(() => {
    if (productionChartData.length === 0) return []
    const maxDays = Math.max(...productionChartData.map(p => p.daysActive))
    return Array.from({ length: 6 }, (_, i) => {
      const d = Math.round((i / 5) * maxDays)
      return d + 'd'
    })
  }, [productionChartData])

  const inviteUrl = inviteCode ? `${window.location.origin}/?ref=${inviteCode}` : ''

  function copyLink() {
    if (!inviteUrl) return
    navigator.clipboard.writeText(inviteUrl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  function timeAgo(ts: number): string {
    const diff = Math.floor(Date.now() / 1000) - ts
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
    return `${Math.floor(diff / 86400)}d ago`
  }

  return (
    <div className="dash">
      {/* === MAIN LAYOUT: Left sidebar (1/3) + Right content (2/3) === */}
      <div className="dash-main-layout">
        {/* Left column: Invite + Wallet stacked */}
        <div className="dash-left-col">
          {/* Invite Card */}
          <div className="dash-card dash-card-glow-green">
            <div className="dash-card-title-row">
              <UserPlus size={32} className="title-green" />
              <span className="station-title title-green">Invite a Buddy</span>
            </div>
            <div className="dash-card-body">
              {auth.isLoggedIn ? (
                <div className="dash-invite-content">
                  <div className="dash-invite-reward">
                    <Gift size={16} className="dash-invite-reward-icon" />
                    <div>
                      <strong>1st buddy with 3 managers</strong> → free auto-manager!<br />
                      <strong>Every buddy</strong> → 10 sats for both
                    </div>
                  </div>
                  <div className="dash-invite-progress">
                    <span className="dash-invite-stat">
                      <span className="dash-invite-stat-val">{referrals.length}</span>
                      <span className="dash-invite-stat-lbl">Invited</span>
                    </span>
                    <span className="dash-invite-stat">
                      <span className="dash-invite-stat-val dash-neon-green">{rewardedCount}</span>
                      <span className="dash-invite-stat-lbl">Rewarded</span>
                    </span>
                    <span className="dash-invite-stat">
                      <span className="dash-invite-stat-val dash-neon-gold">+{rewardedCount * 10}</span>
                      <span className="dash-invite-stat-lbl">Sats earned</span>
                    </span>
                  </div>
                  <div className="dash-invite-link-row">
                    <input className="dash-invite-link-input" readOnly value={inviteUrl} />
                    <button className="dash-invite-copy-btn" onClick={copyLink}>
                      {copied ? <Check size={16} /> : <Copy size={16} />}
                    </button>
                  </div>
                  {referrals.length > 0 && (
                    <div className="dash-invite-referrals">
                      {referrals.slice(0, 5).map((r, i) => (
                        <div key={i} className={`dash-invite-ref-row${r.rewarded ? ' rewarded' : ''}`}>
                          <div className="dash-invite-ref-info">
                            <span className="dash-invite-ref-name">{r.display_name || 'Unknown'}</span>
                            <span className="dash-invite-ref-meta">
                              <Clock size={10} /> {timeAgo(r.created_at)}
                              <Shield size={10} /> {r.managers}/3
                            </span>
                          </div>
                          <span className={`dash-invite-ref-status ${r.rewarded ? 'done' : 'pending'}`}>
                            {r.rewarded ? <><Zap size={12} /> +10 sats</> : `${3 - r.managers} to go`}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="dash-invite-teaser">
                  <div className="dash-invite-teaser-anim">
                    <div className="dash-invite-teaser-circle">
                      <UserPlus size={32} />
                    </div>
                  </div>
                  <h3 className="dash-invite-teaser-title">Join the Factory!</h3>
                  <p className="dash-invite-teaser-text">
                    Sign in to get your invite link. Invite buddies and earn <strong>free auto-managers</strong> and <strong>sats</strong> for every friend who joins!
                  </p>
                  <div className="dash-invite-teaser-perks">
                    <span><Gift size={14} /> Free auto-manager</span>
                    <span><Zap size={14} /> 10 sats per buddy</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Wallet Card */}
          {(() => {
            const deposits = walletPayments.filter(p => p.type === 'deposit')
            const won = walletPayments.filter(p => p.type === 'lottery_win' || p.type === 'referral_reward')
            const withdrawn = walletPayments.filter(p => p.type === 'withdraw')
            const totalDeposited = deposits.reduce((s, p) => s + p.amount_sats, 0)
            const totalWon = won.reduce((s, p) => s + p.amount_sats, 0)
            const totalWithdrawn = withdrawn.reduce((s, p) => s + p.amount_sats, 0)
            const tabItems = walletTab === 'deposits' ? deposits : walletTab === 'won' ? won : withdrawn
            const isNeg = walletTab === 'withdrawn'
            return (
              <div className="dash-card dash-card-glow-gold">
                <div className="dash-card-title-row">
                  <Wallet size={32} className="title-gold" />
                  <span className="station-title title-gold">Sats Account</span>
                  <span className="dash-wallet-balance">
                    <Zap size={14} /> {Math.floor(walletSats).toLocaleString()} sats
                  </span>
                </div>
                <div className="dash-card-body">
                  <div className="dash-wallet-tabs">
                    <button className={`dash-wallet-tab${walletTab === 'deposits' ? ' active' : ''}`} onClick={() => setWalletTab('deposits')}>
                      <ArrowDownToLine size={13} />
                      <span>Deposited</span>
                      <span className="dash-wallet-tab-total">+{totalDeposited.toLocaleString()}</span>
                    </button>
                    <button className={`dash-wallet-tab${walletTab === 'won' ? ' active' : ''}`} onClick={() => setWalletTab('won')}>
                      <Trophy size={13} />
                      <span>Won</span>
                      <span className="dash-wallet-tab-total">+{totalWon.toLocaleString()}</span>
                    </button>
                    <button className={`dash-wallet-tab${walletTab === 'withdrawn' ? ' active' : ''}`} onClick={() => setWalletTab('withdrawn')}>
                      <ArrowUpFromLine size={13} />
                      <span>Withdrawn</span>
                      <span className="dash-wallet-tab-total">-{totalWithdrawn.toLocaleString()}</span>
                    </button>
                  </div>
                  {tabItems.length === 0 ? (
                    <div className="dash-empty">No {walletTab === 'deposits' ? 'deposits' : walletTab === 'won' ? 'wins' : 'withdrawals'} yet</div>
                  ) : (
                    <div className="dash-wallet-list">
                      {tabItems.slice(0, 8).map((p, i) => (
                        <div key={i} className={`dash-wallet-item dash-wallet-${p.type}`}>
                          <div className="dash-wallet-icon">
                            {p.type === 'deposit' && <ArrowDownToLine size={14} />}
                            {p.type === 'lottery_win' && <Trophy size={14} />}
                            {p.type === 'referral_reward' && <UserPlus size={14} />}
                            {p.type === 'withdraw' && <ArrowUpFromLine size={14} />}
                          </div>
                          <div className="dash-wallet-info">
                            <span className="dash-wallet-type">
                              {p.type === 'deposit' && 'Deposit'}
                              {p.type === 'lottery_win' && 'Lottery Win'}
                              {p.type === 'referral_reward' && `Referral: ${p.ref || 'Buddy'}`}
                              {p.type === 'withdraw' && 'Withdrawal'}
                            </span>
                            <span className="dash-wallet-time">{timeAgo(p.ts)}</span>
                          </div>
                          <span className={`dash-wallet-amount ${isNeg ? 'negative' : 'positive'}`}>
                            {isNeg ? '-' : '+'}{p.amount_sats.toLocaleString()}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )
          })()}
        </div>

        {/* Right column: Production Race + Lottery History */}
        <div className="dash-right-col">
          {/* Production Race */}
          <div className="dash-card dash-card-glow-green">
            <div className="dash-card-title-row">
              <TrendingUp size={32} className="title-green" />
              <span className="station-title title-green">Production Race</span>
            </div>
            <div className="dash-card-body">
              {productionChartData.length > 0 ? (
                <>
                  <NeonLineChart
                    lines={productionChartData}
                    labels={productionLabels}
                    yLabel="JOINTS (K)"
                    width={520}
                    height={170}
                  />
                  <div className="dash-chart-legend">
                    {productionLegend.map((l, i) => (
                      <div key={i} className="dash-legend-item">
                        <span className="dash-legend-dot" style={{ background: l.color, boxShadow: `0 0 6px ${l.color}` }} />
                        <span className="dash-legend-name">{l.name}</span>
                        <span className="dash-legend-days">{l.days}d</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <p className="dash-empty">No production data</p>
              )}
            </div>
          </div>

          {/* Lottery Pot History */}
          {lotteryChartData.length > 0 && (
            <div className="dash-card dash-card-glow-gold">
              <div className="dash-card-title-row">
                <BarChart3 size={32} className="title-gold" />
                <span className="station-title title-gold">Lottery Pot History</span>
                <button className="dash-view-all" onClick={() => navigate('/lottery')}>
                  All rounds <ArrowRight size={12} />
                </button>
              </div>
              <div className="dash-card-body">
                <NeonBarChart bars={lotteryChartData} width={800} height={160} />
                <div className="dash-chart-legend" style={{ marginTop: 8 }}>
                  <div className="dash-legend-item">
                    <span className="dash-legend-dot" style={{ background: 'rgba(255,215,0,.7)', boxShadow: '0 0 6px rgba(255,215,0,.4)' }} />
                    <span className="dash-legend-name">Pot (sats)</span>
                  </div>
                  <div className="dash-legend-item">
                    <span className="dash-legend-dot" style={{ background: 'rgba(57,255,20,.3)' }} />
                    <span className="dash-legend-name">Tickets (scaled)</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* === ROW 4: Leaderboard + Winner History === */}
      <div className="dash-split-row">
        <div className="dash-card dash-card-wide">
          <div className="dash-card-title-row">
            <Trophy size={32} className="title-gold" />
            <span className="station-title title-gold">Leaderboard</span>
            <button className="dash-view-all" onClick={() => navigate('/leaderboard')}>
              View all <ArrowRight size={12} />
            </button>
          </div>
          <div className="dash-card-body !p-0">
            <table className="dash-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Player</th>
                  <th>Joints</th>
                  <th>Rate</th>
                  <th>Won</th>
                </tr>
              </thead>
              <tbody>
                {top5.map((p, i) => {
                  const rankClass = i === 0 ? 'dash-rank-gold' : i === 1 ? 'dash-rank-silver' : i === 2 ? 'dash-rank-bronze' : ''
                  let npubEncoded = p.npub
                  try { npubEncoded = nip19.npubEncode(p.npub) } catch {}
                  return (
                    <tr key={p.npub} className={rankClass}>
                      <td className="dash-table-rank">
                        {i < 3 ? <Crown size={14} /> : i + 1}
                      </td>
                      <td>
                        <a href={`${JUMBLE_URL}/users/${npubEncoded}`} target="_blank" rel="noopener noreferrer"
                          className="dash-player-link">
                          {p.is_online && <Circle size={6} className="dash-online-dot" />}
                          {p.display_name || <span className="dash-noname">noname</span>}
                        </a>
                      </td>
                      <td className="dash-table-num dash-neon-green">{fmtNum(p.total_joints_earned)}</td>
                      <td className="dash-table-num">{fmtNum(p.joints_per_sec)}/s</td>
                      <td className="dash-table-num">
                        {p.total_won_sats > 0
                          ? <span className="dash-neon-gold">{fmtSats(p.total_won_sats)}</span>
                          : <span className="dash-dim">-</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="dash-card">
          <div className="dash-card-title-row">
            <Zap size={32} className="title-gold" />
            <span className="station-title title-gold">Recent Draws</span>
            <button className="dash-view-all" onClick={() => navigate('/lottery')}>
              Details <ArrowRight size={12} />
            </button>
          </div>
          <div className="dash-card-body !p-0">
            {recentHistory.length === 0 ? (
              <p className="dash-empty">No draws yet</p>
            ) : (
              <div className="dash-winner-list">
                {recentHistory.map(h => {
                  const winners = h.winner_npub ? h.winner_npub.split(',') : []
                  return (
                    <div key={h.id} className="dash-winner-item">
                      <div className="dash-winner-round">#{h.id}</div>
                      <div className="dash-winner-info">
                        {winners.length > 0 ? (
                          <span className="dash-winner-name">
                            {shortenNpub(winners[0])}
                            {winners.length > 1 && ` +${winners.length - 1}`}
                          </span>
                        ) : (
                          <span className="dash-dim">No winner</span>
                        )}
                        <span className="dash-winner-time">{fmtTime(h.draws_at)}</span>
                      </div>
                      <div className="dash-winner-payout">
                        {h.winner_payout_sats && h.winner_payout_sats > 0
                          ? <span className="dash-neon-gold">{fmtSats(h.winner_payout_sats)} sats</span>
                          : <span className="dash-dim">-</span>}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* === ROW 6: Zap Feed === */}
      {recentZaps.length > 0 && (
        <div className="dash-card dash-card-full">
          <div className="dash-card-title-row">
            <Zap size={32} className="title-gold" />
            <span className="station-title title-gold">Nostr Zap Feed</span>
            <a href={`${JUMBLE_URL}/users/npub159gup76k2wv4zmev5ldau2zrwfafllkw2jughwrslhdd3lz3yvnq3tzm2u`}
              target="_blank" rel="noopener noreferrer" className="dash-view-all">
              Jumble <ExternalLink size={12} />
            </a>
          </div>
          <div className="dash-card-body !p-0">
            <div className="dash-zap-grid">
              {recentZaps.map((z, i) => {
                let noteId = z.nostr_event_id
                try { noteId = nip19.noteEncode(z.nostr_event_id) } catch {}
                return (
                  <a key={i} className="dash-zap-item"
                    href={`${JUMBLE_URL}/events/${noteId}`} target="_blank" rel="noopener noreferrer">
                    <Zap size={14} className="dash-zap-bolt" />
                    <div className="dash-zap-info">
                      <span className="dash-zap-name">{z.display_name || shortenNpub(z.recipient_npub)}</span>
                      <span className="dash-zap-detail">Round #{z.round_id}</span>
                    </div>
                    <span className="dash-zap-amount">{fmtSats(z.amount_sats)} sats</span>
                  </a>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
