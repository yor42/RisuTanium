// @vitest-environment happy-dom

/**
 * The copy button of the REAL `Chat.svelte` puts the message's plain text on
 * the clipboard.
 *
 * Invariants pinned here:
 *  - a tap calls `navigator.clipboard.writeText` once, with the message text,
 *    synchronously inside the click handler (before any await), so the
 *    browser still counts it as a user gesture;
 *  - a tap writes only plain text: no `clipboard.write`, no network fetch, and
 *    nothing it waits on (markdown rendering, file lookups) can delay or
 *    prevent the write;
 *  - when the clipboard API is absent or rejects, `document.execCommand('copy')`
 *    is the fallback, and the message's status line shows `Copied` or
 *    `<name of the first failure>: Copy failed`;
 *  - a rejected write leaves no unhandled rejection;
 *  - the status clears after its timeout, and an older timer never clears a
 *    newer status.
 *
 * Both `navigator.clipboard.write` and `navigator.clipboard.writeText` are
 * recording stubs and `fetch` is a recording stub; nothing here touches a real
 * clipboard or network. A passing test says nothing about a real browser's
 * gesture or permission rules.
 */

import { flushSync, mount, unmount } from 'svelte'
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
    alertSelect: vi.fn(async () => ''),
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
import { getFileSrc } from 'src/ts/globalApi.svelte'
import { ParseMarkdown } from 'src/ts/parser/parser.svelte'
import { alertClear, alertNormal, alertWait } from 'src/ts/alert'
import { language } from 'src/lang'
import Chat from './Chat.svelte'

//#region fixtures and helpers

const MESSAGE = 'hello **world**'
const COPY_FAILED = 'Copy failed'

function setupDb(): void {
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
        useChatCopy: true,
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
        characters: [{
            chaId: 'char-a',
            type: 'character',
            ttsMode: 'none',
            chatPage: 0,
            chats: [{
                id: 'chat-a',
                message: [{ role: 'char', data: MESSAGE, chatId: 'id-1' }],
                bookmarks: [] as string[],
                bookmarkNames: {} as Record<string, string>,
            }],
        }],
    } as never
    selIdState.selId = 0
}

const mountedTargets: HTMLElement[] = []
const mountedInstances: unknown[] = []

async function mountChat(message: string = MESSAGE): Promise<HTMLElement> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    mountedInstances.push(mount(Chat, { target, props: { idx: 0, message, isLastMemory: false } }))
    flushSync()
    await settle()
    return target
}

/** Lets every promise continuation and zero-delay timer that is ready run, then flushes the DOM. */
async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 20))
    flushSync()
}

function copyButton(root: HTMLElement): HTMLButtonElement {
    const button = root.querySelector<HTMLButtonElement>('.button-icon-copy')
    expect(button, 'the copy button').not.toBeNull()
    return button!
}

function statusText(root: HTMLElement): string {
    const span = root.querySelector('.grow > span.text-xs')
    expect(span, 'the status span').not.toBeNull()
    return span!.textContent ?? ''
}

interface ClipboardStub {
    write: ReturnType<typeof vi.fn>
    writeText: ReturnType<typeof vi.fn>
}

const realClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
const realExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand')

/** Replaces `navigator.clipboard` with recording stubs for both `write` and `writeText`. */
function stubClipboard(writeText: () => Promise<void> = async () => {}): ClipboardStub {
    const stub: ClipboardStub = {
        write: vi.fn(async () => {}),
        writeText: vi.fn(writeText),
    }
    Object.defineProperty(navigator, 'clipboard', { value: stub, configurable: true })
    return stub
}

function removeClipboard(): void {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
}

function stubExecCommand(result: boolean): ReturnType<typeof vi.fn> {
    const exec = vi.fn(() => result)
    Object.defineProperty(document, 'execCommand', { value: exec, configurable: true, writable: true })
    return exec
}

function removeExecCommand(): void {
    Object.defineProperty(document, 'execCommand', { value: undefined, configurable: true, writable: true })
}

