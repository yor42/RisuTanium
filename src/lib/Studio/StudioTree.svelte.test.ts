// @vitest-environment jsdom
/**
 * The Studio tree mounted over a synthetic owner model: ARIA roles and roving focus, the key map applied to the
 * DOM, row paging, keys that must not reach the tree, and the row menu's link-out. The stores, the module
 * lister and the locale are replaced; the owner source, the owner model and the screen store are real.
 */
import { createRawSnippet, flushSync, mount, tick, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
    listerOver,
    loreEntries,
    makeCharacter,
    makeChat,
    makeInput,
    makePlugin,
    makePreset,
    makeTextCharacter,
    regexEntries,
    residentModule,
    stubModule,
    studioDbOf,
    v2Scripts,
} from '../../ts/studio/studioFixtures.test-helpers'

const db = $state({ db: {} as ReturnType<typeof studioDbOf> })
const selection = $state({ selId: 0 })
const ReloadGUIPointer = writable(0)
const MobileGUI = writable(false)
const settingsOpen = writable(false)
const CharConfigSubMenu = writable(0)
const SettingsMenuIndex = writable(-1)
const botMakerMode = writable(false)
const sideBarStore = writable(false)
const QuickSettings = $state({ open: true })

// Getters: the statically imported modules are evaluated before these consts are initialised.
vi.mock('../../ts/stores.svelte', () => ({
    get DBState() { return db },
    get selIdState() { return selection },
    get ReloadGUIPointer() { return ReloadGUIPointer },
    get MobileGUI() { return MobileGUI },
    get settingsOpen() { return settingsOpen },
    get CharConfigSubMenu() { return CharConfigSubMenu },
    get SettingsMenuIndex() { return SettingsMenuIndex },
    get botMakerMode() { return botMakerMode },
    get sideBarStore() { return sideBarStore },
    get QuickSettings() { return QuickSettings },
}))
vi.mock('../../ts/chatShell/shellSwitch.svelte', () => ({ shellEligible: () => false }))
vi.mock('../../ts/process/moduleRefList', () => ({
    moduleListOf: (ids: string[]) => listerOver(db.db.modules)(ids),
}))
vi.mock('../../ts/alertPrompts', () => ({ pageCovered: () => false }))
vi.mock('../../ts/alertBack', () => ({ closeDialogForBack: vi.fn() }))
vi.mock('../../ts/caughtErrors', () => ({ recordCaughtError: vi.fn() }))
vi.mock('../../lang', async () => {
    const helpers = await import('../../ts/studio/studioFixtures.test-helpers')
    return { language: helpers.studioLanguageMock() }
})

import { resetBackHandlersForTests } from '../../ts/backHandlers'
import { openStudio, resetStudioScreenForTests, studioScreen } from '../../ts/studio/studioScreen.svelte'
import { setStudioEnabled } from '../../ts/studio/studioSwitch.svelte'
import { studioOpen } from '../../ts/studio/studioOpen'
import StudioScreen from './StudioScreen.svelte'
import StudioTree from './StudioTree.svelte'

class ResizeObserverStub {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(): void {}
    disconnect(): void {}
}

const CHARACTER = 'character:cha-1'
const ownerTarget = { owner: { type: 'character', id: 'cha-1' }, from: 'chat' } as const

function fixtureInput() {
    return makeInput({
        character: makeCharacter({
            globalLore: loreEntries(250),
            customscript: regexEntries(3),
            triggerscript: v2Scripts,
            modules: ['res'],
            chats: [makeChat({ id: 'chat-1', name: 'First chat', localLore: loreEntries(2, 'chatlore') })],
        }),
        presets: [makePreset('P0', { regex: regexEntries(1) }), makePreset('P1')],
        activePreset: 0,
        plugins: [makePlugin('legacy', 1)],
        modules: [residentModule('res', { customModuleToggle: '' }), stubModule('stub')],
    })
}

let apps: ReturnType<typeof mount>[] = []
let hosts: HTMLElement[] = []

