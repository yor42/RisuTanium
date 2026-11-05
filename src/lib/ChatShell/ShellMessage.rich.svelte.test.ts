// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, tick, unmount } from 'svelte'
import type { Message } from '../../ts/storage/database.svelte'

const law = vi.hoisted(() => ({ applies: false }))
const voice = vi.hoisted(() => ({ enabled: false }))
const playMessageTTS = vi.hoisted(() => vi.fn())
const stopTTS = vi.hoisted(() => vi.fn())
vi.mock('../../ts/process/tts', () => ({ stopTTS }))
vi.mock('../../ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    const DBState = $state({ db: { requestInfoInsideChat: false, translator: '', characters: [{ chaId: 'c', chatPage: 0,
        chats: [{ id: 'room', message: [] as Message[], bookmarks: ['m'] }] }], memoryLimitThickness: 3 } })
    const selIdState = $state({ selId: 0 })
    return { DBState, selIdState, HideIconStore: writable(false) }
})
vi.mock('../../ts/globalApi.svelte', () => ({ aiLawApplies: () => law.applies }))
vi.mock('../../ts/storage/database.svelte', () => ({ getCurrentCharacter: () => null }))
vi.mock('../../ts/parser/parser.svelte', () => ({ ParseMarkdown: async (text: string) => text }))
vi.mock('../../ts/parser/chatML', () => ({}))
vi.mock('../../ts/process/moduleRefList', () => ({ hasModuleStubs: () => false }))
vi.mock('../../ts/process/moduleEnsure', () => ({ ensureCurrentModulesOrAlert: async () => true }))
vi.mock('../../ts/translator/translator', () => ({ getLLMCache: async () => null }))
vi.mock('../../ts/process/ttsModes', () => ({ isTTSVoiceMode: () => voice.enabled }))
vi.mock('../../ts/process/scripts', () => ({ risuChatParser: (text: string) => {
    if (text === 'bad parse') throw new Error('parse')
    return text
} }))
vi.mock('../../ts/process/displayParseOptions', () => ({ buildDisplayParseOptions: () => ({}) }))
vi.mock('../../ts/caughtErrors', () => ({ recordCaughtError: vi.fn() }))
vi.mock('../../ts/alert', () => ({ alertError: vi.fn(), alertRequestData: vi.fn() }))
vi.mock('../../ts/process/messageActions.svelte', () => ({ handleButtonTriggerWithin: vi.fn(), handleFormTriggerWithin: vi.fn(), playMessageTTS }))
vi.mock('../../ts/process/messageEditorController.svelte', () => ({ createMessageEditorController: () => ({
    editMode: false, editTranslationMode: false, translationViewControlsDisabled: false,
    translationEditControlDisabled: false, originalEditControlDisabled: false, dispose: () => {},
}) }))
vi.mock('../ChatScreens/PartialEditController.svelte', () => ({ default: () => ({}) }))
vi.mock('./MessageEditor.svelte', () => ({ default: () => ({}) }))
vi.mock('./TranslationEditor.svelte', () => ({ default: () => ({}) }))
vi.mock('../ChatScreens/ChatBody.svelte', () => ({ default: (anchor: Comment, props: { msgDisplay: string }) => {
    const node = document.createElement('div')
    node.textContent = props.msgDisplay
    anchor.before(node)
    return {}
} }))
vi.mock('./StreamingView.svelte', () => ({ default: () => ({}) }))
vi.mock('../ChatScreens/chatSurface.svelte', () => {
    const chatSurface = $state({ rebuildEpoch: 0, closeEpoch: 0 })
    return { chatSurface, isChatSurfaceInstalled: () => false }
})
vi.mock('../../ts/characters', () => ({ getCharImage: async (source: string) => source === 'bad' ? Promise.reject(new Error('image')) : source }))
vi.mock('../../ts/model/modellist', () => ({ getModelInfo: () => ({ shortName: 'Model' }) }))
vi.mock('../../lang', () => ({ language: { bookmark: 'Bookmark', messageInterrupted: 'Interrupted', messageRenderFailed: 'Failed', edit: 'Edit', chatShellMoreActions: 'More actions', chatShellReadAloud: 'Read aloud' } }))

