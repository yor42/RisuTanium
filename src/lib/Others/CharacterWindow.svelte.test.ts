// @vitest-environment happy-dom

/**
 * `CharacterWindow.svelte`: the windowed list under every character list tab. It mounts the
 * rows near the scroll viewport, stands spacers of the exact model height in for the rest,
 * measures the rows it mounts, keeps the container where the reader is when a row above the
 * viewport changes height, and keeps the focused row mounted.
 *
 * FAKE GEOMETRY: happy-dom has no layout and no ResizeObserver reports, so the container's
 * height and scroll position are faked on `HTMLElement.prototype` (`installGeometry`), and row
 * heights arrive through a `FakeResizeObserver` that reports on demand. The window reads the
 * scroll position on a scroll event, in an animation frame, so tests that scroll wait for a real
 * frame. These tests prove the model and the pinning logic; real anchoring, clamping and
 * observer ordering are browser behaviour.
 *
 * Test labels: every test is a feature test (`F`): the component does not exist before the
 * windowed lists, so on the earlier base each one fails because the windowed list is missing.
 * The defects the windowing removes (every row mounted, an observer per card, a nested scroller)
 * are asserted as reproducers through the screens in `GridCatalog.window.svelte.test.ts`,
 * `CharacterTrashList.window.svelte.test.ts` and the two files in `src/lib/Mobile`.
 */
import { createRawSnippet, flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { listRowKey, listRows, type ScrollAnchor } from './charListRows'
import CharacterWindow from './CharacterWindow.svelte'

//#region fixtures and fake geometry

const ROW = 100
const VIEWPORT = 600
const COUNT = 300

const cardKeys = (count: number, from = 0): string[] => Array.from({ length: count }, (_, i) => String(from + i))

const card = createRawSnippet((cardKey: () => string, position: () => number) => ({
    render: () => `<div class="card" data-pos="${position()}"><button>open ${cardKey()}</button></div>`,
}))

class FakeResizeObserver {
    static instances: FakeResizeObserver[] = []
    readonly observed = new Set<Element>()
    constructor(private readonly callback: ResizeObserverCallback) {
        FakeResizeObserver.instances.push(this)
    }
    observe(el: Element) {
        this.observed.add(el)
    }
    unobserve(el: Element) {
        this.observed.delete(el)
    }
    disconnect() {
        this.observed.clear()
    }
    report(sizes: Array<[Element, number]>) {
        this.callback(
            sizes.map(([target, blockSize]) => ({ target, borderBoxSize: [{ blockSize, inlineSize: 300 }], contentRect: { height: blockSize } }) as unknown as ResizeObserverEntry),
            this as unknown as ResizeObserver,
        )
    }
}

const observer = (): FakeResizeObserver => FakeResizeObserver.instances[0]

interface Geometry {
    /** Sets the scroll position of the list and fires its scroll event. */
    scrollTo(top: number): void
    scrollAndSettle(top: number): Promise<void>
    hide(): void
    show(): void
    /** Every value written to a `scrollTop` by the component, in order. */
    readonly writes: number[]
}

/**
 * A container height of `VIEWPORT` and a scroll position that is clamped to the list's own total,
 * as a browser clamps it, for every element: the window under test is the only reader.
 */
function installGeometry(): { geometry: Geometry; restore: () => void } {
    const tops = new WeakMap<Element, number>()
    const writes: number[] = []
    let hidden = false
    const clientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')
    const scrollTop = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTop')
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => (hidden ? 0 : VIEWPORT) })
    Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
        configurable: true,
        get(this: HTMLElement) {
            return hidden ? 0 : tops.get(this) ?? 0
        },
        set(this: HTMLElement, value: number) {
            writes.push(value)
            const total = Number(this.getAttribute('data-charlist-total') ?? Number.POSITIVE_INFINITY)
            tops.set(this, Math.max(0, Math.min(value, Math.max(0, total - VIEWPORT))))
        },
    })
    const list = (): HTMLElement => document.querySelector<HTMLElement>('[role="list"][data-charlist-total]')!
    const geometry: Geometry = {
        scrollTo(top) {
            tops.set(list(), top)
            list().dispatchEvent(new Event('scroll'))
        },
        async scrollAndSettle(top) {
            geometry.scrollTo(top)
            await settleFrame()
        },
        hide() {
            hidden = true
        },
        show() {
            hidden = false
        },
        writes,
    }
    return {
        geometry,
        restore() {
            for (const [name, descriptor] of [['clientHeight', clientHeight], ['scrollTop', scrollTop]] as const) {
                if (descriptor) {
                    Object.defineProperty(HTMLElement.prototype, name, descriptor)
                } else {
                    delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name]
                }
            }
        },
    }
}

