import { crc32 } from 'node:zlib'
import { describe, expect, test } from 'vitest'
import type { Shard, ShardEntry } from '../../store2/format'
import { UNIT_TYPE } from '../../store2/format'
import { groupIntoShards, SHARD_COUNT, shardOfU } from '../../store2/codec'
import {
    bodyOf, buildSmall, buildT4, dbWithCharacters, encodeWith, mulberry32, previousFrom, prosePool, roundTrip, seededEnv,
    sparseCharacter, unitOf, type Obj,
} from './codecFixtures'

function shardsOf(tree: ReturnType<typeof encodeWith>): { index: number, shard: Shard }[] {
    return tree.units
        .filter(unit => unit.type === UNIT_TYPE.shard)
        .map(unit => ({ index: Number(unit.identity.split(':')[1]), shard: bodyOf(unit) as unknown as Shard }))
}

function entriesOf(tree: ReturnType<typeof encodeWith>): ShardEntry[] {
    return shardsOf(tree).flatMap(({ shard }) => shard.entries)
}

function character(chaId: unknown, extra: Obj = {}): Obj {
    const rng = mulberry32(3)
    return { ...sparseCharacter(rng, prosePool(rng, 4, 20, 60), 'placeholder', `Name ${String(chaId)}`, [], []), chaId, ...extra }
}

describe('shard placement', () => {
    test('shardOfU is crc32 of the UTF-8 bytes of u, modulo the shard count', () => {
        for (const u of ['', 'a', 'abc', '0123456789abcdefghijklmnop', 'ünï\u{1F600}']) {
            expect(shardOfU(u)).toBe(crc32(Buffer.from(u, 'utf8')) % 16)
            expect(shardOfU(u, 7)).toBe(crc32(Buffer.from(u, 'utf8')) % 7)
        }
        expect(SHARD_COUNT).toBe(16)
    })

    test('every entry sits in the shard its u names, entries are sorted by u, and all 16 shards exist', () => {
        const tree = encodeWith(buildT4().db)
        const shards = shardsOf(tree)
        expect(shards.map(one => one.index).sort((a, b) => a - b)).toEqual(Array.from({ length: 16 }, (_, i) => i))
        let total = 0
        for (const { index, shard } of shards) {
            const us = shard.entries.map(entry => entry.u)
            expect(us).toEqual([...us].sort())
            for (const u of us) {
                expect(shardOfU(u)).toBe(index)
            }
            total += us.length
        }
        expect(total).toBe(1000)
        expect(tree.manifest.shards).toHaveLength(16)
    })

    test('placement follows u and not chaId', () => {
        const slots = Array.from({ length: 40 }, (_, i) => character(`id-${i}`))
        const tree = encodeWith(dbWithCharacters(slots))
        const byChaId = shardsOf(tree).flatMap(({ index, shard }) => shard.entries.map(entry => ({ entry, index })))
        const diverging = byChaId.filter(({ entry }) => shardOfU(entry.chaId) !== shardOfU(entry.u))
        expect(diverging.length).toBeGreaterThan(0)
        for (const { entry, index } of diverging) {
            expect(index).toBe(shardOfU(entry.u))
            expect(index).not.toBe(shardOfU(entry.chaId))
        }
    })

    test('groupIntoShards sorts entries and fills empty shards', () => {
        const entry = (u: string) => ({ u }) as ShardEntry
        const shards = groupIntoShards([entry('zz'), entry('aa'), entry('mm')], 4)
        expect(shards).toHaveLength(4)
        expect(shards.flatMap(shard => shard.entries.map(one => one.u)).sort()).toEqual(['aa', 'mm', 'zz'])
        for (const shard of shards) {
            expect(shard.entries.map(one => one.u)).toEqual(shard.entries.map(one => one.u).sort())
        }
    })
})

