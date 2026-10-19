// @vitest-environment node
/**
 * The store2 protocol against the real `server/node/server.cjs` process: a live
 * run of committers, a restorer and a collection loop with lost replies and one
 * server restart, judged by an observer that checks I1 after every operation; the
 * client's refusal of a stub proxy's answers; a real 431; and the protocol against
 * earlier server builds extracted read-only from git history.
 *
 * Labels: the live run and the 431 test are new-behaviour tests against the
 * current server; the unpatched-server tests are reproducers of the refusal
 * behaviour, red against the current server (shown by a mutant outside the tree
 * that swaps the extracted build for the current script). The stub-proxy tests are
 * compatibility guards: any correct client passes them. The 429 tests on the write side are new-behaviour guards of the
 * current server and client (a 429 is answered before anything is applied, so a refused write is a definite failure);
 * their failure modes are shown by mutants of the committer and the loop, outside the tree.
 *
 * Environment: RISU_LIVE_SECONDS (default 30) sets the length of the live run (extended in short
 * slices, up to three times that length, while the collector has applied no batch),
 * RISU_LIVE_SEED its seed, RISU_LIVE_COMMITTERS (2 to 4, default 3) its writers.
 * The unpatched-server tests extract the earlier builds with `git show` into the
 * OS temp directory and are skipped, under a name that says why, when git or a
 * commit is not available.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { ServerLacksCapabilityError, StoreCheckListTooLongError, StoreOutcomeUnknownError } from 'src/ts/storage/store/errors'
import type { ByteStore } from 'src/ts/storage/store/contract'
import { createNodeHttpStore, type FetchLike } from 'src/ts/storage/store/nodeHttpStore'
import { BULK_UNIT_THRESHOLD, createNodeBackend, Store2BackendFailureError, Store2UnknownOutcomeError, type Store2Backend } from 'src/ts/storage/store2/backend'
import { createCommitter, type BuildContext } from 'src/ts/storage/store2/commit'
import { classifyCommitRead, firstCommitKey, nextCommitKey } from 'src/ts/storage/store2/commitKey'
import {
    defaultKeyEnv, encodeUnit, newManifestKey, newShardKey, newStagingId, newUnitKey, stagingPrefix, UNIT_TYPE,
    type CommitKey, type KeyEnv, type Manifest,
} from 'src/ts/storage/store2/format'
import { COMMIT_KEY, FENCE_KEY } from 'src/ts/storage/store2/format/keys'
import { gcPass } from 'src/ts/storage/store2/gc/pass'
import { freshOwnerId } from 'src/ts/storage/store2/owner'
import { startGuardedProxy, type GuardedProxy } from './nodeGuardedProxy'
import { hexOfKey, headerLimitArgs, startNodeServer, type NodeServerFixture } from './nodeServerFixture'
import {
    createObserver, extractServer, gitHistoryUnavailable, guardedKindOf, openLiveClient, RESTART_MARGIN_MS, RetireWindow, runLiveWorkload, saveDirectoryContents, Tally,
    type ExtractedServer, type Observer,
} from './nodeLiveServerFixture'
import { buildTree, treeRequest, type BuildRecord } from './store2/commitFixtures'
import { buildSmall } from './store2/codecFixtures'
import { previousFrom } from 'src/ts/storage/store2/codec'
import { runStore2SaveLoop, type Store2LoopPort } from 'src/ts/storage/store2/saveLoop'
import type { Store2SaveContext } from 'src/ts/storage/store2/saveActive'
import type { Database } from 'src/ts/storage/database.svelte'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { until } from './saveLoopWorld'
import { createPeerDouble, fakeLists, seedTree } from './store2SaveKit'

function numberFromEnv(name: string, fallback: number, min: number, max: number): number {
    const raw = process.env[name]
    if (raw === undefined) {
        return fallback
    }
    const value = Number(raw)
    if (!Number.isFinite(value) || value < min || value > max) {
        throw new Error(`${name}=${raw} is not a number from ${min} to ${max}.`)
    }
    return value
}

const LIVE_SECONDS = numberFromEnv('RISU_LIVE_SECONDS', 30, 5, 86_400)
const LIVE_SEED = numberFromEnv('RISU_LIVE_SEED', 1, 0, 1_000_000)
const LIVE_COMMITTERS = Math.floor(numberFromEnv('RISU_LIVE_COMMITTERS', 3, 2, 4))

async function caught(promise: Promise<unknown>): Promise<unknown> {
    return await promise.then(() => {
        throw new Error('The call resolved; it was expected to reject.')
    }, (error: unknown) => error)
}

function bytes(...values: number[]): Uint8Array {
    return Uint8Array.from(values)
}

// ---- the live run ----

describe('a live run of several clients against one server', () => {
    let fixture: NodeServerFixture | undefined

    afterAll(async () => {
        await fixture?.stop()
    }, 30_000)

    test('keeps I1 after every operation through lost replies and a restart, and ends clean', async () => {
        fixture = await startNodeServer()
        const report = await runLiveWorkload(fixture, { seconds: LIVE_SECONDS, seed: LIVE_SEED, committers: LIVE_COMMITTERS, restartAt: 0.5 })
        console.info(`LIVE-REPORT ${JSON.stringify({ ...report, endState: { ...report.endState, wanted: report.endState.wanted.length, listing: report.endState.listing.length, serverKeys: report.endState.serverKeys.length } })}`)

        expect(report.violations).toEqual([])
        expect(report.unexpected).toEqual([])
        expect(report.counts['server:restart']).toBe(1)

        // The faults really happened, on every kind of write the protocol makes.
        expect(report.repliesDropped['unit-write'] ?? 0).toBeGreaterThan(0)
        expect(report.repliesDropped['commit-write'] ?? 0).toBeGreaterThan(0)
        expect(report.repliesDropped['remove-checked'] ?? 0).toBeGreaterThan(0)

        // The run did protocol work and the observer judged it.
        expect(report.counts['commit:committed'] ?? 0).toBeGreaterThan(0)

        // Collection applied batches while the writers were active, not only in the writer-free phase after them. A main run whose
        // collector had applied none at the end of its length was extended (up to three times that length) before this is judged.
        expect(report.extendedMs).toBeLessThanOrEqual(LIVE_SECONDS * 1000 * 3)
        expect(report.mainCounts['gc:batches-applied'] ?? 0).toBeGreaterThan(0)
        expect(report.mainCounts['gc:keys-deleted'] ?? 0).toBeGreaterThan(0)
        expect(report.counts['observer:ok'] ?? 0).toBeGreaterThan(0)

        // A check reports an unreachable server only while the server restarts, plus a margin for a request
        // that was already in flight when it answered again.
        const restarted = report.restartWindow
        expect(restarted).not.toBeNull()
        if (restarted !== null) {
            expect(report.unavailableAt.filter((at) => at < restarted.from || at > restarted.to + RESTART_MARGIN_MS)).toEqual([])
        }

        // Partial visibility of a multi-key retire was exercised: the observer walked during a retire and a
        // sampler read a listing that held some of a batch's keys and not all of them, in the main run or in
        // the retire phase (the two counts are reported apart).
        expect(report.counts['observer:walks-during-retire'] ?? 0).toBeGreaterThan(0)
        expect((report.mainCounts['retire:partial-seen'] ?? 0) + (report.phaseCounts['retire:partial-seen'] ?? 0)).toBeGreaterThan(0)

        // The end state is quiet: no marker, no pin, the last pass found nothing to collect, and the
        // server holds exactly the commit key and the trees it names.
        const end = report.endState
        expect(end.snapshot).toBe('stable')
        expect(end.missing).toEqual([])
        expect(end.damaged).toEqual([])
        expect(end.commit.staging).toBe(false)
        expect(end.commit.pins).toBe(0)
        expect(end.lastGc).toMatchObject({ status: 'done', deleted: 0 })
        expect(end.lastGc !== null && end.lastGc.status === 'done' ? end.lastGc.stopped : 'refused').toBeUndefined()
        expect(end.listing).toEqual(end.wanted)
        expect(end.serverKeys).toEqual([COMMIT_KEY, ...end.wanted].sort())
    }, (LIVE_SECONDS * 4 + 240) * 1000)
})

// ---- the client's refusal of a stub proxy ----

describe('the client refuses a proxy that answers a guarded route with a page or a 405', () => {
    let fixture: NodeServerFixture
    let proxy: GuardedProxy

    beforeAll(async () => {
        fixture = await startNodeServer()
        proxy = await startGuardedProxy(fixture.baseUrl)
    }, 60_000)

    afterAll(async () => {
        await proxy?.stop()
        await fixture?.stop()
    }, 30_000)

    test.each([
        ['html-200', '200 without the guarded marker'],
        ['method-405', '405'],
    ] as const)('%s: every guarded call fails as a backend failure that applied nothing, and collection refuses', async (mode, observed) => {
        const env = defaultKeyEnv
        const direct = openLiveClient(fixture, 'direct', env)
        await buildSeed(direct.store, env)
        const before = await saveDirectoryContents(fixture)

        proxy.setMode(mode)
        proxy.forwarded.length = 0
        const store = createNodeHttpStore({ baseUrl: proxy.baseUrl, authHeader: () => fixture.authHeader() })
        const backend = createNodeBackend(store)
        const committer = createCommitter(backend, { owner: freshOwnerId(env), env })
        const read = await backend.readCommit()
        const orphan = newUnitKey(env)

        const lacks = (capability: 'check-only' | 'retire') => ({
            name: 'Store2BackendFailureError',
            cause: { name: 'ServerLacksCapabilityError', capability, mayHaveApplied: false },
        })
        const described = (error: unknown) => {
            expect(error).toBeInstanceOf(Store2BackendFailureError)
            const cause = error instanceof Error ? error.cause : undefined
            expect(cause).toBeInstanceOf(ServerLacksCapabilityError)
            expect(cause instanceof ServerLacksCapabilityError ? cause.observed : '').toContain(observed)
            return {
                name: (error as Error).name,
                cause: cause instanceof ServerLacksCapabilityError ? { name: cause.name, capability: cause.capability, mayHaveApplied: cause.mayHaveApplied } : null,
            }
        }
        expect(described(await caught(backend.casCommit(read.token, bytes(1))))).toEqual(lacks('check-only'))
        expect(described(await caught(backend.putUnit(orphan, bytes(1))))).toEqual(lacks('check-only'))
        expect(described(await caught(backend.commitOrdinary(read.token, [{ key: orphan, bytes: bytes(1) }], bytes(2))))).toEqual(lacks('check-only'))
        expect(described(await caught(backend.casFence((await backend.readFence()).token, bytes(3))))).toEqual(lacks('check-only'))
        expect(described(await caught(backend.removeBatch([orphan], read.token, (await backend.readFence()).token)))).toEqual(lacks('retire'))

        const committed = await committer.commit(read, treeRequest(1))
        expect(committed.status).toBe('failed')
        expect(committed.status === 'failed' ? committed.cause : null).toBeInstanceOf(Store2BackendFailureError)

        const guarded = store.guarded
        if (guarded === undefined) {
            throw new Error('The Node store offers no guarded operations.')
        }
        const collected = await gcPass({ backend, kind: 'node', idleReason: () => null, probe: () => guarded.probe() })
        expect(collected).toMatchObject({ status: 'refused', reason: 'capability-missing' })

        // No request reached the server's write or remove routes, guarded or not, and the store is unchanged.
        expect(proxy.forwarded.filter((entry) => /\/api\/(write|remove|caps)/.test(entry))).toEqual([])
        expect(await saveDirectoryContents(fixture)).toEqual(before)
    })
})

// ---- a real 431 ----

describe('a real 431 from the server\'s own header limit', () => {
    let fixture: NodeServerFixture

    afterAll(async () => {
        await fixture?.stop()
    }, 30_000)

    test('a commit whose check-only list does not fit is refused as a list-too-long failure that applied nothing', async () => {
        // A request with a few units fits; one naming sixty units does not.
        fixture = await startNodeServer({ nodeArgs: headerLimitArgs(3000) })
        const env = defaultKeyEnv
        const store = createNodeHttpStore({
            baseUrl: fixture.baseUrl,
            authHeader: () => fixture.authHeader(),
            maxCheckOnlyKeys: 1000,
            guardedHeaderBytes: 1_000_000,
        })
        const backend = createNodeBackend(store)
        const unitsOf = (count: number) => Array.from({ length: count }, () => ({ key: newUnitKey(env), bytes: bytes(7) }))

        await backend.commitOrdinary((await backend.readCommit()).token, unitsOf(3), bytes(1))
        expect((await store.read(COMMIT_KEY)).bytes).toEqual(bytes(1))

        const units = unitsOf(60)
        const error = await caught(backend.commitOrdinary((await backend.readCommit()).token, units, bytes(2)))
        // A 431 sent while the request is still being written can surface as a socket reset instead; the client
        // then reports an unknown outcome, which is safe because nothing was applied.
        if (error instanceof Store2BackendFailureError) {
            expect(error.cause).toBeInstanceOf(StoreCheckListTooLongError)
            expect(error.cause).toMatchObject({ keyCount: 60, sent: true, mayHaveApplied: false })
        } else {
            expect(error).toBeInstanceOf(Store2UnknownOutcomeError)
            expect((error as Error).cause).toBeInstanceOf(StoreOutcomeUnknownError)
        }
        console.info(`LIVE-431 ${error instanceof Error ? `${error.name} / ${error.cause instanceof Error ? error.cause.name : 'none'}` : String(error)}`)
        expect((await store.read(COMMIT_KEY)).bytes).toEqual(bytes(1))
        for (const unit of units) {
            expect((await store.read(unit.key)).bytes).toEqual(bytes(7))
        }
    }, 120_000)
})

// ---- a real 429 ----

const CURRENT_BUILD_UNAVAILABLE = gitHistoryUnavailable(['HEAD'])
const describeLimited = CURRENT_BUILD_UNAVAILABLE === null ? describe : describe.skip

// The storage routes' limiter, found by its name and not by its figure: the asset limiter beside it has the same one.
const STORAGE_LIMITER_MAX = /(const storageRouteLimiter = rateLimit\(\{[^}]*?)max: 20000,/

describeLimited(CURRENT_BUILD_UNAVAILABLE === null ? 'a real 429 from the server\'s storage limiter' : `a real 429 from the server's storage limiter (skipped: ${CURRENT_BUILD_UNAVAILABLE})`, () => {
    let extracted: ExtractedServer | undefined
    let fixture: NodeServerFixture | undefined

    afterAll(async () => {
        await fixture?.stop()
        await extracted?.dispose()
    }, 30_000)

    test('a removal or a mark read that is answered 429 past the client\'s retries stops the pass with nothing deleted, and I1 holds', async () => {
        // The current server, extracted read-only from git into a temporary directory, with the storage limiter alone refusing
        // every request that carries a test header. Nothing under `server/node/` changes.
        extracted = await extractServer('HEAD')
        const original = await readFile(extracted.script, 'utf8')
        expect(original.match(/max: 20000,/g)).toHaveLength(2)
        const patched = original.replace(STORAGE_LIMITER_MAX, '$1max: (req) => (req.headers[\'x-test-deny\'] === \'1\' ? 0 : 20000),')
        expect(patched).not.toBe(original)
        expect(patched.match(/max: 20000,/g)).toHaveLength(1)
        await writeFile(extracted.script, patched)
        const live = await startNodeServer({ serverScript: extracted.script })
        fixture = live

        const env = defaultKeyEnv
        const seeded = await buildSeed(openLiveClient(live, 'direct', env).store, env)
        const watcher = createNodeHttpStore({ baseUrl: live.baseUrl, authHeader: () => live.authHeader() })
        const observer = createObserver(watcher, new RetireWindow(), new Tally())
        await observer.check('seed')

        const deny = { removals: false, unitReads: false }
        const counts = { answered429: 0, slept: 0 }
        const topLevel = new Set([hexOfKey(COMMIT_KEY), hexOfKey(FENCE_KEY)])
        const denying: FetchLike = async (url, init) => {
            const kind = guardedKindOf(url, init)
            const headers = new Headers(init?.headers)
            const targeted = (deny.removals && kind === 'remove-checked') || (deny.unitReads && kind === 'read' && !topLevel.has(headers.get('file-path') ?? ''))
            if (targeted) {
                headers.set('x-test-deny', '1')
            }
            const response = await fetch(url, { ...init, headers })
            if (response.status === 429) {
                counts.answered429++
            }
            return response
        }
        // The client retries a 429; its wait is injected, so the five tries are spent at once and the last 429 reaches the caller.
        const store = createNodeHttpStore({
            baseUrl: live.baseUrl,
            authHeader: () => live.authHeader(),
            fetch: denying,
            sleep: async () => { counts.slept++ },
        })
        const guarded = store.guarded
        if (guarded === undefined) {
            throw new Error('The Node store offers no guarded operations.')
        }
        const backend = createNodeBackend(store)
        const pass = () => gcPass({ backend, kind: 'node', idleReason: () => null, probe: () => guarded.probe() })
        const expectI1 = async (label: string) => {
            await observer.check(label)
            expect(observer.violations).toEqual([])
            const outcome = await observer.snapshot()
            expect(outcome.status).toBe('stable')
            expect(outcome.status === 'stable' ? outcome.snapshot.missing : null).toEqual([])
        }
        const before = await saveDirectoryContents(live)
        const commitBefore = (await watcher.read(COMMIT_KEY)).bytes

        // The removal batch is refused: a definite failure, and the first batch deleted nothing.
        deny.removals = true
        const removalAnswers = counts.answered429
        const refusedRemoval = await pass()
        expect(counts.answered429 - removalAnswers).toBeGreaterThanOrEqual(5)
        expect(counts.slept).toBeGreaterThanOrEqual(4)
        expect(refusedRemoval).toEqual({ status: 'done', deleted: 0, batches: 0, stopped: 'backend-failure' })
        expect((await watcher.read(COMMIT_KEY)).bytes).toEqual(commitBefore)
        expect(await saveDirectoryContents(live)).toEqual(before)
        await expectI1('after the refused removal')

        // The mark's unit reads are refused: the pass is refused before any batch.
        deny.removals = false
        deny.unitReads = true
        const readAnswers = counts.answered429
        const refusedMark = await pass()
        expect(counts.answered429 - readAnswers).toBeGreaterThanOrEqual(5)
        expect(refusedMark).toMatchObject({ status: 'refused', reason: 'mark-refused' })
        expect((await watcher.read(COMMIT_KEY)).bytes).toEqual(commitBefore)
        expect(await saveDirectoryContents(live)).toEqual(before)
        await expectI1('after the refused mark')

        // Control: the same client and server, nothing refused, collect exactly the two orphans.
        deny.unitReads = false
        expect(await pass()).toEqual({ status: 'done', deleted: seeded.orphans.length, batches: 1 })
        for (const key of seeded.orphans) {
            expect((await watcher.read(key)).bytes).toBeNull()
        }
        await expectI1('after the control pass')
    }, 120_000)
})

// ---- a real 429 on the write side ----

describeLimited(CURRENT_BUILD_UNAVAILABLE === null ? 'a real 429 on the write side: unit writes and commit-key writes' : `a real 429 on the write side (skipped: ${CURRENT_BUILD_UNAVAILABLE})`, () => {
    // Every test opens its own server; each is stopped and its extracted copy removed after that test, so none outlives it.
    const opened: { extracted: ExtractedServer, fixture: NodeServerFixture | undefined }[] = []

    afterEach(async () => {
        for (const entry of opened.splice(0)) {
            await entry.fixture?.stop()
            await entry.extracted.dispose()
        }
    }, 30_000)

    /** The current server with the storage limiter refusing requests that carry the test header, a seeded store and a committer whose client sends it for the kinds `deny` names. */
    async function openLimited(database?: Database) {
        const extracted = await extractServer('HEAD')
        const entry: { extracted: ExtractedServer, fixture: NodeServerFixture | undefined } = { extracted, fixture: undefined }
        opened.push(entry)
        const original = await readFile(extracted.script, 'utf8')
        expect(original.match(/max: 20000,/g)).toHaveLength(2)
        const patched = original.replace(STORAGE_LIMITER_MAX, '$1max: (req) => (req.headers[\'x-test-deny\'] === \'1\' ? 0 : 20000),')
        expect(patched).not.toBe(original)
        expect(patched.match(/max: 20000,/g)).toHaveLength(1)
        await writeFile(extracted.script, patched)
        const live = await startNodeServer({ serverScript: extracted.script })
        entry.fixture = live

        const env = defaultKeyEnv
        const direct = openLiveClient(live, 'direct', env)
        // A database seeds the tree of the page's own save loop; without one, two plain trees and two orphans.
        const seededTree = database === undefined ? undefined : await seedTree(direct.backend, database, env, fakeLists)
        const seeded = seededTree === undefined ? await buildSeed(direct.store, env) : undefined
        const watcher = createNodeHttpStore({ baseUrl: live.baseUrl, authHeader: () => live.authHeader() })
        const observer = createObserver(watcher, new RetireWindow(), new Tally())
        await observer.check('seed')

        // `kinds` are refused from the start; `afterFirstCommitWrite` lets one commit-key write through and refuses every later one.
        const deny = { kinds: new Set<string>(), afterFirstCommitWrite: false, commitWritesLanded: 0 }
        const counts = { answered429: 0, slept: 0 }
        const denying: FetchLike = async (url, init) => {
            const kind = guardedKindOf(url, init)
            const headers = new Headers(init?.headers)
            if (deny.kinds.has(kind) || (deny.afterFirstCommitWrite && kind === 'commit-write' && deny.commitWritesLanded >= 1)) {
                headers.set('x-test-deny', '1')
            }
            const response = await fetch(url, { ...init, headers })
            if (response.status === 429) {
                counts.answered429++
            } else if (kind === 'commit-write' && response.ok) {
                deny.commitWritesLanded++
            }
            return response
        }
        // The client retries a 429; its wait is injected, so the tries are spent at once and the last 429 reaches the caller.
        const store = createNodeHttpStore({ baseUrl: live.baseUrl, authHeader: () => live.authHeader(), fetch: denying, sleep: async () => { counts.slept++ } })
        const backend = createNodeBackend(store)
        const owner = freshOwnerId(env)
        const committer = createCommitter(backend, { owner, env })
        const expectI1 = async (label: string) => {
            await observer.check(label)
            expect(observer.violations).toEqual([])
            const outcome = await observer.snapshot()
            expect(outcome.status).toBe('stable')
            expect(outcome.status === 'stable' ? outcome.snapshot.missing : null).toEqual([])
        }
        return { live, seeded, seededTree, watcher, deny, counts, committer, owner, env, expectI1 }
    }

    // New behaviour against the current server: a write answered 429 past the client's tries is a definite failure (`NOTHING_APPLIED_STATUSES`),
    // so the commit reports `failed`, the commit key is byte-identical, and the next pass after the limiter lifts commits.
    test('a unit write or a commit-key write answered 429 past the client\'s tries leaves the commit key unchanged, I1 holds, and the next pass commits', async () => {
        const { watcher, deny, counts, committer, expectI1 } = await openLimited()
        const commitBefore = (await watcher.read(COMMIT_KEY)).bytes
        const tryCommit = async (extra: number, tag: string) => await committer.commit(await committer.readCommit(), treeRequest(extra, { tag }))

        // An ordinary commit whose unit uploads are refused.
        deny.kinds = new Set(['unit-write'])
        let answers = counts.answered429
        const refusedUnits = await tryCommit(0, 'u')
        expect(counts.answered429 - answers).toBeGreaterThanOrEqual(5)
        expect(refusedUnits.status).toBe('failed')
        expect((await watcher.read(COMMIT_KEY)).bytes).toEqual(commitBefore)
        await expectI1('after the refused unit write')

        // An ordinary commit whose commit-key write is refused.
        deny.kinds = new Set(['commit-write'])
        answers = counts.answered429
        const refusedCommit = await tryCommit(0, 'c')
        expect(counts.answered429 - answers).toBeGreaterThanOrEqual(5)
        expect(refusedCommit.status).toBe('failed')
        expect((await watcher.read(COMMIT_KEY)).bytes).toEqual(commitBefore)
        await expectI1('after the refused commit-key write')

        // A bulk commit whose marker write is refused: nothing is staged and no marker stands.
        answers = counts.answered429
        const refusedMarker = await tryCommit(BULK_UNIT_THRESHOLD - 8, 'b')
        expect(counts.answered429 - answers).toBeGreaterThanOrEqual(5)
        expect(refusedMarker.status).toBe('failed')
        expect((await watcher.read(COMMIT_KEY)).bytes).toEqual(commitBefore)
        await expectI1('after the refused marker write')

        // The limiter lifts: the next pass commits, ordinary and bulk.
        deny.kinds = new Set()
        const ordinary = await tryCommit(0, 'ok-ordinary')
        expect(ordinary.status).toBe('committed')
        await expectI1('after the ordinary commit')
        const bulk = await tryCommit(BULK_UNIT_THRESHOLD - 8, 'ok-bulk')
        expect(bulk).toMatchObject({ status: 'committed', mode: 'bulk' })
        const landed = classifyCommitRead(await watcher.read(COMMIT_KEY))
        expect(landed.status === 'parsed' ? [landed.value.current?.key, landed.value.staging] : landed.status).toEqual([bulk.status === 'committed' ? bulk.manifestKey : null, null])
        await expectI1('after the bulk commit')
        expect(counts.slept).toBeGreaterThanOrEqual(12)
    }, 120_000)

    // New behaviour: a bulk commit whose marker landed and whose later commit-key writes are refused leaves its marker standing
    // (the clear is refused too); the marker is its own owner's, a peer's bulk commit is refused while it stands, and the owner clears it
    // once the limiter lifts. A bulk commit whose unit uploads are refused clears its own marker in the same call.
    test('a bulk marker left by refused commit-key writes is the owner\'s to clear; refused unit uploads clear it at once', async () => {
        const { live, watcher, deny, counts, committer, owner, expectI1 } = await openLimited()
        const commitBefore = (await watcher.read(COMMIT_KEY)).bytes
        const bulkRequest = (tag: string) => treeRequest(BULK_UNIT_THRESHOLD - 8, { tag })

        // The marker lands, then the final write and the clear are both refused.
        deny.afterFirstCommitWrite = true
        const answers = counts.answered429
        const stranded = await committer.commit(await committer.readCommit(), bulkRequest('stranded'))
        expect(counts.answered429 - answers).toBeGreaterThanOrEqual(10)
        expect(stranded).toMatchObject({ status: 'abandoned', reason: 'upload-failed', cleared: { status: 'failed' } })
        const standing = classifyCommitRead(await watcher.read(COMMIT_KEY))
        expect(standing.status).toBe('parsed')
        const marker = standing.status === 'parsed' ? standing.value.staging : null
        expect(marker?.owner).toBe(owner)
        await expectI1('with the marker standing')

        // The limiter lifts. Another owner's bulk commit is refused by the standing marker; the owner clears its own.
        deny.afterFirstCommitWrite = false
        const peer = createCommitter(createNodeBackend(createNodeHttpStore({ baseUrl: live.baseUrl, authHeader: () => live.authHeader() })), { owner: freshOwnerId(defaultKeyEnv), env: defaultKeyEnv })
        const refused = await peer.commit(await peer.readCommit(), bulkRequest('peer'))
        expect(refused).toMatchObject({ status: 'refused', reason: 'marker-present' })
        const cleared = await committer.abandonClear(await committer.readCommit(), owner, marker?.prefix ?? '')
        expect(cleared.status).toBe('cleared')
        const after = classifyCommitRead(await watcher.read(COMMIT_KEY))
        const first = classifyCommitRead({ bytes: commitBefore })
        expect(after.status === 'parsed' && first.status === 'parsed' ? [after.value.staging, after.value.current?.key] : 'unparsed').toEqual([null, first.status === 'parsed' ? first.value.current?.key : 'unparsed'])
        await expectI1('after the owner\'s clear')

        // The marker landed and every unit upload is refused: the bulk commit clears its own marker before it returns.
        deny.kinds = new Set(['unit-write'])
        const selfCleared = await committer.commit(await committer.readCommit(), bulkRequest('self-cleared'))
        expect(selfCleared).toMatchObject({ status: 'abandoned', reason: 'upload-failed', cleared: { status: 'cleared' } })
        const clean = classifyCommitRead(await watcher.read(COMMIT_KEY))
        expect(clean.status === 'parsed' ? clean.value.staging : clean.status).toBeNull()
        await expectI1('after the self-cleared bulk')

        // And the next pass commits.
        deny.kinds = new Set()
        const next = await committer.commit(await committer.readCommit(), bulkRequest('next'))
        expect(next).toMatchObject({ status: 'committed', mode: 'bulk' })
        await expectI1('after the next bulk commit')
    }, 120_000)

    // New behaviour against the current server: the page's own save loop, over the live Node backend, reports the refused write as a
    // failed save, keeps the edit, retries while the limiter refuses, and commits it once the limiter lifts.
    test('the save loop reports a save whose commit-key write is answered 429, retries it, and commits the edit once the limiter lifts', async () => {
        const database = JSON.parse(JSON.stringify(buildSmall(3))) as Database
        const { watcher, deny, counts, committer, env, seededTree, expectI1 } = await openLimited(database)
        if (seededTree === undefined) {
            throw new Error('The database was not seeded.')
        }
        const previous = previousFrom(seededTree.tree)
        const live = JSON.parse(JSON.stringify(database)) as Database
        const state = { due: false, dirty: false, saved: 0, stopped: false }
        const failures: Array<{ error: unknown, attempts: number }> = []
        const crashed: unknown[] = []
        const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
        const reloadFlag = { state: false }
        let tail: Promise<void> = Promise.resolve()
        const idle = () => new Promise<void>((resolve) => { if (!state.stopped) { setTimeout(resolve, 2) } })
        const port: Store2LoopPort = {
            tracker,
            reloadFlag,
            getDatabase: () => live,
            mergeBack(target, snapshot) {
                for (const chaId of snapshot.character) {
                    if (!target.character.includes(chaId)) {
                        target.character.push(chaId)
                    }
                }
            },
            liveCheck: () => {},
            sweep: () => {},
            isDue: () => state.due,
            isDirty: () => state.dirty,
            hasDrafts: () => false,
            beginIteration() { state.due = false },
            endIteration() {},
            snapshotTaken() { state.dirty = false },
            requestPass() { state.dirty = true; state.due = true },
            saved() { state.saved += 1 },
            broadcast() {},
            peerHeard: () => false,
            setStopped() {},
            reportFailure(error, attempts) {
                failures.push({ error, attempts })
                return 1
            },
            async withWriteLock(run) {
                const before = tail
                let release: () => void = () => {}
                tail = new Promise<void>((resolve) => { release = resolve })
                await before
                try {
                    return await run()
                } finally {
                    release()
                }
            },
            wait: idle,
            sleep: () => idle(),
            sleepForever: () => new Promise<never>(() => {}),
            now: () => Date.now(),
        }
        const context: Store2SaveContext = { session: { kind: 'node', committer }, previous, lists: fakeLists, env, peer: createPeerDouble(), idleNet: null }
        const running = runStore2SaveLoop(context, port).catch((error: unknown) => { crashed.push(error) })
        try {
            const commitBefore = (await watcher.read(COMMIT_KEY)).bytes
            const answers = counts.answered429

            // One edit, saved while every commit-key write is refused.
            deny.kinds = new Set(['commit-write'])
            ;(live.characters[0] as unknown as { name: string }).name = 'edited under a 429'
            tracker.character.push(String((live.characters[0] as unknown as { chaId: string }).chaId))
            state.dirty = true
            state.due = true
            await until(() => failures.length >= 2, 'two reported failures', 20_000)
            expect(state.saved).toBe(0)
            expect(counts.answered429 - answers).toBeGreaterThanOrEqual(5)
            expect(failures[0].error).toBeInstanceOf(Store2BackendFailureError)
            expect(failures[1].attempts).toBeGreaterThan(failures[0].attempts)
            expect((await watcher.read(COMMIT_KEY)).bytes).toEqual(commitBefore)
            await expectI1('while the save loop is refused')

            // The limiter lifts: the next pass commits the same edit.
            deny.kinds = new Set()
            await until(() => state.saved >= 1, 'a saved pass', 20_000)
            expect((await watcher.read(COMMIT_KEY)).bytes).not.toEqual(commitBefore)
            const stored = classifyCommitRead(await watcher.read(COMMIT_KEY))
            expect(stored.status === 'parsed' ? stored.value.staging : stored.status).toBeNull()
            await expectI1('after the save loop committed')
            expect(crashed).toEqual([])
        } finally {
            state.stopped = true
            void running
        }
    }, 120_000)
})

