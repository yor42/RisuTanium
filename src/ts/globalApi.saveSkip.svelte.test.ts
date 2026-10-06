/**
 * `saveDb()` commits into the block store only what differs from what the store
 * acknowledged, never writes the legacy main file (`database/database.bin`), and
 * keeps the numbered backups fresh across commits that write nothing, within a
 * session and across sessions.
 *
 * This file drives the REAL, unmocked `saveDb()` loop, `RisuSaveEncoder`, the
 * page's block-store owner and `appStore` against an in-memory byte store that
 * can refuse a write, land a write and then throw, and hold a write. Every test
 * starts a fresh module graph (a "world") so the loop's own state begins
 * empty. The persisted fingerprint format below is written out here on purpose,
 * independent of the code under test, so a change of the stored format fails
 * these tests. A mocked success here is not evidence of native backend behaviour.
 *
 * Title labels: (R) marks a reproducer: it fails against a loop that writes the
 * main file on every iteration and commits nothing into the block store. (G)
 * marks a guard that passes with or without the change.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { writable } from 'svelte/store'
import type { Database } from 'src/ts/storage/database.svelte'
import { makeOwner } from 'src/ts/storage/tests/blockStoreHarness'
import {
    BACKUP_PREFIX,
    FINGERPRINT_KEY,
    HEAD_KEY,
    backupWrites,
    fingerprintWrites,
    isBackupKey,
    isBlockKey,
    isRootKey,
    mainFileMutations,
    makeDb,
    rootWrites,
    sameBytes,
    textOf,
    writesTo,
} from 'src/ts/storage/tests/saveLoopSupport'
import { createWorldKit, nextCommit, settled, sleepReal, until, type World } from 'src/ts/storage/tests/saveLoopWorld'

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

vi.mock('src/ts/vendor/streamSaver', () => ({
    default: {
        useBlobFallback: false,
        createWriteStream: () => ({
            ready: Promise.resolve(),
            writable: {
                getWriter: () => ({
                    write: async () => { },
                    close: async () => { },
                }),
            },
        }),
    },
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

const kit = createWorldKit({
    parked: h.parked,
    getDb: () => h.db,
    setDb: (db) => { h.db = db },
    nextId: () => ++h.worldCount,
})
const { startWorld, parkAll, closeWorld, encodeMainFile } = kit

const CHA_ID = 'skip-cha'
const SIX_MINUTES = 6 * 60 * 1000

/** The persisted backup fingerprint, written out independently of the code under test: the SHA-256 pieces per 4 MiB, hashed once more. */
function expectedDigest(bytes: Uint8Array): string {
    const slice = 4 * 1024 * 1024
    const pieces: string[] = []
    for (let start = 0; start < bytes.length; start += slice) {
        pieces.push(createHash('sha256').update(bytes.subarray(start, Math.min(start + slice, bytes.length))).digest('hex'))
    }
    const joined = `${bytes.length}:${pieces.join(',')}`
    return `sha256:${bytes.length}:${createHash('sha256').update(joined, 'utf8').digest('hex')}`
}

/** What the page's encoder would write as a backup right now: a fresh encoding of the database. */
const snapshotOf = (w: World) => encodeMainFile(w, h.db!)

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

/** The prompt the store's committed state holds, decoded strictly the way boot reads it. */
async function storedPrompt(w: World): Promise<unknown> {
    const { validateLoadedBlocks } = await import('src/ts/storage/blockProfileValidate')
    const read = await w.owner.readCommitted({ validate: validateLoadedBlocks })
    if (read.kind !== 'loaded') {
        throw new Error(`the committed state did not read: ${read.kind}`)
    }
    return (read.tree as unknown as Record<string, unknown>).mainPrompt
}

