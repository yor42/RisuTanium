import { describe, expect, test } from 'vitest'
import { buildManifest, MANIFEST_REQ, PLUGIN_STORAGE_BUCKETS, SHARD_COUNT, type EncodedTree } from '../../store2/codec'
import { parseManifest, readUnit, refsOf, UNIT_TYPE, type Manifest, type UnitType } from '../../store2/format'
import type { Database } from '../../database.svelte'
import {
    asDatabase, bodyOf, buildLegacyCases, buildSmall, buildT4, chat, dbWithCharacters, encodeWith, loreEntry, message, mulberry32,
    prosePool, sparseCharacter, unitOf, uuidLike, type Obj,
} from './codecFixtures'

const SIXTEEN_KIB = 16 * 1024

function manifestBytes(tree: EncodedTree): number {
    return unitOf(tree, 'manifest').bytes.length
}

/**
 * A database with the counts of the maintainer's real profile (the real-size
 * report: 485 characters, 814 chats, 180 modules, 4 presets, 15 plugins, 24
 * plugin-storage keys) and tiny content, since only counts decide the size of
 * a manifest.
 */
function realCounts(): Database {
    const rng = mulberry32(2026)
    const pool = prosePool(rng, 8, 20, 80)
    const characters: Obj[] = []
    let chats = 0
    for (let c = 0; c < 485; c++) {
        const count = c < 814 - 485 ? 2 : 1
        const list = Array.from({ length: count }, (_, k) => chat(rng, k, [message(rng, pool, 0, 30)]))
        chats += count
        characters.push(sparseCharacter(rng, pool, uuidLike(rng), `Real ${c}`, list, [loreEntry(rng, pool, 0, 20)]))
    }
    expect(chats).toBe(814)
    const base = buildSmall(1) as unknown as Obj
    const modules = Array.from({ length: 180 }, (_, i) => ({ name: `M${i}`, description: '', id: uuidLike(rng), lorebook: [], regex: [], trigger: [] }))
    const plugins = Array.from({ length: 15 }, (_, i) => ({ name: `p${i}`, script: 'x', arguments: {}, realArg: {}, customLink: [], argMeta: {} }))
    const storage: Obj = {}
    for (let i = 0; i < 24; i++) {
        storage[`plugin-key-${i}`] = { n: i }
    }
    return asDatabase({
        ...base,
        characters,
        characterOrder: characters.map(slot => slot.chaId),
        modules,
        plugins,
        pluginV2: [],
        pluginCustomStorage: storage,
        botPresets: Array.from({ length: 4 }, (_, i) => ({ name: `P${i}`, mainPrompt: 'x' })),
    })
}

