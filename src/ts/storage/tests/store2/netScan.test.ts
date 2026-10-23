// @vitest-environment node
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { proxy } from 'svelte/internal/client'
import { previousFrom, stubFromEntry, type PreviousEncoding } from '../../store2/codec'
import type { ShardEntry } from '../../store2/format'
import { createSaveEncoder, type NetScan, type SaveEncoder } from '../../store2/saveEncoder'
import { residentChaIds } from '../../store2/saveLoop'
import { stubDescription } from '../../../process/coldCharacter'
import type { Database } from '../../database.svelte'
import { asDatabase, buildSmall, encodeWith, fakeLists, mulberry32, seededEnv, type Obj } from './codecFixtures'

/**
 * The idle net's fused pre-check scan (CHORE-205 stage 2c): `SaveEncoder.netScan` against the three calls it replaced,
 * `unheldChaIds`, `stubsNeedFullPass` and `residentChaIds`, as `netDecision` combined them. The outcome of the old calls is
 * one of: a throw, an unheld character, a stub that needs a full pass, or the residents to judge. The properties:
 *   P1 (coverage): where the old calls do not proceed, the scan does not proceed.
 *   P2 (no perpetual full ticks): where the old calls proceed, the scan proceeds with the same residents in the same order.
 *   P3: the outcome kind (the exit reason) is the same in every case, a throw included.
 * Titles starting `differential`, `named`, `drift` or `sequence` are guards whose killers are the mutants named in the
 * hand-back; none of them is a regression reproducer (the read-count reproducer is in saveLoopVerdictTick.test.ts).
 */

const NOW = 1_700_000_000_000

beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    vi.restoreAllMocks()
})

function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T
}

const REAL = previousFrom(encodeWith(asDatabase(clone(buildSmall(2)) as unknown as Obj)))
const TEMPLATE: ShardEntry = (() => {
    const first = (REAL.objects?.shards ?? []).flatMap(shard => shard.entries)[0]
    if (first === undefined) {
        throw new Error('The fixture encoding holds no shard entry.')
    }
    return first
})()

/** The notes whose description is not a fixed point of the description function: it changes again when applied to itself. */
const NOTES = ['', 'plain', '# `en`\nintro\n## `foo`\nbar', 'hello\n# `ja`\nfoo # `x`\nbar', '# `en`\na # `en`\nb # `x`\nc']
const MOVING_NOTES = NOTES.filter(notes => stubDescription(stubDescription(notes)) !== stubDescription(notes))

interface EntrySpec {
    id: string
    occurrence: number
    group?: boolean
    patch?: Obj
    /** Keys the entry does not hold at all. */
    without?: readonly string[]
}

function entryFor(spec: EntrySpec, index: number): ShardEntry {
    const loose: Obj = { ...TEMPLATE }
    for (const key of ['image', 'lastInteraction', 'trashTime', 'characters', 'tags', 'creator']) {
        delete loose[key]
    }
    Object.assign(loose, {
        u: String(index + 1).padStart(26, '0'),
        type: spec.group === true ? 'group' : 'character',
        name: `name-${spec.id}-${spec.occurrence}`,
        chaId: spec.id,
        creatorNotes: 'notes',
        image: `img-${spec.id}`,
        lastInteraction: 5,
        trashTime: 7,
        chats: [],
    })
    if (spec.group === true) {
        loose.characters = ['m1', 'm2']
    } else {
        loose.tags = ['t1', 't2']
        loose.creator = 'cr'
    }
    Object.assign(loose, spec.patch ?? {})
    for (const key of spec.without ?? []) {
        delete loose[key]
    }
    return loose as unknown as ShardEntry
}

interface Held {
    previous: PreviousEncoding
    entries: ShardEntry[]
    entryOf(id: string, occurrence?: number): ShardEntry
}

/** An acknowledged encoding that holds exactly the given handles, with the real encoding's units (so its manifest is valid). */
function held(specs: readonly EntrySpec[], objects = true): Held {
    const entries = specs.map((spec, index) => entryFor(spec, index))
    const entities = new Map<string, string>()
    specs.forEach((spec, index) => entities.set(`${spec.id}#${spec.occurrence}`, entries[index].u))
    const previous: PreviousEncoding = objects
        ? { units: REAL.units, entities, objects: { shards: [{ v: 1, entries }] } }
        : { units: REAL.units, entities }
    return {
        previous,
        entries,
        entryOf(id, occurrence = 0) {
            const found = entries.find(entry => entry.chaId === id && entities.get(`${id}#${occurrence}`) === entry.u)
            if (found === undefined) {
                throw new Error(`The fixture holds no ${id}#${occurrence}.`)
            }
            return found
        },
    }
}

function stubOf(entry: ShardEntry, edit: (stub: Obj) => void = () => {}): Obj {
    const stub = stubFromEntry(entry) as unknown as Obj
    edit(stub)
    return stub
}

function resident(chaId: string, extra: Obj = {}): Obj {
    return { chaId, name: `resident-${chaId}`, ...extra }
}

