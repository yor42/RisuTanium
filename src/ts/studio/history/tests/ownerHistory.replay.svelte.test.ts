// @vitest-environment jsdom
// `replay` of the history service over the files an undo, redo or revert would put back: the file states are asked for
// first, a gone file's row is left out, anything not confirmed refuses and changes nothing, replays run one at a time
// in call order, the target is read when a job starts and checked again after the answers, and a job that throws never
// stops the next. Real service, history model and setters over the memory store double; the reader is a double.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DBState, selIdState } from 'src/ts/stores.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import type { ByteStore } from 'src/ts/storage/store/contract'
import { openAssetFileReader, type AssetFileReader, type AssetFileState } from 'src/ts/studio/assets/assetFileState'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { createOwnerHistoryService, REPLAY_BUDGET_MS, type OwnerHistoryService, type StudioResult } from '../ownerHistory.svelte'
import type { Step } from '../historyModel'
import { characterOwnerKey, type OwnerKey } from '../ownerPhase'
import { createFakeClock, drainMicrotasks, type FakeClock } from './historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore, seedOwner, type ClaimDouble, type MemoryStudioStore } from './studioStoreDoubles'

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

interface LiveCharacter {
    chaId: string
    desc: string
    alternateGreetings: string[]
    chats: { id: string; note: string; fmIndex?: number }[]
    chatPage: number
    additionalAssets: string[][]
    emotionImages: string[][]
}

const SMILE = ['smile', 'assets/smile.png', 'png']
const GRIN = ['grin', 'assets/grin.png', 'png']
const WAVE = ['wave', 'assets/wave.png', 'png']
const A = characterOwnerKey('A')

const live = (): LiveCharacter => (DBState.db.characters as unknown as LiveCharacter[])[0]
const names = (): string[] => live().additionalAssets.map((row) => row[0])

// The file reader the service is given. A path answers `present` unless `states` says otherwise; each question first
// waits for the next entry of `waits`, so a test can hold an answer back or never give it.
interface Files {
    states: Map<string, AssetFileState>
    asked: string[]
    opened: number
    openFails: boolean
    failing: Set<string>
    waits: (Promise<void> | null)[]
    open: () => Promise<AssetFileReader>
}

const never = new Promise<void>(() => {})

function release(): { promise: Promise<void>; release: () => void } {
    let resolve!: () => void
    const promise = new Promise<void>((done) => {
        resolve = done
    })
    return { promise, release: resolve }
}

function createFiles(): Files {
    const files: Files = {
        states: new Map(),
        asked: [],
        opened: 0,
        openFails: false,
        failing: new Set(),
        waits: [],
        open: async () => {
            files.opened += 1
            if (files.openFails) {
                throw new Error('no store')
            }
            return {
                concurrency: 8,
                stateOf: async (path) => {
                    files.asked.push(path)
                    const wait = files.waits.shift()
                    if (wait) {
                        await wait
                    }
                    if (files.failing.has(path)) {
                        throw new Error('read failed')
                    }
                    return files.states.get(path) ?? 'present'
                },
            }
        },
    }
    return files
}

interface Tracked<T> {
    settled: boolean
    value: T | undefined
}

function track<T>(promise: Promise<T>): Tracked<T> {
    const box: Tracked<T> = { settled: false, value: undefined }
    void promise.then((value) => {
        box.settled = true
        box.value = value
    })
    return box
}

interface Harness {
    clock: FakeClock
    store: MemoryStudioStore
    claim: ClaimDouble
    files: Files
    service: OwnerHistoryService
    landed: [OwnerKey, string | null][]
}

let harness: Harness

function build(open?: () => Promise<AssetFileReader>): Harness {
    const clock = createFakeClock()
    const store = createMemoryStudioStore()
    const claim = createClaimDouble()
    const files = createFiles()
    const landed: [OwnerKey, string | null][] = []
    const service = createOwnerHistoryService({
        store,
        claim,
        clock,
        pageSession: 'p1',
        getVisitId: () => 'v1',
        registerLeaveFlush: () => () => {},
        onLanded: (owner, top) => landed.push([owner, top]),
        openAssetFileReader: open ?? files.open,
    })
    return { clock, store, claim, files, service, landed }
}

