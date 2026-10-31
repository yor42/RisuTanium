/**
 * Read-only size report over a real RisuAI `.bin` backup (any size, built for
 * ~36 GB), feeding the A-lite storage rewrite's stage 1+3 freeze (Report 62,
 * Q-D): rule out any storage unit near the Node server's 100 MiB body limit
 * and size the per-unit ceilings of A-lite's unit split.
 *
 * Run (from the repo root; PowerShell):
 *   $env:RISU_SIZE_BIN = '<path to .bin>'
 *   $env:NODE_OPTIONS = '--max-old-space-size=16384'
 *   npx vitest run --config Agents/Tools/vitest.harness.config.ts real-size-report
 * Without RISU_SIZE_BIN the test is skipped, so other harness runs are not
 * affected. RISU_SIZE_PARSE_LIMIT_MIB (default 256) is the largest archived
 * cold-storage entry that is parsed to split it into units; larger ones are
 * reported whole and flagged as not split.
 *
 * The report also holds a `store2` section (store2-census.ts): the real unit
 * codec and list derivation run over the decoded database, one owner at a time,
 * with archived characters and chats re-attached from the cold units this pass
 * retains. RISU_CENSUS_COLD_RETAIN_MIB (default 8192) caps the raw cold bodies
 * kept for that (Buffers, outside the JS heap); units beyond it are counted as
 * not retained and their owners skipped. RISU_SIZE_OUTPUT_DIR overrides the
 * output directory (the synthetic fixture test uses it).
 *
 * The report also holds a `chatMemory` section: per chat memory field
 * (hypaV2Data, hypaV3Data, supaMemoryData, lastMemory) over live and archived
 * chats, the number of chats holding it, p50/p95/max JSON bytes, the top 10
 * sizes with each chat's message count, a 64 KiB / 256 KiB / 1 MiB histogram,
 * and entry-count distributions (HypaV3 summaries, HypaV2 mainChunks, chunks).
 * Sizes and counts only. The same per-chat figures also appear under
 * `kinds` as `chat.mem.*` and `archivedChat.mem.*`.
 *
 * Guarantees:
 * - The input is opened read-only (`fs.openSync(..., 'r')`) and never written,
 *   renamed or touched. The only file written is
 *   Agents/Tools/output/real-size-report.json (gitignored).
 * - The container is scanned once, front to back, in 32 MiB sequential reads
 *   (no per-entry seeking, which is hours on a spinning or USB disk). Asset and
 *   inlay bodies are skipped through the stream, only their sizes recorded.
 *   Only the database entry and cold-storage entries (up to the parse limit)
 *   are held in memory. Progress goes to stderr about every 10 s.
 * - Privacy: the report holds sizes, counts and ordinals only. No names, ids,
 *   content, config field names or asset file names are ever emitted.
 *
 * Container format (src/ts/drive/backupContainer.ts, written by the
 * LocalWriter in backuplocal.ts): a flat sequence of
 * [u32le nameLength][name][u32le dataLength][data], no header or trailer.
 * Entry classes follow the restore pass: `database.risudat` (the last one
 * wins), cold-storage units (`coldstorage_<uuid>.json`, plain UTF-8 JSON),
 * inlay parts (`risu-inlay-*.part`), and everything else is an asset.
 *
 * SIZE MEASURE: every byte figure is the UTF-8 byte length of the piece's
 * JSON serialisation (JSON.stringify semantics, undefined keys omitted).
 * Whole-chat and whole-unit figures are exact; `character.total` is the sum of
 * its core, lore, scripts and chat sizes (JSON punctuation between the parts
 * excluded). Kinds whose unit is `count` hold counts, not bytes.
 *
 * Unit split (Report 62 "Units" and the character type):
 * - lore    = `globalLore`
 * - scripts = `customscript`, `triggerscript`, `virtualscript`
 * - core    = the character minus `chats`, lore and scripts
 * - chat    = whole chat; chat core = chat minus `message`; chunks = greedy
 *             packing of whole messages into 128 KiB chunks (a larger message
 *             takes a chunk alone)
 * - config root = database minus characters, modules, botPresets, loadouts,
 *             plugins and pluginCustomStorage
 * Ordinals are 0-based positions in the decoded arrays, or entry order in the
 * file for assets and cold units.
 *
 * The mocks follow src/ts/storage/tests/risuSave.test.ts (including its
 * appStore mock: the real store starts async work that throws after the test
 * environment is torn down) so the repo's real decoder runs headlessly. Unlike
 * generate-and-verify.harness.ts, Buffer stays defined: that harness removes it
 * for msgpackr's encode path only, and this one only decodes.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as v8 from 'node:v8'
import { fileURLToPath } from 'node:url'
import type { ForageLike } from 'src/ts/storage/tests/forageBackedStore'

//#region module mocks — same set as generate-and-verify.harness.ts
const store = new Map<string, unknown>()

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async (key: string) => store.get(key) ?? null),
            setItem: vi.fn(async (key: string, value: unknown) => {
                store.set(key, value)
            }),
            removeItem: vi.fn(async (key: string) => {
                store.delete(key)
            }),
        }),
    },
}))

vi.mock(
    import('src/ts/globalApi.svelte'),
    () =>
        ({
            forageStorage: {
                keys: vi.fn(async () => []),
                getItem: vi.fn(async () => null),
                setItem: vi.fn(async () => {}),
            },
            // The cold-storage and inlay modules pull in characters.ts, whose
            // avatar helper binds this export at load.
            readImage: vi.fn(async () => new Uint8Array()),
        }) as unknown as typeof import('src/ts/globalApi.svelte'),
)

vi.mock(import('src/ts/storage/store/appStore'), async () => {
    const { appStoreModuleOver } = await import('src/ts/storage/tests/appStoreMock')
    const { forageStorage } = await import('src/ts/globalApi.svelte')
    return appStoreModuleOver(() => forageStorage as unknown as ForageLike) as unknown as typeof import('src/ts/storage/store/appStore')
})

vi.mock(
    import('src/ts/storage/database.svelte'),
    () =>
        ({
            getDatabase: vi.fn(() => { throw new Error('no live database in tests') }),
            presetTemplate: { name: 'test-preset' },
        }) as unknown as typeof import('src/ts/storage/database.svelte'),
)

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(),
    readFile: vi.fn(),
    BaseDirectory: { AppData: 0 },
}))
//#endregion

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUTPUT_DIR = process.env.RISU_SIZE_OUTPUT_DIR ? path.resolve(process.env.RISU_SIZE_OUTPUT_DIR) : path.resolve(__dirname, '../output')
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'real-size-report.json')

const BIN_PATH = process.env.RISU_SIZE_BIN
const PARSE_LIMIT_BYTES = (Number(process.env.RISU_SIZE_PARSE_LIMIT_MIB) || 256) * 1024 * 1024
/** Cold-unit bodies the store2 census keeps in memory (as raw UTF-8 buffers, outside the JS heap). */
const COLD_RETAIN_BYTES = (Number(process.env.RISU_CENSUS_COLD_RETAIN_MIB) || 8192) * 1024 * 1024
const TEST_TIMEOUT_MS = 2 * 60 * 60 * 1000

const KIB = 1024
const MIB = 1024 * KIB
const GIB = 1024 * MIB
const CHUNK_CAP_BYTES = 128 * KIB
const FLAG_50_MIB = 50 * MIB
const FLAG_100_MIB = 100 * MIB
/** Entry names longer than this are never decoded (only DB, cold-unit and inlay names are short). */
const NAME_READ_LIMIT = 1024

//#region plain-data helpers (no `any`: unknown at the boundary, narrowed here)
type Rec = Record<string, unknown>

function asRec(value: unknown): Rec | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Rec) : null
}

function asArr(value: unknown): unknown[] {
    return Array.isArray(value) ? value : []
}

let unmeasurableValues = 0

