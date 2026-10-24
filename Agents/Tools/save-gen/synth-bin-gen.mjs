// Deterministic synthetic upstream-compatible .bin generator (MC-471). Plain Node ESM, no src/ imports.
//
//   node Agents/Tools/save-gen/synth-bin-gen.mjs --out <path outside the repo> --seed 1337 --scale small|mid|device [--dry-run]
//
// Writes <out> (the .bin) and <out>.manifest.json (the expectations synth-bin-verify.mjs compares an exported .bin against).
//
// The device scale is for chat-session mechanics on a device only (rail, open, send, edit, idle). It copies the shape of a
// real 500-character profile: no stubs, groups, folders or trash, mostly one near-empty chat per character, 164 skewed-size
// modules, global lore on 30% of the characters, and about 517 assets, nearly all of them 4-8 KiB avatars. Use it for no
// memory, avatar-decode or save-cost conclusion (tiny avatars and empty chats understate them), and not for the MC-471
// round-trip acceptance (opening a character stamps new fields into it). Its root points the app at the local mock endpoint
// (Agents/Tools/device/mock-openai.mjs, port 6250) with the literal key mock-key, and presets the sub-task features off.
// Session characters: the first six characters of the rail (indexes 0-5) hold two chats of 8-16 messages each. Every
// character whose index is a multiple of 3 (0, 3, 6, ...) carries an editoutput regex script that rewrites the reply
// letter c to d, so the mock's [mock-reply] marker displays as [modk-reply] there. A check that reads the reply marker must
// use a character whose index is not a multiple of 3 (1, 2, 4, 5 among the session characters) or expect [modk-reply].
//
// Usage (the round trip on a store2 page):
//   1. Generate: --scale small for a quick pass, --scale mid for the MC-471 totals. --dry-run prints the plan and writes nothing.
//   2. Import <out> into the page (Settings > import backup), then export a .bin from it. Between the import and the export:
//      open no character and no group (opening one runs the character format update, which stamps new fields and dates),
//      and visit no persona settings page and no preset settings page (they write the root persona fields and the active
//      preset back). Confirm first that the page is in store2 mode: a legacy page runs a different import and export path.
//   3. Check: node synth-bin-verify.mjs --manifest <out>.manifest.json --bin <exported.bin>. Exit 0 means every asset hash,
//      every field of every character, chat, module, list and setting survived, in the same order.
//   3b. Re-import check: import the exported file into a fresh profile, export again from that profile, and verify that file
//      against the same manifest. Without this step nothing checks the re-import half of the round trip.
//   4. On a red result, localise it: node synth-bin-verify.mjs --bin-a <out> --bin-b <exported.bin> lists every difference
//      by JSON path. That mode cannot see a loss both files share, so the manifest run is the one that must pass. Without
//      --forbid-added-root-keys it tolerates root keys only the second file holds (the app's added defaults).
//
// Acceptance protocol (MC-471). Every red is a named JSON path or a named problem; the pass rule in every step is the
// verifier's `ok: true` with exit 0 (no differences and no problems), not a differences count alone.
//   PC run: the manifest against the PC export must be ok. Record its addedRootKeys (name and value hash) beside the manifest.
//   Phone run (export-1 is the export taken from the phone after importing <out>; export-2 is the export taken after
//   re-importing export-1 on a fresh profile):
//     a. manifest against export-1 is ok;
//     b. the PC export (--bin-a) against export-1 (--bin-b), with --forbid-added-root-keys, is ok (exit 0: no differences and no problems);
//     c. manifest against export-2 is ok;
//     d. export-1 (--bin-a) against export-2 (--bin-b), with --forbid-added-root-keys, is ok (exit 0: no differences and no problems).
//   The 200 MiB and 500 MiB assets must raise no omission prompt, since the limit is 4 GiB; a prompt on the phone is itself
//   a finding.
//
// File shape: [u32 LE name length][name][u32 LE data length][data] per entry, assets first, stub and plugin storage unit
// entries next, database.risudat last. database.risudat is the legacy compressed save: the 11-byte header [0,'RISUSAVE',0,8] followed by
// fflate.compressSync(msgpackr.encode(db), { mtime: 0 }), what encodeRisuSaveLegacy(db, 'compression') produces.
//
// Memory: every entry body is produced in pieces of at most 4 MiB and written at once; only the database object is
// resident. Asset names are the sha256 of the bytes, so each asset body is produced twice from (seed, index): once to hash it,
// once to write it (and the second pass re-checks the hash). Same seed and scale give a byte-identical file.
//
// The data is generated already normalised: every field the app's boot rules fill on the parts the generator writes
// (applyCharacterDefaults on characters and stub slots, lorebook bookVersion 2, the preset localNetwork fields) is present,
// so a boot changes nothing; synth-bin-seam.harness.ts runs the app's setDatabase, updateLorebooks and checkCharOrder over
// the output and synth-bin.harness.ts the import's repairs and resolve, and both require an empty difference. The data also
// fills the store2 parts a loss could hide in: global lore, scripts, VITS models and cc assets (also in stub units), chat tail
// state, message chatId stamps, memory data, groups, trashed characters (trashTime far in the future, so the startup purge
// keeps them), stubs with a newer lastInteraction than their unit, module triggers, loadouts, plugin storage values (plain,
// and in upstream's index form: an index unit naming small JSON values and a large value unit) and a small set of fixed
// non-credential settings. A stub's unit holds the stub's own chaId. The root user fields equal persona 0, as the app keeps them.
//
// Image assets are valid PNGs: a 4x4 RGB image whose pixels come from the asset's seed (unique per file), then one private
// ancillary chunk 'ruSt' (lowercase first letter: ancillary, lowercase second: private, uppercase third: reserved bit as
// required, lowercase fourth: safe to copy) holding random padding with a correct CRC, then IEND. Decoders skip an unknown
// ancillary chunk, so the file decodes as the tiny image at any size. Voice, model and video assets are random bytes.
// The 200 MiB asset is an additionalAssets entry with extension mp4; the 500 MiB asset is the .onnx file of a vits model.
import { createRequire } from 'node:module'
import { createHash, createCipheriv } from 'node:crypto'
import { crc32 } from 'node:zlib'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..', '..')
const requireFromRepo = createRequire(path.join(REPO_ROOT, 'package.json'))
// msgpackr 1.10.1 asks Buffer.utf8Write for more bytes than the buffer has left; this Node throws on that where older
// versions clamped. The clamp restores the older behaviour and changes no byte of the output.
const nativeUtf8Write = Buffer.prototype.utf8Write
Buffer.prototype.utf8Write = function (text, position, length) { return nativeUtf8Write.call(this, text, position, Math.min(length, this.length - position)) }
const { Packr } = requireFromRepo('msgpackr/index-no-eval')
const fflate = requireFromRepo('fflate')

