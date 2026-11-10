// @vitest-environment jsdom

/**
 * Open in Studio from Home for an archived character (`startStudioFromHome` in `homeStudio.svelte.ts`): the
 * slot is loaded through `restoreColdCharacter` without being selected, found again by identity after the
 * await, and only then opened by the unchanged synchronous select-and-open. The mechanism with no UI; the
 * mounted library is `HomeLibrary.cold.svelte.test.ts`, the warm open is `homeStudio.svelte.test.ts`.
 *
 * REAL: `characters.ts` (`changeChar` wrapped, `characterFormatUpdate`, `changeCharGeneration`),
 * `coldCharacterRestore`, `coldCharacter`, `coldRetained`, `studioScreen`, `studioBack`, `backHandlers`
 * (`registerBackHandler` wrapped to count live registrations), `homeView` and the store2 put-back. The unit
 * read (`readColdStorageItem`) is a deferred promise the test settles. There is no residency, so the legacy
 * branch runs, except in the store2 describe at the end.
 *
 * Fixtures are built like the real producer: the stub comes from `buildColdStub(full, key, [])` and the unit
 * value is `{ character: coldUnitCharacter(full) }`. `full` omits `scenario`, a field `characterFormatUpdate`
 * fills, so a test can tell whether the character was formatted. No quit guard is installed, so a Back press
 * nothing handles returns false.
 *
 * Classes: F = new behaviour (fails by assertion on stubs of the new exports); G = compatibility guard.
 */

import { flushSync } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi, type MockInstance } from 'vitest'
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

