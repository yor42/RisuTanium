/**
 * Whether a chat is on screen (CHORE-685 R9) and the level-triggered clear of its new-reply mark, on the real
 * `chatOnScreen.svelte` leaf, the real `chatSurface`, the real `writeLiveChat` and a real `$state` database. The stores are
 * real writables standing in for the app's; the save tracker is a spy. Mocked success says nothing about a real App layout.
 *
 * Labels: "new API" tests pin the predicate, which does not exist before S1d (their red run is the missing module);
 * "reproducer" tests fail on the code before the clear; "guard" tests pass before and after.
 */
import { flushSync, tick } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Chat, Database } from '../../storage/database.svelte'

//#region module mocks

const markSpy = vi.hoisted(() => vi.fn())

vi.mock(import('../../stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(-1),
        settingsOpen: writable(false),
        DynamicGUI: writable(false),
        sideBarStore: writable(false),
        ShowRealmFrameStore: writable(''),
        ReloadGUIPointer: writable(0),
        ReloadChatPointer: writable({} as Record<number, number>),
    } as unknown as typeof import('../../stores.svelte')
})

vi.mock(import('../../storage/characterSaveMarks'), () => ({
    markCharacterForSave: markSpy,
}) as unknown as typeof import('../../storage/characterSaveMarks'))

//#endregion

import { DBState, DynamicGUI, selectedCharID, settingsOpen, ShowRealmFrameStore, sideBarStore } from '../../stores.svelte'
import { chatSurface, installChatSurface, resetChatSurfaceForTests } from '../../../lib/ChatScreens/chatSurface.svelte'
import { studioOpen } from '../../studio/studioOpen'
import { createHostChannelFake } from '../../android/hostChannelFake'

// The leaf is loaded with a caught import, so a run on the code before S1d reaches the assertions about the defect (a mark
// that is never cleared) instead of failing on the import. The stand-ins do nothing, or throw for an API only the leaf answers.
// The path is held in a variable so that the bundler does not resolve it when the file is absent.
const LEAF_PATH = '../chatOnScreen.svelte'
type OnScreenLeaf = typeof import('../chatOnScreen.svelte')
const missing = (name: string) => (): never => { throw new Error(`${name} does not exist before S1d`) }
const leaf: OnScreenLeaf = (await import(/* @vite-ignore */ LEAF_PATH).catch(() => null) as OnScreenLeaf | null) ?? {
    holdChatView: () => () => {},
    installChatOnScreen: () => () => {},
    resetChatOnScreenForTests: () => {},
    isChatOnScreen: missing('isChatOnScreen'),
    isPageVisible: missing('isPageVisible'),
}
const { holdChatView, installChatOnScreen, isChatOnScreen, isPageVisible, resetChatOnScreenForTests } = leaf

//#region fixtures

function makeChat(id: string, extra: Record<string, unknown> = {}): Chat {
    return { id, name: id, note: '', localLore: [], fmIndex: -1, message: [{ role: 'user', data: `${id} hello`, time: 1 }], ...extra } as unknown as Chat
}

function installWorld(): void {
    DBState.db = {
        characters: ['a', 'b', 'c', 'd'].map((id) => ({
            chaId: `${id}-cha`, name: id, type: 'character', chatPage: 0, reloadKeys: 0, chats: [makeChat(`${id}-chat`), makeChat(`${id}-other`)],
        })),
    } as unknown as Database
}

const chatOf = (letter: string, index = 0): Chat => DBState.db.characters.find((c) => c.chaId === `${letter}-cha`)!.chats[index]
const originOf = (letter: string) => ({ chaId: `${letter}-cha`, chatId: `${letter}-chat` })
const SLOT = { a: 0, b: 1, c: 2, d: 3 } as const

function setVisibility(state: 'visible' | 'hidden'): void {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
    document.dispatchEvent(new Event('visibilitychange'))
}

async function settle(): Promise<void> {
    await tick()
    await tick()
    flushSync()
}

let release: (() => void) | null = null
let stop: (() => void) | null = null

