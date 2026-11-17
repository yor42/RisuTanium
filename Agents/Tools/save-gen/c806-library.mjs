// CHORE-806 stage 0: deterministic synthetic library builder (plain Node ESM, no src/ imports).
//
//   import { buildLibrary } from './c806-library.mjs'
//   const database = buildLibrary({ seed: 806, characters: 1000, chatsPerCharacter: 20, messagesPerChat: 1, modules: 180, archiveCharacters: true })
//
// buildLibrary returns a plain Database in the upstream-compatible legacy shape (what a .bin database entry decodes to), in
// the normalised form synth-bin-gen.mjs writes: unique chaIds, formatversion 5, didFirstSetup true, lorebook bookVersion 2.
// What differs from synth-bin-gen: no assets anywhere (every image field is empty), no stubs, groups, folders, trash, plugins
// or loadouts, no root provider settings, and the sizes below.
//
// Shape and sizes
//   - Character i depends only on (seed, i, the chat and message parameters), never on the library size, so a smaller
//     library is a prefix of a larger one (characters and modules alike).
//   - Message sizes: lognormal, median 5,400 B, sigma 0.8, clamped to 200..100,000 B (the CHORE-412 "real" profile).
//   - Messages per chat: lognormal count, median `messagesPerChat`, sigma `messageCountSigma` (0.9), rounded and clamped to
//     0..62 (62 is the real maximum). Sigma 0 gives exactly round(messagesPerChat) messages in every chat.
//   - Character bytes outside the chats follow the real 500-character profile (synth-bin-gen's device-units quantiles and
//     shares) with the message share left out, scaled by `nonChatScale` (1 = the real profile).
//   - Modules: lognormal sizes, median 72 KiB, sigma 1.452, maximum 3.4 MiB; the first three are enabled globally.
//   - archiveCharacters is always written explicitly (true or false), so a first boot never mutates the root setting.
//   - Optional `heavy: { index, chatsPerCharacter, messagesPerChat, messageCountMax }` gives character `index` its own chat and message
//     counts (exactly `messagesPerChat` messages in every chat). Its random stream is the plain one, so every other character is
//     byte-equal to the library without `heavy`; without `heavy` nothing changes.
// Text comes from synth-bin-gen's vocabulary (3,000 syllable words and 800 Hangul words); the Hangul share of the bytes is
// the real one per field. Every value is synthetic: no key, token or credential is ever written.
import { createHash } from 'node:crypto'

export const GENERATOR_ID = 'c806-library/1'

const KIB = 1024
const MIB = 1024 * KIB
const T = 1700000000000

export const MESSAGE_SIZE = { median: 5400, sigma: 0.8, min: 200, max: 100000 }
export const MODULE_SIZE = { median: 72 * KIB, sigma: 1.452, max: 3.4 * MIB }
export const UNIT_SHAPE = {
  // [fraction of characters at or below, raw unit bytes] of the real profile; log-linear in between
  quantiles: [[0, 2608], [0.05, 7553], [0.1, 10081], [0.2, 19736], [0.3, 30039], [0.4, 50907], [0.5, 79312], [0.6, 119131], [0.7, 190110],
    [0.8, 333328], [0.9, 566188], [0.95, 1010208], [0.97, 1253900], [0.99, 2218812], [1, 4702885]],
  // fractions of the real unit bytes; the message share (0.153) belongs to the chats here and is not drawn from this table
  share: { lore: 0.47, assetsAsLore: 0.14, firstMessage: 0.033, alternates: 0.033, customscript: 0.033, triggerscript: 0.021, desc: 0.024, rest: 0.03 },
  hangul: { lore: 0.069, message: 0.814, greeting: 0.52 },
  loreEntryBytes: 1940, scriptEntryBytes: 2000, alternateBytes: 3000,
}

// The configuration-root fields synth-bin-gen sets, without the device provider settings.
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

// ---------------------------------------------------------------------------------------------------------------------
// parameters

