// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { flushSync } from 'svelte'
import { get, writable } from 'svelte/store'
import {
    clearStudioSelection,
    closeStudio,
    openStudio,
    pickStudioItem,
    resetStudioScreenForTests,
    selectedHistoryOwner,
    selectStudioNode,
    setStudioHistoryOpen,
    setStudioLayout,
    setStudioRestoreSheetOpen,
    setStudioSelection,
    showStudioList,
    studioScreen,
    studioViaList,
} from './studioScreen.svelte'
import { setStudioEnabled } from './studioSwitch.svelte'
import { studioOpen } from './studioOpen'
import { classicLinks } from './classicLinks.svelte'

interface TestCharacter {
    chaId: string
    type: string
    coldstorage?: string
    chatPage: number
    chats: { id: string }[]
}

const db = $state({ db: { theme: '', characters: [] as TestCharacter[] } })
const selection = $state({ selId: -1 })
const MobileGUI = writable(false)
const settingsOpen = writable(false)
const reads = { count: 0 }

// Getters: the statically imported modules are evaluated before these consts are initialised.
vi.mock('../stores.svelte', () => ({
    get DBState() { reads.count += 1; return db },
    get selIdState() { reads.count += 1; return selection },
    get MobileGUI() { reads.count += 1; return MobileGUI },
    get settingsOpen() { reads.count += 1; return settingsOpen },
}))

function character(overrides: Partial<TestCharacter> = {}): TestCharacter {
    return { chaId: 'char', type: 'character', chatPage: 0, chats: [{ id: 'chat' }], ...overrides }
}

beforeEach(() => {
    localStorage.clear()
    resetStudioScreenForTests()
    settingsOpen.set(false)
    MobileGUI.set(false)
    db.db.characters = [character(), character({ chaId: 'other' }), character({ chaId: 'grp', type: 'group' })]
    selection.selId = 0
    setStudioEnabled(true)
})

afterEach(() => {
    resetStudioScreenForTests()
    setStudioEnabled(false)
    localStorage.clear()
})

const ownerTarget = { owner: { type: 'character', id: 'char' }, from: 'chat' } as const

describe('2c studio screen store', () => {
    test('opening binds the selected character and starts a fresh visit', () => {
        const opener = { element: null, selector: '#opener' }
        expect(openStudio(ownerTarget, opener)).toBe(true)
        expect(get(studioOpen)).toBe(true)
        expect(studioScreen.open).toBe(true)
        expect(studioScreen.chaId).toBe('char')
        expect(studioScreen.from).toBe('chat')
        expect(studioScreen.opener).toEqual(opener)
        expect(studioScreen.pickedInVisit).toBe(false)
        expect(studioScreen.detailShown).toBe(true)
    })

    test('an entry without an owner lands on the list', () => {
        expect(openStudio({ from: 'library' }, null)).toBe(true)
        expect(studioScreen.detailShown).toBe(false)
    })

    test('a refused open changes nothing: switch off, no selection, group, cold stub, missing character', () => {
        setStudioEnabled(false)
        expect(openStudio(ownerTarget, null)).toBe(false)
        setStudioEnabled(true)
        selection.selId = -1
        expect(openStudio(ownerTarget, null)).toBe(false)
        selection.selId = 2
        expect(openStudio(ownerTarget, null)).toBe(false)
        selection.selId = 0
        db.db.characters[0].coldstorage = 'unit'
        expect(openStudio(ownerTarget, null)).toBe(false)
        selection.selId = 9
        expect(openStudio(ownerTarget, null)).toBe(false)
        expect(get(studioOpen)).toBe(false)
        expect(studioScreen.open).toBe(false)
        expect(studioScreen.chaId).toBe('')
    })

    test('Settings wins: an open is refused while Settings is open', () => {
        settingsOpen.set(true)
        expect(openStudio(ownerTarget, null)).toBe(false)
        expect(get(studioOpen)).toBe(false)
    })

    test('closes when Settings opens and does not return when it closes', () => {
        openStudio(ownerTarget, null)
        settingsOpen.set(true)
        expect(get(studioOpen)).toBe(false)
        settingsOpen.set(false)
        flushSync()
        expect(get(studioOpen)).toBe(false)
    })

    test('closes when the switch turns off', () => {
        openStudio(ownerTarget, null)
        flushSync()
        expect(get(studioOpen)).toBe(true)
        setStudioEnabled(false)
        flushSync()
        expect(get(studioOpen)).toBe(false)
    })

    test('closes when the selection moves to another character', () => {
        openStudio(ownerTarget, null)
        flushSync()
        selection.selId = 1
        flushSync()
        expect(get(studioOpen)).toBe(false)
    })

    test('closes when the bound character stops being eligible or disappears', () => {
        openStudio(ownerTarget, null)
        flushSync()
        db.db.characters[0].type = 'group'
        flushSync()
        expect(get(studioOpen)).toBe(false)

        db.db.characters[0].type = 'character'
        openStudio(ownerTarget, null)
        flushSync()
        expect(get(studioOpen)).toBe(true)
        db.db.characters = []
        flushSync()
        expect(get(studioOpen)).toBe(false)
    })

    test('closes when the Beta Mobile GUI turns on', () => {
        openStudio(ownerTarget, null)
        flushSync()
        MobileGUI.set(true)
        flushSync()
        expect(get(studioOpen)).toBe(false)
    })

    test('stays open while the same character remains selected', () => {
        openStudio(ownerTarget, null)
        flushSync()
        db.db.characters[0].chatPage = 0
        selection.selId = 0
        flushSync()
        expect(get(studioOpen)).toBe(true)
    })

    test('an external reset of the flag is followed by the mirror', () => {
        openStudio(ownerTarget, null)
        studioOpen.set(false)
        expect(studioScreen.open).toBe(false)
    })

    test('closing ends the layers of the visit', () => {
        openStudio(ownerTarget, null)
        studioScreen.searchOpen = true
        studioScreen.drawerOpen = true
        closeStudio()
        expect(studioScreen.searchOpen).toBe(false)
        expect(studioScreen.drawerOpen).toBe(false)
        expect(get(studioOpen)).toBe(false)
    })
})

