// @vitest-environment happy-dom

/**
 * `GridCatalog.svelte` with `variant="home"`, the embedded Home library. The Home variant has no Back
 * button and no boxed container (the Home section bounds the height), and a library with no live
 * character shows one line pointing to the Trash instead of a second Create/Import hero. The default
 * variant, used by the App-level grid host, keeps its Back button, its box and its hero.
 *
 * MOCKED: the module set of `GridCatalog.empties.svelte.test.ts` (same directory). Elements are found
 * by `data-part` and by the language strings the component renders. Nothing here writes to storage.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { describe, expect, test, vi } from 'vitest'
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
        changeChar: vi.fn(),
        createNewCharacter: vi.fn(),
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

// happy-dom has no layout, and the Grid tab builds no tile until its container reports a width.
Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 312 })

import { DBState } from '../../ts/stores.svelte'
import { language } from '../../lang'
import GridCatalog from './GridCatalog.svelte'

//#region fixtures and helpers

type CharacterFixture = Database['characters'][number]
type Variant = 'app' | 'home'

const HERO = '[data-part="home-empty-hero"]'
const ALL_TRASHED = '[data-part="library-all-trashed"]'
const BACK = '[data-part="library-back"]'
const SIMPLE = 3
const GRID = 0
const LIST = 1
const TRASH = 2

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

/** Every ordinary character is in the Trash; the hidden Playground never counts. */
function allTrashed(): CharacterFixture[] {
    return [
        makeCharacter('gone-id', 'Gone', { trashTime: Date.now() - 1000 }),
        makeCharacter('§playground', 'assistant', { utilityBot: true }),
    ]
}

function threeCharacters(): CharacterFixture[] {
    return [makeCharacter('a-id', 'Alice'), makeCharacter('b-id', 'Bob'), makeCharacter('c-id', 'Carol')]
}

async function settle(): Promise<void> {
    for (let i = 0; i < 4; i++) {
        flushSync()
        await Promise.resolve()
    }
    flushSync()
}

async function withMounted(variant: Variant, body: (target: HTMLElement) => void | Promise<void>): Promise<void> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(GridCatalog, { target, props: { variant } }) as Record<string, unknown>
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
    // The typed query lands after the search debounce; fake the clock only for that window.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
        flushSync()
        vi.advanceTimersByTime(150)
    } finally {
        vi.useRealTimers()
    }
    flushSync()
}

const hasText = (root: HTMLElement, text: string): boolean => (root.textContent ?? '').includes(text)

/** The outermost element the component renders: its classes are the container the variant chooses. */
const outer = (target: HTMLElement): HTMLElement => target.firstElementChild as HTMLElement
const inner = (target: HTMLElement): HTMLElement => outer(target).firstElementChild as HTMLElement

//#endregion

describe('GridCatalog home variant', { timeout: 60_000 }, () => {
    test('S4a-U3: no Back button, the search field keeps its row', async () => {
        DBState.db = buildDb(threeCharacters())
        await withMounted('home', (target) => {
            expect(target.querySelector(BACK)).toBeNull()
            expect(target.querySelector('input[type="text"]')).not.toBeNull()
        })
    })

    test('S4a-U3: every character trashed shows the Trash line and no hero in Simple, Grid and List', async () => {
        DBState.db = buildDb(allTrashed())
        await withMounted('home', (target) => {
            for (const layout of [SIMPLE, GRID, LIST] as const) {
                clickLayoutButton(target, layout)
                const line = target.querySelector(ALL_TRASHED)
                expect(line, `layout ${layout}`).not.toBeNull()
                expect(line!.textContent).toBe(language.homeLibraryAllTrashed)
                expect(target.querySelector(HERO), `layout ${layout}`).toBeNull()
            }
        })
    })

    test('S4a-U3: the Trash tab of an all-trashed library lists the trashed names and shows no line', async () => {
        DBState.db = buildDb(allTrashed())
        await withMounted('home', (target) => {
            clickLayoutButton(target, TRASH)
            expect(Array.from(target.querySelectorAll('h4')).map((h) => h.textContent?.trim())).toEqual(['Gone'])
            expect(target.querySelector(ALL_TRASHED)).toBeNull()
            expect(target.querySelector(HERO)).toBeNull()
        })
    })

    test('S4a-U3: the no-match line is unchanged for a non-empty library', async () => {
        DBState.db = buildDb(threeCharacters())
        await withMounted('home', (target) => {
            clickLayoutButton(target, SIMPLE)
            expect(target.querySelector(ALL_TRASHED)).toBeNull()
            setSearchValue(target, 'zzz')
            expect(hasText(target, language.libraryNoMatch)).toBe(true)
            expect(target.querySelector(ALL_TRASHED)).toBeNull()
        })
    })

    test('S4a-U3: the container is not boxed, capped or padded', async () => {
        DBState.db = buildDb(threeCharacters())
        await withMounted('home', (target) => {
            for (const element of [outer(target), inner(target)]) {
                const classes = element.className.split(/\s+/)
                for (const boxed of ['bg-darkbg', 'w-2xl', 'p-6', 'h-full']) {
                    expect(classes, element.className).not.toContain(boxed)
                }
                expect(classes).toContain('min-h-0')
                expect(classes).toContain('flex-1')
            }
        })
    })

    test('S4a-G1: the default variant keeps the Back button, the box and the hero', async () => {
        DBState.db = buildDb(allTrashed())
        await withMounted('app', (target) => {
            expect(target.querySelector(BACK)).not.toBeNull()
            expect(inner(target).className).toContain('bg-darkbg')
            expect(inner(target).className).toContain('w-2xl')
            clickLayoutButton(target, SIMPLE)
            expect(target.querySelector(HERO)).not.toBeNull()
            expect(target.querySelector(ALL_TRASHED)).toBeNull()
        })
    })
})
