import type { JsonObject, JsonValue } from '../../blockFrame'
import type { Database } from '../../database.svelte'
import {
    ASSET_REF_V, IL_REF_V, readUnit, UNIT_TYPE,
    type AssetList, type InlayList, type KeyEnv, type UnitType,
} from '../../store2/format'
import {
    assembleDatabase, encodeDatabase, previousFrom, unitMapSource,
    type ConfigOwner, type EncodedTree, type EncodedUnit, type EncodeOptions, type ListDerivation,
} from '../../store2/codec'

/**
 * Fixtures of the codec tests: a seeded generator, a deterministic key
 * environment and list derivation, and profile builders shaped like the
 * project's T3 (maintainer-shaped), T4 (1000 characters), T5 (one long chat)
 * and legacy tiers. The builders reproduce the tiers' counts and shapes with the
 * byte volume scaled down (named at each builder), because the codec is
 * byte-size independent and the full tiers are 100 MB and more.
 */

export type Obj = Record<string, unknown>

export function mulberry32(seed: number): () => number {
    let a = seed | 0
    return () => {
        a = (a + 0x6d2b79f5) | 0
        let t = Math.imul(a ^ (a >>> 15), 1 | a)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

/** A key environment whose random bytes are a pure function of `seed` and of how many were drawn. */
export function seededEnv(seed: number, now = 1_700_000_000_000): KeyEnv {
    const rng = mulberry32(seed)
    return {
        random: length => Uint8Array.from({ length }, () => Math.floor(rng() * 256)),
        now: () => now,
    }
}

export function asDatabase(value: Obj): Database {
    return value as unknown as Database
}

// ---- injected list derivation (a fake: the real one is a later step) ----

const INLAY_TOKEN = /\{\{inlay::([0-9a-f-]{36})\}\}/g

function lowerBasename(path: string): string {
    return (path.split('/').pop() ?? path).toLowerCase()
}

function assetNames(owner: JsonObject): string[] {
    const names = new Set<string>()
    for (const key of ['additionalAssets', 'assets']) {
        const list = owner[key]
        if (Array.isArray(list)) {
            for (const row of list) {
                if (Array.isArray(row) && typeof row[1] === 'string') {
                    names.add(lowerBasename(row[1]))
                }
            }
        }
    }
    if (typeof owner.image === 'string' && owner.image.length > 0) {
        names.add(lowerBasename(owner.image))
    }
    return [...names].sort()
}

function inlayIds(owner: JsonObject): string[] {
    const ids = new Set<string>()
    const chats = owner.chats
    if (Array.isArray(chats)) {
        for (const chat of chats) {
            const messages = (chat as JsonObject).message
            if (Array.isArray(messages)) {
                for (const message of messages) {
                    const data = (message as JsonObject).data
                    if (typeof data === 'string') {
                        for (const match of data.matchAll(INLAY_TOKEN)) {
                            ids.add(match[1])
                        }
                    }
                }
            }
        }
    }
    return [...ids].sort()
}

function assetList(names: string[]): AssetList {
    return { v: ASSET_REF_V, h: '', l: names }
}

function inlayList(ids: string[]): InlayList {
    return { v: IL_REF_V, u: ids, h: '', o: [] }
}

/** Derives non-empty lists from the owners' content, so a test notices a derivation that was dropped. */
export const fakeLists: ListDerivation = {
    configAssets: (owner: ConfigOwner) => assetList([`config-${owner.presets.length}-${owner.plugins.length}`]),
    configInlays: () => inlayList([]),
    characterAssets: character => assetList(assetNames(character)),
    characterInlays: (character) => {
        const ids = inlayIds(character)
        return ids.length === 0 ? null : inlayList(ids)
    },
    moduleAssets: module => assetList(assetNames(module)),
    moduleInlays: () => null,
}

// ---- encode helpers ----

export function encodeWith(db: Database, extra: Partial<EncodeOptions> = {}): EncodedTree {
    return encodeDatabase(db, { env: seededEnv(1), lists: fakeLists, seq: 1, createdAt: 1_700_000_000_000, ...extra })
}

/** Encode, assemble and encode again with the key environment replayed from the same seed. */
export function roundTrip(db: Database, seed = 7): { first: EncodedTree, second: EncodedTree, assembled: Database } {
    const first = encodeWith(db, { env: seededEnv(seed) })
    const assembled = assembleDatabase(first.manifest, unitMapSource(first.units))
    const second = encodeWith(assembled, { env: seededEnv(seed) })
    return { first, second, assembled }
}

export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) {
        return false
    }
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
            return false
        }
    }
    return true
}

