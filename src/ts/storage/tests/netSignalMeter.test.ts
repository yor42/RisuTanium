import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { beginInFlight } from '../../process/inFlightWork'
import {
    classifyChange, ensureInstalled, noteIdentity, notePartitionTag, noteSignal, resetNetSignalsForTest, type NetSignalHandle,
} from '../netSignalMeter'

/**
 * CHORE-205 counter experiment: the net-signal meter. Drives the real module with the switch in a real `localStorage`
 * (the happy-dom one). The cross-chunk handle is `globalThis.__risuNetSignals`; records must hold copies of it.
 */

const SWITCH_KEY = 'risu-measure-savepass'

function handleOf(): NetSignalHandle | undefined {
    return (globalThis as { __risuNetSignals?: NetSignalHandle }).__risuNetSignals
}

function requireHandle(): NetSignalHandle {
    const handle = handleOf()
    if (handle === undefined) {
        throw new Error('The signal handle is not installed.')
    }
    return handle
}

/** Installs with the switch on and returns the listeners that were registered on the window, by event type. */
function installOn(selected: string | null = null): Map<string, EventListener[]> {
    localStorage.setItem(SWITCH_KEY, 'on')
    const registered = new Map<string, EventListener[]>()
    vi.spyOn(window, 'addEventListener').mockImplementation((type: string, listener: EventListenerOrEventListenerObject) => {
        registered.set(type, [...(registered.get(type) ?? []), listener as EventListener])
    })
    ensureInstalled(() => selected)
    return registered
}

function fire(listeners: EventListener[] | undefined, event: { isTrusted?: boolean, source?: unknown }): void {
    for (const listener of listeners ?? []) {
        listener(event as unknown as Event)
    }
}

beforeEach(() => {
    localStorage.clear()
    resetNetSignalsForTest()
})

afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    resetNetSignalsForTest()
    localStorage.clear()
})

describe('with the switch off', () => {
    test('nothing is installed, recorded or published', () => {
        const add = vi.spyOn(window, 'addEventListener')
        ensureInstalled(() => 'A')
        noteSignal('api', 'A')
        notePartitionTag()
        noteIdentity('A')
        expect(classifyChange(true)).toBe(false)
        expect(add).not.toHaveBeenCalled()
        expect(handleOf()).toBeUndefined()
    })

    test('a key turned on after install changes nothing: the switch is read once', () => {
        ensureInstalled(() => 'A')
        localStorage.setItem(SWITCH_KEY, 'on')
        ensureInstalled(() => 'A')
        noteSignal('api', 'A')
        expect(handleOf()).toBeUndefined()
    })

    test('before ensureInstalled nothing counts, even with the key on', () => {
        localStorage.setItem(SWITCH_KEY, 'on')
        noteSignal('api', 'A')
        ensureInstalled(() => null)
        expect(requireHandle().signals('A')).toEqual({ api: { n: 0, lastAt: 0 }, identity: { n: 0, lastAt: 0 }, part: { n: 0, lastAt: 0 } })
    })
})