function show(component: typeof StudioTree | typeof StudioScreen, props: Record<string, unknown> = {}): HTMLElement {
    const host = document.createElement('div')
    document.body.appendChild(host)
    hosts.push(host)
    apps.push(mount(component, { target: host, props }))
    flushSync()
    return host
}

const row = (id: string) => document.querySelector<HTMLElement>(`[data-row-id="${id}"]`)
const rowsOfKind = (kind: string) => document.querySelectorAll(`[data-row-kind="${kind}"]`)
const tabStops = () => Array.from(document.querySelectorAll<HTMLElement>('[data-part="studio-row"]')).filter((element) => element.tabIndex === 0)

function press(element: Element, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
    element.dispatchEvent(event)
    flushSync()
    return event
}

async function settle(): Promise<void> {
    await tick()
    flushSync()
}

function click(element: Element | null): void {
    ;(element as HTMLElement | null)?.click()
    flushSync()
}

beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    localStorage.clear()
    resetBackHandlersForTests()
    resetStudioScreenForTests()
    settingsOpen.set(false)
    MobileGUI.set(false)
    CharConfigSubMenu.set(0)
    db.db = studioDbOf(fixtureInput())
    selection.selId = 0
    setStudioEnabled(true)
})

afterEach(async () => {
    for (const app of apps) await unmount(app)
    apps = []
    for (const host of hosts) host.remove()
    hosts = []
    resetStudioScreenForTests()
    resetBackHandlersForTests()
    setStudioEnabled(false)
    localStorage.clear()
    vi.unstubAllGlobals()
})

const detailText = () => document.querySelector('[data-part="studio-detail-text"]')?.textContent ?? ''
const rowText = (id: string) => row(id)?.textContent ?? ''

describe('owner role labels', () => {
    test('the character and this chat rows carry their role beside the name', () => {
        openStudio(ownerTarget, null)
        show(StudioTree)
        expect(rowText(`o:${CHARACTER}`)).toContain('Alice')
        expect(rowText(`o:${CHARACTER}`)).toContain('studioOwnerCharacter')
        expect(rowText('o:chat:chat-1')).toContain('First chat')
        expect(rowText('o:chat:chat-1')).toContain('studioOwnerThisChat')
        expect(rowText('o:module:res')).not.toContain('studioOwner')
    })

    test('an owner without a name is listed under its role, not as a blank row', () => {
        db.db = studioDbOf(makeInput({
            character: makeCharacter({ name: '', chats: [makeChat({ id: 'chat-1', name: '' })] }),
        }))
        openStudio(ownerTarget, null)
        show(StudioTree)
        expect(rowText(`o:${CHARACTER}`).trim()).toBe('studioOwnerCharacter')
        expect(rowText('o:chat:chat-1').trim()).toBe('studioOwnerThisChat')
    })

    test('the detail title names the owner with its role', () => {
        openStudio(ownerTarget, null)
        show(StudioScreen)
        expect(document.querySelector('[data-part="studio-detail-title"]')?.textContent).toBe('Alice')
        expect(document.querySelector('[data-part="studio-detail-role"]')?.textContent).toBe('studioOwnerCharacter')
    })
})

describe('a kind that is one item shows that item', () => {
    beforeEach(() => {
        db.db = studioDbOf(makeInput({
            character: makeTextCharacter({ desc: 'DESC-TEXT', triggerscript: v2Scripts, chats: [makeChat({ id: 'chat-1', name: 'First chat' })] }),
        }))
    })

    test('choosing the Basic info row and the Scripts row in the tree shows their text', () => {
        openStudio(ownerTarget, null)
        show(StudioScreen)
        expect(detailText()).toBe('')

        click(row(`k:${CHARACTER}/basic`))
        expect(detailText()).toContain('DESC-TEXT')

        click(row(`k:${CHARACTER}/scripts`))
        expect(detailText()).toContain('v2Header')
        expect(detailText()).not.toContain('DESC-TEXT')
    })

    test('an entry that names only the kind shows the item', () => {
        openStudio({ owner: { type: 'character', id: 'cha-1' }, kind: 'basic', from: 'chat' }, null)
        show(StudioScreen)
        expect(detailText()).toContain('DESC-TEXT')
    })

    test('a list kind with several rows does not pick one for the user', () => {
        db.db = studioDbOf(makeInput({ character: makeCharacter({ globalLore: loreEntries(1), chats: [makeChat({ id: 'chat-1', name: 'First chat' })] }) }))
        openStudio({ owner: { type: 'character', id: 'cha-1' }, kind: 'lore', from: 'chat' }, null)
        show(StudioScreen)
        expect(detailText()).toBe('')
    })
})

