// @vitest-environment happy-dom

/**
 * Touch and mouse long-press on the message delete button of `Chat.svelte`.
 *
 * A long-press asks the "remove only this / remove this and following"
 * question through `alertSelect` (the force-delete flow); an ordinary tap
 * removes the message directly (the fixture has `askRemoval` and
 * `instantRemove` off). The mocked `alertSelect` answers "cancel", so the
 * number of `alertSelect` calls counts long-presses and the message count
 * counts ordinary deletes. Timers are fake; touches are plain objects.
 *
 * Guards (behaviour that must hold with or without touch support): a mouse
 * held 600 ms asks once, a mouse released early does not, a tap released at
 * 300 ms and a touch that moves 20 px are not long-presses.
 *
 * The real `Chat.svelte` is mounted with the heavy modules mocked as in
 * `Chat.removeMessage.svelte.test.ts`; a mocked dialog says nothing about the
 * real one.
 */

import { flushSync, mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

//#region module mocks

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Record<string, unknown> })
    const selId = $state({ selId: 0 })
    return {
        DBState: state,
        selIdState: selId,
        selectedCharID: writable(-1),
        ReloadGUIPointer: writable(0),
        ReloadChatPointer: writable({} as Record<number, number>),
        CurrentTriggerIdStore: writable(null),
        popupStore: { children: null, mouseX: 0, mouseY: 0, openId: 0 },
        HideIconStore: writable(false),
        createSimpleCharacter: vi.fn(() => null),
        bookmarkListOpen: writable(false),
        ScrollToMessageStore: { value: -1 },
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    aiLawApplies: vi.fn(() => false),
    changeChatTo: vi.fn(),
    foldChatToMessage: vi.fn(),
    getFileSrc: vi.fn(async () => ''),
    createChatCopyName: vi.fn((name: string) => `${name} Branch`),
    downloadFile: vi.fn(),
    fetchNative: vi.fn(),
    readImage: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getCurrentCharacter: vi.fn(() => null),
    getCurrentChat: vi.fn(() => null),
    setCurrentChat: vi.fn(),
    getDatabase: vi.fn(() => {
        throw new Error('no live database in tests')
    }),
    setDatabase: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/alert'), () => ({
    alertClear: vi.fn(),
    alertConfirm: vi.fn(async () => true),
    alertSelect: vi.fn(async () => '1'),
    alertNormal: vi.fn(),
    alertWait: vi.fn(),
    alertInput: vi.fn(async () => ''),
    alertRequestData: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    ParseMarkdown: vi.fn(async (text: string) => text),
}) as unknown as typeof import('src/ts/parser/parser.svelte'))

