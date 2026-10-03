import { get, writable } from 'svelte/store'
import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, test, vi } from 'vitest'

// initMobileGesture() registers anonymous document listeners, so it is called
// once for the whole file; each test starts from a known store state and uses
// touch identifiers of its own.
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
        alertSelect: vi.fn(),
        alertToast: vi.fn(),
        alertWait: vi.fn(),
        doingAlert: () => false,
        alertRequestLogs: vi.fn(),
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

import { MobileGUIStack, MobileSideBar, selectedCharID } from './stores.svelte'
import { initMobileGesture } from './hotkey'

interface FakeTouch {
    identifier: number
    target: EventTarget
    clientX: number
    clientY: number
}

function touch(identifier: number, target: EventTarget, clientX: number, clientY = 100): FakeTouch {
    return { identifier, target, clientX, clientY }
}

function fire(type: 'touchstart' | 'touchend' | 'touchcancel', target: EventTarget, changed: FakeTouch[]) {
    const ev = new TouchEvent(type, {
        bubbles: true,
        cancelable: true,
        changedTouches: changed as unknown as Touch[],
    })
    target.dispatchEvent(ev)
}

let stopGesture: (() => void) | undefined
let plain: HTMLDivElement
let button: HTMLButtonElement
let input: HTMLInputElement
let errors: unknown[]
const onError = (ev: ErrorEvent) => {
    errors.push(ev.error ?? ev.message)
    ev.preventDefault()
}

beforeAll(() => {
    stopGesture = initMobileGesture()
})

afterAll(() => {
    stopGesture?.()
})

beforeEach(() => {
    errors = []
    window.addEventListener('error', onError)
    selectedCharID.set(-1)
    MobileGUIStack.set(1)
    MobileSideBar.set(1)
    plain = document.createElement('div')
    button = document.createElement('button')
    input = document.createElement('input')
    document.body.append(plain, button, input)
})

afterEach(() => {
    window.removeEventListener('error', onError)
    plain.remove()
    button.remove()
    input.remove()
})

describe('initMobileGesture: swipes from plain elements', () => {
    // Compatibility guard: swipe stepping from a plain element is unchanged.
    test('a horizontal swipe from a plain element steps the stack once in each direction', () => {
        fire('touchstart', plain, [touch(1, plain, 200)])
        fire('touchend', plain, [touch(1, plain, 100)])
        expect(get(MobileGUIStack)).toBe(2)

        fire('touchstart', plain, [touch(2, plain, 100)])
        fire('touchend', plain, [touch(2, plain, 200)])
        expect(get(MobileGUIStack)).toBe(1)
        expect(errors).toEqual([])
    })

    // Compatibility guard.
    test('a horizontal swipe with a character selected steps the sidebar once', () => {
        selectedCharID.set(0)
        fire('touchstart', plain, [touch(3, plain, 200)])
        fire('touchend', plain, [touch(3, plain, 100)])
        expect(get(MobileSideBar)).toBe(2)
        expect(get(MobileGUIStack)).toBe(1)
    })
})

describe('initMobileGesture: touches on controls', () => {
    test('touchstart and touchend on a BUTTON do not throw and do not step', () => {
        fire('touchstart', button, [touch(10, button, 200)])
        fire('touchend', button, [touch(10, button, 100)])
        expect(errors).toEqual([])
        expect(get(MobileGUIStack)).toBe(1)
    })

    test('touchstart and touchend on an INPUT do not throw and do not step', () => {
        fire('touchstart', input, [touch(11, input, 200)])
        fire('touchend', input, [touch(11, input, 100)])
        expect(errors).toEqual([])
        expect(get(MobileGUIStack)).toBe(1)
    })

    test('a touch on a plain element still swipes while another touch of the same event is on a BUTTON', () => {
        fire('touchstart', plain, [touch(20, button, 200), touch(21, plain, 200)])
        fire('touchend', plain, [touch(20, button, 100), touch(21, plain, 100)])
        expect(errors).toEqual([])
        expect(get(MobileGUIStack)).toBe(2)
    })

    test('a swipe of the second touch steps once after the first changed touch was on a BUTTON', () => {
        fire('touchstart', plain, [touch(30, button, 200), touch(31, plain, 200)])
        fire('touchend', plain, [touch(31, plain, 100)])
        expect(get(MobileGUIStack)).toBe(2)
        fire('touchend', plain, [touch(30, button, 100)])
        expect(errors).toEqual([])
        expect(get(MobileGUIStack)).toBe(2)
    })
})

describe('initMobileGesture: touchcancel', () => {
    test('touchend of a cancelled touch steps nothing and does not throw', () => {
        fire('touchstart', plain, [touch(40, plain, 200)])
        fire('touchcancel', plain, [touch(40, plain, 150)])
        fire('touchend', plain, [touch(40, plain, 100)])
        expect(errors).toEqual([])
        expect(get(MobileGUIStack)).toBe(1)
    })

    test('a touchend whose start was never recorded is ignored', () => {
        fire('touchend', plain, [touch(41, plain, 100)])
        expect(errors).toEqual([])
        expect(get(MobileGUIStack)).toBe(1)
    })
})

describe('initMobileGesture: disposer', () => {
    // Feature test: the disposer is an additive return value.
    test('a disposed registration does not react, so a swipe steps once rather than twice', () => {
        const stop = initMobileGesture()
        stop?.()
        selectedCharID.set(0)
        MobileSideBar.set(0)
        fire('touchstart', plain, [touch(50, plain, 200)])
        fire('touchend', plain, [touch(50, plain, 100)])
        // Only the file-wide registration remains.
        expect(get(MobileSideBar)).toBe(1)
    })
})
