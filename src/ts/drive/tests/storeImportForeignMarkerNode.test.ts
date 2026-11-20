// @vitest-environment node
/**
 * The precondition check of a page import on a Node page asks about another operation's bulk marker instead of refusing
 * it: the real `server/node/server.cjs` (a child process) behind `createNodeHttpStore`, the production committer of the
 * page, and a second production committer that leaves the marker through `openHeldBulk`. The page session is a double
 * that carries only the three members the check reads; the question is the `ask` option the test answers. A pass says
 * nothing about a browser, the dialog's wording or several devices.
 *
 * Labels: T-Q1 is the regression reproducer (the option was ignored and a Node page refused `foreign-marker` with the
 * marker standing); T-Q2, T-Q3 and T-Q4 are guards, each naming the scratch mutant it turns red on.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'

vi.hoisted(() => {
    const memory = new Map<string, string>()
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: {
            getItem: (key: string) => memory.get(key) ?? null,
            setItem: (key: string, value: string) => { memory.set(key, String(value)) },
            removeItem: (key: string) => { memory.delete(key) },
            clear: () => memory.clear(),
            key: (index: number) => Array.from(memory.keys())[index] ?? null,
            get length() { return memory.size },
        },
    })
})

const h = vi.hoisted(() => ({
    permissive: (): Record<string, unknown> => new Proxy({} as Record<string, unknown>, {
        get: (_target, key) => (key === 'then' ? undefined : vi.fn()),
        has: () => true,
    }),
    errors: [] as string[],
}))

vi.mock('localforage', () => ({ default: { createInstance: () => ({ getItem: vi.fn(async () => null), setItem: vi.fn(async () => { }), removeItem: vi.fn(async () => { }), keys: vi.fn(async () => []) }) } }))
vi.mock(import('src/ts/platform'), () => ({ isTauri: false, isNodeServer: true, isIOS: () => false }) as unknown as typeof import('src/ts/platform'))
vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: {} },
    selectedCharID: writable(-1),
    selIdState: { selId: -1 },
    alertStore: writable({ type: 'none', msg: '' }),
    MobileGUI: writable(false),
    botMakerMode: writable(false),
    loadedStore: writable(false),
    LoadingStatusState: { text: '' },
    ReloadGUIPointer: writable(0),
    bodyIntercepterStore: writable(null),
    savingStoppedReason: writable(null),
}) as unknown as typeof import('src/ts/stores.svelte'))
vi.mock(import('src/ts/globalApi.svelte'), () => h.permissive() as unknown as typeof import('src/ts/globalApi.svelte'))
vi.mock(import('src/ts/drive/backupWorkGuard'), () => h.permissive() as unknown as typeof import('src/ts/drive/backupWorkGuard'))
vi.mock(import('src/ts/alert'), () => new Proxy(h.permissive(), {
    get: (target, key) => (key === 'alertError' ? (message: string) => { h.errors.push(message) } : target[key as string]),
    has: () => true,
}) as unknown as typeof import('src/ts/alert'))
vi.mock(import('src/ts/process/coldstorage.svelte'), () => h.permissive() as unknown as typeof import('src/ts/process/coldstorage.svelte'))
vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({})),
    setDatabase: vi.fn(),
    presetTemplate: { name: 'test-preset' },
    defaultSdDataFunc: vi.fn(() => ({})),
    appVer: 'test',
    appSubVer: 'test',
    getCurrentCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))
vi.mock(import('src/ts/model/modellist'), () => ({ getModelInfo: vi.fn() }) as unknown as typeof import('src/ts/model/modellist'))
vi.mock(import('src/ts/characters'), () => ({ updateLorebooks: vi.fn((v: unknown) => v) }) as unknown as typeof import('src/ts/characters'))
vi.mock('@tauri-apps/api/core', () => h.permissive())
vi.mock('@tauri-apps/plugin-os', () => h.permissive())
vi.mock('@tauri-apps/plugin-fs', () => h.permissive())
vi.mock('@tauri-apps/plugin-dialog', () => h.permissive())

import { language } from 'src/lang'
import { createNodeBackend, type Store2Backend } from 'src/ts/storage/store2/backend'
import { createNodeHttpStore } from 'src/ts/storage/store/nodeHttpStore'
import { createCommitter, type Committer, type HeldBulk } from 'src/ts/storage/store2/commit'
import { setStore2BootSession } from 'src/ts/storage/store2/bootActive'
import { freshOwnerId, type Staging } from 'src/ts/storage/store2/owner'
import type { StagingLabel } from 'src/ts/storage/store2/format'
import type { Store2Session } from 'src/ts/storage/store2/session'
import type { Database } from 'src/ts/storage/database.svelte'
import { createClock, seedTree, testEnv } from 'src/ts/storage/tests/store2SaveKit'
import { makeDb } from 'src/ts/storage/tests/saveLoopSupport'
import { parsedCommit } from 'src/ts/storage/tests/store2/commitFixtures'
import { startNodeServer, type NodeServerFixture } from 'src/ts/storage/tests/nodeServerFixture'
import { askToClearForeignMarker, checkStore2Import } from 'src/ts/drive/storeImport'

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

interface NodeWorld {
    fixture: NodeServerFixture
    backend: Store2Backend
    /** The importing page's committer. */
    page: Committer
    /** Another origin's committer over the same server. */
    peer: Committer
    /** A third origin's committer. */
    third: Committer
}

let world: NodeWorld | null = null

