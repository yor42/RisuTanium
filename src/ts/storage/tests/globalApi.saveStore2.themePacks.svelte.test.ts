/**
 * An installed theme pack through the real store2 save loop: the first `themePacks` assignment on a profile that lacks the
 * key is committed by the next pass (the real change effects and the explicit write hook mark it, as the app runs), the
 * committed config unit holds the records and the active id, the config asset list `al:config` holds the archive's literal
 * name, and the database a boot assembles from the same files has the records. An entry of a version this build cannot read
 * stays as it was across a later commit, and its asset names stay in the list.
 *
 * The loop is the real, unmocked `saveDb()` over a reactive `DBState` that carries the hook, in a world of its own
 * (`saveLoopWorld.ts`), as `globalApi.saveStore2.writeHook.svelte.test.ts` runs it, over an in-memory store2 backend with
 * the application's own list derivation. The database a boot assembles is `assembleDatabase` over that backend's units
 * (what `bootThroughDispatch` reads). A mocked success here is not evidence of native backend behaviour.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { h } from 'src/ts/storage/tests/saveLoopMocks.svelte'
import { createWorldKit, nextCommit, settled, sleepReal, type World } from 'src/ts/storage/tests/saveLoopWorld'
import { startStore2, store2Boot, type Store2Kit, type Store2StartOptions } from 'src/ts/storage/tests/store2SaveKit'
import { buildSmall } from 'src/ts/storage/tests/store2/codecFixtures'
import { listHolds } from 'src/ts/storage/tests/store2/listsFixtures'
import { createListDerivation } from 'src/ts/storage/store2/lists'
import { keyOfTail, readUnit, UNIT_TYPE, type AssetList, type Manifest } from 'src/ts/storage/store2/format'
import type { Database } from 'src/ts/storage/database.svelte'

vi.setConfig({ testTimeout: 40_000 })

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

const worlds = createWorldKit({
    parked: h.parked,
    getDb: () => h.db,
    setDb: (db) => { h.db = db },
    nextId: () => ++h.worldCount,
})

type Entry = Record<string, unknown>

beforeAll(() => {
    class FakeChannel {
        onmessage: ((event: { data: unknown }) => void) | null = null
        constructor(public name: string) { h.channels.push(this) }
        postMessage(data: unknown) { h.broadcasts.push(data) }
        close() {}
    }
    Object.defineProperty(window, 'BroadcastChannel', { value: FakeChannel, configurable: true, writable: true })
    Object.defineProperty(globalThis, 'BroadcastChannel', { value: FakeChannel, configurable: true, writable: true })
})

beforeEach(() => {
    vi.clearAllMocks()
    h.broadcasts.length = 0
    h.channels.length = 0
    // The real effects: `saveLoopMocks.svelte.ts` replaces them.
    vi.doUnmock('src/ts/storage/dbChangeEffects.svelte')
    // The root is a state proxy of the patched runtime, and the explicit write hook is installed over it as the app does.
    vi.doMock('src/ts/stores.svelte', async () => {
        const { proxy } = await import('svelte/internal/client')
        const { untrack } = await import('svelte')
        const { get, writable } = await import('svelte/store')
        const { installDbWriteHook } = await import('src/ts/storage/dbWriteHook')
        const DBState = proxy({ db: {} as Entry })
        const selectedCharID = writable(-1)
        installDbWriteHook(DBState, {
            selectedChaId: () => untrack(() => (DBState.db.characters as Entry[] | undefined)?.[get(selectedCharID)]?.chaId),
        })
        return {
            DBState,
            selectedCharID,
            selIdState: { selId: -1 },
            alertStore: writable({ type: 'none', msg: '' }),
            MobileGUI: writable(false),
            botMakerMode: writable(false),
            loadedStore: writable(false),
            LoadingStatusState: { text: '' },
            ReloadGUIPointer: writable(0),
            bodyIntercepterStore: writable(null),
            savingStoppedReason: writable(null),
            frozenSaveKeysStore: writable([]),
        } as unknown as typeof import('src/ts/stores.svelte')
    })
    vi.doMock('src/ts/process/coldstorage.svelte', async () => ({
        getColdStorageItem: vi.fn(),
        writeColdStorageUnit: async () => 'written',
        readColdStorageItem: async () => ({ status: 'missing' }),
    }))
    vi.spyOn(console, 'log').mockImplementation(() => { })
    vi.spyOn(console, 'warn').mockImplementation(() => { })
    vi.spyOn(console, 'error').mockImplementation(() => { })
    vi.spyOn(console, 'debug').mockImplementation(() => { })
})

afterEach(() => {
    worlds.parkAll()
    vi.doUnmock('src/ts/storage/svelteStatePatch')
    vi.doMock('src/ts/platform', () => ({ isTauri: false, isNodeServer: false, isIOS: () => false }))
    vi.restoreAllMocks()
})

interface Page {
    w: World
    k: Store2Kit
    db: Entry
    flush(): void
}

async function startPage(db: Database, options: Partial<Store2StartOptions> = {}): Promise<Page> {
    h.db = db as unknown as Entry
    const k = await startStore2({ db, lists: createListDerivation(), ...options })
    const w = await worlds.startWorld({ kind: 'tauri', startLoop: false, boot: store2Boot(k) })
    const stores = await import('src/ts/stores.svelte')
    const { flushSync } = await import('svelte')
    ;(stores.DBState as { db: unknown }).db = h.db
    h.db = (stores.DBState as { db: unknown }).db as Entry
    w.start()
    await sleepReal(150)
    return { w, k, db: h.db, flush: flushSync }
}

/** The asset list the current manifest names for the config unit (`al:config`). */
async function configAssetList(page: Page): Promise<AssetList> {
    const entries = page.k.memory.snapshot()
    const key = (await page.k.commitKey()).current?.key as string
    const manifest = readUnit(entries.get(key) as Uint8Array, UNIT_TYPE.manifest)
    if (manifest.status !== 'ok') {
        throw new Error(`The current manifest is ${manifest.status}.`)
    }
    const listKey = keyOfTail((manifest.value.body as Manifest).fixed.configAl[0])
    const list = readUnit(entries.get(listKey) as Uint8Array, UNIT_TYPE.assetList)
    if (list.status !== 'ok') {
        throw new Error(`The config asset list is ${list.status}.`)
    }
    return list.value.body as AssetList
}

