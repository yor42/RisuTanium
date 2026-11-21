// @vitest-environment jsdom

/**
 * The return from a Home-opened Studio into the real `HomeShell`: the library is shown whichever order the
 * shell and the close come in. Three creation orders are tested, each served by a different half of the
 * resume: a shell that already exists (the view), a shell created synchronously after the close (the
 * pending intent), and a shell created by the flush the close schedules, with the real Back (the intent
 * again, which must still be set when that flush runs).
 *
 * REAL: `HomeShell`, `MainMenu`, `homeView`, `homeStudio`, `characters.ts` (`changeChar`, `removeChar`),
 * `studioScreen`, `studioBack` and `svelte/store` writables. MOCKED: the module set of
 * `HomeShell.svelte.test.ts` and of `characters.lastInteraction.svelte.test.ts`, because this suite needs both
 * a landing and the real selection path. `HomeLibrary` is the marker stand-in of `HomeShell.svelte.test.ts`.
 * The test host re-creates the shell on the same condition as `DefaultChatScreen`'s Home branch,
 * `selectedCharID < 0`, from an effect root.
 */

import { flushSync, mount, onDestroy, tick, unmount, untrack } from 'svelte'
import { fromStore, get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { UPSTREAM_AGREEMENT_KEY, resetUpstreamAgreementForTests } from 'src/ts/upstreamAgreement'
import { dispatchBack, resetBackHandlersForTests } from 'src/ts/backHandlers'
import type { Database, character } from 'src/ts/storage/database.svelte'

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

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(),
    readFile: vi.fn(),
    BaseDirectory: { AppData: 0 },
}))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({
        db: { hideRealm: false, realmDirectOpen: false, hideAllImages: false } as unknown as Database,
    })
    const selection = $state({ selId: -1 })
    const quickSettings = $state({ open: true })
    const selectedCharID = writable(-1)
    // The app's own first subscriber: `selIdState` is current before any other subscriber runs.
    selectedCharID.subscribe((value) => {
        selection.selId = value
    })
    return {
        DBState: state,
        selIdState: selection,
        selectedCharID,
        OpenRealmStore: writable(false),
        RealmInitialOpenChar: writable(null),
        alertStore: writable({ type: 'none', msg: '' }),
        CharEmotion: writable({}),
        MobileGUIStack: writable([]),
        MobileGUI: writable(false),
        settingsOpen: writable(false),
        DynamicGUI: writable(false),
        sideBarStore: writable(false),
        ShowRealmFrameStore: writable(''),
        ReloadGUIPointer: writable(0),
        ReloadChatPointer: writable({} as Record<number, number>),
        CharConfigSubMenu: writable(0),
        SettingsMenuIndex: writable(-1),
        botMakerMode: writable(false),
        QuickSettings: quickSettings,
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/characterCards'), () => ({
    hubURL: 'https://hub.test',
    getRisuHub: vi.fn(() => new Promise(() => {})),
    importCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    AppendableBuffer: class {},
    changeChatTo: vi.fn(),
    checkCharOrder: vi.fn(),
    downloadFile: vi.fn(),
    getFileSrc: vi.fn(),
    getVersionString: vi.fn(() => 'test-version'),
    openURL: vi.fn(),
    requiresFullEncoderReload: { state: false },
    forageStorage: {
        keys: vi.fn(async () => []),
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => {}),
    },
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock('../Realm/RealmMain.svelte', () => ({
    default: (_target: unknown) => ({ destroy: () => {} }),
}))