function utf8Length(text: string): number {
    return Buffer.byteLength(text, 'utf8')
}

/** Streaming JSON length for values too large for one string (or holding what stringify rejects). */
function walkJsonBytes(value: unknown): number {
    if (value === null) return 4
    switch (typeof value) {
        case 'boolean': return value ? 4 : 5
        case 'number': return Number.isFinite(value) ? String(value).length : 4
        case 'string': return utf8Length(JSON.stringify(value))
        case 'bigint': unmeasurableValues++; return 0
        case 'undefined': case 'function': case 'symbol': return 0
        default: break
    }
    const withToJson = value as { toJSON?: unknown }
    if (typeof withToJson.toJSON === 'function') {
        return walkJsonBytes((withToJson.toJSON as () => unknown)())
    }
    if (Array.isArray(value)) {
        let total = 2 + Math.max(value.length - 1, 0)
        for (const element of value) {
            const t = typeof element
            total += element === undefined || t === 'function' || t === 'symbol' ? 4 : walkJsonBytes(element)
        }
        return total
    }
    const record = value as Rec
    let total = 2
    let members = 0
    for (const key of Object.keys(record)) {
        const member = record[key]
        const t = typeof member
        if (member === undefined || t === 'function' || t === 'symbol') continue
        total += utf8Length(JSON.stringify(key)) + 1 + walkJsonBytes(member)
        members++
    }
    return total + Math.max(members - 1, 0)
}

/** UTF-8 byte length of JSON.stringify(value); 0 for a value JSON omits. */
function jsonBytes(value: unknown): number {
    if (value === undefined) return 0
    try {
        const text = JSON.stringify(value)
        return text === undefined ? 0 : utf8Length(text)
    } catch {
        return walkJsonBytes(value)
    }
}

/** The record without the named keys (shallow). */
function without(record: Rec, omit: ReadonlySet<string>): Rec {
    const out: Rec = {}
    for (const key of Object.keys(record)) {
        if (!omit.has(key)) out[key] = record[key]
    }
    return out
}

/** Exact JSON length of an array whose elements have the given JSON lengths. */
function arrayBytesFrom(sizes: readonly number[]): number {
    return 2 + Math.max(sizes.length - 1, 0) + sizes.reduce((a, b) => a + b, 0)
}
//#endregion

//#region statistics
type Unit = 'bytes' | 'count'

interface FlaggedUnit { kind: string; ordinal: string; size: number }

class KindStats {
    readonly sizes: number[] = []
    readonly ordinals: string[] = []
    constructor(readonly unit: Unit) {}
    add(ordinal: string, size: number): void {
        this.ordinals.push(ordinal)
        this.sizes.push(size)
    }
}

const kinds = new Map<string, KindStats>()
const flagged50: FlaggedUnit[] = []
const flagged100: FlaggedUnit[] = []
const scalars: Record<string, { bytes: number; count?: number }> = {}

interface PendingRecord { kind: string; ordinal: string; size: number; unit: Unit }

/** While set, measurements are collected here instead of recorded (cold units are measured before their class is known). */
let recordSink: PendingRecord[] | null = null

function record(kind: string, ordinal: string, size: number, unit: Unit = 'bytes'): void {
    if (recordSink) {
        recordSink.push({ kind, ordinal, size, unit })
        return
    }
    applyRecord(kind, ordinal, size, unit)
}

function applyRecord(kind: string, ordinal: string, size: number, unit: Unit): void {
    let stats = kinds.get(kind)
    if (!stats) {
        stats = new KindStats(unit)
        kinds.set(kind, stats)
    }
    stats.add(ordinal, size)
    if (unit === 'bytes') {
        if (size >= FLAG_100_MIB) flagged100.push({ kind, ordinal, size })
        if (size >= FLAG_50_MIB) flagged50.push({ kind, ordinal, size })
    }
}

function percentile(sortedAscending: readonly number[], p: number): number {
    if (sortedAscending.length === 0) return 0
    const rank = Math.max(Math.ceil(p * sortedAscending.length) - 1, 0)
    return sortedAscending[Math.min(rank, sortedAscending.length - 1)]
}

function topTen(stats: KindStats): { ordinal: string; size: number }[] {
    const order = stats.sizes.map((_, i) => i).sort((a, b) => stats.sizes[b] - stats.sizes[a])
    return order.slice(0, 10).map((i) => ({ ordinal: stats.ordinals[i], size: stats.sizes[i] }))
}

function summarize(stats: KindStats) {
    const sorted = [...stats.sizes].sort((a, b) => a - b)
    return {
        unit: stats.unit,
        count: sorted.length,
        max: sorted.length ? sorted[sorted.length - 1] : 0,
        p50: percentile(sorted, 0.5),
        p95: percentile(sorted, 0.95),
        top10: topTen(stats),
    }
}
//#endregion

//#region asset references
/**
 * The key a reference value names: mirrors getBasename in
 * src/ts/globalApi.svelte.ts, the normalisation getUncleanablesSync applies
 * (that module is mocked here, so it is mirrored rather than imported). A
 * non-string or empty value is no reference, as in addUncleanable.
 */
function refKey(value: unknown): string | null {
    if (typeof value !== 'string' || value === '') return null
    const parts = value.replace(/\\/g, '/').split('/')
    return parts[parts.length - 1]
}

/**
 * Adds the asset keys one character or group chat references, over the fields
 * getUncleanablesSync scans: image, emotionImages[][1], additionalAssets[][1],
 * vits.files values, gptSoVitsConfig.ref_audio_data.assetId and (non-group
 * only) ccAssets[].uri.
 */
function collectCharacterRefs(cha: Rec | null, into: Set<string>): void {
    if (!cha) return
    const add = (value: unknown) => {
        const key = refKey(value)
        if (key !== null) into.add(key)
    }
    add(cha.image)
    for (const em of asArr(cha.emotionImages)) add(asArr(em)[1])
    for (const em of asArr(cha.additionalAssets)) add(asArr(em)[1])
    const vitsFiles = asRec(asRec(cha.vits)?.files)
    if (vitsFiles) for (const key of Object.keys(vitsFiles)) add(vitsFiles[key])
    add(asRec(asRec(cha.gptSoVitsConfig)?.ref_audio_data)?.assetId)
    if (cha.type !== 'group') for (const asset of asArr(cha.ccAssets)) add(asRec(asset)?.uri)
}

/** A module's (or a persona's embedded module's) references: assets[][1] and icon. */
function collectModuleRefs(mod: Rec | null, into: Set<string>): void {
    if (!mod) return
    for (const asset of asArr(mod.assets)) {
        const key = refKey(asArr(asset)[1])
        if (key !== null) into.add(key)
    }
    const icon = refKey(mod.icon)
    if (icon !== null) into.add(icon)
}

/** Persona icon and embedded module, as getUncleanablesSync scans them. */
function collectPersonaRefs(persona: Rec | null, into: Set<string>): void {
    if (!persona) return
    const icon = refKey(persona.icon)
    if (icon !== null) into.add(icon)
    collectModuleRefs(asRec(persona.embeddedModule), into)
}

/** Database-level references: background, user icon, NAI and wavespeed images, characterOrder imgFile. */
function collectDatabaseLevelRefs(decoded: Rec, into: Set<string>): void {
    const values: unknown[] = [
        decoded.customBackground,
        decoded.userIcon,
        asRec(decoded.NAIImgConfig)?.image,
        asRec(decoded.NAIImgConfig)?.character_image,
        asRec(decoded.wavespeedImage)?.reference_image,
    ]
    for (const item of asArr(decoded.characterOrder)) {
        const holder = asRec(item)
        if (holder && 'imgFile' in holder) values.push(holder.imgFile)
    }
    for (const value of values) {
        const key = refKey(value)
        if (key !== null) into.add(key)
    }
}

