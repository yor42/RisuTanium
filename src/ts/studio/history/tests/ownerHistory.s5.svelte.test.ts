// @vitest-environment jsdom
// The module paths of Studio S5 through the real history service, history model and setters over the memory store
// double, on a reactive database with the real save-mark hook. The write lands under the property of its path, an
// absent key is deleted again by undo, a required key that was absent is created and deleted, a value stored in another
// type is put back by undo, and the keys a path does not own are never touched. The low-level flag is written with its
// confirm (the guard's own rows are in ownerHistory.s5Confirm.svelte.test.ts); a turn-on replay runs through the queued
// `replay` with the confirm, as the hosts run it.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({ marks: 0 }))

vi.mock('src/ts/globalApi.svelte', () => ({ getSaveMarkCount: () => h.marks }))
// The duplicate prompt of the import placement is never reached by a replace placement.
vi.mock('src/ts/alert', () => ({ alertSelect: vi.fn() }))

// Filled by `beforeEach`.
const db = $state({ db: { characters: [], modules: [] } as { characters: Record<string, unknown>[]; modules: Record<string, unknown>[] } })

vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return {
        get DBState() {
            return db
        },
        selIdState: { selId: 0 },
        MobileGUI: writable(false),
        settingsOpen: writable(false),
        clearCharEmotionCache: () => {},
    }
})

import { applyModulePlacement } from 'src/ts/process/moduleDuplicates'
import { matchesModuleRef } from 'src/ts/process/moduleRefs'
import type { RisuModule } from 'src/ts/process/modules'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import { installDbWriteHook, uninstallDbWriteHook } from 'src/ts/storage/dbWriteHook'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { stubModule } from 'src/ts/studio/studioFixtures.test-helpers'
import { classifyModules } from 'src/ts/studio/studioModules'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { buildWrittenModule, createModuleLiveReader } from '../../edit/studioSetters'
import { createOwnerHistoryService, type OwnerHistoryService } from '../ownerHistory.svelte'
import { characterOwnerKey, moduleOwnerKey, SAVE_DEBOUNCE_MS, type OwnerKey } from '../ownerPhase'
import { createFakeClock, drainMicrotasks, type FakeClock } from './historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore, type MemoryStudioStore } from './studioStoreDoubles'

type Obj = Record<string, unknown>

const M1 = moduleOwnerKey('M1')
const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }

// ---------------------------------------------------------------- fixtures, each shaped by its producer

// Create: `{name: '', description: '', id}` (ModuleSettings' new module).
const createShaped = (): Obj => ({ name: '', description: '', id: 'M1' })

// Replace-imported: the incoming module is a `.risum` body the classic editor wrote, placed by the import's own
// `applyModulePlacement` under the installed module's id. The classic editor writes `lowLevelAccess: false`.
function replaceImported(incoming: Obj): Obj {
    const rows = [createShaped()] as unknown as RisuModule[]
    applyModulePlacement(rows, incoming as unknown as RisuModule, { choice: 'replace', targetId: 'M1' })
    return rows[0] as unknown as Obj
}

// Nameless: an unvalidated import that has no `name` key, placed by the same call.
const nameless = (): Obj => replaceImported(JSON.parse('{"id":"zz","description":"d","lorebook":[],"trigger":[]}') as Obj)

// Converted: `convertCharacterToModule` copies an optional `creatorNotes` into `description` and the character's optional
// flags and namespace into their keys, so a character without them gives keys that are present and `undefined`.
const converted = (): Obj => ({ name: 'C', description: undefined, namespace: undefined, hideIcon: undefined, lowLevelAccess: undefined, backgroundEmbedding: '', id: 'M1' })

// Foreign-typed: the module object a `.risum` main block `{type: 'risuModule', module}` carries, holding values of other
// types than the editor writes. The import parses the block as JSON; the module is placed by the import's own placement.
const FOREIGN_BODY = '{"id":"zz","name":5,"description":"d","namespace":null,"hideIcon":{"x":1},"lowLevelAccess":1,"backgroundEmbedding":0}'
const foreignTyped = (): Obj => replaceImported(JSON.parse(FOREIGN_BODY) as Obj)

