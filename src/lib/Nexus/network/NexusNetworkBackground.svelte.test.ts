import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { setLowPower, setReducedMotion } from 'src/ts/chatShell/motionPrefs.svelte'
import type { NetworkField, NetworkFieldOptions } from './nexusNetwork'

const created: Array<{ canvas: HTMLCanvasElement, options: NetworkFieldOptions, field: NetworkField & { destroy: ReturnType<typeof vi.fn> } }> = []

vi.mock('./nexusNetwork', () => ({
    createNetworkField: vi.fn((canvas: HTMLCanvasElement, options: NetworkFieldOptions) => {
        const field = { destroy: vi.fn(), time: () => (options.startTime ?? 0) + 5 }
        created.push({ canvas, options, field })
        return field
    }),
}))

import NexusNetworkBackground from './NexusNetworkBackground.svelte'

const mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

function mountBackground(props: Record<string, unknown> = {}): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(NexusNetworkBackground, { target, props }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return target
}

function setOsReduced(reduced: boolean): void {
    vi.stubGlobal('matchMedia', (query: string) => ({
        matches: reduced && query.includes('prefers-reduced-motion'),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
    }))
}

const frozen = (options: NetworkFieldOptions): boolean => options.still === true || options.reducedMotion === true
const live = (): number => created.filter((entry) => entry.field.destroy.mock.calls.length === 0).length

beforeEach(() => {
    created.length = 0
    setOsReduced(false)
})

afterEach(async () => {
    for (const { target, app } of mounted.splice(0)) {
        await unmount(app as never)
        target.remove()
    }
    setReducedMotion('system')
    setLowPower(false)
    localStorage.clear()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

describe('motion resolution', () => {
    test('C1: a default mount makes one animated field', () => {
        mountBackground()
        expect(created).toHaveLength(1)
        expect(frozen(created[0].options)).toBe(false)
        expect(created[0].options.lowPower).toBe(false)
    })

    test('C2: the app Reduce motion On freezes on an OS that does not reduce', () => {
        setReducedMotion('on')
        mountBackground()
        expect(frozen(created[0].options)).toBe(true)
    })

    test('C3: the app Reduce motion Off animates on an OS that reduces', () => {
        setOsReduced(true)
        setReducedMotion('off')
        mountBackground()
        expect(frozen(created[0].options)).toBe(false)
    })

    test('C4: following the system on an OS that reduces freezes', () => {
        setOsReduced(true)
        mountBackground()
        expect(frozen(created[0].options)).toBe(true)
    })

    test('C5: the app Low power freezes and makes the field coarse', () => {
        setLowPower(true)
        mountBackground()
        expect(frozen(created[0].options)).toBe(true)
        expect(created[0].options.lowPower).toBe(true)
    })

    test('C6: a still prop freezes', () => {
        mountBackground({ still: true })
        expect(frozen(created[0].options)).toBe(true)
    })

    test('C7: a runtime switch replaces the field and carries the wave phase', () => {
        mountBackground()
        expect(frozen(created[0].options)).toBe(false)
        setReducedMotion('on')
        flushSync()
        expect(created).toHaveLength(2)
        expect(created[0].field.destroy).toHaveBeenCalledTimes(1)
        expect(frozen(created[1].options)).toBe(true)
        expect(created[1].options.startTime).toBe(created[0].field.time())
        expect(live()).toBe(1)
        setReducedMotion('system')
        flushSync()
        expect(created).toHaveLength(3)
        expect(frozen(created[2].options)).toBe(false)
        expect(created[2].options.startTime).toBe(created[1].field.time())
        expect(live()).toBe(1)
    })
})

describe('pause and tint', () => {
    test('C8: paused runs no field, and resuming makes exactly one', () => {
        const props = $state({ paused: true })
        mountBackground(props)
        expect(created).toHaveLength(0)
        props.paused = false
        flushSync()
        expect(live()).toBe(1)
        props.paused = true
        flushSync()
        expect(live()).toBe(0)
        expect(created).toHaveLength(1)
    })

    test('C9: tint inherit passes the canvas computed colour; otherwise none', () => {
        const spy = vi.spyOn(window, 'getComputedStyle').mockReturnValue({ color: 'rgb(9, 8, 7)' } as unknown as CSSStyleDeclaration)
        mountBackground({ tint: 'inherit' })
        expect(created[0].options.colour).toBe('rgb(9, 8, 7)')
        mountBackground()
        expect(created[1].options.colour).toBeUndefined()
        spy.mockReturnValue({ color: '' } as unknown as CSSStyleDeclaration)
        mountBackground({ tint: 'inherit' })
        expect(created[2].options.colour).toBeUndefined()
    })

    test('C11: canWave reaches the field by reference', () => {
        const canWave = (): boolean => true
        mountBackground({ canWave })
        mountBackground()
        expect(created[0].options.canWave).toBe(canWave)
        expect(created[1].options.canWave).toBeUndefined()
    })
})

describe('markup', () => {
    test('C10: the canvas is hidden from assistive tech, ignores pointers and is placed by its parent', () => {
        const target = mountBackground()
        const canvas = target.querySelector('canvas')!
        expect(canvas.getAttribute('aria-hidden')).toBe('true')
        const classes = Array.from(canvas.classList)
        for (const name of ['pointer-events-none', 'absolute', 'inset-0']) expect(classes).toContain(name)
        expect(classes).not.toContain('fixed')
        expect(classes).not.toContain('z-0')
    })
})
