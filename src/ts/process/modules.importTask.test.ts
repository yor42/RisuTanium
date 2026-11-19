/**
 * Module import on the task card (`importModule` in `src/ts/process/modules.ts`): what the card shows while a `.risum`
 * or module `.json` is read, where Cancel stops being offered, and that a Cancel before the first write leaves nothing
 * behind.
 *
 * The real `modules.ts`, `importBatch.ts`, `alertTask.svelte.ts`, `busyActions.ts` and `moduleDuplicates.ts` run on
 * synthetic files with the RPack layer as the identity; the asset store, the alerts and the card importer are recorders.
 * The `.charx` module route uses a recorder in place of the real card importer, so its test pins the entry gate, not the
 * importer's own saves.
 *
 * Labels: (RR) regression reproducer, fails on the base before the card; (RR-m) new behaviour pinned by mutants;
 * (CG) compatibility guard.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ImportOutcome } from 'src/ts/importBatch'
import { patterned, risumBytes } from 'src/ts/process/tests/risumFixtures'
import { MODULE_STUB_KEY, MODULE_STUB_VALUE } from 'src/ts/storage/moduleStub'

const h = vi.hoisted(() => {
    const alert: { v: { type: string, msg: string }, subs: Set<(v: { type: string, msg: string }) => void> } = {
        v: { type: 'none', msg: '' },
        subs: new Set(),
    }
    return {
        alert,
        alertStore: {
            set: (v: { type: string, msg: string }) => { alert.v = v; for (const run of [...alert.subs]) run(v) },
            subscribe: (run: (v: { type: string, msg: string }) => void) => {
                alert.subs.add(run)
                run(alert.v)
                return () => { alert.subs.delete(run) }
            },
        },
        modules: [] as unknown[],
        files: [] as File[],
        confirm: true,
        confirmHook: null as null | (() => void),
        selectHook: null as null | (() => void),
        selectAnswer: '0',
        selectAnswers: [] as string[],
        selectLog: [] as number[],
        describeThrows: false,
        bumps: [] as boolean[],
        beforeRead: null as null | ((file: string, start: number, end: number) => void),
        saves: [] as number[],
        pieceSaves: 0,
        saveHook: null as null | (() => void),
        pieceHook: null as null | (() => void),
        saveFailures: 0,
        marks: [] as unknown[],
        stubLoads: 0,
        cardHook: null as null | ((arg: { name: string }) => Promise<ImportOutcome>),
        cardStarted: 0,
    }
})

vi.mock('uuid', () => ({ v4: () => 'uuid' }))

vi.mock(import('src/ts/alert'), () => {
    const set = (v: { type: string, msg: string }) => h.alertStore.set(v)
    return {
        alertClear: vi.fn(() => set({ type: 'none', msg: '' })),
        alertConfirm: vi.fn(async () => { h.confirmHook?.(); return h.confirm }),
        alertError: vi.fn((msg: string | Error) => set({ type: 'error', msg: String(msg) })),
        alertModuleSelect: vi.fn(),
        alertNormal: vi.fn((msg: string) => set({ type: 'normal', msg })),
        alertSelect: vi.fn(async (options: string[]) => {
            h.selectLog.push(options.length)
            h.selectHook?.()
            return h.selectAnswers.shift() ?? h.selectAnswer
        }),
        alertStore: { set: vi.fn(), subscribe: vi.fn(), update: vi.fn() },
        alertWait: vi.fn((msg: string) => set({ type: 'wait', msg })),
    } as unknown as typeof import('src/ts/alert')
})

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getCurrentCharacter: vi.fn(),
    getCurrentChat: vi.fn(),
    getDatabase: vi.fn(() => ({ modules: h.modules })),
    setCurrentCharacter: vi.fn(),
    setDatabase: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    AppendableBuffer: class {},
    AssetSourceChangedError: class extends Error {},
    LocalWriter: class {},
    VirtualWriter: class {},
    downloadFile: vi.fn(),
    forageStorage: {},
    readImage: vi.fn(),
    saveAsset: vi.fn(async (data: Uint8Array) => {
        h.saves.push(data[0])
        h.saveHook?.()
        if (h.saveFailures > 0) {
            h.saveFailures -= 1
            throw new Error('store full')
        }
        return 'saved-asset'
    }),
    saveAssetFromPieces: vi.fn(async (pieces: AsyncIterable<Uint8Array>) => {
        h.pieceSaves += 1
        for await (const _piece of pieces) {
            h.pieceHook?.()
        }
        return 'saved-pieces'
    }),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/util'), () => ({
    checkPersonaBinded: vi.fn(),
    selectFileByDom: vi.fn(async () => h.files),
    sleep: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/process/lorebook.svelte'), () => ({
    convertExternalLorebook: vi.fn(() => []),
}) as unknown as typeof import('src/ts/process/lorebook.svelte'))

vi.mock(import('src/ts/media'), () => ({
    compressImage: vi.fn(async (d: Uint8Array) => d),
}) as unknown as typeof import('src/ts/media'))

vi.mock(import('src/ts/rpack/rpack_js'), () => ({
    decodeRPack: vi.fn(async (d: Uint8Array) => new Uint8Array(d)),
    encodeRPack: vi.fn(async (d: Uint8Array) => new Uint8Array(d)),
}) as unknown as typeof import('src/ts/rpack/rpack_js'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { get db() { return { modules: h.modules } } },
    HideIconStore: { set: vi.fn() },
    alertStore: h.alertStore,
    moduleBackgroundEmbedding: { set: vi.fn() },
    ReloadGUIPointer: { set: vi.fn() },
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/interchangeability'), () => ({
    convertCharacterToModule: vi.fn((c: { name: string }) => ({ id: 'converted', name: c.name })),
    convertModuleToCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/interchangeability'))

vi.mock(import('src/ts/characterCards'), () => ({
    exportCharacterCard: vi.fn(),
    importCharacterFile: vi.fn(async (arg: { name: string }) => {
        h.cardStarted += 1
        return h.cardHook ? await h.cardHook(arg) : { kind: 'imported', index: null }
    }),
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock(import('src/ts/bootWindow'), () => ({
    markBootWrite: vi.fn(() => { h.marks.push(taskStepIndex()) }),
}) as unknown as typeof import('src/ts/bootWindow'))

vi.mock(import('src/ts/process/moduleDuplicates'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        describeReplace: (...args: Parameters<typeof actual.describeReplace>) => {
            if (h.describeThrows) throw new Error('describe failed')
            return actual.describeReplace(...args)
        },
    }
})

//Records whether the result card still showed when the module screens were told to reload.
vi.mock(import('src/ts/process/moduleGuiBump'), () => ({
    bumpModuleGui: vi.fn(() => { h.bumps.push(taskResultShowing()) }),
    holdModuleGuiBumps: vi.fn(() => () => {}),
}))

vi.mock('src/ts/process/moduleLoader', () => ({
    loadModuleStubsOf: vi.fn(async () => { h.stubLoads += 1 }),
}))

import { importModule } from 'src/ts/process/modules'
import { answerTask, requestTaskCancel, resetTaskHostForTests, setTaskClockForTests, taskHostView, taskResultShowing } from 'src/ts/alertTask.svelte'
import type { TaskClock, TaskView } from 'src/lib/Nexus/pattern/taskProgress'
import { busyKinds } from 'src/ts/process/memory/busyActions'
import { inFlightKinds } from 'src/ts/process/inFlightWork'
import { charxLimits } from 'src/ts/process/processzip'
import { language } from 'src/lang'

function taskStepIndex(): number | null {
    return taskHostView()?.stepIndex ?? null
}

/** A file whose slices report every read to `h.beforeRead` first, so a test can look at the card or press Cancel mid-read. */
class ObservedFile extends File {
    override slice(start?: number, end?: number, type?: string): Blob {
        const blob = super.slice(start, end, type)
        const read = blob.arrayBuffer.bind(blob)
        const from = start ?? 0
        const to = end ?? this.size
        blob.arrayBuffer = async () => {
            h.beforeRead?.(this.name, from, to)
            return await read()
        }
        return blob
    }
}

