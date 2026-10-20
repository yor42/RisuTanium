// @vitest-environment node
/**
 * The development action of the sweep dry run (`store2/sweep/dryRunMeasure.ts`) and its install point in the maintenance
 * runner. The action exists only in a measurement build: with `MEASURE` false the runner installs nothing and loads nothing.
 *
 * What is a stand-in: `MEASURE` is a mocked module constant (a real normal build folds it at build time; the build output is
 * checked separately by `util/checkReleaseDist.mjs`), the session is a real `Store2Session.open` over a memory backend, and the
 * live resident sources are a double. The module does not exist on the red base (the W5b commit), so a file here fails at
 * import there, which proves nothing by itself; a "reproducer" is red under the mutant named in the hand-back.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const flag = vi.hoisted(() => ({ measure: true }))

vi.mock('src/ts/process/memory/measureFlag', () => ({
    get MEASURE() { return flag.measure },
}))
// The runner's default trigger drags in the whole save loop; every case here passes its own.
vi.mock(import('src/ts/process/memory/putBackQuiet'), () => ({
    startQuietTrigger: () => { throw new Error('The real quiet trigger is not used in this test.') },
}) as unknown as typeof import('src/ts/process/memory/putBackQuiet'))

import { createMemoryByteStore } from 'src/ts/process/files/tests/memoryByteStore'
import { resetPageStorageModeForTests, setPageStorageMode } from 'src/ts/storage/pageStorageMode'
import { createMemoryBackend } from 'src/ts/storage/store2/backend'
import { firstCommitKey } from 'src/ts/storage/store2/commitKey'
import { encodeUnit, UNIT_TYPE } from 'src/ts/storage/store2/format'
import { resetMaintenanceForTests, startStore2Maintenance, type MaintenanceEnv } from 'src/ts/storage/store2/maintenance'
import { Store2Session } from 'src/ts/storage/store2/session'
import { installSweepDryRunMeasure, type ResidentSources } from 'src/ts/storage/store2/sweep/dryRunMeasure'
import { createClock, seedStore, testEnv } from './commitFixtures'

const clock = createClock()
const env = testEnv(clock, 5)

const HANDLE = '__risuSweepDryRun'

function handleOn(target: object): unknown {
    return (target as Record<string, unknown>)[HANDLE]
}

const resident: ResidentSources = {
    residentRefs: () => [],
    writtenThisPage: () => [],
    residentInlays: async () => new Set(),
}

async function openReadySession() {
    const backend = createMemoryBackend()
    await seedStore(backend, env)
    const store = createMemoryByteStore()
    const session = await Store2Session.open(store, { kind: 'indexeddb', backend, upstreamMainFile: async () => false })
    return { session, store, backend }
}

async function settle(): Promise<void> {
    for (let i = 0; i < 20; i++) {
        await new Promise(resolve => setTimeout(resolve, 0))
    }
}

beforeEach(() => {
    flag.measure = true
    resetPageStorageModeForTests()
    resetMaintenanceForTests()
    setPageStorageMode({ kind: 'store2' })
    delete (globalThis as Record<string, unknown>)[HANDLE]
})

afterEach(() => {
    vi.restoreAllMocks()
    resetPageStorageModeForTests()
    resetMaintenanceForTests()
    delete (globalThis as Record<string, unknown>)[HANDLE]
})

describe('the action', () => {
    test('reproducer: run executes the dry run on the session, logs the report and returns it, and writes nothing', async () => {
        const { session, store } = await openReadySession()
        const log = vi.spyOn(console, 'log').mockImplementation(() => {})
        const target = {}
        const handle = installSweepDryRunMeasure({ session, store: async () => store, loadResident: async () => resident }, target)

        const report = await handle.run()

        expect(handleOn(target)).toBe(handle)
        expect(report.status === 'refused' || report.status === 'done' || report.status === 'failed').toBe(true)
        expect(log).toHaveBeenCalledTimes(1)
        expect(store.writes).toEqual([])
        expect(store.deletes).toEqual([])
    })

    test('guard: a run started while another is in progress joins it', async () => {
        const { session, store } = await openReadySession()
        vi.spyOn(console, 'log').mockImplementation(() => {})
        let loads = 0
        const handle = installSweepDryRunMeasure({
            session,
            store: async () => store,
            loadResident: async () => { loads++; return resident },
        }, {})

        const [first, second] = await Promise.all([handle.run(), handle.run()])

        expect(second).toBe(first)
        expect(loads).toBe(1)
    })
})

describe('the install point is compiled out when MEASURE is false', () => {
    const noStore: MaintenanceEnv = { store: async () => createMemoryByteStore(), listBackupTimes: async () => [] }
    const neverTrigger = () => ({ arm: () => {}, stop: () => {} })

    test('reproducer: with MEASURE true a store2 page gets the action', async () => {
        const { session } = await openReadySession()

        startStore2Maintenance(noStore, { session: () => session, startTrigger: neverTrigger })
        await settle()

        expect(handleOn(globalThis)).toBeDefined()
    })

    test('reproducer: with MEASURE false the runner installs no action on the same page', async () => {
        flag.measure = false
        const { session } = await openReadySession()

        startStore2Maintenance(noStore, { session: () => session, startTrigger: neverTrigger })
        await settle()

        expect(handleOn(globalThis)).toBeUndefined()
    })

    test('guard: a page that is not a store2 page gets no action either way', async () => {
        resetPageStorageModeForTests()
        setPageStorageMode({ kind: 'legacy', convertedFrom: null })
        const { session } = await openReadySession()

        startStore2Maintenance(noStore, { session: () => session, startTrigger: neverTrigger })
        await settle()

        expect(handleOn(globalThis)).toBeUndefined()
    })

    test('guard: a boot that installed the profile still gets the action, and installing it writes nothing', async () => {
        const backend = createMemoryBackend()
        const key = firstCommitKey({ current: null, staging: null, manifests: [] }, env)
        await backend.casCommit((await backend.readCommit()).token, encodeUnit(UNIT_TYPE.commit, key))
        const store = createMemoryByteStore()
        const session = await Store2Session.open(store, { kind: 'indexeddb', backend, upstreamMainFile: async () => false })
        vi.spyOn(console, 'log').mockImplementation(() => {})

        startStore2Maintenance({ store: async () => store, listBackupTimes: async () => [] }, { session: () => session, startTrigger: neverTrigger })
        await settle()

        expect(handleOn(globalThis)).toBeDefined()
        expect(store.writes).toEqual([])
    })
})
