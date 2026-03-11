import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Cannabis, Ticket, Wallet, UserPlus, User, LogIn, Info, Menu, X } from 'lucide-react'
import { useAuth } from '../../stores/authStore'
import LoginModal from '../LoginModal'
import './DrawerNav.css'

const TABS = [
  { path: '/', icon: Cannabis, label: 'Grow' },
  { path: '/lottery', icon: Ticket, label: 'Lottery' },
  { path: '/wallet', icon: Wallet, label: 'Wallet' },
  { path: '/invite', icon: UserPlus, label: 'Invite' },
  { path: '/profile', icon: User, label: 'Account' },
  { path: '/info', icon: Info, label: 'Info' },
]

export default function DrawerNav() {
  const [open, setOpen] = useState(false)
  const [showLogin, setShowLogin] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const { isLoggedIn } = useAuth()

  function handleTap(tab: typeof TABS[number]) {
    if (tab.path === '/profile' && !isLoggedIn) {
      setOpen(false)
      setShowLogin(true)
    } else {
      navigate(tab.path)
      setOpen(false)
    }
  }

  return (
    <>
      <button className="drawer-toggle" onClick={() => setOpen(true)} aria-label="Menu">
        <Menu size={24} />
      </button>

      {/* Backdrop */}
      <div
        className={`drawer-backdrop${open ? ' open' : ''}`}
        onClick={() => setOpen(false)}
      />

      {/* Drawer panel */}
      <nav className={`drawer-panel${open ? ' open' : ''}`}>
        <div className="drawer-panel-header">
          <span className="drawer-panel-title">Menu</span>
          <button className="drawer-close" onClick={() => setOpen(false)} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <div className="drawer-links">
          {TABS.filter(tab => tab.path !== '/profile' || isLoggedIn).map(tab => {
            const isActive = location.pathname === tab.path
            return (
              <button
                key={tab.path}
                className={`drawer-link${isActive ? ' active' : ''}`}
                onClick={() => handleTap(tab)}
              >
                <tab.icon size={20} strokeWidth={isActive ? 2.5 : 1.5} />
                <span>{tab.label}</span>
              </button>
            )
          })}
        </div>
      </nav>

      {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}
    </>
  )
}
