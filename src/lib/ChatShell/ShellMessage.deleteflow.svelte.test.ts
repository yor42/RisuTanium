// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'
import type { Message } from '../../ts/storage/database.svelte'

const stepSibling = vi.hoisted(() => vi.fn())
const regenerateNewest = vi.hoisted(() => vi.fn())
const db = vi.hoisted(() => ({ message: [] as Message[] }))
const alerts = vi.hoisted(() => ({ alertConfirm: vi.fn(async (_text: string) => true), alertSelect: vi.fn(async (_labels: string[], _text?: string) => '1'), alertNormal: vi.fn(), alertError: vi.fn(), alertRequestData: vi.fn() }))
const abortChat = vi.hoisted(() => vi.fn())
const writing = vi.hoisted(() => ({ value: false }))
const stop = vi.hoisted(() => ({ requestStopDelete: vi.fn(() => true) }))
vi.mock('../../ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    const DBState = $state({ db: { characters: [{ chaId: 'c', chatPage: 0, chats: [{ id: 'room', message: db.message }] }], translator: '', swipe: true } })
    const selIdState = $state({ selId: 0 })
    return { DBState, selIdState, HideIconStore: writable(false) }
})
vi.mock('../../ts/chatShell/stopDelete.svelte', () => {
    const pending = $state({ value: false })
    return { requestStopDelete: stop.requestStopDelete, isStopDeletePending: () => pending.value, pendingForTest: pending }
})
vi.mock('../../ts/process/chatOrigin', () => ({
    originOf: (owner: { chaId: string }, chat: { id: string }) => ({ chaId: owner.chaId, chatId: chat.id }),
    isWriting: () => writing.value,
}))
vi.mock('../../ts/process/composerActions.svelte', () => ({ stepSibling, regenerateNewest, abortChat }))
vi.mock('../../ts/process/index.svelte', async () => {
    const { writable } = await import('svelte/store')
    return { doingChat: writable(false) }
})
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
vi.mock('../../ts/alert', () => alerts)
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
    chatShellMoreActions: 'More actions', bookmark: 'Bookmark', remove: 'Delete', chatShellStopAndDelete: 'Stop and delete',
    chatShellDeleteFromHere: 'Delete from here', chatShellDeletePendingStop: 'Stopping, then deleting...',
    chatShellStopDeleteChanged: 'changed', chatShellReplyInProgress: 'Writing the reply',
    cancel: 'Cancel', chatShellStopDeleteCannot: 'cannot',
    chatShellDeleteRangeConfirm: (count: number, excerpt: string) => `range:${count}:${excerpt}`,
    chatShellDeleteRangeButton: (count: number) => `Delete ${count}`,
    chatShellStopDeleteConfirm: (count: number) => `stop:${count}`,
    chatShellReplyOf: (index: number, total: number) => `Reply ${index} of ${total}`, chatShellFirstMessageOf: (index: number, total: number) => `First message ${index} of ${total}`, chatShellPreviousReply: 'Previous', chatShellNextReply: 'Next', chatShellNewReply: 'New reply',
} }))

import ShellMessage, { type ActionRequest } from './ShellMessage.svelte'
import ActionSheet from './ActionSheet.svelte'
import { DBState } from '../../ts/stores.svelte'
import { doingChat } from '../../ts/process/index.svelte'

