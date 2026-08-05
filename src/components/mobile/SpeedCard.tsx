import { useState } from 'react'
import { Gauge, Cannabis } from 'lucide-react'
import { SPEED_STEP } from '../../../shared/economy.js'
import { fmtNum } from '../../lib/format'
import './SpeedCard.css'

/**
 * Speed for the rest of the round, paid in joints.
 *
 * One line to explain: joints buy speed, speed lifts the whole chain. It goes
 * with the reset like everything else the round built.
 *
 * The price is a share of the buyer's own production, so it is quoted by the
 * server rather than computed here — the client's idea of the rate lags behind
 * whatever it last saved.
 */
export default function SpeedCard({ level, multiplier, nextMultiplier, nextCost, joints, isLoggedIn, onBuy }: {
  level: number
  multiplier: number
  nextMultiplier: number
  nextCost: number
  joints: number
  isLoggedIn: boolean
  onBuy: () => Promise<{ ok: boolean; error?: string }>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const buy = async () => {
    if (busy) return
    setBusy(true)
    const res = await onBuy()
    if (!res.ok) {
      setError(res.error ?? 'Purchase failed')
      setTimeout(() => setError(null), 3000)
    }
    setBusy(false)
  }

  const affordable = joints >= nextCost
  const stepPct = Math.round(SPEED_STEP * 100)

  return (
    <div className="speed-card">
      <div className="speed-header">
        <Gauge size={18} className="speed-icon" />
        <span className="speed-title">Speed</span>
        <span className="speed-mult">×{multiplier.toFixed(2)}</span>
      </div>

      <p className="speed-lead">
        Spend joints to run the whole chain <strong>+{stepPct} %</strong> faster —
        plantations, courier and factory. It lasts to the end of the round.
      </p>

      {isLoggedIn ? (
        <>
          <button
            className={`speed-btn${affordable ? ' ready' : ''}`}
            onClick={buy}
            disabled={busy || !affordable}
          >
            {busy ? 'Buying…' : <>
              +{stepPct} % → ×{nextMultiplier.toFixed(2)}
              <span className="speed-btn-cost"><Cannabis size={12} /> {fmtNum(nextCost)}</span>
            </>}
          </button>
          <div className="speed-foot">
            {affordable
              ? `Level ${level} · the same joints also buy lottery tickets`
              : `Level ${level} · ${fmtNum(nextCost - Math.floor(joints))} more joints needed`}
          </div>
        </>
      ) : (
        <div className="speed-foot">Log in to buy speed</div>
      )}

      {error && <div className="speed-error">{error}</div>}
    </div>
  )
}
