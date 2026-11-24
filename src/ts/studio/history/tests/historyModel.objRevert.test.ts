// Revert, restore line and mixed-range refusal over obj ops (S7-0 stage 0b). Rows come from the classic producers'
// golden (`loreClassic.golden.json`).
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { parseOwnerRecord, planRestoreWithLines, planRevert, type LiveReader, type OwnerRecord, type RestorePoint } from '../historyModel'
import { completeObjOps, type ObjEntry, type ObjFamilyOp, type ObjWrite } from '../objectListOps'
import { characterOwnerKey } from '../ownerPhase'

interface Golden {
    blank: { globalLore: ObjEntry[] }
}
const golden: Golden = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'loreClassic.golden.json'), 'utf8'))
const [ADDED] = golden.blank.globalLore

function row(n: number): ObjEntry {
    return { ...ADDED, comment: `Row ${n}`, content: `body ${n}` }
}

function world(rows: unknown[], lorePlus?: boolean) {
    const state = { rows, lorePlus }
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

function setOp(rows: unknown[], index: number, after: string): ObjFamilyOp {
    const result = completeObjOps([{ op: 'objSet', list: 'lore', index, field: 'comment', after: { had: true, value: after } }], world(rows).live)
    if (!result.ok) {
        throw new Error('completion refused')
    }
    return result.ops[0]
}

const LABEL = { kind: 'obj', list: 'lore', action: 'edit', name: 'Row' }
function recordOf(done: unknown[], deleted: unknown[] = []): OwnerRecord {
    const key = characterOwnerKey('c1')
    const parsed = parseOwnerRecord(JSON.parse(JSON.stringify({ ownerKey: key, touchedAt: 1, done, undone: [], deleted, restore: null })), key)
    if (parsed === null) {
        throw new Error('the test record does not parse')
    }
    return parsed
}
function step(id: string, ops: unknown[], label: unknown = LABEL): unknown {
    return { id, at: 1, label, ops }
}

describe('planRevert over obj steps', () => {
    const base = [row(0), row(1)]
    const s2 = setOp(base, 0, 'One')
    const s3 = setOp([{ ...row(0), comment: 'One' }, row(1)], 1, 'Two')
    const record = recordOf([step('s1', []), step('s2', [s2]), step('s3', [s3])])
    const after = (): unknown[] => [{ ...row(0), comment: 'One' }, { ...row(1), comment: 'Two' }]

    test('reverts every step above the target as one plan, newest first', () => {
        const live = world(after())
        const plan = planRevert(record, 's1', live.live)
        expect(plan).toMatchObject({ ok: true, label: { kind: 'revert', toStepId: 's1' } })
        if (plan.ok === true) {
            live.apply(plan.writes)
            expect(live.state.rows).toEqual(base)
            expect(plan.objExecuted).toHaveLength(2)
            expect(plan.ops).toHaveLength(2)
        }
    })

    test('a row changed elsewhere refuses the whole revert and writes nothing', () => {
        const rows = after()
        rows[0] = { ...row(0), comment: 'Outside' }
        const live = world(rows, true)
        const snapshot = JSON.stringify(rows)
        expect(planRevert(record, 's1', live.live)).toEqual({ ok: false, reason: 'precondition', obj: { list: 'lore', kind: 'changed' } })
        expect(JSON.stringify(live.state.rows)).toBe(snapshot)
    })

    test('a range with a merge text edit under the list prefix is refused with that list mixed', () => {
        const text = { op: 'textEdit', target: 'lore/0/content', offset: 0, from: '', to: 'x' }
        const mixed = recordOf([step('s1', []), step('s2', [s2]), step('s3', [text], { kind: 'field', field: 'desc' })])
        expect(planRevert(mixed, 's1', world(after()).live)).toEqual({ ok: false, reason: 'precondition', obj: { list: 'lore', kind: 'mixed' } })
    })

    test('a revert with no obj ops is unchanged by the obj half', () => {
        const none = recordOf([step('s1', []), step('s2', [{ op: 'set', path: 'lorePlus', before: { had: false }, after: { had: true, value: true } }], { kind: 'field', field: 'lorePlus' })])
        const plan = planRevert(none, 's1', world([], true).live)
        expect(plan).toMatchObject({ ok: true })
        expect(plan.ok === true && plan.objExecuted).toBeUndefined()
        expect(plan.ok === true && plan.objEffect).toBeUndefined()
    })
})

describe('planRestoreWithLines', () => {
    const base = [row(0), row(1)]
    const op = setOp(base, 0, 'One')
    const point: RestorePoint = { visitId: 'v', at: 1, fields: {} }
    const entries = [{ ops: [op] }]

    test('a line reverts its journal entries with no field op, and reports the list applied', () => {
        const live = world([{ ...row(0), comment: 'One' }, row(1)])
        const plan = planRestoreWithLines(point, live.live, new Set(), [{ list: 'lore', entries }], new Set())
        expect(plan).toMatchObject({ ok: true, label: { kind: 'restorePoint' }, linesApplied: ['lore'] })
        if (plan.ok === true) {
            live.apply(plan.writes)
            expect(live.state.rows).toEqual(base)
        }
    })

    test('a refused line is named and the restore is refused when nothing else applies', () => {
        const live = world([{ ...row(0), comment: 'Outside' }, row(1)])
        expect(planRestoreWithLines(point, live.live, new Set(), [{ list: 'lore', entries }], new Set())).toEqual({
            ok: false,
            reason: 'precondition',
            linesRefused: ['lore'],
        })
    })

    test('with no point the restore is empty, and with no lines it is the field restore', () => {
        expect(planRestoreWithLines(null, world([]).live, new Set(), [], new Set())).toEqual({ ok: false, reason: 'empty' })
        expect(planRestoreWithLines(point, world([]).live, new Set(), [], new Set())).toEqual({ ok: false, reason: 'precondition' })
    })
})
