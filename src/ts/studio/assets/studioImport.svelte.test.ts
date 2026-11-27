// @vitest-environment jsdom
// The import job of Studio's Add (S3c): per-file store results, one history step per pick, the visit binding of the
// batch (MC-4135), the refusal wording, and Try again. The history service is the real one over the memory store double,
// except where a test needs a refusal; the chooser, the store and the toast host are injected.
import { flushSync } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DBState, selIdState } from 'src/ts/stores.svelte'
import { language } from 'src/lang'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { createOwnerHistoryService, type OwnerHistoryService, type StudioRefusal } from 'src/ts/studio/history/ownerHistory.svelte'
import { characterOwnerKey } from 'src/ts/studio/history/ownerPhase'
import { createFakeClock, drainMicrotasks } from 'src/ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from 'src/ts/studio/history/tests/studioStoreDoubles'
import { refusalText } from 'src/ts/studio/edit/studioToasts'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import type { ImportLanding } from 'src/lib/Studio/assets/StudioAssetList.svelte'
import { pickFiles, type PickDeps, type PickKind, type PickOutcome } from './filePicker'
import {
    createImportPicker,
    dropImportEntry,
    importEntriesOf,
    resetStudioImportsForTests,
    retryImportEntry,
    startImport,
    type ImportArray,
    type ImportDeps,
} from './studioImport.svelte'

vi.mock('src/ts/globalApi.svelte', () => ({
    getSaveMarkCount: () => 0,
    pickedAssetLimitBytes: async () => 1000,
    saveAssetFromBlob: async () => 'never',
    saveAsset: async () => 'never',
}))
vi.mock('src/ts/util', () => ({ readPickedFileBytes: vi.fn(), selectMultipleFileObjects: vi.fn(), selectSingleFileObject: vi.fn() }))
vi.mock('src/ts/storage/pickedAssetLimit', () => ({
    reportRefusedAssets: vi.fn(),
    splitByAssetLimit: (files: { size: number }[], limit: number) => ({ within: files.filter((f) => f.size <= limit), refused: files.filter((f) => f.size > limit) }),
}))
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

type Row = string[]
interface LiveCharacter {
    chaId: string
    desc: string
    alternateGreetings: string[]
    chats: { id: string; note: string; fmIndex?: number }[]
    chatPage: number
    additionalAssets?: Row[]
    emotionImages?: Row[]
}

const A = characterOwnerKey('A')
const live = (): LiveCharacter => (DBState.db.characters as unknown as LiveCharacter[])[0]
const file = (name: string, size = 10): File => ({ name, size }) as unknown as File
const picked = (...files: File[]): PickOutcome => ({ kind: 'picked', files, badType: [], tooLarge: [] })

interface Gate {
    promise: Promise<string>
    resolve(path: string): void
    reject(): void
}

function gate(): Gate {
    let resolve!: (path: string) => void
    let reject!: () => void
    const promise = new Promise<string>((res, rej) => {
        resolve = res
        reject = () => rej(new Error('store failed'))
    })
    return { promise, resolve, reject }
}

interface Rig {
    deps: ImportDeps
    posts: { kind?: string; text: string; sub?: string }[]
    queues: Record<string, Gate[]>
    storeCalls: string[]
    picks: PickKind[]
    busy: { began: number; ended: number }
    landed: string[]
    service: OwnerHistoryService
}

let service: OwnerHistoryService
let landedSteps: string[]
const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }

async function openService(character: LiveCharacter): Promise<void> {
    DBState.db.characters = [character] as unknown as typeof DBState.db.characters
    landedSteps = []
    service = createOwnerHistoryService({
        store: createMemoryStudioStore(),
        claim: createClaimDouble(),
        clock: createFakeClock(),
        pageSession: 'p1',
        getVisitId: () => 'v1',
        registerLeaveFlush: () => () => {},
        openModuleId: () => null,
        onLanded: (_owner, top) => landedSteps.push(top ?? ''),
    })
    await service.whenReady(A)
}

