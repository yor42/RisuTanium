/**
 * The inlay sweep through the maintenance step: `startStore2Maintenance` over a real `Store2Session`, the real gate, the
 * real closure of frames in a memory backend and inlays written with the real `writeAppInlay` into a memory byte store.
 *
 * The page's live facts (other tabs, stop conditions, the resident database, the legacy listing) are injected, as in
 * `maintenanceRunner.test.ts`; the live wiring of those facts has its own file (`inlaySweepLiveFacts.test.ts`). The
 * library: the current manifest names A (and an asset-path inlay S by its hash stem), a retained manifest names R, and
 * O is named by nothing. A mocked backend and store say nothing about a native one.
 *
 * Reproducer RR2 (Tauri) is red on the tree before the wiring: nothing deletes store2 inlays there and the
 * unknown seam `inlayFacts` is ignored, so O's metadata is still stored. G2 and G3 pin what the wiring must not break and
 * the step's log order.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// The runner's default trigger drags in the whole save loop; every case here passes its own.
vi.mock(import('src/ts/process/memory/putBackQuiet'), () => ({
    startQuietTrigger: () => { throw new Error('The real quiet trigger is not used in this test.') },
}) as unknown as typeof import('src/ts/process/memory/putBackQuiet'))

const legacy = vi.hoisted(() => ({
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined),
    keys: vi.fn(async (): Promise<string[]> => []),
    clear: vi.fn(async () => undefined),
}))

vi.mock('localforage', () => ({ default: { createInstance: () => legacy } }))

vi.mock('@tauri-apps/plugin-os', () => ({ type: () => 'windows' }))

vi.mock(import('src/ts/stores.svelte'), () => {
    const stub: Record<string, unknown> = { DBState: { db: {} }, selIdState: { selId: -1 } }
    return new Proxy(stub, {
        get: (t, k) => (k in t ? t[k as string] : k === 'then' ? undefined : vi.fn()),
        has: () => true,
    }) as unknown as typeof import('src/ts/stores.svelte')
})

import { createMemoryByteStore, type MemoryByteStore } from 'src/ts/process/files/tests/memoryByteStore'
import { inlayMetaKey } from 'src/ts/process/files/inlayKeys'
import { readAppInlayRecord, withInlayLock, writeAppInlay } from 'src/ts/process/files/inlayStore'
import * as inlayStore from 'src/ts/process/files/inlayStore'
import { resetPageStorageModeForTests, setPageStorageMode } from 'src/ts/storage/pageStorageMode'
import { getStartupCleanup, resetStartupCleanupForTests } from 'src/ts/storage/startupCleanupState'
import { createMemoryBackend, type MemoryBackend } from 'src/ts/storage/store2/backend'
import {
    encodeUnit, refOfFrame, UNIT_TYPE,
    type InlayList, type ListRef, type Manifest, type ModuleEntry, type Ref, type ShardEntry, type UnitType,
} from 'src/ts/storage/store2/format'
import { deriveInlayList } from 'src/ts/storage/store2/lists'
import {
    formatInlaySweepResult, resetMaintenanceForTests, startStore2Maintenance, type InlayPageFacts, type MaintenanceSeams,
} from 'src/ts/storage/store2/maintenance'
import type { OldDataDeletionResult } from 'src/ts/storage/store2/oldData/delete'
import { Store2Session } from 'src/ts/storage/store2/session'
import type { AutoGcFacts } from 'src/ts/storage/store2/gc/autoGc'
import type { SweepPageFacts } from 'src/ts/storage/store2/maintenance'
import type { Database } from 'src/ts/storage/database.svelte'
import { createClock, seedTree, testEnv } from 'src/ts/storage/tests/store2SaveKit'
import { flushConfirming } from './flushConfirmBackend'
import { assetListOf, commitKeyOf, inlayListOf, manifestKey, unitTail } from './sweepFixtures'

const clock = createClock()
const env = testEnv(clock, 3)

const SEED_DB = {
    formatversion: 5, botPresetsId: 0, botPresets: [{ name: 'test-preset' }], modules: [], loadouts: [], plugins: [],
    pluginCustomStorage: {}, mainPrompt: 'chain', characters: [],
}

const COMPLETED: OldDataDeletionResult = { status: 'completed', deleted: 0, abandoned: 0, flushed: undefined }

const SWEEP_YIELDED = 'store2 asset sweep: status=done phase=none candidates=0 deleted=0 failed=0 kept-live=0 batches=0 recorded=false stopped=yielded'

const QUIET_SWEEP: SweepPageFacts = {
    residentRefs: () => [],
    writtenCount: () => 0,
    writtenThisPage: () => [],
    peers: async () => 'alone',
    shouldStop: () => true,
    release: () => { },
    hold: remove => remove(),
}

/** The clean-up pass yields at once on a busy page: it lists and deletes nothing. */
const BUSY_GC: AutoGcFacts = {
    isBusy: () => true,
    saveLoopParked: () => false,
    isSaveClean: () => true,
    restoreInProgress: () => false,
    peers: async () => 'others',
    ownBase: () => null,
}

