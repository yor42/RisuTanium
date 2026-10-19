/**
 * The read and IPC microbench of a measurement build. It exists only in a measurement build: `maintenance.ts` calls
 * `installImportBench` only under `if (MEASURE)`, so a normal build folds the call away and drops this module and the
 * global name with it.
 *
 * It answers two questions the import design depends on, on the device that runs it:
 *
 * - how long `Blob.slice(...).arrayBuffer()` takes on a picked file, at windows of 64 KB, 1, 4 and 16 MiB read one after
 *   another (a sequential sweep), and as 4 KB reads spread over the file (the shape of the per-entry header read);
 * - how long one `write_chunk` call takes at a few payload sizes, over the same transport the asset writes use.
 *
 * The bench writes nothing that stays: each IPC probe starts a chunked write to a scratch key, sends the first chunk and
 * aborts, which removes the temporary file; the key itself is never created. Nothing is written to the app store proper.
 *
 * Use, in the page's console or over CDP `Runtime.evaluate` (`awaitPromise: true, returnByValue: true`):
 *
 * - `await __risuImportBench.pick()` opens a file picker and returns the chosen `File`. A picker needs a user gesture, so
 *   over CDP send `userGesture: true` and have the person tap the picker's choice, or hand a file in with `run(file)`.
 * - `await __risuImportBench.run(file, options)` runs the reads and, on a Tauri page, the IPC probe. `options` is
 *   optional: `windows` (bytes), `maxReads` (per window), `maxBytes` (per window), `smallReads`, `smallBytes`,
 *   `ipcSizes` (bytes), `ipcCalls`, `skipIpc`.
 * - `await __risuImportBench.run(file)` returns the report and keeps it in `__risuImportBench.last()`.
 *
 * Timings are in milliseconds of `performance.now()`. The `put_assets_batch_b64` comparison is a later item.
 */

export const BENCH_WINDOWS = [64 * 1024, 1024 * 1024, 4 * 1024 * 1024, 16 * 1024 * 1024]
const BENCH_MAX_READS = 1000
const BENCH_MAX_BYTES = 256 * 1024 * 1024
const BENCH_SMALL_READS = 1000
const BENCH_SMALL_BYTES = 4096
const BENCH_IPC_SIZES = [4096, 64 * 1024, 1024 * 1024]
const BENCH_IPC_CALLS = 20
const BENCH_SCRATCH_KEY = 'risu-bench-scratch'

export interface BenchOptions {
    windows?: number[]
    maxReads?: number
    maxBytes?: number
    smallReads?: number
    smallBytes?: number
    ipcSizes?: number[]
    ipcCalls?: number
    skipIpc?: boolean
}

export interface BenchStats {
    calls: number
    bytes: number
    totalMs: number
    meanMs: number
    minMs: number
    p50Ms: number
    p95Ms: number
    maxMs: number
    /** Bytes per second over the total time, in MiB; `null` when no time passed. */
    mibPerSecond: number | null
}

export interface BenchReport {
    fileBytes: number
    sweeps: { windowBytes: number, stats: BenchStats }[]
    smallReads: { readBytes: number, stats: BenchStats }
    ipc: { status: 'skipped' | 'no-tauri-transport' | 'ran', writes: { payloadBytes: number, stats: BenchStats }[], error?: string }
}

export interface BenchHandle {
    pick(): Promise<File | null>
    run(file: File, options?: BenchOptions): Promise<BenchReport>
    last(): BenchReport | null
}

/** The summary of per-call timings; `bytesPerCall` is what each call moved. */
export function summarizeTimings(timings: number[], bytesPerCall: number): BenchStats {
    const sorted = [...timings].sort((a, b) => a - b)
    const total = timings.reduce((sum, value) => sum + value, 0)
    const at = (fraction: number): number => sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]
    const bytes = bytesPerCall * timings.length
    return {
        calls: timings.length,
        bytes,
        totalMs: total,
        meanMs: timings.length === 0 ? 0 : total / timings.length,
        minMs: sorted.length === 0 ? 0 : sorted[0],
        p50Ms: at(0.5),
        p95Ms: at(0.95),
        maxMs: sorted.length === 0 ? 0 : sorted[sorted.length - 1],
        mibPerSecond: total > 0 ? bytes / (1024 * 1024) / (total / 1000) : null,
    }
}

