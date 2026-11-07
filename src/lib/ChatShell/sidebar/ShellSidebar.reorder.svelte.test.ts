// @vitest-environment happy-dom

/**
 * Edit order in `ShellSidebar.svelte`: entering, leaving and using the mode.
 *
 * Invariants exercised here:
 * - Edit order is offered only under My order, and every way out of My order, out of the selection, out of the sidebar or out
 *   of the mode itself (Done, Escape from inside the sidebar, Back) leaves the mode.
 * - A move runs only while the mode is on for the current selection under My order: a press or drop that races a switch or a
 *   sort change writes nothing and shows nothing.
 * - A drag reorders only within its own group, and a drop beside the dragged row writes nothing; a pointer outside the group
 *   lands at the group's edge and the indicator shows that landing.
 * - Up and Down move one place, are inert at the group's edge, announce the move and keep focus on the moved row's button; the
 *   arrow keys on those buttons do not rove the rows.
 *
 * MOCKED: the stores module, `characters` (spies), `changeChatTo`, the alert module, the save mark, the animation frame queue,
 * pointer capture and the scroller's rectangle. `placeChat`/`placeFolder` are spied and still run for real.
 */
import { flushSync, mount, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Chat, ChatFolder, Database } from '../../../ts/storage/database.svelte'

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
    alertError: vi.fn(),
    mark: vi.fn(),
    placeChat: vi.fn(),
    placeFolder: vi.fn(),
}))

vi.mock('../../../ts/chatShell/chatOrder', async (original) => {
    const actual = await original<typeof import('../../../ts/chatShell/chatOrder')>()
    return {
        ...actual,
        placeChat: (...args: Parameters<typeof actual.placeChat>) => { mocks.placeChat(...args); return actual.placeChat(...args) },
        placeFolder: (...args: Parameters<typeof actual.placeFolder>) => { mocks.placeFolder(...args); return actual.placeFolder(...args) },
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
        sideBarStore: writable(true),
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
    changeChar: vi.fn(),
    supersedeChangeChar: vi.fn(),
    exportAllChats: vi.fn(),
    importChat: vi.fn(),
    createNewChat: vi.fn(),
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/alert'), () => ({
    alertNormal: vi.fn(),
    alertError: mocks.alertError,
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/process/index.svelte'), () => ({
    doingChat: writable(false),
}) as unknown as typeof import('src/ts/process/index.svelte'))

vi.mock('src/ts/storage/characterSaveMarks', () => ({
    markCharacterForSave: mocks.mark,
}))

vi.mock('../../SideBars/CharConfig.svelte', () => ({ default: () => {} }))
vi.mock('../../SideBars/DevTool.svelte', () => ({ default: () => {} }))
vi.mock('../../Others/PluginDefinedIcon.svelte', () => ({ default: () => {} }))

import { DBState, DynamicGUI, selectedCharID, sideBarClosing, sideBarStore } from 'src/ts/stores.svelte'
import { language } from 'src/lang'
import { dispatchBack, registerBackHandler, resetBackHandlersForTests } from '../../../ts/backHandlers'
import { ROW_HEIGHT } from '../../../ts/chatShell/chatListModel'
import { takeOverlayReturnFocus } from '../../../ts/chatShell/overlayFocus'
import { clearPending } from '../../../ts/chatShell/switchTarget.svelte'
import ShellSidebar from './ShellSidebar.svelte'

type Entry = Database['characters'][number]

function chat(name: string, time = 5, extra: Partial<Chat> = {}): Chat {
    return { id: `id-${name}`, name, message: [{ role: 'char', data: name, time }], note: '', localLore: [], fmIndex: -1, ...extra } as unknown as Chat
}

function character(chaId: string, chats: Chat[], extra: Record<string, unknown> = {}): Entry {
    return { type: 'character', chaId, name: `Name ${chaId}`, image: '', chats, chatPage: 0, chatFolders: [], lastInteraction: 0, ...extra } as unknown as Entry
}