const MIB = 1024 * 1024
const KIB = 1024
const PIECE_BYTES = 4 * MIB
const T = 1700000000000
const GENERATOR_VERSION = 3
// A trashed character the startup purge never removes: the purge takes a trashTime older than three days.
const TRASH_TIME = 4102444800000
const COLD_STORAGE_HEADER = '\uEF01COLDSTORAGE\uEF01'
const DATABASE_HEADER = Uint8Array.of(0, 82, 73, 83, 85, 83, 65, 86, 69, 0, 8)

// What a projection leaves out; synth-bin-verify.mjs carries the same lists and refuses a manifest that disagrees.
const EXCLUDED_CHARACTER_KEYS = ['coldstorage', 'coldStoragedChats', 'coldVersion', 'coldChatCount', 'reloadKeys']
const EXCLUDED_CHAT_KEYS = ['isStreaming', 'activeStreamingDisplayOptimizationMode']

// The configuration-root fields this file sets. Each value is already what the boot normalisation (setDatabase) leaves, and
// none is key-like: no credential or token is ever written (the device scale's provider settings add only the mock's
// throwaway proxyKey 'mock-key'). username, personaPrompt and userNote are persona 0's fields
// (saveUserPersona and changeUserPersona keep the root copy equal to personas[selectedPersona]).
// promptInfoInsideChat is false because setDatabase forces it false on the web and leaves it absent on Tauri and the node
// server (the branch on isNodeServer and isTauri); writing it makes a web and a Tauri export hold the same root keys.
// didFirstSetup is true because App.svelte shows WelcomeRisu while it is falsy, and finishing that wizard rewrites
// username, temperature, maxContext, maxResponse, textTheme and globalNote plus the preset; bootstrap.ts also skips the
// character URL import and the desktop launch import until it is true. formatversion 5 (set on the database below) keeps
// checkNewFormat from migrating. No other database field gates a prompt: lastPatchNoteCheckVersion has no reader.
// Gates this data cannot close are per device: localStorage 'upstreamServicesAgreement' (askUpstreamAgreement in
// upstreamAgreement.ts, only on a Realm or hub action or a pending realm link) and 'nightlyWarned' (bootstrap.ts, nightly
// builds only). A run must not trigger those paths between the import and the export.
const SETTINGS_VALUES = {
  didFirstSetup: true,
  promptInfoInsideChat: false,
  username: 'Synthetic User', personaPrompt: 'Synthetic persona prompt.', userNote: 'Synthetic user note.',
  language: 'en', temperature: 80, maxContext: 4000, maxResponse: 500, iconsize: 100, zoomsize: 100,
  swipe: true, autoTranslate: false, theme: '', textTheme: 'standard', loreBookDepth: 5, loreBookToken: 800, selectedPersona: 0,
  botPresetsId: 0, globalNote: 'Synthetic global note.', additionalPrompt: 'Synthetic additional prompt.',
  descriptionPrefix: 'Synthetic description prefix: ', customCSS: '.synthetic { color: gray; }',
  globalChatVariables: { synthetic_variable: '1' },
}

const SCALES = {
  mid: {
    characters: 500, stubEvery: 10, additional: 36000, emotionCharacters: 36, emotionPerCharacter: 50,
    vitsCharacters: 13, vitsHugeSlot: 6, vitsStride: 40, vitsMiB: [20, 60], voiceRefs: 30, voiceStride: 16, ccAssets: 200,
    modules: 100, moduleAssets: 15, moduleIconEvery: 5, modulesMiB: 30, personas: 5, folders: 4, presets: 3,
    big200: true, chatBaseBytes: 60 * KIB, groups: 5, pluginValues: 12, loadouts: 4,
  },
  small: {
    characters: 50, stubEvery: 10, additional: 1700, emotionCharacters: 5, emotionPerCharacter: 20,
    vitsCharacters: 3, vitsHugeSlot: -1, vitsStride: 15, vitsMiB: [4, 10], voiceRefs: 6, voiceStride: 8, ccAssets: 20,
    modules: 8, moduleAssets: 10, moduleIconEvery: 2, modulesMiB: 0.5, personas: 3, folders: 2, presets: 2,
    big200: false, chatBaseBytes: 60 * KIB, groups: 2, pluginValues: 3, loadouts: 2,
  },
  // Optional fields that small and mid leave unset keep their draws and output unchanged: avatarKiB, trashEvery,
  // chatCountTable, sessionCharacters, moduleBytes, luaModules, loreShape, rootSettings.
  device: {
    characters: 500, stubEvery: 0, additional: 0, emotionCharacters: 0, emotionPerCharacter: 0,
    vitsCharacters: 0, vitsHugeSlot: -1, vitsStride: 40, vitsMiB: [0, 0], voiceRefs: 0, voiceStride: 16, ccAssets: 0,
    modules: 164, moduleAssets: 0, moduleIconEvery: 21, modulesMiB: 30, personas: 5, folders: 0, presets: 3,
    big200: false, chatBaseBytes: 60 * KIB, groups: 0, pluginValues: 0, loadouts: 0,
    avatarKiB: [4, 8], trashEvery: 0,
    // chats per character from the partial profile's census (500 characters, 771 chats), assigned by a seeded shuffle
    chatCountTable: [[1, 442], [2, 21], [3, 10], [4, 4], [5, 4], [6, 8], [7, 2], [8, 1], [9, 1], [14, 1], [15, 1], [21, 3], [24, 1], [26, 1]],
    sessionCharacters: 6,
    moduleBytes: { median: 72 * KIB, sigma: 1.452, max: 3.4 * MIB }, luaModules: 3,
    loreShape: { fraction: 0.3, median: 21817, sigma: 1.968, max: 4114042 },
    rootSettings: {
      aiModel: 'reverse_proxy', subModel: 'reverse_proxy', forceReplaceUrl: 'http://127.0.0.1:6250/v1/chat/completions',
      customProxyRequestModel: 'mock-model', customAPIFormat: 0, autofillRequestUrl: true, proxyKey: 'mock-key',
      useStreaming: false, usePlainFetch: false, dynamicModelRegistry: false,
      useAutoSuggestions: false, useAutoTranslateInput: false, hypaV3: false, hypaMemory: false, supaModelType: 'none',
      emotionProcesser: 'submodel', hanuraiEnable: false, sdProvider: '', ttsAutoSpeech: false,
    },
    // the settings the active preset repeats (setPreset takes preset ?? root, and blanks customProxyRequestModel when absent);
    // dynamicModelRegistry and the sub-task switches are root-only
    presetSettings: ['aiModel', 'subModel', 'forceReplaceUrl', 'customProxyRequestModel', 'customAPIFormat', 'autofillRequestUrl', 'proxyKey', 'useStreaming'],
  },
}

// ---------------------------------------------------------------------------------------------------------------------
// arguments

