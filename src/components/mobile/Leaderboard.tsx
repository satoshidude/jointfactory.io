import { useEffect, useState } from 'react'
import { Trophy, Cannabis, Star, Timer, Crown, Medal, Award } from 'lucide-react'
import { nip19 } from 'nostr-tools'
import { apiFetch } from '../../lib/api'
import { useAuth } from '../../stores/authStore'
import './Leaderboard.css'
import { fmtNum } from '../../lib/format'

interface PlayerInfo {
  npub: string
  display_name: string
  joints_per_sec: number
  total_won_sats: number
  total_joints_earned: number
  speed_level?: number
  prestige_points?: number
  rounds_completed?: number
}

interface ClubEntry {
  npub: string
  display_name: string
  round_no: number
  seconds_to_target: number
  boost_sats: number
  megafarm_at: number | null
}

/** One player, with everything the board knows about them. */
interface Entry {
  npub: string
  name: string
  /** Joints this round — what the board ranks by. */
  total: number
  /** Rounds finished. */
  stars: number
  /** Fastest quadrillion they ever rolled, in seconds. Null until they do. */
  best: number | null
}

const dur = (s: number) => s >= 86400 ? `${(s / 86400).toFixed(1)} d` : `${(s / 3600).toFixed(1)} h`
const link = (npub: string) => {
  try { return `/u/${nip19.npubEncode(npub)}` } catch { return `/u/${npub}` }
}

/**
 * One board, not two.
 *
 * The standings were split across tabs — who is ahead in this round, and who
 * was fastest to a quadrillion — which made the reader click to compare two
 * facts about the same twenty people. They are three columns, so they are one
 * table: the stars say who keeps coming back, the best time says who is fast,
 * and the total says who is ahead right now.
 */
