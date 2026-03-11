import { useEffect, useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Zap, Ticket, TicketPlus, Users, Timer, Cannabis } from 'lucide-react'
import { apiFetch } from '../../lib/api'
import { useAuth } from '../../stores/authStore'
import { useGameDisplay } from '../../stores/gameDisplayStore'
import './LotteryMini.css'

interface MiniRound {
  id: number
  draws_at: number
  pot_sats: number
  total_tickets: number
  unique_players: number
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

export default function LotteryMini() {
  const navigate = useNavigate()
  const auth = useAuth()
  const gd = useGameDisplay()
  const [round, setRound] = useState<MiniRound | null>(null)
  const [myTickets, setMyTickets] = useState(0)
  const [nextCost, setNextCost] = useState(0)
  const [buying, setBuying] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const [lastResult, setLastResult] = useState<{ winner: string | null; payout: number } | null>(null)
  const drawAtRef = useRef(0)
  const prevCountdownRef = useRef(0)

  const fetchCurrent = useCallback(() => {
    apiFetch('/lottery/current').then(res => {
      if (res.round) {
        setRound(res.round as MiniRound)
        setMyTickets(res.my_tickets ?? 0)
        setNextCost(res.next_ticket_cost ?? 0)
        drawAtRef.current = res.round.draws_at
      }
    }).catch(() => {})
  }, [])

  const fetchLastResult = useCallback(() => {
    apiFetch('/lottery/history').then(res => {
      if (res.rounds && res.rounds.length > 0) {
        const last = res.rounds[0]
        if (last.winner_npub) {
          const names = last.winner_names || {}
          const payouts = last.winner_payouts || {}
          const firstWinner = last.winner_npub.split(',')[0]
          const name = names[firstWinner] || firstWinner.slice(0, 10) + '...'
          const payout = payouts[firstWinner] || Math.floor(last.total_sats_collected * 0.8)
          setLastResult({ winner: name, payout })
        } else {
          setLastResult({ winner: null, payout: 0 })
        }
      }
    }).catch(() => {})
  }, [])

  useEffect(() => { fetchCurrent(); fetchLastResult() }, [fetchCurrent, fetchLastResult])

  useEffect(() => {
    const tick = () => {
      const now = Math.floor(Date.now() / 1000)
      const remaining = Math.max(0, drawAtRef.current - now)
      if (prevCountdownRef.current > 0 && remaining === 0) {
        setTimeout(() => { fetchCurrent(); fetchLastResult() }, 3000)
      }
      prevCountdownRef.current = remaining
      setCountdown(remaining)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [fetchCurrent, fetchLastResult])

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
        if (msg.type === 'lottery_result') { fetchCurrent(); fetchLastResult() }
      } catch {}
    }
    return () => ws.close()
  }, [fetchCurrent, fetchLastResult])

  const handleBuy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!auth.isLoggedIn || buying) return
    setBuying(true)
    try {
      const res = await apiFetch('/lottery/buy', { method: 'POST' })
      if (res.ok) {
        setMyTickets(res.my_tickets || 0)
        setNextCost(res.next_ticket_cost || 0)
        fetchCurrent()
      }
    } catch {} finally {
      setBuying(false)
    }
  }

  const canBuy = auth.isLoggedIn && auth.joints >= nextCost && nextCost > 0 && !buying && gd.eligible

  if (!round) return null

  const drawTime = drawAtRef.current
    ? new Date(drawAtRef.current * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '--:--'

  return (
    <div className="lottery-mini" onClick={() => navigate('/lottery')}>
      <div className="lottery-mini-header">
        <Zap size={24} className="lottery-mini-icon" />
        <span className="lottery-mini-title">Lightning Lottery</span>
      </div>
      <div className="lottery-mini-time">
        <span className="lottery-mini-draw"><Timer size={18} /> {drawTime}</span>
        <span className="lottery-mini-countdown">{fmtCountdown(countdown)}</span>
      </div>
      <div className="lottery-mini-stats">
        <span className="lottery-mini-stat"><Zap size={14} /> {fmtSats(round.pot_sats)}</span>
        <span className="lottery-mini-stat"><Ticket size={14} /> {round.total_tickets}</span>
        <span className="lottery-mini-stat"><Users size={14} /> {round.unique_players}</span>
        {auth.isLoggedIn && myTickets > 0 && (
          <span className="lottery-mini-stat lottery-mini-my"><Ticket size={14} /> {myTickets}</span>
        )}
      </div>
      {lastResult && (
        <div className="lottery-mini-last">
          {lastResult.winner ? (
            <><span className="lottery-mini-last-label">Last win</span> <Zap size={12} /> {fmtSats(lastResult.payout)}</>
          ) : (
            <><span className="lottery-mini-last-label">No winner — pot rolls over!</span></>
          )}
        </div>
      )}
      {auth.isLoggedIn && (
        <div className="lottery-mini-buy">
          <button className="lottery-mini-buy-btn" onClick={handleBuy} disabled={!canBuy}>
            {buying ? 'Buying...' : <>
              <TicketPlus size={14} /> Ticket — <Cannabis size={12} /> {fmtSats(nextCost)}
              <span className="lottery-mini-pipe">|</span>
              <span className="lottery-mini-avail"><Cannabis size={12} /> {fmtSats(Math.floor(auth.joints))}</span>
            </>}
          </button>
        </div>
      )}
    </div>
  )
}