const risum = (name: string, moduleName: string, over: { records?: Uint8Array[], module?: Record<string, unknown>, magic?: number } = {}) =>
    new ObservedFile([risumBytes({ records: over.records, magic: over.magic, module: { name: moduleName, ...over.module } })], name)
const names = () => (h.modules as { name: string }[]).map((m) => m.name)
const limitDefaults = { ...charxLimits }

/** Starts the import and waits until its result card shows (or the import ends without one). */
async function importToResult(): Promise<{ done: Promise<void>, view: TaskView | null }> {
    const done = importModule()
    let ended = false
    void done.then(() => { ended = true })
    for (let i = 0; i < 400 && !ended && !taskResultShowing(); i++) {
        await new Promise((resolve) => setTimeout(resolve, 0))
    }
    return { done, view: taskResultShowing() ? taskHostView() : null }
}

async function answerOk(done: Promise<void>): Promise<void> {
    if (taskResultShowing()) answerTask({ kind: 'ok' })
    await done
}

beforeEach(() => {
    h.alert.v = { type: 'none', msg: '' }
    h.modules = []
    h.files = []
    h.confirm = true
    h.confirmHook = null
    h.selectHook = null
    h.selectAnswer = '0'
    h.selectAnswers = []
    h.selectLog = []
    h.describeThrows = false
    h.bumps = []
    h.beforeRead = null
    h.saves = []
    h.pieceSaves = 0
    h.saveHook = null
    h.pieceHook = null
    h.saveFailures = 0
    h.marks = []
    h.stubLoads = 0
    h.cardHook = null
    h.cardStarted = 0
    Object.assign(charxLimits, limitDefaults, { assetBytes: 64 * 1024 * 1024 })
    let now = 0
    const clock: TaskClock = {
        now: () => (now += 1000),
        setTimeout: () => 0 as unknown as ReturnType<typeof setTimeout>,
        clearTimeout: () => {},
        hidden: () => false,
    }
    setTaskClockForTests(clock)
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    resetTaskHostForTests()
    Object.assign(charxLimits, limitDefaults)
    vi.restoreAllMocks()
})

