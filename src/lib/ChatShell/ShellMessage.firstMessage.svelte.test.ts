// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'
import { tickFake } from '../../ts/tests/svelteTick.test-helpers'

const stepSibling = vi.hoisted(() => vi.fn())
const regenerateNewest = vi.hoisted(() => vi.fn())
vi.mock('../../ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    const DBState = $state({ db: {
        username: 'User', userIcon: '', translator: '', swipe: true, autoTranslate: false,
        autoScrollToNewMessage: false, alwaysScrollToNewMessage: false, chatLoadInitialPages: 5, chatLoadAdditionalPages: 5,
        characters: [{
            chaId: 'c', type: 'character', name: 'Ari', image: '', chatPage: 0, firstMessage: 'Default hello', alternateGreetings: ['Second hello', 'Third hello'],
            chats: [{ id: 'chat', message: [] as unknown[], fmIndex: -1 as number | undefined }],
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
vi.mock('../../ts/process/composerActions.svelte', () => ({ stepSibling, regenerateNewest }))
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
vi.mock('../../ts/parser/parser.svelte', () => ({ ParseMarkdown: async (text: string) => text }))
vi.mock('../../ts/parser/chatML', () => ({}))
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
    copyMessageText: vi.fn(), copyMessageAsCard: vi.fn(), toggleMessageDisabled: vi.fn(), toggleBookmark: vi.fn(), branchMessage: vi.fn(),
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
vi.mock('../../lang', () => ({ language: {
    chatShellMoreActions: 'More actions', chatShellPreviousReply: 'Previous reply', chatShellNextReply: 'Next reply',
    chatShellFirstReply: 'First reply', chatShellLastReply: 'Last reply', chatShellNewReply: 'New reply',
    chatShellReplyOf: (index: number, total: number) => `Reply ${index} of ${total}`, chatShellFirstMessageOf: (index: number, total: number) => `First message ${index} of ${total}`, noMessage: 'No message',
} }))

import ShellMessageList from './ShellMessageList.svelte'
import { DBState } from '../../ts/stores.svelte'
import { firstMessageIndexOf } from '../../ts/process/firstMessage'

let app: ReturnType<typeof ShellMessageList> | undefined
let target: HTMLElement
async function show(): Promise<void> {
    target = document.createElement('div')
    const host = document.createElement('main')
    target.appendChild(host)
    document.body.appendChild(target)
    app = mount(ShellMessageList, { target: host, props: { character: DBState.db.characters[0] as never, host } })
    flushSync()
    await tickFake()
}
afterEach(async () => {
    if (app) await unmount(app)
    app = undefined
    target?.remove()
    DBState.db.characters[0].chats[0].fmIndex = -1
    stepSibling.mockClear()
    regenerateNewest.mockClear()
})
function row(): HTMLElement { return target.querySelector<HTMLElement>('[data-part="chat-first-message"]')! }
function counter(): string | null | undefined { return row().querySelector('[data-part="chat-message-alts"] span[aria-live]')?.textContent }
function button(label: string): HTMLButtonElement { return row().querySelector<HTMLButtonElement>(`[data-part="chat-message-alts"] [aria-label="${label}"]`)! }
function fmIndex(): number { return DBState.db.characters[0].chats[0].fmIndex ?? -1 }

describe('first message alternatives', () => {
    test('the row shows the counter n / N from the stored greeting index', async () => {
        await show()
        expect(counter()).toBe('First message 1 of 3')
        DBState.db.characters[0].chats[0].fmIndex = 1
        flushSync()
        expect(firstMessageIndexOf(DBState.db.characters[0] as never, DBState.db.characters[0].chats[0])).toBe(1)
        expect(counter()).toBe('First message 3 of 3')
    })

    test('the next arrow steps fmIndex through the greetings, never touches the reply tree and never generates', async () => {
        await show()
        button('Next reply').click()
        flushSync()
        expect(fmIndex()).toBe(0)
        expect(counter()).toBe('First message 2 of 3')
        button('Next reply').click()
        flushSync()
        expect(fmIndex()).toBe(1)
        expect(counter()).toBe('First message 3 of 3')
        expect(stepSibling).not.toHaveBeenCalled()
        expect(regenerateNewest).not.toHaveBeenCalled()
    })

    test('the previous arrow steps back to the default message', async () => {
        DBState.db.characters[0].chats[0].fmIndex = 1
        await show()
        button('Previous reply').click()
        flushSync()
        expect(fmIndex()).toBe(0)
        button('Previous reply').click()
        flushSync()
        expect(fmIndex()).toBe(-1)
        expect(counter()).toBe('First message 1 of 3')
        expect(stepSibling).not.toHaveBeenCalled()
    })

    test('the row stops at both ends as its counter shows, and has no new reply control', async () => {
        await show()
        expect(button('Previous reply').disabled).toBe(true)
        expect(row().querySelector('[data-action="newReply"]')).toBeNull()
        DBState.db.characters[0].chats[0].fmIndex = 1
        flushSync()
        expect(button('Next reply').disabled).toBe(true)
        button('Next reply').click()
        flushSync()
        expect(fmIndex()).toBe(1)
    })

    test('the keyboard follows the same greeting steps and never generates', async () => {
        await show()
        const article = row().querySelector('article')!
        article.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }))
        flushSync()
        expect(fmIndex()).toBe(0)
        expect(stepSibling).not.toHaveBeenCalled()
        expect(regenerateNewest).not.toHaveBeenCalled()
    })

    test('a character without alternate greetings shows no counter row', async () => {
        const original = DBState.db.characters[0].alternateGreetings
        DBState.db.characters[0].alternateGreetings = []
        await show()
        expect(row().querySelector('[data-part="chat-message-alts"]')).toBeNull()
        DBState.db.characters[0].alternateGreetings = original
    })
})

