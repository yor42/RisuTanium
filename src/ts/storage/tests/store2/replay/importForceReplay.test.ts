// @vitest-environment node
/**
 * The `force` of a commit under the replay (B3a): the commit of a `.bin` import replaces the whole profile and always keeps
 * the state it replaces in `retained`, whatever the retention admission interval says, and a bulk commit that finds a peer's
 * ordinary commit installed under its marker keeps that manifest too (the rejudge OR). Hand-built schedules on every backend;
 * the PCT region R20 samples the same shapes under random interleavings.
 *
 * Titles: `reproducer` fails when the named behaviour is removed (shown by the recorded mutants, since `force` has no earlier
 * base to be red on), `guard` holds with and without `force`.
 */
import { describe, expect, test } from 'vitest'
import type { CommitKey } from 'src/ts/storage/store2/format'
import type { CommitOutcome, ReplayActor, ReplayRig, ReplayRigOptions, StepMatch } from './actors'
import { createIdbReplayRig } from './idbRig'
import { createNodeReplayRig } from './nodeRig'
import { createTauriReplayRig } from './tauriRig'

type RigFactory = (options: ReplayRigOptions) => Promise<ReplayRig>

const BACKENDS: ReadonlyArray<{ name: string, make: RigFactory }> = [
    { name: 'node', make: createNodeReplayRig },
    { name: 'tauri', make: createTauriReplayRig },
    { name: 'indexeddb', make: createIdbReplayRig },
]

const MAX_STEPS = 20_000
const COMMIT_OPS = ['writeChecked', 'writeTop', 'casCommit']

function manifestOf(outcome: CommitOutcome): string {
    if (outcome.result.status !== 'committed') {
        throw new Error(`the commit came to ${outcome.result.status}`)
    }
    return outcome.result.manifestKey
}

async function keyOf(actor: ReplayActor): Promise<CommitKey> {
    const key = await actor.readKey()
    if (key === null) {
        throw new Error('the commit key does not parse')
    }
    return key
}

describe.each(BACKENDS)('$name: force on a commit', ({ make }) => {
    // Reproducer (mutants: force ignored on an ordinary commit; force required together with the admission interval).
    test('a forced ordinary commit keeps the replaced manifest at the head of retained inside the admission interval; an unforced one does not', async () => {
        const rig = await make({ scheduler: { seed: 1 }, start: 'healthy' })
        const seen: Record<string, string | undefined> = {}
        rig.spawn('a', 10, async (actor) => {
            await actor.open()
            const first = manifestOf(await actor.commit('first'))
            seen.unforcedFirst = first
            const second = manifestOf(await actor.commit('second'))
            seen.unforcedHead = (await keyOf(actor)).retained[0]?.key
            seen.second = second
            const forced = manifestOf(await actor.forcedCommit('third'))
            seen.forced = forced
            seen.forcedHead = (await keyOf(actor)).retained[0]?.key
        })
        const result = await rig.run({ maxSteps: MAX_STEPS })
        expect(result.status).toBe('finished')
        expect(rig.checker.violations).toEqual([])
        // Inside the interval the unforced second commit leaves the first manifest out of retained.
        expect(seen.unforcedHead).not.toBe(seen.unforcedFirst)
        expect(seen.unforcedHead).not.toBe(seen.second)
        // The forced one pushes the manifest it replaces.
        expect(seen.forcedHead).toBe(seen.second)
    })

    // Reproducer (mutants: force ignored on a bulk commit; the OR in the rejudge written as an AND).
    test('a forced bulk commit with no peer keeps the replaced manifest at the head of retained; an unforced one does not', async () => {
        const rig = await make({ scheduler: { seed: 1 }, start: 'healthy' })
        const seen: Record<string, string | undefined> = {}
        rig.spawn('a', 10, async (actor) => {
            await actor.open()
            manifestOf(await actor.commit('first'))
            const before = manifestOf(await actor.commit('second'))
            seen.unforcedBefore = before
            manifestOf(await actor.bulkCommit('unforced'))
            seen.unforcedHead = (await keyOf(actor)).retained[0]?.key
            const replaced = manifestOf(await actor.bulkCommit('replaced'))
            const forced = manifestOf(await actor.forcedBulkCommit('forced'))
            seen.replaced = replaced
            seen.forced = forced
            const key = await keyOf(actor)
            seen.forcedHead = key.retained[0]?.key
            seen.current = key.current?.key
            seen.marker = key.staging === null ? 'cleared' : 'standing'
        })
        const result = await rig.run({ maxSteps: MAX_STEPS })
        expect(result.status).toBe('finished')
        expect(rig.checker.violations).toEqual([])
        expect(seen.unforcedHead).not.toBe(seen.unforcedBefore)
        expect(seen.current).toBe(seen.forced)
        expect(seen.forcedHead).toBe(seen.replaced)
        expect(seen.marker).toBe('cleared')
    })
})

