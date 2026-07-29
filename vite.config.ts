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
        configure: (proxy) => {
          // Restarting the API server closes the upstream socket mid-write. The
          // resulting EPIPE is unhandled by default and takes the whole dev
          // server down, so every backend restart also killed Vite.
          proxy.on('error', (err: Error) => {
            console.warn('[vite] ws proxy:', err.message)
          })
        },
      },
    },
  },
})
