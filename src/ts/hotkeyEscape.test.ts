/**
 * What Escape does to the alert store and to the settings panel, for each kind
 * of alert that can be up.
 *
 * Drives the REAL document keydown listener registered by `initHotkey()`
 * (`hotkey.ts`), installed once for the whole file, with real KeyboardEvents
 * dispatched into the document, and the REAL `alert.ts` over a real `writable`
 * standing in for `alertStore`. The assertions read the store object itself, the
 * settings panel, `defaultPrevented`, and a real `window` listener; none of them
 * counts calls on a mocked alert function.
 *
 * `hotkey.test.ts` stubs `doingAlert` to `false`, which would make every
 * assertion here vacuous, so these tests live in their own file.
 *
 * Tests whose title starts with `guard:` pass with or without the fix: they pin
 * behaviour that must be preserved.
 */
import { get, writable } from 'svelte/store'
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import type { Database } from './storage/database.svelte'
import type { alertData } from './alert'
import 'src/ts/polyfill'

//#region module mocks

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
    DBState: { db: {} as unknown as Database },
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

//#endregion

import { initHotkey } from './hotkey'
import { alertStore, settingsOpen } from './stores.svelte'
import { alertConfirm } from './alert'
import { resetAlertPromptsForTests } from './alertPrompts'

//#region helpers

const NONE: alertData = { type: 'none', msg: '' }

/** An alert of `type` as a caller would post it: a fresh object, so identity can be compared. */
function alertOf(type: alertData['type']): alertData {
    return { type, msg: `a ${type} alert` }
}

function shown(): alertData {
    return get(alertStore) as alertData
}

function escapeKey(init: KeyboardEventInit = {}): KeyboardEvent {
    return new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, ...init })
}

/** Dispatches `ev` where the browser would: on the focused element, which bubbles to the document. */
function press(ev: KeyboardEvent, target: EventTarget = document.body): KeyboardEvent {
    target.dispatchEvent(ev)
    return ev
}

const cleanups: Array<() => void> = []

beforeAll(() => {
    initHotkey()
})

afterEach(() => {
    while (cleanups.length > 0) {
        cleanups.pop()!()
    }
    vi.useRealTimers()
    document.body.replaceChildren()
    settingsOpen.set(false)
    resetAlertPromptsForTests()
    alertStore.set(NONE)
})

afterAll(() => {
    alertStore.set(NONE)
})

//#endregion

describe('Escape on an alert that waits for an answer', () => {
    test('an ask alert stays in the store as the same object and an open settings panel stays open', () => {
        const ask = alertOf('ask')
        alertStore.set(ask)
        settingsOpen.set(true)

        press(escapeKey())

        expect.soft(shown(), 'the store').toBe(ask)
        expect.soft(get(settingsOpen), 'the settings panel').toBe(true)
    })

    test.each([
        'pluginconfirm', 'input', 'select', 'selectChar', 'addchar', 'chatOptions',
        'selectModule', 'cardexport', 'tos', 'staleAccountNotice', 'progress',
        'patternSelect', 'patternInput',
    ] as Array<alertData['type']>)('a %s alert stays in the store as the same object and an open settings panel stays open', (type) => {
        const alert = alertOf(type)
        alertStore.set(alert)
        settingsOpen.set(true)

        press(escapeKey())

        expect.soft(shown(), 'the store').toBe(alert)
        expect.soft(get(settingsOpen), 'the settings panel').toBe(true)
    })

    test('a window keydown listener does not see the Escape', () => {
        alertStore.set(alertOf('ask'))
        const seen: string[] = []
        const listener = (ev: KeyboardEvent) => { seen.push(ev.key) }
        window.addEventListener('keydown', listener)
        cleanups.push(() => window.removeEventListener('keydown', listener))

        press(escapeKey())

        expect(seen).toEqual([])
    })

    test('guard: the same window listener still sees a key that is not Escape', () => {
        alertStore.set(alertOf('ask'))
        const seen: string[] = []
        const listener = (ev: KeyboardEvent) => { seen.push(ev.key) }
        window.addEventListener('keydown', listener)
        cleanups.push(() => window.removeEventListener('keydown', listener))

        press(new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true }))

        expect(seen).toEqual(['a'])
    })
})

