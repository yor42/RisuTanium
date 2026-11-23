// Generates the Android launcher icon ("Night core", #643) from one layer spec, so the vector drawables,
// the legacy PNG mipmaps, the desktop master PNG and the preview sheet cannot drift apart.
//
//   node docs/design/system-surfaces/android/tools/make-icons.mjs [--master <path.png>]
//
// Writes the three adaptive layers into the Android res tree and into ../icons, the legacy mipmaps
// (API 24-25) into the res tree, the preview sheet into ../icons, and, with --master, a 1024 px
// rounded-square tile for `pnpm tauri icon <master> -o src-tauri/icons`.
// The mark's geometry is the branding mark (docs/branding/RisuTanium_Icon.svg), only scaled and placed.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../../../../..')
const RES = path.join(ROOT, 'src-tauri/gen/android/app/src/main/res')
const ICONS = path.resolve(HERE, '../icons')

// sharp is a transitive dependency: try a plain require, then each copy in the pnpm store.
function loadSharp() {
  const require = createRequire(path.join(ROOT, 'package.json'))
  try { return require('sharp') } catch {}
  const store = path.join(ROOT, 'node_modules/.pnpm')
  for (const n of fs.readdirSync(store).filter((n) => n.startsWith('sharp@')).sort().reverse()) {
    try { return require(path.join(store, n, 'node_modules/sharp')) } catch {}
  }
  throw new Error('sharp not found under ' + store)
}

// ---- tokens ----
const NIGHT = '#151836' // splash canvas, res/values/colors.xml splash_background
const NIGHT_LIT = '#26307A'
const TEAL = '#00A1AD'
const PERI = '#587BFF'
const CORE_A = '#3FE0E8'
const CORE_B = '#7C9BFF'

// ---- geometry ----
const OUTER = [[23.644035, 54.610103], [135.34471, 54.610103], [79.494373, 151.34528]]
const HOLE = [[49.460547, 69.515137], [109.5282, 69.515137], [79.494373, 121.5347]]
const STAR = [[79.494425, 151.34534], [23.644257, 54.609861], [135.344769, 54.609858]]
const CENTRE = STAR.map(([x, y]) => [0.20827472 * x + 62.937744, 0.20827472 * y + 68.765313])
const CX = 79.494373, CY = (54.610103 * 2 + 151.34528) / 3 // centroid of the outer triangle
// Mark width on the 108 dp canvas: every vertex 28.9 dp from the centre, inside the 33 dp safe radius.
const WIDTH = 50
const S = WIDTH / (OUTER[1][0] - OUTER[0][0])
const place = (pts) => pts.map(([x, y]) => [54 + (x - CX) * S, 54 + (y - CY) * S])
const r2 = (v) => Math.round(v * 100) / 100
const tri = (pts) => 'M' + pts.map(([x, y]) => `${r2(x)},${r2(y)}`).join(' L') + ' Z'
const outer = place(OUTER), hole = place(HOLE), core = place(CENTRE)
const SQUARE = 'M0,0 L108,0 L108,108 L0,108 Z'

// ---- layers: each path is { d, fill, evenOdd } where fill is a colour or a gradient ----
const stop = (offset, color, alpha = 1) => ({ offset, color, alpha })
export const LAYERS = {
  background: [
    { d: SQUARE, fill: { type: 'linear', x1: 0, y1: 18, x2: 0, y2: 90, stops: [stop(0, NIGHT), stop(1, NIGHT_LIT)] } },
    { d: SQUARE, fill: { type: 'radial', cx: 54, cy: 56, r: 40, stops: [stop(0, PERI, 0.6), stop(0.6, TEAL, 0.18), stop(1, TEAL, 0)] } },
  ],
  foreground: [
    { d: `${tri(outer)} ${tri(hole)}`, fill: '#FFFFFF', evenOdd: true },
    { d: tri(core), fill: { type: 'linear', x1: r2(core[1][0]), y1: r2(core[1][1]), x2: r2(core[0][0]), y2: r2(core[0][1]), stops: [stop(0, CORE_A), stop(1, CORE_B)] } },
  ],
  monochrome: [
    { d: `${tri(outer)} ${tri(hole)}`, fill: '#000000', evenOdd: true },
    { d: tri(core), fill: '#000000' },
  ],
}

