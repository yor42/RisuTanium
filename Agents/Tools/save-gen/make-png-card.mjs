// Synthetic PNG character cards for CHORE-322 (PNG card import timing). Plain Node ESM, no src/ imports, no dependency
// beyond node:zlib (crc32 needs Node 22.2 or newer).
//
//   node Agents/Tools/save-gen/make-png-card.mjs --out <dir outside the repo> --seed <n> --size small|medium|large|set5
//   node Agents/Tools/save-gen/make-png-card.mjs --verify <card.png> [--manifest <cards-manifest.json>]
//
// Writes card-<size>.png (set5: card-set5-1.png .. card-set5-5.png) and cards-manifest.json (file, bytes, assetCount, sha256,
// cardName and per-asset index, bytes, sha256). Sizes: small about 1 MB with 5 assets, medium about 20 MB with 10, large about
// 60 MB with 12 (every asset chunk is a few MiB, far below the 64 MiB value limit of readCardValue), set5 = five small cards
// with distinct card names. Same seed and size give byte-identical files.
//
// Format, copied from what the app's own PNG export writes (characterCards.ts exportCharacterCard with type png, and the
// StreamChunkWriter of pngChunk.ts) and from what the reader takes (pngCardImport.ts, pngChunk.ts): a PNG signature, IHDR, IDAT
// (a small generated image), then tEXt chunks, then IEND. Each asset is a tEXt chunk with the key `chara-ext-asset_:<index>`
// (index 0-based, in order; the reader strips both `chara-ext-asset_:` and `chara-ext-asset_`) whose value is the base64 of the
// asset bytes; the card is the last tEXt chunk, key `ccv3`, whose value is the base64 of the V3 card JSON. The card lists the
// assets as `{ type: 'x-risu-asset', uri: '__asset:<index>', name, ext: 'png' }` (the uri the export writes), so the import
// resolves every uri through an asset chunk. The V3 card field set follows the CharX card.json of the scratch phone-run fixtures
// (build-slowcard.mjs). Assets are PNGs (a 4x4 image plus one private ancillary 'ruSt' chunk of seeded random padding that sets
// the size), so every asset decodes as an image. The tool adds no key the reader does not know.
import { createHash, createCipheriv } from 'node:crypto'
import { crc32, deflateSync } from 'node:zlib'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const MB = 1000 * 1000
export const ASSET_KEY = 'chara-ext-asset_:'
export const CARD_KEY = 'ccv3'
export const SIZES = {
  small: { totalBytes: 1 * MB, assets: 5 },
  medium: { totalBytes: 20 * MB, assets: 10 },
  large: { totalBytes: 60 * MB, assets: 12 },
}
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])

const sha256Hex = (value) => createHash('sha256').update(value).digest('hex')
const sha256 = (value) => createHash('sha256').update(value).digest()
const u32be = (value) => { const out = Buffer.alloc(4); out.writeUInt32BE(value >>> 0); return out }

function chunk(type, body) {
  const typeBytes = Buffer.from(type, 'ascii')
  return Buffer.concat([u32be(body.length), typeBytes, body, u32be(crc32(body, crc32(typeBytes)))])
}
const textChunk = (key, value) => chunk('tEXt', Buffer.concat([Buffer.from(key, 'latin1'), Buffer.from([0]), value]))

function keystream(seedKey, size) {
  const digest = sha256(`risu-pngcard|${seedKey}`)
  const cipher = createCipheriv('aes-128-ctr', digest.subarray(0, 16), digest.subarray(16, 32))
  return cipher.update(Buffer.alloc(size))
}

function smallImage(seedKey, width, height) {
  const px = keystream(seedKey + '|px', width * height * 3)
  const raw = Buffer.alloc(height * (1 + width * 3))
  for (let row = 0; row < height; row++) px.copy(raw, row * (1 + width * 3) + 1, row * width * 3, (row + 1) * width * 3)
  return { ihdr: Buffer.concat([u32be(width), u32be(height), Buffer.from([8, 2, 0, 0, 0])]), idat: deflateSync(raw, { level: 9 }) }
}