type Outcome = { kind: 'throw' | 'unheld' | 'stub' } | { kind: 'proceed', residents: string[] }

function encoderOver(previous: PreviousEncoding): SaveEncoder {
    return createSaveEncoder({ previous, lists: fakeLists, env: seededEnv(5), now: () => NOW })
}

/** What `netDecision` did with the three old calls. */
function oldOutcome(encoder: SaveEncoder, db: Database): Outcome {
    let unheld: boolean
    try {
        unheld = encoder.unheldChaIds(db).length > 0
    } catch {
        return { kind: 'throw' }
    }
    if (unheld) {
        return { kind: 'unheld' }
    }
    if (encoder.stubsNeedFullPass(db)) {
        return { kind: 'stub' }
    }
    try {
        return { kind: 'proceed', residents: residentChaIds(db) }
    } catch {
        return { kind: 'throw' }
    }
}

function scanOutcome(encoder: SaveEncoder, db: Database): Outcome {
    let scan: NetScan
    try {
        scan = encoder.netScan(db)
    } catch {
        return { kind: 'throw' }
    }
    if (scan.unheld) {
        return { kind: 'unheld' }
    }
    if (scan.stubsNeedFull) {
        return { kind: 'stub' }
    }
    return { kind: 'proceed', residents: scan.residents }
}

function violations(old: Outcome, scan: Outcome): string[] {
    const out: string[] = []
    if (old.kind !== 'proceed' && scan.kind === 'proceed') {
        out.push('P1')
    }
    if (old.kind === 'proceed' && (scan.kind !== 'proceed' || JSON.stringify(old.residents) !== JSON.stringify(scan.residents))) {
        out.push('P2')
    }
    if (old.kind !== scan.kind) {
        out.push('P3')
    }
    return out
}

/** Runs both over a list as plain objects and as a real Svelte proxy, and returns the old outcome after asserting no violation. */
function agree(characters: unknown[], previous: PreviousEncoding): Outcome {
    let first: Outcome | null = null
    for (const wrap of [(list: unknown[]) => list, (list: unknown[]) => proxy(list)]) {
        const db = asDatabase({ characters: wrap(characters) })
        const encoder = encoderOver(previous)
        const old = oldOutcome(encoder, db)
        expect(violations(old, scanOutcome(encoder, db))).toEqual([])
        first ??= old
    }
    return first as Outcome
}