/** `target` with its nearest existing ancestor resolved through links; the part that does not exist yet is appended as written. */
function realPathOfExisting(target) {
  const missing = []
  let current = target
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current)
    if (parent === current) break
    missing.unshift(path.basename(current))
    current = parent
  }
  return path.join(fs.realpathSync(current), ...missing)
}

function parseArguments(argv) {
  const opt = { out: '', seed: 1337, scale: '', dryRun: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--dry-run') { opt.dryRun = true; continue }
    const value = argv[i + 1]
    if (value === undefined) throw new Error(`${arg} needs a value`)
    i++
    if (arg === '--out') opt.out = value
    else if (arg === '--seed') opt.seed = Number(value)
    else if (arg === '--scale') opt.scale = value
    else throw new Error(`unknown argument ${arg}`)
  }
  if (!Number.isInteger(opt.seed) || opt.seed < 0 || opt.seed > 0xFFFFFFFF) throw new Error('--seed must be an integer from 0 to 4294967295')
  if (!Object.hasOwn(SCALES, opt.scale)) throw new Error('--scale must be small, mid or device')
  if (!opt.dryRun && !opt.out) throw new Error('--out is required unless --dry-run')
  if (opt.out) {
    const resolved = path.resolve(opt.out)
    // Real paths, so a link that points into the repository is refused too.
    const rel = path.relative(fs.realpathSync(REPO_ROOT), realPathOfExisting(resolved))
    const outside = rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)
    if (!outside) throw new Error(`refusing to write inside the repository (${REPO_ROOT}): ${resolved}`)
    opt.out = resolved
  }
  return opt
}

// ---------------------------------------------------------------------------------------------------------------------
// deterministic helpers

function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function makeRandomHelpers(rnd) {
  const hex = (n) => Array.from({ length: n }, () => '0123456789abcdef'[Math.floor(rnd() * 16)]).join('')
  const uuid = () => `${hex(8)}-${hex(4)}-4${hex(3)}-8${hex(3)}-${hex(12)}`
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd())
  return { hex, uuid, gauss }
}

const sha256Of = (value) => createHash('sha256').update(value).digest()
const sha256HexOf = (value) => createHash('sha256').update(value).digest('hex')

/** JSON with sorted object keys and no undefined members: the same value always gives the same text. */
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map((item) => (item === undefined ? 'null' : canonical(item))).join(',') + ']'
  const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort()
  return '{' + keys.map((key) => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
}

/** The listed keys of `source`; nothing when either is absent. */
function pick(source, keys) {
  return source && keys ? Object.fromEntries(keys.map((key) => [key, source[key]])) : {}
}

/** Per-key hashes and one hash over them, for the keys of `object` that are not excluded. */
function project(object, excluded, extra = {}) {
  const fields = {}
  const source = { ...object, ...extra }
  for (const key of Object.keys(source).sort()) {
    if (excluded.includes(key) || source[key] === undefined) continue
    fields[key] = sha256HexOf(canonical(source[key])).slice(0, 16)
  }
  return { hash: sha256HexOf(canonical(fields)), fields }
}

// ---------------------------------------------------------------------------------------------------------------------
// asset bytes

const ZERO_PIECE = Buffer.alloc(PIECE_BYTES)

/** `size` bytes of AES-128-CTR keystream keyed by (seedKey, tag), handed to `emit` in pieces of at most 4 MiB; a piece may be reused after `emit` returns. */
function streamRandom(seedKey, tag, size, emit) {
  const digest = sha256Of(`risu-synth-v${GENERATOR_VERSION}|${seedKey}|${tag}`)
  const cipher = createCipheriv('aes-128-ctr', digest.subarray(0, 16), digest.subarray(16, 32))
  for (let left = size; left > 0;) {
    const n = Math.min(left, PIECE_BYTES)
    emit(cipher.update(ZERO_PIECE.subarray(0, n)))
    left -= n
  }
}

function u32be(value) {
  const out = Buffer.alloc(4)
  out.writeUInt32BE(value >>> 0)
  return out
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii')
  return Buffer.concat([u32be(data.length), typeBytes, data, u32be(crc32(data, crc32(typeBytes)))])
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
const PNG_IEND = Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82])
const PNG_PAD_TYPE = Buffer.from('ruSt', 'ascii')

function producePng(spec, emit) {
  const pixels = Buffer.concat([sha256Of(`${spec.seedKey}|px0`), sha256Of(`${spec.seedKey}|px1`)])
  const raw = Buffer.alloc(4 * 13)
  for (let row = 0; row < 4; row++) pixels.copy(raw, row * 13 + 1, row * 12, row * 12 + 12)
  const ihdr = Buffer.concat([u32be(4), u32be(4), Buffer.from([8, 2, 0, 0, 0])])
  const idat = Buffer.from(fflate.zlibSync(raw, { level: 9 }))
  const head = Buffer.concat([PNG_SIGNATURE, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat)])
  const fixedBytes = head.length + 8 + 4 + PNG_IEND.length
  const padBytes = spec.size - fixedBytes
  if (padBytes < 0) throw new Error(`png asset of ${spec.size} bytes is smaller than its ${fixedBytes} byte frame`)
  emit(Buffer.concat([head, u32be(padBytes), PNG_PAD_TYPE]))
  let crc = crc32(PNG_PAD_TYPE)
  streamRandom(spec.seedKey, 'pad', padBytes, (piece) => {
    crc = crc32(piece, crc)
    emit(piece)
  })
  emit(Buffer.concat([u32be(crc), PNG_IEND]))
}

function produceAsset(spec, emit) {
  if (spec.format === 'png') producePng(spec, emit)
  else streamRandom(spec.seedKey, 'body', spec.size, emit)
}

// ---------------------------------------------------------------------------------------------------------------------
// plan: sizes, kinds and references, all from one seeded sequence; no bytes are produced here

