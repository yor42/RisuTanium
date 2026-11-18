// The carry applier over a memory port: the write plan (copy on rename, renumbering of canonical indexes only, notices),
// the signature that guards a stale answer, and the all-or-nothing apply and undo. The database port is covered in
// edit/tests/toggleCarryDb.svelte.test.ts.
import { describe, expect, test } from 'vitest'
import type { CarryItem } from './toggleCarry'
import {
    applyCarry,
    isIndexValue,
    planCarryWrites,
    remapValue,
    undoCarry,
    type CarryReach,
    type CarryValuePort,
    type PlaceRef,
} from './toggleCarryApply'

const GLOBAL: PlaceRef = { kind: 'global' }
const chat = (chaId: string, chatId: string): PlaceRef => ({ kind: 'chat', chaId, chatId })
const keyOf = (ref: PlaceRef): string => (ref.kind === 'global' ? 'global' : `${ref.chaId}/${ref.chatId}`)

const rename = (from: string, to: string): CarryItem => ({ kind: 'rename', from, to })
const remapItem = (key: string, remap: number[]): CarryItem => ({ kind: 'optionRemap', key, remap, removed: [] })

function reachOf(entries: [PlaceRef, Record<string, string> | undefined][], others: CarryReach['others'] = []): CarryReach {
    return { places: entries.map(([ref, values]) => ({ ref, entries: values })), others }
}

/** A memory port that records every call, so rollback and marking are observable. */
function memoryPort(initial: [PlaceRef, Record<string, string>][]) {
    const store = new Map(initial.map(([ref, values]) => [keyOf(ref), { ...values }]))
    const gone = new Set<string>()
    const log: string[] = []
    const marks: PlaceRef[][] = []
    const control = { throwOnWrite: 0, throwOnMark: false }
    let writeCount = 0
    const port: CarryValuePort = {
        read(ref, varKey) {
            return gone.has(keyOf(ref)) ? 'gone' : store.get(keyOf(ref))?.[varKey]
        },
        write(ref, varKey, value) {
            writeCount += 1
            if (control.throwOnWrite !== 0 && writeCount === control.throwOnWrite) {
                throw new Error('write refused')
            }
            if (gone.has(keyOf(ref))) {
                throw new Error('gone')
            }
            const values = store.get(keyOf(ref)) ?? {}
            store.set(keyOf(ref), values)
            log.push(`${keyOf(ref)}:${varKey}=${value}`)
            if (value === undefined) {
                delete values[varKey]
            } else {
                values[varKey] = value
            }
        },
        mark(refs) {
            if (control.throwOnMark) {
                throw new Error('mark refused')
            }
            marks.push([...refs])
        },
    }
    return { port, store, gone, log, marks, control }
}

describe('isIndexValue and remapValue (A-I)', () => {
    test('only canonical decimal digits below the option count are indexes', () => {
        const yes = ['0', '1', '2']
        const no = [' 1', '1.0', '01', '+1', '', 'null', '3', '-1', '1e0', '0x1', '\t1\n']
        expect(yes.map((value) => isIndexValue(value, 3))).toEqual([true, true, true])
        expect(no.map((value) => isIndexValue(value, 3))).toEqual(no.map(() => false))
    })

    test('a reorder renumbers canonical values and leaves every other byte alone', () => {
        const values = ['0', '1', '2', ' 1', '1.0', '01', '+1', '3', '', 'null']
        expect(values.map((value) => remapValue(value, [2, 0, 1], 3))).toEqual(['2', '0', '1', ' 1', '1.0', '01', '+1', '3', '', 'null'])
    })

    test('a removed option maps to the first option', () => {
        expect(['0', '1', '2'].map((value) => remapValue(value, [0, 0, 1], 3))).toEqual(['0', '0', '1'])
    })
})

