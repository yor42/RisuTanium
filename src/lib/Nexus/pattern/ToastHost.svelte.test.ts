// @vitest-environment jsdom

/**
 * The visible toast stack: live regions, hold derivation from pointer and focus facts, focus return after a
 * pressed button is removed, suspension and the Back guard's independence.
 *
 * The host is a real `createToastHost` on a fake clock, so timers advance only when a test says so.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../../../ts/alertPrompts', () => ({ pageCovered: () => false }))
vi.mock('../../../ts/alertBack', () => ({ closeDialogForBack: () => { } }))

import { language } from '../../../lang'
import { dispatchBack, installBackGuard, registerBackHandler, resetBackHandlersForTests } from '../../../ts/backHandlers'
import { createToastHost, type ToastClock, type ToastHost, type UndoAction, type UndoOutcome } from '../../../ts/toast/toastHost.svelte'
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

let clock: ReturnType<typeof fakeClock>
let host: ToastHost
let target: HTMLElement
let mounted: Record<string, unknown> | null = null
let origin: HTMLButtonElement
const extraNodes: HTMLElement[] = []

function show(props: { covered?: boolean } = {}) {
    mounted = mount(ToastHostView, { target, props: { host, ...props } }) as unknown as Record<string, unknown>
    flushSync()
}

function addNode<K extends 'button' | 'input'>(tag: K): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag)
    document.body.appendChild(node)
    extraNodes.push(node)
    return node
}

function toastElements(): HTMLElement[] {
    return [...document.querySelectorAll<HTMLElement>('[data-part="toast"]')]
}

function part<T extends HTMLElement = HTMLElement>(toast: HTMLElement, name: string): T {
    const found = toast.querySelector<T>(`[data-part="${name}"]`)
    if (found === null) {
        throw new Error('missing part ' + name)
    }
    return found
}

function ok(text = 'Restored'): UndoAction {
    return { id: 'a', run: () => ({ ok: true, text }), failedText: 'FAILED' }
}

function postUndo(undo: UndoAction = ok(), text = 'Removed') {
    return host.postUndo({ text, actionLabel: 'Undo', action: undo })
}

/** The micro-turns a press needs: the run settles, then the effects run. */
async function settle() {
    for (let turn = 0; turn < 6; turn += 1) {
        await Promise.resolve()
        flushSync()
    }
}

function mouse(type: 'pointerenter' | 'pointermove' | 'pointerleave', element: Element, pointerType = 'mouse') {
    element.dispatchEvent(new PointerEvent(type, { pointerType, bubbles: type !== 'pointerenter' && type !== 'pointerleave' }))
    flushSync()
}

function focusFrom(from: HTMLElement, to: HTMLElement) {
    from.focus()
    to.focus()
    flushSync()
}

function setVisibility(state: 'hidden' | 'visible') {
    Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    flushSync()
}

beforeEach(() => {
    clock = fakeClock()
    host = createToastHost({ clock })
    target = document.createElement('div')
    document.body.appendChild(target)
    origin = addNode('button')
    origin.textContent = 'origin'
})

afterEach(async () => {
    if (mounted !== null) {
        await unmount(mounted as never)
    }
    mounted = null
    target.remove()
    for (const node of extraNodes.splice(0)) {
        node.remove()
    }
    delete (document as unknown as Record<string, unknown>).visibilityState
    resetBackHandlersForTests()
})