function buildPlan(seed, cfg) {
  const rnd = mulberry32(seed)
  const { hex, uuid, gauss } = makeRandomHelpers(rnd)
  const assets = []
  const addAsset = (kind, ext, format, size) => {
    const index = assets.length
    assets.push({ index, kind, ext, format, size: Math.floor(size), seedKey: `${seed}:${index}`, sha256: '', name: '' })
    return index
  }
  const between = (low, high) => low + rnd() * (high - low)
  const imageSize = (lowKiB, highKiB) => between(lowKiB * KIB, highKiB * KIB)
  const additionalSize = () => {
    const r = rnd()
    if (r < 0.88) return between(16 * KIB, 96 * KIB)
    if (r < 0.995) return between(256 * KIB, 1 * MIB)
    return between(2 * MIB, 8 * MIB)
  }
  const additionalExt = () => {
    const r = rnd()
    if (r < 0.94) return 'png'
    return r < 0.97 ? 'mp3' : 'ogg'
  }

  // additional assets per character: lognormal weights, so a few characters hold a thousand and some hold none
  const weights = Array.from({ length: cfg.characters }, () => Math.exp(1.2 * gauss()))
  const weightSum = weights.reduce((sum, w) => sum + w, 0)
  const additionalCounts = weights.map((w) => Math.floor(cfg.additional * w / weightSum))
  for (let leftover = cfg.additional - additionalCounts.reduce((sum, n) => sum + n, 0), i = 0; leftover > 0; leftover--, i = (i + 1) % cfg.characters) additionalCounts[i]++

  // Device-only draws come from their own sequence, so the sequence small and mid draw from is untouched.
  const deviceRnd = mulberry32((seed ^ 0xD3D3D3D3) >>> 0)
  const deviceGauss = makeRandomHelpers(deviceRnd).gauss
  let deviceChatCounts = null
  if (cfg.chatCountTable) {
    deviceChatCounts = cfg.chatCountTable.flatMap(([count, characterCount]) => Array(characterCount).fill(count))
    if (deviceChatCounts.length !== cfg.characters) throw new Error(`chatCountTable covers ${deviceChatCounts.length} characters, not ${cfg.characters}`)
    for (let k = deviceChatCounts.length - 1; k > 0; k--) {
      const j = Math.floor(deviceRnd() * (k + 1))
      ;[deviceChatCounts[k], deviceChatCounts[j]] = [deviceChatCounts[j], deviceChatCounts[k]]
    }
    // the session characters hold two chats each: swap a two-chat entry into every session slot, which keeps the total
    for (let s = 0; s < cfg.sessionCharacters; s++) {
      if (deviceChatCounts[s] === 2) continue
      const donor = deviceChatCounts.findIndex((count, k) => k >= cfg.sessionCharacters && count === 2)
      if (donor < 0) throw new Error('chatCountTable has too few two-chat entries for the session characters')
      ;[deviceChatCounts[s], deviceChatCounts[donor]] = [deviceChatCounts[donor], deviceChatCounts[s]]
    }
  }
  // messages per chat: p50 0, p95 16, max 62 (borrowed from a real profile)
  const deviceMessageCount = () => {
    const u = deviceRnd()
    if (u < 0.5) return 0
    if (u < 0.95) return 1 + Math.floor(((u - 0.5) / 0.45) ** 2 * 15)
    return 16 + Math.floor(((u - 0.95) / 0.05) ** 3 * 47)
  }
  const deviceMessageBytes = () => (deviceRnd() < 0.02 ? 20 * KIB + deviceRnd() * 40 * KIB : 200 + deviceRnd() * 1300)
  const emotionStride = cfg.emotionCharacters > 0 ? Math.max(1, Math.floor(cfg.characters / cfg.emotionCharacters)) : 0
  const trashEvery = cfg.trashEvery ?? 50
  const characters = []
  let stubCount = 0
  for (let i = 0; i < cfg.characters; i++) {
    const chaId = uuid()
    // every stubEvery-th character, and the second VITS character (so a stub unit holds a VITS model)
    const stub = cfg.stubEvery > 0 && (i % cfg.stubEvery === cfg.stubEvery - 1 || i === 2 + cfg.vitsStride)
    const character = {
      index: i, chaId, stub, stubOrdinal: stub ? stubCount++ : -1, stubKey: stub ? uuid() : '',
      avatar: addAsset('avatar', 'png', 'png', imageSize(...(cfg.avatarKiB ?? [80, 250]))),
      additional: [], emotion: [], vits: null, voice: null, cc: [],
      chats: [], chatPage: 0, firstMsgIndex: -1,
      // one inline and one stub character in every fifty are in the trash; some stubs hold a newer lastInteraction than their unit
      trashed: trashEvery > 0 && i % trashEvery === 7 ? 'inline' : trashEvery > 0 && stub && i % trashEvery === 19 ? 'stub' : '',
      newerStub: stub && i % 20 === 9,
    }
    for (let k = 0; k < additionalCounts[i]; k++) {
      const ext = additionalExt()
      character.additional.push({ label: `extra${k}`, ext, id: addAsset('additional', ext, ext === 'png' ? 'png' : 'opaque', additionalSize()) })
    }
    if (emotionStride > 0 && i % emotionStride === 1 && i / emotionStride < cfg.emotionCharacters) {
      for (let k = 0; k < cfg.emotionPerCharacter; k++) character.emotion.push({ label: `emo${k}`, id: addAsset('emotion', 'png', 'png', imageSize(60, 200)) })
    }
    const vitsSlot = i >= 2 && (i - 2) % cfg.vitsStride === 0 ? (i - 2) / cfg.vitsStride : -1
    if (vitsSlot >= 0 && vitsSlot < cfg.vitsCharacters) {
      const huge = vitsSlot === cfg.vitsHugeSlot
      const modelBytes = huge ? 500 * MIB : between(cfg.vitsMiB[0] * MIB, cfg.vitsMiB[1] * MIB)
      character.vits = {
        id: hex(32), name: `Synthetic VITS ${vitsSlot}`,
        files: [
          ['onnx/model.onnx', addAsset('vits', 'onnx', 'opaque', modelBytes)],
          ['config.json', addAsset('vits', 'json', 'opaque', between(1 * KIB, 4 * KIB))],
          ['tokenizer.json', addAsset('vits', 'json', 'opaque', between(8 * KIB, 64 * KIB))],
          ['tokenizer_config.json', addAsset('vits', 'json', 'opaque', between(1 * KIB, 4 * KIB))],
        ],
      }
    }
    if (i >= 5 && (i - 5) % cfg.voiceStride === 0 && (i - 5) / cfg.voiceStride < cfg.voiceRefs) {
      character.voice = { fileName: `voice-${i}.wav`, id: addAsset('voice', 'wav', 'opaque', between(300 * KIB, 2 * MIB)) }
    }
    // every second stub also holds a cc asset, over the ccAssets spread, so the stub units carry them
    const spreadCc = cfg.ccAssets > 0 && i % Math.max(1, Math.floor(cfg.characters / cfg.ccAssets)) === 0 && assets.filter((a) => a.kind === 'cc').length < cfg.ccAssets
    if (spreadCc || (stub && character.stubOrdinal % 2 === 0)) {
      character.cc.push({ name: `cc${i}`, id: addAsset('cc', 'png', 'png', imageSize(20, 200)) })
    }
    const chatBytes = Math.min(4 * MIB, cfg.chatBaseBytes * Math.exp(0.9 * gauss()))
    const chatCount = Math.max(1, Math.min(40, Math.round(chatBytes / (60 * KIB))))
    for (let c = 0; c < chatCount; c++) character.chats.push({ id: uuid(), bytes: chatBytes / chatCount, hangul: (i + c) % 7 === 0 })
    character.chatPage = Math.floor(rnd() * chatCount)
    character.firstMsgIndex = Math.floor(rnd() * 3) - 1
    if (deviceChatCounts) {
      const session = i < cfg.sessionCharacters
      character.chats = Array.from({ length: deviceChatCounts[i] }, (_, c) => {
        const messageBytes = Array.from({ length: session ? 8 + Math.floor(deviceRnd() * 9) : deviceMessageCount() }, deviceMessageBytes)
        return { id: uuid(), bytes: messageBytes.reduce((sum, n) => sum + n, 0), messageBytes, hangul: (i + c) % 7 === 0 }
      })
      character.chatPage = Math.floor(deviceRnd() * character.chats.length)
    }
    if (cfg.loreShape) {
      const lore = cfg.loreShape
      character.loreBytes = deviceRnd() < lore.fraction ? Math.min(lore.max, lore.median * Math.exp(lore.sigma * deviceGauss())) : 0
    }
    characters.push(character)
  }
  if (cfg.big200) {
    // one 200 MiB additional asset (video) on a character that is not a stub
    const holder = characters.find((c) => !c.stub && c.index >= 3)
    holder.additional.push({ label: 'big200', ext: 'mp4', id: addAsset('additional', 'mp4', 'opaque', 200 * MIB) })
    assets[holder.additional.at(-1).id].big = true
  }
  for (const character of characters) {
    if (character.vits) for (const [, id] of character.vits.files) if (assets[id].size === 500 * MIB) assets[id].big = true
  }

  const modules = []
  for (let m = 0; m < cfg.modules; m++) {
    const moduleAssets = []
    for (let k = 0; k < cfg.moduleAssets; k++) moduleAssets.push({ label: `mod${m}-asset${k}`, id: addAsset('moduleAsset', 'png', 'png', imageSize(30, 300)) })
    const icon = cfg.moduleIconEvery > 0 && m % cfg.moduleIconEvery === 0 ? addAsset('moduleIcon', 'png', 'png', imageSize(20, 100)) : -1
    const planned = { id: uuid(), assets: moduleAssets, icon }
    if (cfg.moduleBytes) planned.bytes = Math.min(cfg.moduleBytes.max, cfg.moduleBytes.median * Math.exp(cfg.moduleBytes.sigma * deviceGauss()))
    if (cfg.luaModules > 0) {
      const luaStep = Math.floor(cfg.modules / cfg.luaModules)
      planned.luaBytes = m % luaStep === 0 && m / luaStep < cfg.luaModules ? 1 * KIB + Math.floor(deviceRnd() * 3 * KIB) : 0
    }
    modules.push(planned)
  }
  const misc = {
    userIcon: addAsset('userIcon', 'png', 'png', imageSize(20, 100)),
    customBackground: addAsset('customBackground', 'png', 'png', imageSize(100, 400)),
    // persona 0 is the selected persona: its icon is the user icon, as the app keeps them equal
    personas: Array.from({ length: cfg.personas }, (_, k) => ({ id: uuid(), icon: k === 0 ? -1 : addAsset('personaIcon', 'png', 'png', imageSize(20, 100)) })),
    folders: Array.from({ length: cfg.folders }, () => ({ id: uuid(), image: addAsset('folderImage', 'png', 'png', imageSize(20, 100)) })),
    presets: Array.from({ length: cfg.presets }, () => ({ id: uuid(), image: addAsset('presetImage', 'png', 'png', imageSize(20, 100)) })),
  }
  // Everything below draws after the asset plan, so the assets are the same with or without it.
  const groups = Array.from({ length: cfg.groups }, (_, g) => ({
    index: g, chaId: uuid(), members: [(g * 11 + 2) % cfg.characters, (g * 11 + 3) % cfg.characters, (g * 11 + 4) % cfg.characters],
    chats: Array.from({ length: 2 }, () => ({ id: uuid(), bytes: 20 * KIB, hangul: g % 2 === 1 })), chatPage: g % 2,
  }))
  // plain: stored inline; small: a JSON text in upstream's plugin storage index; large: its own unit the index names
  const pluginValues = Array.from({ length: cfg.pluginValues }, (_, k) => ({
    key: `synthetic_plugin_${k}`, bytes: Math.floor(between(2 * KIB, 100 * KIB)), mode: ['plain', 'small', 'large'][k % 3], unitId: uuid(),
  }))
  const pluginIndexId = uuid()
  const loadouts = Array.from({ length: cfg.loadouts }, () => ({ id: uuid() }))
  return { assets, characters, modules, misc, groups, pluginValues, pluginIndexId, loadouts }
}

