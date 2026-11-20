// @vitest-environment jsdom
/**
 * The body's `prose-invert` class follows the tone of the surface the row sits on, not the mere
 * presence of a scheme type: a light scheme without a theme pack must not get the pale
 * inverted prose colours, a pack surface (fixed dark base) and a dark scheme must.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, tick, unmount } from 'svelte'
import type { Message } from '../../ts/storage/database.svelte'

vi.mock('../../ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    const DBState = $state({ db: { zoomsize: 100, lineHeight: 1.25 } as Record<string, unknown> })
    const selIdState = $state({ selId: 0 })
    return { DBState, selIdState, HideIconStore: writable(false) }
})
vi.mock('../ChatScreens/ChatBody.svelte', () => ({ default: () => ({}) }))
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
vi.mock('../../lang', () => ({ language: { noMessage: 'Type something to start the chat.' } }))

import ShellMessage from './ShellMessage.svelte'
import { ColorSchemeTypeStore, packBaseTone } from '../../ts/gui/surfaceTone'

let app: ReturnType<typeof ShellMessage> | undefined
let target: HTMLElement
async function show(): Promise<HTMLElement> {
    target = document.createElement('div')
    document.body.appendChild(target)
    const message: Message = { role: 'char', data: '', chatId: 'm' }
    app = mount(ShellMessage, { target, props: { idx: 0, chatId: 'm', name: 'Ari', message, firstMessage: true } })
    flushSync()
    await tick()
    return target.querySelector<HTMLElement>('[data-part="chat-message-body"]') as HTMLElement
}
afterEach(async () => {
    if (app) await unmount(app)
    app = undefined
    target?.remove()
    ColorSchemeTypeStore.set('dark')
    packBaseTone.set(null)
})

describe('ShellMessage body prose-invert follows the surface tone', () => {
    test('RR: a light scheme without a pack drops prose-invert on the empty first-message text', async () => {
        ColorSchemeTypeStore.set('light')
        const body = await show()
        expect(body.textContent).toContain('Type something to start the chat.')
        expect(body.classList.contains('prose')).toBe(true)
        expect(body.classList.contains('prose-invert')).toBe(false)
    })

    test('CG (passes before and after): a pack surface on the fixed dark base keeps prose-invert under a light scheme', async () => {
        ColorSchemeTypeStore.set('light')
        packBaseTone.set('dark')
        const body = await show()
        expect(body.classList.contains('prose-invert')).toBe(true)
    })

    test('CG (passes before and after): a dark scheme keeps prose-invert', async () => {
        const body = await show()
        expect(body.classList.contains('prose-invert')).toBe(true)
    })

    test('RR: a live switch to light drops prose-invert and back to dark restores it', async () => {
        const body = await show()
        ColorSchemeTypeStore.set('light')
        flushSync()
        expect(body.classList.contains('prose-invert')).toBe(false)
        ColorSchemeTypeStore.set('dark')
        flushSync()
        expect(body.classList.contains('prose-invert')).toBe(true)
    })
})
