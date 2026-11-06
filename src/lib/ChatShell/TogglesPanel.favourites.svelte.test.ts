// @vitest-environment jsdom
/**
 * Favourite toggles in the toggles panel (UI-S1b stage E1, TOGGLES_SPEC §5, CHORE-566): the star entry of the row
 * menu, the Favourites section in star order with move up / down, the star mark on source rows, stars of absent
 * sources kept but hidden, the section hidden while a search or the filter is active, the prompt slot that follows the
 * active preset, and the MC-350 rules for a stored value this build cannot read. Mounts the REAL TogglesPanel,
 * ToggleRow and ShellSheet with the real favourites store. Guards by construction: the controls are new.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
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
import { currentFavourites, syncFavourites } from '../../ts/chatShell/toggleFavouritesStore.svelte'
import { resetBackHandlersForTests } from '../../ts/backHandlers'

type Owner = { chaId: string, name: string, type: 'character', chatPage: number, chats: Chat[], customModuleToggle?: string }

const makeChat = (extra: Partial<Chat> = {}): Chat => ({ message: [], note: '', name: 'Harbour night', localLore: [], id: 'chat-1', ...extra }) as Chat

let mounted: ReturnType<typeof mount> | undefined
let owner: Owner
let chat: Chat
let opener: HTMLButtonElement
const view = $state({ open: true })
let onclose: Mock<() => void>

const sharedValues = () => h.db.globalChatVariables as Record<string, string>
const ref = (s: string, k: string): FavouriteRef => ({ s, k })
const seed = (items: FavouriteRef[]) => localStorage.setItem(FAVOURITES_KEY, JSON.stringify({ v: 1, items }))
const storedItems = (): FavouriteRef[] => JSON.parse(localStorage.getItem(FAVOURITES_KEY)!).items

function install(options: { prompt?: string, character?: string, modules?: typeof h.modules, shared?: Record<string, string> } = {}): void {
    chat = makeChat()
    owner = { chaId: 'char-a', name: 'Ari', type: 'character', chatPage: 0, chats: [chat], customModuleToggle: options.character }
    h.modules = options.modules ?? []
    h.db = {
        characters: [owner], customPromptTemplateToggle: options.prompt ?? '', globalChatVariables: { ...(options.shared ?? {}) },
        botPresets: [{ name: 'Preset One' }, { name: 'Preset Two' }], botPresetsId: 0, jailbreakToggle: false,
    }
}

// Four toggles in the prompt, two in a module (one inside a group) and one on the character: the order the panel shows.
function installAll(): void {
    install({
        prompt: 'tone=Tone\nscene=Scene\nmood=Mood=select=Calm,Bold\nnote=Note=text',
        modules: [{ id: 'm1', name: 'Cards', customModuleToggle: 'deck=Card deck\nextras=Extras=group\ninner=Inner switch\nend=end=groupEnd' }],
        character: 'plain=Plain',
    })
}

async function show(): Promise<HTMLElement> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    view.open = true
    mounted = mount(TogglesPanel, {
        target,
        props: {
            get open() { return view.open },
            opener,
            target: { owner: owner as never, chat },
            onclose: () => { onclose(); view.open = false },
        },
    })
    flushSync()
    await tick()
    return target
}

const q = (target: ParentNode, selector: string) => target.querySelector<HTMLElement>(selector)
const all = (target: ParentNode, selector: string) => Array.from(target.querySelectorAll<HTMLElement>(selector))
const FAV = '[data-part="toggles-favourites"]'
const favKeys = (target: ParentNode) => all(target, `${FAV} [data-part="toggle-row"]`).map((element) => element.getAttribute('data-key'))
const sourceRow = (target: ParentNode, source: string, key: string) => q(target, `[data-part="toggles-section"][data-source="${source}"] [data-part="toggle-row"][data-key="${key}"]`)!
const favRow = (target: ParentNode, key: string) => q(target, `${FAV} [data-part="toggle-row"][data-key="${key}"]`)!

async function openMenu(row: HTMLElement): Promise<void> {
    q(row, '[data-part="toggle-menu-button"]')!.click()
    flushSync()
    await tick()
}

async function choose(row: HTMLElement, part: string): Promise<void> {
    await openMenu(row)
    q(row, `[data-part="${part}"]`)!.click()
    flushSync()
    await tick()
}

function type(target: ParentNode, text: string): void {
    const field = q(target, '[data-part="toggles-search-input"]') as HTMLInputElement
    field.value = text
    field.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
}

async function settle(ms = 120): Promise<void> {
    vi.advanceTimersByTime(ms)
    flushSync()
    await tick()
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
    opener = document.createElement('button')
    document.body.appendChild(opener)
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
})

describe('starring from the row menu', () => {
    test('no section while nothing is starred; the menu offers the star entry', async () => {
        installAll()
        const target = await show()
        expect(q(target, FAV)).toBeNull()
        await openMenu(sourceRow(target, 'prompt', 'tone'))
        expect(q(sourceRow(target, 'prompt', 'tone'), '[data-part="toggle-star"]')!.textContent).toBe('chatShellTogglesStar')
        expect(q(sourceRow(target, 'prompt', 'tone'), '[data-part="toggle-move-up"]')).toBeNull()
    })

    test('starring adds the section, keeps the source row, marks it and stores the star by source and key', async () => {
        installAll()
        const target = await show()
        await choose(sourceRow(target, 'prompt', 'scene'), 'toggle-star')
        expect(favKeys(target)).toEqual(['scene'])
        expect(q(sourceRow(target, 'prompt', 'scene'), '[data-part="toggle-star-mark"]')).not.toBeNull()
        expect(q(sourceRow(target, 'prompt', 'tone'), '[data-part="toggle-star-mark"]')).toBeNull()
        expect(q(favRow(target, 'scene'), '[data-part="toggle-star-mark"]')).toBeNull()
        expect(storedItems()).toEqual([ref('prompt', 'scene')])
        expect(q(target, '[data-part="toggles-announce"]')!.textContent).toBe('starred:Scene')
    })

    test('the section lists stars in the order they were added, across sources, with the group in the breadcrumb', async () => {
        installAll()
        const target = await show()
        await choose(sourceRow(target, 'character:char-a', 'plain'), 'toggle-star')
        // Author groups start folded.
        q(target, '[data-part="toggles-section"][data-source="module:m1"] [data-part="toggles-group-head"]')!.click()
        flushSync()
        await tick()
        await choose(sourceRow(target, 'module:m1', 'inner'), 'toggle-star')
        await choose(sourceRow(target, 'prompt', 'tone'), 'toggle-star')
        expect(favKeys(target)).toEqual(['plain', 'inner', 'tone'])
        const crumbs = all(target, `${FAV} [data-part="toggles-crumb"]`).map((element) => element.textContent?.replace(/\s+/g, ' ').trim())
        expect(crumbs).toEqual(['chatShellTogglesSourceCharacter', 'Cards › Extras', 'chatShellTogglesSourcePrompt'])
        expect(storedItems()).toEqual([ref('character:char-a', 'plain'), ref('module:m1', 'inner'), ref('prompt', 'tone')])
    })

    test('unstarring from the section and from the source row both remove the star', async () => {
        installAll()
        seed([ref('prompt', 'tone'), ref('prompt', 'scene')])
        const target = await show()
        await openMenu(favRow(target, 'tone'))
        expect(q(favRow(target, 'tone'), '[data-part="toggle-star"]')!.textContent).toBe('chatShellTogglesUnstar')
        q(favRow(target, 'tone'), '[data-part="toggle-star"]')!.click()
        flushSync()
        await tick()
        expect(favKeys(target)).toEqual(['scene'])
        // The copy that had focus is gone, so focus goes to the same toggle's own row.
        await tick()
        expect(document.activeElement).toBe(q(sourceRow(target, 'prompt', 'tone'), '[data-part="toggle-menu-button"]'))
        await choose(sourceRow(target, 'prompt', 'scene'), 'toggle-star')
        expect(q(target, FAV)).toBeNull()
        expect(storedItems()).toEqual([])
        expect(q(target, '[data-part="toggles-announce"]')!.textContent).toBe('unstarred:Scene')
    })

    test('the same key in two sources is starred per source', async () => {
        install({ prompt: 'shared=Shared', modules: [{ id: 'm1', name: 'Cards', customModuleToggle: 'shared=Shared' }] })
        const target = await show()
        await choose(sourceRow(target, 'module:m1', 'shared'), 'toggle-star')
        expect(storedItems()).toEqual([ref('module:m1', 'shared')])
        expect(q(sourceRow(target, 'module:m1', 'shared'), '[data-part="toggle-star-mark"]')).not.toBeNull()
        expect(q(sourceRow(target, 'prompt', 'shared'), '[data-part="toggle-star-mark"]')).toBeNull()
    })

    test('Shift+F10 on a row lands on the first menu entry', async () => {
        installAll()
        const target = await show()
        const control = q(sourceRow(target, 'prompt', 'tone'), '[data-row-control]')!
        control.focus()
        control.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true }))
        flushSync()
        await tick()
        await tick()
        expect(document.activeElement?.getAttribute('data-part')).toBe('toggle-star')
    })
})

describe('the Favourites section', () => {
    test('move up and down reorder the stars and store the new order; the ends have no step past them', async () => {
        installAll()
        seed([ref('prompt', 'tone'), ref('prompt', 'scene'), ref('prompt', 'mood')])
        const target = await show()
        await openMenu(favRow(target, 'tone'))
        expect(q(favRow(target, 'tone'), '[data-part="toggle-move-up"]')!.hasAttribute('disabled')).toBe(true)
        q(favRow(target, 'tone'), '[data-part="toggle-move-down"]')!.click()
        flushSync()
        await tick()
        expect(favKeys(target)).toEqual(['scene', 'tone', 'mood'])
        expect(storedItems()).toEqual([ref('prompt', 'scene'), ref('prompt', 'tone'), ref('prompt', 'mood')])
        expect(q(target, '[data-part="toggles-announce"]')!.textContent).toBe('moved:Tone:2:3')
        await choose(favRow(target, 'mood'), 'toggle-move-up')
        expect(favKeys(target)).toEqual(['scene', 'mood', 'tone'])
        await openMenu(favRow(target, 'tone'))
        expect(q(favRow(target, 'tone'), '[data-part="toggle-move-down"]')!.hasAttribute('disabled')).toBe(true)
    })

    test('move offers no step on source rows', async () => {
        installAll()
        seed([ref('prompt', 'tone'), ref('prompt', 'scene')])
        const target = await show()
        await openMenu(sourceRow(target, 'prompt', 'scene'))
        expect(q(sourceRow(target, 'prompt', 'scene'), '[data-part="toggle-move-up"]')).toBeNull()
        expect(q(sourceRow(target, 'prompt', 'scene'), '[data-part="toggle-move-down"]')).toBeNull()
    })

    test('a move steps over a star that is hidden and leaves it where it is', async () => {
        installAll()
        seed([ref('prompt', 'tone'), ref('module:gone', 'x'), ref('prompt', 'scene')])
        const target = await show()
        expect(favKeys(target)).toEqual(['tone', 'scene'])
        await choose(favRow(target, 'scene'), 'toggle-move-up')
        expect(favKeys(target)).toEqual(['scene', 'tone'])
        expect(storedItems()).toEqual([ref('prompt', 'scene'), ref('module:gone', 'x'), ref('prompt', 'tone')])
    })

    test('a row in the section drives the same value as its source row and has its own open menu', async () => {
        installAll()
        seed([ref('prompt', 'scene')])
        const target = await show()
        await openMenu(favRow(target, 'scene'))
        expect(q(sourceRow(target, 'prompt', 'scene'), '[data-part="toggle-menu"]')).toBeNull()
        const flip = q(favRow(target, 'scene'), '[data-part="toggle-switch"]') as HTMLInputElement
        flip.click()
        flushSync()
        await tick()
        expect(sharedValues().toggle_scene).toBe('1')
        expect((q(sourceRow(target, 'prompt', 'scene'), '[data-part="toggle-switch"]') as HTMLInputElement).checked).toBe(true)
        expect(h.mark).toHaveBeenCalledWith('char-a')
    })

    test('stars of a source that is not in use are hidden, kept in the store, and come back in place', async () => {
        installAll()
        seed([ref('module:gone', 'deck'), ref('prompt', 'tone')])
        const target = await show()
        expect(favKeys(target)).toEqual(['tone'])
        await choose(sourceRow(target, 'prompt', 'scene'), 'toggle-star')
        expect(storedItems()).toEqual([ref('module:gone', 'deck'), ref('prompt', 'tone'), ref('prompt', 'scene')])
        await unmount(mounted!)
        mounted = undefined
        document.body.replaceChildren()
        opener = document.createElement('button')
        document.body.appendChild(opener)
        h.modules = [{ id: 'gone', name: 'Back again', customModuleToggle: 'deck=Deck' }]
        const again = await show()
        expect(favKeys(again)).toEqual(['deck', 'tone', 'scene'])
    })

    test('a star whose key left a source still in use is hidden, not deleted', async () => {
        installAll()
        seed([ref('prompt', 'removed'), ref('prompt', 'tone')])
        const target = await show()
        expect(favKeys(target)).toEqual(['tone'])
        expect(storedItems()).toEqual([ref('prompt', 'removed'), ref('prompt', 'tone')])
    })

    test('the prompt slot follows the active preset: the same key stays starred after the preset changes', async () => {
        installAll()
        seed([ref('prompt', 'tone')])
        let target = await show()
        expect(favKeys(target)).toEqual(['tone'])
        await unmount(mounted!)
        mounted = undefined
        document.body.replaceChildren()
        opener = document.createElement('button')
        document.body.appendChild(opener)
        h.db.botPresetsId = 1
        h.db.customPromptTemplateToggle = 'tone=Tone (second preset)\nother=Other'
        target = await show()
        expect(favKeys(target)).toEqual(['tone'])
        expect(q(favRow(target, 'tone'), '[data-part="toggle-label"]')!.textContent).toBe('Tone (second preset)')
        // A preset without the key hides the star; the stored slot is untouched.
        await unmount(mounted!)
        mounted = undefined
        document.body.replaceChildren()
        opener = document.createElement('button')
        document.body.appendChild(opener)
        h.db.customPromptTemplateToggle = 'other=Other'
        target = await show()
        expect(q(target, FAV)).toBeNull()
        expect(storedItems()).toEqual([ref('prompt', 'tone')])
    })

    test('opening the panel adopts a star another tab added', async () => {
        installAll()
        seed([ref('prompt', 'tone')])
        const first = await show()
        expect(favKeys(first)).toEqual(['tone'])
        await unmount(mounted!)
        mounted = undefined
        document.body.replaceChildren()
        opener = document.createElement('button')
        document.body.appendChild(opener)
        seed([ref('prompt', 'tone'), ref('prompt', 'mood')])
        const again = await show()
        expect(favKeys(again)).toEqual(['tone', 'mood'])
    })

    test('starring and reordering change no profile or chat data and mark nothing for saving', async () => {
        installAll()
        const target = await show()
        const before = JSON.stringify(h.db)
        await choose(sourceRow(target, 'prompt', 'tone'), 'toggle-star')
        await choose(sourceRow(target, 'prompt', 'scene'), 'toggle-star')
        await choose(favRow(target, 'scene'), 'toggle-move-up')
        await choose(favRow(target, 'tone'), 'toggle-star')
        expect(JSON.stringify(h.db)).toBe(before)
        expect(h.mark).not.toHaveBeenCalled()
        expect(chat.GLGlobalVariables).toBeUndefined()
    })
})

describe('search and the filter', () => {
    test('the section is hidden while a search or the on-only filter is active, so each hit shows once', async () => {
        installAll()
        seed([ref('prompt', 'tone'), ref('prompt', 'scene')])
        const target = await show()
        expect(favKeys(target)).toEqual(['tone', 'scene'])
        type(target, 'tone')
        await settle()
        expect(q(target, FAV)).toBeNull()
        expect(all(target, '[data-part="toggle-row"][data-key="tone"]')).toHaveLength(1)
        type(target, '')
        await settle()
        expect(favKeys(target)).toEqual(['tone', 'scene'])
        ;(q(target, '[data-part="toggles-filter-chip"]') as HTMLButtonElement).click()
        flushSync()
        await tick()
        expect(q(target, FAV)).toBeNull()
        ;(q(target, '[data-part="toggles-filter-chip"]') as HTMLButtonElement).click()
        flushSync()
        await tick()
        expect(favKeys(target)).toEqual(['tone', 'scene'])
    })

    test('a pending search that has not applied yet does not hide the section', async () => {
        installAll()
        seed([ref('prompt', 'tone')])
        const target = await show()
        type(target, 'ton')
        await settle(119)
        expect(favKeys(target)).toEqual(['tone'])
        await settle(1)
        expect(q(target, FAV)).toBeNull()
    })
})

describe('a stored value this build cannot read (MC-350)', () => {
    test('the panel says so, shows no stars, and the stored bytes are untouched until a star is added', async () => {
        installAll()
        localStorage.setItem(FAVOURITES_KEY, '{"v":2,"items":[{"s":"prompt","k":"tone"}]}')
        const target = await show()
        expect(q(target, '[data-part="toggles-fav-unreadable"]')!.textContent).toBe('chatShellFavouritesUnreadable')
        expect(q(target, FAV)).toBeNull()
        expect(localStorage.getItem(FAVOURITES_KEY)).toBe('{"v":2,"items":[{"s":"prompt","k":"tone"}]}')
    })

    test('the first star copies the old bytes aside once, then the note goes', async () => {
        installAll()
        const raw = '{"v":2,"items":[{"s":"prompt","k":"tone"}]}'
        localStorage.setItem(FAVOURITES_KEY, raw)
        const target = await show()
        await choose(sourceRow(target, 'prompt', 'scene'), 'toggle-star')
        expect(localStorage.getItem(UNREADABLE_KEY)).toBe(raw)
        expect(storedItems()).toEqual([ref('prompt', 'scene')])
        expect(q(target, '[data-part="toggles-fav-unreadable"]')).toBeNull()
        expect(favKeys(target)).toEqual(['scene'])
    })

    test('with the side key taken the stars last for the session and the stored bytes stay', async () => {
        installAll()
        const raw = 'not json'
        localStorage.setItem(FAVOURITES_KEY, raw)
        localStorage.setItem(UNREADABLE_KEY, 'older copy')
        const target = await show()
        await choose(sourceRow(target, 'prompt', 'scene'), 'toggle-star')
        expect(favKeys(target)).toEqual(['scene'])
        expect(localStorage.getItem(FAVOURITES_KEY)).toBe(raw)
        expect(localStorage.getItem(UNREADABLE_KEY)).toBe('older copy')
        expect(q(target, '[data-part="toggles-fav-unreadable"]')).not.toBeNull()
        expect(currentFavourites().items).toEqual([ref('prompt', 'scene')])
    })
})
