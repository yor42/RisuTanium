// @vitest-environment happy-dom

/**
 * `GridCatalog.svelte` (its grid, list, trash and simple layouts) never shows
 * or reaches the two system characters kept in `db.characters`: the
 * Playground's `'§playground'` utility bot and a stray `'§temp'` copy left by
 * an upstream multiuser save. Both are skipped whatever the layout, the search
 * text or their trash state, and the count in the header leaves them out. An
 * ordinary character that merely shares the name 'assistant' is listed like
 * any other.
 *
 * Every `.ico` avatar (a tile or a row) is one reachable character: clicking each in turn and
 * reading the index handed to `changeChar` shows which `db.characters` entries
 * a layout offers, including the grid layout, which renders icons only.
 *
 * MOCKED: the module set of `GridCatalog.coldStub.svelte.test.ts` (same
 * directory), with `changeChar` a bare spy. Nothing here writes to storage.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { beforeEach, describe, expect, test, vi } from 'vitest'
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

class AllVisibleIntersectionObserver implements IntersectionObserver {
    readonly root: Element | Document | null = null
    readonly rootMargin: string = ''
    readonly thresholds: ReadonlyArray<number> = []
    #callback: IntersectionObserverCallback

    constructor(callback: IntersectionObserverCallback) {
        this.#callback = callback
    }

    observe(target: Element): void {
        this.#callback([{ target, isIntersecting: true, intersectionRatio: 1 } as IntersectionObserverEntry], this)
    }

    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): IntersectionObserverEntry[] {
        return []
    }
}

vi.stubGlobal('IntersectionObserver', AllVisibleIntersectionObserver)

import { DBState } from '../../ts/stores.svelte'
import { language } from '../../lang'
import GridCatalog from './GridCatalog.svelte'

//#region fixtures and helpers

type CharacterFixture = Database['characters'][number]

const ALICE = 0
const PLAYGROUND = 1
const TEMP = 2
const NAMED_ASSISTANT = 3

function makeCharacter(chaId: string, name: string, extra: Record<string, unknown> = {}): CharacterFixture {
    return {
        chaId,
        name,
        type: 'character',
        image: '',
        creatorNotes: '',
        chatPage: 0,
        lastInteraction: 0,
        chats: [{ id: `${chaId}-chat`, message: [], note: '', name: '', localLore: [] }],
        ...extra,
    } as unknown as CharacterFixture
}

/** [Alice, the Playground, a stray temp copy, an ordinary character named 'assistant']. */
function standardCharacters(): CharacterFixture[] {
    return [
        makeCharacter('alice-id', 'Alice'),
        makeCharacter('§playground', 'assistant', { utilityBot: true }),
        makeCharacter('§temp', 'Temp Copy'),
        makeCharacter('named-assistant-id', 'assistant'),
    ]
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
    for (let i = 0; i < 4; i++) {
        flushSync()
        await Promise.resolve()
    }
    flushSync()
}

async function withMounted(body: (target: HTMLElement) => void | Promise<void>): Promise<void> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(GridCatalog, { target, props: {} }) as Record<string, unknown>
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

function setSearchValue(root: HTMLElement, value: string): void {
    const input = root.querySelector('input[type="text"]') as HTMLInputElement | null
    if (!input) {
        throw new Error('search input not found')
    }
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    // The typed query lands after the search debounce; fake the clock only for
    // that window so the rest of the file keeps real timers.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
        flushSync()
        vi.advanceTimersByTime(150)
    } finally {
        vi.useRealTimers()
    }
    flushSync()
}

/** The `db.characters` index each avatar button of the current layout hands to `changeChar`, in display order. */
function reachableIndices(root: HTMLElement): number[] {
    changeCharSpy.mockClear()
    for (const icon of Array.from(root.querySelectorAll<HTMLElement>('.ico'))) {
        icon.click()
    }
    return changeCharSpy.mock.calls.map((args) => args[0] as number)
}

/** The names of the trashed rows, which are listed but never opened by a click. */
function trashedNames(root: HTMLElement): string[] {
    return Array.from(root.querySelectorAll('h4')).map((h) => h.textContent?.trim() ?? '')
}

/** The number the header shows next to the "characters" label. */
function headerCount(root: HTMLElement): number {
    const span = Array.from(root.querySelectorAll('span')).find((s) => s.textContent?.includes(language.character))
    if (!span) {
        throw new Error('header count not found')
    }
    return Number.parseInt(span.textContent!.trim(), 10)
}

