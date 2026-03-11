import type { ReactNode } from 'react'
import CompactHeader from './CompactHeader'
import BottomNav from './BottomNav'
import './MobileLayout.css'

export default function MobileLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mobile-layout">
      <CompactHeader />
      <main className="mobile-content">
        {children}
      </main>
      <BottomNav />
      <span className="mobile-version">v0.2</span>
    </div>
  )
}
