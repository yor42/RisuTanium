// @vitest-environment jsdom
/**
 * T10 (regression reproducer): the composer's persona tab opens the PersonaSheet as the `dropup` variant at phone and at wide
 * widths and tells the composer the menu is expanded; the This-chat sheet's picker stays the `sheet` variant and leaves the tab
 * collapsed. Before the change the sheet had no `variant` and the composer no `personaexpanded`.
 * REAL: ChatShell. MOCKED: the composer, the persona sheet and the This-chat sheet (they capture their props), the header,
 * the stores and the heavy process modules.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

type PersonaProps = { open: boolean, variant?: 'sheet' | 'dropup', onclose: () => void }
type ComposerProps = { personaexpanded?: boolean, onpersona: (opener: HTMLElement) => void }
type ThisChatProps = { onpersona: (opener: HTMLElement) => void }
const captured = vi.hoisted(() => ({
    persona: null as null | PersonaProps,
    composer: null as null | ComposerProps,
    thisChat: null as null | ThisChatProps,
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
    alertNormal: vi.fn(),
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
vi.mock('./ShellComposer.svelte', () => ({ default: (_anchor: Comment, props: ComposerProps) => { captured.composer = props; return {} } }))
vi.mock('./PlusSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('./ShellNotices.svelte', () => ({ default: () => ({}) }))
vi.mock('./ShellFloatingButtons.svelte', () => ({ default: () => ({}) }))
vi.mock('./CustomizeButtonsSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('./PersonaSheet.svelte', () => ({ default: (_anchor: Comment, props: PersonaProps) => { captured.persona = props; return {} } }))
vi.mock('./ThisChatSheet.svelte', () => ({ default: (_anchor: Comment, props: ThisChatProps) => { captured.thisChat = props; return {} } }))
vi.mock('./ShellHeader.svelte', () => ({ default: () => ({}) }))

//#endregion

import ChatShell from './ChatShell.svelte'
// Loads the transcript's module graph during collection, so the shell's lazy imports settle inside the test timeout.
import './ShellMessageList.svelte'
import { DBState, selIdState } from '../../ts/stores.svelte'
import { resetLocalDraftsForTest } from '../../ts/localDrafts'

function installDb(): void {
    DBState.db = {
        username: 'User', userIcon: '', translator: '', translatorType: 'none', translateBeforeHTMLFormatting: false, legacyTranslation: false,
        swipe: true, autoTranslate: false, askRemoval: false, instantRemove: false, requestInfoInsideChat: false, clickToEdit: false,
        zoomsize: 100, lineHeight: 1.25, enableBlockPartialEdit: false, enableDragPartialEdit: false, useChatCopy: false,
        showFirstMessagePages: false, enableBookmark: true, createFolderOnBranch: false, iconsize: 100, memoryLimitThickness: 2,
        theme: '', guiHTML: '', roundIcons: false,
        autoScrollToNewMessage: false, alwaysScrollToNewMessage: false, chatLoadInitialPages: 5, chatLoadAdditionalPages: 5,
        characters: [{
            chaId: 'char-1', type: 'character', name: 'Ari', image: '', ttsMode: 'none', chatPage: 0, firstMessage: 'Hello', alternateGreetings: [] as string[],
            chats: [{ id: 'chat-1', message: [{ role: 'char', data: 'hi', chatId: 'chat-id-1', time: 1 }], bookmarks: [] as string[], bookmarkNames: {} as Record<string, string> }],
        }],
    } as never
    selIdState.selId = 0
}

const mounted: Array<ReturnType<typeof mount>> = []
let target: HTMLElement
let openerButton: HTMLButtonElement

beforeEach(() => {
    installDb()
    captured.persona = null
    captured.composer = null
    captured.thisChat = null
    localStorage.clear()
    resetLocalDraftsForTest()
    openerButton = document.createElement('button')
    document.body.appendChild(openerButton)
})

afterEach(async () => {
    for (const instance of mounted.splice(0)) await unmount(instance).catch(() => {})
    document.body.replaceChildren()
    vi.unstubAllGlobals()
})

async function showShell(): Promise<void> {
    target = document.createElement('div')
    document.body.appendChild(target)
    mounted.push(mount(ChatShell, { target, props: {} }))
    flushSync()
    await vi.waitFor(() => {
        flushSync()
        if (!captured.persona || !captured.composer || !captured.thisChat) throw new Error('waiting for the lazy components')
    }, { timeout: 15000, interval: 10 })
}

async function settle(): Promise<void> {
    flushSync()
    await tick()
    flushSync()
}

describe('ChatShell persona tab wiring', () => {
    test('T10: the composer opener gives the dropup and an expanded tab; the This-chat picker gives the sheet and a collapsed tab', async () => {
        vi.stubGlobal('innerWidth', 375)
        await showShell()
        expect(captured.persona!.open).toBe(false)
        expect(captured.composer!.personaexpanded).toBe(false)

        captured.composer!.onpersona(openerButton)
        await settle()
        expect(captured.persona!.open).toBe(true)
        expect(captured.persona!.variant).toBe('dropup')
        expect(captured.composer!.personaexpanded).toBe(true)

        captured.persona!.onclose()
        await settle()
        expect(captured.persona!.open).toBe(false)
        expect(captured.composer!.personaexpanded).toBe(false)

        captured.thisChat!.onpersona(openerButton)
        await settle()
        expect(captured.persona!.open).toBe(true)
        expect(captured.persona!.variant).toBe('sheet')
        expect(captured.composer!.personaexpanded).toBe(false)
    })

    test('T10 wide: at 1000 px the composer opener still gives the dropup', async () => {
        vi.stubGlobal('innerWidth', 1000)
        await showShell()
        captured.composer!.onpersona(openerButton)
        await settle()
        expect(captured.persona!.open).toBe(true)
        expect(captured.persona!.variant).toBe('dropup')
        expect(captured.composer!.personaexpanded).toBe(true)
    })
})
