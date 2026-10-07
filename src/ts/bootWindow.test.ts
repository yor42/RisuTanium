/**
 * `openBootWindow` and `markBootWrite` in `bootWindow.ts`: what the boot window
 * records, what it counts as unsaved work, and that nothing it installs can
 * throw into a store notification, an event dispatch or the caller.
 *
 * The end-to-end behaviour (the first save pass, a peer's save, the real
 * import branches) is driven through the real `saveDb()` in
 * `globalApi.bootWindow.svelte.test.ts`. Events are stamped trusted with
 * `Object.defineProperty` because the test DOM never reports `isTrusted`.
 * Title labels: (G) marks a guard of behaviour that must stay.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { get, writable } from 'svelte/store'

vi.mock(import('src/ts/stores.svelte'), () => ({
    selectedCharID: writable(-1),
}) as unknown as typeof import('src/ts/stores.svelte'))

import { selectedCharID } from 'src/ts/stores.svelte'
import { markBootWrite, openBootWindow, resetBootWindowForTest, type BootWindowOptions } from 'src/ts/bootWindow'
import { markPluginPanelHidden, markPluginPanelShown, resetBusyActionsForTest } from 'src/ts/process/memory/busyActions'

const markUnsaved = vi.fn()
let characters: ReturnType<BootWindowOptions['getCharacters']>

function open(overrides: Partial<BootWindowOptions> = {}) {
    return openBootWindow({ getCharacters: () => characters, markUnsaved, ...overrides })
}

function input(type: string, trusted = true) {
    const event = new Event(type, { bubbles: true })
    Object.defineProperty(event, 'isTrusted', { value: trusted })
    document.body.dispatchEvent(event)
}

const panel = () => ({ isConnected: true, style: { display: 'block' } })

beforeEach(() => {
    characters = [{ chaId: 'a' }, { chaId: 'b' }, { chaId: 'c' }]
    selectedCharID.set(-1)
    markUnsaved.mockReset()
    resetBootWindowForTest()
    resetBusyActionsForTest()
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('what the window records', () => {
    test('(G) a window with no selection, input, write or panel answers "nothing unsaved" and records nothing', () => {
        const answer = open().close()
        expect(answer).toEqual({ unsaved: false, selectedChaIds: [] })
    })

    test('(G) the selection at open and every later selection are recorded by chaId, once each, in order', () => {
        selectedCharID.set(1)
        const bootWindow = open()
        selectedCharID.set(0)
        selectedCharID.set(1)
        selectedCharID.set(-1)
        selectedCharID.set(2)
        const answer = bootWindow.close()
        expect(answer.selectedChaIds).toEqual(['b', 'a', 'c'])
        expect(answer.unsaved).toBe(false)
    })

    test('(G) a recorded selection keeps naming its character after the array changes: the index is mapped when it is selected, not when the window closes', () => {
        const bootWindow = open()
        selectedCharID.set(2)
        characters = [{ chaId: 'b' }, { chaId: 'a' }]
        expect(bootWindow.close().selectedChaIds).toEqual(['c'])
    })

    test('(G) close() is idempotent and releases the subscription once', () => {
        const real = selectedCharID.subscribe.bind(selectedCharID)
        const released = vi.fn()
        vi.spyOn(selectedCharID, 'subscribe').mockImplementation((run) => {
            const stop = real(run)
            return () => {
                released()
                stop()
            }
        })
        const bootWindow = open()
        const first = bootWindow.close()
        expect(bootWindow.close()).toBe(first)
        expect(released).toHaveBeenCalledTimes(1)
    })
})

describe('a failing recorder never throws and counts as unsaved', () => {
    test.each([
        ['an index past the end', () => { selectedCharID.set(9) }],
        ['characters that do not exist', () => { characters = undefined; selectedCharID.set(0) }],
        ['a character without a chaId', () => { characters = [{}, { chaId: 'b' }]; selectedCharID.set(0) }],
        ['an empty chaId', () => { characters = [{ chaId: '' }]; selectedCharID.set(0) }],
    ])('S13 (G): %s is unsaved work, throws nothing, and leaves other stores notifying', (_title, select) => {
        const other = writable(0)
        const seen: number[] = []
        other.subscribe((value) => seen.push(value))
        const bootWindow = open()
        expect(select).not.toThrow()
        other.set(1)
        other.set(2)
        expect(seen).toEqual([0, 1, 2])
        expect(get(other)).toBe(2)
        expect(bootWindow.close().unsaved).toBe(true)
    })

    test('S13 (G): a getCharacters that throws is unsaved work and throws nothing', () => {
        const bootWindow = open({ getCharacters: () => { throw new Error('the database is not there yet') } })
        expect(() => selectedCharID.set(0)).not.toThrow()
        expect(bootWindow.close().unsaved).toBe(true)
    })

    test('S13 (G): -1 is "no selection": it is neither recorded nor a failure', () => {
        const bootWindow = open()
        selectedCharID.set(-1)
        expect(bootWindow.close()).toEqual({ unsaved: false, selectedChaIds: [] })
    })
})

describe('input', () => {
    test.each(['pointerdown', 'touchstart', 'click', 'keydown', 'beforeinput', 'input', 'change', 'drop', 'paste', 'cut'])(
        '(G) a trusted %s counts as unsaved work',
        (type) => {
            const bootWindow = open()
            input(type)
            expect(bootWindow.close().unsaved).toBe(true)
        },
    )

    test('S11 (G): an event that is not trusted does not count', () => {
        const bootWindow = open()
        for (const type of ['pointerdown', 'click', 'keydown', 'input']) {
            input(type, false)
        }
        expect(bootWindow.close().unsaved).toBe(false)
    })

    test('(G) a trusted wheel does not count: scrolling edits nothing', () => {
        const bootWindow = open()
        input('wheel')
        expect(bootWindow.close().unsaved).toBe(false)
    })

    test('S12 (G): every listener that was installed is removed by close(), with the capture flag it was installed with', () => {
        const added: Array<[string, EventListenerOrEventListenerObject, boolean]> = []
        const removed: Array<[string, EventListenerOrEventListenerObject, boolean]> = []
        const addEventListener = window.addEventListener.bind(window)
        const removeEventListener = window.removeEventListener.bind(window)
        vi.spyOn(window, 'addEventListener').mockImplementation((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
            added.push([type, listener, typeof options === 'object' && options.capture === true])
            addEventListener(type, listener, options)
        })
        vi.spyOn(window, 'removeEventListener').mockImplementation((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) => {
            removed.push([type, listener, typeof options === 'object' && options.capture === true])
            removeEventListener(type, listener, options)
        })
        open().close()
        expect(added.length).toBeGreaterThan(0)
        expect(added.every(([, , capture]) => capture)).toBe(true)
        expect(removed).toEqual(added)
    })

    test('S9 (G): a listener that cannot be installed counts as unsaved work and throws nothing', () => {
        vi.spyOn(window, 'addEventListener').mockImplementation(() => {
            throw new Error('listeners are unavailable')
        })
        let bootWindow!: ReturnType<typeof open>
        expect(() => { bootWindow = open() }).not.toThrow()
        expect(bootWindow.close().unsaved).toBe(true)
    })

    test('S9 (G): a store that cannot be subscribed to counts as unsaved work and throws nothing', () => {
        vi.spyOn(selectedCharID, 'subscribe').mockImplementation(() => {
            throw new Error('no store')
        })
        const bootWindow = open()
        expect(bootWindow.close().unsaved).toBe(true)
    })
})

describe('plugin panels', () => {
    test('S15 (G): a panel shown inside the window counts, even when it is hidden again before close', () => {
        const bootWindow = open()
        const shown = panel()
        markPluginPanelShown(shown)
        markPluginPanelHidden(shown)
        expect(bootWindow.close().unsaved).toBe(true)
    })

    test('S15 (G): a panel that was already open when the window started counts', () => {
        markPluginPanelShown(panel())
        expect(open().close().unsaved).toBe(true)
    })

    test('S15 (G): a panel that was shown and hidden before the window started does not count', () => {
        const shown = panel()
        markPluginPanelShown(shown)
        markPluginPanelHidden(shown)
        expect(open().close().unsaved).toBe(false)
    })
})

describe('boot writes', () => {
    test('S14 (G): a boot write before close counts as unsaved work and nothing is scheduled', () => {
        const bootWindow = open()
        markBootWrite()
        expect(bootWindow.close().unsaved).toBe(true)
        expect(markUnsaved).not.toHaveBeenCalled()
    })

    test('S14 (G): a boot write made before the window opened counts too', () => {
        markBootWrite()
        expect(open().close().unsaved).toBe(true)
    })

    test('S14 (G): a boot write after close asks for a save and does not change the answer already given', () => {
        const bootWindow = open()
        const answer = bootWindow.close()
        markBootWrite()
        expect(markUnsaved).toHaveBeenCalledTimes(1)
        expect(answer.unsaved).toBe(false)
    })

    test('S14 (G): a boot write never throws into the import, even when the save request does', () => {
        markUnsaved.mockImplementation(() => {
            throw new Error('the loop is gone')
        })
        vi.spyOn(console, 'error').mockImplementation(() => {})
        open().close()
        expect(() => markBootWrite()).not.toThrow()
    })
})