async function settleFrame(): Promise<void> {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    flushSync()
    await Promise.resolve()
    flushSync()
}

async function settleMicrotasks(): Promise<void> {
    for (let i = 0; i < 4; i++) {
        await Promise.resolve()
        flushSync()
    }
}

let mounted: { app: Record<string, unknown>; target: HTMLElement } | null = null
let geometry: Geometry
let restoreGeometry: () => void

interface MountOptions {
    rows?: string[]
    heights?: Map<string, number>
    resetToken?: string | number
    initialAnchor?: ScrollAnchor | null
    rowClass?: string
}

/** Mounts a window with the geometry installed and the first frame read. */
async function mountWindow(options: MountOptions = {}): Promise<{ target: HTMLElement; props: { rows: ReturnType<typeof listRows>; resetToken?: string | number }; api: { getAnchor(): ScrollAnchor | null } }> {
    const props = $state({
        rows: listRows(options.rows ?? cardKeys(COUNT)),
        fallbackHeight: ROW,
        heights: options.heights ?? new Map<string, number>(),
        resetToken: options.resetToken,
        initialAnchor: options.initialAnchor ?? null,
        rowClass: options.rowClass ?? '',
        card,
    })
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(CharacterWindow, { target, props: props as never }) as Record<string, unknown>
    mounted = { app, target }
    flushSync()
    await settleFrame()
    return { target, props, api: app as unknown as { getAnchor(): ScrollAnchor | null } }
}

beforeEach(() => {
    FakeResizeObserver.instances.length = 0
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    const installed = installGeometry()
    geometry = installed.geometry
    restoreGeometry = installed.restore
})

afterEach(async () => {
    vi.unstubAllGlobals()
    if (mounted) {
        await unmount(mounted.app as never)
        mounted.target.remove()
        mounted = null
    }
    restoreGeometry()
    document.body.innerHTML = ''
})

const listOf = (target: HTMLElement): HTMLElement => target.querySelector<HTMLElement>('[role="list"][data-charlist-total]')!
const rowEls = (target: HTMLElement): HTMLElement[] => Array.from(target.querySelectorAll<HTMLElement>('[role="listitem"]'))
const rowOf = (target: HTMLElement, key: string): HTMLElement | null => target.querySelector<HTMLElement>(`[role="listitem"][data-charlist-key="${key}"]`)
const mountedKeys = (target: HTMLElement): number[] => rowEls(target).map((el) => Number(el.getAttribute('data-charlist-key')))
const totalOf = (target: HTMLElement): number => Number(listOf(target).getAttribute('data-charlist-total'))

/** Most rows the band can hold: the viewport plus one viewport of overscan each side, one row of slack. */
const BOUND = Math.ceil((3 * VIEWPORT) / ROW) + 1

/** The rendered spacers and the rows' modelled heights add up to the model's total height. */
function expectModelGeometry(target: HTMLElement, heights: Map<string, number> = new Map()): void {
    let y = 0
    for (const child of Array.from(listOf(target).children) as HTMLElement[]) {
        if (child.hasAttribute('data-charlist-spacer')) {
            expect(child.style.minHeight).toBe(child.style.height)
            expect(child.getAttribute('aria-hidden')).toBe('true')
            y += Number.parseFloat(child.style.height)
        } else {
            y += heights.get(listRowKey(child.getAttribute('data-charlist-key')!)) ?? ROW
        }
    }
    expect(y).toBe(totalOf(target))
}