const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }

beforeEach(async () => {
    h.marks = 0
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
    resetStudioScreenForTests()
    DBState.db.characters = [
        {
            chaId: 'A',
            desc: 'd0',
            alternateGreetings: ['g0'],
            chats: [{ id: 'c1', note: '', fmIndex: 0 }],
            chatPage: 0,
            additionalAssets: [[...SMILE], [...GRIN], [...WAVE], ['smile2', 'assets/smile.png', 'png']],
            emotionImages: [],
        },
    ] as unknown as typeof DBState.db.characters
    DBState.db.modules = [] as unknown as typeof DBState.db.modules
    selIdState.selId = 0
    studioScreen.chaId = 'A'
    harness = build()
    await harness.service.whenReady(A)
})

afterEach(() => {
    vi.restoreAllMocks()
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
})

// Everything a refused replay must leave alone: the rows, the field, both stacks and the save mark count.
function state(): string {
    const view = harness.service.view(A)
    return JSON.stringify({
        rows: live().additionalAssets,
        desc: live().desc,
        done: view.done.map((step) => step.id),
        undone: view.undone.map((step) => step.id),
        marks: h.marks,
    })
}

function deleteGrin(): void {
    expect(harness.service.assetDelete(A, 'additionalAssets', [1]).ok).toBe(true)
}

const UNCHECKED_GRIN = { ok: false, reason: 'asset-file-unchecked', name: 'grin' }

