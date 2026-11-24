// @vitest-environment jsdom
// Deleting an alternative first message through the service moves only the open chat, and a restore (History or the
// toast Undo) follows the chat that is open when it runs: the chat keeps the text it shows through the delete, the
// restore, undo, redo and revert. Other chats are not adjusted by either; Ctrl+Z of the delete is the exact undo.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DBState, selIdState } from 'src/ts/stores.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import type { character } from 'src/ts/storage/database.svelte'
import { firstMessageOf } from 'src/ts/process/firstMessage'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { isObjItem } from '../historyModel'
import { createOwnerHistoryService, type OwnerHistoryService } from '../ownerHistory.svelte'
import { characterOwnerKey } from '../ownerPhase'
import { createFakeClock } from './historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from './studioStoreDoubles'

const h = vi.hoisted(() => ({ marks: 0 }))

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
    desc: string
    firstMessage: string
    alternateGreetings: string[]
    chats: LiveChat[]
    chatPage: number
}

function makeCharacter(overrides: Partial<LiveCharacter> = {}): LiveCharacter {
    return {
        chaId: 'A',
        desc: 'd0',
        firstMessage: 'M',
        alternateGreetings: ['g0', 'g1', 'g2'],
        chats: [{ id: 'c1', note: '', fmIndex: -1 }],
        chatPage: 0,
        ...overrides,
    }
}

function live(): LiveCharacter {
    return (DBState.db.characters as unknown as LiveCharacter[])[0]
}

// The text the chat on `page` shows.
function shownAt(page: number): string {
    return firstMessageOf(live() as unknown as character, live().chats[page])
}

const shown = () => shownAt(live().chatPage)

const A = characterOwnerKey('A')
let service: OwnerHistoryService

const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }

async function start(character: LiveCharacter = makeCharacter()): Promise<void> {
    DBState.db.characters = [character] as unknown as typeof DBState.db.characters
    service = createOwnerHistoryService({
        store: createMemoryStudioStore({}),
        claim: createClaimDouble(),
        clock: createFakeClock(),
        pageSession: 'p1',
        getVisitId: () => 'v1',
        registerLeaveFlush: () => () => {},
    })
    await service.whenReady(A)
}

// The id of the History item that holds `value`.
function deletedIdOf(value: string): string {
    const item = service.view(A).deleted.find((entry) => !isObjItem(entry) && entry.value === value)
    if (!item) {
        throw new Error(`no deleted item holding ${value}`)
    }
    return item.id
}

const lastStepChatFmOps = () => service.view(A).done.at(-1)?.ops.filter((op) => op.op === 'chatFm')

beforeEach(() => {
    h.marks = 0
    tracker.character.length = 0
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
    resetStudioScreenForTests()
    selIdState.selId = 0
    studioScreen.chaId = 'A'
})

afterEach(() => {
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
})

describe('a delete moves only the open chat and Ctrl+Z puts it back exactly', () => {
    test('S-T7 a delete before the shown entry keeps the shown text; undo and redo move the chat with the list', async () => {
        await start(makeCharacter({ chats: [{ id: 'c1', note: '', fmIndex: 2 }] }))
        expect(shown()).toBe('g2')
        expect(service.greetingDelete(A, 0).ok).toBe(true)
        expect(live().chats[0].fmIndex).toBe(1)
        expect(shown()).toBe('g2')
        service.undo(A)
        expect([live().alternateGreetings, live().chats[0].fmIndex]).toEqual([['g0', 'g1', 'g2'], 2])
        service.redo(A)
        expect([live().alternateGreetings, live().chats[0].fmIndex]).toEqual([['g1', 'g2'], 1])
        expect(shown()).toBe('g2')
    })

    test('S-CZ Ctrl+Z of the delete puts the delete-time chat back by id even after the open chat changed', async () => {
        await start(makeCharacter({ chats: [{ id: 'c1', note: '', fmIndex: 2 }, { id: 'c2', note: '', fmIndex: 1 }] }))
        service.greetingDelete(A, 0)
        expect(live().chats[0].fmIndex).toBe(1)
        live().chatPage = 1
        expect(service.undo(A).ok).toBe(true)
        expect([live().chats[0].fmIndex, live().chats[1].fmIndex]).toEqual([2, 1])
        expect(shownAt(0)).toBe('g2')
    })

    test('T10 the other chats are not adjusted by a delete; exactly one chatFm, on the open chat', async () => {
        await start(makeCharacter({ chats: [{ id: 'c1', note: '', fmIndex: 2 }, { id: 'c2', note: '', fmIndex: 2 }] }))
        service.greetingDelete(A, 0)
        expect(lastStepChatFmOps()).toEqual([{ op: 'chatFm', chatId: 'c1', before: { had: true, value: 2 }, after: { had: true, value: 1 } }])
        expect([live().chats[0].fmIndex, live().chats[1].fmIndex]).toEqual([1, 2])
    })

    test('T11 a delete is one mark with a chat op and one mark without', async () => {
        await start(makeCharacter({ chats: [{ id: 'c1', note: '', fmIndex: 2 }] }))
        service.greetingDelete(A, 0)
        expect(h.marks).toBe(1)
        live().chats[0].fmIndex = -1
        service.greetingDelete(A, 0)
        expect(h.marks).toBe(2)
        expect(lastStepChatFmOps()).toEqual([])
    })

    test('T6 an open chat without an id follows by page write; undoing a delete before its entry cannot replay the chat op', async () => {
        await start(makeCharacter({ chats: [{ note: '', fmIndex: 0 }] }))
        service.greetingDelete(A, 2)
        expect(service.undo(A)).toEqual({ ok: true })
        live().chats[0].fmIndex = 2
        service.greetingDelete(A, 0)
        expect(live().chats[0].fmIndex).toBe(1)
        expect(service.undo(A)).toMatchObject({ ok: true, fmNotRestored: true })
        expect(live().chats[0].fmIndex).toBe(1)
    })
})

