/**
 * What the keyboard does while an alert that covers the page is shown, and what
 * a held key does to a control.
 *
 * Drives the REAL document keydown listener and the window capture listener that
 * `initHotkey()` (`hotkey.ts`) registers, installed once for the whole file, with
 * real KeyboardEvents dispatched at real elements, and the REAL `alert.ts` and
 * `alertPrompts.ts` over a real `writable` standing in for `alertStore`. The
 * assertions read the store, whether an answer was written, `defaultPrevented`,
 * and whether an element's own keydown handler ran; none of them counts calls on a
 * mocked alert function. `happy-dom` synthesises no click from Enter or Space, so
 * a test that needs the browser's activation of a focused button clicks it itself
 * when the keydown was left alone.
 *
 * Invariants pinned here:
 *  - an alert that covers the page owns the keyboard: no configurable shortcut,
 *    no previous/next character key and no Ctrl+1..9 preset key acts under it,
 *    whichever type it is, while the keys are still consumed;
 *  - Enter answers a confirm or closes a notice only when it is a plain, first,
 *    non-composing press aimed at the alert or at the page body, never at a page
 *    control, and it closes a notice only once the notice has been up for the
 *    answer pause;
 *  - a held Enter or Space never repeats a press on a control, whatever the
 *    control's own keydown handler would do; a text field is left alone;
 *  - Escape, Tab and the browser's own keys behave as they always did.
 *
 * Tests whose title starts with `guard:` pass with or without the fix: they pin
 * behaviour that must be preserved. Every other test fails while the behaviour it
 * names is missing.
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
import { changeChar } from './characters'
import { alertConfirm, alertError, alertNormal, alertWait } from './alert'
import { resetAlertPromptsForTests } from './alertPrompts'

//#region helpers

const NONE: alertData = { type: 'none', msg: '' }
/** One millisecond past the pause during which a prompt or a notice ignores Enter. */
const PAUSE_MS = 401

function shown(): alertData {
    return get(alertStore) as alertData
}

function keydown(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
    return new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
}

/** Dispatches `ev` where the browser would: on the focused element, which bubbles to the window. */
function press(ev: KeyboardEvent, target: EventTarget = document.body): KeyboardEvent {
    target.dispatchEvent(ev)
    return ev
}

/** A key event the way an input method reports one that is part of a composition. */
function composingEnter(init: KeyboardEventInit, keyCode?: number): KeyboardEvent {
    const ev = keydown('Enter', init)
    if (keyCode !== undefined) {
        Object.defineProperty(ev, 'keyCode', { value: keyCode })
    }
    return ev
}

