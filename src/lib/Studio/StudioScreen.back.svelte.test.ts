// @vitest-environment jsdom
/**
 * Back layers, Esc and the mouse back button of the Studio screen, mounted directly. The back
 * handler stack, the screen store and the real header are used; the stores are plain objects.
 */
import { flushSync, mount, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

interface TestCharacter {
    chaId: string
    type: string
    chatPage: number
    chats: { id: string }[]
}

const db = $state({ db: { characters: [] as TestCharacter[] } })
const selection = $state({ selId: 0 })
const MobileGUI = writable(false)
const settingsOpen = writable(false)
const ReloadGUIPointer = writable(0)
const CharConfigSubMenu = writable(0)
const SettingsMenuIndex = writable(-1)
const botMakerMode = writable(false)
const sideBarStore = writable(false)
const QuickSettings = $state({ open: true })

// The default tree and detail read the owner model and link out to the classic editors, so the stores they use are present.
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
vi.mock('../../ts/process/moduleRefList', () => ({ moduleListOf: () => [] }))
vi.mock('../../ts/alertPrompts', () => ({ pageCovered: () => false }))
vi.mock('../../ts/alertBack', () => ({ closeDialogForBack: vi.fn() }))
vi.mock('../../ts/caughtErrors', () => ({ recordCaughtError: vi.fn() }))
vi.mock('../../lang', async () => {
    const helpers = await import('../../ts/studio/studioFixtures.test-helpers')
    return { language: helpers.studioLanguageMock() }
})

import { dispatchBack, registerBackHandler, resetBackHandlersForTests } from '../../ts/backHandlers'
import type { SaveAck } from '../../ts/studio/edit/saveAck.svelte'
import type { OwnerHistoryService } from '../../ts/studio/history/ownerHistory.svelte'
import {
    resetStudioHistoryAccessorForTests,
    setStudioHistoryServiceForTests,
    setStudioVisitAckForTests,
} from '../../ts/studio/history/studioHistoryService.svelte'
import { registerStudioBackLayer } from '../../ts/studio/studioBack.svelte'
import {
    openStudio,
    pickStudioItem,
    resetStudioScreenForTests,
    setStudioHistoryOpen,
    setStudioRestoreSheetOpen,
    setStudioSelection,
    studioScreen,
} from '../../ts/studio/studioScreen.svelte'
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
let opener: HTMLButtonElement

const ownerTarget = { owner: { type: 'character', id: 'char' }, from: 'chat' } as const

function show(width: number | null = null): void {
    host = document.createElement('div')
    document.body.appendChild(host)
    app = mount(StudioScreen, { target: host })
    flushSync()
    if (width !== null) resize(width)
}

function resize(width: number): void {
    for (const observer of ResizeObserverStub.instances) observer.emit(width)
    flushSync()
}

const part = (name: string) => document.querySelector<HTMLElement>(`[data-part="${name}"]`)

function click(name: string): void {
    part(name)?.click()
    flushSync()
}

function back(): boolean {
    const handled = dispatchBack()
    flushSync()
    return handled
}

async function settleFocus(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    ResizeObserverStub.instances = []
    localStorage.clear()
    resetBackHandlersForTests()
    resetStudioScreenForTests()
    settingsOpen.set(false)
    MobileGUI.set(false)
    db.db.characters = [{ chaId: 'char', type: 'character', chatPage: 0, chats: [{ id: 'chat' }] }]
    selection.selId = 0
    setStudioEnabled(true)
    opener = document.createElement('button')
    document.body.appendChild(opener)
})

afterEach(async () => {
    if (app) await unmount(app)
    app = undefined
    host?.remove()
    host = undefined
    opener.remove()
    resetStudioHistoryAccessorForTests()
    resetStudioScreenForTests()
    resetBackHandlersForTests()
    setStudioEnabled(false)
    localStorage.clear()
    vi.unstubAllGlobals()
})

describe('open focus', () => {
    test('focus moves into Studio when it opens, so Esc and Ctrl+K reach the root handler', async () => {
        opener.focus()
        openStudio(ownerTarget, { element: opener })
        show(1200)
        await settleFocus()
        expect(document.activeElement).toBe(part('studio'))

        const ctrlK = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true })
        document.activeElement!.dispatchEvent(ctrlK)
        flushSync()
        expect(ctrlK.defaultPrevented).toBe(true)
        expect(studioScreen.searchOpen).toBe(true)
    })

    test('focus that is already inside Studio is left where it is', async () => {
        opener.focus()
        openStudio(ownerTarget, { element: opener })
        show(1200)
        const inner = part('studio-search-toggle')
        expect(inner).not.toBeNull()
        inner!.focus()
        await settleFocus()
        expect(document.activeElement).toBe(inner)
    })
})

