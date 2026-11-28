// @vitest-environment jsdom
// The regex field builders through the real owner history service (memory store, fake clock, a character owner and a
// module owner): what a field edit keeps, the custom-flag step and its undo, the module write, and the refusals the
// builders decide (an unreadable row, a list a JSON-shaped store would change). Entries are built like the producers
// write them: the classic add shape, the `RegexData` shape and an upstream entry with an unknown key; malformed lists
// come out of the real `importRegex` over the file bytes the classic import button reads.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DBState, selIdState } from 'src/ts/stores.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { MODULE_STUB_KEY, MODULE_STUB_VALUE } from 'src/ts/storage/moduleStub'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { COALESCE_MS } from 'src/ts/studio/history/historyModel'
import { createOwnerHistoryService, type OwnerHistoryService } from 'src/ts/studio/history/ownerHistory.svelte'
import { characterOwnerKey, moduleOwnerKey, type OwnerKey } from 'src/ts/studio/history/ownerPhase'
import { createFakeClock, type FakeClock } from 'src/ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from 'src/ts/studio/history/tests/studioStoreDoubles'
import { makeCharacter, putCharacter } from 'src/ts/studio/history/tests/objService.test-helpers'
import { importRegex } from 'src/ts/process/scripts'
import { regexCustomFlag, regexFieldEdit, regexFlagEdit, regexStageEdit, regexTypingKey, type RegexOp } from '../regexListOps'

const h = vi.hoisted(() => ({ marks: 0, picked: null as { name: string, data: Uint8Array } | null }))

vi.mock('src/ts/globalApi.svelte', () => ({
    getSaveMarkCount: () => h.marks,
    downloadFile: vi.fn(),
    AppendableBuffer: class {},
}))
vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return {
        DBState: { db: { characters: [], modules: [] } },
        selIdState: { selId: 0 },
        selectedCharID: writable(0),
        MobileGUI: writable(false),
        settingsOpen: writable(false),
        clearCharEmotionCache: () => {},
    }
})
vi.mock('src/ts/storage/database.svelte', async () => {
    const { DBState: state } = await import('src/ts/stores.svelte')
    return { getDatabase: () => state.db, getCurrentCharacter: vi.fn(), getCurrentChat: vi.fn(), defaultSdDataFunc: () => [] }
})
vi.mock('src/ts/util', () => ({ selectSingleFile: vi.fn(async () => h.picked) }))
vi.mock('src/ts/alert', () => ({ alertError: vi.fn(), alertNormal: vi.fn() }))
vi.mock('src/ts/exportNotice', () => ({ downloadNotice: vi.fn() }))
vi.mock('src/ts/parser/parser.svelte', () => ({ assetRegex: {}, risuChatParser: vi.fn() }))
vi.mock('src/ts/process/modules', () => ({ getModuleAssets: vi.fn(() => []), getModuleRegexScripts: vi.fn(() => []) }))
vi.mock('src/ts/process/memory/hypamemory', () => ({ HypaProcesser: class {} }))
vi.mock('src/ts/process/scriptings', () => ({ runLuaEditTrigger: vi.fn() }))
vi.mock('src/ts/plugins/plugins.svelte', () => ({ pluginV2: {} }))
vi.mock('src/ts/process/triggers', () => ({ runTrigger: vi.fn() }))

type Entry = Record<string, unknown>

const A = characterOwnerKey('A')
const M1 = moduleOwnerKey('M1')
const OWNERS: readonly (readonly [string, OwnerKey])[] = [['character', A], ['module', M1]]
const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }

let service: OwnerHistoryService
let clock: FakeClock
let open: string | null
let acks: { id: string, before: number }[]

// The classic add shape, the shape `RegexData` writes, and an upstream entry with an unknown key and an own `__proto__`.
const classicEntry = (): Entry => ({ comment: '', in: '', out: '', type: 'editinput' })
const flaggedEntry = (flag: string): Entry => ({ comment: 'flagged', in: 'a', out: 'b', type: 'editoutput', flag, ableFlag: false })
const upstreamEntry = (): Entry => JSON.parse('{"comment":"up","in":"a","out":"b","type":"editinput","x_future":{"a":1},"__proto__":{"p":1}}')