/** A confirm that has been on screen past its pause, and what it was answered with so far. */
async function confirmPastPause(): Promise<{ answers: boolean[], asked: alertData }> {
    vi.useFakeTimers()
    const answers: boolean[] = []
    void alertConfirm('Proceed?').then((answer) => { answers.push(answer) })
    const asked = shown()
    await vi.advanceTimersByTimeAsync(PAUSE_MS)
    return { answers, asked }
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

const TWO_CHARACTERS = [{ name: 'Alice' }, { name: 'Bob' }]

beforeAll(() => {
    initHotkey()
})

beforeEach(() => {
    DBState.db = { botPresets: [{ name: 'One' }, { name: 'Two' }], characters: TWO_CHARACTERS } as unknown as Database
})

afterEach(() => {
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

describe('Enter on a confirm that has been up past its pause', () => {
    test('Enter aimed at a page button does not answer the confirm', async () => {
        const { answers, asked } = await confirmPastPause()
        const pageButton = document.createElement('button')
        document.body.append(pageButton)
        pageButton.focus()

        press(keydown('Enter'), pageButton)
        await vi.advanceTimersByTimeAsync(0)

        expect.soft(answers, 'the answers the confirm was given').toEqual([])
        expect.soft(shown(), 'the store').toBe(asked)
    })

    test('Enter aimed at a page element that acts as a button does not answer the confirm', async () => {
        const { answers, asked } = await confirmPastPause()
        const pageControl = document.createElement('div')
        pageControl.setAttribute('role', 'button')
        pageControl.tabIndex = 0
        document.body.append(pageControl)
        pageControl.focus()

        press(keydown('Enter'), pageControl)
        await vi.advanceTimersByTimeAsync(0)

        expect.soft(answers, 'the answers the confirm was given').toEqual([])
        expect.soft(shown(), 'the store').toBe(asked)
    })

    test('guard: Enter aimed at the page body answers the confirm with yes', async () => {
        const { answers } = await confirmPastPause()

        press(keydown('Enter'))
        await vi.advanceTimersByTimeAsync(0)

        expect(answers).toEqual([true])
    })

    test('Shift+Enter does not answer the confirm', async () => {
        const { answers, asked } = await confirmPastPause()

        press(keydown('Enter', { shiftKey: true }))
        await vi.advanceTimersByTimeAsync(0)

        expect.soft(answers, 'the answers the confirm was given').toEqual([])
        expect.soft(shown(), 'the store').toBe(asked)
    })

    test.each([
        ['isComposing set', () => composingEnter({ isComposing: true })],
        ['keyCode 229', () => composingEnter({}, 229)],
    ] as Array<[string, () => KeyboardEvent]>)('an Enter with %s does not answer the confirm', async (_label, makeEvent) => {
        const { answers, asked } = await confirmPastPause()

        press(makeEvent())
        await vi.advanceTimersByTimeAsync(0)

        expect.soft(answers, 'the answers the confirm was given').toEqual([])
        expect.soft(shown(), 'the store').toBe(asked)
    })

    test('guard: Enter on a page element that clicks itself from its own keydown opens a confirm and leaves it unanswered', async () => {
        vi.useFakeTimers()
        const answers: boolean[] = []
        const selfClicking = document.createElement('div')
        selfClicking.setAttribute('role', 'button')
        selfClicking.tabIndex = 0
        selfClicking.addEventListener('click', async () => { answers.push(await alertConfirm('Remove?')) })
        selfClicking.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter') {
                (ev.currentTarget as HTMLElement).click()
            }
        })
        document.body.append(selfClicking)
        selfClicking.focus()

        press(keydown('Enter'), selfClicking)
        await vi.advanceTimersByTimeAsync(0)

        expect.soft(shown().type, 'the alert on screen').toBe('ask')
        expect.soft(answers, 'the answers the confirm was given').toEqual([])
    })
})

describe('a held Enter or Space on a control', () => {
    interface ControlSpec {
        name: string
        make: () => HTMLElement
    }

    const CONTROLS: ControlSpec[] = [
        { name: 'a button', make: () => document.createElement('button') },
        {
            name: 'a div acting as a button',
            make: () => {
                const div = document.createElement('div')
                div.setAttribute('role', 'button')
                div.tabIndex = 0
                return div
            },
        },
        {
            name: 'a summary',
            make: () => {
                const summary = document.createElement('summary')
                const details = document.createElement('details')
                details.append(summary)
                document.body.append(details)
                return summary
            },
        },
        {
            name: 'a link',
            make: () => {
                const link = document.createElement('a')
                link.setAttribute('href', 'https://example.invalid/')
                return link
            },
        },
    ]

    /** Puts `control` in the page with a handler of its own that records every keydown it receives. */
    function arrange(control: HTMLElement): { handled: () => number } {
        const handler = vi.fn()
        control.addEventListener('keydown', handler)
        if (!control.isConnected) {
            document.body.append(control)
        }
        control.focus()
        return { handled: () => handler.mock.calls.length }
    }

    describe.each(CONTROLS)('on $name', (spec) => {
        test.each(['Enter', ' '])('a repeated %j keydown is prevented and never reaches the control\'s own handler', (key) => {
            const control = spec.make()
            const { handled } = arrange(control)

            const ev = press(keydown(key, { repeat: true }), control)

            expect.soft(ev.defaultPrevented, 'the repeat was prevented').toBe(true)
            expect.soft(handled(), 'the control\'s own handler ran').toBe(0)
        })

        test('guard: the first Enter keydown still reaches the control\'s own handler', () => {
            const control = spec.make()
            const { handled } = arrange(control)

            press(keydown('Enter'), control)

            expect(handled()).toBe(1)
        })
    })

    test.each(['Enter', ' '])('guard: a repeated %j keydown in a textarea is not prevented and reaches the textarea\'s own handler', (key) => {
        const box = document.createElement('textarea')
        const { handled } = arrange(box)
        expect(document.activeElement, 'the focused element').toBe(box)

        const ev = press(keydown(key, { repeat: true }), box)

        expect.soft(ev.defaultPrevented, 'the repeat was prevented').toBe(false)
        expect.soft(handled(), 'the textarea\'s own handler ran').toBe(1)
    })

    test('a repeated Enter on a button is prevented while a confirm is up too', async () => {
        await confirmPastPause()
        const button = document.createElement('button')
        const { handled } = arrange(button)

        const ev = press(keydown('Enter', { repeat: true }), button)

        expect.soft(ev.defaultPrevented, 'the repeat was prevented').toBe(true)
        expect.soft(handled(), 'the button\'s own handler ran').toBe(0)
    })
})

