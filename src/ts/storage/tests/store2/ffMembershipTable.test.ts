// @vitest-environment node
import { describe, expect, test } from 'vitest'
import {
    assembleDatabase, freshEntry, previousEntryOf, previousFrom, unitMapSource,
    type EncodedTree, type PreviousEncoding, type VerdictOptions,
} from '../../store2/codec'
import { ENTRY_MOVED_FIELDS } from '../../store2/codec/bodies'
import type { ShardEntry } from '../../store2/format'
import type { character, Database } from '../../database.svelte'
import {
    decideDeleteRow, editedForDelete, editedThereForDelete, type DeleteEdit, type DeleteRowDecision,
} from '../../store2/fastForward/delta'
import type { RecordSide } from '../../store2/fastForward/units'
import {
    asDatabase, bodyIn, buildT5Chat, chat, encodeWith, fakeLists, message, mulberry32, profileWithChats, prosePool, seededEnv, unitOf,
    type Obj,
} from './codecFixtures'

function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T
}

function profile(trashTime?: number): Database {
    const rng = mulberry32(42)
    const pool = prosePool(rng, 20, 100, 400)
    const small = chat(rng, 1, [message(rng, pool, 0, 200)])
    const db = profileWithChats([buildT5Chat(30), small], 21)
    if (trashTime !== undefined) {
        ;(((db as unknown as Obj).characters as Obj[])[0]).trashTime = trashTime
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

function makeWorld(trashTime?: number): World {
    const first = encodeWith(profile(trashTime))
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

function mineOf(world: World, mutate: (slot: Obj) => void = () => undefined): { side: RecordSide, trashTime: number | undefined } {
    const db = clone(world.assembled)
    const slot = (db.characters as Obj[])[0]
    mutate(slot)
    const fresh = freshEntry(slot as unknown as character, world.options)
    if (fresh === 'unknown') {
        throw new Error('unknown')
    }
    const trashTime = typeof slot.trashTime === 'number' ? slot.trashTime : undefined
    return { side: { entry: fresh.entry, splitCore: fresh.splitCore, digestOf: key => fresh.digests.get(key) }, trashTime }
}

function theirsOf(world: World, mutate: (slot: Obj) => void = () => undefined): RecordSide {
    const db = clone(world.assembled)
    mutate((db.characters as Obj[])[0])
    const tree = encodeWith(asDatabase(db), { env: seededEnv(9), seq: 2, previous: world.previous })
    const entry = previousEntryOf(previousFrom(tree), world.u)
    if (entry === undefined) {
        throw new Error('no entry')
    }
    const core = bodyIn(unitOf(tree, `char:${world.u}:core`), world.first)
    const splitCore = (Array.isArray(core.a) && core.a.length > 0) || Object.keys(core.f as Obj).some(name => (ENTRY_MOVED_FIELDS as readonly string[]).includes(name))
    const digests = digestsOf(world.first, tree)
    return { entry, splitCore, digestOf: key => digests.get(key) }
}

function loadedEdit(world: World, mutate: (slot: Obj) => void): DeleteEdit {
    const mine = mineOf(world, mutate)
    return editedForDelete({ slot: 'loaded', base: world.base, mine: mine.side, liveTrashTime: mine.trashTime })
}

/** The peer removed D and this page holds it: the table's `there` side with D inside the domain. */
function there(edited: DeleteEdit, extra: { resident?: boolean, stub?: boolean, inDomain?: boolean } = {}): DeleteRowDecision {
    return decideDeleteRow({ side: 'there', inDomain: extra.inDomain ?? true, resident: extra.resident ?? false, ...(extra.stub === undefined ? {} : { stub: extra.stub }), edited })
}

function here(edited: DeleteEdit, extra: { resident?: boolean, inDomain?: boolean, changedAtAll?: boolean } = {}): DeleteRowDecision {
    return decideDeleteRow({
        side: 'here', inDomain: extra.inDomain ?? true, resident: extra.resident ?? false, edited, ...(extra.changedAtAll === undefined ? {} : { changedAtAll: extra.changedAtAll }),
    })
}

describe('U7 (a), (b): the peer removed D, this page holds it loaded', () => {
    const world = makeWorld()

    test('(a) a core edit here is a deletedThere row', () => {
        const edit = loadedEdit(world, (slot) => { slot.personality = 'edited' })
        expect(edit).toBe('edited')
        expect(there(edit)).toEqual({ kind: 'row', row: 'deletedThere' })
    })

    test('(a) a chat edit here is a deletedThere row', () => {
        const edit = loadedEdit(world, (slot) => { ((slot.chats as Obj[])[1].message as Obj[])[0].data = 'edited' })
        expect(there(edit)).toEqual({ kind: 'row', row: 'deletedThere' })
    })

    test('(b) a view-only change here is no edit: the removal applies (MC-2058)', () => {
        const edit = loadedEdit(world, (slot) => { slot.chatPage = 1 })
        expect(edit).toBe('unedited')
        expect(there(edit)).toEqual({ kind: 'remove' })
    })

    test('(b) lastInteraction only, or a set trashTime only, is no edit', () => {
        expect(loadedEdit(world, (slot) => { slot.lastInteraction = 99 })).toBe('unedited')
        expect(loadedEdit(world, (slot) => { slot.trashTime = 77 })).toBe('unedited')
        expect(there(loadedEdit(world, (slot) => { slot.trashTime = 77 }))).toEqual({ kind: 'remove' })
    })

    test('a loaded slot whose fresh entry is unknown parks not-append, with no row', () => {
        const edit = editedForDelete({ slot: 'loaded', base: world.base, mine: null, liveTrashTime: undefined })
        expect(edit).toBe('unknown')
        expect(there(edit)).toEqual({ kind: 'park', reason: 'not-append' })
    })
})

describe('U7 (c), (d): this page removed D and the peer holds it', () => {
    const world = makeWorld()

    test('(c) a peer change of the core or of a chat is a deletedHere row', () => {
        for (const mutate of [
            (slot: Obj) => { slot.personality = 'peer' },
            (slot: Obj) => { ((slot.chats as Obj[])[1].message as Obj[])[0].data = 'peer' },
        ]) {
            const edited = editedThereForDelete(world.base, theirsOf(world, mutate))
            expect(edited).toBe(true)
            expect(here(edited ? 'edited' : 'unedited')).toEqual({ kind: 'row', row: 'deletedHere' })
        }
    })

    test('(d) a peer change of only the view, lastInteraction or a set trashTime is no row', () => {
        for (const mutate of [
            (slot: Obj) => { slot.chatPage = 1 },
            (slot: Obj) => { slot.lastInteraction = 99 },
            (slot: Obj) => { slot.trashTime = 77 },
        ]) {
            const edited = editedThereForDelete(world.base, theirsOf(world, mutate))
            expect(edited).toBe(false)
            expect(here(edited ? 'edited' : 'unedited')).toEqual({ kind: 'keep' })
        }
    })

    test('(d) a peer change of only the list Refs is no row', () => {
        const entry: ShardEntry = clone(world.base.entry)
        entry.al = [`${entry.al[0]}-other`, entry.al[1] + 1, entry.al[2], ...entry.al.slice(3)] as ShardEntry['al']
        expect(editedThereForDelete(world.base, { entry })).toBe(false)
    })

    test('a peer change of an entry field (the name) counts conservatively', () => {
        const entry: ShardEntry = clone(world.base.entry)
        entry.name = 'Renamed there'
        expect(editedThereForDelete(world.base, { entry })).toBe(true)
    })
})

describe('U7 (e), (f), (k): a stub that the peer removed', () => {
    test('(e) a stub matching its entry: the removal applies', () => {
        const edit = editedForDelete({ slot: 'stub', stubMatches: true, baseTrashTime: undefined, liveTrashTime: undefined })
        expect(edit).toBe('unedited')
        expect(there(edit, { stub: true })).toEqual({ kind: 'remove' })
    })

    test('(f) a stub that no longer matches parks not-append, with no row', () => {
        const edit = editedForDelete({ slot: 'stub', stubMatches: false, baseTrashTime: undefined, liveTrashTime: undefined })
        expect(edit).toBe('edited')
        expect(there(edit, { stub: true })).toEqual({ kind: 'park', reason: 'not-append' })
    })

    test('(k) a stub matching its entry but restored here parks not-append', () => {
        const edit = editedForDelete({ slot: 'stub', stubMatches: true, baseTrashTime: 500, liveTrashTime: undefined })
        expect(edit).toBe('edited')
        expect(there(edit, { stub: true })).toEqual({ kind: 'park', reason: 'not-append' })
    })

    test('(k) a stub trashed here (set, or changed) stays unedited', () => {
        expect(editedForDelete({ slot: 'stub', stubMatches: true, baseTrashTime: undefined, liveTrashTime: 77 })).toBe('unedited')
        expect(editedForDelete({ slot: 'stub', stubMatches: true, baseTrashTime: 500, liveTrashTime: 600 })).toBe('unedited')
    })
})

describe('U7 (g): a resident id has no delete row on either side', () => {
    test('there: an edited resident parks not-append, an unedited one is removed', () => {
        expect(there('edited', { resident: true })).toEqual({ kind: 'park', reason: 'not-append' })
        expect(there('unedited', { resident: true })).toEqual({ kind: 'remove' })
    })

    test('here: an edited resident parks character-missing, an unedited one keeps this page`s deletion', () => {
        expect(here('edited', { resident: true })).toEqual({ kind: 'park', reason: 'character-missing' })
        expect(here('unedited', { resident: true })).toEqual({ kind: 'keep' })
    })
})

describe('U7 (h): outside the domain no row exists', () => {
    test('there: not-append whatever the edit', () => {
        for (const edit of ['edited', 'unedited', 'unknown'] as const) {
            expect(there(edit, { inDomain: false })).toEqual({ kind: 'park', reason: 'not-append' })
        }
    })

    test('here: character-missing when the peer changed D at all, else this page`s deletion stands', () => {
        expect(here('edited', { inDomain: false, changedAtAll: true })).toEqual({ kind: 'park', reason: 'character-missing' })
        expect(here('unedited', { inDomain: false, changedAtAll: true })).toEqual({ kind: 'park', reason: 'character-missing' })
        expect(here('unedited', { inDomain: false, changedAtAll: false })).toEqual({ kind: 'keep' })
    })
})

describe('U7 (i), (j): a restore from the trash is an edit (Q12)', () => {
    const trashed = makeWorld(500)
    const untrashed = makeWorld()

    test('(i) base trashed, live untrashed, nothing else changed: deletedThere', () => {
        const edit = loadedEdit(trashed, (slot) => { delete slot.trashTime })
        expect(edit).toBe('edited')
        expect(there(edit)).toEqual({ kind: 'row', row: 'deletedThere' })
    })

    test('(i) a trashTime set here, or changed to another time: no row, the removal applies', () => {
        expect(there(loadedEdit(untrashed, (slot) => { slot.trashTime = 77 }))).toEqual({ kind: 'remove' })
        expect(there(loadedEdit(trashed, (slot) => { slot.trashTime = 900 }))).toEqual({ kind: 'remove' })
    })

    test('(j) base trashed, theirs untrashed only, this page removed D: deletedHere', () => {
        const edited = editedThereForDelete(trashed.base, theirsOf(trashed, (slot) => { delete slot.trashTime }))
        expect(edited).toBe(true)
        expect(here(edited ? 'edited' : 'unedited')).toEqual({ kind: 'row', row: 'deletedHere' })
    })

    test('(j) a peer trashTime set or changed: no row, this page`s deletion stands', () => {
        expect(editedThereForDelete(untrashed.base, theirsOf(untrashed, (slot) => { slot.trashTime = 77 }))).toBe(false)
        expect(editedThereForDelete(trashed.base, theirsOf(trashed, (slot) => { slot.trashTime = 900 }))).toBe(false)
    })
})
