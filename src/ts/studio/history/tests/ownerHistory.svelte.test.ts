// @vitest-environment jsdom
// The service over the memory doubles: the marked write path of every history action, the field
// setters, greeting add/edit/delete with the fmIndex side effect, undo/redo/revert, the restore
// point and deleted items. Lifecycle and queue tests are in ownerHistory.lifecycle.svelte.test.ts.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DBState, selIdState } from 'src/ts/stores.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { rewritableTextAt, type TargetOwner } from 'src/ts/studio/assets/referenceTargets'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { createOwnerHistoryService, type OwnerHistoryService } from '../ownerHistory.svelte'
import { characterOwnerKey, chatOwnerKey, moduleOwnerKey, SAVE_DEBOUNCE_MS, type OwnerKey } from '../ownerPhase'
import { COALESCE_MS, emptyRecord, type Step } from '../historyModel'
import { listFingerprintOf } from '../listFingerprint'
import { createFakeClock, type FakeClock } from './historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore, seedOwner, storedRecord, type ClaimDouble, type MemoryStudioStore } from './studioStoreDoubles'

const h = vi.hoisted(() => ({ marks: 0 }))
// Pass-through counters of the pure fingerprint module, for the revert cost legs.
const fp = vi.hoisted(() => ({ full: 0, mix: 0 }))

vi.mock('../listFingerprint', async (importOriginal) => {
    const real = await importOriginal<typeof import('../listFingerprint')>()
    return {
        fingerprintElement: real.fingerprintElement,
        mixElementHashes: (hashes: readonly number[]) => {
            fp.mix += 1
            return real.mixElementHashes(hashes)
        },
        listFingerprintOf: (list: readonly unknown[]) => {
            fp.full += 1
            return real.listFingerprintOf(list)
        },
    }
})

vi.mock('src/ts/globalApi.svelte', () => ({ getSaveMarkCount: () => h.marks }))
vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return {
        DBState: { db: { characters: [] } },
        selIdState: { selId: 0 },
        MobileGUI: writable(false),
        settingsOpen: writable(false),
    }
})

interface LiveChat {
    id?: string
    note: string
    fmIndex?: number
}

interface LiveCharacter {
    chaId: string
    type?: string
    license?: string
    coldstorage?: string
    desc: string
    firstMessage?: string
    hideChatIcon?: boolean
    alternateGreetings: string[]
    chats: LiveChat[]
    chatPage: number
}

function makeCharacter(chaId: string, overrides: Partial<LiveCharacter> = {}): LiveCharacter {
    return {
        chaId,
        desc: 'd0',
        alternateGreetings: ['g0', 'g1', 'g2'],
        chats: [{ id: 'c1', note: 'n0', fmIndex: 2 }],
        chatPage: 0,
        ...overrides,
    }
}

function putCharacters(...characters: LiveCharacter[]): void {
    DBState.db.characters = characters as unknown as typeof DBState.db.characters
}

function live(chaId = 'A'): LiveCharacter {
    return (DBState.db.characters as unknown as LiveCharacter[]).find((c) => c.chaId === chaId) as LiveCharacter
}

const A = characterOwnerKey('A')
const chatA = (chatId: string): OwnerKey => chatOwnerKey('A', chatId)

interface Harness {
    clock: FakeClock
    store: MemoryStudioStore
    claim: ClaimDouble
    service: OwnerHistoryService
    tracked: string[]
    noted: { chaId: string; before: number }[]
    visit: { id: string }
    removers: (() => void)[]
}

let harness: Harness

function build(shared?: Map<string, string>): Harness {
    const clock = createFakeClock()
    const store = createMemoryStudioStore({ shared })
    const claim = createClaimDouble()
    const visit = { id: 'v1' }
    const removers: (() => void)[] = []
    const service = createOwnerHistoryService({
        store,
        claim,
        clock,
        pageSession: 'p1',
        getVisitId: () => visit.id,
        registerLeaveFlush: () => {
            const remove = (): void => {}
            removers.push(remove)
            return remove
        },
    })
    const noted: Harness['noted'] = []
    service.setAck('A', { noteEdit: (chaId, before) => noted.push({ chaId, before }) })
    return { clock, store, claim, service, tracked: [], noted, visit, removers }
}

async function ready(owner: OwnerKey = A): Promise<void> {
    await harness.service.whenReady(owner)
}

const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }

beforeEach(() => {
    h.marks = 0
    tracker.character.length = 0
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
    resetStudioScreenForTests()
    putCharacters(makeCharacter('A'), makeCharacter('B'))
    selIdState.selId = 0
    studioScreen.chaId = 'A'
    harness = build()
})

afterEach(() => {
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
})

describe('T-SM1 / T-SM2: every landed write marks, independent of the selection index', () => {
    test('T-SM1: a desc edit marks its character even after the selection moved', async () => {
        await ready()
        selIdState.selId = 1
        // The selected index moved to B: A is no longer the selected character, so the edit is refused...
        expect(harness.service.editField(A, 'desc', 'moved').ok).toBe(false)
        expect(h.marks).toBe(0)
        selIdState.selId = 0
        expect(harness.service.editField(A, 'desc', 'typed')).toEqual({ ok: true })
        // ...and an edit that landed stays marked for A after the selection has moved on.
        selIdState.selId = 1
        expect(live('A').desc).toBe('typed')
        expect(live('B').desc).toBe('d0')
        expect(h.marks).toBe(1)
        expect(tracker.character).toEqual(['A'])
    })

    test('T-SM2: a chat note edit finds the chat by its id after the page changed', async () => {
        putCharacters(makeCharacter('A', { chats: [{ id: 'c1', note: '' }, { id: 'c2', note: '' }] }), makeCharacter('B'))
        await ready(chatA('c1'))
        live().chatPage = 1
        expect(harness.service.editField(chatA('c1'), 'note', 'about c1')).toEqual({ ok: true })
        expect(live().chats[0].note).toBe('about c1')
        expect(live().chats[1].note).toBe('')
        expect(h.marks).toBe(1)
        expect(tracker.character).toEqual(['A'])
    })
})