function liveList(owner: OwnerKey): unknown[] {
    if (owner === M1) {
        return (DBState.db.modules as unknown as { regex: unknown[] }[])[0].regex
    }
    return (DBState.db.characters as unknown as { customscript: unknown[] }[])[0].customscript
}
const entryOf = (owner: OwnerKey, index: number): Entry => liveList(owner)[index] as Entry
const doneOf = (owner: OwnerKey) => service.view(owner).done
const snapshot = (owner: OwnerKey): string => JSON.stringify(liveList(owner))

// Both owners get their own deep copy of the list, so one test drives the character and the module the same way.
async function start(list: unknown[]): Promise<void> {
    putCharacter({ ...makeCharacter(), customscript: structuredClone(list) })
    DBState.db.modules = [{ id: 'M1', name: 'M1', assets: [], regex: structuredClone(list) }] as unknown as typeof DBState.db.modules
    open = 'M1'
    acks = []
    clock = createFakeClock()
    service = createOwnerHistoryService({
        store: createMemoryStudioStore(),
        claim: createClaimDouble(),
        clock,
        pageSession: 'p1',
        getVisitId: () => 'v1',
        registerLeaveFlush: () => () => {},
        openModuleId: () => open,
    })
    service.setModuleAck('M1', { noteEdit: (id, before) => { acks.push({ id, before }) } })
    await service.whenReady(A)
    await service.whenReady(M1)
}

// Malformed and well-formed rows as the classic import button appends them: the real `importRegex` over the file bytes.
async function importedList(rows: unknown[]): Promise<unknown[]> {
    h.picked = { name: 'regex.json', data: new TextEncoder().encode(JSON.stringify({ type: 'regex', data: rows })) }
    return importRegex([])
}

beforeEach(() => {
    h.marks = 0
    h.picked = null
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
    resetStudioScreenForTests()
    selIdState.selId = 0
    studioScreen.chaId = 'A'
})

afterEach(() => {
    DBState.db = { characters: [], modules: [] } as unknown as typeof DBState.db
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
})

const edit = (owner: OwnerKey, op: RegexOp) => service.objEdit(owner, op.build)

// Every key of an entry with its value, own `__proto__` included, in a stable order.
function keysOf(entry: Entry): [string, string][] {
    return Object.getOwnPropertyNames(entry).sort().map((key) => [key, JSON.stringify(Object.getOwnPropertyDescriptor(entry, key)?.value)])
}
function without(pairs: [string, string][], field: string): [string, string][] {
    return pairs.filter(([key]) => key !== field)
}

// Each builder, aimed at one row, in the form every refusal test drives it.
const builders: [string, (index: number) => RegexOp][] = [
    ['comment', (i) => regexFieldEdit(i, 'comment', 'new name', null, 'x')],
    ['in', (i) => regexFieldEdit(i, 'in', 'new in', null)],
    ['out', (i) => regexFieldEdit(i, 'out', 'new out', null)],
    ['stage', (i) => regexStageEdit(i, 'editoutput')],
    ['flag', (i) => regexFlagEdit(i, (flag) => `${flag}i`, null)],
    ['switch on', (i) => regexCustomFlag(i, true)],
    ['switch off', (i) => regexCustomFlag(i, false)],
]

describe.each(OWNERS)('T2: each field edit keeps every other key (%s owner)', (_name, owner) => {
    const fieldEdits: [string, string, (i: number) => RegexOp, string | boolean][] = [
        ['comment', 'comment', (i) => regexFieldEdit(i, 'comment', 'renamed', null, 'up'), 'renamed'],
        ['in', 'in', (i) => regexFieldEdit(i, 'in', 'find', null), 'find'],
        ['out', 'out', (i) => regexFieldEdit(i, 'out', 'replace', null), 'replace'],
        ['type', 'type', (i) => regexStageEdit(i, 'edit_future'), 'edit_future'],
        ['flag', 'flag', (i) => regexFlagEdit(i, (flag) => `${flag}gi`, null), 'gi'],
        ['ableFlag', 'ableFlag', (i) => regexCustomFlag(i, true), true],
    ]
    test.each(fieldEdits)('%s edit changes that key (and the switch its default flag) and nothing else', async (_label, field, build, value) => {
        await start([upstreamEntry(), classicEntry()])
        const neighbour = JSON.stringify(entryOf(owner, 1))
        const before = keysOf(entryOf(owner, 0))
        expect(edit(owner, build(0))).toEqual({ ok: true })
        const after = entryOf(owner, 0)
        expect(after[field]).toBe(value)
        const touched = field === 'ableFlag' ? ['ableFlag', 'flag'] : [field]
        const strip = (pairs: [string, string][]) => touched.reduce(without, pairs)
        expect(strip(keysOf(after))).toEqual(strip(before))
        expect(after.x_future).toEqual({ a: 1 })
        expect(Object.hasOwn(after, '__proto__')).toBe(true)
        expect(Object.getPrototypeOf(after)).toBe(Object.prototype)
        expect(JSON.stringify(entryOf(owner, 1))).toBe(neighbour)
        expect(doneOf(owner)).toHaveLength(1)
    })

    test('a field edit never drafts a deletion of a required key', async () => {
        await start([upstreamEntry()])
        expect(edit(owner, regexFieldEdit(0, 'comment', '', null, 'up'))).toEqual({ ok: true })
        expect(edit(owner, regexFieldEdit(0, 'in', '', null))).toEqual({ ok: true })
        expect(edit(owner, regexFieldEdit(0, 'out', '', null))).toEqual({ ok: true })
        expect(edit(owner, regexStageEdit(0, ''))).toEqual({ ok: true })
        const writes = doneOf(owner).flatMap((step) => step.ops).filter((op) => op.op === 'objSet') as unknown as { field: string, after: { had: boolean } }[]
        expect(writes.map((op) => op.field)).toEqual(['comment', 'in', 'out', 'type'])
        expect(writes.every((op) => op.after.had)).toBe(true)
        for (const field of ['comment', 'in', 'out', 'type']) {
            expect(entryOf(owner, 0)[field]).toBe('')
        }
    })
})

