// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { FAR_MARGIN, NEAR_MARGIN, nearViewport } from './nearViewport.svelte'
import { FakeIntersectionObserver } from './tests/realAnimationShape'

/**
 * `nearViewport` takes optional bands per action instance. Setup, the fail-open path and destroy resolve the same
 * pair, so a custom band's observers are disconnected and hold no targets once the node is gone. `update()` swaps
 * only `onChange`; the bands are fixed at setup.
 */

const CUSTOM = { near: '50% 0px', far: '100% 0px' }
// Distinct from every default band, so a test can tell whose entry is whose.
const OWN = { near: '40% 0px', far: '80% 0px' }

function row() {
    const node = document.createElement('div')
    document.body.append(node)
    return node
}

function observersOf(margin: string) {
    return FakeIntersectionObserver.instances.filter((observer) => observer.rootMargin === margin)
}

beforeEach(() => {
    FakeIntersectionObserver.instances.length = 0
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
})

afterEach(() => {
    document.body.replaceChildren()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

describe('nearViewport margins', () => {
    test('G T2.4: without margins the shared 100% and 300% bands are used', () => {
        const node = row()
        const action = nearViewport(node, { onChange: () => {} })
        expect(observersOf(NEAR_MARGIN)).toHaveLength(1)
        expect(observersOf(FAR_MARGIN)).toHaveLength(1)
        expect(FakeIntersectionObserver.instances.map((observer) => observer.rootMargin).sort()).toEqual(['100% 0px', '300% 0px'])
        action.destroy()
    })

    test('G T2.4b: custom margins give the action its own observers at exactly those values', () => {
        const node = row()
        const action = nearViewport(node, { onChange: () => {}, margins: CUSTOM })
        expect(FakeIntersectionObserver.instances.map((observer) => observer.rootMargin).sort()).toEqual(['100% 0px', '50% 0px'])
        expect(observersOf('50% 0px')[0].targets.has(node)).toBe(true)
        expect(observersOf('100% 0px')[0].targets.has(node)).toBe(true)
        action.destroy()
    })

    test('G M-1: destroy tears down the custom-margin observers, not the default ones', () => {
        const node = row()
        const other = row()
        // A default-band neighbour shares the default entries and must keep them.
        const neighbour = nearViewport(other, { onChange: () => {} })
        const action = nearViewport(node, { onChange: () => {}, margins: OWN })
        const customObservers = [...observersOf(OWN.near), ...observersOf(OWN.far)]
        expect(customObservers).toHaveLength(2)
        for (const observer of customObservers) {
            expect(observer.targets.has(node)).toBe(true)
        }

        action.destroy()

        for (const observer of customObservers) {
            expect(observer.disconnect).toHaveBeenCalled()
            expect(observer.targets.size).toBe(0)
        }
        // The neighbour's default observers are untouched.
        for (const observer of [...observersOf(NEAR_MARGIN), ...observersOf(FAR_MARGIN)]) {
            expect(observer.disconnect).not.toHaveBeenCalled()
            expect(observer.targets.has(other)).toBe(true)
        }
        neighbour.destroy()
    })

    test('G M-1: a setup that throws leaves no custom-margin observer holding the node', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        const node = row()
        const observe = vi.spyOn(FakeIntersectionObserver.prototype, 'observe').mockImplementationOnce(function (this: FakeIntersectionObserver, target: Element) {
            this.targets.add(target)
            throw new Error('observe failed')
        })
        const onChange = vi.fn()
        const action = nearViewport(node, { onChange, margins: OWN })
        expect(observe).toHaveBeenCalled()
        // Fail open: the node reports visible, and every observer made for the custom bands has let go of it.
        expect(observersOf(OWN.near)).toHaveLength(1)
        expect(observersOf(OWN.far)).toHaveLength(1)
        expect(onChange).toHaveBeenCalledWith(true, node)
        for (const observer of [...observersOf(OWN.near), ...observersOf(OWN.far)]) {
            expect(observer.targets.has(node)).toBe(false)
            expect(observer.disconnect).toHaveBeenCalled()
        }
        action.destroy()
    })

    test('G: update() swaps the callback and keeps the bands fixed at setup', () => {
        const node = row()
        const first = vi.fn()
        const second = vi.fn()
        const action = nearViewport(node, { onChange: first, margins: CUSTOM })
        const before = FakeIntersectionObserver.instances.length

        action.update({ onChange: second, margins: { near: '10% 0px', far: '20% 0px' } })
        expect(FakeIntersectionObserver.instances).toHaveLength(before)
        expect(observersOf('10% 0px')).toHaveLength(0)

        FakeIntersectionObserver.send('50% 0px', node, true)
        expect(first).not.toHaveBeenCalled()
        expect(second).toHaveBeenCalledWith(true, node)
        action.destroy()
    })
})