// ---- VectorDrawable ----
const argb = (hex, a = 1) => '#' + Math.round(a * 255).toString(16).padStart(2, '0').toUpperCase() + hex.slice(1).toUpperCase()
function vdPath(p) {
  const attrs = [`android:pathData="${p.d}"`]
  if (p.evenOdd) attrs.push('android:fillType="evenOdd"')
  if (typeof p.fill === 'string') return `    <path\n        android:fillColor="${argb(p.fill)}"\n        ${attrs.join('\n        ')} />`
  const g = p.fill
  const geo = g.type === 'linear'
    ? `android:type="linear"\n                android:startX="${g.x1}"\n                android:startY="${g.y1}"\n                android:endX="${g.x2}"\n                android:endY="${g.y2}"`
    : `android:type="radial"\n                android:centerX="${g.cx}"\n                android:centerY="${g.cy}"\n                android:gradientRadius="${g.r}"`
  const items = g.stops.map((s) => `                <item android:offset="${s.offset}" android:color="${argb(s.color, s.alpha)}" />`).join('\n')
  return `    <path\n        ${attrs.join('\n        ')}>\n        <aapt:attr name="android:fillColor">\n            <gradient\n                ${geo}>\n${items}\n            </gradient>\n        </aapt:attr>\n    </path>`
}
const COMMENTS = {
  background: 'Launcher icon background layer: the splash canvas indigo, lit toward the bottom, with a teal/periwinkle glow under the mark that the launcher\'s layer parallax slides behind it.',
  foreground: 'Launcher icon foreground layer: the RisuTanium mark, every vertex 28.9 dp from the centre (inside the 33 dp safe radius), with the centre as a gradient core.',
  monochrome: 'Themed-icon layer (Android 13+): frame and solid centre; the system tints it.',
}
function vectorDrawable(name) {
  const paths = LAYERS[name]
  const aapt = paths.some((p) => typeof p.fill !== 'string')
  return `<?xml version="1.0" encoding="utf-8"?>\n<!-- ${COMMENTS[name]} Generated by docs/design/system-surfaces/android/tools/make-icons.mjs. -->\n<vector xmlns:android="http://schemas.android.com/apk/res/android"${aapt ? '\n    xmlns:aapt="http://schemas.android.com/aapt"' : ''}\n    android:width="108dp"\n    android:height="108dp"\n    android:viewportWidth="108"\n    android:viewportHeight="108">\n${paths.map(vdPath).join('\n')}\n</vector>\n`
}

// ---- SVG (same spec) ----
let gid = 0
function svgLayer(paths, defs, override) {
  return paths.map((p) => {
    let fill = override || p.fill
    if (typeof fill !== 'string') {
      const id = 'g' + gid++
      const st = fill.stops.map((s) => `<stop offset="${s.offset}" stop-color="${s.color}" stop-opacity="${s.alpha}"/>`).join('')
      defs.push(fill.type === 'linear'
        ? `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${fill.x1}" y1="${fill.y1}" x2="${fill.x2}" y2="${fill.y2}">${st}</linearGradient>`
        : `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${fill.cx}" cy="${fill.cy}" r="${fill.r}">${st}</radialGradient>`)
      fill = `url(#${id})`
    }
    return `<path d="${p.d}" fill="${fill}"${p.evenOdd ? ' fill-rule="evenodd"' : ''}/>`
  }).join('')
}

// Launcher masks over the 72 dp visible window (18..90).
function squircle(n = 5) {
  const pts = []
  for (let i = 0; i < 128; i++) {
    const t = (i / 128) * Math.PI * 2, c = Math.cos(t), s = Math.sin(t)
    pts.push(`${r2(54 + 36 * Math.sign(c) * Math.abs(c) ** (2 / n))},${r2(54 + 36 * Math.sign(s) * Math.abs(s) ** (2 / n))}`)
  }
  return 'M' + pts.join('L') + 'Z'
}
const roundRect = (x, y, w, r) => `M${x + r},${y}H${x + w - r}A${r},${r} 0 0 1 ${x + w},${y + r}V${y + w - r}A${r},${r} 0 0 1 ${x + w - r},${y + w}H${x + r}A${r},${r} 0 0 1 ${x},${y + w - r}V${y + r}A${r},${r} 0 0 1 ${x + r},${y}Z`
const MASKS = {
  circle: 'M54,18A36,36 0 1 1 54,90A36,36 0 1 1 54,18Z',
  squircle: squircle(),
  'rounded square': roundRect(18, 18, 72, 13),
  teardrop: 'M54,18A36,36 0 0 1 90,54V82A8,8 0 0 1 82,90H54A36,36 0 0 1 18,54A36,36 0 0 1 54,18Z',
}
const THEMED = { light: { bg: '#DCE1FF', fg: '#1E2A5E' }, dark: { bg: '#2B3458', fg: '#DCE1FF' } }