import ShellMessage from './ShellMessage.svelte'

let app: ReturnType<typeof ShellMessage> | undefined
let target: HTMLElement
async function show(message: Message, props: { disabled?: boolean | 'allBefore'; isLastMemory?: boolean; img?: string } = {}) {
    target = document.createElement('div')
    document.body.appendChild(target)
    app = mount(ShellMessage, { target, props: { idx: 0, chatId: message.chatId, name: 'Ari', message, ...props } })
    flushSync()
    await tick()
    return target.querySelector('article')
}
afterEach(async () => { if (app) await unmount(app); app = undefined; target?.remove(); law.applies = false; voice.enabled = false; playMessageTTS.mockReset(); stopTTS.mockClear() })

describe('ShellMessage rich states', () => {
    test('legal badge ignores the request-info setting only while the law applies', async () => {
        const message: Message = { role: 'char', data: 'Hi', chatId: 'm', generationInfo: { model: 'test' } }
        let article = await show(message)
        expect(article?.querySelector('[data-part="chat-message-generation-info"]')).toBeNull()
        if (app) await unmount(app)
        app = undefined
        target.remove()
        law.applies = true
        article = await show(message)
        expect(article?.querySelector('[data-part="chat-message-generation-info"]')?.textContent).toBe('Model')
    })

    test('bookmark, dividers and memory boundary carry distinct row states', async () => {
        const article = await show({ role: 'char', data: 'Hi', chatId: 'm' }, { disabled: 'allBefore', isLastMemory: true })
        expect(article?.hasAttribute('data-bookmarked')).toBe(true)
        expect(article?.querySelector('[data-kind="all-before"]')).not.toBeNull()
        expect(article?.querySelector('[data-part="chat-message-memory-limit"]')?.getAttribute('style')).toContain('3px')
    })

    test('rejected sender icon uses the fallback', async () => {
        const article = await show({ role: 'char', data: 'Hi', chatId: 'm' }, { img: 'bad' })
        await vi.waitFor(() => expect(article?.querySelector('[data-part="chat-message-avatar"]')?.textContent).toBe('A'), { timeout: 3000 })
    })

    test('parse failure keeps raw content and shows a note', async () => {
        const article = await show({ role: 'char', data: 'bad parse', chatId: 'm' })
        expect(article?.querySelector('[data-part="chat-message-render-failed"]')?.textContent).toContain('Failed')
        expect(article?.querySelector('[data-part="chat-message-body"]')?.textContent).toContain('bad parse')
    })

    test('TTS action appears only with an available voice and delegates playback', async () => {
        voice.enabled = true
        const article = await show({ role: 'char', data: 'Say this', chatId: 'm' })
        article?.querySelector<HTMLButtonElement>('[aria-label="More actions"]')?.click()
        flushSync()
        const button = target.querySelector<HTMLButtonElement>('[data-action="readAloud"]')
        expect(button).not.toBeNull()
        button?.click()
        expect(playMessageTTS).toHaveBeenCalledWith(false, expect.any(HTMLElement), 'Say this', null)
    })
    test('a playing row offers Stop TTS', async () => {
        voice.enabled = true
        playMessageTTS.mockReturnValue(new Promise<void>(() => {}))
        const article = await show({ role: 'char', data: 'Speak', chatId: 'm' })
        article?.querySelector<HTMLButtonElement>('[aria-label="More actions"]')?.click()
        flushSync()
        target.querySelector<HTMLButtonElement>('[data-action="readAloud"]')?.click()
        flushSync()
        article?.querySelector<HTMLButtonElement>('[data-part="chat-message-stop-tts"]')?.click()
        expect(stopTTS).toHaveBeenCalledOnce()
    })
})
