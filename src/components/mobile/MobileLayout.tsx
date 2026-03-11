import type { ReactNode } from 'react'
import CompactHeader from './CompactHeader'
import BottomNav from './BottomNav'
import './MobileLayout.css'

export default function MobileLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mobile-layout">
      <div className="mobile-top-bar">
        <CompactHeader />
        <BottomNav />
      </div>
      <main className="mobile-content">
        {children}
      </main>
    </div>
  )
}
