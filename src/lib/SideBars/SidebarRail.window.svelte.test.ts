// @vitest-environment happy-dom

/**
 * Windowing of the character rail, driven through the REAL `Sidebar.svelte` (and so the real
 * `SidebarRail.svelte`) with fake geometry (`installGeometry`, see `sidebarDnd.testKit.ts`).
 *
 * happy-dom has no layout and no ResizeObserver reports, so the container's height and scroll
 * position are the kit's. The rail reads them on a scroll event, in an animation frame; the
 * tests that scroll wait for that frame with real animation frames (`scrollAndSettle`).
 *
 * MOCKED: `checkCharOrder` (a spy), `changeChar`, the chat list, `alertSelect` / `alertInput`
 * and the storage and platform modules.
 *
 * Test labels: `(R)` fails against a rail that mounts every row (red at the pre-windowing
 * rail). `(G)` states behaviour that windowing must keep; it is proven by a mutant of the
 * rail that it fails against (a pin dropped, a release removed, a read removed), not by
 * passing before and after: most (G) tests also fail against the pre-windowing rail, because
 * they drive the kit's scroll position or the new aria attributes.
 */
import { mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { describe, test, expect, vi, afterEach, beforeEach } from 'vitest'
import type { Database } from '../../ts/storage/database.svelte'
import type { RisuEnvironmentLabel } from '../../ts/platform'

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))

const { checkCharOrderSpy, changeCharSpy } = vi.hoisted(() => ({
    checkCharOrderSpy: vi.fn(),
    changeCharSpy: vi.fn(),
}))

vi.mock(
    import('src/ts/globalApi.svelte'),
    () =>
        ({
            forageStorage: {
                keys: vi.fn(async () => []),
                getItem: vi.fn(async () => null),
                setItem: vi.fn(async () => {}),
            },
            getFileSrc: vi.fn(async (loc: string) => `data:mock-image;loc=${loc}`),
            checkCharOrder: checkCharOrderSpy,
            requiresFullEncoderReload: { state: false },
            AppendableBuffer: class {},
            VirtualWriter: class {},
            LocalWriter: class {},
            BlankWriter: class {},
            downloadFile: vi.fn(),
            openURL: vi.fn(),
            loadAsset: vi.fn(),
            saveAsset: vi.fn(async () => 'asset-1'),
            readImage: vi.fn(),
            globalFetch: vi.fn(),
            aiWatermarkingLawApplies: vi.fn(() => false),
            changeChatTo: vi.fn(),
            hubURL: '',
            usingSw: false,
            getFetchLogs: vi.fn(() => []),
            getFetchData: vi.fn(() => ({})),
            aiLawApplies: vi.fn(() => false),
        }) as unknown as typeof import('src/ts/globalApi.svelte'),
)

vi.mock(import('src/ts/storage/database.svelte'), async () => {
    const { DBState } = await import('../../ts/stores.svelte')
    return {
        getDatabase: vi.fn(() => DBState.db),
        getCurrentCharacter: vi.fn(() => DBState.db.characters?.[0]),
        presetTemplate: { name: 'test-preset' },
    } as unknown as typeof import('src/ts/storage/database.svelte')
})

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
    isIOS: () => false,
    getDetailedOSLabel: vi.fn(async () => 'test-os'),
    getFallbackOSLabel: vi.fn(() => 'test-os'),
    getRisuEnvironmentLabel: vi.fn((): RisuEnvironmentLabel => 'web'),
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(),
    readFile: vi.fn(),
    remove: vi.fn(),
    readDir: vi.fn(async () => []),
    BaseDirectory: { AppData: 0 },
}))

