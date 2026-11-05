// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, tick, unmount } from 'svelte'
import type { Message } from '../../ts/storage/database.svelte'

const back = vi.hoisted(() => ({
    options: null as null | { isOpen: () => boolean; snapshot: () => string | number | boolean; close: () => void },
    unregister: vi.fn(),
}))
const controller = vi.hoisted(() => ({
    editMode: false, editTranslationMode: false, discardConfirmOpen: false, translationViewControlsDisabled: false,
    translationEditControlDisabled: false, originalEditControlDisabled: false, dispose: () => {},
    requestDiscardOriginalEdit: vi.fn(async () => {}), closeTranslationKeep: vi.fn(),
}))
const trigger = vi.hoisted(() => ({
    ensureModulesOrAlert: vi.fn(async () => false),
    alertError: vi.fn(),
    runTrigger: vi.fn(async () => true),
    end: vi.fn(),
    update: vi.fn(),
}))
vi.mock('../../ts/backHandlers', () => ({
    backCloseHandler: (options: typeof back.options) => { back.options = options; return () => false },
    registerBackHandler: () => back.unregister,
}))
vi.mock('../../ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    const DBState = $state({ db: { translator: '', characters: [{ chaId: 'c', chatPage: 0, chats: [{ id: 'room', message: [] as Message[] }] }] } })
    const selIdState = $state({ selId: 0 })
    return {
        DBState, selIdState, HideIconStore: writable(false), CurrentTriggerIdStore: writable(null),
        ReloadChatPointer: { update: trigger.update, subscribe: writable({}).subscribe },
    }
})
vi.mock('../../ts/globalApi.svelte', () => ({ aiLawApplies: () => false, getFileSrc: vi.fn() }))
vi.mock('../../ts/storage/database.svelte', () => ({
    getCurrentCharacter: () => ({ type: 'character', chaId: 'c' }), getCurrentChat: () => ({ id: 'room', message: [] }),
}))
vi.mock('../../ts/parser/parser.svelte', () => ({ ParseMarkdown: async (text: string) => text }))
vi.mock('../../ts/parser/chatML', () => ({}))
vi.mock('../../ts/process/moduleRefList', () => ({ hasModuleStubs: () => true }))
vi.mock('../../ts/process/moduleEnsure', () => ({
    ensureCurrentModulesOrAlert: async () => true, ensureModulesOrAlert: trigger.ensureModulesOrAlert,
}))
vi.mock('../../ts/translator/translator', () => ({ getLLMCache: async () => null }))
vi.mock('../../ts/process/ttsModes', () => ({ isTTSVoiceMode: () => false }))
vi.mock('../../ts/process/tts', () => ({ stopTTS: vi.fn(), sayTTS: vi.fn() }))
vi.mock('../../ts/process/ttsSpeechText', () => ({ speakerSpeechText: vi.fn() }))
vi.mock('../../ts/process/scripts', () => ({ risuChatParser: (text: string) => text }))
vi.mock('../../ts/process/displayParseOptions', () => ({ buildDisplayParseOptions: () => ({}) }))
vi.mock('../../ts/caughtErrors', () => ({ recordCaughtError: vi.fn() }))
vi.mock('../../ts/alert', () => ({ alertError: trigger.alertError, alertRequestData: vi.fn(), alertConfirm: vi.fn(), alertSelect: vi.fn(), alertInput: vi.fn() }))
vi.mock('../../ts/process/scriptings', () => ({ runLuaButtonTrigger: vi.fn(), runLuaInteractionTrigger: vi.fn() }))
vi.mock('../../ts/process/triggers', () => ({ runTrigger: trigger.runTrigger }))
vi.mock('../../ts/process/chatOrigin', () => ({
    beginWork: () => ({ origin: {}, end: trigger.end }), originStatus: () => 'live', writeAt: vi.fn(),
    originOf: () => null, isWriting: () => false,
}))
vi.mock('../../ts/process/memory/supaResume', () => ({ withSupaRepoint: vi.fn() }))
vi.mock('../../ts/process/chatTree', () => ({ siblingsAt: vi.fn(() => []) }))
vi.mock('../../ts/storage/characterSaveMarks', () => ({ markCharacterForSave: vi.fn() }))
vi.mock('../../ts/util', () => ({ capitalize: (value: string) => value, getUserIcon: () => '', getUserName: () => 'User', sleep: async () => {} }))
vi.mock('../../ts/chatCopy', () => ({ copyPlainText: vi.fn(), stripThoughtsForCopy: (text: string) => text }))
vi.mock('../../ts/chatCard', () => ({ captureCardTheme: vi.fn(), noteNewerPlainCopy: vi.fn(), startCardCopy: vi.fn() }))
vi.mock('../../ts/process/messageActions.svelte', async () => {
    const actual = await vi.importActual<typeof import('../../ts/process/messageActions.svelte')>('../../ts/process/messageActions.svelte')
    return { ...actual, handleFormTriggerWithin: vi.fn() }
})
vi.mock('../../ts/process/messageEditorController.svelte', () => ({ createMessageEditorController: () => controller }))
vi.mock('../ChatScreens/PartialEditController.svelte', () => ({ default: () => ({}) }))
vi.mock('./MessageEditor.svelte', () => ({ default: () => ({}) }))
vi.mock('./TranslationEditor.svelte', () => ({ default: () => ({}) }))
vi.mock('../ChatScreens/ChatBody.svelte', () => ({ default: (anchor: Comment) => {
    const button = document.createElement('button')
    button.setAttribute('risu-trigger', 'go')
    button.textContent = 'Run'
    anchor.before(button)
    return {}
} }))
vi.mock('./StreamingView.svelte', () => ({ default: () => ({}) }))
vi.mock('../ChatScreens/chatSurface.svelte', () => {
    const chatSurface = $state({ rebuildEpoch: 0, closeEpoch: 0 })
    return { chatSurface, isChatSurfaceInstalled: () => false }
})
vi.mock('../../ts/characters', () => ({ getCharImage: async () => null }))
vi.mock('../../ts/model/modellist', () => ({ getModelInfo: () => ({ shortName: 'Model' }) }))
vi.mock('../../lang', () => ({ language: { chatShellMoreActions: 'More actions', bookmark: 'Bookmark' } }))