/** The parameters with defaults filled in; a refusal names the field. `archiveCharacters` must be given as a boolean. */
export function normalizeParams(input) {
  const params = {
    seed: input.seed ?? 806,
    characters: input.characters ?? 1000,
    chatsPerCharacter: input.chatsPerCharacter ?? 20,
    messagesPerChat: input.messagesPerChat ?? 1,
    messageCountSigma: input.messageCountSigma ?? 0.9,
    messageCountMax: input.messageCountMax ?? 62,
    modules: input.modules ?? 180,
    archiveCharacters: input.archiveCharacters,
    nonChatScale: input.nonChatScale ?? 1,
  }
  if (!Number.isInteger(params.seed) || params.seed < 0 || params.seed > 0xFFFFFFFF) throw new Error('seed must be an integer from 0 to 4294967295')
  for (const field of ['characters', 'chatsPerCharacter', 'modules', 'messageCountMax']) {
    if (!Number.isInteger(params[field]) || params[field] < 0) throw new Error(`${field} must be a non-negative integer`)
  }
  for (const field of ['messagesPerChat', 'messageCountSigma', 'nonChatScale']) {
    if (typeof params[field] !== 'number' || !Number.isFinite(params[field]) || params[field] < 0) throw new Error(`${field} must be a non-negative number`)
  }
  if (typeof params.archiveCharacters !== 'boolean') throw new Error('archiveCharacters must be set explicitly to true or false')
  // `heavy` is present in the result only when the input has it, so a plain library's parameters (and tree.json) stay as they were
  if (input.heavy !== undefined && input.heavy !== null) params.heavy = normalizeHeavy(input.heavy, params.characters)
  return params
}

/** One character built with its own chat and message counts: exactly `messagesPerChat` messages in each of `chatsPerCharacter` chats. */
function normalizeHeavy(heavy, characters) {
  const heavyParams = {
    index: heavy.index, chatsPerCharacter: heavy.chatsPerCharacter, messagesPerChat: heavy.messagesPerChat, messageCountSigma: 0,
    messageCountMax: heavy.messageCountMax ?? heavy.messagesPerChat,
  }
  for (const field of ['index', 'chatsPerCharacter', 'messagesPerChat', 'messageCountMax']) {
    if (!Number.isInteger(heavyParams[field]) || heavyParams[field] < 0) throw new Error(`heavy.${field} must be a non-negative integer`)
  }
  if (heavyParams.index >= characters) throw new Error('heavy.index must name a character of the library')
  if (heavyParams.messageCountMax < heavyParams.messagesPerChat) throw new Error('heavy.messageCountMax must not be below heavy.messagesPerChat')
  return heavyParams
}

/** The chat and message counts the heavy character must show in a census: null for a plain library. */
export function heavyExpected(input) {
  const { heavy } = normalizeParams(input)
  return heavy === undefined ? null : { index: heavy.index, chats: heavy.chatsPerCharacter, messages: heavy.chatsPerCharacter * heavy.messagesPerChat }
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

/** One random stream per (seed, kind, index): an entity never depends on how many others exist. */
function entityRandom(seed, kind, index) {
  const digest = createHash('sha256').update(`c806|${seed}|${kind}|${index}`).digest()
  return mulberry32(digest.readUInt32BE(0))
}

function gaussOf(rnd) {
  return Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd())
}

function uuidOf(rnd) {
  const hex = (n) => Array.from({ length: n }, () => '0123456789abcdef'[Math.floor(rnd() * 16)]).join('')
  return `${hex(8)}-${hex(4)}-4${hex(3)}-8${hex(3)}-${hex(12)}`
}

const vocabularies = new Map()

function vocabularyOf(seed) {
  let vocabulary = vocabularies.get(seed)
  if (vocabulary) return vocabulary
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
  vocabulary = { words, hangulWords, asciiBytes: words.map((word) => word.length), hangulBytes: hangulWords.map((word) => word.length * 3) }
  if (vocabularies.size > 4) vocabularies.clear()
  vocabularies.set(seed, vocabulary)
  return vocabulary
}

