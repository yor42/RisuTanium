// @vitest-environment happy-dom

/**
 * Dragging a row's handle in `ShellChatList.svelte` (mounted in `ShellSidebar.svelte` with Edit order on).
 *
 * Invariants exercised here:
 * - The pointer is captured on the scroller, so recycling the dragged row out of the window does not end the drag, and the
 *   dragged row shows as dragged again when it is mounted again. At most 40 rows stay mounted.
 * - The drop is the pure `siblingDropTarget` of the pointer in list-content pixels, including after an autoscroll.
 * - Anything that ends the mode, the owner, the sidebar or the pointer ends the drag with nothing written: the indicator, the
 *   dragged mark and the autoscroll frame are gone, and a later pointerup writes nothing.
 * - Escape during a drag aborts only the drag: the mode stays, the overlay is not closed, and an earlier handler that already
 *   prevented the key changes nothing.
 *
 * MOCKED: the stores module, `characters` (spies), `changeChatTo`, the alert module, the save mark, the animation frame queue
 * (run by hand), pointer capture and the scroller's rectangle (happy-dom has no layout). `placeChat`/`placeFolder` are spied
 * and still run for real.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
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

import { DBState, DynamicGUI, selectedCharID, sideBarClosing } from 'src/ts/stores.svelte'
import { ROW_HEIGHT, chatListItems } from '../../../ts/chatShell/chatListModel'
import { siblingDropTarget } from '../../../ts/chatShell/chatOrder'
import { takeOverlayReturnFocus } from '../../../ts/chatShell/overlayFocus'
import { clearPending } from '../../../ts/chatShell/switchTarget.svelte'
import ShellSidebar from './ShellSidebar.svelte'

type Entry = Database['characters'][number]

function chat(name: string): Chat {
    return { id: `id-${name}`, name, message: [{ role: 'char', data: name, time: 5 }], note: '', localLore: [], fmIndex: -1 } as unknown as Chat
}

function character(chaId: string, chats: Chat[]): Entry {
    return { type: 'character', chaId, name: `Name ${chaId}`, image: '', chats, chatPage: 0, chatFolders: [], lastInteraction: 0 } as unknown as Entry
}

function many(count: number): Chat[] {
    return Array.from({ length: count }, (_, i) => chat(`c${i}`))
}

let mounted: Array<Record<string, unknown>> = []
let target: HTMLElement
let frames: Map<number, FrameRequestCallback>
let nextFrame: number
let captureTargets: Element[]
let closes: number
let standIn: (event: KeyboardEvent) => void

function render() {
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
        found.setPointerCapture = function (this: Element) { captureTargets.push(this) }
        found.hasPointerCapture = () => true
        found.releasePointerCapture = () => {}
    }
    return found
}

function toggle(): HTMLButtonElement {
    const found = target.querySelector<HTMLButtonElement>('[data-part="sidebar-edit-order"]')
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

function handleOf(index: number): HTMLElement {
    const found = target.querySelector(`[data-index="${index}"]`)?.parentElement?.querySelector<HTMLElement>('[data-part="chat-drag-handle"]')
    if (!found) {
        throw new Error(`handle not found at ${index}`)
    }
    return found
}

function pointer(type: string, init: { clientY?: number, pointerType?: string, pointerId?: number } = {}): PointerEvent {
    return new PointerEvent(type, { pointerId: init.pointerId ?? 1, pointerType: init.pointerType ?? 'mouse', button: 0, clientY: init.clientY ?? 0, bubbles: true, cancelable: true })
}

function startDrag(index: number, clientY = index * ROW_HEIGHT + 28) {
    handleOf(index).dispatchEvent(pointer('pointerdown', { clientY }))
    flushSync()
}

function move(clientY: number) {
    scroller().dispatchEvent(pointer('pointermove', { clientY }))
    flushSync()
}

function release() {
    scroller().dispatchEvent(pointer('pointerup'))
    flushSync()
}

function runFrames() {
    const queued = [...frames.values()]
    frames.clear()
    queued.forEach((callback) => callback(0))
    flushSync()
}

function indicator(): HTMLElement | null {
    return target.querySelector<HTMLElement>('[data-part="chat-drop-indicator"]')
}

function escape(on: EventTarget) {
    on.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    flushSync()
}

function expectNothingWritten() {
    expect(mocks.placeChat).not.toHaveBeenCalled()
    expect(mocks.placeFolder).not.toHaveBeenCalled()
    expect(mocks.alertError).not.toHaveBeenCalled()
    expect(mocks.mark).not.toHaveBeenCalled()
}

beforeEach(() => {
    mocks.changeChat.mockReset()
    mocks.alertError.mockReset()
    mocks.mark.mockReset()
    mocks.placeChat.mockReset()
    mocks.placeFolder.mockReset()
    localStorage.clear()
    localStorage.setItem('risuChatShell.chatSort', 'manual')
    frames = new Map()
    nextFrame = 1
    captureTargets = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(nextFrame, callback); return nextFrame++ })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id) })
    closes = 0
    standIn = (event) => {
        if (!event.defaultPrevented) {
            closes++
        }
        event.preventDefault()
    }
    window.addEventListener('keydown', standIn)
    DynamicGUI.set(true)
    sideBarClosing.set(false)
    selectedCharID.set(-1)
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
    localStorage.clear()
})

function install(...characters: Entry[]): Entry[] {
    DBState.db = { characters, enableDevTools: false } as unknown as Database
    return DBState.db.characters
}

describe('the drag follows the pointer over the scroller', () => {
    test('diagnostic: the selection mirror follows the store', async () => {
        const { selIdState } = await import('src/ts/stores.svelte')
        selectedCharID.set(1)
        expect(selIdState.selId).toBe(1)
    })

    test('TR11: capture sits on the scroller, so the dragged row can be recycled and the drop still lands', () => {
        const [a] = install(character('a', many(80)))
        selectedCharID.set(0)
        render()
        enterMode()
        startDrag(1)
        expect(captureTargets).toEqual([scroller()])
        expect(target.querySelectorAll('[data-dragging]')).toHaveLength(1)

        const list = scroller()
        list.scrollTop = 2240
        list.dispatchEvent(new Event('scroll'))
        flushSync()
        expect(target.querySelector('[data-index="1"]')).toBeNull()
        expect(target.querySelectorAll('[data-part="chat-row"]').length).toBeLessThanOrEqual(40)
        expect(target.querySelectorAll('[data-dragging]')).toHaveLength(0)
        expect(indicator()).not.toBeNull()

        move(100)
        const expected = siblingDropTarget(chatListItems(a, 'manual'), a.chats[1], 100 + 2240)
        expect(indicator()!.style.top).toBe(`${42 * ROW_HEIGHT}px`)
        release()
        expect(mocks.placeChat).toHaveBeenCalledTimes(1)
        const [, moved, before] = mocks.placeChat.mock.calls[0]
        expect(moved.name).toBe('c1')
        expect(before.name).toBe(expected!.before!.name)
        expect(before.name).toBe('c42')
        expect(a.chats.map((c) => c.name).slice(0, 3)).toEqual(['c0', 'c2', 'c3'])
        expect(a.chats[41].name).toBe('c1')
    })

    test('a recycled dragged row is marked as dragged again when it is mounted again', () => {
        install(character('a', many(80)))
        selectedCharID.set(0)
        render()
        enterMode()
        startDrag(1)
        const list = scroller()
        list.scrollTop = 2240
        list.dispatchEvent(new Event('scroll'))
        flushSync()
        list.scrollTop = 0
        list.dispatchEvent(new Event('scroll'))
        flushSync()
        expect(target.querySelectorAll('[data-dragging]')).toHaveLength(1)
        expect(target.querySelector('[data-index="1"]')!.parentElement!.hasAttribute('data-dragging')).toBe(true)
    })

    test('autoscroll at the bottom edge scrolls the list, and the drop uses the scrolled position', () => {
        const [a] = install(character('a', many(80)))
        selectedCharID.set(0)
        render()
        enterMode()
        startDrag(1)
        move(630)
        expect(frames.size).toBe(1)
        for (let i = 0; i < 20; i++) {
            runFrames()
        }
        const scrolled = scroller().scrollTop
        expect(scrolled).toBeGreaterThan(0)
        const expected = siblingDropTarget(chatListItems(a, 'manual'), a.chats[1], 630 + scrolled)
        release()
        expect(mocks.placeChat).toHaveBeenCalledTimes(1)
        expect(mocks.placeChat.mock.calls[0][2]?.name ?? null).toBe(expected!.before?.name ?? null)
        expect(frames.size).toBe(0)
    })
})

describe('starting a drag', () => {
    test('the handle\'s pointerdown is default-prevented, so the press does not select text or scroll the list', () => {
        install(character('a', many(5)))
        selectedCharID.set(0)
        render()
        enterMode()
        const down = pointer('pointerdown', { clientY: 84 })
        expect(handleOf(1).dispatchEvent(down)).toBe(false)
        expect(down.defaultPrevented).toBe(true)
        flushSync()
        expect(target.querySelectorAll('[data-dragging]')).toHaveLength(1)
    })

    test.each([1, 2])('a mouse press with button %i starts nothing and is left alone', (button) => {
        install(character('a', many(5)))
        selectedCharID.set(0)
        render()
        enterMode()
        const down = new PointerEvent('pointerdown', { pointerId: 1, pointerType: 'mouse', button, clientY: 84, bubbles: true, cancelable: true })
        handleOf(1).dispatchEvent(down)
        flushSync()
        expect(down.defaultPrevented).toBe(false)
        expect(captureTargets).toEqual([])
        expect(target.querySelectorAll('[data-dragging]')).toHaveLength(0)
        move(300)
        expect(indicator()).toBeNull()
        release()
        expectNothingWritten()
    })

    test('a touch press starts the drag', () => {
        install(character('a', many(5)))
        selectedCharID.set(0)
        render()
        enterMode()
        handleOf(1).dispatchEvent(pointer('pointerdown', { clientY: 84, pointerType: 'touch' }))
        flushSync()
        expect(captureTargets).toEqual([scroller()])
        expect(target.querySelectorAll('[data-dragging]')).toHaveLength(1)
    })
})

describe('TR12: whatever ends the drag leaves nothing behind and writes nothing', () => {
    function setup() {
        install(character('a', many(80)), character('b', [chat('b0')]))
        selectedCharID.set(0)
        render()
        enterMode()
        startDrag(1)
        move(630)
        expect(frames.size).toBe(1)
        expect(indicator()).not.toBeNull()
    }

    function expectEnded() {
        expect(frames.size).toBe(0)
        expect(indicator()).toBeNull()
        expect(target.querySelectorAll('[data-dragging]')).toHaveLength(0)
    }

    test.each([
        ['Done', () => toggle().click()],
        ['a selection change', () => selectedCharID.set(1)],
        ['the sidebar starting to close', () => sideBarClosing.set(true)],
        ['an unmount', () => unmount(mounted.pop()!)],
        ['a pointercancel', () => scroller().dispatchEvent(pointer('pointercancel'))],
    ])('%s', (_name, trigger) => {
        setup()
        const list = scroller()
        const queued = [...frames.values()]
        trigger()
        flushSync()
        if (_name !== 'an unmount') {
            expectEnded()
        }
        expect(frames.size).toBe(0)
        list.dispatchEvent(pointer('pointerup'))
        flushSync()
        queued.forEach((callback) => callback(0))
        expectNothingWritten()
        expect(list.scrollTop).toBe(0)
    })

    describe('Escape belongs to the drag', () => {
        function afterEscape(on: () => EventTarget) {
            setup()
            const list = scroller()
            escape(on())
            expectEnded()
            expect(closes).toBe(0)
            expect(toggle().getAttribute('aria-pressed')).toBe('true')
            list.dispatchEvent(pointer('pointerup'))
            flushSync()
            expectNothingWritten()
            escape(toggle())
            expect(toggle().getAttribute('aria-pressed')).toBe('false')
            expect(closes).toBe(0)
        }

        test('on the focused toggle', () => {
            afterEscape(() => {
                toggle().focus()
                return toggle()
            })
        })

        test('on the body', () => {
            afterEscape(() => document.body)
        })

        test('when an earlier handler already prevented the key', () => {
            // Prevents the first Escape only, as a handler that already took that press would.
            const preventer = (event: KeyboardEvent) => event.preventDefault()
            window.addEventListener('keydown', preventer, { capture: true, once: true })
            try {
                afterEscape(() => document.body)
            } finally {
                window.removeEventListener('keydown', preventer, { capture: true })
            }
        })
    })
})
