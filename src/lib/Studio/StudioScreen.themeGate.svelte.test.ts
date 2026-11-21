// @vitest-environment jsdom
/**
 * C1: a mounted StudioScreen declares the studio surface, and releases it when it unmounts, so a registered studio sheet is on
 * exactly while the screen is mounted. REAL: StudioScreen, the surface gate and the Studio stores. The cover is off and the
 * stores are plain objects, as in StudioScreen.back.svelte.test.ts.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

interface TestCharacter {
    chaId: string
    name?: string
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
vi.mock('../../lang', async () => {
    const helpers = await import('../../ts/studio/studioFixtures.test-helpers')
    return { language: helpers.studioLanguageMock() }
})

import { resetBackHandlersForTests } from '../../ts/backHandlers'
import { resetStudioHistoryAccessorForTests } from '../../ts/studio/history/studioHistoryService.svelte'
import { openStudio, resetStudioScreenForTests } from '../../ts/studio/studioScreen.svelte'
import { setStudioEnabled } from '../../ts/studio/studioSwitch.svelte'
import { installThemePackGate, registerThemePackElement, resetThemePackGateForTests, shownScreen, syncThemePackMedia } from '../../ts/themePack/surfaceGate.svelte'
import StudioScreen from './StudioScreen.svelte'

class ResizeObserverStub {
    constructor(_callback: ResizeObserverCallback) {}
    observe(): void {}
    disconnect(): void {}
}

let app: ReturnType<typeof mount> | undefined
let host: HTMLElement | undefined

function show(): void {
    host = document.createElement('div')
    document.body.appendChild(host)
    app = mount(StudioScreen, { target: host })
    flushSync()
}

async function hide(): Promise<void> {
    if (app) await unmount(app)
    app = undefined
    host?.remove()
    host = undefined
    flushSync()
}

function studioSheet(): HTMLStyleElement {
    const element = document.createElement('style')
    element.setAttribute('data-theme-pack', 'studio')
    element.setAttribute('media', 'not all')
    document.head.appendChild(element)
    registerThemePackElement(element, 'studio', null)
    syncThemePackMedia()
    return element
}

beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    localStorage.clear()
    resetBackHandlersForTests()
    resetStudioScreenForTests()
    settingsOpen.set(false)
    MobileGUI.set(false)
    db.db.characters = [{ chaId: 'char', type: 'character', chatPage: 0, chats: [{ id: 'chat' }] }]
    selection.selId = 0
    setStudioEnabled(true)
    installThemePackGate(() => false)
    openStudio({ owner: { type: 'character', id: 'char' }, from: 'chat' }, { element: document.body })
})

afterEach(async () => {
    await hide()
    resetThemePackGateForTests()
    document.head.innerHTML = ''
    resetStudioHistoryAccessorForTests()
    resetStudioScreenForTests()
    resetBackHandlersForTests()
    setStudioEnabled(false)
    localStorage.clear()
    vi.unstubAllGlobals()
})

describe('C1 StudioScreen declares the studio surface', () => {
    test('a registered studio sheet is off before the screen mounts, on while it is mounted, and off after it unmounts', async () => {
        const sheet = studioSheet()
        expect(sheet.getAttribute('media')).toBe('not all')
        show()
        expect(sheet.getAttribute('media')).toBe('all')
        expect(shownScreen()).toBe('studio')
        await hide()
        expect(sheet.getAttribute('media')).toBe('not all')
        expect(shownScreen()).toBeNull()
    })
})