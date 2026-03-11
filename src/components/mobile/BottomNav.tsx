import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Cannabis, Ticket, Wallet, UserPlus, User, LogIn } from 'lucide-react'
import { useAuth } from '../../stores/authStore'
import LoginModal from '../LoginModal'
import './BottomNav.css'

const TABS = [
  { path: '/', icon: Cannabis, label: 'Grow' },
  { path: '/lottery', icon: Ticket, label: 'Lottery' },
  { path: '/wallet', icon: Wallet, label: 'Wallet' },
  { path: '/invite', icon: UserPlus, label: 'Invite' },
  { path: '/profile', icon: User, label: 'Account' },
] as const

export default function BottomNav() {
  const location = useLocation()
  const navigate = useNavigate()
  const activePath = location.pathname
  const { isLoggedIn } = useAuth()
  const [showLogin, setShowLogin] = useState(false)

  return (
    <>
      <nav className="bottom-nav">
        {TABS.map(tab => {
          const isActive = activePath === tab.path
          const isProfileTab = tab.path === '/profile'
          const icon = isProfileTab && !isLoggedIn ? LogIn : tab.icon
          const label = isProfileTab && !isLoggedIn ? 'Login' : tab.label
          return (
            <button
              key={tab.path}
              className={`bottom-nav-tab${isActive ? ' active' : ''}`}
              onClick={() => isProfileTab && !isLoggedIn ? setShowLogin(true) : navigate(tab.path)}
            >
              {(() => { const Icon = icon; return <Icon size={22} strokeWidth={isActive ? 2.5 : 1.5} /> })()}
              <span>{label}</span>
            </button>
          )
        })}
      </nav>
      {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}
    </>
  )
}