describe('named cases: the scan answers as the three old calls did', () => {
    const base = () => held([{ id: 'a', occurrence: 0 }, { id: 'b', occurrence: 0, group: true }, { id: 'c', occurrence: 0 }])
    const stubs = (h: Held, edit: (stubs: Obj[]) => void = () => {}): Obj[] => {
        const list = [stubOf(h.entryOf('a')), stubOf(h.entryOf('b')), stubOf(h.entryOf('c'))]
        edit(list)
        return list
    }

    const cases: Array<{ name: string, expected: Outcome['kind'], build: () => { characters: unknown[], previous: PreviousEncoding } }> = [
        {
            name: 'stubs the entries stand for need nothing',
            expected: 'proceed',
            build: () => { const h = base(); return { characters: stubs(h), previous: h.previous } },
        },
        {
            name: 'a held resident beside stubs is a resident to judge',
            expected: 'proceed',
            build: () => { const h = base(); return { characters: [stubOf(h.entryOf('a')), resident('b'), stubOf(h.entryOf('c'))], previous: h.previous } },
        },
        {
            name: 'an empty list and a list of holes',
            expected: 'proceed',
            build: () => ({ characters: [null, 7, 'x', undefined], previous: base().previous }),
        },
        {
            name: 'a renamed stub',
            expected: 'stub',
            build: () => { const h = base(); return { characters: stubs(h, (s) => { s[0].name = 'renamed' }), previous: h.previous } },
        },
        {
            name: 'a non-string name keeps the entry name',
            expected: 'proceed',
            build: () => { const h = base(); return { characters: stubs(h, (s) => { s[0].name = 42 }), previous: h.previous } },
        },
        {
            name: 'a non-string name on an entry with no name',
            expected: 'stub',
            build: () => {
                const h = held([{ id: 'a', occurrence: 0, without: ['name'] }])
                return { characters: [stubOf(h.entryOf('a'), (s) => { s.name = 42 })], previous: h.previous }
            },
        },
        {
            name: 'an image removed from the stub',
            expected: 'stub',
            build: () => { const h = base(); return { characters: stubs(h, (s) => { delete s[0].image }), previous: h.previous } },
        },
        {
            name: 'a non-string image on an entry that holds an image',
            expected: 'stub',
            build: () => { const h = base(); return { characters: stubs(h, (s) => { s[0].image = 5 }), previous: h.previous } },
        },
        {
            name: 'a non-string image on an entry with no image',
            expected: 'proceed',
            build: () => {
                const h = held([{ id: 'a', occurrence: 0, without: ['image'] }])
                return { characters: [stubOf(h.entryOf('a'), (s) => { s.image = 5 })], previous: h.previous }
            },
        },
        {
            name: 'an image added to a stub whose entry has none',
            expected: 'stub',
            build: () => {
                const h = held([{ id: 'a', occurrence: 0, without: ['image'] }])
                return { characters: [stubOf(h.entryOf('a'), (s) => { s.image = 'new.png' })], previous: h.previous }
            },
        },
        {
            name: 'creatorNotes that are not a string describe as empty',
            expected: 'stub',
            build: () => { const h = base(); return { characters: stubs(h, (s) => { s[0].creatorNotes = { x: 1 } }), previous: h.previous } },
        },
        {
            name: 'non-string creatorNotes against an entry that holds the empty description',
            expected: 'proceed',
            build: () => {
                const h = held([{ id: 'a', occurrence: 0, patch: { creatorNotes: '' } }])
                return { characters: [stubOf(h.entryOf('a'), (s) => { s.creatorNotes = { x: 1 } })], previous: h.previous }
            },
        },
        {
            name: 'creatorNotes edited',
            expected: 'stub',
            build: () => { const h = base(); return { characters: stubs(h, (s) => { s[0].creatorNotes = 'edited' }), previous: h.previous } },
        },
        {
            name: 'an entry with no creatorNotes key',
            expected: 'stub',
            build: () => {
                const h = held([{ id: 'a', occurrence: 0, without: ['creatorNotes'] }])
                return { characters: [stubOf(h.entryOf('a'), (s) => { s.creatorNotes = '' })], previous: h.previous }
            },
        },
        {
            name: 'NaN lastInteraction equals itself',
            expected: 'proceed',
            build: () => {
                const h = held([{ id: 'a', occurrence: 0, patch: { lastInteraction: NaN } }])
                return { characters: [stubOf(h.entryOf('a'))], previous: h.previous }
            },
        },
        {
            name: 'negative zero is not zero (stub side)',
            expected: 'stub',
            build: () => {
                const h = held([{ id: 'a', occurrence: 0, patch: { lastInteraction: 0 } }])
                return { characters: [stubOf(h.entryOf('a'), (s) => { s.lastInteraction = -0 })], previous: h.previous }
            },
        },
        {
            name: 'negative zero is not zero (entry side)',
            expected: 'stub',
            build: () => {
                const h = held([{ id: 'a', occurrence: 0, patch: { lastInteraction: -0 } }])
                return { characters: [stubOf(h.entryOf('a'), (s) => { s.lastInteraction = 0 })], previous: h.previous }
            },
        },
        {
            name: 'lastInteraction removed or turned into text',
            expected: 'stub',
            build: () => { const h = base(); return { characters: stubs(h, (s) => { s[0].lastInteraction = '5' }), previous: h.previous } },
        },
        {
            name: 'trashTime removed',
            expected: 'stub',
            build: () => { const h = base(); return { characters: stubs(h, (s) => { delete s[0].trashTime }), previous: h.previous } },
        },
        {
            name: 'trashTime added where the entry holds none',
            expected: 'stub',
            build: () => {
                const h = held([{ id: 'a', occurrence: 0, without: ['trashTime'] }])
                return { characters: [stubOf(h.entryOf('a'), (s) => { s.trashTime = 9 })], previous: h.previous }
            },
        },
        {
            name: 'a character stub turned into a group: the live type picks the group fields (entry type would not)',
            expected: 'proceed',
            build: () => {
                const h = held([{ id: 'a', occurrence: 0, patch: { characters: ['m1'] } }])
                return { characters: [stubOf(h.entryOf('a'), (s) => { s.type = 'group'; s.characters = ['m1']; s.tags = ['zzz'] })], previous: h.previous }
            },
        },
        {
            name: 'a group stub turned into a character: the live type picks tags and creator (entry type would not)',
            expected: 'stub',
            build: () => {
                const h = held([{ id: 'b', occurrence: 0, group: true }])
                return { characters: [stubOf(h.entryOf('b'), (s) => { s.type = 'character'; s.tags = ['t'] })], previous: h.previous }
            },
        },
        {
            name: 'a group member edit and a member removed',
            expected: 'stub',
            build: () => { const h = base(); return { characters: stubs(h, (s) => { s[1].characters = ['m1', 'm3'] }), previous: h.previous } },
        },
        {
            name: 'group members that are not strings are dropped before the compare',
            expected: 'proceed',
            build: () => { const h = base(); return { characters: stubs(h, (s) => { s[1].characters = ['m1', 3, 'm2', null] }), previous: h.previous } },
        },
        {
            name: 'a group whose entry holds no characters',
            expected: 'stub',
            build: () => {
                const h = held([{ id: 'b', occurrence: 0, group: true, without: ['characters'] }])
                return { characters: [stubOf(h.entryOf('b'), (s) => { s.characters = [] })], previous: h.previous }
            },
        },
        {
            name: 'tags in another order',
            expected: 'stub',
            build: () => { const h = base(); return { characters: stubs(h, (s) => { s[0].tags = ['t2', 't1'] }), previous: h.previous } },
        },
        {
            name: 'tags with a duplicate and an empty string against an entry that holds them',
            expected: 'proceed',
            build: () => {
                const h = held([{ id: 'a', occurrence: 0, patch: { tags: ['t1', 't1', ''] } }])
                return { characters: [stubOf(h.entryOf('a'))], previous: h.previous }
            },
        },
        {
            name: 'a duplicate tag added',
            expected: 'stub',
            build: () => { const h = base(); return { characters: stubs(h, (s) => { s[0].tags = ['t1', 't2', 't2'] }), previous: h.previous } },
        },
        {
            name: 'non-string tags and holes in the tags are dropped',
            expected: 'proceed',
            build: () => {
                const h = base()
                const tags: unknown[] = ['t1', 7, null]
                tags[5] = 't2'
                return { characters: stubs(h, (s) => { s[0].tags = tags }), previous: h.previous }
            },
        },
        {
            name: 'tags that are not a list',
            expected: 'stub',
            build: () => { const h = base(); return { characters: stubs(h, (s) => { s[0].tags = { 0: 't1' } }), previous: h.previous } },
        },
        {
            name: 'an entry with no tags key',
            expected: 'stub',
            build: () => {
                const h = held([{ id: 'a', occurrence: 0, without: ['tags'] }])
                return { characters: [stubOf(h.entryOf('a'), (s) => { s.tags = [] })], previous: h.previous }
            },
        },
        {
            name: 'creator edited',
            expected: 'stub',
            build: () => { const h = base(); return { characters: stubs(h, (s) => { s[0].creator = 'someone' }), previous: h.previous } },
        },
        {
            name: 'an edited additionalData.creator wins over the creator',
            expected: 'stub',
            build: () => { const h = base(); return { characters: stubs(h, (s) => { s[0].additionalData = { creator: 'edited' } }), previous: h.previous } },
        },
        {
            name: 'an empty or non-string additionalData.creator falls back to the creator',
            expected: 'proceed',
            build: () => {
                const h = base()
                return {
                    characters: [
                        stubOf(h.entryOf('a'), (s) => { s.additionalData = { creator: '' } }),
                        stubOf(h.entryOf('b')),
                        stubOf(h.entryOf('c'), (s) => { s.additionalData = { creator: 5 } }),
                    ],
                    previous: h.previous,
                }
            },
        },
        {
            name: 'an additionalData.creator equal to the entry creator',
            expected: 'proceed',
            build: () => { const h = base(); return { characters: stubs(h, (s) => { s[0].additionalData = { creator: 'cr' }; s[0].creator = 'other' }), previous: h.previous } },
        },
        {
            name: 'an entry with no creator key',
            expected: 'stub',
            build: () => {
                const h = held([{ id: 'a', occurrence: 0, without: ['creator'] }])
                return { characters: [stubOf(h.entryOf('a'), (s) => { s.creator = '' })], previous: h.previous }
            },
        },
        {
            name: 'a stub that names another unit',
            expected: 'stub',
            build: () => { const h = base(); return { characters: stubs(h, (s) => { s[0].coldstorage = 'legacy-file' }), previous: h.previous } },
        },
        {
            name: 'a stub whose id no handle holds is also unheld-free: only a stub needing a full pass',
            expected: 'stub',
            build: () => { const h = base(); return { characters: stubs(h, (s) => { s[0].chaId = 'not-held' }), previous: h.previous } },
        },
        {
            name: 'a resident whose coldstorage is falsy is a resident',
            expected: 'proceed',
            build: () => {
                const h = held([{ id: 'a', occurrence: 0 }, { id: 'b', occurrence: 0 }, { id: 'c', occurrence: 0 }])
                return { characters: [resident('a', { coldstorage: '' }), resident('b', { coldstorage: 0 }), resident('c', { coldstorage: null })], previous: h.previous }
            },
        },
        {
            name: 'a stub that needs a full pass placed before an unheld resident is still unheld',
            expected: 'unheld',
            build: () => { const h = base(); return { characters: [stubOf(h.entryOf('a'), (s) => { s.name = 'renamed' }), resident('brand-new')], previous: h.previous } },
        },
        {
            name: 'an unheld resident before a stub that needs a full pass is unheld',
            expected: 'unheld',
            build: () => { const h = base(); return { characters: [resident('brand-new'), stubOf(h.entryOf('a'), (s) => { s.name = 'renamed' })], previous: h.previous } },
        },
        {
            name: 'the #1 handle held for a stub with a single holder needs a full pass',
            expected: 'stub',
            build: () => {
                const h = held([{ id: 'a', occurrence: 0 }, { id: 'a', occurrence: 1 }])
                return { characters: [stubOf(h.entryOf('a'))], previous: h.previous }
            },
        },
        {
            name: 'duplicate residents with the #1 handle held proceed in list order',
            expected: 'proceed',
            build: () => {
                const h = held([{ id: 'a', occurrence: 0 }, { id: 'a', occurrence: 1 }, { id: 'b', occurrence: 0 }])
                return { characters: [resident('a'), resident('b'), resident('a')], previous: h.previous }
            },
        },
        {
            name: 'duplicate residents with the #1 handle not held are unheld',
            expected: 'unheld',
            build: () => {
                const h = held([{ id: 'a', occurrence: 0 }])
                return { characters: [resident('a'), resident('a')], previous: h.previous }
            },
        },
        {
            name: 'a stub before its own duplicate, the duplicate held',
            expected: 'stub',
            build: () => {
                const h = held([{ id: 'a', occurrence: 0 }, { id: 'a', occurrence: 1 }])
                return { characters: [stubOf(h.entryOf('a')), resident('a')], previous: h.previous }
            },
        },
        {
            name: 'a stub before its own duplicate, the duplicate not held',
            expected: 'unheld',
            build: () => {
                const h = held([{ id: 'a', occurrence: 0 }])
                return { characters: [stubOf(h.entryOf('a')), resident('a')], previous: h.previous }
            },
        },
        {
            name: 'a resident before the stub of its id, the second handle not held',
            expected: 'stub',
            build: () => {
                const h = held([{ id: 'a', occurrence: 0 }, { id: 'a', occurrence: 1 }])
                return { characters: [resident('a'), stubOf(h.entryOf('a', 1))], previous: h.previous }
            },
        },
        {
            name: 'a stub whose id is held once but sits second: its occurrence is the count of object slots before it',
            expected: 'stub',
            build: () => {
                const h = held([{ id: 'a', occurrence: 0 }, { id: 'b', occurrence: 0 }])
                return { characters: [null, resident('b'), stubOf(h.entryOf('a'), (s) => { s.name = 'renamed' })], previous: h.previous }
            },
        },
        {
            name: 'holes (null, a number, a string) between held slots do not move the occurrence',
            expected: 'proceed',
            build: () => {
                const h = held([{ id: 'a', occurrence: 0 }, { id: 'a', occurrence: 1 }])
                return { characters: [resident('a'), null, 7, 'x', resident('a')], previous: h.previous }
            },
        },
        {
            name: 'an array slot is a resident with the empty id, held',
            expected: 'proceed',
            build: () => {
                const h = held([{ id: '', occurrence: 0 }, { id: 'a', occurrence: 0 }])
                return { characters: [[], resident('a')], previous: h.previous }
            },
        },
        {
            name: 'an array slot is a resident with the empty id, not held',
            expected: 'unheld',
            build: () => {
                const h = held([{ id: 'a', occurrence: 0 }])
                return { characters: [resident('a'), []], previous: h.previous }
            },
        },
        {
            name: 'an array slot counts toward the occurrence of the empty id',
            expected: 'unheld',
            build: () => {
                const h = held([{ id: '', occurrence: 0 }])
                return { characters: [[], resident('')], previous: h.previous }
            },
        },
        {
            name: 'a resident without a chaId is the empty id',
            expected: 'proceed',
            build: () => {
                const h = held([{ id: '', occurrence: 0 }])
                return { characters: [{ name: 'no id' }], previous: h.previous }
            },
        },
        {
            name: 'previous.objects undefined and no stub: nothing builds the entries map',
            expected: 'proceed',
            build: () => {
                const h = held([{ id: 'a', occurrence: 0 }], false)
                return { characters: [resident('a')], previous: h.previous }
            },
        },
        {
            name: 'previous.objects undefined with a stub: the fault of the map answers a full pass',
            expected: 'stub',
            build: () => {
                const h = held([{ id: 'a', occurrence: 0 }])
                const without: PreviousEncoding = { units: h.previous.units, entities: h.previous.entities }
                return { characters: [stubOf(h.entryOf('a'))], previous: without }
            },
        },
        {
            name: 'a stub whose entry the shards no longer hold',
            expected: 'stub',
            build: () => {
                const h = held([{ id: 'a', occurrence: 0 }])
                const thin: PreviousEncoding = { ...h.previous, objects: { shards: [{ v: 1, entries: [] }] } }
                return { characters: [stubOf(h.entryOf('a'))], previous: thin }
            },
        },
        {
            name: 'a getter that throws on a stub name answers a full pass',
            expected: 'stub',
            build: () => {
                const h = base()
                return { characters: stubs(h, (s) => { Object.defineProperty(s[0], 'name', { enumerable: true, get() { throw new Error('getter name') } }) }), previous: h.previous }
            },
        },
        {
            name: 'a getter that throws on a stub tags answers a full pass',
            expected: 'stub',
            build: () => {
                const h = base()
                return { characters: stubs(h, (s) => { Object.defineProperty(s[2], 'tags', { enumerable: true, get() { throw new Error('getter tags') } }) }), previous: h.previous }
            },
        },
        {
            name: 'a getter that throws on a resident field the scan never reads is no fault',
            expected: 'proceed',
            build: () => {
                const h = held([{ id: 'a', occurrence: 0 }])
                const r = resident('a')
                Object.defineProperty(r, 'name', { enumerable: true, get() { throw new Error('getter name') } })
                return { characters: [r], previous: h.previous }
            },
        },
        {
            name: 'a getter that throws on a chaId propagates',
            expected: 'throw',
            build: () => {
                const h = held([{ id: 'a', occurrence: 0 }])
                const r = resident('a')
                Object.defineProperty(r, 'chaId', { enumerable: true, get() { throw new Error('getter chaId') } })
                return { characters: [r], previous: h.previous }
            },
        },
        {
            name: 'a getter that throws on coldstorage after an unheld slot still propagates (no early stop)',
            expected: 'throw',
            build: () => {
                const h = held([{ id: 'a', occurrence: 0 }])
                const late = resident('a')
                Object.defineProperty(late, 'coldstorage', { enumerable: true, get() { throw new Error('getter coldstorage') } })
                return { characters: [resident('brand-new'), late], previous: h.previous }
            },
        },
    ]

    test.each(cases)('$name', ({ expected, build }) => {
        const { characters, previous } = build()
        expect(agree(characters, previous).kind).toBe(expected)
    })

    test('the duplicate residents answer in list order, repeated', () => {
        const h = held([{ id: 'a', occurrence: 0 }, { id: 'a', occurrence: 1 }, { id: 'b', occurrence: 0 }])
        const db = asDatabase({ characters: [resident('a'), resident('b'), resident('a')] })
        expect(encoderOver(h.previous).netScan(db)).toEqual({ unheld: false, stubsNeedFull: false, residents: ['a', 'b', 'a'] })
    })

    test('a non-array characters value: nothing to check', () => {
        const encoder = encoderOver(held([{ id: 'a', occurrence: 0 }]).previous)
        expect(encoder.netScan(asDatabase({ characters: { 0: resident('a') } }))).toEqual({ unheld: false, stubsNeedFull: false, residents: [] })
    })

    test('the moving notes the corpus uses exist (a description that is not a fixed point)', () => {
        expect(MOVING_NOTES.length).toBeGreaterThan(0)
    })

    test('a stub whose notes are not a fixed point needs a full pass once, then none after the encoding holds the new description', () => {
        for (const notes of MOVING_NOTES) {
            const raw = held([{ id: 'a', occurrence: 0, patch: { creatorNotes: notes } }])
            const stub = stubOf(raw.entryOf('a'))
            const encoder = encoderOver(raw.previous)
            const db = asDatabase({ characters: [stub] })
            // The same encoder twice: a memo that skipped the work after a clean look would answer false the second time.
            expect(encoder.netScan(db).stubsNeedFull).toBe(true)
            expect(encoder.netScan(db).stubsNeedFull).toBe(true)
            expect(encoder.stubsNeedFullPass(db)).toBe(true)
            // The acknowledged entry then holds the description the stub's notes give.
            const acknowledged = held([{ id: 'a', occurrence: 0, patch: { creatorNotes: stubDescription(notes) } }])
            const after = encoderOver(acknowledged.previous)
            expect(after.netScan(db).stubsNeedFull).toBe(false)
            expect(after.stubsNeedFullPass(db)).toBe(false)
        }
    })

    test('sequence: one encoder and one encoding, a clean scan, an edit of the notes, and the next scan needs a full pass', () => {
        const h = held([{ id: 'a', occurrence: 0, patch: { creatorNotes: 'plain' } }])
        const encoder = encoderOver(h.previous)
        const stub = stubOf(h.entryOf('a'))
        const db = asDatabase({ characters: [stub] })
        expect(encoder.netScan(db).stubsNeedFull).toBe(false)
        stub.creatorNotes = 'edited after the clean scan'
        expect(encoder.netScan(db).stubsNeedFull).toBe(true)
        expect(encoder.stubsNeedFullPass(db)).toBe(true)
        stub.creatorNotes = 'plain'
        expect(encoder.netScan(db).stubsNeedFull).toBe(false)
    })

    test('a duplicated stub id answers stubsNeedFull on its own, with the #1 handle not held so that rule cannot fire', () => {
        const h = held([{ id: 'a', occurrence: 0 }])
        const db = asDatabase({ characters: [stubOf(h.entryOf('a')), resident('a')] })
        expect(h.previous.entities.has('a#1')).toBe(false)
        const scan = encoderOver(h.previous).netScan(db)
        expect(scan.stubsNeedFull).toBe(true)
        expect(scan.unheld).toBe(true)
        expect(encoderOver(h.previous).stubsNeedFullPass(db)).toBe(true)
    })

    test('the scan reads nothing of a stub after one needs a full pass, but still reports a later unheld character', () => {
        const h = held([{ id: 'a', occurrence: 0 }, { id: 'c', occurrence: 0 }])
        const reads: string[] = []
        const probe = stubOf(h.entryOf('c'))
        for (const key of ['name', 'creatorNotes', 'image', 'tags']) {
            const value = probe[key]
            Object.defineProperty(probe, key, { enumerable: true, get() { reads.push(key); return value } })
        }
        const db = asDatabase({ characters: [stubOf(h.entryOf('a'), (s) => { s.coldstorage = 'another-unit' }), probe, resident('brand-new')] })
        const scan = encoderOver(h.previous).netScan(db)
        expect(scan.unheld).toBe(true)
        expect(scan.stubsNeedFull).toBe(true)
        expect(reads).toEqual([])
    })
})

