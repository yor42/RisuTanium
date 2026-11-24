import fc from 'fast-check'
import { describe, expect, test } from 'vitest'
import { applyFolderOps } from '../../assets/folderCodec'
import {
    applyReplayMove,
    commitStep,
    createModelState,
    deriveRestoreWrites,
    emptyRecord,
    listSideOf,
    planReplay,
    planRestoreDeleted,
    planRevert,
    isObjItem,
    type DeletedItem,
    type FmValue,
    type GreetingDeletedItem,
    type LiveReader,
    type ModelState,
    type Op,
    type OwnerRecord,
    type PlanResult,
    type Step,
    type StepLabel,
    type StepPlan,
    type WriteOp,
} from '../historyModel'
import { characterOwnerKey } from '../ownerPhase'

// Invariant: after every Undo, Redo, revert commit, move (R1) and drop (R1c), on its produced state, a
// text-moving first message that the step references is in at least one place, in exactly one place
// when it was in exactly one before or when the outcome is a move or a drop, and a revert's tail pair
// leaves its item listed or unlisted as the pair table says. A refusal changes nothing, a moved or
// dropped step writes nothing, an asset-only or merge step never touches History's deleted list, and every
// step that inserts or removes carries its list fingerprint unless the legacy prefix stripped it.
//
// The world is the real model over a live owner double. Texts are fresh per action, so a text names one
// item; the cases that rest on equal texts are plain rows in historyModel.test.ts.

// ---------------------------------------------------------------- the world

const LORE_TARGET = 'lore/0/content'

interface Owned {
    greetings: string[]
    fm: number | undefined
    desc: string
    rows: string[][]
    lore: string
    folder: unknown
}

interface World extends Owned {
    // The reader hides the list from the model only; the array itself stays the place the oracle judges.
    readable: boolean
}

// Every text of the world is one asset reference, because a merge's `textEdit` applies only to a whole scanned
// reference name: the generated merge edits rename the name inside it.
const shaped = (name: string): string => `{{image::${name}}}`
const SHAPED_OPEN = '{{image::'.length
const SHAPED_CLOSE = '}}'.length

// This property world holds greetings only, so every listed item is a greeting item.
function greetingItems(items: readonly DeletedItem[]): GreetingDeletedItem[] {
    return items.filter((item): item is GreetingDeletedItem => !isObjItem(item))
}

function startWorld(): World {
    return {
        greetings: [shaped('base0'), shaped('base1'), shaped('base2')],
        fm: 1,
        desc: shaped('d0'),
        rows: [['r0', 'p0'], ['r1', 'p1']],
        lore: shaped('lore0'),
        folder: undefined,
        readable: true,
    }
}

function readerOf(w: World): LiveReader {
    return {
        field: (path) => (path === 'desc' ? { had: true, value: w.desc } : { had: false }),
        greetings: () => (w.readable ? w.greetings : null),
        fmIndex: (chatId) => (chatId === 'chatA' ? (w.fm === undefined ? { had: false } : { had: true, value: w.fm }) : null),
        assetRows: (array) => (array === 'additionalAssets' ? w.rows : []),
        folderValue: () => w.folder,
        text: (target) => (target === LORE_TARGET ? w.lore : null),
    }
}

function splice(text: string, edit: { offset: number; from: string; to: string }): string {
    return text.slice(0, edit.offset) + edit.to + text.slice(edit.offset + edit.from.length)
}

// The owner writes an action makes when it lands `ops` forward. A text edit lands as the whole value it produces,
// computed here on a running copy of the world's texts: this is the oracle the model's own writes are judged by.
function forwardWrites(ops: readonly Op[], w?: World): WriteOp[] {
    const running = new Map<string, string>()
    const currentText = (target: string): string => {
        const known = running.get(target)
        if (known !== undefined) {
            return known
        }
        if (!w) {
            throw new Error('a text edit needs the world it lands on')
        }
        return target === 'desc' ? w.desc : target === LORE_TARGET ? w.lore : w.greetings[Number(target.slice('alternateGreetings/'.length))]
    }
    return ops.flatMap<WriteOp>((op) => {
        switch (op.op) {
            case 'textEdit': {
                const value = splice(currentText(op.target), op)
                running.set(op.target, value)
                if (op.target === 'desc') {
                    return [{ op: 'set', path: 'desc', value: { had: true, value } }]
                }
                return op.target.startsWith('alternateGreetings/')
                    ? [{ op: 'listSet', index: Number(op.target.slice('alternateGreetings/'.length)), value }]
                    : [{ op: 'textSet', target: op.target, value }]
            }
            case 'set':
                return [{ op: 'set', path: op.path, value: op.after }]
            case 'listSet':
                return [{ op: 'listSet', index: op.index, value: op.after }]
            case 'listInsert':
                return [{ op: 'listInsert', index: op.index, value: op.value }]
            case 'listRemove':
                return [{ op: 'listRemove', index: op.index }]
            case 'chatFm':
                return op.chatId === null ? [] : [{ op: 'chatFm', chatId: op.chatId, value: op.after }]
            // The world holds no object list.
            case 'objInsert':
            case 'objRemove':
            case 'objSet':
            case 'propSet':
                return []
            default:
                return [op]
        }
    })
}