vi.mock(import('../../ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(-1),
        MobileGUIStack: writable([]),
        CharEmotion: writable(new Map()),
        OpenRealmStore: writable({ isOpen: false }),
        MobileSearch: writable(''),
        alertStore: writable({ type: 'none', msg: '' }),
        selIdState: { state: -1 },
        SettingsMenuIndex: writable(0),
        ShowRealmFrameStore: writable(false),
        settingsOpen: writable(false),
        botMakerMode: writable(false),
        DynamicGUI: writable(false),
        sideBarClosing: writable(false),
        sideBarStore: writable({ tab: 0 }),
        PlaygroundStore: writable({ open: false }),
        QuickSettings: writable([]),
        additionalHamburgerMenu: writable([]),
        CharConfigSubMenu: writable(0),
        MobileGUI: writable(false),
        hypaV3ModalOpen: writable(false),
        ReloadGUIPointer: writable(0),
        bookmarkListOpen: writable(false),
        alertGenerationInfoStore: writable(null),
    } as unknown as typeof import('../../ts/stores.svelte')
})

// The chat list of a selected character is not under test here.
vi.mock('./SideChatList.svelte', () => ({ default: () => {} }))

vi.mock(import('../../ts/characters'), async (importOriginal) => ({
    ...(await importOriginal()),
    changeChar: changeCharSpy,
}))

vi.mock(import('src/ts/alert'), async (importOriginal) => ({
    ...(await importOriginal()),
    alertSelect: vi.fn(async () => '3'),
    alertInput: vi.fn(async () => ''),
}))

import { DBState, selectedCharID } from '../../ts/stores.svelte'
import Sidebar from './Sidebar.svelte'
import { DEFAULT_HEIGHTS, UNMEASURED_VIEWPORT_PX, WINDOW_MIN_OVERSCAN_ROWS, WINDOW_OVERSCAN_VIEWPORTS } from './railConstants'
import { charKey } from './railTestKit'
import {
    boxOf,
    charRow,
    clientY,
    defaultSettle,
    folderAvatars,
    installGeometry,
    pointer,
    scrollerOf,
    settleFrame,
    topGaps,
    type Geometry,
} from './sidebarDnd.testKit'

//#region fixture and helpers

interface FolderFixture {
    id: string
    name: string
    color: string
    data: string[]
}
type OrderFixture = Array<string | FolderFixture>

const folderOf = (id: string, data: string[]): FolderFixture => ({ id, name: `Name ${id}`, color: '', data })
const ids = (count: number, from = 0): string[] => Array.from({ length: count }, (_, i) => `c${from + i}`)

/** One default character row plus the gap after it. */
const ROW_PITCH = DEFAULT_HEIGHTS.char + DEFAULT_HEIGHTS.gap
/** The first gap lies above the first row. */
const rowTop = (index: number): number => DEFAULT_HEIGHTS.gap + index * ROW_PITCH
/** Pins that can be mounted outside the band: the Tab stop, a reveal and a press. */
const MAX_PINS = 3

function overscanPx(viewport: number): number {
    return Math.max(WINDOW_OVERSCAN_VIEWPORTS * viewport, WINDOW_MIN_OVERSCAN_ROWS * DEFAULT_HEIGHTS.char)
}

/** Most character entries that can be mounted for a viewport: the band, one row of slack and the pins. */
function entryBound(viewport: number): number {
    const band = viewport + 2 * overscanPx(viewport)
    return Math.ceil(band / ROW_PITCH) + 1 + MAX_PINS
}

function setDb(order: OrderFixture, characterCount: number, extra: Record<string, unknown> = {}): void {
    DBState.db = {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        characterOrder: order,
        characters: ids(characterCount).map((chaId) => ({ chaId, name: chaId, image: '', type: 'character', chats: [], chatPage: 0 })),
        hideAllImages: false,
        ...extra,
    } as unknown as Database
}

let mounted: { target: HTMLElement; app: Record<string, unknown> } | null = null
let root: HTMLElement
let geo: Geometry

async function settle(): Promise<void> {
    await defaultSettle()
    await tick()
    await defaultSettle()
}

interface MountOptions {
    /** Container height; `null` leaves the container unlaid-out like a hidden one. */
    height?: number | null
    extra?: Record<string, unknown>
    characters?: number
}

async function mountRail(order: OrderFixture, options: MountOptions = {}): Promise<HTMLElement> {
    const count = options.characters ?? order.length
    setDb(order, count, options.extra)
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(Sidebar, { target, props: {} }) as unknown as Record<string, unknown>
    mounted = { target, app }
    await settle()
    root = target
    if (options.height !== null) {
        geo = installGeometry(target, options.height ?? 600)!
        await settleFrame()
    }
    return target
}