/** The facts of a quiet page that is the sole tab, with an empty resident database. */
const ACTIVE_INLAYS: InlayPageFacts = {
    shouldStop: () => false,
    saveMarks: () => 0,
    writtenThisPage: () => false,
    legacyInlayIds: async () => [],
    residentInlays: async () => ({ mentioned: new Set<string>(), sameDatabase: () => true }),
    lock: withInlayLock,
}

const uuid = (n: number): string => `0a1b2c3d-1111-4222-8333-${String(n).padStart(12, '0')}`
const A = uuid(1)
const R = uuid(2)
const O = uuid(3)
/** An asset-path inlay id, kept by the hash stem the current manifest's list holds. */
const S = `assets/${'ab'.repeat(32)}.png`

interface Chain {
    session: Store2Session
    memory: MemoryBackend
    store: MemoryByteStore
    kept: string[]
    o: { meta: string, body: string }
}

let nextUnit = 1

async function storeUnit(memory: MemoryBackend, type: UnitType, body: object): Promise<{ key: string, ref: Ref }> {
    const key = `store2/${unitTail(nextUnit++)}`
    const bytes = encodeUnit(type, body)
    await memory.putUnit(key, bytes)
    return { key, ref: refOfFrame(key, bytes) }
}

async function storeList(memory: MemoryBackend, type: typeof UNIT_TYPE.assetList | typeof UNIT_TYPE.inlayList, list: { v: number }): Promise<ListRef> {
    const { ref } = await storeUnit(memory, type, list)
    return [ref[0], ref[1], ref[2], list.v]
}

/** A manifest of the producer's shape with one character whose inlay list is `il`; its lists are real frames. */
async function addManifest(memory: MemoryBackend, il: InlayList, n: number): Promise<string> {
    const al = await storeList(memory, UNIT_TYPE.assetList, assetListOf([]))
    const characterIl = await storeList(memory, UNIT_TYPE.inlayList, il)
    const character: ShardEntry = {
        u: String(n).padStart(26, 'c'), type: 'character', name: 'c', chaId: 'c', creatorNotes: '', chatPage: 0, firstMsgIndex: 0,
        core: [unitTail(0), 10, 1], lore: null, scripts: null, al, il: characterIl, dsp: false, chats: [],
    }
    const shard = await storeUnit(memory, UNIT_TYPE.shard, { v: 1, entries: [character] })
    const modules: ModuleEntry[] = []
    const index = await storeUnit(memory, UNIT_TYPE.moduleIndex, { v: 1, entries: modules })
    const configAl = await storeList(memory, UNIT_TYPE.assetList, assetListOf([]))
    const configIl = await storeList(memory, UNIT_TYPE.inlayList, inlayListOf({}))
    const dummy: Ref = [unitTail(0), 10, 1]
    const manifest: Manifest = {
        fmt: 1, req: [], seq: n, createdAt: 0, shardCount: 1, shards: [shard.ref],
        fixed: {
            config: dummy, configAl, il: configIl, statics: dummy, order: dummy, loadouts: dummy,
            moduleIndex: index.ref, presets: [], plugins: [], pluginStorage: { buckets: 0, refs: [] }, legacyKeep: null,
        },
    }
    const key = manifestKey(n)
    await memory.putUnit(key, encodeUnit(UNIT_TYPE.manifest, manifest))
    return key
}

