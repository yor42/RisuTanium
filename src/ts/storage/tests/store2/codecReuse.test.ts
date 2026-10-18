import { createHash } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import { crc32 } from '../../blockFrame'
import {
    assembleDatabase, encodeDatabase, isUnchanged, shardOfU, unitMapSource, UnitNotReusedError, UnitSink, unitsToWrite,
    type EncodedTree, type ListDerivation, type PreviousEncoding, type ReusableUnit,
} from '../../store2/codec'
import { UNIT_TYPE, type ShardEntry } from '../../store2/format'
import type { Database } from '../../database.svelte'
import {
    asDatabase, bodyOf, buildSmall, buildT4, encodeWith, fakeLists, previousFrom, seededEnv, unitOf, type Obj,
} from './codecFixtures'

function clone(db: Database): Obj {
    return JSON.parse(JSON.stringify(db)) as Obj
}

/** Indices (into `positions`) whose bit-0 flips together leave the payload CRC32 unchanged: a GF(2) dependency among the single-flip CRC deltas. */
function crcPreservingFlips(payload: Uint8Array, positions: number[]): number[] {
    const base = crc32(payload)
    const basis: { v: number, mask: bigint }[] = []
    for (let i = 0; i < positions.length; i++) {
        const copy = new Uint8Array(payload)
        copy[positions[i]] ^= 0x01
        let v = (crc32(copy) ^ base) >>> 0
        let mask = 1n << BigInt(i)
        for (const b of basis) {
            if (((v ^ b.v) >>> 0) < v) {
                v = (v ^ b.v) >>> 0
                mask ^= b.mask
            }
        }
        if (v === 0) {
            return positions.map((_, index) => index).filter(index => ((mask >> BigInt(index)) & 1n) === 1n)
        }
        basis.push({ v, mask })
        basis.sort((a, b) => b.v - a.v)
    }
    throw new Error('no CRC-preserving combination among the positions')
}

function entryOf(tree: EncodedTree, chaId: string): ShardEntry {
    for (const unit of tree.units) {
        if (unit.type === UNIT_TYPE.shard) {
            const found = (bodyOf(unit).entries as unknown as ShardEntry[]).find(entry => entry.chaId === chaId)
            if (found !== undefined) {
                return found
            }
        }
    }
    throw new Error(`No entry for ${chaId}`)
}

/** What encoding `db` after `first` must write: the identities of the new units, sorted. */
function written(first: EncodedTree, db: Database, seed = 2): string[] {
    const next = encodeWith(db, { env: seededEnv(seed), previous: previousFrom(first) })
    return unitsToWrite(next).map(unit => unit.identity).sort()
}

