/**
 * A fake `Worker` for the stub packing client (`drive/stubPackClient.ts`). It crosses the worker boundary as a real one
 * does: a posted message and a reply both go through `structuredClone`, with the transfer list honoured, so a buffer that
 * is transferred is detached in the sender (its `byteLength` becomes 0). Its packing function is a parameter, so a test
 * runs the real `handlePackMessage` or a counting stand-in.
 *
 * It keeps no reference to a message after replying, and none of its methods is a `vi.fn`: a mock records arguments and
 * results and would keep the bodies alive, which the retention test must be able to see.
 */

/** When a reply goes back: at once, in reverse posting order, after a seeded random delay, or only when the test releases it. */
export type FakeReplyPolicy = 'immediate' | 'reverse' | 'random' | 'hold'

export interface FakePackFailure {
    /** The 1-based post that fails instead of being answered. */
    after: number
    /** `error` and `messageerror` fire that event; `malformed` replies with an unknown id; `silent` never replies. */
    kind: 'error' | 'messageerror' | 'malformed' | 'silent'
}

export interface FakePackOptions {
    /** Turns a message the worker received into its reply. */
    pack: (data: unknown) => unknown
    policy?: FakeReplyPolicy
    seed?: number
    failure?: FakePackFailure
    /** Construction throws, as a platform without module workers does. */
    throwOnSpawn?: boolean
}

export interface FakePackController {
    /** The ids of the messages posted, in order. Plain numbers: no message is kept. */
    readonly posted: number[]
    readonly terminated: () => number
    /** Messages the worker received and has not answered. */
    readonly heldCount: () => number
    /** Answers the held message with this id. */
    release(id: number): void
    /** Answers every held message, in posting order or in the reverse of it. */
    releaseAll(order?: 'posted' | 'reverse'): void
    /** Delivers a reply for `id` to the last spawned worker, whether or not it was terminated. */
    deliver(reply: unknown): void
    uninstall(): void
}

interface Held {
    id: number
    data: unknown
}

function seededRandom(seed: number): () => number {
    let state = seed >>> 0
    return () => {
        state = (state + 0x6D2B79F5) >>> 0
        let t = state
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

function idOf(data: unknown): number {
    return typeof data === 'object' && data !== null && typeof (data as { id?: unknown }).id === 'number' ? (data as { id: number }).id : -1
}

/** Installs the fake as the global `Worker` and returns its controller; `uninstall` restores the previous global. */
export function installFakePackWorker(options: FakePackOptions): FakePackController {
    const policy = options.policy ?? 'immediate'
    const random = seededRandom(options.seed ?? 1)
    const previous = (globalThis as { Worker?: unknown }).Worker
    const posted: number[] = []
    let terminatedCount = 0
    let held: Held[] = []
    let last: FakeWorker | null = null

    class FakeWorker {
        onmessage: ((event: MessageEvent<unknown>) => void) | null = null
        onerror: ((event: Event) => void) | null = null
        onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null
        private ended = false

        constructor(_url: unknown, _options?: unknown) {
            if (options.throwOnSpawn === true) {
                throw new Error('no module workers here')
            }
            last = this
        }

        postMessage(message: unknown, transfer?: Transferable[] | { transfer?: Transferable[] }): void {
            const list = Array.isArray(transfer) ? transfer : transfer?.transfer ?? []
            const data = structuredClone(message, { transfer: list })
            const id = idOf(data)
            posted.push(id)
            const failure = options.failure
            if (failure !== undefined && failure.after === posted.length) {
                this.fail(failure.kind)
                return
            }
            if (policy === 'hold') {
                held.push({ id, data })
            } else if (policy === 'immediate') {
                setTimeout(() => this.answer(data), 0)
            } else if (policy === 'random') {
                setTimeout(() => this.answer(data), Math.floor(random() * 8))
            } else {
                held.push({ id, data })
                setTimeout(() => this.releaseHeld('reverse'), 2)
            }
        }

        terminate(): void {
            this.ended = true
            terminatedCount += 1
        }

        private fail(kind: FakePackFailure['kind']): void {
            if (kind === 'error') {
                setTimeout(() => this.onerror?.(new Event('error')), 0)
            } else if (kind === 'messageerror') {
                setTimeout(() => this.onmessageerror?.(new MessageEvent('messageerror')), 0)
            } else if (kind === 'malformed') {
                setTimeout(() => this.send({ id: 999_999, packed: new Uint8Array([1]) }), 0)
            }
        }

        /** The reply goes back through a structured clone that transfers the packed buffer. */
        send(reply: unknown): void {
            const packed = typeof reply === 'object' && reply !== null ? (reply as { packed?: unknown }).packed : undefined
            const transfer = packed instanceof Uint8Array ? [packed.buffer as ArrayBuffer] : []
            const cloned = structuredClone(reply, { transfer })
            this.onmessage?.(new MessageEvent('message', { data: cloned }))
        }

        answer(data: unknown): void {
            if (this.ended) {
                return
            }
            this.send(options.pack(data))
        }

        releaseHeld(order: 'posted' | 'reverse'): void {
            const batch = held
            held = []
            for (const entry of order === 'reverse' ? [...batch].reverse() : batch) {
                this.answer(entry.data)
            }
        }
    }

    ;(globalThis as { Worker?: unknown }).Worker = FakeWorker
    return {
        posted,
        terminated: () => terminatedCount,
        heldCount: () => held.length,
        release(id) {
            const entry = held.find((candidate) => candidate.id === id)
            if (entry !== undefined && last !== null) {
                held = held.filter((candidate) => candidate !== entry)
                last.answer(entry.data)
            }
        },
        releaseAll(order = 'posted') {
            last?.releaseHeld(order)
        },
        deliver(reply) {
            last?.send(reply)
        },
        uninstall() {
            ;(globalThis as { Worker?: unknown }).Worker = previous
        },
    }
}

/** Removes any `Worker` global, so the client finds none. Returns the restore function. */
export function withoutWorker(): () => void {
    const previous = (globalThis as { Worker?: unknown }).Worker
    ;(globalThis as { Worker?: unknown }).Worker = undefined
    return () => {
        ;(globalThis as { Worker?: unknown }).Worker = previous
    }
}
