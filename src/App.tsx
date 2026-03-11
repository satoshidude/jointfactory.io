import { useEffect } from 'react'
import { Routes, Route, Navigate, useSearchParams, useParams } from 'react-router-dom'
import MobileLayout from './components/mobile/MobileLayout'
import MobileGame from './pages/mobile/MobileGame'
import MobileLottery from './pages/mobile/MobileLottery'
import MobileProfile from './pages/mobile/MobileProfile'
import MobileWallet from './pages/mobile/MobileWallet'
import MobileInfo from './pages/mobile/MobileInfo'
import InvitePage from './pages/Invite'
import PlayerProfile from './pages/PlayerProfile'
import { GameDisplayProvider } from './stores/gameDisplayStore'
import './App.css'


function RefRedirect() {
  const { code } = useParams()
  useEffect(() => {
    if (code) localStorage.setItem('jf_referral', code)
  }, [code])
  return <Navigate to="/" replace />
}

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
      <MobileLayout>
        <Routes>
          <Route path="/" element={<MobileGame />} />
          <Route path="/lottery" element={<MobileLottery />} />
          <Route path="/profile" element={<MobileProfile />} />
          <Route path="/wallet" element={<MobileWallet />} />
          <Route path="/info" element={<MobileInfo />} />
          <Route path="/invite" element={<InvitePage />} />
          <Route path="/u/:npub" element={<PlayerProfile />} />
          <Route path="/r/:code" element={<RefRedirect />} />
        </Routes>
      </MobileLayout>
    </GameDisplayProvider>
  )
}
