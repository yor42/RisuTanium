/**
 * Unsent message edits and the character and chat removal paths (#272 S3): `removeChatConfirmed` in both modes drops that
 * chat's entry and pending overlay at once; a permanent delete, a forced delete and an emptied trash drop the entries of the
 * removed characters at once; a trashed character keeps its entries until it is deleted for good and a restore from the trash
 * finds them again. Drives the REAL `characters.ts` and the real draft store against a real `$state` database; the other
 * modules `characters.ts` imports are mocked purely so it loads (the set of `characters.removeCharPermanentRestored`), and
 * the alert confirm answers yes. Synthetic data only.
 */
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from './storage/database.svelte'

//#region module mocks

const stopped = vi.hoisted(() => [] as string[])

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
}) as unknown as typeof import('src/ts/platform'))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(),
    readFile: vi.fn(),
    BaseDirectory: { AppData: 0 },
}))

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

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    AppendableBuffer: class {},
    changeChatTo: vi.fn(),
    checkCharOrder: vi.fn(),
    downloadFile: vi.fn(),
    getFileSrc: vi.fn(),
    requiresFullEncoderReload: { state: false },
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

vi.mock(import('src/ts/process/chatOrigin'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        hasWorkIn: vi.fn(() => false),
        stopWorkIn: vi.fn((scope: { chaId: string }) => { stopped.push(scope.chaId) }),
    }
})

//#endregion

import { DBState, selectedCharID } from 'src/ts/stores.svelte'
import { draftContentOrphanGate } from 'src/ts/draftContentOrphanGate'
import { flushChatDrafts, lookupPersistedEditDraft } from 'src/ts/chatDraftStore'
import type { MessageIdentity } from 'src/ts/draftContents'
import { removeChar, removeChatConfirmed, removeTrashedCharacters, restoreCharacterFromTrash } from './characters'

//#region fixtures and helpers

type CharacterFixture = Database['characters'][number]

function makeCharacter(chaId: string, name: string, trashTime?: number): CharacterFixture {
    return {
        chaId, name, type: 'character', chatPage: 0,
        chats: [0, 1].map((index) => ({ id: `${chaId}-chat-${index}`, message: [], note: '', name: '', localLore: [] })),
        trashTime,
    } as unknown as CharacterFixture
}

const TRASHED_AT = 1_700_000_000_000
const NOW = 1_700_000_100_000

function entry(cha: string, chat: string) {
    return { cha, chat, drafts: [{ m: 'id:m1', text: `draft of ${cha}/${chat}`, bh: 'a'.repeat(32), at: 1 }] }
}

function installDb(): void {
    DBState.db = {
        formatversion: 5, botPresetsId: 0, botPresets: [], modules: [], loadouts: [], plugins: [],
        pluginCustomStorage: {}, characterOrder: ['live', 'trashed'],
        characters: [makeCharacter('live', 'Live'), makeCharacter('trashed', 'Trashed', TRASHED_AT)],
        chatDrafts: [entry('live', 'live-chat-0'), entry('live', 'live-chat-1'), entry('trashed', 'trashed-chat-0')],
    } as unknown as Database
    ;(globalThis as unknown as { __testDBState: Database }).__testDBState = DBState.db
    selectedCharID.set(0)
}

const held = (): string[] => (DBState.db.chatDrafts ?? []).map((one) => `${one.cha}/${one.chat}`)

function identityOf(cha: string, chat: string, key = 'm1'): MessageIdentity {
    return { kind: 'msg', chatKey: 'window', chatId: key, index: 0, persist: { chaId: cha, chatId: chat } }
}

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    vi.setSystemTime(NOW)
    draftContentOrphanGate.clear()
    installDb()
})
afterEach(() => {
    vi.useRealTimers()
})

//#endregion

describe('T3.8 deleting a chat', () => {
    test.each([['the default removal', undefined], ['the keep-current removal', { keepCurrent: true }]] as const)('%s removes that chat\'s entry at once and no other', async (_name, options) => {
        const owner = DBState.db.characters[0]

        expect(await removeChatConfirmed(owner, owner.chats[1], async () => true, options)).toBe(true)

        expect(held()).toEqual(['live/live-chat-0', 'trashed/trashed-chat-0'])
    })

    test.each([['the default removal', undefined], ['the keep-current removal', { keepCurrent: true }]] as const)('%s drops the chat\'s pending overlay, so a later idle flush does not add it back', async (_name, options) => {
        const owner = DBState.db.characters[0]
        draftContentOrphanGate.set(identityOf('live', 'live-chat-1', 'm2'), 'typed just before the delete', 'base')

        await removeChatConfirmed(owner, owner.chats[1], async () => true, options)
        vi.advanceTimersByTime(10_000)

        expect(held()).toEqual(['live/live-chat-0', 'trashed/trashed-chat-0'])
    })
})

describe('T3.13 removing and restoring characters', () => {
    test('moving a character to the trash keeps its entries', async () => {
        await removeChar(DBState.db.characters[0], 'Live', 'normal')

        expect(held()).toEqual(['live/live-chat-0', 'live/live-chat-1', 'trashed/trashed-chat-0'])
    })

    test.each([['permanent'], ['permanentForce']] as const)('%s removes the removed character\'s entries at once and keeps the others', async (type) => {
        await removeChar(DBState.db.characters[1], 'Trashed', type)

        expect(held()).toEqual(['live/live-chat-0', 'live/live-chat-1'])
    })

    test('emptying the trash removes the entries of the removed characters', async () => {
        await removeTrashedCharacters([DBState.db.characters[1]], { matching: false })

        expect(held()).toEqual(['live/live-chat-0', 'live/live-chat-1'])
    })

    test('a character trashed and restored finds its draft again on Edit', async () => {
        const owner = DBState.db.characters[0]
        const identity = identityOf('live', 'live-chat-0')
        draftContentOrphanGate.set(identity, 'typed', 'the saved text')
        flushChatDrafts()

        await removeChar(owner, 'Live', 'normal')
        restoreCharacterFromTrash(owner)

        expect(lookupPersistedEditDraft(identity, 'the saved text')).toEqual({ text: 'typed', baseData: 'the saved text', updatedAt: NOW })
    })
})