function applyWrites(w: World, writes: readonly WriteOp[]): void {
    for (const write of writes) {
        switch (write.op) {
            case 'set':
                if (write.path === 'desc' && write.value.had && typeof write.value.value === 'string') {
                    w.desc = write.value.value
                }
                break
            case 'listSet':
                w.greetings[write.index] = write.value
                break
            case 'listInsert':
                w.greetings.splice(write.index, 0, write.value)
                break
            case 'listRemove':
                w.greetings.splice(write.index, 1)
                break
            case 'chatFm':
                w.fm = write.value.had ? write.value.value : undefined
                break
            case 'assetRowRemove':
                w.rows.splice(write.index, 1)
                break
            case 'assetRowInsert':
                w.rows.splice(write.index, 0, [...write.tuple])
                break
            case 'assetRowSet':
                w.rows[write.index] = [...write.after]
                break
            case 'assetFolderSet':
            case 'assetFolderOrder': {
                const result = applyFolderOps(
                    w.folder,
                    write.op === 'assetFolderSet'
                        ? [{ kind: 'assetFolderSet', name: write.name, before: write.before, after: write.after }]
                        : [{ kind: 'assetFolderOrder', before: write.before, after: write.after }],
                )
                if (result.ok) {
                    w.folder = result.doc ?? undefined
                }
                break
            }
            case 'textSet':
                if (write.target === LORE_TARGET) {
                    w.lore = write.value
                }
                break
        }
    }
}

function ownedOf(w: World): Owned {
    return structuredClone({ greetings: w.greetings, fm: w.fm, desc: w.desc, rows: w.rows, lore: w.lore, folder: w.folder })
}

function folderHasX(w: World): boolean {
    const doc = w.folder
    if (typeof doc !== 'object' || doc === null || !('additional' in doc)) {
        return false
    }
    const additional = doc.additional
    if (typeof additional !== 'object' || additional === null || !('of' in additional) || !Array.isArray(additional.of)) {
        return false
    }
    return additional.of.some((entry: unknown) => Array.isArray(entry) && entry[0] === 'x')
}

// ---------------------------------------------------------------- actions

type Action =
    | { k: 'add' }
    | { k: 'delete'; at: number; chat: 0 | 1 | 2 }
    | { k: 'restore'; at: number }
    | { k: 'edit'; at: number }
    | { k: 'desc' }
    | { k: 'assetRemove'; at: number }
    | { k: 'assetInsert'; at: number }
    | { k: 'assetSet'; at: number }
    | { k: 'folder' }
    | { k: 'merge'; parts: number }
    | { k: 'revert'; at: number }
    | { k: 'undo' }
    | { k: 'redo' }
    | { k: 'lose' }
    | { k: 'evict' }
    | { k: 'outRemove'; at: number }
    | { k: 'outInsert'; at: number }
    | { k: 'outRewrite'; at: number }
    | { k: 'outChat'; value: number }
    | { k: 'unreadable' }

