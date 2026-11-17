// @vitest-environment jsdom
// The per-character render-when-complete setting in the shell's message list: a streaming reply row shows a character
// count instead of its text while the setting is on, and the normal body at completion.
import { afterEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, tick, unmount } from 'svelte'
import type { character as Character, Message } from '../../ts/storage/database.svelte'

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
vi.mock('../../lang', () => ({ language: { loadMore: 'Load more', messageRenderFailed: 'Failed', messageRenderRetry: 'Retry', messageInterrupted: 'Interrupted', chatShellWritingCount: (n: number) => `W${n}` } }))
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
vi.mock('./StreamingView.svelte', () => ({ default: (anchor: Comment) => {
    const node = document.createElement('div')
    node.setAttribute('data-part', 'stream-marker')
    anchor.before(node)
    return {}
} }))

import ShellMessageList from './ShellMessageList.svelte'

let app: ReturnType<typeof ShellMessageList> | undefined
let target: HTMLElement
let host: HTMLElement
const character = $state({ chaId: 'c', type: 'character', name: 'Ari', image: '', chatPage: 0,
    chats: [{ id: 'room', message: [] as Message[] }] }) as Character

const PLACEHOLDER = '[data-part="chat-stream-placeholder"]'
function find(id: string) { return target.querySelector(`[data-chat-id="${id}"]`) }
function streamRow(): Element | null { return find('stream') }
async function show(streaming: boolean, data: string) {
    character.chats[0].message = [{ chatId: 'stream', role: 'char', data }]
    character.chats[0].isStreaming = streaming
    target = document.createElement('div')
    host = document.createElement('main')
    target.appendChild(host)
    document.body.appendChild(target)
    app = mount(ShellMessageList, { target: host, props: { character, host } })
    flushSync()
    await tick()
}
afterEach(async () => {
    if (app) await unmount(app)
    app = undefined
    target?.remove()
    character.chats[0].message = []
    character.chats[0].isStreaming = false
    delete character.risutanium_render_when_complete
})

describe('the English count string', () => {
    test('B23 (string pin, passes only once the key exists): the count is a plain number with a singular and a plural noun', async () => {
        const { languageEnglish } = await vi.importActual<typeof import('../../lang/en')>('../../lang/en')
        expect(languageEnglish.chatShellWritingCount(1)).toBe('Writing the reply… 1 character')
        expect(languageEnglish.chatShellWritingCount(1234)).toBe('Writing the reply… 1234 characters')
    })
})

describe('ShellMessageList render when complete', () => {
    test('B13: a streaming row shows the UTF-16 count instead of the text, follows each chunk, and the body returns at completion', async () => {
        character.risutanium_render_when_complete = true
        await show(true, '😀a')
        const placeholder = () => streamRow()?.querySelector(PLACEHOLDER)
        expect(placeholder()?.textContent).toBe('W3')
        expect(streamRow()?.querySelector('[data-part="stream-marker"]')).toBeNull()
        character.chats[0].message[0].data += 'bcd'
        flushSync()
        expect(placeholder()?.textContent).toBe('W6')
        character.chats[0].isStreaming = false
        flushSync()
        await tick()
        expect(placeholder()).toBeNull()
        expect(streamRow()?.querySelector('[data-part="completed-body"]')?.textContent).toBe('😀abcd')
    })

    test('B13b: turning the setting off mid-stream brings the streaming view back', async () => {
        character.risutanium_render_when_complete = true
        await show(true, 'abc')
        expect(streamRow()?.querySelector(PLACEHOLDER)).not.toBeNull()
        const before = streamRow()
        character.risutanium_render_when_complete = false
        flushSync()
        // The same mounted row follows the setting: the prop is reactive, not read once at mount.
        expect(streamRow()).toBe(before)
        expect(streamRow()?.querySelector(PLACEHOLDER)).toBeNull()
        expect(streamRow()?.querySelector('[data-part="stream-marker"]')).not.toBeNull()
    })

    test('B14 (guard, passes before and after): an absent or false setting keeps the streaming view', async () => {
        await show(true, 'abc')
        expect(streamRow()?.querySelector('[data-part="stream-marker"]')).not.toBeNull()
        expect(streamRow()?.querySelector(PLACEHOLDER)).toBeNull()
        character.risutanium_render_when_complete = false
        flushSync()
        expect(streamRow()?.querySelector('[data-part="stream-marker"]')).not.toBeNull()
        expect(streamRow()?.querySelector(PLACEHOLDER)).toBeNull()
    })

    test('B15 (guard, passes before and after): with the setting on and the row not streaming, the normal body shows', async () => {
        character.risutanium_render_when_complete = true
        await show(false, 'done text')
        expect(streamRow()?.querySelector(PLACEHOLDER)).toBeNull()
        expect(streamRow()?.querySelector('[data-part="completed-body"]')?.textContent).toBe('done text')
    })

    test('B16: the placeholder is silent: no role, no live region of its own, inside a list that is aria-live off', async () => {
        character.risutanium_render_when_complete = true
        await show(true, 'abc')
        const placeholder = streamRow()?.querySelector(PLACEHOLDER)
        expect(placeholder).not.toBeNull()
        expect(placeholder?.hasAttribute('role')).toBe(false)
        expect(placeholder?.hasAttribute('aria-live')).toBe(false)
        const live = placeholder?.closest('[aria-live]')
        expect(live?.getAttribute('aria-live')).toBe('off')
    })
})