describe('what the card shows while a module is read', () => {
    test('R-a1 (RR): a 1 MiB .risum has a visible progress surface during its scan', async () => {
        h.files = [risum('a.risum', 'A', { records: [patterned(1024 * 1024, 1)] })]
        let surface = 'nothing'
        h.beforeRead = () => {
            if (surface === 'nothing') {
                surface = h.alert.v.type === 'wait' ? 'wait' : taskHostView() !== null ? 'card' : 'nothing'
            }
        }
        const { done } = await importToResult()
        await answerOk(done)
        expect(surface, 'expected a visible progress surface during the scan').not.toBe('nothing')
    })

    test('R-a2 (RR): the Read bytes rise to the size during the scan of a larger .risum', async () => {
        const file = risum('a.risum', 'A', { records: [patterned(12 * 1024 * 1024, 1)] })
        h.files = [file]
        const seen: { done: number, total: number }[] = []
        h.beforeRead = () => {
            const bytes = taskHostView()?.bytes
            if (bytes) seen.push({ done: bytes.done, total: bytes.total })
        }
        const { done } = await importToResult()
        await answerOk(done)
        expect(seen.length, 'expected Read bytes on the card').toBeGreaterThan(0)
        expect(seen.every((s) => s.total === file.size)).toBe(true)
        expect(seen.some((s) => s.done > 0)).toBe(true)
        expect(seen.map((s) => s.done)).toEqual([...seen.map((s) => s.done)].sort((a, b) => a - b))
    })

    test('R-a3 (RR): one piece-saved record shows rising Save-assets bytes during its save', async () => {
        const size = 18 * 1024 * 1024
        h.files = [risum('a.risum', 'A', { records: [patterned(size, 1)] })]
        const during: (number | undefined)[] = []
        h.pieceHook = () => { during.push(taskHostView()?.bytes?.done) }
        const { done } = await importToResult()
        await answerOk(done)
        expect(h.pieceSaves).toBe(1)
        expect(during.length).toBeGreaterThan(1)
        expect(during.every((value) => typeof value === 'number'), 'expected bytes on the card during the save').toBe(true)
        const numbers = during as number[]
        expect(numbers[numbers.length - 1]).toBeGreaterThan(numbers[0])
    })

    test('R-a4 (RR-m): a module .json goes Read, Check, Add and ends on a result card', async () => {
        h.files = [new File([JSON.stringify({ type: 'risuModule', name: 'M', id: 'x' })], 'm.json')]
        const { done, view } = await importToResult()
        expect(view, 'expected a result card').not.toBeNull()
        expect(view?.result?.headline).toBe(language.importTaskImported(1))
        expect(h.marks).toEqual([3])
        await answerOk(done)
        expect(names()).toEqual(['M'])
    })

    test('R-a4 (RR-m): a .risum with an asset saves it on Save assets and writes the module on Add', async () => {
        h.files = [risum('a.risum', 'A', { records: [patterned(10, 1)] })]
        const saving: (number | null)[] = []
        h.saveHook = () => { saving.push(taskStepIndex()) }
        const { done } = await importToResult()
        await answerOk(done)
        expect(saving).toEqual([2])
        expect(h.marks).toEqual([3])
    })

    test('R-a3 (RR-m): the Save-assets bytes include the records already saved, whole and in pieces', async () => {
        const first = patterned(20 * 1024 * 1024, 1)
        const small = [patterned(100, 2), patterned(200, 3)]
        h.files = [risum('a.risum', 'A', { records: [...small, first] })]
        const during: { done: number, total: number }[] = []
        h.pieceHook = () => {
            const bytes = taskHostView()?.bytes
            if (bytes) during.push({ done: bytes.done, total: bytes.total })
        }
        const { done } = await importToResult()
        await answerOk(done)
        expect(during.length).toBeGreaterThan(1)
        const last = during[during.length - 1]
        //Both whole records are counted with the piece-saved one when its last piece lands.
        expect(last.done).toBe(last.total)
        expect(last.total).toBeGreaterThanOrEqual(first.length + 300)
    })

    test('R-a3 (RR-m): the bytes of an earlier piece-saved record stay counted during the next one', async () => {
        const bigger = patterned(20 * 1024 * 1024, 1)
        const second = patterned(17 * 1024 * 1024, 2)
        h.files = [risum('a.risum', 'A', { records: [bigger, second] })]
        const duringSecond: number[] = []
        h.pieceHook = () => {
            if (h.pieceSaves === 2) duringSecond.push(taskHostView()?.bytes?.done ?? -1)
        }
        const { done } = await importToResult()
        await answerOk(done)
        expect(duringSecond.length).toBeGreaterThan(0)
        expect(Math.min(...duringSecond)).toBeGreaterThanOrEqual(bigger.length)
    })

    test('R-a5 (RR): five files are one card that names the file, and the unsupported one is listed', async () => {
        h.files = [risum('a.risum', 'A', { records: [patterned(10, 1)] }), risum('b.risum', 'B', { records: [patterned(10, 2)] }), new File(['x'], 'notes.txt')]
        const files: (TaskView['file'])[] = []
        h.saveHook = () => { files.push(taskHostView()?.file) }
        const { done, view } = await importToResult()
        expect(files.map((f) => f && `${f.index + 1}/${f.total}`)).toEqual(['1/3', '2/3'])
        expect(view?.result?.skipped?.map((s) => s.name)).toEqual(['notes.txt'])
        await answerOk(done)
        expect(names()).toEqual(['A', 'B'])
    })
})