function blank(extra: Partial<LiveCharacter> = {}): LiveCharacter {
    return { chaId: 'A', desc: 'd', alternateGreetings: [], chats: [{ id: 'c1', note: '', fmIndex: 0 }], chatPage: 0, emotionImages: [], ...extra }
}

// Each store call takes the next queued gate of its file name.
function rig(over: Partial<ImportDeps> = {}, files: File[] = []): Rig {
    const queues: Record<string, Gate[]> = {}
    const posts: Rig['posts'] = []
    const storeCalls: string[] = []
    const picks: PickKind[] = []
    const busy = { began: 0, ended: 0 }
    const take = (name: string): Promise<string> => {
        storeCalls.push(name)
        const next = queues[name]?.shift()
        if (next === undefined) throw new Error(`no gate queued for ${name}`)
        return next.promise
    }
    const deps: ImportDeps = {
        pickFiles: async (kind) => {
            picks.push(kind)
            return picked(...files)
        },
        storeAsset: (f) => take(f.name),
        storeEmotion: (f) => take(f.name),
        service: () => service,
        toastHost: { post: (init) => { posts.push({ kind: init.kind, text: init.text, ...(init.sub === undefined ? {} : { sub: init.sub }) }); return 1 } },
        beginBusy: () => {
            busy.began += 1
            return { end: () => { busy.ended += 1 } }
        },
        ...over,
    }
    return { deps, posts, queues, storeCalls, picks, busy, landed: [], service }
}

function queue(r: Rig, name: string, ...gates: Gate[]): Gate[] {
    r.queues[name] = [...(r.queues[name] ?? []), ...gates]
    return gates
}

// A gate that is already resolved.
function done(path: string): Gate {
    const g = gate()
    g.resolve(path)
    return g
}

function failed(): Gate {
    const g = gate()
    g.promise.catch(() => {})
    g.reject()
    return g
}

function openVisit(id = 'v1'): void {
    studioScreen.open = true
    studioScreen.visitId = id
    studioScreen.chaId = 'A'
}

const paths = (rows: Row[] | undefined): string[] => (rows ?? []).map((row) => row[1])
const entriesOf = (array: ImportArray = 'additionalAssets') => importEntriesOf(A, array)

beforeEach(async () => {
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => {} })
    resetStudioScreenForTests()
    resetStudioImportsForTests()
    selIdState.selId = 0
    openVisit()
    await openService(blank())
})

afterEach(() => {
    resetStudioImportsForTests()
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
})

async function settleAll(): Promise<void> {
    await drainMicrotasks()
    flushSync()
    await drainMicrotasks()
}

describe('C-T2 and C-T3: one step per pick', () => {
    test('C-T2: an asset pick of two files is one step with two rows, and the landing is told both names once', async () => {
        const r = rig({}, [file('a.png'), file('b.png')])
        queue(r, 'a.png', done('assets/a'))
        queue(r, 'b.png', done('assets/b'))
        const names: string[][] = []
        const landing: ImportLanding = { folder: 'F', land: (n) => { names.push([...n]); return { landed: true, notes: [], refusal: null } } }
        await startImport(A, 'additionalAssets', landing, r.deps)
        expect(live().additionalAssets).toEqual([['a.png', 'assets/a', 'png'], ['b.png', 'assets/b', 'png']])
        expect(landedSteps).toHaveLength(1)
        expect(names).toEqual([['a.png', 'b.png']])
        expect(r.posts).toEqual([{ kind: 'success', text: language.studioPickResult(2, 0) }])
    })

    test('C-T3: an emotion pick names rows from the file names, reports the bad type, hands the large file to the picker, and lands the rest in one step', async () => {
        const reported: string[][] = []
        const pickDeps: PickDeps = {
            chooseSingle: async () => null,
            chooseMultiple: async () => [file('photo.gif'), file('a.b.webp'), file('c.bmp'), file('big.png', 5000)],
            limitBytes: async () => 1000,
            reportTooLarge: (refused) => { if (refused.length > 0) reported.push(refused.map((f) => f.name)) },
        }
        const r = rig({ pickFiles: (kind) => pickFiles(kind, pickDeps) })
        queue(r, 'photo.gif', done('assets/p'))
        queue(r, 'a.b.webp', done('assets/q'))
        await startImport(A, 'emotionImages', undefined, r.deps)
        expect(live().emotionImages).toEqual([['photo', 'assets/p'], ['a.b', 'assets/q']])
        expect(reported).toEqual([['big.png']])
        expect(landedSteps).toHaveLength(1)
        expect(r.posts).toEqual([
            { kind: 'warning', text: language.studioImportRefused(1), sub: language.studioPickBadType('.bmp') },
            { kind: 'success', text: language.studioPickResult(2, 0) },
        ])
    })
})

