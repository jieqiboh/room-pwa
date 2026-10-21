import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    svelte(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Shutter',
        short_name: 'Shutter',
        description: 'Open, close and stop the roller shutter.',
        theme_color: '#1f2937',
        background_color: '#111827',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        // Cache the shell's scripts, styles and icons only. Page loads always go to
        // the network so an expired Access session reaches the sign-in page, and
        // /api is never cached: a stale "last sent" would be worse than none.
        globPatterns: ['**/*.{js,css,png,svg,webmanifest}'],
        navigateFallback: null,
      },
    }),
  ],
  // `npm run dev` for the UI, with `wrangler dev` (port 8787) serving the API.
  server: { proxy: { '/api': 'http://localhost:8787' } },
})
