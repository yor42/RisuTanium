/**
 * The Ctrl+1..9 preset keys are the `presetSlot1..9` rows of the hotkey table: Ctrl+n selects the preset that holds
 * slot n, wherever it sits in the list.
 *
 * Drives the REAL document keydown listener that `initHotkey()` (`hotkey.ts`) registers, with real KeyboardEvents
 * dispatched into the page. The assertions read the preset switch (`changeToPreset`), the toast in the alert store,
 * `defaultPrevented` and the settings panel.
 *
 * Invariants pinned here:
 *  - the preset a key selects follows the slot it holds, never the list position (B1);
 *  - a rebound row follows its new chord and the old chord does nothing (B2);
 *  - a key committing an IME composition is not a shortcut and is not consumed (B3);
 *  - an empty slot, or a slot whose holder was deleted, says so, switches nothing and still consumes the key (B4, B7);
 *  - an earlier row bound to the same chord wins over the slot row (B14);
 *  - the keys work inside a text field.
 *
 * Tests whose title starts with `guard:` pass with or without the change; every other test fails while the behaviour it
 * names is missing.
 */
import { get, writable } from 'svelte/store'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from './storage/database.svelte'
import type { Hotkey } from './defaulthotkeys'
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
import { defaultHotkeys } from './defaulthotkeys'
import { alertStore, DBState, settingsOpen } from './stores.svelte'
import { changeToPreset } from './storage/database.svelte'
import { migratePresetSlots } from './storage/presetMeta'
import type { alertData } from './alert'

//#region helpers

const NONE: alertData = { type: 'none', msg: '' }

function keydown(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
    return new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
}

function press(ev: KeyboardEvent, target: EventTarget = document.body): KeyboardEvent {
    target.dispatchEvent(ev)
    return ev
}

function shown(): alertData {
    return get(alertStore) as alertData
}

type Preset = { name: string, slot?: number }

/** A profile as the load path leaves it: the default rows, slots as given. */
function arrange(presets: Preset[], rows: Hotkey[] = structuredClone(defaultHotkeys)): Database {
    const db = { botPresets: presets, hotkeys: rows, characters: [] } as unknown as Database
    DBState.db = db
    return db
}

const ctrl = (key: string, init: KeyboardEventInit = {}) => keydown(key, { ctrlKey: true, ...init })

beforeAll(() => {
    initHotkey()
})

beforeEach(() => {
    alertStore.set(NONE)
})

afterEach(() => {
    document.body.replaceChildren()
    settingsOpen.set(false)
    alertStore.set(NONE)
    vi.mocked(changeToPreset).mockClear()
})

afterAll(() => {
    vi.restoreAllMocks()
})

//#endregion

describe('Ctrl+n selects the preset holding slot n', () => {
    test('B1 the slot decides, not the list position', () => {
        arrange([{ name: 'B', slot: 2 }, { name: 'A', slot: 1 }])

        press(ctrl('1'))
        expect(vi.mocked(changeToPreset)).toHaveBeenLastCalledWith(1)

        press(ctrl('2'))
        expect(vi.mocked(changeToPreset)).toHaveBeenLastCalledWith(0)
    })

    test('guard: after the one-time migration Ctrl+2 selects the second preset, as before', () => {
        const db = arrange([{ name: 'One' }, { name: 'Two' }], [])
        migratePresetSlots(db)
        db.hotkeys = structuredClone(defaultHotkeys)

        press(ctrl('2'))

        expect(vi.mocked(changeToPreset)).toHaveBeenCalledWith(1)
    })

    test('B2 a row rebound to Alt+1 follows the new chord, and Ctrl+1 no longer switches', () => {
        const rows = structuredClone(defaultHotkeys)
        const row = rows.find((candidate) => candidate.action === 'presetSlot1') as Hotkey
        Object.assign(row, { ctrl: false, alt: true })
        arrange([{ name: 'A', slot: 1 }, { name: 'B', slot: 2 }], rows)

        const old = press(ctrl('1'))
        expect(vi.mocked(changeToPreset)).not.toHaveBeenCalled()
        expect(old.defaultPrevented).toBe(false)

        press(keydown('1', { altKey: true }))
        expect(vi.mocked(changeToPreset)).toHaveBeenCalledWith(0)
    })

    test('B3 a key that commits an IME composition is not a shortcut and is not consumed', () => {
        arrange([{ name: 'A', slot: 1 }])

        const composing = press(ctrl('1', { isComposing: true }))
        expect(vi.mocked(changeToPreset)).not.toHaveBeenCalled()
        expect(composing.defaultPrevented).toBe(false)

        const imeKey = new KeyboardEvent('keydown', { key: '1', ctrlKey: true, keyCode: 229, bubbles: true, cancelable: true })
        press(imeKey)
        expect(vi.mocked(changeToPreset)).not.toHaveBeenCalled()
        expect(imeKey.defaultPrevented).toBe(false)
    })

    test('B4 an empty slot switches nothing, says so, and the key is still consumed', () => {
        arrange([1, 2, 3, 4, 5, 6].map((n) => ({ name: `P${n}`, ...(n <= 4 ? { slot: n } : {}) })))

        const key = press(ctrl('5'))

        expect(vi.mocked(changeToPreset)).not.toHaveBeenCalled()
        expect(key.defaultPrevented).toBe(true)
        expect(shown()).toMatchObject({ type: 'toast' })
        expect(shown().msg).toContain('5')
    })

    test('B7 the holder of slot 3 was deleted: Ctrl+3 does not fall through to the next preset', () => {
        const db = arrange([{ name: 'A', slot: 1 }, { name: 'B', slot: 2 }, { name: 'C', slot: 3 }, { name: 'D', slot: 4 }])
        db.botPresets.splice(2, 1)

        const key = press(ctrl('3'))

        expect(vi.mocked(changeToPreset)).not.toHaveBeenCalled()
        expect(key.defaultPrevented).toBe(true)
        expect(shown().type).toBe('toast')
    })

    test('the toast of a hit names the preset, and the key works inside a text field', () => {
        arrange([{ name: 'A', slot: 1 }, { name: 'Second', slot: 2 }])
        const field = document.createElement('textarea')
        document.body.append(field)
        field.focus()

        const key = press(ctrl('2'), field)

        expect(vi.mocked(changeToPreset)).toHaveBeenCalledWith(1)
        expect(key.defaultPrevented).toBe(true)
        expect(shown().msg).toContain('Second')
    })

    test('an unbound slot row is not a shortcut and its key is not consumed', () => {
        const rows = structuredClone(defaultHotkeys)
        Object.assign(rows.find((candidate) => candidate.action === 'presetSlot1') as Hotkey, { key: '' })
        arrange([{ name: 'A', slot: 1 }], rows)

        const key = press(ctrl('1'))

        expect(vi.mocked(changeToPreset)).not.toHaveBeenCalled()
        expect(key.defaultPrevented).toBe(false)
    })

    test('guard: an earlier row bound to the same chord wins over the slot row', () => {
        const rows: Hotkey[] = [{ key: '2', ctrl: true, action: 'settings' }, ...structuredClone(defaultHotkeys)]
        arrange([{ name: 'A', slot: 1 }, { name: 'B', slot: 2 }], rows)

        press(ctrl('2'))

        expect(get(settingsOpen)).toBe(true)
        expect(vi.mocked(changeToPreset)).not.toHaveBeenCalled()
    })
})