describe('2d direct entry on a phone', () => {
    test('one Back goes to the origin and focus returns to the opener', async () => {
        openStudio(ownerTarget, { element: opener })
        show(400)
        expect(part('studio')?.getAttribute('data-layout')).toBe('stack')
        expect(studioScreen.detailShown).toBe(true)

        expect(back()).toBe(true)
        expect(get(studioOpen)).toBe(false)
        await settleFocus()
        expect(document.activeElement).toBe(opener)
    })

    test('the header Back button is Back', () => {
        openStudio(ownerTarget, { element: opener })
        show(400)
        click('studio-back')
        expect(get(studioOpen)).toBe(false)
    })

    test('a removed opener falls back to its selector, then to the transcript', async () => {
        const anchor = document.createElement('button')
        anchor.setAttribute('data-part', 'sidebar-more')
        document.body.appendChild(anchor)
        const gone = document.createElement('button')
        openStudio(ownerTarget, { element: gone, selector: '[data-part="sidebar-more"]' })
        show(400)
        back()
        await settleFocus()
        expect(document.activeElement).toBe(anchor)
        anchor.remove()
    })

    test('the mouse back button is Back and other buttons are not', () => {
        openStudio(ownerTarget, { element: opener })
        show(400)
        part('studio')?.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true }))
        flushSync()
        expect(get(studioOpen)).toBe(true)
        part('studio')?.dispatchEvent(new MouseEvent('mouseup', { button: 3, bubbles: true, cancelable: true }))
        flushSync()
        expect(get(studioOpen)).toBe(false)
    })
})

describe('2e through the list', () => {
    test('detail goes to the list, then to the origin', () => {
        openStudio(ownerTarget, { element: opener })
        show(400)
        click('studio-title')
        expect(studioScreen.detailShown).toBe(false)
        expect(part('studio-tree')).not.toBeNull()
        pickStudioItem()
        flushSync()
        expect(studioScreen.detailShown).toBe(true)

        expect(back()).toBe(true)
        expect(studioScreen.detailShown).toBe(false)
        expect(get(studioOpen)).toBe(true)
        expect(back()).toBe(true)
        expect(get(studioOpen)).toBe(false)
    })

    test('opening the list without picking still leaves in one Back', () => {
        openStudio(ownerTarget, { element: opener })
        show(400)
        click('studio-title')
        expect(back()).toBe(true)
        expect(get(studioOpen)).toBe(false)
    })
})

describe('2f layers close first', () => {
    test('the newest of search and drawer closes first, then the other, then Studio', () => {
        openStudio(ownerTarget, { element: opener })
        show(800)
        expect(part('studio-drawer-toggle')).not.toBeNull()
        click('studio-search-toggle')
        click('studio-drawer-toggle')
        expect(studioScreen.searchOpen).toBe(true)
        expect(studioScreen.drawerOpen).toBe(true)

        back()
        expect(studioScreen.drawerOpen).toBe(false)
        expect(studioScreen.searchOpen).toBe(true)
        back()
        expect(studioScreen.searchOpen).toBe(false)
        expect(get(studioOpen)).toBe(true)
        back()
        expect(get(studioOpen)).toBe(false)
    })

    test('the drawer opened first closes last', () => {
        openStudio(ownerTarget, { element: opener })
        show(800)
        click('studio-drawer-toggle')
        click('studio-search-toggle')
        back()
        expect(studioScreen.searchOpen).toBe(false)
        expect(studioScreen.drawerOpen).toBe(true)
    })

    test('a close that changes nothing is not a handled press and falls through', () => {
        const older = vi.fn(() => true)
        registerBackHandler(older)
        const stop = $effect.root(() => {
            registerStudioBackLayer({ isOpen: () => true, close: () => {} })
        })
        flushSync()
        expect(dispatchBack()).toBe(true)
        expect(older).toHaveBeenCalledTimes(1)
        stop()
    })

    test('with no layer open and no Studio, Back reaches older handlers untouched', () => {
        const older = vi.fn(() => true)
        registerBackHandler(older)
        show(800)
        expect(dispatchBack()).toBe(true)
        expect(older).toHaveBeenCalledTimes(1)
    })
})