let mounted: Array<Record<string, unknown>> = []
let target: HTMLElement
let frames: Map<number, FrameRequestCallback>
let nextFrame: number
let closes: number
let standIn: (event: KeyboardEvent) => void

function install(...characters: Entry[]): Entry[] {
    DBState.db = { characters, enableDevTools: false } as unknown as Database
    return DBState.db.characters
}

function render(sort: 'manual' | 'recent' = 'manual') {
    localStorage.setItem('risuChatShell.chatSort', sort)
    target = document.createElement('div')
    document.body.append(target)
    mounted.push(mount(ShellSidebar, { target, props: { openGrid: vi.fn(), reseter: vi.fn() } }) as Record<string, unknown>)
    flushSync()
}

function scroller(): HTMLElement {
    const found = target.querySelector<HTMLElement>('[data-part="chat-list-scroller"]')
    if (!found) {
        throw new Error('scroller not found')
    }
    if (!found.dataset.stubbed) {
        found.dataset.stubbed = 'yes'
        found.getBoundingClientRect = () => ({ top: 0, bottom: 640, left: 0, right: 280, width: 280, height: 640, x: 0, y: 0, toJSON: () => ({}) })
        found.setPointerCapture = () => {}
        found.hasPointerCapture = () => true
        found.releasePointerCapture = () => {}
    }
    return found
}

function maybeToggle(): HTMLButtonElement | null {
    return target.querySelector<HTMLButtonElement>('[data-part="sidebar-edit-order"]')
}

function toggle(): HTMLButtonElement {
    const found = maybeToggle()
    if (!found) {
        throw new Error('Edit order toggle not found')
    }
    return found
}

function enterMode() {
    toggle().click()
    flushSync()
    scroller()
}

function sortSelect(): HTMLSelectElement {
    return target.querySelector<HTMLSelectElement>('[data-part="sidebar-sort"]')!
}

function chooseSort(value: 'manual' | 'recent', flush = true) {
    const select = sortSelect()
    select.value = value
    select.dispatchEvent(new Event('change', { bubbles: true }))
    if (flush) {
        flushSync()
    }
}

function hostAt(index: number): HTMLElement {
    const found = target.querySelector(`[data-index="${index}"]`)?.parentElement
    if (!found) {
        throw new Error(`row not found at ${index}`)
    }
    return found
}

function part(index: number, name: string): HTMLElement {
    const found = hostAt(index).querySelector<HTMLElement>(`[data-part="${name}"]`)
    if (!found) {
        throw new Error(`${name} not found at ${index}`)
    }
    return found
}

function pointer(type: string, init: { clientY?: number, pointerType?: string } = {}): PointerEvent {
    return new PointerEvent(type, { pointerId: 1, pointerType: init.pointerType ?? 'mouse', button: 0, clientY: init.clientY ?? 0, bubbles: true, cancelable: true })
}

function drag(index: number, clientY: number) {
    part(index, 'chat-drag-handle').dispatchEvent(pointer('pointerdown', { clientY: index * ROW_HEIGHT + 28 }))
    flushSync()
    scroller().dispatchEvent(pointer('pointermove', { clientY }))
    flushSync()
}

function release() {
    scroller().dispatchEvent(pointer('pointerup'))
    flushSync()
}

function indicator(): HTMLElement | null {
    return target.querySelector<HTMLElement>('[data-part="chat-drop-indicator"]')
}

function names(owner: Entry): string[] {
    return owner.chats.map((c) => c.name)
}

function escape(on: EventTarget) {
    on.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    flushSync()
}

beforeEach(() => {
    mocks.changeChat.mockReset()
    mocks.alertError.mockReset()
    mocks.mark.mockReset()
    mocks.placeChat.mockReset()
    mocks.placeFolder.mockReset()
    localStorage.clear()
    frames = new Map()
    nextFrame = 1
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(nextFrame, callback); return nextFrame++ })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id) })
    closes = 0
    standIn = (event) => {
        if (event.key !== 'Escape') {
            return
        }
        if (!event.defaultPrevented) {
            closes++
        }
        event.preventDefault()
    }
    window.addEventListener('keydown', standIn)
    DynamicGUI.set(true)
    sideBarClosing.set(false)
    sideBarStore.set(true)
    selectedCharID.set(-1)
    resetBackHandlersForTests()
    clearPending()
    takeOverlayReturnFocus()
})

