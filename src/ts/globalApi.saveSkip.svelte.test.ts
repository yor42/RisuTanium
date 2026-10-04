/**
 * `saveDb()` writes the main file (`database/database.bin`) only when the bytes
 * it would write differ from what storage holds, and keeps the numbered backups
 * fresh across skipped writes, within a session and across sessions.
 *
 * This file drives the REAL, unmocked `saveDb()` loop, `RisuSaveEncoder`,
 * `appStore` and `mainFileRecord` against an in-memory byte store that can
 * refuse a write, land a write and then throw, and hold a write. Every test
 * starts a fresh module graph (a "world") so the loop's own state, the main-file
 * record and the outcome tracking begin empty. A world that a test is done with
 * is parked: its sleeps never resolve, so its loop stops; only a world closed
 * with `closeWorld` also hangs its store, as a closed tab does. The persisted
 * fingerprint format below is written out here on purpose, independent of the
 * code under test, so a change of the stored format fails these tests. A mocked
 * success here is not evidence of native backend behaviour.
 *
 * Title labels: (R) marks a test of the skip's own behaviour. It fails against
 * a loop that writes the main file on every iteration and keeps no backup
 * fingerprint; that failure shows the loop lacks the skip, not that it loses
 * or corrupts data. (G) marks a guard that passes with or without the skip.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { writable } from 'svelte/store'
import type { RisuSaveEncoder } from 'src/ts/storage/risuSave'
import type { ByteStore } from 'src/ts/storage/store/contract'

vi.setConfig({ testTimeout: 40_000 })

const h = vi.hoisted(() => ({
    worldCount: 0,
    parked: new Set<number>(),
    skew: 0,
    selectAnswer: '0',
    db: undefined as undefined | Record<string, unknown>,
    broadcasts: [] as unknown[],
    channels: [] as Array<{ onmessage: ((event: { data: unknown }) => void) | null }>,
}))

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => h.db),
    setDatabase: vi.fn(),
    presetTemplate: { name: 'test-preset' },
    defaultSdDataFunc: vi.fn(() => ({})),
    appVer: 'test',
    appSubVer: 'test',
    getCurrentCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Record<string, unknown> })
    return {
        DBState: state,
        selectedCharID: writable(-1),
        selIdState: { selId: -1 },
        alertStore: writable({ type: 'none', msg: '' }),
        MobileGUI: writable(false),
        botMakerMode: writable(false),
        loadedStore: writable(false),
        LoadingStatusState: { text: '' },
        ReloadGUIPointer: writable(0),
        bodyIntercepterStore: writable(null),
        savingStoppedReason: writable(null),
        frozenSaveKeysStore: writable([]),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/alert'), () => ({
    alertClear: vi.fn(),
    alertConfirm: vi.fn(async () => true),
    alertError: vi.fn(),
    alertWait: vi.fn(),
    alertMd: vi.fn(),
    alertNormal: vi.fn(),
    alertSelect: vi.fn(async () => h.selectAnswer),
    alertToast: vi.fn(),
    alertInput: vi.fn(),
    alertNormalWait: vi.fn(),
    alertAddCharacter: vi.fn(),
    alertStore: writable({ type: 'none', msg: '' }),
    waitAlert: vi.fn(async () => {}),
}))

vi.mock('@tauri-apps/api/core', () => ({
    convertFileSrc: vi.fn((p: string) => p),
    invoke: vi.fn(async () => undefined),
}))

vi.mock('@tauri-apps/api/path', () => ({
    appDataDir: vi.fn(async () => '/appdata'),
    join: vi.fn(async (...p: string[]) => p.join('/')),
    basename: vi.fn(async (p: string) => p.split('/').pop()),
}))

vi.mock('@tauri-apps/plugin-shell', () => ({
    open: vi.fn(async () => {}),
}))

vi.mock('streamsaver', () => ({
    default: {},
}))

vi.mock('@tauri-apps/api/webviewWindow', () => ({
    getCurrentWebviewWindow: vi.fn(() => ({
        listen: vi.fn(),
        setTitle: vi.fn(),
    })),
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    BaseDirectory: { AppData: 0, Download: 1 },
    writeFile: vi.fn(async () => {}),
    readFile: vi.fn(async () => new Uint8Array()),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(async () => {}),
    readDir: vi.fn(async () => []),
    remove: vi.fn(async () => {}),
}))

vi.mock('@tauri-apps/plugin-http', () => ({
    fetch: vi.fn(async () => new Response(null, { status: 404 })),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
    save: vi.fn(async () => null),
}))

vi.mock('@tauri-apps/api/event', () => ({
    listen: vi.fn(async () => vi.fn()),
}))

vi.mock(import('src/ts/update'), () => ({
    checkRisuUpdate: vi.fn(async () => {}),
}))

vi.mock(import('src/ts/plugins/plugins.svelte'), () => ({
    loadPlugins: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/plugins/plugins.svelte'))

vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    hasher: vi.fn((s: string) => s),
}) as unknown as typeof import('src/ts/parser/parser.svelte'))

vi.mock(import('src/ts/characterCards'), () => ({
    characterURLImport: vi.fn(),
    hubURL: 'https://example.invalid',
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock(import('src/ts/storage/dbChangeEffects.svelte'), () => ({
    registerDbChangeEffects: vi.fn(),
}) as unknown as typeof import('src/ts/storage/dbChangeEffects.svelte'))

vi.mock(import('src/ts/storage/autoStorage'), () => ({
    AutoStorage: class {
        async getItem(_key: string) { return null }
        async setItem(_key: string, _value: Uint8Array) {}
        async keys() { return [] as string[] }
        async removeItem(_key: string) {}
    },
}) as unknown as typeof import('src/ts/storage/autoStorage'))

vi.mock(import('src/ts/gui/animation'), () => ({
    updateAnimationSpeed: vi.fn(),
}) as unknown as typeof import('src/ts/gui/animation'))

vi.mock(import('src/ts/gui/colorscheme'), () => ({
    updateColorScheme: vi.fn(),
    updateTextThemeAndCSS: vi.fn(),
}) as unknown as typeof import('src/ts/gui/colorscheme'))

vi.mock(import('src/ts/observer.svelte'), () => ({
    startObserveDom: vi.fn(),
}) as unknown as typeof import('src/ts/observer.svelte'))

vi.mock(import('src/ts/gui/guisize'), () => ({
    updateGuisize: vi.fn(),
}) as unknown as typeof import('src/ts/gui/guisize'))

vi.mock(import('src/ts/characters'), () => ({
    updateLorebooks: vi.fn((v: unknown) => v),
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/hotkey'), () => ({
    initMobileGesture: vi.fn(),
}) as unknown as typeof import('src/ts/hotkey'))

vi.mock(import('src/ts/process/modules'), () => ({
    moduleUpdate: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/process/modules'))

vi.mock(import('src/ts/process/coldstorage.svelte'), () => ({
    getColdStorageItem: vi.fn(),
}) as unknown as typeof import('src/ts/process/coldstorage.svelte'))

//#region fixtures

const MAIN = 'database/database.bin'
const BACKUP_PREFIX = 'database/dbbackup-'
const FINGERPRINT_KEY = 'database/backupfingerprint'
const CHA_ID = 'skip-cha'
const SIX_MINUTES = 6 * 60 * 1000

type DbArg = Parameters<RisuSaveEncoder['init']>[0]

function makeDb(prompt: string): Record<string, unknown> {
    return {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        mainPrompt: prompt,
        characters: [{
            chaId: CHA_ID,
            name: 'Skip',
            type: 'character',
            chatPage: 0,
            chats: [{ id: 'skip-chat', message: [], note: '', name: '', localLore: [] }],
        }],
    }
}

/** The persisted backup fingerprint, written out independently of the code under test: the main-file record's per-4-MiB SHA-256 pieces, hashed once more. */
function expectedDigest(bytes: Uint8Array): string {
    const slice = 4 * 1024 * 1024
    const pieces: string[] = []
    for (let start = 0; start < bytes.length; start += slice) {
        pieces.push(createHash('sha256').update(bytes.subarray(start, Math.min(start + slice, bytes.length))).digest('hex'))
    }
    const joined = `${bytes.length}:${pieces.join(',')}`
    return `sha256:${bytes.length}:${createHash('sha256').update(joined, 'utf8').digest('hex')}`
}

