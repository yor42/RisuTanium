// Shaped, importable .bin fixtures for CHORE-04 (chat body rendering at character level and chat level). Plain Node ESM, no
// src/ imports. Synthetic data only.
//
//   node Agents/Tools/save-gen/make-c04-fixture.mjs --out <dir outside the repo> --seed <n> --weight light|heavy|both --background on|off [--asset-mib 12]
//
// Writes c04-light.bin and/or c04-heavy.bin and c04-manifest.json into <out>. Each .bin holds two characters with one 30-message
// chat each: "C04 Character-Level" lists its modules on the character, "C04 Chat-Level" lists them on the chat. Modules (the
// same ids and bodies in both bins and in both weights; only the message text differs between weights):
//   regex-heavy-1, regex-heavy-2  40 scripts each, mixed editdisplay and editprocess, patterns match words every message holds
//                                 (class regex-affecting-display); the output is the match itself ($&), so the display text
//                                 is unchanged and the cost measured is the regex work
//   regex-heavy-3                 40 editprocess scripts only (class prompt-only-regex)
//   asset-1, asset-2              embedded PNG assets, --asset-mib MiB each (default 12, the FX\mod12 size; class asset-bearing)
//   background-embedding          a backgroundEmbedding style plus a static div (class backgroundEmbedding)
//   hide-icon                     hideIcon: true (class hideIcon)
//   plain                         no scripts and no assets (class plain)
//   disabled-1 .. disabled-20     plain modules no character or chat lists and enabledModules does not list (class disabled)
// Character-level list: regex-heavy-1, regex-heavy-2, asset-1, background-embedding, plain. Chat-level list: regex-heavy-3,
// asset-2, hide-icon. --background on also gives the character-level character a backgroundHTML (a fixed style plus a div).
// Light message: one short paragraph with bold, emphasis and code (about 13 DOM nodes). Heavy message: about 3 KB with a long
// paragraph, a nested list with bold items and a 4x4 table, about 121 DOM nodes. The node counts are built by construction
// (nodesOfHeavy / nodesOfLight below) and are estimates, not measurements of the rendered page. Messages are markdown only: no
// HTML for the sanitizer to treat differently between runs.
//
// File shape (copied from synth-bin-gen.mjs, which has no exports): [u32 LE name length][name][u32 LE data length][data] per
// entry, assets first, database.risudat last; database.risudat is the 11-byte header [0,'RISUSAVE',0,8] followed by
// fflate.compressSync(msgpackr.encode(db), { mtime: 0 }). The database root, character and module field sets follow
// buildDatabase of synth-bin-gen.mjs; the module list with backgroundEmbedding and the chat naming modules follow the shapes
// of the scratch c556 and c609 fixture makers (make-fixture.mjs, make-c609-fixture.mjs). Image assets are 4x4 RGB PNGs with
// one private ancillary 'ruSt' chunk of seeded random padding, as in synth-bin-gen.mjs. Same seed, weight, background and
// asset size give byte-identical files.
import { createRequire } from 'node:module'
import { createHash, createCipheriv } from 'node:crypto'
import { crc32 } from 'node:zlib'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const requireFromRepo = createRequire(path.join(REPO_ROOT, 'package.json'))
// msgpackr 1.10.1 asks Buffer.utf8Write for more bytes than the buffer has left; this Node throws on that where older
// versions clamped. The clamp restores the older behaviour and changes no byte of the output.
const nativeUtf8Write = Buffer.prototype.utf8Write
Buffer.prototype.utf8Write = function (text, position, length) { return nativeUtf8Write.call(this, text, position, Math.min(length, this.length - position)) }
const { Packr } = requireFromRepo('msgpackr/index-no-eval')
const fflate = requireFromRepo('fflate')

