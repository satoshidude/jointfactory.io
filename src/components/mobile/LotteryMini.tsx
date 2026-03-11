import { useEffect, useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Zap, Ticket, Users, Timer } from 'lucide-react'
import { apiFetch } from '../../lib/api'
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
  const [round, setRound] = useState<MiniRound | null>(null)
  const [countdown, setCountdown] = useState(0)
  const drawAtRef = useRef(0)

  const fetchCurrent = useCallback(() => {
    apiFetch('/lottery/current').then(res => {
      if (res.round) {
        setRound(res.round as MiniRound)
        drawAtRef.current = res.round.draws_at
      }
    }).catch(() => {})
  }, [])

  useEffect(() => { fetchCurrent() }, [fetchCurrent])

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
        if (msg.type === 'lottery_result') fetchCurrent()
      } catch {}
    }
    return () => ws.close()
  }, [fetchCurrent])

  if (!round) return null

  return (
    <div className="lottery-mini" onClick={() => navigate('/lottery')}>
      <div className="lottery-mini-row1">
        <Zap size={16} className="lottery-mini-icon" />
        <span className="lottery-mini-title">Lightning Lottery</span>
        <span className="lottery-mini-countdown"><Timer size={12} /> {fmtCountdown(countdown)}</span>
      </div>
      <div className="lottery-mini-row2">
        <span className="lottery-mini-stat"><Zap size={12} /> {fmtSats(round.pot_sats)}</span>
        <span className="lottery-mini-stat"><Users size={12} /> {round.unique_players}</span>
        <span className="lottery-mini-stat"><Ticket size={12} /> {round.total_tickets}</span>
      </div>
    </div>
  )
}
