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
    readonly store: ByteStore
    /** A copy of every key that holds bytes. */
    snapshot(): Map<string, Uint8Array>
    /** The key as stored, read without a request and without any wrapper around `store`. */
    peek(key: string): Uint8Array | null
    /** The keys under `prefix` that hold a value, read without a request. */
    list(prefix: string): string[]
    /** Puts a file in place without any request. */
    plant(key: string, bytes: Uint8Array): void
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

    function applyWrite(key: string, bytes: Uint8Array): WriteResult {
        values.set(key, bytes.slice())
        return isDurable(key) ? { version: null, flushed: true } : { version: null }
    }

    /** The removal a gated call performs once it holds the lock and passed its check. */
    function applyRemoval(keys: readonly string[]): void {
        const report = keys.map((key): DeleteReportEntry => {
            if (tauriAddressableViolation(key, platform) !== null) {
                return { key, outcome: 'failed', error: new TypeError('the path cannot be addressed') }
            }
            values.delete(key)
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

    const store: ByteStore = {
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
            values.delete(key)
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
                values.delete(entry.key)
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

    function listHeld(prefix: string): string[] {
        return [...values.keys()].filter((key) => key.startsWith(prefix))
    }

    return {
        store,
        snapshot() {
            return new Map([...values].map(([key, bytes]) => [key, bytes.slice()]))
        },
        peek(key) {
            return values.get(key)?.slice() ?? null
        },
        list: listHeld,
        plant(key, bytes) {
            values.set(key, bytes.slice())
        },
        get generation() {
            return generation
        },
        get locked() {
            return held
        },
    }
}
