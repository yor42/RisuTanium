import { isAssetBatchNotRawError, type AssetPutEntry, type AssetPutResult, type AssetReadResult, type SizedAssetKey } from '../storage/tauriAssetBatch'

/**
 * Batching and pipelining of the asset writes of a restore and the asset reads
 * of an export, over the desktop commands of `tauriAssetBatch.ts`.
 *
 * The bytes a pipeline holds at once (entries being assembled, in flight, or
 * read and not yet handed on) are bounded by a byte budget, never by an entry
 * count alone: an entry larger than the budget is handled alone, with nothing
 * else in flight. A pipeline never leaves a call outstanding behind its
 * caller's back: `drain` and `close` settle everything, and every call's
 * promise is handled where it is created, so none can end as an unhandled
 * rejection.
 */

/** Entry bytes that make one batch. */
export const ASSET_BATCH_BYTES = 4 * 1024 * 1024
/** Entry bytes held across everything in flight; a larger entry goes alone. */
export const ASSET_BUDGET_BYTES = 16 * 1024 * 1024
/** Entries that make one batch, however small they are. */
export const ASSET_BATCH_MAX_ENTRIES = 256
/** Calls in flight at once. */
export const ASSET_MAX_FLIGHTS = 4

export interface AssetBatchLimits {
    batchBytes: number
    budgetBytes: number
    maxEntries: number
    maxFlights: number
}

const DEFAULT_LIMITS: AssetBatchLimits = {
    batchBytes: ASSET_BATCH_BYTES,
    budgetBytes: ASSET_BUDGET_BYTES,
    maxEntries: ASSET_BATCH_MAX_ENTRIES,
    maxFlights: ASSET_MAX_FLIGHTS,
}

/**
 * Keys that differ only in case or in Unicode composition fold to the same
 * string, on every desktop platform. The upper-then-lower round trip also
 * merges pairs such as long s with s, final sigma with sigma, and micro sign
 * with mu, which a case-insensitive file system treats as one name. Folding
 * more keys together than a file system does only makes a restore wait longer.
 */
export function foldAssetKey(key: string): string {
    return key.normalize('NFC').toUpperCase().toLowerCase().normalize('NFC')
}

export interface RestoreAssetEntry extends AssetPutEntry {
    /** The entry's name in the backup file, for the skip report. */
    name: string
    /** The entry's position in the backup file; the skip report is in this order. */
    index: number
}

export interface RestoreAssetDeps {
    /** Writes the entries in one batched call. Rejects when the call fails as a whole. */
    writeBatch(entries: readonly AssetPutEntry[]): Promise<AssetPutResult[]>
    /** Writes one entry too large to share a batch. */
    writeSingle(entry: AssetPutEntry): Promise<AssetPutResult>
    /**
     * Writes one entry on the per-entry path, used once batching is off for the
     * page. Reports a name the store refuses as `invalid`; any other failure rejects.
     */
    writeEntry(entry: AssetPutEntry): Promise<AssetPutResult>
}

interface Flight {
    folded: Set<string>
    bytes: number
    /** Resolves once the call has settled and the flight has left the count; never rejects. */
    settled: Promise<void>
}

function errorOf(message: string): Error {
    return new Error(message)
}

/**
 * Writes the assets of a restore in byte-budgeted batches, a few in flight at
 * once.
 *
 * - An entry whose folded key is in the batch being assembled sends that batch
 *   first; if its key is in any batch in flight it then waits for that batch to
 *   settle, so the last entry in file order is what ends up on disk. The wait
 *   is only ever on a batch that has been sent.
 * - After the first `error` result or rejected call nothing further is sent and
 *   `add` returns at once; `failure` says what happened.
 * - A call refused because raw bodies do not reach the command is not a failure:
 *   its entries, and every later one, go through `writeEntry`.
 * - `drain` sends the batch being assembled (unless a failure was seen) and
 *   waits for every call in flight to settle. It is the one point every exit of
 *   the caller's loop passes through before it shows a message or moves on.
 */
export class RestoreAssetPipeline {
    private readonly limits: AssetBatchLimits
    private assembling: RestoreAssetEntry[] = []
    private assemblingBytes = 0
    private assemblingKeys = new Set<string>()
    private readonly flights = new Set<Flight>()
    private flightBytes = 0
    private perEntry = false
    private failed: { error: unknown } | null = null
    private readonly invalidNames: { index: number; name: string }[] = []

    constructor(private readonly deps: RestoreAssetDeps, limits: Partial<AssetBatchLimits> = {}) {
        this.limits = { ...DEFAULT_LIMITS, ...limits }
    }

    /** The first failure seen, if any. */
    get failure(): { error: unknown } | null {
        return this.failed
    }

    /** The names the store refused, in backup-file order whatever order the calls settled in. */
    invalidAssets(): { index: number; name: string }[] {
        return [...this.invalidNames].sort((a, b) => a.index - b.index)
    }