describe('drift: every field a stub may change is compared', () => {
    const FIELD_VALUES: unknown[] = ['perturbed', 'other text', 41, -1, NaN, true, null, ['x'], [], { x: 1 }]

    function perturbed(entry: ShardEntry, key: string, value: unknown): Database {
        const stub = stubOf(entry)
        stub[key] = value
        return asDatabase({ characters: [stub] })
    }

    test('perturbing each key of stubFromEntry, and additionalData.creator, is judged as the reference predicate judges it', () => {
        const h = held([{ id: 'a', occurrence: 0 }, { id: 'b', occurrence: 0, group: true }])
        const matters = new Set<string>()
        for (const entry of h.entries) {
            const keys = Object.keys(stubFromEntry(entry))
            for (const key of keys) {
                for (const value of FIELD_VALUES) {
                    const db = perturbed(entry, key, value)
                    const encoder = encoderOver(h.previous)
                    const old = encoder.stubsNeedFullPass(db)
                    expect(encoder.netScan(db).stubsNeedFull, `${entry.type}.${key} = ${String(value)}`).toBe(old)
                    if (old) {
                        matters.add(`${entry.type}.${key}`)
                    }
                }
                // The key removed.
                const stub = stubOf(entry)
                delete stub[key]
                const db = asDatabase({ characters: [stub] })
                const encoder = encoderOver(h.previous)
                expect(encoder.netScan(db).stubsNeedFull, `${entry.type}.${key} removed`).toBe(encoder.stubsNeedFullPass(db))
            }
            const edited = stubOf(entry)
            edited.additionalData = { creator: 'edited elsewhere' }
            const db = asDatabase({ characters: [edited] })
            const encoder = encoderOver(h.previous)
            expect(encoder.netScan(db).stubsNeedFull, `${entry.type}.additionalData.creator`).toBe(encoder.stubsNeedFullPass(db))
            if (encoder.stubsNeedFullPass(db)) {
                matters.add(`${entry.type}.additionalData.creator`)
            }
        }
        // The fields the overlay decides on all show up, so the enumeration is not vacuous.
        for (const field of ['name', 'image', 'creatorNotes', 'lastInteraction', 'trashTime', 'tags', 'creator', 'additionalData.creator']) {
            expect(matters.has(`character.${field}`), `character.${field}`).toBe(true)
        }
        expect(matters.has('group.characters')).toBe(true)
    })
})

