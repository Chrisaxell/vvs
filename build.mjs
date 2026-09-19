// Bundles TS entry points into single self-contained JS files.
// Content scripts MUST NOT contain ES imports — Chrome loads them as classic
// scripts. Background & popup are bundled too so we ship one file per entry.

import * as esbuild from 'esbuild'
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs'
import sharp from 'sharp'

const entries = [
  { in: 'src/background.ts',            out: 'dist/background.js',            format: 'esm'  },
  { in: 'src/content/systembolaget.ts', out: 'dist/content/systembolaget.js', format: 'iife' },
  { in: 'src/content/vinmonopolet.ts',  out: 'dist/content/vinmonopolet.js',  format: 'iife' },
  { in: 'src/popup/popup.ts',           out: 'dist/popup/popup.js',           format: 'esm'  },
]

const watch = process.argv.includes('--watch')

async function run() {
  for (const e of entries) {
    const opts = {
      entryPoints: [e.in],
      outfile: e.out,
      bundle: true,
      format: e.format,
      target: 'chrome114',
      platform: 'browser',
      sourcemap: 'linked',
      logLevel: 'info',
    }
    if (watch) {
      const ctx = await esbuild.context(opts)
      await ctx.watch()
    } else {
      await esbuild.build(opts)
    }
  }
  // Rasterize the source SVG to the four PNG sizes Chrome expects.
  mkdirSync('dist/icons', { recursive: true })
  const svg = readFileSync('src/icons/icon.svg')
  await Promise.all(
    [16, 32, 48, 128].map((size) =>
      sharp(svg)
        .resize(size, size)
        .png({ compressionLevel: 9 })
        .toFile(`dist/icons/icon-${size}.png`),
    ),
  )


  // Copy static assets that esbuild doesn't touch.
  mkdirSync('dist/popup', { recursive: true })
  copyFileSync('src/manifest.json', 'dist/manifest.json')
  copyFileSync('src/rules.json', 'dist/rules.json')
  copyFileSync('src/popup/popup.html', 'dist/popup/popup.html')
  copyFileSync('src/popup/popup.css', 'dist/popup/popup.css')

  if (watch) {
    console.log('[vvs] watching for changes… (assets copied once, edit them and re-run to sync)')
  } else {
    console.log('[vvs] build complete → dist/')
  }
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})