async function unmountRail(): Promise<void> {
    if (mounted) {
        await unmount(mounted.app as never)
        mounted.target.remove()
        mounted = null
    }
}

beforeEach(() => {
    checkCharOrderSpy.mockClear()
    changeCharSpy.mockClear()
    selectedCharID.set(-1)
})

afterEach(async () => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    try {
        await unmountRail()
    } catch {
        // a sidebar that failed half way through mounting is torn down best effort
    }
    document.body.innerHTML = ''
})

const entries = (): HTMLElement[] => Array.from(root.querySelectorAll<HTMLElement>('[data-rail-entry]'))
const entryOf = (key: string): HTMLElement | null => entries().find((el) => el.getAttribute('data-rail-entry') === key) ?? null
const focusedKey = (): string | null => (document.activeElement as HTMLElement | null)?.getAttribute?.('data-rail-entry') ?? null
const orderNow = (): string[] =>
    ($state.snapshot(DBState.db.characterOrder) as unknown as OrderFixture).map((e) => (typeof e === 'string' ? e : `${e.id}[${e.data.join(',')}]`))

function focusEntry(key: string): HTMLElement {
    const el = entryOf(key)
    expect(el).not.toBeNull()
    el!.focus()
    return el!
}

async function pressAndSettle(el: Element, key: string, init: KeyboardEventInit = {}): Promise<void> {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))
    await settle()
}

/** The rendered rows and spacers, in document order, add up to the model's offsets and total height. */
function expectModelGeometry(): void {
    const scroller = scrollerOf(root)
    let y = 0
    for (const child of Array.from(scroller.children) as HTMLElement[]) {
        if (child.hasAttribute('data-rail-spacer')) {
            expect(child.style.minHeight).toBe(child.style.height)
            y += Number.parseFloat(child.style.height)
            continue
        }
        const top = child.getAttribute('data-rail-y')
        if (top === null) {
            continue
        }
        expect(Number(top)).toBe(y)
        y += Number(child.getAttribute('data-rail-h'))
    }
    expect(y).toBe(Number(scroller.getAttribute('data-rail-total')))
}

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
            sizes.map(([target, blockSize]) => ({ target, borderBoxSize: [{ blockSize, inlineSize: 72 }], contentRect: { height: blockSize } }) as unknown as ResizeObserverEntry),
            this as unknown as ResizeObserver,
        )
    }
}

const observer = (): FakeResizeObserver => FakeResizeObserver.instances[0]

//#endregion

