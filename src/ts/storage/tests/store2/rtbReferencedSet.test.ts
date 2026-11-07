// @vitest-environment node
/**
 * The files a `.rtb` export must carry, derived from the lists of the closure it exports (CHORE-128 S3). The store is the
 * producer's; a test replaces the lists of one owner under the same keys (and re-frames their parents) to make a list
 * stale, newer, overflowed or exact, and reads the filters the export returns.
 *
 * Labels: "guard" tests the new contract of `rtb/*`; before those modules exist its red run is the missing import
 * (diagnostic), and its scratch mutant is what falsifies it.
 */
import { beforeAll, describe, expect, test, vi } from 'vitest'
import {
    encodeUnit, hexStemToBase64url, keyOfTail, readUnit, refOfFrame, splitHashStems, UNIT_TYPE,
    type AssetList, type InlayList, type ListRef, type Manifest, type ModuleEntry, type ModuleIndex, type Shard, type ShardEntry, type UnitType,
} from 'src/ts/storage/store2/format'
import { exportClosure } from 'src/ts/storage/store2/rtb/exportClosure'
import type { ReferencedSet } from 'src/ts/storage/store2/rtb/referencedSet'
import { damagedFrame, rtbWorld, type RtbWorld } from './rtbFixtures'

const layout = vi.hoisted(() => ({ MODULE_INDEX_LAYOUT: 1 }))
vi.mock('src/ts/storage/store2/codec/moduleIndexParams', () => ({ MODULE_INDEX_PARAMS: layout }))

let world1: RtbWorld
let world2: RtbWorld

beforeAll(async () => {
    world1 = await rtbWorld({ layout: 1 })
    world2 = await rtbWorld({ layout: 2 })
})

const hexOf = (stem: string): string => Buffer.from(stem, 'base64url').toString('hex')
const assetName = (hex: string, extension = 'png'): string => `assets/${hex}.${extension}`
const stemOf = (hex: string): string => hexStemToBase64url(hex)

const UUID = '11111111-2222-4333-8444-555555555555'

function parsed<T>(world: RtbWorld, key: string, type: UnitType): T {
    const read = readUnit(world.store.get(key) as Uint8Array, type)
    if (read.status !== 'ok' && read.status !== 'stale') {
        throw new Error(`${key} does not parse`)
    }
    return JSON.parse(JSON.stringify(read.value.body)) as T
}

interface ListBodies {
    al?: AssetList
    il?: InlayList
}

interface Plan {
    config?: ListBodies
    /** Applies to the first character that has an asset list entry satisfying `characterWith`. */
    character?: ListBodies & { coreBody?: object }
    module?: ListBodies
}

interface Planted {
    replace: Map<string, Uint8Array | null>
    entry: ShardEntry
    module: ModuleEntry
}

