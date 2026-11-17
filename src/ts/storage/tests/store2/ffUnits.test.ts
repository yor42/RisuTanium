// @vitest-environment node
import { describe, expect, test } from 'vitest'
import {
    assembleChatEntry, assembleDatabase, assembleCharacter, freshEntry, previousEntryOf, previousFrom, unitMapSource,
    type EncodedTree, type PreviousEncoding, type VerdictOptions,
} from '../../store2/codec'
import { ENTRY_MOVED_FIELDS } from '../../store2/codec/bodies'
import type { ShardEntry } from '../../store2/format'
import type { character, Database } from '../../database.svelte'
import { classifyCharacterRecords } from '../../store2/fastForward/delta'
import {
    changedRecords, fingerprintOf, isWholeEntry, recordRefs, type RecordSide,
} from '../../store2/fastForward/units'
import {
    asDatabase, bodyIn, buildT5Chat, chat, encodeWith, fakeLists, message, mulberry32, profileWithChats, prosePool, seededEnv, unitOf,
    type Obj,
} from './codecFixtures'

function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T
}

/** One character with a long chat (several chunks) and a small chat that holds an alternatives record. */
function profile(longCount = 300): Database {
    const rng = mulberry32(42)
    const pool = prosePool(rng, 20, 100, 400)
    const small = chat(rng, 1, [message(rng, pool, 0, 200), message(rng, pool, 1, 200)])
    small.alt = [{ m: { role: 'char', data: 'alternative' }, p: null, a: 0 }]
    return profileWithChats([buildT5Chat(longCount), small], 21)
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
}

function makeWorld(db: Database = profile()): World {
    const first = encodeWith(db)
    const previous = previousFrom(first)
    const options: VerdictOptions = { env: seededEnv(5), lists: fakeLists, previous }
    const assembled = clone(assembleDatabase(first.manifest, unitMapSource(first.units))) as unknown as Obj
    const chaId = String(((assembled.characters as Obj[])[0]).chaId)
    const u = previous.entities.get(`${chaId}#0`)
    if (u === undefined) {
        throw new Error('The fixture character has no entity id.')
    }
    const entry = previousEntryOf(previous, u)
    if (entry === undefined) {
        throw new Error('The fixture character has no entry.')
    }
    const digests = digestsOf(first)
    return { first, previous, options, assembled, u, base: { entry, splitCore: false, digestOf: key => digests.get(key) } }
}

function liveOf(world: World, mutate: (slot: Obj) => void = () => undefined): character {
    const db = clone(world.assembled)
    const slot = (db.characters as Obj[])[0]
    mutate(slot)
    return slot as unknown as character
}

function mineOf(world: World, mutate: (slot: Obj) => void = () => undefined): RecordSide {
    const fresh = freshEntry(liveOf(world, mutate), world.options)
    if (fresh === 'unknown') {
        throw new Error('The fixture character is unknown to the acknowledged encoding.')
    }
    return { entry: fresh.entry, splitCore: fresh.splitCore, digestOf: key => fresh.digests.get(key) }
}

function theirsOf(world: World, mutate: (slot: Obj) => void = () => undefined, seed = 9): RecordSide {
    const db = clone(world.assembled)
    mutate((db.characters as Obj[])[0])
    const tree = encodeWith(asDatabase(db), { env: seededEnv(seed), seq: 2, previous: world.previous })
    const entry = previousEntryOf(previousFrom(tree), world.u)
    if (entry === undefined) {
        throw new Error('The peer encoding has no entry for the fixture character.')
    }
    const core = bodyIn(unitOf(tree, `char:${world.u}:core`), world.first)
    const absent = Array.isArray(core.a) ? core.a : []
    const fields = core.f as Obj
    const splitCore = absent.length > 0 || Object.keys(fields).some(name => (ENTRY_MOVED_FIELDS as readonly string[]).includes(name))
    const digests = digestsOf(world.first, tree)
    return { entry, splitCore, digestOf: key => digests.get(key) }
}

function chats(slot: Obj): Obj[] {
    return slot.chats as Obj[]
}

function messages(slot: Obj, chatIndex: number): Obj[] {
    return chats(slot)[chatIndex].message as Obj[]
}

/** The index of the first message of chunk `k` of a chat entry. */
function firstMessageOfChunk(entry: ShardEntry, chatIndex: number, k: number): number {
    return entry.chats[chatIndex].chunks.slice(0, k).reduce((sum, ref) => sum + Number(ref[3]), 0)
}

