import { isAssetBatchNotRawError, type AssetPutEntry, type AssetPutResult, type AssetReadResult, type SizedAssetKey } from '../storage/tauriAssetBatch'
import { StoreInvalidKeyError } from '../storage/store/errors'
import { CHUNK_MAX, type ChunkedWriter } from '../storage/tauriByteTransport'

/**
 * Batching and pipelining of the asset writes of a restore and the asset reads
 * of an export, over the desktop commands of `tauriAssetBatch.ts`.
 *
 * The bytes a pipeline holds at once (entries being assembled, in flight, or
 * read and not yet handed on) are bounded by a byte budget, never by an entry
 * count alone, and one call never carries more than `CHUNK_MAX` bytes of
 * entries. A restore entry above that size never enters a batch: it is
 * streamed through a chunked write, alone, with nothing else in flight. A
 * pipeline never leaves a call outstanding behind its caller's back: `drain`
 * and `close` settle everything, and every call's promise is handled where it
 * is created, so none can end as an unhandled rejection.
 */

/** Entry bytes that make one batch; no batched call carries more. */
export const ASSET_BATCH_BYTES = CHUNK_MAX
/** Entry bytes held across everything in flight. */
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
    /**
     * Writes one entry on the per-entry path, used once batching is off for the
     * page. Reports a name the store refuses as `invalid`; any other failure rejects.
     */
    writeEntry(entry: AssetPutEntry): Promise<AssetPutResult>
    /** Starts a durable chunked write of `key`. Throws `StoreInvalidKeyError` for a name the store refuses. */
    openStream(key: string): ChunkedWriter
}

/** An entry too large for a batch, whose body is read from its source in slices. */
export interface StreamedAssetEntry {
    key: string
    /** The entry's name in the backup file, for the skip report. */
    name: string
    /** The entry's position in the backup file; the skip report is in this order. */
    index: number
    /** The body's size in bytes. */
    size: number
    /** Reads bytes `[start, end)` of the body; resolves exactly `end - start` bytes or rejects. */
    readSlice(start: number, end: number): Promise<Uint8Array>
}

/**
 * How a streamed write ended. `invalid`: the store refuses the name, nothing
 * was written. `source`: reading the body failed or came back short, so the
 * source is not what it was when it was indexed. `sink`: the write failed. In
 * `source` and `sink` the write has been aborted by the time this is returned;
 * removing its temp file is best effort, and the startup sweep removes what
 * remains.
 */
export type StreamOutcome =
    | { k: 'ok' }
    | { k: 'invalid'; reason: string }
    | { k: 'source'; error: unknown }
    | { k: 'sink'; error: unknown }

/**
 * Copies one entry's body into a chunked write, in slices of `sliceBytes` read
 * and written one after another, so no more than a slice (plus the one chunk the
 * writer holds back) is in memory. A slice that cannot be read, or that comes
 * back with the wrong length, ends the write as `source`; a failing write ends it
 * as `sink`. The write is aborted before this resolves.
 */
