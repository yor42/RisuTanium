import { writable } from 'svelte/store'
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

// initHotkey() registers anonymous document listeners, so it is called once for
// the whole file. The triple-touch gesture opens the quick menu through
// alertSelect, which is what the tests observe.
//
// hotkey.ts pulls in a very heavy import graph, so every module it imports
// directly is replaced with a minimal stand-in, following hotkey.test.ts.

//#region module mocks

vi.mock(import('./storage/database.svelte'), () => {
    return {
        getDatabase: () => ({}),
        changeToPreset: vi.fn(),
    } as unknown as typeof import('./storage/database.svelte')
})

vi.mock(import('./stores.svelte'), () => {
    return {
        alertStore: writable({ type: 'none', msg: '' }),
        DBState: { db: {} as unknown },
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
    } as unknown as typeof import('./stores.svelte')
})

vi.mock(import('./alert'), () => {
    return {
        alertMd: vi.fn(),
        alertSelect: vi.fn(async () => '3'),
        alertToast: vi.fn(),
        alertWait: vi.fn(),
        doingAlert: () => false,
        alertRequestLogs: vi.fn(),
        alertClear: vi.fn(),
    } as unknown as typeof import('./alert')
})

vi.mock(import('./gui/colorscheme'), () => {
    return {
        updateTextThemeAndCSS: vi.fn(),
    } as unknown as typeof import('./gui/colorscheme')
})

vi.mock(import('./process/index.svelte'), () => {
    return {
        doingChat: writable(false),
        sendChat: vi.fn(),
    } as unknown as typeof import('./process/index.svelte')
})

vi.mock(import('./characters'), () => {
    return {
        changeChar: vi.fn(),
    } as unknown as typeof import('./characters')
})

//#endregion

import { alertSelect } from './alert'
import { initHotkey } from './hotkey'

function fire(type: string) {
    document.dispatchEvent(new Event(type, { bubbles: true }))
}

beforeAll(() => {
    initHotkey()
})

beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    vi.mocked(alertSelect).mockClear()
    fire('touchend')
})

afterEach(() => {
    vi.useRealTimers()
})

describe('triple-touch quick menu and touchcancel', () => {
    test('compatibility guard: three touchstarts within 300 ms open the quick menu', () => {
        fire('touchstart')
        fire('touchstart')
        fire('touchstart')
        expect(alertSelect).toHaveBeenCalledTimes(1)
    })

    test('two touches, a cancel, then one touch within 300 ms do not open the quick menu', () => {
        fire('touchstart')
        vi.advanceTimersByTime(50)
        fire('touchstart')
        vi.advanceTimersByTime(50)
        fire('touchcancel')
        vi.advanceTimersByTime(100)
        fire('touchstart')
        expect(alertSelect).not.toHaveBeenCalled()
    })

    test('compatibility guard: a count older than 300 ms cannot open the quick menu', () => {
        fire('touchstart')
        fire('touchstart')
        fire('touchcancel')
        vi.advanceTimersByTime(1000)
        fire('touchstart')
        expect(alertSelect).not.toHaveBeenCalled()
    })
})
