// @vitest-environment jsdom
/**
 * The notification-permission notice (DD-009) inside the real ChatShell: it sits in the composer host
 * directly above the composer, shows in the chat that consumed it, and is gone when that instance
 * leaves (a chat switch remounts it through the key block, an unmount ends the instance). MOCKED: the
 * stores, the process layer, the heavy shell children and the language table, as in the integrated
 * ChatShell test; the notice, its module and the key policy are real. A passing test says nothing about
 * the native permission prompt, and `display:none` covers are only reproduced through the surface flags.
 *
 * Every "absent after" assertion first asserts that the notice WAS shown. The result hook is called
 * through `?.`, so on a base without the hook a test fails on its assertion and not on a TypeError.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, tick, unmount } from 'svelte'

const composer = vi.hoisted(() => ({
    branchAt: vi.fn(async () => {}), stepSibling: vi.fn(async () => {}), regenerateNewest: vi.fn(async () => {}), busy: false,
}))
vi.mock('../../ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    const DBState = $state({ db: {
        username: 'User', userIcon: '', translator: '', swipe: true, autoTranslate: false,
        autoScrollToNewMessage: false, alwaysScrollToNewMessage: false, chatLoadInitialPages: 5, chatLoadAdditionalPages: 5,
        characters: [{
            chaId: 'c', type: 'character', name: 'Ari', image: '', chatPage: 0, firstMessage: 'Hello', alternateGreetings: [] as string[],
            chats: [{
                id: 'chat',
                message: [
                    { role: 'user', data: 'Hi', chatId: 'u', time: 0 },
                    { role: 'char', data: 'Reply', chatId: 'm', time: 1 },
                ],
                alt: [{ p: 'u', a: 1, m: { role: 'char', data: 'Other', chatId: 'm2', time: 2 } }],
            }],
        }],
    } })
    const selIdState = $state({ selId: 0 })
    const ScrollToMessageStore = $state({ value: -1 })
    return {
        DBState, selIdState, HideIconStore: writable(false), ReloadChatPointer: writable({}), ReloadGUIPointer: writable(0),
        ScrollToMessageStore, createSimpleCharacter: () => null,
    }
})
vi.mock('../../ts/process/index.svelte', async () => {
    const { writable } = await import('svelte/store')
    return { doingChat: writable(false) }
})
vi.mock('../../ts/process/composerActions.svelte', () => ({
    branchAt: composer.branchAt, stepSibling: composer.stepSibling, regenerateNewest: composer.regenerateNewest,
    isComposerBusy: () => composer.busy,
}))
vi.mock('../../ts/globalApi.svelte', () => {
    const chatFoldedState = $state<{ data: null }>({ data: null })
    const chatFoldedStateMessageIndex = $state({ index: -1 })
    return { chatFoldedState, chatFoldedStateMessageIndex, aiLawApplies: () => false, changeChatTo: vi.fn(), foldChatToMessage: vi.fn() }
})
vi.mock('../../ts/process/activeStreams', () => ({ isActiveStreamReply: () => false }))
vi.mock('../../ts/localDrafts', () => ({ hasMessageEditorDrafts: () => false, onDraftsChanged: () => () => {} }))
vi.mock('../ChatScreens/chatSurface.svelte', () => {
    const chatSurface = $state({ hidden: false, rebuildEpoch: 0, closeEpoch: 0, heldGui: 0, heldChat: {} as Record<number, number> })
    return { chatSurface, isChatSurfaceInstalled: () => true, onSurfaceHiding: () => () => {} }
})
vi.mock('../../ts/caughtErrors', () => ({ recordCaughtError: vi.fn() }))
vi.mock('../../ts/characters', () => ({ getCharImage: async () => null }))
vi.mock('../../ts/model/modellist', () => ({ getModelInfo: () => ({ shortName: 'model' }) }))
vi.mock('../../ts/storage/database.svelte', () => ({ getCurrentCharacter: () => null }))
vi.mock('../../ts/parser/parser.svelte', () => ({ ParseMarkdown: async (text: string) => text, hasher: (value: string) => value, risuChatParser: (value: string) => value, assetRegex: /{{asset:[^}]+}}/g }))
vi.mock('../../ts/parser/chatML', () => ({ parseChatML: () => [] }))
vi.mock('../../ts/process/moduleRefList', () => ({ hasModuleStubs: () => false }))
vi.mock('../../ts/process/moduleEnsure', () => ({ ensureCurrentModulesOrAlert: async () => true }))
vi.mock('../../ts/translator/translator', () => ({ getLLMCache: async () => null }))
vi.mock('../../ts/process/ttsModes', () => ({ isTTSVoiceMode: () => false }))
vi.mock('../../ts/process/tts', () => ({ stopTTS: vi.fn() }))
vi.mock('../../ts/process/scripts', () => ({ risuChatParser: (text: string) => text }))
vi.mock('../../ts/process/displayParseOptions', () => ({ buildDisplayParseOptions: () => ({}) }))
vi.mock('../../ts/alert', () => ({ alertError: vi.fn(), alertRequestData: vi.fn(), alertConfirm: vi.fn(), alertSelect: vi.fn(), alertNormal: vi.fn() }))
vi.mock('../../ts/chatShell/haptics', () => ({ tickHaptic: vi.fn(), readHaptics: () => true }))
vi.mock('../../ts/backHandlers', () => ({ registerBackHandler: () => () => {}, backCloseHandler: () => () => false }))
vi.mock('../../ts/chatShell/stopDelete.svelte', () => ({ requestStopDelete: vi.fn(() => true), isStopDeletePending: () => false }))
vi.mock('../../ts/process/messageActions.svelte', () => ({
    handleButtonTriggerWithin: vi.fn(), handleFormTriggerWithin: vi.fn(), playMessageTTS: vi.fn(), requestRemove: vi.fn(), deleteNow: vi.fn(),
    copyMessageText: vi.fn(), copyMessageAsCard: vi.fn(), toggleMessageDisabled: vi.fn(), toggleBookmark: vi.fn(),
    branchMessage: async (getIdx: () => number, expectedId: string | undefined, onBranch: ((index: number, expectedId: string | undefined) => void) | undefined) => { onBranch?.(getIdx(), expectedId) },
}))
vi.mock('../../ts/process/messageEditorController.svelte', () => ({ createMessageEditorController: () => ({
    editMode: false, editTranslationMode: false, discardConfirmOpen: false, translationViewControlsDisabled: false,
    translationEditControlDisabled: false, originalEditControlDisabled: false, dispose: () => {},
}) }))
vi.mock('../ChatScreens/PartialEditController.svelte', () => ({ default: () => ({}) }))
vi.mock('./MessageEditor.svelte', () => ({ default: () => ({}) }))
vi.mock('./TranslationEditor.svelte', () => ({ default: () => ({}) }))
vi.mock('../ChatScreens/ChatBody.svelte', () => ({ default: () => ({}) }))
vi.mock('./StreamingView.svelte', () => ({ default: () => ({}) }))
vi.mock('./ShellHeader.svelte', () => ({ default: () => ({}) }))
vi.mock('./ShellComposer.svelte', () => ({ default: () => ({}) }))
vi.mock('./PersonaSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('./PlusSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('./ShellNotices.svelte', () => ({ default: () => ({}) }))
vi.mock('./ShellFloatingButtons.svelte', () => ({ default: () => ({}) }))
vi.mock('../../lang', () => ({ language: {
    chatShellMessages: 'Messages', chatShellMoreActions: 'More actions', chatShellBranch: 'Branch from here', chatShellNewReply: 'New reply',
    chatShellPreviousReply: 'Previous reply', chatShellNextReply: 'Next reply', chatShellFirstReply: 'First reply', chatShellLastReply: 'Last reply',
    chatShellReplyOf: (index: number, total: number) => `Reply ${index} of ${total}`, chatShellFirstMessageOf: (index: number, total: number) => `First message ${index} of ${total}`, bookmark: 'Bookmark', remove: 'Delete', cancel: 'Cancel',
    chatShellReplyInProgress: 'Writing the reply', chatShellStopAndDelete: 'Stop and delete',
    chatShellChatOpened: (name: string) => `${name} opened`,
    notificationsOffNotice: 'Notifications are off', notificationsOffOpenSettings: 'Open settings', uiCommon: { close: 'Close' },
} }))

import ChatShell from './ChatShell.svelte'
import { DBState } from '../../ts/stores.svelte'
import { chatSurface } from '../ChatScreens/chatSurface.svelte'
import * as replyNotificationsModule from '../../ts/android/replyNotifications.svelte'

const NOTICE = '[data-part="notifications-off-notice"]'
const HOST = '[data-part="chat-composer-host"]'

let app: ReturnType<typeof ChatShell> | undefined
let target: HTMLElement

/** Mounts the real shell and waits until its lazy children are in. */
async function show(): Promise<void> {
    target = document.createElement('div')
    document.body.appendChild(target)
    app = mount(ChatShell, { target })
    await vi.waitFor(() => {
        flushSync()
        expect(target.querySelector('[data-part="chat-message-alts"]')).not.toBeNull()
    }, { timeout: 15000 })
}

