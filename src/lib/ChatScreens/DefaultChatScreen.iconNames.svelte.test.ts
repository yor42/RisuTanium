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
import { flushSync, mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { DBState, ScrollToMessageStore, additionalFloatingActionButtons, selectedCharID } from 'src/ts/stores.svelte'
import { chatFoldedStateMessageIndex } from 'src/ts/globalApi.svelte'
import { language } from 'src/lang'
import { controlDescription, controlName, exposedIcons, paletteClasses, unnamedControls } from 'src/lib/a11yNames.test-helpers'
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
    isComposerLocked: () => false, isComposerLockedIn: () => false,
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
// The bound props the screen hands its message list, captured so a test can raise the new-message flag.
const chatsProps = vi.hoisted(() => ({ current: null as null | { hasNewUnreadMessage?: boolean } }))
vi.mock('./Chats.svelte', () => ({
    default: (_anchor: Comment, props: { hasNewUnreadMessage?: boolean }) => {
        chatsProps.current = props
        return { destroy: () => {} }
    },
}))
vi.mock('./Chat.svelte', () => ({ default: () => ({ destroy: () => {} }) }))
vi.mock('./Suggestion.svelte', () => ({ default: () => ({ destroy: () => {} }) }))
vi.mock('../UI/MainMenu.svelte', () => ({ default: () => ({ destroy: () => {} }) }))
vi.mock('./CreatorQuote.svelte', () => ({ default: () => ({ destroy: () => {} }) }))

function installChat(settings: Record<string, unknown> = {}, chaId = 'upload-owner'): void {
    DBState.db = {
        characters: [{
            chaId, type: 'character', chatPage: 0, name: 'Upload', image: '',
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
        ...settings,
    } as never
    selectedCharID.set(0)
}

let target: HTMLElement | null = null
let instance: ReturnType<typeof mount> | null = null

function show(settings: Record<string, unknown> = {}, chaId = 'upload-owner'): HTMLElement {
    installChat(settings, chaId)
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
    chatsProps.current = null
    additionalFloatingActionButtons.splice(0)
    chatFoldedStateMessageIndex.index = -1
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

const FULL_SETTINGS = {
    useChatSticker: true, useAutoTranslateInput: true, translator: 'x', useAutoSuggestions: true,
    showMenuChatList: true, enableRisuaiProTools: true, sideMenuRerollButton: true,
}
const PILL_STYLES = ['bottom-center', 'bottom-right', 'bottom-left', 'floating-circle', 'right-center', 'top-bar']

/** Controls other than the two composer textareas, whose names belong to a later sub-pass. */
const unnamedButtons = (root: HTMLElement) => unnamedControls(root).filter((description) => !description.startsWith('<textarea'))

const settle = async () => { flushSync(); await tick(); flushSync() }

function menuButton(root: HTMLElement): HTMLButtonElement {
    return Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.getAttribute('aria-label') === language.menu)!
}

async function showPill(style: string): Promise<HTMLElement> {
    const root = show({ newMessageButtonStyle: style })
    expect(chatsProps.current).not.toBeNull()
    chatsProps.current!.hasNewUnreadMessage = true
    await settle()
    return root
}

function pillOf(root: HTMLElement): HTMLElement {
    return Array.from(root.querySelectorAll<HTMLElement>('button')).find((b) => b.classList.contains('shadow-lg'))!
}

function menuRow(root: HTMLElement, label: string): HTMLElement {
    const span = Array.from(root.querySelectorAll('span:not(.sr-only)')).find((s) => s.textContent === label)!
    return span.parentElement as HTMLElement
}

describe('classic composer chrome: names, hidden glyphs and colour', () => {
    test('regression reproducer: every button and glyph of the full composer is named or hidden', async () => {
        additionalFloatingActionButtons.push({ name: 'Plug', icon: '', iconType: 'none', callback: () => {}, id: 'plug' })
        chatFoldedStateMessageIndex.index = 0
        const root = show(FULL_SETTINGS)
        const sticker = root.querySelector('svg.lucide-laugh')!.parentElement as HTMLElement
        sticker.click()
        menuButton(root).click()
        await settle()
        expect(unnamedButtons(root)).toEqual([])
        expect(exposedIcons(root)).toEqual([])
        expect(controlName(document.querySelector<HTMLElement>('.fixed.top-4.right-4 button')!)).toBe('Plug')
    })

    test('regression reproducer: the sticker toggle is a named button with a pressed state and a visible on state', async () => {
        const root = show({ useChatSticker: true })
        const sticker = root.querySelector<HTMLElement>(`button[aria-label="${language.chatShellStickers}"]`)
        expect(sticker).not.toBeNull()
        expect(sticker!.getAttribute('aria-pressed')).toBe('false')
        expect(sticker!.classList.contains('hover:bg-darkbutton')).toBe(true)
        sticker!.click()
        await settle()
        expect(sticker!.getAttribute('aria-pressed')).toBe('true')
        for (const token of ['bg-selected', 'ring-1', 'ring-borderc', 'hover:ring-2']) {
            expect(sticker!.classList.contains(token)).toBe(true)
        }
    })

    test.each(PILL_STYLES)('regression reproducer: the %s new-message pill uses theme tokens with a ring that grows on hover', async (style) => {
        const root = await showPill(style)
        const pill = pillOf(root)
        expect(pill).toBeDefined()
        for (const token of ['bg-selected', 'text-textcolor', 'ring-1', 'ring-borderc', 'hover:ring-2', 'hover:ring-textcolor2']) {
            expect(pill.classList.contains(token)).toBe(true)
        }
        expect(paletteClasses(root)).toEqual([])
        expect(exposedIcons(root)).toEqual([])
    })

    test('regression reproducer: the plugin floating button is named by the plugin and uses theme tokens', async () => {
        additionalFloatingActionButtons.push({ name: 'Plug', icon: '', iconType: 'none', callback: () => {}, id: 'plug' })
        const root = show()
        await settle()
        const fab = document.querySelector<HTMLElement>('.fixed.top-4.right-4 button')!
        expect(controlName(fab)).toBe('Plug')
        for (const token of ['bg-selected', 'ring-1', 'ring-borderc', 'hover:ring-2', 'hover:ring-textcolor2']) {
            expect(fab.classList.contains(token)).toBe(true)
        }
        expect(root).toBeDefined()
    })

    test('regression reproducer: the side menu marks its two toggles on with a ring and uses no default palette', async () => {
        const root = show(FULL_SETTINGS)
        menuButton(root).click()
        await settle()
        for (const label of [language.autoTranslateInput, language.autoSuggest]) {
            const row = menuRow(root, label)
            for (const token of ['bg-selected', 'rounded-sm', 'ring-1', 'ring-borderc']) {
                expect(row.classList.contains(token)).toBe(true)
            }
        }
        expect(paletteClasses(root)).toEqual([])
    })

    test('regression reproducer: an off toggle row keeps only a hover cue and no ring', async () => {
        const root = show({ ...FULL_SETTINGS, useAutoTranslateInput: false, useAutoSuggestions: false })
        menuButton(root).click()
        await settle()
        for (const label of [language.autoTranslateInput, language.autoSuggest]) {
            const row = menuRow(root, label)
            expect(row.classList.contains('lg:hover:text-textcolor2')).toBe(true)
            expect(row.classList.contains('ring-1')).toBe(false)
        }
    })

    test('regression reproducer: the composer buttons hover to the border token', async () => {
        const root = show()
        const send = root.querySelector<HTMLElement>('button.button-icon-send')!
        const menu = menuButton(root)
        for (const button of [send, menu]) {
            expect(button.classList.contains('hover:bg-borderc')).toBe(true)
        }
        expect(paletteClasses(root)).toEqual([])
    })

    test('regression reproducer: the load-more region holds no button inside a button', async () => {
        chatFoldedStateMessageIndex.index = 0
        const root = show()
        await settle()
        expect(root.textContent).toContain(language.loadMore)
        expect(root.querySelectorAll('button button')).toHaveLength(0)
    })

    test('regression reproducer: the playground add control is a named button', async () => {
        const root = show({}, '§playground')
        await settle()
        const names = Array.from(root.querySelectorAll('button, [role="button"]')).map(controlName)
        expect(names).toContain(language.playgroundAddReplyMessage)
        expect(unnamedButtons(root)).toEqual([])
        expect(exposedIcons(root)).toEqual([])
    })
})

/**
 * Name-level reproducers only: they read the attributes a screen reader computes from, not what
 * Android TalkBack speaks. The Note 9 row S4 is the acceptance. A textarea is named by
 * `aria-labelledby`, and its `aria-describedby` lists the naming element so TalkBack speaks the name
 * in the field's own stop.
 */
describe('the composer textarea names', () => {
    test('regression reproducer: the message textarea is named Message through aria-labelledby and keeps its aria-label', () => {
        const root = show()
        const area = root.querySelector<HTMLTextAreaElement>('textarea.text-input-area')!
        expect(controlName(area)).toBe(language.chatShellMessage)
        expect(controlDescription(area)).toBe(language.chatShellMessage)
        expect(area.getAttribute('aria-label')).toBe(language.chatShellMessage)
        expect(area.getAttribute('aria-describedby')).toBe(area.getAttribute('aria-labelledby'))
    })

    test('regression reproducer: the auto-translate textarea is named by a text element, not its icon label', () => {
        const root = show({ useAutoTranslateInput: true, translator: 'x' })
        const area = root.querySelector<HTMLTextAreaElement>('#messageInputTranslate')!
        expect(controlName(area)).toBe(language.autoTranslateInput)
        expect(controlDescription(area)).toBe(language.autoTranslateInput)
        expect(controlName(root.querySelector<HTMLTextAreaElement>('textarea.text-input-area')!)).toBe(language.chatShellMessage)
        const labelled = area.getAttribute('aria-labelledby')!
        expect(document.getElementById(labelled)!.classList.contains('sr-only')).toBe(true)
        expect(unnamedControls(root).filter((description) => description.startsWith('<textarea'))).toEqual([])
    })

    test('regression reproducer: the two textareas do not share a name element', () => {
        const root = show({ useAutoTranslateInput: true, translator: 'x' })
        const message = root.querySelector('textarea.text-input-area')!.getAttribute('aria-labelledby')
        const translate = root.querySelector('#messageInputTranslate')!.getAttribute('aria-labelledby')
        expect(message).not.toBeNull()
        expect(translate).not.toBeNull()
        expect(message).not.toBe(translate)
    })
})

describe('the scroll-to-message flash', () => {
    test('regression reproducer: the target row is ringed with the border token', async () => {
        const original = Element.prototype.scrollIntoView
        Element.prototype.scrollIntoView = () => {}
        const wrapper = document.createElement('div')
        const row = document.createElement('div')
        row.setAttribute('data-chat-index', '0')
        wrapper.appendChild(row)
        document.body.appendChild(wrapper)
        try {
            show()
            ScrollToMessageStore.value = 0
            flushSync()
            const deadline = Date.now() + 1500
            while (!row.classList.contains('ring-2') && Date.now() < deadline) {
                await new Promise((resolve) => setTimeout(resolve, 20))
            }
            expect(row.classList.contains('ring-2')).toBe(true)
            expect(row.classList.contains('ring-borderc')).toBe(true)
            expect(paletteClasses(wrapper)).toEqual([])
        } finally {
            wrapper.remove()
            Element.prototype.scrollIntoView = original
            ScrollToMessageStore.value = -1
        }
    })
})
