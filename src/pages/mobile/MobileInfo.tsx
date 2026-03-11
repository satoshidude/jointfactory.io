import { useAuth } from '../../stores/authStore'
import { Cannabis, Factory, Footprints, Zap, Ticket, TrendingUp, KeyRound, UserPlus, AlertTriangle, MessageSquare, Github, UserCog } from 'lucide-react'
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
      <div className="mi-card">
        <p className="mi-intro">
          Joint Factory is a real-time idle factory game built on{' '}
          <a href="https://nostr.how/en/what-is-nostr" target="_blank" rel="noopener noreferrer" className="mi-link purple">Nostr</a> and Bitcoin Lightning. Grow cannabis, roll joints, and earn real sats.
          Login with your Nostr key to save progress, unlock auto managers,
          and compete on the leaderboard.
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
      <div className="mi-card">
        <h2 className="mi-card-title">How to Play</h2>
        <div className="mi-features">
          <div className="mi-feature">
            <Cannabis size={22} className="mi-feat-icon green" />
            <div>
              <h3 className="mi-feat-title">Plantations</h3>
              <p className="mi-feat-desc">Grow weed across multiple plant slots. Level up for higher output and hit milestones for massive multipliers.</p>
            </div>
          </div>

          <div className="mi-feature">
            <Footprints size={22} className="mi-feat-icon pink" />
            <div>
              <h3 className="mi-feat-title">Courier</h3>
              <p className="mi-feat-desc">Transports harvested weed to the factory. Upgrade capacity and speed to keep up.</p>
            </div>
          </div>

          <div className="mi-feature">
            <Factory size={22} className="mi-feat-icon purple" />
            <div>
              <h3 className="mi-feat-title">Factory</h3>
              <p className="mi-feat-desc">Turns weed into joints. Bigger batches and faster speed mean more joints per second.</p>
            </div>
          </div>

          <div className="mi-feature">
            <Zap size={22} className="mi-feat-icon gold" />
            <div>
              <h3 className="mi-feat-title">Lightning Economy</h3>
              <p className="mi-feat-desc">Deposit sats to unlock speed upgrades. Withdraw your earnings anytime — real Bitcoin over Lightning.</p>
            </div>
          </div>

          <div className="mi-feature">
            <Ticket size={22} className="mi-feat-icon gold" />
            <div>
              <h3 className="mi-feat-title">Lottery</h3>
              <p className="mi-feat-desc">Spend joints on lottery tickets for a chance to win the pot in real sats. 6 draws daily.</p>
            </div>
          </div>

          <div className="mi-feature">
            <TrendingUp size={22} className="mi-feat-icon green" />
            <div>
              <h3 className="mi-feat-title">Leaderboard</h3>
              <p className="mi-feat-desc">Compete against other players. Track your joints/s and climb the rankings.</p>
            </div>
          </div>

          <div className="mi-feature">
            <UserPlus size={22} className="mi-feat-icon green" />
            <div>
              <h3 className="mi-feat-title">Invite Friends</h3>
              <p className="mi-feat-desc">Share your invite link. When your buddy unlocks 3 auto-managers, you both get 10 sats. First referral earns a free auto-manager.</p>
            </div>
          </div>
        </div>
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
                  <a href={`https://nostr.nsnip.io/#/p/${auth.npub}`} target="_blank" rel="noopener noreferrer" className="mi-link purple">Nostr</a>.
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
            <a href="https://nostr.nsnip.io/#/p/npub17a7rs2vcdqs9xhsl2w4qeydafaflllh5475su48y0utes9tufffqs83r9s" target="_blank" rel="noopener noreferrer" className="mi-link purple">
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