describe('the shortcuts and character keys under an alert that covers the page', () => {
    interface ShortcutSpec {
        name: string
        press: () => KeyboardEvent
        /** Puts what the shortcut acts on in place; returns how to tell that it ran. */
        arrange: () => () => boolean
        /** The covers under which the key is blocked whether or not the page's keys are blocked as a whole. */
        blockedAnyway?: string[]
    }

    const SHORTCUTS: ShortcutSpec[] = [
        {
            name: 'the next character key (Ctrl+])',
            press: () => press(keydown(']', { ctrlKey: true })),
            arrange: () => () => vi.mocked(changeChar).mock.calls.length > 0,
        },
        {
            name: 'the previous character key (Ctrl+[)',
            press: () => press(keydown('[', { ctrlKey: true })),
            arrange: () => () => vi.mocked(changeChar).mock.calls.length > 0,
        },
        {
            name: 'the second preset key (Ctrl+2)',
            press: () => press(keydown('2', { ctrlKey: true })),
            arrange: () => () => vi.mocked(changeToPreset).mock.calls.length > 0,
            blockedAnyway: ['a progress', 'a normal', 'an error', 'a request logs'],
        },
        {
            name: 'the remove shortcut',
            press: () => press(keydown('d', { ctrlKey: true, altKey: true })),
            arrange: () => {
                const button = removeButton()
                return () => button.clicks() > 0
            },
        },
        {
            name: 'the settings shortcut',
            press: () => press(keydown('s', { ctrlKey: true })),
            arrange: () => () => get(settingsOpen),
        },
    ]

    const COVERING: Array<[string, () => void]> = [
        ['a wait', () => { alertWait('Loading...') }],
        ['a wait with a Cancel', () => { alertWait('Loading...', () => {}) }],
        ['a progress', () => { alertStore.set({ type: 'progress', msg: 'Saving', submsg: '10' }) }],
        ['a normal', () => { alertNormal('A notice') }],
        ['an error', () => { alertError('A failure') }],
        ['a request logs', () => { alertStore.set({ type: 'requestlogs', msg: '' }) }],
    ]

    describe.each(SHORTCUTS)('$name', (shortcut) => {
        for (const [label, cover] of COVERING) {
            const guard = shortcut.blockedAnyway?.includes(label) ?? false
            test(`${guard ? 'guard: ' : ''}does not run under ${label} alert`, () => {
                const ran = shortcut.arrange()
                cover()

                shortcut.press()

                expect(ran(), 'the shortcut ran').toBe(false)
            })
        }

        test('guard: runs when nothing is shown', () => {
            const ran = shortcut.arrange()

            shortcut.press()

            expect(ran()).toBe(true)
        })

        test('guard: runs under a toast, which does not cover the page', () => {
            const ran = shortcut.arrange()
            alertStore.set({ type: 'toast', msg: 'A toast' })

            shortcut.press()

            expect(ran()).toBe(true)
        })
    })

    test.each(COVERING)('guard: a shortcut under %s alert is still consumed', (_label, cover) => {
        removeButton()
        cover()

        const ev = press(keydown('d', { ctrlKey: true, altKey: true }))

        expect(ev.defaultPrevented).toBe(true)
    })
})

