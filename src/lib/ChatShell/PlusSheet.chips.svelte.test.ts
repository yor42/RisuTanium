// @vitest-environment jsdom
/**
 * Favourite chips in the + menu (UI-S1b stage E2, TOGGLES_SPEC §5, CHORE-566): with a starred toggle showing, the
 * Toggles item and up to eight chips lead the menu and More opens the panel; a check chip is a menuitemcheckbox that
 * flips the value, a select chip opens its option list and returns to the menu, a text chip opens the panel. Chips read
 * and write only through the scope accessors, so they follow the chat's own scope. Mounts the REAL PlusSheet and
 * ShellSheet with the real favourites store; the stars are written the way the real store writes them.
 * Guards by construction: the chips are new.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi, type Mock } from 'vitest'
import type { Chat } from 'src/ts/storage/database.svelte'

const h = vi.hoisted(() => ({
    db: {} as Record<string, unknown>,
    mark: vi.fn(),
    modules: [] as { id: string, name: string, customModuleToggle?: string }[],
}))

vi.mock('src/ts/stores.svelte', async () => {
    const { writable: store } = await import('svelte/store')
    return {
        DBState: { get db() { return h.db } },
        selIdState: { selId: 0 },
        selectedCharID: store(0),
        ReloadGUIPointer: store(0),
        additionalChatMenu: [],
        easyPanelStore: { open: false },
        hypaV3ModalOpen: store(false),
    }
})
vi.mock('../../ts/stores.svelte', async () => {
    const { writable: store } = await import('svelte/store')
    return {
        DBState: { get db() { return h.db } },
        selIdState: { selId: 0 },
        selectedCharID: store(0),
        ReloadGUIPointer: store(0),
        additionalChatMenu: [],
        easyPanelStore: { open: false },
        hypaV3ModalOpen: store(false),
    }
})
vi.mock('src/ts/storage/database.svelte', () => ({ appVer: '1', getCurrentCharacter: () => undefined, getCurrentChat: () => undefined, getDatabase: () => h.db }))
vi.mock('src/ts/globalApi.svelte', () => ({ aiWatermarkingLawApplies: () => false, getFileSrc: () => Promise.resolve(''), readImage: () => Promise.resolve(undefined), downloadFile: vi.fn() }))
vi.mock('../../ts/globalApi.svelte', () => ({ aiWatermarkingLawApplies: () => false, getFileSrc: () => Promise.resolve(''), readImage: () => Promise.resolve(undefined), downloadFile: vi.fn() }))
vi.mock('src/ts/storage/characterSaveMarks', () => ({ markCharacterForSave: (chaId: string) => h.mark(chaId) }))
vi.mock('../../ts/storage/characterSaveMarks', () => ({ markCharacterForSave: (chaId: string) => h.mark(chaId) }))
vi.mock('src/ts/process/modules', () => ({
    getModuleToggles: () => h.modules.map((module) => module.customModuleToggle ?? '').join('\n'),
    getModules: () => h.modules,
}))
vi.mock('../../ts/process/modules', () => ({
    getModuleToggles: () => h.modules.map((module) => module.customModuleToggle ?? '').join('\n'),
    getModules: () => h.modules,
}))
vi.mock('../../ts/storage/pageStorageMode', async () => {
    const { writable: store } = await import('svelte/store')
    return { pageStorageModeStore: store({ kind: 'store2' }) }
})
vi.mock('../Utility/utilityGate', async () => {
    const { writable: store } = await import('svelte/store')
    return { utilityVisible: () => false, utilityOpen: store(false) }
})
vi.mock('../../ts/process/composerActions.svelte', () => ({ sendContinue: vi.fn(async () => {}), reroll: vi.fn(async () => {}) }))
vi.mock('../../ts/chatShell/sendFailure.svelte', () => ({ shellGenerationSource: (closeMenu: () => void) => ({ closeMenu }) }))
vi.mock('../../ts/process/tts', () => ({ stopTTS: vi.fn() }))
vi.mock('../../ts/process/ttsModes', () => ({ canChatSpeak: () => false }))
vi.mock('../../ts/alert', () => ({ showHypaV2Alert: vi.fn(), alertWait: vi.fn(), alertNormal: vi.fn(), alertError: vi.fn() }))
vi.mock('../../ts/exportNotice', () => ({ downloadNotice: (message: string) => message }))
vi.mock('../Others/PluginDefinedIcon.svelte', () => ({ default: () => ({}) }))
vi.mock('../../ts/alertBack', () => ({ closeDialogForBack: vi.fn() }))
vi.mock('../../ts/alertPrompts', () => ({ pageCovered: () => false }))
vi.mock('../../ts/caughtErrors', () => ({ recordCaughtError: vi.fn() }))
const languageMock = vi.hoisted(() => {
    const fns: Record<string, unknown> = {
        chatShellTogglesSummary: (n: number, on: number) => `sum:${n}:${on}`,
        chatShellTogglesOnA11y: (label: string) => `on:${label}`,
        chatShellTogglesOffA11y: (label: string) => `off:${label}`,
        chatShellTogglesPickTitle: (label: string) => `picktitle:${label}`,
        chatShellTogglesPicked: (label: string, value: string) => `picked:${label}:${value}`,
        alerts: { screenshotTaking: 'Taking screenshot', screenshotMerging: 'Merging' },
        errors: { screenshotFailed: 'Screenshot failed' },
    }
    return { language: new Proxy({} as Record<string, unknown>, { get: (target, key) => key in target ? target[key as string] : key in fns ? fns[key as string] : String(key) }) }
})
vi.mock('src/lang', () => languageMock)
vi.mock('../../lang', () => languageMock)

import PlusSheet from './PlusSheet.svelte'
import { resetTogglePanelSession } from '../../ts/chatShell/togglePanel'
import { FAVOURITES_KEY, type FavouriteRef } from '../../ts/chatShell/toggleFavourites'
import { syncFavourites } from '../../ts/chatShell/toggleFavouritesStore.svelte'
import { dispatchBack, resetBackHandlersForTests } from '../../ts/backHandlers'

type Owner = { chaId: string, name: string, type: 'character', chatPage: number, chats: Chat[], customModuleToggle?: string }

const makeChat = (extra: Partial<Chat> = {}): Chat => ({ message: [{ role: 'user', data: '' }, { role: 'char', data: '' }], note: '', name: 'Harbour night', localLore: [], id: 'chat-1', modules: [], ...extra }) as Chat

let mounted: ReturnType<typeof mount> | undefined
let owner: Owner
let chat: Chat
let target: HTMLElement
const view = $state<{ open: boolean, ontoggles: (() => void) | undefined }>({ open: true, ontoggles: undefined })
let ontoggles: Mock<() => void>

const sharedValues = () => h.db.globalChatVariables as Record<string, string>
const ref = (s: string, k: string): FavouriteRef => ({ s, k })
const seed = (items: FavouriteRef[]) => {
    localStorage.setItem(FAVOURITES_KEY, JSON.stringify({ v: 1, items }))
    syncFavourites()
}

function install(options: { prompt?: string, character?: string, modules?: typeof h.modules, shared?: Record<string, string> } = {}): void {
    chat = makeChat()
    owner = { chaId: 'char-a', name: 'Ari', type: 'character', chatPage: 0, chats: [chat], customModuleToggle: options.character }
    h.modules = options.modules ?? []
    h.db = {
        characters: [owner], customPromptTemplateToggle: options.prompt ?? '', globalChatVariables: { ...(options.shared ?? {}) },
        botPresets: [{ name: 'Preset One' }], botPresetsId: 0, jailbreakToggle: false,
        useChatSticker: false, showMenuChatList: false, enableRisuaiProTools: false,
        showMenuHypaMemoryModal: false, supaModelType: 'none', hypav2: false, hypaV3: false, sideMenuRerollButton: false,
    }
}

// Four toggles in the prompt (a check, a check, a select, a text), two in a module and one on the character.
function installAll(): void {
    install({
        prompt: 'tone=Tone\nscene=Scene\nmood=Mood=select=Calm,Bold\nnote=Note=text',
        modules: [{ id: 'm1', name: 'Cards', customModuleToggle: 'deck=Card deck\nextras=Extras' }],
        character: 'plain=Plain',
    })
}

async function show(): Promise<HTMLElement> {
    mounted = mount(PlusSheet, {
        target,
        props: {
            get open() { return view.open },
            opener: null,
            background: [],
            onclose: () => { view.open = false },
            onstickers: vi.fn(),
            onchatlist: vi.fn(),
            onmodules: vi.fn(),
            get ontoggles() { return view.ontoggles },
            togglesSummary: () => '7 toggles · 0 on',
        },
    })
    flushSync()
    // The chips load their sources with a dynamic import, already cached here: one macrotask lets it land.
    await new Promise((resolve) => setTimeout(resolve, 20))
    await settle()
    return target
}

const items = () => Array.from(target.querySelectorAll<HTMLElement>('[role^="menuitem"]'))
const chips = () => Array.from(target.querySelectorAll<HTMLElement>('[data-part="plus-chip"]'))
const chipOf = (key: string) => target.querySelector<HTMLElement>(`[data-part="plus-chip"][data-key="${key}"]`)
const settle = async () => { flushSync(); await tick(); await tick() }

beforeAll(async () => {
    await import('./TogglesPanel.svelte')
    await import('../../ts/parser/chatToggleScope')
}, 120_000)

beforeEach(() => {
    localStorage.clear()
    resetTogglePanelSession()
    resetBackHandlersForTests()
    h.mark.mockClear()
    target = document.createElement('div')
    document.body.appendChild(target)
    ontoggles = vi.fn()
    view.open = true
    view.ontoggles = () => { ontoggles() }
    installAll()
    syncFavourites()
})

afterEach(async () => {
    if (mounted) await unmount(mounted)
    mounted = undefined
    target.remove()
    localStorage.clear()
    syncFavourites()
})

describe('favourite chips in the + menu', () => {
    test('without a star the Toggles item is last and there is no chip area', async () => {
        await show()
        expect(chips()).toHaveLength(0)
        expect(target.querySelector('[data-part="plus-chips"]')).toBeNull()
        expect(items().at(-1)?.getAttribute('data-item')).toBe('toggles')
    })

    test('with stars the Toggles item and the chips lead the menu, in star order, with the group named', async () => {
        seed([ref('prompt', 'mood'), ref('module:m1', 'deck'), ref('prompt', 'tone')])
        await show()
        const all = items()
        expect(all[0].getAttribute('data-item')).toBe('toggles')
        expect(all.filter((item) => item.getAttribute('data-item') === 'toggles')).toHaveLength(1)
        expect(chips().map((chip) => chip.getAttribute('data-key'))).toEqual(['mood', 'deck', 'tone'])
        // The chips follow the Toggles item directly, before Continue and the other rows.
        expect(all.slice(0, 4).map((item) => item.getAttribute('data-part'))).toEqual(['chat-sheet-item', 'plus-chip', 'plus-chip', 'plus-chip'])
        const group = target.querySelector('[data-part="plus-chips"]')!
        expect(group.getAttribute('role')).toBe('group')
        expect(group.getAttribute('aria-label')).toBe('chatShellTogglesChipsHead')
        expect(items().some((item) => item.textContent === 'continueResponse')).toBe(true)
    })

    test('the first menu entry takes the initial focus when stars lead the menu', async () => {
        seed([ref('prompt', 'tone')])
        view.open = false
        await show()
        view.open = true
        await settle()
        expect(target.querySelectorAll('[data-sheet-initial]')).toHaveLength(1)
        expect(items()[0].hasAttribute('data-sheet-initial')).toBe(true)
        expect(document.activeElement).toBe(items()[0])
    })

    test('at most eight chips show and More opens the panel and closes the menu', async () => {
        const toggles = Array.from({ length: 11 }, (_, index) => `k${index}=Toggle ${index}`).join('\n')
        install({ prompt: toggles })
        seed(Array.from({ length: 11 }, (_, index) => ref('prompt', `k${index}`)))
        await show()
        expect(chips()).toHaveLength(8)
        expect(chips().map((chip) => chip.getAttribute('data-key'))).toEqual(Array.from({ length: 8 }, (_, index) => `k${index}`))
        const more = target.querySelector<HTMLElement>('[data-part="plus-chip-more"]')!
        expect(more.getAttribute('role')).toBe('menuitem')
        more.click()
        expect(ontoggles).toHaveBeenCalledOnce()
        expect(view.open).toBe(false)
    })

    test('exactly eight stars show eight chips and no More', async () => {
        const toggles = Array.from({ length: 8 }, (_, index) => `k${index}=Toggle ${index}`).join('\n')
        install({ prompt: toggles })
        seed(Array.from({ length: 8 }, (_, index) => ref('prompt', `k${index}`)))
        await show()
        expect(chips()).toHaveLength(8)
        expect(target.querySelector('[data-part="plus-chip-more"]')).toBeNull()
    })

    test('a star whose source is not in use gives no chip and is kept; with nothing showing the item is last again', async () => {
        seed([ref('module:gone', 'deck'), ref('prompt', 'missing')])
        await show()
        expect(chips()).toHaveLength(0)
        expect(target.querySelector('[data-part="plus-chips"]')).toBeNull()
        expect(items().at(-1)?.getAttribute('data-item')).toBe('toggles')
        expect(JSON.parse(localStorage.getItem(FAVOURITES_KEY)!).items).toEqual([ref('module:gone', 'deck'), ref('prompt', 'missing')])
    })

    test('without a way to open the panel there are no chips', async () => {
        seed([ref('prompt', 'tone')])
        view.ontoggles = undefined
        await show()
        expect(chips()).toHaveLength(0)
        expect(target.querySelector('[data-item="toggles"]')).toBeNull()
    })

    test('a check chip is a menuitemcheckbox that shows the value and flips it without closing the menu', async () => {
        seed([ref('prompt', 'tone'), ref('prompt', 'scene')])
        sharedValues().toggle_scene = '1'
        await show()
        const tone = chipOf('tone')!
        const scene = chipOf('scene')!
        expect(tone.getAttribute('role')).toBe('menuitemcheckbox')
        expect(tone.getAttribute('aria-checked')).toBe('false')
        expect(scene.getAttribute('aria-checked')).toBe('true')
        tone.click()
        await settle()
        expect(sharedValues().toggle_tone).toBe('1')
        expect(h.mark).toHaveBeenCalledWith('char-a')
        expect(chipOf('tone')!.getAttribute('aria-checked')).toBe('true')
        expect(view.open).toBe(true)
        expect(target.querySelector('[data-part="plus-live"]')?.textContent).toBe('on:Tone')
        chipOf('tone')!.click()
        await settle()
        expect(sharedValues().toggle_tone).toBe('0')
        expect(chipOf('tone')!.getAttribute('aria-checked')).toBe('false')
        expect(target.querySelector('[data-part="plus-live"]')?.textContent).toBe('off:Tone')
    })

    test('chips follow the chat scope: a chat-only switch writes the chat and not the shared value', async () => {
        seed([ref('prompt', 'tone')])
        chat.useLocallySetGlobalVariables = true
        chat.GLGlobalVariables = {}
        sharedValues().toggle_tone = '0'
        await show()
        chipOf('tone')!.click()
        await settle()
        expect(chat.GLGlobalVariables.toggle_tone).toBe('1')
        expect(sharedValues().toggle_tone).toBe('0')
        expect(chipOf('tone')!.getAttribute('aria-checked')).toBe('true')
        // A chat that holds its own value shows it even while the shared one differs.
        expect(h.mark).toHaveBeenCalledWith('char-a')
    })

    test('a select chip shows "label: value", opens its option list in the menu and returns to it with the pick written', async () => {
        seed([ref('prompt', 'mood')])
        await show()
        const mood = chipOf('mood')!
        expect(mood.getAttribute('role')).toBe('menuitem')
        expect(mood.getAttribute('aria-haspopup')).toBe('menu')
        expect(mood.textContent).toContain('Mood: Calm')
        mood.focus()
        mood.click()
        await settle()
        const group = target.querySelector('[data-part="plus-chip-options"]')!
        expect(group.getAttribute('aria-label')).toBe('picktitle:Mood')
        const options = Array.from(group.querySelectorAll<HTMLElement>('[role="menuitemradio"]'))
        expect(options.map((option) => option.querySelector('span')?.textContent)).toEqual(['Calm', 'Bold'])
        expect(options.map((option) => option.getAttribute('aria-checked'))).toEqual(['true', 'false'])
        // The list replaces the menu; nothing of the menu is left to tab to.
        expect(chips()).toHaveLength(0)
        options[1].click()
        await settle()
        expect(sharedValues().toggle_mood).toBe('1')
        expect(h.mark).toHaveBeenCalledWith('char-a')
        expect(view.open).toBe(true)
        expect(target.querySelector('[data-part="plus-chip-options"]')).toBeNull()
        expect(chipOf('mood')!.textContent).toContain('Mood: Bold')
        expect(document.activeElement).toBe(chipOf('mood'))
        expect(target.querySelector('[data-part="plus-live"]')?.textContent).toBe('picked:Mood:Bold')
    })

    test('Escape and Back leave the option list for the menu first, and only then close the menu', async () => {
        seed([ref('prompt', 'mood')])
        await show()
        chipOf('mood')!.click()
        await settle()
        expect(target.querySelector('[data-part="plus-chip-options"]')).not.toBeNull()
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
        await settle()
        expect(target.querySelector('[data-part="plus-chip-options"]')).toBeNull()
        expect(chipOf('mood')).not.toBeNull()
        expect(view.open).toBe(true)
        expect(sharedValues().toggle_mood).toBeUndefined()
        expect(document.activeElement).toBe(chipOf('mood'))

        chipOf('mood')!.click()
        await settle()
        expect(dispatchBack()).toBe(true)
        await settle()
        expect(target.querySelector('[data-part="plus-chip-options"]')).toBeNull()
        expect(view.open).toBe(true)
        expect(dispatchBack()).toBe(true)
        await settle()
        expect(view.open).toBe(false)
    })

    test('a text chip opens the panel and closes the menu', async () => {
        seed([ref('prompt', 'note')])
        await show()
        const note = chipOf('note')!
        expect(note.getAttribute('role')).toBe('menuitem')
        expect(note.getAttribute('aria-haspopup')).toBe('dialog')
        note.click()
        expect(ontoggles).toHaveBeenCalledOnce()
        expect(view.open).toBe(false)
    })

    test('the arrow keys walk the Toggles item and the chips, and Tab closes the menu', async () => {
        seed([ref('prompt', 'tone'), ref('prompt', 'scene')])
        await show()
        const all = items()
        all[0].focus()
        all[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
        expect(document.activeElement).toBe(chipOf('tone'))
        chipOf('tone')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
        expect(document.activeElement).toBe(chipOf('scene'))
        chipOf('scene')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
        await settle()
        expect(view.open).toBe(false)
    })

    test('the chip area follows the stars: adding one while the menu is closed shows it on the next opening', async () => {
        await show()
        expect(chips()).toHaveLength(0)
        view.open = false
        await settle()
        seed([ref('prompt', 'tone')])
        await new Promise((resolve) => setTimeout(resolve, 20))
        view.open = true
        await settle()
        expect(chips().map((chip) => chip.getAttribute('data-key'))).toEqual(['tone'])
    })

    test('a star written by another tab is adopted when the menu opens', async () => {
        view.open = false
        await show()
        localStorage.setItem(FAVOURITES_KEY, JSON.stringify({ v: 1, items: [ref('prompt', 'scene')] }))
        view.open = true
        await settle()
        await new Promise((resolve) => setTimeout(resolve, 20))
        await settle()
        expect(chips().map((chip) => chip.getAttribute('data-key'))).toEqual(['scene'])
    })

    test('a menu closed over the option list opens again on the menu itself, with nothing announced', async () => {
        seed([ref('prompt', 'mood'), ref('prompt', 'tone')])
        await show()
        chipOf('tone')!.click()
        await settle()
        chipOf('mood')!.click()
        await settle()
        expect(target.querySelector('[data-part="plus-chip-options"]')).not.toBeNull()
        view.open = false
        await settle()
        view.open = true
        await settle()
        expect(target.querySelector('[data-part="plus-chip-options"]')).toBeNull()
        expect(chips()).toHaveLength(2)
        expect(target.querySelector('[data-part="plus-live"]')?.textContent).toBe('')
    })

    test('starring and tapping chips changes no stored profile data except the toggle value', async () => {
        seed([ref('prompt', 'tone')])
        await show()
        const before = JSON.stringify({ ...h.db, globalChatVariables: undefined })
        chipOf('tone')!.click()
        await settle()
        expect(JSON.stringify({ ...h.db, globalChatVariables: undefined })).toBe(before)
        expect(sharedValues()).toEqual({ toggle_tone: '1' })
    })
})