/** The value of an inlay as the application stores one; the writer's parameter type names `data` only. */
function inlayValue(data: string) {
    return { name: 'n', ext: 'txt', type: 'image', data }
}

/** The written set exists only once the inlay store has one; a tree without it has nothing to clear. */
function clearWrittenSet(): void {
    if (typeof inlayStore.resetInlaysWrittenForTests === 'function') {
        inlayStore.resetInlaysWrittenForTests()
    }
}

async function put(store: MemoryByteStore, id: string): Promise<{ meta: string, body: string }> {
    await writeAppInlay(store, id, inlayValue(`payload ${id}`))
    const record = (await readAppInlayRecord(store, id))!
    return { meta: inlayMetaKey(id)!, body: record.body }
}

/**
 * A tauri session over the seeded tree, then the commit key is replaced by one whose current manifest names A and the
 * asset-path S and whose retained manifest names R. A holds, R and S are stored with their bodies, and so is O.
 */
async function chain(): Promise<Chain> {
    const memory = createMemoryBackend()
    await seedTree(memory, SEED_DB as unknown as Database, env)
    const over = flushConfirming(memory)
    const session = await Store2Session.open(createMemoryByteStore(), {
        kind: 'tauri', backend: over.backend, upstreamMainFile: async () => false,
    })
    expect(session.decision).toMatchObject({ row: 5, mode: 'normal' })
    expect(session.idleReason).toBeNull()
    const currentList = deriveInlayList([{ text: `{{inlayed::${A}}} {{inlayed::${S}}}` }])
    expect(currentList.h, 'precondition: the asset-path id is held as a hash stem').not.toBe('')
    const current = await addManifest(memory, currentList, 1)
    const retained = await addManifest(memory, deriveInlayList([{ text: `{{inlayed::${R}}}` }]), 2)
    await memory.casCommit((await memory.readCommit()).token, encodeUnit(UNIT_TYPE.commit, commitKeyOf({ current, retained: [{ key: retained, at: 0 }] })))
    const store = createMemoryByteStore()
    const kept: string[] = []
    for (const id of [A, R, S]) {
        const stored = await put(store, id)
        kept.push(stored.meta, stored.body)
    }
    const o = await put(store, O)
    clearWrittenSet()
    return { session, memory, store, kept, o }
}

function fakeTrigger() {
    let fire: (() => void) | null = null
    return {
        start: (run: () => void) => {
            fire = run
            return { arm: () => { }, stop: () => { } }
        },
        fire: () => {
            if (fire === null) {
                throw new Error('No trigger was started.')
            }
            fire()
        },
    }
}

/** Runs the step once and returns every info line it logged, in order. */
async function runStep(page: Chain, seams: MaintenanceSeams = {}): Promise<string[]> {
    const info = vi.spyOn(console, 'info').mockImplementation(() => { })
    info.mockClear()
    const trigger = fakeTrigger()
    startStore2Maintenance(
        { store: async () => page.store, listBackupTimes: async () => [] },
        { session: () => page.session, startTrigger: trigger.start, deletion: async () => COMPLETED, sweepFacts: QUIET_SWEEP, gcPageFacts: BUSY_GC, inlayFacts: ACTIVE_INLAYS, ...seams },
    )
    trigger.fire()
    await vi.waitFor(() => expect(getStartupCleanup()).not.toBeNull())
    await getStartupCleanup()
    return info.mock.calls.map(call => String(call[0]))
}

