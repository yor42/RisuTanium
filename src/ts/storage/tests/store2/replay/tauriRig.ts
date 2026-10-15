/**
 * The Tauri rig of the store2 replay: pages (boot, commit, GC, fence exit and
 * discard) running the real `Store2Session`, committer, `gcPass` and fence code over
 * the real `createTauriBackend`, on the scheduled Tauri-semantics store. Nothing of
 * the protocol is re-implemented here: a page is a program of those calls.
 *
 * Rules the rig keeps, so that a run is deterministic and the checker can judge it:
 *  - the raw state is bytes-only (`revision: null`), so the boot re-flush, which
 *    rewrites identical bytes, is not a write, and it carries the context `read`,
 *    never `fence-exit`;
 *  - every page injects a seeded `KeyEnv`, so keys and owner ids do not depend on the
 *    clock or `Math.random`;
 *  - a deleter reads before it deletes: `gcPass` reads the commit key and the fence
 *    first, which is the read the checker judges its removals against;
 *  - on this backend the commit-key and fence compare is made in the library under
 *    its mutex and the native call is unconditional, so the `commitExpect` and
 *    `fenceExpect` the scheduler reports are vacuous here.
 *
 * Pages are spawned with `spawnPage`: every actor of a page shares one scheduled
 * store, so the backend's in-process mutex is shared as it is in the app, and a
 * crash retires the whole page.
 *
 * The replay rig (`createTauriReplayRig`) also reports a flush fault to the store and
 * restarts a page through the store's `restart`, which drops unflushed writes and hands
 * the next page a new store object (the backend's mutex is keyed by it).
 */
import { createTauriBackend } from 'src/ts/storage/store2/backend'
import type { CommitResult } from 'src/ts/storage/store2/commit'
import { discardFence, fenceExit, readFenceVerdict, type FenceDiscardResult, type FenceExitResult } from 'src/ts/storage/store2/fence'
import type { KeyEnv } from 'src/ts/storage/store2/format'
import { gcPass, type GcResult } from 'src/ts/storage/store2/gc/pass'
import { Store2Session } from 'src/ts/storage/store2/session'
import { createChecker, type Checker } from './checker'
import { createClock, seedStore, testEnv, treeRequest, type BuildRecord, type TestClock } from '../commitFixtures'
import { assembleRig, seededStart, type ReplayRig, type ReplayRigOptions, type RigParts } from './actors'
import {
    createScheduler, type ActorHandle, type RawState, type RunResult, type Scheduler, type SchedulerOptions, type StepInfo,
} from './scheduler'
import { createTauriSemanticStore, rawOfTauriSemantic, type TauriSemanticOptions, type TauriSemanticStore } from './tauriSemanticStore'

export interface TauriRigOptions {
    /** The store's test options; the gate is on by default. */
    store?: TauriSemanticOptions
    /** The scheduler's seed, policy and fault plan; the rig supplies `onStep`. */
    scheduler: Omit<SchedulerOptions, 'onStep'>
    /** Whether the store starts with a first complete tree and the commit key naming it; default true. */
    seeded?: boolean
    /** Plants state in the store after the seeding and before the checker takes its first snapshot. */
    prepare?: (fake: TauriSemanticStore) => void
}

export interface TauriRig {
    readonly fake: TauriSemanticStore
    readonly scheduler: Scheduler
    readonly checker: Checker
    readonly raw: () => RawState
    readonly clock: TestClock
    /** The manifest key of the seeded tree, or null for an unseeded store. */
    readonly seedManifest: string | null
    /** A seeded environment: the same seed gives the same keys and owner ids. */
    envOf(seed: number): KeyEnv
    /** Resolves once a step satisfying `predicate` has been applied and judged by the checker. */
    when(predicate: (info: StepInfo) => boolean): Promise<void>
    run(limit?: { maxSteps?: number }): Promise<RunResult>
}

export async function createTauriRig(options: TauriRigOptions): Promise<TauriRig> {
    const fake = createTauriSemanticStore(options.store)
    const clock = createClock()
    const envOf = (seed: number): KeyEnv => testEnv(clock, seed)
    let seedManifest: string | null = null
    if (options.seeded !== false) {
        // The seeding page registers like any page and is stale as soon as the first real page does.
        seedManifest = await seedStore(await createTauriBackend(fake.store), envOf(1))
    }
    options.prepare?.(fake)
    const raw = rawOfTauriSemantic(fake)
    const checker = createChecker(raw)
    const watchers: Array<{ predicate: (info: StepInfo) => boolean, resolve: () => void }> = []
    const scheduler = createScheduler({
        ...options.scheduler,
        onStep: (info) => {
            checker.observe(info)
            for (const watcher of watchers.filter((each) => each.predicate(info))) {
                watchers.splice(watchers.indexOf(watcher), 1)
                watcher.resolve()
            }
        },
    })
    return {
        fake, scheduler, checker, raw, clock, seedManifest, envOf,
        when: (predicate) => new Promise<void>((resolve) => { watchers.push({ predicate, resolve }) }),
        run: (limit) => scheduler.run(limit),
    }
}

