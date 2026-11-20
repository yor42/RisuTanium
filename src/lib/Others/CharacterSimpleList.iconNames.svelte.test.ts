// @vitest-environment jsdom

/**
 * The REAL `CharacterSimpleList.svelte`: the add button is named, every Lucide glyph of the list is
 * hidden from assistive technology, and the list uses no default-palette class (a compatibility guard
 * for the colour rule, which passes before and after). The row name line is skipped: it belongs to
 * `CharacterNameRow.svelte`.
 *
 * MOCKED: the module set of `CharacterSimpleList.studio.svelte.test.ts`.
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
        CharEmotion: writable(new Map()),
        OpenRealmStore: writable({ isOpen: false }),
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

import { language } from 'src/lang'
import { DBState } from '../../ts/stores.svelte'
import { controlName, exposedIcons, paletteClasses, unnamedControls } from 'src/lib/a11yNames.test-helpers'
import CharacterSimpleList from './CharacterSimpleList.svelte'

type CharacterFixture = Database['characters'][number]

function makeCharacter(chaId: string, name: string, lastInteraction: number): CharacterFixture {
    return {
        chaId, name, type: 'character', image: '', creatorNotes: '', chatPage: 0, lastInteraction,
        chats: [{ id: `${chaId}-chat`, message: [], note: '', name: '', localLore: [] }],
    } as unknown as CharacterFixture
}

async function settle(): Promise<void> {
    for (let i = 0; i < 4; i++) {
        flushSync()
        await Promise.resolve()
    }
    flushSync()
}

const SKIP = ['[data-part="character-name-row"]']

beforeEach(() => {
    const characters = [makeCharacter('a', 'Ann', 1000), makeCharacter('b', 'Bob', 2000)]
    DBState.db = {
        formatversion: 5, botPresetsId: 0, botPresets: [], modules: [], loadouts: [], plugins: [],
        pluginCustomStorage: {}, characterOrder: characters.map((c) => c.chaId), characters, hideAllImages: false,
    } as unknown as Database
    vi.stubGlobal('ResizeObserver', undefined)
})

afterEach(() => {
    vi.unstubAllGlobals()
})

async function withList(body: (target: HTMLElement) => void): Promise<void> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const studio = { available: (index: number) => index === 1, open: () => {} }
    const app = mount(CharacterSimpleList, { target, props: { studio } }) as Record<string, unknown>
    try {
        await settle()
        body(target)
    } finally {
        await unmount(app as never)
        target.remove()
    }
}

describe('CharacterSimpleList accessible names', { timeout: 60_000 }, () => {
    test('regression reproducer: the add button is named and every glyph is hidden', async () => {
        await withList((target) => {
            expect(unnamedControls(target)).toEqual([])
            expect(exposedIcons(target, { skip: SKIP })).toEqual([])
            const add = Array.from(target.querySelectorAll('button')).find((b) => b.classList.contains('absolute'))!
            expect(controlName(add)).toBe(language.addCharacter)
        })
    })

    test('compatibility guard (passes before and after): the list holds no default-palette class', async () => {
        await withList((target) => {
            expect(paletteClasses(target, { skip: SKIP })).toEqual([])
        })
    })
})
