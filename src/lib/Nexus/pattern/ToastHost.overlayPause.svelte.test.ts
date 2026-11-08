// @vitest-environment jsdom

/**
 * The toast stack under focus-trapping overlays: every open pattern shell and the shell sidebar overlay holds the
 * toast timers, and the timers resume with the time they had left. The view is the real `ToastHost.svelte` on a
 * real `createToastHost`; the overlays are the real `ShellSheet` and `PatternDialog`. Each open or close is followed
 * by `flushSync()`, because the pause starts and ends in effect flushes.
 *
 * Tests whose title starts with `guard:` pass with or without the pause (compatibility).
 */
import { createRawSnippet, flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../../../ts/alertPrompts', () => ({ pageCovered: () => false }))
vi.mock('../../../ts/alertBack', () => ({ closeDialogForBack: () => { } }))
vi.mock('../../../ts/caughtErrors', () => ({ recordCaughtError: vi.fn() }))

import ShellSheet from '../../ChatShell/ShellSheet.svelte'
import { resetBackHandlersForTests } from '../../../ts/backHandlers'
import { createToastHost, resetToastHostForTests, toastHost, type ToastClock, type ToastHost, type UndoAction } from '../../../ts/toast/toastHost.svelte'
import { modalLayerCount } from './modalLayers.svelte'
import PatternDialog from './PatternDialog.svelte'
import ToastHostView from './ToastHost.svelte'

function fakeClock(): ToastClock & { advance(ms: number): void } {
    let time = 0
    let nextKey = 1
    const timers = new Map<number, { at: number, run: () => void }>()
    return {
        now: () => time,
        after(ms, run) {
            const key = nextKey++
            timers.set(key, { at: time + ms, run })
            return () => { timers.delete(key) }
        },
        advance(ms) {
            const target = time + ms
            for (;;) {
                let next: [number, { at: number, run: () => void }] | null = null
                for (const entry of timers) {
                    if (entry[1].at <= target && (next === null || entry[1].at < next[1].at)) {
                        next = entry
                    }
                }
                if (next === null) {
                    break
                }
                timers.delete(next[0])
                time = next[1].at
                next[1].run()
            }
            time = target
        },
    }
}

const sheetBody = createRawSnippet(() => ({ render: () => '<div><button data-sheet-initial>First</button><button id="second">Second</button></div>' }))
const dialogBody = createRawSnippet(() => ({ render: () => '<div><button id="ok">OK</button><button data-pattern-initial>Cancel</button></div>' }))

type Mounted = ReturnType<typeof mount>

let clock: ReturnType<typeof fakeClock>
let host: ToastHost
let mountedApps: Mounted[] = []
let nodes: HTMLElement[] = []

function addNode<K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag)
    document.body.appendChild(node)
    nodes.push(node)
    return node
}

function mountView(useHost: ToastHost | null = host): void {
    const target = addNode('div')
    mountedApps.push(mount(ToastHostView, { target, props: useHost === null ? {} : { host: useHost } }))
    flushSync()
}

function hostRoot(): HTMLElement {
    const found = document.querySelector<HTMLElement>('[data-part="toast-host"]')
    if (found === null) {
        throw new Error('toast host missing')
    }
    return found
}

function undoAction(): UndoAction {
    return { id: 'a', run: () => ({ ok: true, text: 'Restored' }), failedText: 'FAILED' }
}

function postUndo(target: ToastHost = host, text = 'Removed') {
    return target.postUndo({ text, actionLabel: 'Undo', action: undoAction() })
}

interface SheetOptions {
    kind?: 'sheet' | 'menu'
    inertOutside?: boolean
    background?: readonly HTMLElement[]
}

/** A real ShellSheet in its own body-level host element; `state.value` opens and closes it. */
function mountSheet(options: SheetOptions = {}): { state: { value: boolean }, target: HTMLElement } {
    const target = addNode('div')
    const state = $state({ value: false })
    mountedApps.push(mount(ShellSheet, {
        target,
        props: {
            get open() { return state.value },
            kind: options.kind ?? 'sheet',
            label: 'Sheet',
            inertOutside: options.inertOutside ?? false,
            background: options.background ?? [],
            onclose: () => { state.value = false },
            children: sheetBody,
        },
    }))
    flushSync()
    return { state, target }
}

function setOpen(state: { value: boolean }, value: boolean): void {
    state.value = value
    flushSync()
}

function mouse(type: 'pointerenter' | 'pointerleave', element: Element): void {
    element.dispatchEvent(new PointerEvent(type, { pointerType: 'mouse', bubbles: false }))
    flushSync()
}

beforeEach(() => {
    clock = fakeClock()
    host = createToastHost({ clock })
})

afterEach(async () => {
    for (const app of mountedApps.reverse()) {
        await unmount(app)
    }
    mountedApps = []
    for (const node of nodes.splice(0)) {
        node.remove()
    }
    resetBackHandlersForTests()
    resetToastHostForTests()
    vi.useRealTimers()
    expect(modalLayerCount()).toBe(0)
})