export const MESSAGES_PER_CHAT = 30
const MIB = 1024 * 1024
const T = 1700000000000
const DATABASE_HEADER = Uint8Array.of(0, 82, 73, 83, 85, 83, 65, 86, 69, 0, 8)
const VOCAB = ['alpha', 'bravo', 'cobalt', 'delta', 'ember', 'fjord', 'garnet', 'harbor']
const FILLER = ['amber', 'birch', 'cedar', 'dune', 'elm', 'fern', 'glen', 'heath', 'iris', 'juniper', 'kelp', 'larch', 'moss', 'nettle', 'oak', 'pine']
const SETTINGS_VALUES = {
  didFirstSetup: true, promptInfoInsideChat: false, username: 'Synthetic User', personaPrompt: 'Synthetic persona prompt.', userNote: 'Synthetic user note.',
  language: 'en', temperature: 80, maxContext: 4000, maxResponse: 500, iconsize: 100, zoomsize: 100, swipe: true, autoTranslate: false, theme: '',
  textTheme: 'standard', loreBookDepth: 5, loreBookToken: 800, selectedPersona: 0, botPresetsId: 0, globalNote: 'Synthetic global note.',
  additionalPrompt: 'Synthetic additional prompt.', descriptionPrefix: 'Synthetic description prefix: ', customCSS: '', globalChatVariables: {},
}

function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const sha256Hex = (value) => createHash('sha256').update(value).digest('hex')
const sha256 = (value) => createHash('sha256').update(value).digest()

function makeUuid(rnd) {
  const hex = (n) => Array.from({ length: n }, () => '0123456789abcdef'[Math.floor(rnd() * 16)]).join('')
  return `${hex(8)}-${hex(4)}-4${hex(3)}-8${hex(3)}-${hex(12)}`
}

// ---- assets: 4x4 RGB PNG plus a private padding chunk ---------------------------------------------------------------------
const u32be = (value) => { const out = Buffer.alloc(4); out.writeUInt32BE(value >>> 0); return out }
const pngChunk = (type, data) => {
  const typeBytes = Buffer.from(type, 'ascii')
  return Buffer.concat([u32be(data.length), typeBytes, data, u32be(crc32(data, crc32(typeBytes)))])
}
function keystream(seedKey, size) {
  const digest = sha256(`risu-c04|${seedKey}`)
  const cipher = createCipheriv('aes-128-ctr', digest.subarray(0, 16), digest.subarray(16, 32))
  return cipher.update(Buffer.alloc(size))
}
function makePng(seedKey, size) {
  const pixels = Buffer.concat([sha256(`${seedKey}|px0`), sha256(`${seedKey}|px1`)])
  const raw = Buffer.alloc(4 * 13)
  for (let row = 0; row < 4; row++) pixels.copy(raw, row * 13 + 1, row * 12, row * 12 + 12)
  const ihdr = Buffer.concat([u32be(4), u32be(4), Buffer.from([8, 2, 0, 0, 0])])
  const head = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), pngChunk('IHDR', ihdr), pngChunk('IDAT', Buffer.from(fflate.zlibSync(raw, { level: 9 })))])
  const iend = Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82])
  const padBytes = size - head.length - 12 - iend.length
  if (padBytes < 0) throw new Error(`png asset of ${size} bytes is smaller than its frame`)
  return Buffer.concat([head, pngChunk('ruSt', keystream(seedKey, padBytes)), iend])
}

// ---- message text, with the DOM node count built alongside ------------------------------------------------------------
// Inline segments: ['plain'|'b'|'i'|'code', text]. A plain segment is one text node; the others are an element and its text.
const inlineMd = (segments) => segments.map(([kind, text]) => (kind === 'b' ? `**${text}**` : kind === 'i' ? `*${text}*` : kind === 'code' ? `\`${text}\`` : text)).join('')
const inlineNodes = (segments) => segments.reduce((sum, [kind]) => sum + (kind === 'plain' ? 1 : 2), 0)

export function lightMessage(index) {
  const segments = [['b', VOCAB[index % 8]], ['plain', ` reply ${index}, `], ['i', VOCAB[(index + 3) % 8]], ['plain', ' and '], ['code', VOCAB[(index + 5) % 8]], ['plain', ' and '], ['b', VOCAB[(index + 6) % 8]], ['plain', ` marks [T${index % 8}].`]]
  return { text: inlineMd(segments), nodes: 1 + inlineNodes(segments) }
}

