import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore', 'firebase/messaging', 'firebase/functions'],
          react: ['react', 'react-dom']
        }
      }
    }
  },
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      pwaAssets: {
        disabled: false,
        config: true,
      },
      registerType: 'autoUpdate',
      manifest: {
        name: 'Man Night Pizza',
        short_name: 'Man Night Pizza',
        description: 'Man Night Pizza',
        theme_color: '#2563eb',
        background_color: '#030712',
        display: 'standalone'
      }
    })
  ]
})