const nat = fc.nat(8)
const actionArb: fc.Arbitrary<Action> = fc.oneof(
    { weight: 3, arbitrary: fc.constant<Action>({ k: 'add' }) },
    { weight: 4, arbitrary: fc.tuple(nat, fc.constantFrom<0 | 1 | 2>(0, 0, 1, 2)).map<Action>(([at, chat]) => ({ k: 'delete', at, chat })) },
    { weight: 3, arbitrary: nat.map<Action>((at) => ({ k: 'restore', at })) },
    { weight: 1, arbitrary: nat.map<Action>((at) => ({ k: 'edit', at })) },
    { weight: 1, arbitrary: fc.constant<Action>({ k: 'desc' }) },
    { weight: 1, arbitrary: nat.map<Action>((at) => ({ k: 'assetRemove', at })) },
    { weight: 1, arbitrary: nat.map<Action>((at) => ({ k: 'assetInsert', at })) },
    { weight: 1, arbitrary: nat.map<Action>((at) => ({ k: 'assetSet', at })) },
    { weight: 1, arbitrary: fc.constant<Action>({ k: 'folder' }) },
    { weight: 2, arbitrary: fc.integer({ min: 1, max: 7 }).map<Action>((parts) => ({ k: 'merge', parts })) },
    { weight: 3, arbitrary: nat.map<Action>((at) => ({ k: 'revert', at })) },
    { weight: 5, arbitrary: fc.constant<Action>({ k: 'undo' }) },
    { weight: 4, arbitrary: fc.constant<Action>({ k: 'redo' }) },
    { weight: 4, arbitrary: fc.constant<Action>({ k: 'lose' }) },
    { weight: 2, arbitrary: fc.constant<Action>({ k: 'evict' }) },
    { weight: 1, arbitrary: nat.map<Action>((at) => ({ k: 'outRemove', at })) },
    { weight: 2, arbitrary: nat.map<Action>((at) => ({ k: 'outInsert', at })) },
    { weight: 1, arbitrary: nat.map<Action>((at) => ({ k: 'outRewrite', at })) },
    { weight: 1, arbitrary: fc.constantFrom(-1, 0, 1, 2).map<Action>((value) => ({ k: 'outChat', value })) },
    { weight: 1, arbitrary: fc.constant<Action>({ k: 'unreadable' }) },
)

// The first `legacy` first-message steps of a run are stored as the producer before the fingerprint wrote them.
type Input = readonly [number, readonly Action[]]
const inputArb: fc.Arbitrary<Input> = fc.tuple(fc.integer({ min: 0, max: 4 }), fc.array(actionArb, { maxLength: 40, size: 'max' }))

interface Tally {
    r1Undo: number
    r1Redo: number
    r1cConsumed: number
    r1cUnverifiable: number
    g1: number
    g2Undo: number
    g2Redo: number
    partial: number
    forwardConsumerNeither: number
    undoneProducerNeither: number
    x2Drop: number
    applied: number
    refused: number
    reverts: number
}

function emptyTally(): Tally {
    return {
        r1Undo: 0,
        r1Redo: 0,
        r1cConsumed: 0,
        r1cUnverifiable: 0,
        g1: 0,
        g2Undo: 0,
        g2Redo: 0,
        partial: 0,
        forwardConsumerNeither: 0,
        undoneProducerNeither: 0,
        x2Drop: 0,
        applied: 0,
        refused: 0,
        reverts: 0,
    }
}

const isListShape = (op: Op): boolean => op.op === 'listInsert' || op.op === 'listRemove'
const touchesList = (op: Op): boolean => op.op === 'listSet' || isListShape(op) || (op.op === 'textEdit' && op.target.startsWith('alternateGreetings/'))
const isAssetOnly = (step: Step): boolean => step.ops.length > 0 && step.ops.every((op) => op.op.startsWith('asset') || op.op === 'textEdit')

interface Item {
    id: string
    text: string
}

// Text-moving items: a delete step's removal and a History restore's label. A revert's ids are tail pairs.
function textMovingOf(step: Step): Item[] {
    if (step.label.kind === 'revert') {
        return []
    }
    const items: Item[] = []
    for (const op of step.ops) {
        if (op.op === 'listRemove' && op.deletedId !== null) {
            items.push({ id: op.deletedId, text: op.value })
        }
    }
    if (step.label.kind === 'restoreDeleted') {
        const insert = step.ops.find((op) => op.op === 'listInsert')
        if (insert && insert.op === 'listInsert') {
            items.push({ id: step.label.deletedId, text: insert.value })
        }
    }
    return items
}

function pairsOf(step: Step): { consumers: Item[]; producers: Item[] } {
    const consumers: Item[] = []
    const producers: Item[] = []
    if (step.label.kind === 'revert') {
        for (const op of step.ops) {
            if (op.op === 'listInsert' && op.deletedId !== undefined) {
                consumers.push({ id: op.deletedId, text: op.value })
            } else if (op.op === 'listRemove' && op.deletedId !== null) {
                producers.push({ id: op.deletedId, text: op.value })
            }
        }
    }
    return { consumers, producers }
}

