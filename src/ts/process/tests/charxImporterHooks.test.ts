// @vitest-environment node
/**
 * The hooks of `CharXImporter` (`src/ts/process/processzip.ts`) that let an owner follow, stop and gate an import:
 * `readProgress`, `saveProgress`, `beforeWrite`, the `savedCount`/`queuedCount` getters, and `abandon()` during
 * `parse()`. The real importer and fflate run against archives written by the real producer, `CharXWriter`; only the
 * asset stores are replaced.
 *
 * Labels: `new rule` tests pin behaviour that does not exist before the change and fail on the base by design (the
 * hooks and the abandon error are missing); `guard` tests pass before and after.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    pieceMode: false,
    saveCalls: 0,
    pieceCalls: 0,
    // When set, saveAsset waits for it, so saves stay in flight and the backlog stays full.
    hold: null as Promise<void> | null,
}))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/alert'), () => ({
    alertStore: { set: vi.fn(), subscribe: vi.fn(), update: vi.fn() },
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/util'), () => {
    class Semaphore {
        private available: number
        private readonly max: number
        private waiting: Array<() => void> = []
        constructor(max: number) { this.available = max; this.max = max }
        async acquire(): Promise<void> {
            if (this.available > 0) { this.available -= 1; return }
            await new Promise<void>((resolve) => this.waiting.push(resolve))
        }
        release(): void {
            const next = this.waiting.shift()
            if (next) { next(); return }
            if (this.available < this.max) this.available += 1
        }
    }
    return {
        asBuffer: (a: unknown) => a,
        Semaphore,
        sleep: vi.fn(async () => {}),
    } as unknown as typeof import('src/ts/util')
})

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    pieceStoreOrNull: vi.fn(async () => (h.pieceMode ? {} : null)),
    saveAssetFromPieces: vi.fn(async (pieces: AsyncIterable<Uint8Array>) => {
        h.pieceCalls += 1
        let total = 0
        for await (const piece of pieces) total += piece.length
        if (h.hold) await h.hold
        return `piece-${h.pieceCalls}-${total}`
    }),
    saveAsset: vi.fn(async (data: Uint8Array) => {
        h.saveCalls += 1
        const id = `asset-${h.saveCalls}-${data.length}`
        if (h.hold) await h.hold
        return id
    }),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock('@tauri-apps/plugin-fs', () => ({
    readFile: vi.fn(async () => new Uint8Array()),
}))

import { CharXAbandonedError, CharXImporter, CharXWriter, charxLimits } from 'src/ts/process/processzip'

const KIB = 1024
const ASSET_COUNT = 6
const ASSET_BYTES = 64 * KIB
const SOURCE_CHUNK = 16 * KIB
const defaultLimits = { ...charxLimits }

function bytes(n: number, seed: number): Uint8Array {
    const a = new Uint8Array(n)
    let x = seed
    for (let i = 0; i < n; i++) {
        x = (x * 1103515245 + 12345) & 0x7fffffff
        a[i] = (x >> 16) & 0xff
    }
    return a
}

/** The archive the exporter writes: card.json first, then the assets. */
async function archive(): Promise<Uint8Array> {
    const parts: Uint8Array[] = []
    const writer = new CharXWriter({ write: async (chunk: Uint8Array) => { parts.push(chunk) }, close: async () => {} } as unknown as ConstructorParameters<typeof CharXWriter>[0])
    await writer.write('card.json', JSON.stringify({ spec: 'chara_card_v3', data: { name: 'Hooks' } }))
    for (let i = 0; i < ASSET_COUNT; i++) {
        await writer.write(`assets/other/image/${i}.png`, bytes(ASSET_BYTES, i + 1), 0)
    }
    await writer.end()
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
    let at = 0
    for (const part of parts) { out.set(part, at); at += part.length }
    return out
}

/** A source that hands out small chunks and counts what it has handed out, so a stop is visible as bytes not read. */
function countingSource(data: Uint8Array) {
    const state = { pulled: 0, cancelled: false }
    let at = 0
    const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
            if (at >= data.length) {
                controller.close()
                return
            }
            const piece = data.slice(at, at + SOURCE_CHUNK)
            at += piece.length
            state.pulled += piece.length
            controller.enqueue(piece)
        },
        cancel() { state.cancelled = true },
    }, { highWaterMark: 0 })
    return { stream, state }
}

/** Fails a test that would otherwise hang when a waiter is never woken. */
async function within<T>(promise: Promise<T>, ms: number): Promise<T | 'timeout'> {
    return await Promise.race([promise, new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), ms))])
}

async function outcome(promise: Promise<unknown>): Promise<'resolved' | Error | 'timeout'> {
    return await within(promise.then(() => 'resolved' as const, (error: unknown) => error instanceof Error ? error : new Error(String(error))), 2000)
}

