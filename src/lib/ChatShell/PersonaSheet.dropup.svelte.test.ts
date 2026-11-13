// @vitest-environment jsdom
/**
 * T3, T4, T5, T6, T7 (regression reproducers) and T13's drop-up half: the `dropup` variant is a menu of radio items that ends
 * with the Persona settings entry, binds the choice to the shown chat only, checks exactly one entry, opens Settings after focus
 * has returned to the opener, and takes arrow keys. Before the variant existed the picker was a dialog sheet with pressed
 * buttons and no settings entry.
 * T3b (compatibility guard, passes before and after): the sheet variant keeps its dialog role, its heading and has no settings entry.
 * T4's Escape half is a compatibility guard through ShellSheet.
 * REAL: PersonaSheet, ShellSheet, ShellComposer, ExtrasStrip, the language table. MOCKED: stores (with settings stores), process modules.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { get } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import * as drafts from '../../ts/process/composerDrafts.svelte'
import { resetLocalDraftsForTest } from '../../ts/localDrafts'
import { resetBackHandlersForTests } from '../../ts/backHandlers'
import { firstIndexOf } from '../../ts/settingsShell/settingsPages'
import { DBState, SettingsMenuIndex, settingsOpen } from '../../ts/stores.svelte'

const { LONG_NAME } = vi.hoisted(() => ({ LONG_NAME: 'N'.repeat(60) }))

vi.mock('../../ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    const DBState = $state({ db: {
        characters: [{ chaId: 'c', name: 'Character', chatPage: 0, chats: [
            { id: 'chat-0', message: [], bindedPersona: '' },
            { id: 'chat-1', message: [], bindedPersona: '' },
        ] }],
        personas: [{ id: 'p1', name: 'Ann' }, { id: 'p2', name: 'Bea' }, { id: 'p3', name: LONG_NAME }],
        selectedPersona: 0,
        sendWithEnter: true, useAutoTranslateInput: false, translator: '', username: 'User', longPressToPopupEditor: false,
        useAutoSuggestions: false, subModel: '', autoSuggestClean: false,
    } as Record<string, unknown> })
    const selIdState = $state({ selId: 0 })
    const popUpEditorStore = $state({ value: '', mode: '', language: '', open: false })
    return { DBState, selIdState, popUpEditorStore, SettingsMenuIndex: writable(-1), settingsOpen: writable(false) }
})
vi.mock('../../ts/alertPrompts', () => ({ pageCovered: () => false }))
vi.mock('../../ts/alertBack', () => ({ closeDialogForBack: () => {} }))
vi.mock('../../ts/caughtErrors', () => ({ recordCaughtError: vi.fn() }))
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

const view = $state({ open: true, variant: 'dropup' as 'dropup' | 'sheet', opener: null as HTMLElement | null })
const onclose = vi.fn(() => { view.open = false })
const mounted: Array<{ app: ReturnType<typeof mount>, target: HTMLElement }> = []
let opener: HTMLButtonElement

beforeEach(() => {
    view.open = true
    view.variant = 'dropup'
    opener = document.createElement('button')
    opener.textContent = 'opener'
    document.body.appendChild(opener)
    opener.focus()
    view.opener = opener
})

afterEach(async () => {
    for (const item of mounted.splice(0).reverse()) { await unmount(item.app); item.target.remove() }
    opener.remove()
    onclose.mockClear()
    resetBackHandlersForTests()
    resetLocalDraftsForTest()
    drafts.resetComposerDraftsForTests()
    for (const chat of DBState.db.characters[0].chats) chat.bindedPersona = ''
    DBState.db.selectedPersona = 0
    DBState.db.username = 'User'
    settingsOpen.set(false)
    SettingsMenuIndex.set(-1)
    vi.unstubAllGlobals()
})

async function showSheet(): Promise<HTMLElement> {
    const { default: PersonaSheet } = await import('./PersonaSheet.svelte')
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted.push({ app: mount(PersonaSheet, { target, props: { get open() { return view.open }, get variant() { return view.variant }, get opener() { return view.opener }, background: [], onclose } }), target })
    flushSync()
    return target
}
const panelOf = (node: HTMLElement) => node.querySelector<HTMLElement>('[data-part="chat-sheet"]')!
const radios = (node: HTMLElement) => Array.from(node.querySelectorAll<HTMLElement>('[role="menuitemradio"]'))
const checked = (node: HTMLElement) => radios(node).filter((item) => item.getAttribute('aria-checked') === 'true').map((item) => item.textContent?.trim())
const pressKey = (key: string) => {
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    flushSync()
}

describe('PersonaSheet dropup variant', () => {
    test('T3: a menu at every width with the default entry, each persona and the settings entry last, no heading, named by aria-label', async () => {
        vi.stubGlobal('innerWidth', 375)
        const node = await showSheet()
        const panel = panelOf(node)
        expect(panel.getAttribute('role')).toBe('menu')
        expect(panel.getAttribute('data-mode')).toBe('wide-menu')
        expect(panel.getAttribute('aria-label')).toBe('Choose persona')
        expect(panel.querySelector('h2')).toBeNull()
        expect(radios(node).map((item) => item.textContent?.trim())).toEqual(['User', 'Ann', 'Bea', LONG_NAME])
        const last = panel.querySelector('[role="menu"] > div')!.lastElementChild!
        expect(last.getAttribute('data-part')).toBe('chat-persona-settings')
        expect(last.getAttribute('role')).toBe('menuitem')
        expect(last.textContent?.trim()).toBe('Persona settings')
    })

    test('T3b: the sheet variant is still a dialog with its heading and has no settings entry', async () => {
        view.variant = 'sheet'
        const node = await showSheet()
        const panel = panelOf(node)
        expect(panel.getAttribute('role')).toBe('dialog')
        expect(panel.querySelector('h2')).not.toBeNull()
        expect(panel.querySelector('[data-part="chat-persona-settings"]')).toBeNull()
        expect(panel.querySelector('[role="menuitemradio"]')).toBeNull()
    })

    test('T4: choosing a persona binds the shown chat only and returns focus to the opener; the default entry clears it', async () => {
        const node = await showSheet()
        radios(node).find((item) => item.textContent?.trim() === 'Bea')!.click()
        flushSync()
        const [shown, other] = DBState.db.characters[0].chats
        expect(shown.bindedPersona).toBe('p2')
        expect(other.bindedPersona).toBe('')
        expect(DBState.db.selectedPersona).toBe(0)
        expect(DBState.db.username).toBe('User')
        expect(onclose).toHaveBeenCalledTimes(1)
        await tick()
        expect(document.activeElement).toBe(opener)

        view.open = true
        flushSync()
        radios(node).find((item) => item.textContent?.trim() === 'User')!.click()
        flushSync()
        expect(shown.bindedPersona).toBe('')
        expect(onclose).toHaveBeenCalledTimes(2)
    })

    test('T4 combined: the real composer tab opens the menu, the choice changes the tab text, and focus is on the tab', async () => {
        const { default: ShellComposer } = await import('./ShellComposer.svelte')
        const { default: PersonaSheet } = await import('./PersonaSheet.svelte')
        const target = document.createElement('div')
        document.body.appendChild(target)
        const composer = mount(ShellComposer, { target, props: { onplus: vi.fn(), onpersona: (element: HTMLElement) => { view.opener = element; view.open = true }, get personaexpanded() { return view.open } } })
        const sheet = mount(PersonaSheet, { target, props: { get open() { return view.open }, get variant() { return view.variant }, get opener() { return view.opener }, background: [], onclose } })
        mounted.push({ app: sheet, target: document.createElement('div') }, { app: composer, target })
        view.open = false
        flushSync()
        const tab = target.querySelector<HTMLButtonElement>('[data-part="chat-composer-persona"]')!
        expect(tab.textContent).toContain('as Ann')
        tab.focus()
        tab.click()
        flushSync()
        expect(tab.getAttribute('aria-expanded')).toBe('true')
        const items = Array.from(target.querySelectorAll<HTMLElement>('[role="menuitemradio"]'))
        items.find((item) => item.textContent?.trim() === 'Bea')!.click()
        flushSync()
        await tick()
        expect(tab.textContent).toContain('as Bea')
        expect(tab.getAttribute('aria-expanded')).toBe('false')
        expect(document.activeElement).toBe(tab)
    })

    test('T5: exactly one entry is checked and it takes the initial focus', async () => {
        const node = await showSheet()
        expect(checked(node)).toEqual(['User'])
        expect(document.activeElement?.textContent?.trim()).toBe('User')
        expect(node.querySelectorAll('[data-sheet-initial]')).toHaveLength(1)
        await unmount(mounted.pop()!.app)
        node.remove()

        DBState.db.characters[0].chats[0].bindedPersona = 'p2'
        const bound = await showSheet()
        expect(checked(bound)).toEqual(['Bea'])
        expect(document.activeElement?.textContent?.trim()).toBe('Bea')
        expect(bound.querySelectorAll('[data-sheet-initial]')).toHaveLength(1)
        await unmount(mounted.pop()!.app)
        bound.remove()

        DBState.db.characters[0].chats[0].bindedPersona = 'gone'
        DBState.db.selectedPersona = 1
        const missing = await showSheet()
        expect(checked(missing)).toEqual(['User'])
    })

    test('T6: the settings entry closes the menu, returns focus to the opener, then opens Settings on the Personas page', async () => {
        const node = await showSheet()
        const seen: Array<Element | null> = []
        const stop = settingsOpen.subscribe((value) => { if (value) seen.push(document.activeElement) })
        node.querySelector<HTMLElement>('[data-part="chat-persona-settings"]')!.click()
        await vi.waitFor(() => { flushSync(); expect(get(settingsOpen)).toBe(true) })
        stop()
        expect(onclose).toHaveBeenCalledTimes(1)
        expect(get(SettingsMenuIndex)).toBe(firstIndexOf('personas'))
        expect(seen).toEqual([opener])
    })

    test('T7: arrows wrap, Home and End jump, Escape closes and focus returns to the opener', async () => {
        const node = await showSheet()
        const active = () => document.activeElement?.textContent?.trim()
        expect(active()).toBe('User')
        pressKey('ArrowUp')
        expect(active()).toBe('Persona settings')
        pressKey('ArrowDown')
        expect(active()).toBe('User')
        pressKey('ArrowDown')
        expect(active()).toBe('Ann')
        pressKey('End')
        expect(active()).toBe('Persona settings')
        pressKey('Home')
        expect(active()).toBe('User')
        pressKey('Escape')
        await tick()
        expect(onclose).toHaveBeenCalledTimes(1)
        expect(document.activeElement).toBe(opener)
        expect(node.querySelector('[data-part="chat-sheet"]')).toBeNull()
    })

    test('T7 isolation: the list keys do not reach a listener above the menu, other keys do', async () => {
        await showSheet()
        const seen: string[] = []
        const spy = (event: KeyboardEvent) => { seen.push(event.key) }
        document.addEventListener('keydown', spy)
        try {
            for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End']) pressKey(key)
            expect(seen).toEqual([])
            pressKey('a')
            expect(seen).toEqual(['a'])
        } finally {
            document.removeEventListener('keydown', spy)
        }
    })

    test('T13: a 60-character persona name stays whole in its menu item', async () => {
        const node = await showSheet()
        expect(radios(node).find((item) => item.textContent?.includes(LONG_NAME))?.textContent?.trim()).toBe(LONG_NAME)
    })
})
