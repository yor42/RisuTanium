// @vitest-environment node
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// The dispatch reaches the page store selection only through the legacy block owner it disables; the selection drags in
// the app's boot chain, which a protocol test must not load.
vi.mock(import('src/ts/storage/store/appStore'), () => ({
    getAppStore: async () => { throw new Error('The page store is not selected in this test.') },
    getAppStoreKind: async () => { throw new Error('The page store is not selected in this test.') },
}) as unknown as typeof import('src/ts/storage/store/appStore'))

import { createMemoryByteStore, type MemoryByteStore } from 'src/ts/process/files/tests/memoryByteStore'
import type { Database } from 'src/ts/storage/database.svelte'
import { resetPageBlockOwnerForTests } from 'src/ts/storage/pageBlockOwner'
import { resetPageStorageModeForTests } from 'src/ts/storage/pageStorageMode'
import { StoreRegistrationTimeoutError, StoreStaleGenerationError } from 'src/ts/storage/store/errors'
import { createMemoryBackend, Store2StalePageError, type Store2Backend } from 'src/ts/storage/store2/backend'
import { getStore2BootSession, resetStore2BootForTest, type Store2BootNotice, type Store2BootResult } from 'src/ts/storage/store2/bootActive'
import { dispatchStore2Boot, type Store2BootUi } from 'src/ts/storage/store2/bootDispatch'
import { firstCommitKey } from 'src/ts/storage/store2/commitKey'
import { encodeUnit, newStagingId, stagingPrefix, UNIT_TYPE } from 'src/ts/storage/store2/format'
import { COMMIT_KEY } from 'src/ts/storage/store2/format/keys'
import { freshOwnerId, type Staging } from 'src/ts/storage/store2/owner'
import { OWNER_KEY } from 'src/ts/storage/store2/ownerStore'
import { getActiveStore2Save, resetStore2SaveForTest } from 'src/ts/storage/store2/saveActive'
import type { Store2Session } from 'src/ts/storage/store2/session'
import { createClock, createPeerDouble, seedTree, testEnv } from '../store2SaveKit'
import { buildSmall, fakeLists } from './codecFixtures'

/**
 * The dispatch on a Tauri page over a fake page-generation gate: every `Store2Session.open` registers the page again,
 * which makes every earlier backend stale, and a registration can time out. Labels: new behaviour. The fake gate is
 * the native gate's own contract as `store2_gate.rs` states it: any registration advances the generation, the only
 * refusal is the timeout (no generation issued, the counter unchanged), and a write that carries a generation other than
 * the current one is refused before it touches the store.
 */

interface TauriRig {
    store: MemoryByteStore
    gate: { current: number, registrations: number, timeouts: Set<number> }
    ui: ReturnType<typeof uiDouble>
    dispatch(options?: { mainFile?: boolean | (() => boolean) }): Promise<Store2BootResult>
    /** Every write other than the owner id: the page store's plain writes and the gated top-level writes. */
    writes(): string[]
}

function uiDouble() {
    const ui = {
        notices: [] as Store2BootNotice[],
        blockedWith: [] as { reason: string, detail: string }[],
        recoveries: [] as { row: number | null, session: Store2Session }[],
        foreignAnswer: 'clear' as 'wait' | 'clear',
        onForeign: (): void => { },
        peer: createPeerDouble(),
        notice(notice: Store2BootNotice) { ui.notices.push(notice) },
        async blocked(blocked: { reason: string, detail: string }) { ui.blockedWith.push(blocked) },
        async offerRestoreOrImport() { },
        async confirmConvert() { return false },
        async declined() { return 'import' as const },
        async confirmConvertWithout() { return 'decline' as const },
        async confirmFromBackup() { return 'decline' as const },
        async confirmIncomplete() { return false },
        async confirmFlaggedOpen() { return 'decline' as const },
        async foreignMarker() {
            ui.onForeign()
            return ui.foreignAnswer
        },
        async recovery(request: Parameters<Store2BootUi['recovery']>[0]) { ui.recoveries.push({ row: request.decision.row, session: request.session }) },
    }
    return ui
}

