/**
 * Preset meta (id, folderId, slot), `presetFolders` and the `presetSlot*` rows through the composed `.bin` round trip:
 * a fork profile goes through the real `SaveLocalBackup`, and is read three ways.
 *
 * - G-a: upstream's own steps over the fork export (the mirror in `upstreamPresetMirror.ts`) keep upstream's preset data,
 *   order, `botPresetsId`, chain, loadouts and Ctrl+n targets; the new keys are present and ignored.
 * - G-b: the export goes through upstream steps that drop meta (switch, copy, move, delete), is re-encoded in upstream's
 *   block format, and re-imports with the real `LoadLocalBackup`, a fresh boot and the id pass and slot migration in `setDatabase`'s order:
 *   ids are distinct strings, rebuilt entries have no slot and no folder, stars on dropped ids show on no preset, and
 *   nothing lands on a preset other than the one it named, with the one known limit (b4: an upstream copy of a preset that
 *   was not active becomes the sole holder of the original's id). Loadouts follow the same rule: the fork resolves by id,
 *   upstream by name, and the export carries the current name so both select the same preset outside that limit.
 * - G-F12: the fork's own export re-imports unchanged: no re-mint, no id minted flag.
 *
 * The booted tree gets the id pass and the slot migration the way `setDatabase` runs them; the hotkey merge itself needs the
 * real module this suite replaces, so the appended rows are asserted in presetMeta.test.ts. A pass says nothing about the Tauri or Node backends, a real browser's download, or an upstream build opening
 * the file: the upstream side is a transcription (see `upstreamPresetMirror.ts`).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { h } from 'src/ts/storage/tests/saveLoopMocks.svelte'
import { makeDb } from 'src/ts/storage/tests/saveLoopSupport'
import { createWorldKit, settled, sleepReal, type World } from 'src/ts/storage/tests/saveLoopWorld'
import { startStore2, store2Boot, type Store2Kit } from 'src/ts/storage/tests/store2SaveKit'
import { FakeLockManagerCore, FakeTabLockManagerView } from 'src/ts/storage/tests/fakeWebLocks'
import type { Store2Session } from 'src/ts/storage/store2/session'
import type { botPreset, Database } from 'src/ts/storage/database.svelte'
import type { Hotkey } from 'src/ts/defaulthotkeys'
import { presetIndexForSlot } from 'src/ts/storage/presetMeta'
import {
    UPSTREAM_DEFAULT_HOTKEYS, UPSTREAM_KNOWN_HOTKEY_ACTIONS, UPSTREAM_SAVED_PRESET_KEYS, upstreamChainTarget, upstreamChangeToPreset,
    setMirrorPresetApplier, upstreamCopyPreset, upstreamCtrlDigitTarget, upstreamDeletePreset, upstreamLoadoutTarget, upstreamMovePreset, upstreamReexport,
    upstreamSetDatabaseSubset,
} from 'src/ts/drive/tests/upstreamPresetMirror'

vi.setConfig({ testTimeout: 60_000 })

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

const worlds = createWorldKit({
    parked: h.parked,
    getDb: () => h.db,
    setDb: (db) => { h.db = db },
    nextId: () => ++h.worldCount,
})

const originalLocks = Object.getOwnPropertyDescriptor(window.navigator, 'locks')

// msgpackr 1.10.1 passes a length past the buffer's end to `Buffer.prototype.utf8Write` for a string of 64 or more
// characters, which the Node running the tests rejects; the browser build has no `Buffer`, so production is unaffected.
// Clamping the length to the room left changes no byte written.
interface Utf8Writer {
    utf8Write(this: Uint8Array, text: string, position: number, length: number): number
}
const utf8WriterProto = Buffer.prototype as unknown as Utf8Writer
const nativeUtf8Write = utf8WriterProto.utf8Write

beforeAll(() => {
    utf8WriterProto.utf8Write = function (text, position, length) {
        return nativeUtf8Write.call(this, text, position, Math.min(length, this.length - position))
    }
    class FakeChannel {
        onmessage: ((event: { data: unknown }) => void) | null = null
        constructor(public name: string) { h.channels.push(this) }
        postMessage(data: unknown) { h.broadcasts.push(data) }
        close() { }
    }
    Object.defineProperty(window, 'BroadcastChannel', { value: FakeChannel, configurable: true, writable: true })
    Object.defineProperty(globalThis, 'BroadcastChannel', { value: FakeChannel, configurable: true, writable: true })
})

afterAll(() => { utf8WriterProto.utf8Write = nativeUtf8Write })

beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    h.broadcasts.length = 0
    h.channels.length = 0
    vi.doUnmock('src/ts/storage/dbChangeEffects.svelte')
    vi.doMock('src/ts/stores.svelte', async () => {
        const { proxy } = await import('svelte/internal/client')
        const { writable } = await import('svelte/store')
        return {
            DBState: proxy({ db: {} as Record<string, unknown> }),
            selectedCharID: writable(-1),
            selIdState: { selId: -1 },
            alertStore: writable({ type: 'none', msg: '' }),
            MobileGUI: writable(false),
            botMakerMode: writable(false),
            loadedStore: writable(false),
            LoadingStatusState: { text: '' },
            ReloadGUIPointer: writable(0),
            bodyIntercepterStore: writable(null),
            savingStoppedReason: writable(''),
            frozenSaveKeysStore: writable([]),
            hotReloading: [] as string[],
        } as unknown as typeof import('src/ts/stores.svelte')
    })
    // `loadout.ts` (the fork's loadout resolver, read below) imports the persona switch, which this suite never calls.
    vi.doMock('src/ts/persona', () => ({ changeUserPersona: vi.fn() }))
    vi.doMock('src/ts/process/coldstorage.svelte', async () => ({
        getColdStorageItem: vi.fn(),
        getColdStorageBackupKey: (await import('src/ts/process/coldstorageData')).getColdStorageBackupKey,
        readColdStorageItem: async (key: string) => {
            const { getResidency, isEntityUnitKey } = await import('src/ts/storage/store2/residencyActive')
            const residency = getResidency()
            if (!isEntityUnitKey(key) || residency === null) {
                return { status: 'missing' }
            }
            const read = await residency.readCharacter(key)
            return read.status === 'error' ? { status: 'error', error: read.error, kind: read.kind } : { status: 'ok', value: read.value }
        },
        setColdStorageItem: vi.fn(async () => false),
        collectColdStorageBackupPayloads: vi.fn(async () => ({ payloads: [], missingKeys: [], invalidKeys: [] })),
        confirmIncompleteColdStorageOperation: vi.fn(async () => true),
        isColdStorageBackupData: vi.fn(() => false),
        listColdDataKeys: vi.fn(async () => []),
    }))
    vi.spyOn(console, 'log').mockImplementation(() => { })
    vi.spyOn(console, 'warn').mockImplementation(() => { })
    vi.spyOn(console, 'error').mockImplementation(() => { })
    vi.spyOn(console, 'debug').mockImplementation(() => { })
})

afterEach(() => {
    worlds.parkAll()
    vi.restoreAllMocks()
    if (originalLocks) {
        Object.defineProperty(window.navigator, 'locks', originalLocks)
    } else {
        Object.defineProperty(window.navigator, 'locks', { value: undefined, configurable: true })
    }
})

interface BinEntry { name: string, data: Uint8Array }

/** The `.bin` container: `[nameLength][name][dataLength][data]` per entry, lengths little-endian u32. */
function parseEntries(bytes: Uint8Array): BinEntry[] {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const entries: BinEntry[] = []
    let offset = 0
    while (offset + 4 <= bytes.length) {
        const nameLength = view.getUint32(offset, true)
        offset += 4
        const name = new TextDecoder().decode(bytes.subarray(offset, offset + nameLength))
        offset += nameLength
        const dataLength = view.getUint32(offset, true)
        offset += 4
        entries.push({ name, data: bytes.slice(offset, offset + dataLength) })
        offset += dataLength
    }
    return entries
}

