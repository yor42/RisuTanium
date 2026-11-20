// @vitest-environment node
import { describe, expect, test } from 'vitest'
import {
    CodecAssembleError, encodeScoped, isWrittenUnit, previousFrom, unitMapSource,
    type EncodedTree, type PreviousEncoding,
} from '../../store2/codec'
import { advancePrevious } from '../../store2/fastForward/advancePrevious'
import { previousOfTree, type StoredTree } from '../../store2/previousOfTree'
import type { Database } from '../../database.svelte'
import { asDatabase, buildSmall, encodeWith, fakeLists, mulberry32, seededEnv, storeOf, type Obj } from './codecFixtures'

const NOW = 1_700_000_000_000

function clone(db: Database | Obj): Obj {
    return JSON.parse(JSON.stringify(db)) as Obj
}

/** The tree a peer committed, as the page reads it: the units that tree wrote, nothing else. */
function changedOnly(tree: EncodedTree): StoredTree {
    return { manifestKey: tree.manifestKey, manifest: tree.manifest, source: unitMapSource(tree.units.filter(isWrittenUnit)) }
}

function fullOf(tree: EncodedTree, ...trees: EncodedTree[]): StoredTree {
    return { manifestKey: tree.manifestKey, manifest: tree.manifest, source: storeOf(...trees, tree) }
}

function expectSamePrevious(actual: PreviousEncoding, expected: PreviousEncoding): void {
    expect([...actual.units.keys()].sort()).toEqual([...expected.units.keys()].sort())
    for (const [identity, unit] of expected.units) {
        expect(actual.units.get(identity), identity).toEqual(unit)
    }
    expect(Object.fromEntries(actual.entities)).toEqual(Object.fromEntries(expected.entities))
    expect(actual.objects).toEqual(expected.objects)
}

async function nextTree(previous: EncodedTree, db: Obj, named: string[], seq: number): Promise<EncodedTree> {
    return encodeScoped(
        asDatabase(db),
        { env: seededEnv(seq), lists: fakeLists, seq, createdAt: NOW, previous: previousFrom(previous) },
        { modules: false, characters: new Set(named) },
    )
}

const chaIdAt = (db: Obj, index: number): string => (db.characters as Obj[])[index].chaId as string

/** The loadouts a peer commits, with the fields `makeLoadout` writes. */
function peerLoadouts(): Obj[] {
    return ['one', 'two'].map((id, index) => ({
        name: `Peer ${id}`, id, lastUsed: 1_700_000_000_000 + index, favorite: false, characterIds: [], modules: [],
        globalVariables: {}, presetName: 'Default', presetId: 'preset-1', personaId: 'persona-1', icons: [],
    }))
}