/** An asset key named by a sha256 hex stem, with an optional extension. */
const HASH_KEY = /^[0-9a-f]{64}(\.[A-Za-z0-9]+)?$/i
/** JSON bytes of a base64url-encoded 32-byte digest as a string: 43 characters and two quotes. */
const BASE64URL_SHA256_JSON_BYTES = 45

/** JSON array sizes of one reference list under the two candidate encodings. */
function encodedRefBytes(keys: Iterable<string>) {
    const full: number[] = []
    const hash: number[] = []
    const nonHashFull: number[] = []
    for (const key of keys) {
        const size = jsonBytes(key)
        full.push(size)
        if (HASH_KEY.test(key)) hash.push(BASE64URL_SHA256_JSON_BYTES)
        else nonHashFull.push(size)
    }
    return {
        fullKeyJsonBytes: arrayBytesFrom(full),
        hashKeyCount: hash.length,
        base64urlStemJsonBytes: arrayBytesFrom(hash),
        nonHashKeyCount: nonHashFull.length,
        nonHashFullKeyJsonBytes: arrayBytesFrom(nonHashFull),
    }
}

const REF_BUCKETS: readonly { label: string; min: number; max: number }[] = [
    { label: '0', min: 0, max: 0 },
    { label: '1', min: 1, max: 1 },
    { label: '2-5', min: 2, max: 5 },
    { label: '6-20', min: 6, max: 20 },
    { label: '21-50', min: 21, max: 50 },
    { label: '51-200', min: 51, max: 200 },
    { label: '201-1000', min: 201, max: 1000 },
    { label: '>1000', min: 1001, max: Infinity },
]

/** Count distribution of per-owner distinct reference counts, with total, histogram and top 10 by ordinal. */
function refDistribution(stats: KindStats) {
    const histogram: Record<string, number> = {}
    for (const bucket of REF_BUCKETS) {
        histogram[bucket.label] = stats.sizes.filter((n) => n >= bucket.min && n <= bucket.max).length
    }
    return { ...summarize(stats), total: stats.sizes.reduce((a, b) => a + b, 0), histogram }
}
//#endregion

//#region unit measurement
const CHARACTER_SCRIPT_KEYS = ['customscript', 'triggerscript', 'virtualscript'] as const
const CHARACTER_SPLIT_OUT = new Set<string>(['chats', 'globalLore', ...CHARACTER_SCRIPT_KEYS])
const CHAT_SPLIT_OUT = new Set<string>(['message'])

/** Chat-level memory stores; only their sizes and entry counts are ever read. */
const CHAT_MEMORY_FIELDS = ['hypaV2Data', 'hypaV3Data', 'supaMemoryData', 'lastMemory'] as const
const MEMORY_HISTOGRAM_BUCKETS: readonly { label: string; min: number; max: number }[] = [
    { label: '<64KiB', min: 0, max: 64 * KIB - 1 },
    { label: '64KiB-256KiB', min: 64 * KIB, max: 256 * KIB - 1 },
    { label: '256KiB-1MiB', min: 256 * KIB, max: MIB - 1 },
    { label: '>=1MiB', min: MIB, max: Infinity },
]

let messagesOver128KiB = 0
let pointerChats = 0

/**
 * Per memory field across live and archived chats: chats holding it, p50, p95,
 * max, top 10 sizes with the chat's message count, a size histogram and the
 * entry-count distributions. No ordinals, ids or content are emitted.
 */
function summarizeChatMemory(): Rec {
    const scopes = ['chat', 'archivedChat']
    const out: Rec = {}
    for (const field of CHAT_MEMORY_FIELDS) {
        const entries: { size: number; messages: number }[] = []
        for (const scope of scopes) {
            const stats = kinds.get(`${scope}.mem.${field}`)
            if (!stats) continue
            const messageByOrdinal = new Map<string, number>()
            const messages = kinds.get(`${scope}.messages`)
            if (messages) messages.ordinals.forEach((o, i) => messageByOrdinal.set(o, messages.sizes[i]))
            stats.ordinals.forEach((o, i) => entries.push({ size: stats.sizes[i], messages: messageByOrdinal.get(o) ?? 0 }))
        }
        const sorted = entries.map((e) => e.size).sort((a, b) => a - b)
        const histogram: Record<string, number> = {}
        for (const bucket of MEMORY_HISTOGRAM_BUCKETS) {
            histogram[bucket.label] = sorted.filter((n) => n >= bucket.min && n <= bucket.max).length
        }
        const counts: Rec = {}
        for (const suffix of ['summaries', 'mainChunks', 'chunks']) {
            const parts = scopes.flatMap((scope) => kinds.get(`${scope}.mem.${field}.${suffix}`)?.sizes ?? [])
            if (parts.length === 0) continue
            const countsSorted = [...parts].sort((a, b) => a - b)
            counts[suffix] = {
                chatsWithField: parts.length,
                total: parts.reduce((a, b) => a + b, 0),
                p50: percentile(countsSorted, 0.5),
                p95: percentile(countsSorted, 0.95),
                max: countsSorted[countsSorted.length - 1],
            }
        }
        out[field] = {
            chatsWithField: entries.length,
            p50: percentile(sorted, 0.5),
            p95: percentile(sorted, 0.95),
            max: sorted.length ? sorted[sorted.length - 1] : 0,
            top10: [...entries].sort((a, b) => b.size - a.size).slice(0, 10),
            histogramBytes: histogram,
            entryCounts: counts,
        }
    }
    return out
}

/** Greedy packing of whole messages into byte-capped chunks. */
function countChunks(messageSizes: readonly number[]): number {
    let chunks = 0
    let current = 0
    for (const size of messageSizes) {
        if (current === 0 || current + size > CHUNK_CAP_BYTES) {
            chunks++
            current = size
        } else {
            current += size
        }
    }
    return chunks
}

/** Records one chat under `scope` and returns its exact whole JSON size. */
function measureChat(scope: string, ordinal: string, chatValue: unknown): number {
    const chat = asRec(chatValue)
    if (!chat) {
        const whole = jsonBytes(chatValue)
        record(`${scope}.whole`, ordinal, whole)
        return whole
    }
    const hasMessages = Array.isArray(chat.message)
    const messageSizes = asArr(chat.message).map((m) => jsonBytes(m))
    for (const size of messageSizes) if (size > CHUNK_CAP_BYTES) messagesOver128KiB++
    const core = without(chat, CHAT_SPLIT_OUT)
    const coreBytes = jsonBytes(core)
    // `{...core,"message":[...]}`: drop core's closing brace, add the key, array and brace.
    const emptyCore = Object.keys(core).length === 0
    const whole = hasMessages
        ? coreBytes - 2 + (emptyCore ? 0 : 1) + utf8Length('"message":') + arrayBytesFrom(messageSizes) + 2
        : coreBytes
    const first = asRec(asArr(chat.message)[0])
    if (first && typeof first.data === 'string' && first.data.startsWith('COLDSTORAGE')) pointerChats++
    record(`${scope}.whole`, ordinal, whole)
    record(`${scope}.core`, ordinal, coreBytes)
    record(`${scope}.chunks`, ordinal, countChunks(messageSizes), 'count')
    record(`${scope}.messages`, ordinal, messageSizes.length, 'count')
    record(`${scope}.largestMessage`, ordinal, messageSizes.length ? Math.max(...messageSizes) : 0)
    for (const field of CHAT_MEMORY_FIELDS) {
        const value = chat[field]
        if (value === undefined || value === null) continue
        record(`${scope}.mem.${field}`, ordinal, jsonBytes(value))
        const holder = asRec(value)
        if (field === 'hypaV3Data') record(`${scope}.mem.${field}.summaries`, ordinal, asArr(holder?.summaries).length, 'count')
        if (field === 'hypaV2Data') {
            record(`${scope}.mem.${field}.mainChunks`, ordinal, asArr(holder?.mainChunks).length, 'count')
            record(`${scope}.mem.${field}.chunks`, ordinal, asArr(holder?.chunks).length, 'count')
        }
    }
    return whole
}

