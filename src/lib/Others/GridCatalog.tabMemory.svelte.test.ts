// @vitest-environment happy-dom

/**
 * `GridCatalog.svelte`: the library reopens on the tab last used on this device (Simple, Grid, List or
 * Trash). The choice lives in `localStorage` only, so mounting from a remembered tab reads the database
 * and writes nothing to it.
 *
 * Test labels: `(R)` is a reproducer: it fails on the commit where every open of the library started on
 * Simple. `(G)` is a guard that may pass before and after.
 *
 * MOCKED: the module set of `GridCatalog.sections.svelte.test.ts` (same directory), with a synthetic
 * database and no geometry.
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

const { checkCharOrderSpy } = vi.hoisted(() => ({
    checkCharOrderSpy: vi.fn(),
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

vi.mock(import('../../ts/media/avatarThumb'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        getAvatarThumbSrc: vi.fn(async () => null),
    }
})

//#endregion

import { DBState } from '../../ts/stores.svelte'
import { language } from '../../lang'
import { OPEN_FOLDERS_KEY } from '../SideBars/railMemory'
import { LIBRARY_TAB_KEY } from './gridMemory'
import GridCatalog from './GridCatalog.svelte'

//#region fixtures and helpers

type CharacterFixture = Database['characters'][number]

function makeCharacter(chaId: string, name: string): CharacterFixture {
    return {
        chaId,
        name,
        type: 'character',
        image: '',
        creatorNotes: '',
        chatPage: 0,
        lastInteraction: 0,
        chats: [{ id: `${chaId}-chat`, message: [], note: '', name: '', localLore: [] }],
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
        characters,
        characterOrder: characters.map((c) => c.chaId),
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

type TabName = 'simple' | 'grid' | 'list' | 'trash'

const LABELS: Record<TabName, () => string> = {
    simple: () => language.simple,
    grid: () => language.grid,
    list: () => language.list,
    trash: () => language.trash,
}

function tabButton(target: HTMLElement, tab: TabName): HTMLButtonElement {
    const label = LABELS[tab]().trim()
    const btn = Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.trim() === label)
    if (!btn) {
        throw new Error(`${tab} tab button not found`)
    }
    return btn
}

/** The tab buttons that currently report themselves pressed. */
function pressedTabs(target: HTMLElement): TabName[] {
    return (Object.keys(LABELS) as TabName[]).filter((tab) => tabButton(target, tab).getAttribute('aria-pressed') === 'true')
}

/** Only the Grid tab renders its live-region row. */
const gridViewShows = (target: HTMLElement): boolean => target.querySelector('[data-grid-live]') !== null

async function mountLibrary(): Promise<{ target: HTMLElement; close: () => Promise<void> }> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(GridCatalog, { target, props: { endGrid: () => {} } }) as Record<string, unknown>
    await settle()
    return {
        target,
        close: async () => {
            await unmount(app as never)
            target.remove()
        },
    }
}

//#endregion

beforeEach(() => {
    localStorage.clear()
    DBState.db = buildDb([makeCharacter('A', 'Char A'), makeCharacter('B', 'Char B')])
    checkCharOrderSpy.mockClear()
    vi.stubGlobal('ResizeObserver', undefined)
})

afterEach(() => {
    vi.unstubAllGlobals()
})

describe('the library remembers its tab', { timeout: 30_000 }, () => {
    for (const tab of ['grid', 'list', 'trash'] as const) {
        test(`(R) a tab chosen as ${tab} is the tab the library reopens on`, async () => {
            const first = await mountLibrary()
            tabButton(first.target, tab).click()
            await settle()
            expect(pressedTabs(first.target)).toEqual([tab])
            await first.close()

            const second = await mountLibrary()
            try {
                expect(pressedTabs(second.target)).toEqual([tab])
                expect(gridViewShows(second.target)).toBe(tab === 'grid')
            } finally {
                await second.close()
            }
        })
    }

    test('(G) with nothing stored the library opens on Simple', async () => {
        const view = await mountLibrary()
        try {
            expect(pressedTabs(view.target)).toEqual(['simple'])
            expect(gridViewShows(view.target)).toBe(false)
        } finally {
            await view.close()
        }
    })

    test('(G) with a corrupt stored value the library opens on Simple', async () => {
        for (const raw of ['', 'gallery', '0', '{"tab":"grid"}', 'GRID']) {
            localStorage.setItem(LIBRARY_TAB_KEY, raw)
            const view = await mountLibrary()
            try {
                expect(pressedTabs(view.target)).toEqual(['simple'])
            } finally {
                await view.close()
            }
        }
    })

    test('(G) mounting into a remembered tab touches neither the database nor any other stored key', async () => {
        localStorage.setItem(LIBRARY_TAB_KEY, 'grid')
        const before = JSON.stringify(DBState.db)
        const view = await mountLibrary()
        try {
            expect(pressedTabs(view.target)).toEqual(['grid'])
            expect(JSON.stringify(DBState.db)).toBe(before)
            expect(checkCharOrderSpy).not.toHaveBeenCalled()
            const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i))
            // The open-folder rail memory is the library's own device-local state, written on mount whatever the tab.
            expect(keys.filter((key) => key !== OPEN_FOLDERS_KEY).sort()).toEqual([LIBRARY_TAB_KEY])
            expect(localStorage.getItem(LIBRARY_TAB_KEY)).toBe('grid')
        } finally {
            await view.close()
        }
    })
})
