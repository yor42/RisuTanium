// @vitest-environment happy-dom

/**
 * `GridCatalog.svelte`: picking a character opens it and closes the screen, as
 * the Simple tab already does. In the Grid tab the tile is the click target; in
 * the List tab a click anywhere on the row is, except on the row's own controls
 * (delete). Each entry has exactly one focusable control that opens the
 * character, named after the character, and no button sits inside a button.
 *
 * MOCKED: the module set of `GridCatalog.hiddenCharacters.svelte.test.ts` (same
 * directory), with `changeChar` and `removeChar` bare spies. Nothing here
 * writes to storage.
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

const { changeCharSpy, removeCharSpy } = vi.hoisted(() => ({
    changeCharSpy: vi.fn(),
    removeCharSpy: vi.fn(),
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
        removeChar: removeCharSpy,
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

function makeCharacter(chaId: string, name: string, extra: Record<string, unknown> = {}): CharacterFixture {
    return {
        chaId,
        name,
        type: 'character',
        image: '',
        creatorNotes: `${name} description`,
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

async function settle(): Promise<void> {
    for (let i = 0; i < 4; i++) {
        flushSync()
        await Promise.resolve()
    }
    flushSync()
}

async function withMounted(endGrid: () => void, body: (target: HTMLElement) => void | Promise<void>): Promise<void> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(GridCatalog, { target, props: { endGrid } }) as Record<string, unknown>
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

/** The List tab row whose heading is `name`. */
function listRow(root: HTMLElement, name: string): HTMLElement {
    const heading = Array.from(root.querySelectorAll('h4')).find((h) => h.textContent?.trim() === name)
    const row = heading?.closest<HTMLElement>('.border-darkborderc')
    if (!row) {
        throw new Error(`list row not found for "${name}"`)
    }
    return row
}

/** The description block of a List tab row. */
function descriptionOf(row: HTMLElement): HTMLElement {
    const el = row.querySelector<HTMLElement>('[data-description]')
    if (!el) {
        throw new Error('description not found')
    }
    return el
}

const characters = (): CharacterFixture[] => [makeCharacter('a', 'Ann'), makeCharacter('b', 'Bob')]

beforeEach(() => {
    changeCharSpy.mockClear()
    removeCharSpy.mockClear()
})

//#endregion