afterEach(() => {
    window.removeEventListener('keydown', standIn)
    for (const app of mounted) {
        unmount(app)
    }
    mounted = []
    flushSync()
    target?.remove()
    vi.unstubAllGlobals()
    vi.useRealTimers()
    localStorage.clear()
})

describe('entering and leaving Edit order', () => {
    test('diagnostic: the selection mirror follows the store', async () => {
        const { selIdState } = await import('src/ts/stores.svelte')
        selectedCharID.set(1)
        expect(selIdState.selId).toBe(1)
    })

    test('TR7: under My order the toggle is offered and turns the handles and buttons on and off', () => {
        install(character('a', [chat('p'), chat('q')]))
        selectedCharID.set(0)
        render()
        expect(toggle().getAttribute('aria-pressed')).toBe('false')
        expect(toggle().textContent?.trim()).toBe(language.chatShellEditOrder)
        expect(target.querySelector('[data-part="chat-drag-handle"]')).toBeNull()
        toggle().click()
        flushSync()
        expect(toggle().getAttribute('aria-pressed')).toBe('true')
        expect(toggle().textContent?.trim()).toBe(language.chatShellDoneEditing)
        expect(target.querySelectorAll('[data-part="chat-drag-handle"]')).toHaveLength(2)
        toggle().click()
        flushSync()
        expect(toggle().getAttribute('aria-pressed')).toBe('false')
        expect(target.querySelector('[data-part="chat-drag-handle"]')).toBeNull()
    })

    test('TR7b: under Recent the toggle and the handles are absent', () => {
        install(character('a', [chat('p'), chat('q')]))
        selectedCharID.set(0)
        render('recent')
        expect(maybeToggle()).toBeNull()
        expect(target.querySelector('[data-part="chat-drag-handle"]')).toBeNull()
        expect(target.querySelector('[data-part="chat-move-up"]')).toBeNull()
    })

    test('TR7b: the handle is pointer-only and the buttons are named after the chat', () => {
        install(character('a', [chat('p'), chat('q')]))
        selectedCharID.set(0)
        render()
        enterMode()
        const handle = part(0, 'chat-drag-handle')
        expect(handle.getAttribute('aria-hidden')).toBe('true')
        expect(handle.getAttribute('data-panel-gesture')).toBe('off')
        expect(handle.style.touchAction).toBe('none')
        expect(part(0, 'chat-move-up').getAttribute('aria-label')).toBe(`${language.chatShellMoveUp} p`)
        expect(part(0, 'chat-move-down').getAttribute('aria-label')).toBe(`${language.chatShellMoveDown} p`)
        expect(hostAt(0).querySelectorAll('[data-index]')).toHaveLength(1)
        expect(part(0, 'chat-move-up').hasAttribute('data-index')).toBe(false)
    })

    test('TR7b: Escape from the focused toggle leaves the mode and the overlay stand-in does not close', () => {
        install(character('a', [chat('p'), chat('q')]))
        selectedCharID.set(0)
        render()
        enterMode()
        toggle().focus()
        escape(toggle())
        expect(toggle().getAttribute('aria-pressed')).toBe('false')
        expect(closes).toBe(0)
    })

    test('TR7b: a long press on the row opens the menu and starts no drag', () => {
        vi.useFakeTimers()
        install(character('a', [chat('p'), chat('q')]))
        selectedCharID.set(0)
        render()
        enterMode()
        part(0, 'chat-row').dispatchEvent(pointer('pointerdown', { pointerType: 'touch' }))
        vi.advanceTimersByTime(600)
        flushSync()
        expect(target.ownerDocument.querySelector('[data-action="duplicate"]')).not.toBeNull()
        expect(indicator()).toBeNull()
        expect(target.querySelectorAll('[data-dragging]')).toHaveLength(0)
    })

    test('Back leaves the mode before it does anything else', () => {
        install(character('a', [chat('p'), chat('q')]))
        selectedCharID.set(0)
        render()
        enterMode()
        expect(dispatchBack()).toBe(true)
        flushSync()
        expect(toggle().getAttribute('aria-pressed')).toBe('false')
        expect(dispatchBack()).toBe(false)
    })

    test('in the overlay the first Back leaves the mode and only the second closes the panel', () => {
        install(character('a', [chat('p'), chat('q')]))
        selectedCharID.set(0)
        render()
        // The overlay panel registers its Back hook once at mount, after the sidebar's own mount effects.
        registerBackHandler(() => {
            if (!get(sideBarStore) || get(sideBarClosing)) {
                return false
            }
            sideBarClosing.set(true)
            return true
        })
        enterMode()
        expect(dispatchBack()).toBe(true)
        flushSync()
        expect(toggle().getAttribute('aria-pressed')).toBe('false')
        expect(get(sideBarClosing)).toBe(false)
        expect(dispatchBack()).toBe(true)
        expect(get(sideBarClosing)).toBe(true)
    })

    test.each([
        ['the sidebar starting to close', () => sideBarClosing.set(true)],
        ['the sidebar being hidden', () => sideBarStore.set(false)],
        ['another character being selected', () => selectedCharID.set(1)],
        ['the sort leaving My order', () => chooseSort('recent')],
    ])('%s leaves the mode', (_name, trigger) => {
        install(character('a', [chat('p'), chat('q')]), character('b', [chat('b0')]))
        selectedCharID.set(0)
        render()
        enterMode()
        trigger()
        flushSync()
        expect(target.querySelector('[data-part="chat-drag-handle"]')).toBeNull()
        expect(target.querySelector('[aria-pressed="true"]')).toBeNull()
    })

    test('Edit order works after the sidebar was hidden and shown again', () => {
        install(character('a', [chat('p'), chat('q')]))
        selectedCharID.set(0)
        render()
        enterMode()
        sideBarStore.set(false)
        flushSync()
        sideBarStore.set(true)
        flushSync()
        expect(target.querySelector('[data-part="chat-drag-handle"]')).toBeNull()
        enterMode()
        expect(target.querySelectorAll('[data-part="chat-drag-handle"]')).toHaveLength(2)
    })
})