describe('4g leftover link-out request', () => {
    test('a successful open clears a request left by an earlier visit', () => {
        classicLinks.request = { view: 'characterSettings' }
        expect(openStudio(ownerTarget, null)).toBe(true)
        expect(classicLinks.request).toBeNull()
    })

    test('a refused open leaves the request alone', () => {
        classicLinks.request = { view: 'characterSettings' }
        setStudioEnabled(false)
        expect(openStudio(ownerTarget, null)).toBe(false)
        expect(classicLinks.request).toEqual({ view: 'characterSettings' })
        setStudioEnabled(true)
        settingsOpen.set(true)
        expect(openStudio(ownerTarget, null)).toBe(false)
        expect(classicLinks.request).toEqual({ view: 'characterSettings' })
    })
})

describe('4b visit state', () => {
    test('a new visit starts with nothing selected, nothing opened and the target pending', () => {
        openStudio(ownerTarget, null)
        expect(studioScreen.targetPending).toBe(true)
        expect(studioScreen.selectedOwnerKey).toBeNull()
        expect(studioScreen.expanded).toEqual({})
        expect(studioScreen.hideEmpty).toBe(false)
    })

    test('closing ends the selection and the opened rows, so the next visit starts clean', () => {
        openStudio(ownerTarget, null)
        studioScreen.selectedOwnerKey = 'character:char'
        studioScreen.expanded = { 'o:character:char': true }
        studioScreen.pages = { 'k:character:char/lore': 2 }
        studioScreen.hideEmpty = true
        studioOpen.set(false)
        expect(studioScreen.selectedOwnerKey).toBeNull()
        expect(studioScreen.expanded).toEqual({})
        expect(studioScreen.pages).toEqual({})
        expect(studioScreen.hideEmpty).toBe(false)
    })
})

describe('2c visit navigation state', () => {
    test('a pick from the list is the only thing that makes Back go through the list', () => {
        openStudio(ownerTarget, null)
        setStudioLayout('stack')
        expect(studioViaList()).toBe(false)
        showStudioList()
        expect(studioScreen.detailShown).toBe(false)
        expect(studioViaList()).toBe(false)
        pickStudioItem()
        expect(studioScreen.pickedInVisit).toBe(true)
        expect(studioViaList()).toBe(true)
        setStudioLayout('wide')
        expect(studioViaList()).toBe(false)
    })

    test('leaving the drawer layout closes the drawer and other layers stay', () => {
        openStudio(ownerTarget, null)
        setStudioLayout('drawer')
        studioScreen.drawerOpen = true
        studioScreen.searchOpen = true
        setStudioLayout('stack')
        expect(studioScreen.drawerOpen).toBe(false)
        expect(studioScreen.searchOpen).toBe(true)
    })

    test('a pick from the drawer closes it and clears a notice', () => {
        openStudio(ownerTarget, null)
        setStudioLayout('drawer')
        studioScreen.drawerOpen = true
        studioScreen.notice = 'x'
        pickStudioItem()
        expect(studioScreen.drawerOpen).toBe(false)
        expect(studioScreen.notice).toBeNull()
    })

    test('every accepted open gets a new visitId, a refused open keeps the old one', () => {
        expect(studioScreen.visitId).toBe('')
        expect(openStudio(ownerTarget, null)).toBe(true)
        const first = studioScreen.visitId
        expect(first).not.toBe('')
        expect(openStudio(ownerTarget, null)).toBe(true)
        const second = studioScreen.visitId
        expect(second).not.toBe(first)
        selection.selId = -1
        expect(openStudio(ownerTarget, null)).toBe(false)
        expect(studioScreen.visitId).toBe(second)
    })

    test('closing the visit keeps its visitId for a toast that outlives it, and a reset clears it', () => {
        openStudio(ownerTarget, null)
        const id = studioScreen.visitId
        closeStudio()
        expect(studioScreen.visitId).toBe(id)
        resetStudioScreenForTests()
        expect(studioScreen.visitId).toBe('')
    })

    test('visit ids differ across page loads, so a stored restore point of an earlier page never matches', async () => {
        openStudio(ownerTarget, null)
        const here = studioScreen.visitId
        vi.resetModules()
        const fresh = await import('./studioScreen.svelte')
        fresh.openStudio(ownerTarget, null)
        expect(fresh.studioScreen.visitId).not.toBe(here)
        fresh.resetStudioScreenForTests()
    })
})

