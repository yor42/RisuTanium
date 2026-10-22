// @vitest-environment node
import { describe, expect, test } from 'vitest'
import {
    assembleDatabase, characterMatchesAcknowledged, encodeScoped, isUnchanged, previousFrom, unitMapSource,
    type AcknowledgedVerdict, type EncodedTree, type PreviousEncoding, type ReusableUnit,
} from '../../store2/codec'
import { hydrateEntityDigests, previousOfTree } from '../../store2/previousOfTree'
import type { character, Database } from '../../database.svelte'
import type { ShardEntry } from '../../store2/format'
import {
    asDatabase, buildLegacyCases, buildSmall, dbWithCharacters, encodeWith, fakeLists, seededEnv, type Obj,
} from './codecFixtures'

/**
 * The fire-time verdict (`characterMatchesAcknowledged`): whether a pass would write anything for a resident character,
 * judged against the latest acknowledged encoding. Every case is new behaviour; the evidence that each assertion bites
 * is the mutant list of the hand-back.
 */

const NOW = 1_700_000_000_000

function verdictOf(slot: Obj, previous: PreviousEncoding): AcknowledgedVerdict {
    return characterMatchesAcknowledged(slot as unknown as character, { env: seededEnv(5), lists: fakeLists, previous })
}

function assembledOf(first: EncodedTree): Obj[] {
    return assembleDatabase(first.manifest, unitMapSource(first.units)).characters as unknown as Obj[]
}

function entriesOf(previous: PreviousEncoding): ShardEntry[] {
    return (previous.objects?.shards ?? []).flatMap(shard => shard.entries)
}

/** What the full encoder says about the same character: a pass over it writes nothing but the manifest. */
async function fullSinkVerdict(db: Database, first: EncodedTree, chaId: string): Promise<AcknowledgedVerdict> {
    const tree = await encodeScoped(
        db,
        { env: seededEnv(9), lists: fakeLists, seq: 2, createdAt: NOW, previous: previousFrom(first) },
        { modules: false, characters: new Set([chaId]) },
    )
    return isUnchanged(tree) ? 'clean' : 'dirty'
}

function withCharacters(db: Database, characters: Obj[]): Database {
    return asDatabase({ ...(JSON.parse(JSON.stringify(db)) as Obj), characters })
}

