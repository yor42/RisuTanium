/**
 * The busy registry and the choke-point counters (`../memory/busyActions`).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { get } from 'svelte/store'
import {
    anyChokePointInFlight, beginBusy, beginChokePoint, beginDialogWait, BUSY_HISTORY_LIMIT, busyKinds, busyRefusalLine,
    busySnapshot, chokePointInFlight, isBusy, resetBusyActionsForTest, withBusy,
} from '../memory/busyActions'
import { inFlightKinds } from '../inFlightWork'
import type { BusySnapshot } from '../memory/busyActions'

beforeEach(() => {
    resetBusyActionsForTest()
})

afterEach(() => {
    vi.useRealTimers()
})

describe('the busy registry', () => {
    test('is idle until an action begins and idle again once it ends', () => {
        expect(isBusy()).toBe(false)
        const handle = beginBusy('import')
        expect(isBusy()).toBe(true)
        expect(busyKinds()).toEqual(['import'])
        handle.end()
        expect(isBusy()).toBe(false)
    })

    test('ending an entry twice does not end another entry of the same kind', () => {
        const first = beginBusy('import')
        beginBusy('import')
        first.end()
        first.end()
        expect(busyKinds()).toEqual(['import'])
        expect(isBusy()).toBe(true)
    })

    test('a refusal that excludes its own entry sees only the other entries', () => {
        const own = beginBusy('cleanup')
        expect(isBusy({ except: own })).toBe(false)
        const other = beginBusy('import')
        expect(isBusy({ except: own })).toBe(true)
        other.end()
        expect(isBusy({ except: own })).toBe(false)
        expect(isBusy()).toBe(true)
    })

    test('excluding an entry that has ended excludes nothing', () => {
        const ended = beginBusy('cleanup')
        ended.end()
        beginBusy('import')
        expect(isBusy({ except: ended })).toBe(true)
    })

    test('withBusy ends its entry when the work resolves and when it throws', async () => {
        let during: string[] = []
        await withBusy('export', async () => { during = busyKinds() })
        expect(during).toEqual(['export'])
        expect(isBusy()).toBe(false)

        await expect(withBusy('export', async () => { throw new Error('write failed') })).rejects.toThrow('write failed')
        expect(isBusy()).toBe(false)
    })
})

describe('the busy diagnostic accessor', () => {
    function readAccessor(): BusySnapshot {
        const snapshot = window.__risuTaniumBusy
        if (!snapshot) {
            throw new Error('the busy accessor is not installed')
        }
        return snapshot
    }

    test('shows no entry when idle and a live entry with its kind and age', () => {
        vi.useFakeTimers()
        vi.setSystemTime(1_000_000)
        expect(busySnapshot().entries).toEqual([])
        beginBusy('import')
        vi.advanceTimersByTime(5000)
        const snapshot = busySnapshot()
        expect(snapshot.now).toBe(1_005_000)
        expect(snapshot.entries).toEqual([{ kind: 'import', startedAt: 1_000_000, ageMs: 5000, awaitingDialogMs: null }])
    })

    test('lists live entries in begin order', () => {
        beginBusy('import')
        beginBusy('export')
        expect(busySnapshot().entries.map((entry) => entry.kind)).toEqual(['import', 'export'])
    })

    test('an ended entry moves to recent with its duration and a second end records nothing', () => {
        vi.useFakeTimers()
        vi.setSystemTime(2_000_000)
        const handle = beginBusy('export')
        vi.advanceTimersByTime(1200)
        handle.end()
        handle.end()
        const snapshot = busySnapshot()
        expect(snapshot.entries).toEqual([])
        expect(snapshot.recent).toEqual([
            { kind: 'export', startedAt: 2_000_000, endedAt: 2_001_200, durationMs: 1200, dialogMs: 0 },
        ])
    })

    test('an entry still live is not in recent', () => {
        beginBusy('export')
        expect(busySnapshot().recent).toEqual([])
    })

    test('recent keeps the newest entries, oldest first, up to the limit', () => {
        expect(BUSY_HISTORY_LIMIT).toBe(20)
        vi.useFakeTimers()
        vi.setSystemTime(3_000_000)
        for (let i = 0; i < 25; i += 1) {
            const handle = beginBusy(i % 2 === 0 ? 'import' : 'export')
            vi.advanceTimersByTime(10)
            handle.end()
        }
        const recent = busySnapshot().recent
        expect(recent).toHaveLength(BUSY_HISTORY_LIMIT)
        expect(recent[0].startedAt).toBe(3_000_000 + 5 * 10)
        expect(recent[recent.length - 1].startedAt).toBe(3_000_000 + 24 * 10)
        expect(recent.map((record) => record.startedAt)).toEqual([...recent.map((record) => record.startedAt)].sort((a, b) => a - b))
    })

    test('the getter exists after import, returns a fresh copy and cannot be replaced', () => {
        const descriptor = Object.getOwnPropertyDescriptor(window, '__risuTaniumBusy')
        expect(typeof descriptor?.get).toBe('function')
        expect(descriptor?.set).toBeUndefined()
        expect(descriptor?.enumerable).toBe(false)

        beginBusy('import')
        const first = readAccessor()
        first.entries.length = 0
        first.recent.push({ kind: 'export', startedAt: 0, endedAt: 0, durationMs: 0, dialogMs: 0 })
        const second = readAccessor()
        expect(second).not.toBe(first)
        expect(second.entries).toHaveLength(1)
        expect(second.recent).toEqual([])

        expect(Reflect.set(window, '__risuTaniumBusy', null)).toBe(false)
        expect(readAccessor().entries).toHaveLength(1)
    })

    test('counts begun entries, shows the busy in-flight token and follows the choke points', async () => {
        expect(busySnapshot().begun).toBe(0)
        expect(busySnapshot().inFlight).not.toContain('busy')
        const handle = beginBusy('import')
        await withBusy('export', async () => undefined)
        const snapshot = busySnapshot()
        expect(snapshot.begun).toBe(2)
        expect(snapshot.inFlight).toContain('busy')

        const endAsset = beginChokePoint('asset')
        beginChokePoint('pluginBridge')
        expect(busySnapshot().chokePoints).toEqual({ asset: 1, inlay: 0, coldStorage: 0, pluginBridge: 1 })
        endAsset()
        expect(busySnapshot().chokePoints.asset).toBe(0)

        resetBusyActionsForTest()
        const cleared = busySnapshot()
        expect(cleared.begun).toBe(0)
        expect(cleared.entries).toEqual([])
        expect(cleared.recent).toEqual([])
        expect(cleared.inFlight).not.toContain('busy')
        expect(cleared.chokePoints).toEqual({ asset: 0, inlay: 0, coldStorage: 0, pluginBridge: 0 })
        handle.end()
    })

    test('serialises to JSON without loss', () => {
        const done = beginBusy('export')
        done.end()
        beginBusy('import')
        beginChokePoint('inlay')
        const snapshot = busySnapshot()
        expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot)
    })
})

describe('the choke-point counters', () => {
    test('count writes in flight per point and end idempotently', () => {
        const endAsset = beginChokePoint('asset')
        const endAssetAgain = beginChokePoint('asset')
        const endInlay = beginChokePoint('inlay')
        expect(chokePointInFlight('asset')).toBe(2)
        expect(chokePointInFlight('inlay')).toBe(1)
        expect(anyChokePointInFlight()).toBe(true)

        endAsset()
        endAsset()
        expect(chokePointInFlight('asset')).toBe(1)
        endAssetAgain()
        endInlay()
        expect(anyChokePointInFlight()).toBe(false)
    })
})

describe('an entry waiting on a save dialog', () => {
    test('every reader still counts it, and only an ignoreDialogWaits refusal skips it', () => {
        vi.useFakeTimers()
        vi.setSystemTime(5_000_000)
        const handle = beginBusy('export')
        beginDialogWait(handle)
        vi.advanceTimersByTime(700)

        expect(isBusy()).toBe(true)
        expect(busyKinds()).toEqual(['export'])
        expect(inFlightKinds()).toContain('busy')
        expect(isBusy({ ignoreDialogWaits: true })).toBe(false)
        expect(busySnapshot().entries[0].awaitingDialogMs).toBe(700)
    })

    test('the returned function unmarks once; a second call changes nothing, and the ring record keeps the dialog time', () => {
        vi.useFakeTimers()
        vi.setSystemTime(6_000_000)
        const handle = beginBusy('export')
        const unmark = beginDialogWait(handle)
        vi.advanceTimersByTime(400)
        unmark()
        expect(isBusy({ ignoreDialogWaits: true })).toBe(true)
        expect(busySnapshot().entries[0].awaitingDialogMs).toBeNull()

        const again = beginDialogWait(handle)
        again()
        unmark()
        expect(isBusy({ ignoreDialogWaits: true })).toBe(true)

        vi.advanceTimersByTime(100)
        handle.end()
        expect(busySnapshot().recent[0]).toMatchObject({ durationMs: 500, dialogMs: 400 })
    })

    test('ending an entry that is still marked removes the mark', () => {
        const handle = beginBusy('export')
        beginDialogWait(handle)
        handle.end()
        const next = beginBusy('import')
        expect(isBusy({ ignoreDialogWaits: true })).toBe(true)
        next.end()
        expect(isBusy({ ignoreDialogWaits: true })).toBe(false)
        expect(isBusy()).toBe(false)
    })

    test('except and ignoreDialogWaits combine', () => {
        const own = beginBusy('cleanup')
        const marked = beginBusy('export')
        beginDialogWait(marked)
        expect(isBusy({ except: own, ignoreDialogWaits: true })).toBe(false)
        expect(isBusy({ except: own })).toBe(true)
        beginBusy('import')
        expect(isBusy({ except: own, ignoreDialogWaits: true })).toBe(true)
    })

    test('marking an ended handle is a no-op: nothing is registered and the line is unchanged', () => {
        const handle = beginBusy('export')
        const other = beginBusy('import')
        busyRefusalLine.set('line')
        handle.end()
        const unmark = beginDialogWait(handle)
        unmark()
        expect(busyKinds()).toEqual(['import'])
        expect(get(busyRefusalLine)).toBe('line')
        other.end()
    })

    test('the refusal line clears once no unmarked entry remains', () => {
        // (a) the unmarked entry ends while the other is marked
        const marked = beginBusy('export')
        const plain = beginBusy('import')
        busyRefusalLine.set('line')
        beginDialogWait(marked)
        expect(get(busyRefusalLine)).toBe('line')
        plain.end()
        expect(get(busyRefusalLine)).toBeNull()
        marked.end()

        // (b) the only entry is marked
        const only = beginBusy('export')
        busyRefusalLine.set('line')
        beginDialogWait(only)
        expect(get(busyRefusalLine)).toBeNull()
        only.end()
    })

    // Compatibility guard (passes with or without marks): with no mark the line stays until the last entry ends.
    test('with no mark the line stays until the last entry ends', () => {
        const first = beginBusy('export')
        const second = beginBusy('import')
        busyRefusalLine.set('line')
        first.end()
        expect(get(busyRefusalLine)).toBe('line')
        second.end()
        expect(get(busyRefusalLine)).toBeNull()
    })

    test('a reset clears the marks', () => {
        const handle = beginBusy('export')
        beginDialogWait(handle)
        resetBusyActionsForTest()
        const next = beginBusy('export')
        expect(isBusy({ ignoreDialogWaits: true })).toBe(true)
        expect(busySnapshot().entries[0].awaitingDialogMs).toBeNull()
        next.end()
    })

    test('withBusy passes its own handle to the work', async () => {
        let seen: string[] = []
        await withBusy('export', async (handle) => {
            seen = [handle.kind, ...busyKinds()]
            beginDialogWait(handle)
        })
        expect(seen).toEqual(['export', 'export'])
        expect(isBusy()).toBe(false)
    })
})