/** The identities whose unit differs between two encodes (bytes or presence), sorted. */
export function differingIdentities(a: EncodedTree, b: EncodedTree): string[] {
    const left = new Map(a.units.map(unit => [unit.identity, unit]))
    const right = new Map(b.units.map(unit => [unit.identity, unit]))
    const out: string[] = []
    for (const identity of new Set([...left.keys(), ...right.keys()])) {
        const x = left.get(identity)
        const y = right.get(identity)
        if (x === undefined || y === undefined || x.key !== y.key || !sameBytes(x.bytes, y.bytes)) {
            out.push(identity)
        }
    }
    return out.sort()
}

export function unitOf(tree: EncodedTree, identity: string): EncodedUnit {
    const unit = tree.units.find(candidate => candidate.identity === identity)
    if (unit === undefined) {
        throw new Error(`No unit "${identity}" in the encoding.`)
    }
    return unit
}

export function identitiesWhere(tree: EncodedTree, prefix: string): string[] {
    return tree.units.filter(unit => unit.identity.startsWith(prefix)).map(unit => unit.identity)
}

/** The parsed body of a unit, for an assertion. */
export function bodyOf(unit: EncodedUnit): JsonObject {
    const parsed = readUnit(unit.bytes, unit.type as UnitType)
    if (parsed.status !== 'ok' && parsed.status !== 'stale') {
        throw new Error(`Unit ${unit.identity} does not parse: ${parsed.reason}`)
    }
    return parsed.value.body as unknown as JsonObject
}

export function textOf(bytes: Uint8Array): string {
    return new TextDecoder().decode(bytes)
}

export { previousFrom, UNIT_TYPE }

// ---- profile builders ----

const WORDS = ['quiet', 'restless', 'familiar', 'uncertain', 'distant', 'sudden', 'gentle', 'sharp', 'faint', 'steady', 'nervous', 'warm']

export function prosePool(rng: () => number, count: number, min: number, max: number): string[] {
    return Array.from({ length: count }, () => {
        const target = min + Math.floor(rng() * (max - min + 1))
        let out = ''
        while (out.length < target) {
            out += (out ? ' ' : '') + WORDS[Math.floor(rng() * WORDS.length)] + ' ' + WORDS[Math.floor(rng() * WORDS.length)]
        }
        return out.slice(0, target)
    })
}

export function uuidLike(rng: () => number): string {
    const hex = () => Math.floor(rng() * 16).toString(16)
    const seg = (n: number) => Array.from({ length: n }, hex).join('')
    return `${seg(8)}-${seg(4)}-4${seg(3)}-a${seg(3)}-${seg(12)}`
}

function textOfSize(rng: () => number, pool: string[], bytes: number): string {
    if (bytes <= 0) {
        return ''
    }
    const parts: string[] = []
    let length = 0
    while (length < bytes) {
        const piece = pool[Math.floor(rng() * pool.length)]
        parts.push(piece)
        length += piece.length + 1
    }
    return parts.join(' ').slice(0, bytes)
}

export function message(rng: () => number, pool: string[], index: number, bytes: number, extra = false): Obj {
    const out: Obj = {
        role: index % 2 === 0 ? 'user' : 'char',
        data: textOfSize(rng, pool, bytes),
        time: 1_700_000_000_000 + index * 60_000,
    }
    if (extra) {
        out.generationInfo = { model: 'test-model', inputTokens: 100 + index, outputTokens: 50 }
        out.chatId = uuidLike(rng)
    }
    return out
}

export function chat(rng: () => number, index: number, messages: Obj[]): Obj {
    return {
        message: messages,
        note: '',
        name: `Chat ${index + 1}`,
        localLore: [],
        id: uuidLike(rng),
        lastDate: 1_700_000_000_000 + messages.length * 60_000,
    }
}

