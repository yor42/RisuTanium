/**
 * `saveDb()` over a block profile: what a save commits, how the first save of a
 * profile that still is the legacy main file converts it, what the page does
 * with every result other than a landed commit, and what a page that only has
 * OPFS does.
 *
 * This file drives the REAL, unmocked `saveDb()` loop, `RisuSaveEncoder`, the
 * page's block-store owner and `appStore` against an in-memory byte store (see
 * `saveLoopWorld.ts`). A mocked success here is not evidence of native backend
 * behaviour.
 *
 * Title labels: (R) marks a reproducer: it fails against a loop that writes the
 * main file and commits nothing into the block store. (G) marks a guard that
 * passes with or without the change.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import { language } from 'src/lang'
import type { Database } from 'src/ts/storage/database.svelte'
import { characterBlockKey, rootKey } from 'src/ts/storage/blockKeys'
import { makeOwner } from 'src/ts/storage/tests/blockStoreHarness'
import {
    HEAD_KEY,
    MAIN_FILE_KEY,
    backupWrites,
    isBackupKey,
    isBlockKey,
    isPreBlocksKey,
    isRootKey,
    mainFileMutations,
    makeCharacter,
    makeDb,
    rootWrites,
    sameBytes,
    writesTo,
} from 'src/ts/storage/tests/saveLoopSupport'
import { createWorldKit, nextCommit, settled, sleepReal, until, type World } from 'src/ts/storage/tests/saveLoopWorld'

vi.setConfig({ testTimeout: 40_000 })

const h = vi.hoisted(() => ({
    worldCount: 0,
    parked: new Set<number>(),
    skew: 0,
    selectAnswer: '0',
    holdSelect: null as null | Promise<void>,
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
    alertSelect: vi.fn(async () => {
        if (h.holdSelect) {
            await h.holdSelect
        }
        return h.selectAnswer
    }),
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
const { startWorld, parkAll, closeWorld } = kit

const ALPHA = 'alpha-cha'
const BETA = 'beta-cha'
const SIX_MINUTES = 6 * 60 * 1000
const reload = vi.fn()

const mark = (w: World, chaId = ALPHA) => () => w.marks.markCharacterForSave(chaId)

/** Edits the prompt and waits for the save it asks for to commit. */
async function editAndCommit(w: World, prompt: string, chaId = ALPHA): Promise<void> {
    await nextCommit(w, () => {
        h.db!.mainPrompt = prompt
        w.marks.markCharacterForSave(chaId)
    })
}

async function storedPrompt(w: World): Promise<unknown> {
    const { validateLoadedBlocks } = await import('src/ts/storage/blockProfileValidate')
    const read = await w.owner.readCommitted({ validate: validateLoadedBlocks })
    if (read.kind !== 'loaded') {
        throw new Error(`the committed state did not read: ${read.kind}`)
    }
    return (read.tree as unknown as Record<string, unknown>).mainPrompt
}

/** Another page of the app commits a different prompt into the same generation. */
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

function broadcastFromPeer(seq: number | null) {
    h.channels.at(-1)!.onmessage?.({ data: seq === null ? 'a peer tab' : { sessionID: 'a peer tab', seq } })
}

async function selectCalls(): Promise<Array<{ options: string[], title: string }>> {
    const { alertSelect } = await import('src/ts/alert')
    return vi.mocked(alertSelect).mock.calls.map(([options, title]) => ({ options: options as string[], title: title as string }))
}

async function stoppedReason(): Promise<unknown> {
    const stores = await import('src/ts/stores.svelte')
    let value: unknown = null
    stores.savingStoppedReason.subscribe((current) => { value = current })()
    return value
}

const offersSaveMine = (call: { options: string[] }) => call.options.includes(language.otherTabSavedSaveMine)

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
    Object.defineProperty(window.location, 'reload', { value: reload, configurable: true, writable: true })
})