const sleepReal = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

async function until(condition: () => boolean, what: string, timeoutMs = 8000): Promise<void> {
    const start = performance.now()
    while (!condition()) {
        if (performance.now() - start > timeoutMs) {
            throw new Error(`timed out waiting for ${what}`)
        }
        await sleepReal(10)
    }
}

const sameBytes = (a: Uint8Array | undefined, b: Uint8Array | undefined) =>
    !!a && !!b && a.length === b.length && a.every((value, i) => value === b[i])

interface StoreEvent {
    op: 'write' | 'delete'
    key: string
    bytes?: Uint8Array
    landed: boolean
}

interface World {
    id: number
    files: Map<string, Uint8Array>
    events: StoreEvent[]
    dead: boolean
    failMain: null | 'refuse'
    /** The next main-file write lands and then throws, once. */
    landThenThrowOnce: boolean
    failBackup: boolean
    /** The error every numbered-backup write throws while set. */
    backupError: Error | null
    /** The store reports conditional writes while it holds no version, so `writeMainFile` refuses before it sends anything. */
    refuseBeforeSend: boolean
    failFingerprint: boolean
    gate: null | ((key: string) => Promise<void>)
    api: typeof import('src/ts/globalApi.svelte')
    appStore: typeof import('src/ts/storage/store/appStore')
    record: typeof import('src/ts/storage/mainFileRecord')
    marks: typeof import('src/ts/storage/characterSaveMarks')
    bootState: typeof import('src/ts/process/memory/idleReloadBootState')
    risuSave: typeof import('src/ts/storage/risuSave')
}

function makeStore(w: World): ByteStore {
    const hang = () => new Promise<never>(() => {})
    return {
        get capabilities() {
            return { conditionalWrites: w.refuseBeforeSend }
        },
        async read(key) {
            if (w.dead) return hang()
            const value = w.files.get(key)
            return { bytes: value ? value.slice() : null, version: null }
        },
        async write(key, bytes) {
            if (w.dead) return hang()
            const event: StoreEvent = { op: 'write', key, bytes: bytes.slice(), landed: false }
            w.events.push(event)
            if (w.gate) {
                await w.gate(key)
            }
            if (key === MAIN && w.failMain === 'refuse') {
                throw new Error('simulated refusal')
            }
            if (key === MAIN && w.landThenThrowOnce) {
                w.landThenThrowOnce = false
                w.files.set(key, bytes.slice())
                event.landed = true
                throw new Error('simulated lost reply')
            }
            if (key.startsWith(BACKUP_PREFIX) && w.backupError) {
                throw w.backupError
            }
            if (key.startsWith(BACKUP_PREFIX) && w.failBackup) {
                throw new Error('simulated backup failure')
            }
            if (key === FINGERPRINT_KEY && w.failFingerprint) {
                throw new Error('simulated fingerprint failure')
            }
            w.files.set(key, bytes.slice())
            event.landed = true
            return { version: null }
        },
        async delete(key) {
            if (w.dead) return hang()
            w.events.push({ op: 'delete', key, landed: true })
            w.files.delete(key)
        },
        async deleteMany(entries) {
            for (const entry of entries) {
                await this.delete(entry.key, entry.condition)
            }
        },
        async list(prefix) {
            if (w.dead) return hang()
            return [...w.files.keys()].filter((key) => key.startsWith(prefix))
        },
        async has(key) {
            if (w.dead) return hang()
            return w.files.has(key)
        },
    }
}

