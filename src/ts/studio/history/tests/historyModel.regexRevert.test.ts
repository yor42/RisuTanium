// T42 (M47): a revert whose range holds a regex object step and an asset merge's `regex/<i>/out` text edit is refused as
// mixed and writes nothing; a range of regex object steps alone reverts. Entries are made by the real completion over a
// regex list, as the service records them.
import { describe, expect, test } from 'vitest'
import { parseOwnerRecord, planRevert, type LiveReader, type OwnerRecord } from '../historyModel'
import { completeObjOps, type ObjFamilyOp, type ObjWrite } from '../objectListOps'
import { characterOwnerKey } from '../ownerPhase'

type Row = Record<string, unknown>

function entry(n: number): Row {
    return { comment: `Script ${n}`, in: `in ${n}`, out: `out ${n}`, type: 'editinput' }
}

function world(rows: unknown[]) {
    const state = { rows }
    const live: LiveReader = {
        field: () => ({ had: false }),
        greetings: () => null,
        fmIndex: () => null,
        objList: (list) => (list === 'regex' ? state.rows : null),
        prop: () => ({ had: false }),
    }
    const apply = (writes: readonly unknown[]): void => {
        for (const write of writes as ObjWrite[]) {
            if (write.op === 'objInsert') state.rows.splice(write.index, 0, JSON.parse(JSON.stringify(write.entry)))
            else if (write.op === 'objRemove') state.rows.splice(write.index, 1)
        }
    }
    return { state, live, apply }
}

function complete(drafts: Parameters<typeof completeObjOps>[0], rows: unknown[]): ObjFamilyOp[] {
    const done = completeObjOps(drafts, world(rows).live)
    if (!done.ok) throw new Error('completion refused')
    return done.ops
}

function recordOf(done: unknown[]): OwnerRecord {
    const key = characterOwnerKey('c1')
    const parsed = parseOwnerRecord(JSON.parse(JSON.stringify({ ownerKey: key, touchedAt: 1, done, undone: [], deleted: [], restore: null })), key)
    if (parsed === null) throw new Error('the test record does not parse')
    return parsed
}

const label = (action: string) => ({ kind: 'obj', list: 'regex', action, name: 'Script 1' })
const step = (id: string, ops: unknown[], stepLabel: unknown = label('add')) => ({ id, at: 1, label: stepLabel, ops })

describe('T42: a revert range over regex steps', () => {
    const base = [entry(0)]
    const addOps = complete([{ op: 'objInsert', list: 'regex', index: 1, entry: entry(1) }], base)
    const moveOps = complete([{ op: 'objRemove', list: 'regex', index: 0 }, { op: 'objInsert', list: 'regex', index: 1, entry: entry(0) }], [entry(0), entry(1)])
    const afterAdd = (): unknown[] => [entry(0), entry(1)]
    const afterMove = (): unknown[] => [entry(1), entry(0)]

    test('regex object steps alone revert, newest first, to the base list', () => {
        const record = recordOf([step('s1', []), step('s2', addOps), step('s3', moveOps, label('move'))])
        const live = world(afterMove())
        const plan = planRevert(record, 's1', live.live)
        expect(plan).toMatchObject({ ok: true })
        if (plan.ok === true) {
            live.apply(plan.writes)
            expect(live.state.rows).toEqual(base)
        }
    })

    test('a range that also holds a `regex/<i>/out` text edit is refused with the regex list mixed, and nothing is written', () => {
        const text = { op: 'textEdit', target: 'regex/0/out', offset: 0, from: '', to: 'x' }
        const record = recordOf([step('s1', []), step('s2', addOps), step('s3', [text], { kind: 'field', field: 'desc' })])
        const live = world(afterAdd())
        const before = JSON.stringify(live.state.rows)
        expect(planRevert(record, 's1', live.live)).toEqual({ ok: false, reason: 'precondition', obj: { list: 'regex', kind: 'mixed' } })
        expect(JSON.stringify(live.state.rows)).toBe(before)
    })

    test('a text edit under the lore prefix does not mix with a regex step', () => {
        const text = { op: 'textEdit', target: 'lore/0/content', offset: 0, from: '', to: 'x' }
        const record = recordOf([step('s1', []), step('s2', addOps), step('s3', [text], { kind: 'field', field: 'desc' })])
        const plan = planRevert(record, 's1', world(afterAdd()).live)
        expect(plan).not.toMatchObject({ obj: { kind: 'mixed' } })
    })
})
