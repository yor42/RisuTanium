// @vitest-environment jsdom
/**
 * The Studio search mounted inside the Studio screen: entry, Ctrl+K, composition, Back, results and opening a
 * result. The stores, the module lister and the locale are replaced; the owner source, the owner model, the search
 * and the screen store are real, and a scan runs on the real scheduler.
 */
import { flushSync, mount, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
    listerOver,
    loreBody,
    makeCharacter,
    makeChat,
    makeInput,
    residentModule,
    stubModule,
    studioDbOf,
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

import { dispatchBack, resetBackHandlersForTests } from '../../ts/backHandlers'
import { openStudio, resetStudioScreenForTests, studioScreen } from '../../ts/studio/studioScreen.svelte'
import { setStudioEnabled } from '../../ts/studio/studioSwitch.svelte'
import { studioOpen } from '../../ts/studio/studioOpen'
import StudioScreen from './StudioScreen.svelte'

class ResizeObserverStub {
    static instances: ResizeObserverStub[] = []
    constructor(private readonly callback: ResizeObserverCallback) {
        ResizeObserverStub.instances.push(this)
    }
    observe(): void {}
    disconnect(): void {
        ResizeObserverStub.instances = ResizeObserverStub.instances.filter((entry) => entry !== this)
    }
    emit(width: number): void {
        this.callback([{ contentRect: { width } } as ResizeObserverEntry], this as unknown as ResizeObserver)
    }
}

let app: ReturnType<typeof mount> | undefined
let host: HTMLElement | undefined

const castle = loreBody('Castle', 'the king lives here')
const forest = loreBody('Forest', 'tall trees and a king')

function setDb(lore = [castle, forest], withModules = true): void {
    db.db = studioDbOf(makeInput({
        character: makeCharacter({
            globalLore: lore,
            chats: [makeChat({ id: 'chat-1', name: 'First chat' })],
        }),
        modules: withModules ? [residentModule('res'), stubModule('stub')] : [],
        enabledModules: withModules ? ['res', 'stub'] : [],
    }))
}

function show(width = 1200): void {
    host = document.createElement('div')
    document.body.appendChild(host)
    app = mount(StudioScreen, { target: host })
    flushSync()
    resize(width)
}

function resize(width: number): void {
    for (const observer of ResizeObserverStub.instances) observer.emit(width)
    flushSync()
}

const part = (name: string) => document.querySelector<HTMLElement>(`[data-part="${name}"]`)
const parts = (name: string) => Array.from(document.querySelectorAll<HTMLElement>(`[data-part="${name}"]`))
const field = () => part('studio-search-input') as HTMLInputElement
const resultIds = () => parts('studio-search-result').map((element) => element.dataset.resultId)

function openSearch(): void {
    part('studio-search-toggle')?.click()
    flushSync()
}

function typeQuery(value: string): void {
    field().value = value
    field().dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
}

function press(target: Element, init: KeyboardEventInit & { keyCode?: number }): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
    if (init.keyCode !== undefined) Object.defineProperty(event, 'keyCode', { value: init.keyCode })
    target.dispatchEvent(event)
    flushSync()
    return event
}

async function settled(check: () => void): Promise<void> {
    await vi.waitFor(() => {
        flushSync()
        check()
    })
}

const ownerTarget = { owner: { type: 'character', id: 'cha-1' }, from: 'chat' } as const

beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    ResizeObserverStub.instances = []
    localStorage.clear()
    resetBackHandlersForTests()
    resetStudioScreenForTests()
    settingsOpen.set(false)
    MobileGUI.set(false)
    selection.selId = 0
    setDb()
    setStudioEnabled(true)
})

afterEach(async () => {
    if (app) await unmount(app)
    app = undefined
    host?.remove()
    host = undefined
    resetStudioScreenForTests()
    resetBackHandlersForTests()
    setStudioEnabled(false)
    localStorage.clear()
    vi.unstubAllGlobals()
})

