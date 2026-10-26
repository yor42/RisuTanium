import type { RisuModule } from '../../process/modules'
import type { ListDerivation, PreviousEncoding } from './codec'
import type { KeyEnv } from './format'
import type { SaveEncoder } from './saveEncoder'
import type { IdleNetOptions, Store2PeerHandler } from './saveLoop'
import type { Store2Session } from './session'

/**
 * The seam that keeps the store2 save loop unreachable without a store2 session. `saveDb()` asks for the active
 * context after its read-only guard: `null` runs the loop of the block profile exactly as before, a context runs the
 * store2 loop. Until the boot dispatch lands (W2) only tests activate one. This module holds one variable and imports
 * types only, so the save loop's own module graph is loaded only for a page that has a session.
 */

/**
 * What the module valve answers: `loaded` (no stub of that id is left in the live list), `refused` (one is, and the
 * pass is a failed save), or `deferred` (the load waits for the person; `settled` resolves, never rejects, once it has ended).
 */
export type ModuleStubLoad =
    | { kind: 'loaded' }
    | { kind: 'refused' }
    | { kind: 'deferred', settled: Promise<void> }

export interface Store2SaveContext {
    /** The part of the session the loop uses: the committer, and the kind that decides whether Save mine is offered. */
    session: Pick<Store2Session, 'kind' | 'committer'>
    /** The acknowledged encoding of the tree the page booted from. */
    previous: PreviousEncoding
    /**
     * The encoder the loop saves through, created by the dispatch so that a residency shares the loop's acknowledged
     * encoding. Absent, the loop creates its own from `previous`, `lists` and `env`; present, those three are the
     * ones the encoder was created with.
     */
    encoder?: SaveEncoder
    lists: ListDerivation
    env?: KeyEnv
    peer: Store2PeerHandler
    /**
     * Loads the stub of `chaId` that shares its id with another character; true when it is resident afterwards. It runs
     * while the loop holds the write lock, so it must not take `dbWriteLock` or wait for a commit.
     */
    loadStub?: (chaId: string) => Promise<boolean>
    /**
     * Brings in the module stub of `moduleId` that the planner could not carry. It runs while the loop holds the write
     * lock, so it must not take `dbWriteLock`, wait for a commit or wait for the person: a load that would ask answers
     * `deferred` at once, with the promise that settles when that load has ended.
     */
    loadModuleStub?: (moduleId: string) => Promise<ModuleStubLoad>
    /** The idle net's cadence; `null` switches it off. Absent runs it at its default cadence. */
    idleNet?: IdleNetOptions | null
}

/** A context handed to `activateStore2Save` that cannot save: the session has no committer. */
export class Store2SaveContextError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'Store2SaveContextError'
    }
}

let active: Store2SaveContext | null = null

export function activateStore2Save(context: Store2SaveContext): void {
    if (context.session.committer === null) {
        throw new Store2SaveContextError('A store2 session without a committer cannot save.')
    }
    active = context
}

export function getActiveStore2Save(): Store2SaveContext | null {
    return active
}

export function resetStore2SaveForTest(): void {
    active = null
    moduleLoader = null
}

/**
 * Brings a module stub's body in: it receives the stub's handle (`${id}#0`) and the caller's signal, installs the body
 * into the slot and returns that live slot, or null when the module is gone.
 */
export type ModuleLoader = (handle: string, signal?: AbortSignal) => Promise<RisuModule | null>

/**
 * The page's module loader, set by the boot dispatch beside the residency and read by `acquireModule`. It lives here, a
 * module that imports types only, so the dispatch can register it without loading the database store that
 * `moduleAcquire` reads. Invariant: nothing that loads `moduleAcquire` or `stores.svelte` may be imported while the
 * dispatch itself runs, because `stores.svelte` cannot load in the node environment of the dispatch tests; registration
 * goes through this module only. The dispatch's wrappers import the loader lazily when they are called, which is fine.
 */
let moduleLoader: ModuleLoader | null = null

export function setModuleLoader(loader: ModuleLoader | null): void {
    moduleLoader = loader
}

export function getModuleLoader(): ModuleLoader | null {
    return moduleLoader
}

/** What a commit's broadcast carries: the sender's session and the epoch its commit key now holds. */
export interface Store2Broadcast {
    sessionID: string
    epoch: string | null
}

/** A peer's broadcast; anything without a session id is not one. A bare session id is a sender that names no epoch. */
export function parseStore2Broadcast(data: unknown): Store2Broadcast | null {
    if (typeof data === 'string') {
        return { sessionID: data, epoch: null }
    }
    if (typeof data === 'object' && data !== null) {
        const { sessionID, epoch } = data as { sessionID?: unknown, epoch?: unknown }
        if (typeof sessionID === 'string') {
            return { sessionID, epoch: typeof epoch === 'string' ? epoch : null }
        }
    }
    return null
}
