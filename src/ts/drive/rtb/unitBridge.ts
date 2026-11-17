/**
 * Hands the closure's unit batches to the writer's pull-based unit iterable through one slot.
 * The closure's `onUnits` callback is `push`; it resolves once the consumer has taken the batch,
 * so at most one batch waits while the writer works on the previous one, and the closure may be
 * reading the next batch while the writer fails. A caller that ends the export therefore waits
 * for the closure's own promise after `abort()`.
 *
 * The producer starts at the consumer's first `next()`, not at construction: a writer that
 * fails before it pulls units never starts a walk it would have to unwind. `abort()`, and
 * the consumer's `return()` or a throw out of the loop, reject every pending and later `push`
 * so a producer parked in `push` ends instead of hanging.
 */
import type { ExportUnit } from '../../storage/store2/rtb/exportClosure'
import type { BlockUnit } from './unitBlocks'

export class RtbExportAbortedError extends Error {
    constructor() {
        super('The export stopped before every unit was taken.')
        this.name = 'RtbExportAbortedError'
    }
}

export interface UnitBridge {
    readonly iterable: AsyncIterable<BlockUnit>
    /** The closure's `onUnits`. */
    push(units: readonly ExportUnit[]): Promise<void>
    /** The producer finished; the consumer's loop ends after the batch it holds. */
    end(): void
    /** The producer failed; the consumer's pending or next pull throws `error`. */
    fail(error: unknown): void
    abort(): void
    readonly started: boolean
}

interface Slot {
    units: BlockUnit[]
    taken: () => void
}

export function createUnitBridge(start: () => void): UnitBridge {
    let slot: Slot | null = null
    let wake: (() => void) | null = null
    let pending: { reject: (error: unknown) => void } | null = null
    let ended = false
    let failure: { error: unknown } | null = null
    let aborted = false
    let started = false

    const wakeConsumer = (): void => {
        const resume = wake
        wake = null
        resume?.()
    }

    function push(units: readonly ExportUnit[]): Promise<void> {
        if (aborted) {
            return Promise.reject(new RtbExportAbortedError())
        }
        if (slot !== null) {
            return Promise.reject(new Error('a unit batch was pushed before the previous one was taken'))
        }
        return new Promise<void>((resolve, reject) => {
            slot = {
                units: units.map((unit) => ({ tail: unit.tail, frame: unit.bytes })),
                taken: () => {
                    pending = null
                    resolve()
                },
            }
            pending = { reject }
            wakeConsumer()
        })
    }

    function abort(): void {
        if (aborted) {
            return
        }
        aborted = true
        slot = null
        const waiting = pending
        pending = null
        waiting?.reject(new RtbExportAbortedError())
        wakeConsumer()
    }

    async function draw(): Promise<Slot | null> {
        for (;;) {
            if (slot !== null) {
                const next = slot
                slot = null
                return next
            }
            if (failure !== null) {
                throw failure.error
            }
            if (ended) {
                return null
            }
            if (aborted) {
                throw new RtbExportAbortedError()
            }
            await new Promise<void>((resolve) => {
                wake = resolve
            })
        }
    }

    async function* iterate(): AsyncGenerator<BlockUnit> {
        started = true
        try {
            start()
            for (;;) {
                const batch = await draw()
                if (batch === null) {
                    return
                }
                batch.taken()
                for (const unit of batch.units) {
                    yield unit
                }
            }
        } finally {
            abort()
        }
    }

    return {
        iterable: { [Symbol.asyncIterator]: iterate },
        push,
        end: () => {
            ended = true
            wakeConsumer()
        },
        fail: (error) => {
            failure = { error }
            wakeConsumer()
        },
        abort,
        get started() {
            return started
        },
    }
}