const mainWrites = (w: World) => w.events.filter((e) => e.op === 'write' && e.key === MAIN && e.landed)
const mainAttempts = (w: World) => w.events.filter((e) => e.op === 'write' && e.key === MAIN)
const backupWrites = (w: World) => w.events.filter((e) => e.op === 'write' && e.key.startsWith(BACKUP_PREFIX) && e.landed)
const fingerprintWrites = (w: World) => w.events.filter((e) => e.op === 'write' && e.key === FINGERPRINT_KEY)
const textOf = (bytes: Uint8Array | undefined) => new TextDecoder().decode(bytes)

function emptyToSave() {
    return { character: [] as string[], chat: [] as [string, string][], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
}

async function encodeWith(risuSave: typeof import('src/ts/storage/risuSave'), db: Record<string, unknown>): Promise<Uint8Array> {
    const encoder = new risuSave.RisuSaveEncoder()
    await encoder.init(db as unknown as DbArg, { compression: false })
    await encoder.set(db as unknown as DbArg, emptyToSave())
    return new Uint8Array(encoder.encode()!)
}

const encodeDb = (w: World, db: Record<string, unknown>) => encodeWith(w.risuSave, db)

const realCrypto = globalThis.crypto

function stubCrypto(mode: 'secure' | 'insecure' | 'broken-digest') {
    if (mode === 'secure') {
        vi.stubGlobal('crypto', realCrypto)
        return
    }
    vi.stubGlobal('crypto', {
        getRandomValues: (array: Uint8Array) => realCrypto.getRandomValues(array),
        randomUUID: () => realCrypto.randomUUID(),
        subtle: mode === 'insecure' ? undefined : { digest: async () => { throw new Error('digest unavailable') } },
    })
}

interface StartOptions {
    /** The persisted files of an earlier session. */
    files?: Map<string, Uint8Array>
    secure?: 'secure' | 'insecure' | 'broken-digest'
    /** The main file to seed: the encoding of the current database, given bytes, or none. Ignored when `files` already holds one. */
    main?: 'db' | Uint8Array | null
    /** The persisted backup fingerprint to seed: the digest of the seeded main file, text, or none. */
    fingerprint?: 'main' | 'absent' | string
    passCommitted?: boolean
    /** Replaces the boot's read and record of the main file. */
    boot?: (w: World) => Promise<void>
}

let worlds: World[] = []

async function startWorld(options: StartOptions = {}): Promise<World> {
    stubCrypto(options.secure ?? 'secure')
    const id = ++h.worldCount
    // A mock registered per world, so that only this world's sleeps stop when it is parked.
    vi.doMock('src/ts/util', () => ({
        changeFullscreen: vi.fn(),
        checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
        sleep: vi.fn((ms: number) => h.parked.has(id)
            ? new Promise<void>(() => {})
            : new Promise<void>((resolve) => setTimeout(resolve, Math.min(ms, 5)))),
        sleepForever: vi.fn(() => new Promise<void>(() => {})),
    }))
    vi.resetModules()
    const stores = await import('src/ts/stores.svelte')
    stores.frozenSaveKeysStore.set([])
    stores.savingStoppedReason.set(null)
    const api = await import('src/ts/globalApi.svelte')
    const appStore = await import('src/ts/storage/store/appStore')
    const record = await import('src/ts/storage/mainFileRecord')
    const marks = await import('src/ts/storage/characterSaveMarks')
    const bootState = await import('src/ts/process/memory/idleReloadBootState')
    const risuSave = await import('src/ts/storage/risuSave')
    const w: World = {
        id,
        files: options.files ?? new Map(),
        events: [],
        dead: false,
        failMain: null,
        landThenThrowOnce: false,
        failBackup: false,
        backupError: null,
        refuseBeforeSend: false,
        failFingerprint: false,
        gate: null,
        api, appStore, record, marks, bootState, risuSave,
    }
    for (let id = 1; id < w.id; id++) {
        h.parked.add(id)
    }
    worlds.push(w)
    appStore.injectAppStore(makeStore(w))
    let mainBytes: Uint8Array | null = null
    if (!w.files.has(MAIN) && options.main !== null) {
        mainBytes = options.main instanceof Uint8Array ? options.main : await encodeDb(w, h.db!)
        w.files.set(MAIN, mainBytes.slice())
    } else {
        mainBytes = w.files.get(MAIN) ?? null
    }
    const fingerprint = options.fingerprint ?? 'absent'
    if (fingerprint === 'main' && mainBytes) {
        w.files.set(FINGERPRINT_KEY, new TextEncoder().encode(expectedDigest(mainBytes)))
    } else if (fingerprint !== 'absent' && fingerprint !== 'main') {
        w.files.set(FINGERPRINT_KEY, new TextEncoder().encode(fingerprint))
    }
    if (options.boot) {
        await options.boot(w)
    } else {
        const read = await appStore.readMainFile()
        if (read.bytes) {
            record.noteMainFileBytes(read.bytes)
        }
    }
    bootState.noteBootPassCommitted(options.passCommitted === true)
    void api.saveDb()
    await sleepReal(150)
    return w
}

/** Parks a world and hangs its store, as a closed tab. */
function closeWorld(w: World) {
    h.parked.add(w.id)
    w.dead = true
}

async function settled(w: World): Promise<void> {
    let stableSince = performance.now()
    let seen = w.events.length
    await until(() => {
        if (w.events.length !== seen) {
            seen = w.events.length
            stableSince = performance.now()
        }
        return w.api.isSaveClean() && performance.now() - stableSince > 120
    }, 'the save loop to go idle')
}

/** Runs `action` (a mark) and waits for the iteration it causes to commit, by write or by skip, and for the loop to go idle. */
async function nextCommit(w: World, action: () => void, waitForIdle = true): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('no save commit within 8 s')), 8000)
        w.api.afterNextSaveCommit(() => {
            clearTimeout(timer)
            resolve()
        })
        action()
    })
    if (waitForIdle) {
        await settled(w)
    }
}

const mark = (w: World) => () => w.marks.markCharacterForSave(CHA_ID)

