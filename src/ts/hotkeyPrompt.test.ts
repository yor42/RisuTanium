/**
 * What the keyboard and touch shortcuts do while a prompt (an alert that waits
 * for an answer) is waiting, whether the prompt is showing or a notice or toast
 * covers it, and what the shortcuts and Enter do under a notice that covers the
 * page with no prompt behind it.
 *
 * Drives the REAL document keydown and touchstart listeners registered by
 * `initHotkey()` (`hotkey.ts`), installed once for the whole file, with real
 * events dispatched into the document, and the REAL `alert.ts` over a real
 * `writable` standing in for `alertStore`. The assertions read what a user would
 * see: a click on a chat button, the alert store, the settings panel, the preset
 * switch, and `defaultPrevented`.
 *
 * Invariants pinned here:
 *  - while a prompt is waiting, or a notice covers the page, no shortcut of the
 *    configurable table runs; the Ctrl+1..9 preset keys and the triple-touch
 *    quick menu do nothing while a prompt is waiting;
 *  - a key is consumed exactly when it was consumed before, so Ctrl+V and Ctrl+X
 *    still paste and cut in an input prompt;
 *  - Enter answers a confirm only with no Ctrl, Alt or Meta held, and never on
 *    key auto-repeat; an unmodified Enter closes a notice only once the notice
 *    has been up past the answer pause;
 *  - Escape on a cover closes the cover and the prompt returns.
 *
 * Which element an Enter is aimed at, Shift and composing Enters, held keys on
 * controls and the other alert types are pinned in
 * `hotkey.coveringAlertKeys.test.ts`.
 *
 * `hotkey.test.ts` stubs `doingAlert` to `false`, which would make these
 * assertions vacuous, so they live in their own file.
 *
 * Tests whose title starts with `guard:` pass with or without the fix: they pin
 * behaviour that must be preserved.
 */
import { get, writable } from 'svelte/store'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
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
import { alertStore, DBState, settingsOpen } from './stores.svelte'
import { changeToPreset } from './storage/database.svelte'
import { migratePresetSlots } from './storage/presetMeta'
import { changeChar } from './characters'
import { alertConfirm, alertNormal, alertToast, alertWait } from './alert'
import { resetAlertPromptsForTests } from './alertPrompts'

//#region helpers

const NONE: alertData = { type: 'none', msg: '' }
const GUARD_MS = 401

function shown(): alertData {
    return get(alertStore) as alertData
}

function keydown(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
    return new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
}

/** Dispatches `ev` where the browser would: on the focused element, which bubbles to the document. */
function press(ev: KeyboardEvent, target: EventTarget = document.body): KeyboardEvent {
    target.dispatchEvent(ev)
    return ev
}

/** A chat button the remove shortcut clicks, with a spy on its click. */
function removeButton(): { clicks: () => number } {
    const button = document.createElement('button')
    button.className = 'button-icon-remove'
    const onClick = vi.fn()
    button.addEventListener('click', onClick)
    document.body.append(button)
    return { clicks: () => onClick.mock.calls.length }
}

/** How each shortcut of the configurable table shows that it ran. */
interface ShortcutSpec {
    name: string
    press: () => KeyboardEvent
    /** Puts what the shortcut acts on in place; returns how to tell that it ran. */
    arrange: () => () => boolean
}

const SHORTCUTS: ShortcutSpec[] = [
    {
        name: 'the remove shortcut clicking the remove button',
        press: () => press(keydown('d', { ctrlKey: true, altKey: true })),
        arrange: () => {
            const button = removeButton()
            return () => button.clicks() > 0
        },
    },
    {
        name: 'the request logs shortcut opening the logs',
        press: () => press(keydown('l', { ctrlKey: true })),
        arrange: () => () => shown().type === 'requestlogs',
    },
    {
        name: 'the settings shortcut opening the settings panel',
        press: () => press(keydown('s', { ctrlKey: true })),
        arrange: () => () => get(settingsOpen),
    },
    {
        name: 'the previous character shortcut switching character',
        press: () => press(keydown('[', { ctrlKey: true })),
        arrange: () => {
            DBState.db = { characters: [{ name: 'Alice' }, { name: 'Bob' }] } as unknown as Database
            return () => vi.mocked(changeChar).mock.calls.length > 0
        },
    },
    {
        name: 'the next character shortcut switching character',
        press: () => press(keydown(']', { ctrlKey: true })),
        arrange: () => {
            DBState.db = { characters: [{ name: 'Alice' }, { name: 'Bob' }] } as unknown as Database
            return () => vi.mocked(changeChar).mock.calls.length > 0
        },
    },
]