/** A page with the chat view mounted, the surface and the leaf installed, and chat `letter` selected. */
function showChat(letter: keyof typeof SLOT): void {
    installWorld()
    installChatSurface()
    stop = installChatOnScreen()
    release = holdChatView()
    selectedCharID.set(SLOT[letter])
    flushSync()
}

beforeEach(() => {
    markSpy.mockReset()
    resetChatOnScreenForTests()
    resetChatSurfaceForTests()
    settingsOpen.set(false)
    studioOpen.set(false)
    DynamicGUI.set(false)
    sideBarStore.set(false)
    ShowRealmFrameStore.set('')
    selectedCharID.set(-1)
    Reflect.deleteProperty(document, 'visibilityState')
    installWorld()
})

afterEach(() => {
    release?.()
    release = null
    stop?.()
    stop = null
    resetChatOnScreenForTests()
    resetChatSurfaceForTests()
    settingsOpen.set(false)
    studioOpen.set(false)
    Reflect.deleteProperty(document, 'visibilityState')
})

//#endregion

describe('isChatOnScreen', () => {
    test('new API: a leaf nobody installed answers on screen for any chat, so a harness without App sees no marks', () => {
        selectedCharID.set(SLOT.b)
        expect(isChatOnScreen(originOf('a'))).toBe(true)
        expect(isChatOnScreen(originOf('b'))).toBe(true)
    })

    test('new API: it is on screen only while the page is visible, the chat view is mounted and uncovered, and the selection is this chat', async () => {
        showChat('a')
        expect(isChatOnScreen(originOf('a'))).toBe(true)

        // another chat of the same character
        expect(isChatOnScreen({ chaId: 'a-cha', chatId: 'a-other' })).toBe(false)
        // another character
        expect(isChatOnScreen(originOf('b'))).toBe(false)

        // Home: nothing selected
        selectedCharID.set(-1)
        expect(isChatOnScreen(originOf('a'))).toBe(false)
        selectedCharID.set(SLOT.a)
        expect(isChatOnScreen(originOf('a'))).toBe(true)

        // the grid: ChatScreen unmounted
        release?.()
        expect(isChatOnScreen(originOf('a'))).toBe(false)
        release = holdChatView()
        expect(isChatOnScreen(originOf('a'))).toBe(true)

        // Settings, then Studio, cover the kept-mounted surface
        settingsOpen.set(true)
        expect(chatSurface.hidden).toBe(true)
        expect(isChatOnScreen(originOf('a'))).toBe(false)
        settingsOpen.set(false)
        await settle()
        expect(isChatOnScreen(originOf('a'))).toBe(true)
        studioOpen.set(true)
        expect(isChatOnScreen(originOf('a'))).toBe(false)
        studioOpen.set(false)
        await settle()
        expect(isChatOnScreen(originOf('a'))).toBe(true)

        // the page hidden
        setVisibility('hidden')
        expect(isChatOnScreen(originOf('a'))).toBe(false)
        setVisibility('visible')
        expect(isChatOnScreen(originOf('a'))).toBe(true)
    })

    test('new API (C4): a full-screen cover, the phone layout with its sidebar open, is off screen; a docked sidebar is not', () => {
        showChat('a')
        DynamicGUI.set(true)
        sideBarStore.set(true)
        expect(isChatOnScreen(originOf('a'))).toBe(false)
        sideBarStore.set(false)
        expect(isChatOnScreen(originOf('a'))).toBe(true)
        DynamicGUI.set(false)
        sideBarStore.set(true)
        expect(isChatOnScreen(originOf('a'))).toBe(true)
    })

    test('new API (C4): the open Realm browser is a full-screen cover, so the chat under it is off screen', () => {
        showChat('a')
        ShowRealmFrameStore.set('https://realm.example/')
        expect(isChatOnScreen(originOf('a'))).toBe(false)
        ShowRealmFrameStore.set('')
        expect(isChatOnScreen(originOf('a'))).toBe(true)
    })

    test('new API: a view held twice is released once per hold, and releasing a hold twice counts once', () => {
        showChat('a')
        const second = holdChatView()
        release?.()
        expect(isChatOnScreen(originOf('a'))).toBe(true)
        second()
        second()
        expect(isChatOnScreen(originOf('a'))).toBe(false)
        release = holdChatView()
        expect(isChatOnScreen(originOf('a'))).toBe(true)
    })

    test('new API: isPageVisible follows visibilitychange reactively', () => {
        installChatOnScreen()
        const seen: boolean[] = []
        const stopEffect = $effect.root(() => {
            $effect(() => {
                seen.push(isPageVisible())
            })
        })
        flushSync()
        setVisibility('hidden')
        flushSync()
        setVisibility('visible')
        flushSync()
        stopEffect()
        expect(seen).toEqual([true, false, true])
    })
})

