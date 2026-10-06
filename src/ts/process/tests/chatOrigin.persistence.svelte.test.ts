/**
 * Specifies the origin module's `writeAt`: a write on a non-selected
 * character survives encode and decode.
 *
 * Drives the REAL `registerDbChangeEffects`, `RisuSaveEncoder` and
 * `decodeRisuSave` (encode -> decode round trip), following the pattern in
 * `src/ts/plugins/tests/pluginSetDatabaseSaveMarks.svelte.test.ts`. The
 * second test replaces `markCharacterForSave` with a no-op behind a module
 * -level flag that only this test file's own `vi.mock` factory can see; that
 * flag is a scratch device for this test file, never a production option --
 * flipping it is how the test proves the write is lost without it, not how
 * a real caller could ever disable marking.
 *
 * `RisuSaveEncoder` (`../../storage/risuSave`) imports the real
 * `../../storage/database.svelte`, which pulls in the whole app's dependency
 * graph (providers, translator, memory, the plugin API surface), so that
 * module, `../../globalApi.svelte`, `localforage`, `@tauri-apps/plugin-fs`
 * and `../../platform` are replaced with the same minimal stand-ins
 * `src/ts/plugins/tests/pluginSetDatabaseSaveMarks.svelte.test.ts` uses for
 * the same reason, down to the `globalThis.__testDB` bridge that keeps the
 * mocked `getDatabase()` pointed at the same live object as `DBState.db`.
 */
import { flushSync } from 'svelte'
import { describe, test, expect, vi, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database, Chat } from '../../storage/database.svelte'
import type { toSaveType } from '../../storage/risuSave'
import type { ForageLike } from '../../storage/tests/forageBackedStore'

let markingEnabled = true

const memStore = new Map<string, unknown>()

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async (key: string) => memStore.get(key) ?? null),
            setItem: vi.fn(async (key: string, value: unknown) => {
                memStore.set(key, value)
            }),
            removeItem: vi.fn(async (key: string) => {
                memStore.delete(key)
            }),
        }),
    },
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(),
    readFile: vi.fn(),
    BaseDirectory: { AppData: 0 },
}))

vi.mock(import('../../platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('../../platform'))

vi.mock(import('../../globalApi.svelte'), () => ({
    fetchNative: vi.fn(),
    globalFetch: vi.fn(),
    readImage: vi.fn(),
    saveAsset: vi.fn(),
    toGetter: vi.fn((obj: unknown) => obj),
    forageStorage: {
        keys: vi.fn(async () => []),
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => {}),
    },
}) as unknown as typeof import('../../globalApi.svelte'))

vi.mock(import('../../storage/store/appStore'), async () => {
    const { appStoreModuleOver } = await import('../../storage/tests/appStoreMock')
    const { forageStorage } = await import('../../globalApi.svelte')
    return appStoreModuleOver(() => forageStorage as unknown as ForageLike) as unknown as typeof import('../../storage/store/appStore')
})

vi.mock(import('../../storage/database.svelte'), () => ({
    getCurrentCharacter: vi.fn(),
    getDatabase: vi.fn(() => (globalThis as unknown as { __testDB: Database }).__testDB),
    setDatabase: vi.fn(),
    setDatabaseLite: vi.fn(),
    presetTemplate: { name: 'test-preset' },
}) as unknown as typeof import('../../storage/database.svelte'))

vi.mock(import('../../storage/characterSaveMarks'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        markCharacterForSave: (chaId: unknown) => {
            if (markingEnabled) {
                actual.markCharacterForSave(chaId)
            }
        },
    }
})

vi.mock(import('../../stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(-1),
    } as unknown as typeof import('../../stores.svelte')
})

import { DBState, selectedCharID } from '../../stores.svelte'
import { registerDbChangeEffects } from '../../storage/dbChangeEffects.svelte'
import { RisuSaveEncoder, decodeRisuSave } from '../../storage/risuSave'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from '../../storage/characterSaveMarks'
import { writeAt } from '../chatOrigin'