/** A prompt waiting, in each state a prompt can be in. */
interface PromptState {
    name: string
    arrange: () => void
    /** The alert the user sees once `arrange` has run. */
    visible: alertData['type']
}

const PROMPT_STATES: PromptState[] = [
    { name: 'a confirm showing', arrange: () => { void alertConfirm('Proceed?') }, visible: 'ask' },
    { name: 'a confirm covered by a notice', arrange: () => { void alertConfirm('Proceed?'); alertNormal('A notice') }, visible: 'normal' },
    { name: 'a confirm covered by a toast', arrange: () => { void alertConfirm('Proceed?'); alertToast('A toast') }, visible: 'toast' },
    { name: 'a confirm covered by a wait notice', arrange: () => { void alertConfirm('Proceed?'); alertWait('Loading...') }, visible: 'wait' },
    { name: 'the terms prompt posted on its own', arrange: () => { alertStore.set({ type: 'tos', msg: 'tos' }) }, visible: 'tos' },
]

const cleanups: Array<() => void> = []

beforeAll(() => {
    initHotkey()
})

beforeEach(() => {
    const db = { botPresets: [{ name: 'One' }, { name: 'Two' }] } as unknown as Database
    migratePresetSlots(db)
    DBState.db = db
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
    vi.mocked(changeToPreset).mockClear()
    vi.mocked(changeChar).mockClear()
})

afterAll(() => {
    alertStore.set(NONE)
})

//#endregion

describe('a shortcut of the configurable table while a prompt is waiting', () => {
    describe.each(SHORTCUTS)('$name', (shortcut) => {
        test.each(PROMPT_STATES)('does not run with $name', (state) => {
            const ran = shortcut.arrange()
            state.arrange()
            expect(shown().type, 'the alert the user sees').toBe(state.visible)

            shortcut.press()

            expect(ran(), 'the shortcut ran').toBe(false)
        })

        test('guard: runs when nothing is waiting', () => {
            const ran = shortcut.arrange()

            shortcut.press()

            expect(ran()).toBe(true)
        })

        test('does not run under a notice that covers the page, though no prompt is waiting', () => {
            const ran = shortcut.arrange()
            alertNormal('A notice')

            shortcut.press()

            expect(ran()).toBe(false)
        })
    })

    test('guard: a shortcut that a waiting prompt blocks is still consumed', () => {
        removeButton()
        void alertConfirm('Proceed?')

        const key = press(keydown('d', { ctrlKey: true, altKey: true }))

        expect(key.defaultPrevented).toBe(true)
    })

    test('guard: Ctrl+Alt+Enter over a confirm does not answer it, and is consumed', () => {
        void alertConfirm('Proceed?')
        const asked = shown()

        const key = press(keydown('Enter', { ctrlKey: true, altKey: true }))

        expect.soft(shown(), 'the store').toBe(asked)
        expect.soft(key.defaultPrevented, 'the key was consumed').toBe(true)
    })
})

describe('the Ctrl+number preset keys while a prompt is waiting', () => {
    test('a confirm hidden under a toast keeps Ctrl+1 from switching presets', () => {
        void alertConfirm('Proceed?')
        alertToast('A toast')

        press(keydown('1', { ctrlKey: true }))

        expect(vi.mocked(changeToPreset)).not.toHaveBeenCalled()
    })

    test('guard: a confirm that is showing keeps Ctrl+1 from switching presets', () => {
        void alertConfirm('Proceed?')

        press(keydown('1', { ctrlKey: true }))

        expect(vi.mocked(changeToPreset)).not.toHaveBeenCalled()
    })

    test('guard: the terms prompt posted on its own keeps Ctrl+1 from switching presets', () => {
        alertStore.set({ type: 'tos', msg: 'tos' })

        press(keydown('1', { ctrlKey: true }))

        expect(vi.mocked(changeToPreset)).not.toHaveBeenCalled()
    })

    test('guard: with nothing up Ctrl+1 switches to the first preset', () => {
        press(keydown('1', { ctrlKey: true }))

        expect(vi.mocked(changeToPreset)).toHaveBeenCalledWith(0)
    })
})