describe('a change that leaves a unit unchanged writes no bytes for it', () => {
    const base = buildSmall(4)
    const first = encodeWith(base, { env: seededEnv(1) })
    const c0 = base.characters[0].chaId
    const u0 = entryOf(first, c0).u
    const shard0 = `shard:${shardOfU(u0)}`
    const chatId = base.characters[0].chats[0].id
    const lastChunk = `chat:${u0}:${chatId}:chunk:0`

    test('the same database writes only the manifest: a character switch changes nothing stored', () => {
        const next = encodeWith(base, { env: seededEnv(2), previous: previousFrom(first) })
        expect(unitsToWrite(next).map(unit => unit.identity)).toEqual(['manifest'])
        expect(isUnchanged(next)).toBe(true)
        for (const unit of next.units.filter(one => one.type !== UNIT_TYPE.manifest)) {
            expect(unit.key).toBe(unitOf(first, unit.identity).key)
        }
    })

    test('an unload and reload cycle writes no unit bytes', () => {
        const assembled = assembleDatabase(first.manifest, unitMapSource(first.units))
        const next = encodeWith(assembled, { env: seededEnv(3), previous: previousFrom(first) })
        expect(isUnchanged(next)).toBe(true)
        expect(unitsToWrite(next).map(unit => unit.identity)).toEqual(['manifest'])
    })

    test('a new interaction time or chat page rewrites the shard and the manifest, never the core', () => {
        for (const patch of [{ lastInteraction: 1_800_000_000_000 }, { chatPage: 1 }, { trashTime: 5 }]) {
            const db = clone(base)
            Object.assign((db.characters as Obj[])[0], patch)
            expect(written(first, asDatabase(db))).toEqual([shard0, 'manifest'].sort())
        }
    })

    test('appending a message writes the tail chunk, the shard and the manifest', () => {
        const db = clone(base)
        const chat = ((db.characters as Obj[])[0].chats as Obj[])[0]
        ;(chat.message as Obj[]).push({ role: 'user', data: 'one more', time: 5 })
        expect(written(first, asDatabase(db))).toEqual([lastChunk, shard0, 'manifest'].sort())
    })

    test('a per-send field changes only the tail chunk, the shard and the manifest', () => {
        const db = clone(base)
        const chat = ((db.characters as Obj[])[0].chats as Obj[])[0]
        chat.lastMemory = 'new summary'
        chat.scriptstate = { turn: 9 }
        chat.suggestMessages = ['hi']
        chat.lastDate = 1
        expect(written(first, asDatabase(db))).toEqual([lastChunk, shard0, 'manifest'].sort())
    })

    test('editing the character writes its core, the shard and the manifest', () => {
        const db = clone(base)
        ;(db.characters as Obj[])[0].desc = 'a new description'
        expect(written(first, asDatabase(db))).toEqual([`char:${u0}:core`, shard0, 'manifest'].sort())
    })

    test('a new chat writes its core, its chunk, the shard and the manifest', () => {
        const db = clone(base)
        ;((db.characters as Obj[])[0].chats as Obj[]).push({ message: [], name: 'fresh', id: 'fresh-chat', note: '', localLore: [] })
        expect(written(first, asDatabase(db))).toEqual([`chat:${u0}:fresh-chat:core`, `chat:${u0}:fresh-chat:chunk:0`, shard0, 'manifest'].sort())
    })

    test('removing a character writes the order, its shard and the manifest, and keeps every other character unit', () => {
        const db = clone(base)
        ;(db.characters as Obj[]).splice(0, 1)
        const names = written(first, asDatabase(db))
        expect(names).toEqual([shard0, 'manifest', 'order'].sort())
    })

    test('changing a preset writes that preset, nothing of the characters', () => {
        const db = clone(base)
        ;(db.botPresets as Obj[])[1].temperature = 1
        expect(written(first, asDatabase(db))).toEqual(['manifest', 'preset:1'].sort())
    })

    test('changing a config field writes the config root and the manifest', () => {
        const db = clone(base)
        db.username = 'someone else'
        expect(written(first, asDatabase(db))).toEqual(['config', 'manifest'])
    })

    test('appending to one chat of a 1000-character profile writes three units', () => {
        const profile = buildT4().db
        const big = encodeWith(profile, { env: seededEnv(1) })
        const db = clone(profile)
        const target = (db.characters as Obj[])[500]
        const chat = (target.chats as Obj[])[0]
        ;(chat.message as Obj[]).push({ role: 'char', data: 'appended', time: 9 })
        const out = written(big, asDatabase(db))
        const u = entryOf(big, String(target.chaId)).u
        expect(out).toHaveLength(3)
        expect(out).toContain('manifest')
        expect(out).toContain(`shard:${shardOfU(u)}`)
        expect(out.find(name => name.startsWith(`chat:${u}:`))).toBeDefined()
    })
})

describe('keys', () => {
    test('a unit that changed gets a fresh key and the new keys are unique and not any previous key', () => {
        const base = buildSmall(3)
        const first = encodeWith(base, { env: seededEnv(1) })
        const db = clone(base)
        ;(db.characters as Obj[])[0].desc = 'changed'
        db.username = 'changed too'
        const next = encodeWith(asDatabase(db), { env: seededEnv(2), previous: previousFrom(first) })
        const fresh = next.units.filter(unit => !unit.reused)
        expect(fresh.length).toBeGreaterThan(2)
        const previousKeys = new Set(first.units.map(unit => unit.key))
        for (const unit of fresh) {
            expect(previousKeys.has(unit.key)).toBe(false)
        }
        expect(new Set(next.units.map(unit => unit.key)).size).toBe(next.units.length)
    })

    test('a first encode gives every unit a fresh key and none is reused', () => {
        const first = encodeWith(buildSmall(2))
        expect(first.units.every(unit => !unit.reused)).toBe(true)
        expect(new Set(first.units.map(unit => unit.key)).size).toBe(first.units.length)
    })

    test('the same input and the same random sequence give the same keys and bytes', () => {
        const a = encodeWith(buildSmall(3), { env: seededEnv(5) })
        const b = encodeWith(buildSmall(3), { env: seededEnv(5) })
        expect(a.units.map(unit => unit.key)).toEqual(b.units.map(unit => unit.key))
        expect(a.manifestKey).toBe(b.manifestKey)
    })

    test('a key generator that only repeats keys is refused, not looped on', () => {
        const stuck = { random: () => new Uint8Array(16), now: () => 1_700_000_000_000 }
        expect(() => encodeWith(buildSmall(1), { env: stuck })).toThrow()
    })
})