// Every key in the shape its own producer writes (the classic editor, convertCharacterToModule, the module asset list, the
// MCP import and the Studio asset write), plus one key a later build may write.
const everyKey = (): Obj => ({
    id: 'M1',
    name: 'Every',
    description: 'all keys',
    namespace: 'ns-every',
    hideIcon: false,
    lowLevelAccess: false,
    backgroundEmbedding: '<div>bg</div>',
    lorebook: [{ key: 'k', secondkey: '', insertorder: 100, comment: 'c', content: 'x', mode: 'normal', alwaysActive: false, selective: false }],
    regex: [{ comment: 'r', in: 'a', out: 'b', type: 'editinput' }],
    trigger: [{ comment: 't', type: 'start', conditions: [], effect: [], lowLevelAccess: false }],
    icon: 'icon.png',
    customModuleToggle: 'a=A',
    assets: [['smile', 'assets/smile.png', 'png']],
    cjs: 'return 1',
    mcp: { url: 'https://example.invalid/mcp' },
    risutanium_asset_folders: { v: 1, additional: { order: ['Faces'], of: [['smile', 'Faces']] } },
    risutanium_asset_retained: [['gone', 'assets/K.png']],
    x_upstream_future: { nested: [1] },
})

// ---------------------------------------------------------------- harness

interface Harness {
    clock: FakeClock
    store: MemoryStudioStore
    service: OwnerHistoryService
    openModule: string | null
    replaced: number
    noted: number
}

function build(shared?: Map<string, string>): Harness {
    const clock = createFakeClock()
    const store = createMemoryStudioStore(shared ? { shared } : {})
    const built: Harness = { clock, store, openModule: 'M1', replaced: 0, noted: 0, service: undefined as unknown as OwnerHistoryService }
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
    built.service.setModuleAck('M1', {
        noteEdit: () => {
            built.noted += 1
        },
    })
    return built
}

let harness: Harness
const put = (...modules: Obj[]): void => {
    db.db.modules = modules
}
const slot = (index = 0): Obj => db.db.modules[index]
const ready = (owner: OwnerKey = M1): Promise<void> => harness.service.whenReady(owner)
const text = (path: 'moduleName' | 'moduleDescription' | 'moduleNamespace' | 'backgroundEmbedding', value: string, mode: 'typing' | 'single' = 'single') =>
    harness.service.editText(M1, path, value, mode)
const flag = (value: boolean) => harness.service.editField(M1, 'moduleHideIcon', value)
const keyed = (key: string): boolean => Object.hasOwn(slot(), key)

beforeEach(() => {
    h.marks = 0
    tracker.character.length = 0
    tracker.modules = false
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => {} })
    resetStudioScreenForTests()
    db.db = { characters: [], modules: [createShaped()] }
    installDbWriteHook(db, { selectedChaId: () => null })
    harness = build()
})

afterEach(() => {
    uninstallDbWriteHook()
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
})

describe('T5-PROP: a write lands under the property of its path, never a key named after the path', () => {
    test.each([
        ['moduleName', 'name'],
        ['moduleDescription', 'description'],
        ['moduleNamespace', 'namespace'],
        ['backgroundEmbedding', 'backgroundEmbedding'],
    ] as const)('%s writes %s', async (path, property) => {
        await ready()
        expect(text(path, 'V')).toEqual({ ok: true })
        expect(slot()[property]).toBe('V')
        if (path !== property) {
            expect(keyed(path)).toBe(false)
        }
    })

    test('moduleHideIcon writes hideIcon', async () => {
        await ready()
        expect(flag(true)).toEqual({ ok: true })
        expect(slot().hideIcon).toBe(true)
        expect(keyed('moduleHideIcon')).toBe(false)
    })

    test('moduleLowLevelAccess writes lowLevelAccess', async () => {
        await ready()
        expect(harness.service.editField(M1, 'moduleLowLevelAccess', true, 'lowLevelOn')).toEqual({ ok: true })
        expect(slot().lowLevelAccess).toBe(true)
        expect(keyed('moduleLowLevelAccess')).toBe(false)
    })
})

