// @vitest-environment jsdom
// The end-of-stream swap in a shell message row: the streaming view (with its focusable code chip) is replaced by the
// finished body, and a focus that was inside the streaming view moves to the message instead of dropping to the page.
import { afterEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'
import type { character as Character, Message } from '../../ts/storage/database.svelte'
import { tickFake } from '../../ts/tests/svelteTick.test-helpers'

vi.mock('../../ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    const DBState = $state({ db: { username: 'User', userIcon: '', autoTranslate: false,
        autoScrollToNewMessage: false, alwaysScrollToNewMessage: false,
        chatLoadInitialPages: 2, chatLoadAdditionalPages: 2 } })
    const ReloadChatPointer = writable<Record<number, number>>({})
    const ReloadGUIPointer = writable(0)
    const ScrollToMessageStore = $state({ value: -1 })
    const selIdState = $state({ selId: 0 })
    return { DBState, selIdState, HideIconStore: writable(false), ReloadChatPointer, ReloadGUIPointer, ScrollToMessageStore, createSimpleCharacter: () => null }
})
vi.mock('../../ts/globalApi.svelte', () => {
    const chatFoldedState = $state<{ data: null }>({ data: null })
    const chatFoldedStateMessageIndex = $state({ index: -1 })
    return { chatFoldedState, chatFoldedStateMessageIndex, aiLawApplies: () => false }
})
vi.mock('../../ts/process/firstMessage', () => ({ firstMessageOf: () => 'Greeting', firstMessageIndexOf: () => -1, nextFirstMessageIndex: () => -1 }))
vi.mock('../../ts/process/activeStreams', () => ({ isActiveStreamReply: (id: string | undefined) => id === 'stream' }))
vi.mock('../../ts/localDrafts', () => ({ hasMessageEditorDrafts: () => false, onDraftsChanged: () => () => {} }))
vi.mock('../ChatScreens/chatSurface.svelte', () => {
    const chatSurface = $state({ hidden: false, rebuildEpoch: 0, closeEpoch: 0, heldGui: 0, heldChat: {} as Record<number, number> })
    return { chatSurface, isChatSurfaceInstalled: () => true, onSurfaceHiding: () => () => {} }
})
vi.mock('../../ts/caughtErrors', () => ({ recordCaughtError: vi.fn() }))
vi.mock('../../lang', () => ({ language: { loadMore: 'Load more', messageRenderFailed: 'Failed', messageRenderRetry: 'Retry', messageInterrupted: 'Interrupted', chatShellWritingCount: (n: number) => `W${n}`,
    chatShellThinking: (words: number) => `Thinking ${words}`, chatShellFormatting: 'Formatting', chatShellWritingCode: (lines: number) => `Writing code ${lines}`,
    chatShellWritingStyles: 'Writing styles', chatShellImageLoading: 'Image loading' } }))
