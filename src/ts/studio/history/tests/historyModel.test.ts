import { afterEach, describe, expect, test, vi } from 'vitest'
import {
    COALESCE_MS,
    MAX_DELETED,
    MAX_DONE,
    applyReplayMove,
    closeOpenStep,
    commitStep,
    createListHashTracker,
    createModelState,
    createPageSession,
    deriveRestoreWrites,
    emptyRecord,
    invertOp,
    listChangedElsewhere,
    listSideOf,
    parseOwnerRecord,
    planReplay,
    planRestoreDeleted,
    planRestorePoint,
    planRevert,
    stepIdFor,
    type DeletedItem,
    type Step,
    type FieldValue,
    type FmValue,
    type LiveReader,
    type ModelState,
    type Op,
    type PlanResult,
    type RestorePath,
    type SetPath,
    type WriteOp,
} from '../historyModel'
import { fingerprintElement, listFingerprintOf } from '../listFingerprint'
import { characterOwnerKey, chatOwnerKey } from '../ownerPhase'

// ---------------------------------------------------------------- a live character double

interface LiveObject {
    desc?: string
    hideChatIcon?: boolean
    note?: string
    alternateGreetings: string[]
    // Chats by unique id.
    chats: Record<string, { fmIndex?: number }>
    // The chat found by page index, standing for a chat without a unique id.
    pageChat: { fmIndex?: number }
}

function makeLive(init: Partial<LiveObject> = {}) {
    const obj: LiveObject = {
        alternateGreetings: [],
        chats: {},
        pageChat: {},
        ...init,
    }
    function setField(path: SetPath, value: FieldValue) {
        if (!value.had) {
            delete obj[path]
        } else if (path === 'hideChatIcon' && typeof value.value === 'boolean') {
            obj.hideChatIcon = value.value
        } else if (path !== 'hideChatIcon' && typeof value.value === 'string') {
            obj[path] = value.value
        } else {
            throw new Error('wrong value type written')
        }
    }
    const reader: LiveReader = {
        field(path) {
            return path in obj ? { had: true, value: obj[path] as string | boolean } : { had: false }
        },
        greetings: () => obj.alternateGreetings,
        fmIndex(chatId) {
            const chat = obj.chats[chatId]
            if (!chat) {
                return null
            }
            return chat.fmIndex === undefined ? { had: false } : { had: true, value: chat.fmIndex }
        },
    }
    function apply(writes: readonly WriteOp[]) {
        for (const write of writes) {
            switch (write.op) {
                case 'set':
                    setField(write.path, write.value)
                    break
                case 'listSet':
                    obj.alternateGreetings[write.index] = write.value
                    break
                case 'listInsert':
                    obj.alternateGreetings.splice(write.index, 0, write.value)
                    break
                case 'listRemove':
                    obj.alternateGreetings.splice(write.index, 1)
                    break
                case 'chatFm': {
                    const chat = obj.chats[write.chatId]
                    if (!write.value.had) {
                        delete chat.fmIndex
                    } else {
                        chat.fmIndex = write.value.value
                    }
                    break
                }
            }
        }
    }
    return { obj, reader, apply }
}

type Live = ReturnType<typeof makeLive>

// ---------------------------------------------------------------- a session over the pure model

class Session {
    state: ModelState
    counter = 0
    visit = 'v1'

    constructor(
        readonly live: Live,
        ownerKey = characterOwnerKey('c1'),
    ) {
        this.state = createModelState(emptyRecord(ownerKey, 0))
    }

    get record() {
        return this.state.record
    }

    private nextId(): string {
        this.counter += 1
        return stepIdFor('page', this.counter)
    }

    editField(path: SetPath, after: FieldValue, at: number) {
        const before = this.live.reader.field(path)
        const ops: Op[] = [{ op: 'set', path, before, after }]
        this.live.apply([{ op: 'set', path, value: after }])
        this.state = commitStep(this.state, {
            id: this.nextId(),
            at,
            visitId: this.visit,
            label: { kind: 'field', field: path },
            ops,
            restoreWrites: deriveRestoreWrites(ops, this.live.obj.alternateGreetings),
            coalesceKey: path,
            replacesRestore: true,
        })
    }

    typeDesc(value: string, at: number) {
        this.editField('desc', { had: true, value }, at)
    }

    editGreeting(index: number, after: string, at: number) {
        const before = this.live.obj.alternateGreetings[index]
        const ops: Op[] = [{ op: 'listSet', index, before, after }]
        const greetings = [...this.live.obj.alternateGreetings]
        this.live.apply([{ op: 'listSet', index, value: after }])
        this.state = commitStep(this.state, {
            id: this.nextId(),
            at,
            visitId: this.visit,
            label: { kind: 'greetingEdit' },
            ops,
            restoreWrites: deriveRestoreWrites(ops, greetings),
            coalesceKey: `alternateGreetings[${index}]`,
            replacesRestore: true,
        })
    }

    addGreeting(value: string, at: number) {
        const index = this.live.obj.alternateGreetings.length
        const ops: Op[] = [{ op: 'listInsert', index, value }]
        const greetings = [...this.live.obj.alternateGreetings]
        this.live.apply([{ op: 'listInsert', index, value }])
        this.state = commitStep(this.state, {
            id: this.nextId(),
            at,
            visitId: this.visit,
            label: { kind: 'greetingAdd' },
            ops,
            restoreWrites: deriveRestoreWrites(ops, greetings),
            coalesceKey: null,
            replacesRestore: true,
        })
    }

    // `chatId` null stands for a context chat without a unique id (its fmIndex is set by page index).
    deleteGreeting(index: number, at: number, chatId: string | null = 'chatA'): string {
        const value = this.live.obj.alternateGreetings[index]
        const deletedId = `del${this.counter + 1}`
        const target = chatId === null ? this.live.obj.pageChat : this.live.obj.chats[chatId]
        const beforeFm: FmValue = target.fmIndex === undefined ? { had: false } : { had: true, value: target.fmIndex }
        const ops: Op[] = [
            { op: 'listRemove', index, value, deletedId },
            { op: 'chatFm', chatId, before: beforeFm, after: { had: true, value: -1 } },
        ]
        const greetings = [...this.live.obj.alternateGreetings]
        this.live.obj.alternateGreetings.splice(index, 1)
        target.fmIndex = -1
        this.state = commitStep(this.state, {
            id: this.nextId(),
            at,
            visitId: this.visit,
            label: { kind: 'greetingRemove' },
            ops,
            restoreWrites: deriveRestoreWrites(ops, greetings),
            coalesceKey: null,
            replacesRestore: true,
        })
        return deletedId
    }

    private replay(direction: 'undo' | 'redo', at: number): PlanResult {
        const plan = planReplay(this.record, direction, this.live.reader)
        if (plan.ok) {
            this.live.apply(plan.writes)
            this.state = applyReplayMove(this.state, direction, plan, at, this.visit)
        }
        return plan
    }

    undo(at = 0) {
        return this.replay('undo', at)
    }

    redo(at = 0) {
        return this.replay('redo', at)
    }

    commitPlan(plan: PlanResult, at: number): PlanResult {
        if (plan.ok) {
            this.live.apply(plan.writes)
            this.state = commitStep(this.state, {
                id: this.nextId(),
                at,
                visitId: this.visit,
                label: plan.label,
                ops: plan.ops,
                restoreWrites: plan.restoreWrites,
                coalesceKey: null,
                replacesRestore: false,
                deletedRemove: plan.deletedRemove,
                // As the service forwards them: a revert's commit reuses the plan's hashes.
                liveListHash: plan.liveListHash,
                afterListHash: plan.afterListHash,
            })
        }
        return plan
    }

    revertTo(stepId: string, at: number, budgetUnits?: number) {
        return this.commitPlan(planRevert(this.record, stepId, this.live.reader, budgetUnits), at)
    }

    restoreDeleted(id: string, at: number) {
        return this.commitPlan(planRestoreDeleted(this.record, id, this.live.reader), at)
    }

    restorePoint(keep: ReadonlySet<RestorePath>, at: number) {
        const plan = planRestorePoint(this.record.restore, this.live.reader, keep)
        return this.commitPlan(plan, at)
    }
}

function newSession(init: Partial<LiveObject> = {}) {
    return new Session(makeLive(init))
}

const present = (value: string | boolean): FieldValue => ({ had: true, value })

afterEach(() => {
    vi.restoreAllMocks()
})

// ---------------------------------------------------------------- stacks

describe('stacks (T-H1, T-H2)', () => {
    test('T-H1 undo and redo move steps in order across three steps', () => {
        const s = newSession({ desc: 'a' })
        s.typeDesc('b', 0)
        s.addGreeting('g1', 5000)
        s.editField('hideChatIcon', present(true), 10000)
        expect(s.record.done.map((step) => step.id)).toEqual(['page:1', 'page:2', 'page:3'])

        s.undo()
        expect(s.live.obj.hideChatIcon).toBeUndefined()
        s.undo()
        expect(s.live.obj.alternateGreetings).toEqual([])
        expect(s.record.undone.map((step) => step.id)).toEqual(['page:3', 'page:2'])
        s.undo()
        expect(s.live.obj.desc).toBe('a')
        expect(s.record.done).toEqual([])

        s.redo()
        expect(s.live.obj.desc).toBe('b')
        s.redo()
        expect(s.live.obj.alternateGreetings).toEqual(['g1'])
        s.redo()
        expect(s.live.obj.hideChatIcon).toBe(true)
        expect(s.record.undone).toEqual([])
        expect(s.record.done.map((step) => step.id)).toEqual(['page:1', 'page:2', 'page:3'])
    })

    test('T-H2 a new edit after an undo clears the redo stack', () => {
        const s = newSession({ desc: 'a' })
        s.typeDesc('b', 0)
        s.addGreeting('g1', 5000)
        s.undo()
        expect(s.record.undone).toHaveLength(1)
        s.editField('hideChatIcon', present(true), 6000)
        expect(s.record.undone).toEqual([])
        expect(s.redo()).toEqual({ ok: false, reason: 'empty' })
    })

    test('an undo or redo with nothing to move is refused as empty and changes nothing', () => {
        const s = newSession({ desc: 'a' })
        const before = JSON.stringify(s.record)
        expect(s.undo()).toEqual({ ok: false, reason: 'empty' })
        expect(s.redo()).toEqual({ ok: false, reason: 'empty' })
        expect(JSON.stringify(s.record)).toBe(before)
    })

    test('the stacks are capped at the model caps, dropping the oldest step', () => {
        const s = newSession({ desc: 'a' })
        for (let i = 0; i < MAX_DONE + 5; i++) {
            s.addGreeting(`g${i}`, i * 5000)
        }
        expect(s.record.done).toHaveLength(MAX_DONE)
        expect(s.record.done[0].id).toBe('page:6')
    })
})

// ---------------------------------------------------------------- coalescing

describe('coalescing on the injected clock (T-H3)', () => {
    test('writes less than COALESCE_MS apart on one path make one step with the first before and last after', () => {
        const dateNow = vi.spyOn(Date, 'now').mockImplementation(() => {
            throw new Error('the model must not read Date.now')
        })
        const s = newSession({ desc: 'orig' })
        s.typeDesc('o', 0)
        s.typeDesc('ok', 300)
        s.typeDesc('okay', 600)
        expect(s.record.done).toHaveLength(1)
        expect(s.record.done[0].ops).toEqual([
            { op: 'set', path: 'desc', before: present('orig'), after: present('okay') },
        ])
        expect(dateNow).not.toHaveBeenCalled()
    })

    test('a gap of COALESCE_MS or more starts a new step, measured from the previous write', () => {
        const s = newSession({ desc: 'orig' })
        s.typeDesc('a', 0)
        s.typeDesc('ab', COALESCE_MS - 1)
        expect(s.record.done).toHaveLength(1)
        // 999 ms after the previous write still coalesces; 1000 ms does not.
        s.typeDesc('abc', COALESCE_MS - 1 + COALESCE_MS)
        expect(s.record.done).toHaveLength(2)
        expect(s.record.done[1].ops).toEqual([
            { op: 'set', path: 'desc', before: present('ab'), after: present('abc') },
        ])
    })

    test('a change of path closes the open step', () => {
        const s = newSession({ desc: 'orig' })
        s.typeDesc('a', 0)
        s.editField('hideChatIcon', present(true), 100)
        s.typeDesc('ab', 200)
        expect(s.record.done).toHaveLength(3)
    })

    test('five quick writes are one step, not five', () => {
        const s = newSession({ desc: 'orig' })
        for (let i = 0; i < 5; i++) {
            s.typeDesc(`v${i}`, i * 100)
        }
        expect(s.record.done).toHaveLength(1)
    })

    test('undo, redo and an explicit close end coalescing', () => {
        const s = newSession({ desc: 'orig' })
        s.typeDesc('a', 0)
        s.undo(50)
        s.redo(60)
        s.typeDesc('ab', 100)
        expect(s.record.done).toHaveLength(2)

        const t = newSession({ desc: 'orig' })
        t.typeDesc('a', 0)
        t.state = closeOpenStep(t.state)
        t.typeDesc('ab', 100)
        expect(t.record.done).toHaveLength(2)
    })

    test('greeting edits coalesce per element index only', () => {
        const s = newSession({ alternateGreetings: ['x', 'y'] })
        s.editGreeting(0, 'x1', 0)
        s.editGreeting(0, 'x12', 100)
        s.editGreeting(1, 'y1', 200)
        expect(s.record.done).toHaveLength(2)
        expect(s.record.done[0].ops).toEqual([{ op: 'listSet', index: 0, before: 'x', after: 'x12' }])
    })

    test('a coalesced step is not merged across a step that is no longer on top', () => {
        const s = newSession({ desc: 'orig' })
        s.typeDesc('a', 0)
        s.addGreeting('g', 100)
        // The open step is now the greeting add (not coalescible); typing again opens a new step.
        s.typeDesc('ab', 200)
        expect(s.record.done).toHaveLength(3)
    })
})

// ---------------------------------------------------------------- absence, preconditions, partial replay

describe('absent keys and per-op preconditions', () => {
    test('T-AB1 an absent flag set to true, then undone, is absent again and never false', () => {
        const s = newSession()
        s.editField('hideChatIcon', present(true), 0)
        expect('hideChatIcon' in s.live.obj).toBe(true)
        s.undo()
        expect('hideChatIcon' in s.live.obj).toBe(false)
        expect(s.record.undone[0].ops).toEqual([
            { op: 'set', path: 'hideChatIcon', before: { had: false }, after: present(true) },
        ])
        s.redo()
        expect(s.live.obj.hideChatIcon).toBe(true)
        s.undo()
        expect('hideChatIcon' in s.live.obj).toBe(false)
    })

    test('T-P1 an undo whose live value was changed elsewhere is refused and keeps the live value', () => {
        const s = newSession({ desc: 'a' })
        s.typeDesc('b', 0)
        // The classic editor writes the field directly.
        s.live.obj.desc = 'classic'
        const result = s.undo()
        expect(result).toEqual({ ok: false, reason: 'precondition' })
        expect(s.live.obj.desc).toBe('classic')
        expect(s.record.done).toHaveLength(1)
        expect(s.record.undone).toEqual([])
    })

    test('T-P1 a partial replay moves the step with only the ops that applied, and redo repeats only those', () => {
        const s = newSession({ alternateGreetings: ['x', 'y'], chats: { chatA: { fmIndex: 2 } } })
        s.deleteGreeting(0, 0)
        expect(s.live.obj.chats.chatA.fmIndex).toBe(-1)
        // The classic editor moves the chat's first-message index after the delete.
        s.live.obj.chats.chatA.fmIndex = 1
        const undone = s.undo()
        expect(undone.ok).toBe(true)
        if (undone.ok) {
            expect(undone.skipped).toBe(1)
        }
        expect(s.live.obj.alternateGreetings).toEqual(['x', 'y'])
        expect(s.live.obj.chats.chatA.fmIndex).toBe(1)
        expect(s.record.undone[0].ops).toEqual([expect.objectContaining({ op: 'listRemove', index: 0, value: 'x' })])
        s.redo()
        expect(s.live.obj.alternateGreetings).toEqual(['y'])
        expect(s.live.obj.chats.chatA.fmIndex).toBe(1)
    })

    test('T-LS1 greeting add, edit and delete replay in both directions', () => {
        const s = newSession({ alternateGreetings: ['x'] })
        s.addGreeting('y', 0)
        s.editGreeting(0, 'x2', 5000)
        expect(s.live.obj.alternateGreetings).toEqual(['x2', 'y'])
        s.undo()
        expect(s.live.obj.alternateGreetings).toEqual(['x', 'y'])
        s.undo()
        expect(s.live.obj.alternateGreetings).toEqual(['x'])
        s.redo()
        s.redo()
        expect(s.live.obj.alternateGreetings).toEqual(['x2', 'y'])
    })

    test('T-LS1 a greeting element changed elsewhere is not overwritten by an undo', () => {
        const s = newSession({ alternateGreetings: ['x'] })
        s.editGreeting(0, 'x2', 0)
        s.live.obj.alternateGreetings[0] = 'classic'
        expect(s.undo()).toEqual({ ok: false, reason: 'precondition' })
        expect(s.live.obj.alternateGreetings).toEqual(['classic'])
    })

    test('T-LS1 undo of an add is skipped when the element at that index is no longer the added value', () => {
        const s = newSession({ alternateGreetings: [] })
        s.addGreeting('y', 0)
        s.live.obj.alternateGreetings[0] = 'other'
        expect(s.undo()).toEqual({ ok: false, reason: 'precondition' })
        expect(s.live.obj.alternateGreetings).toEqual(['other'])
    })

    test('T-LS2 a delete sets fmIndex to -1 and its undo restores the previous index', () => {
        const s = newSession({ alternateGreetings: ['x', 'y'], chats: { chatA: { fmIndex: 2 } } })
        s.deleteGreeting(1, 0)
        expect(s.live.obj.alternateGreetings).toEqual(['x'])
        expect(s.live.obj.chats.chatA.fmIndex).toBe(-1)
        s.undo()
        expect(s.live.obj.alternateGreetings).toEqual(['x', 'y'])
        expect(s.live.obj.chats.chatA.fmIndex).toBe(2)
        s.redo()
        expect(s.live.obj.chats.chatA.fmIndex).toBe(-1)
    })

    test('T-LS2 an absent fmIndex is absent again after the undo', () => {
        const s = newSession({ alternateGreetings: ['x'], chats: { chatA: {} } })
        s.deleteGreeting(0, 0)
        expect(s.live.obj.chats.chatA.fmIndex).toBe(-1)
        s.undo()
        expect('fmIndex' in s.live.obj.chats.chatA).toBe(false)
    })

    test('T-LS3 a delete on a chat without a unique id undoes the greeting but not fmIndex, and flags it', () => {
        const s = newSession({ alternateGreetings: ['x', 'y'], pageChat: { fmIndex: 1 } })
        s.deleteGreeting(0, 0, null)
        expect(s.record.done[0].ops[1]).toEqual({
            op: 'chatFm',
            chatId: null,
            before: { had: true, value: 1 },
            after: { had: true, value: -1 },
        })
        const undone = s.undo()
        expect(undone.ok && undone.fmNotRestored).toBe(true)
        expect(s.live.obj.alternateGreetings).toEqual(['x', 'y'])
        expect(s.live.obj.pageChat.fmIndex).toBe(-1)
        // The recorded side op stays in the step: nothing about the delete is forgotten.
        expect(s.record.undone[0].ops).toHaveLength(2)
    })

    test('a replay needing the greeting list is refused when the list cannot be read', () => {
        const s = newSession({ alternateGreetings: ['x'] })
        s.addGreeting('y', 0)
        const unreadable: LiveReader = { ...s.live.reader, greetings: () => null }
        expect(planReplay(s.record, 'undo', unreadable)).toEqual({ ok: false, reason: 'precondition' })
    })

    test('invertOp swaps every op and is its own inverse', () => {
        const ops: Op[] = [
            { op: 'set', path: 'desc', before: { had: false }, after: present('a') },
            { op: 'listSet', index: 1, before: 'p', after: 'q' },
            { op: 'listInsert', index: 2, value: 'v' },
            { op: 'listRemove', index: 2, value: 'v', deletedId: null },
            { op: 'chatFm', chatId: 'c', before: { had: true, value: 3 }, after: { had: true, value: -1 } },
        ]
        for (const op of ops) {
            expect(invertOp(invertOp(op))).toEqual(op)
        }
    })
})

// ---------------------------------------------------------------- owners are independent

describe('T-K1 owners', () => {
    test('two sessions for a character and its chat keep separate stacks', () => {
        const live = makeLive({ desc: 'a', note: 'n' })
        const character = new Session(live, characterOwnerKey('c1'))
        const chat = new Session(live, chatOwnerKey('c1', 'chatA'))
        character.typeDesc('b', 0)
        chat.editField('note', present('n2'), 0)
        character.undo()
        expect(live.obj.desc).toBe('a')
        expect(live.obj.note).toBe('n2')
        expect(chat.record.done).toHaveLength(1)
    })
})

// ---------------------------------------------------------------- restore point

