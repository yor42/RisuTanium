// @vitest-environment jsdom

/**
 * The visible toast stack: live regions, hold derivation from pointer and focus facts, focus return after a
 * pressed button is removed, suspension and the Back guard's independence.
 *
 * The host is a real `createToastHost` on a fake clock, so timers advance only when a test says so. The harness
 * and the focus suite live in `ToastHost.scenarios.test-helpers.svelte.ts`; `ToastHost.asyncOrder.svelte.test.ts`
 * runs the focus suite again under the async scheduler.
 */
import { flushSync } from 'svelte'
import { describe, expect, test, vi } from 'vitest'

vi.mock('../../../ts/alertPrompts', () => ({ pageCovered: () => false }))
vi.mock('../../../ts/alertBack', () => ({ closeDialogForBack: () => { } }))

import { language } from '../../../lang'
import { dispatchBack, installBackGuard, registerBackHandler } from '../../../ts/backHandlers'
import type { UndoAction, UndoOutcome } from '../../../ts/toast/toastHost.svelte'
import { addNode, clock, focusFrom, host, installToastHarness, mouse, ok, origin, part, postUndo, registerToastHostFocusSuite, settle, setVisibility, show, showCovered, toastElements } from './ToastHost.scenarios.test-helpers.svelte'

installToastHarness()

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
        showCovered(() => props.covered)
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

registerToastHostFocusSuite()

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
        showCovered(() => props.covered)
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