describe('with the switch on', () => {
    test('installs the ten input listeners, one message listener, and publishes the handle', () => {
        const registered = installOn()
        expect([...registered.keys()].sort()).toEqual([
            'beforeinput', 'change', 'click', 'cut', 'drop', 'input', 'keydown', 'message', 'paste', 'pointerdown', 'touchstart',
        ])
        expect(handleOf()).toBeDefined()
    })

    test('each signal source counts: api, identity, part, partGlobal, partFirst, tagOverwritten', () => {
        installOn()
        noteSignal('api', 'A')
        noteSignal('api', 'A')
        noteIdentity('A')
        expect(classifyChange(true)).toBe(false) // the identity flag books it already
        notePartitionTag()
        expect(classifyChange(true)).toBe(true)
        noteSignal('part', 'A')
        expect(classifyChange(true)).toBe(false) // no tag, not first: a global edit
        expect(classifyChange(false)).toBe(false)
        notePartitionTag()
        notePartitionTag()
        const handle = requireHandle()
        const signals = handle.signals('A')
        expect(signals?.api.n).toBe(2)
        expect(signals?.identity.n).toBe(1)
        expect(signals?.part.n).toBe(1)
        expect(handle.globals()).toMatchObject({ partGlobal: 1, partFirst: 1, tagOverwritten: 1 })
    })

    test('the classification order: identity flag first, then first run, then tag, then global', () => {
        installOn()
        noteIdentity('A')
        notePartitionTag()
        expect(classifyChange(true)).toBe(false)
        expect(requireHandle().globals()).toMatchObject({ partGlobal: 0, partFirst: 0, tagOverwritten: 0 })
        // The tag was consumed together with the flag.
        expect(classifyChange(true)).toBe(false)
        expect(requireHandle().globals().partGlobal).toBe(1)
        notePartitionTag()
        expect(classifyChange(false)).toBe(false)
        expect(requireHandle().globals().partFirst).toBe(1)
        expect(classifyChange(true)).toBe(false)
        expect(requireHandle().globals().partGlobal).toBe(2)
    })

    test('only trusted input events count; window messages count in total and from a foreign source', () => {
        const registered = installOn()
        fire(registered.get('click'), { isTrusted: false })
        fire(registered.get('keydown'), { isTrusted: true })
        fire(registered.get('click'), { isTrusted: true })
        fire(registered.get('message'), { source: window })
        fire(registered.get('message'), { source: null })
        expect(requireHandle().globals()).toMatchObject({ input: 2, winMsg: 2, winMsgForeign: 1 })
    })

    test('in-flight begin and end notifications are counted', () => {
        installOn()
        const end = beginInFlight('chat')
        end()
        expect(requireHandle().globals().inFlight).toBe(2)
        expect(requireHandle().inFlightKinds()).toEqual([])
    })

    test('selected() serves the reader, the latest registration wins', () => {
        installOn('A')
        expect(requireHandle().selected()).toBe('A')
        ensureInstalled(() => 'B')
        expect(requireHandle().selected()).toBe('B')
    })

    test('signals(), globals() and dump() return copies: an event after the read leaves the stored copy unchanged', () => {
        installOn()
        const now = vi.spyOn(performance, 'now')
        now.mockReturnValue(100)
        noteSignal('api', 'A')
        const handle = requireHandle()
        const stored = handle.signals('A')
        const dumped = handle.dump()
        const globalsCopy = handle.globals()
        now.mockReturnValue(200)
        noteSignal('api', 'A')
        classifyChange(true)
        expect(stored?.api).toEqual({ n: 1, lastAt: 100 })
        expect(dumped.perChar[0][1].api).toEqual({ n: 1, lastAt: 100 })
        expect(globalsCopy.partGlobal).toBe(0)
        expect(handle.globals().partGlobal).toBe(1)
        expect(handle.signals('A')?.api).toEqual({ n: 2, lastAt: 200 })
        if (stored !== null && stored !== undefined) {
            stored.api.n = 99
        }
        expect(handle.signals('A')?.api.n).toBe(2)
    })

    test('reset() clears the counters and the flags', () => {
        installOn()
        noteSignal('api', 'A')
        noteIdentity('A')
        requireHandle().reset()
        expect(requireHandle().signals('A')).toEqual({ api: { n: 0, lastAt: 0 }, identity: { n: 0, lastAt: 0 }, part: { n: 0, lastAt: 0 } })
        expect(requireHandle().dump().perChar).toEqual([])
        // The identity flag does not survive the reset.
        expect(classifyChange(true)).toBe(false)
        expect(requireHandle().globals().partGlobal).toBe(1)
    })

    test('a storage that throws never escapes', () => {
        vi.stubGlobal('localStorage', {
            getItem: () => {
                throw new Error('storage unavailable')
            },
        })
        expect(() => ensureInstalled(() => null)).not.toThrow()
        expect(handleOf()).toBeUndefined()
    })

    test('after install, 100 input events and 100 noteSignal calls read the storage zero times', () => {
        const registered = installOn()
        const getItem = vi.fn(() => 'on')
        vi.stubGlobal('localStorage', { getItem })
        for (let i = 0; i < 100; i++) {
            fire(registered.get('input'), { isTrusted: true })
            noteSignal('part', 'A')
        }
        expect(getItem).not.toHaveBeenCalled()
        expect(requireHandle().globals().input).toBe(100)
        expect(requireHandle().signals('A')?.part.n).toBe(100)
    })
})

describe('watches', () => {
    test('a watch fires once inside its window and never after it', () => {
        installOn()
        const now = vi.spyOn(performance, 'now')
        now.mockReturnValue(1000)
        const fired: string[] = []
        const handle = requireHandle()
        expect(handle.watch('A', 11000, () => fired.push('A'))).toBe(true)
        noteSignal('part', 'B')
        now.mockReturnValue(5000)
        noteSignal('api', 'A')
        noteSignal('api', 'A')
        expect(fired).toEqual(['A'])
        handle.watch('C', 15000, () => fired.push('C'))
        now.mockReturnValue(15001)
        noteSignal('api', 'C')
        expect(fired).toEqual(['A'])
    })

    test('a throwing callback is contained and the other watches still fire', () => {
        installOn()
        const fired: string[] = []
        const handle = requireHandle()
        handle.watch('A', Number.MAX_SAFE_INTEGER, () => {
            throw new Error('callback failure')
        })
        handle.watch('A', Number.MAX_SAFE_INTEGER, () => fired.push('second'))
        expect(() => noteSignal('identity', 'A')).not.toThrow()
        expect(fired).toEqual(['second'])
    })

    test('the cap holds at 64 live watches and refuses the 65th', () => {
        installOn()
        const handle = requireHandle()
        for (let i = 0; i < 64; i++) {
            expect(handle.watch(`W${i}`, Number.MAX_SAFE_INTEGER, () => {})).toBe(true)
        }
        expect(handle.watch('W64', Number.MAX_SAFE_INTEGER, () => {})).toBe(false)
        expect(handle.dump().watches).toBe(64)
    })

    test('a cap full of expired watches still accepts a new one', () => {
        installOn()
        const now = vi.spyOn(performance, 'now')
        now.mockReturnValue(1000)
        const handle = requireHandle()
        for (let i = 0; i < 64; i++) {
            handle.watch(`W${i}`, 1010, () => {})
        }
        now.mockReturnValue(2000)
        expect(handle.watch('late', 12000, () => {})).toBe(true)
        expect(handle.dump().watches).toBe(1)
    })
})
