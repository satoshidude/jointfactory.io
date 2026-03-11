import LotteryWidget from '../../components/mobile/LotteryWidget'
import './MobilePages.css'

export default function MobileGame() {
  return (
    <div className="mobile-page">
      <LotteryWidget />

      <div className="mobile-placeholder" style={{ marginTop: 24 }}>
        <div className="mobile-placeholder-icon">🌿</div>
        <h2>Grow Station</h2>
        <p>Station cycle rings + upgrade buttons coming here</p>
        <div className="mobile-placeholder-stations">
          <div className="placeholder-station">
            <div className="placeholder-ring plant">
              <span>🌿</span>
            </div>
            <div className="placeholder-label">Plantations</div>
          </div>
          <div className="placeholder-station">
            <div className="placeholder-ring courier">
              <span>🚐</span>
            </div>
            <div className="placeholder-label">Courier</div>
          </div>
          <div className="placeholder-station">
            <div className="placeholder-ring factory">
              <span>🏭</span>
            </div>
            <div className="placeholder-label">Factory</div>
          </div>
        </div>
      </div>
    </div>
  )
}