describe('4b roles and roving focus', () => {
    test('the tree, its rows and their levels, sizes and states carry the tree pattern', () => {
        openStudio(ownerTarget, null)
        show(StudioTree)
        const tree = document.querySelector('[role="tree"]')
        expect(tree?.getAttribute('aria-label')).toBe('studioTreeLabel')

        const owner = row(`o:${CHARACTER}`)
        expect(owner?.getAttribute('role')).toBe('treeitem')
        expect(owner?.getAttribute('aria-level')).toBe('1')
        expect(owner?.getAttribute('aria-expanded')).toBe('true')
        expect(owner?.getAttribute('aria-setsize')).toBe('7')
        expect(owner?.getAttribute('aria-posinset')).toBe('1')
        expect(owner?.getAttribute('aria-selected')).toBe('true')

        const lore = row(`k:${CHARACTER}/lore`)
        expect(lore?.getAttribute('aria-level')).toBe('2')
        expect(lore?.getAttribute('aria-expanded')).toBe('false')
        expect(row(`k:${CHARACTER}/basic`)?.hasAttribute('aria-expanded')).toBe(false)
        expect(row('g:modules')?.getAttribute('aria-expanded')).toBe('false')
    })

    test('exactly one row is a tab stop and the arrows move it with the focus', async () => {
        openStudio(ownerTarget, null)
        show(StudioTree)
        expect(tabStops().map((element) => element.dataset.rowId)).toEqual([`o:${CHARACTER}`])

        row(`o:${CHARACTER}`)?.focus()
        press(row(`o:${CHARACTER}`)!, 'ArrowDown')
        await settle()
        expect(document.activeElement).toBe(row(`k:${CHARACTER}/basic`))
        expect(tabStops().map((element) => element.dataset.rowId)).toEqual([`k:${CHARACTER}/basic`])

        press(document.activeElement!, 'End')
        await settle()
        expect(document.activeElement).toBe(row('g:combined'))
        press(document.activeElement!, 'Home')
        await settle()
        expect(document.activeElement).toBe(row(`o:${CHARACTER}`))
    })

    test('Right opens a closed group and enters it, Left climbs back', async () => {
        openStudio(ownerTarget, null)
        show(StudioTree)
        const modules = row('g:modules')!
        modules.focus()
        press(modules, 'ArrowRight')
        expect(row('g:modules')?.getAttribute('aria-expanded')).toBe('true')
        expect(row('o:module:res')).not.toBeNull()
        press(row('g:modules')!, 'ArrowRight')
        await settle()
        expect(document.activeElement).toBe(row('o:module:res'))
        press(document.activeElement!, 'ArrowLeft')
        await settle()
        expect(document.activeElement).toBe(row('g:modules'))
    })

    test('a letter jumps to the next row that starts with it', async () => {
        openStudio(ownerTarget, null)
        show(StudioTree)
        const start = row(`o:${CHARACTER}`)!
        start.focus()
        // Rows are labelled by locale key in this test, so the first kind after the owner starts with "s".
        press(start, 's')
        await settle()
        expect(document.activeElement).toBe(row(`k:${CHARACTER}/basic`))
    })

    test('Enter on a leaf selects it and moves a phone to the detail', () => {
        openStudio(ownerTarget, null)
        show(StudioTree)
        press(row(`k:${CHARACTER}/basic`)!, 'Enter')
        expect(studioScreen.selectedOwnerKey).toBe(CHARACTER)
        expect(studioScreen.selectedKind).toBe('basic')
        expect(studioScreen.detailShown).toBe(true)
        expect(studioScreen.pickedInVisit).toBe(true)
        expect(row(`k:${CHARACTER}/basic`)?.getAttribute('aria-selected')).toBe('true')
    })

    test('Enter on an owner opens or closes it without leaving the list on a phone', () => {
        openStudio({ from: 'chat' }, null)
        studioScreen.layout = 'stack'
        show(StudioTree)
        const owner = row(`o:${CHARACTER}`)!
        expect(owner.getAttribute('aria-expanded')).toBe('false')
        press(owner, 'Enter')
        expect(row(`o:${CHARACTER}`)?.getAttribute('aria-expanded')).toBe('true')
        expect(studioScreen.pickedInVisit).toBe(false)
        expect(studioScreen.detailShown).toBe(false)
        press(row(`o:${CHARACTER}`)!, 'Enter')
        expect(rowsOfKind('kind').length).toBe(0)
    })

    test('hide empty kinds drops the kinds with nothing in them', () => {
        db.db.characters[0].customscript = []
        openStudio(ownerTarget, null)
        show(StudioTree)
        expect(row(`k:${CHARACTER}/regex`)).not.toBeNull()
        click(document.querySelector('[data-part="studio-hide-empty"]'))
        expect(studioScreen.hideEmpty).toBe(true)
        expect(row(`k:${CHARACTER}/regex`)).toBeNull()
        expect(row(`k:${CHARACTER}/lore`)).not.toBeNull()
    })
})

