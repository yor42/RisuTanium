/**
 * A Ctrl+[ / Ctrl+] character switch whose `changeChar` throws or rejects is reported through
 * `changeCharOrAlert` (characterPick.ts) instead of escaping the keydown listener, where it would
 * reach the window's raw error alert as an unhandled rejection.
 *
 * This file drives the REAL document keydown listener registered by initHotkey() in hotkey.ts, the
 * REAL characterPick.ts and the REAL characters.ts counter; only `changeChar` itself is wrapped so a
 * single call can reject or park. Module mocks follow hotkeyCharSwitch.svelte.test.ts.
 *
 * Labels: "regression reproducer" fails on the base for the defect it names; "guard" passes with or
 * without the change.
 */
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database, character } from './storage/database.svelte'

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

vi.mock(import('./platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('./platform'))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(),
    readFile: vi.fn(),
    BaseDirectory: { AppData: 0 },
}))

vi.mock(import('./stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        alertStore: writable({ type: 'none', msg: '' }),
        CharEmotion: writable({}),
        loadoutModalStore: { open: false },
        MobileGUIStack: writable(0),
        MobileSideBar: writable(0),
        openPersonaList: writable(false),
        openPresetList: writable(false),
        OpenRealmStore: writable(false),
        PlaygroundStore: writable(0),
        QuickSettings: { open: false, index: 0 },
        SafeModeStore: writable(false),
        selectedCharID: writable(-1),
        settingsOpen: writable(false),
    } as unknown as typeof import('./stores.svelte')
})

vi.mock(import('./storage/database.svelte'), async () => {
    const { DBState: liveDBState } = await import('./stores.svelte')
    return {
        getDatabase: vi.fn(() => liveDBState.db),
        setDatabase: vi.fn((db: Database) => { liveDBState.db = db }),
        changeToPreset: vi.fn(),
        presetTemplate: { name: 'test-preset' },
        saveImage: vi.fn(),
        defaultSdDataFunc: vi.fn(() => ({})),
        getCharacterByIndex: vi.fn((index: number) => liveDBState.db.characters?.[index]),
        setCharacterByIndex: vi.fn((index: number, char: unknown) => {
            liveDBState.db.characters[index] = char as never
        }),
    } as unknown as typeof import('./storage/database.svelte')
})

vi.mock(import('./alert'), () => ({
    alertMd: vi.fn(),
    alertSelect: vi.fn(),
    alertToast: vi.fn(),
    alertWait: vi.fn(),
    doingAlert: () => false,
    alertRequestLogs: vi.fn(),
    alertAddCharacter: vi.fn(),
    alertConfirm: vi.fn(async () => true),
    alertError: vi.fn(),
    alertNormal: vi.fn(),
}) as unknown as typeof import('./alert'))

vi.mock(import('./caughtErrors'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        recordCaughtError: vi.fn(actual.recordCaughtError),
    }
})

vi.mock(import('./gui/colorscheme'), () => ({
    updateTextThemeAndCSS: vi.fn(),
}) as unknown as typeof import('./gui/colorscheme'))

vi.mock(import('./process/index.svelte'), () => ({
    doingChat: writable(false),
    sendChat: vi.fn(),
}) as unknown as typeof import('./process/index.svelte'))

vi.mock(import('./util'), () => ({
    checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
    findCharacterbyId: vi.fn(),
    findCharacterIndexbyId: vi.fn(() => -1),
    getUserName: vi.fn(() => 'User'),
    selectMultipleFile: vi.fn(),
    selectSingleFile: vi.fn(),
}) as unknown as typeof import('./util'))

vi.mock(import('./media'), () => ({
    getImageType: vi.fn(),
}) as unknown as typeof import('./media'))

vi.mock(import('./process/inlayScreen'), () => ({
    updateInlayScreen: vi.fn(),
}) as unknown as typeof import('./process/inlayScreen'))

vi.mock(import('./parser/parser.svelte'), () => ({
    parseMarkdownSafe: vi.fn(),
    hasher: vi.fn((s: string) => s),
}) as unknown as typeof import('./parser/parser.svelte'))

