const STORAGE_KEY = 'jf_theme'

export type Theme = 'dark' | 'light'

export function getTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'light' || stored === 'dark') return stored
  return 'dark'
}

export function setTheme(theme: Theme) {
  localStorage.setItem(STORAGE_KEY, theme)
  applyTheme(theme)
}

export function applyTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme)
}