describe('what counts as the same unit', () => {
    test('with the previous bytes kept, equal bytes are reused', () => {
        const base = buildSmall(2)
        const first = encodeWith(base, { env: seededEnv(1) })
        const next = encodeWith(base, { env: seededEnv(2), previous: previousFrom(first, true) })
        expect(isUnchanged(next)).toBe(true)
    })

    test('with the previous bytes kept, a unit with the same Ref but other bytes is not reused', () => {
        const base = buildSmall(2)
        const first = encodeWith(base, { env: seededEnv(1) })
        const victim = unitOf(first, 'statics')
        const tampered = new Uint8Array(victim.bytes)
        tampered[tampered.length - 6] ^= 0x01
        const previous: PreviousEncoding = previousFrom(first)
        const units = new Map(previous.units)
        units.set('statics', { key: victim.key, type: victim.type, ref: victim.ref, digest: victim.digest, bytes: tampered })
        const next = encodeWith(base, { env: seededEnv(2), previous: { units, entities: previous.entities } })
        expect(unitsToWrite(next).map(unit => unit.identity).sort()).toEqual(['manifest', 'statics'])
    })

    test('a previous unit without a digest is not reused, however well its Ref matches', () => {
        const base = buildSmall(2)
        const first = encodeWith(base, { env: seededEnv(1) })
        const victim = unitOf(first, 'statics')
        const previous = previousFrom(first)
        const units = new Map(previous.units)
        units.set('statics', { key: victim.key, type: victim.type, ref: victim.ref })
        const next = encodeWith(base, { env: seededEnv(2), previous: { units, entities: previous.entities } })
        expect(unitsToWrite(next).map(unit => unit.identity).sort()).toEqual(['manifest', 'statics'])
        expect(unitOf(next, 'statics').key).not.toBe(victim.key)
    })

    test('a unit digest is 128 bits of the SHA-256 of the framed bytes', () => {
        const first = encodeWith(buildSmall(1), { env: seededEnv(1) })
        for (const unit of first.units) {
            expect(unit.digest).toBe(createHash('sha256').update(unit.bytes).digest('hex').slice(0, 32))
        }
    })

    test('the tree index is itself a usable previous: an unchanged database writes only the manifest', () => {
        const base = buildSmall(3)
        const first = encodeWith(base, { env: seededEnv(1) })
        for (const unit of first.index.units.values()) {
            expect(unit.digest).toBeTypeOf('string')
        }
        const next = encodeWith(base, { env: seededEnv(2), previous: first.index })
        expect(unitsToWrite(next).map(unit => unit.identity)).toEqual(['manifest'])
        expect(next.units.filter(unit => unit.reused).length).toBe(next.units.length - 1)
    })

    test('a same-length, same-CRC change is not reused on the default previous path, so the edit is written', () => {
        const db = clone(buildSmall(2))
        db.username = 'b'.repeat(64)
        const first = encodeWith(asDatabase(db), { env: seededEnv(1) })
        const config = unitOf(first, 'config')
        const payload = config.bytes.subarray(16, config.bytes.length - 4)
        const start = new TextDecoder().decode(payload).indexOf('"username":"') + '"username":"'.length
        const flips = crcPreservingFlips(payload, Array.from({ length: 64 }, (_, i) => start + i))
        const chars = String(db.username).split('')
        for (const i of flips) {
            chars[i] = 'c'
        }
        const forged = clone(asDatabase(db))
        forged.username = chars.join('')
        expect(forged.username).not.toBe(db.username)
        const next = encodeWith(asDatabase(forged), { env: seededEnv(2), previous: previousFrom(first) })
        const changed = unitOf(next, 'config')
        expect(Buffer.compare(Buffer.from(changed.bytes), Buffer.from(config.bytes))).not.toBe(0)
        expect(changed.ref[1]).toBe(config.ref[1])
        expect(changed.ref[2]).toBe(config.ref[2])
        expect(changed.reused).toBe(false)
        expect(changed.key).not.toBe(config.key)
        expect(unitsToWrite(next).map(unit => unit.identity)).toContain('config')
    })

    test('a previous unit of another type at the same identity is not reused', () => {
        const base = buildSmall(1)
        const first = encodeWith(base, { env: seededEnv(1) })
        const loadouts = unitOf(first, 'loadouts')
        const previous = previousFrom(first)
        const units = new Map(previous.units)
        units.set('statics', { key: loadouts.key, type: UNIT_TYPE.loadouts, ref: unitOf(first, 'statics').ref, digest: unitOf(first, 'statics').digest })
        const next = encodeWith(base, { env: seededEnv(2), previous: { units, entities: previous.entities } })
        expect(unitsToWrite(next).map(unit => unit.identity)).toContain('statics')
    })
})

