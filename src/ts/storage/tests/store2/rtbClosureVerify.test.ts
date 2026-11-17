// @vitest-environment node
/**
 * The reference integrity walk of a `.rtb` restore (CHORE-128 S11): `verifyClosure` over the tail map and edges the
 * restore's unit pass builds, and `edgesOfBody` over parsed parents of the real producer's worlds.
 *
 * Labels: compatibility guards of a new pure module (no pre-fix base). Direct rows state each edge by hand, so they also
 * kill the mutants an integrated file cannot reach (a count rule that reverts to "where both exist": a file's shard
 * parser refuses a missing or string count before the walk runs).
 */
import { beforeAll, describe, expect, test, vi } from 'vitest'
import { readUnit, tailOfKey, UNIT_TYPE, type Manifest, type Ref, type UnitType } from 'src/ts/storage/store2/format'
import { edgesOfBody, verifyClosure, type ClosureEdge, type ClosureInput, type ClosureTail } from 'src/ts/storage/store2/rtb/closureVerify'
import { classifyRtbUnitAlone } from 'src/ts/storage/store2/rtb/unitCheck'
import { O3_ROWS, WALK_PARENT_TYPES } from 'src/ts/storage/store2/rtb/rows'
import { reachedTails, rtbWorld, type RtbWorld } from './rtbFixtures'

const layout = vi.hoisted(() => ({ MODULE_INDEX_LAYOUT: 1 }))
vi.mock('src/ts/storage/store2/codec/moduleIndexParams', () => ({ MODULE_INDEX_PARAMS: layout }))

const SHARD_ROW = '2:shards[]'
const CHUNK_ROW = '3:entries[].chats[].chunks[]'
const ALT_ROW = '3:entries[].chats[].alt[]'
const CORE_ROW = '3:entries[].core'

const root: Ref = ['m', 100, 1]

function tail(type: UnitType, length: number, crc: number, items: number | null = null): ClosureTail {
    return { type, length, crc, items }
}

function edge(row: string, tailName: string, childType: UnitType, bytes: number, crc: number, count: ClosureEdge['count'] = undefined): ClosureEdge {
    return { tail: tailName, bytes, crc, count, row, childType }
}

/** root -> shard s -> chunk c (3 items), alternatives a (2 items), core k. */
function base(): ClosureInput {
    return {
        root,
        tails: new Map([
            ['m', tail(UNIT_TYPE.manifest, 100, 1)],
            ['s', tail(UNIT_TYPE.shard, 50, 2)],
            ['c', tail(UNIT_TYPE.chatChunk, 30, 3, 3)],
            ['a', tail(UNIT_TYPE.chatAlt, 20, 4, 2)],
            ['k', tail(UNIT_TYPE.characterCore, 10, 5)],
        ]),
        edges: new Map([
            ['m', [edge(SHARD_ROW, 's', UNIT_TYPE.shard, 50, 2)]],
            ['s', [
                edge(CORE_ROW, 'k', UNIT_TYPE.characterCore, 10, 5),
                edge(CHUNK_ROW, 'c', UNIT_TYPE.chatChunk, 30, 3, 3),
                edge(ALT_ROW, 'a', UNIT_TYPE.chatAlt, 20, 4, 2),
            ]],
        ]),
        omitted: new Set(),
    }
}

function without<K, V>(map: ReadonlyMap<K, V>, key: K): Map<K, V> {
    const copy = new Map(map)
    copy.delete(key)
    return copy
}

function edited(input: ClosureInput, parent: string, change: (edges: ClosureEdge[]) => ClosureEdge[]): ClosureInput {
    return { ...input, edges: new Map(input.edges).set(parent, change([...input.edges.get(parent) ?? []])) }
}

