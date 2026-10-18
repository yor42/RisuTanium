// @vitest-environment node
import { describe, expect, test } from 'vitest'
import {
    assembleDatabase, CodecAssembleError, encodeScoped, IDENTITY, previousFrom, unitDigest, unitMapSource,
    type EncodedTree, type PreviousEncoding, type ReusableUnit, type UnitSource,
} from '../../store2/codec'
import { buildColdStub } from '../../../process/coldCharacter'
import { hydrateEntityDigests, previousOfTree, registerEntityUnits, type StoredTree } from '../../store2/previousOfTree'
import { createSaveEncoder, type SavePassRequest } from '../../store2/saveEncoder'
import { keyOfRef, type ShardEntry } from '../../store2/format'
import type { character, Database } from '../../database.svelte'
import {
    asDatabase, buildSmall, buildT3, encodeWith, fakeLists, seededEnv, type Obj,
} from './codecFixtures'

const NOW = 1_700_000_000_000

function clone(db: Database): Obj {
    return JSON.parse(JSON.stringify(db)) as Obj
}

function storedOf(tree: EncodedTree, source: UnitSource = unitMapSource(tree.units)): StoredTree {
    return { manifestKey: tree.manifestKey, manifest: tree.manifest, source }
}

/** A source that answers what `tree` stored, except the keys `lacking` names. */
function sourceWithout(tree: EncodedTree, lacking: (identity: string) => boolean): UnitSource {
    return unitMapSource(tree.units.filter(unit => !lacking(unit.identity)))
}

function encoderOver(previous: PreviousEncoding) {
    return createSaveEncoder({ previous, lists: fakeLists, env: seededEnv(77), now: () => NOW })
}

const NOTHING_MARKED: SavePassRequest = { marked: new Set(), modules: false, whole: false }

function expectSamePrevious(actual: PreviousEncoding, expected: PreviousEncoding): void {
    expect([...actual.units.keys()].sort()).toEqual([...expected.units.keys()].sort())
    for (const [identity, unit] of expected.units) {
        expect(actual.units.get(identity), identity).toEqual(unit)
    }
    expect(Object.fromEntries(actual.entities)).toEqual(Object.fromEntries(expected.entities))
    expect(actual.objects).toEqual(expected.objects)
}

describe('guard: the previous of a stored tree is the previous of its own encode', () => {
    test('a small profile: every identity, key, Ref, digest, entity id and format object', () => {
        const first = encodeWith(buildSmall(6))
        expectSamePrevious(previousOfTree(storedOf(first)), previousFrom(first))
    })

    test('the T3 profile (500 characters, 164 modules)', () => {
        const first = encodeWith(buildT3().db)
        expectSamePrevious(previousOfTree(storedOf(first)), previousFrom(first))
    }, 120_000)

    test('a repeated chaId and a repeated module id keep their occurrence handles', () => {
        const base = clone(buildSmall(4))
        const chars = base.characters as Obj[]
        chars[2] = { ...chars[2], chaId: chars[0].chaId as string, name: 'Second holder' }
        const modules = base.modules as Obj[]
        modules[3] = { ...modules[3], id: modules[1].id as string }
        const first = encodeWith(asDatabase(base))
        const previous = previousOfTree(storedOf(first))
        expect(previous.entities.has(`${chars[0].chaId as string}#1`)).toBe(true)
        expectSamePrevious(previous, previousFrom(first))
    })

    test('a tree reached through a scoped pass: the carried units keep their digests', async () => {
        const db = buildSmall(5)
        const first = encodeWith(db)
        const next = clone(db)
        ;(next.characters as Obj[])[1].personality = 'edited'
        const second = await encodeScoped(
            asDatabase(next),
            { env: seededEnv(2), lists: fakeLists, seq: 2, createdAt: NOW, previous: previousFrom(first) },
            { modules: false, characters: new Set([(db.characters[1] as { chaId: string }).chaId]) },
        )
        const store = new Map([...first.units, ...second.units].map(unit => [unit.key, unit.bytes] as const))
        const previous = previousOfTree(storedOf(second, { get: key => store.get(key) }))
        expectSamePrevious(previous, previousFrom(second))
        expect([...previous.units.values()].every(unit => unit.digest !== undefined)).toBe(true)
    })
})