    /** Takes one entry. Resolves when the entry is held by the pipeline, which may wait on calls in flight. */
    async add(entry: RestoreAssetEntry): Promise<void> {
        if (this.failed) {
            return
        }
        if (entry.data.length > this.limits.budgetBytes) {
            await this.addOversize(entry)
            return
        }
        const folded = foldAssetKey(entry.key)
        if (this.assemblingKeys.has(folded)) {
            await this.flush()
        }
        for (let flight = this.flightHolding(folded); flight !== undefined; flight = this.flightHolding(folded)) {
            await flight.settled
            if (this.failed) {
                return
            }
        }
        if (this.assembling.length > 0
                && (this.assemblingBytes + entry.data.length > this.limits.batchBytes
                    || this.assembling.length >= this.limits.maxEntries)) {
            await this.flush()
        }
        while (this.flights.size > 0 && this.flightBytes + this.assemblingBytes + entry.data.length > this.limits.budgetBytes) {
            await this.anyFlightSettled()
            if (this.failed) {
                return
            }
        }
        if (this.failed) {
            return
        }
        this.assembling.push(entry)
        this.assemblingBytes += entry.data.length
        this.assemblingKeys.add(folded)
        if (this.assemblingBytes >= this.limits.batchBytes || this.assembling.length >= this.limits.maxEntries) {
            await this.flush()
        }
    }

    /** Sends what is being assembled and waits for every call in flight to settle. Never rejects. */
    async drain(): Promise<void> {
        await this.flush()
        while (this.flights.size > 0) {
            await Promise.all([...this.flights].map((flight) => flight.settled))
        }
    }

    private flightHolding(folded: string): Flight | undefined {
        for (const flight of this.flights) {
            if (flight.folded.has(folded)) {
                return flight
            }
        }
        return undefined
    }

    private async anyFlightSettled(): Promise<void> {
        await Promise.race([...this.flights].map((flight) => flight.settled))
    }

    private async addOversize(entry: RestoreAssetEntry): Promise<void> {
        await this.flush()
        while (this.flights.size > 0) {
            await Promise.all([...this.flights].map((flight) => flight.settled))
        }
        if (this.failed) {
            return
        }
        await this.start([entry], 'single').settled
    }

    /** Sends the batch being assembled, once there is room for it. A failure drops it unsent. */
    private async flush(): Promise<void> {
        if (this.assembling.length === 0) {
            return
        }
        while (!this.failed && this.flights.size > 0
                && (this.flights.size >= this.limits.maxFlights || this.flightBytes + this.assemblingBytes > this.limits.budgetBytes)) {
            await this.anyFlightSettled()
        }
        if (this.failed) {
            return
        }
        const entries = this.assembling
        this.assembling = []
        this.assemblingBytes = 0
        this.assemblingKeys = new Set<string>()
        this.start(entries, 'batch')
    }

    private start(entries: RestoreAssetEntry[], kind: 'batch' | 'single'): Flight {
        const flight: Flight = {
            folded: new Set(entries.map((entry) => foldAssetKey(entry.key))),
            bytes: entries.reduce((sum, entry) => sum + entry.data.length, 0),
            settled: Promise.resolve(),
        }
        this.flights.add(flight)
        this.flightBytes += flight.bytes
        flight.settled = this.run(flight, entries, kind)
        return flight
    }

    /** Performs one call and records its outcome. Handles every rejection itself. */
    private async run(flight: Flight, entries: RestoreAssetEntry[], kind: 'batch' | 'single'): Promise<void> {
        try {
            let results: AssetPutResult[]
            if (this.perEntry) {
                results = await this.writeEach(entries)
            } else {
                try {
                    results = kind === 'single' ? [await this.deps.writeSingle(entries[0])] : await this.deps.writeBatch(entries)
                } catch (error) {
                    if (!isAssetBatchNotRawError(error)) {
                        throw error
                    }
                    this.perEntry = true
                    results = await this.writeEach(entries)
                }
            }
            this.record(entries, results)
        } catch (error) {
            this.fail(error)
        } finally {
            this.flights.delete(flight)
            this.flightBytes -= flight.bytes
        }
    }

    private async writeEach(entries: RestoreAssetEntry[]): Promise<AssetPutResult[]> {
        const results: AssetPutResult[] = []
        for (const entry of entries) {
            results.push(await this.deps.writeEntry(entry))
        }
        return results
    }

    private record(entries: RestoreAssetEntry[], results: AssetPutResult[]): void {
        if (results.length !== entries.length) {
            this.fail(errorOf('an asset write call answered for the wrong number of entries'))
            return
        }
        for (let i = 0; i < entries.length; i++) {
            const result = results[i]
            if (result.k === 'invalid') {
                console.error(`asset ${entries[i].key} was refused: ${result.reason}`)
                this.invalidNames.push({ index: entries[i].index, name: entries[i].name })
            } else if (result.k === 'error') {
                this.fail(errorOf(result.message))
            }
        }
    }