describe('T5-ABS: an absent key is deleted again by undo; a present false comes back as false', () => {
    test('namespace and hideIcon on a create-shaped module', async () => {
        await ready()
        expect(keyed('namespace')).toBe(false)
        expect(text('moduleNamespace', 'ns')).toEqual({ ok: true })
        expect(flag(true)).toEqual({ ok: true })
        expect(harness.service.undo(M1)).toMatchObject({ ok: true })
        expect(keyed('hideIcon')).toBe(false)
        expect(harness.service.undo(M1)).toMatchObject({ ok: true })
        expect(keyed('namespace')).toBe(false)
        expect(slot()).toEqual(createShaped())
        expect(harness.service.redo(M1)).toMatchObject({ ok: true })
        expect(slot().namespace).toBe('ns')
    })

    test('a module that held hideIcon false gets false back, not a deleted key', async () => {
        put({ ...createShaped(), hideIcon: false })
        await ready()
        expect(flag(true)).toEqual({ ok: true })
        expect(harness.service.undo(M1)).toMatchObject({ ok: true })
        expect(keyed('hideIcon')).toBe(true)
        expect(slot().hideIcon).toBe(false)
    })

    test('lowLevelAccess on a create-shaped module: the confirmed turn-on is deleted again by undo, never undefined or false', async () => {
        await ready()
        expect(keyed('lowLevelAccess')).toBe(false)
        expect(harness.service.editField(M1, 'moduleLowLevelAccess', true, 'lowLevelOn')).toEqual({ ok: true })
        expect(slot().lowLevelAccess).toBe(true)
        expect(harness.service.undo(M1)).toMatchObject({ ok: true })
        expect(keyed('lowLevelAccess')).toBe(false)
        expect(slot()).toEqual(createShaped())
    })

    test('lowLevelAccess on a module holding false: undo of the turn-on restores false', async () => {
        put({ ...createShaped(), lowLevelAccess: false })
        await ready()
        expect(harness.service.editField(M1, 'moduleLowLevelAccess', true, 'lowLevelOn')).toEqual({ ok: true })
        expect(harness.service.undo(M1)).toMatchObject({ ok: true })
        expect(keyed('lowLevelAccess')).toBe(true)
        expect(slot().lowLevelAccess).toBe(false)
    })
})

describe('T5-REQ: a required key that was absent is created by the edit and deleted by undo', () => {
    test('a nameless module', async () => {
        put(nameless())
        await ready()
        expect(keyed('name')).toBe(false)
        expect(text('moduleName', 'N')).toEqual({ ok: true })
        expect(slot().name).toBe('N')
        expect(harness.service.undo(M1)).toMatchObject({ ok: true })
        expect(keyed('name')).toBe(false)
        expect(harness.service.redo(M1)).toMatchObject({ ok: true })
        expect(slot().name).toBe('N')
    })

    test('a converted module whose description is undefined: the stored form is absent, so undo deletes the key', async () => {
        put(converted())
        await ready()
        expect(text('moduleDescription', 'D')).toEqual({ ok: true })
        expect(slot().description).toBe('D')
        expect(harness.service.undo(M1)).toMatchObject({ ok: true })
        expect(keyed('description')).toBe(false)
    })

    test('positive control: a module holding a name gets it back', async () => {
        put({ ...createShaped(), name: 'A' })
        await ready()
        expect(text('moduleName', 'B')).toEqual({ ok: true })
        expect(harness.service.undo(M1)).toMatchObject({ ok: true })
        expect(slot().name).toBe('A')
    })
})

