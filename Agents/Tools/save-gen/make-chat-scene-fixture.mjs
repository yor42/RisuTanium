// Importable .bin fixture for the CHORE-664 chat-scene measurements (memory and frames while a reply streams into a long chat).
// Plain Node ESM, no src/ imports. Synthetic data only; the one key-like value is the mock's throwaway proxyKey 'mock-key'.
//
//   node Agents/Tools/save-gen/make-chat-scene-fixture.mjs --out <dir outside the repo> [--seed 664] [--name c664-scene]
//        [--mock-url http://127.0.0.1:9471/v1/chat/completions] [--plain-fetch on|off]
//
// Writes <name>.bin and <name>-manifest.json into <out>. The bin holds five characters with one chat each:
//   C664 N30, C664 N300, C664 N600   30, 300 and 600 messages; roles alternate starting with char; char turns are heavy messages
//                                    (about 3 KB, about 121 DOM nodes) and user turns light messages, both imported unchanged from
//                                    make-c04-fixture.mjs
//   C664 N600 Prose                  600 messages of plain prose of about 1 KB on both roles
//   C664 R1                          30 messages like N30 plus the script profile: ten editoutput and ten editdisplay regex scripts
//                                    whose patterns are words the mock's sized reply contains (the output is $&, so the text is
//                                    unchanged and the cost is the regex work), and one Lua trigger that listens on editOutput and
//                                    rewrites the reply marker [mock-reply] to [mock-r3ply], so a DOM read proves the scripts ran
// Root settings point the app at the mock: aiModel reverse_proxy, forceReplaceUrl = --mock-url, proxyKey mock-key, useStreaming
// true and usePlainFetch true (--plain-fetch off writes false, for the Android app, where plain fetch must stay off). The
// streaming display optimisation mode is left unset so the app's default applies, and theme is '' (the chat shell needs it).
//
// File shape (copied from make-c04-fixture.mjs, which copied synth-bin-gen.mjs): [u32 LE name length][name][u32 LE data length][data]
// per entry; database.risudat is the 11-byte header [0,'RISUSAVE',0,8] followed by fflate.compressSync(msgpackr.encode(db),
// { mtime: 0 }). buildDatabase and entry of make-c04-fixture.mjs are not exported, so the framing and the database root and
// character shapes are copied here; the first device step (a real import through the app's load-backup UI) is the guard for them.
// The root mock fields follow rootSettings of synth-bin-gen.mjs. Character k (0-based) draws its message bodies from
// mulberry32((seed ^ 0x664664 ^ Math.imul(k + 1, 0x9E3779B1)) >>> 0), consumed in message order by the heavy and prose bodies.
// Same seed, name, mock URL and plain-fetch value give byte-identical files.
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { lightMessage, heavyMessage } from './make-c04-fixture.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const requireFromRepo = createRequire(path.join(REPO_ROOT, 'package.json'))
// make-c04-fixture.mjs, imported above, already clamps Buffer.prototype.utf8Write for msgpackr 1.10.1.
const { Packr } = requireFromRepo('msgpackr/index-no-eval')
const fflate = requireFromRepo('fflate')

const T = 1700000000000
const DATABASE_HEADER = Uint8Array.of(0, 82, 73, 83, 85, 83, 65, 86, 69, 0, 8)
const FILLER = ['amber', 'birch', 'cedar', 'dune', 'elm', 'fern', 'glen', 'heath', 'iris', 'juniper', 'kelp', 'larch', 'moss', 'nettle', 'oak', 'pine']
const SCRIPT_WORDS = FILLER.slice(0, 10)
const REPLY_MARKER = '[mock-reply]'
const MARKED_REPLY_MARKER = '[mock-r3ply]'
export const LUA_REWRITE = `listenEdit("editOutput", function(triggerId, data) return (string.gsub(data, "%[mock%-reply%]", "${MARKED_REPLY_MARKER}")) end)`
const SETTINGS_VALUES = {
  didFirstSetup: true, promptInfoInsideChat: false, username: 'Synthetic User', personaPrompt: 'Synthetic persona prompt.', userNote: 'Synthetic user note.',
  language: 'en', temperature: 80, maxContext: 4000, maxResponse: 500, iconsize: 100, zoomsize: 100, swipe: true, autoTranslate: false, theme: '',
  textTheme: 'standard', loreBookDepth: 5, loreBookToken: 800, selectedPersona: 0, botPresetsId: 0, globalNote: 'Synthetic global note.',
  additionalPrompt: 'Synthetic additional prompt.', descriptionPrefix: 'Synthetic description prefix: ', customCSS: '', globalChatVariables: {},
}
const PRESET_SETTING_KEYS = ['aiModel', 'subModel', 'forceReplaceUrl', 'customProxyRequestModel', 'customAPIFormat', 'autofillRequestUrl', 'proxyKey', 'useStreaming']
const DEFAULT_MOCK_URL = 'http://127.0.0.1:9471/v1/chat/completions'