function binEntry(name: string, data: Uint8Array): Uint8Array {
    const nameBytes = new TextEncoder().encode(name)
    const out = new Uint8Array(4 + nameBytes.length + 4 + data.length)
    const view = new DataView(out.buffer)
    view.setUint32(0, nameBytes.length, true)
    out.set(nameBytes, 4)
    view.setUint32(4 + nameBytes.length, data.length, true)
    out.set(data, 8 + nameBytes.length)
    return out
}

function concat(parts: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
    let offset = 0
    for (const part of parts) {
        out.set(part, offset)
        offset += part.length
    }
    return out
}

const SLOT_ROWS: Hotkey[] = Array.from({ length: 9 }, (_, n) => ({ key: String(n + 1), ctrl: true, action: `presetSlot${n + 1}` }))

/** Six presets P0..P5 with ids, folders F1/F2 and slots 1..5 on P0..P4, folders, the slot rows, a chain and two loadouts. */
function forkSeed(): Record<string, unknown> {
    const db = makeDb('base', ['alpha'])
    db.botPresets = [0, 1, 2, 3, 4, 5].map((n) => {
        const preset: Record<string, unknown> = { name: `P${n}`, temperature: n, id: `id-P${n}` }
        if (n < 5) preset.slot = n + 1
        if (n === 0 || n === 1) preset.folderId = 'F1'
        if (n >= 2 && n <= 4) preset.folderId = 'F2'
        return preset
    })
    db.botPresetsId = 1
    db.presetFolders = [{ id: 'F1', name: 'One' }, { id: 'F2', name: 'Two' }]
    db.hotkeys = [...structuredClone(UPSTREAM_DEFAULT_HOTKEYS), ...structuredClone(SLOT_ROWS)]
    db.presetChain = 'P1,P4'
    // L5 holds a stale name for the preset its id resolves to (a rename); L9 is upstream-made, with no id.
    db.loadouts = [
        { name: 'L1', presetName: 'P1', presetId: 'id-P1' },
        { name: 'L2', presetName: 'P2', presetId: 'id-P2' },
        { name: 'L4', presetName: 'P4', presetId: 'id-P4' },
        { name: 'L5', presetName: 'Old5', presetId: 'id-P5' },
        { name: 'L9', presetName: 'P3' },
    ]
    db.NAIsettings = {}
    db.temperature = 1
    return db
}

