import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import AuthProvider from './stores/AuthProvider'
import { getTheme, applyTheme } from './stores/themeStore'
import './index.css'

applyTheme(getTheme())
import AppDesktop from './AppDesktop.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <AppDesktop />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