const EDITS: { id: string, mutate: (slot: Obj) => void }[] = [
    { id: 'core', mutate: (slot) => { slot.personality = 'edited personality' } },
    { id: 'lore', mutate: (slot) => { ((slot.globalLore as Obj[])[0]).content = 'edited lore' } },
    { id: 'scripts', mutate: (slot) => { slot.customscript = [{ comment: 'x', in: 'a', out: 'b', type: 'editinput' }] } },
]

describe('U1: recordRefs of a fresh entry against the base', () => {
    const world = makeWorld()

    test('the long chat spans several chunks (fixture precondition)', () => {
        expect(world.base.entry.chats[0].chunks.length).toBeGreaterThanOrEqual(3)
    })

    test('no edit: no record differs', () => {
        const mine = mineOf(world)
        expect(changedRecords(recordRefs(world.base.entry), recordRefs(mine.entry)).size).toBe(0)
    })

    test.each(EDITS)('an edit of $id gives exactly that record', ({ id, mutate }) => {
        const mine = mineOf(world, mutate)
        expect([...changedRecords(recordRefs(world.base.entry), recordRefs(mine.entry))]).toEqual([id])
    })

    test('a middle message of the long chat gives exactly its chat record', () => {
        const cid = world.base.entry.chats[0].cid
        const index = firstMessageOfChunk(world.base.entry, 0, 1) + 1
        const mine = mineOf(world, (slot) => { messages(slot, 0)[index].data = 'edited middle message' })
        expect([...changedRecords(recordRefs(world.base.entry), recordRefs(mine.entry))]).toEqual([`chat:${cid}`])
    })

    test('an alternatives record gives exactly its chat record', () => {
        const cid = world.base.entry.chats[1].cid
        const mine = mineOf(world, (slot) => { ((chats(slot)[1].alt as Obj[])[0].m as Obj).data = 'edited alternative' })
        expect([...changedRecords(recordRefs(world.base.entry), recordRefs(mine.entry))]).toEqual([`chat:${cid}`])
    })

    test('two edits give both records', () => {
        const mine = mineOf(world, (slot) => {
            EDITS[0].mutate(slot)
            EDITS[1].mutate(slot)
        })
        expect([...changedRecords(recordRefs(world.base.entry), recordRefs(mine.entry))].sort()).toEqual(['core', 'lore'])
    })

    test('the shown chat is a view record by chat id, apart from the chat list', () => {
        const mine = mineOf(world, (slot) => { slot.chatPage = 1 })
        const changed = changedRecords(recordRefs(world.base.entry), recordRefs(mine.entry))
        expect([...changed]).toEqual(['view'])
    })
})

describe('U2: freshEntry answers unknown where verdictBaseOf is null', () => {
    const world = makeWorld()

    test('a stub is unknown', () => {
        const stub = liveOf(world, (slot) => { slot.coldstorage = world.u })
        expect(freshEntry(stub, world.options)).toBe('unknown')
    })

    test('a chaId the acknowledged encoding does not hold is unknown', () => {
        expect(freshEntry(liveOf(world, (slot) => { slot.chaId = 'held-by-nobody' }), world.options)).toBe('unknown')
    })

    test('a shared chaId is unknown', () => {
        const previous: PreviousEncoding = { ...world.previous, entities: new Map(world.previous.entities).set(`${String(((world.assembled.characters as Obj[])[0]).chaId)}#1`, 'second-holder') }
        expect(freshEntry(liveOf(world), { ...world.options, previous })).toBe('unknown')
    })

    test('a unit without a digest is unknown', () => {
        const units = new Map(world.previous.units)
        const core = `char:${world.u}:core`
        const unit = units.get(core)
        if (unit === undefined) {
            throw new Error('missing core unit')
        }
        units.set(core, { key: unit.key, type: unit.type, ref: unit.ref })
        expect(freshEntry(liveOf(world), { ...world.options, previous: { ...world.previous, units } })).toBe('unknown')
    })

    test('a character that cannot be read is unknown', () => {
        const slot = liveOf(world)
        Object.defineProperty(slot, 'personality', { get() { throw new Error('unreadable') }, enumerable: true })
        expect(freshEntry(slot, world.options)).toBe('unknown')
    })

    test('a character that cannot be encoded is unknown (a CodecError)', () => {
        const slot = liveOf(world, (live) => { live.chats = [{ ...chats(live)[0], message: 'not-a-list' }] })
        expect(freshEntry(slot, world.options)).toBe('unknown')
    })

    test('the same character answers an entry and the digest of every unit it names', () => {
        const fresh = freshEntry(liveOf(world), world.options)
        expect(fresh).not.toBe('unknown')
        if (fresh === 'unknown') {
            return
        }
        expect(fresh.diverged.size).toBe(0)
        expect(fresh.entry.core).toEqual(world.base.entry.core)
        expect(fresh.digests.size).toBeGreaterThan(0)
    })

    test('the collecting sink lists every differing identity, not only the first', () => {
        const fresh = freshEntry(liveOf(world, (slot) => { EDITS[0].mutate(slot); EDITS[1].mutate(slot) }), world.options)
        if (fresh === 'unknown') {
            throw new Error('unknown')
        }
        expect([...fresh.diverged].sort()).toEqual([`char:${world.u}:core`, `char:${world.u}:lore`])
    })
})

