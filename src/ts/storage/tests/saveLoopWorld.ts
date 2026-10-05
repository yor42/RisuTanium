/**
 * Test-only: boots the REAL, unmocked save loop (`saveDb()` in
 * `globalApi.svelte.ts`) over a block profile held by an in-memory store, in a
 * fresh module graph per "world". The suite that uses it registers the module
 * mocks of everything else `globalApi.svelte.ts` imports (`vi.mock` is per test
 * file) and gives this kit what only the suite owns: the database the loop
 * reads and the set of parked worlds.
 *
 * A world a test is done with is parked: its sleeps never resolve, so its loop
 * stops. A world closed with `closeWorld` also hangs its store, as a closed tab
 * does. A mocked success here is not evidence of native backend behaviour.
 */
import { vi } from 'vitest'
import { makeHeldStore, type HeldStore } from './saveLoopSupport'
import type { BlockStoreOwner } from 'src/ts/storage/blockStore'
import type { Database } from 'src/ts/storage/database.svelte'
import type { AppStoreKind } from 'src/ts/storage/store/appStore'

export interface WorldEnv {
    /** Ids of the worlds whose sleeps never resolve. */
    parked: Set<number>
    getDb(): Record<string, unknown> | undefined
    setDb(db: Record<string, unknown>): void
    nextId(): number
}

export type Crypto = 'secure' | 'insecure' | 'broken-digest'

export interface StartOptions {
    /** The persisted values of an earlier session: every key is planted before boot. */
    files?: Map<string, Uint8Array>
    crypto?: Crypto
    kind?: AppStoreKind
    /**
     * The profile is still the legacy main file: it holds the encoding of the
     * database, there is no head, and the page is in the `legacy` storage mode.
     */
    legacy?: boolean
    passCommitted?: boolean
    /** Replaces the boot: the store is seeded and the page mode is set by the caller. */
    boot?: (world: World) => Promise<void>
    /** Starts the save loop; a suite that needs to arrange the page first sets this to false. */
    startLoop?: boolean
    /**
     * A fresh module graph for this world (the default). A suite whose store
     * throws this file's own error classes (a Node-like store) runs one world
     * on the file's graph instead, and registers its own `sleep` mock.
     */
    isolate?: boolean
}

export interface World {
    id: number
    store: HeldStore
    owner: BlockStoreOwner
    api: typeof import('src/ts/globalApi.svelte')
    appStore: typeof import('src/ts/storage/store/appStore')
    marks: typeof import('src/ts/storage/characterSaveMarks')
    bootState: typeof import('src/ts/process/memory/idleReloadBootState')
    risuSave: typeof import('src/ts/storage/risuSave')
    pageMode: typeof import('src/ts/storage/pageStorageMode')
    blockStore: typeof import('src/ts/storage/blockStore')
    errors: typeof import('src/ts/storage/store/errors')
    start(): void
}

export const sleepReal = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export async function until(condition: () => boolean | Promise<boolean>, what: string, timeoutMs = 8000): Promise<void> {
    const start = performance.now()
    while (!(await condition())) {
        if (performance.now() - start > timeoutMs) {
            throw new Error(`timed out waiting for ${what}`)
        }
        await sleepReal(10)
    }
}

/** Waits until the loop reports clean and the store has been quiet for a moment. */
export async function settled(world: World): Promise<void> {
    let stableSince = performance.now()
    let seen = world.store.ops.length
    await until(() => {
        if (world.store.ops.length !== seen) {
            seen = world.store.ops.length
            stableSince = performance.now()
        }
        return world.api.isSaveClean() && performance.now() - stableSince > 120
    }, 'the save loop to go idle')
}

/** Runs `action` (a mark) and waits for the iteration it causes to commit, written or not, and for the loop to go idle. */
export async function nextCommit(world: World, action: () => void, waitForIdle = true): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('no save commit within 8 s')), 8000)
        world.api.afterNextSaveCommit(() => {
            clearTimeout(timer)
            resolve()
        })
        action()
    })
    if (waitForIdle) {
        await settled(world)
    }
}