describe('TR7b: where a drop lands', () => {
    // Rows: 0 folder F, 1 a, 2 b (members of F), 3 x, 4 y (unfiled).
    function fixture(): Entry {
        const folder: ChatFolder = { id: 'F', name: 'F', folded: false }
        const [owner] = install(character('A', [chat('a', 5, { folderId: 'F' }), chat('b', 5, { folderId: 'F' }), chat('x'), chat('y')], { chatFolders: [folder] }))
        selectedCharID.set(0)
        render()
        enterMode()
        return owner
    }

    test('a drop in the gap below the last member writes nothing', () => {
        const owner = fixture()
        const chats = owner.chats
        drag(2, 158)
        release()
        expect(owner.chats).toBe(chats)
        expect(owner.chats[1].folderId).toBe('F')
        expect(mocks.mark).not.toHaveBeenCalled()
        expect(mocks.alertError).not.toHaveBeenCalled()
    })

    test('an unfiled chat dragged over the folder region drops at the top of unfiled, and the indicator shows that landing', () => {
        const owner = fixture()
        drag(4, 30)
        expect(indicator()!.style.top).toBe(`${3 * ROW_HEIGHT}px`)
        release()
        expect(mocks.placeChat).toHaveBeenCalledTimes(1)
        expect(mocks.placeChat.mock.calls[0][1].name).toBe('y')
        expect(mocks.placeChat.mock.calls[0][2].name).toBe('x')
        expect(names(owner)).toEqual(['a', 'b', 'y', 'x'])
        expect(owner.chats.every((c) => (c.name === 'a' || c.name === 'b') === (c.folderId === 'F'))).toBe(true)
        expect(mocks.mark).toHaveBeenCalledWith('A')
    })

    test('a member dragged below its folder drops at the folder\'s end and keeps its folder', () => {
        const owner = fixture()
        drag(1, 290)
        release()
        expect(mocks.placeChat.mock.calls[0][1].name).toBe('a')
        expect(mocks.placeChat.mock.calls[0][2]).toBeNull()
        expect(names(owner)).toEqual(['b', 'a', 'x', 'y'])
        expect(owner.chats[1].folderId).toBe('F')
    })

    test('a folder dragged over the unfiled region drops last among the folders', () => {
        const owner = fixture()
        drag(0, 250)
        release()
        expect(mocks.placeFolder).toHaveBeenCalledTimes(1)
        expect(owner.chatFolders).toHaveLength(1)
        expect(mocks.alertError).not.toHaveBeenCalled()
    })
})