describe('5f entry and keys', () => {
    test('the search button opens the field and focuses it', () => {
        openStudio(ownerTarget, null)
        show()
        expect(part('studio-search-input')).toBeNull()
        openSearch()
        expect(document.activeElement).toBe(field())
    })

    test('Ctrl+K inside the Studio root opens the search and returns to its field', async () => {
        openStudio(ownerTarget, null)
        show()
        const inside = part('studio-detail-body') as HTMLElement
        const event = press(inside, { key: 'k', ctrlKey: true })
        expect(event.defaultPrevented).toBe(true)
        expect(studioScreen.searchOpen).toBe(true)
        await settled(() => expect(document.activeElement).toBe(field()))

        // Already open: the key brings focus back to the field.
        ;(part('studio-search-toggle') as HTMLElement).focus()
        press(part('studio-header') as HTMLElement, { key: 'K', metaKey: true })
        await settled(() => expect(document.activeElement).toBe(field()))
    })

    test('Ctrl+K outside the Studio root does nothing', () => {
        openStudio(ownerTarget, null)
        show()
        const outside = document.createElement('input')
        document.body.appendChild(outside)
        const event = press(outside, { key: 'k', ctrlKey: true })
        expect(event.defaultPrevented).toBe(false)
        press(document.body, { key: 'k', ctrlKey: true })
        expect(studioScreen.searchOpen).toBe(false)
        outside.remove()
    })

    test('Ctrl+K during an IME composition is left to the IME; other modifiers are not the shortcut', () => {
        openStudio(ownerTarget, null)
        show()
        const inside = part('studio-detail-body') as HTMLElement
        press(inside, { key: 'k', ctrlKey: true, isComposing: true })
        press(inside, { key: 'k', ctrlKey: true, keyCode: 229 })
        press(inside, { key: 'k', ctrlKey: true, shiftKey: true })
        press(inside, { key: 'k' })
        expect(studioScreen.searchOpen).toBe(false)
    })

    test('Enter during a composition opens nothing; Enter after it opens the first result', async () => {
        openStudio(ownerTarget, null)
        show()
        openSearch()
        typeQuery('king')
        await settled(() => expect(resultIds()).toEqual(['cha-1/lore:0', 'cha-1/lore:1']))

        press(field(), { key: 'Enter', isComposing: true })
        press(field(), { key: 'Enter', keyCode: 229 })
        expect(studioScreen.searchOpen).toBe(true)
        expect(studioScreen.selectedItemId).toBeNull()

        press(field(), { key: 'Enter' })
        expect(studioScreen.searchOpen).toBe(false)
        expect(studioScreen.selectedItemId).toBe('cha-1/lore:0')
    })

    test('Esc during a composition keeps the search; Esc after it closes it and returns focus to the button', async () => {
        openStudio(ownerTarget, null)
        show()
        openSearch()
        press(field(), { key: 'Escape', isComposing: true })
        press(field(), { key: 'Escape', keyCode: 229 })
        expect(studioScreen.searchOpen).toBe(true)
        press(field(), { key: 'Escape' })
        expect(studioScreen.searchOpen).toBe(false)
        expect(get(studioOpen)).toBe(true)
        await settled(() => expect(document.activeElement).toBe(part('studio-search-toggle')))
    })

    test('Back closes the search first, then leaves Studio', () => {
        openStudio(ownerTarget, null)
        show()
        openSearch()
        expect(dispatchBack()).toBe(true)
        flushSync()
        expect(studioScreen.searchOpen).toBe(false)
        expect(get(studioOpen)).toBe(true)
        expect(dispatchBack()).toBe(true)
        flushSync()
        expect(get(studioOpen)).toBe(false)
    })

    test('typing in the field is not taken by the tree', async () => {
        openStudio(ownerTarget, null)
        show()
        openSearch()
        typeQuery('king')
        const before = studioScreen.selectedOwnerKey
        press(field(), { key: 'Home' })
        press(field(), { key: 'x' })
        expect(studioScreen.selectedOwnerKey).toBe(before)
        expect(field().value).toBe('king')
    })
})

