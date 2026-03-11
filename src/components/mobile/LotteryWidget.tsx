import { useEffect, useState, useRef, useCallback } from 'react'
import { Zap, Ticket, Users, Timer } from 'lucide-react'
import { apiFetch } from '../../lib/api'
import { useAuth } from '../../stores/authStore'
import { useGameDisplay } from '../../stores/gameDisplayStore'
import './LotteryWidget.css'

interface LotteryRound {
  id: number
  draws_at: number
  pot_sats: number
  total_tickets: number
  unique_players: number
  sat_per_ticket: number
}

function fmtSats(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + '\u2009M'
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

export default function LotteryWidget() {
  const auth = useAuth()
  const gd = useGameDisplay()
  const [round, setRound] = useState<LotteryRound | null>(null)
  const [myTickets, setMyTickets] = useState(0)
  const [nextCost, setNextCost] = useState(0)
  const [countdown, setCountdown] = useState(0)
  const [buying, setBuying] = useState(false)
  const [buyError, setBuyError] = useState<string | null>(null)
  const drawAtRef = useRef(0)

  const fetchCurrent = useCallback(() => {
    apiFetch('/lottery/current').then(res => {
      if (res.round) {
        setRound(res.round as LotteryRound)
        setMyTickets(res.my_tickets ?? 0)
        setNextCost(res.next_ticket_cost ?? 0)
        drawAtRef.current = res.round.draws_at
      }
    }).catch(() => {})
  }, [])

  useEffect(() => { fetchCurrent() }, [fetchCurrent])

  // Countdown timer
  useEffect(() => {
    const tick = () => {
      const now = Math.floor(Date.now() / 1000)
      setCountdown(Math.max(0, drawAtRef.current - now))
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  // WebSocket for real-time updates
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
        if (msg.type === 'lottery_result') fetchCurrent()
      } catch (_) {}
    }
    return () => ws.close()
  }, [fetchCurrent])

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
        fetchCurrent()
      }
    } catch {
      setBuyError('Purchase failed')
    } finally {
      setBuying(false)
    }
  }

  const canBuy = auth.isLoggedIn && auth.joints >= nextCost && nextCost > 0 && !buying && gd.eligible

  if (!round) return null

  const drawTime = drawAtRef.current
    ? new Date(drawAtRef.current * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '--:--'

  return (
    <div className="lottery-widget">
      <div className="lottery-widget-header">
        <Zap size={24} className="lottery-widget-icon" />
        <span className="lottery-widget-title">Lightning Lottery</span>
        <span className="lottery-widget-round">#{round.id}</span>
      </div>

      <div className="lottery-widget-countdown">
        <Timer size={16} />
        <span className="lottery-widget-time">{drawTime}</span>
        <span className="lottery-widget-remaining">{fmtCountdown(countdown)}</span>
      </div>

      <div className="lottery-widget-stats">
        <div className="lottery-widget-stat">
          <Zap size={14} />
          <span>{fmtSats(round.pot_sats)} sats</span>
        </div>
        <div className="lottery-widget-stat">
          <Ticket size={14} />
          <span>{round.total_tickets}</span>
        </div>
        <div className="lottery-widget-stat">
          <Users size={14} />
          <span>{round.unique_players}</span>
        </div>
      </div>

      {auth.isLoggedIn && (
        <div className="lottery-widget-buy">
          {myTickets > 0 && (
            <span className="lottery-widget-my-tickets">
              Your tickets: {myTickets}
            </span>
          )}
          <button
            className="lottery-widget-buy-btn"
            onClick={handleBuy}
            disabled={!canBuy}
          >
            {buying ? 'Buying...' : `Buy Ticket — ${fmtSats(nextCost)} Joints`}
          </button>
          {!gd.eligible && (
            <span className="lottery-widget-hint">
              Hire {gd.upgradesNeeded} more manager{(gd.upgradesNeeded || 0) !== 1 ? 's' : ''} to unlock
            </span>
          )}
          {nextCost > auth.joints && gd.eligible && (
            <span className="lottery-widget-hint">
              Need {fmtSats(nextCost - Math.floor(auth.joints))} more Joints
            </span>
          )}
          {buyError && <span className="lottery-widget-error">{buyError}</span>}
        </div>
      )}

      {!auth.isLoggedIn && (
        <div className="lottery-widget-login-hint">Log in to buy tickets</div>
      )}
    </div>
  )
}
