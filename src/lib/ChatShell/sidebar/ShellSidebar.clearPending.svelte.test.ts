// @vitest-environment happy-dom

/**
 * `ShellSidebar.svelte`: what a chat opened in the still-selected character does to a pending character switch.
 *
 * Invariants exercised here:
 * - While a switch is failed or loading, opening a row, creating a chat or duplicating a chat of the character that is
 *   still selected, or going home, abandons the pending switch: the phase returns to idle, the target is cleared, and the
 *   restore still running is superseded so it cannot select the abandoned character later.
 * - A pending switch to another character is ended only by a selection change, a newer switch, Back or Retry: unrelated
 *   sidebar actions keep it, and a strip tap on another character goes through the switch and replaces it.
 *
 * MOCKED: the stores module, `characters` (spies), `changeChatTo` (writes the selected slot like the real one), the
 * alert module, the reply flag, the heavy sidebar children, and `duplicateChat` (it opens the copy through `openChatOf`
 * like the real one). Everything under `chatShell/` and the switch state are real.
 */
import { flushSync, mount, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Chat, Database } from '../../../ts/storage/database.svelte'

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))

const mocks = vi.hoisted(() => ({
    changeChat: vi.fn(),
    changeChar: vi.fn(),
    supersede: vi.fn(),
    exportAllChats: vi.fn(),
    importChat: vi.fn(),
    alertNormal: vi.fn(),
    // Outcomes the handlers cannot reach by themselves: openChatOf answers with `forced`, duplicateChat refuses.
    forced: { value: null as null | 'not-selected' | 'missing', duplicateRefuses: false },
}))

vi.mock('../../../ts/chatShell/chatOpen', async (original) => {
    const actual = await original<typeof import('../../../ts/chatShell/chatOpen')>()
    return {
        ...actual,
        openChatOf: (...args: Parameters<typeof actual.openChatOf>) => mocks.forced.value ?? actual.openChatOf(...args),
    }
})

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    const selectedCharID = writable(-1)
    const selIdState = $state({ selId: -1 })
    selectedCharID.subscribe((v) => { selIdState.selId = v })
    return {
        DBState: state,
        selectedCharID,
        selIdState,
        DynamicGUI: writable(false),
        sideBarClosing: writable(false),
        settingsOpen: writable(false),
        PlaygroundStore: writable(0),
        OpenRealmStore: writable(false),
        bookmarkListOpen: writable(false),
        alertStore: writable({ type: 'none', msg: '' }),
        additionalHamburgerMenu: [],
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/globalApi.svelte'), async () => {
    const { DBState, selIdState } = await import('src/ts/stores.svelte')
    return {
        changeChatTo: (i: number) => {
            mocks.changeChat(i)
            DBState.db.characters[selIdState.selId].chatPage = i
        },
    } as unknown as typeof import('src/ts/globalApi.svelte')
})

vi.mock(import('src/ts/characters'), () => ({
    getCharImage: vi.fn(async () => null),
    changeChar: mocks.changeChar,
    supersedeChangeChar: mocks.supersede,
    exportAllChats: mocks.exportAllChats,
    importChat: mocks.importChat,
    // The producer's shape: a new chat enters at the front of the list.
    createNewChat: (cha: { chats: Chat[] }) => {
        const chats = cha.chats
        chats.unshift({ id: `new-${chats.length}`, message: [], note: '', name: `New Chat ${chats.length + 1}`, localLore: [], fmIndex: -1 } as unknown as Chat)
        cha.chats = chats
        return 0
    },
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/alert'), () => ({
    alertNormal: mocks.alertNormal,
    alertError: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/process/index.svelte'), () => ({
    doingChat: writable(false),
}) as unknown as typeof import('src/ts/process/index.svelte'))

vi.mock('../../SideBars/CharConfig.svelte', () => ({ default: () => {} }))
vi.mock('../../SideBars/DevTool.svelte', () => ({ default: () => {} }))
vi.mock('../../Others/PluginDefinedIcon.svelte', () => ({ default: () => {} }))

// The real duplicate writes through the live-character store; this stand-in keeps its observable tail: the copy enters
// at the front of the list and is opened through openChatOf.
vi.mock('../../../ts/chatShell/chatListEdits', async (original) => {
    const actual = await original<typeof import('../../../ts/chatShell/chatListEdits')>()
    const { openChatOf, selectedOwner } = await import('../../../ts/chatShell/chatOpen')
    return {
        ...actual,
        duplicateChat: (_chaId: string, chat: Chat) => {
            const owner = selectedOwner()
            if (!owner || mocks.forced.duplicateRefuses) {
                return false
            }
            owner.chats.unshift({ ...chat, id: `copy-${chat.id}`, name: `${chat.name} Copy` })
            openChatOf(owner, owner.chats[0])
            return true
        },
    }
})

