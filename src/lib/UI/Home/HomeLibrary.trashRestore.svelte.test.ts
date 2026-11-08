// @vitest-environment happy-dom

/**
 * `HomeLibrary.svelte`, Trash tab: restoring a trashed character from the library embedded in Home
 * keeps the production behaviour of the App grid. The character leaves the trash and is marked for
 * save, so the restore reaches disk; Home stays on the library and the selection is untouched.
 * This is a compatibility guard: the same behaviour holds in the App grid today.
 *
 * MOCKED: the module set of `GridCatalog.duplicateChaId.svelte.test.ts` (`src/lib/Others`).
 * `src/ts/characters` is REAL; `markCharacterForSave` is a spy that delegates to the original.
 */
import { flushSync, mount, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from '../../../ts/storage/database.svelte'
import type { RisuEnvironmentLabel } from '../../../ts/platform'

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
            changeChatTo: vi.fn(),
            downloadFile: vi.fn(),
            openURL: vi.fn(),
            loadAsset: vi.fn(),
            saveAsset: vi.fn(),
            readImage: vi.fn(),
            globalFetch: vi.fn(),
            fetchNative: vi.fn(),
            toGetter: vi.fn((obj: unknown) => obj),
            aiWatermarkingLawApplies: vi.fn(() => false),
            aiLawApplies: vi.fn(() => false),
            hubURL: '',
            usingSw: false,
            getFetchLogs: vi.fn(() => []),
            getFetchData: vi.fn(() => ({})),
        }) as unknown as typeof import('src/ts/globalApi.svelte'),
)

vi.mock(import('src/ts/storage/database.svelte'), async (importOriginal) => {
    const actual = await importOriginal()
    const { DBState } = await import('../../../ts/stores.svelte')
    return {
        ...actual,
        getDatabase: vi.fn((_options?: { snapshot?: boolean }) => DBState.db),
    }
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

vi.mock(import('../../../ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(-1),
        MobileGUIStack: writable([]),
        CharEmotion: writable(new Map()),
        OpenRealmStore: writable(false),
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
    } as unknown as typeof import('../../../ts/stores.svelte')
})

vi.mock(import('../../../ts/storage/characterSaveMarks'), async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, markCharacterForSave: vi.fn(actual.markCharacterForSave) }
})

//#endregion

Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 312 })

import { DBState, selectedCharID } from '../../../ts/stores.svelte'
import { markCharacterForSave } from '../../../ts/storage/characterSaveMarks'
import { language } from '../../../lang'
import { homeView, openHomeLibrary, showHomeLanding } from './homeView.svelte'
import HomeLibrary from './HomeLibrary.svelte'

//#region fixtures and helpers

type CharacterFixture = Database['characters'][number]

function makeCharacter(chaId: string, name: string, trashTime?: number): CharacterFixture {
    return {
        chaId,
        name,
        type: 'character',
        image: '',
        creatorNotes: '',
        chatPage: 0,
        lastInteraction: 0,
        chats: [{ id: `${chaId}-chat`, message: [], note: '', name: '', localLore: [] }],
        trashTime,
    } as unknown as CharacterFixture
}

async function settle(): Promise<void> {
    for (let i = 0; i < 4; i++) {
        flushSync()
        await Promise.resolve()
    }
    flushSync()
}

//#endregion

beforeEach(() => {
    vi.mocked(markCharacterForSave).mockClear()
    selectedCharID.set(-1)
    showHomeLanding()
})

afterEach(() => {
    showHomeLanding()
})

describe('HomeLibrary: restoring from the embedded Trash tab', () => {
    test('(G) the character leaves the trash and is marked for save; the library stays and nothing is selected', async () => {
        const characters = [makeCharacter('keep', 'Keeper'), makeCharacter('gone', 'Trashed', 1_700_000_000_000)]
        DBState.db = {
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

        openHomeLibrary()
        const target = document.createElement('div')
        document.body.appendChild(target)
        const app = mount(HomeLibrary, { target }) as Record<string, unknown>
        try {
            await settle()
            const trashTab = Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.trim() === language.trash.trim())!
            trashTab.click()
            flushSync()

            const heading = Array.from(target.querySelectorAll('h4')).find((h) => h.textContent?.trim() === 'Trashed')!
            const row = heading.closest('.flex-1') as HTMLElement
            row.querySelectorAll('button')[0].click()
            await settle()

            expect(DBState.db.characters.find((c) => c.chaId === 'gone')?.trashTime).toBeFalsy()
            expect(vi.mocked(markCharacterForSave)).toHaveBeenCalledWith('gone')
            expect(homeView.view).toBe('library')
            expect(get(selectedCharID)).toBe(-1)
        } finally {
            await unmount(app as never)
            target.remove()
        }
    })
})