/** Text of about `bytes` UTF-8 bytes (a little under, by less than one word), `hangulShare` of it Hangul: an English-like block then a Hangul block. */
function textMaker(vocabulary, rnd) {
  const wordBlock = (list, wordBytes, bytes) => {
    const parts = []
    for (let length = 0;;) {
      const chosen = Math.floor(rnd() * list.length)
      length += wordBytes[chosen] + (parts.length > 0 ? 1 : 0)
      if (length > bytes) break
      parts.push(list[chosen])
    }
    return parts.join(' ')
  }
  return (bytes, hangulShare = 0) => {
    if (bytes < 1) return ''
    // a Hangul word has two syllables of three bytes on average and one separating space, so its letters are 6/7 of its bytes
    const hangulTotal = Math.floor(bytes * hangulShare * 7 / 6)
    const ascii = wordBlock(vocabulary.words, vocabulary.asciiBytes, bytes - hangulTotal)
    return hangulTotal > 0 ? ascii + ' ' + wordBlock(vocabulary.hangulWords, vocabulary.hangulBytes, hangulTotal - 1) : ascii
  }
}

function unitBytesAt(fraction) {
  const { quantiles } = UNIT_SHAPE
  let upper = 1
  while (upper < quantiles.length - 1 && quantiles[upper][0] < fraction) upper++
  const [lowFraction, lowBytes] = quantiles[upper - 1]
  const [highFraction, highBytes] = quantiles[upper]
  return lowBytes * (highBytes / lowBytes) ** ((fraction - lowFraction) / (highFraction - lowFraction))
}

function loreBook(text, tag, count, bytes) {
  return Array.from({ length: count }, (_, e) => ({
    key: `${tag}-k${e}`, secondkey: '', comment: `${tag}-c${e}`, content: text(bytes), mode: 'normal', insertorder: 100,
    alwaysActive: false, selective: false, bookVersion: 2,
  }))
}

// ---------------------------------------------------------------------------------------------------------------------
// characters, modules, root

function messageCountOf(params, rnd) {
  const draw = params.messagesPerChat * Math.exp(params.messageCountSigma * gaussOf(rnd))
  const count = params.messageCountSigma === 0 ? params.messagesPerChat : draw
  return Math.max(0, Math.min(params.messageCountMax, Math.round(count)))
}

function buildChat(params, text, rnd, variant, chatIndex) {
  const id = uuidOf(rnd)
  const count = messageCountOf(params, rnd)
  const message = Array.from({ length: count }, (_, m) => {
    const size = Math.round(Math.min(MESSAGE_SIZE.max, Math.max(MESSAGE_SIZE.min, MESSAGE_SIZE.median * Math.exp(MESSAGE_SIZE.sigma * gaussOf(rnd)))))
    const entry = { role: m % 2 === 0 ? 'char' : 'user', data: text(size, UNIT_SHAPE.hangul.message), time: T + m * 60000 }
    if (m % 5 === 0) entry.chatId = id
    return entry
  })
  const built = { id, name: `Chat ${chatIndex + 1}`, note: '', localLore: variant % 11 === 0 ? loreBook(text, `l${variant}`, 1, 400) : [], message }
  if (variant % 3 === 0) {
    built.lastMemory = text(200)
    built.scriptstate = { synthetic_counter: variant, synthetic_flag: true, synthetic_text: 'state' }
    built.suggestMessages = ['Yes.', 'No.']
    built.lastDate = T + variant * 1000
  }
  if (variant % 5 === 0) built.supaMemoryData = text(300)
  if (variant % 7 === 0) built.hypaV3Data = { summaries: [{ text: text(200), chatMemos: [id], isImportant: false }] }
  return built
}