describe('T-SM3: refusals write nothing, mark nothing and record nothing', () => {
    async function expectRefused(owner: OwnerKey, reason: string, act: () => unknown): Promise<void> {
        await ready(owner)
        const before = JSON.stringify(DBState.db.characters)
        expect(act()).toEqual({ ok: false, reason })
        expect(JSON.stringify(DBState.db.characters)).toBe(before)
        expect(h.marks).toBe(0)
        expect(harness.noted).toEqual([])
        expect(harness.service.view(owner).done).toEqual([])
    }

    test('not-selected', async () => {
        studioScreen.chaId = 'elsewhere'
        await expectRefused(A, 'not-selected', () => harness.service.editField(A, 'desc', 'x'))
    })

    test('a private character and a group are excluded: restricted', async () => {
        putCharacters(makeCharacter('A', { license: 'private' }))
        await expectRefused(A, 'restricted', () => harness.service.editField(A, 'desc', 'x'))
        putCharacters(makeCharacter('A', { type: 'group' }))
        harness = build()
        await expectRefused(A, 'restricted', () => harness.service.greetingAdd(A))
    })

    test('a chat without a unique id: no-unique-chat', async () => {
        putCharacters(makeCharacter('A', { chats: [{ id: 'dup', note: '' }, { id: 'dup', note: '' }] }))
        await expectRefused(chatA('dup'), 'no-unique-chat', () => harness.service.editField(chatA('dup'), 'note', 'x'))
    })

    test('an archived stub: gone', async () => {
        await ready()
        putCharacters(makeCharacter('A', { coldstorage: 'stub' }))
        const before = JSON.stringify(DBState.db.characters)
        expect(harness.service.editField(A, 'desc', 'x')).toEqual({ ok: false, reason: 'gone' })
        expect(JSON.stringify(DBState.db.characters)).toBe(before)
        expect(h.marks).toBe(0)
        expect(harness.noted).toEqual([])
    })

    test('T-SM4: two characters sharing a chaId, the second selected: refused, neither holder changes', async () => {
        putCharacters(makeCharacter('A'), makeCharacter('A', { desc: 'second holder' }))
        selIdState.selId = 1
        await expectRefused(A, 'duplicate-id', () => harness.service.editField(A, 'desc', 'x'))
        expect((DBState.db.characters as unknown as LiveCharacter[]).map((c) => c.desc)).toEqual(['d0', 'second holder'])
    })

    test('a chat owner key without a chat id has no owner at all', () => {
        expect(harness.service.editField(chatA(''), 'note', 'x')).toEqual({ ok: false, reason: 'gone' })
        expect(harness.store.counts.load).toBe(0)
        expect(h.marks).toBe(0)
    })
})

describe('fields and absence', () => {
    test('T-AB1: an absent hideChatIcon set true, undone, is absent again; redo sets it', async () => {
        await ready()
        expect('hideChatIcon' in live()).toBe(false)
        expect(harness.service.editField(A, 'hideChatIcon', true).ok).toBe(true)
        expect(live().hideChatIcon).toBe(true)
        expect(harness.service.undo(A).ok).toBe(true)
        expect('hideChatIcon' in live()).toBe(false)
        expect(harness.service.redo(A).ok).toBe(true)
        expect(live().hideChatIcon).toBe(true)
    })

    test('an unchanged value writes nothing and records nothing', async () => {
        await ready()
        expect(harness.service.editField(A, 'desc', 'd0')).toEqual({ ok: true, unchanged: true })
        expect(h.marks).toBe(0)
        expect(harness.service.view(A).done).toEqual([])
    })

    test('a wrongly typed value is refused as a precondition', async () => {
        await ready()
        expect(harness.service.editField(A, 'desc', true)).toEqual({ ok: false, reason: 'precondition' })
        expect(harness.service.editField(A, 'hideChatIcon', 'yes')).toEqual({ ok: false, reason: 'precondition' })
        expect(h.marks).toBe(0)
    })
})

describe('greetings', () => {
    test('T-LS1: add, edit and delete record ops that undo and redo in order', async () => {
        await ready()
        expect(harness.service.greetingAdd(A).ok).toBe(true)
        expect(live().alternateGreetings).toEqual(['g0', 'g1', 'g2', ''])
        expect(harness.service.greetingEdit(A, 3, 'new').ok).toBe(true)
        expect(harness.service.greetingDelete(A, 0).ok).toBe(true)
        expect(live().alternateGreetings).toEqual(['g1', 'g2', 'new'])
        harness.service.undo(A)
        expect(live().alternateGreetings).toEqual(['g0', 'g1', 'g2', 'new'])
        harness.service.undo(A)
        expect(live().alternateGreetings).toEqual(['g0', 'g1', 'g2', ''])
        harness.service.undo(A)
        expect(live().alternateGreetings).toEqual(['g0', 'g1', 'g2'])
        harness.service.redo(A)
        harness.service.redo(A)
        harness.service.redo(A)
        expect(live().alternateGreetings).toEqual(['g1', 'g2', 'new'])
    })

    test('T-LS1: a listSet undo never writes over an element that changed elsewhere', async () => {
        await ready()
        harness.service.greetingEdit(A, 1, 'mine')
        live().alternateGreetings[1] = 'classic editor'
        const result = harness.service.undo(A)
        expect(result).toEqual({ ok: false, reason: 'precondition' })
        expect(live().alternateGreetings[1]).toBe('classic editor')
        expect(harness.service.view(A).done).toHaveLength(1)
        expect(harness.service.view(A).undone).toHaveLength(0)
    })

    test('an out-of-range index is a precondition refusal', async () => {
        await ready()
        expect(harness.service.greetingEdit(A, 9, 'x')).toEqual({ ok: false, reason: 'precondition' })
        expect(harness.service.greetingDelete(A, 9)).toEqual({ ok: false, reason: 'precondition' })
        expect(h.marks).toBe(0)
    })

    test('T-LS2: a delete before the shown entry re-indexes the context chat and an undo restores it', async () => {
        await ready()
        expect(harness.service.greetingDelete(A, 1).ok).toBe(true)
        expect(live().chats[0].fmIndex).toBe(1)
        expect(h.marks).toBe(1)
        harness.service.undo(A)
        expect(live().alternateGreetings).toEqual(['g0', 'g1', 'g2'])
        expect(live().chats[0].fmIndex).toBe(2)
    })

    test('T-LS2: an absent fmIndex gets no op and stays absent through the delete and the undo', async () => {
        putCharacters(makeCharacter('A', { chats: [{ id: 'c1', note: '' }] }))
        await ready()
        harness.service.greetingDelete(A, 0)
        expect('fmIndex' in live().chats[0]).toBe(false)
        harness.service.undo(A)
        expect('fmIndex' in live().chats[0]).toBe(false)
    })

    test('T-LS3: a context chat without an id still gets fmIndex -1; the undo cannot restore it', async () => {
        putCharacters(makeCharacter('A', { chats: [{ note: '', fmIndex: 1 }] }))
        await ready()
        expect(harness.service.greetingDelete(A, 1).ok).toBe(true)
        expect(live().alternateGreetings).toEqual(['g0', 'g2'])
        expect(live().chats[0].fmIndex).toBe(-1)
        const undone = harness.service.undo(A)
        expect(undone).toEqual({ ok: true, fmNotRestored: true })
        expect(live().alternateGreetings).toEqual(['g0', 'g1', 'g2'])
        expect(live().chats[0].fmIndex).toBe(-1)
    })
})

