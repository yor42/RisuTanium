// @vitest-environment jsdom
// The module owner's text intent for `customModuleToggle` through the real history service, the real history model and
// the real setters over the memory store double: the write lands on the addressed module row only, undo, redo, revert
// and the restore point put the value back (an absent key included), coalescing follows the character rules, and every
// other module intent stays refused with the reasons pinned. The page database is a plain object.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DBState } from 'src/ts/stores.svelte'
import { resetStudioScreenForTests } from 'src/ts/studio/studioScreen.svelte'
import { stubModule } from 'src/ts/studio/studioFixtures.test-helpers'
import { createOwnerHistoryService, type OwnerHistoryService, type StudioResult } from '../ownerHistory.svelte'
import { moduleOwnerKey, SAVE_DEBOUNCE_MS, type OwnerKey } from '../ownerPhase'
import { createFakeClock, drainMicrotasks, type FakeClock } from './historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore, type MemoryStudioStore } from './studioStoreDoubles'

const h = vi.hoisted(() => ({ marks: 0 }))

vi.mock('src/ts/globalApi.svelte', () => ({ getSaveMarkCount: () => h.marks }))
vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return {
        DBState: { db: { characters: [], modules: [] } },
        selIdState: { selId: 0 },
        MobileGUI: writable(false),
        settingsOpen: writable(false),
        clearCharEmotionCache: () => {},
    }
})

interface LiveModule {
    id: string
    name: string
    description?: string
    customModuleToggle?: string
    assets: string[][]
}

const M1 = moduleOwnerKey('M1')

function makeModule(id: string, over: Partial<LiveModule> = {}): LiveModule {
    return { id, name: id, assets: [['smile', 'assets/smile.png', 'png']], ...over }
}

function putModules(...modules: unknown[]): void {
    DBState.db.modules = modules as unknown as typeof DBState.db.modules
}

function putCharacter(): void {
    DBState.db.characters = [{ chaId: 'c1', name: 'c1', desc: 'resident desc', customModuleToggle: 'c=C' }] as unknown as typeof DBState.db.characters
}

const charactersJson = (): string => JSON.stringify(DBState.db.characters)

const rows = (): LiveModule[] => DBState.db.modules as unknown as LiveModule[]
const slot = (index = 0): LiveModule => rows()[index]

interface Harness {
    clock: FakeClock
    store: MemoryStudioStore
    service: OwnerHistoryService
    openModule: string | null
    replaced: number
}

function build(shared?: Map<string, string>): Harness {
    const clock = createFakeClock()
    const store = createMemoryStudioStore(shared ? { shared } : {})
    const built: Harness = { clock, store, openModule: 'M1', replaced: 0, service: undefined as unknown as OwnerHistoryService }
    built.service = createOwnerHistoryService({
        store,
        claim: createClaimDouble(),
        clock,
        pageSession: 'p1',
        getVisitId: () => 'v1',
        getMarkCount: () => h.marks,
        registerLeaveFlush: () => () => {},
        openModuleId: () => built.openModule,
        onModuleSlotReplaced: () => {
            built.replaced += 1
        },
    })
    return built
}

let harness: Harness

beforeEach(() => {
    h.marks = 0
    resetStudioScreenForTests()
    putModules(makeModule('M1', { customModuleToggle: 'a=A' }), makeModule('M2', { customModuleToggle: 'm2=2' }))
    putCharacter()
    harness = build()
})

afterEach(() => {
    resetStudioScreenForTests()
})

const ready = (owner: OwnerKey = M1): Promise<void> => harness.service.whenReady(owner)
const edit = (value: string, mode: 'typing' | 'single' = 'single'): StudioResult => harness.service.editText(M1, 'customModuleToggle', value, mode)

describe('C1: a module toggle text edit lands on the addressed module row only', () => {
    test('the slot becomes a new object with the text, the old object stays, undo and redo each replace the slot', async () => {
        await ready()
        const old = slot()
        const other = slot(1)
        const characters = charactersJson()
        expect(edit('a=B')).toEqual({ ok: true })
        expect(charactersJson()).toBe(characters)
        expect(slot()).not.toBe(old)
        expect(slot().customModuleToggle).toBe('a=B')
        expect(old.customModuleToggle).toBe('a=A')
        expect(slot(1)).toBe(other)
        expect(harness.replaced).toBe(1)

        const landed = slot()
        expect(harness.service.undo(M1)).toMatchObject({ ok: true })
        expect(slot()).not.toBe(landed)
        expect(slot().customModuleToggle).toBe('a=A')
        expect(charactersJson()).toBe(characters)
        expect(harness.service.redo(M1)).toMatchObject({ ok: true })
        expect(slot().customModuleToggle).toBe('a=B')
        expect(charactersJson()).toBe(characters)
        expect(slot(1)).toBe(other)
        expect(harness.replaced).toBe(3)
    })

    test('a module write addresses the row by id even when the slot is not the first', async () => {
        putModules(makeModule('M2', { customModuleToggle: 'm2=2' }), makeModule('M1', { customModuleToggle: 'a=A' }))
        await ready()
        expect(edit('a=B')).toEqual({ ok: true })
        expect(slot(0).customModuleToggle).toBe('m2=2')
        expect(slot(1).customModuleToggle).toBe('a=B')
        expect(harness.service.undo(M1)).toMatchObject({ ok: true })
        expect(slot(0).customModuleToggle).toBe('m2=2')
        expect(slot(1).customModuleToggle).toBe('a=A')
    })
})

