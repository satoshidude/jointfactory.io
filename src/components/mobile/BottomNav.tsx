import { useLocation, useNavigate } from 'react-router-dom'
import { Cannabis, Ticket, Wallet, Trophy, Info } from 'lucide-react'
import './BottomNav.css'

// Invite lost its tab and moved into Info: it is a page most players open once,
// and it was taking a fifth of the navigation. Ranking took the slot — three
// boards that used to be buried at the bottom of the Grow page.
const TABS = [
  { path: '/', icon: Cannabis, label: 'Grow' },
  { path: '/lottery', icon: Ticket, label: 'Lottery' },
  { path: '/wallet', icon: Wallet, label: 'Wallet' },
  { path: '/ranking', icon: Trophy, label: 'Ranking' },
  { path: '/info', icon: Info, label: 'Info' },
] as const

export default function BottomNav() {
  const location = useLocation()
  const navigate = useNavigate()
  const activePath = location.pathname

  return (
    <nav className="bottom-nav">
      {TABS.map(tab => {
        const isActive = activePath === tab.path
        return (
          <button
            key={tab.path}
            className={`bottom-nav-tab${isActive ? ' active' : ''}`}
            onClick={() => navigate(tab.path)}
          >
            {(() => { const Icon = tab.icon; return <Icon size={22} strokeWidth={isActive ? 2.5 : 1.5} /> })()}
            <span>{tab.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