describe('the list derivation is injected and required', () => {
    test('encoding without it is refused at run time and at compile time', () => {
        // @ts-expect-error `lists` is required: there is no default derivation.
        expect(() => encodeDatabase(buildSmall(1), { env: seededEnv(1), seq: 1, createdAt: 1 })).toThrow(/list derivation/)
    })

    test('it is called once per owner and its lists are what the units hold', () => {
        const calls = { config: 0, character: 0, module: 0 }
        const lists: ListDerivation = {
            configAssets: (owner) => { calls.config++; return fakeLists.configAssets(owner) },
            configInlays: owner => fakeLists.configInlays(owner),
            characterAssets: (owner) => { calls.character++; return fakeLists.characterAssets(owner) },
            characterInlays: owner => fakeLists.characterInlays(owner),
            moduleAssets: (owner) => { calls.module++; return fakeLists.moduleAssets(owner) },
            moduleInlays: owner => fakeLists.moduleInlays(owner),
        }
        const db = buildSmall(5)
        const tree = encodeDatabase(db, { env: seededEnv(1), lists, seq: 1, createdAt: 1 })
        expect(calls).toEqual({ config: 1, character: 5, module: db.modules.length })
        const named = tree.units.filter(unit => unit.identity.startsWith('al:char:')).flatMap(unit => bodyOf(unit).l as string[])
        expect(named.length).toBeGreaterThan(0)
        expect(named.every(name => name === name.toLowerCase())).toBe(true)
        const config = unitOf(tree, 'al:config')
        expect(bodyOf(config).l).toEqual([`config-${db.botPresets.length}-${db.plugins.length + db.pluginV2.length}`])
        expect(tree.manifest.fixed.configAl.slice(0, 3)).toEqual(config.ref)
    })

    test('the derivation sees the owner as stored: reloadKeys and streaming state are already gone', () => {
        let seen: Obj | null = null
        const lists: ListDerivation = {
            ...fakeLists,
            characterAssets: (owner) => { seen = owner as Obj; return fakeLists.characterAssets(owner) },
        }
        const db = clone(buildSmall(1))
        const slot = (db.characters as Obj[])[0]
        slot.reloadKeys = 2
        const chat = (slot.chats as Obj[])[0]
        chat.isStreaming = true
        encodeDatabase(asDatabase(db), { env: seededEnv(1), lists, seq: 1, createdAt: 1 })
        const owner = seen as unknown as Obj
        expect('reloadKeys' in owner).toBe(false)
        const ownerChat = (owner.chats as Obj[])[0]
        expect('isStreaming' in ownerChat).toBe(false)
    })

    test('a list unit is reused when its owner is unchanged and rewritten when the derived list changes', () => {
        const base = buildSmall(2)
        const first = encodeWith(base, { env: seededEnv(1) })
        const db = clone(base)
        ;(db.characters as Obj[])[0].additionalAssets = [['new', 'assets/new.png', 'png']]
        const u0 = entryOf(first, base.characters[0].chaId).u
        const out = written(first, asDatabase(db))
        expect(out).toContain(`al:char:${u0}`)
        expect(out).toContain(`char:${u0}:core`)
        expect(out.filter(name => name.startsWith('al:') && name !== `al:char:${u0}`)).toEqual([])
    })
})

