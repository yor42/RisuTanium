// @vitest-environment happy-dom

/**
 * `CharacterTrashList.svelte`: a trash of 200 characters mounts only the rows near its scroll
 * viewport, keeps the header (description and Empty trash) outside the scroller, and acts on the
 * row's own character wherever the window is.
 *
 * Test labels: `(R)` is a reproducer: it fails on the commit before the windowed lists with an
 * assertion about the defect (every row mounted). `(F)` is a feature test: it asserts the list
 * container, which does not exist before; the tests that scroll the list and then act on a row or on Empty trash are feature tests for the same reason (they need the container to scroll).
 *
 * MOCKED: the module set of `CharacterTrashList.svelte.test.ts` (same directory); the search
 * result is a plain object. Geometry is faked as in `CharacterWindow.svelte.test.ts`. Nothing
 * here writes to storage.
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

const { restoreSpy, removeCharSpy, removeTrashedSpy, parseSpy } = vi.hoisted(() => ({
    parseSpy: vi.fn(async (text: string) => `<p>${text}</p>`),
    restoreSpy: vi.fn(),
    removeCharSpy: vi.fn(),
    removeTrashedSpy: vi.fn(),
}))

vi.mock(import('src/ts/parser/parser.svelte'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        ParseMarkdown: parseSpy,
    }
})

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
        restoreCharacterFromTrash: restoreSpy,
        removeChar: removeCharSpy,
        removeTrashedCharacters: removeTrashedSpy,
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

import { DBState } from '../../ts/stores.svelte'
import { clearDescriptionCache } from '../../ts/gui/descriptionMarkdown'
import { language } from '../../lang'
import type { CharacterSearch } from '../../ts/gui/characterSearch.svelte'
import CharacterTrashList from './CharacterTrashList.svelte'

//#region fixtures and helpers

type CharacterFixture = Database['characters'][number]

const COUNT = 200
const MOST_MOUNTED = 40

function makeCharacter(index: number): CharacterFixture {
    return {
        chaId: `id-${index}`,
        name: `Character ${index}`,
        type: 'character',
        image: '',
        creatorNotes: `Description ${index}`,
        chatPage: 0,
        lastInteraction: 0,
        chats: [{ id: `id-${index}-chat`, message: [], note: '', name: '', localLore: [] }],
        trashTime: 1_700_000_000_000 + index,
    } as unknown as CharacterFixture
}

function resultFor(indices: number[]): CharacterSearch {
    return {
        trash: indices.map((index) => ({ index, chaId: DBState.db.characters[index].chaId })),
        searching: false,
        query: '',
    } as unknown as CharacterSearch
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

async function withMounted(found: CharacterSearch, body: (target: HTMLElement) => void | Promise<void>): Promise<void> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(CharacterTrashList, { target, props: { found } }) as Record<string, unknown>
    try {
        await settle()
        await body(target)
    } finally {
        await unmount(app as never)
        target.remove()
    }
}

function scrollerOf(root: ParentNode): HTMLElement {
    const el = root.querySelector<HTMLElement>('[role="list"][data-charlist-total]')
    if (!el) {
        throw new Error('no windowed list in this DOM')
    }
    return el
}

/** Gives the container a 600 px height and a scroll position clamped to the list's total. */
function installGeometry(el: HTMLElement): { scrollAndSettle(top: number): Promise<void> } {
    const height = 600
    let top = 0
    const total = (): number => Number(el.getAttribute('data-charlist-total') ?? 0)
    Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => height })
    Object.defineProperty(el, 'scrollTop', {
        configurable: true,
        get: () => top,
        set: (value: number) => {
            top = Math.max(0, Math.min(value, Math.max(0, total() - height)))
        },
    })
    el.dispatchEvent(new Event('scroll'))
    return {
        async scrollAndSettle(value) {
            top = value
            el.dispatchEvent(new Event('scroll'))
            await settleFrame()
        },
    }
}

const rowNames = (root: ParentNode): string[] => Array.from(root.querySelectorAll('h4')).map((h) => h.textContent?.trim() ?? '')

