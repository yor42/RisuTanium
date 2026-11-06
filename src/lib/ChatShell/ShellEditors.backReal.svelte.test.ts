// @vitest-environment jsdom
/**
 * Guards for the new shell's message editor, translation editor and Delete, driven through the real Back stack and the real
 * prompts. No pre-fix base exists for these (the surfaces are new); each case names the behaviour a mutant must break.
 *
 * REAL: `ShellMessage.svelte`, `MessageEditor.svelte`, `TranslationEditor.svelte`, `ActionSheet.svelte`, `ShellSheet.svelte`,
 * `messageEditorController.svelte.ts`, `draftContentOrphanGate.ts`, `localDrafts.ts`, `backHandlers.ts` (`dispatchBack`),
 * `alertBack.ts`, `alertPrompts.ts` (the `alertStore` prompt queue), `alert.ts` (its `alertConfirm`/`alertSelect` are wrapped
 * only to record calls) and `messageActions.svelte.ts` (`requestRemove`, `deleteNow`).
 * MOCKED: the stores module (a plain `alertStore` plus the database), the parser, the translation cache, the chat origin
 * registry and the supa repoint, which this file does not exercise.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, tick, unmount } from 'svelte'
import { get } from 'svelte/store'
import type { Message } from '../../ts/storage/database.svelte'

const translation = vi.hoisted(() => ({ cached: 'cached translation' }))

vi.mock('../../ts/stores.svelte', async () => {
    const { writable: store } = await import('svelte/store')
    const DBState = $state({ db: {
        translator: '', translatorType: '', translateBeforeHTMLFormatting: true, askRemoval: false, instantRemove: false, language: '',
        characters: [{ chaId: 'c', type: 'character', chatPage: 0, chats: [{ id: 'room', message: [] as Message[] }] }],
    } })
    const selIdState = $state({ selId: 0 })
    return {
        DBState, selIdState, HideIconStore: store(false), alertStore: store({ type: 'none', msg: '' }),
        CurrentTriggerIdStore: store(null), ReloadChatPointer: store({}),
    }
})
vi.mock('../../ts/storage/database.svelte', () => ({ getCurrentCharacter: () => null, getDatabase: () => ({}), getCurrentChat: () => null }))
vi.mock('../../ts/alert', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../ts/alert')>()
    return {
        ...actual,
        alertConfirm: vi.fn(actual.alertConfirm),
        alertSelect: vi.fn(actual.alertSelect),
        alertError: vi.fn(),
        alertNormal: vi.fn(),
        alertRequestData: vi.fn(),
    }
})
vi.mock('../ChatScreens/chatSurface.svelte', () => {
    const chatSurface = $state({ hidden: false, rebuildEpoch: 0, closeEpoch: 0 })
    return { chatSurface, isChatSurfaceInstalled: () => false }
})
vi.mock('../../ts/translator/translator', () => ({
    getLLMCache: async () => translation.cached, setLLMCache: async () => {},
}))
vi.mock('../../ts/process/memory/measureFlag', () => ({ MEASURE: false }))
vi.mock('../../ts/process/chatPhaseRing', () => ({ noteEditConfirm: vi.fn() }))
vi.mock('../../ts/process/chatOrigin', () => ({
    beginWork: () => null, originStatus: () => 'live', writeAt: vi.fn(), originOf: () => null, isWriting: () => false,
}))
vi.mock('../../ts/process/memory/supaResume', () => ({ withSupaRepoint: (_chat: object, run: () => void) => run() }))
vi.mock('../../ts/process/chatTree', () => ({ siblingsAt: vi.fn(() => []) }))
vi.mock('../../ts/storage/characterSaveMarks', () => ({ markCharacterForSave: vi.fn() }))
vi.mock('../../ts/process/index.svelte', async () => {
    const { writable: store } = await import('svelte/store')
    return { doingChat: store(false) }
})
vi.mock('../../ts/process/composerActions.svelte', () => ({ stepSibling: vi.fn(), regenerateNewest: vi.fn(), isComposerBusy: () => false }))
vi.mock('../../ts/chatShell/stopDelete.svelte', () => ({ requestStopDelete: vi.fn(() => true), isStopDeletePending: () => false }))
vi.mock('../../ts/chatShell/haptics', () => ({ tickHaptic: vi.fn(), readHaptics: () => true }))
vi.mock('../../ts/globalApi.svelte', () => ({ aiLawApplies: () => false, getFileSrc: vi.fn(), changeChatTo: vi.fn(), foldChatToMessage: vi.fn() }))
vi.mock('../../ts/parser/parser.svelte', () => ({ ParseMarkdown: async (text: string) => text }))
vi.mock('../../ts/parser/chatML', () => ({}))
vi.mock('../../ts/process/moduleRefList', () => ({ hasModuleStubs: () => false }))
vi.mock('../../ts/process/moduleEnsure', () => ({ ensureCurrentModulesOrAlert: async () => true, ensureModulesOrAlert: async () => true }))
vi.mock('../../ts/process/ttsModes', () => ({ isTTSVoiceMode: () => false }))
vi.mock('../../ts/process/tts', () => ({ stopTTS: vi.fn(), sayTTS: vi.fn() }))
vi.mock('../../ts/process/ttsSpeechText', () => ({ speakerSpeechText: vi.fn() }))
vi.mock('../../ts/process/scripts', () => ({ risuChatParser: (text: string) => text }))
vi.mock('../../ts/process/displayParseOptions', () => ({ buildDisplayParseOptions: () => ({}) }))
vi.mock('../../ts/process/scriptings', () => ({ runLuaButtonTrigger: vi.fn(), runLuaInteractionTrigger: vi.fn() }))
vi.mock('../../ts/process/triggers', () => ({ runTrigger: vi.fn() }))
vi.mock('../../ts/util', () => ({ capitalize: (value: string) => value, getUserIcon: () => '', getUserName: () => 'User', sleep: async () => {} }))
vi.mock('../../ts/chatCopy', () => ({ copyPlainText: vi.fn(), stripThoughtsForCopy: (text: string) => text }))
vi.mock('../../ts/chatCard', () => ({ captureCardTheme: vi.fn(), noteNewerPlainCopy: vi.fn(), startCardCopy: vi.fn(), CARD_DEADLINE_MS: 3000, CARD_PENDING_MARGIN_MS: 2000 }))
vi.mock('../../ts/caughtErrors', () => ({ recordCaughtError: vi.fn() }))
vi.mock('../../ts/characters', () => ({ getCharImage: async () => null }))
vi.mock('../../ts/model/modellist', () => ({ getModelInfo: () => ({ shortName: 'model' }) }))
vi.mock('../ChatScreens/PartialEditController.svelte', () => ({ default: () => ({}) }))
vi.mock('../ChatScreens/ChatBody.svelte', () => ({ default: () => ({}) }))
vi.mock('./StreamingView.svelte', () => ({ default: () => ({}) }))

import ShellMessage, { type ActionRequest } from './ShellMessage.svelte'
import ActionSheet from './ActionSheet.svelte'
import { DBState } from '../../ts/stores.svelte'
import { alertStore } from '../../ts/stores.svelte'
import { alertConfirm, alertSelect } from '../../ts/alert'
import { dispatchBack, resetBackHandlersForTests } from '../../ts/backHandlers'
import { answerShownPrompt, pageCovered, resetAlertPromptsForTests } from '../../ts/alertPrompts'
import { draftContentOrphanGate } from '../../ts/draftContentOrphanGate'
import { hasMessageEditorDrafts, resetLocalDraftsForTest } from '../../ts/localDrafts'
import { chatSurface } from '../ChatScreens/chatSurface.svelte'
import { language } from '../../lang'

//#region fixtures

let target: HTMLElement
let app: ReturnType<typeof ShellMessage> | undefined
let sheetApp: ReturnType<typeof ActionSheet> | undefined
let hostedRequest: ActionRequest | null = $state.raw(null)
let hostedOpen = $state(false)

function messages(): Message[] { return DBState.db.characters[0].chats[0].message }
function texts(): string[] { return messages().map((message) => message.data) }

function resetMessages(): void {
    const list = messages()
    list.splice(0, list.length,
        { role: 'user', data: 'Hi', chatId: 'u' },
        { role: 'char', data: 'Reply', chatId: 'm' },
        { role: 'user', data: 'More', chatId: 'n' })
}

/** Mounts the row at `idx` and, next to it, the one sheet the hosting shell would keep outside the transcript. */
function show(idx: number): void {
    target = document.createElement('div')
    document.body.appendChild(target)
    const message = messages()[idx]
    app = mount(ShellMessage, { target, props: { idx, chatId: message.chatId, name: 'Ari', message, onOpenActions: (request: ActionRequest) => { hostedRequest = request; hostedOpen = true } } })
    sheetApp = mount(ActionSheet, { target, props: {
        get open() { return hostedOpen },
        get opener() { return hostedRequest?.opener ?? null },
        get available() { return hostedOpen ? hostedRequest?.available() ?? [] : [] },
        get disabled() { return hostedOpen ? hostedRequest?.disabled() ?? [] : [] },
        get generating() { return hostedOpen && hostedRequest?.generating() === true },
        onaction: (id) => hostedRequest?.run(id),
        onclose: () => { hostedOpen = false },
    } })
    flushSync()
}