describe('planCarryWrites over places (A-S)', () => {
    test('a rename copies the value to the new key where the old key held one, and the old key is never written', () => {
        const plan = planCarryWrites([rename('a', 'b')], reachOf([
            [GLOBAL, { toggle_a: '1' }],
            [chat('c1', 'x'), { toggle_a: '2' }],
            [chat('c1', 'y'), undefined],
            [chat('c2', 'z'), { toggle_b: '9' }],
        ]))
        expect(plan.writes).toEqual([
            { ref: GLOBAL, varKey: 'toggle_b', before: undefined, after: '1' },
            { ref: chat('c1', 'x'), varKey: 'toggle_b', before: undefined, after: '2' },
        ])
        expect(plan.star).toEqual([{ from: 'a', to: 'b' }])
        expect(plan.notice).toEqual({ overwrite: [], shared: [] })
    })

    test('an existing different target value is replaced and named, an equal one is not written', () => {
        const plan = planCarryWrites([rename('a', 'b')], reachOf([
            [GLOBAL, { toggle_a: '1', toggle_b: '0' }],
            [chat('c1', 'x'), { toggle_a: '1', toggle_b: '1' }],
        ]))
        expect(plan.writes).toEqual([{ ref: GLOBAL, varKey: 'toggle_b', before: '0', after: '1' }])
        expect(plan.notice.overwrite).toEqual(['b'])
    })

    test('a kept-key reorder rewrites only values that change and keeps the key', () => {
        const plan = planCarryWrites([remapItem('s', [1, 0])], reachOf([
            [GLOBAL, { toggle_s: '0' }],
            [chat('c1', 'x'), { toggle_s: 'free text' }],
            [chat('c1', 'y'), { toggle_s: '1' }],
        ]))
        expect(plan.writes).toEqual([
            { ref: GLOBAL, varKey: 'toggle_s', before: '0', after: '1' },
            { ref: chat('c1', 'y'), varKey: 'toggle_s', before: '1', after: '0' },
        ])
        expect(plan.star).toEqual([])
    })

    test('a rename with a reorder copies the renumbered value', () => {
        const plan = planCarryWrites([rename('s', 't'), remapItem('s', [1, 0])], reachOf([[GLOBAL, { toggle_s: '0' }]]))
        expect(plan.writes).toEqual([{ ref: GLOBAL, varKey: 'toggle_t', before: undefined, after: '1' }])
    })

    test('a rename that leaves the renumbered value equal to the target writes nothing', () => {
        const plan = planCarryWrites([rename('s', 't'), remapItem('s', [1, 0])], reachOf([[GLOBAL, { toggle_s: '0', toggle_t: '1' }]]))
        expect(plan.writes).toEqual([])
        expect(plan.notice.overwrite).toEqual([])
    })
})

describe('items that carry nothing (A-N)', () => {
    test('ambiguous, kind change and drop alone give no writes, no stars and no notice', () => {
        const items: CarryItem[] = [
            { kind: 'ambiguous', key: 'a', reason: 'unmatched' },
            { kind: 'kindChange', key: 'b', from: 'check', to: 'text' },
            { kind: 'drop', key: 'c', to: 'divider' },
        ]
        const plan = planCarryWrites(items, reachOf([[GLOBAL, { toggle_a: '1', toggle_b: '1', toggle_c: '1' }]], [{ id: 'm', name: 'M', text: 'a=A\nb=B\nc=C\n' }]))
        expect(plan.writes).toEqual([])
        expect(plan.star).toEqual([])
        expect(plan.notice).toEqual({ overwrite: [], shared: [] })
    })

    test('an ambiguous item beside a rename does not disturb the rename', () => {
        const plan = planCarryWrites([{ kind: 'ambiguous', key: 'q', reason: 'options' }, rename('a', 'b')], reachOf([[GLOBAL, { toggle_a: '1', toggle_q: '1' }]]))
        expect(plan.writes).toEqual([{ ref: GLOBAL, varKey: 'toggle_b', before: undefined, after: '1' }])
    })
})

