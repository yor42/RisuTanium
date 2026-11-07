/**
 * `removeChatConfirmed` with `{ keepCurrent: true }` (the new shell's sidebar delete): which chat is open after the
 * removal. Drives the REAL `src/ts/characters.ts` and the real `chatOpen.ts`; the modules that would pull in the app
 * graph are replaced, following `removeChatConfirmed.confirm.svelte.test.ts`. Synthetic data only.
 *
 * Invariants exercised here:
 * - Deleting another chat leaves the open chat open: `chatPage` follows it by identity and nothing reloads (no
 *   `changeChatTo`).
 * - Deleting the open chat opens the most recent remaining chat through the one open seam.
 * - A confirm answered after the selection moved never writes the newly selected character: the removed chat's owner
 *   keeps its own `chatPage`, the selected character's `chatPage` is untouched, and no chat is opened.
 * - Work in the chat is stopped before the splice, in the same synchronous stretch, and the owner is marked after it.
 *
 * Fixtures: the delete tests keep the expected landing chat away from index 0 after the splice and away from the chat
 * that slides into the unchanged `chatPage`, so a "land at 0" or "keep the old index" mutant cannot pass by accident.
 */
import { writable } from 'svelte/store'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'

//#region module mocks

const h = vi.hoisted(() => ({
    stopped: [] as { chaId: string, chatId: string, length: number }[],
    marked: [] as { chaId: string, length: number }[],
    changed: [] as number[],
    db: null as null | { characters: { chaId: string, chats: unknown[] }[] },
}))

vi.mock('localforage', () => ({
    default: { createInstance: () => ({ getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}) }) },
}))

vi.mock(import('src/ts/platform'), () => ({ isTauri: false, isNodeServer: false }) as unknown as typeof import('src/ts/platform'))

vi.mock('@tauri-apps/plugin-fs', () => ({ writeFile: vi.fn(), exists: vi.fn(async () => false), mkdir: vi.fn(), readFile: vi.fn(), BaseDirectory: { AppData: 0 } }))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Record<string, unknown> })
    const selectedCharID = writable(-1)
    const selIdState = $state({ selId: -1 })
    selectedCharID.subscribe((v) => { selIdState.selId = v })
    return {
        DBState: state,
        selectedCharID,
        selIdState,
        CharEmotion: writable({}),
        MobileGUIStack: writable([]),
        OpenRealmStore: writable(null),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/globalApi.svelte'), async () => {
    const { DBState, selIdState } = await import('src/ts/stores.svelte')
    return {
        AppendableBuffer: class {},
        changeChatTo: vi.fn((i: number) => {
            h.changed.push(i)
            ;(DBState.db as unknown as Database).characters[selIdState.selId].chatPage = i
        }),
        checkCharOrder: vi.fn(),
        downloadFile: vi.fn(),
        getFileSrc: vi.fn(),
        requiresFullEncoderReload: { state: false },
        pickedAssetLimitBytes: vi.fn(async () => 1024 * 1024),
        forageStorage: { keys: vi.fn(async () => []), getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}) },
    } as unknown as typeof import('src/ts/globalApi.svelte')
})

