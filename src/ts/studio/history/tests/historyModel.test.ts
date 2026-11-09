import { afterEach, describe, expect, test, vi } from 'vitest'
import {
    COALESCE_MS,
    MAX_DELETED,
    MAX_DONE,
    applyReplayMove,
    closeOpenStep,
    commitStep,
    createModelState,
    createPageSession,
    deriveRestoreWrites,
    emptyRecord,
    invertOp,
    listChangedElsewhere,
    parseOwnerRecord,
    planReplay,
    planRestoreDeleted,
    planRestorePoint,
    planRevert,
    stepIdFor,
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
            })
        }
        return plan
    }

    revertTo(stepId: string, at: number) {
        return this.commitPlan(planRevert(this.record, stepId, this.live.reader), at)
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
