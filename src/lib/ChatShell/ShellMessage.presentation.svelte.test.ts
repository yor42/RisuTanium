// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, tick, unmount } from 'svelte'
import type { Message } from '../../ts/storage/database.svelte'

const scheme = vi.hoisted(() => ({ store: null as null | import('svelte/store').Writable<'dark' | 'light'> }))
vi.mock('../../ts/gui/colorscheme', async () => {
    const { writable } = await import('svelte/store')
    scheme.store = writable<'dark' | 'light'>('dark')
    return { ColorSchemeTypeStore: scheme.store }
})
vi.mock('../../ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    const DBState = $state({ db: { zoomsize: 120, lineHeight: 1.5, roundIcons: false } as Record<string, unknown> })
    const selIdState = $state({ selId: 0 })
    return { DBState, selIdState, HideIconStore: writable(false) }
})
vi.mock('../ChatScreens/ChatBody.svelte', () => ({ default: (anchor: Comment) => {
    const node = document.createElement('p')
    node.className = 'card-paragraph'
    node.textContent = 'body'
    anchor.before(node)
    return {}
} }))
vi.mock('./StreamingView.svelte', () => ({ default: () => ({}) }))
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
    translationEditControlDisabled: false, originalEditControlDisabled: false, dispose: () => {},
}) }))
vi.mock('../ChatScreens/PartialEditController.svelte', () => ({ default: () => ({}) }))
vi.mock('./MessageEditor.svelte', () => ({ default: () => ({}) }))
vi.mock('./TranslationEditor.svelte', () => ({ default: () => ({}) }))
vi.mock('../../ts/characters', () => ({ getCharImage: async () => null }))
vi.mock('../../ts/model/modellist', () => ({ getModelInfo: () => ({ shortName: 'model' }) }))
vi.mock('../../lang', () => ({ language: {} }))

import ShellMessage from './ShellMessage.svelte'
import { DBState } from '../../ts/stores.svelte'

let app: ReturnType<typeof ShellMessage> | undefined
let target: HTMLElement
let style: HTMLStyleElement | undefined
async function show() {
    target = document.createElement('div')
    document.body.appendChild(target)
    const message: Message = { role: 'char', data: 'Hello', chatId: 'm' }
    app = mount(ShellMessage, { target, props: { idx: 0, chatId: 'm', name: 'Ari', message } })
    flushSync()
    await tick()
    return target.querySelector<HTMLElement>('[data-part="chat-message-body"]') as HTMLElement
}
afterEach(async () => {
    if (app) await unmount(app)
    app = undefined
    target?.remove()
    style?.remove()
    style = undefined
    scheme.store?.set('dark')
    DBState.db.roundIcons = false
})

describe('ShellMessage body presentation wrapper', () => {
    test('the body carries the old row classes and the zoom and line-height styles', async () => {
        const body = await show()
        for (const name of ['text', 'chat-width', 'chattext', 'prose', 'minw-0', 'prose-invert']) expect(body.classList.contains(name)).toBe(true)
        expect(body.style.fontSize).toBe(`${0.875 * 1.2}rem`)
        expect(body.style.lineHeight).toBe(`${1.5 * 1.2}rem`)
    })

    test('prose-invert follows the old row rule: any non-empty colour scheme value turns it on', async () => {
        const body = await show()
        scheme.store?.set('light')
        flushSync()
        expect(body.classList.contains('prose-invert')).toBe(true)
        scheme.store?.set('' as 'dark')
        flushSync()
        expect(body.classList.contains('prose-invert')).toBe(false)
    })

    test('card CSS rewritten to .chattext reaches the body content', async () => {
        style = document.createElement('style')
        style.textContent = '.chattext .card-paragraph { color: rgb(1, 2, 3); }'
        document.head.appendChild(style)
        const body = await show()
        const paragraph = body.querySelector<HTMLElement>('.card-paragraph')
        expect(paragraph).not.toBeNull()
        expect(getComputedStyle(paragraph as HTMLElement).color).toBe('rgb(1, 2, 3)')
    })

    test('roundIcons marks the avatar round', async () => {
        DBState.db.roundIcons = true
        await show()
        await tick()
        await tick()
        const avatar = target.querySelector('[data-part="chat-message-avatar"]')
        expect(avatar).not.toBeNull()
        expect(avatar?.hasAttribute('data-round')).toBe(true)
        DBState.db.roundIcons = false
        flushSync()
        expect(avatar?.hasAttribute('data-round')).toBe(false)
    })
})