describe('live regions', () => {
    test('TC1 both regions exist and are empty at mount, outside the stack; a post appears once in the right region', () => {
        show()
        const polite = document.querySelector('[data-part="toast-live-polite"]')!
        const assertive = document.querySelector('[data-part="toast-live-assertive"]')!
        const root = document.querySelector('[data-part="toast-host"]')!
        expect(polite.getAttribute('role')).toBe('status')
        expect(assertive.getAttribute('role')).toBe('alert')
        expect(polite.textContent).toBe('')
        expect(assertive.textContent).toBe('')
        expect(root.contains(polite)).toBe(false)
        expect(root.contains(assertive)).toBe(false)

        host.post({ text: 'Saved' })
        flushSync()
        expect(polite.textContent).toBe('Saved')
        expect(assertive.textContent).toBe('')
        host.post({ kind: 'error', text: 'Broke' })
        flushSync()
        expect(assertive.textContent).toBe('Broke')
        expect(polite.textContent).toBe('Saved')
        host.post({ kind: 'warning', text: 'Careful' })
        flushSync()
        expect(assertive.textContent).toBe('Careful')
        expect(polite.textContent).toBe('Saved')
    })

    test('TC2 two identical announcements render as a different node with the same text', () => {
        show()
        host.post({ text: 'Same' })
        flushSync()
        const first = document.querySelector('[data-part="toast-live-polite"] span')
        host.post({ text: 'Same' })
        flushSync()
        const second = document.querySelector('[data-part="toast-live-polite"] span')
        expect(second).not.toBe(first)
        expect(second!.textContent).toBe('Same')
        expect(first!.textContent).toBe('Same')
    })

    test('TC3 a post of every kind never moves focus', () => {
        show()
        const input = addNode('input')
        input.focus()
        host.post({ text: 'i' })
        host.post({ kind: 'success', text: 's' })
        host.post({ kind: 'warning', text: 'w' })
        postUndo()
        host.post({ kind: 'error', text: 'e' })
        flushSync()
        expect(document.activeElement).toBe(input)
    })
})

describe('holds from pointer facts', () => {
    test('TC4a a mouse enter holds, a touch enter does not, a mouse leave releases', () => {
        show()
        host.post({ text: 'one' })
        flushSync()
        const [toast] = toastElements()
        mouse('pointerenter', toast, 'touch')
        expect(host.holds().hover).toBe(false)
        mouse('pointerenter', toast, 'mouse')
        expect(host.holds().hover).toBe(true)
        clock.advance(60_000)
        expect(host.visible).toHaveLength(1)
        mouse('pointerleave', toast, 'mouse')
        expect(host.holds().hover).toBe(false)
        clock.advance(5000)
        expect(host.visible).toHaveLength(0)
    })

    test('TC4b after a page hide dropped the hover, a mouse move holds again', () => {
        show()
        host.post({ text: 'one' })
        flushSync()
        const [toast] = toastElements()
        mouse('pointerenter', toast)
        setVisibility('hidden')
        expect(host.holds().hover).toBe(false)
        mouse('pointermove', toast)
        expect(host.holds().hover).toBe(true)
    })

    test('TC4c a hovered toast ended with no pointer event leaves no hold; the next toast times out', () => {
        show()
        const a = host.post({ text: 'A' })
        host.post({ text: 'B' })
        flushSync()
        mouse('pointerenter', toastElements()[0])
        expect(host.holds().hover).toBe(true)
        host.dismiss(a)
        flushSync()
        expect(host.holds().hover).toBe(false)
        clock.advance(5000)
        expect(host.visible).toHaveLength(0)
    })

    test('TC4d a covered stack drops the hover record; timers run after the cover lifts', () => {
        const props = $state({ covered: false })
        mounted = mount(ToastHostView, { target, props: { host, get covered() { return props.covered } } }) as unknown as Record<string, unknown>
        flushSync()
        host.post({ text: 'one' })
        flushSync()
        mouse('pointerenter', toastElements()[0])
        props.covered = true
        flushSync()
        expect(host.holds().hover).toBe(false)
        props.covered = false
        flushSync()
        clock.advance(5000)
        expect(host.visible).toHaveLength(0)
    })

    test('TC4e entering B and then leaving A keeps the hover', () => {
        show()
        host.post({ text: 'A' })
        host.post({ text: 'B' })
        flushSync()
        const [a, b] = toastElements()
        mouse('pointerenter', a)
        mouse('pointerenter', b)
        mouse('pointerleave', a)
        expect(host.holds().hover).toBe(true)
        mouse('pointerleave', b)
        expect(host.holds().hover).toBe(false)
    })
})