describe('C-T4: a file that does not store', () => {
    test('(a) the others land in one step, the failed one waits, Try again lands it as a second step, and Remove drops an entry', async () => {
        const r = rig({}, [file('a.png'), file('b.png'), file('c.png'), file('d.png')])
        queue(r, 'a.png', done('assets/a'))
        queue(r, 'b.png', failed())
        queue(r, 'c.png', done('assets/c'))
        queue(r, 'd.png', failed())
        await startImport(A, 'additionalAssets', undefined, r.deps)
        expect(paths(live().additionalAssets)).toEqual(['assets/a', 'assets/c'])
        expect(landedSteps).toHaveLength(1)
        expect(r.posts).toEqual([{ kind: 'warning', text: language.studioPickResult(2, 2) }])
        expect(entriesOf().map((e) => [e.name, e.state])).toEqual([['b.png', 'failed'], ['d.png', 'failed']])
        expect(paths(live().additionalAssets).every((p) => p !== '')).toBe(true)

        queue(r, 'b.png', done('assets/b'))
        const first = entriesOf()[0]
        await retryImportEntry(first.batchId, first.id)
        expect(paths(live().additionalAssets)).toEqual(['assets/a', 'assets/c', 'assets/b'])
        expect(landedSteps).toHaveLength(2)
        expect(r.posts[1]).toEqual({ kind: 'success', text: language.studioPickResult(1, 0) })
        expect(entriesOf().map((e) => e.name)).toEqual(['d.png'])

        const last = entriesOf()[0]
        dropImportEntry(last.batchId, last.id)
        expect(entriesOf()).toEqual([])
        expect(live().additionalAssets).toHaveLength(3)
    })

    test('(b) a retry that lands while the loop is held does not count as a failure of the loop', async () => {
        const r = rig({}, [file('a.png'), file('b.png'), file('c.png')])
        const heldB = gate()
        queue(r, 'a.png', failed())
        queue(r, 'b.png', heldB)
        queue(r, 'c.png', done('assets/c'))
        const running = startImport(A, 'additionalAssets', undefined, r.deps)
        await drainMicrotasks()
        const entry = entriesOf().find((e) => e.name === 'a.png')
        expect(entry?.state).toBe('failed')
        queue(r, 'a.png', done('assets/a'))
        await retryImportEntry(entry!.batchId, entry!.id)
        expect(paths(live().additionalAssets)).toEqual(['assets/a'])
        heldB.resolve('assets/b')
        await running
        expect(paths(live().additionalAssets)).toEqual(['assets/a', 'assets/b', 'assets/c'])
        expect(r.posts.map((p) => p.text)).toEqual([language.studioPickResult(1, 0), language.studioPickResult(2, 0)])
        expect(r.posts[1].kind).toBe('success')
    })
})

