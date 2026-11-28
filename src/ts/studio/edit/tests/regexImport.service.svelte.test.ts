// @vitest-environment jsdom
// The Studio regex import flow through the real owner history service (memory store, fake clock, a character owner and a
// module owner): a file the real `exportRegex` wrote imports as one appended step (T26), the file and entry refusals
// post their notices and write nothing (T27, T28, T28b), undo and redo are all or nothing (T29, T29b), and the step
// survives the store with its label and counts (T38 import). The export side is driven with `downloadFile` captured.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { language } from 'src/lang'
import { DBState, selIdState } from 'src/ts/stores.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { createOwnerHistoryService, type OwnerHistoryService } from 'src/ts/studio/history/ownerHistory.svelte'
import { characterOwnerKey, moduleOwnerKey, SAVE_DEBOUNCE_MS, type OwnerKey } from 'src/ts/studio/history/ownerPhase'
import { createFakeClock, type FakeClock } from 'src/ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore, storedRecord, type MemoryStudioStore } from 'src/ts/studio/history/tests/studioStoreDoubles'
import { makeCharacter, putCharacter } from 'src/ts/studio/history/tests/objService.test-helpers'
import { exportRegex, importRegex } from 'src/ts/process/scripts'
import type { PlainToastInit } from 'src/ts/toast/toastHost.svelte'
import { regexStepText } from '../objListCopy'
import { runRegexExport, runRegexImport, type RegexImportDeps } from '../regexFileActions'
import type { RegexOp } from '../regexListOps'

const h = vi.hoisted(() => ({
    marks: 0,
    picked: null as { name: string, data: Uint8Array } | null,
    saved: null as Uint8Array | null,
    saveResult: true,
}))