describe('Cancel before the first write', () => {
    test('R-a6 (RR-m): Cancel during the scan of file 1 ends Cancelled, writes nothing and never reads file 2', async () => {
        const second = risum('b.risum', 'B', { records: [patterned(10, 2)] })
        h.files = [risum('a.risum', 'A', { records: [patterned(10, 1)] }), second]
        const reads: Record<string, number> = {}
        h.beforeRead = (file) => {
            reads[file] = (reads[file] ?? 0) + 1
            if (file === 'a.risum' && reads[file] === 1) requestTaskCancel()
        }
        const { done, view } = await importToResult()
        expect(view?.cancelled, 'expected a Cancelled card').toBe(true)
        expect(h.saves).toEqual([])
        expect(h.marks).toEqual([])
        expect(h.modules).toEqual([])
        expect(reads['b.risum']).toBeUndefined()
        await answerOk(done)
        expect(busyKinds()).toEqual([])
    })

    test('R-a7 (RR-m): once the first asset is saved Cancel is not offered and a press is ignored', async () => {
        h.files = [risum('a.risum', 'A', { records: [patterned(10, 1)] })]
        let offered: boolean | undefined
        h.saveHook = () => {
            offered = taskHostView()?.cancelOffered
            requestTaskCancel()
        }
        const { done, view } = await importToResult()
        expect(offered, 'expected the card to withdraw Cancel at the first save').toBe(false)
        expect(view?.cancelled).toBe(false)
        await answerOk(done)
        expect(names()).toEqual(['A'])
    })

    test('R-a9 (RR-m): a module .json cancelled between its low-level prompt and the placement adds nothing', async () => {
        h.files = [new File([JSON.stringify({ type: 'risuModule', name: 'M', id: 'x', lowLevelAccess: true })], 'm.json')]
        h.confirmHook = () => { requestTaskCancel() }
        const { done, view } = await importToResult()
        expect(view?.cancelled, 'expected a Cancelled card').toBe(true)
        expect(h.marks).toEqual([])
        await answerOk(done)
        expect(h.modules).toEqual([])
    })

    test('R-a10 (RR-m): a Cancel pressed at the last checkpoint before the first write writes nothing', async () => {
        const cases: { label: string, file: () => File, replaceStub?: boolean }[] = [
            { label: 'risum with an asset', file: () => risum('a.risum', 'A', { records: [patterned(10, 1)], module: { lowLevelAccess: true } }) },
            { label: 'risum with no asset', file: () => risum('a.risum', 'A', { module: { lowLevelAccess: true } }) },
            {
                label: 'risum with no asset replacing a stub',
                file: () => risum('a.risum', 'Synthetic'),
                replaceStub: true,
            },
            { label: 'module json', file: () => new File([JSON.stringify({ type: 'risuModule', name: 'M', id: 'x', lowLevelAccess: true })], 'm.json') },
        ]
        for (const c of cases) {
            h.modules = c.replaceStub ? [{ id: 'stub1', name: 'Synthetic', [MODULE_STUB_KEY]: MODULE_STUB_VALUE }] : []
            h.files = [c.file()]
            h.saves = []
            h.marks = []
            h.stubLoads = 0
            h.confirmHook = () => { requestTaskCancel() }
            h.selectHook = () => { requestTaskCancel() }
            const { done, view } = await importToResult()
            expect(view?.cancelled, c.label).toBe(true)
            expect(h.saves, c.label).toEqual([])
            expect(h.pieceSaves, c.label).toBe(0)
            expect(h.marks, c.label).toEqual([])
            expect(h.stubLoads, c.label).toBe(0)
            expect(h.modules.length, c.label).toBe(c.replaceStub ? 1 : 0)
            await answerOk(done)
        }
    })

    test('R-a10 (RR-m): a Cancel pressed on the last scan read is caught before the low-level prompt', async () => {
        const make = () => risum('a.risum', 'A', { records: [patterned(10, 1)], module: { lowLevelAccess: true } })
        h.files = [make()]
        let total = 0
        let scanReads = 0
        h.beforeRead = () => { total += 1 }
        h.confirmHook = () => { scanReads = total }
        const first = await importToResult()
        await answerOk(first.done)
        expect(scanReads).toBeGreaterThan(0)

        h.modules = []
        h.files = [make()]
        h.saves = []
        let seen = 0
        let prompts = 0
        h.confirmHook = () => { prompts += 1 }
        h.beforeRead = () => {
            seen += 1
            if (seen === scanReads) requestTaskCancel()
        }
        const second = await importToResult()
        expect(second.view?.cancelled).toBe(true)
        expect(prompts).toBe(0)
        expect(h.saves).toEqual([])
        await answerOk(second.done)
    })
})