describe('notices from other sources (A-W)', () => {
    const others = [
        { id: 'module:m1', name: 'Module One', text: 'b=Other\n' },
        { id: 'character:c9', name: 'Trashed', text: 'x=X\nb=B\n' },
        { id: 'preset:1', name: 'Preset', text: 'z=Z\n' },
    ]

    test('a written key another source defines is named with every source, parsed alone', () => {
        const plan = planCarryWrites([rename('a', 'b')], reachOf([[GLOBAL, { toggle_a: '1' }]], others))
        expect(plan.notice.shared).toEqual([{ key: 'b', sources: ['Module One', 'Trashed'] }])
    })

    test('a kept-key reorder of a key another source defines is named too', () => {
        const plan = planCarryWrites([remapItem('b', [1, 0])], reachOf([[GLOBAL, { toggle_b: '0' }]], others))
        expect(plan.notice.shared).toEqual([{ key: 'b', sources: ['Module One', 'Trashed'] }])
    })

    test('a key nothing is written to is not named, and equal values give no overwrite line', () => {
        const none = planCarryWrites([rename('a', 'b')], reachOf([[GLOBAL, { toggle_other: '1' }]], others))
        expect(none.notice).toEqual({ overwrite: [], shared: [] })
        const equal = planCarryWrites([rename('a', 'b')], reachOf([[GLOBAL, { toggle_a: '1', toggle_b: '1' }]], others))
        expect(equal.notice.overwrite).toEqual([])
    })
})

describe('signature (A-T)', () => {
    test('one more place with the same notice keeps the signature, so fresh values are written without asking again', () => {
        const few = planCarryWrites([rename('a', 'b')], reachOf([[GLOBAL, { toggle_a: '1' }]]))
        const more = planCarryWrites([rename('a', 'b')], reachOf([[GLOBAL, { toggle_a: '1' }], [chat('c1', 'x'), { toggle_a: '2' }]]))
        expect(more.writes.length).toBeGreaterThan(few.writes.length)
        expect(more.signature).toBe(few.signature)
    })

    test('a changed item set or a changed notice changes the signature', () => {
        const base = planCarryWrites([rename('a', 'b')], reachOf([[GLOBAL, { toggle_a: '1' }]]))
        const otherItems = planCarryWrites([rename('a', 'c')], reachOf([[GLOBAL, { toggle_a: '1' }]]))
        const overwrite = planCarryWrites([rename('a', 'b')], reachOf([[GLOBAL, { toggle_a: '1', toggle_b: '0' }]]))
        expect(otherItems.signature).not.toBe(base.signature)
        expect(overwrite.signature).not.toBe(base.signature)
    })

    test('a signature that differs from the shown one writes nothing and marks nothing', () => {
        const rig = memoryPort([[GLOBAL, { toggle_a: '1' }]])
        const plan = planCarryWrites([rename('a', 'b')], reachOf([[GLOBAL, { toggle_a: '1' }]]))
        expect(applyCarry(plan, `${plan.signature} `, rig.port)).toEqual({ ok: false, reason: 'stale' })
        expect(rig.log).toEqual([])
        expect(rig.marks).toEqual([])
    })
})

