// @vitest-environment happy-dom

/**
 * Opening Settings closes the chat list and the module list that `ChatScreen.svelte` owns.
 *
 * Mounts the REAL `ChatScreen.svelte`. Its children (`DefaultChatScreen`, `ChatList`,
 * `ModuleChatMenu`, `BackgroundDom`, `ResizeBox`, `TransitionImage`, `SideBarArrow`) are
 * replaced by stand-ins; the `DefaultChatScreen` stand-in keeps the props `ChatScreen` binds to
 * it, so the test reads and writes the bound menu flags the way the real composer does. The
 * surface's close signal is driven by bumping `chatSurface.closeEpoch`, which is what the
 * surface does when Settings opens.
 *
 * Invariants pinned here:
 *  - both menu flags that `ChatScreen` binds are false after Settings opens;
 *  - the flags are left alone when the signal does not fire.
 *
 * Tests whose title starts with `guard:` pass with or without the fix.
 */

import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'

//#region module mocks

interface BoundMenuProps {
    openChatList: boolean
    openModuleList: boolean
    customStyle: string
}

const boundProps = vi.hoisted(() => ({ current: null as null | { openChatList: boolean, openModuleList: boolean, customStyle: string } }))

vi.mock('src/ts/stores.svelte', () => {
    const state = $state({ db: { theme: 'default', characters: [], textScreenColor: '', textBorder: false, textScreenRounded: false, textScreenBorder: '', customBackground: '', classicMaxWidth: false, waifuWidth: 100, waifuWidth2: 100 } })
    return {
        DBState: state,
        CharEmotion: writable({}),
        selectedCharID: writable(-1),
    }
})
vi.mock('src/ts/util', () => ({
    getCustomBackground: vi.fn(async () => ''),
    getEmotion: vi.fn(() => ''),
}))
vi.mock('./DefaultChatScreen.svelte', () => ({
    default: (_anchor: unknown, props: BoundMenuProps) => {
        boundProps.current = props
        return {}
    },
}))
vi.mock('../Others/ChatList.svelte', () => ({ default: () => ({}) }))
vi.mock('../Setting/Pages/Module/ModuleChatMenu.svelte', () => ({ default: () => ({}) }))
vi.mock('./BackgroundDom.svelte', () => ({ default: () => ({}) }))
vi.mock('./ResizeBox.svelte', () => ({ default: () => ({}) }))
vi.mock('./TransitionImage.svelte', () => ({ default: () => ({}) }))
vi.mock('../UI/GUI/SideBarArrow.svelte', () => ({ default: () => ({}) }))

//#endregion

import ChatScreen from './ChatScreen.svelte'
import { chatSurface, resetChatSurfaceForTests } from './chatSurface.svelte'
import { DBState } from 'src/ts/stores.svelte'

let mountedScreen: Record<string, unknown> | null = null
let target: HTMLElement | null = null

function showChatScreen(): BoundMenuProps {
    target = document.createElement('div')
    document.body.appendChild(target)
    mountedScreen = mount(ChatScreen, { target, props: {} }) as unknown as Record<string, unknown>
    flushSync()
    if (boundProps.current === null) {
        throw new Error('the DefaultChatScreen stand-in was not mounted')
    }
    return boundProps.current
}

afterEach(async () => {
    if (mountedScreen !== null && target !== null) {
        await unmount(mountedScreen as never)
        target.remove()
    }
    mountedScreen = null
    target = null
    boundProps.current = null
    resetChatSurfaceForTests()
    DBState.db.theme = 'default'
    DBState.db.textScreenColor = ''
})

describe('ChatScreen: opening Settings closes the menus it owns', () => {
    test('the chat list and the module list close', () => {
        const bound = showChatScreen()
        bound.openChatList = true
        bound.openModuleList = true
        flushSync()
        expect(bound.openChatList).toBe(true)
        expect(bound.openModuleList).toBe(true)

        chatSurface.closeEpoch += 1
        flushSync()

        expect(bound.openChatList).toBe(false)
        expect(bound.openModuleList).toBe(false)
    })

    test('guard: without the close signal an open menu stays open', () => {
        const bound = showChatScreen()
        bound.openChatList = true
        flushSync()

        expect(bound.openChatList).toBe(true)
    })
})

describe('ChatScreen: display-style settings reach the composer without a remount', () => {
    test('R T16 a changed text screen color applies to the custom style', () => {
        DBState.db.theme = 'waifu'
        DBState.db.textScreenColor = '#111111'
        const bound = showChatScreen()
        expect(bound.customStyle).toContain('#11111180')

        DBState.db.textScreenColor = '#223344'
        flushSync()

        expect(bound.customStyle).toContain('#22334480')
        expect(bound.customStyle).not.toContain('#11111180')
    })
})
