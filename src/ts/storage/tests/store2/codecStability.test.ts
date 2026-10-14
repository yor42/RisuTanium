import fc from 'fast-check'
import { describe, expect, test, vi } from 'vitest'
import { assembleDatabase, isUnchanged, toPlainJson, unitMapSource, unitsToWrite } from '../../store2/codec'
import { canonicalJson, FRAME_OVERHEAD } from '../../store2/format'
import type { Database } from '../../database.svelte'
import {
    asDatabase, buildLegacyCases, buildSmall, buildT3, buildT4, buildT5Chat, dbWithCharacters, differingIdentities, encodeWith,
    previousFrom, profileWithChats, roundTrip, sameBytes, seededEnv, textOf, type Obj,
} from './codecFixtures'

// The profile-sized cases encode megabytes; a loaded machine must not turn that into a timeout.
vi.setConfig({ testTimeout: 60_000 })

/** Deep copy with the keys of every object in reverse insertion order. */
function reverseKeys(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(reverseKeys)
    }
    if (typeof value === 'object' && value !== null) {
        const out: Obj = {}
        for (const key of Object.keys(value).reverse()) {
            Object.defineProperty(out, key, { value: reverseKeys((value as Obj)[key]), enumerable: true, writable: true, configurable: true })
        }
        return out
    }
    return value
}

/** Encode, assemble and encode `cycles` times, each from the previous encoding; nothing but the manifest is ever new after the first. */
function expectNoDrift(db: Database, cycles: number): void {
    let tree = encodeWith(db, { env: seededEnv(1) })
    let current = db
    for (let cycle = 1; cycle <= cycles; cycle++) {
        current = assembleDatabase(tree.manifest, unitMapSource(tree.units))
        const next = encodeWith(current, { env: seededEnv(100 + cycle), previous: previousFrom(tree) })
        expect(isUnchanged(next), `cycle ${cycle}`).toBe(true)
        expect(unitsToWrite(next).map(unit => unit.identity), `cycle ${cycle}`).toEqual(['manifest'])
        tree = next
    }
}

describe('byte stability', () => {
    test('the same database encodes to the same bytes on every run', () => {
        const a = encodeWith(buildSmall(4), { env: seededEnv(3) })
        const b = encodeWith(buildSmall(4), { env: seededEnv(3) })
        expect(differingIdentities(a, b)).toEqual([])
        for (let i = 0; i < a.units.length; i++) {
            expect(sameBytes(a.units[i].bytes, b.units[i].bytes)).toBe(true)
        }
    })

    test('every unit payload is canonical JSON: sorted keys at every level, no whitespace', () => {
        const trees = [
            encodeWith(buildSmall(3)),
            encodeWith(dbWithCharacters(buildLegacyCases().map(one => one.character))),
        ]
        for (const tree of trees) {
            for (const unit of tree.units) {
                const text = textOf(unit.bytes.subarray(16, unit.bytes.length - 4))
                expect(canonicalJson(JSON.parse(text)), unit.identity).toBe(text)
            }
        }
    })

    test('the order the keys were inserted in does not change a byte', () => {
        for (const db of [buildSmall(3), dbWithCharacters(buildLegacyCases().map(one => one.character))]) {
            const plain = JSON.parse(JSON.stringify(db)) as Obj
            const a = encodeWith(asDatabase(plain), { env: seededEnv(4) })
            const b = encodeWith(asDatabase(reverseKeys(plain) as Obj), { env: seededEnv(4) })
            expect(differingIdentities(a, b)).toEqual([])
        }
    })

    test('the shape of a unit frame: 20 bytes of overhead around the payload', () => {
        const tree = encodeWith(buildSmall(1))
        for (const unit of tree.units) {
            expect(unit.bytes.length).toBeGreaterThanOrEqual(FRAME_OVERHEAD)
            expect(unit.ref[1]).toBe(unit.bytes.length)
        }
    })

    test('a small profile does not drift over ten encode and assemble cycles', () => {
        expectNoDrift(buildSmall(5), 10)
    })

    test('T3 shaped profile does not drift', () => {
        expectNoDrift(buildT3().db, 3)
    })

    test('T4 shaped profile does not drift', () => {
        expectNoDrift(buildT4().db, 2)
    })

    test('T5 shaped long chats do not drift: 10,000 messages, one 1 MB message, many chunks', () => {
        expectNoDrift(profileWithChats([buildT5Chat(10_000)]), 3)
        expectNoDrift(profileWithChats([buildT5Chat(2000, { at: 1000, bytes: 1_000_000 })]), 3)
        expectNoDrift(profileWithChats(Array.from({ length: 6 }, (_, i) => buildT5Chat(8, { at: 3, bytes: 300_000 }, 6000 + i))), 3)
    })

    test('every legacy and edge shape does not drift, alone and together', () => {
        const cases = buildLegacyCases()
        for (const { label, character } of cases) {
            expect(() => expectNoDrift(dbWithCharacters([character]), 3), label).not.toThrow()
        }
        expectNoDrift(dbWithCharacters(cases.map(one => one.character)), 3)
    })
})

