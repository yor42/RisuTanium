// @vitest-environment jsdom
// Move, swap with the default first message and append-many through the service: the list and the chat index move
// together, undo, redo and revert replay them, a swap lands both texts or stops (decision table through the real
// builder), and the stale-index pin applies to append and to the single add.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DBState, selIdState } from 'src/ts/stores.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import type { character } from 'src/ts/storage/database.svelte'
import { firstMessageOf } from 'src/ts/process/firstMessage'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { createOwnerHistoryService, type OwnerHistoryService } from '../ownerHistory.svelte'
import { characterOwnerKey, chatOwnerKey } from '../ownerPhase'
import { listFingerprintOf } from '../listFingerprint'
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

function putCharacter(value: LiveCharacter): void {
    DBState.db.characters = [value] as unknown as typeof DBState.db.characters
}

function live(): LiveCharacter {
    return (DBState.db.characters as unknown as LiveCharacter[])[0]
}

// The text the open chat shows.
function shown(): string {
    return firstMessageOf(live() as unknown as character, live().chats[0])
}

const A = characterOwnerKey('A')
let service: OwnerHistoryService

const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }

async function start(character: LiveCharacter = makeCharacter()): Promise<void> {
    putCharacter(character)
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

describe('B2 and B3: move', () => {
    test('B2 moves the list, the chat follows, one greetingMove step with the fingerprint, deleted untouched', async () => {
        await start(makeCharacter({ chats: [{ id: 'c1', note: '', fmIndex: 0 }] }))
        expect(service.greetingMove(A, 0, 2)).toEqual({ ok: true })
        expect(live().alternateGreetings).toEqual(['g1', 'g2', 'g0'])
        expect(live().chats[0].fmIndex).toBe(2)
        expect(shown()).toBe('g0')
        const view = service.view(A)
        expect(view.done.map((step) => step.label)).toEqual([{ kind: 'greetingMove' }])
        expect(view.done[0].listFingerprint).toStrictEqual({
            before: listFingerprintOf(['g0', 'g1', 'g2']),
            after: listFingerprintOf(['g1', 'g2', 'g0']),
        })
        expect(view.deleted).toEqual([])
    })

    test('B3 undo restores the list and the chat position, redo moves both again', async () => {
        await start(makeCharacter({ chats: [{ id: 'c1', note: '', fmIndex: 0 }] }))
        service.greetingMove(A, 0, 2)
        expect(service.undo(A).ok).toBe(true)
        expect(live().alternateGreetings).toEqual(['g0', 'g1', 'g2'])
        expect(live().chats[0].fmIndex).toBe(0)
        expect(service.redo(A).ok).toBe(true)
        expect(live().alternateGreetings).toEqual(['g1', 'g2', 'g0'])
        expect(live().chats[0].fmIndex).toBe(2)
    })

    test('B3 move 2 to 0 with the chat on 1: the chat ends on 2, and undo returns it to 1', async () => {
        await start(makeCharacter({ chats: [{ id: 'c1', note: '', fmIndex: 1 }] }))
        service.greetingMove(A, 2, 0)
        expect(live().alternateGreetings).toEqual(['g2', 'g0', 'g1'])
        expect(live().chats[0].fmIndex).toBe(2)
        expect(shown()).toBe('g1')
        service.undo(A)
        expect(live().chats[0].fmIndex).toBe(1)
        expect(shown()).toBe('g1')
    })

    test('a refused or unchanged move writes nothing and records nothing', async () => {
        await start()
        expect(service.greetingMove(A, 1, 1)).toEqual({ ok: true, unchanged: true })
        expect(service.greetingMove(A, 0, 5)).toEqual({ ok: false, reason: 'precondition' })
        expect(service.view(A).done).toEqual([])
        expect(h.marks).toBe(0)
    })

    test('B8 a context chat without a unique id: the move sets fmIndex by page index, the op has chatId null and undo notes fmNotRestored', async () => {
        await start(makeCharacter({ chats: [{ note: '', fmIndex: 0 }] }))
        service.greetingMove(A, 0, 2)
        expect(live().chats[0].fmIndex).toBe(2)
        expect(service.view(A).done[0].ops[2]).toMatchObject({ op: 'chatFm', chatId: null })
        expect(service.undo(A)).toMatchObject({ ok: true, fmNotRestored: true })
        expect(live().alternateGreetings).toEqual(['g0', 'g1', 'g2'])
    })

    test('B9 move, swap and append leave the deleted list alone, and a restore after a move still inserts', async () => {
        await start()
        service.greetingDelete(A, 0)
        const deleted = service.view(A).deleted
        expect(deleted).toHaveLength(1)
        service.greetingMove(A, 0, 1)
        service.greetingSwapWithMain(A, 0)
        service.greetingAppendMany(A, ['x'])
        expect(service.view(A).deleted).toEqual(deleted)
        expect(service.restoreDeleted(A, deleted[0].id).ok).toBe(true)
        expect(live().alternateGreetings).toContain('g0')
    })
})

describe('B4: swap and the decision table through the real builder', () => {
    test('B4 exchanges main and the entry, the chat follows both ways, undo and redo restore', async () => {
        await start()
        expect(service.greetingSwapWithMain(A, 1)).toEqual({ ok: true })
        expect(live().firstMessage).toBe('g1')
        expect(live().alternateGreetings).toEqual(['g0', 'M', 'g2'])
        expect(live().chats[0].fmIndex).toBe(1)
        expect(shown()).toBe('M')
        expect(service.view(A).done.map((step) => step.label)).toEqual([{ kind: 'greetingSwap' }])
        expect(service.view(A).done[0].listFingerprint).toBeUndefined()
        service.undo(A)
        expect(live().firstMessage).toBe('M')
        expect(live().alternateGreetings).toEqual(['g0', 'g1', 'g2'])
        expect(live().chats[0].fmIndex).toBe(-1)
        service.redo(A)
        expect(live().firstMessage).toBe('g1')
        expect(live().alternateGreetings).toEqual(['g0', 'M', 'g2'])
        expect(live().chats[0].fmIndex).toBe(1)
    })

    test('the swap is refused when firstMessage is not a string, and unchanged for equal texts', async () => {
        await start(makeCharacter({ firstMessage: 5 as unknown as string }))
        expect(service.greetingSwapWithMain(A, 0)).toEqual({ ok: false, reason: 'precondition' })
        await start(makeCharacter({ firstMessage: 'g1' }))
        expect(service.greetingSwapWithMain(A, 1)).toEqual({ ok: true, unchanged: true })
    })

    test('B5a an outside change to main: undo stops whole and live is unchanged', async () => {
        await start()
        service.greetingSwapWithMain(A, 1)
        live().firstMessage = 'outside'
        expect(service.undo(A)).toEqual({ ok: false, reason: 'pairSplit' })
        expect(live().firstMessage).toBe('outside')
        expect(live().alternateGreetings).toEqual(['g0', 'M', 'g2'])
        expect(live().chats[0].fmIndex).toBe(1)
        expect(service.view(A).done).toHaveLength(1)
    })

    test('B5b an outside change to the entry: undo stops whole and live is unchanged', async () => {
        await start()
        service.greetingSwapWithMain(A, 1)
        live().alternateGreetings[1] = 'outside'
        expect(service.undo(A)).toEqual({ ok: false, reason: 'pairSplit' })
        expect(live().firstMessage).toBe('g1')
        expect(live().alternateGreetings).toEqual(['g0', 'outside', 'g2'])
    })

    test('B5c one text already back by hand and the other not: undo stops whole', async () => {
        await start()
        service.greetingSwapWithMain(A, 1)
        live().firstMessage = 'M'
        expect(service.undo(A)).toEqual({ ok: false, reason: 'pairSplit' })
        expect(live().alternateGreetings).toEqual(['g0', 'M', 'g2'])
    })

    test('B5q the chat moved elsewhere: undo applies both texts and the chat keeps its own value', async () => {
        await start()
        service.greetingSwapWithMain(A, 1)
        live().chats[0].fmIndex = 0
        expect(service.undo(A).ok).toBe(true)
        expect(live().firstMessage).toBe('M')
        expect(live().alternateGreetings).toEqual(['g0', 'g1', 'g2'])
        expect(live().chats[0].fmIndex).toBe(0)
    })

    test('B8s a context chat without a unique id: the swap op has chatId null, the chat moves by page index and undo notes fmNotRestored', async () => {
        await start(makeCharacter({ chats: [{ note: '', fmIndex: -1 }] }))
        service.greetingSwapWithMain(A, 2)
        expect(live().chats[0].fmIndex).toBe(2)
        expect(service.view(A).done[0].ops[2]).toMatchObject({ op: 'chatFm', chatId: null })
        expect(service.undo(A)).toMatchObject({ ok: true, fmNotRestored: true })
        expect(live().firstMessage).toBe('M')
        expect(live().alternateGreetings).toEqual(['g0', 'g1', 'g2'])
    })

    test('B5k a revert that nets a swap after a shape change: undo and redo of the revert both apply', async () => {
        await start(makeCharacter({ alternateGreetings: ['A', 'B', 'G'] }))
        service.editText(A, 'desc', 'base', 'single')
        const baseId = service.view(A).done[0].id
        service.greetingDelete(A, 0)
        service.greetingSwapWithMain(A, 1)
        expect(live().firstMessage).toBe('G')
        expect(live().alternateGreetings).toEqual(['B', 'M'])
        expect(service.revertTo(A, baseId).ok).toBe(true)
        expect(live().firstMessage).toBe('M')
        expect(live().alternateGreetings).toEqual(['A', 'B', 'G'])
        expect(service.undo(A).ok).toBe(true)
        expect(live().firstMessage).toBe('G')
        expect(live().alternateGreetings).toEqual(['B', 'M'])
        expect(service.redo(A).ok).toBe(true)
        expect(live().firstMessage).toBe('M')
        expect(live().alternateGreetings).toEqual(['A', 'B', 'G'])
    })

    test('B5a-revert an outside change to main: a revert across the swap refuses whole and live is unchanged', async () => {
        await start()
        service.editText(A, 'desc', 'base', 'single')
        const baseId = service.view(A).done[0].id
        service.greetingSwapWithMain(A, 1)
        live().firstMessage = 'outside'
        expect(service.revertTo(A, baseId)).toEqual({ ok: false, reason: 'pairSplit' })
        expect(live().firstMessage).toBe('outside')
        expect(live().alternateGreetings).toEqual(['g0', 'M', 'g2'])
        expect(live().chats[0].fmIndex).toBe(1)
    })

    test('F4 a revert across a swap with a chat follow restores the chat index, and undoing the revert puts it back', async () => {
        await start()
        service.editText(A, 'desc', 'base', 'single')
        const baseId = service.view(A).done[0].id
        service.greetingSwapWithMain(A, 1)
        expect(live().chats[0].fmIndex).toBe(1)
        expect(service.revertTo(A, baseId).ok).toBe(true)
        expect(live().firstMessage).toBe('M')
        expect(live().chats[0].fmIndex).toBe(-1)
        expect(shown()).toBe('M')
        expect(service.undo(A).ok).toBe(true)
        expect(live().firstMessage).toBe('g1')
        expect(live().chats[0].fmIndex).toBe(1)
    })

    test('rule K: a chat owner is refused for move, swap and append before any write', async () => {
        await start()
        const chat = chatOwnerKey('A', 'c1')
        await service.whenReady(chat)
        expect(service.greetingMove(chat, 0, 1)).toEqual({ ok: false, reason: 'precondition' })
        expect(service.greetingSwapWithMain(chat, 0)).toEqual({ ok: false, reason: 'precondition' })
        expect(service.greetingAppendMany(chat, ['x'])).toEqual({ ok: false, reason: 'precondition' })
        expect(live().alternateGreetings).toEqual(['g0', 'g1', 'g2'])
        expect(h.marks).toBe(0)
    })
})

describe('B7 and B7b: append-many and the stale pin', () => {
    test('B7 appends in order as one fingerprinted greetingAddMany step with the open chat unchanged; undo removes all', async () => {
        await start(makeCharacter({ chats: [{ id: 'c1', note: '', fmIndex: 1 }] }))
        expect(service.greetingAppendMany(A, ['a', 'b', 'c'])).toEqual({ ok: true })
        expect(live().alternateGreetings).toEqual(['g0', 'g1', 'g2', 'a', 'b', 'c'])
        expect(live().chats[0].fmIndex).toBe(1)
        const done = service.view(A).done
        expect(done.map((step) => step.label)).toEqual([{ kind: 'greetingAddMany', count: 3 }])
        expect(done[0].listFingerprint).toBeDefined()
        expect(service.undo(A).ok).toBe(true)
        expect(live().alternateGreetings).toEqual(['g0', 'g1', 'g2'])
    })

    test('B7 empty input is a precondition failure', async () => {
        await start()
        expect(service.greetingAppendMany(A, [])).toEqual({ ok: false, reason: 'precondition' })
        expect(service.view(A).done).toEqual([])
    })

    test('B7b a chat storing fmIndex at the length is pinned by the append, and undo restores the stored stale value', async () => {
        await start(makeCharacter({ chats: [{ id: 'c1', note: '', fmIndex: 3 }] }))
        expect(shown()).toBe('M')
        service.greetingAppendMany(A, ['a'])
        expect(live().chats[0].fmIndex).toBe(-1)
        expect(shown()).toBe('M')
        service.undo(A)
        expect(live().chats[0].fmIndex).toBe(3)
        expect(live().alternateGreetings).toEqual(['g0', 'g1', 'g2'])
    })

    test('B7b the single add pins the same way', async () => {
        await start(makeCharacter({ chats: [{ id: 'c1', note: '', fmIndex: 3 }] }))
        service.greetingAdd(A)
        expect(live().alternateGreetings).toEqual(['g0', 'g1', 'g2', ''])
        expect(live().chats[0].fmIndex).toBe(-1)
        expect(shown()).toBe('M')
        service.undo(A)
        expect(live().chats[0].fmIndex).toBe(3)
    })

    test('B7b without a unique chat id the pin goes by page index', async () => {
        await start(makeCharacter({ chats: [{ note: '', fmIndex: 3 }] }))
        service.greetingAppendMany(A, ['a'])
        expect(live().chats[0].fmIndex).toBe(-1)
    })
})