describe('T-P1 / T-P2: replays respect what changed elsewhere', () => {
    test('T-P1: an undo skips an op whose live value moved on and keeps that value; the redo agrees', async () => {
        await ready()
        harness.service.greetingDelete(A, 1)
        live().chats[0].fmIndex = 5
        const undone = harness.service.undo(A)
        expect(undone).toEqual({ ok: true, skipped: 1 })
        expect(live().alternateGreetings).toEqual(['g0', 'g1', 'g2'])
        expect(live().chats[0].fmIndex).toBe(5)
        const redone = harness.service.redo(A)
        expect(redone.ok).toBe(true)
        expect(live().alternateGreetings).toEqual(['g0', 'g2'])
        expect(live().chats[0].fmIndex).toBe(5)
    })

    test('T-P1: a desc changed by the classic path makes the undo a refusal with the value kept', async () => {
        await ready()
        harness.service.editField(A, 'desc', 'studio')
        live().desc = 'classic'
        expect(harness.service.undo(A)).toEqual({ ok: false, reason: 'precondition' })
        expect(live().desc).toBe('classic')
    })

    test('T-P1b: a greeting list changed by the classic path refuses the undo and names the list as changed elsewhere', async () => {
        putCharacters(makeCharacter('A', { alternateGreetings: ['g0', 'g1', 'g2'], chats: [{ id: 'c1', note: '', fmIndex: 0 }] }))
        await ready()
        harness.service.greetingDelete(A, 2)
        live().alternateGreetings.unshift('p')
        expect(harness.service.undo(A)).toEqual({ ok: false, reason: 'precondition', listReason: 'neither' })
    })

    test('T-P2: an archived or removed target refuses the replay and leaves both stacks alone', async () => {
        await ready()
        harness.service.editField(A, 'desc', 'one')
        harness.service.undo(A)
        harness.service.editField(A, 'desc', 'two')
        const done = harness.service.view(A).done.length
        const marks = h.marks
        putCharacters(makeCharacter('A', { coldstorage: 'stub' }), makeCharacter('B'))
        expect(harness.service.undo(A)).toEqual({ ok: false, reason: 'gone' })
        putCharacters(makeCharacter('B'))
        expect(harness.service.undo(A).ok).toBe(false)
        expect(harness.service.view(A).done).toHaveLength(done)
        expect(h.marks).toBe(marks)
    })
})

describe('T-K1 / T-K2: history is per owner, built from ids', () => {
    test('T-K1: an undo on the chat owner leaves the character owner alone', async () => {
        await ready()
        await ready(chatA('c1'))
        harness.service.editField(A, 'desc', 'char edit')
        harness.service.editField(chatA('c1'), 'note', 'chat edit')
        harness.service.undo(chatA('c1'))
        expect(live().chats[0].note).toBe('n0')
        expect(live().desc).toBe('char edit')
        expect(harness.service.view(A).done).toHaveLength(1)
        expect(harness.service.view(A).undone).toHaveLength(0)
        expect(harness.service.view(chatA('c1')).done).toHaveLength(0)
        expect(harness.service.view(chatA('c1')).undone).toHaveLength(1)
    })

    test('T-K2: a chat keeps its history when the chats swap places', async () => {
        putCharacters(makeCharacter('A', { chats: [{ id: 'c1', note: 'one' }, { id: 'c2', note: 'two' }] }))
        await ready(chatA('c1'))
        harness.service.editField(chatA('c1'), 'note', 'one edited')
        const chats = live().chats
        chats.reverse()
        live().chatPage = 1
        expect(harness.service.undo(chatA('c1')).ok).toBe(true)
        expect(chats.find((chat) => chat.id === 'c1')?.note).toBe('one')
        expect(chats.find((chat) => chat.id === 'c2')?.note).toBe('two')
    })
})

describe('coalescing runs on the injected clock', () => {
    test('writes less than COALESCE_MS apart are one step; a longer gap or another path starts a new one', async () => {
        await ready()
        harness.service.editField(A, 'desc', 'a')
        harness.clock.set(300)
        harness.service.editField(A, 'desc', 'ab')
        harness.clock.set(600)
        harness.service.editField(A, 'desc', 'abc')
        expect(harness.service.view(A).done).toHaveLength(1)
        harness.clock.set(600 + COALESCE_MS + 200)
        harness.service.editField(A, 'desc', 'abcd')
        expect(harness.service.view(A).done).toHaveLength(2)
        harness.service.editField(A, 'hideChatIcon', true)
        expect(harness.service.view(A).done).toHaveLength(3)
        harness.service.undo(A)
        harness.service.undo(A)
        expect(live().desc).toBe('abc')
    })

    test('closeOpenStep (a blur) makes the next write a new step', async () => {
        await ready()
        harness.service.editField(A, 'desc', 'a')
        harness.service.closeOpenStep(A)
        harness.service.editField(A, 'desc', 'ab')
        expect(harness.service.view(A).done).toHaveLength(2)
    })
})