describe('a replay puts a row back only over a file that was read as present', () => {
    test('a present file is put back with its row and the result names no gone row', async () => {
        deleteGrin()
        const result = await harness.service.replay(A, { kind: 'undo' })
        expect(result).toMatchObject({ ok: true })
        expect(result).not.toHaveProperty('goneRows')
        expect(names()).toEqual(['smile', 'grin', 'wave', 'smile2'])
        expect(harness.files.asked).toEqual(['assets/grin.png'])
    })

    test.each([
        ['the read of a file fails', (files: Files) => files.failing.add('assets/grin.png')],
        ['the store cannot be opened', (files: Files) => { files.openFails = true }],
        ['the store answers unknown', (files: Files) => files.states.set('assets/grin.png', 'unknown')],
    ])('when %s, the undo is refused with the row named and nothing changes', async (_name, arrange) => {
        deleteGrin()
        arrange(harness.files)
        const before = state()
        const landedBefore = harness.landed.length
        expect(await harness.service.replay(A, { kind: 'undo' })).toEqual(UNCHECKED_GRIN)
        expect(state()).toBe(before)
        expect(harness.landed).toHaveLength(landedBefore)
    })

    test('a refused revert leaves the open text step open', async () => {
        expect(harness.service.assetRename(A, 'additionalAssets', 2, 'wave2').ok).toBe(true)
        const baseId = harness.service.view(A).done[0].id
        deleteGrin()
        expect(harness.service.editField(A, 'desc', 'x').ok).toBe(true)
        harness.files.failing.add('assets/grin.png')
        const before = state()
        expect(await harness.service.replay(A, { kind: 'revert', stepId: baseId })).toEqual(UNCHECKED_GRIN)
        expect(state()).toBe(before)
        // The open step still takes the next edit, so the history gains no step.
        expect(harness.service.editField(A, 'desc', 'xy').ok).toBe(true)
        expect(harness.service.view(A).done).toHaveLength(3)
    })

    test('a synchronous undo has no answers, so it refuses every row it would put back', async () => {
        deleteGrin()
        const before = state()
        expect(harness.service.undo(A)).toEqual(UNCHECKED_GRIN)
        expect(state()).toBe(before)
        expect(harness.files.asked).toEqual([])
    })

    test('the answers of one replay never reach a later synchronous undo of the same row', async () => {
        deleteGrin()
        expect((await harness.service.replay(A, { kind: 'undo' })).ok).toBe(true)
        expect(harness.service.redo(A).ok).toBe(true)
        expect(names()).toEqual(['smile', 'wave', 'smile2'])
        expect(harness.service.undo(A)).toEqual(UNCHECKED_GRIN)
        expect(names()).toEqual(['smile', 'wave', 'smile2'])
    })

    test('a gone file leaves its row out, names it and drops a step that has nothing else', async () => {
        deleteGrin()
        harness.files.states.set('assets/grin.png', 'gone')
        expect(await harness.service.replay(A, { kind: 'undo' })).toMatchObject({ ok: true, dropped: true, goneRows: ['assets/grin.png'], goneName: 'grin' })
        expect(names()).toEqual(['smile', 'wave', 'smile2'])
        expect(harness.service.view(A).done).toHaveLength(0)
        expect(harness.service.view(A).undone).toHaveLength(0)
    })

    test('a revert across a delete of a gone file lands nothing and names it', async () => {
        expect(harness.service.assetRename(A, 'additionalAssets', 2, 'wave2').ok).toBe(true)
        const baseId = harness.service.view(A).done[0].id
        deleteGrin()
        harness.files.states.set('assets/grin.png', 'gone')
        expect(await harness.service.replay(A, { kind: 'revert', stepId: baseId })).toMatchObject({ ok: true, unchanged: true, goneRows: ['assets/grin.png'], goneName: 'grin' })
        expect(names()).toEqual(['smile', 'wave2', 'smile2'])
        expect(harness.service.view(A).done).toHaveLength(2)
    })

    test('a revert across two deletes of present files puts both rows back', async () => {
        expect(harness.service.assetRename(A, 'additionalAssets', 0, 'smile1').ok).toBe(true)
        const baseId = harness.service.view(A).done[0].id
        deleteGrin()
        expect(harness.service.assetDelete(A, 'additionalAssets', [1]).ok).toBe(true)
        expect(names()).toEqual(['smile1', 'smile2'])
        expect(await harness.service.replay(A, { kind: 'revert', stepId: baseId })).toMatchObject({ ok: true })
        expect(names()).toEqual(['smile1', 'grin', 'wave', 'smile2'])
        expect(harness.files.asked.slice().sort()).toEqual(['assets/grin.png', 'assets/wave.png'])
    })

    test('the redo of an insert whose file is gone leaves the row out as well', async () => {
        expect(harness.service.assetInsert(A, 'additionalAssets', [['fresh', 'assets/fresh.png', 'png']]).ok).toBe(true)
        expect(harness.service.undo(A).ok).toBe(true)
        harness.files.states.set('assets/fresh.png', 'gone')
        expect(await harness.service.replay(A, { kind: 'redo' })).toMatchObject({ ok: true, goneRows: ['assets/fresh.png'], goneName: 'fresh' })
        expect(names()).not.toContain('fresh')
    })

    test('a fresh insert is not a replay and asks nothing', async () => {
        expect(harness.service.assetInsert(A, 'additionalAssets', [['fresh', 'assets/fresh.png', 'png']]).ok).toBe(true)
        expect(names()).toContain('fresh')
        expect(harness.files.opened).toBe(0)
        expect(harness.files.asked).toEqual([])
    })

    test('a replay with no row to put back never opens the reader', async () => {
        expect(harness.service.editField(A, 'desc', 'typed').ok).toBe(true)
        expect(await harness.service.replay(A, { kind: 'undo' })).toMatchObject({ ok: true })
        expect(live().desc).toBe('d0')
        expect(harness.files.opened).toBe(0)
    })

    test('the restore of a deleted first message never asks the reader', async () => {
        expect(harness.service.greetingDelete(A, 0).ok).toBe(true)
        const deleted = harness.service.view(A).deleted[0]
        expect(harness.service.restoreDeleted(A, deleted.id).ok).toBe(true)
        expect(harness.files.opened).toBe(0)
    })

    test('an undo asked for a step that is no longer on top applies nothing', async () => {
        deleteGrin()
        const top = harness.service.view(A).done[0].id
        expect(harness.service.editField(A, 'desc', 'x').ok).toBe(true)
        const before = state()
        expect(await harness.service.replay(A, { kind: 'undo', expectTop: top })).toEqual({ ok: false, reason: 'precondition', targetChanged: true })
        expect(state()).toBe(before)
        expect(harness.files.opened).toBe(0)
    })
})

