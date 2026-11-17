// @vitest-environment node
import { describe, expect, test } from 'vitest'
import {
    assembleDatabase, freshEntry, previousEntryOf, previousFrom, unitMapSource,
    type EncodedTree, type PreviousEncoding, type VerdictOptions,
} from '../../store2/codec'
import { ENTRY_MOVED_FIELDS } from '../../store2/codec/bodies'
import type { ShardEntry } from '../../store2/format'
import type { character, Database } from '../../database.svelte'
import { classifyCharacterRecords } from '../../store2/fastForward/delta'
import { changedRecords, decideView, mergeChatList, recordRefs, type RecordSide } from '../../store2/fastForward/units'
import {
    asDatabase, bodyIn, buildT5Chat, chat, encodeWith, fakeLists, message, mulberry32, profileWithChats, prosePool, seededEnv, unitOf,
    type Obj,
} from './codecFixtures'

function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T
}

function profile(longCount: number, scripts = false): Database {
    const rng = mulberry32(42)
    const pool = prosePool(rng, 20, 100, 400)
    const small = chat(rng, 1, [message(rng, pool, 0, 200), message(rng, pool, 1, 200)])
    small.alt = [{ m: { role: 'char', data: 'alternative' }, p: null, a: 0 }]
    const long = buildT5Chat(longCount)
    // lastDate is tail state: without it the last chunk holds no `st`.
    delete long.lastDate
    const db = profileWithChats([long, small], 21)
    if (scripts) {
        ;(((db as unknown as Obj).characters as Obj[])[0]).customscript = [{ comment: 'x', in: 'a', out: 'b', type: 'editinput' }]
    }
    return db
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

function makeWorld(db: Database): World {
    const first = encodeWith(db)
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
    return { first, previous, options, assembled, u, base: { entry, splitCore: false, digestOf: key => digests.get(key) } }
}

function mineOf(world: World, mutate: (slot: Obj) => void): RecordSide {
    const db = clone(world.assembled)
    const slot = (db.characters as Obj[])[0]
    mutate(slot)
    const fresh = freshEntry(slot as unknown as character, world.options)
    if (fresh === 'unknown') {
        throw new Error('unknown')
    }
    return { entry: fresh.entry, splitCore: fresh.splitCore, digestOf: key => fresh.digests.get(key) }
}

function theirsOf(world: World, mutate: (slot: Obj) => void, seed = 9): RecordSide {
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

function messages(slot: Obj, chatIndex: number): Obj[] {
    return (slot.chats as Obj[])[chatIndex].message as Obj[]
}

function firstMessageOfChunk(entry: ShardEntry, chatIndex: number, k: number): number {
    return entry.chats[chatIndex].chunks.slice(0, k).reduce((sum, ref) => sum + Number(ref[3]), 0)
}

describe('U1b: two edits of one chat are one record', () => {
    test('mine edits a chunk-0 message, theirs a chunk-2 message: one chat conflict, not two records', () => {
        const world = makeWorld(profile(300))
        const entry = world.base.entry
        expect(entry.chats[0].chunks.length).toBeGreaterThanOrEqual(3)
        const mine = mineOf(world, (slot) => { messages(slot, 0)[0].data = 'mine chunk zero' })
        const theirs = theirsOf(world, (slot) => { messages(slot, 0)[firstMessageOfChunk(entry, 0, 2)].data = 'theirs chunk two' })
        const result = classifyCharacterRecords({ base: world.base, mine, theirs })
        expect(result.decisions).toEqual([{ id: `chat:${entry.chats[0].cid}`, kind: 'conflict', conflict: 'both' }])
    })

    test('disjoint chats do not conflict', () => {
        const world = makeWorld(profile(300))
        const mine = mineOf(world, (slot) => { messages(slot, 0)[0].data = 'mine' })
        const theirs = theirsOf(world, (slot) => { messages(slot, 1)[0].data = 'theirs' })
        const result = classifyCharacterRecords({ base: world.base, mine, theirs })
        expect(result.decisions).toHaveLength(2)
        expect(result.decisions).toContainEqual({ id: `chat:${world.base.entry.chats[0].cid}`, kind: 'keep', agreed: false })
        expect(result.decisions).toContainEqual({ id: `chat:${world.base.entry.chats[1].cid}`, kind: 'take' })
    })
})

describe('U1c to U1e: shape changes are changed records', () => {
    test('U1c: a trailing one-message chunk deleted, no tail state', () => {
        let found: World | undefined
        for (let count = 150; count < 500 && found === undefined; count++) {
            const candidate = makeWorld(profile(count))
            const chunks = candidate.base.entry.chats[0].chunks
            if (chunks.length > 1 && chunks.at(-1)?.[3] === 1) {
                found = candidate
            }
        }
        if (found === undefined) {
            throw new Error('No chat length gives a one-message last chunk.')
        }
        const world = found
        const entry = world.base.entry
        const last = bodyIn(unitOf(world.first, `chat:${world.u}:${entry.chats[0].cid}:chunk:${entry.chats[0].chunks.length - 1}`))
        expect(last.st).toBeUndefined()
        const mine = mineOf(world, (slot) => { messages(slot, 0).pop() })
        expect(mine.entry.chats[0].chunks.length).toBe(entry.chats[0].chunks.length - 1)
        expect([...changedRecords(recordRefs(entry), recordRefs(mine.entry))]).toEqual([`chat:${entry.chats[0].cid}`])
        const theirs = theirsOf(world, (slot) => { messages(slot, 0).push({ role: 'user', data: 'appended', time: 1 }) })
        const result = classifyCharacterRecords({ base: world.base, mine, theirs })
        expect(result.decisions).toEqual([{ id: `chat:${entry.chats[0].cid}`, kind: 'conflict', conflict: 'both' }])
    })

    test('U1d: alt cleared to an empty list', () => {
        const world = makeWorld(profile(40))
        const cid = world.base.entry.chats[1].cid
        expect(world.base.entry.chats[1].alt?.length).toBe(1)
        const mine = mineOf(world, (slot) => { ;((slot.chats as Obj[])[1]).alt = [] })
        expect(mine.entry.chats[1].alt).toBeUndefined()
        expect([...changedRecords(recordRefs(world.base.entry), recordRefs(mine.entry))]).toEqual([`chat:${cid}`])
    })

    test('U1e: every lore field removed, and every script field removed', () => {
        const world = makeWorld(profile(40, true))
        expect(world.base.entry.lore).not.toBeNull()
        expect(world.base.entry.scripts).not.toBeNull()
        const noLore = mineOf(world, (slot) => { delete slot.globalLore })
        expect(noLore.entry.lore).toBeNull()
        expect([...changedRecords(recordRefs(world.base.entry), recordRefs(noLore.entry))]).toEqual(['lore'])
        const noScripts = mineOf(world, (slot) => { delete slot.customscript; delete slot.triggerscript })
        expect(noScripts.entry.scripts).toBeNull()
        expect([...changedRecords(recordRefs(world.base.entry), recordRefs(noScripts.entry))]).toEqual(['scripts'])
    })
})

describe('V1: decideView', () => {
    const baseList = ['a', 'b', 'c']
    const input = { baseList, mineList: baseList, theirsList: baseList, base: 0, mine: 0, theirs: 0, final: baseList }

    test('(a) theirs unchanged: this page keeps its chat', () => {
        expect(decideView({ ...input, mine: 2 })).toEqual({ chatPage: 2, defer: false })
    })

    test('(b) only theirs switched: theirs, deferred while a reply is being written', () => {
        expect(decideView({ ...input, theirs: 1 })).toEqual({ chatPage: 1, defer: false })
        expect(decideView({ ...input, theirs: 1, replyOwner: true })).toEqual({ chatPage: 1, defer: true })
    })

    test('(c) both switched: this page', () => {
        expect(decideView({ ...input, mine: 1, theirs: 2 })).toEqual({ chatPage: 1, defer: false })
    })

    test('(d) the chosen id is gone and theirs survives: theirs', () => {
        expect(decideView({ ...input, mine: 1, theirs: 2, final: ['a', 'c'] })).toEqual({ chatPage: 1, defer: false })
    })

    test('(e) the chosen id and theirs are gone: the first chat', () => {
        expect(decideView({ ...input, mine: 1, theirs: 2, final: ['a', 'x'] })).toEqual({ chatPage: 0, defer: false })
    })

    test('(g) an index out of range is a value of its own', () => {
        expect(decideView({ ...input, base: 7, mine: 7, theirs: 7 })).toEqual({ chatPage: 0, defer: false })
        expect(decideView({ ...input, base: 7, mine: 7, theirs: 1 })).toEqual({ chatPage: 1, defer: false })
    })

    test('the chosen id is found by id in a reordered final list', () => {
        expect(decideView({ ...input, mine: 2, final: ['c', 'a', 'b'] })).toEqual({ chatPage: 0, defer: false })
    })
})

describe('V2: mergeChatList', () => {
    test('(a) a theirs prepend', () => {
        expect(mergeChatList({ base: ['a', 'b'], mine: ['a', 'b'], theirs: ['n', 'a', 'b'] })).toEqual(['n', 'a', 'b'])
    })

    test('(b) a mine-only id goes before its nearest successor', () => {
        expect(mergeChatList({ base: ['a', 'b'], mine: ['a', 'm', 'b'], theirs: ['a', 'b'] })).toEqual(['a', 'm', 'b'])
    })

    test('(c) a front copy stays at the front, and several keep their order', () => {
        expect(mergeChatList({ base: ['a', 'b'], mine: ['m', 'a', 'b'], theirs: ['a', 'b'] })).toEqual(['m', 'a', 'b'])
        expect(mergeChatList({ base: ['a', 'b'], mine: ['m1', 'm2', 'a', 'b'], theirs: ['a', 'b'] })).toEqual(['m1', 'm2', 'a', 'b'])
        expect(mergeChatList({ base: ['a', 'b'], mine: ['m', 'a', 'b'], theirs: ['n', 'a', 'b'] })).toEqual(['n', 'm', 'a', 'b'])
    })

    test('(d) only mine reordered: mine order, theirs-only ids before their successor', () => {
        expect(mergeChatList({ base: ['a', 'b', 'c'], mine: ['c', 'b', 'a'], theirs: ['a', 'n', 'b', 'c'] })).toEqual(['c', 'n', 'b', 'a'])
    })

    test('(e) both reordered: mine order (MC-2055)', () => {
        expect(mergeChatList({ base: ['a', 'b', 'c'], mine: ['c', 'a', 'b'], theirs: ['b', 'c', 'a'] })).toEqual(['c', 'a', 'b'])
    })

    test('(f) one-side removals against unchanged are absent', () => {
        expect(mergeChatList({ base: ['a', 'b', 'c'], mine: ['a', 'b', 'c'], theirs: ['a', 'c'] })).toEqual(['a', 'c'])
        expect(mergeChatList({ base: ['a', 'b', 'c'], mine: ['a', 'c'], theirs: ['a', 'b', 'c'] })).toEqual(['a', 'c'])
    })

    test('(g) an answered conflict id stays at its place', () => {
        expect(mergeChatList({ base: ['a', 'b', 'c'], mine: ['a', 'b', 'c'], theirs: ['a', 'c'], keep: new Set(['b']) })).toEqual(['a', 'b', 'c'])
        expect(mergeChatList({ base: ['a', 'b', 'c'], mine: ['a', 'c'], theirs: ['a', 'b', 'c'], keep: new Set(['b']) })).toEqual(['a', 'b', 'c'])
    })
})

describe('V3: mergeChatList over seeded random triples', () => {
    test('no duplicate, every id of the set once, and the order rules hold', () => {
        const rng = mulberry32(2108)
        const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
        const shuffle = (values: string[]): string[] => {
            const out = [...values]
            for (let i = out.length - 1; i > 0; i--) {
                const j = Math.floor(rng() * (i + 1))
                ;[out[i], out[j]] = [out[j], out[i]]
            }
            return out
        }
        const pick = (values: string[]): string[] => values.filter(() => rng() < 0.7)
        for (let round = 0; round < 200; round++) {
            const base = shuffle(ids).slice(0, 3 + Math.floor(rng() * 4))
            const extra = ids.filter(id => !base.includes(id))
            const edit = (): string[] => {
                const kept = pick(base)
                const added = pick(extra).slice(0, 2)
                return shuffle([...kept, ...added])
            }
            const mine = rng() < 0.4 ? [...base, ...pick(extra).slice(0, 1)] : edit()
            const theirs = rng() < 0.4 ? [...base] : edit()
            const keep = new Set(pick(base).slice(0, 1))
            const out = mergeChatList({ base, mine, theirs, keep })
            expect(new Set(out).size, `${round}`).toBe(out.length)
            const expected = new Set<string>()
            for (const id of [...mine, ...theirs]) {
                if (!base.includes(id) || (mine.includes(id) && theirs.includes(id))) {
                    expected.add(id)
                }
            }
            for (const id of keep) {
                expected.add(id)
            }
            expect([...out].sort(), `${round}`).toEqual([...expected].sort())
            const common = base.filter(id => mine.includes(id) && theirs.includes(id))
            const reordered = (side: string[]): boolean => side.filter(id => common.includes(id)).join() !== common.join()
            const backbone = reordered(mine) ? mine : theirs
            const shared = out.filter(id => backbone.includes(id))
            expect(shared.join(), `${round}`).toBe(backbone.filter(id => out.includes(id)).join())
        }
    })
})
