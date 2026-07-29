import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The dev server used to proxy straight to production, so `npm run dev` played
// against the live database — unusable for testing game-logic changes, since
// every save would overwrite a real player's progress. Local API by default;
// set VITE_API_TARGET=https://jointfactory.io to look at live data read-only.
const API_TARGET = process.env.VITE_API_TARGET || 'http://localhost:3421'

// Restarting the API server kills the dev server: the upgraded websocket is
// written to after the upstream is gone, and the EPIPE escapes every handler
// the proxy exposes — attaching to `error`, `econnreset`, `proxyReqWs` and
// `open` all still left it fatal. This file only ever runs in dev and build, so
// swallowing exactly that error class is contained; anything else still throws.
process.on('uncaughtException', (err: NodeJS.ErrnoException) => {
  if (err?.code === 'EPIPE' || err?.code === 'ECONNRESET') {
    console.warn('[vite] ignored socket error from the API proxy:', err.code)
    return
  }
  throw err
})

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
    // Vite rejects Host headers it does not know (DNS-rebinding protection), so
    // reaching the dev server from another machine over its mDNS name returned
    // 403 while the bare IP worked. Allowing .local covers the LAN case without
    // opening it to arbitrary hostnames.
    allowedHosts: ['.local'],
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
          // Restarting the API server closes the upstream socket mid-write and
          // the resulting EPIPE took the whole dev server down on every backend
          // restart. Both ends need a handler: the proxy for connection errors,
          // and each upgraded socket for write errors after the upgrade — the
          // latter is where the fatal one came from.
          const quiet = (what: string) => (err: Error) => {
            console.warn(`[vite] ws ${what}:`, err.message)
          }
          proxy.on('error', quiet('proxy'))
          proxy.on('econnreset', quiet('reset'))
          proxy.on('proxyReqWs', (proxyReq, _req, socket) => {
            proxyReq.on('error', quiet('upstream'))
            socket.on('error', quiet('client'))
          })
          proxy.on('open', (socket) => socket.on('error', quiet('upstream socket')))
        },
      },
    },
  },
})
