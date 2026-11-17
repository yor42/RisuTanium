// @vitest-environment node
/**
 * `classifyRtbUnitAlone` (CHORE-128 S11): the restore's unit pass judges a unit before it knows its parent. It must agree
 * with `classifyRtbUnit` over a Ref that carries the unit's own item count, and it must never apply the count rule itself.
 *
 * Labels: compatibility guards of a new pure function (no pre-fix base). The count-rule mutant (applying
 * `bodyCountMismatch` against the self Ref) turns the chunk and alternatives rows red.
 */
import { beforeAll, describe, expect, test, vi } from 'vitest'
import { encodeFrame, keyOfTail, refOfFrame, tailOfKey, UNIT_TYPE, type Ref, type Shard, type UnitType } from 'src/ts/storage/store2/format'
import { readUnit } from 'src/ts/storage/store2/format'
import { classifyRtbUnit, classifyRtbUnitAlone } from 'src/ts/storage/store2/rtb/unitCheck'
import { newerTypeFrame, rtbWorld, type RtbWorld } from './rtbFixtures'

const layout = vi.hoisted(() => ({ MODULE_INDEX_LAYOUT: 1 }))
vi.mock('src/ts/storage/store2/codec/moduleIndexParams', () => ({ MODULE_INDEX_PARAMS: layout }))

let worlds: RtbWorld[]

beforeAll(async () => {
    worlds = [
        await rtbWorld({ layout: 1 }),
        await rtbWorld({ layout: 2 }),
        await rtbWorld({ layout: 1, nonCanonical: true }),
    ]
})

/** The count each parent shard states for a chunk or an alternatives unit, by tail. */
function statedCounts(world: RtbWorld): Map<string, number> {
    const counts = new Map<string, number>()
    for (const key of world.keysOfType(UNIT_TYPE.shard)) {
        const parsed = readUnit(world.store.get(key) as Uint8Array, UNIT_TYPE.shard)
        if (parsed.status !== 'ok' && parsed.status !== 'stale') {
            throw new Error('the world holds a shard that does not parse')
        }
        for (const entry of (parsed.value.body as Shard).entries) {
            for (const chat of entry.chats) {
                for (const ref of [...chat.chunks, ...chat.alt ?? []]) {
                    counts.set(ref[0], ref[3])
                }
            }
        }
    }
    return counts
}

describe('classifyRtbUnitAlone', () => {
    test('agrees with classifyRtbUnit over a Ref that carries the unit\'s own count, for every unit of the real producer\'s worlds (guard)', () => {
        let counted = 0
        for (const world of worlds) {
            const stated = statedCounts(world)
            for (const [key, frame] of world.store) {
                const type = frame[5]
                const tail = tailOfKey(key)
                const alone = classifyRtbUnitAlone(tail, type, frame)
                const self = refOfFrame(key, frame)
                const ref: Ref = alone.items === null ? self : [self[0], self[1], self[2], alone.items]
                const expected = classifyRtbUnit(ref, type as UnitType, frame)
                expect(alone.cls.status, `${tail} type ${type}`).toBe(expected.status)
                if (type === UNIT_TYPE.chatChunk || type === UNIT_TYPE.chatAlt) {
                    counted++
                    expect(alone.items, tail).toBe(stated.get(tail))
                } else {
                    expect(alone.items, tail).toBeNull()
                }
            }
        }
        // The worlds hold chunks and an alternatives unit, so the equality above was exercised.
        expect(counted).toBeGreaterThan(2)
    })

    test('never reports a chat chunk or an alternatives unit damaged for lacking a count (guard; the count-rule mutant fails it)', () => {
        for (const world of worlds) {
            for (const type of [UNIT_TYPE.chatChunk, UNIT_TYPE.chatAlt]) {
                const keys = world.keysOfType(type)
                expect(keys.length).toBeGreaterThan(0)
                for (const key of keys) {
                    const alone = classifyRtbUnitAlone(tailOfKey(key), type, world.store.get(key) as Uint8Array)
                    expect(alone.cls.status).toBe('ok')
                }
            }
        }
    })

    test('a derived list below this build\'s version is an unreadable list, with no item count (guard)', () => {
        const stale = worlds[2]
        const key = (stale.planted as { listKey: string }).listKey
        const alone = classifyRtbUnitAlone(tailOfKey(key), UNIT_TYPE.assetList, stale.store.get(key) as Uint8Array)
        expect(alone.cls.status).toBe('unreadable-list')
        expect(alone.items).toBeNull()
    })

    test('a frame type this build does not know is newer, and a frame cut short is damaged (guard)', () => {
        const world = worlds[0]
        const key = world.keysOfType(UNIT_TYPE.preset)[0]
        const frame = world.store.get(key) as Uint8Array
        expect(classifyRtbUnitAlone(tailOfKey(key), 99, frame).cls.status).toBe('newer')
        expect(classifyRtbUnitAlone(tailOfKey(key), UNIT_TYPE.preset, frame.subarray(0, 10)).cls.status).toBe('damaged')
        expect(classifyRtbUnitAlone('t', UNIT_TYPE.preset, encodeFrame(UNIT_TYPE.preset, new TextEncoder().encode('not json'))).cls.status).toBe('damaged')
        expect(keyOfTail(tailOfKey(key))).toBe(key)
    })

    test('a damaged header is damaged whatever its type byte says, and only a sound header with an unknown type is newer (guard; the type-first order fails it)', () => {
        const world = worlds[0]
        const key = world.keysOfType(UNIT_TYPE.preset)[0]
        const frame = world.store.get(key) as Uint8Array
        const tail = tailOfKey(key)
        const unknownTypeBroken = new Uint8Array(frame)
        unknownTypeBroken[5] = 99
        expect(classifyRtbUnitAlone(tail, 99, unknownTypeBroken).cls.status).toBe('damaged')
        const badMagic = new Uint8Array(frame)
        badMagic[0] ^= 0xff
        badMagic[5] = 99
        expect(classifyRtbUnitAlone(tail, 99, badMagic).cls.status).toBe('damaged')
        expect(classifyRtbUnitAlone(tail, 99, newerTypeFrame(frame)).cls.status).toBe('newer')
    })
})