/** `world` (layout 1) with the lists of `plan` written under the keys they replace and their parents re-framed. */
function plant(world: RtbWorld, plan: Plan, characterWith: (entry: ShardEntry) => boolean = () => true): Planted {
    const replace = new Map<string, Uint8Array | null>()
    const manifest = parsed<Manifest>(world, world.manifestKey, UNIT_TYPE.manifest)
    const putList = (type: UnitType, body: AssetList | InlayList, old: ListRef): ListRef => {
        const key = keyOfTail(old[0])
        const bytes = encodeUnit(type, body)
        replace.set(key, bytes)
        const ref = refOfFrame(key, bytes)
        return [ref[0], ref[1], ref[2], body.v] satisfies ListRef
    }
    const apply = (owner: { al: ListRef, il: ListRef | null }, bodies: ListBodies): void => {
        if (bodies.al !== undefined) {
            owner.al = putList(UNIT_TYPE.assetList, bodies.al, owner.al)
        }
        if (bodies.il !== undefined) {
            owner.il = putList(UNIT_TYPE.inlayList, bodies.il, owner.il as ListRef)
        }
    }
    if (plan.config?.al !== undefined) {
        manifest.fixed.configAl = putList(UNIT_TYPE.assetList, plan.config.al, manifest.fixed.configAl)
    }
    if (plan.config?.il !== undefined) {
        manifest.fixed.il = putList(UNIT_TYPE.inlayList, plan.config.il, manifest.fixed.il)
    }
    let entry: ShardEntry | undefined
    for (const [position, shardRef] of manifest.shards.entries()) {
        const key = keyOfTail(shardRef[0])
        const shard = parsed<Shard>(world, key, UNIT_TYPE.shard)
        const found = shard.entries.find(characterWith)
        if (found === undefined) {
            continue
        }
        entry = found
        if (plan.character !== undefined) {
            apply(found, plan.character)
            if (plan.character.coreBody !== undefined) {
                const coreKey = keyOfTail(found.core[0])
                const coreBytes = encodeUnit(UNIT_TYPE.characterCore, plan.character.coreBody)
                replace.set(coreKey, coreBytes)
                found.core = refOfFrame(coreKey, coreBytes)
            }
            const bytes = encodeUnit(UNIT_TYPE.shard, shard)
            replace.set(key, bytes)
            manifest.shards[position] = refOfFrame(key, bytes)
        }
        break
    }
    const indexKey = keyOfTail(manifest.fixed.moduleIndex[0])
    const index = parsed<ModuleIndex>(world, indexKey, UNIT_TYPE.moduleIndex)
    const module = index.entries.find((candidate) => {
        const list = parsed<AssetList>(world, keyOfTail(candidate.al[0]), UNIT_TYPE.assetList)
        return list.h !== '' || list.l.length > 0
    }) as ModuleEntry
    if (plan.module !== undefined) {
        apply(module, plan.module)
        const bytes = encodeUnit(UNIT_TYPE.moduleIndex, index)
        replace.set(indexKey, bytes)
        manifest.fixed.moduleIndex = refOfFrame(indexKey, bytes)
    }
    replace.set(world.manifestKey, encodeUnit(UNIT_TYPE.manifest, manifest))
    return { replace, entry: entry as ShardEntry, module }
}

async function referencedOf(world: RtbWorld, replace?: ReadonlyMap<string, Uint8Array | null>): Promise<ReferencedSet> {
    return (await exportClosure(await world.open(replace), { onUnits: async () => {} })).referenced
}

function assetFilter(set: ReferencedSet): (name: string) => boolean {
    if (set.assets.mode !== 'filter') {
        throw new Error('The assets are not a filter.')
    }
    return set.assets.holds
}

function inlayFilter(set: ReferencedSet): (id: string) => boolean {
    if (set.inlays.mode !== 'filter') {
        throw new Error('The inlays are not a filter.')
    }
    return set.inlays.includes
}