describe('first message swipe feedback (CHORE-727)', () => {
    function body(): HTMLElement { return row().querySelector<HTMLElement>('[data-part="chat-message-body"]')! }
    function pointer(kind: string, x: number, time: number): void {
        const event = new MouseEvent(kind, { bubbles: true, clientX: x, clientY: 100 })
        Object.defineProperties(event, { pointerType: { value: 'touch' }, timeStamp: { value: time }, pointerId: { value: 1 } })
        body().dispatchEvent(event)
        flushSync()
    }
    function peek(): HTMLElement | null { return row().querySelector<HTMLElement>('[data-part="chat-swipe-peek"]') }

    test('the next greeting peeks in from the list: position 2 is the first alternate greeting', async () => {
        Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true })
        await show()
        pointer('pointerdown', 500, 0)
        pointer('pointermove', 440, 100)
        expect(peek()!.querySelector('[data-part="chat-swipe-peek-chip"]')!.textContent).toBe('2 / 3')
        expect(peek()!.querySelector('[data-part="chat-swipe-peek-text"]')!.textContent).toBe('Second hello')
        pointer('pointercancel', 440, 150)
    })

    test('from the first alternate greeting the previous one is the default first message', async () => {
        Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true })
        DBState.db.characters[0].chats[0].fmIndex = 0
        await show()
        pointer('pointerdown', 500, 0)
        pointer('pointermove', 560, 100)
        expect(peek()!.querySelector('[data-part="chat-swipe-peek-chip"]')!.textContent).toBe('1 / 3')
        expect(peek()!.querySelector('[data-part="chat-swipe-peek-text"]')!.textContent).toBe('Default hello')
        pointer('pointercancel', 560, 150)
    })

    test('a committed swipe on the first message lands after the slide-out and leaves the row at rest in place', async () => {
        Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true })
        vi.useFakeTimers()
        try {
            await show()
            pointer('pointerdown', 500, 0)
            pointer('pointermove', 300, 100)
            pointer('pointerup', 300, 200)
            expect(body().hasAttribute('data-settle')).toBe(true)
            expect(fmIndex()).toBe(-1)
            await vi.advanceTimersByTimeAsync(260)
            flushSync()
            expect(fmIndex()).toBe(0)
            expect(body().hasAttribute('data-settle')).toBe(false)
            expect(body().style.transform).toBe('')
            expect(peek()).toBeNull()
        } finally {
            vi.useRealTimers()
        }
    })
})