describe('restore point (T-RP1 to T-RP3)', () => {
    test('T-RP1 the first write of a path in a visit records before, later writes only update last', () => {
        const s = newSession({ desc: 'orig' })
        s.typeDesc('a', 0)
        s.typeDesc('ab', 5000)
        s.typeDesc('abc', 10000)
        expect(s.record.restore).toEqual({
            visitId: 'v1',
            at: 0,
            fields: { desc: { before: present('orig'), last: present('abc') } },
        })
    })

    test('T-RP1 a greeting write records the whole list before and after', () => {
        const s = newSession({ alternateGreetings: ['x'] })
        s.addGreeting('y', 0)
        s.editGreeting(0, 'x2', 5000)
        expect(s.record.restore?.fields.alternateGreetings).toEqual({
            before: { list: ['x'] },
            last: { list: ['x2', 'y'] },
        })
    })

    test('T-RP2 the first edit of a new visit replaces the whole restore point', () => {
        const s = newSession({ desc: 'orig' })
        s.typeDesc('a', 0)
        s.editField('hideChatIcon', present(true), 5000)
        s.visit = 'v2'
        s.typeDesc('ab', 10000)
        expect(s.record.restore).toEqual({
            visitId: 'v2',
            at: 10000,
            fields: { desc: { before: present('a'), last: present('ab') } },
        })
    })

    test('T-RP2 a replay in a new visit refreshes last of tracked fields but does not replace the restore point', () => {
        const s = newSession({ desc: 'orig' })
        s.typeDesc('a', 0)
        s.visit = 'v2'
        s.undo(5000)
        expect(s.record.restore).toEqual({
            visitId: 'v1',
            at: 0,
            fields: { desc: { before: present('orig'), last: present('orig') } },
        })
    })

    test('T-RP3 restoring puts every tracked field back, as one undoable step', () => {
        const s = newSession({ desc: 'orig', alternateGreetings: ['x'] })
        s.typeDesc('a', 0)
        s.addGreeting('y', 5000)
        s.editField('hideChatIcon', present(true), 10000)
        const plan = s.restorePoint(new Set(), 15000)
        expect(plan.ok).toBe(true)
        expect(s.live.obj.desc).toBe('orig')
        expect('hideChatIcon' in s.live.obj).toBe(false)
        expect(s.live.obj.alternateGreetings).toEqual(['x'])
        expect(s.record.done.at(-1)?.label).toEqual({ kind: 'restorePoint' })
        s.undo()
        expect(s.live.obj.desc).toBe('a')
        expect(s.live.obj.hideChatIcon).toBe(true)
        expect(s.live.obj.alternateGreetings).toEqual(['x', 'y'])
    })

    test('T-RP3 a field changed elsewhere is listed, kept when asked, restored otherwise', () => {
        const build = () => {
            const s = newSession({ desc: 'orig' })
            s.typeDesc('a', 0)
            s.editField('hideChatIcon', present(true), 5000)
            s.live.obj.desc = 'classic'
            return s
        }
        const kept = build()
        expect(listChangedElsewhere(kept.record.restore!, kept.live.reader)).toEqual(['desc'])
        const keptPlan = planRestorePoint(kept.record.restore, kept.live.reader, new Set<RestorePath>(['desc']))
        expect(keptPlan.ok && keptPlan.changedElsewhere).toEqual(['desc'])
        kept.commitPlan(keptPlan, 6000)
        expect(kept.live.obj.desc).toBe('classic')
        expect('hideChatIcon' in kept.live.obj).toBe(false)

        const overwritten = build()
        overwritten.restorePoint(new Set(), 6000)
        expect(overwritten.live.obj.desc).toBe('orig')
        expect('hideChatIcon' in overwritten.live.obj).toBe(false)
    })

    test('restoring with nothing recorded, or with nothing left to change, is refused', () => {
        const s = newSession({ desc: 'orig' })
        expect(planRestorePoint(null, s.live.reader, new Set())).toEqual({ ok: false, reason: 'empty' })
        s.typeDesc('a', 0)
        s.undo()
        expect(planRestorePoint(s.record.restore, s.live.reader, new Set())).toEqual({ ok: false, reason: 'precondition' })
    })

    test('restore leaves fmIndex alone', () => {
        const s = newSession({ alternateGreetings: ['x', 'y'], chats: { chatA: { fmIndex: 2 } } })
        s.deleteGreeting(0, 0)
        s.restorePoint(new Set(), 5000)
        expect(s.live.obj.alternateGreetings).toEqual(['x', 'y'])
        expect(s.live.obj.chats.chatA.fmIndex).toBe(-1)
    })
})

// ---------------------------------------------------------------- deleted items

describe('deleted items (T-D1)', () => {
    function deleteThenEdit() {
        const s = newSession({ desc: 'd', alternateGreetings: ['a', 'b', 'c'], chats: { chatA: { fmIndex: 2 } } })
        const id = s.deleteGreeting(1, 0)
        s.typeDesc('d2', 5000)
        s.editGreeting(0, 'a2', 10000)
        s.addGreeting('d', 15000)
        return { s, id }
    }

    test('a delete lists an item; later edits never clear it', () => {
        const { s, id } = deleteThenEdit()
        expect(s.record.deleted).toEqual([
            {
                id,
                at: 0,
                index: 1,
                value: 'b',
                sideChat: { chatId: 'chatA', before: { had: true, value: 2 } },
            },
        ])
    })

    test('restoring inserts at the old index as one undoable step and removes the item', () => {
        const { s, id } = deleteThenEdit()
        expect(s.live.obj.alternateGreetings).toEqual(['a2', 'c', 'd'])
        expect(s.restoreDeleted(id, 20000).ok).toBe(true)
        expect(s.live.obj.alternateGreetings).toEqual(['a2', 'b', 'c', 'd'])
        expect(s.record.deleted).toEqual([])
        expect(s.record.done.at(-1)?.label).toEqual({ kind: 'restoreDeleted', deletedId: id })
        // fmIndex was -1, so the side effect is restored as well.
        expect(s.live.obj.chats.chatA.fmIndex).toBe(2)
    })

    test('restoring past the end of a shorter list inserts at the end', () => {
        const s = newSession({ alternateGreetings: ['a', 'b', 'c'], chats: { chatA: {} } })
        const id = s.deleteGreeting(2, 0)
        s.deleteGreeting(1, 5000)
        s.deleteGreeting(0, 10000)
        expect(s.live.obj.alternateGreetings).toEqual([])
        s.restoreDeleted(id, 15000)
        expect(s.live.obj.alternateGreetings).toEqual(['c'])
    })

    test('undoing the restore lists the item again; redoing it consumes the item again', () => {
        const { s, id } = deleteThenEdit()
        s.restoreDeleted(id, 20000)
        s.undo()
        expect(s.live.obj.alternateGreetings).toEqual(['a2', 'c', 'd'])
        expect(s.record.deleted.map((item) => item.id)).toEqual([id])
        s.redo()
        expect(s.live.obj.alternateGreetings).toEqual(['a2', 'b', 'c', 'd'])
        expect(s.record.deleted).toEqual([])
    })

    test('undoing the delete step removes its item, and redoing it lists the item again', () => {
        const s = newSession({ alternateGreetings: ['a', 'b'], chats: { chatA: { fmIndex: 1 } } })
        const id = s.deleteGreeting(0, 0)
        s.undo()
        expect(s.record.deleted).toEqual([])
        expect(planRestoreDeleted(s.record, id, s.live.reader)).toEqual({ ok: false, reason: 'unknown' })
        s.redo()
        expect(s.record.deleted.map((item) => item.id)).toEqual([id])
        expect(s.record.deleted[0]).toMatchObject({ index: 0, value: 'a', sideChat: { chatId: 'chatA' } })
    })

    test('Ctrl+Z on the delete step and the History restore exclude each other', () => {
        const s = newSession({ alternateGreetings: ['a', 'b'], chats: { chatA: { fmIndex: 1 } } })
        const id = s.deleteGreeting(0, 0)
        s.restoreDeleted(id, 5000)
        // Undo the restore, then restore from History again, then the delete step is no longer undoable.
        s.undo()
        s.restoreDeleted(id, 6000)
        // The restore step is on top; remove it from the way and try the delete step directly.
        const withoutTop: ModelState = {
            record: { ...s.record, done: s.record.done.slice(0, 1), undone: [] },
            open: null,
        }
        expect(planReplay(withoutTop.record, 'undo', s.live.reader)).toEqual({ ok: false, reason: 'precondition' })
        expect(s.live.obj.alternateGreetings).toEqual(['a', 'b'])
    })

    test('a consumed deleted item alone blocks the undo of its delete step, with no side effect to lean on', () => {
        const s = newSession({ alternateGreetings: ['a', 'b'], pageChat: { fmIndex: 1 } })
        const id = s.deleteGreeting(0, 0, null)
        s.restoreDeleted(id, 5000)
        expect(s.live.obj.alternateGreetings).toEqual(['a', 'b'])
        const deleteStepOnly = { ...s.record, done: s.record.done.slice(0, 1), undone: [] }
        expect(planReplay(deleteStepOnly, 'undo', s.live.reader)).toEqual({ ok: false, reason: 'precondition' })
    })

    test('a restore is refused for an unknown id, and when the greeting list cannot be read', () => {
        const { s, id } = deleteThenEdit()
        expect(planRestoreDeleted(s.record, 'nope', s.live.reader)).toEqual({ ok: false, reason: 'unknown' })
        const unreadable: LiveReader = { ...s.live.reader, greetings: () => null }
        expect(planRestoreDeleted(s.record, id, unreadable)).toEqual({ ok: false, reason: 'precondition' })
    })

    test('the side effect is restored only while fmIndex is still -1', () => {
        const s = newSession({ alternateGreetings: ['a', 'b'], chats: { chatA: { fmIndex: 1 } } })
        const id = s.deleteGreeting(0, 0)
        s.live.obj.chats.chatA.fmIndex = 0
        s.restoreDeleted(id, 5000)
        expect(s.live.obj.alternateGreetings).toEqual(['a', 'b'])
        expect(s.live.obj.chats.chatA.fmIndex).toBe(0)
    })

    test('the deleted list is capped at MAX_DELETED, dropping the oldest', () => {
        const greetings = Array.from({ length: MAX_DELETED + 3 }, (_, i) => `g${i}`)
        const s = newSession({ alternateGreetings: greetings, chats: { chatA: {} } })
        for (let i = 0; i < MAX_DELETED + 3; i++) {
            s.deleteGreeting(0, i * 5000)
        }
        expect(s.record.deleted).toHaveLength(MAX_DELETED)
        expect(s.record.deleted[0].value).toBe('g3')
    })
})

// ---------------------------------------------------------------- revert

describe('revert', () => {
    test('revertTo is one new step that undoes everything above the chosen step', () => {
        const s = newSession({ desc: 'a' })
        s.typeDesc('b', 0)
        s.addGreeting('g1', 5000)
        s.editField('hideChatIcon', present(true), 10000)
        const target = s.record.done[0].id
        const result = s.revertTo(target, 15000)
        expect(result.ok).toBe(true)
        expect(s.live.obj.desc).toBe('b')
        expect(s.live.obj.alternateGreetings).toEqual([])
        expect('hideChatIcon' in s.live.obj).toBe(false)
        expect(s.record.done).toHaveLength(4)
        expect(s.record.done[3].label).toEqual({ kind: 'revert', toStepId: target })
        s.undo()
        expect(s.live.obj.alternateGreetings).toEqual(['g1'])
        expect(s.live.obj.hideChatIcon).toBe(true)
    })

    test('revert skips ops whose live value changed and refuses when none apply', () => {
        const s = newSession({ desc: 'a' })
        s.typeDesc('b', 0)
        s.editField('hideChatIcon', present(true), 5000)
        s.live.obj.hideChatIcon = false
        expect(s.revertTo(s.record.done[0].id, 6000)).toEqual({ ok: false, reason: 'precondition' })
        expect(s.live.obj.hideChatIcon).toBe(false)
    })

    test('revert to the top step or an unknown step is refused', () => {
        const s = newSession({ desc: 'a' })
        s.typeDesc('b', 0)
        expect(planRevert(s.record, s.record.done[0].id, s.live.reader)).toEqual({ ok: false, reason: 'empty' })
        expect(planRevert(s.record, 'missing', s.live.reader)).toEqual({ ok: false, reason: 'unknown' })
    })

    test('reverting past a delete step consumes its deleted item', () => {
        const s = newSession({ alternateGreetings: ['a', 'b'], chats: { chatA: { fmIndex: 1 } } })
        s.addGreeting('c', 0)
        s.deleteGreeting(0, 5000)
        s.typeDesc('x', 10000)
        s.revertTo(s.record.done[0].id, 15000)
        expect(s.live.obj.alternateGreetings).toEqual(['a', 'b', 'c'])
        expect(s.record.deleted).toEqual([])
    })
})

// ---------------------------------------------------------------- restore-point derivation

describe('deriveRestoreWrites', () => {
    test('repeated writes to one path keep the first before and the last after', () => {
        const writes = deriveRestoreWrites(
            [
                { op: 'set', path: 'desc', before: present('a'), after: present('b') },
                { op: 'set', path: 'desc', before: present('b'), after: present('c') },
            ],
            null,
        )
        expect(writes).toEqual([{ path: 'desc', before: present('a'), after: present('c') }])
    })

    test('list ops collapse into one whole-list write', () => {
        const writes = deriveRestoreWrites(
            [
                { op: 'listInsert', index: 1, value: 'n' },
                { op: 'listRemove', index: 0, value: 'x', deletedId: null },
            ],
            ['x', 'y'],
        )
        expect(writes).toEqual([{ path: 'alternateGreetings', before: { list: ['x', 'y'] }, after: { list: ['n', 'y'] } }])
    })
})

// ---------------------------------------------------------------- stored shape guards

describe('parseOwnerRecord guards', () => {
    const owner = characterOwnerKey('c1')
    function good() {
        return {
            ownerKey: owner,
            touchedAt: 1,
            done: [
                {
                    id: 'p:1',
                    at: 1,
                    label: { kind: 'field', field: 'desc' },
                    ops: [{ op: 'set', path: 'desc', before: { had: false }, after: { had: true, value: 'x' } }],
                },
            ],
            undone: [],
            deleted: [],
            restore: null,
        }
    }

    test('a record built by the model passes', () => {
        const s = newSession({ desc: 'a', alternateGreetings: ['x'], chats: { chatA: { fmIndex: 1 } } })
        s.typeDesc('b', 0)
        s.deleteGreeting(0, 5000)
        s.addGreeting('n', 10000)
        s.undo()
        const parsed = parseOwnerRecord(JSON.parse(JSON.stringify(s.record)), owner)
        expect(parsed).toEqual(s.record)
    })

    test('the minimal good value passes', () => {
        expect(parseOwnerRecord(good(), owner)).not.toBeNull()
    })

    test.each([
        ['a path outside the union', (r: ReturnType<typeof good>) => { (r.done[0].ops[0] as { path: string }).path = 'name' }],
        ['an unknown op', (r: ReturnType<typeof good>) => { (r.done[0].ops[0] as { op: string }).op = 'wipe' }],
        ['a wrong value type for desc', (r: ReturnType<typeof good>) => { (r.done[0].ops[0] as { after: unknown }).after = { had: true, value: 5 } }],
        ['a non-boolean hideChatIcon', (r: ReturnType<typeof good>) => { r.done[0].ops[0] = { op: 'set', path: 'hideChatIcon', before: { had: false }, after: { had: true, value: 'yes' } } as never }],
        ['an owner key that differs', (r: ReturnType<typeof good>) => { r.ownerKey = 'character:other' }],
        ['a non-array stack', (r: ReturnType<typeof good>) => { (r as { done: unknown }).done = {} }],
        ['a negative list index', (r: ReturnType<typeof good>) => { r.done[0].ops[0] = { op: 'listInsert', index: -1, value: 'x' } as never }],
        ['an unknown label', (r: ReturnType<typeof good>) => { (r.done[0] as { label: unknown }).label = { kind: 'other' } }],
        ['a restore field outside the union', (r: ReturnType<typeof good>) => { (r as { restore: unknown }).restore = { visitId: 'v', at: 1, fields: { name: { before: { had: false }, last: { had: false } } } } }],
        ['a missing touchedAt', (r: ReturnType<typeof good>) => { delete (r as { touchedAt?: number }).touchedAt }],
    ])('rejects %s', (_name, mutate) => {
        const record = good()
        mutate(record)
        expect(parseOwnerRecord(record, owner)).toBeNull()
    })

    test('a chat owner accepts only the note path and no list ops', () => {
        const chatOwner = chatOwnerKey('c1', 'chatA')
        const note = {
            ownerKey: chatOwner,
            touchedAt: 1,
            done: [
                {
                    id: 'p:1',
                    at: 1,
                    label: { kind: 'field', field: 'note' },
                    ops: [{ op: 'set', path: 'note', before: { had: false }, after: { had: true, value: 'x' } }],
                },
            ],
            undone: [],
            deleted: [],
            restore: null,
        }
        expect(parseOwnerRecord(note, chatOwner)).not.toBeNull()
        const desc = JSON.parse(JSON.stringify(note))
        desc.done[0].ops[0].path = 'desc'
        expect(parseOwnerRecord(desc, chatOwner)).toBeNull()
        const list = JSON.parse(JSON.stringify(note))
        list.done[0].ops[0] = { op: 'listInsert', index: 0, value: 'x' }
        expect(parseOwnerRecord(list, chatOwner)).toBeNull()
    })

    test('a character owner refuses the note path', () => {
        const record = good()
        record.done[0].ops[0] = { op: 'set', path: 'note', before: { had: false }, after: { had: true, value: 'x' } } as never
        expect(parseOwnerRecord(record, owner)).toBeNull()
    })
})

describe('page session ids', () => {
    test('16 random bytes become 32 hex characters, and step ids join session and counter', () => {
        const session = createPageSession((bytes) => {
            bytes.forEach((_, i) => (bytes[i] = i * 17))
            return bytes
        })
        expect(session).toMatch(/^[0-9a-f]{32}$/)
        expect(session.slice(0, 6)).toBe('001122')
        expect(stepIdFor(session, 7)).toBe(`${session}:7`)
    })
})

// ---------------------------------------------------------------- list fingerprint (CHORE-690 S1)

const H = listFingerprintOf

interface Snapshot {
    list: string[]
    chats: Record<string, number | undefined>
    page: number | undefined
}

// The live object just before an action, so a test can put it back: the action's owner write is
// lost while its history step was saved.
function snapshot(s: Session): Snapshot {
    return {
        list: [...s.live.obj.alternateGreetings],
        chats: Object.fromEntries(Object.entries(s.live.obj.chats).map(([id, chat]) => [id, chat.fmIndex])),
        page: s.live.obj.pageChat.fmIndex,
    }
}

function setFm(chat: { fmIndex?: number }, value: number | undefined) {
    if (value === undefined) {
        delete chat.fmIndex
    } else {
        chat.fmIndex = value
    }
}

function lose(s: Session, snap: Snapshot) {
    s.live.obj.alternateGreetings.splice(0, s.live.obj.alternateGreetings.length, ...snap.list)
    for (const [id, value] of Object.entries(snap.chats)) {
        setFm(s.live.obj.chats[id], value)
    }
    setFm(s.live.obj.pageChat, snap.page)
}

function listOnly(s: Session, list: string[]) {
    s.live.obj.alternateGreetings.splice(0, s.live.obj.alternateGreetings.length, ...list)
}

// A step as the producer before the fingerprint wrote it: the four keys only.
function asPreChange(step: Step): Step {
    return { id: step.id, at: step.at, label: step.label, ops: step.ops }
}

function stripAll(s: Session) {
    const record = s.record
    s.state = { record: { ...record, done: record.done.map(asPreChange), undone: record.undone.map(asPreChange) }, open: null }
}

function stripStep(s: Session, index: number) {
    const record = s.record
    s.state = { record: { ...record, done: record.done.map((step, i) => (i === index ? asPreChange(step) : step)) }, open: null }
}