const ARCHIVE = `assets/tp-${'ab'.repeat(32)}.risutheme`
const OTHER_ARCHIVE = `assets/tp-${'3c'.repeat(32)}.risutheme`

/** A stored record v1, the shape `installThemePack` emits. */
function record(id: string, archive = ARCHIVE): Entry {
    return {
        v: 1, id, packId: 'origin-navy', name: 'Origin Navy', version: '1.0.0', license: 'MIT', attribution: 'A. Author',
        modes: ['light', 'dark'], fonts: [{ file: 'fonts/a.woff2', license: 'OFL-1.1' }], archive, bytes: 4096, installedAt: 1_700_000_000_000,
    }
}

describe('a first themePacks key addition through the real store2 save loop', () => {
    test('T2-10c: the next pass commits the records and the active id, the config list holds the archive, and a boot assembles the records', async () => {
        const page = await startPage(buildSmall(2))
        await settled(page.w)
        expect(Object.hasOwn(page.db, 'themePacks')).toBe(false)
        expect((await configAssetList(page)).l).not.toContain(`tp-${'ab'.repeat(32)}.risutheme`)

        // The list alone first, so a pass that did not see the key addition cannot be hidden by the active id's own mark.
        await nextCommit(page.w, () => {
            page.db.themePacks = [record('pack-1')]
            page.flush()
        })
        await settled(page.w)
        const withList = (await page.k.saved()) as unknown as Entry
        expect(withList.themePacks).toEqual([record('pack-1')])
        expect(listHolds(await configAssetList(page), ARCHIVE)).toBe(true)

        await nextCommit(page.w, () => {
            page.db.activeThemePack = 'pack-1'
            page.flush()
        })
        await settled(page.w)

        const saved = (await page.k.saved()) as unknown as Entry
        expect(saved.themePacks).toEqual([record('pack-1')])
        expect(saved.activeThemePack).toBe('pack-1')
        expect(listHolds(await configAssetList(page), ARCHIVE)).toBe(true)
    })

    test('T2-10c: a later push of a second record is committed as well, and its archive joins the config list', async () => {
        const page = await startPage(buildSmall(2))
        await settled(page.w)
        await nextCommit(page.w, () => {
            page.db.themePacks = [record('pack-1')]
            page.flush()
        })

        await nextCommit(page.w, () => {
            ;(page.db.themePacks as Entry[]).push(record('pack-2', OTHER_ARCHIVE))
            page.flush()
        })
        await settled(page.w)

        const saved = (await page.k.saved()) as unknown as Entry
        expect((saved.themePacks as Entry[]).map((pack) => pack.id)).toEqual(['pack-1', 'pack-2'])
        const list = await configAssetList(page)
        expect(listHolds(list, ARCHIVE)).toBe(true)
        expect(listHolds(list, OTHER_ARCHIVE)).toBe(true)
    })

    test('T2-11: an entry of a version this build cannot read is kept as stored across a later commit, and its asset names stay listed', async () => {
        const unreadable = { v: 99, future: { a: { b: { c: { d: { e: [ARCHIVE, { n: 1 }] } } } } }, name: 'Next' }
        const page = await startPage(buildSmall(2))
        await settled(page.w)
        await nextCommit(page.w, () => {
            page.db.themePacks = [unreadable]
            page.flush()
        })

        await nextCommit(page.w, () => {
            ;(page.db.themePacks as Entry[]).push(record('pack-2', OTHER_ARCHIVE))
            page.flush()
        })
        await settled(page.w)

        const saved = (await page.k.saved()) as unknown as Entry
        const kept = saved.themePacks as Entry[]
        expect(kept[0]).toEqual(unreadable)
        expect(kept[1]).toEqual(record('pack-2', OTHER_ARCHIVE))
        const list = await configAssetList(page)
        expect(listHolds(list, ARCHIVE)).toBe(true)
        expect(listHolds(list, OTHER_ARCHIVE)).toBe(true)
    })
})