beforeEach(() => {
    h.pieceMode = false
    h.saveCalls = 0
    h.pieceCalls = 0
    h.hold = null
})

afterEach(() => {
    Object.assign(charxLimits, defaultLimits)
})

describe('CharXImporter progress hooks', () => {
    test('new rule: readProgress reports the archive bytes read and ends with (total, total)', async () => {
        const data = await archive()
        const importer = new CharXImporter()
        const reports: Array<[number, number]> = []
        importer.readProgress = (done, total) => { reports.push([done, total]) }
        await importer.parse(data)
        await importer.done()
        expect(reports.length).toBeGreaterThan(1)
        expect(reports.at(-1)).toEqual([data.length, data.length])
        for (let i = 1; i < reports.length; i++) expect(reports[i][0]).toBeGreaterThanOrEqual(reports[i - 1][0])
        expect(reports.every(([, total]) => total === data.length)).toBe(true)
    })

    test('new rule: saveProgress follows each finished save and the getters count them', async () => {
        const data = await archive()
        const importer = new CharXImporter()
        const reports: Array<[number, number]> = []
        importer.saveProgress = (done, total) => { reports.push([done, total]) }
        await importer.parse(data)
        await importer.done()
        expect(reports.at(-1)).toEqual([ASSET_COUNT, ASSET_COUNT])
        expect(importer.savedCount).toBe(ASSET_COUNT)
        expect(importer.queuedCount).toBe(ASSET_COUNT)
        expect(Object.keys(importer.assets)).toHaveLength(ASSET_COUNT)
    })

    test('new rule: saveProgress reports each asset as (saved, found) when it is enqueued, before any save resolves', async () => {
        let release: () => void = () => {}
        h.hold = new Promise<void>((resolve) => { release = resolve })
        const data = await archive()
        const importer = new CharXImporter()
        const reports: Array<[number, number]> = []
        importer.saveProgress = (done, total) => { reports.push([done, total]) }
        await importer.parse(data)
        // Every save is still held, so what was reported came from the enqueues alone.
        expect(h.saveCalls).toBeGreaterThan(0)
        expect(reports.length).toBe(ASSET_COUNT)
        expect(reports).toEqual(Array.from({ length: ASSET_COUNT }, (_, i): [number, number] => [0, i + 1]))
        release()
        await importer.done()
        expect(reports.at(-1)).toEqual([ASSET_COUNT, ASSET_COUNT])
    })

    test('new rule: an entry saved from pieces is also reported when it is enqueued, before its save ends', async () => {
        h.pieceMode = true
        charxLimits.streamAfterBytes = 1024
        let release: () => void = () => {}
        h.hold = new Promise<void>((resolve) => { release = resolve })
        const data = await archive()
        const importer = new CharXImporter()
        const reports: Array<[number, number]> = []
        importer.saveProgress = (done, total) => { reports.push([done, total]) }
        await importer.parse(data)
        expect(h.pieceCalls).toBeGreaterThan(0)
        expect(reports).toEqual(Array.from({ length: ASSET_COUNT }, (_, i): [number, number] => [0, i + 1]))
        release()
        await importer.done()
        expect(reports.at(-1)).toEqual([ASSET_COUNT, ASSET_COUNT])
    })

    test('guard: an importer with no hooks imports as before', async () => {
        const data = await archive()
        const importer = new CharXImporter()
        await importer.parse(data)
        await importer.done()
        expect(importer.cardData).toContain('chara_card_v3')
        expect(Object.keys(importer.assets)).toHaveLength(ASSET_COUNT)
        expect(h.saveCalls).toBe(ASSET_COUNT)
    })
})