describe('list fingerprint: format', () => {
    test('T12b goldens freeze the list fingerprint', () => {
        expect(H([])).toBe(3338908027751811)
        expect(H([''])).toBe(5004839637900557)
        expect(H(['', ''])).toBe(4142270602966282)
        expect(H(['ab', ''])).toBe(66575008438486)
        expect(H(['a', 'b'])).toBe(8521532018168582)
        expect(H(['b', 'a'])).toBe(3809269136509717)
        expect(H(['a'.repeat(1000)])).toBe(1140304281066366)
        expect(H(['ab', ''])).not.toBe(H(['a', 'b']))
    })

    test('T12e the hash is total over non-string elements', () => {
        expect(H([null, 5, undefined, 'x'])).toBe(8883500929881569)
        expect(H([null])).toBe(3281591137679370)
        expect(H([undefined])).toBe(8688324439190936)
        expect(H([5])).toBe(7144735477543534)
        // eslint-disable-next-line no-sparse-arrays
        expect(H([, 'x'])).toBe(8265234077000399)
        for (const value of [null, undefined, 5, {}, [], Symbol('s')]) {
            expect(Number.isSafeInteger(fingerprintElement(value))).toBe(true)
        }
    })

    test('T12 the guard keeps a valid fingerprint and rejects every other present value', () => {
        const owner = characterOwnerKey('c1')
        const record = (fp: unknown, ownerKey = owner) => ({
            ownerKey,
            touchedAt: 1,
            done: [{ id: 'p:1', at: 1, label: { kind: 'greetingAdd' }, ops: [{ op: 'listInsert', index: 0, value: 'x' }], listFingerprint: fp }],
            undone: [],
            deleted: [],
            restore: null,
        })
        const parsed = parseOwnerRecord(record({ before: 1, after: 2, extra: 3 }), owner)
        expect(parsed?.done[0]).toStrictEqual({
            id: 'p:1',
            at: 1,
            label: { kind: 'greetingAdd' },
            ops: [{ op: 'listInsert', index: 0, value: 'x' }],
            listFingerprint: { before: 1, after: 2 },
        })
        for (const bad of [{ before: -1, after: 1 }, { before: 1.5, after: 1 }, { before: '1', after: 1 }, null, { before: 2 ** 53, after: 1 }, { before: 1 }, 5]) {
            expect(parseOwnerRecord(record(bad), owner)).toBeNull()
        }
        const absent = record(undefined)
        delete (absent.done[0] as { listFingerprint?: unknown }).listFingerprint
        expect(Object.keys(parseOwnerRecord(absent, owner)!.done[0])).toEqual(['id', 'at', 'label', 'ops'])
        const chat = chatOwnerKey('c1', 'chatA')
        const chatRecord = {
            ownerKey: chat,
            touchedAt: 1,
            done: [{ id: 'p:1', at: 1, label: { kind: 'field', field: 'note' }, ops: [], listFingerprint: { before: 1, after: 2 } }],
            undone: [],
            deleted: [],
            restore: null,
        }
        expect(parseOwnerRecord(chatRecord, chat)).toBeNull()
    })

    test('T13 a list step carries the fingerprint after its ops; typing and field edits carry none', () => {
        const s = newSession({ desc: 'a', alternateGreetings: ['g0', 'g1'], chats: { chatA: {} } })
        s.typeDesc('b', 0)
        s.typeDesc('bc', 100)
        s.editGreeting(0, 'z', 5000)
        s.deleteGreeting(1, 10000)
        s.addGreeting('n', 15000)
        expect(s.record.done.map((step) => Object.keys(step))).toEqual([
            ['id', 'at', 'label', 'ops'],
            ['id', 'at', 'label', 'ops'],
            ['id', 'at', 'label', 'ops', 'listFingerprint'],
            ['id', 'at', 'label', 'ops', 'listFingerprint'],
        ])
        expect(s.record.done[2].listFingerprint).toStrictEqual({ before: H(['z', 'g1']), after: H(['z']) })
        expect(s.record.done[3].listFingerprint).toStrictEqual({ before: H(['z']), after: H(['z', 'n']) })
    })

    test('T13c an undo with the list on the other side is refused whole, so no step moves without its fingerprint', () => {
        const s = newSession({ alternateGreetings: ['a', 'b'], chats: { chatA: { fmIndex: 1 } } })
        s.deleteGreeting(0, 0)
        listOnly(s, ['a', 'b'])
        const record = s.record
        expect(s.undo()).toEqual({ ok: false, reason: 'precondition' })
        expect(s.record).toBe(record)
        expect(s.record.done).toHaveLength(1)
        expect(s.record.undone).toEqual([])
    })

    test('T13d undo and redo refresh the fingerprint to the lists their ops span', () => {
        const s = newSession({ alternateGreetings: ['g0', 'g1'], chats: { chatA: {} } })
        s.deleteGreeting(1, 0)
        s.undo()
        expect(s.record.undone[0].listFingerprint).toStrictEqual({ before: H(['g0', 'g1']), after: H(['g0']) })
        const beforeRedo = snapshot(s)
        s.redo()
        expect(s.record.done[0].listFingerprint).toStrictEqual({ before: H(['g0', 'g1']), after: H(['g0']) })
        // A lost undo write: the live list is the step's other side, and with a prepend it is neither.
        s.undo()
        lose(s, { ...beforeRedo, list: ['g0'] })
        expect(listSideOf(s.record.undone[0], 'redo', s.live.obj.alternateGreetings)).toBe('other')
        s.live.obj.alternateGreetings.unshift('p')
        expect(listSideOf(s.record.undone[0], 'redo', s.live.obj.alternateGreetings)).toBe('neither')
        expect(listSideOf(asPreChange(s.record.undone[0]), 'redo', s.live.obj.alternateGreetings)).toBe('none')
    })

    test('T15b an old-record step gains a fingerprint on its first replay', () => {
        const s = newSession({ alternateGreetings: ['a', 'b'], chats: { chatA: {} } })
        s.deleteGreeting(0, 0)
        stripAll(s)
        expect(s.undo().ok).toBe(true)
        expect(s.record.undone[0].listFingerprint).toStrictEqual({ before: H(['a', 'b']), after: H(['b']) })
    })

    test('T71 commit and undo do not throw over a non-string element', () => {
        const s = newSession({ alternateGreetings: [null as unknown as string, 'x', 'y'], chats: { chatA: {} } })
        s.deleteGreeting(2, 0)
        expect(s.record.done[0].listFingerprint).toBeDefined()
        expect(s.undo().ok).toBe(true)
        expect(s.live.obj.alternateGreetings).toEqual([null, 'x', 'y'])
    })
})

describe('list fingerprint: replay after a lost owner write', () => {
    test('T1 an undo of a delete whose write was lost is refused', () => {
        const s = newSession({ alternateGreetings: ['x', 'y'], chats: { chatA: { fmIndex: 1 } } })
        const snap = snapshot(s)
        s.deleteGreeting(1, 0)
        lose(s, snap)
        expect(s.undo()).toEqual({ ok: false, reason: 'precondition' })
        expect(s.live.obj.alternateGreetings).toEqual(['x', 'y'])
        expect(s.record.done).toHaveLength(1)
        expect(s.record.deleted).toHaveLength(1)
    })

    test('T2 an equal neighbour does not make a lost delete undoable', () => {
        const s = newSession({ alternateGreetings: ['a', 'a'], chats: { chatA: { fmIndex: 1 } } })
        const snap = snapshot(s)
        s.deleteGreeting(0, 0)
        lose(s, snap)
        expect(s.undo()).toEqual({ ok: false, reason: 'precondition' })
        expect(s.live.obj.alternateGreetings).toEqual(['a', 'a'])
    })

    test('T3 a legitimate undo next to equal neighbours re-inserts', () => {
        for (const [list, index, expected] of [
            [['a', 'a', 'b'], 0, ['a', 'a', 'b']],
            [['a', 'a', 'a'], 1, ['a', 'a', 'a']],
            [['', ''], 0, ['', '']],
        ] as const) {
            const s = newSession({ alternateGreetings: [...list], chats: { chatA: {} } })
            s.deleteGreeting(index, 0)
            expect(s.undo().ok).toBe(true)
            expect(s.live.obj.alternateGreetings).toEqual(expected)
        }
    })

    test('T4 an old-record undo next to an equal neighbour uses the exact-slot skip', () => {
        // No chat side effect to lean on: the insert is skipped, so nothing applies.
        const a = newSession({ alternateGreetings: ['a', 'a'] })
        a.deleteGreeting(0, 0, null)
        stripAll(a)
        expect(a.undo()).toEqual({ ok: false, reason: 'precondition' })
        expect(a.live.obj.alternateGreetings).toEqual(['a'])
        // With an applying chat part the step is partial: the list is kept, the index restored.
        const b = newSession({ alternateGreetings: ['a', 'a'], chats: { chatA: { fmIndex: 1 } } })
        b.deleteGreeting(0, 0)
        stripAll(b)
        const result = b.undo()
        expect(result.ok && result.skipped).toBe(1)
        expect(b.live.obj.alternateGreetings).toEqual(['a'])
        expect(b.live.obj.chats.chatA.fmIndex).toBe(1)
    })

    test('T5 a list write lost while the chat index landed: the undo is refused and the step stays', () => {
        const s = newSession({ alternateGreetings: ['a', 'a'], chats: { chatA: { fmIndex: 1 } } })
        s.deleteGreeting(0, 0)
        listOnly(s, ['a', 'a'])
        const record = s.record
        expect(s.undo()).toEqual({ ok: false, reason: 'precondition' })
        expect(s.record).toBe(record)
        expect(s.live.obj.alternateGreetings).toEqual(['a', 'a'])
        expect(s.live.obj.chats.chatA.fmIndex).toBe(-1)
    })

    test('T6 a redo after a lost undo write is refused', () => {
        const s = newSession({ alternateGreetings: ['g'] })
        s.addGreeting('', 0)
        const snap = snapshot(s)
        s.undo()
        lose(s, snap)
        expect(s.redo()).toEqual({ ok: false, reason: 'precondition' })
        expect(s.live.obj.alternateGreetings).toEqual(['g', ''])
    })

    test('T7 the undo of a revert whose write was lost is refused', () => {
        const s = newSession({ desc: 'd' })
        s.typeDesc('e', 0)
        const anchor = s.record.done[0].id
        s.addGreeting('g', 5000)
        const snap = snapshot(s)
        s.revertTo(anchor, 10000)
        lose(s, snap)
        expect(s.undo()).toEqual({ ok: false, reason: 'precondition' })
        expect(s.live.obj.alternateGreetings).toEqual(['g'])
    })

    test('T10a a revert across a delete whose write was lost is refused', () => {
        const s = newSession({ desc: 'd', alternateGreetings: ['a', 'b'], chats: { chatA: { fmIndex: 0 } } })
        s.typeDesc('e', 0)
        const anchor = s.record.done[0].id
        const snap = snapshot(s)
        s.deleteGreeting(0, 5000)
        lose(s, snap)
        expect(s.revertTo(anchor, 10000)).toEqual({ ok: false, reason: 'precondition' })
        expect(s.live.obj.alternateGreetings).toEqual(['a', 'b'])
    })

    test('T51 a redo of a delete after a lost undo is refused and does not consume the item', () => {
        const s = newSession({ alternateGreetings: ['a', 'a'], chats: { chatA: {} } })
        s.deleteGreeting(0, 0)
        const snap = snapshot(s)
        s.undo()
        lose(s, snap)
        expect(s.redo()).toEqual({ ok: false, reason: 'precondition' })
        expect(s.live.obj.alternateGreetings).toEqual(['a'])
        expect(s.record.deleted).toEqual([])
    })

    test('T57a a revert past a delete after an outside prepend is refused', () => {
        const s = newSession({ desc: 'd', alternateGreetings: ['a', 'a', 'b'] })
        s.typeDesc('e', 0)
        const anchor = s.record.done[0].id
        s.deleteGreeting(0, 5000, null)
        s.live.obj.alternateGreetings.unshift('c')
        expect(s.revertTo(anchor, 10000)).toEqual({ ok: false, reason: 'precondition' })
        expect(s.live.obj.alternateGreetings).toEqual(['c', 'a', 'b'])
    })

    test('T61 a redo of a revert after a lost undo is refused', () => {
        const s = newSession({ desc: 'd', alternateGreetings: ['a', 'b', 'a'] })
        s.typeDesc('e', 0)
        const anchor = s.record.done[0].id
        s.deleteGreeting(1, 5000, null)
        s.deleteGreeting(0, 10000, null)
        s.revertTo(anchor, 15000)
        expect(s.live.obj.alternateGreetings).toEqual(['a', 'b', 'a'])
        s.undo()
        listOnly(s, ['a', 'b', 'a'])
        expect(s.redo()).toEqual({ ok: false, reason: 'precondition' })
        expect(s.live.obj.alternateGreetings).toEqual(['a', 'b', 'a'])
    })

    test('T63a an undo of an add after an outside append is refused', () => {
        const s = newSession({ alternateGreetings: ['g'] })
        s.addGreeting('h', 0)
        s.live.obj.alternateGreetings.push('c')
        expect(s.undo()).toEqual({ ok: false, reason: 'precondition' })
        expect(s.live.obj.alternateGreetings).toEqual(['g', 'h', 'c'])
        expect(s.record.done).toHaveLength(1)
    })

    test('T65 outside edits make fingerprinted undos refuse', () => {
        const a = newSession({ alternateGreetings: ['a', 'a', 'b'] })
        a.deleteGreeting(0, 0, null)
        a.live.obj.alternateGreetings.unshift('c')
        expect(a.undo()).toEqual({ ok: false, reason: 'precondition' })
        expect(a.live.obj.alternateGreetings).toEqual(['c', 'a', 'b'])

        const c = newSession({ alternateGreetings: ['', '', 'b'] })
        c.deleteGreeting(0, 0, null)
        c.live.obj.alternateGreetings.unshift('c')
        expect(c.undo()).toEqual({ ok: false, reason: 'precondition' })

        const d = newSession({ alternateGreetings: ['a', 'b'] })
        d.deleteGreeting(0, 0, null)
        listOnly(d, ['b', 'c'])
        expect(d.undo()).toEqual({ ok: false, reason: 'precondition' })
        expect(d.live.obj.alternateGreetings).toEqual(['b', 'c'])
    })

    test('T65f a later Studio list edit is undoable while the refused step below it stays stuck', () => {
        const s = newSession({ alternateGreetings: ['a', 'b'] })
        s.deleteGreeting(0, 0, null)
        listOnly(s, ['c', 'b'])
        s.addGreeting('n', 5000)
        expect(s.undo().ok).toBe(true)
        expect(s.live.obj.alternateGreetings).toEqual(['c', 'b'])
        expect(s.undo()).toEqual({ ok: false, reason: 'precondition' })
    })

    test('T66 a revert skips a step whose write was lost and applies the rest', () => {
        const s = newSession({ desc: 'd', alternateGreetings: ['a', 'b', 'c'] })
        s.typeDesc('e', 0)
        const anchor = s.record.done[0].id
        const snap = snapshot(s)
        s.deleteGreeting(0, 5000, null)
        lose(s, snap)
        s.deleteGreeting(2, 10000, null)
        const result = s.revertTo(anchor, 15000)
        expect(result.ok && result.skipped).toBe(1)
        expect(s.live.obj.alternateGreetings).toEqual(['a', 'b', 'c'])
    })

    test('T67 net identity: a step whose two sides are equal still applies', () => {
        const s = newSession({ desc: 'd' })
        s.typeDesc('e', 0)
        const anchor = s.record.done[0].id
        s.addGreeting('g', 5000)
        s.deleteGreeting(0, 10000, null)
        s.revertTo(anchor, 15000)
        expect(s.live.obj.alternateGreetings).toEqual([])
        expect(s.undo().ok).toBe(true)
        expect(s.live.obj.alternateGreetings).toEqual([])
    })

    test('T68 a legitimate two-step revert applies both steps', () => {
        const s = newSession({ desc: 'd', alternateGreetings: ['a', 'b', 'c'] })
        s.typeDesc('e', 0)
        const anchor = s.record.done[0].id
        s.deleteGreeting(2, 5000, null)
        s.deleteGreeting(1, 10000, null)
        expect(s.revertTo(anchor, 15000).ok).toBe(true)
        expect(s.live.obj.alternateGreetings).toEqual(['a', 'b', 'c'])
    })

    test('T69 old records revert by the per-op checks and the exact-slot skip', () => {
        const a = newSession({ desc: 'd', alternateGreetings: ['a', 'b'] })
        a.typeDesc('e', 0)
        const anchorA = a.record.done[0].id
        a.deleteGreeting(0, 5000, null)
        stripAll(a)
        expect(a.revertTo(anchorA, 10000).ok).toBe(true)
        expect(a.live.obj.alternateGreetings).toEqual(['a', 'b'])

        const b = newSession({ desc: 'd', alternateGreetings: ['a', 'a'] })
        b.typeDesc('e', 0)
        const anchorB = b.record.done[0].id
        b.deleteGreeting(0, 5000, null)
        stripAll(b)
        expect(b.revertTo(anchorB, 10000)).toEqual({ ok: false, reason: 'precondition' })
        expect(b.live.obj.alternateGreetings).toEqual(['a'])

        const c = newSession({ desc: 'd', alternateGreetings: ['a', 'a'] })
        c.typeDesc('e', 0)
        const anchorC = c.record.done[0].id
        const snap = snapshot(c)
        c.deleteGreeting(0, 5000, null)
        lose(c, snap)
        stripAll(c)
        expect(c.revertTo(anchorC, 10000)).toEqual({ ok: false, reason: 'precondition' })
        expect(c.live.obj.alternateGreetings).toEqual(['a', 'a'])
    })

    test('T70a after a lost add the older edit without a fingerprint no longer applies: nothing reverts', () => {
        const s = newSession({ desc: 'd', alternateGreetings: ['a', 'b', 'c'] })
        s.typeDesc('e', 0)
        const anchor = s.record.done[0].id
        s.deleteGreeting(2, 5000, null)
        s.editGreeting(0, 'z', 10000)
        const snap = snapshot(s)
        s.addGreeting('x', 15000)
        lose(s, snap)
        expect(s.record.done.slice(1).map((step) => step.listFingerprint !== undefined)).toEqual([true, false, true])
        const record = s.record
        expect(s.revertTo(anchor, 20000)).toEqual({ ok: false, reason: 'precondition' })
        expect(s.record).toBe(record)
        expect(s.live.obj.alternateGreetings).toEqual(['z', 'b'])
    })

    test('T70b a mixed record with one delete without a fingerprint: the stop skips it too', () => {
        const s = newSession({ desc: 'd', alternateGreetings: ['a', 'b', 'c'] })
        s.typeDesc('e', 0)
        const anchor = s.record.done[0].id
        s.deleteGreeting(2, 5000, null)
        s.deleteGreeting(1, 10000, null)
        const snap = snapshot(s)
        s.addGreeting('x', 15000)
        lose(s, snap)
        stripStep(s, 2)
        expect(s.record.done.slice(1).map((step) => step.listFingerprint !== undefined)).toEqual([true, false, true])
        const record = s.record
        expect(s.revertTo(anchor, 20000)).toEqual({ ok: false, reason: 'precondition' })
        expect(s.record).toBe(record)
        expect(s.live.obj.alternateGreetings).toEqual(['a'])
    })

    test('T70d with a description change below the stop the revert applies it and counts the skipped list ops', () => {
        const s = newSession({ desc: 'd', alternateGreetings: ['a', 'b', 'c'] })
        s.typeDesc('e', 0)
        const anchor = s.record.done[0].id
        s.typeDesc('f', 2000)
        s.deleteGreeting(2, 5000, null)
        s.editGreeting(0, 'z', 10000)
        const snap = snapshot(s)
        s.addGreeting('x', 15000)
        lose(s, snap)
        const result = s.revertTo(anchor, 20000)
        expect(s.live.obj.desc).toBe('e')
        expect(s.live.obj.alternateGreetings).toEqual(['z', 'b'])
        expect(result.ok && result.listSkipped).toBe(2)
    })

    test('T70c the tracker is built when any reverted step inserts or removes', () => {
        const s = newSession({ desc: 'd', alternateGreetings: ['a', 'a', 'b'] })
        s.typeDesc('e', 0)
        const anchor = s.record.done[0].id
        s.deleteGreeting(0, 5000, null)
        s.live.obj.alternateGreetings.unshift('c')
        s.editGreeting(2, 'z', 10000)
        const result = s.revertTo(anchor, 15000)
        expect(result.ok && result.skipped).toBe(1)
        expect(s.live.obj.alternateGreetings).toEqual(['c', 'a', 'b'])
    })

    test('T76 net identity after two lost actions: both steps apply', () => {
        const s = newSession({ alternateGreetings: ['a'] })
        const snap = snapshot(s)
        s.addGreeting('b', 0)
        s.deleteGreeting(1, 5000, null)
        lose(s, snap)
        expect(s.undo().ok).toBe(true)
        expect(s.live.obj.alternateGreetings).toEqual(['a', 'b'])
        expect(s.undo().ok).toBe(true)
        expect(s.live.obj.alternateGreetings).toEqual(['a'])
    })

    test('ML1 two lost deletes: the undo is refused', () => {
        const s = newSession({ alternateGreetings: ['a', 'b', 'c'] })
        const snap = snapshot(s)
        s.deleteGreeting(2, 0, null)
        s.deleteGreeting(1, 5000, null)
        lose(s, snap)
        expect(s.undo()).toEqual({ ok: false, reason: 'precondition' })
        expect(s.live.obj.alternateGreetings).toEqual(['a', 'b', 'c'])
    })

    test('ML2 a lost edit and delete: the undo is refused', () => {
        const s = newSession({ alternateGreetings: ['a', 'b'] })
        const snap = snapshot(s)
        s.editGreeting(0, 'z', 0)
        s.deleteGreeting(1, 5000, null)
        lose(s, snap)
        expect(s.undo()).toEqual({ ok: false, reason: 'precondition' })
        expect(s.live.obj.alternateGreetings).toEqual(['a', 'b'])
    })

    test('ML3 two lost undo writes: the redo is refused', () => {
        const s = newSession({ alternateGreetings: ['a'] })
        s.addGreeting('x', 0)
        s.addGreeting('y', 5000)
        const snap = snapshot(s)
        s.undo()
        s.undo()
        lose(s, snap)
        expect(s.redo()).toEqual({ ok: false, reason: 'precondition' })
        expect(s.live.obj.alternateGreetings).toEqual(['a', 'x', 'y'])
    })

    test('ML4 two lost undo writes of equal deletes: the redo is refused', () => {
        const s = newSession({ alternateGreetings: ['a', 'a', 'a'] })
        s.deleteGreeting(0, 0, null)
        s.deleteGreeting(0, 5000, null)
        const snap = snapshot(s)
        s.undo()
        s.undo()
        lose(s, snap)
        expect(s.redo()).toEqual({ ok: false, reason: 'precondition' })
        expect(s.live.obj.alternateGreetings).toEqual(['a'])
    })

    test('ML5 a revert across two lost deletes is refused', () => {
        const s = newSession({ desc: 'd', alternateGreetings: ['a', 'b', 'c'] })
        s.typeDesc('e', 0)
        const anchor = s.record.done[0].id
        const snap = snapshot(s)
        s.deleteGreeting(2, 5000, null)
        s.deleteGreeting(1, 10000, null)
        lose(s, snap)
        expect(s.revertTo(anchor, 15000)).toEqual({ ok: false, reason: 'precondition' })
        expect(s.live.obj.alternateGreetings).toEqual(['a', 'b', 'c'])
    })

    test('ML7 an add and a delete lost: both undos are refused', () => {
        const s = newSession({ alternateGreetings: ['a', 'b'] })
        const snap = snapshot(s)
        s.addGreeting('c', 0)
        s.deleteGreeting(0, 5000, null)
        lose(s, snap)
        expect(s.undo()).toEqual({ ok: false, reason: 'precondition' })
        expect(s.undo()).toEqual({ ok: false, reason: 'precondition' })
        expect(s.live.obj.alternateGreetings).toEqual(['a', 'b'])
    })
})

