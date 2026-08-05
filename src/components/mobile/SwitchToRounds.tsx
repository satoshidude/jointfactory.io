import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Trophy, Star, Cannabis, Zap, RotateCcw, Wallet, Info } from 'lucide-react'
import type { SwitchOffer } from '../../hooks/useRoundSwitch'
import { fmtNum } from '../../lib/format'
import './SwitchToRounds.css'

/**
 * The one thing an account from before rounds sees until its owner decides.
 *
 * It states the trade plainly in both directions: what is credited, and what is
 * cleared. There is no deadline and no way around it other than confirming —
 * except the wallet, which stays open because sats are real money and nobody
 * should have to agree to anything to take their own money out.
 */
export default function SwitchToRounds({ offer, busy, error, onConfirm }: {
  offer: SwitchOffer
  busy: boolean
  error: string | null
  onConfirm: () => void
}) {
  const [confirming, setConfirming] = useState(false)

  return (
    <div className="switch-page">
      <div className="switch-card">
        <div className="switch-header">
          <Trophy size={24} className="switch-icon" />
          <h1 className="switch-title">Joint Factory now runs in rounds</h1>
        </div>

        <p className="switch-lead">
          A round ends at <strong>{fmtNum(offer.target)}</strong> joints — about a week
          with managers and a few visits a day. Counting stops there; then you start
          over for a star.
          The whole curve was rebuilt around it, so the numbers on your account are
          from a game that no longer exists.
        </p>

        <div className="switch-cols">
          <div className="switch-col switch-get">
            <h2>You are credited</h2>
            <ul>
              {/* Credited in proportion to what the account earned, never more
                  than max_rounds — so an old figure cannot out-rank rounds
                  actually played from here on. */}
              <li>
                <Trophy size={14} />
                {offer.rounds_credited === 0
                  ? 'no finished rounds — you never banked a full one'
                  : `${offer.rounds_credited} round${offer.rounds_credited === 1 ? '' : 's'} finished`}
              </li>
              <li><Star size={14} className="switch-star" /> {offer.points_credited} prestige</li>
              <li>
                Managers at <strong>{offer.manager_price_after} sats</strong> instead
                of {offer.manager_price_before} — for good
              </li>
              <li>Outdoor, Indoor and Hydroponic managers <strong>free</strong>, every round</li>
              <li><Zap size={14} className="switch-sats" /> your {offer.sats} sats, untouched</li>
            </ul>
          </div>

          <div className="switch-col switch-lose">
            <h2>Starts over</h2>
            <ul>
              <li><Cannabis size={14} /> {fmtNum(offer.joints)} joints</li>
              <li>your production chain</li>
              <li>bought speed{offer.speed_level > 0 ? ` (level ${offer.speed_level})` : ''}</li>
            </ul>
            <p className="switch-note">
              Your {fmtNum(offer.lifetime_joints)} lifetime joints stay on your profile.
            </p>
          </div>
        </div>

        {confirming ? (
          <div className="switch-confirm">
            <p>This cannot be undone. Ready?</p>
            <div className="switch-actions">
              <button className="switch-btn switch-btn-go" onClick={onConfirm} disabled={busy}>
                {busy ? 'Switching…' : 'Yes, switch to rounds'}
              </button>
              <button className="switch-btn" onClick={() => setConfirming(false)} disabled={busy}>
                Not yet
              </button>
            </div>
          </div>
        ) : (
          <button className="switch-btn switch-btn-main" onClick={() => setConfirming(true)}>
            <RotateCcw size={16} /> Switch to rounds
          </button>
        )}

        {error && <div className="switch-error">{error}</div>}

        <div className="switch-links">
          <Link to="/wallet"><Wallet size={14} /> Wallet — withdraw your sats</Link>
          <Link to="/info"><Info size={14} /> What changed</Link>
        </div>

        <p className="switch-wait">
          No hurry. Nothing on your account changes until you confirm.
        </p>
      </div>
    </div>
  )
}
