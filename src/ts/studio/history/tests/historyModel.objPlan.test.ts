// The object-list planner and its replay routing (S7-0 stage 0b): completion of builder drafts, the all-or-nothing
// plan with its per-run tag rule, and undo, redo, `already` and `dropStep` of obj-only and mixed steps. Rows come from
// the classic producers' golden (`loreClassic.golden.json`).
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { applyReplayMove, commitStep, createModelState, parseOwnerRecord, planReplay, planRestoreDeleted, type LiveReader, type OwnerRecord } from '../historyModel'
import {
    completeObjOps,
    entryAnchor,
    listingEffectOf,
    parseObjOp,
    planObjStep,
    type ObjDraft,
    type ObjEntry,
    type ObjFamilyOp,
    type ObjWrite,
} from '../objectListOps'
import { characterOwnerKey } from '../ownerPhase'

interface Golden {
    blank: { globalLore: ObjEntry[] }
    mixedRows: { globalLore: unknown[] }
    twins: { globalLore: ObjEntry[] }
    wrongKinds: { globalLore: ObjEntry[] }
}
const golden: Golden = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'loreClassic.golden.json'), 'utf8'))
const [ADDED] = golden.blank.globalLore
const [TWIN] = golden.twins.globalLore
const [WRONG_KINDS] = golden.wrongKinds.globalLore

function row(n: number): ObjEntry {
    return { ...ADDED, comment: `Row ${n}`, content: `body ${n}` }
}

// A live character whose lore list is `rows`; `apply` plays the writes a plan returned, as the host writer would.
function world(rows: unknown[], extra: { lorePlus?: boolean } = {}) {
    const state = { rows, lorePlus: extra.lorePlus }
    const live: LiveReader = {
        field: (path) => (path === 'lorePlus' && state.lorePlus !== undefined ? { had: true, value: state.lorePlus } : { had: false }),
        greetings: () => null,
        fmIndex: () => null,
        objList: (list) => (list === 'lore' ? state.rows : null),
        prop: () => ({ had: false }),
    }
    const apply = (writes: readonly unknown[]): void => {
        for (const write of writes as ObjWrite[]) {
            if (write.op === 'objInsert') {
                state.rows.splice(write.index, 0, JSON.parse(JSON.stringify(write.entry)))
            } else if (write.op === 'objRemove') {
                state.rows.splice(write.index, 1)
            } else if (write.op === 'objSet') {
                const el = { ...(state.rows[write.index] as Record<string, unknown>) }
                if (write.value.had) {
                    el[write.field] = write.value.value
                } else {
                    delete el[write.field]
                }
                state.rows[write.index] = el
            }
        }
    }
    return { state, live, apply }
}

function complete(drafts: ObjDraft[], rows: unknown[]): ObjFamilyOp[] {
    const result = completeObjOps(drafts, world(rows).live)
    if (result.ok === false) {
        throw new Error('completion refused: ' + result.reason)
    }
    return result.ops
}

function recordOf(done: unknown[], undone: unknown[] = [], deleted: unknown[] = []): OwnerRecord {
    const parsed = parseOwnerRecord(JSON.parse(JSON.stringify({ ownerKey: characterOwnerKey('c1'), touchedAt: 1, done, undone, deleted, restore: null })), characterOwnerKey('c1'))
    if (parsed === null) {
        throw new Error('the test record does not parse')
    }
    return parsed
}

const LABEL = { kind: 'obj', list: 'lore', action: 'edit', name: 'Row' }
function step(id: string, ops: unknown[], label: unknown = LABEL): unknown {
    return { id, at: 1, label, ops }
}