vi.mock('../../ts/characters', () => ({ getCharImage: async () => null }))
vi.mock('../../ts/model/modellist', () => ({ getModelInfo: () => ({ shortName: 'model' }) }))
vi.mock('../../ts/storage/database.svelte', () => ({ getCurrentCharacter: () => null }))
vi.mock('../../ts/parser/parser.svelte', () => ({ ParseMarkdown: async (text: string) => text }))
vi.mock('../../ts/parser/chatML', () => ({}))
vi.mock('../../ts/process/moduleRefList', () => ({ hasModuleStubs: () => false }))
vi.mock('../../ts/process/moduleEnsure', () => ({ ensureCurrentModulesOrAlert: async () => true }))
vi.mock('../../ts/translator/translator', () => ({ getLLMCache: async () => null }))
vi.mock('../../ts/process/ttsModes', () => ({ isTTSVoiceMode: () => false }))
vi.mock('../../ts/process/scripts', () => ({ risuChatParser: (text: string) => text }))
vi.mock('../../ts/process/displayParseOptions', () => ({ buildDisplayParseOptions: () => ({}) }))
vi.mock('../../ts/alert', () => ({ alertError: vi.fn(), alertRequestData: vi.fn() }))
vi.mock('../../ts/process/messageActions.svelte', () => ({ handleButtonTriggerWithin: vi.fn(), handleFormTriggerWithin: vi.fn(), playMessageTTS: vi.fn() }))
vi.mock('../../ts/process/messageEditorController.svelte', () => ({ createMessageEditorController: () => ({
    editMode: false, editTranslationMode: false, translationViewControlsDisabled: false,
    translationEditControlDisabled: false, originalEditControlDisabled: false,
    dispose: () => {},
}) }))
vi.mock('../ChatScreens/PartialEditController.svelte', () => ({ default: () => ({}) }))
vi.mock('./MessageEditor.svelte', () => ({ default: () => ({}) }))
vi.mock('./TranslationEditor.svelte', () => ({ default: () => ({}) }))
vi.mock('../ChatScreens/ChatBody.svelte', () => ({ default: (anchor: Comment, props: { msgDisplay?: string }) => {
    const node = document.createElement('div')
    node.setAttribute('data-part', 'completed-body')
    anchor.before(node)
    $effect(() => { node.textContent = `${props.msgDisplay}` })
    return {}
} }))
// The real streaming view renders the code chip; only its HTML conversion and its yields are stubbed.
vi.mock('../../ts/chatShell/streamingSafe', async (importOriginal) => {
    const original = await importOriginal<typeof import('../../ts/chatShell/streamingSafe')>()
    return { ...original, createToSafeHtml: async () => async (source: string) => `<p>${source}</p>` }
})
vi.mock('../../ts/chatShell/yieldToEventLoop', () => ({ yieldToEventLoop: async () => {} }))

import ShellMessageList from './ShellMessageList.svelte'

let app: ReturnType<typeof ShellMessageList> | undefined
let target: HTMLElement
const character = $state({ chaId: 'c', type: 'character', name: 'Ari', image: '', chatPage: 0,
    chats: [{ id: 'room', message: [] as Message[] }] }) as Character

function streamRow(): HTMLElement | null { return target.querySelector<HTMLElement>('[data-chat-id="stream"]') }
async function settle() {
    await vi.advanceTimersByTimeAsync(150)
    await tickFake()
}
async function show(data: string) {
    character.chats[0].message = [{ chatId: 'stream', role: 'char', data }]
    character.chats[0].isStreaming = true
    target = document.createElement('div')
    const host = document.createElement('main')
    target.appendChild(host)
    document.body.appendChild(target)
    app = mount(ShellMessageList, { target: host, props: { character, host } })
    flushSync()
    await settle()
}
afterEach(async () => {
    if (app) await unmount(app)
    app = undefined
    target?.remove()
    character.chats[0].message = []
    character.chats[0].isStreaming = false
    vi.useRealTimers()
})

describe('ShellMessage end-of-stream focus', () => {
    test('T-565-1 (reproducer): a focused code chip replaced at stream end hands focus to its message, not to the page', async () => {
        vi.useFakeTimers()
        await show('Intro\n\n```js\nl1')
        const chip = streamRow()?.querySelector<HTMLElement>('[data-part="chat-stream-code"]')
        expect(chip).not.toBeNull()
        chip!.focus()
        expect(document.activeElement).toBe(chip)
        character.chats[0].isStreaming = false
        flushSync()
        await settle()
        expect(streamRow()?.querySelector('[data-part="chat-stream-code"]')).toBeNull()
        expect(streamRow()?.querySelector('[data-part="completed-body"]')).not.toBeNull()
        expect(document.activeElement).not.toBe(document.body)
        expect(document.activeElement).toBe(streamRow())
    })

    test('T-565-2 (guard, passes before and after): focus outside the streaming body stays where it is at stream end', async () => {
        vi.useFakeTimers()
        await show('Intro\n\n```js\nl1')
        const outside = document.createElement('button')
        document.body.appendChild(outside)
        outside.focus()
        character.chats[0].isStreaming = false
        flushSync()
        await settle()
        expect(document.activeElement).toBe(outside)
        outside.remove()
    })
})
