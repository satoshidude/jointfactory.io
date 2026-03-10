import { NavLink } from 'react-router-dom'
import { Gamepad2, LayoutDashboard, Trophy } from 'lucide-react'

const navItems = [
  { label: 'Dashboard', icon: LayoutDashboard, path: '/' },
  { label: 'Game', icon: Gamepad2, path: '/game' },
  { label: 'Leaderboard', icon: Trophy, path: '/leaderboard' },
]

export default function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="logo">
          <Gamepad2 size={18} color="white" />
        </div>
        <h1>JointFactory</h1>
      </div>
      <nav className="sidebar-nav">
        <div className="sidebar-section">
          <div className="sidebar-section-title">Menu</div>
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
              end={item.path === '/'}
            >
              <item.icon />
              {item.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </aside>
  )
}