describe('completeObjOps', () => {
    test('an insert records the holders after it, a remove the holders before it (this row included)', () => {
        const rows: unknown[] = [{ ...TWIN }, { ...TWIN }]
        const [insert] = complete([{ op: 'objInsert', list: 'lore', index: 2, entry: { ...TWIN } }], rows)
        expect(insert).toMatchObject({ op: 'objInsert', index: 2, counts: { content: 3 } })
        const [remove] = complete([{ op: 'objRemove', list: 'lore', index: 0 }], rows)
        expect(remove).toMatchObject({ op: 'objRemove', index: 0, counts: { content: 2 } })
        expect(rows).toHaveLength(2)
    })

    test('an objSet records before, after and both anchors; an unchanged value completes to nothing', () => {
        const rows = [row(1)]
        const [set] = complete([{ op: 'objSet', list: 'lore', index: 0, field: 'comment', after: { had: true, value: 'Renamed' } }], rows)
        expect(set).toMatchObject({ before: { had: true, value: 'Row 1' }, after: { had: true, value: 'Renamed' }, anchorBefore: entryAnchor('lore', row(1)) })
        expect(set.op === 'objSet' && set.anchorAfter).toBe(entryAnchor('lore', { ...row(1), comment: 'Renamed' }))
        expect(completeObjOps([{ op: 'objSet', list: 'lore', index: 0, field: 'comment', after: { had: true, value: 'Row 1' } }], world(rows).live)).toEqual({
            ok: false,
            reason: 'unchanged',
        })
    })

    test('T-WK: a stored value of another kind than its field is refused; other fields of that row stay editable', () => {
        const rows = [{ ...WRONG_KINDS }]
        for (const [field, after] of [
            ['insertorder', 5],
            ['content', 'text'],
            ['alwaysActive', true],
        ] as const) {
            const result = completeObjOps([{ op: 'objSet', list: 'lore', index: 0, field, after: { had: true, value: after } }], world(rows).live)
            expect(result, field).toEqual({ ok: false, reason: 'precondition' })
        }
        const ok = completeObjOps([{ op: 'objSet', list: 'lore', index: 0, field: 'comment', after: { had: true, value: 'Fine' } }], world(rows).live)
        expect(ok.ok).toBe(true)
        // An after value of the wrong kind on a well-typed row is refused the same way.
        const wrongAfter = completeObjOps([{ op: 'objSet', list: 'lore', index: 0, field: 'insertorder', after: { had: true, value: 'x' } }], world([row(1)]).live)
        expect(wrongAfter).toEqual({ ok: false, reason: 'precondition' })
        // Inserts and removes carry the wrong-kind row whole.
        const [remove] = complete([{ op: 'objRemove', list: 'lore', index: 0 }], rows)
        expect(remove.op === 'objRemove' && remove.entry).toEqual(WRONG_KINDS)
    })

    test('the range check is not an integer check: completion accepts index 1.5 and the shape parse refuses it', () => {
        const [insert] = complete([{ op: 'objInsert', list: 'lore', index: 1.5, entry: row(9) }], [row(1), row(2)])
        expect(insert.op).toBe('objInsert')
        expect(parseObjOp(insert)).toBeNull()
    })

    test('an unreadable list, a non-object row and a non-settable field are refused', () => {
        const unreadable: LiveReader = { field: () => ({ had: false }), greetings: () => null, fmIndex: () => null, objList: () => null }
        expect(completeObjOps([{ op: 'objInsert', list: 'lore', index: 0, entry: row(1) }], unreadable)).toEqual({ ok: false, reason: 'precondition' })
        const mixed = golden.mixedRows.globalLore
        expect(completeObjOps([{ op: 'objRemove', list: 'lore', index: 1 }], world([...mixed]).live)).toEqual({ ok: false, reason: 'precondition' })
        const folder = { ...golden.blank.globalLore[1] }
        expect(completeObjOps([{ op: 'objSet', list: 'lore', index: 0, field: 'key', after: { had: true, value: 'x' } }], world([folder]).live)).toEqual({
            ok: false,
            reason: 'precondition',
        })
    })
})