export default function Leaderboard() {
  const auth = useAuth()
  const [players, setPlayers] = useState<PlayerInfo[]>([])
  const [club, setClub] = useState<ClubEntry[]>([])

  useEffect(() => {
    const load = () => {
      apiFetch('/players').then(data => {
        if (data?.players) {
          setPlayers((data.players as PlayerInfo[])
            .filter(p => p.total_joints_earned > 0 || (p.prestige_points ?? 0) > 0))
        }
      }).catch(() => {})
      apiFetch('/rounds/leaderboard').then(data => {
        if (data?.club) setClub(data.club as ClubEntry[])
      }).catch(() => {})
    }
    load()
    const iv = setInterval(load, 30000)
    return () => clearInterval(iv)
  }, [])

  const you = auth.npub

  // A player can finish more than one round; the board carries their best.
  const bestOf = (npub: string) => {
    const times = club.filter(e => e.npub === npub).map(e => e.seconds_to_target)
    return times.length ? Math.min(...times) : null
  }

  /**
   * Stars first, then the fastest round, then progress in the one being played.
   *
   * It ranked by joints in the current round alone, which sent whoever finished
   * one to the bottom: gorilla banked a fourth star and appeared tenth with the
   * 4.5 K of a round two hours old. The board was measuring the lap somebody
   * happened to be on rather than what they had done — and it punished the one
   * thing the round system asks players to do. Where the live standing belongs
   * is the race on the Grow page, which is exactly what it shows.
   */
  const entries: Entry[] = players.map(p => ({
    npub: p.npub,
    name: you === p.npub ? 'YOU' : (p.display_name || 'anon'),
    total: p.total_joints_earned,
    stars: p.prestige_points ?? 0,
    best: bestOf(p.npub),
  })).sort((a, b) =>
    b.stars - a.stars ||
    (a.best ?? Infinity) - (b.best ?? Infinity) ||
    b.total - a.total
  )

  // Second, first, third — the shape of an actual podium.
  const podium = [entries[1], entries[0], entries[2]]
  const rest = entries.slice(3, 3 + 12)

  return (
    <div className="lb-card">
      <div className="lb-head">
        <Trophy size={15} className="lb-head-icon" />
        <span className="lb-head-title">Standings</span>
        <span className="lb-head-note">rounds finished · best quadrillion · joints this round</span>
      </div>

      {entries.length === 0 ? (
        <p className="lb-empty">No players yet.</p>
      ) : (
        <>
          <div className="lb-podium">
            {podium.map((e, i) => {
              // Rendered 2 · 1 · 3, so the middle block is the winner.
              const place = i === 1 ? 1 : i === 0 ? 2 : 3
              if (!e) return <div key={place} className="lb-plinth lb-plinth-empty" />
              return (
                <div key={e.npub} className={`lb-plinth lb-place-${place}${you === e.npub ? ' lb-plinth-you' : ''}`}>
                  {/* The winner gets something the other two do not. A podium
                      where all three plinths look alike is just three boxes. */}
                  {place === 1 && <Crown size={18} className="lb-crown" />}
                  {/* The disc carries the honour, the step carries the number —
                      both showing "2" was one 2 too many. */}
                  <div className="lb-medal">
                    {place === 1 ? <Trophy size={24} /> : place === 2 ? <Medal size={19} /> : <Award size={19} />}
                  </div>
                  <a className="lb-plinth-name" href={link(e.npub)}>{e.name}</a>
                  {/* Rounds finished, as stars. Up to five are drawn; past that
                      a count, because six little glyphs stop being countable. */}
                  {e.stars > 0 && (
                    <div className="lb-plinth-stars" title={`${e.stars} rounds finished`}>
                      {e.stars <= 5
                        ? Array.from({ length: e.stars }, (_, k) => <Star key={k} size={11} />)
                        : <><Star size={11} /> ×{e.stars}</>}
                    </div>
                  )}
                  {/* Each plinth leads with what it earned its place by: a
                      record where there is one, otherwise the round in progress.
                      A player who just banked a star has almost no joints yet,
                      and printing that as their headline read like a demotion. */}
                  <div className="lb-plinth-value">
                    {e.best != null ? <><Timer size={13} /> {dur(e.best)}</> : fmtNum(e.total)}
                  </div>
                  <div className="lb-plinth-caption">
                    {e.best != null ? 'best quadrillion' : 'joints this round'}
                  </div>
                  <div className="lb-plinth-best">
                    {e.best != null ? <>{fmtNum(e.total)} this round</> : <>&nbsp;</>}
                  </div>
                  {/* The step itself: gold is tallest, bronze is lowest, and the
                      numeral is cut into it the way it is on a real one. */}
                  <div className="lb-step"><span>{place}</span></div>
                </div>
              )
            })}
          </div>

          {rest.length > 0 && (
            <>
              <div className="lb-head-row">
                <span className="lb-h-rank">#</span>
                <span className="lb-h-name">Name</span>
                <span>Stars</span>
                <span>Best</span>
                <span>Total</span>
              </div>
              <div className="lb-rows">
                {rest.map((e, i) => (
                  <div key={e.npub} className={`lb-row${you === e.npub ? ' lb-row-you' : ''}`}>
                    <span className="lb-rank">#{i + 4}</span>
                    <a className="lb-name" href={link(e.npub)}>
                      <span className="lb-name-text">{e.name}</span>
                    </a>
                    <span className="lb-cell">
                      {e.stars > 0
                        ? <span className="lb-stars-cell" title={`${e.stars} rounds finished`}>
                            <Star size={11} /> {e.stars}
                          </span>
                        // A column of purple zeros pulls the eye to the players who
                        // have done the least. Nothing to show reads as nothing.
                        : <span className="lb-stars-none">–</span>}
                    </span>
                    <span className="lb-cell">
                      {/* No clock here — the column is called Best, and the icon
                          only cost the cell a second line. */}
                      {e.best != null
                        ? <span className="lb-strong">{dur(e.best)}</span>
                        : <span className="lb-stars-none">–</span>}
                    </span>
                    <span className="lb-cell"><Cannabis size={11} /> {fmtNum(e.total)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