export const CHARACTERS = [
  { name: 'C664 N30', messages: 30, kind: 'heavy', scripts: false },
  { name: 'C664 N300', messages: 300, kind: 'heavy', scripts: false },
  { name: 'C664 N600', messages: 600, kind: 'heavy', scripts: false },
  { name: 'C664 N600 Prose', messages: 600, kind: 'prose', scripts: false },
  { name: 'C664 R1', messages: 30, kind: 'heavy', scripts: true },
]

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

function makeUuid(rnd) {
  const hex = (n) => Array.from({ length: n }, () => '0123456789abcdef'[Math.floor(rnd() * 16)]).join('')
  return `${hex(8)}-${hex(4)}-4${hex(3)}-8${hex(3)}-${hex(12)}`
}

// Plain prose of about 1 KB: filler words, one blank line after the first 500 bytes, a trailing tag. No markup for the sanitizer.
function proseMessage(index, rnd) {
  const words = []
  let bytes = 0
  let broke = false
  while (bytes < 1000) {
    const word = FILLER[Math.floor(rnd() * FILLER.length)]
    words.push(word)
    bytes += word.length + 1
    if (!broke && bytes >= 500) { words.push('\n'); broke = true }
  }
  return `Prose ${index}: ` + words.join(' ').replace(/ \n /g, '\n\n') + ` end [P${index % 8}].`
}

function messageBodies(spec, rnd) {
  const bodies = []
  for (let m = 0; m < spec.messages; m++) {
    if (spec.kind === 'prose') bodies.push(proseMessage(m, rnd))
    else bodies.push(m % 2 === 0 ? heavyMessage(m, rnd).text : lightMessage(m).text)
  }
  return bodies
}

function scriptProfile() {
  const regex = (type, k) => ({ comment: `r1-${type}-${k}`, in: `\\b${SCRIPT_WORDS[k]}\\b`, out: '$&', type, ableFlag: true, flag: 'g' })
  return {
    customscript: [...SCRIPT_WORDS.map((_, k) => regex('editoutput', k)), ...SCRIPT_WORDS.map((_, k) => regex('editdisplay', k))],
    triggerscript: [{ comment: 'r1-lua', type: 'start', conditions: [], effect: [{ type: 'triggerlua', code: LUA_REWRITE }] }],
  }
}

function buildDatabase(seed, mockUrl, plainFetch) {
  const ids = mulberry32((seed ^ 0xD00D664) >>> 0)
  const characters = []
  const described = []
  CHARACTERS.forEach((spec, k) => {
    const rnd = mulberry32((seed ^ 0x664664 ^ Math.imul(k + 1, 0x9E3779B1)) >>> 0)
    const bodies = messageBodies(spec, rnd)
    const message = bodies.map((data, m) => ({ role: m % 2 === 0 ? 'char' : 'user', data, time: T + m * 60000 }))
    const chat = { id: makeUuid(ids), name: `${spec.name} chat`, note: '', localLore: [], message }
    const profile = spec.scripts ? scriptProfile() : { customscript: [], triggerscript: [] }
    characters.push({
      type: 'character', chaId: makeUuid(ids), name: spec.name, chatPage: 0, firstMsgIndex: -1, lastInteraction: T + (CHARACTERS.length - k) * 1000,
      desc: 'c664 synthetic character', firstMessage: 'Hello.', notes: '', alternateGreetings: [], image: '', additionalAssets: [], emotionImages: [],
      chats: [chat], customscript: profile.customscript, globalLore: [], triggerscript: profile.triggerscript, viewScreen: 'none', bias: [],
      characterVersion: '', creator: '', utilityBot: false, scenario: '', systemPrompt: '', tags: [],
    })
    const sizes = bodies.map((b) => Buffer.byteLength(b)).sort((a, b) => a - b)
    described.push({
      name: spec.name, chaId: characters[k].chaId, chatId: chat.id, messages: message.length, kind: spec.kind,
      editoutputScripts: profile.customscript.filter((s) => s.type === 'editoutput').length,
      editdisplayScripts: profile.customscript.filter((s) => s.type === 'editdisplay').length, luaTriggers: profile.triggerscript.length,
      messageBytes: { min: sizes[0], median: sizes[Math.floor(sizes.length / 2)], max: sizes[sizes.length - 1] },
    })
  })
  const rootSettings = {
    aiModel: 'reverse_proxy', subModel: 'reverse_proxy', forceReplaceUrl: mockUrl, customProxyRequestModel: 'mock-model', customAPIFormat: 0,
    autofillRequestUrl: true, proxyKey: 'mock-key', useStreaming: true, usePlainFetch: plainFetch, dynamicModelRegistry: false,
    useAutoSuggestions: false, useAutoTranslateInput: false, hypaV3: false, hypaMemory: false, supaModelType: 'none',
    emotionProcesser: 'submodel', hanuraiEnable: false, sdProvider: '', ttsAutoSpeech: false,
  }
  const presetSettings = Object.fromEntries(PRESET_SETTING_KEYS.map((key) => [key, rootSettings[key]]))
  const personaId = makeUuid(ids)
  const database = {
    formatversion: 5, characters, characterOrder: characters.map((c) => c.chaId),
    personas: [{ id: personaId, name: SETTINGS_VALUES.username, personaPrompt: SETTINGS_VALUES.personaPrompt, icon: '', note: SETTINGS_VALUES.userNote }],
    modules: [],
    botPresets: [{ id: makeUuid(ids), name: 'Synthetic Preset 0', temperature: 80, maxContext: 4000, maxResponse: 300, image: '', localNetworkMode: false, localNetworkTimeoutSec: 600, ...presetSettings }],
    loadouts: [], statics: { messages: 0, imports: 0 }, pluginCustomStorage: {}, userIcon: '', customBackground: '',
    ...SETTINGS_VALUES, ...rootSettings, enabledModules: [],
  }
  return { database, described }
}

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