describe('C1u: the current text is unchanged', () => {
    test('nothing is written, replaced or recorded', async () => {
        await ready()
        const before = slot()
        expect(edit('a=A')).toEqual({ ok: true, unchanged: true })
        expect(slot()).toBe(before)
        expect(harness.replaced).toBe(0)
        expect(harness.service.view(M1).done).toHaveLength(0)
    })
})

describe('C2: every other module intent stays refused, with the reason pinned and nothing written', () => {
    test('a text path the module does not carry is refused as a precondition', async () => {
        await ready()
        const before = JSON.stringify(DBState.db.modules)
        for (const path of ['desc', 'firstMessage', 'exampleMessage', 'hideChatIcon'] as const) {
            expect(harness.service.editText(M1, path, 'x', 'single'), path).toEqual({ ok: false, reason: 'precondition' })
        }
        expect(JSON.stringify(DBState.db.modules)).toBe(before)
        expect(harness.replaced).toBe(0)
        expect(harness.service.view(M1).done).toHaveLength(0)
    })

    test('a field edit on a path outside the module row is refused as a precondition (T5-C2, amended on purpose: it was gone)', async () => {
        await ready()
        const before = JSON.stringify(DBState.db.modules)
        expect(harness.service.editField(M1, 'desc', 'x')).toEqual({ ok: false, reason: 'precondition' })
        expect(JSON.stringify(DBState.db.modules)).toBe(before)
        expect(harness.replaced).toBe(0)
        expect(harness.service.view(M1).done).toHaveLength(0)
    })

    test('greeting intents have no character target and are refused as gone', async () => {
        await ready()
        const before = JSON.stringify(DBState.db.modules)
        const results: [string, StudioResult][] = [
            ['greetingAdd', harness.service.greetingAdd(M1)],
            ['greetingEdit', harness.service.greetingEdit(M1, 0, 'x')],
            ['greetingDelete', harness.service.greetingDelete(M1, 0)],
        ]
        for (const [name, result] of results) {
            expect(result, name).toEqual({ ok: false, reason: 'gone' })
        }
        expect(JSON.stringify(DBState.db.modules)).toBe(before)
        expect(harness.replaced).toBe(0)
        expect(harness.service.view(M1).done).toHaveLength(0)
    })
})

describe('T5-PLAN: a module field edit needs no character target', () => {
    test('a module field edit lands without a character target: one slot replacement, one step, undo deletes the key', async () => {
        putModules(makeModule('M1'))
        await ready()
        const old = slot()
        expect(harness.service.editField(M1, 'customModuleToggle', 'a=A')).toEqual({ ok: true })
        expect(slot()).not.toBe(old)
        expect(slot().customModuleToggle).toBe('a=A')
        expect(harness.replaced).toBe(1)
        expect(harness.service.view(M1).done).toHaveLength(1)
        expect(harness.service.undo(M1)).toMatchObject({ ok: true })
        expect('customModuleToggle' in slot()).toBe(false)
    })
})

describe('T5-PLAN-S (b, c): a field edit outside the owner row is refused before the build', () => {
    test('a chat owner editing the character\'s current desc is a precondition, not unchanged', async () => {
        DBState.db.characters = [{ chaId: 'c1', name: 'c1', desc: 'resident desc', chats: [{ id: 'chat1', name: 'x', message: [], note: '' }], chatPage: 0 }] as unknown as typeof DBState.db.characters
        const { chatOwnerKey } = await import('../ownerPhase')
        const { studioScreen } = await import('src/ts/studio/studioScreen.svelte')
        studioScreen.chaId = 'c1'
        const chat = chatOwnerKey('c1', 'chat1')
        await harness.service.whenReady(chat)
        const before = JSON.stringify(DBState.db.characters)
        expect(harness.service.editField(chat, 'desc', 'resident desc')).toEqual({ ok: false, reason: 'precondition' })
        expect(JSON.stringify(DBState.db.characters)).toBe(before)
        expect(harness.replaced).toBe(0)
        expect(harness.service.view(chat).done).toHaveLength(0)
    })

    test('(c) a character owner editing a chat path is a precondition', async () => {
        DBState.db.characters = [{ chaId: 'c1', name: 'c1', desc: 'resident desc', chats: [], chatPage: 0 }] as unknown as typeof DBState.db.characters
        const { characterOwnerKey } = await import('../ownerPhase')
        const { studioScreen } = await import('src/ts/studio/studioScreen.svelte')
        studioScreen.chaId = 'c1'
        const character = characterOwnerKey('c1')
        await harness.service.whenReady(character)
        const before = JSON.stringify(DBState.db.characters)
        expect(harness.service.editField(character, 'note', 'x')).toEqual({ ok: false, reason: 'precondition' })
        expect(JSON.stringify(DBState.db.characters)).toBe(before)
    })
})
describe('C3: an absent key is created by the first edit and deleted again by undo', () => {
    test('undo deletes the key and redo creates it', async () => {
        putModules(makeModule('M1'))
        await ready()
        expect('customModuleToggle' in slot()).toBe(false)
        expect(edit('a=A')).toEqual({ ok: true })
        expect(slot().customModuleToggle).toBe('a=A')
        expect(harness.service.undo(M1)).toMatchObject({ ok: true })
        expect('customModuleToggle' in slot()).toBe(false)
        expect(harness.service.redo(M1)).toMatchObject({ ok: true })
        expect(slot().customModuleToggle).toBe('a=A')
    })

    test('an empty text on a present key is written as the empty string, not deleted', async () => {
        await ready()
        expect(edit('')).toEqual({ ok: true })
        expect(slot().customModuleToggle).toBe('')
        expect('customModuleToggle' in slot()).toBe(true)
    })
})

