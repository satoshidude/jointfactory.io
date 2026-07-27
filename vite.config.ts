import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The dev server used to proxy straight to production, so `npm run dev` played
// against the live database — unusable for testing game-logic changes, since
// every save would overwrite a real player's progress. Local API by default;
// set VITE_API_TARGET=https://jointfactory.io to look at live data read-only.
const API_TARGET = process.env.VITE_API_TARGET || 'http://localhost:3421'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  optimizeDeps: {
    include: ['nostr-tools', 'nostr-tools/pure', 'nostr-tools/nip19'],
  },
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
        secure: true,
      },
      '/ws': {
        target: API_TARGET,
        changeOrigin: true,
        secure: true,
        ws: true,
      },
    },
  },
})