const IDS = ['a', 'b', 'c', '']
const FIELDS = ['chaId', 'coldstorage', 'name', 'creatorNotes', 'image', 'lastInteraction', 'trashTime', 'type', 'characters', 'tags', 'creator', 'additionalData']

interface RandomCase {
    previous: PreviousEncoding
    characters: unknown
    threw: boolean
    proxied: boolean
}

function randomCase(rng: () => number): RandomCase {
    const pick = <T>(list: readonly T[]): T => list[Math.floor(rng() * list.length)]
    const specs: EntrySpec[] = []
    for (const id of IDS) {
        for (let occurrence = 0; occurrence < 2; occurrence++) {
            if (rng() >= (occurrence === 0 ? 0.85 : 0.2)) {
                continue
            }
            const group = rng() < 0.3
            const patch: Obj = { creatorNotes: rng() < 0.7 ? stubDescription(pick(NOTES)) : pick(NOTES) }
            if (rng() < 0.5) { patch.image = `img-${specs.length}` }
            if (rng() < 0.6) { patch.lastInteraction = pick([1, 2, NaN, -0, 0]) }
            if (rng() < 0.2) { patch.trashTime = pick([5, 6]) }
            if (group) {
                patch.characters = pick([[], ['x'], ['x', 'y']])
            } else {
                patch.tags = pick([[], ['t'], ['t', 't', ''], ['u', 't']])
                patch.creator = pick(['', 'cr', 'ed'])
            }
            const without: string[] = []
            for (const key of ['image', 'lastInteraction', 'trashTime', 'tags', 'characters', 'creator']) {
                if (rng() < 0.08) { without.push(key) }
            }
            if (rng() < 0.05) { without.push('name') }
            if (rng() < 0.05) { without.push('creatorNotes') }
            specs.push({ id, occurrence, group, patch, without })
        }
    }
    const objects = rng() > 0.15
    const h = held(specs, objects)
    const slots: unknown[] = []
    const seen = new Map<string, number>()
    const length = Math.floor(rng() * 7)
    for (let index = 0; index < length; index++) {
        const roll = rng()
        if (roll < 0.06) { slots.push(pick([null, 7, 'x', undefined])); continue }
        if (roll < 0.09) { slots.push([]); continue }
        const id = pick(IDS)
        const occurrence = seen.get(id) ?? 0
        seen.set(id, occurrence + 1)
        if (roll < 0.4) { slots.push(resident(id, { coldstorage: pick(['', undefined, 0]) })); continue }
        const entry = h.entries.find(candidate => candidate.u === h.previous.entities.get(`${id}#${occurrence}`)) ?? pick(h.entries.length > 0 ? h.entries : [entryFor({ id, occurrence }, 90)])
        const stub = stubOf(entry)
        stub.chaId = id
        if (rng() < 0.5) {
            const edit = pick(['name', 'name#', 'notes', 'notes#', 'image', 'image-', 'li', 'li-', 'tt', 'type', 'chars', 'chars#', 'tags', 'tags#', 'tagsHole', 'creator', 'ad', 'ad0', 'cs', 'csl'])
            if (edit === 'name') { stub.name = 'changed' }
            if (edit === 'name#') { stub.name = 42 }
            if (edit === 'notes') { stub.creatorNotes = pick(NOTES) }
            if (edit === 'notes#') { stub.creatorNotes = { x: 1 } }
            if (edit === 'image') { stub.image = pick(['img-0', 'other', 5]) }
            if (edit === 'image-') { delete stub.image }
            if (edit === 'li') { stub.lastInteraction = pick([1, 2, NaN, -0, 0, '1']) }
            if (edit === 'li-') { delete stub.lastInteraction }
            if (edit === 'tt') { stub.trashTime = pick([5, 7, undefined]) }
            if (edit === 'type') { stub.type = stub.type === 'group' ? 'character' : 'group' }
            if (edit === 'chars') { stub.characters = pick([['x'], ['y', 'x'], ['x', 3, 'y'], []]) }
            if (edit === 'chars#') { stub.characters = 'x' }
            if (edit === 'tags') { stub.tags = pick([['t'], ['t', 't', ''], ['t', 3, 't', ''], ['u', 't'], ['t', 'u']]) }
            if (edit === 'tags#') { stub.tags = { 0: 't' } }
            if (edit === 'tagsHole') { const tags: unknown[] = ['t']; tags[3] = 'u'; stub.tags = tags }
            if (edit === 'creator') { stub.creator = pick(['', 'cr', 'ed', 9]) }
            if (edit === 'ad') { stub.additionalData = { creator: pick(['cr', 'ed', 'z']) } }
            if (edit === 'ad0') { stub.additionalData = { creator: '' } }
            if (edit === 'cs') { stub.coldstorage = pick([...h.previous.entities.values(), 'zz']) }
            if (edit === 'csl') { stub.coldstorage = 'legacy-file' }
        }
        slots.push(stub)
    }
    let threw = false
    if (rng() < 0.35) {
        const objects = slots.filter((slot): slot is Obj => typeof slot === 'object' && slot !== null && !Array.isArray(slot))
        if (objects.length > 0) {
            const target = pick(objects)
            const field = pick(FIELDS)
            Object.defineProperty(target, field, { configurable: true, enumerable: true, get() { throw new Error(`getter ${field}`) } })
            threw = true
        }
    }
    const proxied = rng() < 0.3
    const characters = rng() < 0.02 ? { 0: slots[0] } : proxied ? proxy(slots) : slots
    return { previous: h.previous, characters, threw, proxied }
}