describe('guard: a first pass after a boot reuses every unit it read', () => {
    test('a decoded small tree, a no-change pass and a whole-resident pass both write only the manifest', async () => {
        const first = encodeWith(buildSmall(6))
        const stored = storedOf(first)
        const decoded = assembleDatabase(first.manifest, stored.source)
        const encoder = encoderOver(previousOfTree(stored))
        const same = await encoder.plan(decoded, NOTHING_MARKED)
        expect(same.unchanged).toBe(true)
        expect(same.newUnits).toBe(1)
        const whole = await encoder.plan(decoded, { ...NOTHING_MARKED, whole: true })
        expect(whole.unchanged).toBe(true)
        expect(whole.newUnits).toBe(1)
    })

    test('a decoded T3 tree: the same, over 500 characters', async () => {
        const first = encodeWith(buildT3().db)
        const stored = storedOf(first)
        const decoded = assembleDatabase(first.manifest, stored.source)
        const encoder = encoderOver(previousOfTree(stored))
        const whole = await encoder.plan(decoded, { ...NOTHING_MARKED, whole: true })
        expect(whole.unchanged).toBe(true)
        expect(whole.newUnits).toBe(1)
    }, 120_000)

    test('a marked character rewrites only its own changed units after the boot', async () => {
        const first = encodeWith(buildSmall(6))
        const stored = storedOf(first)
        const decoded = assembleDatabase(first.manifest, stored.source) as unknown as { characters: { chaId: string, personality: string }[] }
        decoded.characters[2].personality = 'edited after boot'
        const plan = await encoderOver(previousOfTree(stored)).plan(decoded as unknown as Database, { ...NOTHING_MARKED, marked: new Set([decoded.characters[2].chaId]) })
        // The core, its shard and the manifest.
        expect(plan.newUnits).toBe(3)
    })

    test('a unit whose digest is gone is rewritten: the digests are what the reuse compares', async () => {
        const first = encodeWith(buildSmall(4))
        const stored = storedOf(first)
        const decoded = assembleDatabase(first.manifest, stored.source)
        const previous = previousOfTree(stored)
        const stripped: PreviousEncoding = {
            ...previous,
            units: new Map([...previous.units].map(([identity, unit]) => [identity, { key: unit.key, type: unit.type, ref: unit.ref }] as const)),
        }
        const plan = await encoderOver(stripped).plan(decoded, { ...NOTHING_MARKED, whole: true })
        expect(plan.unchanged).toBe(false)
        expect(plan.newUnits).toBe(first.units.length)
    })
})

