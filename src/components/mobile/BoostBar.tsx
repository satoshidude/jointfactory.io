import { useEffect, useState } from 'react'
import { Zap, Timer } from 'lucide-react'
import { BOOSTS } from '../../../shared/economy.js'
import type { ActiveBoost } from '../../game/useGameLoop'
import './BoostBar.css'

const ORDER = ['fertilizer', 'express', 'doubleshift', 'fullthrottle'] as const

function fmtRemaining(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

/**
 * Timed boosts — the sink that keeps sats circulating.
 *
 * Every other sats sink in the game is one-off, so a player stopped spending
 * once they owned their managers and the lottery pot, fed by 80 % of spend,
 * went to zero. These are consumable, so the same sats come back around.
 */
export default function BoostBar({ boosts, sats, isLoggedIn, onBuy }: {
  boosts: ActiveBoost[]
  sats: number
  isLoggedIn: boolean
  onBuy: (type: string) => Promise<{ ok: boolean; error?: string }>
}) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Only tick while something is running — no timer on an idle page.
  const hasActive = boosts.some(b => b.expires_at > now)
  useEffect(() => {
    if (!hasActive) return
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000)
    return () => clearInterval(id)
  }, [hasActive])

  useEffect(() => {
    if (!error) return
    const id = setTimeout(() => setError(null), 3000)
    return () => clearTimeout(id)
  }, [error])

  const buy = async (type: string) => {
    if (busy) return
    setBusy(type)
    const res = await onBuy(type)
    if (!res.ok) setError(res.error ?? 'Purchase failed')
    setBusy(null)
  }

  return (
    <div className="boost-bar">
      <div className="boost-bar-header">
        <Zap size={18} className="boost-bar-icon" />
        <span className="boost-bar-title">Boosts</span>
        {error && <span className="boost-bar-error">{error}</span>}
      </div>

      <div className="boost-bar-grid">
        {ORDER.map(type => {
          const def = BOOSTS[type]
          const active = boosts.find(b => b.type === type && b.expires_at > now)
          const affordable = sats >= def.cost
          return (
            <button
              key={type}
              className={`boost-btn${active ? ' active' : ''}${!active && !affordable ? ' insufficient' : ''}`}
              onClick={() => buy(type)}
              disabled={!isLoggedIn || busy === type}
              title={isLoggedIn ? `${def.name} — ${def.short} for ${def.durationSec / 60} min` : 'Log in to buy boosts'}
            >
              <span className="boost-btn-name">{def.name}</span>
              <span className="boost-btn-effect">{def.short}</span>
              <span className="boost-btn-meta">
                {active
                  ? <><Timer size={11} /> {fmtRemaining(active.expires_at - now)}</>
                  : <><Zap size={11} /> {def.cost}</>}
              </span>
            </button>
          )
        })}
      </div>

      {!isLoggedIn && <div className="boost-bar-note">Log in to buy boosts</div>}
    </div>
  )
}
