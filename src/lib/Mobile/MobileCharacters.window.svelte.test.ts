// @vitest-environment happy-dom

/**
 * `MobileCharacters.svelte`: the simple list of 200 characters mounts only the rows near its
 * scroll viewport, is the one scroller of its screen, has one control per row, and follows a
 * search to the top.
 *
 * Fixture size: 200 characters in a happy-dom document that is 768 px high. Counts for 1000 and
 * 2000 characters live in the `charlist-window-count` harness.
 *
 * Test labels: `(R)` is a reproducer: it fails on the commit before the windowed lists with an
 * assertion about the defect (every row mounted, a button inside a button, a divider above the
 * first shown row). `(F)` is a feature test: it asserts the list container, which does not exist
 * before. `(G)` is a guard that may pass before and after.
 *
 * MOCKED: the module set of `MobileCharacters.search.svelte.test.ts` (same directory), with
 * `changeChar` a bare spy. The container's height and scroll position are faked on
 * `HTMLElement.prototype`, as in `MobileBody.window.svelte.test.ts`. Nothing here writes to storage.
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

const { changeCharSpy } = vi.hoisted(() => ({
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

import { DBState, MobileSearch } from '../../ts/stores.svelte'
import MobileCharacters from './MobileCharacters.svelte'

//#region fixtures and helpers

type CharacterFixture = Database['characters'][number]

const COUNT = 200
const MOST_MOUNTED = 60
const VIEWPORT = 600

/** Character `i` is the `COUNT - i`-th row: the list is most recent first. */
function makeCharacters(count = COUNT): CharacterFixture[] {
    return Array.from({ length: count }, (_, i) => ({
        chaId: `id-${i}`,
        name: `Character ${i}`,
        type: 'character',
        image: '',
        creatorNotes: '',
        chatPage: 0,
        lastInteraction: i + 1,
        chats: [{ id: `id-${i}-chat`, message: [], note: '', name: '', localLore: [] }],
    })) as unknown as CharacterFixture[]
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

async function withMounted(props: { hideTrash?: boolean; search?: string; endGrid?: () => void }, body: (target: HTMLElement) => void | Promise<void>): Promise<void> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(MobileCharacters, { target, props: props as never }) as Record<string, unknown>
    try {
        await settle()
        await body(target)
    } finally {
        await unmount(app as never)
        target.remove()
    }
}

let restoreGeometry: () => void = () => {}

/** A container height of `VIEWPORT` and a scroll position clamped to the list's total, for every element. */
function installGeometry(): () => void {
    const tops = new WeakMap<Element, number>()
    const clientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')
    const scrollTop = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTop')
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => VIEWPORT })
    Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
        configurable: true,
        get(this: HTMLElement) {
            return tops.get(this) ?? 0
        },
        set(this: HTMLElement, value: number) {
            const total = Number(this.getAttribute('data-charlist-total') ?? Number.POSITIVE_INFINITY)
            tops.set(this, Math.max(0, Math.min(value, Math.max(0, total - VIEWPORT))))
        },
    })
    return () => {
        for (const [name, descriptor] of [['clientHeight', clientHeight], ['scrollTop', scrollTop]] as const) {
            if (descriptor) {
                Object.defineProperty(HTMLElement.prototype, name, descriptor)
            } else {
                delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name]
            }
        }
    }
}

function scrollerOf(root: ParentNode): HTMLElement {
    const el = root.querySelector<HTMLElement>('[role="list"][data-charlist-total]')
    if (!el) {
        throw new Error('no windowed list in this DOM')
    }
    return el
}

async function scrollAndSettle(root: ParentNode, top: number): Promise<void> {
    const el = scrollerOf(root)
    el.scrollTop = top
    el.dispatchEvent(new Event('scroll'))
    await settleFrame()
}