function tauriRig(): TauriRig {
    const store = createMemoryByteStore()
    const plainWrite = store.write.bind(store)
    store.write = async (key, bytes, condition) => {
        await plainWrite(key, bytes, condition)
        return { version: null, flushed: true }
    }
    const gate = { current: 0, registrations: 0, timeouts: new Set<number>() }
    store.pageGate = {
        async registerPage() {
            gate.registrations += 1
            if (gate.timeouts.has(gate.registrations)) {
                throw new StoreRegistrationTimeoutError('a write that holds the gate did not finish')
            }
            gate.current = gate.registrations
            return gate.current
        },
        async writeTop(generation, key, bytes) {
            if (generation !== gate.current) {
                throw new StoreStaleGenerationError('this page\'s generation is not the current one')
            }
            store.files.set(key, bytes.slice())
            store.writes.push(key)
            return { version: null, flushed: true }
        },
        async removeTop(generation, keys) {
            if (generation !== gate.current) {
                throw new StoreStaleGenerationError('this page\'s generation is not the current one')
            }
            for (const key of keys) {
                store.files.delete(key)
                store.deletes.push(key)
            }
        },
    }
    const ui = uiDouble()
    return {
        store,
        gate,
        ui,
        dispatch: (options = {}) => dispatchStore2Boot({
            store,
            upstreamMainFile: async () => typeof options.mainFile === 'function' ? options.mainFile() : options.mainFile ?? false,
            readColdStorageItem: async () => ({ status: 'missing' }),
            listBackupTimes: async () => [],
        }, { ui, kind: 'tauri', keyEnv: testEnv(createClock(), 600), lists: fakeLists }),
        writes: () => store.writes.filter(key => key !== OWNER_KEY),
    }
}

/** Copies a whole committed tree and its commit key into the page store, the way a peer page's finished install leaves them. */
async function plantPeerTree(store: MemoryByteStore, db: Database = buildSmall(2)): Promise<void> {
    const memory = createMemoryBackend()
    await seedTree(memory, JSON.parse(JSON.stringify(db)) as Database, testEnv(createClock(), 4242), fakeLists)
    for (const [key, bytes] of memory.snapshot()) {
        store.files.set(key, bytes)
    }
}

function foreignMarker(): Uint8Array {
    const staging: Staging = {
        owner: freshOwnerId(testEnv(createClock(), 71)),
        prefix: stagingPrefix(newStagingId(testEnv(createClock(), 72))),
        startedAt: 1_700_000_000_000,
        label: 'seed',
    }
    return encodeUnit(UNIT_TYPE.commit, firstCommitKey({ current: null, staging }, testEnv(createClock(), 73)))
}

beforeEach(() => {
    resetStore2SaveForTest()
    resetStore2BootForTest()
    resetPageBlockOwnerForTests()
    resetPageStorageModeForTests()
})

afterEach(() => {
    resetStore2SaveForTest()
    resetStore2BootForTest()
    resetPageBlockOwnerForTests()
    resetPageStorageModeForTests()
})

