/**
 * The live facts of the automatic clean-up (`loadLiveFacts` in `gc/autoGc.ts`): the runner loads the page's own modules for
 * its stop rule, the sole-tab proof and the own-base fact, and hands them to the pass. The heavy modules with page-level
 * state (`globalApi.svelte`, the save loop) are doubles whose answers each case sets; `busyActions` and `restoreInProgress`
 * are the real ones, so an open restore run is the page's own signal, not a flag of the test. `navigator` is stubbed per
 * case with a lock manager whose query answers what the case sets.
 *
 * Over a `node` session (one Node world: the semantic store and the backend over it, with the aged dependencies) or a `tauri`
 * session on a seeded backend that holds 30 orphans. A Node pass is aged, so its first pass records and deletes nothing; a
 * run that is not refused and reports its age phase is what shows the page facts let the pass go. A mocked lock manager says
 * nothing about a browser's.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// The first case loads the real application modules cold; under a loaded full run that alone can pass the default.
vi.setConfig({ testTimeout: 60_000 })

const page = vi.hoisted(() => ({
    realNavigator: globalThis.navigator as Navigator,
    ownPresence: true,
    saveClean: true,
    parked: false,
    ownBase: null as string | null,
}))

// The module-load lock instance of the real `globalApi.svelte` asks for its presence lock at evaluation; the request
// never settles, so no case depends on a granted lock.
vi.hoisted(() => {
    const real = globalThis.navigator
    const locks = { query: async () => ({ held: [], pending: [] }), request: () => new Promise(() => { }) }
    vi.stubGlobal('navigator', new Proxy(real, { get: (target, prop) => prop === 'locks' ? locks : Reflect.get(target, prop, target) }))
})
vi.mock(import('src/ts/globalApi.svelte'), async importOriginal => ({
    ...await importOriginal(),
    holdsOwnTabPresence: () => page.ownPresence,
    isSaveClean: () => page.saveClean,
}))
vi.mock('../../../translator/translator', () => ({}))
vi.mock('../../../parser/parser.svelte', () => ({ risuChatParser: vi.fn() }))
vi.mock('../../../process/modules', () => ({ moduleUpdate: vi.fn() }))
vi.mock(import('src/ts/storage/store2/saveLoop'), () => ({
    isSaveLoopParked: () => page.parked,
    acknowledgedManifestKey: () => page.ownBase,
}) as unknown as typeof import('src/ts/storage/store2/saveLoop'))
vi.mock(import('src/ts/drive/storeImport'), () => ({
    noteImportPhase: () => { },
}) as unknown as typeof import('src/ts/drive/storeImport'))

import { createMemoryByteStore } from 'src/ts/process/files/tests/memoryByteStore'
import { beginRestoreRun } from 'src/ts/drive/restoreInProgress'
import { resetPageStorageModeForTests, setPageStorageMode } from 'src/ts/storage/pageStorageMode'
import type { ByteStore } from 'src/ts/storage/store/contract'
import { createMemoryBackend, type Store2Backend } from 'src/ts/storage/store2/backend'
import { classifyCommitRead } from 'src/ts/storage/store2/commitKey'
import { encodeUnit, newUnitKey, UNIT_TYPE } from 'src/ts/storage/store2/format'
import { runAutoGc } from 'src/ts/storage/store2/gc/autoGc'
import type { GcResult } from 'src/ts/storage/store2/gc/pass'
import { Store2Session } from 'src/ts/storage/store2/session'
import { STORAGE_TAB_LOCK_NAME } from 'src/ts/storage/storageTabLocks'
import type { Database } from 'src/ts/storage/database.svelte'
import { createClock, seedTree, testEnv } from 'src/ts/storage/tests/store2SaveKit'
import { flushConfirming, nodeWorld } from './flushConfirmBackend'

const env = testEnv(createClock(), 77)
const SHARED = { name: STORAGE_TAB_LOCK_NAME, mode: 'shared' }

interface Opened {
    session: Store2Session
    memory: Store2Backend
    /** The page's byte store: the Node world's for a node session, none for a tauri one. */
    store: ByteStore | undefined
    orphans: string[]
    base: string
}

async function open(kind: 'node' | 'tauri'): Promise<Opened> {
    const world = kind === 'node' ? nodeWorld() : null
    const memory = world?.backend ?? createMemoryBackend()
    const db = {
        formatversion: 5, botPresetsId: 0, botPresets: [{ name: 'test-preset' }], modules: [], loadouts: [], plugins: [],
        pluginCustomStorage: {}, mainPrompt: 'live', characters: [],
    }
    await seedTree(memory, db as unknown as Database, env)
    const orphans: string[] = []
    for (let i = 0; i < 30; i++) {
        const key = newUnitKey(env)
        await memory.putUnit(key, encodeUnit(UNIT_TYPE.preset, { v: 1, orphan: key }))
        orphans.push(key)
    }
    const parsed = classifyCommitRead(await memory.readCommit())
    if (parsed.status !== 'parsed' || parsed.value.current === null) {
        throw new Error('The seeded store has no current manifest.')
    }
    const session = world === null
        ? await Store2Session.open(createMemoryByteStore(), { kind, backend: flushConfirming(memory).backend, upstreamMainFile: async () => false })
        : await Store2Session.open(world.store, { kind, backend: memory, upstreamMainFile: async () => false })
    expect(session.decision, 'the page boots normally on its seeded profile').toMatchObject({ mode: 'normal' })
    return { session, memory, store: world?.store, orphans, base: parsed.value.current.key }
}