import ShellMessage from './ShellMessage.svelte'

let app: ReturnType<typeof ShellMessage> | undefined
let target: HTMLElement
const message: Message = { role: 'char', data: 'Reply', chatId: 'm' }
async function show() {
    target = document.createElement('div')
    document.body.appendChild(target)
    app = mount(ShellMessage, { target, props: { idx: 0, chatId: 'm', name: 'Ari', message } })
    flushSync()
    await tick()
}
afterEach(async () => {
    if (app) await unmount(app)
    app = undefined
    target?.remove()
    controller.editMode = false
    controller.editTranslationMode = false
    back.options = null
    back.unregister.mockClear()
    controller.requestDiscardOriginalEdit.mockClear()
    controller.closeTranslationKeep.mockClear()
    trigger.alertError.mockClear()
    trigger.runTrigger.mockClear()
    trigger.end.mockClear()
    trigger.update.mockClear()
    trigger.ensureModulesOrAlert.mockClear()
})

describe('editor Back handling', () => {
    test('Back is claimed only while an editor is open and runs the editor own close flow', async () => {
        await show()
        const options = back.options!
        expect(options.isOpen()).toBe(false)
        controller.editMode = true
        expect(options.isOpen()).toBe(true)
        options.close()
        expect(controller.requestDiscardOriginalEdit).toHaveBeenCalledTimes(1)
        expect(controller.closeTranslationKeep).not.toHaveBeenCalled()
        controller.editMode = false
        controller.editTranslationMode = true
        expect(options.isOpen()).toBe(true)
        options.close()
        expect(controller.closeTranslationKeep).toHaveBeenCalledTimes(1)
        expect(controller.requestDiscardOriginalEdit).toHaveBeenCalledTimes(1)
    })
    test('the handler is unregistered when the row is destroyed', async () => {
        await show()
        expect(back.unregister).not.toHaveBeenCalled()
        await unmount(app!)
        app = undefined
        expect(back.unregister).toHaveBeenCalledTimes(1)
    })
})

describe('trigger module-ensure failure', () => {
    test('a failed module load alerts through the existing path and the trigger does not run', async () => {
        trigger.ensureModulesOrAlert.mockImplementationOnce(async () => { trigger.alertError('modules failed'); return false })
        await show()
        target.querySelector<HTMLElement>('[risu-trigger]')!.click()
        await vi.waitFor(() => expect(trigger.end).toHaveBeenCalledTimes(1), { timeout: 5000 })
        expect(trigger.ensureModulesOrAlert).toHaveBeenCalledTimes(1)
        expect(trigger.alertError).toHaveBeenCalledWith('modules failed')
        expect(trigger.runTrigger).not.toHaveBeenCalled()
        expect(trigger.update).not.toHaveBeenCalled()
    })
})
