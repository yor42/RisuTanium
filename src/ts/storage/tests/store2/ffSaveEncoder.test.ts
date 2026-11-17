// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { assembleDatabase, CodecInputError, previousFrom, unitMapSource, type PreviousEncoding } from '../../store2/codec'
import { createKeyMint, type BuildContext } from '../../store2/commit'
import { createSaveEncoder, SavePlanError, type SaveEncoder, type SavePassRequest } from '../../store2/saveEncoder'
import type { Database } from '../../database.svelte'
import { asDatabase, buildSmall, encodeWith, fakeLists, seededEnv, type Obj } from './codecFixtures'

const NOW = 1_700_000_000_000

function clone(db: Database | Obj): Obj {
    return JSON.parse(JSON.stringify(db)) as Obj
}

function request(extra: Partial<SavePassRequest> = {}): SavePassRequest {
    return { marked: new Set(), modules: false, whole: false, ...extra }
}

function contextOf(attempt: number): BuildContext {
    const { mint } = createKeyMint(seededEnv(900 + attempt), null)
    return { mint, seq: 2, now: NOW }
}

function encoderOf(previous: PreviousEncoding): SaveEncoder {
    return createSaveEncoder({ previous, lists: fakeLists, env: seededEnv(77), now: () => NOW })
}

describe('guard (S0-3): encoder.fastForward', () => {
    const first = encodeWith(buildSmall(6))
    const second = encodeWith(buildSmall(5))
    const decoded = (): Database => assembleDatabase(first.manifest, unitMapSource(first.units))

    test('it throws while an attempt is pending and leaves the encoder as it was', async () => {
        const encoder = encoderOf(previousFrom(first))
        const plan = await encoder.plan(decoded(), request({ whole: true }))
        await plan.commitRequest().build(contextOf(1))
        plan.keepAsPending()
        const before = encoder.manifestKey
        expect(() => encoder.fastForward(previousFrom(second))).toThrow(SavePlanError)
        expect(encoder.manifestKey).toBe(before)
        expect(encoder.pendingKey).not.toBeNull()
    })

    test('it replaces the acknowledged encoding', () => {
        const encoder = encoderOf(previousFrom(first))
        const next = previousFrom(second)
        encoder.fastForward(next)
        expect(encoder.acknowledged()).toBe(next)
        expect(encoder.manifestKey).toBe(second.manifestKey)
    })

    test('an encoding with no manifest throws and leaves the encoder as it was', () => {
        const encoder = encoderOf(previousFrom(first))
        const units = new Map(previousFrom(second).units)
        units.delete('manifest')
        expect(() => encoder.fastForward({ units, entities: new Map() })).toThrow(CodecInputError)
        expect(encoder.manifestKey).toBe(first.manifestKey)
    })

    test('it drops every value shadow', () => {
        const encoder = encoderOf(previousFrom(first))
        const db = decoded()
        expect(encoder.verdictOf(db.characters[1])).toBe('clean')
        expect(encoder.shadowStats().entries).toBe(1)
        encoder.fastForward(previousFrom(first))
        expect(encoder.shadowStats()).toEqual({ entries: 0, charged: 0 })
    })

    test('a plan made before it is not unchanged and its acknowledge throws', async () => {
        const encoder = encoderOf(previousFrom(first))
        const db = decoded()
        const planning = encoder.plan(db, request({ whole: true }))
        encoder.fastForward(previousFrom(second))
        const plan = await planning
        expect(plan.unchanged).toBe(false)
        await plan.commitRequest().build(contextOf(1))
        expect(() => plan.acknowledge()).toThrow(SavePlanError)
        expect(encoder.manifestKey).toBe(second.manifestKey)
    })

    test('the same plan with no fast-forward in between is unchanged and acknowledges (control)', async () => {
        const encoder = encoderOf(previousFrom(first))
        const plan = await encoder.plan(decoded(), request({ whole: true }))
        expect(plan.unchanged).toBe(true)
        await plan.commitRequest().build(contextOf(1))
        expect(() => plan.acknowledge()).not.toThrow()
    })

    test('a plan made after it is over the new encoding', async () => {
        const encoder = encoderOf(previousFrom(first))
        encoder.fastForward(previousFrom(second))
        const plan = await encoder.plan(assembleDatabase(second.manifest, unitMapSource(second.units)), request({ whole: true }))
        expect(plan.unchanged).toBe(true)
        const carry = plan.commitRequest().carry
        expect(typeof carry === 'object' && carry.from).toBe(second.manifestKey)
    })
})

describe('guard (S0-5): SavePlan.written', () => {
    test('every written entry is a unit the commit wrote, under the digest the acknowledged encoding then holds', async () => {
        const first = encodeWith(buildSmall(6))
        const encoder = encoderOf(previousFrom(first))
        const db = clone(assembleDatabase(first.manifest, unitMapSource(first.units)))
        ;(db.characters as Obj[])[1].personality = 'edited'
        ;((db.botPresets as Obj[])[1]).temperature = 999
        db.statics = { counter: 3 }
        const before = encoder.acknowledged()
        const plan = await encoder.plan(asDatabase(db), request({ marked: new Set([(db.characters as Obj[])[1].chaId as string]) }))
        await plan.commitRequest().build(contextOf(1))
        plan.acknowledge()
        const after = encoder.acknowledged()
        expect(plan.written.size).toBeGreaterThanOrEqual(3)
        for (const [identity, digest] of plan.written) {
            expect(after.units.get(identity)?.digest, identity).toBe(digest)
            expect(after.units.get(identity)?.key, identity).not.toBe(before.units.get(identity)?.key)
        }
        const rewritten = [...after.units].filter(([identity, unit]) => before.units.get(identity)?.key !== unit.key).map(([identity]) => identity)
        const parents = rewritten.filter(identity => !plan.written.has(identity)).sort()
        expect(parents.every(identity => identity === 'manifest' || identity.startsWith('shard:'))).toBe(true)
        expect(rewritten.length).toBe(plan.newUnits)
    })

    test('a pass that changes nothing has an empty map', async () => {
        const first = encodeWith(buildSmall(6))
        const encoder = encoderOf(previousFrom(first))
        const plan = await encoder.plan(assembleDatabase(first.manifest, unitMapSource(first.units)), request({ whole: true }))
        expect(plan.unchanged).toBe(true)
        expect(plan.written.size).toBe(0)
    })
})
