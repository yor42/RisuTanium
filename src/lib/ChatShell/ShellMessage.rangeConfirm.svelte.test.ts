// @vitest-environment jsdom
/**
 * The range-delete confirm goes through the real `alertSelect` and the real prompt queue (`alertPrompts.ts`). `alertSelect` joins its
 * display text and its buttons with "||" and the dialog splits on it again, so a "||" in the message excerpt would add buttons and
 * shift the answer indexes: the Cancel button would then answer as "Delete". The dialog's split is repeated here from AlertComp.
 * REAL: ShellMessage, ActionSheet, messageActions (deleteNow), alert.ts, alertPrompts.ts. MOCKED: the stores, parser and origin registry.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, tick, unmount } from 'svelte'
import { get } from 'svelte/store'
import type { Message } from '../../ts/storage/database.svelte'

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
vi.mock('../ChatScreens/chatSurface.svelte', () => {
    const chatSurface = $state({ hidden: false, rebuildEpoch: 0, closeEpoch: 0 })
    return { chatSurface, isChatSurfaceInstalled: () => false }
})
vi.mock('../../ts/translator/translator', () => ({ getLLMCache: async () => null, setLLMCache: async () => {} }))
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
import { DBState, alertStore } from '../../ts/stores.svelte'
import { answerShownPrompt, resetAlertPromptsForTests } from '../../ts/alertPrompts'
import { resetBackHandlersForTests } from '../../ts/backHandlers'
import { language } from '../../lang'

let target: HTMLElement
let app: ReturnType<typeof ShellMessage> | undefined
let sheetApp: ReturnType<typeof ActionSheet> | undefined
let hostedRequest: ActionRequest | null = $state.raw(null)
let hostedOpen = $state(false)

function messages(): Message[] { return DBState.db.characters[0].chats[0].message }
function texts(): string[] { return messages().map((message) => message.data) }
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
async function chooseDeleteFromHere(): Promise<void> {
    target.querySelector<HTMLButtonElement>(`[aria-label="${language.chatShellMoreActions}"]`)!.click()
    flushSync()
    await tick()
    target.querySelector<HTMLButtonElement>('[role="menuitem"][data-action="deleteAfter"]')!.click()
    flushSync()
    await tick()
}
async function shownSelect(): Promise<{ display: string, buttons: string[] }> {
    await vi.waitFor(() => { if (get(alertStore).type !== 'select') throw new Error('waiting for the range confirm') }, { timeout: 5000, interval: 10 })
    // The dialog splits the message exactly like AlertComp does for a display select.
    const parts = get(alertStore).msg.substring('__DISPLAY__'.length).split('||')
    return { display: parts[0], buttons: parts.slice(1) }
}

beforeEach(() => {
    messages().splice(0, messages().length)
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
})

describe('the range-delete confirm survives message text that looks like the dialog separator', () => {
    for (const data of ['a || b', 'before ||spoiler|| after', '||||', 'pipe | alone']) {
        test(`${JSON.stringify(data)}: the dialog still has exactly Cancel and Delete, and Cancel deletes nothing`, async () => {
            messages().push({ role: 'user', data, chatId: 'u' }, { role: 'char', data: 'Reply', chatId: 'm' }, { role: 'user', data: 'More', chatId: 'n' })
            show(0)
            await chooseDeleteFromHere()
            const dialog = await shownSelect()
            expect(dialog.buttons).toEqual([language.cancel, language.chatShellDeleteRangeButton(3)])
            expect(dialog.display).not.toContain('|')
            expect(answerShownPrompt(String(dialog.buttons.indexOf(language.cancel)))).toBe(true)
            await tick()
            flushSync()
            expect(texts()).toEqual([data, 'Reply', 'More'])
        })
    }
    test('only the Delete answer deletes the range', async () => {
        messages().push({ role: 'user', data: 'a || b', chatId: 'u' }, { role: 'char', data: 'Reply', chatId: 'm' })
        show(0)
        await chooseDeleteFromHere()
        const dialog = await shownSelect()
        expect(answerShownPrompt(String(dialog.buttons.indexOf(language.chatShellDeleteRangeButton(2))))).toBe(true)
        await vi.waitFor(() => { flushSync(); expect(texts()).toEqual([]) }, { timeout: 5000 })
    })
})