/** Edits the prompt, requests a save and waits for it to commit. */
async function editAndCommit(w: World, prompt: string): Promise<void> {
    await nextCommit(w, () => {
        h.db!.mainPrompt = prompt
        w.marks.markCharacterForSave(CHA_ID)
    })
}

/** A save request that changes nothing. */
const noOpCommit = (w: World) => nextCommit(w, mark(w))

/** Counts the toasts whose text contains `text`, from the moment of the call. */
async function toastCounter(text: string): Promise<() => number> {
    const { alertToast } = await import('src/ts/alert')
    const count = () => vi.mocked(alertToast).mock.calls.filter(([message]) => String(message).includes(text)).length
    const base = count()
    return () => count() - base
}

/** Counts the error alerts, from the moment of the call. */
async function errorAlertCounter(): Promise<() => number> {
    const { alertError } = await import('src/ts/alert')
    const base = vi.mocked(alertError).mock.calls.length
    return () => vi.mocked(alertError).mock.calls.length - base
}

/** Dirties the tab and delivers a peer's save: the Save mine prompt is offered and "Save mine" is chosen. */
function saveMine(w: World) {
    h.selectAnswer = '0'
    w.marks.markCharacterForSave(CHA_ID)
    h.channels.at(-1)!.onmessage?.({ data: 'a peer tab' })
}

//#endregion

beforeAll(() => {
    class FakeChannel {
        onmessage: ((event: { data: unknown }) => void) | null = null
        constructor(public name: string) { h.channels.push(this) }
        postMessage(data: unknown) { h.broadcasts.push(data) }
        close() {}
    }
    Object.defineProperty(window, 'BroadcastChannel', { value: FakeChannel, configurable: true, writable: true })
    Object.defineProperty(globalThis, 'BroadcastChannel', { value: FakeChannel, configurable: true, writable: true })
})

beforeEach(() => {
    h.skew = 0
    h.selectAnswer = '0'
    h.broadcasts.length = 0
    h.channels.length = 0
    h.db = makeDb('base')
    const realNow = Date.now.bind(Date)
    vi.spyOn(Date, 'now').mockImplementation(() => realNow() + h.skew)
})

afterEach(() => {
    for (const w of worlds) {
        h.parked.add(w.id)
    }
    worlds = []
    vi.stubGlobal('crypto', realCrypto)
    vi.restoreAllMocks()
})

afterAll(() => {
    vi.stubGlobal('crypto', realCrypto)
})

describe('steady state: no main write when the bytes equal what this tab committed', () => {
    test('1 (R): an edit undone inside the debounce window writes no main file and the tab is clean', async () => {
        const w = await startWorld()
        await editAndCommit(w, 'one')
        const written = mainWrites(w).length
        const commits = vi.fn()
        w.api.afterNextSaveCommit(commits)
        h.db!.mainPrompt = 'two'
        w.marks.markCharacterForSave(CHA_ID)
        h.db!.mainPrompt = 'one'
        w.marks.markCharacterForSave(CHA_ID)
        await until(() => commits.mock.calls.length > 0, 'the iteration to commit')
        await settled(w)
        expect(mainWrites(w).length, 'main-file writes after the edit was undone').toBe(written)
        expect(w.api.isSaveClean()).toBe(true)
        expect(commits).toHaveBeenCalledTimes(1)
    })

    test('3 (R): a skipped iteration writes no main file and broadcasts nothing', async () => {
        const w = await startWorld()
        await editAndCommit(w, 'one')
        const written = mainWrites(w).length
        const broadcasts = h.broadcasts.length
        await noOpCommit(w)
        expect(mainWrites(w).length, 'main-file writes by a no-op iteration').toBe(written)
        expect(h.broadcasts.length, 'broadcasts by a no-op iteration').toBe(broadcasts)
    })

    test('3 (G): a skipped iteration leaves the tab clean and fires the commit callbacks once', async () => {
        const w = await startWorld()
        await editAndCommit(w, 'one')
        const callback = vi.fn()
        w.api.afterNextSaveCommit(callback)
        await noOpCommit(w)
        expect(w.api.isSaveClean()).toBe(true)
        expect(callback).toHaveBeenCalledTimes(1)
        await noOpCommit(w)
        expect(callback).toHaveBeenCalledTimes(1)
    })

    test('4 (G): turning a value on, committing, turning it off and committing writes both times', async () => {
        const w = await startWorld()
        await editAndCommit(w, 'on')
        const afterOn = mainWrites(w).length
        await editAndCommit(w, 'base')
        expect(mainWrites(w).length).toBe(afterOn + 1)
        expect(sameBytes(w.files.get(MAIN), await encodeDb(w, makeDb('base')))).toBe(true)
    })

    test('5 (G): a write that fails without landing is retried and the retry writes the edit', async () => {
        const w = await startWorld()
        await editAndCommit(w, 'one')
        w.failMain = 'refuse'
        h.db!.mainPrompt = 'two'
        w.marks.markCharacterForSave(CHA_ID)
        await until(() => mainAttempts(w).length >= 3, 'two failed attempts')
        w.failMain = null
        await until(() => w.api.isSaveClean(), 'the retry to commit')
        expect(sameBytes(w.files.get(MAIN), await encodeDb(w, makeDb('two')))).toBe(true)
    })

    test('10 (G): after another writer notes different bytes, an iteration equal to the old baseline writes', async () => {
        const w = await startWorld()
        await editAndCommit(w, 'one')
        const other = await encodeDb(w, makeDb('other writer'))
        await w.appStore.writeMainFile(other)
        w.record.noteMainFileBytes(other)
        w.files.set(MAIN, other.slice())
        const written = mainWrites(w).length
        await noOpCommit(w)
        expect(mainWrites(w).length).toBe(written + 1)
        expect(sameBytes(w.files.get(MAIN), await encodeDb(w, makeDb('one')))).toBe(true)
    })

    test('13 (G): a write that lands and then throws, followed by a return to the earlier bytes, writes them on the retry', async () => {
        const w = await startWorld()
        await editAndCommit(w, 'one')
        let release: () => void = () => {}
        const held = new Promise<void>((resolve) => { release = resolve })
        let entered: () => void = () => {}
        const reached = new Promise<void>((resolve) => { entered = resolve })
        w.landThenThrowOnce = true
        w.gate = async (key) => {
            if (key === MAIN) {
                entered()
                await held
            }
        }
        h.db!.mainPrompt = 'two'
        w.marks.markCharacterForSave(CHA_ID)
        await reached
        h.db!.mainPrompt = 'one'
        w.marks.markCharacterForSave(CHA_ID)
        w.gate = null
        release()
        await until(() => w.api.isSaveClean() && mainAttempts(w).length >= 2, 'the retry to commit')
        expect(sameBytes(w.files.get(MAIN), await encodeDb(w, makeDb('one')))).toBe(true)
    })

    test('14 (G): a restore write that lands and then throws makes a later no-op iteration write', async () => {
        const w = await startWorld()
        await editAndCommit(w, 'one')
        const restored = await encodeDb(w, makeDb('restored'))
        w.landThenThrowOnce = true
        await expect(w.appStore.writeMainFile(restored)).rejects.toThrow('simulated lost reply')
        expect(sameBytes(w.files.get(MAIN), restored)).toBe(true)
        await noOpCommit(w)
        expect(sameBytes(w.files.get(MAIN), await encodeDb(w, makeDb('one')))).toBe(true)
    })

    test('15 (R): a backup failure on a skipped iteration is post-commit: no retry and no second main attempt', async () => {
        const w = await startWorld()
        await editAndCommit(w, 'one')
        await editAndCommit(w, 'two')
        h.skew += SIX_MINUTES
        w.failBackup = true
        const attempts = mainAttempts(w).length
        await noOpCommit(w)
        await sleepReal(300)
        expect(mainAttempts(w).length, 'main-file attempts by the no-op iteration').toBe(attempts)
        expect(w.api.isSaveClean()).toBe(true)
    })

    test('16 (R: the pass writes nothing; G: the loop goes idle without spinning): a frozen-key resolution pass that equals the baseline', async () => {
        h.db!.characters = [
            ...(h.db!.characters as unknown[]),
            { chaId: CHA_ID, name: 'Duplicate', type: 'character', chatPage: 0, chats: [{ id: 'dup-chat', message: [], note: '', name: '', localLore: [] }] },
        ]
        const w = await startWorld()
        // A duplicated key keeps the tab from being clean, so only the commit is awaited.
        await nextCommit(w, () => {
            h.db!.mainPrompt = 'one'
            w.marks.markCharacterForSave(CHA_ID)
        }, false)
        const written = mainWrites(w).length
        h.db!.characters = (h.db!.characters as unknown[]).slice(0, 1)
        await until(() => w.api.isSaveClean(), 'the resolution pass to commit')
        await settled(w)
        const events = w.events.length
        await sleepReal(300)
        expect(mainWrites(w).length, 'main-file writes by the resolution pass').toBe(written)
        expect(w.events.length, 'store writes after the loop went idle').toBe(events)
        expect(w.api.isSaveClean()).toBe(true)
    })
})