describe('C4: the restore point and a reload carry the toggle', () => {
    test('restore with nothing kept returns the toggle, and the view lists exactly that field', async () => {
        await ready()
        expect(edit('a=B')).toEqual({ ok: true })
        expect(edit('a=C')).toEqual({ ok: true })
        expect(Object.keys(harness.service.view(M1).restore?.fields ?? {})).toEqual(['customModuleToggle'])
        const characters = charactersJson()
        expect(harness.service.restore(M1, new Set())).toMatchObject({ ok: true })
        expect(slot().customModuleToggle).toBe('a=A')
        expect(charactersJson()).toBe(characters)
    })

    test('a record saved through the store reads back and still undoes', async () => {
        await ready()
        expect(edit('a=B')).toEqual({ ok: true })
        harness.clock.tick(SAVE_DEBOUNCE_MS + 1)
        await drainMicrotasks()

        const next = build(harness.store.shared)
        harness = next
        await ready()
        const view = harness.service.view(M1)
        expect(view.done).toHaveLength(1)
        expect(view.done[0].label).toEqual({ kind: 'field', field: 'customModuleToggle' })
        expect(Object.keys(view.restore?.fields ?? {})).toEqual(['customModuleToggle'])
        expect(harness.service.undo(M1)).toMatchObject({ ok: true })
        expect(slot().customModuleToggle).toBe('a=A')
    })
})

describe('C6: typing coalesces and a single write is its own step', () => {
    test('three typing writes inside the window make one step whose before is the first value, and a revert to it keeps that step', async () => {
        await ready()
        expect(edit('a=B', 'typing')).toEqual({ ok: true })
        harness.clock.tick(100)
        expect(edit('a=BC', 'typing')).toEqual({ ok: true })
        harness.clock.tick(100)
        expect(edit('a=BCD', 'typing')).toEqual({ ok: true })
        const done = harness.service.view(M1).done
        expect(done).toHaveLength(1)
        expect(done[0].ops).toEqual([
            { op: 'set', path: 'customModuleToggle', before: { had: true, value: 'a=A' }, after: { had: true, value: 'a=BCD' } },
        ])

        expect(edit('a=Z', 'single')).toEqual({ ok: true })
        expect(harness.service.view(M1).done).toHaveLength(2)
        expect(harness.service.revertTo(M1, done[0].id)).toMatchObject({ ok: true })
        expect(slot().customModuleToggle).toBe('a=BCD')
    })
})

describe('C9: a module that is not the open one, a shared id or a stub is refused with nothing written', () => {
    test('another module is open: not-selected', async () => {
        harness.openModule = 'M2'
        const before = JSON.stringify(DBState.db.modules)
        expect(edit('a=B')).toEqual({ ok: false, reason: 'not-selected' })
        expect(JSON.stringify(DBState.db.modules)).toBe(before)
        expect(harness.replaced).toBe(0)
    })

    test('two resident slots with one id: duplicate-module-id', async () => {
        putModules(makeModule('M1', { customModuleToggle: 'a=A' }), makeModule('M1', { customModuleToggle: 'b=B' }))
        const before = JSON.stringify(DBState.db.modules)
        expect(edit('a=C')).toEqual({ ok: false, reason: 'duplicate-module-id' })
        expect(harness.service.undo(M1)).toEqual({ ok: false, reason: 'duplicate-module-id' })
        expect(JSON.stringify(DBState.db.modules)).toBe(before)
        expect(harness.replaced).toBe(0)
    })

    test('a stub slot: gone', async () => {
        putModules(stubModule('M1'))
        await ready()
        expect(edit('a=B')).toEqual({ ok: false, reason: 'gone' })
        expect(harness.replaced).toBe(0)
    })
})
