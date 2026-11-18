// @vitest-environment node
import { describe, expect, test } from 'vitest'
import {
    assembleDatabase, freshEntry, previousEntryOf, previousFrom, unitMapSource,
    type EncodedTree, type PreviousEncoding, type VerdictOptions,
} from '../../store2/codec'
import { ENTRY_MOVED_FIELDS } from '../../store2/codec/bodies'
import type { character, Database } from '../../database.svelte'
import { classifyCharacterRecords, type RecordDecision } from '../../store2/fastForward/delta'
import type { RecordSide } from '../../store2/fastForward/units'
import {
    asDatabase, bodyIn, buildT5Chat, chat, encodeWith, fakeLists, message, mulberry32, profileWithChats, prosePool, seededEnv, unitOf,
    type Obj,
} from './codecFixtures'

function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T
}

function profile(): Database {
    const rng = mulberry32(42)
    const pool = prosePool(rng, 20, 100, 400)
    const small = chat(rng, 1, [message(rng, pool, 0, 200), message(rng, pool, 1, 200)])
    return profileWithChats([buildT5Chat(40), small], 21)
}

function digestsOf(...trees: EncodedTree[]): Map<string, string> {
    const out = new Map<string, string>()
    for (const tree of trees) {
        for (const unit of tree.units) {
            out.set(unit.key, unit.digest)
        }
    }
    return out
}

interface World {
    first: EncodedTree
    previous: PreviousEncoding
    options: VerdictOptions
    assembled: Obj
    u: string
    base: RecordSide
    cids: string[]
}

function makeWorld(): World {
    const first = encodeWith(profile())
    const previous = previousFrom(first)
    const options: VerdictOptions = { env: seededEnv(5), lists: fakeLists, previous }
    const assembled = clone(assembleDatabase(first.manifest, unitMapSource(first.units))) as unknown as Obj
    const chaId = String(((assembled.characters as Obj[])[0]).chaId)
    const u = previous.entities.get(`${chaId}#0`)
    const entry = u === undefined ? undefined : previousEntryOf(previous, u)
    if (u === undefined || entry === undefined) {
        throw new Error('The fixture character has no entry.')
    }
    const digests = digestsOf(first)
    return { first, previous, options, assembled, u, cids: entry.chats.map(one => one.cid), base: { entry, splitCore: false, digestOf: key => digests.get(key) } }
}

function mineOf(world: World, mutate: (slot: Obj) => void = () => undefined): RecordSide {
    const db = clone(world.assembled)
    const slot = (db.characters as Obj[])[0]
    mutate(slot)
    const fresh = freshEntry(slot as unknown as character, world.options)
    if (fresh === 'unknown') {
        throw new Error('unknown')
    }
    return { entry: fresh.entry, splitCore: fresh.splitCore, digestOf: key => fresh.digests.get(key) }
}

function theirsOf(world: World, mutate: (slot: Obj) => void = () => undefined, seed = 9): RecordSide {
    const db = clone(world.assembled)
    mutate((db.characters as Obj[])[0])
    const tree = encodeWith(asDatabase(db), { env: seededEnv(seed), seq: 2, previous: world.previous })
    const entry = previousEntryOf(previousFrom(tree), world.u)
    if (entry === undefined) {
        throw new Error('no entry')
    }
    const core = bodyIn(unitOf(tree, `char:${world.u}:core`), world.first)
    const splitCore = (Array.isArray(core.a) && core.a.length > 0) || Object.keys(core.f as Obj).some(name => (ENTRY_MOVED_FIELDS as readonly string[]).includes(name))
    const digests = digestsOf(world.first, tree)
    return { entry, splitCore, digestOf: key => digests.get(key) }
}

function decisions(world: World, mine: RecordSide, theirs: RecordSide): RecordDecision[] {
    return classifyCharacterRecords({ base: world.base, mine, theirs }).decisions
}

const chatsOf = (slot: Obj): Obj[] => slot.chats as Obj[]
const editMessage = (index: number, data: string) => (slot: Obj): void => { (chatsOf(slot)[index].message as Obj[])[0].data = data }