vi.mock(import('./translator/translator'), () => ({
    translateHTML: vi.fn(),
}) as unknown as typeof import('./translator/translator'))

vi.mock(import('./characterCards'), () => ({
    importCharacter: vi.fn(),
}) as unknown as typeof import('./characterCards'))

vi.mock(import('./pngChunk'), () => ({
    PngChunk: class {},
}) as unknown as typeof import('./pngChunk'))

vi.mock(import('./process/coldstorage.svelte'), () => ({
    readColdStorageItem: vi.fn(),
}) as unknown as typeof import('./process/coldstorage.svelte'))

vi.mock(import('./media/avatarThumb'), () => ({
    getAvatarThumbSrc: vi.fn(),
    isThumbEligible: vi.fn(() => false),
}) as unknown as typeof import('./media/avatarThumb'))

vi.mock(import('./storage/characterSaveMarks'), () => ({
    markCharacterForSave: vi.fn(),
}) as unknown as typeof import('./storage/characterSaveMarks'))

vi.mock(import('./globalApi.svelte'), () => ({
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
}) as unknown as typeof import('./globalApi.svelte'))

//The real changeChar and counter stay; only changeChar is wrapped so one call can be made to reject or park.
vi.mock(import('./characters'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        changeChar: vi.fn(actual.changeChar),
    }
})

//#endregion

import { initHotkey } from './hotkey'
import { DBState, PlaygroundStore, OpenRealmStore, selectedCharID } from './stores.svelte'
import { doingChat } from './process/index.svelte'
import { alertError } from './alert'
import { recordCaughtError } from './caughtErrors'
import { language } from '../lang'
import { changeChar } from './characters'

//#region fixtures

// Array order deliberately does not match name order. Sorted by name: ALICE, BOB, CHARLIE, DANA.
const DANA = 0
const BOB = 1
const ALICE = 2
const CHARLIE = 3

function makeCharacter(name: string, chaId: string): character {
    return {
        type: 'character',
        name,
        chaId,
        chatPage: 0,
        newGenData: true,
        globalLore: [],
        chats: [{ id: `${chaId}-chat-1`, message: [], note: '', name: 'Chat 1', localLore: [] }],
    } as unknown as character
}

function resetFixture(){
    const characters: character[] = []
    characters[DANA] = makeCharacter('Dana', 'dana-1')
    characters[BOB] = makeCharacter('Bob', 'bob-1')
    characters[ALICE] = makeCharacter('Alice', 'alice-1')
    characters[CHARLIE] = makeCharacter('Charlie', 'charlie-1')
    DBState.db = { characters } as unknown as Database
    selectedCharID.set(-1)
    PlaygroundStore.set(0)
    OpenRealmStore.set(false)
    doingChat.set(false)
}

let keydownHandler: (ev: KeyboardEvent) => unknown
let unhandled: unknown[]
const onUnhandled = (reason: unknown) => { unhandled.push(reason) }

beforeEach(() => {
    unhandled = []
    process.on('unhandledRejection', onUnhandled)
    resetFixture()
    vi.mocked(alertError).mockClear()
    vi.mocked(recordCaughtError).mockClear()
    vi.mocked(changeChar).mockClear()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const addEventListenerSpy = vi.spyOn(document, 'addEventListener')
    initHotkey()
    const keydownCall = addEventListenerSpy.mock.calls.find(([type]) => type === 'keydown')
    keydownHandler = keydownCall![1] as (ev: KeyboardEvent) => unknown
    addEventListenerSpy.mockRestore()
})

afterEach(() => {
    process.off('unhandledRejection', onUnhandled)
    vi.restoreAllMocks()
})

function makeCtrlKeyEvent(key: string): KeyboardEvent {
    return new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true })
}

/** Invokes the real captured keydown listener and waits for it to settle, returning (not propagating) what it rejected with. */
async function fireAndCatch(key: string): Promise<unknown> {
    try {
        await keydownHandler(makeCtrlKeyEvent(key))
        return null
    } catch (e) {
        return e
    }
}

const firePrevChar = () => fireAndCatch('[')
const fireNextChar = () => fireAndCatch(']')

/** One macrotask: lets every promise reaction, and the runtime's unhandled-rejection check, run. */
const macrotask = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

