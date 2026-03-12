import type { ReactNode } from 'react'
import { Heart, Box } from 'lucide-react'
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
        <footer className="mobile-footer">
          <p>
            released at{' '}
            <a href="https://mempool.space/block/940329" target="_blank" rel="noopener noreferrer"><Box size={11} className="mobile-footer-block" /> <strong>940329</strong></a>
            {' '}with <Heart size={12} fill="#ff4444" className="mobile-footer-heart" /> 4 cyberspace
          </p>
        </footer>
      </main>
    </div>
  )
}