describe('a restore follows the chat that is open when it runs', () => {
    test('S-T8a the restore after a delete before the shown entry keeps the shown text; the step is [listInsert, chatFm 1 to 2]', async () => {
        await start(makeCharacter({ chats: [{ id: 'c1', note: '', fmIndex: 2 }] }))
        service.greetingDelete(A, 0)
        expect(service.restoreDeleted(A, deletedIdOf('g0')).ok).toBe(true)
        expect(live().alternateGreetings).toEqual(['g0', 'g1', 'g2'])
        expect(shown()).toBe('g2')
        expect(service.view(A).done.at(-1)?.ops).toEqual([
            { op: 'listInsert', index: 0, value: 'g0' },
            { op: 'chatFm', chatId: 'c1', before: { had: true, value: 1 }, after: { had: true, value: 2 } },
        ])
    })

    test('S-T8b the delete of the shown entry sends the chat to main and its restore puts the chat back', async () => {
        await start(makeCharacter({ chats: [{ id: 'c1', note: '', fmIndex: 1 }] }))
        service.greetingDelete(A, 1)
        expect(shown()).toBe('M')
        service.restoreDeleted(A, deletedIdOf('g1'))
        expect([live().chats[0].fmIndex, shown()]).toEqual([1, 'g1'])
    })

    test('S-T8c a chat moved onto or past the insert index meanwhile follows; below it, it is left', async () => {
        await start(makeCharacter({ chats: [{ id: 'c1', note: '', fmIndex: 1 }] }))
        service.greetingDelete(A, 1)
        live().chats[0].fmIndex = 1
        expect(shown()).toBe('g2')
        service.restoreDeleted(A, deletedIdOf('g1'))
        expect([live().chats[0].fmIndex, shown()]).toEqual([2, 'g2'])

        await start(makeCharacter({ chats: [{ id: 'c1', note: '', fmIndex: 2 }] }))
        service.greetingDelete(A, 2)
        live().chats[0].fmIndex = 0
        service.restoreDeleted(A, deletedIdOf('g2'))
        expect([live().chats[0].fmIndex, shown()]).toEqual([0, 'g0'])
    })

    test('S-T8d a swap with the default first message before the restore: the chat keeps its text', async () => {
        await start(makeCharacter({ chats: [{ id: 'c1', note: '', fmIndex: 2 }] }))
        service.greetingDelete(A, 0)
        service.greetingSwapWithMain(A, 1)
        expect([live().chats[0].fmIndex, shown()]).toEqual([-1, 'g2'])
        service.restoreDeleted(A, deletedIdOf('g0'))
        expect([live().chats[0].fmIndex, shown()]).toEqual([-1, 'g2'])
    })

    test('S-T8f two deletes before the shown entry, the older restored first: the chat keeps its text', async () => {
        await start(makeCharacter({ alternateGreetings: ['g0', 'g1', 'g2', 'g3'], chats: [{ id: 'c1', note: '', fmIndex: 3 }] }))
        service.greetingDelete(A, 0)
        service.greetingDelete(A, 0)
        expect(shown()).toBe('g3')
        service.restoreDeleted(A, deletedIdOf('g0'))
        expect(shown()).toBe('g3')
        service.restoreDeleted(A, deletedIdOf('g1'))
        expect([live().alternateGreetings, shown()]).toEqual([['g1', 'g0', 'g2', 'g3'], 'g3'])
    })

    test('S-T9 a revert to before the delete and the undo of that revert keep the chat with the list', async () => {
        await start(makeCharacter({ chats: [{ id: 'c1', note: '', fmIndex: 2 }] }))
        service.greetingEdit(A, 1, 'g1x')
        const stepId = service.view(A).done[0].id
        service.greetingDelete(A, 0)
        expect(service.revertTo(A, stepId).ok).toBe(true)
        expect([live().alternateGreetings, live().chats[0].fmIndex]).toEqual([['g0', 'g1x', 'g2'], 2])
        service.undo(A)
        expect([live().alternateGreetings, live().chats[0].fmIndex]).toEqual([['g1x', 'g2'], 1])
        expect(shown()).toBe('g2')
    })

    test('S-K2 a delete above the shown entry, a real move of the shown entry past it, the restore: the chat keeps its text', async () => {
        await start(makeCharacter({ chats: [{ id: 'c1', note: '', fmIndex: 0 }] }))
        service.greetingDelete(A, 1)
        const id = deletedIdOf('g1')
        service.greetingMove(A, 0, 1)
        expect(service.restoreDeleted(A, id).ok).toBe(true)
        expect(live().alternateGreetings).toEqual(['g2', 'g1', 'g0'])
        expect(shown()).toBe('g0')
    })

    test('S-K3 a chat on main, a delete, a real swap that brings it onto the old main, the restore: the chat keeps its text', async () => {
        await start(makeCharacter({ chats: [{ id: 'c1', note: '', fmIndex: -1 }] }))
        service.greetingDelete(A, 0)
        const id = deletedIdOf('g0')
        service.greetingSwapWithMain(A, 1)
        expect(shown()).toBe('M')
        expect(service.restoreDeleted(A, id).ok).toBe(true)
        expect(shown()).toBe('M')
    })

    test('S-MARK a restore with a chat follow is one write and one mark', async () => {
        await start(makeCharacter({ chats: [{ id: 'c1', note: '', fmIndex: 2 }] }))
        service.greetingDelete(A, 0)
        const before = h.marks
        service.restoreDeleted(A, deletedIdOf('g0'))
        expect(h.marks - before).toBe(1)
    })

    test('S-NOID an open chat without a unique id follows by page write; undoing the restore notes fmNotRestored', async () => {
        await start(makeCharacter({ chats: [{ note: '', fmIndex: 2 }] }))
        service.greetingDelete(A, 0)
        expect(service.restoreDeleted(A, deletedIdOf('g0')).ok).toBe(true)
        expect(live().chats[0].fmIndex).toBe(2)
        expect(shown()).toBe('g2')
        expect(service.view(A).done.at(-1)?.ops[1]).toMatchObject({ op: 'chatFm', chatId: null })
        expect(service.undo(A)).toMatchObject({ ok: true, fmNotRestored: true })
    })

    test('S-RC an open chat with a duplicated id follows by page write, not by the shared id', async () => {
        await start(makeCharacter({ chats: [{ id: 'd', note: '', fmIndex: 2 }, { id: 'd', note: '', fmIndex: 0 }] }))
        service.greetingDelete(A, 0)
        expect(service.restoreDeleted(A, deletedIdOf('g0')).ok).toBe(true)
        expect([live().chats[0].fmIndex, live().chats[1].fmIndex, shown()]).toEqual([2, 0, 'g2'])
        expect(service.view(A).done.at(-1)?.ops[1]).toMatchObject({ op: 'chatFm', chatId: null })
    })
})