beforeEach(() => {
    vi.clearAllMocks()
    h.skew = 0
    h.selectAnswer = '0'
    h.holdSelect = null
    h.broadcasts.length = 0
    h.channels.length = 0
    reload.mockClear()
    h.db = makeDb('base', [ALPHA, BETA])
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

describe('a block page commits what changed and never writes the main file', () => {
    test('C1 (R): editing one character commits that character\'s key and the root, nothing else, and mutates no key of the main file', async () => {
        const w = await startWorld()
        const generation = w.owner.committedState()!.generation
        const alpha = h.db!.characters as Array<Record<string, unknown>>
        await nextCommit(w, () => {
            alpha[0].name = 'renamed'
            w.marks.markCharacterForSave(ALPHA)
        })
        const written = writesTo(w.store, isBlockKey).map((op) => op.key)
        expect(written).toEqual([characterBlockKey(generation, ALPHA), rootKey(generation)])
        expect(mainFileMutations(w.store)).toHaveLength(0)
        expect(h.broadcasts.at(-1)).toEqual({ sessionID: expect.any(String), seq: 1 })
    })

    test('C1 (R): a commit that writes nothing sends no broadcast and a commit that wrote one carries the committed sequence number', async () => {
        const w = await startWorld()
        await editAndCommit(w, 'one')
        const sent = h.broadcasts.length
        await nextCommit(w, mark(w))
        expect(h.broadcasts.length).toBe(sent)
        await editAndCommit(w, 'two')
        expect(h.broadcasts.at(-1)).toEqual({ sessionID: expect.any(String), seq: 2 })
    })

    test('C13 (R): an edit made and undone inside the debounce window commits nothing, and made and undone across two commits commits twice', async () => {
        const w = await startWorld()
        await editAndCommit(w, 'one')
        const commits = rootWrites(w.store).length
        const callbacks = vi.fn()
        w.api.afterNextSaveCommit(callbacks)
        h.db!.mainPrompt = 'two'
        w.marks.markCharacterForSave(ALPHA)
        h.db!.mainPrompt = 'one'
        w.marks.markCharacterForSave(ALPHA)
        await until(() => callbacks.mock.calls.length > 0, 'the iteration to commit')
        await settled(w)
        expect(rootWrites(w.store).length).toBe(commits)
        await editAndCommit(w, 'two')
        await editAndCommit(w, 'one')
        expect(rootWrites(w.store).length).toBe(commits + 2)
        expect(await storedPrompt(w)).toBe('one')
    })

    test('C9 (R): a character archived while the encoder was working is left out of the commit that built the layout and is committed by the next one', async () => {
        const w = await startWorld()
        const archived = makeCharacter('archived-cha', { coldstorage: 'cold-unit' })
        const original = w.risuSave.RisuSaveEncoder.prototype.set
        let appended = false
        vi.spyOn(w.risuSave.RisuSaveEncoder.prototype, 'set').mockImplementation(async function (this: InstanceType<typeof w.risuSave.RisuSaveEncoder>, db, toSave) {
            await original.call(this, db, toSave)
            if (!appended) {
                appended = true
                ;(db.characters as unknown[]).push(archived)
            }
        })
        const { alertError, alertToast } = await import('src/ts/alert')
        await editAndCommit(w, 'one')
        expect(appended).toBe(true)
        expect(vi.mocked(alertError)).not.toHaveBeenCalled()
        expect(vi.mocked(alertToast)).not.toHaveBeenCalled()
        let committed = w.owner.committedState()!
        expect(committed.directory).not.toContain('archived-cha')

        await editAndCommit(w, 'two', 'archived-cha')
        committed = w.owner.committedState()!
        expect(committed.directory).toContain('archived-cha')
        expect(committed.packed).toContain('archived-cha')
        expect(vi.mocked(alertError)).not.toHaveBeenCalled()
    })
})

describe('a legacy page converts on its first committing save', () => {
    test('C2 (R): the first committing save converts, the head names the main file it came from and when, the old main file is moved aside, and the next save is a plain commit', async () => {
        const w = await startWorld({ legacy: true })
        const { fingerprintMainFile } = await import('src/ts/storage/mainFileFingerprint')
        const oldMain = w.store.peek(MAIN_FILE_KEY)!
        expect(w.owner.isLive()).toBe(false)
        const before = Date.now()
        await editAndCommit(w, 'one')
        expect(w.pageMode.getPageStorageMode().kind).toBe('block')
        expect(w.owner.isLive()).toBe(true)
        const state = w.owner.committedState()!
        expect(state.convertedFrom).toBe(fingerprintMainFile(oldMain))
        expect(state.convertedAt).toBeGreaterThanOrEqual(before)
        expect(w.store.peek(MAIN_FILE_KEY)).toBeNull()
        const moved = w.store.keys('database/').filter(isPreBlocksKey)
        expect(moved).toHaveLength(1)
        expect(sameBytes(w.store.peek(moved[0]), oldMain)).toBe(true)
        expect(await storedPrompt(w)).toBe('one')

        const heads = writesTo(w.store, (key) => key === HEAD_KEY).length
        await editAndCommit(w, 'two')
        expect(writesTo(w.store, (key) => key === HEAD_KEY).length, 'head writes by the plain commit').toBe(heads)
        expect(w.owner.committedState()!.generation).toBe(state.generation)
        expect(await storedPrompt(w)).toBe('two')
        // The conversion's own move of the main file is the only thing that touches it.
        expect(mainFileMutations(w.store).every((op) => op.kind === 'delete')).toBe(true)
    })

    test('C2 (R): a conversion that wins is followed by a numbered backup of the converted state and a broadcast', async () => {
        const w = await startWorld({ legacy: true })
        await editAndCommit(w, 'one')
        expect(backupWrites(w.store).length).toBe(1)
        expect(h.broadcasts.at(-1)).toEqual({ sessionID: expect.any(String), seq: 0 })
    })

    test('C3 (R): a second page that finds the profile converted gets reload-or-stay, never Save mine, and stops trying to convert', async () => {
        const w = await startWorld({ legacy: true, startLoop: false })
        const { treeToBlockSet } = await import('src/ts/storage/treeToBlockSet')
        const converted = await makeOwner(w.store).owner.replaceWholeState(await treeToBlockSet(structuredClone(h.db!) as unknown as Database), { requireAbsentHead: true })
        expect(converted.kind).toBe('won')
        const replace = vi.spyOn(w.owner, 'replaceWholeState')
        h.selectAnswer = '1'
        w.start()
        await sleepReal(150)
        h.db!.mainPrompt = 'mine'
        w.marks.markCharacterForSave(ALPHA)
        await until(async () => (await stoppedReason()) === 'replaced', 'the page to stop saving')
        const calls = await selectCalls()
        expect(calls).toHaveLength(1)
        expect(offersSaveMine(calls[0])).toBe(false)
        expect(calls[0].options).toEqual([language.otherTabSavedConflictReload, language.otherTabSavedConflictStay])
        expect(calls[0].title).toBe(language.otherTabSavedReloadTitle)
        expect(replace).toHaveBeenCalledTimes(1)

        const ops = w.store.ops.length
        w.marks.markCharacterForSave(ALPHA)
        await sleepReal(1200)
        expect(replace, 'conversion attempts after the page stopped').toHaveBeenCalledTimes(1)
        expect(w.store.ops.length, 'store operations after the page stopped').toBe(ops)
        expect(reload).not.toHaveBeenCalled()
    })

    test('C3 (R): choosing to reload reloads the page and does not park it', async () => {
        const w = await startWorld({ legacy: true, startLoop: false })
        const { treeToBlockSet } = await import('src/ts/storage/treeToBlockSet')
        await makeOwner(w.store).owner.replaceWholeState(await treeToBlockSet(structuredClone(h.db!) as unknown as Database), { requireAbsentHead: true })
        h.selectAnswer = '0'
        w.start()
        await sleepReal(150)
        w.marks.markCharacterForSave(ALPHA)
        await until(() => reload.mock.calls.length > 0, 'the page to reload')
        expect(await stoppedReason()).toBeNull()
    })

    test('C3 (R): a page that has not converted yet and hears a peer\'s conversion broadcast is offered reload-or-stay only, and does not retry', async () => {
        const w = await startWorld({ legacy: true })
        const replace = vi.spyOn(w.owner, 'replaceWholeState')
        h.selectAnswer = '1'
        h.db!.mainPrompt = 'unsaved'
        w.marks.markCharacterForSave(ALPHA)
        broadcastFromPeer(0)
        await until(async () => (await stoppedReason()) === 'stay', 'the page to stop saving')
        const calls = await selectCalls()
        expect(offersSaveMine(calls[0])).toBe(false)
        expect(calls[0].options).toEqual([language.otherTabSavedConflictReload, language.otherTabSavedConflictStay])
        await sleepReal(900)
        expect(replace, 'conversion attempts').not.toHaveBeenCalled()
    })

    test('C4 (R): a conversion whose root never reads back is tried three times, leaves no generation behind, and then parks with the named stop and an error', async () => {
        const w = await startWorld({ legacy: true })
        w.store.hideReads = isRootKey
        const { alertError } = await import('src/ts/alert')
        h.db!.mainPrompt = 'unsaved'
        w.marks.markCharacterForSave(ALPHA)
        await until(async () => (await stoppedReason()) === 'conversion-failed', 'the page to park')
        const generations = new Set(writesTo(w.store, isRootKey).map((op) => op.key))
        expect(generations.size, 'generations written').toBe(3)
        expect(w.store.keys('blocks/'), 'keys left behind').toEqual([])
        expect(w.store.peek(MAIN_FILE_KEY)).not.toBeNull()
        expect(vi.mocked(alertError)).toHaveBeenCalledWith(language.saveConversionFailedAlert)
        expect(w.api.isSaveClean()).toBe(false)
        const ops = w.store.ops.length
        w.marks.markCharacterForSave(ALPHA)
        await sleepReal(1200)
        expect(w.store.ops.length, 'store operations after the park').toBe(ops)
    })

    test('C4 (R): a conversion whose switch cannot be confirmed tells the person to reload, parks the loop, and leaves the write lock closed for good', async () => {
        const w = await startWorld({ legacy: true })
        const { alertError } = await import('src/ts/alert')
        w.store.faults.push({ match: (op) => op.kind === 'write' && op.key === HEAD_KEY, mode: 'before', times: 1000 })
        h.db!.mainPrompt = 'unsaved'
        w.marks.markCharacterForSave(ALPHA)
        await until(async () => (await stoppedReason()) === 'unconfirmed', 'the page to park')
        expect(vi.mocked(alertError)).toHaveBeenCalledWith(language.saveDamagedUnconfirmed)
        expect(w.owner.isClosed()).toBe(true)
        const acquired = await Promise.race([w.api.dbWriteLock.acquire().then(() => 'acquired'), sleepReal(300).then(() => 'still closed')])
        expect(acquired).toBe('still closed')
        expect(w.api.isSaveClean()).toBe(false)
    })

    test('C4 (R): a conversion whose root reads back on the second try writes two generations and leaves one', async () => {
        const w = await startWorld({ legacy: true })
        let hidden = 1
        w.store.hideReads = (key) => isRootKey(key) && hidden-- > 0
        await editAndCommit(w, 'one')
        expect(w.pageMode.getPageStorageMode().kind).toBe('block')
        const roots = w.store.keys('blocks/').filter(isRootKey)
        expect(roots).toHaveLength(1)
        expect(await storedPrompt(w)).toBe('one')
    })
})

describe('a result that is not a landed commit', () => {
    test('C6 (R): a commit refused because a peer committed offers Save mine from the refused sequence number, and Save mine keeps it until a save lands', async () => {
        const w = await startWorld()
        await editAndCommit(w, 'one')
        await peerCommits(w, 'the peer')
        // A first Save mine fails; the retry is still Save mine, from the same sequence number.
        w.store.faults.push({ match: (op) => op.kind === 'write' && isRootKey(op.key), mode: 'before', times: 1 })
        h.selectAnswer = '0'
        h.db!.mainPrompt = 'mine'
        w.marks.markCharacterForSave(ALPHA)
        await until(() => w.api.isSaveClean(), 'Save mine to land')
        const calls = await selectCalls()
        expect(calls).toHaveLength(1)
        expect(offersSaveMine(calls[0])).toBe(true)
        expect(await storedPrompt(w)).toBe('mine')
    })

    test('C6 (R): a commit refused because the head moved offers reload-or-stay only, and staying parks the page with its own stop', async () => {
        const w = await startWorld()
        await editAndCommit(w, 'one')
        const { treeToBlockSet } = await import('src/ts/storage/treeToBlockSet')
        const restored = structuredClone(h.db!) as unknown as Database
        ;(restored as unknown as Record<string, unknown>).mainPrompt = 'restored'
        // The replaced generation is kept (as the damage prompt's replace keeps one), so it still reads when this page writes into it.
        const replaced = await makeOwner(w.store).owner.replaceWholeState(await treeToBlockSet(restored), { keepDamaged: w.owner.committedState()!.generation })
        expect(replaced.kind).toBe('won')
        h.selectAnswer = '1'
        h.db!.mainPrompt = 'mine'
        w.marks.markCharacterForSave(ALPHA)
        await until(async () => (await stoppedReason()) === 'replaced', 'the page to stop saving')
        const calls = await selectCalls()
        expect(offersSaveMine(calls[0])).toBe(false)
        expect(calls[0].title).toBe(language.otherTabSavedReloadTitle)
        expect(await storedPrompt(w)).toBe('restored')
    })

    test('C6 (R): a commit refused because the generation is gone offers reload-or-stay only', async () => {
        const w = await startWorld()
        await editAndCommit(w, 'one')
        const { treeToBlockSet } = await import('src/ts/storage/treeToBlockSet')
        const restored = structuredClone(h.db!) as unknown as Database
        ;(restored as unknown as Record<string, unknown>).mainPrompt = 'restored'
        expect((await makeOwner(w.store).owner.replaceWholeState(await treeToBlockSet(restored))).kind).toBe('won')
        expect(w.store.peek(rootKey(w.owner.committedState()!.generation))).toBeNull()
        h.selectAnswer = '1'
        h.db!.mainPrompt = 'mine'
        w.marks.markCharacterForSave(ALPHA)
        await until(async () => (await stoppedReason()) === 'replaced', 'the page to stop saving')
        const calls = await selectCalls()
        expect(offersSaveMine(calls[0])).toBe(false)
    })

    test('C6 (R): a peer\'s commit broadcast with its sequence number gives a block page Save mine, and one without gives reload-or-stay', async () => {
        const w = await startWorld()
        await editAndCommit(w, 'one')
        const seq = await peerCommits(w, 'the peer')
        h.holdSelect = new Promise<void>(() => {})
        h.db!.mainPrompt = 'mine'
        w.marks.markCharacterForSave(ALPHA)
        broadcastFromPeer(seq)
        await until(async () => (await selectCalls()).length >= 1, 'the prompt')
        expect(offersSaveMine((await selectCalls())[0])).toBe(true)
        closeWorld(w)

        const other = await startWorld()
        await editAndCommit(other, 'one')
        h.holdSelect = new Promise<void>(() => {})
        h.db!.mainPrompt = 'mine'
        other.marks.markCharacterForSave(ALPHA)
        broadcastFromPeer(null)
        await until(async () => (await selectCalls()).length >= 2, 'the second page\'s prompt')
        const calls = await selectCalls()
        expect(offersSaveMine(calls[1])).toBe(false)
        expect(calls[1].title).toBe(language.otherTabSavedReloadTitle)
    })

    test('C6 (R): while the prompt about a refused commit is open the page is not clean and does not reload', async () => {
        const w = await startWorld()
        await editAndCommit(w, 'one')
        await peerCommits(w, 'the peer')
        h.holdSelect = new Promise<void>(() => {})
        h.db!.mainPrompt = 'mine'
        w.marks.markCharacterForSave(ALPHA)
        await until(async () => (await selectCalls()).length >= 1, 'the prompt about the refused commit')
        expect(w.api.isSaveClean()).toBe(false)
        expect(reload).not.toHaveBeenCalled()
    })

    /** A character edit that is held at the write lock while a peer commits and its broadcast arrives, then released: the refused commit and the pending broadcast meet. */
    async function refusedWhileBroadcastPends(w: World): Promise<void> {
        await editAndCommit(w, 'one')
        const seq = await peerCommits(w, 'the peer')
        const release = await w.api.dbWriteLock.acquire()
        ;((h.db!.characters as Array<Record<string, unknown>>)[0]).name = 'mine'
        w.marks.markCharacterForSave(ALPHA)
        await sleepReal(900)
        broadcastFromPeer(seq)
        h.selectAnswer = '0'
        release()
        await until(() => w.api.isSaveClean(), 'Save mine to land')
        await sleepReal(300)
    }

    async function storedCharacterName(w: World): Promise<unknown> {
        const { validateLoadedBlocks } = await import('src/ts/storage/blockProfileValidate')
        const read = await w.owner.readCommitted({ validate: validateLoadedBlocks })
        if (read.kind !== 'loaded') {
            throw new Error(`the committed state did not read: ${read.kind}`)
        }
        return (read.tree as unknown as { characters: Array<{ name: unknown }> }).characters[0].name
    }

    test('C7 (R): a peer broadcast that arrives while the prompt about a refused commit is open does not make the page look clean: it does not reload, and Save mine lands the edit', async () => {
        const w = await startWorld()
        await editAndCommit(w, 'one')
        const seq = await peerCommits(w, 'the peer')
        let answer: () => void = () => {}
        h.holdSelect = new Promise<void>((resolve) => { answer = resolve })
        h.selectAnswer = '0'
        ;((h.db!.characters as Array<Record<string, unknown>>)[0]).name = 'mine'
        w.marks.markCharacterForSave(ALPHA)
        await until(async () => (await selectCalls()).length >= 1, 'the prompt about the refused commit')
        broadcastFromPeer(seq)
        await sleepReal(100)
        h.holdSelect = null
        answer()
        await until(() => w.api.isSaveClean(), 'Save mine to land')
        await sleepReal(300)
        expect(reload).not.toHaveBeenCalled()
        expect(await selectCalls()).toHaveLength(1)
        expect(await storedCharacterName(w)).toBe('mine')
    })

    /** Opens a hold on the next prompt; the returned function answers it (with `h.selectAnswer`). */
    function holdNextPrompt(): () => void {
        let answer: () => void = () => {}
        h.holdSelect = new Promise<void>((resolve) => { answer = resolve })
        return answer
    }

    test('C6 (R): Save mine overwrites only the peer commit that was asked about: a peer commit made while a refused-commit prompt is open is asked about once, and only a second Save mine overwrites it', async () => {
        const w = await startWorld()
        await editAndCommit(w, 'one')
        await peerCommits(w, 'peer one')
        h.selectAnswer = '0'
        const answerFirst = holdNextPrompt()
        h.db!.mainPrompt = 'mine'
        w.marks.markCharacterForSave(ALPHA)
        await until(async () => (await selectCalls()).length >= 1, 'the first prompt')
        const newer = await peerCommits(w, 'peer two')
        broadcastFromPeer(newer)
        const answerSecond = holdNextPrompt()
        answerFirst()
        await until(async () => (await selectCalls()).length >= 2, 'the question about the newer peer commit')
        expect(await storedPrompt(w), 'the newer peer commit survives the first Save mine').toBe('peer two')
        h.holdSelect = null
        answerSecond()
        await until(() => w.api.isSaveClean(), 'the second Save mine to land')
        expect(await selectCalls()).toHaveLength(2)
        expect(await storedPrompt(w)).toBe('mine')
        expect(reload).not.toHaveBeenCalled()
    })

    test('C6 (R): the same holds for the prompt a peer\'s broadcast opens: a peer commit made while it is open is asked about before it is overwritten', async () => {
        const w = await startWorld()
        await editAndCommit(w, 'one')
        const first = await peerCommits(w, 'peer one')
        h.selectAnswer = '0'
        const answerFirst = holdNextPrompt()
        h.db!.mainPrompt = 'mine'
        w.marks.markCharacterForSave(ALPHA)
        broadcastFromPeer(first)
        await until(async () => (await selectCalls()).length >= 1, 'the first prompt')
        const newer = await peerCommits(w, 'peer two')
        broadcastFromPeer(newer)
        const answerSecond = holdNextPrompt()
        answerFirst()
        await until(async () => (await selectCalls()).length >= 2, 'the question about the newer peer commit')
        expect(await storedPrompt(w), 'the newer peer commit survives the first Save mine').toBe('peer two')
        h.holdSelect = null
        answerSecond()
        await until(() => w.api.isSaveClean(), 'the second Save mine to land')
        expect(await selectCalls()).toHaveLength(2)
        expect(await storedPrompt(w)).toBe('mine')
    })

    test('C6 (R): a refused commit asks once: the broadcast that reports the same peer commit does not ask again', async () => {
        const w = await startWorld()
        await refusedWhileBroadcastPends(w)
        expect(await selectCalls()).toHaveLength(1)
        expect(reload).not.toHaveBeenCalled()
    })

    test('C8 (R): a commit lock that times out is retried quietly: no toast, no error, and the save lands when the lock is granted', async () => {
        const w = await startWorld()
        await editAndCommit(w, 'one')
        const { alertError, alertToast } = await import('src/ts/alert')
        const real = w.owner.commitSave.bind(w.owner)
        let timeouts = 0
        vi.spyOn(w.owner, 'commitSave').mockImplementation(async (input, options) => {
            if (timeouts < 8) {
                timeouts++
                throw new w.blockStore.CommitLockTimeoutError(true)
            }
            return real(input, options)
        })
        h.db!.mainPrompt = 'two'
        w.marks.markCharacterForSave(ALPHA)
        await until(() => timeouts >= 8, 'eight timeouts')
        await until(() => w.api.isSaveClean(), 'the save to land')
        expect(await storedPrompt(w)).toBe('two')
        expect(vi.mocked(alertToast)).not.toHaveBeenCalled()
        expect(vi.mocked(alertError)).not.toHaveBeenCalled()
        expect(await stoppedReason()).toBeNull()
    })

    test('C7 (R): a commit lock that times out leaves the page dirty, so a peer\'s broadcast prompts instead of reloading', async () => {
        const w = await startWorld()
        await editAndCommit(w, 'one')
        vi.spyOn(w.owner, 'commitSave').mockRejectedValue(new w.blockStore.CommitLockTimeoutError(true))
        h.holdSelect = new Promise<void>(() => {})
        h.db!.mainPrompt = 'two'
        w.marks.markCharacterForSave(ALPHA)
        await until(() => vi.mocked(w.owner.commitSave).mock.calls.length >= 2, 'two attempts')
        broadcastFromPeer(null)
        await until(async () => (await selectCalls()).length >= 1, 'the prompt')
        expect(reload).not.toHaveBeenCalled()
    })
})

describe('snapshots across boots', () => {
    test('C10 (R): booting twice with no change and a forced first save on each takes one numbered backup, and a change between the boots takes a second', async () => {
        const first = await startWorld()
        await nextCommit(first, mark(first))
        expect(backupWrites(first.store).length).toBe(1)
        const files = first.store.snapshotValues()
        closeWorld(first)

        const second = await startWorld({ files })
        await nextCommit(second, mark(second))
        expect(backupWrites(second.store).length, 'numbered backups by the unchanged boot').toBe(0)
        const unchanged = second.store.snapshotValues()
        closeWorld(second)

        const third = await startWorld({
            files: unchanged,
            boot: async (world) => {
                // The state changes between the boots: another page committed a different prompt.
                const { treeToBlockSet } = await import('src/ts/storage/treeToBlockSet')
                const peer = makeOwner(world.store).owner
                await peer.load()
                const tree = structuredClone(h.db!) as unknown as Database
                ;(tree as unknown as Record<string, unknown>).mainPrompt = 'changed between boots'
                await peer.commitSave(await treeToBlockSet(tree))
                await kit.bootBlockProfile(world)
            },
        })
        await nextCommit(third, mark(third))
        expect(backupWrites(third.store).length, 'numbered backups by the changed boot').toBe(1)
    })

    test('C13 (G): a state changed and changed back across boots takes a backup at each boot whose state differs from the recorded one', async () => {
        const first = await startWorld()
        await editAndCommit(first, 'changed')
        expect(backupWrites(first.store).length).toBe(1)
        const files = first.store.snapshotValues()
        closeWorld(first)

        const second = await startWorld({
            files,
            boot: async (world) => {
                const { treeToBlockSet } = await import('src/ts/storage/treeToBlockSet')
                const peer = makeOwner(world.store).owner
                await peer.load()
                const tree = structuredClone(h.db!) as unknown as Database
                ;(tree as unknown as Record<string, unknown>).mainPrompt = 'base'
                await peer.commitSave(await treeToBlockSet(tree))
                await kit.bootBlockProfile(world)
            },
        })
        await nextCommit(second, mark(second))
        expect(backupWrites(second.store).length, 'numbered backups after returning to the first state').toBe(1)
    })
})

describe('a snapshot that cannot be allocated', () => {
    test('C11 (R): a RangeError while allocating the snapshot skips the backup with one notice, the allocation is not tried again before the backup interval has passed, and saving goes on', async () => {
        const w = await startWorld()
        const { alertError, alertToast } = await import('src/ts/alert')
        const encode = vi.spyOn(w.risuSave.RisuSaveEncoder.prototype, 'encode').mockImplementation(() => {
            throw new RangeError('Array buffer allocation failed')
        })
        for (let i = 0; i < 7; i++) {
            await editAndCommit(w, `edit ${i}`)
        }
        expect(encode, 'allocation attempts within one interval').toHaveBeenCalledTimes(1)
        h.skew += SIX_MINUTES
        await editAndCommit(w, 'edit 7')
        expect(encode, 'allocation attempts after the interval').toHaveBeenCalledTimes(2)
        expect(backupWrites(w.store)).toHaveLength(0)
        const notices = vi.mocked(alertToast).mock.calls.filter(([message]) => message === language.saveSnapshotSkippedMemory)
        expect(notices).toHaveLength(1)
        expect(vi.mocked(alertError)).not.toHaveBeenCalled()
        expect(await stoppedReason()).toBeNull()
        expect(await storedPrompt(w)).toBe('edit 7')
    })

    test('C11 (R): skipped snapshots between failing backup writes leave the failure streak alone, so the fifth failure is still reported', async () => {
        const w = await startWorld()
        const { alertError } = await import('src/ts/alert')
        const original = w.risuSave.RisuSaveEncoder.prototype.encode
        let calls = 0
        vi.spyOn(w.risuSave.RisuSaveEncoder.prototype, 'encode').mockImplementation(function (this: InstanceType<typeof w.risuSave.RisuSaveEncoder>, ...args) {
            calls++
            if (calls % 2 === 1) {
                throw new RangeError('Array buffer allocation failed')
            }
            return original.apply(this, args)
        })
        w.store.faults.push({ match: (op) => op.kind === 'write' && isBackupKey(op.key), mode: 'before', times: 1000 })
        // Even edits (0, 2, ...) skip the snapshot; odd edits reach a refused backup write.
        for (let i = 0; i < 8; i++) {
            h.skew += SIX_MINUTES
            await editAndCommit(w, `edit ${i}`)
        }
        expect(vi.mocked(alertError), 'after four failures').not.toHaveBeenCalled()
        for (let i = 8; i < 10; i++) {
            h.skew += SIX_MINUTES
            await editAndCommit(w, `edit ${i}`)
        }
        expect(vi.mocked(alertError), 'after the fifth failure').toHaveBeenCalledTimes(1)
    })

    test('C11 (R): a failure to encode the snapshot that is not a RangeError counts toward the streak and is reported after five in a row', async () => {
        const w = await startWorld()
        const { alertError } = await import('src/ts/alert')
        vi.spyOn(w.risuSave.RisuSaveEncoder.prototype, 'encode').mockImplementation(() => {
            throw new Error('the encoder broke')
        })
        for (let i = 0; i < 4; i++) {
            await editAndCommit(w, `edit ${i}`)
        }
        expect(vi.mocked(alertError)).not.toHaveBeenCalled()
        await editAndCommit(w, 'edit 4')
        expect(vi.mocked(alertError)).toHaveBeenCalledTimes(1)
        expect(await storedPrompt(w)).toBe('edit 4')
    })
})

describe('a page that runs from OPFS this time', () => {
    test('C12 (R): edits produce no store write and the loop does not run', async () => {
        const w = await startWorld({ kind: 'opfs-transitional' })
        expect(w.pageMode.getPageStorageMode().kind).toBe('read-only')
        const done = await Promise.race([w.api.saveDb().then(() => 'returned'), sleepReal(500).then(() => 'still running')])
        expect(done).toBe('returned')
        h.db!.mainPrompt = 'edited'
        w.marks.markCharacterForSave(ALPHA)
        await sleepReal(1200)
        expect(w.store.mutating()).toEqual([])
        expect(w.api.isSaveClean()).toBe(false)
    })
})