describe('differential: the scan against the three old calls over random databases', () => {
    test('P1, P2 and P3 hold in every one of 4000 cases, plain and proxied, throws included', () => {
        const rng = mulberry32(12345)
        const tally = { cases: 0, thrown: 0, proxied: 0, kinds: { throw: 0, unheld: 0, stub: 0, proceed: 0 }, P1: 0, P2: 0, P3: 0 }
        const examples: string[] = []
        for (let index = 0; index < 4000; index++) {
            const made = randomCase(rng)
            const db = asDatabase({ characters: made.characters })
            const encoder = encoderOver(made.previous)
            const old = oldOutcome(encoder, db)
            const scan = scanOutcome(encoder, db)
            tally.cases++
            tally.kinds[old.kind]++
            if (made.threw) { tally.thrown++ }
            if (made.proxied) { tally.proxied++ }
            for (const violation of violations(old, scan)) {
                tally[violation as 'P1' | 'P2' | 'P3']++
                if (examples.length < 5) { examples.push(`case ${index}: ${violation} ${old.kind} -> ${scan.kind}`) }
            }
        }
        expect(examples).toEqual([])
        expect({ P1: tally.P1, P2: tally.P2, P3: tally.P3 }).toEqual({ P1: 0, P2: 0, P3: 0 })
        // The corpus reaches every outcome, throwing getters and proxies, so zero violations is not a vacuous count.
        expect(tally.cases).toBe(4000)
        expect(tally.thrown).toBeGreaterThan(1000)
        expect(tally.proxied).toBeGreaterThan(900)
        for (const kind of ['throw', 'unheld', 'stub', 'proceed'] as const) {
            expect(tally.kinds[kind], kind).toBeGreaterThan(kind === 'throw' ? 100 : 300)
        }
    })
})