describe('a replay whose target changes while its files are asked is refused', () => {
    test.each([
        ['a text edit', () => harness.service.editField(A, 'desc', 'typed')],
        ['an added row', () => harness.service.assetInsert(A, 'additionalAssets', [['fresh', 'assets/fresh.png', 'png']])],
    ])('%s lands during the wait: nothing is applied and the first row is named', async (_name, interleave) => {
        deleteGrin()
        const wait = release()
        harness.files.waits.push(wait.promise)
        const pending = harness.service.replay(A, { kind: 'undo' })
        await drainMicrotasks()
        expect(interleave().ok).toBe(true)
        const before = state()
        wait.release()
        expect(await pending).toEqual({ ...UNCHECKED_GRIN, targetChanged: true })
        expect(state()).toBe(before)
    })
})

describe('replays run one at a time in call order', () => {
    test('two quick undos over two deletes are each asked and each applied in order', async () => {
        deleteGrin()
        expect(harness.service.assetDelete(A, 'additionalAssets', [1]).ok).toBe(true)
        expect(names()).toEqual(['smile', 'smile2'])
        const first = harness.service.replay(A, { kind: 'undo' })
        const second = harness.service.replay(A, { kind: 'undo' })
        expect([(await first).ok, (await second).ok]).toEqual([true, true])
        expect(names()).toEqual(['smile', 'grin', 'wave', 'smile2'])
        expect(harness.files.asked).toEqual(['assets/wave.png', 'assets/grin.png'])
    })

    test('a revert with nothing to ask waits for the redo called before it', async () => {
        expect(harness.service.editField(A, 'desc', 's').ok).toBe(true)
        harness.service.closeOpenStep(A)
        const baseId = harness.service.view(A).done[0].id
        expect(harness.service.editField(A, 'desc', 't').ok).toBe(true)
        harness.service.closeOpenStep(A)
        expect(harness.service.assetInsert(A, 'additionalAssets', [['fresh', 'assets/fresh.png', 'png']]).ok).toBe(true)
        expect(harness.service.undo(A).ok).toBe(true)
        const redo = harness.service.replay(A, { kind: 'redo' })
        const revert = harness.service.replay(A, { kind: 'revert', stepId: baseId })
        expect(await redo).toMatchObject({ ok: true })
        expect(await revert).toMatchObject({ ok: true })
        expect(harness.files.asked).toEqual(['assets/fresh.png'])
        expect(live().desc).toBe('s')
        expect(names()).not.toContain('fresh')
    })

    test('a job that throws rejects its own caller and the next replay still runs', async () => {
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
        deleteGrin()
        await expect(
            harness.service.replay(A, { kind: 'undo' }, () => {
                throw new Error('around failed')
            }),
        ).rejects.toThrow('around failed')
        expect(logged).toHaveBeenCalledTimes(1)
        expect(await harness.service.replay(A, { kind: 'undo' })).toMatchObject({ ok: true })
        expect(names()).toEqual(['smile', 'grin', 'wave', 'smile2'])
    })
})

describe('a replay is given up at its deadline', () => {
    test('answers that arrive after the deadline apply nothing and land nothing', async () => {
        deleteGrin()
        const wait = release()
        harness.files.waits.push(wait.promise)
        const landedBefore = harness.landed.length
        const pending = track(harness.service.replay(A, { kind: 'undo' }))
        await drainMicrotasks()
        await harness.clock.advance(REPLAY_BUDGET_MS)
        expect(pending.value).toEqual(UNCHECKED_GRIN)
        const before = state()
        wait.release()
        await drainMicrotasks()
        expect(state()).toBe(before)
        expect(harness.landed).toHaveLength(landedBefore)
    })

    test('a reader that never answers does not stop the next replay, which runs right after the first deadline', async () => {
        deleteGrin()
        harness.files.waits.push(never)
        const first = track(harness.service.replay(A, { kind: 'undo' }))
        const second = track(harness.service.replay(A, { kind: 'undo' }))
        expect(first.settled).toBe(false)
        await drainMicrotasks()
        await harness.clock.advance(REPLAY_BUDGET_MS)
        expect(first.value).toEqual(UNCHECKED_GRIN)
        expect(second.value).toMatchObject({ ok: true })
        expect(names()).toEqual(['smile', 'grin', 'wave', 'smile2'])
    })

    test('the deadline counts from the call, so a replay queued behind a hanging one has none left', async () => {
        deleteGrin()
        harness.files.waits.push(never, never)
        const first = track(harness.service.replay(A, { kind: 'undo' }))
        const second = track(harness.service.replay(A, { kind: 'undo' }))
        await drainMicrotasks()
        await harness.clock.advance(REPLAY_BUDGET_MS)
        expect(first.value).toEqual(UNCHECKED_GRIN)
        expect(second.value).toEqual(UNCHECKED_GRIN)
        expect(names()).toEqual(['smile', 'wave', 'smile2'])
    })
})