type Trip = {
    /** The fork export's database entry, decoded. */
    exported: Database
    /** The fork profile as the page held it when it exported. */
    source: Database
    /** The page's loadouts after the export ran. */
    pageLoadouts: Database['loadouts']
    /** The tree a fresh boot read, after the id pass and slot migration in `setDatabase`'s order; null when the trip stopped at the export. */
    booted: Database | null
    /** What `takePresetIdsMinted()` answered after the booted tree's `setDatabase`. */
    minted: boolean
}

/**
 * The fork profile exported by the real `SaveLocalBackup`. With `reimport`, the export's database entry is replaced by
 * `reimport(decoded)`'s bytes, imported by the real `LoadLocalBackup`, booted fresh and given to the id pass and slot migration in `setDatabase`'s order.
 */
async function trip(options: { reimport?: (db: Database) => Uint8Array | Promise<Uint8Array> } = {}): Promise<Trip> {
    const locks = new FakeLockManagerCore()
    Object.defineProperty(window.navigator, 'locks', { value: new FakeTabLockManagerView(locks, 'this'), configurable: true })
    h.db = forkSeed()
    const k: Store2Kit = await startStore2({ db: h.db as unknown as Database })
    const w: World = await worlds.startWorld({ kind: 'tauri', startLoop: false, boot: store2Boot(k) })
    const stores = await import('src/ts/stores.svelte')
    ;(stores.DBState as { db: unknown }).db = h.db
    h.db = (stores.DBState as { db: unknown }).db as Record<string, unknown>
    const bootActive = await import('src/ts/storage/store2/bootActive')
    bootActive.setStore2BootSession({ kind: 'tauri', backend: k.counted.backend, committer: k.committer } as unknown as Store2Session)
    w.pageMode.setPageStorageMode({ kind: 'store2' })
    const alertWithoutNotice = await import('src/ts/alert')
    vi.doMock('src/ts/alert', () => ({ ...alertWithoutNotice, waitUnreadNotice: async () => { } }))
    vi.mocked(alertWithoutNotice.alertConfirm).mockImplementation(async () => true)
    vi.spyOn(alertWithoutNotice.alertStore, 'set').mockImplementation(() => { })
    vi.spyOn(window.location, 'reload').mockImplementation(() => { })
    vi.spyOn(window.history, 'replaceState').mockImplementation(() => { })
    w.start()
    await sleepReal(150)
    await settled(w)

    const { LoadLocalBackup, SaveLocalBackup } = await import('src/ts/drive/backuplocal')
    const { decodeRisuSave } = await import('src/ts/storage/risuSave')
    const source = JSON.parse(JSON.stringify(h.db)) as Database

    const streamSaver = (await import('src/ts/vendor/streamSaver')).default
    const written: Uint8Array[] = []
    vi.spyOn(streamSaver, 'createWriteStream').mockImplementation((() => ({
        ready: Promise.resolve(),
        writable: { getWriter: () => ({ write: async (chunk: Uint8Array) => { written.push(chunk.slice()) }, close: async () => { } }) },
    })) as never)
    await SaveLocalBackup({ mode: 'inline' })
    const pageLoadouts = JSON.parse(JSON.stringify((h.db as unknown as Database).loadouts)) as Database['loadouts']
    const entries = parseEntries(concat(written))
    const database = entries.find((entry) => entry.name === 'database.risudat')
    if (database === undefined) {
        throw new Error('The export holds no database entry.')
    }
    const exported = await decodeRisuSave(database.data) as unknown as Database
    if (options.reimport === undefined) {
        return { exported, source, pageLoadouts, booted: null, minted: false }
    }

    // This suite replaces `database.svelte`, whose real module does not load here, so upstream's `setPreset` copy is the
    // one working field the rebuilt entries differ by.
    setMirrorPresetApplier((db, preset) => { db.temperature = preset.temperature ?? db.temperature })
    const edited = await options.reimport(structuredClone(exported))
    const bytes = concat(entries.map((entry) => binEntry(entry.name, entry.name === 'database.risudat' ? edited : entry.data)))
    const realCreateElement = document.createElement.bind(document)
    let input: HTMLInputElement | null = null
    const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        const element = realCreateElement(tag)
        if (tag === 'input') {
            input = element as HTMLInputElement
        }
        return element
    })
    LoadLocalBackup()
    const chosen = input as unknown as HTMLInputElement
    Object.defineProperty(chosen, 'files', { value: [new File([bytes as unknown as Uint8Array<ArrayBuffer>], 'backup.bin')], configurable: true })
    await (chosen.onchange as unknown as (event: Event) => Promise<void>).call(chosen, new Event('change'))
    createElementSpy.mockRestore()

    const { bootThroughDispatch } = await import('src/ts/storage/tests/store2SaveKit')
    const boot = await bootThroughDispatch(k.counted.backend)
    if (boot.result.kind !== 'store2') {
        throw new Error(`The boot answered ${boot.result.kind}.`)
    }
    const booted = boot.result.database as unknown as Database
    // `setDatabase` of the page makes the list, folders and ids as below (its own mint call is pinned by the real-module
    // test in botpreset.presetId.svelte.test.ts); this suite's module replacement cannot load the real one.
    const { assignPresetIds, migratePresetSlots, takePresetIdsMinted } = await import('src/ts/storage/presetMeta')
    takePresetIdsMinted()
    booted.presetFolders ??= []
    assignPresetIds(booted)
    // `setDatabase` runs the one-time slot migration after the id pass and before its hotkey merge; the real order is
    // pinned with the real module in presetMeta.test.ts.
    migratePresetSlots(booted)
    return { exported, source, pageLoadouts, booted, minted: takePresetIdsMinted() }
}

