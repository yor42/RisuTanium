// @vitest-environment jsdom

/**
 * The restore with the real pick path: `startLastCharacterRestore` with its production sources over the
 * real `changeChar` (through `changeCharOrAlert`), `restoreColdCharacter`, `utilityGate`, `studioOpen` and
 * `homeView`. The unit read of an archived character is a deferred promise the test settles, so a surface
 * can open while the restore waits. A surface that opens is not a `changeChar`; what keeps the late
 * selection from landing over it is the watcher's `supersedeChangeChar`, and the assertion is that the
 * selection stays at Home (-1), which is exactly what keeps the Home or Utility branch on screen.
 *
 * The library case drives the real `openHomeLibrary`: `homeView` is rune state, so the watcher hears it
 * through a microtask flush, which runs before the later task that completes the unit read.
 *
 * Fixtures are built like the real producer: the stub comes from `buildColdStub(full, key, [])` and the unit
 * value is `{ character: coldUnitCharacter(full) }`.
 */

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
    const selectedCharID = writable(-1)
    selectedCharID.subscribe((value) => {
        selection.selId = value
    })
    return {
        DBState: state,
        selIdState: selection,
        selectedCharID,
        CharEmotion: writable({}),
        MobileGUIStack: writable([]),
        OpenRealmStore: writable(false),
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
        PlaygroundStore: writable(0),
        CustomGUISettingMenuStore: writable(false),
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
    afterNextSaveCommit: vi.fn(),
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

vi.mock(import('src/ts/caughtErrors'), () => ({
    recordCaughtError: vi.fn(),
}) as unknown as typeof import('src/ts/caughtErrors'))

//#endregion

import { flushSync } from 'svelte'
import { DBState, selectedCharID, settingsOpen, OpenRealmStore, PlaygroundStore, CustomGUISettingMenuStore, botMakerMode } from 'src/ts/stores.svelte'
import { alertError } from 'src/ts/alert'
import { buildColdStub, coldUnitCharacter } from 'src/ts/process/coldCharacter'
import { resetRetainedForTest } from 'src/ts/process/coldRetained'
import { resetChatOnScreenForTests } from 'src/ts/process/chatOnScreen.svelte'
import { studioOpen } from 'src/ts/studio/studioOpen'
import { utilityOpen } from 'src/lib/Utility/utilityGate'
import { homeView, openHomeLibrary, showHomeLanding } from 'src/lib/UI/Home/homeView.svelte'
import { LAST_CHARACTER_KEY, writeLastChaId } from './lastCharacterMemory'
import { startLastCharacterRestore } from './lastCharacterRestore'

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

/** Slot 0 is warm, slot 1 an archived character. */
let alphaFull: character

function installArchive(): void {
    alphaFull = fullCharacter('alpha')
    DBState.db = {
        didFirstSetup: true,
        characters: [
            fullCharacter('zero', { scenario: '' }),
            buildColdStub(alphaFull, 'unit-alpha', []),
        ],
    } as unknown as Database
}

interface PendingRead {
    resolve: (result: unknown) => void
    settled: boolean
}

let reads: PendingRead[] = []

function holdReads(): void {
    reads = []
    readSpy.mockImplementation(() => new Promise((resolve) => {
        reads.push({ resolve, settled: false })
    }))
}

function drain(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0))
}

/** Settles the pending unit read with the producer's value and lets everything that follows run. */
async function landAlpha(): Promise<void> {
    const read = reads.find((candidate) => !candidate.settled)
    expect(read, 'the unit read is pending').toBeDefined()
    read!.settled = true
    read!.resolve({ status: 'ok', value: { character: coldUnitCharacter(alphaFull) } })
    await drain()
}

function resetSurfaces(): void {
    settingsOpen.set(false)
    studioOpen.set(false)
    utilityOpen.set(false)
    OpenRealmStore.set(false)
    PlaygroundStore.set(0)
    CustomGUISettingMenuStore.set(false)
    botMakerMode.set(false)
    selectedCharID.set(-1)
    showHomeLanding()
    flushSync()
}

beforeEach(() => {
    readSpy.mockReset()
    vi.mocked(alertError).mockClear()
    resetRetainedForTest()
    resetChatOnScreenForTests()
    localStorage.clear()
    resetSurfaces()
    installArchive()
    holdReads()
})

afterEach(() => {
    resetSurfaces()
    resetRetainedForTest()
    resetChatOnScreenForTests()
    localStorage.clear()
})

//#endregion

describe('the restore of an archived last character, through the real changeChar', () => {
    test('I1: with no surface opened, the archived character is restored and selected, keeping its last interaction', async () => {
        writeLastChaId('alpha')
        const end = startLastCharacterRestore()
        await drain()

        expect(get(selectedCharID)).toBe(-1)
        await landAlpha()

        expect(await end).toBe('selected')
        expect(get(selectedCharID)).toBe(1)
        expect(slot(1).coldstorage).toBeUndefined()
        expect(slot(1).lastInteraction).toBe(LONG_AGO)
        expect(alertError).not.toHaveBeenCalled()
        expect(localStorage.getItem(LAST_CHARACTER_KEY)).toBe('{"chaId":"alpha"}')
    })

    test('I1: a warm last character is selected before the first render, with nothing pending', async () => {
        writeLastChaId('zero')
        const end = startLastCharacterRestore()

        expect(get(selectedCharID)).toBe(0)
        expect(await end).toBe('selected')
        expect(readSpy).not.toHaveBeenCalled()
    })

    const surfaces: Array<[string, () => void]> = [
        ['Settings', () => settingsOpen.set(true)],
        ['Utility (I1-U)', () => utilityOpen.set(true)],
        ['the Hub (I1-H)', () => OpenRealmStore.set(true)],
        ['the Home library through the real openHomeLibrary (I1-L)', () => openHomeLibrary()],
    ]

    test.each(surfaces)('I1: %s opened while the unit read is pending: the selection stays at Home after the read lands', async (_name, open) => {
        writeLastChaId('alpha')
        const end = startLastCharacterRestore()
        await drain()

        open()
        await landAlpha()

        expect(await end).toBe('superseded')
        expect(get(selectedCharID)).toBe(-1)
        expect(slot(1).lastInteraction).toBe(LONG_AGO)
        expect(localStorage.getItem(LAST_CHARACTER_KEY)).toBe('{"chaId":"alpha"}')
    })

    test('I1-L: the library is open, not a mere landing, when the restore is superseded', async () => {
        writeLastChaId('alpha')
        const end = startLastCharacterRestore()
        await drain()

        openHomeLibrary()
        await landAlpha()
        await end

        expect(homeView.view).toBe('library')
        expect(get(selectedCharID)).toBe(-1)
    })

    test('I1: a restore that starts with the library already open does not pick at all', async () => {
        writeLastChaId('alpha')
        openHomeLibrary()

        expect(await startLastCharacterRestore()).toBe('skipped')
        expect(readSpy).not.toHaveBeenCalled()
        expect(get(selectedCharID)).toBe(-1)
    })
})