describe('new behaviour: digests, kept bytes and units the boot did not read', () => {
    test('every unit read carries the digest of its bytes, and the Ref of the stored frame', () => {
        const first = encodeWith(buildSmall(4))
        const previous = previousOfTree(storedOf(first))
        for (const unit of first.units) {
            const held = previous.units.get(unit.identity)
            expect(held?.digest, unit.identity).toBe(unitDigest(unit.bytes))
            expect(held?.key, unit.identity).toBe(unit.key)
            expect(held?.ref, unit.identity).toEqual(unit.ref)
            expect(held?.bytes, unit.identity).toBeUndefined()
        }
    })

    test('keepBytes keeps the bytes of every unit read, and the first pass is still unchanged', async () => {
        const first = encodeWith(buildSmall(4))
        const stored = storedOf(first)
        const previous = previousOfTree(stored, { keepBytes: true })
        for (const unit of first.units) {
            expect(previous.units.get(unit.identity)?.bytes, unit.identity).toEqual(unit.bytes)
        }
        const plan = await encoderOver(previous).plan(assembleDatabase(first.manifest, stored.source), NOTHING_MARKED)
        expect(plan.unchanged).toBe(true)
    })

    test('the units of a character the boot did not read are kept by key without a digest, and the pass over its stub is unchanged', async () => {
        const db = buildSmall(4)
        const first = encodeWith(db)
        const chaId = (db.characters[1] as { chaId: string }).chaId
        const u = first.index.entities.get(`${chaId}#0`) as string
        const unread = (identity: string): boolean => identity.includes(u) && identity !== `${IDENTITY.alChar}${u}` && !identity.startsWith('shard')
        const previous = previousOfTree(storedOf(first, sourceWithout(first, unread)))
        const held = [...previous.units].filter(([identity]) => unread(identity))
        expect(held.length).toBeGreaterThan(0)
        for (const [identity, unit] of held) {
            expect(unit.digest, identity).toBeUndefined()
            expect(unit.key, identity).toBe(first.units.find(one => one.identity === identity)?.key)
        }
        const source = clone(db)
        const slot = JSON.parse(JSON.stringify((source.characters as Obj[])[1])) as Obj
        ;(source.characters as Obj[])[1] = buildColdStub(slot as unknown as character, u, ['chat-a']) as unknown as Obj
        const plan = await encoderOver(previous).plan(asDatabase(source), NOTHING_MARKED)
        expect(plan.unchanged).toBe(true)
    })

    test('a leaf whose bytes do not match its Ref is treated as unread, not trusted', () => {
        const first = encodeWith(buildSmall(3))
        const target = first.units.find(unit => unit.identity === 'statics')
        expect(target).toBeDefined()
        // The last bytes of a frame are the payload checksum its referrer's Ref holds.
        const bytes = new Uint8Array(target?.bytes ?? [])
        bytes[bytes.length - 1] ^= 0xff
        const store = new Map(first.units.map(unit => [unit.key, unit.bytes] as const))
        store.set(target?.key ?? '', bytes)
        const previous = previousOfTree(storedOf(first, { get: key => store.get(key) }))
        expect(previous.units.get('statics')?.digest).toBeUndefined()
        expect(previous.units.get('statics')?.key).toBe(target?.key)
        expect(previous.units.get('loadouts')?.digest).toBeDefined()
    })

    test('a leaf whose length differs from its Ref is kept without a digest, and the next pass rewrites it', async () => {
        const first = encodeWith(buildSmall(3))
        const target = first.units.find(unit => unit.identity === 'statics')
        expect(target).toBeDefined()
        // Only the Ref's length is wrong; the stored bytes and their checksum are intact.
        const manifest = structuredClone(first.manifest)
        manifest.fixed.statics = [manifest.fixed.statics[0], manifest.fixed.statics[1] + 1, manifest.fixed.statics[2]]
        const stored: StoredTree = { manifestKey: first.manifestKey, manifest, source: unitMapSource(first.units) }
        const previous = previousOfTree(stored)
        expect(previous.units.get('statics')?.digest).toBeUndefined()
        expect(previous.units.get('statics')?.key).toBe(target?.key)
        expect(previous.units.get('loadouts')?.digest).toBeDefined()
        const decoded = assembleDatabase(first.manifest, unitMapSource(first.units))
        const plan = await encoderOver(previous).plan(decoded, NOTHING_MARKED)
        expect(plan.unchanged).toBe(false)
    })

    test('without every plugin body no plugin identity is named, and the pass rewrites exactly the plugins', async () => {
        const db = buildSmall(3)
        const first = encodeWith(db)
        const plugins = first.units.filter(unit => unit.identity.startsWith('plugin:'))
        expect(plugins.length).toBeGreaterThan(1)
        const lacking = plugins[0].identity
        const stored = storedOf(first, sourceWithout(first, identity => identity === lacking))
        const previous = previousOfTree(stored)
        expect([...previous.units.keys()].some(identity => identity.startsWith('plugin:'))).toBe(false)
        const decoded = assembleDatabase(first.manifest, unitMapSource(first.units))
        const plan = await encoderOver(previous).plan(decoded, NOTHING_MARKED)
        expect(plan.newUnits).toBe(plugins.length + 1)
    })
})