let target: HTMLElement
let app: ReturnType<typeof ShellMessage> | undefined
let sheetApp: ReturnType<typeof ActionSheet> | undefined
let hostedRequest: ActionRequest | null = $state.raw(null)
let hostedOpen = $state(false)
beforeEach(() => {
    const list = DBState.db.characters[0].chats[0].message
    list.splice(0, list.length, { role: 'user', data: 'Hi', chatId: 'u' }, { role: 'char', data: 'Reply', chatId: 'm' }, { role: 'user', data: 'More', chatId: 'n' })
    writing.value = false
    doingChat.set(false)
    alerts.alertConfirm.mockReset().mockResolvedValue(true)
    alerts.alertSelect.mockReset().mockResolvedValue('1')
})
// The shell hosts one sheet outside the rows; the test hosts the real sheet next to the mounted row the same way.
function show(idx: number, streaming = false, extra: Record<string, unknown> = {}) {
    target = document.createElement('div')
    document.body.appendChild(target)
    const message = DBState.db.characters[0].chats[0].message[idx]
    app = mount(ShellMessage, { target, props: { idx, chatId: message.chatId, name: 'Ari', message, streaming, onOpenActions: (request: ActionRequest) => { hostedRequest = request; hostedOpen = true }, ...extra } })
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
function openSheet(): HTMLElement {
    target.querySelector<HTMLButtonElement>('[aria-label="More actions"]')!.click()
    flushSync()
    return target
}
async function pendingFlag() {
    return (await import('../../ts/chatShell/stopDelete.svelte') as unknown as { pendingForTest: { value: boolean } }).pendingForTest
}
afterEach(async () => {
    if (sheetApp) await unmount(sheetApp)
    sheetApp = undefined
    hostedOpen = false
    hostedRequest = null
    if (app) await unmount(app)
    app = undefined
    target?.remove();
    (await pendingFlag()).value = false
    for (const fn of [stepSibling, regenerateNewest, abortChat, stop.requestStopDelete, alerts.alertNormal, ...Object.values(messageActions)]) fn.mockClear()
})

describe('delete labels', () => {
    test('a settled message offers Delete and a generating one offers Stop and delete, both enabled', () => {
        show(1)
        expect(openSheet().querySelector('[role="menuitem"][data-action="delete"]')?.textContent).toBe('Delete')
        unmountApp()
        show(1, true)
        const remove = openSheet().querySelector<HTMLButtonElement>('[role="menuitem"][data-action="delete"]')!
        expect(remove.textContent).toBe('Stop and delete')
        expect(remove.disabled).toBe(false)
        expect(remove.closest('[data-destructive-group]')).not.toBeNull()
    })
})
function unmountApp() { void unmount(sheetApp!); sheetApp = undefined; hostedOpen = false; void unmount(app!); app = undefined; target.remove() }

describe('single delete', () => {
    test('a settled message goes through the existing removal dialogs', async () => {
        show(1)
        openSheet().querySelector<HTMLButtonElement>('[data-action="delete"]')!.click()
        await vi.waitFor(() => expect(messageActions.requestRemove).toHaveBeenCalledTimes(1), { timeout: 5000 })
        expect(messageActions.requestRemove.mock.calls[0][2]).toMatchObject({ chatId: 'm' })
        expect(stop.requestStopDelete).not.toHaveBeenCalled()
        expect(alerts.alertConfirm).not.toHaveBeenCalled()
    })
    test('a generating reply confirms, then freezes a single stop-and-delete', async () => {
        show(1, true)
        openSheet().querySelector<HTMLButtonElement>('[data-action="delete"]')!.click()
        await vi.waitFor(() => expect(stop.requestStopDelete).toHaveBeenCalledTimes(1), { timeout: 5000 })
        expect(alerts.alertConfirm).toHaveBeenCalledWith('stop:0')
        const call = stop.requestStopDelete.mock.calls[0] as unknown[]
        expect(call[2]).toMatchObject({ chatId: 'm' })
        expect(call[3]).toBe('one')
        expect(messageActions.requestRemove).not.toHaveBeenCalled()
        expect(messageActions.deleteNow).not.toHaveBeenCalled()
    })
    test('declining the stop-and-delete confirm deletes and stops nothing', async () => {
        alerts.alertConfirm.mockResolvedValue(false)
        show(1, true)
        openSheet().querySelector<HTMLButtonElement>('[data-action="delete"]')!.click()
        await vi.waitFor(() => expect(alerts.alertConfirm).toHaveBeenCalledTimes(1), { timeout: 5000 })
        await Promise.resolve()
        expect(stop.requestStopDelete).not.toHaveBeenCalled()
        expect(messageActions.deleteNow).not.toHaveBeenCalled()
    })
})

describe('range delete', () => {
    test('Delete from here asks with an excerpt of the first deleted message, Cancel first and a Delete n button, then deletes the range from the target', async () => {
        show(0)
        openSheet().querySelector<HTMLButtonElement>('[data-action="deleteAfter"]')!.click()
        await vi.waitFor(() => expect(messageActions.deleteNow).toHaveBeenCalledTimes(1), { timeout: 5000 })
        expect(alerts.alertSelect).toHaveBeenCalledWith(['Cancel', 'Delete 3'], 'range:3:Hi')
        expect(alerts.alertConfirm).not.toHaveBeenCalled()
        const call = messageActions.deleteNow.mock.calls[0] as unknown[]
        expect(call[2]).toMatchObject({ chatId: 'u' })
        expect(call[3]).toBe('from')
        expect(messageActions.requestRemove).not.toHaveBeenCalled()
    })
    test('a long first message is cut to a short single-line excerpt', async () => {
        DBState.db.characters[0].chats[0].message[0].data = `${'word '.repeat(40)}\nsecond line`
        show(0)
        openSheet().querySelector<HTMLButtonElement>('[data-action="deleteAfter"]')!.click()
        await vi.waitFor(() => expect(alerts.alertSelect).toHaveBeenCalledTimes(1), { timeout: 5000 })
        const text = alerts.alertSelect.mock.calls[0][1] as string
        expect(text.startsWith('range:3:word word')).toBe(true)
        expect(text.endsWith('…')).toBe(true)
        expect(text).not.toContain('\n')
        expect(text.length).toBeLessThan(90)
    })
    test('labels the range entry Delete from here', () => {
        show(0)
        expect(openSheet().querySelector('[data-action="deleteAfter"]')?.textContent).toBe('Delete from here')
    })
    test('choosing Cancel deletes nothing', async () => {
        alerts.alertSelect.mockResolvedValue('0')
        show(0)
        openSheet().querySelector<HTMLButtonElement>('[data-action="deleteAfter"]')!.click()
        await vi.waitFor(() => expect(alerts.alertSelect).toHaveBeenCalledTimes(1), { timeout: 5000 })
        await Promise.resolve()
        expect(messageActions.deleteNow).not.toHaveBeenCalled()
        expect(stop.requestStopDelete).not.toHaveBeenCalled()
    })
    test('a range that reaches the running send stops it first instead of deleting at once', async () => {
        writing.value = true
        doingChat.set(true)
        show(0)
        openSheet().querySelector<HTMLButtonElement>('[data-action="deleteAfter"]')!.click()
        await vi.waitFor(() => expect(stop.requestStopDelete).toHaveBeenCalledTimes(1), { timeout: 5000 })
        expect(alerts.alertConfirm).toHaveBeenCalledWith('stop:2')
        expect((stop.requestStopDelete.mock.calls[0] as unknown[])[3]).toBe('from')
        expect(messageActions.deleteNow).not.toHaveBeenCalled()
        expect(alerts.alertSelect).not.toHaveBeenCalled()
    })
    test('registered trigger work without a running generation takes the ordinary range confirm and deletes without any abort', async () => {
        writing.value = true
        doingChat.set(false)
        show(0)
        openSheet().querySelector<HTMLButtonElement>('[data-action="deleteAfter"]')!.click()
        await vi.waitFor(() => expect(messageActions.deleteNow).toHaveBeenCalledTimes(1), { timeout: 5000 })
        expect(alerts.alertSelect).toHaveBeenCalledWith(['Cancel', 'Delete 3'], 'range:3:Hi')
        expect(alerts.alertConfirm).not.toHaveBeenCalled()
        expect(stop.requestStopDelete).not.toHaveBeenCalled()
        expect(abortChat).not.toHaveBeenCalled()
    })
    test('a refused freeze says the reply cannot be deleted, not that it changed', async () => {
        stop.requestStopDelete.mockReturnValueOnce(false)
        show(1, true)
        openSheet().querySelector<HTMLButtonElement>('[data-action="delete"]')!.click()
        await vi.waitFor(() => expect(alerts.alertNormal).toHaveBeenCalledTimes(1), { timeout: 5000 })
        expect(alerts.alertNormal).toHaveBeenCalledWith('cannot')
    })
    test('the Shift+Delete key takes the same range path', async () => {
        show(0)
        target.querySelector('article')!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Delete', shiftKey: true }))
        await vi.waitFor(() => expect(messageActions.deleteNow).toHaveBeenCalledTimes(1), { timeout: 5000 })
    })
})

describe('pending stop-and-delete', () => {
    test('every delete entry is disabled and the row says it is stopping', async () => {
        show(1, true)
        const pending = await pendingFlag()
        pending.value = true
        flushSync()
        const sheet = openSheet()
        for (const id of ['delete', 'deleteAfter']) {
            const entry = sheet.querySelector<HTMLButtonElement>(`[data-action="${id}"]`)!
            expect(entry.disabled).toBe(true)
            entry.click()
        }
        expect(target.querySelector('[data-part="chat-message-delete-pending"]')?.textContent).toBe('Stopping, then deleting...')
        target.querySelector('article')!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Delete' }))
        await Promise.resolve()
        expect(alerts.alertConfirm).not.toHaveBeenCalled()
        expect(stop.requestStopDelete).not.toHaveBeenCalled()
        pending.value = false
        flushSync()
        expect(target.querySelector('[data-part="chat-message-delete-pending"]')).toBeNull()
    })
})

describe('alternatives row', () => {
    test('follows the sibling count, and a sheet page step marks the row so a new reply is held back', async () => {
        const state = $state({ count: 2 })
        DBState.db.characters[0].chats[0].message.splice(2, 1)
        show(1, false, { getTreeView: () => ({ at: () => ({ index: 1, count: state.count }), continuation: 0 }) })
        const label = () => target.querySelector('[data-part="chat-message-alts"] span[aria-live]')?.textContent
        expect(label()).toBe('1 / 2')
        state.count = 3
        flushSync()
        expect(label()).toBe('1 / 3')
        openSheet().querySelector<HTMLButtonElement>('[data-action="stepNext"]')!.click()
        await vi.waitFor(() => expect(stepSibling).toHaveBeenCalledTimes(1), { timeout: 5000 })
        await Promise.resolve()
        target.querySelector<HTMLButtonElement>('[data-part="chat-message-alts"] [data-action="newReply"]')!.click()
        expect(regenerateNewest).not.toHaveBeenCalled()
    })
})