async function settle(): Promise<void> {
    flushSync()
    await tick()
    flushSync()
}

async function until(condition: () => boolean, what: string): Promise<void> {
    await vi.waitFor(() => {
        flushSync()
        if (!condition()) throw new Error(`waiting for: ${what}`)
    }, { timeout: 15000, interval: 10 })
}

async function chooseSheetAction(id: string): Promise<void> {
    target.querySelector<HTMLButtonElement>(`[aria-label="${language.chatShellMoreActions}"]`)!.click()
    flushSync()
    await tick()
    target.querySelector<HTMLButtonElement>(`[role="menuitem"][data-action="${id}"]`)!.click()
    await settle()
}

function messageEditor(): HTMLElement | null { return target.querySelector('[data-part="chat-message-editor"]') }
function translationEditor(): HTMLElement | null { return target.querySelector('[data-part="chat-message-translation-editor"]') }
function editorField(root: HTMLElement): HTMLTextAreaElement { return root.querySelector('textarea')! }
function typeInto(field: HTMLTextAreaElement, value: string): void {
    field.value = value
    field.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
}
function shownPrompt(): { type: string, msg: string } { return get(alertStore) }

async function openMessageEditor(): Promise<HTMLTextAreaElement> {
    await chooseSheetAction('edit')
    await until(() => messageEditor() !== null, 'the message editor')
    return editorField(messageEditor()!)
}