describe('the mounted window', () => {
    test('(R) 200 characters at a 600 px viewport mount a bounded window that follows the scroll and reproduces the model offsets', async () => {
        await mountRail(ids(200))
        expect(entries().length).toBeLessThanOrEqual(entryBound(600))
        expect(entryOf(charKey('c1'))).not.toBeNull()
        expectModelGeometry()

        await geo.scrollAndSettle(rowTop(100))
        expect(entries().length).toBeLessThanOrEqual(entryBound(600))
        expect(entryOf(charKey('c100'))).not.toBeNull()
        expect(entryOf(charKey('c1'))).toBeNull()
        expectModelGeometry()

        await geo.scrollAndSettle(0)
        expect(entryOf(charKey('c1'))).not.toBeNull()
        expect(entryOf(charKey('c100'))).toBeNull()
    })

    test('(R) a container that has no height at mount renders a bounded window, not every row', async () => {
        await mountRail(ids(500), { height: null })
        const viewport = window.innerHeight > 0 ? window.innerHeight : UNMEASURED_VIEWPORT_PX
        expect(entries().length).toBeLessThanOrEqual(entryBound(viewport))
        expect(entries().length).toBeGreaterThan(0)
    })

    test('(R) the mounted element, entry and tooltip counts are the same at 500, 1000 and 2000 characters and within the bound', async () => {
        const rows: Array<{ entries: number; elements: number; tooltips: number }> = []
        for (const count of [500, 1000, 2000]) {
            await mountRail(ids(count))
            rows.push({
                entries: entries().length,
                elements: scrollerOf(root).querySelectorAll('*').length,
                tooltips: entries().filter((el) => '_tippy' in el).length,
            })
            await unmountRail()
        }
        expect(rows[0].entries).toBeLessThanOrEqual(entryBound(600))
        expect(rows[1]).toEqual(rows[0])
        expect(rows[2]).toEqual(rows[0])
    }, 60_000)

    describe('with a ResizeObserver that reports on demand', () => {
        beforeEach(() => {
            FakeResizeObserver.instances.length = 0
            vi.stubGlobal('ResizeObserver', FakeResizeObserver)
        })

        test('(R) a rail that was scrolled, hidden and shown again windows around the scroll position the container has now', async () => {
            await mountRail(ids(500))
            await geo.scrollAndSettle(rowTop(138))
            expect(entryOf(charKey('c138'))).not.toBeNull()

            geo.hide()
            observer().report([[scrollerOf(root), 0]])
            await settleFrame()
            expect(entries().length).toBeLessThanOrEqual(entryBound(600))

            // Shown at a position that no scroll event announced: only the size report can tell the rail.
            geo.show(rowTop(300))
            observer().report([[scrollerOf(root), 600]])
            await settleFrame()
            expect(entries().length).toBeLessThanOrEqual(entryBound(600))
            const rendered = Array.from(scrollerOf(root).querySelectorAll<HTMLElement>('[data-rail-y]')).map(boxOf)
            expect(Math.min(...rendered.map((b) => b.y))).toBeLessThanOrEqual(geo.scrollTop)
            expect(Math.max(...rendered.map((b) => b.y + b.h))).toBeGreaterThanOrEqual(geo.scrollTop + 600)
            expect(entryOf(charKey('c300'))).not.toBeNull()
            expect(entryOf(charKey('c303'))).not.toBeNull()
            expect(entryOf(charKey('c138'))).toBeNull()
            expectModelGeometry()
        })

        test('(G) a measured row keeps its height when it is scrolled out and back, and loses it when its character leaves the list', async () => {
            const order = ids(200)
            await mountRail(order)
            observer().report([[charRow(root, 'c3'), 70]])
            await settle()
            expect(boxOf(charRow(root, 'c3')).h).toBe(70)

            await geo.scrollAndSettle(rowTop(120))
            expect(entryOf(charKey('c3'))).toBeNull()
            await geo.scrollAndSettle(0)
            expect(boxOf(charRow(root, 'c3')).h).toBe(70)

            DBState.db.characterOrder = order.filter((id) => id !== 'c3')
            await settleFrame()
            expect(entryOf(charKey('c3'))).toBeNull()
            DBState.db.characterOrder = order
            await settleFrame()
            expect(boxOf(charRow(root, 'c3')).h).toBe(DEFAULT_HEIGHTS.char)
        })
    })
})

