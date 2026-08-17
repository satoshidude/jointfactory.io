import { useEffect } from 'react'
import { Routes, Route, Navigate, useSearchParams, useParams, useLocation } from 'react-router-dom'
import MobileLayout from './components/mobile/MobileLayout'
import MobileGame from './pages/mobile/MobileGame'
import MobileLottery from './pages/mobile/MobileLottery'
import MobileProfile from './pages/mobile/MobileProfile'
import MobileWallet from './pages/mobile/MobileWallet'
import MobileInfo from './pages/mobile/MobileInfo'
import MobileRanking from './pages/mobile/MobileRanking'
import InvitePage from './pages/Invite'
import PlayerProfile from './pages/PlayerProfile'
import NostrProfileEdit from './pages/mobile/NostrProfileEdit'
import MobileAdmin from './pages/mobile/MobileAdmin'
import SwitchToRounds from './components/mobile/SwitchToRounds'
import { useRoundSwitch } from './hooks/useRoundSwitch'
import { claimMaster } from './lib/session'
import { useAuth } from './stores/authStore'
import { GameDisplayProvider } from './stores/gameDisplayStore'
import './App.css'

/** Reachable while an account still has to confirm the switch to rounds. Sats are
 *  real money, so the wallet stays open; Info explains what changed. */
const OPEN_WHILE_PENDING = ['/wallet', '/info', '/profile', '/profile/nostr']


function RefRedirect() {
  const { code } = useParams()
  useEffect(() => {
    if (code) localStorage.setItem('jf_referral', code)
  }, [code])
  return <Navigate to="/" replace />
}

export default function App() {
  const [searchParams] = useSearchParams()
  const location = useLocation()
  const auth = useAuth()
  const { offer, busy, error, confirm } = useRoundSwitch(auth.isLoggedIn)

  // Opening the page is the login that counts: this client takes the account and
  // any older one stops writing. See src/lib/session.ts.
  useEffect(() => {
    if (auth.isLoggedIn) claimMaster()
  }, [auth.isLoggedIn])

  useEffect(() => {
    const ref = searchParams.get('ref')
    if (ref) {
      localStorage.setItem('jf_referral', ref)
    }
  }, [searchParams])

  // An account from before rounds does not play until its owner has decided.
  // The server refuses its saves anyway; this is what says so.
  if (offer && !OPEN_WHILE_PENDING.includes(location.pathname)) {
    return (
      <GameDisplayProvider>
        <MobileLayout>
          <SwitchToRounds
            offer={offer}
            busy={busy}
            error={error}
            // The loop holds the chain in refs for the whole session, so a reload
            // is the one way to be sure round four is what it picks up.
            onConfirm={async () => { if (await confirm()) window.location.reload() }}
          />
        </MobileLayout>
      </GameDisplayProvider>
    )
  }

  return (
    <GameDisplayProvider>
      <MobileLayout>
        <Routes>
          <Route path="/" element={<MobileGame />} />
          <Route path="/lottery" element={<MobileLottery />} />
          <Route path="/profile" element={<MobileProfile />} />
          <Route path="/profile/nostr" element={<NostrProfileEdit />} />
          <Route path="/wallet" element={<MobileWallet />} />
          <Route path="/ranking" element={<MobileRanking />} />
          <Route path="/info" element={<MobileInfo />} />
          <Route path="/invite" element={<InvitePage />} />
          <Route path="/u/:npub" element={<PlayerProfile />} />
          <Route path="/r/:code" element={<RefRedirect />} />
          {/* Not in the nav — owner-only, and the server enforces it. */}
          <Route path="/admin" element={<MobileAdmin />} />
        </Routes>
      </MobileLayout>
    </GameDisplayProvider>
  )
}