async function openTranslationEditor(): Promise<HTMLTextAreaElement> {
    DBState.db.translator = 'llm'
    DBState.db.translatorType = 'llm'
    await settle()
    target.querySelector<HTMLButtonElement>('[data-part="chat-message-translate"]')!.click()
    await settle()
    target.querySelector<HTMLButtonElement>('[data-part="chat-message-translation-edit"]')!.click()
    await until(() => translationEditor() !== null, 'the translation editor')
    return editorField(translationEditor()!)
}

//#endregion

beforeEach(() => {
    resetMessages()
    DBState.db.translator = ''
    DBState.db.translatorType = 'none'
    DBState.db.askRemoval = false
    DBState.db.instantRemove = false
    translation.cached = 'cached translation'
    resetLocalDraftsForTest()
    draftContentOrphanGate.clear()
    vi.mocked(alertConfirm).mockClear()
    vi.mocked(alertSelect).mockClear()
})

afterEach(async () => {
    if (sheetApp) await unmount(sheetApp)
    sheetApp = undefined
    hostedOpen = false
    hostedRequest = null
    if (app) await unmount(app)
    app = undefined
    target?.remove()
    resetBackHandlersForTests()
    resetAlertPromptsForTests()
    alertStore.set({ type: 'none', msg: '' })
    chatSurface.closeEpoch = 0
})

