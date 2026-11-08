// @vitest-environment happy-dom

/**
 * The trash and the add button on the simple character list.
 * `CharacterSimpleList.svelte` hides trashed characters by default and lists
 * them with `hideTrash=false`. The trash itself (restore, delete permanently,
 * Empty trash) lives in `CharacterTrashList`, not here. The add-character
 * button is always present and a click adds one character.
 *
 * MOCKED: the module set of `CharacterSimpleList.search.svelte.test.ts` (same
 * directory), with `changeChar` and `addCharacter` bare spies and the clock
 * faked for `setTimeout`/`clearTimeout` only. Nothing here writes to storage.
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

const { changeCharSpy, addCharacterSpy } = vi.hoisted(() => ({
    changeCharSpy: vi.fn(),
    addCharacterSpy: vi.fn(),
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
        changeChar: changeCharSpy,
        addCharacter: addCharacterSpy,
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
import CharacterSimpleList from './CharacterSimpleList.svelte'

//#region fixtures and helpers

type CharacterFixture = Database['characters'][number]

const GONE = 1_700_000_000_000

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

/** Live Ann and Bob, trashed Cat and Cara. */
function standard(): CharacterFixture[] {
    return [
        makeCharacter('a', 'Ann'),
        makeCharacter('b', 'Bob'),
        makeCharacter('c', 'Cat', { trashTime: GONE }),
        makeCharacter('d', 'Cara', { trashTime: GONE }),
    ]
}

async function settle(): Promise<void> {
    for (let i = 0; i < 4; i++) {
        flushSync()
        await Promise.resolve()
    }
    flushSync()
}

async function withMounted(props: { hideTrash?: boolean; search?: string }, body: (target: HTMLElement) => void | Promise<void>): Promise<void> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(CharacterSimpleList, { target, props }) as Record<string, unknown>
    try {
        await settle()
        await body(target)
    } finally {
        await unmount(app as never)
        target.remove()
    }
}

function rowNames(root: HTMLElement): string[] {
    return Array.from(root.querySelectorAll('div.flex-1 > span:first-child')).map((s) => s.textContent?.trim() ?? '')
}

function addButton(root: HTMLElement): HTMLButtonElement | null {
    return root.querySelector<HTMLButtonElement>('button.absolute')
}

beforeEach(() => {
    changeCharSpy.mockClear()
    addCharacterSpy.mockClear()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})

afterEach(() => {
    vi.useRealTimers()
})

//#endregion

describe('CharacterSimpleList: the trash is hidden by default', { timeout: 60_000 }, () => {
    test('mounted with no props, a trashed character is not listed', async () => {
        DBState.db = buildDb(standard())

        await withMounted({}, (target) => {
            expect(rowNames(target)).toEqual(['Ann', 'Bob'])
        })
    })

    // Guard: passes before and after.
    test('guard: hideTrash=false still lists trashed characters', async () => {
        DBState.db = buildDb(standard())

        await withMounted({ hideTrash: false }, (target) => {
            expect(rowNames(target).sort()).toEqual(['Ann', 'Bob', 'Cara', 'Cat'])
        })
    })
})

describe('CharacterSimpleList: the add-character button', { timeout: 60_000 }, () => {
    // Guard: passes before and after.
    test('guard: the add-character button is present and adds a character', async () => {
        DBState.db = buildDb(standard())

        await withMounted({}, (target) => {
            const button = addButton(target)
            expect(button).not.toBeNull()
            button!.click()
            expect(addCharacterSpy).toHaveBeenCalledTimes(1)
        })
    })
})
