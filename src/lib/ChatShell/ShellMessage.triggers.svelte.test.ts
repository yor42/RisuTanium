// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'
import type { Message } from '../../ts/storage/database.svelte'

const handleButtonTriggerWithin = vi.hoisted(() => vi.fn())
const handleFormTriggerWithin = vi.hoisted(() => vi.fn())
vi.mock('../../ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    const DBState = $state({ db: { translator: '', characters: [] } })
    const selIdState = $state({ selId: 0 })
    return { DBState, selIdState, HideIconStore: writable(false) }
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
vi.mock('../../ts/process/messageActions.svelte', () => ({ handleButtonTriggerWithin, handleFormTriggerWithin, playMessageTTS: vi.fn() }))
vi.mock('../../ts/process/messageEditorController.svelte', () => ({ createMessageEditorController: () => ({
    editMode: false, editTranslationMode: false, translationViewControlsDisabled: false,
    translationEditControlDisabled: false, originalEditControlDisabled: false, dispose: () => {},
}) }))
vi.mock('../ChatScreens/PartialEditController.svelte', () => ({ default: () => ({}) }))
vi.mock('./MessageEditor.svelte', () => ({ default: () => ({}) }))
vi.mock('./TranslationEditor.svelte', () => ({ default: () => ({}) }))
vi.mock('../ChatScreens/ChatBody.svelte', () => ({ default: (anchor: Comment) => {
    const trigger = document.createElement('button')
    trigger.setAttribute('risu-trigger', 'go')
    trigger.textContent = 'Run'
    const form = document.createElement('form')
    form.setAttribute('risu-form', 'send')
    anchor.before(trigger, form)
    return {}
} }))
vi.mock('./StreamingView.svelte', () => ({ default: () => ({}) }))
vi.mock('../ChatScreens/chatSurface.svelte', () => {
    const chatSurface = $state({ rebuildEpoch: 0, closeEpoch: 0 })
    return { chatSurface, isChatSurfaceInstalled: () => false }
})
vi.mock('../../ts/characters', () => ({ getCharImage: async () => null }))
vi.mock('../../ts/model/modellist', () => ({ getModelInfo: () => ({ shortName: 'model' }) }))
vi.mock('../../lang', () => ({ language: { edit: 'Edit', messageInterrupted: 'Interrupted' } }))

import ShellMessage from './ShellMessage.svelte'

let app: ReturnType<typeof ShellMessage> | undefined
let target: HTMLElement
const message: Message = { role: 'char', data: 'interactive', chatId: 'row' }
const props = $state({ idx: 0, chatId: 'row', name: 'Ari', message })
afterEach(async () => { if (app) await unmount(app); app = undefined; target?.remove(); props.idx = 0; handleButtonTriggerWithin.mockClear(); handleFormTriggerWithin.mockClear() })

describe('ShellMessage interactive content delegation', () => {
    test('click and submit pass live index getters to the extracted handlers', () => {
        target = document.createElement('div')
        document.body.appendChild(target)
        app = mount(ShellMessage, { target, props })
        flushSync()
        target.querySelector('[risu-trigger]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        target.querySelector('form')?.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
        expect(handleButtonTriggerWithin).toHaveBeenCalled()
        expect(handleFormTriggerWithin).toHaveBeenCalled()
        const buttonGetter = handleButtonTriggerWithin.mock.calls.at(-1)?.[1] as () => number
        const formGetter = handleFormTriggerWithin.mock.calls.at(-1)?.[1] as () => number
        props.idx = 2
        flushSync()
        expect(buttonGetter()).toBe(2)
        expect(formGetter()).toBe(2)
    })
})
