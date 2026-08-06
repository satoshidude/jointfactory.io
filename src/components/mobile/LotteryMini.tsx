import { useEffect, useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Zap, Ticket, TicketPlus, Users, Timer, Cannabis } from 'lucide-react'
import { apiFetch, wsUrl } from '../../lib/api'
import { liveTicketPrice } from '../../lib/ticketPrice'
import { useAuth } from '../../stores/authStore'
import { useGameDisplay } from '../../stores/gameDisplayStore'
import './LotteryMini.css'
import { fmtNum as fmtSats, fmtCountdown, fmtDrawTime } from '../../lib/format'
import { potPayout, MAX_TICKETS_PER_ROUND } from '../../../shared/economy.js'

interface MiniRound {
  id: number
  draws_at: number
  pot_sats: number
  total_tickets: number
  unique_players: number
}

interface Odds {
  my_tickets: number
  total_tickets: number
  chance_first: number
  winners: number
  shares: number[]
  prizes: number[]
  everyone_paid: boolean
  needs_second_player: boolean
}

export default function LotteryMini() {
  const navigate = useNavigate()
  const auth = useAuth()
  const gd = useGameDisplay()
  const [round, setRound] = useState<MiniRound | null>(null)
  const [myTickets, setMyTickets] = useState(0)
  const [ticketsHeld, setTicketsHeld] = useState(0)
  // What the tickets are worth to this player: chance of being drawn, how many
  // ranks pay tonight, and whether the round can be drawn at all.
  const [odds, setOdds] = useState<Odds | null>(null)
  const [nextCost, setNextCost] = useState(0)
  const [buying, setBuying] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const [lastResult, setLastResult] = useState<{ winner: string | null; payout: number } | null>(null)
  const [buyError, setBuyError] = useState<string | null>(null)
  const drawAtRef = useRef(0)
  const prevCountdownRef = useRef(0)

  const fetchCurrent = useCallback(() => {
    apiFetch('/lottery/current').then(res => {
      if (res.round) {
        setRound(res.round as MiniRound)
        setMyTickets(res.my_tickets ?? 0)
        setNextCost(res.next_ticket_cost ?? 0)
        setTicketsHeld(res.tickets_this_round ?? 0)
        setOdds(res.odds ?? null)
        drawAtRef.current = res.round.draws_at
        setCountdown(Math.max(0, res.round.draws_at - Math.floor(Date.now() / 1000)))
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
          const payout = payouts[firstWinner] || potPayout(last.total_sats_collected)
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
    const ws = new WebSocket(wsUrl())
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

  useEffect(() => {
    if (!buyError) return
    const id = setTimeout(() => setBuyError(null), 4000)
    return () => clearTimeout(id)
  }, [buyError])

  const handleBuy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!auth.isLoggedIn || buying) return
    setBuying(true)
    setBuyError(null)
    try {
      const res = await apiFetch('/lottery/buy', { method: 'POST' })
      // A refusal used to vanish here: no else, no catch. The player saw a click
      // that did nothing and a ticket count that stayed at zero, which reads as a
      // broken purchase rather than a declined one.
      if (!res.ok) setBuyError(res.error || res.reason || 'Purchase failed')
      if (res.ok) {
        setMyTickets(res.my_tickets || 0)
        setNextCost(res.next_ticket_cost || 0)
        setTicketsHeld(res.tickets_this_round || 0)
        // Adopt the server's balance; the game loop picks it up from the store.
        // The revision travels with it so the next autosave is not treated as
        // stale — see joints_rev in server/game.js.
        if (typeof res.joints === 'number') auth.setJoints(res.joints, res.joints_rev)
        fetchCurrent()
      }
    } catch {
      setBuyError('Network error')
    } finally {
      setBuying(false)
    }
  }

  // Four tickets per rolling day, so a hoarded balance cannot empty a round.
  const roundLimitReached = ticketsHeld >= MAX_TICKETS_PER_ROUND
  // Priced off the running chain, not off the figure the last fetch brought —
  // see lib/ticketPrice.ts. The server still owns the actual charge.
  const cost = liveTicketPrice(gd.rawGameState, ticketsHeld, nextCost)
  // What is still missing for the next ticket, 0 when it is affordable.
  const short = Math.max(0, Math.ceil(cost - auth.joints))
  const canBuy = auth.isLoggedIn && auth.joints >= cost && cost > 0
    && !buying && gd.eligible && !roundLimitReached

  if (!round) return null

  const drawTime = fmtDrawTime(drawAtRef.current)

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
        <span className="lottery-mini-stat"><span className="lottery-mini-stat-label">Pot</span> <Zap size={14} /> {fmtSats(round.pot_sats)}</span>
        <span className="lottery-mini-stat" title="Tickets in this round"><Ticket size={14} /> {round.total_tickets}</span>
        <span className="lottery-mini-stat" title="Players in this round"><Users size={14} /> {round.unique_players}</span>
        {auth.isLoggedIn && (
          <span className="lottery-mini-stat lottery-mini-my" title="Your tickets in this round">
            <span className="lottery-mini-stat-label">Yours</span> <Ticket size={14} /> {myTickets}
          </span>
        )}
      </div>
      {auth.isLoggedIn && odds && (
        <div className="lottery-mini-odds">
          {odds.needs_second_player
            ? <>Waiting for a second player — the pot carries over</>
            : odds.my_tickets > 0
              ? <>First place <strong>{Math.round(odds.chance_first * 100)} %</strong> · {odds.winners === 1
                  ? 'winner takes the pot'
                  : `${odds.winners} winners: ${odds.prizes.map(n => fmtSats(n)).join(' · ')}`}</>
              : <>{odds.winners === 1
                  ? 'One winner takes the pot'
                  : `${odds.winners} winners tonight: ${odds.prizes.map(n => fmtSats(n)).join(' · ')}`}</>}
        </div>
      )}
      {lastResult && (
        <div className="lottery-mini-last">
          {lastResult.winner ? (
            <><span className="lottery-mini-last-label">Last win</span> <Zap size={12} /> {fmtSats(lastResult.payout)}</>
          ) : (
            <><span className="lottery-mini-last-label">No entries — that pot went to the house</span></>
          )}
        </div>
      )}
      {auth.isLoggedIn && (
        <div className="lottery-mini-buy">
          <button className="lottery-mini-buy-btn" onClick={handleBuy} disabled={!canBuy}>
            {buying ? 'Buying...' : roundLimitReached ? <>
              <Ticket size={14} /> {MAX_TICKETS_PER_ROUND}/{MAX_TICKETS_PER_ROUND} this draw
            </> : short > 0 ? <>
              <Cannabis size={12} /> {fmtSats(short)} more for a ticket
            </> : <>
              <TicketPlus size={14} /> Ticket — <Cannabis size={12} /> {fmtSats(cost)}
              <span className="lottery-mini-pipe">|</span>
              <span className="lottery-mini-avail">{ticketsHeld}/{MAX_TICKETS_PER_ROUND} this draw</span>
            </>}
          </button>
          {/* Disabled with no reason given used to read as broken. The gate has
              two conditions now, so it has to say which one is open. */}
          {!gd.eligible && gd.ticketHint && (
            <span className="lottery-mini-hint">{gd.ticketHint}</span>
          )}
          {buyError && <span className="lottery-mini-error">{buyError}</span>}
        </div>
      )}
    </div>
  )
}
