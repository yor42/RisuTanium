/**
 * A drag over the page while Ctrl is held does not scroll the sidebar rail to the active
 * character: the rail's drag is pointer based, and the hotkey path is the only trigger of
 * `scrollToActiveCharacter`.
 *
 * Drives the REAL document listeners registered by `initHotkey()` with a real `dragover`
 * event that carries the HTML5 rail drag data type, and listens for the
 * `scrollToActiveCharacter` event on the real `window`.
 */
import { writable } from 'svelte/store'
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import type { Database } from './storage/database.svelte'
import 'src/ts/polyfill'

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))

vi.mock(import('./platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('./platform'))

vi.mock(import('./stores.svelte'), () => ({
    DBState: { db: { enableScrollToActiveChar: true } as unknown as Database },
    alertStore: writable({ type: 'none', msg: '' }),
    loadoutModalStore: { open: false },
    MobileGUIStack: writable(0),
    MobileSideBar: writable(0),
    openPersonaList: writable(false),
    openPresetList: writable(false),
    OpenRealmStore: writable(false),
    PlaygroundStore: writable(0),
    QuickSettings: { open: false, index: 0 },
    SafeModeStore: writable(false),
    selectedCharID: writable(-1),
    settingsOpen: writable(false),
}) as unknown as typeof import('./stores.svelte'))

vi.mock(import('./storage/database.svelte'), async () => {
    const { DBState: liveDBState } = await import('./stores.svelte')
    return {
        getDatabase: vi.fn(() => liveDBState.db),
        changeToPreset: vi.fn(),
        getCurrentCharacter: vi.fn(() => ({ name: 'Bob' })),
    } as unknown as typeof import('./storage/database.svelte')
})

vi.mock(import('./gui/colorscheme'), () => ({
    updateTextThemeAndCSS: vi.fn(),
}) as unknown as typeof import('./gui/colorscheme'))

vi.mock(import('./characters'), () => ({
    changeChar: vi.fn(),
}) as unknown as typeof import('./characters'))

vi.mock(import('./process/index.svelte'), () => ({
    doingChat: writable(false),
    sendChat: vi.fn(),
}) as unknown as typeof import('./process/index.svelte'))

import { initHotkey } from './hotkey'

const RAIL_DRAG_TYPE ='application/x-risu-sidebar-drag'

const scrollRequests: Event[] = []
const onScrollRequest = (e: Event) => scrollRequests.push(e)

beforeAll(() => {
    initHotkey()
    window.addEventListener('scrollToActiveCharacter', onScrollRequest)
})

afterEach(() => {
    scrollRequests.length = 0
})

afterAll(() => {
    window.removeEventListener('scrollToActiveCharacter', onScrollRequest)
})

function dragOver(init: { ctrlKey: boolean; types: string[] }): Event {
    const ev = new Event('dragover', { bubbles: true, cancelable: true }) as Event & { ctrlKey: boolean; shiftKey: boolean; altKey: boolean }
    Object.defineProperty(ev, 'ctrlKey', { value: init.ctrlKey })
    Object.defineProperty(ev, 'dataTransfer', { value: { types: init.types } })
    document.body.dispatchEvent(ev)
    return ev
}

describe('Ctrl while dragging over the page', () => {
    test('a dragover carrying the rail drag type does not request a scroll to the active character', () => {
        dragOver({ ctrlKey: true, types: [RAIL_DRAG_TYPE] })
        expect(scrollRequests).toHaveLength(0)
    })

    test('guard: an ordinary dragover does not request one either', () => {
        dragOver({ ctrlKey: true, types: ['Files'] })
        expect(scrollRequests).toHaveLength(0)
    })
})
