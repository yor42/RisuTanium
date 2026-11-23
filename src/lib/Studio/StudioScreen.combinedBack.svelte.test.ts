// @vitest-environment jsdom
/**
 * Back on a phone from an entry opened out of a merged (Combined) list returns to that list, with the opened row
 * scrolled into the band and focused; Back from an entry opened out of the tree still goes to the tree. The screen,
 * the tree, the detail, the merged view, the window host and the Back handler stack are real; the stores are plain
 * objects and the window geometry is a seam that models a scroller.
 */
import { flushSync, mount, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { makeCharacter, makeChat, makeInput, studioDbOf } from '../../ts/studio/studioFixtures.test-helpers'

const h = vi.hoisted(() => ({ run: vi.fn() }))

const db = $state({ db: {} as ReturnType<typeof studioDbOf> })
const selection = $state({ selId: 0 })
const MobileGUI = writable(false)
const settingsOpen = writable(false)
const ReloadGUIPointer = writable(0)
const CharConfigSubMenu = writable(0)
const SettingsMenuIndex = writable(-1)
const botMakerMode = writable(false)
const sideBarStore = writable(false)
const QuickSettings = $state({ open: true })

vi.mock('../../ts/stores.svelte', () => ({
    get DBState() { return db },
    get selIdState() { return selection },
    get MobileGUI() { return MobileGUI },
    get settingsOpen() { return settingsOpen },
    get ReloadGUIPointer() { return ReloadGUIPointer },
    get CharConfigSubMenu() { return CharConfigSubMenu },
    get SettingsMenuIndex() { return SettingsMenuIndex },
    get botMakerMode() { return botMakerMode },
    get sideBarStore() { return sideBarStore },
    get QuickSettings() { return QuickSettings },
}))
vi.mock('../../ts/chatShell/shellSwitch.svelte', () => ({ shellEligible: () => false }))
vi.mock('../../ts/alert', () => ({ alertError: vi.fn() }))
vi.mock('../../ts/process/moduleRefList', () => ({ moduleListOf: () => [] }))
vi.mock('../../ts/alertPrompts', () => ({ pageCovered: () => false }))
vi.mock('../../ts/alertBack', () => ({ closeDialogForBack: vi.fn() }))
vi.mock('../../ts/caughtErrors', () => ({ recordCaughtError: vi.fn() }))
vi.mock('../../ts/studio/loreTest', () => ({ runLoreTest: h.run }))
vi.mock('../../lang', async () => {
    const helpers = await import('../../ts/studio/studioFixtures.test-helpers')
    return { language: helpers.studioLanguageMock() }
})

import { dispatchBack, resetBackHandlersForTests } from '../../ts/backHandlers'
import { openStudio, resetStudioScreenForTests, selectStudioNode, studioScreen } from '../../ts/studio/studioScreen.svelte'
import { setStudioEnabled } from '../../ts/studio/studioSwitch.svelte'
import { studioOpen } from '../../ts/studio/studioOpen'
import { setWindowGeometryForTests } from '../../ts/windowing/windowHost.svelte'
import StudioScreen from './StudioScreen.svelte'
import { combinedKeyOf } from './StudioCombined.svelte'

class ResizeObserverStub {
    static instances: ResizeObserverStub[] = []
    constructor(private readonly callback: ResizeObserverCallback) {
        ResizeObserverStub.instances.push(this)
    }
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {
        ResizeObserverStub.instances = ResizeObserverStub.instances.filter((entry) => entry !== this)
    }
    emit(width: number): void {
        this.callback([{ contentRect: { width } } as ResizeObserverEntry], this as unknown as ResizeObserver)
    }
}

const ROWS = 1000
const ROW_PX = 44
const BAND_PX = 500
const OPENED = 600
const OPENED_ID = `cha-1/lore:${OPENED}`

// The scroller's offset in px. Every row sits at its own index times the row height below the list's top.
let scrolled = 0

function listTop(): number {
    return -scrolled
}

function installGeometry(): void {
    setWindowGeometryForTests({
        rectOf: (element) => {
            if (!(element instanceof HTMLElement)) return { top: 0, height: 0 }
            if (element.dataset.part === 'studio-combined-rows') return { top: listTop(), height: ROWS * ROW_PX }
            const position = Number(element.getAttribute('aria-posinset'))
            if (element.hasAttribute('data-window-key') && position > 0) return { top: listTop() + (position - 1) * ROW_PX, height: ROW_PX }
            return { top: 0, height: 0 }
        },
        viewport: () => BAND_PX,
        scrollBy: (_scroller, dy) => { scrolled += dy },
        schedule: (callback) => {
            callback()
            return () => {}
        },
    })
}

function longLoreDb(): ReturnType<typeof studioDbOf> {
    const globalLore = Array.from({ length: ROWS }, (_, index) => ({ comment: `lore ${index}`, key: `k${index}`, mode: 'normal' }))
    return studioDbOf(makeInput({ character: makeCharacter({ globalLore, chats: [makeChat({ id: 'chat-1', name: 'First chat' })] }) }))
}

let app: ReturnType<typeof mount> | undefined
let host: HTMLElement | undefined

function show(width: number): void {
    host = document.createElement('div')
    document.body.appendChild(host)
    app = mount(StudioScreen, { target: host })
    flushSync()
    for (const observer of ResizeObserverStub.instances) observer.emit(width)
    flushSync()
}

async function settle(): Promise<void> {
    for (let round = 0; round < 4; round += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0))
        flushSync()
    }
}

