// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { COLD_TRANSFORM_HOOK_MS } from '../../ts/tests/coldTransform.test-helpers'
import { flushSync, mount, unmount } from 'svelte'

/**
 * The real ChatShell, with more messages than the integrated harness, so its rows sit inside the shell's own
 * `.default-chat-screen` wrapper beyond the fourth position. The legacy row sheet is adopted by importing its module; the
 * shell's rows must match neither of its rules.
 *
 * Label: G = guard (the sheet is absent on the base, so it passes there for lack of a rule; it fails when the sheet's
 * scope widens to the shell).
 */

vi.mock('../../ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    const DBState = $state({ db: {
        username: 'User', userIcon: '', translator: '', swipe: true, autoTranslate: false,
        autoScrollToNewMessage: false, alwaysScrollToNewMessage: false, chatLoadInitialPages: 20, chatLoadAdditionalPages: 20,
        characters: [{
            chaId: 'c', type: 'character', name: 'Ari', image: '', chatPage: 0, firstMessage: 'Hello', alternateGreetings: [] as string[],
            chats: [{
                id: 'chat',
                message: Array.from({ length: 12 }, (_, i) => ({ role: i % 2 === 0 ? 'user' : 'char', data: `m${i}`, chatId: `id${i}`, time: i })),
                alt: [] as unknown[],
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
    branchAt: vi.fn(async () => {}), stepSibling: vi.fn(async () => {}), regenerateNewest: vi.fn(async () => {}),
    isComposerBusy: () => false, isComposerBusyIn: () => false,
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
    branchMessage: async () => {},
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
} }))

import ChatShell from './ChatShell.svelte'
import 'src/ts/gui/legacyRowVisibility'

let app: ReturnType<typeof ChatShell> | undefined
let target: HTMLElement

afterEach(async () => {
    if (app) await unmount(app)
    app = undefined
    target?.remove()
})

// The shell's lazy children import the icon-library barrel, which costs tens of seconds to transform cold; paying it here keeps it out of the mount wait.
beforeAll(async () => {
    await import('@lucide/svelte')
}, COLD_TRANSFORM_HOOK_MS)

describe('the legacy row sheet and the shell', () => {
    test('G T3 shell rows beyond the fourth sit in the shell\'s default-chat-screen and match neither sheet rule', async () => {
        target = document.createElement('div')
        document.body.appendChild(target)
        app = mount(ChatShell, { target })
        await vi.waitFor(() => {
            flushSync()
            expect(target.querySelectorAll('[data-part="chat-message-list"] > .chat-message-container').length).toBeGreaterThanOrEqual(6)
        }, { timeout: 15000 })

        const style = document.head.querySelector('style[data-risu-sheet="legacy-row-visibility"]') as HTMLStyleElement
        const rules = [...(style.sheet as CSSStyleSheet).cssRules]
        const size = rules.find((rule) => rule.constructor.name === 'CSSStyleRule') as CSSStyleRule
        const supports = rules.find((rule) => rule.constructor.name === 'CSSSupportsRule') as CSSSupportsRule
        const skip = [...supports.cssRules][0] as CSSStyleRule

        const screen = target.querySelector('.default-chat-screen')
        expect(screen).not.toBeNull()
        const rows = [...target.querySelectorAll('[data-part="chat-message-list"] > .chat-message-container')]
        expect(rows.every((row) => screen!.contains(row))).toBe(true)
        for (const row of rows) {
            expect(row.matches(skip.selectorText)).toBe(false)
            expect(row.matches(size.selectorText)).toBe(false)
        }
    })
})