export function loreEntry(rng: () => number, pool: string[], index: number, bytes: number): Obj {
    return {
        key: `keyword-${index}`,
        secondkey: '',
        insertorder: index,
        comment: `Lore entry ${index}`,
        content: textOfSize(rng, pool, bytes),
        mode: 'normal',
        alwaysActive: rng() < 0.2,
        selective: false,
    }
}

/** The generator's character shape: it omits fields the application fills when a character is opened. */
export function sparseCharacter(rng: () => number, pool: string[], chaId: string, name: string, chats: Obj[], globalLore: Obj[]): Obj {
    return {
        type: 'character',
        name,
        image: '',
        firstMessage: pool[Math.floor(rng() * pool.length)],
        desc: pool[Math.floor(rng() * pool.length)],
        notes: 'synthetic note ' + chaId,
        chats,
        chatFolders: [],
        chatPage: 0,
        viewScreen: 'none',
        bias: [],
        emotionImages: [],
        globalLore,
        chaId,
        sdData: [],
        customscript: [],
        triggerscript: [],
        utilityBot: false,
        exampleMessage: pool[Math.floor(rng() * pool.length)],
        creatorNotes: 'creator notes ' + chaId,
        systemPrompt: '',
        postHistoryInstructions: '',
        alternateGreetings: [],
        tags: ['synthetic', 'profiling'],
        creator: 'synthetic-generator',
        characterVersion: '1.0',
        personality: 'personality ' + chaId,
        scenario: 'scenario ' + chaId,
        firstMsgIndex: -1,
        additionalText: '',
        replaceGlobalNote: '',
    }
}

function makeModule(rng: () => number, pool: string[], index: number, bytes: number): Obj {
    const module: Obj = {
        name: `Module ${index}`,
        description: `module ${index}`,
        id: uuidLike(rng),
        lorebook: Array.from({ length: Math.max(1, Math.floor(bytes / 700)) }, (_, i) => loreEntry(rng, pool, i, 400)),
        regex: [],
        trigger: [],
        assets: Array.from({ length: index % 5 }, (_, i) => [`asset-${i}`, `assets/${uuidLike(rng).replace(/-/g, '')}.png`, 'png']),
    }
    if (bytes > 0) {
        module.cjs = textOfSize(rng, pool, Math.floor(bytes / 2))
    }
    if (index % 7 === 0) {
        module.customModuleToggle = '<toggle>'
    }
    return module
}

function makePlugin(rng: () => number, pool: string[], index: number): Obj {
    return {
        name: `plugin-${index}`,
        displayName: `Plugin ${index}`,
        script: textOfSize(rng, pool, 2000 + (index % 5) * 500),
        arguments: { apiKey: 'string' },
        realArg: { apiKey: 'synthetic' },
        version: 2,
        customLink: [],
        argMeta: {},
        enabled: true,
    }
}

function globalParts(rng: () => number, pool: string[], moduleBytes: number, moduleCount: number, pluginCount: number): Obj {
    const modules = Array.from({ length: moduleCount }, (_, i) => makeModule(rng, pool, i, Math.floor(moduleBytes / Math.max(1, moduleCount))))
    const pluginCustomStorage: Obj = {}
    for (let i = 0; i < Math.max(pluginCount, 24); i++) {
        pluginCustomStorage[`plugin-${i}`] = { counter: i, items: Array.from({ length: 5 }, (_, k) => `item-${k}`) }
    }
    return {
        botPresets: Array.from({ length: 4 }, (_, i) => ({ name: `Preset ${i}`, mainPrompt: textOfSize(rng, pool, 800), jailbreak: '', temperature: 80 + i })),
        botPresetsId: 0,
        modules,
        loadouts: [],
        plugins: Array.from({ length: pluginCount }, (_, i) => makePlugin(rng, pool, i)),
        pluginV2: [makePlugin(rng, pool, 99)],
        pluginCustomStorage,
        personas: Array.from({ length: 5 }, (_, i) => ({ personaPrompt: textOfSize(rng, pool, 200), name: `Persona ${i}`, icon: '', id: uuidLike(rng), note: '' })),
        selectedPersona: 0,
        loreBook: [{ name: 'World Lore', data: [loreEntry(rng, pool, 0, 300)] }],
        username: 'Profiler',
        statics: { messages: 12, imports: 3 },
        formatversion: 5,
    }
}

