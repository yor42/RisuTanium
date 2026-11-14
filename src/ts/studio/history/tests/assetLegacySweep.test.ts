// @vitest-environment jsdom
/**
 * The asset write against the legacy sweeps: a row removed in Studio keeps its file while an undo can still need it,
 * through a reload and an overflow of the history, and the file goes only once nothing names it. Everything runs for
 * real except the page's database and the services `globalApi.svelte` imports: the history service and its store
 * double, `getUncleanablesSync`, `sweepTauriAssets`, and the file probe over a fake byte store.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from 'src/ts/storage/database.svelte'

vi.mock('localforage', () => ({
    default: { createInstance: () => ({ getItem: vi.fn(async () => null), setItem: vi.fn(), removeItem: vi.fn() }) },
}))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => { throw new Error('no live database in tests') }),
    setDatabase: vi.fn(),
    presetTemplate: { name: 'test-preset' },
    defaultSdDataFunc: vi.fn(() => ({})),
    appVer: 'test',
    appSubVer: 'test',
    getCurrentCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: { characters: [], modules: [] } },
    selectedCharID: writable(-1),
    selIdState: { selId: 0 },
    alertStore: writable({ type: 'none', msg: '' }),
    MobileGUI: writable(false),
    botMakerMode: writable(false),
    loadedStore: writable(false),
    LoadingStatusState: { text: '' },
    ReloadGUIPointer: writable(0),
    bodyIntercepterStore: writable(null),
    savingStoppedReason: writable(null),
    CharEmotion: writable({}),
    clearCharEmotionCache: () => {},
    MobileGUIStack: writable([]),
    OpenRealmStore: writable(false),
    frozenSaveKeysStore: writable([]),
    settingsOpen: writable(false),
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/storage/dbChangeEffects.svelte'), () => ({
    registerDbChangeEffects: vi.fn(),
}) as unknown as typeof import('src/ts/storage/dbChangeEffects.svelte'))

import { getBasename, getUncleanablesSync } from 'src/ts/globalApi.svelte'
import { sweepTauriAssets } from 'src/ts/storage/assetSweep'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import { resetPageStorageModeForTests } from 'src/ts/storage/pageStorageMode'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { DBState } from 'src/ts/stores.svelte'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { createOwnerHistoryService, type OwnerHistoryService } from '../ownerHistory.svelte'
import { characterOwnerKey, SAVE_DEBOUNCE_MS } from '../ownerPhase'
import { MAX_DONE } from '../historyModel'
import { createFakeClock, drainMicrotasks, type FakeClock } from './historyTestKit.test-helpers'
import { createClaimDouble } from './studioStoreDoubles'
import { createControlStudioStore, type ControlStudioStore } from './studioStoreControlDouble'

interface LiveCharacter {
    chaId: string
    type: string
    name: string
    desc: string
    alternateGreetings: string[]
    chats: { id: string; note: string }[]
    chatPage: number
    additionalAssets: string[][]
    emotionImages: string[][]
}

const A = characterOwnerKey('A')
const FILES = ['assets/smile.png', 'assets/grin.png', 'assets/orphan.png']

function makeCharacter(): LiveCharacter {
    return {
        chaId: 'A',
        type: 'character',
        name: 'A',
        desc: 'd0',
        alternateGreetings: ['g0'],
        chats: [{ id: 'c1', note: '' }],
        chatPage: 0,
        additionalAssets: [['smile', 'assets/smile.png', 'png'], ['grin', 'assets/grin.png', 'png']],
        emotionImages: [],
    }
}

const live = (): LiveCharacter => (DBState.db.characters as unknown as LiveCharacter[])[0]

function liveDatabase(): Database {
    return { characters: DBState.db.characters, modules: [], personas: [], characterOrder: [], customBackground: '', userIcon: '' } as unknown as Database
}

interface Session {
    clock: FakeClock
    store: ControlStudioStore
    service: OwnerHistoryService
    bytes: Set<string>
}

// `reading` gives the service a file reader over `bytes`: a path in the set is present, any other is gone. Without it
// nothing is checked.
function open(shared?: Map<string, string>, bytes = new Set(FILES), reading = false): Session {
    const clock = createFakeClock()
    const store = createControlStudioStore({ shared })
    const session: Session = {
        clock,
        store,
        bytes,
        service: createOwnerHistoryService({
            store,
            claim: createClaimDouble(),
            clock,
            pageSession: 'p1',
            getVisitId: () => 'v1',
            registerLeaveFlush: () => () => {},
            ...(reading ? { openAssetFileReader: async () => ({ concurrency: 1, stateOf: async (path: string) => (bytes.has(path) ? ('present' as const) : ('gone' as const)) }) } : {}),
        }),
    }
    return session
}

let session: Session

const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }

beforeEach(() => {
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => {} })
    resetStudioScreenForTests()
    DBState.db.characters = [makeCharacter()] as unknown as typeof DBState.db.characters
    studioScreen.chaId = 'A'
    session = open()
})

afterEach(() => {
    resetPageStorageModeForTests()
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
})

const settle = (): Promise<void> => drainMicrotasks()

// One run of the legacy file sweep over the files the byte store holds: what it deletes.
async function sweepRemoved(on: Session): Promise<string[]> {
    const removed: string[] = []
    await sweepTauriAssets({
        uncleanable: new Set<string>(),
        listAssets: async () => [...on.bytes].map((path) => ({ name: path.slice('assets/'.length) })),
        removeAsset: async (path) => {
            removed.push(path)
            on.bytes.delete(path)
        },
        getBasename,
        liveUncleanable: () => new Set(getUncleanablesSync(liveDatabase())),
        log: () => {},
    })
    return removed.sort()
}

function overflow(on: Session): void {
    for (let i = 0; i < MAX_DONE; i++) {
        on.service.editField(A, 'desc', 'v' + i)
        on.service.closeOpenStep(A)
    }
}

describe('a removed row keeps its file while an undo can need it', () => {
    test('a delete is saved in both stores, the sweep keeps the file, and after a reload Undo restores the row and the file is there', async () => {
        await session.service.whenReady(A)
        expect(session.service.assetDelete(A, 'additionalAssets', [1]).ok).toBe(true)
        await settle()

        // Only the file nothing names is deleted.
        expect(await sweepRemoved(session)).toEqual(['assets/orphan.png'])
        expect(session.bytes.has('assets/grin.png')).toBe(true)

        const reloaded = open(session.store.shared, session.bytes)
        await reloaded.service.whenReady(A)
        expect(reloaded.service.undo(A)).toMatchObject({ ok: true })
        expect(live().additionalAssets.map((row) => row[0])).toEqual(['smile', 'grin'])
        expect(session.bytes.has('assets/grin.png')).toBe(true)
    })

    test('after the history overflowed and the page crashed, the field still names the file for the sweep and Undo restores the row', async () => {
        await session.service.whenReady(A)
        session.service.assetDelete(A, 'additionalAssets', [1])
        await settle()
        overflow(session)
        expect(session.service.assetRename(A, 'additionalAssets', 0, 'smile2').ok).toBe(true)
        expect(getUncleanablesSync(liveDatabase())).toContain('grin.png')
        expect(await sweepRemoved(session)).toEqual(['assets/orphan.png'])

        const reloaded = open(session.store.shared, session.bytes)
        await reloaded.service.whenReady(A)
        expect(reloaded.service.undo(A)).toMatchObject({ ok: true })
        expect(live().additionalAssets.map((row) => row[0])).toContain('grin')
    })

    test('two refused saves around the overflow, the first of them stored: the sweep keeps the file and a reload over the stored copy can undo', async () => {
        await session.service.whenReady(A)
        session.store.script = ['storeThenUnwritable', 'unwritable']
        session.service.assetDelete(A, 'additionalAssets', [1])
        await settle()
        overflow(session)
        await session.clock.advance(SAVE_DEBOUNCE_MS)
        session.service.assetRename(A, 'additionalAssets', 0, 'smile2')
        expect(await sweepRemoved(session)).toEqual(['assets/orphan.png'])

        const reloaded = open(session.store.shared, session.bytes)
        await reloaded.service.whenReady(A)
        expect(getUncleanablesSync(liveDatabase())).toContain('grin.png')
        expect(reloaded.service.undo(A)).toMatchObject({ ok: true })
        expect(session.bytes.has('assets/grin.png')).toBe(true)
    })

    test('a history save that never ran: the next sweep still keeps the file, the next asset write prunes it, and the sweep after that deletes it', async () => {
        await session.service.whenReady(A)
        session.store.fallback = 'unwritable'
        session.service.assetDelete(A, 'additionalAssets', [1])
        await settle()

        const reloaded = open(session.store.shared, session.bytes)
        await reloaded.service.whenReady(A)
        expect(reloaded.service.view(A).done).toHaveLength(0)
        expect(await sweepRemoved(reloaded)).toEqual(['assets/orphan.png'])

        expect(reloaded.service.assetRename(A, 'additionalAssets', 0, 'smile2').ok).toBe(true)
        expect(await sweepRemoved(reloaded)).toEqual(['assets/grin.png'])
    })

    test('a stored copy trimmed while memory still holds the step keeps the file through the sweep', async () => {
        await session.service.whenReady(A)
        session.service.assetDelete(A, 'additionalAssets', [1])
        session.store.fallback = 'ok'
        session.store.forcedSave = { kind: 'ok', asided: false, trimmed: true }
        await session.clock.advance(SAVE_DEBOUNCE_MS)
        expect(session.service.assetRename(A, 'additionalAssets', 0, 'smile2').ok).toBe(true)
        expect(getUncleanablesSync(liveDatabase())).toContain('grin.png')
        expect(await sweepRemoved(session)).toEqual(['assets/orphan.png'])
    })

    test('a path in a retained list stays in the keep-set after the row is spliced out of the list outside Studio', async () => {
        await session.service.whenReady(A)
        session.service.assetDelete(A, 'additionalAssets', [1])
        expect(session.service.undo(A).ok).toBe(true)
        live().additionalAssets.splice(1, 1)
        expect(getUncleanablesSync(liveDatabase())).toContain('grin.png')
    })
})

describe('a file that is gone before the undo', () => {
    test('the row is not restored and the result names the path; a redo of an insert whose file is gone leaves the row out', async () => {
        session = open(undefined, new Set(FILES), true)
        await session.service.whenReady(A)
        session.service.assetDelete(A, 'additionalAssets', [1])
        session.bytes.delete('assets/grin.png')
        expect(await session.service.replay(A, { kind: 'undo' })).toMatchObject({ ok: true, goneRows: ['assets/grin.png'] })
        expect(live().additionalAssets.map((row) => row[0])).toEqual(['smile'])

        expect(session.service.assetInsert(A, 'additionalAssets', [['fresh', 'assets/fresh.png', 'png']]).ok).toBe(true)
        session.bytes.add('assets/fresh.png')
        expect((await session.service.replay(A, { kind: 'undo' })).ok).toBe(true)
        session.bytes.delete('assets/fresh.png')
        expect(await session.service.replay(A, { kind: 'redo' })).toMatchObject({ ok: true, goneRows: ['assets/fresh.png'] })
        expect(live().additionalAssets.some((row) => row[0] === 'fresh')).toBe(false)
    })
})