export async function streamAssetEntry(
    entry: StreamedAssetEntry,
    openStream: (key: string) => ChunkedWriter,
    sliceBytes: number = CHUNK_MAX,
): Promise<StreamOutcome> {
    const sinkOutcome = (error: unknown): StreamOutcome =>
        error instanceof StoreInvalidKeyError ? { k: 'invalid', reason: error.message } : { k: 'sink', error }
    let writer: ChunkedWriter
    try {
        writer = openStream(entry.key)
    } catch (error) {
        return sinkOutcome(error)
    }
    for (let start = 0; start < entry.size; start += sliceBytes) {
        const end = Math.min(start + sliceBytes, entry.size)
        let bytes: Uint8Array
        try {
            bytes = await entry.readSlice(start, end)
            if (bytes.length !== end - start) {
                throw errorOf(`a slice of ${entry.name} came back with ${bytes.length} bytes instead of ${end - start}`)
            }
        } catch (error) {
            await writer.abort()
            return { k: 'source', error }
        }
        try {
            await writer.write(bytes)
        } catch (error) {
            await writer.abort()
            return sinkOutcome(error)
        }
    }
    try {
        await writer.finish()
    } catch (error) {
        await writer.abort()
        return sinkOutcome(error)
    }
    return { k: 'ok' }
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
 * - `add` takes an entry of at most `batchBytes`; a larger one is given to
 *   `addStreamed`, which waits for every call in flight, then writes it alone.
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
        if (entry.data.length > this.limits.batchBytes) {
            throw new RangeError(`an entry of ${entry.data.length} bytes cannot share a batch of at most ${this.limits.batchBytes}`)
        }
        if (this.failed) {
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

    /**
     * Writes one entry that is too large for a batch, alone: what was being
     * assembled is sent and every call in flight settles first, and nothing else
     * is sent until this write has ended. A name the store refuses is reported by
     * `invalidAssets`, a failing write is a `failure`, and neither stops the
     * entries around it. Resolves `true` when reading the entry's source failed:
     * the write was aborted, nothing further is sent, and the caller stops its
     * pass. Does nothing, and resolves `false`, after a failure.
     */
    async addStreamed(entry: StreamedAssetEntry): Promise<boolean> {
        if (this.failed) {
            return false
        }
        await this.flush()
        while (this.flights.size > 0) {
            await Promise.all([...this.flights].map((flight) => flight.settled))
        }
        if (this.failed) {
            return false
        }
        const outcome = await streamAssetEntry(entry, this.deps.openStream)
        switch (outcome.k) {
            case 'invalid':
                console.error(`asset ${entry.key} was refused: ${outcome.reason}`)
                this.invalidNames.push({ index: entry.index, name: entry.name })
                return false
            case 'sink':
                this.fail(outcome.error)
                return false
            case 'source':
                console.error(outcome.error)
                return true
            default:
                return false
        }
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
        this.start(entries)
    }

    private start(entries: RestoreAssetEntry[]): Flight {
        const flight: Flight = {
            folded: new Set(entries.map((entry) => foldAssetKey(entry.key))),
            bytes: entries.reduce((sum, entry) => sum + entry.data.length, 0),
            settled: Promise.resolve(),
        }
        this.flights.add(flight)
        this.flightBytes += flight.bytes
        flight.settled = this.run(flight, entries)
        return flight
    }

    /** Performs one call and records its outcome. Handles every rejection itself. */
    private async run(flight: Flight, entries: RestoreAssetEntry[]): Promise<void> {
        try {
            let results: AssetPutResult[]
            if (this.perEntry) {
                results = await this.writeEach(entries)
            } else {
                try {
                    results = await this.deps.writeBatch(entries)
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
    /**
     * The batch did not deliver this key whole (it is above `batchBytes`, the
     * call failed, the key was refused or failed, or the response budget never
     * reached it); the caller reads it on the per-entry path.
     */
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
 * until the whole batch they came in has been handed out. A listed size above
 * `batchBytes` is never requested in a batch: that key comes out as `fallback`
 * at once. A batch whose call fails, or a key it answers with `invalid`,
 * `error` or `large`, comes out as `fallback` too: an export never aborts on
 * one key's result. A key answered `deferred` is asked for again in a later
 * call, and comes out as `fallback` when a call makes no progress at all.
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
            if (this.items[start].size > this.limits.batchBytes) {
                this.startUnrequested(start)
                this.nextIndex = start + 1
                continue
            }
            let end = start
            let bytes = 0
            while (end < this.items.length && end - start < this.limits.maxEntries
                    && this.items[end].size <= this.limits.batchBytes
                    && bytes + this.items[end].size <= this.limits.batchBytes) {
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

    /** Records the key at `index` as read on the per-entry path, with no call and no bytes held. */
    private startUnrequested(index: number): void {
        this.batches.push({
            start: index,
            end: index + 1,
            bytes: 0,
            taken: 0,
            results: [{ kind: 'fallback' }],
            done: true,
            settled: Promise.resolve(),
        })
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
        const results: ExportAssetTake[] = keys.map((): ExportAssetTake => ({ kind: 'fallback' }))
        try {
            let remaining = keys.map((_, position) => position)
            while (remaining.length > 0) {
                const answers = await this.deps.readBatch(remaining.map((position) => keys[position]))
                if (answers.length !== remaining.length) {
                    throw errorOf('an asset read call answered for the wrong number of keys')
                }
                const deferred: number[] = []
                for (let i = 0; i < remaining.length; i++) {
                    const answer = answers[i]
                    if (answer.status === 'deferred') {
                        deferred.push(remaining[i])
                    } else if (answer.status === 'ok') {
                        results[remaining[i]] = { kind: 'bytes', bytes: answer.bytes }
                    } else if (answer.status === 'missing') {
                        results[remaining[i]] = { kind: 'missing' }
                    }
                }
                // A call that delivered nothing would be asked for again for ever.
                remaining = deferred.length === remaining.length ? [] : deferred
            }
        } catch (error) {
            // Keys not answered yet stay `fallback`.
            console.error(error)
        } finally {
            batch.results = results
            batch.done = true
        }
    }
}