describe('new behaviour: every re-classification registers the page again and only the newest session counts', () => {
    test('a peer that finished its install between the two looks is opened on the second session; the first backend is refused', async () => {
        const rig = tauriRig()
        let firstBackend: Store2Backend | null = null
        let lists = 0
        const list = rig.store.list.bind(rig.store)
        rig.store.list = async (prefix) => {
            const names = await list(prefix)
            lists += 1
            // The session read presence by count and by listing (calls 1 and 2); the peer finishes before the marker's own probe (call 3).
            if (lists === 2) {
                await plantPeerTree(rig.store)
            }
            if (lists === 3) {
                firstBackend = getStore2BootSession()?.backend ?? null
            }
            return names
        }
        const result = await rig.dispatch()
        expect(result.kind).toBe('store2')
        if (result.kind !== 'store2') {
            return
        }
        expect(rig.gate.registrations).toBe(2)
        expect(getStore2BootSession()).toBe(result.session)
        expect(getActiveStore2Save()?.session).toBe(result.session)
        // The peer's tree is what it opened; the only write is the second session's boot re-flush of the peer's commit key, byte for byte.
        expect(rig.writes()).toEqual([COMMIT_KEY])
        const planted = createMemoryBackend()
        await seedTree(planted, JSON.parse(JSON.stringify(buildSmall(2))) as Database, testEnv(createClock(), 4242), fakeLists)
        expect(rig.store.files.get(COMMIT_KEY)).toEqual(planted.snapshot().get(COMMIT_KEY))
        expect(firstBackend).not.toBeNull()
        const stale = firstBackend as unknown as Store2Backend
        const read = await stale.readCommit()
        await expect(stale.casCommit(read.token, new Uint8Array([1]))).rejects.toBeInstanceOf(Store2StalePageError)
        // The newest session's backend is current.
        const current = result.session.backend as Store2Backend
        await expect(current.readCommit()).resolves.toBeDefined()
    })

    test('a foreign marker that is cleared makes the page register again; the recovery screen gets the newest session', async () => {
        const rig = tauriRig()
        rig.store.files.set(COMMIT_KEY, foreignMarker())
        let firstBackend: Store2Backend | null = null
        rig.ui.onForeign = () => { firstBackend = getStore2BootSession()?.backend ?? null }
        const result = await rig.dispatch()
        expect(result).toEqual({ kind: 'stopped' })
        expect(rig.gate.registrations).toBe(2)
        expect(rig.ui.recoveries).toHaveLength(1)
        expect(rig.ui.recoveries[0].row).toBe(7)
        expect(rig.ui.recoveries[0].session).toBe(getStore2BootSession())
        const stale = firstBackend as unknown as Store2Backend
        const read = await stale.readCommit()
        await expect(stale.casCommit(read.token, new Uint8Array([1]))).rejects.toBeInstanceOf(Store2StalePageError)
    })
})

describe('new behaviour: a registration that times out after this boot already registered', () => {
    test('with a store2 commit key standing the page blocks by name and never falls back to the legacy store', async () => {
        const rig = tauriRig()
        rig.store.files.set(COMMIT_KEY, foreignMarker())
        rig.ui.foreignAnswer = 'clear'
        rig.gate.timeouts.add(2)
        // The main file exists, so a fall back to the legacy profile would be possible if the dispatch allowed it.
        const result = await rig.dispatch({ mainFile: true })
        expect(result).toEqual({ kind: 'stopped' })
        expect(rig.gate.registrations).toBe(2)
        expect(rig.ui.notices).toEqual([expect.objectContaining({ name: 'backend-unavailable' })])
        expect(rig.ui.blockedWith).toEqual([expect.objectContaining({ reason: 'store2-profile-unwritable' })])
        expect(rig.ui.recoveries).toEqual([])
        expect(getActiveStore2Save()).toBeNull()
        // The first round's boot re-flush of the marker and its clear are the only writes; the second round writes nothing.
        expect(rig.writes()).toEqual([COMMIT_KEY, COMMIT_KEY])
    })

    test('when this boot has written nothing and no store2 commit key exists, the legacy profile is handed back read-only', async () => {
        const rig = tauriRig()
        let lists = 0
        const list = rig.store.list.bind(rig.store)
        rig.store.list = async (prefix) => {
            const names = await list(prefix)
            lists += 1
            // A peer's unit appears between the two looks, so the marker is refused and the boot is classified again.
            if (lists === 2) {
                rig.store.files.set('store2/a-unit-a-peer-wrote', new Uint8Array([1]))
            }
            return names
        }
        rig.gate.timeouts.add(2)
        // The main file is not there for the first look and is there for the second.
        let asked = 0
        const result = await rig.dispatch({ mainFile: () => { asked += 1; return asked > 1 } })
        expect(result).toEqual({ kind: 'legacy-readonly', reason: 'backend-unavailable' })
        expect(rig.ui.notices).toEqual([expect.objectContaining({ name: 'backend-unavailable' })])
        expect(rig.writes()).toEqual([])
        expect(rig.store.files.has(COMMIT_KEY)).toBe(false)
    })
})