    private fail(error: unknown): void {
        console.error(error)
        this.failed ??= { error }
    }
}

export interface ExportAssetDeps {
    /** Reads the keys in one batched call; rejects when the call fails as a whole. */
    readBatch(keys: readonly string[]): Promise<AssetReadResult[]>
}

/** What a batched read gave for one key of an export. */
export type ExportAssetTake =
    | { kind: 'bytes'; bytes: Uint8Array }
    | { kind: 'missing' }
    /** The batch could not answer for this key; the caller reads it on the per-entry path. */
    | { kind: 'fallback' }

interface ReadBatch {
    start: number
    end: number
    bytes: number
    taken: number
    results: (ExportAssetTake | undefined)[]
    /** Whether the call has settled; a settled batch still counts against the budget until it is handed out. */
    done: boolean
    settled: Promise<void>
}

/**
 * Reads the assets of an export ahead of the writer, in byte-budgeted batches
 * built from the listed sizes, a few in flight at once. Entries are handed out
 * by `take` in listing order, each exactly once; bytes count against the budget
 * until the whole batch they came in has been handed out. A batch whose call
 * fails, or a key it answers with `invalid` or `error`, comes out as
 * `fallback`: an export never aborts on one key's result.
 *
 * `close` waits for every read still outstanding and must run on every exit of
 * the caller.
 */
export class ExportAssetReader {
    private readonly limits: AssetBatchLimits
    private nextIndex = 0
    private retainedBytes = 0
    private closed = false
    private readonly batches: ReadBatch[] = []
    private readonly pending = new Set<Promise<void>>()

    constructor(private readonly deps: ExportAssetDeps, private readonly items: readonly SizedAssetKey[], limits: Partial<AssetBatchLimits> = {}) {
        this.limits = { ...DEFAULT_LIMITS, ...limits }
        this.pump()
    }

    /** The batch result for entry `index`. Entries are taken in order, once each. */
    async take(index: number): Promise<ExportAssetTake> {
        this.pump()
        const batch = this.batches.find((candidate) => index >= candidate.start && index < candidate.end)
        if (batch === undefined) {
            return { kind: 'fallback' }
        }
        await batch.settled
        const result = batch.results[index - batch.start] ?? { kind: 'fallback' }
        batch.results[index - batch.start] = undefined
        batch.taken += 1
        if (batch.taken === batch.end - batch.start) {
            this.batches.splice(this.batches.indexOf(batch), 1)
            this.retainedBytes -= batch.bytes
            this.pump()
        }
        return result
    }

    /** Stops reading ahead and waits for every read in flight to settle. Never rejects. */
    async close(): Promise<void> {
        this.closed = true
        await Promise.all([...this.pending])
    }

    private pump(): void {
        while (!this.closed && this.nextIndex < this.items.length) {
            const start = this.nextIndex
            let end = start
            let bytes = 0
            while (end < this.items.length && end - start < this.limits.maxEntries
                    && (end === start || bytes + this.items[end].size <= this.limits.batchBytes)) {
                bytes += this.items[end].size
                end += 1
            }
            const inFlight = this.batches.filter((batch) => !batch.done).length
            if (this.batches.length > 0
                    && (this.retainedBytes + bytes > this.limits.budgetBytes || inFlight >= this.limits.maxFlights)) {
                break
            }
            this.startBatch(start, end, bytes)
            this.nextIndex = end
        }
    }

    private startBatch(start: number, end: number, bytes: number): void {
        const batch: ReadBatch = { start, end, bytes, taken: 0, results: [], done: false, settled: Promise.resolve() }
        this.batches.push(batch)
        this.retainedBytes += bytes
        const run = this.readInto(batch)
        this.pending.add(run)
        void run.then(() => { this.pending.delete(run) })
        batch.settled = run
    }

    /** Performs one read and records what it gave. Handles every rejection itself. */
    private async readInto(batch: ReadBatch): Promise<void> {
        const keys = this.items.slice(batch.start, batch.end).map((item) => item.key)
        try {
            const answers = await this.deps.readBatch(keys)
            if (answers.length !== keys.length) {
                throw errorOf('an asset read call answered for the wrong number of keys')
            }
            batch.results = answers.map((answer): ExportAssetTake => {
                if (answer.status === 'ok') {
                    return { kind: 'bytes', bytes: answer.bytes }
                }
                if (answer.status === 'missing') {
                    return { kind: 'missing' }
                }
                return { kind: 'fallback' }
            })
        } catch (error) {
            console.error(error)
            batch.results = keys.map((): ExportAssetTake => ({ kind: 'fallback' }))
        } finally {
            batch.done = true
        }
    }
}