describe('2f2 rotation with layers open', () => {
    test('the drawer handler goes with the drawer and search stays; a direct entry still leaves in one more Back', () => {
        openStudio(ownerTarget, { element: opener })
        show(800)
        click('studio-drawer-toggle')
        click('studio-search-toggle')
        resize(400)
        expect(studioScreen.drawerOpen).toBe(false)
        expect(studioScreen.searchOpen).toBe(true)

        back()
        expect(studioScreen.searchOpen).toBe(false)
        expect(get(studioOpen)).toBe(true)
        back()
        expect(get(studioOpen)).toBe(false)
    })

    test('viaList follows pickedInVisit across the rotation', () => {
        openStudio(ownerTarget, { element: opener })
        show(800)
        pickStudioItem()
        click('studio-drawer-toggle')
        click('studio-search-toggle')
        resize(400)

        back()
        expect(studioScreen.searchOpen).toBe(false)
        expect(studioScreen.detailShown).toBe(true)
        back()
        expect(studioScreen.detailShown).toBe(false)
        expect(get(studioOpen)).toBe(true)
        back()
        expect(get(studioOpen)).toBe(false)
    })
})

describe('2g Esc', () => {
    function press(init: KeyboardEventInit & { keyCode?: number }): KeyboardEvent {
        const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, ...init })
        if (init.keyCode !== undefined) Object.defineProperty(event, 'keyCode', { value: init.keyCode })
        part('studio')?.dispatchEvent(event)
        flushSync()
        return event
    }

    test('with no layer open Esc keeps Studio open', () => {
        openStudio(ownerTarget, { element: opener })
        show(800)
        press({})
        expect(get(studioOpen)).toBe(true)
    })

    test('Esc closes search, then the drawer, and never Studio', () => {
        openStudio(ownerTarget, { element: opener })
        show(800)
        click('studio-drawer-toggle')
        click('studio-search-toggle')
        expect(press({}).defaultPrevented).toBe(true)
        expect(studioScreen.searchOpen).toBe(false)
        expect(studioScreen.drawerOpen).toBe(true)
        press({})
        expect(studioScreen.drawerOpen).toBe(false)
        press({})
        expect(get(studioOpen)).toBe(true)
    })

    test('an Esc that belongs to an IME composition is ignored', () => {
        openStudio(ownerTarget, { element: opener })
        show(800)
        click('studio-search-toggle')
        press({ isComposing: true })
        press({ keyCode: 229 })
        expect(studioScreen.searchOpen).toBe(true)
        press({})
        expect(studioScreen.searchOpen).toBe(false)
    })
})

