// @vitest-environment jsdom
/**
 * The toggles panel opened at a row (UI-S1b toggles follow-up, TOGGLES_SPEC §5): a text or textarea chip of the + menu
 * opens the panel with the Favourites copy of that row focused and outlined; every other opening, a star that is not
 * showing and a star that is not a text row keep the title focus and outline nothing; opening at a row writes nothing.
 * The panel also takes the side presentation whatever the width at mount, so a resize while it is open is followed by
 * the stylesheet. Mounts the REAL TogglesPanel, ToggleRow and ShellSheet with the real favourites store.
 */
import { flushSync, mount, unmount } from 'svelte'
import { tickFake } from '../../ts/tests/svelteTick.test-helpers'
import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from 'vitest'
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
    }
})
vi.mock('src/ts/storage/database.svelte', () => ({ appVer: '1', getCurrentCharacter: () => undefined, getCurrentChat: () => undefined, getDatabase: () => h.db }))
vi.mock('src/ts/globalApi.svelte', () => ({ aiWatermarkingLawApplies: () => false, getFileSrc: () => Promise.resolve(''), readImage: () => Promise.resolve(undefined) }))
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
vi.mock('../../ts/alertPrompts', () => ({ pageCovered: () => false }))
vi.mock('../../ts/alertBack', () => ({ closeDialogForBack: vi.fn() }))
vi.mock('../../ts/caughtErrors', () => ({ recordCaughtError: vi.fn() }))
const languageMock = vi.hoisted(() => {
    const fns: Record<string, unknown> = {
        chatShellTogglesSummary: (n: number, on: number) => `sum:${n}:${on}`,
        chatShellTogglesOnA11y: (label: string) => `on:${label}`,
        chatShellTogglesOffA11y: (label: string) => `off:${label}`,
        chatShellTogglesMenu: (label: string) => `menu:${label}`,
        chatShellTogglesDupMismatch: (source: string) => `mismatch:${source}`,
        chatShellTogglesSameValue: (source: string) => `same:${source}`,
        chatShellTogglesTextSaved: (label: string) => `textsaved:${label}`,
        chatShellTogglesPicked: (label: string, value: string) => `picked:${label}:${value}`,
        chatShellTogglesResetDone: (label: string) => `resetdone:${label}`,
        chatShellTogglesRevertDone: (label: string) => `revertdone:${label}`,
        chatShellTogglesPickTitle: (label: string) => `picktitle:${label}`,
        chatShellTogglesEditTitle: (label: string) => `edittitle:${label}`,
        chatShellTogglesResults: (shown: number, total: number) => `results:${shown}:${total}`,
        chatShellTogglesCountLive: (shown: number) => `live:${shown}`,
        chatShellTogglesOption: (option: string) => `option:${option}`,
        chatShellTogglesStarred: (label: string) => `starred:${label}`,
        chatShellTogglesUnstarred: (label: string) => `unstarred:${label}`,
        chatShellTogglesMovedTo: (label: string, position: number, total: number) => `moved:${label}:${position}:${total}`,
    }
    return { language: new Proxy({} as Record<string, unknown>, { get: (target, key) => key in target ? target[key as string] : key in fns ? fns[key as string] : String(key) }) }
})
vi.mock('src/lang', () => languageMock)
vi.mock('../../lang', () => languageMock)

import TogglesPanel from './TogglesPanel.svelte'
import { resetTogglePanelSession } from '../../ts/chatShell/togglePanel'
import { FAVOURITES_KEY, UNREADABLE_KEY, type FavouriteRef } from '../../ts/chatShell/toggleFavourites'
import { syncFavourites } from '../../ts/chatShell/toggleFavouritesStore.svelte'
import { resetBackHandlersForTests } from '../../ts/backHandlers'

type Owner = { chaId: string, name: string, type: 'character', chatPage: number, chats: Chat[], customModuleToggle?: string }

const makeChat = (extra: Partial<Chat> = {}): Chat => ({ message: [], note: '', name: 'Harbour night', localLore: [], id: 'chat-1', ...extra }) as Chat

let mounted: ReturnType<typeof mount> | undefined
let owner: Owner
let chat: Chat
let opener: HTMLButtonElement
const view = $state<{ open: boolean, openAt: FavouriteRef | null }>({ open: true, openAt: null })
let onclose: Mock<() => void>
const originalWidth = window.innerWidth

const ref = (s: string, k: string): FavouriteRef => ({ s, k })
const seed = (items: FavouriteRef[]) => {
    localStorage.setItem(FAVOURITES_KEY, JSON.stringify({ v: 1, items }))
    syncFavourites()
}
const setWidth = (width: number) => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width })
    window.dispatchEvent(new Event('resize'))
}

function install(): void {
    chat = makeChat()
    owner = { chaId: 'char-a', name: 'Ari', type: 'character', chatPage: 0, chats: [chat] }
    h.modules = []
    h.db = {
        characters: [owner], customPromptTemplateToggle: 'tone=Tone\nnote=Note=text\nmemo=Memo=textarea', globalChatVariables: { toggle_tone: '1' },
        botPresets: [{ name: 'Preset One' }], botPresetsId: 0, jailbreakToggle: false,
    }
}

async function show(options: { open?: boolean } = {}): Promise<HTMLElement> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    view.open = options.open ?? true
    mounted = mount(TogglesPanel, {
        target,
        props: {
            get open() { return view.open },
            get openAt() { return view.openAt },
            opener,
            target: { owner: owner as never, chat },
            onclose: () => { onclose(); view.open = false },
        },
    })
    flushSync()
    await settle()
    return target
}