const META_KEYS = ['id', 'folderId', 'slot'] as const

function withoutMeta(preset: botPreset): Record<string, unknown> {
    const copy: Record<string, unknown> = { ...preset }
    for (const key of META_KEYS) delete copy[key]
    return copy
}

/** The first preset holding slot `n`, as the slot resolver reads it. */
function slotHolder(presets: botPreset[], n: number): number {
    return presetIndexForSlot(presets, n)
}

/** The meta values of a preset; an absent key and an undefined one compare equal under `toEqual`. */
const metaOf = (preset: botPreset) => ({ id: preset.id, folderId: preset.folderId, slot: preset.slot })

const byName = (db: Database, name: string): botPreset => db.botPresets.find((preset) => preset.name === name) as botPreset

const loadoutNamed = (db: Database, name: string): Database['loadouts'][number] => db.loadouts.find((loadout) => loadout.name === name) as Database['loadouts'][number]

async function starSourceIds(...ids: string[]): Promise<void> {
    const { serializeFavourites } = await import('src/ts/chatShell/toggleFavourites')
    localStorage.setItem('risuChatShell.toggleFavourites', serializeFavourites(ids.map((k) => ({ s: 'preset', k }))))
}

async function starredOn(db: Database): Promise<string[]> {
    const { readFavourites } = await import('src/ts/chatShell/toggleFavourites')
    const { isPresetFavourite } = await import('src/ts/setting/presetFavourites')
    const items = readFavourites().items
    return db.botPresets.filter((preset) => isPresetFavourite(items, preset.id)).map((preset) => preset.name as string)
}