describe('Escape on an information alert', () => {
    test.each([
        'normal', 'error', 'markdown', 'requestdata', 'hypaV2', 'branches',
        'requestlogs', 'pukmakkurit', 'wait2',
    ] as Array<alertData['type']>)('a %s alert is closed at once with no toast, and an open settings panel is closed', (type) => {
        const written: alertData[] = []
        alertStore.set(alertOf(type))
        settingsOpen.set(true)
        const stop = alertStore.subscribe((value) => { written.push(value as alertData) })
        cleanups.push(stop)
        written.length = 0

        press(escapeKey())

        expect.soft(shown(), 'the store').toEqual({ type: 'none', msg: '' })
        expect.soft(get(settingsOpen), 'the settings panel').toBe(false)
        expect.soft(written.map((value) => value.type), 'the types the store held after Escape').toEqual(['none'])
    })
})

describe('Escape while nothing is waiting on the user', () => {
    test.each([
        ['none', NONE],
        ['toast', { type: 'toast', msg: 'A toast' }],
        ['wait', { type: 'wait', msg: 'Loading...' }],
    ] as Array<[string, alertData]>)('guard: with a %s value in the store, an open settings panel is closed and the store is left as it is', (_label, value) => {
        alertStore.set(value)
        settingsOpen.set(true)

        press(escapeKey())

        expect.soft(shown(), 'the store').toBe(value)
        expect.soft(get(settingsOpen), 'the settings panel').toBe(false)
    })
})

describe('Escape and a confirm that is waiting', () => {
    /** Emulates AlertComp's toast, whose animation ends after one second and writes `none`. */
    function emulateToastClose(): void {
        const stop = alertStore.subscribe((value) => {
            if ((value as alertData).type === 'toast') {
                setTimeout(() => { alertStore.set({ type: 'none', msg: '' }) }, 1000)
            }
        })
        cleanups.push(stop)
    }

    test.each([
        ['no', false],
        ['yes', true],
    ])('the confirm is still pending after Escape and the toast\'s time, and the answer %s then resolves it %s', async (answer, expected) => {
        vi.useFakeTimers()
        emulateToastClose()
        let outcome: { settled: boolean, value?: boolean } = { settled: false }
        const pending = alertConfirm('Remove the message?').then((value) => { outcome = { settled: true, value } })
        const ask = shown()
        expect(ask.type).toBe('ask')

        press(escapeKey())
        await vi.advanceTimersByTimeAsync(1500)

        expect.soft(outcome, 'the confirm after Escape').toEqual({ settled: false })
        expect.soft(shown(), 'the store').toBe(ask)
        alertStore.set({ type: 'none', msg: answer })
        await pending
        expect(outcome).toEqual({ settled: true, value: expected })
    })
})

describe('Escape pressed twice', () => {
    test('guard: a second Escape on a waiting alert changes nothing more than the first did', () => {
        const ask = alertOf('ask')
        alertStore.set(ask)
        settingsOpen.set(true)

        press(escapeKey())
        const storeAfterFirst = shown()
        const settingsAfterFirst = get(settingsOpen)
        press(escapeKey())

        expect.soft(shown(), 'the store').toBe(storeAfterFirst)
        expect.soft(get(settingsOpen), 'the settings panel').toBe(settingsAfterFirst)
    })
})

describe('Escape with a text field focused', () => {
    function focusedInput(): HTMLInputElement {
        const box = document.createElement('input')
        box.type = 'text'
        document.body.append(box)
        box.focus()
        expect(document.activeElement).toBe(box)
        return box
    }

    test('guard: an unmodified Escape in a text input leaves the alert and an open settings panel as they are', () => {
        const ask = alertOf('ask')
        alertStore.set(ask)
        settingsOpen.set(true)
        const box = focusedInput()

        press(escapeKey(), box)

        expect.soft(shown(), 'the store').toBe(ask)
        expect.soft(get(settingsOpen), 'the settings panel').toBe(true)
    })

    test('a Shift+Escape in a text input leaves the ask alert and an open settings panel as they are, and is consumed', () => {
        const ask = alertOf('ask')
        alertStore.set(ask)
        settingsOpen.set(true)
        const box = focusedInput()

        const key = press(escapeKey({ shiftKey: true }), box)

        expect.soft(shown(), 'the store').toBe(ask)
        expect.soft(get(settingsOpen), 'the settings panel').toBe(true)
        expect.soft(key.defaultPrevented, 'the key was consumed').toBe(true)
    })
})