describe('C-T5: busy', () => {
    test('busy exists during the store phase and ends after it', async () => {
        const r = rig({}, [file('a.png')])
        const g = gate()
        queue(r, 'a.png', g)
        const running = startImport(A, 'additionalAssets', undefined, r.deps)
        await drainMicrotasks()
        expect(r.busy).toEqual({ began: 1, ended: 0 })
        g.resolve('assets/a')
        await running
        expect(r.busy).toEqual({ began: 1, ended: 1 })
    })

    test('busy ends also when every store throws', async () => {
        const r = rig({}, [file('a.png'), file('b.png')])
        queue(r, 'a.png', failed())
        queue(r, 'b.png', failed())
        await startImport(A, 'additionalAssets', undefined, r.deps)
        expect(r.busy).toEqual({ began: 1, ended: 1 })
        expect(r.posts).toEqual([{ kind: 'warning', text: language.studioPickResult(0, 2) }])
    })
})

describe('C-T8: the batch belongs to its visit (MC-4135)', () => {
    const cases: { array: ImportArray; read: () => Row[] | undefined }[] = [
        { array: 'additionalAssets', read: () => live().additionalAssets },
        { array: 'emotionImages', read: () => live().emotionImages },
    ]

    test.each(cases)('$array: Studio closing while the first file stores stores nothing more, lands nothing, and posts one not-added of 3', async ({ array, read }) => {
        const before = JSON.stringify(read() ?? null)
        const r = rig({}, [file('a.png'), file('b.png'), file('c.png')])
        const held = gate()
        queue(r, 'a.png', held)
        let landCalls = 0
        const landing: ImportLanding = { folder: null, land: () => { landCalls += 1; return { landed: true, notes: [], refusal: null } } }
        const running = startImport(A, array, landing, r.deps)
        await drainMicrotasks()
        studioScreen.open = false
        flushSync()
        held.resolve('assets/a')
        await running
        await settleAll()
        expect(JSON.stringify(read() ?? null)).toBe(before)
        expect(landedSteps).toEqual([])
        expect(landCalls).toBe(0)
        expect(r.storeCalls).toEqual(['a.png'])
        expect(r.posts).toEqual([{ kind: 'warning', text: language.studioImportNotAdded(3) }])
        expect(entriesOf(array)).toEqual([])
        expect(JSON.stringify(live())).not.toContain('assets/a')
    })

    test.each(cases)('$array: a new visit while the first file stores gives the same result', async ({ array, read }) => {
        const before = JSON.stringify(read() ?? null)
        const r = rig({}, [file('a.png'), file('b.png'), file('c.png')])
        const held = gate()
        queue(r, 'a.png', held)
        const running = startImport(A, array, undefined, r.deps)
        await drainMicrotasks()
        studioScreen.visitId = 'v2'
        flushSync()
        held.resolve('assets/a')
        await running
        await settleAll()
        expect(JSON.stringify(read() ?? null)).toBe(before)
        expect(landedSteps).toEqual([])
        expect(r.storeCalls).toEqual(['a.png'])
        expect(r.posts).toEqual([{ kind: 'warning', text: language.studioImportNotAdded(3) }])
    })

    test('(c) a list that unmounts while the visit stays: the step lands, the landing answers nothing, no not-added toast', async () => {
        const r = rig({}, [file('a.png')])
        queue(r, 'a.png', done('assets/a'))
        const landing: ImportLanding = { folder: null, land: () => ({ landed: false, notes: [], refusal: null }) }
        await startImport(A, 'additionalAssets', landing, r.deps)
        expect(landedSteps).toHaveLength(1)
        expect(r.posts).toEqual([{ kind: 'success', text: language.studioPickResult(1, 0) }])
    })

    test('(d) the visit ends while the last file stores, with no flush before it resolves: no insert, one not-added of 1', async () => {
        const r = rig({}, [file('a.png')])
        const held = gate()
        queue(r, 'a.png', held)
        const running = startImport(A, 'additionalAssets', undefined, r.deps)
        await drainMicrotasks()
        studioScreen.open = false
        held.resolve('assets/a')
        await running
        await settleAll()
        expect(landedSteps).toEqual([])
        expect('additionalAssets' in live()).toBe(false)
        expect(r.posts).toEqual([{ kind: 'warning', text: language.studioImportNotAdded(1) }])
    })

    test('a pick that returns after the visit ended stores nothing and posts not-added of the accepted count', async () => {
        const chooser: { open?: (value: PickOutcome) => void } = {}
        const r = rig({ pickFiles: () => new Promise<PickOutcome>((resolve) => { chooser.open = resolve }) })
        const running = startImport(A, 'additionalAssets', undefined, r.deps)
        studioScreen.open = false
        chooser.open?.(picked(file('a.png'), file('b.png')))
        await running
        expect(r.storeCalls).toEqual([])
        expect(r.posts).toEqual([{ kind: 'warning', text: language.studioImportNotAdded(2) }])
    })
})