const listedIn = (record: OwnerRecord, id: string): boolean => record.deleted.some((item) => item.id === id)

interface Place {
    record: OwnerRecord
    list: readonly string[]
}

const placesOf = (item: Item, at: Place): number => (at.list.includes(item.text) ? 1 : 0) + (listedIn(at.record, item.id) ? 1 : 0)

// ---------------------------------------------------------------- one run

function noFingerprint(step: Step): Step {
    return { id: step.id, at: step.at, label: step.label, ops: step.ops }
}

function runActions(input: Input, tally: Tally): string | null {
    const [legacy, actions] = input
    const w = startWorld()
    let state: ModelState = createModelState(emptyRecord(characterOwnerKey('c1'), 0))
    let fresh = 0
    let stepCounter = 0
    let itemCounter = 0
    let at = 0
    let legacyLeft = legacy
    const legacyIds = new Set<string>()
    const duplicated = new Set<string>()
    let loseNext: Owned | null = null
    const nextStepId = (): string => `s${++stepCounter}`

    const noteDuplicates = (): void => {
        const seen = new Set<string>()
        for (const text of w.greetings) {
            if (seen.has(text)) {
                duplicated.add(text)
            }
            seen.add(text)
        }
        const listed = new Set<string>()
        for (const item of greetingItems(state.record.deleted)) {
            if (listed.has(item.value)) {
                duplicated.add(item.value)
            }
            listed.add(item.value)
        }
    }

    const commit = (label: StepLabel, ops: Op[], restoreWrites: ReturnType<typeof deriveRestoreWrites>, replacesRestore: boolean, extra: Partial<StepPlan> = {}): void => {
        const deletedBefore = JSON.stringify(state.record.deleted)
        state = commitStep(state, {
            id: nextStepId(),
            at,
            visitId: 'v1',
            label,
            ops,
            restoreWrites,
            coalesceKey: null,
            replacesRestore,
            ...(extra.deletedRemove ? { deletedRemove: extra.deletedRemove } : {}),
            ...(extra.liveListHash !== undefined ? { liveListHash: extra.liveListHash } : {}),
            ...(extra.afterListHash !== undefined ? { afterListHash: extra.afterListHash } : {}),
        })
        // An asset-only or merge step never touches History's deleted list.
        if (ops.length > 0 && ops.every((op) => op.op.startsWith('asset') || op.op === 'textEdit') && JSON.stringify(state.record.deleted) !== deletedBefore) {
            throw new Error('an asset-only step changed History deleted list at commit')
        }
    }

    // A first-message step of the legacy prefix keeps its four keys only.
    const markLegacy = (): void => {
        if (legacyLeft > 0) {
            legacyLeft -= 1
            const top = state.record.done[state.record.done.length - 1]
            legacyIds.add(top.id)
            state = { record: { ...state.record, done: state.record.done.map((step) => (step.id === top.id ? noFingerprint(step) : step)) }, open: null }
        }
    }

    // The judgement of one outcome on its produced state.
    const judge = (kind: 'undo' | 'redo' | 'revert', how: 'applied' | 'partial' | 'move' | 'drop', step: Step, hadFingerprint: boolean, before: Place, after: Place): string | null => {
        const forward = kind !== 'undo'
        const pairs = pairsOf(step)
        for (const item of pairs.consumers) {
            const listed = listedIn(after.record, item.id)
            if (listed === forward) {
                return `tail pair: consumer ${item.id} ${forward ? 'listed after a forward outcome' : 'unlisted after an Undo'}`
            }
            if (forward && !after.list.includes(item.text)) {
                tally.forwardConsumerNeither += 1
            }
        }
        for (const item of pairs.producers) {
            const listed = listedIn(after.record, item.id)
            if (listed !== forward) {
                return `tail pair: producer ${item.id} ${forward ? 'unlisted after a forward outcome' : 'listed after an Undo'}`
            }
            if (!forward && !after.list.includes(item.text)) {
                tally.undoneProducerNeither += 1
            }
        }
        for (const item of textMovingOf(step)) {
            const inListBefore = before.list.includes(item.text)
            const inListAfter = after.list.includes(item.text)
            const listedBefore = listedIn(before.record, item.id)
            const listedAfter = listedIn(after.record, item.id)
            // A legacy step (no fingerprint) whose two places the outcome leaves as they were: nothing can be judged.
            if (!hadFingerprint && inListBefore === inListAfter && listedBefore === listedAfter) {
                continue
            }
            const places = placesOf(item, after)
            if (places < 1) {
                return `no loss: item ${item.id} (${item.text}) is in neither place after ${kind} (${how})`
            }
            // A text that was twice in one place earlier is excluded from the exactly-one check.
            if (duplicated.has(item.text)) {
                continue
            }
            if (placesOf(item, before) === 1 && places !== 1) {
                return `exactly one place: item ${item.id} (${item.text}) was in one place and is in ${places} after ${kind} (${how})`
            }
            if ((how === 'move' || how === 'drop') && places !== 1) {
                return `exactly one place: item ${item.id} (${item.text}) is in ${places} places after a ${how}`
            }
        }
        if (isAssetOnly(step) && JSON.stringify(before.record.deleted) !== JSON.stringify(after.record.deleted)) {
            return `an asset-only step changed History's deleted list`
        }
        return null
    }

    const replay = (direction: 'undo' | 'redo'): string | null => {
        const record = state.record
        const top = (direction === 'undo' ? record.done : record.undone).at(-1)
        const reader = readerOf(w)
        const recordJson = JSON.stringify(record)
        const worldJson = JSON.stringify(w)
        const plan: PlanResult = planReplay(record, direction, reader)
        if (plan.ok === false) {
            tally.refused += 1
            if (JSON.stringify(state.record) !== recordJson || JSON.stringify(w) !== worldJson) {
                return `a refused ${direction} changed state`
            }
            if (top && plan.reason === 'precondition') {
                if (top.listFingerprint && w.readable && listSideOf(top, direction, w.greetings) === 'neither') {
                    tally.g1 += 1
                } else if (!w.readable && top.ops.some(touchesList)) {
                    if (direction === 'undo') {
                        tally.g2Undo += 1
                    } else {
                        tally.g2Redo += 1
                    }
                }
            }
            return null
        }
        if (!top) {
            return `${direction} planned without a step`
        }
        const before: Place = { record, list: [...w.greetings] }
        const consumedBefore = top.ops.some((op) => op.op === 'listRemove' && op.deletedId !== null && !listedIn(record, op.deletedId))
        let how: 'applied' | 'partial' | 'move' | 'drop' = 'applied'
        if (plan.already !== undefined) {
            how = 'move'
            if (direction === 'undo') {
                tally.r1Undo += 1
            } else {
                tally.r1Redo += 1
            }
        } else if (plan.dropStep) {
            how = 'drop'
            if (consumedBefore) {
                tally.r1cConsumed += 1
            } else {
                tally.r1cUnverifiable += 1
            }
            if (!top.listFingerprint) {
                tally.x2Drop += 1
            }
        } else if (plan.skipped > 0) {
            how = 'partial'
            tally.partial += 1
        } else {
            tally.applied += 1
        }
        if ((how === 'move' || how === 'drop') && plan.writes.length > 0) {
            return `a ${how} wrote`
        }
        applyWrites(w, plan.writes)
        state = applyReplayMove(state, direction, plan, at, 'v1')
        noteDuplicates()
        return judge(direction, how, top, top.listFingerprint !== undefined, before, { record: state.record, list: w.greetings })
    }

    const commitPlan = (plan: StepPlan, kind: 'revert' | 'restore'): string | null => {
        const before: Place = { record: state.record, list: [...w.greetings] }
        applyWrites(w, plan.writes)
        commit(plan.label, plan.ops, plan.restoreWrites, false, plan)
        noteDuplicates()
        if (kind === 'revert') {
            tally.reverts += 1
            const step = state.record.done[state.record.done.length - 1]
            return judge('revert', 'applied', step, true, before, { record: state.record, list: w.greetings })
        }
        return null
    }

    for (const [n, act] of actions.entries()) {
        at += 5000
        const label = `#${n} ${JSON.stringify(act)}`
        const recordBefore = state.record
        const readable = w.readable
        switch (act.k) {
            case 'add':
                if (readable) {
                    const value = shaped(`t${++fresh}`)
                    const index = w.greetings.length
                    const ops: Op[] = [{ op: 'listInsert', index, value }]
                    const greetings = [...w.greetings]
                    applyWrites(w, forwardWrites(ops))
                    commit({ kind: 'greetingAdd' }, ops, deriveRestoreWrites(ops, greetings), true)
                    markLegacy()
                }
                break
            case 'delete':
                if (readable && w.greetings.length > 0) {
                    const index = act.at % w.greetings.length
                    const value = w.greetings[index]
                    if (greetingItems(state.record.deleted).some((item) => item.value === value)) {
                        break
                    }
                    const deletedId = `del${++itemCounter}`
                    const fmBefore: FmValue = w.fm === undefined ? { had: false } : { had: true, value: w.fm }
                    const ops: Op[] = [{ op: 'listRemove', index, value, deletedId }]
                    if (act.chat === 0) {
                        ops.push({ op: 'chatFm', chatId: 'chatA', before: fmBefore, after: { had: true, value: -1 } })
                    } else if (act.chat === 1) {
                        ops.push({ op: 'chatFm', chatId: null, before: { had: false }, after: { had: true, value: -1 } })
                    }
                    const greetings = [...w.greetings]
                    w.greetings.splice(index, 1)
                    if (act.chat === 0) {
                        w.fm = -1
                    }
                    commit({ kind: 'greetingRemove' }, ops, deriveRestoreWrites(ops, greetings), true)
                    markLegacy()
                }
                break
            case 'restore':
                if (readable && state.record.deleted.length > 0) {
                    const item: DeletedItem = state.record.deleted[act.at % state.record.deleted.length]
                    if (!isObjItem(item) && w.greetings.includes(item.value)) {
                        break
                    }
                    const plan = planRestoreDeleted(state.record, item.id, readerOf(w), { chatId: 'chatA' })
                    if (plan.ok) {
                        const failure = commitPlan(plan, 'restore')
                        if (failure) {
                            return `${label}: ${failure}`
                        }
                        markLegacy()
                    }
                }
                break
            case 'edit':
                if (readable && w.greetings.length > 0) {
                    const index = act.at % w.greetings.length
                    const ops: Op[] = [{ op: 'listSet', index, before: w.greetings[index], after: shaped(`t${++fresh}`) }]
                    const greetings = [...w.greetings]
                    applyWrites(w, forwardWrites(ops))
                    commit({ kind: 'greetingEdit' }, ops, deriveRestoreWrites(ops, greetings), true)
                    markLegacy()
                }
                break
            case 'desc': {
                const ops: Op[] = [{ op: 'set', path: 'desc', before: { had: true, value: w.desc }, after: { had: true, value: shaped(`D${++fresh}`) } }]
                const greetings = [...w.greetings]
                applyWrites(w, forwardWrites(ops))
                commit({ kind: 'field', field: 'desc' }, ops, deriveRestoreWrites(ops, greetings), true)
                break
            }
            case 'assetRemove':
                if (w.rows.length > 0) {
                    const index = act.at % w.rows.length
                    const tuple = [...w.rows[index]]
                    const op: Op = { op: 'assetRowRemove', array: 'additionalAssets', index, tuple, count: 1 }
                    applyWrites(w, forwardWrites([op]))
                    commit({ kind: 'assetDelete', count: 1, name: tuple[0] }, [op], [], false)
                }
                break
            case 'assetInsert': {
                const index = act.at % (w.rows.length + 1)
                const tuple = [`n${++fresh}`, `q${fresh}`]
                const op: Op = { op: 'assetRowInsert', array: 'additionalAssets', index, tuple, count: 0 }
                applyWrites(w, forwardWrites([op]))
                commit({ kind: 'assetRename', from: 'a', to: 'b' }, [op], [], false)
                break
            }
            case 'assetSet':
                if (w.rows.length > 0) {
                    const index = act.at % w.rows.length
                    const op: Op = { op: 'assetRowSet', array: 'additionalAssets', index, before: [...w.rows[index]], after: [`s${++fresh}`, w.rows[index][1]] }
                    applyWrites(w, forwardWrites([op]))
                    commit({ kind: 'assetRename', from: 'a', to: 'b' }, [op], [], false)
                }
                break
            case 'folder': {
                const on = folderHasX(w)
                const op: Op = {
                    op: 'assetFolderSet',
                    name: 'x',
                    before: on ? { had: true, value: 'F' } : { had: false },
                    after: on ? { had: false } : { had: true, value: 'F' },
                }
                applyWrites(w, forwardWrites([op]))
                commit({ kind: 'folderDelete', name: 'F' }, [op], [], false)
                break
            }
            case 'merge': {
                const ops: Op[] = []
                const edit = (target: string, current: string): Op => ({
                    op: 'textEdit',
                    target,
                    offset: SHAPED_OPEN,
                    from: current.slice(SHAPED_OPEN, current.length - SHAPED_CLOSE),
                    to: `m${++fresh}`,
                })
                if (act.parts & 1) {
                    ops.push(edit(LORE_TARGET, w.lore))
                }
                if (act.parts & 2 && readable && w.greetings.length > 0) {
                    const index = (act.parts + w.greetings.length) % w.greetings.length
                    ops.push(edit(`alternateGreetings/${index}`, w.greetings[index]))
                }
                if (act.parts & 4) {
                    ops.push(edit('desc', w.desc))
                }
                if (ops.length === 0) {
                    break
                }
                const greetings = [...w.greetings]
                const descBefore = w.desc
                applyWrites(w, forwardWrites(ops, w))
                commit({ kind: 'assetMerge', from: 'a', to: 'b' }, ops, deriveRestoreWrites(ops, greetings, { desc: descBefore }), false)
                break
            }
            case 'revert':
                if (state.record.done.length > 1 && legacyLeft === 0) {
                    const target = state.record.done[act.at % (state.record.done.length - 1)]
                    const plan = planRevert(state.record, target.id, readerOf(w))
                    if (plan.ok) {
                        const failure = commitPlan(plan, 'revert')
                        if (failure) {
                            return `${label}: ${failure}`
                        }
                    }
                }
                break
            case 'undo':
            case 'redo': {
                const failure = replay(act.k)
                if (failure) {
                    return `${label}: ${failure}`
                }
                break
            }
            case 'lose':
                loseNext = ownedOf(w)
                break
            case 'evict':
                if (state.record.deleted.length > 0) {
                    state = { record: { ...state.record, deleted: state.record.deleted.slice(1) }, open: null }
                }
                break
            case 'outRemove':
                if (w.greetings.length > 0) {
                    w.greetings.splice(act.at % w.greetings.length, 1)
                }
                break
            case 'outInsert':
                w.greetings.splice(act.at % (w.greetings.length + 1), 0, shaped(`o${++fresh}`))
                break
            case 'outRewrite':
                if (w.greetings.length > 0) {
                    w.greetings[act.at % w.greetings.length] = shaped(`o${++fresh}`)
                }
                break
            case 'outChat':
                w.fm = act.value
                break
            case 'unreadable':
                w.readable = !w.readable
                break
        }
        noteDuplicates()
        // Every step that inserts or removes carries its fingerprint, unless the legacy prefix stripped it.
        for (const step of [...state.record.done, ...state.record.undone]) {
            if (step.ops.some(isListShape) && !step.listFingerprint && !legacyIds.has(step.id)) {
                return `${label}: step ${step.id} inserts or removes without a fingerprint`
            }
        }
        // The next owner write is lost: its history step landed, the live owner kept its snapshot.
        if (loseNext && act.k !== 'lose' && state.record !== recordBefore) {
            Object.assign(w, structuredClone(loseNext))
            loseNext = null
        }
    }
    return null
}