describe('planObjStep: all or nothing', () => {
    test('a refused plan writes nothing and leaves the live list untouched', () => {
        const rows = [row(1), row(2)]
        const before = JSON.stringify(rows)
        const ops = complete(
            [
                { op: 'objSet', list: 'lore', index: 0, field: 'comment', after: { had: true, value: 'A' } },
                { op: 'objSet', list: 'lore', index: 1, field: 'comment', after: { had: true, value: 'B' } },
            ],
            rows,
        )
        const live = world(rows)
        live.state.rows[1] = { ...row(2), comment: 'changed elsewhere' }
        const snapshot = JSON.stringify(live.state.rows)
        const plan = planObjStep(ops, live.live, new Set())
        expect(plan).toMatchObject({ ok: false, failure: { kind: 'changed', list: 'lore', at: 1 } })
        expect(JSON.stringify(live.state.rows)).toBe(snapshot)
        expect(before).not.toBe(snapshot)
    })

    test('an insert is refused when a new holder of its identity exists, and applies when the holders are fewer', () => {
        const ops = complete([{ op: 'objInsert', list: 'lore', index: 1, entry: { ...TWIN } }], [{ ...TWIN }])
        expect(planObjStep(ops, world([{ ...TWIN }]).live, new Set()).ok).toBe(true)
        expect(planObjStep(ops, world([{ ...TWIN }, { ...TWIN }]).live, new Set())).toMatchObject({ ok: false, failure: { kind: 'count', list: 'lore' } })
        expect(planObjStep(ops, world([row(1)]).live, new Set()).ok).toBe(true)
        // An index past the end is a range failure, not a count one.
        expect(planObjStep(ops, world([]).live, new Set())).toMatchObject({ ok: false, failure: { kind: 'changed' } })
    })

    test('a non-object row is never removed or set, and the plan never throws on cycles or bigints', () => {
        const mixed = golden.mixedRows.globalLore
        const entry = row(1)
        const remove: ObjFamilyOp = { op: 'objRemove', list: 'lore', index: 1, entry, counts: { content: 1 } }
        expect(planObjStep([remove], world([...mixed]).live, new Set()).ok).toBe(false)
        const cyclic: Record<string, unknown> = { comment: 'c' }
        cyclic.self = cyclic
        const hostile = [cyclic, { comment: 'b', n: BigInt(1) }, row(2)]
        const probe: ObjFamilyOp = { op: 'objRemove', list: 'lore', index: 0, entry, counts: { content: 1 } }
        expect(() => planObjStep([probe, { ...probe, index: 1 }], world(hostile).live, new Set())).not.toThrow()
        expect(planObjStep([probe], world(hostile).live, new Set()).ok).toBe(false)
        expect(() => completeObjOps([{ op: 'objRemove', list: 'lore', index: 0 }], world(hostile).live)).not.toThrow()
    })
})

