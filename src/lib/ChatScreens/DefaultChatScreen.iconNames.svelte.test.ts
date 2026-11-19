// @vitest-environment jsdom

/**
 * Accessible names of the classic composer's controls in the REAL `DefaultChatScreen.svelte`: the
 * message textarea, the send button, the stop button shown while this chat's reply runs, and the menu
 * button, whose `aria-expanded` follows the menu. Icon glyphs are hidden so they add no name. The stop
 * button's old `aria-labelledby` pointed at no element, which left it unnamed.
 *
 * MOCKED: the module set of `DefaultChatScreen.uploadCounter.svelte.test.ts`, with the composer's
 * busy state set per test before mount.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { DBState, selectedCharID } from 'src/ts/stores.svelte'
import { language } from 'src/lang'
import DefaultChatScreen from './DefaultChatScreen.svelte'

const busy = vi.hoisted(() => ({ value: false }))

vi.mock('src/ts/process/files/multisend', async (importOriginal) => ({
    ...await importOriginal<typeof import('src/ts/process/files/multisend')>(),
    postChatFile: vi.fn(async () => []),
}))
vi.mock('src/ts/process/index.svelte', () => ({
    doingChat: writable(false), chatProcessStage: writable(0), sendChat: vi.fn(async () => true),
}))
vi.mock('src/ts/process/composerActions.svelte', () => ({
    isComposerBusy: () => false,
    isComposerBusyIn: () => busy.value,
    stopComposerWorkIn: () => {},
    isComposerLocked: () => false,
    isAutoModeActive: () => false,
}))
vi.mock('src/ts/process/coldstorage.svelte', async (importOriginal) => ({
    ...await importOriginal<typeof import('src/ts/process/coldstorage.svelte')>(),
    preLoadChat: vi.fn(async () => 'ok'),
}))
vi.mock('src/ts/globalApi.svelte', () => {
    const chatFoldedState = $state({ data: null })
    const chatFoldedStateMessageIndex = $state({ index: -1 })
    return {
    aiLawApplies: () => false,
    chatFoldedState,
    chatFoldedStateMessageIndex,
    downloadFile: vi.fn(),
    getFileSrc: vi.fn(async () => ''),
    saveAsset: vi.fn(async () => ''),
    readImage: vi.fn(),
    forageStorage: {
        keys: vi.fn(async () => []),
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => {}),
    },
    }
})
vi.mock('src/ts/characters', () => ({ getCharImage: () => '' }))
vi.mock('src/ts/parser/parser.svelte', () => ({
    hasher: vi.fn((s: string) => s),
    risuChatParser: vi.fn((text: string) => text ?? ''),
    assetRegex: /{{asset:[^}]+}}/g,
}))
vi.mock('src/ts/parser/chatML', () => ({ parseChatML: vi.fn(() => []) }))
vi.mock('./Chats.svelte', () => ({ default: () => ({ destroy: () => {} }) }))
vi.mock('./Chat.svelte', () => ({ default: () => ({ destroy: () => {} }) }))
vi.mock('./Suggestion.svelte', () => ({ default: () => ({ destroy: () => {} }) }))
vi.mock('../UI/MainMenu.svelte', () => ({ default: () => ({ destroy: () => {} }) }))
vi.mock('./CreatorQuote.svelte', () => ({ default: () => ({ destroy: () => {} }) }))

function installChat(): void {
    DBState.db = {
        characters: [{
            chaId: 'upload-owner', type: 'character', chatPage: 0, name: 'Upload', image: '',
            chats: [{ id: 'upload-chat', message: [], note: '', localLore: [], scriptstate: {} }],
            firstMessage: 'Hello', alternateGreetings: [], additionalAssets: [], ttsMode: 'none',
            triggerscript: [], customscript: [], globalLore: [], desc: 'Upload',
            largePortrait: false, removedQuotes: true, creatorNotes: '',
        }],
        theme: '', modules: [], templateDefaultVariables: '', presetRegex: [],
        personas: [{ name: 'User', icon: '', largePortrait: false }],
        selectedPersona: 0, username: 'User', useAutoSuggestions: false, useChatSticker: false,
        fixedChatTextarea: false, useAutoTranslateInput: false, newMessageButtonStyle: 'bottom-center',
        showMenuChatList: false, showMenuHypaMemoryModal: false, enableRisuaiProTools: false,
        useSayNothing: false, playMessage: false, translatorType: '', translator: '',
        hypaV3: false, hypav2: false, sideMenuRerollButton: false, sendWithEnter: true,
        subModel: '', supaModelType: 'none', autoSuggestClean: false, personaPrompt: '',
    } as never
    selectedCharID.set(0)
}

let target: HTMLElement | null = null
let instance: ReturnType<typeof mount> | null = null

function show(): HTMLElement {
    installChat()
    target = document.createElement('div')
    document.body.appendChild(target)
    instance = mount(DefaultChatScreen, { target, props: {} })
    flushSync()
    return target
}

afterEach(async () => {
    if (instance) await unmount(instance)
    target?.remove()
    instance = null
    target = null
    busy.value = false
})

function hiddenGlyph(button: HTMLElement): void {
    const svg = button.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg!.getAttribute('aria-hidden')).toBe('true')
}

describe('classic composer control names', () => {
    test('the message textarea is named Message', () => {
        const root = show()
        expect(root.querySelector('textarea.text-input-area')!.getAttribute('aria-label')).toBe(language.chatShellMessage)
    })

    test('the send button is named Send with a hidden glyph', () => {
        const root = show()
        const send = root.querySelector<HTMLButtonElement>('button.button-icon-send')!
        expect(send.getAttribute('aria-label')).toBe(language.chatShellSend)
        hiddenGlyph(send)
    })

    test('the menu button is named Menu and its aria-expanded follows the menu', () => {
        const root = show()
        const menu = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.getAttribute('aria-label') === language.menu)
        expect(menu).toBeDefined()
        hiddenGlyph(menu!)
        expect(menu!.getAttribute('aria-expanded')).toBe('false')
        menu!.click()
        flushSync()
        expect(menu!.getAttribute('aria-expanded')).toBe('true')
        menu!.click()
        flushSync()
        expect(menu!.getAttribute('aria-expanded')).toBe('false')
    })

    test('while this chat is busy the stop button is named Stop, with no dangling aria-labelledby', () => {
        busy.value = true
        const root = show()
        expect(root.querySelector('button.button-icon-send')).toBeNull()
        const stop = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.getAttribute('aria-label') === language.chatShellStop)
        expect(stop).toBeDefined()
        expect(stop!.hasAttribute('aria-labelledby')).toBe(false)
    })
})