function deniedError(): DOMException {
    return new DOMException('denied', 'NotAllowedError')
}

const unhandled: unknown[] = []
const onUnhandled = (reason: unknown) => {
    unhandled.push(reason)
}

let fetchStub: ReturnType<typeof vi.fn>

beforeEach(() => {
    window.innerWidth = 1024
    setupDb()
    selectedCharID.set(0)
    unhandled.length = 0
    process.on('unhandledRejection', onUnhandled)
    fetchStub = vi.fn(async () => ({ ok: false }))
    vi.stubGlobal('fetch', fetchStub)
    vi.mocked(ParseMarkdown).mockImplementation(async (text: string) => text)
    vi.mocked(getFileSrc).mockImplementation(async () => '')
    removeExecCommand()
})

afterEach(async () => {
    vi.useRealTimers()
    process.off('unhandledRejection', onUnhandled)
    for (const instance of mountedInstances.splice(0)) {
        await unmount(instance as never).catch(() => {})
    }
    mountedTargets.splice(0).forEach((t) => t.remove())
    document.body.replaceChildren()
    vi.unstubAllGlobals()
    if (realClipboard) {
        Object.defineProperty(navigator, 'clipboard', realClipboard)
    } else {
        Reflect.deleteProperty(navigator, 'clipboard')
    }
    if (realExecCommand) {
        Object.defineProperty(document, 'execCommand', realExecCommand)
    } else {
        Reflect.deleteProperty(document, 'execCommand')
    }
    vi.clearAllMocks()
})

//#endregion

describe('a tap on the copy button', () => {
    test('calls writeText once with the message text inside the click handler, and never clipboard.write', async () => {
        const clipboard = stubClipboard()
        const root = await mountChat()

        copyButton(root).click()

        // No await between the click and these assertions: the write must happen
        // synchronously inside the handler.
        expect(clipboard.writeText).toHaveBeenCalledTimes(1)
        expect(clipboard.writeText).toHaveBeenCalledWith(MESSAGE)
        expect(clipboard.write).not.toHaveBeenCalled()

        await settle()
        expect(clipboard.writeText).toHaveBeenCalledTimes(1)
        expect(clipboard.write).not.toHaveBeenCalled()
    })

    test('calls writeText synchronously even when markdown rendering and file lookups never settle', async () => {
        const clipboard = stubClipboard()
        const root = await mountChat()
        vi.mocked(ParseMarkdown).mockImplementation(() => new Promise<string>(() => {}))
        vi.mocked(getFileSrc).mockImplementation(() => new Promise<string>(() => {}))

        copyButton(root).click()

        expect(clipboard.writeText).toHaveBeenCalledTimes(1)
        expect(clipboard.writeText).toHaveBeenCalledWith(MESSAGE)
        expect(clipboard.write).not.toHaveBeenCalled()
    })

    test('makes no network request for an image in the message', async () => {
        const clipboard = stubClipboard()
        const message = 'look <img src="https://x.example/a.png"> here'
        const root = await mountChat(message)

        copyButton(root).click()
        await settle()

        expect(fetchStub).not.toHaveBeenCalled()
        expect(clipboard.writeText).toHaveBeenCalledTimes(1)
        expect(clipboard.writeText).toHaveBeenCalledWith(message)
    })

    test('shows Copied, and shows no alert, after a successful write', async () => {
        stubClipboard()
        const root = await mountChat()

        copyButton(root).click()
        await settle()

        expect(statusText(root)).toBe(language.copied)
        expect(alertWait).not.toHaveBeenCalled()
        expect(alertNormal).not.toHaveBeenCalled()
        expect(alertClear).not.toHaveBeenCalled()
    })
})