describe('focus', () => {
    test('TC5 focus on a Dismiss holds every timer; the buttons are in plain tab order; Alt+Z and Ctrl+Z run nothing', () => {
        const run = vi.fn((): UndoOutcome => ({ ok: true, text: 'x' }))
        show()
        host.post({ text: 'A' })
        host.post({ text: 'B' })
        postUndo({ id: 'k', run, failedText: 'FAILED' })
        flushSync()
        const [a] = toastElements()
        const dismiss = part<HTMLButtonElement>(a, 'toast-dismiss')
        focusFrom(origin, dismiss)
        expect(host.holds().focus).toBe(true)
        clock.advance(60_000)
        expect(host.visible).toHaveLength(3)
        for (const button of document.querySelectorAll<HTMLButtonElement>('[data-part="toast-action"], [data-part="toast-dismiss"]')) {
            expect(button.tagName).toBe('BUTTON')
            expect(button.hasAttribute('tabindex') && Number(button.getAttribute('tabindex')) < 0).toBe(false)
        }
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', altKey: true, bubbles: true }))
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }))
        expect(run).not.toHaveBeenCalled()
    })

    test('TC5 the toast list is keyed by id: a toast ending before the focused one keeps focus on it', () => {
        show()
        host.post({ text: 'A' })
        const b = host.post({ text: 'B' })
        flushSync()
        const [first, second] = toastElements()
        const dismissB = part<HTMLButtonElement>(second, 'toast-dismiss')
        focusFrom(origin, dismissB)
        host.dismiss(host.visible[0].id)
        flushSync()
        expect(document.activeElement).toBe(dismissB)
        expect(first.isConnected).toBe(false)
        expect(host.holds().focus).toBe(true)
        expect(host.visible.map((toast) => toast.id)).toEqual([b])
    })

    test('TC6a focus returns to the origin after Undo removes the focused button, with no focusout at all', async () => {
        show()
        postUndo()
        flushSync()
        const undo = part<HTMLButtonElement>(toastElements()[0], 'toast-action')
        focusFrom(origin, undo)
        const swallow = (event: Event) => event.stopPropagation()
        window.addEventListener('focusout', swallow, true)
        try {
            undo.click()
            await settle()
        } finally {
            window.removeEventListener('focusout', swallow, true)
        }
        expect(host.visible[0]).toMatchObject({ kind: 'success' })
        expect(document.activeElement).toBe(origin)
        clock.advance(4999)
        expect(host.visible).toHaveLength(1)
        clock.advance(1)
        expect(host.visible).toHaveLength(0)
    })

    test('TC6b an origin removed before the press leaves body focused and the success toast still ends at 5 s', async () => {
        show()
        postUndo()
        flushSync()
        const undo = part<HTMLButtonElement>(toastElements()[0], 'toast-action')
        focusFrom(origin, undo)
        origin.remove()
        undo.click()
        await settle()
        expect(document.activeElement).toBe(document.body)
        clock.advance(5000)
        expect(host.visible).toHaveLength(0)
    })

    test('TC6c focus on another toast keeps every timer paused when a result lands', async () => {
        show()
        postUndo()
        host.post({ text: 'B' })
        flushSync()
        const [a, b] = toastElements()
        const dismissB = part<HTMLButtonElement>(b, 'toast-dismiss')
        focusFrom(origin, dismissB)
        part<HTMLButtonElement>(a, 'toast-action').click()
        await settle()
        expect(host.visible[0]).toMatchObject({ kind: 'success' })
        expect(document.activeElement).toBe(dismissB)
        clock.advance(7000)
        expect(host.visible).toHaveLength(2)
    })

    test('TC6d a focusout dispatched by the engine at removal does not stop the focus return', async () => {
        show()
        postUndo()
        flushSync()
        const undo = part<HTMLButtonElement>(toastElements()[0], 'toast-action')
        focusFrom(origin, undo)
        const realRemove = Element.prototype.remove
        let dispatched = 0
        Element.prototype.remove = function (this: Element) {
            const active = document.activeElement
            if (active !== null && this.contains(active)) {
                dispatched += 1
                active.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }))
            }
            realRemove.call(this)
        }
        try {
            undo.click()
            await settle()
        } finally {
            Element.prototype.remove = realRemove
        }
        // A vacuous pass is not allowed: the wrapper must have seen the removal.
        expect(dispatched).toBeGreaterThan(0)
        expect(document.activeElement).toBe(origin)
        clock.advance(5000)
        expect(host.visible).toHaveLength(0)
    })

    test('TC6e the only toast: Dismiss by keyboard empties the stack, focus returns and no hold remains', async () => {
        show()
        host.post({ text: 'only' })
        flushSync()
        const dismiss = part<HTMLButtonElement>(toastElements()[0], 'toast-dismiss')
        focusFrom(origin, dismiss)
        expect(host.holds().focus).toBe(true)
        dismiss.click()
        await settle()
        expect(host.visible).toHaveLength(0)
        expect(document.activeElement).toBe(origin)
        expect(host.holds()).toEqual({ hover: false, focus: false })
    })

    test('TC12a a focused Undo whose run answers keep stays held; releasing focus lets the timer run', async () => {
        show()
        const keepAction: UndoAction = { id: 'k', run: () => ({ ok: false, text: 'Try again', after: 'keep' }), failedText: 'FAILED' }
        postUndo(keepAction)
        flushSync()
        const undo = part<HTMLButtonElement>(toastElements()[0], 'toast-action')
        focusFrom(origin, undo)
        undo.click()
        await settle()
        clock.advance(7000)
        expect(host.visible[0]).toMatchObject({ kind: 'undo', text: 'Try again' })
        expect(document.activeElement).toBe(undo)
        expect(host.holds().focus).toBe(true)
        origin.focus()
        await settle()
        expect(host.holds().focus).toBe(false)
        clock.advance(5999)
        expect(host.visible).toHaveLength(1)
        clock.advance(1)
        expect(host.visible).toHaveLength(0)
    })

    test('TC12b a focused Undo held through the pending flip keeps another toast from expiring', async () => {
        show()
        host.post({ text: 'B' })
        let release!: (outcome: UndoOutcome) => void
        const slow: UndoAction = { id: 's', run: () => new Promise<UndoOutcome>((resolve) => { release = resolve }), failedText: 'FAILED' }
        postUndo(slow)
        flushSync()
        const undo = part<HTMLButtonElement>(toastElements()[1], 'toast-action')
        focusFrom(origin, undo)
        undo.click()
        flushSync()
        clock.advance(9000)
        expect(host.visible.map((toast) => toast.text)).toContain('B')
        release({ ok: false, text: 'again', after: 'keep' })
        await settle()
        expect(host.holds().focus).toBe(true)
        clock.advance(20_000)
        expect(host.visible).toHaveLength(2)
    })

    test('TC13 a window blur and refocus keep the hold and the origin', async () => {
        show()
        postUndo()
        host.post({ text: 'B' })
        flushSync()
        const undo = part<HTMLButtonElement>(toastElements()[0], 'toast-action')
        focusFrom(origin, undo)
        undo.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }))
        window.dispatchEvent(new Event('blur'))
        await settle()
        clock.advance(7000)
        expect(host.visible).toHaveLength(2)
        expect(document.activeElement).toBe(undo)
        undo.dispatchEvent(new FocusEvent('focusin', { bubbles: true, relatedTarget: null }))
        undo.click()
        await settle()
        expect(document.activeElement).toBe(origin)
    })
})