describe.each(OWNERS)('T4: the custom-flag step and the flag text (%s owner)', (_name, owner) => {
    const starts: [string, Entry[], string | undefined][] = [
        ['flag absent', [classicEntry()], undefined],
        ['flag empty', [{ ...classicEntry(), flag: '' }], ''],
        ['flag gi<cbs>', [{ ...classicEntry(), flag: 'gi<cbs>' }], 'gi<cbs>'],
    ]
    test.each(starts)('on with %s: one step, the default flag only when there is none, undo restores, redo reapplies', async (_label, list, flag) => {
        await start(list)
        const original = snapshot(owner)
        expect(edit(owner, regexCustomFlag(0, true))).toEqual({ ok: true })
        expect(doneOf(owner)).toHaveLength(1)
        expect(entryOf(owner, 0).ableFlag).toBe(true)
        expect(entryOf(owner, 0).flag).toBe(flag === undefined || flag === '' ? 'g' : flag)
        const switched = snapshot(owner)
        expect(service.undo(owner)).toEqual({ ok: true })
        expect(snapshot(owner)).toBe(original)
        expect(Object.hasOwn(entryOf(owner, 0), 'ableFlag')).toBe(false)
        expect(Object.hasOwn(entryOf(owner, 0), 'flag')).toBe(flag !== undefined)
        expect(service.redo(owner)).toEqual({ ok: true })
        expect(snapshot(owner)).toBe(switched)
    })

    test.each(starts)('off with %s: ableFlag is written false, flag is kept, undo deletes the absent ableFlag', async (_label, list, flag) => {
        await start(list)
        const original = snapshot(owner)
        expect(edit(owner, regexCustomFlag(0, false))).toEqual({ ok: true })
        expect(entryOf(owner, 0).ableFlag).toBe(false)
        expect(Object.hasOwn(entryOf(owner, 0), 'flag')).toBe(flag !== undefined)
        expect(entryOf(owner, 0).flag).toBe(flag)
        expect(service.undo(owner)).toEqual({ ok: true })
        expect(snapshot(owner)).toBe(original)
        expect(Object.hasOwn(entryOf(owner, 0), 'ableFlag')).toBe(false)
        expect(service.redo(owner)).toEqual({ ok: true })
        expect(entryOf(owner, 0).ableFlag).toBe(false)
    })

    test('a flag cleared to empty is written as a present empty text and never deleted', async () => {
        await start([flaggedEntry('g')])
        expect(edit(owner, regexFlagEdit(0, () => '', null))).toEqual({ ok: true })
        expect(Object.hasOwn(entryOf(owner, 0), 'flag')).toBe(true)
        expect(entryOf(owner, 0).flag).toBe('')
        const op = doneOf(owner)[0].ops[0] as unknown as { after: unknown }
        expect(op.after).toEqual({ had: true, value: '' })
        expect(service.undo(owner)).toEqual({ ok: true })
        expect(entryOf(owner, 0).flag).toBe('g')
    })

    test('a flag edit that leaves the text as it was is unchanged and an absent flag stays absent', async () => {
        await start([classicEntry()])
        expect(edit(owner, regexFlagEdit(0, (flag) => flag, null))).toEqual({ ok: true, unchanged: true })
        expect(Object.hasOwn(entryOf(owner, 0), 'flag')).toBe(false)
        expect(doneOf(owner)).toHaveLength(0)
    })

    test('a flag edit of an absent flag writes the whole new text as a present key, and undo deletes it', async () => {
        await start([classicEntry()])
        expect(edit(owner, regexFlagEdit(0, (flag) => `${flag}g`, null))).toEqual({ ok: true })
        expect(entryOf(owner, 0).flag).toBe('g')
        expect(service.undo(owner)).toEqual({ ok: true })
        expect(Object.hasOwn(entryOf(owner, 0), 'flag')).toBe(false)
    })
})

