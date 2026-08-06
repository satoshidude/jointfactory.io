import { useAuth } from '../../stores/authStore'
import { Cannabis, Factory, Footprints, Zap, Ticket, TrendingUp, KeyRound, UserPlus, AlertTriangle, MessageSquare, Github, UserCog, Gauge, Rocket, Trophy } from 'lucide-react'
import InvitePage from '../Invite'
import './MobileInfo.css'
import './MobileLottery.css'

export default function MobileInfo() {
  const auth = useAuth()

  return (
    <div className="mi-page">
      {/* ── Hero ──────────────────────────────────────── */}
      <div className="ml-hero">
        <div className="ml-hero-glow ml-hero-glow-green"></div>
        <div className="ml-hero-icon-wrap">
          <div className="ml-hero-icon ml-hero-icon-green">
            <Cannabis size={48} />
          </div>
        </div>
        <h1 className="ml-hero-title" style={{ color: 'var(--neon-green)', textShadow: '0 0 20px rgba(57, 255, 20, .4)' }}>JOINT FACTORY</h1>
        <p className="ml-hero-subtitle">Grow. Produce. Earn. Compete.</p>
      </div>

      {/* ── Welcome ──────────────────────────────────── */}
      <div className="mi-card mi-card-welcome">
        <p className="mi-intro">
          Joint Factory is a real-time idle factory game built on{' '}
          <a href="https://nostr.how/en/what-is-nostr" target="_blank" rel="noopener noreferrer" className="mi-link purple">Nostr</a> and Bitcoin Lightning. Grow cannabis, roll joints, and earn real sats.
          It runs in rounds: a round ends at one quadrillion joints, and then you
          start over for a star. Play as a guest — the first three managers are
          free for everyone. Log in with your Nostr key to save progress, play for
          sats and race the others to the quadrillion.
        </p>
      </div>

      {/* ── Disclaimer ───────────────────────────────── */}
      <div className="mi-disclaimer">
        <AlertTriangle size={18} className="mi-disclaimer-icon" />
        <p>
          <strong>Disclaimer:</strong> Joint Factory is an art and educational project
          exploring decentralized technologies. Alpha status — only deposit small sats amounts.
          No guarantees. Play at your own risk.
        </p>
      </div>

      {/* ── How to Play ──────────────────────────────── */}
      <div className="mi-card mi-card-howto">
        <h2 className="mi-card-title">How to Play</h2>
        <div className="mi-features">
          <div className="mi-feature">
            <Trophy size={22} className="mi-feat-icon gold" />
            <div>
              <h3 className="mi-feat-title">Rounds</h3>
              <p className="mi-feat-desc">A round ends at one quadrillion joints — about a week with managers and a few visits a day. Counting stops there; the chain keeps running, but nothing more is added. Starting over banks a star and opens a fresh round. It clears joints, chain and speed. Your sats are never touched, and a star buys no advantage of any kind — every round is the same race, which is what keeps the times comparable.</p>
            </div>
          </div>

          <div className="mi-feature">
            <Cannabis size={22} className="mi-feat-icon green" />
            <div>
              <h3 className="mi-feat-title">Plantations</h3>
              <p className="mi-feat-desc">Grow weed across six plots. Levels cost joints, and milestones double a plot's output — every 10, then 15, then 20 levels, up to ten doublings. After that a level still adds output, just not another factor.</p>
            </div>
          </div>

          <div className="mi-feature">
            <Footprints size={22} className="mi-feat-icon pink" />
            <div>
              <h3 className="mi-feat-title">Courier</h3>
              <p className="mi-feat-desc">Carries the harvest to the factory. Upgrade its capacity with joints — if it brings less than the factory can roll, the factory idles.</p>
            </div>
          </div>

          <div className="mi-feature">
            <Factory size={22} className="mi-feat-icon purple" />
            <div>
              <h3 className="mi-feat-title">Factory</h3>
              <p className="mi-feat-desc">Rolls weed into joints in batches. Bigger batches cost joints. Your output is whatever the slowest of the three stations manages.</p>
            </div>
          </div>

          <div className="mi-feature">
            <Zap size={22} className="mi-feat-icon gold" />
            <div>
              <h3 className="mi-feat-title">Lightning Economy</h3>
              <p className="mi-feat-desc">Sats buy timed boosts and extra managers — speed itself is paid for in joints. Withdraw anytime — real Bitcoin over Lightning.</p>
            </div>
          </div>

          <div className="mi-feature">
            <UserCog size={22} className="mi-feat-icon green" />
            <div>
              <h3 className="mi-feat-title">Managers</h3>
              <p className="mi-feat-desc">A manager runs a station for you. The first three are free for everyone, so the whole chain can run without depositing anything. Beyond that the price falls with every round you finish: 90 sats in your first round, then 60, 30, and 21 from the fourth on. Outdoor, Indoor and Hydroponic stop costing anything after the first, second and third round. Managers are hired again each round — that is what keeps the lottery pot filled.</p>
            </div>
          </div>

          <div className="mi-feature">
            <Gauge size={22} className="mi-feat-icon green" />
            <div>
              <h3 className="mi-feat-title">Speed</h3>
              <p className="mi-feat-desc">Spend joints for +5% on the whole chain — plantations, courier and factory at once. It lasts to the end of the round and is cleared with the reset, like everything else the round produced. The price is a slice of your own production, so it stays meaningful however big you get.</p>
            </div>
          </div>

          <div className="mi-feature">
            <Rocket size={22} className="mi-feat-icon gold" />
            <div>
              <h3 className="mi-feat-title">Boosts</h3>
              <p className="mi-feat-desc">Timed multipliers for sats, half an hour each: 2x grow, 3x courier or 2x factory for 10 sats, or Full Throttle — all three at once — for 21. Buying one while it runs extends it. Every sat feeds the lottery pot.</p>
            </div>
          </div>

          <div className="mi-feature">
            <Ticket size={22} className="mi-feat-icon gold" />
            <div>
              <h3 className="mi-feat-title">Lottery</h3>
              <p className="mi-feat-desc">Joints buy tickets, up to four per draw. Two things unlock them: the chain automated on all three stations, and some sats spent this round — a boost from 10 sats or a manager, either one. Those sats are the pot you are drawing from. A ticket costs a share of a day of your own production, so it is the same bite for everyone. Draws Tue, Thu &amp; Sat at 21:00. 80% of the pot is paid out and split by rank — 70/30 with two winners, 60/25/15 with three. Your share of the tickets is your chance at first place. A draw needs two players; with one, the pot carries over.</p>
            </div>
          </div>

          <div className="mi-feature">
            <TrendingUp size={22} className="mi-feat-icon green" />
            <div>
              <h3 className="mi-feat-title">Ranking</h3>
              <p className="mi-feat-desc">One board under Ranking, top three on a podium: <strong>stars</strong> for rounds finished, <strong>best</strong> for the fastest quadrillion you ever rolled, <strong>total</strong> for the joints of the round you are in. The live race sits on the Grow page above your chain — every lane runs to the same quadrillion, but the ranking is the projected round time, so starting earlier puts you further along the lane without winning it.</p>
            </div>
          </div>

          <div className="mi-feature">
            <UserPlus size={22} className="mi-feat-icon green" />
            <div>
              <h3 className="mi-feat-title">Invite Friends</h3>
              <p className="mi-feat-desc">Share your invite link. Everyone who joins through it appears as a tile in your boost card; once they automate all three stations, one click starts half an hour of Full Throttle — 2x output chain-wide. They stack.</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Invite ───────────────────────────────────────
          The invite page itself, without its hero. It used to be a tab of its
          own, which put a page in the navigation that most players open once. */}
      <div className="mi-card mi-card-invite">
        <h2 className="mi-card-title">Invite a Buddy</h2>
        <InvitePage embedded />
      </div>

      {/* ── Nostr Login ──────────────────────────────── */}
      <div className="mi-card">
        <h2 className="mi-card-title">Nostr Login</h2>
        <div className="mi-feature">
          <KeyRound size={22} className="mi-feat-icon purple" />
          <div>
            <p className="mi-feat-desc">
              Sign in with your Nostr identity to save progress and unlock all features.
              Get a key with{' '}
              <a href="https://getalby.com" target="_blank" rel="noopener noreferrer" className="mi-link gold">Alby</a>.
              {auth.isLoggedIn && auth.npub && (
                <>{' '}Your profile on{' '}
                  <a href={`https://nostr.nsnip.io/users/${auth.npub}`} target="_blank" rel="noopener noreferrer" className="mi-link purple">Nostr</a>.
                </>
              )}
            </p>
          </div>
        </div>
        {auth.isLoggedIn && (
          <div className="mi-feature">
            <UserCog size={22} className="mi-feat-icon purple" />
            <div>
              <h3 className="mi-feat-title">Nostr Profile Manager</h3>
              <p className="mi-feat-desc">
                <a href="/profile/nostr" className="mi-link purple">Edit your Nostr profile</a> — update your name, bio, picture, lightning address and more.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ── Links & Contact ──────────────────────────── */}
      <div className="mi-card">
        <h2 className="mi-card-title">Links</h2>

        <div className="mi-contact">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="var(--neon-purple)" style={{ flexShrink: 0 }}><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15.5c-2.49 0-4.5-2.01-4.5-4.5S8.51 8.5 11 8.5c1.73 0 3.23.98 3.98 2.41l-1.73 1c-.47-.89-1.39-1.41-2.25-1.41-1.38 0-2.5 1.12-2.5 2.5s1.12 2.5 2.5 2.5c.87 0 1.65-.44 2.11-1.11l1.78.89C14.17 16.64 12.72 17.5 11 17.5zm5.5-3h-1.5v-1.5H13V11.5h1.5V10H16v1.5h1.5V13H16v1.5z"/></svg>
          <span>
            <a href="https://nostr.nsnip.io/users/npub17a7rs2vcdqs9xhsl2w4qeydafaflllh5475su48y0utes9tufffqs83r9s" target="_blank" rel="noopener noreferrer" className="mi-link purple">
              Joint Factory on Nostr</a>
          </span>
        </div>

        <div className="mi-contact">
          <Github size={16} style={{ color: '#f0f6fc' }} />
          <span>
            <a href="https://github.com/satoshidude/jointfactory.io" target="_blank" rel="noopener noreferrer" className="mi-link" style={{ color: '#f0f6fc' }}>
              GitHub Repository</a>
          </span>
        </div>

        <div className="mi-contact">
          <MessageSquare size={16} style={{ color: 'var(--neon-gold)' }} />
          <span>
            <a href="https://satoshidude.npub.pro/author/npub1vc2pn7853vd5jm3zfxhwj7n2m82ma2g8zjwu00e7kare727w240qrt8lpw/" target="_blank" rel="noopener noreferrer" className="mi-link gold">
              satoshidude</a>
          </span>
        </div>
      </div>

    </div>
  )
}