async function timeSlices(file: Blob, offsets: number[], length: number): Promise<number[]> {
    const timings: number[] = []
    for (const offset of offsets) {
        const start = performance.now()
        const buffer = await file.slice(offset, offset + length).arrayBuffer()
        timings.push(performance.now() - start)
        if (buffer.byteLength === 0) {
            break
        }
    }
    return timings
}

async function sweep(file: Blob, windowBytes: number, options: BenchOptions): Promise<BenchStats> {
    const maxReads = options.maxReads ?? BENCH_MAX_READS
    const maxBytes = options.maxBytes ?? BENCH_MAX_BYTES
    const count = Math.max(0, Math.min(maxReads, Math.floor(maxBytes / windowBytes), Math.ceil(file.size / windowBytes)))
    const offsets: number[] = []
    for (let index = 0; index < count; index++) {
        offsets.push(index * windowBytes)
    }
    return summarizeTimings(await timeSlices(file, offsets, windowBytes), windowBytes)
}

async function smallReads(file: Blob, options: BenchOptions): Promise<BenchStats> {
    const readBytes = options.smallBytes ?? BENCH_SMALL_BYTES
    const wanted = options.smallReads ?? BENCH_SMALL_READS
    const count = Math.max(0, Math.min(wanted, Math.floor(file.size / readBytes)))
    const stride = count === 0 ? 0 : Math.max(readBytes, Math.floor(file.size / count))
    const offsets: number[] = []
    for (let index = 0; index < count; index++) {
        offsets.push(Math.min(index * stride, Math.max(0, file.size - readBytes)))
    }
    return summarizeTimings(await timeSlices(file, offsets, readBytes), readBytes)
}

async function ipcProbe(options: BenchOptions): Promise<BenchReport['ipc']> {
    if (options.skipIpc === true) {
        return { status: 'skipped', writes: [] }
    }
    try {
        const transport = await import('../storage/tauriByteTransport')
        if (transport.transportKind() === 'other') {
            return { status: 'no-tauri-transport', writes: [] }
        }
        const calls = options.ipcCalls ?? BENCH_IPC_CALLS
        const writes: { payloadBytes: number, stats: BenchStats }[] = []
        for (const payloadBytes of options.ipcSizes ?? BENCH_IPC_SIZES) {
            const timings: number[] = []
            // Two chunks per write: the writer keeps the newest chunk back, so the timed call sends exactly the first.
            const data = new Uint8Array(payloadBytes * 2)
            for (let call = 0; call < calls; call++) {
                const writer = transport.createChunkedWriter(BENCH_SCRATCH_KEY, { durable: false, chunkBytes: payloadBytes })
                try {
                    const start = performance.now()
                    await writer.write(data)
                    timings.push(performance.now() - start)
                } finally {
                    await writer.abort()
                }
            }
            writes.push({ payloadBytes, stats: summarizeTimings(timings, payloadBytes) })
        }
        return { status: 'ran', writes }
    } catch (error) {
        return { status: 'ran', writes: [], error: String((error as { message?: unknown } | null)?.message ?? error) }
    }
}

function pickFile(): Promise<File | null> {
    return new Promise(resolve => {
        const input = document.createElement('input')
        input.type = 'file'
        input.addEventListener('change', () => resolve(input.files?.[0] ?? null), { once: true })
        input.addEventListener('cancel', () => resolve(null), { once: true })
        input.click()
    })
}

/** Installs the bench on `target` and returns it. */
export function installImportBench(target: object = globalThis): BenchHandle {
    let lastReport: BenchReport | null = null
    const handle: BenchHandle = {
        pick: pickFile,
        run: async (file, options = {}) => {
            const sweeps: BenchReport['sweeps'] = []
            for (const windowBytes of options.windows ?? BENCH_WINDOWS) {
                sweeps.push({ windowBytes, stats: await sweep(file, windowBytes, options) })
            }
            const small = { readBytes: options.smallBytes ?? BENCH_SMALL_BYTES, stats: await smallReads(file, options) }
            const report: BenchReport = { fileBytes: file.size, sweeps, smallReads: small, ipc: await ipcProbe(options) }
            lastReport = report
            return report
        },
        last: () => lastReport,
    }
    ;(target as { __risuImportBench?: BenchHandle }).__risuImportBench = handle
    return handle
}
