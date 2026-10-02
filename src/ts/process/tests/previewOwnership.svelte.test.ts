/**
 * The preview starters (the `previewRequest` hotkey and DevTool's Preview
 * Prompt) and the chat switches, against a generation that is running or a
 * composer Send that has taken its input and not yet reached generation.
 *
 * Drives the REAL document keydown listener registered by `initHotkey()`
 * (`../../hotkey`), the REAL `runPreviewPrompt` (`../devToolActions`), the REAL
 * `changeChar` (`../../characters`) and the REAL composer
 * (`../composerActions.svelte`). `sendChat` and `doingChat` come from a mock
 * of `../index.svelte`: `doingChat` is a real store, `sendChat` a spy that
 * sets and clears nothing. That is what these tests need, because they ask
 * whether a starter calls `sendChat` at all and what it does to a flag it
 * does not own; they say nothing about what the real `sendChat` does with the
 * flag (`sendChatOwnership.svelte.test.ts` covers that). The composer's
 * window is opened by a real Send whose input step (`sendCharacterMessage`)
 * is a mock the test holds open.
 *
 * Tests whose title starts with `guard:` pass before and after the ownership
 * change: they pin behaviour that must be preserved.
 */
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database, character } from 'src/ts/storage/database.svelte'
import 'src/ts/polyfill'

//#region module mocks

const inputStepMock = vi.hoisted(() => vi.fn())

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
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/storage/database.svelte'), async () => {
    const { DBState: liveDBState } = await import('src/ts/stores.svelte')
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
    } as unknown as typeof import('src/ts/storage/database.svelte')
})

vi.mock(import('src/ts/alert'), () => ({
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
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/gui/colorscheme'), () => ({
    updateTextThemeAndCSS: vi.fn(),
}) as unknown as typeof import('src/ts/gui/colorscheme'))

vi.mock(import('src/ts/process/index.svelte'), () => ({
    doingChat: writable(false),
    sendChat: vi.fn(),
}) as unknown as typeof import('src/ts/process/index.svelte'))

vi.mock(import('src/ts/util'), () => ({
    checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
    findCharacterbyId: vi.fn(),
    findCharacterIndexbyId: vi.fn(() => -1),
    getUserName: vi.fn(() => 'User'),
    selectMultipleFile: vi.fn(),
    selectSingleFile: vi.fn(),
    sleep: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/media'), () => ({
    getImageType: vi.fn(),
}) as unknown as typeof import('src/ts/media'))

vi.mock(import('src/ts/process/inlayScreen'), () => ({
    updateInlayScreen: vi.fn(),
}) as unknown as typeof import('src/ts/process/inlayScreen'))

vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    parseMarkdownSafe: vi.fn(),
    hasher: vi.fn((s: string) => s),
}) as unknown as typeof import('src/ts/parser/parser.svelte'))

vi.mock(import('src/ts/translator/translator'), () => ({
    translateHTML: vi.fn(),
    isExpTranslator: vi.fn(() => false),
    translate: vi.fn(async () => ''),
}) as unknown as typeof import('src/ts/translator/translator'))

vi.mock(import('src/ts/characterCards'), () => ({
    importCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock(import('src/ts/pngChunk'), () => ({
    PngChunk: class {},
}) as unknown as typeof import('src/ts/pngChunk'))

vi.mock(import('src/ts/process/coldstorage.svelte'), () => ({
    getColdStorageItem: vi.fn(),
}) as unknown as typeof import('src/ts/process/coldstorage.svelte'))

vi.mock(import('src/ts/media/avatarThumb'), () => ({
    getAvatarThumbSrc: vi.fn(),
    isThumbEligible: vi.fn(() => false),
}) as unknown as typeof import('src/ts/media/avatarThumb'))

vi.mock(import('src/ts/storage/characterSaveMarks'), () => ({
    markCharacterForSave: vi.fn(),
}) as unknown as typeof import('src/ts/storage/characterSaveMarks'))

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

// The composer's input step (the input trigger and the input script) is the
// wait a test holds open to keep the composer's window open.
vi.mock(import('src/ts/process/sendCharacterMessage'), () => ({
    sendCharacterMessage: inputStepMock,
}) as unknown as typeof import('src/ts/process/sendCharacterMessage'))

vi.mock(import('src/ts/process/prereroll'), () => ({
    Prereroll: vi.fn(() => undefined),
    PreUnreroll: vi.fn(() => undefined),
}) as unknown as typeof import('src/ts/process/prereroll'))

vi.mock(import('src/ts/process/command'), () => ({
    processMultiCommand: vi.fn(async () => false),
}) as unknown as typeof import('src/ts/process/command'))

//#endregion

import { initHotkey } from 'src/ts/hotkey'
import { runPreviewPrompt } from 'src/ts/process/devToolActions'
import { send, resetComposerActionsForTests, type ComposerActionsSource } from 'src/ts/process/composerActions.svelte'
import * as composerDrafts from 'src/ts/process/composerDrafts.svelte'
import { DBState, selectedCharID } from 'src/ts/stores.svelte'
import { doingChat, sendChat } from 'src/ts/process/index.svelte'
import { alertMd, alertWait } from 'src/ts/alert'
import { changeChar } from 'src/ts/characters'
import { resetLocalDraftsForTest } from 'src/ts/localDrafts'

//#region fixtures

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
        newGenData: true, // skips characterFormatUpdate's updateInlayScreen call, mocked to a bare vi.fn() above
        globalLore: [],
        chats: [{ id: `${chaId}-chat-1`, message: [], note: '', name: 'Chat 1', localLore: [] }],
    } as unknown as character
}

function resetFixture() {
    const characters: character[] = []
    characters[DANA] = makeCharacter('Dana', 'dana-1')
    characters[BOB] = makeCharacter('Bob', 'bob-1')
    characters[ALICE] = makeCharacter('Alice', 'alice-1')
    characters[CHARLIE] = makeCharacter('Charlie', 'charlie-1')
    DBState.db = { characters } as unknown as Database
    selectedCharID.set(-1)
    doingChat.set(false)
}

let keydownHandler: (ev: KeyboardEvent) => unknown

beforeEach(() => {
    resetFixture()
    resetLocalDraftsForTest()
    vi.mocked(sendChat).mockReset()
    vi.mocked(alertMd).mockClear()
    vi.mocked(alertWait).mockClear()
    inputStepMock.mockReset()
    const addEventListenerSpy = vi.spyOn(document, 'addEventListener')
    initHotkey()
    const keydownCall = addEventListenerSpy.mock.calls.find(([type]) => type === 'keydown')
    keydownHandler = keydownCall![1] as (ev: KeyboardEvent) => unknown
    addEventListenerSpy.mockRestore()
})

afterEach(() => {
    resetComposerActionsForTests()
    vi.restoreAllMocks()
})

function makeCtrlKeyEvent(key: string): KeyboardEvent {
    return new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true })
}

