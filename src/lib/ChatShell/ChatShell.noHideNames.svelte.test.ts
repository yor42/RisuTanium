// @vitest-environment jsdom
/**
 * Guard (R7): the hide-names mode has no stored value to read in this slice, so the shell renders every name and offers no
 * control for it, in the transcript or in a row's action sheet. A later slice adds the setter and field together with the
 * control; until then a visible control would write nothing.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, tick, unmount } from 'svelte'

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
    isComposerBusy: () => false,
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
    branchMessage: vi.fn(),
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

let app: ReturnType<typeof ChatShell> | undefined
let target: HTMLElement

async function show(): Promise<void> {
    target = document.createElement('div')
    document.body.appendChild(target)
    app = mount(ChatShell, { target })
    await vi.waitFor(() => {
        flushSync()
        expect(target.querySelector('article[data-chat-id="m"]')).not.toBeNull()
    }, { timeout: 15000 })
}

afterEach(async () => {
    if (app) await unmount(app)
    app = undefined
    target?.remove()
})

const HIDE_NAMES = /hide[\s_-]*(char(acter)?[\s_-]*|chat[\s_-]*)?names?|names?[\s_-]*hid(e|den)|name[\s_-]*hide/i

/** Every attribute and text an author or a pack could key a hide-names control on. */
function hideNamesControls(root: ParentNode): string[] {
    const found: string[] = []
    for (const element of Array.from(root.querySelectorAll('*'))) {
        const own = Array.from(element.childNodes).filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent ?? '').join(' ')
        const labels = [own, ...Array.from(element.attributes).map((attribute) => `${attribute.name}=${attribute.value}`)]
        if (labels.some((label) => HIDE_NAMES.test(label))) found.push(element.outerHTML.slice(0, 120))
    }
    return found
}

describe('guard: the hide-names mode renders off and has no control', () => {
    test('every row shows its name', async () => {
        await show()
        const names = Array.from(target.querySelectorAll('[data-part="chat-message-name"]')).map((element) => element.textContent)
        expect(names).toContain('User')
        expect(names.filter((name) => name === 'Ari').length).toBeGreaterThanOrEqual(2)
        for (const element of Array.from(target.querySelectorAll('[data-part="chat-message-name"]'))) {
            expect(element.hasAttribute('hidden')).toBe(false)
            expect(element.getAttribute('aria-hidden')).not.toBe('true')
        }
    })

    test('the shell and the open action sheet carry no hide-names control', async () => {
        await show()
        expect(hideNamesControls(target)).toEqual([])
        target.querySelector<HTMLButtonElement>('article[data-chat-id="m"] [aria-label="More actions"]')!.click()
        flushSync()
        await tick()
        expect(target.querySelector('[data-part="chat-sheet"]')).not.toBeNull()
        expect(hideNamesControls(target)).toEqual([])
    })

    test('the detector sees a control carrying the usual markers, so the check above can fail', () => {
        const probe = document.createElement('div')
        probe.innerHTML = '<button data-action="hideNames">x</button><label>Hide names</label><div data-part="chat-name-hide"></div>'
        expect(hideNamesControls(probe)).toHaveLength(3)
    })
})
