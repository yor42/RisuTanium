import type { ImportSource } from './importSource'
import type { ProgressSink } from './progressSink'
import { alertNormal } from './alert'

/**
 * What one import file reports to its task card and how it stops. The runner (`runImportBatch`) builds one per file;
 * a flow run without a card gets `NO_IMPORT_PROGRESS`. Progress calls are synchronous and never throw. Only
 * `throwIfCancelled` and `beforeWrite` change control flow, and only before the round's first write (MC-2332).
 */
export type ImportStep = 'download' | 'read' | 'check' | 'assets' | 'add'

/** The fixed steps of an import card; a flow with nothing to save skips `assets`. */
export const IMPORT_STEPS: readonly ImportStep[] = ['read', 'check', 'assets', 'add']

/** The steps of an import that downloads its file first (Realm, a link). */
export const DOWNLOAD_IMPORT_STEPS: readonly ImportStep[] = ['download', 'read', 'check', 'assets', 'add']

/** Thrown when the user pressed Cancel before the round's first write; nothing of the round was written. */
export class ImportCancelled extends Error {
    constructor() {
        super('Import cancelled')
        this.name = 'ImportCancelled'
    }
}

/** One item's asset count: a closed total is set once and never changes; `saved` adds one after a save resolves. */
export interface AssetTally {
    setTotal(total: number): void
    saved(): void
}

export interface ImportRound {
    /** Starts at 0 and counts the rounds of one action: a Retry is a new round. */
    readonly number: number
    /** This item's position in its round. */
    readonly index: number
    readonly count: number
}

export interface ImportProgress {
    /** Aborted when the user presses Cancel. */
    readonly signal: AbortSignal
    /** A card shows this file's progress. */
    readonly tasked: boolean
    /** Forward only; a step the task does not have is ignored. */
    step(step: ImportStep): void
    readonly bytes: ProgressSink
    readonly count: ProgressSink
    /** An open count whose total is still growing. */
    readonly found: ProgressSink
    /** Throws `ImportCancelled` after a Cancel press. */
    throwIfCancelled(): void
    /**
     * Called before the first stored byte of the round (MC-2364). The first call locks Cancel; if Cancel was pressed first
     * it throws `ImportCancelled` and the caller writes nothing. Later calls in the round return at once.
     */
    beforeWrite(): void
    /** This file's library write happened; Retry never re-runs a file that fired it. */
    committed(): void
    /** A success line: `alertNormal` without a card, kept for the result card with one. */
    notice(text: string): void
    /** The same gate, signal and marker, with no steps or sinks of its own, for a flow nested inside this one. */
    nested(): ImportProgress
    readonly round: ImportRound
    readonly tally: AssetTally
}

const noSink: ProgressSink = () => { }
const noTally: AssetTally = { setTotal: () => { }, saved: () => { } }
const idleSignal = new AbortController().signal

/** No card: no-ops, the notice is a plain alert, and the gate never throws. */
export const NO_IMPORT_PROGRESS: ImportProgress = {
    signal: idleSignal,
    tasked: false,
    step: () => { },
    bytes: noSink,
    count: noSink,
    found: noSink,
    throwIfCancelled: () => { },
    beforeWrite: () => { },
    committed: () => { },
    notice: (text) => alertNormal(text),
    nested: () => NO_IMPORT_PROGRESS,
    round: { number: 0, index: 0, count: 1 },
    tally: noTally,
}

/** The round-wide lock flag: `lockCancel` is called once per round however many gates run. */
export interface RoundGate {
    locked: boolean
}

export interface ImportProgressContext {
    readonly signal: AbortSignal
    readonly steps: readonly ImportStep[]
    readonly gate: RoundGate
    readonly round: ImportRound
    /** True when Cancel is now locked and no cancel was requested; only then may the round write. */
    lock(): boolean
    setStep(index: number): void
    readonly bytes: ProgressSink
    readonly count: ProgressSink
    readonly found: ProgressSink
    onCommitted(): void
    onNotice(text: string): void
}

