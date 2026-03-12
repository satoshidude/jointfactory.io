import { useEffect, useState } from 'react'
import { Trophy, Zap, Cannabis, ChevronLeft, ChevronRight } from 'lucide-react'
import { nip19 } from 'nostr-tools'
import { apiFetch } from '../../lib/api'
import { useAuth } from '../../stores/authStore'
import './Leaderboard.css'

interface PlayerInfo {
  npub: string
  display_name: string
  joints_per_sec: number
  total_won_sats: number
  total_joints_earned: number
}

const COLORS = ['#ffd700', '#39ff14', '#cc44ff', '#00d4ff', '#ff6b6b', '#ff69b4', '#ff8c00']
const PER_PAGE = 11

function fmtSats(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return n.toLocaleString()
}

export default function Leaderboard() {
  const auth = useAuth()
  const [players, setPlayers] = useState<PlayerInfo[]>([])
  const [page, setPage] = useState(0)

  useEffect(() => {
    const fetch = () => {
      apiFetch('/players').then(data => {
        if (data?.players) {
          setPlayers((data.players as PlayerInfo[])
            .filter(p => p.total_joints_earned > 0)
            .sort((a, b) => b.total_won_sats - a.total_won_sats))
        }
      }).catch(() => {})
    }
    fetch()
    const iv = setInterval(fetch, 30000)
    return () => clearInterval(iv)
  }, [])

  if (players.length === 0) return null

  const maxRate = Math.max(...players.map(p => p.joints_per_sec), 1)
  const totalPages = Math.ceil(players.length / PER_PAGE)
  const pagePlayers = players.slice(page * PER_PAGE, (page + 1) * PER_PAGE)

  return (
    <div className="lb-card">
      <div className="lb-header">
        <Trophy size={20} className="lb-header-icon" />
        <span className="lb-title">Leaderboard</span>
        {totalPages > 1 && (
          <div className="lb-pager">
            <button className="lb-pager-btn" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
              <ChevronLeft size={14} />
            </button>
            <span className="lb-pager-info">{page + 1}/{totalPages}</span>
            <button className="lb-pager-btn" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
              <ChevronRight size={14} />
            </button>
          </div>
        )}
      </div>
      <div className="lb-head-row">
        <span className="lb-h-rank">#</span>
        <span className="lb-h-name">Name</span>
        <span className="lb-h-sats">Earnings</span>
        <span className="lb-h-total">Total</span>
      </div>
      <div className="lb-rows">
        {pagePlayers.map((p, i) => {
          const globalIdx = page * PER_PAGE + i
          const isYou = auth.npub === p.npub
          const barPct = p.joints_per_sec > 0 ? Math.min(100, (p.joints_per_sec / maxRate) * 100) : 0
          const barColor = isYou ? 'var(--neon-gold)' : COLORS[globalIdx % COLORS.length]
          return (
            <div key={p.npub} className={`lb-row${isYou ? ' lb-row-you' : ''}${globalIdx < 3 ? ` lb-row-top${globalIdx + 1}` : ''}`}>
              <div className="lb-bar" style={{ width: `${barPct}%`, background: barColor }} />
              <span className="lb-rank">
                {globalIdx < 3 ? <Trophy size={12} className={`lb-trophy-${globalIdx + 1}`} /> : `#${globalIdx + 1}`}
              </span>
              <a className="lb-name" href={`/u/${(() => { try { return nip19.npubEncode(p.npub) } catch { return p.npub } })()}`}>{isYou ? 'YOU' : (p.display_name || 'anon')}</a>
              <span className="lb-sats"><Zap size={11} /> {fmtSats(p.total_won_sats)}</span>
              <span className="lb-total"><Cannabis size={11} /> {fmtSats(p.total_joints_earned)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