describe('U7: the per-record table', () => {
    const world = makeWorld()

    test('nothing changed: no decision', () => {
        expect(decisions(world, mineOf(world), theirsOf(world))).toEqual([])
    })

    test('only theirs changed: take', () => {
        expect(decisions(world, mineOf(world), theirsOf(world, (slot) => { slot.personality = 'theirs' })))
            .toEqual([{ id: 'core', kind: 'take' }])
    })

    test('only mine changed: keep, not agreed', () => {
        expect(decisions(world, mineOf(world, (slot) => { slot.personality = 'mine' }), theirsOf(world)))
            .toEqual([{ id: 'core', kind: 'keep', agreed: false }])
    })

    test('both changed to the same content under different keys: keep, agreed (sameAsTheirs)', () => {
        const mine = mineOf(world, (slot) => { slot.personality = 'same' })
        const theirs = theirsOf(world, (slot) => { slot.personality = 'same' })
        expect(mine.entry.core[0]).not.toBe(theirs.entry.core[0])
        expect(decisions(world, mine, theirs)).toEqual([{ id: 'core', kind: 'keep', agreed: true }])
    })

    test('both changed to different content: conflict', () => {
        expect(decisions(world, mineOf(world, (slot) => { slot.personality = 'mine' }), theirsOf(world, (slot) => { slot.personality = 'theirs' })))
            .toEqual([{ id: 'core', kind: 'conflict', conflict: 'both' }])
    })

    test('different records change independently', () => {
        const mine = mineOf(world, (slot) => { slot.personality = 'mine' })
        const theirs = theirsOf(world, (slot) => { ((slot.globalLore as Obj[])[0]).content = 'theirs lore' })
        expect(decisions(world, mine, theirs)).toEqual([
            { id: 'core', kind: 'keep', agreed: false },
            { id: 'lore', kind: 'take' },
        ])
    })

    test('a chat removed there and edited here is a deletedThere conflict', () => {
        const result = decisions(world, mineOf(world, editMessage(1, 'mine edit')), theirsOf(world, (slot) => { chatsOf(slot).pop() }))
        expect(result).toContainEqual({ id: `chat:${world.cids[1]}`, kind: 'conflict', conflict: 'deletedThere' })
        expect(result).toContainEqual({ id: 'chatList', kind: 'take' })
    })

    test('a chat removed here and edited there is a deletedHere conflict', () => {
        const result = decisions(world, mineOf(world, (slot) => { chatsOf(slot).pop() }), theirsOf(world, editMessage(1, 'theirs edit')))
        expect(result).toContainEqual({ id: `chat:${world.cids[1]}`, kind: 'conflict', conflict: 'deletedHere' })
        expect(result).toContainEqual({ id: 'chatList', kind: 'keep', agreed: false })
    })

    test('a chat removed there and unchanged here: the removal is taken', () => {
        const result = decisions(world, mineOf(world), theirsOf(world, (slot) => { chatsOf(slot).pop() }))
        expect(result).toContainEqual({ id: `chat:${world.cids[1]}`, kind: 'take' })
        expect(result).toContainEqual({ id: 'chatList', kind: 'take' })
    })

    test('a chat removed on both sides: keep, agreed', () => {
        const result = decisions(world, mineOf(world, (slot) => { chatsOf(slot).pop() }), theirsOf(world, (slot) => { chatsOf(slot).pop() }))
        expect(result).toContainEqual({ id: `chat:${world.cids[1]}`, kind: 'keep', agreed: true })
        expect(result).toContainEqual({ id: 'chatList', kind: 'keep', agreed: true })
    })

    test('both added a different chat: the chat list merges, each added chat is its own record', () => {
        const added = (id: string) => (slot: Obj): void => { chatsOf(slot).push({ ...clone(chatsOf(slot)[1]), id, name: id }) }
        const result = decisions(world, mineOf(world, added('mine-chat')), theirsOf(world, added('theirs-chat')))
        expect(result).toContainEqual({ id: 'chatList', kind: 'merge' })
        expect(result).toContainEqual({ id: 'chat:mine-chat', kind: 'keep', agreed: false })
        expect(result).toContainEqual({ id: 'chat:theirs-chat', kind: 'take' })
    })

    test('both switched to a different chat: the view merges', () => {
        const mine = mineOf(world, (slot) => { slot.chatPage = 1 })
        const theirs = theirsOf(world, (slot) => { chatsOf(slot).push({ ...clone(chatsOf(slot)[1]), id: 'third', name: 'Third' }); slot.chatPage = 2 })
        expect(decisions(world, mine, theirs)).toContainEqual({ id: 'view', kind: 'merge' })
    })

    test('a whole character: only the whole record is decided', () => {
        const noId = (slot: Obj): void => { delete chatsOf(slot)[0].id }
        const mine = mineOf(world, noId)
        const result = classifyCharacterRecords({ base: world.base, mine, theirs: theirsOf(world, noId) })
        expect(result.whole).toBe(true)
        expect(result.decisions.map(decision => decision.id)).toEqual(['whole'])
    })
})