describe('G-a an upstream-shaped load of the fork export keeps upstream\'s own preset data', () => {
    test('every upstream-visible fact of the export equals the source, and the new keys are present and ignored', async () => {
        const { exported, source, pageLoadouts } = await trip()
        const decoded = structuredClone(exported)

        // (1) the preset data other than meta, the meta values, and no stray extra keys
        expect(decoded.botPresets).toHaveLength(source.botPresets.length)
        decoded.botPresets.forEach((preset, index) => {
            expect(withoutMeta(preset)).toEqual(withoutMeta(source.botPresets[index]))
            for (const key of META_KEYS) {
                expect(preset[key]).toEqual(source.botPresets[index][key])
            }
            expect(Object.keys(preset).filter((key) => !(key in withoutMeta(source.botPresets[index])))).toEqual(
                Object.keys(preset).filter((key) => (META_KEYS as readonly string[]).includes(key)))
        })
        expect(source.botPresets.some((preset) => preset.id !== undefined && preset.slot !== undefined)).toBe(true)
        expect(decoded.presetFolders).toEqual(source.presetFolders)

        // (2) names in order, and the active index
        expect(decoded.botPresets.map((preset) => preset.name)).toEqual(source.botPresets.map((preset) => preset.name))
        expect(decoded.botPresetsId).toBe(source.botPresetsId)

        // (3) upstream's save-on-switch never reads meta
        expect(UPSTREAM_SAVED_PRESET_KEYS.filter((key) => (META_KEYS as readonly string[]).includes(key))).toEqual([])

        // (4) upstream's Ctrl+n dispatch is the same with and without the new rows, and the rows' actions are unknown to it
        upstreamSetDatabaseSubset(decoded)
        const withoutRows: Pick<Database, 'hotkeys' | 'botPresets'> = {
            hotkeys: decoded.hotkeys.filter((row) => !row.action.startsWith('presetSlot')),
            botPresets: decoded.botPresets,
        }
        for (let n = 1; n <= 9; n++) {
            const target = upstreamCtrlDigitTarget(decoded, n)
            expect(target).toEqual(upstreamCtrlDigitTarget(withoutRows, n))
            expect(target).toEqual(n <= decoded.botPresets.length ? { kind: 'preset', index: n - 1 } : { kind: 'none' })
        }
        expect(UPSTREAM_KNOWN_HOTKEY_ACTIONS.filter((action) => action.startsWith('presetSlot'))).toEqual([])
        expect(decoded.hotkeys.filter((row) => row.action.startsWith('presetSlot'))).toHaveLength(9)

        // (5) the chain
        expect(decoded.presetChain).toBe(source.presetChain)
        for (const name of decoded.presetChain.split(',')) {
            expect(upstreamChainTarget(decoded, name)).toBe(source.botPresets.findIndex((preset) => preset.name === name))
        }

        // (6) the loadouts
        // A loadout whose id resolves carries that preset's current name in the export, so upstream's name lookup and the
        // fork's id lookup on the page select the same preset; the page's own loadouts are not changed by the export.
        const { loadoutPresetIndex } = await import('src/ts/loadout')
        expect(pageLoadouts).toEqual(source.loadouts)
        expect(decoded.loadouts).toEqual(source.loadouts.map((loadout) => loadout.name === 'L5' ? { ...loadout, presetName: 'P5' } : loadout))
        decoded.loadouts.forEach((loadout, index) => {
            expect(upstreamLoadoutTarget(decoded, loadout)).toBe(loadoutPresetIndex(source.botPresets, source.loadouts[index]))
        })
        expect(upstreamLoadoutTarget(decoded, decoded.loadouts[3])).toBe(5)

        // (7) the hotkeys after upstream's merge are the decoded list followed only by defaults it lacked
        expect(decoded.hotkeys.slice(0, exported.hotkeys.length)).toEqual(exported.hotkeys)
        const had = new Set(exported.hotkeys.map((row) => row.action))
        expect(decoded.hotkeys.slice(exported.hotkeys.length).every((row) => !had.has(row.action))).toBe(true)
    })
})

