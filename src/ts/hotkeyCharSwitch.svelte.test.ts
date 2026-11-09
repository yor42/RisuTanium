/**
 * The Ctrl+[ / Ctrl+] hotkeys (prevChar / nextChar in hotkey.ts) walk
 * `database.characters` sorted by name, the same list and order a sidebar
 * click uses. This file drives the REAL document keydown listener
 * registered by initHotkey() in hotkey.ts, and the REAL changeChar /
 * characterFormatUpdate in characters.ts, so the switch a hotkey performs
 * can be checked against the switch a sidebar click performs.
 *
 * Every module hotkey.ts and characters.ts import is mocked below, merging
 * the mocking pattern already used for each file separately: hotkey.test.ts
 * (this directory) for hotkey.ts's own dependencies, and
 * characters.newChatIdentity.svelte.test.ts for characters.ts's. DBState is
 * a shared $state object (this file's .svelte.test.ts extension is what
 * makes $state usable in the vi.mock factory below, the same convention
 * characters.newChatIdentity.svelte.test.ts uses), so both hotkey.ts's
 * getDatabase() and characters.ts's changeChar read and write the same
 * live database the tests set up.
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
    // Dynamic import of an already-mocked module resolves to that same mock
    // (Vitest hoists vi.mock factories before this one runs), so
    // getCharacterByIndex/setCharacterByIndex below read and write the same
    // live DBState.db that getDatabase() hands to hotkey.ts.
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

//#endregion

import { initHotkey } from './hotkey'
import { DBState, PlaygroundStore, OpenRealmStore, selectedCharID } from './stores.svelte'
import { doingChat } from './process/index.svelte'
import { readColdStorageItem } from './process/coldstorage.svelte'
import { beginWork } from './process/chatOrigin'
import { alertError } from './alert'
import { language } from '../lang'
import { changeChar, characterFormatUpdate } from './characters'

//#region fixtures

// Array order deliberately does not match name order, so a test that only
// passes when the array is walked in array order (skipping the sort) is
// exposed.
const DANA = 0
const BOB = 1
const ALICE = 2
const CHARLIE = 3
// Sorted by name: ALICE, BOB, CHARLIE, DANA.

function makeCharacter(name: string, chaId: string): character {
    return {
        type: 'character',
        name,
        chaId,
        chatPage: 0,
        newGenData: true, // skips characterFormatUpdate's updateInlayScreen call, mocked to a bare vi.fn() above
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

beforeEach(() => {
    resetFixture()
    const addEventListenerSpy = vi.spyOn(document, 'addEventListener')
    initHotkey()
    const keydownCall = addEventListenerSpy.mock.calls.find(([type]) => type === 'keydown')
    keydownHandler = keydownCall![1] as (ev: KeyboardEvent) => unknown
    addEventListenerSpy.mockRestore()
})

afterEach(() => {
    vi.restoreAllMocks()
})

function makeCtrlKeyEvent(key: string): KeyboardEvent {
    return new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true })
}

/** Invokes the real captured keydown listener and waits for it to settle, catching (not propagating) a thrown/rejected error so a crash shows up as a normal assertion. */
async function fireAndCatch(key: string): Promise<unknown> {
    try {
        await keydownHandler(makeCtrlKeyEvent(key))
        return null
    } catch (e) {
        return e
    }
}

async function firePrevChar(){
    return fireAndCatch('[')
}

async function fireNextChar(){
    return fireAndCatch(']')
}

//#endregion

describe('sanity: characters.ts loads for real under these mocks', () => {
    // Diagnostic: establishes that changeChar and characterFormatUpdate are
    // the real implementations (not stubs) before trusting the state-based
    // assertions below that depend on their exact fill and refusal rules.
    test('changeChar fills a missing chat id via characterFormatUpdate', async () => {
        const cha = makeCharacter('Standalone', 'standalone-1')
        delete (cha.chats[0] as { id?: string }).id
        DBState.db = { characters: [cha] } as unknown as Database

        await changeChar(0)

        expect(DBState.db.characters[0].chats[0].id).toBeTruthy()
        expect(get(selectedCharID)).toBe(0)
    })

    test('characterFormatUpdate is exported and callable directly', () => {
        const cha = makeCharacter('Standalone', 'standalone-2')
        expect(() => characterFormatUpdate(cha)).not.toThrow()
    })
})