function back(): boolean {
    const handled = dispatchBack()
    flushSync()
    return handled
}

const part = (name: string) => document.querySelector<HTMLElement>(`[data-part="${name}"]`)
const mergedRow = (id: string) => Array.from(document.querySelectorAll<HTMLElement>('[data-part="studio-combined-row"]')).find((element) => element.dataset.itemId === id) ?? null

beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    ResizeObserverStub.instances = []
    localStorage.clear()
    resetBackHandlersForTests()
    resetStudioScreenForTests()
    settingsOpen.set(false)
    MobileGUI.set(false)
    db.db = longLoreDb()
    selection.selId = 0
    setStudioEnabled(true)
    scrolled = 0
    installGeometry()
})

afterEach(async () => {
    if (app) await unmount(app)
    app = undefined
    host?.remove()
    host = undefined
    setWindowGeometryForTests(undefined)
    resetStudioScreenForTests()
    resetBackHandlersForTests()
    setStudioEnabled(false)
    localStorage.clear()
    vi.unstubAllGlobals()
})

// The list on the phone: the merged lore entry picked from the tree, scrolled so that the row to open is in the band.
async function openMergedLoreAtRow(): Promise<void> {
    openStudio({ from: 'chat' }, null)
    show(400)
    expect(part('studio')?.getAttribute('data-layout')).toBe('stack')
    expect(part('studio-tree')).not.toBeNull()
    selectStudioNode(combinedKeyOf('lore'), 'lore', null)
    flushSync()
    scrolled = OPENED * ROW_PX - 200
    await settle()
    expect(part('studio-combined')).not.toBeNull()
}

describe('#572 Back from a merged-list entry', () => {
    test('returns to the merged list with the opened row in the band and focused, and the next Back goes to the tree', async () => {
        await openMergedLoreAtRow()
        const row = mergedRow(OPENED_ID)
        expect(row).not.toBeNull()
        row!.click()
        flushSync()
        expect(studioScreen.selectedOwnerKey).toBe('character:cha-1')
        expect(studioScreen.selectedItemId).toBe(OPENED_ID)
        expect(part('studio-combined')).toBeNull()

        // The owner detail used the same scroller, so the list comes back at another offset.
        scrolled = 0
        expect(back()).toBe(true)
        await settle()

        expect(get(studioOpen)).toBe(true)
        expect(studioScreen.detailShown).toBe(true)
        expect(studioScreen.selectedOwnerKey).toBe(combinedKeyOf('lore'))
        expect(part('studio-tree')).toBeNull()
        expect(part('studio-combined')).not.toBeNull()
        const restored = mergedRow(OPENED_ID)
        expect(restored).not.toBeNull()
        const top = listTop() + OPENED * ROW_PX
        expect(top).toBeGreaterThanOrEqual(0)
        expect(top + ROW_PX).toBeLessThanOrEqual(BAND_PX)
        expect(document.activeElement).toBe(restored)

        expect(back()).toBe(true)
        expect(studioScreen.detailShown).toBe(false)
        expect(part('studio-tree')).not.toBeNull()
        expect(get(studioOpen)).toBe(true)
    })

    test('Back from an entry opened out of the tree still goes to the tree', () => {
        openStudio({ from: 'chat' }, null)
        show(400)
        selectStudioNode('character:cha-1', 'lore', OPENED_ID)
        flushSync()
        expect(studioScreen.detailShown).toBe(true)
        expect(back()).toBe(true)
        expect(studioScreen.detailShown).toBe(false)
        expect(part('studio-tree')).not.toBeNull()
    })

    test('a pick elsewhere after the merged-list entry drops the way back to the list', async () => {
        await openMergedLoreAtRow()
        mergedRow(OPENED_ID)!.click()
        flushSync()
        // A jump out of the opened entry (search, a toggle use) selects another place: Back goes to the tree from there.
        selectStudioNode('character:cha-1', 'lore', 'cha-1/lore:3')
        flushSync()
        expect(back()).toBe(true)
        expect(studioScreen.detailShown).toBe(false)
        expect(part('studio-tree')).not.toBeNull()
    })
})