//#endregion

describe('CharacterWindow: the mounted window', () => {
    test('(F) 300 rows at a 600 px viewport mount a bounded window that follows the scroll and keeps the model height', async () => {
        const { target } = await mountWindow()
        expect(totalOf(target)).toBe(COUNT * ROW)
        expect(rowEls(target).length).toBeGreaterThan(0)
        expect(rowEls(target).length).toBeLessThanOrEqual(BOUND)
        expect(rowOf(target, '0')).not.toBeNull()
        expectModelGeometry(target)

        await geometry.scrollAndSettle(15_000)
        expect(rowEls(target).length).toBeLessThanOrEqual(BOUND)
        expect(rowOf(target, '150')).not.toBeNull()
        expect(rowOf(target, '0')).toBeNull()
        expectModelGeometry(target)

        await geometry.scrollAndSettle(0)
        expect(rowOf(target, '0')).not.toBeNull()
        expect(rowOf(target, '150')).toBeNull()
    })

    test('(F) the mounted count does not depend on the list length', async () => {
        const small = await mountWindow({ rows: cardKeys(60) })
        const smallCount = rowEls(small.target).length
        await unmount(mounted!.app as never)
        mounted!.target.remove()
        mounted = null
        const large = await mountWindow({ rows: cardKeys(300) })
        expect(rowEls(large.target).length).toBe(smallCount)
    })

    test('(F) the container is a list of list items with the list size and each item\'s place, and applies the row class to the item', async () => {
        const { target } = await mountWindow({ rowClass: 'pb-2' })
        expect(listOf(target).getAttribute('role')).toBe('list')
        const first = rowOf(target, '0')!
        expect(first.getAttribute('aria-setsize')).toBe(String(COUNT))
        expect(first.getAttribute('aria-posinset')).toBe('1')
        expect(first.classList.contains('pb-2')).toBe(true)
        expect(first.querySelector('.card')!.getAttribute('data-pos')).toBe('1')

        await geometry.scrollAndSettle(15_000)
        const far = rowOf(target, '150')!
        expect(far.getAttribute('aria-posinset')).toBe('151')
        expect(far.querySelector('.card')!.getAttribute('data-pos')).toBe('151')
    })

    test('(F) the container does not anchor natively', async () => {
        const { target } = await mountWindow()
        expect(listOf(target).style.overflowAnchor).toBe('none')
    })

    test('(F) an empty list mounts nothing and an emptied list drops its rows', async () => {
        const { target, props } = await mountWindow({ rows: cardKeys(5) })
        expect(rowEls(target).length).toBe(5)
        props.rows = listRows([])
        flushSync()
        expect(rowEls(target).length).toBe(0)
        expect(totalOf(target)).toBe(0)
    })
})