describe('restore point', () => {
    test('T-RP1: the first edit of a visit records the true before; later edits only move last', async () => {
        await ready()
        harness.service.editField(A, 'desc', 'one')
        harness.clock.set(5000)
        harness.service.editField(A, 'desc', 'two')
        const restore = harness.service.view(A).restore
        expect(restore?.visitId).toBe('v1')
        expect(restore?.fields.desc).toEqual({
            before: { had: true, value: 'd0' },
            last: { had: true, value: 'two' },
        })
    })

    test('T-RP2: the first edit of a new visit replaces it, and a reload still shows the old one until then', async () => {
        await ready()
        harness.service.editField(A, 'desc', 'visit one')
        await harness.clock.advance(SAVE_DEBOUNCE_MS)
        // A reload: a new service over the same store, a new page session.
        studioScreen.chaId = 'A'
        const reloaded = build(harness.store.shared)
        await reloaded.service.whenReady(A)
        expect(reloaded.service.view(A).restore?.visitId).toBe('v1')
        reloaded.visit.id = 'v2'
        reloaded.service.editField(A, 'desc', 'visit two')
        expect(reloaded.service.view(A).restore?.visitId).toBe('v2')
        expect(reloaded.service.view(A).restore?.fields.desc?.before).toEqual({ had: true, value: 'visit one' })
    })

    test('T-RP3: a field changed outside the history is kept or restored by the switch, as one undoable step', async () => {
        await ready()
        harness.service.editField(A, 'desc', 'studio desc')
        harness.service.greetingEdit(A, 0, 'studio greeting')
        live().desc = 'classic desc'
        const kept = harness.service.restore(A, new Set(['desc']))
        expect(kept.ok).toBe(true)
        expect(live().desc).toBe('classic desc')
        expect(live().alternateGreetings).toEqual(['g0', 'g1', 'g2'])
        harness.service.undo(A)
        expect(live().alternateGreetings[0]).toBe('studio greeting')
        const all = harness.service.restore(A, new Set())
        expect(all).toMatchObject({ ok: true, changedElsewhere: ['desc'] })
        expect(live().desc).toBe('d0')
        expect(harness.service.view(A).done.at(-1)?.label).toEqual({ kind: 'restorePoint' })
    })

    test('a restore with no restore point is empty', async () => {
        await ready()
        expect(harness.service.restore(A, new Set())).toEqual({ ok: false, reason: 'empty' })
    })
})

describe('deleted items', () => {
    test('T-D1: a delete followed by later edits is restored at its old index with the side effect', async () => {
        await ready()
        harness.service.greetingDelete(A, 1)
        harness.service.greetingEdit(A, 0, 'later')
        harness.service.editField(A, 'desc', 'later too')
        harness.service.greetingAdd(A)
        const item = harness.service.view(A).deleted[0]
        expect(item.value).toBe('g1')
        expect(harness.service.restoreDeleted(A, item.id).ok).toBe(true)
        expect(live().alternateGreetings).toEqual(['later', 'g1', 'g2', ''])
        expect(live().chats[0].fmIndex).toBe(2)
        expect(harness.service.view(A).deleted).toEqual([])
    })

    test('T-D1: the delete step undo and the History restore exclude each other by id', async () => {
        await ready()
        harness.service.greetingDelete(A, 1)
        const id = harness.service.view(A).deleted[0].id
        harness.service.restoreDeleted(A, id)
        // The item is consumed: undoing the restore lists it again, and only then can the delete undo.
        expect(harness.service.restoreDeleted(A, id)).toEqual({ ok: false, reason: 'unknown' })
        expect(live().alternateGreetings).toEqual(['g0', 'g1', 'g2'])
        harness.service.undo(A)
        expect(live().alternateGreetings).toEqual(['g0', 'g2'])
        expect(harness.service.view(A).deleted.map((entry) => entry.id)).toEqual([id])
    })

    test('T-D2: the deleted item survives a reload and is restorable there', async () => {
        await ready()
        harness.service.greetingDelete(A, 2)
        // Closing Studio ends the visit's open step; the deleted list and the stored record are not part of it.
        harness.service.closeOpenStep(A)
        expect(harness.service.view(A).deleted.map((entry) => entry.value)).toEqual(['g2'])
        await harness.clock.advance(SAVE_DEBOUNCE_MS)
        const reloaded = build(harness.store.shared)
        await reloaded.service.whenReady(A)
        const item = reloaded.service.view(A).deleted[0]
        expect(item.value).toBe('g2')
        live().alternateGreetings = ['g0', 'g1']
        expect(reloaded.service.restoreDeleted(A, item.id).ok).toBe(true)
        expect(live().alternateGreetings).toEqual(['g0', 'g1', 'g2'])
    })

    test('an Undo that moves past a step without writing is saved: a reload shows the step undone and the item released', async () => {
        putCharacters(makeCharacter('A', { alternateGreetings: ['a', 'a'], chats: [{ id: 'c1', note: '', fmIndex: 1 }] }))
        await ready()
        harness.service.greetingDelete(A, 0)
        await harness.clock.advance(SAVE_DEBOUNCE_MS)
        expect(harness.service.view(A).deleted).toHaveLength(1)
        // The delete's owner write was lost: the list and the chat index already read as the Undo would leave them.
        live().alternateGreetings.splice(0, live().alternateGreetings.length, 'a', 'a')
        live().chats[0].fmIndex = 1
        expect(harness.service.undo(A)).toEqual({ ok: true, already: 'undo', listReason: 'other' })
        await harness.clock.advance(SAVE_DEBOUNCE_MS)
        const reloaded = build(harness.store.shared)
        await reloaded.service.whenReady(A)
        expect(reloaded.service.view(A).done).toHaveLength(0)
        expect(reloaded.service.view(A).undone).toHaveLength(1)
        expect(reloaded.service.view(A).deleted).toEqual([])
    })

    test('an Undo that drops a step that cannot be checked is saved: a reload shows the step in neither stack', async () => {
        putCharacters(makeCharacter('A', { alternateGreetings: ['g0', 'g1', 'g1'] }))
        await ready()
        harness.service.greetingDelete(A, 1)
        await harness.clock.advance(SAVE_DEBOUNCE_MS)
        const stored = storedRecord(harness.store.shared, A)
        if (stored === null) throw new Error('the delete was not saved')
        // The record as written before steps carried a list fingerprint: the delete cannot be checked.
        const unfingerprinted: Step[] = stored.record.done.map((step) => ({ id: step.id, at: step.at, label: step.label, ops: step.ops }))
        const shared = new Map<string, string>()
        seedOwner(shared, { ...stored.record, done: unfingerprinted, undone: [] }, 'w:unfingerprinted')
        harness = build(shared)
        await ready()
        // The chat's first-message index is back where the Undo would put it.
        live().chats[0].fmIndex = 2
        expect(harness.service.view(A).done).toHaveLength(1)
        expect(harness.service.undo(A).ok).toBe(true)
        expect(harness.service.view(A).done).toHaveLength(0)
        await harness.clock.advance(SAVE_DEBOUNCE_MS)
        const reloaded = build(harness.store.shared)
        await reloaded.service.whenReady(A)
        expect(reloaded.service.view(A).done).toHaveLength(0)
        expect(reloaded.service.view(A).undone).toHaveLength(0)
    })
})