describe('new behaviour: the verdict follows what a pass would write', () => {
    const db = buildSmall(4)
    const first = encodeWith(db)
    const previous = previousFrom(first)

    interface Case {
        label: string
        mutate: (slot: Obj) => void
        expected: AcknowledgedVerdict
    }

    const cases: Case[] = [
        { label: 'the character as acknowledged', mutate: () => undefined, expected: 'clean' },
        { label: 'a core field', mutate: (slot) => { slot.personality = 'edited' }, expected: 'dirty' },
        { label: 'the name, which the core holds', mutate: (slot) => { slot.name = 'Renamed' }, expected: 'dirty' },
        { label: 'a chat message', mutate: (slot) => { (((slot.chats as Obj[])[0].message as Obj[])[0]).data = 'edited message' }, expected: 'dirty' },
        { label: 'a chat core field', mutate: (slot) => { (slot.chats as Obj[])[1].note = 'a note' }, expected: 'dirty' },
        { label: 'a lore entry', mutate: (slot) => { ((slot.globalLore as Obj[])[0]).content = 'edited lore' }, expected: 'dirty' },
        { label: 'a script', mutate: (slot) => { (slot.customscript as unknown[]).push({ comment: 'new', in: 'a', out: 'b', type: 'editinput' }) }, expected: 'dirty' },
        { label: 'an added chat', mutate: (slot) => { (slot.chats as Obj[]).push({ ...(slot.chats as Obj[])[1], id: 'added-chat', name: 'Added' }) }, expected: 'dirty' },
        { label: 'a removed chat', mutate: (slot) => { (slot.chats as Obj[]).pop() }, expected: 'dirty' },
        { label: 'chatPage, which only the entry holds', mutate: (slot) => { slot.chatPage = 2 }, expected: 'dirty' },
        { label: 'firstMsgIndex, which only the entry holds', mutate: (slot) => { slot.firstMsgIndex = 3 }, expected: 'dirty' },
        { label: 'lastInteraction, which a stub carries', mutate: (slot) => { slot.lastInteraction = 99 }, expected: 'clean' },
        { label: 'trashTime, which a stub carries', mutate: (slot) => { slot.trashTime = 1234 }, expected: 'clean' },
    ]

    test.each(cases.map(one => [one.label, one] as const))('%s', (_label, one) => {
        const slot = assembledOf(first)[1]
        one.mutate(slot)
        expect(verdictOf(slot, previous)).toBe(one.expected)
    })

    test('the verdict agrees with the full encoder on every case whose change is in a unit or in chatPage and firstMsgIndex', async () => {
        for (const one of cases.filter(candidate => !/lastInteraction|trashTime/.test(candidate.label))) {
            const characters = assembledOf(first)
            one.mutate(characters[1])
            const expected = await fullSinkVerdict(withCharacters(db, characters), first, String(characters[1].chaId))
            expect(expected, one.label).toBe(one.expected)
            expect(verdictOf(characters[1], previous), one.label).toBe(expected)
        }
    })

    test('lastInteraction and trashTime are the only changes the full encoder writes and the verdict calls clean', async () => {
        for (const field of ['lastInteraction', 'trashTime']) {
            const characters = assembledOf(first)
            characters[1][field] = 7
            expect(await fullSinkVerdict(withCharacters(db, characters), first, String(characters[1].chaId)), field).toBe('dirty')
            expect(verdictOf(characters[1], previous), field).toBe('clean')
        }
    })

    test('the verdict never iterates the previous units, so its cost does not grow with the profile (reuse-only sink)', () => {
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
        const units = new IterationCountingMap<string, ReusableUnit>(previous.units)
        units.iterations = 0
        const counted: PreviousEncoding = { ...previous, units }
        expect(verdictOf(assembledOf(first)[1], counted)).toBe('clean')
        const edited = assembledOf(first)[1]
        edited.personality = 'edited'
        expect(verdictOf(edited, counted)).toBe('dirty')
        expect(units.iterations).toBe(0)
    })

    test('the verdict reads the previous encoding it is given: the same character against an encoding that holds another body is not clean', () => {
        const edited = encodeWith(withCharacters(db, assembledOf(first).map((slot, index) => (index === 1 ? { ...slot, personality: 'another body' } : slot))))
        const slot = assembledOf(first)[1]
        expect(verdictOf(slot, previous)).toBe('clean')
        expect(verdictOf(slot, previousFrom(edited))).toBe('dirty')
    })
})

