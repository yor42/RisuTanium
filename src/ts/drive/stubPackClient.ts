/**
 * The page side of the packing worker (`drive/stubPackWorker.ts`): one client per `readStubsForExport` call. The worker is
 * spawned at the first `submit`, so a collection with no stub to pack never starts one. Following the worker-port shape of
 * `studio/assets/assetHashJob.ts`, a missing `Worker` or a construction that throws is no worker, not an error.
 *
 * Invariants: `submit` never rejects, and every promise it returns settles: with the packed bytes, or with
 * `{ fallback: true }` after any worker failure and on `terminate`, in which case the caller packs the same bytes itself.
 * A job is posted without a transfer list, so the caller's bytes stay attached and the fallback packs exactly them. The
 * client keeps only the length of each pending job, never its bytes. Replies are matched by id, never by order.
 */

/** The result of one job: the packed bytes, or the instruction to pack on the calling thread. */
export type PackResult = { packed: Uint8Array } | { fallback: true }

/** The longest a job may stay unanswered before the worker is given up on. */
export const STUB_PACK_TIMEOUT_MS = 30_000

export interface StubPackClientOptions {
    /** The knob that keeps packing on the calling thread: the client then reports itself unavailable. */
    disabled?: boolean
    timeoutMs?: number
}

export interface StubPackClient {
    /** Whether `submit` would use a worker: false without `Worker`, after a failure, after `terminate`, or when disabled. */
    available(): boolean
    submit(bytes: Uint8Array): Promise<PackResult>
    /** The jobs posted and not yet answered, and the summed length of their bodies. */
    inFlight(): { count: number, bytes: number }
    /** Ends the worker and resolves every pending job `{ fallback: true }`. */
    terminate(): void
}

interface PendingJob {
    length: number
    timer: ReturnType<typeof setTimeout>
    resolve: (result: PackResult) => void
}

/** A worker reply that names a pending job and carries either a non-empty packed body or an error. */
type ParsedReply = { id: number, packed: Uint8Array } | { id: number, failed: true } | null

function parseReply(data: unknown): ParsedReply {
    if (typeof data !== 'object' || data === null) {
        return null
    }
    const candidate = data as { id?: unknown, packed?: unknown, error?: unknown }
    if (typeof candidate.id !== 'number' || !Number.isInteger(candidate.id)) {
        return null
    }
    if (candidate.error !== undefined) {
        return { id: candidate.id, failed: true }
    }
    if (candidate.packed instanceof Uint8Array && candidate.packed.byteLength > 0) {
        return { id: candidate.id, packed: candidate.packed }
    }
    return null
}

export function createStubPackClient(options: StubPackClientOptions = {}): StubPackClient {
    const timeoutMs = options.timeoutMs ?? STUB_PACK_TIMEOUT_MS
    const pending = new Map<number, PendingJob>()
    let worker: Worker | null = null
    let failed = options.disabled === true
    let nextId = 1

    const settle = (id: number, result: PackResult) => {
        const job = pending.get(id)
        if (job === undefined) {
            return
        }
        pending.delete(id)
        clearTimeout(job.timer)
        job.resolve(result)
    }

    // Any worker failure ends the worker and sends every pending job to the calling thread.
    const fail = () => {
        failed = true
        const ended = worker
        worker = null
        if (ended !== null) {
            try {
                ended.terminate()
            } catch {
                // The worker is already gone.
            }
        }
        for (const id of [...pending.keys()]) {
            settle(id, { fallback: true })
        }
    }

    const spawn = (): Worker | null => {
        if (worker !== null) {
            return worker
        }
        if (failed || typeof Worker === 'undefined') {
            return null
        }
        try {
            const spawned = new Worker(new URL('./stubPackWorker.ts', import.meta.url), { type: 'module' })
            spawned.onmessage = (event: MessageEvent<unknown>) => {
                if (worker !== spawned) {
                    return
                }
                const reply = parseReply(event.data)
                // After a failure `worker` is no longer `spawned`, so a late reply never gets here: it changes nothing.
                if (reply === null || !pending.has(reply.id) || 'failed' in reply) {
                    fail()
                    return
                }
                settle(reply.id, { packed: reply.packed })
            }
            spawned.onerror = () => {
                if (worker === spawned) {
                    fail()
                }
            }
            spawned.onmessageerror = () => {
                if (worker === spawned) {
                    fail()
                }
            }
            worker = spawned
            return spawned
        } catch {
            failed = true
            return null
        }
    }

    return {
        available: () => !failed && (worker !== null || typeof Worker !== 'undefined'),
        submit(bytes) {
            const target = spawn()
            if (target === null) {
                return Promise.resolve({ fallback: true })
            }
            const id = nextId++
            return new Promise<PackResult>((resolve) => {
                const timer = setTimeout(fail, timeoutMs)
                pending.set(id, { length: bytes.byteLength, timer, resolve })
                try {
                    target.postMessage({ id, bytes })
                } catch {
                    fail()
                }
            })
        },
        inFlight() {
            let bytes = 0
            for (const job of pending.values()) {
                bytes += job.length
            }
            return { count: pending.size, bytes }
        },
        terminate() {
            failed = true
            fail()
        },
    }
}