export function heavyMessage(index, rnd) {
  const words = (count) => Array.from({ length: count }, () => FILLER[Math.floor(rnd() * FILLER.length)]).join(' ')
  const all = VOCAB.join(' ')
  // pad the long paragraph until the whole message passes 2.9 KB; the padding is one plain text node and adds no element
  const build = (pad) => {
    const paragraph = [['plain', `Heavy ${index}: ${all} ${pad} `], ['b', VOCAB[index % 8]], ['plain', ' then '], ['i', VOCAB[(index + 1) % 8]], ['plain', ' and '], ['b', VOCAB[(index + 2) % 8]], ['plain', ' and '], ['i', VOCAB[(index + 3) % 8]], ['plain', ` end [T${index % 8}].`]]
    let nodes = 1 + inlineNodes(paragraph)
    const blocks = [inlineMd(paragraph)]
    const list = []
    nodes += 1 // outer ul
    for (let item = 0; item < 4; item++) {
      const head = [['plain', 'item '], ['b', `${VOCAB[(index + item) % 8]}`], ['plain', ` ${words(3)}`]]
      nodes += 1 + inlineNodes(head) + 1 // li, inline content, nested ul
      list.push(`- ${inlineMd(head)}`)
      for (let sub = 0; sub < 2; sub++) {
        const subSegments = [['plain', `sub ${words(2)} `], ['b', VOCAB[(index + item + sub) % 8]]]
        nodes += 1 + inlineNodes(subSegments)
        list.push(`  - ${inlineMd(subSegments)}`)
      }
    }
    blocks.push(list.join('\n'))
    const columns = 4
    const rows = []
    rows.push(`| ${Array.from({ length: columns }, (_, c) => `h${c}`).join(' | ')} |`)
    rows.push(`| ${Array.from({ length: columns }, () => '---').join(' | ')} |`)
    nodes += 1 + 1 + 1 + columns * 2 + 1 // table, thead, tr, th cells with text, tbody
    for (let row = 0; row < 4; row++) {
      rows.push(`| ${Array.from({ length: columns }, (_, c) => `${VOCAB[(row + c) % 8]}`).join(' | ')} |`)
      nodes += 1 + columns * 2
    }
    blocks.push(rows.join('\n'))
    return { text: blocks.join('\n\n'), nodes }
  }
  let pad = words(120)
  let built = build(pad)
  while (Buffer.byteLength(built.text) < 2900) { pad += ' ' + words(20); built = build(pad) }
  return built
}

export const nodesOfLight = (index) => lightMessage(index).nodes

// ---- the database ------------------------------------------------------------------------------------------------------------
function buildModules(seed, assetMiB, withBytes) {
  const rnd = mulberry32((seed ^ 0xC04C04) >>> 0)
  const make = (key, name, cls) => ({ key, class: cls, module: { id: makeUuid(rnd), name, description: `c04 synthetic module ${key}`, lorebook: [], regex: [], trigger: [], assets: [] } })
  const modules = []
  const scripts = (kinds, tag) => Array.from({ length: 40 }, (_, k) => ({
    comment: `${tag}-${k}`, in: `\\b${VOCAB[k % 8]}\\b`, out: '$&', type: kinds[k % kinds.length], flag: 'g',
  }))
  for (const [n, kinds, cls] of [[1, ['editdisplay', 'editprocess'], 'regex-affecting-display'], [2, ['editdisplay', 'editprocess'], 'regex-affecting-display'], [3, ['editprocess'], 'prompt-only-regex']]) {
    const m = make(`regex-heavy-${n}`, `C04 Regex Heavy ${n}`, cls)
    m.module.regex = scripts(kinds, `rh${n}`)
    modules.push(m)
  }
  const assets = []
  for (const n of [1, 2]) {
    const m = make(`asset-${n}`, `C04 Asset Module ${n}`, 'asset-bearing')
    const count = Math.max(1, Math.ceil(assetMiB / 2))
    const each = Math.max(512, Math.floor(assetMiB * MIB / count))
    for (let a = 0; a < count; a++) {
      const png = withBytes ? makePng(`${seed}|asset-${n}|${a}`, each) : null
      const name = png ? `${sha256Hex(png)}.png` : `${'0'.repeat(64)}.png`
      m.module.assets.push([`c04-asset-${n}-${a}`, `assets/${name}`, 'png'])
      if (png) assets.push({ name, bytes: png })
    }
    modules.push(m)
  }
  const bg = make('background-embedding', 'C04 Background Embedding', 'backgroundEmbedding')
  bg.module.backgroundEmbedding = '<style>.c04-embed{position:fixed;right:8px;bottom:8px;padding:4px 8px;background:#e0a000;color:#000;font-size:12px;z-index:5}</style><div class="c04-embed" data-c04="embed">c04 module embedding</div>'
  modules.push(bg)
  const hide = make('hide-icon', 'C04 Hide Icon', 'hideIcon')
  hide.module.hideIcon = true
  modules.push(hide)
  modules.push(make('plain', 'C04 Plain', 'plain'))
  for (let d = 1; d <= 20; d++) modules.push(make(`disabled-${d}`, `C04 Disabled ${d}`, 'disabled'))
  return { modules, assets }
}