describe('T-SM5: every history action takes the marked write path', () => {
    type Action = {
        name: string
        prepare: () => void
        act: () => { ok: boolean }
        refused: () => { ok: boolean }
        movedRecord: (record: { done: unknown[]; undone: unknown[] }) => boolean
    }

    function actions(): Action[] {
        const s = () => harness.service
        return [
            {
                name: 'undo',
                prepare: () => void s().editField(A, 'desc', 'x'),
                act: () => s().undo(A),
                refused: () => s().undo(A),
                movedRecord: (record) => record.undone.length === 1,
            },
            {
                name: 'redo',
                prepare: () => {
                    s().editField(A, 'desc', 'x')
                    s().undo(A)
                },
                act: () => s().redo(A),
                refused: () => s().redo(A),
                movedRecord: (record) => record.undone.length === 0 && record.done.length === 1,
            },
            {
                name: 'revertTo',
                prepare: () => {
                    s().editField(A, 'desc', 'x')
                    s().closeOpenStep(A)
                    s().greetingAdd(A)
                },
                act: () => s().revertTo(A, s().view(A).done[0].id),
                refused: () => s().revertTo(A, 'no-such-step'),
                movedRecord: (record) => record.done.length === 3,
            },
            {
                name: 'restore',
                prepare: () => void s().editField(A, 'desc', 'x'),
                act: () => s().restore(A, new Set()),
                refused: () => s().restore(A, new Set()),
                movedRecord: (record) => record.done.length === 2,
            },
            {
                name: 'restoreDeleted',
                prepare: () => void s().greetingDelete(A, 0),
                act: () => s().restoreDeleted(A, s().view(A).deleted[0].id),
                refused: () => s().restoreDeleted(A, 'no-such-item'),
                movedRecord: (record) => record.done.length === 2,
            },
        ]
    }

    for (const name of ['undo', 'redo', 'revertTo', 'restore', 'restoreDeleted']) {
        test(`${name}: the landed action marks, notes the edit with the count read before, and saves the move`, async () => {
            const action = actions().find((entry) => entry.name === name) as Action
            await ready()
            action.prepare()
            await harness.clock.advance(SAVE_DEBOUNCE_MS)
            const marksBefore = h.marks
            const savesBefore = harness.store.counts.save
            const notedBefore = harness.noted.length
            expect(action.act().ok).toBe(true)
            expect(h.marks).toBeGreaterThanOrEqual(marksBefore + 1)
            expect(tracker.character).toContain('A')
            expect(harness.noted).toHaveLength(notedBefore + 1)
            expect(harness.noted.at(-1)).toEqual({ chaId: 'A', before: marksBefore })
            await harness.clock.advance(SAVE_DEBOUNCE_MS)
            expect(harness.store.counts.save).toBe(savesBefore + 1)
            expect(action.movedRecord(harness.store.saves.at(-1)!.record)).toBe(true)
        })

        test(`${name}: the refused action marks nothing, notes nothing and saves nothing`, async () => {
            const action = actions().find((entry) => entry.name === name) as Action
            await ready()
            // Nothing to act on: the precondition fails everywhere.
            expect(action.refused().ok).toBe(false)
            await harness.clock.advance(SAVE_DEBOUNCE_MS * 2)
            expect(h.marks).toBe(0)
            expect(harness.noted).toHaveLength(0)
            expect(harness.store.counts.save).toBe(0)
            // A removed character refuses an action that would otherwise land.
            action.prepare()
            await harness.clock.advance(SAVE_DEBOUNCE_MS)
            const marks = h.marks
            const saves = harness.store.counts.save
            const noted = harness.noted.length
            putCharacters(makeCharacter('B'))
            expect(action.act().ok).toBe(false)
            await harness.clock.advance(SAVE_DEBOUNCE_MS * 2)
            expect(h.marks).toBe(marks)
            expect(harness.noted).toHaveLength(noted)
            expect(harness.store.counts.save).toBe(saves)
        })
    }

    // The landed edit itself is noted with the count read before the write, whatever the owner: the
    // save chip goes pending for a character field, a chat note and a greeting edit alike.
    const edits: { name: string; owner: () => OwnerKey; act: () => { ok: boolean } }[] = [
        { name: 'a character field', owner: () => A, act: () => harness.service.editField(A, 'desc', 'typed') },
        { name: 'a chat note', owner: () => chatA('c1'), act: () => harness.service.editField(chatA('c1'), 'note', 'typed') },
        { name: 'a greeting', owner: () => A, act: () => harness.service.greetingEdit(A, 1, 'typed') },
    ]
    for (const edit of edits) {
        test(`an edit of ${edit.name} notes the edit with the count read before the write`, async () => {
            await ready(edit.owner())
            const marksBefore = h.marks
            expect(edit.act().ok).toBe(true)
            expect(h.marks).toBeGreaterThan(marksBefore)
            expect(harness.noted).toEqual([{ chaId: 'A', before: marksBefore }])
        })
    }
})