async function settle(ms = 120): Promise<void> {
    vi.advanceTimersByTime(ms)
    flushSync()
    await tickFake()
}

const q = (target: ParentNode, selector: string) => target.querySelector<HTMLElement>(selector)
const all = (target: ParentNode, selector: string) => Array.from(target.querySelectorAll<HTMLElement>(selector))
const FAV = '[data-part="toggles-favourites"]'
const favText = (target: ParentNode, key: string) => q(target, `${FAV} [data-part="toggle-row"][data-key="${key}"] [data-part="toggle-text-button"]`)
const title = (target: ParentNode) => q(target, '[data-part="toggles-title"]')
const outlined = (target: ParentNode) => all(target, '[data-opened-at]')
const initials = (target: ParentNode) => all(target, '[data-sheet-initial]')

function escape(): void {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
}

beforeEach(() => {
    vi.useFakeTimers()
    localStorage.removeItem(FAVOURITES_KEY)
    localStorage.removeItem(UNREADABLE_KEY)
    syncFavourites()
    resetTogglePanelSession()
    resetBackHandlersForTests()
    h.mark.mockClear()
    onclose = vi.fn()
    view.openAt = null
    opener = document.createElement('button')
    document.body.appendChild(opener)
    install()
})

afterEach(async () => {
    if (mounted) await unmount(mounted)
    mounted = undefined
    document.body.replaceChildren()
    vi.useRealTimers()
    vi.restoreAllMocks()
    localStorage.removeItem(FAVOURITES_KEY)
    localStorage.removeItem(UNREADABLE_KEY)
    syncFavourites()
    setWidth(originalWidth)
})

describe('opened at a text row', () => {
    test('P1: a text star focuses the Favourites copy of its text button and outlines that row only', async () => {
        seed([ref('prompt', 'note')])
        view.openAt = ref('prompt', 'note')
        const target = await show()
        const button = favText(target, 'note')
        expect(button).not.toBeNull()
        expect(document.activeElement).toBe(button)
        expect(initials(target)).toEqual([button])
        expect(outlined(target)).toHaveLength(1)
        expect(outlined(target)[0].closest(FAV)).not.toBeNull()
        expect(outlined(target)[0].getAttribute('data-key')).toBe('note')
    })

    test('P2: a textarea star does the same', async () => {
        seed([ref('prompt', 'memo')])
        view.openAt = ref('prompt', 'memo')
        const target = await show()
        const button = favText(target, 'memo')
        expect(button).not.toBeNull()
        expect(document.activeElement).toBe(button)
        expect(initials(target)).toEqual([button])
        expect(outlined(target)).toHaveLength(1)
    })
})

describe('openings that keep the title focus', () => {
    test('P3: no row handed over focuses the title and outlines nothing', async () => {
        seed([ref('prompt', 'note')])
        const target = await show()
        expect(document.activeElement).toBe(title(target))
        expect(initials(target)).toEqual([title(target)])
        expect(outlined(target)).toHaveLength(0)
    })

    test('P4: a star whose source is gone focuses the title, outlines nothing and stays stored', async () => {
        seed([ref('module:gone', 'x'), ref('prompt', 'note')])
        const before = localStorage.getItem(FAVOURITES_KEY)
        view.openAt = ref('module:gone', 'x')
        const target = await show()
        expect(document.activeElement).toBe(title(target))
        expect(initials(target)).toEqual([title(target)])
        expect(outlined(target)).toHaveLength(0)
        expect(localStorage.getItem(FAVOURITES_KEY)).toBe(before)
    })

    test('P5: a check star focuses the title, outlines nothing', async () => {
        seed([ref('prompt', 'tone')])
        view.openAt = ref('prompt', 'tone')
        const target = await show()
        expect(document.activeElement).toBe(title(target))
        expect(initials(target)).toEqual([title(target)])
        expect(outlined(target)).toHaveLength(0)
    })

    test('P6: reopening with no row after an opening at a row focuses the title and outlines nothing', async () => {
        seed([ref('prompt', 'note')])
        view.openAt = ref('prompt', 'note')
        const target = await show()
        escape()
        await settle()
        expect(view.open).toBe(false)
        view.openAt = null
        view.open = true
        await settle()
        expect(document.activeElement).toBe(title(target))
        expect(initials(target)).toEqual([title(target)])
        expect(outlined(target)).toHaveLength(0)
    })
})

describe('opening at a row writes nothing', () => {
    test('P7: no save mark, no stored change, and Escape returns focus to the opener', async () => {
        seed([ref('prompt', 'note')])
        const storedBefore = localStorage.getItem(FAVOURITES_KEY)
        const sharedBefore = JSON.stringify(h.db.globalChatVariables)
        opener.focus()
        view.openAt = ref('prompt', 'note')
        await show()
        escape()
        await settle()
        expect(onclose).toHaveBeenCalledTimes(1)
        expect(document.activeElement).toBe(opener)
        expect(h.mark).not.toHaveBeenCalled()
        expect(localStorage.getItem(FAVOURITES_KEY)).toBe(storedBefore)
        expect(JSON.stringify(h.db.globalChatVariables)).toBe(sharedBefore)
    })
})

describe('the side presentation follows the window', () => {
    test('P8: mounted narrow, widened while closed, the opened layer and sheet are in side mode', async () => {
        setWidth(600)
        const target = await show({ open: false })
        setWidth(1280)
        view.open = true
        await settle()
        expect(q(target, '[data-part="chat-sheet-layer"]')!.getAttribute('data-mode')).toBe('side')
        expect(q(target, '[data-part="chat-sheet"]')!.getAttribute('data-mode')).toBe('side')
    })
})