describe('a skip decided without a secure context digest', () => {
    test('7 (G): without crypto.subtle an unchanged first iteration writes the main file and a numbered backup', async () => {
        const w = await startWorld({ secure: 'insecure' })
        await noOpCommit(w)
        expect(mainWrites(w).length).toBe(1)
        expect(backupWrites(w).length).toBe(1)
        expect(fingerprintWrites(w).length, 'fingerprint records in a context without crypto.subtle').toBe(0)
    })

    test('7 (G): without crypto.subtle a same-length change is written on the first iteration and in steady state', async () => {
        const w = await startWorld({ secure: 'insecure' })
        await editAndCommit(w, 'aaaa')
        expect(sameBytes(w.files.get(MAIN), await encodeDb(w, makeDb('aaaa')))).toBe(true)
        await editAndCommit(w, 'bbbb')
        expect(sameBytes(w.files.get(MAIN), await encodeDb(w, makeDb('bbbb')))).toBe(true)
    })

    test('17 (R): without crypto.subtle an edit undone inside the debounce window skips in steady state', async () => {
        const w = await startWorld({ secure: 'insecure' })
        await editAndCommit(w, 'one')
        const written = mainWrites(w).length
        const commits = vi.fn()
        w.api.afterNextSaveCommit(commits)
        h.db!.mainPrompt = 'two'
        w.marks.markCharacterForSave(CHA_ID)
        h.db!.mainPrompt = 'one'
        w.marks.markCharacterForSave(CHA_ID)
        await until(() => commits.mock.calls.length > 0, 'the iteration to commit')
        await settled(w)
        expect(mainWrites(w).length, 'main-file writes after the edit was undone').toBe(written)
    })

    test('24 (G): a main-file record whose digest fell back to the sampled hash is never trusted and writes no fingerprint record', async () => {
        const w = await startWorld({ secure: 'broken-digest', fingerprint: 'main' })
        await noOpCommit(w)
        expect(mainWrites(w).length, 'main-file writes by an iteration against a sampled record').toBe(1)
        expect(fingerprintWrites(w).length).toBe(0)
    })
})

