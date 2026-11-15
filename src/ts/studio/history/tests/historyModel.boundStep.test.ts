// A step that changed the first message together with the alternate first messages lands both or stops whole, in an undo,
// a redo and a revert. Every fixture is built as the producers build it: edit steps through `commitStep` with
// `deriveRestoreWrites` (no list means no fingerprint, as for a list that could not be read), revert and restore steps
// through their planners and then `commitStep` with the plan's own hashes.
import { describe, expect, test } from 'vitest'
import {
    applyReplayMove,
    commitStep,
    createModelState,
    deriveRestoreWrites,
    emptyRecord,
    planReplay,
    planRestorePoint,
    planRevert,
    type FieldValue,
    type LiveReader,
    type ModelState,
    type Op,
    type OwnerRecord,
    type PlanResult,
    type RestorePath,
    type StepLabel,
    type StepPlan,
    type WriteOp,
} from '../historyModel'
import type { ListElementHash } from '../listFingerprint'
import { characterOwnerKey } from '../ownerPhase'

// ---------------------------------------------------------------- a live character double

interface LiveState {
    desc?: string
    firstMessage?: string
    // null stands for an alternate list that is not an array.
    list: string[] | null
    chats: Record<string, number>
    rows: string[][]
}

function stringOf(value: FieldValue): string | undefined {
    return value.had && typeof value.value === 'string' ? value.value : undefined
}

function requireList(state: LiveState): string[] {
    if (state.list === null) {
        throw new Error('the alternate list is not readable')
    }
    return state.list
}

function createLive(init: Partial<LiveState> = {}) {
    const state: LiveState = { list: [], chats: {}, rows: [], ...init }
    const reader: LiveReader = {
        field(path) {
            const value = path === 'desc' ? state.desc : path === 'firstMessage' ? state.firstMessage : undefined
            return value === undefined ? { had: false } : { had: true, value }
        },
        greetings: () => state.list,
        fmIndex(chatId) {
            const index = state.chats[chatId]
            return index === undefined ? null : { had: true, value: index }
        },
        assetRows: (array) => (array === 'additionalAssets' ? state.rows : null),
    }
    // What an owner write does to the character.
    function apply(writes: readonly WriteOp[]): void {
        for (const write of writes) {
            switch (write.op) {
                case 'set':
                    if (write.path === 'desc') {
                        state.desc = stringOf(write.value)
                    } else if (write.path === 'firstMessage') {
                        state.firstMessage = stringOf(write.value)
                    }
                    break
                case 'listSet':
                    requireList(state)[write.index] = write.value
                    break
                case 'listInsert':
                    requireList(state).splice(write.index, 0, write.value)
                    break
                case 'listRemove':
                    requireList(state).splice(write.index, 1)
                    break
                case 'chatFm':
                    if (write.value.had) {
                        state.chats[write.chatId] = write.value.value
                    } else {
                        delete state.chats[write.chatId]
                    }
                    break
                case 'assetRowRemove':
                    state.rows.splice(write.index, 1)
                    break
                case 'assetRowInsert':
                    state.rows.splice(write.index, 0, [...write.tuple])
                    break
                default:
                    break
            }
        }
    }
    return { state, reader, apply }
}

type Live = ReturnType<typeof createLive>

const GREETING_TARGET = /^alternateGreetings\/(\d+)$/

// The change a stored forward op made, applied to the live double: what the edit did before it was recorded.
function landOp(state: LiveState, op: Op): void {
    switch (op.op) {
        case 'set':
            if (op.path === 'desc') {
                state.desc = stringOf(op.after)
            } else if (op.path === 'firstMessage') {
                state.firstMessage = stringOf(op.after)
            }
            break
        case 'listSet':
            requireList(state)[op.index] = op.after
            break
        case 'listInsert':
            requireList(state).splice(op.index, 0, op.value)
            break
        case 'listRemove':
            requireList(state).splice(op.index, 1)
            break
        case 'chatFm':
            if (op.chatId !== null && op.after.had) {
                state.chats[op.chatId] = op.after.value
            }
            break
        case 'assetRowRemove':
            state.rows.splice(op.index, 1)
            break
        case 'textEdit': {
            const match = GREETING_TARGET.exec(op.target)
            if (match === null) {
                throw new Error('only alternate first message targets are landed here')
            }
            const list = requireList(state)
            const index = Number(match[1])
            list[index] = list[index].slice(0, op.offset) + op.to + list[index].slice(op.offset + op.from.length)
            break
        }
        default:
            break
    }
}

// ---------------------------------------------------------------- op builders