describe('the filters of lists that can be trusted (T3-9, guard)', () => {
    test('the derived lists of the producer give filters that hold their own names and nothing else', async () => {
        for (const world of [world1, world2]) {
            const set = await referencedOf(world)
            expect(set.notices).toEqual([])
            const holds = assetFilter(set)
            const includes = inlayFilter(set)
            const manifest = parsed<Manifest>(world, world.manifestKey, UNIT_TYPE.manifest)
            let named = 0
            for (const shardRef of manifest.shards) {
                for (const entry of parsed<Shard>(world, keyOfTail(shardRef[0]), UNIT_TYPE.shard).entries) {
                    const al = parsed<AssetList>(world, keyOfTail(entry.al[0]), UNIT_TYPE.assetList)
                    for (const stem of splitHashStems(al.h)) {
                        expect(holds(assetName(hexOf(stem))), 'a hash asset of a character').toBe(true)
                        expect(holds(assetName(hexOf(stem).toUpperCase(), 'PNG')), 'the same hash in another case').toBe(true)
                        named++
                    }
                    const il = parsed<InlayList>(world, keyOfTail((entry.il as ListRef)[0]), UNIT_TYPE.inlayList)
                    for (const id of il.u) {
                        expect(includes(id)).toBe(true)
                        expect(includes(id.toUpperCase())).toBe(true)
                    }
                }
            }
            expect(named).toBeGreaterThan(0)
            expect(holds(assetName('9'.repeat(64)))).toBe(false)
            expect(holds('nothing-here.png')).toBe(false)
            expect(includes('99999999-9999-4999-8999-999999999999')).toBe(false)
            expect(includes('an-id-nobody-lists')).toBe(false)
        }
    })

    test('exact lists of every owner feed the filters: hash and literal assets, any-case uuids, stems and other ids', async () => {
        const { replace } = plant(world1, {
            config: { al: { v: 1, h: stemOf('b1'.repeat(32)), l: ['cfg-literal.png'] }, il: { v: 1, u: [], h: '', o: ['cfg-other'] } },
            character: {
                al: { v: 1, h: stemOf('c1'.repeat(32)), l: ['char-literal.png'] },
                il: { v: 1, u: [UUID], h: stemOf('d2'.repeat(32)), o: ['char-other'] },
            },
            module: {
                al: { v: 1, h: stemOf('e3'.repeat(32)), l: ['mod-literal.png'] },
                il: { v: 1, u: [], h: stemOf('f4'.repeat(32)), o: ['mod-other'] },
            },
        })
        const set = await referencedOf(world1, replace)
        expect(set.notices).toEqual([])
        expect(set.stats.fallbackOwners).toBe(0)
        const holds = assetFilter(set)
        const includes = inlayFilter(set)
        for (const hex of ['b1', 'c1', 'e3']) {
            expect(holds(assetName(hex.repeat(32))), hex).toBe(true)
        }
        for (const literal of ['cfg-literal.png', 'CHAR-LITERAL.PNG', 'assets/mod-literal.png']) {
            expect(holds(literal), literal).toBe(true)
        }
        expect(holds(assetName('a0'.repeat(32)))).toBe(false)
        expect(includes(UUID)).toBe(true)
        expect(includes(UUID.toUpperCase())).toBe(true)
        expect(includes(assetName('d2'.repeat(32)))).toBe(true)
        expect(includes(assetName('f4'.repeat(32), 'webp'))).toBe(true)
        for (const other of ['cfg-other', 'char-other', 'mod-other']) {
            expect(includes(other), other).toBe(true)
        }
        expect(includes(assetName('a0'.repeat(32)))).toBe(false)
        expect(includes('99999999-9999-4999-8999-999999999999')).toBe(false)
    })
})

