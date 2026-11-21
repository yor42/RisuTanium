// @vitest-environment jsdom

/**
 * The windowing host driven through the real `WindowedSegment` in a harness. New-module guards
 * (compatibility class): there is no base behaviour to reproduce.
 *
 * MOCKED: geometry through `setWindowGeometryForTests` (jsdom has no layout; rects are the
 * test's, frames run when the test says so) and `ResizeObserver` (a stub that reports what the
 * test hands it). Native scroll anchoring cannot be exercised in jsdom.
 */
import { flushSync, mount, tick, unmount, type ComponentProps } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import Harness from '../../lib/UI/Windowed/WindowedSegment.harness.test.svelte'
import { REVEAL_PIN_TIMEOUT_MS } from '../../lib/SideBars/railConstants'
import { WIDEN_DELAY_MS } from './listWindow'
import { createWindowHost, setWindowGeometryForTests, type WindowHost } from './windowHost.svelte'

const keys = (n: number, prefix = 'k') => Array.from({ length: n }, (_, i) => `${prefix}${i}`)

type Rect = { top: number; height: number }
const rects = new Map<Element, Rect>()
let frames: Array<() => void> = []
const scrollBy = vi.fn()

function runFrames(): void {
    const pending = frames
    frames = []
    for (const frame of pending) {
        frame()
    }
}

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
    report(...entries: Array<{ target: Element; height?: number; contentOnly?: number }>) {
        this.callback(entries.map(({ target, height, contentOnly }) => ({
            target,
            borderBoxSize: height === undefined ? undefined : [{ blockSize: height }],
            contentRect: { height: contentOnly ?? height ?? 0 },
        })))
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

/** `reveal` waits for a Svelte tick, which the fake clock holds back until it is advanced. */
async function reveal(host: WindowHost, key: string, options?: { scroll?: boolean }): Promise<HTMLElement | null> {
    const result = host.reveal(key, options)
    await vi.advanceTimersByTimeAsync(0)
    return result
}

let mounted: Array<ReturnType<typeof mount>> = []

async function render(props: Omit<ComponentProps<typeof Harness>, 'onHost'>): Promise<{ host: WindowHost; box: HTMLElement | null; root: HTMLElement }> {
    let host: WindowHost | undefined
    const target = document.body.appendChild(document.createElement('div'))
    mounted.push(mount(Harness, { target, props: { ...props, onHost: (h: WindowHost) => { host = h } } }))
    await settle()
    const root = target.querySelector<HTMLElement>('[data-testid=root]') as HTMLElement
    return { host: host as WindowHost, box: target.querySelector<HTMLElement>('[data-testid=box]'), root }
}

beforeEach(() => {
    vi.useFakeTimers()
    rects.clear()
    frames = []
    scrollBy.mockReset()
    FakeResizeObserver.instances = []
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    setWindowGeometryForTests({
        rectOf: (element) => rects.get(element) ?? { top: 0, height: 0 },
        viewport: () => 600,
        scrollBy: (scroller, dy) => scrollBy(scroller, dy),
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

describe('overscan phase (W6)', () => {
    test('a key change narrows, two changes widen once 150 ms after the second, a scroll frame widens at once', async () => {
        const props = $state({ segments: [keys(60)], fallback: 50 })
        let host!: WindowHost
        const target = document.body.appendChild(document.createElement('div'))
        mounted.push(mount(Harness, { target, props: { get segments() { return props.segments }, fallback: 50, onHost: (h: WindowHost) => { host = h } } }))
        await settle()
        const transitions: string[] = []
        const stop = $effect.root(() => {
            $effect(() => {
                transitions.push(host.phase)
            })
        })
        expect(host.phase).toBe('narrow')
        vi.advanceTimersByTime(WIDEN_DELAY_MS)
        await settle()
        expect(host.phase).toBe('wide')

        transitions.length = 0
        props.segments = [keys(59)]
        await settle()
        expect(host.phase).toBe('narrow')
        vi.advanceTimersByTime(100)
        props.segments = [keys(58)]
        await settle()
        vi.advanceTimersByTime(WIDEN_DELAY_MS - 1)
        await settle()
        expect(host.phase).toBe('narrow')
        vi.advanceTimersByTime(1)
        await settle()
        expect(host.phase).toBe('wide')
        expect(transitions.filter((phase) => phase === 'wide')).toHaveLength(1)

        props.segments = [keys(57)]
        await settle()
        expect(host.phase).toBe('narrow')
        host.scroller?.dispatchEvent(new Event('scroll'))
        expect(host.phase).toBe('narrow')
        runFrames()
        await settle()
        expect(host.phase).toBe('wide')
        stop()
    })
})

describe('scroller resolution (W7)', () => {
    test('nearest overflow-y ancestor, the window when there is none, an own scroller by option', async () => {
        const nearest = await render({ segments: [keys(3)], scroller: 'nearest' })
        expect(nearest.host.scroller).toBe(nearest.box)

        const windowed = await render({ segments: [keys(3)], scroller: 'window' })
        expect(windowed.host.scroller).toBeNull()

        const own = await render({ segments: [keys(3)], scroller: 'own' })
        expect(own.box?.style.overflowY).toBe('')
        expect(own.host.scroller).toBe(own.box)
    })

    test('the band is the scroller rect clipped to the viewport, and falls back to the viewport height', async () => {
        const { host, box } = await render({ segments: [keys(40)], scroller: 'nearest' })
        rects.set(box as HTMLElement, { top: -40, height: 300 })
        host.refresh()
        expect([host.bandTop, host.bandHeight]).toEqual([0, 260])
        rects.set(box as HTMLElement, { top: 500, height: 300 })
        host.refresh()
        expect([host.bandTop, host.bandHeight]).toEqual([500, 100])
        rects.set(box as HTMLElement, { top: 0, height: 0 })
        host.refresh()
        expect([host.bandTop, host.bandHeight]).toEqual([0, 600])
    })
})

describe('writes only on change (W8)', () => {
    test('unchanged reads and empty, zero or content-box-only reports write nothing', async () => {
        const heights = new Map<string, number>()
        const set = vi.spyOn(heights, 'set')
        const { host, root } = await render({ segments: [keys(40)], fallback: 50, heights })
        const observer = FakeResizeObserver.instances[0]
        const row = root.querySelector<HTMLElement>('[data-window-key=k3]') as HTMLElement
        expect(observer.observed.has(row)).toBe(true)

        let runs = 0
        const stop = $effect.root(() => {
            $effect(() => {
                void host.bandTop
                void host.bandHeight
                runs++
            })
        })
        flushSync()
        const before = runs
        host.refresh()
        host.refresh()
        observer.report({ target: root })
        await settle()
        expect(runs).toBe(before)

        observer.report({ target: row, height: 0 }, { target: row, contentOnly: 77 }, { target: document.body, height: 10 })
        expect(set).not.toHaveBeenCalled()

        observer.report({ target: row, height: 61 })
        expect(set).toHaveBeenCalledTimes(1)
        observer.report({ target: row, height: 61 })
        expect(set).toHaveBeenCalledTimes(1)
        stop()
    })
})

describe('reveal (W12)', () => {
    async function farList() {
        const heights = new Map<string, number>()
        const view = await render({ segments: [keys(200)], fixedPx: 50, scroller: 'nearest' })
        rects.set(view.box as HTMLElement, { top: 0, height: 300 })
        view.host.refresh()
        await settle()
        return { ...view, heights }
    }

    test('resolves to the element after the flush and pins it far from the band; the pin is released by focus', async () => {
        const { host, root } = await farList()
        expect(root.querySelector('[data-window-key=k150]')).toBeNull()
        const element = await reveal(host, 'k150')
        expect(element).toBe(root.querySelector('[data-window-key=k150]'))
        expect(host.isMounted('k150')).toBe(true)
        expect(host.revealKey).toBe('k150')

        element?.querySelector('button')?.focus()
        await settle()
        expect(host.revealKey).toBeNull()
        expect(host.focusedKey).toBe('k150')
        expect(root.querySelector('[data-window-key=k150]')).not.toBeNull()
    })

    test('scrolls an element outside the band into it unless asked not to', async () => {
        const { host } = await farList()
        const first = await reveal(host, 'k150', { scroll: false })
        expect(first).not.toBeNull()
        expect(scrollBy).not.toHaveBeenCalled()
        rects.set(first as Element, { top: 7000, height: 50 })
        await reveal(host, 'k150')
        expect(scrollBy).toHaveBeenCalledTimes(1)
        expect(scrollBy.mock.calls[0][1]).toBeGreaterThan(6000)
    })

    test('a second reveal replaces the first and releases the first row', async () => {
        const { host, root } = await farList()
        await reveal(host, 'k150')
        await reveal(host, 'k170')
        await settle()
        expect(host.revealKey).toBe('k170')
        expect(root.querySelector('[data-window-key=k150]')).toBeNull()
        expect(root.querySelector('[data-window-key=k170]')).not.toBeNull()
    })

    test('an absent key resolves to null and pins nothing', async () => {
        const { host } = await farList()
        expect(await reveal(host, 'nope')).toBeNull()
        expect(host.revealKey).toBeNull()
    })

    test('the pin ends by timeout', async () => {
        const { host, root } = await farList()
        await reveal(host, 'k150')
        vi.advanceTimersByTime(REVEAL_PIN_TIMEOUT_MS)
        await settle()
        expect(host.revealKey).toBeNull()
        expect(root.querySelector('[data-window-key=k150]')).toBeNull()
    })

    test('the pin ends when the key leaves the keys', async () => {
        const props = $state({ segments: [keys(200)] })
        let host!: WindowHost
        const target = document.body.appendChild(document.createElement('div'))
        mounted.push(mount(Harness, { target, props: { get segments() { return props.segments }, fixedPx: 50, onHost: (h: WindowHost) => { host = h } } }))
        await settle()
        await reveal(host, 'k150')
        expect(host.revealKey).toBe('k150')
        props.segments = [keys(100)]
        await settle()
        expect(host.revealKey).toBeNull()
    })
})

describe('missing ResizeObserver (W15)', () => {
    test('mount, scroll and dispose do not throw and the fallback heights are used', async () => {
        vi.stubGlobal('ResizeObserver', undefined)
        const errors: unknown[] = []
        const collect = (error: unknown) => errors.push(error)
        process.on('unhandledRejection', collect)
        process.on('uncaughtException', collect)
        const { host, root, box } = await render({ segments: [keys(100)], fallback: 50, scroller: 'nearest' })
        await settle()
        process.off('unhandledRejection', collect)
        process.off('uncaughtException', collect)
        expect(errors).toEqual([])
        expect(FakeResizeObserver.instances).toHaveLength(0)
        const spacer = root.querySelector<HTMLElement>('[data-window-spacer]') as HTMLElement
        const rows = root.querySelectorAll('[data-window-key]').length
        expect(rows).toBeGreaterThan(0)
        const total = Array.from(root.children[0].children).reduce((sum, child) => sum + (child.hasAttribute('data-window-spacer') ? parseFloat((child as HTMLElement).style.height) : 50), 0)
        expect(total).toBe(5000)
        expect(spacer).toBeTruthy()
        box?.dispatchEvent(new Event('scroll'))
        runFrames()
        await settle()
        expect(() => host.dispose()).not.toThrow()
    })
})

describe('root observation (W16)', () => {
    test('a report for root re-reads the segment top and the window follows', async () => {
        const { host, root, box } = await render({ segments: [keys(200)], fallback: 50, scroller: 'nearest' })
        rects.set(box as HTMLElement, { top: 0, height: 300 })
        host.refresh()
        vi.advanceTimersByTime(WIDEN_DELAY_MS)
        await settle()
        const observer = FakeResizeObserver.instances[0]
        expect(observer.observed.has(root)).toBe(true)
        const before = host.mountedKeys.size

        rects.set(root.children[0], { top: 300, height: 10000 })
        observer.report({ target: root })
        await settle()
        expect(host.mountedKeys.size).toBeLessThan(before)
        expect(host.isMounted('k0')).toBe(true)
        expect(host.isMounted('k1')).toBe(true)
    })
})

describe('a root the consumer re-creates (W17)', () => {
    function build(key: string): { box: HTMLElement; root: HTMLElement; list: HTMLElement; item: HTMLElement; button: HTMLButtonElement } {
        const box = document.body.appendChild(document.createElement('div'))
        box.style.overflowY = 'auto'
        const root = box.appendChild(document.createElement('section'))
        const list = root.appendChild(document.createElement('ul'))
        const item = list.appendChild(document.createElement('li'))
        item.setAttribute('data-window-key', key)
        const button = item.appendChild(document.createElement('button'))
        return { box, root, list, item, button }
    }

    test('the focus pin, the reveal, the scroller and the size observation follow the new root, and the old one keeps nothing', async () => {
        const first = build('a')
        let container: HTMLElement = first.root
        const host = createWindowHost({ root: () => container })
        const slot = host.createSegment()
        slot.keysChanged(['a', 'b'])
        slot.bind(first.list)
        slot.measure(first.item, { key: 'a', heights: new Map() })
        await settle()
        const observer = FakeResizeObserver.instances[0]
        expect(host.scroller).toBe(first.box)
        expect(observer.observed.has(first.root)).toBe(true)
        first.button.focus()
        await settle()
        expect(host.focusedKey).toBe('a')

        const removedFocus = vi.spyOn(first.root, 'removeEventListener')
        const removedScroll = vi.spyOn(first.box, 'removeEventListener')
        slot.bind(null)
        first.box.remove()
        const second = build('b')
        container = second.root
        slot.bind(second.list)
        await settle()

        expect(host.scroller).toBe(second.box)
        expect(observer.observed.has(second.root)).toBe(true)
        expect(observer.observed.has(second.box)).toBe(true)
        expect(observer.observed.has(first.root)).toBe(false)
        expect(observer.observed.has(first.box)).toBe(false)
        expect(removedFocus).toHaveBeenCalledWith('focusin', expect.any(Function))
        expect(removedFocus).toHaveBeenCalledWith('focusout', expect.any(Function))
        expect(removedScroll).toHaveBeenCalledWith('scroll', expect.any(Function))
        expect(host.focusedKey).toBeNull()
        expect(host.elementOf('a')).toBeNull()
        expect(host.elementOf('b')).toBe(second.item)

        second.button.focus()
        await settle()
        expect(host.focusedKey).toBe('b')
        second.button.blur()
        await settle()
        expect(host.focusedKey).toBeNull()
        expect(await reveal(host, 'b', { scroll: false })).toBe(second.item)
        host.dispose()
    })
})

describe('a segment whose top is not read mounts no rows', () => {
    // Regression reproducers for the first mount and the widen (they fail without the unmeasured
    // rule); the pin and hidden-element tests are rule guards.
    const ROW = 50
    const BAND = 800
    const folders = (): string[][] => [
        [],
        ...Array.from({ length: 11 }, (_, i) => keys(25, `f${i}_`)),
        keys(10, 'g'),
        keys(700, 'z'),
    ]
    // Narrow overscan of two rows below a band of sixteen rows.
    const bandRows = keys(19, 'f0_')

    // jsdom has no layout: a segment sits under its predecessors, and one without keys is
    // `display: none` (no layout, zero rect), as a folded or filtered-out folder is.
    function folderGeometry(current: () => string[][], hidden: Set<number> = new Set()): void {
        const indexOf = (element: Element): number => {
            const id = (element as HTMLElement).dataset?.testid
            return id?.startsWith('segment-') ? Number(id.slice('segment-'.length)) : -1
        }
        const gone = (index: number): boolean => hidden.has(index) || (current()[index]?.length ?? 0) === 0
        setWindowGeometryForTests({
            rectOf: (element) => {
                const index = indexOf(element)
                if (index < 0) {
                    return rects.get(element) ?? { top: 0, height: 0 }
                }
                if (gone(index)) {
                    return { top: 0, height: 0 }
                }
                let top = 0
                for (let i = 0; i < index; i++) {
                    top += current()[i].length * ROW
                }
                return { top, height: current()[index].length * ROW }
            },
            hasLayout: (element) => {
                const index = indexOf(element)
                return index < 0 || !gone(index)
            },
            viewport: () => BAND,
            scrollBy: () => {},
            schedule: (callback) => {
                frames.push(callback)
                return () => {
                    frames = frames.filter((frame) => frame !== callback)
                }
            },
        })
    }

    /** Mounts the harness and counts every item wrapper that enters the page. */
    function mountList(props: { segments: string[][]; pinned?: string[]; hidden?: Set<number> }) {
        const state = $state({ segments: props.segments, pinned: props.pinned ?? [] })
        // Installed before the mount: the host reads the geometry seam when a segment is created.
        folderGeometry(() => state.segments, props.hidden)
        let host!: WindowHost
        const target = document.body.appendChild(document.createElement('div'))
        let added = 0
        const observer = new MutationObserver((records) => {
            for (const record of records) {
                for (const node of record.addedNodes) {
                    if (node instanceof Element) {
                        added += (node.hasAttribute('data-window-key') ? 1 : 0) + node.querySelectorAll('[data-window-key]').length
                    }
                }
            }
        })
        observer.observe(target, { childList: true, subtree: true })
        mounted.push(mount(Harness, {
            target,
            props: {
                get segments() { return state.segments },
                get pinned() { return state.pinned },
                fallback: ROW,
                onHost: (h: WindowHost) => { host = h },
            },
        }))
        return {
            state,
            target,
            host: () => host,
            added: () => {
                const pending = observer.takeRecords()
                for (const record of pending) {
                    for (const node of record.addedNodes) {
                        if (node instanceof Element) {
                            added += (node.hasAttribute('data-window-key') ? 1 : 0) + node.querySelectorAll('[data-window-key]').length
                        }
                    }
                }
                return added
            },
            keysInPage: () => Array.from(target.querySelectorAll('[data-window-key]')).map((row) => row.getAttribute('data-window-key') as string),
            spacersOf: (index: number) => Array.from(target.querySelectorAll(`[data-testid=segment-${index}] [data-window-spacer]`)) as HTMLElement[],
            stop: () => observer.disconnect(),
        }
    }

    test('first mount of fourteen segments mounts about one band, not a band per segment', async () => {
        const view = mountList({ segments: folders() })
        await settle()
        expect(view.added()).toBeLessThanOrEqual(30)
        expect(view.keysInPage()).toEqual(bandRows)
        view.stop()
    })

    test('a folder filtered out and back in mounts only the rows at the band', async () => {
        const view = mountList({ segments: folders() })
        await settle()
        vi.advanceTimersByTime(WIDEN_DELAY_MS)
        await settle()

        const all = folders()
        view.state.segments = all.map(() => [])
        await settle()
        expect(view.keysInPage()).toEqual([])
        const before = view.added()
        view.state.segments = all
        await settle()
        expect(view.added() - before).toBeLessThanOrEqual(30)
        expect(view.keysInPage().slice(0, 19)).toEqual(bandRows)
        view.stop()
    })

    test('before the first read only the spacer of the layout total and the pinned key mount; the band follows the read', async () => {
        const view = mountList({ segments: [keys(100)], pinned: ['k90'] })
        // The first read is a microtask away: nothing is awaited yet.
        expect(view.keysInPage()).toEqual(['k90'])
        const [top, bottom] = view.spacersOf(0)
        expect(parseFloat(top.style.height) + ROW + parseFloat(bottom.style.height)).toBe(100 * ROW)
        await settle()
        expect(view.keysInPage()).toContain('k0')
        expect(view.keysInPage()).toContain('k90')
        view.stop()
    })

    test('with nothing pinned an unread segment is one spacer of its layout total', async () => {
        const view = mountList({ segments: [keys(100)] })
        expect(view.keysInPage()).toEqual([])
        const spacers = view.spacersOf(0)
        expect(spacers).toHaveLength(1)
        expect(parseFloat(spacers[0].style.height)).toBe(100 * ROW)
        await settle()
        expect(view.keysInPage().length).toBeGreaterThan(0)
        view.stop()
    })

    test('an element without layout stays spacer-only until it has layout', async () => {
        const hidden = new Set<number>([0])
        const view = mountList({ segments: [keys(100)], hidden })
        await settle()
        expect(view.keysInPage()).toEqual([])
        expect(view.spacersOf(0)).toHaveLength(1)
        hidden.delete(0)
        view.host().refresh()
        await settle()
        expect(view.keysInPage().length).toBeGreaterThan(0)
        expect(view.keysInPage()[0]).toBe('k0')
        view.stop()
    })

    test('a reveal into a segment that stays unmeasured still resolves and mounts the row', async () => {
        const view = mountList({ segments: [keys(100)], hidden: new Set([0]) })
        await settle()
        expect(view.keysInPage()).toEqual([])
        const element = await reveal(view.host(), 'k60', { scroll: false })
        await settle()
        expect(element?.getAttribute('data-window-key')).toBe('k60')
        view.stop()
    })
})