describe('GridCatalog: picking a character opens it and closes the screen', { timeout: 60_000 }, () => {
    test('Grid tab: a tile click opens the character and closes the screen', async () => {
        DBState.db = buildDb(characters())
        const endGrid = vi.fn()

        await withMounted(endGrid, (target) => {
            clickLayoutButton(target, 0)
            const tiles = target.querySelectorAll<HTMLElement>('.ico')
            expect(tiles.length).toBe(2)
            tiles[1].click()
            expect(changeCharSpy.mock.calls).toEqual([[1]])
            expect(endGrid).toHaveBeenCalledTimes(1)
        })
    })

    test('Grid tab: a tile is one button named after the character, with no button inside it', async () => {
        DBState.db = buildDb(characters())

        await withMounted(vi.fn(), (target) => {
            clickLayoutButton(target, 0)
            const buttons = Array.from(target.querySelectorAll<HTMLButtonElement>('.ico'))
            expect(buttons.map((b) => b.tagName)).toEqual(['BUTTON', 'BUTTON'])
            expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['Ann', 'Bob'])
            expect(target.querySelector('button button')).toBeNull()
        })
    })

    test('List tab: a click on the avatar, the name or the description opens the character once and closes the screen', async () => {
        DBState.db = buildDb(characters())
        const endGrid = vi.fn()

        await withMounted(endGrid, (target) => {
            clickLayoutButton(target, 1)
            const row = listRow(target, 'Bob')

            row.querySelector<HTMLElement>('.ico')!.click()
            expect(changeCharSpy.mock.calls).toEqual([[1]])
            expect(endGrid).toHaveBeenCalledTimes(1)

            row.querySelector<HTMLElement>('h4')!.click()
            expect(changeCharSpy.mock.calls).toEqual([[1], [1]])
            expect(endGrid).toHaveBeenCalledTimes(2)

            descriptionOf(row).click()
            expect(changeCharSpy.mock.calls).toEqual([[1], [1], [1]])
            expect(endGrid).toHaveBeenCalledTimes(3)
        })
    })

    test('List tab: a row has one opening button named after the character, plus delete, and no nested button', async () => {
        DBState.db = buildDb(characters())
        const endGrid = vi.fn()

        await withMounted(endGrid, (target) => {
            clickLayoutButton(target, 1)
            const row = listRow(target, 'Ann')
            const buttons = Array.from(row.querySelectorAll<HTMLButtonElement>('button'))
            // The opening button and the delete button; Show more is absent for short text.
            expect(buttons.length).toBe(2)
            expect(buttons[0].textContent?.trim()).toBe('Ann')
            expect(target.querySelector('button button')).toBeNull()

            buttons[0].click()
            expect(changeCharSpy.mock.calls).toEqual([[0]])
            expect(endGrid).toHaveBeenCalledTimes(1)
        })
    })

    test('List tab: a click that ends a drag-selection of the row text does not open the character', async () => {
        DBState.db = buildDb(characters())
        const endGrid = vi.fn()

        await withMounted(endGrid, (target) => {
            clickLayoutButton(target, 1)
            const row = listRow(target, 'Bob')
            const range = document.createRange()
            range.selectNodeContents(descriptionOf(row))
            const selection = window.getSelection()!
            selection.removeAllRanges()
            selection.addRange(range)
            try {
                descriptionOf(row).click()
                expect(changeCharSpy).not.toHaveBeenCalled()
                expect(endGrid).not.toHaveBeenCalled()
            } finally {
                selection.removeAllRanges()
            }
        })
    })
    test('List tab: with text selected in the row, clicking the name button still opens the character', async () => {
        DBState.db = buildDb(characters())
        const endGrid = vi.fn()

        await withMounted(endGrid, (target) => {
            clickLayoutButton(target, 1)
            const row = listRow(target, 'Bob')
            const range = document.createRange()
            range.selectNodeContents(descriptionOf(row))
            const selection = window.getSelection()!
            selection.removeAllRanges()
            selection.addRange(range)
            try {
                row.querySelector<HTMLButtonElement>('h4 button')!.click()
                expect(changeCharSpy.mock.calls).toEqual([[1]])
                expect(endGrid).toHaveBeenCalledTimes(1)
            } finally {
                selection.removeAllRanges()
            }
        })
    })

    // Guard: delete already acts on the row's own character and never opened it.
    test('guard: the List delete button deletes that character and does not open it or close the screen', async () => {
        DBState.db = buildDb(characters())
        const endGrid = vi.fn()

        await withMounted(endGrid, (target) => {
            clickLayoutButton(target, 1)
            const row = listRow(target, 'Bob')
            const buttons = Array.from(row.querySelectorAll<HTMLButtonElement>('button'))
            buttons[buttons.length - 1].click()
            expect(removeCharSpy).toHaveBeenCalledWith(DBState.db.characters[1], 'Bob')
            expect(changeCharSpy).not.toHaveBeenCalled()
            expect(endGrid).not.toHaveBeenCalled()
        })
    })

    // Guard: the Simple tab already opens and closes.
    test('guard: the Simple tab row opens the character and closes the screen', async () => {
        DBState.db = buildDb(characters())
        const endGrid = vi.fn()

        await withMounted(endGrid, (target) => {
            clickLayoutButton(target, 3)
            const row = Array.from(target.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.includes('Bob'))!
            row.click()
            expect(changeCharSpy.mock.calls).toEqual([[1]])
            expect(endGrid).toHaveBeenCalledTimes(1)
        })
    })

    test('Trash tab: a trashed row avatar does not open the character or close the screen', async () => {
        DBState.db = buildDb([makeCharacter('a', 'Ann'), makeCharacter('b', 'Bob', { trashTime: 1_700_000_000_000 })])
        const endGrid = vi.fn()

        await withMounted(endGrid, (target) => {
            clickLayoutButton(target, 2)
            const avatars = target.querySelectorAll<HTMLElement>('.ico')
            expect(avatars.length).toBe(1)
            avatars[0].click()
            expect(changeCharSpy).not.toHaveBeenCalled()
            expect(endGrid).not.toHaveBeenCalled()
        })
    })
})