export interface TauriReplayRigOptions extends ReplayRigOptions {
    /** The store's test options; the gate is on by default. */
    store?: TauriSemanticOptions
}

export type TauriReplayRig = ReplayRig & { readonly fake: TauriSemanticStore }

/**
 * The Tauri rig of the replay actors (`actors.ts`): a page is the actors that share
 * its id, one session, one backend, one registration with the page gate. A page
 * keeps its owner id in an in-memory owner store, so `restart` finds it again.
 */
export async function createTauriReplayRig(options: TauriReplayRigOptions): Promise<TauriReplayRig> {
    const fake = createTauriSemanticStore(options.store)
    const clock = createClock()
    const start = options.start ?? 'healthy'
    // The seeding page registers like any page and is stale as soon as the first real page does.
    const seedManifest = seededStart(start) ? await seedStore(await createTauriBackend(fake.store), testEnv(clock, 1)) : null
    const parts: RigParts = {
        variant: 'tauri',
        raw: rawOfTauriSemantic(fake),
        hooks: { peek: (key) => fake.peek(key), plant: (key, bytes) => fake.plant(key, bytes), list: (prefix) => fake.list(prefix), remove: (key) => fake.remove(key) },
        deviceOwner: true,
        restart: (drop) => fake.restart(drop),
        unflushed: (key) => fake.markUnflushed(key),
        pageStore: (handle) => handle.byteStore(fake.store),
        openBackend: (store) => createTauriBackend(store),
        probe: () => undefined,
    }
    return Object.assign(assembleRig({ parts, clock, seedManifest, options }), { fake })
}

/** What one page does, in the operations the checker judges: each one declares its context first. */
export interface PageContext {
    readonly actor: ActorHandle
    readonly rig: TauriRig
    readonly env: KeyEnv
    /** `Store2Session.open` on the page's scheduled store: registration, re-flush and the boot reads. Once per page. */
    open(): Promise<Store2Session>
    /** One ordinary commit of a complete tree of `10 + extra` units besides the manifest; `keys` are the units it uploaded. */
    commit(session: Store2Session, tag: string, extra?: number): Promise<{ result: CommitResult, keys: string[] }>
    gc(session: Store2Session): Promise<GcResult>
    /** The recovery-screen exit's fence write over the stored fence. */
    exitFence(session: Store2Session): Promise<FenceExitResult>
    /** The fence delete at the token of a fresh read of the fence. */
    discardFence(session: Store2Session): Promise<FenceDiscardResult>
}

export function spawnPage(rig: TauriRig, id: string, seed: number, program: (page: PageContext) => Promise<void>): void {
    rig.scheduler.spawn(id, async (actor) => {
        const env = rig.envOf(seed)
        const page: PageContext = {
            actor,
            rig,
            env,
            async open() {
                actor.setContext({ kind: 'read' })
                return await Store2Session.open(actor.byteStore(rig.fake.store), {
                    kind: 'tauri',
                    env,
                    upstreamMainFile: async () => false,
                })
            },
            async commit(session, tag, extra = 0) {
                actor.setContext({ kind: 'commit', owner: session.ownerId })
                const record: BuildRecord[] = []
                const committer = session.committer
                if (committer === null) {
                    throw new Error('The page has no committer: it opened read-only.')
                }
                const result = await committer.commit(await committer.readCommit(), treeRequest(extra, { tag, record }))
                return { result, keys: record.length === 0 ? [] : record[record.length - 1].keys }
            },
            async gc(session) {
                actor.setContext({ kind: 'gc' })
                if (session.backend === null) {
                    throw new Error('The page has no backend: it opened read-only.')
                }
                return await gcPass({ backend: session.backend, kind: 'tauri', idleReason: () => session.idleReason })
            },
            async exitFence(session) {
                actor.setContext({ kind: 'fence-exit', owner: session.ownerId })
                if (session.backend === null) {
                    throw new Error('The page has no backend: it opened read-only.')
                }
                return await fenceExit(session.backend, { damagedCommitBytes: null, now: env.now })
            },
            async discardFence(session) {
                actor.setContext({ kind: 'fence-discard', owner: session.ownerId })
                if (session.backend === null) {
                    throw new Error('The page has no backend: it opened read-only.')
                }
                const verdict = await readFenceVerdict(session.backend)
                if (verdict.token === null) {
                    throw new Error('The fence could not be read.')
                }
                return await discardFence(session.backend, verdict.token)
            },
        }
        await program(page)
        actor.setContext(null)
    }, { page: id })
}