// ---------------------------------------------------------------------------------------------------------------------
// database: built from the plan and the asset names

function buildDatabase(seed, cfg, plan, refOf, withProjections) {
  const rnd = mulberry32((seed ^ 0xA5A5A5A5) >>> 0)
  const syllables = ['ka', 'lo', 'mi', 'ren', 'tha', 'vel', 'dor', 'an', 'is', 'ul', 'ex', 'or', 'qui', 'na', 'be', 'sha']
  const words = Array.from({ length: 3000 }, () => {
    let word = ''
    for (let n = 1 + Math.floor(rnd() * 3); n > 0; n--) word += syllables[Math.floor(rnd() * syllables.length)]
    return word
  })
  const hangulWords = Array.from({ length: 800 }, () => {
    let word = ''
    for (let n = 1 + Math.floor(rnd() * 3); n > 0; n--) word += String.fromCharCode(0xAC00 + Math.floor(rnd() * 11172))
    return word
  })
  const text = (bytes, hangul = false) => {
    const list = hangul ? hangulWords : words
    const parts = []
    for (let length = 0; length < bytes;) {
      const word = list[Math.floor(rnd() * list.length)]
      parts.push(word)
      length += word.length + 1
    }
    return parts.join(' ').slice(0, Math.max(0, Math.floor(bytes)))
  }

  const projections = { characters: {}, chats: {}, modules: {}, parts: {}, restored: [] }
  const units = []
  // `restored` is the character as the importer ends up with it (kept in list order for the whole-tree hashes); its chats
  // are projected on their own, in stored order.
  const addCharacterProjections = (restored, chats) => {
    projections.restored.push(restored)
    const { chats: _chats, ...rest } = restored
    projections.characters[restored.chaId] = project(rest, EXCLUDED_CHARACTER_KEYS, { chatIds: chats.map((c) => c.id) })
    for (const chat of chats) projections.chats[`${restored.chaId}|${chat.id}`] = project(chat, EXCLUDED_CHAT_KEYS)
  }
  // An entry that is already at lorebook version 2, so the boot rule (updateLorebooks) leaves it as it is.
  const loreBook = (tag, count, bytes) => Array.from({ length: count }, (_, e) => ({
    key: `${tag}-k${e}`, secondkey: '', comment: `${tag}-c${e}`, content: text(bytes), mode: 'normal', insertorder: 100,
    alwaysActive: false, selective: false, bookVersion: 2,
  }))
  // `variant` spreads the optional chat fields over the chats: tail state (stored with the last chunk of a store2 chat),
  // message chatId stamps, memory data and chat-local lore. `memberIds` makes the char messages of a group name a speaker.
  const buildChat = (variant, chat, c, memberIds) => {
    const count = chat.messageBytes ? chat.messageBytes.length : Math.max(1, Math.ceil(chat.bytes / 1500))
    const message = Array.from({ length: count }, (_, m) => {
      const role = m % 2 === 0 ? 'char' : 'user'
      const entry = { role, data: text(chat.messageBytes ? chat.messageBytes[m] : chat.bytes / count, chat.hangul), time: T + m * 60000 }
      if (m % 5 === 0) entry.chatId = chat.id
      if (memberIds && role === 'char') entry.saying = memberIds[m % memberIds.length]
      return entry
    })
    const built = { id: chat.id, name: `Chat ${c + 1}`, note: '', localLore: variant % 11 === 0 ? loreBook(`l${variant}`, 1, 400) : [], message }
    if (variant % 3 === 0) {
      built.lastMemory = text(200)
      built.scriptstate = { synthetic_counter: variant, synthetic_flag: true, synthetic_text: 'state' }
      built.suggestMessages = ['Yes.', 'No.']
      built.lastDate = T + variant * 1000
    }
    if (variant % 5 === 0) built.supaMemoryData = text(300)
    if (variant % 7 === 0) built.hypaV3Data = { summaries: [{ text: text(200), chatMemos: [chat.id], isImportant: false }] }
    return built
  }
  const characters = plan.characters.map((planned) => {
    const chats = planned.chats.map((chat, c) => buildChat(planned.index + c, chat, c, null))
    const full = {
      type: 'character', chaId: planned.chaId, name: `Synthetic ${planned.index}`,
      chatPage: planned.chatPage, firstMsgIndex: planned.firstMsgIndex, lastInteraction: T + planned.index * 1000,
      desc: text(3000 + rnd() * 5000), firstMessage: text(800), notes: text(600),
      alternateGreetings: ['Hello there.', 'Another way to begin.'],
      image: refOf(planned.avatar),
      additionalAssets: planned.additional.map((a) => [a.label, refOf(a.id), a.ext]),
      emotionImages: planned.emotion.map((e) => [e.label, refOf(e.id)]),
      chats,
      // the fields applyCharacterDefaults fills on every character at boot, here with values some characters really hold
      customscript: planned.index % 3 === 0 ? [{ comment: `cs${planned.index}`, in: 'a+', out: 'b', type: 'editprocess', flag: 'g' }, { comment: `cs${planned.index}-b`, in: 'c', out: 'd', type: 'editoutput' }] : [],
      // some stubs too (every second, every third from the second), so their units carry lore and trigger scripts
      globalLore: planned.loreBytes !== undefined ? (planned.loreBytes > 0 ? loreBook(`g${planned.index}`, Math.max(1, Math.round(planned.loreBytes / 1400)), 1400) : [])
        : planned.index % 4 === 0 || (planned.stub && planned.stubOrdinal % 2 === 0) ? loreBook(`g${planned.index}`, 2 + planned.index % 5, planned.index % 20 === 0 ? 100 * KIB : 1400) : [],
      triggerscript: planned.index % 5 === 0 || (planned.stub && planned.stubOrdinal % 3 === 1) ? [{ comment: `t${planned.index}`, type: 'manual', conditions: [], effect: [{ type: 'setvar', var: 'synthetic', operator: '=', value: String(planned.index) }], lowLevelAccess: false }] : [],
      viewScreen: 'none', bias: [], characterVersion: '', creator: '', utilityBot: false, scenario: '', systemPrompt: '',
      tags: planned.index % 3 === 0 ? ['synthetic', `tag${planned.index % 5}`] : [],
    }
    if (planned.trashed === 'inline') full.trashTime = TRASH_TIME
    if (planned.vits) full.vits = { id: planned.vits.id, name: planned.vits.name, files: Object.fromEntries(planned.vits.files.map(([rel, id]) => [rel, refOf(id)])) }
    if (planned.voice) full.gptSoVitsConfig = { ref_audio_data: { fileName: planned.voice.fileName, assetId: refOf(planned.voice.id) } }
    if (planned.cc.length) full.ccAssets = planned.cc.map((c) => ({ type: 'icon', uri: refOf(c.id), name: c.name, ext: 'png' }))
    // A stub is authoritative for the trash state, and its lastInteraction wins when newer (applyStubStateOnRestore); a unit never holds trashTime.
    const stubLastInteraction = planned.newerStub ? full.lastInteraction + 5000 : full.lastInteraction
    const restored = !planned.stub ? full : {
      ...full, lastInteraction: stubLastInteraction, ...(planned.trashed === 'stub' ? { trashTime: TRASH_TIME } : {}),
    }
    if (withProjections) addCharacterProjections(restored, chats)
    if (!planned.stub) return full
    units.push({ key: planned.stubKey, value: { character: full } })
    return {
      type: 'character', chaId: full.chaId, name: full.name, image: full.image, chatPage: 0, firstMsgIndex: -1, lastInteraction: stubLastInteraction,
      ...(planned.trashed === 'stub' ? { trashTime: TRASH_TIME } : {}),
      coldstorage: planned.stubKey, coldStoragedChats: [],
      // the fields applyCharacterDefaults would add to the slot at boot
      desc: '', firstMessage: '', emotionImages: [], customscript: [], globalLore: [], viewScreen: 'none', bias: [], characterVersion: '',
      creator: '', utilityBot: false, tags: [], systemPrompt: '', scenario: '',
      chats: [{ id: `${full.chaId}-stub-chat`, message: [{ time: T, data: '', role: 'char' }], note: '', name: '', localLore: [] }],
    }
  })
  const groups = plan.groups.map((planned) => {
    const memberIds = planned.members.map((index) => plan.characters[index].chaId)
    const chats = planned.chats.map((chat, c) => buildChat(1000 + planned.index + c, chat, c, memberIds))
    const full = {
      type: 'group', chaId: planned.chaId, name: `Synthetic Group ${planned.index}`, image: '', firstMessage: text(300),
      chatPage: planned.chatPage, lastInteraction: T + (cfg.characters + planned.index) * 1000,
      characters: memberIds, characterTalks: memberIds.map(() => 0.5), characterActive: memberIds.map(() => true),
      chats, customscript: [], globalLore: [], viewScreen: 'none', emotionImages: [],
    }
    if (withProjections) addCharacterProjections(full, chats)
    return full
  })

  const lorebookEntries = Math.max(1, Math.round(cfg.modulesMiB * MIB / cfg.modules / 1500))
  const modules = plan.modules.map((planned, m) => {
    const module = {
      id: planned.id, name: `Synthetic Module ${m}`, description: text(500),
      lorebook: loreBook(`m${m}`, planned.bytes === undefined ? lorebookEntries : Math.max(1, Math.round(planned.bytes / 1500)), 1400),
      regex: [{ comment: `r${m}`, in: 'a+', out: 'b', type: 'editprocess', flag: 'g' }],
      trigger: m % 3 === 0 ? [{ comment: `mt${m}`, type: 'manual', conditions: [], effect: [{ type: 'setvar', var: 'synthetic', operator: '=', value: String(m) }], lowLevelAccess: false }] : [],
      assets: planned.assets.map((a) => [a.label, refOf(a.id), 'png']),
    }
    // a manual Lua trigger never runs on its own, so a session does not start the Lua runtime
    if (planned.luaBytes > 0) module.trigger.push({ comment: `lua${m}`, type: 'manual', conditions: [], effect: [{ type: 'triggerlua', code: `-- ${text(planned.luaBytes)}\nfunction onSyntheticManual(id)\n  return nil\nend\n` }], lowLevelAccess: true })
    if (planned.icon >= 0) module.icon = refOf(planned.icon)
    if (withProjections) projections.modules[module.id] = project(module, [])
    return module
  })

  const misc = plan.misc
  // persona 0 mirrors the root user fields, as saveUserPersona keeps them
  const personas = misc.personas.map((p, i) => (i === 0
    ? { id: p.id, name: SETTINGS_VALUES.username, personaPrompt: SETTINGS_VALUES.personaPrompt, icon: refOf(misc.userIcon), note: SETTINGS_VALUES.userNote }
    : { id: p.id, name: `Persona ${i}`, personaPrompt: text(300), icon: refOf(p.icon), note: '' }))
  const botPresets = misc.presets.map((p, i) => ({ id: p.id, name: `Synthetic Preset ${i}`, temperature: 80, maxContext: 4000, maxResponse: 300, image: refOf(p.image), localNetworkMode: false, localNetworkTimeoutSec: 600, ...pick(cfg.rootSettings, cfg.presetSettings) }))
  // The first untrashed characters of the list move into folders; every other untrashed character or group stays in the
  // order by id. A trashed character is in no order entry (checkCharOrder leaves it out).
  const everyone = [...characters, ...groups]
  const orderable = everyone.filter((c) => !c.trashTime)
  const folderMembers = new Set()
  const folders = misc.folders.map((f, i) => {
    const data = orderable.slice(i * 3, i * 3 + 3).map((c) => c.chaId)
    for (const id of data) folderMembers.add(id)
    return { id: f.id, name: `Folder ${i}`, color: '', data, imgFile: refOf(f.image) }
  })
  const characterOrder = [...folders, ...orderable.map((c) => c.chaId).filter((id) => !folderMembers.has(id))]
  // The logical plugin storage is every key -> value; the stored form keeps the plain ones inline and gives the others to
  // upstream's index (pluginStorageIndex.ts): a small value as JSON text in the index unit, a large one as a unit of its own.
  const pluginLogical = Object.fromEntries(plan.pluginValues.map((p) => [p.key, { note: text(p.bytes), counter: p.bytes, list: ['a', 'b', 'c'] }]))
  const pluginCustomStorage = Object.fromEntries(plan.pluginValues.filter((p) => p.mode === 'plain').map((p) => [p.key, pluginLogical[p.key]]))
  const indexed = plan.pluginValues.filter((p) => p.mode !== 'plain')
  if (indexed.length > 0) {
    pluginCustomStorage._coldpluginIndex = plan.pluginIndexId
    units.push({
      key: plan.pluginIndexId,
      value: {
        type: 'risu-plugin-storage-index', version: 1, trash: [],
        entries: indexed.map((p) => (p.mode === 'small' ? { k: p.key, s: JSON.stringify(pluginLogical[p.key]) } : { k: p.key, l: p.unitId })),
      },
    })
    for (const p of indexed) if (p.mode === 'large') units.push({ key: p.unitId, value: pluginLogical[p.key] })
  }
  const loadouts = plan.loadouts.map((l, k) => ({
    name: `Synthetic Loadout ${k}`, id: l.id, lastUsed: T + k, favorite: k % 2 === 0,
    characterIds: [characters[k].chaId, characters[k + 1].chaId], modules: modules.slice(0, 2).map((module) => module.id),
    globalVariables: { synthetic_variable: String(k) }, presetName: botPresets[0].name, personaId: personas[0].id, icons: [refOf(plan.characters[k].avatar)],
  }))
  const statics = { messages: 1234, imports: 56 }
  const database = {
    formatversion: 5, characters: everyone, characterOrder, personas, modules, botPresets, loadouts, statics, pluginCustomStorage,
    userIcon: refOf(misc.userIcon), customBackground: refOf(misc.customBackground),
    ...SETTINGS_VALUES, ...cfg.rootSettings, enabledModules: modules.slice(0, 3).map((module) => module.id),
  }
  if (withProjections) {
    // The whole logical tree, one hash per root key: what the verifier's resolved tree must equal, order of every list included.
    const logical = { ...database, characters: projections.restored, pluginCustomStorage: pluginLogical }
    for (const key of Object.keys(logical).sort()) projections.parts[key] = { hash: sha256HexOf(canonical(logical[key])) }
  }
  return { database, units, projections }
}