const text = (value: string): FieldValue => ({ had: true, value })
const setFm = (before: string, after: string): Op => ({ op: 'set', path: 'firstMessage', before: text(before), after: text(after) })
const setDesc = (before: string, after: string): Op => ({ op: 'set', path: 'desc', before: text(before), after: text(after) })
const listSet = (index: number, before: string, after: string): Op => ({ op: 'listSet', index, before, after })
const listRemove = (index: number, value: string): Op => ({ op: 'listRemove', index, value, deletedId: null })
const listInsert = (index: number, value: string): Op => ({ op: 'listInsert', index, value })
const greetingEdit = (index: number, offset: number, from: string, to: string): Op => ({ op: 'textEdit', target: `alternateGreetings/${index}`, offset, from, to })

const FIRST_MESSAGE_LABEL: StepLabel = { kind: 'field', field: 'firstMessage' }
const DESC_LABEL: StepLabel = { kind: 'field', field: 'desc' }

// ---------------------------------------------------------------- a session over the model and the double

class Chain {
    state: ModelState = createModelState(emptyRecord(characterOwnerKey('c1'), 0))
    private counter = 0

    constructor(
        readonly live: Live,
        private readonly hashFor?: ListElementHash,
    ) {}

    get record(): OwnerRecord {
        return this.state.record
    }

    private nextId(): string {
        this.counter += 1
        return `s${this.counter}`
    }

    // An edit that landed: the double changes, then the step is recorded. `listKnown` false records it as an edit made
    // while the list could not be read: no list in the restore writes, so no fingerprint.
    land(label: StepLabel, ops: Op[], options: { listKnown?: boolean } = {}): string {
        const list = this.live.state.list
        const restoreWrites = deriveRestoreWrites(ops, options.listKnown === false ? null : list)
        for (const op of ops) {
            landOp(this.live.state, op)
        }
        const id = this.nextId()
        this.state = commitStep(
            this.state,
            { id, at: this.counter * 10_000, visitId: 'v1', label, ops, restoreWrites, coalesceKey: null, replacesRestore: true },
            this.hashFor,
        )
        return id
    }

    // Records a landed plan as the service does.
    private landPlan(plan: StepPlan): void {
        this.live.apply(plan.writes)
        this.state = commitStep(
            this.state,
            {
                id: this.nextId(),
                at: this.counter * 10_000,
                visitId: 'v1',
                label: plan.label,
                ops: plan.ops,
                restoreWrites: plan.restoreWrites,
                coalesceKey: null,
                replacesRestore: false,
                deletedRemove: plan.deletedRemove,
                liveListHash: plan.liveListHash,
                afterListHash: plan.afterListHash,
            },
            this.hashFor,
        )
    }

    // The plan of an undo or a redo; nothing lands.
    replay(direction: 'undo' | 'redo', goneRows?: ReadonlySet<string>): PlanResult {
        return planReplay(this.record, direction, this.live.reader, this.hashFor, goneRows)
    }

    // An undo or a redo that lands when its plan is ok.
    replayAndLand(direction: 'undo' | 'redo'): PlanResult {
        const plan = this.replay(direction)
        if (plan.ok) {
            this.live.apply(plan.writes)
            this.state = applyReplayMove(this.state, direction, plan, 100_000, 'v1', this.hashFor)
        }
        return plan
    }

    // The plan of a revert; nothing lands.
    revertPlan(toStepId: string, budgetUnits?: number, goneRows?: ReadonlySet<string>): PlanResult {
        return planRevert(this.record, toStepId, this.live.reader, budgetUnits, this.hashFor, goneRows)
    }

    revert(toStepId: string, budgetUnits?: number): PlanResult {
        const plan = this.revertPlan(toStepId, budgetUnits)
        if (plan.ok) {
            this.landPlan(plan)
        }
        return plan
    }

    restore(): PlanResult {
        const plan = planRestorePoint(this.record.restore, this.live.reader, new Set<RestorePath>())
        if (plan.ok) {
            this.landPlan(plan)
        }
        return plan
    }
}

function shown(live: Live): { firstMessage: string | undefined; list: string[] | null } {
    return { firstMessage: live.state.firstMessage, list: live.state.list === null ? null : [...live.state.list] }
}

function writesOf(plan: PlanResult): WriteOp[] {
    if (plan.ok === false) {
        throw new Error('the plan was refused: ' + plan.reason)
    }
    return plan.writes
}

const PAIR_SPLIT = { ok: false, reason: 'pairSplit' } as const
const PRECONDITION = { ok: false, reason: 'precondition' } as const

// ---------------------------------------------------------------- the decision table on a step without a fingerprint

// A swap of the first message with the alternate at index 1: main M and entry G trade places. The step holds only
// `listSet` ops, so the per-entry outcomes decide it.
function swapChain() {
    const live = createLive({ desc: 'd0', firstMessage: 'M', list: ['A', 'G', 'C'] })
    const chain = new Chain(live)
    const anchor = chain.land(DESC_LABEL, [setDesc('d0', 'd1')])
    chain.land(FIRST_MESSAGE_LABEL, [setFm('M', 'G'), listSet(1, 'G', 'M')])
    return { live, chain, anchor }
}

