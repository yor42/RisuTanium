/**
 * An in-memory `ByteStore` with the semantics of the Tauri shell's page-generation
 * gate (`store2_gate.rs`), for the store2 replay: `createTauriBackend` runs on it
 * unchanged. It is bytes-only (no revisions, no conditional writes) and its raw
 * state reports `revision: null`, so a re-flush that rewrites identical bytes is
 * not a write.
 *
 * What it models of the native side:
 *  - one process-wide lock and a current generation. `registerPage` takes the lock,
 *    so it waits while a decisive call holds it, then issues the next generation.
 *  - `writeTop` and `removeTop` take the lock and, under it, check `gen == current`
 *    and apply, as one step with nothing awaited in between. Generation 0 (never
 *    registered) is always refused. A refusal applies nothing.
 *  - `writeTop` accepts only `store2-commit` and `store2-fence`. `removeTop` accepts
 *    only `store2/` keys and `store2-fence`, never `store2-commit`; an absent key
 *    counts as removed and a key the file system cannot address is reported
 *    `failed` in a `StoreDeleteManyError`.
 *  - the bypass guards: the plain `write`, `delete` and `deleteMany` refuse the
 *    gated keys (`store2-commit`, `store2-fence`, and for removal every `store2/`
 *    key), so a path around the gate fails loudly.
 *  - `beginWriteTop` / `beginRemoveTop` split a decisive call into the step that
 *    takes the lock and checks, and the landing that applies and releases, which is
 *    how the scheduler keeps a call that outlives its page (`TwoStepPageGate`).
 *
 * Durability. Every durable write (`store2/` units, `store2-commit`, `store2-fence`)
 * reports `flushed: true`. The scheduler's flush fault reports one write as not
 * flushed through `markUnflushed`, the native layer's `flush.fault`: the write stays
 * applied and visible, and the fake remembers what lay beneath it. A restart that
 * drops unflushed writes puts that back (the older bytes, or no file at all), which is
 * what a power loss between the write and its flush would leave. A later write of
 * the same key replaces the unflushed one and rests on what lay beneath it, so a
 * flushed write makes the key durable again. A removal is durable.
 *
 * Test options, never part of production code: `gate: false` removes the gate (no
 * generation check, registration never waits), which is the app before the gate;
 * `bypass: 'allow'` lets the plain paths touch the gated keys, which is what a
 * backend that went around the gate would reach.
 *
 * Test hooks live on the returned handle, never on the `ByteStore`.
 */
import type { ByteStore, DeleteEntry, ReadResult, StoreCondition, WriteResult } from 'src/ts/storage/store/contract'
import { StoreDeleteManyError, StoreInvalidKeyError, StoreStaleGenerationError, type DeleteReportEntry } from 'src/ts/storage/store/errors'
import { checkBytes, checkCondition, checkNoDuplicateKeys } from 'src/ts/storage/store/guards'
import { STORE2_PREFIX, tauriAddressableViolation, tauriCreatableViolation } from 'src/ts/storage/store/keyRules'
import type { FilePlatform } from 'src/ts/storage/store/keyRules'
import { COMMIT_KEY, FENCE_KEY } from 'src/ts/storage/store2/format/keys'
import type { Landing, RawEntry, RawState, TwoStepPageGate } from './scheduler'

export interface TauriSemanticOptions {
    /** False removes the gate: decisive calls apply without a generation check and registration never waits. */
    gate?: boolean
    /** `'allow'` lets the plain write, delete and deleteMany touch the gated keys; the default refuses them as the native guards do. */
    bypass?: 'refuse' | 'allow'
    platform?: FilePlatform
}

