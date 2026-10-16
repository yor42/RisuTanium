/**
 * The Node rig of the store2 replay: every actor is a tab with a backend of its own,
 * the real `createNodeBackend`, over its own scheduled view of one Node-semantics
 * store (`nodeSemanticStore`), so a unit upload and the check-only commit-key write
 * are separate steps and the revision compare is the one the server makes. The
 * actors, the start states and the checker are those of `actors.ts`.
 *
 * The raw state carries the server's revisions; silent damage keeps the revision
 * and changes the bytes.
 */
import { createNodeBackend } from 'src/ts/storage/store2/backend'
import { createClock, seedStore, testEnv } from '../commitFixtures'
import { assembleRig, seededStart, type ReplayRig, type ReplayRigOptions, type RigParts } from './actors'
import { rawOfNodeSemantic } from './checker'
import { createNodeSemanticStore, type NodeSemanticOptions, type NodeSemanticStore } from './nodeSemanticStore'
import { createRng, LISTING_SALT, shuffleListing } from './scheduler'

export interface NodeReplayRigOptions extends ReplayRigOptions {
    /** The fake server's own limits. */
    store?: NodeSemanticOptions
}

export type NodeReplayRig = ReplayRig & { readonly fake: NodeSemanticStore }

export async function createNodeReplayRig(options: NodeReplayRigOptions): Promise<NodeReplayRig> {
    const fake = createNodeSemanticStore(options.store)
    const clock = createClock()
    const start = options.start ?? 'healthy'
    // The seeding backend is unscheduled; it writes a first tree and the commit key naming it.
    const seedManifest = seededStart(start) ? await seedStore(createNodeBackend(fake.store), testEnv(clock, 1)) : null
    const listing = createRng(options.scheduler.seed ^ LISTING_SALT)
    const parts: RigParts = {
        variant: 'node',
        raw: rawOfNodeSemantic(fake),
        hooks: { peek: (key) => fake.peek(key).bytes, plant: (key, bytes) => fake.plant(key, bytes), list: (prefix) => fake.list(prefix), remove: (key) => fake.remove(key) },
        deviceOwner: false,
        pageStore: (handle) => handle.byteStore(fake.store),
        // The server's listing is sorted and nothing may rely on that: every tab's listing is shuffled by the rig's seeded stream.
        openBackend: async (store) => shuffleListing(createNodeBackend(store), listing),
        probe: (store) => {
            const guarded = store.guarded
            return guarded === undefined ? undefined : () => guarded.probe()
        },
    }
    return Object.assign(assembleRig({ parts, clock, seedManifest, options }), { fake })
}