interface Cell {
    name: string
    // What changed outside the step: the live state is `fm = G, list = [A, M, C]` before it.
    change: (state: LiveState) => void
    replay: 'apply' | 'already' | 'stop'
    revert: 'apply' | 'precondition' | 'stop'
}

const CELLS: Cell[] = [
    { name: 'nothing moved: both halves apply', change: () => {}, replay: 'apply', revert: 'apply' },
    // The list takes the change and the main text is already back: the first message half only holds.
    { name: 'main text already back, list still swapped', change: (s) => { s.firstMessage = 'M' }, replay: 'stop', revert: 'stop' },
    { name: 'main text changed, list still swapped', change: (s) => { s.firstMessage = 'Z' }, replay: 'stop', revert: 'stop' },
    // The list is already back and the main text still takes the change.
    { name: 'list already back, main text still swapped', change: (s) => { requireList(s)[1] = 'G' }, replay: 'stop', revert: 'stop' },
    { name: 'both already back: today\'s nothing-to-apply rules', change: (s) => { s.firstMessage = 'M'; requireList(s)[1] = 'G' }, replay: 'already', revert: 'precondition' },
    // The three cells below have no half that can apply, so the base refuses them too: they pin the reason.
    { name: 'list already back, main text changed', change: (s) => { requireList(s)[1] = 'G'; s.firstMessage = 'Z' }, replay: 'stop', revert: 'stop' },
    { name: 'list changed elsewhere, main text still swapped', change: (s) => { requireList(s)[1] = 'X' }, replay: 'stop', revert: 'stop' },
    { name: 'list changed elsewhere, main text already back', change: (s) => { requireList(s)[1] = 'X'; s.firstMessage = 'M' }, replay: 'stop', revert: 'stop' },
    { name: 'list changed elsewhere, main text changed', change: (s) => { requireList(s)[1] = 'X'; s.firstMessage = 'Z' }, replay: 'stop', revert: 'stop' },
]

describe('a swap step without a fingerprint, decided per entry', () => {
    for (const cell of CELLS) {
        test(`undo: ${cell.name}`, () => {
            const { live, chain } = swapChain()
            cell.change(live.state)
            const recordBefore = chain.record
            const plan = chain.replay('undo')
            if (cell.replay === 'stop') {
                expect(plan).toEqual(PAIR_SPLIT)
                expect(chain.record).toBe(recordBefore)
            } else if (cell.replay === 'already') {
                expect(plan.ok && plan.already).toBe('undo')
            } else {
                const writes = writesOf(plan)
                expect(writes).toContainEqual({ op: 'set', path: 'firstMessage', value: text('M') })
                expect(writes).toContainEqual({ op: 'listSet', index: 1, value: 'G' })
            }
        })

        test(`revert: ${cell.name}`, () => {
            const { live, chain, anchor } = swapChain()
            cell.change(live.state)
            const before = shown(live)
            const plan = chain.revertPlan(anchor)
            if (cell.revert === 'stop') {
                expect(plan).toEqual(PAIR_SPLIT)
                expect(shown(live)).toEqual(before)
            } else if (cell.revert === 'precondition') {
                expect(plan).toEqual(PRECONDITION)
            } else {
                const writes = writesOf(plan)
                expect(writes).toContainEqual({ op: 'set', path: 'firstMessage', value: text('M') })
                expect(writes).toContainEqual({ op: 'listSet', index: 1, value: 'G' })
                expect(plan.ok && plan.pairSkipped).toBeUndefined()
            }
        })
    }

    test('an undo that applies whole lands both texts and a redo puts them back', () => {
        const { live, chain } = swapChain()
        expect(chain.replayAndLand('undo').ok).toBe(true)
        expect(shown(live)).toEqual({ firstMessage: 'M', list: ['A', 'G', 'C'] })
        expect(chain.replayAndLand('redo').ok).toBe(true)
        expect(shown(live)).toEqual({ firstMessage: 'G', list: ['A', 'M', 'C'] })
    })

    test('a chat index that moved elsewhere never stops the pair: the step applies whole and the chat keeps its value', () => {
        const live = createLive({ desc: 'd0', firstMessage: 'M', list: ['A', 'G', 'C'], chats: { c1: 2 } })
        const chain = new Chain(live)
        const anchor = chain.land(DESC_LABEL, [setDesc('d0', 'd1')])
        chain.land(FIRST_MESSAGE_LABEL, [
            setFm('M', 'G'),
            listSet(1, 'G', 'M'),
            { op: 'chatFm', chatId: 'c1', before: { had: true, value: 2 }, after: { had: true, value: 1 } },
        ])
        live.state.chats.c1 = 5
        const undo = chain.replay('undo')
        expect(undo.ok && undo.skipped).toBe(1)
        expect(writesOf(undo)).toHaveLength(2)
        const revert = chain.revertPlan(anchor)
        expect(revert.ok && revert.skipped).toBe(1)
        expect(writesOf(revert)).toHaveLength(2)
        expect(revert.ok && revert.pairSkipped).toBeUndefined()
    })

    test('a text edit of an alternate first message is a group op: it applies with the main text or the step stops', () => {
        const live = createLive({ desc: 'd0', firstMessage: 'M', list: ['A', 'G', 'C'] })
        const chain = new Chain(live)
        const anchor = chain.land(DESC_LABEL, [setDesc('d0', 'd1')])
        chain.land(FIRST_MESSAGE_LABEL, [setFm('M', 'G'), greetingEdit(1, 0, 'G', 'M')])
        live.state.firstMessage = 'Z'
        expect(chain.replay('undo')).toEqual(PAIR_SPLIT)
        expect(chain.revertPlan(anchor)).toEqual(PAIR_SPLIT)
    })

    test('two group ops on one entry cannot be decided per entry and stop even when each would apply', () => {
        const live = createLive({ desc: 'd0', firstMessage: 'M', list: ['A', 'G', 'C'] })
        const chain = new Chain(live)
        const anchor = chain.land(DESC_LABEL, [setDesc('d0', 'd1')])
        chain.land(FIRST_MESSAGE_LABEL, [setFm('M', 'G'), listSet(1, 'G', 'N'), listSet(1, 'N', 'O')])
        expect(chain.replay('undo')).toEqual(PAIR_SPLIT)
        expect(chain.revertPlan(anchor)).toEqual(PAIR_SPLIT)
    })
})