describe('C-T9: failed entries, retries and the visit', () => {
    test('(a) a failed entry is dropped when the visit ends, with one not-added of 1', async () => {
        const r = rig({}, [file('a.png'), file('b.png'), file('c.png')])
        queue(r, 'a.png', done('assets/a'))
        queue(r, 'b.png', failed())
        queue(r, 'c.png', done('assets/c'))
        await startImport(A, 'additionalAssets', undefined, r.deps)
        expect(entriesOf()).toHaveLength(1)
        r.posts.length = 0
        studioScreen.open = false
        flushSync()
        await settleAll()
        expect(entriesOf()).toEqual([])
        expect(r.posts).toEqual([{ kind: 'warning', text: language.studioImportNotAdded(1) }])
    })

    test('(b) a retry held across the end of the visit inserts nothing; one not-added of 1', async () => {
        const r = rig({}, [file('a.png')])
        queue(r, 'a.png', failed())
        await startImport(A, 'additionalAssets', undefined, r.deps)
        r.posts.length = 0
        const held = gate()
        queue(r, 'a.png', held)
        const entry = entriesOf()[0]
        const retrying = retryImportEntry(entry.batchId, entry.id)
        studioScreen.open = false
        held.resolve('assets/a')
        await retrying
        await settleAll()
        expect(landedSteps).toEqual([])
        expect('additionalAssets' in live()).toBe(false)
        expect(r.posts).toEqual([{ kind: 'warning', text: language.studioImportNotAdded(1) }])
    })

    test('(c) a settled retry does not end a batch whose loop still stores: one not-added of 3, after the loop', async () => {
        const r = rig({}, [file('a.png'), file('b.png'), file('c.png')])
        const heldB = gate()
        queue(r, 'a.png', failed())
        queue(r, 'b.png', heldB)
        const running = startImport(A, 'additionalAssets', undefined, r.deps)
        await drainMicrotasks()
        const entry = entriesOf().find((e) => e.name === 'a.png')!
        const heldRetry = gate()
        queue(r, 'a.png', heldRetry)
        const retrying = retryImportEntry(entry.batchId, entry.id)
        studioScreen.open = false
        flushSync()
        await settleAll()
        heldRetry.resolve('assets/a')
        await retrying
        await settleAll()
        expect(r.posts).toEqual([])
        expect(entriesOf().length).toBeGreaterThan(0)
        heldB.resolve('assets/b')
        await running
        await settleAll()
        expect(landedSteps).toEqual([])
        expect(r.storeCalls).toEqual(['a.png', 'b.png', 'a.png'])
        expect(r.posts).toEqual([{ kind: 'warning', text: language.studioImportNotAdded(3) }])
    })

    test('(d) Try again twice in a row stores once and adds one row', async () => {
        const r = rig({}, [file('a.png')])
        queue(r, 'a.png', failed())
        await startImport(A, 'additionalAssets', undefined, r.deps)
        const entry = entriesOf()[0]
        const held = gate()
        queue(r, 'a.png', held)
        const first = retryImportEntry(entry.batchId, entry.id)
        const second = retryImportEntry(entry.batchId, entry.id)
        held.resolve('assets/a')
        await Promise.all([first, second])
        expect(r.storeCalls).toEqual(['a.png', 'a.png'])
        expect(paths(live().additionalAssets)).toEqual(['assets/a'])
        expect(landedSteps).toHaveLength(1)
    })

    test('(e) a removed entry is not counted as not added when the visit ends', async () => {
        const r = rig({}, [file('a.png'), file('b.png'), file('c.png')])
        queue(r, 'a.png', done('assets/a'))
        queue(r, 'b.png', failed())
        queue(r, 'c.png', failed())
        await startImport(A, 'additionalAssets', undefined, r.deps)
        const removed = entriesOf().find((e) => e.name === 'b.png')!
        dropImportEntry(removed.batchId, removed.id)
        r.posts.length = 0
        studioScreen.open = false
        flushSync()
        await settleAll()
        expect(r.posts).toEqual([{ kind: 'warning', text: language.studioImportNotAdded(1) }])
    })
})

