// @vitest-environment jsdom
// The service's whole-value text edit (`editText`), the character text paths firstMessage, exampleMessage and
// customModuleToggle through undo, redo and the restore point, rule K before any write, and the refusal of an edit
// whose absent required key an undo could not put back.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DBState, selIdState } from 'src/ts/stores.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { createOwnerHistoryService, type OwnerHistoryService } from '../ownerHistory.svelte'
import { characterOwnerKey, chatOwnerKey, moduleOwnerKey, SAVE_DEBOUNCE_MS, type OwnerKey } from '../ownerPhase'
import { COALESCE_MS } from '../historyModel'
import { createFakeClock, type FakeClock } from './historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore, type ClaimDouble, type MemoryStudioStore, seedOwner } from './studioStoreDoubles'

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
    firstMessage?: string
    exampleMessage?: string
    customModuleToggle?: string
    hideChatIcon?: boolean
    alternateGreetings: string[]
    chats: LiveChat[]
    chatPage: number
}

function makeCharacter(chaId: string, overrides: Partial<LiveCharacter> = {}): LiveCharacter {
    return {
        chaId,
        desc: 'd0',
        firstMessage: 'f0',
        exampleMessage: 'e0',
        alternateGreetings: ['g0', 'g1', 'g2'],
        chats: [{ id: 'c1', note: 'n0', fmIndex: 2 }],
        chatPage: 0,
        ...overrides,
    }
}

function putCharacters(...characters: LiveCharacter[]): void {
    DBState.db.characters = characters as unknown as typeof DBState.db.characters
}

function live(): LiveCharacter {
    return (DBState.db.characters as unknown as LiveCharacter[])[0]
}

const A = characterOwnerKey('A')
const chatA = chatOwnerKey('A', 'c1')

interface Harness {
    clock: FakeClock
    store: MemoryStudioStore
    claim: ClaimDouble
    service: OwnerHistoryService
}

let harness: Harness

function build(shared?: Map<string, string>): Harness {
    const clock = createFakeClock()
    const store = createMemoryStudioStore({ shared })
    const claim = createClaimDouble()
    const service = createOwnerHistoryService({
        store,
        claim,
        clock,
        pageSession: 'p1',
        getVisitId: () => 'v1',
        registerLeaveFlush: () => () => {},
    })
    return { clock, store, claim, service }
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
    putCharacters(makeCharacter('A'))
    selIdState.selId = 0
    studioScreen.chaId = 'A'
    harness = build()
})

afterEach(() => {
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
})

const TEXT_PATHS = ['firstMessage', 'exampleMessage', 'customModuleToggle'] as const

describe('A4: editText writes through, marks once per write and coalesces under COALESCE_MS', () => {
    test('a first message edit sets the live field, marks once and records a field step', async () => {
        await ready()
        expect(harness.service.editText(A, 'firstMessage', 'typed')).toEqual({ ok: true })
        expect(live().firstMessage).toBe('typed')
        expect(h.marks).toBe(1)
        expect(harness.service.view(A).done.map((step) => step.label)).toEqual([{ kind: 'field', field: 'firstMessage' }])
    })

    test('three typing writes inside the window are one step with the first before and the last after', async () => {
        await ready()
        harness.service.editText(A, 'firstMessage', 'a')
        harness.clock.set(300)
        harness.service.editText(A, 'firstMessage', 'ab')
        harness.clock.set(600)
        harness.service.editText(A, 'firstMessage', 'abc')
        const done = harness.service.view(A).done
        expect(done).toHaveLength(1)
        expect(done[0].ops).toEqual([
            { op: 'set', path: 'firstMessage', before: { had: true, value: 'f0' }, after: { had: true, value: 'abc' } },
        ])
        expect(h.marks).toBe(3)
    })

    test('a single write after typing is a new step, and the next typing is another new step', async () => {
        await ready()
        harness.service.editText(A, 'firstMessage', 'a')
        harness.clock.set(100)
        harness.service.editText(A, 'firstMessage', 'ab', 'single')
        expect(harness.service.view(A).done).toHaveLength(2)
        harness.clock.set(200)
        harness.service.editText(A, 'firstMessage', 'abc')
        expect(harness.service.view(A).done).toHaveLength(3)
        harness.clock.set(300)
        harness.service.editText(A, 'firstMessage', 'abcd')
        expect(harness.service.view(A).done).toHaveLength(3)
    })

    test('two single writes inside the window stay two steps', async () => {
        await ready()
        harness.service.editText(A, 'exampleMessage', 'a', 'single')
        harness.clock.set(COALESCE_MS - 1)
        harness.service.editText(A, 'exampleMessage', 'ab', 'single')
        expect(harness.service.view(A).done).toHaveLength(2)
    })
})

