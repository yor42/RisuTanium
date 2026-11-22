// @vitest-environment jsdom

/**
 * `GridCatalog.svelte`: the sort select sits in a wrapping label; its name comes from the inner text span, never from the
 * wrapping label (whose text would include the select's value). Mounts the REAL component in its grid layout. MOCKED: the
 * module set of `GridCatalog.i18n.svelte.test.ts` (same directory), with `changeChar` a bare spy. Nothing here writes to
 * storage.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'
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
import { language } from '../../lang'
import { controlName, fieldNameProblems, unnamedControls } from '../a11yNames.test-helpers'
import GridCatalog from './GridCatalog.svelte'

type CharacterFixture = Database['characters'][number]

function makeCharacter(chaId: string, name: string): CharacterFixture {
    return {
        chaId,
        name,
        type: 'character',
        image: '',
        chatPage: 0,
        lastInteraction: 0,
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

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

// Every control in the grid view carries an accessible name, the icon-only back button included.
const KNOWN_UNNAMED: string[] = []

describe('GridCatalog value-control names', { timeout: 60_000 }, () => {
    test('regression reproducer: the sort select is named by its inner text span, not by the wrapping label', async () => {
        DBState.db = {
            formatversion: 5,
            botPresetsId: 0,
            botPresets: [],
            modules: [],
            loadouts: [],
            plugins: [],
            pluginCustomStorage: {},
            characterOrder: ['a'],
            characters: [makeCharacter('a', 'Alice')],
            hideAllImages: false,
        } as unknown as Database
        const target = document.createElement('div')
        document.body.appendChild(target)
        const app = mount(GridCatalog, { target, props: {} }) as Record<string, unknown>
        mounted.push({ target, app })
        await settle()
        const gridLabel = language.grid.trim()
        Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.trim() === gridLabel)!.click()
        await settle()
        expect(fieldNameProblems(target, [{ name: language.othersUi.sortLabel }])).toEqual([])
        expect(unnamedControls(target, { fields: true, values: true })).toEqual(KNOWN_UNNAMED)
        expect(controlName(target.querySelector('input[type=text]')!)).toBe(language.search)
    })

    test('regression reproducer: TalkBack hears a name at the back button and the search field', async () => {
        DBState.db = {
            formatversion: 5,
            botPresetsId: 0,
            botPresets: [],
            modules: [],
            loadouts: [],
            plugins: [],
            pluginCustomStorage: {},
            characterOrder: ['a'],
            characters: [makeCharacter('a', 'Alice')],
            hideAllImages: false,
        } as unknown as Database
        const target = document.createElement('div')
        document.body.appendChild(target)
        const app = mount(GridCatalog, { target, props: {} }) as Record<string, unknown>
        mounted.push({ target, app })
        await settle()

        // An icon-only button with only a title is announced as a bare "button" by Android WebView TalkBack.
        const back = target.querySelector<HTMLButtonElement>('[data-part="library-back"]')!
        expect(back.getAttribute('aria-label')).toBe(language.settingsPage.back)

        // TalkBack speaks only aria-describedby in a text field's own stop, so the description must resolve to the name.
        const search = target.querySelector<HTMLInputElement>('input[type=text]')!
        const describedIds = (search.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean)
        const spoken = describedIds.map((id) => document.getElementById(id)?.textContent?.trim() ?? '').join(' ')
        expect(spoken).toBe(language.search)
    })
})