// #586: the merged toggles view and the lore tester are opened from the same merged list, so Back returns to them.
describe('#586 Back from the merged toggles view and from the lore tester', () => {
    test('an entry opened from the merged toggles view returns to that view with the entry focused', async () => {
        db.db = studioDbOf(makeInput({ character: makeCharacter({ customModuleToggle: 'ch=Char=check\nch2=Second=check', chats: [makeChat({ id: 'chat-1', name: 'First chat' })] } as Parameters<typeof makeCharacter>[0]) }))
        openStudio({ from: 'chat' }, null)
        show(400)
        selectStudioNode(combinedKeyOf('toggles'), 'toggles', null)
        flushSync()
        await vi.waitFor(() => expect(part('studio-tg-combined')).not.toBeNull())
        const entry = document.querySelector<HTMLElement>('[data-part="studio-tg-combined-entry"][data-key="ch2"]')
        expect(entry).not.toBeNull()
        entry!.click()
        flushSync()
        expect(studioScreen.selectedOwnerKey).toBe('character:cha-1')
        expect(part('studio-tg-combined')).toBeNull()

        expect(back()).toBe(true)
        await vi.waitFor(() => expect(document.activeElement).toBe(document.querySelector('[data-part="studio-tg-combined-entry"][data-key="ch2"]')))
        expect(studioScreen.selectedOwnerKey).toBe(combinedKeyOf('toggles'))
        expect(part('studio-tree')).toBeNull()

        expect(back()).toBe(true)
        expect(studioScreen.detailShown).toBe(false)
        expect(part('studio-tree')).not.toBeNull()
    })

    test('an entry opened from a lore test result returns to the lore list with that result focused', async () => {
        h.run.mockResolvedValue({
            status: 'ok', contextChat: { name: 'First chat' }, messageAdded: true, budget: { used: 1, limit: 1000 }, scanDepth: 5, attribution: 'ok',
            entries: [{ index: 3, label: 'tested', folder: false, owner: { type: 'character', id: null, index: 7 }, activated: true, reason: { kind: 'always', linked: false }, outcome: 'kept', mergedInto: null, warnings: [], tokens: 1, order: 1, chance: null }],
        })
        await openMergedLoreAtRow()
        const input = part('studio-lore-test-input') as HTMLTextAreaElement
        input.value = 'hello'
        input.dispatchEvent(new Event('input', { bubbles: true }))
        flushSync()
        ;(part('studio-lore-test-run') as HTMLButtonElement).click()
        await vi.waitFor(() => { flushSync(); expect(part('studio-lore-test-open')).not.toBeNull() })
        part('studio-lore-test-open')!.click()
        flushSync()
        expect(studioScreen.selectedItemId).toBe('cha-1/lore:7')
        expect(part('studio-combined')).toBeNull()

        expect(back()).toBe(true)
        await vi.waitFor(() => expect(document.activeElement).toBe(part('studio-lore-test-open')))
        expect(studioScreen.selectedOwnerKey).toBe(combinedKeyOf('lore'))

        expect(back()).toBe(true)
        expect(studioScreen.detailShown).toBe(false)
        expect(part('studio-tree')).not.toBeNull()
    })
})