describe('entity id u', () => {
    test('u is minted from the injected randomness, not derived from chaId', () => {
        const slots = [character('same-id'), character('other-id')]
        const a = entriesOf(encodeWith(dbWithCharacters(slots), { env: seededEnv(1) }))
        const b = entriesOf(encodeWith(dbWithCharacters(slots), { env: seededEnv(2) }))
        const uOf = (entries: ShardEntry[], chaId: string) => entries.find(entry => entry.chaId === chaId)!.u
        expect(uOf(a, 'same-id')).not.toBe(uOf(b, 'same-id'))
        expect(uOf(a, 'same-id')).not.toBe(uOf(a, 'other-id'))
        for (const entry of [...a, ...b]) {
            expect(entry.u).toMatch(/^[0-9a-v]{26}$/)
            expect(entry.u).not.toContain(entry.chaId)
        }
    })

    test('u is kept for a character across encodes through the previous encoding, and a renamed chaId is a new entity', () => {
        const slots = [character('keep'), character('rename')]
        const first = encodeWith(dbWithCharacters(slots), { env: seededEnv(1) })
        const again = encodeWith(dbWithCharacters(slots), { env: seededEnv(50), previous: previousFrom(first) })
        const us = (tree: ReturnType<typeof encodeWith>) => Object.fromEntries(entriesOf(tree).map(entry => [entry.chaId, entry.u]))
        expect(us(again)).toEqual(us(first))
        const renamed = encodeWith(dbWithCharacters([slots[0], character('renamed')]), { env: seededEnv(60), previous: previousFrom(first) })
        expect(us(renamed).keep).toBe(us(first).keep)
        expect(us(renamed).renamed).not.toBe(us(first).rename)
    })

    test('two characters with the same chaId get distinct entities that survive an encode in order', () => {
        const slots = [character('twin', { name: 'first twin' }), character('twin', { name: 'second twin' })]
        const first = encodeWith(dbWithCharacters(slots), { env: seededEnv(1) })
        const entries = entriesOf(first)
        expect(new Set(entries.map(entry => entry.u)).size).toBe(2)
        const again = encodeWith(dbWithCharacters(slots), { env: seededEnv(9), previous: previousFrom(first) })
        expect(entriesOf(again).map(entry => `${entry.name}:${entry.u}`).sort()).toEqual(entries.map(entry => `${entry.name}:${entry.u}`).sort())
        expect(roundTrip(dbWithCharacters(slots)).assembled.characters.map(slot => slot.name)).toEqual(['first twin', 'second twin'])
    })

    test.each([
        ['empty', ''],
        ['with spaces', 'a b c'],
        ['numeric', 4242],
        ['unicode', 'ünï\u{1F600}'],
        ['a prototype name', 'constructor'],
        ['__proto__', '__proto__'],
        ['a hidden-prefixed id', '§hidden'],
    ])('a non-uuid chaId converts: %s', (_label, chaId) => {
        const { first, assembled } = roundTrip(dbWithCharacters([character(chaId)]))
        const entry = entriesOf(first)[0]
        expect(entry.chaId).toBe(String(chaId))
        expect(assembled.characters[0].chaId).toBe(chaId)
    })
})

