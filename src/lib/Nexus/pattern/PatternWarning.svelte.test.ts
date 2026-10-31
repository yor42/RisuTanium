import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import PatternWarning from './PatternWarning.svelte'
import { armDelayMs, assertWarningActions, parseCssDuration, splitConsequences, type PatternAnswer, type PatternWarningDef } from './patternWarning'

const mounted: { target: HTMLElement, app: Record<string, unknown> }[] = []

function show(def: PatternWarningDef, onanswer: (answer: PatternAnswer) => void = () => {}): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const props = $state({ def, onanswer })
    const app = mount(PatternWarning as never, { target, props }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return target
}

const danger: PatternWarningDef = {
    severity: 'danger',
    headline: 'Replace all data?',
    consequences: ['one', 'two'],
    actions: { cancel: 'Cancel', primary: 'Replace' },
}

function part(target: HTMLElement, name: string): HTMLButtonElement {
    return target.querySelector<HTMLButtonElement>(`[data-part="pattern-warn-${name}"]`)!
}

beforeEach(() => {
    vi.useFakeTimers()
})

afterEach(async () => {
    for (const { target, app } of mounted.splice(0)) {
        await unmount(app as never)
        target.remove()
    }
    vi.restoreAllMocks()
    vi.useRealTimers()
})