import { DBState, DynamicGUI, alertStore, bookmarkListOpen, selectedCharID, sideBarClosing } from 'src/ts/stores.svelte'
import { doingChat } from 'src/ts/process/index.svelte'
import { language } from 'src/lang'
import { takeOverlayReturnFocus } from '../../../ts/chatShell/overlayFocus'
import { clearPending, switchTarget } from '../../../ts/chatShell/switchTarget.svelte'
import ShellSidebar from './ShellSidebar.svelte'

type Entry = Database['characters'][number]

function chat(name: string): Chat {
    return { id: `id-${name}`, name, message: [], note: '', localLore: [], fmIndex: -1 } as unknown as Chat
}

function character(chaId: string, chats: Chat[], extra: Record<string, unknown> = {}): Entry {
    return { type: 'character', chaId, name: `Name ${chaId}`, image: '', chats, chatPage: 0, lastInteraction: 0, chatFolders: [], ...extra } as unknown as Entry
}

function install(characters: Entry[]): Entry[] {
    DBState.db = { characters, enableDevTools: false } as unknown as Database
    return DBState.db.characters
}

let mounted: Array<Record<string, unknown>> = []
let target: HTMLElement
const reseter = vi.fn()
const openGrid = vi.fn()

function render() {
    target = document.createElement('div')
    document.body.append(target)
    mounted.push(mount(ShellSidebar, { target, props: { openGrid, reseter } }) as Record<string, unknown>)
    flushSync()
}

function byLabel(label: string): HTMLButtonElement {
    const found = Array.from(target.querySelectorAll<HTMLButtonElement>('button')).find((b) => (b.getAttribute('aria-label') ?? b.textContent ?? '').trim() === label)
    if (!found) {
        throw new Error(`button not found: ${label}`)
    }
    return found
}

function stripButton(name: string): HTMLButtonElement {
    const found = Array.from(target.querySelectorAll<HTMLButtonElement>('[data-part="strip-avatar"]')).find((b) => b.getAttribute('aria-label') === name)
    if (!found) {
        throw new Error(`strip avatar not found: ${name}`)
    }
    return found
}

function row(name: string): HTMLElement {
    const found = Array.from(target.querySelectorAll<HTMLElement>('[data-part="chat-row"]')).find((r) => r.textContent?.includes(name))
    if (!found) {
        throw new Error(`chat row not found: ${name}`)
    }
    return found
}

// Puts a switch to `other` in the given phase without running it. The restore that a loading switch leaves running is
// covered with the real changeChar in characters.quietSwitch; here the spy on supersedeChangeChar stands for it.
function pendTo(other: Entry, phase: 'loading' | 'failed'): void {
    switchTarget.target = other
    switchTarget.phase = phase
    flushSync()
}

function expectDropped(): void {
    expect(switchTarget.phase).toBe('idle')
    expect(switchTarget.target).toBeNull()
    expect(mocks.supersede).toHaveBeenCalledTimes(1)
}

beforeEach(() => {
    mocks.changeChat.mockReset()
    mocks.changeChar.mockReset()
    mocks.changeChar.mockResolvedValue('selected')
    mocks.supersede.mockReset()
    mocks.exportAllChats.mockReset()
    mocks.importChat.mockReset()
    mocks.alertNormal.mockReset()
    mocks.forced.value = null
    mocks.forced.duplicateRefuses = false
    reseter.mockReset()
    openGrid.mockReset()
    localStorage.clear()
    doingChat.set(false)
    DynamicGUI.set(false)
    sideBarClosing.set(false)
    bookmarkListOpen.set(false)
    alertStore.set({ type: 'none', msg: '' })
    selectedCharID.set(-1)
    clearPending()
    takeOverlayReturnFocus()
})

afterEach(() => {
    for (const app of mounted) {
        unmount(app)
    }
    mounted = []
    flushSync()
    target?.remove()
    clearPending()
})