// Only the chat that is open when the restore runs is adjusted. The chat that was open at the delete and is no longer
// open stays where the delete left it: after a delete before its entry it shows the neighbour, after a delete of its
// entry it shows the default first message. Ctrl+Z of the delete is the exact undo for that chat.
describe('a restore leaves the chat that was open at the delete', () => {
    test('S-NC1 a reset item and another chat open: no chatFm, the delete-time chat stays on main', async () => {
        await start(makeCharacter({ chats: [{ id: 'c1', note: '', fmIndex: 1 }, { id: 'c2', note: '', fmIndex: -1 }] }))
        service.greetingDelete(A, 1)
        expect(live().chats[0].fmIndex).toBe(-1)
        live().chatPage = 1
        expect(service.restoreDeleted(A, deletedIdOf('g1')).ok).toBe(true)
        expect([live().chats[0].fmIndex, live().chats[1].fmIndex]).toEqual([-1, -1])
        expect(lastStepChatFmOps()).toEqual([])
    })

    test('S-NC2 a re-index item and another chat open: that chat follows, the delete-time chat shows the neighbour', async () => {
        await start(makeCharacter({ chats: [{ id: 'c1', note: '', fmIndex: 2 }, { id: 'c2', note: '', fmIndex: 1 }] }))
        service.greetingDelete(A, 0)
        live().chatPage = 1
        const shownC2 = shownAt(1)
        expect(service.restoreDeleted(A, deletedIdOf('g0')).ok).toBe(true)
        expect(shownAt(1)).toBe(shownC2)
        expect(lastStepChatFmOps()).toEqual([{ op: 'chatFm', chatId: 'c2', before: { had: true, value: 1 }, after: { had: true, value: 2 } }])
        expect(live().chats[0].fmIndex).toBe(1)
        expect(shownAt(0)).toBe('g1')
    })
})
