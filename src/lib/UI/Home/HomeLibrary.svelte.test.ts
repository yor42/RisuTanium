// @vitest-environment happy-dom

/**
 * `HomeLibrary.svelte`: the character library shown inside Home. It is the unchanged
 * `GridCatalog` with two Home-owned behaviours: picking a character writes the selection once and
 * then returns Home to the landing view, and the library is one Back step (above the landing,
 * below GridCatalog's own edit-mode step and every dialog or cover).
 *
 * MOCKED: the module set of `GridCatalog.edit.svelte.test.ts` (`src/lib/Others`), with `changeChar`
 * a spy that writes the selection like the real one. The back registry, the alert store and the
 * quit guard are real. happy-dom has no layout, so every element reports a 312 px width.
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

const { changeCharSpy, removeCharSpy, registerSpy } = vi.hoisted(() => ({
    changeCharSpy: vi.fn(),
    removeCharSpy: vi.fn(),
    registerSpy: vi.fn(),
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
        removeChar: removeCharSpy,
    }
})

vi.mock(import('../../../ts/media/avatarThumb'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        getAvatarThumbSrc: vi.fn(async () => null),
    }
})

vi.mock(import('../../../ts/backHandlers'), async (importOriginal) => {
    const actual = await importOriginal()
    registerSpy.mockImplementation(actual.registerBackHandler)
    return { ...actual, registerBackHandler: registerSpy }
})

//#endregion

Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 312 })

import { alertStore, DBState, OpenRealmStore, selectedCharID } from '../../../ts/stores.svelte'
import type { alertData } from '../../../ts/alert'
import { dispatchBack, installBackGuard, registerBackHandler, resetBackHandlersForTests } from '../../../ts/backHandlers'
import { resetAlertPromptsForTests } from '../../../ts/alertPrompts'
import { language } from '../../../lang'
import { homeView, openHomeLibrary, showHomeLanding } from './homeView.svelte'
import HomeLibrary from './HomeLibrary.svelte'

//#region fixtures and helpers

type CharacterFixture = Database['characters'][number]

function makeCharacter(chaId: string, name: string): CharacterFixture {
    return {
        chaId,
        name,
        type: 'character',
        image: '',
        creatorNotes: '',
        chatPage: 0,
        lastInteraction: 0,
        chats: [{ id: `${chaId}-chat`, message: [], note: '', name: '', localLore: [] }],
    } as unknown as CharacterFixture
}

function installDb(): void {
    const characters = [makeCharacter('a', 'Ann'), makeCharacter('b', 'Bob')]
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
    flushSync()
}

async function withLibrary(body: (target: HTMLElement) => void | Promise<void>): Promise<void> {
    openHomeLibrary()
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(HomeLibrary, { target }) as Record<string, unknown>
    try {
        await settle()
        await body(target)
    } finally {
        await unmount(app as never)
        target.remove()
    }
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

const isEditing = (root: ParentNode): boolean => buttonByText(root, language.othersUi.editDone) !== undefined

const showToast = vi.fn()
let selectionLog: string[] = []
let unsubscribeSelection: (() => void) | null = null

beforeEach(() => {
    localStorage.clear()
    changeCharSpy.mockReset()
    removeCharSpy.mockReset()
    showToast.mockReset()
    showHomeLanding()
    resetBackHandlersForTests()
    installBackGuard({ showToast })
    installDb()
    selectedCharID.set(-1)
    OpenRealmStore.set(false)
    selectionLog = []
    // The mock writes the selection like the real one and records the Home view at that moment.
    changeCharSpy.mockImplementation((index: number) => {
        selectedCharID.set(index)
        selectionLog.push(`selectedCharID=${index}, view=${homeView.view}`)
    })
    let first = true
    unsubscribeSelection = selectedCharID.subscribe((value) => {
        if (first) {
            first = false
            return
        }
        selectionLog.push(`write:${value}`)
    })
    registerSpy.mockClear()
})

afterEach(() => {
    unsubscribeSelection?.()
    resetAlertPromptsForTests()
    alertStore.set({ type: 'none', msg: '' })
    resetBackHandlersForTests()
    showHomeLanding()
})

//#endregion

describe('HomeLibrary: picking and leaving', () => {
    test('(F) a pick writes the selection once, before the view returns to the landing', async () => {
        await withLibrary(async (target) => {
            clickButton(target, language.simple)
            await settle()
            const row = Array.from(target.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.includes('Bob'))!
            row.click()
            await settle()
            expect(changeCharSpy.mock.calls).toEqual([[1]])
            expect(selectionLog).toEqual(['write:1', 'selectedCharID=1, view=library'])
            expect(get(selectedCharID)).toBe(1)
            expect(homeView.view).toBe('landing')
        })
    })

    test('(F) the back arrow returns to the landing without a selection write', async () => {
        await withLibrary(async (target) => {
            const back = target.querySelector<HTMLButtonElement>(`button[title="${language.settingsPage.back}"]`)
            expect(back).toBeTruthy()
            back!.click()
            await settle()
            expect(homeView.view).toBe('landing')
            expect(selectionLog).toEqual([])
            expect(changeCharSpy).not.toHaveBeenCalled()
        })
    })

    test('(F) the Realm full view opening while the library shows returns to the landing', async () => {
        await withLibrary(async () => {
            OpenRealmStore.set(true)
            await settle()
            expect(homeView.view).toBe('landing')
        })
    })
})

describe('HomeLibrary: Back', () => {
    test('(F) Back leaves the library for the landing without the quit warning; once unmounted Back warns', async () => {
        await withLibrary(async () => {
            expect(dispatchBack()).toBe(true)
            await settle()
            expect(homeView.view).toBe('landing')
            expect(showToast).not.toHaveBeenCalled()
        })
        expect(dispatchBack()).toBe(true)
        expect(showToast).toHaveBeenCalledTimes(1)
    })

    test('(F) Back leaves edit mode first, then the library', async () => {
        await withLibrary(async (target) => {
            clickButton(target, language.grid)
            await settle()
            const edit = buttonByText(target, language.othersUi.editMode)!
            edit.click()
            await settle()
            expect(isEditing(target)).toBe(true)

            expect(dispatchBack()).toBe(true)
            await settle()
            expect(isEditing(target)).toBe(false)
            expect(homeView.view).toBe('library')

            expect(dispatchBack()).toBe(true)
            await settle()
            expect(homeView.view).toBe('landing')
            expect(showToast).not.toHaveBeenCalled()
        })
    })

    test('(F) a dialog covering the page takes the press: the dialog closes and the library stays', async () => {
        await withLibrary(async () => {
            alertStore.set({ type: 'normal', msg: 'hello' } as alertData)
            expect(dispatchBack()).toBe(true)
            await settle()
            expect(get(alertStore).type).toBe('none')
            expect(homeView.view).toBe('library')
            expect(dispatchBack()).toBe(true)
            await settle()
            expect(homeView.view).toBe('landing')
        })
    })

    test('(F) a newer surface (Settings or Studio over Home) takes Back before the library and leaves edit mode alone', async () => {
        await withLibrary(async (target) => {
            clickButton(target, language.grid)
            await settle()
            buttonByText(target, language.othersUi.editMode)!.click()
            await settle()
            const cover = vi.fn(() => true)
            const off = registerBackHandler(cover)
            expect(dispatchBack()).toBe(true)
            expect(cover).toHaveBeenCalledTimes(1)
            expect(isEditing(target)).toBe(true)
            expect(homeView.view).toBe('library')
            off()
        })
    })

    test('(F) the library registers its Back handler once, however often the view changes', async () => {
        await withLibrary(async () => {
            const registered = registerSpy.mock.calls.length
            expect(registered).toBe(1)
            showHomeLanding()
            await settle()
            openHomeLibrary()
            await settle()
            showHomeLanding()
            openHomeLibrary()
            await settle()
            expect(registerSpy.mock.calls.length).toBe(registered)
            expect(dispatchBack()).toBe(true)
            await settle()
            expect(homeView.view).toBe('landing')
        })
    })
})
