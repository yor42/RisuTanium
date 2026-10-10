// @vitest-environment happy-dom

/**
 * `GridCatalog.svelte`: the tabs mount only the rows or tiles near their scroll viewport. With 200
 * characters the List, Trash and Simple tabs mount a bounded window instead of every row, watch
 * no row with an `IntersectionObserver`, scroll as the one container under the header, and keep
 * their avatars and controls stable while they do. The Grid tab does the same with 300 characters
 * laid out in rows of tiles, and its rows follow the column count of its container.
 *
 * Fixture size: 200 characters (300 for the Grid tab) in a happy-dom document that is 768 px high,
 * so a tab that mounted every row would mount all of them. Counts for 500 to 2000 characters live
 * in the `charlist-window-count` harness, not in this suite.
 *
 * Test labels: `(R)` is a reproducer: it fails on the commit before the windowed lists with an
 * assertion about the defect (every row mounted, an observer per row, a nested button, a header
 * inside the scroller, an avatar element re-created under focus). `(F)` is a feature test: it
 * asserts the new list container or its attributes, which do not exist before. `(G)` is a guard
 * that may pass before and after.
 *
 * MOCKED: the module set of `GridCatalog.pick.svelte.test.ts` (same directory), with `changeChar`
 * and `removeChar` bare spies, and a fake `IntersectionObserver` that counts the targets it was
 * asked to watch (no tab watches one). Geometry is faked as in `CharacterWindow.svelte.test.ts`:
 * the container's width is a mutable value every element reports. Nothing here writes to storage.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from '../../ts/storage/database.svelte'
import type { RisuEnvironmentLabel } from '../../ts/platform'

//#region module mocks

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))

const { changeCharSpy, removeCharSpy } = vi.hoisted(() => ({
    changeCharSpy: vi.fn(),
    removeCharSpy: vi.fn(),
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
            checkCharOrder: vi.fn(),
            requiresFullEncoderReload: { state: false },
            AppendableBuffer: class {},
            VirtualWriter: class {},
            LocalWriter: class {},
            BlankWriter: class {},
            downloadFile: vi.fn(),
            openURL: vi.fn(),
            loadAsset: vi.fn(),
            saveAsset: vi.fn(),
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
        getDatabase: vi.fn((_options?: { snapshot?: boolean }) => DBState.db),
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

vi.mock(import('../../ts/characters'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        changeChar: changeCharSpy,
        removeChar: removeCharSpy,
    }
})

vi.mock(import('../../ts/media/avatarThumb'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        getAvatarThumbSrc: vi.fn(async () => null),
    }
})

//#endregion

/** Reports every target visible at once and remembers every target it was asked to watch. */
class CountingIntersectionObserver implements IntersectionObserver {
    static watched: Element[] = []
    readonly root: Element | Document | null = null
    readonly rootMargin: string = ''
    readonly thresholds: ReadonlyArray<number> = []
    #callback: IntersectionObserverCallback

    constructor(callback: IntersectionObserverCallback) {
        this.#callback = callback
    }

    observe(target: Element): void {
        CountingIntersectionObserver.watched.push(target)
        this.#callback([{ target, isIntersecting: true, intersectionRatio: 1 } as IntersectionObserverEntry], this)
    }

    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): IntersectionObserverEntry[] {
        return []
    }
}

import { DBState } from '../../ts/stores.svelte'
import { language } from '../../lang'
import GridCatalog from './GridCatalog.svelte'

//#region fixtures and helpers

type CharacterFixture = Database['characters'][number]

const COUNT = 200
/** Far more than any window of a 768 px document holds, far less than the fixture. */
const MOST_MOUNTED = 40

function makeCharacter(index: number, extra: Record<string, unknown> = {}): CharacterFixture {
    return {
        chaId: `id-${index}`,
        name: `Character ${index}`,
        type: 'character',
        image: `assets/${index}.png`,
        creatorNotes: `Description ${index}`,
        chatPage: 0,
        lastInteraction: index,
        chats: [{ id: `id-${index}-chat`, message: [], note: '', name: '', localLore: [] }],
        ...extra,
    } as unknown as CharacterFixture
}

function buildDb(characters: CharacterFixture[]): Database {
    return {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        characterOrder: characters.map((c) => c.chaId),
        characters,
        hideAllImages: false,
    } as unknown as Database
}

