// @vitest-environment jsdom
/**
 * Guard (R7): the only hide-names control is the This-chat sheet's row (mocked here, and closed), so the transcript and a
 * row's action sheet carry none; a chat that does not hold the flag renders every name. The flag itself (`Chat.hideNames`)
 * is read by the rows: see the second block. The sheet's own row is tested in ThisChatSheet.svelte.test.ts.
 */
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
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
vi.mock('./ThisChatSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('./ChatDeleteConfirm.svelte', () => ({ default: () => ({}) }))
vi.mock('./ShellNotices.svelte', () => ({ default: () => ({}) }))
vi.mock('./ShellFloatingButtons.svelte', () => ({ default: () => ({}) }))
vi.mock('../../lang', () => ({ language: {
    chatShellMessages: 'Messages', chatShellMoreActions: 'More actions', chatShellBranch: 'Branch from here', chatShellNewReply: 'New reply',
    chatShellPreviousReply: 'Previous reply', chatShellNextReply: 'Next reply', chatShellFirstReply: 'First reply', chatShellLastReply: 'Last reply',
    chatShellReplyOf: (index: number, total: number) => `Reply ${index} of ${total}`, chatShellFirstMessageOf: (index: number, total: number) => `First message ${index} of ${total}`, bookmark: 'Bookmark', remove: 'Delete', cancel: 'Cancel',
    chatShellReplyInProgress: 'Writing the reply', chatShellStopAndDelete: 'Stop and delete',
} }))

import ChatShell from './ChatShell.svelte'
import { DBState } from '../../ts/stores.svelte'

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

// The shell's lazy children import the icon-library barrel, which costs tens of seconds to transform cold; paying it here keeps it out of the mount wait.
beforeAll(async () => {
    await import('@lucide/svelte')
}, 120000)

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

    test('outside the This-chat sheet, the shell and the open action sheet carry no hide-names control', async () => {
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

// CHORE-565, PQ2(a): the chat's `hideNames` hides the avatar and the visible name but keeps the name row, so the
// pins and the ellipsis stay in it, and the name stays in the tree for the row's accessible name.
describe('the chat\'s hideNames hides the avatar and the visible name, not the row', () => {
    const liveChat = () => (DBState.db.characters[0] as unknown as { chats: { hideNames?: boolean }[] }).chats[0]

    afterEach(() => {
        delete liveChat().hideNames
    })

    async function avatarsShown(): Promise<void> {
        await vi.waitFor(() => {
            flushSync()
            expect(target.querySelector('[data-part="chat-message-avatar"]')).not.toBeNull()
        })
    }

    // C-T9 guard: the default row keeps the avatar and shows the name
    test('guard: without the flag the row shows an avatar and is marked shown', async () => {
        await show()
        await avatarsShown()
        for (const article of Array.from(target.querySelectorAll('article[data-part="chat-message"]'))) {
            expect(article.getAttribute('data-meta')).toBe('shown')
        }
        expect(target.querySelector('[data-part="chat-message-name"][data-name-hidden]')).toBeNull()
    })

    // C-T9 regression reproducer: the base renders the avatar whatever the chat holds
    test('with the flag on no row renders an avatar, and every row is marked hidden', async () => {
        liveChat().hideNames = true
        await show()
        await new Promise((resolve) => setTimeout(resolve, 20))
        flushSync()

        const articles = Array.from(target.querySelectorAll('article[data-part="chat-message"]'))
        expect(articles.length).toBeGreaterThanOrEqual(2)
        for (const article of articles) {
            expect(article.getAttribute('data-meta')).toBe('hidden')
        }
        expect(target.querySelector('[data-part="chat-message-avatar"]')).toBeNull()
    })

    test('with the flag on the name stays in the tree, unhidden, and names the row; the row keeps its actions', async () => {
        liveChat().hideNames = true
        await show()

        const article = target.querySelector<HTMLElement>('article[data-chat-id="m"]')!
        const name = article.querySelector<HTMLElement>('[data-part="chat-message-name"]')!
        expect(name.textContent).toBe('Ari')
        expect(name.hasAttribute('hidden')).toBe(false)
        expect(name.getAttribute('aria-hidden')).not.toBe('true')
        expect(name.hasAttribute('data-name-hidden')).toBe(true)
        expect(article.getAttribute('aria-labelledby')).toBe(name.id)
        expect(article.querySelector('[aria-label="More actions"]')).not.toBeNull()
        expect(name.closest('[data-part="chat-message-name-row"]')).not.toBeNull()
    })

    test('guard: a false flag changes nothing', async () => {
        liveChat().hideNames = false
        await show()
        await avatarsShown()

        expect(target.querySelector('article[data-part="chat-message"]')!.getAttribute('data-meta')).toBe('shown')
    })
})