// One masked icon: the 72 dp window of the 108 canvas, drawn at size px.
function icon(mask, x, y, size, themed) {
  const defs = [], id = 'm' + gid++
  const body = themed
    ? `<rect width="108" height="108" fill="${themed.bg}"/>${svgLayer(LAYERS.monochrome, defs, themed.fg)}`
    : svgLayer(LAYERS.background, defs) + svgLayer(LAYERS.foreground, defs)
  return `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="18 18 72 72"><defs><clipPath id="${id}"><path d="${mask}"/></clipPath>${defs.join('')}</defs><g clip-path="url(#${id})">${body}</g></svg>`
}

function previewSheet() {
  const T = 150, G = 34
  const cols = ['circle', 'squircle', 'rounded square', 'teardrop', 'themed', '48 / 24 px', 'layers']
  const W = G + cols.length * (T + G), rowH = T + G, top = 50
  let body = cols.map((c, i) => `<text x="${G + i * (T + G) + T / 2}" y="32" text-anchor="middle" font-family="Segoe UI, Roboto, sans-serif" font-size="17" fill="#444">${c}</text>`).join('')
  ;['light', 'dark'].forEach((mode, mi) => {
    const y = top + G / 2 + mi * rowH
    body += `<rect x="0" y="${y - G / 2}" width="${W}" height="${rowH}" fill="url(#wall-${mode})"/>`
    cols.forEach((c, ci) => {
      const x = G + ci * (T + G)
      if (MASKS[c]) body += icon(MASKS[c], x, y, T)
      else if (c === 'themed') body += icon(MASKS.circle, x, y, T, THEMED[mode])
      else if (c === '48 / 24 px') body += icon(MASKS.circle, x, y + 51, 48, THEMED[mode]) + icon(MASKS.squircle, x + 51, y + 51, 48) + icon(MASKS.circle, x + 102, y + 63, 24)
      else {
        const defs = []
        const inner = mi === 0
          ? svgLayer(LAYERS.background, defs) + svgLayer(LAYERS.foreground, defs) + '<rect x="18" y="18" width="72" height="72" fill="none" stroke="#ff2d55" stroke-width="0.6" stroke-dasharray="2 1.5"/>'
          : '<rect width="108" height="108" fill="#888"/>' + svgLayer(LAYERS.monochrome, defs)
        body += `<svg x="${x}" y="${y}" width="${T}" height="${T}" viewBox="0 0 108 108"><defs>${defs.join('')}</defs>${inner}<circle cx="54" cy="54" r="33" fill="none" stroke="#ffd60a" stroke-width="0.6"/></svg>`
      }
    })
  })
  const H = top + 2 * rowH + 10
  const wall = (k, a, b) => `<linearGradient id="wall-${k}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs>${wall('light', '#F3EEE4', '#C9D4E3')}${wall('dark', '#121318', '#2C3140')}</defs><rect width="${W}" height="${H}" fill="#fafafa"/>${body}</svg>`
}

// A full-canvas raster of a mask over the 72 dp window (legacy mipmaps, desktop master).
const tileSvg = (size, mask) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">${icon(mask, 0, 0, size)}</svg>`
function layerSvg(size, name) {
  const defs = []
  const body = svgLayer(LAYERS[name], defs)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 108 108"><defs>${defs.join('')}</defs>${body}</svg>`
}

async function main() {
  const sharp = loadSharp()
  const png = (svg, out) => sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(out)
  for (const name of ['background', 'foreground', 'monochrome']) {
    const xml = vectorDrawable(name)
    fs.writeFileSync(path.join(RES, `drawable/ic_launcher_${name}.xml`), xml)
    fs.writeFileSync(path.join(ICONS, `ic_launcher_${name}.xml`), xml)
  }
  // Legacy launchers (API 24-25) draw the PNG as is: a rounded square, and a circle for the round icon.
  const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 }
  for (const [d, k] of Object.entries(DENSITIES)) {
    const dir = path.join(RES, `mipmap-${d}`)
    await png(tileSvg(48 * k, MASKS['rounded square']), path.join(dir, 'ic_launcher.png'))
    await png(tileSvg(48 * k, MASKS.circle), path.join(dir, 'ic_launcher_round.png'))
    await png(layerSvg(108 * k, 'foreground'), path.join(dir, 'ic_launcher_foreground.png'))
  }
  const sheet = previewSheet()
  fs.writeFileSync(path.join(ICONS, 'launcher-night-core-preview.svg'), sheet)
  await png(sheet, path.join(ICONS, 'launcher-night-core-preview.png'))
  const mi = process.argv.indexOf('--master')
  if (mi > 0) await png(tileSvg(1024, roundRect(18, 18, 72, 72 * 58 / 512)), process.argv[mi + 1])
}
await main()