/** Records one non-stub character (or group chat) under `scope` and returns its total. */
function measureCharacter(scope: string, ordinal: string, characterValue: unknown, chatScope: string): number {
    const cha = asRec(characterValue)
    if (!cha) return 0
    const core = jsonBytes(without(cha, CHARACTER_SPLIT_OUT))
    const lore = jsonBytes(cha.globalLore)
    const scripts = jsonBytes(Object.fromEntries(CHARACTER_SCRIPT_KEYS.map((key) => [key, cha[key]])))
    let chatTotal = 0
    asArr(cha.chats).forEach((chat, chatIndex) => {
        chatTotal += measureChat(chatScope, `${ordinal}/chat#${chatIndex}`, chat)
    })
    const total = core + lore + scripts + chatTotal
    record(`${scope}.core`, ordinal, core)
    record(`${scope}.lore`, ordinal, lore)
    record(`${scope}.scripts`, ordinal, scripts)
    record(`${scope}.chatCount`, ordinal, asArr(cha.chats).length, 'count')
    record(`${scope}.total`, ordinal, total)
    return total
}

function isStub(value: unknown): boolean {
    const cha = asRec(value)
    return !!cha && typeof cha.coldstorage === 'string' && cha.coldstorage.length > 0
}

/** Elements of `value` measured one by one as `kind`; returns the exact array JSON size. */
function measureArrayUnits(kind: string, prefix: string, value: unknown): number {
    const sizes = asArr(value).map((element, index) => {
        const size = jsonBytes(element)
        record(kind, `${prefix}#${index}`, size)
        return size
    })
    return arrayBytesFrom(sizes)
}
//#endregion

//#region container walk
const ENCRYPTION_MARKER = 'encryption.risudat'
const SCAN_CHUNK_BYTES = 32 * MIB
const PROGRESS_INTERVAL_MS = 10_000

/** Progress goes straight to stderr (fd 2), bypassing the test runner's buffered console. */
function progressLine(text: string): void {
    try {
        fs.writeSync(2, `[size-report] ${text}\n`)
    } catch {
        // progress is best-effort
    }
}

/** Front-to-back reader over one fd: large sequential reads, never a per-entry seek. */
class SequentialReader {
    private readonly chunk = Buffer.allocUnsafe(SCAN_CHUNK_BYTES)
    private start = 0
    private end = 0
    private nextReadPosition = 0
    /** Bytes consumed so far, i.e. the file offset of the next unread byte. */
    consumed = 0

    constructor(
        private readonly fd: number,
        private readonly fileSize: number,
        private readonly onFill: (scannedBytes: number) => void,
    ) {}

    private fill(): boolean {
        if (this.nextReadPosition >= this.fileSize) return false
        const want = Math.min(this.chunk.length, this.fileSize - this.nextReadPosition)
        const n = fs.readSync(this.fd, this.chunk, 0, want, this.nextReadPosition)
        if (n === 0) return false
        this.start = 0
        this.end = n
        this.nextReadPosition += n
        this.onFill(this.nextReadPosition)
        return true
    }

    /** Copies the next `length` bytes into a new buffer; null when the file ends first. */
    take(length: number): Buffer | null {
        const out = Buffer.allocUnsafe(length)
        let got = 0
        while (got < length) {
            if (this.start === this.end && !this.fill()) return null
            const run = Math.min(length - got, this.end - this.start)
            this.chunk.copy(out, got, this.start, this.start + run)
            this.start += run
            got += run
        }
        this.consumed += length
        return out
    }

    /** Advances past `length` bytes without copying them; false when the file ends first. */
    skip(length: number): boolean {
        let left = length
        while (left > 0) {
            if (this.start === this.end && !this.fill()) return false
            const run = Math.min(left, this.end - this.start)
            this.start += run
            left -= run
        }
        this.consumed += length
        return true
    }
}

type ColdShape = 'character' | 'chat' | 'other'

interface ColdUnit {
    ordinal: number
    key: string
    length: number
    parsed: boolean
    parseFailed: boolean
    notSplit: boolean
    /** Shape read from the body; the class from the database is applied after it is decoded. */
    derivedShape: ColdShape | null
    /** Asset keys of an archived character body; null when the body was not parsed or holds no character. */
    refs: Set<string> | null
    pending: PendingRecord[]
    messagesOver128KiBDelta: number
    pointerChatsDelta: number
    /** Raw body kept for the store2 census when it parsed and fits the retention budget; released after the census. */
    body: Buffer | null
}

interface WalkResult {
    entryCount: number
    truncatedTrailingEntry: boolean
    encryptionMarker: boolean
    longNameEntries: number
    databaseCount: number
    /** Body of the last database entry (the restore pass keeps the last); released once decoded. */
    databaseBody: Buffer | null
    coldUnits: ColdUnit[]
    coldRetainedBytes: number
    inlayPartSizes: number[]
    assetSizes: number[]
    /** Entry name per asset, parallel to assetSizes; null for a name too long to decode. */
    assetNames: (string | null)[]
    entryBytes: { database: number; coldUnit: number; inlayPart: number; asset: number }
}

/** Measures a parsed cold unit by the shape of its body, into the unit's pending records. */
function measureColdUnit(unit: ColdUnit, value: unknown): void {
    const ordinal = `coldUnit#${unit.ordinal}`
    const obj = asRec(value)
    const shape: ColdShape = Array.isArray(value) || Array.isArray(obj?.message) ? 'chat'
        : asRec(obj?.character) ? 'character' : 'other'
    unit.derivedShape = shape
    const overBefore = messagesOver128KiB
    const pointersBefore = pointerChats
    recordSink = unit.pending
    try {
        if (shape === 'character') {
            unit.refs = new Set<string>()
            collectCharacterRefs(asRec(obj?.character), unit.refs)
            measureCharacter('archivedCharacter', ordinal, obj?.character, 'archivedChat')
        } else if (shape === 'chat') {
            const chat = Array.isArray(value) ? { message: value } : value
            const messageSizes = asArr(asRec(chat)?.message).map((m) => jsonBytes(m))
            for (const size of messageSizes) if (size > CHUNK_CAP_BYTES) messagesOver128KiB++
            record('coldChatUnit.chunks', ordinal, countChunks(messageSizes), 'count')
            record('coldChatUnit.messages', ordinal, messageSizes.length, 'count')
            record('coldChatUnit.largestMessage', ordinal, messageSizes.length ? Math.max(...messageSizes) : 0)
        }
    } finally {
        recordSink = null
    }
    // Counters join the totals only if the unit's class keeps this measurement.
    unit.messagesOver128KiBDelta = messagesOver128KiB - overBefore
    unit.pointerChatsDelta = pointerChats - pointersBefore
    messagesOver128KiB = overBefore
    pointerChats = pointersBefore
}

/**
 * One sequential pass. Only the database body and cold-unit bodies up to the
 * parse limit are held (one at a time, apart from the database); inlay and
 * asset bodies are skipped, recording sizes only.
 */