/** Character `index` of the library: a function of (seed, index, chat and message parameters) only. */
export function buildCharacter(input, index) {
  const { heavy, ...plain } = normalizeParams(input)
  // the heavy character keeps its own random stream (seed, 'character', index); only its chat and message counts differ
  const params = heavy !== undefined && heavy.index === index ? { ...plain, ...heavy } : plain
  const rnd = entityRandom(params.seed, 'character', index)
  const text = textMaker(vocabularyOf(params.seed), rnd)
  const chaId = uuidOf(rnd)
  const bytes = unitBytesAt(rnd()) * params.nonChatScale
  const { share, hangul, loreEntryBytes, scriptEntryBytes, alternateBytes } = UNIT_SHAPE
  const spread = (total, entryBytes, make) => {
    const count = Math.max(1, Math.round(total / entryBytes))
    return Array.from({ length: count }, (_, k) => make(k, total / count))
  }
  const chats = Array.from({ length: params.chatsPerCharacter }, (_, c) => buildChat(params, text, rnd, index * params.chatsPerCharacter + c, c))
  return {
    type: 'character', chaId, name: `Synthetic ${index}`,
    chatPage: params.chatsPerCharacter > 0 ? Math.floor(rnd() * params.chatsPerCharacter) : 0,
    firstMsgIndex: Math.floor(rnd() * 3) - 1, lastInteraction: T + index * 1000,
    desc: text(bytes * share.desc), firstMessage: text(bytes * share.firstMessage, hangul.greeting), notes: '',
    backgroundHTML: text(bytes * share.rest * 0.43), defaultVariables: text(bytes * share.rest * 0.3), replaceGlobalNote: text(bytes * share.rest * 0.27),
    alternateGreetings: spread(bytes * share.alternates, alternateBytes, (k, each) => text(each, hangul.greeting)),
    image: '', additionalAssets: [], emotionImages: [],
    chats,
    customscript: spread(bytes * share.customscript, scriptEntryBytes, (k, each) => ({
      comment: `cu${index}-${k}`, in: '(?!)' + text(each * 0.2), out: text(each * 0.8), type: 'editprocess', flag: 'g',
    })),
    globalLore: spread(bytes * (share.lore + share.assetsAsLore), loreEntryBytes, (k, each) => ({
      key: `g${index}-k${k}`, secondkey: '', comment: `g${index}-c${k}`, content: text(each, hangul.lore), mode: 'normal', insertorder: 100,
      alwaysActive: false, selective: false, bookVersion: 2,
    })),
    triggerscript: spread(bytes * share.triggerscript, scriptEntryBytes, (k, each) => ({
      comment: `tu${index}-${k}`, type: 'manual', conditions: [], effect: [{ type: 'setvar', var: 'synthetic', operator: '=', value: text(each) }], lowLevelAccess: false,
    })),
    viewScreen: 'none', bias: [], characterVersion: '', creator: '', utilityBot: false, scenario: '', systemPrompt: '',
    tags: index % 3 === 0 ? ['synthetic', `tag${index % 5}`] : [],
  }
}

/** Module `index` of the library: a function of (seed, index) only. */
export function buildModule(input, index) {
  const params = normalizeParams(input)
  const rnd = entityRandom(params.seed, 'module', index)
  const text = textMaker(vocabularyOf(params.seed), rnd)
  const bytes = Math.min(MODULE_SIZE.max, MODULE_SIZE.median * Math.exp(MODULE_SIZE.sigma * gaussOf(rnd)))
  const module = {
    id: uuidOf(rnd), name: `Synthetic Module ${index}`, description: text(500),
    lorebook: loreBook(text, `m${index}`, Math.max(1, Math.round(bytes / 1500)), 1400),
    regex: [{ comment: `r${index}`, in: 'a+', out: 'b', type: 'editprocess', flag: 'g' }],
    trigger: index % 3 === 0 ? [{ comment: `mt${index}`, type: 'manual', conditions: [], effect: [{ type: 'setvar', var: 'synthetic', operator: '=', value: String(index) }], lowLevelAccess: false }] : [],
    assets: [],
  }
  // a manual Lua trigger never runs on its own, so a boot does not start the Lua runtime
  if (index % 60 === 0) module.trigger.push({ comment: `lua${index}`, type: 'manual', conditions: [], effect: [{ type: 'triggerlua', code: `-- ${text(2000)}\nfunction onSyntheticManual(id)\n  return nil\nend\n` }], lowLevelAccess: true })
  return module
}

