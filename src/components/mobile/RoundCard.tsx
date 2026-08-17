import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Trophy, RotateCcw, Cannabis, Star } from 'lucide-react'
import { ROUND_TARGET } from '../../../shared/economy.js'
import RoundComplete from './RoundComplete'
import { apiFetch } from '../../lib/api'
import { fmtNum, roundProgressPct } from '../../lib/format'
import './RoundCard.css'

interface RoundInfo {
  round_no: number
  target: number
  reached_target_at: number | null
  seconds_to_target: number | null
  megafarm_at: number | null
  boost_sats: number
  club_rank: number | null
  club_size: number
  can_reset: boolean
  points_if_reset: number
  prestige_points: number
  rounds_completed: number
}

const days = (s: number) => s >= 86400 ? `${(s / 86400).toFixed(1)} d` : `${(s / 3600).toFixed(1)} h`

/**
 * The round: how far to a quadrillion, and the way to start over.
 *
 * The bar is drawn from the client's own lifetime counter so it moves with the
 * chain, but everything that decides anything — whether the target was reached,
 * when, and what a reset is worth — comes from the server. A client that could
 * declare itself finished could declare itself a record.
 */
export default function RoundCard({ totalEarned, isLoggedIn, onReset, onSaveNow, embedded = false }: {
  totalEarned: number
  isLoggedIn: boolean
  onReset?: () => void
  /** Force a save, so the server learns the target fell. */
  onSaveNow?: () => Promise<void>
  /** Drop the frame: the card is sitting inside another one. */
  embedded?: boolean
}) {
  const [info, setInfo] = useState<RoundInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Dismissed per round, so the celebration fires once when the target falls and
  // does not ambush the player on every reload afterwards. The card below keeps
  // the reset button either way.
  const [seen, setSeen] = useState<number | null>(() => {
    const v = Number(localStorage.getItem('jf_round_celebrated'))
    return Number.isFinite(v) && v > 0 ? v : null
  })

  const load = useCallback(async () => {
    if (!isLoggedIn) return
    const res = await apiFetch('/game/state')
    if (res?.round) setInfo(res.round)
  }, [isLoggedIn])

  useEffect(() => { load() }, [load])

  // The server decides when the target fell — and it only finds out from a save,
  // which is otherwise up to thirty seconds away. Push one, then ask. Asking
  // first is what made the fireworks wait for a refresh.
  const announced = useRef(false)
  useEffect(() => {
    if (!isLoggedIn || !info || info.reached_target_at) return
    if (totalEarned < ROUND_TARGET || announced.current) return
    announced.current = true
    ;(async () => { await onSaveNow?.(); await load() })()
  }, [totalEarned, info, isLoggedIn, load, onSaveNow])

  const reset = async () => {
    if (busy) return
    setBusy(true)
    const res = await apiFetch('/game/reset', { method: 'POST' })
    setBusy(false)
    setConfirming(false)
    if (res?.error) {
      setError(res.error === 'target_not_reached' ? 'Not there yet' : String(res.error))
      setTimeout(() => setError(null), 3000)
      return
    }
    await load()
    onReset?.()
  }

  // Nothing until the round is known. The fallbacks below are all plausible —
  // round 1, no stars, no progress — which is exactly the problem: a player on
  // round six saw their sixth round open as their first for a frame.
  if (!isLoggedIn || !info) return null

  const target = info?.target ?? ROUND_TARGET
  // Logarithmic, like the lanes below it — see roundProgressPct. The counter is
  // the round's *earned* total, not the balance: spending joints on the chain is
  // how a round is played, and a bar that fell back every time you bought
  // something would be measuring your wallet, not your progress.
  const pct = roundProgressPct(totalEarned, target)
  const done = !!info?.reached_target_at
  const celebrate = done && info!.round_no !== seen

  const dismiss = () => {
    if (info) localStorage.setItem('jf_round_celebrated', String(info.round_no))
    setSeen(info?.round_no ?? null)
  }

  return (
    <>
    {celebrate && (
      <RoundComplete
        round={info!.round_no}
        points={info!.points_if_reset}
        seconds={info!.seconds_to_target}
        busy={busy}
        onReset={reset}
        onDismiss={dismiss}
      />
    )}
    <div className={`round-card${done ? ' round-done' : ''}${embedded ? ' round-embedded' : ''}`}>
      <div className="round-header">
        <span className="round-icon-box">
          <Trophy size={embedded ? 15 : 24} className="round-icon" />
        </span>
        <span className="round-title">Round {info?.round_no ?? 1}</span>
        {/* Stars are the prestige points. Standalone the badge is the way to the
            boards; embedded, the race below already carries it — two of them in
            one card made the header shout. */}
        {!embedded && (
          <Link to="/ranking" className="round-prestige" title="Ranking">
            <Star size={16} className="round-star" />
            {info?.prestige_points ?? 0}
          </Link>
        )}
      </div>

      <div className="round-bar">
        <div className="round-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="round-figures">
        <span><Cannabis size={12} /> {fmtNum(totalEarned)}</span>
        <span className="round-goal">{fmtNum(target)}</span>
      </div>

      {done ? (
        <>
          <p className="round-lead">
            You are in the <Link to="/ranking" className="round-link">Quadrillionaires Club</Link>!
            The round stops counting here! Start over and push your ranking!
          </p>

          {/* The run, in the four numbers it can be judged on. Rank is what
              "push your ranking" refers to, so it leads. */}
          <div className="round-stats">
            <span className="round-stats-label">Your stats</span>
            <dl>
              <div>
                <dt>Rank</dt>
                <dd>{info!.club_rank ? `#${info!.club_rank} of ${info!.club_size}` : '—'}</dd>
              </div>
              <div>
                <dt>Time</dt>
                <dd>{days(info!.seconds_to_target ?? 0)}</dd>
              </div>
              <div>
                <dt>MegaFarm</dt>
                <dd>{info!.megafarm_at ? `after ${days(info!.megafarm_at)}` : 'not opened'}</dd>
              </div>
              <div>
                <dt>Boosted</dt>
                <dd>{info!.boost_sats > 0 ? `${info!.boost_sats} sats` : 'none'}</dd>
              </div>
            </dl>
          </div>
          {confirming ? (
            <div className="round-confirm">
              <p>
                Starting over clears joints, chain and speed.
                Sats and managers stay. You bank{' '}
                <strong className="round-stars-inline"><Star size={13} /> {info!.points_if_reset}</strong>.
              </p>
              <div className="round-confirm-actions">
                <button className="round-btn round-btn-go" onClick={reset} disabled={busy}>
                  {busy ? 'Resetting…' : 'Start over'}
                </button>
                <button className="round-btn" onClick={() => setConfirming(false)} disabled={busy}>
                  Not yet
                </button>
              </div>
            </div>
          ) : (
            <button className="round-btn round-btn-reset" onClick={() => setConfirming(true)}>
              <RotateCcw size={14} /> New round — <Star size={14} className="round-star" /> {info!.points_if_reset}
            </button>
          )}
        </>
      ) : (
        <p className="round-lead">
          Roll <strong>{fmtNum(target)}</strong> joints to finish the round!
          Beat the <Link to="/ranking" className="round-link">grow race</Link> highscore
        </p>
      )}

      {(info?.rounds_completed ?? 0) > 0 && (
        <div className="round-history">{info!.rounds_completed} round{info!.rounds_completed === 1 ? '' : 's'} finished</div>
      )}
      {error && <div className="round-error">{error}</div>}
    </div>
    </>
  )
}