describe('PatternWarning', () => {
    test('a danger primary ignores input for the arm delay and accepts it after', () => {
        const onanswer = vi.fn()
        const target = show(danger, onanswer)
        part(target, 'primary').click()
        vi.advanceTimersByTime(249)
        part(target, 'primary').click()
        expect(onanswer).not.toHaveBeenCalled()
        vi.advanceTimersByTime(1)
        part(target, 'primary').click()
        expect(onanswer).toHaveBeenCalledExactlyOnceWith('confirm')
    })

    test('the arm delay is read from the computed style when it is set', () => {
        const real = window.getComputedStyle.bind(window)
        vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
            const style = real(element, pseudo)
            vi.spyOn(style, 'getPropertyValue').mockImplementation((name) => (name === '--warning-arm-delay' ? '600ms' : ''))
            return style
        })
        const onanswer = vi.fn()
        const target = show(danger, onanswer)
        vi.advanceTimersByTime(500)
        part(target, 'primary').click()
        expect(onanswer).not.toHaveBeenCalled()
        vi.advanceTimersByTime(100)
        part(target, 'primary').click()
        expect(onanswer).toHaveBeenCalledWith('confirm')
    })

    test('a confirm sheet has no arm delay', () => {
        const onanswer = vi.fn()
        const target = show({ ...danger, severity: 'confirm' }, onanswer)
        part(target, 'primary').click()
        expect(onanswer).toHaveBeenCalledWith('confirm')
    })

    test('a repeated keydown on the primary is prevented so held Enter cannot confirm', () => {
        const target = show(danger)
        vi.advanceTimersByTime(300)
        const repeat = new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true, cancelable: true })
        part(target, 'primary').dispatchEvent(repeat)
        expect(repeat.defaultPrevented).toBe(true)
        const first = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
        part(target, 'primary').dispatchEvent(first)
        expect(first.defaultPrevented).toBe(false)
    })

    test('an unchecked acknowledgment keeps the primary disabled until it is checked', () => {
        const onanswer = vi.fn()
        const target = show({ severity: 'confirm', headline: 'Go?', ack: 'I understand', actions: { cancel: 'Cancel', primary: 'Go' } }, onanswer)
        const primary = part(target, 'primary')
        expect(primary.getAttribute('aria-disabled')).toBe('true')
        primary.click()
        expect(onanswer).not.toHaveBeenCalled()
        const box = target.querySelector<HTMLInputElement>('input[type="checkbox"]')!
        box.click()
        flushSync()
        expect(primary.hasAttribute('aria-disabled')).toBe(false)
        primary.click()
        expect(onanswer).toHaveBeenCalledWith('confirm')
    })

    test('five consequences show three and fold two behind one toggle', () => {
        const target = show({ severity: 'caution', headline: 'Careful', consequences: ['1', '2', '3', '4', '5'], detail: ['more text'], actions: { cancel: 'Cancel' } })
        expect(target.querySelectorAll('[data-part="pattern-warn-consequence"]').length).toBe(3)
        const toggle = part(target, 'detail-toggle')
        expect(toggle.textContent).toContain('2 more')
        const detail = part(target, 'detail')
        expect(detail.hidden).toBe(true)
        expect(toggle.getAttribute('aria-expanded')).toBe('false')
        toggle.click()
        flushSync()
        expect(detail.hidden).toBe(false)
        expect(toggle.getAttribute('aria-expanded')).toBe('true')
        expect(detail.textContent).toContain('4')
        expect(detail.textContent).toContain('more text')
    })

    test('three consequences and no detail have no toggle', () => {
        const target = show({ severity: 'caution', headline: 'Careful', consequences: ['1', '2', '3'], actions: { cancel: 'Cancel' } })
        expect(part(target, 'detail-toggle')).toBeNull()
    })

    test('a confirm or danger sheet missing cancel or primary throws', () => {
        expect(() => assertWarningActions({ severity: 'confirm', headline: 'x', actions: { primary: 'Go' } } as never)).toThrow()
        expect(() => assertWarningActions({ severity: 'danger', headline: 'x', actions: { cancel: 'No' } } as never)).toThrow()
        expect(() => assertWarningActions({ severity: 'caution', headline: 'x', actions: {} } as never)).toThrow()
        expect(() => assertWarningActions({ severity: 'blocked', headline: 'x', actions: { primary: 'Close' } })).not.toThrow()
        expect(() => show({ severity: 'confirm', headline: 'x', actions: { primary: 'Go' } } as never)).toThrow()
    })

    test('Cancel takes first focus and Escape answers cancel once', () => {
        const onanswer = vi.fn()
        const target = show(danger, onanswer)
        expect(document.activeElement).toBe(part(target, 'cancel'))
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
        expect(onanswer).toHaveBeenCalledExactlyOnceWith('cancel')
    })

    test('a sheet whose only action is not a cancel does not cancel on Escape', () => {
        const onanswer = vi.fn()
        const target = show({ severity: 'blocked', headline: 'Offline', actions: { primary: 'Close' } }, onanswer)
        expect(document.activeElement).toBe(part(target, 'primary'))
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
        expect(onanswer).not.toHaveBeenCalled()
    })

    test('the severity is a state attribute and the mark has a distinct shape per level', () => {
        const shapes = new Set<string>()
        for (const severity of ['notice', 'caution', 'confirm', 'danger', 'blocked'] as const) {
            const target = show({ severity, headline: severity, actions: { cancel: 'Close', primary: 'Go' } })
            expect(part(target, 'root').getAttribute('data-pattern-severity')).toBe(severity)
            shapes.add(part(target, 'mark').innerHTML)
        }
        expect(shapes.size).toBe(5)
    })
})

describe('patternWarning helpers', () => {
    test('splitConsequences keeps the first three', () => {
        expect(splitConsequences(['a', 'b', 'c', 'd'])).toEqual({ shown: ['a', 'b', 'c'], folded: ['d'] })
        expect(splitConsequences(undefined)).toEqual({ shown: [], folded: [] })
    })

    test('parseCssDuration reads ms and s and rejects anything else', () => {
        expect(parseCssDuration('250ms')).toBe(250)
        expect(parseCssDuration(' 0.25s ')).toBe(250)
        expect(parseCssDuration('')).toBeNull()
        expect(parseCssDuration('fast')).toBeNull()
    })

    test('armDelayMs falls back to 250 ms when the property is not set', () => {
        expect(armDelayMs(document.body)).toBe(250)
    })
})