describe('verifyClosure over stated edges', () => {
    test('a closed tree is accepted and every reached unit is counted (guard)', () => {
        const verdict = verifyClosure(base())
        expect(verdict).toEqual({ ok: true, reachable: 5, omitted: [] })
    })

    test('the root must be the manifest unit that meta.root names (guard)', () => {
        const input = base()
        expect(verifyClosure({ ...input, tails: without(input.tails, 'm') }).ok).toBe(false)
        expect(verifyClosure({ ...input, root: ['m', 101, 1] }).ok).toBe(false)
        expect(verifyClosure({ ...input, root: ['m', 100, 2] }).ok).toBe(false)
        expect(verifyClosure({ ...input, tails: new Map(input.tails).set('m', tail(UNIT_TYPE.shard, 100, 1)) }).ok).toBe(false)
    })

    test('an edge whose tail is missing, mistyped, or of another length or checksum is damaged (guard; the CRC-compare mutant fails it)', () => {
        const input = base()
        expect(verifyClosure({ ...input, tails: without(input.tails, 'k') }).ok).toBe(false)
        expect(verifyClosure(edited(input, 's', (e) => e.map((x) => x.tail === 'k' ? { ...x, bytes: 11 } : x))).ok).toBe(false)
        expect(verifyClosure(edited(input, 's', (e) => e.map((x) => x.tail === 'k' ? { ...x, crc: 6 } : x))).ok).toBe(false)
        expect(verifyClosure(edited(input, 's', (e) => e.map((x) => x.tail === 'k' ? { ...x, childType: UNIT_TYPE.lore } : x))).ok).toBe(false)
    })

    test('edges that name one tail with different length or checksum are damaged (guard)', () => {
        const input = edited(base(), 's', (e) => [...e, edge('3:entries[].lore', 'k', UNIT_TYPE.characterCore, 10, 9)])
        expect(verifyClosure(input).ok).toBe(false)
    })

    test('a counted child whose Ref states no count, a string, or another number is damaged (MS14: "where both exist" lets the first two through)', () => {
        const input = base()
        for (const count of [undefined, '2', null, 9, 2.5]) {
            const chunk = verifyClosure(edited(input, 's', (e) => e.map((x) => x.tail === 'c' ? { ...x, count } : x)))
            expect(chunk.ok, `chunk count ${String(count)}`).toBe(false)
        }
        for (const count of [undefined, '3', 9]) {
            const alt = verifyClosure(edited(input, 's', (e) => e.map((x) => x.tail === 'a' ? { ...x, count } : x)))
            expect(alt.ok, `alt count ${String(count)}`).toBe(false)
        }
    })

    test('the count rule applies only to edges whose tail is present: an omitted alternatives unit is accepted and named (guard)', () => {
        const input = base()
        const omitted = verifyClosure({
            ...input,
            tails: without(input.tails, 'a'),
            omitted: new Set(['a']),
            edges: edited(input, 's', (e) => e.map((x) => x.tail === 'a' ? { ...x, count: 99 } : x)).edges,
        })
        expect(omitted).toEqual({ ok: true, reachable: 4, omitted: [{ tail: 'a', row: ALT_ROW }] })
    })

    test('an omitted tail is excused only at O3 rows, only when absent, and never when it is not omitted (guard; MS8 fails it)', () => {
        const input = base()
        // a chat chunk is not an O3 row, so omitting it is damage
        expect(verifyClosure({ ...input, tails: without(input.tails, 'c'), omitted: new Set(['c']) }).ok).toBe(false)
        // an omitted tail that the file holds is damaged
        expect(verifyClosure({ ...input, omitted: new Set(['a']) }).ok).toBe(false)
        // an omitted tail named at an O3 row and at another row is damaged
        const both = edited({ ...input, tails: without(input.tails, 'a'), omitted: new Set(['a']) }, 's', (e) => [...e, edge('3:entries[].lore', 'a', UNIT_TYPE.chatAlt, 20, 4, 2)])
        expect(verifyClosure(both).ok).toBe(false)
        // a task preset of the manifest is an O3 row too
        const preset = edited({ ...input, omitted: new Set(['p']) }, 'm', (e) => [...e, edge('2:fixed.taskPresets[]', 'p', UNIT_TYPE.taskPreset, 8, 9)])
        expect(verifyClosure(preset)).toEqual({ ok: true, reachable: 5, omitted: [{ tail: 'p', row: '2:fixed.taskPresets[]' }] })
        expect(O3_ROWS).toContain('2:fixed.taskPresets[]')
    })

    test('units no edge reaches are not part of the closure (guard)', () => {
        const input = base()
        const extra = new Map(input.tails).set('z', tail(UNIT_TYPE.preset, 1, 1))
        expect(verifyClosure({ ...input, tails: extra })).toMatchObject({ ok: true, reachable: 5 })
    })
})