describe('guard (S0-2): advancePrevious of the changed units is the previous of the whole peer tree', () => {
    test('each kind of supported peer change, alone', async () => {
        const kinds: { label: string, edit: (db: Obj) => string[] }[] = [
            { label: 'a character body', edit: (db) => { (db.characters as Obj[])[1].personality = 'edited'; return [chaIdAt(db, 1)] } },
            { label: 'a config field', edit: (db) => { db.ffConfigField = 42; return [] } },
            { label: 'a preset', edit: (db) => { ((db.botPresets as Obj[])[1]).temperature = 999; return [] } },
            { label: 'statics', edit: (db) => { db.statics = { counter: 5 }; return [] } },
            { label: 'loadouts', edit: (db) => { db.loadouts = [{ id: 'one' }]; return [] } },
            { label: 'the character order', edit: (db) => { db.characterOrder = [...(db.characterOrder as string[])].reverse(); return [] } },
            { label: 'a moved field', edit: (db) => { (db.characters as Obj[])[2].lastInteraction = 123; (db.characters as Obj[])[3].chatPage = 1; return [] } },
            { label: 'a preset list longer by one', edit: (db) => { (db.botPresets as Obj[]).push({ ...((db.botPresets as Obj[])[0]), name: 'extra' }); return [] } },
        ]
        for (const kind of kinds) {
            const first = encodeWith(buildSmall(6))
            const db = clone(buildSmall(6))
            const named = kind.edit(db)
            const second = await nextTree(first, db, named, 2)
            const advanced = advancePrevious(previousOfTree(fullOf(first)), changedOnly(second))
            expectSamePrevious(advanced, previousOfTree(fullOf(second, first)))
        }
    })

    test('an added character appends to the order and the shards', async () => {
        const first = encodeWith(buildSmall(6))
        const db = clone(buildSmall(6))
        const extra = clone(buildSmall(7)).characters as Obj[]
        ;(db.characters as Obj[]).push(extra[6])
        ;(db.characterOrder as string[]).push(extra[6].chaId as string)
        const second = await nextTree(first, db, [extra[6].chaId as string], 2)
        const advanced = advancePrevious(previousOfTree(fullOf(first)), changedOnly(second))
        expectSamePrevious(advanced, previousOfTree(fullOf(second, first)))
        expect(advanced.entities.has(`${extra[6].chaId as string}#0`)).toBe(true)
    })

    test('random edit sequences, each step advanced from the previous advance', async () => {
        const rng = mulberry32(4242)
        let db = clone(buildSmall(6))
        const trees: EncodedTree[] = [encodeWith(buildSmall(6))]
        let acc = previousOfTree(fullOf(trees[0]))
        for (let step = 1; step <= 14; step++) {
            db = clone(db)
            const named: string[] = []
            const pick = Math.floor(rng() * 6)
            const index = Math.floor(rng() * 6)
            if (pick === 0) {
                (db.characters as Obj[])[index].personality = `edit ${step}`
                named.push(chaIdAt(db, index))
            } else if (pick === 1) {
                db.ffConfigField = step
            } else if (pick === 2) {
                ((db.botPresets as Obj[])[Math.floor(rng() * 3)]).temperature = step
            } else if (pick === 3) {
                db.statics = { counter: step, [`k${step % 3}`]: step }
            } else if (pick === 4) {
                (db.characters as Obj[])[index].lastInteraction = 1000 + step
            } else {
                db.loadouts = [{ id: `l${step}` }]
            }
            const tree = await nextTree(trees[trees.length - 1], db, named, 2 + step)
            acc = advancePrevious(acc, changedOnly(tree))
            expectSamePrevious(acc, previousOfTree(fullOf(tree, ...trees)))
            trees.push(tree)
        }
    })

    test('the in-memory bodies a pass keeps equal the bodies a stored tree is read into', async () => {
        const first = encodeWith(buildSmall(6))
        const db = clone(buildSmall(6))
        db.statics = { counter: 9 }
        db.loadouts = peerLoadouts()
        ;((db.botPresets as Obj[])[1]).temperature = 7
        const second = await nextTree(first, db, [], 2)
        const read = previousOfTree(fullOf(second, first)).objects
        const kept = previousFrom(second).objects
        expect(kept?.statics).toEqual(read?.statics)
        expect(kept?.loadouts).toEqual(read?.loadouts)
        expect(kept?.loadouts).toEqual(clone({ list: db.loadouts }).list)
        expect(kept?.order).toEqual(read?.order)
        expect(kept?.presets).toEqual(read?.presets)
        expect(kept?.presets?.length).toBe((db.botPresets as Obj[]).length)
    })
})

describe('guard (S0-2): digests', () => {
    test('a unit whose key changed never keeps the old digest, and one whose key held keeps it', async () => {
        const first = encodeWith(buildSmall(6))
        const db = clone(buildSmall(6))
        ;((db.botPresets as Obj[])[1]).temperature = 999
        const second = await nextTree(first, db, [], 2)
        const old = previousOfTree(fullOf(first))
        const advanced = advancePrevious(old, changedOnly(second))
        const changed = [...advanced.units].filter(([identity, unit]) => old.units.get(identity)?.key !== unit.key).map(([identity]) => identity).sort()
        expect(changed).toEqual(['manifest', 'preset:1'])
        for (const identity of changed) {
            expect(advanced.units.get(identity)?.digest, identity).not.toBe(old.units.get(identity)?.digest)
        }
        for (const [identity, unit] of advanced.units) {
            if (!changed.includes(identity)) {
                expect(unit.digest, identity).toBe(old.units.get(identity)?.digest)
            }
        }
    })

    test('a changed unit the source does not hold is carried without a digest, never with the old one', async () => {
        const first = encodeWith(buildSmall(6))
        const db = clone(buildSmall(6))
        ;(db.characters as Obj[])[1].personality = 'edited'
        const second = await nextTree(first, db, [chaIdAt(db, 1)], 2)
        const written = second.units.filter(isWrittenUnit).filter(unit => unit.identity.endsWith(':core'))
        expect(written.length).toBe(1)
        const source = unitMapSource(second.units.filter(isWrittenUnit).filter(unit => unit.identity !== written[0].identity))
        const advanced = advancePrevious(previousOfTree(fullOf(first)), { manifestKey: second.manifestKey, manifest: second.manifest, source })
        const unit = advanced.units.get(written[0].identity)
        expect(unit?.key).toBe(written[0].key)
        expect(unit?.digest).toBeUndefined()
    })
})

