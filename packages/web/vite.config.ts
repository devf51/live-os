import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const API = 'http://127.0.0.1:3000'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      manifest: {
        name: 'live os',
        short_name: 'live os',
        lang: 'th',
        start_url: '/',
        display: 'standalone',
        theme_color: '#5b8d7a',
        background_color: '#f6f4ef',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
    }),
  ],
  // dev only: the client calls same-origin paths exactly as the server routes
  server: { proxy: Object.fromEntries(['/auth', '/settings', '/push', '/today', '/summary', '/habits', '/chat'].map((p) => [p, API])) },
})