describe('Retry and the legacy surfaces', () => {
    test('R-a11 (RR-m): a file whose saves fail is retried alone and the library ends with each module once', async () => {
        h.files = [
            risum('a.risum', 'A', { records: [patterned(10, 1)] }),
            risum('b.risum', 'B', { records: [patterned(10, 2)] }),
            risum('c.risum', 'C', { records: [patterned(10, 3)] }),
        ]
        const reads: Record<string, number> = {}
        h.beforeRead = (file, start) => { if (start === 0) reads[file] = (reads[file] ?? 0) + 1 }
        h.saveHook = () => { if (h.saves[h.saves.length - 1] === patterned(10, 2)[0]) h.saveFailures = 1 }
        const { done, view } = await importToResult()
        expect(view?.result?.actions?.map((a) => a.id), 'expected a Retry action').toEqual(['retry'])
        expect(names()).toEqual(['A', 'C'])
        h.saveHook = null
        answerTask({ kind: 'action', id: 'retry' })
        for (let i = 0; i < 400 && !taskResultShowing(); i++) await new Promise((resolve) => setTimeout(resolve, 0))
        expect(taskHostView()?.result?.headline).toBe(language.importTaskImported(1))
        await answerOk(done)
        expect(names().sort()).toEqual(['A', 'B', 'C'])
        expect(reads['a.risum']).toBe(1)
        expect(reads['b.risum']).toBe(2)
    })

    test('R-a13 (RR-m): a tasked 9 MiB .risum posts no legacy wait, and the low-level prompt still shows', async () => {
        h.files = [risum('a.risum', 'A', { records: [patterned(9 * 1024 * 1024, 1)], module: { lowLevelAccess: true } })]
        const legacy: string[] = []
        h.beforeRead = () => { legacy.push(h.alert.v.type) }
        h.confirmHook = () => { legacy.push(h.alert.v.type) }
        h.saveHook = () => { legacy.push(h.alert.v.type) }
        const { done } = await importToResult()
        await answerOk(done)
        expect(legacy.filter((type) => type === 'wait' || type === 'progress')).toEqual([])
        expect(names()).toEqual(['A'])
    })

    test('R-a18 (RR-m): a single refused module is a fail card with the reason and no Retry', async () => {
        h.files = [risum('a.risum', 'A', { magic: 0 })]
        const { done, view } = await importToResult()
        expect(view?.failure?.headline).toBe(language.importTaskFailedOne('a.risum'))
        expect(view?.failure?.detail).toBe(language.errors.noData)
        expect(view?.failure?.actions ?? []).toEqual([])
        await answerOk(done)
    })

    test('R-a14 (CG): readModule without a task card keeps its 8 MiB wait and clears it (stays true before and after)', async () => {
        const { readModule } = await import('src/ts/process/modules')
        const waits: string[] = []
        h.saveHook = () => { waits.push(h.alert.v.type) }
        await readModule(risumBytes({ records: [patterned(9 * 1024 * 1024, 1)], module: { name: 'Big' } }))
        expect(h.alert.v.type).toBe('none')
        expect(waits.length).toBeGreaterThan(0)
    })
})

