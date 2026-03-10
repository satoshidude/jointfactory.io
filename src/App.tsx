import { useEffect } from 'react'
import { Routes, Route, useSearchParams } from 'react-router-dom'
import Header from './components/Header'
import Dashboard from './pages/Dashboard'
import Game from './pages/Game'
import LotteryPage from './pages/Lottery'
import InfoPage from './pages/Info'
import InvitePage from './pages/Invite'
import WalletPage from './pages/Wallet'
import PlayerProfile from './pages/PlayerProfile'
import { GameDisplayProvider } from './stores/gameDisplayStore'
import './App.css'

export default function App() {
  const [searchParams] = useSearchParams()
  useEffect(() => {
    const ref = searchParams.get('ref')
    if (ref) {
      localStorage.setItem('jf_referral', ref)
    }
  }, [searchParams])

  return (
    <GameDisplayProvider>
    <div className="layout">
      <div className="main">
        <Header />
        <div className="content">
          <Routes>
            <Route path="/" element={<Game />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/lottery" element={<LotteryPage />} />
            <Route path="/info" element={<InfoPage />} />
            <Route path="/invite" element={<InvitePage />} />
            <Route path="/wallet" element={<WalletPage />} />
            <Route path="/u/:npub" element={<PlayerProfile />} />
          </Routes>
        </div>
      </div>
    </div>
    </GameDisplayProvider>
  )
}
