import { useEffect, useState, useMemo } from 'react'
import { Cannabis, TrendingUp, TrendingDown, Minus, Trophy, Zap, Flag, Star } from 'lucide-react'
import { Link } from 'react-router-dom'
import { nip19 } from 'nostr-tools'
import { apiFetch } from '../../lib/api'
import { useAuth } from '../../stores/authStore'
import './GrowthRace.css'
import { fmtNum } from '../../lib/format'
import { speedMultiplier, ROUND_TARGET } from '../../../shared/economy.js'

interface PlayerInfo {
  npub: string
  display_name: string
  joints_per_sec: number
  total_joints_earned: number
  total_won_sats: number
  speed_level?: number
  /** Start of the round this player is in — everyone has their own clock. */
  round_started_at?: number | null
  round_no?: number | null
  /** Set once they hit the target; the round time is then final. */
  round_seconds_to_target?: number | null
  prestige_points?: number
}

interface RateLog {
  npub: string
  ts: number
  rate: number
  total: number
  /** Strongest boost multiplier in effect when this row was written. */
  boost?: number
}

const LANE_COLORS = [
  { stroke: '#ffd700', glow: 'rgba(255,215,0,.65)' },
  { stroke: '#39ff14', glow: 'rgba(57,255,20,.65)' },
  { stroke: '#cc44ff', glow: 'rgba(204,68,255,.65)' },
  { stroke: '#00d4ff', glow: 'rgba(0,212,255,.65)' },
  { stroke: '#ff6b6b', glow: 'rgba(255,107,107,.65)' },
  { stroke: '#ff69b4', glow: 'rgba(255,105,180,.65)' },
  { stroke: '#ff8c00', glow: 'rgba(255,140,0,.65)' },
]

/** How far back the trend arrow looks. */
const TREND_WINDOW = 90 * 60

/**
 * Decades of the round mapped onto a lane.
 *
 * Progress inside one round spans fifteen orders of magnitude, so a linear lane
 * would park the whole field on the start line and show nothing. Six decades
 * give a tenth of a percent a real place on the track.
 */
const LANE_DECADES = 6

/** Unknown or unreachable finishes go last, never in the middle. */
const rank = (secs: number) => Number.isFinite(secs) ? secs : Infinity

/** "3.2 d", "4 h", "12 min" — a span, in the largest unit that still reads. */
function dur(secs: number): string {
  if (!Number.isFinite(secs)) return '—'
  if (secs < 60) return '<1 min'
  if (secs < 3600) return `${Math.round(secs / 60)} min`
  if (secs < 86400) return `${(secs / 3600).toFixed(1)} h`
  if (secs < 365 * 86400) return `${(secs / 86400).toFixed(1)} d`
  return `${(secs / (365 * 86400)).toFixed(0)} y`
}

/**
 * The race, as a race: runners on lanes, all pointed at the same finish.
 *
 * It was a chart of production over time, which answered a question nobody was
 * asking — what a player wants at a glance is *am I ahead*, and a picture full
 * of curves cannot say that.
 *
 * Position on the lane is how far into the round they are. But nobody starts at
 * the same moment, so being furthest only means having started earliest: the
 * rank and the big number are the *projected round time* — time already run
 * plus what is left at the current rate. That is the same figure the Q Club
 * records, so the live race and the highscore measure one thing.
 */