describe('list fingerprint: further replay rows', () => {
    const neighbours: Array<[string[], number]> = [
        [['a', 'a', 'b'], 0],
        [['', ''], 0],
        [['a', 'a', 'a'], 1],
    ]

    test('T11 Restore deleted onto an equal neighbour inserts (it is not gated)', () => {
        const s = newSession({ alternateGreetings: ['a', 'a'] })
        const id = s.deleteGreeting(0, 0, null)
        expect(s.restoreDeleted(id, 5000).ok).toBe(true)
        expect(s.live.obj.alternateGreetings).toEqual(['a', 'a'])
    })

    test('T37 a redo of a restore point after a lost undo is refused', () => {
        const s = newSession({ alternateGreetings: ['a', 'b', 'c'] })
        s.deleteGreeting(1, 0, null)
        s.restorePoint(new Set(), 5000)
        expect(s.live.obj.alternateGreetings).toEqual(['a', 'b', 'c'])
        const snap = snapshot(s)
        s.undo()
        lose(s, snap)
        expect(s.redo()).toEqual({ ok: false, reason: 'precondition' })
        expect(s.live.obj.alternateGreetings).toEqual(['a', 'b', 'c'])
    })

    test.each(neighbours)('T41 Restore deleted next to an equal neighbour %j: undo then redo apply', (list, index) => {
        const s = newSession({ alternateGreetings: [...list] })
        const id = s.deleteGreeting(index, 0, null)
        expect(s.restoreDeleted(id, 5000).ok).toBe(true)
        expect(s.live.obj.alternateGreetings).toEqual(list)
        expect(s.undo().ok).toBe(true)
        expect(s.live.obj.alternateGreetings).toEqual(list.filter((_, i) => i !== index))
        expect(s.redo().ok).toBe(true)
        expect(s.live.obj.alternateGreetings).toEqual(list)
    })

    test.each(neighbours)('T42 delete, revert past it, undo the revert, redo next to an equal neighbour %j', (list, index) => {
        const s = newSession({ desc: 'd', alternateGreetings: [...list] })
        s.typeDesc('e', 0)
        const anchor = s.record.done[0].id
        s.deleteGreeting(index, 5000, null)
        expect(s.revertTo(anchor, 10000).ok).toBe(true)
        expect(s.live.obj.alternateGreetings).toEqual(list)
        expect(s.undo().ok).toBe(true)
        expect(s.live.obj.alternateGreetings).toEqual(list.filter((_, i) => i !== index))
        expect(s.redo().ok).toBe(true)
        expect(s.live.obj.alternateGreetings).toEqual(list)
    })

    test('T43 a revert to the delete after Restore deleted, undone, gives the restored list', () => {
        const s = newSession({ alternateGreetings: ['a', 'a', 'b'] })
        const id = s.deleteGreeting(0, 0, null)
        const target = s.record.done[0].id
        s.restoreDeleted(id, 5000)
        expect(s.revertTo(target, 10000).ok).toBe(true)
        expect(s.live.obj.alternateGreetings).toEqual(['a', 'b'])
        expect(s.undo().ok).toBe(true)
        expect(s.live.obj.alternateGreetings).toEqual(['a', 'a', 'b'])
    })

    test('T53a a revert across a Restore deleted whose write was lost is refused', () => {
        const s = newSession({ alternateGreetings: ['a', 'a'] })
        const id = s.deleteGreeting(0, 0, null)
        const target = s.record.done[0].id
        const snap = snapshot(s)
        s.restoreDeleted(id, 5000)
        lose(s, snap)
        expect(s.revertTo(target, 10000)).toEqual({ ok: false, reason: 'precondition' })
        expect(s.live.obj.alternateGreetings).toEqual(['a'])
    })

    test('T53b the same, then a desc edit lands: only the desc is reverted and X is not listed', () => {
        const s = newSession({ desc: 'd', alternateGreetings: ['a', 'a'] })
        const id = s.deleteGreeting(0, 0, null)
        const target = s.record.done[0].id
        const snap = snapshot(s)
        s.restoreDeleted(id, 5000)
        lose(s, snap)
        s.typeDesc('z', 10000)
        const result = s.revertTo(target, 20000)
        expect(result.ok && result.skipped).toBe(1)
        expect(s.live.obj.desc).toBe('d')
        expect(s.live.obj.alternateGreetings).toEqual(['a'])
        expect(s.record.deleted).toEqual([])
    })

    test('T54 the undo of a revert whose write was lost is refused', () => {
        const s = newSession({ desc: 'd', alternateGreetings: ['a', 'a'] })
        s.typeDesc('e', 0)
        const anchor = s.record.done[0].id
        s.deleteGreeting(0, 5000, null)
        const snap = snapshot(s)
        s.revertTo(anchor, 10000)
        lose(s, snap)
        expect(s.undo()).toEqual({ ok: false, reason: 'precondition' })
        expect(s.live.obj.alternateGreetings).toEqual(['a'])
    })

    test('T55b a redo of a restore point after a lost undo is refused', () => {
        const s = newSession({ alternateGreetings: ['x', 'b'] })
        s.deleteGreeting(0, 0, null)
        s.restorePoint(new Set(), 5000)
        const snap = snapshot(s)
        s.undo()
        lose(s, snap)
        expect(s.redo()).toEqual({ ok: false, reason: 'precondition' })
        expect(s.live.obj.alternateGreetings).toEqual(['x', 'b'])
    })

    test.each(neighbours)('T56 a legitimate remove next to an equal neighbour %j: undo and redo apply', (list, index) => {
        const s = newSession({ alternateGreetings: [...list] })
        s.deleteGreeting(index, 0, null)
        expect(s.undo().ok).toBe(true)
        expect(s.live.obj.alternateGreetings).toEqual(list)
        expect(s.redo().ok).toBe(true)
        expect(s.live.obj.alternateGreetings).toEqual(list.filter((_, i) => i !== index))
    })

    test('T65b a Restore deleted redo after an outside prepend is refused, and so is the delete below it', () => {
        const s = newSession({ alternateGreetings: ['a', 'a', 'b'] })
        const id = s.deleteGreeting(0, 0, null)
        s.restoreDeleted(id, 5000)
        s.undo()
        s.live.obj.alternateGreetings.unshift('c')
        expect(s.redo()).toEqual({ ok: false, reason: 'precondition' })
        expect(s.undo()).toEqual({ ok: false, reason: 'precondition' })
        expect(s.live.obj.alternateGreetings).toEqual(['c', 'a', 'b'])
    })

    test('T65e an outside re-creation of the list does not make the undo apply', () => {
        const s = newSession({ alternateGreetings: ['a', 'a'] })
        s.deleteGreeting(0, 0, null)
        listOnly(s, ['a', 'a'])
        expect(s.undo()).toEqual({ ok: false, reason: 'precondition' })
        expect(s.live.obj.alternateGreetings).toEqual(['a', 'a'])
    })

    test('T72 the stated residue: two lost edits of a first message, an undo rewrites an equal slot', () => {
        const s = newSession({ alternateGreetings: ['b', 'b', ''] })
        const snap = snapshot(s)
        s.deleteGreeting(1, 0, null)
        s.editGreeting(1, 'b', 5000)
        lose(s, snap)
        const result = s.undo()
        expect(result.ok).toBe(true)
        expect(s.live.obj.alternateGreetings).toEqual(['b', '', ''])
    })
})

// T15a: a record as the pre-fingerprint producer wrote it (steps hold id, at, label and ops only),
// and the outcomes of a fixed replay sequence over it. Both were captured by running the same
// sequence against the unmodified producer and replayer before the fingerprint existed, so the
// outcomes are the pre-change values. No replayed slot has an equal neighbour.
const LEGACY_RECORD = {
    ownerKey: 'character:c1',
    touchedAt: 15000,
    done: [
        { id: 'page:1', at: 0, label: { kind: 'field', field: 'desc' }, ops: [{ op: 'set', path: 'desc', before: { had: true, value: 'd0' }, after: { had: true, value: 'x' } }] },
        { id: 'page:2', at: 5000, label: { kind: 'greetingEdit' }, ops: [{ op: 'listSet', index: 1, before: 'b', after: 'B' }] },
        {
            id: 'page:3',
            at: 10000,
            label: { kind: 'greetingRemove' },
            ops: [
                { op: 'listRemove', index: 0, value: 'a', deletedId: 'del3' },
                { op: 'chatFm', chatId: 'chatA', before: { had: true, value: 2 }, after: { had: true, value: -1 } },
            ],
        },
        { id: 'page:4', at: 15000, label: { kind: 'greetingAdd' }, ops: [{ op: 'listInsert', index: 2, value: 'd' }] },
    ],
    undone: [],
    deleted: [{ id: 'del3', at: 10000, index: 0, value: 'a', sideChat: { chatId: 'chatA', before: { had: true, value: 2 } } }],
    restore: {
        visitId: 'v1',
        at: 0,
        fields: {
            desc: { before: { had: true, value: 'd0' }, last: { had: true, value: 'x' } },
            alternateGreetings: { before: { list: ['a', 'b', 'c'] }, last: { list: ['B', 'c', 'd'] } },
        },
    },
}

// [label, ok, reason, skipped, list, chatA fmIndex, done ids, undone ids, deleted ids, ops of the moved or added step]
const LEGACY_OUTCOMES: Array<[string, boolean, string | null, number | null, string[], number, string[], string[], string[], string]> = [
    ['undo add', true, null, 0, ['B', 'c'], -1, ['page:1', 'page:2', 'page:3'], ['page:4'], ['del3'], 'listInsert2'],
    ['undo delete', true, null, 0, ['a', 'B', 'c'], 2, ['page:1', 'page:2'], ['page:4', 'page:3'], [], 'listRemove0,chatFm'],
    ['redo delete', true, null, 0, ['B', 'c'], -1, ['page:1', 'page:2', 'page:3'], ['page:4'], ['del3'], 'listInsert2'],
    ['undo delete again', true, null, 0, ['a', 'B', 'c'], 2, ['page:1', 'page:2'], ['page:4', 'page:3'], [], 'listRemove0,chatFm'],
    ['undo edit', true, null, 0, ['a', 'b', 'c'], 2, ['page:1'], ['page:4', 'page:3', 'page:2'], [], 'listSet1'],
    ['redo edit', true, null, 0, ['a', 'B', 'c'], 2, ['page:1', 'page:2'], ['page:4', 'page:3'], [], 'listRemove0,chatFm'],
    ['redo delete', true, null, 0, ['B', 'c'], -1, ['page:1', 'page:2', 'page:3'], ['page:4'], ['del3'], 'listInsert2'],
    ['redo add', true, null, 0, ['B', 'c', 'd'], -1, ['page:1', 'page:2', 'page:3', 'page:4'], [], ['del3'], 'listInsert2'],
    ['revert to typing', true, null, 0, ['a', 'b', 'c'], 2, ['page:1', 'page:2', 'page:3', 'page:4', 'page:5'], [], [], 'chatFm,listSet0,listInsert1,listRemove3,listInsert3,listRemove3'],
]

// The same session after the revert that the old record's replay makes. Undoing a revert that took
// an item back from the deleted items lists the item again, so the item can be restored (T19); the
// replays before the revert do not touch that lifecycle and stay pinned to the old values above.
const REVERT_LIFECYCLE_OUTCOMES: typeof LEGACY_OUTCOMES = [
    ['undo revert', true, null, 0, ['B', 'c', 'd'], -1, ['page:1', 'page:2', 'page:3', 'page:4'], ['page:5'], ['del3'], 'chatFm,listSet0,listInsert1,listRemove3,listInsert3,listRemove3'],
    ['restore deleted', true, null, 0, ['a', 'B', 'c', 'd'], 2, ['page:1', 'page:2', 'page:3', 'page:4', 'page:6'], [], [], 'listInsert0,chatFm'],
    ['undo restore', true, null, 0, ['B', 'c', 'd'], -1, ['page:1', 'page:2', 'page:3', 'page:4'], ['page:6'], ['del3'], 'listInsert0,chatFm'],
    ['redo restore', true, null, 0, ['a', 'B', 'c', 'd'], 2, ['page:1', 'page:2', 'page:3', 'page:4', 'page:6'], [], [], 'listInsert0,chatFm'],
]

describe('T15a an old record replays as before the fingerprint', () => {
    test('every outcome equals the pre-change value and moved steps differ only by the new field', () => {
        const record = parseOwnerRecord(JSON.parse(JSON.stringify(LEGACY_RECORD)), characterOwnerKey('c1'))
        expect(record).not.toBeNull()
        const live = makeLive({ desc: 'x', alternateGreetings: ['B', 'c', 'd'], chats: { chatA: { fmIndex: -1 } } })
        const s = new Session(live)
        s.state = createModelState(record!)
        s.counter = 4
        const note = (label: string, r: PlanResult) => {
            const top = s.record.undone.at(-1) ?? s.record.done.at(-1)
            const moved = (top?.ops ?? []).map((op) => (op.op === 'chatFm' || op.op === 'set' ? op.op : `${op.op}${op.index}`)).join(',')
            return [
                label,
                r.ok,
                r.ok === false ? r.reason : null,
                r.ok === true ? r.skipped : null,
                [...live.obj.alternateGreetings],
                live.obj.chats.chatA.fmIndex,
                s.record.done.map((d) => d.id),
                s.record.undone.map((d) => d.id),
                s.record.deleted.map((d) => d.id),
                moved,
            ]
        }
        const actual = [
            note('undo add', s.undo(20000)),
            note('undo delete', s.undo(20001)),
            note('redo delete', s.redo(20002)),
            note('undo delete again', s.undo(20003)),
            note('undo edit', s.undo(20004)),
            note('redo edit', s.redo(20005)),
            note('redo delete', s.redo(20006)),
            note('redo add', s.redo(20007)),
            note('revert to typing', s.revertTo(s.record.done[0].id, 20008)),
            note('undo revert', s.undo(20009)),
            note('restore deleted', s.restoreDeleted('del3', 20010)),
            note('undo restore', s.undo(20011)),
            note('redo restore', s.redo(20012)),
        ]
        expect(actual.slice(0, LEGACY_OUTCOMES.length)).toEqual(LEGACY_OUTCOMES)
        expect(actual.slice(LEGACY_OUTCOMES.length)).toEqual(REVERT_LIFECYCLE_OUTCOMES)
    })
})

// ---------------------------------------------------------------- generated histories (T60a, T60b)

