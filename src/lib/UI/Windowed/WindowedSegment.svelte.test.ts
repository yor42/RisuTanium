// @vitest-environment jsdom

/**
 * `WindowedSegment` and its host in a harness (`WindowedSegment.harness.test.svelte`). New-API
 * guards (compatibility class), not reproducers of a base defect.
 *
 * MOCKED: geometry through `setWindowGeometryForTests` (no layout in jsdom; the test sets the
 * rects and runs frames) and `ResizeObserver` (a stub reporting what the test hands it). Scroll
 * anchoring itself is a browser behaviour and is not exercised here: the style tests only guard
 * where `overflow-anchor: none` is and is not written.
 */
import { mount, tick, unmount, type ComponentProps } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { setWindowGeometryForTests, type WindowHost } from '../../../ts/windowing/windowHost.svelte'
import Harness from './WindowedSegment.harness.test.svelte'

const keys = (n: number, prefix = 'k') => Array.from({ length: n }, (_, i) => `${prefix}${i}`)

type Rect = { top: number; height: number }
const rects = new Map<Element, Rect>()
let frames: Array<() => void> = []

class FakeResizeObserver {
    static instances: FakeResizeObserver[] = []
    observed = new Set<Element>()
    constructor(readonly callback: (records: unknown[]) => void) {
        FakeResizeObserver.instances.push(this)
    }
    observe(target: Element) {
        this.observed.add(target)
    }
    unobserve(target: Element) {
        this.observed.delete(target)
    }
    disconnect() {
        this.observed.clear()
    }
    report(target: Element, height: number) {
        this.callback([{ target, borderBoxSize: [{ blockSize: height }], contentRect: { height } }])
    }
}

async function settle(): Promise<void> {
    // Svelte's async-mode tick resolves on a zero timer, which the fake clock holds back.
    for (let i = 0; i < 4; i++) {
        const pending = tick()
        await vi.advanceTimersByTimeAsync(0)
        await pending
    }
}

let mounted: Array<ReturnType<typeof mount>> = []

interface View {
    host: WindowHost
    target: HTMLElement
    box: HTMLElement | null
    root: HTMLElement
    segment(i: number): HTMLElement
    rows(i?: number): string[]
}

async function render(props: Omit<ComponentProps<typeof Harness>, 'onHost'>): Promise<View> {
    let host: WindowHost | undefined
    const target = document.body.appendChild(document.createElement('div'))
    mounted.push(mount(Harness, { target, props: { ...props, onHost: (h: WindowHost) => { host = h } } }))
    await settle()
    const root = target.querySelector<HTMLElement>('[data-testid=root]') as HTMLElement
    const segment = (i: number) => root.querySelector<HTMLElement>(`[data-testid=segment-${i}]`) as HTMLElement
    return {
        host: host as WindowHost,
        target,
        box: target.querySelector<HTMLElement>('[data-testid=box]'),
        root,
        segment,
        rows: (i = 0) => Array.from(segment(i).querySelectorAll('[data-window-key]')).map((row) => row.getAttribute('data-window-key') as string),
    }
}

function runFrames(): void {
    const pending = frames
    frames = []
    for (const frame of pending) {
        frame()
    }
}

const px = (element: Element) => parseFloat((element as HTMLElement).style.height)
const spacersOf = (segment: HTMLElement) => Array.from(segment.querySelectorAll('[data-window-spacer]'))

beforeEach(() => {
    vi.useFakeTimers()
    rects.clear()
    frames = []
    FakeResizeObserver.instances = []
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    setWindowGeometryForTests({
        rectOf: (element) => rects.get(element) ?? { top: 0, height: 0 },
        viewport: () => 600,
        scrollBy: () => {},
        schedule: (callback) => {
            frames.push(callback)
            return () => {
                frames = frames.filter((frame) => frame !== callback)
            }
        },
    })
})

afterEach(() => {
    for (const component of mounted) {
        unmount(component)
    }
    mounted = []
    document.body.innerHTML = ''
    setWindowGeometryForTests(undefined)
    vi.unstubAllGlobals()
    vi.useRealTimers()
})

