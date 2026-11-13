/**
 * Tier 2 sizes. Synthetic data; the stores are doubles at their seams, so nothing here proves native behaviour.
 */
import { describe, expect, test, vi } from 'vitest'
import type { ByteStore } from 'src/ts/storage/store/contract'

vi.mock('src/ts/globalApi.svelte', () => ({ pieceStoreOrNull: vi.fn(async () => null) }))
vi.mock('src/ts/storage/store/appStore', () => ({ getAppStoreKind: vi.fn(async () => 'tauri') }))
vi.mock('src/ts/storage/tauriByteTransport', () => ({
    isDesktopTransport: () => false,
    transportKind: () => 'web',
    readRangedPieces: vi.fn(),
    statStoredSize: vi.fn(),
}))

import type { ExportAssetSource } from 'src/ts/drive/assetPieces'
import { NATIVE_SIZE_CONCURRENCY, SIZE_CHUNK_KEYS, createAssetSizeJob } from './assetSizes'

function pathsOf(count: number): string[] {
    return Array.from({ length: count }, (_, i) => 'assets/file' + i + '.png')
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 1))

/** Counts how many calls are in flight at once. */
function inFlightMeter() {
    const state = { now: 0, max: 0, started: 0 }
    async function track<T>(work: () => Promise<T>): Promise<T> {
        state.now++
        state.started++
        state.max = Math.max(state.max, state.now)
        try {
            return await work()
        } finally {
            state.now--
        }
    }
    return { state, track }
}

function webSource(store: Partial<ByteStore>): ExportAssetSource {
    return { kind: 'web', pieces: { node: false, open: async function* () { } }, store: store as ByteStore }
}

function nativeSource(kind: 'tauri' | 'node'): ExportAssetSource {
    return { kind, pieces: { node: kind === 'node', open: async function* () { } }, store: {} as ByteStore }
}