// ---------------------------------------------------------------- a fingerprinted step

// Main M becomes G while the first alternate A is removed. The step holds a remove, so it carries a fingerprint and
// its list half is decided by the side: the live list is either the list the step produced or the one it started from.
function removeChain(hashFor?: ListElementHash) {
    const live = createLive({ desc: 'd0', firstMessage: 'M', list: ['A', 'B', 'C'] })
    const chain = new Chain(live, hashFor)
    const anchor = chain.land(DESC_LABEL, [setDesc('d0', 'd1')])
    const stepId = chain.land(FIRST_MESSAGE_LABEL, [setFm('M', 'G'), listRemove(0, 'A')])
    return { live, chain, anchor, stepId }
}

describe('a fingerprinted bound step in an undo', () => {
    test('the list on the expected side and nothing moved: both halves apply', () => {
        const { chain } = removeChain()
        const writes = writesOf(chain.replay('undo'))
        expect(writes).toContainEqual({ op: 'set', path: 'firstMessage', value: text('M') })
        expect(writes).toContainEqual({ op: 'listInsert', index: 0, value: 'A' })
    })

    test('the list on the expected side and the main text already back: stop', () => {
        const { live, chain } = removeChain()
        live.state.firstMessage = 'M'
        expect(chain.replay('undo')).toEqual(PAIR_SPLIT)
    })

    test('the list on the expected side and the main text changed: stop', () => {
        const { live, chain } = removeChain()
        live.state.firstMessage = 'Z'
        expect(chain.replay('undo')).toEqual(PAIR_SPLIT)
    })

    test('the list on the other side and the main text already back: the step moves as already undone', () => {
        const { live, chain } = removeChain()
        live.state.list = ['A', 'B', 'C']
        live.state.firstMessage = 'M'
        const plan = chain.replay('undo')
        expect(plan.ok && plan.already).toBe('undo')
    })

    // These two have no half that can apply, so the base refuses them too: they pin the reason.
    test('the list on the other side and the main text changed instead: stop', () => {
        const { live, chain } = removeChain()
        live.state.list = ['A', 'B', 'C']
        live.state.firstMessage = 'X'
        expect(chain.replay('undo')).toEqual(PAIR_SPLIT)
    })

    test('the list on the other side and the main text still at the step\'s result: stop', () => {
        const { live, chain } = removeChain()
        live.state.list = ['A', 'B', 'C']
        expect(chain.replay('undo')).toEqual(PAIR_SPLIT)
    })

    test('the list on neither side keeps the refusal that comes before the rule', () => {
        const { live, chain } = removeChain()
        live.state.list = ['X', 'Y', 'Z']
        expect(chain.replay('undo')).toEqual(PRECONDITION)
    })

    test('a list op that fails on the expected side stops the step: equal-length list changed elsewhere', () => {
        // A constant element hash makes every list of one length read as the same side, so the side reads `expected`
        // although one entry was rewritten outside.
        const constant: ListElementHash = () => () => 7
        const live = createLive({ desc: 'd0', firstMessage: 'M', list: ['A', 'B', 'C'] })
        const chain = new Chain(live, constant)
        chain.land(DESC_LABEL, [setDesc('d0', 'd1')])
        chain.land(FIRST_MESSAGE_LABEL, [setFm('M', 'G'), listRemove(0, 'A'), listSet(0, 'B', 'X')])
        // The list after the step is [X, C]; one entry is rewritten outside.
        live.state.list = ['Y', 'C']
        expect(chain.replay('undo')).toEqual(PAIR_SPLIT)
    })
})