describe('CharacterWindow: measuring', () => {
    test('(F) a row that mounts outside an observer delivery is observed at once, without waiting for a frame', async () => {
        const target = document.createElement('div')
        document.body.appendChild(target)
        const props = $state({ rows: listRows(cardKeys(COUNT)), fallbackHeight: ROW, card })
        const app = mount(CharacterWindow, { target, props: props as never }) as Record<string, unknown>
        mounted = { app, target }
        flushSync()
        const watched = (): HTMLElement[] => Array.from(observer().observed).filter((el): el is HTMLElement => el instanceof HTMLElement && el.hasAttribute('data-charlist-key'))
        expect(rowEls(target).length).toBeGreaterThan(0)
        expect(watched().length).toBe(rowEls(target).length)

        // Rows that a scroll mounts are observed in the same render, not a frame later.
        geometry.scrollTo(15_000)
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
        flushSync()
        expect(rowOf(target, '150')).not.toBeNull()
        expect(watched().length).toBe(rowEls(target).length)
    })

    test('(F) a row that mounts while an observer delivery is in progress is observed on the next frame', async () => {
        const { target } = await mountWindow()
        await geometry.scrollAndSettle(2000)
        const watched = (): HTMLElement[] => Array.from(observer().observed).filter((el): el is HTMLElement => el instanceof HTMLElement && el.hasAttribute('data-charlist-key'))
        expect(watched().length).toBe(rowEls(target).length)

        // The rows in view turn out far shorter than assumed, so rows further down now fit the band and mount.
        const before = new Set(rowEls(target))
        observer().report(Array.from({ length: 13 }, (_, i): [Element, number] => [rowOf(target, String(20 + i))!, 10]))
        flushSync()
        const fresh = rowEls(target).filter((el) => !before.has(el))
        expect(fresh.length).toBeGreaterThan(0)
        expect(fresh.every((el) => !observer().observed.has(el))).toBe(true)

        await settleFrame()
        expect(fresh.every((el) => observer().observed.has(el))).toBe(true)
    })
    test('(F) a row that scrolls out of the window is no longer observed', async () => {
        const { target } = await mountWindow()
        await geometry.scrollAndSettle(15_000)
        // The rows mounted by that scroll are observed on the frame after.
        await settleFrame()
        const watched = Array.from(observer().observed).filter((el): el is HTMLElement => el instanceof HTMLElement && el.hasAttribute('data-charlist-key'))
        expect(watched.length).toBe(rowEls(target).length)
        expect(watched.every((el) => el.isConnected)).toBe(true)
    })

    test('(F) a measured height replaces the fallback in the model and in the total', async () => {
        const { target } = await mountWindow()
        observer().report([[rowOf(target, '3')!, 250]])
        flushSync()
        expect(totalOf(target)).toBe(COUNT * ROW + 150)
        expectModelGeometry(target, new Map([[listRowKey('3'), 250]]))
    })

    test('(F) a measured height outlives its row: scrolled out and back, the spacers still count it', async () => {
        const heights = new Map<string, number>()
        const { target } = await mountWindow({ heights })
        observer().report([[rowOf(target, '3')!, 250]])
        flushSync()
        await geometry.scrollAndSettle(15_000)
        expect(rowOf(target, '3')).toBeNull()
        expect(totalOf(target)).toBe(COUNT * ROW + 150)
        const first = mountedKeys(target)[0]
        const top = listOf(target).firstElementChild as HTMLElement
        expect(top.hasAttribute('data-charlist-spacer')).toBe(true)
        expect(Number.parseFloat(top.style.height)).toBe(first * ROW + 150)
        expect(heights.get(listRowKey('3'))).toBe(250)

        await geometry.scrollAndSettle(0)
        expect(rowOf(target, '3')).not.toBeNull()
        expect(totalOf(target)).toBe(COUNT * ROW + 150)
    })

    test('(F) the owner\'s height map survives the component, so a later window starts from the same heights', async () => {
        const heights = new Map<string, number>()
        const first = await mountWindow({ heights })
        observer().report([[rowOf(first.target, '3')!, 250]])
        flushSync()
        await unmount(mounted!.app as never)
        mounted!.target.remove()
        mounted = null

        const second = await mountWindow({ heights })
        expect(totalOf(second.target)).toBe(COUNT * ROW + 150)
    })

    test('(F) heights of rows that left the list are dropped from the owner\'s map', async () => {
        const heights = new Map<string, number>()
        const { target, props } = await mountWindow({ heights })
        observer().report([[rowOf(target, '3')!, 250], [rowOf(target, '4')!, 180]])
        flushSync()
        expect(heights.size).toBe(2)
        props.rows = listRows(cardKeys(COUNT).filter((key) => key !== '3'))
        flushSync()
        expect(Array.from(heights.keys())).toEqual([listRowKey('4')])
    })

    test('(F) a size report from a hidden container does not overwrite the last good heights', async () => {
        const { target } = await mountWindow()
        observer().report([[rowOf(target, '3')!, 250]])
        flushSync()
        geometry.hide()
        observer().report([[rowOf(target, '3')!, 5], [rowOf(target, '4')!, 5]])
        flushSync()
        expect(totalOf(target)).toBe(COUNT * ROW + 150)
    })

    test('(F) without a ResizeObserver the rows stay at the fallback height', async () => {
        vi.stubGlobal('ResizeObserver', undefined)
        const { target } = await mountWindow()
        expect(rowEls(target).length).toBeGreaterThan(0)
        expect(totalOf(target)).toBe(COUNT * ROW)
    })
})

