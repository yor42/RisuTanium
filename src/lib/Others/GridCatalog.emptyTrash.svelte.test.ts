// @vitest-environment happy-dom

/**
 * The "Empty trash" button of `GridCatalog.svelte`'s trash tab. The mount, the module mocks and
 * the helpers are those of `GridCatalog.duplicateChaId.svelte.test.ts`: `src/ts/characters` and
 * `src/ts/util` are REAL, so the button drives the real `removeTrashedCharacters` against a real
 * `DBState`; the rows and the button must read one list, and the click hands over exactly the
 * characters of the rows on screen at that moment. `src/ts/alert`'s `alertConfirm` is the only
 * mocked alert function, held open and answered by each test.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { describe, test, expect, vi, beforeEach } from 'vitest'
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

const { alertConfirmSpy } = vi.hoisted(() => ({
    alertConfirmSpy: vi.fn(async (_message: string) => true),
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
    const { DBState } = await import('../../ts/stores.svelte')
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

vi.mock(import('../../ts/alert'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        alertConfirm: alertConfirmSpy,
    }
})

//#endregion

import { DBState } from '../../ts/stores.svelte'
import { language } from '../../lang'
import GridCatalog from './GridCatalog.svelte'

//#region fixtures and helpers

type CharacterFixture = Database['characters'][number]

const T0 = 1_700_000_000_000

function makeCharacter(chaId: string, name: string, trashTime?: number): CharacterFixture {
    return {
        chaId,
        name,
        type: 'character',
        image: '',
        creatorNotes: '',
        chatPage: 0,
        lastInteraction: 0,
        chats: [{ id: `${chaId}-chat-0-${name}`, message: [], note: '', name: '', localLore: [] }],
        trashTime,
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
        characterOrder: characters.filter((c) => !c.trashTime).map((c) => c.chaId),
        characters,
        hideAllImages: false,
    } as unknown as Database
}

function mountGridCatalog(): { target: HTMLElement; app: Record<string, unknown> } {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(GridCatalog, { target, props: {} }) as unknown as Record<string, unknown>
    return { target, app }
}

async function teardown(target: HTMLElement, app: Record<string, unknown>): Promise<void> {
    await unmount(app as never)
    target.remove()
}

function clickTrashTab(root: HTMLElement): void {
    const label = language.trash.trim()
    const btn = Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.trim() === label)
    if (!btn) {
        throw new Error('trash tab button not found')
    }
    btn.click()
    flushSync()
}

function emptyTrashButton(root: HTMLElement): HTMLButtonElement | undefined {
    const labels = [language.emptyTrash, ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => language.emptyTrashMatching(n))]
    return Array.from(root.querySelectorAll('button')).find((b) => labels.includes(b.textContent?.trim() ?? ''))
}

function typeSearch(root: HTMLElement, value: string): void {
    const input = root.querySelector('input') as HTMLInputElement | null
    if (!input) {
        throw new Error('search input not found')
    }
    input.value = value
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

async function settle(): Promise<void> {
    flushSync()
    for (let i = 0; i < 6; i++) {
        await Promise.resolve()
    }
    flushSync()
}

const names = () => DBState.db.characters.map((c) => c.name)

beforeEach(() => {
    alertConfirmSpy.mockReset()
    alertConfirmSpy.mockImplementation(async () => true)
})

//#endregion

describe('the Empty trash button is shown only when it has something to act on', () => {
    test('absent when the trash is empty', async () => {
        DBState.db = buildDb([makeCharacter('a', 'A'), makeCharacter('b', 'B')])
        const { target, app } = mountGridCatalog()
        clickTrashTab(target)
        expect(emptyTrashButton(target)).toBeUndefined()
        await teardown(target, app)
    })

    test('absent when the search matches no trashed row', async () => {
        DBState.db = buildDb([makeCharacter('a', 'Ann', T0), makeCharacter('b', 'Bob')])
        const { target, app } = mountGridCatalog()
        clickTrashTab(target)
        typeSearch(target, 'zzz')
        expect(emptyTrashButton(target)).toBeUndefined()
        await teardown(target, app)
    })

    test('absent when the only trashed character is a hidden system character', async () => {
        DBState.db = buildDb([makeCharacter('§playground', 'Playground', T0), makeCharacter('b', 'Bob')])
        const { target, app } = mountGridCatalog()
        clickTrashTab(target)
        expect(emptyTrashButton(target)).toBeUndefined()
        await teardown(target, app)
    })

    test('present with the plain label when there is no search', async () => {
        DBState.db = buildDb([makeCharacter('a', 'Ann', T0)])
        const { target, app } = mountGridCatalog()
        clickTrashTab(target)
        expect(emptyTrashButton(target)?.textContent?.trim()).toBe(language.emptyTrash)
        await teardown(target, app)
    })

    test('absent on the other tabs', async () => {
        DBState.db = buildDb([makeCharacter('a', 'Ann', T0)])
        const { target, app } = mountGridCatalog()
        expect(emptyTrashButton(target)).toBeUndefined()
        await teardown(target, app)
    })
})

describe('what the button deletes', () => {
    test('with no search it asks once, for every trashed character, and removes them and nothing else', async () => {
        DBState.db = buildDb([
            makeCharacter('l0', 'Live0'),
            makeCharacter('a', 'Ann', T0),
            makeCharacter('l1', 'Live1'),
            makeCharacter('b', 'Bob', T0),
            makeCharacter('§playground', 'Playground', T0),
        ])
        const { target, app } = mountGridCatalog()
        clickTrashTab(target)
        emptyTrashButton(target)!.click()
        await settle()
        expect(alertConfirmSpy).toHaveBeenCalledTimes(1)
        const message = alertConfirmSpy.mock.calls[0][0]
        expect(message).toContain(language.emptyTrashConfirmAll(2))
        expect(message).not.toContain('matching')
        expect(names()).toEqual(['Live0', 'Live1', 'Playground'])
        await teardown(target, app)
    })

    test('with a search the label and the confirmation say "matching", and only the shown rows go', async () => {
        DBState.db = buildDb([
            makeCharacter('a', 'Ann', T0),
            makeCharacter('b', 'Anna', T0),
            makeCharacter('c', 'Bob', T0),
            makeCharacter('d', 'Anne'),
        ])
        const { target, app } = mountGridCatalog()
        clickTrashTab(target)
        typeSearch(target, 'ann')
        expect(emptyTrashButton(target)?.textContent?.trim()).toBe(language.emptyTrashMatching(2))
        emptyTrashButton(target)!.click()
        await settle()
        const message = alertConfirmSpy.mock.calls[0][0]
        expect(message).toContain(language.emptyTrashConfirmMatching(2))
        expect(names()).toEqual(['Bob', 'Anne'])
        await teardown(target, app)
    })

    test('a search of spaces counts as no search', async () => {
        DBState.db = buildDb([makeCharacter('a', 'Ann', T0), makeCharacter('b', 'Bob', T0)])
        const { target, app } = mountGridCatalog()
        clickTrashTab(target)
        typeSearch(target, '   ')
        expect(emptyTrashButton(target)?.textContent?.trim()).toBe(language.emptyTrash)
        emptyTrashButton(target)!.click()
        await settle()
        const message = alertConfirmSpy.mock.calls[0][0]
        expect(message).toContain(language.emptyTrashConfirmAll(2))
        expect(names()).toEqual([])
        await teardown(target, app)
    })

    test('declining the confirmation deletes nothing', async () => {
        DBState.db = buildDb([makeCharacter('a', 'Ann', T0), makeCharacter('b', 'Bob')])
        alertConfirmSpy.mockImplementation(async () => false)
        const { target, app } = mountGridCatalog()
        clickTrashTab(target)
        emptyTrashButton(target)!.click()
        await settle()
        expect(names()).toEqual(['Ann', 'Bob'])
        await teardown(target, app)
    })

    test('the clicked rows are what is removed, even if the search changes while the confirmation is open', async () => {
        DBState.db = buildDb([
            makeCharacter('a', 'Ann', T0),
            makeCharacter('b', 'Anna', T0),
            makeCharacter('c', 'Bob', T0),
            makeCharacter('d', 'Cat', T0),
        ])
        let release!: (answer: boolean) => void
        alertConfirmSpy.mockImplementation(() => new Promise<boolean>((resolve) => { release = resolve }))
        const { target, app } = mountGridCatalog()
        clickTrashTab(target)
        typeSearch(target, 'ann')
        emptyTrashButton(target)!.click()
        await settle()
        // While the dialog is open the list is re-derived from a different search.
        typeSearch(target, 'bob')
        expect(emptyTrashButton(target)?.textContent?.trim()).toBe(language.emptyTrashMatching(1))
        release(true)
        await settle()
        expect(names()).toEqual(['Bob', 'Cat'])
        await teardown(target, app)
    })
})