describe('T15: the module owner', () => {
    test('a landed write makes a new module object and a new regex array, leaves the old ones unchanged, and notifies the ack', async () => {
        await start([upstreamEntry(), classicEntry()])
        const modules = DBState.db.modules as unknown as { regex: unknown[] }[]
        const oldModule = modules[0]
        const oldRegex = oldModule.regex
        const oldFirst = oldRegex[0]
        const oldText = JSON.stringify(oldRegex)
        expect(edit(M1, regexFieldEdit(0, 'in', 'changed', null))).toEqual({ ok: true })
        const newModule = (DBState.db.modules as unknown as { regex: unknown[] }[])[0]
        expect(newModule).not.toBe(oldModule)
        expect(newModule.regex).not.toBe(oldRegex)
        expect(JSON.stringify(oldRegex)).toBe(oldText)
        expect(oldModule.regex).toBe(oldRegex)
        expect(oldRegex[0]).toBe(oldFirst)
        expect((newModule.regex[0] as Entry).in).toBe('changed')
        expect(newModule.regex[1]).toBe(oldRegex[1])
        expect(acks).toHaveLength(1)
        expect(acks[0].id).toBe('M1')
    })

    test('a stub module, two slots sharing the id and a module that is not open are refused with nothing written', async () => {
        await start([classicEntry()])
        const stubbed = { id: 'M1', [MODULE_STUB_KEY]: MODULE_STUB_VALUE }
        const slot = (DBState.db.modules as unknown as unknown[])[0]
        const original = JSON.stringify(slot)

        ;(DBState.db.modules as unknown as unknown[])[0] = stubbed
        expect(edit(M1, regexFieldEdit(0, 'in', 'x', null))).toMatchObject({ ok: false, reason: 'gone' })
        ;(DBState.db.modules as unknown as unknown[])[0] = slot

        ;(DBState.db.modules as unknown as unknown[]).push({ id: 'M1', name: 'twin', assets: [], regex: [classicEntry()] })
        expect(edit(M1, regexFieldEdit(0, 'in', 'x', null))).toMatchObject({ ok: false, reason: 'duplicate-module-id' })
        ;(DBState.db.modules as unknown as unknown[]).pop()

        open = 'M2'
        expect(edit(M1, regexFieldEdit(0, 'in', 'x', null))).toMatchObject({ ok: false, reason: 'not-selected' })
        open = 'M1'

        expect(JSON.stringify((DBState.db.modules as unknown as unknown[])[0])).toBe(original)
        expect(doneOf(M1)).toHaveLength(0)
        expect(acks).toHaveLength(0)
    })
})

