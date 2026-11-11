/**
 * The shared harness and the focus-return scenarios of `ToastHost.svelte`. `ToastHost.svelte.test.ts` (the
 * shipped scheduler) and `ToastHost.asyncOrder.svelte.test.ts` (the async scheduler) both install the harness and
 * register the focus suite, so each focus scenario runs under both schedulers with no copy.
 *
 * The host is a real `createToastHost` on a fake clock, so timers advance only when a test says so. The caller
 * owns the module mocks (`alertPrompts`, `alertBack`): `vi.mock` is file-scoped.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { resetBackHandlersForTests } from '../../../ts/backHandlers'
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

export let clock: ReturnType<typeof fakeClock>
export let host: ToastHost
export let target: HTMLElement
export let origin: HTMLButtonElement
let mounted: Record<string, unknown> | null = null
const extraNodes: HTMLElement[] = []

export function show(props: { covered?: boolean } = {}) {
    mounted = mount(ToastHostView, { target, props: { host, ...props } }) as unknown as Record<string, unknown>
    flushSync()
}

/** Mounts the view with `covered` read through a getter, so a test can flip it after mount. */
export function showCovered(covered: () => boolean) {
    mounted = mount(ToastHostView, { target, props: { host, get covered() { return covered() } } }) as unknown as Record<string, unknown>
    flushSync()
}

export function addNode<K extends 'button' | 'input'>(tag: K): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag)
    document.body.appendChild(node)
    extraNodes.push(node)
    return node
}

export function toastElements(): HTMLElement[] {
    return [...document.querySelectorAll<HTMLElement>('[data-part="toast"]')]
}

export function part<T extends HTMLElement = HTMLElement>(toast: HTMLElement, name: string): T {
    const found = toast.querySelector<T>(`[data-part="${name}"]`)
    if (found === null) {
        throw new Error('missing part ' + name)
    }
    return found
}

export function ok(text = 'Restored'): UndoAction {
    return { id: 'a', run: () => ({ ok: true, text }), failedText: 'FAILED' }
}

export function postUndo(undo: UndoAction = ok(), text = 'Removed') {
    return host.postUndo({ text, actionLabel: 'Undo', action: undo })
}

/** The micro-turns a press needs: the run settles, then the effects run. */
export async function settle() {
    for (let turn = 0; turn < 6; turn += 1) {
        await Promise.resolve()
        flushSync()
    }
}

export function mouse(type: 'pointerenter' | 'pointermove' | 'pointerleave', element: Element, pointerType = 'mouse') {
    element.dispatchEvent(new PointerEvent(type, { pointerType, bubbles: type !== 'pointerenter' && type !== 'pointerleave' }))
    flushSync()
}

export function focusFrom(from: HTMLElement, to: HTMLElement) {
    from.focus()
    to.focus()
    flushSync()
}

export function setVisibility(state: 'hidden' | 'visible') {
    Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    flushSync()
}

/** Registers the per-test setup and teardown of the harness; call once at the top level of a test file. */
export function installToastHarness(): void {
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
}

export function registerToastHostFocusSuite(): void {
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
}