function walkContainer(
    fd: number,
    fileSize: number,
    classify: { coldKey: (name: string) => string | null; isInlay: (name: string) => boolean },
): WalkResult {
    const result: WalkResult = {
        entryCount: 0,
        truncatedTrailingEntry: false,
        encryptionMarker: false,
        longNameEntries: 0,
        databaseCount: 0,
        databaseBody: null,
        coldUnits: [],
        coldRetainedBytes: 0,
        inlayPartSizes: [],
        assetSizes: [],
        assetNames: [],
        entryBytes: { database: 0, coldUnit: 0, inlayPart: 0, asset: 0 },
    }
    const startedAtMs = Date.now()
    let lastReportAtMs = startedAtMs
    let lastReportBytes = 0
    const report = (scannedBytes: number, force: boolean) => {
        const now = Date.now()
        if (!force && now - lastReportAtMs < PROGRESS_INTERVAL_MS) return
        const intervalSeconds = Math.max((now - lastReportAtMs) / 1000, 0.001)
        const totalSeconds = Math.max((now - startedAtMs) / 1000, 0.001)
        progressLine(
            `scanned ${(scannedBytes / GIB).toFixed(2)} / ${(fileSize / GIB).toFixed(2)} GiB ` +
            `(${fileSize ? ((scannedBytes / fileSize) * 100).toFixed(1) : '100.0'}%), entries=${result.entryCount}, ` +
            `${((scannedBytes - lastReportBytes) / MIB / intervalSeconds).toFixed(0)} MB/s now, ` +
            `${(scannedBytes / MIB / totalSeconds).toFixed(0)} MB/s avg`,
        )
        lastReportAtMs = now
        lastReportBytes = scannedBytes
    }
    const reader = new SequentialReader(fd, fileSize, (scanned) => report(scanned, false))
    const changed = () => new Error('the file changed or ended early during the scan')
    const decoder = new TextDecoder()

    while (reader.consumed < fileSize) {
        const position = reader.consumed
        if (position + 4 > fileSize) { result.truncatedTrailingEntry = true; break }
        const nameLengthBytes = reader.take(4)
        if (!nameLengthBytes) throw changed()
        const nameLength = nameLengthBytes.readUInt32LE(0)
        const nameEnd = position + 4 + nameLength
        if (nameEnd + 4 > fileSize) { result.truncatedTrailingEntry = true; break }
        let name: string | undefined
        if (nameLength <= NAME_READ_LIMIT) {
            const nameBytes = reader.take(nameLength)
            if (!nameBytes) throw changed()
            name = decoder.decode(nameBytes)
        } else {
            result.longNameEntries++
            if (!reader.skip(nameLength)) throw changed()
        }
        const dataLengthBytes = reader.take(4)
        if (!dataLengthBytes) throw changed()
        const dataLength = dataLengthBytes.readUInt32LE(0)
        const dataStart = nameEnd + 4
        if (dataStart + dataLength > fileSize) { result.truncatedTrailingEntry = true; break }
        if (name === ENCRYPTION_MARKER) { result.encryptionMarker = true; break }

        result.entryCount++
        const coldKey = name === undefined ? null : classify.coldKey(name)
        if (name === 'database.risudat') {
            const body = reader.take(dataLength)
            if (!body) throw changed()
            result.databaseBody = body
            result.databaseCount++
            result.entryBytes.database += dataLength
        } else if (name !== undefined && classify.isInlay(name)) {
            if (!reader.skip(dataLength)) throw changed()
            result.inlayPartSizes.push(dataLength)
            result.entryBytes.inlayPart += dataLength
        } else if (coldKey) {
            const unit: ColdUnit = {
                ordinal: result.coldUnits.length,
                key: coldKey,
                length: dataLength,
                parsed: false,
                parseFailed: false,
                notSplit: dataLength > PARSE_LIMIT_BYTES,
                derivedShape: null,
                refs: null,
                pending: [],
                messagesOver128KiBDelta: 0,
                pointerChatsDelta: 0,
                body: null,
            }
            if (unit.notSplit) {
                if (!reader.skip(dataLength)) throw changed()
            } else {
                const body = reader.take(dataLength)
                if (!body) throw changed()
                let value: unknown
                try {
                    value = JSON.parse(body.toString('utf8'))
                    unit.parsed = true
                } catch {
                    unit.parseFailed = true
                }
                if (unit.parsed) measureColdUnit(unit, value)
                if (unit.parsed && result.coldRetainedBytes + dataLength <= COLD_RETAIN_BYTES) {
                    unit.body = body
                    result.coldRetainedBytes += dataLength
                }
            }
            result.coldUnits.push(unit)
            result.entryBytes.coldUnit += dataLength
        } else {
            if (!reader.skip(dataLength)) throw changed()
            result.assetSizes.push(dataLength)
            result.assetNames.push(name ?? null)
            result.entryBytes.asset += dataLength
        }
        report(reader.consumed, false)
    }
    report(reader.consumed, true)
    return result
}
//#endregion

function rssBytes(): number {
    return process.memoryUsage().rss
}

let risuSave: typeof import('src/ts/storage/risuSave')
let coldData: typeof import('src/ts/process/coldstorageData')
let inlayCodec: typeof import('src/ts/drive/inlayBackupCodec')
let store2Census: typeof import('./store2-census')