describe('the clear of a mark (T20b)', () => {
    test('reproducer: marks of A and B; switching to C, D, then A clears A and marks its owner, and leaves B', () => {
        showChat('c')
        chatOf('a').unseenReply = 'reply'
        chatOf('b').unseenReply = 'error'
        flushSync()
        expect(chatOf('a').unseenReply).toBe('reply')

        selectedCharID.set(SLOT.d)
        flushSync()
        expect(chatOf('a').unseenReply).toBe('reply')
        markSpy.mockClear()

        selectedCharID.set(SLOT.a)
        flushSync()

        expect(chatOf('a').unseenReply).toBeUndefined()
        expect(chatOf('b').unseenReply).toBe('error')
        // P8: the clear marks the owner for save.
        expect(markSpy).toHaveBeenCalledWith('a-cha')
        expect(markSpy).not.toHaveBeenCalledWith('b-cha')
    })

    test('reproducer: a mark set while the chat is shown is cleared at once', () => {
        showChat('a')
        chatOf('a').unseenReply = 'reply'
        flushSync()
        expect(chatOf('a').unseenReply).toBeUndefined()
    })

    test('reproducer (T20b cancel half, M42): clearing the mark cancels that chat\'s system notification, by its key', () => {
        const fake = createHostChannelFake()
        window.__risuTaniumHost = fake.channel
        try {
            showChat('c')
            chatOf('a').unseenReply = 'reply'
            chatOf('b').unseenReply = 'reply'
            flushSync()

            selectedCharID.set(SLOT.a)
            flushSync()

            expect(chatOf('a').unseenReply).toBeUndefined()
            expect(fake.postedTo('replyNotifications', 'cancel').map((call) => call.args)).toEqual([['a-cha/a-chat']])
        } finally {
            delete window.__risuTaniumHost
        }
    })

    test('guard (OM-F): the cancel key names the shown chat at a non-zero chatPage, not the first chat', () => {
        const fake = createHostChannelFake()
        window.__risuTaniumHost = fake.channel
        try {
            showChat('c')
            chatOf('a', 1).unseenReply = 'reply'
            DBState.db.characters[SLOT.a].chatPage = 1
            flushSync()

            selectedCharID.set(SLOT.a)
            flushSync()

            expect(chatOf('a', 1).unseenReply).toBeUndefined()
            expect(fake.postedTo('replyNotifications', 'cancel').map((call) => call.args)).toEqual([['a-cha/a-other']])
        } finally {
            delete window.__risuTaniumHost
        }
    })

    test('guard: showing a chat with no mark cancels nothing', () => {
        const fake = createHostChannelFake()
        window.__risuTaniumHost = fake.channel
        try {
            showChat('c')
            selectedCharID.set(SLOT.a)
            flushSync()
            expect(fake.postedTo('replyNotifications', 'cancel')).toEqual([])
        } finally {
            delete window.__risuTaniumHost
        }
    })
    test('reproducer: returning from Settings, from Studio and from the grid clears the mark of the selected chat', async () => {
        showChat('a')

        settingsOpen.set(true)
        await settle()
        chatOf('a').unseenReply = 'reply'
        await settle()
        expect(chatOf('a').unseenReply).toBe('reply')
        settingsOpen.set(false)
        await settle()
        expect(chatOf('a').unseenReply).toBeUndefined()

        studioOpen.set(true)
        await settle()
        chatOf('a').unseenReply = 'error'
        await settle()
        expect(chatOf('a').unseenReply).toBe('error')
        studioOpen.set(false)
        await settle()
        expect(chatOf('a').unseenReply).toBeUndefined()

        release?.()
        flushSync()
        chatOf('a').unseenReply = 'reply'
        flushSync()
        expect(chatOf('a').unseenReply).toBe('reply')
        release = holdChatView()
        flushSync()
        expect(chatOf('a').unseenReply).toBeUndefined()
    })

    test('reproducer: a page shown again clears the mark; a hidden page does not', () => {
        showChat('a')
        setVisibility('hidden')
        chatOf('a').unseenReply = 'reply'
        flushSync()
        expect(chatOf('a').unseenReply).toBe('reply')
        setVisibility('visible')
        flushSync()
        expect(chatOf('a').unseenReply).toBeUndefined()
    })

    test('reproducer (C4): closing the phone sidebar over the selected chat clears the mark; open, it does not', () => {
        showChat('a')
        DynamicGUI.set(true)
        sideBarStore.set(true)
        chatOf('a').unseenReply = 'reply'
        flushSync()
        expect(chatOf('a').unseenReply).toBe('reply')
        sideBarStore.set(false)
        flushSync()
        expect(chatOf('a').unseenReply).toBeUndefined()
    })

    test('reproducer (C4): closing the Realm browser over the selected chat clears the mark; open, it does not', () => {
        showChat('a')
        ShowRealmFrameStore.set('https://realm.example/')
        chatOf('a').unseenReply = 'reply'
        flushSync()
        expect(chatOf('a').unseenReply).toBe('reply')
        ShowRealmFrameStore.set('')
        flushSync()
        expect(chatOf('a').unseenReply).toBeUndefined()
    })

    test('guard (OM5, OM6): with another chat of the same character marked and shown, opening it clears only it, and the other chat keeps its mark', () => {
        showChat('b')
        chatOf('a', 1).unseenReply = 'reply'
        chatOf('a', 0).unseenReply = 'error'
        DBState.db.characters[SLOT.a].chatPage = 1
        flushSync()
        selectedCharID.set(SLOT.a)
        flushSync()
        expect(chatOf('a', 1).unseenReply).toBeUndefined()
        expect(chatOf('a', 0).unseenReply).toBe('error')
        expect(markSpy).toHaveBeenCalledWith('a-cha')
    })

    test('guard (P10): a value this build does not know is kept by the clear', () => {
        showChat('a')
        ;(chatOf('a') as unknown as Record<string, unknown>).unseenReply = 'a value of a later build'
        flushSync()
        expect((chatOf('a') as unknown as Record<string, unknown>).unseenReply).toBe('a value of a later build')
        expect(markSpy).not.toHaveBeenCalled()
    })

    test('reproducer: the clear marks the owner once, and another character\'s mark is no reason to write again', () => {
        showChat('a')
        chatOf('a').unseenReply = 'reply'
        flushSync()
        expect(markSpy.mock.calls.filter((call) => call[0] === 'a-cha')).toHaveLength(1)
        markSpy.mockClear()
        chatOf('b').unseenReply = 'reply'
        flushSync()
        expect(markSpy).not.toHaveBeenCalled()
        expect(chatOf('b').unseenReply).toBe('reply')
    })

    test('guard (T20c): deleting A\'s chat leaves a dot on no other chat', () => {
        showChat('b')
        chatOf('a').unseenReply = 'reply'
        const owner = DBState.db.characters[SLOT.a]
        owner.chats.splice(0, 1)
        flushSync()
        selectedCharID.set(SLOT.a)
        flushSync()
        for (const character of DBState.db.characters) {
            for (const chat of character.chats) {
                expect(chat.unseenReply, `${character.name}/${chat.name}`).toBeUndefined()
            }
        }
    })
})
