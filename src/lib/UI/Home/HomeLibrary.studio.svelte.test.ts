// @vitest-environment happy-dom

/**
 * `HomeLibrary.svelte`, Open in Studio from the library (stage G2). HomeLibrary is the one host that
 * passes the `studio` prop to `GridCatalog`, wired to `homeStudioAvailable` and `startStudioFromHome`
 * (T14, T15, T17); the library cancels a pending open when it unmounts (`cancelHomeStudioOpen`, T37a); the library reopens on the remembered tab after a visit (T18, the real `gridMemory`);
 * and a mounted library takes the return-focus request that ends a visit and focuses the character's
 * control, else the library Back button, never `body` (T19).
 *
 * Test labels: `(F)` is new behaviour (fails on the code before the stage by assertion), `(G)` is a
 * compatibility guard that may pass before and after.
 *
 * MOCKED: the module set of `HomeLibrary.svelte.test.ts` (same directory), with `homeStudio.svelte` a pair
 * of spies. The mechanism itself is tested in `homeStudio.svelte.test.ts`. `homeView` is real. happy-dom has
 * no layout, so every element reports a 312 px width.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database, character, groupChat } from '../../../ts/storage/database.svelte'
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

const { changeCharSpy, availableSpy, openSpy, cancelSpy } = vi.hoisted(() => ({
    changeCharSpy: vi.fn(),
    availableSpy: vi.fn<(slot: unknown) => boolean>(),
    openSpy: vi.fn<(index: number, opener: HTMLElement) => boolean>(),
    cancelSpy: vi.fn<() => void>(),
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
    const { DBState } = await import('../../../ts/stores.svelte')
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

vi.mock(import('../../../ts/characters'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        changeChar: changeCharSpy,
    }
})

vi.mock(import('../../../ts/media/avatarThumb'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        getAvatarThumbSrc: vi.fn(async () => null),
    }
})

vi.mock(import('./homeStudio.svelte'), () => ({
    homeStudioAvailable: availableSpy,
    startStudioFromHome: openSpy,
    cancelHomeStudioOpen: cancelSpy,
    resetHomeStudioForTests: vi.fn(),
}) as unknown as typeof import('./homeStudio.svelte'))

//#endregion

Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 312 })

import { DBState } from '../../../ts/stores.svelte'
import { resetBackHandlersForTests } from '../../../ts/backHandlers'
import { language } from '../../../lang'
import { LIBRARY_TAB_KEY } from '../../Others/gridMemory'
import { openHomeLibrary, requestHomeReturnFocus, showHomeLanding, takeHomeReturnFocus } from './homeView.svelte'
import HomeLibrary from './HomeLibrary.svelte'

//#region fixtures and helpers

type CharacterFixture = Database['characters'][number]

function makeCharacter(chaId: string, name: string, lastInteraction: number): CharacterFixture {
    return {
        chaId,
        name,
        type: 'character',
        image: '',
        creatorNotes: '',
        chatPage: 0,
        lastInteraction,
        chats: [{ id: `${chaId}-chat`, message: [], note: '', name: '', localLore: [] }],
    } as unknown as CharacterFixture
}

/** Slots a, b, c; the Simple list shows c, b, a (most recent first). */
function installDb(): void {
    const characters = [makeCharacter('a', 'Ann', 1000), makeCharacter('b', 'Bob', 2000), makeCharacter('c', 'Cy', 3000)]
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
}

async function settle(): Promise<void> {
    for (let i = 0; i < 6; i++) {
        flushSync()
        await Promise.resolve()
    }
    await tick()
    flushSync()
}

const buttonByText = (root: ParentNode, text: string): HTMLButtonElement | undefined =>
    Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.trim() === text.trim())

function clickButton(root: ParentNode, text: string): void {
    const button = buttonByText(root, text)
    if (!button) {
        throw new Error(`no button "${text}"`)
    }
    button.click()
    flushSync()
}

async function mountLibrary(): Promise<{ target: HTMLElement, close: () => Promise<void> }> {
    openHomeLibrary()
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(HomeLibrary, { target }) as Record<string, unknown>
    await settle()
    return {
        target,
        close: async () => {
            await unmount(app as never)
            target.remove()
        },
    }
}