describe('the .charx module route in 2a', () => {
    test('R-a25 (RR-m): from the start of a .charx module file Cancel is withdrawn and a press is refused', async () => {
        h.files = [
            risum('x.charx', 'X'),
            risum('y.risum', 'Y', { records: [patterned(10, 2)] }),
        ]
        const offered: (boolean | undefined)[] = []
        h.cardHook = async () => {
            offered.push(taskHostView()?.cancelOffered)
            requestTaskCancel()
            return { kind: 'declined' }
        }
        h.beforeRead = (file) => {
            if (file === 'y.risum') requestTaskCancel()
        }
        const { done, view } = await importToResult()
        expect(h.cardStarted).toBe(1)
        expect(offered, 'expected Cancel to be withdrawn when x starts').toEqual([false])
        expect(view?.cancelled).toBe(false)
        expect(view?.result?.skipped?.map((s) => s.name)).toEqual(['x.charx'])
        await answerOk(done)
        expect(names()).toEqual(['Y'])
    })
})

describe('duplicates, the commit marker and the module screens', () => {
    const installed = (id: string, name: string) => ({ id, name })
    const json = (file: string, name: string) => new File([JSON.stringify({ type: 'risuModule', name, id: 'x' })], file)

    test('R-a21 (RR-m): a failure after the module is placed shows the data state unknown and offers no Retry', async () => {
        h.modules = [installed('ida', 'D')]
        h.files = [risum('d.risum', 'D')]
        h.selectAnswer = '0'
        h.describeThrows = true
        const { done, view } = await importToResult()
        expect(view?.failure?.headline).toBe(language.importTaskFailedOne('d.risum'))
        expect(view?.failure?.dataState).toBe('unknown')
        expect(view?.failure?.actions ?? []).toEqual([])
        expect(h.marks).toHaveLength(1)
        await answerOk(done)
        expect(h.modules).toHaveLength(1)
        expect((h.modules as { id: string }[])[0].id).toBe('ida')
    })

    test('R-a21 json: a failure after a .json module is placed shows the data state unknown, never "no data"', async () => {
        h.modules = [installed('ida', 'D')]
        h.files = [json('d.json', 'D')]
        h.selectAnswer = '0'
        h.describeThrows = true
        const { done, view } = await importToResult()
        expect(view?.result?.skipped ?? []).toEqual([])
        expect(view?.failure?.headline).toBe(language.importTaskFailedOne('d.json'))
        expect(view?.failure?.dataState).toBe('unknown')
        expect(view?.failure?.actions ?? []).toEqual([])
        expect(h.marks).toHaveLength(1)
        await answerOk(done)
    })

    test('R-a21 (RR-m): a failure before the module is placed keeps the data state and offers Retry', async () => {
        h.files = [risum('a.risum', 'A', { records: [patterned(10, 1)] })]
        h.saveFailures = 100
        const { done, view } = await importToResult()
        expect(view?.failure?.dataState).toBe('same')
        expect(view?.failure?.actions?.map((a) => a.id)).toEqual(['retry'])
        expect(h.marks).toEqual([])
        answerTask({ kind: 'ok' })
        await done
    })

    test('N3 (RR-m): a retried duplicate is asked again after "replace all remaining" in the first round', async () => {
        h.modules = [installed('ida', 'A'), installed('idc', 'C')]
        h.files = [
            risum('a.risum', 'A', { records: [patterned(10, 1)] }),
            risum('c.risum', 'C', { records: [patterned(10, 3)] }),
        ]
        //The first answer is the "all remaining" form of Replace; the second is a single Replace.
        h.selectAnswers = ['3', '0']
        h.saveHook = () => { if (h.saves[h.saves.length - 1] === patterned(10, 3)[0]) h.saveFailures = 1 }
        const { done, view } = await importToResult()
        expect(view?.result?.actions?.map((a) => a.id), 'expected a Retry action').toEqual(['retry'])
        expect(h.selectLog).toEqual([6])
        h.saveHook = null
        answerTask({ kind: 'action', id: 'retry' })
        for (let i = 0; i < 400 && !taskResultShowing(); i++) await new Promise((resolve) => setTimeout(resolve, 0))
        //Round 2 has one file, so the "all remaining" options are not offered again.
        expect(h.selectLog).toEqual([6, 3])
        await answerOk(done)
        expect((h.modules as { id: string }[]).map((m) => m.id)).toEqual(['ida', 'idc'])
    })

    test('the "all remaining" options are offered only on a file that has a later file', async () => {
        h.modules = [installed('ida', 'D'), installed('idb', 'E')]
        h.files = [json('d.json', 'D'), json('e.json', 'E')]
        h.selectAnswer = '1'
        const { done } = await importToResult()
        await answerOk(done)
        expect(h.selectLog).toEqual([6, 3])
    })

    test('the module screens are told to reload once, after the result card is answered', async () => {
        h.modules = [installed('ida', 'D')]
        h.files = [json('d.json', 'D')]
        h.selectAnswer = '0'
        const { done, view } = await importToResult()
        expect(view?.result?.headline).toBe(language.importTaskImported(1))
        expect(h.bumps).toEqual([])
        await answerOk(done)
        expect(h.bumps).toEqual([false])
    })

    test('an add, not a replace, does not reload the module screens', async () => {
        h.files = [json('d.json', 'D')]
        const { done } = await importToResult()
        await answerOk(done)
        expect(h.bumps).toEqual([])
    })
})

describe('what stays as it is', () => {
    test('R-a16 (RR-m): busy and the working token end with the round and are gone while the result waits', async () => {
        h.files = [risum('a.risum', 'A', { records: [patterned(10, 1)] })]
        const during: string[][] = []
        h.saveHook = () => { during.push(busyKinds()) }
        const { done, view } = await importToResult()
        expect(view).not.toBeNull()
        expect(during).toEqual([['import']])
        expect(busyKinds()).toEqual([])
        expect(inFlightKinds()).not.toContain('busy')
        await answerOk(done)
    })
})