/**
 * The root database over already built characters and modules. `characters` is not copied. The root values are drawn from
 * their own stream, so they do not change with the library size.
 */
export function buildRoot(input, characters, modules) {
  const params = normalizeParams(input)
  const rnd = entityRandom(params.seed, 'root', 0)
  const text = textMaker(vocabularyOf(params.seed), rnd)
  const personas = Array.from({ length: 5 }, (_, k) => (k === 0
    ? { id: uuidOf(rnd), name: SETTINGS_VALUES.username, personaPrompt: SETTINGS_VALUES.personaPrompt, icon: '', note: SETTINGS_VALUES.userNote }
    : { id: uuidOf(rnd), name: `Persona ${k}`, personaPrompt: text(300), icon: '', note: '' }))
  const botPresets = Array.from({ length: 3 }, (_, k) => ({
    id: uuidOf(rnd), name: `Synthetic Preset ${k}`, temperature: 80, maxContext: 4000, maxResponse: 300, image: '', localNetworkMode: false, localNetworkTimeoutSec: 600,
  }))
  return {
    formatversion: 5, characters, characterOrder: characters.map((character) => character.chaId), personas, modules, botPresets, loadouts: [],
    statics: { messages: 1234, imports: 56 }, pluginCustomStorage: {}, userIcon: '', customBackground: '',
    ...SETTINGS_VALUES, enabledModules: modules.slice(0, 3).map((module) => module.id), archiveCharacters: params.archiveCharacters,
  }
}

/** The whole library. `options.onCharacter(index)` is called after each character, for a caller that watches memory. */
export function buildLibrary(input, options = {}) {
  const params = normalizeParams(input)
  const characters = []
  for (let i = 0; i < params.characters; i++) {
    characters.push(buildCharacter(params, i))
    options.onCharacter?.(i)
  }
  const modules = Array.from({ length: params.modules }, (_, m) => buildModule(params, m))
  return buildRoot(params, characters, modules)
}

// ---------------------------------------------------------------------------------------------------------------------
// what a built library holds, counted from the object itself

/** Counts of a library, to compare with the parameters and with a census of the stored tree. */
export function libraryCounts(database) {
  let chats = 0
  let messages = 0
  let messageBytes = 0
  for (const character of database.characters) {
    chats += character.chats.length
    for (const chat of character.chats) {
      messages += chat.message.length
      for (const message of chat.message) messageBytes += Buffer.byteLength(message.data, 'utf8')
    }
  }
  return {
    characters: database.characters.length, chats, messages, messageBytes, modules: database.modules.length,
    enabledModules: database.enabledModules.length, archiveCharacters: database.archiveCharacters,
  }
}

/** sha256 of the JSON of characters [from, to): equal for equal content, whatever the library size. */
export function charactersDigest(database, from, to) {
  const hash = createHash('sha256')
  for (let i = from; i < to; i++) hash.update(JSON.stringify(database.characters[i]))
  return hash.digest('hex')
}

/** sha256 of the JSON of the whole database. */
export function databaseDigest(database) {
  return createHash('sha256').update(JSON.stringify(database)).digest('hex')
}

/** UTF-8 bytes of the JSON of one character: the "character data" the size sweep adds up. */
export function characterJsonBytes(character) {
  return Buffer.byteLength(JSON.stringify(character), 'utf8')
}