beforeEach(() => {
    resetPageStorageModeForTests()
    resetStartupCleanupForTests()
    resetMaintenanceForTests()
    clearWrittenSet()
    setPageStorageMode({ kind: 'store2' })
    legacy.setItem.mockClear()
    legacy.removeItem.mockClear()
    legacy.clear.mockClear()
    legacy.keys.mockClear()
    nextUnit = 1
})

afterEach(() => {
    vi.restoreAllMocks()
    resetPageStorageModeForTests()
    resetStartupCleanupForTests()
    resetMaintenanceForTests()
})

describe('the inlay sweep as the fourth deleter of the step', () => {
    test('reproducer RR2 (Tauri): the step deletes the unreferenced inlay with its body, and the current and the retained manifest keep theirs', async () => {
        const page = await chain()

        await runStep(page)

        expect(await page.store.has(inlayMetaKey(O)!)).toBe(false)
        expect(page.store.files.has(page.o.body)).toBe(false)
        for (const key of page.kept) {
            expect(page.store.files.has(key), key).toBe(true)
        }
    })

    test('guard G2: an inlay a list names by uuid, one a retained manifest names and an asset-path inlay named by a hash stem are kept (passes before and after: nothing deleted them)', async () => {
        const page = await chain()

        await runStep(page)

        for (const id of [A, R, S]) {
            expect(await page.store.has(inlayMetaKey(id)!), id).toBe(true)
        }
    })

    test('guard G3: the step logs exactly the clean-up line, the asset sweep line and then the inlay sweep line, with counts and no id', async () => {
        const page = await chain()

        const lines = await runStep(page)

        expect(lines).toEqual([
            expect.stringContaining('store2 clean-up: status=done deleted=0 batches=0 stopped=yielded'),
            SWEEP_YIELDED,
            'store2 inlay sweep: status=done candidates=1 deleted=1 bodies=1 failed=0 kept-live=0 kept-legacy=0 batches=1',
        ])
        expect(lines.join('\n')).not.toContain(O)
    })

    test('guard: a thrown inlay pass is logged and swallowed, and the registered promise still settles', async () => {
        const page = await chain()
        const error = vi.spyOn(console, 'error').mockImplementation(() => { })
        const failure = new Error('The legacy listing broke.')
        const broken: InlayPageFacts = { ...ACTIVE_INLAYS, residentInlays: async () => { throw failure } }

        await runStep(page, { inlayFacts: broken })

        expect(error).toHaveBeenCalledWith(failure)
        expect(getStartupCleanup()).toBeNull()
        expect(await page.store.has(inlayMetaKey(O)!)).toBe(true)
    })
})

describe('the inlay result line', () => {
    test('a refusal that follows deletions of an earlier round shows their tally; a plain refusal shows none; no line holds an id', () => {
        expect(formatInlaySweepResult({ status: 'refused', reason: 'fenced', deleted: 3, failed: 1 }))
            .toBe('store2 inlay sweep: status=refused reason=fenced deleted=3 failed=1')
        expect(formatInlaySweepResult({ status: 'refused', reason: 'other-tab' })).toBe('store2 inlay sweep: status=refused reason=other-tab')
        expect(formatInlaySweepResult({ status: 'skipped' })).toBe('store2 inlay sweep: status=skipped')
        expect(formatInlaySweepResult({
            status: 'done', candidates: 2, deleted: 1, bodies: 3, failed: 0, keptLive: 1, keptLegacy: 4, batches: 1, stopped: 'changed',
        })).toBe('store2 inlay sweep: status=done candidates=2 deleted=1 bodies=3 failed=0 kept-live=1 kept-legacy=4 batches=1 stopped=changed')
    })
})
