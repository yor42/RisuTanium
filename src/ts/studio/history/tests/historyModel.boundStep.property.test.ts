// Random outside edits interleaved with undo, redo and revert over a bound step. Safety: no action lands the first
// message without the alternate list change of its step or the reverse. Liveness: with no outside edit, a bound step
// recorded with a readable list always undoes, redoes and reverts. Fixtures are built as the producers build them.
import fc from 'fast-check'
import { describe, expect, test } from 'vitest'
import {
    applyReplayMove,
    commitStep,
    createModelState,
    deriveRestoreWrites,
    emptyRecord,
    planReplay,
    planRevert,
    type FieldValue,
    type LiveReader,
    type ModelState,
    type Op,
    type PlanResult,
    type StepLabel,
    type WriteOp,
} from '../historyModel'
import { characterOwnerKey } from '../ownerPhase'

interface Live {
    desc: string
    firstMessage: string
    list: string[]
}

const text = (value: string): FieldValue => ({ had: true, value })

function readerOf(live: Live): LiveReader {
    return {
        field(path) {
            if (path === 'desc') return text(live.desc)
            return path === 'firstMessage' ? text(live.firstMessage) : { had: false }
        },
        greetings: () => live.list,
        fmIndex: () => null,
    }
}

function applyWrites(live: Live, writes: readonly WriteOp[]): void {
    for (const write of writes) {
        if (write.op === 'set' && write.value.had && typeof write.value.value === 'string') {
            if (write.path === 'desc') live.desc = write.value.value
            if (write.path === 'firstMessage') live.firstMessage = write.value.value
        } else if (write.op === 'listSet') {
            live.list[write.index] = write.value
        } else if (write.op === 'listInsert') {
            live.list.splice(write.index, 0, write.value)
        } else if (write.op === 'listRemove') {
            live.list.splice(write.index, 1)
        }
    }
}

function landOp(live: Live, op: Op): void {
    if (op.op === 'set' && op.path === 'desc' && op.after.had && typeof op.after.value === 'string') live.desc = op.after.value
    if (op.op === 'set' && op.path === 'firstMessage' && op.after.had && typeof op.after.value === 'string') live.firstMessage = op.after.value
    if (op.op === 'listSet') live.list[op.index] = op.after
    if (op.op === 'listInsert') live.list.splice(op.index, 0, op.value)
    if (op.op === 'listRemove') live.list.splice(op.index, 1)
}

type Shape = 'swap' | 'append' | 'removeFirst' | 'unreadable'

const SHAPE_OPS: Record<Shape, Op[]> = {
    swap: [
        { op: 'set', path: 'firstMessage', before: text('M'), after: text('G') },
        { op: 'listSet', index: 1, before: 'G', after: 'M' },
    ],
    append: [
        { op: 'set', path: 'firstMessage', before: text('M'), after: text('G') },
        { op: 'listInsert', index: 3, value: 'X' },
    ],
    removeFirst: [
        { op: 'set', path: 'firstMessage', before: text('M'), after: text('G') },
        { op: 'listRemove', index: 0, value: 'A', deletedId: null },
    ],
    unreadable: [
        { op: 'set', path: 'firstMessage', before: text('M'), after: text('G') },
        { op: 'listInsert', index: 3, value: 'X' },
    ],
}

interface Session {
    live: Live
    state: ModelState
    anchor: string
}

const DESC_LABEL: StepLabel = { kind: 'field', field: 'desc' }
const FIRST_MESSAGE_LABEL: StepLabel = { kind: 'field', field: 'firstMessage' }

function open(shape: Shape): Session {
    const live: Live = { desc: 'd0', firstMessage: 'M', list: ['A', 'G', 'C'] }
    let state = createModelState(emptyRecord(characterOwnerKey('c1'), 0))
    const land = (id: string, label: StepLabel, ops: Op[], listKnown: boolean): void => {
        const restoreWrites = deriveRestoreWrites(ops, listKnown ? live.list : null)
        for (const op of ops) landOp(live, op)
        state = commitStep(state, { id, at: 10_000, visitId: 'v1', label, ops, restoreWrites, coalesceKey: null, replacesRestore: true })
    }
    land('s1', DESC_LABEL, [{ op: 'set', path: 'desc', before: text('d0'), after: text('d1') }], true)
    land('s2', FIRST_MESSAGE_LABEL, SHAPE_OPS[shape], shape !== 'unreadable')
    return { live, state, anchor: 's1' }
}

