// @vitest-environment happy-dom

/**
 * MC-078. `GridCatalog.svelte`'s delete, permanent-delete and restore
 * buttons act on the character object the clicked row itself carries,
 * resolved by reference (`indexOf`) after any confirm dialogs, not by an id
 * lookup -- when two characters share a `chaId`, `findCharacterIndexbyId`
 * (`src/ts/util.ts`) always returns the FIRST holder regardless of which
 * row's button fired the event, so acting on the row's own object is what
 * keeps a button from acting on the wrong holder. This file drives the real
 * `removeChar` / `restoreCharacterFromTrash` (`src/ts/characters.ts`)
 * through GridCatalog's own mounted DOM, following the mount pattern in
 * `charlistAvatarLazy.svelte.test.ts` (same directory).
 *
 * MOCKED: `localforage`, `src/ts/globalApi.svelte` (a lightweight
 * stand-in), `src/ts/storage/database.svelte`'s `getDatabase` (reads live
 * `DBState.db`), `src/ts/platform` forced to the plain-HTTP branch,
 * `@tauri-apps/plugin-fs`, a reactive `stores.svelte` stand-in, and
 * `src/ts/alert`'s `alertConfirm` alone (spread from the real module, so
 * `waitAlert`'s real dialog machinery is never exercised). `src/ts/characters`
 * and `src/ts/util` are both REAL: `removeChar`, `restoreCharacterFromTrash`
 * and `findCharacterIndexbyId` are the actual production code under test.
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
    alertConfirmSpy: vi.fn(async () => true),
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
        characterOrder: characters.map((c) => c.chaId),
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

/** The row `<div class="flex-1 ...">` holding `name`'s heading, action buttons included. */
function findRow(target: HTMLElement, name: string): HTMLElement {
    const heading = Array.from(target.querySelectorAll('h4')).find((h) => h.textContent?.trim() === name)
    if (!heading) {
        throw new Error(`row not found for "${name}"`)
    }
    const row = heading.closest('.flex-1') as HTMLElement | null
    if (!row) {
        throw new Error(`row container not found for "${name}"`)
    }
    return row
}

function rowButtons(row: HTMLElement): HTMLButtonElement[] {
    return Array.from(row.querySelectorAll('button'))
}

async function settle(): Promise<void> {
    flushSync()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    flushSync()
}

function trashTimeOf(chaId: string, name: string): number | undefined {
    return DBState.db.characters.find((c) => c.chaId === chaId && c.name === name)?.trashTime
}

function isPresent(chaId: string, name: string): boolean {
    return DBState.db.characters.some((c) => c.chaId === chaId && c.name === name)
}

beforeEach(() => {
    alertConfirmSpy.mockReset()
    alertConfirmSpy.mockImplementation(async () => true)
})

//#endregion

describe('GridCatalog acts on the row that was clicked, even when two characters share a chaId', () => {
    test('deleting B\'s row trashes B, not A', async () => {
        DBState.db = buildDb([makeCharacter('dup-id', 'A'), makeCharacter('dup-id', 'B')])
        const { target, app } = mountGridCatalog()
        clickLayoutButton(target, 1) // list view

        const row = findRow(target, 'B')
        rowButtons(row)[1].click() // TrashIcon (delete)
        await settle()
        await settle()

        expect(trashTimeOf('dup-id', 'B')).toBeTruthy()
        expect(trashTimeOf('dup-id', 'A')).toBeFalsy()

        await teardown(target, app)
    })

    test('permanently deleting B\'s trashed row removes B, leaving A in place', async () => {
        DBState.db = buildDb([
            makeCharacter('dup-id', 'A'),
            makeCharacter('dup-id', 'B', 1_700_000_000_000),
        ])
        const { target, app } = mountGridCatalog()
        clickLayoutButton(target, 2) // trash view

        const row = findRow(target, 'B')
        rowButtons(row)[1].click() // TrashIcon (permanent delete)
        await settle()
        await settle()

        expect(isPresent('dup-id', 'B')).toBe(false)
        expect(isPresent('dup-id', 'A')).toBe(true)

        await teardown(target, app)
    })

    test('restoring B\'s row restores B, leaving A trashed', async () => {
        DBState.db = buildDb([
            makeCharacter('dup-id', 'A', 1_700_000_000_001),
            makeCharacter('dup-id', 'B', 1_700_000_000_000),
        ])
        const { target, app } = mountGridCatalog()
        clickLayoutButton(target, 2) // trash view

        const row = findRow(target, 'B')
        rowButtons(row)[0].click() // Undo2Icon (restore)
        await settle()

        expect(trashTimeOf('dup-id', 'B')).toBeFalsy()
        expect(trashTimeOf('dup-id', 'A')).toBeTruthy()

        await teardown(target, app)
    })

    test('a character inserted at index 0 while the delete confirm is open still leaves the action on B', async () => {
        DBState.db = buildDb([makeCharacter('dup-id', 'A'), makeCharacter('dup-id', 'B')])
        const { target, app } = mountGridCatalog()
        clickLayoutButton(target, 1) // list view

        alertConfirmSpy.mockImplementation(async () => {
            // B's old index now holds this newly-inserted character.
            DBState.db.characters = [makeCharacter('char-other', 'Inserted'), ...DBState.db.characters]
            return true
        })

        const row = findRow(target, 'B')
        rowButtons(row)[1].click() // TrashIcon (delete)
        await settle()
        await settle()

        expect(trashTimeOf('dup-id', 'B')).toBeTruthy()
        expect(trashTimeOf('dup-id', 'A')).toBeFalsy()

        await teardown(target, app)
    })

    test('when B specifically is removed from the list before the confirms resolve, nothing happens to A', async () => {
        DBState.db = buildDb([makeCharacter('dup-id', 'A'), makeCharacter('dup-id', 'B')])
        const { target, app } = mountGridCatalog()
        clickLayoutButton(target, 1) // list view

        let call = 0
        alertConfirmSpy.mockImplementation(async () => {
            call += 1
            if (call === 2) {
                // B itself is gone by the time the second confirm resolves --
                // e.g. removed by another action while this dialog was open.
                // A, sharing the same chaId, is still present.
                DBState.db.characters = DBState.db.characters.filter((c) => c.name !== 'B')
            }
            return true
        })

        const row = findRow(target, 'B')
        rowButtons(row)[1].click() // TrashIcon (delete)
        await settle()
        await settle()

        expect(isPresent('dup-id', 'B')).toBe(false) // removed by the test itself, not by removeChar
        expect(trashTimeOf('dup-id', 'A')).toBeFalsy()

        await teardown(target, app)
    })
})