async function withLibrary(body: (target: HTMLElement) => void | Promise<void>): Promise<void> {
    const library = await mountLibrary()
    try {
        await body(library.target)
    } finally {
        await library.close()
    }
}

const studioButtons = (root: ParentNode): HTMLButtonElement[] =>
    Array.from(root.querySelectorAll<HTMLButtonElement>('[data-part="library-studio"]'))
const studioButtonOf = (root: ParentNode, chaId: string): HTMLButtonElement | undefined =>
    studioButtons(root).find((button) => button.getAttribute('data-cha-id') === chaId)
const pressedTabs = (root: ParentNode): string[] =>
    [language.simple, language.grid, language.list, language.trash].filter((label) => buttonByText(root, label)?.getAttribute('aria-pressed') === 'true')

beforeEach(() => {
    localStorage.clear()
    changeCharSpy.mockReset()
    availableSpy.mockReset()
    availableSpy.mockReturnValue(true)
    openSpy.mockReset()
    openSpy.mockReturnValue(true)
    cancelSpy.mockReset()
    showHomeLanding()
    // A request left over from another test must not reach this one.
    takeHomeReturnFocus()
    resetBackHandlersForTests()
    installDb()
    vi.stubGlobal('ResizeObserver', undefined)
})

afterEach(() => {
    vi.unstubAllGlobals()
    takeHomeReturnFocus()
    resetBackHandlersForTests()
    showHomeLanding()
    document.body.replaceChildren()
})

//#endregion

describe('HomeLibrary: the studio controls', { timeout: 60_000 }, () => {
    test('(F) T15 the Simple tab gets a control per available character, and a click opens that slot through Home', async () => {
        await withLibrary(async (target) => {
            clickButton(target, language.simple)
            await settle()
            expect(studioButtons(target).map((button) => button.getAttribute('data-cha-id'))).toEqual(['c', 'b', 'a'])
            const bob = studioButtonOf(target, 'b')!
            bob.click()
            await settle()
            expect(openSpy).toHaveBeenCalledTimes(1)
            expect(openSpy.mock.calls[0][0]).toBe(1)
            expect(openSpy.mock.calls[0][1]).toBe(bob)
            expect(changeCharSpy).not.toHaveBeenCalled()
        })
    })

    test('(F) T14 the List tab gets the same controls', async () => {
        await withLibrary(async (target) => {
            clickButton(target, language.list)
            await settle()
            expect(studioButtons(target).map((button) => button.getAttribute('data-cha-id')).sort()).toEqual(['a', 'b', 'c'])
            studioButtonOf(target, 'a')!.click()
            await settle()
            expect(openSpy.mock.calls.map((call) => call[0])).toEqual([0])
        })
    })

    test('(F) T17 availability is Home\'s `homeStudioAvailable` on the slot: an unavailable character has no control in either tab', async () => {
        availableSpy.mockImplementation((slot) => (slot as character | groupChat | undefined)?.chaId !== 'b')
        await withLibrary(async (target) => {
            clickButton(target, language.simple)
            await settle()
            expect(studioButtons(target).map((button) => button.getAttribute('data-cha-id'))).toEqual(['c', 'a'])
            clickButton(target, language.list)
            await settle()
            expect(studioButtons(target).map((button) => button.getAttribute('data-cha-id')).sort()).toEqual(['a', 'c'])
        })
    })

    test('(F) T17 nothing is available (the switch off, Beta Mobile GUI): no control anywhere', async () => {
        availableSpy.mockReturnValue(false)
        await withLibrary(async (target) => {
            clickButton(target, language.simple)
            await settle()
            expect(studioButtons(target)).toEqual([])
            clickButton(target, language.list)
            await settle()
            expect(studioButtons(target)).toEqual([])
        })
    })
})

describe('HomeLibrary: an open still loading', { timeout: 60_000 }, () => {
    test('(F) T37a unmounting the library cancels the pending open once, and mounting or using it cancels nothing', async () => {
        const library = await mountLibrary()
        clickButton(library.target, language.simple)
        await settle()
        studioButtons(library.target)[0].click()
        await settle()
        expect(cancelSpy).not.toHaveBeenCalled()

        await library.close()

        expect(cancelSpy).toHaveBeenCalledTimes(1)
    })
})