describe('guard: the message editor under the real Back stack', () => {
    test('guard: Back on an unchanged editor closes it without asking anything', async () => {
        show(1)
        await openMessageEditor()
        expect(hasMessageEditorDrafts()).toBe(true)
        expect(dispatchBack()).toBe(true)
        await settle()
        expect(messageEditor()).toBeNull()
        expect(alertConfirm).not.toHaveBeenCalled()
        expect(pageCovered()).toBe(false)
        expect(hasMessageEditorDrafts()).toBe(false)
        expect(texts()[1]).toBe('Reply')
    })

    test('guard: Back on changed text shows the existing discard confirm; a second Back answers no and the editor keeps its text', async () => {
        show(1)
        const field = await openMessageEditor()
        typeInto(field, 'Reply, edited')

        expect(dispatchBack()).toBe(true)
        await until(() => pageCovered(), 'the discard confirm')
        expect(alertConfirm).toHaveBeenCalledWith(language.messageEditDiscardConfirm)
        expect(shownPrompt()).toMatchObject({ type: 'ask', msg: language.messageEditDiscardConfirm })
        expect(messageEditor()).not.toBeNull()

        // The covered press is consumed by the prompt: it is answered no, and no shell handler runs.
        expect(dispatchBack()).toBe(true)
        await until(() => !pageCovered(), 'the prompt to close')
        await settle()
        expect(messageEditor()).not.toBeNull()
        expect(editorField(messageEditor()!).value).toBe('Reply, edited')
        expect(texts()[1]).toBe('Reply')
        expect(draftContentOrphanGate.size()).toBe(1)
        expect(hasMessageEditorDrafts()).toBe(true)
    })

    test('guard: answering the discard confirm yes through the prompt closes the editor and the saved text stays as it was', async () => {
        show(1)
        const field = await openMessageEditor()
        typeInto(field, 'Reply, edited')
        expect(dispatchBack()).toBe(true)
        await until(() => shownPrompt().type === 'ask', 'the discard confirm')
        expect(answerShownPrompt('yes')).toBe(true)
        await until(() => messageEditor() === null, 'the editor to close')
        expect(texts()[1]).toBe('Reply')
        expect(hasMessageEditorDrafts()).toBe(false)
    })

    test('guard: a held alert on top keeps the editor open and consumes the press', async () => {
        show(1)
        const field = await openMessageEditor()
        typeInto(field, 'Reply, edited')
        void alertSelect(['a', 'b'])
        await until(() => shownPrompt().type === 'select', 'a select prompt')
        expect(dispatchBack()).toBe(true)
        await settle()
        expect(shownPrompt().type).toBe('select')
        expect(messageEditor()).not.toBeNull()
        expect(alertConfirm).not.toHaveBeenCalled()
    })

    test('guard: a toast does not cover the page, so Back still closes the editor and the toast stays', async () => {
        show(1)
        await openMessageEditor()
        alertStore.set({ type: 'toast', msg: 'Copied' })
        expect(pageCovered()).toBe(false)
        expect(dispatchBack()).toBe(true)
        await settle()
        expect(messageEditor()).toBeNull()
        expect(shownPrompt()).toMatchObject({ type: 'toast', msg: 'Copied' })
    })
})

describe('guard: the translation editor under the real Back stack', () => {
    test('guard: Back closes without asking, keeps the typed text in the draft record, and reopening restores it', async () => {
        show(1)
        const field = await openTranslationEditor()
        expect(field.value).toBe('cached translation')
        typeInto(field, 'typed translation')

        expect(dispatchBack()).toBe(true)
        await settle()
        expect(translationEditor()).toBeNull()
        expect(alertConfirm).not.toHaveBeenCalled()
        expect(pageCovered()).toBe(false)
        expect(hasMessageEditorDrafts()).toBe(false)
        expect(draftContentOrphanGate.get({ kind: 'tr', key: 'Reply' }, 'Reply')?.text).toBe('typed translation')

        target.querySelector<HTMLButtonElement>('[data-part="chat-message-translation-edit"]')!.click()
        await until(() => translationEditor() !== null, 'the translation editor again')
        expect(editorField(translationEditor()!).value).toBe('typed translation')
        expect(translationEditor()!.querySelector('[data-part="chat-message-draft-restored"]')).not.toBeNull()
    })

    test('guard: a held alert on top keeps the translation editor open', async () => {
        show(1)
        await openTranslationEditor()
        void alertSelect(['a', 'b'])
        await until(() => shownPrompt().type === 'select', 'a select prompt')
        expect(dispatchBack()).toBe(true)
        await settle()
        expect(translationEditor()).not.toBeNull()
        expect(shownPrompt().type).toBe('select')
    })
})

