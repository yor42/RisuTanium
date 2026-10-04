/**
 * Report 17 ("CHORE-01 + Phase 2 item 2") Stage 1:
 *
 * S1: `restoreCharacterFromTrash` (extracted from GridCatalog.svelte's trash
 * restore button, `src/ts/characters.ts`) on a NON-selected character, driven
 * through the REAL `registerDbChangeEffects` and the REAL `RisuSaveEncoder`,
 * end to end (encode -> mutate -> encode -> decode). The restore must survive
 * the save: trashTime is cleared after decode.
 *
 * S8 (second half): "removeChar still sets requiresFullEncoderReload" --
 * a guard that the invariant shared by all four call sites that flip
 * `requiresFullEncoderReload.state` to true still holds for the real,
 * unmodified `removeChar`.
 *
 * This file drives the REAL `src/ts/characters.ts` (unmodified for this
 * plan's purposes other than the new `restoreCharacterFromTrash` export) and
 * the REAL `characterSaveMarks.ts` / `dbChangeEffects.svelte.ts` /
 * `risuSave.ts`. Every other module `characters.ts` imports is mocked below,
 * following the pattern in `src/ts/globalApiFileCacheAv3.svelte.test.ts` and
 * `src/ts/process/tests/sendChatColdGuard.svelte.test.ts`.
 */
import { flushSync } from 'svelte'
import { writable } from 'svelte/store'
import { describe, test, expect, vi } from 'vitest'
import type { Database } from './storage/database.svelte'
import type { toSaveType } from './storage/risuSave'

//#region module mocks

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

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(),
    readFile: vi.fn(),
    BaseDirectory: { AppData: 0 },
}))

// dbChangeEffects.svelte.ts reaches into DBState/selectedCharID from
// stores.svelte, which transitively re-exports the app's whole dependency
// graph. Replace it with a minimal, genuinely reactive ($state-backed)
// stand-in, matching dbChangeEffects.svelte.test.ts's own mock.
vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(-1),
        CharEmotion: writable({}),
        MobileGUIStack: writable([]),
        OpenRealmStore: writable(null),
    } as unknown as typeof import('src/ts/stores.svelte')
})

const requiresFullEncoderReloadMock = vi.hoisted(() => ({ state: false }))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    AppendableBuffer: class {},
    changeChatTo: vi.fn(),
    checkCharOrder: vi.fn(),
    downloadFile: vi.fn(),
    getFileSrc: vi.fn(),
    requiresFullEncoderReload: requiresFullEncoderReloadMock,
    forageStorage: {
        keys: vi.fn(async () => []),
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => {}),
    },
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/alert'), () => ({
    alertAddCharacter: vi.fn(),
    alertConfirm: vi.fn(async () => true),
    alertError: vi.fn(),
    alertNormal: vi.fn(),
    alertSelect: vi.fn(),
    alertStore: writable({ type: 'none', msg: '' }),
    alertWait: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => (globalThis as unknown as { __testDBState: Database }).__testDBState),
    setDatabase: vi.fn(),
    presetTemplate: { name: 'test-preset' },
    saveImage: vi.fn(),
    defaultSdDataFunc: vi.fn(() => ({})),
    getCharacterByIndex: vi.fn(),
    setCharacterByIndex: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

// findCharacterIndexbyId/findCharacterbyId here are real-shaped re-implementations
// (not the app's own real util.ts, which is heavy and would pull in Tauri
// dialogs, PopupList.svelte, etc.) -- they mirror util.ts's own
// findCharacterIndexbyId/findCharacterbyId exactly (a linear scan over
// db.characters by chaId), reading through the same
// mocked getDatabase() above so this test still exercises the real "resolve
// id -> index" contract restoreCharacterFromTrash and removeChar depend on.
vi.mock(import('src/ts/util'), () => ({
    checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
    findCharacterbyId: vi.fn((id: string) => {
        const db = (globalThis as unknown as { __testDBState: Database }).__testDBState
        return db.characters.find((c: { chaId: string }) => c.chaId === id)
    }),
    findCharacterIndexbyId: vi.fn((id: string) => {
        const db = (globalThis as unknown as { __testDBState: Database }).__testDBState
        return db.characters.findIndex((c: { chaId: string }) => c.chaId === id)
    }),
    getUserName: vi.fn(() => 'User'),
    selectMultipleFile: vi.fn(),
    selectSingleFile: vi.fn(),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/media'), () => ({
    getImageType: vi.fn(),
}) as unknown as typeof import('src/ts/media'))

vi.mock(import('src/ts/process/inlayScreen'), () => ({
    updateInlayScreen: vi.fn(),
}) as unknown as typeof import('src/ts/process/inlayScreen'))

vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    parseMarkdownSafe: vi.fn(),
    hasher: vi.fn((s: string) => s),
}) as unknown as typeof import('src/ts/parser/parser.svelte'))

vi.mock(import('src/ts/translator/translator'), () => ({
    translateHTML: vi.fn(),
}) as unknown as typeof import('src/ts/translator/translator'))