describe('a tap on the copy button when the clipboard write is rejected', () => {
    test('shows the name of the rejection with Copy failed, calls writeText once and leaves no unhandled rejection when execCommand is absent', async () => {
        const clipboard = stubClipboard(async () => {
            throw deniedError()
        })
        const root = await mountChat()

        copyButton(root).click()
        await settle()

        expect(statusText(root)).toBe(`NotAllowedError: ${COPY_FAILED}`)
        expect(clipboard.writeText).toHaveBeenCalledTimes(1)
        expect(unhandled).toEqual([])
    })

    test('falls back to execCommand copy and shows Copied when it returns true', async () => {
        const clipboard = stubClipboard(async () => {
            throw deniedError()
        })
        const exec = stubExecCommand(true)
        const root = await mountChat()

        copyButton(root).click()
        await settle()

        expect(exec).toHaveBeenCalledTimes(1)
        expect(exec).toHaveBeenCalledWith('copy')
        expect(statusText(root)).toBe(language.copied)
        expect(clipboard.writeText).toHaveBeenCalledTimes(1)
        expect(unhandled).toEqual([])
    })

    test('shows the first failure when the execCommand fallback returns false', async () => {
        const clipboard = stubClipboard(async () => {
            throw deniedError()
        })
        const exec = stubExecCommand(false)
        const root = await mountChat()

        copyButton(root).click()
        await settle()

        expect(exec).toHaveBeenCalledTimes(1)
        expect(statusText(root)).toBe(`NotAllowedError: ${COPY_FAILED}`)
        expect(clipboard.writeText).toHaveBeenCalledTimes(1)
        expect(unhandled).toEqual([])
    })

    test('names a non-Error rejection UnknownError', async () => {
        stubClipboard(async () => {
            throw 'denied'
        })
        const root = await mountChat()

        copyButton(root).click()
        await settle()

        expect(statusText(root)).toBe(`UnknownError: ${COPY_FAILED}`)
        expect(unhandled).toEqual([])
    })
})

describe('a tap on the copy button when the clipboard API is absent', () => {
    test('falls back to execCommand copy and shows Copied when it returns true', async () => {
        removeClipboard()
        const exec = stubExecCommand(true)
        const root = await mountChat()

        copyButton(root).click()
        await settle()

        expect(exec).toHaveBeenCalledTimes(1)
        expect(exec).toHaveBeenCalledWith('copy')
        expect(statusText(root)).toBe(language.copied)
        expect(unhandled).toEqual([])
    })

    test('shows NotSupportedError with Copy failed when execCommand is absent too', async () => {
        removeClipboard()
        const root = await mountChat()

        copyButton(root).click()
        await settle()

        expect(statusText(root)).toBe(`NotSupportedError: ${COPY_FAILED}`)
        expect(unhandled).toEqual([])
    })
})

describe('the status line of a copy', () => {
    test('clears after its timeout', async () => {
        stubClipboard()
        const root = await mountChat()
        vi.useFakeTimers()

        copyButton(root).click()
        await vi.advanceTimersByTimeAsync(0)
        flushSync()
        expect(statusText(root)).toBe(language.copied)

        await vi.advanceTimersByTimeAsync(60_000)
        flushSync()

        expect(statusText(root)).toBe('')
    })

    test('is not cleared by the timer of an older status', async () => {
        const clipboard = stubClipboard()
        const root = await mountChat()
        vi.useFakeTimers()

        copyButton(root).click()
        await vi.advanceTimersByTimeAsync(0)
        flushSync()
        expect(statusText(root)).toBe(language.copied)

        // The success timeout is shorter than 2 s + 1.5 s, the failure timeout is longer.
        await vi.advanceTimersByTimeAsync(2000)
        clipboard.writeText.mockImplementationOnce(async () => {
            throw deniedError()
        })
        copyButton(root).click()
        await vi.advanceTimersByTimeAsync(0)
        flushSync()
        expect(statusText(root)).toBe(`NotAllowedError: ${COPY_FAILED}`)

        await vi.advanceTimersByTimeAsync(1500)
        flushSync()
        expect(statusText(root), 'the failure is still shown after the older timer expired').toBe(`NotAllowedError: ${COPY_FAILED}`)

        await vi.advanceTimersByTimeAsync(60_000)
        flushSync()
        expect(statusText(root)).toBe('')
    })
})
