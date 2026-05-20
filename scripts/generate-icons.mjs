import { Resvg } from '@resvg/resvg-js'
import { readFileSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

const svg = readFileSync(resolve(root, 'public/icon.svg'), 'utf-8')

const sizes = [
  { name: 'pwa-192x192.png', size: 192 },
  { name: 'pwa-512x512.png', size: 512 },
  { name: 'apple-touch-icon.png', size: 180 }
]

for (const { name, size } of sizes) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: size }
  })
  const png = resvg.render().asPng()
  writeFileSync(resolve(root, 'public', name), png)
  console.log(`Generated public/${name} (${size}x${size})`)
}