describe('shard entries', () => {
    const entryFor = (slot: Obj): ShardEntry => entriesOf(encodeWith(dbWithCharacters([slot])))[0]

    test('carry the stub fields but not the chats, the pointer or the derived cold fields', () => {
        const entry = entryFor(character('c1', { lastInteraction: 1234, trashTime: 99, chatPage: 2, image: 'img.png', tags: ['x', 4, 'y'], creator: 'me' }))
        expect(entry).toMatchObject({
            type: 'character', name: 'Name c1', chaId: 'c1', image: 'img.png', lastInteraction: 1234, trashTime: 99,
            chatPage: 2, tags: ['x', 'y'], creator: 'me', dsp: true,
        })
        for (const name of ['coldstorage', 'coldStoragedChats', 'coldVersion', 'coldChatCount', 'message']) {
            expect(name in entry).toBe(false)
        }
        expect(entry.chats).toEqual([])
    })

    test('a group entry carries its member list and no tags or creator', () => {
        const entry = entryFor(character('g1', { type: 'group', characters: ['m1', 'm2', 7] }))
        expect(entry.type).toBe('group')
        expect(entry.characters).toEqual(['m1', 'm2'])
        expect('tags' in entry).toBe(false)
        expect('creator' in entry).toBe(false)
    })

    test('creatorNotes is the shown description, at most 500 characters', () => {
        expect(entryFor(character('c2', { creatorNotes: '# `en`\nEnglish text\n# `ko`\n한국어' })).creatorNotes).toBe('English text')
        expect(entryFor(character('c3', { creatorNotes: 'x'.repeat(900) })).creatorNotes).toHaveLength(500)
    })

    test('a value the entry cannot hold stays in the core, and the entry shows 0', () => {
        const odd = character('c4', { firstMsgIndex: -2, chatPage: -2 })
        const tree = encodeWith(dbWithCharacters([odd]))
        const entry = entriesOf(tree)[0]
        expect(entry.firstMsgIndex).toBe(0)
        expect(entry.chatPage).toBe(0)
        const core = bodyOf(unitOf(tree, `char:${entry.u}:core`))
        expect((core.f as Obj).firstMsgIndex).toBe(-2)
        expect((core.f as Obj).chatPage).toBe(-2)
        const fraction = encodeWith(dbWithCharacters([character('c4b', { firstMsgIndex: 1.5 })]))
        const fractionEntry = entriesOf(fraction)[0]
        expect(fractionEntry.firstMsgIndex).toBe(0)
        expect((bodyOf(unitOf(fraction, `char:${fractionEntry.u}:core`)).f as Obj).firstMsgIndex).toBe(1.5)
    })

    test('a first-message index of -1 goes in the entry and nowhere else', () => {
        const tree = encodeWith(dbWithCharacters([character('c4c', { firstMsgIndex: -1 })]))
        const entry = entriesOf(tree)[0]
        expect(entry.firstMsgIndex).toBe(-1)
        expect('firstMsgIndex' in (bodyOf(unitOf(tree, `char:${entry.u}:core`)).f as Obj)).toBe(false)
    })

    test('moved fields are not in the core, so a send or a chat switch leaves the core unit alone', () => {
        const tree = encodeWith(dbWithCharacters([character('c5', { lastInteraction: 5, trashTime: 6, chatPage: 1, firstMsgIndex: 2 })]))
        const entry = entriesOf(tree)[0]
        const f = bodyOf(unitOf(tree, `char:${entry.u}:core`)).f as Obj
        for (const name of ['lastInteraction', 'trashTime', 'chatPage', 'firstMsgIndex']) {
            expect(name in f).toBe(false)
        }
        expect(entry.firstMsgIndex).toBe(2)
    })

    test('lore and scripts are null when the character has neither', () => {
        const slot = character('c6')
        delete slot.globalLore
        delete slot.customscript
        delete slot.triggerscript
        const entry = entryFor(slot)
        expect(entry.lore).toBeNull()
        expect(entry.scripts).toBeNull()
        expect(entryFor(character('c7')).lore).not.toBeNull()
    })

    test('the asset list is a unit of type 15, the inlay list one of type 21 and only present with an inlay', () => {
        const withAssets = character('c8', { image: 'assets/ABC.png', additionalAssets: [['n', 'assets/DEF.PNG', 'png']] })
        const tree = encodeWith(dbWithCharacters([withAssets]))
        const entry = entriesOf(tree)[0]
        const list = unitOf(tree, `al:char:${entry.u}`)
        expect(list.type).toBe(UNIT_TYPE.assetList)
        expect(bodyOf(list).l).toEqual(['abc.png', 'def.png'])
        expect(entry.al.slice(0, 3)).toEqual(list.ref)
        expect(entry.al[3]).toBe(1)
        expect(entry.il).toBeNull()
        const inlayed = character('c9', { chats: [{ message: [{ role: 'char', data: '{{inlay::0123abcd-0123-4123-a123-0123456789ab}}' }], name: 'i', id: 'i' }] })
        const inlayTree = encodeWith(dbWithCharacters([inlayed]))
        const inlayEntry = entriesOf(inlayTree)[0]
        expect(inlayEntry.il).not.toBeNull()
        expect(unitOf(inlayTree, `il:char:${inlayEntry.u}`).type).toBe(UNIT_TYPE.inlayList)
    })

    test('small profile entries all parse back through assemble', () => {
        const db = buildSmall(5)
        expect(roundTrip(db).assembled.characters.map(slot => slot.name)).toEqual(db.characters.map(slot => slot.name))
    })
})
