// @vitest-environment happy-dom

/**
 * Opening Settings closes a message's open editors without discarding what was typed.
 *
 * Mounts the REAL `Chat.svelte` against the REAL `draftContentOrphanGate`, `draftContents`,
 * `localDrafts` and `chatWindowPolicy`, with the heavy collaborators mocked exactly as in
 * `Chat.draftRestoreMarker.svelte.test.ts`. The surface's close signal is driven by bumping
 * `chatSurface.closeEpoch` directly, which is what the surface does when Settings opens.
 *
 * Invariants pinned here:
 *  - after Settings opens, no message editor draft is registered, so the multi-tab auto-reload
 *    and the draft-aware window policy see no open editor;
 *  - the typed text stays in the stored draft record and is offered again when the editor is
 *    reopened;
 *  - the editors stay open when the signal does not fire.
 *
 * Tests whose title starts with `guard:` pass with or without the fix.
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
    alertError: vi.fn(),
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
import Chat from './Chat.svelte'
import { chatSurface, resetChatSurfaceForTests } from './chatSurface.svelte'
import { draftContentOrphanGate } from 'src/ts/draftContentOrphanGate'
import { type MessageIdentity, type TranslationIdentity } from 'src/ts/draftContents'
import { chatWindowKey } from 'src/ts/chatWindowPolicy'
import { hasMessageEditorDrafts, resetLocalDraftsForTest } from 'src/ts/localDrafts'
import { language } from '../../lang'
import { getLLMCache } from 'src/ts/translator/translator'

//#region fixture helpers

const MESSAGE_TEXT = 'original text'

function baseDb(overrides: Partial<Record<string, unknown>> = {}) {
    return {
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
        ...overrides,
    }
}

function installFixtureChat(dbOverrides: Partial<Record<string, unknown>> = {}) {
    DBState.db = baseDb(dbOverrides) as never
    const chat = {
        id: 'chat-1',
        message: [{ role: 'char', data: MESSAGE_TEXT, chatId: 'chat-id-1' }],
        bookmarks: [] as string[],
        bookmarkNames: {} as Record<string, string>,
    }
    DBState.db.characters = [{ chaId: 'char-1', type: 'character', ttsMode: 'none', chatPage: 0, chats: [chat] }] as never
    selIdState.selId = 0
    const messageIdentity: MessageIdentity = {
        kind: 'msg',
        chatKey: chatWindowKey('char-1', chat),
        chatId: 'chat-id-1',
        index: 0,
    }
    return { messageIdentity }
}

const mountedTargets: HTMLElement[] = []
const mountedInstances: unknown[] = []

function mountChat() {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    const instance = mount(Chat, { target, props: { idx: 0, message: MESSAGE_TEXT, isLastMemory: false } })
    mountedInstances.push(instance)
    flushSync()
    return target
}

function findButtonByText(target: HTMLElement, text: string): HTMLButtonElement {
    const btn = Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.includes(text))
    if (!btn) {
        throw new Error(`no button found containing text: ${text}`)
    }
    return btn
}

function typeIntoEditor(target: HTMLElement, value: string) {
    const area = target.querySelector<HTMLTextAreaElement>('.message-edit-area')!
    area.value = value
    area.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
}

/** What the surface does when Settings opens. */
function settingsOpens() {
    chatSurface.closeEpoch += 1
    flushSync()
}

afterEach(async () => {
    for (const instance of mountedInstances.splice(0)) {
        await unmount(instance as never).catch(() => {})
    }
    mountedTargets.splice(0).forEach((t) => t.remove())
    document.body.replaceChildren()
    draftContentOrphanGate.clear()
    resetLocalDraftsForTest()
    resetChatSurfaceForTests()
    vi.clearAllMocks()
})

beforeEach(() => {
    window.innerWidth = 1024
    selectedCharID.set(0)
})

//#endregion

describe('Chat.svelte: opening Settings closes the message editors', () => {
    test('the original-text editor closes, its draft is released, and the typed text is offered again', () => {
        const { messageIdentity } = installFixtureChat()
        const target = mountChat()
        target.querySelector<HTMLButtonElement>('.button-icon-edit')!.click()
        flushSync()
        typeIntoEditor(target, 'typed in the editor')
        expect(hasMessageEditorDrafts()).toBe(true)

        settingsOpens()

        expect(hasMessageEditorDrafts()).toBe(false)
        expect(target.querySelector('.message-edit-area')).toBeNull()
        expect(draftContentOrphanGate.get(messageIdentity, MESSAGE_TEXT)?.text).toBe('typed in the editor')

        target.querySelector<HTMLButtonElement>('.button-icon-edit')!.click()
        flushSync()
        expect(target.querySelector<HTMLTextAreaElement>('.message-edit-area')?.value).toBe('typed in the editor')
    })

    test('the translation editor closes, its draft is released, and the typed text is kept', async () => {
        installFixtureChat({ translatorType: 'llm', translator: 'dummy-translator' })
        const translationIdentity: TranslationIdentity = { kind: 'tr', key: MESSAGE_TEXT }
        vi.mocked(getLLMCache).mockResolvedValueOnce('cached translation')
        const target = mountChat()
        target.querySelector<HTMLButtonElement>('.button-icon-translate')!.click()
        flushSync()
        findButtonByText(target, language.editTranslation).click()
        await vi.waitFor(() => {
            flushSync()
            expect(target.querySelector<HTMLTextAreaElement>('.message-edit-area')?.value).toBe('cached translation')
        })
        typeIntoEditor(target, 'typed translation')
        expect(hasMessageEditorDrafts()).toBe(true)

        settingsOpens()

        expect(hasMessageEditorDrafts()).toBe(false)
        expect(target.querySelector('.message-edit-area')).toBeNull()
        expect(draftContentOrphanGate.get(translationIdentity, MESSAGE_TEXT)?.text).toBe('typed translation')
    })

    test('guard: without the close signal an open editor stays open and registered', () => {
        installFixtureChat()
        const target = mountChat()
        target.querySelector<HTMLButtonElement>('.button-icon-edit')!.click()
        flushSync()
        typeIntoEditor(target, 'typed in the editor')

        flushSync()

        expect(hasMessageEditorDrafts()).toBe(true)
        expect(target.querySelector('.message-edit-area')).not.toBeNull()
    })
})