describe('4c paging', () => {
    test('a collapsed owner renders no item rows', () => {
        openStudio(ownerTarget, null)
        show(StudioTree)
        expect(rowsOfKind('item').length).toBe(0)
        press(row(`o:${CHARACTER}`)!, 'ArrowLeft')
        expect(rowsOfKind('kind').length).toBe(0)
        expect(rowsOfKind('item').length).toBe(0)
    })

    test('a long list shows 100 rows, then 200, then the rest', () => {
        openStudio(ownerTarget, null)
        show(StudioTree)
        click(row(`k:${CHARACTER}/lore`))
        expect(rowsOfKind('item').length).toBe(100)
        const more = document.querySelector<HTMLElement>('[data-row-kind="more"]')
        expect(more?.textContent).toContain('studioShowMore(100)')
        click(more)
        expect(rowsOfKind('item').length).toBe(200)
        click(document.querySelector('[data-row-kind="more"]'))
        expect(rowsOfKind('item').length).toBe(250)
        expect(document.querySelector('[data-row-kind="more"]')).toBeNull()
    })

    test('the last "show more" activation leaves focus on a row of the list, not on the page', async () => {
        openStudio(ownerTarget, null)
        show(StudioTree)
        click(row(`k:${CHARACTER}/lore`))
        click(document.querySelector('[data-row-kind="more"]'))
        await settle()
        click(document.querySelector('[data-row-kind="more"]'))
        await settle()
        await settle()
        expect(document.querySelector('[data-row-kind="more"]')).toBeNull()
        const active = document.activeElement as HTMLElement | null
        expect(active?.dataset.part).toBe('studio-row')
        expect(active?.dataset.rowId).toBe('i:cha-1/lore:249')
    })

    test('a target deep in a long list opens the page that holds it', () => {
        const target = { owner: { type: 'character', id: 'cha-1' }, kind: 'lore', item: 'cha-1/lore:230', from: 'chat' } as const
        openStudio(target, null)
        show(StudioTree)
        expect(studioScreen.selectedItemId).toBe('cha-1/lore:230')
        expect(rowsOfKind('item').length).toBe(250)
        expect(row('i:cha-1/lore:230')?.getAttribute('aria-selected')).toBe('true')
    })
})