describe('the triple-touch quick menu while a prompt is waiting', () => {
    function tripleTouch(): void {
        for (let i = 0; i < 3; i++) {
            document.dispatchEvent(new Event('touchstart', { bubbles: true }))
        }
        document.dispatchEvent(new Event('touchend', { bubbles: true }))
    }

    test('a confirm hidden under a toast keeps the quick menu from opening', () => {
        void alertConfirm('Proceed?')
        alertToast('A toast')

        tripleTouch()

        expect(shown().type).toBe('toast')
    })

    test('guard: a confirm that is showing keeps the quick menu from opening', () => {
        void alertConfirm('Proceed?')
        const asked = shown()

        tripleTouch()

        expect(shown()).toBe(asked)
    })

    test('guard: with nothing up a triple touch opens the quick menu', () => {
        tripleTouch()

        expect(shown().type).toBe('select')
    })
})

describe('keys that paste and cut in an input prompt while a prompt is waiting', () => {
    test.each(['v', 'x'])('guard: Ctrl+%s in an input prompt is not consumed', (letter) => {
        alertStore.set({ type: 'input', msg: 'Name?', datalist: [], defaultValue: '' })

        const key = press(keydown(letter, { ctrlKey: true }))

        expect(key.defaultPrevented).toBe(false)
    })
})

describe('Enter on an alert that is showing', () => {
    test.each([
        ['auto-repeat', { repeat: true }],
        ['Ctrl held', { ctrlKey: true }],
        ['Alt held', { altKey: true }],
        ['Meta held', { metaKey: true }],
    ] as Array<[string, KeyboardEventInit]>)('Enter with %s does not answer a confirm', (_label, init) => {
        const ask: alertData = { type: 'ask', msg: 'Proceed?' }
        alertStore.set(ask)

        press(keydown('Enter', init))

        expect(shown()).toBe(ask)
    })

    test('guard: an unmodified Enter that is not a repeat answers a confirm with yes', () => {
        alertStore.set({ type: 'ask', msg: 'Proceed?' })

        press(keydown('Enter'))

        expect(shown()).toEqual({ type: 'none', msg: 'yes' })
    })

    test.each(['normal', 'error'] as Array<alertData['type']>)('an unmodified Enter closes a %s notice with yes only once the notice has been up past the pause', async (type) => {
        vi.useFakeTimers()
        const notice: alertData = { type, msg: 'A notice' }
        alertStore.set(notice)

        press(keydown('Enter'))
        expect.soft(shown(), 'the store at once').toBe(notice)

        await vi.advanceTimersByTimeAsync(GUARD_MS)
        press(keydown('Enter'))

        expect(shown()).toEqual({ type: 'none', msg: 'yes' })
    })
})

describe('Escape on a notice that covers a waiting prompt', () => {
    test('guard: Escape closes the notice and an open settings panel', () => {
        void alertConfirm('Proceed?')
        alertNormal('A notice')
        settingsOpen.set(true)

        press(keydown('Escape'))

        expect.soft(shown().type, 'the notice after Escape').not.toBe('normal')
        expect.soft(get(settingsOpen), 'the settings panel').toBe(false)
    })

    test('the prompt is shown again and still waits after Escape closes the notice over it', async () => {
        vi.useFakeTimers()
        let settled = false
        void alertConfirm('Proceed?').then(() => { settled = true })
        const asked = shown()
        alertNormal('A notice')

        press(keydown('Escape'))
        await vi.advanceTimersByTimeAsync(GUARD_MS)

        expect.soft(shown(), 'the store after Escape').toEqual(asked)
        expect.soft(settled, 'the confirm settled').toBe(false)
    })
})