describe('history panel and restore sheet flags (R5-14)', () => {
    function openSheet(): void {
        openStudio(ownerTarget, null)
        setStudioSelection('character:char', 'basic', null)
        setStudioHistoryOpen(true)
        setStudioRestoreSheetOpen(true)
        expect(studioScreen.historyOpen).toBe(true)
        expect(studioScreen.restoreSheetOpen).toBe(true)
    }

    test('both start closed', () => {
        openStudio(ownerTarget, null)
        expect(studioScreen.historyOpen).toBe(false)
        expect(studioScreen.restoreSheetOpen).toBe(false)
    })

    test('the sheet opens only while the panel is open', () => {
        openStudio(ownerTarget, null)
        setStudioRestoreSheetOpen(true)
        expect(studioScreen.restoreSheetOpen).toBe(false)
        setStudioHistoryOpen(true)
        setStudioRestoreSheetOpen(true)
        expect(studioScreen.restoreSheetOpen).toBe(true)
    })

    test('closing the panel closes the sheet; closing the sheet keeps the panel', () => {
        openSheet()
        setStudioRestoreSheetOpen(false)
        expect(studioScreen.historyOpen).toBe(true)
        expect(studioScreen.restoreSheetOpen).toBe(false)
        setStudioRestoreSheetOpen(true)
        setStudioHistoryOpen(false)
        expect(studioScreen.restoreSheetOpen).toBe(false)
    })

    test('closing the visit and starting a new one clear both', () => {
        openSheet()
        closeStudio()
        expect(studioScreen.historyOpen).toBe(false)
        expect(studioScreen.restoreSheetOpen).toBe(false)
        openSheet()
        openStudio(ownerTarget, null)
        expect(studioScreen.historyOpen).toBe(false)
        expect(studioScreen.restoreSheetOpen).toBe(false)
    })

    test('selecting another owner closes the sheet and keeps the panel (M51d)', () => {
        openSheet()
        selectStudioNode('chat:chat', null, null)
        expect(studioScreen.restoreSheetOpen).toBe(false)
        expect(studioScreen.historyOpen).toBe(true)
    })

    test('choosing another kind of the same owner keeps the sheet', () => {
        openSheet()
        setStudioSelection('character:char', 'lore', null)
        expect(studioScreen.restoreSheetOpen).toBe(true)
    })

    test('dropping the selection closes the sheet', () => {
        openSheet()
        clearStudioSelection('gone')
        expect(studioScreen.restoreSheetOpen).toBe(false)
        expect(studioScreen.historyOpen).toBe(true)
    })

    test('the test reset clears both', () => {
        openSheet()
        resetStudioScreenForTests()
        expect(studioScreen.historyOpen).toBe(false)
        expect(studioScreen.restoreSheetOpen).toBe(false)
    })
})

describe('the history owner of the selection', () => {
    function openOn(selectedKey: string | null): void {
        openStudio(ownerTarget, null)
        studioScreen.selectedOwnerKey = selectedKey
    }

    test('nothing selected, or no visit, has no history owner', () => {
        expect(selectedHistoryOwner()).toBeNull()
        openOn(null)
        expect(selectedHistoryOwner()).toBeNull()
    })

    test('the bound character and its chat map to their history owners', () => {
        openOn('character:char')
        expect(selectedHistoryOwner()).toBe('character:char')
        studioScreen.selectedOwnerKey = 'chat:chat'
        expect(selectedHistoryOwner()).toBe('chat:char/chat')
    })

    test('every other owner has none', () => {
        openOn('character:other')
        expect(selectedHistoryOwner()).toBeNull()
        for (const key of ['module:res', 'preset:Main', 'plugin:p', 'chat:', 'chat', 'character:']) {
            studioScreen.selectedOwnerKey = key
            expect(selectedHistoryOwner()).toBeNull()
        }
    })

    test('the owner follows the selection', () => {
        openOn('character:char')
        setStudioSelection('chat:chat', null, null)
        expect(selectedHistoryOwner()).toBe('chat:char/chat')
        clearStudioSelection('gone')
        expect(selectedHistoryOwner()).toBeNull()
    })
})

describe('I8 import-time rule', () => {
    test('importing the screen module and checking an off switch read no store', async () => {
        setStudioEnabled(false)
        vi.resetModules()
        reads.count = 0
        const fresh = await import('./studioScreen.svelte')
        const switchModule = await import('./studioSwitch.svelte')
        expect(reads.count).toBe(0)
        expect(switchModule.studioEligible()).toBe(false)
        expect(fresh.openStudio(ownerTarget, null)).toBe(false)
        expect(reads.count).toBe(0)
    })
})