export interface TauriSemanticStore {
    /** The page's byte store object; a restart replaces it, as a reload gives the page a new store object (and so a new backend mutex). */
    readonly store: ByteStore
    /** A copy of every key that holds bytes. */
    snapshot(): Map<string, Uint8Array>
    /** The key as stored, read without a request and without any wrapper around `store`. */
    peek(key: string): Uint8Array | null
    /** The keys under `prefix` that hold a value, read without a request. */
    list(prefix: string): string[]
    /** Puts a file in place without any request. */
    plant(key: string, bytes: Uint8Array): void
    /** The file is gone without a request, as a loss in the file system would leave it. */
    remove(key: string): void
    /** The last write of the durable key is reported as not flushed (`flush.fault`): it stays applied until a restart drops it. */
    markUnflushed(key: string): void
    /** The keys whose last write is not known flushed, sorted. */
    unflushed(): string[]
    /**
     * The page is gone and a new one starts on the same device. With `drop`, every unflushed write is dropped first (what lay
     * beneath it is put back), and the dropped keys are returned, sorted. The native generation and lock stay; the store object
     * is new, so the backend built on it has a mutex of its own.
     */
    restart(drop: boolean): string[]
    /** The generation the next decisive call must present. */
    readonly generation: number
    /** Whether a decisive call holds the lock right now. */
    readonly locked: boolean
}

/** The raw state of the Tauri-semantics store: bytes only, every `revision` null; the commit key and the fence always have an entry. */
export function rawOfTauriSemantic(fake: TauriSemanticStore): () => RawState {
    return () => {
        const out = new Map<string, RawEntry>()
        for (const [key, bytes] of fake.snapshot()) {
            out.set(key, { bytes, revision: null })
        }
        for (const key of [COMMIT_KEY, FENCE_KEY]) {
            if (!out.has(key)) {
                out.set(key, { bytes: null, revision: null })
            }
        }
        return out
    }
}

const GATED_WRITE_KEYS: readonly string[] = [COMMIT_KEY, FENCE_KEY]

function isDurable(key: string): boolean {
    return key.startsWith(STORE2_PREFIX) || GATED_WRITE_KEYS.includes(key)
}