describe('the manifest', () => {
    test('the encoded manifest stays under 16 KiB at the T4 counts', () => {
        const tree = encodeWith(buildT4().db)
        expect(manifestBytes(tree)).toBeLessThan(SIXTEEN_KIB)
    })

    test('the encoded manifest stays under 16 KiB at the real counts', () => {
        const tree = encodeWith(realCounts())
        expect(manifestBytes(tree)).toBeLessThan(SIXTEEN_KIB)
        expect(tree.manifest.fixed.presets).toHaveLength(4)
        expect(tree.manifest.fixed.plugins).toHaveLength(15)
    })

    test('its size does not depend on the number of characters, chats or modules', () => {
        const few = manifestBytes(encodeWith(buildSmall(2)))
        const many = manifestBytes(encodeWith(realCounts()))
        const thousand = manifestBytes(encodeWith(buildT4().db))
        const spread = Math.max(few, many, thousand) - Math.min(few, many, thousand)
        // Only the digits of the Ref sizes and CRCs and the preset and plugin counts differ.
        expect(spread).toBeLessThan(1024)
    })

    test('it has room for a hundred presets and a hundred plugins', () => {
        const db = clone(buildSmall(1))
        db.botPresets = Array.from({ length: 100 }, (_, i) => ({ name: `P${i}`, mainPrompt: `prompt ${i}` }))
        db.plugins = Array.from({ length: 100 }, (_, i) => ({ name: `p${i}`, script: `s${i}`, arguments: {}, realArg: {}, customLink: [], argMeta: {} }))
        expect(manifestBytes(encodeWith(asDatabase(db)))).toBeLessThan(SIXTEEN_KIB)
    })

    test('it carries the fixed shape: 16 shards, 16 buckets, no required feature, no legacy keep', () => {
        const tree = encodeWith(buildSmall(3), { seq: 7, createdAt: 123 })
        const parsed = parseManifest(bodyOf(unitOf(tree, 'manifest')) as never)
        expect(parsed.status).toBe('ok')
        const manifest = tree.manifest
        expect(manifest).toMatchObject({ fmt: 1, req: [], seq: 7, createdAt: 123, shardCount: 16 })
        expect(manifest.shards).toHaveLength(SHARD_COUNT)
        expect(manifest.fixed.pluginStorage.buckets).toBe(PLUGIN_STORAGE_BUCKETS)
        expect(manifest.fixed.pluginStorage.refs).toHaveLength(16)
        expect(manifest.fixed.legacyKeep).toBeNull()
        expect(MANIFEST_REQ).toEqual([])
    })

    test('buildManifest copies its parts and never shares the req list', () => {
        const ref: Manifest['fixed']['config'] = ['u-aaaaaaaaaaaaaaaaaaaaaaaaaa', 1, 2]
        const list: Manifest['fixed']['configAl'] = ['u-bbbbbbbbbbbbbbbbbbbbbbbbbb', 1, 2, 1]
        const one = buildManifest({ seq: 1, createdAt: 2, shards: [], config: ref, configAl: list, il: list, statics: ref, order: ref, loadouts: ref, moduleIndex: ref, presets: [], plugins: [], pluginStorageRefs: [] })
        one.req.push('x')
        expect(buildManifest({ seq: 1, createdAt: 2, shards: [], config: ref, configAl: list, il: list, statics: ref, order: ref, loadouts: ref, moduleIndex: ref, presets: [], plugins: [], pluginStorageRefs: [] }).req).toEqual([])
    })
})

/** Every unit is named by exactly the references `refsOf` finds, with the stored length and CRC; no unit is an orphan. */
function expectClosedTree(tree: EncodedTree): void {
    const byKey = new Map(tree.units.map(unit => [unit.key, unit]))
    const referenced = new Set<string>()
    const visit = (type: UnitType, body: object, from: string) => {
        for (const target of refsOf(type, body)) {
            const unit = byKey.get(`store2/${target.tail}`)
            expect(unit, `${from} names ${target.tail}`).toBeDefined()
            expect([target.bytes, target.crc], `${from} -> ${target.tail}`).toEqual([unit!.ref[1], unit!.ref[2]])
            referenced.add(unit!.key)
        }
    }
    for (const unit of tree.units) {
        const parsed = readUnit(unit.bytes)
        expect(parsed.status === 'ok' || parsed.status === 'stale').toBe(true)
        if (parsed.status === 'ok' || parsed.status === 'stale') {
            visit(parsed.value.type, parsed.value.body, unit.identity)
        }
    }
    const unreferenced = tree.units.filter(unit => unit.type !== UNIT_TYPE.manifest && !referenced.has(unit.key))
    expect(unreferenced.map(unit => unit.identity)).toEqual([])
    expect(tree.units.filter(unit => unit.type === UNIT_TYPE.manifest)).toHaveLength(1)
}

describe('the unit graph', () => {
    test('every unit of a small profile is named by a Ref position and every Ref matches its unit', () => {
        expectClosedTree(encodeWith(buildSmall(5)))
    })

    test('the same holds for every legacy and edge shape, and for T4', () => {
        expectClosedTree(encodeWith(dbWithCharacters(buildLegacyCases().map(one => one.character))))
        expectClosedTree(encodeWith(buildT4().db))
    })
})

function clone(db: Database): Obj {
    return JSON.parse(JSON.stringify(db)) as Obj
}