describe('a fingerprinted bound step in a revert', () => {
    test('the list on the expected side and the main text already back: stop', () => {
        const { live, chain, anchor } = removeChain()
        live.state.firstMessage = 'M'
        expect(chain.revertPlan(anchor)).toEqual(PAIR_SPLIT)
    })

    test('the list on the expected side and the main text changed: stop', () => {
        const { live, chain, anchor } = removeChain()
        live.state.firstMessage = 'Z'
        expect(chain.revertPlan(anchor)).toEqual(PAIR_SPLIT)
    })

    test('the list on the other side and the main text still at the step\'s result: stop', () => {
        const { live, chain, anchor } = removeChain()
        live.state.list = ['A', 'B', 'C']
        expect(chain.revertPlan(anchor)).toEqual(PAIR_SPLIT)
    })

    test('the list on the other side and the main text already back: the revert has nothing to apply', () => {
        const { live, chain, anchor } = removeChain()
        live.state.list = ['A', 'B', 'C']
        live.state.firstMessage = 'M'
        expect(chain.revertPlan(anchor)).toEqual(PRECONDITION)
    })

    test('the list on the other side and the main text changed: stop, and the explanation survives', () => {
        const { live, chain, anchor } = removeChain()
        live.state.list = ['A', 'B', 'C']
        live.state.firstMessage = 'X'
        expect(chain.revertPlan(anchor)).toEqual(PAIR_SPLIT)
    })

    test('an alternate list that is not an array gives the list half neither: stop, main text unchanged', () => {
        const { live, chain, anchor } = removeChain()
        live.state.list = null
        const before = shown(live)
        expect(chain.revertPlan(anchor)).toEqual(PAIR_SPLIT)
        expect(shown(live)).toEqual(before)
    })

    // A description step between the anchor and the bound step, so the revert still lands something after the stop.
    function descThenBoundChain() {
        const live = createLive({ desc: 'd0', firstMessage: 'M', list: ['A', 'B', 'C'] })
        const chain = new Chain(live)
        const anchor = chain.land(DESC_LABEL, [setDesc('d0', 'd1')])
        chain.land(DESC_LABEL, [setDesc('d1', 'd2')])
        chain.land(FIRST_MESSAGE_LABEL, [setFm('M', 'G'), listRemove(0, 'A')])
        return { live, chain, anchor }
    }

    test('a stop with the list on the other side leaves the list ops unreported while an older step lands', () => {
        const { live, chain, anchor } = descThenBoundChain()
        live.state.list = ['A', 'B', 'C']
        live.state.firstMessage = 'X'
        const plan = chain.revertPlan(anchor)
        expect(plan.ok && plan.pairSkipped).toBe(1)
        expect(plan.ok && plan.writes).toContainEqual({ op: 'set', path: 'desc', value: text('d1') })
        expect(plan.ok && 'listSkipped' in plan).toBe(false)
    })

    test('a stop that applies nothing refuses with the plain reason when an older op also fails', () => {
        const { live, chain, anchor } = descThenBoundChain()
        live.state.firstMessage = 'M'
        live.state.desc = 'changed elsewhere'
        expect(chain.revertPlan(anchor)).toEqual(PRECONDITION)
    })
})

// ---------------------------------------------------------------- revert steps: the shapes a revert and a restore produce

