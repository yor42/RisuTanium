// @vitest-environment jsdom
/**
 * Guards for a chat surface that Settings hides (T31) and for an editor left open when Settings opens (T21). Neither has a
 * failing pre-fix base: the new shell is new code.
 *
 * T31: while `chatSurface.hidden` is true the shell takes no focus, opens no sheet, reads no layout, scrolls nothing and
 * leaves a pending `ScrollToMessageStore` jump alone; on unhide it catches up. (The shell keeps no per-row height table:
 * "no height recorded" is asserted as no layout read through `getBoundingClientRect` while hidden, and the reads resume
 * after the unhide.)
 *
 * T21: an editor open in the old shell closes when Settings opens (`closeEpoch`), so the flip is allowed, and the typed
 * text is offered again on the next open in the new shell.
 *
 * REAL: `ChatShell.svelte`, `ShellMessageList.svelte`, `ShellMessage.svelte`, `ActionSheet.svelte`, `Chat.svelte`,
 * `ChatShellPreviewToggle.svelte`, `flipBlocker.ts`, `shellSwitch.svelte.ts`, `messageEditorController.svelte.ts`,
 * `draftContentOrphanGate.ts`, `localDrafts.ts`, `messageActions.svelte.ts`. MOCKED: the surface state object (a plain
 * rune object the test drives the way Settings does), the stores and database, the header and the composer.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const captured = vi.hoisted(() => ({
    persona: null as null | { open: boolean },
    thisChat: null as null | { open: boolean },
    alertNormal: [] as string[],
}))

//#region module mocks

vi.mock('../../ts/stores.svelte', async () => {
    const { writable: store } = await import('svelte/store')
    const DBState = $state({ db: {} as Record<string, unknown> })
    const selIdState = $state({ selId: 0 })
    const ScrollToMessageStore = $state({ value: -1 })
    return {
        DBState, selIdState, ScrollToMessageStore,
        selectedCharID: store(0), ReloadGUIPointer: store(0), ReloadChatPointer: store({} as Record<number, number>),
        CurrentTriggerIdStore: store(null), popupStore: { children: null, mouseX: 0, mouseY: 0, openId: 0 },
        HideIconStore: store(false), createSimpleCharacter: () => null, bookmarkListOpen: store(false),
    }
})
vi.mock('../../ts/globalApi.svelte', () => {
    const chatFoldedState = $state<{ data: null }>({ data: null })
    const chatFoldedStateMessageIndex = $state({ index: -1 })
    return {
        chatFoldedState, chatFoldedStateMessageIndex, aiLawApplies: () => false, changeChatTo: vi.fn(), foldChatToMessage: vi.fn(),
        getFileSrc: vi.fn(async () => ''), createChatCopyName: vi.fn((name: string) => `${name} Branch`), downloadFile: vi.fn(),
        fetchNative: vi.fn(), readImage: vi.fn(),
    }
})
vi.mock('../../ts/storage/database.svelte', () => ({
    getCurrentCharacter: vi.fn(() => null), getCurrentChat: vi.fn(() => null), setCurrentChat: vi.fn(), setDatabase: vi.fn(),
    getDatabase: vi.fn(() => { throw new Error('no live database in tests') }),
}))
vi.mock('../../ts/alert', () => ({
    alertClear: vi.fn(), alertConfirm: vi.fn(async () => true), alertError: vi.fn(), alertWait: vi.fn(),
    alertNormal: (text: string) => { captured.alertNormal.push(text) },
    alertInput: vi.fn(async () => ''), alertRequestData: vi.fn(), alertSelect: vi.fn(async () => '1'),
}))
vi.mock('../../ts/parser/parser.svelte', () => ({ ParseMarkdown: vi.fn(async (text: string) => text), hasher: (value: string) => value, risuChatParser: (value: string) => value, assetRegex: /{{asset:[^}]+}}/g }))
vi.mock('../../ts/parser/chatML', () => ({ parseChatML: () => [] }))
vi.mock('../../ts/translator/translator', () => ({ getLLMCache: vi.fn(async () => null), setLLMCache: vi.fn(async () => {}) }))
vi.mock('../../ts/process/scriptings', () => ({ runLuaButtonTrigger: vi.fn(async () => null), runLuaInteractionTrigger: vi.fn() }))
vi.mock('../../ts/process/scripts', () => ({ risuChatParser: (text: string) => text ?? '' }))
vi.mock('../../ts/process/triggers', () => ({ runTrigger: vi.fn(async () => null) }))
vi.mock('../../ts/process/tts', () => ({ sayTTS: vi.fn(async () => {}), stopTTS: vi.fn() }))
vi.mock('../../ts/gui/colorscheme', () => ({ ColorSchemeTypeStore: writable('dark') }))
vi.mock('../../ts/model/modellist', () => ({ getModelInfo: vi.fn(() => ({ shortName: 'test-model' })) }))
vi.mock('../../ts/util', () => ({
    capitalize: vi.fn((value: string) => value), getUserIcon: vi.fn(() => ''), getUserName: vi.fn(() => 'User'),
    sleep: vi.fn(async () => {}), findCharacterbyId: vi.fn(() => null),
}))
vi.mock('../../ts/characters', () => ({ getCharImage: vi.fn(async () => null) }))
vi.mock('../../ts/process/index.svelte', async () => {
    const { writable: store } = await import('svelte/store')
    return { doingChat: store(false) }
})
vi.mock('../../ts/process/composerActions.svelte', () => ({
    branchAt: vi.fn(), stepSibling: vi.fn(), regenerateNewest: vi.fn(), isComposerBusy: () => false, isAutoModeActive: () => false,
}))
vi.mock('../../ts/chatShell/stopDelete.svelte', () => ({ requestStopDelete: vi.fn(() => true), isStopDeletePending: () => false }))
vi.mock('../../ts/chatShell/haptics', () => ({ tickHaptic: vi.fn(), readHaptics: () => true, writeHaptics: vi.fn(), hapticsSupported: () => true }))
vi.mock('../../ts/process/moduleRefList', () => ({ hasModuleStubs: () => false }))
vi.mock('../../ts/process/moduleEnsure', () => ({ ensureCurrentModulesOrAlert: async () => true, ensureModulesOrAlert: async () => true }))
vi.mock('../../ts/process/ttsModes', () => ({ isTTSVoiceMode: () => false }))
vi.mock('../../ts/process/displayParseOptions', () => ({ buildDisplayParseOptions: () => ({}) }))
vi.mock('../../ts/caughtErrors', () => ({ recordCaughtError: vi.fn() }))
vi.mock('../../ts/process/memory/measureFlag', () => ({ MEASURE: false }))
vi.mock('../../ts/process/chatPhaseRing', () => ({ noteEditConfirm: vi.fn() }))
vi.mock('../ChatScreens/chatSurface.svelte', () => {
    const chatSurface = $state({ hidden: false, rebuildEpoch: 0, closeEpoch: 0, remountEpoch: 0, heldGui: 0, heldChat: {} as Record<number, number> })
    return { chatSurface, isChatSurfaceInstalled: () => true, onSurfaceHiding: () => () => {} }
})
vi.mock('../ChatScreens/ChatBody.svelte', () => ({ default: () => ({}) }))
vi.mock('../ChatScreens/PartialEditController.svelte', () => ({ default: () => ({}) }))
vi.mock('./StreamingView.svelte', () => ({ default: () => ({}) }))
vi.mock('./ShellComposer.svelte', () => ({ default: () => ({}) }))
vi.mock('./PlusSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('./ShellNotices.svelte', () => ({ default: () => ({}) }))
vi.mock('./ShellFloatingButtons.svelte', () => ({ default: () => ({}) }))
vi.mock('./CustomizeButtonsSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('./PersonaSheet.svelte', () => ({ default: (_anchor: Comment, props: { open: boolean }) => { captured.persona = props; return {} } }))
vi.mock('./ThisChatSheet.svelte', () => ({ default: (_anchor: Comment, props: { open: boolean }) => { captured.thisChat = props; return {} } }))
vi.mock('./ShellHeader.svelte', () => ({ default: (anchor: Comment, props: { onthischat: (opener: HTMLElement) => void }) => {
    const button = document.createElement('button')
    button.setAttribute('data-test', 'persona-opener')
    button.addEventListener('click', () => props.onthischat(button))
    anchor.before(button)
    return {}
} }))

//#endregion

import ChatShell from './ChatShell.svelte'
import ShellMessage from './ShellMessage.svelte'
import Chat from '../ChatScreens/Chat.svelte'
import ChatShellPreviewToggle from '../Setting/Pages/Display/ChatShellPreviewToggle.svelte'
import { DBState, ScrollToMessageStore, selIdState } from '../../ts/stores.svelte'
import { chatSurface } from '../ChatScreens/chatSurface.svelte'
import { setShellEnabled, shellSwitch } from '../../ts/chatShell/shellSwitch.svelte'
import { shellFlipBlocker } from '../../ts/chatShell/flipBlocker'
import { draftContentOrphanGate } from '../../ts/draftContentOrphanGate'
import { hasMessageEditorDrafts, resetLocalDraftsForTest } from '../../ts/localDrafts'
import { chatWindowKey } from '../../ts/chatWindowPolicy'
import type { MessageIdentity } from '../../ts/draftContents'
import type { Message } from '../../ts/storage/database.svelte'
import { language } from '../../lang'

//#region fixtures

const BASE_TEXT = 'original text'

function installDb(overrides: Record<string, unknown> = {}): void {
    const chat = {
        id: 'chat-1',
        message: [
            { role: 'char', data: BASE_TEXT, chatId: 'chat-id-1', time: 1 },
            { role: 'user', data: 'second', chatId: 'chat-id-2', time: 2 },
        ] as Message[],
        bookmarks: [] as string[],
        bookmarkNames: {} as Record<string, string>,
    }
    DBState.db = {
        username: 'User', userIcon: '', translator: '', translatorType: 'none', translateBeforeHTMLFormatting: false, legacyTranslation: false,
        swipe: true, autoTranslate: false, askRemoval: false, instantRemove: false, requestInfoInsideChat: false, clickToEdit: false,
        zoomsize: 100, lineHeight: 1.25, enableBlockPartialEdit: false, enableDragPartialEdit: false, useChatCopy: false,
        showFirstMessagePages: false, enableBookmark: true, createFolderOnBranch: false, iconsize: 100, memoryLimitThickness: 2,
        theme: '', guiHTML: '', roundIcons: false,
        autoScrollToNewMessage: false, alwaysScrollToNewMessage: false, chatLoadInitialPages: 5, chatLoadAdditionalPages: 5,
        characters: [{
            chaId: 'char-1', type: 'character', name: 'Ari', image: '', ttsMode: 'none', chatPage: 0, firstMessage: 'Hello', alternateGreetings: [] as string[],
            chats: [chat],
        }],
        ...overrides,
    } as never
    selIdState.selId = 0
}

function liveMessages(): Message[] { return (DBState.db.characters as Array<{ chats: Array<{ message: Message[] }> }>)[0].chats[0].message }

let target: HTMLElement
const mounted: Array<ReturnType<typeof mount>> = []
function mountInto(component: Parameters<typeof mount>[0], props: Record<string, unknown> = {}): HTMLElement {
    target = document.createElement('div')
    document.body.appendChild(target)
    mounted.push(mount(component, { target, props }))
    flushSync()
    return target
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

const scrollIntoView = vi.fn()
const originalScrollIntoView = Element.prototype.scrollIntoView
const rectReads = vi.spyOn(Element.prototype, 'getBoundingClientRect')

beforeEach(() => {
    installDb()
    Element.prototype.scrollIntoView = scrollIntoView
    scrollIntoView.mockClear()
    rectReads.mockClear()
    captured.persona = null
    captured.thisChat = null
    captured.alertNormal.length = 0
    ScrollToMessageStore.value = -1
    chatSurface.hidden = false
    chatSurface.closeEpoch = 0
    chatSurface.rebuildEpoch = 0
    localStorage.clear()
    setShellEnabled(false)
    draftContentOrphanGate.clear()
    resetLocalDraftsForTest()
})

afterEach(async () => {
    for (const instance of mounted.splice(0)) await unmount(instance).catch(() => {})
    document.body.replaceChildren()
    Element.prototype.scrollIntoView = originalScrollIntoView
    chatSurface.hidden = false
})

//#endregion

describe('guard: a hidden chat surface takes no focus, opens no sheet, reads no layout and scrolls nothing', () => {
    async function showShell(): Promise<HTMLElement> {
        const root = mountInto(ChatShell)
        await until(() => root.querySelector('article[data-chat-id="chat-id-2"]') !== null && captured.persona !== null && captured.thisChat !== null, 'the rows and the sheets')
        return root
    }
    const transcript = (root: HTMLElement) => root.querySelector<HTMLElement>('[data-part="chat-transcript"]')!
    const opener = (root: HTMLElement) => root.querySelector<HTMLButtonElement>('[data-test="persona-opener"]')!
    const moreActions = (root: HTMLElement) => root.querySelector<HTMLButtonElement>(`article[data-chat-id="chat-id-2"] [aria-label="${language.chatShellMoreActions}"]`)!

    test('guard: while hidden no sheet opens and focus stays where it was; after the unhide both work', async () => {
        const root = await showShell()
        const focusBefore = document.activeElement
        chatSurface.hidden = true
        await settle()

        opener(root).click()
        moreActions(root).click()
        await settle()
        expect(captured.thisChat!.open).toBe(false)
        expect(root.querySelector('[data-part="chat-sheet"]')).toBeNull()
        expect(document.activeElement).toBe(focusBefore)

        chatSurface.hidden = false
        await settle()
        opener(root).click()
        moreActions(root).click()
        await settle()
        expect(captured.thisChat!.open).toBe(true)
        expect(root.querySelector('[data-part="chat-sheet"]')).not.toBeNull()
    })

    test('guard: while hidden a scroll event reads no layout and a pending jump stays pending; after the unhide the jump runs and layout is read', async () => {
        const root = await showShell()
        chatSurface.hidden = true
        await settle()

        rectReads.mockClear()
        transcript(root).dispatchEvent(new Event('scroll'))
        ScrollToMessageStore.value = 1
        await settle()
        expect(rectReads).not.toHaveBeenCalled()
        expect(ScrollToMessageStore.value).toBe(1)
        expect(scrollIntoView).not.toHaveBeenCalled()

        chatSurface.hidden = false
        await settle()
        await until(() => ScrollToMessageStore.value === -1, 'the pending jump to be consumed')
        await until(() => scrollIntoView.mock.calls.length > 0, 'the jump to scroll')
        transcript(root).dispatchEvent(new Event('scroll'))
        flushSync()
        expect(rectReads).toHaveBeenCalled()
    })

    test('guard: a reply that arrives while hidden does not scroll then, and the shell catches up on the unhide', async () => {
        installDb({ autoScrollToNewMessage: true })
        const root = await showShell()
        scrollIntoView.mockClear()
        chatSurface.hidden = true
        await settle()

        liveMessages().push({ role: 'char', data: 'arrived while hidden', chatId: 'chat-id-3', time: 3 })
        await settle()
        await new Promise<void>((resolve) => setTimeout(resolve, 20))
        expect(scrollIntoView).not.toHaveBeenCalled()

        chatSurface.hidden = false
        await settle()
        await until(() => scrollIntoView.mock.calls.length > 0, 'the catch-up scroll')
        expect(root.querySelector('article[data-chat-id="chat-id-3"]')).not.toBeNull()
    })

    test('guard: a shell mounted while hidden shows its rows after the unhide and then runs the pending jump', async () => {
        chatSurface.hidden = true
        ScrollToMessageStore.value = 0
        const root = mountInto(ChatShell)
        await settle()
        await new Promise<void>((resolve) => setTimeout(resolve, 20))
        expect(ScrollToMessageStore.value).toBe(0)
        expect(scrollIntoView).not.toHaveBeenCalled()
        expect(root.querySelector('[data-part="chat-sheet"]')).toBeNull()

        chatSurface.hidden = false
        await until(() => root.querySelector('article[data-chat-id="chat-id-2"]') !== null, 'the rows after the unhide')
        await until(() => ScrollToMessageStore.value === -1, 'the pending jump to be consumed')
        await until(() => scrollIntoView.mock.calls.length > 0, 'the jump to scroll')
    })
})

describe('guard: an editor left open when Settings opens does not block the flip, and its text is offered in the new shell', () => {
    const identity = (): MessageIdentity => {
        const chat = (DBState.db.characters as Array<{ chaId: string, chats: Array<{ id: string }> }>)[0].chats[0]
        return { kind: 'msg', chatKey: chatWindowKey('char-1', chat as never), chatId: 'chat-id-1', index: 0 }
    }
    const flipCheckbox = (root: HTMLElement) => root.querySelector<HTMLInputElement>('input[type="checkbox"]')!

    test('guard: the old shell editor closes on closeEpoch, the toggle flips, and the new shell offers the typed text', async () => {
        const old = mountInto(Chat, { idx: 0, message: BASE_TEXT, isLastMemory: false })
        old.querySelector<HTMLButtonElement>('.button-icon-edit')!.click()
        flushSync()
        const area = old.querySelector<HTMLTextAreaElement>('.message-edit-area')!
        area.value = 'typed in the editor'
        area.dispatchEvent(new Event('input', { bubbles: true }))
        flushSync()
        expect(hasMessageEditorDrafts()).toBe(true)

        // While the editor is open the flip is refused with the editing reason, and the checkbox stays off.
        const toggle = mountInto(ChatShellPreviewToggle)
        expect(shellFlipBlocker()?.kind).toBe('editing')
        flipCheckbox(toggle).click()
        flushSync()
        expect(captured.alertNormal).toEqual([language.chatShellFlipRefusedEditing])
        expect(shellSwitch.enabled).toBe(false)

        // Settings opens: the editor closes, its registration is released and its text stays in the draft record.
        chatSurface.closeEpoch += 1
        flushSync()
        expect(hasMessageEditorDrafts()).toBe(false)
        expect(old.querySelector('.message-edit-area')).toBeNull()
        expect(draftContentOrphanGate.get(identity(), BASE_TEXT)?.text).toBe('typed in the editor')
        expect(shellFlipBlocker()).toBeNull()

        captured.alertNormal.length = 0
        flipCheckbox(toggle).click()
        flushSync()
        expect(captured.alertNormal).toEqual([])
        expect(shellSwitch.enabled).toBe(true)
        expect(localStorage.getItem('risuChatShell.enabled')).toBe('1')

        // The next open in the new shell offers the same text.
        DBState.db.clickToEdit = true
        const row = mountInto(ShellMessage, { idx: 0, chatId: 'chat-id-1', name: 'Ari', message: liveMessages()[0] })
        row.querySelector<HTMLElement>('[data-part="chat-message-body"]')!.click()
        await until(() => row.querySelector('[data-part="chat-message-editor"]') !== null, 'the new shell editor')
        expect(row.querySelector<HTMLTextAreaElement>('[data-part="chat-message-editor"] textarea')!.value).toBe('typed in the editor')
        expect(row.querySelector('[data-part="chat-message-draft-restored"]')).not.toBeNull()
        expect(liveMessages()[0].data).toBe(BASE_TEXT)
    })
})
