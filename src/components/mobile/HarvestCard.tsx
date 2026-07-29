import { useState } from 'react'
import { Sprout, TrendingUp } from 'lucide-react'
import { prestigeMultiplier, PRESTIGE } from '../../../shared/economy.js'
import { fmtNum } from '../../lib/format'
import './HarvestCard.css'

/**
 * Harvest — the way past the upgrade wall.
 *
 * Plantation costs outgrow plantation output, so a run eventually stalls. A
 * harvest trades the stalled run for seeds: a permanent, chain-wide multiplier.
 *
 * The card says what a seed does and what a harvest costs in plain words. The
 * first version showed "Seeds 343 / Ready +0 / ×18.15" and nothing else, which
 * is meaningless to anyone who has not met the mechanic before — and players do
 * not press a reset button they do not understand.
 */
export default function HarvestCard({ seeds, gain, lifetime, nextAt, isLoggedIn, onHarvest }: {
  seeds: number
  gain: number
  lifetime: number
  nextAt: number
  isLoggedIn: boolean
  onHarvest: () => Promise<{ ok: boolean; gained?: number; error?: string }>
}) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  if (!isLoggedIn || (seeds === 0 && gain === 0 && lifetime < PRESTIGE.minLifetime / 100)) return null

  const run = async () => {
    setBusy(true)
    const res = await onHarvest()
    setMessage(res.ok ? `Harvested +${res.gained} seeds` : res.error ?? 'Harvest failed')
    setBusy(false)
    setConfirming(false)
    setTimeout(() => setMessage(null), 4000)
  }

  const progress = nextAt > 0 ? Math.min(100, (lifetime / nextAt) * 100) : 0

  return (
    <div className="harvest-card">
      <div className="harvest-header">
        <Sprout size={18} className="harvest-icon" />
        <span className="harvest-title">Harvest</span>
        <span className="harvest-mult">×{prestigeMultiplier(seeds).toFixed(2)}</span>
      </div>

      <p className="harvest-lead">
        A harvest resets your plantations and pays you <strong>seeds</strong>.
        Every seed adds +5 % to everything you produce — plantations, courier and
        factory alike — and it never goes away.
      </p>

      <div className="harvest-stats">
        <div className="harvest-stat">
          <span className="harvest-stat-label">Seeds owned</span>
          <span className="harvest-stat-value">{fmtNum(seeds)}</span>
          <span className="harvest-stat-note">
            {seeds > 0 ? `+5 % each → ×${prestigeMultiplier(seeds).toFixed(2)}` : 'no bonus yet'}
          </span>
        </div>
        <div className="harvest-stat">
          <span className="harvest-stat-label">Waiting for you</span>
          <span className={`harvest-stat-value${gain > 0 ? ' ready' : ''}`}>+{fmtNum(gain)}</span>
          <span className="harvest-stat-note">{gain > 0 ? 'ready to collect' : 'keep producing'}</span>
        </div>
      </div>

      {gain > 0 ? (
        confirming ? (
          <div className="harvest-confirm">
            <p className="harvest-warn">
              <strong>You lose:</strong> plantation levels, courier and factory capacity,
              the plantations you unlocked, and your joints.<br />
              <strong>You keep:</strong> your sats, your managers, and every seed —
              old and new.
            </p>
            <div className="harvest-confirm-row">
              <button className="harvest-btn harvest-btn-go" onClick={run} disabled={busy}>
                {busy ? 'Harvesting…' : 'Yes, harvest'}
              </button>
              <button className="harvest-btn" onClick={() => setConfirming(false)} disabled={busy}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            <button className="harvest-btn harvest-btn-go" onClick={() => setConfirming(true)}>
              <TrendingUp size={14} /> Harvest {gain} seeds
            </button>
            <p className="harvest-next">
              Production goes ×{prestigeMultiplier(seeds).toFixed(2)} → <strong>×{prestigeMultiplier(seeds + gain).toFixed(2)}</strong>,
              and your plantations start from scratch.
            </p>
          </>
        )
      ) : (
        <div className="harvest-next">
          <span>Your next seed lands at {fmtNum(nextAt)} lifetime joints — you are at {fmtNum(lifetime)}.</span>
          <span className="harvest-progress-track">
            <span className="harvest-progress-bar" style={{ width: `${progress}%` }} />
          </span>
        </div>
      )}

      {message && <div className="harvest-message">{message}</div>}
    </div>
  )
}
