import { Star, RotateCcw, X } from 'lucide-react'
import { fmtNum } from '../../lib/format'
import './RoundComplete.css'

/** Angles for one burst — twelve sparks, evenly around. */
const SPARKS = Array.from({ length: 12 }, (_, i) => i * 30)

/** Where the bursts go off, as percentages of the screen, and when. */
const BURSTS = [
  { left: 18, top: 22, delay: 0,    hue: 51 },   // gold
  { left: 78, top: 18, delay: 0.45, hue: 105 },  // green
  { left: 30, top: 70, delay: 0.9,  hue: 285 },  // purple
  { left: 72, top: 66, delay: 1.35, hue: 51 },
  { left: 50, top: 12, delay: 1.8,  hue: 105 },
]

/**
 * The round is finished — the one moment in the game worth interrupting for.
 *
 * Fullscreen on purpose: a quadrillion is where counting stops, so there is
 * nothing else to do on the page underneath. Everything here is CSS; no library
 * arrives just to draw sparks, and `prefers-reduced-motion` turns all of it off
 * without taking the button away.
 */
export default function RoundComplete({ round, points, seconds, busy, onReset, onDismiss }: {
  round: number
  points: number
  seconds: number | null
  busy: boolean
  onReset: () => void
  onDismiss: () => void
}) {
  const time = seconds == null ? null
    : seconds >= 86400 ? `${(seconds / 86400).toFixed(1)} days` : `${(seconds / 3600).toFixed(1)} hours`

  return (
    <div className="rc-overlay" role="dialog" aria-label="Round complete">
      <div className="rc-fireworks" aria-hidden="true">
        {BURSTS.map((b, i) => (
          <div key={i} className="rc-burst" style={{
            left: `${b.left}%`, top: `${b.top}%`,
            animationDelay: `${b.delay}s`,
            ['--hue' as string]: String(b.hue),
          }}>
            {SPARKS.map(a => (
              <span key={a} className="rc-spark" style={{ ['--angle' as string]: `${a}deg` }} />
            ))}
          </div>
        ))}
      </div>

      <button className="rc-close" onClick={onDismiss} aria-label="Close">
        <X size={20} />
      </button>

      <div className="rc-card">
        <div className="rc-star-wrap" aria-hidden="true">
          <Star className="rc-star" strokeWidth={1.5} />
        </div>

        <h1 className="rc-title">Round {round} complete</h1>
        <p className="rc-sub">
          {fmtNum(1e15)} joints rolled{time ? <> in <strong>{time}</strong></> : null}.
        </p>
        <p className="rc-note">
          Counting stops here. Start over to bank your star and run it again —
          your sats and your all-time joints stay.
        </p>

        <button className="rc-btn" onClick={onReset} disabled={busy}>
          {busy ? 'Starting…' : <><RotateCcw size={18} /> New round — <Star size={18} className="rc-btn-star" /> {points}</>}
        </button>

        <button className="rc-later" onClick={onDismiss} disabled={busy}>Not yet</button>
      </div>
    </div>
  )
}