describe('page visibility', () => {
    test('TC7a a hidden page drops the hover and the timers run', () => {
        show()
        host.post({ text: 'one' })
        flushSync()
        mouse('pointerenter', toastElements()[0])
        setVisibility('hidden')
        expect(host.holds().hover).toBe(false)
        clock.advance(5000)
        expect(host.visible).toHaveLength(0)
    })

    test('TC7b a hidden page keeps the focus hold when focus is inside the stack', () => {
        show()
        host.post({ text: 'one' })
        flushSync()
        focusFrom(origin, part<HTMLButtonElement>(toastElements()[0], 'toast-dismiss'))
        setVisibility('hidden')
        expect(host.holds().focus).toBe(true)
        clock.advance(7000)
        expect(host.visible).toHaveLength(1)
    })
})

describe('markup and suspension', () => {
    test('TC8 every toast has a Dismiss labelled with the Close string; a sticky ends only through it', () => {
        show()
        host.post({ kind: 'error', text: 'Broke' })
        host.post({ text: 'info' })
        postUndo()
        flushSync()
        for (const toast of toastElements()) {
            expect(part(toast, 'toast-dismiss').getAttribute('aria-label')).toBe(language.uiCommon.close)
        }
        clock.advance(3_600_000)
        flushSync()
        expect(toastElements()).toHaveLength(1)
        part<HTMLButtonElement>(toastElements()[0], 'toast-dismiss').click()
        flushSync()
        expect(toastElements()).toHaveLength(0)
    })

    test('TC9 a covered stack is hidden, inert and held; the regions stay outside; focus is not moved while suspended', () => {
        const props = $state({ covered: false })
        mounted = mount(ToastHostView, { target, props: { host, get covered() { return props.covered } } }) as unknown as Record<string, unknown>
        flushSync()
        host.post({ text: 'one' })
        host.post({ text: 'two' })
        flushSync()
        mouse('pointerenter', toastElements()[0])
        props.covered = true
        flushSync()
        const root = document.querySelector<HTMLElement>('[data-part="toast-host"]')!
        expect(root.hasAttribute('data-suspended')).toBe(true)
        expect((root as HTMLElement & { inert?: boolean }).inert === true || root.hasAttribute('inert')).toBe(true)
        expect(root.style.visibility).toBe('hidden')
        expect(host.holds().hover).toBe(false)
        expect(root.contains(document.querySelector('[data-part="toast-live-polite"]'))).toBe(false)
        clock.advance(60_000)
        expect(host.visible).toHaveLength(2)

        // A focused button removed while suspended is not answered with a focus move.
        props.covered = false
        flushSync()
        focusFrom(origin, part<HTMLButtonElement>(toastElements()[0], 'toast-dismiss'))
        props.covered = true
        flushSync()
        host.dismiss(host.visible[0].id)
        flushSync()
        expect(document.activeElement).not.toBe(origin)

        props.covered = false
        flushSync()
        expect(root.hasAttribute('data-suspended')).toBe(false)
        clock.advance(5000)
        expect(host.visible).toHaveLength(0)
    })

    test('TC10 data-parts and kinds; critical only while Undo is offered; aria-disabled while pending; no inline colour', async () => {
        show()
        let release!: (outcome: UndoOutcome) => void
        const slow: UndoAction = { id: 's', run: () => new Promise<UndoOutcome>((resolve) => { release = resolve }), failedText: 'FAILED' }
        const id = postUndo(slow)
        host.post({ kind: 'warning', text: 'Careful', sub: 'detail' })
        flushSync()
        const [undoToast, warning] = toastElements()
        expect(undoToast.dataset.kind).toBe('undo')
        expect(undoToast.hasAttribute('data-part-critical')).toBe(true)
        expect(warning.dataset.kind).toBe('warning')
        expect(warning.hasAttribute('data-part-critical')).toBe(false)
        expect(part(warning, 'toast-sub').textContent).toBe('detail')
        expect(part(undoToast, 'toast-text').textContent).toBe('Removed')
        const action = part<HTMLButtonElement>(undoToast, 'toast-action')
        expect(action.getAttribute('aria-disabled')).toBeNull()
        void host.activate(id)
        flushSync()
        expect(part(toastElements()[0], 'toast-action').getAttribute('aria-disabled')).toBe('true')
        release({ ok: true, text: 'Restored' })
        await settle()
        const outcome = toastElements()[0]
        expect(outcome.dataset.kind).toBe('success')
        expect(outcome.hasAttribute('data-part-critical')).toBe(false)
        for (const toast of toastElements()) {
            expect(toast.getAttribute('style')).toBeNull()
        }
    })
})

describe('mobile Back', () => {
    test('TC11 toasts showing change nothing about Back: warn once, quit on the second press, a handler still wins', () => {
        vi.useFakeTimers()
        try {
            const showToast = vi.fn()
            installBackGuard({ showToast })
            show()
            host.post({ text: 'one' })
            host.post({ kind: 'error', text: 'two' })
            flushSync()
            expect(dispatchBack()).toBe(true)
            expect(showToast).toHaveBeenCalledTimes(1)
            expect(dispatchBack()).toBe(false)
            expect(showToast).toHaveBeenCalledTimes(1)
            expect(host.visible).toHaveLength(2)

            const handler = vi.fn(() => true)
            const unregister = registerBackHandler(handler)
            expect(dispatchBack()).toBe(true)
            expect(handler).toHaveBeenCalledTimes(1)
            unregister()
        } finally {
            vi.useRealTimers()
        }
    })
})