export interface Profile {
    db: Database
    counts: { characters: number, chats: number, messages: number, modules: number, plugins: number }
}

/**
 * T3, maintainer-shaped: 500 characters, 770 chats, 2307 messages, 164 modules,
 * 14 plugins. The counts are the tier's; the byte volume is scaled down (messages
 * about 1 KB rather than 5.4 KB median, lore and modules about 1/30 of the tier).
 */
export function buildT3(): Profile {
    const rng = mulberry32(3000)
    const pool = prosePool(rng, 80, 200, 1600)
    const nChars = 500
    const nChats = 770
    const nMsgs = 2307
    const chatsPer = new Array<number>(nChars).fill(1)
    for (let i = 0; i < nChats - nChars; i++) {
        chatsPer[Math.floor(rng() * 200)]++
    }
    const chatMessages = new Array<number>(nChats).fill(0)
    for (let i = 0; i < nMsgs; i++) {
        chatMessages[Math.floor(Math.pow(rng(), 2.2) * nChats)]++
    }
    const characters: Obj[] = []
    let chatIndex = 0
    for (let c = 0; c < nChars; c++) {
        const chats: Obj[] = []
        for (let k = 0; k < chatsPer[c]; k++) {
            const count = chatMessages[chatIndex++]
            chats.push(chat(rng, k, Array.from({ length: count }, (_, m) => message(rng, pool, m, 200 + Math.floor(rng() * 1500), m % 2 === 1 && rng() < 0.3))))
        }
        const lore = Array.from({ length: Math.floor(Math.pow(rng(), 4) * 12) }, (_, i) => loreEntry(rng, pool, i, 300 + Math.floor(rng() * 900)))
        const slot = sparseCharacter(rng, pool, uuidLike(rng), `T3 Character ${c}`, chats, lore)
        if (c % 9 === 0) {
            slot.additionalAssets = [[`asset-${c}`, `assets/${uuidLike(rng).replace(/-/g, '')}.png`, 'png']]
        }
        characters.push(slot)
    }
    const g = globalParts(rng, pool, 1_100_000, 164, 14)
    const db = asDatabase({ ...g, characters, characterOrder: characters.map(slot => slot.chaId) })
    return { db, counts: { characters: nChars, chats: nChats, messages: nMsgs, modules: 164, plugins: 14 } }
}

/**
 * T4: 1000 characters of the project's "extreme" many-characters shape (a few big
 * characters, most small, 10% with one more chat). The message total is scaled to
 * 3,000 from the tier's 150,000.
 */
export function buildT4(): Profile {
    const rng = mulberry32(4000)
    const pool = prosePool(rng, 40, 200, 900)
    const nChars = 1000
    const characters: Obj[] = []
    let messages = 0
    let chats = 0
    for (let c = 0; c < nChars; c++) {
        const big = c < 10
        const chatCount = big ? 3 + (c % 4) : 1 + (c % 3)
        const chatList: Obj[] = []
        for (let k = 0; k < chatCount; k++) {
            const count = big ? 40 : 1 + ((c + k) % 3)
            messages += count
            chats++
            chatList.push(chat(rng, k, Array.from({ length: count }, (_, m) => message(rng, pool, m, 150 + Math.floor(rng() * 400)))))
        }
        characters.push(sparseCharacter(rng, pool, big ? `big-${c}` : `small-${c}`, `T4 Character ${c}`, chatList, big ? [loreEntry(rng, pool, 0, 500)] : []))
    }
    const g = globalParts(rng, pool, 300_000, 52, 14)
    const db = asDatabase({ ...g, characters, characterOrder: characters.map(slot => slot.chaId) })
    return { db, counts: { characters: nChars, chats, messages, modules: 52, plugins: 14 } }
}

