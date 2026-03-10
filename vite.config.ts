import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

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
