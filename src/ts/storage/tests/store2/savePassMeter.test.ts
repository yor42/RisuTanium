// @vitest-environment node
/**
 * The save-pass meter on its own: the kind a request gets, which units a commit record keeps, the switch, and that a
 * failing meter never throws.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
    finishSavePass, noteSavePassCommit, savePassKindOf, startSavePass, type MeteredUnit, type SavePassMeterHandle,
} from '../../store2/savePassMeter'
import { UNIT_TYPE } from '../../store2/format'

type MeterGlobal = { __risuSavePassMeter?: SavePassMeterHandle }

function switchTo(value: string | null): void {
    vi.stubGlobal('localStorage', { getItem: (key: string) => key === 'risu-measure-savepass' ? value : null })
}

function unit(identity: string, key: string, reused: boolean, size = 4): MeteredUnit {
    return { identity, key, type: UNIT_TYPE.manifest, bytes: new Uint8Array(size), reused }
}

function handleOf(target: object): SavePassMeterHandle {
    const found = (target as MeterGlobal).__risuSavePassMeter
    if (found === undefined) {
        throw new Error('The meter handle is not installed.')
    }
    return found
}

beforeEach(() => {
    switchTo('on')
    const scratch = {}
    startSavePass(scratch)
    handleOf(scratch).reset()
    vi.unstubAllGlobals()
    delete (globalThis as MeterGlobal).__risuSavePassMeter
})

afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

describe('savePassKindOf', () => {
    test('rewriteAll outranks whole, tick and edit', () => {
        expect(savePassKindOf({ whole: true, rewriteAll: true, net: {} })).toBe('rewriteAll')
        expect(savePassKindOf({ whole: false, rewriteAll: true, net: {} })).toBe('rewriteAll')
    })

    test('whole outranks tick and edit', () => {
        expect(savePassKindOf({ whole: true, net: {} })).toBe('whole')
        expect(savePassKindOf({ whole: true, rewriteAll: false })).toBe('whole')
    })

    test('a net request is a tick, anything else an edit', () => {
        expect(savePassKindOf({ whole: false, net: {} })).toBe('tick')
        expect(savePassKindOf({ whole: false })).toBe('edit')
        expect(savePassKindOf({ whole: false, rewriteAll: false })).toBe('edit')
    })
})

describe('the commit record', () => {
    test('keeps the identity and key of each unit that was written and none that was reused', () => {
        switchTo('on')
        const target = {}
        startSavePass(target)
        noteSavePassCommit({ whole: false }, [
            unit('module:a', 'k-reused', true),
            unit('char:u1:core', 'k-new-1', false, 33_142 % 251),
            unit('manifest', 'k-new-2', false),
        ])
        const [record] = handleOf(target).units()
        expect(record.kind).toBe('edit')
        expect(record.units.map(entry => [entry.identity, entry.key])).toEqual([['char:u1:core', 'k-new-1'], ['manifest', 'k-new-2']])
        expect(record.units[0].bytes).toBe(33_142 % 251)
    })

    test('keeps only the newest records past the limit', () => {
        switchTo('on')
        const target = {}
        startSavePass(target)
        for (let i = 0; i < 1005; i++) {
            noteSavePassCommit({ whole: false }, [unit(`id-${i}`, `k-${i}`, false)])
        }
        const kept = handleOf(target).units()
        expect(kept.length).toBe(1000)
        expect(kept[0].units[0].identity).toBe('id-5')
    })
})

describe('the pass record and the switch', () => {
    test('a pass is recorded with its kind, modules, character count and elapsed time', () => {
        switchTo('on')
        vi.spyOn(console, 'log').mockImplementation(() => {})
        const target = {}
        const started = startSavePass(target)
        expect(started).not.toBeNull()
        finishSavePass(started, { whole: true }, true, 7)
        const record = handleOf(target).last()
        expect(record).toMatchObject({ kind: 'whole', modules: true, characters: 7 })
        expect(record?.ms).toBeGreaterThanOrEqual(0)
        handleOf(target).reset()
        expect(handleOf(target).all()).toEqual([])
        expect(handleOf(target).units()).toEqual([])
    })

    test('without the storage switch nothing is installed or recorded', () => {
        for (const value of [null, 'off', '1']) {
            switchTo(value)
            const target = {}
            const started = startSavePass(target)
            expect(started).toBeNull()
            finishSavePass(started, { whole: false }, false, 0)
            noteSavePassCommit({ whole: false }, [unit('a', 'b', false)])
            expect((target as MeterGlobal).__risuSavePassMeter).toBeUndefined()
        }
        switchTo('on')
        const later = {}
        startSavePass(later)
        expect(handleOf(later).all()).toEqual([])
        expect(handleOf(later).units()).toEqual([])
    })

    test('a throwing console, clock or storage never reaches the caller', () => {
        switchTo('on')
        const log = vi.spyOn(console, 'log').mockImplementation(() => { throw new Error('console') })
        const started = startSavePass({})
        expect(started).not.toBeNull()
        expect(() => finishSavePass(started, { whole: false }, false, 1)).not.toThrow()
        log.mockRestore()

        const clock = vi.spyOn(performance, 'now').mockImplementation(() => { throw new Error('clock') })
        expect(startSavePass({})).toBeNull()
        expect(() => finishSavePass(1, { whole: false }, false, 1)).not.toThrow()
        clock.mockRestore()

        const iterationFails = { [Symbol.iterator]() { throw new Error('iteration') } } as unknown as readonly MeteredUnit[]
        const readFails = [{ identity: 'a', key: 'b', type: UNIT_TYPE.manifest, reused: false, get bytes(): Uint8Array { throw new Error('read') } }]
        expect(() => noteSavePassCommit({ whole: false }, iterationFails)).not.toThrow()
        expect(() => noteSavePassCommit({ whole: false }, readFails)).not.toThrow()

        vi.stubGlobal('localStorage', { getItem: () => { throw new Error('storage') } })
        expect(startSavePass({})).toBeNull()
        expect(() => noteSavePassCommit({ whole: false }, [unit('a', 'b', false)])).not.toThrow()
    })
})