describe('T-R1: private characters get no record', () => {
    test('attempted edits through the service leave the store without a key', async () => {
        putCharacters(makeCharacter('A', { license: 'private' }))
        harness = build()
        await ready()
        expect(harness.service.view(A).restricted).toBe(true)
        expect(harness.service.editField(A, 'desc', 'x')).toEqual({ ok: false, reason: 'restricted' })
        expect(harness.service.greetingAdd(A).ok).toBe(false)
        await harness.clock.advance(60_000)
        expect(harness.store.shared.size).toBe(0)
        expect(harness.store.counts.load).toBe(0)
        expect(harness.store.counts.save).toBe(0)
    })
})

describe('list fingerprint through the service (CHORE-690 S1)', () => {
    test('T13 a list step carries the fingerprint of the lists it spans; typing and field edits carry none', async () => {
        putCharacters(makeCharacter('A', { alternateGreetings: ['g0', 'g1'] }))
        await ready()
        harness.service.editField(A, 'desc', 'typed')
        harness.service.greetingEdit(A, 0, 'g0b')
        harness.service.greetingDelete(A, 1)
        const done = harness.service.view(A).done
        expect(done.map((step) => Object.keys(step))).toEqual([
            ['id', 'at', 'label', 'ops'],
            ['id', 'at', 'label', 'ops'],
            ['id', 'at', 'label', 'ops', 'listFingerprint'],
        ])
        expect(done[2].listFingerprint).toStrictEqual({ before: listFingerprintOf(['g0b', 'g1']), after: listFingerprintOf(['g0b']) })
    })

    test('T14 an undo of a delete whose owner write was lost moves past the step; with the write it re-inserts', async () => {
        putCharacters(makeCharacter('A', { alternateGreetings: ['a', 'a'], chats: [{ id: 'c1', note: '', fmIndex: 1 }] }))
        await ready()
        harness.service.greetingDelete(A, 0)
        live().alternateGreetings.splice(0, live().alternateGreetings.length, 'a', 'a')
        live().chats[0].fmIndex = 1
        expect(harness.service.undo(A)).toEqual({ ok: true, already: 'undo', listReason: 'other' })
        expect(live().alternateGreetings).toEqual(['a', 'a'])

        putCharacters(makeCharacter('A', { alternateGreetings: ['a', 'a'], chats: [{ id: 'c1', note: '', fmIndex: 1 }] }))
        harness = build()
        await ready()
        harness.service.greetingDelete(A, 0)
        expect(harness.service.undo(A).ok).toBe(true)
        expect(live().alternateGreetings).toEqual(['a', 'a'])
    })

    test('T76 a step that moves past without writing marks nothing, notes no edit and is saved', async () => {
        putCharacters(makeCharacter('A', { alternateGreetings: ['a', 'a'], chats: [{ id: 'c1', note: '', fmIndex: 1 }] }))
        await ready()
        harness.service.greetingDelete(A, 0)
        live().alternateGreetings.splice(0, live().alternateGreetings.length, 'a', 'a')
        live().chats[0].fmIndex = 1
        const noted = harness.noted.length
        const marks = h.marks
        const marked = tracker.character.length
        expect(harness.service.undo(A)).toEqual({ ok: true, already: 'undo', listReason: 'other' })
        expect(harness.noted).toHaveLength(noted)
        expect(h.marks).toBe(marks)
        expect(tracker.character).toHaveLength(marked)
        expect(harness.service.view(A).done).toHaveLength(0)
        expect(harness.service.view(A).undone).toHaveLength(1)
        expect(live().alternateGreetings).toEqual(['a', 'a'])
    })

    test('T72 a module owner claims apart from a character of the same id, is never restricted and writes nothing live', async () => {
        const module = moduleOwnerKey('A')
        harness.service.useOwner(A)
        harness.service.useOwner(module)
        await harness.service.whenReady(module)
        expect(harness.claim.calls).toEqual(['A', 'm:A'])
        const view = harness.service.view(module)
        expect(view.restricted).toBe(false)
        expect(view.phase).toBe('ready')
        // No module panel is open, so the module owner is not selected and nothing is read or written.
        expect(harness.service.undo(module)).toEqual({ ok: false, reason: 'not-selected' })
    })
    test('T64s (a) a revert across deletes hashes no whole list and stores the exact fingerprint', async () => {
        const start = Array.from({ length: 20 }, (_, i) => `g${i}`.padEnd(50, 'x'))
        putCharacters(makeCharacter('A', { alternateGreetings: [...start] }))
        await ready()
        harness.service.editField(A, 'desc', 'anchor')
        const anchor = harness.service.view(A).done[0].id
        for (let i = 0; i < 10; i++) {
            harness.clock.tick(COALESCE_MS)
            harness.service.greetingDelete(A, 0)
        }
        const before = [...live().alternateGreetings]
        fp.full = 0
        fp.mix = 0
        expect(harness.service.revertTo(A, anchor).ok).toBe(true)
        expect(fp.full).toBe(0)
        expect(live().alternateGreetings).toEqual(start)
        const top = harness.service.view(A).done.at(-1)!
        expect(top.listFingerprint).toStrictEqual({ before: listFingerprintOf(before), after: listFingerprintOf(start) })
    })

    test('T64s (b) the budget reaches the real service: a 200,000-unit slot suspends most decisions', async () => {
        const start = Array.from({ length: 10 }, (_, i) => `g${i}`.padEnd(50, 'x'))
        start[1] = 'big'.padEnd(200_000, 'y')
        putCharacters(makeCharacter('A', { alternateGreetings: [...start] }))
        await ready()
        harness.service.editField(A, 'desc', 'anchor')
        const anchor = harness.service.view(A).done[0].id
        let salt = 0
        for (let cycle = 0; cycle < 9; cycle++) {
            for (let k = 0; k < 10; k++) {
                harness.clock.tick(COALESCE_MS)
                salt += 1
                harness.service.greetingEdit(A, 1, `e${salt}`.padEnd(200_000, 'z'))
            }
            harness.clock.tick(COALESCE_MS)
            harness.service.greetingDelete(A, 0)
        }
        fp.full = 0
        fp.mix = 0
        expect(harness.service.revertTo(A, anchor).ok).toBe(true)
        expect(fp.full).toBe(0)
        expect(fp.mix).toBe(5)
    })

    test('T64s (c) a delete hashes no whole list; its undo and redo hash the live list once and keep the stored fingerprint', async () => {
        const start = Array.from({ length: 6 }, (_, i) => `g${i}`.padEnd(40, 'x'))
        putCharacters(makeCharacter('A', { alternateGreetings: [...start], chats: [{ id: 'c1', note: '', fmIndex: 1 }] }))
        await ready()
        fp.full = 0
        fp.mix = 0
        expect(harness.service.greetingDelete(A, 1).ok).toBe(true)
        expect([fp.full, fp.mix]).toEqual([0, 2])
        const stored = harness.service.view(A).done.at(-1)!.listFingerprint
        expect(stored).toStrictEqual({ before: listFingerprintOf(start), after: listFingerprintOf(start.filter((_, i) => i !== 1)) })
        fp.full = 0
        fp.mix = 0
        expect(harness.service.undo(A).ok).toBe(true)
        expect([fp.full, fp.mix]).toEqual([1, 0])
        expect(live().alternateGreetings).toEqual(start)
        expect(live().chats[0].fmIndex).toBe(1)
        expect(harness.service.view(A).undone.at(-1)!.listFingerprint).toStrictEqual(stored)
        fp.full = 0
        fp.mix = 0
        expect(harness.service.redo(A).ok).toBe(true)
        expect([fp.full, fp.mix]).toEqual([1, 0])
        expect(harness.service.view(A).done.at(-1)!.listFingerprint).toStrictEqual(stored)
    })

    test('T85s a revert whose net effect is nothing is reported unchanged and writes, marks, records and saves nothing', async () => {
        await ready()
        harness.service.editField(A, 'desc', 'anchor')
        const anchor = harness.service.view(A).done[0].id
        harness.clock.tick(COALESCE_MS)
        harness.service.greetingDelete(A, 1)
        expect(harness.service.revertTo(A, anchor).ok).toBe(true)
        expect(live().alternateGreetings).toEqual(['g0', 'g1', 'g2'])
        await harness.clock.advance(SAVE_DEBOUNCE_MS)
        const characters = JSON.stringify(DBState.db.characters)
        const done = harness.service.view(A).done
        const marks = h.marks
        const noted = harness.noted.length
        const saves = JSON.stringify(harness.store.counts)
        expect(harness.service.revertTo(A, anchor)).toEqual({ ok: true, unchanged: true })
        await harness.clock.advance(SAVE_DEBOUNCE_MS)
        expect(JSON.stringify(DBState.db.characters)).toBe(characters)
        expect(harness.service.view(A).done).toBe(done)
        expect(h.marks).toBe(marks)
        expect(harness.noted).toHaveLength(noted)
        expect(JSON.stringify(harness.store.counts)).toBe(saves)
    })

    test('T85f an unchanged revert across a chat without an id reports fmNotRestored and writes, marks, records and saves nothing', async () => {
        putCharacters(makeCharacter('A', { chats: [{ note: '', fmIndex: 1 }] }))
        await ready()
        harness.service.editField(A, 'desc', 'a')
        const anchor = harness.service.view(A).done[0].id
        harness.clock.tick(COALESCE_MS)
        expect(harness.service.greetingDelete(A, 1).ok).toBe(true)
        harness.clock.tick(COALESCE_MS)
        const deletedId = harness.service.view(A).deleted[0].id
        expect(harness.service.restoreDeleted(A, deletedId).ok).toBe(true)
        await harness.clock.advance(SAVE_DEBOUNCE_MS)
        const characters = JSON.stringify(DBState.db.characters)
        const done = harness.service.view(A).done
        const marks = h.marks
        const noted = harness.noted.length
        const saves = JSON.stringify(harness.store.counts)
        expect(harness.service.revertTo(A, anchor)).toEqual({ ok: true, unchanged: true, fmNotRestored: true })
        await harness.clock.advance(SAVE_DEBOUNCE_MS)
        expect(JSON.stringify(DBState.db.characters)).toBe(characters)
        expect(harness.service.view(A).done).toBe(done)
        expect(h.marks).toBe(marks)
        expect(harness.noted).toHaveLength(noted)
        expect(JSON.stringify(harness.store.counts)).toBe(saves)
    })

    test('T85u an unchanged revert that skipped a list change reports the count and writes, marks, records and saves nothing', async () => {
        await ready()
        harness.service.editField(A, 'desc', 'a')
        const anchor = harness.service.view(A).done[0].id
        harness.clock.tick(COALESCE_MS)
        harness.service.editField(A, 'desc', 'b')
        harness.clock.tick(COALESCE_MS)
        expect(harness.service.greetingDelete(A, 2).ok).toBe(true)
        harness.clock.tick(COALESCE_MS)
        harness.service.editField(A, 'desc', 'a')
        live().alternateGreetings.push('z')
        await harness.clock.advance(SAVE_DEBOUNCE_MS)
        const characters = JSON.stringify(DBState.db.characters)
        const done = harness.service.view(A).done
        const marks = h.marks
        const noted = harness.noted.length
        const saves = JSON.stringify(harness.store.counts)
        expect(harness.service.revertTo(A, anchor)).toEqual({ ok: true, unchanged: true, listSkipped: 1, listReason: 'neither' })
        await harness.clock.advance(SAVE_DEBOUNCE_MS)
        expect(JSON.stringify(DBState.db.characters)).toBe(characters)
        expect(harness.service.view(A).done).toBe(done)
        expect(h.marks).toBe(marks)
        expect(harness.noted).toHaveLength(noted)
        expect(JSON.stringify(harness.store.counts)).toBe(saves)
    })
})