describe('C-T10: a refusal while Studio is open', () => {
    function refusing(reason: StudioRefusal, calls: { n: number } = { n: 0 }): ImportDeps['service'] {
        const refusingService = {
            view: () => ({ editable: true }),
            assetInsert: () => {
                calls.n += 1
                return { ok: false as const, reason }
            },
        } as unknown as NonNullable<ReturnType<ImportDeps['service']>>
        return () => refusingService
    }

    test.each<StudioRefusal>(['restricted', 'gone'])('(a) %s: one notice with the neutral text and the refusal as reason, no step, land not called', async (reason) => {
        const r = rig({ service: refusing(reason) }, [file('a.png'), file('b.png')])
        queue(r, 'a.png', done('assets/a'))
        queue(r, 'b.png', done('assets/b'))
        let landCalls = 0
        await startImport(A, 'additionalAssets', { folder: null, land: () => { landCalls += 1; return { landed: true, notes: [], refusal: null } } }, r.deps)
        await settleAll()
        expect(r.posts).toEqual([{ kind: 'warning', text: language.studioImportRefused(2), sub: refusalText(reason) }])
        expect(r.posts[0].text).not.toBe(language.studioImportNotAdded(2))
        expect(landCalls).toBe(0)
        expect(entriesOf()).toEqual([])
    })

    test('(a) not-selected reads as not added', async () => {
        const r = rig({ service: refusing('not-selected') }, [file('a.png'), file('b.png')])
        queue(r, 'a.png', done('assets/a'))
        queue(r, 'b.png', done('assets/b'))
        await startImport(A, 'additionalAssets', undefined, r.deps)
        expect(r.posts).toEqual([{ kind: 'warning', text: language.studioImportNotAdded(2) }])
    })

    test('(b) a retry held when the loop\'s insert is refused inserts nothing and posts no second toast', async () => {
        const calls = { n: 0 }
        const r = rig({ service: refusing('restricted', calls) }, [file('a.png'), file('b.png')])
        const heldB = gate()
        queue(r, 'a.png', failed())
        queue(r, 'b.png', heldB)
        const running = startImport(A, 'additionalAssets', undefined, r.deps)
        await drainMicrotasks()
        const entry = entriesOf().find((e) => e.name === 'a.png')!
        const heldRetry = gate()
        queue(r, 'a.png', heldRetry)
        const retrying = retryImportEntry(entry.batchId, entry.id)
        heldB.resolve('assets/b')
        await running
        heldRetry.resolve('assets/a')
        await retrying
        await settleAll()
        expect(calls.n).toBe(1)
        expect(r.posts).toEqual([{ kind: 'warning', text: language.studioImportRefused(2), sub: refusalText('restricted') }])
    })

    test('(c) a removed entry is not counted in the refusal', async () => {
        const r = rig({ service: refusing('restricted') }, [file('a.png'), file('b.png'), file('c.png')])
        const heldB = gate()
        queue(r, 'a.png', failed())
        queue(r, 'b.png', heldB)
        queue(r, 'c.png', done('assets/c'))
        const running = startImport(A, 'additionalAssets', undefined, r.deps)
        await drainMicrotasks()
        const entry = entriesOf().find((e) => e.name === 'a.png')!
        dropImportEntry(entry.batchId, entry.id)
        heldB.resolve('assets/b')
        await running
        await settleAll()
        expect(r.posts).toEqual([{ kind: 'warning', text: language.studioImportRefused(2), sub: refusalText('restricted') }])
    })
})