describe('CharXImporter.abandon() during parse', () => {
    test('R-b16 new rule: stops the read loop and rejects with CharXAbandonedError', async () => {
        const data = await archive()
        const { stream, state } = countingSource(data)
        const importer = new CharXImporter()
        importer.readProgress = (done) => { if (done >= 2 * ASSET_BYTES) importer.abandon() }
        const result = await outcome(importer.parse(stream))
        expect(result).toBeInstanceOf(CharXAbandonedError)
        // It stops within one chunk of the call, far short of the archive's size.
        expect(state.pulled).toBeLessThan(data.length / 2)
        expect(state.cancelled).toBe(true)
    })

    test('R-b16 new rule: wakes a reader waiting on the backlog', async () => {
        charxLimits.backlogBytes = 1
        let release: () => void = () => {}
        h.hold = new Promise<void>((resolve) => { release = resolve })
        const data = await archive()
        const { stream, state } = countingSource(data)
        const importer = new CharXImporter()
        const parsing = outcome(importer.parse(stream))
        // The first asset is in flight and held, so the loop is waiting on the backlog.
        for (let waited = 0; h.saveCalls === 0 && waited < 100; waited++) await new Promise((resolve) => setTimeout(resolve, 10))
        expect(h.saveCalls).toBeGreaterThan(0)
        await new Promise((resolve) => setTimeout(resolve, 50))
        const pulledWhileWaiting = state.pulled
        importer.abandon()
        const result = await parsing
        release()
        expect(result).toBeInstanceOf(CharXAbandonedError)
        expect(pulledWhileWaiting).toBeLessThan(data.length)
        expect(state.pulled).toBe(pulledWhileWaiting)
    })

    test('R-b16 new rule: ends a read that is waiting on a source which has stalled and cancels the source', async () => {
        const data = await archive()
        let delivered = false
        let cancelled = false
        const stalling = new ReadableStream<Uint8Array>({
            pull(controller) {
                if (!delivered) {
                    delivered = true
                    controller.enqueue(data.slice(0, SOURCE_CHUNK))
                    return
                }
                //The source never answers again: only abandon() can end the read.
                return new Promise<void>(() => {})
            },
            cancel() { cancelled = true },
        }, { highWaterMark: 0 })
        const importer = new CharXImporter()
        const parsing = outcome(importer.parse(stalling))
        await new Promise((resolve) => setTimeout(resolve, 50))
        importer.abandon()
        expect(await parsing).toBeInstanceOf(CharXAbandonedError)
        expect(cancelled).toBe(true)
    })

    test('guard: abandon() after parse() still ends use without throwing and parse resolved', async () => {
        const data = await archive()
        const importer = new CharXImporter()
        await importer.parse(data)
        importer.abandon()
        expect(await outcome(importer.done())).toBe('resolved')
    })
})

describe('CharXImporter.beforeWrite', () => {
    test('R-b17 new rule: a false result saves nothing and abandons the importer', async () => {
        const data = await archive()
        const { stream } = countingSource(data)
        const importer = new CharXImporter()
        const calls: number[] = []
        importer.beforeWrite = () => { calls.push(h.saveCalls); return false }
        const result = await outcome(importer.parse(stream))
        // parse may have ended before or after the first save reached the hook; either way nothing was saved.
        expect(result === 'resolved' || result instanceof CharXAbandonedError).toBe(true)
        expect(calls).toEqual([0])
        expect(h.saveCalls).toBe(0)
        expect(h.pieceCalls).toBe(0)
        expect(Object.keys(importer.assets)).toHaveLength(0)
    })

    test('R-b7 new rule: the hook runs synchronously before each save, so the first save to reach it locks Cancel', async () => {
        const data = await archive()
        const importer = new CharXImporter()
        const seen: number[] = []
        importer.beforeWrite = () => { seen.push(h.saveCalls); return true }
        await importer.parse(data)
        await importer.done()
        // Each hook call sees exactly the saves that started before it: none before the first.
        expect(seen).toEqual(Array.from({ length: ASSET_COUNT }, (_, i) => i))
        expect(h.saveCalls).toBe(ASSET_COUNT)
    })

    test('R-b7 new rule: a hook that refuses after the first save stops the later saves', async () => {
        charxLimits.backlogBytes = 1
        const data = await archive()
        const importer = new CharXImporter()
        let calls = 0
        importer.beforeWrite = () => { calls += 1; return calls === 1 }
        const result = await outcome(importer.parse(data))
        expect(result === 'resolved' || result instanceof CharXAbandonedError).toBe(true)
        expect(h.saveCalls).toBe(1)
        expect(calls).toBe(2)
    })

    test('R-b7 new rule: the piece path runs the hook before saveAssetFromPieces', async () => {
        h.pieceMode = true
        charxLimits.streamAfterBytes = 1024
        const data = await archive()
        const importer = new CharXImporter()
        const seen: number[] = []
        importer.beforeWrite = () => { seen.push(h.pieceCalls); return true }
        await importer.parse(data)
        await importer.done()
        expect(h.pieceCalls).toBe(ASSET_COUNT)
        expect(seen).toEqual(Array.from({ length: ASSET_COUNT }, (_, i) => i))
    })

    test('R-b17 new rule: a false result on the piece path saves nothing', async () => {
        h.pieceMode = true
        charxLimits.streamAfterBytes = 1024
        const data = await archive()
        const importer = new CharXImporter()
        importer.beforeWrite = () => false
        const result = await outcome(importer.parse(data))
        expect(result === 'resolved' || result instanceof CharXAbandonedError).toBe(true)
        expect(h.pieceCalls).toBe(0)
        expect(h.saveCalls).toBe(0)
    })
})