describe('a step that changed the first message together with the alternate first messages', () => {
    const fieldValue = (value: string) => ({ had: true as const, value })
    const descStep: Step = { id: 's0', at: 1, label: { kind: 'field', field: 'desc' }, ops: [{ op: 'set', path: 'desc', before: fieldValue('d0'), after: fieldValue('d1') }] }
    // Main M and the entry G trade places: the live character holds the result, main G and [A, M, C].
    const swapStep: Step = {
        id: 's1',
        at: 2,
        label: { kind: 'field', field: 'firstMessage' },
        ops: [
            { op: 'set', path: 'firstMessage', before: fieldValue('M'), after: fieldValue('G') },
            { op: 'listSet', index: 1, before: 'G', after: 'M' },
        ],
    }

    async function openWith(steps: Step[], character: Partial<LiveCharacter>): Promise<void> {
        putCharacters(makeCharacter('A', { desc: 'd1', ...character }), makeCharacter('B'))
        const shared = new Map<string, string>()
        seedOwner(shared, { ...emptyRecord(A, 1), done: steps }, 'w:bound')
        harness = build(shared)
        await ready()
    }

    test('an undo after the main text changed outside is refused with its own reason and writes nothing', async () => {
        await openWith([descStep, swapStep], { firstMessage: 'Z', alternateGreetings: ['A', 'M', 'C'] })
        expect(harness.service.undo(A)).toEqual({ ok: false, reason: 'pairSplit' })
        expect(live().firstMessage).toBe('Z')
        expect(live().alternateGreetings).toEqual(['A', 'M', 'C'])
        expect(harness.service.view(A).done).toHaveLength(2)
        expect(h.marks).toBe(0)
    })

    test('a revert that can only skip that step is refused with the same reason', async () => {
        await openWith([descStep, swapStep], { firstMessage: 'Z', alternateGreetings: ['A', 'M', 'C'] })
        expect(harness.service.revertTo(A, 's0')).toEqual({ ok: false, reason: 'pairSplit' })
        expect(live().alternateGreetings).toEqual(['A', 'M', 'C'])
        expect(harness.service.view(A).done).toHaveLength(2)
    })

    test('a revert that lands other changes reports the skipped pair', async () => {
        const later: Step = { id: 's2', at: 3, label: { kind: 'field', field: 'desc' }, ops: [{ op: 'set', path: 'desc', before: fieldValue('d1'), after: fieldValue('d2') }] }
        await openWith([descStep, swapStep, later], { desc: 'd2', firstMessage: 'Z', alternateGreetings: ['A', 'M', 'C'] })
        expect(harness.service.revertTo(A, 's0')).toMatchObject({ ok: true, pairSkipped: 1, listSkipped: 1 })
        expect(live().desc).toBe('d1')
        expect(live().firstMessage).toBe('Z')
        expect(live().alternateGreetings).toEqual(['A', 'M', 'C'])
    })

    test('a revert whose other steps cancel out still reports the skipped pair and writes nothing', async () => {
        const out: Step = { id: 's1', at: 2, label: { kind: 'greetingEdit' }, ops: [{ op: 'listSet', index: 0, before: 'A', after: 'a1' }] }
        const back: Step = { id: 's2', at: 3, label: { kind: 'greetingEdit' }, ops: [{ op: 'listSet', index: 0, before: 'a1', after: 'A' }] }
        const bound: Step = {
            id: 's3',
            at: 4,
            label: { kind: 'field', field: 'firstMessage' },
            ops: [
                { op: 'set', path: 'firstMessage', before: fieldValue('M'), after: fieldValue('N') },
                { op: 'listSet', index: 2, before: 'C', after: 'c3' },
            ],
        }
        await openWith([descStep, out, back, bound], { firstMessage: 'Z', alternateGreetings: ['A', 'B', 'c3'] })
        expect(harness.service.revertTo(A, 's0')).toEqual({ ok: true, unchanged: true, listSkipped: 1, pairSkipped: 1 })
        expect(live().alternateGreetings).toEqual(['A', 'B', 'c3'])
        expect(harness.service.view(A).done).toHaveLength(4)
    })
})