/** An image asset of exactly `size` bytes: a valid 4x4 PNG whose private chunk 'ruSt' carries seeded random padding. */
export function makeAssetPng(seedKey, size) {
  const { ihdr, idat } = smallImage(seedKey, 4, 4)
  const head = Buffer.concat([PNG_SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', idat)])
  const iend = chunk('IEND', Buffer.alloc(0))
  const padBytes = size - head.length - 12 - iend.length
  if (padBytes < 0) throw new Error(`asset of ${size} bytes is smaller than its png frame`)
  return Buffer.concat([head, chunk('ruSt', keystream(seedKey + '|pad', padBytes)), iend])
}

function cardJson(name, assets) {
  return {
    spec: 'chara_card_v3', spec_version: '3.0',
    data: {
      name, description: 'Synthetic PNG card for import timing.', personality: '', scenario: '', first_mes: 'Hello.', mes_example: '',
      creator_notes: '', system_prompt: '', post_history_instructions: '', alternate_greetings: [], tags: ['synthetic'], creator: 'synthetic',
      character_version: '1', group_only_greetings: [], extensions: { risuai: {} },
      assets: assets.map((a) => ({ type: 'x-risu-asset', uri: `__asset:${a.index}`, name: `asset${a.index}`, ext: 'png' })),
    },
  }
}

/** One card: the bytes and the manifest entry. */
export function makeCard({ seed, tag, name, totalBytes, assetCount }) {
  const decodedEach = Math.floor(totalBytes / assetCount * 3 / 4 / 3) * 3
  const assets = Array.from({ length: assetCount }, (_, index) => {
    const bytes = makeAssetPng(`${seed}|${tag}|asset${index}`, decodedEach)
    return { index, bytes, sha256: sha256Hex(bytes) }
  })
  const { ihdr, idat } = smallImage(`${seed}|${tag}|image`, 16, 16)
  const parts = [PNG_SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', idat)]
  for (const asset of assets) parts.push(textChunk(ASSET_KEY + asset.index, Buffer.from(asset.bytes.toString('base64'), 'latin1')))
  parts.push(textChunk(CARD_KEY, Buffer.from(Buffer.from(JSON.stringify(cardJson(name, assets))).toString('base64'), 'latin1')))
  parts.push(chunk('IEND', Buffer.alloc(0)))
  const buffer = Buffer.concat(parts)
  return {
    buffer,
    entry: { bytes: buffer.length, assetCount, sha256: sha256Hex(buffer), cardName: name, assets: assets.map((a) => ({ index: a.index, bytes: a.bytes.length, sha256: a.sha256 })) },
  }
}

export function generate({ seed, size }) {
  const cards = []
  if (size === 'set5') {
    for (let n = 1; n <= 5; n++) {
      const card = makeCard({ seed, tag: `set5-${n}`, name: `C322 Set Card ${n}`, totalBytes: SIZES.small.totalBytes, assetCount: SIZES.small.assets })
      cards.push({ file: `card-set5-${n}.png`, ...card })
    }
  } else if (SIZES[size]) {
    cards.push({ file: `card-${size}.png`, ...makeCard({ seed, tag: size, name: `C322 ${size[0].toUpperCase()}${size.slice(1)} Card`, totalBytes: SIZES[size].totalBytes, assetCount: SIZES[size].assets }) })
  } else throw new Error('size must be small, medium, large or set5')
  const manifest = { format: 'risu-png-card-manifest/1', seed, size, cards: cards.map((c) => ({ file: c.file, ...c.entry })) }
  return { cards, manifest }
}

// ---- the verifier: an independent small PNG parser (its own CRC table, no zlib crc32) -----------------------------------------
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0 }
  return table
})()
function crcOf(bytes) {
  let c = 0xFFFFFFFF
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8)
  return (c ^ 0xFFFFFFFF) >>> 0
}
const CARD_VALUE_MAX_BYTES = 0x1FFFFFE8