vi.mock(import('src/ts/translator/translator'), () => ({
    getLLMCache: vi.fn(async () => null),
    setLLMCache: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/translator/translator'))

vi.mock(import('src/ts/process/scriptings'), () => ({
    runLuaButtonTrigger: vi.fn(async () => null),
}) as unknown as typeof import('src/ts/process/scriptings'))

vi.mock(import('src/ts/process/scripts'), () => ({
    risuChatParser: vi.fn((text: string) => text ?? ''),
}) as unknown as typeof import('src/ts/process/scripts'))

vi.mock(import('src/ts/process/triggers'), () => ({
    runTrigger: vi.fn(async () => null),
}) as unknown as typeof import('src/ts/process/triggers'))

vi.mock(import('src/ts/process/tts'), () => ({
    sayTTS: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/process/tts'))

vi.mock(import('src/ts/gui/colorscheme'), () => ({
    ColorSchemeTypeStore: writable('dark'),
}) as unknown as typeof import('src/ts/gui/colorscheme'))

vi.mock(import('src/ts/model/modellist'), () => ({
    getModelInfo: vi.fn(() => ({ shortName: 'test-model' })),
}) as unknown as typeof import('src/ts/model/modellist'))

vi.mock(import('src/ts/util'), () => ({
    capitalize: vi.fn((s: string) => s),
    getUserIcon: vi.fn(() => ''),
    getUserName: vi.fn(() => 'User'),
    sleep: vi.fn(async () => {}),
    findCharacterbyId: vi.fn(() => null),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/characters'), () => ({
    getCharImage: vi.fn(() => ''),
}) as unknown as typeof import('src/ts/characters'))

vi.mock('./ChatBody.svelte', () => ({
    default: (_target: unknown) => ({ destroy: () => {} }),
}))
vi.mock('./PartialEditController.svelte', () => ({
    default: (_target: unknown) => ({ destroy: () => {} }),
}))

//#endregion

import { DBState, selIdState, selectedCharID } from 'src/ts/stores.svelte'
import { alertSelect } from 'src/ts/alert'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import Chat from './Chat.svelte'

//#region fixtures

interface Pt {
    identifier: number
    target: EventTarget
    clientX: number
    clientY: number
}

const targets: HTMLElement[] = []
const instances: unknown[] = []
let trash: HTMLButtonElement

function messageCount(): number {
    return DBState.db.characters[0].chats[0].message.length
}

function setup() {
    DBState.db = {
        askRemoval: false,
        instantRemove: false,
        translatorType: 'none',
        translateBeforeHTMLFormatting: false,
        legacyTranslation: false,
        requestInfoInsideChat: false,
        clickToEdit: false,
        zoomsize: 100,
        lineHeight: 1.25,
        enableBlockPartialEdit: false,
        enableDragPartialEdit: false,
        useChatCopy: false,
        translator: '',
        swipe: false,
        showFirstMessagePages: false,
        enableBookmark: true,
        createFolderOnBranch: false,
        iconsize: 100,
        memoryLimitThickness: 2,
        theme: 'default',
        guiHTML: '',
        roundIcons: false,
    } as never
    DBState.db.characters = [{
        chaId: 'char-a',
        type: 'character',
        ttsMode: 'none',
        chatPage: 0,
        chats: [{
            id: 'chat-a',
            message: ['m1', 'm2', 'm3'].map((data, i) => ({ role: i % 2 === 0 ? 'user' : 'char', data, chatId: `id-${data}` })),
            bookmarks: [],
            bookmarkNames: {},
        }],
    }] as never
    selIdState.selId = 0
    const target = document.createElement('div')
    document.body.appendChild(target)
    targets.push(target)
    instances.push(mount(Chat, { target, props: { idx: 1, message: 'm2', isLastMemory: false } }))
    flushSync()
    trash = target.querySelector<HTMLButtonElement>('.button-icon-remove')!
    expect(trash).not.toBeNull()
}

function pt(x = 50, y = 50): Pt {
    return { identifier: 1, target: trash, clientX: x, clientY: y }
}

function touch(type: string, touches: Pt[], changed: Pt[] = touches) {
    trash.dispatchEvent(new TouchEvent(type, {
        bubbles: true,
        cancelable: true,
        touches: touches as unknown as Touch[],
        changedTouches: changed as unknown as Touch[],
    }))
}

async function advance(ms: number) {
    vi.advanceTimersByTime(ms)
    await tick()
}

/** A finger down and up on the button, then the click a browser sends after a tap. */
async function tap() {
    touch('touchstart', [pt()])
    await advance(100)
    touch('touchend', [], [pt()])
    trash.click()
    await advance(10)
}

beforeEach(() => {
    window.innerWidth = 1024
    selectedCharID.set(0)
    resetCharacterSaveMarksForTest()
    const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
    installCharacterSaveMarks({ tracker, schedule: vi.fn() })
    setup()
    vi.useFakeTimers()
})

afterEach(async () => {
    vi.useRealTimers()
    for (const instance of instances.splice(0)) {
        await unmount(instance as never).catch(() => {})
    }
    targets.splice(0).forEach((t) => t.remove())
    document.body.replaceChildren()
    resetCharacterSaveMarksForTest()
    vi.clearAllMocks()
})

//#endregion

describe('delete button: touch long-press', () => {
    test('a touch held 600 ms runs the force-delete flow once, and a later tap deletes exactly once', async () => {
        touch('touchstart', [pt()])
        await advance(600)
        expect(alertSelect).toHaveBeenCalledTimes(1)
        touch('touchend', [], [pt()])
        await advance(10)
        expect(messageCount()).toBe(3)

        await advance(1000)
        await tap()
        expect(alertSelect).toHaveBeenCalledTimes(1)
        expect(messageCount()).toBe(2)
    })

    test('a click the browser sends after the held touch is swallowed, and a later tap deletes once', async () => {
        touch('touchstart', [pt()])
        await advance(600)
        touch('touchend', [], [pt()])
        trash.click()
        await advance(10)
        expect(alertSelect).toHaveBeenCalledTimes(1)
        expect(messageCount()).toBe(3)

        await advance(1000)
        await tap()
        expect(alertSelect).toHaveBeenCalledTimes(1)
        expect(messageCount()).toBe(2)
    })

    test('compatibility mouse events after a held touch do not run the flow a second time', async () => {
        touch('touchstart', [pt()])
        await advance(600)
        expect(alertSelect).toHaveBeenCalledTimes(1)
        touch('touchend', [], [pt()])
        await advance(20)
        trash.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
        trash.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }))
        await advance(600)
        expect(alertSelect).toHaveBeenCalledTimes(1)
    })

    test('a compatibility mousedown with no mouseup after a held touch does not run the flow a second time', async () => {
        touch('touchstart', [pt()])
        await advance(600)
        expect(alertSelect).toHaveBeenCalledTimes(1)
        touch('touchend', [], [pt()])
        await advance(20)
        trash.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
        await advance(600)
        expect(alertSelect).toHaveBeenCalledTimes(1)
    })

    test('the delete button turns off native text selection and the touch callout', () => {
        expect(trash.classList.contains('select-none')).toBe(true)
        expect(trash.classList.contains('[-webkit-touch-callout:none]')).toBe(true)
    })

    // Guard: a short tap is an ordinary delete and no long-press.
    test('a touch released at 300 ms deletes once through the click and starts no long-press', async () => {
        touch('touchstart', [pt()])
        await advance(300)
        touch('touchend', [], [pt()])
        trash.click()
        await advance(600)
        expect(alertSelect).not.toHaveBeenCalled()
        expect(messageCount()).toBe(2)
    })

    // Guard: a moving finger is a scroll, not a long-press.
    test('a touch that moves 20 px at 200 ms starts no long-press', async () => {
        touch('touchstart', [pt(50, 50)])
        await advance(200)
        touch('touchmove', [pt(70, 50)])
        await advance(600)
        expect(alertSelect).not.toHaveBeenCalled()
        expect(messageCount()).toBe(3)
    })
})

describe('delete button: mouse long-press', () => {
    // Guard: the mouse path is unchanged.
    test('a mouse held 600 ms runs the force-delete flow once', async () => {
        trash.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
        await advance(600)
        expect(alertSelect).toHaveBeenCalledTimes(1)
    })

    // Guard.
    test('a mouse released before 500 ms does not run the flow and its click deletes once', async () => {
        trash.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
        await advance(300)
        trash.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }))
        trash.click()
        await advance(600)
        expect(alertSelect).not.toHaveBeenCalled()
        expect(messageCount()).toBe(2)
    })
})
