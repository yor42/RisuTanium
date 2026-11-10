// @vitest-environment jsdom

/**
 * Open in Studio from Home (`homeStudio.svelte.ts`): the mechanism with no UI. Home selects the clicked
 * slot with `keepInteraction` and opens Studio `from: 'home'` in one synchronous stretch; a Home-owned
 * `studioOpen` subscriber ends each Home visit at the library.
 *
 * REAL: `characters.ts` (`changeChar`, `removeChar`, `characterFormatUpdate`), `studioScreen`, `studioBack`,
 * `classicLinks`, `chatSurface`, `chatOnScreen`, `backHandlers`, `homeView` and `svelte/store` writables.
 * The modules `characters.ts` imports are mocked as in `characters.lastInteraction.svelte.test.ts`; the stores
 * are real writables with `selIdState` mirrored from `selectedCharID` as the app's own subscriber does.
 * `installStudioBack()` runs in an effect root, which is what `StudioScreen` does on creation, so Back is the
 * real layer without mounting the screen. Characters are shaped like the real defaults.
 *
 * Classes: F = new behaviour (fails on the code before the stage by assertion); G = compatibility guard.
 */

import { flushSync, tick } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
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
    const state = $state({ db: {} as unknown as Database })
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
        CharEmotion: writable({}),
        MobileGUIStack: writable([]),
        OpenRealmStore: writable(null),
        alertStore: writable({ type: 'none', msg: '' }),
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

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    AppendableBuffer: class {},
    changeChatTo: vi.fn(),
    checkCharOrder: vi.fn(),
    downloadFile: vi.fn(),
    getFileSrc: vi.fn(),
    requiresFullEncoderReload: { state: false },
    forageStorage: {
        keys: vi.fn(async () => []),
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => {}),
    },
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/alert'), () => ({
    alertAddCharacter: vi.fn(),
    alertConfirm: vi.fn(async () => true),
    alertError: vi.fn(),
    alertNormal: vi.fn(),
    alertSelect: vi.fn(),
    alertStore: writable({ type: 'none', msg: '' }),
    alertWait: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

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

