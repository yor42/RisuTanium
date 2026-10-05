/**
 * S11: `prepareSaveIteration` -- the full-reload branch, the snapshot/trim,
 * and the post-reload filter that keeps a reload from double-encoding an
 * already-marked character the same save iteration.
 * S13: `bootSaveSequence` -- a mark made while a slow `init()` is still
 * pending is queued into the live tracker immediately and flushed by the
 * real scheduler once `init()` completes ("installing after init" would
 * fail this test -- see its own comment).
 * S14: `mergeUnsavedChanges` -- pure merge-back-without-loss-or-duplication.
 *
 * This file drives the REAL, unmocked `src/ts/globalApi.svelte.ts` (so these
 * three functions, extracted from `saveDb()` -- `prepareSaveIteration` now
 * reorders the snapshot/reinit steps and filters the snapshot, not merely a
 * verbatim extraction -- are exercised for real) and the REAL
 * `src/ts/storage/risuSave.ts` /
 * `src/ts/storage/characterSaveMarks.ts`. The module-mock set below is
 * copied, trimmed to what these three functions' own dependency graph
 * actually needs, from `src/ts/globalApiFileCacheAv3.svelte.test.ts` (the
 * existing precedent for loading this same huge module for real).
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'

//#region module mocks -- trimmed from globalApiFileCacheAv3.svelte.test.ts

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
    getDatabase: vi.fn(() => {
        throw new Error('no live database in tests')
    }),
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
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/alert'), () => ({
    alertClear: vi.fn(),
    alertConfirm: vi.fn(async () => true),
    alertError: vi.fn(),
    alertWait: vi.fn(),
    alertMd: vi.fn(),
    alertNormal: vi.fn(),
    alertSelect: vi.fn(),
    alertToast: vi.fn(),
    alertInput: vi.fn(),
    alertNormalWait: vi.fn(),
    alertAddCharacter: vi.fn(),
    alertStore: writable({ type: 'none', msg: '' }),
    waitAlert: vi.fn(async () => {}),
}))

vi.mock(import('src/ts/util'), () => ({
    changeFullscreen: vi.fn(),
    checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
    sleep: vi.fn(async () => {}),
    sleepForever: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/util'))

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
        getItem = vi.fn(async (_key: string) => null as unknown)
        setItem = vi.fn(async () => null)
        keys = vi.fn(async () => [] as string[])
        removeItem = vi.fn(async () => {})
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

//#endregion

import {
    bootSaveSequence,
    prepareSaveIteration,
    mergeUnsavedChanges,
    sweepDraftRegistrations,
} from 'src/ts/globalApi.svelte'
import { RisuSaveEncoder, decodeRisuSave } from 'src/ts/storage/risuSave'
import type { toSaveType } from 'src/ts/storage/risuSave'
import type { Database } from 'src/ts/storage/database.svelte'
import {
    installCharacterSaveMarks,
    markCharacterForSave,
    resetCharacterSaveMarksForTest,
} from 'src/ts/storage/characterSaveMarks'
import { draftContentOrphanGate, DRAFT_CONTENT_ORPHAN_CAP_MS } from 'src/ts/draftContentOrphanGate'
import { hasLocalDrafts, resetLocalDraftsForTest } from 'src/ts/localDrafts'
import type { MessageIdentity } from 'src/ts/draftContents'

//#region fixtures

function makeTracker(): toSaveType {
    return {
        character: [],
        chat: [],
        botPreset: false,
        modules: false,
        loadouts: false,
        plugins: false,
        pluginCustomStorage: false,
    }
}

type CharacterFixture = Database['characters'][number]

function makeCharacter(chaId: string, name: string): CharacterFixture {
    return {
        chaId,
        name,
        type: 'character',
        chatPage: 0,
        chats: [{ id: `${chaId}-chat-0`, message: [], note: '', name: '', localLore: [] }],
    } as unknown as CharacterFixture
}

function buildDb(characters: CharacterFixture[]): Database {
    return {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        characters,
    } as unknown as Database
}

beforeEach(() => {
    resetCharacterSaveMarksForTest()
})

//#endregion

describe('bootSaveSequence — S13', () => {
    test('a mark made while a slow init() is pending lands in the tracker immediately, and the real scheduler flushes it once, after init completes', async () => {
        const tracker = makeTracker()
        let resolveInit!: () => void
        const init = vi.fn(() => new Promise<void>((resolve) => { resolveInit = resolve }))
        const realSchedule = vi.fn()
        const createRealScheduler = vi.fn(() => realSchedule)

        const bootPromise = bootSaveSequence({
            tracker,
            installMarks: installCharacterSaveMarks, // the REAL production wiring function
            init,
            createRealScheduler,
        })

        // init() is still pending here -- a mark arriving now must be queued
        // into the LIVE tracker right away (not dropped, not merely queued in
        // characterSaveMarks' pre-install buffer), because installMarks was
        // called BEFORE init(), not after. If bootSaveSequence installed
        // AFTER init() instead, `installed` would still be null at this exact
        // point, and this assertion would fail (the mark would sit in
        // characterSaveMarks' own pre-install queue instead of `tracker`).
        markCharacterForSave('char-mid-init')
        expect(tracker.character).toContain('char-mid-init')
        expect(createRealScheduler).not.toHaveBeenCalled()
        expect(realSchedule).not.toHaveBeenCalled()

        resolveInit()
        await bootPromise

        expect(createRealScheduler).toHaveBeenCalledTimes(1)
        // The pending mark above requested a save (via the pending-scheduler),
        // so the real scheduler must be flushed exactly once with markDirty=true.
        expect(realSchedule).toHaveBeenCalledTimes(1)
        expect(realSchedule).toHaveBeenCalledWith(true)
    })

    test('no pending mark during init means the real scheduler is installed but never flushed', async () => {
        const tracker = makeTracker()
        const init = vi.fn(async () => {})
        const realSchedule = vi.fn()
        const createRealScheduler = vi.fn(() => realSchedule)

        await bootSaveSequence({
            tracker,
            installMarks: installCharacterSaveMarks,
            init,
            createRealScheduler,
        })

        expect(realSchedule).not.toHaveBeenCalled()
    })
})

describe('prepareSaveIteration — S11', () => {
    test('a full reload restores characters present in the backup, drops ones absent from it, and encodes each present character exactly once', async () => {
        const tracker = makeTracker()
        // char-A survived the backup load; char-C did not (deleted by the
        // backup); both were marked BEFORE the reload (e.g. by a plugin or
        // the identity tracker) in this same save iteration.
        tracker.character = ['char-A', 'char-C']
        const reloadFlag = { state: true }

        const postBackupDb = buildDb([
            makeCharacter('char-A', 'A restored from backup'),
            makeCharacter('char-B', 'B also in the backup, never marked'),
        ])

        const encodeSpy = vi.spyOn(RisuSaveEncoder.prototype, 'encodeBlock')
        const countEncodesFor = (chaId: string) =>
            encodeSpy.mock.calls.filter(([arg]) => (arg as { name: string }).name === chaId).length

        const staleEncoder = new RisuSaveEncoder() // stand-in for the pre-reload encoder; never used past this call
        let onSnapshotTakenCalled = false

        const result = await prepareSaveIteration({
            tracker,
            encoder: staleEncoder,
            reloadFlag,
            reinitEncoder: async () => {
                const fresh = new RisuSaveEncoder()
                await fresh.init(postBackupDb, { compression: false, skipRemoteSavingOnCharacters: false })
                return fresh
            },
            getDatabase: () => postBackupDb,
            onSnapshotTaken: () => { onSnapshotTakenCalled = true },
        })

        expect(reloadFlag.state).toBe(false) // consumed
        expect(onSnapshotTakenCalled).toBe(true)
        // char-A's proxy was already encoded by the reload's own init() --
        // filtered OUT so set() below doesn't double-encode it.
        expect(result.toSave.character).not.toContain('char-A')
        // char-C is absent from the post-backup db entirely -- kept, so
        // set() below runs its delete branch for it, but that's a no-op:
        // the fresh encoder's own init() never had a block for char-C to
        // begin with, since char-C isn't in postBackupDb.
        expect(result.toSave.character).toContain('char-C')

        const charAEncodesBeforeSet = countEncodesFor('char-A')
        expect(charAEncodesBeforeSet).toBe(1) // encoded exactly once, by init()

        await result.encoder.set(postBackupDb, result.toSave)

        expect(countEncodesFor('char-A')).toBe(charAEncodesBeforeSet) // NOT re-encoded a second time by set()

        const decoded = await decodeRisuSave(new Uint8Array(result.encoder.encode()!))
        expect(decoded.characters?.find((c: CharacterFixture) => c.chaId === 'char-A')?.name).toBe('A restored from backup')
        expect(decoded.characters?.find((c: CharacterFixture) => c.chaId === 'char-B')?.name).toBe('B also in the backup, never marked')
        expect(decoded.characters?.find((c: CharacterFixture) => c.chaId === 'char-C')).toBeUndefined() // gone

        encodeSpy.mockRestore()
    })

    test('a reload consumes the fresh encoder\'s recorded proxies: takeEncodedCharacterProxies() is empty right after prepareSaveIteration\'s filter runs (proxy release)', async () => {
        const tracker = makeTracker()
        tracker.character = ['char-A']
        const reloadFlag = { state: true }
        const postBackupDb = buildDb([
            makeCharacter('char-A', 'A restored from backup'),
        ])
        const staleEncoder = new RisuSaveEncoder()

        const result = await prepareSaveIteration({
            tracker,
            encoder: staleEncoder,
            reloadFlag,
            reinitEncoder: async () => {
                const fresh = new RisuSaveEncoder()
                await fresh.init(postBackupDb, { compression: false, skipRemoteSavingOnCharacters: false })
                return fresh
            },
            getDatabase: () => postBackupDb,
        })

        // The filter above already consumed the fresh encoder's recorded set
        // (takeEncodedCharacterProxies()) to decide what to drop from
        // `toSave` -- so a second take, right after prepareSaveIteration()
        // returns, must come back empty rather than still holding char-A.
        expect(result.encoder.takeEncodedCharacterProxies().size).toBe(0)
    })

    test('a character replaced again right after the reload\'s own init() recorded it (a proxy not yet recorded by THIS init) survives the filter', async () => {
        const tracker = makeTracker()
        tracker.character = ['char-A']
        const reloadFlag = { state: true }

        const originalCharA = makeCharacter('char-A', 'A original, seen by init()')
        const replacedCharA = makeCharacter('char-A', 'A replaced again right after init()')
        let getDatabaseCalls = 0
        // reinitEncoder() calls getDatabase() once (to init() from); the
        // filter step calls it again afterward. Simulates something (e.g. the
        // identity tracker's own writer) replacing char-A's proxy in that
        // narrow window between the two calls -- the filter must key off
        // whatever getDatabase() returns NOW, not a stale reference, so a
        // mark for the id survives rather than being wrongly filtered against
        // a proxy this init() never actually saw.
        const getDatabase = () => {
            getDatabaseCalls++
            return getDatabaseCalls === 1 ? buildDb([originalCharA]) : buildDb([replacedCharA])
        }

        const staleEncoder = new RisuSaveEncoder()
        const result = await prepareSaveIteration({
            tracker,
            encoder: staleEncoder,
            reloadFlag,
            reinitEncoder: async () => {
                const fresh = new RisuSaveEncoder()
                await fresh.init(getDatabase(), { compression: false, skipRemoteSavingOnCharacters: false })
                return fresh
            },
            getDatabase,
        })

        expect(getDatabaseCalls).toBeGreaterThanOrEqual(2)
        expect(result.toSave.character).toContain('char-A')
    })

    test('no reload: passes present ids through, trimmed to the sticky front', async () => {
        const tracker = makeTracker()
        tracker.character = ['char-front', 'char-second']
        tracker.chat = [['char-front', 'chat-0'], ['char-second', 'chat-1']]
        const reloadFlag = { state: false }
        const encoder = new RisuSaveEncoder()
        const reinitEncoder = vi.fn()

        const result = await prepareSaveIteration({
            tracker,
            encoder,
            reloadFlag,
            reinitEncoder,
            getDatabase: () => buildDb([
                makeCharacter('char-front', 'front'),
                makeCharacter('char-second', 'second'),
            ]),
        })

        expect(reinitEncoder).not.toHaveBeenCalled()
        expect(result.encoder).toBe(encoder)
        expect(result.toSave.character).toEqual(['char-front', 'char-second'])
        // The LIVE tracker is trimmed to the sticky front right away.
        expect(tracker.character).toEqual(['char-front'])
        expect(tracker.chat).toEqual([['char-front', 'chat-0']])
    })

    test('no reload: drops ids absent from db.characters so the encoder never deletes a block without a reload', async () => {
        const tracker = makeTracker()
        tracker.character = ['char-0', 'char-1']
        const reloadFlag = { state: false }
        const dbWithBothCharacters = buildDb([
            makeCharacter('char-0', 'Character Zero'),
            makeCharacter('char-1', 'Character One'),
        ])
        const dbWithoutCharOne = buildDb([
            makeCharacter('char-0', 'Character Zero'),
        ])
        const encoder = new RisuSaveEncoder()
        await encoder.init(dbWithBothCharacters, { compression: false, skipRemoteSavingOnCharacters: false })
        const reinitEncoder = vi.fn()

        const result = await prepareSaveIteration({
            tracker,
            encoder,
            reloadFlag,
            reinitEncoder,
            // char-1 is absent here -- e.g. a stale second plugin
            // setDatabase/setDatabaseLite call already reassigned
            // db.characters away without a reload. Since no reload
            // happened this iteration, the encoder's delete branch must never
            // run for char-1 -- only a reload (which sets
            // requiresFullEncoderReload) may intentionally remove a block.
            getDatabase: () => dbWithoutCharOne,
        })

        expect(reinitEncoder).not.toHaveBeenCalled()
        expect(result.toSave.character).toEqual(['char-0'])

        await result.encoder.set(dbWithoutCharOne, result.toSave)
        const decoded = await decodeRisuSave(new Uint8Array(result.encoder.encode()!))
        // char-1's block still exists -- it comes back on reload, rather than
        // being permanently deleted by a save iteration that never reloaded.
        expect(decoded.characters?.find((c: CharacterFixture) => c.chaId === 'char-1')).toBeTruthy()
    })

    test('an edit made during a reload, on a character that reload already encoded, is still saved because the snapshot is taken before reinitEncoder() runs', async () => {
        resetCharacterSaveMarksForTest()
        const tracker = makeTracker()
        // char-B is already marked before this iteration starts -- an unrelated
        // front id, occupying tracker.character[0] (the "sticky front" trim
        // keeps only this slot).
        tracker.character = ['char-B']
        installCharacterSaveMarks({ tracker, schedule: () => {} }) // real production wiring

        const charA = makeCharacter('char-A', 'A original, seen by the reload\'s init()')
        const charB = makeCharacter('char-B', 'B unrelated')
        const db = buildDb([charB, charA])
        const reloadFlag = { state: true }
        const staleEncoder = new RisuSaveEncoder() // stand-in for the pre-reload encoder; never used past this call

        const result = await prepareSaveIteration({
            tracker,
            encoder: staleEncoder,
            reloadFlag,
            reinitEncoder: async () => {
                // A slow fake that runs the REAL encoder init() -- during the
                // (seconds-long, in production) window this init() call takes,
                // something writes char-A IN PLACE (same proxy init() just
                // recorded in encodedCharacterProxies) and marks it. This lands
                // the mark BEHIND char-B, since char-B was already in the
                // tracker: tracker.character becomes ['char-B', 'char-A'].
                const fresh = new RisuSaveEncoder()
                await fresh.init(db, { compression: false, skipRemoteSavingOnCharacters: false })
                charA.chats[0].message.push({ role: 'char', data: 'reply tail written during reload', chatId: 'm1' })
                markCharacterForSave('char-A')
                return fresh
            },
            getDatabase: () => db,
        })

        // The snapshot is taken BEFORE reinitEncoder() is even called, so it
        // only ever contains ['char-B'] -- char-A's mark above is added by
        // the fake reinitEncoder() DURING the reload, after the snapshot
        // already ran, and so lands in the LIVE tracker instead, behind the
        // sticky front. The live tracker is trimmed to the sticky front
        // regardless of what the filter below does to `toSave`.
        expect(tracker.character).toEqual(['char-B'])

        await result.encoder.set(db, result.toSave)

        // "...then run one more normal save iteration, as the real loop would."
        const result2 = await prepareSaveIteration({
            tracker,
            encoder: result.encoder,
            reloadFlag: { state: false },
            reinitEncoder: async () => { throw new Error('must not reload again') },
            getDatabase: () => db,
        })
        await result2.encoder.set(db, result2.toSave)

        const decoded = await decodeRisuSave(new Uint8Array(result2.encoder.encode()!))
        const decodedA = decoded.characters?.find((c: CharacterFixture) => c.chaId === 'char-A')
        // The snapshot taken here is only ['char-B'] -- char-A's mark above
        // is never part of it, since it's added by reinitEncoder() itself,
        // after the snapshot already ran. The post-reload filter then drops
        // char-B instead (its proxy WAS recorded by this reload's own
        // init()), leaving `toSave.character` empty; the fold loop in
        // prepareSaveIteration (in globalApi.svelte.ts) picks up char-A's
        // mark from the live tracker afterward and pushes it in, unfiltered.
        // So the FIRST set() call below (on `result`) is the one that
        // actually writes the reply tail; the second iteration's set() (on
        // `result2`) only re-encodes char-B.
        expect(decodedA?.chats[0].message).toContainEqual({ role: 'char', data: 'reply tail written during reload', chatId: 'm1' })

        resetCharacterSaveMarksForTest()
    })
})

describe('prepareSaveIteration — onSnapshotRestored and reload-flag ordering', () => {
    // A: `onSnapshotTaken` (used by saveDb() to clear `dirtySinceLastSave`)
    // runs before reinitEncoder(). If reinitEncoder() THROWS,
    // prepareSaveIteration folds the snapshot back into the live tracker via
    // mergeUnsavedChanges (so nothing is lost), but saveDb() still needs to
    // know it must flag itself dirty again for a retry: the optional
    // `onSnapshotRestored` callback is called right after that merge-back,
    // and saveDb() wires it to `dirtySinceLastSave = true`.
    test('reinitEncoder() throwing calls onSnapshotRestored exactly once, after onSnapshotTaken, rejects with the same error, and restores the snapshot ids into the live tracker', async () => {
        const tracker = makeTracker()
        tracker.character = ['char-A', 'char-C']
        tracker.chat = [['char-A', 'chat-0']]
        const reloadFlag = { state: true }
        const staleEncoder = new RisuSaveEncoder()
        const thrown = new Error('reinitEncoder failed')

        const callOrder: string[] = []
        const onSnapshotTaken = vi.fn(() => { callOrder.push('taken') })
        const onSnapshotRestored = vi.fn(() => { callOrder.push('restored') })

        await expect(prepareSaveIteration({
            tracker,
            encoder: staleEncoder,
            reloadFlag,
            reinitEncoder: async () => { throw thrown },
            getDatabase: () => buildDb([]),
            onSnapshotTaken,
            onSnapshotRestored,
        })).rejects.toBe(thrown)

        expect(onSnapshotTaken).toHaveBeenCalledTimes(1)
        expect(onSnapshotRestored).toHaveBeenCalledTimes(1)
        expect(callOrder).toEqual(['taken', 'restored'])

        // mergeUnsavedChanges already folds the snapshot back into the live
        // tracker before the throw propagates -- onSnapshotRestored is an
        // ADDITIONAL signal (for saveDb()'s dirtySinceLastSave), not a
        // replacement for that merge-back.
        expect(tracker.character).toEqual(expect.arrayContaining(['char-A', 'char-C']))
        expect(tracker.chat).toEqual(expect.arrayContaining([['char-A', 'chat-0']]))
    })

    test('guard: on a successful reload, onSnapshotRestored is never called', async () => {
        const tracker = makeTracker()
        tracker.character = ['char-A']
        const reloadFlag = { state: true }
        const staleEncoder = new RisuSaveEncoder()
        const db = buildDb([makeCharacter('char-A', 'A')])
        const onSnapshotRestored = vi.fn()

        await prepareSaveIteration({
            tracker,
            encoder: staleEncoder,
            reloadFlag,
            reinitEncoder: async () => {
                const fresh = new RisuSaveEncoder()
                await fresh.init(db, { compression: false, skipRemoteSavingOnCharacters: false })
                return fresh
            },
            getDatabase: () => db,
            onSnapshotRestored,
        })

        expect(onSnapshotRestored).not.toHaveBeenCalled()
    })

    // `opts.reloadFlag.state = false` runs BEFORE `await reinitEncoder()`, so
    // a removeChar() or backup load that sets the flag DURING the reload
    // (requesting another full reload once this one finishes) is never
    // silently erased by a later assignment. If reinitEncoder() throws, the
    // flag is set back to `true` (confirmed by the guard test below).
    test('reloadFlag.state set to true partway through reinitEncoder() (e.g. removeChar racing the reload) survives -- the flag is still true after prepareSaveIteration returns', async () => {
        const tracker = makeTracker()
        tracker.character = ['char-A']
        const reloadFlag = { state: true }
        const staleEncoder = new RisuSaveEncoder()
        const db = buildDb([makeCharacter('char-A', 'A')])

        await prepareSaveIteration({
            tracker,
            encoder: staleEncoder,
            reloadFlag,
            reinitEncoder: async () => {
                // Simulates removeChar() (or a backup load) running during
                // this same reload and requesting ANOTHER full reload once
                // this one finishes.
                reloadFlag.state = true
                const fresh = new RisuSaveEncoder()
                await fresh.init(db, { compression: false, skipRemoteSavingOnCharacters: false })
                return fresh
            },
            getDatabase: () => db,
        })

        expect(reloadFlag.state).toBe(true)
    })

    test('guard: reinitEncoder() throwing still leaves the reload flag true afterward', async () => {
        const tracker = makeTracker()
        tracker.character = ['char-A']
        const reloadFlag = { state: true }
        const staleEncoder = new RisuSaveEncoder()

        await expect(prepareSaveIteration({
            tracker,
            encoder: staleEncoder,
            reloadFlag,
            reinitEncoder: async () => { throw new Error('boom') },
            getDatabase: () => buildDb([]),
        })).rejects.toThrow('boom')

        expect(reloadFlag.state).toBe(true)
    })
})

describe('mergeUnsavedChanges — S14', () => {
    test('a mark added between the snapshot and the end of set() survives into the next save, without duplication', () => {
        const live = makeTracker()
        // Accumulated AFTER the snapshot was taken (e.g. during the in-flight write).
        live.character = ['char-new']
        live.chat = [['char-new', 'chat-1']]

        const toSave = makeTracker()
        toSave.character = ['char-old', 'char-new'] // char-new overlaps -- must not duplicate
        toSave.chat = [['char-old', 'chat-0']]
        toSave.botPreset = true
        toSave.modules = true

        mergeUnsavedChanges(live, toSave)

        expect(live.character).toEqual(['char-new', 'char-old'])
        expect(live.chat).toEqual([['char-new', 'chat-1'], ['char-old', 'chat-0']])
        expect(live.botPreset).toBe(true)
        expect(live.modules).toBe(true)
        expect(live.loadouts).toBe(false)
    })

    test('a failed save (live tracker already trimmed/reset) merges the whole snapshot back without loss', () => {
        const live = makeTracker() // as if just trimmed to empty by prepareSaveIteration
        const toSave = makeTracker()
        toSave.character = ['char-a', 'char-b']
        toSave.chat = [['char-a', 'chat-0'], ['char-b', 'chat-1']]
        toSave.plugins = true
        toSave.pluginCustomStorage = true

        mergeUnsavedChanges(live, toSave)

        expect(live.character).toEqual(['char-a', 'char-b'])
        expect(live.chat).toEqual([['char-a', 'chat-0'], ['char-b', 'chat-1']])
        expect(live.plugins).toBe(true)
        expect(live.pluginCustomStorage).toBe(true)
    })

    test('does not duplicate a chat pair that already exists in the live tracker', () => {
        const live = makeTracker()
        live.chat = [['char-a', 'chat-0']]
        const toSave = makeTracker()
        toSave.chat = [['char-a', 'chat-0'], ['char-b', 'chat-2']]

        mergeUnsavedChanges(live, toSave)

        expect(live.chat).toEqual([['char-a', 'chat-0'], ['char-b', 'chat-2']])
    })
})

describe('sweepDraftRegistrations', () => {
    // Extracted from `saveDb()`'s loop for the same reason `bootSaveSequence`/
    // `prepareSaveIteration` were (see this function's own comment in
    // `globalApi.svelte.ts`): the loop itself is a non-terminating
    // `while (true)` with heavy real side effects and cannot be driven by a
    // test. These tests can only prove `sweepDraftRegistrations` itself is
    // correct, not that `saveDb()`'s loop still calls it -- that call site is
    // not reachable from a test. Not something to fake with a check against
    // the loop's source text.
    //
    // Runs against the REAL `draftContentOrphanGate` (`src/ts/draftContentOrphanGate.ts`)
    // and REAL `localDrafts` (`src/ts/localDrafts.ts`) -- neither is mocked
    // above, and both are plain in-memory modules with nothing to fake.
    afterEach(() => {
        draftContentOrphanGate.clear()
        resetLocalDraftsForTest()
    })

    function msgIdentity(chatId: string): MessageIdentity {
        return { kind: 'msg', chatKey: 'chat-1', chatId, index: 0 }
    }

    test('releases an orphan registration once `now` is past its cap, without touching the record', () => {
        const identity = msgIdentity('chat-id-1')
        // Registered at an explicit, controlled `now` -- not real wall-clock
        // time -- so the threshold check below never depends on how long
        // this test actually takes to run.
        draftContentOrphanGate.set(identity, 'typed text', 'base text', 1_000)

        expect(hasLocalDrafts()).toBe(true)

        sweepDraftRegistrations(1_000 + DRAFT_CONTENT_ORPHAN_CAP_MS)

        // A function whose body is a no-op would never call through to the
        // real gate, so this would still be true.
        expect(hasLocalDrafts()).toBe(false)
        // Only the REGISTRATION is released -- the content record
        // itself must still be there, untouched.
        expect(draftContentOrphanGate.get(identity, 'base text')).toEqual({
            text: 'typed text',
            baseData: 'base text',
            updatedAt: expect.any(Number),
        })
    })

    test('does not release a registration before its cap has elapsed, and DOES use the given `now` rather than a hardcoded 0', () => {
        const identity = msgIdentity('chat-id-2')
        draftContentOrphanGate.set(identity, 'typed text', 'base text', 1_000)

        // One ms short of the cap -- still live.
        sweepDraftRegistrations(1_000 + DRAFT_CONTENT_ORPHAN_CAP_MS - 1)
        expect(hasLocalDrafts()).toBe(true)

        // A `now` hardcoded to 0 is always "before" a registration stamped
        // from a positive `now` (1_000 here), so it would never register as
        // expired -- this call, with a `now` genuinely past the cap, is what
        // a hardcoded-0 implementation would fail.
        sweepDraftRegistrations(1_000 + DRAFT_CONTENT_ORPHAN_CAP_MS)
        expect(hasLocalDrafts()).toBe(false)
    })
})
