import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Cannabis, Zap } from 'lucide-react'
import { useAuth } from '../../stores/authStore'
import { useGameDisplay } from '../../stores/gameDisplayStore'
import LoginModal from '../LoginModal'
import './CompactHeader.css'

function fmtNum(n: number): string {
  if (n >= 1e15) return (n / 1e15).toFixed(1) + 'Qa'
  if (n >= 1e12) return (n / 1e12).toFixed(1) + 'T'
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return Math.floor(n).toString()
}

export default function CompactHeader() {
  const auth = useAuth()
  const gd = useGameDisplay()
  const navigate = useNavigate()
  const [showLogin, setShowLogin] = useState(false)

  const joints = gd.joints || auth.joints
  const sats = gd.sats || auth.sats

  return (
    <>
      <header className="compact-header">
        <div className="compact-header-title" onClick={() => navigate('/')}>
          <Cannabis size={42} className="compact-header-logo-icon" />
          JOINT FACTORY
          <span className="compact-header-version">v0.2</span>
        </div>

        <div className="compact-header-row">
          <div className="compact-header-stats">
            <div className="compact-stat joints">
              <Cannabis size={14} />
              <span>{fmtNum(joints)}</span>
            </div>
            <div className="compact-stat sats">
              <Zap size={14} />
              <span>{fmtNum(sats)}</span>
            </div>
            <div className="compact-user" onClick={auth.isLoggedIn ? () => navigate('/profile') : () => setShowLogin(true)}>
              {auth.isLoggedIn ? (
                <>
                  <svg className="compact-user-nostr" viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15.5c-2.49 0-4.5-2.01-4.5-4.5S8.51 8.5 11 8.5c1.73 0 3.23.98 3.98 2.41l-1.73 1c-.47-.89-1.39-1.41-2.25-1.41-1.38 0-2.5 1.12-2.5 2.5s1.12 2.5 2.5 2.5c.87 0 1.65-.44 2.11-1.11l1.78.89C14.17 16.64 12.72 17.5 11 17.5zm5.5-3h-1.5v-1.5H13V11.5h1.5V10H16v1.5h1.5V13H16v1.5z"/></svg>
                  {auth.displayName || 'Anonymous'}
                </>
              ) : (
                <>
                  <svg className="compact-user-nostr" viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15.5c-2.49 0-4.5-2.01-4.5-4.5S8.51 8.5 11 8.5c1.73 0 3.23.98 3.98 2.41l-1.73 1c-.47-.89-1.39-1.41-2.25-1.41-1.38 0-2.5 1.12-2.5 2.5s1.12 2.5 2.5 2.5c.87 0 1.65-.44 2.11-1.11l1.78.89C14.17 16.64 12.72 17.5 11 17.5zm5.5-3h-1.5v-1.5H13V11.5h1.5V10H16v1.5h1.5V13H16v1.5z"/></svg>
                  login here
                </>
              )}
            </div>
          </div>
        </div>

      </header>

      {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}
    </>
  )
}