const harness = vi.hoisted(() => ({
    liveBack: 0,
    commits: [] as Array<() => void>,
    verdictCalls: [] as string[],
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
    afterNextSaveCommit: (callback: () => void) => { harness.commits.push(callback) },
    isSaveClean: () => false,
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

const readSpy = vi.hoisted(() => vi.fn())

vi.mock(import('src/ts/process/coldstorage.svelte'), () => ({
    readColdStorageItem: readSpy,
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

// The real `changeChar`, wrapped so a test can count its calls.
vi.mock(import('src/ts/characters'), async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, changeChar: vi.fn(actual.changeChar) }
})

// The real Back handlers; each registration is counted until its own unregister runs, so a test can tell a
// released handler from a leaked one that merely answers false.
vi.mock(import('src/ts/backHandlers'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        registerBackHandler: (handler: Parameters<typeof actual.registerBackHandler>[0]) => {
            const unregister = actual.registerBackHandler(handler)
            let released = false
            harness.liveBack++
            return () => {
                if (!released) {
                    released = true
                    harness.liveBack--
                }
                unregister()
            }
        },
    }
})

//#endregion

import { DBState, MobileGUI, selIdState, selectedCharID, settingsOpen } from 'src/ts/stores.svelte'
import { changeChar } from 'src/ts/characters'
import { language } from 'src/lang'
import { alertError } from 'src/ts/alert'
import { setCharacterByIndex } from 'src/ts/storage/database.svelte'
import { markCharacterForSave } from 'src/ts/storage/characterSaveMarks'
import { dispatchBack, resetBackHandlersForTests } from 'src/ts/backHandlers'
import { buildColdStub, coldUnitCharacter } from 'src/ts/process/coldCharacter'
import { restoreColdCharacter } from 'src/ts/process/coldCharacterRestore'
import { loadedRecordOf, resetRetainedForTest } from 'src/ts/process/coldRetained'
import { resetChatOnScreenForTests } from 'src/ts/process/chatOnScreen.svelte'
import { getPutBackCounters, resetPutBackForTest, startCharacterPutBack } from 'src/ts/process/memory/characterPutBack'
import { resetBusyActionsForTest } from 'src/ts/process/memory/busyActions'
import { resetRestoredBytesForTest } from 'src/ts/process/memory/restoredBytes'
import { resetChatSurfaceForTests } from 'src/lib/ChatScreens/chatSurface.svelte'
import type { Residency } from 'src/ts/storage/store2/residency'
import { noteResidencyRead, registerResidency, resetResidencyForTest } from 'src/ts/storage/store2/residencyActive'
import { installStudioBack } from 'src/ts/studio/studioBack.svelte'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { setStudioEnabled } from 'src/ts/studio/studioSwitch.svelte'
import { studioOpen } from 'src/ts/studio/studioOpen'
import { cancelHomeStudioOpen, openStudioFromHome, resetHomeStudioForTests, startStudioFromHome } from './homeStudio.svelte'
import { homeView, openHomeLibrary, showHomeLanding } from './homeView.svelte'

//#region fixtures

const LONG_AGO = 1000

/** A full character as the unit holds it: `scenario` is omitted, so `characterFormatUpdate` has something to fill. */
function fullCharacter(chaId: string, extra: Record<string, unknown> = {}): character {
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

const slot = (index: number): character => DBState.db.characters[index] as unknown as character
const opener = (): HTMLElement => document.body.appendChild(document.createElement('button'))
const isFormatted = (cha: character): boolean => cha.scenario === ''

/** The unit's characters by chaId; slots are `zero` (warm) 0, `alpha` (archived) 1, `beta` (archived) 2. */
let fulls: Record<string, character> = {}

function installArchive(): void {
    fulls = { alpha: fullCharacter('alpha'), beta: fullCharacter('beta') }
    DBState.db = {
        characters: [
            fullCharacter('zero', { scenario: '' }),
            buildColdStub(fulls.alpha, 'unit-alpha', []),
            buildColdStub(fulls.beta, 'unit-beta', []),
        ],
    } as unknown as Database
}

/** A unit read value as the producer writes it. */
function unitRead(chaId: string): { status: 'ok', value: { character: character } } {
    return { status: 'ok', value: { character: coldUnitCharacter(fulls[chaId]) } }
}

interface PendingRead {
    key: string
    resolve: (result: unknown) => void
    settled: boolean
}

let reads: PendingRead[] = []

/** Every unit read stays pending until `land` settles it. */
function holdReads(): void {
    reads = []
    readSpy.mockImplementation((key: string) => new Promise((resolve) => {
        reads.push({ key, resolve, settled: false })
    }))
}

function drain(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0))
}

/** Settles the oldest unsettled read of `chaId`'s unit with `result` and lets everything that follows run. */
async function land(chaId: string, result: unknown = unitRead(chaId)): Promise<void> {
    const read = reads.find((candidate) => candidate.key === `unit-${chaId}` && !candidate.settled)
    expect(read, `the unit read of ${chaId} is pending`).toBeDefined()
    read!.settled = true
    read!.resolve(result)
    await drain()
}

/** The tap on the Studio control, always as a promise. */
function tap(index: number): Promise<boolean> {
    return Promise.resolve(startStudioFromHome(index, opener()))
}

let baselineBack = 0
const liveBack = (): number => harness.liveBack - baselineBack

let stopBackLayers: (() => void) | null = null
let errorSpy: MockInstance<typeof console.error>

/** Counts how often `studioOpen` became true. */
function countOpens(): { count: () => number, stop: () => void } {
    let opens = 0
    const stop = studioOpen.subscribe((open) => {
        if (open) opens++
    })
    return { count: () => opens, stop }
}

beforeEach(() => {
    vi.mocked(changeChar).mockClear()
    vi.mocked(alertError).mockClear()
    vi.mocked(setCharacterByIndex).mockClear()
    vi.mocked(markCharacterForSave).mockClear()
    recordCaughtErrorSpy.mockClear()
    readSpy.mockReset()
    harness.commits.length = 0
    harness.verdictCalls.length = 0
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    resetBackHandlersForTests()
    harness.liveBack = 0
    resetStudioScreenForTests()
    resetHomeStudioForTests()
    resetChatOnScreenForTests()
    resetChatSurfaceForTests()
    resetRetainedForTest()
    resetResidencyForTest()
    localStorage.clear()
    setStudioEnabled(true)
    MobileGUI.set(false)
    settingsOpen.set(false)
    selectedCharID.set(-1)
    showHomeLanding()
    installArchive()
    holdReads()
    stopBackLayers = $effect.root(() => {
        installStudioBack()
    })
    flushSync()
    baselineBack = harness.liveBack
})

afterEach(() => {
    resetHomeStudioForTests()
    stopBackLayers?.()
    stopBackLayers = null
    resetBackHandlersForTests()
    resetStudioScreenForTests()
    resetChatOnScreenForTests()
    resetChatSurfaceForTests()
    resetRetainedForTest()
    resetResidencyForTest()
    settingsOpen.set(false)
    selectedCharID.set(-1)
    setStudioEnabled(false)
    localStorage.clear()
    document.body.replaceChildren()
    errorSpy.mockRestore()
})

//#endregion

describe('the open of an archived character', () => {
    test('F T33: the character loads without selecting, then Studio opens on it from home, keeping the last interaction', async () => {
        openHomeLibrary()
        const opened = tap(1)
        await drain()

        expect(get(selectedCharID)).toBe(-1)
        expect(get(studioOpen)).toBe(false)
        expect(slot(1).coldstorage).toBe('unit-alpha')

        await land('alpha')

        expect(await opened).toBe(true)
        expect(slot(1).coldstorage).toBeUndefined()
        expect(slot(1).chaId).toBe('alpha')
        expect(selIdState.selId).toBe(1)
        expect(get(studioOpen)).toBe(true)
        expect(studioScreen.target.owner).toEqual({ type: 'character', id: 'alpha' })
        expect(studioScreen.from).toBe('home')
        expect(slot(1).lastInteraction).toBe(LONG_AGO)
        expect(alertError).not.toHaveBeenCalled()
        expect(vi.mocked(changeChar)).toHaveBeenCalledTimes(1)
        expect(vi.mocked(changeChar)).toHaveBeenCalledWith(1, { keepInteraction: true, quiet: true })
    })

    test('F T34 (I2): no flush falls between the select and the open, under the natural flushes', async () => {
        const seen: Array<{ selId: number, open: boolean }> = []
        const stopObserver = $effect.root(() => {
            $effect(() => {
                seen.push({ selId: selIdState.selId, open: get(studioOpen) })
            })
        })
        flushSync()
        try {
            const opened = tap(1)
            await land('alpha')
            await opened
            await drain()
            flushSync()

            expect(seen).toContainEqual({ selId: 1, open: true })
            expect(seen.filter((state) => state.selId !== -1 && !state.open)).toEqual([])
        } finally {
            stopObserver()
        }
    })

    test('F T35: a second tap before the read lands is one read, one open and one changeChar; the opened character is formatted', async () => {
        const opens = countOpens()
        const first = tap(1)
        const second = tap(1)
        await drain()
        await land('alpha')

        expect(await first).toBe(false)
        expect(await second).toBe(true)
        expect(readSpy).toHaveBeenCalledTimes(1)
        expect(opens.count()).toBe(1)
        expect(vi.mocked(changeChar)).toHaveBeenCalledTimes(1)
        expect(selIdState.selId).toBe(1)
        // A guard, not a kill of a missing format: the open's own `changeChar` formats a warm character too.
        expect(isFormatted(slot(1))).toBe(true)
        opens.stop()
    })

    test('F T36 (Back): Back during the load cancels it and consumes the press; the library stays, nothing opens, the character is loaded', async () => {
        openHomeLibrary()
        const opened = tap(1)
        await drain()

        expect(dispatchBack()).toBe(true)
        await land('alpha')

        expect(await opened).toBe(false)
        expect(get(selectedCharID)).toBe(-1)
        expect(get(studioOpen)).toBe(false)
        expect(slot(1).coldstorage).toBeUndefined()
        expect(homeView.view).toBe('library')
        // The next Back reaches no handler of this request.
        expect(dispatchBack()).toBe(false)
        expect(liveBack()).toBe(0)
    })

    test('F T36b: two taps on archived characters, the older read landing first: Back still cancels the newer request, and nothing is left registered', async () => {
        const opens = countOpens()
        const older = tap(1)
        const newer = tap(2)
        await drain()
        await land('alpha')

        expect(await older).toBe(false)
        expect(dispatchBack()).toBe(true)
        await land('beta')

        expect(await newer).toBe(false)
        expect(opens.count()).toBe(0)
        expect(get(selectedCharID)).toBe(-1)
        expect(dispatchBack()).toBe(false)
        expect(liveBack()).toBe(0)
        opens.stop()
    })

    test('F T37: cancelling before the read lands opens and selects nothing; the character is loaded and formatted', async () => {
        const opened = tap(1)
        await drain()

        cancelHomeStudioOpen()
        expect(liveBack()).toBe(0)
        await land('alpha')

        expect(await opened).toBe(false)
        expect(get(selectedCharID)).toBe(-1)
        expect(get(studioOpen)).toBe(false)
        expect(slot(1).coldstorage).toBeUndefined()
        expect(isFormatted(slot(1))).toBe(true)
        expect(slot(1).lastInteraction).toBe(LONG_AGO)
    })

    test('F T38c: a Studio tap, then a row pick of the same character: the pick selects a formatted character and Studio stays closed', async () => {
        const opened = tap(1)
        const pick = changeChar(1)
        await land('alpha')

        expect(await pick).toBe('selected')
        expect(await opened).toBe(false)
        expect(selIdState.selId).toBe(1)
        expect(isFormatted(slot(1))).toBe(true)
        expect(get(studioOpen)).toBe(false)
    })

    test('F T38 changeChar-wins (a): a warm row pick started during the load is selected, and the later landing opens nothing', async () => {
        const opened = tap(1)
        await drain()

        const pick = changeChar(0)
        expect(get(selectedCharID)).toBe(0)
        await land('alpha')

        expect(await pick).toBe('selected')
        expect(await opened).toBe(false)
        expect(get(selectedCharID)).toBe(0)
        expect(get(studioOpen)).toBe(false)
        expect(slot(1).coldstorage).toBeUndefined()
    })

    test('F T38 changeChar-wins (b): an archived row pick started during the load wins over the earlier Studio tap even when the tap\'s read lands first', async () => {
        const opened = tap(1)
        await drain()

        const pick = changeChar(2)
        await land('alpha')
        await land('beta')

        expect(await opened).toBe(false)
        expect(await pick).toBe('selected')
        expect(get(selectedCharID)).toBe(2)
        expect(get(studioOpen)).toBe(false)
        expect(isFormatted(slot(1))).toBe(true)
    })

    test('F T39: the stub trashed during the load is installed but not opened; the stub removed during the load opens nothing and alerts nothing', async () => {
        const opened = tap(1)
        await drain()
        slot(1).trashTime = 5
        await land('alpha')

        expect(await opened).toBe(false)
        expect(slot(1).coldstorage).toBeUndefined()
        expect(slot(1).trashTime).toBe(5)
        expect(get(selectedCharID)).toBe(-1)
        expect(get(studioOpen)).toBe(false)

        installArchive()
        holdReads()
        const removed = tap(1)
        await drain()
        DBState.db.characters.splice(1, 1)
        await land('alpha')

        expect(await removed).toBe(false)
        expect(get(selectedCharID)).toBe(-1)
        expect(get(studioOpen)).toBe(false)
        expect(alertError).not.toHaveBeenCalled()
    })

    test('F T40: Settings opened during the load stops the open; changeChar is never called', async () => {
        const opened = tap(1)
        await drain()
        settingsOpen.set(true)
        await land('alpha')

        expect(await opened).toBe(false)
        expect(vi.mocked(changeChar)).not.toHaveBeenCalled()
        expect(get(selectedCharID)).toBe(-1)
        expect(get(studioOpen)).toBe(false)
    })

    test('F T41: a character inserted before the stub during the load moves it; the loaded character is the one selected and opened', async () => {
        const opened = tap(1)
        await drain()
        DBState.db.characters.unshift(fullCharacter('late', { scenario: '' }))
        await land('alpha')

        expect(await opened).toBe(true)
        expect(selIdState.selId).toBe(2)
        expect(studioScreen.target.owner).toEqual({ type: 'character', id: 'alpha' })
    })

    test('F T42: a warm open during the load wins, and the landing changes nothing; of two archived taps only the later opens', async () => {
        const opens = countOpens()
        const first = tap(1)
        await drain()
        expect(await tap(0)).toBe(true)
        await land('alpha')

        expect(await first).toBe(false)
        expect(studioScreen.target.owner).toEqual({ type: 'character', id: 'zero' })
        expect(selIdState.selId).toBe(0)
        expect(opens.count()).toBe(1)

        selectedCharID.set(-1)
        resetStudioScreenForTests()
        resetHomeStudioForTests()
        installArchive()
        holdReads()
        const older = tap(1)
        const newer = tap(2)
        await drain()
        await land('alpha')
        await land('beta')

        expect(await older).toBe(false)
        expect(await newer).toBe(true)
        expect(studioScreen.target.owner).toEqual({ type: 'character', id: 'beta' })
        expect(opens.count()).toBe(2)
        opens.stop()
    })

    test('F T43: a row pick of another archived character is pending first; the Studio tap supersedes it and opens when the pick\'s read lands first', async () => {
        const pick = changeChar(2)
        const opened = tap(1)
        await drain()
        await land('beta')
        await land('alpha')

        expect(await pick).toBe('superseded')
        expect(await opened).toBe(true)
        expect(selIdState.selId).toBe(1)
        expect(studioScreen.target.owner).toEqual({ type: 'character', id: 'alpha' })
    })

    test('F T47 (module only): a selection set directly during the load, with no changeChar, stops the open', async () => {
        const opened = tap(1)
        await drain()
        selectedCharID.set(0)
        await land('alpha')

        expect(await opened).toBe(false)
        expect(get(selectedCharID)).toBe(0)
        expect(get(studioOpen)).toBe(false)
    })

    test('G T3b: openStudioFromHome itself still refuses an archived slot and never calls changeChar', () => {
        expect(openStudioFromHome(1, opener())).toBe(false)

        expect(vi.mocked(changeChar)).not.toHaveBeenCalled()
        expect(get(selectedCharID)).toBe(-1)
        expect(get(studioOpen)).toBe(false)
    })

    test('F: a tap on an unavailable archived slot (a group, a trashed one, Beta Mobile GUI) reads nothing and registers nothing', async () => {
        DBState.db.characters.push(buildColdStub(fullCharacter('team', { type: 'group', characters: [] }), 'unit-team', []))
        expect(await tap(3)).toBe(false)
        slot(1).trashTime = 5
        expect(await tap(1)).toBe(false)
        slot(1).trashTime = undefined
        MobileGUI.set(true)
        expect(await tap(2)).toBe(false)

        expect(readSpy).not.toHaveBeenCalled()
        expect(liveBack()).toBe(0)
    })
})

describe('a load that fails', () => {
    test('F T44: a unit that decoded to null alerts once with the row tap\'s text; the stub stays, nothing opens, no handler is left', async () => {
        openHomeLibrary()
        const opened = tap(1)
        await drain()
        await land('alpha', { status: 'ok', value: null })

        expect(await opened).toBe(false)
        expect(alertError).toHaveBeenCalledTimes(1)
        expect(alertError).toHaveBeenCalledWith(language.errors.coldStorageRestoreFailed)
        expect(slot(1).coldstorage).toBe('unit-alpha')
        expect(get(selectedCharID)).toBe(-1)
        expect(get(studioOpen)).toBe(false)
        expect(homeView.view).toBe('library')
        expect(liveBack()).toBe(0)
        expect(dispatchBack()).toBe(false)
    })

    test('F T44: a failed read alerts with the unreadable text', async () => {
        const opened = tap(1)
        await drain()
        await land('alpha', { status: 'error', error: new Error('storage failed') })

        expect(await opened).toBe(false)
        expect(alertError).toHaveBeenCalledTimes(1)
        expect(alertError).toHaveBeenCalledWith(language.errors.coldStorageRestoreUnreadable)
        expect(slot(1).coldstorage).toBe('unit-alpha')
        expect(liveBack()).toBe(0)
    })

    test('F T45: a throw while the unit is read is logged and alerted once, never unhandled, and leaves no handler', async () => {
        const opened = tap(1)
        await drain()
        await land('alpha', { status: 'ok', value: { get character(): never { throw new Error('boom') } } })

        expect(await opened).toBe(false)
        expect(recordCaughtErrorSpy).toHaveBeenCalledTimes(1)
        expect(recordCaughtErrorSpy.mock.calls[0][0]).toBe('home.studio')
        expect(alertError).toHaveBeenCalledTimes(1)
        expect(alertError).toHaveBeenCalledWith(language.errors.coldStorageRestoreUnreadable)
        expect(get(selectedCharID)).toBe(-1)
        expect(get(studioOpen)).toBe(false)
        // Released, not merely inert: a handler that outlived the throw would still be counted.
        expect(liveBack()).toBe(0)
        expect(dispatchBack()).toBe(false)
    })

    test('F T45: a throw after a cancel is logged but not alerted', async () => {
        const opened = tap(1)
        await drain()
        cancelHomeStudioOpen()
        await land('alpha', { status: 'ok', value: { get character(): never { throw new Error('boom') } } })

        expect(await opened).toBe(false)
        expect(recordCaughtErrorSpy).toHaveBeenCalledTimes(1)
        expect(alertError).not.toHaveBeenCalled()
        expect(liveBack()).toBe(0)
    })

    test('F T45: a throw after the load (the format step) is caught the same way: logged, alerted once, nothing opens, no handler', async () => {
        vi.mocked(setCharacterByIndex).mockImplementationOnce(() => {
            throw new Error('format failed')
        })
        const opened = tap(1)
        await drain()
        await land('alpha')

        expect(await opened).toBe(false)
        expect(recordCaughtErrorSpy).toHaveBeenCalledTimes(1)
        expect(recordCaughtErrorSpy.mock.calls[0][0]).toBe('home.studio')
        expect(alertError).toHaveBeenCalledTimes(1)
        expect(alertError).toHaveBeenCalledWith(language.errors.coldStorageRestoreUnreadable)
        expect(get(selectedCharID)).toBe(-1)
        expect(get(studioOpen)).toBe(false)
        expect(liveBack()).toBe(0)
    })

    for (const order of ['Studio first', 'row pick first'] as const) {
        test(`F T46: a refused load shared by a Studio tap and a row pick of the same stub alerts exactly once (${order})`, async () => {
            let pick: Promise<unknown>
            let opened: Promise<boolean>
            if (order === 'Studio first') {
                opened = tap(1)
                pick = changeChar(1)
            } else {
                pick = changeChar(1)
                opened = tap(1)
            }
            await land('alpha', { status: 'ok', value: null })

            await pick
            expect(await opened).toBe(false)
            expect(alertError).toHaveBeenCalledTimes(1)
            expect(get(selectedCharID)).toBe(-1)
            expect(get(studioOpen)).toBe(false)
        })
    }

    test('F T46b: a throw shared by a Studio tap and then a row pick: Studio does not alert, and logs once', async () => {
        const opened = tap(1)
        const pick = changeChar(1).catch((error: unknown) => error)
        await land('alpha', { status: 'ok', value: { get character(): never { throw new Error('boom') } } })

        expect(await pick).toBeInstanceOf(Error)
        expect(await opened).toBe(false)
        expect(alertError).not.toHaveBeenCalled()
        expect(recordCaughtErrorSpy).toHaveBeenCalledTimes(1)
        expect(recordCaughtErrorSpy.mock.calls[0][0]).toBe('home.studio')
    })

    test('F T46d: a quiet restore already running that is refused gives the joined Studio tap no alert, and nothing opens', async () => {
        const quiet = restoreColdCharacter(slot(1), { quiet: true })
        const opened = tap(1)
        await drain()
        await land('alpha', { status: 'ok', value: null })

        expect((await quiet).status).toBe('refused')
        expect(await opened).toBe(false)
        expect(alertError).not.toHaveBeenCalled()
        expect(get(selectedCharID)).toBe(-1)
        expect(get(studioOpen)).toBe(false)
        expect(liveBack()).toBe(0)
    })
})

describe('a store2 page (a residency is registered)', () => {
    const residency: Residency = {
        entryOf: () => null,
        moduleEntryOf: () => null,
        readModule: async () => ({ status: 'error', reason: 'no-entry', error: new Error('unused') }),
        hydrateModule: () => { },
        readCharacter: async () => ({ status: 'error', error: new Error('unused') }),
        load: async () => ({ status: 'error', error: new Error('unused') }),
        hydrate: () => { },
        verdict: (target) => {
            harness.verdictCalls.push(String((target as { chaId?: unknown }).chaId))
            return 'clean'
        },
        stubFor: (target) => ({
            chaId: target.chaId,
            name: target.name,
            type: 'character',
            coldstorage: `u-${target.chaId}`,
            chatPage: 0,
        }) as never,
    }
    let stopPutBack: (() => void) | null = null

    beforeEach(() => {
        resetPutBackForTest()
        resetBusyActionsForTest()
        resetRestoredBytesForTest()
        registerResidency(residency)
    })

    afterEach(() => {
        stopPutBack?.()
        stopPutBack = null
        resetPutBackForTest()
    })

    test('F T48: a cancelled request leaves a loaded, unmarked character that the put-back finds as a candidate once the selection moves', async () => {
        const opened = tap(1)
        await drain()
        cancelHomeStudioOpen()
        // A residency read: the value carries the entity's `u`, which the install records for the put-back.
        const result = unitRead('alpha')
        noteResidencyRead(result, { status: 'ok', value: result.value, entry: { u: 'u-alpha' }, source: {}, bytes: 10, droppedAlt: [] } as never)
        await land('alpha', result)

        expect(await opened).toBe(false)
        expect(slot(1).coldstorage).toBeUndefined()
        expect(isFormatted(slot(1))).toBe(true)
        expect(loadedRecordOf(slot(1))).toEqual({ chaId: 'alpha', u: 'u-alpha' })
        expect(markCharacterForSave).not.toHaveBeenCalled()

        // The put-back runs only on a database of the archiving format.
        Object.assign(DBState.db, { formatversion: 5, archiveCharacters: true })
        stopPutBack = startCharacterPutBack()
        selectedCharID.set(0)
        const callbacks = harness.commits.splice(0)
        for (const callback of callbacks) callback()

        expect(harness.verdictCalls).toContain('alpha')
        expect(getPutBackCounters().clean).toBe(1)
        expect(slot(1).coldstorage).toBe('u-alpha')
    })
})