/** Live values a tree can hold that JSON cannot: undefined, NaN, the infinities, -0, a Date, lone surrogates, odd keys. */
const live: fc.Arbitrary<unknown> = fc.letrec(tie => ({
    node: fc.oneof(
        { depthSize: 'small', maxDepth: 3 },
        fc.constant(null),
        fc.constant(undefined),
        fc.boolean(),
        fc.string({ unit: 'binary', maxLength: 8 }),
        fc.double(),
        fc.integer(),
        fc.date(),
        fc.array(tie('node'), { maxLength: 4 }),
        fc.dictionary(fc.string({ maxLength: 6 }), tie('node'), { maxKeys: 4 }),
    ),
})).node

function dbWithLiveFields(value: unknown): Database {
    const db = clone(buildSmall(1))
    db.futureDatabaseField = value
    const slot = (db.characters as Obj[])[0]
    slot.futureCharacterField = value
    slot.scriptstate = value
    const chat = (slot.chats as Obj[])[0]
    chat.futureChatField = value
    chat.lastMemory = value
    chat.scriptstate = value
    ;(chat.message as Obj[])[0].futureMessageField = value
    ;(db.modules as Obj[])[0].futureModuleField = value
    ;(db.pluginCustomStorage as Obj).liveKey = value
    return asDatabase(db)
}

function clone(db: Database): Obj {
    return structuredClone(JSON.parse(JSON.stringify(db))) as Obj
}

describe('residual normalisations are stable', () => {
    test('toPlainJson is what JSON.stringify and JSON.parse make of a value, and idempotent', () => {
        fc.assert(fc.property(live, (value) => {
            const wrapped = { value }
            const expected = JSON.parse(JSON.stringify(wrapped)) as Obj
            const plain = toPlainJson(wrapped)
            expect(plain).toEqual(expected)
            expect(toPlainJson(plain)).toEqual(plain)
        }), { numRuns: 300 })
    })

    test('a database holding any live value re-encodes byte for byte after assemble, and keeps what JSON keeps', () => {
        fc.assert(fc.property(live, (value) => {
            const db = dbWithLiveFields(value)
            const { first, second, assembled } = roundTrip(db)
            expect(differingIdentities(first, second)).toEqual([])
            const expected = JSON.parse(JSON.stringify({ value })) as Obj
            const out = assembled as unknown as Obj
            const slot = (out.characters as Obj[])[0]
            const chat = (slot.chats as Obj[])[0]
            if ('value' in expected) {
                expect(out.futureDatabaseField).toEqual(expected.value)
                expect(slot.futureCharacterField).toEqual(expected.value)
                expect(chat.futureChatField).toEqual(expected.value)
                expect(((chat.message as Obj[])[0]).futureMessageField).toEqual(expected.value)
                expect(((out.modules as Obj[])[0]).futureModuleField).toEqual(expected.value)
                expect((out.pluginCustomStorage as Obj).liveKey).toEqual(expected.value)
            } else {
                expect('futureDatabaseField' in out).toBe(false)
                expect('futureCharacterField' in slot).toBe(false)
                expect('futureChatField' in chat).toBe(false)
            }
        }), { numRuns: 120 })
    })
})
