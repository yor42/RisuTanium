// @vitest-environment jsdom
/**
 * T0c-1 (guard): layoutOf/inputOf and the root mirror set `data-layout`/`data-input` on <html>, follow window resizes and hover-query
 * changes, and stop following after the stop function.
 * T0c-2 (guard): ChatShell draws no `data-layout`/`data-input` of its own when <html> carries them, and otherwise computes them with
 * the shared functions (900 is wide, 899 is mid).
 * REAL: rootAttributes, ChatShell. MOCKED: ChatShell's children, stores and heavy process modules.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

//#region ChatShell module mocks

vi.mock('../stores.svelte', async () => {
    const { writable: store } = await import('svelte/store')
    const DBState = { db: {} as Record<string, unknown> }
    const selIdState = { selId: 0 }
    const ScrollToMessageStore = { value: -1 }
    return {
        DBState, selIdState, ScrollToMessageStore,
        selectedCharID: store(0), ReloadGUIPointer: store(0), ReloadChatPointer: store({} as Record<number, number>),
        CurrentTriggerIdStore: store(null), popupStore: { children: null, mouseX: 0, mouseY: 0, openId: 0 },
        HideIconStore: store(false), createSimpleCharacter: () => null, bookmarkListOpen: store(false),
    }
})
vi.mock('../globalApi.svelte', () => ({
    chatFoldedState: { data: null }, chatFoldedStateMessageIndex: { index: -1 }, aiLawApplies: () => false, changeChatTo: vi.fn(),
    foldChatToMessage: vi.fn(), getFileSrc: vi.fn(async () => ''), createChatCopyName: vi.fn((name: string) => `${name} Branch`),
    downloadFile: vi.fn(), fetchNative: vi.fn(), readImage: vi.fn(),
}))
vi.mock('../storage/database.svelte', () => ({
    getCurrentCharacter: vi.fn(() => null), getCurrentChat: vi.fn(() => null), setCurrentChat: vi.fn(), setDatabase: vi.fn(),
    getDatabase: vi.fn(() => { throw new Error('no live database in tests') }),
}))
vi.mock('../alert', () => ({
    alertClear: vi.fn(), alertConfirm: vi.fn(async () => true), alertError: vi.fn(), alertWait: vi.fn(),
    alertNormal: vi.fn(),
    alertInput: vi.fn(async () => ''), alertRequestData: vi.fn(), alertSelect: vi.fn(async () => '1'),
}))
vi.mock('../parser/parser.svelte', () => ({ ParseMarkdown: vi.fn(async (text: string) => text), hasher: (value: string) => value, risuChatParser: (value: string) => value, assetRegex: /{{asset:[^}]+}}/g }))
vi.mock('../parser/chatML', () => ({ parseChatML: () => [] }))
vi.mock('../translator/translator', () => ({ getLLMCache: vi.fn(async () => null), setLLMCache: vi.fn(async () => {}) }))
vi.mock('../process/scriptings', () => ({ runLuaButtonTrigger: vi.fn(async () => null), runLuaInteractionTrigger: vi.fn() }))
vi.mock('../process/scripts', () => ({ risuChatParser: (text: string) => text ?? '' }))
vi.mock('../process/triggers', () => ({ runTrigger: vi.fn(async () => null) }))
vi.mock('../process/tts', () => ({ sayTTS: vi.fn(async () => {}), stopTTS: vi.fn() }))
vi.mock('./colorscheme', () => ({ ColorSchemeTypeStore: writable('dark') }))
vi.mock('../model/modellist', () => ({ getModelInfo: vi.fn(() => ({ shortName: 'test-model' })) }))
vi.mock('../util', () => ({
    capitalize: vi.fn((value: string) => value), getUserIcon: vi.fn(() => ''), getUserName: vi.fn(() => 'User'),
    sleep: vi.fn(async () => {}), findCharacterbyId: vi.fn(() => null),
}))
vi.mock('../characters', () => ({ getCharImage: vi.fn(async () => null) }))
vi.mock('../process/index.svelte', async () => {
    const { writable: store } = await import('svelte/store')
    return { doingChat: store(false) }
})
vi.mock('../process/composerActions.svelte', () => ({
    branchAt: vi.fn(), stepSibling: vi.fn(), regenerateNewest: vi.fn(), isComposerBusy: () => false, isAutoModeActive: () => false,
}))
vi.mock('../chatShell/stopDelete.svelte', () => ({ requestStopDelete: vi.fn(() => true), isStopDeletePending: () => false }))
vi.mock('../chatShell/haptics', () => ({ tickHaptic: vi.fn(), readHaptics: () => true, writeHaptics: vi.fn(), hapticsSupported: () => true }))
vi.mock('../process/moduleRefList', () => ({ hasModuleStubs: () => false }))
vi.mock('../process/moduleEnsure', () => ({ ensureCurrentModulesOrAlert: async () => true, ensureModulesOrAlert: async () => true }))
vi.mock('../process/ttsModes', () => ({ isTTSVoiceMode: () => false }))
vi.mock('../process/displayParseOptions', () => ({ buildDisplayParseOptions: () => ({}) }))
vi.mock('../caughtErrors', () => ({ recordCaughtError: vi.fn() }))
vi.mock('../process/memory/measureFlag', () => ({ MEASURE: false }))
vi.mock('../process/chatPhaseRing', () => ({ noteEditConfirm: vi.fn() }))
vi.mock('../../lib/ChatScreens/chatSurface.svelte', () => ({
    chatSurface: { hidden: false, rebuildEpoch: 0, closeEpoch: 0, remountEpoch: 0, heldGui: 0, heldChat: {} as Record<number, number> },
    isChatSurfaceInstalled: () => true, onSurfaceHiding: () => () => {},
}))
vi.mock('../../lib/ChatScreens/ChatBody.svelte', () => ({ default: () => ({}) }))
vi.mock('../../lib/ChatScreens/PartialEditController.svelte', () => ({ default: () => ({}) }))
vi.mock('../../lib/ChatShell/StreamingView.svelte', () => ({ default: () => ({}) }))
vi.mock('../../lib/ChatShell/ShellComposer.svelte', () => ({ default: () => ({}) }))
vi.mock('../../lib/ChatShell/PlusSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('../../lib/ChatShell/ShellNotices.svelte', () => ({ default: () => ({}) }))
vi.mock('../../lib/ChatShell/ShellFloatingButtons.svelte', () => ({ default: () => ({}) }))
vi.mock('../../lib/ChatShell/CustomizeButtonsSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('../../lib/ChatShell/PersonaSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('../../lib/ChatShell/ThisChatSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('../../lib/ChatShell/ShellHeader.svelte', () => ({ default: () => ({}) }))
vi.mock('../../lib/ChatShell/TogglesPanel.svelte', () => ({ default: () => ({}) }))
vi.mock('../../lib/ChatShell/ChatDeleteConfirm.svelte', () => ({ default: () => ({}) }))
vi.mock('../../lib/ChatShell/SwitchFrame.svelte', () => ({ default: () => ({}) }))
vi.mock('../../lib/ChatShell/ActionSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('../../lib/ChatShell/ShellSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('../../lib/ChatShell/SendFailureCard.svelte', () => ({ default: () => ({}) }))
vi.mock('../../lib/ChatShell/ShellMessageList.svelte', () => ({ default: () => ({}) }))
vi.mock('../../lib/ChatScreens/NotificationsOffNotice.svelte', () => ({ default: () => ({}) }))

//#endregion

import ChatShell from '../../lib/ChatShell/ChatShell.svelte'
// Loads the shell's lazily imported modules during collection, so none of them resolves after the environment is torn down.
import '../chatShell/sendFailure.svelte'
import '../chatShell/switchTarget.svelte'
import '../../lib/Setting/settingsRoute'
import { DBState, selIdState } from '../stores.svelte'
import { inputOf, layoutOf, startRootAttributeMirror } from './rootAttributes'

interface FakeHoverQuery {
    matches: boolean
    listeners: Set<() => void>
    addEventListener: (type: string, listener: () => void) => void
    removeEventListener: (type: string, listener: () => void) => void
}

function installHoverQuery(matches: boolean): FakeHoverQuery {
    const query: FakeHoverQuery = {
        matches,
        listeners: new Set(),
        addEventListener: (_type, listener) => { query.listeners.add(listener) },
        removeEventListener: (_type, listener) => { query.listeners.delete(listener) },
    }
    vi.stubGlobal('matchMedia', () => query)
    return query
}

function resizeTo(width: number): void {
    vi.stubGlobal('innerWidth', width)
    window.dispatchEvent(new Event('resize'))
}

function changeHover(query: FakeHoverQuery, matches: boolean): void {
    query.matches = matches
    for (const listener of [...query.listeners]) listener()
}

function resetRootAttributes(): void {
    document.documentElement.removeAttribute('data-layout')
    document.documentElement.removeAttribute('data-input')
}

beforeEach(resetRootAttributes)
afterEach(() => {
    vi.unstubAllGlobals()
    resetRootAttributes()
})

describe('T0c-1 root attribute mirror', () => {
    test('layoutOf uses the shell breakpoints: wide from 900, mid from 600', () => {
        expect(layoutOf(1280)).toBe('wide')
        expect(layoutOf(900)).toBe('wide')
        expect(layoutOf(899)).toBe('mid')
        expect(layoutOf(600)).toBe('mid')
        expect(layoutOf(599)).toBe('phone')
        expect(layoutOf(0)).toBe('phone')
    })

    test('inputOf is hover only for a fine hovering pointer, and touch without matchMedia', () => {
        const queries: string[] = []
        const hovering = { matchMedia: (query: string) => { queries.push(query); return { matches: true } } }
        expect(inputOf(hovering)).toBe('hover')
        expect(queries).toEqual(['(hover: hover) and (pointer: fine)'])
        expect(inputOf({ matchMedia: () => ({ matches: false }) })).toBe('touch')
        expect(inputOf({})).toBe('touch')
    })

    test('the mirror writes both attributes at start', () => {
        vi.stubGlobal('innerWidth', 1000)
        installHoverQuery(true)
        const stop = startRootAttributeMirror(window, document)
        expect(document.documentElement.dataset.layout).toBe('wide')
        expect(document.documentElement.dataset.input).toBe('hover')
        stop()
    })

    test('the mirror follows window resizes across 600 and 900', () => {
        vi.stubGlobal('innerWidth', 1000)
        installHoverQuery(true)
        const stop = startRootAttributeMirror(window, document)
        resizeTo(899)
        expect(document.documentElement.dataset.layout).toBe('mid')
        resizeTo(599)
        expect(document.documentElement.dataset.layout).toBe('phone')
        resizeTo(900)
        expect(document.documentElement.dataset.layout).toBe('wide')
        stop()
    })

    test('the mirror follows hover-query changes', () => {
        vi.stubGlobal('innerWidth', 1000)
        const query = installHoverQuery(false)
        const stop = startRootAttributeMirror(window, document)
        expect(document.documentElement.dataset.input).toBe('touch')
        changeHover(query, true)
        expect(document.documentElement.dataset.input).toBe('hover')
        changeHover(query, false)
        expect(document.documentElement.dataset.input).toBe('touch')
        stop()
    })

    test('the mirror works without matchMedia and stays touch', () => {
        vi.stubGlobal('innerWidth', 700)
        vi.stubGlobal('matchMedia', undefined)
        const stop = startRootAttributeMirror(window, document)
        expect(document.documentElement.dataset.layout).toBe('mid')
        expect(document.documentElement.dataset.input).toBe('touch')
        stop()
    })

    test('after the stop function neither a resize nor a query change updates the attributes, and no listener is left', () => {
        vi.stubGlobal('innerWidth', 1000)
        const query = installHoverQuery(false)
        const stop = startRootAttributeMirror(window, document)
        expect(query.listeners.size).toBe(1)
        stop()
        expect(query.listeners.size).toBe(0)
        resizeTo(500)
        changeHover(query, true)
        expect(document.documentElement.dataset.layout).toBe('wide')
        expect(document.documentElement.dataset.input).toBe('touch')
    })
})

describe('T0c-2 ChatShell defers to the root attributes', () => {
    const mounted: Array<ReturnType<typeof mount>> = []

    beforeEach(() => {
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
        localStorage.clear()
    })

    afterEach(async () => {
        for (const instance of mounted.splice(0)) await unmount(instance).catch(() => {})
        document.body.replaceChildren()
    })

    async function showShell(): Promise<HTMLElement> {
        const target = document.createElement('div')
        document.body.appendChild(target)
        mounted.push(mount(ChatShell, { target, props: {} }))
        await vi.dynamicImportSettled()
        flushSync()
        const shell = target.querySelector<HTMLElement>('[data-part="chat-shell"]')
        if (!shell) throw new Error('the chat shell did not render')
        return shell
    }

    test('with both root attributes the shell renders neither of its own', async () => {
        document.documentElement.dataset.layout = 'wide'
        document.documentElement.dataset.input = 'hover'
        vi.stubGlobal('innerWidth', 1000)
        installHoverQuery(true)
        const shell = await showShell()
        expect(shell.hasAttribute('data-layout')).toBe(false)
        expect(shell.hasAttribute('data-input')).toBe(false)
    })

    test('without root attributes the shell computes them with the shared functions: 900 is wide, 899 is mid', async () => {
        vi.stubGlobal('innerWidth', 900)
        installHoverQuery(true)
        const wide = await showShell()
        expect(wide.getAttribute('data-layout')).toBe('wide')
        expect(wide.getAttribute('data-input')).toBe('hover')

        vi.stubGlobal('innerWidth', 899)
        installHoverQuery(false)
        const mid = await showShell()
        expect(mid.getAttribute('data-layout')).toBe('mid')
        expect(mid.getAttribute('data-input')).toBe('touch')
    })
})