describe('TR7b-sort: leaving My order ends the mode and any drag', () => {
    function fixture(): Entry {
        // Recent shows q, r, p.
        const [owner] = install(character('A', [chat('p', 1000), chat('q', 3000), chat('r', 2000)]))
        selectedCharID.set(0)
        render()
        enterMode()
        return owner
    }

    test('(a) a live drag is gone and the later drop writes nothing', () => {
        const owner = fixture()
        const chats = owner.chats
        drag(2, 30)
        expect(indicator()).not.toBeNull()
        chooseSort('recent')
        expect(maybeToggle()).toBeNull()
        expect(target.querySelector('[data-part="chat-drag-handle"]')).toBeNull()
        expect(target.querySelector('[data-part="chat-move-up"]')).toBeNull()
        expect(indicator()).toBeNull()
        expect(target.querySelectorAll('[data-dragging]')).toHaveLength(0)
        scroller().dispatchEvent(pointer('pointerup'))
        flushSync()
        expect(mocks.placeChat).not.toHaveBeenCalled()
        expect(mocks.alertError).not.toHaveBeenCalled()
        expect(owner.chats).toBe(chats)
        expect(mocks.mark).not.toHaveBeenCalled()
    })

    test('(b) a press on a button still in the DOM before the flush writes nothing', () => {
        const owner = fixture()
        const up = part(2, 'chat-move-up')
        chooseSort('recent', false)
        up.click()
        expect(mocks.placeChat).not.toHaveBeenCalled()
        expect(names(owner)).toEqual(['p', 'q', 'r'])
        expect(mocks.alertError).not.toHaveBeenCalled()
    })

    test('(c) returning to My order does not re-enter the mode', () => {
        fixture()
        chooseSort('recent')
        chooseSort('manual')
        expect(toggle().getAttribute('aria-pressed')).toBe('false')
        expect(target.querySelector('[data-part="chat-drag-handle"]')).toBeNull()
    })

    test('(d) under Recent with the mode never entered there are no handles', () => {
        install(character('A', [chat('p', 1000), chat('q', 3000)]))
        selectedCharID.set(0)
        render('recent')
        expect(target.querySelector('[data-part="chat-drag-handle"]')).toBeNull()
    })

    test('the persisted sort is not changed by leaving the mode', () => {
        fixture()
        chooseSort('recent')
        expect(localStorage.getItem('risuChatShell.chatSort')).toBe('recent')
    })
})

describe('TR8: a switch ends the mode', () => {
    test('a press or a drop made after the switch and before the flush writes nothing', () => {
        const [a] = install(character('A', [chat('a0'), chat('a1'), chat('a2')]), character('B', [chat('b0'), chat('b1')]))
        selectedCharID.set(0)
        render()
        enterMode()
        const chats = a.chats
        drag(1, 30)
        const up = part(2, 'chat-move-up')
        selectedCharID.set(1)
        up.click()
        scroller().dispatchEvent(pointer('pointerup'))
        expect(mocks.placeChat).not.toHaveBeenCalled()
        expect(mocks.alertError).not.toHaveBeenCalled()
        expect(a.chats).toBe(chats)
        flushSync()
        expect(target.querySelector('[data-part="chat-drag-handle"]')).toBeNull()
        expect(target.querySelector('[aria-pressed="true"]')).toBeNull()
        expect(indicator()).toBeNull()
        expect(frames.size).toBe(0)
        expect(mocks.mark).not.toHaveBeenCalled()
    })
})