/** Another page of the app commits a different prompt into the same generation: the stored sequence number moves. */
async function peerCommits(w: World, prompt: string): Promise<number> {
    const { treeToBlockSet } = await import('src/ts/storage/treeToBlockSet')
    const peer = makeOwner(w.store).owner
    const loaded = await peer.load()
    if (loaded.kind !== 'loaded') {
        throw new Error('the peer could not load')
    }
    const tree = structuredClone(h.db!) as unknown as Database
    ;(tree as unknown as Record<string, unknown>).mainPrompt = prompt
    const result = await peer.commitSave(await treeToBlockSet(tree))
    if (result.kind !== 'committed') {
        throw new Error(`the peer's commit did not happen: ${result.kind}`)
    }
    return result.seq
}

/** Delivers a peer's commit broadcast to the page. */
function broadcastFromPeer(seq: number | null) {
    h.channels.at(-1)!.onmessage?.({ data: seq === null ? 'a peer tab' : { sessionID: 'a peer tab', seq } })
}

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
    vi.clearAllMocks()
    h.skew = 0
    h.selectAnswer = '0'
    h.broadcasts.length = 0
    h.channels.length = 0
    h.db = makeDb('base')
    const realNow = Date.now.bind(Date)
    vi.spyOn(Date, 'now').mockImplementation(() => realNow() + h.skew)
})

afterEach(() => {
    parkAll()
    vi.restoreAllMocks()
})

afterAll(() => {
    vi.stubGlobal('crypto', kit.realCrypto)
})