/** The tally of one item: reports to `sink` as (saved, total); a total that was set is not set again. */
export function createAssetTally(sink: ProgressSink): AssetTally {
    let total = 0
    let done = 0
    return {
        setTotal: (next) => {
            if (total === 0 && next > 0) {
                total = next
                sink(done, total)
            }
        },
        saved: () => {
            done += 1
            sink(done, total)
        },
    }
}

export function makeImportProgress(ctx: ImportProgressContext): ImportProgress {
    const gate = (): void => {
        if (ctx.gate.locked) {
            return
        }
        if (!ctx.lock()) {
            throw new ImportCancelled()
        }
        ctx.gate.locked = true
    }
    const throwIfCancelled = (): void => {
        if (ctx.signal.aborted) {
            throw new ImportCancelled()
        }
    }
    const progress: ImportProgress = {
        signal: ctx.signal,
        tasked: true,
        step: (step) => {
            const index = ctx.steps.indexOf(step)
            if (index >= 0) {
                ctx.setStep(index)
            }
        },
        bytes: ctx.bytes,
        count: ctx.count,
        found: ctx.found,
        throwIfCancelled,
        beforeWrite: gate,
        committed: ctx.onCommitted,
        notice: ctx.onNotice,
        nested: () => ({
            signal: ctx.signal,
            tasked: true,
            step: () => { },
            bytes: noSink,
            count: noSink,
            found: noSink,
            throwIfCancelled,
            beforeWrite: gate,
            committed: ctx.onCommitted,
            notice: ctx.onNotice,
            nested: () => progress.nested(),
            round: ctx.round,
            tally: noTally,
        }),
        round: ctx.round,
        tally: createAssetTally(ctx.count),
    }
    return progress
}

/**
 * The body of a download as a Blob, its bytes reported as they arrive. The total is the `Content-Length` only when it is a
 * positive integer and the body is not content-encoded (the header then counts the compressed bytes); otherwise it is 0,
 * so the card shows the sweep and the bar never fills early. The fetch itself takes `signal` from the caller; an abort
 * rejects the read.
 */
export async function responseBlobWithProgress(res: Response, onBytes: ProgressSink, signal: AbortSignal): Promise<Blob> {
    if (res.body === null) {
        return await res.blob()
    }
    const length = Number(res.headers.get('content-length'))
    const encoding = (res.headers.get('content-encoding') ?? '').trim().toLowerCase()
    const total = Number.isInteger(length) && length > 0 && (encoding === '' || encoding === 'identity') ? length : 0
    let read = 0
    const counted = res.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
        transform(part, controller) {
            if (signal.aborted) {
                controller.error(new ImportCancelled())
                return
            }
            read += part.length
            onBytes(total > 0 ? Math.min(read, total) : read, total)
            controller.enqueue(part)
        },
        flush() {
            onBytes(read, total > 0 ? read : 0)
        },
    }))
    return await new Response(counted).blob()
}

/**
 * The source with its reads reported as a high-water mark: `onBytes(highest end read so far, size)`. A read made after
 * `signal` aborted throws `ImportCancelled` before reading. `readRanges` is replaced when the inner source has it, so a
 * batched read is neither unreported nor served from the unwrapped source. The wrapper is still an `ImportSource`.
 */
export function sourceWithProgress(source: ImportSource, onBytes: ProgressSink, signal: AbortSignal): ImportSource {
    let high = 0
    const note = (start: number, bytes: Uint8Array): void => {
        high = Math.max(high, start + bytes.length)
        onBytes(high, source.size)
    }
    const refuseWhenAborted = (): void => {
        if (signal.aborted) {
            throw new ImportCancelled()
        }
    }
    const inner = source.readRanges?.bind(source)
    return {
        name: source.name,
        size: source.size,
        windowBytes: source.windowBytes,
        windowGapBytes: source.windowGapBytes,
        read: async (start, end) => {
            refuseWhenAborted()
            const bytes = await source.read(start, end)
            note(start, bytes)
            return bytes
        },
        ...(inner === undefined ? {} : {
            readRanges: async (ranges: ReadonlyArray<readonly [number, number]>) => {
                refuseWhenAborted()
                const parts = await inner(ranges)
                parts.forEach((part, i) => note(ranges[i][0], part))
                return parts
            },
        }),
        stream: () => source.stream(),
        stat: () => source.stat(),
        close: () => source.close(),
    }
}