describe('the buttons', () => {
    test('Up moves one place within the group, announces it and keeps focus on the moved row\'s button', () => {
        const [a] = install(character('A', [chat('p'), chat('q'), chat('r')]))
        selectedCharID.set(0)
        render()
        enterMode()
        part(2, 'chat-move-up').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }))
        flushSync()
        expect(names(a)).toEqual(['p', 'r', 'q'])
        expect(document.activeElement).toBe(part(1, 'chat-move-up'))
        expect(target.querySelector('[data-part="chat-order-status"]')!.textContent).toBe(language.chatShellMovedTo('r', 2, 3))
        expect(mocks.changeChat).not.toHaveBeenCalled()
    })

    test('TR13: a long Down move reveals the row and the focus follows past the window', () => {
        const chats = Array.from({ length: 60 }, (_, i) => chat(`c${i}`))
        const [a] = install(character('A', chats))
        selectedCharID.set(0)
        render()
        enterMode()
        part(15, 'chat-move-down').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }))
        flushSync()
        expect(a.chats[16].name).toBe('c15')
        expect(scroller().scrollTop).toBeGreaterThan(0)
        expect(document.activeElement).toBe(part(16, 'chat-move-down'))
        expect(target.querySelector('[data-part="chat-order-status"]')!.textContent).toBe(language.chatShellMovedTo('c15', 17, 60))
    })

    test('at a group edge the button is aria-disabled and a press writes nothing', () => {
        const [a] = install(character('A', [chat('p'), chat('q')]))
        selectedCharID.set(0)
        render()
        enterMode()
        expect(part(0, 'chat-move-up').getAttribute('aria-disabled')).toBe('true')
        expect(part(1, 'chat-move-down').getAttribute('aria-disabled')).toBe('true')
        expect(part(0, 'chat-move-down').hasAttribute('aria-disabled')).toBe(false)
        part(0, 'chat-move-up').click()
        part(1, 'chat-move-down').click()
        expect(mocks.placeChat).not.toHaveBeenCalled()
        expect(names(a)).toEqual(['p', 'q'])
    })

    test('a folder moves among the folders, and the first folder cannot go up', () => {
        const folders: ChatFolder[] = [{ id: 'F1', name: 'F1', folded: true }, { id: 'F2', name: 'F2', folded: true }]
        const [a] = install(character('A', [chat('p')], { chatFolders: folders }))
        selectedCharID.set(0)
        render()
        enterMode()
        expect(part(0, 'chat-move-up').getAttribute('aria-disabled')).toBe('true')
        part(1, 'chat-move-up').click()
        flushSync()
        expect((a.chatFolders as ChatFolder[]).map((f) => f.id)).toEqual(['F2', 'F1'])
        expect(mocks.mark).toHaveBeenCalledWith('A')
    })

    test('TR14: an arrow key on a move button does not rove, and only the stop row\'s buttons are tabbable', () => {
        install(character('A', [chat('p'), chat('q'), chat('r'), chat('s'), chat('t')]))
        selectedCharID.set(0)
        render()
        enterMode()
        const tabbable = Array.from(target.querySelectorAll<HTMLElement>('[data-part="chat-move-up"], [data-part="chat-move-down"]')).filter((b) => b.tabIndex === 0)
        expect(tabbable).toHaveLength(2)
        const down = part(0, 'chat-move-down')
        down.focus()
        const key = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
        down.dispatchEvent(key)
        flushSync()
        expect(key.defaultPrevented).toBe(false)
        expect(document.activeElement).toBe(down)
    })
})
