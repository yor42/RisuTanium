import { crc32 } from 'node:zlib'
import { describe, expect, test } from 'vitest'
import {
    assembleDatabase, bucketOfKey, groupKeysIntoBuckets, isUnchanged, PLUGIN_STORAGE_BUCKETS, unitMapSource, unitsToWrite,
} from '../../store2/codec'
import { UNIT_TYPE, type PluginBucket } from '../../store2/format'
import { asDatabase, bodyOf, buildSmall, encodeWith, previousFrom, roundTrip, seededEnv, unitOf, type Obj } from './codecFixtures'

function withStorage(storage: Obj) {
    return asDatabase({ ...(buildSmall(1) as unknown as Obj), pluginCustomStorage: storage })
}

describe('plugin storage buckets', () => {
    test('a key goes to the bucket crc32(utf8(key)) mod 16, and the manifest has 16 buckets', () => {
        for (const key of ['', 'plugin-1', 'ünï\u{1F600}', '__proto__', 'constructor']) {
            expect(bucketOfKey(key)).toBe(crc32(Buffer.from(key, 'utf8')) % 16)
        }
        const tree = encodeWith(withStorage({ a: 1 }))
        expect(tree.manifest.fixed.pluginStorage.buckets).toBe(16)
        expect(tree.manifest.fixed.pluginStorage.refs).toHaveLength(16)
        expect(PLUGIN_STORAGE_BUCKETS).toBe(16)
    })

    test('groupKeysIntoBuckets sorts each bucket and keeps empty ones', () => {
        const groups = groupKeysIntoBuckets(['b', 'a', 'c', 'zz', 'y'])
        expect(groups).toHaveLength(16)
        expect(groups.flat().sort()).toEqual(['a', 'b', 'c', 'y', 'zz'])
        for (const group of groups) {
            expect(group).toEqual([...group].sort())
        }
    })

    test('each key is a type 14 unit listed, sorted, in its bucket', () => {
        const storage: Obj = {}
        for (let i = 0; i < 60; i++) {
            storage[`key-${i}`] = { n: i }
        }
        const tree = encodeWith(withStorage(storage))
        const buckets = tree.units.filter(unit => unit.type === UNIT_TYPE.pluginStorageBucket)
        expect(buckets).toHaveLength(16)
        let listed = 0
        for (const unit of buckets) {
            const index = Number(unit.identity.split(':')[1])
            const body = bodyOf(unit) as unknown as PluginBucket
            const keys = body.entries.map(entry => entry.k)
            expect(keys).toEqual([...keys].sort())
            for (const entry of body.entries) {
                expect(bucketOfKey(entry.k)).toBe(index)
                expect(unitOf(tree, `psv:${entry.k}`).ref).toEqual(entry.ref)
                expect(unitOf(tree, `psv:${entry.k}`).type).toBe(UNIT_TYPE.pluginStorageValue)
            }
            listed += keys.length
        }
        expect(listed).toBe(60)
    })

    test('empty or absent storage gives 16 empty buckets and comes back as {}', () => {
        for (const storage of [{}, undefined, null]) {
            const db = asDatabase({ ...(buildSmall(1) as unknown as Obj), pluginCustomStorage: storage })
            const tree = encodeWith(db)
            expect(tree.units.filter(unit => unit.type === UNIT_TYPE.pluginStorageValue)).toHaveLength(0)
            expect(roundTrip(db).assembled.pluginCustomStorage).toEqual({})
        }
    })

    test('odd keys and values round trip', () => {
        const storage = JSON.parse('{"__proto__":{"x":1},"":"empty key","ünï":[1,null,{"a":true}],"constructor":"c","n":0}') as Obj
        const { assembled } = roundTrip(withStorage(storage))
        expect(JSON.stringify(Object.entries(assembled.pluginCustomStorage).sort())).toBe(JSON.stringify(Object.entries(storage).sort()))
        expect(Object.keys(assembled.pluginCustomStorage).sort()).toEqual(Object.keys(storage).sort())
    })

    test('writing one key changes its value unit, its bucket and the manifest, nothing else', () => {
        const storage: Obj = {}
        for (let i = 0; i < 30; i++) {
            storage[`k${i}`] = i
        }
        const first = encodeWith(withStorage(storage), { env: seededEnv(1) })
        const next = encodeWith(withStorage({ ...storage, k7: 'changed' }), { env: seededEnv(2), previous: previousFrom(first) })
        expect(unitsToWrite(next).map(unit => unit.identity).sort()).toEqual(['manifest', `bucket:${bucketOfKey('k7')}`, 'psv:k7'].sort())
        expect(isUnchanged(encodeWith(withStorage(storage), { env: seededEnv(3), previous: previousFrom(first) }))).toBe(true)
    })

    test('assemble refuses a key listed in the wrong bucket', () => {
        const tree = encodeWith(withStorage({ only: 1 }))
        const real = bucketOfKey('only')
        const wrong = (real + 1) % 16
        const refs = [...tree.manifest.fixed.pluginStorage.refs]
        ;[refs[real], refs[wrong]] = [refs[wrong], refs[real]]
        const manifest = { ...tree.manifest, fixed: { ...tree.manifest.fixed, pluginStorage: { buckets: 16, refs } } }
        expect(() => assembleDatabase(manifest, unitMapSource(tree.units))).toThrow(/bucket/)
    })
})
