// @vitest-environment node
/**
 * The save-pass meter through the real save encoder: what a pass and a committed attempt record, that nothing is
 * installed when the measurement flag or the storage switch is off, and that a failing meter changes nothing about
 * the plan the encoder hands back.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const flag = vi.hoisted(() => ({ measure: true }))

vi.mock('src/ts/process/memory/measureFlag', () => ({
    get MEASURE() {
        return flag.measure
    },
}))

import { previousFrom } from '../../store2/codec'
import { createKeyMint, type BuildContext } from '../../store2/commit'
import { createSaveEncoder, type SaveEncoder, type SavePassRequest } from '../../store2/saveEncoder'
import { startSavePass, type SavePassMeterHandle } from '../../store2/savePassMeter'
import type { Database } from '../../database.svelte'
import { asDatabase, buildSmall, encodeWith, fakeLists, seededEnv, type Obj } from './codecFixtures'

const NOW = 1_700_000_000_000

type MeterGlobal = { __risuSavePassMeter?: SavePassMeterHandle }

function meterOf(): SavePassMeterHandle | undefined {
    return (globalThis as MeterGlobal).__risuSavePassMeter
}

function request(extra: Partial<SavePassRequest> = {}): SavePassRequest {
    return { marked: new Set(), modules: false, whole: false, ...extra }
}

function encoderOf(db: Database): SaveEncoder {
    return createSaveEncoder({ previous: previousFrom(encodeWith(db)), lists: fakeLists, env: seededEnv(77), now: () => NOW })
}

function contextOf(attempt: number): BuildContext {
    const { mint } = createKeyMint(seededEnv(900 + attempt), null)
    return { mint, seq: 2, now: NOW }
}

function renamed(db: Database): Database {
    const next = JSON.parse(JSON.stringify(db)) as Obj
    ;((next.characters as Obj[])[0]).name = 'a name no fixture holds'
    return asDatabase(next)
}

function chaIdOf(db: Database): string {
    return (db.characters[0] as { chaId: string }).chaId
}

function switchTo(value: string | null): void {
    vi.stubGlobal('localStorage', { getItem: (key: string) => key === 'risu-measure-savepass' ? value : null })
}

beforeEach(() => {
    flag.measure = true
    switchTo('on')
    vi.spyOn(console, 'log').mockImplementation(() => {})
    startSavePass()
    meterOf()?.reset()
    delete (globalThis as MeterGlobal).__risuSavePassMeter
})

/** Switches the meter on afterwards and returns its handle, so a test can see what the earlier calls left in the rings. */
function ringsAfterwards(): SavePassMeterHandle {
    switchTo('on')
    startSavePass()
    const found = meterOf()
    if (found === undefined) {
        throw new Error('The meter handle is not installed.')
    }
    return found
}

afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    delete (globalThis as MeterGlobal).__risuSavePassMeter
})

describe('the pass record', () => {
    test('each request shape records its kind, the modules flag and the encoded character count', async () => {
        const db = buildSmall(4)
        const encoder = encoderOf(db)
        await encoder.plan(db, request())
        await encoder.plan(db, request({ marked: new Set([chaIdOf(db)]) }))
        await encoder.plan(db, request({ net: { chaId: chaIdOf(db), modules: true } }))
        await encoder.plan(db, request({ whole: true }))
        await encoder.plan(db, request({ whole: true, rewriteAll: true }))
        const records = meterOf()?.all() ?? []
        expect(records.map(record => [record.kind, record.modules, record.characters])).toEqual([
            ['edit', false, 0],
            ['edit', false, 1],
            ['tick', true, 1],
            ['whole', true, 4],
            ['rewriteAll', true, 4],
        ])
        expect(records.every(record => record.ms >= 0)).toBe(true)
    })
})

describe('the commit record', () => {
    test('an acknowledged pass records exactly the units it wrote, and a plan never acknowledged records none', async () => {
        const db = renamed(buildSmall(4))
        const encoder = encoderOf(buildSmall(4))
        const abandoned = await encoder.plan(db, request({ marked: new Set([chaIdOf(db)]) }))
        await abandoned.commitRequest().build(contextOf(1))
        expect(meterOf()?.units()).toEqual([])

        const plan = await encoder.plan(db, request({ marked: new Set([chaIdOf(db)]) }))
        const built = await plan.commitRequest().build(contextOf(2))
        plan.acknowledge()
        const [record] = meterOf()?.units() ?? []
        expect(record.kind).toBe('edit')
        expect(plan.newUnits).toBeGreaterThan(1)
        expect(record.units.length).toBe(plan.newUnits)
        const total = encoder.acknowledged().units.size
        expect(record.units.length).toBeLessThan(total)
        const keys = new Map([...encoder.acknowledged().units].map(([identity, unit]) => [identity, unit.key]))
        for (const unit of record.units) {
            expect(keys.get(unit.identity)).toBe(unit.key)
        }
        expect(built).toBeDefined()
    })
})

describe('off and failing', () => {
    test('with the measurement flag off nothing is installed or recorded', async () => {
        flag.measure = false
        const db = renamed(buildSmall(3))
        const encoder = encoderOf(buildSmall(3))
        const plan = await encoder.plan(db, request({ marked: new Set([chaIdOf(db)]) }))
        await plan.commitRequest().build(contextOf(1))
        plan.acknowledge()
        expect(meterOf()).toBeUndefined()
        const rings = ringsAfterwards()
        expect(rings.all()).toEqual([])
        expect(rings.units()).toEqual([])
    })

    test('without the storage switch nothing is installed or recorded', async () => {
        switchTo(null)
        const db = renamed(buildSmall(3))
        const encoder = encoderOf(buildSmall(3))
        const plan = await encoder.plan(db, request({ marked: new Set([chaIdOf(db)]) }))
        await plan.commitRequest().build(contextOf(1))
        plan.acknowledge()
        expect(meterOf()).toBeUndefined()
        const rings = ringsAfterwards()
        expect(rings.all()).toEqual([])
        expect(rings.units()).toEqual([])
    })

    test('a failing meter leaves the plan, the build and the acknowledgement as they were', async () => {
        const db = renamed(buildSmall(3))
        const marked = new Set([chaIdOf(db)])
        const control = encoderOf(buildSmall(3))
        flag.measure = false
        const expectedPlan = await control.plan(db, request({ marked }))
        const expectedBuilt = await expectedPlan.commitRequest().build(contextOf(1))
        expectedPlan.acknowledge()

        flag.measure = true
        vi.spyOn(console, 'log').mockImplementation(() => { throw new Error('console') })
        const encoder = encoderOf(buildSmall(3))
        const plan = await encoder.plan(db, request({ marked }))
        const built = await plan.commitRequest().build(contextOf(1))
        plan.acknowledge()
        expect(plan.newUnits).toBe(expectedPlan.newUnits)
        expect(built.units.map(unit => unit.key)).toEqual(expectedBuilt.units.map(unit => unit.key))
        expect(encoder.manifestKey).toBe(control.manifestKey)
    })
})
