// @vitest-environment jsdom
// The shell hosts one action sheet outside the rows. It belongs to the row that opened it: it closes when that row is destroyed,
// and an action chosen for a message that has left the chat does nothing (no throw, no unhandled rejection).
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'
import type { Message } from '../../ts/storage/database.svelte'

const db = vi.hoisted(() => ({ message: [] as Message[] }))
vi.mock('../../ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    const DBState = $state({ db: { characters: [{ chaId: 'c', chatPage: 0, chats: [{ id: 'room', message: db.message }] }], translator: '', swipe: true } })
    const selIdState = $state({ selId: 0 })
    return { DBState, selIdState, HideIconStore: writable(false) }
})
vi.mock('../../ts/chatShell/stopDelete.svelte', () => ({ requestStopDelete: vi.fn(() => true), isStopDeletePending: () => false }))
vi.mock('../../ts/process/chatOrigin', () => ({
    originOf: (owner: { chaId: string }, chat: { id: string }) => ({ chaId: owner.chaId, chatId: chat.id }),
    isWriting: () => false,
}))
vi.mock('../../ts/process/composerActions.svelte', () => ({ stepSibling: vi.fn(), regenerateNewest: vi.fn(), abortChat: vi.fn() }))
vi.mock('../../ts/chatShell/haptics', () => ({ tickHaptic: vi.fn(), readHaptics: () => true }))
vi.mock('../../ts/backHandlers', () => ({ registerBackHandler: () => () => {}, backCloseHandler: () => () => false }))
vi.mock('../../ts/globalApi.svelte', () => ({ aiLawApplies: () => false }))
vi.mock('../../ts/storage/database.svelte', () => ({ getCurrentCharacter: () => null }))
vi.mock('../../ts/parser/parser.svelte', () => ({ ParseMarkdown: async (text: string) => text }))
vi.mock('../../ts/parser/chatML', () => ({}))
vi.mock('../../ts/process/moduleRefList', () => ({ hasModuleStubs: () => false }))
vi.mock('../../ts/process/moduleEnsure', () => ({ ensureCurrentModulesOrAlert: async () => true }))
vi.mock('../../ts/translator/translator', () => ({ getLLMCache: async () => null }))
vi.mock('../../ts/process/ttsModes', () => ({ isTTSVoiceMode: () => false }))
vi.mock('../../ts/process/tts', () => ({ stopTTS: vi.fn() }))
vi.mock('../../ts/process/scripts', () => ({ risuChatParser: (text: string) => text }))
vi.mock('../../ts/process/displayParseOptions', () => ({ buildDisplayParseOptions: () => ({}) }))
vi.mock('../../ts/caughtErrors', () => ({ recordCaughtError: vi.fn() }))
vi.mock('../../ts/alert', () => ({ alertConfirm: vi.fn(async () => true), alertSelect: vi.fn(async () => '1'), alertNormal: vi.fn(), alertError: vi.fn(), alertRequestData: vi.fn() }))
const messageActions = vi.hoisted(() => ({
    handleButtonTriggerWithin: vi.fn(), handleFormTriggerWithin: vi.fn(), playMessageTTS: vi.fn(),
    requestRemove: vi.fn(), deleteNow: vi.fn(), copyMessageText: vi.fn(), copyMessageAsCard: vi.fn(),
    branchMessage: vi.fn(), toggleMessageDisabled: vi.fn(), toggleBookmark: vi.fn(),
}))
vi.mock('../../ts/process/messageActions.svelte', () => messageActions)
vi.mock('../../ts/process/messageEditorController.svelte', () => ({ createMessageEditorController: () => ({
    editMode: false, editTranslationMode: false, discardConfirmOpen: false, translationViewControlsDisabled: false,
    translationEditControlDisabled: false, originalEditControlDisabled: false, dispose: () => {},
}) }))
vi.mock('../ChatScreens/PartialEditController.svelte', () => ({ default: () => ({}) }))
vi.mock('./MessageEditor.svelte', () => ({ default: () => ({}) }))
vi.mock('./TranslationEditor.svelte', () => ({ default: () => ({}) }))
vi.mock('../ChatScreens/ChatBody.svelte', () => ({ default: () => ({}) }))
vi.mock('./StreamingView.svelte', () => ({ default: () => ({}) }))
vi.mock('../ChatScreens/chatSurface.svelte', () => ({ chatSurface: { rebuildEpoch: 0, closeEpoch: 0 }, isChatSurfaceInstalled: () => false }))
vi.mock('../../ts/characters', () => ({ getCharImage: async () => null }))
vi.mock('../../ts/model/modellist', () => ({ getModelInfo: () => ({ shortName: 'model' }) }))
vi.mock('../../lang', () => ({ language: {
    chatShellMoreActions: 'More actions', bookmark: 'Bookmark', remove: 'Delete', cancel: 'Cancel',
    chatShellReplyOf: (index: number, total: number) => `Reply ${index} of ${total}`, chatShellFirstMessageOf: (index: number, total: number) => `First message ${index} of ${total}`,
    chatShellPreviousReply: 'Previous', chatShellNextReply: 'Next', chatShellNewReply: 'New reply',
} }))

