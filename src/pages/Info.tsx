import { useNavigate } from 'react-router-dom'
import { useAuth } from '../stores/authStore'
import { Card, CardContent } from '@/components/ui/card'
import { Cannabis, Factory, Footprints, Zap, Ticket, TrendingUp, ArrowLeft, KeyRound, ExternalLink, UserPlus, AlertTriangle, Mail } from 'lucide-react'
import './Info.css'

export default function InfoPage() {
  const navigate = useNavigate()
  const auth = useAuth()

  return (
    <div className="info-page">
      <button className="info-back" onClick={() => navigate('/')}>
        <ArrowLeft size={18} /> Back to Game
      </button>

      <div className="info-hero">
        <h1 className="info-title">JOINT FACTORY</h1>
        <p className="info-tagline">Grow. Produce. Earn. Compete.</p>
      </div>

      <Card className="info-card">
        <CardContent className="info-content">
          <p className="info-intro">
            Joint Factory is a real-time idle factory game built on{' '}
            <a href="https://nostr.how/en/what-is-nostr" target="_blank" rel="noopener noreferrer" className="info-link purple">
              Nostr <ExternalLink size={10} />
            </a>{' '}
            and Bitcoin Lightning. Login with your Nostr key to save progress,
            unlock auto managers, and earn real sats. No email, no password — just your keys.
          </p>
          <p className="info-intro">
            Grow your weed, transport it, produce joints, and climb the leaderboard —
            all while earning real sats.
          </p>

          <div className="info-features">
            <div className="info-feature">
              <KeyRound size={24} className="info-icon purple" />
              <div>
                <h3>Nostr Login</h3>
                <p>Sign in with your Nostr identity — no account needed. Get a key with{' '}
                  <a href="https://getalby.com" target="_blank" rel="noopener noreferrer" className="info-link gold">
                    Alby <ExternalLink size={10} />
                  </a>{' '}
                  or any Nostr signer. Your progress is tied to your key.
                  {auth.isLoggedIn && auth.npub && (
                    <>{' '}Check out your profile on{' '}
                      <a href={`https://jumble.nsnip.io/#/p/${auth.npub}`} target="_blank" rel="noopener noreferrer" className="info-link green">
                        Jumble <ExternalLink size={10} />
                      </a>.
                    </>
                  )}
                </p>
              </div>
            </div>

            <div className="info-feature">
              <Cannabis size={24} className="info-icon weed" />
              <div>
                <h3>Plantations</h3>
                <p>Grow weed across multiple plant slots. Level up for higher output
                  and hit milestones for massive production multipliers.</p>
              </div>
            </div>

            <div className="info-feature">
              <Footprints size={24} className="info-icon flamingo" />
              <div>
                <h3>Courier</h3>
                <p>Your courier transports harvested weed from the plantations to
                  the factory. Upgrade capacity and speed to keep up with production.</p>
              </div>
            </div>

            <div className="info-feature">
              <Factory size={24} className="info-icon purple" />
              <div>
                <h3>Factory</h3>
                <p>The factory turns weed into joints. Bigger batches and
                  faster speed mean more joints per second.</p>
              </div>
            </div>

            <div className="info-feature">
              <Zap size={24} className="info-icon gold" />
              <div>
                <h3>Lightning Economy</h3>
                <p>Deposit sats to unlock speed upgrades. Withdraw your earnings
                  anytime — it's real Bitcoin over Lightning. Get a Lightning wallet at{' '}
                  <a href="https://getalby.com" target="_blank" rel="noopener noreferrer" className="info-link gold">
                    getalby.com <ExternalLink size={10} />
                  </a>.
                </p>
              </div>
            </div>

            <div className="info-feature">
              <Ticket size={24} className="info-icon flamingo" />
              <div>
                <h3>Lottery</h3>
                <p>Spend joints on lottery tickets for a chance to win the pot
                  in real sats. Draws happen 6 times daily.</p>
              </div>
            </div>

            <div className="info-feature">
              <TrendingUp size={24} className="info-icon green" />
              <div>
                <h3>Leaderboard</h3>
                <p>Compete against other players. Track your joints/s production
                  rate and climb the rankings.</p>
              </div>
            </div>

            <div className="info-feature">
              <UserPlus size={24} className="info-icon green" />
              <div>
                <h3>Invite Friends</h3>
                <p>Share your personal invite link and grow your crew. When your buddy
                  unlocks 3 auto-managers, you both get rewarded with 10 sats. Your first
                  referral also earns you a free auto-manager. The more friends you bring,
                  the more you earn.</p>
              </div>
            </div>
          </div>

          <div className="info-disclaimer">
            <AlertTriangle size={18} className="info-disclaimer-icon" />
            <p>
              <strong>Disclaimer:</strong> Joint Factory is an art and educational project
              exploring decentralized technologies (Nostr, Bitcoin Lightning). This project
              is in alpha status — only use small sats amounts. No financial advice,
              no guarantees. Play responsibly.
            </p>
          </div>

          <div className="info-contact">
            <Cannabis size={16} className="info-contact-icon" style={{ color: 'var(--neon-green)' }} />
            <span>Follow{' '}
              <a href="https://jumble.nsnip.io/users/npub17a7rs2vcdqs9xhsl2w4qeydafaflllh5475su48y0utes9tufffqs83r9s" target="_blank" rel="noopener noreferrer" className="info-link green">
                Joint Factory on Nostr <ExternalLink size={10} />
              </a>
            </span>
          </div>

          <div className="info-contact">
            <Mail size={16} className="info-contact-icon" />
            <span>Nostr / Mail / Zap:{' '}
              <a href="https://jumble.nsnip.io/#/p/satoshidude@nsnip.io" target="_blank" rel="noopener noreferrer" className="info-link gold">
                satoshidude@nsnip.io <ExternalLink size={10} />
              </a>
            </span>
          </div>

          <div className="info-cta">
            <p>Ready to build your empire?</p>
            <button className="info-play-btn" onClick={() => navigate('/')}>
              Start Playing
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