describe('nextChar / prevChar cycle database.characters sorted by name', () => {
    // Guard: a middle-of-the-list move already works today.
    test('nextChar from a middle character selects the next one in name order', async () => {
        selectedCharID.set(BOB)

        await fireNextChar()

        expect(get(selectedCharID)).toBe(CHARLIE)
    })

    // Guard: a middle-of-the-list move already works today.
    test('prevChar from a middle character selects the previous one in name order', async () => {
        selectedCharID.set(CHARLIE)

        await firePrevChar()

        expect(get(selectedCharID)).toBe(BOB)
    })

    // Regression reproducer: nextChar's bounds check refuses at the first
    // character (it should only refuse at the last).
    test('nextChar from the first character in name order does move', async () => {
        selectedCharID.set(ALICE)

        await fireNextChar()

        expect(get(selectedCharID)).toBe(BOB)
    })

    // Regression reproducer: prevChar's bounds check refuses at the last
    // character (it should only refuse at the first).
    test('prevChar from the last character in name order does move', async () => {
        selectedCharID.set(DANA)

        await firePrevChar()

        expect(get(selectedCharID)).toBe(CHARLIE)
    })

    // Guard: nextChar already correctly refuses at the last character.
    test('nextChar on the last character in name order leaves the selection unchanged', async () => {
        selectedCharID.set(DANA)

        await fireNextChar()

        expect(get(selectedCharID)).toBe(DANA)
    })

    // Guard: prevChar already correctly refuses at the first character.
    test('prevChar on the first character in name order leaves the selection unchanged', async () => {
        selectedCharID.set(ALICE)

        await firePrevChar()

        expect(get(selectedCharID)).toBe(ALICE)
    })
})

describe('nextChar / prevChar from Home (no character selected)', () => {
    // Guard: from Home, nextChar selects the first character in name order.
    test('nextChar from Home selects the first character in name order', async () => {
        selectedCharID.set(-1)

        await fireNextChar()

        expect(get(selectedCharID)).toBe(ALICE)
    })

    // Regression reproducer: prevChar from Home reads the element before
    // index -1 and throws instead of wrapping to the last character.
    test('prevChar from Home selects the last character in name order, without throwing', async () => {
        selectedCharID.set(-1)

        const thrown = await firePrevChar()

        expect(thrown).toBeNull()
        expect(get(selectedCharID)).toBe(DANA)
    })

    // Guard: with no characters at all, both hotkeys already leave Home
    // alone rather than throwing.
    test('with no characters at all, nextChar and prevChar from Home do nothing and do not throw', async () => {
        DBState.db = { characters: [] } as unknown as Database
        selectedCharID.set(-1)

        const nextThrown = await fireNextChar()
        expect(nextThrown).toBeNull()
        expect(get(selectedCharID)).toBe(-1)

        const prevThrown = await firePrevChar()
        expect(prevThrown).toBeNull()
        expect(get(selectedCharID)).toBe(-1)
    })
})

