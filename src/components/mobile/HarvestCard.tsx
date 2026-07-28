import { useState } from 'react'
import { Sprout, TrendingUp } from 'lucide-react'
import { prestigeMultiplier, PRESTIGE } from '../../../shared/economy.js'
import { fmtNum } from '../../lib/format'
import './HarvestCard.css'

/**
 * Harvest — the way past the upgrade wall.
 *
 * Plantation costs outgrow plantation output, so a run eventually stalls: the
 * top live account needs 18 days of idling for one more level. A harvest trades
 * that stalled run for seeds, a permanent chain-wide multiplier.
 *
 * The card is deliberately explicit about what survives. Players will not press
 * a reset button they do not trust, and everything they paid sats for does
 * survive — speed levels, managers, the wallet.
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

  // Nothing to show before the first harvest is even in reach.
  if (!isLoggedIn || (seeds === 0 && gain === 0 && lifetime < PRESTIGE.minLifetime / 100)) return null

  const run = async () => {
    setBusy(true)
    const res = await onHarvest()
    setMessage(res.ok ? `Harvested +${res.gained} seeds` : res.error ?? 'Harvest failed')
    setBusy(false)
    setConfirming(false)
    setTimeout(() => setMessage(null), 4000)
  }

  return (
    <div className="harvest-card">
      <div className="harvest-header">
        <Sprout size={18} className="harvest-icon" />
        <span className="harvest-title">Harvest</span>
        <span className="harvest-mult">×{prestigeMultiplier(seeds).toFixed(2)}</span>
      </div>

      <div className="harvest-stats">
        <div className="harvest-stat">
          <span className="harvest-stat-label">Seeds</span>
          <span className="harvest-stat-value">{fmtNum(seeds)}</span>
        </div>
        <div className="harvest-stat">
          <span className="harvest-stat-label">Ready</span>
          <span className={`harvest-stat-value${gain > 0 ? ' ready' : ''}`}>+{fmtNum(gain)}</span>
        </div>
      </div>

      {gain > 0 ? (
        confirming ? (
          <div className="harvest-confirm">
            <p className="harvest-warn">
              Resets plantation levels, capacities and unlocks, and your joints.
              Keeps everything sats paid for — speed levels, managers, your wallet.
            </p>
            <div className="harvest-confirm-row">
              <button className="harvest-btn harvest-btn-go" onClick={run} disabled={busy}>
                {busy ? 'Harvesting…' : `Harvest +${gain}`}
              </button>
              <button className="harvest-btn" onClick={() => setConfirming(false)} disabled={busy}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button className="harvest-btn harvest-btn-go" onClick={() => setConfirming(true)}>
            <TrendingUp size={14} /> Harvest +{gain} seeds → ×{prestigeMultiplier(seeds + gain).toFixed(2)}
          </button>
        )
      ) : (
        <div className="harvest-next">
          Next seed at {fmtNum(nextAt)} lifetime joints
          <span className="harvest-progress-track">
            <span
              className="harvest-progress-bar"
              style={{ width: `${Math.min(100, nextAt > 0 ? (lifetime / nextAt) * 100 : 0)}%` }}
            />
          </span>
        </div>
      )}

      {message && <div className="harvest-message">{message}</div>}
    </div>
  )
}