describe('real-size-report (read-only size census of a real .bin)', () => {
    // Node's Buffer stays defined. generate-and-verify.harness.ts removes it
    // while importing the codec because msgpackr's ENCODE path misbehaves with
    // it present on some Node versions; this harness only decodes, and removing
    // Buffer mid-import makes vitest's own async work throw. The decoded result
    // is checked against a synthetic fixture instead.
    beforeAll(async () => {
        risuSave = await import('src/ts/storage/risuSave')
        coldData = await import('src/ts/process/coldstorageData')
        inlayCodec = await import('src/ts/drive/inlayBackupCodec')
        store2Census = await import('./store2-census')
    }, 120_000)

    it.skipIf(!BIN_PATH)(
        'sizes every storage unit of the backup named by RISU_SIZE_BIN',
        async () => {
            const binPath = path.resolve(BIN_PATH as string)
            expect(binPath).not.toBe(path.resolve(OUTPUT_PATH))

            const startedAt = Date.now()
            const memorySamples: { stage: string; rssBytes: number }[] = []
            const sample = (stage: string) => memorySamples.push({ stage, rssBytes: rssBytes() })
            sample('start')

            const fd = fs.openSync(binPath, 'r')
            const before = fs.fstatSync(fd)
            const fileSize = before.size
            const report: Rec = {}
            let decodeError: string | null = null
            let store2Section: Rec | null = null
            try {
                console.log(`[size-report] container bytes=${fileSize}`)
                const walk = walkContainer(fd, fileSize, {
                    coldKey: (name) => coldData.getColdStorageBackupKey(name),
                    isInlay: (name) => inlayCodec.parseInlayEntryName(name) !== null,
                })
                sample('after container walk')

                // --- Assets and inlay parts: sizes only, bodies never read ---
                const assetKinds = new KindStats('bytes')
                walk.assetSizes.forEach((size, i) => assetKinds.add(`asset#${i}`, size))
                const assetSorted = [...walk.assetSizes].sort((a, b) => a - b)
                const assetSummary = {
                    count: walk.assetSizes.length,
                    totalBytes: walk.entryBytes.asset,
                    max: assetSorted.length ? assetSorted[assetSorted.length - 1] : 0,
                    p50: percentile(assetSorted, 0.5),
                    p95: percentile(assetSorted, 0.95),
                    top10: topTen(assetKinds),
                    over16MiB: assetSorted.filter((s) => s > 16 * MIB).length,
                    over100MiB: assetSorted.filter((s) => s > 100 * MIB).length,
                    over4GiB: assetSorted.filter((s) => s > 4 * GIB).length,
                    note: 'asset entry length (u32 field, so never above 4 GiB - 1); over = strictly greater than; MiB/GiB are binary',
                }
                const inlayKinds = new KindStats('bytes')
                walk.inlayPartSizes.forEach((size, i) => inlayKinds.add(`inlayPart#${i}`, size))

                // --- Database entry: the last one wins, as in the restore pass ---
                let databaseBytes = 0
                let decodeFormat: 'block' | 'legacy' | 'none' = 'none'
                let omittedBlocks = 0
                let decodeMs = 0
                let characterCount = 0
                let stubCount = 0
                const archivedRefs = { characterUnits: new Set<string>(), chatUnits: new Set<string>(), pluginUnits: new Set<string>() }
                // Asset references (decision C4): per-owner distinct key sets; the
                // container match is done once the database is decoded.
                const refState = {
                    decoded: false,
                    characterStats: new KindStats('count'),
                    moduleStats: new KindStats('count'),
                    allRefs: new Set<string>(),
                    characterBytes: { full: 0, fullMax: 0, hash: 0, hashMax: 0, hashKeys: 0, nonHashKeys: 0, nonHashFull: 0 },
                    moduleBytes: { full: 0, fullMax: 0, hash: 0, hashMax: 0, hashKeys: 0, nonHashKeys: 0, nonHashFull: 0 },
                    personaRefs: new Set<string>(),
                    personaCount: 0,
                    databaseLevelRefs: new Set<string>(),
                    stubsWithoutArchivedRefs: 0,
                    coldCharacterBodiesParsed: 0,
                }
                const addRefBytes = (acc: typeof refState.characterBytes, keys: Set<string>) => {
                    const e = encodedRefBytes(keys)
                    acc.full += e.fullKeyJsonBytes
                    acc.fullMax = Math.max(acc.fullMax, e.fullKeyJsonBytes)
                    acc.hash += e.base64urlStemJsonBytes
                    acc.hashMax = Math.max(acc.hashMax, e.base64urlStemJsonBytes)
                    acc.hashKeys += e.hashKeyCount
                    acc.nonHashKeys += e.nonHashKeyCount
                    acc.nonHashFull += e.nonHashFullKeyJsonBytes
                }
                const archivedCharacterRefs = new Map<string, Set<string>>()
                for (const unit of walk.coldUnits) {
                    if (unit.refs) {
                        archivedCharacterRefs.set(unit.key, unit.refs)
                        refState.coldCharacterBodiesParsed++
                    }
                }
                if (!walk.databaseBody) {
                    decodeError = 'no database.risudat entry in the container'
                } else {
                    databaseBytes = walk.databaseBody.length
                    try {
                        // A plain Uint8Array view: no copy, and no Buffer-only behaviour in the decoder.
                        let dbBytes: Uint8Array | null = new Uint8Array(walk.databaseBody.buffer, walk.databaseBody.byteOffset, walk.databaseBody.length)
                        walk.databaseBody = null
                        sample('database entry read')
                        const decodeStart = Date.now()
                        let decoded: Rec
                        if (risuSave.isBlockFormatSave(dbBytes)) {
                            decodeFormat = 'block'
                            const salvaged = await risuSave.salvageRisuSave(dbBytes)
                            omittedBlocks = salvaged.omitted.size
                            decoded = salvaged.db as unknown as Rec
                        } else {
                            decodeFormat = 'legacy'
                            decoded = (await risuSave.decodeRisuSave(dbBytes)) as unknown as Rec
                        }
                        dbBytes = null
                        decodeMs = Date.now() - decodeStart
                        sample('database decoded')
                        console.log(`[size-report] database decoded format=${decodeFormat} ms=${decodeMs}`)

                        // characters
                        const characters = asArr(decoded.characters)
                        characterCount = characters.length
                        const characterSizes: number[] = []
                        characters.forEach((cha, index) => {
                            const ordinal = `character#${index}`
                            const holder = asRec(cha)
                            if (holder && typeof holder.coldstorage === 'string' && holder.coldstorage.length > 0) {
                                stubCount++
                                archivedRefs.characterUnits.add(holder.coldstorage)
                                for (const key of asArr(holder.coldStoragedChats)) {
                                    if (typeof key === 'string') archivedRefs.chatUnits.add(key)
                                }
                            }
                            for (const chat of asArr(holder?.chats)) {
                                const message = asArr(asRec(chat)?.message)
                                const data = asRec(message[0])?.data
                                if (typeof data === 'string' && data.startsWith(coldData.coldStorageHeader)) {
                                    archivedRefs.chatUnits.add(data.slice(coldData.coldStorageHeader.length))
                                }
                            }
                            // A stub keeps its own fields and gains its archived body's references.
                            const charRefs = new Set<string>()
                            collectCharacterRefs(holder, charRefs)
                            if (isStub(cha)) {
                                const archived = archivedCharacterRefs.get(String(holder?.coldstorage))
                                if (archived) for (const key of archived) charRefs.add(key)
                                else refState.stubsWithoutArchivedRefs++
                            }
                            refState.characterStats.add(ordinal, charRefs.size)
                            for (const key of charRefs) refState.allRefs.add(key)
                            addRefBytes(refState.characterBytes, charRefs)
                            if (isStub(cha)) {
                                record('stubCharacter.whole', ordinal, jsonBytes(cha))
                            } else {
                                characterSizes.push(measureCharacter('character', ordinal, cha, 'chat'))
                            }
                        })
                        scalars['characters.total (non-stub, sum of unit sizes)'] = {
                            bytes: characterSizes.reduce((a, b) => a + b, 0),
                            count: characterSizes.length,
                        }
                        for (const key of coldData.listColdPluginStorageKeys(decoded as never)) {
                            archivedRefs.pluginUnits.add(key)
                        }
                        sample('characters measured')

                        // modules
                        const modulesTotal = measureArrayUnits('module', 'module', decoded.modules)
                        scalars['modules.total'] = { bytes: modulesTotal, count: asArr(decoded.modules).length }
                        asArr(decoded.modules).forEach((mod, index) => {
                            const moduleRefs = new Set<string>()
                            collectModuleRefs(asRec(mod), moduleRefs)
                            refState.moduleStats.add(`module#${index}`, moduleRefs.size)
                            for (const key of moduleRefs) refState.allRefs.add(key)
                            addRefBytes(refState.moduleBytes, moduleRefs)
                        })
                        const personas = asArr(decoded.personas)
                        refState.personaCount = personas.length
                        for (const persona of personas) collectPersonaRefs(asRec(persona), refState.personaRefs)
                        collectDatabaseLevelRefs(decoded, refState.databaseLevelRefs)
                        for (const key of refState.personaRefs) refState.allRefs.add(key)
                        for (const key of refState.databaseLevelRefs) refState.allRefs.add(key)
                        refState.decoded = true

                        // botPresets, loadouts, plugins
                        scalars['botPresets.total'] = {
                            bytes: measureArrayUnits('botPreset', 'botPreset', decoded.botPresets),
                            count: asArr(decoded.botPresets).length,
                        }
                        scalars['loadouts.total'] = {
                            bytes: measureArrayUnits('loadout', 'loadout', decoded.loadouts),
                            count: asArr(decoded.loadouts).length,
                        }
                        scalars['plugins.total'] = {
                            bytes: measureArrayUnits('plugin', 'plugin', decoded.plugins),
                            count: asArr(decoded.plugins).length,
                        }

                        // pluginCustomStorage per key, and its exact total
                        const pluginStorage = asRec(decoded.pluginCustomStorage)
                        if (pluginStorage) {
                            let totalBytes = 2
                            let members = 0
                            Object.keys(pluginStorage).forEach((key, index) => {
                                const valueBytes = jsonBytes(pluginStorage[key])
                                record('pluginStorageKey', `pluginStorageKey#${index}`, valueBytes)
                                if (pluginStorage[key] !== undefined) {
                                    totalBytes += utf8Length(JSON.stringify(key)) + 1 + valueBytes
                                    members++
                                }
                            })
                            scalars['pluginCustomStorage.total'] = { bytes: totalBytes + Math.max(members - 1, 0), count: Object.keys(pluginStorage).length }
                        } else {
                            scalars['pluginCustomStorage.total'] = { bytes: 0, count: 0 }
                        }

                        // config root, with its largest fields by ordinal only (names withheld)
                        const configOmit = new Set(['characters', 'modules', 'botPresets', 'loadouts', 'plugins', 'pluginCustomStorage'])
                        const configRoot = without(decoded, configOmit)
                        const configFieldSizes = Object.keys(configRoot).map((key, index) => ({ ordinal: `configField#${index}`, size: jsonBytes(configRoot[key]) }))
                        const configBytes = jsonBytes(configRoot)
                        record('configRoot', 'configRoot', configBytes)
                        for (const field of configFieldSizes) record('configRoot.field', field.ordinal, field.size)
                        scalars['characterOrder (inside config root)'] = { bytes: jsonBytes(decoded.characterOrder) }
                        scalars['configRoot'] = { bytes: configBytes, count: Object.keys(configRoot).length }
                        sample('configuration measured')

                        // store2 census: the real codec and list derivation over this database,
                        // one owner at a time, with archived chats re-attached from the retained cold units.
                        const coldByKey = new Map<string, ColdUnit>()
                        for (const unit of walk.coldUnits) coldByKey.set(unit.key, unit)
                        try {
                            store2Section = await store2Census.runStore2Census({
                                decoded,
                                cold: {
                                    read: (key) => {
                                        const unit = coldByKey.get(key)
                                        if (!unit) return { status: 'unavailable', reason: 'missing' }
                                        if (unit.notSplit) return { status: 'unavailable', reason: 'over-parse-limit' }
                                        if (unit.parseFailed) return { status: 'unavailable', reason: 'parse-failed' }
                                        if (!unit.body) return { status: 'unavailable', reason: 'not-retained' }
                                        try {
                                            return { status: 'ok', value: JSON.parse(unit.body.toString('utf8')) }
                                        } catch {
                                            return { status: 'unavailable', reason: 'parse-failed' }
                                        }
                                    },
                                },
                                sample,
                                progress: progressLine,
                            })
                            store2Section.coldRetention = {
                                budgetBytes: COLD_RETAIN_BYTES,
                                retainedBytes: walk.coldRetainedBytes,
                                unitsRetained: walk.coldUnits.filter((unit) => unit.body).length,
                                unitsNotRetainedOverBudget: walk.coldUnits.filter((unit) => unit.parsed && !unit.body).length,
                            }
                        } catch (error) {
                            // Class name only: a codec message can name a character or key.
                            store2Section = { failed: error instanceof Error ? error.name : 'non-error-thrown' }
                        } finally {
                            for (const unit of walk.coldUnits) unit.body = null
                        }
                        sample('store2 census done')
                    } catch (error) {
                        decodeError = error instanceof Error ? `${error.name}: ${error.message}` : 'database decode failed'
                    }
                }

                // --- Archived cold-storage units (upstream "stubs" point at these) ---
                // Bodies were measured during the scan by their own shape; the
                // database's references now fix each unit's class.
                let coldParsed = 0
                let coldNotSplit = 0
                let coldParseFailed = 0
                let coldDetailShapeMismatch = 0
                for (const unit of walk.coldUnits) {
                    const ordinal = `coldUnit#${unit.ordinal}`
                    const declared = archivedRefs.pluginUnits.has(unit.key) ? 'plugin'
                        : archivedRefs.characterUnits.has(unit.key) ? 'character'
                            : archivedRefs.chatUnits.has(unit.key) ? 'chat' : null
                    const shape: 'character' | 'chat' | 'plugin' | 'other' | 'unparsed' =
                        declared ?? (unit.parsed ? unit.derivedShape ?? 'other' : 'unparsed')
                    if (unit.parsed) coldParsed++
                    if (unit.parseFailed) coldParseFailed++
                    if (unit.notSplit) coldNotSplit++
                    record(`coldUnit.${shape}`, ordinal, unit.length)
                    record('coldUnit.all', ordinal, unit.length)
                    if (unit.parsed && (shape === 'character' || shape === 'chat')) {
                        if (shape === unit.derivedShape) {
                            for (const pending of unit.pending) record(pending.kind, pending.ordinal, pending.size, pending.unit)
                            messagesOver128KiB += unit.messagesOver128KiBDelta
                            pointerChats += unit.pointerChatsDelta
                        } else {
                            coldDetailShapeMismatch++
                        }
                    }
                    unit.pending = []
                }                sample('cold units measured')

                // --- Asset references against the container's asset entries ---
                // Matching rule: LocalWriter.writeBackup stores each asset under
                // getBasename(key) (the key is 'assets/<name>') and the restore
                // pass writes 'assets/' + entry name back, so an asset entry is
                // referenced exactly when its entry name equals a referenced key
                // (refKey = getBasename of the stored reference value). Entries
                // too long to decode have no name and are counted apart. The
                // classification of entries as assets is the walk's: everything
                // that is not the database, a cold unit or an inlay part.
                let assetRefs: Rec | null = null
                if (refState.decoded) {
                    const entryNames = new Set<string>()
                    const referenced = { count: 0, bytes: 0 }
                    const unreferenced = { count: 0, bytes: 0 }
                    const unnamed = { count: 0, bytes: 0 }
                    walk.assetNames.forEach((name, i) => {
                        const size = walk.assetSizes[i]
                        const bucket = name === null ? unnamed : refState.allRefs.has(name) ? referenced : unreferenced
                        bucket.count++
                        bucket.bytes += size
                        if (name !== null) entryNames.add(name)
                    })
                    let missing = 0
                    let missingHashNamed = 0
                    for (const key of refState.allRefs) {
                        if (entryNames.has(key)) continue
                        missing++
                        if (HASH_KEY.test(key)) missingHashNamed++
                    }
                    const personaBytes = encodedRefBytes(refState.personaRefs)
                    const databaseLevelBytes = encodedRefBytes(refState.databaseLevelRefs)
                    const bytesOut = (acc: typeof refState.characterBytes) => ({
                        fullKeyJsonBytes: { total: acc.full, maxPerOwner: acc.fullMax },
                        base64urlStemJsonBytes: { total: acc.hash, maxPerOwner: acc.hashMax, hashKeyRefs: acc.hashKeys },
                        nonHashKeyRefs: acc.nonHashKeys,
                        nonHashFullKeyJsonBytes: acc.nonHashFull,
                    })
                    assetRefs = {
                        rule: 'reference value -> getBasename -> key; an asset entry is referenced when its entry name equals a key; per-owner counts are distinct keys; a stub character adds its archived body\'s keys',
                        characters: {
                            distinctRefsPerCharacter: refDistribution(refState.characterStats),
                            encodedBytesSummedOverCharacters: bytesOut(refState.characterBytes),
                            stubsWithoutParsedArchivedBody: refState.stubsWithoutArchivedRefs,
                            parsedArchivedCharacterBodies: refState.coldCharacterBodiesParsed,
                        },
                        modules: {
                            distinctRefsPerModule: refDistribution(refState.moduleStats),
                            encodedBytesSummedOverModules: bytesOut(refState.moduleBytes),
                        },
                        personas: {
                            count: refState.personaCount,
                            distinctRefs: refState.personaRefs.size,
                            fullKeyJsonBytes: personaBytes.fullKeyJsonBytes,
                            base64urlStemJsonBytes: personaBytes.base64urlStemJsonBytes,
                        },
                        databaseLevel: {
                            distinctRefs: refState.databaseLevelRefs.size,
                            fullKeyJsonBytes: databaseLevelBytes.fullKeyJsonBytes,
                            base64urlStemJsonBytes: databaseLevelBytes.base64urlStemJsonBytes,
                        },
                        global: {
                            distinctReferencedKeys: refState.allRefs.size,
                            distinctAssetEntryNames: entryNames.size,
                            referencedAssetEntries: referenced,
                            unreferencedAssetEntries: unreferenced,
                            assetEntriesWithUndecodedName: unnamed,
                            referencedKeysMissingFromContainer: missing,
                            referencedKeysMissingThatAreHashNamed: missingHashNamed,
                            referenceSetComplete: refState.stubsWithoutArchivedRefs === 0,
                        },
                        notes: 'hash-named = 64 hex characters with an optional extension; base64url bytes are 45 per such key plus array punctuation (extension not stored); missing keys include references that are not asset keys (for example URLs)',
                    }
                }

                const after = fs.fstatSync(fd)
                const heap = v8.getHeapStatistics()
                const maxRssBytes = process.resourceUsage().maxRSS * 1024
                Object.assign(report, {
                    harness: {
                        measure: 'UTF-8 byte length of the JSON serialisation of each piece (count kinds hold counts)',
                        chunkCapBytes: CHUNK_CAP_BYTES,
                        flagThresholdsBytes: { atOrOver50MiB: FLAG_50_MIB, atOrOver100MiB: FLAG_100_MIB },
                        coldUnitParseLimitBytes: PARSE_LIMIT_BYTES,
                        ordinals: 'character#N = 0-based index in the decoded characters array; assets and cold units by entry order in the file',
                        generatedAt: new Date(startedAt).toISOString(),
                        elapsedMs: Date.now() - startedAt,
                        node: process.version,
                    },
                    container: {
                        fileBytes: fileSize,
                        entryCount: walk.entryCount,
                        truncatedTrailingEntry: walk.truncatedTrailingEntry,
                        encryptionMarkerPresent: walk.encryptionMarker,
                        longNameEntries: walk.longNameEntries,
                        entryClasses: {
                            database: { count: walk.databaseCount, bytes: walk.entryBytes.database },
                            coldUnit: { count: walk.coldUnits.length, bytes: walk.entryBytes.coldUnit },
                            inlayPart: { count: walk.inlayPartSizes.length, bytes: walk.entryBytes.inlayPart },
                            asset: { count: walk.assetSizes.length, bytes: walk.entryBytes.asset },
                        },
                    },
                    database: {
                        entryBytes: databaseBytes,
                        decodeFormat,
                        decodeMs,
                        omittedBlocks,
                        decodeError,
                        characters: characterCount,
                        stubCharacters: stubCount,
                        pointerChatsSeen: pointerChats,
                        messagesOver128KiB,
                        unmeasurableValues,
                        coldUnitsParsed: coldParsed,
                        coldUnitsNotSplitOverLimit: coldNotSplit,
                        coldUnitsParseFailed: coldParseFailed,
                        coldUnitsDetailSkippedShapeMismatch: coldDetailShapeMismatch,
                    },
                    scalars,
                    kinds: Object.fromEntries([...kinds.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, stats]) => [name, summarize(stats)])),
                    chatMemory: summarizeChatMemory(),
                    assets: assetSummary,
                    assetRefs,
                    store2: store2Section,
                    inlayParts: summarize(inlayKinds),
                    flags: {
                        atOrOver100MiB: flagged100.sort((a, b) => b.size - a.size),
                        atOrOver50MiB: flagged50.sort((a, b) => b.size - a.size),
                        note: 'every non-asset byte unit at or over the threshold; asset thresholds are reported under assets',
                    },
                    memory: {
                        peakRssBytes: Math.max(maxRssBytes, ...memorySamples.map((s) => s.rssBytes)),
                        samples: memorySamples,
                        heapSizeLimitBytes: heap.heap_size_limit,
                        nodeOptions: process.env.NODE_OPTIONS ?? null,
                        advice: 'If the run ends with a heap out-of-memory error, rerun with NODE_OPTIONS=--max-old-space-size=<MiB>, e.g. 16384 or 32768 (the decoded database is held whole).',
                    },
                    sourceFileGuard: {
                        sizeBefore: before.size,
                        sizeAfter: after.size,
                        mtimeMsBefore: before.mtimeMs,
                        mtimeMsAfter: after.mtimeMs,
                        unchanged: before.size === after.size && before.mtimeMs === after.mtimeMs,
                    },
                })
            } finally {
                fs.closeSync(fd)
            }

            fs.mkdirSync(OUTPUT_DIR, { recursive: true })
            fs.writeFileSync(OUTPUT_PATH, JSON.stringify(report, null, 2))
            printSummary(report)
            console.log(`[size-report] wrote ${OUTPUT_PATH}`)
            expect(decodeError).toBeNull()
        },
        TEST_TIMEOUT_MS,
    )
})