describe('U3: a chat on one side only is a changed record', () => {
    const world = makeWorld()

    test('a chat added here and a chat removed here', () => {
        const added = mineOf(world, (slot) => { chats(slot).push({ ...clone(chats(slot)[1]), id: 'added-chat-id', name: 'Added' }) })
        const addedCid = added.entry.chats[2].cid
        expect([...changedRecords(recordRefs(world.base.entry), recordRefs(added.entry))].sort()).toEqual(['chatList', `chat:${addedCid}`].sort())
        const removed = mineOf(world, (slot) => { chats(slot).pop() })
        expect([...changedRecords(recordRefs(world.base.entry), recordRefs(removed.entry))].sort())
            .toEqual(['chatList', `chat:${world.base.entry.chats[1].cid}`].sort())
    })
})

describe('U4: theirs per record from entry Refs', () => {
    const world = makeWorld()

    test.each(EDITS)('a peer edit of $id gives exactly that record', ({ id, mutate }) => {
        const theirs = theirsOf(world, mutate)
        expect([...changedRecords(recordRefs(world.base.entry), recordRefs(theirs.entry))]).toEqual([id])
    })

    test('a peer edit of an alternatives record gives its chat record', () => {
        const cid = world.base.entry.chats[1].cid
        const theirs = theirsOf(world, (slot) => { ((chats(slot)[1].alt as Obj[])[0].m as Obj).data = 'peer alternative' })
        expect([...changedRecords(recordRefs(world.base.entry), recordRefs(theirs.entry))]).toEqual([`chat:${cid}`])
    })

    test('a peer change of only the asset or inlay list Refs is no record', () => {
        const entry: ShardEntry = clone(world.base.entry)
        entry.al = [`${entry.al[0]}-other`, entry.al[1] + 1, entry.al[2], ...entry.al.slice(3)] as ShardEntry['al']
        entry.il = null
        expect(changedRecords(recordRefs(world.base.entry), recordRefs(entry)).size).toBe(0)
    })
})

describe('U5: firstMsgIndex counts as core on both sides', () => {
    const world = makeWorld()

    test('here', () => {
        const mine = mineOf(world, (slot) => { slot.firstMsgIndex = 2 })
        expect([...changedRecords(recordRefs(world.base.entry), recordRefs(mine.entry))]).toEqual(['core'])
    })

    test('there', () => {
        const theirs = theirsOf(world, (slot) => { slot.firstMsgIndex = 3 })
        expect([...changedRecords(recordRefs(world.base.entry), recordRefs(theirs.entry))]).toEqual(['core'])
    })

    test('the same index on both sides is the same fingerprint', () => {
        const mine = mineOf(world, (slot) => { slot.firstMsgIndex = 2 })
        const theirs = theirsOf(world, (slot) => { slot.firstMsgIndex = 2 })
        const result = classifyCharacterRecords({ base: world.base, mine, theirs })
        expect(result.decisions).toEqual([{ id: 'core', kind: 'keep', agreed: true }])
    })
})