/** Walks the chunks of a PNG card and reports every problem; `expected` is the manifest entry of this file, when known. */
export function verifyPng(buffer, expected = null) {
  const problems = []
  const note = (text) => problems.push(text)
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) { note('bad signature'); return { ok: false, problems } }
  let pos = 8
  let sawIhdr = false
  let sawIdat = false
  let sawIend = false
  let card = null
  const assets = new Map()
  const seen = []
  while (pos < buffer.length && !sawIend) {
    if (pos + 12 > buffer.length) { note(`truncated chunk header at ${pos}`); break }
    const length = buffer.readUInt32BE(pos)
    const type = buffer.subarray(pos + 4, pos + 8).toString('latin1')
    if (pos + 12 + length > buffer.length) { note(`chunk ${type} at ${pos} runs past the end`); break }
    const body = buffer.subarray(pos + 8, pos + 8 + length)
    const stored = buffer.readUInt32BE(pos + 8 + length)
    if (crcOf(buffer.subarray(pos + 4, pos + 8 + length)) !== stored) note(`crc mismatch in ${type} chunk at ${pos}`)
    seen.push(type)
    if (type === 'IHDR') sawIhdr = true
    else if (type === 'IDAT') sawIdat = true
    else if (type === 'IEND') sawIend = true
    else if (type === 'tEXt') {
      const zero = body.indexOf(0)
      const key = zero < 0 ? '' : body.subarray(0, zero).toString('latin1')
      const value = zero < 0 ? Buffer.alloc(0) : body.subarray(zero + 1)
      if (value.length > CARD_VALUE_MAX_BYTES) note(`value of ${key} is over the card value limit`)
      const text = value.toString('latin1')
      const decoded = Buffer.from(text, 'base64')
      if (decoded.toString('base64') !== text) note(`value of ${key} is not canonical base64`)
      if (key === CARD_KEY) {
        if (card !== null) note('more than one ccv3 chunk')
        try { card = JSON.parse(decoded.toString('utf8')) } catch { note('ccv3 value is not JSON') }
      } else if (key.startsWith(ASSET_KEY) && /^\d+$/.test(key.slice(ASSET_KEY.length))) {
        const index = Number(key.slice(ASSET_KEY.length))
        if (assets.has(index)) note(`asset ${index} twice`)
        assets.set(index, { bytes: decoded.length, sha256: sha256Hex(decoded) })
      } else note(`unknown tEXt key ${JSON.stringify(key)}`)
    }
    pos += 12 + length
  }
  if (!sawIhdr || !sawIdat) note('missing IHDR or IDAT')
  if (!sawIend) note('no IEND')
  else if (pos !== buffer.length) note('bytes after IEND')
  if (seen[0] !== 'IHDR') note('IHDR is not first')
  if (card === null) note('no ccv3 card')
  else {
    if (card.spec !== 'chara_card_v3') note('card spec is not chara_card_v3')
    const refs = (card.data?.assets ?? []).map((a) => a.uri)
    for (const uri of refs) {
      const match = /^__asset:(\d+)$/.exec(uri)
      if (!match || !assets.has(Number(match[1]))) note(`card asset uri ${uri} has no chunk`)
    }
    if (refs.length !== assets.size) note(`card lists ${refs.length} assets, file holds ${assets.size}`)
  }
  if (expected !== null) {
    if (expected.bytes !== buffer.length) note(`size ${buffer.length} differs from the manifest ${expected.bytes}`)
    if (expected.sha256 !== sha256Hex(buffer)) note('file sha256 differs from the manifest')
    if (expected.cardName !== card?.data?.name) note('card name differs from the manifest')
    if (expected.assetCount !== assets.size) note(`asset count ${assets.size} differs from the manifest ${expected.assetCount}`)
    for (const a of expected.assets) {
      const found = assets.get(a.index)
      if (!found || found.sha256 !== a.sha256 || found.bytes !== a.bytes) note(`asset ${a.index} differs from the manifest`)
    }
  }
  return { ok: problems.length === 0, problems, assetCount: assets.size, cardName: card?.data?.name ?? null }
}

function main() {
  const argv = process.argv.slice(2)
  const opt = { out: null, seed: 1, size: null, verify: null, manifest: null }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') opt.out = argv[++i]
    else if (argv[i] === '--seed') opt.seed = Number(argv[++i])
    else if (argv[i] === '--size') opt.size = argv[++i]
    else if (argv[i] === '--verify') opt.verify = argv[++i]
    else if (argv[i] === '--manifest') opt.manifest = argv[++i]
    else throw new Error('unknown argument ' + argv[i])
  }
  if (opt.verify) {
    const buffer = fs.readFileSync(opt.verify)
    let expected = null
    if (opt.manifest) {
      const manifest = JSON.parse(fs.readFileSync(opt.manifest, 'utf8'))
      expected = manifest.cards.find((c) => c.file === path.basename(opt.verify)) ?? null
      if (expected === null) { console.log(JSON.stringify({ ok: false, problems: ['file is not in the manifest'] })); process.exit(1) }
    }
    const result = verifyPng(buffer, expected)
    console.log(JSON.stringify(result))
    process.exit(result.ok ? 0 : 1)
  }
  if (!opt.out || !opt.size || !Number.isInteger(opt.seed)) throw new Error('usage: node make-png-card.mjs --out <dir> --seed <n> --size small|medium|large|set5 | --verify <png> [--manifest <json>]')
  const out = path.resolve(opt.out)
  const relative = path.relative(REPO_ROOT, out)
  if (relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)) throw new Error('--out must be outside the repository')
  const { cards, manifest } = generate({ seed: opt.seed, size: opt.size })
  fs.mkdirSync(out, { recursive: true })
  for (const card of cards) fs.writeFileSync(path.join(out, card.file), card.buffer)
  fs.writeFileSync(path.join(out, 'cards-manifest.json'), JSON.stringify(manifest, null, 2))
  console.log(JSON.stringify({ out, files: cards.map((c) => ({ file: c.file, bytes: c.entry.bytes, assets: c.entry.assetCount })) }))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
