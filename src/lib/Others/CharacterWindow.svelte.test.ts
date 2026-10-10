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
import { gridRows, listRowKey, listRows, type CharRow, type ScrollAnchor } from './charListRows'
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
    /** The width the container reports (0 until a grid test sets one). */
    setWidth(width: number): void
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
    let width = 0
    const clientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')
    const clientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
    const scrollTop = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTop')
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => (hidden ? 0 : VIEWPORT) })
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => (hidden ? 0 : width) })
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
        setWidth(next) {
            width = next
        },
        writes,
    }
    return {
        geometry,
        restore() {
            for (const [name, descriptor] of [['clientHeight', clientHeight], ['clientWidth', clientWidth], ['scrollTop', scrollTop]] as const) {
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
    document.documentElement.style.fontSize = ''
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

//#region grid layout

/** 5 columns at 16 px per rem: five tiles need 312 px, six need 376 px. */
const FIVE_COLUMNS = 345
/** 3 columns: three tiles need 184 px, four need 248 px. */
const THREE_COLUMNS = 200
const GRID_ROW = 64

interface GridOptions {
    cards?: number
    width?: number
    build?: (columns: number) => readonly CharRow[]
    rowClass?: string
}

async function mountGrid(options: GridOptions = {}) {
    geometry.setWidth(options.width ?? FIVE_COLUMNS)
    const keys = cardKeys(options.cards ?? COUNT)
    const props = $state({
        rows: options.build ?? ((columns: number): readonly CharRow[] => gridRows(keys, columns)),
        layout: 'grid' as const,
        fallbackHeight: GRID_ROW,
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

/** Reports a size change of the container, as the browser does when its width changes. */
function reportContainer(target: HTMLElement): void {
    observer().report([[listOf(target), 0]])
}

/** A size report, then the frame in which the window applies a new column count. */
async function resizeContainer(target: HTMLElement): Promise<void> {
    reportContainer(target)
    await settleFrame()
}

const tileEls = (target: HTMLElement): HTMLElement[] => Array.from(target.querySelectorAll<HTMLElement>('[role="listitem"]'))
const tileOf = (target: HTMLElement, key: string): HTMLElement | null => target.querySelector<HTMLElement>(`[role="listitem"][data-charlist-key="${key}"]`)
const gridRowEls = (target: HTMLElement): HTMLElement[] => Array.from(target.querySelectorAll<HTMLElement>('[data-charlist-row]'))
const tileKeys = (target: HTMLElement): number[] => tileEls(target).map((el) => Number(el.getAttribute('data-charlist-key')))

describe('CharacterWindow: grid layout', () => {
    test('(F) no row is built until the container has reported a width', async () => {
        const build = vi.fn((columns: number): readonly CharRow[] => gridRows(cardKeys(20), columns))
        const { target } = await mountGrid({ width: 0, build })
        expect(tileEls(target).length).toBe(0)
        expect(totalOf(target)).toBe(0)
        expect(build).not.toHaveBeenCalled()

        geometry.setWidth(FIVE_COLUMNS)
        reportContainer(target)
        flushSync()
        expect(tileEls(target).length).toBe(20)
        expect(gridRowEls(target).length).toBe(4)
        // The first width builds the rows once, with the real column count.
        expect(build.mock.calls.every(([columns]) => columns === 5)).toBe(true)
    })

    test('(F) 300 cards mount a bounded number of tiles, and the number does not depend on the list length', async () => {
        const { target } = await mountGrid({ cards: 300 })
        const large = tileEls(target).length
        expect(totalOf(target)).toBe(60 * GRID_ROW)
        expect(large).toBeGreaterThan(0)
        expect(large).toBeLessThanOrEqual(5 * (Math.ceil((3 * VIEWPORT) / GRID_ROW) + 1))
        await unmount(mounted!.app as never)
        mounted!.target.remove()
        mounted = null

        const { target: small } = await mountGrid({ cards: 150 })
        expect(totalOf(small)).toBe(30 * GRID_ROW)
        expect(tileEls(small).length).toBe(large)
    })

    test('(F) a far tile is mounted by scrolling to it, and the spacers keep the model height', async () => {
        const { target } = await mountGrid()
        expect(tileOf(target, '250')).toBeNull()
        await geometry.scrollAndSettle(50 * GRID_ROW)
        expect(tileOf(target, '250')).not.toBeNull()
        expect(tileOf(target, '0')).toBeNull()
        expect(totalOf(target)).toBe(60 * GRID_ROW)
        let y = 0
        for (const child of Array.from(listOf(target).children) as HTMLElement[]) {
            y += child.hasAttribute('data-charlist-spacer') ? Number.parseFloat(child.style.height) : GRID_ROW
        }
        expect(y).toBe(60 * GRID_ROW)
    })

    test('(F) every tile is a list item that names its place among all tiles; the row wrapper carries the row class and is presentational', async () => {
        const { target } = await mountGrid({ rowClass: 'flex gap-2 pb-2' })
        const first = tileOf(target, '0')!
        expect(first.getAttribute('aria-setsize')).toBe(String(COUNT))
        expect(first.getAttribute('aria-posinset')).toBe('1')
        expect(tileOf(target, '4')!.getAttribute('aria-posinset')).toBe('5')
        const row = first.parentElement!
        expect(row.hasAttribute('data-charlist-row')).toBe(true)
        expect(row.getAttribute('role')).toBe('presentation')
        expect(row.className).toBe('flex gap-2 pb-2')
        expect(first.className).toBe('')
        expect(row.children.length).toBe(5)

        await geometry.scrollAndSettle(50 * GRID_ROW)
        const far = tileOf(target, '253')!
        expect(far.getAttribute('aria-posinset')).toBe('254')
        expect(far.querySelector('.card')!.getAttribute('data-pos')).toBe(String(50 + 1))
    })

    test('(F) the last row holds the cards left over', async () => {
        const { target } = await mountGrid({ cards: 23 })
        const rowsMounted = gridRowEls(target)
        expect(rowsMounted.length).toBe(5)
        expect(rowsMounted.map((row) => row.children.length)).toEqual([5, 5, 5, 5, 3])
    })

    test('(F) no cards and one card each build an empty and a one-tile grid', async () => {
        const none = await mountGrid({ cards: 0 })
        expect(tileEls(none.target).length).toBe(0)
        expect(totalOf(none.target)).toBe(0)
        await unmount(mounted!.app as never)
        mounted!.target.remove()
        mounted = null

        const one = await mountGrid({ cards: 1 })
        expect(tileKeys(one.target)).toEqual([0])
        expect(gridRowEls(one.target).length).toBe(1)
        expect(tileOf(one.target, '0')!.getAttribute('aria-setsize')).toBe('1')
    })

    test('(F) the container keeps a scrollbar gutter, a list does not', async () => {
        const grid = await mountGrid()
        expect(listOf(grid.target).style.cssText).toContain('scrollbar-gutter: stable')
        await unmount(mounted!.app as never)
        mounted!.target.remove()
        mounted = null

        const plain = await mountWindow({ rows: cardKeys(5) })
        expect(listOf(plain.target).style.cssText).not.toContain('scrollbar-gutter')
    })

    test('(F) the column count follows the root font size', async () => {
        document.documentElement.style.fontSize = '20px'
        // At 20 px per rem a tile is 70 px and a gap 10 px: 345 px hold four, not five.
        const { target } = await mountGrid()
        expect(gridRowEls(target)[0].children.length).toBe(4)
    })

    test('(F) a width that keeps the column count builds no new rows; one that changes it does', async () => {
        const build = vi.fn((columns: number): readonly CharRow[] => gridRows(cardKeys(COUNT), columns))
        const { target } = await mountGrid({ build })
        const calls = build.mock.calls.length
        geometry.setWidth(FIVE_COLUMNS + 20)
        reportContainer(target)
        flushSync()
        geometry.setWidth(FIVE_COLUMNS - 20)
        reportContainer(target)
        flushSync()
        expect(build.mock.calls.length).toBe(calls)
        expect(gridRowEls(target)[0].children.length).toBe(5)

        geometry.setWidth(THREE_COLUMNS)
        await resizeContainer(target)
        expect(build.mock.calls.length).toBeGreaterThan(calls)
        expect(gridRowEls(target)[0].children.length).toBe(3)
    })

    test('(F) a hidden container (width 0) keeps the columns it had', async () => {
        const { target } = await mountGrid()
        geometry.setWidth(0)
        reportContainer(target)
        flushSync()
        expect(gridRowEls(target)[0].children.length).toBe(5)
        expect(tileEls(target).length).toBeGreaterThan(0)
    })
})

describe('CharacterWindow: grid column changes', () => {
    test('(F) the rows are not re-created inside the observer delivery, only in the frame after it', async () => {
        const { target } = await mountGrid()
        geometry.writes.length = 0
        const row = gridRowEls(target)[0]
        geometry.setWidth(THREE_COLUMNS)
        reportContainer(target)
        // Still inside the frame of the delivery: nothing observed has changed size yet.
        expect(gridRowEls(target)[0]).toBe(row)
        expect(row.children.length).toBe(5)
        expect(geometry.writes).toEqual([])

        await settleFrame()
        expect(gridRowEls(target)[0].children.length).toBe(3)
    })

    test('(F) the column count follows the rendered size of 1 rem, not the computed root font size', async () => {
        // A WebView with a system font scale reports 13.6 px and still draws 1 rem at 16 px.
        document.documentElement.style.fontSize = '13.6px'
        const original = HTMLElement.prototype.getBoundingClientRect
        HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
            return this.style.width === '1rem' ? ({ width: 16, height: 0, top: 0, left: 0, right: 16, bottom: 0, x: 0, y: 0 } as DOMRect) : original.call(this)
        }
        try {
            // 345 px hold five 56 px tiles; the computed size would model six 47.6 px tiles.
            const { target } = await mountGrid()
            expect(gridRowEls(target)[0].children.length).toBe(5)

            geometry.setWidth(THREE_COLUMNS)
            await resizeContainer(target)
            expect(gridRowEls(target)[0].children.length).toBe(3)
        } finally {
            HTMLElement.prototype.getBoundingClientRect = original
        }
    })

    test('(F) a round trip of column counts returns to the same top card, and a scroll by the reader ends that', async () => {
        const { target, api } = await mountGrid()
        await geometry.scrollAndSettle(40 * GRID_ROW + 10)
        expect(api.getAnchor()).toEqual({ key: JSON.stringify(['g', '200']), offset: 10 })

        geometry.setWidth(THREE_COLUMNS)
        await resizeContainer(target)
        geometry.setWidth(FIVE_COLUMNS)
        await resizeContainer(target)
        expect(api.getAnchor()).toEqual({ key: JSON.stringify(['g', '200']), offset: 10 })

        // The reader scrolls: the next change anchors on what is on screen now.
        geometry.setWidth(THREE_COLUMNS)
        await resizeContainer(target)
        await geometry.scrollAndSettle(75 * GRID_ROW)
        geometry.setWidth(FIVE_COLUMNS)
        await resizeContainer(target)
        expect(api.getAnchor()).toEqual({ key: JSON.stringify(['g', '225']), offset: 0 })
    })

    test('(F) a scroll by the reader that lands before its own frame is read ends the kept card too', async () => {
        const { target, api } = await mountGrid()
        await geometry.scrollAndSettle(40 * GRID_ROW + 10)
        geometry.setWidth(THREE_COLUMNS)
        await resizeContainer(target)

        // The size report registers the column frame first; the scroll event registers its read after it.
        geometry.setWidth(FIVE_COLUMNS)
        reportContainer(target)
        geometry.scrollTo(75 * GRID_ROW)
        await settleFrame()
        await settleFrame()
        expect(api.getAnchor()).toEqual({ key: JSON.stringify(['g', '225']), offset: 0 })
    })

    test('(F) a kept card that has left the list does not send the window to the top', async () => {
        const keys = cardKeys(COUNT)
        const { target, props, api } = await mountGrid()
        await geometry.scrollAndSettle(40 * GRID_ROW + 10)
        geometry.setWidth(THREE_COLUMNS)
        await resizeContainer(target)

        props.rows = (columns: number): readonly CharRow[] => gridRows(keys.filter((key) => key !== '200'), columns)
        flushSync()
        geometry.writes.length = 0
        geometry.setWidth(FIVE_COLUMNS)
        await resizeContainer(target)
        expect(geometry.writes.at(-1)).not.toBe(0)
        expect(api.getAnchor()!.key).not.toBe(JSON.stringify(['g', '0']))
    })

    test('(F) fewer columns, taller content: the first tile on screen stays on screen, in the frame after the report', async () => {
        const { target, api } = await mountGrid()
        // Row 40 holds cards 200 to 204; the viewport top is 10 px into it.
        await geometry.scrollAndSettle(40 * GRID_ROW + 10)
        expect(api.getAnchor()).toEqual({ key: JSON.stringify(['g', '200']), offset: 10 })
        geometry.writes.length = 0

        geometry.setWidth(THREE_COLUMNS)
        await resizeContainer(target)

        // Card 200 is now the last of the row 198..200 (row 66 of 100). The stub clamps a scroll
        // position to the rendered total, so the target is reachable only because the new spacers
        // were in the DOM when it was written.
        expect(totalOf(target)).toBe(100 * GRID_ROW)
        expect(geometry.writes.at(-1)).toBe(66 * GRID_ROW + 10)
        expect(listOf(target).scrollTop).toBe(66 * GRID_ROW + 10)
        expect(tileOf(target, '200')).not.toBeNull()
        expect(tileOf(target, '198')).not.toBeNull()
        expect(api.getAnchor()).toEqual({ key: JSON.stringify(['g', '198']), offset: 10 })
    })

    test('(F) more columns: the first tile on screen stays on screen', async () => {
        const { target, api } = await mountGrid({ width: THREE_COLUMNS })
        // Row 66 holds cards 198 to 200.
        await geometry.scrollAndSettle(66 * GRID_ROW + 10)
        geometry.setWidth(FIVE_COLUMNS)
        await resizeContainer(target)
        expect(totalOf(target)).toBe(60 * GRID_ROW)
        expect(geometry.writes.at(-1)).toBe(39 * GRID_ROW + 10)
        expect(tileOf(target, '198')).not.toBeNull()
        expect(api.getAnchor()).toEqual({ key: JSON.stringify(['g', '195']), offset: 10 })
    })

    test('(F) the focused tile is the same card, and has focus, after the columns change', async () => {
        const { target } = await mountGrid()
        await geometry.scrollAndSettle(40 * GRID_ROW)
        const before = tileOf(target, '201')!.querySelector('button')!
        before.focus()
        await settleMicrotasks()
        expect(document.activeElement).toBe(before)

        geometry.setWidth(THREE_COLUMNS)
        await resizeContainer(target)
        await settleMicrotasks()

        const after = tileOf(target, '201')!.querySelector('button')!
        expect(after.isConnected).toBe(true)
        expect(before.isConnected).toBe(false)
        expect(document.activeElement).toBe(after)
    })

    test('(F) a focused tile far outside the window stays mounted across the change and keeps being pinned afterwards', async () => {
        const { target } = await mountGrid()
        const before = tileOf(target, '5')!.querySelector('button')!
        before.focus()
        await settleMicrotasks()
        await geometry.scrollAndSettle(50 * GRID_ROW)
        expect(tileOf(target, '5')).not.toBeNull()

        // Chromium reports the loss of focus while the focused element is being removed; happy-dom does not.
        const originalRemove = Element.prototype.remove
        Element.prototype.remove = function (this: Element) {
            const active = document.activeElement
            if (active && this.contains(active)) {
                active.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
            }
            originalRemove.call(this)
        }
        try {
            geometry.setWidth(THREE_COLUMNS)
            await resizeContainer(target)
            await settleMicrotasks()
        } finally {
            Element.prototype.remove = originalRemove
        }

        // Card 5 moved from the row starting at 5 to the row starting at 3: its element was re-created.
        const after = tileOf(target, '5')?.querySelector('button')
        expect(after).toBeTruthy()
        expect(after).not.toBe(before)
        expect(document.activeElement).toBe(after)

        await geometry.scrollAndSettle(80 * GRID_ROW)
        expect(tileOf(target, '5')).not.toBeNull()
        expect(document.activeElement).toBe(tileOf(target, '5')!.querySelector('button'))
    })

    test('(F) a change while focus is elsewhere does not move focus', async () => {
        const { target } = await mountGrid()
        const other = document.createElement('button')
        document.body.appendChild(other)
        other.focus()
        await settleMicrotasks()
        geometry.setWidth(THREE_COLUMNS)
        await resizeContainer(target)
        await settleMicrotasks()
        expect(document.activeElement).toBe(other)
    })
})

//#endregion