describe('C-T11: the view is not editable', () => {
    test('Add opens no chooser and posts nothing', async () => {
        const loading = { view: () => ({ editable: false }), assetInsert: () => ({ ok: false as const, reason: 'loading' as const }) } as unknown as NonNullable<ReturnType<ImportDeps['service']>>
        const r = rig({ service: () => loading }, [file('a.png')])
        await startImport(A, 'additionalAssets', undefined, r.deps)
        expect(r.picks).toEqual([])
        expect(r.posts).toEqual([])
        const picker = createImportPicker(A, 'emotionImages', r.deps)
        picker.open()
        await drainMicrotasks()
        expect(r.picks).toEqual([])
    })
})

describe('the picker', () => {
    test('a bad type and a cancelled pick', async () => {
        const r = rig({ pickFiles: async () => ({ kind: 'cancelled' }) })
        await startImport(A, 'additionalAssets', undefined, r.deps)
        expect(r.posts).toEqual([])
        const withBad = rig({ pickFiles: async () => ({ kind: 'picked', files: [], badType: [file('a.bmp'), file('b.tiff')], tooLarge: [] }) })
        await startImport(A, 'additionalAssets', undefined, withBad.deps)
        expect(withBad.posts).toEqual([{ kind: 'warning', text: language.studioImportRefused(2), sub: language.studioPickBadType('.bmp, .tiff') }])
        expect(withBad.storeCalls).toEqual([])
    })
})

describe('finalize-once and a failed retry', () => {
    test('C-T10 (d): a refusal while open, then the visit ends before a held retry resolves: exactly one toast', async () => {
        const refusingService = { view: () => ({ editable: true }), assetInsert: () => ({ ok: false as const, reason: 'restricted' as const }) } as unknown as NonNullable<ReturnType<ImportDeps['service']>>
        const r = rig({ service: () => refusingService }, [file('a.png'), file('b.png')])
        const heldB = gate()
        queue(r, 'a.png', failed())
        queue(r, 'b.png', heldB)
        const running = startImport(A, 'additionalAssets', undefined, r.deps)
        await drainMicrotasks()
        const entry = entriesOf().find((e) => e.name === 'a.png')!
        const heldRetry = gate()
        queue(r, 'a.png', heldRetry)
        const retrying = retryImportEntry(entry.batchId, entry.id)
        heldB.resolve('assets/b')
        await running
        studioScreen.open = false
        flushSync()
        heldRetry.resolve('assets/a')
        await retrying
        await settleAll()
        expect(r.posts).toEqual([{ kind: 'warning', text: language.studioImportRefused(2), sub: refusalText('restricted') }])
    })

    test('C-T4 (c): a retry that fails again returns the entry to failed, with Retry available again, and no toast', async () => {
        const r = rig({}, [file('a.png')])
        queue(r, 'a.png', failed())
        await startImport(A, 'additionalAssets', undefined, r.deps)
        r.posts.length = 0
        queue(r, 'a.png', failed())
        const entry = entriesOf()[0]
        await retryImportEntry(entry.batchId, entry.id)
        expect(entriesOf().map((e) => e.state)).toEqual(['failed'])
        expect(r.posts).toEqual([])
        queue(r, 'a.png', done('assets/a'))
        await retryImportEntry(entry.batchId, entry.id)
        expect(paths(live().additionalAssets)).toEqual(['assets/a'])
    })
})