describe('results', () => {
    test('a query lists the items that match, marks the words and shows a snippet', async () => {
        openStudio(ownerTarget, null)
        show()
        openSearch()
        typeQuery('king castle')
        await settled(() => expect(resultIds()).toEqual(['cha-1/lore:0']))
        const marks = Array.from(document.querySelectorAll('[data-part="studio-search-result"] mark')).map((mark) => mark.textContent)
        expect(marks).toContain('Castle')
        expect(marks).toContain('king')
        expect(part('studio-search-snippet')?.textContent).toContain('the king lives here')
        // Item text arrives as text, never as markup.
        expect(document.querySelector('[data-part="studio-search-results"] img')).toBeNull()
    })

    test('a query that matches nothing says so, and an empty query lists nothing', async () => {
        openStudio(ownerTarget, null)
        show()
        openSearch()
        expect(parts('studio-search-result')).toHaveLength(0)
        expect(part('studio-search-empty')).toBeNull()
        typeQuery('dragon')
        await settled(() => expect(part('studio-search-empty')?.textContent).toBe('studioSearchNoResults'))
        typeQuery('')
        await settled(() => expect(part('studio-search-empty')).toBeNull())
        expect(parts('studio-search-result')).toHaveLength(0)
    })

    test('a chip alone lists a whole kind and toggles off again', async () => {
        openStudio(ownerTarget, null)
        show()
        openSearch()
        const chip = document.querySelector<HTMLElement>('[data-part="studio-search-chip"][data-chip="lore"]')
        chip?.click()
        flushSync()
        expect(chip?.getAttribute('aria-pressed')).toBe('true')
        await settled(() => expect(resultIds()).toEqual(['cha-1/lore:0', 'cha-1/lore:1']))
        chip?.click()
        flushSync()
        expect(chip?.getAttribute('aria-pressed')).toBe('false')
        await settled(() => expect(parts('studio-search-result')).toHaveLength(0))
    })

    test('modules that are not loaded are counted, not searched', async () => {
        openStudio(ownerTarget, null)
        show()
        openSearch()
        expect(part('studio-search-unloaded')?.textContent).toBe('studioSearchUnloaded(1)')
    })

    test('a result opens in the tree and the detail and closes the search', async () => {
        openStudio(ownerTarget, null)
        show()
        openSearch()
        typeQuery('forest')
        await settled(() => expect(resultIds()).toEqual(['cha-1/lore:1']))
        parts('studio-search-result')[0].click()
        flushSync()
        expect(studioScreen.searchOpen).toBe(false)
        expect(studioScreen.selectedOwnerKey).toBe('character:cha-1')
        expect(studioScreen.selectedKind).toBe('lore')
        expect(studioScreen.selectedItemId).toBe('cha-1/lore:1')
        expect(studioScreen.expanded['o:character:cha-1']).toBe(true)
        expect(studioScreen.expanded['k:character:cha-1/lore']).toBe(true)
        expect(part('studio-detail-text')?.textContent).toBe('tall trees and a king')
    })

    test('after a result is picked focus is back in Studio, so Esc and Ctrl+K work without a click', async () => {
        openStudio(ownerTarget, null)
        show()
        openSearch()
        typeQuery('forest')
        await settled(() => expect(resultIds()).toEqual(['cha-1/lore:1']))
        expect(document.activeElement).toBe(field())
        parts('studio-search-result')[0].click()
        flushSync()
        await settled(() => expect(document.activeElement).toBe(part('studio')))
        const ctrlK = press(document.activeElement!, { key: 'k', ctrlKey: true })
        expect(ctrlK.defaultPrevented).toBe(true)
        expect(studioScreen.searchOpen).toBe(true)
    })

    test('a hit in a module that is not in use is tagged Off and opens its group', async () => {
        db.db = studioDbOf(makeInput({
            character: makeCharacter({ chats: [makeChat({ id: 'chat-1', name: 'First chat' })] }),
            modules: [residentModule('spare', { lorebook: [{ key: 'k', secondkey: '', insertorder: 1, comment: 'Spare lore', content: 'spare body', mode: 'normal', alwaysActive: false, selective: false }] })],
        }))
        openStudio(ownerTarget, null)
        show()
        openSearch()
        typeQuery('spare')
        await settled(() => expect(resultIds()).toEqual(['spare/lore:0']))
        expect(parts('studio-search-result')[0].textContent).toContain('studioOff')
        parts('studio-search-result')[0].click()
        flushSync()
        expect(studioScreen.expanded['g:otherModules']).toBe(true)
        expect(studioScreen.selectedOwnerKey).toBe('module:spare')
    })

    test('a model change restarts the query on the new data', async () => {
        openStudio(ownerTarget, null)
        show()
        openSearch()
        typeQuery('king')
        await settled(() => expect(resultIds()).toEqual(['cha-1/lore:0', 'cha-1/lore:1']))
        setDb([loreBody('Tower', 'a king in the tower')])
        ReloadGUIPointer.update((value) => value + 1)
        await settled(() => expect(resultIds()).toEqual(['cha-1/lore:0']))
        expect(parts('studio-search-result')[0].textContent).toContain('Tower')
    })

    test('closing the search stops its scan: nothing is left running', async () => {
        openStudio(ownerTarget, null)
        show()
        openSearch()
        typeQuery('king')
        part('studio-search-toggle')?.click()
        flushSync()
        expect(part('studio-search')).toBeNull()
        // The unmounted search leaves no timer behind that could touch a removed page.
        await new Promise((resolve) => setTimeout(resolve, 20))
        expect(parts('studio-search-result')).toHaveLength(0)
    })
})