// ---------------------------------------------------------------- named examples and the property

// Each example is a sequence that once found a loss or a wrong drop; each is a plain row in historyModel.test.ts.
const EXAMPLES: { name: string; input: Input; reaches: (tally: Tally) => boolean }[] = [
    {
        // A fingerprinted delete whose item left History while the list drifted: refused on neither, then applied.
        name: 'a fingerprinted delete with an evicted item and a drifted list is refused, then applied once the list is back',
        input: [0, [{ k: 'delete', at: 0, chat: 0 }, { k: 'evict' }, { k: 'outInsert', at: 0 }, { k: 'undo' }, { k: 'outRemove', at: 0 }, { k: 'undo' }]],
        reaches: (t) => t.g1 === 1 && t.applied === 1,
    },
    {
        // A revert across a Restore deleted and a later delete, its owner write lost, one item cut: Undo drops it.
        name: 'a revert that consumed one item and produced another, write lost and the producer cut, is dropped by Undo',
        input: [0, [{ k: 'delete', at: 1, chat: 0 }, { k: 'restore', at: 0 }, { k: 'delete', at: 2, chat: 0 }, { k: 'lose' }, { k: 'revert', at: 0 }, { k: 'evict' }, { k: 'undo' }]],
        reaches: (t) => t.reverts === 1 && t.r1cConsumed + t.r1Undo >= 1,
    },
    {
        // The legacy form: an unfingerprinted delete whose item was evicted is dropped, which loses nothing that could be judged.
        name: 'a legacy delete with an evicted item and an outside insert is dropped by Undo',
        input: [1, [{ k: 'delete', at: 0, chat: 2 }, { k: 'evict' }, { k: 'outInsert', at: 0 }, { k: 'undo' }]],
        reaches: (t) => t.x2Drop === 1 && t.r1cConsumed === 1,
    },
    {
        // An unreadable list under a fingerprinted delete with an applicable chat op and no listed item.
        name: 'an unreadable list refuses the Undo of a delete whose item left History instead of applying the chat op',
        input: [0, [{ k: 'delete', at: 0, chat: 0 }, { k: 'evict' }, { k: 'unreadable' }, { k: 'undo' }]],
        reaches: (t) => t.g2Undo === 1,
    },
    {
        // A revert that produced two items, its write lost, one item cut: Undo drops it and releases the other.
        name: 'a revert that produced two items with its write lost is moved or dropped, the listed item released',
        input: [0, [{ k: 'desc' }, { k: 'delete', at: 0, chat: 2 }, { k: 'delete', at: 0, chat: 2 }, { k: 'restore', at: 0 }, { k: 'restore', at: 0 }, { k: 'lose' }, { k: 'revert', at: 2 }, { k: 'evict' }, { k: 'undo' }]],
        reaches: (t) => t.reverts === 1 && t.r1cConsumed + t.r1Undo >= 1,
    },
    {
        // The base expected-side Undo of a producer pair.
        name: 'Undo of a revert that produced an item leaves it unlisted',
        input: [0, [{ k: 'add' }, { k: 'add' }, { k: 'delete', at: 4, chat: 0 }, { k: 'revert', at: 0 }, { k: 'revert', at: 2 }, { k: 'undo' }]],
        reaches: (t) => t.reverts === 2 && t.applied === 1,
    },
    {
        // As the example above with the item evicted before the Undo, then a Redo that lists it again.
        name: 'the same with the item evicted before the Undo, then Redo',
        input: [0, [{ k: 'add' }, { k: 'add' }, { k: 'delete', at: 4, chat: 0 }, { k: 'revert', at: 0 }, { k: 'revert', at: 2 }, { k: 'evict' }, { k: 'undo' }, { k: 'redo' }]],
        reaches: (t) => t.reverts === 2 && t.applied === 2,
    },
    {
        // An R1 Undo of a revert that re-listed an item, owner write lost, then Redo.
        name: 'a moved Undo of a revert that re-listed an item, then Redo applies by the fingerprint',
        input: [0, [{ k: 'add' }, { k: 'add' }, { k: 'delete', at: 4, chat: 0 }, { k: 'revert', at: 0 }, { k: 'add' }, { k: 'lose' }, { k: 'revert', at: 2 }, { k: 'undo' }, { k: 'redo' }]],
        reaches: (t) => t.reverts === 2 && t.r1Undo === 1 && t.applied === 1,
    },
]

describe('conservation of first messages and the other invariants over generated histories', () => {
    for (const example of EXAMPLES) {
        test(example.name, () => {
            const tally = emptyTally()
            expect(runActions(example.input, tally)).toBeNull()
            expect(example.reaches(tally), JSON.stringify(tally)).toBe(true)
        })
    }

    test('the invariants hold after every action of 5000 seeded sequences, and every class is reached', () => {
        const tally = emptyTally()
        const started = performance.now()
        fc.assert(
            fc.property(inputArb, (input) => {
                const failure = runActions(input, tally)
                if (failure) {
                    throw new Error(failure)
                }
            }),
            { seed: 20261113, numRuns: 5000, examples: EXAMPLES.map((example) => [example.input]) },
        )
        console.info(`generated histories: seed 20261113, 5000 runs, ms${Math.round(performance.now() - started)} ${JSON.stringify(tally)}`)
        for (const [name, count] of Object.entries(tally)) {
            expect(count, `class ${name}`).toBeGreaterThanOrEqual(10)
        }
    }, 120_000)
})