describe('createAssetSizeJob', () => {
    test('reads nothing until a caller asks', () => {
        const sizeOf = vi.fn(async () => 1)
        const job = createAssetSizeJob({ source: nativeSource('tauri'), sizeOf })
        expect(sizeOf).not.toHaveBeenCalled()
        expect(job.peek('assets/file0.png')).toBeUndefined()
    })

    test('on the web at most one whole readValue is in flight, across two callers', async () => {
        const meter = inFlightMeter()
        const store = {
            readValue: async (key: string) => meter.track(async () => { await tick(); return new Uint8Array(key.length) }),
        }
        const job = createAssetSizeJob({ source: webSource(store) })
        const paths = pathsOf(20)
        const controller = new AbortController()
        const list = job.ensure(paths.slice(0, 12), controller.signal)
        const checkBytes = job.ensure(paths.slice(6), controller.signal)
        expect(await Promise.all([list, checkBytes])).toEqual([true, true])
        expect(meter.state.max).toBe(1)
        expect(meter.state.started).toBe(20)
        expect(job.peek(paths[0])).toBe(paths[0].length)
    })

    test('on Tauri and Node up to eight sizes are in flight, and no more', async () => {
        for (const kind of ['tauri', 'node'] as const) {
            const meter = inFlightMeter()
            const job = createAssetSizeJob({
                source: nativeSource(kind),
                sizeOf: (key) => meter.track(async () => { await tick(); return key.length }),
            })
            expect(await job.ensure(pathsOf(40), new AbortController().signal)).toBe(true)
            expect(meter.state.max).toBeGreaterThan(1)
            expect(meter.state.max).toBeLessThanOrEqual(NATIVE_SIZE_CONCURRENCY)
        }
    })

    test('a cancel stops between chunks: no key past the running chunk is read', async () => {
        const controller = new AbortController()
        const read: string[] = []
        const job = createAssetSizeJob({
            source: nativeSource('tauri'),
            sizeOf: async (key) => {
                read.push(key)
                controller.abort()
                await tick()
                return 1
            },
        })
        expect(await job.ensure(pathsOf(30), controller.signal)).toBe(false)
        expect(read.length).toBeLessThanOrEqual(SIZE_CHUNK_KEYS)
        expect(job.peek(pathsOf(30)[29])).toBeUndefined()
    })

    test('the session cache serves a settled path and reads only the paths not yet read', async () => {
        const sizeOf = vi.fn(async (key: string) => key.length)
        const job = createAssetSizeJob({ source: nativeSource('node'), sizeOf })
        const signal = new AbortController().signal
        await job.ensure(pathsOf(5), signal)
        expect(sizeOf).toHaveBeenCalledTimes(5)
        await job.ensure(pathsOf(8), signal)
        expect(sizeOf).toHaveBeenCalledTimes(8)
    })

    test('a read another caller has in flight is waited on, not repeated', async () => {
        const sizeOf = vi.fn(async (key: string) => { await tick(); return key.length })
        const job = createAssetSizeJob({ source: nativeSource('node'), sizeOf })
        const paths = pathsOf(3)
        const [first, second] = await Promise.all([
            job.ensure(paths, new AbortController().signal),
            job.ensure(paths, new AbortController().signal),
        ])
        expect([first, second]).toEqual([true, true])
        expect(sizeOf).toHaveBeenCalledTimes(3)
    })

    test('a caller that aborts does not stop the read another caller owns', async () => {
        const sizeOf = vi.fn(async (key: string) => { await tick(); return key.length })
        const job = createAssetSizeJob({ source: nativeSource('node'), sizeOf })
        const listSignal = new AbortController()
        const checkSignal = new AbortController()
        const paths = pathsOf(2)
        const list = job.ensure(paths, listSignal.signal)
        const check = job.ensure(paths, checkSignal.signal)
        checkSignal.abort()
        expect(await check).toBe(false)
        expect(await list).toBe(true)
        expect(job.peek(paths[1])).toBe(paths[1].length)
    })

    test('a caller that aborts while waiting on another caller\'s in-flight reads returns at once and does not stop them', async () => {
        let release: () => void = () => { }
        const gate = new Promise<void>((resolve) => { release = resolve })
        const sizeOf = vi.fn(async (key: string) => { await gate; return key.length })
        const job = createAssetSizeJob({ source: webSource({}), sizeOf })
        const paths = pathsOf(4)
        const list = job.ensure(paths, new AbortController().signal)
        const checkSignal = new AbortController()
        let answered = false
        const check = job.ensure(paths, checkSignal.signal).then((settled) => {
            answered = true
            return settled
        })
        checkSignal.abort()
        await tick()
        await tick()
        expect(answered).toBe(true)
        expect(await check).toBe(false)
        expect(job.peek(paths[0])).toBeUndefined()
        release()
        expect(await list).toBe(true)
        expect(job.peek(paths[3])).toBe(paths[3].length)
        expect(sizeOf).toHaveBeenCalledTimes(4)
    })

    test('on the web a cancel leaves the queued whole reads unread', async () => {
        const controller = new AbortController()
        let release: () => void = () => { }
        const gate = new Promise<void>((resolve) => { release = resolve })
        const sizeOf = vi.fn(async (key: string) => { await gate; return key.length })
        const job = createAssetSizeJob({ source: webSource({}), sizeOf })
        const paths = pathsOf(8)
        const pending = job.ensure(paths, controller.signal)
        await tick()
        expect(sizeOf).toHaveBeenCalledTimes(1)
        controller.abort()
        release()
        expect(await pending).toBe(false)
        await tick()
        await tick()
        expect(sizeOf).toHaveBeenCalledTimes(1)
        expect(job.peek(paths[7])).toBeUndefined()
    })

    test('a size the store cannot say is null, and a size not yet read is undefined', async () => {
        const job = createAssetSizeJob({ source: nativeSource('tauri'), sizeOf: async (key) => key.endsWith('0.png') ? null : 7 })
        const paths = pathsOf(2)
        expect([...job.snapshot(paths).values()]).toEqual([undefined, undefined])
        await job.ensure(paths, new AbortController().signal)
        expect([...job.snapshot(paths).values()]).toEqual([null, 7])
    })

    test('without a source every size is unknown', async () => {
        const job = createAssetSizeJob({ source: null })
        expect(await job.ensure(['assets/a.png'], new AbortController().signal)).toBe(true)
        expect(job.peek('assets/a.png')).toBeNull()
    })

    test('onSettled reports each size this call settles', async () => {
        const job = createAssetSizeJob({ source: nativeSource('node'), sizeOf: async () => 3 })
        const seen: [string, number | null][] = []
        await job.ensure(pathsOf(3), new AbortController().signal, (path, size) => seen.push([path, size]))
        expect(seen.length).toBe(3)
        expect(seen.every(([, size]) => size === 3)).toBe(true)
    })
})