const live = (count = COUNT): CharacterFixture[] => Array.from({ length: count }, (_, i) => makeCharacter(i))
const trashed = (count = COUNT): CharacterFixture[] => Array.from({ length: count }, (_, i) => makeCharacter(i, { trashTime: 1_700_000_000_000 + i }))

async function settle(): Promise<void> {
    for (let i = 0; i < 6; i++) {
        flushSync()
        await Promise.resolve()
    }
    flushSync()
}

async function settleFrame(): Promise<void> {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    await settle()
}

async function withMounted(body: (target: HTMLElement) => void | Promise<void>, endGrid: () => void = () => {}): Promise<void> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(GridCatalog, { target, props: { endGrid } }) as Record<string, unknown>
    try {
        await settle()
        await body(target)
    } finally {
        await unmount(app as never)
        target.remove()
    }
}

function clickLayoutButton(root: HTMLElement, layout: 0 | 1 | 2 | 3): void {
    const label =
        (layout === 0 ? language.grid : layout === 1 ? language.list : layout === 2 ? language.trash : language.simple).trim()
    const btn = Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.trim() === label)
    if (!btn) {
        throw new Error(`layout button not found for label "${label}"`)
    }
    btn.click()
    flushSync()
}

function scrollerOf(root: ParentNode): HTMLElement {
    const el = root.querySelector<HTMLElement>('[role="list"][data-charlist-total]')
    if (!el) {
        throw new Error('no windowed list in this DOM')
    }
    return el
}

interface Geometry {
    readonly writes: number[]
    scrollAndSettle(top: number): Promise<void>
}

/** Gives the container a 600 px height and a scroll position clamped to the list's total. */
function installGeometry(el: HTMLElement): Geometry {
    const height = 600
    let top = 0
    const writes: number[] = []
    const total = (): number => Number(el.getAttribute('data-charlist-total') ?? 0)
    Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => height })
    Object.defineProperty(el, 'scrollTop', {
        configurable: true,
        get: () => top,
        set: (value: number) => {
            writes.push(value)
            top = Math.max(0, Math.min(value, Math.max(0, total() - height)))
        },
    })
    el.dispatchEvent(new Event('scroll'))
    return {
        writes,
        async scrollAndSettle(value) {
            top = value
            el.dispatchEvent(new Event('scroll'))
            await settleFrame()
        },
    }
}

const rowNames = (root: ParentNode): string[] => Array.from(root.querySelectorAll('h4')).map((h) => h.textContent?.trim() ?? '')

/** Four tiles fit (a tile is 56 px and a gap 8 px at 16 px per rem). */
const FOUR_COLUMNS = 312
/** Three tiles fit. */
const THREE_COLUMNS = 200
const TILE_ROW = 64
/** The most tiles a 768 px document can mount: its band of rows at four per row, with slack. */
const MOST_TILES = 150

let containerWidth = FOUR_COLUMNS
let clientWidthDescriptor: PropertyDescriptor | undefined

/** Reports a size change of the container to the window's observer, as the browser does. */
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
    static reportContainer(el: Element): void {
        const owner = FakeResizeObserver.instances.find((instance) => instance.observed.has(el))
        if (!owner) {
            throw new Error('no observer watches the container')
        }
        owner.callback(
            [{ target: el, borderBoxSize: [{ blockSize: 0, inlineSize: 0 }], contentRect: { height: 0 } } as unknown as ResizeObserverEntry],
            owner as unknown as ResizeObserver,
        )
    }
}

beforeEach(() => {
    changeCharSpy.mockClear()
    removeCharSpy.mockClear()
    CountingIntersectionObserver.watched.length = 0
    FakeResizeObserver.instances.length = 0
    containerWidth = FOUR_COLUMNS
    clientWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => containerWidth })
    vi.stubGlobal('IntersectionObserver', CountingIntersectionObserver)
    vi.stubGlobal('ResizeObserver', undefined)
})

afterEach(() => {
    vi.unstubAllGlobals()
    if (clientWidthDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthDescriptor)
    } else {
        delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth
    }
})

//#endregion

