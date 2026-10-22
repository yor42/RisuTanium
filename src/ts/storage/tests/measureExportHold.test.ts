// @vitest-environment node
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { beginBusy, busyKinds, resetBusyActionsForTest } from '../../process/memory/busyActions'
import {
    createNetHoldCheck, installNetHold, netHeldNow, noteNetHeldTick, noteNetPassTick, peekNetTickStats, residentCharacterCount,
    resetNetTickStats, setNetHoldCheck,
} from '../measureExportHold'

/**
 * The seam behind the measurement-build idle-net hold: the check over the real busy registry, the never-throwing
 * reader, the tick counts and the resident count. Labels: (G) is a compatibility guard that passes with or without the
 * change; the rest is new behaviour.
 */

const flags = vi.hoisted(() => ({ measure: true }))

vi.mock('../../process/memory/measureFlag', () => ({
    get MEASURE() {
        return flags.measure
    },
}))

beforeEach(() => {
    flags.measure = true
    setNetHoldCheck(null)
    resetNetTickStats()
})

afterEach(() => {
    resetBusyActionsForTest()
    setNetHoldCheck(null)
})

describe('createNetHoldCheck over the real busy registry', () => {
    test('holds exactly while a backupSave entry is registered', () => {
        const check = createNetHoldCheck(busyKinds)
        expect(check()).toBe(false)
        const handle = beginBusy('backupSave')
        expect(check()).toBe(true)
        handle.end()
        expect(check()).toBe(false)
    })

    test('no other busy kind holds', () => {
        const check = createNetHoldCheck(busyKinds)
        beginBusy('export')
        beginBusy('import')
        beginBusy('backupLoad')
        expect(check()).toBe(false)
    })
})

describe('installNetHold and netHeldNow', () => {
    test('install holds only when the switch says on, and the check follows the busy state', () => {
        expect(installNetHold(busyKinds, () => 'on')).toBe(true)
        expect(netHeldNow()).toBe(false)
        const handle = beginBusy('backupSave')
        expect(netHeldNow()).toBe(true)
        handle.end()
        expect(netHeldNow()).toBe(false)
    })

    test('a switch that is off, absent or unreadable installs no hold', () => {
        beginBusy('backupSave')
        for (const read of [() => 'off', () => null, () => { throw new Error('storage is blocked') }]) {
            expect(installNetHold(busyKinds, read)).toBe(false)
            expect(netHeldNow()).toBe(false)
        }
    })

    test('a check that throws means not held', () => {
        setNetHoldCheck(() => { throw new Error('the check failed') })
        expect(netHeldNow()).toBe(false)
    })

    test('(G) on a normal build nothing installs and nothing holds', () => {
        flags.measure = false
        expect(installNetHold(busyKinds, () => 'on')).toBe(false)
        setNetHoldCheck(() => true)
        expect(netHeldNow()).toBe(false)
    })
})

describe('the tick counts', () => {
    test('held ticks and run ticks are counted apart, with the run ticks milliseconds added up and a reset clearing them', () => {
        noteNetHeldTick()
        noteNetHeldTick()
        noteNetPassTick(12)
        noteNetPassTick(Number.NaN)
        expect(peekNetTickStats()).toEqual({ held: 2, ticks: 2, tickMs: 12 })
        expect(peekNetTickStats()).toEqual({ held: 2, ticks: 2, tickMs: 12 })
        resetNetTickStats()
        expect(peekNetTickStats()).toEqual({ held: 0, ticks: 0, tickMs: 0 })
    })
})

describe('residentCharacterCount', () => {
    test('counts the slots that are not cold stubs, and zero for a non-list', () => {
        expect(residentCharacterCount([{ chaId: 'a' }, { chaId: 'b', coldstorage: 'u' }, { chaId: 'c' }, null])).toBe(2)
        expect(residentCharacterCount(undefined)).toBe(0)
    })
})
