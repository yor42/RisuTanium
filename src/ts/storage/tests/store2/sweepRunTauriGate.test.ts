// @vitest-environment node
/**
 * The asset sweep on a Tauri page against the page-generation gate, over the real `createTauriFilesStore` and the real
 * `createTauriBackend` on the desktop command and file system stand-ins (the rig of `backendTauriGate.test.ts`): the same-bytes
 * `casCommit` that precedes every batch and the record write is refused once a newer page has registered, so a superseded
 * page deletes nothing further and writes no record; a commit between batches conflicts the probe and rebuilds; a probe whose
 * write is not reported flushed idles the pass.
 *
 * The Rust commands are tested in `src-tauri`; a pass here is no evidence about them. The pass does not exist on the base, so
 * an import failure there proves nothing: each test is a guard that a named mutant (the per-batch probe reduced to a read, the
 * probe before the record write dropped) turns red.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'

const h = await vi.hoisted(async () => {
    const fs = (await import('src/ts/storage/tests/tauriFsFake')).createFakeTauriFs({ strict: true })
    const fake = await import('src/ts/storage/tests/tauriDesktopFake')
    const desktop = fake.createDesktopInvoke(fs)
    const bounded = fake.createBoundedFs(fs)
    const paths = (await import('src/ts/storage/tests/tauriPathFake')).createFakeTauriPaths()
    return { fs, desktop, bounded, paths, flags: { unflushedTopWrites: false } }
})

vi.mock('@tauri-apps/plugin-fs', () => h.bounded.module)
vi.mock('@tauri-apps/api/path', () => h.paths.pathModule)
vi.mock('@tauri-apps/api/core', () => ({
    ...h.paths.coreModule,
    // The stand-in `write_durable` answers nothing; the Rust command answers `{ flushed }`, which a unit write needs to count as flushed.
    invoke: async (command: string, args?: unknown, options?: { headers?: Record<string, string> }) => {
        const answer = await h.desktop.invoke(command, args, options)
        if (command === 'store2_write_top_raw' && h.flags.unflushedTopWrites) {
            // The write is applied, the native command reports that its flush did not succeed.
            return { flushed: false }
        }
        return command === 'write_durable' ? { flushed: true } : answer
    },
}))
vi.mock('@tauri-apps/plugin-os', () => ({ type: () => 'windows' }))

import { holdAssetDeletion, resetAssetDeleteHoldForTests } from 'src/ts/storage/assetDeleteHold'
import type { ByteStore } from 'src/ts/storage/store/contract'
import { createTauriFilesStore } from 'src/ts/storage/store/tauriFilesStore'
import { createTauriBackend, type Store2Backend } from 'src/ts/storage/store2/backend'
import { SWEEP_KEY, UNIT_TYPE, encodeUnit, refOfFrame, type Manifest, type Ref, type UnitType } from 'src/ts/storage/store2/format'
import { Store2Session } from 'src/ts/storage/store2/session'
import { runAssetSweep, type AssetSweepEnv, type AssetSweepResult } from 'src/ts/storage/store2/sweep'
import { resetByteTransportForTests } from 'src/ts/storage/tauriByteTransport'
import { resetGateTransportForTests } from 'src/ts/storage/tauriGateTransport'
import { assetListOf, commitKeyOf, manifestKey, unitTail } from './sweepFixtures'

const NOW = 1_900_000_000_000
const DAY = 24 * 60 * 60 * 1000

beforeEach(() => {
    h.fs.reset()
    h.desktop.reset()
    h.bounded.reset()
    h.paths.reset()
    h.desktop.chunk.reportFlushes()
    h.flags.unflushedTopWrites = false
    h.fs.setPlatform('windows')
    resetByteTransportForTests()
    resetGateTransportForTests()
    resetAssetDeleteHoldForTests()
})

interface Rig {
    store: ByteStore
    backend: Store2Backend
    session: Store2Session
    env: AssetSweepEnv
    clock: { now: number }
    nextUnit: number
}

async function putManifest(rig: Rig, config: readonly string[], n: number): Promise<string> {
    const put = async (type: UnitType, body: object): Promise<Ref> => {
        const key = `store2/${unitTail(rig.nextUnit++)}`
        const bytes = encodeUnit(type, body)
        await rig.backend.putUnit(key, bytes)
        return refOfFrame(key, bytes)
    }
    const shard = await put(UNIT_TYPE.shard, { v: 1, entries: [] })
    const index = await put(UNIT_TYPE.moduleIndex, { v: 1, entries: [] })
    const al = await put(UNIT_TYPE.assetList, assetListOf(config))
    const il = await put(UNIT_TYPE.inlayList, { v: 1, u: [], h: '', o: [] })
    const dummy: Ref = [unitTail(0), 10, 1]
    const manifest: Manifest = {
        fmt: 1, req: [], seq: n, createdAt: 0, shardCount: 1, shards: [shard],
        fixed: {
            config: dummy, configAl: [al[0], al[1], al[2], 1], il: [il[0], il[1], il[2], 1], statics: dummy, order: dummy, loadouts: dummy,
            moduleIndex: index, presets: [], plugins: [], pluginStorage: { buckets: 0, refs: [] },
            legacyKeep: null,
        },
    }
    const key = manifestKey(n)
    await rig.backend.putUnit(key, encodeUnit(UNIT_TYPE.manifest, manifest))
    return key
}

async function commitTo(rig: Rig, current: string, seq: number): Promise<void> {
    await rig.backend.casCommit((await rig.backend.readCommit()).token, encodeUnit(UNIT_TYPE.commit, commitKeyOf({ current, seq })))
}

async function newRig(orphans: readonly string[]): Promise<Rig> {
    const store = createTauriFilesStore({ platform: 'windows' })
    const backend = await createTauriBackend(store)
    const rig = { store, backend, clock: { now: NOW }, nextUnit: 1 } as Rig
    await commitTo(rig, await putManifest(rig, ['cfg.png'], 1), 1)
    for (const name of ['cfg.png', ...orphans]) {
        await store.write(`assets/${name}`, new Uint8Array([1]), 'unconditional')
    }
    // The session wraps the backend in the flush tracker, as the page's session does; the pass reads its idle state live.
    rig.session = await Store2Session.open(store, { kind: 'tauri', backend, upstreamMainFile: async () => false })
    rig.env = {
        session: rig.session,
        store,
        now: () => rig.clock.now,
        residentRefs: () => [],
        writtenCount: () => 0,
        writtenThisPage: () => [],
        peers: async () => 'alone',
        shouldStop: () => false,
        release: () => undefined,
        hold: remove => holdAssetDeletion(remove),
    }
    return rig
}

function orphanNames(count: number): string[] {
    return Array.from({ length: count }, (_, i) => `o${String(i).padStart(3, '0')}.png`)
}

function done(result: AssetSweepResult) {
    if (result.status !== 'done') {
        throw new Error(`The pass ended ${JSON.stringify(result)}.`)
    }
    return result
}

async function recordThenAge(rig: Rig): Promise<void> {
    expect(done(await runAssetSweep(rig.env)).phase).toBe('recorded')
    rig.clock.now += DAY + 1000
}

describe('a Tauri page the native gate has superseded', () => {
    test('C20: a page that a newer page superseded between batches deletes nothing more and leaves the record as it was', async () => {
        const orphans = orphanNames(26)
        const rig = await newRig(orphans)
        await recordThenAge(rig)
        const recordBefore = (await rig.store.read(SWEEP_KEY)).bytes
        rig.env.pace = async () => {
            await rig.store.pageGate!.registerPage()
        }

        const result = done(await runAssetSweep(rig.env))

        expect(result).toMatchObject({ stopped: 'stale-page', deleted: 25, recorded: false })
        expect(await rig.store.has(`assets/${orphans[25]}`)).toBe(true)
        expect((await rig.store.read(SWEEP_KEY)).bytes).toEqual(recordBefore)
    })

    test('C21: a page superseded after its last batch writes no record', async () => {
        const rig = await newRig(['o1.png', 'o2.png'])
        await recordThenAge(rig)
        const recordBefore = (await rig.store.read(SWEEP_KEY)).bytes
        rig.env.release = () => {
            // The registration is issued before the record write's probe and the gate processes commands in order.
            void rig.store.pageGate!.registerPage()
        }

        const result = done(await runAssetSweep(rig.env))

        expect(result).toMatchObject({ stopped: 'stale-page', deleted: 2, recorded: false })
        expect((await rig.store.read(SWEEP_KEY)).bytes).toEqual(recordBefore)
    })
})

describe('a Tauri page whose probe is not the first write', () => {
    test('C22: a commit between batches conflicts the probe and the pass rebuilds, so an asset the new commit refers to survives', async () => {
        const orphans = orphanNames(26)
        const rig = await newRig(orphans)
        await recordThenAge(rig)
        rig.env.pace = async () => {
            await commitTo(rig, await putManifest(rig, ['cfg.png', orphans[25]], 2), 2)
        }

        const result = done(await runAssetSweep(rig.env))

        expect(result).toMatchObject({ phase: 'swept', deleted: 25, recorded: true })
        expect(result.stopped).toBeUndefined()
        expect(await rig.store.has(`assets/${orphans[25]}`)).toBe(true)
    })

    test('C23: a probe whose commit-key write is not reported flushed idles the pass before any delete', async () => {
        const rig = await newRig(['o1.png'])
        await recordThenAge(rig)
        h.flags.unflushedTopWrites = true

        const result = done(await runAssetSweep(rig.env))

        expect(result).toMatchObject({ stopped: 'idle', deleted: 0, recorded: false })
        expect(rig.session.idleReason).not.toBeNull()
        expect(await rig.store.has('assets/o1.png')).toBe(true)
    })
})

describe('a manual clean-up on a superseded Tauri page', () => {
    test('G12: a page that a newer page superseded between batches deletes nothing more and writes no record', async () => {
        const orphans = orphanNames(26)
        const rig = await newRig(orphans)
        rig.env.pace = async () => {
            await rig.store.pageGate!.registerPage()
        }

        const result = done(await runAssetSweep({ ...rig.env, manual: { step: 'delete', approved: new Set(orphans) } }))

        expect(result).toMatchObject({ stopped: 'stale-page', deleted: 25, recorded: false })
        expect(await rig.store.has(`assets/${orphans[25]}`)).toBe(true)
        expect((await rig.store.read(SWEEP_KEY)).bytes).toBeNull()
    })
})
