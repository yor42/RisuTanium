import { describe, expect, test } from 'vitest'
import {
    COLD_POINTER_HEADER, encodeDatabase, StubRefusedError, assertChatNotPointer, isColdStub, overlayStub, stubFromEntry,
    type EncodedTree,
} from '../../store2/codec'
import { coldStorageHeader } from '../../../process/coldstorageData'
import { buildColdStub, COLD_STUB_VERSION } from '../../../process/coldCharacter'
import type { character } from '../../database.svelte'
import type { ShardEntry } from '../../store2/format'
import {
    asDatabase, buildLegacyCases, buildSmall, dbWithCharacters, encodeWith, fakeLists, roundTrip, seededEnv, type Obj,
} from './codecFixtures'

function loaded(index: number, chaId = `c${index}`): Obj {
    const base = JSON.parse(JSON.stringify(buildSmall(index + 1).characters[index])) as Obj
    base.chaId = chaId
    return base
}

describe('the codec refuses a stub (I9)', () => {
    test('a stub built by the application is refused with a typed error naming the character', () => {
        const stub = buildColdStub(loaded(0, 'real') as unknown as character, 'unit-key', ['chat-a'])
        expect(() => encodeWith(dbWithCharacters([stub as unknown as Obj]))).toThrow(StubRefusedError)
        try {
            encodeWith(dbWithCharacters([stub as unknown as Obj]))
        } catch (error) {
            expect(error).toBeInstanceOf(StubRefusedError)
            expect((error as StubRefusedError).kind).toBe('character')
            expect((error as StubRefusedError).chaId).toBe('real')
            expect((error as StubRefusedError).code).toBe('stub')
        }
    })

    test('a stub among loaded characters stops the whole encode, wherever it sits', () => {
        const stub = { ...loaded(1), coldstorage: 'unit-key' }
        for (const order of [[stub, loaded(0)], [loaded(0), stub], [loaded(0), stub, loaded(2)]]) {
            expect(() => encodeWith(dbWithCharacters(order))).toThrow(StubRefusedError)
        }
    })

    test('a group stub is refused as well', () => {
        expect(() => encodeWith(dbWithCharacters([{ ...loaded(0), type: 'group', coldstorage: 'k' }]))).toThrow(StubRefusedError)
    })

    test('a chat that is still a cold-storage pointer is refused with its position', () => {
        const slot = loaded(0)
        ;(slot.chats as Obj[]).push({ message: [{ role: 'user', data: `${coldStorageHeader}some-key`, time: 1 }], name: 'cold', id: 'cold' })
        try {
            encodeWith(dbWithCharacters([slot]))
            expect.unreachable()
        } catch (error) {
            expect(error).toBeInstanceOf(StubRefusedError)
            expect((error as StubRefusedError).kind).toBe('chat')
            expect((error as StubRefusedError).chatIndex).toBe(2)
        }
    })

    test('the pointer header is the application one', () => {
        expect(COLD_POINTER_HEADER).toBe(coldStorageHeader)
        const codePoints = Array.from(COLD_POINTER_HEADER).map(char => char.codePointAt(0))
        expect(codePoints).toEqual([0xef01, ...Array.from('COLDSTORAGE').map(char => char.codePointAt(0)), 0xef01])
    })

    test('a legacy load-error chat is not refused: it is encoded and round-trips with its text kept exactly', () => {
        const slot = loaded(0)
        const text = '[Cold storage data could not be loaded. Key: coldstorage/abc]'
        const message = { role: 'char', data: text, time: 1 }
        ;(slot.chats as Obj[])[0].message = [message]
        const db = dbWithCharacters([slot])
        expect(() => encodeWith(db)).not.toThrow()
        const { first, second, assembled } = roundTrip(db)
        const chat = (assembled.characters[0].chats as unknown as Obj[])[0]
        expect(chat.message).toEqual([message])
        expect(second.units.map(unit => unit.identity)).toEqual(first.units.map(unit => unit.identity))
        for (const unit of first.units) {
            expect(Array.from(unit.bytes)).toEqual(Array.from(second.units.find(one => one.identity === unit.identity)?.bytes ?? []))
        }
    })

    test('a loaded character is not a stub, nor one with an empty or unset pointer, and a plain message that mentions the word is fine', () => {
        const slot = loaded(0)
        slot.coldstorage = ''
        ;(slot.chats as Obj[])[0].message = [{ role: 'user', data: 'COLDSTORAGE is only a word here', time: 1 }]
        expect(isColdStub(slot)).toBe(false)
        expect(() => roundTrip(dbWithCharacters([slot]))).not.toThrow()
        expect(isColdStub({ coldstorage: undefined })).toBe(false)
        expect(isColdStub({ coldstorage: 'x' })).toBe(true)
        assertChatNotPointer({ message: [] }, 'x', 0)
    })

    test('the refusal needs no list derivation to have run: nothing is derived for a stub', () => {
        let calls = 0
        const counting = { ...fakeLists, characterAssets: (owner: Parameters<typeof fakeLists.characterAssets>[0]) => { calls++; return fakeLists.characterAssets(owner) } }
        expect(() => encodeDatabase(asDatabase({ ...(buildSmall(1) as unknown as Obj), characters: [{ ...loaded(0), coldstorage: 'k' }] }), {
            env: seededEnv(1), lists: counting, seq: 1, createdAt: 1,
        })).toThrow(StubRefusedError)
        expect(calls).toBe(0)
    })
})