/** T5: one long chat of `count` messages (200 to 900 bytes each); `big` puts one message of that many bytes at an index. */
export function buildT5Chat(count: number, big?: { at: number, bytes: number }, seed = 5000): Obj {
    const rng = mulberry32(seed)
    const pool = prosePool(rng, 60, 200, 900)
    const messages = Array.from({ length: count }, (_, i) =>
        message(rng, pool, i, big !== undefined && big.at === i ? big.bytes : 200 + Math.floor(rng() * 700), i % 2 === 1 && rng() < 0.15))
    const long = chat(rng, 0, messages)
    long.note = 'long chat'
    return long
}

/** A one-character profile around `chats`, with the global parts small. */
export function profileWithChats(chats: Obj[], seed = 11): Database {
    const rng = mulberry32(seed)
    const pool = prosePool(rng, 20, 100, 400)
    const slot = sparseCharacter(rng, pool, uuidLike(rng), 'Chat Holder', chats, [loreEntry(rng, pool, 0, 200)])
    const g = globalParts(rng, pool, 20_000, 2, 2)
    return asDatabase({ ...g, characters: [slot], characterOrder: [slot.chaId] })
}

/** A small profile for the guards that do not need volume. */
export function buildSmall(characters = 6): Database {
    const rng = mulberry32(1000)
    const pool = prosePool(rng, 30, 100, 800)
    const slots = Array.from({ length: characters }, (_, c) => {
        const messages = Array.from({ length: 6 }, (_, m) => message(rng, pool, m, 300))
        const slot = sparseCharacter(rng, pool, uuidLike(rng), `Small ${c}`, [chat(rng, 0, messages), chat(rng, 1, [message(rng, pool, 0, 100)])], [loreEntry(rng, pool, 0, 300)])
        if (c % 2 === 0) {
            slot.additionalAssets = [[`a-${c}`, `assets/${'a'.repeat(63)}${c}.PNG`, 'png']]
        }
        return slot
    })
    const g = globalParts(rng, pool, 30_000, 4, 3)
    return asDatabase({ ...g, characters: slots, characterOrder: slots.map(slot => slot.chaId) })
}

export interface LegacyCase {
    label: string
    character: Obj
}