describe('A5: editText refusals write nothing, mark nothing and record nothing', () => {
    async function expectRefusedClean(owner: OwnerKey, act: () => unknown, reason = 'precondition'): Promise<void> {
        await ready(owner)
        const before = JSON.stringify(DBState.db.characters)
        expect(act()).toEqual({ ok: false, reason })
        expect(JSON.stringify(DBState.db.characters)).toBe(before)
        expect(h.marks).toBe(0)
        expect(harness.service.view(owner).done).toEqual([])
    }

    test('a chat owner is refused for firstMessage and for hideChatIcon', async () => {
        await expectRefusedClean(chatA, () => harness.service.editText(chatA, 'firstMessage', 'x'))
        expect(harness.service.editText(chatA, 'hideChatIcon', 'x')).toEqual({ ok: false, reason: 'precondition' })
        expect(h.marks).toBe(0)
    })

    test('a character owner is refused for hideChatIcon and for note', async () => {
        await expectRefusedClean(A, () => harness.service.editText(A, 'hideChatIcon', 'x'))
        expect(harness.service.editText(A, 'note', 'x')).toEqual({ ok: false, reason: 'precondition' })
        expect(h.marks).toBe(0)
    })

    test('a chat owner is refused for desc even when the value equals the current one', async () => {
        await expectRefusedClean(chatA, () => harness.service.editText(chatA, 'desc', 'd0'))
    })

    test('a chat owner still edits its note', async () => {
        await ready(chatA)
        expect(harness.service.editText(chatA, 'note', 'about')).toEqual({ ok: true })
        expect(live().chats[0].note).toBe('about')
        expect(h.marks).toBe(1)
    })

    test('an unchanged value is ok with no step and no mark', async () => {
        await ready()
        expect(harness.service.editText(A, 'firstMessage', 'f0')).toEqual({ ok: true, unchanged: true })
        expect(h.marks).toBe(0)
        expect(harness.service.view(A).done).toEqual([])
    })
})

describe('E6: an edit of an absent required key is refused before any write', () => {
    test.each(['firstMessage', 'exampleMessage'] as const)('editText and editField of an absent %s give precondition with zero writes', async (path) => {
        putCharacters(makeCharacter('A', { [path]: undefined }))
        await ready()
        const before = JSON.stringify(DBState.db.characters)
        expect(harness.service.editText(A, path, 'x')).toEqual({ ok: false, reason: 'precondition' })
        expect(harness.service.editText(A, path, 'x', 'single')).toEqual({ ok: false, reason: 'precondition' })
        expect(harness.service.editField(A, path, 'x')).toEqual({ ok: false, reason: 'precondition' })
        expect(JSON.stringify(DBState.db.characters)).toBe(before)
        expect(h.marks).toBe(0)
        expect(harness.service.view(A).done).toEqual([])
        expect(harness.service.view(A).restore).toBeNull()
    })

    test('an absent customModuleToggle is an optional key: it may be created', async () => {
        await ready()
        expect(harness.service.editText(A, 'customModuleToggle', 'toggle')).toEqual({ ok: true })
        expect(live().customModuleToggle).toBe('toggle')
    })
})

describe('L-4: a stored set step never deletes a required key on undo', () => {
    // A stored step whose before says the key was absent can only come from another producer (the producer refuses an
    // absent required key), so it is seeded through the store rather than made by an edit.
    test.each(['firstMessage', 'exampleMessage'] as const)('undo of a stored set %s step with before had:false leaves the live key in place', async (path) => {
        const shared = new Map<string, string>()
        seedOwner(
            shared,
            {
                ownerKey: A,
                touchedAt: 1,
                done: [
                    {
                        id: 'p:1',
                        at: 1,
                        label: { kind: 'field', field: path },
                        ops: [{ op: 'set', path, before: { had: false }, after: { had: true, value: 'stored' } }],
                    },
                ],
                undone: [],
                deleted: [],
                restore: null,
            },
            'w:1',
        )
        putCharacters(makeCharacter('A', { [path]: 'stored' }))
        harness = build(shared)
        await ready()
        expect(harness.service.view(A).done).toHaveLength(1)
        harness.service.undo(A)
        expect(path in live()).toBe(true)
        expect(live()[path]).toBe('stored')
    })
})