describe('a re-pointed row is a row put back', () => {
    function stepOf(id: string, before: string[], after: string[]): Step {
        return { id, at: 1, label: { kind: 'assetRename', from: 'grin', to: 'grin' }, ops: [{ op: 'assetRowSet', array: 'additionalAssets', index: 1, before, after }] }
    }

    async function seeded(done: Step[], undone: Step[]): Promise<void> {
        harness = build()
        seedOwner(harness.store.shared, { ownerKey: A, touchedAt: 1, done, undone, deleted: [], restore: null }, 'seed:1')
        await harness.service.whenReady(A)
    }

    test.each([
        ['an undo to a path that is gone', 'undo', 'gone'],
        ['an undo to a path that is unknown', 'undo', 'unknown'],
        ['a redo to a path that is gone', 'redo', 'gone'],
        ['a redo to a path that is unknown', 'redo', 'unknown'],
    ] as const)('%s is refused and the row keeps its path', async (_name, direction, answer) => {
        const old = ['grin', 'assets/old.png', 'png']
        const step = stepOf('s1', old, [...GRIN])
        const redoStep = stepOf('s2', [...GRIN], ['grin', 'assets/new.png', 'png'])
        await seeded(direction === 'undo' ? [step] : [], direction === 'redo' ? [redoStep] : [])
        const target = direction === 'undo' ? 'assets/old.png' : 'assets/new.png'
        harness.files.states.set(target, answer)
        const before = state()
        expect(await harness.service.replay(A, { kind: direction })).toMatchObject({ ok: false, reason: 'asset-file-unchecked' })
        expect(state()).toBe(before)
        expect(live().additionalAssets[1][1]).toBe('assets/grin.png')
        expect(harness.files.asked).toEqual([target])
    })

    test('a present path is applied', async () => {
        await seeded([stepOf('s1', ['grin', 'assets/old.png', 'png'], [...GRIN])], [])
        expect(await harness.service.replay(A, { kind: 'undo' })).toMatchObject({ ok: true })
        expect(live().additionalAssets[1][1]).toBe('assets/old.png')
    })
})