describe('a revert step that holds the first message with a list change', () => {
    // Main M, [A, B, G]: delete A, swap entry 1, then revert to before both. The revert step R holds the net first
    // message and the net list change and carries a fingerprint, because a delete lay in the reverted range.
    function revertedShapeChain() {
        const live = createLive({ desc: 'd0', firstMessage: 'M', list: ['A', 'B', 'G'] })
        const chain = new Chain(live)
        const anchor = chain.land(DESC_LABEL, [setDesc('d0', 'd1')])
        chain.land({ kind: 'greetingRemove' }, [{ op: 'listRemove', index: 0, value: 'A', deletedId: 'del1' }])
        const swap = chain.land(FIRST_MESSAGE_LABEL, [setFm('M', 'G'), listSet(1, 'G', 'M')])
        expect(chain.revert(anchor).ok).toBe(true)
        expect(shown(live)).toEqual({ firstMessage: 'M', list: ['A', 'B', 'G'] })
        const top = chain.record.done[chain.record.done.length - 1]
        expect(top.listFingerprint).toBeDefined()
        return { live, chain, swap }
    }

    test('reverting it on the expected side applies both halves', () => {
        const { live, chain, swap } = revertedShapeChain()
        const plan = chain.revert(swap)
        expect(plan.ok && plan.pairSkipped).toBeUndefined()
        expect(shown(live)).toEqual({ firstMessage: 'G', list: ['B', 'M'] })
    })

    test('reverting it with both texts already put back by hand takes today\'s rules, not a pair stop', () => {
        const { live, chain, swap } = revertedShapeChain()
        live.state.firstMessage = 'G'
        live.state.list = ['B', 'M']
        expect(chain.revertPlan(swap)).toEqual(PRECONDITION)
    })

    test('undoing it applies both halves too', () => {
        const { live, chain } = revertedShapeChain()
        expect(chain.replayAndLand('undo').ok).toBe(true)
        expect(shown(live)).toEqual({ firstMessage: 'G', list: ['B', 'M'] })
    })

    test('a revert that nets a swap stops when the main text changed outside', () => {
        const live = createLive({ desc: 'd0', firstMessage: 'M', list: ['A', 'G', 'C'] })
        const chain = new Chain(live)
        const anchor = chain.land(DESC_LABEL, [setDesc('d0', 'd1')])
        const swap = chain.land(FIRST_MESSAGE_LABEL, [setFm('M', 'G'), listSet(1, 'G', 'M')])
        expect(chain.revert(anchor).ok).toBe(true)
        expect(chain.record.done[chain.record.done.length - 1].listFingerprint).toBeUndefined()
        live.state.firstMessage = 'Z'
        expect(chain.revertPlan(swap)).toEqual(PAIR_SPLIT)
        expect(chain.replay('undo')).toEqual(PAIR_SPLIT)
    })

    test('a revert that nets a swap plus an edit of one text stops when the main text changed outside', () => {
        const live = createLive({ desc: 'd0', firstMessage: 'M', list: ['A', 'G', 'C'] })
        const chain = new Chain(live)
        const anchor = chain.land(DESC_LABEL, [setDesc('d0', 'd1')])
        chain.land(FIRST_MESSAGE_LABEL, [setFm('M', 'G'), listSet(1, 'G', 'M')])
        const edit = chain.land({ kind: 'greetingEdit' }, [listSet(1, 'M', 'N')])
        expect(chain.revert(anchor).ok).toBe(true)
        expect(shown(live)).toEqual({ firstMessage: 'M', list: ['A', 'G', 'C'] })
        live.state.firstMessage = 'Z'
        expect(chain.revertPlan(edit)).toEqual(PAIR_SPLIT)
        expect(chain.replay('undo')).toEqual(PAIR_SPLIT)
    })

    test('a revert of two separate steps, one for the main text and one for an alternate, stops when the main text changed', () => {
        const live = createLive({ desc: 'd0', firstMessage: 'M', list: ['A', 'B'] })
        const chain = new Chain(live)
        const anchor = chain.land(DESC_LABEL, [setDesc('d0', 'd1')])
        chain.land(FIRST_MESSAGE_LABEL, [setFm('M', 'N')])
        const edit = chain.land({ kind: 'greetingEdit' }, [listSet(0, 'A', 'a2')])
        expect(chain.revert(anchor).ok).toBe(true)
        expect(shown(live)).toEqual({ firstMessage: 'M', list: ['A', 'B'] })
        live.state.firstMessage = 'Z'
        expect(chain.revertPlan(edit)).toEqual(PAIR_SPLIT)
    })

    test('a restore of a swap stops when the main text changed outside', () => {
        const live = createLive({ desc: 'd0', firstMessage: 'M', list: ['A', 'G', 'C'] })
        const chain = new Chain(live)
        chain.land(FIRST_MESSAGE_LABEL, [setFm('M', 'G'), listSet(1, 'G', 'M')])
        const restore = chain.restore()
        expect(restore.ok && restore.label.kind).toBe('restorePoint')
        expect(shown(live)).toEqual({ firstMessage: 'M', list: ['A', 'G', 'C'] })
        live.state.firstMessage = 'Z'
        expect(chain.replay('undo')).toEqual(PAIR_SPLIT)
    })
})

// ---------------------------------------------------------------- an unreadable list at commit