describe('GridCatalog tabs: a bounded window of rows', { timeout: 60_000 }, () => {
    test('(R) the List tab mounts a bounded number of rows of 200 characters', async () => {
        DBState.db = buildDb(live())
        await withMounted((target) => {
            clickLayoutButton(target, 1)
            const rows = rowNames(target).length
            expect(rows).toBeGreaterThan(0)
            expect(rows).toBeLessThan(MOST_MOUNTED)
        })
    })

    test('(R) the Trash tab mounts a bounded number of rows of 200 trashed characters', async () => {
        DBState.db = buildDb(trashed())
        await withMounted((target) => {
            clickLayoutButton(target, 2)
            const rows = rowNames(target).length
            expect(rows).toBeGreaterThan(0)
            expect(rows).toBeLessThan(MOST_MOUNTED)
        })
    })

    test('(R) the Simple tab mounts a bounded number of rows of 200 characters', async () => {
        DBState.db = buildDb(live())
        await withMounted((target) => {
            const rows = target.querySelectorAll('.ico').length
            expect(rows).toBeGreaterThan(0)
            expect(rows).toBeLessThan(MOST_MOUNTED)
        })
    })

    test('(R) the List, Trash and Simple tabs watch no row with an observer', async () => {
        DBState.db = buildDb([...live(100), ...trashed(100).map((c, i) => ({ ...c, chaId: `trash-${i}` }) as CharacterFixture)])
        await withMounted(async (target) => {
            await settle()
            clickLayoutButton(target, 1)
            await settle()
            clickLayoutButton(target, 2)
            await settle()
            clickLayoutButton(target, 3)
            await settle()
            expect(CountingIntersectionObserver.watched.length).toBe(0)
        })
    })

    test('(R) the Simple tab rows hold no button inside a button', async () => {
        DBState.db = buildDb(live(5))
        await withMounted((target) => {
            expect(target.querySelectorAll('.ico').length).toBe(5)
            expect(target.querySelector('button button')).toBeNull()
        })
    })

    test('(R) the header stays outside the scroller on every tab, and the tab content is the only scroller', async () => {
        DBState.db = buildDb(live(30))
        await withMounted((target) => {
            for (const layout of [3, 0, 1, 2] as const) {
                clickLayoutButton(target, layout)
                const scrollers = Array.from(target.querySelectorAll('.overflow-y-auto'))
                expect(scrollers.length).toBe(1)
                const input = target.querySelector('input')!
                expect(scrollers[0].contains(input)).toBe(false)
                expect(scrollers[0].contains(Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.trim() === language.list)!)).toBe(false)
            }
        })
    })

    // Passes before and after: the Grid tile was already a stable element; this keeps it so.
    test('(G) a Grid tile is the same element, and keeps focus, when its avatar style resolves', async () => {
        DBState.db = buildDb(live(5))
        await withMounted(async (target) => {
            clickLayoutButton(target, 0)
            const tile = target.querySelectorAll<HTMLButtonElement>('.ico')[2]
            tile.focus()
            expect(document.activeElement).toBe(tile)
            await settle()
            await settle()
            // The avatar style has resolved by now (the lookup is a few microtasks long).
            expect(target.querySelectorAll('.ico')[2].getAttribute('style') ?? '').toContain('loc=assets/2.png')
            expect(target.querySelectorAll('.ico')[2]).toBe(tile)
            expect(document.activeElement).toBe(tile)
        })
    })

    // A class check, not a position proof: the centred partial row is checked on the device.
    test('(F) every Grid row is its own flex row centred with overflow going right, so a partial last row is centred', async () => {
        DBState.db = buildDb(live(5))
        await withMounted((target) => {
            clickLayoutButton(target, 0)
            const rows = Array.from(target.querySelectorAll<HTMLElement>('[data-charlist-row]'))
            expect(rows.map((row) => row.querySelectorAll('.ico').length)).toEqual([4, 1])
            for (const row of rows) {
                expect(row.classList.contains('flex')).toBe(true)
                // Plain centring everywhere; `safe` only where the browser supports it (the generated
                // rule for the variant sorts after `justify-center`, so it wins there).
                expect(row.classList.contains('justify-center')).toBe(true)
                expect(row.className).toContain('supports-[justify-content:safe_center]:[justify-content:safe_center]')
            }
        })
    })
})