describe('applyCarry (A-X)', () => {
    const places: [PlaceRef, Record<string, string>][] = [
        [GLOBAL, { toggle_a: '1' }],
        [chat('c1', 'x'), { toggle_a: '2', toggle_b: 'old' }],
        [chat('c1', 'y'), { toggle_a: '3' }],
        [chat('c2', 'z'), { toggle_a: '4' }],
    ]
    const plan = () => planCarryWrites([rename('a', 'b')], reachOf(places))

    test('writes in order and marks every touched place once', () => {
        const rig = memoryPort(places)
        const result = applyCarry(plan(), plan().signature, rig.port)
        expect(result.ok).toBe(true)
        expect(rig.store.get('global')).toEqual({ toggle_a: '1', toggle_b: '1' })
        expect(rig.store.get('c1/x')).toEqual({ toggle_a: '2', toggle_b: '2' })
        expect(rig.marks).toHaveLength(1)
        expect(rig.marks[0].map(keyOf)).toEqual(['global', 'c1/x', 'c1/y', 'c2/z'])
        expect(result.ok && result.journal.writes).toHaveLength(4)
    })

    test('a throw on the third write puts the first two back, marks them, and fails', () => {
        const rig = memoryPort(places)
        rig.control.throwOnWrite = 3
        const result = applyCarry(plan(), plan().signature, rig.port)
        expect(result).toEqual({ ok: false, reason: 'failed' })
        expect(rig.store.get('global')).toEqual({ toggle_a: '1' })
        expect(rig.store.get('c1/x')).toEqual({ toggle_a: '2', toggle_b: 'old' })
        expect(rig.store.get('c1/y')).toEqual({ toggle_a: '3' })
        expect(rig.marks).toHaveLength(1)
        expect(rig.marks[0].map(keyOf)).toEqual(['global', 'c1/x'])
    })

    test('a throw from the mark puts every write back', () => {
        const rig = memoryPort(places)
        rig.control.throwOnMark = true
        const result = applyCarry(plan(), plan().signature, rig.port)
        expect(result).toEqual({ ok: false, reason: 'failed' })
        for (const [ref, values] of places) {
            expect(rig.store.get(keyOf(ref))).toEqual(values)
        }
    })

    test('a throw while putting back does not stop the remaining restores', () => {
        const rig = memoryPort(places)
        rig.control.throwOnWrite = 4
        // The rollback of the third write refuses; the second and first are still put back.
        let calls = 0
        const inner = rig.port.write
        rig.port.write = (ref, varKey, value) => {
            calls += 1
            if (calls === 5) {
                throw new Error('rollback refused')
            }
            inner(ref, varKey, value)
        }
        const result = applyCarry(plan(), plan().signature, rig.port)
        expect(result).toEqual({ ok: false, reason: 'failed' })
        expect(rig.store.get('global')).toEqual({ toggle_a: '1' })
        expect(rig.store.get('c1/x')).toEqual({ toggle_a: '2', toggle_b: 'old' })
    })
})

describe('undoCarry (A-U)', () => {
    const places: [PlaceRef, Record<string, string>][] = [
        [GLOBAL, { toggle_a: '1' }],
        [chat('c1', 'x'), { toggle_a: '2', toggle_b: 'old' }],
    ]

    function carried() {
        const rig = memoryPort(places)
        const plan = planCarryWrites([rename('a', 'b')], reachOf(places))
        const result = applyCarry(plan, plan.signature, rig.port)
        if (!result.ok) {
            throw new Error('setup')
        }
        return { rig, journal: result.journal }
    }

    test('restores every before, deleting keys that did not exist, and marks the places', () => {
        const { rig, journal } = carried()
        rig.marks.length = 0
        expect(undoCarry(journal, rig.port)).toEqual({ ok: true })
        expect(rig.store.get('global')).toEqual({ toggle_a: '1' })
        expect(rig.store.get('c1/x')).toEqual({ toggle_a: '2', toggle_b: 'old' })
        expect(rig.marks).toHaveLength(1)
    })

    test('one changed place refuses the whole undo and writes nothing', () => {
        const { rig, journal } = carried()
        rig.store.get('c1/x')!.toggle_b = 'edited since'
        rig.log.length = 0
        expect(undoCarry(journal, rig.port)).toEqual({ ok: false, reason: 'changed' })
        expect(rig.log).toEqual([])
        expect(rig.store.get('global')).toEqual({ toggle_a: '1', toggle_b: '1' })
    })

    test('a place that no longer resolves refuses the undo', () => {
        const { rig, journal } = carried()
        // The first place of the journal is also the last one an undo restores, so a refusal that came late would show as writes.
        rig.gone.add('global')
        rig.log.length = 0
        expect(undoCarry(journal, rig.port)).toEqual({ ok: false, reason: 'changed' })
        expect(rig.log).toEqual([])
    })

    test('a restore that throws puts the carried values back and refuses', () => {
        const { rig, journal } = carried()
        let calls = 0
        const inner = rig.port.write
        rig.port.write = (ref, varKey, value) => {
            calls += 1
            if (calls === 2) {
                throw new Error('restore refused')
            }
            inner(ref, varKey, value)
        }
        expect(undoCarry(journal, rig.port)).toEqual({ ok: false, reason: 'changed' })
        expect(rig.store.get('global')).toEqual({ toggle_a: '1', toggle_b: '1' })
        expect(rig.store.get('c1/x')).toEqual({ toggle_a: '2', toggle_b: '2' })
    })
})