type CharacterFixture = Database['characters'][number]

function makeCharacter(chaId: string, name: string): CharacterFixture {
    return {
        chaId, name, type: 'character', chatPage: 0,
        chats: [{ id: `${chaId}-chat-0`, message: [], note: 'original', name: '', localLore: [] }],
    } as unknown as CharacterFixture
}

function installDb(): void {
    DBState.db = {
        formatversion: 5, botPresetsId: 0, botPresets: [], modules: [], loadouts: [], plugins: [],
        pluginCustomStorage: {}, characterOrder: ['char-0', 'char-1'],
        characters: [makeCharacter('char-0', 'Selected'), makeCharacter('char-1', 'Not selected')],
    } as unknown as Database
    // Read DBState.db back AFTER assignment (Svelte re-proxies on assign), so
    // the mocked getDatabase() above returns the SAME live reactive proxy
    // this file's own reads/writes go through.
    ;(globalThis as unknown as { __testDB: Database }).__testDB = DBState.db
}

function makeTracker(): toSaveType {
    return { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
}

function snapshotDb(db: Database): Database {
    return $state.snapshot(db) as Database
}

async function wireRealSaveMachinery() {
    selectedCharID.set(0)
    const tracker = makeTracker()
    const markChanged = vi.fn()
    const cleanup = $effect.root(() => {
        registerDbChangeEffects({ tracker, markChanged })
    })
    flushSync()
    installCharacterSaveMarks({ tracker, schedule: () => {} })

    const encoder = new RisuSaveEncoder()
    await encoder.init(snapshotDb(DBState.db), { compression: false })
    tracker.character = tracker.character.length === 0 ? [] : [tracker.character[0]]

    return { tracker, encoder, cleanup }
}

afterEach(() => {
    resetCharacterSaveMarksForTest()
    markingEnabled = true
})

// Specification: the origin module has no earlier version to fail against,
// so these tests pin its contract rather than prove a fix.
describe('writeAt on a non-selected character survives encode and decode', () => {
    test('an in-place write through writeAt on a non-selected character is present after encode and decode', async () => {
        installDb()
        const { tracker, encoder, cleanup } = await wireRealSaveMachinery()

        const origin = { chaId: 'char-1', chatId: 'char-1-chat-0' }
        expect(writeAt(origin, (ctx) => { ctx.chat.note = 'written by writeAt' })).toBe(true)
        flushSync()

        const toSave = structuredClone(tracker) as toSaveType
        await encoder.set(snapshotDb(DBState.db), toSave)
        const decoded = await decodeRisuSave(new Uint8Array(encoder.encode()!))
        const decodedChar1 = decoded.characters?.find((c: CharacterFixture) => (c as { chaId: string }).chaId === 'char-1')

        expect((decodedChar1 as unknown as { chats: Chat[] } | undefined)?.chats[0].note).toBe('written by writeAt')

        cleanup()
    })

    test('with marking disabled by the test-only mock toggle, the same write is lost', async () => {
        installDb()
        const { tracker, encoder, cleanup } = await wireRealSaveMachinery()
        markingEnabled = false

        const origin = { chaId: 'char-1', chatId: 'char-1-chat-0' }
        expect(writeAt(origin, (ctx) => { ctx.chat.note = 'written by writeAt' })).toBe(true)
        flushSync()

        const toSave = structuredClone(tracker) as toSaveType
        await encoder.set(snapshotDb(DBState.db), toSave)
        const decoded = await decodeRisuSave(new Uint8Array(encoder.encode()!))
        const decodedChar1 = decoded.characters?.find((c: CharacterFixture) => (c as { chaId: string }).chaId === 'char-1')

        expect((decodedChar1 as unknown as { chats: Chat[] } | undefined)?.chats[0].note).not.toBe('written by writeAt')

        cleanup()
    })
})