// A Tauri device has one page: a second tab registers with the page gate and makes the first stale, so the peer interleaving
// below does not exist there.
describe.each(BACKENDS.filter((backend) => backend.name !== 'tauri'))('$name: a bulk commit while a peer commits ordinarily under its marker', ({ name, make }) => {
    // IndexedDB schedules at the backend layer: an ordinary commit is one `commitOrdinary` call, every other commit-key write a `casCommit`.
    const idb = name === 'indexeddb'
    const bulkFinal: StepMatch & { actor: string } = idb ? { actor: 'a', op: 'casCommit', context: 'bulk-final' } : { actor: 'a', op: COMMIT_OPS, target: '$commit', context: 'bulk-final' }
    const bulkBegin: StepMatch = idb ? { actor: 'a', op: 'casCommit', context: 'bulk-begin' } : { actor: 'a', op: COMMIT_OPS, target: '$commit', context: 'bulk-begin' }
    const peerCommit: StepMatch = idb ? { actor: 'b', op: 'commitOrdinary', context: 'commit' } : { actor: 'b', op: COMMIT_OPS, target: '$commit', context: 'commit' }

    /** The bulk commit's final write waits until the peer's commit has landed, so the final write meets the peer's `current`. */
    async function underPeer(forced: boolean) {
        const rig = await make({ scheduler: { seed: 1 }, start: 'healthy', holds: [{ call: bulkFinal, until: peerCommit }] })
        const seen: Record<string, string | undefined> = {}
        rig.spawn('a', 10, async (actor) => {
            await actor.open()
            const outcome = forced ? await actor.forcedBulkCommit('bulk') : await actor.bulkCommit('bulk')
            seen.bulk = outcome.result.status
            seen.bulkManifest = outcome.result.status === 'committed' ? outcome.result.manifestKey : undefined
        })
        rig.spawn('b', 11, async (actor) => {
            await rig.reached(bulkBegin)
            await actor.open()
            const peer = await actor.commit('peer')
            seen.peer = peer.result.status
            seen.peerManifest = peer.result.status === 'committed' ? peer.result.manifestKey : undefined
        })
        const result = await rig.run({ maxSteps: MAX_STEPS })
        expect(result.status, JSON.stringify(seen)).toBe('finished')
        expect(rig.checker.violations).toEqual([])
        return { seen, rig }
    }

    // Reproducer (mutants: the rejudge ignores a `current` that changed under the marker).
    test('unforced: the peer\'s manifest, installed and never judged by the bulk commit, is pushed into retained', async () => {
        const { seen, rig } = await underPeer(false)
        expect(seen.peer).toBe('committed')
        expect(seen.bulk).toBe('committed')
        const key = await finalKey(rig)
        expect(key.current?.key).toBe(seen.bulkManifest)
        expect(key.staging).toBeNull()
        expect(key.retained[0]?.key).toBe(seen.peerManifest)
    })

    // Guard: with a peer's change under the marker the rejudge is true whatever `force` is, so this passes with `force` ignored or AND-ed; the no-peer bulk test above pins `force`.
    test('forced: the peer\'s manifest is pushed into retained and the marker is cleared by the final write', async () => {
        const { seen, rig } = await underPeer(true)
        expect(seen.peer).toBe('committed')
        expect(seen.bulk).toBe('committed')
        const key = await finalKey(rig)
        expect(key.current?.key).toBe(seen.bulkManifest)
        expect(key.staging).toBeNull()
        expect(key.retained[0]?.key).toBe(seen.peerManifest)
    })
})

async function finalKey(rig: ReplayRig): Promise<CommitKey> {
    const { classifyCommitRead } = await import('src/ts/storage/store2/commitKey')
    const { COMMIT_KEY } = await import('src/ts/storage/store2/format/keys')
    const parsed = classifyCommitRead({ bytes: rig.hooks.peek(COMMIT_KEY) })
    if (parsed.status !== 'parsed') {
        throw new Error(`the stored commit key is ${parsed.status}`)
    }
    return parsed.value
}