describe('GridCatalog Grid tab: a bounded window of tiles', { timeout: 60_000 }, () => {
    const GRID_COUNT = 300
    const tileNames = (root: ParentNode): string[] => Array.from(root.querySelectorAll('.ico')).map((el) => el.getAttribute('aria-label') ?? '')
    const tileNamed = (root: ParentNode, name: string): HTMLButtonElement | null => root.querySelector<HTMLButtonElement>(`.ico[aria-label="${name}"]`)

    test('(R) the Grid tab mounts a bounded number of tiles of 300 characters', async () => {
        DBState.db = buildDb(live(GRID_COUNT))
        await withMounted((target) => {
            clickLayoutButton(target, 0)
            const tiles = target.querySelectorAll('.ico').length
            expect(tiles).toBeGreaterThan(0)
            expect(tiles).toBeLessThan(MOST_TILES)
        })
    })

    test('(R) the Grid tab watches no tile with an observer', async () => {
        DBState.db = buildDb(live(GRID_COUNT))
        await withMounted(async (target) => {
            clickLayoutButton(target, 0)
            await settle()
            expect(target.querySelectorAll('.ico').length).toBeGreaterThan(0)
            expect(CountingIntersectionObserver.watched.length).toBe(0)
        })
    })

    test('(R) the number of mounted tiles does not depend on the number of characters', async () => {
        const counts: number[] = []
        for (const count of [150, 300]) {
            DBState.db = buildDb(live(count))
            await withMounted((target) => {
                clickLayoutButton(target, 0)
                counts.push(target.querySelectorAll('.ico').length)
            })
        }
        expect(counts[0]).toBeGreaterThan(0)
        expect(counts[1]).toBe(counts[0])
    })

    test('(R) a tile outside the window requests no picture; tiles in it request their own', async () => {
        DBState.db = buildDb(live(GRID_COUNT))
        await withMounted(async (target) => {
            clickLayoutButton(target, 0)
            await settle()
            await settle()
            const tiles = Array.from(target.querySelectorAll<HTMLElement>('.ico'))
            expect(tiles.length).toBeLessThan(MOST_TILES)
            expect(tiles.every((tile) => (tile.getAttribute('style') ?? '').includes(`loc=assets/${tile.getAttribute('aria-label')!.replace('Character ', '')}.png`))).toBe(true)
            expect(target.innerHTML).not.toContain('loc=assets/250.png')
        })
    })

    test('(F) a tile far down is mounted by scrolling to it, and a click on it opens that character', async () => {
        DBState.db = buildDb(live(GRID_COUNT))
        const endGrid = vi.fn()
        await withMounted(async (target) => {
            clickLayoutButton(target, 0)
            const geometry = installGeometry(scrollerOf(target))
            await settleFrame()
            expect(tileNamed(target, 'Character 250')).toBeNull()

            // Tile 250 is in row 62 of 75, 3968 px down.
            await geometry.scrollAndSettle(62 * TILE_ROW - 100)
            expect(tileNamed(target, 'Character 250')).not.toBeNull()
            expect(tileNamed(target, 'Character 0')).toBeNull()
            expect(target.querySelectorAll('.ico').length).toBeLessThan(MOST_TILES)

            tileNamed(target, 'Character 250')!.click()
            expect(changeCharSpy.mock.calls).toEqual([[250]])
            expect(endGrid).toHaveBeenCalledTimes(1)
        }, endGrid)
    })

    test('(F) each tile says where it is among all tiles', async () => {
        DBState.db = buildDb(live(GRID_COUNT))
        await withMounted(async (target) => {
            clickLayoutButton(target, 0)
            const geometry = installGeometry(scrollerOf(target))
            await settleFrame()
            const first = tileNamed(target, 'Character 0')!.closest('[role="listitem"]')!
            expect(first.getAttribute('aria-setsize')).toBe(String(GRID_COUNT))
            expect(first.getAttribute('aria-posinset')).toBe('1')

            await geometry.scrollAndSettle(62 * TILE_ROW - 100)
            const far = tileNamed(target, 'Character 250')!.closest('[role="listitem"]')!
            expect(far.getAttribute('aria-posinset')).toBe('251')
        })
    })

    test('(F) the last row holds the tiles left over', async () => {
        DBState.db = buildDb(live(23))
        await withMounted((target) => {
            clickLayoutButton(target, 0)
            const rows = Array.from(target.querySelectorAll<HTMLElement>('[data-charlist-row]'))
            expect(rows.map((row) => row.querySelectorAll('.ico').length)).toEqual([4, 4, 4, 4, 4, 3])
        })
    })

    test('(F) no characters give no tile, and one character gives one', async () => {
        DBState.db = buildDb([])
        await withMounted((target) => {
            clickLayoutButton(target, 0)
            expect(target.querySelectorAll('.ico').length).toBe(0)
            expect(target.querySelectorAll('[data-charlist-row]').length).toBe(0)
        })
        DBState.db = buildDb(live(1))
        await withMounted((target) => {
            clickLayoutButton(target, 0)
            expect(tileNames(target)).toEqual(['Character 0'])
            expect(target.querySelectorAll('[data-charlist-row]').length).toBe(1)
        })
    })

    test('(F) a new search scrolls to the top and shows only matches within a bounded window', async () => {
        DBState.db = buildDb(live(GRID_COUNT))
        await withMounted(async (target) => {
            clickLayoutButton(target, 0)
            const geometry = installGeometry(scrollerOf(target))
            await settleFrame()
            await geometry.scrollAndSettle(62 * TILE_ROW - 100)
            expect(tileNamed(target, 'Character 0')).toBeNull()

            const input = target.querySelector('input')!
            input.value = 'Character 1'
            input.dispatchEvent(new Event('input'))
            vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
            try {
                flushSync()
                vi.advanceTimersByTime(150)
            } finally {
                vi.useRealTimers()
            }
            await settleFrame()

            expect(geometry.writes.at(-1)).toBe(0)
            expect(tileNamed(target, 'Character 1')).not.toBeNull()
            expect(target.querySelectorAll('.ico').length).toBeLessThan(MOST_TILES)
        })
    })

    test('(F) coming back to the Grid tab starts at the top', async () => {
        DBState.db = buildDb(live(GRID_COUNT))
        await withMounted(async (target) => {
            clickLayoutButton(target, 0)
            const geometry = installGeometry(scrollerOf(target))
            await settleFrame()
            await geometry.scrollAndSettle(62 * TILE_ROW - 100)
            expect(tileNamed(target, 'Character 0')).toBeNull()

            clickLayoutButton(target, 1)
            await settle()
            clickLayoutButton(target, 0)
            await settle()
            expect(tileNamed(target, 'Character 0')).not.toBeNull()
        })
    })

    test('(F) fewer columns keep the first tile on screen, mounted in the frame after the size report', async () => {
        vi.stubGlobal('ResizeObserver', FakeResizeObserver)
        DBState.db = buildDb(live(GRID_COUNT))
        await withMounted(async (target) => {
            clickLayoutButton(target, 0)
            const scroller = scrollerOf(target)
            const geometry = installGeometry(scroller)
            await settleFrame()
            // Row 40 holds characters 160 to 163; the viewport top is 10 px into it.
            await geometry.scrollAndSettle(40 * TILE_ROW + 10)
            geometry.writes.length = 0

            containerWidth = THREE_COLUMNS
            FakeResizeObserver.reportContainer(scroller)
            await settleFrame()

            // Character 160 now ends the row 159 to 161, row 53 of 100.
            expect(geometry.writes.at(-1)).toBe(53 * TILE_ROW + 10)
            expect(Number(scroller.getAttribute('data-charlist-total'))).toBe(100 * TILE_ROW)
            expect(tileNamed(target, 'Character 160')).not.toBeNull()
            expect(tileNamed(target, 'Character 0')).toBeNull()
            expect(Array.from(target.querySelectorAll('[data-charlist-row]')).every((row) => row.querySelectorAll('.ico').length <= 3)).toBe(true)
        })
    })

    test('(F) a focused tile keeps focus when the column count changes', async () => {
        vi.stubGlobal('ResizeObserver', FakeResizeObserver)
        DBState.db = buildDb(live(GRID_COUNT))
        await withMounted(async (target) => {
            clickLayoutButton(target, 0)
            const scroller = scrollerOf(target)
            installGeometry(scroller)
            await settleFrame()
            const before = tileNamed(target, 'Character 5')!
            before.focus()
            await settle()
            expect(document.activeElement).toBe(before)

            containerWidth = THREE_COLUMNS
            FakeResizeObserver.reportContainer(scroller)
            await settleFrame()

            const after = tileNamed(target, 'Character 5')!
            expect(after).not.toBe(before)
            expect(document.activeElement).toBe(after)
        })
    })

    // A guard in intent (scrolling reads names and images of the characters it mounts, and opens none
    // of them); it needs the Grid's own scroller, so it fails before the windowed Grid.
    test('(F) scrolling across the whole Grid opens no character and removes none', async () => {
        DBState.db = buildDb(live(GRID_COUNT))
        await withMounted(async (target) => {
            clickLayoutButton(target, 0)
            const geometry = installGeometry(scrollerOf(target))
            await settleFrame()
            for (const top of [1000, 2000, 4000, 0]) {
                await geometry.scrollAndSettle(top)
            }
            expect(changeCharSpy).not.toHaveBeenCalled()
            expect(removeCharSpy).not.toHaveBeenCalled()
            expect(DBState.db.characters.length).toBe(GRID_COUNT)
        })
    })
})