describe('guard: the new shell Delete asks the same questions as the old shell and acts on the answers', () => {
    async function requestDelete(): Promise<void> {
        await chooseSheetAction('delete')
    }

    test('guard: with both settings off nothing is asked and the message is deleted', async () => {
        show(1)
        await requestDelete()
        await until(() => texts().length === 2, 'the message to be deleted')
        expect(texts()).toEqual(['Hi', 'More'])
        expect(alertConfirm).not.toHaveBeenCalled()
        expect(alertSelect).not.toHaveBeenCalled()
    })

    test('guard: askRemoval asks language.removeChat; no keeps every message, yes deletes only that one', async () => {
        DBState.db.askRemoval = true
        show(1)
        await requestDelete()
        await until(() => shownPrompt().type === 'ask', 'the removal confirm')
        expect(alertConfirm).toHaveBeenCalledWith(language.removeChat)
        expect(alertSelect).not.toHaveBeenCalled()
        expect(shownPrompt().msg).toBe(language.removeChat)
        expect(answerShownPrompt('no')).toBe(true)
        await settle()
        expect(texts()).toEqual(['Hi', 'Reply', 'More'])

        await requestDelete()
        await until(() => shownPrompt().type === 'ask', 'the removal confirm again')
        expect(answerShownPrompt('yes')).toBe(true)
        await until(() => texts().length === 2, 'the message to be deleted')
        expect(texts()).toEqual(['Hi', 'More'])
    })

    test('guard: instantRemove asks the three-way select; cancel keeps all, the first answer deletes one, the last deletes it and everything after', async () => {
        DBState.db.instantRemove = true
        show(1)
        await requestDelete()
        await until(() => shownPrompt().type === 'select', 'the three-way select')
        expect(alertConfirm).not.toHaveBeenCalled()
        expect(alertSelect).toHaveBeenCalledWith(
            [language.removeOnlyThisMessage, language.cancel, language.removeThisAndFollowingMessages],
            language.removeMessageQuestion)
        expect(answerShownPrompt('1')).toBe(true)
        await settle()
        expect(texts()).toEqual(['Hi', 'Reply', 'More'])

        await requestDelete()
        await until(() => shownPrompt().type === 'select', 'the select again')
        expect(answerShownPrompt('2')).toBe(true)
        await until(() => texts().length === 1, 'the range to be deleted')
        expect(texts()).toEqual(['Hi'])
    })

    test('guard: instantRemove with the first answer deletes only the one message', async () => {
        DBState.db.instantRemove = true
        show(1)
        await requestDelete()
        await until(() => shownPrompt().type === 'select', 'the three-way select')
        expect(answerShownPrompt('0')).toBe(true)
        await until(() => texts().length === 2, 'the message to be deleted')
        expect(texts()).toEqual(['Hi', 'More'])
    })

    test('guard: both settings on ask the confirm first, then the select', async () => {
        DBState.db.askRemoval = true
        DBState.db.instantRemove = true
        show(1)
        await requestDelete()
        await until(() => shownPrompt().type === 'ask', 'the removal confirm')
        expect(alertSelect).not.toHaveBeenCalled()
        expect(answerShownPrompt('yes')).toBe(true)
        await until(() => shownPrompt().type === 'select', 'the select after the confirm')
        expect(answerShownPrompt('0')).toBe(true)
        await until(() => texts().length === 2, 'the message to be deleted')
    })
})
