// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
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
} }))

import ChatShell from './ChatShell.svelte'
import { doingChat } from '../../ts/process/index.svelte'
import { DBState } from '../../ts/stores.svelte'

let app: ReturnType<typeof ChatShell> | undefined
let target: HTMLElement
async function show(): Promise<void> {
    target = document.createElement('div')
    document.body.appendChild(target)
    app = mount(ChatShell, { target })
    await vi.waitFor(() => {
        flushSync()
        expect(target.querySelector('[data-part="chat-message-alts"]')).not.toBeNull()
    }, { timeout: 15000 })
}
afterEach(async () => {
    if (app) await unmount(app)
    app = undefined
    target?.remove()
    doingChat.set(false)
    composer.busy = false
    for (const fn of [composer.branchAt, composer.stepSibling, composer.regenerateNewest]) fn.mockClear()
})
function counter(): string | null | undefined { return target.querySelector('[data-part="chat-message-alts"] span[aria-live]')?.textContent }
function openNewestActions(): void {
    target.querySelector<HTMLButtonElement>('article[data-chat-id="m"] [aria-label="More actions"]')!.click()
    flushSync()
}

// The shell's lazy children import the icon-library barrel, which costs tens of seconds to transform cold; paying it here keeps it out of the mount wait.
beforeAll(async () => {
    await import('@lucide/svelte')
}, 120000)

describe('ChatShell wires the reply tree into the rows', () => {
    test('a message with two alternatives shows 1 / 2 with an enabled next arrow', async () => {
        await show()
        expect(counter()).toBe('1 / 2')
        expect(target.querySelector<HTMLButtonElement>('[data-part="chat-message-alts"] [aria-label="Next reply"]')!.disabled).toBe(false)
        expect(target.querySelector<HTMLButtonElement>('[data-part="chat-message-alts"] [aria-label="Previous reply"]')!.disabled).toBe(true)
    })

    test('the action sheet offers Branch enabled and routes it to branchAt with the live index and expected id', async () => {
        await show()
        openNewestActions()
        const branch = target.querySelector<HTMLButtonElement>('[role="menuitem"][data-action="branch"]')
        expect(branch).not.toBeNull()
        expect(branch!.disabled).toBe(false)
        branch!.click()
        await vi.waitFor(() => expect(composer.branchAt).toHaveBeenCalledTimes(1), { timeout: 5000 })
        expect(composer.branchAt).toHaveBeenCalledWith(expect.anything(), 1, 'm')
    })

    test('a running generation disables the sibling arrows and the new reply control, and a press does not generate', async () => {
        await show()
        doingChat.set(true)
        flushSync()
        await tick()
        const row = target.querySelector('[data-part="chat-message-alts"]')!
        expect(row.querySelector<HTMLButtonElement>('[aria-label="Next reply"]')!.disabled).toBe(true)
        const generate = row.querySelector<HTMLButtonElement>('[data-action="newReply"]')!
        expect(generate.disabled).toBe(true)
        generate.click()
        expect(composer.regenerateNewest).not.toHaveBeenCalled()
    })

    test('the composer window keeps the controls disabled after the generation flag clears', async () => {
        await show()
        composer.busy = true
        doingChat.set(true)
        flushSync()
        doingChat.set(false)
        flushSync()
        await tick()
        expect(target.querySelector<HTMLButtonElement>('[data-part="chat-message-alts"] [aria-label="Next reply"]')!.disabled).toBe(true)
    })
})

describe('the action sheet is hosted outside the transcript', () => {
    test('it is not a descendant of the transcript and the transcript is inert while it is open', async () => {
        await show()
        const transcript = target.querySelector('[data-part="chat-transcript"]')!
        expect(transcript.hasAttribute('inert')).toBe(false)
        openNewestActions()
        const sheet = target.querySelector('[data-part="chat-sheet"]')
        expect(sheet).not.toBeNull()
        expect(transcript.contains(sheet)).toBe(false)
        expect(target.querySelectorAll('[data-part="chat-sheet"]').length).toBe(1)
        expect(transcript.hasAttribute('inert')).toBe(true)
        target.querySelector<HTMLButtonElement>('[data-part="chat-sheet-scrim"]')!.click()
        flushSync()
        await tick()
        expect(target.querySelector('[data-part="chat-sheet"]')).toBeNull()
        expect(transcript.hasAttribute('inert')).toBe(false)
    })

    test('the sheet closes with the row that opened it when that row is removed from the chat', async () => {
        await show()
        openNewestActions()
        expect(target.querySelector('[data-part="chat-sheet"]')).not.toBeNull()
        const list = DBState.db.characters[0].chats[0].message
        const removed = list.splice(1, 1)
        try {
            flushSync()
            await tick()
            flushSync()
            expect(target.querySelector('article[data-chat-id="m"]')).toBeNull()
            expect(target.querySelector('[data-part="chat-sheet"]')).toBeNull()
        } finally {
            list.push(...removed)
        }
    })

    test('the customize sheet is hosted there too and opens from the action sheet', async () => {
        await show()
        const transcript = target.querySelector('[data-part="chat-transcript"]')!
        openNewestActions()
        target.querySelector<HTMLButtonElement>('[role="menuitem"][data-action="customizeButtons"]')!.click()
        flushSync()
        await tick()
        const customize = target.querySelector('[role="dialog"][data-part="chat-sheet"]')
        expect(customize).not.toBeNull()
        expect(transcript.contains(customize)).toBe(false)
        expect(transcript.hasAttribute('inert')).toBe(true)
    })
})
