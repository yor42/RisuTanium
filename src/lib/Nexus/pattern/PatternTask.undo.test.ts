// @vitest-environment jsdom
/**
 * The result row of a card that carries the import Undo (a `guarded` action). Rows: T11, T22, T22b, T22c.
 *
 * Invariants: the guarded row ignores a tap stamped before it armed (finish, fail and cancelled cards alike); the
 * terminal headline, not Undo, takes focus; an unguarded Retry-only card still answers at once.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import PatternTask from './PatternTask.svelte'
import type { TaskView } from './taskProgress'

const steps = [{ label: 'Read file' }, { label: 'Add items' }]
const mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

function doneView(over: Partial<TaskView> = {}): TaskView {
    return { id: 1, title: 'Import', steps, stepIndex: 1, state: 'done', cancelOffered: false, cancelled: false, fraction: 1, slow: false, ...over }
}

function mountCard(view: TaskView, armOnMount = false) {
    const onanswer = vi.fn()
    const target = document.createElement('div')
    document.body.appendChild(target)
    const props = { view, lowPower: false, oncancel: () => { }, onanswer, armOnMount }
    mounted.push({ target, app: mount(PatternTask, { target, props }) })
    flushSync()
    return { target, onanswer }
}

const part = (target: HTMLElement, name: string): HTMLElement | null => target.querySelector<HTMLElement>(`[data-part="${name}"]`)

function tapStamped(button: HTMLElement, stamp: number): void {
    const tap = new MouseEvent('click', { bubbles: true, cancelable: true })
    Object.defineProperty(tap, 'timeStamp', { value: stamp })
    button.dispatchEvent(tap)
}

const UNDO = { id: 'undo', label: 'Undo import', guarded: true as const }

beforeEach(() => {
    vi.useFakeTimers()
})

afterEach(async () => {
    for (const { target, app } of mounted.splice(0)) {
        await unmount(app)
        target.remove()
    }
    vi.restoreAllMocks()
    vi.useRealTimers()
})

describe('a result card with a guarded Undo', () => {
    test('T11 guard: the headline keeps the initial marker and focus; Undo has neither', () => {
        const h = mountCard(doneView({ result: { headline: 'Imported 3 items', actions: [UNDO] } }))
        const headline = part(h.target, 'pattern-task-result-headline')!
        expect(headline.hasAttribute('data-pattern-initial')).toBe(true)
        expect(document.activeElement).toBe(headline)
        const undo = part(h.target, 'pattern-task-result-action')!
        expect(undo.hasAttribute('data-pattern-initial')).toBe(false)
        expect(document.activeElement).not.toBe(undo)
    })

    test('T22 the first render of a finish card ignores a click stamped before arming and answers after it', () => {
        const before = performance.now()
        const h = mountCard(doneView({ result: { headline: 'Imported 3 items', actions: [UNDO] } }))
        tapStamped(part(h.target, 'pattern-task-result-action')!, before)
        expect(h.onanswer).not.toHaveBeenCalled()
        vi.advanceTimersByTime(300)
        tapStamped(part(h.target, 'pattern-task-result-action')!, performance.now())
        expect(h.onanswer).toHaveBeenCalledWith({ kind: 'action', id: 'undo' })
    })

    test('T22 a fail card with a guarded Undo is armed too', () => {
        const before = performance.now()
        const h = mountCard(doneView({ state: 'failed', failure: { headline: 'Nothing was imported', dataState: 'unknown', actions: [UNDO] } }))
        tapStamped(part(h.target, 'pattern-task-result-action')!, before)
        expect(h.onanswer).not.toHaveBeenCalled()
        vi.advanceTimersByTime(300)
        tapStamped(part(h.target, 'pattern-task-result-action')!, performance.now())
        expect(h.onanswer).toHaveBeenCalledWith({ kind: 'action', id: 'undo' })
    })

    test('T22b a cancelled card (not reopened) with a guarded Undo ignores a click stamped before arming', () => {
        const before = performance.now()
        const h = mountCard(doneView({ cancelled: true, result: { headline: '', actions: [UNDO] } }))
        tapStamped(part(h.target, 'pattern-task-result-action')!, before)
        expect(h.onanswer).not.toHaveBeenCalled()
        vi.advanceTimersByTime(300)
        tapStamped(part(h.target, 'pattern-task-result-action')!, performance.now())
        expect(h.onanswer).toHaveBeenCalledWith({ kind: 'action', id: 'undo' })
    })

    test('T22c guard (passes before and after): a Retry-only result that is not reopened accepts an immediate click', () => {
        const h = mountCard(doneView({ result: { headline: 'Imported 1 item', actions: [{ id: 'retry', label: 'Retry' }] } }))
        tapStamped(part(h.target, 'pattern-task-result-action')!, performance.now())
        expect(h.onanswer).toHaveBeenCalledWith({ kind: 'action', id: 'retry' })
    })
})
