/**
 * The import progress contract: the read wrapper, the write gate and the nested view. The runner and the card are
 * `importBatch.task.test.ts`.
 *
 * Labels: (RR-m) new behaviour pinned by mutants; (new-API guard) holds for the new progress API only.
 */
import { describe, expect, test, vi } from 'vitest'

vi.mock('./alert', () => ({ alertNormal: vi.fn() }))

import { ImportCancelled, NO_IMPORT_PROGRESS, createAssetTally, makeImportProgress, sourceWithProgress, type ImportProgressContext } from './importProgress'
import { importSourceOfBytes, importSourceOfFile, isImportSource } from './importSource'

const bytes = (n: number) => Uint8Array.from({ length: n }, (_, i) => i & 0xff)

describe('sourceWithProgress', () => {
    test('R-a17 (RR-m): reports a monotonic high-water mark against the size and is still an import source', async () => {
        const seen: [number, number][] = []
        const source = sourceWithProgress(importSourceOfBytes('a.bin', bytes(100)), (done, total) => seen.push([done, total]), new AbortController().signal)
        expect(isImportSource(source)).toBe(true)
        await source.read(40, 60)
        await source.read(0, 10)
        await source.read(60, 100)
        expect(seen).toEqual([[60, 100], [60, 100], [100, 100]])
        expect(source.name).toBe('a.bin')
        expect(source.size).toBe(100)
    })

    test('R-a17 (RR-m): readRanges is replaced when the inner source has it, and reports too', async () => {
        const file = new File([bytes(64)], 'f.risum')
        const inner = importSourceOfFile(file)
        const seen: number[] = []
        const source = sourceWithProgress(inner, (done) => seen.push(done), new AbortController().signal)
        expect(source.readRanges).toBeDefined()
        expect(source.readRanges).not.toBe(inner.readRanges)
        const parts = await source.readRanges!([[0, 8], [32, 40]])
        expect(parts.map((part) => part.length)).toEqual([8, 8])
        expect(seen.at(-1)).toBe(40)
        expect(source.windowBytes).toBe(inner.windowBytes)
        expect(source.windowGapBytes).toBe(inner.windowGapBytes)
    })

    test('R-a17 (RR-m): a source without readRanges stays without it', () => {
        const source = sourceWithProgress(importSourceOfBytes('a.bin', bytes(4)), () => { }, new AbortController().signal)
        expect(source.readRanges).toBeUndefined()
    })

    test('R-a17 (RR-m): a read after the abort throws ImportCancelled before the inner source is read', async () => {
        const controller = new AbortController()
        const inner = importSourceOfBytes('a.bin', bytes(10))
        const read = vi.spyOn(inner, 'read')
        const source = sourceWithProgress(inner, () => { }, controller.signal)
        await source.read(0, 4)
        controller.abort()
        await expect(source.read(4, 8)).rejects.toBeInstanceOf(ImportCancelled)
        expect(read).toHaveBeenCalledTimes(1)
    })

    test('R-a17 (RR-m): a readRanges after the abort throws ImportCancelled before the inner source is read', async () => {
        const controller = new AbortController()
        const inner = importSourceOfFile(new File([bytes(64)], 'f.risum'))
        const readRanges = vi.spyOn(inner, 'readRanges')
        const source = sourceWithProgress(inner, () => { }, controller.signal)
        await source.readRanges!([[0, 8]])
        controller.abort()
        await expect(source.readRanges!([[8, 16]])).rejects.toBeInstanceOf(ImportCancelled)
        expect(readRanges).toHaveBeenCalledTimes(1)
    })

    test('R-a17 (RR-m): close and stat delegate to the inner source', async () => {
        const inner = importSourceOfBytes('a.bin', bytes(4))
        const close = vi.spyOn(inner, 'close')
        const source = sourceWithProgress(inner, () => { }, new AbortController().signal)
        expect(await source.stat()).toEqual({ size: 4, modified: null })
        await source.close()
        await source.close()
        expect(close).toHaveBeenCalledTimes(2)
    })
})