export function createWorldKit(env: WorldEnv) {
    const realCrypto = globalThis.crypto
    let worlds: World[] = []

    function stubCrypto(mode: Crypto) {
        if (mode === 'secure') {
            vi.stubGlobal('crypto', realCrypto)
            return
        }
        vi.stubGlobal('crypto', {
            getRandomValues: (array: Uint8Array) => realCrypto.getRandomValues(array),
            randomUUID: () => realCrypto.randomUUID(),
            subtle: mode === 'insecure' ? undefined : { digest: async () => { throw new Error('digest unavailable') } },
        })
    }

    /** Frames a database as the legacy main file would hold it. */
    async function encodeMainFile(world: Pick<World, 'risuSave'>, db: Record<string, unknown>): Promise<Uint8Array> {
        const encoder = new world.risuSave.RisuSaveEncoder()
        await encoder.init(db as unknown as Database, { compression: false })
        await encoder.set(db as unknown as Database, { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false })
        return new Uint8Array(encoder.encode()!)
    }

    /** What boot does for a profile with a head: load it, strictly decoded, and install the decoded tree. */
    async function bootBlockProfile(world: World): Promise<void> {
        const { validateLoadedBlocks } = await import('src/ts/storage/blockProfileValidate')
        const loaded = await world.owner.load({ validate: validateLoadedBlocks })
        if (loaded.kind !== 'loaded') {
            throw new Error(`the block profile did not load: ${loaded.kind}`)
        }
        env.setDb(loaded.tree as unknown as Record<string, unknown>)
        world.pageMode.setPageStorageMode({ kind: 'block' })
    }

    /** Seeds a block profile of the database through a throwaway owner, as an earlier session left it. */
    async function seedBlockProfile(world: World): Promise<void> {
        const { makeOwner } = await import('./blockStoreHarness')
        const { treeToBlockSet } = await import('src/ts/storage/treeToBlockSet')
        const input = await treeToBlockSet(env.getDb() as unknown as Database)
        // Ids of their own: the harness module is loaded afresh with the world, and a profile seeded here must
        // not share a generation id with a peer a test builds from the harness the suite imported.
        const generationIds = {
            now: () => 1_600_000_000_000,
            randomBytes: (length: number) => {
                const out = new Uint8Array(length)
                new DataView(out.buffer).setUint32(0, 0xa0000001, false)
                return out
            },
        }
        const seeded = await makeOwner(world.store, { generationIds }).owner.replaceWholeState(input, { requireAbsentHead: true })
        if (seeded.kind !== 'won') {
            throw new Error(`the profile could not be seeded: ${seeded.kind}`)
        }
    }

    async function startWorld(options: StartOptions = {}): Promise<World> {
        stubCrypto(options.crypto ?? 'secure')
        // A page without Web Locks has no `navigator.locks` at all; the test environment answers null.
        if (navigator.locks == null) {
            Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true })
        }
        const id = env.nextId()
        if (options.isolate !== false) {
            // A mock registered per world, so that only this world's sleeps stop when it is parked.
            vi.doMock('src/ts/util', () => ({
                changeFullscreen: vi.fn(),
                checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
                sleep: vi.fn((ms: number) => env.parked.has(id)
                    ? new Promise<void>(() => {})
                    : new Promise<void>((resolve) => setTimeout(resolve, Math.min(ms, 5)))),
                sleepForever: vi.fn(() => new Promise<void>(() => {})),
            }))
            vi.resetModules()
        }
        const stores = await import('src/ts/stores.svelte')
        stores.frozenSaveKeysStore.set([])
        stores.savingStoppedReason.set(null)
        const api = await import('src/ts/globalApi.svelte')
        const appStore = await import('src/ts/storage/store/appStore')
        const marks = await import('src/ts/storage/characterSaveMarks')
        const bootState = await import('src/ts/process/memory/idleReloadBootState')
        const risuSave = await import('src/ts/storage/risuSave')
        const pageMode = await import('src/ts/storage/pageStorageMode')
        const blockStore = await import('src/ts/storage/blockStore')
        const errors = await import('src/ts/storage/store/errors')
        const pageOwner = await import('src/ts/storage/pageBlockOwner')

        const kind = options.kind ?? 'tauri'
        const store = makeHeldStore({ versioned: kind === 'node' })
        for (const [key, bytes] of options.files ?? []) {
            store.plant(key, bytes)
        }
        appStore.injectAppStore(store, kind)
        if (kind === 'node') {
            // The Node store presents the revision of a main-file read; this page reads it once, as a boot that
            // finds the legacy file does, so that a loop which still wrote that file would fail on what it
            // writes, not on a revision it never had.
            await appStore.readMainFile()
        }
        for (let earlier = 1; earlier < id; earlier++) {
            env.parked.add(earlier)
        }
        const owner = await pageOwner.getPageBlockOwner()
        // A page that runs from OPFS this time has no owner; a suite that asks for one gets a world without it.
        if (owner === null && kind !== 'opfs-transitional') {
            throw new Error('the page has no owner')
        }
        const world: World = {
            id, store, owner: owner as BlockStoreOwner, api, appStore, marks, bootState, risuSave, pageMode, blockStore, errors,
            start() {
                void api.saveDb()
            },
        }
        worlds.push(world)

        if (kind === 'opfs-transitional') {
            store.plant('database/database.bin', await encodeMainFile(world, env.getDb()!))
            pageMode.setPageStorageMode({ kind: 'read-only' })
        } else if (options.boot) {
            await options.boot(world)
        } else if (options.legacy) {
            const { fingerprintMainFile } = await import('src/ts/storage/mainFileFingerprint')
            const main = await encodeMainFile(world, env.getDb()!)
            store.plant('database/database.bin', main)
            pageMode.setPageStorageMode({ kind: 'legacy', convertedFrom: fingerprintMainFile(main) })
        } else {
            if (store.peek('blocks/head') === null) {
                await seedBlockProfile(world)
            }
            await bootBlockProfile(world)
        }
        bootState.noteBootPassCommitted(options.passCommitted === true)
        store.ops.length = 0
        if (options.startLoop !== false) {
            world.start()
            await sleepReal(150)
        }
        return world
    }

    /** Parks every world a test started; the next test starts from nothing. */
    function parkAll() {
        for (const world of worlds) {
            env.parked.add(world.id)
        }
        worlds = []
        vi.stubGlobal('crypto', realCrypto)
    }

    /** Parks a world and hangs its store, as a closed tab. */
    function closeWorld(world: World) {
        env.parked.add(world.id)
        world.store.dead = true
    }

    return { startWorld, parkAll, closeWorld, encodeMainFile, bootBlockProfile, seedBlockProfile, realCrypto }
}