describe('a step recorded while the list could not be read', () => {
    test('a step that holds an insert and no fingerprint stops even when every op would apply', () => {
        const live = createLive({ desc: 'd0', firstMessage: 'M', list: ['A', 'B'] })
        const chain = new Chain(live)
        const anchor = chain.land(DESC_LABEL, [setDesc('d0', 'd1')])
        chain.land(FIRST_MESSAGE_LABEL, [setFm('M', 'N'), listInsert(1, 'X')], { listKnown: false })
        expect(chain.record.done[chain.record.done.length - 1].listFingerprint).toBeUndefined()
        expect(chain.replay('undo')).toEqual(PAIR_SPLIT)
        expect(chain.revertPlan(anchor)).toEqual(PAIR_SPLIT)
    })

    test('the stop sets the revert stop: an older list edit on a repeated text writes nothing', () => {
        const live = createLive({ desc: 'd0', firstMessage: 'M', list: ['A', 'B', 'C', 'D'] })
        const chain = new Chain(live)
        const anchor = chain.land(DESC_LABEL, [setDesc('d0', 'd1')])
        chain.land({ kind: 'greetingEdit' }, [listSet(1, 'B', 'C')])
        chain.land(FIRST_MESSAGE_LABEL, [setFm('M', 'N'), listRemove(0, 'A')], { listKnown: false })
        live.state.firstMessage = 'Z'
        expect(chain.revertPlan(anchor)).toEqual(PAIR_SPLIT)
    })
})

// ---------------------------------------------------------------- the revert stop, its counts and its reach