function contextOf(over: Partial<ImportProgressContext> = {}) {
    const log = { locks: 0, steps: [] as number[], commits: 0, notices: [] as string[] }
    const context: ImportProgressContext = {
        signal: new AbortController().signal,
        steps: ['read', 'check', 'assets', 'add'],
        gate: { locked: false },
        round: { number: 0, index: 0, count: 1 },
        lock: () => { log.locks += 1; return true },
        setStep: (index) => { log.steps.push(index) },
        bytes: () => { },
        count: () => { },
        found: () => { },
        onCommitted: () => { log.commits += 1 },
        onNotice: (text) => { log.notices.push(text) },
        ...over,
    }
    return { context, log }
}

describe('the write gate', () => {
    test('R-a22 (RR-m): lockCancel is called once per round however many gates run, across items and nested views', () => {
        const { context, log } = contextOf()
        const first = makeImportProgress(context)
        const second = makeImportProgress(context)
        first.beforeWrite()
        first.beforeWrite()
        second.beforeWrite()
        first.nested().beforeWrite()
        expect(log.locks).toBe(1)
    })

    test('R-a8 (RR-m): a refused lock throws ImportCancelled and keeps refusing', () => {
        const { context } = contextOf({ lock: () => false })
        const progress = makeImportProgress(context)
        expect(() => progress.beforeWrite()).toThrow(ImportCancelled)
        expect(() => progress.beforeWrite()).toThrow(ImportCancelled)
        expect(context.gate.locked).toBe(false)
    })

    test('the nested view shares the round lock: it locks once and throws when the lock is refused', () => {
        const granted = contextOf()
        makeImportProgress(granted.context).nested().beforeWrite()
        expect(granted.log.locks).toBe(1)
        expect(granted.context.gate.locked).toBe(true)

        const refused = contextOf({ lock: () => false })
        expect(() => makeImportProgress(refused.context).nested().beforeWrite()).toThrow(ImportCancelled)
    })

    test('throwIfCancelled follows the signal', () => {
        const controller = new AbortController()
        const progress = makeImportProgress(contextOf({ signal: controller.signal }).context)
        expect(() => progress.throwIfCancelled()).not.toThrow()
        controller.abort()
        expect(() => progress.throwIfCancelled()).toThrow(ImportCancelled)
    })

    test('steps map to their index and a step the task lacks is ignored', () => {
        const { context, log } = contextOf({ steps: ['read', 'add'] })
        const progress = makeImportProgress(context)
        progress.step('check')
        progress.step('add')
        expect(log.steps).toEqual([1])
    })

    test('a nested view forwards the gate, the marker and the notice but not the steps or sinks', () => {
        const done = vi.fn()
        const { context, log } = contextOf({ count: done })
        const nested = makeImportProgress(context).nested()
        expect(nested.tasked).toBe(true)
        nested.step('assets')
        nested.count(1, 2)
        nested.tally.setTotal(3)
        nested.committed()
        nested.notice('x')
        expect(log.steps).toEqual([])
        expect(done).not.toHaveBeenCalled()
        expect(log.commits).toBe(1)
        expect(log.notices).toEqual(['x'])
    })

    test('round identity (RR-m): the round number and position are the item\'s own', () => {
        const progress = makeImportProgress(contextOf({ round: { number: 2, index: 1, count: 3 } }).context)
        expect(progress.round).toEqual({ number: 2, index: 1, count: 3 })
    })
})

describe('no card', () => {
    test('R-a14 (new-API guard): the gate never throws and nothing is tasked', () => {
        expect(NO_IMPORT_PROGRESS.tasked).toBe(false)
        expect(() => { NO_IMPORT_PROGRESS.beforeWrite(); NO_IMPORT_PROGRESS.throwIfCancelled() }).not.toThrow()
        expect(NO_IMPORT_PROGRESS.nested()).toBe(NO_IMPORT_PROGRESS)
    })
})

describe('the asset tally', () => {
    test('a closed total is set once and saved() adds one each time', () => {
        const seen: [number, number][] = []
        const tally = createAssetTally((done, total) => seen.push([done, total]))
        tally.setTotal(4)
        tally.setTotal(9)
        tally.saved()
        tally.saved()
        expect(seen).toEqual([[0, 4], [1, 4], [2, 4]])
    })
})