describe('the text target resolver maps a registry path per owner kind', () => {
    // Owners shaped as the importers produce them. The decoy lists hold the other kind's name, so a
    // resolver that mixes the kinds up reads a different text.
    const character = {
        globalLore: [{ content: 'c-lore0' }, { content: 'c-lore1' }],
        customscript: [{ out: 'c-out0' }],
        lorebook: [{ content: 'decoy' }],
        regex: [{ out: 'decoy' }],
    }
    const module = {
        lorebook: [{ content: 'm-lore0' }, { content: 'm-lore1' }],
        regex: [{ out: 'm-out0' }],
        globalLore: [{ content: 'decoy' }],
        customscript: [{ out: 'decoy' }],
    }

    const ownerOf = (kind: 'character' | 'module', source: object): TargetOwner =>
        kind === 'character' ? { kind, source: source as Extract<TargetOwner, { kind: 'character' }>['source'] } : { kind, source: source as Extract<TargetOwner, { kind: 'module' }>['source'] }

    test('a character holds its lore in globalLore and its regex out in customscript', () => {
        expect(rewritableTextAt(ownerOf('character', character), 'lore/1/content')).toBe('c-lore1')
        expect(rewritableTextAt(ownerOf('character', character), 'regex/0/out')).toBe('c-out0')
    })

    test('a module holds its lore in lorebook and its regex out in regex, never in the character lists', () => {
        expect(rewritableTextAt(ownerOf('module', module), 'lore/0/content')).toBe('m-lore0')
        expect(rewritableTextAt(ownerOf('module', module), 'regex/0/out')).toBe('m-out0')
    })

    test('any other path is refused, and so is an entry that holds no string', () => {
        const refused = [
            // Rewritable character paths: they read null here only because neither fixture holds the key.
            'desc',
            'alternateGreetings/1',
            'lore/0/comment',
            'lore/0/out',
            'regex/0/content',
            'lore/01/content',
            'lore/-1/content',
            'lore//content',
            'trigger/0/effect/1/value',
            'lore/0/content/extra',
            'x/lore/0/content',
            '',
        ]
        for (const kind of ['character', 'module'] as const) {
            for (const path of refused) {
                expect(rewritableTextAt(ownerOf(kind, kind === 'character' ? character : module), path), `${kind} ${path}`).toBeNull()
            }
            expect(rewritableTextAt(ownerOf(kind, {}), 'lore/0/content')).toBeNull()
            expect(rewritableTextAt(ownerOf(kind, { globalLore: [{}], lorebook: [{}] }), 'lore/0/content')).toBeNull()
            expect(rewritableTextAt(ownerOf(kind, character), 'lore/9/content')).toBeNull()
        }
    })
})