const rowNames = (root: ParentNode): string[] => Array.from(root.querySelectorAll('div.flex-1 > span:first-child')).map((s) => s.textContent?.trim() ?? '')
const rowButtons = (root: ParentNode): HTMLButtonElement[] => Array.from(root.querySelectorAll<HTMLButtonElement>('button')).filter((b) => b.querySelector('div.flex-1 > span:first-child'))

beforeEach(() => {
    changeCharSpy.mockClear()
    MobileSearch.set('')
    vi.stubGlobal('ResizeObserver', undefined)
    restoreGeometry = installGeometry()
})

afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
    restoreGeometry()
})

//#endregion

describe('MobileCharacters: a bounded window of 200 rows', { timeout: 60_000 }, () => {
    test('(R) mounts a bounded number of rows, most recent first', async () => {
        DBState.db = buildDb(makeCharacters())
        await withMounted({}, (target) => {
            const names = rowNames(target)
            expect(names.length).toBeGreaterThan(0)
            expect(names.length).toBeLessThan(MOST_MOUNTED)
            expect(names[0]).toBe('Character 199')
        })
    })

    test('(R) a row has one button, with no button inside it', async () => {
        DBState.db = buildDb(makeCharacters(5))
        await withMounted({}, (target) => {
            expect(rowButtons(target).length).toBe(5)
            expect(target.querySelector('button button')).toBeNull()
        })
    })

    test('(F) the list container is the only scroller of the component', async () => {
        DBState.db = buildDb(makeCharacters(30))
        await withMounted({}, (target) => {
            expect(target.querySelectorAll('.overflow-y-auto').length).toBe(1)
            expect(scrollerOf(target)).toBe(target.querySelector('.overflow-y-auto'))
        })
    })

    test('(R) the first row that is shown has no divider above it, whatever its place in the whole list', async () => {
        DBState.db = buildDb(makeCharacters())
        await withMounted({ search: 'Character 5' }, (target) => {
            const buttons = rowButtons(target)
            expect(buttons.length).toBeGreaterThan(2)
            // Character 195 is the fifth row of the unfiltered list and the first match.
            expect(buttons[0].textContent).toContain('Character 195')
            expect(buttons[0].classList.contains('border-t')).toBe(false)
            expect(buttons[1].classList.contains('border-t')).toBe(true)
        })
    })

    test('(F) rows say where they are in the list', async () => {
        DBState.db = buildDb(makeCharacters())
        await withMounted({}, (target) => {
            const first = target.querySelector('[role="listitem"]')!
            expect(first.getAttribute('aria-setsize')).toBe(String(COUNT))
            expect(first.getAttribute('aria-posinset')).toBe('1')
        })
    })

    test('(F) a row far down is reached by scrolling and opens its own character', async () => {
        DBState.db = buildDb(makeCharacters())
        const endGrid = vi.fn()
        await withMounted({ endGrid }, async (target) => {
            expect(rowNames(target)).not.toContain('Character 50')
            // Character 50 is row 150: 149 rows of 73 px above it.
            await scrollAndSettle(target, 149 * 73)
            expect(rowNames(target)).toContain('Character 50')
            expect(rowNames(target).length).toBeLessThan(MOST_MOUNTED)

            const row = rowButtons(target).find((b) => b.textContent?.includes('Character 50'))!
            row.click()
            expect(changeCharSpy.mock.calls).toEqual([[50]])
            expect(endGrid).toHaveBeenCalledTimes(1)
        })
    })

    test('(F) a new search scrolls to the top', async () => {
        DBState.db = buildDb(makeCharacters())
        const props = $state({ search: '' })
        await withMounted(props, async (target) => {
            await scrollAndSettle(target, 149 * 73)
            expect(scrollerOf(target).scrollTop).toBeGreaterThan(0)

            vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
            try {
                props.search = 'Character 5'
                flushSync()
                vi.advanceTimersByTime(150)
            } finally {
                vi.useRealTimers()
            }
            await settleFrame()

            expect(scrollerOf(target).scrollTop).toBe(0)
            expect(rowNames(target)[0]).toBe('Character 195')
        })
    })
})
