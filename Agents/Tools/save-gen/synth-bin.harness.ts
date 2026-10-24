/**
 * Profiling tooling: checks synth-bin-gen.mjs and synth-bin-verify.mjs (MC-471) against the app's own code.
 *
 * - The generator's small-scale output is parsed with the app's backupContainer walk, and every entry header equals what
 *   exportWriters.encodeBackupEntryHeader writes for the same name and length.
 * - Its database entry decodes with the app's decodeRisuSave; no entry name collides with the inlay or cold-unit names.
 * - Two runs with one seed give byte-identical files and manifests.
 * - The data covers the store2 parts a loss could hide in (lore, scripts, VITS models, cc assets, chat tail state, message
 *   stamps, groups, trashed characters, module triggers, loadouts, plugin values in both stored forms, a settings subset),
 *   also inside the stub units, and a recursive walk finds no key-like property or credential-looking value anywhere.
 * - The verifier's resolved tree equals the tree the app's own repairImportTree and resolveLegacyTree produce from the same
 *   file (the import side of the round trip), for the generated file and for cold chat pointer variants, and the app's
 *   repairs change nothing in it. The app's setDatabase, updateLorebooks and checkCharOrder run in synth-bin-seam.harness.ts.
 * - The verifier passes on the generator's output, still passes after the app's encodeRisuSaveLegacy re-encodes the database
 *   unchanged, and fails for each kind of change it claims to catch (asset byte, chat, module, character, stub unit, stub
 *   identity, persona, preset, folder, icon, chat order, list order of characters, personas, presets, modules and loadouts,
 *   duplicate entries, extra or missing or truncated entry, manifest counts), and passes the shapes the app may legitimately
 *   write (the plugin storage map form, an unrelated added root setting). All mutation happens on scratch copies.
 *
 * Run (from the repo root) with ../vitest.harness.config.ts; the `*.harness.ts` suffix keeps it out of `pnpm test`.
 * Scratch goes under SYNTH_BIN_SCRATCH when set, else the operating system's temp directory; never inside the repo.
 * SYNTH_BIN_GEN_SCRIPT and SYNTH_BIN_VERIFY_SCRIPT name the scripts to run, so a scratch mutant of either can be checked.
 *
 * The module mocks mirror generate-and-verify.harness.ts so the app's save codec loads headlessly.
 */
import { describe, test, expect, vi, beforeAll, afterAll } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import type { ForageLike } from 'src/ts/storage/tests/forageBackedStore'

//#region module mocks, as in generate-and-verify.harness.ts
const { store } = vi.hoisted(() => ({ store: new Map<string, unknown>() }))

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

// exportWriters.ts is loaded only for encodeBackupEntryHeader; its platform imports are inert here.
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