describe('an inertOutside sheet', () => {
    test('R1 the undo toast does not expire while the sheet is open and ends the remaining time after it closes', () => {
        mountView()
        const id = postUndo()
        clock.advance(3000)
        const sheet = mountSheet({ inertOutside: true })
        setOpen(sheet.state, true)
        // The overlay makes the toast stack unpressable; the pause is what keeps the toast alive.
        expect(hostRoot().closest('[inert]')).not.toBeNull()
        clock.advance(10_000)
        expect(host.visible).toHaveLength(1)
        setOpen(sheet.state, false)
        clock.advance(2999)
        expect(host.visible.map((toast) => toast.id)).toEqual([id])
        clock.advance(1)
        expect(host.visible).toHaveLength(0)
    })

    test('R2 nested sheets keep the pause until the last one closes', () => {
        mountView()
        postUndo()
        clock.advance(1000)
        const outer = mountSheet({ inertOutside: true })
        const inner = mountSheet({ inertOutside: true })
        setOpen(outer.state, true)
        setOpen(inner.state, true)
        setOpen(inner.state, false)
        clock.advance(10_000)
        expect(host.visible).toHaveLength(1)
        setOpen(outer.state, false)
        clock.advance(4999)
        expect(host.visible).toHaveLength(1)
        clock.advance(1)
        expect(host.visible).toHaveLength(0)
    })

    test('R5 the singleton host pauses on fake timers and resumes with the remaining time', () => {
        vi.useFakeTimers()
        resetToastHostForTests()
        mountView(null)
        toastHost.postUndo({ text: 'Removed', actionLabel: 'Undo', action: undoAction() })
        vi.advanceTimersByTime(3000)
        const sheet = mountSheet({ inertOutside: true })
        setOpen(sheet.state, true)
        vi.advanceTimersByTime(10_000)
        expect(toastHost.visible).toHaveLength(1)
        setOpen(sheet.state, false)
        vi.advanceTimersByTime(2999)
        expect(toastHost.visible).toHaveLength(1)
        vi.advanceTimersByTime(1)
        expect(toastHost.visible).toHaveLength(0)
    })
})

describe('overlays with a background list', () => {
    test('R3 a pattern dialog pauses the toast', () => {
        mountView()
        postUndo()
        clock.advance(2000)
        const background = addNode('main')
        const target = addNode('div')
        const state = $state({ value: false })
        mountedApps.push(mount(PatternDialog, {
            target,
            props: {
                labelId: 'label',
                background: [background],
                get open() { return state.value },
                children: dialogBody,
            },
        }))
        flushSync()
        setOpen(state, true)
        clock.advance(10_000)
        expect(host.visible).toHaveLength(1)
        setOpen(state, false)
        clock.advance(3999)
        expect(host.visible).toHaveLength(1)
        clock.advance(1)
        expect(host.visible).toHaveLength(0)
    })

    test('R4 a menu sheet without inertOutside pauses the toast', () => {
        mountView()
        postUndo()
        clock.advance(2000)
        const main = addNode('main')
        const sheet = mountSheet({ kind: 'menu', background: [main] })
        setOpen(sheet.state, true)
        clock.advance(10_000)
        expect(host.visible).toHaveLength(1)
        setOpen(sheet.state, false)
        clock.advance(3999)
        expect(host.visible).toHaveLength(1)
        clock.advance(1)
        expect(host.visible).toHaveLength(0)
    })
})

describe('the view while paused', () => {
    test('PV1 data-paused follows the overlay without hiding, inerting or deferring announcements', () => {
        mountView()
        const sheet = mountSheet({ kind: 'menu', background: [addNode('main')] })
        expect(hostRoot().hasAttribute('data-paused')).toBe(false)
        setOpen(sheet.state, true)
        expect(hostRoot().hasAttribute('data-paused')).toBe(true)
        expect(hostRoot().hasAttribute('data-suspended')).toBe(false)
        expect(hostRoot().style.visibility).not.toBe('hidden')
        expect(hostRoot().hasAttribute('inert')).toBe(false)
        postUndo(host, 'Removed while open')
        flushSync()
        expect(document.querySelector('[data-part="toast-live-polite"]')?.textContent).toBe('Removed while open')
        expect(document.querySelectorAll('[data-part="toast"]')).toHaveLength(1)
        clock.advance(60_000)
        expect(host.visible).toHaveLength(1)
        setOpen(sheet.state, false)
        expect(hostRoot().hasAttribute('data-paused')).toBe(false)
        clock.advance(6000)
        expect(host.visible).toHaveLength(0)
    })

    test('PV2 a hover that outlives the overlay does not keep the toast after the resume', () => {
        mountView()
        postUndo()
        flushSync()
        const toast = document.querySelector('[data-part="toast"]')!
        mouse('pointerenter', toast)
        const sheet = mountSheet({ inertOutside: true })
        setOpen(sheet.state, true)
        // The toast is inert under the sheet, so its pointer leave never arrives.
        setOpen(sheet.state, false)
        clock.advance(6000)
        expect(host.visible).toHaveLength(0)
    })

    test('guard: a plain inert sibling does not pause the toast', () => {
        mountView()
        postUndo()
        const sibling = addNode('div')
        sibling.setAttribute('inert', '')
        clock.advance(5999)
        expect(host.visible).toHaveLength(1)
        clock.advance(1)
        expect(host.visible).toHaveLength(0)
    })
})
