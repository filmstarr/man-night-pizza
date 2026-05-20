import { createAppleSplashScreens, defineConfig } from '@vite-pwa/assets-generator/config'

export default defineConfig({
  headLinkOptions: {
      preset: '2023',
  },
  preset: {
      transparent: {
        sizes: [64, 192, 512],
        favicons: [[48, 'favicon.ico']],
      },
      maskable: {
        sizes: [512],
        resizeOptions:{
          background: '#030712',
        },
      },
      apple: {
        sizes: [180],
        resizeOptions:{
          background: '#030712',
        },
      },
      appleSplashScreens: createAppleSplashScreens({
          resizeOptions:{
            background: '#030712',
          },
          name: (landscape, size) => {
              return `apple-splash-${landscape ? 'landscape' : 'portrait'}-${size.width}x${size.height}.png`
          }
      })
  },
  images: ['public/logo.png']
})