describe('nextChar / prevChar switch through the same path as a sidebar click', () => {
    // Regression reproducer (T7): a reply in progress never blocks the switch,
    // the same as for a sidebar click.
    test('switches while a reply is being generated', async () => {
        selectedCharID.set(BOB)
        PlaygroundStore.set(1)
        OpenRealmStore.set(true)
        doingChat.set(true)
        const reply = beginWork(DBState.db.characters[BOB], DBState.db.characters[BOB].chats[0], undefined, undefined, 'reply')

        await fireNextChar()
        reply?.end()

        expect(get(selectedCharID)).toBe(CHARLIE)
        expect(get(PlaygroundStore)).toBe(0)
        expect(get(OpenRealmStore)).toBe(false)
    })

    // A cold-storage placeholder is restored before it is selected:
    // the switch goes through the same restore a click uses.
    test('restores a cold-storage placeholder before selecting it', async () => {
        (DBState.db.characters[CHARLIE] as unknown as { coldstorage?: string }).coldstorage = 'cold-key-1'
        DBState.db.characters[CHARLIE].chaId = 'charlie-cold-chaid'
        vi.mocked(readColdStorageItem).mockResolvedValueOnce({
            status: 'ok',
            value: { character: makeCharacter('Charlie', 'charlie-cold-chaid') },
        })
        selectedCharID.set(BOB)

        await fireNextChar()

        expect((DBState.db.characters[CHARLIE] as unknown as { coldstorage?: string }).coldstorage).toBeFalsy()
        expect(get(selectedCharID)).toBe(CHARLIE)
    })

    // Regression reproducer: prevChar/nextChar never call characterFormatUpdate,
    // so a target with a chat missing its id keeps that gap after the switch.
    test('fills a missing chat id on the target character, as a click would', async () => {
        delete (DBState.db.characters[BOB].chats[0] as { id?: string }).id
        delete (DBState.db.characters[BOB] as unknown as { chaId?: string }).chaId
        selectedCharID.set(CHARLIE)

        await firePrevChar()

        expect(DBState.db.characters[BOB].chats[0].id).toBeTruthy()
        expect(DBState.db.characters[BOB].chaId).toBeTruthy()
        expect(get(selectedCharID)).toBe(BOB)
    })

    // Guard: a plain, successful switch already resets these two stores today.
    test('after a successful switch, PlaygroundStore is 0 and OpenRealmStore is false', async () => {
        selectedCharID.set(BOB)
        PlaygroundStore.set(1)
        OpenRealmStore.set(true)

        await fireNextChar()

        expect(get(selectedCharID)).toBe(CHARLIE)
        expect(get(PlaygroundStore)).toBe(0)
        expect(get(OpenRealmStore)).toBe(false)
    })

    // A refused restore keeps the selection: the failure used here is a unit
    // that holds another character (its chaId differs from the placeholder's),
    // which the restore refuses, leaving the placeholder in place and telling
    // the user.
    test('does not switch when the cold-storage restore is refused', async () => {
        (DBState.db.characters[CHARLIE] as unknown as { coldstorage?: string }).coldstorage = 'cold-key-1'
        DBState.db.characters[CHARLIE].chaId = 'charlie-cold-chaid'
        vi.mocked(alertError).mockClear()
        vi.mocked(readColdStorageItem).mockResolvedValueOnce({
            status: 'ok',
            value: { character: makeCharacter('Charlie', 'mismatched-chaid') },
        })
        selectedCharID.set(BOB)

        await fireNextChar()

        expect(get(selectedCharID)).toBe(BOB)
        expect((DBState.db.characters[CHARLIE] as unknown as { coldstorage?: string }).coldstorage).toBe('cold-key-1')
        expect(vi.mocked(alertError)).toHaveBeenCalledWith(language.errors.coldStorageRestoreFailed)
    })
})

describe('nextChar / prevChar consume the keypress synchronously', () => {
    // Regression reproducer: previewRequest calls preventDefault/stopPropagation
    // before its own await, so the browser never sees this key's default action
    // and no other listener sees the event either. nextChar/prevChar must do
    // the same, before their await on changeChar, not after it settles.
    test('nextChar prevents default and stops propagation before changeChar settles', async () => {
        selectedCharID.set(BOB)
        const ev = makeCtrlKeyEvent(']')
        const preventDefaultSpy = vi.spyOn(ev, 'preventDefault')
        const stopPropagationSpy = vi.spyOn(ev, 'stopPropagation')

        const pending = keydownHandler(ev)

        expect(preventDefaultSpy).toHaveBeenCalled()
        expect(stopPropagationSpy).toHaveBeenCalled()

        await pending
    })

    // A matched hotkey is consumed synchronously, whether or not a reply is
    // being generated, the same as every other matched hotkey in this listener.
    test('nextChar prevents default and stops propagation while a reply is being generated', async () => {
        selectedCharID.set(BOB)
        doingChat.set(true)
        const ev = makeCtrlKeyEvent(']')
        const preventDefaultSpy = vi.spyOn(ev, 'preventDefault')
        const stopPropagationSpy = vi.spyOn(ev, 'stopPropagation')

        const pending = keydownHandler(ev)

        expect(preventDefaultSpy).toHaveBeenCalled()
        expect(stopPropagationSpy).toHaveBeenCalled()

        await pending
        expect(get(selectedCharID)).toBe(CHARLIE)
    })
})
