// @vitest-environment happy-dom

/**
 * `clampOverflow` reports whether a clamped element cuts its content off. It
 * measures through an injectable function (happy-dom has no layout), reports
 * on mount, on resize and on a `text` change, never repeats a result, and does
 * nothing while no `onChange` is given.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { clampOverflow, measureClamp } from '../clampOverflow.svelte'

class FakeResizeObserver {
    static instances: FakeResizeObserver[] = []
    observed: Element[] = []
    disconnected = false

    constructor(readonly callback: () => void) {
        FakeResizeObserver.instances.push(this)
    }

    observe(target: Element): void {
        this.observed.push(target)
    }

    disconnect(): void {
        this.disconnected = true
    }

    fire(): void {
        this.callback()
    }
}

afterEach(() => {
    vi.unstubAllGlobals()
    FakeResizeObserver.instances.length = 0
})

describe('clampOverflow', () => {
    test('measureClamp is true only while the content is taller than the box', () => {
        const node = document.createElement('div')
        Object.defineProperty(node, 'scrollHeight', { configurable: true, value: 90 })
        Object.defineProperty(node, 'clientHeight', { configurable: true, value: 60 })
        expect(measureClamp(node)).toBe(true)
        Object.defineProperty(node, 'clientHeight', { configurable: true, value: 90 })
        expect(measureClamp(node)).toBe(false)
    })

    test('reports the first measurement, a resize and a text change, and never repeats a result', async () => {
        vi.stubGlobal('ResizeObserver', FakeResizeObserver)
        const node = document.createElement('div')
        let clamped = true
        const onChange = vi.fn()
        const action = clampOverflow(node, { text: 'a', onChange, measure: () => clamped })
        expect(onChange.mock.calls).toEqual([[true]])

        FakeResizeObserver.instances[0].fire()
        expect(onChange).toHaveBeenCalledTimes(1)

        clamped = false
        FakeResizeObserver.instances[0].fire()
        expect(onChange.mock.calls).toEqual([[true], [false]])

        action.update({ text: 'a', onChange, measure: () => clamped })
        await Promise.resolve()
        expect(onChange).toHaveBeenCalledTimes(2)

        clamped = true
        action.update({ text: 'b', onChange, measure: () => clamped })
        await Promise.resolve()
        expect(onChange.mock.calls).toEqual([[true], [false], [true]])
    })

    test('a text change reports again even when the result is the same', async () => {
        const node = document.createElement('div')
        const onChange = vi.fn()
        const action = clampOverflow(node, { text: 'a', onChange, measure: () => true })
        action.update({ text: 'b', onChange, measure: () => true })
        await Promise.resolve()
        expect(onChange.mock.calls).toEqual([[true], [true]])
    })

    test('without onChange it neither observes nor measures, and starts once one is given', async () => {
        vi.stubGlobal('ResizeObserver', FakeResizeObserver)
        const node = document.createElement('div')
        const measure = vi.fn(() => true)
        const action = clampOverflow(node, { text: 'a', measure })
        expect(FakeResizeObserver.instances.length).toBe(0)
        expect(measure).not.toHaveBeenCalled()

        const onChange = vi.fn()
        action.update({ text: 'a', onChange, measure })
        await Promise.resolve()
        expect(FakeResizeObserver.instances.length).toBe(1)
        expect(onChange.mock.calls).toEqual([[true]])

        action.update({ text: 'a', measure })
        await Promise.resolve()
        expect(FakeResizeObserver.instances[0].disconnected).toBe(true)
    })

    test('destroy disconnects the observer', () => {
        vi.stubGlobal('ResizeObserver', FakeResizeObserver)
        const node = document.createElement('div')
        const action = clampOverflow(node, { text: 'a', onChange: () => {}, measure: () => false })
        action.destroy()
        expect(FakeResizeObserver.instances[0].disconnected).toBe(true)
    })

    test('measures at mount without a ResizeObserver global', () => {
        vi.stubGlobal('ResizeObserver', undefined)
        const node = document.createElement('div')
        const onChange = vi.fn()
        const action = clampOverflow(node, { text: 'a', onChange, measure: () => true })
        expect(onChange.mock.calls).toEqual([[true]])
        expect(() => action.destroy()).not.toThrow()
    })
})