type Outside = { kind: 'firstMessage'; value: string } | { kind: 'entry'; index: number; value: string } | { kind: 'push'; value: string } | { kind: 'pop' }

const outsideArb: fc.Arbitrary<Outside> = fc.oneof(
    fc.record({ kind: fc.constant('firstMessage' as const), value: fc.constantFrom('M', 'G', 'Z') }),
    fc.record({ kind: fc.constant('entry' as const), index: fc.integer({ min: 0, max: 3 }), value: fc.constantFrom('A', 'G', 'M', 'X', 'Q') }),
    fc.record({ kind: fc.constant('push' as const), value: fc.constantFrom('X', 'Q') }),
    fc.record({ kind: fc.constant('pop' as const) }),
)

function applyOutside(live: Live, edits: readonly Outside[]): void {
    for (const edit of edits) {
        if (edit.kind === 'firstMessage') live.firstMessage = edit.value
        else if (edit.kind === 'entry') {
            if (edit.index < live.list.length) live.list[edit.index] = edit.value
        } else if (edit.kind === 'push') live.list.push(edit.value)
        else live.list.pop()
    }
}

function writesBothOrNone(plan: PlanResult): boolean {
    if (!plan.ok) return true
    const firstMessage = plan.writes.some((write) => write.op === 'set' && write.path === 'firstMessage')
    const list = plan.writes.some((write) => write.op === 'listSet' || write.op === 'listInsert' || write.op === 'listRemove')
    return firstMessage === list
}

function replay(session: Session, direction: 'undo' | 'redo'): PlanResult {
    const plan = planReplay(session.state.record, direction, readerOf(session.live))
    if (plan.ok) {
        applyWrites(session.live, plan.writes)
        session.state = applyReplayMove(session.state, direction, plan, 100_000, 'v1')
    }
    return plan
}

const shapeArb = fc.constantFrom<Shape>('swap', 'append', 'removeFirst', 'unreadable')
const editsArb = fc.array(outsideArb, { maxLength: 3 })

describe('bound step safety under random outside edits', () => {
    test('an undo lands both halves or neither, and a redo after it too', () => {
        fc.assert(
            fc.property(shapeArb, editsArb, editsArb, (shape, first, second) => {
                const session = open(shape)
                applyOutside(session.live, first)
                const undo = replay(session, 'undo')
                expect(writesBothOrNone(undo)).toBe(true)
                if (!undo.ok) return
                applyOutside(session.live, second)
                expect(writesBothOrNone(replay(session, 'redo'))).toBe(true)
            }),
        )
    })

    test('a revert lands both halves or neither', () => {
        fc.assert(
            fc.property(shapeArb, editsArb, (shape, edits) => {
                const session = open(shape)
                applyOutside(session.live, edits)
                expect(writesBothOrNone(planRevert(session.state.record, session.anchor, readerOf(session.live)))).toBe(true)
            }),
        )
    })
})

describe('bound step liveness without outside edits', () => {
    const readableShapes = fc.constantFrom<Shape>('swap', 'append', 'removeFirst')

    test('an undo and then a redo apply whole', () => {
        fc.assert(
            fc.property(readableShapes, (shape) => {
                const session = open(shape)
                const undo = replay(session, 'undo')
                expect(undo.ok && !undo.already && undo.writes.some((write) => write.op === 'set' && write.path === 'firstMessage')).toBe(true)
                const redo = replay(session, 'redo')
                expect(redo.ok && !redo.already && redo.writes.some((write) => write.op === 'set' && write.path === 'firstMessage')).toBe(true)
                expect(session.live.firstMessage).toBe('G')
            }),
        )
    })

    test('a revert applies whole', () => {
        fc.assert(
            fc.property(readableShapes, (shape) => {
                const session = open(shape)
                const plan = planRevert(session.state.record, session.anchor, readerOf(session.live))
                expect(plan.ok && plan.writes.some((write) => write.op === 'set' && write.path === 'firstMessage')).toBe(true)
                expect(plan.ok && plan.pairSkipped).toBeUndefined()
            }),
        )
    })
})