describe('A6: undo, redo and the restore point bring each new field back', () => {
    test.each(TEXT_PATHS)('undo and redo of a %s step', async (path) => {
        await ready()
        const start = live()[path]
        expect(harness.service.editText(A, path, 'new', 'single')).toEqual({ ok: true })
        expect(live()[path]).toBe('new')
        expect(harness.service.undo(A).ok).toBe(true)
        if (start === undefined) {
            expect(path in live()).toBe(false)
        } else {
            expect(live()[path]).toBe(start)
        }
        expect(harness.service.redo(A).ok).toBe(true)
        expect(live()[path]).toBe('new')
    })

    test('the toggle step reads the live toggle, not another field: the stored before is the live value', async () => {
        putCharacters(makeCharacter('A', { customModuleToggle: 'on', hideChatIcon: true }))
        await ready()
        harness.service.editText(A, 'customModuleToggle', 'off')
        expect(harness.service.view(A).done[0].ops).toEqual([
            { op: 'set', path: 'customModuleToggle', before: { had: true, value: 'on' }, after: { had: true, value: 'off' } },
        ])
        expect(harness.service.undo(A).ok).toBe(true)
        expect(live().customModuleToggle).toBe('on')
        expect(live().hideChatIcon).toBe(true)
    })

    test('the restore point after editing desc, firstMessage and the toggle restores all of them, and survives a reload', async () => {
        await ready()
        harness.service.editText(A, 'desc', 'd1', 'single')
        harness.service.editText(A, 'firstMessage', 'f1', 'single')
        harness.service.editText(A, 'exampleMessage', 'e1', 'single')
        harness.service.editText(A, 'customModuleToggle', 't1', 'single')
        const restore = harness.service.view(A).restore
        expect(Object.keys(restore?.fields ?? {}).sort()).toEqual(['customModuleToggle', 'desc', 'exampleMessage', 'firstMessage'])
        await harness.clock.advance(SAVE_DEBOUNCE_MS)

        studioScreen.chaId = 'A'
        const reloaded = build(harness.store.shared)
        harness = reloaded
        await reloaded.service.whenReady(A)
        expect(Object.keys(reloaded.service.view(A).restore?.fields ?? {}).sort()).toEqual(['customModuleToggle', 'desc', 'exampleMessage', 'firstMessage'])
        expect(reloaded.service.restore(A, new Set()).ok).toBe(true)
        expect(live().desc).toBe('d0')
        expect(live().firstMessage).toBe('f0')
        expect(live().exampleMessage).toBe('e0')
        expect('customModuleToggle' in live()).toBe(false)
    })
})

describe('A7: every landed text write marks the character once, a refusal marks nothing', () => {
    test.each(TEXT_PATHS)('%s, typing and single', async (path) => {
        await ready()
        harness.service.editText(A, path, 'one')
        expect(h.marks).toBe(1)
        harness.service.editText(A, path, 'two', 'single')
        expect(h.marks).toBe(2)
        expect(tracker.character).toEqual(['A'])
        expect(harness.service.editText(A, path, 'two', 'single')).toEqual({ ok: true, unchanged: true })
        expect(h.marks).toBe(2)
    })
})

describe('K1: rule K refuses a build the owner could not read back, before any write', () => {
    async function expectNothingWritten(owner: OwnerKey, act: () => unknown, reason: string): Promise<void> {
        await ready(owner)
        const before = JSON.stringify(DBState.db.characters)
        expect(act()).toEqual({ ok: false, reason })
        expect(JSON.stringify(DBState.db.characters)).toBe(before)
        expect(h.marks).toBe(0)
        expect(tracker.character).toEqual([])
        expect(harness.service.view(owner).done).toEqual([])
    }

    test('a chat owner is refused every greeting intent with precondition', async () => {
        await expectNothingWritten(chatA, () => harness.service.greetingAdd(chatA), 'precondition')
        expect(harness.service.greetingEdit(chatA, 0, 'x')).toEqual({ ok: false, reason: 'precondition' })
        expect(harness.service.greetingDelete(chatA, 0)).toEqual({ ok: false, reason: 'precondition' })
        expect(JSON.stringify(live().alternateGreetings)).toBe(JSON.stringify(['g0', 'g1', 'g2']))
        expect(live().chats[0].fmIndex).toBe(2)
        expect(h.marks).toBe(0)
    })

    test('a chat owner is refused a character field edit with precondition', async () => {
        await expectNothingWritten(chatA, () => harness.service.editField(chatA, 'desc', 'x'), 'precondition')
        expect(live().desc).toBe('d0')
    })

    test('a module owner that is not open is refused by the early module refusal with zero writes', async () => {
        const module = moduleOwnerKey('m1')
        const before = JSON.stringify(DBState.db.characters)
        const results = [
            harness.service.greetingAdd(module),
            harness.service.greetingEdit(module, 0, 'x'),
            harness.service.greetingDelete(module, 0),
            harness.service.editText(module, 'desc', 'x'),
        ]
        for (const result of results) {
            expect(result.ok).toBe(false)
        }
        expect(JSON.stringify(DBState.db.characters)).toBe(before)
        expect(h.marks).toBe(0)
    })
})
