import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../stores/authStore'
import { Cannabis, Factory, Footprints, Zap, Ticket, TrendingUp, KeyRound, ExternalLink, UserPlus, AlertTriangle, Mail } from 'lucide-react'
import './MobileInfo.css'
import './MobileLottery.css'

export default function MobileInfo() {
  const navigate = useNavigate()
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

      {/* ── Intro ─────────────────────────────────────── */}
      <div className="mi-card">
        <p className="mi-intro">
          Joint Factory is a real-time idle factory game built on{' '}
          <a href="https://nostr.how/en/what-is-nostr" target="_blank" rel="noopener noreferrer" className="mi-link purple">
            Nostr <ExternalLink size={10} />
          </a>{' '}
          and Bitcoin Lightning. Login with your Nostr key to save progress,
          unlock auto managers, and earn real sats.
        </p>
      </div>

      {/* ── Features ──────────────────────────────────── */}
      <div className="mi-card">
        <div className="mi-features">
          <div className="mi-feature">
            <KeyRound size={22} className="mi-feat-icon purple" />
            <div>
              <h3 className="mi-feat-title">Nostr Login</h3>
              <p className="mi-feat-desc">Sign in with your Nostr identity. Get a key with{' '}
                <a href="https://getalby.com" target="_blank" rel="noopener noreferrer" className="mi-link gold">Alby <ExternalLink size={10} /></a>.
                {auth.isLoggedIn && auth.npub && (
                  <>{' '}Your profile on{' '}
                    <a href={`https://nostr.nsnip.io/#/p/${auth.npub}`} target="_blank" rel="noopener noreferrer" className="mi-link green">Jumble <ExternalLink size={10} /></a>.
                  </>
                )}
              </p>
            </div>
          </div>

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

      {/* ── Disclaimer + Contact ──────────────────────── */}
      <div className="mi-card">
        <div className="mi-disclaimer">
          <AlertTriangle size={18} className="mi-disclaimer-icon" />
          <p>
            <strong>Disclaimer:</strong> Joint Factory is an art and educational project
            exploring decentralized technologies. Alpha status — only use small sats amounts.
          </p>
        </div>

        <div className="mi-contact">
          <Cannabis size={16} style={{ color: 'var(--neon-green)' }} />
          <span>Follow{' '}
            <a href="https://nostr.nsnip.io/users/npub17a7rs2vcdqs9xhsl2w4qeydafaflllh5475su48y0utes9tufffqs83r9s" target="_blank" rel="noopener noreferrer" className="mi-link green">
              Joint Factory on Nostr <ExternalLink size={10} />
            </a>
          </span>
        </div>

        <div className="mi-contact">
          <Mail size={16} style={{ color: 'var(--text-secondary)' }} />
          <span>Contact:{' '}
            <a href="https://nostr.nsnip.io/#/p/satoshidude@nsnip.io" target="_blank" rel="noopener noreferrer" className="mi-link gold">
              satoshidude@nsnip.io <ExternalLink size={10} />
            </a>
          </span>
        </div>

        <button className="mi-play-btn" onClick={() => navigate('/')}>
          Start Playing
        </button>
      </div>
    </div>
  )
}