vi.mock(import('src/ts/alert'), () => ({
    alertAddCharacter: vi.fn(),
    alertConfirm: vi.fn(async () => true),
    alertError: vi.fn(),
    alertNormal: vi.fn(),
    alertSelect: vi.fn(),
    alertStore: writable({ type: 'none', msg: '' }),
    alertWait: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

// The characters whose Studio control the stand-in draws, as the List tab draws one for a row in view.
const drawnControls = vi.hoisted(() => ({ chaIds: [] as string[] }))
const libraryStub = vi.hoisted(() => (anchor: Comment) => {
    const marker = document.createElement('div')
    marker.setAttribute('data-testid', 'library-stub')
    for (const chaId of drawnControls.chaIds) {
        const control = document.createElement('button')
        control.setAttribute('data-part', 'library-studio')
        control.setAttribute('data-cha-id', chaId)
        marker.appendChild(control)
    }
    anchor.parentNode!.insertBefore(marker, anchor)
    // The stand-in sits at the block's own anchor, so the block would not remove it; remove it with the component.
    onDestroy(() => marker.remove())
})
vi.mock('./HomeLibrary.svelte', () => ({ default: libraryStub }))

vi.mock(import('src/ts/storage/database.svelte'), async () => {
    const { DBState: liveDBState } = await import('src/ts/stores.svelte')
    return {
        getDatabase: vi.fn(() => liveDBState.db),
        setDatabase: vi.fn((db: Database) => { liveDBState.db = db }),
        presetTemplate: { name: 'test-preset' },
        saveImage: vi.fn(),
        defaultSdDataFunc: vi.fn(() => ({})),
        getCharacterByIndex: vi.fn((index: number) => liveDBState.db.characters?.[index]),
        setCharacterByIndex: vi.fn((index: number, char: unknown) => {
            liveDBState.db.characters[index] = char as never
        }),
    } as unknown as typeof import('src/ts/storage/database.svelte')
})

vi.mock(import('src/ts/util'), () => ({
    checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
    findCharacterbyId: vi.fn(),
    findCharacterIndexbyId: vi.fn(() => -1),
    getUserName: vi.fn(() => 'User'),
    selectMultipleFile: vi.fn(),
    selectSingleFile: vi.fn(),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/media'), () => ({
    getImageType: vi.fn(),
}) as unknown as typeof import('src/ts/media'))

vi.mock(import('src/ts/process/inlayScreen'), () => ({
    updateInlayScreen: vi.fn((cha: unknown) => cha),
}) as unknown as typeof import('src/ts/process/inlayScreen'))

vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    parseMarkdownSafe: vi.fn(),
    hasher: vi.fn((s: string) => s),
}) as unknown as typeof import('src/ts/parser/parser.svelte'))

vi.mock(import('src/ts/translator/translator'), () => ({
    translateHTML: vi.fn(),
}) as unknown as typeof import('src/ts/translator/translator'))

vi.mock(import('src/ts/process/index.svelte'), () => ({
    doingChat: writable(false),
}) as unknown as typeof import('src/ts/process/index.svelte'))

vi.mock(import('src/ts/pngChunk'), () => ({
    PngChunk: class {},
}) as unknown as typeof import('src/ts/pngChunk'))

vi.mock(import('src/ts/process/coldstorage.svelte'), () => ({
    readColdStorageItem: vi.fn(),
}) as unknown as typeof import('src/ts/process/coldstorage.svelte'))

vi.mock(import('src/ts/media/avatarThumb'), () => ({
    getAvatarThumbSrc: vi.fn(),
    isThumbEligible: vi.fn(() => false),
}) as unknown as typeof import('src/ts/media/avatarThumb'))

vi.mock(import('src/ts/storage/characterSaveMarks'), () => ({
    markCharacterForSave: vi.fn(),
}) as unknown as typeof import('src/ts/storage/characterSaveMarks'))

vi.mock(import('src/ts/chatShell/shellSwitch.svelte'), () => ({
    shellEligible: () => false,
}) as unknown as typeof import('src/ts/chatShell/shellSwitch.svelte'))

//#endregion

import HomeShell from './HomeShell.svelte'
import { homeView, openHomeLibrary, startHomeView, takeHomeReturnFocus } from './homeView.svelte'
import { openStudioFromHome, resetHomeStudioForTests } from './homeStudio.svelte'
import { DBState, OpenRealmStore, selectedCharID, settingsOpen } from 'src/ts/stores.svelte'
import { removeChar } from 'src/ts/characters'
import { closeStudio, resetStudioScreenForTests } from 'src/ts/studio/studioScreen.svelte'
import { installStudioBack } from 'src/ts/studio/studioBack.svelte'
import { setStudioEnabled } from 'src/ts/studio/studioSwitch.svelte'
import { studioOpen } from 'src/ts/studio/studioOpen'

//#region fixtures

function warmCharacter(chaId: string): character {
    return {
        type: 'character',
        name: `${chaId} name`,
        image: `${chaId}.png`,
        chaId,
        chatPage: 0,
        firstMsgIndex: 0,
        creatorNotes: '',
        lastInteraction: 1000,
        desc: `${chaId} description`,
        globalLore: [],
        newGenData: true,
        chats: [{ id: `${chaId}-chat`, message: [{ role: 'user', data: 'Hi', time: 1 }], note: '', name: 'Chat 1', localLore: [] }],
    } as unknown as character
}