describe('Enter on a notice', () => {
    test.each(['normal', 'error'] as Array<alertData['type']>)('Enter does not close a %s notice at the moment it appears', (type) => {
        vi.useFakeTimers()
        const notice: alertData = { type, msg: 'A notice' }
        alertStore.set(notice)

        press(keydown('Enter'))

        expect(shown(), 'the store').toBe(notice)
    })

    test.each(['normal', 'error'] as Array<alertData['type']>)('guard: Enter closes a %s notice once it has been up past the pause', async (type) => {
        vi.useFakeTimers()
        alertStore.set({ type, msg: 'A notice' })
        await vi.advanceTimersByTimeAsync(PAUSE_MS)

        press(keydown('Enter'))

        expect(shown().type).toBe('none')
    })

    test('a notice that replaces another starts its own pause', async () => {
        vi.useFakeTimers()
        alertStore.set({ type: 'normal', msg: 'First' })
        await vi.advanceTimersByTimeAsync(PAUSE_MS)
        const second: alertData = { type: 'normal', msg: 'Second' }
        alertStore.set(second)

        press(keydown('Enter'))

        expect(shown(), 'the store').toBe(second)
    })

    test('guard: Escape closes a notice at the moment it appears', () => {
        vi.useFakeTimers()
        alertStore.set({ type: 'normal', msg: 'A notice' })

        press(keydown('Escape'))

        expect(shown().type).toBe('none')
    })
})

describe('keys that must keep working over an alert that covers the page', () => {
    const COVERING_TYPES: Array<alertData['type']> = [
        'ask', 'pluginconfirm', 'select', 'input', 'selectChar', 'addchar', 'chatOptions', 'cardexport',
        'selectModule', 'tos', 'staleAccountNotice', 'progress', 'normal', 'error', 'markdown',
        'requestdata', 'hypaV2', 'branches', 'requestlogs', 'pukmakkurit', 'wait2', 'wait',
        'patternSelect', 'patternInput',
    ]
    /** The types Escape closes; every other covering type keeps what is on screen. */
    const ESCAPE_CLOSES: Array<alertData['type']> = [
        'normal', 'error', 'markdown', 'requestdata', 'hypaV2', 'branches', 'requestlogs', 'pukmakkurit', 'wait2',
    ]

    test.each(COVERING_TYPES)('guard: Escape over a %s alert closes it only if it is an information alert, and is consumed', (type) => {
        const alert: alertData = { type, msg: `a ${type} alert` }
        alertStore.set(alert)

        const ev = press(keydown('Escape'))

        if (ESCAPE_CLOSES.includes(type)) {
            expect.soft(shown().type, 'the alert after Escape').toBe('none')
        } else {
            expect.soft(shown(), 'the alert after Escape').toBe(alert)
        }
        expect.soft(ev.defaultPrevented, 'Escape was consumed').toBe(true)
    })

    test('guard: Escape runs the Cancel of a wait alert that offers one', () => {
        const onCancel = vi.fn()
        alertWait('Loading...', onCancel)

        const ev = press(keydown('Escape'))

        expect.soft(onCancel, 'the Cancel').toHaveBeenCalledTimes(1)
        expect.soft(ev.defaultPrevented, 'Escape was consumed').toBe(true)
    })

    describe.each([
        ['Tab', () => keydown('Tab')],
        ['Shift+Tab', () => keydown('Tab', { shiftKey: true })],
        ['F5', () => keydown('F5')],
        ['Ctrl+R', () => keydown('r', { ctrlKey: true })],
        ['Ctrl+C', () => keydown('c', { ctrlKey: true })],
    ] as Array<[string, () => KeyboardEvent]>)('%s', (_label, makeEvent) => {
        test.each([
            ['an ask', () => { void alertConfirm('Proceed?') }],
            ['a normal', () => { alertNormal('A notice') }],
            ['a wait', () => { alertWait('Loading...') }],
            ['a progress', () => { alertStore.set({ type: 'progress', msg: 'Saving', submsg: '10' }) }],
        ] as Array<[string, () => void]>)('guard: over %s alert is not prevented', (_kind, cover) => {
            cover()

            const ev = press(makeEvent())

            expect(ev.defaultPrevented).toBe(false)
        })
    })
})