describe('U6: the whole fallback', () => {
    const world = makeWorld()

    test('a plain character is not whole', () => {
        expect(isWholeEntry(world.base.entry)).toBe(false)
        expect([...recordRefs(world.base.entry).keys()]).toContain('chat:' + world.base.entry.chats[0].cid)
    })

    test('an empty chat id makes the character one record', () => {
        const mine = mineOf(world, (slot) => { delete chats(slot)[0].id })
        expect(isWholeEntry(mine.entry)).toBe(true)
        expect([...recordRefs(mine.entry).keys()]).toEqual(['whole'])
    })

    test('a repeated chat id makes the character one record', () => {
        const mine = mineOf(world, (slot) => { chats(slot)[1].id = chats(slot)[0].id })
        expect(isWholeEntry(mine.entry)).toBe(true)
        expect([...recordRefs(mine.entry).keys()]).toEqual(['whole'])
    })

    test('a hand-built entry with two equal chat ids is rejected as a whole record', () => {
        const entry: ShardEntry = clone(world.base.entry)
        entry.chats[1].cid = entry.chats[0].cid
        expect(entry.chats[0].cid.startsWith('~')).toBe(false)
        expect(isWholeEntry(entry)).toBe(true)
    })

    test('a ~index handle makes the character one record', () => {
        const entry: ShardEntry = clone(world.base.entry)
        entry.chats[0].cid = '~0'
        expect(isWholeEntry(entry)).toBe(true)
    })

    test('a core that holds a moved field in f makes the character one record', () => {
        const mine = mineOf(world, (slot) => { slot.lastInteraction = 'not-a-number' })
        expect(mine.splitCore).toBe(true)
        expect([...recordRefs(mine.entry, { splitCore: mine.splitCore }).keys()]).toEqual(['whole'])
    })

    test('a core with an absent list makes the character one record', () => {
        const mine = mineOf(world, (slot) => { delete slot.chatPage })
        expect(mine.splitCore).toBe(true)
    })

    test('a peer-only change of a whole character is a whole take, both sides changing is one whole conflict', () => {
        const wholeWorld = makeWorld((() => {
            const db = profile()
            delete (((db as unknown as Obj).characters as Obj[])[0].chats as Obj[])[0].id
            return db
        })())
        expect(isWholeEntry(wholeWorld.base.entry)).toBe(true)
        const theirs = theirsOf(wholeWorld, (slot) => { slot.personality = 'peer' })
        const take = classifyCharacterRecords({ base: wholeWorld.base, mine: mineOf(wholeWorld), theirs })
        expect(take.decisions).toEqual([{ id: 'whole', kind: 'take' }])
        const both = classifyCharacterRecords({
            base: wholeWorld.base, mine: mineOf(wholeWorld, (slot) => { slot.scenario = 'mine' }), theirs,
        })
        expect(both.decisions).toEqual([{ id: 'whole', kind: 'conflict', conflict: 'both' }])
    })
})

describe('U8: assembleChatEntry', () => {
    test('equals the chat assembleCharacter builds, for every chat', () => {
        const first = encodeWith(profile())
        const previous = previousFrom(first)
        const source = unitMapSource(first.units)
        const chaId = String((((assembleDatabase(first.manifest, source) as unknown as Obj).characters as Obj[])[0]).chaId)
        const u = previous.entities.get(`${chaId}#0`)
        const entry = u === undefined ? undefined : previousEntryOf(previous, u)
        if (entry === undefined) {
            throw new Error('no entry')
        }
        const whole = assembleCharacter(entry, source)
        expect(entry.chats.length).toBe(2)
        entry.chats.forEach((chatEntry, index) => {
            expect(assembleChatEntry(chatEntry, source, `character ${entry.u} chat ${index}`)).toEqual((whole.chats as Obj[])[index])
        })
    })
})

describe('U9: fingerprints', () => {
    const world = makeWorld()

    test('equal content gives equal fingerprints, one changed unit changes only its record', () => {
        const baseRefs = recordRefs(world.base.entry)
        const mine = mineOf(world, EDITS[0].mutate)
        const mineRefs = recordRefs(mine.entry)
        for (const [id, tokens] of baseRefs) {
            const same = fingerprintOf(tokens, world.base.digestOf) === fingerprintOf(mineRefs.get(id), mine.digestOf)
            expect(same, id).toBe(id !== 'core')
        }
    })

    test('the same content under different keys has the same fingerprint', () => {
        const a = theirsOf(world, EDITS[0].mutate, 11)
        const b = theirsOf(world, EDITS[0].mutate, 12)
        const left = recordRefs(a.entry).get('core')
        const right = recordRefs(b.entry).get('core')
        expect(left).not.toEqual(right)
        expect(fingerprintOf(left, a.digestOf)).toBe(fingerprintOf(right, b.digestOf))
    })

    test('a peer re-commit that reuses keys keeps the fingerprint stable', () => {
        const a = theirsOf(world, EDITS[1].mutate, 11)
        const b = theirsOf(world, (slot) => { EDITS[1].mutate(slot) }, 13)
        for (const [id, tokens] of recordRefs(a.entry)) {
            expect(fingerprintOf(tokens, a.digestOf), id).toBe(fingerprintOf(recordRefs(b.entry).get(id), b.digestOf))
        }
    })

    test('an unknown digest stands for the key, and an absent record has its own fingerprint', () => {
        expect(fingerprintOf(['k:abc'])).toBe(JSON.stringify(['k:abc']))
        expect(fingerprintOf(undefined)).toBe('absent')
        expect(fingerprintOf(['k:abc'], () => 'd1')).not.toBe(fingerprintOf(['k:abc']))
    })
})
