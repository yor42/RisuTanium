// @vitest-environment jsdom
/**
 * T1, T2, T12 (regression reproducers): the persona control is a tab outside the composer row, it is the composer root's first
 * element child (before the extras strip, the translate box and the row), and it carries menu-button semantics with no aria-label.
 * Before the change the control was a chip inside `chat-composer-row`, after the extras strip and the translate box.
 * T13 (tab half is a compatibility guard, it passes before and after): a long persona name is never shortened in script.
 * REAL: ShellComposer, ExtrasStrip. MOCKED: stores, process modules, language, Suggestion. Component CSS is not applied in
 * vitest and jsdom does no layout, so no assertion here claims a visual position.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import * as drafts from '../../ts/process/composerDrafts.svelte'
import { resetLocalDraftsForTest } from '../../ts/localDrafts'

const LONG_NAME = 'N'.repeat(60)
const state = $state({ db: {
    characters: [{ chaId: 'c', name: 'Character', chatPage: 0, chats: [{ id: 'chat', message: [], bindedPersona: '' }] }],
    personas: [{ id: 'p1', name: 'Ann' }, { id: 'p2', name: 'Bea' }, { id: 'p3', name: LONG_NAME }],
    selectedPersona: 0,
    sendWithEnter: true, useAutoTranslateInput: false, translator: '', username: 'User', longPressToPopupEditor: false,
    useAutoSuggestions: false, subModel: '', autoSuggestClean: false,
} })
const selection = $state({ selId: 0 })
const popup = $state({ value: '', mode: '', language: '', open: false })

vi.mock('../../ts/stores.svelte', () => ({ DBState: state, selIdState: selection, popUpEditorStore: popup }))
vi.mock('../../ts/process/index.svelte', async () => {
    const { writable } = await import('svelte/store')
    return { doingChat: writable(false), chatProcessStage: writable(0) }
})
vi.mock('../../ts/process/composerActions.svelte', () => ({ sendMain: vi.fn(async () => {}), abortChat: vi.fn(), stopComposerWorkIn: vi.fn(), isComposerBusy: () => false, isComposerBusyIn: () => false, isComposerLocked: () => false, reroll: vi.fn(), updateInputTransateMessage: vi.fn() }))
vi.mock('../../ts/process/chatOrigin', () => ({ beginWork: vi.fn(), originOf: (owner: { chaId: string }, chat: { id: string }) => ({ chaId: owner.chaId, chatId: chat.id }) }))
vi.mock('../../ts/chatShell/stopDelete.svelte', () => ({ isStopDeletePending: () => false }))
vi.mock('../../ts/process/files/multisend', () => ({ postChatFile: vi.fn(async () => []) }))
vi.mock('../../ts/parser/parser.svelte', () => ({ hasher: (value: string) => value, risuChatParser: (value: string) => value, assetRegex: /{{asset:[^}]+}}/g }))
vi.mock('../../ts/parser/chatML', () => ({ parseChatML: () => [] }))
vi.mock('../ChatScreens/Suggestion.svelte', () => ({ default: () => ({}) }))
vi.mock('../ChatScreens/AssetInput.svelte', () => ({ default: () => ({}) }))
vi.mock('../../lang', () => ({ language: {
    chatShellMessage: 'Message', chatShellMoreActions: 'More actions', chatShellChoosePersona: 'Choose persona',
    asPersona: (name: string) => `as ${name}`, chatShellStop: 'Stop', chatShellSend: 'Send', chatShellSendWaitsForDelete: 'Waiting for the reply to be deleted…',
    chatShellSendBlockedWriting: 'Another chat is writing a reply. Send when it finishes.',
    chatShellRemoveAttachment: 'Remove attachment', enterKey: 'Enter key', enterMessageForTranslateToEnglish: 'Enter a message to translate',
    chatShellStickers: 'Stickers', chatShellOnThisDevice: 'On this device',
    chatShellEnterAutomatic: 'Automatic', chatShellEnterSend: 'Send', chatShellEnterNewline: 'New line', postFile: 'Post File',
} }))

let app: ReturnType<typeof mount> | null = null
let target: HTMLElement | null = null
afterEach(async () => {
    if (app) await unmount(app)
    target?.remove()
    app = null; target = null
    resetLocalDraftsForTest()
    drafts.resetComposerDraftsForTests()
    state.db.characters[0].chats[0].bindedPersona = ''
    state.db.useAutoSuggestions = false
    state.db.useAutoTranslateInput = false
    state.db.translator = ''
})

const props = $state({ personaexpanded: false })
async function show(onpersona: (opener: HTMLElement) => void = vi.fn()): Promise<HTMLElement> {
    const { default: ShellComposer } = await import('./ShellComposer.svelte')
    target = document.createElement('div')
    document.body.appendChild(target)
    app = mount(ShellComposer, { target, props: { onplus: vi.fn(), onpersona, get personaexpanded() { return props.personaexpanded } } })
    flushSync()
    return target
}
const tabOf = (node: HTMLElement) => node.querySelector<HTMLButtonElement>('[data-part="chat-composer-persona"]')!

describe('ShellComposer persona tab', () => {
    test('T1: the row holds plus, input and send only; the tab sits outside it, before it, and is a tab', async () => {
        const node = await show()
        const row = node.querySelector<HTMLElement>('[data-part="chat-composer-row"]')!
        expect(Array.from(row.children).map((child) => child.getAttribute('data-part'))).toEqual(['chat-composer-plus', 'chat-composer-input', 'chat-send'])
        expect(row.querySelector('[data-part="chat-composer-persona"]')).toBeNull()
        const tab = tabOf(node)
        expect(tab).not.toBeNull()
        expect(tab.getAttribute('data-kind')).toBe('tab')
        expect(tab.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
        expect(tab.textContent).toContain('as Ann')
        const tools = node.querySelector('[data-part="chat-composer-tools"]')!
        expect(tools.querySelector('button')).not.toBeNull()
        expect(tools.querySelector('select')).not.toBeNull()
        expect(tools.querySelector('[data-part="chat-composer-enter-scope"]')).not.toBeNull()
    })

    test('T2: menu-button semantics, expanded follows the prop, described by the hint, no aria-label, click hands over the tab', async () => {
        const onpersona = vi.fn()
        const node = await show(onpersona)
        const tab = tabOf(node)
        expect(tab.getAttribute('aria-haspopup')).toBe('menu')
        expect(tab.getAttribute('aria-expanded')).toBe('false')
        props.personaexpanded = true
        flushSync()
        expect(tab.getAttribute('aria-expanded')).toBe('true')
        props.personaexpanded = false
        flushSync()
        expect(tab.getAttribute('aria-expanded')).toBe('false')
        expect(tab.hasAttribute('aria-label')).toBe(false)
        const hint = node.querySelector(`#${tab.getAttribute('aria-describedby')}`)
        expect(hint?.textContent).toBe('Choose persona')
        tab.click()
        expect(onpersona).toHaveBeenCalledWith(tab)
    })

    test('T12: the tab is the composer root\'s first element child, before the extras strip, the translate box and the row, and first in focus order', async () => {
        state.db.useAutoSuggestions = true
        state.db.useAutoTranslateInput = true
        state.db.translator = 'google'
        const node = await show()
        const root = node.querySelector<HTMLElement>('[data-part="chat-composer"]')!
        const tab = tabOf(node)
        const strip = node.querySelector('[data-part="chat-extras-strip"]')!
        const translate = node.querySelector('[data-part="chat-composer-translate"]')!
        const row = node.querySelector('[data-part="chat-composer-row"]')!
        expect(strip).not.toBeNull()
        expect(translate).not.toBeNull()
        expect(tab.parentElement).toBe(root)
        expect(root.firstElementChild).toBe(tab)
        const precedes = (later: Element) => (tab.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
        expect([precedes(strip), precedes(translate), precedes(row)]).toEqual([true, true, true])
        expect(strip.compareDocumentPosition(translate) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
        expect(translate.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
        expect(root.querySelector('button,textarea,select')).toBe(tab)
    })

    test('T13: a 60-character persona name stays whole in the tab text', async () => {
        state.db.characters[0].chats[0].bindedPersona = 'p3'
        const node = await show()
        expect(tabOf(node).textContent).toContain(`as ${LONG_NAME}`)
    })
})