describe('4b2 keys from the search field', () => {
    function mountScreenWithTree(): void {
        const tree = createRawSnippet(() => ({
            render: () => '<div data-part="tree-host"></div>',
            setup: (node) => {
                const inner = mount(StudioTree, { target: node })
                return () => { void unmount(inner) }
            },
        }))
        show(StudioScreen, { tree })
    }

    test('Home, End, Space, arrows and letters typed in the search field move neither the tree nor its type-ahead', async () => {
        openStudio(ownerTarget, null)
        mountScreenWithTree()
        click(document.querySelector('[data-part="studio-search-toggle"]'))
        const section = document.querySelector('[data-part="studio-search"]')!
        const input = document.createElement('input')
        section.appendChild(input)

        const first = row(`o:${CHARACTER}`)!
        first.focus()
        const before = tabStops().map((element) => element.dataset.rowId)
        input.focus()
        for (const key of ['Home', 'End', ' ', 'ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Enter', 'm', 'p']) {
            const event = press(input, key)
            expect(event.defaultPrevented).toBe(false)
        }
        await settle()
        expect(document.activeElement).toBe(input)
        expect(tabStops().map((element) => element.dataset.rowId)).toEqual(before)
        expect(row('g:modules')?.getAttribute('aria-expanded')).toBe('false')
        expect(studioScreen.selectedItemId).toBeNull()
    })

    test('the same keys on a row do move the tree', async () => {
        openStudio(ownerTarget, null)
        mountScreenWithTree()
        const first = row(`o:${CHARACTER}`)!
        first.focus()
        expect(press(first, 'End').defaultPrevented).toBe(true)
        await settle()
        expect(document.activeElement).toBe(row('g:combined'))
    })
})

describe('4e row menu', () => {
    test('Shift+F10 opens the menu, Esc closes it and returns to the row, the button links out', async () => {
        openStudio(ownerTarget, null)
        show(StudioTree)
        const lore = row(`k:${CHARACTER}/lore`)!
        lore.focus()
        press(lore, 'F10', { shiftKey: true })
        await settle()
        const menu = document.querySelector('[data-part="studio-row-menu"]')
        expect(menu?.getAttribute('role')).toBe('menu')
        expect(document.activeElement).toBe(document.querySelector('[data-part="studio-row-menu-classic"]'))

        press(document.activeElement!, 'Escape')
        await settle()
        expect(document.querySelector('[data-part="studio-row-menu"]')).toBeNull()
        expect(document.activeElement).toBe(row(`k:${CHARACTER}/lore`))

        press(row(`k:${CHARACTER}/lore`)!, 'ContextMenu')
        await settle()
        click(document.querySelector('[data-part="studio-row-menu-classic"]'))
        expect(get(studioOpen)).toBe(false)
        expect(get(CharConfigSubMenu)).toBe(3)
    })

    test('a group row has no menu', async () => {
        openStudio(ownerTarget, null)
        show(StudioTree)
        const group = row('g:modules')!
        group.focus()
        press(group, 'F10', { shiftKey: true })
        await settle()
        expect(document.querySelector('[data-part="studio-row-menu"]')).toBeNull()
    })
})

describe('Combined entries', () => {
    test('a Combined group lists one entry per mergeable kind and nothing for scripts', () => {
        openStudio(ownerTarget, null)
        show(StudioTree)
        const group = row('g:combined')
        expect(group?.textContent).toContain('studioMerged')
        expect(row('c:regex')).toBeNull()
        click(group)
        expect(['regex', 'lore', 'toggles'].map((kind) => row(`c:${kind}`) !== null)).toEqual([true, true, true])
        expect(row('c:scripts')).toBeNull()
    })

    test('opening an entry selects the combined view and a phone moves to the detail', () => {
        openStudio(ownerTarget, null)
        show(StudioTree)
        click(row('g:combined'))
        click(row('c:lore'))
        expect(studioScreen.selectedOwnerKey).toBe('combined:lore')
        expect(studioScreen.selectedKind).toBe('lore')
        expect(studioScreen.selectedItemId).toBeNull()
        expect(studioScreen.detailShown).toBe(true)
        expect(row('c:lore')?.getAttribute('aria-selected')).toBe('true')
    })

    test('an entry has no classic-editor menu', async () => {
        openStudio(ownerTarget, null)
        show(StudioTree)
        click(row('g:combined'))
        const entry = row('c:regex')!
        entry.focus()
        press(entry, 'F10', { shiftKey: true })
        await settle()
        expect(document.querySelector('[data-part="studio-row-menu"]')).toBeNull()
    })
})