describe('2h the History panel and the restore sheet are Back layers', () => {
    // The history service is a stand-in here: this suite is about layering, and the panel and the sheet have their
    // own suites over the real service.
    const stubAck = { display: 'idle', canRetry: () => false, retry: () => false, noteEdit: () => {}, dispose: () => {} } as unknown as SaveAck

    beforeEach(() => {
        setStudioHistoryServiceForTests({
            useOwner: () => {},
            setAck: () => {},
            closeOpenStep: () => {},
            view: (owner: string) => ({
                ownerKey: owner, phase: 'ready', banner: null, restricted: false, editable: true, persisted: true,
                done: [], undone: [], deleted: [], restore: null,
            }),
        } as unknown as OwnerHistoryService)
        setStudioVisitAckForTests(stubAck)
    })

    function showWithHistory(width: number): void {
        openStudio(ownerTarget, { element: opener })
        show(width)
        setStudioSelection('character:char', null, null)
        flushSync()
    }

    function pressOn(target: HTMLElement, init: KeyboardEventInit): KeyboardEvent {
        const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, ...init })
        target.dispatchEvent(event)
        flushSync()
        return event
    }

    test('T-UI6 the header opens the panel; Back closes it before it leaves Studio', () => {
        showWithHistory(1200)
        click('studio-history-toggle')
        expect(studioScreen.historyOpen).toBe(true)
        expect(part('studio-history')).not.toBeNull()

        expect(back()).toBe(true)
        expect(studioScreen.historyOpen).toBe(false)
        expect(part('studio-history')).toBeNull()
        expect(get(studioOpen)).toBe(true)
        expect(back()).toBe(true)
        expect(get(studioOpen)).toBe(false)
    })

    test('T-UI6 Esc closes the panel and never Studio', () => {
        showWithHistory(1200)
        click('studio-history-toggle')
        expect(pressOn(part('studio')!, {}).defaultPrevented).toBe(true)
        expect(studioScreen.historyOpen).toBe(false)
        pressOn(part('studio')!, {})
        expect(get(studioOpen)).toBe(true)
    })

    test('the newest of the panel and the search closes first, in Back and in Esc', () => {
        showWithHistory(1200)
        click('studio-history-toggle')
        click('studio-search-toggle')
        back()
        expect(studioScreen.searchOpen).toBe(false)
        expect(studioScreen.historyOpen).toBe(true)
        back()
        expect(studioScreen.historyOpen).toBe(false)

        click('studio-history-toggle')
        click('studio-search-toggle')
        pressOn(part('studio')!, {})
        expect(studioScreen.searchOpen).toBe(false)
        expect(studioScreen.historyOpen).toBe(true)
        pressOn(part('studio')!, {})
        expect(studioScreen.historyOpen).toBe(false)
    })

    test('on a phone the panel closes before the detail goes back to the list, whatever opened last', () => {
        showWithHistory(400)
        click('studio-title')
        pickStudioItem()
        flushSync()
        expect(studioScreen.detailShown).toBe(true)
        click('studio-history-toggle')
        click('studio-search-toggle')
        click('studio-search-toggle')
        expect(studioScreen.historyOpen).toBe(true)

        back()
        expect(studioScreen.historyOpen).toBe(false)
        expect(studioScreen.detailShown).toBe(true)
        back()
        expect(studioScreen.detailShown).toBe(false)
        expect(get(studioOpen)).toBe(true)
        back()
        expect(get(studioOpen)).toBe(false)
    })

    test('T-UI10 the sheet is above the panel: Back, then Back, then Back', () => {
        showWithHistory(1200)
        click('studio-history-toggle')
        setStudioRestoreSheetOpen(true)
        flushSync()
        expect(part('studio-restore-sheet')).not.toBeNull()

        back()
        expect(part('studio-restore-sheet')).toBeNull()
        expect(studioScreen.historyOpen).toBe(true)
        expect(get(studioOpen)).toBe(true)
        back()
        expect(studioScreen.historyOpen).toBe(false)
        expect(get(studioOpen)).toBe(true)
        back()
        expect(get(studioOpen)).toBe(false)
    })

    test('T-UI10 Esc on Cancel closes only the sheet', () => {
        showWithHistory(1200)
        click('studio-history-toggle')
        setStudioRestoreSheetOpen(true)
        flushSync()
        const cancel = part('studio-restore-cancel')!
        expect(pressOn(cancel, {}).defaultPrevented).toBe(true)
        expect(part('studio-restore-sheet')).toBeNull()
        expect(studioScreen.historyOpen).toBe(true)
        expect(get(studioOpen)).toBe(true)
    })

    // Back is newest-first, Esc closes the sheet first and then search, the drawer and the panel in that fixed
    // order. They differ only when a layer opens after the sheet; each closes one layer and none leaves Studio.
    test('a search opened over the sheet: Back closes the search first, Esc closes the sheet first', () => {
        showWithHistory(1200)
        click('studio-history-toggle')
        setStudioRestoreSheetOpen(true)
        flushSync()
        click('studio-search-toggle')
        expect(studioScreen.searchOpen).toBe(true)

        back()
        expect(studioScreen.searchOpen).toBe(false)
        expect(studioScreen.restoreSheetOpen).toBe(true)

        click('studio-search-toggle')
        expect(pressOn(part('studio')!, {}).defaultPrevented).toBe(true)
        expect(studioScreen.restoreSheetOpen).toBe(false)
        expect(studioScreen.searchOpen).toBe(true)
        expect(studioScreen.historyOpen).toBe(true)
        expect(get(studioOpen)).toBe(true)
    })

    test('the sheet opens only while the panel is open', () => {
        showWithHistory(1200)
        setStudioRestoreSheetOpen(true)
        flushSync()
        expect(studioScreen.restoreSheetOpen).toBe(false)
        expect(part('studio-restore-sheet')).toBeNull()
        setStudioHistoryOpen(true)
        setStudioRestoreSheetOpen(true)
        flushSync()
        expect(part('studio-restore-sheet')).not.toBeNull()
    })
})

describe('default panes', () => {
    test.each([1200, 800, 400] as const)('a %i px screen renders the tree and the detail without being handed any', (width) => {
        openStudio(ownerTarget, { element: opener })
        show(width)
        if (width === 800) click('studio-drawer-toggle')
        if (width === 400) {
            expect(part('studio-detail-body')).not.toBeNull()
            click('studio-title')
            expect(part('studio-tree-list')).not.toBeNull()
        } else {
            expect(part('studio-tree-list')).not.toBeNull()
            expect(part('studio-detail-body')).not.toBeNull()
        }
    })
})

describe('notice line', () => {
    test('a set notice shows in the status line and dismisses', () => {
        openStudio(ownerTarget, { element: opener })
        show(800)
        studioScreen.notice = 'Hello'
        flushSync()
        expect(part('studio-notice')?.getAttribute('role')).toBe('status')
        expect(part('studio-notice-text')?.textContent).toBe('Hello')
        click('studio-notice-dismiss')
        expect(studioScreen.notice).toBeNull()
        expect(part('studio-notice-text')).toBeNull()
    })

    test('navigating on clears it', () => {
        openStudio(ownerTarget, { element: opener })
        show(400)
        studioScreen.notice = 'Hello'
        flushSync()
        click('studio-title')
        expect(studioScreen.notice).toBeNull()
    })
})