vi.mock(import('src/ts/alert'), () => ({
    alertNormalWait: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/alert'))
//#endregion

import { encodeBackupEntryHeader } from 'src/ts/exportWriters'
import { indexBackupEntries } from 'src/ts/drive/backupContainer'
import { parseInlayEntryName } from 'src/ts/drive/inlayBackupCodec'
import { coldStorageHeader, getColdStorageBackupKey } from 'src/ts/process/coldstorageData'
import { isTrashPurgeDue } from 'src/ts/storage/trashPurge'
import { repairImportTree } from 'src/ts/storage/store2/legacy/importTree'
import { resolveLegacyTree, type LegacyEntryReader } from 'src/ts/storage/store2/legacy/resolve'
import type { Database } from 'src/ts/storage/database.svelte'

// decodeRisuSave/encodeRisuSaveLegacy load lazily with global Buffer removed, as the app's webview runs without it.
let encodeRisuSaveLegacy: typeof import('src/ts/storage/risuSave').encodeRisuSaveLegacy
let decodeRisuSave: typeof import('src/ts/storage/risuSave').decodeRisuSave

beforeAll(async () => {
    const savedBuffer = globalThis.Buffer
    // @ts-expect-error - simulating the Buffer-less webview risuSave.ts runs in; restored right below.
    delete globalThis.Buffer
    try {
        const mod = await import('src/ts/storage/risuSave')
        encodeRisuSaveLegacy = mod.encodeRisuSaveLegacy
        decodeRisuSave = mod.decodeRisuSave
    } finally {
        globalThis.Buffer = savedBuffer
    }
})

const HARNESS_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HARNESS_DIR, '..', '..', '..')
const GEN_SCRIPT = process.env.SYNTH_BIN_GEN_SCRIPT ?? path.join(HARNESS_DIR, 'synth-bin-gen.mjs')
const VERIFY_SCRIPT = process.env.SYNTH_BIN_VERIFY_SCRIPT ?? path.join(HARNESS_DIR, 'synth-bin-verify.mjs')
// The verifier is a plain Node ES module, possibly a scratch copy outside the repository: Node's own require loads it, not
// the test runner's module graph (which does not serve files outside the repository).
const requireNative = createRequire(import.meta.url)
const SEED = 1337
const TIMEOUT_MS = 10 * 60 * 1000
const UNIT_FIXTURE_KEY = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'
const TRASHED_FAR_FUTURE = 4102444800000

interface SynthMessage { role: string, data: string, time: number, chatId?: string, saying?: string }
interface SynthChat {
    id: string
    message: SynthMessage[]
    lastMemory?: string
    scriptstate?: Record<string, string | number | boolean>
    suggestMessages?: string[]
    lastDate?: number
    supaMemoryData?: string
    hypaV3Data?: { summaries: { text: string }[] }
    hypaV2Data?: unknown
    localLore?: { content: string }[]
}
interface SynthCharacter {
    type: string
    chaId: string
    name: string
    desc?: string
    chatPage: number
    firstMsgIndex: number
    lastInteraction?: number
    trashTime?: number
    coldstorage?: string
    characters?: string[]
    globalLore?: { content: string, bookVersion?: number }[]
    customscript?: unknown[]
    triggerscript?: unknown[]
    vits?: { id: string }
    ccAssets?: unknown[]
    chats: SynthChat[]
}
interface SynthModule { id: string, name: string, description: string, lorebook?: { content: string, bookVersion?: number }[], trigger?: unknown[] }
interface SynthFolder { id: string, name: string, data: string[] }
interface SynthPersona { id: string, name: string, personaPrompt: string, icon: string, note: string }
interface SynthDatabase {
    formatversion: number
    didFirstSetup?: boolean
    characters: SynthCharacter[]
    characterOrder: (string | SynthFolder)[]
    personas: SynthPersona[]
    botPresets: { id: string, name: string, localNetworkMode?: boolean, localNetworkTimeoutSec?: number }[]
    modules: SynthModule[]
    loadouts: { id: string, characterIds: string[] }[]
    pluginCustomStorage: Record<string, unknown>
    userIcon: string
    username: string
    personaPrompt: string
    userNote: string
    selectedPersona: number
    enabledModules: string[]
    promptInfoInsideChat?: boolean
}
interface SynthUnit { character: SynthCharacter }
interface PluginIndexUnit { type: string, entries: { k: string, s?: string, l?: string }[], trash?: unknown[] }

interface EntryView { name: string, nameBytes: Uint8Array, headerOffset: number, headerLength: number, dataLength: number }

interface KindReport { expected: number, found: number, matched: number, missing: number, extra: number, changed: number }
interface TreeReport { differences: number, truncated: boolean, addedRootKeys: string[], sample: { path: string, kind: string }[] }
interface VerifyReport {
    ok: boolean
    differences: number
    problems: string[]
    addedRootKeys: { name: string, hash: string }[]
    resolution: { stubCharacters: number, coldChats: number } | null
    kinds: Record<string, KindReport>
    tree: TreeReport | null
}

interface StubUnitContent { characters: number, globalLore: number, triggerscript: number, vits: number, ccAssets: number }
interface Manifest {
    seed: number
    counts: {
        entries: number, fileBytes: number, assets: number, characters: number, chats: number, modules: number, stubs: number, groups: number
        trashed: number, unitEntries: number, parts: number, byKind: Record<string, { count: number, bytes: number }>, largestAssets: unknown[]
        stubUnitContent: StubUnitContent, pluginMapped: { small: number, large: number }
    }
    assets: Record<string, { sha256: string, bytes: number, kind: string }>
}

/** The functions synth-bin-verify.mjs exports for this harness. */
type Tree = Record<string, unknown>
interface Verifier {
    inspectBin(binPath: string, label?: string): { walk: { units: Map<string, unknown> }, db: Tree | null, tree: Tree | null, problems: string[] }
    resolveTree(db: Tree, units: Map<string, unknown>): { tree: Tree }
    deepDiff(expected: unknown, actual: unknown, show: number): TreeReport
}

let scratch = ''
let binA = ''
let binB = ''
let manifestA: Manifest
let manifestPathA = ''
let verifier: Verifier

function runNode(script: string, args: string[]) {
    const result = spawnSync(process.execPath, ['--max-old-space-size=4096', script, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
    if (result.error) throw result.error
    return result
}

function generate(out: string) {
    const result = runNode(GEN_SCRIPT, ['--out', out, '--seed', String(SEED), '--scale', 'small'])
    if (result.status !== 0) throw new Error(`generator failed (${result.status}): ${result.stderr}`)
}

function verify(binPath: string, manifestPath: string = manifestPathA): { status: number | null, report: VerifyReport } {
    const result = runNode(VERIFY_SCRIPT, ['--manifest', manifestPath, '--bin', binPath])
    return { status: result.status, report: JSON.parse(result.stdout) as VerifyReport }
}

function verifyAgainstBin(first: string, second: string, forbidAddedRootKeys = false): { status: number | null, report: VerifyReport } {
    const result = runNode(VERIFY_SCRIPT, ['--bin-a', first, '--bin-b', second, ...(forbidAddedRootKeys ? ['--forbid-added-root-keys'] : [])])
    return { status: result.status, report: JSON.parse(result.stdout) as VerifyReport }
}

function sha256File(file: string): string {
    const hash = createHash('sha256')
    const fd = fs.openSync(file, 'r')
    const piece = Buffer.alloc(4 * 1024 * 1024)
    try {
        for (let n = fs.readSync(fd, piece, 0, piece.length, null); n > 0; n = fs.readSync(fd, piece, 0, piece.length, null)) hash.update(piece.subarray(0, n))
    } finally {
        fs.closeSync(fd)
    }
    return hash.digest('hex')
}

async function readEntries(file: string): Promise<EntryView[]> {
    const blob = await fs.openAsBlob(file)
    const walk = await indexBackupEntries(blob)
    expect(walk.hasMarker).toBe(false)
    const fd = fs.openSync(file, 'r')
    try {
        return walk.entries.map((entry) => {
            const header = Buffer.alloc(entry.headerLength)
            fs.readSync(fd, header, 0, header.length, entry.headerOffset)
            const nameBytes = new Uint8Array(header.subarray(4, 4 + entry.nameLength))
            return { name: new TextDecoder().decode(nameBytes), nameBytes, headerOffset: entry.headerOffset, headerLength: entry.headerLength, dataLength: entry.dataLength }
        })
    } finally {
        fs.closeSync(fd)
    }
}

function readBytes(file: string, offset: number, length: number): Buffer {
    const out = Buffer.alloc(length)
    const fd = fs.openSync(file, 'r')
    try {
        fs.readSync(fd, out, 0, length, offset)
    } finally {
        fs.closeSync(fd)
    }
    return out
}

async function readDatabase(file: string): Promise<SynthDatabase> {
    const entries = await readEntries(file)
    const last = entries[entries.length - 1]
    expect(last.name).toBe('database.risudat')
    return await decodeRisuSave(new Uint8Array(readBytes(file, last.headerOffset + last.headerLength, last.dataLength))) as unknown as SynthDatabase
}

interface RewriteOptions {
    /** Changes the decoded database (and, by entry name, the unit values); the app's encoder writes it back. */
    mutate?: (db: SynthDatabase, units: Map<string, unknown>) => void | Promise<void>
    /** Changes the unit entries by entry name; the names stay as they are, so swapping two values swaps the bodies. */
    mutateUnits?: (units: Map<string, unknown>) => void | Promise<void>
}

/**
 * Copies `src` to `dst` with every unit entry and the database entry rewritten after the options ran. Assets, which come
 * first, are copied byte for byte.
 */
async function rewriteBin(src: string, dst: string, options: RewriteOptions = {}): Promise<void> {
    const entries = await readEntries(src)
    const last = entries[entries.length - 1]
    expect(last.name).toBe('database.risudat')
    const unitEntries = entries.filter((e) => getColdStorageBackupKey(e.name) !== null)
    const rewriteFrom = unitEntries.length > 0 ? unitEntries[0].headerOffset : last.headerOffset
    const db = await decodeRisuSave(new Uint8Array(readBytes(src, last.headerOffset + last.headerLength, last.dataLength))) as unknown as SynthDatabase
    const units = new Map<string, unknown>()
    for (const entry of unitEntries) units.set(entry.name, JSON.parse(readBytes(src, entry.headerOffset + entry.headerLength, entry.dataLength).toString('utf8')))
    await options.mutate?.(db, units)
    await options.mutateUnits?.(units)
    fs.copyFileSync(src, dst)
    fs.truncateSync(dst, rewriteFrom)
    const parts: Buffer[] = []
    for (const [name, value] of units) {
        const data = Buffer.from(JSON.stringify(value), 'utf8')
        parts.push(Buffer.from(encodeBackupEntryHeader(new TextEncoder().encode(name), data.length)), data)
    }
    const encoded = encodeRisuSaveLegacy(db as unknown as Parameters<typeof encodeRisuSaveLegacy>[0], 'compression')
    parts.push(Buffer.from(encodeBackupEntryHeader(last.nameBytes, encoded.length)), Buffer.from(encoded))
    fs.appendFileSync(dst, Buffer.concat(parts))
}

const unitName = (id: string) => `coldstorage_${id}.json`

/** The unit entry names of the stub characters, in file order (they come before the plugin storage units). */
function stubUnitNames(units: Map<string, unknown>): string[] {
    return [...units.entries()].filter(([, value]) => (value as Partial<SynthUnit>).character !== undefined).map(([name]) => name)
}

function unitOf(units: Map<string, unknown>, index: number): SynthUnit {
    return units.get(stubUnitNames(units)[index]) as SynthUnit
}

/** The character each stub unit entry of `file` holds, by chaId. */
async function readUnitCharacters(file: string): Promise<Map<string, SynthCharacter>> {
    const result = new Map<string, SynthCharacter>()
    for (const entry of (await readEntries(file)).filter((e) => getColdStorageBackupKey(e.name) !== null)) {
        const unit = JSON.parse(readBytes(file, entry.headerOffset + entry.headerLength, entry.dataLength).toString('utf8')) as Partial<SynthUnit>
        if (unit.character !== undefined) result.set(unit.character.chaId, unit.character)
    }
    return result
}

/**
 * A copy of binA in which the first chat with a tail and a scriptstate keeps only its messages after the second as its own;
 * the first two go to a cold chat unit with the chat's side fields. With `keepOnChat` the unit lacks the scriptstate and the
 * chat keeps its own copy.
 */
async function coldChatCopy(dst: string, keepOnChat: boolean): Promise<void> {
    let chatUnit: unknown = null
    await rewriteBin(binA, dst, {
        mutate: (db) => {
            const chat = db.characters.find((c) => c.coldstorage === undefined && c.type === 'character')!.chats.find((c) => c.message.length >= 3 && c.scriptstate !== undefined)!
            const head = chat.message.slice(0, 2)
            const tail = chat.message.slice(2)
            // the unit takes the chat's messages up to the pointer and the side fields, as the app's cold chat unit does
            chatUnit = { message: head, hypaV2Data: chat.hypaV2Data, hypaV3Data: chat.hypaV3Data, scriptstate: keepOnChat ? undefined : chat.scriptstate, localLore: chat.localLore }
            chat.message = [{ role: 'char', data: coldStorageHeader + UNIT_FIXTURE_KEY, time: 0 }, ...tail]
            delete chat.hypaV2Data
            delete chat.hypaV3Data
            if (!keepOnChat) delete chat.scriptstate
            delete chat.localLore
        },
        mutateUnits: (all) => { all.set(unitName(UNIT_FIXTURE_KEY), chatUnit) },
    })
}

/** The tree the app's own import makes from the file: its repairs, then resolveLegacyTree, with plugin values folded back to key -> value. */
async function appImportedTree(file: string): Promise<{ expected: Tree, imported: Tree }> {
    const loaded = verifier.inspectBin(file)
    expect(loaded.problems).toEqual([])
    const db = loaded.db!
    const units = loaded.walk.units
    // the verifier's tree shares nested objects with the decoded database that the app's repairs change in place
    const expected = structuredClone(loaded.tree!)
    const reader: LegacyEntryReader = {
        async read(key) { return units.has(key) ? { status: 'ok', value: structuredClone(units.get(key)) } : { status: 'missing' } },
    }
    const repaired = await repairImportTree(db as unknown as Database, reader)
    expect(repaired.status).toBe('repaired')
    const { database, incomplete } = await resolveLegacyTree(db as unknown as Database, reader, { now: () => 1_700_000_000_001 })
    expect(incomplete).toEqual([])
    // resolveLegacyTree keeps _coldplugin and places each mapped value under its unit id; the logical map has the values by key
    const storage = { ...(database.pluginCustomStorage as unknown as Tree) }
    const map = (storage._coldplugin ?? {}) as Record<string, string>
    const folded: Tree = {}
    for (const [key, value] of Object.entries(storage)) if (key !== '_coldplugin' && !Object.values(map).includes(key)) folded[key] = value
    for (const [key, id] of Object.entries(map)) folded[key] = storage[id]
    const imported = verifier.resolveTree({ ...(database as unknown as Tree), pluginCustomStorage: folded }, new Map()).tree
    return { expected, imported }
}

const CREDENTIAL_KEY = /key|token|secret|password|proxy|auth/i
const CREDENTIAL_VALUE = /\b(?:sk-|ghp_|AIza|xox[abp]-)/
// The names that match CREDENTIAL_KEY and are not credentials: a lorebook entry's activation keywords `key` and `secondkey`,
// the file names of a VITS model (`tokenizer.json`), which are exempt only as the keys of the `files` map directly inside a
// `vits` object, and the lorebook token budget setting.
const LORE_ARRAYS = new Set(['globalLore', 'localLore', 'lorebook'])
const LORE_ENTRY_KEYS = new Set(['key', 'secondkey'])
const NON_CREDENTIAL_SETTINGS = new Set(['loreBookToken'])
type KeyScope = 'lore-entry' | 'vits' | 'file-map' | ''

/** Every key-like property and credential-looking string at any depth of `value`, by path, except the names listed above. */
function credentialFindings(value: unknown, at = '$', scope: KeyScope = ''): string[] {
    if (typeof value === 'string') return CREDENTIAL_VALUE.test(value) ? [`${at} holds a credential-looking value`] : []
    if (Array.isArray(value)) return value.flatMap((item, index) => credentialFindings(item, `${at}[${index}]`, scope))
    if (typeof value !== 'object' || value === null) return []
    return Object.entries(value).flatMap(([key, child]) => {
        const exempt = scope === 'file-map' || (scope === 'lore-entry' && LORE_ENTRY_KEYS.has(key)) || NON_CREDENTIAL_SETTINGS.has(key)
        const childScope: KeyScope = LORE_ARRAYS.has(key) ? 'lore-entry' : key === 'vits' ? 'vits' : scope === 'vits' && key === 'files' ? 'file-map' : ''
        return [...(CREDENTIAL_KEY.test(key) && !exempt ? [`${at}.${key} is a key-like property`] : []), ...credentialFindings(child, `${at}.${key}`, childScope)]
    })
}

beforeAll(async () => {
    scratch = fs.mkdtempSync(path.join(process.env.SYNTH_BIN_SCRATCH ?? os.tmpdir(), 'risu-synth-harness-'))
    const rel = path.relative(REPO_ROOT, scratch)
    const outside = rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)
    if (!outside) throw new Error(`scratch ${scratch} is inside the repository`)
    binA = path.join(scratch, 'a.bin')
    binB = path.join(scratch, 'b.bin')
    manifestPathA = binA + '.manifest.json'
    generate(binA)
    manifestA = JSON.parse(fs.readFileSync(manifestPathA, 'utf8')) as Manifest
    verifier = requireNative(VERIFY_SCRIPT) as Verifier
}, TIMEOUT_MS)

afterAll(() => {
    if (scratch) fs.rmSync(scratch, { recursive: true, force: true })
})

describe('synthetic .bin generator', () => {
    test('writes the framing the app writes, with the database last and no special names among the assets', async () => {
        const entries = await readEntries(binA)
        expect(entries.length).toBe(manifestA.counts.entries)
        expect(entries[entries.length - 1].name).toBe('database.risudat')
        expect(entries.filter((e) => e.name === 'database.risudat').length).toBe(1)
        expect(entries.some((e) => e.name === 'encryption.risudat')).toBe(false)

        let end = 0
        const fd = fs.openSync(binA, 'r')
        try {
            for (const entry of entries) {
                expect(entry.headerOffset).toBe(end)
                const header = Buffer.alloc(entry.headerLength)
                fs.readSync(fd, header, 0, header.length, entry.headerOffset)
                expect(Uint8Array.from(header)).toEqual(encodeBackupEntryHeader(entry.nameBytes, entry.dataLength))
                end = entry.headerOffset + entry.headerLength + entry.dataLength
            }
        } finally {
            fs.closeSync(fd)
        }
        expect(end).toBe(fs.statSync(binA).size)
        expect(end).toBe(manifestA.counts.fileBytes)

        let assets = 0
        for (const entry of entries) {
            if (entry.name === 'database.risudat' || getColdStorageBackupKey(entry.name) !== null) continue
            assets++
            expect(parseInlayEntryName(entry.name)).toBeNull()
            expect(entry.name).toMatch(/^[0-9a-f]{64}\.[a-z0-9]{1,16}$/)
            expect(entry.nameBytes.length).toBeLessThanOrEqual(255)
            expect(manifestA.assets[entry.name]?.bytes).toBe(entry.dataLength)
            expect(entry.dataLength).toBeLessThan(0xFFFFFFFF)
        }
        expect(assets).toBe(manifestA.counts.assets)
        expect(entries.filter((e) => getColdStorageBackupKey(e.name) !== null).length).toBe(manifestA.counts.unitEntries)
    }, TIMEOUT_MS)

    test('names every asset by the hash of its bytes and covers every kind, with none at 100 MiB or more in the small scale', () => {
        const kinds = Object.keys(manifestA.counts.byKind).sort()
        expect(kinds).toEqual(['additional', 'avatar', 'cc', 'customBackground', 'emotion', 'folderImage', 'moduleAsset', 'moduleIcon', 'personaIcon', 'presetImage', 'userIcon', 'vits', 'voice'])
        expect(manifestA.counts.largestAssets).toEqual([])
        for (const [name, row] of Object.entries(manifestA.assets)) expect(name.slice(0, 64)).toBe(row.sha256)
    })

    test('writes a database the app decodes, with chatPage and firstMsgIndex set on the characters', async () => {
        const db = await readDatabase(binA)
        expect(db.formatversion).toBe(5)
        expect(db.characters.length).toBe(manifestA.counts.characters)
        expect(db.modules.length).toBe(manifestA.counts.modules)
        for (const character of db.characters) {
            expect(Number.isInteger(character.chatPage)).toBe(true)
            expect(Number.isInteger(character.firstMsgIndex) || character.type === 'group').toBe(true)
            if (character.coldstorage === undefined) expect(character.chatPage).toBeLessThan(character.chats.length)
        }
        expect(db.characters.filter((c) => c.coldstorage !== undefined).length).toBe(manifestA.counts.stubs)
    }, TIMEOUT_MS)

    test('writes the database of a user who finished first setup, so a boot shows no wizard and the wizard writes nothing', async () => {
        const db = await readDatabase(binA)
        // App.svelte renders WelcomeRisu while didFirstSetup is falsy; checkNewFormat migrates below formatversion 5
        expect(db.didFirstSetup).toBe(true)
        expect(db.formatversion).toBe(5)
    }, TIMEOUT_MS)

    test('fills the store2 parts a loss could hide in, in the stub units too', async () => {
        const db = await readDatabase(binA)
        const unitCharacters = [...(await readUnitCharacters(binA)).values()]
        const all = [...db.characters.filter((c) => c.coldstorage === undefined), ...unitCharacters]
        const chats = [...all.flatMap((c) => c.chats), ...db.characters.filter((c) => c.type === 'group').flatMap((c) => c.chats)]
        const messages = chats.flatMap((chat) => chat.message)

        expect(all.some((c) => (c.globalLore?.length ?? 0) > 0)).toBe(true)
        expect(all.some((c) => c.globalLore?.some((entry) => entry.content.length >= 100 * 1024))).toBe(true)
        expect(all.some((c) => (c.customscript?.length ?? 0) > 0)).toBe(true)
        expect(all.some((c) => (c.triggerscript?.length ?? 0) > 0)).toBe(true)
        expect(chats.some((chat) => chat.scriptstate !== undefined && chat.lastMemory !== undefined && chat.suggestMessages !== undefined && chat.lastDate !== undefined)).toBe(true)
        expect(chats.some((chat) => chat.supaMemoryData !== undefined)).toBe(true)
        expect(chats.some((chat) => chat.hypaV3Data !== undefined)).toBe(true)
        expect(chats.some((chat) => (chat.localLore?.length ?? 0) > 0)).toBe(true)
        expect(messages.some((message) => message.chatId !== undefined)).toBe(true)
        const groups = db.characters.filter((c) => c.type === 'group')
        expect(groups.length).toBe(manifestA.counts.groups)
        expect(groups.every((g) => (g.characters?.length ?? 0) > 0)).toBe(true)
        expect(groups.some((g) => g.chats.some((chat) => chat.message.some((m) => m.saying !== undefined)))).toBe(true)
        expect(db.characters.filter((c) => c.trashTime !== undefined && c.coldstorage === undefined).length).toBeGreaterThan(0)
        expect(db.characters.filter((c) => c.trashTime !== undefined && c.coldstorage !== undefined).length).toBeGreaterThan(0)
        expect(db.characters.filter((c) => c.trashTime !== undefined).length).toBe(manifestA.counts.trashed)
        expect(unitCharacters.every((c) => c.trashTime === undefined)).toBe(true)
        // the startup purge (checkNewFormat) must not remove a trashed character, now or at any later boot of the same file
        for (const trashed of db.characters.filter((c) => c.trashTime !== undefined)) expect(isTrashPurgeDue(trashed.trashTime, Date.now())).toBe(false)
        expect(db.characters.some((c) => c.coldstorage !== undefined && unitCharacters.some((u) => u.chaId === c.chaId && (c.lastInteraction ?? 0) > (u.lastInteraction ?? 0)))).toBe(true)
        expect(db.modules.some((m) => (m.trigger?.length ?? 0) > 0)).toBe(true)
        expect(db.loadouts.length).toBeGreaterThan(0)
        expect(Object.keys(db.pluginCustomStorage).length).toBeGreaterThan(0)
        expect(db.enabledModules.length).toBeGreaterThan(0)
        expect(db.username).toBe('Synthetic User')
        // a trashed character is in no order entry
        const ordered = new Set(db.characterOrder.flatMap((item) => (typeof item === 'string' ? [item] : item.data)))
        for (const trashed of db.characters.filter((c) => c.trashTime !== undefined)) expect(ordered.has(trashed.chaId)).toBe(false)
    }, TIMEOUT_MS)

    test('puts global lore, trigger scripts, a VITS model and cc assets into stub units, at the small scale (counted here) and the mid scale (dry run)', async () => {
        const unitCharacters = [...(await readUnitCharacters(binA)).values()]
        expect(unitCharacters.length).toBe(manifestA.counts.stubs)
        expect(unitCharacters.some((c) => (c.globalLore?.length ?? 0) > 0)).toBe(true)
        expect(unitCharacters.some((c) => (c.triggerscript?.length ?? 0) > 0)).toBe(true)
        expect(unitCharacters.some((c) => c.vits !== undefined)).toBe(true)
        expect(unitCharacters.some((c) => (c.ccAssets?.length ?? 0) > 0)).toBe(true)

        const mid = runNode(GEN_SCRIPT, ['--scale', 'mid', '--dry-run'])
        expect(mid.status).toBe(0)
        const content = (JSON.parse(mid.stdout) as { stubUnitContent: StubUnitContent }).stubUnitContent
        expect(content.characters).toBeGreaterThan(0)
        for (const field of ['globalLore', 'triggerscript', 'vits', 'ccAssets'] as const) expect(content[field], field).toBeGreaterThan(0)
    }, TIMEOUT_MS)

    test('stores plugin values in both forms: inline, and in upstream\'s index with a small JSON value and a large value unit', async () => {
        const db = await readDatabase(binA)
        const entries = await readEntries(binA)
        const storage = db.pluginCustomStorage
        expect(manifestA.counts.pluginMapped.small).toBeGreaterThan(0)
        expect(manifestA.counts.pluginMapped.large).toBeGreaterThan(0)
        expect(Object.keys(storage).some((key) => !key.startsWith('_'))).toBe(true)
        expect(typeof storage._coldpluginIndex).toBe('string')
        expect(storage._coldplugin).toBeUndefined()
        const indexEntry = entries.find((e) => e.name === unitName(storage._coldpluginIndex as string))!
        const index = JSON.parse(readBytes(binA, indexEntry.headerOffset + indexEntry.headerLength, indexEntry.dataLength).toString('utf8')) as PluginIndexUnit
        expect(index.type).toBe('risu-plugin-storage-index')
        expect(index.entries.filter((entry) => entry.s !== undefined).length).toBe(manifestA.counts.pluginMapped.small)
        for (const entry of index.entries.filter((e) => e.l !== undefined)) expect(entries.some((e) => e.name === unitName(entry.l!))).toBe(true)
    }, TIMEOUT_MS)

    test('keeps the root user fields equal to persona 0 (the selected persona), as saveUserPersona and changeUserPersona do', async () => {
        const db = await readDatabase(binA)
        const persona = db.personas[db.selectedPersona]
        expect(db.selectedPersona).toBe(0)
        expect(persona.name).toBe(db.username)
        expect(persona.personaPrompt).toBe(db.personaPrompt)
        expect(persona.icon).toBe(db.userIcon)
        expect(persona.note).toBe(db.userNote)
    }, TIMEOUT_MS)

    test('writes promptInfoInsideChat false at the root, so a web export (setDatabase forces it) and a Tauri export (it stays absent) agree', async () => {
        const db = await readDatabase(binA)
        expect(Object.hasOwn(db, 'promptInfoInsideChat')).toBe(true)
        expect(db.promptInfoInsideChat).toBe(false)
    }, TIMEOUT_MS)

    test('writes no key-like property and no credential-looking value anywhere in the database or the units', async () => {
        const db = await readDatabase(binA)
        const units = [...verifier.inspectBin(binA).walk.units.values()]
        expect(credentialFindings(db)).toEqual([])
        expect(credentialFindings(units)).toEqual([])
        // the walk itself flags what it claims to: nested fake keys, in an array element, a plain object and a string
        expect(credentialFindings({ botPresets: [{ openAIKey: 'x' }] })).toHaveLength(1)
        expect(credentialFindings({ globalChatVariables: { api_key: 'x' } })).toHaveLength(1)
        expect(credentialFindings({ pluginCustomStorage: { v: { accessToken: 'x' } } })).toHaveLength(1)
        expect(credentialFindings({ note: 'ghp_abcdef' })).toHaveLength(1)
        expect(credentialFindings({ lorebook: [{ key: 'a', secondkey: 'b' }] })).toEqual([])
        expect(credentialFindings({ other: [{ key: 'a' }] })).toHaveLength(1)
        // the file-name exemption is only the `files` map of a `vits` object: a `files` map anywhere else is guarded
        expect(credentialFindings({ characters: [{ vits: { files: { 'tokenizer.json': 'a' } } }] })).toEqual([])
        expect(credentialFindings({ pluginCustomStorage: { v: { files: { apiKey: 'x' } } } })).toHaveLength(1)
        expect(credentialFindings({ vits: { nested: { files: { apiKey: 'x' } } } })).toHaveLength(1)
        // every top-level field is on this list; none holds a credential, and a new one has to be added here on purpose
        expect(Object.keys(db).sort()).toEqual([
            'additionalPrompt', 'autoTranslate', 'botPresets', 'botPresetsId', 'characterOrder', 'characters', 'customBackground', 'customCSS',
            'descriptionPrefix', 'didFirstSetup', 'enabledModules', 'formatversion', 'globalChatVariables', 'globalNote', 'iconsize', 'language', 'loadouts',
            'loreBookDepth', 'loreBookToken', 'maxContext', 'maxResponse', 'modules', 'personaPrompt', 'personas', 'pluginCustomStorage', 'promptInfoInsideChat', 'selectedPersona',
            'statics', 'swipe', 'temperature', 'textTheme', 'theme', 'userIcon', 'userNote', 'username', 'zoomsize',
        ])
    }, TIMEOUT_MS)

    test('is deterministic: the same seed and scale give identical files and manifests', () => {
        generate(binB)
        expect(sha256File(binB)).toBe(sha256File(binA))
        expect(fs.readFileSync(binB + '.manifest.json', 'utf8')).toBe(fs.readFileSync(manifestPathA, 'utf8'))
        fs.rmSync(binB)
    }, TIMEOUT_MS)

    test('refuses an output path inside the repository (dry run, so a failure to refuse writes nothing)', () => {
        const target = path.join(REPO_ROOT, 'synth-should-not-exist.bin')
        const result = runNode(GEN_SCRIPT, ['--out', target, '--scale', 'small', '--dry-run'])
        expect(result.status).not.toBe(0)
        expect(result.stderr).toContain('inside the repository')
        expect(fs.existsSync(target)).toBe(false)
    })

    test('plans the device scale as the real-shape profile: 500 characters, 771 chats, 164 modules, about 517 assets that are almost all avatars', () => {
        const dry = runNode(GEN_SCRIPT, ['--scale', 'device', '--dry-run'])
        expect(dry.status).toBe(0)
        const plan = JSON.parse(dry.stdout) as {
            characters: number, groups: number, stubs: number, trashed: number, chats: number, modules: number, assets: number,
            largestAssets: unknown[], byKind: Record<string, { count: number, bytes: number }>, estimatedFileBytes: number,
        }
        expect(plan.characters).toBe(500)
        expect(plan.groups).toBe(0)
        expect(plan.stubs).toBe(0)
        expect(plan.trashed).toBe(0)
        expect(plan.chats).toBe(771)
        expect(plan.modules).toBe(164)
        expect(Math.abs(plan.assets - 517)).toBeLessThanOrEqual(3)
        expect(plan.byKind.avatar.count).toBe(500)
        expect(plan.byKind.avatar.bytes / 500).toBeGreaterThanOrEqual(4 * 1024)
        expect(plan.byKind.avatar.bytes / 500).toBeLessThanOrEqual(8 * 1024)
        for (const kind of ['additional', 'emotion', 'vits', 'voice', 'cc', 'moduleAsset']) expect(plan.byKind[kind], kind).toBeUndefined()
        expect(plan.largestAssets).toEqual([])
        expect(plan.estimatedFileBytes).toBeLessThan(100 * 1024 * 1024)
        // the same seed plans the same profile
        expect(runNode(GEN_SCRIPT, ['--scale', 'device', '--dry-run']).stdout).toBe(dry.stdout)
    }, TIMEOUT_MS)
})

describe('the verifier\'s resolved tree against the app\'s own import', () => {
    test('equals what repairImportTree and resolveLegacyTree make of the generated file (stubs, trash state, plugin index, all repairs)', async () => {
        const { expected, imported } = await appImportedTree(binA)
        const diff = verifier.deepDiff(expected, imported, 20)
        expect(diff.sample).toEqual([])
        expect(diff.differences).toBe(0)
    }, TIMEOUT_MS)

    test('equals it for a cold chat pointer, with the unit\'s side fields, and for a unit that lacks one the chat keeps', async () => {
        for (const keepOnChat of [false, true]) {
            const copy = path.join(scratch, 'oracle-cold-chat.bin')
            await coldChatCopy(copy, keepOnChat)
            const { expected, imported } = await appImportedTree(copy)
            const diff = verifier.deepDiff(expected, imported, 20)
            expect(diff.sample, `keepOnChat ${keepOnChat}`).toEqual([])
            expect(diff.differences, `keepOnChat ${keepOnChat}`).toBe(0)
            fs.rmSync(copy)
        }
    }, TIMEOUT_MS)

    test('the app\'s boot repairs (character tree, personas, preset id) change nothing in the generated file, and see a character without an id', async () => {
        const { repairCharacterTree, repairPersonas } = await import('src/ts/storage/characterTreeRepair')
        const { repairBotPresetsId } = await import('src/ts/storage/botPresetRepair')
        type AppDatabase = Parameters<typeof repairBotPresetsId>[0]
        const bootRepairs = async (blankId: boolean) => {
            const loaded = verifier.inspectBin(binA)
            const db = loaded.db!
            if (blankId) (db.characters as unknown as SynthCharacter[]).find((c) => c.coldstorage === undefined && c.type === 'character')!.chaId = ''
            const expected = structuredClone(verifier.resolveTree(db, loaded.walk.units).tree)
            const changedPreset = repairBotPresetsId(db as unknown as AppDatabase)
            const character = await repairCharacterTree(db as unknown as Database, 'boot')
            const changedPersonas = repairPersonas(db as unknown as Parameters<typeof repairPersonas>[0])
            return { changedPreset, notices: character.notices, changedPersonas, diff: verifier.deepDiff(expected, verifier.resolveTree(db, loaded.walk.units).tree, 20) }
        }
        const clean = await bootRepairs(false)
        expect(clean.changedPreset).toBe(false)
        expect(clean.notices).toEqual([])
        expect(clean.changedPersonas).toBe(0)
        expect(clean.diff.differences).toBe(0)
        const twin = await bootRepairs(true)
        expect(twin.notices.length).toBeGreaterThan(0)
        expect(twin.diff.sample.some((entry) => entry.path.endsWith('.chaId'))).toBe(true)
    }, TIMEOUT_MS)

    test('sees a repair the import makes: two chats with one id are not a fixed point (the second is given a new id)', async () => {
        const copy = path.join(scratch, 'oracle-duplicate-chat-id.bin')
        await rewriteBin(binA, copy, {
            mutate: (db) => {
                const inline = db.characters.filter((c) => c.coldstorage === undefined && c.type === 'character')
                inline[1].chats[0].id = inline[0].chats[0].id
            },
        })
        const { expected, imported } = await appImportedTree(copy)
        expect(verifier.deepDiff(expected, imported, 20).differences).toBeGreaterThan(0)
        fs.rmSync(copy)
    }, TIMEOUT_MS)
})

describe('synthetic .bin verifier', () => {
    test('passes on the generator output', () => {
        const { status, report } = verify(binA)
        expect(report.problems).toEqual([])
        expect(report.differences).toBe(0)
        expect(report.kinds.assets.matched).toBe(manifestA.counts.assets)
        expect(report.kinds.characters.matched).toBe(manifestA.counts.characters)
        expect(report.kinds.chats.matched).toBe(manifestA.counts.chats)
        expect(report.kinds.parts.matched).toBe(manifestA.counts.parts)
        expect(status).toBe(0)
    }, TIMEOUT_MS)

    test('passes after the app re-encodes the database unchanged (control for the mutants below)', async () => {
        const copy = path.join(scratch, 'control.bin')
        await rewriteBin(binA, copy)
        const { status, report } = verify(copy)
        expect(report.problems).toEqual([])
        expect(report.differences).toBe(0)
        expect(status).toBe(0)
        fs.rmSync(copy)
    }, TIMEOUT_MS)

    test('fails when one asset byte changes', async () => {
        const copy = path.join(scratch, 'asset-byte.bin')
        fs.copyFileSync(binA, copy)
        const entries = await readEntries(copy)
        const asset = entries.find((e) => manifestA.assets[e.name] !== undefined && e.dataLength > 200)!
        const at = asset.headerOffset + asset.headerLength + 100
        const byte = readBytes(copy, at, 1)
        const fd = fs.openSync(copy, 'r+')
        try {
            fs.writeSync(fd, Buffer.from([byte[0] ^ 0xFF]), 0, 1, at)
        } finally {
            fs.closeSync(fd)
        }
        const { status, report } = verify(copy)
        expect(report.kinds.assets.changed).toBe(1)
        expect(report.kinds.assets.missing).toBe(0)
        expect(report.kinds.characters.changed + report.kinds.chats.changed + report.kinds.modules.changed + report.kinds.parts.changed).toBe(0)
        expect(status).toBe(1)
        fs.rmSync(copy)
    }, TIMEOUT_MS)

    test('fails when one chat message changes', async () => {
        const copy = path.join(scratch, 'chat-message.bin')
        await rewriteBin(binA, copy, {
            mutate: (db) => {
                const holder = db.characters.find((c) => c.coldstorage === undefined && c.type === 'character')!
                holder.chats[0].message[0].data += '!'
            },
        })
        const { status, report } = verify(copy)
        expect(report.kinds.chats.changed).toBe(1)
        expect(report.kinds.parts.changed).toBe(1)
        expect(report.kinds.assets.changed + report.kinds.modules.changed).toBe(0)
        expect(status).toBe(1)
        fs.rmSync(copy)
    }, TIMEOUT_MS)

    test('fails when one module field changes', async () => {
        const copy = path.join(scratch, 'module-field.bin')
        await rewriteBin(binA, copy, { mutate: (db) => { db.modules[0].description += '!' } })
        const { status, report } = verify(copy)
        expect(report.kinds.modules.changed).toBe(1)
        expect(report.kinds.parts.changed).toBe(1)
        expect(report.kinds.assets.changed + report.kinds.chats.changed).toBe(0)
        expect(status).toBe(1)
        fs.rmSync(copy)
    }, TIMEOUT_MS)

    test('fails when a module trigger or lorebook entry changes', async () => {
        const copy = path.join(scratch, 'module-parts.bin')
        await rewriteBin(binA, copy, {
            mutate: (db) => {
                db.modules[0].trigger = []
                db.modules[1].lorebook![0].content += '!'
            },
        })
        const { status, report } = verify(copy)
        expect(report.kinds.modules.changed).toBe(2)
        expect(status).toBe(1)
        fs.rmSync(copy)
    }, TIMEOUT_MS)

    test('fails when an asset entry is missing', async () => {
        const copy = path.join(scratch, 'missing-asset.bin')
        const entries = await readEntries(binA)
        const first = entries[0]
        const rest = fs.readFileSync(binA).subarray(first.headerLength + first.dataLength)
        fs.writeFileSync(copy, rest)
        const { status, report } = verify(copy)
        expect(report.kinds.assets.missing).toBe(1)
        expect(status).toBe(1)
        fs.rmSync(copy)
    }, TIMEOUT_MS)

    test('fails when an extra asset entry is present', () => {
        const copy = path.join(scratch, 'extra-asset.bin')
        fs.copyFileSync(binA, copy)
        const name = new TextEncoder().encode(`${'0'.repeat(64)}.png`)
        fs.appendFileSync(copy, Buffer.concat([Buffer.from(encodeBackupEntryHeader(name, 4)), Buffer.from([1, 2, 3, 4])]))
        const { status, report } = verify(copy)
        expect(report.kinds.assets.extra).toBe(1)
        expect(status).toBe(1)
        fs.rmSync(copy)
    }, TIMEOUT_MS)

    test('fails when the last entry is truncated', () => {
        const copy = path.join(scratch, 'truncated.bin')
        fs.copyFileSync(binA, copy)
        fs.truncateSync(copy, fs.statSync(copy).size - 10)
        const { status, report } = verify(copy)
        expect(report.problems.some((problem) => problem.includes('runs past the end'))).toBe(true)
        expect(report.ok).toBe(false)
        expect(status).toBe(1)
        fs.rmSync(copy)
    }, TIMEOUT_MS)

    test('fails when one inline character field changes', async () => {
        const copy = path.join(scratch, 'character-field.bin')
        await rewriteBin(binA, copy, {
            mutate: (db) => { db.characters.find((c) => c.coldstorage === undefined && c.type === 'character')!.desc += '!' },
        })
        const { status, report } = verify(copy)
        expect(report.kinds.characters.changed).toBe(1)
        expect(report.kinds.chats.changed + report.kinds.modules.changed + report.kinds.assets.changed).toBe(0)
        expect(status).toBe(1)
        fs.rmSync(copy)
    }, TIMEOUT_MS)

    test('fails when a field in a stub unit changes', async () => {
        const copy = path.join(scratch, 'unit-field.bin')
        await rewriteBin(binA, copy, { mutateUnits: (units) => { unitOf(units, 0).character.desc += '!' } })
        const { status, report } = verify(copy)
        expect(report.problems).toEqual([])
        expect(report.kinds.characters.changed).toBe(1)
        expect(status).toBe(1)
        fs.rmSync(copy)
    }, TIMEOUT_MS)

    test('fails when two stub unit bodies are swapped under their names (the importer would write placeholders)', async () => {
        const copy = path.join(scratch, 'swap-units.bin')
        await rewriteBin(binA, copy, {
            mutateUnits: (units) => {
                const names = stubUnitNames(units)
                const first = units.get(names[0])
                units.set(names[0], units.get(names[1]))
                units.set(names[1], first)
            },
        })
        const { status, report } = verify(copy)
        expect(report.problems.filter((problem) => problem.includes('names a unit that holds')).length).toBeGreaterThanOrEqual(2)
        expect(report.ok).toBe(false)
        expect(status).toBe(1)
        fs.rmSync(copy)
    }, TIMEOUT_MS)

    test('fails when a stub slot chaId changes and its unit keeps the old one', async () => {
        const copy = path.join(scratch, 'stub-chaid.bin')
        await rewriteBin(binA, copy, {
            mutate: (db) => {
                const slot = db.characters.find((c) => c.coldstorage !== undefined)!
                const old = slot.chaId
                slot.chaId = '00000000-0000-4000-8000-000000000000'
                db.characterOrder = db.characterOrder.map((item) => (item === old ? slot.chaId : item))
            },
        })
        const { status, report } = verify(copy)
        expect(report.problems.some((problem) => problem.includes('names a unit that holds'))).toBe(true)
        expect(report.ok).toBe(false)
        expect(status).toBe(1)
        fs.rmSync(copy)
    }, TIMEOUT_MS)

    test('matches a stub unit by its exact key, not by a case-folded one', async () => {
        const copy = path.join(scratch, 'unit-key-case.bin')
        await rewriteBin(binA, copy, {
            mutate: (db) => {
                const slot = db.characters.find((c) => c.coldstorage !== undefined)!
                slot.coldstorage = slot.coldstorage!.toUpperCase()
            },
        })
        const { status, report } = verify(copy)
        expect(report.problems.some((problem) => problem.includes('no usable unit entry'))).toBe(true)
        expect(status).toBe(1)
        fs.rmSync(copy)
    }, TIMEOUT_MS)

    test('takes the trash state from the stub: a stub that loses its trashTime, or an older lastInteraction, is a difference', async () => {
        const trashCopy = path.join(scratch, 'stub-trash.bin')
        await rewriteBin(binA, trashCopy, {
            mutate: (db) => { delete db.characters.find((c) => c.coldstorage !== undefined && c.trashTime !== undefined)!.trashTime },
        })
        const trash = verify(trashCopy)
        expect(trash.report.kinds.characters.changed).toBe(1)
        expect(trash.status).toBe(1)
        fs.rmSync(trashCopy)

        const unitCharacters = await readUnitCharacters(binA)
        const newerCopy = path.join(scratch, 'stub-newer.bin')
        await rewriteBin(binA, newerCopy, {
            mutate: (db) => {
                const slot = db.characters.find((c) => c.coldstorage !== undefined && (c.lastInteraction ?? 0) > (unitCharacters.get(c.chaId)?.lastInteraction ?? 0))!
                // the unit's own, older value now wins on restore, so the character differs from the one the stub dated
                slot.lastInteraction = unitCharacters.get(slot.chaId)!.lastInteraction
            },
        })
        const newer = verify(newerCopy)
        expect(newer.report.kinds.characters.changed).toBe(1)
        expect(newer.status).toBe(1)
        fs.rmSync(newerCopy)
    }, TIMEOUT_MS)

    test('ignores a trashTime in the unit of an untrashed stub (the stub is authoritative, so the restored character has none)', async () => {
        const copy = path.join(scratch, 'unit-trash.bin')
        await rewriteBin(binA, copy, {
            mutate: (db, units) => {
                const untrashed = db.characters.find((c) => c.coldstorage !== undefined && c.trashTime === undefined)!
                const unit = [...units.values()].map((value) => value as Partial<SynthUnit>).find((value) => value.character?.chaId === untrashed.chaId)!
                unit.character!.trashTime = TRASHED_FAR_FUTURE
            },
        })
        const { status, report } = verify(copy)
        expect(report.problems).toEqual([])
        expect(report.differences).toBe(0)
        expect(status).toBe(0)
        fs.rmSync(copy)
    }, TIMEOUT_MS)

    test('fails when a persona, a preset, a folder or the user icon changes', async () => {
        const edits: { name: string, mutate: (db: SynthDatabase) => void }[] = [
            { name: 'persona', mutate: (db) => { db.personas[0].name += '!' } },
            { name: 'preset', mutate: (db) => { db.botPresets[0].name += '!' } },
            { name: 'folder', mutate: (db) => { (db.characterOrder.find((item) => typeof item !== 'string') as SynthFolder).name += '!' } },
            { name: 'icon', mutate: (db) => { db.userIcon = db.userIcon.replace('assets/', 'assets/x') } },
            { name: 'loadout', mutate: (db) => { db.loadouts[0].characterIds.pop() } },
            { name: 'plugin value', mutate: (db) => { (db.pluginCustomStorage[Object.keys(db.pluginCustomStorage).find((key) => !key.startsWith('_'))!] as { note: string }).note += '!' } },
            { name: 'setting', mutate: (db) => { db.username += '!' } },
            { name: 'enabled modules', mutate: (db) => { db.enabledModules.pop() } },
        ]
        for (const edit of edits) {
            const copy = path.join(scratch, 'misc-edit.bin')
            await rewriteBin(binA, copy, { mutate: edit.mutate })
            const { status, report } = verify(copy)
            expect(report.kinds.parts.changed, edit.name).toBe(1)
            expect(report.kinds.characters.changed + report.kinds.chats.changed + report.kinds.modules.changed + report.kinds.assets.changed, edit.name).toBe(0)
            expect(status, edit.name).toBe(1)
            fs.rmSync(copy)
        }
    }, TIMEOUT_MS)

    test('fails when the chats of a character are reordered, or the character order or list order changes', async () => {
        const chatsCopy = path.join(scratch, 'reorder-chats.bin')
        await rewriteBin(binA, chatsCopy, {
            mutate: (db) => { db.characters.find((c) => c.coldstorage === undefined && c.chats.length >= 2)!.chats.reverse() },
        })
        const chats = verify(chatsCopy)
        expect(chats.report.kinds.characters.changed).toBe(1)
        expect(chats.status).toBe(1)
        fs.rmSync(chatsCopy)

        const orderCopy = path.join(scratch, 'reorder-order.bin')
        await rewriteBin(binA, orderCopy, {
            mutate: (db) => {
                const bare = db.characterOrder.map((item, index) => ({ item, index })).filter((entry) => typeof entry.item === 'string')
                const [first, second] = [bare[0], bare[1]]
                db.characterOrder[first.index] = second.item
                db.characterOrder[second.index] = first.item
            },
        })
        const order = verify(orderCopy)
        expect(order.report.kinds.parts.changed).toBe(1)
        expect(order.status).toBe(1)
        fs.rmSync(orderCopy)

        const listCopy = path.join(scratch, 'reorder-list.bin')
        await rewriteBin(binA, listCopy, {
            mutate: (db) => { [db.characters[0], db.characters[1]] = [db.characters[1], db.characters[0]] },
        })
        const list = verify(listCopy)
        expect(list.report.kinds.parts.changed).toBe(1)
        expect(list.status).toBe(1)
        fs.rmSync(listCopy)
    }, TIMEOUT_MS)

    test('fails when the persona, preset, module or loadout list is reordered (selectedPersona, botPresetsId and the enabled list address them)', async () => {
        const reorders: { name: string, part: string, mutate: (db: SynthDatabase) => void }[] = [
            { name: 'personas', part: 'personas', mutate: (db) => { db.personas.reverse() } },
            { name: 'presets', part: 'botPresets', mutate: (db) => { db.botPresets.reverse() } },
            { name: 'modules', part: 'modules', mutate: (db) => { db.modules.reverse() } },
            { name: 'loadouts', part: 'loadouts', mutate: (db) => { db.loadouts.reverse() } },
        ]
        for (const reorder of reorders) {
            const copy = path.join(scratch, 'reorder-list-part.bin')
            await rewriteBin(binA, copy, { mutate: reorder.mutate })
            const { status, report } = verify(copy)
            expect(report.kinds.parts.changed, reorder.name).toBe(1)
            expect(report.kinds.characters.changed + report.kinds.chats.changed + report.kinds.assets.changed, reorder.name).toBe(0)
            expect(status, reorder.name).toBe(1)
            fs.rmSync(copy)
        }
    }, TIMEOUT_MS)

    test('fails on a duplicated module, character or chat even when the copy is identical', async () => {
        const moduleCopy = path.join(scratch, 'duplicate-module.bin')
        await rewriteBin(binA, moduleCopy, { mutate: (db) => { db.modules.push(structuredClone(db.modules[0])) } })
        const duplicateModule = verify(moduleCopy)
        expect(duplicateModule.report.problems.some((problem) => problem.includes('modules appear more than once'))).toBe(true)
        expect(duplicateModule.report.kinds.parts.changed).toBe(1)
        expect(duplicateModule.status).toBe(1)
        fs.rmSync(moduleCopy)

        const chatCopy = path.join(scratch, 'duplicate-chat.bin')
        await rewriteBin(binA, chatCopy, {
            mutate: (db) => {
                const holder = db.characters.find((c) => c.coldstorage === undefined && c.type === 'character')!
                holder.chats.push(structuredClone(holder.chats[0]))
            },
        })
        const duplicateChat = verify(chatCopy)
        expect(duplicateChat.report.problems.some((problem) => problem.includes('chats appear more than once'))).toBe(true)
        expect(duplicateChat.status).toBe(1)
        fs.rmSync(chatCopy)
    }, TIMEOUT_MS)

    test('fails when a chat tail field or a message stamp is lost', async () => {
        const copy = path.join(scratch, 'tail-state.bin')
        await rewriteBin(binA, copy, {
            mutate: (db) => {
                const chat = db.characters.find((c) => c.coldstorage === undefined)!.chats.find((c) => c.scriptstate !== undefined)!
                delete chat.scriptstate
            },
        })
        const { status, report } = verify(copy)
        expect(report.kinds.chats.changed).toBe(1)
        expect(status).toBe(1)
        fs.rmSync(copy)
    }, TIMEOUT_MS)

    test('rejects a manifest whose counts disagree with what it lists', () => {
        const manifestPath = path.join(scratch, 'bad-counts.manifest.json')
        const bad = JSON.parse(fs.readFileSync(manifestPathA, 'utf8')) as Manifest
        bad.counts.assets += 1
        fs.writeFileSync(manifestPath, JSON.stringify(bad))
        const { status, report } = verify(binA, manifestPath)
        expect(report.problems.some((problem) => problem.includes('counts says'))).toBe(true)
        expect(status).toBe(1)

        const emptyPath = path.join(scratch, 'empty.manifest.json')
        fs.writeFileSync(emptyPath, JSON.stringify({ ...bad, counts: { ...bad.counts, assets: 0, characters: 0, chats: 0, modules: 0, parts: 0 }, assets: {}, characters: {}, chats: {}, modules: {}, parts: {} }))
        const empty = verify(binA, emptyPath)
        expect(empty.status).toBe(1)
        expect(empty.report.kinds.assets.extra).toBe(manifestA.counts.assets)
    }, TIMEOUT_MS)

    test('resolves a legacy cold-storage chat pointer with the chat\'s own remaining messages and the unit\'s side fields', async () => {
        const copy = path.join(scratch, 'cold-chat.bin')
        await coldChatCopy(copy, false)
        const { status, report } = verify(copy)
        expect(report.problems).toEqual([])
        expect(report.resolution?.coldChats).toBe(1)
        expect(report.differences).toBe(0)
        expect(status).toBe(0)
        fs.rmSync(copy)
    }, TIMEOUT_MS)

    test('clears a side field of the chat that the cold chat unit lacks (the unit is authoritative), which is a difference', async () => {
        const copy = path.join(scratch, 'cold-chat-clear.bin')
        await coldChatCopy(copy, true)
        const { status, report } = verify(copy)
        expect(report.problems).toEqual([])
        expect(report.resolution?.coldChats).toBe(1)
        expect(report.kinds.chats.changed).toBe(1)
        expect(status).toBe(1)
        fs.rmSync(copy)
    }, TIMEOUT_MS)

    test('passes the plugin storage in the fork\'s map form (a unit per key under _coldplugin), and fails when one of those values changes', async () => {
        const forkForm = (change: 'none' | 'value' | 'drop-unit'): RewriteOptions['mutate'] => (db, units) => {
            const storage = db.pluginCustomStorage
            const indexName = unitName(storage._coldpluginIndex as string)
            const index = units.get(indexName) as PluginIndexUnit
            const map: Record<string, string> = {}
            for (const entry of index.entries) {
                const id = randomUUID()
                const value = entry.s !== undefined ? JSON.parse(entry.s) as { note: string } : units.get(unitName(entry.l!)) as { note: string }
                if (entry.l !== undefined) units.delete(unitName(entry.l))
                if (change === 'value' && Object.keys(map).length === 0) value.note += '!'
                if (!(change === 'drop-unit' && Object.keys(map).length === 0)) units.set(unitName(id), value)
                map[entry.k] = id
            }
            units.delete(indexName)
            delete storage._coldpluginIndex
            storage._coldplugin = map
        }
        const copy = path.join(scratch, 'plugin-map-form.bin')
        await rewriteBin(binA, copy, { mutate: forkForm('none') })
        const same = verify(copy)
        expect(same.report.problems).toEqual([])
        expect(same.report.differences).toBe(0)
        expect(same.status).toBe(0)
        fs.rmSync(copy)

        await rewriteBin(binA, copy, { mutate: forkForm('value') })
        const changed = verify(copy)
        expect(changed.report.kinds.parts.changed).toBe(1)
        expect(changed.status).toBe(1)
        fs.rmSync(copy)

        await rewriteBin(binA, copy, { mutate: forkForm('drop-unit') })
        const dropped = verify(copy)
        expect(dropped.report.problems.some((problem) => problem.includes('has no entry'))).toBe(true)
        expect(dropped.status).toBe(1)
        fs.rmSync(copy)
    }, TIMEOUT_MS)

    test('reports a plugin storage unit that has no entry', async () => {
        const copy = path.join(scratch, 'plugin-unit-missing.bin')
        await rewriteBin(binA, copy, {
            mutate: (db, units) => {
                const index = units.get(unitName(db.pluginCustomStorage._coldpluginIndex as string)) as PluginIndexUnit
                units.delete(unitName(index.entries.find((entry) => entry.l !== undefined)!.l!))
            },
        })
        const { status, report } = verify(copy)
        expect(report.problems.some((problem) => problem.includes('has no entry'))).toBe(true)
        expect(status).toBe(1)
        fs.rmSync(copy)
    }, TIMEOUT_MS)

    test('reports a plugin storage index without a trash list, which the app rejects', async () => {
        const copy = path.join(scratch, 'plugin-index-no-trash.bin')
        await rewriteBin(binA, copy, {
            mutate: (db, units) => { delete (units.get(unitName(db.pluginCustomStorage._coldpluginIndex as string)) as PluginIndexUnit).trash },
        })
        const { status, report } = verify(copy)
        expect(report.problems.some((problem) => problem.includes('is not an index'))).toBe(true)
        expect(status).toBe(1)
        fs.rmSync(copy)
    }, TIMEOUT_MS)

    test('prints the root keys only the exported file holds, each with a 16-hex value hash, and does not fail on them', async () => {
        const addedCopy = path.join(scratch, 'root-added.bin')
        await rewriteBin(binA, addedCopy, {
            mutate: (db) => {
                const root = db as unknown as Tree
                root.fullScreen = false
                root.loreBook = [{ name: 'My First LoreBook', data: [] }]
                root.unrelatedAppDefault = { nested: [1, 2, 3] }
            },
        })
        const added = verify(addedCopy)
        expect(added.report.problems).toEqual([])
        expect(added.report.differences).toBe(0)
        expect(added.report.addedRootKeys.map((entry) => entry.name)).toEqual(['fullScreen', 'loreBook', 'unrelatedAppDefault'])
        for (const entry of added.report.addedRootKeys) expect(entry.hash).toMatch(/^[0-9a-f]{16}$/)
        expect(added.report.addedRootKeys[0].hash).toBe(createHash('sha256').update('false').digest('hex').slice(0, 16))
        expect(added.status).toBe(0)
        fs.rmSync(addedCopy)
    }, TIMEOUT_MS)

    test('still fails on a changed or removed generated root key', async () => {
        const changedCopy = path.join(scratch, 'root-changed.bin')
        await rewriteBin(binA, changedCopy, { mutate: (db) => { (db as unknown as Tree).globalNote = 'changed' } })
        const changed = verify(changedCopy)
        expect(changed.report.kinds.parts.changed).toBe(1)
        expect(changed.status).toBe(1)
        fs.rmSync(changedCopy)

        const droppedCopy = path.join(scratch, 'root-dropped.bin')
        await rewriteBin(binA, droppedCopy, { mutate: (db) => { delete (db as unknown as Tree).statics } })
        const dropped = verify(droppedCopy)
        expect(dropped.report.kinds.parts.missing).toBe(1)
        expect(dropped.status).toBe(1)
        fs.rmSync(droppedCopy)
    }, TIMEOUT_MS)
})

describe('synthetic .bin verifier, second file against the first', () => {
    test('passes a file against itself and fails when the second differs in a chat, a module or an asset entry', async () => {
        const same = verifyAgainstBin(binA, binA)
        expect(same.report.problems).toEqual([])
        expect(same.report.differences).toBe(0)
        expect(same.status).toBe(0)

        const chatCopy = path.join(scratch, 'against-chat.bin')
        await rewriteBin(binA, chatCopy, { mutate: (db) => { db.characters.find((c) => c.coldstorage === undefined && c.type === 'character')!.chats[0].message[0].data += '!' } })
        const chat = verifyAgainstBin(binA, chatCopy)
        expect(chat.report.kinds.chats.changed).toBe(1)
        expect(chat.status).toBe(1)
        fs.rmSync(chatCopy)

        const moduleCopy = path.join(scratch, 'against-module.bin')
        await rewriteBin(binA, moduleCopy, { mutate: (db) => { db.modules[0].description += '!' } })
        const module = verifyAgainstBin(binA, moduleCopy)
        expect(module.report.kinds.modules.changed).toBe(1)
        expect(module.status).toBe(1)
        fs.rmSync(moduleCopy)

        const assetCopy = path.join(scratch, 'against-asset.bin')
        const entries = await readEntries(binA)
        fs.writeFileSync(assetCopy, fs.readFileSync(binA).subarray(entries[0].headerLength + entries[0].dataLength))
        const asset = verifyAgainstBin(binA, assetCopy)
        expect(asset.report.kinds.assets.missing).toBe(1)
        expect(asset.status).toBe(1)
        fs.rmSync(assetCopy)
    }, TIMEOUT_MS)

    test('lists every difference by JSON path: a changed value, a changed list length, a missing key and a reordered list', async () => {
        const copy = path.join(scratch, 'against-paths.bin')
        await rewriteBin(binA, copy, {
            mutate: (db) => {
                db.personas[1].name += '!'
                db.loadouts[0].characterIds.pop()
                delete (db as unknown as Tree).statics
                db.botPresets.reverse()
            },
        })
        const { status, report } = verifyAgainstBin(binA, copy)
        expect(status).toBe(1)
        const paths = report.tree!.sample.map((entry) => `${entry.kind} ${entry.path}`)
        expect(paths).toContain('changed $.personas[1].name')
        expect(paths).toContain('length $.loadouts[0].characterIds')
        expect(paths).toContain('missing $.statics')
        expect(paths).toContain('changed $.botPresets[0].id')
        expect(report.differences).toBe(report.tree!.differences)
        fs.rmSync(copy)
    }, TIMEOUT_MS)

    test('lets the second file hold root keys the first lacks and reports them, unless --forbid-added-root-keys names them as problems', async () => {
        const copy = path.join(scratch, 'against-added.bin')
        await rewriteBin(binA, copy, { mutate: (db) => { (db as unknown as Tree).fullScreen = false } })
        const { status, report } = verifyAgainstBin(binA, copy)
        expect(report.tree!.addedRootKeys).toEqual(['fullScreen'])
        expect(report.addedRootKeys.map((entry) => entry.name)).toEqual(['fullScreen'])
        expect(report.problems).toEqual([])
        expect(report.differences).toBe(0)
        expect(status).toBe(0)

        const forbidden = verifyAgainstBin(binA, copy, true)
        expect(forbidden.report.problems.some((problem) => problem.includes('"fullScreen"'))).toBe(true)
        expect(forbidden.report.addedRootKeys.map((entry) => entry.name)).toEqual(['fullScreen'])
        expect(forbidden.status).toBe(1)
        // a root key only the first file holds is a difference with or without the switch
        const reverse = verifyAgainstBin(copy, binA, true)
        expect(reverse.report.differences).toBeGreaterThan(0)
        expect(reverse.status).toBe(1)
        const same = verifyAgainstBin(binA, binA, true)
        expect(same.report.problems).toEqual([])
        expect(same.status).toBe(0)
        fs.rmSync(copy)
    }, TIMEOUT_MS)

    test('refuses --forbid-added-root-keys with a manifest', () => {
        const result = runNode(VERIFY_SCRIPT, ['--manifest', manifestPathA, '--bin', binA, '--forbid-added-root-keys'])
        expect(result.status).not.toBe(0)
        expect(result.stderr).toContain('--forbid-added-root-keys')
    })

    test('reports an unusable first file instead of passing', () => {
        const broken = path.join(scratch, 'against-broken.bin')
        fs.writeFileSync(broken, Buffer.alloc(0))
        const { status, report } = verifyAgainstBin(broken, binA)
        expect(report.ok).toBe(false)
        expect(report.problems.some((problem) => problem.startsWith('a: '))).toBe(true)
        expect(status).toBe(1)
        fs.rmSync(broken)
    })
})