const CHARACTER_LEVEL_KEYS = ['regex-heavy-1', 'regex-heavy-2', 'asset-1', 'background-embedding', 'plain']
const CHAT_LEVEL_KEYS = ['regex-heavy-3', 'asset-2', 'hide-icon']

function buildDatabase(seed, weight, background, modules) {
  const rnd = mulberry32((seed ^ (weight === 'light' ? 0x11111111 : 0x22222222)) >>> 0)
  const ids = mulberry32((seed ^ 0xD00D) >>> 0)
  const idOf = (key) => modules.find((m) => m.key === key).module.id
  const makeChat = (id, name, extra) => {
    const sizes = []
    const message = Array.from({ length: MESSAGES_PER_CHAT }, (_, m) => {
      const built = weight === 'light' ? lightMessage(m) : heavyMessage(m, rnd)
      sizes.push(Buffer.byteLength(built.text))
      return { role: m % 2 === 0 ? 'char' : 'user', data: built.text, time: T + m * 60000 }
    })
    return { chat: { id, name, note: '', localLore: [], message, ...extra }, sizes }
  }
  const makeCharacter = (name, level, chat, extra) => ({
    type: 'character', chaId: makeUuid(ids), name, chatPage: 0, firstMsgIndex: -1, lastInteraction: T + (level === 'character' ? 1000 : 2000),
    desc: 'c04 synthetic character', firstMessage: 'Hello.', notes: '', alternateGreetings: [], image: '', additionalAssets: [], emotionImages: [],
    chats: [chat], customscript: [], globalLore: [], triggerscript: [], viewScreen: 'none', bias: [], characterVersion: '', creator: '',
    utilityBot: false, scenario: '', systemPrompt: '', tags: [], ...extra,
  })
  const chatA = makeChat(makeUuid(ids), 'C04 Chat A', {})
  const chatB = makeChat(makeUuid(ids), 'C04 Chat B', { modules: CHAT_LEVEL_KEYS.map(idOf) })
  const backgroundHTML = '<style>.c04-bg{position:fixed;inset:0;z-index:-1;background:linear-gradient(160deg,#123a5c,#5c1238);opacity:.9}</style><div class="c04-bg" data-c04="char">c04 card background</div>'
  const characterLevel = makeCharacter('C04 Character-Level', 'character', chatA.chat, { modules: CHARACTER_LEVEL_KEYS.map(idOf), ...(background ? { backgroundHTML } : {}) })
  const chatLevel = makeCharacter('C04 Chat-Level', 'chat', chatB.chat, {})
  const characters = [characterLevel, chatLevel]
  const personaId = makeUuid(ids)
  const database = {
    formatversion: 5, characters, characterOrder: characters.map((c) => c.chaId),
    personas: [{ id: personaId, name: SETTINGS_VALUES.username, personaPrompt: SETTINGS_VALUES.personaPrompt, icon: '', note: SETTINGS_VALUES.userNote }],
    modules: modules.map((m) => m.module),
    botPresets: [{ id: makeUuid(ids), name: 'Synthetic Preset 0', temperature: 80, maxContext: 4000, maxResponse: 300, image: '', localNetworkMode: false, localNetworkTimeoutSec: 600 }],
    loadouts: [], statics: { messages: 0, imports: 0 }, pluginCustomStorage: {}, userIcon: '', customBackground: '',
    ...SETTINGS_VALUES, enabledModules: [],
  }
  const median = (values) => { const s = [...values].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }
  const describeChat = (c, sizes, level) => ({ id: c.id, name: c.name, level, messages: c.message.length, messageBytes: { min: Math.min(...sizes), median: median(sizes), max: Math.max(...sizes) } })
  const manifest = {
    characters: [
      { name: characterLevel.name, chaId: characterLevel.chaId, moduleLevel: 'character', modules: characterLevel.modules, backgroundHTML: Boolean(background), chats: [describeChat(chatA.chat, chatA.sizes, 'character')] },
      { name: chatLevel.name, chaId: chatLevel.chaId, moduleLevel: 'chat', modules: [], backgroundHTML: false, chats: [{ ...describeChat(chatB.chat, chatB.sizes, 'chat'), modules: chatB.chat.modules }] },
    ],
    approxDomNodesPerMessage: weight === 'light' ? lightMessage(0).nodes : heavyMessage(0, mulberry32(1)).nodes,
  }
  return { database, manifest }
}