describe('first iteration: the main-file record is the baseline', () => {
    test('2 (R): a boot whose first iteration encodes exactly the bytes read, with a fingerprint record naming them, writes no main file and no backup', async () => {
        const w = await startWorld({ fingerprint: 'main' })
        await noOpCommit(w)
        expect(mainWrites(w).length, 'main-file writes').toBe(0)
        expect(backupWrites(w).length, 'numbered backups').toBe(0)
        expect(h.broadcasts.length).toBe(0)
    })

    test('6 (G): a first iteration whose encoding differs from the bytes read writes', async () => {
        const w = await startWorld({ fingerprint: 'main' })
        await editAndCommit(w, 'changed')
        expect(sameBytes(w.files.get(MAIN), await encodeDb(w, makeDb('changed')))).toBe(true)
    })

    test('12 (R): after an encoder replacement an unchanged iteration skips in a secure context', async () => {
        const w = await startWorld({ fingerprint: 'main' })
        await editAndCommit(w, 'one')
        const written = mainWrites(w).length
        w.api.requiresFullEncoderReload.state = true
        await noOpCommit(w)
        expect(mainWrites(w).length, 'main-file writes after the encoder was replaced').toBe(written)
    })

    test('12 (G): after an encoder replacement an unchanged iteration writes in a non-secure context', async () => {
        const w = await startWorld({ secure: 'insecure' })
        await editAndCommit(w, 'one')
        const written = mainWrites(w).length
        w.api.requiresFullEncoderReload.state = true
        await noOpCommit(w)
        expect(mainWrites(w).length).toBe(written + 1)
    })

    test('18 (R): a first iteration skips against the record of the boot pass bytes, and with the pass committed and the interval due it backs up', async () => {
        const w = await startWorld({ fingerprint: 'main', passCommitted: true })
        await noOpCommit(w)
        expect(mainWrites(w).length, 'main-file writes').toBe(0)
        expect(backupWrites(w).length, 'numbered backups').toBe(1)
        expect(sameBytes(backupWrites(w)[0].bytes, w.files.get(MAIN))).toBe(true)
    })

    test('28 (R): a boot pass commit that lands and then throws makes the re-read bytes the newest note, and the first iteration compares against that note', async () => {
        const matching = async (record: 'reread' | 'older') => {
            const risuSave = await import('src/ts/storage/risuSave')
            const earlier = await encodeWith(risuSave, makeDb('before the pass'))
            const reread = await encodeWith(risuSave, h.db!)
            return await startWorld({
                main: earlier,
                fingerprint: record === 'reread' ? expectedDigest(reread) : expectedDigest(earlier),
                boot: async (world) => {
                    const first = await world.appStore.readMainFile()
                    world.record.noteMainFileBytes(first.bytes!)
                    world.landThenThrowOnce = true
                    await expect(world.appStore.writeMainFile(reread)).rejects.toThrow('simulated lost reply')
                    const again = await world.appStore.readMainFile()
                    world.record.noteMainFileBytes(again.bytes!)
                },
            })
        }
        const skipped = await matching('reread')
        const mainAfterBoot = mainAttempts(skipped).length
        await noOpCommit(skipped)
        expect(mainAttempts(skipped).length, 'main-file attempts when the record names the re-read bytes').toBe(mainAfterBoot)
        expect(backupWrites(skipped).length).toBe(0)
        closeWorld(skipped)

        const behind = await matching('older')
        const attemptsBehind = mainAttempts(behind).length
        await noOpCommit(behind)
        expect(mainAttempts(behind).length, 'main-file attempts when the record names older bytes').toBe(attemptsBehind)
        expect(backupWrites(behind).length).toBe(1)
        expect(sameBytes(backupWrites(behind)[0].bytes, behind.files.get(MAIN))).toBe(true)
    })
})

describe('Save mine', () => {
    test('8 (R): Save mine with equal bytes writes, and its retry after a failure still writes', async () => {
        const w = await startWorld()
        await editAndCommit(w, 'one')
        const written = mainWrites(w).length
        h.selectAnswer = '0'
        // Dirty and a peer save: the prompt is offered and "Save mine" is chosen.
        w.marks.markCharacterForSave(CHA_ID)
        h.channels.at(-1)!.onmessage?.({ data: 'a peer tab' })
        await until(() => mainWrites(w).length > written, 'Save mine to write equal bytes')
        await settled(w)
        expect(mainWrites(w).length).toBe(written + 1)

        // Again, with the write failing first: the retry still writes. A failed
        // attempt alone leaves the outcome unknown, which forces the retry to
        // write by itself; tests 30 to 32 isolate the force. The skew is past
        // the prompt's renotify interval.
        h.skew += SIX_MINUTES
        w.failMain = 'refuse'
        const attempts = mainAttempts(w).length
        w.marks.markCharacterForSave(CHA_ID)
        h.channels.at(-1)!.onmessage?.({ data: 'a peer tab' })
        await until(() => mainAttempts(w).length >= attempts + 2, 'a failed Save mine and its retry')
        w.failMain = null
        await until(() => mainWrites(w).length === written + 2, 'the retry to land')
        await settled(w)
        expect(mainWrites(w).length).toBe(written + 2)
    })

    test('30 (R): a Save mine whose write was refused before it was sent still writes the equal bytes on the retry', async () => {
        const w = await startWorld()
        await editAndCommit(w, 'one')
        const written = mainWrites(w).length
        const attempts = mainAttempts(w).length
        const retrying = await toastCounter('retrying')
        w.refuseBeforeSend = true
        saveMine(w)
        await until(() => retrying() >= 1, 'the refused Save mine write to be reported')
        expect(mainAttempts(w).length, 'main-file writes that reached the store while refused').toBe(attempts)
        w.refuseBeforeSend = false
        await until(() => mainWrites(w).length > written, 'the retry to write the equal bytes', 3000)
        await settled(w)
        expect(mainWrites(w).length).toBe(written + 1)
    })

    test('31 (R): a Save mine whose iteration failed before it reached a write still writes the equal bytes on the retry', async () => {
        const w = await startWorld()
        await editAndCommit(w, 'one')
        const written = mainWrites(w).length
        const encodeFailure = vi.spyOn(w.risuSave.RisuSaveEncoder.prototype, 'set').mockRejectedValueOnce(new Error('simulated encode failure'))
        saveMine(w)
        await until(() => mainWrites(w).length > written, 'the retry to write the equal bytes', 3000)
        await settled(w)
        expect(encodeFailure, 'the failing encode').toHaveBeenCalled()
        expect(mainWrites(w).length).toBe(written + 1)
    })

    test('32 (G): a Save mine that has no steady baseline writes the tab bytes in its own iteration, over a peer file the main-file record still matches', async () => {
        const w = await startWorld({ fingerprint: 'main' })
        const peer = await encodeDb(w, makeDb('peer'))
        w.files.set(MAIN, peer.slice())
        let mainAtCommit: Uint8Array | undefined
        w.api.afterNextSaveCommit(() => { mainAtCommit = w.files.get(MAIN)?.slice() })
        saveMine(w)
        await until(() => mainAtCommit !== undefined, 'the first commit')
        await settled(w)
        expect(sameBytes(mainAtCommit, await encodeDb(w, makeDb('base'))), 'main when the first commit was reported').toBe(true)
    })
})