describe('fixed segments (W3)', () => {
    test('a fixed segment constructs no ResizeObserver and lays rows out at i * (height + gap)', async () => {
        const view = await render({ segments: [keys(100)], fixedPx: 50, gap: 8 })
        expect(FakeResizeObserver.instances).toHaveLength(0)
        const rows = view.rows()
        expect(rows[0]).toBe('k0')
        expect(rows).toHaveLength(13)
        const [bottom] = spacersOf(view.segment(0))
        // 100 slots of 58 px, 13 mounted, less the one gap the flex layout adds after the spacer.
        expect(px(bottom)).toBe(87 * 58 - 8)
    })

    test('a measured segment does construct one', async () => {
        await render({ segments: [keys(10)], fallback: 50 })
        expect(FakeResizeObserver.instances).toHaveLength(1)
    })
})

describe('heights (W9)', () => {
    test('a stored height outlives the row and is shared by two segments through one map', async () => {
        const heights = new Map<string, number>()
        const view = await render({ segments: [keys(30, 'a'), keys(30, 'b')], fallback: 50, heights })
        const observer = FakeResizeObserver.instances[0]
        const a3 = view.segment(0).querySelector('[data-window-key=a3]') as HTMLElement
        const b3 = view.segment(1).querySelector('[data-window-key=b3]') as HTMLElement
        observer.report(a3, 200)
        observer.report(b3, 90)
        expect(heights.get('a3')).toBe(200)
        expect(heights.get('b3')).toBe(90)

        // Both segments scroll far above the band: nothing is mounted, one spacer stands for each.
        rects.set(view.segment(0), { top: -50000, height: 0 })
        rects.set(view.segment(1), { top: -48000, height: 0 })
        view.host.refresh()
        await settle()
        expect(view.rows(0)).toEqual([])
        expect(view.rows(1)).toEqual([])
        expect(view.host.isMounted('a3')).toBe(false)
        expect(heights.get('a3')).toBe(200)
        expect(spacersOf(view.segment(0)).map(px)).toEqual([29 * 50 + 200])
        expect(spacersOf(view.segment(1)).map(px)).toEqual([29 * 50 + 90])
    })
})

describe('pins (W10)', () => {
    test('a far caller pin is mounted and a pin that is not in keys is ignored', async () => {
        const view = await render({ segments: [keys(100)], fallback: 50, pinned: ['k90', 'nope'] })
        expect(view.rows()).toContain('k90')
        expect(view.rows()).not.toContain('nope')
        expect(view.rows()).toContain('k0')
        expect(view.rows()).not.toContain('k50')
    })

    test('the focused row stays mounted while the band is elsewhere and is released by blur', async () => {
        const view = await render({ segments: [keys(100)], fixedPx: 50 })
        const button = view.segment(0).querySelector<HTMLElement>('[data-testid=row-k5] ') ?? (view.target.querySelector('[data-testid=row-k5]') as HTMLElement)
        button.focus()
        await settle()
        expect(view.host.focusedKey).toBe('k5')
        rects.set(view.segment(0), { top: -9000, height: 0 })
        view.host.refresh()
        await settle()
        expect(view.rows()).toEqual(['k5'])
        ;(document.activeElement as HTMLElement).blur()
        await settle()
        expect(view.host.focusedKey).toBeNull()
        expect(view.rows()).toEqual([])
    })
})