export function createTauriSemanticStore(options: TauriSemanticOptions = {}): TauriSemanticStore {
    const gated = options.gate ?? true
    const guardsBypass = options.bypass === 'allow'
    const platform: FilePlatform = options.platform ?? 'windows'

    const values = new Map<string, Uint8Array>()
    // Per durable key, what lay beneath its last write: the bytes, or null for no file.
    const beneath = new Map<string, Uint8Array | null>()
    // The keys whose last write was reported not flushed, each with what lies beneath that write.
    const notFlushed = new Map<string, Uint8Array | null>()
    let generation = 0

    // The native lock. A release hands the lock straight to the first waiter, so the lock never reads free in between.
    let held = false
    const waiters: Array<() => void> = []

    function acquire(): Promise<void> {
        if (!held) {
            held = true
            return Promise.resolve()
        }
        return new Promise<void>((resolve) => { waiters.push(resolve) })
    }

    function release(): void {
        const next = waiters.shift()
        if (next === undefined) {
            held = false
        } else {
            next()
        }
    }

    /**
     * Runs `body` under the lock. A free lock is taken and `body` runs in the same
     * synchronous step, so nothing can come between the check and the apply it holds.
     */
    function underLock<T>(body: () => T): Promise<T> {
        if (!held) {
            held = true
            try {
                return Promise.resolve(body())
            } catch (error) {
                return Promise.reject(error)
            } finally {
                release()
            }
        }
        return new Promise<T>((resolve, reject) => {
            waiters.push(() => {
                try {
                    resolve(body())
                } catch (error) {
                    reject(error)
                } finally {
                    release()
                }
            })
        })
    }

    function checkGeneration(presented: number): void {
        if (gated && (presented === 0 || presented !== generation)) {
            throw new StoreStaleGenerationError(`generation ${presented} is not the current ${generation}`)
        }
    }

    function checkAddressable(key: string): void {
        const reason = tauriAddressableViolation(key, platform)
        if (reason !== null) {
            throw new StoreInvalidKeyError(key, reason)
        }
    }

    function checkCreatable(key: string): void {
        const reason = tauriAddressableViolation(key, platform) ?? tauriCreatableViolation(key)
        if (reason !== null) {
            throw new StoreInvalidKeyError(key, reason)
        }
    }

    function checkTopWritable(key: string): void {
        if (!GATED_WRITE_KEYS.includes(key)) {
            throw new StoreInvalidKeyError(key, 'the gate writes only store2-commit and store2-fence')
        }
        checkCreatable(key)
    }

    /** The key holds no file any more, and nothing of it is left to drop: a removal is durable. */
    function forget(key: string): void {
        values.delete(key)
        beneath.delete(key)
        notFlushed.delete(key)
    }

    function applyWrite(key: string, bytes: Uint8Array): WriteResult {
        if (!isDurable(key)) {
            values.set(key, bytes.slice())
            return { version: null }
        }
        // A write over an unflushed one rests on what lay beneath that one; a flushed write ends the key's unflushed state.
        beneath.set(key, notFlushed.has(key) ? notFlushed.get(key) ?? null : values.get(key) ?? null)
        notFlushed.delete(key)
        values.set(key, bytes.slice())
        return { version: null, flushed: true }
    }

    /** The removal a gated call performs once it holds the lock and passed its check. */
    function applyRemoval(keys: readonly string[]): void {
        const report = keys.map((key): DeleteReportEntry => {
            if (tauriAddressableViolation(key, platform) !== null) {
                return { key, outcome: 'failed', error: new TypeError('the path cannot be addressed') }
            }
            forget(key)
            return { key, outcome: 'removed' }
        })
        if (report.some((entry) => entry.outcome !== 'removed')) {
            throw new StoreDeleteManyError(report)
        }
    }

    function checkTopRemovable(keys: readonly string[]): void {
        for (const key of keys) {
            if (key === COMMIT_KEY) {
                throw new StoreInvalidKeyError(key, 'the commit key is never removed')
            }
            if (key !== FENCE_KEY && !key.startsWith(STORE2_PREFIX)) {
                throw new StoreInvalidKeyError(key, 'the gate removes only store2/ keys and store2-fence')
            }
        }
        checkNoDuplicateKeys(keys.map((key): DeleteEntry => ({ key, condition: 'unconditional' })))
    }

    function refuseGatedForPlain(key: string, removal: boolean): void {
        if (guardsBypass) {
            return
        }
        if (GATED_WRITE_KEYS.includes(key) || (removal && key.startsWith(STORE2_PREFIX))) {
            throw new StoreInvalidKeyError(key, 'the plain path refuses a key the page-generation gate owns')
        }
    }

    const gate: TwoStepPageGate = {
        async registerPage(): Promise<number> {
            return gated ? underLock(() => ++generation) : ++generation
        },

        writeTop(presented: number, key: string, bytes: Uint8Array): Promise<WriteResult> {
            try {
                checkTopWritable(key)
                checkBytes(bytes)
            } catch (error) {
                return Promise.reject(error)
            }
            const own = bytes.slice()
            return gated
                ? underLock(() => {
                    checkGeneration(presented)
                    return applyWrite(key, own)
                })
                : Promise.resolve(applyWrite(key, own))
        },

        removeTop(presented: number, keys: readonly string[]): Promise<void> {
            try {
                checkTopRemovable(keys)
            } catch (error) {
                return Promise.reject(error)
            }
            const own = [...keys]
            if (!gated) {
                try {
                    applyRemoval(own)
                    return Promise.resolve()
                } catch (error) {
                    return Promise.reject(error)
                }
            }
            return underLock(() => {
                checkGeneration(presented)
                applyRemoval(own)
            })
        },

        async beginWriteTop(presented: number, key: string, bytes: Uint8Array): Promise<Landing> {
            checkTopWritable(key)
            checkBytes(bytes)
            const own = bytes.slice()
            return begin(presented, () => applyWrite(key, own))
        },

        async beginRemoveTop(presented: number, keys: readonly string[]): Promise<Landing> {
            checkTopRemovable(keys)
            const own = [...keys]
            return begin(presented, () => applyRemoval(own))
        },
    }

    /** Takes the lock and checks the generation; the landing applies and releases. Without the gate there is no lock to hold. */
    async function begin(presented: number, apply: () => unknown): Promise<Landing> {
        if (!gated) {
            return async () => apply()
        }
        await acquire()
        try {
            checkGeneration(presented)
        } catch (error) {
            release()
            throw error
        }
        let landed = false
        return async () => {
            if (landed) {
                throw new Error('A landing happens once.')
            }
            landed = true
            try {
                return apply()
            } finally {
                release()
            }
        }
    }

    /** A new store object over the same files and the same native side: the page's byte store after a reload. */
    function makeStore(): ByteStore {
        return {
            capabilities: { conditionalWrites: false },
            pageGate: gate,

            async read(key: string): Promise<ReadResult> {
                checkAddressable(key)
                const bytes = values.get(key)
                return { bytes: bytes === undefined ? null : bytes.slice(), version: null }
            },

            async write(key: string, bytes: Uint8Array, condition: StoreCondition): Promise<WriteResult> {
                checkCreatable(key)
                checkCondition(condition, false)
                checkBytes(bytes)
                refuseGatedForPlain(key, false)
                return applyWrite(key, bytes)
            },

            async delete(key: string, condition: StoreCondition): Promise<void> {
                checkAddressable(key)
                checkCondition(condition, false)
                refuseGatedForPlain(key, true)
                forget(key)
            },

            async deleteMany(entries: readonly DeleteEntry[]): Promise<void> {
                for (const entry of entries) {
                    checkAddressable(entry.key)
                    checkCondition(entry.condition, false)
                }
                checkNoDuplicateKeys(entries)
                for (const entry of entries) {
                    refuseGatedForPlain(entry.key, true)
                }
                for (const entry of entries) {
                    forget(entry.key)
                }
            },

            async list(prefix: string): Promise<string[]> {
                const reason = tauriAddressableViolation(prefix, platform, true)
                if (reason !== null) {
                    throw new StoreInvalidKeyError(prefix, reason)
                }
                return listHeld(prefix)
            },

            async has(key: string): Promise<boolean> {
                checkAddressable(key)
                return values.has(key)
            },
        }
    }

    let store = makeStore()

    function listHeld(prefix: string): string[] {
        return [...values.keys()].filter((key) => key.startsWith(prefix))
    }

    return {
        get store() {
            return store
        },
        snapshot() {
            return new Map([...values].map(([key, bytes]) => [key, bytes.slice()]))
        },
        peek(key) {
            return values.get(key)?.slice() ?? null
        },
        list: listHeld,
        plant(key, bytes) {
            // A planted file is state the run starts from: durable.
            notFlushed.delete(key)
            beneath.delete(key)
            values.set(key, bytes.slice())
        },
        remove(key) {
            forget(key)
        },
        markUnflushed(key) {
            if (!isDurable(key) || !values.has(key)) {
                throw new RangeError(`${key} holds no durable write to report unflushed.`)
            }
            notFlushed.set(key, beneath.get(key) ?? null)
        },
        unflushed() {
            return [...notFlushed.keys()].sort()
        },
        restart(drop) {
            const dropped: string[] = []
            if (drop) {
                for (const [key, below] of notFlushed) {
                    if (below === null) {
                        values.delete(key)
                    } else {
                        values.set(key, below.slice())
                    }
                    beneath.delete(key)
                    dropped.push(key)
                }
                notFlushed.clear()
            }
            store = makeStore()
            return dropped.sort()
        },
        get generation() {
            return generation
        },
        get locked() {
            return held
        },
    }
}
