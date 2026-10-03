// @vitest-environment happy-dom

/**
 * Save and Discard buttons of the mobilechat message editor.
 *
 * Mounts the REAL `Chat.svelte` against the real draft gate
 * (`src/ts/draftContentOrphanGate.ts`) and `src/ts/localDrafts.ts`. The heavy
 * modules Chat pulls in (globalApi, database, parser, translator, process/*,
 * util, characters) are mocked as in `Chat.messageEditor.svelte.test.ts`;
 * `ChatBody` and `PartialEditController` are stubbed. `alertConfirm` is a
 * controllable mock, so a mocked answer says nothing about the real dialog.
 *
 * Guards (pass with or without the buttons): "the standard theme shows no Save
 * or Discard while editing" and "a mouse long-press on the editor still
 * discards without asking".
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
    alertNormal: vi.fn(),
    alertWait: vi.fn(),
    alertInput: vi.fn(async () => ''),
    alertRequestData: vi.fn(),
    alertSelect: vi.fn(async () => '1'),
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
import { alertConfirm } from 'src/ts/alert'
import { language } from 'src/lang'
import Chat from './Chat.svelte'
import { draftContentOrphanGate } from 'src/ts/draftContentOrphanGate'
import { type MessageIdentity } from 'src/ts/draftContents'
import { chatWindowKey } from 'src/ts/chatWindowPolicy'
import { hasLocalDrafts, resetLocalDraftsForTest } from 'src/ts/localDrafts'

//#region fixture helpers

function baseDb(overrides: Partial<Record<string, unknown>> = {}) {
    return {
        askRemoval: false,
        instantRemove: false,
        translatorType: 'none',
        translateBeforeHTMLFormatting: false,
        legacyTranslation: false,
        requestInfoInsideChat: false,
        clickToEdit: true,
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
        theme: 'mobilechat',
        guiHTML: '',
        roundIcons: false,
        ...overrides,
    }
}

interface Fixture {
    target: HTMLElement
    chat: { id: string; message: Array<{ role: string; data: string; chatId?: string }> }
    identity: MessageIdentity
}

function setup(theme = 'mobilechat'): Fixture {
    DBState.db = baseDb({ theme }) as never
    const chat = {
        id: 'chat-1',
        message: [{ role: 'char', data: 'original', chatId: 'chat-id-1' }],
        bookmarks: [] as string[],
        bookmarkNames: {} as Record<string, string>,
    }
    DBState.db.characters = [{ chaId: 'char-1', type: 'character', ttsMode: 'none', chatPage: 0, chats: [chat] }] as never
    selIdState.selId = 0
    const target = document.createElement('div')
    document.body.appendChild(target)
    targets.push(target)
    instances.push(mount(Chat, { target, props: { idx: 0, message: 'original', isLastMemory: false, role: 'char' } }))
    flushSync()
    const identity: MessageIdentity = { kind: 'msg', chatKey: chatWindowKey('char-1', chat as never), chatId: 'chat-id-1', index: 0 }
    return { target, chat, identity }
}

const targets: HTMLElement[] = []
const instances: unknown[] = []

afterEach(async () => {
    vi.useRealTimers()
    for (const instance of instances.splice(0)) {
        await unmount(instance as never).catch(() => {})
    }
    targets.splice(0).forEach((t) => t.remove())
    document.body.replaceChildren()
    draftContentOrphanGate.clear()
    resetLocalDraftsForTest()
    vi.clearAllMocks()
})

beforeEach(() => {
    window.innerWidth = 1024
    selectedCharID.set(0)
})

function openEditor(target: HTMLElement) {
    target.querySelector<HTMLElement>('.chattext')!.click()
    flushSync()
}

function type(target: HTMLElement, text: string) {
    const textarea = target.querySelector<HTMLTextAreaElement>('textarea.message-edit-area')!
    textarea.value = text
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
}

function buttonLabelled(root: ParentNode, label: string): HTMLButtonElement | undefined {
    return Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.trim() === label)
}

function bubble(target: HTMLElement): HTMLElement {
    return target.querySelector<HTMLElement>('.risu-chat .bg-gray-100')!
}

function editorOpen(target: HTMLElement): boolean {
    return target.querySelector('textarea.message-edit-area') !== null
}

function deferredConfirm() {
    let resolve!: (v: boolean) => void
    const promise = new Promise<boolean>((r) => { resolve = r })
    vi.mocked(alertConfirm).mockImplementationOnce(() => promise)
    return resolve
}

//#endregion

describe('mobilechat editor: Save and Discard buttons', () => {
    test('opening the editor shows Save and Discard after the text paragraph, outside it', () => {
        const { target } = setup()
        expect(bubble(target).querySelector('button')).toBeNull()
        openEditor(target)

        const paragraph = bubble(target).querySelector('p')!
        const save = buttonLabelled(bubble(target), language.messageEditSave)
        const discard = buttonLabelled(bubble(target), language.messageEditDiscard)
        expect(editorOpen(target)).toBe(true)
        expect(save).toBeDefined()
        expect(discard).toBeDefined()
        for (const btn of [save!, discard!]) {
            expect(btn.type).toBe('button')
            expect(paragraph.contains(btn)).toBe(false)
            expect(paragraph.compareDocumentPosition(btn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
            expect(btn.className).not.toMatch(/button-icon-/)
        }
    })

    test('Save writes the edited text into the message and closes the editor', async () => {
        const { target, identity } = setup()
        openEditor(target)
        type(target, 'edited text')
        await tick()

        buttonLabelled(bubble(target), language.messageEditSave)!.click()
        flushSync()

        expect(DBState.db.characters[0].chats[0].message[0].data).toBe('edited text')
        expect(editorOpen(target)).toBe(false)
        expect(draftContentOrphanGate.get(identity, 'original')).toBeUndefined()
        expect(alertConfirm).not.toHaveBeenCalled()
    })

    test('Discard with the buffer equal to the base text exits without asking', () => {
        const { target } = setup()
        openEditor(target)

        buttonLabelled(bubble(target), language.messageEditDiscard)!.click()
        flushSync()

        expect(alertConfirm).not.toHaveBeenCalled()
        expect(editorOpen(target)).toBe(false)
        expect(DBState.db.characters[0].chats[0].message[0].data).toBe('original')
    })

    test('Discard with a changed buffer asks, and answering no keeps the editor and the text', async () => {
        const { target, identity } = setup()
        openEditor(target)
        type(target, 'half typed')
        await tick()
        const answer = deferredConfirm()

        buttonLabelled(bubble(target), language.messageEditDiscard)!.click()
        flushSync()
        expect(alertConfirm).toHaveBeenCalledTimes(1)
        expect(alertConfirm).toHaveBeenCalledWith(language.messageEditDiscardConfirm)
        answer(false)
        await tick()
        await tick()

        expect(editorOpen(target)).toBe(true)
        expect(target.querySelector<HTMLTextAreaElement>('textarea.message-edit-area')!.value).toBe('half typed')
        expect(draftContentOrphanGate.get(identity, 'original')).toEqual({ text: 'half typed', baseData: 'original', updatedAt: expect.any(Number) })
        expect(DBState.db.characters[0].chats[0].message[0].data).toBe('original')
    })

    test('Discard with a changed buffer and answer yes exits and deletes the draft', async () => {
        const { target, identity } = setup()
        openEditor(target)
        type(target, 'half typed')
        await tick()
        const answer = deferredConfirm()

        buttonLabelled(bubble(target), language.messageEditDiscard)!.click()
        flushSync()
        answer(true)
        await tick()
        await tick()

        expect(editorOpen(target)).toBe(false)
        expect(draftContentOrphanGate.get(identity, 'original')).toBeUndefined()
        expect(hasLocalDrafts()).toBe(false)
        expect(DBState.db.characters[0].chats[0].message[0].data).toBe('original')
    })

    test('typing and then deleting back to the base text lets Discard exit without asking', async () => {
        const { target } = setup()
        openEditor(target)
        type(target, 'original plus')
        type(target, 'original')
        await tick()

        buttonLabelled(bubble(target), language.messageEditDiscard)!.click()
        flushSync()

        expect(alertConfirm).not.toHaveBeenCalled()
        expect(editorOpen(target)).toBe(false)
    })

    test('a restored draft asks before Discard, and after Revert it does not', async () => {
        const { target, identity } = setup()
        draftContentOrphanGate.set(identity, 'recovered draft', 'original')
        openEditor(target)
        expect(target.querySelector<HTMLTextAreaElement>('textarea.message-edit-area')!.value).toBe('recovered draft')

        const answer = deferredConfirm()
        buttonLabelled(bubble(target), language.messageEditDiscard)!.click()
        flushSync()
        expect(alertConfirm).toHaveBeenCalledTimes(1)
        answer(false)
        await tick()
        await tick()
        expect(editorOpen(target)).toBe(true)

        buttonLabelled(bubble(target), language.draftRevert)!.click()
        flushSync()
        vi.mocked(alertConfirm).mockClear()
        buttonLabelled(bubble(target), language.messageEditDiscard)!.click()
        flushSync()

        expect(alertConfirm).not.toHaveBeenCalled()
        expect(editorOpen(target)).toBe(false)
    })

    test('Discard is disabled while its confirmation is open, so a second tap queues no second dialog', async () => {
        const { target } = setup()
        openEditor(target)
        type(target, 'half typed')
        await tick()
        const answer = deferredConfirm()

        const discard = buttonLabelled(bubble(target), language.messageEditDiscard)!
        discard.click()
        flushSync()
        expect(discard.disabled).toBe(true)
        discard.click()
        flushSync()
        expect(alertConfirm).toHaveBeenCalledTimes(1)

        answer(false)
        await tick()
        await tick()
        expect(buttonLabelled(bubble(target), language.messageEditDiscard)!.disabled).toBe(false)
    })

    test('an answer that arrives after the editor was saved and reopened leaves the new session and its draft alone', async () => {
        const { target, identity } = setup()
        openEditor(target)
        type(target, 'first session text')
        await tick()
        const answer = deferredConfirm()

        buttonLabelled(bubble(target), language.messageEditDiscard)!.click()
        flushSync()
        // The dialog is still open: the user saves, then starts a new edit.
        buttonLabelled(bubble(target), language.messageEditSave)!.click()
        flushSync()
        expect(editorOpen(target)).toBe(false)
        openEditor(target)
        type(target, 'second session text')
        await tick()
        const base = DBState.db.characters[0].chats[0].message[0].data
        expect(base).toBe('first session text')
        expect(draftContentOrphanGate.get(identity, base)).toEqual({ text: 'second session text', baseData: base, updatedAt: expect.any(Number) })

        answer(true)
        await tick()
        await tick()

        expect(editorOpen(target)).toBe(true)
        expect(target.querySelector<HTMLTextAreaElement>('textarea.message-edit-area')!.value).toBe('second session text')
        expect(draftContentOrphanGate.get(identity, base)).toEqual({ text: 'second session text', baseData: base, updatedAt: expect.any(Number) })
    })

    test('an answer that arrives after the editor was saved changes nothing', async () => {
        const { target } = setup()
        openEditor(target)
        type(target, 'half typed')
        await tick()
        const answer = deferredConfirm()

        buttonLabelled(bubble(target), language.messageEditDiscard)!.click()
        flushSync()
        buttonLabelled(bubble(target), language.messageEditSave)!.click()
        flushSync()
        answer(true)
        await tick()
        await tick()

        expect(editorOpen(target)).toBe(false)
        expect(DBState.db.characters[0].chats[0].message[0].data).toBe('half typed')
    })
})

describe('mobilechat editor: guards', () => {
    // Guard: the standard theme keeps the pencil/long-press flow and gains no buttons.
    test('the standard theme shows no Save or Discard while editing', () => {
        const { target } = setup('')
        target.querySelector<HTMLButtonElement>('.button-icon-edit')!.click()
        flushSync()

        expect(editorOpen(target)).toBe(true)
        expect(buttonLabelled(target, 'Save')).toBeUndefined()
        expect(buttonLabelled(target, 'Discard')).toBeUndefined()
    })

    // Guard: the mouse long-press is a deliberate discard and asks nothing.
    test('a mouse long-press on the editor still discards with no dialog', async () => {
        const { target, identity } = setup()
        openEditor(target)
        type(target, 'discard me')
        await tick()

        vi.useFakeTimers()
        const textarea = target.querySelector<HTMLTextAreaElement>('textarea.message-edit-area')!
        textarea.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
        vi.advanceTimersByTime(600)
        flushSync()
        vi.useRealTimers()

        expect(alertConfirm).not.toHaveBeenCalled()
        expect(editorOpen(target)).toBe(false)
        expect(draftContentOrphanGate.get(identity, 'original')).toBeUndefined()
        expect(DBState.db.characters[0].chats[0].message[0].data).toBe('original')
    })

    // Guard: a touch long-press on the editor never discards or saves.
    test('a touch held 600 ms on the editor does nothing', async () => {
        const { target, identity } = setup()
        openEditor(target)
        type(target, 'keep me')
        await tick()

        vi.useFakeTimers()
        const textarea = target.querySelector<HTMLTextAreaElement>('textarea.message-edit-area')!
        const pt = { identifier: 1, target: textarea, clientX: 10, clientY: 10 }
        textarea.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [pt] as unknown as Touch[], changedTouches: [pt] as unknown as Touch[] }))
        vi.advanceTimersByTime(600)
        flushSync()
        vi.useRealTimers()

        expect(editorOpen(target)).toBe(true)
        expect(alertConfirm).not.toHaveBeenCalled()
        expect(draftContentOrphanGate.get(identity, 'original')).toEqual({ text: 'keep me', baseData: 'original', updatedAt: expect.any(Number) })
    })
})