//#endregion

describe('a character switch hotkey whose changeChar throws', () => {
    test.each([
        ['next', fireNextChar, BOB, CHARLIE, 'hotkey.next'],
        ['prev', firePrevChar, CHARLIE, BOB, 'hotkey.prev'],
    ])('regression reproducer: %s is reported once, translated, and leaves the selection and panels alone', async (_dir, fire, start, target, site) => {
        const failure = new TypeError('boom')
        selectedCharID.set(start)
        PlaygroundStore.set(1)
        OpenRealmStore.set(true)
        vi.mocked(changeChar).mockRejectedValueOnce(failure)

        const thrown = await fire()
        await macrotask()

        expect(thrown).toBeNull()
        expect(unhandled).toEqual([])
        expect(vi.mocked(changeChar)).toHaveBeenCalledWith(target)
        expect(vi.mocked(alertError).mock.calls).toEqual([[language.errors.coldStorageRestoreUnreadable]])
        expect(vi.mocked(recordCaughtError)).toHaveBeenCalledWith(site, failure)
        expect(get(selectedCharID)).toBe(start)
        expect(get(PlaygroundStore)).toBe(1)
        expect(get(OpenRealmStore)).toBe(true)
    })

    test('regression reproducer: a synchronous throw from changeChar is reported the same way', async () => {
        const failure = new TypeError('sync boom')
        selectedCharID.set(BOB)
        vi.mocked(changeChar).mockImplementationOnce(() => { throw failure })

        const thrown = await fireNextChar()
        await macrotask()

        expect(thrown).toBeNull()
        expect(unhandled).toEqual([])
        expect(vi.mocked(alertError).mock.calls).toEqual([[language.errors.coldStorageRestoreUnreadable]])
        expect(vi.mocked(recordCaughtError)).toHaveBeenCalledWith('hotkey.next', failure)
    })

    test('regression reproducer: a press the user has already moved past stays silent, the latest press decides', async () => {
        const failure = new TypeError('late boom')
        selectedCharID.set(BOB)
        let rejectFirst!: (error: Error) => void
        vi.mocked(changeChar).mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectFirst = reject }))

        const first = fireNextChar()
        await macrotask()
        const second = await fireNextChar()
        rejectFirst(failure)
        const firstThrown = await first
        await macrotask()

        expect(second).toBeNull()
        expect(firstThrown).toBeNull()
        expect(unhandled).toEqual([])
        expect(vi.mocked(alertError)).not.toHaveBeenCalled()
        expect(vi.mocked(recordCaughtError)).toHaveBeenCalledWith('hotkey.next', failure)
        expect(get(selectedCharID)).toBe(CHARLIE)
    })
})

describe('a character switch hotkey whose changeChar resolves without selecting', () => {
    test.each([
        ['superseded', 'superseded' as const],
        ['gone', 'gone' as const],
        ['failed', { failed: 'unreadable' } as const],
    ])('guard: a %s outcome adds no alert and leaves the panels alone', async (_name, outcome) => {
        selectedCharID.set(BOB)
        PlaygroundStore.set(1)
        OpenRealmStore.set(true)
        vi.mocked(changeChar).mockResolvedValueOnce(outcome)

        const thrown = await fireNextChar()
        await macrotask()

        expect(thrown).toBeNull()
        expect(unhandled).toEqual([])
        expect(vi.mocked(alertError)).not.toHaveBeenCalled()
        expect(vi.mocked(recordCaughtError)).not.toHaveBeenCalled()
        expect(get(selectedCharID)).toBe(BOB)
        expect(get(PlaygroundStore)).toBe(1)
        expect(get(OpenRealmStore)).toBe(true)
    })

    test('guard: a plain successful switch still resets the panels and shows nothing', async () => {
        selectedCharID.set(BOB)
        PlaygroundStore.set(1)
        OpenRealmStore.set(true)

        await fireNextChar()

        expect(get(selectedCharID)).toBe(CHARLIE)
        expect(get(PlaygroundStore)).toBe(0)
        expect(get(OpenRealmStore)).toBe(false)
        expect(vi.mocked(alertError)).not.toHaveBeenCalled()
    })
})