describe('a skipped iteration ends a failure episode', () => {
    test('33 (R): after failed saves are undone by a skipped iteration, the next failing save starts a new episode and toasts that it is retrying', async () => {
        const w = await startWorld()
        await editAndCommit(w, 'one')
        const retrying = await toastCounter('retrying')
        const escalated = await errorAlertCounter()
        w.refuseBeforeSend = true
        h.db!.mainPrompt = 'two'
        w.marks.markCharacterForSave(CHA_ID)
        await until(() => escalated() >= 1, 'the failing save to escalate')
        expect(retrying()).toBe(1)
        h.db!.mainPrompt = 'one'
        await until(() => w.api.isSaveClean(), 'the skipped iteration to commit')
        await settled(w)
        h.db!.mainPrompt = 'three'
        w.marks.markCharacterForSave(CHA_ID)
        await until(() => retrying() >= 2, 'the next failing save to start a new episode', 3000)
    })

    test('34 (R): after a skipped iteration, a conflict reported by its backup is toasted again', async () => {
        const w = await startWorld()
        await editAndCommit(w, 'one')
        await editAndCommit(w, 'two')
        h.skew += SIX_MINUTES
        const { StoreVersionConflictError } = await import('src/ts/storage/store/errors')
        w.backupError = new StoreVersionConflictError(`${BACKUP_PREFIX}1.bin`, null)
        const conflicts = await toastCounter('background backup step')
        await noOpCommit(w)
        expect(conflicts(), 'conflict toasts after the first skipped iteration').toBe(1)
        await noOpCommit(w)
        expect(conflicts(), 'conflict toasts after the second skipped iteration').toBe(2)
    })
})

describe('backup freshness within a session', () => {
    test('9 (R): a no-op iteration after the interval writes one backup equal to the committed main file and no main write', async () => {
        const w = await startWorld()
        await editAndCommit(w, 'one')
        expect(backupWrites(w).length).toBe(1)
        await editAndCommit(w, 'two')
        expect(backupWrites(w).length, 'a commit inside the interval takes no backup').toBe(1)
        h.skew += SIX_MINUTES
        const written = mainWrites(w).length
        await noOpCommit(w)
        expect(mainWrites(w).length, 'main-file writes by the no-op iteration').toBe(written)
        expect(backupWrites(w).length).toBe(2)
        expect(sameBytes(backupWrites(w)[1].bytes, w.files.get(MAIN))).toBe(true)
    })

    test('9 (R, negative): with no commit since the last backup, a no-op iteration after the interval writes no backup', async () => {
        const w = await startWorld()
        await editAndCommit(w, 'one')
        expect(backupWrites(w).length).toBe(1)
        h.skew += SIX_MINUTES
        await noOpCommit(w)
        expect(backupWrites(w).length, 'numbered backups').toBe(1)
    })

    test('19 (R): a skipped iteration while another holder has the write lock writes no backup and no record until it is released', async () => {
        const w = await startWorld()
        await editAndCommit(w, 'one')
        await editAndCommit(w, 'two')
        h.skew += SIX_MINUTES
        const written = mainWrites(w).length
        const backups = backupWrites(w).length
        const records = fingerprintWrites(w).length
        const release = await w.api.dbWriteLock.acquire()
        w.marks.markCharacterForSave(CHA_ID)
        await sleepReal(900)
        expect(backupWrites(w).length).toBe(backups)
        expect(fingerprintWrites(w).length).toBe(records)
        release()
        await until(() => backupWrites(w).length > backups, 'the backup after the lock was released')
        await settled(w)
        expect(backupWrites(w).length).toBe(backups + 1)
        expect(fingerprintWrites(w).length).toBe(records + 1)
        expect(mainWrites(w).length, 'main-file writes by the no-op iteration').toBe(written)
    })

    test('29 (G): a steady skip that waited for the write lock writes the tab bytes when another writer wrote and threw meanwhile, and is not reported committed before that write', async () => {
        const w = await startWorld()
        await editAndCommit(w, 'one')
        await editAndCommit(w, 'two')
        h.skew += SIX_MINUTES
        const release = await w.api.dbWriteLock.acquire()
        let mainAtCommit: Uint8Array | undefined
        w.api.afterNextSaveCommit(() => { mainAtCommit = w.files.get(MAIN)?.slice() })
        w.marks.markCharacterForSave(CHA_ID)
        await sleepReal(900)
        const restored = await encodeDb(w, makeDb('restored'))
        w.landThenThrowOnce = true
        await expect(w.appStore.writeMainFile(restored)).rejects.toThrow('simulated lost reply')
        release()
        await until(() => w.api.isSaveClean(), 'the loop to go clean')
        await settled(w)
        const tab = await encodeDb(w, makeDb('two'))
        expect(sameBytes(mainAtCommit, tab), 'main when the commit was reported').toBe(true)
        expect(sameBytes(w.files.get(MAIN), tab), 'main at the end').toBe(true)
    })

    test('19 (G): after a landed load holds the write lock for good, nothing is written', async () => {
        const w = await startWorld()
        await editAndCommit(w, 'one')
        await editAndCommit(w, 'two')
        h.skew += SIX_MINUTES
        await w.api.dbWriteLock.acquire()
        const events = w.events.length
        w.marks.markCharacterForSave(CHA_ID)
        await sleepReal(900)
        expect(w.events.length).toBe(events)
    })
})