describe('F2 and F5 the loadouts body across an advance', () => {
    test('F2 reproducer: after the peer changed loadouts a faulty live list keeps the peer list, not the old one', async () => {
        const first = encodeWith(buildSmall(6))
        const db = clone(buildSmall(6))
        db.loadouts = peerLoadouts()
        const second = await nextTree(first, db, [], 2)
        const advanced = advancePrevious(previousOfTree(fullOf(first)), changedOnly(second))
        expect(advanced.objects?.loadouts).toEqual(clone({ list: db.loadouts }).list)

        const bad = clone(db)
        const cycle: Obj = {}
        cycle.self = cycle
        ;(bad.loadouts as Obj[])[1].cycle = cycle
        const third = await encodeScoped(
            asDatabase(bad),
            { env: seededEnv(3), lists: fakeLists, seq: 3, createdAt: NOW, previous: advanced },
            { modules: false, characters: new Set(), skipUnsavableItems: true },
        )
        expect(third.manifest.fixed.loadouts).toEqual(second.manifest.fixed.loadouts)
        expect(third.index.objects?.loadouts).toEqual(clone({ list: db.loadouts }).list)
        expect(third.units.filter(unit => unit.identity === 'loadouts').every(unit => unit.reused)).toBe(true)
    })

    test('F5 a changed loadouts unit the source does not hold leaves the body unknown and does not throw', async () => {
        const first = encodeWith(buildSmall(6))
        const db = clone(buildSmall(6))
        db.loadouts = peerLoadouts()
        const second = await nextTree(first, db, [], 2)
        const source = unitMapSource(second.units.filter(isWrittenUnit).filter(unit => unit.identity !== 'loadouts'))
        const advanced = advancePrevious(previousOfTree(fullOf(first)), { manifestKey: second.manifestKey, manifest: second.manifest, source })
        expect(advanced.objects?.loadouts).toBeUndefined()
        expect(advanced.units.get('loadouts')?.digest).toBeUndefined()
    })

    test('an unchanged loadouts unit keeps the body the old encoding holds', async () => {
        const first = encodeWith(buildSmall(6))
        const db = clone(buildSmall(6))
        ;(db.characters as Obj[])[1].personality = 'edited'
        const second = await nextTree(first, db, [chaIdAt(db, 1)], 2)
        const old = previousOfTree(fullOf(first))
        const advanced = advancePrevious(old, changedOnly(second))
        expect(advanced.objects?.loadouts).toEqual(old.objects?.loadouts)
        expect(advanced.objects?.loadouts).toBeDefined()
    })
})

describe('guard (S0-2): what the advance refuses', () => {
    test('a changed shard body that was not read throws and builds nothing', async () => {
        const first = encodeWith(buildSmall(6))
        const db = clone(buildSmall(6))
        ;(db.characters as Obj[])[1].personality = 'edited'
        const second = await nextTree(first, db, [chaIdAt(db, 1)], 2)
        const source = unitMapSource(second.units.filter(isWrittenUnit).filter(unit => !unit.identity.startsWith('shard:')))
        expect(() => advancePrevious(previousOfTree(fullOf(first)), { manifestKey: second.manifestKey, manifest: second.manifest, source }))
            .toThrow(CodecAssembleError)
    })

    test('a changed module index throws', async () => {
        const first = encodeWith(buildSmall(6))
        const db = clone(buildSmall(6))
        ;((db.modules as Obj[])[0]).name = 'renamed module'
        const second = await encodeScoped(
            asDatabase(db),
            { env: seededEnv(2), lists: fakeLists, seq: 2, createdAt: NOW, previous: previousFrom(first) },
            { modules: true, characters: new Set() },
        )
        expect(() => advancePrevious(previousOfTree(fullOf(first)), changedOnly(second))).toThrow(CodecAssembleError)
    })

    test('a missing manifest throws', () => {
        const first = encodeWith(buildSmall(6))
        expect(() => advancePrevious(previousOfTree(fullOf(first)), { manifestKey: first.manifestKey, manifest: first.manifest, source: unitMapSource([]) }))
            .toThrow(CodecAssembleError)
    })

    test('an old encoding with no objects throws', () => {
        const first = encodeWith(buildSmall(6))
        const old = previousOfTree(fullOf(first))
        expect(() => advancePrevious({ units: old.units, entities: old.entities }, changedOnly(first))).toThrow(CodecAssembleError)
    })
})