describe('a bound step that stops in a revert', () => {
    test('a stop after another step\'s revert stop: the older bound step without a fingerprint stops whole', () => {
        const live = createLive({ desc: 'd0', firstMessage: 'M', list: ['A', 'G'] })
        const chain = new Chain(live)
        const anchor = chain.land(DESC_LABEL, [setDesc('d0', 'd1')])
        chain.land(FIRST_MESSAGE_LABEL, [setFm('M', 'G'), listSet(1, 'G', 'M')])
        chain.land({ kind: 'greetingAdd' }, [listInsert(2, 'X')])
        // The appended text is rewritten outside: the newer step is off its side and stops the revert.
        requireList(live.state)[2] = 'X2'
        const before = shown(live)
        expect(chain.revertPlan(anchor)).toEqual(PAIR_SPLIT)
        expect(shown(live)).toEqual(before)
    })

    test('the explanation wins over the note about a row whose file is gone', () => {
        const live = createLive({ desc: 'd0', firstMessage: 'M', list: ['A', 'G'], rows: [['n', 'assets/x.png', 'png']] })
        const chain = new Chain(live)
        const anchor = chain.land(DESC_LABEL, [setDesc('d0', 'd1')])
        chain.land({ kind: 'assetDelete', count: 1, name: null }, [{ op: 'assetRowRemove', array: 'additionalAssets', index: 0, tuple: ['n', 'assets/x.png', 'png'], count: 1 }])
        chain.land(FIRST_MESSAGE_LABEL, [setFm('M', 'G'), listSet(1, 'G', 'M')])
        chain.land({ kind: 'greetingAdd' }, [listInsert(2, 'X')])
        requireList(live.state)[2] = 'X2'
        expect(chain.revertPlan(anchor, undefined, new Set(['assets/x.png']))).toEqual(PAIR_SPLIT)
    })

    // Budget 0: the first hashed step is decided, and the next one is suspended because the revert changed the list.
    test('a suspension alone does not stop a step without a fingerprint: the swap applies whole', () => {
        const live = createLive({ desc: 'd0', firstMessage: 'M', list: ['A', 'G', 'X', 'Y', 'Z'] })
        const chain = new Chain(live)
        const anchor = chain.land(DESC_LABEL, [setDesc('d0', 'd1')])
        chain.land(FIRST_MESSAGE_LABEL, [setFm('M', 'G'), listSet(1, 'G', 'M')])
        chain.land({ kind: 'greetingRemove' }, [listRemove(4, 'Z')])
        chain.land({ kind: 'greetingRemove' }, [listRemove(3, 'Y')])
        const plan = chain.revert(anchor, 0)
        expect(plan.ok && plan.listSkipped).toBe(1)
        expect(plan.ok && plan.pairSkipped).toBeUndefined()
        expect(shown(live)).toEqual({ firstMessage: 'M', list: ['A', 'G', 'X', 'Y'] })
    })

    test('a suspended fingerprinted bound step stops and sets the revert stop: an older list edit is skipped', () => {
        const live = createLive({ desc: 'd0', firstMessage: 'M', list: ['A', 'B', 'C'] })
        const chain = new Chain(live)
        const anchor = chain.land(DESC_LABEL, [setDesc('d0', 'd1')])
        chain.land({ kind: 'greetingEdit' }, [listSet(0, 'A', 'a2')])
        chain.land(FIRST_MESSAGE_LABEL, [setFm('M', 'N'), listRemove(2, 'C')])
        chain.land({ kind: 'greetingEdit' }, [listSet(1, 'B', 'b3')])
        const plan = chain.revert(anchor, 0)
        expect(plan.ok && plan.pairSkipped).toBe(1)
        expect(plan.ok && plan.listSkipped).toBe(2)
        expect(shown(live)).toEqual({ firstMessage: 'N', list: ['a2', 'B'] })
    })

    // Live [A, B, C, D]; S1 rewrites entry 1 to C, S2 removes entry 0 together with the main text. The main text
    // changed outside, so S2 stops, and S1 must not write C back over entry 1 of the shifted list.
    test('a stop at a fingerprinted step on the expected side: the older list edit on a repeated text writes nothing', () => {
        const live = createLive({ desc: 'd0', firstMessage: 'M', list: ['A', 'B', 'C', 'D'] })
        const chain = new Chain(live)
        const anchor = chain.land(DESC_LABEL, [setDesc('d0', 'd1')])
        chain.land({ kind: 'greetingEdit' }, [listSet(1, 'B', 'C')])
        chain.land(FIRST_MESSAGE_LABEL, [setFm('M', 'N'), listRemove(0, 'A')])
        live.state.firstMessage = 'Z'
        const before = shown(live)
        expect(chain.revertPlan(anchor)).toEqual(PAIR_SPLIT)
        expect(shown(live)).toEqual(before)
    })

    test('the same stop on a step recorded without a fingerprint also writes nothing', () => {
        const live = createLive({ desc: 'd0', firstMessage: 'M', list: ['A', 'B', 'C', 'D'] })
        const chain = new Chain(live)
        const anchor = chain.land(DESC_LABEL, [setDesc('d0', 'd1')])
        chain.land({ kind: 'greetingEdit' }, [listSet(1, 'B', 'C')])
        chain.land(FIRST_MESSAGE_LABEL, [setFm('M', 'N'), listRemove(0, 'A')], { listKnown: false })
        live.state.firstMessage = 'Z'
        expect(chain.revertPlan(anchor)).toEqual(PAIR_SPLIT)
    })

    test('a description step in the range still reverts and the stop is counted', () => {
        const live = createLive({ desc: 'd0', firstMessage: 'M', list: ['A', 'B', 'C', 'D'] })
        const chain = new Chain(live)
        const anchor = chain.land(DESC_LABEL, [setDesc('d0', 'd1')])
        chain.land({ kind: 'greetingEdit' }, [listSet(1, 'B', 'C')])
        chain.land(DESC_LABEL, [setDesc('d1', 'd2')])
        chain.land(FIRST_MESSAGE_LABEL, [setFm('M', 'N'), listRemove(0, 'A')])
        live.state.firstMessage = 'Z'
        const plan = chain.revertPlan(anchor)
        expect(writesOf(plan)).toEqual([{ op: 'set', path: 'desc', value: text('d1') }])
        expect(plan.ok && plan.pairSkipped).toBe(1)
        expect(plan.ok && plan.listSkipped).toBe(2)
        expect(plan.ok && plan.skipped).toBe(3)
        expect(shown(live).list).toEqual(['C', 'C', 'D'])
    })

    test('a stop at a step with only list edits leaves older steps free to revert', () => {
        const live = createLive({ desc: 'd0', firstMessage: 'M', list: ['A', 'B', 'C'] })
        const chain = new Chain(live)
        const anchor = chain.land(DESC_LABEL, [setDesc('d0', 'd1')])
        chain.land({ kind: 'greetingEdit' }, [listSet(0, 'A', 'a1')])
        chain.land(FIRST_MESSAGE_LABEL, [setFm('M', 'N'), listSet(2, 'C', 'c2')])
        live.state.firstMessage = 'Z'
        const plan = chain.revertPlan(anchor)
        expect(writesOf(plan)).toEqual([{ op: 'listSet', index: 0, value: 'A' }])
        expect(plan.ok && plan.pairSkipped).toBe(1)
        expect(plan.ok && plan.listSkipped).toBe(1)
    })

    test('a revert whose other steps net to nothing reports the pair skip with the unchanged result', () => {
        const live = createLive({ desc: 'd0', firstMessage: 'M', list: ['A', 'B', 'C'] })
        const chain = new Chain(live)
        const anchor = chain.land(DESC_LABEL, [setDesc('d0', 'd1')])
        chain.land({ kind: 'greetingEdit' }, [listSet(0, 'A', 'a1')])
        chain.land({ kind: 'greetingEdit' }, [listSet(0, 'a1', 'A')])
        chain.land(FIRST_MESSAGE_LABEL, [setFm('M', 'N'), listSet(2, 'C', 'c3')])
        live.state.firstMessage = 'Z'
        expect(chain.revertPlan(anchor)).toEqual({ ok: false, reason: 'unchanged', listSkipped: 1, pairSkipped: 1 })
    })
})