vi.mock(import('src/ts/alert'), () => ({
    alertAddCharacter: vi.fn(),
    alertConfirm: vi.fn(async (_text: string) => true),
    alertError: vi.fn(),
    alertNormal: vi.fn(),
    alertSelect: vi.fn(),
    alertStore: writable({ type: 'none', msg: '' }),
    alertWait: vi.fn(),
    alertClear: vi.fn(),
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

vi.mock(import('src/ts/util'), () => ({
    checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
    findCharacterbyId: vi.fn(),
    findCharacterIndexbyId: vi.fn(),
    getUserName: vi.fn(() => 'User'),
    selectMultipleFile: vi.fn(),
    selectMultipleFileObjects: vi.fn(),
    readPickedFileBytes: vi.fn(async () => new Uint8Array([1])),
    selectSingleFile: vi.fn(),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/media'), () => ({ getImageType: vi.fn() }) as unknown as typeof import('src/ts/media'))
vi.mock(import('src/ts/process/inlayScreen'), () => ({ updateInlayScreen: vi.fn() }) as unknown as typeof import('src/ts/process/inlayScreen'))
vi.mock(import('src/ts/parser/parser.svelte'), () => ({ parseMarkdownSafe: vi.fn(), hasher: vi.fn((s: string) => s) }) as unknown as typeof import('src/ts/parser/parser.svelte'))
vi.mock(import('src/ts/translator/translator'), () => ({ translateHTML: vi.fn() }) as unknown as typeof import('src/ts/translator/translator'))
vi.mock(import('src/ts/process/index.svelte'), () => ({ doingChat: writable(false) }) as unknown as typeof import('src/ts/process/index.svelte'))
vi.mock(import('src/ts/characterCards'), () => ({ importCharacter: vi.fn() }) as unknown as typeof import('src/ts/characterCards'))
vi.mock(import('src/ts/pngChunk'), () => ({ PngChunk: class {} }) as unknown as typeof import('src/ts/pngChunk'))
vi.mock(import('src/ts/process/coldstorage.svelte'), () => ({ getColdStorageItem: vi.fn() }) as unknown as typeof import('src/ts/process/coldstorage.svelte'))
vi.mock(import('src/ts/media/avatarThumb'), () => ({ getAvatarThumbSrc: vi.fn(), isThumbEligible: vi.fn(() => false) }) as unknown as typeof import('src/ts/media/avatarThumb'))

vi.mock('src/ts/process/chatOrigin', async (importOriginal) => ({
    ...(await importOriginal<typeof import('src/ts/process/chatOrigin')>()),
    hasWorkIn: vi.fn(() => false),
    stopWorkIn: vi.fn((origin: { chaId: string, chatId: string }) => {
        const owner = (h.db?.characters ?? []).find((c) => c.chaId === origin.chaId)
        h.stopped.push({ ...origin, length: owner?.chats.length ?? -1 })
    }),
}))

vi.mock('src/ts/process/files/inlayCleanup', async (importOriginal) => ({
    ...(await importOriginal<typeof import('src/ts/process/files/inlayCleanup')>()),
    queueInlayCleanupForChat: vi.fn(),
}))

vi.mock('src/ts/storage/characterSaveMarks', async (importOriginal) => ({
    ...(await importOriginal<typeof import('src/ts/storage/characterSaveMarks')>()),
    markCharacterForSave: vi.fn((chaId: string) => {
        const owner = (h.db?.characters ?? []).find((c) => c.chaId === chaId)
        h.marked.push({ chaId, length: owner?.chats.length ?? -1 })
    }),
}))

//#endregion

import { DBState, selectedCharID, selIdState } from 'src/ts/stores.svelte'
import { removeChatConfirmed } from 'src/ts/characters'
import type { Chat } from 'src/ts/storage/database.svelte'

type OwnerFixture = Parameters<typeof removeChatConfirmed>[0]

// A chat whose last message carries `time`: the recency order of the sidebar.
function chat(id: string, time: number): Chat {
    return { id, name: `Chat ${id}`, message: [{ role: 'char', data: `${id} says hello`, time }], note: '', localLore: [] } as unknown as Chat
}

function install(...owners: { chaId: string, chats: Chat[], chatPage: number }[]): OwnerFixture[] {
    DBState.db = { characters: owners.map((o) => ({ type: 'character', name: o.chaId, ...o })), characterOrder: owners.map((o) => o.chaId) } as unknown as Database
    ;(globalThis as unknown as { __testDBState: Database }).__testDBState = DBState.db
    h.db = DBState.db as unknown as typeof h.db
    return DBState.db.characters as unknown as OwnerFixture[]
}

const keepCurrent = { keepCurrent: true }

beforeEach(() => {
    h.stopped.length = 0
    h.marked.length = 0
    h.changed.length = 0
    selectedCharID.set(-1)
})

describe('the selection mirror', () => {
    test('diagnostic: the mirror follows the store', () => {
        selectedCharID.set(1)
        expect(selIdState.selId).toBe(1)
    })
})

describe('removeChatConfirmed with keepCurrent: the selected owner', () => {
    // TD1: three chats, the third is open, the first is deleted; it lands on the open chat's new index with no reload.
    test('deleting another chat keeps the open chat open, without a reload', async () => {
        const [A] = install({ chaId: 'A', chats: [chat('a0', 10), chat('a1', 20), chat('a2', 30)], chatPage: 2 })
        selectedCharID.set(0)
        const open = A.chats[2]
        expect(await removeChatConfirmed(A, A.chats[0], async () => true, keepCurrent)).toBe(true)
        expect(A.chats).toHaveLength(2)
        expect(A.chats[A.chatPage]).toBe(open)
        expect(A.chatPage).toBe(1)
        expect(h.changed).toEqual([])
    })

    // TD2: the open chat is deleted; the most recent remaining chat opens through the one open call.
    test('deleting the open chat opens the most recent remaining chat', async () => {
        const [A] = install({ chaId: 'A', chats: [chat('a0', 10), chat('a1', 20), chat('a2', 50)], chatPage: 0 })
        selectedCharID.set(0)
        const newest = A.chats[2]
        expect(await removeChatConfirmed(A, A.chats[0], async () => true, keepCurrent)).toBe(true)
        expect(h.changed).toEqual([1])
        expect(A.chats[A.chatPage]).toBe(newest)
    })

    // A chat that has no messages is the newest one (the user just made it).
    test('an empty remaining chat counts as the most recent', async () => {
        const empty = { id: 'e', name: 'Empty', message: [], note: '', localLore: [] } as unknown as Chat
        const [A] = install({ chaId: 'A', chats: [chat('a0', 10), chat('a1', 90), empty], chatPage: 0 })
        selectedCharID.set(0)
        const target = A.chats[2]
        await removeChatConfirmed(A, A.chats[0], async () => true, keepCurrent)
        expect(A.chats[A.chatPage]).toBe(target)
    })

    // A `chatPage` past the end is treated like the open chat being deleted: the seam never runs for `undefined`.
    test('a stale chatPage past the end lands on the most recent remaining chat', async () => {
        const [A] = install({ chaId: 'A', chats: [chat('a0', 10), chat('a1', 20), chat('a2', 50)], chatPage: 5 })
        selectedCharID.set(0)
        const newest = A.chats[2]
        expect(await removeChatConfirmed(A, A.chats[0], async () => true, keepCurrent)).toBe(true)
        expect(A.chats[A.chatPage]).toBe(newest)
        expect(h.changed).toEqual([1])
    })
})

describe('removeChatConfirmed with keepCurrent: the selection moved while the confirm was open', () => {
    // TD11 (i): a confirm answered after `set(B)`; the other chat of A is deleted.
    test('deleting another chat of A keeps A\'s open chat and leaves B alone', async () => {
        const [A, B] = install(
            { chaId: 'A', chats: [chat('a0', 10), chat('a1', 20), chat('a2', 30)], chatPage: 2 },
            { chaId: 'B', chats: [chat('b0', 10), chat('b1', 20)], chatPage: 1 },
        )
        selectedCharID.set(0)
        const open = A.chats[2]
        const victim = A.chats[0]
        const removed = removeChatConfirmed(A, victim, async () => {
            selectedCharID.set(1)
            return true
        }, keepCurrent)
        expect(await removed).toBe(true)
        expect(A.chats).toHaveLength(2)
        expect(A.chats[A.chatPage]).toBe(open)
        expect(B.chatPage).toBe(1)
        expect(h.changed).toEqual([])
        expect(h.marked.map((m) => m.chaId)).toEqual(['A'])
    })

    // TD11 (ii): the open chat of A is deleted after `set(B)`; A's page follows the most recent remaining chat only.
    test('deleting A\'s open chat points A at the most recent remaining chat and leaves B alone', async () => {
        const [A, B] = install(
            { chaId: 'A', chats: [chat('a0', 90), chat('a1', 20), chat('a2', 30)], chatPage: 1 },
            { chaId: 'B', chats: [chat('b0', 10), chat('b1', 20)], chatPage: 1 },
        )
        selectedCharID.set(0)
        const newest = A.chats[0]
        const victim = A.chats[1]
        const removed = removeChatConfirmed(A, victim, async () => {
            selectedCharID.set(1)
            return true
        }, keepCurrent)
        expect(await removed).toBe(true)
        expect(A.chats[A.chatPage]).toBe(newest)
        expect(A.chatPage).toBe(0)
        expect(B.chatPage).toBe(1)
        expect(h.changed).toEqual([])
        expect(h.marked.map((m) => m.chaId)).toEqual(['A'])
    })

    test('a character that is not selected at all is handled the same way', async () => {
        const [A, B] = install(
            { chaId: 'A', chats: [chat('a0', 10), chat('a1', 20), chat('a2', 30)], chatPage: 2 },
            { chaId: 'B', chats: [chat('b0', 10), chat('b1', 20)], chatPage: 1 },
        )
        selectedCharID.set(1)
        const open = A.chats[2]
        await removeChatConfirmed(A, A.chats[0], async () => true, keepCurrent)
        expect(A.chats[A.chatPage]).toBe(open)
        expect(B.chatPage).toBe(1)
        expect(h.changed).toEqual([])
    })
})

describe('removeChatConfirmed with keepCurrent: stop, splice, mark', () => {
    // TD4: work in the chat ends while the chat is still in the list; the owner is marked after the splice.
    test('the work is stopped before the splice and the owner is marked after it', async () => {
        const [A] = install({ chaId: 'A', chats: [chat('a0', 10), chat('a1', 20), chat('a2', 30)], chatPage: 2 })
        selectedCharID.set(0)
        await removeChatConfirmed(A, A.chats[0], async () => true, keepCurrent)
        expect(h.stopped).toEqual([{ chaId: 'A', chatId: 'a0', length: 3 }])
        expect(h.marked).toEqual([{ chaId: 'A', length: 2 }])
    })

    test('a declined confirm removes nothing and stops nothing', async () => {
        const [A] = install({ chaId: 'A', chats: [chat('a0', 10), chat('a1', 20)], chatPage: 1 })
        selectedCharID.set(0)
        expect(await removeChatConfirmed(A, A.chats[0], async () => false, keepCurrent)).toBe(false)
        expect(A.chats).toHaveLength(2)
        expect(A.chatPage).toBe(1)
        expect(h.stopped).toEqual([])
        expect(h.marked).toEqual([])
        expect(h.changed).toEqual([])
    })
})