// ---------------------------------------------------------------------------------------------------------------------
// entry names the importer treats specially must never be asset names (parseInlayEntryName, getColdStorageBackupKey)

const INLAY_NAME_PATTERN = /^risu-inlay-([0-9a-f]{64})-(0|[1-9][0-9]{0,6})\.part$/
const COLD_UNIT_NAME_PATTERN = /^(?:coldstorage[/_])?([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\.json$/
const ASSET_NAME_PATTERN = /^[0-9a-f]{64}\.[a-z0-9]{1,16}$/

function assertPlainAssetName(name) {
  if (!ASSET_NAME_PATTERN.test(name) || INLAY_NAME_PATTERN.test(name) || COLD_UNIT_NAME_PATTERN.test(name) || name === 'database.risudat') {
    throw new Error(`asset name ${name} would be read as something other than an asset`)
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// output

/** What the stub unit entries hold, counted from the units themselves (a unit that is not a stub's character is skipped). */
function stubUnitContent(units) {
  const characters = units.flatMap((unit) => (unit.value.character ? [unit.value.character] : []))
  return {
    characters: characters.length,
    globalLore: characters.filter((c) => c.globalLore.length > 0).length,
    triggerscript: characters.filter((c) => c.triggerscript.length > 0).length,
    vits: characters.filter((c) => c.vits !== undefined).length,
    ccAssets: characters.filter((c) => c.ccAssets !== undefined).length,
  }
}

function summarize(plan, extra) {
  const byKind = {}
  for (const asset of plan.assets) {
    const entry = byKind[asset.kind] ?? (byKind[asset.kind] = { count: 0, bytes: 0 })
    entry.count++
    entry.bytes += asset.size
  }
  const assetBytes = plan.assets.reduce((sum, a) => sum + a.size, 0)
  return {
    characters: plan.characters.length + plan.groups.length, groups: plan.groups.length, stubs: plan.characters.filter((c) => c.stub).length,
    trashed: plan.characters.filter((c) => c.trashed).length,
    chats: plan.characters.reduce((sum, c) => sum + c.chats.length, 0) + plan.groups.reduce((sum, g) => sum + g.chats.length, 0),
    modules: plan.modules.length, pluginValues: plan.pluginValues.length, loadouts: plan.loadouts.length,
    pluginMapped: { small: plan.pluginValues.filter((p) => p.mode === 'small').length, large: plan.pluginValues.filter((p) => p.mode === 'large').length },
    assets: plan.assets.length, assetBytes, assetGiB: +(assetBytes / (1024 * MIB)).toFixed(3),
    largestAssets: plan.assets.filter((a) => a.size >= 100 * MIB).map((a) => ({ kind: a.kind, ext: a.ext, bytes: a.size })),
    byKind, ...extra,
  }
}

function encodeDatabaseEntry(packr, database) {
  const packed = fflate.compressSync(packr.encode(database), { mtime: 0 })
  return Buffer.concat([DATABASE_HEADER, Buffer.from(packed.buffer, packed.byteOffset, packed.length)])
}

function main() {
  const opt = parseArguments(process.argv.slice(2))
  const cfg = SCALES[opt.scale]
  const plan = buildPlan(opt.seed, cfg)
  const packr = new Packr({ useRecords: false })

  if (opt.dryRun) {
    const placeholder = (id) => `assets/${'0'.repeat(64)}.${plan.assets[id].ext}`
    const { database, units } = buildDatabase(opt.seed, cfg, plan, placeholder, false)
    const databaseBytes = encodeDatabaseEntry(packr, database).length
    const unitBytes = units.reduce((sum, u) => sum + Buffer.byteLength(JSON.stringify(u.value)), 0)
    const entryHeaderBytes = plan.assets.length * (8 + 68) + units.length * (8 + 53) + 8 + 'database.risudat'.length
    const total = plan.assets.reduce((sum, a) => sum + a.size, 0) + unitBytes + databaseBytes + entryHeaderBytes
    console.log(JSON.stringify({ dryRun: true, scale: opt.scale, seed: opt.seed, ...summarize(plan, { unitEntries: units.length, stubUnitContent: stubUnitContent(units), unitBytes, databaseBytes, estimatedFileBytes: total, estimatedFileGiB: +(total / (1024 * MIB)).toFixed(3) }) }, null, 2))
    return
  }

  // pass one: the name of an asset is the hash of its bytes
  const names = new Set()
  for (const asset of plan.assets) {
    const hash = createHash('sha256')
    let produced = 0
    produceAsset(asset, (piece) => { hash.update(piece); produced += piece.length })
    if (produced !== asset.size) throw new Error(`asset ${asset.index} produced ${produced} bytes, planned ${asset.size}`)
    asset.sha256 = hash.digest('hex')
    asset.name = `${asset.sha256}.${asset.ext}`
    assertPlainAssetName(asset.name)
    if (names.has(asset.name)) throw new Error(`duplicate asset name ${asset.name}`)
    names.add(asset.name)
    if (asset.index % 5000 === 4999) console.error(`hashed ${asset.index + 1} of ${plan.assets.length} assets`)
  }

  const { database, units, projections } = buildDatabase(opt.seed, cfg, plan, (id) => 'assets/' + plan.assets[id].name, true)

  // pass two: write
  const partial = opt.out + '.partial'
  const fd = fs.openSync(partial, 'w')
  let fileBytes = 0
  let entryCount = 0
  const putAll = (buf) => {
    for (let offset = 0; offset < buf.length;) offset += fs.writeSync(fd, buf, offset, buf.length - offset)
    fileBytes += buf.length
  }
  const u32le = (value) => {
    if (!Number.isInteger(value) || value < 0 || value > 0xFFFFFFFF) throw new Error(`entry length ${value} does not fit a u32`)
    const out = Buffer.alloc(4)
    out.writeUInt32LE(value)
    return out
  }
  const putHeader = (name, dataLength) => {
    const nameBytes = Buffer.from(name, 'utf8')
    putAll(Buffer.concat([u32le(nameBytes.length), nameBytes, u32le(dataLength)]))
    entryCount++
  }
  try {
    for (const asset of plan.assets) {
      putHeader(asset.name, asset.size)
      const check = createHash('sha256')
      produceAsset(asset, (piece) => { check.update(piece); putAll(piece) })
      if (check.digest('hex') !== asset.sha256) throw new Error(`asset ${asset.index} differs between the two passes`)
      if (asset.index % 5000 === 4999) console.error(`wrote ${asset.index + 1} of ${plan.assets.length} assets`)
    }
    for (const unit of units) {
      const body = Buffer.from(JSON.stringify(unit.value), 'utf8')
      putHeader(`coldstorage_${unit.key}.json`, body.length)
      putAll(body)
    }
    const databaseEntry = encodeDatabaseEntry(packr, database)
    putHeader('database.risudat', databaseEntry.length)
    putAll(databaseEntry)
  } finally {
    fs.closeSync(fd)
  }
  const onDisk = fs.statSync(partial).size
  if (onDisk !== fileBytes) throw new Error(`file holds ${onDisk} bytes, wrote ${fileBytes}`)
  fs.renameSync(partial, opt.out)

  const manifest = {
    format: 'risu-synth-bin-manifest/1', generatorVersion: GENERATOR_VERSION, seed: opt.seed, scale: opt.scale,
    exclusions: { characterKeys: EXCLUDED_CHARACTER_KEYS, chatKeys: EXCLUDED_CHAT_KEYS },
    counts: { ...summarize(plan, { entries: entryCount, unitEntries: units.length, stubUnitContent: stubUnitContent(units), fileBytes }), parts: Object.keys(projections.parts).length },
    assets: Object.fromEntries(plan.assets.map((a) => [a.name, { sha256: a.sha256, bytes: a.size, kind: a.kind }])),
    characters: projections.characters, chats: projections.chats, modules: projections.modules, parts: projections.parts,
  }
  fs.writeFileSync(opt.out + '.manifest.json', JSON.stringify(manifest))
  console.log(JSON.stringify({ out: opt.out, manifest: opt.out + '.manifest.json', fileBytes, entries: entryCount, ...manifest.counts }, null, 2))
}

main()