describe('planObjStep: the per-run tag rule', () => {
    const rows = [row(0), row(1), row(2), row(3), row(4), row(5)]
    const removes = (indexes: number[], deletedId = 'D'): ObjFamilyOp[] =>
        indexes.map((index) => ({ op: 'objRemove', list: 'lore', index, entry: rows[index], counts: { content: 1 }, deletedId }))

    test('T-S2: a tagged remove run must strictly descend, with tags on or off, and a descending run lists one ascending item', () => {
        for (const bad of [[3, 3], [3, 4]]) {
            for (const tags of [true, false]) {
                const live = world([...rows])
                const before = JSON.stringify(live.state.rows)
                const plan = planObjStep(removes(bad), live.live, new Set(), tags)
                expect(plan, `${bad} ${tags}`).toMatchObject({ ok: false, failure: { kind: 'changed' } })
                expect(JSON.stringify(live.state.rows)).toBe(before)
            }
        }
        const plan = planObjStep(removes([4, 3]), world([...rows]).live, new Set())
        expect(plan.ok).toBe(true)
        if (plan.ok === true) {
            expect(plan.effect.list).toHaveLength(1)
            expect(plan.effect.list[0].entries.map((entry) => entry.index)).toEqual([3, 4])
            expect(plan.effect.consume).toEqual([])
        }
        expect(listingEffectOf(removes([3, 4]), new Set())).toBeNull()
    })

    test('T-S2: an ascending run over exact twins is refused by the order rule, not by an anchor', () => {
        const twins = [row(0), { ...TWIN }, { ...TWIN }, row(3)]
        const twinRemoves = (indexes: number[]): ObjFamilyOp[] =>
            indexes.map((index) => ({ op: 'objRemove', list: 'lore', index, entry: { ...TWIN }, counts: { content: 2 }, deletedId: 'D' }))
        for (const tags of [true, false]) {
            expect(planObjStep(twinRemoves([1, 1]), world([...twins]).live, new Set(), tags), String(tags)).toMatchObject({ ok: false, failure: { kind: 'changed' } })
            expect(planObjStep(twinRemoves([1, 2]), world([...twins]).live, new Set(), tags), String(tags)).toMatchObject({ ok: false, failure: { kind: 'changed' } })
        }
        expect(planObjStep(twinRemoves([2, 1]), world([...twins]).live, new Set()).ok).toBe(true)
    })

    test('a remove run needs its item unlisted and an insert run needs it listed; tags off checks neither', () => {
        expect(planObjStep(removes([1]), world([...rows]).live, new Set(['D']))).toMatchObject({ ok: false, failure: { kind: 'tag', run: 'remove', deletedId: 'D' } })
        const inserts: ObjFamilyOp[] = [{ op: 'objInsert', list: 'lore', index: 1, entry: rows[1], counts: { content: 1 }, deletedId: 'D' }]
        expect(planObjStep(inserts, world([...rows]).live, new Set())).toMatchObject({ ok: false, failure: { kind: 'tag', run: 'insert' } })
        expect(planObjStep(removes([1]), world([...rows]).live, new Set(['D']), false).ok).toBe(true)
        const witness = planObjStep(removes([1]), world([...rows]).live, new Set(['D']), false)
        expect(witness.ok === true && witness.effect).toEqual({ list: [], consume: [] })
    })

    test('a run ends at the first op that differs in kind or tag, so the next run is checked on its own', () => {
        const mixedTags = [...removes([4], 'D'), ...removes([2], 'E')]
        const plan = planObjStep(mixedTags, world([...rows]).live, new Set())
        expect(plan.ok === true && plan.effect.list.map((item) => item.id)).toEqual(['D', 'E'])
        // The second run's tag fails on its own, not the first's.
        expect(planObjStep(mixedTags, world([...rows]).live, new Set(['E']))).toMatchObject({ ok: false, failure: { kind: 'tag', deletedId: 'E', at: 1 } })
    })

    test('an insert run consumes a listed item; a delete and its restore net to no effect', () => {
        const del = planObjStep(removes([2]), world([...rows]).live, new Set())
        expect(del.ok).toBe(true)
        const insert: ObjFamilyOp = { op: 'objInsert', list: 'lore', index: 2, entry: rows[2], counts: { content: 1 }, deletedId: 'D' }
        const restore = planObjStep([insert], world(rows.filter((_, i) => i !== 2)).live, new Set(['D']))
        expect(restore.ok === true && restore.effect).toEqual({ list: [], consume: ['D'] })
        const both = planObjStep([...removes([2]), insert], world([...rows]).live, new Set())
        expect(both.ok === true && both.effect).toEqual({ list: [], consume: [] })
    })
})