function mib(bytes: number): string {
    return (bytes / MIB).toFixed(2)
}

function sizeText(bytes: number): string {
    return bytes >= MIB ? `${mib(bytes)} MiB` : `${(bytes / KIB).toFixed(1)} KiB`
}

function printSummary(report: Rec): void {
    const kindsOut = asRec(report.kinds) ?? {}
    const lines: string[] = ['', 'kind'.padEnd(34) + 'unit'.padEnd(7) + 'count'.padStart(9) + 'max'.padStart(14) + 'p50'.padStart(14) + 'p95'.padStart(14)]
    for (const name of Object.keys(kindsOut)) {
        const s = asRec(kindsOut[name])
        if (!s) continue
        const isBytes = s.unit === 'bytes'
        const fmt = (n: unknown) => (isBytes ? sizeText(Number(n)) : String(n)).padStart(14)
        lines.push(name.padEnd(34) + String(s.unit).padEnd(7) + String(s.count).padStart(9) + fmt(s.max) + fmt(s.p50) + fmt(s.p95))
    }
    const assets = asRec(report.assets)
    if (assets) {
        lines.push('', `assets: count=${assets.count} total=${mib(Number(assets.totalBytes))} MiB max=${mib(Number(assets.max))} MiB over16MiB=${assets.over16MiB} over100MiB=${assets.over100MiB} over4GiB=${assets.over4GiB}`)
    }
    const refs = asRec(report.assetRefs)
    if (refs) {
        const dist = (value: unknown) => {
            const d = asRec(value) ?? {}
            return `n=${d.count} p50=${d.p50} p95=${d.p95} max=${d.max} total=${d.total}`
        }
        const chars = asRec(refs.characters)
        const mods = asRec(refs.modules)
        const glob = asRec(refs.global)
        const charBytes = asRec(asRec(chars?.encodedBytesSummedOverCharacters)?.fullKeyJsonBytes)
        const charHash = asRec(asRec(chars?.encodedBytesSummedOverCharacters)?.base64urlStemJsonBytes)
        const referenced = asRec(glob?.referencedAssetEntries)
        const unreferenced = asRec(glob?.unreferencedAssetEntries)
        lines.push(
            '',
            `asset refs per character: ${dist(chars?.distinctRefsPerCharacter)}`,
            `  histogram: ${JSON.stringify(asRec(asRec(chars?.distinctRefsPerCharacter)?.histogram))}`,
            `  encoded, summed: full keys ${sizeText(Number(charBytes?.total))}; base64url stems ${sizeText(Number(charHash?.total))} (${charHash?.hashKeyRefs} hash refs, ${asRec(chars?.encodedBytesSummedOverCharacters)?.nonHashKeyRefs} non-hash refs); stubs without parsed archive body=${chars?.stubsWithoutParsedArchivedBody}`,
            `asset refs per module: ${dist(mods?.distinctRefsPerModule)}`,
            `asset refs personas: ${asRec(refs.personas)?.distinctRefs}; database-level: ${asRec(refs.databaseLevel)?.distinctRefs}`,
            `asset refs global: distinct keys=${glob?.distinctReferencedKeys}; referenced entries=${referenced?.count} (${mib(Number(referenced?.bytes))} MiB); unreferenced entries=${unreferenced?.count} (${mib(Number(unreferenced?.bytes))} MiB); missing from container=${glob?.referencedKeysMissingFromContainer}; reference set complete=${glob?.referenceSetComplete}`,
        )
    }
    const flags = asRec(report.flags)
    lines.push(`units >= 50 MiB: ${asArr(flags?.atOrOver50MiB).length}; units >= 100 MiB: ${asArr(flags?.atOrOver100MiB).length}`)
    const memory = asRec(report.memory)
    lines.push(`peak RSS: ${mib(Number(memory?.peakRssBytes))} MiB; heap limit: ${mib(Number(memory?.heapSizeLimitBytes))} MiB`)
    console.log(lines.join('\n'))
}