function genRng(seed: number) {
    let a = seed
    return () => {
        a = (a + 0x6d2b79f5) | 0
        let t = Math.imul(a ^ (a >>> 15), 1 | a)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

const ALPHABET = ['a', 'b', '']
type ActionKind = 'add' | 'delete' | 'restoreDeleted' | 'textEdit' | 'descEdit'

interface GeneratedHistory {
    s: Session
    anchor: string
    actions: Array<{ kind: ActionKind; snap: Snapshot }>
}

// 2-4 actions over a 0-3 element list; `limit` builds only a prefix of the same history.
function buildHistory(seed: number, limit = Infinity): GeneratedHistory {
    const next = genRng(seed)
    const start = Array.from({ length: Math.floor(next() * 4) }, () => ALPHABET[Math.floor(next() * 3)])
    const s = newSession({ desc: 'd', alternateGreetings: start, chats: { chatA: { fmIndex: 0 } } })
    s.typeDesc('e', 0)
    const anchor = s.record.done[0].id
    const total = 2 + Math.floor(next() * 3)
    const actions: GeneratedHistory['actions'] = []
    for (let i = 0; i < total && i < limit; i++) {
        const at = (i + 1) * 5000
        const list = s.live.obj.alternateGreetings
        const snap = snapshot(s)
        const pick = next()
        let kind: ActionKind
        if (pick < 0.3) kind = 'add'
        else if (pick < 0.55 && list.length > 0) kind = 'delete'
        else if (pick < 0.7 && s.record.deleted.length > 0) kind = 'restoreDeleted'
        else if (pick < 0.9 && list.length > 0) kind = 'textEdit'
        else kind = 'descEdit'
        if (kind === 'add') {
            s.addGreeting(ALPHABET[Math.floor(next() * 3)], at)
        } else if (kind === 'delete') {
            s.deleteGreeting(Math.floor(next() * list.length), at, null)
        } else if (kind === 'restoreDeleted') {
            s.restoreDeleted(s.record.deleted[s.record.deleted.length - 1].id, at)
        } else if (kind === 'textEdit') {
            const index = Math.floor(next() * list.length)
            let value = ALPHABET[Math.floor(next() * 3)]
            if (value === list[index]) value = ALPHABET[(ALPHABET.indexOf(value) + 1) % 3]
            s.editGreeting(index, value, at)
        } else {
            s.typeDesc(`e${i}`, at)
        }
        actions.push({ kind, snap })
    }
    return { s, anchor, actions }
}

const hasListShape = (step: Step) => step.ops.some((op) => op.op === 'listInsert' || op.op === 'listRemove')
const sameList = (a: readonly string[], b: readonly string[]) => JSON.stringify(a) === JSON.stringify(b)
const countOf = (list: readonly string[], value: string) => list.filter((entry) => entry === value).length

interface Tally {
    failures: string[]
    // A listSet-only top whose slot held the same text: the stated residue (counted, not asserted).
    residue: number
    // A step that applied from its expected side but did not reach its other side.
    netPartial: number
}

// Replays the top step and checks the contract: a fingerprinted step changes the list only from the
// list it was built from; a listSet-only step is counted.
function checkReplay(label: string, s: Session, direction: 'undo' | 'redo', at: number, tally: Tally): PlanResult | null {
    const stack = direction === 'undo' ? s.record.done : s.record.undone
    const top = stack[stack.length - 1]
    if (!top) return null
    const before = [...s.live.obj.alternateGreetings]
    // Before the fingerprint existed there is no side to read: every list-shape step is then held to
    // "the list is unchanged", which is the contract the lost-write legs state.
    const side = typeof listSideOf === 'function' ? listSideOf(top, direction, before) : 'none'
    const result = direction === 'undo' ? s.undo(at) : s.redo(at)
    const after = s.live.obj.alternateGreetings
    if (hasListShape(top)) {
        if (side === 'expected') {
            const other = direction === 'undo' ? top.listFingerprint!.before : top.listFingerprint!.after
            if (result.ok && H(after) !== other) tally.netPartial += 1
        } else if (!sameList(after, before)) {
            tally.failures.push(`${label}: ${direction} changed the list from ${side}`)
        }
    } else if (!sameList(after, before)) {
        tally.residue += 1
    }
    return result
}

describe('T60a / T60b generated histories against the real functions', () => {
    const N = 1000
    const newTally = (): Tally => ({ failures: [], residue: 0, netPartial: 0 })

    test('(1) K trailing lost actions, then undo', () => {
        for (const K of [1, 2, 3]) {
            const tally = newTally()
            let run = 0
            for (let seed = 1; seed <= N; seed++) {
                const h = buildHistory(seed)
                if (h.actions.length < K) continue
                run += 1
                lose(h.s, h.actions[h.actions.length - K].snap)
                checkReplay(`seed ${seed} K ${K}`, h.s, 'undo', 99000, tally)
            }
            expect(tally.failures).toEqual([])
            expect(run).toBeGreaterThanOrEqual(K === 3 ? N * 0.5 : N * 0.7)
        }
    })

    test('(2) K lost undo writes, then redo', () => {
        for (const K of [1, 2, 3]) {
            const tally = newTally()
            let run = 0
            for (let seed = 1; seed <= N; seed++) {
                const h = buildHistory(seed)
                if (h.actions.length < K) continue
                run += 1
                const snap = snapshot(h.s)
                for (let k = 0; k < K; k++) h.s.undo(70000 + k)
                lose(h.s, snap)
                checkReplay(`seed ${seed} K ${K}`, h.s, 'redo', 99000, tally)
            }
            expect(tally.failures).toEqual([])
            expect(run).toBeGreaterThanOrEqual(K === 3 ? N * 0.5 : N * 0.7)
        }
    })

    test('(3) a lost commit mixing edits, undos and redos, then undo and redo', () => {
        for (const direction of ['undo', 'redo'] as const) {
            const tally = newTally()
            let run = 0
            for (let seed = 1; seed <= N; seed++) {
                const h = buildHistory(seed)
                const next = genRng(seed + 100000)
                const snap = snapshot(h.s)
                const count = 1 + Math.floor(next() * 3)
                for (let k = 0; k < count; k++) {
                    const pick = next()
                    const list = h.s.live.obj.alternateGreetings
                    if (pick < 0.25) h.s.addGreeting(ALPHABET[Math.floor(next() * 3)], 80000 + k)
                    else if (pick < 0.45 && list.length > 0) h.s.editGreeting(Math.floor(next() * list.length), `m${k}`, 80000 + k)
                    else if (pick < 0.75) h.s.undo(80000 + k)
                    else h.s.redo(80000 + k)
                }
                lose(h.s, snap)
                if (checkReplay(`seed ${seed} ${direction}`, h.s, direction, 99000, tally)) run += 1
            }
            expect(tally.failures).toEqual([])
            expect(run).toBeGreaterThanOrEqual(N * (direction === 'undo' ? 0.55 : 0.2))
        }
    })

    test('(4) legitimate round trips and reverts are exact', () => {
        let multiOp = 0
        let reverts = 0
        for (let seed = 1; seed <= N; seed++) {
            const h = buildHistory(seed)
            const final = [...h.s.live.obj.alternateGreetings]
            const n = h.s.record.done.length
            for (let k = 0; k < n; k++) expect(h.s.undo(70000 + k).ok).toBe(true)
            for (let k = 0; k < n; k++) expect(h.s.redo(71000 + k).ok).toBe(true)
            expect(h.s.live.obj.alternateGreetings).toEqual(final)
            if (n > 0) {
                h.s.undo(72000)
                h.s.redo(72001)
                expect(h.s.live.obj.alternateGreetings).toEqual(final)
            }
            if (h.s.record.done.length > 1) {
                const result = h.s.revertTo(h.anchor, 73000)
                if (result.ok) {
                    reverts += 1
                    if (result.writes.filter((write) => write.op === 'listSet' || write.op === 'listInsert' || write.op === 'listRemove').length >= 2) multiOp += 1
                    const reverted = [...h.s.live.obj.alternateGreetings]
                    expect(h.s.undo(74000).ok).toBe(true)
                    expect(h.s.live.obj.alternateGreetings).toEqual(final)
                    expect(h.s.redo(74001).ok).toBe(true)
                    expect(h.s.live.obj.alternateGreetings).toEqual(reverted)
                }
            }
        }
        expect(multiOp / Math.max(1, reverts)).toBeGreaterThanOrEqual(0.75)
    })

    test('(5) K lost, then a revert to the anchor, against the twin that never had the lost actions', () => {
        for (const K of [1, 2, 3]) {
            const failures: string[] = []
            for (let seed = 1; seed <= N; seed++) {
                const h = buildHistory(seed)
                if (h.actions.length < K || h.s.record.done.length < 2) continue
                const lost = h.actions.slice(h.actions.length - K).map((a) => a.kind)
                const twin = buildHistory(seed, h.actions.length - K)
                const twinBefore = [...twin.s.live.obj.alternateGreetings]
                twin.s.revertTo(twin.anchor, 75000)
                const twinResult = [...twin.s.live.obj.alternateGreetings]
                lose(h.s, h.actions[h.actions.length - K].snap)
                const live = [...h.s.live.obj.alternateGreetings]
                h.s.revertTo(h.anchor, 75000)
                const result = [...h.s.live.obj.alternateGreetings]
                const hasRestore = lost.includes('restoreDeleted')
                const hasText = lost.includes('textEdit')
                if (!hasRestore && !hasText) {
                    if (!sameList(result, live) && !sameList(result, twinResult)) failures.push(`5a seed ${seed} K ${K}`)
                } else if (hasRestore && !hasText) {
                    for (const value of ALPHABET) {
                        if (countOf(result, value) > countOf(live, value) && countOf(result, value) > countOf(twinResult, value)) failures.push(`5b seed ${seed} K ${K} ${JSON.stringify(value)}`)
                    }
                }
                expect(twinBefore).toBeDefined()
            }
            expect(failures).toEqual([])
        }
    })

    test('(6) old records: the list never grows after one lost action, and a legitimate round trip is exact', () => {
        let refusedLegitimate = 0
        for (let seed = 1; seed <= N; seed++) {
            const lostCase = buildHistory(seed)
            if (lostCase.actions.length >= 1) {
                stripAll(lostCase.s)
                lose(lostCase.s, lostCase.actions[lostCase.actions.length - 1].snap)
                const top = lostCase.s.record.done[lostCase.s.record.done.length - 1]
                const before = [...lostCase.s.live.obj.alternateGreetings]
                lostCase.s.undo(99000)
                const after = lostCase.s.live.obj.alternateGreetings
                expect(after.length <= before.length || top.label.kind !== 'restoreDeleted').toBe(true)
                if (after.length > before.length) throw new Error(`old record grew: seed ${seed}`)
                if (after.length < before.length) expect(top.label.kind).toBe('restoreDeleted')
            }
            const legit = buildHistory(seed)
            stripAll(legit.s)
            const pre = [...legit.s.live.obj.alternateGreetings]
            const undone = legit.s.undo(99000)
            if (!undone.ok) {
                refusedLegitimate += 1
                continue
            }
            const mid = [...legit.s.live.obj.alternateGreetings]
            if (legit.s.redo(99001).ok) {
                expect(legit.s.live.obj.alternateGreetings).toEqual(pre)
            }
            expect(mid).toBeDefined()
        }
        expect(refusedLegitimate).toBeLessThan(N * 0.1)
    })

    test('T60b presence and sides: list-shape steps carry a fingerprint, others none; a drift reads as neither', () => {
        for (let seed = 1; seed <= N; seed++) {
            const h = buildHistory(seed)
            for (const step of h.s.record.done) {
                expect(step.listFingerprint !== undefined).toBe(hasListShape(step))
            }
            h.s.undo(70000)
            for (const step of h.s.record.undone) {
                expect(step.listFingerprint !== undefined).toBe(hasListShape(step))
            }
            h.s.redo(70001)
            const top = h.s.record.done[h.s.record.done.length - 1]
            expect(listSideOf(top, 'undo', h.s.live.obj.alternateGreetings)).toBe(top.listFingerprint ? 'expected' : 'none')
            h.s.live.obj.alternateGreetings.unshift('c')
            expect(listSideOf(top, 'undo', h.s.live.obj.alternateGreetings)).toBe(top.listFingerprint ? 'neither' : 'none')
            if (!hasListShape(top)) {
                // A listSet-only or field step is still replayed per op: a drifted undo that applies redoes exactly.
                const drifted = [...h.s.live.obj.alternateGreetings]
                if (h.s.undo(70002).ok && h.s.redo(70003).ok) {
                    expect(h.s.live.obj.alternateGreetings).toEqual(drifted)
                }
            }
        }
    })
})

describe('list fingerprint: tracker and revert guards', () => {
    function rng(seed: number) {
        let a = seed
        return () => {
            a = (a + 0x6d2b79f5) | 0
            let t = Math.imul(a ^ (a >>> 15), 1 | a)
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296
        }
    }

    test('T75 the tracker equals the full hash after every operation, over strings and non-strings', () => {
        const values: unknown[] = ['a', 'bb', '', null, 5, {}, undefined]
        for (let seed = 1; seed <= 2000; seed++) {
            const next = rng(seed)
            const list: unknown[] = Array.from({ length: Math.floor(next() * 5) }, () => values[Math.floor(next() * values.length)])
            const tracker = createListHashTracker(list)
            expect(tracker.hash(list)).toBe(H(list))
            for (let step = 0; step < 8; step++) {
                const pick = next()
                const value = values[Math.floor(next() * values.length)]
                if (pick < 0.35 && list.length > 0) {
                    const i = Math.floor(next() * list.length)
                    list[i] = value
                    tracker.set(i)
                } else if (pick < 0.7) {
                    const i = Math.floor(next() * (list.length + 1))
                    list.splice(i, 0, value)
                    tracker.insert(i)
                } else if (list.length > 0) {
                    const i = Math.floor(next() * list.length)
                    list.splice(i, 1)
                    tracker.remove(i)
                }
                if (next() < 0.5) {
                    expect(tracker.hash(list)).toBe(H(list))
                    expect(tracker.pendingUnits(list)).toBe(0)
                }
            }
            expect(tracker.hash(list)).toBe(H(list))
        }
        expect(createListHashTracker(['abc', 'de']).pendingUnits(['abc', 'de'])).toBe(0)
        const marked = createListHashTracker(['abc', 'de', 'f'])
        marked.set(0)
        marked.set(2)
        expect(marked.pendingUnits(['xyzw', 'de', null as unknown as string])).toBe(4 + ('\u0000object').length)
    })

    test('T74 every committed revert stores the exact hashes of the lists before and after', () => {
        for (const budget of [undefined, 0, 2]) {
            let checked = 0
            for (let seed = 1; seed <= 1000; seed++) {
                const next = rng(seed)
                const s = newSession({ desc: 'd', alternateGreetings: ['a', 'b', 'a'], chats: { chatA: {} } })
                s.typeDesc('e', 0)
                let at = 5000
                const pool = ['a', 'b', 'c', '']
                const earlier: Snapshot[] = []
                for (let n = 0; n < 20; n++) {
                    at += 5000
                    const pick = next()
                    const list = s.live.obj.alternateGreetings
                    if (pick < 0.04) {
                        earlier.push(snapshot(s))
                    } else if (pick < 0.08 && earlier.length > 0) {
                        // A lost suffix: the owner's live list goes back while the history keeps its steps.
                        lose(s, earlier[Math.floor(next() * earlier.length)])
                    } else if (pick < 0.11 && s.record.deleted.length > 0) {
                        s.restoreDeleted(s.record.deleted[s.record.deleted.length - 1].id, at)
                    } else if (pick < 0.14) {
                        s.restorePoint(new Set(), at)
                    } else if (pick < 0.3) {
                        s.addGreeting(pool[Math.floor(next() * pool.length)], at)
                    } else if (pick < 0.42 && list.length > 0) {
                        s.deleteGreeting(Math.floor(next() * list.length), at, null)
                    } else if (pick < 0.54 && list.length > 0) {
                        s.editGreeting(Math.floor(next() * list.length), pool[Math.floor(next() * pool.length)] + n, at)
                    } else if (pick < 0.6) {
                        s.undo(at)
                    } else if (pick < 0.7) {
                        s.redo(at)
                    } else if (pick < 0.75) {
                        list.unshift('out')
                    } else if (s.record.done.length > 2) {
                        const target = s.record.done[Math.floor(next() * (s.record.done.length - 1))].id
                        const before = [...list]
                        const result = s.revertTo(target, at, budget)
                        const top = s.record.done[s.record.done.length - 1]
                        if (result.ok && top.listFingerprint) {
                            expect(top.listFingerprint).toStrictEqual({ before: H(before), after: H(s.live.obj.alternateGreetings) })
                            checked += 1
                        }
                    }
                }
            }
            expect(checked).toBeGreaterThan(50)
        }
    })

    test('T64c a revert that suspends gives up the two-way check for its older steps', () => {
        const build = () => {
            const s = newSession({ desc: 'd', alternateGreetings: ['a', 'a', 'b'] })
            s.typeDesc('e', 0)
            const anchor = s.record.done[0].id
            s.deleteGreeting(0, 5000, null)
            s.live.obj.alternateGreetings.unshift('c')
            s.editGreeting(2, 'z', 10000)
            return { s, anchor }
        }
        const zero = build()
        const r0 = zero.s.revertTo(zero.anchor, 15000, 0)
        expect(r0.ok && r0.skipped).toBe(1)
        expect(zero.s.live.obj.alternateGreetings).toEqual(['c', 'a', 'b'])
        const one = build()
        const r1 = one.s.revertTo(one.anchor, 15000, 1)
        expect(r1.ok && r1.skipped).toBe(1)
        expect(one.s.live.obj.alternateGreetings).toEqual(['c', 'a', 'b'])
        const full = build()
        full.s.revertTo(full.anchor, 15000)
        expect(full.s.live.obj.alternateGreetings).toEqual(['c', 'a', 'b'])
    })
})

// ---------------------------------------------------------------- deleted-item lifecycle across replays (S2)

describe('deleted-item lifecycle: stored shape', () => {
    test('T18 invertOp carries deletedId both ways and adds no key to a plain op', () => {
        expect(invertOp({ op: 'listRemove', index: 1, value: 'b', deletedId: 'x' })).toStrictEqual({ op: 'listInsert', index: 1, value: 'b', deletedId: 'x' })
        expect(invertOp({ op: 'listInsert', index: 1, value: 'b', deletedId: 'x' })).toStrictEqual({ op: 'listRemove', index: 1, value: 'b', deletedId: 'x' })
        expect(invertOp({ op: 'listRemove', index: 1, value: 'b', deletedId: null })).toStrictEqual({ op: 'listInsert', index: 1, value: 'b' })
        expect(invertOp({ op: 'listInsert', index: 1, value: 'b' })).toStrictEqual({ op: 'listRemove', index: 1, value: 'b', deletedId: null })
        expect(Object.keys(invertOp({ op: 'listRemove', index: 1, value: 'b', deletedId: 'x' }))).toEqual(['op', 'index', 'value', 'deletedId'])
    })

    test('T29 the guard keeps a string deletedId in key order and rejects any other present value', () => {
        const owner = characterOwnerKey('c1')
        const record = (op: unknown) => ({
            ownerKey: owner,
            touchedAt: 1,
            done: [{ id: 'p:1', at: 1, label: { kind: 'revert', toStepId: 'p:0' }, ops: [op] }],
            undone: [],
            deleted: [],
            restore: null,
        })
        const tagged = parseOwnerRecord(record({ op: 'listInsert', index: 0, value: 'x', deletedId: 'd1', extra: 1 }), owner)
        expect(tagged?.done[0].ops[0]).toStrictEqual({ op: 'listInsert', index: 0, value: 'x', deletedId: 'd1' })
        expect(Object.keys(tagged!.done[0].ops[0])).toEqual(['op', 'index', 'value', 'deletedId'])
        const plain = parseOwnerRecord(record({ op: 'listInsert', index: 0, value: 'x' }), owner)
        expect(plain?.done[0].ops[0]).toStrictEqual({ op: 'listInsert', index: 0, value: 'x' })
        for (const bad of [null, 5, {}, true]) {
            expect(parseOwnerRecord(record({ op: 'listInsert', index: 0, value: 'x', deletedId: bad }), owner)).toBeNull()
        }
    })

    test('a record with a consumed item round-trips through the guard unchanged', () => {
        const s = newSession({ desc: 'd', alternateGreetings: ['a', 'b'], chats: { chatA: { fmIndex: 1 } } })
        s.typeDesc('e', 0)
        s.deleteGreeting(0, 5000)
        s.revertTo(s.record.done[0].id, 10000)
        expect(s.record.done[2].ops.some((op) => op.op === 'listInsert' && op.deletedId !== undefined)).toBe(true)
        expect(parseOwnerRecord(JSON.parse(JSON.stringify(s.record)), characterOwnerKey('c1'))).toStrictEqual(s.record)
    })
})

const R9_T47_OPS = (id: string): Op[] => [
    { op: 'listRemove', index: 1, value: 'd', deletedId: null },
    { op: 'listInsert', index: 1, value: 'd' },
    { op: 'listRemove', index: 1, value: 'd', deletedId: id },
]

describe('deleted-item lifecycle: reverts and their undo and redo', () => {
    function deleteThenRevert(chatId: string | null = 'chatA') {
        const s = newSession({ desc: 'd', alternateGreetings: ['a', 'b', 'c'], chats: { chatA: { fmIndex: 1 }, chatB: { fmIndex: 0 } } })
        s.typeDesc('e', 0)
        const anchor = s.record.done[0].id
        const id = s.deleteGreeting(1, 5000, chatId)
        const entry = s.record.deleted[0]
        return { s, anchor, id, entry }
    }

    test('T19 undoing a revert that took an item back lists the item again, identical to the delete\'s entry', () => {
        const { s, anchor, id, entry } = deleteThenRevert()
        expect(s.revertTo(anchor, 10000).ok).toBe(true)
        expect(s.live.obj.alternateGreetings).toEqual(['a', 'b', 'c'])
        expect(s.record.deleted).toEqual([])
        expect(s.record.done.at(-1)?.ops).toStrictEqual([
            { op: 'chatFm', chatId: 'chatA', before: { had: true, value: -1 }, after: { had: true, value: 1 } },
            { op: 'listInsert', index: 1, value: 'b' },
            { op: 'listInsert', index: 3, value: 'b', deletedId: id },
            { op: 'listRemove', index: 3, value: 'b', deletedId: null },
        ])
        expect(s.undo(15000).ok).toBe(true)
        expect(s.live.obj.alternateGreetings).toEqual(['a', 'c'])
        expect(s.record.deleted).toStrictEqual([entry])
        s.typeDesc('f', 20000)
        expect(s.record.deleted).toStrictEqual([entry])
        expect(planRestoreDeleted(s.record, id, s.live.reader).ok).toBe(true)
    })

    test('T20 redoing the revert consumes the item again; repeated undo and redo never list it twice', () => {
        const { s, id } = deleteThenRevert()
        s.revertTo(s.record.done[0].id, 10000)
        for (let cycle = 0; cycle < 3; cycle++) {
            expect(s.undo(15000 + cycle * 10000).ok).toBe(true)
            expect(s.record.deleted.map((item) => item.id)).toEqual([id])
            expect(s.redo(20000 + cycle * 10000).ok).toBe(true)
            expect(s.record.deleted).toEqual([])
        }
    })

    test('T21 one revert past deletes on two chats gives each item back with its own side chat', () => {
        const s = newSession({ desc: 'd', alternateGreetings: ['a', 'b', 'c'], chats: { chatA: { fmIndex: 1 }, chatB: { fmIndex: 0 } } })
        s.typeDesc('e', 0)
        const anchor = s.record.done[0].id
        s.deleteGreeting(0, 5000, 'chatA')
        s.deleteGreeting(0, 10000, 'chatB')
        const entries = [...s.record.deleted]
        expect(s.revertTo(anchor, 15000).ok).toBe(true)
        expect(s.record.deleted).toEqual([])
        expect(s.undo(20000).ok).toBe(true)
        const byId = (list: readonly DeletedItem[]) => [...list].sort((x, y) => x.id.localeCompare(y.id))
        expect(byId(s.record.deleted)).toStrictEqual(byId(entries))
        expect(s.record.deleted.map((item) => item.sideChat?.chatId).sort()).toEqual(['chatA', 'chatB'])
    })

    test('T22 a revert of a revert lists each item with its original side chat; undo consumes, redo lists', () => {
        const s = newSession({ desc: 'd', alternateGreetings: ['a', 'b', 'c'], chats: { chatA: { fmIndex: 1 }, chatB: { fmIndex: 0 } } })
        s.typeDesc('e', 0)
        const anchor = s.record.done[0].id
        s.deleteGreeting(0, 5000, 'chatA')
        s.deleteGreeting(0, 10000, 'chatB')
        const entries = [...s.record.deleted]
        const beforeFirstRevert = s.record.done.at(-1)!.id
        s.revertTo(anchor, 15000)
        expect(s.live.obj.alternateGreetings).toEqual(['a', 'b', 'c'])
        expect(s.revertTo(beforeFirstRevert, 20000).ok).toBe(true)
        expect(s.live.obj.alternateGreetings).toEqual(['c'])
        const byId = (list: readonly DeletedItem[]) => [...list].sort((x, y) => x.id.localeCompare(y.id))
        expect(byId(s.record.deleted)).toStrictEqual(byId(entries))
        expect(s.undo(25000).ok).toBe(true)
        expect(s.record.deleted).toEqual([])
        expect(s.redo(30000).ok).toBe(true)
        expect(byId(s.record.deleted)).toStrictEqual(byId(entries))
    })

    test('T23 a revert past a revert and its delete, with the character already as at the anchor, changes and records nothing', () => {
        const { s, anchor, id } = deleteThenRevert()
        expect(s.revertTo(anchor, 10000).ok).toBe(true)
        const record = s.record
        expect(s.revertTo(anchor, 15000)).toEqual({ ok: false, reason: 'unchanged' })
        expect(s.record).toBe(record)
        expect(s.live.obj.alternateGreetings).toEqual(['a', 'b', 'c'])
        expect(s.record.deleted).toEqual([])
        expect(s.undo(20000).ok).toBe(true)
        expect(s.live.obj.alternateGreetings).toEqual(['a', 'c'])
        expect(s.record.deleted.map((item) => item.id)).toEqual([id])
    })

    test('T24 a revert past a delete and its Restore deleted leaves the message present and unlisted', () => {
        const { s, anchor, id } = deleteThenRevert()
        expect(s.restoreDeleted(id, 10000).ok).toBe(true)
        expect(s.live.obj.alternateGreetings).toEqual(['a', 'b', 'c'])
        const record = s.record
        expect(s.revertTo(anchor, 15000)).toEqual({ ok: false, reason: 'unchanged' })
        expect(s.record).toBe(record)
        expect(s.live.obj.alternateGreetings).toEqual(['a', 'b', 'c'])
        expect(s.record.deleted).toEqual([])
        expect(s.undo(20000).ok).toBe(true)
        expect(s.live.obj.alternateGreetings).toEqual(['a', 'c'])
        expect(s.record.deleted.map((item) => item.id)).toEqual([id])
    })

    test('T25 undoing a revert whose removal is skipped because the message was edited is refused and lists nothing', () => {
        const { s, anchor } = deleteThenRevert()
        s.revertTo(anchor, 10000)
        s.live.obj.alternateGreetings[1] = 'b2'
        const record = s.record
        expect(s.undo(15000)).toEqual({ ok: false, reason: 'precondition' })
        expect(s.record).toBe(record)
        expect(s.live.obj.alternateGreetings).toEqual(['a', 'b2', 'c'])
        expect(s.live.obj.chats.chatA.fmIndex).toBe(1)
        expect(s.record.deleted).toEqual([])
    })

    test('T26 an item whose delete step left both stacks is listed again from the op alone', () => {
        const s = newSession({ desc: 'd', alternateGreetings: ['a', 'b', 'c'], chats: { chatA: { fmIndex: 1 } } })
        s.typeDesc('e', 0)
        const anchor = s.record.done[0].id
        const id = s.deleteGreeting(1, 5000)
        expect(s.revertTo(anchor, 10000).ok).toBe(true)
        // Later steps push the delete step out of the done stack; the revert stays.
        for (let i = 0; i < MAX_DONE - 1; i++) {
            s.typeDesc(`f${i}`, 15000 + i * 5000)
        }
        expect(s.record.done.some((step) => step.label.kind === 'greetingRemove')).toBe(false)
        expect(s.record.done[0].label.kind).toBe('revert')
        for (let i = 0; i < MAX_DONE - 1; i++) {
            expect(s.undo(900000 + i).ok).toBe(true)
        }
        expect(s.undo(950000).ok).toBe(true)
        expect(s.record.deleted).toStrictEqual([{ id, at: 10000, index: 3, value: 'b', sideChat: null }])
    })

    test('T27 listing an item again respects MAX_DELETED, dropping the oldest', () => {
        const { s, anchor, id } = deleteThenRevert()
        s.revertTo(anchor, 10000)
        const padding: DeletedItem[] = Array.from({ length: MAX_DELETED }, (_, i) => ({ id: `pad${i}`, at: i, index: 0, value: `p${i}`, sideChat: null }))
        s.state = { record: { ...s.record, deleted: padding }, open: null }
        expect(s.undo(15000).ok).toBe(true)
        expect(s.record.deleted).toHaveLength(MAX_DELETED)
        expect(s.record.deleted.at(-1)?.id).toBe(id)
        expect(s.record.deleted[0].id).toBe('pad1')
    })

    test('T28 a revert stored before the tag existed does not list anything when undone', () => {
        const record = parseOwnerRecord(
            {
                ownerKey: characterOwnerKey('c1'),
                touchedAt: 3,
                done: [
                    { id: 'p:1', at: 1, label: { kind: 'field', field: 'desc' }, ops: [{ op: 'set', path: 'desc', before: { had: true, value: 'd' }, after: { had: true, value: 'e' } }] },
                    {
                        id: 'p:2',
                        at: 2,
                        label: { kind: 'greetingRemove' },
                        ops: [
                            { op: 'listRemove', index: 1, value: 'b', deletedId: 'del2' },
                            { op: 'chatFm', chatId: 'chatA', before: { had: true, value: 1 }, after: { had: true, value: -1 } },
                        ],
                    },
                    {
                        id: 'p:3',
                        at: 3,
                        label: { kind: 'revert', toStepId: 'p:1' },
                        ops: [
                            { op: 'listInsert', index: 1, value: 'b' },
                            { op: 'chatFm', chatId: 'chatA', before: { had: true, value: -1 }, after: { had: true, value: 1 } },
                        ],
                    },
                ],
                undone: [],
                deleted: [],
                restore: null,
            },
            characterOwnerKey('c1'),
        )
        expect(record).not.toBeNull()
        const s = newSession({ desc: 'e', alternateGreetings: ['a', 'b', 'c'], chats: { chatA: { fmIndex: 1 } } })
        s.state = createModelState(record!)
        const result = s.undo(10)
        expect(result.ok && result.skipped).toBe(0)
        expect(s.live.obj.alternateGreetings).toEqual(['a', 'c'])
        expect(s.record.deleted).toEqual([])
    })

    test('T47 a reopen whose delete cannot apply keeps the item listed, with the delete\'s own entry', () => {
        const s = newSession({ desc: 'd', alternateGreetings: ['a', 'b', 'c', 'd'] })
        s.typeDesc('e', 0)
        const anchor = s.record.done[0].id
        const id = s.deleteGreeting(3, 5000, null)
        const entry = s.record.deleted[0]
        s.live.obj.alternateGreetings.splice(0, s.live.obj.alternateGreetings.length, 'a')
        expect(s.restoreDeleted(id, 10000).ok).toBe(true)
        expect(s.live.obj.alternateGreetings).toEqual(['a', 'd'])
        const result = s.revertTo(anchor, 15000)
        expect(result.ok).toBe(true)
        expect(s.live.obj.alternateGreetings).toEqual(['a'])
        expect(s.record.deleted).toStrictEqual([entry])
        expect(s.record.done.at(-1)?.ops).toStrictEqual(R9_T47_OPS(id))
    })

    test('T47b the same reopen on a step without a fingerprint: a delete whose insert fails does not pair', () => {
        const s = newSession({ desc: 'd', alternateGreetings: ['a', 'b', 'c', 'd'] })
        s.typeDesc('e', 0)
        const anchor = s.record.done[0].id
        const id = s.deleteGreeting(3, 5000, null)
        const entry = s.record.deleted[0]
        s.live.obj.alternateGreetings.splice(0, s.live.obj.alternateGreetings.length, 'a')
        s.restoreDeleted(id, 10000)
        stripAll(s)
        expect(s.revertTo(anchor, 15000).ok).toBe(true)
        expect(s.live.obj.alternateGreetings).toEqual(['a'])
        expect(s.record.deleted).toStrictEqual([entry])
        expect(s.record.done.at(-1)?.ops).toStrictEqual(R9_T47_OPS(id))
    })

    test('T10b a revert whose list op is skipped consumes nothing', () => {
        const s = newSession({ desc: 'd', alternateGreetings: ['a', 'b'], chats: { chatA: { fmIndex: 0 } } })
        s.typeDesc('e', 0)
        const anchor = s.record.done[0].id
        const id = s.deleteGreeting(0, 5000)
        listOnly(s, ['a', 'b'])
        s.typeDesc('f', 10000)
        const result = s.revertTo(anchor, 15000)
        expect(result.ok && result.skipped).toBe(1)
        expect(s.live.obj.desc).toBe('e')
        expect(s.live.obj.alternateGreetings).toEqual(['a', 'b'])
        expect(s.record.deleted.map((item) => item.id)).toEqual([id])
    })

    test('T10c a delete\'s insert that fails to apply leaves its item listed', () => {
        const s = newSession({ desc: 'd', alternateGreetings: ['a', 'b', 'c', 'd'] })
        s.typeDesc('e', 0)
        const anchor = s.record.done[0].id
        const id = s.deleteGreeting(3, 5000, null)
        stripAll(s)
        s.live.obj.alternateGreetings.splice(0, s.live.obj.alternateGreetings.length, 'a')
        s.typeDesc('f', 10000)
        const result = s.revertTo(anchor, 15000)
        expect(result.ok && result.skipped).toBe(1)
        expect(s.live.obj.alternateGreetings).toEqual(['a'])
        expect(s.record.deleted.map((item) => item.id)).toEqual([id])
    })

    test('T50 diagnostic: a lost undo of a revert leaves its item listed while the message is present', () => {
        const { s, anchor, id } = deleteThenRevert(null)
        s.revertTo(anchor, 10000)
        const snap = snapshot(s)
        s.undo(15000)
        lose(s, snap)
        expect(s.record.deleted.map((item) => item.id)).toEqual([id])
        expect(s.redo(20000)).toEqual({ ok: false, reason: 'precondition' })
        expect(s.live.obj.alternateGreetings).toEqual(['a', 'b', 'c'])
        expect(s.record.deleted.map((item) => item.id)).toEqual([id])
    })

    test('T67 a revert whose two sides are equal re-lists the item when undone', () => {
        const s = newSession({ desc: 'd', alternateGreetings: [] })
        s.typeDesc('e', 0)
        const anchor = s.record.done[0].id
        s.addGreeting('g', 5000)
        const id = s.deleteGreeting(0, 10000, null)
        expect(s.revertTo(anchor, 15000).ok).toBe(true)
        expect(s.live.obj.alternateGreetings).toEqual([])
        expect(s.undo(20000).ok).toBe(true)
        expect(s.live.obj.alternateGreetings).toEqual([])
        expect(s.record.deleted.map((item) => item.id)).toEqual([id])
    })
})

describe('deleted-item lifecycle: Restore deleted redo', () => {
    test('T59a a Restore deleted redo on the other side is refused and does not consume the item', () => {
        const s = newSession({ alternateGreetings: ['a', 'b'], chats: { chatA: { fmIndex: 1 } } })
        const id = s.deleteGreeting(0, 0)
        expect(s.restoreDeleted(id, 5000).ok).toBe(true)
        s.undo(10000)
        listOnly(s, ['a', 'b'])
        const fm = s.live.obj.chats.chatA.fmIndex
        const record = s.record
        expect(s.redo(15000)).toEqual({ ok: false, reason: 'precondition' })
        expect(s.record).toBe(record)
        expect(s.live.obj.alternateGreetings).toEqual(['a', 'b'])
        expect(s.live.obj.chats.chatA.fmIndex).toBe(fm)
        expect(s.record.deleted.map((item) => item.id)).toEqual([id])
    })

    test('T59b an old-record redo whose insert is skipped by the occupied slot does not consume the item', () => {
        const record = parseOwnerRecord(
            {
                ownerKey: characterOwnerKey('c1'),
                touchedAt: 3,
                done: [
                    {
                        id: 'p:1',
                        at: 1,
                        label: { kind: 'greetingRemove' },
                        ops: [
                            { op: 'listRemove', index: 0, value: 'a', deletedId: 'del1' },
                            { op: 'chatFm', chatId: 'chatA', before: { had: true, value: 1 }, after: { had: true, value: -1 } },
                        ],
                    },
                ],
                undone: [
                    {
                        id: 'p:2',
                        at: 2,
                        label: { kind: 'restoreDeleted', deletedId: 'del1' },
                        ops: [
                            { op: 'listInsert', index: 0, value: 'a' },
                            { op: 'chatFm', chatId: 'chatA', before: { had: true, value: -1 }, after: { had: true, value: 1 } },
                        ],
                    },
                ],
                deleted: [{ id: 'del1', at: 1, index: 0, value: 'a', sideChat: { chatId: 'chatA', before: { had: true, value: 1 } } }],
                restore: null,
            },
            characterOwnerKey('c1'),
        )
        expect(record).not.toBeNull()
        const s = newSession({ alternateGreetings: ['a'], chats: { chatA: { fmIndex: -1 } } })
        s.state = createModelState(record!)
        const result = s.redo(10)
        expect(result.ok && result.skipped).toBe(1)
        expect(s.live.obj.alternateGreetings).toEqual(['a'])
        expect(s.live.obj.chats.chatA.fmIndex).toBe(1)
        expect(s.record.deleted.map((item) => item.id)).toEqual(['del1'])
    })

    test('T59c a redo refused because the list changed outside does not consume the item', () => {
        const s = newSession({ alternateGreetings: ['a', 'b', 'x'], chats: { chatA: { fmIndex: 0 } } })
        const id = s.deleteGreeting(2, 0)
        expect(s.restoreDeleted(id, 5000).ok).toBe(true)
        expect(s.undo(10000).ok).toBe(true)
        s.live.obj.alternateGreetings.splice(1, 1)
        expect(s.live.obj.alternateGreetings).toEqual(['a'])
        const record = s.record
        expect(s.redo(15000)).toEqual({ ok: false, reason: 'precondition' })
        expect(s.record).toBe(record)
        expect(s.live.obj.chats.chatA.fmIndex).toBe(-1)
        expect(s.live.obj.alternateGreetings).toEqual(['a'])
        expect(s.record.deleted.map((item) => item.id)).toEqual([id])
    })

    test('a legitimate redo of Restore deleted still consumes the item', () => {
        const s = newSession({ alternateGreetings: ['a', 'b'], chats: { chatA: { fmIndex: 1 } } })
        const id = s.deleteGreeting(0, 0)
        s.restoreDeleted(id, 5000)
        s.undo(10000)
        expect(s.record.deleted.map((item) => item.id)).toEqual([id])
        expect(s.redo(15000).ok).toBe(true)
        expect(s.record.deleted).toEqual([])
    })
})

// ---------------------------------------------------------------- generated: a revert equals the undos it stands for (T60c)

describe('T60c a legitimate revert to the anchor equals undoing every step above it', () => {
    const ALPHA_LIST = ['a', 'b', '']

    function lifecycleRng(seed: number) {
        let a = seed
        return () => {
            a |= 0
            a = (a + 0x6d2b79f5) | 0
            let t = Math.imul(a ^ (a >>> 15), 1 | a)
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296
        }
    }

    function act(s: Session, next: () => number, clock: { at: number }) {
        const list = s.live.obj.alternateGreetings
        const length = list.length
        const k = next()
        clock.at += 5000
        const at = clock.at
        if (k < 0.2 || length === 0) {
            s.addGreeting(ALPHA_LIST[Math.floor(next() * 3)], at)
            return
        }
        if (k < 0.4) {
            s.deleteGreeting(Math.floor(next() * length), at, null)
            return
        }
        if (k < 0.48 && s.record.deleted.length > 0) {
            s.restoreDeleted(s.record.deleted[Math.floor(next() * s.record.deleted.length)].id, at)
            return
        }
        if (k < 0.58) {
            const index = Math.floor(next() * length)
            const value = ALPHA_LIST[Math.floor(next() * 3)]
            if (value !== list[index]) {
                s.editGreeting(index, value, at)
                return
            }
        }
        if (k < 0.64) {
            s.restorePoint(new Set(), at)
            return
        }
        if (k < 0.72 && s.record.done.length > 1) {
            const done = s.record.done
            s.revertTo(done[Math.floor(next() * (done.length - 1))].id, at)
            return
        }
        if (k < 0.84) {
            s.undo(at)
            return
        }
        if (k < 0.94) {
            s.redo(at)
            return
        }
        s.typeDesc(`D${Math.floor(next() * 1000)}`, at)
    }

    function build(seed: number) {
        const next = lifecycleRng(seed)
        const start = Array.from({ length: Math.floor(next() * 4) }, () => ALPHA_LIST[Math.floor(next() * 3)])
        const s = newSession({ desc: 'd', alternateGreetings: [...start], chats: { chatA: {} } })
        const clock = { at: 0 }
        s.typeDesc('E', 0)
        const anchor = s.record.done[0].id
        const actions = 3 + Math.floor(next() * 10)
        for (let i = 0; i < actions; i++) {
            act(s, next, clock)
        }
        return { s, anchor, start, at: clock.at }
    }

    test('seeds 1 to 3,000 of 3 to 12 actions', () => {
        let violations = 0
        let applied = 0
        let anchorExact = 0
        let unchanged = 0
        const failing: number[] = []
        for (let seed = 1; seed <= 3000; seed++) {
            const a = build(seed)
            const reverted = a.s.revertTo(a.anchor, a.at + 5000)
            const b = build(seed)
            let refused = false
            while (b.s.record.done.length > 1) {
                if (!b.s.undo(b.at + 5000).ok) {
                    refused = true
                    break
                }
            }
            if (reverted.ok === false && reverted.reason !== 'unchanged') {
                continue
            }
            if (reverted.ok) {
                applied += 1
            } else {
                unchanged += 1
            }
            if (JSON.stringify(a.s.live.obj.alternateGreetings) === JSON.stringify(a.start)) {
                anchorExact += 1
            }
            if (!refused && JSON.stringify(a.s.live.obj.alternateGreetings) !== JSON.stringify(b.s.live.obj.alternateGreetings)) {
                violations += 1
                failing.push(seed)
            }
        }
        expect({ violations, failing: failing.slice(0, 5) }).toEqual({ violations: 0, failing: [] })
        expect(applied).toBeGreaterThan(1000)
        expect(anchorExact).toBeGreaterThan(0)
        expect(unchanged).toBeGreaterThan(0)
    })
})

// ---------------------------------------------------------------- S2b: a revert stores its net change

// One unit per op plus the UTF-16 length of every string it holds.
function opUnits(op: Op): number {
    switch (op.op) {
        case 'set':
            return 1 + (op.before.had && typeof op.before.value === 'string' ? op.before.value.length : 0) + (op.after.had && typeof op.after.value === 'string' ? op.after.value.length : 0)
        case 'listSet':
            return 1 + op.before.length + op.after.length
        case 'listInsert':
        case 'listRemove':
            return 1 + op.value.length
        case 'chatFm':
            return 1
    }
}

const stepUnits = (ops: readonly Op[]) => ops.reduce((sum, op) => sum + opUnits(op), 0)
const listUnits = (list: readonly string[]) => list.reduce((sum, value) => sum + value.length, 0)

// The differing middles of two lists after their common prefix and suffix.
function middlesOf(before: readonly string[], after: readonly string[]): [string[], string[]] {
    let start = 0
    while (start < before.length && start < after.length && before[start] === after[start]) start++
    let end = 0
    while (end < before.length - start && end < after.length - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++
    return [before.slice(start, before.length - end), after.slice(start, after.length - end)]
}

// I17 for one committed revert step, from observable sizes only: the first violated part, or null.
function revertStepBound(ops: readonly Op[], before: readonly string[], after: readonly string[], consumed: readonly string[]): string | null {
    const keys = new Set<string>()
    for (const op of ops) {
        if (op.op === 'set' || op.op === 'chatFm') {
            const key = op.op === 'set' ? `set:${op.path}` : `fm:${op.chatId}`
            if (keys.has(key)) return `(a) two value ops for ${key}`
            keys.add(key)
        }
    }
    const [m0, m1] = middlesOf(before, after)
    const tagged = ops.filter((op): op is Extract<Op, { op: 'listInsert' | 'listRemove' }> => (op.op === 'listInsert' && op.deletedId !== undefined) || (op.op === 'listRemove' && op.deletedId !== null))
    const produced = new Set<string>()
    for (const op of tagged) {
        if (op.op === 'listRemove' && op.deletedId !== null) produced.add(op.deletedId)
    }
    const listOps = ops.filter((op) => op.op === 'listSet' || op.op === 'listInsert' || op.op === 'listRemove')
    const countBound = m0.length + m1.length + 2 * (consumed.length + produced.size)
    if (listOps.length > countBound) return `(b) ${listOps.length} list ops > ${countBound}`
    const taggedUnits = tagged.reduce((sum, op) => sum + op.value.length, 0)
    const unitsBound = listUnits(m0) + listUnits(m1) + 2 * taggedUnits + listOps.length
    const units = stepUnits(listOps)
    if (units > unitsBound) return `(c) ${units} list units > ${unitsBound}`
    return null
}

// L6: a stored step's list ops are exact along before -> after: every index in range, every recorded
// before/value equal to the value there, and the ops map the before list to the after list.
function listOpsExact(before: readonly string[], ops: readonly Op[], after: readonly string[]): boolean {
    const cur = [...before]
    for (const op of ops) {
        if (op.op === 'listSet') {
            if (op.index < 0 || op.index >= cur.length || cur[op.index] !== op.before) return false
            cur[op.index] = op.after
        } else if (op.op === 'listInsert') {
            if (op.index < 0 || op.index > cur.length) return false
            cur.splice(op.index, 0, op.value)
        } else if (op.op === 'listRemove') {
            if (op.index < 0 || op.index >= cur.length || cur[op.index] !== op.value) return false
            cur.splice(op.index, 1)
        }
    }
    return JSON.stringify(cur) === JSON.stringify(after)
}

describe('S2b: a revert stores its net change, bounded by the state', () => {
    const BIG = 200_000

    test('T80 delete a listed message, then revert to the anchor, eight times: every revert step holds 4 ops', () => {
        const s = newSession({ desc: 'd', alternateGreetings: ['s0', 'x'.repeat(BIG), 's1'], chats: { chatA: { fmIndex: 1 } } })
        s.typeDesc('E', 0)
        const anchor = s.record.done[0].id
        const series: number[] = []
        for (let k = 1; k <= 8; k++) {
            s.deleteGreeting(1, k * 10000)
            expect(s.revertTo(anchor, k * 10000 + 5000).ok).toBe(true)
            series.push(s.record.done.at(-1)!.ops.length)
            expect(s.live.obj.alternateGreetings).toHaveLength(3)
            expect(s.record.deleted).toEqual([])
        }
        expect(series).toEqual([4, 4, 4, 4, 4, 4, 4, 4])
    })

    test.each([
        ['desc', (s: Session, k: number) => s.typeDesc(`d${k}`, k * 10000)],
        ['listSet', (s: Session, k: number) => s.editGreeting(1, `g${k}`, k * 10000)],
        ['add', (s: Session, k: number) => s.addGreeting(`a${k}`, k * 10000)],
    ] as const)('T81 %s, then revert to the anchor, eight times: every revert step holds 1 op', (_name, act) => {
        const s = newSession({ desc: 'd', alternateGreetings: ['s0', 'x', 's1'], chats: { chatA: {} } })
        s.typeDesc('E', 0)
        const anchor = s.record.done[0].id
        const series: number[] = []
        for (let k = 1; k <= 8; k++) {
            act(s, k)
            expect(s.revertTo(anchor, k * 10000 + 5000).ok).toBe(true)
            series.push(s.record.done.at(-1)!.ops.length)
        }
        expect(series).toEqual([1, 1, 1, 1, 1, 1, 1, 1])
    })

    test('T83 the stored units of every revert in the T80 series equal the first and stay inside I17', () => {
        const s = newSession({ desc: 'd', alternateGreetings: ['s0', 'x'.repeat(BIG), 's1'], chats: { chatA: { fmIndex: 1 } } })
        s.typeDesc('E', 0)
        const anchor = s.record.done[0].id
        const series: number[] = []
        let last: { ops: Op[]; before: string[]; after: string[]; consumed: string[] } | undefined
        for (let k = 1; k <= 8; k++) {
            s.deleteGreeting(1, k * 10000)
            const before = [...s.live.obj.alternateGreetings]
            const plan = s.revertTo(anchor, k * 10000 + 5000)
            const top = s.record.done.at(-1)!
            series.push(stepUnits(top.ops))
            last = { ops: top.ops, before, after: [...s.live.obj.alternateGreetings], consumed: plan.ok ? plan.deletedRemove : [] }
        }
        expect(series).toEqual(Array(8).fill(series[0]))
        expect(revertStepBound(last!.ops, last!.before, last!.after, last!.consumed)).toBeNull()
    })

    function editHeavy() {
        const s = newSession({ desc: 'd', alternateGreetings: ['s0', 'x'.repeat(BIG), 's1'], chats: { chatA: {} } })
        s.typeDesc('E', 0)
        const anchor = s.record.done[0].id
        const start = [...s.live.obj.alternateGreetings]
        for (let k = 0; k < 6; k++) {
            s.editGreeting(1, String.fromCharCode(65 + k).repeat(BIG), 10000 + k * 10000)
            s.addGreeting(`t${k}`, 15000 + k * 10000)
        }
        return { s, anchor, start, before: [...s.live.obj.alternateGreetings] }
    }

    test('T83b an edit-heavy span over a 200,000-unit message stores its middles once', () => {
        const { s, anchor, start, before } = editHeavy()
        const plan = s.revertTo(anchor, 99000, Infinity)
        expect(plan.ok).toBe(true)
        expect(s.live.obj.alternateGreetings).toEqual(start)
        const top = s.record.done.at(-1)!
        expect(revertStepBound(top.ops, before, start, [])).toBeNull()
        expect(stepUnits(top.ops)).toBeLessThanOrEqual(2 * BIG + 6 * 3 + 16)
    })

    test('T64g at the default budget the same revert skips the list ops of its suspended older steps', () => {
        const { s, anchor, before } = editHeavy()
        const plan = s.revertTo(anchor, 99000)
        // Three add decisions fit the budget after the edits of slot 1 marked it; the three oldest
        // adds are suspended, so their removals are skipped and counted. The field still reverts.
        expect(before).toHaveLength(9)
        expect(plan.ok && plan.skipped).toBe(3)
        expect(s.live.obj.alternateGreetings).toEqual(['s0', 'x'.repeat(BIG), 's1', 't0', 't1', 't2'])
        expect(s.live.obj.desc).toBe('E')
    })

    test('T83c a delete in the middle and an add at the end store one insert and one removal, not the shifted run', () => {
        const values = Array.from({ length: 20 }, (_, i) => `v${i}`.padEnd(50_000, 'q'))
        const added = 'new'.padEnd(50_000, 'n')
        const s = newSession({ desc: 'd', alternateGreetings: [...values], chats: { chatA: { fmIndex: 3 } } })
        s.typeDesc('E', 0)
        const anchor = s.record.done[0].id
        const id = s.deleteGreeting(1, 5000)
        s.addGreeting(added, 10000)
        expect(s.revertTo(anchor, 15000).ok).toBe(true)
        expect(s.live.obj.alternateGreetings).toEqual(values)
        const top = s.record.done.at(-1)!
        expect(top.ops).toStrictEqual([
            { op: 'chatFm', chatId: 'chatA', before: { had: true, value: -1 }, after: { had: true, value: 3 } },
            { op: 'listInsert', index: 1, value: values[1] },
            { op: 'listRemove', index: 20, value: added, deletedId: null },
            { op: 'listInsert', index: 20, value: values[1], deletedId: id },
            { op: 'listRemove', index: 20, value: values[1], deletedId: null },
        ])
        expect(stepUnits(top.ops)).toBeLessThanOrEqual(4 * 50_000 + 5)
    })

    test('T83e a middle that differs by more than the search bound but still shares elements is stored as one positional run, exact both ways', () => {
        const start = Array.from({ length: 1500 }, (_, i) => `s${i}`)
        const rewritten = start.map((value, i) => (i % 2 === 0 ? `t${i}` : value))
        rewritten.splice(700, 0, 'inserted')
        const s = newSession({ desc: 'd', alternateGreetings: [...start], chats: { chatA: {} } })
        s.typeDesc('E', 0)
        const anchor = s.record.done[0].id
        s.editGreeting(5, 'first', 5000)
        s.live.obj.alternateGreetings.splice(0, 1500, ...rewritten)
        expect(s.restorePoint(new Set(), 10000).ok).toBe(true)
        expect(s.live.obj.alternateGreetings).toEqual(start)
        expect(s.revertTo(anchor, 15000).ok).toBe(true)
        expect(s.live.obj.alternateGreetings).toEqual(rewritten)
        const top = s.record.done.at(-1)!
        const listOps = top.ops.filter((op) => op.op !== 'set' && op.op !== 'chatFm')
        // Past the bound the search stops sharing elements: the run from the first difference to the
        // last is positional, so the odd slots it could have kept are rewritten too.
        expect(listOps.filter((op) => op.op === 'listSet')).toHaveLength(1149)
        expect(listOps.filter((op) => op.op === 'listInsert')).toHaveLength(1)
        expect(listOps).toHaveLength(1150)
        expect(listOpsExact(start, top.ops, rewritten)).toBe(true)
    })

    test('T83d a completely rewritten middle is stored as positional listSets, exact both ways (the bound itself is pinned by T83e)', () => {
        const start = Array.from({ length: 1200 }, (_, i) => `s${i}`)
        const s = newSession({ desc: 'd', alternateGreetings: [...start], chats: { chatA: {} } })
        s.typeDesc('E', 0)
        const anchor = s.record.done[0].id
        s.editGreeting(5, 'first', 5000)
        const rewritten = start.map((_, i) => `t${i}`)
        s.live.obj.alternateGreetings.splice(0, 1200, ...rewritten)
        // The restore point puts the whole list back: one step of 1200 element rewrites.
        expect(s.restorePoint(new Set(), 10000).ok).toBe(true)
        expect(s.live.obj.alternateGreetings).toEqual(start)
        expect(s.revertTo(anchor, 15000).ok).toBe(true)
        expect(s.live.obj.alternateGreetings).toEqual(rewritten)
        const top = s.record.done.at(-1)!
        const listOps = top.ops.filter((op) => op.op !== 'set' && op.op !== 'chatFm')
        expect(listOps).toHaveLength(1200)
        expect(listOps.every((op) => op.op === 'listSet')).toBe(true)
        expect(listOpsExact(start, top.ops, rewritten)).toBe(true)
    })

    test('T84 one revert that consumes one item and lists another stores the middle and two end-of-list pairs', () => {
        const s = newSession({ desc: 'd', alternateGreetings: ['a', 'b', 'c'], chats: { chatA: { fmIndex: 0 }, chatB: { fmIndex: 2 } } })
        s.typeDesc('E0', 0)
        const x = s.deleteGreeting(0, 5000, 'chatA')
        s.typeDesc('E1', 10000)
        const anchor = s.record.done.at(-1)!.id
        expect(s.restoreDeleted(x, 15000).ok).toBe(true)
        const z = s.deleteGreeting(2, 20000, 'chatB')
        const zEntry = s.record.deleted.find((item) => item.id === z)
        s.editGreeting(1, 'q', 25000)
        expect(s.live.obj.alternateGreetings).toEqual(['a', 'q'])
        const plan = s.revertTo(anchor, 30000)
        expect(plan.ok && plan.deletedRemove).toEqual([z])
        expect(s.live.obj.alternateGreetings).toEqual(['b', 'c'])
        const top = s.record.done.at(-1)!
        expect(top.ops).toStrictEqual([
            { op: 'chatFm', chatId: 'chatB', before: { had: true, value: -1 }, after: { had: true, value: 2 } },
            { op: 'chatFm', chatId: 'chatA', before: { had: true, value: 0 }, after: { had: true, value: -1 } },
            { op: 'listSet', index: 0, before: 'a', after: 'b' },
            { op: 'listSet', index: 1, before: 'q', after: 'c' },
            { op: 'listInsert', index: 2, value: 'c', deletedId: z },
            { op: 'listRemove', index: 2, value: 'c', deletedId: null },
            { op: 'listInsert', index: 2, value: 'a' },
            { op: 'listRemove', index: 2, value: 'a', deletedId: x },
        ])
        expect(top.listFingerprint).toStrictEqual({ before: listFingerprintOf(['a', 'q']), after: listFingerprintOf(['b', 'c']) })
        expect(s.record.deleted.map((item) => item.id)).toEqual([x])
        const undo = s.undo(35000)
        expect(undo.ok && undo.skipped).toBe(0)
        expect(s.live.obj.alternateGreetings).toEqual(['a', 'q'])
        expect(s.record.deleted).toStrictEqual([zEntry])
        expect(s.redo(40000).ok).toBe(true)
        expect(s.live.obj.alternateGreetings).toEqual(['b', 'c'])
        expect(s.record.deleted.map((item) => item.id)).toEqual([x])
    })

    test('T85 a revert whose net effect is nothing changes nothing and records nothing', () => {
        const s = newSession({ desc: 'd', alternateGreetings: ['a', 'b', 'c'], chats: { chatA: { fmIndex: 1 } } })
        s.typeDesc('e', 0)
        const anchor = s.record.done[0].id
        s.deleteGreeting(1, 5000)
        expect(s.revertTo(anchor, 10000).ok).toBe(true)
        const record = s.record
        const plan = planRevert(s.record, anchor, s.live.reader)
        expect(plan).toEqual({ ok: false, reason: 'unchanged' })
        expect(s.revertTo(anchor, 15000)).toEqual({ ok: false, reason: 'unchanged' })
        expect(s.record).toBe(record)
        expect(s.live.obj.alternateGreetings).toEqual(['a', 'b', 'c'])
    })

    // The horizon row: long revert-biased histories of distinct 100,000-unit messages.
    function horizonRng(seed: number) {
        let a = seed
        return () => {
            a = (a + 0x6d2b79f5) | 0
            let t = Math.imul(a ^ (a >>> 15), 1 | a)
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296
        }
    }

    function horizon(seed: number, actions: number, budget: number | undefined) {
        const base = 'm'.repeat(100_000)
        let fresh = 0
        const value = () => `${(fresh += 1)}:${seed}:` + base
        const next = horizonRng(seed)
        const s = newSession({ desc: 'd', alternateGreetings: [value(), value(), value(), value()], chats: { chatA: { fmIndex: 0 } } })
        const listAt = new Map<string, string[]>()
        const note = () => {
            const top = s.record.done.at(-1)
            if (top) listAt.set(top.id, [...s.live.obj.alternateGreetings])
        }
        let at = 0
        s.typeDesc('E', at)
        note()
        let maxLen = s.live.obj.alternateGreetings.length
        const stats = { reverts: 0, unchanged: 0, exactChecked: 0, maxStoredOps: 0, maxLen: 0 }
        for (let i = 0; i < actions; i++) {
            at += 5000
            const list = s.live.obj.alternateGreetings
            const pick = next()
            if (pick < 0.5 && s.record.done.length > 1) {
                const target = s.record.done[Math.floor(next() * (s.record.done.length - 1))].id
                const before = [...list]
                const plan = s.revertTo(target, at, budget)
                if (plan.ok === false) {
                    if (plan.reason === 'unchanged') stats.unchanged += 1
                    continue
                }
                stats.reverts += 1
                const top = s.record.done.at(-1)!
                const after = [...s.live.obj.alternateGreetings]
                stats.maxStoredOps = Math.max(stats.maxStoredOps, top.ops.length)
                expect(revertStepBound(top.ops, before, after, plan.deletedRemove), `seed ${seed} action ${i}`).toBeNull()
                expect(after.length, `seed ${seed} action ${i} live list`).toBeLessThanOrEqual(maxLen)
                const anchorList = listAt.get(target)
                if (plan.skipped === 0 && anchorList) {
                    stats.exactChecked += 1
                    expect(after, `seed ${seed} action ${i} anchor`).toEqual(anchorList)
                }
                expect(s.undo(at + 1).ok).toBe(true)
                expect(s.live.obj.alternateGreetings).toEqual(before)
                expect(s.redo(at + 2).ok).toBe(true)
                expect(s.live.obj.alternateGreetings).toEqual(after)
                note()
            } else if (pick < 0.6) {
                s.typeDesc(`D${i}`, at)
                note()
            } else if (pick < 0.68 && list.length > 0) {
                s.editGreeting(Math.floor(next() * list.length), value(), at)
                note()
            } else if (pick < 0.76) {
                s.addGreeting(value(), at)
                note()
            } else if (pick < 0.84 && list.length > 1) {
                s.deleteGreeting(Math.floor(next() * list.length), at)
                note()
            } else if (pick < 0.88 && s.record.deleted.length > 0) {
                s.restoreDeleted(s.record.deleted[Math.floor(next() * s.record.deleted.length)].id, at)
                note()
            } else if (pick < 0.95) {
                if (s.undo(at).ok) {
                    const top = s.record.done.at(-1)
                    if (top && !listAt.has(top.id)) note()
                }
            } else if (s.redo(at).ok) {
                note()
            }
            maxLen = Math.max(maxLen, s.live.obj.alternateGreetings.length)
        }
        stats.maxLen = maxLen
        return stats
    }

    test.each([[undefined], [0]])('T82 horizon: 1,200 revert-biased actions of distinct 100,000-unit messages at budget %s', (budget) => {
        const totals = { reverts: 0, unchanged: 0, exactChecked: 0, maxStoredOps: 0, maxLen: 0 }
        for (const seed of [1, 2, 3]) {
            const stats = horizon(seed, 1200, budget)
            totals.reverts += stats.reverts
            totals.unchanged += stats.unchanged
            totals.exactChecked += stats.exactChecked
            totals.maxStoredOps = Math.max(totals.maxStoredOps, stats.maxStoredOps)
            totals.maxLen = Math.max(totals.maxLen, stats.maxLen)
        }
        expect(totals.reverts).toBeGreaterThan(1000)
        expect(totals.exactChecked).toBeGreaterThan(50)
    }, 600_000)
})

// ---------------------------------------------------------------- S2b: coupling, item effects, the notice count

const deletedIds = (s: Session) => s.record.deleted.map((item) => item.id)
const liveListedIds = (s: Session) => s.record.deleted.filter((item) => s.live.obj.alternateGreetings.includes(item.value)).map((item) => item.id)

// Everything a History action can change that a test compares across undo and redo.
function stateOf(s: Session): string {
    return JSON.stringify([
        s.live.obj.alternateGreetings,
        s.live.obj.desc ?? null,
        Object.keys(s.live.obj.chats)
            .sort()
            .map((key) => s.live.obj.chats[key].fmIndex ?? null),
        deletedIds(s).sort(),
    ])
}

describe('S2b: a step whose list is on neither side keeps its chat index; item effects are the set difference', () => {
    const big = (c: string, n: number) => c.padEnd(n, c)

    test('T86 a suspended delete leaves the chat first-message index with its skipped list op', () => {
        const p = big('p', 300_000)
        const s = newSession({ desc: 'd', alternateGreetings: [p, 'KEEP-ME', 's1'], chats: { chatA: { fmIndex: 1 } } })
        s.typeDesc('E', 0)
        const anchor = s.record.done[s.record.done.length - 1].id
        const del = s.deleteGreeting(1, 2000)
        s.editGreeting(0, big('q', 300_000), 4000)
        s.addGreeting('t1', 6000)
        s.editGreeting(0, big('r', 300_000), 8000)
        s.addGreeting('t2', 10000)
        const plan = s.revertTo(anchor, 12000)
        expect(s.live.obj.chats.chatA.fmIndex).toBe(-1)
        expect(plan.ok && plan.skipped).toBe(2)
        expect(plan.ok && plan.listSkipped).toBe(1)
        expect(s.live.obj.alternateGreetings).toEqual([p, 's1'])
        expect(deletedIds(s)).toEqual([del])
        s.restoreDeleted(del, 14000)
        expect(s.live.obj.alternateGreetings).toEqual([p, 'KEEP-ME', 's1'])
        expect(s.live.obj.chats.chatA.fmIndex).toBe(1)
    })

    test('T86b a delete decided neither by hash keeps its chat op too', () => {
        const s = newSession({ desc: 'd', alternateGreetings: ['a', 'b', 'c'], chats: { chatA: { fmIndex: 2 } } })
        s.typeDesc('E', 0)
        const anchor = s.record.done[s.record.done.length - 1].id
        s.deleteGreeting(2, 2000)
        s.typeDesc('F', 4000)
        s.live.obj.alternateGreetings.push('z')
        const plan = s.revertTo(anchor, 6000)
        expect(s.live.obj.chats.chatA.fmIndex).toBe(-1)
        expect(plan.ok && plan.skipped).toBe(2)
        expect(plan.ok && plan.listSkipped).toBe(1)
        expect(s.live.obj.desc).toBe('E')
        expect(s.live.obj.alternateGreetings).toEqual(['a', 'b', 'z'])
    })

    test('T87 a revert that consumes and re-produces the same item changes nothing and records nothing', () => {
        const s = newSession({ desc: 'd', alternateGreetings: ['a', 'b'], chats: { chatA: { fmIndex: 0 } } })
        s.typeDesc('E', 0)
        const y = s.deleteGreeting(0, 2000)
        s.typeDesc('A', 4000)
        const anchor = s.record.done[s.record.done.length - 1].id
        s.restoreDeleted(y, 6000)
        expect(s.revertTo(anchor, 8000).ok).toBe(true)
        expect(s.live.obj.alternateGreetings).toEqual(['b'])
        expect(deletedIds(s)).toEqual([y])
        const results: PlanResult[] = []
        const doneLengths: number[] = []
        for (let k = 1; k <= 6; k++) {
            const record = s.record
            results.push(s.revertTo(anchor, 10000 + 2000 * k))
            expect(s.record).toBe(record)
            doneLengths.push(s.record.done.length)
        }
        expect(results).toEqual(Array.from({ length: 6 }, () => ({ ok: false, reason: 'unchanged' })))
        expect(doneLengths).toEqual([5, 5, 5, 5, 5, 5])
        expect(s.live.obj.alternateGreetings).toEqual(['b'])
        expect(deletedIds(s)).toEqual([y])
    })

    test('T88 an other-side stop counts the older list ops it skips and keeps the item listed', () => {
        const s = newSession({ desc: 'd', alternateGreetings: ['a', 'b'], chats: { chatA: { fmIndex: 0 } } })
        s.typeDesc('E', 0)
        const y = s.deleteGreeting(0, 2000)
        s.typeDesc('A', 4000)
        const anchor = s.record.done[s.record.done.length - 1].id
        s.restoreDeleted(y, 6000)
        s.revertTo(anchor, 8000)
        s.live.obj.alternateGreetings.unshift('a')
        const plan = s.revertTo(anchor, 10000)
        expect(plan.ok).toBe(true)
        expect(plan.ok && plan.deletedRemove).toEqual([])
        expect(plan.ok && plan.listSkipped).toBe(1)
        expect(deletedIds(s)).toEqual([y])
        expect(s.undo(12000).ok).toBe(true)
        expect(s.live.obj.alternateGreetings).toEqual(['a', 'b'])
        expect(deletedIds(s)).toEqual([y])
    })

    test('T88b a plain revert across deletes reports no skipped list op', () => {
        const s = newSession({ desc: 'd', alternateGreetings: ['a', 'b', 'c'], chats: { chatA: { fmIndex: 0 } } })
        s.typeDesc('E', 0)
        const anchor = s.record.done[s.record.done.length - 1].id
        s.deleteGreeting(0, 2000)
        s.deleteGreeting(0, 4000)
        const plan = s.revertTo(anchor, 6000)
        expect(plan.ok && plan.skipped).toBe(0)
        expect(plan.ok && 'listSkipped' in plan).toBe(false)
        expect(s.live.obj.alternateGreetings).toEqual(['a', 'b', 'c'])
        expect(s.live.obj.chats.chatA.fmIndex).toBe(0)
    })
})

describe('S2b: an expected-side delete whose Deleted entry left the list is restored', () => {
    const sixty = Array.from({ length: 60 }, (_, i) => `g${i}`)

    test('T90 a revert across 51 deletes of one slot restores the oldest first message and its chat index', () => {
        const s = newSession({ desc: 'd', alternateGreetings: [...sixty], chats: { chatA: { fmIndex: 1 } } })
        s.typeDesc('E', 0)
        const anchor = s.record.done[0].id
        const first = s.deleteGreeting(1, 2000)
        for (let k = 0; k < MAX_DELETED; k++) {
            s.deleteGreeting(1, 4000 + k * 2000)
        }
        expect(s.record.deleted.some((item) => item.id === first)).toBe(false)
        const pre = stateOf(s)
        const plan = s.revertTo(anchor, 200000)
        expect(s.live.obj.alternateGreetings).toEqual(sixty)
        expect(s.live.obj.chats.chatA.fmIndex).toBe(1)
        expect(plan.ok && plan.skipped).toBe(0)
        expect(plan.ok && plan.listSkipped).toBeUndefined()
        expect(s.record.deleted).toEqual([])
        const post = stateOf(s)
        expect(s.undo(300000).ok).toBe(true)
        expect(stateOf(s)).toBe(pre)
        expect(s.redo(400000).ok).toBe(true)
        expect(stateOf(s)).toBe(post)
    })

    test('T90b deleting the last first message 51 times and reverting brings all 51 back', () => {
        const items = Array.from({ length: 51 }, (_, i) => `i${i}`)
        const s = newSession({ desc: 'd', alternateGreetings: [...items], chats: { chatA: { fmIndex: 0 }, chatB: { fmIndex: 1 } } })
        s.typeDesc('E', 0)
        const anchor = s.record.done[0].id
        for (let k = 0; k < 51; k++) {
            s.deleteGreeting(s.live.obj.alternateGreetings.length - 1, 2000 + k * 2000)
        }
        const plan = s.revertTo(anchor, 200000)
        expect(s.live.obj.alternateGreetings).toEqual(items)
        expect(plan.ok && plan.skipped).toBe(0)
        expect(plan.ok && plan.listSkipped).toBeUndefined()
        expect(s.live.obj.chats.chatA.fmIndex).toBe(0)
    })

    test('T91 a later revert across a revert step whose produced item aged out reaches its target without a notice', () => {
        const s = newSession({ desc: 'd', alternateGreetings: [...sixty], chats: { chatA: { fmIndex: 2 }, chatB: { fmIndex: 0 } } })
        s.typeDesc('E0', 0)
        const y = s.deleteGreeting(2, 2000, 'chatA')
        s.typeDesc('A', 4000)
        const anchorA = s.record.done[s.record.done.length - 1].id
        expect(s.restoreDeleted(y, 6000).ok).toBe(true)
        const listAtRestore = [...s.live.obj.alternateGreetings]
        const anchorRd = s.record.done[s.record.done.length - 1].id
        expect(s.revertTo(anchorA, 8000).ok).toBe(true)
        expect(s.record.deleted.some((item) => item.id === y)).toBe(true)
        for (let k = 0; k < MAX_DELETED; k++) {
            s.deleteGreeting(s.live.obj.alternateGreetings.length - 1, 10000 + k * 2000, 'chatB')
        }
        expect(s.record.deleted.some((item) => item.id === y)).toBe(false)
        const plan = s.revertTo(anchorRd, 900000)
        expect(plan.ok && plan.listSkipped).toBeUndefined()
        expect(plan.ok && plan.skipped).toBe(0)
        expect(s.live.obj.alternateGreetings).toEqual(listAtRestore)
        expect(s.live.obj.chats.chatA.fmIndex).toBe(2)
    })

    function fiftyOneDeletes() {
        const s = newSession({ desc: 'd', alternateGreetings: [...sixty], chats: { chatA: { fmIndex: 1 } } })
        const first = s.deleteGreeting(1, 2000)
        for (let k = 0; k < MAX_DELETED; k++) {
            s.deleteGreeting(1, 4000 + k * 2000)
        }
        for (let k = 0; k < MAX_DELETED; k++) {
            expect(s.undo(200000 + k).ok).toBe(true)
        }
        return { s, first }
    }

    test('T92 undo of the 51st delete after its entry aged out restores the first message and its chat index', () => {
        const { s, first } = fiftyOneDeletes()
        expect(s.record.deleted).toEqual([])
        const u = s.undo(300000)
        expect(s.live.obj.alternateGreetings).toEqual(sixty)
        expect(s.live.obj.chats.chatA.fmIndex).toBe(1)
        expect(u.ok && u.skipped).toBe(0)
        expect(s.record.deleted).toEqual([])
        // A redo deletes again, and a delete lists its item.
        expect(s.redo(400000).ok).toBe(true)
        expect(s.live.obj.alternateGreetings).toEqual(sixty.filter((_, i) => i !== 1))
        expect(s.live.obj.chats.chatA.fmIndex).toBe(-1)
        expect(deletedIds(s)).toEqual([first])
    })

    test('T92n on a step without a fingerprint the aged-out undo keeps the per-op route', () => {
        const { s } = fiftyOneDeletes()
        s.state = { record: { ...s.record, done: s.record.done.map(asPreChange) }, open: null }
        const u = s.undo(300000)
        expect(u.ok && u.skipped).toBe(1)
        expect(s.live.obj.alternateGreetings).toHaveLength(59)
    })

    test('T93 an old-record delete whose item was taken elsewhere is not inserted twice', () => {
        const s = newSession({ desc: 'd', alternateGreetings: ['a', 'Y', 'b'], chats: { chatA: { fmIndex: 0 } } })
        s.typeDesc('e', 0)
        const anchor = s.record.done[0].id
        const id = s.deleteGreeting(1, 5000)
        expect(s.restoreDeleted(id, 10000).ok).toBe(true)
        s.live.obj.alternateGreetings.unshift('q')
        s.state = { record: { ...s.record, done: s.record.done.map(asPreChange) }, open: null }
        const result = s.revertTo(anchor, 15000)
        expect(s.live.obj.alternateGreetings.filter((v) => v === 'Y')).toHaveLength(1)
        expect(result).toEqual({ ok: false, reason: 'unchanged', listSkipped: 1 })
        expect(s.live.obj.desc).toBe('e')
    })

    test('T87f a revert that nets out to nothing still reports the chat index it could not restore, and lands nothing', () => {
        const s = newSession({ desc: 'd', alternateGreetings: ['g0', 'g1', 'g2'], pageChat: { fmIndex: 1 } })
        s.typeDesc('a', 0)
        const anchor = s.record.done[0].id
        const id = s.deleteGreeting(1, 5000, null)
        expect(s.restoreDeleted(id, 10000).ok).toBe(true)
        const record = s.record
        expect(s.revertTo(anchor, 15000)).toEqual({ ok: false, reason: 'unchanged', fmNotRestored: true })
        expect(s.record).toBe(record)
        expect(s.live.obj.alternateGreetings).toEqual(['g0', 'g1', 'g2'])
        expect(s.live.obj.pageChat.fmIndex).toBe(-1)
    })

    test('T87u a revert whose applied ops cancel out but which skipped a list change is unchanged with listSkipped', () => {
        const s = newSession({ desc: 'd', alternateGreetings: ['g0', 'g1', 'g2'], chats: { chatA: { fmIndex: 0 } } })
        s.typeDesc('a', 0)
        const anchor = s.record.done[0].id
        s.typeDesc('b', 5000)
        s.deleteGreeting(2, 10000)
        s.typeDesc('a', 15000)
        s.live.obj.alternateGreetings.push('z')
        const record = s.record
        expect(s.revertTo(anchor, 20000)).toEqual({ ok: false, reason: 'unchanged', listSkipped: 1 })
        expect(s.record).toBe(record)
        expect(s.live.obj.alternateGreetings).toEqual(['g0', 'g1', 'z'])
        expect(s.live.obj.desc).toBe('a')
        expect(s.live.obj.chats.chatA.fmIndex).toBe(-1)
    })
})

describe('S2b: undo and redo of a fingerprinted step off its expected side are refused whole', () => {
    test('T94 an undo of a delete after an outside list change is refused and the step stays', () => {
        const s = newSession({ alternateGreetings: ['a', 'b', 'c'], chats: { chatA: { fmIndex: 2 } } })
        s.deleteGreeting(2, 0)
        s.live.obj.alternateGreetings.push('z')
        const record = s.record
        expect(s.undo(5000)).toEqual({ ok: false, reason: 'precondition' })
        expect(s.live.obj.chats.chatA.fmIndex).toBe(-1)
        expect(s.record).toBe(record)
        expect(s.live.obj.alternateGreetings).toEqual(['a', 'b', 'z'])
    })

    test('T94b a redo of a delete after an outside list change is refused and the step stays', () => {
        const s = newSession({ alternateGreetings: ['a', 'b', 'c'], chats: { chatA: { fmIndex: 2 } } })
        s.deleteGreeting(2, 0)
        expect(s.undo(5000).ok).toBe(true)
        s.live.obj.alternateGreetings.push('z')
        const record = s.record
        expect(s.redo(10000)).toEqual({ ok: false, reason: 'precondition' })
        expect(s.live.obj.chats.chatA.fmIndex).toBe(2)
        expect(s.record).toBe(record)
    })

    test('T94c with the list on the other side the undo is refused and the chat index stays', () => {
        const s = newSession({ alternateGreetings: ['a', 'b', 'c'], chats: { chatA: { fmIndex: 2 } } })
        s.deleteGreeting(2, 0)
        s.live.obj.alternateGreetings.push('c')
        const record = s.record
        expect(s.undo(5000)).toEqual({ ok: false, reason: 'precondition' })
        expect(s.record).toBe(record)
        expect(s.live.obj.alternateGreetings).toEqual(['a', 'b', 'c'])
        expect(s.live.obj.chats.chatA.fmIndex).toBe(-1)
    })

    test('T96 the undo of a revert step on neither keeps its description part too', () => {
        const s = newSession({ desc: 'd', alternateGreetings: ['a', 'b'], chats: { chatA: { fmIndex: 1 } } })
        s.typeDesc('E', 0)
        const anchor = s.record.done[0].id
        s.typeDesc('F', 2000)
        s.deleteGreeting(1, 4000)
        expect(s.revertTo(anchor, 6000).ok).toBe(true)
        expect(s.live.obj.desc).toBe('E')
        s.live.obj.alternateGreetings.push('z')
        const record = s.record
        expect(s.undo(8000)).toEqual({ ok: false, reason: 'precondition' })
        expect(s.live.obj.desc).toBe('E')
        expect(s.record).toBe(record)
        expect(s.live.obj.chats.chatA.fmIndex).toBe(1)
    })

    test('T98b undo cannot move a revert step on the other side, so no older delete is undone past it', () => {
        const s = newSession({ desc: 'd', alternateGreetings: ['X'], chats: { chatA: { fmIndex: 0 }, chatB: { fmIndex: 1 } } })
        s.typeDesc('E', 0)
        const dOld = s.deleteGreeting(0, 2000, 'chatA')
        const t1 = s.record.done[s.record.done.length - 1].id
        s.restoreDeleted(dOld, 4000)
        s.deleteGreeting(0, 6000, 'chatB')
        s.typeDesc('F', 8000)
        s.addGreeting('K', 10000)
        expect(s.revertTo(t1, 12000).ok).toBe(true)
        s.live.obj.alternateGreetings.push('K')
        const record = s.record
        const results: PlanResult[] = []
        for (let i = 0; i < 4; i++) {
            results.push(s.undo(14000 + i))
        }
        expect(liveListedIds(s)).toEqual([])
        expect(results).toEqual(Array.from({ length: 4 }, () => ({ ok: false, reason: 'precondition' })))
        expect(s.record).toBe(record)
        expect(s.live.obj.desc).toBe('E')
        expect(s.live.obj.alternateGreetings).toEqual(['K'])
    })
})

describe('S2b: a revert stops at the first fingerprinted step off its expected side', () => {
    test('T97 an older delete is not put back while a newer Deleted entry of the same first message stays', () => {
        const s = newSession({ desc: 'd', alternateGreetings: ['A'], chats: { chatA: { fmIndex: 0 } } })
        s.typeDesc('E', 0)
        const anchor = s.record.done[0].id
        const d1 = s.deleteGreeting(0, 2000)
        s.restoreDeleted(d1, 4000)
        s.addGreeting('B', 6000)
        const d3 = s.deleteGreeting(0, 8000)
        s.live.obj.alternateGreetings.splice(0)
        const record = s.record
        const plan = s.revertTo(anchor, 10000)
        expect(s.live.obj.alternateGreetings).toEqual([])
        expect(plan).toEqual({ ok: false, reason: 'precondition' })
        expect(s.record).toBe(record)
        expect(deletedIds(s)).toEqual([d3])
        expect(s.restoreDeleted(d3, 12000).ok).toBe(true)
        expect(s.live.obj.alternateGreetings).toEqual(['A'])
    })

    test('T97b an older Restore deleted is not reverted while a newer entry of the same first message stays', () => {
        const s = newSession({ desc: 'd', alternateGreetings: ['X'], chats: { chatA: { fmIndex: 0 } } })
        s.typeDesc('E', 0)
        const anchor = s.record.done[0].id
        const d1 = s.deleteGreeting(0, 2000)
        const t1 = s.record.done[s.record.done.length - 1].id
        s.restoreDeleted(d1, 4000)
        s.deleteGreeting(0, 6000)
        expect(s.revertTo(t1, 8000).ok).toBe(true)
        s.restoreDeleted(d1, 10000)
        s.addGreeting('B', 12000)
        const d3 = s.deleteGreeting(0, 14000)
        s.live.obj.alternateGreetings.splice(0)
        const record = s.record
        const plan = s.revertTo(anchor, 16000)
        expect(liveListedIds(s)).toEqual([])
        expect(plan).toEqual({ ok: false, reason: 'precondition' })
        expect(s.record).toBe(record)
        expect(deletedIds(s)).toEqual([d3])
    })

    test('T98a a revert step on the other side stops the walk: the older delete is not put back next to its entry', () => {
        const s = newSession({ desc: 'd', alternateGreetings: ['X'], chats: { chatA: { fmIndex: 0 }, chatB: { fmIndex: 1 } } })
        s.typeDesc('E', 0)
        const anchor = s.record.done[0].id
        const dOld = s.deleteGreeting(0, 2000, 'chatA')
        const t1 = s.record.done[s.record.done.length - 1].id
        s.restoreDeleted(dOld, 4000)
        s.deleteGreeting(0, 6000, 'chatB')
        s.addGreeting('K', 8000)
        expect(s.revertTo(t1, 10000).ok).toBe(true)
        s.live.obj.alternateGreetings.push('K')
        const plan = s.revertTo(anchor, 12000)
        expect(liveListedIds(s)).toEqual([])
        expect(s.live.obj.alternateGreetings).toEqual(['K'])
        expect(deletedIds(s)).toEqual([dOld])
        expect(plan.ok && plan.listSkipped).toBeGreaterThan(0)
    })

    test('T98c a clean revert across deletes, Restore deleted and edits never stops', () => {
        const s = newSession({ desc: 'd', alternateGreetings: ['a', 'b', 'c'], chats: { chatA: { fmIndex: 0 } } })
        s.typeDesc('E', 0)
        const anchor = s.record.done[0].id
        const d = s.deleteGreeting(0, 2000)
        s.editGreeting(0, 'b2', 4000)
        s.restoreDeleted(d, 6000)
        s.addGreeting('n', 8000)
        s.deleteGreeting(1, 10000)
        const plan = s.revertTo(anchor, 12000)
        expect(plan.ok && plan.skipped).toBe(0)
        expect(plan.ok && 'listSkipped' in plan).toBe(false)
        expect(s.live.obj.alternateGreetings).toEqual(['a', 'b', 'c'])
        expect(s.live.obj.chats.chatA.fmIndex).toBe(0)
    })
})

// ---------------------------------------------------------------- S2b: generated zero counters

describe('S2b generated: without outside edits nothing is skipped (T95)', () => {
    test('T95 delete-heavy histories: every revert, undo and redo applies whole and every revert reaches its target', () => {
        const counts: Record<string, number> = {}
        const bump = (k: string) => (counts[k] = (counts[k] ?? 0) + 1)
        for (let seed = 1; seed <= 6; seed++) {
            let x = (seed * 2654435761) >>> 0
            const rnd = () => (x = (x * 1103515245 + 12345) >>> 0) / 4294967296
            const pick = <T,>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)]
            const s = newSession({ desc: 'd', alternateGreetings: Array.from({ length: 400 }, (_, i) => `i${i}`), chats: { chatA: { fmIndex: 3 }, chatB: { fmIndex: 0 } } })
            const snap = new Map<string, string>()
            const core = () => JSON.stringify([s.live.obj.alternateGreetings, s.live.obj.desc ?? null, s.live.obj.chats.chatA.fmIndex ?? null, s.live.obj.chats.chatB.fmIndex ?? null])
            let fresh = 0
            for (let i = 0; i < 400; i++) {
                const len = s.live.obj.alternateGreetings.length
                const r = rnd()
                const at = i * 3000
                if (r < 0.7 && len > 0) {
                    s.deleteGreeting(Math.floor(rnd() * len), at, pick(['chatA', 'chatB']))
                } else if (r < 0.74) {
                    s.addGreeting(pick(['', 'a', `n${seed}_${fresh++}`]), at)
                } else if (r < 0.76 && len > 0) {
                    const idx = Math.floor(rnd() * len)
                    const v = pick(['', 'a', `e${seed}_${fresh++}`])
                    if (v !== s.live.obj.alternateGreetings[idx]) s.editGreeting(idx, v, at)
                } else if (r < 0.78) {
                    s.typeDesc('d' + i, at)
                } else if (r < 0.83) {
                    const plan = s.undo(at)
                    if (plan.ok) {
                        bump('undo')
                        if (plan.skipped > 0) bump('ZERO undo skipped')
                    }
                } else if (r < 0.85) {
                    const plan = s.redo(at)
                    if (plan.ok) {
                        bump('redo')
                        if (plan.skipped > 0) bump('ZERO redo skipped')
                    }
                } else if (r < 0.86 && s.record.deleted.length > 0) {
                    s.restoreDeleted(pick(s.record.deleted).id, at)
                } else if (r < 0.97 && s.record.done.length > 1) {
                    const target = s.record.done[Math.floor(rnd() * (s.record.done.length - 1))].id
                    const fullBefore = stateOf(s)
                    const plan = s.revertTo(target, at)
                    if (plan.ok === false && plan.reason === 'unchanged') bump('unchanged')
                    if (plan.ok) {
                        bump('applied')
                        if (plan.skipped > 0) bump('ZERO revert skipped')
                        if (plan.listSkipped !== undefined) bump('ZERO revert listSkipped')
                        const want = snap.get(target)
                        if (want !== undefined && core() !== want) bump('ZERO target not reached')
                        const fullAfter = stateOf(s)
                        const u = s.undo(at + 1)
                        if (!u.ok || stateOf(s) !== fullBefore) bump('ZERO undo of revert inexact')
                        const rr = s.redo(at + 2)
                        if (!rr.ok || stateOf(s) !== fullAfter) bump('ZERO redo of revert inexact')
                    }
                } else {
                    continue
                }
                const top = s.record.done.at(-1)
                if (top) snap.set(top.id, core())
            }
        }
        expect(Object.keys(counts).filter((k) => k.startsWith('ZERO'))).toEqual([])
        expect(counts.applied ?? 0).toBeGreaterThan(50)
    })

    function mulberry32(seed: number) {
        let a = seed >>> 0
        return () => {
            a = (a + 0x6d2b79f5) >>> 0
            let t = a
            t = Math.imul(t ^ (t >>> 15), t | 1)
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296
        }
    }

    // A value is dirty when it is live and listed, listed twice, or live twice.
    function dirtyValues(s: Session): Map<string, string> {
        const liveCount = new Map<string, number>()
        for (const v of s.live.obj.alternateGreetings) liveCount.set(v, (liveCount.get(v) ?? 0) + 1)
        const listedCount = new Map<string, number>()
        for (const d of s.record.deleted) listedCount.set(d.value, (listedCount.get(d.value) ?? 0) + 1)
        const out = new Map<string, string>()
        for (const [v, n] of liveCount) {
            if (listedCount.has(v)) out.set(v, 'liveListed')
            else if (n >= 2) out.set(v, 'liveTwice')
        }
        for (const [v, n] of listedCount) if (n >= 2 && !out.has(v)) out.set(v, 'listedTwice')
        return out
    }

    // The deleted-id effect of one step: a delete adds its id, a tagged insert or a Restore deleted removes it.
    function foldStep(set: Set<string>, step: Step) {
        for (const op of step.ops) {
            if (op.op === 'listRemove' && op.deletedId !== null) {
                set.add(op.deletedId)
            } else if (op.op === 'listInsert') {
                const id = step.label.kind === 'restoreDeleted' ? step.label.deletedId : (op.deletedId ?? null)
                if (id !== null) set.delete(id)
            }
        }
    }

    // Every value in these workloads is fresh. The counters therefore pin the walks that decide by hash
    // and the budget-suspended walks of fresh values; a suspended walk that applies steps without a
    // fingerprint per op against repeated text is the accepted soft area of a suspension.
    interface Workload {
        name: string
        outside: number
        del: number
    }

    const WORKLOADS: Workload[] = [
        { name: 'freshOutside', outside: 0.08, del: 0.25 },
        { name: 'freshDeleteOutside', outside: 0.08, del: 0.45 },
    ]

    function generatedRun(seed: number, wl: Workload, budget: number | undefined, actions: number) {
        const rnd = mulberry32(seed * 7919 + wl.name.length * 131 + (budget ?? 7) * 17)
        let fresh = 0
        const nv = () => 'v' + fresh++
        const n0 = 30 + Math.floor(rnd() * 30)
        const s = newSession({ desc: 'd0', alternateGreetings: Array.from({ length: n0 }, nv), chats: { chatA: { fmIndex: 0 }, chatB: { fmIndex: 1 } } })
        const c = { root: 0, orphan: 0, missing: 0, alsoLive: 0, dupIds: 0, l6: 0, l6Checks: 0, samples: [] as string[] }
        let at = 0
        s.typeDesc('E', at)
        const base = new Set<string>()
        const aged = new Set<string>()
        let prevDone: Step[] = [...s.record.done]
        let prevDeleted = new Set(deletedIds(s))
        let prevOrphan = new Set<string>()
        let prevMissing = new Set<string>()
        for (let a = 0; a < actions; a++) {
            at += 2000
            const list = s.live.obj.alternateGreetings
            const dirtyBefore = dirtyValues(s)
            const liveListedBefore = new Set(liveListedIds(s))
            let kind = 'user'
            let history = false
            const r = rnd()
            if (r < wl.outside) {
                kind = 'outside'
                const sub = rnd()
                if (sub < 0.35) list.push(nv())
                else if (sub < 0.6) {
                    if (list.length > 0) list.splice(Math.floor(rnd() * list.length), 1)
                } else if (sub < 0.85) {
                    if (list.length > 0) list[Math.floor(rnd() * list.length)] = nv()
                } else s.live.obj.chats[rnd() < 0.5 ? 'chatA' : 'chatB'].fmIndex = Math.floor(rnd() * (list.length + 1)) - 1
            } else {
                const q = rnd()
                const del = list.length > 120 ? 0.9 : wl.del
                const rest = (1 - del) / 0.75
                if (q < del) {
                    if (list.length > 0) {
                        const chat = rnd() < 0.5 ? 'chatA' : rnd() < 0.6 ? 'chatB' : null
                        s.deleteGreeting(Math.floor(rnd() * list.length), at, chat)
                    }
                } else if (q < del + 0.08 * rest) {
                    s.addGreeting(nv(), at)
                } else if (q < del + 0.16 * rest) {
                    if (list.length > 0) s.editGreeting(Math.floor(rnd() * list.length), nv(), at)
                } else if (q < del + 0.22 * rest) {
                    s.typeDesc('d' + a, at)
                } else if (q < del + 0.37 * rest) {
                    kind = 'undo'
                    history = true
                    s.undo(at)
                } else if (q < del + 0.44 * rest) {
                    kind = 'redo'
                    history = true
                    s.redo(at)
                } else if (q < del + 0.5 * rest) {
                    kind = 'restoreDeleted'
                    history = true
                    const d = s.record.deleted
                    if (d.length > 0) s.restoreDeleted(d[Math.floor(rnd() * d.length)].id, at)
                } else {
                    kind = 'revert'
                    history = true
                    const done = s.record.done
                    if (done.length > 1) {
                        const index = rnd() < 0.6 ? Math.max(0, done.length - 2 - Math.floor(rnd() * 10)) : Math.floor(rnd() * (done.length - 1))
                        const listBefore = [...s.live.obj.alternateGreetings]
                        const plan = s.revertTo(done[index].id, at, budget)
                        if (plan.ok) {
                            c.l6Checks += 1
                            if (!listOpsExact(listBefore, s.record.done[s.record.done.length - 1].ops, s.live.obj.alternateGreetings)) c.l6 += 1
                        }
                    }
                }
            }
            if (history) {
                for (const [v, cls] of dirtyValues(s)) {
                    if (!dirtyBefore.has(v)) {
                        c.root += 1
                        if (c.samples.length < 3) c.samples.push(`seed ${seed} action ${a} ${kind} ${v} ${cls}`)
                    }
                }
                for (const id of liveListedIds(s)) if (!liveListedBefore.has(id)) c.alsoLive += 1
            }
            // The Deleted ids equal the fold of the steps in done, on top of the steps that left done.
            const nowDone = new Set(s.record.done.map((x) => x.id))
            const nowUndone = new Set(s.record.undone.map((x) => x.id))
            const prevTop = prevDone[prevDone.length - 1]
            for (const step of prevDone) {
                if (!nowDone.has(step.id) && !(step === prevTop && nowUndone.has(step.id))) foldStep(base, step)
            }
            const fold = new Set(base)
            for (const step of s.record.done) foldStep(fold, step)
            const nowDeleted = new Set(deletedIds(s))
            for (const id of prevDeleted) if (!nowDeleted.has(id) && fold.has(id) && s.record.deleted.length === MAX_DELETED) aged.add(id)
            const orphan = new Set([...nowDeleted].filter((id) => !fold.has(id)))
            const missing = new Set([...fold].filter((id) => !nowDeleted.has(id) && !aged.has(id)))
            const newOrphan = [...orphan].filter((id) => !prevOrphan.has(id)).length
            const newMissing = [...missing].filter((id) => !prevMissing.has(id)).length
            c.orphan += newOrphan
            c.missing += newMissing
            if ((newOrphan > 0 || newMissing > 0) && c.samples.length < 3) c.samples.push(`seed ${seed} action ${a} ${kind} fold orphan ${newOrphan} missing ${newMissing}`)
            if (nowDeleted.size !== s.record.deleted.length) c.dupIds += 1
            prevDone = [...s.record.done]
            prevDeleted = nowDeleted
            prevOrphan = orphan
            prevMissing = missing
        }
        return c
    }

    test('T99 with outside list edits no History action makes a first message live and listed, listed twice or live twice, and Deleted equals the fold of done', () => {
        const nonZero: string[] = []
        let checks = 0
        for (const wl of WORKLOADS) {
            for (const budget of [undefined, 0, 150_000]) {
                const total = { root: 0, orphan: 0, missing: 0, alsoLive: 0, dupIds: 0, l6: 0 }
                const samples: string[] = []
                for (let seed = 1; seed <= 20; seed++) {
                    const c = generatedRun(seed, wl, budget, 400)
                    checks += c.l6Checks
                    for (const name of ['root', 'orphan', 'missing', 'alsoLive', 'dupIds', 'l6'] as const) total[name] += c[name]
                    samples.push(...c.samples)
                }
                for (const name of ['root', 'orphan', 'missing', 'alsoLive', 'dupIds', 'l6'] as const) {
                    if (total[name] > 0) nonZero.push(`${wl.name}/${budget ?? 'default'} ${name} ${total[name]} ${samples.slice(0, 2).join('; ')}`)
                }
            }
        }
        expect(nonZero).toEqual([])
        expect(checks).toBeGreaterThan(1000)
    }, 600_000)
})