// ---- earlier server builds ----

interface SeededStore {
    a: { manifest: string, at: number }
    b: { manifest: string, at: number }
    commit: CommitKey
    orphans: string[]
}

/** Writes two complete trees, a commit key naming one as current and one as retained, and two orphan units, through plain writes. */
async function buildSeed(store: ByteStore, env: KeyEnv): Promise<SeededStore> {
    const context = (seq: number): BuildContext => ({
        mint: { shard: () => newShardKey(env), unit: () => newUnitKey(env), manifest: () => newManifestKey(env) },
        seq,
        now: env.now(),
    })
    const trees: { manifest: string, at: number, body: Manifest }[] = []
    for (const [index, tag] of ['a', 'b'].entries()) {
        const record: BuildRecord[] = []
        const built = buildTree(0, context(index + 1), tag, record)
        for (const unit of [...built.units, { key: built.manifest.key, bytes: encodeUnit(UNIT_TYPE.manifest, built.manifest.body) }]) {
            await store.write(unit.key, unit.bytes, 'unconditional')
        }
        trees.push({ manifest: built.manifest.key, at: env.now(), body: built.manifest.body })
    }
    const [a, b] = trees
    const first = firstCommitKey({ current: { key: a.manifest, at: a.at }, staging: null, manifests: [a.body] }, env)
    const commit = nextCommitKey(first, { current: { key: b.manifest, at: b.at }, retained: [{ key: a.manifest, at: a.at }], manifests: [b.body] }, env)
    await store.write(COMMIT_KEY, encodeUnit(UNIT_TYPE.commit, commit), 'unconditional')
    const orphans = [newUnitKey(env), newUnitKey(env)]
    for (const key of orphans) {
        await store.write(key, encodeUnit(UNIT_TYPE.preset, { v: 1, tag: 'orphan' }), 'unconditional')
    }
    return { a: { manifest: a.manifest, at: a.at }, b: { manifest: b.manifest, at: b.at }, commit, orphans }
}

