// @vitest-environment happy-dom

/**
 * `GridCatalog.svelte`: the tabs mount only the rows near their scroll viewport. With 200
 * characters the List, Trash and Simple tabs mount a bounded window instead of every row, watch
 * no row with an `IntersectionObserver`, scroll as the one container under the header, and keep
 * their avatars and controls stable while they do.
 *
 * Fixture size: 200 characters in a happy-dom document that is 768 px high, so a tab that mounted
 * every row would mount 200. Counts for 1000 and 2000 characters live in the
 * `charlist-window-count` harness, not in this suite.
 *
 * Test labels: `(R)` is a reproducer: it fails on the commit before the windowed lists with an
 * assertion about the defect (every row mounted, an observer per row, a nested button, a header
 * inside the scroller, an avatar element re-created under focus). `(F)` is a feature test: it
 * asserts the new list container or its attributes, which do not exist before. `(G)` is a guard
 * that may pass before and after.
 *
 * MOCKED: the module set of `GridCatalog.pick.svelte.test.ts` (same directory), with `changeChar`
 * and `removeChar` bare spies, and a fake `IntersectionObserver` that reports every target visible
 * and counts the targets it was asked to watch (the Grid tab still uses one). Geometry is faked as
 * in `CharacterWindow.svelte.test.ts`. Nothing here writes to storage.
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

beforeEach(() => {
    changeCharSpy.mockClear()
    removeCharSpy.mockClear()
    CountingIntersectionObserver.watched.length = 0
    vi.stubGlobal('IntersectionObserver', CountingIntersectionObserver)
    vi.stubGlobal('ResizeObserver', undefined)
})

afterEach(() => {
    vi.unstubAllGlobals()
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

    test('(R) a Grid tile is the same element, and keeps focus, when its avatar style resolves', async () => {
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

    test('(G) the Grid tab keeps centring a partial last row', async () => {
        DBState.db = buildDb(live(5))
        await withMounted((target) => {
            clickLayoutButton(target, 0)
            const wrap = target.querySelector('.ico')!.closest('.flex-wrap')!
            expect(wrap.classList.contains('justify-center')).toBe(true)
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
