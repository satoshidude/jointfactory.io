import { useEffect, useState, useMemo } from 'react'
import { Cannabis, TrendingUp, TrendingDown, Minus, Trophy } from 'lucide-react'
import { nip19 } from 'nostr-tools'
import { apiFetch } from '../../lib/api'
import { useAuth } from '../../stores/authStore'
import './GrowthRace.css'

interface PlayerInfo {
  npub: string
  display_name: string
  joints_per_sec: number
  total_joints_earned: number
  total_won_sats: number
}

interface RateLog {
  npub: string
  ts: number
  rate: number
  total: number
}

const CHART_COLORS = [
  { stroke: '#ffd700', glow: 'rgba(255,215,0,.5)' },
  { stroke: '#39ff14', glow: 'rgba(57,255,20,.5)' },
  { stroke: '#cc44ff', glow: 'rgba(204,68,255,.5)' },
  { stroke: '#00d4ff', glow: 'rgba(0,212,255,.5)' },
  { stroke: '#ff6b6b', glow: 'rgba(255,107,107,.5)' },
  { stroke: '#ff69b4', glow: 'rgba(255,105,180,.5)' },
  { stroke: '#ff8c00', glow: 'rgba(255,140,0,.5)' },
]

const CHART_POINTS = 48

function fmtNum(n: number): string {
  if (n >= 1e12) return (n / 1e12).toFixed(1) + 'T'
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return Math.floor(n).toLocaleString()
}

