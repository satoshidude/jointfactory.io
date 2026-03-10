import { useRef, useEffect, useState, useMemo, useCallback } from 'react'
import { useGameLoop, PLANTATION_DEFS,
  plantLevelCost, plantMilestoneInfo,
  plantEffectiveCycle, plantOutput, plantRate,
  courierTripTime, fabrikCycleTime,
  getSpeedUpgrade, MAX_SPEED_LEVEL,
} from '../game/useGameLoop'
import { useAuth } from '../stores/authStore'
import { apiFetch } from '../lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Factory, Cannabis, Footprints, PersonStanding, Zap, Timer, Ticket, Sprout, Trophy, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react'
import { nip19 } from 'nostr-tools'
import { useGameDisplay } from '../stores/gameDisplayStore'
import './Game.css'
import './Dashboard.css'
import './Lottery.css'

interface PlayerInfo {
  npub: string
  display_name: string | null
  joints_per_sec: number
  total_joints_earned: number
  total_won_sats: number
  created_at: number
  is_online: boolean
  manager_count: number
}

interface LotteryRound {
  id: number
  draws_at: number
  pot_sats: number
  total_tickets: number
  unique_players: number
}

interface DrawResult {
  round_id: number
  winners: { npub: string; payout_sats: number; tickets: number; display_name?: string | null }[]
  pot_sats: number
  myWin: number | null
}

interface HistoryRound {
  id: number
  draws_at: number
  winner_npub: string | null
  winner_payouts: Record<string, number>
  tickets_per_player: Record<string, number>
  winner_names: Record<string, string | null>
  total_sats_collected: number
  tickets_sold: number
}

const CHART_COLORS = [
  { stroke: '#ffd700', glow: 'rgba(255,215,0,.5)' },
  { stroke: '#39ff14', glow: 'rgba(57,255,20,.5)' },
  { stroke: '#cc44ff', glow: 'rgba(204,68,255,.5)' },
  { stroke: '#00d4ff', glow: 'rgba(0,212,255,.5)' },
  { stroke: '#ff69b4', glow: 'rgba(255,105,180,.5)' },
  { stroke: '#ff6b35', glow: 'rgba(255,107,53,.5)' },
  { stroke: '#00ff88', glow: 'rgba(0,255,136,.5)' },
  { stroke: '#ff4444', glow: 'rgba(255,68,68,.5)' },
  { stroke: '#88aaff', glow: 'rgba(136,170,255,.5)' },
  { stroke: '#ffaa00', glow: 'rgba(255,170,0,.5)' },
]

function ProgressCircle({ progress, size = 36, stroke = 3, color = 'var(--neon-green)', trackColor = 'rgba(57,255,20,.15)' }: {
  progress: number; size?: number; stroke?: number; color?: string; trackColor?: string
}) {
  const r = (size - stroke) / 2
  const circ = 2 * Math.PI * r
  const clamped = Math.max(0, Math.min(1, progress))
  const offset = circ * (1 - clamped)
  const prevRef = useRef(clamped)
  const flashRef = useRef(0)
  if (prevRef.current > 0.7 && clamped < 0.3) {
    flashRef.current++
  }
  prevRef.current = clamped
  return (
    <svg width={size} height={size} className="progress-circle">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={trackColor} strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <circle key={flashRef.current} cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={color} strokeWidth={stroke} strokeDasharray={circ} strokeDashoffset={0}
        strokeLinecap="round" transform={`rotate(-90 ${size / 2} ${size / 2})`}
        className="cycle-flash" />
    </svg>
  )
}

function fmtNum(n: number): string {
  if (n >= 1e12) return (n / 1e12).toFixed(1) + 'T'
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return Math.floor(n).toLocaleString()
}


const HIGHLIGHT_COLORS: Record<string, string> = {
  green: 'text-[var(--neon-green)]',
  purple: 'text-[var(--neon-purple)]',
  flamingo: 'text-[#ff69b4]',
  cannabis: 'text-[var(--neon-purple)]',
}
function StatRow({ label, value, highlight }: { label: string; value: string; highlight?: string }) {
  const colorClass = highlight ? (HIGHLIGHT_COLORS[highlight] || 'text-[var(--text-primary)]') : 'text-[var(--text-primary)]'
  return (
    <div className="flex justify-between text-sm">
      <span className="text-[var(--text-secondary)]">{label}</span>
      <span className={`font-semibold tabular-nums ${colorClass}`}>
        {value}
      </span>
    </div>
  )
}

function fmtSats(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + '\u2009M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + '\u2009K'
  return n.toLocaleString()
}

function fmtTime(ts: number): string {
  const d = new Date(ts * 1000)
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })
    + ' ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
}

function shortenNpub(npub: string): string {
  if (npub.length <= 16) return npub
  return npub.slice(0, 10) + '...' + npub.slice(-6)
}