vi.mock(import('src/ts/characterCards'), () => ({
    importCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/characterCards'))

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

const recordCaughtErrorSpy = vi.hoisted(() => vi.fn())
vi.mock(import('src/ts/caughtErrors'), () => ({
    recordCaughtError: recordCaughtErrorSpy,
}) as unknown as typeof import('src/ts/caughtErrors'))

// The real `changeChar`, wrapped so one test can make it reject.
vi.mock(import('src/ts/characters'), async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, changeChar: vi.fn(actual.changeChar) }
})

//#endregion

import { DBState, MobileGUI, CharConfigSubMenu, SettingsMenuIndex, selectedCharID, settingsOpen } from 'src/ts/stores.svelte'
import { changeChar, removeChar } from 'src/ts/characters'
import { dispatchBack, resetBackHandlersForTests } from 'src/ts/backHandlers'
import { createHostChannelFake } from 'src/ts/android/hostChannelFake'
import { holdChatView, installChatOnScreen, resetChatOnScreenForTests } from 'src/ts/process/chatOnScreen.svelte'
import { buildColdStub } from 'src/ts/process/coldCharacter'
import { replyMarkOf } from 'src/ts/process/replyMarks'
import { chatSurface, installChatSurface, resetChatSurfaceForTests } from 'src/lib/ChatScreens/chatSurface.svelte'
import { openInClassicEditor } from 'src/ts/studio/classicLinks.svelte'
import { installStudioBack } from 'src/ts/studio/studioBack.svelte'
import { closeStudio, openStudio, resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { setStudioEnabled, studioEligible } from 'src/ts/studio/studioSwitch.svelte'
import { studioOpen } from 'src/ts/studio/studioOpen'
import { homeStudioAvailable, openStudioFromHome, resetHomeStudioForTests } from './homeStudio.svelte'
import { homeView, showHomeLanding, startHomeView, takeHomeReturnFocus } from './homeView.svelte'

//#region fixtures

const LONG_AGO = 1000

/** A warm character shaped like the real defaults (`characterFormatUpdate` finds nothing to add). */
function warmCharacter(chaId: string, extra: Record<string, unknown> = {}): character {
    return {
        type: 'character',
        name: `${chaId} name`,
        image: `${chaId}.png`,
        chaId,
        chatPage: 0,
        firstMsgIndex: 0,
        creatorNotes: '',
        lastInteraction: LONG_AGO,
        desc: `${chaId} description`,
        globalLore: [],
        newGenData: true,
        chats: [{ id: `${chaId}-chat`, message: [{ role: 'user', data: 'Hi', time: 1 }], note: '', name: 'Chat 1', localLore: [] }],
        ...extra,
    } as unknown as character
}

function installDb(characters: character[]): void {
    DBState.db = { characters } as unknown as Database
}

const slot = (index: number): character => DBState.db.characters[index] as unknown as character
const opener = (): HTMLElement => document.body.appendChild(document.createElement('button'))

let stopBackLayers: (() => void) | null = null

/** Back as the user presses it: the layers register in the flush after the open, the close is then settled. */
function pressBack(): boolean {
    flushSync()
    const handled = dispatchBack()
    flushSync()
    return handled
}

beforeEach(() => {
    vi.mocked(changeChar).mockClear()
    recordCaughtErrorSpy.mockClear()
    resetBackHandlersForTests()
    resetStudioScreenForTests()
    resetHomeStudioForTests()
    resetChatOnScreenForTests()
    resetChatSurfaceForTests()
    localStorage.clear()
    setStudioEnabled(true)
    MobileGUI.set(false)
    settingsOpen.set(false)
    selectedCharID.set(-1)
    showHomeLanding()
    installDb([warmCharacter('zero'), warmCharacter('one'), warmCharacter('two')])
    stopBackLayers = $effect.root(() => {
        installStudioBack()
    })
})

afterEach(() => {
    stopBackLayers?.()
    stopBackLayers = null
    resetBackHandlersForTests()
    resetStudioScreenForTests()
    resetHomeStudioForTests()
    resetChatOnScreenForTests()
    resetChatSurfaceForTests()
    settingsOpen.set(false)
    selectedCharID.set(-1)
    setStudioEnabled(false)
    localStorage.clear()
    document.body.replaceChildren()
    vi.restoreAllMocks()
})

//#endregion

describe('opening', () => {
    test('F T1: the clicked slot is selected and Studio opens bound to it, from home, in the same call', () => {
        const opened = openStudioFromHome(1, opener())

        expect(opened).toBe(true)
        expect(get(selectedCharID)).toBe(1)
        expect(get(studioOpen)).toBe(true)
        expect(studioScreen.chaId).toBe('one')
        expect(studioScreen.from).toBe('home')
        expect(studioScreen.target.owner).toEqual({ type: 'character', id: 'one' })
    })

    test('F T2: opening is not an interaction, so the Recent order does not move', () => {
        expect(openStudioFromHome(1, opener())).toBe(true)

        expect(get(selectedCharID)).toBe(1)
        expect(slot(1).lastInteraction).toBe(LONG_AGO)
    })

    test('F T11: two slots share a chaId; the clicked slot is selected, never the first holder', () => {
        installDb([warmCharacter('twin'), warmCharacter('twin'), warmCharacter('other')])

        expect(openStudioFromHome(1, opener())).toBe(true)

        expect(get(selectedCharID)).toBe(1)
    })

    test('F T21: two visits in a row each bind their own slot and each Back lands in the library', () => {
        openStudioFromHome(1, opener())
        expect(studioScreen.chaId).toBe('one')
        expect(pressBack()).toBe(true)
        expect(get(selectedCharID)).toBe(-1)
        expect(homeView.view).toBe('library')

        showHomeLanding()
        openStudioFromHome(2, opener())
        expect(studioScreen.chaId).toBe('two')
        expect(get(selectedCharID)).toBe(2)
        expect(pressBack()).toBe(true)
        expect(get(selectedCharID)).toBe(-1)
        expect(homeView.view).toBe('library')
    })

    test('F T21b: a second open while the first visit is still open belongs to the second slot', () => {
        expect(openStudioFromHome(1, opener())).toBe(true)
        expect(openStudioFromHome(2, opener())).toBe(true)
        expect(studioScreen.chaId).toBe('two')

        expect(pressBack()).toBe(true)

        expect(get(studioOpen)).toBe(false)
        expect(get(selectedCharID)).toBe(-1)
        expect(homeView.view).toBe('library')
    })

    test('F T9: a refused open (Settings is open) leaves no selection, no Studio, and the library shown', () => {
        settingsOpen.set(true)

        expect(openStudioFromHome(1, opener())).toBe(false)

        expect(get(selectedCharID)).toBe(-1)
        expect(get(studioOpen)).toBe(false)
        expect(homeView.view).toBe('library')
    })

    test('F T22: called from inside a store subscriber run, the queued selection is not there yet: refused and restored', () => {
        // svelte/store keeps one module-global subscriber queue, so a set made inside any subscriber run is
        // queued behind it. `selIdState` still holds -1 when the check runs.
        const trigger = writable(0)
        let result: boolean | null = null
        const stop = trigger.subscribe((value) => {
            if (value === 1) result = openStudioFromHome(1, opener())
        })
        trigger.set(1)
        stop()

        expect(result).toBe(false)
        expect(get(studioOpen)).toBe(false)
        expect(get(selectedCharID)).toBe(-1)
        expect(homeView.view).toBe('library')
    })

    test('F T23: a rejected pick is logged once and never unhandled; the open is refused with the library shown', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        vi.mocked(changeChar).mockImplementationOnce(() => Promise.reject(new Error('pick failed')))

        expect(openStudioFromHome(1, opener())).toBe(false)
        await tick()
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(errorSpy).toHaveBeenCalledTimes(1)
        expect(recordCaughtErrorSpy).toHaveBeenCalledTimes(1)
        expect(recordCaughtErrorSpy.mock.calls[0][0]).toBe('home.studio')
        expect(get(selectedCharID)).toBe(-1)
        expect(get(studioOpen)).toBe(false)
        expect(homeView.view).toBe('library')
    })
})

describe('availability', () => {
    test('G T3: homeStudioAvailable agrees with studioEligible for every kind of slot, and a trashed one is never available', () => {
        installDb([
            warmCharacter('normal'),
            warmCharacter('group', { type: 'group' }),
            warmCharacter('§playground'),
            warmCharacter('trashed', { trashTime: 5 }),
        ])
        const eligibleAt = (index: number): boolean => {
            selectedCharID.set(index)
            return studioEligible()
        }

        for (const index of [0, 1, 2]) {
            expect(homeStudioAvailable(slot(index)), `slot ${index}`).toBe(eligibleAt(index))
        }
        expect(homeStudioAvailable(slot(0))).toBe(true)
        expect(homeStudioAvailable(slot(3))).toBe(false)

        setStudioEnabled(false)
        expect(homeStudioAvailable(slot(0))).toBe(eligibleAt(0))
        expect(homeStudioAvailable(slot(0))).toBe(false)
        setStudioEnabled(true)

        MobileGUI.set(true)
        expect(homeStudioAvailable(slot(0))).toBe(eligibleAt(0))
        expect(homeStudioAvailable(slot(0))).toBe(false)
    })

    test('R T30: an archived stub is available (the open loads it first); a group, a trashed or a playground stub, the switch off and Beta Mobile GUI still are not', () => {
        const stubOf = (source: character): character => buildColdStub(source, `unit-${source.chaId}`, [])
        installDb([
            stubOf(warmCharacter('normal')),
            stubOf(warmCharacter('group', { type: 'group', characters: [] })),
            stubOf(warmCharacter('§playground')),
            stubOf(warmCharacter('trashed', { trashTime: 5 })),
        ])

        expect(slot(0).coldstorage).toBe('unit-normal')
        expect(homeStudioAvailable(slot(0))).toBe(true)
        expect(homeStudioAvailable(slot(1))).toBe(false)
        expect(homeStudioAvailable(slot(2))).toBe(false)
        expect(homeStudioAvailable(slot(3))).toBe(false)

        setStudioEnabled(false)
        expect(homeStudioAvailable(slot(0))).toBe(false)
        setStudioEnabled(true)

        MobileGUI.set(true)
        expect(homeStudioAvailable(slot(0))).toBe(false)
    })

    test('G T3b: an open of a slot that is not available changes nothing', () => {
        installDb([warmCharacter('group', { type: 'group' }), warmCharacter('cold', { coldstorage: 'unit-cold' })])

        expect(openStudioFromHome(0, opener())).toBe(false)
        expect(openStudioFromHome(1, opener())).toBe(false)
        expect(openStudioFromHome(7, opener())).toBe(false)

        expect(get(selectedCharID)).toBe(-1)
        expect(get(studioOpen)).toBe(false)
        expect(vi.mocked(changeChar)).not.toHaveBeenCalled()
        expect(homeView.view).toBe('landing')
    })
})

describe('the end of a visit', () => {
    test('F T5: Back clears the selection and resumes the library', () => {
        openStudioFromHome(1, opener())

        expect(pressBack()).toBe(true)

        expect(get(studioOpen)).toBe(false)
        expect(get(selectedCharID)).toBe(-1)
        expect(homeView.view).toBe('library')
    })

    test('F T6: a character trashed during the visit closes Studio onto the library, and the intent expires after the tick', async () => {
        openStudioFromHome(1, opener())
        flushSync()

        await removeChar(1, 'one')
        flushSync()

        expect(get(studioOpen)).toBe(false)
        expect(get(selectedCharID)).toBe(-1)
        expect(homeView.view).toBe('library')

        await tick()
        expect(startHomeView()).toBe('landing')
        expect(homeView.view).toBe('landing')
    })

    test('F T10: a selection moved to another character during the visit is not undone at its end', () => {
        expect(openStudioFromHome(1, opener())).toBe(true)
        flushSync()

        selectedCharID.set(2)
        flushSync()

        expect(get(studioOpen)).toBe(false)
        expect(get(selectedCharID)).toBe(2)
        expect(homeView.view).toBe('landing')
    })

    test('F T7: a chat-origin visit on the same slot after a Home visit sees no Home behaviour', () => {
        expect(openStudioFromHome(1, opener())).toBe(true)
        expect(pressBack()).toBe(true)
        showHomeLanding()

        selectedCharID.set(1)
        expect(openStudio({ owner: { type: 'character', id: 'one' }, from: 'chat' }, { element: opener() })).toBe(true)
        expect(pressBack()).toBe(true)

        expect(get(studioOpen)).toBe(false)
        expect(get(selectedCharID)).toBe(1)
        expect(homeView.view).toBe('landing')
    })
})

describe('character link-out (K2)', () => {
    test('F T8: a character link-out keeps the selection for the classic editor; a Settings link-out returns Home under Settings', () => {
        openStudioFromHome(1, opener())
        expect(openInClassicEditor('character', 'lore')).toBe(true)
        flushSync()

        expect(get(studioOpen)).toBe(false)
        expect(get(selectedCharID)).toBe(1)
        expect(get(CharConfigSubMenu)).toBe(3)
        expect(homeView.view).toBe('landing')

        selectedCharID.set(-1)
        showHomeLanding()
        openStudioFromHome(1, opener())
        expect(openInClassicEditor('module', null)).toBe(true)
        flushSync()

        expect(get(studioOpen)).toBe(false)
        expect(get(selectedCharID)).toBe(-1)
        expect(get(settingsOpen)).toBe(true)
        expect(get(SettingsMenuIndex)).toBe(14)
        expect(homeView.view).toBe('library')
    })
})

describe('the reply mark of the opened character (CHORE-685)', () => {
    let hostFake: ReturnType<typeof createHostChannelFake>

    beforeEach(() => {
        hostFake = createHostChannelFake()
        window.__risuTaniumHost = hostFake.channel
        // The app: the surface and the on-screen leaf installed, ChatScreen mounted under Home (the chat view is held).
        installChatSurface()
        const stop = installChatOnScreen()
        const release = holdChatView()
        stopOnScreen = () => {
            release()
            stop()
        }
        slot(1).chats[0].unseenReply = 'reply'
        flushSync()
    })

    let stopOnScreen: (() => void) | null = null

    afterEach(() => {
        stopOnScreen?.()
        stopOnScreen = null
        delete window.__risuTaniumHost
    })

    const cancelCalls = () => hostFake.postedTo('replyNotifications', 'cancel')

    test('F T4: the mark and the notification survive the open and the Back', async () => {
        const opened = openStudioFromHome(1, opener())
        // No await before this flush: a flush between the select and the open is exactly what clears the mark.
        flushSync()

        expect(replyMarkOf(slot(1).chats[0])).not.toBeNull()
        expect(cancelCalls()).toEqual([])
        expect(opened).toBe(true)
        expect(chatSurface.hidden).toBe(true)

        expect(pressBack()).toBe(true)
        // The selection is cleared before any flush, so the chat of the opened character is never uncovered.
        expect(get(selectedCharID)).toBe(-1)
        await tick()
        await tick()
        flushSync()

        expect(chatSurface.hidden).toBe(false)
        expect(replyMarkOf(slot(1).chats[0])).not.toBeNull()
        expect(cancelCalls()).toEqual([])
    })
})

describe('closeStudio of a visit not opened from Home', () => {
    test('G: closing a plain Studio visit (no Home visit) neither selects nor resumes anything', () => {
        selectedCharID.set(0)
        expect(openStudio({ owner: { type: 'character', id: 'zero' }, from: 'chat' }, null)).toBe(true)

        closeStudio()

        expect(get(selectedCharID)).toBe(0)
        expect(homeView.view).toBe('landing')
    })
})

describe('the return-focus request of a visit end (G2)', () => {
    // A request left by another test must not be read as this one's.
    beforeEach(() => {
        takeHomeReturnFocus()
    })

    test('F: Back leaves one request naming the opened character, taken once', () => {
        expect(openStudioFromHome(1, opener())).toBe(true)
        expect(takeHomeReturnFocus()).toBeNull()

        expect(pressBack()).toBe(true)

        expect(get(selectedCharID)).toBe(-1)
        expect(takeHomeReturnFocus()).toBe('one')
        expect(takeHomeReturnFocus()).toBeNull()
    })

    test('F: a character trashed during the visit still asks for the focus, naming it', async () => {
        openStudioFromHome(1, opener())
        flushSync()

        await removeChar(1, 'one')
        flushSync()

        expect(get(selectedCharID)).toBe(-1)
        expect(takeHomeReturnFocus()).toBe('one')
    })

    test('G: a selection moved to another character, a character link-out and a plain visit ask for nothing', () => {
        expect(openStudioFromHome(1, opener())).toBe(true)
        flushSync()
        selectedCharID.set(2)
        flushSync()
        expect(takeHomeReturnFocus()).toBeNull()

        selectedCharID.set(-1)
        openStudioFromHome(1, opener())
        expect(openInClassicEditor('character', 'lore')).toBe(true)
        flushSync()
        expect(get(selectedCharID)).toBe(1)
        expect(takeHomeReturnFocus()).toBeNull()

        selectedCharID.set(0)
        expect(openStudio({ owner: { type: 'character', id: 'zero' }, from: 'chat' }, null)).toBe(true)
        closeStudio()
        expect(takeHomeReturnFocus()).toBeNull()
    })

    test('G: a request left unconsumed is dropped by a landing creation or a landing show, so a later library mount takes nothing', async () => {
        expect(openStudioFromHome(1, opener())).toBe(true)
        expect(pressBack()).toBe(true)
        // The tick clears the pending library intent, so the next creation starts at the landing.
        await tick()
        expect(startHomeView()).toBe('landing')
        expect(takeHomeReturnFocus()).toBeNull()

        expect(openStudioFromHome(1, opener())).toBe(true)
        expect(pressBack()).toBe(true)
        showHomeLanding()
        expect(takeHomeReturnFocus()).toBeNull()
    })
})