describe('a row whose path is not under assets/ is put back as it was, never probed', () => {
    const REMOTE = ['remote', 'https://example.invalid/a.png', 'png']
    const NESTED = ['nested', 'x/assets/a.png', 'png']

    function addRow(row: string[]): number {
        live().additionalAssets.push([...row])
        return live().additionalAssets.length - 1
    }

    async function rebuilt(open: () => Promise<AssetFileReader>): Promise<void> {
        harness = build(open)
        await harness.service.whenReady(A)
    }

    // The browser store: a key it holds no bytes for reads as no value, which the reader calls gone.
    const webStoreReader = (): Promise<AssetFileReader> =>
        openAssetFileReader({
            getStore: async () => ({ read: async () => ({ bytes: null, version: null }) }) as unknown as ByteStore,
            sourceOf: async (store) => ({ kind: 'node', pieces: { open: async function* () {}, node: false }, store }),
            statSize: async () => 0,
            confirmedAbsent: async () => false,
            openFirstPiece: async () => null,
        })

    // The app files store: a stat that fails with anything but the missing-file error is not an answer, so unknown.
    const filesStoreReader = (): Promise<AssetFileReader> =>
        openAssetFileReader({
            getStore: async () => ({}) as ByteStore,
            sourceOf: async (store) => ({ kind: 'tauri', pieces: { open: async function* () {}, node: false }, store }),
            statSize: async () => { throw new Error('invalid file name') },
            confirmedAbsent: async () => false,
            openFirstPiece: async () => null,
        })

    test.each([
        ['the browser store', webStoreReader],
        ['the app files store', filesStoreReader],
    ])('undo of a deleted URL row on %s restores it with no gone notice and no refusal', async (_name, reader) => {
        await rebuilt(reader)
        const index = addRow(REMOTE)
        expect(harness.service.assetDelete(A, 'additionalAssets', [index]).ok).toBe(true)
        const result = await harness.service.replay(A, { kind: 'undo' })
        expect(result).toMatchObject({ ok: true })
        expect(result).not.toHaveProperty('goneRows')
        expect(result).not.toHaveProperty('goneName')
        expect(live().additionalAssets[index]).toEqual(REMOTE)
    })

    test('the redo of an insert of a URL row puts it back with no probe', async () => {
        const index = live().additionalAssets.length
        expect(harness.service.assetInsert(A, 'additionalAssets', [[...REMOTE]]).ok).toBe(true)
        expect(harness.service.undo(A).ok).toBe(true)
        harness.files.states.set(REMOTE[1], 'gone')
        expect(await harness.service.replay(A, { kind: 'redo' })).toMatchObject({ ok: true })
        expect(live().additionalAssets[index]).toEqual(REMOTE)
        expect(harness.files.asked).toEqual([])
    })

    test('a synchronous undo of a URL row is not refused for want of an answer', async () => {
        const index = addRow(REMOTE)
        expect(harness.service.assetDelete(A, 'additionalAssets', [index]).ok).toBe(true)
        expect(harness.service.undo(A)).toMatchObject({ ok: true })
        expect(live().additionalAssets[index]).toEqual(REMOTE)
        expect(harness.files.asked).toEqual([])
    })

    test('a re-pointed row whose new path is not under assets/ is put back with no probe', async () => {
        const step: Step = {
            id: 's1',
            at: 1,
            label: { kind: 'assetRename', from: 'grin', to: 'grin' },
            ops: [{ op: 'assetRowSet', array: 'additionalAssets', index: 1, before: ['grin', REMOTE[1], 'png'], after: [...GRIN] }],
        }
        harness = build()
        seedOwner(harness.store.shared, { ownerKey: A, touchedAt: 1, done: [step], undone: [], deleted: [], restore: null }, 'seed:1')
        await harness.service.whenReady(A)
        harness.files.states.set(REMOTE[1], 'gone')
        expect(await harness.service.replay(A, { kind: 'undo' })).toMatchObject({ ok: true })
        expect(live().additionalAssets[1][1]).toBe(REMOTE[1])
        expect(harness.files.asked).toEqual([])
    })

    test('a path that only contains assets/ further in is not a stored file', async () => {
        const index = addRow(NESTED)
        harness.files.states.set(NESTED[1], 'gone')
        expect(harness.service.assetDelete(A, 'additionalAssets', [index]).ok).toBe(true)
        expect(await harness.service.replay(A, { kind: 'undo' })).toMatchObject({ ok: true })
        expect(live().additionalAssets[index]).toEqual(NESTED)
        expect(harness.files.asked).toEqual([])
    })

    test('a mixed step drops only the assets/ row that is gone and asks the reader only about it', async () => {
        live().additionalAssets.splice(1, 0, [...REMOTE])
        harness.files.states.set('assets/grin.png', 'gone')
        harness.files.states.set(REMOTE[1], 'gone')
        expect(harness.service.assetDelete(A, 'additionalAssets', [1, 2]).ok).toBe(true)
        expect(await harness.service.replay(A, { kind: 'undo' })).toMatchObject({ ok: true, goneRows: ['assets/grin.png'], goneName: 'grin' })
        expect(names()).toEqual(['smile', 'remote', 'wave', 'smile2'])
        expect(harness.files.asked).toEqual(['assets/grin.png'])
    })
})
