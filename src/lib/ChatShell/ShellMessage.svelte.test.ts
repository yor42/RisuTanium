// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'
import type { Message } from '../../ts/storage/database.svelte'

const bodyCalls = vi.fn()
const streamCalls = vi.fn()
vi.mock('../ChatScreens/ChatBody.svelte', () => ({ default: (anchor: Comment) => {
    bodyCalls()
    const node = document.createElement('div')
    node.setAttribute('data-part', 'completed-body')
    anchor.before(node)
    return {}
} }))
vi.mock('./StreamingView.svelte', () => ({ default: (anchor: Comment) => {
    streamCalls()
    const node = document.createElement('div')
    node.setAttribute('data-part', 'streaming-body')
    anchor.before(node)
    return {}
} }))
vi.mock('../../ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    const DBState = $state({ db: {} })
    const selIdState = $state({ selId: 0 })
    return { DBState, selIdState, HideIconStore: writable(false) }
})
vi.mock('../ChatScreens/chatSurface.svelte', () => {
    const chatSurface = $state({ rebuildEpoch: 0, closeEpoch: 0 })
    return { chatSurface, isChatSurfaceInstalled: () => false }
})
vi.mock('../../ts/globalApi.svelte', () => ({ aiLawApplies: () => false }))
vi.mock('../../ts/storage/database.svelte', () => ({ getCurrentCharacter: () => null }))
vi.mock('../../ts/parser/parser.svelte', () => ({ ParseMarkdown: async (text: string) => text }))
vi.mock('../../ts/parser/chatML', () => ({}))
vi.mock('../../ts/process/moduleRefList', () => ({ hasModuleStubs: () => false }))
vi.mock('../../ts/process/moduleEnsure', () => ({ ensureCurrentModulesOrAlert: async () => true }))
vi.mock('../../ts/translator/translator', () => ({ getLLMCache: async () => null }))
vi.mock('../../ts/process/ttsModes', () => ({ isTTSVoiceMode: () => false }))
vi.mock('../../ts/process/scripts', () => ({ risuChatParser: (text: string) => text }))
vi.mock('../../ts/process/displayParseOptions', () => ({ buildDisplayParseOptions: () => ({}) }))
vi.mock('../../ts/caughtErrors', () => ({ recordCaughtError: vi.fn() }))
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
vi.mock('../../ts/characters', () => ({ getCharImage: async () => null }))
vi.mock('../../ts/model/modellist', () => ({ getModelInfo: () => ({ shortName: 'model' }) }))
vi.mock('../../lang', () => ({ language: { messageInterrupted: 'Interrupted' } }))

import ShellMessage from './ShellMessage.svelte'

const mounted: Array<{ target: HTMLElement, app: ReturnType<typeof ShellMessage> }> = []
afterEach(async () => {
    for (const { target, app } of mounted.splice(0)) { await unmount(app); target.remove() }
    bodyCalls.mockClear()
    streamCalls.mockClear()
})

function show(message: Message, streaming: boolean) {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(ShellMessage, { target, props: { idx: 1, chatId: message.chatId, name: 'Ari', message, streaming } })
    mounted.push({ target, app })
    flushSync()
    return target
}

describe('ShellMessage minimal prose row', () => {
    test('completed message is a named article using the completed body', () => {
        const target = show({ role: 'char', data: 'Hello', chatId: 'm' }, false)
        const article = target.querySelector('article[data-part="chat-message"]')
        expect(article?.getAttribute('aria-labelledby')).toBe(article?.querySelector('[data-part="chat-message-meta"] span')?.id)
        expect(target.querySelector('[data-part="completed-body"]')).not.toBeNull()
        expect(streamCalls).not.toHaveBeenCalled()
    })

    test('streaming row uses the streaming view, then an interrupted completed row shows its note', () => {
        const target = show({ role: 'char', data: 'Partial', chatId: 'm', interrupted: true }, true)
        expect(target.querySelector('[data-part="streaming-body"]')).not.toBeNull()
        expect(bodyCalls).not.toHaveBeenCalled()
        expect(target.querySelector('[data-part="chat-message-interrupted"]')).toBeNull()
        const completed = show({ role: 'char', data: 'Partial', chatId: 'n', interrupted: true }, false)
        expect(completed.querySelector('[data-part="chat-message-interrupted"]')?.textContent).toContain('Interrupted')
    })
})