function fmtCountdown(ms: number): string {
  if (ms <= 0) return '00:00:00'
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export default function Game() {
  const auth = useAuth()

  const { state, actions } = useGameLoop(
    auth.isLoggedIn ? auth.joints : 0,
    auth.isLoggedIn ? auth.sats : 0,
    auth.isLoggedIn ? auth.setJoints : undefined,
    auth.isLoggedIn ? auth.setSats : undefined,
    auth.isNewAccount,
  )

  useEffect(() => {
    if (auth.isLoggedIn && state.totalJointsEarned > 0) {
      auth.setTotalJointsEarned(state.totalJointsEarned)
    }
  }, [state.totalJointsEarned]) // eslint-disable-line react-hooks/exhaustive-deps

  const totalRate = state.plantagen.reduce((s, p) => s + plantRate(p), 0)
  const cTrip = courierTripTime(state.courier)
  const fCycle = fabrikCycleTime(state.fabrik)

  // ── Live Rate + Production Race data ──
  const [players, setPlayers] = useState<PlayerInfo[]>([])

  useEffect(() => {
    apiFetch('/players').then(data => {
      if (data?.players) {
        setPlayers((data.players as PlayerInfo[]).sort((a, b) => b.total_won_sats - a.total_won_sats || b.total_joints_earned - a.total_joints_earned))
      }
    })
    const iv = setInterval(() => {
      apiFetch('/players').then(data => {
        if (data?.players) {
          setPlayers((data.players as PlayerInfo[]).sort((a, b) => b.total_won_sats - a.total_won_sats || b.total_joints_earned - a.total_joints_earned))
        }
      })
    }, 30000)
    return () => clearInterval(iv)
  }, [])

  // Production Race: area chart showing total production vs time since registration
  const CHART_POINTS = 48
  const [rateLogs, setRateLogs] = useState<{ npub: string; ts: number; rate: number; total: number }[]>([])

  useEffect(() => {
    let cancelled = false
    const fetchLogs = () => {
      fetch('/api/players/rate-log')
        .then(r => r.json())
        .then(d => { if (!cancelled && d.logs) setRateLogs(d.logs) })
        .catch(() => {})
    }
    fetchLogs()
    const iv = setInterval(fetchLogs, 60_000)
    return () => { cancelled = true; clearInterval(iv) }
  }, [])

  const raceChartData = useMemo(() => {
    const activePlayers = players
      .filter(p => (p.manager_count >= 3 && p.total_joints_earned > 0) || auth.npub === p.npub)
      .slice(0, 8)
    if (activePlayers.length === 0) return null
    const now = Math.floor(Date.now() / 1000)

    // Logged in: 2h window, logged out: all-time (from earliest log)
    let CHART_WINDOW: number
    if (auth.isLoggedIn) {
      CHART_WINDOW = 2 * 3600
    } else {
      const earliest = rateLogs.length > 0 ? Math.min(...rateLogs.map(l => l.ts)) : now - 86400
      CHART_WINDOW = Math.max(now - earliest, 3600)
    }
    const windowStart = now - CHART_WINDOW

    const lines = activePlayers.map((p, i) => {
      const isYou = auth.npub === p.npub
      const rate = isYou ? totalRate : p.joints_per_sec
      const c = CHART_COLORS[i % CHART_COLORS.length]

      // Get this player's rate events sorted by time
      const allEvents = rateLogs
        .filter(l => l.npub === p.npub)
        .sort((a, b) => a.ts - b.ts)

      // Build segments, treating rate=0 (logout) as carry-forward of last active rate
      const segments: { from: number; to: number; rate: number }[] = []
      let lastActiveRate = 0
      for (let e = 0; e < allEvents.length; e++) {
        const ev = allEvents[e]
        const nextTs = e < allEvents.length - 1 ? allEvents[e + 1].ts : now
        if (ev.rate > 0) {
          lastActiveRate = ev.rate
          segments.push({ from: ev.ts, to: nextTs, rate: ev.rate })
        } else {
          segments.push({ from: ev.ts, to: nextTs, rate: lastActiveRate })
        }
      }

      // Find baseline rate at window start
      let baseRate = 0
      for (const seg of segments) {
        if (windowStart >= seg.from && windowStart < seg.to) { baseRate = seg.rate; break }
      }
      // If no segment covers windowStart, find the last segment before it
      if (baseRate === 0) {
        for (const seg of segments) {
          if (seg.to <= windowStart) baseRate = seg.rate
        }
      }
      if (baseRate === 0) baseRate = 1 // avoid division by zero

      // Sample points: growth factor relative to baseline (1× = no change)
      const points: number[] = []
      for (let h = 0; h <= CHART_POINTS; h++) {
        const timeAt = windowStart + (h / CHART_POINTS) * CHART_WINDOW
        if (timeAt > now) { points.push(points.length > 0 ? points[points.length - 1] : 1); continue }
        let rateAtTime = 0
        for (const seg of segments) {
          if (timeAt >= seg.from && timeAt < seg.to) { rateAtTime = seg.rate; break }
        }
        if (rateAtTime === 0 && segments.length > 0 && timeAt >= segments[segments.length - 1].to) {
          rateAtTime = lastActiveRate
        }
        points.push(Math.max(0, rateAtTime / baseRate))
      }
      const growth = points[points.length - 1]
      return { name: isYou ? 'YOU' : (p.display_name || 'noname'), npub: p.npub, rate, growth, color: c.stroke, glow: c.glow, isYou, points }
    })
    const rawMax = Math.max(...lines.flatMap(l => l.points), 1.1)
    const maxVal = rawMax <= 2 ? Math.ceil(rawMax * 10) / 10 : rawMax <= 10 ? Math.ceil(rawMax) : Math.ceil(rawMax / 5) * 5
    const maxHours = Math.round(CHART_WINDOW / 3600)
    return { lines, maxVal, maxHours }
  }, [players, auth.npub, auth.isLoggedIn, totalRate, rateLogs])

  // ── Lottery data ──
  const [lotteryRound, setLotteryRound] = useState<LotteryRound | null>(null)
  const [lotteryMyTickets, setLotteryMyTickets] = useState(0)
  const [lotteryNextCost, setLotteryNextCost] = useState(0)
  const [lotteryBuying, setLotteryBuying] = useState(false)
  const [lotteryCountdown, setLotteryCountdown] = useState('--:--')
  const [drawResult, setDrawResult] = useState<DrawResult | null>(null)
  const [lotteryHistory, setLotteryHistory] = useState<HistoryRound[]>([])
  const [historyPage, setHistoryPage] = useState(0)
  const [lbPage, setLbPage] = useState(0)
  const HISTORY_PER_PAGE = 2
  const [myLastWin, setMyLastWin] = useState<{ round_id: number; amount_sats: number; paid_at: number } | null>(null)
  const [satsFlash, setSatsFlash] = useState(false)
  const triggerSatsFlash = useCallback(() => {
    setSatsFlash(false)
    requestAnimationFrame(() => {
      setSatsFlash(true)
      setTimeout(() => setSatsFlash(false), 800)
    })
  }, [])
  const [jointsFlash, setJointsFlash] = useState(false)
  const triggerJointsFlash = useCallback(() => {
    setJointsFlash(false)
    requestAnimationFrame(() => {
      setJointsFlash(true)
      setTimeout(() => setJointsFlash(false), 800)
    })
  }, [])

  // Milestone flash: { plantIndex: multiplier }
  const [milestoneFlash, setMilestoneFlash] = useState<Record<number, number>>({})
  const triggerMilestoneFlash = useCallback((idx: number, mult: number) => {
    setMilestoneFlash(prev => ({ ...prev, [idx]: mult }))
    setTimeout(() => setMilestoneFlash(prev => { const n = { ...prev }; delete n[idx]; return n }), 1500)
  }, [])

  useEffect(() => {
    apiFetch('/lottery/current').then(data => {
      if (data?.round) {
        setLotteryRound(data.round as LotteryRound)
        setLotteryMyTickets(data.my_tickets || 0)
        setLotteryNextCost(data.next_ticket_cost || 0)
      }
      if (data?.my_last_win) setMyLastWin(data.my_last_win)
    })
    apiFetch('/lottery/history').then(data => {
      if (data?.rounds) setLotteryHistory(data.rounds as HistoryRound[])
    })
  }, [])

  useEffect(() => {
    if (!lotteryRound?.draws_at) return
    const iv = setInterval(() => {
      const rem = Math.max(0, lotteryRound.draws_at * 1000 - Date.now())
      setLotteryCountdown(fmtCountdown(rem))
    }, 1000)
    return () => clearInterval(iv)
  }, [lotteryRound?.draws_at])

  // WebSocket for lottery updates
  useEffect(() => {
    const wsUrl = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`
    console.log('[WS] Connecting to', wsUrl)
    const ws = new WebSocket(wsUrl)
    ws.onopen = () => console.log('[WS] Connected')
    ws.onerror = (e) => console.error('[WS] Error', e)
    ws.onclose = (e) => console.log('[WS] Closed', e.code, e.reason)
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.type === 'lottery_tick') {
          setDrawResult(prev => {
            // Clear draw result once new round is ticking
            if (prev && msg.draws_at && msg.draws_at !== prev.round_id) return null
            return prev
          })
          setLotteryRound(prev => {
            if (prev && msg.pot_sats != null && msg.pot_sats !== prev.pot_sats) {
              triggerSatsFlash()
            }
            return prev ? { ...prev, pot_sats: msg.pot_sats ?? prev.pot_sats, total_tickets: msg.total_tickets ?? prev.total_tickets, unique_players: msg.unique_players ?? prev.unique_players } : prev
          })
        }
        if (msg.type === 'lottery_result') {
          setDrawResult({
            round_id: msg.round_id,
            winners: msg.winners || [],
            pot_sats: msg.pot_sats || 0,
            myWin: null,
          })
          apiFetch('/lottery/current').then(d => {
            if (d?.round) {
              setLotteryRound(d.round as LotteryRound)
              setLotteryMyTickets(d.my_tickets || 0)
              setLotteryNextCost(d.next_ticket_cost || 0)
            }
            if (d?.my_last_win) setMyLastWin(d.my_last_win)
          })
          apiFetch('/lottery/history').then(d => {
            if (d?.rounds) setLotteryHistory(d.rounds as HistoryRound[])
          })
        }
        if (msg.type === 'lottery_win') {
          setDrawResult(prev => prev ? { ...prev, myWin: msg.payout_sats || 0 } : {
            round_id: msg.round_id,
            winners: [],
            pot_sats: 0,
            myWin: msg.payout_sats || 0,
          })
        }
        if (msg.type === 'sats_update' && msg.sats != null) {
          auth.setSats(msg.sats)
        }
      } catch {}
    }
    return () => ws.close()
  }, [])

  const handleBuyTicket = useCallback(async () => {
    if (lotteryBuying || lotteryNextCost <= 0) return
    setLotteryBuying(true)
    try {
      const res = await apiFetch('/lottery/buy', { method: 'POST' })
      if (res?.ok) {
        setLotteryMyTickets(res.my_tickets || 0)
        setLotteryNextCost(res.next_ticket_cost || 0)
      }
    } catch {}
    setLotteryBuying(false)
  }, [lotteryBuying, lotteryNextCost])


  // Eligibility: 3 auto-managers required
  const mgrCount = useMemo(() => {
    let c = 0
    if (state.plantagen?.[0]?.managerLevel > 0) c++
    if (state.courier?.mgrLevel > 0) c++
    if (state.fabrik?.mgrLevel > 0) c++
    return c
  }, [state])
  const eligible = mgrCount >= 3
  const managersNeeded = 3 - mgrCount

  const gd = useGameDisplay()
  useEffect(() => {
    gd.update({
      cannabis: state.cannabis,
      cannabisAtFactory: state.cannabisAtFactory,
      courierCarrying: state.courier.carrying,
      joints: state.joints,
      sats: state.sats,
      rawGameState: state,
      eligible,
      upgradesNeeded: managersNeeded,
    })
  }, [state, eligible, managersNeeded])

  return (
    <>
    <div className="game">
      {/* Station Cards Row */}
      <div className="station-row">
        {/* Left column: Factory + Courier */}
        <div className="left-column">

        {/* Factory */}
        <Card className={`station-card basement-card !py-0 !gap-0${satsFlash ? ' sats-flash' : ''}`}>
          <CardHeader className="!flex !flex-row !items-center !gap-2.5 !p-4 !pb-2">
            <Factory size={32} className="title-purple" />
            <CardTitle className="station-title title-purple">Factory</CardTitle>
          </CardHeader>

          <CardContent className="!p-4 !pt-2 flex flex-col gap-3">
            <div className="basement-top">
              <div className={`station-cycle${!state.fabrik.processing ? ' cycle-complete' : ''}${state.joints >= state.fabrik.capCost ? ' cycle-clickable' : ''}`}
                onClick={() => { if (state.joints >= state.fabrik.capCost) actions.upgradeFabrikCap() }}>
                <ProgressCircle
                  progress={state.fabrik.processing ? 1 - state.fabrik.timer / state.fabrik.processTime : 0}
                  size={100} stroke={4} color="var(--neon-purple)" trackColor="rgba(204,68,255,.15)"
                />
                <span className={`station-cycle-label purple${!state.fabrik.processing ? ' cycle-done' : ''}`}>
                  +{state.fabrik.processing ? fmtNum(state.fabrik._currentCharge) : fmtNum(state.fabrik.capacity)}
                </span>
              </div>
              <div className="flex flex-col gap-1.5 flex-1">
                <div className="flex justify-between text-sm">
                  <span className="text-[var(--text-secondary)]">Joints</span>
                  <span className="font-semibold tabular-nums text-[var(--neon-green)]">{fmtNum(state.joints)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-[var(--text-secondary)]">Weed</span>
                  <span className="font-semibold tabular-nums" style={{ color: '#2e7d32' }}>{fmtNum(state.cannabisAtFactory)}</span>
                </div>
                <div className="flex justify-between text-sm font-bold">
                  <span className="text-[var(--text-primary)]">All-Time</span>
                  <span className="tabular-nums text-[var(--text-primary)] flex items-center gap-1">
                    <Trophy size={13} />{fmtNum(state.fabrik.total)}
                  </span>
                </div>
                <StatRow label="Batch" value={`${fmtNum(state.fabrik.capacity / fCycle)}/s`} />
                <StatRow label="Speed" value={`${state.fabrik.speed.toFixed(1)}x`} />
              </div>
            </div>

            <div className="upgrades">
              <button className="upgrade-btn" disabled={state.joints < state.fabrik.capCost}
                onClick={actions.upgradeFabrikCap}>
                <span>Cap x2</span>|<span className="cost">{fmtNum(state.fabrik.capCost)}</span>
              </button>
              {auth.isLoggedIn ? (
                state.fabrik.speedLevel < MAX_SPEED_LEVEL ? (() => {
                  const next = getSpeedUpgrade(state.fabrik.speedLevel)!
                  return (
                    <button className="upgrade-btn sats-upgrade" disabled={state.sats < next.cost}
                      onClick={() => { actions.upgradeFabrikSpeed(); triggerSatsFlash() }}>
                      <span>Speed {next.label}</span>|<span className="cost sats">{next.cost} sats</span>
                    </button>
                  )
                })() : (
                  <button className="upgrade-btn sats-upgrade" disabled>
                    <span>MAX</span>
                  </button>
                )
              ) : (
                <button className="upgrade-btn mgr-btn mgr-login" disabled>
                  <span>Auto Manager</span>|<span className="cost sats">Login</span>
                </button>
              )}
              {state.fabrik.mgrLevel === 0 && (
                <button
                  className={`action-btn fabrik${state.fabrik.processing ? ' active' : ''}`}
                  onClick={actions.rollJoints}
                  disabled={state.fabrik.processing || state.cannabisAtFactory === 0}
                >
                  {state.fabrik.processing ? 'Rolling...' : 'Roll'}
                </button>
              )}
            </div>
            {auth.isLoggedIn && state.fabrik.mgrLevel === 0 && (
              <div className="upgrades">
                <button className="upgrade-btn mgr-btn" disabled={state.sats < state.fabrik.mgrCost}
                  onClick={() => { actions.buyFabrikManager(); triggerSatsFlash() }}>
                  <span>Auto Manager</span>|<span className="cost sats">{state.fabrik.mgrCost} sats</span>
                </button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Courier Track */}
        <Card className="station-card !py-0 !gap-0">
          <CardContent className="!p-3">
            <div className="courier-visual courier-row">
              <span className="courier-stock stock-factory">{fmtNum(state.cannabisAtFactory)}</span>
              <div className="courier-track">
                <div className="courier-endpoints">
                  <Factory size={28} className="courier-endpoint-lucide factory" />
                  <Cannabis size={28} className="courier-endpoint-lucide plant" />
                </div>
                <div className="courier-path" />
                <div className="courier-figure" style={{ left: `${Math.max(8, Math.min(92, 100 - state.courier.posX))}%` }}>
                  {state.courier.state !== 'idle' && (
                    <span className="courier-carrying-label">
                      {state.courier.state === 'toFactory' ? `${fmtNum(state.courier.carrying)} weed` : 'collecting'}
                    </span>
                  )}
                  <PersonStanding size={32} className={`courier-lucide-icon${state.courier.state !== 'idle' ? ' moving' : ''}`}
                  style={state.courier.state === 'toFactory' ? { transform: 'scaleX(-1)' } : undefined} />
                </div>
              </div>
              <span className="courier-stock stock-plant">{fmtNum(state.cannabis)}</span>
            </div>
          </CardContent>
        </Card>

        {/* Courier */}
        <Card className={`station-card !py-0 !gap-0${satsFlash ? ' sats-flash' : ''}`}>
          <CardHeader className="!flex !flex-row !items-center !gap-2.5 !p-4 !pb-2">
            <Footprints size={32} className="title-flamingo" />
            <CardTitle className="station-title title-flamingo">Courier</CardTitle>
          </CardHeader>

          <CardContent className="!p-4 !pt-2 flex flex-col gap-3">
            <div className="basement-top">
              <div className={`station-cycle${state.courier.state === 'idle' ? ' cycle-complete' : ''}${state.joints >= state.courier.capCost ? ' cycle-clickable' : ''}`}
                onClick={() => { if (state.joints >= state.courier.capCost) actions.upgradeCourierCap() }}>
                <ProgressCircle
                  progress={state.courier.state !== 'idle' ? state.courier.posX / 100 : 0}
                  size={100} stroke={4} color="#ff69b4" trackColor="rgba(255,105,180,.15)"
                />
                <span className={`station-cycle-label flamingo${state.courier.state === 'idle' ? ' cycle-done' : ''}`}>
                  {fmtNum(state.courier.capacity)}
                </span>
              </div>
              <div className="flex flex-col gap-1.5 flex-1">
                <StatRow label="Payload" value={fmtNum(state.courier.capacity)} highlight="flamingo" />
                <StatRow label="Trip Time" value={`${cTrip.toFixed(2)}s`} />
                <StatRow label="Speed" value={`${state.courier.speed.toFixed(1)}x`} />
              </div>
            </div>

            <div className="upgrades">
              <button className="upgrade-btn" disabled={state.joints < state.courier.capCost}
                onClick={actions.upgradeCourierCap}>
                <span>Cap x2</span>|<span className="cost">{fmtNum(state.courier.capCost)}</span>
              </button>
              {auth.isLoggedIn ? (
                state.courier.speedLevel < MAX_SPEED_LEVEL ? (() => {
                  const next = getSpeedUpgrade(state.courier.speedLevel)!
                  return (
                    <button className="upgrade-btn sats-upgrade" disabled={state.sats < next.cost}
                      onClick={() => { actions.upgradeCourierSpeed(); triggerSatsFlash() }}>
                      <span>Speed {next.label}</span>|<span className="cost sats">{next.cost} sats</span>
                    </button>
                  )
                })() : (
                  <button className="upgrade-btn sats-upgrade" disabled>
                    <span>Speed MAX</span>
                  </button>
                )
              ) : (
                <button className="upgrade-btn mgr-btn mgr-login" disabled>
                  <span>Auto Manager</span>|<span className="cost sats">Login</span>
                </button>
              )}
              {state.courier.mgrLevel === 0 && (
                <button
                  className={`action-btn courier${state.courier.state !== 'idle' ? ' active' : ''}`}
                  onClick={actions.sendCourier}
                  disabled={state.courier.state !== 'idle' || state.cannabis === 0}
                >
                  {state.courier.state !== 'idle' ? 'En route...' : 'Send'}
                </button>
              )}
            </div>
            {auth.isLoggedIn && state.courier.mgrLevel === 0 && (
              <div className="upgrades">
                <button className="upgrade-btn mgr-btn" disabled={state.sats < state.courier.mgrCost}
                  onClick={() => { actions.buyCourierManager(); triggerSatsFlash() }}>
                  <span>Auto Manager</span>|<span className="cost sats">{state.courier.mgrCost} sats</span>
                </button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Leaderboard */}
        <Card className="station-card leaderboard-card !py-0 !gap-0">
          <CardHeader className="!flex !flex-row !items-center !gap-2.5 !p-4 !pb-2">
            <Trophy size={32} className="title-gold" />
            <CardTitle className="station-title title-gold">Lottery Leaderboard</CardTitle>
            <div style={{ flex: 1 }} />
            <a href="https://jumble.nsnip.io/users/npub17a7rs2vcdqs9xhsl2w4qeydafaflllh5475su48y0utes9tufffqs83r9s" target="_blank" rel="noopener noreferrer" className="lb-nostr-link">
              <ExternalLink size={12} /> Nostr
            </a>
          </CardHeader>
          <CardContent className="!p-4 !pt-2">
            {(() => {
              const earners = players.filter(p => p.total_won_sats > 0)
              if (earners.length === 0) return <p className="text-sm text-[var(--text-secondary)]">No earnings yet.</p>
              const LB_PER_PAGE = 10
              const lbTotalPages = Math.ceil(earners.length / LB_PER_PAGE)
              const lbPaged = earners.slice(lbPage * LB_PER_PAGE, (lbPage + 1) * LB_PER_PAGE)
              const maxRate = Math.max(...earners.map(p => auth.npub === p.npub ? totalRate : p.joints_per_sec), 1)
              return (
                <>
                  <div className="leaderboard-header">
                    <span className="lb-col lb-col-rank">#</span>
                    <span className="lb-col lb-col-name">Name</span>
                    <span className="lb-col lb-col-sats">Earnings</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    {lbPaged.map((p, i) => {
                      const globalIdx = lbPage * LB_PER_PAGE + i
                      const isYou = auth.npub === p.npub
                      const rate = isYou ? totalRate : p.joints_per_sec
                      const rankClass = globalIdx === 0 ? ' lb-rank-1' : globalIdx === 1 ? ' lb-rank-2' : globalIdx === 2 ? ' lb-rank-3' : ''
                      const barPct = rate > 0 ? Math.min(100, (rate / maxRate) * 100) : 0
                      const barColor = isYou ? 'var(--neon-gold)' : CHART_COLORS[globalIdx % CHART_COLORS.length].stroke
                      return (
                        <div key={p.npub} className={`leaderboard-row${isYou ? ' lb-you' : ''}${rankClass}${barPct > 0 ? ' lb-has-bar' : ''}`}>
                          <div className="lb-rate-bar" style={{ width: `${barPct}%`, background: barColor }} />
                          <span className="lb-col lb-col-rank tabular-nums">
                            {globalIdx < 3 ? <Trophy size={13} className={globalIdx === 0 ? 'lb-trophy-gold' : globalIdx === 1 ? 'lb-trophy-silver' : 'lb-trophy-bronze'} /> : `#${globalIdx + 1}`}
                          </span>
                          <span className="lb-col lb-col-name">
                            {isYou ? 'YOU' : (
                              <a href={`/u/${(() => { try { return nip19.npubEncode(p.npub); } catch { return p.npub; } })()}`} className="lb-name-link">
                                {p.display_name || 'noname'}
                              </a>
                            )}
                          </span>
                          <span className="lb-col lb-col-sats tabular-nums">
                            <Zap size={11} className="lb-sats-icon" />{fmtSats(p.total_won_sats)}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                  {lbTotalPages > 1 && (
                    <div className="wh-pagination" style={{ marginTop: '8px' }}>
                      <button className="wh-page-btn" disabled={lbPage === 0} onClick={() => setLbPage(p => p - 1)}><ChevronLeft size={14} /></button>
                      <span className="wh-page-info">{lbPage + 1}/{lbTotalPages}</span>
                      <button className="wh-page-btn" disabled={lbPage >= lbTotalPages - 1} onClick={() => setLbPage(p => p + 1)}><ChevronRight size={14} /></button>
                    </div>
                  )}
                </>
              )
            })()}

            {/* Winner History inline */}
            {(() => {
              const filteredHistory = lotteryHistory.filter(h => h.tickets_sold > 0)
              const totalPages = Math.ceil(filteredHistory.length / HISTORY_PER_PAGE)
              const pagedHistory = filteredHistory.slice(historyPage * HISTORY_PER_PAGE, (historyPage + 1) * HISTORY_PER_PAGE)
              if (filteredHistory.length === 0) return null
              return (
              <div className="winner-history-section">
                <div className="winner-history-title">
                  <Trophy size={13} className="title-gold" />
                  <span className="wh-title-text">Winner History</span>
                  {totalPages > 1 && (
                    <div className="wh-pagination">
                      <button className="wh-page-btn" disabled={historyPage === 0} onClick={() => setHistoryPage(p => p - 1)}><ChevronLeft size={14} /></button>
                      <span className="wh-page-info">{historyPage + 1}/{totalPages}</span>
                      <button className="wh-page-btn" disabled={historyPage >= totalPages - 1} onClick={() => setHistoryPage(p => p + 1)}><ChevronRight size={14} /></button>
                    </div>
                  )}
                </div>
                <div className="wh-cards">
                  {pagedHistory.map(h => {
                    const winners = h.winner_npub ? h.winner_npub.split(',') : []
                    const potSats = Math.floor(h.total_sats_collected * 0.8)
                    return (
                      <div key={h.id} className="wh-card">
                        <div className="wh-card-header">
                          <span className="wh-card-round">#{h.id}</span>
                          <span className="wh-card-time">{fmtTime(h.draws_at)}</span>
                          <span className="wh-card-meta"><Ticket size={11} /> {h.tickets_sold}</span>
                          <span className="wh-card-pot"><Zap size={11} /> {fmtSats(potSats)}</span>
                        </div>
                        {winners.length === 0 ? (
                          <div className="wh-no-winner">No winner</div>
                        ) : (
                          <div className="wh-winners">
                            {winners.map((npub, i) => {
                              let npubBech32 = npub
                              try { npubBech32 = nip19.npubEncode(npub) } catch {}
                              const name = h.winner_names?.[npub] || shortenNpub(npub)
                              const payout = h.winner_payouts?.[npub] || 0
                              const tickets = h.tickets_per_player?.[npub] || 0
                              return (
                                <div key={`${h.id}-${i}`} className="wh-winner-row">
                                  <Trophy size={14} className="wh-winner-trophy" />
                                  <a href={`/u/${npubBech32}`} className="wh-winner-name">
                                    {name}
                                  </a>
                                  {tickets > 0 && <span className="wh-winner-tickets">{tickets} ticket{tickets !== 1 ? 's' : ''}</span>}
                                  {payout > 0 && <span className="wh-winner-payout"><Zap size={11} /> {fmtSats(payout)}</span>}
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
              )
            })()}
          </CardContent>
        </Card>

        </div>{/* end left-column */}

        {/* Right column */}
        <div className="right-column">

        {/* Lightning Lottery – Dashboard hero style */}
        <div className={`dash-hero${drawResult ? ' draw-result-active' : ''}${satsFlash ? ' sats-flash' : ''}`}>
          <div className="dash-hero-inner">
            <div className="dash-hero-left">
              <div className="dash-hero-label">
                <Zap size={32} className="dash-hero-zap" />
                LIGHTNING LOTTERY
                {lotteryRound && <span className="dash-hero-round">#{lotteryRound.id}</span>}
              </div>
              <div className="dash-hero-timer">
                <Timer size={24} className="dash-hero-timer-icon" />
                <div className="dash-hero-time">
                  {lotteryRound?.draws_at
                    ? new Date(lotteryRound.draws_at * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    : '--:--'}
                </div>
                <div className="dash-hero-countdown">{lotteryCountdown}</div>
              </div>
            </div>
            {drawResult ? (
              <div className="draw-result">
                {drawResult.myWin != null && drawResult.myWin > 0 && (
                  <div className="draw-result-win">
                    <Zap size={20} className="draw-result-zap" />
                    <span className="draw-result-amount">+{fmtSats(drawResult.myWin)} sats</span>
                    <span className="draw-result-label">DU HAST GEWONNEN!</span>
                  </div>
                )}
                {drawResult.winners.length > 0 ? (
                  <div className="draw-winners">
                    <span className="draw-winners-title">
                      <Trophy size={18} /> WINNERS
                    </span>
                    <div className="draw-winners-list">
                      {drawResult.winners.slice(0, 3).map((w, idx) => (
                        <div key={w.npub} className={`draw-winner-row${idx === 0 ? ' draw-winner-first' : ''}`}>
                          <span className="draw-winner-rank">#{idx + 1}</span>
                          <span className="draw-winner-name">{w.display_name || w.npub.slice(0, 8) + '...'}</span>
                          <span className="draw-winner-payout">
                            <Zap size={12} />
                            {fmtSats(w.payout_sats)}
                          </span>
                        </div>
                      ))}
                    </div>
                    <span className="draw-winners-pot">{fmtSats(drawResult.pot_sats)} sats pot</span>
                  </div>
                ) : (
                  <div className="draw-result-loss">
                    <span className="draw-result-label">KEINE TICKETS</span>
                    <span className="draw-result-info">Runde ohne Teilnehmer</span>
                  </div>
                )}
                <button className="draw-result-dismiss" onClick={() => setDrawResult(null)}>OK</button>
              </div>
            ) : (
              <>
                <div className="dash-hero-stats-col">
                  <div className="dash-hero-stats">
                    <div className="dash-hero-stat">
                      <span className="dash-hero-stat-val dash-neon-gold" style={{ display: 'flex', alignItems: 'center' }}><Zap size={16} className="dash-hero-zap" />{lotteryRound ? fmtSats(lotteryRound.pot_sats) : '0'}</span>
                      <span className="dash-hero-stat-lbl">POT SATS</span>
                    </div>
                    <div className="dash-hero-stat">
                      <span className="dash-hero-stat-val">{lotteryRound?.total_tickets || 0}</span>
                      <span className="dash-hero-stat-lbl">TICKETS</span>
                    </div>
                    <div className="dash-hero-stat">
                      <span className="dash-hero-stat-val">{lotteryRound?.unique_players || 0}</span>
                      <span className="dash-hero-stat-lbl">PLAYERS</span>
                    </div>
                  </div>
                  {auth.isLoggedIn && (
                    <div className="lottery-last-win">
                      {myLastWin ? (
                        <>
                          <span className="lottery-last-win-label">Last win:</span>
                          <Zap size={12} className="lottery-last-win-zap" />
                          <span className="lottery-last-win-amount">{fmtSats(myLastWin.amount_sats)} sats</span>
                          <span className="lottery-last-win-time">Round #{myLastWin.round_id}</span>
                        </>
                      ) : (
                        <span className="lottery-last-win-none">No luck yet</span>
                      )}
                    </div>
                  )}
                </div>
                <div className="dash-hero-action">
                  {auth.isLoggedIn ? (
                    <>
                      <div className="dash-hero-mytickets">
                        My Tickets: <Ticket size={15} /> {lotteryMyTickets}
                      </div>
                      <button className="dash-buy-btn" onClick={handleBuyTicket}
                        disabled={lotteryBuying || !lotteryNextCost || auth.joints < lotteryNextCost || !eligible}>
                        {lotteryBuying ? 'BUYING...' : 'BUY TICKET'}
                        {lotteryNextCost > 0 && <span className="dash-buy-cost">{fmtNum(lotteryNextCost)}</span>}
                      </button>
                      {!eligible && (
                        <div className="dash-buy-hint">
                          {managersNeeded} auto-manager{managersNeeded !== 1 ? 's' : ''} left to buy tickets!
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="dash-hero-login">Login to play</div>
                  )}
                </div>
              </>
            )}
          </div>
          <div className="dash-hero-scanline" />
        </div>

        {/* Plantagen */}
        <Card className={`plantations-card station-card !py-0 !gap-0${satsFlash ? ' sats-flash' : ''}${jointsFlash ? ' joints-flash' : ''}`}>
          <CardHeader className="!flex !flex-row !items-center !gap-2.5 !p-4 !pb-2">
            <Sprout size={32} className="title-darkgreen" />
            <CardTitle className="station-title title-darkgreen">Plantations</CardTitle>
          </CardHeader>

          <CardContent className="!p-4 !pt-0 flex flex-col gap-3">
            <div className="basement-top">
              <div className={`station-cycle${state.plantagen.some(p => p.managerLevel > 0 || p.timer < p.cycleTime) ? '' : ' cycle-complete'}`}>
                <ProgressCircle
                  progress={state.plantagen.length > 0 ? 1 - state.plantagen[0].timer / state.plantagen[0].cycleTime : 0}
                  size={100} stroke={4} color="#2e7d32" trackColor="rgba(46,125,50,.15)"
                />
                <span className={`station-cycle-label cannabis${!state.plantagen.some(p => p.managerLevel > 0 || p.timer < p.cycleTime) ? ' cycle-done' : ''}`}>
                  {fmtNum(state.cannabis)}
                </span>
              </div>
              <div className="flex flex-col gap-1.5 flex-1">
                <StatRow label="Stock" value={fmtNum(state.cannabis)} highlight="cannabis" />
                <StatRow label="Production" value={`${fmtNum(totalRate)}/s`} />
                <StatRow label="Active" value={`${state.plantagen.length} / ${PLANTATION_DEFS.length}`} />
              </div>
            </div>

            <div className="plantations-list">
              {state.plantagen.map((p, i) => {
                const cycle = plantEffectiveCycle(p)
                const output = plantOutput(p)
                const rate = plantRate(p)
                const lvCost = plantLevelCost(p)
                const milestone = plantMilestoneInfo(p.level)

                const progress = 1 - p.timer / p.cycleTime
                const isGrowing = p.managerLevel > 0 || p.timer < p.cycleTime

                return (
                  <div className="plant-item" key={`${i}-${p.level}`}>
                    <div className={`station-cycle station-cycle-sm${state.joints >= lvCost ? ' cycle-clickable' : ''}`}
                      onClick={() => {
                        if (state.joints >= lvCost) {
                          if (milestone.levelsToNext === 1) triggerMilestoneFlash(i, milestone.nextMult)
                          actions.upgradePlantLevel(i); triggerJointsFlash()
                        }
                      }}>
                      <ProgressCircle progress={progress} size={58} stroke={3} color="#2e7d32" trackColor="rgba(46,125,50,.15)" />
                      {milestoneFlash[i] ? (
                        <span className="milestone-flash">x{milestoneFlash[i]}</span>
                      ) : (
                        <span className={`station-cycle-label station-cycle-label-sm cannabis${!isGrowing ? ' cycle-done' : ''}`}>
                          {fmtNum(output)}
                        </span>
                      )}
                    </div>
                    <div className="plant-info">
                      <div className="plant-name-row">
                        <span className={`pw-name${isGrowing ? ' active' : ''}`}>{p.name}</span>
                      </div>
                      <div className="pw-sub">
                        {fmtNum(rate)}/s &middot; {cycle.toFixed(1)}s &middot; <span className="pw-milestone-inline">{milestone.nextMult}× boost · {milestone.levelsToNext} to go</span>
                      </div>
                    </div>
                    <div className="plant-actions">
                      <button className="upgrade-btn" disabled={state.joints < lvCost}
                        onClick={() => {
                          if (milestone.levelsToNext === 1) triggerMilestoneFlash(i, milestone.nextMult)
                          actions.upgradePlantLevel(i); triggerJointsFlash()
                        }}>
                        <span>Level {p.level + 1}</span>|<span className="cost">{fmtNum(lvCost)}</span>
                      </button>
                      {auth.isLoggedIn ? (
                        p.managerLevel === 0 ? (
                          <button className="upgrade-btn mgr-btn" disabled={state.sats < p.mgrCost}
                            onClick={() => { actions.buyPlantManager(i); triggerSatsFlash() }}>
                            <span>Auto Manager</span>|<span className="cost sats">{p.mgrCost} sats</span>
                          </button>
                        ) : p.speedLevel < MAX_SPEED_LEVEL ? (() => {
                          const next = getSpeedUpgrade(p.speedLevel)!
                          return (
                            <button className="upgrade-btn sats-upgrade" disabled={state.sats < next.cost}
                              onClick={() => { actions.upgradePlantSpeed(i); triggerSatsFlash() }}>
                              <span>Speed {next.label}</span>|<span className="cost sats">{next.cost} sats</span>
                            </button>
                          )
                        })() : (
                          <button className="upgrade-btn mgr-btn" disabled={state.sats < p.mgrCost}
                            onClick={() => { actions.buyPlantManager(i); triggerSatsFlash() }}>
                            <span>Manager</span>
                            <span className="cost sats">{p.mgrCost} sats</span>
                          </button>
                        )
                      ) : (
                        <button className="upgrade-btn mgr-btn mgr-login" disabled>
                          <span>Auto Manager</span>|<span className="cost sats">Login</span>
                        </button>
                      )}
                      {p.managerLevel === 0 && (
                        <button
                          className={`action-btn plantage mini${isGrowing ? ' active' : ''}`}
                          onClick={() => actions.grow(i)}
                          disabled={isGrowing}
                        >
                          {isGrowing ? 'Growing...' : 'Grow'}
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}

              {PLANTATION_DEFS.slice(state.plantagen.length).map((def, i) => {
                const isNext = i === 0
                return (
                  <div className="plant-item plant-locked" key={def.id}>
                    <div className="plant-locked-icon">&#128274;</div>
                    <div className="plant-info">
                      <div className="plant-name-row">
                        <span className="pw-name locked">{def.name}</span>
                      </div>
                      <div className="pw-sub">{fmtNum(def.baseProd)} base &middot; {def.cycleTime}s cycle</div>
                    </div>
                    {isNext ? (
                      <button className="upgrade-btn" onClick={actions.unlockPlantation}
                        disabled={state.joints < def.unlockCost}>
                        <span>Unlock</span>|<span className="cost">{fmtNum(def.unlockCost)}</span>
                      </button>
                    ) : (
                      <span className="plant-locked-cost">{fmtNum(def.unlockCost)}</span>
                    )}
                  </div>
                )
              })}
            </div>

            {raceChartData && (
              <div className="production-race-section">
                <div className="production-race-title">
                  <Cannabis size={22} className="title-darkgreen" />
                  <span className="title-darkgreen">Growth Race</span>
                  <span className="race-time-label">24h</span>
                </div>
                <div className="race-chart-wrap">
                  <svg viewBox="0 0 400 220" preserveAspectRatio="xMidYMid meet" className="race-chart-svg">
                    <defs>
                      {raceChartData.lines.map((line, i) => (
                        <linearGradient key={i} id={`rcg${i}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={line.color} stopOpacity="0.15" />
                          <stop offset="100%" stopColor={line.color} stopOpacity="0.01" />
                        </linearGradient>
                      ))}
                    </defs>
                    {/* Y-axis label */}
                    <text x="6" y="10" fill="#2e7d32" fontSize="6" fontWeight="700" fontFamily="var(--font-heading)">growth ×</text>
                    {/* Grid lines */}
                    {[0.2, 0.4, 0.6, 0.8].map(y => (
                      <line key={y} x1="0" y1={y * 200} x2="400" y2={y * 200} stroke="var(--border-color)" strokeWidth="0.4" strokeDasharray="4 4" />
                    ))}
                    {/* Vertical time markers */}
                    {[0.25, 0.5, 0.75].map(x => (
                      <line key={x} x1={x * 400} y1="0" x2={x * 400} y2="200" stroke="var(--border-color)" strokeWidth="0.3" strokeDasharray="3 6" />
                    ))}
                    {/* Area fills + lines + endpoint dots */}
                    {raceChartData.lines.map((line, i) => {
                      const coords = line.points.map((v, h) => ({
                        x: (h / CHART_POINTS) * 400,
                        y: 200 - (v / raceChartData.maxVal) * 190
                      }))
                      // Smooth cubic bezier path
                      let linePath = `M${coords[0].x},${coords[0].y}`
                      for (let j = 1; j < coords.length; j++) {
                        const prev = coords[j - 1]
                        const cur = coords[j]
                        const cpx = (prev.x + cur.x) / 2
                        linePath += ` C${cpx},${prev.y} ${cpx},${cur.y} ${cur.x},${cur.y}`
                      }
                      const areaPath = `${linePath} L400,200 L0,200 Z`
                      const last = coords[coords.length - 1]
                      return (
                        <g key={i}>
                          <path d={areaPath} fill={`url(#rcg${i})`} />
                          <path d={linePath} fill="none" stroke={line.color} strokeWidth="1.5" opacity="0.8" />
                          <circle cx={last.x} cy={last.y} r="3" fill={line.color} opacity="0.8" />
                        </g>
                      )
                    })}
                  </svg>
                  {/* X-axis labels */}
                  <div className="race-chart-xaxis">
                    {[0, 0.25, 0.5, 0.75, 1].map((f, i) => {
                      const totalH = Math.round(raceChartData.maxHours * f)
                      const d = Math.floor(totalH / 24)
                      const h = totalH % 24
                      const label = d > 0 ? (h > 0 ? `${d}d ${h}h` : `${d}d`) : `${h}h`
                      return <span key={i}>{label}</span>
                    })}
                  </div>
                  {/* Legend */}
                  <div className="race-chart-legend">
                    {raceChartData.lines.map((line, i) => (
                      <span key={i} className="race-chart-legend-item">
                        <span className="race-chart-legend-dot" style={{ background: line.color }} />
                        {line.isYou ? line.name : (
                          <a href={`/u/${(() => { try { return nip19.npubEncode(line.npub); } catch { return line.npub; } })()}`} className="lb-name-link">
                            {line.name}
                          </a>
                        )} <span className="race-chart-legend-rate">{line.growth >= 10 ? Math.round(line.growth) : line.growth.toFixed(1)}×</span>
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}

          </CardContent>
        </Card>

        </div>{/* end right-column */}
      </div>
    </div>
    </>
  )
}