describe('G-F12 the fork\'s own export re-imports unchanged', () => {
    test('every id, slot, folder id, folder and slot row comes back equal, and nothing is re-minted', async () => {
        const result = await trip({ reimport: (db) => upstreamReexport(db) })
        const booted = result.booted as Database
        expect(booted.botPresets.map((preset) => preset.id)).toEqual(result.source.botPresets.map((preset) => preset.id))
        for (const key of META_KEYS) {
            expect(booted.botPresets.map((preset) => preset[key])).toEqual(result.source.botPresets.map((preset) => preset[key]))
        }
        expect(booted.presetFolders).toEqual(result.source.presetFolders)
        expect(booted.hotkeys.filter((row) => row.action.startsWith('presetSlot'))).toEqual(SLOT_ROWS)
        expect(result.minted).toBe(false)
    })
})

describe('G-b a fork export that went through upstream re-imports without misalignment', () => {
    test('b1 upstream switched, copied, moved and deleted: rebuilt entries lost their meta, duplicate holders are re-minted, the rest is kept', async () => {
        await starSourceIds('id-P1', 'id-P4')
        const result = await trip({
            reimport: (db) => {
                upstreamChangeToPreset(db, 3)
                upstreamCopyPreset(db, 4)
                upstreamMovePreset(db, 6, 0)
                upstreamDeletePreset(db, db.botPresets.findIndex((preset) => preset.name === 'P2'))
                return upstreamReexport(db)
            },
        })
        const booted = result.booted as Database
        const source = result.source
        const ids = booted.botPresets.map((preset) => preset.id)
        expect(ids.every((id) => typeof id === 'string' && id !== '')).toBe(true)
        expect(new Set(ids).size).toBe(ids.length)

        for (const name of ['P0', 'P5']) {
            expect(metaOf(byName(booted, name))).toEqual(metaOf(byName(source, name)))
        }
        for (const name of ['P1', 'P3']) {
            expect(byName(booted, name).id).not.toBe(byName(source, name).id)
            expect(byName(booted, name).slot).toBeUndefined()
            expect(byName(booted, name).folderId).toBeUndefined()
        }
        const copy = byName(booted, 'P4 Copy')
        const original = byName(booted, 'P4')
        for (const holder of [copy, original]) {
            expect(holder.id).not.toBe('id-P4')
            expect(holder.slot).toBeUndefined()
            expect(holder.folderId).toBe('F2')
        }
        expect(booted.botPresets.some((preset) => preset.name === 'P2')).toBe(false)
        expect(booted.presetFolders).toEqual(source.presetFolders)
        expect(slotHolder(booted.botPresets, 1)).toBe(booted.botPresets.findIndex((preset) => preset.name === 'P0'))
        for (let n = 2; n <= 9; n++) expect(slotHolder(booted.botPresets, n)).toBe(-1)
        expect(await starredOn(booted)).toEqual([])
        expect(booted.hotkeys.filter((row) => row.action.startsWith('presetSlot'))).toEqual(SLOT_ROWS)
        expect(booted.botPresets[booted.botPresetsId].name).toBe('P4 Copy')
        expect(booted.presetChain).toBe(source.presetChain)
        expect(result.minted).toBe(true)

        // L1 targets a rebuilt entry and L4 an id both holders lost: each id dangles, so each applies by name, L4 to "P4"
        // and never to "P4 Copy"; the upstream-made L9 applies by name as before.
        const { loadoutPresetIndex } = await import('src/ts/loadout')
        const target = (name: string) => booted.botPresets[loadoutPresetIndex(booted.botPresets, loadoutNamed(booted, name))]?.name
        expect(target('L1')).toBe('P1')
        expect(target('L4')).toBe('P4')
        expect(target('L9')).toBe('P3')
    })

    test('b2 upstream rebuilt every entry: no slot or folder survives, every id is fresh, and no star lands anywhere', async () => {
        await starSourceIds('id-P0', 'id-P3')
        const result = await trip({
            reimport: (db) => {
                for (const to of [0, 2, 3, 4, 5, 0]) upstreamChangeToPreset(db, to)
                return upstreamReexport(db)
            },
        })
        const booted = result.booted as Database
        const sourceIds = new Set(result.source.botPresets.map((preset) => preset.id))
        expect(new Set(booted.botPresets.map((preset) => preset.id)).size).toBe(booted.botPresets.length)
        for (const preset of booted.botPresets) {
            expect(sourceIds.has(preset.id)).toBe(false)
            expect(preset.slot).toBeUndefined()
            expect(preset.folderId).toBeUndefined()
        }
        for (let n = 1; n <= 9; n++) expect(slotHolder(booted.botPresets, n)).toBe(-1)
        expect(booted.hotkeys.filter((row) => row.action.startsWith('presetSlot'))).toEqual(SLOT_ROWS)
        expect(await starredOn(booted)).toEqual([])
    })

    test('b4 (MC-2103) the copy of a preset that was not active is the sole holder of the original\'s id, slot and star; nothing else misaligns', async () => {
        await starSourceIds('id-P2', 'id-P4')
        const result = await trip({
            reimport: (db) => {
                upstreamCopyPreset(db, 4)
                upstreamChangeToPreset(db, 4)
                upstreamChangeToPreset(db, 0)
                return upstreamReexport(db)
            },
        })
        const booted = result.booted as Database
        const source = result.source
        expect(new Set(booted.botPresets.map((preset) => preset.id)).size).toBe(booted.botPresets.length)
        expect(byName(booted, 'P4 Copy')).toMatchObject({ id: 'id-P4', slot: 5, folderId: 'F2' })
        for (const name of ['P4', 'P1']) {
            expect(byName(booted, name).id).not.toBe(byName(source, name).id)
            expect(byName(booted, name).slot).toBeUndefined()
            expect(byName(booted, name).folderId).toBeUndefined()
        }
        for (const name of ['P0', 'P2', 'P3', 'P5']) {
            expect(metaOf(byName(booted, name))).toEqual(metaOf(byName(source, name)))
        }
        const names = (n: number) => booted.botPresets[slotHolder(booted.botPresets, n)]?.name
        expect([1, 2, 3, 4, 5, 6].map(names)).toEqual(['P0', undefined, 'P2', 'P3', 'P4 Copy', undefined])
        expect(await starredOn(booted)).toEqual(['P2', 'P4 Copy'])
        expect(booted.botPresets[booted.botPresetsId].name).toBe('P0')
        expect(booted.presetChain).toBe(source.presetChain)

        // The known limit (MC-2103): L4 follows the copy that holds its id on the fork, while upstream's name lookup finds
        // the original "P4". L2 and the upstream-made L9 select the same preset in both builds.
        const { loadoutPresetIndex } = await import('src/ts/loadout')
        const forkIndex = (name: string) => loadoutPresetIndex(booted.botPresets, loadoutNamed(booted, name))
        const upstreamIndex = (name: string) => upstreamLoadoutTarget(booted, loadoutNamed(booted, name))
        expect(forkIndex('L4')).toBe(6)
        expect(booted.botPresets[forkIndex('L4')].name).toBe('P4 Copy')
        expect(upstreamIndex('L4')).toBe(4)
        expect(booted.botPresets[upstreamIndex('L4')].name).toBe('P4')
        expect(forkIndex('L2')).toBe(2)
        expect(upstreamIndex('L2')).toBe(2)
        expect(forkIndex('L9')).toBe(upstreamIndex('L9'))
    })

    test('b0 (synthetic, not upstream-reachable) a file with no meta, no folders and no slot rows gets ids minted and the one-time migration by list order', async () => {
        const result = await trip({
            reimport: (db) => {
                db.botPresets = db.botPresets.map((preset): botPreset => ({ ...preset, id: undefined, folderId: undefined, slot: undefined }))
                delete db.presetFolders
                db.hotkeys = db.hotkeys.filter((row) => !row.action.startsWith('presetSlot'))
                return upstreamReexport(db)
            },
        })
        const booted = result.booted as Database
        expect(new Set(booted.botPresets.map((preset) => preset.id)).size).toBe(booted.botPresets.length)
        expect(booted.botPresets.every((preset) => typeof preset.id === 'string')).toBe(true)
        expect(booted.botPresets.every((preset) => preset.folderId === undefined)).toBe(true)
        expect(booted.botPresets.map((preset) => preset.slot)).toEqual([1, 2, 3, 4, 5, 6])
        expect(booted.presetFolders).toEqual([])
        expect(result.minted).toBe(true)
    })

    test('b3 (synthetic) slots without rows keep their ids and slots, and the migration does not run', async () => {
        const result = await trip({
            reimport: (db) => {
                db.hotkeys = db.hotkeys.filter((row) => !row.action.startsWith('presetSlot'))
                return upstreamReexport(db)
            },
        })
        const booted = result.booted as Database
        expect(booted.botPresets.map((preset) => preset.id)).toEqual(result.source.botPresets.map((preset) => preset.id))
        expect(booted.botPresets.map((preset) => preset.slot)).toEqual(result.source.botPresets.map((preset) => preset.slot))
        expect(result.minted).toBe(false)
    })
})
