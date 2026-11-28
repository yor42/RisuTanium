// @vitest-environment jsdom

/**
 * A `disableable` slider stores "off" as -1000 (upstream's value). While off it shows the visible "Off" caption and is inert, so the
 * checkbox is the only way back on; turning it on restores the last value seen while on, never one remembered from another preset.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test } from 'vitest'
import { language } from 'src/lang'
import SliderInput from './SliderInput.svelte'

interface Rig { target: HTMLElement, app: Record<string, unknown>, state: { v: number | undefined, key: string | object | undefined } }
let rigs: Rig[] = []

function render(initial: number | undefined, extra: Record<string, unknown> = {}, key: string | object | null = 'a'): Rig {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const state = $state<{ v: number | undefined, key: string | object | undefined }>({ v: initial, key: key ?? undefined })
    const props = {
        min: 0, max: 10, step: 1, label: 'Field', disableable: true, ...extra,
        get memoryKey() { return state.key },
        get value() { return state.v },
        set value(x: number | undefined) { state.v = x },
    }
    const app = mount(SliderInput as never, { target, props }) as unknown as Record<string, unknown>
    const rig = { target, app, state }
    rigs.push(rig)
    flushSync()
    return rig
}

const box = (r: Rig) => r.target.querySelector<HTMLInputElement>('input[type="checkbox"]')!
const slider = (r: Rig) => r.target.querySelector<HTMLElement>('[role="slider"]')!

afterEach(async () => {
    for (const r of rigs) {
        await unmount(r.app as never)
        r.target.remove()
    }
    rigs = []
})

describe('SliderInput off switch', () => {
    test('compatibility guard: the toggle writes -1000 for off, and -1000 or undefined read as off', () => {
        const a = render(4)
        expect(box(a).checked).toBe(true)
        box(a).click()
        flushSync()
        expect(a.state.v).toBe(-1000)
        expect(box(a).checked).toBe(false)
        const b = render(undefined)
        expect(box(b).checked).toBe(false)
    })

    test('regression reproducer: an off slider shows the Off caption and is inert', () => {
        const r = render(-1000)
        expect(slider(r).textContent?.trim()).toBe(language.optOff)
        expect(slider(r).getAttribute('aria-disabled')).toBe('true')
        slider(r).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
        flushSync()
        expect(r.state.v).toBe(-1000)
        slider(r).dispatchEvent(new Event('pointerdown', { bubbles: true }))
        flushSync()
        expect(r.state.v).toBe(-1000)
    })

    test('compatibility guard: an on slider is interactive and not marked disabled', () => {
        const r = render(3)
        expect(slider(r).hasAttribute('aria-disabled')).toBe(false)
        slider(r).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
        flushSync()
        expect(r.state.v).toBe(4)
    })

    test('regression reproducer: off then on restores the number the toggle turned off', () => {
        const r = render(7)
        box(r).click()
        flushSync()
        expect(r.state.v).toBe(-1000)
        box(r).click()
        flushSync()
        expect(r.state.v).toBe(7)
    })

    test('regression reproducer: a value changed while on is the one restored', () => {
        const r = render(7)
        r.state.v = 2
        flushSync()
        box(r).click()
        flushSync()
        box(r).click()
        flushSync()
        expect(r.state.v).toBe(2)
    })

    test('compatibility guard (mutant: remembers without a token): with no subject token the toggle restores the range minimum', () => {
        const r = render(7, {}, null)
        box(r).click()
        flushSync()
        box(r).click()
        flushSync()
        expect(r.state.v).toBe(0)
    })

    test('compatibility guard (mutant: token comparison removed): a changed token while off restores the minimum, including a structurally equal clone', () => {
        const r = render(7, {}, { id: 'p' })
        box(r).click()
        flushSync()
        r.state.key = { id: 'p' }
        flushSync()
        box(r).click()
        flushSync()
        expect(r.state.v).toBe(0)
        const q = render(7)
        box(q).click()
        flushSync()
        q.state.key = 'b'
        flushSync()
        box(q).click()
        flushSync()
        expect(q.state.v).toBe(0)
    })

    test('compatibility guard: a token change while on, then off and on, restores the current value', () => {
        const r = render(7)
        r.state.key = 'b'
        flushSync()
        box(r).click()
        flushSync()
        box(r).click()
        flushSync()
        expect(r.state.v).toBe(7)
    })

    test('compatibility guard (mutant: clear-on-observed-on removed): an external on between off and on drops the memory', () => {
        const r = render(7)
        box(r).click()
        flushSync()
        r.state.v = 4
        flushSync()
        r.state.v = -1000
        flushSync()
        box(r).click()
        flushSync()
        expect(r.state.v).toBe(0)
    })

    test('compatibility guard: with no remembered value the toggle restores the range minimum', () => {
        const r = render(-1000, { min: 2 })
        box(r).click()
        flushSync()
        expect(r.state.v).toBe(2)
    })
})