describe('T5-FOREIGN-UNDO: an undo puts back the exact stored value of another type', () => {
    const cases: [string, 'moduleName' | 'moduleNamespace' | 'backgroundEmbedding', string, unknown][] = [
        ['name', 'moduleName', 'name', 5],
        ['namespace', 'moduleNamespace', 'namespace', null],
        ['backgroundEmbedding', 'backgroundEmbedding', 'backgroundEmbedding', 0],
    ]

    test.each(cases)('%s: edit, undo (stored value back), redo (typed value again)', async (_label, path, property, original) => {
        put(foreignTyped())
        await ready()
        expect(text(path, 'T')).toEqual({ ok: true })
        expect(slot()[property]).toBe('T')
        expect(harness.service.undo(M1)).toMatchObject({ ok: true })
        expect(slot()[property]).toEqual(original)
        expect(keyed(property)).toBe(true)
        expect(harness.service.redo(M1)).toMatchObject({ ok: true })
        expect(slot()[property]).toBe('T')
    })

    test('hideIcon holding an object: the object comes back deep-equal', async () => {
        put(foreignTyped())
        await ready()
        expect(flag(false)).toEqual({ ok: true })
        expect(slot().hideIcon).toBe(false)
        expect(harness.service.undo(M1)).toMatchObject({ ok: true })
        expect(slot().hideIcon).toEqual({ x: 1 })
        const recordedBefore = (): unknown => (harness.service.view(M1).undone[0].ops[0] as { before: unknown }).before
        expect(recordedBefore()).toEqual({ had: 'foreign', value: { x: 1 } })
        expect(harness.service.redo(M1)).toMatchObject({ ok: true })
        expect(slot().hideIcon).toBe(false)
    })

    test('lowLevelAccess holding 1: the turn-off is undone by a confirmed replay that writes 1 back, and redo writes false again', async () => {
        put(foreignTyped())
        await ready()
        expect(harness.service.editField(M1, 'moduleLowLevelAccess', false)).toEqual({ ok: true })
        expect(slot().lowLevelAccess).toBe(false)
        const refused = await harness.service.replay(M1, { kind: 'undo' })
        expect(refused).toMatchObject({ ok: false, reason: 'confirm-low-level' })
        expect(slot().lowLevelAccess).toBe(false)
        expect(await harness.service.replay(M1, { kind: 'undo', expectTop: (refused as { expectTop?: string }).expectTop, confirm: 'lowLevelOn' })).toMatchObject({ ok: true })
        expect(slot().lowLevelAccess).toBe(1)
        expect(keyed('lowLevelAccess')).toBe(true)
        expect(await harness.service.replay(M1, { kind: 'redo' })).toMatchObject({ ok: true })
        expect(slot().lowLevelAccess).toBe(false)
    })

    test('the module writer assigns a fresh plain copy of a foreign value, never the record\'s own object, and a foreign write is never a delete', () => {
        const stored = { x: 1, nested: [1, { y: 2 }] }
        const live = { id: 'M1', name: 'N', hideIcon: false } as unknown as RisuModule
        const next = buildWrittenModule(live, [{ op: 'set', path: 'moduleHideIcon', value: { had: 'foreign', value: stored } }], { folder: { kind: 'keep' }, retained: null })
        expect(next.hideIcon).toEqual(stored)
        expect(next.hideIcon).not.toBe(stored)
        expect((next.hideIcon as unknown as { nested: unknown }).nested).not.toBe(stored.nested)
        expect(live.hideIcon).toBe(false)
        const nulled = buildWrittenModule(live, [{ op: 'set', path: 'moduleNamespace', value: { had: 'foreign', value: null } }], { folder: { kind: 'keep' }, retained: null })
        expect(Object.hasOwn(nulled, 'namespace')).toBe(true)
        expect(nulled.namespace).toBeNull()
    })
    test('the pair survives a save and a reload of the record (a JSON round trip)', async () => {
        put(foreignTyped())
        await ready()
        expect(text('moduleNamespace', 'T')).toEqual({ ok: true })
        expect(flag(false)).toEqual({ ok: true })
        harness.clock.tick(SAVE_DEBOUNCE_MS + 1)
        await drainMicrotasks()

        harness = build(harness.store.shared)
        await ready()
        expect(harness.service.view(M1).done).toHaveLength(2)
        expect(harness.service.undo(M1)).toMatchObject({ ok: true })
        expect(slot().hideIcon).toEqual({ x: 1 })
        expect(harness.service.undo(M1)).toMatchObject({ ok: true })
        expect(slot().namespace).toBeNull()
        expect(harness.service.redo(M1)).toMatchObject({ ok: true })
        expect(slot().namespace).toBe('T')
    })

    test('the module reader reports each stored form: foreign for another type, absent for undefined, typed for the path\'s type', () => {
        const reader = createModuleLiveReader(foreignTyped() as unknown as RisuModule)
        expect(reader.field('moduleName')).toEqual({ had: 'foreign', value: 5 })
        expect(reader.field('moduleNamespace')).toEqual({ had: 'foreign', value: null })
        expect(reader.field('moduleHideIcon')).toEqual({ had: 'foreign', value: { x: 1 } })
        expect(reader.field('moduleLowLevelAccess')).toEqual({ had: 'foreign', value: 1 })
        expect(reader.field('backgroundEmbedding')).toEqual({ had: 'foreign', value: 0 })
        expect(reader.field('moduleDescription')).toEqual({ had: true, value: 'd' })
        const absent = createModuleLiveReader(converted() as unknown as RisuModule)
        expect(absent.field('moduleDescription')).toEqual({ had: false })
        expect(absent.field('moduleHideIcon')).toEqual({ had: false })
    })
})