export default function GrowthRace({ header }: { header?: React.ReactNode } = {}) {
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
    const iv = setInterval(fetchPlayers, 15000)
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
    const iv = setInterval(fetchLogs, 30_000)
    return () => { cancelled = true; clearInterval(iv) }
  }, [])

  const lines = useMemo(() => {
    const now = Math.floor(Date.now() / 1000)
    const windowStart = now - TREND_WINDOW
    const recent = new Set(rateLogs.filter(l => l.ts >= windowStart && l.rate > 0).map(l => l.npub))

    let candidates = players
      .filter(p => (p.total_joints_earned || 0) > 0 || p.joints_per_sec > 0)
      .sort((a, b) => (b.total_joints_earned || 0) - (a.total_joints_earned || 0))
      .slice(0, 10)

    const me = auth.npub ? players.find(p => p.npub === auth.npub) : null
    if (me && !candidates.find(c => c.npub === auth.npub)) candidates = [...candidates.slice(0, 9), me]
    if (candidates.length === 0) return []

    return candidates.map((p, i) => {
      const c = LANE_COLORS[i % LANE_COLORS.length]
      const total = p.total_joints_earned || 0
      const rate = p.joints_per_sec || 0
      const eta = rate > 0 ? Math.max(0, ROUND_TARGET - total) / rate : Infinity

      const mine = rateLogs.filter(l => l.npub === p.npub).sort((a, b) => a.ts - b.ts)
      // Where they stood when the window opened, so the arrow can say whether
      // the finish came closer.
      const then = mine.filter(l => l.ts <= windowStart).at(-1) ?? mine[0]
      const etaThen = then && then.rate > 0 ? Math.max(0, ROUND_TARGET - then.total) / then.rate : Infinity
      const trendPct = Number.isFinite(etaThen) && etaThen > 0 && Number.isFinite(eta)
        ? ((etaThen - eta) / etaThen) * 100
        : 0

      // Their own clock. A round that has already been won stops running — its
      // time is what the club will record, not what has passed since.
      const started = p.round_started_at || 0
      const elapsed = started > 0 ? Math.max(0, now - started) : NaN
      const projected = p.round_seconds_to_target != null
        ? p.round_seconds_to_target
        : Number.isFinite(elapsed) ? elapsed + eta : NaN

      const progress = Math.min(1, total / ROUND_TARGET)
      const pos = progress >= 1 ? 100
        : progress <= 0 ? 0
        : Math.max(0, Math.min(100, ((Math.log10(progress) + LANE_DECADES) / LANE_DECADES) * 100))

      return {
        npub: p.npub,
        name: auth.npub === p.npub ? 'YOU' : (p.display_name || 'anon'),
        isYou: auth.npub === p.npub,
        // A finished round has nothing left to log, so the recency test would
        // grey out the very runner whose time everyone else is chasing.
        isActive: recent.has(p.npub) || p.round_seconds_to_target != null,
        boostedNow: (mine.at(-1)?.boost ?? 1) > 1,
        speedLevel: p.speed_level ?? 0,
        rate, total, progress, pos, eta, trendPct, elapsed, projected,
        done: p.round_seconds_to_target != null,
        color: c.stroke, glow: c.glow,
      }
    }).sort((a, b) => rank(a.projected) - rank(b.projected))
  }, [players, auth.npub, rateLogs])

  if (lines.length === 0) return null

  return (
    <div className="gr-card">
      {/* The round, when the page has one to show. Same finish line as the lanes
          below, so it belongs in the same frame. Empty collapses itself. */}
      {header && <div className="gr-round">{header}</div>}

      <div className="gr-header">
        <Cannabis size={20} className="gr-header-icon" />
        <span className="gr-title">Race to 1 Q</span>
        <span className="gr-legend">ranked by round time, not by who started first</span>
        {/* Rounds finished, next to the race they were run in. The player list is
            already loaded, so this costs nothing but a lookup. */}
        {auth.npub && (
          <Link to="/ranking" className="gr-stars" title="Rounds finished — see the boards">
            <Star size={11} /> {players.find(p => p.npub === auth.npub)?.prestige_points ?? 0}
          </Link>
        )}
        <span className="gr-live">LIVE</span>
      </div>

      <div className="gr-lanes">
        {/* The finish, named once above the stack. Ten identical labels would be
            noise; the gold edge on each lane is enough to mark where it falls. */}
        <div className="gr-finish-flag"><Flag size={11} /> 1 Q</div>

        {lines.map((line, i) => {
          const isFirst = i === 0
          return (
            <div key={line.npub}
                 className={`gr-row${line.isYou ? ' gr-you' : ''}${isFirst ? ' gr-leader' : ''}${!line.isActive ? ' gr-inactive' : ''}`}>
              <div className="gr-rank">
                {isFirst ? <Trophy size={13} className="gr-trophy" /> : `#${i + 1}`}
              </div>

              <a className="gr-name"
                 href={`/u/${(() => { try { return nip19.npubEncode(line.npub) } catch { return line.npub } })()}`}>
                {line.name}
              </a>

              <div className="gr-track"
                   title={`${(line.progress * 100).toFixed(line.progress < 0.01 ? 3 : 1)} % of the round · ${fmtNum(line.rate)}/s · speed x${speedMultiplier(line.speedLevel).toFixed(2)}`
                          + (Number.isFinite(line.elapsed) ? ` · running for ${dur(line.elapsed)}` : '')
                          + (Number.isFinite(line.eta) ? ` · ${dur(line.eta)} left` : '')}>
                {/* Ground covered, drawn as a tail that fades out behind the
                    runner rather than a bar that competes with it. */}
                <div className="gr-comet" style={{
                  width: `${line.pos}%`,
                  background: `linear-gradient(90deg, ${line.color}00 0%, ${line.color}44 45%, ${line.color}dd 100%)`,
                }} />
                <div className="gr-runner" style={{
                  left: `${line.pos}%`,
                  background: line.color,
                  boxShadow: `0 0 9px 1px ${line.glow}`,
                }}>
                  {line.boostedNow && <Zap size={9} className="gr-runner-boost" />}
                </div>
              </div>

              {/* The round time they are heading for, and underneath how much of
                  it they have already spent — the pair is what makes two runners
                  who started days apart comparable at all. */}
              <div className="gr-stats">
                <div className="gr-stats-main">
                  <span className="gr-eta" style={{ color: line.color }}>{dur(line.projected)}</span>
                  {/* Up means the finish came closer over the last ninety minutes. */}
                  <span className={`gr-trend${line.trendPct > 1 ? ' up' : line.trendPct < -1 ? ' down' : ''}`}>
                    {line.trendPct > 1 ? <TrendingUp size={11} /> : line.trendPct < -1 ? <TrendingDown size={11} /> : <Minus size={11} />}
                  </span>
                </div>
                <span className="gr-elapsed">
                  {line.done ? 'finished' : Number.isFinite(line.elapsed) ? `${dur(line.elapsed)} in` : ''}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