describe('GridCatalog List tab: the window follows the scroll', { timeout: 60_000 }, () => {
    test('(F) rows far down are mounted by scrolling to them, and a click on one opens that character', async () => {
        DBState.db = buildDb(live())
        const endGrid = vi.fn()
        await withMounted(async (target) => {
            clickLayoutButton(target, 1)
            const geometry = installGeometry(scrollerOf(target))
            await settleFrame()
            expect(rowNames(target)).not.toContain('Character 150')

            await geometry.scrollAndSettle(20_000)
            expect(rowNames(target)).toContain('Character 150')
            expect(rowNames(target)).not.toContain('Character 0')
            expect(rowNames(target).length).toBeLessThan(MOST_MOUNTED)

            const heading = Array.from(target.querySelectorAll('h4')).find((h) => h.textContent?.trim() === 'Character 150')!
            heading.querySelector('button')!.click()
            expect(changeCharSpy.mock.calls).toEqual([[150]])
            expect(endGrid).toHaveBeenCalledTimes(1)
        }, endGrid)
    })

    test('(F) each mounted row says where it is in the list', async () => {
        DBState.db = buildDb(live())
        await withMounted((target) => {
            clickLayoutButton(target, 1)
            const first = target.querySelector('[role="listitem"]')!
            expect(first.getAttribute('aria-setsize')).toBe(String(COUNT))
            expect(first.getAttribute('aria-posinset')).toBe('1')
        })
    })

    test('(F) a new search scrolls to the top and shows only matches within a bounded window', async () => {
        DBState.db = buildDb(live())
        await withMounted(async (target) => {
            clickLayoutButton(target, 1)
            const geometry = installGeometry(scrollerOf(target))
            await settleFrame()
            await geometry.scrollAndSettle(20_000)
            expect(rowNames(target)).not.toContain('Character 0')

            const input = target.querySelector('input')!
            input.value = 'Character 1'
            input.dispatchEvent(new Event('input'))
            vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
            try {
                flushSync()
                vi.advanceTimersByTime(150)
            } finally {
                vi.useRealTimers()
            }
            await settleFrame()

            expect(geometry.writes.at(-1)).toBe(0)
            expect(rowNames(target)).toContain('Character 1')
            expect(rowNames(target).length).toBeLessThan(MOST_MOUNTED)
        })
    })

    test('(F) coming back to a tab starts at the top', async () => {
        DBState.db = buildDb(live())
        await withMounted(async (target) => {
            clickLayoutButton(target, 1)
            const geometry = installGeometry(scrollerOf(target))
            await settleFrame()
            await geometry.scrollAndSettle(20_000)

            clickLayoutButton(target, 0)
            await settle()
            clickLayoutButton(target, 1)
            await settle()
            expect(rowNames(target)).toContain('Character 0')
        })
    })

    // Guard: scrolling reads names, images and descriptions of the characters it mounts, and opens none of them.
    test('(G) scrolling across the whole list opens no character and removes none', async () => {
        DBState.db = buildDb(live())
        await withMounted(async (target) => {
            clickLayoutButton(target, 1)
            const geometry = installGeometry(scrollerOf(target))
            await settleFrame()
            for (const top of [5000, 10_000, 20_000, 0]) {
                await geometry.scrollAndSettle(top)
            }
            expect(changeCharSpy).not.toHaveBeenCalled()
            expect(removeCharSpy).not.toHaveBeenCalled()
            expect(DBState.db.characters.length).toBe(COUNT)
        })
    })
})