describe('new behaviour: when the acknowledged encoding cannot answer the verdict is unknown', () => {
    const db = buildSmall(4)
    const first = encodeWith(db)

    test('a shared chaId (the handle #1 is held)', () => {
        const characters = assembledOf(first)
        characters[2] = { ...characters[2], chaId: characters[0].chaId, name: 'Second holder' }
        const shared = encodeWith(withCharacters(db, characters))
        const previous = previousFrom(shared)
        expect(previous.entities.has(`${String(characters[0].chaId)}#1`)).toBe(true)
        expect(verdictOf(assembledOf(shared)[0], previous)).toBe('unknown')
    })

    test('a character the encoding does not hold', () => {
        const slot = { ...assembledOf(first)[1], chaId: 'never-saved' }
        expect(verdictOf(slot, previousFrom(first))).toBe('unknown')
    })

    test('an entity id whose entry the previous shards do not hold', () => {
        const previous = previousFrom(first)
        const thin: PreviousEncoding = {
            ...previous,
            objects: { ...previous.objects, shards: (previous.objects?.shards ?? []).map(shard => ({ ...shard, entries: [] })) },
        }
        expect(verdictOf(assembledOf(first)[1], thin)).toBe('unknown')
        expect(verdictOf(assembledOf(first)[1], { ...previous, objects: undefined })).toBe('unknown')
    })

    test('a stub, and a character that cannot be encoded', () => {
        const previous = previousFrom(first)
        expect(verdictOf({ ...assembledOf(first)[1], coldstorage: 'x' }, previous)).toBe('unknown')
        const slot = assembledOf(first)[1]
        slot.chats = 'not a list'
        expect(verdictOf(slot, previous)).toBe('unknown')
        const pointer = assembledOf(first)[1]
        ;(pointer.chats as Obj[])[0].message = [{ role: 'char', data: 'COLDSTORAGEkey', time: 1 }]
        expect(verdictOf(pointer, previous)).toBe('unknown')
    })

    test('a unit without a digest: never clean, whatever the character holds', () => {
        const previous = previousFrom(first)
        const slot = assembledOf(first)[1]
        const u = previous.entities.get(`${String(slot.chaId)}#0`) as string
        expect(verdictOf(slot, previous)).toBe('clean')
        for (const identity of [`char:${u}:core`, `al:char:${u}`, `chat:${u}:${String((slot.chats as Obj[])[0].id)}:chunk:0`]) {
            const units = new Map<string, ReusableUnit>(previous.units)
            const held = units.get(identity) as ReusableUnit
            units.set(identity, { key: held.key, type: held.type, ref: held.ref })
            expect(verdictOf(slot, { ...previous, units }), identity).toBe('unknown')
        }
    })
})

describe('new behaviour: the entry compare keeps to the fields a pass would write', () => {
    const db = buildSmall(3)
    const first = encodeWith(db)

    function foreignWriter(previous: PreviousEncoding, change: (entry: ShardEntry) => ShardEntry): PreviousEncoding {
        const shards = (previous.objects?.shards ?? []).map(shard => ({ ...shard, entries: shard.entries.map(change) }))
        return { ...previous, objects: { ...previous.objects, shards } }
    }

    test('an unknown shard-entry field and an unknown chat-entry field do not make it dirty', () => {
        const previous = foreignWriter(previousFrom(first), entry => ({
            ...entry, futureField: { level: 2 }, chats: entry.chats.map(chat => ({ ...chat, futureChatField: [1] })),
        } as ShardEntry))
        for (const slot of assembledOf(first)) {
            expect(verdictOf(slot, previous)).toBe('clean')
        }
    })

    test('an entry another build wrote with dsp false is clean: a pass writes dsp true for every entry', () => {
        const previous = foreignWriter(previousFrom(first), entry => ({ ...entry, dsp: false }))
        for (const slot of assembledOf(first)) {
            expect(verdictOf(slot, previous)).toBe('clean')
        }
    })

    test('the overlay fields of the acknowledged entry are not compared', () => {
        const previous = foreignWriter(previousFrom(first), entry => ({
            ...entry, creatorNotes: 'older notes', tags: ['older'], creator: 'older', lastInteraction: 1, trashTime: 2,
        }))
        for (const slot of assembledOf(first)) {
            expect(verdictOf(slot, previous)).toBe('clean')
        }
    })

    test('an entry whose known fields differ is dirty: chatPage, firstMsgIndex, the kind, and a unit the entry drops', () => {
        const slot = assembledOf(first)[1]
        const target = String(slot.chaId)
        const change = (edit: (entry: ShardEntry) => ShardEntry): PreviousEncoding => foreignWriter(previousFrom(first), entry => (entry.chaId === target ? edit(entry) : entry))
        expect(verdictOf(slot, change(entry => ({ ...entry, chatPage: entry.chatPage + 1 })))).toBe('dirty')
        expect(verdictOf(slot, change(entry => ({ ...entry, firstMsgIndex: entry.firstMsgIndex + 1 })))).toBe('dirty')
        expect(verdictOf(slot, change(entry => ({ ...entry, type: 'group' })))).toBe('dirty')
        expect(verdictOf(slot, change(entry => ({ ...entry, chats: entry.chats.slice().reverse() })))).toBe('dirty')
    })
})