describe('CharacterWindow: anchoring', () => {
    test('(F) a row above the viewport that grows moves the container by the same amount, and the window follows at once', async () => {
        const { target } = await mountWindow()
        await geometry.scrollAndSettle(2000)
        // A container at 2000 mounts rows 14 to 32.
        expect(rowOf(target, '14')).not.toBeNull()
        expect(rowOf(target, '15')).not.toBeNull()
        expect(rowOf(target, '32')).not.toBeNull()
        geometry.writes.length = 0

        observer().report([[rowOf(target, '15')!, 200]])
        flushSync()

        // No frame has passed and no scroll event has been read. A window computed from the old
        // position would still mount row 14; one computed from the corrected position (2100) starts
        // at row 15 and still reaches row 32.
        expect(geometry.writes).toEqual([2100])
        expect(rowOf(target, '14')).toBeNull()
        expect(rowOf(target, '15')).not.toBeNull()
        expect(rowOf(target, '32')).not.toBeNull()
        expect(totalOf(target)).toBe(COUNT * ROW + 100)
        expectModelGeometry(target, new Map([[listRowKey('15'), 200]]))
    })

    test('(F) rows that grow at or below the viewport top do not move the container', async () => {
        const { target } = await mountWindow()
        await geometry.scrollAndSettle(2050)
        geometry.writes.length = 0
        // The row holding the viewport top (20, from 2000 to 2100) and the row after it.
        observer().report([[rowOf(target, '20')!, 160], [rowOf(target, '21')!, 160]])
        flushSync()
        expect(geometry.writes).toEqual([])
        expect(totalOf(target)).toBe(COUNT * ROW + 120)
    })

    test('(F) several rows above the viewport are corrected by one write', async () => {
        const { target } = await mountWindow()
        await geometry.scrollAndSettle(2000)
        geometry.writes.length = 0
        observer().report([[rowOf(target, '15')!, 140], [rowOf(target, '16')!, 90], [rowOf(target, '17')!, 120]])
        flushSync()
        expect(geometry.writes).toEqual([2000 + 40 - 10 + 20])
    })

    test('(F) the row at the viewport top is the same before and after the correction', async () => {
        const { target } = await mountWindow()
        await geometry.scrollAndSettle(2000)
        // Row 20 starts at 2000. After row 15 grows by 40 it starts at 2040, where the container now is.
        observer().report([[rowOf(target, '15')!, 140]])
        flushSync()
        await settleFrame()

        const heights = new Map([[listRowKey('15'), 140]])
        let y = 0
        let startOfRow20: number | null = null
        for (const child of Array.from(listOf(target).children) as HTMLElement[]) {
            if (child.hasAttribute('data-charlist-spacer')) {
                y += Number.parseFloat(child.style.height)
                continue
            }
            const key = child.getAttribute('data-charlist-key')!
            if (key === '20') {
                startOfRow20 = y
            }
            y += heights.get(listRowKey(key)) ?? ROW
        }
        expect(startOfRow20).toBe(2040)
        expect(geometry.writes.at(-1)).toBe(2040)
    })
})