function rowOf(root: ParentNode, name: string): HTMLElement {
    const heading = Array.from(root.querySelectorAll('h4')).find((h) => h.textContent?.trim() === name)
    const row = heading?.closest<HTMLElement>('.border-darkborderc')
    if (!row) {
        throw new Error(`trash row not found for "${name}"`)
    }
    return row
}

beforeEach(() => {
    restoreSpy.mockClear()
    removeCharSpy.mockClear()
    removeTrashedSpy.mockClear()
    parseSpy.mockClear()
    clearDescriptionCache()
    vi.stubGlobal('ResizeObserver', undefined)
    DBState.db = { characters: Array.from({ length: COUNT }, (_, i) => makeCharacter(i)), hideAllImages: false } as unknown as Database
})

afterEach(() => {
    vi.unstubAllGlobals()
})

const allIndices = (): number[] => Array.from({ length: COUNT }, (_, i) => i)

//#endregion

describe('CharacterTrashList: a bounded window of 200 trashed rows', { timeout: 60_000 }, () => {
    test('(R) mounts a bounded number of rows', async () => {
        await withMounted(resultFor(allIndices()), (target) => {
            const rows = rowNames(target).length
            expect(rows).toBeGreaterThan(0)
            expect(rows).toBeLessThan(MOST_MOUNTED)
        })
    })

    test('(F) keeps the description and Empty trash outside the scroller', async () => {
        await withMounted(resultFor(allIndices()), (target) => {
            const scroller = scrollerOf(target)
            const empty = Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.trim() === language.emptyTrash)!
            expect(scroller.contains(empty)).toBe(false)
            expect(scroller.contains(Array.from(target.querySelectorAll('span')).find((s) => s.textContent?.includes(language.trashDesc))!)).toBe(false)
        })
    })

    // Feature test: Empty trash acts on every row of the result, not on the rows that happen to be mounted.
    test('(F) Empty trash hands over every listed character after the list was scrolled', async () => {
        await withMounted(resultFor(allIndices()), async (target) => {
            const geometry = installGeometry(scrollerOf(target))
            await settleFrame()
            await geometry.scrollAndSettle(20_000)
            Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.trim() === language.emptyTrash)!.click()
            const [refs, options] = removeTrashedSpy.mock.calls[0]
            expect(refs.length).toBe(COUNT)
            expect(refs[150]).toBe(DBState.db.characters[150])
            expect(options).toEqual({ matching: false })
        })
    })

    // Feature test: a row's restore and delete act on its own character wherever the window is.
    test('(F) restore and delete permanently on a scrolled row act on that row\'s character', async () => {
        await withMounted(resultFor(allIndices()), async (target) => {
            const geometry = installGeometry(scrollerOf(target))
            await settleFrame()
            await geometry.scrollAndSettle(20_000)
            expect(rowNames(target)).toContain('Character 150')

            const actions = rowOf(target, 'Character 150').querySelectorAll<HTMLButtonElement>('.justify-end button')
            actions[0].click()
            expect(restoreSpy).toHaveBeenCalledWith(DBState.db.characters[150])
            actions[1].click()
            expect(removeCharSpy).toHaveBeenCalledWith(DBState.db.characters[150], 'Character 150', 'permanent')
        })
    })

    // Feature test: a row that was never mounted is never parsed; scrolling parses only what it mounts.
    test('(F) descriptions are parsed only for rows that were mounted', async () => {
        await withMounted(resultFor(allIndices()), async (target) => {
            const geometry = installGeometry(scrollerOf(target))
            await settleFrame()
            await geometry.scrollAndSettle(20_000)
            await geometry.scrollAndSettle(0)
            const parsed = new Set(parseSpy.mock.calls.map((call) => call[0]))
            expect(parsed.has('Description 0')).toBe(true)
            expect(parsed.has('Description 150')).toBe(true)
            // Rows between the two places the list rested at were never mounted.
            expect(parsed.has('Description 60')).toBe(false)
            expect(parsed.has('Description 100')).toBe(false)
            expect(parsed.size).toBeLessThan(MOST_MOUNTED * 2)
        })
    })
})
