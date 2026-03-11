import { useLocation, useNavigate } from 'react-router-dom'
import { Cannabis, BarChart3, Ticket, Wallet, Menu } from 'lucide-react'
import { useState } from 'react'
import './BottomNav.css'

const TABS = [
  { path: '/', icon: Cannabis, label: 'Grow' },
  { path: '/dashboard', icon: BarChart3, label: 'Stats' },
  { path: '/lottery', icon: Ticket, label: 'Lottery' },
  { path: '/wallet', icon: Wallet, label: 'Wallet' },
  { path: '#more', icon: Menu, label: 'More' },
] as const

const MORE_ITEMS = [
  { path: '/invite', label: 'Invite Friends' },
  { path: '/info', label: 'How to Play' },
]

export default function BottomNav() {
  const location = useLocation()
  const navigate = useNavigate()
  const [showMore, setShowMore] = useState(false)

  const activePath = location.pathname

  function handleTab(path: string) {
    if (path === '#more') {
      setShowMore(v => !v)
    } else {
      setShowMore(false)
      navigate(path)
    }
  }

  const isMoreActive = MORE_ITEMS.some(m => activePath === m.path)

  return (
    <>
      {showMore && (
        <div className="more-overlay" onClick={() => setShowMore(false)}>
          <div className="more-sheet" onClick={e => e.stopPropagation()}>
            {MORE_ITEMS.map(item => (
              <button
                key={item.path}
                className={`more-item${activePath === item.path ? ' active' : ''}`}
                onClick={() => { navigate(item.path); setShowMore(false) }}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <nav className="bottom-nav">
        {TABS.map(tab => {
          const isActive = tab.path === '#more'
            ? isMoreActive || showMore
            : activePath === tab.path
          return (
            <button
              key={tab.path}
              className={`bottom-nav-tab${isActive ? ' active' : ''}`}
              onClick={() => handleTab(tab.path)}
            >
              <tab.icon size={22} strokeWidth={isActive ? 2.5 : 1.5} />
              <span>{tab.label}</span>
            </button>
          )
        })}
      </nav>
    </>
  )
}