vi.mock(import('src/ts/process/index.svelte'), () => ({
    doingChat: writable(false),
}) as unknown as typeof import('src/ts/process/index.svelte'))

vi.mock(import('src/ts/characterCards'), () => ({
    importCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock(import('src/ts/pngChunk'), () => ({
    PngChunk: class {},
}) as unknown as typeof import('src/ts/pngChunk'))

vi.mock(import('src/ts/process/coldstorage.svelte'), () => ({
    getColdStorageItem: vi.fn(),
}) as unknown as typeof import('src/ts/process/coldstorage.svelte'))

vi.mock(import('src/ts/media/avatarThumb'), () => ({
    getAvatarThumbSrc: vi.fn(),
    isThumbEligible: vi.fn(() => false),
}) as unknown as typeof import('src/ts/media/avatarThumb'))

//#endregion

import { DBState, selectedCharID } from 'src/ts/stores.svelte'
import { requiresFullEncoderReload } from 'src/ts/globalApi.svelte'
import { registerDbChangeEffects } from './storage/dbChangeEffects.svelte'
import { RisuSaveEncoder, decodeRisuSave } from './storage/risuSave'
import { restoreCharacterFromTrash, removeChar, addCharEmotion } from './characters'
import { selectMultipleFile } from 'src/ts/util'
import { saveImage } from 'src/ts/storage/database.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from './storage/characterSaveMarks'

//#region fixture helpers

type CharacterFixture = Database['characters'][number]

function makeCharacter(chaId: string, name: string, trashTime?: number): CharacterFixture {
    return {
        chaId,
        name,
        type: 'character',
        chatPage: 0,
        chats: [{ id: `${chaId}-chat-0`, message: [], note: '', name: '', localLore: [] }],
        trashTime,
    } as unknown as CharacterFixture
}

function installDb(): void {
    DBState.db = {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        characterOrder: ['char-A', 'char-B'],
        characters: [
            makeCharacter('char-A', 'Character A'),
            makeCharacter('char-B', 'Character B (starts trashed)', 1_700_000_000_000),
        ],
    } as unknown as Database
    ;(globalThis as unknown as { __testDBState: Database }).__testDBState = DBState.db
}

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

function snapshotDb(db: Database): Database {
    return $state.snapshot(db) as Database
}

//#endregion

describe('restoreCharacterFromTrash on a non-selected character', () => {
    test('a real restore of a NON-selected character, saved through the real effects + encoder, clears trashTime on decode', async () => {
        installDb()
        selectedCharID.set(0) // char-A selected; char-B (the one we restore) is NOT selected

        const tracker = makeTracker()
        const markChanged = vi.fn()
        const cleanup = $effect.root(() => {
            registerDbChangeEffects({ tracker, markChanged })
        })
        flushSync()
        expect(tracker.character[0]).toBe('char-A') // sanity: effect 6 is wired to the real, live DBState/selectedCharID

        // Initial encode: blocks exist for both characters, char-B still trashed.
        const encoder = new RisuSaveEncoder()
        await encoder.init(snapshotDb(DBState.db), { compression: false })
        const firstDecoded = await decodeRisuSave(new Uint8Array(encoder.encode()!))
        expect(firstDecoded.characters?.find((c: CharacterFixture) => c.chaId === 'char-B')?.trashTime).toBe(1_700_000_000_000)

        // Mirrors saveDb()'s post-init trim (globalApi.svelte.ts) -- the front id is sticky.
        tracker.character = tracker.character.length === 0 ? [] : [tracker.character[0]]
        markChanged.mockClear()

        // Production wiring (globalApi.svelte.ts's saveDb()): the module-global
        // characterSaveMarks tracker IS the same live changeTracker the effects
        // above write into. Install it here so restoreCharacterFromTrash's
        // markCharacterForSave() call lands in the same tracker this test reads.
        installCharacterSaveMarks({ tracker, schedule: () => {} })

        // THE REAL FUNCTION UNDER TEST -- restoring char-B without ever selecting it.
        restoreCharacterFromTrash('char-B')
        flushSync()

        expect(DBState.db.characters[1].trashTime).toBeUndefined()

        const toSave = structuredClone(tracker) as toSaveType
        // The mark must actually have entered the tracker for this to matter.
        expect(toSave.character).toContain('char-B')

        await encoder.set(snapshotDb(DBState.db), toSave)
        const secondDecoded = await decodeRisuSave(new Uint8Array(encoder.encode()!))
        const decodedB = secondDecoded.characters?.find((c: CharacterFixture) => c.chaId === 'char-B')
        const decodedA = secondDecoded.characters?.find((c: CharacterFixture) => c.chaId === 'char-A')

        expect(decodedB).toBeTruthy()
        expect(decodedB!.trashTime).toBeUndefined()
        expect(decodedA).toBeTruthy() // char-A (selected, unrelated) survives untouched

        cleanup()
        resetCharacterSaveMarksForTest()
    })
})

describe('removeChar with nothing selected requests a save', () => {
    function watchSaveRequests() {
        installDb()
        // A trashed character is not listed in the order, as `checkCharOrder` leaves it.
        DBState.db.characterOrder = ['char-A']
        selectedCharID.set(-1)
        requiresFullEncoderReloadMock.state = false
        const tracker = makeTracker()
        const markChanged = vi.fn()
        const schedule = vi.fn()
        const cleanup = $effect.root(() => {
            registerDbChangeEffects({ tracker, markChanged })
        })
        flushSync()
        installCharacterSaveMarks({ tracker, schedule })
        markChanged.mockClear()
        schedule.mockClear()
        return {
            requests: () => markChanged.mock.calls.length + schedule.mock.calls.length,
            stop: () => {
                cleanup()
                resetCharacterSaveMarksForTest()
            },
        }
    }

    test('a permanent delete of an already-trashed character is scheduled for saving', async () => {
        const watch = watchSaveRequests()

        await removeChar('char-B', 'Character B', 'permanentForce')
        flushSync()

        expect(DBState.db.characters.find((c: { chaId: string }) => c.chaId === 'char-B')).toBeUndefined()
        expect(watch.requests()).toBeGreaterThan(0)
        watch.stop()
    })

    test('guard: moving a non-selected character to the trash is scheduled for saving', async () => {
        const watch = watchSaveRequests()

        await removeChar('char-A', 'Character A', 'normal')
        flushSync()

        expect(DBState.db.characters[0].trashTime).toBeTypeOf('number')
        expect(watch.requests()).toBeGreaterThan(0)
        watch.stop()
    })
})

describe('addCharEmotion on a character that is not selected when its files land', () => {
    test('marks that character for saving', async () => {
        installDb()
        ;(DBState.db.characters[0] as unknown as { emotionImages: unknown[] }).emotionImages = []
        selectedCharID.set(1)
        vi.mocked(selectMultipleFile).mockResolvedValueOnce([{ name: 'smile.png', data: new Uint8Array([1]) }])
        vi.mocked(saveImage).mockResolvedValueOnce('assets/smile.png')
        const tracker = makeTracker()
        const schedule = vi.fn()
        installCharacterSaveMarks({ tracker, schedule })

        await addCharEmotion(0)

        expect((DBState.db.characters[0] as unknown as { emotionImages: unknown[] }).emotionImages).toEqual([['smile', 'assets/smile.png']])
        expect(tracker.character).toContain('char-A')
        expect(schedule).toHaveBeenCalled()
        resetCharacterSaveMarksForTest()
    })
})

describe('removeChar (guard): still sets requiresFullEncoderReload', () => {
    test('a permanent removal still flips requiresFullEncoderReload.state to true', async () => {
        installDb()
        selectedCharID.set(0)
        requiresFullEncoderReload.state = false

        await removeChar('char-B', 'Character B', 'permanentForce')

        expect(requiresFullEncoderReload.state).toBe(true)
        expect(DBState.db.characters.find((c: { chaId: string }) => c.chaId === 'char-B')).toBeUndefined()
    })

    /**
     * removeChar must actually remove the character: it sets
     * requiresFullEncoderReload, so the reload path encodes without it, and
     * after save and decode the character is gone. This holds unconditionally
     * because removeChar deletes via requiresFullEncoderReload's FULL re-init
     * from the current db, not via a stale mark/deletion-branch race -- that
     * race is the separate plugin setDatabase case covered in
     * pluginSetDatabaseSaveMarks.svelte.test.ts.
     */
    test('guard: a permanent removal survives a real full-reload re-encode + save + decode round trip', async () => {
        installDb()
        selectedCharID.set(0)
        requiresFullEncoderReload.state = false

        // Initial encode with both characters present.
        const encoder = new RisuSaveEncoder()
        await encoder.init(snapshotDb(DBState.db), { compression: false })
        const beforeDecoded = await decodeRisuSave(new Uint8Array(encoder.encode()!))
        expect(beforeDecoded.characters?.find((c: CharacterFixture) => c.chaId === 'char-B')).toBeTruthy()

        await removeChar('char-B', 'Character B', 'permanentForce')
        expect(requiresFullEncoderReload.state).toBe(true)

        // The reload path (globalApi.svelte.ts's saveDb(), extracted into
        // prepareSaveIteration()) re-inits a FRESH encoder from the CURRENT db
        // whenever requiresFullEncoderReload.state is true, instead of reusing
        // the stale one above -- char-B is simply absent from data.characters
        // by the time this init() runs, so it's never (re-)encoded at all.
        const reloadedEncoder = new RisuSaveEncoder()
        await reloadedEncoder.init(snapshotDb(DBState.db), { compression: false })
        const decoded = await decodeRisuSave(new Uint8Array(reloadedEncoder.encode()!))

        expect(decoded.characters?.find((c: CharacterFixture) => c.chaId === 'char-B')).toBeUndefined()
        expect(decoded.characters?.find((c: CharacterFixture) => c.chaId === 'char-A')).toBeTruthy()
    })
})