describe('edgesOfBody over the real producer\'s worlds', () => {
    let plain: RtbWorld

    beforeAll(async () => {
        plain = await rtbWorld({ layout: 1 })
    })

    function tailsOf(world: RtbWorld): { tails: Map<string, ClosureTail>, edges: Map<string, readonly ClosureEdge[]>, root: Ref } {
        const tails = new Map<string, ClosureTail>()
        const edges = new Map<string, readonly ClosureEdge[]>()
        const rootRef = readUnit(world.store.get(world.manifestKey) as Uint8Array, UNIT_TYPE.manifest)
        expect(rootRef.status).toBe('ok')
        for (const [key, frame] of world.store) {
            const unit = tailOfKey(key)
            const alone = classifyRtbUnitAlone(unit, frame[5], frame)
            if (alone.cls.status !== 'ok' && alone.cls.status !== 'unreadable-list') {
                throw new Error(`${unit} is ${alone.cls.status}`)
            }
            const type = frame[5] as UnitType
            tails.set(unit, { type, length: frame.length, crc: new DataView(frame.buffer, frame.byteOffset, frame.byteLength).getUint32(frame.length - 4, true), items: alone.items })
            if (alone.cls.status === 'ok' && (unit === tailOfKey(world.manifestKey) || WALK_PARENT_TYPES.has(type))) {
                edges.set(unit, edgesOfBody(type, alone.cls.body))
            }
        }
        const manifestFrame = world.store.get(world.manifestKey) as Uint8Array
        const info = tails.get(tailOfKey(world.manifestKey)) as ClosureTail
        return { tails, edges, root: [tailOfKey(world.manifestKey), info.length, new DataView(manifestFrame.buffer, manifestFrame.byteOffset, manifestFrame.byteLength).getUint32(manifestFrame.length - 4, true)] }
    }

    test('the world\'s closure passes and reaches every unit the independent walk reaches (guard)', () => {
        const { tails, edges, root: rootRef } = tailsOf(plain)
        const verdict = verifyClosure({ root: rootRef, tails, edges, omitted: new Set() })
        expect(verdict.ok).toBe(true)
        expect(verdict.ok && verdict.reachable).toBe(reachedTails(plain).size)
    })

    test('a shard\'s counted edges carry the numbers its Refs state, equal to the children\'s item counts (guard)', () => {
        const { tails, edges } = tailsOf(plain)
        const counted = [...edges.values()].flat().filter((x) => x.childType === UNIT_TYPE.chatChunk || x.childType === UNIT_TYPE.chatAlt)
        expect(counted.length).toBeGreaterThan(1)
        for (const item of counted) {
            expect(typeof item.count).toBe('number')
            expect(item.count).toBe((tails.get(item.tail) as ClosureTail).items)
        }
        const manifest = readUnit(plain.store.get(plain.manifestKey) as Uint8Array, UNIT_TYPE.manifest)
        expect(manifest.status === 'ok' && (manifest.value.body as Manifest).shards.length).toBeGreaterThan(0)
    })

    test('the edges of a manifest are the 28-row walk without the counted rows (guard)', () => {
        const { edges } = tailsOf(plain)
        const rootEdges = edges.get(tailOfKey(plain.manifestKey)) as ClosureEdge[]
        expect(rootEdges.length).toBeGreaterThan(3)
        expect(rootEdges.every((x) => x.count === undefined)).toBe(true)
    })
})
