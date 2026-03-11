import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// build:dev uses index.html (mobile App.tsx)
// build uses index-desktop.html (desktop AppDesktop.tsx)
const isDevBuild = process.argv.includes('dist-dev')

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      input: isDevBuild ? 'index.html' : 'index-desktop.html',
    },
  },
  optimizeDeps: {
    include: ['nostr-tools', 'nostr-tools/pure', 'nostr-tools/nip19'],
  },
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: 'https://jointfactory.nsnip.io',
        changeOrigin: true,
        secure: true,
      },
      '/ws': {
        target: 'https://jointfactory.nsnip.io',
        changeOrigin: true,
        secure: true,
        ws: true,
      },
    },
  },
})