describe('HomeLibrary: the remembered tab', { timeout: 60_000 }, () => {
    for (const [name, label] of [['list', () => language.list], ['simple', () => language.simple]] as const) {
        test(`(F) T18 a visit opened from ${name} reopens the library on ${name}`, async () => {
            const first = await mountLibrary()
            clickButton(first.target, label())
            await settle()
            expect(studioButtons(first.target).length).toBeGreaterThan(0)
            studioButtons(first.target)[0].click()
            await settle()
            expect(openSpy).toHaveBeenCalledTimes(1)
            await first.close()

            // The library of the return is a fresh mount; the real `gridMemory` brings back the tab.
            expect(localStorage.getItem(LIBRARY_TAB_KEY)).toBe(name)
            const second = await mountLibrary()
            try {
                expect(pressedTabs(second.target)).toEqual([label()])
                expect(studioButtons(second.target).length).toBeGreaterThan(0)
            } finally {
                await second.close()
            }
        })
    }
})

describe('HomeLibrary: focus after a visit', { timeout: 60_000 }, () => {
    test('(F) T19a the character\'s control takes the focus when it is rendered', async () => {
        localStorage.setItem(LIBRARY_TAB_KEY, 'list')
        requestHomeReturnFocus('b')
        await withLibrary(async (target) => {
            await tick()
            await settle()
            expect(document.activeElement).not.toBe(document.body)
            expect(document.activeElement).toBe(studioButtonOf(target, 'b'))
        })
    })

    test('(F) T19a the Simple tab\'s control takes the focus the same way', async () => {
        localStorage.setItem(LIBRARY_TAB_KEY, 'simple')
        requestHomeReturnFocus('a')
        await withLibrary(async (target) => {
            await settle()
            expect(document.activeElement).toBe(studioButtonOf(target, 'a'))
        })
    })

    test('(F) T19a the library Back button takes the focus when the control is not rendered (the Grid tab, a gone character)', async () => {
        localStorage.setItem(LIBRARY_TAB_KEY, 'grid')
        requestHomeReturnFocus('b')
        await withLibrary(async (target) => {
            await settle()
            expect(document.activeElement).not.toBe(document.body)
            expect(document.activeElement).toBe(target.querySelector('[data-part="library-back"]'))
        })
        takeHomeReturnFocus()
        localStorage.setItem(LIBRARY_TAB_KEY, 'list')
        requestHomeReturnFocus('gone')
        await withLibrary(async (target) => {
            await settle()
            expect(document.activeElement).toBe(target.querySelector('[data-part="library-back"]'))
        })
    })

    test('(F) T19a a chaId with selector characters finds its control by attribute value, not as markup', async () => {
        const odd = '"] [x'
        DBState.db.characters.push(makeCharacter(odd, 'Odd', 4000))
        DBState.db.characterOrder.push(odd)
        localStorage.setItem(LIBRARY_TAB_KEY, 'list')
        requestHomeReturnFocus(odd)
        await withLibrary(async (target) => {
            await settle()
            expect(document.activeElement).toBe(studioButtonOf(target, odd))
        })
    })

    test('(F) T19b a request made before the library exists waits for it: nothing is focused first, the control is focused on mount', async () => {
        localStorage.setItem(LIBRARY_TAB_KEY, 'list')
        requestHomeReturnFocus('c')
        // The library chunk is still loading: no library, so nothing to focus and nothing thrown.
        await settle()
        expect(document.activeElement).toBe(document.body)
        await withLibrary(async (target) => {
            await settle()
            expect(document.activeElement).toBe(studioButtonOf(target, 'c'))
        })
    })

    test('(G) T19 the request is taken once: a later library mount moves no focus', async () => {
        localStorage.setItem(LIBRARY_TAB_KEY, 'list')
        requestHomeReturnFocus('b')
        await withLibrary(async () => {
            await settle()
        })
        expect(takeHomeReturnFocus()).toBeNull()
        document.body.replaceChildren()
        await withLibrary(async () => {
            await settle()
            expect(document.activeElement).toBe(document.body)
        })
    })

    test('(G) T19 with no request a mount moves no focus', async () => {
        await withLibrary(async () => {
            await settle()
            expect(document.activeElement).toBe(document.body)
        })
    })
})