vi.mock('src/ts/globalApi.svelte', () => ({
    getSaveMarkCount: () => h.marks,
    downloadFile: vi.fn(async (_name: string, data: Uint8Array) => {
        h.saved = data
        return h.saveResult
    }),
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
let store: MemoryStudioStore
let toasts: PlainToastInit[]

// The classic add shape, the shape `RegexData` writes, an upstream entry with an unknown key and an own `__proto__`, and
// one with a stage this build does not know.
const classicEntry = (n = 0): Entry => ({ comment: `C${n}`, in: '', out: '', type: 'editinput' })
const flaggedEntry = (): Entry => ({ comment: 'flagged', in: 'a', out: 'b', type: 'editoutput', flag: 'gi', ableFlag: true })
const upstreamEntry = (): Entry => JSON.parse('{"comment":"up","in":"a","out":"b","type":"editinput","x_future":{"a":1},"__proto__":{"p":1}}')
const futureStageEntry = (): Entry => ({ comment: 'future', in: 'a', out: 'b', type: 'edit_future' })
const oldRow = (): Entry => ({ comment: 'old', in: 'o', out: 'o', type: 'editprocess' })

function liveList(owner: OwnerKey): unknown[] {
    if (owner === M1) return (DBState.db.modules as unknown as { regex: unknown[] }[])[0].regex
    return (DBState.db.characters as unknown as { customscript: unknown[] }[])[0].customscript
}
const snapshot = (owner: OwnerKey): string => JSON.stringify(liveList(owner))
const doneOf = (owner: OwnerKey) => service.view(owner).done
const runOn = (owner: OwnerKey) => (op: RegexOp) => service.objEdit(owner, op.build)

// Every key of an entry with its value, own `__proto__` included, in a stable order.
function keysOf(entry: unknown): [string, string][] {
    const row = entry as Entry
    return Object.getOwnPropertyNames(row).sort().map((key) => [key, JSON.stringify(Object.getOwnPropertyDescriptor(row, key)?.value)])
}

function newService(): OwnerHistoryService {
    return createOwnerHistoryService({
        store,
        claim: createClaimDouble(),
        clock,
        pageSession: 'p1',
        getVisitId: () => 'v1',
        registerLeaveFlush: () => () => {},
        openModuleId: () => 'M1',
    })
}

async function start(list: unknown[]): Promise<void> {
    putCharacter({ ...makeCharacter(), customscript: structuredClone(list) })
    DBState.db.modules = [{ id: 'M1', name: 'M1', assets: [], regex: structuredClone(list) }] as unknown as typeof DBState.db.modules
    clock = createFakeClock()
    store = createMemoryStudioStore()
    service = newService()
    await service.whenReady(A)
    await service.whenReady(M1)
}

// The bytes the classic Export button writes, from the real `exportRegex`.
async function exportedBytes(rows: unknown[]): Promise<Uint8Array> {
    h.saved = null
    await exportRegex(rows as never)
    if (h.saved === null) throw new Error('exportRegex wrote no file')
    return h.saved
}

const textBytes = (text: string): Uint8Array => new TextEncoder().encode(text)
const fileText = (data: unknown): string => JSON.stringify({ type: 'regex', data })

function depsFor(bytes: Uint8Array | null): RegexImportDeps {
    return {
        pick: async () => (bytes === null ? null : { name: 'regex.json', data: bytes }),
        toast: (init) => { toasts.push(init) },
    }
}

async function importInto(owner: OwnerKey, bytes: Uint8Array | null, alive: () => boolean = () => true): Promise<void> {
    await runRegexImport(alive, runOn(owner), depsFor(bytes))
}

// Nothing was written, stepped or marked.
function expectUntouched(owner: OwnerKey, before: string, marks: number): void {
    expect(snapshot(owner)).toBe(before)
    expect(doneOf(owner)).toHaveLength(0)
    expect(service.journalForTests(owner).get('regex') ?? []).toHaveLength(0)
    expect(h.marks).toBe(marks)
}

beforeEach(() => {
    h.marks = 0
    h.picked = null
    h.saved = null
    h.saveResult = true
    toasts = []
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

describe.each(OWNERS)('T26: a file from the real exportRegex imports as written (%s owner)', (_name, owner) => {
    test('the list is the old row followed by the file rows, with unknown keys, an unknown stage and an own __proto__ kept', async () => {
        await start([oldRow()])
        const rows = [classicEntry(1), flaggedEntry(), upstreamEntry(), futureStageEntry()]
        const bytes = await exportedBytes(rows)
        const expected = (JSON.parse(new TextDecoder().decode(bytes)) as { data: unknown[] }).data
        await importInto(owner, bytes)
        const list = liveList(owner)
        expect(list).toHaveLength(5)
        expect(keysOf(list[0])).toEqual(keysOf(oldRow()))
        expected.forEach((row, k) => { expect(keysOf(list[k + 1])).toEqual(keysOf(row)) })
        expect(list[3]).toMatchObject({ x_future: { a: 1 } })
        expect(Object.hasOwn(list[3] as Entry, '__proto__')).toBe(true)
        expect(Object.getPrototypeOf(list[3])).toBe(Object.prototype)
        expect((list[4] as Entry).type).toBe('edit_future')
        expect(doneOf(owner)).toHaveLength(1)
        expect(toasts).toEqual([{ kind: 'info', text: language.studioRegexImported(4) }])
    })
})

describe.each(OWNERS)('T27: a file that is not a regex export is refused whole (%s owner)', (_name, owner) => {
    // A 0xFF byte inside a string value: the text is not UTF-8.
    const invalidUtf8 = (): Uint8Array => {
        const bytes = textBytes(fileText([{ comment: 'a?b', in: '', out: '', type: 'editinput' }]))
        bytes[bytes.indexOf(0x3f)] = 0xff
        return bytes
    }
    const notRegex: [string, () => Uint8Array][] = [
        ['invalid UTF-8', invalidUtf8],
        ['text that is not JSON', () => textBytes('not json')],
        ['a top-level array', () => textBytes(JSON.stringify([classicEntry()]))],
        ['another type', () => textBytes(JSON.stringify({ type: 'lore', data: [classicEntry()] }))],
        ['data missing', () => textBytes(JSON.stringify({ type: 'regex' }))],
        ['data an object', () => textBytes(JSON.stringify({ type: 'regex', data: { 0: classicEntry() } }))],
        ['a number past the finite range', () => textBytes('{"type":"regex","data":[{"comment":"","in":"","out":"","type":"editinput","x":1e400}]}')],
    ]
    test.each(notRegex)('%s: the not-a-regex notice, no write, no step, no mark', async (_label, make) => {
        await start([oldRow()])
        const before = snapshot(owner)
        await importInto(owner, make())
        expect(toasts).toEqual([{ kind: 'error', text: language.studioRegexImportNotRegex }])
        expectUntouched(owner, before, 0)
    })

    test('a list with no entries gets the empty notice and nothing else', async () => {
        await start([oldRow()])
        const before = snapshot(owner)
        await importInto(owner, textBytes(fileText([])))
        expect(toasts).toEqual([{ kind: 'info', text: language.studioRegexImportEmpty }])
        expectUntouched(owner, before, 0)
    })

    test('a byte-order mark before a valid export is accepted and lands as one step', async () => {
        await start([oldRow()])
        const body = await exportedBytes([classicEntry(1), upstreamEntry()])
        const bytes = new Uint8Array(body.length + 3)
        bytes.set([0xef, 0xbb, 0xbf])
        bytes.set(body, 3)
        await importInto(owner, bytes)
        expect(liveList(owner)).toHaveLength(3)
        expect(keysOf(liveList(owner)[2])).toEqual(keysOf(upstreamEntry()))
        expect(doneOf(owner)).toHaveLength(1)
    })

    test('a cancelled picker is silent', async () => {
        await start([oldRow()])
        const before = snapshot(owner)
        await importInto(owner, null)
        expect(toasts).toEqual([])
        expectUntouched(owner, before, 0)
    })

    test('a surface that closed during the pick writes nothing and posts nothing', async () => {
        await start([oldRow()])
        const before = snapshot(owner)
        await importInto(owner, textBytes(fileText([classicEntry(1)])), () => false)
        expect(toasts).toEqual([])
        expectUntouched(owner, before, 0)
    })

    test('a refusal of the write posts no success notice', async () => {
        await start([oldRow()])
        await runRegexImport(() => true, () => ({ ok: false, reason: 'gone' }), depsFor(textBytes(fileText([classicEntry(1)]))))
        expect(toasts).toEqual([])
    })
})

describe.each(OWNERS)('T28: one entry that is not a script refuses the whole file (%s owner)', (_name, owner) => {
    test('the notice names the count, the first position and the reason; nothing is written', async () => {
        await start([oldRow()])
        const before = snapshot(owner)
        const rows = [classicEntry(1), null, classicEntry(2), { comment: 'x', in: 123, out: '', type: 'editinput' }]
        await importInto(owner, await exportedBytes(rows))
        expect(toasts).toHaveLength(1)
        expect(toasts[0].kind).toBe('error')
        expect(toasts[0].text).toBe(language.studioRegexImportBadEntry(2, 2, language.studioRegexWhyNotObject))
        expect(toasts[0].text).toContain('2 entries')
        expectUntouched(owner, before, 0)
    })

    test('a single bad entry among good ones is refused', async () => {
        await start([oldRow()])
        const before = snapshot(owner)
        await importInto(owner, await exportedBytes([classicEntry(1), classicEntry(2), 'text', classicEntry(3)]))
        expect(toasts).toEqual([{ kind: 'error', text: language.studioRegexImportBadEntry(1, 3, language.studioRegexWhyNotObject) }])
        expectUntouched(owner, before, 0)
    })
})

describe.each(OWNERS)('T28b: a list holding a row the classic import let in is refused when exported (%s owner)', (_name, owner) => {
    test('the live list with a row that is not a script, written by exportRegex, is refused by the Studio import', async () => {
        h.picked = { name: 'regex.json', data: textBytes(fileText([classicEntry(1), { comment: 'x', in: 123, out: '', type: 'editinput' }])) }
        const live = await importRegex([])
        await start(live)
        const before = snapshot(owner)
        await importInto(owner, await exportedBytes(liveList(owner)))
        expect(toasts).toHaveLength(1)
        expect(toasts[0].kind).toBe('error')
        expect(toasts[0].text).toBe(language.studioRegexImportBadEntry(1, 2, language.studioRegexWhyField('in')))
        expectUntouched(owner, before, 0)
    })
})

describe.each(OWNERS)('T29: the import is one step (%s owner)', (_name, owner) => {
    const file = async () => exportedBytes([classicEntry(1), flaggedEntry(), upstreamEntry()])
    const imported = async () => {
        await start([oldRow(), { ...oldRow(), comment: 'old2' }])
        const original = snapshot(owner)
        await importInto(owner, await file())
        return original
    }

    test('three entries add one step and five rows; undo restores the two rows and redo adds the three again', async () => {
        const original = await imported()
        expect(doneOf(owner)).toHaveLength(1)
        expect(liveList(owner)).toHaveLength(5)
        const landed = snapshot(owner)
        expect(service.undo(owner)).toEqual({ ok: true })
        expect(snapshot(owner)).toBe(original)
        expect(service.redo(owner)).toEqual({ ok: true })
        expect(snapshot(owner)).toBe(landed)
        expect(toasts).toEqual([{ kind: 'info', text: language.studioRegexImported(3) }])
    })

    test('an edit of an older row from outside does not stop the undo', async () => {
        await imported()
        ;(liveList(owner)[0] as Entry).comment = 'outside'
        expect(service.undo(owner)).toEqual({ ok: true })
        expect(liveList(owner)).toHaveLength(2)
        expect((liveList(owner)[0] as Entry).comment).toBe('outside')
    })

    test('an imported row moved from outside makes the undo a precondition refusal that changes nothing', async () => {
        await imported()
        const list = liveList(owner)
        list.unshift(list.pop())
        const moved = snapshot(owner)
        expect(service.undo(owner)).toMatchObject({ ok: false, reason: 'precondition' })
        expect(snapshot(owner)).toBe(moved)
        expect(doneOf(owner)).toHaveLength(1)
    })

    test('a file holding a twin pair is removed and re-added as a pair', async () => {
        await start([oldRow()])
        const original = snapshot(owner)
        await importInto(owner, await exportedBytes([classicEntry(1), classicEntry(1)]))
        expect(liveList(owner)).toHaveLength(3)
        const landed = snapshot(owner)
        expect(service.undo(owner)).toEqual({ ok: true })
        expect(snapshot(owner)).toBe(original)
        expect(service.redo(owner)).toEqual({ ok: true })
        expect(snapshot(owner)).toBe(landed)
    })
})

describe.each(OWNERS)('T38 import: the record written through the memory store reads back (%s owner)', (_name, owner) => {
    test('the label is an import of 3 with 3 inserts that carry counts, and the History text reads Imported 3 scripts', async () => {
        await start([oldRow()])
        await importInto(owner, await exportedBytes([classicEntry(1), classicEntry(2), upstreamEntry()]))
        await clock.advance(SAVE_DEBOUNCE_MS + 1)
        const stored = storedRecord(store.shared, owner as never)
        expect(stored).not.toBeNull()
        const done = stored?.record.done ?? []
        expect(done).toHaveLength(1)
        const step = done[0] as unknown as { label: { kind: string, list: string, action: string, name: null, count: number }, ops: { op: string, list: string, counts?: Record<string, number> }[] }
        expect(step.label).toMatchObject({ kind: 'obj', list: 'regex', action: 'import', name: null, count: 3 })
        expect(step.ops).toHaveLength(3)
        for (const op of step.ops) {
            expect(op).toMatchObject({ op: 'objInsert', list: 'regex' })
            expect(op.counts).toBeDefined()
        }
        expect(regexStepText(step.label as never)).toBe(language.studioRegexStepImport(3))
        const reloaded = newService()
        await reloaded.whenReady(owner)
        expect(reloaded.view(owner).done).toHaveLength(1)
    })
})

describe('the export flow', () => {
    test('a list is handed to exportRegex as stored and the file holds exactly that list', async () => {
        const rows = [classicEntry(1), upstreamEntry()]
        await runRegexExport(rows)
        expect(h.saved).not.toBeNull()
        const written = JSON.parse(new TextDecoder().decode(h.saved as Uint8Array)) as { type: string, data: unknown[] }
        expect(written.type).toBe('regex')
        expect(written.data.map(keysOf)).toEqual(rows.map(keysOf))
    })

    test('a list that is not an array is refused without a file or a notice', async () => {
        const toast = vi.fn()
        const exportList = vi.fn(async () => {})
        for (const list of [undefined, null, { 0: classicEntry() }, 'text']) await runRegexExport(list, { exportList, toast })
        expect(exportList).not.toHaveBeenCalled()
        expect(toast).not.toHaveBeenCalled()
        expect(h.saved).toBeNull()
    })

    test('a save that throws posts an error notice', async () => {
        const toast = vi.fn()
        await runRegexExport([classicEntry()], { exportList: async () => { throw new Error('disk full') }, toast })
        expect(toast).toHaveBeenCalledWith({ kind: 'error', text: 'Error: disk full' })
    })
})