describe('new behaviour: a reuse-only sink checks reuse and mints nothing', () => {
    /** A units map that counts how often it is iterated, by any of the ways a copy of its keys would. */
    class IterationCountingMap<K, V> extends Map<K, V> {
        iterations = 0
        override [Symbol.iterator](): MapIterator<[K, V]> {
            this.iterations++
            return super[Symbol.iterator]()
        }
        override values(): MapIterator<V> {
            this.iterations++
            return super.values()
        }
        override keys(): MapIterator<K> {
            this.iterations++
            return super.keys()
        }
        override entries(): MapIterator<[K, V]> {
            this.iterations++
            return super.entries()
        }
        override forEach(callback: (value: V, key: K, map: Map<K, V>) => void, thisArg?: unknown): void {
            this.iterations++
            super.forEach(callback, thisArg)
        }
    }

    const first = encodeWith(buildSmall(3))
    const loadouts = unitOf(first, 'loadouts')
    const loadoutsBody = bodyOf(loadouts)

    function countedPrevious(): { previous: PreviousEncoding, units: IterationCountingMap<string, ReusableUnit> } {
        const units = new IterationCountingMap<string, ReusableUnit>(previousFrom(first).units)
        units.iterations = 0
        return { previous: { ...previousFrom(first), units }, units }
    }

    test('a unit that is the previous encoding\'s is reused under its key', () => {
        const sink = new UnitSink(seededEnv(1), previousFrom(first), undefined, { reuseOnly: true })
        const unit = sink.put('loadouts', UNIT_TYPE.loadouts, loadoutsBody)
        expect(unit.reused).toBe(true)
        expect(unit.key).toBe(loadouts.key)
    })

    test('the first unit that differs ends the encode, whether it is put or put fresh', () => {
        const sink = new UnitSink(seededEnv(1), previousFrom(first), undefined, { reuseOnly: true })
        expect(() => sink.put('loadouts', UNIT_TYPE.loadouts, { ...loadoutsBody, items: ['changed'] })).toThrow(UnitNotReusedError)
        expect(() => sink.put('a unit the previous does not hold', UNIT_TYPE.loadouts, loadoutsBody)).toThrow(UnitNotReusedError)
        expect(() => sink.putFresh('manifest', UNIT_TYPE.loadouts, loadoutsBody, 'manifest')).toThrow(UnitNotReusedError)
        expect(sink.units).toEqual([])
    })

    test('a previous unit without a digest is not reused', () => {
        const previous = previousFrom(first)
        const units = new Map(previous.units)
        const held = units.get('loadouts') as ReusableUnit
        units.set('loadouts', { key: held.key, type: held.type, ref: held.ref })
        const sink = new UnitSink(seededEnv(1), { ...previous, units }, undefined, { reuseOnly: true })
        expect(() => sink.put('loadouts', UNIT_TYPE.loadouts, loadoutsBody)).toThrow(UnitNotReusedError)
    })

    test('its constructor and its reuse checks never iterate the previous units; the ordinary sink does', () => {
        const reuseOnly = countedPrevious()
        const sink = new UnitSink(seededEnv(1), reuseOnly.previous, undefined, { reuseOnly: true })
        sink.put('loadouts', UNIT_TYPE.loadouts, loadoutsBody)
        expect(() => sink.put('loadouts', UNIT_TYPE.loadouts, { ...loadoutsBody, items: ['changed'] })).toThrow(UnitNotReusedError)
        expect(reuseOnly.units.iterations).toBe(0)

        const ordinary = countedPrevious()
        new UnitSink(seededEnv(1), ordinary.previous)
        expect(ordinary.units.iterations).toBeGreaterThan(0)
    })

    test('the ordinary sink still mints a fresh key for a changed unit (the option changes nothing for it)', () => {
        // A seed other than the one the previous encoding was made with, whose keys it would draw again.
        const sink = new UnitSink(seededEnv(2), previousFrom(first))
        const unit = sink.put('loadouts', UNIT_TYPE.loadouts, { ...loadoutsBody, items: ['changed'] })
        expect(unit.reused).toBe(false)
        expect(unit.key).not.toBe(loadouts.key)
    })
})