function installDb(): void {
    DBState.db = {
        hideRealm: false,
        realmDirectOpen: false,
        hideAllImages: false,
        username: 'User',
        personas: [],
        selectedPersona: 0,
        characters: [warmCharacter('zero'), warmCharacter('one'), warmCharacter('two')],
    } as unknown as Database
}

const mountedInstances: unknown[] = []
const mountedTargets: HTMLElement[] = []
let stopBackLayers: (() => void) | null = null

function newTarget(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    return target
}

function mountShell(): HTMLElement {
    const target = newTarget()
    mountedInstances.push(mount(HomeShell, { target }))
    flushSync()
    return target
}

async function settleChunk(): Promise<void> {
    for (let i = 0; i < 20; i++) {
        await new Promise<void>((resolve) => setTimeout(resolve, 10))
        await tick()
        flushSync()
    }
}

const scrollSpy = vi.fn()
const sectionOf = (root: HTMLElement): HTMLElement | null => root.querySelector('[data-part="home-library"]')
const landingShown = (root: HTMLElement): boolean => root.querySelector('[data-part="home-landing"]') !== null
const opener = (): HTMLElement => document.body.appendChild(document.createElement('button'))
const controlOf = (root: HTMLElement, chaId: string): HTMLElement | null =>
    root.querySelector(`[data-part="library-studio"][data-cha-id="${chaId}"]`)

beforeEach(() => {
    localStorage.setItem(UPSTREAM_AGREEMENT_KEY, 'accepted')
    resetUpstreamAgreementForTests()
    resetBackHandlersForTests()
    resetStudioScreenForTests()
    resetHomeStudioForTests()
    setStudioEnabled(true)
    settingsOpen.set(false)
    selectedCharID.set(-1)
    startHomeView()
    installDb()
    scrollSpy.mockClear()
    drawnControls.chaIds = []
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, writable: true, value: scrollSpy })
    stopBackLayers = $effect.root(() => {
        installStudioBack()
    })
})

afterEach(async () => {
    stopBackLayers?.()
    stopBackLayers = null
    OpenRealmStore.set(false)
    for (const instance of mountedInstances.splice(0)) {
        await unmount(instance as never).catch(() => {})
    }
    mountedTargets.splice(0).forEach((t) => t.remove())
    document.body.replaceChildren()
    resetBackHandlersForTests()
    resetStudioScreenForTests()
    resetHomeStudioForTests()
    selectedCharID.set(-1)
    startHomeView()
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
    setStudioEnabled(false)
    localStorage.clear()
    resetUpstreamAgreementForTests()
})

//#endregion