import ShellMessage, { type ActionRequest } from './ShellMessage.svelte'
import ActionSheet from './ActionSheet.svelte'
import { DBState } from '../../ts/stores.svelte'

let target: HTMLElement
let app: ReturnType<typeof ShellMessage> | undefined
let sheetApp: ReturnType<typeof ActionSheet> | undefined
let hostedRequest: ActionRequest | null = $state.raw(null)
let hostedOpen = $state(false)

function messages(): Message[] { return DBState.db.characters[0].chats[0].message }
beforeEach(() => {
    messages().splice(0, messages().length, { role: 'user', data: 'Hi', chatId: 'u' }, { role: 'char', data: 'Reply', chatId: 'm' }, { role: 'user', data: 'More', chatId: 'n' })
    messageActions.toggleMessageDisabled.mockClear()
    messageActions.toggleBookmark.mockClear()
})
afterEach(async () => {
    if (sheetApp) await unmount(sheetApp)
    sheetApp = undefined
    hostedOpen = false
    hostedRequest = null
    if (app) await unmount(app)
    app = undefined
    target?.remove()
})

// The hosting shell keeps the request and closes the sheet when the row reports that it is gone, as ChatShell.closeActions does.
function show(idx: number): void {
    target = document.createElement('div')
    document.body.appendChild(target)
    const message = messages()[idx]
    app = mount(ShellMessage, { target, props: {
        idx, chatId: message.chatId, name: 'Ari', message,
        onOpenActions: (request: ActionRequest) => { hostedRequest = request; hostedOpen = true },
        onCloseActions: (request: ActionRequest) => { if (hostedRequest === request) hostedOpen = false },
    } })
    sheetApp = mount(ActionSheet, { target, props: {
        get open() { return hostedOpen },
        get opener() { return hostedRequest?.opener ?? null },
        get available() { return hostedOpen ? hostedRequest?.available() ?? [] : [] },
        get disabled() { return hostedOpen ? hostedRequest?.disabled() ?? [] : [] },
        get generating() { return hostedOpen && hostedRequest?.generating() === true },
        onaction: (id) => hostedRequest?.run(id),
        onclose: () => { hostedOpen = false },
    } })
    flushSync()
}
function openSheet(): void {
    target.querySelector<HTMLButtonElement>('[aria-label="More actions"]')!.click()
    flushSync()
}

describe('the hosted action sheet follows its row', () => {
    test('destroying the row that opened the sheet closes the sheet', async () => {
        show(1)
        openSheet()
        expect(hostedOpen).toBe(true)
        await unmount(app!)
        app = undefined
        flushSync()
        expect(hostedOpen).toBe(false)
    })
    test('an action chosen after the row was destroyed does nothing and throws nothing', async () => {
        show(1)
        openSheet()
        const request = hostedRequest!
        await unmount(app!)
        app = undefined
        expect(() => request.run('hideAI')).not.toThrow()
        await Promise.resolve()
        expect(messageActions.toggleMessageDisabled).not.toHaveBeenCalled()
    })
    test('an action chosen for a message that left the chat while the sheet stayed open does nothing', async () => {
        show(1)
        openSheet()
        messages().splice(1, 1)
        flushSync()
        const request = hostedRequest!
        expect(() => request.run('hideAI')).not.toThrow()
        request.run('bookmark')
        await Promise.resolve()
        expect(messageActions.toggleMessageDisabled).not.toHaveBeenCalled()
        expect(messageActions.toggleBookmark).not.toHaveBeenCalled()
    })
    test('while the message is still in the chat the same action runs', async () => {
        show(1)
        openSheet()
        hostedRequest!.run('hideAI')
        await vi.waitFor(() => expect(messageActions.toggleMessageDisabled).toHaveBeenCalledTimes(1))
    })
})