export function generate({ seed = 664, mockUrl = DEFAULT_MOCK_URL, name = 'c664-scene', plainFetch = true } = {}) {
  const { database, described } = buildDatabase(seed, mockUrl, plainFetch)
  const packed = fflate.compressSync(new Packr({ useRecords: false }).encode(database), { mtime: 0 })
  const databaseEntry = Buffer.concat([DATABASE_HEADER, Buffer.from(packed.buffer, packed.byteOffset, packed.length)])
  const buffer = entry('database.risudat', databaseEntry)
  const manifest = {
    format: 'risu-c664-scene-manifest/1', seed, mockUrl, plainFetch, file: `${name}.bin`, bytes: buffer.length, sha256: sha256Hex(buffer),
    replyMarker: REPLY_MARKER, markedReplyMarker: MARKED_REPLY_MARKER, characters: described,
  }
  return { files: { [`${name}.bin`]: buffer }, manifest }
}

function main() {
  const argv = process.argv.slice(2)
  const opt = { out: null, seed: 664, name: 'c664-scene', mockUrl: DEFAULT_MOCK_URL, plainFetch: 'on' }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') opt.out = argv[++i]
    else if (argv[i] === '--seed') opt.seed = Number(argv[++i])
    else if (argv[i] === '--name') opt.name = argv[++i]
    else if (argv[i] === '--mock-url') opt.mockUrl = argv[++i]
    else if (argv[i] === '--plain-fetch') opt.plainFetch = argv[++i]
    else throw new Error('unknown argument ' + argv[i])
  }
  if (!opt.out) throw new Error('usage: node make-chat-scene-fixture.mjs --out <dir> [--seed 664] [--name c664-scene] [--mock-url <url>] [--plain-fetch on|off]')
  if (!Number.isInteger(opt.seed) || !/^[A-Za-z0-9._-]{1,64}$/.test(opt.name) || !/^http:\/\/[A-Za-z0-9.-]+:\d+\/v1\/chat\/completions$/.test(opt.mockUrl) || !['on', 'off'].includes(opt.plainFetch)) {
    throw new Error('bad option value: seed integer, name A-Z a-z 0-9 . _ -, mock-url http://<host>:<port>/v1/chat/completions, plain-fetch on|off')
  }
  const out = path.resolve(opt.out)
  const relative = path.relative(REPO_ROOT, out)
  if (relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)) throw new Error('--out must be outside the repository')
  const { files, manifest } = generate({ seed: opt.seed, mockUrl: opt.mockUrl, name: opt.name, plainFetch: opt.plainFetch === 'on' })
  fs.mkdirSync(out, { recursive: true })
  for (const [fileName, buffer] of Object.entries(files)) fs.writeFileSync(path.join(out, fileName), buffer)
  fs.writeFileSync(path.join(out, `${opt.name}-manifest.json`), JSON.stringify(manifest, null, 2))
  console.log(JSON.stringify({ out, files: Object.fromEntries(Object.entries(files).map(([fileName, b]) => [fileName, b.length])) }))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