describe.each(['failed', 'loading'] as const)('a pending switch in phase %s and a chat of the selected character', (phase) => {
    function setup(): { a: Entry, b: Entry } {
        const [a, b] = install([
            character('a', [chat('a1'), chat('a2')], { chatPage: 1, lastInteraction: 20 }),
            character('b', [chat('b1')], { lastInteraction: 10, coldstorage: true }),
        ])
        selectedCharID.set(0)
        render()
        pendTo(b, phase)
        expect(switchTarget.phase).toBe(phase)
        return { a, b }
    }

    test('opening a row drops the pending switch', () => {
        setup()
        row('a1').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
        expect(mocks.changeChat).toHaveBeenCalledWith(0)
        expectDropped()
    })

    test('New chat drops the pending switch', () => {
        const { a } = setup()
        byLabel(language.newChat).click()
        expect(a.chats.length).toBe(3)
        expect(mocks.changeChat).toHaveBeenCalledWith(0)
        expectDropped()
    })

    test('Duplicate drops the pending switch', () => {
        const { a } = setup()
        row('a2').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }))
        flushSync()
        target.ownerDocument.querySelector<HTMLElement>('[data-action="duplicate"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
        flushSync()
        expect(a.chats.length).toBe(3)
        expect(mocks.changeChat).toHaveBeenCalledWith(0)
        expectDropped()
    })

    // Compatibility guards: an open that did not happen leaves the pending switch to its own endings.
    function expectKept(): void {
        expect(switchTarget.phase).toBe(phase)
        expect(switchTarget.target).not.toBeNull()
        expect(mocks.supersede).not.toHaveBeenCalled()
    }

    test.each(['not-selected', 'missing'] as const)('a row whose open is refused as %s keeps the pending switch', (outcome) => {
        setup()
        mocks.forced.value = outcome
        row('a1').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
        expectKept()
    })

    test.each(['not-selected', 'missing'] as const)('New chat whose open is refused as %s keeps the pending switch', (outcome) => {
        setup()
        mocks.forced.value = outcome
        byLabel(language.newChat).click()
        expectKept()
    })

    test('a refused Duplicate keeps the pending switch', () => {
        setup()
        mocks.forced.duplicateRefuses = true
        row('a2').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }))
        flushSync()
        target.ownerDocument.querySelector<HTMLElement>('[data-action="duplicate"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
        flushSync()
        expectKept()
    })

    test('going home abandons the pending switch before the selection moves', () => {
        setup()
        // The selection watcher idles the phase as soon as the selection changes, so the supersede has to come first.
        const order: string[] = []
        mocks.supersede.mockImplementation(() => { order.push(`supersede at selection ${get(selectedCharID)}`) })
        target.querySelector<HTMLElement>('[data-part="sidebar-home"]')!.click()
        flushSync()
        expect(order).toEqual(['supersede at selection 0'])
        expect(get(selectedCharID)).toBe(-1)
        expect(switchTarget.phase).toBe('idle')
        expect(switchTarget.target).toBeNull()
    })
})

describe('going home with nothing pending', () => {
    test('supersedes nothing', () => {
        install([character('a', [chat('a1')])])
        selectedCharID.set(0)
        render()
        target.querySelector<HTMLElement>('[data-part="sidebar-home"]')!.click()
        flushSync()
        expect(get(selectedCharID)).toBe(-1)
        expect(mocks.supersede).not.toHaveBeenCalled()
    })
})

describe('a pending switch to another character is kept by anything but its own endings', () => {
    function pending(): { a: Entry, b: Entry, c: Entry } {
        const [a, b, c] = install([
            character('a', [chat('a1'), chat('a2')], { chatPage: 1, lastInteraction: 30 }),
            character('b', [chat('b1')], { lastInteraction: 20, coldstorage: true }),
            character('c', [chat('c1')], { lastInteraction: 10, coldstorage: true }),
        ])
        selectedCharID.set(0)
        render()
        pendTo(b, 'failed')
        return { a, b, c }
    }

    test('unrelated sidebar actions keep the pending switch', () => {
        pending()
        const select = target.querySelector<HTMLSelectElement>('[data-part="sidebar-sort"]')!
        select.value = 'manual'
        select.dispatchEvent(new Event('change', { bubbles: true }))
        byLabel(language.chatShellMore).click()
        flushSync()
        expect(switchTarget.phase).toBe('failed')
        expect(switchTarget.target).not.toBeNull()
        expect(mocks.supersede).not.toHaveBeenCalled()
    })

    test('a strip tap on another character goes through the switch and replaces the pending target', async () => {
        const { c } = pending()
        mocks.changeChar.mockResolvedValue({ failed: 'unreadable' })
        stripButton(c.name).click()
        expect(mocks.changeChar).toHaveBeenCalledWith(2, { quiet: true })
        expect(switchTarget.phase).toBe('loading')
        expect(switchTarget.target).toBe(c)
        await Promise.resolve()
        await Promise.resolve()
        expect(switchTarget.phase).toBe('failed')
        expect(switchTarget.target).toBe(c)
        expect(mocks.supersede).not.toHaveBeenCalled()
    })
})