describe('lists that cannot be trusted fall back to their owner (T3-9, guard)', () => {
    const characterWithAssets = (world: RtbWorld) => (entry: ShardEntry): boolean =>
        parsed<AssetList>(world, keyOfTail(entry.al[0]), UNIT_TYPE.assetList).h !== ''

    test.each([
        ['a stale list', { v: 0, h: '', l: [] }],
        ['a newer list', { v: 2, h: '', l: [] }],
    ])('%s of a character: its assets are derived again from the assembled character and the owner is named', async (_label, body) => {
        const pick = characterWithAssets(world1)
        const { replace, entry } = plant(world1, { character: { al: body } }, pick)
        const stored = parsed<AssetList>(world1, keyOfTail(entry.al[0]), UNIT_TYPE.assetList)
        const set = await referencedOf(world1, replace)
        for (const stem of splitHashStems(stored.h)) {
            expect(assetFilter(set)(assetName(hexOf(stem))), 'the character\'s own asset').toBe(true)
        }
        expect(set.notices).toMatchObject([{ owner: `character ${entry.u}`, list: 'asset', level: 'owner' }])
        expect(set.stats.fallbackOwners).toBe(1)
    })

    test('an overflowed inlay list (x: true) of a character: its ids are derived again with no cap', async () => {
        const { replace, entry } = plant(world1, { character: { il: { v: 1, u: [], h: '', o: [], x: true } } })
        const stored = parsed<InlayList>(world1, keyOfTail((entry.il as ListRef)[0]), UNIT_TYPE.inlayList)
        expect(stored.u.length).toBeGreaterThan(0)
        const set = await referencedOf(world1, replace)
        for (const id of stored.u) {
            expect(inlayFilter(set)(id), id).toBe(true)
        }
        expect(set.notices).toMatchObject([{ owner: `character ${entry.u}`, list: 'inlay', level: 'owner' }])
    })

    test('a stale or newer list of a module falls back to the assembled module', async () => {
        const pickModule = plant(world1, {})
        const stored = parsed<AssetList>(world1, keyOfTail(pickModule.module.al[0]), UNIT_TYPE.assetList)
        const storedInlay = parsed<InlayList>(world1, keyOfTail((pickModule.module.il as ListRef)[0]), UNIT_TYPE.inlayList)
        for (const v of [0, 2]) {
            const { replace, module } = plant(world1, { module: { al: { v, h: '', l: [] }, il: { v, u: [], h: '', o: [] } } })
            const set = await referencedOf(world1, replace)
            expect(stored.h !== '' || stored.l.length > 0).toBe(true)
            for (const stem of splitHashStems(stored.h)) {
                expect(assetFilter(set)(assetName(hexOf(stem))), `v ${v}`).toBe(true)
            }
            for (const literal of stored.l) {
                expect(assetFilter(set)(literal), `v ${v} ${literal}`).toBe(true)
            }
            for (const id of storedInlay.u) {
                expect(inlayFilter(set)(id), `v ${v}`).toBe(true)
            }
            expect(set.notices.map(notice => `${notice.owner} ${notice.list} ${notice.level}`).sort())
                .toEqual([`module ${module.id} asset owner`, `module ${module.id} inlay owner`].sort())
        }
    })

    const configCases: [string, ListBodies, 'assets' | 'inlays'][] = [
        ['a stale asset list', { al: { v: 0, h: '', l: [] } }, 'assets'],
        ['a newer asset list', { al: { v: 2, h: '', l: [] } }, 'assets'],
        ['an overflowed inlay list', { il: { v: 1, u: [], h: '', o: [], x: true } }, 'inlays'],
    ]
    test.each(configCases)('%s of the config: every file of that kind is carried, with a notice (the config has no assembly of its own)', async (_label, bodies, kind) => {
        const { replace } = plant(world1, { config: bodies })
        const set = await referencedOf(world1, replace)
        expect(set[kind].mode).toBe('all')
        expect(set[kind === 'assets' ? 'inlays' : 'assets'].mode).toBe('filter')
        expect(set.notices).toMatchObject([{ owner: 'config', level: 'all', list: kind === 'assets' ? 'asset' : 'inlay' }])
    })

    test('an owner whose assembly fails is carried as "all" with a notice, not dropped', async () => {
        const { replace, entry } = plant(world1, { character: { il: { v: 1, u: [], h: '', o: [], x: true }, coreBody: { v: 1 } } })
        const set = await referencedOf(world1, replace)
        expect(set.inlays.mode).toBe('all')
        expect(set.notices).toMatchObject([{ owner: `character ${entry.u}`, list: 'inlay', level: 'all' }])
    })

    test('a character whose alternatives unit is left out is assembled without it, not carried as "all"', async () => {
        const withAlt = (entry: ShardEntry): boolean => entry.chats.some(chat => (chat.alt ?? []).length > 0)
        const { replace, entry } = plant(world1, { character: { il: { v: 1, u: [], h: '', o: [], x: true } } }, withAlt)
        const altKey = keyOfTail((entry.chats.find(chat => (chat.alt ?? []).length > 0)?.alt ?? [])[0][0])
        replace.set(altKey, damagedFrame(world1.store.get(altKey) as Uint8Array))
        const stored = parsed<InlayList>(world1, keyOfTail((entry.il as ListRef)[0]), UNIT_TYPE.inlayList)
        const closure = await exportClosure(await world1.open(replace), { onUnits: async () => {} })
        expect(closure.omitted).toHaveLength(1)
        expect(closure.referenced.inlays.mode).toBe('filter')
        for (const id of stored.u) {
            expect(inlayFilter(closure.referenced)(id), id).toBe(true)
        }
        expect(closure.referenced.notices).toMatchObject([{ owner: `character ${entry.u}`, list: 'inlay', level: 'owner' }])
    })
})