describe('pins and focus', () => {
    test('(G) the selected character stays the single Tab stop and stays mounted while it is far outside the window', async () => {
        selectedCharID.set(150)
        await mountRail(ids(200))
        const stops = (): string[] => entries().filter((el) => el.getAttribute('tabindex') === '0').map((el) => el.getAttribute('data-rail-entry')!)
        expect(stops()).toEqual([charKey('c150')])
        expect(entries().length).toBeLessThanOrEqual(entryBound(600))
        expectModelGeometry()

        selectedCharID.set(0)
        await settleFrame()
        await geo.scrollAndSettle(rowTop(190))
        expect(stops()).toEqual([charKey('c0')])
    })

    test('(G) a focused entry that is scrolled far out stays mounted and focused, and a later rail change does not pull the scroll back', async () => {
        await mountRail(ids(200))
        const el = focusEntry(charKey('c3'))
        await geo.scrollAndSettle(rowTop(150))
        expect(entryOf(charKey('c3'))).toBe(el)
        expect(document.activeElement).toBe(el)

        const parked = geo.scrollTop
        DBState.db.characters[7].name = 'renamed'
        await settleFrame()
        expect(geo.scrollTop).toBe(parked)
        expect(document.activeElement).toBe(el)
    })

    test('(G) End, Home and ArrowDown reveal their entry, mounting it first when it is outside the window', async () => {
        await mountRail(ids(200))
        const first = focusEntry(charKey('c0'))
        await pressAndSettle(first, 'End')
        expect(focusedKey()).toBe(charKey('c199'))
        const last = boxOf(charRow(root, 'c199'))
        expect(last.y).toBeGreaterThanOrEqual(geo.scrollTop)
        expect(last.y + last.h).toBeLessThanOrEqual(geo.scrollTop + 600)
        // The rows around it are mounted in the same turn, not after the scroll event: no blank viewport.
        expect(entryOf(charKey('c197'))).not.toBeNull()
        expect(entryOf(charKey('c193'))).not.toBeNull()

        await pressAndSettle(document.activeElement!, 'Home')
        expect(focusedKey()).toBe(charKey('c0'))
        expect(geo.scrollTop).toBe(rowTop(0))

        const lastVisible = focusEntry(charKey('c7'))
        await pressAndSettle(lastVisible, 'ArrowDown')
        expect(focusedKey()).toBe(charKey('c8'))
        const next = boxOf(charRow(root, 'c8'))
        expect(next.y + next.h).toBeLessThanOrEqual(geo.scrollTop + 600)
    })

    test('(G) Alt+ArrowDown on the entry at the bottom of the viewport moves it, focus follows and the entry is revealed', async () => {
        await mountRail(ids(200))
        const el = focusEntry(charKey('c7'))
        await pressAndSettle(el, 'ArrowDown', { altKey: true })
        expect(orderNow().slice(6, 10)).toEqual(['c6', 'c8', 'c7', 'c9'])
        expect(focusedKey()).toBe(charKey('c7'))
        const moved = boxOf(charRow(root, 'c7'))
        expect(moved.y + moved.h).toBeLessThanOrEqual(geo.scrollTop + 600)
        expect(moved.y).toBeGreaterThanOrEqual(geo.scrollTop)
    })
})

describe('drag during windowing', () => {
    test('(G) the pressed row stays mounted when the rail is wheel-scrolled before the drag starts, and the drop writes the predicted order', async () => {
        await mountRail(ids(200))
        const source = charRow(root, 'c2')
        const pressY = clientY(root, source)
        source.dispatchEvent(pointer('pointerdown', pressY))
        await geo.scrollAndSettle(rowTop(60))
        const entry = entryOf(charKey('c2'))
        expect(entry).not.toBeNull()

        window.dispatchEvent(pointer('pointermove', pressY + 6))
        await settle()
        const ghost = document.querySelector('[data-rail-ghost]')
        expect(ghost).not.toBeNull()
        expect(ghost!.childElementCount).toBe(1)

        await geo.scrollAndSettle(rowTop(120))
        expect(entryOf(charKey('c2'))).toBe(entry)

        const gap = topGaps(root).find((g) => {
            const y = clientY(root, g)
            return y > 150 && y < 450
        })!
        const afterKey = JSON.parse(gap.getAttribute('data-rail-key')!)[2] as string | null
        const afterId = afterKey === null ? null : (JSON.parse(afterKey)[1] as string)
        const y = clientY(root, gap)
        window.dispatchEvent(pointer('pointermove', y))
        await settle()
        window.dispatchEvent(pointer('pointerup', y))
        await settle()

        const rest = ids(200).filter((id) => id !== 'c2')
        const expected = [...rest]
        expected.splice(afterId === null ? 0 : expected.indexOf(afterId) + 1, 0, 'c2')
        expect(orderNow()).toEqual(expected)
        expect(document.querySelector('[data-rail-ghost]')).toBeNull()
    })
})