describe('CharacterWindow: scroll position', () => {
    test('(F) a change of the reset token scrolls to the top; the first token and an unrelated change do not', async () => {
        const { target, props } = await mountWindow({ resetToken: 'a' })
        expect(geometry.writes).toEqual([])
        await geometry.scrollAndSettle(15_000)
        expect(rowOf(target, '150')).not.toBeNull()

        props.rows = listRows(cardKeys(COUNT - 1))
        flushSync()
        await settleFrame()
        expect(rowOf(target, '150')).not.toBeNull()

        props.resetToken = 'b'
        flushSync()
        await settleFrame()
        expect(geometry.writes.at(-1)).toBe(0)
        expect(rowOf(target, '0')).not.toBeNull()
        expect(rowOf(target, '150')).toBeNull()
    })

    test('(F) an initial anchor is scrolled to when the list is created, and the anchor of the viewport top names the same row', async () => {
        const { target, api } = await mountWindow({ initialAnchor: { key: listRowKey('150'), offset: 30 } })
        expect(rowOf(target, '150')).not.toBeNull()
        expect(rowOf(target, '0')).toBeNull()
        expect(api.getAnchor()).toEqual({ key: listRowKey('150'), offset: 30 })
    })

    test('(F) an initial anchor lands on its row against the heights the list has now, not at the pixel offset it was taken at', async () => {
        // The rows above row 150 are all taller than the fallback: a pixel offset of 15030 would show row 100.
        const heights = new Map(cardKeys(150).map((key): [string, number] => [listRowKey(key), 150]))
        const { target, api } = await mountWindow({ heights, initialAnchor: { key: listRowKey('150'), offset: 30 } })
        expect(geometry.writes).toEqual([150 * 150 + 30])
        expect(rowOf(target, '150')).not.toBeNull()
        expect(rowOf(target, '100')).toBeNull()
        expect(api.getAnchor()).toEqual({ key: listRowKey('150'), offset: 30 })
    })

    test('(F) an initial anchor whose row is gone opens at the top', async () => {
        const { target } = await mountWindow({ initialAnchor: { key: listRowKey('999'), offset: 30 } })
        expect(rowOf(target, '0')).not.toBeNull()
    })

    test('(F) the anchor follows the scroll and names the row and the offset into it', async () => {
        const { api } = await mountWindow()
        await geometry.scrollAndSettle(2050)
        expect(api.getAnchor()).toEqual({ key: listRowKey('20'), offset: 50 })
    })
})

describe('CharacterWindow: focus', () => {
    test('(F) the row that holds focus stays mounted, and keeps focus, while it is far outside the window', async () => {
        const { target } = await mountWindow()
        const button = rowOf(target, '5')!.querySelector('button')!
        button.focus()
        await settleMicrotasks()
        expect(document.activeElement).toBe(button)

        await geometry.scrollAndSettle(20_000)
        expect(rowOf(target, '5')).not.toBeNull()
        expect(rowOf(target, '5')!.querySelector('button')).toBe(button)
        expect(document.activeElement).toBe(button)
        expect(rowEls(target).length).toBeLessThanOrEqual(BOUND + 1)
        expectModelGeometry(target)

        await geometry.scrollAndSettle(0)
        expect(rowOf(target, '5')!.querySelector('button')).toBe(button)
    })

    test('(F) once focus leaves, the far row is unmounted by the next scroll', async () => {
        const { target } = await mountWindow()
        const button = rowOf(target, '5')!.querySelector('button')!
        button.focus()
        await settleMicrotasks()
        await geometry.scrollAndSettle(20_000)
        expect(rowOf(target, '5')).not.toBeNull()

        button.blur()
        await settleMicrotasks()
        await geometry.scrollAndSettle(20_100)
        expect(rowOf(target, '5')).toBeNull()
    })

    test('(F) when the focused row leaves the list, focus goes to the container, not the page', async () => {
        const { target, props } = await mountWindow({ rows: cardKeys(5) })
        rowOf(target, '2')!.querySelector('button')!.focus()
        await settleMicrotasks()

        props.rows = listRows(cardKeys(5).filter((key) => key !== '2'))
        flushSync()
        await settleMicrotasks()

        expect(rowOf(target, '2')).toBeNull()
        expect(document.activeElement).toBe(listOf(target))
    })

    test('(F) a row removed while focus is elsewhere does not take focus', async () => {
        const { target, props } = await mountWindow({ rows: cardKeys(5) })
        const other = document.createElement('button')
        document.body.appendChild(other)
        rowOf(target, '2')!.querySelector('button')!.focus()
        await settleMicrotasks()
        other.focus()
        await settleMicrotasks()

        props.rows = listRows(cardKeys(5).filter((key) => key !== '2'))
        flushSync()
        await settleMicrotasks()
        expect(document.activeElement).toBe(other)
    })
})
