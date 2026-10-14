// @vitest-environment node
/**
 * Recovery across modules: the fence exit, the marker, the closure read, the
 * staged re-write and the final write, with the real deleter gate and a deleter
 * stand-in running at each step, and the boot table deciding after a crash.
 * Memory, IndexedDB (fake-indexeddb) and Node (real server process) backends;
 * Tauri is not run.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Store2Backend } from 'src/ts/storage/store2/backend'
import { classifyCommitRead, nextCommitKey } from 'src/ts/storage/store2/commitKey'
import { encodeUnit, newUnitKey, UNIT_TYPE } from 'src/ts/storage/store2/format'
import { runExit, listRecoveryCandidates, type ExitResult } from 'src/ts/storage/store2/recovery'
import { installPick, pickCandidate, type AssetsPresent, type InlayPrefixesPresent, type InlaysPresent, type InstallResult, type PickReady } from 'src/ts/storage/store2/recoveryPick'
import {
    committerOf, createClock, expectInvariant, hooked, parsedCommit, testEnv, treeRequest, type Hooks,
} from './commitFixtures'
import { FENCE_BACKENDS, plantCommit, type OpenedBackend } from './fenceFixtures'
import { closureOf, deleterStandIn, plantTree, rebootDecision, type Planted } from './recoveryFixtures'

vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 })

const opened: OpenedBackend[] = []

afterEach(async () => {
    await Promise.all(opened.splice(0).map(entry => entry.close()))
})

const DAMAGED_COMMIT = Uint8Array.from([0, 1, 2, 250, 251, 252, 253, 254, 255, 62, 63])
const ME = 'a'.repeat(26)
const PEER = 'b'.repeat(26)
const HOUR = 3_600_000

class Crash extends Error {}

const everythingPresent: { assetsPresent: AssetsPresent, inlaysPresent: InlaysPresent, inlayPrefixesPresent: InlayPrefixesPresent } = {
    inlayPrefixesPresent: async (prefixes) => new Set(prefixes),
    assetsPresent: async (keys) => new Set(keys),
    inlaysPresent: async (keys) => new Set(keys),
}

async function openBackend(index: number): Promise<Store2Backend> {
    const entry = await FENCE_BACKENDS[index].open()
    opened.push(entry)
    return entry.backend
}

function marked(result: ExitResult): Extract<ExitResult, { status: 'marked' }> {
    expect(result.status).toBe('marked')
    if (result.status !== 'marked') {
        throw new Error(`The exit ended ${result.status}.`)
    }
    return result
}

function ready(result: Awaited<ReturnType<typeof pickCandidate>>): PickReady {
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') {
        throw new Error(`The pick ended ${result.status}.`)
    }
    return result
}

function installedOf(result: InstallResult): Extract<InstallResult, { status: 'installed' }> {
    expect(result.status).toBe('installed')
    if (result.status !== 'installed') {
        throw new Error(`The install ended ${result.status}.`)
    }
    return result
}

describe.each(FENCE_BACKENDS.map((fixture, index) => [fixture.name, index] as const))('recovery integration on the %s backend', (_name, index) => {
    test('V1-shaped: fresh start, an ordinary commit, commit-key damage, then a recovery pick; no pre-fence key is deleted at any step', async () => {
        const backend = await openBackend(index)
        const clock = createClock()
        const env = testEnv(clock, 11)
        const steps: string[] = []

        async function standIn(step: string): Promise<{ ran: boolean, refused: string | null, deleted: string[] }> {
            const result = await deleterStandIn(backend)
            steps.push(`${step}:${result.ran ? 'ran' : result.refused}`)
            return result
        }

        // Fresh start: the seed exit over an empty store, a seed tree under the marker's prefix, the final write.
        const empty = await backend.readCommit()
        expect(empty.bytes).toBeNull()
        const seedExit = marked(await runExit(backend, empty, { kind: 'seed' }, { owner: ME, env }))
        expect((await standIn('after the seed marker')).ran).toBe(false)
        const stagingId = seedExit.stagedPrefix.slice('store2/g-'.length, -1)
        const seeded = await plantTree(backend, env, { flavor: { stagingId }, shape: { characters: 1, chats: 1, chunks: 1, modules: 1, buckets: 1 }, seq: 2 })
        const seedKey = nextCommitKey(seedExit.marker, { current: { key: seeded.manifestKey, at: clock.now }, staging: null, manifests: [seeded.body] }, env)
        await backend.casCommit(seedExit.markerRead.token, encodeUnit(UNIT_TYPE.commit, seedKey))
        expect((await standIn('after the seed')).deleted).toEqual([])

        // An ordinary commit through the committer: an `m-` manifest.
        clock.advance(HOUR)
        const committer = committerOf(backend, clock, 21, { owner: ME })
        const commit = await committer.commit(await committer.readCommit(), treeRequest(2, { tag: 'later' }))
        expect(commit.status).toBe('committed')
        expect((await standIn('after the commit')).deleted).toEqual([])

        // Damage, then the recovery.
        await plantCommit(backend, DAMAGED_COMMIT)
        const preFence = await backend.listStore2()
        expect((await standIn('after the damage')).refused).toBe('commit-unparsable')

        const damaged = await backend.readCommit()
        const listing = await listRecoveryCandidates(backend, classifyCommitRead(damaged))
        expect(listing.status).toBe('listed')
        const candidates = listing.status === 'listed' ? listing.candidates : []
        // Newest first: the ordinary manifest of the later commit, then the staged seed manifest.
        expect(candidates[0]).toBe(commit.status === 'committed' ? commit.manifestKey : '')
        expect(candidates).toContain(seeded.manifestKey)

        const pick = ready(await pickCandidate(backend, damaged, candidates[0], { owner: ME, env: testEnv(clock, 31), ...everythingPresent }))
        expect((await standIn('after the pick marker')).refused).toBe('no-current')
        const result = installedOf(await installPick(pick, { confirm: true }))
        const last = await standIn('after the install')

        expect(last.ran).toBe(true)
        for (const key of preFence) {
            expect(await backend.listStore2(), `${key} survives`).toContain(key)
            expect(last.deleted).not.toContain(key)
        }
        expect((await parsedCommit(backend)).current?.key).toBe(result.manifestKey)
        await expectInvariant(backend)
        expect(steps).toEqual([
            'after the seed marker:no-current',
            'after the seed:ran',
            'after the commit:ran',
            'after the damage:commit-unparsable',
            'after the pick marker:no-current',
            'after the install:ran',
        ])
    })

    describe('a crash at each step, a deleter pass, then a reboot', () => {
        interface CrashCase {
            step: string
            hooks: Hooks
            refusal: string
            row: number
            /** Whether a marker of the crashed page stands after the crash. */
            marker: boolean
        }
        const crashes: readonly CrashCase[] = [
            { step: 'after the fence', hooks: { after: (name, count) => { if (name === 'casFence' && count === 1) { throw new Crash('after the fence') } } }, refusal: 'commit-unparsable', row: 4, marker: false },
            { step: 'after the marker', hooks: { after: (name, count) => { if (name === 'casCommit' && count === 1) { throw new Crash('after the marker') } } }, refusal: 'no-current', row: 8, marker: true },
            { step: 'mid re-write', hooks: { before: (name, count) => { if (name === 'putUnit' && count === 5) { throw new Crash('mid re-write') } } }, refusal: 'no-current', row: 8, marker: true },
            { step: 'before the final write', hooks: { before: (name, count) => { if (name === 'casCommit' && count === 2) { throw new Crash('before the final write') } } }, refusal: 'no-current', row: 8, marker: true },
        ]

        test.each(crashes.map(entry => [entry.step, entry] as const))('%s', async (_step, crash) => {
            const backend = await openBackend(index)
            const clock = createClock()
            const env = testEnv(clock, 41)
            const older = await plantTree(backend, env, { shape: { characters: 1, chats: 1, chunks: 1, modules: 1, buckets: 1 }, seq: 3 })
            clock.advance(HOUR)
            const newer = await plantTree(backend, env, { shape: { characters: 1, chats: 1, chunks: 2, modules: 1, buckets: 1 }, seq: 4 })
            clock.advance(HOUR)
            const staged = await plantTree(backend, env, { flavor: { stagingId: '0123456789abcdef' }, shape: { characters: 1, chats: 1, chunks: 1, modules: 1, buckets: 1 }, seq: 5 })
            await plantCommit(backend, DAMAGED_COMMIT)
            const candidates = [older, newer, staged].map(planted => planted.manifestKey)
            const preFence = await backend.listStore2()

            const recorded = hooked(backend, crash.hooks)
            const read = await backend.readCommit()
            await expect((async () => {
                const pick = ready(await pickCandidate(recorded.backend, read, newer.manifestKey, { owner: ME, env: testEnv(clock, 51), ...everythingPresent }))
                await installPick(pick, { confirm: true })
            })()).rejects.toBeInstanceOf(Crash)

            // A key written after the fence is nobody's and stays only while a deleter refuses.
            const orphan = newUnitKey(env)
            await backend.putUnit(orphan, new Uint8Array([7]))
            const pass = await deleterStandIn(backend)
            expect(pass.ran).toBe(false)
            expect(pass.refused).toBe(crash.refusal)
            expect(pass.deleted).toEqual([])

            const after = await backend.listStore2()
            for (const key of preFence) {
                expect(after, `${key} survives`).toContain(key)
            }
            expect(after).toContain(orphan)

            const decision = await rebootDecision(backend)
            expect(decision).toMatchObject({ row: crash.row, mode: 'recovery' })
            const commit = classifyCommitRead(await backend.readCommit())
            expect(commit.status).toBe(crash.marker ? 'parsed' : 'damaged')
            const listing = await listRecoveryCandidates(backend, commit)
            expect(listing.status).toBe('listed')
            const shown = listing.status === 'listed' ? listing.candidates : []
            for (const candidate of candidates) {
                expect(shown, `${candidate} is offered again`).toContain(candidate)
            }
            if (crash.marker && commit.status === 'parsed' && commit.value.staging !== null) {
                // An unfinished stage of the crashed page is never offered.
                const standing = commit.value.staging.prefix
                expect(shown.filter(key => key.startsWith(standing))).toEqual([])
            }

            // The screen returns and a reboot's pick completes: the crashed page's marker is foreign to it and cleared through the hook.
            const again = await backend.readCommit()
            const rerun = ready(await pickCandidate(backend, again, newer.manifestKey, {
                owner: 'c'.repeat(26),
                env: testEnv(clock, 61),
                foreignClear: async () => true,
                ...everythingPresent,
            }))
            const installedAgain = installedOf(await installPick(rerun, { confirm: true }))
            await expectInvariant(backend)
            expect((await closureOf(backend, installedAgain.manifestKey)).problems).toEqual([])
            for (const key of preFence) {
                expect(await backend.listStore2(), `${key} survives the second pick`).toContain(key)
            }
        })
    })

    describe('D6: two pages recovering', () => {
        async function twoPages(): Promise<{ backend: Store2Backend, planted: Planted, read: Awaited<ReturnType<Store2Backend['readCommit']>>, clock: ReturnType<typeof createClock> }> {
            const backend = await openBackend(index)
            const clock = createClock()
            const planted = await plantTree(backend, testEnv(clock, 71), { shape: { characters: 1, chats: 1, chunks: 1, modules: 1, buckets: 1 } })
            await plantCommit(backend, DAMAGED_COMMIT)
            return { backend, planted, read: await backend.readCommit(), clock }
        }

        test('the later page never replaces the earlier one\'s marker without the foreign-clear hook', async () => {
            const { backend, planted, read, clock } = await twoPages()
            const first = ready(await pickCandidate(backend, read, planted.manifestKey, { owner: ME, env: testEnv(clock, 72), ...everythingPresent }))
            const markerBytes = (await backend.readCommit()).bytes

            // Its stale read of the damaged key meets the first page's marker.
            const stale = await pickCandidate(backend, read, planted.manifestKey, { owner: PEER, env: testEnv(clock, 73), ...everythingPresent })
            expect(stale).toMatchObject({ status: 'exit', exit: { status: 'conflict' } })
            // Its fresh read finds a foreign marker: no hook, a declining hook.
            const fresh = await backend.readCommit()
            expect(await pickCandidate(backend, fresh, planted.manifestKey, { owner: PEER, env: testEnv(clock, 74), ...everythingPresent }))
                .toMatchObject({ status: 'exit', exit: { status: 'foreign-marker' } })
            expect(await pickCandidate(backend, fresh, planted.manifestKey, { owner: PEER, env: testEnv(clock, 75), foreignClear: async () => false, ...everythingPresent }))
                .toMatchObject({ status: 'exit', exit: { status: 'foreign-marker' } })
            expect((await backend.readCommit()).bytes).toEqual(markerBytes)
            expect((await parsedCommit(backend)).staging?.owner).toBe(ME)

            // The first page still finishes.
            installedOf(await installPick(first, { confirm: true }))
            await expectInvariant(backend)
        })

        test('through the hook the later page replaces the marker; exactly one final write wins and I1 holds', async () => {
            const { backend, planted, read, clock } = await twoPages()
            const first = ready(await pickCandidate(backend, read, planted.manifestKey, { owner: ME, env: testEnv(clock, 82), ...everythingPresent }))
            const second = ready(await pickCandidate(backend, await backend.readCommit(), planted.manifestKey, {
                owner: PEER, env: testEnv(clock, 83), foreignClear: async () => true, ...everythingPresent,
            }))
            expect((await parsedCommit(backend)).staging?.owner).toBe(PEER)

            const results = await Promise.all([installPick(first, { confirm: true }), installPick(second, { confirm: true })])
            expect(results.map(result => result.status).sort()).toEqual(['abandoned', 'installed'])
            expect(results[0].status).toBe('abandoned')
            const winner = installedOf(results[1])
            const stored = await parsedCommit(backend)
            expect(stored.current?.key).toBe(winner.manifestKey)
            expect(stored.staging).toBeNull()
            await expectInvariant(backend)
            expect((await closureOf(backend, winner.manifestKey)).problems).toEqual([])
            // The loser's staged copies and every candidate remain.
            const listing = await backend.listStore2()
            for (const key of planted.written) {
                expect(listing).toContain(key)
            }
        })

        test('the first page wins when it installs before the later page reads the marker', async () => {
            const { backend, planted, read, clock } = await twoPages()
            const first = ready(await pickCandidate(backend, read, planted.manifestKey, { owner: ME, env: testEnv(clock, 92), ...everythingPresent }))
            const winner = installedOf(await installPick(first, { confirm: true }))
            // The other page's stale read of the damaged key conflicts and finds a `current`: its exit is abandoned.
            const late = await pickCandidate(backend, read, planted.manifestKey, { owner: PEER, env: testEnv(clock, 93), foreignClear: async () => true, ...everythingPresent })
            expect(late).toMatchObject({ status: 'exit', exit: { status: 'abandoned' } })
            expect((await parsedCommit(backend)).current?.key).toBe(winner.manifestKey)
            await expectInvariant(backend)
        })
    })
})
