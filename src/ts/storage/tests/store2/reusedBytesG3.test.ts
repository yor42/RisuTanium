// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { encodeDatabase, previousFrom, type EncodedTree, type EncodedUnit, type PreviousEncoding, type ReusableUnit } from '../../store2/codec'
import { UNIT_TYPE } from '../../store2/format'
import { createListDerivation } from '../../store2/lists'
import type { Database } from '../../database.svelte'
import { buildSmall, sameBytes, seededEnv, type Obj } from './codecFixtures'

/**
 * Compatibility guard (it passes before and after the change that stops reused units from holding bytes): under
 * `keepBytes` the units an encode wrote hand their exact bytes to the next encode, which then compares byte for byte;
 * a reused unit carries none and is judged again by type, Ref and digest.
 */

const NOW = 1_700_000_000_000
const lists = createListDerivation()

function chain(): { db: Obj, t1: EncodedTree, t2: EncodedTree } {
    const db = JSON.parse(JSON.stringify(buildSmall(3))) as Obj
    const t1 = encodeDatabase(db as unknown as Database, { env: seededEnv(1), lists, seq: 1, createdAt: NOW })
    ;(db.characters as Obj[])[1].desc = 'edited character'
    ;(db.modules as Obj[])[0].description = 'edited module'
    const t2 = encodeDatabase(db as unknown as Database,
        { env: seededEnv(2), lists, seq: 2, createdAt: NOW, previous: previousFrom(t1, true) })
    return { db, t1, t2 }
}

function writtenOf(tree: EncodedTree): EncodedUnit[] {
    return tree.units.filter(unit => unit.reused === false)
}

function reusedOf(tree: EncodedTree): EncodedUnit[] {
    return tree.units.filter(unit => unit.reused === true)
}

describe('keepBytes hands the written units\' bytes on', () => {
    test('the second encode writes edited non-manifest units and reuses the rest', () => {
        const { t2 } = chain()
        expect(writtenOf(t2).filter(unit => unit.type !== UNIT_TYPE.manifest).length).toBeGreaterThan(0)
        expect(reusedOf(t2).length).toBeGreaterThan(0)
    })

    test('each written unit of the second encode is kept with its exact bytes', () => {
        const { t2 } = chain()
        const kept = previousFrom(t2, true)
        for (const unit of t2.units) {
            if (unit.reused === false) {
                const carried = kept.units.get(unit.identity)
                expect(carried?.bytes).toBeDefined()
                expect(sameBytes(carried?.bytes ?? new Uint8Array(), unit.bytes)).toBe(true)
            }
        }
    })

    test('a unit with the same Ref and digest but other bytes is not reused', () => {
        const { db, t2 } = chain()
        const kept = previousFrom(t2, true)
        const target = writtenOf(t2).find(unit => unit.type !== UNIT_TYPE.manifest)
        expect(target).toBeDefined()
        if (target === undefined || target.reused !== false) {
            return
        }
        const tampered = new Uint8Array(target.bytes)
        tampered[tampered.length - 1] ^= 0xff
        const units = new Map<string, ReusableUnit>(kept.units)
        const original = units.get(target.identity)
        expect(original).toBeDefined()
        units.set(target.identity, { ...original as ReusableUnit, bytes: tampered })
        const previous: PreviousEncoding = { units, entities: kept.entities, objects: kept.objects }
        const t3 = encodeDatabase(db as unknown as Database, { env: seededEnv(3), lists, seq: 3, createdAt: NOW, previous })
        const again = t3.units.find(unit => unit.identity === target.identity)
        expect(again?.reused).toBe(false)
        expect(again?.key).not.toBe(target.key)
    })

    test('a reused unit is reused again by Ref and digest, and a written one by its kept bytes', () => {
        const { db, t2 } = chain()
        const t3 = encodeDatabase(db as unknown as Database,
            { env: seededEnv(3), lists, seq: 3, createdAt: NOW, previous: previousFrom(t2, true) })
        const second = new Map(t2.units.map(unit => [unit.identity, unit]))
        for (const unit of t3.units) {
            if (unit.type === UNIT_TYPE.manifest) {
                continue
            }
            expect(unit.reused).toBe(true)
            expect(unit.key).toBe(second.get(unit.identity)?.key)
        }
        // A module's list units may be carried instead of re-encoded, so they leave `units` but stay in the index.
        const indexed = previousFrom(t3).units
        expect(reusedOf(t2).every(unit => indexed.get(unit.identity)?.key === unit.key)).toBe(true)
        expect(writtenOf(t2).filter(unit => unit.type !== UNIT_TYPE.manifest)
            .every(unit => t3.units.some(next => next.identity === unit.identity && next.reused === true))).toBe(true)
    })
})