/** Old fields, missing optional fields and the JSON edge values a live tree can hold. Each is one character. */
export function buildLegacyCases(): LegacyCase[] {
    const rng = mulberry32(7000)
    const pool = prosePool(rng, 20, 100, 500)
    const base = (name: string, mutate?: (slot: Obj) => void, chats?: Obj[], lore?: Obj[]): Obj => {
        const messages = Array.from({ length: 4 }, (_, m) => message(rng, pool, m, 200))
        const slot = sparseCharacter(rng, pool, uuidLike(rng), name, chats ?? [chat(rng, 0, messages)], lore ?? [loreEntry(rng, pool, 0, 150)])
        mutate?.(slot)
        return slot
    }
    const out: LegacyCase[] = []
    const add = (label: string, slot: Obj) => out.push({ label, character: slot })
    add('generator-sparse', base('generator-sparse'))
    add('postHistoryInstructions', base('phi', (c) => { c.postHistoryInstructions = 'Stay in character.' }))
    add('ttsMode-none', base('tts-none', (c) => { c.ttsMode = 'none' }))
    add('lore-bookVersion-1', base('lore-v1', undefined, undefined, [{ ...loreEntry(rng, pool, 0, 100), bookVersion: 1, activationPercent: 40 }]))
    add('chatPage-out-of-range', base('cp-high', (c) => { c.chatPage = 7 }))
    add('chatPage-negative', base('cp-neg', (c) => { c.chatPage = -1 }))
    add('chatPage-null', base('cp-null', (c) => { c.chatPage = null }))
    add('chatPage-fraction', base('cp-frac', (c) => { c.chatPage = 1.5 }))
    add('chatPage-string', base('cp-str', (c) => { c.chatPage = '0' }))
    add('chatPage-absent', base('cp-absent', (c) => { delete c.chatPage }))
    add('firstMsgIndex-absent', base('fmi-absent', (c) => { delete c.firstMsgIndex }))
    add('firstMsgIndex-positive', base('fmi-3', (c) => { c.firstMsgIndex = 3 }))
    add('chat-without-message', base('nomsg', (c) => { delete (c.chats as Obj[])[0].message }))
    add('chat-null-message', base('nullmsg', (c) => { (c.chats as Obj[])[0].message = null }))
    add('empty-chats', base('empty-chats', (c) => { c.chats = [] }))
    add('chats-absent', base('chats-absent', (c) => { delete c.chats }))
    add('chat-missing-id', base('chat-noid', (c) => { delete (c.chats as Obj[])[0].id }))
    add('chat-duplicate-id', base('chat-dupid', (c) => {
        const chats = c.chats as Obj[]
        chats.push({ ...chats[0], name: 'Copy' })
    }))
    add('chat-missing-localLore', base('chat-nolore', (c) => { delete (c.chats as Obj[])[0].localLore }))
    add('chat-streaming', base('streaming', (c) => { (c.chats as Obj[])[0].isStreaming = true; (c.chats as Obj[])[0].activeStreamingDisplayOptimizationMode = 'strong' }))
    add('type-absent', base('type-absent', (c) => { delete c.type }))
    add('numeric-chaId', base('num-id', (c) => { c.chaId = 4242 }))
    add('group', base('group', (c) => { c.type = 'group'; c.characters = ['a', 'b']; c.characterTalks = [0.5, 0.5]; c.characterActive = [true, true] }))
    add('group-no-members', base('group-nomem', (c) => { c.type = 'group' }))
    add('stamps', base('stamps', (c) => { c.lastInteraction = 1_700_000_000_000; c.trashTime = 1_700_000_001_000 }))
    add('reloadKeys', base('reload', (c) => { c.reloadKeys = 3 }))
    add('no-lore-no-scripts', base('bare', (c) => { delete c.globalLore; delete c.customscript; delete c.triggerscript }))
    add('derived-cold-fields-on-loaded', base('derived', (c) => { c.coldVersion = 3; c.coldChatCount = 2; c.coldStoragedChats = [] }))
    add('edge-undefined-prop', base('edge-undef', (c) => { c.image = undefined; (c.chats as Obj[])[0].lastDate = undefined }))
    add('edge-undefined-in-array', base('edge-arr-undef', (c) => { c.tags = ['a', undefined, 'b'] }))
    add('edge-NaN-Infinity', base('edge-nan', (c) => { c.depth_prompt = { depth: Number.NaN, prompt: 'x' }; c.creation_date = Number.POSITIVE_INFINITY }))
    add('edge-negative-zero', base('edge-negzero', (c) => { c.creation_date = -0 }))
    add('edge-lone-surrogate', base('edge-surrogate', (c) => { c.notes = 'x\ud800y' }))
    add('edge-line-separators', base('edge-ls', (c) => { c.desc = 'a b c\u0001d\u007f' }))
    add('edge-integer-like-keys', base('edge-intkeys', (c) => { (c.chats as Obj[])[0].scriptstate = JSON.parse('{"b":1,"10":2,"2":3,"a":4}') }))
    add('edge-proto-key', base('edge-proto', (c) => { (c.chats as Obj[])[0].scriptstate = JSON.parse('{"__proto__":{"x":1},"y":2}') }))
    add('edge-large-int', base('edge-numbers', (c) => { c.creation_date = 9007199254740993; c.modification_date = 0.1 + 0.2 }))
    add('edge-date-object', base('edge-date', (c) => { c.creation_date = new Date(1_700_000_000_000) }))
    add('inlay-token', base('inlay', (c) => {
        (c.chats as Obj[])[0].message = [message(rng, pool, 0, 50), { role: 'char', data: 'see {{inlay::0123abcd-0123-4123-a123-0123456789ab}}', time: 1 }]
    }))
    return out
}

export function dbWithCharacters(slots: Obj[], extra: Obj = {}): Database {
    const rng = mulberry32(21)
    const pool = prosePool(rng, 10, 50, 200)
    const g = globalParts(rng, pool, 5000, 1, 1)
    return asDatabase({ ...g, characters: slots, characterOrder: slots.map(slot => slot.chaId), ...extra })
}

export type { JsonObject, JsonValue }
