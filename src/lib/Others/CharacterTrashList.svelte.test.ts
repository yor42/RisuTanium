// @vitest-environment happy-dom

/**
 * `CharacterTrashList.svelte`: the trash header (description and Empty trash)
 * and the trashed rows shared by GridCatalog's Trash tab and the mobile trash
 * view. It lists exactly the characters of the search result it is given,
 * restores and deletes the row's own character, and hands Empty trash the rows on
 * screen at the click. Which rows are mounted for a long list is covered by
 * `CharacterTrashList.window.svelte.test.ts`.
 *
 * MOCKED: the module set of `MobileCharacters.trash.svelte.test.ts`
 * (`src/lib/Mobile`); the search result is a plain object with the three
 * properties the list reads. Nothing here writes to storage.
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

const { changeCharSpy, restoreSpy, removeCharSpy, removeTrashedSpy, parseSpy } = vi.hoisted(() => ({
    parseSpy: vi.fn(async (text: string) => `<p>${text}</p><img src="https://example.com/a.png">`),
    changeCharSpy: vi.fn(),
    restoreSpy: vi.fn(),
    removeCharSpy: vi.fn(),
    removeTrashedSpy: vi.fn(),
}))

vi.mock(import('src/ts/parser/parser.svelte'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        ParseMarkdown: parseSpy,
    }
})

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

import { DBState } from '../../ts/stores.svelte'
import { clearDescriptionCache } from '../../ts/gui/descriptionMarkdown'
import { language } from '../../lang'
import type { CharacterSearch } from '../../ts/gui/characterSearch.svelte'
import CharacterTrashList from './CharacterTrashList.svelte'

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
        trashTime: GONE,
        ...extra,
    } as unknown as CharacterFixture
}

function buildDb(characters: CharacterFixture[]): Database {
    return { characters, hideAllImages: false } as unknown as Database
}

function resultFor(indices: number[], searching = false): CharacterSearch {
    return {
        trash: indices.map((index) => ({ index, chaId: DBState.db.characters[index].chaId })),
        searching,
        query: '',
    } as unknown as CharacterSearch
}

async function settle(): Promise<void> {
    for (let i = 0; i < 4; i++) {
        flushSync()
        await Promise.resolve()
    }
    flushSync()
}

async function withMounted(found: CharacterSearch, body: (target: HTMLElement) => void | Promise<void>): Promise<void> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(CharacterTrashList, { target, props: { found } }) as Record<string, unknown>
    try {
        await settle()
        await body(target)
    } finally {
        await unmount(app as never)
        target.remove()
    }
}

function buttonWith(root: HTMLElement, text: string): HTMLButtonElement | undefined {
    return Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.trim() === text)
}

beforeEach(() => {
    changeCharSpy.mockClear()
    restoreSpy.mockClear()
    removeCharSpy.mockClear()
    removeTrashedSpy.mockClear()
    parseSpy.mockClear()
    clearDescriptionCache()
})

//#endregion

describe('CharacterTrashList', { timeout: 60_000 }, () => {
    test('lists the given trashed characters with the trash description and the plain Empty trash label', async () => {
        DBState.db = buildDb([makeCharacter('a', 'Ann'), makeCharacter('b', 'Bob'), makeCharacter('c', 'Cat')])

        await withMounted(resultFor([0, 2]), (target) => {
            expect(Array.from(target.querySelectorAll('h4')).map((h) => h.textContent?.trim())).toEqual(['Ann', 'Cat'])
            expect(target.textContent).toContain(language.trashDesc)
            expect(buttonWith(target, language.emptyTrash)).toBeDefined()
        })
    })

    test('shows no Empty trash button when nothing is listed, and still shows the description', async () => {
        DBState.db = buildDb([makeCharacter('a', 'Ann')])

        await withMounted(resultFor([]), (target) => {
            expect(target.querySelector('h4')).toBeNull()
            expect(target.textContent).toContain(language.trashDesc)
            expect(target.querySelectorAll('button').length).toBe(0)
        })
    })

    test('while searching, the button says "matching" and hands over the shown rows with matching: true', async () => {
        DBState.db = buildDb([makeCharacter('a', 'Ann'), makeCharacter('b', 'Bob')])

        await withMounted(resultFor([1], true), (target) => {
            buttonWith(target, language.emptyTrashMatching(1))!.click()
            const [refs, options] = removeTrashedSpy.mock.calls[0]
            expect(refs).toEqual([DBState.db.characters[1]])
            expect(options).toEqual({ matching: true })
        })
    })

    // Guard: passes before and after.
    test('guard: restore and delete permanently act on the row\'s own character', async () => {
        DBState.db = buildDb([makeCharacter('a', 'Ann'), makeCharacter('b', 'Bob')])

        await withMounted(resultFor([1]), (target) => {
            const actions = target.querySelectorAll<HTMLButtonElement>('.justify-end button')
            actions[0].click()
            expect(restoreSpy).toHaveBeenCalledWith(DBState.db.characters[1])
            actions[1].click()
            expect(removeCharSpy).toHaveBeenCalledWith(DBState.db.characters[1], 'Bob', 'permanent')
        })
    })

    test('a trashed row does not open on a click: the avatar is not a button and the row has only restore and delete', async () => {
        DBState.db = buildDb([makeCharacter('a', 'Ann'), makeCharacter('b', 'Bob')])

        await withMounted(resultFor([1]), (target) => {
            const avatar = target.querySelector<HTMLElement>('.ico')!
            expect(avatar.tagName).not.toBe('BUTTON')
            avatar.click()
            target.querySelector<HTMLElement>('h4')!.click()
            expect(changeCharSpy).not.toHaveBeenCalled()
            const rowButtons = Array.from(target.querySelectorAll('button')).filter((b) => b.closest('.justify-end'))
            expect(rowButtons.length).toBe(2)
            expect(target.querySelectorAll('button').length).toBe(3)
        })
    })

    test('a row near the viewport shows its description as markdown without media, clamped and without a Show more toggle', async () => {
        DBState.db = buildDb([makeCharacter('a', 'Ann', { creatorNotes: 'LONG **bold** text' })])

        await withMounted(resultFor([0]), async (target) => {
            await settle()
            await new Promise((resolve) => setTimeout(resolve, 0))
            await settle()
            const description = target.querySelector<HTMLElement>('[data-description]')!
            expect(description.querySelector('p')?.textContent).toBe('LONG **bold** text')
            expect(description.querySelector('img')).toBeNull()
            expect(description.classList.contains('max-h-18')).toBe(true)
            expect(Array.from(target.querySelectorAll('button')).some((b) => /^Show (more|less)$/.test(b.textContent?.trim() ?? ''))).toBe(false)
        })
    })

    test('a click on a link in a trashed description does not open the character', async () => {
        parseSpy.mockImplementationOnce(async () => '<p><a href="https://example.com">link</a></p>')
        DBState.db = buildDb([makeCharacter('a', 'Ann', { creatorNotes: 'x' })])

        await withMounted(resultFor([0]), async (target) => {
            await settle()
            await new Promise((resolve) => setTimeout(resolve, 0))
            await settle()
            const event = new MouseEvent('click', { bubbles: true, cancelable: true })
            target.querySelector('a')!.dispatchEvent(event)
            expect(changeCharSpy).not.toHaveBeenCalled()
            expect(event.defaultPrevented).toBe(false)
        })
    })
})