function trashAll(indices: number[]): void {
    for (const index of indices) {
        DBState.db.characters[index].trashTime = Date.now() - 1000
    }
}

beforeEach(() => {
    changeCharSpy.mockClear()
})

//#endregion

describe('GridCatalog skips the Playground and stray temp characters', { timeout: 60_000 }, () => {
    test.each([
        ['grid', 0],
        ['list', 1],
        ['simple', 3],
    ] as const)('the %s layout offers Alice and the ordinary "assistant" and neither system character', async (_label, layout) => {
        DBState.db = buildDb(standardCharacters())

        await withMounted((target) => {
            clickLayoutButton(target, layout)
            expect(reachableIndices(target)).toEqual([ALICE, NAMED_ASSISTANT])
        })
    })

    test('the header count leaves both system characters out', async () => {
        DBState.db = buildDb(standardCharacters())

        await withMounted((target) => {
            expect(headerCount(target)).toBe(2)
        })
    })

    test('searching "assistant" in the list layout offers only the ordinary character', async () => {
        DBState.db = buildDb(standardCharacters())

        await withMounted((target) => {
            clickLayoutButton(target, 1)
            setSearchValue(target, 'assistant')
            expect(reachableIndices(target)).toEqual([NAMED_ASSISTANT])
        })
    })

    test('searching "assistant" in the grid layout offers only the ordinary character', async () => {
        DBState.db = buildDb(standardCharacters())

        await withMounted((target) => {
            clickLayoutButton(target, 0)
            setSearchValue(target, 'assistant')
            expect(reachableIndices(target)).toEqual([NAMED_ASSISTANT])
        })
    })

    test('searching the stray copy\'s own name finds nothing in the list layout', async () => {
        DBState.db = buildDb(standardCharacters())

        await withMounted((target) => {
            clickLayoutButton(target, 1)
            setSearchValue(target, 'temp copy')
            expect(reachableIndices(target)).toEqual([])
        })
    })

    test('the trash layout lists only the ordinary trashed character when all three are trashed', async () => {
        DBState.db = buildDb(standardCharacters())
        trashAll([PLAYGROUND, TEMP, NAMED_ASSISTANT])

        await withMounted((target) => {
            clickLayoutButton(target, 2)
            expect(trashedNames(target)).toEqual(['assistant'])
        })
    })

    test('the trash layout lists nothing when only the two system characters are trashed', async () => {
        DBState.db = buildDb(standardCharacters())
        trashAll([PLAYGROUND, TEMP])

        await withMounted((target) => {
            clickLayoutButton(target, 2)
            expect(trashedNames(target)).toEqual([])
        })
    })

    // Guard: passes with and without the filter; a trashed character is already
    // left out of the list layout and the count.
    test('guard: a trashed system character stays out of the list layout and the header count', async () => {
        DBState.db = buildDb(standardCharacters())
        trashAll([PLAYGROUND, TEMP])

        await withMounted((target) => {
            clickLayoutButton(target, 1)
            expect(reachableIndices(target)).toEqual([ALICE, NAMED_ASSISTANT])
            expect(headerCount(target)).toBe(2)
        })
    })

    // Guard: passes with and without the filter; an ordinary character named
    // 'assistant' is never mistaken for the Playground.
    test('guard: an ordinary character named "assistant" is listed in every layout', async () => {
        DBState.db = buildDb([makeCharacter('alice-id', 'Alice'), makeCharacter('named-assistant-id', 'assistant')])

        await withMounted((target) => {
            for (const layout of [0, 1, 3] as const) {
                clickLayoutButton(target, layout)
                expect(reachableIndices(target), `layout ${layout}`).toEqual([0, 1])
            }
            expect(headerCount(target)).toBe(2)
        })
    })

    // Guard: passes with and without the filter; the trash layout keeps its
    // current behaviour for ordinary characters.
    test('guard: an ordinary trashed character is listed in the trash layout only', async () => {
        DBState.db = buildDb([makeCharacter('alice-id', 'Alice'), makeCharacter('gone-id', 'Gone', { trashTime: Date.now() - 1000 })])

        await withMounted((target) => {
            clickLayoutButton(target, 2)
            expect(trashedNames(target)).toEqual(['Gone'])
            clickLayoutButton(target, 1)
            expect(reachableIndices(target)).toEqual([0])
        })
    })
})