async function left(opened: Opened): Promise<number> {
    const read = await opened.memory.readUnits(opened.orphans)
    return opened.orphans.filter(key => read.get(key) !== null).length
}

function stubLocks(query: () => Promise<{ held: unknown[], pending: unknown[] }>): void {
    stubNavigatorLocks({ query, request: () => new Promise(() => { }) })
}

/** The page's navigator with only locks replaced, so the application modules still read their user agent. */
function stubNavigatorLocks(locks: unknown): void {
    vi.stubGlobal('navigator', new Proxy(page.realNavigator, { get: (target, prop) => prop === 'locks' ? locks : Reflect.get(target, prop, target) }))
}

async function run(opened: Opened): Promise<GcResult | null> {
    return await runAutoGc(opened.session, undefined, opened.store)
}

beforeEach(() => {
    page.ownPresence = true
    page.saveClean = true
    page.parked = false
    page.ownBase = null
    resetPageStorageModeForTests()
    setPageStorageMode({ kind: 'store2' })
    vi.spyOn(console, 'info').mockImplementation(() => { })
})

afterEach(() => {
    vi.restoreAllMocks()
    resetPageStorageModeForTests()
})

describe('the live facts of the clean-up pass', () => {
    test('reproducer (a): an open restore run on the app stops the pass before its first delete', async () => {
        const opened = await open('tauri')
        const restore = beginRestoreRun()
        try {
            expect(await run(opened)).toEqual({ status: 'done', deleted: 0, batches: 0, stopped: 'yielded' })
        } finally {
            restore.end('nothing-replaced')
        }
        expect(await left(opened)).toBe(30)
    })

    test('guard (d): one presence holder, the own claim true and the own base the current lets the aged pass run: it records all 30 orphans and is neither refused nor stopped', async () => {
        const opened = await open('node')
        stubLocks(async () => ({ held: [SHARED], pending: [] }))
        page.ownBase = opened.base

        const result = await run(opened)

        expect(result).toMatchObject({ status: 'done', deleted: 0, age: { phase: 'recorded', candidates: 30, recordedItems: 30 } })
        expect(result).not.toHaveProperty('stopped')
        expect(await left(opened)).toBe(30)
    })

    test('reproducer (b): a page whose own presence claim is false refuses other-tab', async () => {
        const opened = await open('node')
        stubLocks(async () => ({ held: [SHARED], pending: [] }))
        page.ownBase = opened.base
        page.ownPresence = false

        expect(await run(opened)).toMatchObject({ status: 'refused', reason: 'other-tab' })
        expect(await left(opened)).toBe(30)
    })

    test('reproducer (e): no presence holder in the snapshot, with the own claim true, refuses other-tab', async () => {
        const opened = await open('node')
        stubLocks(async () => ({ held: [], pending: [] }))
        page.ownBase = opened.base

        expect(await run(opened)).toMatchObject({ status: 'refused', reason: 'other-tab' })
        expect(await left(opened)).toBe(30)
    })

    test.each([
        ['locks undefined (plain HTTP)', undefined],
        ['locks null (a test host)', null],
    ])('guard (c): %s does not refuse a Node page (the age bounds the unproven reader), read at call time and not from a support flag', async (_name, locks) => {
        const opened = await open('node')
        stubNavigatorLocks(locks)
        page.ownBase = opened.base

        const result = await run(opened)

        expect(result).toMatchObject({ status: 'done', deleted: 0, age: { phase: 'recorded', candidates: 30 } })
        expect(result).not.toHaveProperty('stopped')
        expect(await left(opened)).toBe(30)
    })

    test('guard (f): an own base that is not the commit key\'s current refuses stale-base', async () => {
        const opened = await open('node')
        stubLocks(async () => ({ held: [SHARED], pending: [] }))
        page.ownBase = 'not-the-current-manifest'

        expect(await run(opened)).toMatchObject({ status: 'refused', reason: 'stale-base' })
        expect(await left(opened)).toBe(30)
    })

    test('guard (g): no settled own base (null) refuses stale-base', async () => {
        const opened = await open('node')
        stubLocks(async () => ({ held: [SHARED], pending: [] }))
        page.ownBase = null

        expect(await run(opened)).toMatchObject({ status: 'refused', reason: 'stale-base' })
        expect(await left(opened)).toBe(30)
    })
})