describe('backup freshness across sessions', () => {
    test.each([
        ['is absent', 'absent'],
        ['cannot be parsed', 'not a fingerprint \u0000\u0001'],
        ['names other bytes', 'sha256:5:' + '0'.repeat(64)],
    ])('20 (R): a boot that skips, with a fingerprint record that %s, writes one backup equal to main and then the record', async (_title, fingerprint) => {
        const w = await startWorld({ fingerprint })
        await noOpCommit(w)
        const main = w.files.get(MAIN)!
        expect(mainWrites(w).length, 'main-file writes').toBe(0)
        expect(backupWrites(w).length, 'numbered backups').toBe(1)
        expect(sameBytes(backupWrites(w)[0].bytes, main)).toBe(true)
        expect(fingerprintWrites(w).length).toBe(1)
        expect(textOf(fingerprintWrites(w)[0].bytes)).toBe(expectedDigest(main))
        const order = w.events.filter((e) => e.op === 'write').map((e) => (e.key.startsWith(BACKUP_PREFIX) ? 'backup' : e.key === FINGERPRINT_KEY ? 'record' : 'main'))
        expect(order).toEqual(['backup', 'record'])
    })

    test('21 (R): a session that commits inside the interval and closes before any backup leaves a record that makes the next boot back up', async () => {
        const first = await startWorld()
        await editAndCommit(first, 'one')
        await editAndCommit(first, 'two')
        expect(backupWrites(first).length).toBe(1)
        const files = first.files
        closeWorld(first)

        const second = await startWorld({ files })
        await noOpCommit(second)
        expect(mainWrites(second).length, 'main-file writes by the next boot').toBe(0)
        expect(backupWrites(second).length).toBe(1)
        expect(sameBytes(backupWrites(second)[0].bytes, files.get(MAIN))).toBe(true)
    })

    test('22 (R): a record write that fails after a successful backup is post-commit and the next boot backs up', async () => {
        const first = await startWorld({ fingerprint: 'absent' })
        first.failFingerprint = true
        await noOpCommit(first)
        await sleepReal(300)
        expect(backupWrites(first).length).toBe(1)
        expect(fingerprintWrites(first).length).toBeGreaterThanOrEqual(1)
        expect(first.files.has(FINGERPRINT_KEY)).toBe(false)
        expect(first.api.isSaveClean()).toBe(true)
        const files = first.files
        closeWorld(first)

        const second = await startWorld({ files })
        await noOpCommit(second)
        expect(backupWrites(second).length).toBe(1)
    })

    test('23 (R): a record naming other bytes makes the boot back up, a record naming main skips, and no record is written before its backup has returned', async () => {
        const peers = await startWorld({ fingerprint: 'sha256:7:' + 'a'.repeat(64) })
        await noOpCommit(peers)
        expect(backupWrites(peers).length).toBe(1)
        closeWorld(peers)

        const naming = await startWorld({ fingerprint: 'main' })
        await noOpCommit(naming)
        expect(backupWrites(naming).length).toBe(0)
        closeWorld(naming)

        const ordered = await startWorld({ fingerprint: 'absent' })
        let release: () => void = () => {}
        const held = new Promise<void>((resolve) => { release = resolve })
        let recordSeenWhileHeld = false
        ordered.gate = async (key) => {
            if (key.startsWith(BACKUP_PREFIX)) {
                await sleepReal(200)
                recordSeenWhileHeld = fingerprintWrites(ordered).length > 0
                await held
            }
        }
        const done = noOpCommit(ordered)
        await until(() => ordered.events.some((e) => e.key.startsWith(BACKUP_PREFIX)), 'the backup write to start')
        await sleepReal(400)
        expect(recordSeenWhileHeld).toBe(false)
        expect(fingerprintWrites(ordered).length, 'record writes while the backup write is pending').toBe(0)
        release()
        await done
        expect(fingerprintWrites(ordered).length).toBe(1)
    })

    test('27 (R): a session that wrote a backup and its record through the real code lets the next boot skip with no main write and no backup', async () => {
        const first = await startWorld()
        await editAndCommit(first, 'one')
        expect(backupWrites(first).length).toBe(1)
        expect(first.files.has(FINGERPRINT_KEY)).toBe(true)
        const files = first.files
        closeWorld(first)

        const second = await startWorld({ files })
        await noOpCommit(second)
        expect(mainWrites(second).length, 'main-file writes by the next boot').toBe(0)
        expect(backupWrites(second).length, 'numbered backups by the next boot').toBe(0)
    })
})

describe('writeMainFile adds no task boundary', () => {
    test('26 (G): no macrotask runs between a caller entering writeMainFile and the store write starting', async () => {
        const w = await startWorld({ main: null })
        let timerFired = false
        let firedAtWrite: boolean | null = null
        const store = makeStore(w)
        const inner = store.write.bind(store)
        w.appStore.injectAppStore({
            ...store,
            write: async (key, bytes, condition) => {
                firedAtWrite = timerFired
                return inner(key, bytes, condition)
            },
        })
        await w.appStore.getAppStore()
        setTimeout(() => { timerFired = true }, 0)
        await w.appStore.writeMainFile(new Uint8Array([1, 2, 3]))
        expect(firedAtWrite).toBe(false)
    })
})

describe('listings never see the fingerprint record', () => {
    test('25 (G): the numbered-backup listing and pruning leave the record alone and the key is outside every enumerated prefix', async () => {
        const w = await startWorld()
        w.files.set(FINGERPRINT_KEY, new TextEncoder().encode('sha256:1:' + '1'.repeat(64)))
        for (let i = 0; i < 22; i++) {
            w.files.set(`${BACKUP_PREFIX}${1000 + i}.bin`, new Uint8Array([i]))
        }
        const times = await w.api.getDbBackups()
        expect(times.length).toBe(20)
        expect(w.files.has(FINGERPRINT_KEY)).toBe(true)
        for (const prefix of [BACKUP_PREFIX, 'assets/', 'remotes/', 'coldstorage/']) {
            expect(FINGERPRINT_KEY.startsWith(prefix), prefix).toBe(false)
        }
    })
})