const OLD_HASHES = ['1b881d0cd', 'ebe3c77a9', 'cafca63a4'] as const
const HISTORY_UNAVAILABLE = gitHistoryUnavailable(OLD_HASHES)
const describeOld = HISTORY_UNAVAILABLE === null ? describe : describe.skip

describeOld(HISTORY_UNAVAILABLE === null ? 'the protocol against earlier server builds' : `the protocol against earlier server builds (skipped: ${HISTORY_UNAVAILABLE})`, () => {
    interface Rig {
        extracted: ExtractedServer
        fixture: NodeServerFixture
        store: ByteStore
        backend: Store2Backend
        observer: Observer
        env: KeyEnv
        seed: SeededStore
        sent: string[]
    }

    async function startRig(hash: string): Promise<Rig> {
        const extracted = await extractServer(hash)
        let fixture: NodeServerFixture | undefined
        try {
            fixture = await startNodeServer({ serverScript: extracted.script })
            const sent: string[] = []
            const fetching: FetchLike = (url, init) => {
                sent.push(`${init?.method ?? 'GET'} ${new URL(url).pathname}`)
                return fetch(url, init)
            }
            const live = fixture
            const store = createNodeHttpStore({ baseUrl: live.baseUrl, authHeader: () => live.authHeader(), fetch: fetching })
            const env = defaultKeyEnv
            const seed = await buildSeed(store, env)
            const observer = createObserver(createNodeHttpStore({ baseUrl: live.baseUrl, authHeader: () => live.authHeader() }), new RetireWindow(), new Tally())
            await observer.check('seed')
            sent.length = 0
            return { extracted, fixture: live, store, backend: createNodeBackend(store), observer, env, seed, sent }
        } catch (error) {
            await fixture?.stop()
            await extracted.dispose()
            throw error
        }
    }

    async function stopRig(rig: Rig | undefined): Promise<void> {
        await rig?.fixture.stop()
        await rig?.extracted.dispose()
    }

    async function expectI1(rig: Rig, label: string): Promise<void> {
        await rig.observer.check(label)
        expect(rig.observer.violations).toEqual([])
        const outcome = await rig.observer.snapshot()
        expect(outcome.status).toBe('stable')
        expect(outcome.status === 'stable' ? outcome.snapshot.missing : null).toEqual([])
    }

    describe('1b881d0cd, before any guarded route', () => {
        let rig: Rig | undefined

        beforeAll(async () => {
            rig = await startRig('1b881d0cd')
        }, 120_000)

        afterAll(async () => {
            await stopRig(rig)
        }, 30_000)

        test('guarded writes fail as backend failures, collection refuses for a missing capability, and the store is byte-for-byte unchanged', async () => {
            const live = rig as Rig
            const before = await saveDirectoryContents(live.fixture)
            const { backend, env } = live
            const read = await backend.readCommit()
            const fence = await backend.readFence()
            const orphan = newUnitKey(env)

            const failures = [
                await caught(backend.casCommit(read.token, bytes(1))),
                await caught(backend.putUnit(orphan, bytes(1))),
                await caught(backend.commitOrdinary(read.token, [{ key: orphan, bytes: bytes(1) }], bytes(2))),
                await caught(backend.casFence(fence.token, bytes(3))),
                await caught(backend.removeBatch(live.seed.orphans, read.token, fence.token)),
            ]
            for (const error of failures) {
                expect(error).toBeInstanceOf(Store2BackendFailureError)
                expect((error as Error).cause).toBeInstanceOf(ServerLacksCapabilityError)
                expect((error as Error).cause).toMatchObject({ observed: '404', mayHaveApplied: false })
            }

            const committer = createCommitter(backend, { owner: freshOwnerId(env), env })
            const committed = await committer.commit(read, treeRequest(1))
            expect(committed.status).toBe('failed')
            const pinned = await committer.pin(read, live.seed.b.manifest, 'x')
            expect(pinned.status).toBe('failed')

            const guarded = live.store.guarded
            if (guarded === undefined) {
                throw new Error('The Node store offers no guarded operations.')
            }
            const collected = await gcPass({ backend, kind: 'node', idleReason: () => null, probe: () => guarded.probe() })
            expect(collected).toMatchObject({ status: 'refused', reason: 'capability-missing' })

            // Nothing fell back to the original write or remove routes, and nothing changed.
            expect(live.sent.filter((entry) => entry === 'POST /api/write' || (entry.startsWith('GET /api/remove') && !entry.includes('-checked')))).toEqual([])
            expect(await saveDirectoryContents(live.fixture)).toEqual(before)
            await expectI1(live, 'after the refusals')
        }, 120_000)
    })

    // The two intermediates send the guarded marker without the own-condition echo, so the client cannot tell an
    // applied request from a refused one while the server applies it. They differ in the retire scope: the earlier
    // one retires only `alite/` keys and refuses a `store2/` retire before applying anything.
    describe.each([
        ['ebe3c77a9', 'Store2BackendFailureError'],
        ['cafca63a4', 'Store2UnknownOutcomeError'],
    ] as const)('%s, guarded marker without the own-condition echo', (hash, retireError) => {
        let rig: Rig | undefined
        const live = () => rig as Rig

        beforeAll(async () => {
            rig = await startRig(hash)
        }, 120_000)

        afterAll(async () => {
            await stopRig(rig)
        }, 30_000)

        const currentCommit = async (): Promise<Uint8Array | null> => (await live().store.read(COMMIT_KEY)).bytes

        test('backend level: every guarded call that can have applied raises an unknown outcome, and the server applied it', async () => {
            const { backend, store, env, seed } = live()

            const pinned = nextCommitKey(seed.commit, { pins: [{ key: seed.a.manifest, reason: 'x' }] }, env)
            const pinnedBytes = encodeUnit(UNIT_TYPE.commit, pinned)
            expect(await caught(backend.casCommit((await backend.readCommit()).token, pinnedBytes))).toBeInstanceOf(Store2UnknownOutcomeError)
            expect(await currentCommit()).toEqual(pinnedBytes)
            await expectI1(live(), 'after casCommit')

            const unit = newUnitKey(env)
            expect(await caught(backend.putUnit(unit, bytes(5)))).toBeInstanceOf(Store2UnknownOutcomeError)
            expect((await store.read(unit)).bytes).toEqual(bytes(5))

            // The upload is the first request of an ordinary commit: it raises before the commit key is written.
            const second = newUnitKey(env)
            expect(await caught(backend.commitOrdinary((await backend.readCommit()).token, [{ key: second, bytes: bytes(6) }], bytes(9)))).toBeInstanceOf(Store2UnknownOutcomeError)
            expect((await store.read(second)).bytes).toEqual(bytes(6))
            expect(await currentCommit()).toEqual(pinnedBytes)

            expect(await caught(backend.casFence((await backend.readFence()).token, bytes(1, 2, 3)))).toBeInstanceOf(Store2UnknownOutcomeError)
            expect((await store.read(FENCE_KEY)).bytes).toEqual(bytes(1, 2, 3))
            expect(await caught(backend.casFence((await backend.readFence()).token, null))).toBeInstanceOf(Store2UnknownOutcomeError)
            expect((await store.read(FENCE_KEY)).bytes).toBeNull()

            const commitToken = (await backend.readCommit()).token
            const fenceToken = (await backend.readFence()).token
            const removal = await caught(backend.removeBatch([seed.orphans[0]], commitToken, fenceToken))
            expect((removal as Error).name).toBe(retireError)
            // The earlier build refuses a retire outside its prefix before it applies anything; the later one applies it.
            expect((await store.read(seed.orphans[0])).bytes !== null).toBe(hash === 'ebe3c77a9')
            await expectI1(live(), 'after the backend level')
        }, 120_000)

        test('committer level: an applied commit-key write with no unit returns committed after the read-back, and an ordinary commit does not', async () => {
            const { backend, store, env, seed } = live()
            const committer = createCommitter(backend, { owner: freshOwnerId(env), env })
            const rawEquals = async (written: Uint8Array) => expect(await currentCommit()).toEqual(written)

            const unpinned = await committer.unpin(await committer.readCommit(), seed.a.manifest)
            expect(unpinned.status).toBe('committed')
            await rawEquals((unpinned as { bytes: Uint8Array }).bytes)

            const pinned = await committer.pin(await committer.readCommit(), seed.a.manifest, 'again')
            expect(pinned.status).toBe('committed')
            await rawEquals((pinned as { bytes: Uint8Array }).bytes)

            const restored = await committer.restore(await committer.readCommit(), seed.a.manifest)
            expect(restored.status).toBe('committed')
            await rawEquals((restored as { bytes: Uint8Array }).bytes)

            // A standing marker of this committer's own is cleared through the same read-back.
            const parsed = classifyCommitRead({ bytes: await currentCommit() })
            if (parsed.status !== 'parsed') {
                throw new Error(`The commit key is ${parsed.status}.`)
            }
            const marker = { owner: committer.owner, prefix: stagingPrefix(newStagingId(env)), startedAt: env.now(), label: 'bulk' as const }
            await store.write(COMMIT_KEY, encodeUnit(UNIT_TYPE.commit, nextCommitKey(parsed.value, { staging: marker }, env)), 'unconditional')
            const cleared = await committer.clearMarker(await committer.readCommit())
            expect(cleared.decision.decision).toBe('clear')
            expect(cleared.cleared?.status).toBe('cleared')
            await rawEquals((cleared.cleared as { bytes: Uint8Array }).bytes)

            // An ordinary commit uploads units first: the unknown outcome of the first upload reads the commit key
            // back, finds it unchanged, and reports a conflict, never a commit.
            const before = await currentCommit()
            const ordinary = await committer.commit(await committer.readCommit(), treeRequest(1))
            expect(ordinary.status).toBe('conflict')
            expect(await currentCommit()).toEqual(before)
            await expectI1(live(), 'after the committer level')
        }, 120_000)

        test('collection level: the pass ends without retrying, and holds I1', async () => {
            const { backend, store, observer } = live()
            const guarded = store.guarded
            if (guarded === undefined) {
                throw new Error('The Node store offers no guarded operations.')
            }
            const result = await gcPass({ backend, kind: 'node', idleReason: () => null, probe: () => guarded.probe() })
            if (hash === 'cafca63a4') {
                expect(result).toMatchObject({ status: 'done', deleted: 0, batches: 0, stopped: 'unknown-outcome', commitMoved: false })
            } else {
                expect(result).toMatchObject({ status: 'done', deleted: 0, batches: 0, stopped: 'backend-failure' })
            }
            // The later build applied the batch the client could not confirm; the earlier one refused it.
            const snapshot = await observer.snapshot()
            if (snapshot.status !== 'stable') {
                throw new Error(`The snapshot is ${snapshot.status}.`)
            }
            const garbage = [...snapshot.snapshot.listing].filter((key) => !snapshot.snapshot.wanted.has(key))
            expect(garbage.length === 0).toBe(hash === 'cafca63a4')
            await expectI1(live(), 'after the collection level')
        }, 120_000)
    })
})
