// @vitest-environment jsdom

/**
 * Accessible name of the List tab's per-row trash button in the REAL `GridCatalog.svelte`. The button
 * is icon-only; it carries the "Move to trash" name (the action it performs: a 30-day Trash move,
 * not a permanent delete) and its glyph is hidden from the accessibility tree.
 *
 * The click case is a compatibility guard (the action is unchanged); it fails before the change only
 * because the `data-part` hook did not exist.
 *
 * MOCKED: the module set of `GridCatalog.studio.svelte.test.ts` (same directory).
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database, folder } from '../../ts/storage/database.svelte'
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

const { changeCharSpy, removeCharSpy, trashCharactersSpy, alertSelectSpy } = vi.hoisted(() => ({
    changeCharSpy: vi.fn(),
    removeCharSpy: vi.fn(),
    trashCharactersSpy: vi.fn(),
    alertSelectSpy: vi.fn(),
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
        changeChar: changeCharSpy,
        removeChar: removeCharSpy,
        trashCharacters: trashCharactersSpy,
    }
})

vi.mock(import('../../ts/alert'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        alertSelect: alertSelectSpy,
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
import { resetBackHandlersForTests } from '../../ts/backHandlers'
import { language } from '../../lang'

import GridCatalog from './GridCatalog.svelte'

//#region fixtures and helpers

type CharacterFixture = Database['characters'][number]
type OrderFixture = Database['characterOrder']

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

function makeFolder(id: string, name: string, data: string[]): folder {
    return { id, name, data, color: '' }
}

function install(characters: CharacterFixture[], order: OrderFixture): void {
    DBState.db = {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        characters,
        characterOrder: order,
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

function clickButton(root: ParentNode, text: string): void {
    const button = Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.trim() === text.trim())
    if (!button) {
        throw new Error(`no button "${text}"`)
    }
    button.click()
    flushSync()
}

const mounted: { app: unknown, target: HTMLElement }[] = []

async function showList(): Promise<HTMLElement> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted.push({ app: mount(GridCatalog, { target, props: { endGrid: () => {} } }), target })
    await settle()
    clickButton(target, language.list)
    await settle()
    return target
}

beforeEach(() => {
    localStorage.clear()
    removeCharSpy.mockClear()
    install([makeCharacter('A', 'Char A'), makeCharacter('B', 'Char B')], ['A', 'B'] as unknown as OrderFixture)
})

afterEach(async () => {
    for (const { app, target } of mounted.splice(0)) {
        await unmount(app as never)
        target.remove()
    }
    resetBackHandlersForTests()
    localStorage.clear()
})

describe('List tab trash button name', () => {
    test('every row trash button is named Move to trash with a hidden glyph', async () => {
        const target = await showList()
        const buttons = Array.from(target.querySelectorAll<HTMLButtonElement>('[data-part="library-trash"]'))
        expect(buttons.length).toBe(2)
        for (const button of buttons) {
            expect(button.getAttribute('aria-label')).toBe(language.othersUi.editMoveToTrash)
            expect(button.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true')
        }
    })

    test('the named button still moves its row character to Trash', async () => {
        const target = await showList()
        target.querySelector<HTMLButtonElement>('[data-part="library-trash"]')!.click()
        flushSync()
        expect(removeCharSpy).toHaveBeenCalledTimes(1)
        expect(removeCharSpy.mock.calls[0][2]).toBe('normal')
    })
})