describe('T5-FOREIGN-SCOPE: a character path never records a foreign reading', () => {
    test('a character holding hideChatIcon 1: the edit records before absent, as before', async () => {
        db.db.characters = [{ chaId: 'c1', name: 'c1', desc: 'd', hideChatIcon: 1, chats: [], chatPage: 0 }]
        studioScreen.chaId = 'c1'
        const character = characterOwnerKey('c1')
        await harness.service.whenReady(character)
        expect(harness.service.editField(character, 'hideChatIcon', false)).toEqual({ ok: true })
        expect(harness.service.view(character).done[0].ops).toEqual([
            { op: 'set', path: 'hideChatIcon', before: { had: false }, after: { had: true, value: false } },
        ])
        expect(JSON.stringify(harness.service.view(character))).not.toContain('foreign')
    })
})

describe('T5-SLOT: a write is refused with nothing written or marked when the slot cannot take it', () => {
    // The placement of the fixture marks the modules list itself; the checks look at what the refused write adds.
    beforeEach(() => {
        tracker.modules = false
    })

    function unchanged(before: string): void {
        expect(JSON.stringify(db.db.modules)).toBe(before)
        expect(harness.replaced).toBe(0)
        expect(harness.noted).toBe(0)
        expect(tracker.modules).toBe(false)
    }

    test('a stub slot', async () => {
        put(stubModule('M1') as unknown as Obj)
        await ready()
        tracker.modules = false
        const before = JSON.stringify(db.db.modules)
        expect(text('moduleName', 'N')).toEqual({ ok: false, reason: 'gone' })
        unchanged(before)
    })

    test('two slots sharing the id', async () => {
        put(createShaped(), { ...createShaped(), name: 'second' })
        tracker.modules = false
        const before = JSON.stringify(db.db.modules)
        expect(text('moduleName', 'N')).toEqual({ ok: false, reason: 'duplicate-module-id' })
        expect(flag(true)).toEqual({ ok: false, reason: 'duplicate-module-id' })
        unchanged(before)
    })

    test('a module that is not the open one', async () => {
        harness.openModule = 'M2'
        const before = JSON.stringify(db.db.modules)
        expect(text('moduleName', 'N')).toEqual({ ok: false, reason: 'not-selected' })
        unchanged(before)
    })
})

describe('T5-MARK: a landed edit replaces exactly one slot and the save machinery is told', () => {
    test('one slot replacement, the modules marked dirty, the module ack noted', async () => {
        put(createShaped(), { ...createShaped(), id: 'M2' })
        await ready()
        const old = slot()
        const other = slot(1)
        tracker.modules = false
        expect(text('moduleName', 'N')).toEqual({ ok: true })
        expect(slot()).not.toBe(old)
        expect(slot(1)).toBe(other)
        expect(old.name).toBe('')
        expect(harness.replaced).toBe(1)
        expect(tracker.modules).toBe(true)
        expect(harness.noted).toBe(1)
    })
})