function entriesOf(tree: EncodedTree): ShardEntry[] {
    return (tree.index.objects?.shards ?? []).flatMap(shard => shard.entries)
}

function entryOfChaId(tree: EncodedTree, chaId: string): ShardEntry {
    const entry = entriesOf(tree).find(candidate => candidate.chaId === chaId)
    if (entry === undefined) {
        throw new Error(`No entry for ${chaId}`)
    }
    return entry
}

describe('new behaviour: stubFromEntry builds the stub a shard entry stands for', () => {
    function stubCase(tweak: (slot: Obj) => void): { entry: ShardEntry, source: Obj, stub: Obj } {
        const slot = loaded(0, 'stubbed')
        tweak(slot)
        const entry = entryOfChaId(encodeWith(dbWithCharacters([slot])), 'stubbed')
        return { entry, source: slot, stub: stubFromEntry(entry) as Obj }
    }

    test.each([
        ['a plain character', () => undefined],
        ['a trashed character', (slot: Obj) => { slot.trashTime = 1234 }],
        ['a character with an image and a last interaction', (slot: Obj) => { slot.image = 'portrait.png'; slot.lastInteraction = 99 }],
        ['a group', (slot: Obj) => { slot.type = 'group'; slot.characters = ['m1', 'm2'] }],
        ['a character with tags and an edited creator', (slot: Obj) => { slot.tags = ['a', 'b']; slot.additionalData = { creator: 'edited' } }],
    ] as const)('%s: the field set is the one buildColdStub gives, apart from the dummy chat', (_label, tweak) => {
        const { entry, source, stub } = stubCase(tweak)
        const reference = buildColdStub(source as unknown as character, entry.u, []) as unknown as Obj
        const { chats: stubChats, ...stubFields } = stub
        const { chats: referenceChats, ...referenceFields } = reference
        expect(stubFields).toEqual(referenceFields)
        expect(stubChats).toHaveLength(1)
        expect(referenceChats).toHaveLength(1)
        expect(isColdStub(stub)).toBe(true)
    })

    test('the stub names the entry\'s entity, counts its chats and is no pointer chat', () => {
        const { entry, stub } = stubCase(() => undefined)
        expect(stub.coldstorage).toBe(entry.u)
        expect(stub.coldChatCount).toBe(entry.chats.length)
        expect(entry.chats.length).toBeGreaterThan(1)
        expect(stub.coldStoragedChats).toEqual([])
        expect(stub.coldVersion).toBe(COLD_STUB_VERSION)
        expect(stub.chatPage).toBe(0)
        expect(stub.firstMsgIndex).toBe(0)
        const [dummy] = stub.chats as Obj[]
        expect((dummy.message as Obj[])[0].data).toBe('')
    })

    test('a trashed entry keeps its trashTime and an untrashed one has none', () => {
        expect(stubCase(slot => { slot.trashTime = 1234 }).stub.trashTime).toBe(1234)
        expect(Object.hasOwn(stubCase(() => undefined).stub, 'trashTime')).toBe(false)
    })

    test('a group stub carries its members and no tags, a character stub the opposite', () => {
        const group = stubCase(slot => { slot.type = 'group'; slot.characters = ['m1', 'm2'] }).stub
        expect(group.characters).toEqual(['m1', 'm2'])
        expect(Object.hasOwn(group, 'tags')).toBe(false)
        const single = stubCase(() => undefined).stub
        expect(Object.hasOwn(single, 'characters')).toBe(false)
        expect(single.tags).toEqual(['synthetic', 'profiling'])
    })

    test('the overlay of a stub over its own entry is the entry, over every legacy and edge shape (fixed point)', () => {
        const long = 'x'.repeat(620)
        const extra = [
            { label: 'multilingual notes', character: { ...loaded(0, 'multi'), creatorNotes: '# `en`\nHello\n# `ko`\n안녕' } },
            { label: 'notes cut at the limit', character: { ...loaded(0, 'long'), creatorNotes: long } },
            { label: 'notes cut inside a surrogate pair', character: { ...loaded(0, 'pair'), creatorNotes: `${'y'.repeat(499)}\u{1F600}tail` } },
        ]
        let shapes = 0
        for (const { label, character } of [...buildLegacyCases(), ...extra]) {
            const tree = encodeWith(dbWithCharacters([character]))
            const entry = entriesOf(tree)[0]
            const stub = stubFromEntry(entry)
            expect(overlayStub(entry, stub as unknown as character), label).toEqual(entry)
            shapes++
        }
        expect(shapes).toBeGreaterThanOrEqual(39)
    })
})