/** Invokes the captured keydown listener for the preview hotkey and waits for it to settle. */
async function pressPreviewHotkey(): Promise<void> {
    await keydownHandler(makeCtrlKeyEvent('u'))
}

function makeSource(): ComposerActionsSource {
    return { closeMenu: () => {} }
}

async function settle(): Promise<void> {
    await new Promise<void>((res) => setTimeout(res, 0))
}

/**
 * Opens the composer's window on Bob's chat: a Send whose input step is held
 * open. `close` lets the step end without appending anything, which ends the
 * Send and closes the window.
 */
async function openComposerWindow(): Promise<{ close: () => Promise<void> }> {
    selectedCharID.set(BOB)
    let release: () => void = () => {}
    const gate = new Promise<void>((res) => { release = res })
    let markReached: () => void = () => {}
    const reached = new Promise<void>((res) => { markReached = res })
    inputStepMock.mockImplementation(async () => {
        markReached()
        await gate
        return false
    })
    composerDrafts.write({ chaId: 'bob-1', chatId: 'bob-1-chat-1' }, (record) => { record.messageInput = 'hello' })
    const sending = send(makeSource())
    await reached
    return {
        close: async () => {
            release()
            await sending
        },
    }
}

//#endregion

describe('the preview hotkey while a generation is running', () => {
    test('at Home, it leaves the flag set and sends nothing', async () => {
        selectedCharID.set(-1)
        doingChat.set(true)

        await pressPreviewHotkey()

        expect.soft(get(doingChat)).toBe(true)
        expect.soft(vi.mocked(sendChat)).not.toHaveBeenCalled()
        expect.soft(vi.mocked(alertWait)).not.toHaveBeenCalled()
    })

    test('guard: with a character selected, it leaves the flag set and sends nothing', async () => {
        selectedCharID.set(BOB)
        doingChat.set(true)

        await pressPreviewHotkey()

        expect(get(doingChat)).toBe(true)
        expect(vi.mocked(sendChat)).not.toHaveBeenCalled()
    })
})

describe('DevTool Preview Prompt while a generation is running', () => {
    test('guard: it leaves the flag set and sends nothing', async () => {
        selectedCharID.set(BOB)
        doingChat.set(true)

        await runPreviewPrompt('normal', 'prompt', 'chatml', '')

        expect(get(doingChat)).toBe(true)
        expect(vi.mocked(sendChat)).not.toHaveBeenCalled()
        expect(vi.mocked(alertWait)).not.toHaveBeenCalled()
    })
})

describe('the previews while the composer\'s Send waits on its input step', () => {
    test('the preview hotkey does nothing', async () => {
        const composerWindow = await openComposerWindow()

        await pressPreviewHotkey()
        const sent = vi.mocked(sendChat).mock.calls.length
        const shown = vi.mocked(alertWait).mock.calls.length
        await composerWindow.close()

        expect.soft(sent).toBe(0)
        expect.soft(shown).toBe(0)
    })

    test('DevTool Preview Prompt does nothing', async () => {
        const composerWindow = await openComposerWindow()

        await runPreviewPrompt('normal', 'prompt', 'chatml', '')
        const sent = vi.mocked(sendChat).mock.calls.length
        const shown = vi.mocked(alertWait).mock.calls.length
        await composerWindow.close()

        expect.soft(sent).toBe(0)
        expect.soft(shown).toBe(0)
    })
})

describe('switching characters', () => {
    test('guard: changeChar is refused while the flag is set', async () => {
        selectedCharID.set(BOB)
        doingChat.set(true)

        await changeChar(CHARLIE)

        expect(get(selectedCharID)).toBe(BOB)
    })

    test('guard: changeChar is accepted during the composer\'s wait on its input step', async () => {
        const composerWindow = await openComposerWindow()
        expect(get(doingChat)).toBe(false)

        await changeChar(CHARLIE)
        const selected = get(selectedCharID)
        await settle()
        await composerWindow.close()

        expect(selected).toBe(CHARLIE)
    })
})
