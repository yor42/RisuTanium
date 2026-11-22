/**
 * The Ctrl+[ / Ctrl+] hotkeys (prevChar / nextChar in hotkey.ts) cycle through
 * `database.characters` sorted by name, skipping the characters no list shows:
 * the Playground's `'§playground'` utility bot, a stray `'§temp'` copy left by
 * an upstream multiuser save, and any trashed character. At the first or last
 * visible character the hotkey does nothing, and when the selected character is
 * itself outside the cycle (the Playground, Home) the hotkey enters it at the
 * first or last visible character. An ordinary character named 'assistant' is
 * part of the cycle.
 *
 * This file drives the REAL document keydown listener registered by
 * initHotkey() and the REAL changeChar in characters.ts. The module mocks copy
 * `hotkeyCharSwitch.svelte.test.ts` (same directory), except that `./util`
 * spreads its real exports under the stubbed functions.
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
    isIOS: () => false,
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

vi.mock(import('./gui/colorscheme'), () => ({
    updateTextThemeAndCSS: vi.fn(),
}) as unknown as typeof import('./gui/colorscheme'))

vi.mock(import('./process/index.svelte'), () => ({
    doingChat: writable(false),
    sendChat: vi.fn(),
}) as unknown as typeof import('./process/index.svelte'))

vi.mock(import('./util'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        findCharacterIndexbyId: vi.fn(() => -1),
        getUserName: vi.fn(() => 'User'),
    }
})

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

//#endregion

import { initHotkey } from './hotkey'
import { DBState, selectedCharID } from './stores.svelte'
import { doingChat as doingChatStore } from './process/index.svelte'
import type { Writable } from 'svelte/store'
const doingChat = doingChatStore as Writable<boolean>

//#region fixtures

function makeCharacter(name: string, chaId: string, extra: Record<string, unknown> = {}): character {
    return {
        type: 'character',
        name,
        chaId,
        chatPage: 0,
        newGenData: true,
        globalLore: [],
        chats: [{ id: `${chaId}-chat-1`, message: [], note: '', name: 'Chat 1', localLore: [] }],
        ...extra,
    } as unknown as character
}

const TRASHED = { trashTime: 1_700_000_000_000 }

// Array order deliberately differs from name order. Sorted by name:
// Alice, assistant (Playground), Bob, Bobby Temp, Carl (trashed), Charlie, Dana.
const MIDDLE = {
    DANA: 0,
    PLAYGROUND: 1,
    TEMP: 2,
    TRASHED: 3,
    ALICE: 4,
    BOB: 5,
    CHARLIE: 6,
}

function middleFixture(): character[] {
    const characters: character[] = []
    characters[MIDDLE.DANA] = makeCharacter('Dana', 'dana-1')
    characters[MIDDLE.PLAYGROUND] = makeCharacter('assistant', '§playground', { utilityBot: true })
    characters[MIDDLE.TEMP] = makeCharacter('Bobby Temp', '§temp')
    characters[MIDDLE.TRASHED] = makeCharacter('Carl', 'carl-1', TRASHED)
    characters[MIDDLE.ALICE] = makeCharacter('Alice', 'alice-1')
    characters[MIDDLE.BOB] = makeCharacter('Bob', 'bob-1')
    characters[MIDDLE.CHARLIE] = makeCharacter('Charlie', 'charlie-1')
    return characters
}

// Hidden entries sit before the first and after the last visible character.
// Sorted by name: Aaa Temp, Alice, assistant (Playground), Bob, Zzz (trashed).
const EDGES = {
    TEMP: 0,
    PLAYGROUND: 1,
    ALICE: 2,
    BOB: 3,
    TRASHED: 4,
}

function edgeFixture(): character[] {
    const characters: character[] = []
    characters[EDGES.TEMP] = makeCharacter('Aaa Temp', '§temp')
    characters[EDGES.PLAYGROUND] = makeCharacter('assistant', '§playground', { utilityBot: true })
    characters[EDGES.ALICE] = makeCharacter('Alice', 'alice-1')
    characters[EDGES.BOB] = makeCharacter('Bob', 'bob-1')
    characters[EDGES.TRASHED] = makeCharacter('Zzz', 'zzz-1', TRASHED)
    return characters
}

function install(characters: character[], selected = -1): void {
    DBState.db = { characters } as unknown as Database
    selectedCharID.set(selected)
    doingChat.set(false)
}

let keydownHandler: (ev: KeyboardEvent) => unknown

beforeEach(() => {
    const addEventListenerSpy = vi.spyOn(document, 'addEventListener')
    initHotkey()
    const keydownCall = addEventListenerSpy.mock.calls.find(([type]) => type === 'keydown')
    keydownHandler = keydownCall![1] as (ev: KeyboardEvent) => unknown
    addEventListenerSpy.mockRestore()
})

afterEach(() => {
    vi.restoreAllMocks()
})

async function press(key: '[' | ']'): Promise<void> {
    await keydownHandler(new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true }))
}

//#endregion

describe('nextChar / prevChar skip the Playground, the stray temp copy and trashed characters', () => {
    test('nextChar steps over the Playground between two ordinary characters', async () => {
        install(middleFixture(), MIDDLE.ALICE)

        await press(']')

        expect(get(selectedCharID)).toBe(MIDDLE.BOB)
    })

    test('prevChar steps over the Playground between two ordinary characters', async () => {
        install(middleFixture(), MIDDLE.BOB)

        await press('[')

        expect(get(selectedCharID)).toBe(MIDDLE.ALICE)
    })

    test('nextChar steps over a stray temp copy and a trashed character', async () => {
        install(middleFixture(), MIDDLE.BOB)

        await press(']')

        expect(get(selectedCharID)).toBe(MIDDLE.CHARLIE)
    })

    test('prevChar steps over a trashed character and a stray temp copy', async () => {
        install(middleFixture(), MIDDLE.CHARLIE)

        await press('[')

        expect(get(selectedCharID)).toBe(MIDDLE.BOB)
    })

    test('nextChar at the last visible character does nothing when a trashed character sorts after it', async () => {
        install(edgeFixture(), EDGES.BOB)

        await press(']')

        expect(get(selectedCharID)).toBe(EDGES.BOB)
    })

    test('prevChar at the first visible character does nothing when a stray temp copy sorts before it', async () => {
        install(edgeFixture(), EDGES.ALICE)

        await press('[')

        expect(get(selectedCharID)).toBe(EDGES.ALICE)
    })

    test('nextChar from the Playground goes to the first visible character in name order', async () => {
        install(middleFixture(), MIDDLE.PLAYGROUND)

        await press(']')

        expect(get(selectedCharID)).toBe(MIDDLE.ALICE)
    })

    test('prevChar from the Playground goes to the last visible character in name order', async () => {
        install(middleFixture(), MIDDLE.PLAYGROUND)

        await press('[')

        expect(get(selectedCharID)).toBe(MIDDLE.DANA)
    })

    // Guard: passes with and without the filter; the cycle's ends and Home
    // entry keep working with hidden entries present.
    test('guard: nextChar from Home selects the first visible character and prevChar from Home the last', async () => {
        install(middleFixture(), -1)
        await press(']')
        expect(get(selectedCharID)).toBe(MIDDLE.ALICE)

        install(middleFixture(), -1)
        await press('[')
        expect(get(selectedCharID)).toBe(MIDDLE.DANA)
    })

    // Guard: passes with and without the filter; stepping between two
    // ordinary neighbours with no hidden entry between them is unchanged.
    test('guard: nextChar from Charlie reaches Dana, the last visible character, and nextChar there does nothing', async () => {
        install(middleFixture(), MIDDLE.CHARLIE)

        await press(']')
        expect(get(selectedCharID)).toBe(MIDDLE.DANA)

        await press(']')
        expect(get(selectedCharID)).toBe(MIDDLE.DANA)
    })

    // Guard: passes with and without the filter; an ordinary character named
    // 'assistant' stays in the cycle.
    test('guard: an ordinary character named "assistant" is part of the cycle', async () => {
        const characters = [makeCharacter('Alice', 'alice-1'), makeCharacter('assistant', 'named-assistant-id'), makeCharacter('Bob', 'bob-1')]
        install(characters, 0)

        await press(']')
        expect(get(selectedCharID)).toBe(1)

        await press(']')
        expect(get(selectedCharID)).toBe(2)
    })
})