describe('steady state: nothing is written when the blocks equal what this page committed', () => {
    test('1 (G): an edit undone inside the debounce window commits nothing and the tab is clean', async () => {
        const w = await startWorld()
        await editAndCommit(w, 'one')
        const commits = rootWrites(w.store).length
        const callbacks = vi.fn()
        w.api.afterNextSaveCommit(callbacks)
        h.db!.mainPrompt = 'two'
        w.marks.markCharacterForSave(CHA_ID)
        h.db!.mainPrompt = 'one'
        w.marks.markCharacterForSave(CHA_ID)
        await until(() => callbacks.mock.calls.length > 0, 'the iteration to commit')
        await settled(w)
        expect(rootWrites(w.store).length, 'commits after the edit was undone').toBe(commits)
        expect(w.api.isSaveClean()).toBe(true)
        expect(callbacks).toHaveBeenCalledTimes(1)
    })

    test('3 (G): an iteration that writes nothing commits nothing and broadcasts nothing', async () => {
        const w = await startWorld()
        await editAndCommit(w, 'one')
        const commits = rootWrites(w.store).length
        const broadcasts = h.broadcasts.length
        await noOpCommit(w)
        expect(rootWrites(w.store).length, 'commits by a no-op iteration').toBe(commits)
        expect(h.broadcasts.length, 'broadcasts by a no-op iteration').toBe(broadcasts)
    })

    test('3 (G): an iteration that writes nothing leaves the tab clean and fires the commit callbacks once', async () => {
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

    test('4 (R): turning a value on, committing, turning it off and committing writes both times', async () => {
        const w = await startWorld()
        await editAndCommit(w, 'on')
        const afterOn = rootWrites(w.store).length
        expect(await storedPrompt(w)).toBe('on')
        await editAndCommit(w, 'base')
        expect(rootWrites(w.store).length).toBe(afterOn + 1)
        expect(await storedPrompt(w)).toBe('base')
    })

    test('5 (R): a commit that fails without landing is retried and the retry commits the edit', async () => {
        const w = await startWorld()
        await editAndCommit(w, 'one')
        w.store.faults.push({ match: (op) => op.kind === 'write' && isRootKey(op.key), mode: 'before', times: 2 })
        h.db!.mainPrompt = 'two'
        w.marks.markCharacterForSave(CHA_ID)
        await until(() => w.store.ops.filter((op) => op.kind === 'write' && isRootKey(op.key)).length >= 2, 'two failed attempts')
        await until(() => w.api.isSaveClean(), 'the retry to commit')
        expect(await storedPrompt(w)).toBe('two')
    })

    test('13 (R): a root write that lands and then throws leaves the page asking about "Save mine", and that choice lands the newest state', async () => {
        const w = await startWorld()
        await editAndCommit(w, 'one')
        let release: () => void = () => {}
        const held = new Promise<void>((resolve) => { release = resolve })
        let entered: () => void = () => {}
        const reached = new Promise<void>((resolve) => { entered = resolve })
        w.store.faults.push({ match: (op) => op.kind === 'write' && isRootKey(op.key), mode: 'after', times: 1 })
        w.store.gate = async (key) => {
            if (isRootKey(key)) {
                entered()
                await held
            }
        }
        h.db!.mainPrompt = 'two'
        w.marks.markCharacterForSave(CHA_ID)
        await reached
        h.db!.mainPrompt = 'one'
        w.marks.markCharacterForSave(CHA_ID)
        w.store.gate = null
        release()
        // The root landed, so the stored sequence number moved past this page's: the next commit is refused.
        const { alertSelect } = await import('src/ts/alert')
        await until(() => vi.mocked(alertSelect).mock.calls.length > 0, 'the page to ask what to do')
        await until(() => w.api.isSaveClean(), 'the chosen save to commit')
        expect(await storedPrompt(w)).toBe('one')
    })

    test('14 (G): a restore that holds the write lock for good keeps a later iteration from writing anything', async () => {
        const w = await startWorld()
        await editAndCommit(w, 'one')
        await w.api.dbWriteLock.acquire()
        const events = w.store.ops.length
        h.db!.mainPrompt = 'two'
        w.marks.markCharacterForSave(CHA_ID)
        await sleepReal(900)
        expect(w.store.ops.length).toBe(events)
    })

    test('15 (G): a backup failure after a commit that wrote nothing is post-commit: no retry and no second commit attempt', async () => {
        const w = await startWorld()
        await editAndCommit(w, 'one')
        await editAndCommit(w, 'two')
        h.skew += SIX_MINUTES
        w.store.faults.push({ match: (op) => op.kind === 'write' && isBackupKey(op.key), mode: 'before', times: 5 })
        const attempts = rootWrites(w.store).length
        await noOpCommit(w)
        await sleepReal(300)
        expect(rootWrites(w.store).length, 'commit attempts by the no-op iteration').toBe(attempts)
        expect(w.api.isSaveClean()).toBe(true)
    })

    test('16 (G): a duplicate resolved without a save mark gets one pass that writes at most one commit, and then the loop idles without touching the store', async () => {
        h.db!.characters = [
            ...(h.db!.characters as unknown[]),
            { chaId: CHA_ID, name: 'Duplicate', type: 'character', chatPage: 0, chats: [{ id: 'dup-chat', message: [], note: '', name: '', localLore: [] }] },
        ]
        const w = await startWorld({ startLoop: true })
        // A duplicated key keeps the tab from being clean, so only the commit is awaited.
        await nextCommit(w, () => {
            h.db!.mainPrompt = 'one'
            w.marks.markCharacterForSave(CHA_ID)
        }, false)
        const commits = rootWrites(w.store).length
        h.db!.characters = (h.db!.characters as unknown[]).slice(0, 1)
        await until(() => w.api.isSaveClean(), 'the resolution pass to commit')
        await settled(w)
        const events = w.store.ops.length
        await sleepReal(300)
        expect(rootWrites(w.store).length, 'commits by the resolution pass').toBeLessThanOrEqual(commits + 1)
        expect(w.store.ops.length, 'store operations after the loop went idle').toBe(events)
        expect(w.api.isSaveClean()).toBe(true)
    })
})

describe('what a commit does not depend on', () => {
    test('7 (G): without crypto.subtle a first iteration that commits nothing takes a numbered backup and writes no fingerprint record', async () => {
        const w = await startWorld({ crypto: 'insecure' })
        await noOpCommit(w)
        expect(rootWrites(w.store).length).toBe(0)
        expect(backupWrites(w.store).length).toBe(1)
        expect(fingerprintWrites(w.store).length, 'fingerprint records in a context without crypto.subtle').toBe(0)
    })

    test('7 (R): without crypto.subtle a same-length change is committed on the first iteration and in steady state', async () => {
        const w = await startWorld({ crypto: 'insecure' })
        await editAndCommit(w, 'aaaa')
        expect(await storedPrompt(w)).toBe('aaaa')
        await editAndCommit(w, 'bbbb')
        expect(await storedPrompt(w)).toBe('bbbb')
    })

    test('17 (G): without crypto.subtle an edit undone inside the debounce window commits nothing', async () => {
        const w = await startWorld({ crypto: 'insecure' })
        await editAndCommit(w, 'one')
        const commits = rootWrites(w.store).length
        const callbacks = vi.fn()
        w.api.afterNextSaveCommit(callbacks)
        h.db!.mainPrompt = 'two'
        w.marks.markCharacterForSave(CHA_ID)
        h.db!.mainPrompt = 'one'
        w.marks.markCharacterForSave(CHA_ID)
        await until(() => callbacks.mock.calls.length > 0, 'the iteration to commit')
        await settled(w)
        expect(rootWrites(w.store).length, 'commits after the edit was undone').toBe(commits)
    })

    test('24 (G): a digest that fails is never trusted: the first iteration takes a backup and writes no fingerprint record', async () => {
        const w = await startWorld({ crypto: 'broken-digest' })
        await noOpCommit(w)
        expect(backupWrites(w.store).length).toBe(1)
        expect(fingerprintWrites(w.store).length).toBe(0)
    })
})

describe('first iteration: the stored fingerprint is the baseline for the backups', () => {
    test('2 (R): a boot whose first iteration snapshots exactly the state a fingerprint record names commits nothing and takes no backup', async () => {
        const w = await startWorld({ startLoop: false })
        w.store.plant(FINGERPRINT_KEY, new TextEncoder().encode(expectedDigest(await snapshotOf(w))))
        w.start()
        await sleepReal(150)
        await noOpCommit(w)
        expect(rootWrites(w.store).length, 'commits').toBe(0)
        expect(backupWrites(w.store).length, 'numbered backups').toBe(0)
        expect(h.broadcasts.length).toBe(0)
    })

    test('6 (R): a first iteration whose state differs from the stored state commits it', async () => {
        const w = await startWorld()
        await editAndCommit(w, 'changed')
        expect(await storedPrompt(w)).toBe('changed')
    })

    test('12 (R): after an encoder replacement an unchanged iteration commits nothing, with or without crypto.subtle', async () => {
        for (const crypto of ['secure', 'insecure'] as const) {
            const w = await startWorld({ crypto })
            await editAndCommit(w, 'one')
            const commits = rootWrites(w.store).length
            w.api.requiresFullEncoderReload.state = true
            await noOpCommit(w)
            expect(rootWrites(w.store).length, `commits after the encoder was replaced (${crypto})`).toBe(commits)
            expect(mainFileMutations(w.store)).toHaveLength(0)
        }
    })

    test('18 (G): a first iteration after a committed boot pass commits nothing and, with the interval due, backs up the state', async () => {
        const w = await startWorld({ passCommitted: true, startLoop: false })
        w.store.plant(FINGERPRINT_KEY, new TextEncoder().encode(expectedDigest(await snapshotOf(w))))
        w.start()
        await sleepReal(150)
        await noOpCommit(w)
        expect(rootWrites(w.store).length, 'commits').toBe(0)
        expect(backupWrites(w.store).length, 'numbered backups').toBe(1)
        const [backup] = backupWrites(w.store)
        expect(sameBytes(w.store.peek(backup.key), await snapshotOf(w))).toBe(true)
    })
})

describe('Save mine', () => {
    test('8 (R): Save mine writes this page\'s state over the peer\'s, and its retry after a failure is still Save mine', async () => {
        const w = await startWorld()
        await editAndCommit(w, 'one')
        const { alertSelect } = await import('src/ts/alert')
        const seq = await peerCommits(w, 'the peer')
        h.selectAnswer = '0'
        h.db!.mainPrompt = 'mine'
        w.marks.markCharacterForSave(CHA_ID)
        broadcastFromPeer(seq)
        await until(() => w.api.isSaveClean(), 'Save mine to commit')
        expect(vi.mocked(alertSelect).mock.calls[0][0].join('|')).toContain('Save my changes')
        expect(await storedPrompt(w)).toBe('mine')

        // Again, with the root write failing first: the retry is still Save mine.
        h.skew += SIX_MINUTES
        const peerSeq = await peerCommits(w, 'the peer again')
        w.store.faults.push({ match: (op) => op.kind === 'write' && isRootKey(op.key), mode: 'before', times: 1 })
        h.db!.mainPrompt = 'mine again'
        w.marks.markCharacterForSave(CHA_ID)
        broadcastFromPeer(peerSeq)
        await until(() => w.api.isSaveClean(), 'the retry to commit')
        expect(await storedPrompt(w)).toBe('mine again')
    })

    test('31 (R): a Save mine whose iteration failed before it reached the store is still Save mine on the retry', async () => {
        const w = await startWorld()
        await editAndCommit(w, 'one')
        const seq = await peerCommits(w, 'the peer')
        const encodeFailure = vi.spyOn(w.risuSave.RisuSaveEncoder.prototype, 'set').mockRejectedValueOnce(new Error('simulated encode failure'))
        h.selectAnswer = '0'
        h.db!.mainPrompt = 'mine'
        w.marks.markCharacterForSave(CHA_ID)
        broadcastFromPeer(seq)
        await until(() => w.api.isSaveClean(), 'the retry to commit')
        expect(encodeFailure, 'the failing encode').toHaveBeenCalled()
        expect(await storedPrompt(w)).toBe('mine')
    })

    test('32 (R): a Save mine built on a peer sequence number that has since moved is refused and asked about again, not forced', async () => {
        const w = await startWorld()
        await editAndCommit(w, 'one')
        const { alertSelect } = await import('src/ts/alert')
        const stale = await peerCommits(w, 'peer one')
        await peerCommits(w, 'peer two')
        h.selectAnswer = '0'
        // The second prompt stays unanswered until the stored state has been read, so the read
        // happens while the person has not chosen yet.
        let answerSecondPrompt: (answer: string) => void = () => {}
        const secondAnswer = new Promise<string>((resolve) => { answerSecondPrompt = resolve })
        vi.mocked(alertSelect).mockImplementationOnce(async () => '0')
        vi.mocked(alertSelect).mockImplementationOnce(() => secondAnswer)
        try {
            h.db!.mainPrompt = 'mine'
            w.marks.markCharacterForSave(CHA_ID)
            broadcastFromPeer(stale)
            await until(() => vi.mocked(alertSelect).mock.calls.length >= 2, 'the second prompt')
            expect(await storedPrompt(w), 'the peer\'s newest state is kept until the person chooses again').not.toBe('mine')
        } finally {
            answerSecondPrompt('0')
        }
        await until(() => w.api.isSaveClean(), 'the second Save mine to commit')
        expect(await storedPrompt(w)).toBe('mine')
    })
})

describe('a commit ends a failure episode', () => {
    test('33 (R): after failed saves are undone and the commit lands, the next failing save starts a new episode and toasts that it is retrying', async () => {
        const w = await startWorld()
        await editAndCommit(w, 'one')
        const retrying = await toastCounter('retrying')
        const escalated = await errorAlertCounter()
        const refusing = { match: (op: { kind: string, key: string }) => op.kind === 'write' && isRootKey(op.key), mode: 'before' as const, times: 1000 }
        w.store.faults.push(refusing)
        h.db!.mainPrompt = 'two'
        w.marks.markCharacterForSave(CHA_ID)
        await until(() => escalated() >= 1, 'the failing save to escalate')
        expect(retrying()).toBe(1)
        // The edit is undone and the store accepts writes again: the commit lands the acknowledged state again.
        refusing.times = 0
        h.db!.mainPrompt = 'one'
        w.marks.markCharacterForSave(CHA_ID)
        await until(() => w.api.isSaveClean(), 'the commit to land')
        await settled(w)
        expect(await storedPrompt(w)).toBe('one')
        refusing.times = 1000
        h.db!.mainPrompt = 'three'
        w.marks.markCharacterForSave(CHA_ID)
        await until(() => retrying() >= 2, 'the next failing save to start a new episode')
    })

    test('34 (G): after an iteration that wrote nothing, a conflict reported by its backup is toasted again', async () => {
        const w = await startWorld()
        await editAndCommit(w, 'one')
        await editAndCommit(w, 'two')
        h.skew += SIX_MINUTES
        w.store.faults.push({
            match: (op) => op.kind === 'write' && isBackupKey(op.key),
            mode: 'before',
            times: 1000,
            error: new w.errors.StoreVersionConflictError(`${BACKUP_PREFIX}1.bin`, null),
        })
        const conflicts = await toastCounter('background backup step')
        await noOpCommit(w)
        expect(conflicts(), 'conflict toasts after the first iteration').toBe(1)
        await noOpCommit(w)
        expect(conflicts(), 'conflict toasts after the second iteration').toBe(2)
    })
})

describe('backup freshness within a session', () => {
    test('9 (G): a no-op iteration after the interval writes one backup equal to the state and commits nothing', async () => {
        const w = await startWorld()
        await editAndCommit(w, 'one')
        expect(backupWrites(w.store).length).toBe(1)
        await editAndCommit(w, 'two')
        expect(backupWrites(w.store).length, 'a commit inside the interval takes no backup').toBe(1)
        h.skew += SIX_MINUTES
        const commits = rootWrites(w.store).length
        await noOpCommit(w)
        expect(rootWrites(w.store).length, 'commits by the no-op iteration').toBe(commits)
        expect(backupWrites(w.store).length).toBe(2)
        expect(sameBytes(w.store.peek(backupWrites(w.store)[1].key), await snapshotOf(w))).toBe(true)
    })

    test('9 (G, negative): with no commit since the last backup, a no-op iteration after the interval writes no backup', async () => {
        const w = await startWorld()
        await editAndCommit(w, 'one')
        expect(backupWrites(w.store).length).toBe(1)
        h.skew += SIX_MINUTES
        await noOpCommit(w)
        expect(backupWrites(w.store).length, 'numbered backups').toBe(1)
    })

    test('19 (G): an iteration that writes nothing while another holder has the write lock takes no backup and writes no record until it is released', async () => {
        const w = await startWorld()
        await editAndCommit(w, 'one')
        await editAndCommit(w, 'two')
        h.skew += SIX_MINUTES
        const commits = rootWrites(w.store).length
        const backups = backupWrites(w.store).length
        const records = fingerprintWrites(w.store).length
        const release = await w.api.dbWriteLock.acquire()
        w.marks.markCharacterForSave(CHA_ID)
        await sleepReal(900)
        expect(backupWrites(w.store).length).toBe(backups)
        expect(fingerprintWrites(w.store).length).toBe(records)
        release()
        await until(() => backupWrites(w.store).length > backups, 'the backup after the lock was released')
        await settled(w)
        expect(backupWrites(w.store).length).toBe(backups + 1)
        expect(fingerprintWrites(w.store).length).toBe(records + 1)
        expect(rootWrites(w.store).length, 'commits by the no-op iteration').toBe(commits)
    })

    test('29 (G): a whole-state replace that lands while an iteration waits for the write lock is never followed by that iteration\'s commit', async () => {
        const w = await startWorld()
        await editAndCommit(w, 'one')
        const { treeToBlockSet } = await import('src/ts/storage/treeToBlockSet')
        // The page's own restore: it holds the write lock, replaces the whole state and keeps the lock for good.
        await w.api.dbWriteLock.acquire()
        h.db!.mainPrompt = 'built on the old state'
        w.marks.markCharacterForSave(CHA_ID)
        await sleepReal(900)
        const restored = structuredClone(h.db!) as unknown as Database
        ;(restored as unknown as Record<string, unknown>).mainPrompt = 'restored'
        const result = await w.owner.replaceWholeState(await treeToBlockSet(restored))
        expect(result.kind).toBe('won')
        const events = w.store.ops.length
        await sleepReal(900)
        expect(w.store.ops.length, 'store operations after the replace').toBe(events)
        expect(await storedPrompt(w)).toBe('restored')
    })

    test('19 (G): after a landed load holds the write lock for good, nothing is written', async () => {
        const w = await startWorld()
        await editAndCommit(w, 'one')
        await editAndCommit(w, 'two')
        h.skew += SIX_MINUTES
        await w.api.dbWriteLock.acquire()
        const events = w.store.ops.length
        w.marks.markCharacterForSave(CHA_ID)
        await sleepReal(900)
        expect(w.store.ops.length).toBe(events)
    })
})

describe('backup freshness across sessions', () => {
    test.each([
        ['is absent', 'absent'],
        ['cannot be parsed', 'not a fingerprint \u0000\u0001'],
        ['names other bytes', 'sha256:5:' + '0'.repeat(64)],
    ])('20 (G): a boot that commits nothing, with a fingerprint record that %s, writes one backup equal to the state and then the record', async (_title, fingerprint) => {
        const w = await startWorld({ startLoop: false })
        if (fingerprint !== 'absent') {
            w.store.plant(FINGERPRINT_KEY, new TextEncoder().encode(fingerprint))
        }
        w.start()
        await sleepReal(150)
        await noOpCommit(w)
        const snapshot = await snapshotOf(w)
        expect(rootWrites(w.store).length, 'commits').toBe(0)
        expect(backupWrites(w.store).length, 'numbered backups').toBe(1)
        expect(sameBytes(w.store.peek(backupWrites(w.store)[0].key), snapshot)).toBe(true)
        expect(fingerprintWrites(w.store).length).toBe(1)
        expect(textOf(w.store.peek(FINGERPRINT_KEY))).toBe(expectedDigest(snapshot))
        const order = w.store.ops.filter((op) => op.kind === 'write' && (isBackupKey(op.key) || op.key === FINGERPRINT_KEY)).map((op) => (isBackupKey(op.key) ? 'backup' : 'record'))
        expect(order).toEqual(['backup', 'record'])
    })

    test('21 (G): a session that commits inside the interval and closes before any backup leaves a record that makes the next boot back up', async () => {
        const first = await startWorld()
        await editAndCommit(first, 'one')
        await editAndCommit(first, 'two')
        expect(backupWrites(first.store).length).toBe(1)
        const files = first.store.snapshotValues()
        closeWorld(first)

        const second = await startWorld({ files })
        await noOpCommit(second)
        expect(rootWrites(second.store).length, 'commits by the next boot').toBe(0)
        expect(backupWrites(second.store).length).toBe(1)
        expect(sameBytes(second.store.peek(backupWrites(second.store)[0].key), await snapshotOf(second))).toBe(true)
    })

    test('22 (G): a record write that fails after a successful backup is post-commit and the next boot backs up', async () => {
        const first = await startWorld({ startLoop: false })
        first.store.faults.push({ match: (op) => op.kind === 'write' && op.key === FINGERPRINT_KEY, mode: 'before', times: 1000 })
        first.start()
        await sleepReal(150)
        await noOpCommit(first)
        await sleepReal(300)
        expect(backupWrites(first.store).length).toBe(1)
        expect(fingerprintWrites(first.store).length).toBeGreaterThanOrEqual(1)
        expect(first.store.peek(FINGERPRINT_KEY)).toBeNull()
        expect(first.api.isSaveClean()).toBe(true)
        const files = first.store.snapshotValues()
        closeWorld(first)

        const second = await startWorld({ files })
        await noOpCommit(second)
        expect(backupWrites(second.store).length).toBe(1)
    })

    test('23 (R): a record naming other bytes makes the boot back up, a record naming the state skips, and no record is written before its backup has returned', async () => {
        const peers = await startWorld({ startLoop: false })
        peers.store.plant(FINGERPRINT_KEY, new TextEncoder().encode('sha256:7:' + 'a'.repeat(64)))
        peers.start()
        await sleepReal(150)
        await noOpCommit(peers)
        expect(backupWrites(peers.store).length).toBe(1)
        closeWorld(peers)

        const naming = await startWorld({ startLoop: false })
        naming.store.plant(FINGERPRINT_KEY, new TextEncoder().encode(expectedDigest(await snapshotOf(naming))))
        naming.start()
        await sleepReal(150)
        await noOpCommit(naming)
        expect(backupWrites(naming.store).length).toBe(0)
        closeWorld(naming)

        const ordered = await startWorld()
        let release: () => void = () => {}
        const held = new Promise<void>((resolve) => { release = resolve })
        let recordSeenWhileHeld = false
        let backupStarted = false
        ordered.store.gate = async (key) => {
            if (isBackupKey(key)) {
                backupStarted = true
                await sleepReal(200)
                recordSeenWhileHeld = fingerprintWrites(ordered.store).length > 0
                await held
            }
        }
        const done = noOpCommit(ordered)
        await until(() => backupStarted, 'the backup write to start')
        await sleepReal(400)
        expect(recordSeenWhileHeld).toBe(false)
        expect(fingerprintWrites(ordered.store).length, 'record writes while the backup write is pending').toBe(0)
        release()
        await done
        expect(fingerprintWrites(ordered.store).length).toBe(1)
    })

    test('27 (R): a session that wrote a backup and its record through the real code lets the next boot commit nothing and take no backup', async () => {
        const first = await startWorld()
        await editAndCommit(first, 'one')
        expect(backupWrites(first.store).length).toBe(1)
        expect(first.store.peek(FINGERPRINT_KEY)).not.toBeNull()
        const files = first.store.snapshotValues()
        closeWorld(first)

        const second = await startWorld({ files })
        await noOpCommit(second)
        expect(rootWrites(second.store).length, 'commits by the next boot').toBe(0)
        expect(backupWrites(second.store).length, 'numbered backups by the next boot').toBe(0)
    })
})

describe('the legacy main file is never written', () => {
    test('35 (R): editing, committing, taking a backup and idling mutate no key of the legacy main file', async () => {
        const w = await startWorld()
        await editAndCommit(w, 'one')
        h.skew += SIX_MINUTES
        await editAndCommit(w, 'two')
        await noOpCommit(w)
        expect(mainFileMutations(w.store)).toHaveLength(0)
        expect(writesTo(w.store, isBlockKey).length, 'block writes').toBeGreaterThan(0)
    })
})

describe('listings never see the fingerprint record', () => {
    test('25 (G): the numbered-backup listing and pruning leave the record alone and the key is outside every enumerated prefix', async () => {
        const w = await startWorld()
        w.store.plant(FINGERPRINT_KEY, new TextEncoder().encode('sha256:1:' + '1'.repeat(64)))
        for (let i = 0; i < 22; i++) {
            w.store.plant(`${BACKUP_PREFIX}${1000 + i}.bin`, new Uint8Array([i]))
        }
        const times = await w.api.getDbBackups()
        expect(times.length).toBe(20)
        expect(w.store.peek(FINGERPRINT_KEY)).not.toBeNull()
        for (const prefix of [BACKUP_PREFIX, 'assets/', 'remotes/', 'coldstorage/']) {
            expect(FINGERPRINT_KEY.startsWith(prefix), prefix).toBe(false)
        }
        expect(w.store.peek(HEAD_KEY)).not.toBeNull()
    })
})