describe('scroll to the active character', () => {
    const scrollToActive = async (): Promise<void> => {
        window.dispatchEvent(new Event('scrollToActiveCharacter'))
        await settleFrame()
        await settleFrame()
    }

    function spyScrollTo(): ReturnType<typeof vi.fn> {
        const spy = vi.fn()
        Object.defineProperty(scrollerOf(root), 'scrollTo', { configurable: true, value: spy })
        return spy
    }

    test('(G) an off-window character is revealed at the top of the viewport and mounted', async () => {
        selectedCharID.set(150)
        await mountRail(ids(200), { extra: { animationSpeed: 0 } })
        await scrollToActive()
        const row = charRow(root, 'c150')
        expect(geo.scrollTop).toBe(boxOf(row).y)
        expect(geo.scrollTop).toBe(rowTop(150))
    })

    test('(G) a target within two viewports animates, one beyond jumps, and animationSpeed 0 always jumps', async () => {
        selectedCharID.set(12)
        await mountRail(ids(200), { extra: { animationSpeed: 0.2 } })
        const spy = spyScrollTo()
        await scrollToActive()
        expect(spy).toHaveBeenCalledTimes(1)
        expect(spy).toHaveBeenCalledWith({ top: rowTop(12), behavior: 'smooth' })
        expect(geo.scrollTop).toBe(0)

        selectedCharID.set(150)
        spy.mockClear()
        await scrollToActive()
        expect(spy).not.toHaveBeenCalled()
        expect(geo.scrollTop).toBe(rowTop(150))

        await geo.scrollAndSettle(0)
        DBState.db.animationSpeed = 0
        selectedCharID.set(12)
        await scrollToActive()
        expect(spy).not.toHaveBeenCalled()
        expect(geo.scrollTop).toBe(rowTop(12))
    })

    test('(G) a member of a closed folder opens its folder and is scrolled to', async () => {
        selectedCharID.set(2)
        await mountRail(['c0', folderOf('f1', ['c1', 'c2', 'c3']), ...ids(100, 4)], { characters: 104, extra: { animationSpeed: 0 } })
        expect(root.querySelectorAll('[data-rail-kind="member"]').length).toBe(0)
        await scrollToActive()
        expect(root.querySelectorAll('[data-rail-kind="member"]').length).toBe(3)
        expect(geo.scrollTop).toBe(boxOf(charRow(root, 'c2')).y)
        expect(geo.scrollTop).toBeGreaterThan(0)
    })

    test('(G) with the id listed twice the selected occurrence in model order is the one scrolled to', async () => {
        selectedCharID.set(1)
        const order = ['c0', ...ids(100, 2), 'c1', ...ids(98, 102), 'c1']
        await mountRail(order, { characters: 200, extra: { animationSpeed: 0 } })
        await scrollToActive()
        expect(geo.scrollTop).toBe(rowTop(101))
        expect(boxOf(charRow(root, 'c1', 0)).y).toBe(geo.scrollTop)
    })
})

describe('the open folder background', () => {
    test('(G) is drawn while the folder is longer than the viewport and its head and tail are both unmounted', async () => {
        await mountRail([folderOf('f1', ids(40)), ...ids(10, 40)], { characters: 50 })
        folderAvatars(root)[0].click()
        await settle()
        await geo.scrollAndSettle(1400)
        expect(root.querySelector('[data-rail-kind="folderHead"]')).toBeNull()
        expect(root.querySelector('[data-rail-kind="folderTail"]')).toBeNull()
        const bg = root.querySelector<HTMLElement>('[data-rail-folder-bg]')
        expect(bg).not.toBeNull()
        expect(Number.parseFloat(bg!.style.top)).toBeLessThan(1400)
        expect(Number.parseFloat(bg!.style.top) + Number.parseFloat(bg!.style.height)).toBeGreaterThan(1400 + 600)
    })
})

describe('ARIA position', () => {
    test('(G) every list item carries the set size and its position across an open folder and the plus block', async () => {
        await mountRail(['c0', folderOf('f1', ['c1', 'c2']), 'c3'], { characters: 4 })
        folderAvatars(root)[0].click()
        await settle()
        const items = Array.from(scrollerOf(root).querySelectorAll<HTMLElement>('[role="listitem"]'))
        expect(items.length).toBe(6)
        expect(items.map((el) => el.getAttribute('aria-setsize'))).toEqual(['6', '6', '6', '6', '6', '6'])
        expect(items.map((el) => el.getAttribute('aria-posinset'))).toEqual(['1', '2', '3', '4', '5', '6'])
    })

    test('(G) a mounted row far down the list reports its position in the whole list', async () => {
        await mountRail(ids(200))
        await geo.scrollAndSettle(rowTop(100))
        const row = charRow(root, 'c100')
        expect(row.getAttribute('aria-posinset')).toBe('101')
        expect(row.getAttribute('aria-setsize')).toBe('201')
    })
})