describe('new behaviour: the units a carry and the entity ids read are required', () => {
    const first = encodeWith(buildSmall(4))
    const refuse = (lacking: (identity: string) => boolean): void => {
        expect(() => previousOfTree(storedOf(first, sourceWithout(first, lacking)))).toThrow(CodecAssembleError)
    }

    test('a missing shard', () => refuse(identity => identity === 'shard:3'))
    test('a missing module index', () => refuse(identity => identity === IDENTITY.moduleIndex))
    test('a missing order unit', () => refuse(identity => identity === 'order'))
    test('a missing plugin-storage bucket', () => refuse(identity => identity.startsWith('bucket:')))
    test('a missing manifest', () => refuse(identity => identity === 'manifest'))

    test('a shard whose bytes are damaged', () => {
        const shard = first.units.find(unit => unit.identity === 'shard:3')
        const bytes = new Uint8Array(shard?.bytes ?? [])
        bytes[bytes.length - 6] ^= 0xff
        const store = new Map(first.units.map(unit => [unit.key, unit.bytes] as const))
        store.set(shard?.key ?? '', bytes)
        expect(() => previousOfTree(storedOf(first, { get: key => store.get(key) }))).toThrow(CodecAssembleError)
    })
})

describe('new behaviour: hydrating the digests of a loaded entity', () => {
    const db = buildSmall(4)
    const first = encodeWith(db)
    const shards = first.index.objects?.shards ?? []
    const entryOfIndex = (index: number): ShardEntry => {
        const u = first.index.entities.get(`${(db.characters[index] as { chaId: string }).chaId}#0`) as string
        return shards.flatMap(shard => shard.entries).find(entry => entry.u === u) as ShardEntry
    }
    const entry = entryOfIndex(1)
    const other = entryOfIndex(2)
    const ownedBy = (u: string) => (identity: string): boolean => identity.includes(u) && !identity.startsWith('shard')
    const unread = (identity: string): boolean => ownedBy(entry.u)(identity) || ownedBy(other.u)(identity)
    const everything = unitMapSource(first.units)

    function previousBeforeLoad(): PreviousEncoding {
        return previousOfTree(storedOf(first, sourceWithout(first, unread)))
    }

    function ownIdentities(): string[] {
        return first.units.filter(unit => ownedBy(entry.u)(unit.identity)).map(unit => unit.identity).sort()
    }

    test('registerEntityUnits names exactly the identities the encoder gives the entity\'s units', () => {
        const named: string[] = []
        registerEntityUnits(entry, identity => named.push(identity))
        expect(named.sort()).toEqual(ownIdentities())
    })

    test('every unit of the entity gets the digest of its bytes, in place, and nothing else changes', () => {
        const previous = previousBeforeLoad()
        const objects = new Map(ownIdentities().map(identity => [identity, previous.units.get(identity)] as const))
        const outside = new Map([...previous.units].filter(([identity]) => !ownIdentities().includes(identity)).map(([identity, unit]) => [identity, { ...unit }] as const))
        expect(ownIdentities().every(identity => previous.units.get(identity)?.digest === undefined)).toBe(true)
        hydrateEntityDigests(previous, entry, everything)
        for (const unit of first.units.filter(candidate => ownedBy(entry.u)(candidate.identity))) {
            const held = previous.units.get(unit.identity)
            expect(held, unit.identity).toBe(objects.get(unit.identity))
            expect(held?.digest, unit.identity).toBe(unitDigest(unit.bytes))
            expect(held?.key, unit.identity).toBe(unit.key)
        }
        for (const [identity, before] of outside) {
            expect(previous.units.get(identity), identity).toEqual(before)
        }
    })

    test('a second hydration changes nothing, and a unit that already has a digest keeps it', () => {
        const previous = previousBeforeLoad()
        hydrateEntityDigests(previous, entry, everything)
        const snapshot = new Map([...previous.units].map(([identity, unit]) => [identity, { ...unit }] as const))
        hydrateEntityDigests(previous, entry, everything)
        expect(new Map([...previous.units].map(([identity, unit]) => [identity, { ...unit }] as const))).toEqual(snapshot)
        const core = previous.units.get(`${IDENTITY.char}${entry.u}:core`) as ReusableUnit
        core.digest = 'kept'
        hydrateEntityDigests(previous, entry, everything)
        expect(core.digest).toBe('kept')
    })

    test('an entity that was not hydrated keeps its units digest-less', () => {
        const previous = previousBeforeLoad()
        hydrateEntityDigests(previous, entry, everything)
        expect(first.units.filter(unit => ownedBy(other.u)(unit.identity)).every(unit => previous.units.get(unit.identity)?.digest === undefined)).toBe(true)
    })

    test('a unit is hydrated only when the key and the Ref match and the bytes are that unit', () => {
        const core = `${IDENTITY.char}${entry.u}:core`
        const lore = `${IDENTITY.char}${entry.u}:lore`
        const scripts = `${IDENTITY.char}${entry.u}:scripts`
        const previous = previousBeforeLoad()
        // The entry's Ref for the core disagrees with the unit the encoding holds: the checksum differs.
        const moved: ShardEntry = { ...entry, core: [entry.core[0], entry.core[1], entry.core[2] ^ 1] }
        // The bytes of the lore are damaged in the source.
        const lorebytes = new Uint8Array(first.units.find(unit => unit.identity === lore)?.bytes ?? [])
        lorebytes[lorebytes.length - 1] ^= 0xff
        const loreKey = first.units.find(unit => unit.identity === lore)?.key
        // The previous encoding holds another key for the scripts than the entry names.
        ;(previous.units.get(scripts) as ReusableUnit).key = 'a-key-the-entry-does-not-name'
        hydrateEntityDigests(previous, moved, { get: key => (key === loreKey ? lorebytes : everything.get(key)) })
        expect(previous.units.get(core)?.digest).toBeUndefined()
        expect(previous.units.get(lore)?.digest).toBeUndefined()
        expect(previous.units.get(scripts)?.digest).toBeUndefined()
        expect(previous.units.get(scripts)?.key).toBe('a-key-the-entry-does-not-name')
        expect(previous.units.get(`${IDENTITY.alChar}${entry.u}`)?.digest).toBeDefined()
    })

    test('a unit under the same key whose Ref length or checksum differs from the entry\'s is not hydrated, though the bytes match the entry', () => {
        const core = `${IDENTITY.char}${entry.u}:core`
        const scripts = `${IDENTITY.char}${entry.u}:scripts`
        const previous = previousBeforeLoad()
        const heldCore = previous.units.get(core) as ReusableUnit
        const heldScripts = previous.units.get(scripts) as ReusableUnit
        // The encoding's own Refs disagree with the entry's (and with the stored bytes), the keys agree.
        heldCore.ref = [heldCore.ref[0], heldCore.ref[1] + 1, heldCore.ref[2]]
        heldScripts.ref = [heldScripts.ref[0], heldScripts.ref[1], heldScripts.ref[2] ^ 1]
        hydrateEntityDigests(previous, entry, everything)
        expect(heldCore.key).toBe(keyOfRef(entry.core))
        expect(heldCore.digest).toBeUndefined()
        expect(heldScripts.digest).toBeUndefined()
        expect(previous.units.get(`${IDENTITY.alChar}${entry.u}`)?.digest).toBeDefined()
    })

    test('a unit the source does not hold stays as it was', () => {
        const previous = previousBeforeLoad()
        hydrateEntityDigests(previous, entry, sourceWithout(first, identity => identity === `${IDENTITY.char}${entry.u}:core`))
        expect(previous.units.get(`${IDENTITY.char}${entry.u}:core`)?.digest).toBeUndefined()
        expect(previous.units.get(`${IDENTITY.char}${entry.u}:lore`)?.digest).toBeDefined()
    })

    test('a pass over the loaded character writes nothing once hydrated, and rewrites it whole before', async () => {
        const decoded = assembleDatabase(first.manifest, everything)
        const chaId = (decoded.characters[1] as unknown as { chaId: string }).chaId
        const marked: SavePassRequest = { ...NOTHING_MARKED, marked: new Set([chaId]) }

        const cold = previousBeforeLoad()
        const before = await encoderOver(cold).plan(decoded, marked)
        expect(before.unchanged).toBe(false)
        expect(before.newUnits).toBeGreaterThan(ownIdentities().length)

        const hydrated = previousBeforeLoad()
        hydrateEntityDigests(hydrated, entry, everything)
        const after = await encoderOver(hydrated).plan(decoded, marked)
        expect(after.newUnits).toBe(1)
        expect(after.unchanged).toBe(true)
    })
})