describe('planReplay of an obj-only step', () => {
    const rows = [row(0), row(1), row(2)]
    const deleteOp = { op: 'objRemove', list: 'lore', index: 1, entry: rows[1], counts: { content: 1 }, deletedId: 'D' }
    const item = { id: 'D', at: 1, list: 'lore', entries: [{ index: 1, entry: rows[1], counts: { content: 1 } }] }
    const without = (): unknown[] => rows.filter((_, i) => i !== 1).map((r) => ({ ...r }))

    test('undo of a delete reinserts and consumes the item; redo removes and lists it again', () => {
        const record = recordOf([step('s1', [deleteOp])], [], [item])
        const live = world(without())
        const undo = planReplay(record, 'undo', live.live)
        expect(undo).toMatchObject({ ok: true, objEffect: { list: [], consume: ['D'] } })
        if (undo.ok === true) {
            live.apply(undo.writes)
            expect(live.state.rows).toEqual(rows)
            const moved = applyReplayMove(createModelState(record), 'undo', undo, 5, 'v')
            expect(moved.record.deleted).toEqual([])
            expect(moved.record.undone).toHaveLength(1)
            const redo = planReplay(moved.record, 'redo', live.live)
            expect(redo).toMatchObject({ ok: true, objEffect: { consume: [] } })
            if (redo.ok === true) {
                const again = applyReplayMove(moved, 'redo', redo, 6, 'v')
                expect(again.record.deleted).toMatchObject([{ id: 'D', list: 'lore', entries: [{ index: 1 }] }])
            }
        }
    })

    test('undo of a delete whose item was restored from History drops the step', () => {
        const record = recordOf([step('s1', [deleteOp])], [], [])
        const plan = planReplay(record, 'undo', world(without()).live)
        expect(plan).toMatchObject({ ok: true, dropStep: true, ops: [], writes: [] })
        const moved = applyReplayMove(createModelState(record), 'undo', plan as never, 5, 'v')
        expect(moved.record.done).toEqual([])
        expect(moved.record.undone).toEqual([])
    })

    test('a step already in its replay result moves as already, with the listing effect', () => {
        const record = recordOf([step('s1', [deleteOp])], [], [item])
        // The row is back already (restored by hand): the undo is in place.
        const plan = planReplay(record, 'undo', world(rows.map((r) => ({ ...r }))).live)
        expect(plan).toMatchObject({ ok: true, already: 'undo', writes: [], objEffect: { consume: ['D'] } })
    })

    test('a changed row refuses the replay, naming the list, and writes nothing', () => {
        const set = complete([{ op: 'objSet', list: 'lore', index: 0, field: 'comment', after: { had: true, value: 'New' } }], rows)
        const record = recordOf([step('s1', set)])
        const live = world([{ ...row(0), comment: 'Outside' }, row(1), row(2)])
        expect(planReplay(record, 'undo', live.live)).toEqual({ ok: false, reason: 'precondition', obj: { list: 'lore', kind: 'changed' } })
    })

    test('undo and redo of a field edit restore the row byte-equal', () => {
        const set = complete([{ op: 'objSet', list: 'lore', index: 0, field: 'comment', after: { had: true, value: 'New' } }], rows)
        const record = recordOf([step('s1', set)])
        const live = world([{ ...row(0), comment: 'New' }, row(1), row(2)])
        const undo = planReplay(record, 'undo', live.live)
        expect(undo.ok).toBe(true)
        if (undo.ok === true) {
            live.apply(undo.writes)
            expect(live.state.rows[0]).toEqual(row(0))
        }
    })
})

