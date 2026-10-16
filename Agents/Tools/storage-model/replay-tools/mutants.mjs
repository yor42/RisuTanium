// In-memory mutant definitions of the store2 replay tooling, flattened from the step 2f chain (f5a ... f7a, l7, l7m, f7c) and
// deduplicated by name; a later definition replaced an earlier one of the same name, and only the final form is kept here.
// Each edit is { file, from, to } with `from` matching exactly once in the file as the runner reads it (CRLF read as LF), or
// { file, whole: true, to } to replace the file. A mutant is never written to the repository. `// source:` names the original file.
//
// Dropped as stale at the flattening (their match text no longer exists at the merged code, or a re-targeted form replaces them):
// g5rLabelPicked and g5rR14PickPlanted (diagnostic regions.ts edits), the f5s/f5t forms of g5sNoInstCheck, the f5a form of
// recoveryFreshRead and the g5b form of noRestartExemption (replaced by restartExemptionReadded).
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = (process.env.RISU_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')).replace(/\\/g, '/')

const S = 'src/ts/storage/store2/'
const REPLAY = 'src/ts/storage/tests/store2/replay/'
const CHECKER = REPLAY + 'checker.ts'
const ACTORS = REPLAY + 'actors.ts'
const SCHEDULER = REPLAY + 'scheduler.ts'
const TAURI = S + 'backend/tauri.ts'
const PASS = S + 'gc/pass.ts'
const BOOT = S + 'boot.ts'
const IDB = S + 'backend/indexedDb.ts'
const FAKE = REPLAY + 'tauriSemanticStore.ts'
const LIVE_FIXTURE = 'src/ts/storage/tests/nodeLiveServerFixture.ts'

const BULK = [{ file: S + 'commit.ts', from: 'if (written.flushed === false) {', to: 'if (false) {' }]
const INSTALL = [{ file: S + 'recoveryPick.ts', from: 'if (written.flushed === false) {', to: 'if (false) {' }]
const REMOVE_COMMIT_COMPARE = { file: IDB, from: 'if (!tokenMatches(expectedCommit, commit.bytes)) {', to: 'if (false) {' }
const REMOVE_FENCE_COMPARE = { file: IDB, from: 'if (!tokenMatches(expectedFence, fenceBytes)) {', to: 'if (false) {' }
const WRITE_CLAUSE = { file: CHECKER, from: '.some((bytes) => parsedCommitOf(bytes)?.current?.key === manifestKey)', to: '.some((bytes) => sameBytes(bytes, resultBytes))' }
const RESULT_CLAUSE = { file: CHECKER, from: 'if (parsedCommitOf(resultBytes)?.current?.key !== manifestKey) {', to: 'if (false) {' }
const IDENTITY = { file: SCHEDULER, from: 'const j = Math.floor(rng() * (i + 1))', to: 'const j = i' }

// The re-targeted driver check: the call carries the install result's bytes.
const NO_INST_CHECK = [{
    file: ACTORS,
    from: 'checker.installed(id, result.manifestKey, result.bytes)',
    to: 'void result.manifestKey',
}]

export const MUTANTS = {
    none: [], // source: f5a-mutants.mjs

    // ---- controls (source: f5a-mutants.mjs) ----
    // c1: the batch of a collection pass no longer carries the commit-key check.
    c1: [{
        file: S + 'backend/node.ts',
        from: '[{ key: COMMIT_KEY, version: commitToken.revision }, { key: FENCE_KEY, version: fenceToken.revision }],',
        to: '[{ key: FENCE_KEY, version: fenceToken.revision }],',
    }],
    // c2: the commit write no longer carries the check-only of the units it uploaded.
    c2: [{
        file: S + 'backend/node.ts',
        from: '{ ifVersion: expected.revision }, checkOnly)',
        to: '{ ifVersion: expected.revision }, [])',
    }],
    // c4: a collection pass lists the units under a standing marker as candidates (the marker no longer protects the bulk).
    c4: [{
        file: PASS,
        from: ' && (standing === null || !key.startsWith(standing)))',
        to: ')',
    }],
    // c5: the commit write compares at a fresh read of the commit key instead of the version the value was built from.
    c5: [{
        file: S + 'backend/node.ts',
        from: '{ ifVersion: expected.revision }, checkOnly)',
        to: '{ ifVersion: revisionTokenOf((await readKey(COMMIT_KEY)).token).revision }, checkOnly)',
    }],
    // offNodeNoMutex: the Tauri backend's compare-then-write runs with no serialisation.
    offNodeNoMutex: [{
        file: TAURI,
        from: 'async function underMutex<T>(store: ByteStore, run: () => Promise<T>): Promise<T> {',
        to: 'async function underMutex<T>(store: ByteStore, run: () => Promise<T>): Promise<T> {\n    if (store !== null) { return run() }',
    }],

    // ---- part (v) (source: f5a-mutants.mjs) ----
    // The batch no longer carries the fence check ("the fence is checked only at the start of the pass").
    gcFenceAtStartOnly: [{
        file: S + 'backend/node.ts',
        from: '[{ key: COMMIT_KEY, version: commitToken.revision }, { key: FENCE_KEY, version: fenceToken.revision }],',
        to: '[{ key: COMMIT_KEY, version: commitToken.revision }],',
    }],
    // The recovery exit lists the store before it reads the fence (V1's N2 order).
    listBeforeFenceRead: [
        {
            file: S + 'fence.ts',
            from: '        let read: Store2Read\n        try {\n            read = await backend.readFence()',
            to: '        const earlyListing = await backend.listStore2()\n        let read: Store2Read\n        try {\n            read = await backend.readFence()',
        },
        {
            file: S + 'fence.ts',
            from: 'listing = await backend.listStore2()',
            to: 'listing = earlyListing',
        },
    ],
    // The recovery marker is written at a fresh read of the commit key instead of the read the exit judged.
    markerFreshToken: [{
        file: S + 'recovery.ts',
        from: 'flushed = (await backend.casCommit(commitRead.token, markerBytes)).flushed',
        to: 'flushed = (await backend.casCommit((await backend.readCommit()).token, markerBytes)).flushed',
    }],
    // A deleter's gate lets a pass start over a fence it cannot understand.
    gateIgnoresBlockedFence: [{
        file: BOOT,
        from: "if (fence.state === 'blocked') {",
        to: 'if (false) {',
    }],

    // ---- the foreign-clear hook (source: f5a-mutants.mjs) ----
    // decideClear clears a foreign marker when the hook says no.
    decideClearOnNo: [{
        file: S + 'owner.ts',
        from: 'if (hook !== null && await hook(staging)) {',
        to: 'if (hook !== null && (await hook(staging) || true)) {',
    }],

    // Harness probe, not a mutant: a patch of a module the replay never loads must be reported as not loaded (exit 97,
    // `l7-NOT-LOADED`), never as a green run. source: f5a-mutants.mjs
    neverLoaded: [{
        file: S + 'sweep/limit.ts',
        from: 'export',
        to: 'export',
    }],

    // ---- driver side (source: f5a-mutants.mjs) ----
    // runExit passes no highest seq read (the 2f-2b value).
    exitSeqZero: [{
        file: ACTORS,
        from: 'highestSeqRead: coreOf().highestSeq }',
        to: 'highestSeqRead: 0 }',
    }],

    // ---- part (ii): the library's reaction to the model's 409/404 categories (source: f5a-mutants.mjs) ----
    // c409-03: a commit whose write found the commit key moved writes again at the version the conflict reported (a rebuild on the peer's index).
    commitRetryOnPeerIndex: [{
        file: S + 'commit.ts',
        from: "        const result = await settle(next, nextBytes, () => backend.commitOrdinary(base.read.token, [...built.units, manifestUnit], nextBytes))\n        return result.status === 'committed'",
        to: "        let result = await settle(next, nextBytes, () => backend.commitOrdinary(base.read.token, [...built.units, manifestUnit], nextBytes))\n        if (result.status === 'conflict') {\n            result = await settle(next, nextBytes, () => backend.casCommit(result.current.token, nextBytes))\n        }\n        return result.status === 'committed'",
    }],
    // c409-04 and surprise 6: a second attempt of a commit mints the keys of the first attempt again instead of fresh ones.
    commitReusesUnitKeys: [
        {
            file: S + 'commit.ts',
            from: 'export interface Committer {',
            to: 'const f5aKept = new WeakMap<object, string[]>()\n\nexport interface Committer {',
        },
        {
            file: S + 'commit.ts',
            from: '        const { mint, issued } = createMint(null)\n        const now = env.now()',
            to: "        const made = createMint(null)\n        const issued = made.issued\n        const kept = f5aKept.get(env) ?? []\n        f5aKept.set(env, kept)\n        let used = 0\n        const reuse = (make: () => string): string => {\n            const key = kept[used] ?? make()\n            kept[used] = key\n            used++\n            issued.add(key)\n            return key\n        }\n        const mint = { shard: () => reuse(made.mint.shard), unit: () => reuse(made.mint.unit), manifest: () => reuse(made.mint.manifest) }\n        const now = env.now()",
        },
    ],
    // c409-07: the abandon-clear writes back the key of its first read at the token of a later read (a stale `current`).
    abandonClearStaleBase: [
        {
            file: S + 'commit.ts',
            from: '        let current = read\n        for (let round = 0; round < REJUDGE_ATTEMPTS; round++) {\n            const parsed = baseOf(current, { needCurrent: false })',
            to: '        let current = read\n        const f5aFirst = baseOf(read, { needCurrent: false })\n        for (let round = 0; round < REJUDGE_ATTEMPTS; round++) {\n            const parsed = baseOf(current, { needCurrent: false })',
        },
        {
            file: S + 'commit.ts',
            from: 'const next = nextCommitKey(parsed.base.key, { staging: null }, env)',
            to: "const next = nextCommitKey((f5aFirst.status === 'ok' ? f5aFirst : parsed).base.key, { staging: null }, env)",
        },
    ],
    // c409-14: a collection batch that conflicted on the commit key is sent again at the key's new token, without a fresh mark.
    gcRetryNoReread: [{
        file: PASS,
        from: "            if (error instanceof Store2CommitConflictError) {\n                return { status: 'rebuild', deleted, batches }\n            }",
        to: "            if (error instanceof Store2CommitConflictError) {\n                await backend.removeBatch(batch, error.current.token, gate.fenceToken)\n                deleted += batch.length\n                batches++\n                continue\n            }",
    }],
    // c409-15: a restore that conflicted is written again at the version the conflict reported.
    restoreRetryAtPeerIndex: [{
        file: S + 'commit.ts',
        from: '            return settle(next, nextBytes, () => backend.casCommit(base.read.token, nextBytes))\n        },\n\n        async saveMine(',
        to: "            const first = await settle(next, nextBytes, () => backend.casCommit(base.read.token, nextBytes))\n            return first.status === 'conflict' ? settle(next, nextBytes, () => backend.casCommit(first.current.token, nextBytes)) : first\n        },\n\n        async saveMine(",
    }],
    // c409-16: a pick whose tree read found a unit gone is reported ready, so the screen goes on to the install.
    pickIgnoresGoneUnit: [{
        file: S + 'recoveryPick.ts',
        from: "        if (error instanceof WalkStop) {\n            return { status: 'invalid', problem: error.problem, marked: exit }\n        }",
        to: "        if (error instanceof WalkStop) {\n            return { status: 'ready', manifestKey, manifestSeq: manifest.body.seq, units: collector.units, counts: { missingImages: 0, missingInlays: 0, unknownLists: 0 }, marked: exit, backend, env }\n        }",
    }],
    // ---- step 2f-5a (source: f5a-mutants.mjs) ----
    // surprise-s2 (amendment 4): the final write of a bulk commit no longer force-pushes a peer's `current` into `retained`.
    bulkFinalNoForcePush: [{
        file: S + 'commit.ts',
        from: 'retained: nextRetained(heldKey, now, heldKey.current?.key !== markerKey.current?.key),',
        to: 'retained: nextRetained(heldKey, now, false),',
    }],
    // c409-13: a collection pass treats a missing manifest as an empty tree instead of refusing the pass: the mark accepts it
    // and so does the deleter gate (the gate alone still refuses with closure-unreadable, see gcMarkMissingOnly).
    gcMissingManifestAsEmpty: [
        {
            file: S + 'gc/mark.ts',
            from: "const notOk = closure.find(read => read.status !== 'ok')",
            to: "const notOk = closure.find(read => read.status !== 'ok' && read.status !== 'missing')",
        },
        {
            file: BOOT,
            from: "if (tree.status !== 'ok') {\n            return refuse('closure-unreadable'",
            to: "if (tree.status !== 'ok' && tree.status !== 'missing') {\n            return refuse('closure-unreadable'",
        },
    ],
    // The mark alone accepts a missing manifest: the deleter gate still refuses the pass.
    gcMarkMissingOnly: [{
        file: S + 'gc/mark.ts',
        from: "const notOk = closure.find(read => read.status !== 'ok')",
        to: "const notOk = closure.find(read => read.status !== 'ok' && read.status !== 'missing')",
    }],
    // Driver and checker side, run against the unit tests of the new infrastructure.
    // A lock-taking call that arrives while another waits no longer queues behind it.
    parkedNoFifo: [{
        file: SCHEDULER,
        from: "fault !== 'ghost-queued' && (heldGhosts() > 0 || parked.length > 0)) {",
        to: "fault !== 'ghost-queued' && heldGhosts() > 0) {",
    }],
    // A parked call no longer keeps the run alive once every actor is over.
    parkedNotLive: [{
        file: SCHEDULER,
        from: 'const live = ghosts.length > 0 || parked.length > 0 || [',
        to: 'const live = ghosts.length > 0 || [',
    }],
    // A resumed parked call is judged on the step number it was granted under.
    parkedKeepsGrantStep: [{
        file: SCHEDULER,
        from: 'info.step = stepNo\n',
        to: '',
    }],
    // A backend conflict no longer reports the commit key value it carried.
    conflictReadNotReported: [{
        file: SCHEDULER,
        from: 'info.commitConflictRead = settled.failure.current.bytes',
        to: 'void settled',
    }],
    // The checker ignores the commit key value a conflict carried.
    conflictReadIgnored: [{
        file: CHECKER,
        from: 'if (info.commitConflictRead !== undefined) {',
        to: 'if (false) {',
    }],
    // The I1 exemption covers any removal, not only the environment step's.
    envExemptsAnyRemoval: [{
        file: CHECKER,
        from: "if (info.kind === 'env' && info.fault === 'remove-unit') {",
        to: 'if (removed.length > 0) {',
    }],
    // The I1 exemption is never consulted.
    envExemptionNone: [{
        file: CHECKER,
        from: '!lostToEnvironment.has(key)',
        to: 'true',
    }],
    // c409-18: the install's final write compares at a fresh read of the commit key instead of the marker's read-back token.
    finalFreshToken: [{
        file: S + 'recoveryPick.ts',
        from: 'const written = await backend.casCommit(marked.markerRead.token, nextBytes)',
        to: 'const written = await backend.casCommit((await backend.readCommit()).token, nextBytes)',
    }],

    // ---- round-2 actors and checker (source: f5r-mutants.mjs) ----
    // The recovery screen reads the commit key afresh instead of using its own read.
    recoveryFreshRead: [{
        file: ACTORS,
        from: 'const held = screen ?? need().commitRead',
        to: 'const held = (await freshKey()).read',
    }],
    // The screen ends at the first conflict, as before round 2: the key a conflict carried is never the screen's read.
    screenNoRerun: [{
        file: ACTORS,
        from: 'const held = screen ?? need().commitRead',
        to: 'const held = need().commitRead',
    }],
    // The checker never protects the tree of a manifest the environment took out.
    lostTreeNone: [{
        file: CHECKER,
        from: 'if (!stillNamed.has(manifest)) {',
        to: 'if (true) {',
    }],
    // The protection of the lost tree outlives the commit key's naming of the manifest.
    lostTreeForever: [{
        file: CHECKER,
        from: 'if (!stillNamed.has(manifest)) {',
        to: 'if (false) {',
    }],

    // ---- install-breaking edits (source: g5r-mutants.mjs) ----
    // The install never writes: every pick that reaches install ends abandoned with the staged copies left.
    g5rPickNeverInstalls: [{
        file: S + 'recoveryPick.ts',
        from: 'return await finalWrite(ready, manifestKey, body)',
        to: 'return { status: \'abandoned\', current: ready.marked.markerRead }',
    }],
    // The final compare-and-write is skipped while the install still reports installed.
    g5rFinalCasSkipped: [{
        file: S + 'recoveryPick.ts',
        from: 'const written = await backend.casCommit(marked.markerRead.token, nextBytes)',
        to: 'const written = { flushed: undefined as boolean | undefined }',
    }],
    // source: g5r-mutants.mjs
    g5rGcMissingNoLostTree: [
        ...[
            {
                file: S + 'gc/mark.ts',
                from: "const notOk = closure.find(read => read.status !== 'ok')",
                to: "const notOk = closure.find(read => read.status !== 'ok' && read.status !== 'missing')",
            },
            {
                file: BOOT,
                from: "if (tree.status !== 'ok') {\n            return refuse('closure-unreadable'",
                to: "if (tree.status !== 'ok' && tree.status !== 'missing') {\n            return refuse('closure-unreadable'",
            },
        ],
        { file: CHECKER, from: 'if (!stillNamed.has(manifest)) {', to: 'if (true) {' },
    ],

    // ---- round 3 (source: f5s-mutants.mjs, re-targeted in l7m-mutants.mjs) ----
    // The driver never judges an install result against the commit-key writes (re-targeted to the call that carries the result's bytes).
    g5sNoInstCheck: NO_INST_CHECK,
    // R14's a2 picks whichever candidate its listing offers first, as before round 3.
    g5sR14NoCandidate: [{
        file: REPLAY + 'regions.ts',
        from: "actor('a2', 14, [open, { do: 'recover', candidate: true }], {",
        to: "actor('a2', 14, [open, recover], {",
    }],
    // The final compare-and-write skipped, and the driver check off: the round-2 shape, which the regions did not catch.
    // source: f5s-mutants.mjs (composed here from the re-targeted g5sNoInstCheck)
    g5sSkippedNoCheck: [
        { file: S + 'recoveryPick.ts', from: 'const written = await backend.casCommit(marked.markerRead.token, nextBytes)', to: 'const written = { flushed: undefined as boolean | undefined }' },
        ...NO_INST_CHECK,
    ],

    // ---- INST rule (source: f5t-mutants.mjs; instBytesOnly final form from f7a-mutants.mjs) ----
    // The round-3 rule: the result's bytes must equal an applied own write, and the manifest key is not judged.
    instBytesOnly: [WRITE_CLAUSE, RESULT_CLAUSE],
    // An uncertain final write is taken as landed whatever the read-back shows: installed with the marker's bytes.
    g5tUnknownAsInstalled: [
        {
            file: S + 'recoveryPick.ts',
            from: 'if (read.bytes !== null && sameBytes(read.bytes, nextBytes)) {',
            to: 'if (read.bytes !== null) {',
        },
    ],

    // ---- Tauri flush and restart (source: f5b-mutants.mjs) ----
    // GC never looks at the session's unconfirmed-flush state.
    gcIgnoresUnconfirmedFlush: [{
        file: PASS,
        from: 'idleReason: deps.idleReason()',
        to: 'idleReason: null',
    }],
    // Carry 1b-5a M1: a top-level write whose flush status is missing or false is reported flushed.
    topFlushMissingAsFlushed: [{
        file: TAURI,
        from: 'return { flushed: top ? written.flushed === true : written.flushed }',
        to: 'return { flushed: top ? true : written.flushed }',
    }],
    // Restart hands the new page the old store object, so the old page's backend mutex.
    restartKeepsOldStore: [{
        file: FAKE,
        from: '            store = makeStore()\n            return dropped.sort()',
        to: '            void makeStore\n            return dropped.sort()',
    }],
    // The new page's boot never runs the start-up clear of its own marker.
    skipStartupClear: [{
        file: BOOT,
        from: "if (decision.row !== 9 || decision.clear !== 'own') {",
        to: 'if (true) {',
    }],
    // A restart keeps every unflushed write.
    restartDropsNothing: [{
        file: FAKE,
        from: '            if (drop) {\n                for (const [key, below] of notFlushed) {',
        to: '            if (false) {\n                for (const [key, below] of notFlushed) {',
    }],
    // A restart leaves the other actors of the page running.
    restartKeepsPeers: [{
        file: SCHEDULER,
        from: "                state.status = 'crashed'\n            }\n        }\n        pending = pending.filter((other) => other.actor === entry.actor",
        to: "                void state\n            }\n        }\n        pending = pending.filter((other) => other.actor === entry.actor",
    }],

    // ---- unflushed staged units (source: f5c-mutants.mjs) ----
    // The library before the fix, for measuring the old rates under the new checker.
    bothIgnoreUnflushedUnit: [...BULK, ...INSTALL],
    // Bulk uploads discard the flush report of a staged unit again.
    bulkIgnoresUnflushedUnit: [...BULK],
    // The install's putFresh discards the flush report of a staged unit again.
    installIgnoresUnflushedUnit: [...INSTALL],
    // The Tauri putUnit passes a missing flush report through as undefined.
    tauriUnitUndefinedAsFlushed: [{
        file: TAURI,
        from: 'return { flushed: written.flushed === true }',
        to: 'return { flushed: written.flushed }',
    }],

    // ---- IndexedDB (source: f5g-mutants.mjs) ----
    // Plan item C (m_gcCheckOutside): the collection batch makes its commit-key and fence compare in reads of their own, before the
    // transaction that deletes, and the transaction no longer compares.
    idbGcCheckOutside: [
        {
            file: IDB,
            from: 'const owned = [...keys]\n            return withWriteConnection(',
            to: 'const owned = [...keys]\n'
                + '            const commitOutside = await readBytes(COMMIT_KEY)\n'
                + '            if (!tokenMatches(expectedCommit, commitOutside)) { throw new Store2CommitConflictError(readOf(commitOutside)) }\n'
                + '            const fenceOutside = await readBytes(FENCE_KEY)\n'
                + '            if (!tokenMatches(expectedFence, fenceOutside)) { throw new Store2FenceConflictError(readOf(fenceOutside)) }\n'
                + '            return withWriteConnection(',
        },
        REMOVE_COMMIT_COMPARE,
        REMOVE_FENCE_COMPARE,
    ],
    // The adapter's ordinary commit writes without comparing the commit key.
    idbCommitNoCompare: [{ file: IDB, from: 'if (!tokenMatches(expectedCommit, stored.bytes)) {', to: 'if (false) {' }],
    // The adapter's collection batch deletes without comparing the commit key (the c1 analog) or without comparing the fence.
    idbRemoveNoCommitCompare: [REMOVE_COMMIT_COMPARE],
    idbRemoveNoFenceCompare: [REMOVE_FENCE_COMPARE],
    // The adapter's compare-and-set of the commit key and the fence (markers, final writes, fence exits) writes without comparing.
    idbCasNoCompare: [{ file: IDB, from: 'if (!tokenMatches(expected, stored.bytes)) {', to: 'if (false) {' }],
    // Rig mutants: the per-key split of a tree read is gone; the listing shuffle is the identity; a lost response is no loss.
    rigSplitCollapsed: [{
        file: SCHEDULER,
        from: 'const parts = await Promise.all(keys.map((key) => inner.readUnits([key])))',
        to: 'const whole = await inner.readUnits(keys)\n            const parts = keys.map(() => whole)',
    }],
    rigShuffleIdentity: [IDENTITY], // source: f5g-mutants.mjs, same edit as in f7a-mutants.mjs
    rigLostResponseIsSuccess: [{
        file: SCHEDULER,
        from: "entry.reject('failure' in settled && !entry.spec.loss.hides(settled.failure) ? settled.failure : entry.spec.loss.lost('response'))",
        to: "if ('failure' in settled) { entry.reject(settled.failure) } else { entry.resolve(settled.value) }",
    }],

    // ---- live-server fixture and 2f-7a INST (source: f7a-mutants.mjs) ----
    // The 2f-7a rule without its second clause: the result's own bytes are not judged (the round-4 rule).
    instSupersededWrite: [RESULT_CLAUSE],
    // Information only: prints the floors and limits each smoke test asserts.
    f7aDumpConfig: [{
        file: REPLAY + 'pctSmoke.test.ts',
        from: 'const started = Date.now()\n',
        to: "const started = Date.now()\n            console.log('PCT-CONFIG ' + JSON.stringify({ region: region.id, backend, seeds: seedsOf(region, backend).length, floors: floorsOf(region, backend), minFaulted: region.faults === undefined ? null : minFaultedOf(region, backend), startAfterSteps: region.faults?.startAfterSteps ?? null, minExercised: region.minExercised ?? 0.9 }))\n",
    }],
    // Information only: logs each pass's candidate count and the batch a unit conflict stopped on; behaviour unchanged.
    f7aTraceGc: [{
        file: PASS,
        from: 'let deleted = 0\n    let batches = 0\n    for (let at = 0;',
        to: "console.log('F7A-GC candidates=' + candidates.length + ' standing=' + standing + ' keys=' + JSON.stringify([...candidates].sort()))\n    let deleted = 0\n    let batches = 0\n    for (let at = 0;",
    }, {
        file: PASS,
        from: "return { status: 'done', deleted, batches, stopped: 'unit-conflict' }",
        to: "console.log('F7A-GC unit-conflict after deleted=' + deleted + ' batch=' + JSON.stringify(batch)); return { status: 'done', deleted, batches, stopped: 'unit-conflict' }",
    }],
    // Information only: prints every removal batch and the raw listing of each pass.
    f7aTraceBatches: [{
        file: PASS,
        from: 'const batch = candidates.slice(at, at + REMOVE_BATCH_MAX)\n',
        to: "const batch = candidates.slice(at, at + REMOVE_BATCH_MAX)\n        console.log('F7A-BATCH ' + JSON.stringify(batch))\n",
    }, {
        file: PASS,
        from: 'const standing = gate.commit.staging === null',
        to: "console.log('F7A-LIST ' + listed.length + ' live=' + mark.live.size + ' gateLive=' + gate.liveKeys.size + ' keys=' + JSON.stringify([...listed].sort()))\n    const standing = gate.commit.staging === null",
    }],
    // Information only: prints the scheduler log of one run.
    f7aTraceLog: [{
        file: REPLAY + 'regions.ts',
        from: 'const log = rig.scheduler.log\n',
        to: "const log = rig.scheduler.log\n    if (region.id === 'R12' && backend === 'tauri' && seed === 8) { console.log('F7A-LOG ' + JSON.stringify(log)) }\n",
    }],
    // The collector starts 5.5 s late: a 5 s main run ends with no batch applied and only an extension can rescue it.
    gcLateStart: [{
        file: LIVE_FIXTURE,
        from: 'const rng = seededRng(options.seed * 1000 + 200)\n',
        to: 'const rng = seededRng(options.seed * 1000 + 200)\n        await pause(5500)\n',
    }],
    // The rig wiring of the listing shuffle is removed on one variant.
    nodeRigNoShuffle: [{
        file: REPLAY + 'nodeRig.ts',
        from: 'shuffleListing(createNodeBackend(store), listing)',
        to: 'createNodeBackend(store)',
    }],
    tauriRigNoShuffle: [{
        file: REPLAY + 'tauriRig.ts',
        from: 'shuffleListing(await createTauriBackend(store), listing)',
        to: 'await createTauriBackend(store)',
    }],
    // The listing shuffle is the identity on every variant (information only).
    f7aTraceGcIdentity: [{
        file: PASS,
        from: 'let deleted = 0\n    let batches = 0\n    for (let at = 0;',
        to: "console.log('F7A-GC candidates=' + candidates.length + ' standing=' + standing + ' keys=' + JSON.stringify([...candidates].sort()))\n    let deleted = 0\n    let batches = 0\n    for (let at = 0;",
    }, {
        file: PASS,
        from: "return { status: 'done', deleted, batches, stopped: 'unit-conflict' }",
        to: "console.log('F7A-GC unit-conflict after deleted=' + deleted + ' batch=' + JSON.stringify(batch)); return { status: 'done', deleted, batches, stopped: 'unit-conflict' }",
    }, IDENTITY],
    f7aTraceLogIdentity: [{
        file: REPLAY + 'regions.ts',
        from: 'const log = rig.scheduler.log\n',
        to: "const log = rig.scheduler.log\n    if (region.id === 'R12' && backend === 'tauri' && seed === 8) { console.log('F7A-LOG ' + JSON.stringify(log)) }\n",
    }, IDENTITY],
    f7aTraceBatchesIdentity: [{
        file: PASS,
        from: 'const batch = candidates.slice(at, at + REMOVE_BATCH_MAX)\n',
        to: "const batch = candidates.slice(at, at + REMOVE_BATCH_MAX)\n        console.log('F7A-BATCH ' + JSON.stringify(batch))\n",
    }, {
        file: PASS,
        from: 'const standing = gate.commit.staging === null',
        to: "console.log('F7A-LIST ' + listed.length + ' live=' + mark.live.size + ' gateLive=' + gate.liveKeys.size + ' keys=' + JSON.stringify([...listed].sort()))\n    const standing = gate.commit.staging === null",
    }, IDENTITY],

    // ---- live-server mutants (source: g6b-mutants.mjs; gcMainUnseen and gcMainNoCount are also taken by f7a-mutants.mjs) ----
    // Collection ignores its mark: live units are removed while the commit key still names them (a planted I1 break).
    gcIgnoresMark: [{
        file: PASS,
        from: '!mark.live.has(key) && !gate.liveKeys.has(key)',
        to: '!gate.liveKeys.has(key)',
    }],
    // The earlier server builds are replaced by the current script, so the unpatched-server assertions meet a patched server.
    oldServersUseCurrent: [{
        file: 'src/ts/storage/tests/nodeLiveServerFixture.ts',
        from: "return { script: join(dir, 'server.cjs'), dispose }",
        to: `return { script: ${JSON.stringify(ROOT + '/server/node/server.cjs')}, dispose }`,
    }],
    // The committer's settle no longer reads the commit key back after an unknown outcome.
    settleNoReadBack: [{
        file: S + 'commit.ts',
        from: 'if (read.bytes !== null && sameBytes(read.bytes, nextBytes)) {',
        to: 'if (false) {',
    }],
    // A pass treats an unknown batch outcome as a plain backend failure.
    gcUnknownAsFailure: [{
        file: PASS,
        from: 'if (error instanceof Store2UnknownOutcomeError) {',
        to: 'if (false) {',
    }],
    // No batch holds more than one key, so no retire is multi-key.
    singleKeyBatches: [{
        file: S + 'backend/types.ts',
        from: 'export const REMOVE_BATCH_MAX = 25',
        to: 'export const REMOVE_BATCH_MAX = 1',
    }],
    // Collection runs in the main run but applies nothing the run can see: only the retire phase deletes.
    gcMainNoCount: [{
        file: LIVE_FIXTURE,
        from: 'tallyGc(tally, await gcPass(gcDepsOf(collector, collectorBackend)))',
        to: 'await gcPass(gcDepsOf(collector, collectorBackend))',
    }],
    // No collection loop in the main run at all.
    gcLoopOff: [{
        file: LIVE_FIXTURE,
        from: 'tallyGc(tally, await gcPass(gcDepsOf(collector, collectorBackend)))',
        to: 'await pause(5)',
    }],
    // The observer's reads fail now and then at any time, not only while the server restarts.
    observerFlaky: [{
        file: LIVE_FIXTURE,
        from: '            return await store.read(key)\n',
        to: "            if ((globalThis.__g6bReads = (globalThis.__g6bReads ?? 0) + 1) % 97 === 0) { throw new Error('mutant read failure') }\n            return await store.read(key)\n",
    }],
    // Collection runs and deletes in the main run but none of it reaches the main tally, so only the retire phase shows deletions and partial visibility.
    gcMainUnseen: [{
        file: LIVE_FIXTURE,
        from: 'tallyGc(tally, await gcPass(gcDepsOf(collector, collectorBackend)))',
        to: 'tallyGc(new Tally(), await gcPass(gcDepsOf(collector, collectorBackend)))',
    }, {
        file: LIVE_FIXTURE,
        from: 'instrumentRetires(collector.backend, window, observerStore, tally)',
        to: 'instrumentRetires(collector.backend, window, observerStore, new Tally())',
    }],

    // ---- 2f-7b (source: l7-mutants.mjs) ----
    // Seq-only compare off Node: the IndexedDB and Tauri backends' compare token matches when both sides parse as commit keys with the same seq.
    seqOnlyCompare: [{
        file: S + 'backend/types.ts',
        from: "import { isStore2Key } from '../../store/keyRules'",
        to: "import { isStore2Key } from '../../store/keyRules'\nimport { classifyCommitRead } from '../commitKey'",
    }, {
        file: S + 'backend/types.ts',
        from: '    return sameBytes(wanted, actual)\n}',
        to: "    const wantedRead = classifyCommitRead({ bytes: wanted })\n    const actualRead = classifyCommitRead({ bytes: actual })\n    if (wantedRead.status === 'parsed' && actualRead.status === 'parsed') {\n        return wantedRead.value.seq === actualRead.value.seq\n    }\n    return sameBytes(wanted, actual)\n}",
    }],

    // ---- E1-1 list items and re-targets (source: l7m-mutants.mjs) ----
    // 1. abandon-clear without the id-and-prefix check: any standing marker is cleared.
    abandonNoIdPrefixCheck: [{
        file: S + 'commit.ts',
        from: 'if (staging.owner !== clearOwner || staging.prefix !== prefix) {',
        to: 'if (false) {',
    }],
    // 2. abandon-clear without the read after an uncertain final CAS: an unknown outcome is taken as cleared.
    abandonUnknownAsCleared: [{
        file: S + 'commit.ts',
        from: "return { status: 'failed', cause: outcome.cause }\n            }\n            let reread: Store2Read",
        to: "return { status: 'failed', cause: outcome.cause }\n            }\n            if (outcome.kind === 'unknown') {\n                return { status: 'cleared', value: next, bytes: nextBytes }\n            }\n            let reread: Store2Read",
    }],
    // 3. a restore CAS that drops staging.
    restoreDropsStaging: [{
        file: S + 'commit.ts',
        from: 'retained: nextRetained(base.key, now, true, manifestKey),',
        to: 'retained: nextRetained(base.key, now, true, manifestKey),\n                staging: null,',
    }],
    // 4a. a restore that does not force-push current (admission decides).
    restoreNoForcePush: [{
        file: S + 'commit.ts',
        from: 'nextRetained(base.key, now, true, manifestKey)',
        to: 'nextRetained(base.key, now, false, manifestKey)',
    }],
    // 4b. a restore that never pushes current.
    restoreNeverPushes: [{
        file: S + 'commit.ts',
        from: 'retained: nextRetained(base.key, now, true, manifestKey),',
        to: 'retained: base.key.retained.filter(entry => entry.key !== manifestKey),',
    }],
    // 5a. a save-mine that drops staging (ordinary() with force is the save-mine path).
    saveMineDropsStaging: [{
        file: S + 'commit.ts',
        from: 'retained: nextRetained(base.key, now, force),',
        to: 'retained: nextRetained(base.key, now, force),\n            ...(force ? { staging: null } : {}),',
    }],
    // 5b. a save-mine that drops pins.
    saveMineDropsPins: [{
        file: S + 'commit.ts',
        from: 'retained: nextRetained(base.key, now, force),',
        to: 'retained: nextRetained(base.key, now, force),\n            ...(force ? { pins: [] } : {}),',
    }],
    // 6. a GC mark that ignores pins.
    markIgnoresPins: [{
        file: S + 'gc/mark.ts',
        from: 'const named = refsOf(UNIT_TYPE.commit, commit)',
        to: 'const named = refsOf(UNIT_TYPE.commit, { ...commit, pins: [] })',
    }],
    // 7. a GC that does not skip a staging prefix.
    gcNoStagingSkip: [{
        file: PASS,
        from: ' && (standing === null || !key.startsWith(standing)))',
        to: ')',
    }],
    // 8. recovery exit without the fence step: the marker is written with no fence.
    exitNoFence: [{
        file: S + 'recovery.ts',
        from: "const fence = await fenceExit(backend, { damagedCommitBytes: commitRead.bytes, now: env.now })\n    if (fence.status !== 'written') {\n        return { status: 'fence', fence }\n    }",
        to: "const fence = { status: 'written' as const, record: { keys: [], priorCommits: [], priorFences: [] } as never, bytes: new Uint8Array(0), keys: [] as string[], replacedUnparsable: false, flushed: true as boolean | undefined, attempts: 0 }",
    }],
    // 9. IndexedDB ordinary commit split in two transactions: the commit key first (compare and write), the units after.
    idbCommitSplit: [{
        file: IDB,
        from: "return withWriteConnection((database) => runTransaction<Store2WriteResult>(database, 'readwrite', (objects, control) => {\n                readEntry(objects, COMMIT_KEY, (entry) => {",
        to: "const splitResult = await withWriteConnection((database) => runTransaction<Store2WriteResult>(database, 'readwrite', (objects, control) => {\n                readEntry(objects, COMMIT_KEY, (entry) => {",
    }, {
        file: IDB,
        from: "                    for (const unit of owned) {\n                        addFresh(objects, control, unit.key, unit.bytes)\n                    }\n                    if (stored.bytes === null) {",
        to: "                    if (stored.bytes === null) {",
    }, {
        file: IDB,
        from: "            }))\n        },\n\n        async putUnit(key, bytes) {",
        to: "            }))\n            for (const unit of owned) {\n                await withWriteConnection((database) => runTransaction<Store2WriteResult>(database, 'readwrite', (objects, control) => {\n                    addFresh(objects, control, unit.key, unit.bytes)\n                    control.succeed(unreported())\n                }))\n            }\n            return splitResult\n        },\n\n        async putUnit(key, bytes) {",
    }],
    // Re-target of noRestartExemption: the in-tree checker already carries the old mutant's rule, so the inverse is run:
    // a restart is excused again for a unit the commit key names.
    restartExemptionReadded: [{
        file: CHECKER,
        from: "if (info.kind === 'env' && info.fault === 'remove-unit') {",
        to: "if (info.kind === 'env' && (info.fault === 'remove-unit' || info.fault === 'restart')) {",
    }],

    // ---- restore rewrites the fence (source: f7c-mutants.mjs) ----
    // The committer's restore also rewrites `store2-fence` with changed bytes over an existing fence, after its own commit-key
    // write (a library operation that is not a fence exit).
    restoreRewritesFence: [{
        file: S + 'commit.ts',
        from: "            return settle(next, nextBytes, () => backend.casCommit(base.read.token, nextBytes))\n        },\n\n        async saveMine",
        to: "            const settled = await settle(next, nextBytes, () => backend.casCommit(base.read.token, nextBytes))\n            const fenceRead = await backend.readFence()\n            if (fenceRead.bytes !== null) {\n                await backend.casFence(fenceRead.token, encodeUnit(UNIT_TYPE.fenceRecord, { v: 1, at: now, priorCommits: [], keys: [] }))\n            }\n            return settled\n        },\n\n        async saveMine",
    }],
}