describe('the landing library after a Home-opened Studio', () => {
    test('S4b-R3 (c) F T6b: a shell that already exists reveals the library, focus on the character control, when a trash closes Studio in the same flush', async () => {
        drawnControls.chaIds = ['one']
        expect(openStudioFromHome(1, opener())).toBe(true)
        const root = mountShell()
        expect(landingShown(root)).toBe(true)
        flushSync()

        await removeChar(1, 'one')
        flushSync()

        expect(get(studioOpen)).toBe(false)
        expect(homeView.libraryEngaged).toBe(true)
        await vi.waitFor(() => expect(scrollSpy).toHaveBeenCalledTimes(1), { timeout: 5000 })
        expect(landingShown(root)).toBe(true)
        expect(scrollSpy.mock.contexts[0]).toBe(sectionOf(root))
        expect(document.activeElement).toBe(controlOf(root, 'one'))
    })

    test('S4b-R3 (a) F T6c: a shell created in the same stretch as the close reveals the library with the focus on the control', async () => {
        drawnControls.chaIds = ['one']
        expect(openStudioFromHome(1, opener())).toBe(true)
        flushSync()

        closeStudio()
        const root = mountShell()

        expect(get(selectedCharID)).toBe(-1)
        expect(homeView.libraryEngaged).toBe(true)
        await vi.waitFor(() => expect(scrollSpy).toHaveBeenCalledTimes(1), { timeout: 5000 })
        expect(landingShown(root)).toBe(true)
        expect(scrollSpy.mock.contexts[0]).toBe(sectionOf(root))
        expect(scrollSpy).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' })
        expect(document.activeElement).toBe(controlOf(root, 'one'))
    })

    test('S4b-R3 (b) with no control drawn for the character the focus falls back to the library heading', async () => {
        expect(openStudioFromHome(1, opener())).toBe(true)
        flushSync()

        closeStudio()
        const root = mountShell()

        await vi.waitFor(() => expect(scrollSpy).toHaveBeenCalledTimes(1), { timeout: 5000 })
        expect(document.activeElement).toBe(sectionOf(root)!.querySelector('h2'))
    })

    test('S4b-R3 (d) A-S4b-8: the visit character is gone and no library content is left, so the hero heading takes the focus', async () => {
        expect(openStudioFromHome(1, opener())).toBe(true)
        flushSync()

        DBState.db.characters = []
        selectedCharID.set(-1)
        closeStudio()
        const root = mountShell()

        await vi.waitFor(() => expect(scrollSpy).toHaveBeenCalledTimes(1), { timeout: 5000 })
        expect(sectionOf(root)).toBeNull()
        const hero = root.querySelector<HTMLElement>('section[data-part="home-empty-hero"]')
        expect(hero).not.toBeNull()
        expect(scrollSpy.mock.contexts[0]).toBe(hero)
        expect(document.activeElement).toBe(hero!.querySelector('[data-jump-target="home-hero"]'))
    })

    test('S4b-T19a a chaId with selector characters finds its control by attribute value, not as markup', async () => {
        const odd = '"] [x'
        drawnControls.chaIds = ['zero', odd]
        DBState.db.characters.push(warmCharacter(odd))
        expect(openStudioFromHome(3, opener())).toBe(true)
        flushSync()

        closeStudio()
        const root = mountShell()

        await vi.waitFor(() => expect(scrollSpy).toHaveBeenCalledTimes(1), { timeout: 5000 })
        const control = Array.from(root.querySelectorAll('[data-part="library-studio"]'))
            .find((candidate) => candidate.getAttribute('data-cha-id') === odd)
        expect(control).toBeDefined()
        expect(document.activeElement).toBe(control)
    })

    test('S4b-T19 the focus request is taken once: it is gone after the reveal and a later request without one moves no focus', async () => {
        drawnControls.chaIds = ['one']
        expect(openStudioFromHome(1, opener())).toBe(true)
        flushSync()
        closeStudio()
        const root = mountShell()
        await vi.waitFor(() => expect(scrollSpy).toHaveBeenCalledTimes(1), { timeout: 5000 })
        expect(document.activeElement).toBe(controlOf(root, 'one'))
        expect(takeHomeReturnFocus()).toBeNull()

        ;(document.activeElement as HTMLElement).blur()
        openHomeLibrary()
        flushSync()
        await vi.waitFor(() => expect(scrollSpy).toHaveBeenCalledTimes(2), { timeout: 5000 })
        expect(document.activeElement).toBe(sectionOf(root)!.querySelector('h2'))
    })
    test('S4b-R3 (e) F T6e: with the real Back and the natural scheduled flush, the creating flush runs before the tick clear, so the recreated shell reveals the library; a creation after the tick starts at the top', async () => {
        drawnControls.chaIds = ['one']
        // DefaultChatScreen's Home branch: the shell exists exactly while nothing is selected.
        const target = newTarget()
        const selected = fromStore(selectedCharID)
        let shell: ReturnType<typeof mount> | null = null
        const stopHost = $effect.root(() => {
            $effect(() => {
                const atHome = selected.current < 0
                untrack(() => {
                    if (atHome && shell === null) {
                        shell = mount(HomeShell, { target })
                    } else if (!atHome && shell !== null) {
                        void unmount(shell)
                        shell = null
                    }
                })
            })
        })
        try {
            flushSync()
            expect(landingShown(target)).toBe(true)

            expect(openStudioFromHome(1, opener())).toBe(true)
            flushSync()
            expect(target.textContent).toBe('')

            // No flushSync here: the host effect's own scheduled flush creates the shell.
            expect(dispatchBack()).toBe(true)

            expect(get(studioOpen)).toBe(false)
            expect(get(selectedCharID)).toBe(-1)
            await vi.waitFor(() => expect(scrollSpy).toHaveBeenCalledTimes(1), { timeout: 5000 })
            expect(landingShown(target)).toBe(true)
            expect(scrollSpy.mock.contexts[0]).toBe(sectionOf(target))
            expect(document.activeElement).toBe(controlOf(target, 'one'))

            await tick()
            scrollSpy.mockClear()
            drawnControls.chaIds = []
            const later = mountShell()
            expect(homeView.libraryEngaged).toBe(false)
            expect(landingShown(later)).toBe(true)
            await settleChunk()
            expect(scrollSpy).not.toHaveBeenCalled()
            expect(homeView.libraryEngaged).toBe(false)
        } finally {
            stopHost()
            if (shell !== null) {
                await unmount(shell)
            }
        }
    })
})