describe('planReplay of a mixed step', () => {
    const rows = [row(0), row(1)]
    const objSet = complete([{ op: 'objSet', list: 'lore', index: 0, field: 'comment', after: { had: true, value: 'New' } }], rows)[0]
    const lorePlusSet = { op: 'set', path: 'lorePlus', before: { had: false }, after: { had: true, value: true } }

    test('both halves apply as one plan, obj writes first', () => {
        const record = recordOf([step('s1', [lorePlusSet, objSet])])
        const live = world([{ ...row(0), comment: 'New' }, row(1)], { lorePlus: true })
        const plan = planReplay(record, 'undo', live.live)
        expect(plan).toMatchObject({ ok: true })
        if (plan.ok === true) {
            expect(plan.writes.map((write) => write.op)).toEqual(['objSet', 'set'])
            expect(plan.ops).toHaveLength(2)
            expect(plan.objExecuted).toHaveLength(1)
        }
    })

    test('a failing obj half refuses the whole step, never already and never dropped', () => {
        const record = recordOf([step('s1', [lorePlusSet, objSet])])
        const live = world([{ ...row(0), comment: 'Outside' }, row(1)], { lorePlus: true })
        expect(planReplay(record, 'undo', live.live)).toMatchObject({ ok: false, reason: 'precondition', obj: { list: 'lore', kind: 'changed' } })
        // Even when the other half already holds its result.
        const settled = world([{ ...row(0), comment: 'Outside' }, row(1)])
        expect(planReplay(record, 'undo', settled.live)).toMatchObject({ ok: false, reason: 'precondition' })
    })

    test('an applied obj half is real work: the step is not already when the other half cannot apply', () => {
        const record = recordOf([step('s1', [lorePlusSet, objSet])])
        const live = world([{ ...row(0), comment: 'New' }, row(1)])
        const plan = planReplay(record, 'undo', live.live)
        expect(plan.ok === true && plan.already).toBeUndefined()
        expect(plan.ok === true && plan.dropStep).toBeUndefined()
        expect(plan.ok === true && plan.writes.map((write) => write.op)).toEqual(['objSet'])
    })
})

describe('planRestoreDeleted of an obj item', () => {
    const rows = [row(0), row(1), row(2), row(3)]
    const item = {
        id: 'D',
        at: 1,
        list: 'lore',
        entries: [
            { index: 1, entry: rows[1], counts: { content: 1 } },
            { index: 3, entry: rows[3], counts: { content: 1 } },
        ],
    }

    test('reinserts every row at its old index, clamped, and consumes the item', () => {
        const record = recordOf([], [], [item])
        const live = world([rows[0], rows[2]])
        const plan = planRestoreDeleted(record, 'D', live.live, null)
        expect(plan).toMatchObject({ ok: true, label: { kind: 'restoreDeleted', deletedId: 'D' }, objEffect: { list: [], consume: ['D'] } })
        if (plan.ok === true) {
            live.apply(plan.writes)
            expect(live.state.rows).toEqual(rows)
        }
        const shorter = world([rows[0]])
        const clamped = planRestoreDeleted(record, 'D', shorter.live, null)
        if (clamped.ok === true) {
            shorter.apply(clamped.writes)
            expect(shorter.state.rows).toEqual([rows[0], rows[1], rows[3]])
        } else {
            throw new Error('the clamped restore must apply')
        }
    })

    test('an identity another row now holds refuses as idTaken; an unreadable list as changed', () => {
        const record = recordOf([], [], [item])
        expect(planRestoreDeleted(record, 'D', world([rows[0], { ...rows[1] }, rows[2]]).live, null)).toEqual({
            ok: false,
            reason: 'precondition',
            obj: { list: 'lore', kind: 'idTaken' },
        })
        const unreadable: LiveReader = { field: () => ({ had: false }), greetings: () => null, fmIndex: () => null }
        expect(planRestoreDeleted(record, 'D', unreadable, null)).toEqual({ ok: false, reason: 'precondition', obj: { list: 'lore', kind: 'changed' } })
    })
})