beforeEach(async () => {
    h.errors.length = 0
    helds.clear()
    vi.spyOn(console, 'error').mockImplementation(() => { })
    const fixture = await startNodeServer()
    const store = createNodeHttpStore({ baseUrl: fixture.baseUrl, authHeader: () => fixture.authHeader() })
    const backend = createNodeBackend(store)
    const clock = createClock()
    await seedTree(backend, makeDb('base', ['alpha', 'beta']) as unknown as Database, testEnv(clock, 4242))
    world = {
        fixture,
        backend,
        page: createCommitter(backend, { owner: freshOwnerId(testEnv(clock, 1)), env: testEnv(clock, 777) }),
        peer: createCommitter(backend, { owner: freshOwnerId(testEnv(clock, 2)), env: testEnv(clock, 888) }),
        third: createCommitter(backend, { owner: freshOwnerId(testEnv(clock, 3)), env: testEnv(clock, 999) }),
    }
    // The check reads the committer, the backend and the store kind from the page's boot session and nothing else.
    setStore2BootSession({ kind: 'node', committer: world.page, backend } as unknown as Store2Session)
})

afterEach(async () => {
    setStore2BootSession(null)
    vi.restoreAllMocks()
    await world?.fixture.stop()
    world = null
})

function node(): NodeWorld {
    if (world === null) {
        throw new Error('The world is not open.')
    }
    return world
}

const stagingOf = async (): Promise<Staging | null> => (await parsedCommit(node().backend)).staging

/** Leaves a marker of `label` standing, as an operation of another origin that is still running (or died) would. */
async function leaveMarker(by: Committer, label: StagingLabel): Promise<Staging> {
    const opened = await by.openHeldBulk?.(await by.readCommit(), { label })
    expect(opened?.status).toBe('opened')
    const marker = await stagingOf()
    expect(marker?.label).toBe(label)
    expect(marker?.owner).toBe(by.owner)
    if (opened?.status === 'opened') {
        helds.set(by, opened.held)
    }
    return marker as Staging
}

/** The handle of the marker each committer last opened, to end that operation the way its owner would. */
const helds = new Map<Committer, HeldBulk>()

describe('a foreign import, restore or bulk marker on a Node page is put to the person', () => {
    test.each(['import', 'restore', 'bulk'] as const)('T-Q1: Clear on a %s marker makes the check ready and removes the marker (regression reproducer: the option was ignored and the check refused foreign-marker)', async (label) => {
        const { peer, page, backend } = node()
        const marker = await leaveMarker(peer, label)
        const asked: Staging[] = []
        const check = await checkStore2Import({ ask: async (standing) => { asked.push(standing); return 'clear' } })
        expect(check).toEqual({ kind: 'ready', target: { committer: page, backend } })
        expect(asked).toEqual([marker])
        expect(await stagingOf()).toBeNull()
        expect(h.errors).toEqual([])
    })

    test('T-Q2: Wait refuses foreign-marker with no error text, because the question replaced it, and the marker stands (guard; MQ2 fails it)', async () => {
        const { peer } = node()
        const marker = await leaveMarker(peer, 'restore')
        const ask = vi.fn(async (_standing: Staging): Promise<'wait' | 'clear'> => 'wait')
        expect(await checkStore2Import({ ask })).toEqual({ kind: 'refused', cause: 'foreign-marker' })
        expect(ask).toHaveBeenCalledTimes(1)
        expect(h.errors).toEqual([])
        expect(await stagingOf()).toEqual(marker)
    })

    test.each(['convert', 'seed', 'recovery'] as const)('T-Q3: a %s marker is never asked about: the check refuses with the marker message and the marker stands (compatibility guard; passes before the change; MQ3 fails it)', async (label) => {
        const { peer } = node()
        const marker = await leaveMarker(peer, label)
        const ask = vi.fn(async (_standing: Staging): Promise<'wait' | 'clear'> => 'clear')
        expect(await checkStore2Import({ ask })).toEqual({ kind: 'refused', cause: 'foreign-marker' })
        expect(ask).not.toHaveBeenCalled()
        expect(h.errors).toEqual([language.store2RestoreBulkMarker])
        expect(await stagingOf()).toEqual(marker)
    })

    test('T-Q4: consent covers exactly the marker that was asked about: if another marker replaced it while the question was open, that one stays and the check refuses (guard of the commit\'s own re-judge, which refuses a marker other than the asked one)', async () => {
        const { peer, third } = node()
        const asked = await leaveMarker(peer, 'restore')
        let replacement: Staging | null = null
        const check = await checkStore2Import({
            ask: async (standing) => {
                expect(standing).toEqual(asked)
                // The asked marker's owner finishes, and a third operation starts its own marker.
                const held = helds.get(peer)
                expect(held).toBeDefined()
                expect((await peer.clearHeld?.(held as HeldBulk))?.status).toBe('cleared')
                replacement = await leaveMarker(third, 'import')
                return 'clear'
            },
        })
        expect(check).toEqual({ kind: 'refused', cause: 'foreign-marker' })
        expect(replacement).not.toBeNull()
        expect(await stagingOf()).toEqual(replacement)
        expect(h.errors).toEqual([language.store2RestoreBulkMarker])
    })

    test('T-Q4b: the helper judges the marker the read carries against the marker that was asked about: a different marker on the read is kept, not cleared (guard; MQ4 fails it)', async () => {
        const { peer, page } = node()
        const standing = await leaveMarker(peer, 'bulk')
        const asked: Staging = { ...standing, prefix: `${standing.prefix}other` }
        expect(await askToClearForeignMarker(page, await page.readCommit(), asked, async () => 'clear')).toBe('kept')
        expect(await stagingOf()).toEqual(standing)
    })
})