export default function GrowthRace() {
  const auth = useAuth()
  const [players, setPlayers] = useState<PlayerInfo[]>([])
  const [rateLogs, setRateLogs] = useState<RateLog[]>([])

  useEffect(() => {
    const fetchPlayers = () => {
      apiFetch('/players').then(data => {
        if (data?.players) setPlayers(data.players as PlayerInfo[])
      }).catch(() => {})
    }
    fetchPlayers()
    const iv = setInterval(fetchPlayers, 30000)
    return () => clearInterval(iv)
  }, [])

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

  const raceData = useMemo(() => {
    const now = Math.floor(Date.now() / 1000)
    const CHART_WINDOW = 6 * 3600
    const windowStart = now - CHART_WINDOW

    const recentLogs = rateLogs.filter(l => l.ts >= windowStart && l.rate > 0)
    const activeNpubs = new Set(recentLogs.map(l => l.npub))

    let candidates = players
      .filter(p => p.joints_per_sec > 0)
      .sort((a, b) => b.joints_per_sec - a.joints_per_sec)
      .slice(0, 10)

    const me = auth.npub ? players.find(p => p.npub === auth.npub) : null
    if (me && me.joints_per_sec > 0 && !candidates.find(c => c.npub === auth.npub)) {
      candidates = [...candidates.slice(0, 9), me]
    }

    if (candidates.length === 0) return null

    const lines = candidates.map((p, i) => {
      const isYou = auth.npub === p.npub
      const isActive = activeNpubs.has(p.npub)
      const rate = p.joints_per_sec
      const c = CHART_COLORS[i % CHART_COLORS.length]

      const events = rateLogs
        .filter(l => l.npub === p.npub && l.ts >= windowStart - 3600)
        .sort((a, b) => a.ts - b.ts)

      // Find last known rate (from logs or player data)
      const allPlayerLogs = rateLogs
        .filter(l => l.npub === p.npub)
        .sort((a, b) => a.ts - b.ts)
      const lastKnownRate = allPlayerLogs.length > 0
        ? allPlayerLogs[allPlayerLogs.length - 1].rate
        : rate
      const stepDuration = CHART_WINDOW / CHART_POINTS

      let points: number[]
      let trendPct = 0

      if (events.length > 0) {
        // Has data in window: use real logs, then extrapolate after last event
        let baseTotal = 0
        for (const ev of events) {
          if (ev.ts <= windowStart) baseTotal = ev.total
          else break
        }
        if (baseTotal === 0) baseTotal = events[0].total

        const lastEvent = events[events.length - 1]
        const lastEventTs = lastEvent.ts
        const lastEventTotal = lastEvent.total
        const extrapolateRate = lastEvent.rate || lastKnownRate

        points = []
        for (let h = 0; h <= CHART_POINTS; h++) {
          const timeAt = windowStart + (h / CHART_POINTS) * CHART_WINDOW
          if (timeAt > now) { points.push(points.length > 0 ? points[points.length - 1] : 0); continue }

          if (timeAt <= lastEventTs) {
            // Within logged data: use actual totals
            let totalAtTime = baseTotal
            for (const ev of events) {
              if (ev.ts <= timeAt) totalAtTime = ev.total
              else break
            }
            points.push(Math.max(0, totalAtTime - baseTotal))
          } else {
            // After last event: extrapolate at last known rate (no speed upgrades)
            const elapsed = timeAt - lastEventTs
            const extrapolated = lastEventTotal + extrapolateRate * elapsed
            points.push(Math.max(0, extrapolated - baseTotal))
          }
        }

        const firstEvent = events.find(e => e.ts >= windowStart)
        const firstRate = firstEvent?.rate || rate
        trendPct = firstRate > 0 ? ((lastEvent.rate - firstRate) / firstRate) * 100 : 0
      } else {
        // Fully offline: emulate steady production at last known rate
        points = []
        for (let h = 0; h <= CHART_POINTS; h++) {
          points.push(lastKnownRate * stepDuration * h)
        }
      }

      return { name: isYou ? 'YOU' : (p.display_name || 'anon'), npub: p.npub, rate, color: c.stroke, glow: c.glow, isYou, isActive, trendPct, points }
    }).sort((a, b) => b.rate - a.rate)

    const maxProduction = Math.max(...lines.flatMap(l => l.points), 1)
    return { lines, maxProduction }
  }, [players, auth.npub, rateLogs])

  if (!raceData || raceData.lines.length === 0) return null

  const { lines, maxProduction } = raceData
  const topRate = lines[0]?.rate || 1

  return (
    <div className="gr-card">
      <div className="gr-header">
        <Cannabis size={20} className="gr-header-icon" />
        <span className="gr-title">Growth Race</span>
        <span className="gr-live">LIVE</span>
      </div>

      {/* Chart */}
      <div className="gr-chart-wrap">
        <svg viewBox="0 0 400 120" preserveAspectRatio="xMidYMid meet" className="gr-chart-svg">
          <defs>
            {lines.map((line, i) => (
              <linearGradient key={i} id={`grc${i}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={line.color} stopOpacity="0.2" />
                <stop offset="100%" stopColor={line.color} stopOpacity="0" />
              </linearGradient>
            ))}
            <filter id="gr-glow">
              <feGaussianBlur stdDeviation="2" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>
          {[0.25, 0.5, 0.75].map(y => (
            <line key={y} x1="0" y1={y * 110} x2="400" y2={y * 110} stroke="var(--border-color)" strokeWidth="0.3" strokeDasharray="3 6" />
          ))}
          {[...lines].reverse().map((line, ri) => {
            const i = lines.length - 1 - ri
            const coords = line.points.map((v, h) => ({
              x: (h / (line.points.length - 1)) * 400,
              y: 108 - (maxProduction > 0 ? (v / maxProduction) * 100 : 0)
            }))
            let linePath = `M${coords[0].x},${coords[0].y}`
            for (let j = 1; j < coords.length; j++) {
              const prev = coords[j - 1]
              const cur = coords[j]
              const cpx = (prev.x + cur.x) / 2
              linePath += ` C${cpx},${prev.y} ${cpx},${cur.y} ${cur.x},${cur.y}`
            }
            const areaPath = `${linePath} L400,110 L0,110 Z`
            const last = coords[coords.length - 1]
            return (
              <g key={line.npub} opacity={line.isActive ? 1 : 0.3}>
                <path d={areaPath} fill={`url(#grc${i})`} />
                <path d={linePath} fill="none" stroke={line.color} strokeWidth="1.5" filter="url(#gr-glow)" opacity="0.85" />
                <circle cx={last.x} cy={last.y} r="3" fill={line.color} filter="url(#gr-glow)" />
              </g>
            )
          })}
        </svg>
        <div className="gr-chart-xaxis">
          <span>-6h</span><span>-3h</span><span>now</span>
        </div>
      </div>

      {/* Racing bars */}
      <div className="gr-bars">
        {lines.map((line, i) => {
          const pct = Math.max(8, (line.rate / topRate) * 100)
          const isFirst = i === 0
          return (
            <div key={line.npub} className={`gr-row${line.isYou ? ' gr-you' : ''}${isFirst ? ' gr-leader' : ''}${!line.isActive ? ' gr-inactive' : ''}`}>
              <div className="gr-rank">
                {isFirst ? <Trophy size={12} className="gr-trophy" /> : `#${i + 1}`}
              </div>
              <a className="gr-name" href={`/u/${(() => { try { return nip19.npubEncode(line.npub) } catch { return line.npub } })()}`}>{line.name}</a>
              <div className="gr-track">
                <div className="gr-fill" style={{
                  width: `${pct}%`,
                  background: `linear-gradient(90deg, ${line.color}22, ${line.color}88)`,
                  boxShadow: `0 0 10px ${line.glow}`,
                  borderColor: line.color,
                }} />
              </div>
              <div className="gr-stats">
                <span className="gr-rate" style={{ color: line.color }}>{fmtNum(line.rate)}/s</span>
                <span className={`gr-trend${line.trendPct > 1 ? ' up' : line.trendPct < -1 ? ' down' : ''}`}>
                  {line.trendPct > 1 ? <TrendingUp size={10} /> : line.trendPct < -1 ? <TrendingDown size={10} /> : <Minus size={10} />}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
