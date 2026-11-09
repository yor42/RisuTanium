// @vitest-environment happy-dom

/**
 * `GridCatalog.svelte`'s empty states. A library with no live character (judged over the unfiltered list,
 * so a trashed or hidden system character does not count) shows Home's `HomeEmptyHero` in Simple, Grid and
 * List, and never in Trash. A non-empty library with a landed query that matches nothing shows the
 * `libraryNoMatch` line. Trash shows `trashEmpty` when nothing is trashed and `libraryNoMatch` when a
 * search hides every trashed row. The hero's Create selects a character and then closes the screen.
 *
 * MOCKED: the module set of `GridCatalog.hiddenCharacters.svelte.test.ts` (same directory), with
 * `changeChar` and `createNewCharacter` as spies. Elements are found by `data-part` and by the language
 * strings the component renders. Nothing here writes to storage.
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

const { changeCharSpy, createNewCharacterSpy, importCharacterSpy } = vi.hoisted(() => ({
    changeCharSpy: vi.fn(),
    createNewCharacterSpy: vi.fn(),
    importCharacterSpy: vi.fn(),
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
        createNewCharacter: createNewCharacterSpy,
    }
})

vi.mock(import('../../ts/characterCards'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        importCharacter: importCharacterSpy,
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

const HERO = '[data-part="home-empty-hero"]'
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

/** No live character: one trashed ordinary character and the hidden Playground. */
function emptyLibrary(): CharacterFixture[] {
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

async function withMounted(body: (target: HTMLElement, endGrid: ReturnType<typeof vi.fn>) => void | Promise<void>): Promise<void> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const endGrid = vi.fn()
    const app = mount(GridCatalog, { target, props: { endGrid } }) as Record<string, unknown>
    try {
        await settle()
        await body(target, endGrid)
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

function createButton(root: HTMLElement): HTMLButtonElement {
    const btn = Array.from(root.querySelectorAll<HTMLButtonElement>(`${HERO} button`)).find((b) => b.textContent?.trim() === language.homeEmptyCreate)
    if (!btn) {
        throw new Error('hero Create button not found')
    }
    return btn
}

function importButton(root: HTMLElement): HTMLButtonElement {
    const btn = Array.from(root.querySelectorAll<HTMLButtonElement>(`${HERO} button`)).find((b) => b.textContent?.trim() === language.homeEmptyImport)
    if (!btn) {
        throw new Error('hero Import button not found')
    }
    return btn
}

beforeEach(() => {
    changeCharSpy.mockReset()
    createNewCharacterSpy.mockReset()
    importCharacterSpy.mockReset()
})

//#endregion

describe('GridCatalog empty library', { timeout: 60_000 }, () => {
    // T30: reproducer.
    test.each([
        ['simple', SIMPLE],
        ['grid', GRID],
        ['list', LIST],
    ] as const)('the %s layout shows the hero when no character is live', async (_label, layout) => {
        DBState.db = buildDb(emptyLibrary())

        await withMounted((target) => {
            clickLayoutButton(target, layout)
            expect(target.querySelector(HERO)).not.toBeNull()
            expect(hasText(target, language.libraryNoMatch)).toBe(false)
        })
    })

    // T32 (third): guard; the hero never shows in Trash and the trashed row is listed.
    test('guard: Trash of an empty library lists the trashed row and shows no hero', async () => {
        DBState.db = buildDb(emptyLibrary())

        await withMounted((target) => {
            clickLayoutButton(target, TRASH)
            expect(target.querySelector(HERO)).toBeNull()
            expect(Array.from(target.querySelectorAll('h4')).map((h) => h.textContent?.trim())).toEqual(['Gone'])
            expect(hasText(target, language.trashEmpty)).toBe(false)
            expect(hasText(target, language.libraryNoMatch)).toBe(false)
        })
    })

    // T33: guard; an empty query over an empty library is the hero, not a no-match line.
    test('guard: an empty library with an empty query shows no no-match line', async () => {
        DBState.db = buildDb(emptyLibrary())

        await withMounted((target) => {
            for (const layout of [SIMPLE, GRID, LIST] as const) {
                clickLayoutButton(target, layout)
                expect(hasText(target, language.libraryNoMatch), `layout ${layout}`).toBe(false)
            }
        })
    })

    // The empty check follows the unfiltered list: a query over an empty library never changes which
    // state shows.
    test('a query over an empty library still shows the hero and no no-match line', async () => {
        DBState.db = buildDb(emptyLibrary())

        await withMounted((target) => {
            clickLayoutButton(target, SIMPLE)
            setSearchValue(target, 'zzz')
            expect(target.querySelector(HERO)).not.toBeNull()
            expect(hasText(target, language.libraryNoMatch)).toBe(false)
        })
    })
})

describe('GridCatalog no search match', { timeout: 60_000 }, () => {
    // T31: reproducer.
    test.each([
        ['simple', SIMPLE],
        ['grid', GRID],
        ['list', LIST],
    ] as const)('the %s layout shows the no-match line for a query that matches nothing', async (_label, layout) => {
        DBState.db = buildDb(threeCharacters())

        await withMounted((target) => {
            clickLayoutButton(target, layout)
            setSearchValue(target, 'zzz')
            expect(hasText(target, language.libraryNoMatch)).toBe(true)
        })
    })

    // T33: guard.
    test('guard: a non-empty library shows no hero and, without a query, no no-match line', async () => {
        DBState.db = buildDb(threeCharacters())

        await withMounted((target) => {
            for (const layout of [SIMPLE, GRID, LIST] as const) {
                clickLayoutButton(target, layout)
                expect(target.querySelector(HERO), `layout ${layout}`).toBeNull()
                expect(hasText(target, language.libraryNoMatch), `layout ${layout}`).toBe(false)
                setSearchValue(target, 'zzz')
                expect(target.querySelector(HERO), `layout ${layout} searching`).toBeNull()
                setSearchValue(target, '')
            }
        })
    })

    // The line follows the landed query, so a whitespace-only query is not a search.
    test('guard: a whitespace-only query shows no no-match line', async () => {
        DBState.db = buildDb(threeCharacters())

        await withMounted((target) => {
            clickLayoutButton(target, SIMPLE)
            setSearchValue(target, '   ')
            expect(hasText(target, language.libraryNoMatch)).toBe(false)
        })
    })

    test('clearing the query removes the no-match line', async () => {
        DBState.db = buildDb(threeCharacters())

        await withMounted((target) => {
            clickLayoutButton(target, LIST)
            setSearchValue(target, 'zzz')
            expect(hasText(target, language.libraryNoMatch)).toBe(true)
            setSearchValue(target, '')
            expect(hasText(target, language.libraryNoMatch)).toBe(false)
        })
    })
})

describe('GridCatalog Trash empties', { timeout: 60_000 }, () => {
    // T32 (first): reproducer.
    test('Trash with nothing trashed shows trashEmpty', async () => {
        DBState.db = buildDb(threeCharacters())

        await withMounted((target) => {
            clickLayoutButton(target, TRASH)
            expect(hasText(target, language.trashEmpty)).toBe(true)
            expect(hasText(target, language.libraryNoMatch)).toBe(false)
            expect(target.querySelector(HERO)).toBeNull()
        })
    })

    // T32 (second): reproducer.
    test('Trash with a search that hides every trashed row shows libraryNoMatch', async () => {
        DBState.db = buildDb([makeCharacter('a-id', 'Alice'), makeCharacter('gone-id', 'Gone', { trashTime: Date.now() - 1000 })])

        await withMounted((target) => {
            clickLayoutButton(target, TRASH)
            expect(Array.from(target.querySelectorAll('h4')).map((h) => h.textContent?.trim())).toEqual(['Gone'])
            setSearchValue(target, 'zzz')
            expect(target.querySelectorAll('h4').length).toBe(0)
            expect(hasText(target, language.libraryNoMatch)).toBe(true)
            expect(hasText(target, language.trashEmpty)).toBe(false)
            expect(target.querySelector(HERO)).toBeNull()
        })
    })

    test('guard: Trash with a visible row shows neither line', async () => {
        DBState.db = buildDb([makeCharacter('a-id', 'Alice'), makeCharacter('gone-id', 'Gone', { trashTime: Date.now() - 1000 })])

        await withMounted((target) => {
            clickLayoutButton(target, TRASH)
            expect(hasText(target, language.trashEmpty)).toBe(false)
            expect(hasText(target, language.libraryNoMatch)).toBe(false)
        })
    })
})

describe('GridCatalog hero selection closes the screen', { timeout: 60_000 }, () => {
    // T34: reproducer.
    test('Create in the hero selects the new character and calls endGrid', async () => {
        DBState.db = buildDb(emptyLibrary())
        createNewCharacterSpy.mockReturnValue(2)
        changeCharSpy.mockResolvedValue('selected')

        await withMounted(async (target, endGrid) => {
            clickLayoutButton(target, SIMPLE)
            createButton(target).click()
            await vi.waitFor(() => expect(endGrid).toHaveBeenCalledTimes(1))
            expect(createNewCharacterSpy).toHaveBeenCalledTimes(1)
            expect(changeCharSpy).toHaveBeenCalledWith(2)
        })
    })

    test('a create whose selection did not happen leaves the screen open', async () => {
        DBState.db = buildDb(emptyLibrary())
        createNewCharacterSpy.mockReturnValue(2)
        changeCharSpy.mockResolvedValue('busy')

        await withMounted(async (target, endGrid) => {
            clickLayoutButton(target, SIMPLE)
            createButton(target).click()
            await vi.waitFor(() => expect(changeCharSpy).toHaveBeenCalledTimes(1))
            await settle()
            expect(endGrid).not.toHaveBeenCalled()
        })
    })

    test('Import in the hero selects the added last slot and calls endGrid', async () => {
        DBState.db = buildDb(emptyLibrary())
        importCharacterSpy.mockImplementation(async () => {
            DBState.db.characters.push(makeCharacter('imp-id', 'Imported'))
        })
        changeCharSpy.mockResolvedValue('selected')

        await withMounted(async (target, endGrid) => {
            clickLayoutButton(target, SIMPLE)
            const lastSlot = DBState.db.characters.length
            importButton(target).click()
            await vi.waitFor(() => expect(endGrid).toHaveBeenCalledTimes(1))
            expect(importCharacterSpy).toHaveBeenCalledTimes(1)
            expect(changeCharSpy).toHaveBeenCalledWith(lastSlot)
        })
    })

    test('an import that is cancelled or adds nothing leaves the screen open', async () => {
        DBState.db = buildDb(emptyLibrary())
        importCharacterSpy.mockResolvedValue(undefined)
        changeCharSpy.mockResolvedValue('selected')

        await withMounted(async (target, endGrid) => {
            clickLayoutButton(target, SIMPLE)
            importButton(target).click()
            await vi.waitFor(() => expect(importCharacterSpy).toHaveBeenCalledTimes(1))
            await settle()
            expect(changeCharSpy).not.toHaveBeenCalled()
            expect(endGrid).not.toHaveBeenCalled()
        })
    })

    test('an import whose selection did not happen leaves the screen open', async () => {
        DBState.db = buildDb(emptyLibrary())
        importCharacterSpy.mockImplementation(async () => {
            DBState.db.characters.push(makeCharacter('imp-id', 'Imported'))
        })
        changeCharSpy.mockResolvedValue('busy')

        await withMounted(async (target, endGrid) => {
            clickLayoutButton(target, SIMPLE)
            importButton(target).click()
            await vi.waitFor(() => expect(changeCharSpy).toHaveBeenCalledTimes(1))
            await settle()
            expect(endGrid).not.toHaveBeenCalled()
        })
    })
})