describe('commitStep and coalescing of obj ops', () => {
    const rows = [row(0)]
    const commitOf = (ops: ObjFamilyOp[], at: number, id: string) => ({
        id,
        at,
        visitId: 'v1',
        label: { kind: 'obj' as const, list: 'lore' as const, action: 'edit' as const, name: 'Row' },
        ops,
        restoreWrites: [],
        coalesceKey: 'k',
        replacesRestore: true,
    })

    test('three coalesced objSet keystrokes make one step with the first anchorBefore and the last anchorAfter', () => {
        const a = complete([{ op: 'objSet', list: 'lore', index: 0, field: 'comment', after: { had: true, value: 'A' } }], rows)
        const b = complete([{ op: 'objSet', list: 'lore', index: 0, field: 'comment', after: { had: true, value: 'AB' } }], [{ ...row(0), comment: 'A' }])
        const c = complete([{ op: 'objSet', list: 'lore', index: 0, field: 'comment', after: { had: true, value: 'ABC' } }], [{ ...row(0), comment: 'AB' }])
        let state = createModelState(recordOf([]))
        const originals = [a[0], b[0], c[0]].map((op) => JSON.stringify(op))
        state = commitStep(state, commitOf(a, 1000, 's1'))
        state = commitStep(state, commitOf(b, 1100, 's2'))
        state = commitStep(state, commitOf(c, 1200, 's3'))
        expect(state.record.done).toHaveLength(1)
        expect(state.record.done[0].ops[0]).toMatchObject({
            before: { had: true, value: 'Row 0' },
            after: { had: true, value: 'ABC' },
            anchorBefore: a[0].op === 'objSet' && a[0].anchorBefore,
            anchorAfter: c[0].op === 'objSet' && c[0].anchorAfter,
        })
        // The merge builds a new op: the plan's own op objects are unchanged.
        expect([a[0], b[0], c[0]].map((op) => JSON.stringify(op))).toEqual(originals)
    })

    test('T48b: propSet coalesces like objSet', () => {
        const prop = (before: unknown, after: unknown): ObjFamilyOp => ({ op: 'propSet', prop: 'loreSettings', before, after }) as ObjFamilyOp
        let state = createModelState(recordOf([]))
        state = commitStep(state, { ...commitOf([prop({ had: false }, { had: true, value: { x: 1 } })], 1000, 's1'), label: { kind: 'prop', prop: 'loreSettings' } })
        state = commitStep(state, { ...commitOf([prop({ had: true, value: { x: 1 } }, { had: true, value: { x: 2 } })], 1100, 's2'), label: { kind: 'prop', prop: 'loreSettings' } })
        expect(state.record.done).toHaveLength(1)
        expect(state.record.done[0].ops[0]).toMatchObject({ before: { had: false }, after: { had: true, value: { x: 2 } } })
        state = commitStep(state, { ...commitOf([prop({ had: true, value: { x: 2 } }, { had: true, value: { x: 3 } })], 99999, 's3'), label: { kind: 'prop', prop: 'loreSettings' } })
        expect(state.record.done).toHaveLength(2)
    })

    test('an obj edit creates the restore point with no field write, and a point of this visit is returned as it is', () => {
        const op = complete([{ op: 'objSet', list: 'lore', index: 0, field: 'comment', after: { had: true, value: 'A' } }], rows)
        let state = commitStep(createModelState(recordOf([])), commitOf(op, 1000, 's1'))
        expect(state.record.restore).toEqual({ visitId: 'v1', at: 1000, fields: {} })
        const point = state.record.restore
        state = commitStep(state, { ...commitOf(op, 90000, 's2'), coalesceKey: null })
        expect(state.record.restore).toBe(point)
        // A non-edit step (no obj op) with no write keeps today's behaviour: no point.
        const plain = commitStep(createModelState(recordOf([])), { ...commitOf(op, 1, 's1'), ops: [], replacesRestore: true })
        expect(plain.record.restore).toBeNull()
    })

    test('a commit lists and consumes the deleted items of its effect', () => {
        const del = complete([{ op: 'objRemove', list: 'lore', index: 0, deletedId: 'D' }], rows)
        const plan = planObjStep(del, world([...rows]).live, new Set())
        expect(plan.ok).toBe(true)
        if (plan.ok === true) {
            const state = commitStep(createModelState(recordOf([])), { ...commitOf(del, 1, 's1'), coalesceKey: null, objEffect: plan.effect })
            expect(state.record.deleted).toMatchObject([{ id: 'D', list: 'lore', at: 1 }])
        }
    })
})
