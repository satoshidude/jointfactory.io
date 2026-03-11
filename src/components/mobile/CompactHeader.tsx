import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Cannabis, Zap, LogIn } from 'lucide-react'
import { useAuth } from '../../stores/authStore'
import { useGameDisplay } from '../../stores/gameDisplayStore'
import LoginModal from '../LoginModal'
import './CompactHeader.css'

function fmtNum(n: number): string {
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
        <div className="compact-header-logo" onClick={() => navigate('/')}>
          <Cannabis size={20} />
          <span>JOINTFACTORY.io</span>
        </div>

        <div className="compact-header-stats">
          <div className="compact-stat joints">
            <Cannabis size={12} />
            <span>{fmtNum(joints)}</span>
          </div>
          <div className="compact-stat sats">
            <Zap size={12} />
            <span>{fmtNum(sats)}</span>
          </div>
        </div>

        {!auth.isLoggedIn && (
          <button className="compact-login-btn" onClick={() => setShowLogin(true)}>
            <LogIn size={16} />
            <span>Login</span>
          </button>
        )}

        {auth.isLoggedIn && auth.displayName && (
          <div className="compact-user" onClick={() => navigate('/wallet')}>
            {auth.displayName.slice(0, 8)}
          </div>
        )}
      </header>

      {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}
    </>
  )
}
