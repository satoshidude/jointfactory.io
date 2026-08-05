import { Trophy } from 'lucide-react'
import Leaderboard from '../../components/mobile/Leaderboard'
import './MobileInfo.css'
import './MobileLottery.css'

/**
 * Where the standings live.
 *
 * The boards used to sit in the middle of the Grow page, between the speed card
 * and the plantations — a page that is already long on a phone, and three
 * different questions ("who is ahead right now", "who was fastest to a billion",
 * "who has started over most") stacked into one card at the bottom of it.
 *
 * The live race lives on the Grow page, above the chain it is about. Here the
 * question is who stands where, and that is what the podium answers.
 */
export default function MobileRanking() {
  return (
    <div className="mi-page">
      <div className="ml-hero">
        <div className="ml-hero-glow ml-hero-glow-gold"></div>
        <div className="ml-hero-icon-wrap">
          <div className="ml-hero-icon ml-hero-icon-gold">
            <Trophy size={48} />
          </div>
        </div>
        <h1 className="ml-hero-title" style={{ color: 'var(--neon-gold)', textShadow: '0 0 20px rgba(255, 215, 0, .4)' }}>RANKING</h1>
        <p className="ml-hero-subtitle">Who is ahead, who was fastest, who keeps going</p>
      </div>

      <Leaderboard />
    </div>
  )
}