describe('new behaviour: a loaded character is clean once its units are hydrated, over every legacy and edge shape', () => {
    test('assemble from a boot that did not read the units, hydrate, and the verdict and the full encoder agree it is clean (A1)', async () => {
        let shapes = 0
        for (const { label, character } of buildLegacyCases()) {
            const db = dbWithCharacters([character])
            const first = encodeWith(db)
            const entry = (first.index.objects?.shards ?? []).flatMap(shard => shard.entries)[0]
            const stored = { manifestKey: first.manifestKey, manifest: first.manifest, source: unitMapSource(first.units) }
            const entityUnits = new Set(first.units.filter(unit => unit.identity.includes(entry.u) && !unit.identity.startsWith('shard')).map(unit => unit.key))
            const previous = previousOfTree({ ...stored, source: { get: key => (entityUnits.has(key) ? undefined : stored.source.get(key)) } })
            const loaded = assembledOf(first)[0]

            expect(verdictOf(loaded, previous), `${label} before hydration`).toBe('unknown')
            hydrateEntityDigests(previous, entry, stored.source)
            expect(verdictOf(loaded, previous), label).toBe('clean')

            const tree = await encodeScoped(
                withCharacters(db, [loaded]),
                { env: seededEnv(9), lists: fakeLists, seq: 2, createdAt: NOW, previous },
                { modules: false, characters: new Set([String(loaded.chaId)]) },
            )
            expect(isUnchanged(tree), `${label}: every unit reused`).toBe(true)
            shapes++
        }
        expect(shapes).toBeGreaterThanOrEqual(39)
    })

    test('the reuse-only sink gives the full encoder\'s answer on every shape, unedited and edited', async () => {
        for (const { label, character } of buildLegacyCases()) {
            const db = dbWithCharacters([character])
            const first = encodeWith(db)
            const previous = previousFrom(first)
            for (const edit of [false, true]) {
                const characters = assembledOf(first)
                if (edit) {
                    characters[0].personality = `edited ${label}`
                }
                const chaId = String(characters[0].chaId)
                const expected = await fullSinkVerdict(withCharacters(db, characters), first, chaId)
                expect(expected, `${label} edit=${edit}`).toBe(edit ? 'dirty' : 'clean')
                expect(verdictOf(characters[0], previous), `${label} edit=${edit}`).toBe(expected)
            }
        }
    })
})

describe('a character whose data cannot be read has no verdict', () => {
    const first = encodeWith(buildSmall(4))
    const previous = previousFrom(first)

    test('reproducer: a toJSON that throws gives unknown instead of escaping the put-back check', () => {
        const slot = assembledOf(first)[1]
        slot.personality = { toJSON() { throw new Error('toJSON fault') } }
        expect(verdictOf(slot, previous)).toBe('unknown')
    })

    test('guard (passes before and after): a cycle gives unknown', () => {
        const slot = assembledOf(first)[1]
        const value: Obj = {}
        value.self = value
        slot.personality = value
        expect(verdictOf(slot, previous)).toBe('unknown')
    })

    test('guard (passes before and after): a BigInt gives unknown', () => {
        const slot = assembledOf(first)[1]
        slot.personality = BigInt(1)
        expect(verdictOf(slot, previous)).toBe('unknown')
    })

    test('a fault after the encoder started is not hidden as unknown', () => {
        const fault = new Error('list derivation fault')
        const lists = { ...fakeLists, characterAssets: () => { throw fault } }
        const slot = assembledOf(first)[1]
        expect(() => characterMatchesAcknowledged(slot as unknown as character, { env: seededEnv(5), lists, previous })).toThrow(fault)
    })
})