// ---- file framing (copied from synth-bin-gen.mjs) -----------------------------------------------------------------------------
function u32le(value) {
  if (!Number.isInteger(value) || value < 0 || value > 0xFFFFFFFF) throw new Error(`entry length ${value} does not fit a u32`)
  const out = Buffer.alloc(4)
  out.writeUInt32LE(value)
  return out
}
function entry(name, data) {
  const nameBytes = Buffer.from(name, 'utf8')
  return Buffer.concat([u32le(nameBytes.length), nameBytes, u32le(data.length), data])
}

export function generate({ seed, weights, background, assetMiB }) {
  const { modules, assets } = buildModules(seed, assetMiB, true)
  const packr = new Packr({ useRecords: false })
  const files = {}
  const manifest = {
    format: 'risu-c04-fixture-manifest/1', seed, background, assetMiB, messagesPerChat: MESSAGES_PER_CHAT,
    modules: modules.map((m) => ({ key: m.key, id: m.module.id, name: m.module.name, class: m.class, scripts: m.module.regex.length, assets: m.module.assets.length })),
    referencedByCharacter: CHARACTER_LEVEL_KEYS, referencedByChat: CHAT_LEVEL_KEYS,
    unreferenced: modules.filter((m) => ![...CHARACTER_LEVEL_KEYS, ...CHAT_LEVEL_KEYS].includes(m.key)).map((m) => m.module.id),
    weights: {},
  }
  for (const weight of weights) {
    const { database, manifest: perWeight } = buildDatabase(seed, weight, background, modules)
    const packed = fflate.compressSync(packr.encode(database), { mtime: 0 })
    const databaseEntry = Buffer.concat([DATABASE_HEADER, Buffer.from(packed.buffer, packed.byteOffset, packed.length)])
    const buffer = Buffer.concat([...assets.map((a) => entry(a.name, a.bytes)), entry('database.risudat', databaseEntry)])
    files[`c04-${weight}.bin`] = buffer
    manifest.weights[weight] = { file: `c04-${weight}.bin`, bytes: buffer.length, sha256: sha256Hex(buffer), assetEntries: assets.length, ...perWeight }
  }
  return { files, manifest }
}

function main() {
  const argv = process.argv.slice(2)
  const opt = { out: null, seed: 1, weight: 'both', background: 'off', assetMiB: 12 }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') opt.out = argv[++i]
    else if (argv[i] === '--seed') opt.seed = Number(argv[++i])
    else if (argv[i] === '--weight') opt.weight = argv[++i]
    else if (argv[i] === '--background') opt.background = argv[++i]
    else if (argv[i] === '--asset-mib') opt.assetMiB = Number(argv[++i])
    else throw new Error('unknown argument ' + argv[i])
  }
  if (!opt.out) throw new Error('usage: node make-c04-fixture.mjs --out <dir> --seed <n> --weight light|heavy|both --background on|off [--asset-mib 12]')
  if (!Number.isInteger(opt.seed) || !['light', 'heavy', 'both'].includes(opt.weight) || !['on', 'off'].includes(opt.background) || !(opt.assetMiB > 0 && opt.assetMiB <= 12)) {
    throw new Error('bad option value: seed integer, weight light|heavy|both, background on|off, asset-mib in (0, 12]')
  }
  const out = path.resolve(opt.out)
  const relative = path.relative(REPO_ROOT, out)
  if (relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)) throw new Error('--out must be outside the repository')
  const { files, manifest } = generate({ seed: opt.seed, weights: opt.weight === 'both' ? ['light', 'heavy'] : [opt.weight], background: opt.background === 'on', assetMiB: opt.assetMiB })
  fs.mkdirSync(out, { recursive: true })
  for (const [name, buffer] of Object.entries(files)) fs.writeFileSync(path.join(out, name), buffer)
  fs.writeFileSync(path.join(out, 'c04-manifest.json'), JSON.stringify(manifest, null, 2))
  console.log(JSON.stringify({ out, files: Object.fromEntries(Object.entries(files).map(([name, b]) => [name, b.length])) }))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