describe('markup (W11)', () => {
    test('index is the position in keys for window and pins; aria positions are per segment; spacers are hidden', async () => {
        const view = await render({ segments: [keys(100)], fixedPx: 50, pinned: ['k90'] })
        rects.set(view.segment(0), { top: -2000, height: 0 })
        view.host.refresh()
        await settle()
        const rows = view.rows()
        // Band at 0..600 over a segment 2000 px up, narrow overscan of 100 px: the window starts at row 38; k90 is pinned.
        expect(rows[0]).toBe('k38')
        expect(rows.at(-1)).toBe('k90')
        expect([...rows].sort((a, b) => parseInt(a.slice(1)) - parseInt(b.slice(1)))).toEqual(rows)
        for (const key of rows) {
            const wrapper = view.segment(0).querySelector(`[data-window-key=${key}]`) as HTMLElement
            const index = parseInt(key.slice(1))
            expect(wrapper.getAttribute('aria-posinset')).toBe(String(index + 1))
            expect(wrapper.getAttribute('aria-setsize')).toBe('100')
            expect(wrapper.getAttribute('role')).toBe('listitem')
            expect(wrapper.querySelector('button')?.textContent).toBe(`${key}@${index}`)
        }
        const spacers = spacersOf(view.segment(0))
        expect(spacers.length).toBeGreaterThan(0)
        for (const spacer of spacers) {
            expect(spacer.getAttribute('aria-hidden')).toBe('true')
            expect(spacer.getAttribute('role')).toBe('presentation')
        }
        expect(view.segment(0).getAttribute('role')).toBe('list')
    })

    test('a ul segment renders li wrappers and spacers without list roles', async () => {
        const view = await render({ segments: [keys(100)], fixedPx: 50, tag: 'ul' })
        expect(view.segment(0).tagName).toBe('UL')
        expect(view.segment(0).hasAttribute('role')).toBe(false)
        const wrapper = view.segment(0).querySelector('[data-window-key]') as HTMLElement
        expect(wrapper.tagName).toBe('LI')
        expect(wrapper.hasAttribute('role')).toBe(false)
        expect((spacersOf(view.segment(0))[0] as HTMLElement).tagName).toBe('LI')
    })
})

describe('styles and anchoring placement (W14)', () => {
    const watched = (view: View) => [view.root, view.box, document.body, document.documentElement].map((element) => element?.getAttribute('style') ?? null)

    test.each(['nearest', 'own', 'window'] as const)('every spacer has overflow-anchor none, no wrapper has it, and root, scroller and ancestors are never written (%s)', async (scroller) => {
        let host: WindowHost | undefined
        const target = document.body.appendChild(document.createElement('div'))
        const component = mount(Harness, { target, props: { segments: [keys(100), keys(100, 'm')], fallback: 50, scroller, onHost: (h: WindowHost) => { host = h } } })
        mounted.push(component)
        const root = target.querySelector<HTMLElement>('[data-testid=root]') as HTMLElement
        const box = target.querySelector<HTMLElement>('[data-testid=box]')
        const view = { root, box } as View
        const before = watched(view)
        await settle()

        const observer = FakeResizeObserver.instances[0]
        const row = root.querySelector('[data-window-key]') as HTMLElement
        rects.set(root.children[1], { top: -3000, height: 0 })
        ;(box ?? window).dispatchEvent(new Event('scroll'))
        runFrames()
        observer.report(row, 77)
        observer.report(root, 1)
        await settle()
        const spacers = Array.from(root.querySelectorAll('[data-window-spacer]'))
        expect(spacers.length).toBeGreaterThan(0)
        for (const spacer of spacers) {
            expect(spacer.getAttribute('style')).toContain('overflow-anchor: none')
        }
        for (const wrapper of Array.from(root.querySelectorAll('[data-window-key]'))) {
            expect(wrapper.getAttribute('style') ?? '').not.toContain('overflow-anchor')
        }
        expect(watched(view)).toEqual(before)
        ;(host as WindowHost).dispose()
        expect(watched(view)).toEqual(before)
    })
})

describe('missing ResizeObserver (W15)', () => {
    test('a measured segment renders and unmounts without one', async () => {
        vi.stubGlobal('ResizeObserver', undefined)
        const errors: unknown[] = []
        const collect = (error: unknown) => errors.push(error)
        process.on('unhandledRejection', collect)
        process.on('uncaughtException', collect)
        try {
            const view = await render({ segments: [keys(100)], fallback: 50 })
            await settle()
            expect(errors).toEqual([])
            expect(view.rows().length).toBeGreaterThan(0)
            expect(spacersOf(view.segment(0)).map(px)).toEqual([(100 - view.rows().length) * 50])
        }
        finally {
            process.off('unhandledRejection', collect)
            process.off('uncaughtException', collect)
        }
    })

    test('the fallback heights alone size the spacers', async () => {
        vi.stubGlobal('ResizeObserver', undefined)
        const view = await render({ segments: [keys(100)], fallback: 50 })
        expect(view.rows().length).toBeGreaterThan(0)
        expect(spacersOf(view.segment(0)).map(px)).toEqual([(100 - view.rows().length) * 50])
    })
})