describe('reveal and press pins', () => {
    // Geometry is installed but no animation frame has run, so the rail has not read it: its
    // window is still the unmeasured one (about 768 px plus overscan) while the container is
    // 2000 px high. A scroll-to-active target 2900 px down is then within the smooth range but
    // outside the mounted window, and only the reveal pin can keep it mounted.
    async function startSmoothScrollToActive(focusKey: string | null = null) {
        await mountRail(ids(200), { height: null, extra: { animationSpeed: 0.2 } })
        geo = installGeometry(root, 2000)!
        const scrollTo = vi.fn()
        Object.defineProperty(scrollerOf(root), 'scrollTo', { configurable: true, value: scrollTo })
        if (focusKey) {
            focusEntry(focusKey)
        }
        selectedCharID.set(40)
        window.dispatchEvent(new Event('scrollToActiveCharacter'))
        selectedCharID.set(-1)
        await settle()
        return scrollTo
    }

    test('(G) the target of an animated scroll-to-active stays mounted while the scroll is in flight', async () => {
        const scrollTo = await startSmoothScrollToActive()
        expect(scrollTo).toHaveBeenCalledWith({ top: rowTop(40), behavior: 'smooth' })
        expect(entryOf(charKey('c40'))).not.toBeNull()
    })

    test('(G) the end of the animated scroll releases the pin of its target', async () => {
        await startSmoothScrollToActive()
        expect(entryOf(charKey('c40'))).not.toBeNull()
        scrollerOf(root).dispatchEvent(new Event('scrollend'))
        await settle()
        expect(entryOf(charKey('c40'))).toBeNull()
    })

    test('(G) an arrow key that only moves focus leaves the pin of a scroll-to-active in flight alone', async () => {
        await startSmoothScrollToActive(charKey('c0'))
        expect(entryOf(charKey('c40'))).not.toBeNull()
        await pressAndSettle(document.activeElement!, 'ArrowDown')
        expect(focusedKey()).toBe(charKey('c1'))
        expect(entryOf(charKey('c40'))).not.toBeNull()
    })

    test('(G) a reveal that has focused its entry no longer pins it once focus moves on', async () => {
        await mountRail(ids(200))
        await pressAndSettle(focusEntry(charKey('c3')), 'End')
        await pressAndSettle(document.activeElement!, 'Home')
        expect(focusedKey()).toBe(charKey('c0'))
        focusEntry(charKey('c4'))
        await geo.scrollAndSettle(rowTop(150))
        expect(entryOf(charKey('c0'))).toBeNull()
        expect(entryOf(charKey('c4'))).not.toBeNull()
    })

    test('(G) the row of a press that ended without a drag is unmounted again once it is outside the window', async () => {
        await mountRail(ids(200))
        const source = charRow(root, 'c2')
        const pressY = clientY(root, source)
        source.dispatchEvent(pointer('pointerdown', pressY))
        await geo.scrollAndSettle(rowTop(120))
        expect(entryOf(charKey('c2'))).not.toBeNull()
        window.dispatchEvent(pointer('pointerup', pressY))
        await settleFrame()
        expect(entryOf(charKey('c2'))).toBeNull()
    })
})

describe('focus on the plus button', () => {
    test('(G) a focused plus button is not unmounted by scrolling, so a later rail change leaves the scroll alone', async () => {
        await mountRail(ids(200))
        await geo.scrollAndSettle(rowTop(100))
        focusEntry(charKey('c100'))
        await geo.scrollAndSettle(100000)
        const plus = root.querySelector<HTMLElement>('[data-rail-kind="plus"] button')!
        plus.focus()
        await settle()
        expect(document.activeElement).toBe(plus)

        await geo.scrollAndSettle(rowTop(20))
        const parked = geo.scrollTop
        DBState.db.characters[7].name = 'renamed'
        await settleFrame()
        expect(geo.scrollTop).toBe(parked)
        expect(document.activeElement).toBe(plus)
    })
})