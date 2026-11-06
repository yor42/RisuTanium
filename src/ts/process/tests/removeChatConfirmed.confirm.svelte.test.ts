/**
 * `removeChatConfirmed` with an injected confirmation (the This-chat sheet's delete confirm) and with the default one
 * (`alertConfirm`, used by the chat lists). Drives the REAL `src/ts/characters.ts`; every module it imports that would pull
 * in the app graph is replaced, following `characters.saveMarks.svelte.test.ts`. Synthetic data only.
 */
import { writable } from 'svelte/store'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'

//#region module mocks

const h = vi.hoisted(() => ({
    working: false,
    stopped: [] as { chaId: string, chatId: string }[],
    marked: [] as string[],
    inlayQueued: [] as unknown[],
    order: [] as string[],
}))

vi.mock('localforage', () => ({
    default: { createInstance: () => ({ getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}) }) },
}))

vi.mock(import('src/ts/platform'), () => ({ isTauri: false, isNodeServer: false }) as unknown as typeof import('src/ts/platform'))

vi.mock('@tauri-apps/plugin-fs', () => ({ writeFile: vi.fn(), exists: vi.fn(async () => false), mkdir: vi.fn(), readFile: vi.fn(), BaseDirectory: { AppData: 0 } }))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Record<string, unknown> })
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
    changeChatTo: vi.fn(() => { h.order.push('changeChatTo') }),
    checkCharOrder: vi.fn(),
    downloadFile: vi.fn(),
    getFileSrc: vi.fn(),
    requiresFullEncoderReload: { state: false },
    pickedAssetLimitBytes: vi.fn(async () => 1024 * 1024),
    forageStorage: { keys: vi.fn(async () => []), getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}) },
}) as unknown as typeof import('src/ts/globalApi.svelte'))

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
    hasWorkIn: vi.fn(() => h.working),
    stopWorkIn: vi.fn((origin: { chaId: string, chatId: string }) => { h.order.push('stopWorkIn'); h.stopped.push(origin) }),
}))

vi.mock('src/ts/process/files/inlayCleanup', async (importOriginal) => ({
    ...(await importOriginal<typeof import('src/ts/process/files/inlayCleanup')>()),
    queueInlayCleanupForChat: vi.fn((chat: unknown) => { h.order.push('inlayCleanup'); h.inlayQueued.push(chat) }),
}))

vi.mock('src/ts/storage/characterSaveMarks', async (importOriginal) => ({
    ...(await importOriginal<typeof import('src/ts/storage/characterSaveMarks')>()),
    markCharacterForSave: vi.fn((chaId: string) => { h.order.push('mark'); h.marked.push(chaId) }),
}))

//#endregion

import { DBState } from 'src/ts/stores.svelte'
import { alertConfirm, alertError } from 'src/ts/alert'
import { language } from 'src/lang'
import { removeChatConfirmed } from 'src/ts/characters'
import type { Chat } from 'src/ts/storage/database.svelte'

type OwnerFixture = Parameters<typeof removeChatConfirmed>[0]

function chat(id: string, name: string): Chat {
    return { id, name, message: [], note: '', localLore: [] } as unknown as Chat
}

function installOwner(chats: Chat[]): OwnerFixture {
    const owner = { chaId: 'char-A', type: 'character', name: 'A', chatPage: 0, chats } as unknown as OwnerFixture
    DBState.db = { characters: [owner], characterOrder: ['char-A'] } as unknown as Database
    ;(globalThis as unknown as { __testDBState: Database }).__testDBState = DBState.db
    return DBState.db.characters[0] as OwnerFixture
}

beforeEach(() => {
    h.working = false
    h.stopped.length = 0
    h.marked.length = 0
    h.inlayQueued.length = 0
    h.order.length = 0
    vi.mocked(alertConfirm).mockReset()
    vi.mocked(alertConfirm).mockImplementation(async () => true)
    vi.mocked(alertError).mockReset()
})

describe('removeChatConfirmed default confirmation (compatibility guard: passes before and after)', () => {
    test('asks alertConfirm with the removal text and removes the confirmed chat', async () => {
        const owner = installOwner([chat('a', 'First'), chat('b', 'Second')])
        const victim = owner.chats[1]
        expect(await removeChatConfirmed(owner, victim)).toBe(true)
        expect(alertConfirm).toHaveBeenCalledTimes(1)
        expect(alertConfirm).toHaveBeenCalledWith(language.removeConfirm + 'Second')
        expect(owner.chats.map((c) => c.id)).toEqual(['a'])
    })

    test('names the working chat in the same text', async () => {
        h.working = true
        const owner = installOwner([chat('a', 'First'), chat('b', 'Second')])
        await removeChatConfirmed(owner, owner.chats[1])
        expect(alertConfirm).toHaveBeenCalledWith(language.removeConfirm + 'Second' + '\n' + language.removeChatWhileWorking)
    })

    test('a declined confirmation removes nothing', async () => {
        vi.mocked(alertConfirm).mockImplementation(async () => false)
        const owner = installOwner([chat('a', 'First'), chat('b', 'Second')])
        expect(await removeChatConfirmed(owner, owner.chats[1])).toBe(false)
        expect(owner.chats).toHaveLength(2)
        expect(h.marked).toEqual([])
    })

    test('the only chat is refused with the error text and no confirmation', async () => {
        const owner = installOwner([chat('a', 'Only')])
        expect(await removeChatConfirmed(owner, owner.chats[0])).toBe(false)
        expect(alertError).toHaveBeenCalledWith(language.errors.onlyOneChat)
        expect(alertConfirm).not.toHaveBeenCalled()
    })
})