/** The host's push and the keep-alive result, as MainActivity sends them; both go through `?.`. */
async function deny(): Promise<void> {
    window.__risuTaniumReplyNotificationsState?.('{"optedIn":false,"enabled":false,"appNotifications":false}')
    window.__risuTaniumNotificationPermissionResult?.(false)
    await settle()
}

async function settle(): Promise<void> {
    flushSync()
    await tick()
    flushSync()
}

/** Waits for the notice inside the composer host; fails by assertion when it never comes. */
async function noticeShown(): Promise<HTMLElement> {
    await vi.waitFor(() => {
        flushSync()
        expect(target.querySelector(`${HOST} ${NOTICE}`)).not.toBeNull()
    }, { timeout: 3000 })
    return target.querySelector<HTMLElement>(NOTICE)!
}

// The shell's lazy children import the icon-library barrel, which costs tens of seconds to transform cold; paying it here keeps it out of the mount wait.
beforeAll(async () => {
    await import('@lucide/svelte')
}, 120000)

beforeEach(() => {
    replyNotificationsModule.resetNotificationsOffNoticeForTests?.()
    replyNotificationsModule.installReplyNotifications()
})

afterEach(async () => {
    if (app) await unmount(app)
    app = undefined
    target?.remove()
    delete window.__risuTaniumReplyNotificationsState
    delete window.__risuTaniumNotificationPermissionResult
    chatSurface.hidden = false
    DBState.db.characters[0].chatPage = 0
    DBState.db.characters[0].chats.length = 1
})

