// @vitest-environment happy-dom

/**
 * The trash on the mobile character list. `MobileCharacters.svelte` hides
 * trashed characters by default. With `trashEntry` it offers a "Trash (n)" row
 * (n is the whole trash count, whatever the search) that opens the trash in
 * place with a back row; the open view applies the current search, offers
 * restore, delete permanently and Empty trash, and hides the add-character
 * button so it never covers the last row's actions. Without `trashEntry` (the
 * list embedded in GridCatalog) there is no entry.
 *
 * MOCKED: the module set of `MobileCharacters.search.svelte.test.ts` (same
 * directory), with `changeChar`, `restoreCharacterFromTrash`, `removeChar` and
 * `removeTrashedCharacters` bare spies and the clock faked for
 * `setTimeout`/`clearTimeout` only. Nothing here writes to storage.
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

const { changeCharSpy, restoreSpy, removeCharSpy, removeTrashedSpy } = vi.hoisted(() => ({
    changeCharSpy: vi.fn(),
    restoreSpy: vi.fn(),
    removeCharSpy: vi.fn(),
    removeTrashedSpy: vi.fn(),
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
        restoreCharacterFromTrash: restoreSpy,
        removeChar: removeCharSpy,
        removeTrashedCharacters: removeTrashedSpy,
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

import { DBState, MobileSearch } from '../../ts/stores.svelte'
import { language } from '../../lang'
import MobileCharacters from './MobileCharacters.svelte'

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

async function withMounted(props: { hideTrash?: boolean; search?: string; trashEntry?: boolean }, body: (target: HTMLElement) => void | Promise<void>): Promise<void> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(MobileCharacters, { target, props }) as Record<string, unknown>
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

function buttonWith(root: HTMLElement, text: string): HTMLButtonElement | undefined {
    return Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.includes(text))
}

const trashEntryLabel = (n: number) => `${language.trash} (${n})`

function trashRowNames(root: HTMLElement): string[] {
    return Array.from(root.querySelectorAll('h4')).map((h) => h.textContent?.trim() ?? '')
}

function addButton(root: HTMLElement): Element | null {
    return root.querySelector('button.absolute')
}

async function openTrash(root: HTMLElement): Promise<void> {
    buttonWith(root, trashEntryLabel(2))!.click()
    await settle()
}

beforeEach(() => {
    changeCharSpy.mockClear()
    restoreSpy.mockClear()
    removeCharSpy.mockClear()
    removeTrashedSpy.mockClear()
    MobileSearch.set('')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})

afterEach(() => {
    vi.useRealTimers()
})

//#endregion

describe('MobileCharacters: the trash is hidden by default', { timeout: 60_000 }, () => {
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

describe('MobileCharacters: the Trash (n) row', { timeout: 60_000 }, () => {
    test('shows the whole trash count as the first row and opens no trash view until clicked', async () => {
        DBState.db = buildDb(standard())

        await withMounted({ trashEntry: true }, (target) => {
            expect(buttonWith(target, trashEntryLabel(2))).toBeDefined()
            expect(target.querySelector('h4')).toBeNull()
            expect(rowNames(target)).toEqual(['Ann', 'Bob'])
        })
    })

    test('is absent when the trash is empty', async () => {
        DBState.db = buildDb([makeCharacter('a', 'Ann')])

        await withMounted({ trashEntry: true }, (target) => {
            expect(buttonWith(target, language.trash)).toBeUndefined()
        })
    })

    test('does not count hidden system characters', async () => {
        DBState.db = buildDb([makeCharacter('a', 'Ann'), makeCharacter('§playground', 'assistant', { trashTime: GONE })])

        await withMounted({ trashEntry: true }, (target) => {
            expect(buttonWith(target, language.trash)).toBeUndefined()
        })
    })

    // Guard: passes before and after; the embedded list has its own Trash tab.
    test('guard: without trashEntry there is no Trash row', async () => {
        DBState.db = buildDb(standard())

        await withMounted({}, (target) => {
            expect(buttonWith(target, language.trash)).toBeUndefined()
        })
    })

    test('keeps the whole count while a search narrows the list', async () => {
        DBState.db = buildDb(standard())

        await withMounted({ trashEntry: true }, async (target) => {
            MobileSearch.set('ann')
            await settle()
            vi.advanceTimersByTime(150)
            await settle()
            expect(rowNames(target)).toEqual(['Ann'])
            expect(buttonWith(target, trashEntryLabel(2))).toBeDefined()
        })
    })

    test('follows the trash: it appears when a character is trashed and goes when the last is restored', async () => {
        DBState.db = buildDb([makeCharacter('a', 'Ann'), makeCharacter('b', 'Bob')])

        await withMounted({ trashEntry: true }, async (target) => {
            expect(buttonWith(target, language.trash)).toBeUndefined()
            DBState.db.characters[0].trashTime = GONE
            await settle()
            expect(buttonWith(target, trashEntryLabel(1))).toBeDefined()
            DBState.db.characters[0].trashTime = undefined
            await settle()
            expect(buttonWith(target, language.trash)).toBeUndefined()
        })
    })
})

describe('MobileCharacters: the open trash view', { timeout: 60_000 }, () => {
    test('replaces the list with the trashed characters and a back row, and hides the add button', async () => {
        DBState.db = buildDb(standard())

        await withMounted({ trashEntry: true }, async (target) => {
            expect(addButton(target)).not.toBeNull()
            await openTrash(target)
            expect(trashRowNames(target).sort()).toEqual(['Cara', 'Cat'])
            expect(rowNames(target)).toEqual([])
            expect(buttonWith(target, language.settingsPage.back)).toBeDefined()
            expect(buttonWith(target, language.emptyTrash)).toBeDefined()
            expect(addButton(target)).toBeNull()
        })
    })

    test('back returns to the list with the add button', async () => {
        DBState.db = buildDb(standard())

        await withMounted({ trashEntry: true }, async (target) => {
            await openTrash(target)
            buttonWith(target, language.settingsPage.back)!.click()
            await settle()
            expect(rowNames(target)).toEqual(['Ann', 'Bob'])
            expect(target.querySelector('h4')).toBeNull()
            expect(addButton(target)).not.toBeNull()
        })
    })

    test('applies the current search to the trashed rows and the Empty trash label', async () => {
        DBState.db = buildDb(standard())

        await withMounted({ trashEntry: true }, async (target) => {
            await openTrash(target)
            MobileSearch.set('cat')
            await settle()
            vi.advanceTimersByTime(150)
            await settle()
            expect(trashRowNames(target)).toEqual(['Cat'])
            expect(buttonWith(target, language.emptyTrashMatching(1))).toBeDefined()
        })
    })

    test('restore and delete permanently act on the row\'s own character', async () => {
        DBState.db = buildDb(standard())

        await withMounted({ trashEntry: true }, async (target) => {
            await openTrash(target)
            const rowButtons = Array.from(target.querySelectorAll('h4'))
                .find((h) => h.textContent?.trim() === 'Cat')!
                .parentElement!.querySelectorAll<HTMLButtonElement>('.justify-end button')
            rowButtons[0].click()
            expect(restoreSpy).toHaveBeenCalledWith(DBState.db.characters[2])
            rowButtons[1].click()
            expect(removeCharSpy).toHaveBeenCalledWith(DBState.db.characters[2], 'Cat', 'permanent')
        })
    })

    test('a trashed row does not open on a click: the avatar and the name do nothing', async () => {
        DBState.db = buildDb(standard())

        await withMounted({ trashEntry: true }, async (target) => {
            await openTrash(target)
            const avatars = Array.from(target.querySelectorAll<HTMLElement>('.ico'))
            expect(avatars.length).toBe(2)
            for (const avatar of avatars) {
                avatar.click()
            }
            for (const heading of Array.from(target.querySelectorAll('h4'))) {
                heading.click()
            }
            expect(changeCharSpy).not.toHaveBeenCalled()
        })
    })

    test('Empty trash hands over exactly the shown trashed characters', async () => {
        DBState.db = buildDb(standard())

        await withMounted({ trashEntry: true }, async (target) => {
            await openTrash(target)
            buttonWith(target, language.emptyTrash)!.click()
            expect(removeTrashedSpy).toHaveBeenCalledTimes(1)
            const [refs, options] = removeTrashedSpy.mock.calls[0]
            expect((refs as CharacterFixture[]).map((c) => c.name).sort()).toEqual(['Cara', 'Cat'])
            expect(options).toEqual({ matching: false })
        })
    })

    test('when the last trashed character is restored while open, the view shows the empty trash and keeps the back row', async () => {
        DBState.db = buildDb([makeCharacter('a', 'Ann'), makeCharacter('c', 'Cat', { trashTime: GONE })])

        await withMounted({ trashEntry: true }, async (target) => {
            buttonWith(target, trashEntryLabel(1))!.click()
            await settle()
            expect(trashRowNames(target)).toEqual(['Cat'])
            DBState.db.characters[1].trashTime = undefined
            await settle()
            expect(trashRowNames(target)).toEqual([])
            expect(buttonWith(target, language.emptyTrash)).toBeUndefined()
            expect(buttonWith(target, language.settingsPage.back)).toBeDefined()
            expect(target.textContent).toContain(language.trashDesc)
        })
    })
})