describe('removeChatConfirmed with an injected confirmation', () => {
    test('the injected confirmation gets the chat and the working flag, and alertConfirm is not used', async () => {
        h.working = true
        const owner = installOwner([chat('a', 'First'), chat('b', 'Second')])
        const victim = owner.chats[1]
        const confirm = vi.fn(async () => true)
        expect(await removeChatConfirmed(owner, victim, confirm)).toBe(true)
        expect(confirm).toHaveBeenCalledTimes(1)
        expect(confirm).toHaveBeenCalledWith({ chat: victim, busy: true })
        expect(alertConfirm).not.toHaveBeenCalled()
    })

    test('busy is false when nothing writes into the chat', async () => {
        const owner = installOwner([chat('a', 'First'), chat('b', 'Second')])
        const confirm = vi.fn(async (_request: { chat: Chat, busy: boolean }) => true)
        await removeChatConfirmed(owner, owner.chats[1], confirm)
        expect(confirm).toHaveBeenCalledTimes(1)
        expect(confirm.mock.calls[0][0].busy).toBe(false)
    })

    // The confirmed chat is found again by reference after the wait.
    test('a list that shifted while the confirmation was open still loses the confirmed chat', async () => {
        const owner = installOwner([chat('a', 'First'), chat('b', 'Second'), chat('c', 'Third')])
        const victim = owner.chats[1]
        const confirm = async () => {
            owner.chats.shift()
            return true
        }
        expect(await removeChatConfirmed(owner, victim, confirm)).toBe(true)
        expect(owner.chats.map((c) => c.id)).toEqual(['c'])
    })

    test('a chat that went away while the confirmation was open removes nothing and stops nothing', async () => {
        const owner = installOwner([chat('a', 'First'), chat('b', 'Second'), chat('c', 'Third')])
        const victim = owner.chats[1]
        const confirm = async () => {
            owner.chats.splice(1, 1)
            return true
        }
        expect(await removeChatConfirmed(owner, victim, confirm)).toBe(false)
        expect(owner.chats.map((c) => c.id)).toEqual(['a', 'c'])
        expect(h.stopped).toEqual([])
        expect(h.marked).toEqual([])
        // Nothing moves the shown chat for a removal that does not happen.
        expect(h.order).not.toContain('changeChatTo')
    })

    test('a chat that became the only one while the confirmation was open is left alone', async () => {
        const owner = installOwner([chat('a', 'First'), chat('b', 'Second')])
        const victim = owner.chats[1]
        const confirm = async () => {
            owner.chats.shift()
            return true
        }
        expect(await removeChatConfirmed(owner, victim, confirm)).toBe(false)
        expect(owner.chats.map((c) => c.id)).toEqual(['b'])
        expect(h.stopped).toEqual([])
    })

    test('a declined injected confirmation removes nothing', async () => {
        const owner = installOwner([chat('a', 'First'), chat('b', 'Second')])
        expect(await removeChatConfirmed(owner, owner.chats[1], async () => false)).toBe(false)
        expect(owner.chats).toHaveLength(2)
        expect(h.marked).toEqual([])
    })

    test('the only chat is refused before the injected confirmation is asked', async () => {
        const owner = installOwner([chat('a', 'Only')])
        const confirm = vi.fn(async () => true)
        expect(await removeChatConfirmed(owner, owner.chats[0], confirm)).toBe(false)
        expect(confirm).not.toHaveBeenCalled()
        expect(alertError).toHaveBeenCalledWith(language.errors.onlyOneChat)
    })

    test('a confirmed removal stops the chat\'s work, marks the owner and queues inlay cleanup, as the default path does', async () => {
        const owner = installOwner([chat('a', 'First'), chat('b', 'Second')])
        const victim = owner.chats[1]
        expect(await removeChatConfirmed(owner, victim, async () => true)).toBe(true)
        expect(h.stopped).toEqual([{ chaId: 'char-A', chatId: 'b' }])
        expect(h.marked).toEqual(['char-A'])
        expect(h.inlayQueued).toEqual([victim])
        expect(h.order.indexOf('stopWorkIn')).toBeLessThan(h.order.indexOf('mark'))
        expect(owner.chats.map((c) => c.id)).toEqual(['a'])
    })
})