describe('T5-KEYS: a write keeps every key its path does not own', () => {
    const paths: [string, () => unknown][] = [
        ['moduleName', () => text('moduleName', 'X')],
        ['moduleDescription', () => text('moduleDescription', 'X')],
        ['moduleNamespace', () => text('moduleNamespace', 'X')],
        ['moduleHideIcon', () => flag(true)],
        ['backgroundEmbedding', () => text('backgroundEmbedding', 'X')],
    ]
    const OWNED: Record<string, string> = {
        moduleName: 'name',
        moduleDescription: 'description',
        moduleNamespace: 'namespace',
        moduleHideIcon: 'hideIcon',
        backgroundEmbedding: 'backgroundEmbedding',
    }

    test.each(paths)('%s: edit, undo and redo leave the other keys deep-equal, and arrays and objects keep their reference', async (path, act) => {
        put(everyKey())
        await ready()
        const original = JSON.parse(JSON.stringify(slot())) as Obj
        const owned = OWNED[path]
        const check = (previous: Obj): void => {
            const next = slot()
            for (const key of Object.keys(original)) {
                if (key === owned) {
                    continue
                }
                expect(next[key], `${path} ${key}`).toEqual(original[key])
                if (typeof previous[key] === 'object' && previous[key] !== null) {
                    expect(next[key], `${path} ${key} reference`).toBe(previous[key])
                }
            }
            expect(next.x_upstream_future).toEqual({ nested: [1] })
        }
        let previous = slot()
        expect(act()).toMatchObject({ ok: true })
        check(previous)
        previous = slot()
        expect(harness.service.undo(M1)).toMatchObject({ ok: true })
        check(previous)
        previous = slot()
        expect(harness.service.redo(M1)).toMatchObject({ ok: true })
        check(previous)
    })
})

describe('T5-KEYS: the low-level flag', () => {
    test('edit, undo and redo of moduleLowLevelAccess leave the other keys deep-equal and keep their references', async () => {
        put(everyKey())
        await ready()
        const original = JSON.parse(JSON.stringify(slot())) as Obj
        const check = (previous: Obj): void => {
            const next = slot()
            for (const key of Object.keys(original)) {
                if (key === 'lowLevelAccess') {
                    continue
                }
                expect(next[key], key).toEqual(original[key])
                if (typeof previous[key] === 'object' && previous[key] !== null) {
                    expect(next[key], `${key} reference`).toBe(previous[key])
                }
            }
            expect(next.x_upstream_future).toEqual({ nested: [1] })
        }
        let previous = slot()
        expect(harness.service.editField(M1, 'moduleLowLevelAccess', true, 'lowLevelOn')).toEqual({ ok: true })
        check(previous)
        previous = slot()
        expect(harness.service.undo(M1)).toMatchObject({ ok: true })
        check(previous)
        previous = slot()
        expect(await harness.service.replay(M1, { kind: 'redo', confirm: 'lowLevelOn' })).toMatchObject({ ok: true })
        check(previous)
        expect(slot().lowLevelAccess).toBe(true)
    })
})

describe('T5-NS: a namespace change moves the module in and out of the active set', () => {
    const classify = (): { active: string[] } => {
        const rows = db.db.modules as unknown as RisuModule[]
        const lister = (ids: string[]): RisuModule[] => rows.filter((row) => matchesModuleRef(row, new Set(ids)))
        const result = classifyModules(
            { enabledModules: undefined, chat: null, character: null, persona: null, moduleIntergration: 'ns1, other' },
            rows,
            lister,
        )
        return { active: result.active.map((row) => row.module.id) }
    }

    test('a listed namespace makes the module active, a change away removes it, and undo returns it', async () => {
        await ready()
        expect(classify().active).toEqual([])
        expect(text('moduleNamespace', 'ns1')).toEqual({ ok: true })
        expect(classify().active).toEqual(['M1'])
        expect(text('moduleNamespace', 'zz')).toEqual({ ok: true })
        expect(classify().active).toEqual([])
        expect(harness.service.undo(M1)).toMatchObject({ ok: true })
        expect(classify().active).toEqual(['M1'])
        expect(harness.service.undo(M1)).toMatchObject({ ok: true })
        expect(classify().active).toEqual([])
    })
})