describe.each(OWNERS)('T35: unreadable and inert rows (%s owner)', (_name, owner) => {
    // Rows 1 and 2 are objects with a wrong or missing required key; 3 and 4 are not objects at all.
    const rows = (): unknown[] => [
        classicEntry(),
        { comment: 'x', in: 123, out: '', type: 'editinput' },
        { in: '', out: '', type: 'editinput' },
        null,
        'text',
        upstreamEntry(),
    ]

    test.each([1, 2, 3, 4])('every builder refuses row %i with a precondition, no write and no step', async (index) => {
        await start(await importedList(rows()))
        const before = snapshot(owner)
        for (const [, build] of builders) {
            expect(edit(owner, build(index))).toEqual({ ok: false, reason: 'precondition' })
        }
        expect(snapshot(owner)).toBe(before)
        expect(doneOf(owner)).toHaveLength(0)
        expect(service.journalForTests(owner).get('regex') ?? []).toHaveLength(0)
    })

    test('other rows of the same list still edit, and undo and redo of a neighbour still apply', async () => {
        await start(await importedList(rows()))
        const malformed = [1, 2, 3, 4].map((i) => JSON.stringify(liveList(owner)[i]))
        expect(edit(owner, regexFieldEdit(0, 'in', 'first', null))).toEqual({ ok: true })
        expect(edit(owner, regexFieldEdit(5, 'out', 'last', null))).toEqual({ ok: true })
        expect(entryOf(owner, 0).in).toBe('first')
        expect(entryOf(owner, 5).out).toBe('last')
        expect(service.undo(owner)).toEqual({ ok: true })
        expect(entryOf(owner, 5).out).toBe('b')
        expect(entryOf(owner, 0).in).toBe('first')
        expect(service.redo(owner)).toEqual({ ok: true })
        expect(entryOf(owner, 5).out).toBe('last')
        expect([1, 2, 3, 4].map((i) => JSON.stringify(liveList(owner)[i]))).toEqual(malformed)
        expect(entryOf(owner, 5).x_future).toEqual({ a: 1 })
    })

    test('a row index outside the list is refused', async () => {
        await start([classicEntry()])
        for (const index of [-1, 1, 1.5, Number.NaN]) {
            expect(edit(owner, regexStageEdit(index, 'editinput'))).toEqual({ ok: false, reason: 'precondition' })
        }
        expect(doneOf(owner)).toHaveLength(0)
    })

    test('the name builder refuses when the row no longer holds the name it was opened with', async () => {
        await start([{ ...classicEntry(), comment: 'now' }])
        expect(edit(owner, regexFieldEdit(0, 'comment', 'typed', null, 'was'))).toEqual({ ok: false, reason: 'precondition' })
        expect(entryOf(owner, 0).comment).toBe('now')
        expect(edit(owner, regexFieldEdit(0, 'comment', 'typed', null, 'now'))).toEqual({ ok: true })
    })
})

describe.each(OWNERS)('T36: a list a JSON-shaped store would change (%s owner)', (_name, owner) => {
    const lists: [string, () => unknown[]][] = [
        ['NaN in an unknown key', () => [{ ...classicEntry(), x_future: Number.NaN }]],
        ['an undefined element', () => [classicEntry(), undefined]],
        ['flag: undefined', () => [{ ...classicEntry(), flag: undefined }]],
        ['a nested undefined', () => [{ ...classicEntry(), x_future: { x: { y: undefined } } }]],
    ]
    test.each(lists)('%s: every builder refuses, with no journal entry and no step', async (_label, make) => {
        await start(make())
        for (const [, build] of builders) {
            expect(edit(owner, build(0))).toEqual({ ok: false, reason: 'precondition' })
        }
        expect(doneOf(owner)).toHaveLength(0)
        expect(service.journalForTests(owner).get('regex') ?? []).toHaveLength(0)
    })
})

describe.each(OWNERS)('T-TK: the typing key joins typing into one step (%s owner)', (_name, owner) => {
    const type = (text: string, key: string | null) => expect(edit(owner, regexFieldEdit(0, 'in', text, key))).toEqual({ ok: true })

    test('three inputs of one key within the window make one step; the next one after the window starts another', async () => {
        await start([classicEntry()])
        const key = regexTypingKey('form1', 0, 'in')
        expect(key).toBe('regex:form1:0:in')
        type('a', key)
        clock.tick(COALESCE_MS / 4)
        type('ab', key)
        clock.tick(COALESCE_MS / 4)
        type('abc', key)
        expect(doneOf(owner)).toHaveLength(1)
        expect(entryOf(owner, 0).in).toBe('abc')
        clock.tick(COALESCE_MS + 1)
        type('abcd', key)
        expect(doneOf(owner)).toHaveLength(2)
    })

    test('after a closed step the next input of the same key starts a new step', async () => {
        await start([classicEntry()])
        const key = regexTypingKey('form1', 0, 'in')
        type('a', key)
        type('ab', key)
        service.closeOpenStep(owner)
        type('abc', key)
        expect(doneOf(owner)).toHaveLength(2)
    })

    test('a null key makes a step for each input', async () => {
        await start([classicEntry()])
        type('a', null)
        type('ab', null)
        type('abc', null)
        expect(doneOf(owner)).toHaveLength(3)
    })
})

describe('regexTypingKey', () => {
    test('binds the form instance, the row index and the field', () => {
        expect(regexTypingKey('t', 3, 'out')).toBe('regex:t:3:out')
    })
})