function addSecondChat(): void {
    DBState.db.characters[0].chats.push({ id: 'chat-2', message: [{ role: 'char', data: 'Two', chatId: 'two', time: 5 }], alt: [] } as never)
}

describe('the notice in the ChatShell composer host', () => {
    test('P10: a denial shows the notice inside the composer host, before the composer', async () => {
        await show()
        await deny()
        const notice = await noticeShown()
        expect(notice.parentElement?.getAttribute('data-part')).toBe('chat-composer-host')
        expect(notice.getAttribute('role')).toBe('status')
    })

    test('P10a: a denial that arrived before the shell mounted is shown once the lazy notice is in', async () => {
        await deny()
        await show()
        await noticeShown()
    })

    test('P10b: switching chat shows it nowhere else, and returning to the first chat shows nothing', async () => {
        await show()
        await deny()
        await noticeShown()
        addSecondChat()
        DBState.db.characters[0].chatPage = 1
        await settle()
        expect(target.querySelector(NOTICE)).toBeNull()
        DBState.db.characters[0].chatPage = 0
        await settle()
        expect(target.querySelector(NOTICE)).toBeNull()
    })

    test('P10c: leaving the screen (an unmount stands for Home, the grid and a same-chat remount) drops it for good', async () => {
        await show()
        await deny()
        await noticeShown()
        await unmount(app!)
        app = undefined
        target.remove()
        expect(replyNotificationsModule.notificationsOff.phase).toBe('consumed')
        await show()
        await settle()
        expect(target.querySelector(NOTICE)).toBeNull()
    })

    test('P10d: a cover (the surface hides and closes, then returns) keeps the same notice node', async () => {
        await show()
        await deny()
        const shown = await noticeShown()
        chatSurface.hidden = true
        chatSurface.closeEpoch += 1
        chatSurface.rebuildEpoch += 1
        await settle()
        chatSurface.hidden = false
        await settle()
        expect(target.querySelector(NOTICE)).toBe(shown)
    })

    test('P10e: a resume push that still says off keeps the node, and an allowed push removes it', async () => {
        await show()
        await deny()
        const shown = await noticeShown()
        window.__risuTaniumReplyNotificationsState?.('{"optedIn":false,"enabled":false,"appNotifications":false}')
        await settle()
        expect(target.querySelector(NOTICE)).toBe(shown)
        window.__risuTaniumReplyNotificationsState?.('{"optedIn":false,"enabled":true,"appNotifications":true}')
        await settle()
        expect(target.querySelector(NOTICE)).toBeNull()
    })
})
