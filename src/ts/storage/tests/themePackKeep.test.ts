// @vitest-environment happy-dom

/**
 * The keep-set side of an installed theme pack (layout A: one stored archive per pack). A record under
 * `Database.themePacks` names its archive as `assets/tp-<sha256>.risutheme`; every collector that decides which asset
 * files stay must keep it: `getUncleanablesSync` (the boot sweeps, the manual clean-up) and `collectConfigAssets` (the
 * store2 config list and the keep-set built from retained manifests). A record is read by the walker whatever its version
 * or shape, so an entry this build cannot read still keeps its files.
 *
 * Every record here is written inline, in the shape `installThemePack` emits, and this file imports only modules that
 * exist without the pack feature, except the one row that needs `removeThemePackAt` (loaded by a variable specifier).
 * The record-and-sweep rows drive the real `buildAssetKeepSet`, the real `sweepTauriAssets` / `sweepForageAssetKey` and
 * the real manual clean-up over a key/value page store. A mocked success here is not evidence of native backend
 * behaviour. Titles beginning "guard:" pass with or without the change they name; every other row is a regression
 * reproducer.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from 'src/ts/storage/database.svelte'
import { FakeLockManagerCore, FakeTabLockManagerView } from './fakeWebLocks'
import { createForageBackedStore, type ForageLike } from './forageBackedStore'
import { sweepForageAssetKey, sweepTauriAssets } from 'src/ts/storage/assetSweep'
import { deriveConfigAssets } from 'src/ts/storage/store2/lists'
import { buildClosureAssetKeepSet } from 'src/ts/storage/store2/sweep'
import { commitKeyOf, listHolds, Tree } from './store2/sweepFixtures'
import {
    assetOrInlayBodyKeyViolation, indexedDbAddressableViolation, indexedDbCreatableViolation, nodeAddressableViolation,
    nodeAssetRouteViolation, nodeCreatableViolation, tauriAddressableViolation, tauriCreatableViolation, NODE_MAX_WRITE_KEY_BYTES,
    utf8ByteLength,
} from 'src/ts/storage/store/keyRules'

//#region shared platform state

type AlertRecord = { type: string, msg: string }

const h = vi.hoisted(() => {
    const hub = {
        current: { type: 'none', msg: '' } as AlertRecord,
        set(value: AlertRecord) { hub.current = value },
        update(fn: (value: AlertRecord) => AlertRecord) { hub.set(fn(hub.current)) },
        subscribe(fn: (value: AlertRecord) => void) { fn(hub.current); return () => { } },
    }
    return {
        platform: { isTauri: false, isNodeServer: false },
        hub,
        /** The key/value store behind `forageStorage` on the web build. */
        forage: new Map<string, Uint8Array>(),
        onRemove: undefined as undefined | ((key: string) => void),
        dbHolder: { state: undefined as undefined | { db: unknown } },
    }
})

//#endregion

//#region module mocks (the platform boundaries only; the sweep, the keep-set and the clean-up are real)

vi.mock('localforage', () => ({
    default: { createInstance: () => ({ getItem: vi.fn(async () => null), setItem: vi.fn(async () => { }), removeItem: vi.fn(async () => { }) }) },
}))

vi.mock(import('src/ts/platform'), () => ({
    get isTauri() { return h.platform.isTauri },
    get isNodeServer() { return h.platform.isNodeServer },
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => {
        if (!h.dbHolder.state) {
            throw new Error('no live database in tests')
        }
        return h.dbHolder.state.db
    }),
    setDatabase: vi.fn(),
    presetTemplate: { name: 'test-preset' },
    defaultSdDataFunc: vi.fn(() => ({})),
    appVer: 'test',
    appSubVer: 'test',
    getCurrentCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = { db: {} as unknown as Database }
    h.dbHolder.state = state
    return {
        DBState: state,
        selectedCharID: writable(-1),
        selIdState: { state: -1 },
        alertStore: h.hub,
        MobileGUI: writable(false),
        botMakerMode: writable(false),
        loadedStore: writable(false),
        LoadingStatusState: { text: '' },
        ReloadGUIPointer: writable(0),
        bodyIntercepterStore: writable(null),
        savingStoppedReason: writable(null),
        CharEmotion: writable({}),
        MobileGUIStack: writable([]),
        OpenRealmStore: writable(false),
        frozenSaveKeysStore: writable([]),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/storage/pageBlockOwner'), () => ({
    getPageBlockOwner: async () => null,
    resetPageBlockOwnerForTests: () => { },
}) as unknown as typeof import('src/ts/storage/pageBlockOwner'))

vi.mock(import('src/ts/process/index.svelte'), () => ({
    doingChat: writable(false),
}) as unknown as typeof import('src/ts/process/index.svelte'))

vi.mock(import('src/ts/alert'), () => ({
    alertClear: vi.fn(),
    alertConfirm: vi.fn(async () => true),
    alertError: vi.fn(),
    alertWait: vi.fn((msg: string) => ({ type: 'wait', msg })),
    alertMd: vi.fn(),
    alertNormal: vi.fn(),
    alertSelect: vi.fn(),
    alertToast: vi.fn(),
    alertInput: vi.fn(),
    alertNormalWait: vi.fn(),
    alertAddCharacter: vi.fn(),
    alertStore: h.hub,
    waitAlert: vi.fn(async () => { }),
    doingAlert: vi.fn(() => false),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/util'), () => ({
    changeFullscreen: vi.fn(),
    checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
    sleep: vi.fn(async () => { }),
    sleepForever: vi.fn(async () => { }),
    base64url: (source: Uint8Array | ArrayBuffer) => Buffer.from(source as Uint8Array).toString('base64url'),
    getKeypairStore: vi.fn(async () => { throw new Error('no keypair in tests') }),
    saveKeypairStore: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/util'))

vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: vi.fn((p: string) => p), invoke: vi.fn(async () => { throw new Error('no native backend in tests') }) }))
vi.mock('@tauri-apps/api/path', () => ({
    appDataDir: vi.fn(async () => '/appdata'),
    join: vi.fn(async (...p: string[]) => p.join('/')),
    basename: vi.fn(async (p: string) => p.split('/').pop()),
}))
vi.mock('@tauri-apps/plugin-shell', () => ({ open: vi.fn(async () => { }) }))
vi.mock('src/ts/vendor/streamSaver', () => ({ default: { useBlobFallback: false, createWriteStream: () => ({}) } }))
vi.mock('@tauri-apps/api/webviewWindow', () => ({ getCurrentWebviewWindow: vi.fn(() => ({ listen: vi.fn(), setTitle: vi.fn() })) }))
vi.mock(import('src/ts/update'), () => ({ checkRisuUpdate: vi.fn(async () => { }) }))
vi.mock(import('src/ts/plugins/plugins.svelte'), () => ({ loadPlugins: vi.fn(async () => { }) }) as unknown as typeof import('src/ts/plugins/plugins.svelte'))
vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    hasher: vi.fn((s: string) => s),
    parseMarkdownSafe: vi.fn((s: string) => s),
}) as unknown as typeof import('src/ts/parser/parser.svelte'))
vi.mock(import('src/ts/characterCards'), () => ({
    characterURLImport: vi.fn(),
    hubURL: 'https://example.invalid',
    importCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/characterCards'))
vi.mock(import('src/ts/storage/dbChangeEffects.svelte'), () => ({ registerDbChangeEffects: vi.fn() }) as unknown as typeof import('src/ts/storage/dbChangeEffects.svelte'))
vi.mock(import('src/ts/storage/autoStorage'), () => ({
    AutoStorage: class {
        realStorage: undefined = undefined
        async Init() { }
        async getItem(key: string) { return h.forage.get(key) ?? null }
        async setItem(key: string, value: Uint8Array) { h.forage.set(key, value) }
        async keys() { return Array.from(h.forage.keys()) }
        async removeItem(key: string) {
            h.onRemove?.(key)
            h.forage.delete(key)
        }
    },
}) as unknown as typeof import('src/ts/storage/autoStorage'))
vi.mock(import('src/ts/gui/animation'), () => ({ updateAnimationSpeed: vi.fn() }) as unknown as typeof import('src/ts/gui/animation'))
vi.mock(import('src/ts/gui/colorscheme'), () => ({ updateColorScheme: vi.fn(), updateTextThemeAndCSS: vi.fn() }) as unknown as typeof import('src/ts/gui/colorscheme'))
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn(async () => null) }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => vi.fn()) }))
vi.mock(import('src/ts/observer.svelte'), () => ({ startObserveDom: vi.fn() }) as unknown as typeof import('src/ts/observer.svelte'))
vi.mock(import('src/ts/gui/guisize'), () => ({ updateGuisize: vi.fn() }) as unknown as typeof import('src/ts/gui/guisize'))
vi.mock(import('src/ts/characters'), () => ({ updateLorebooks: vi.fn((v: unknown) => v) }) as unknown as typeof import('src/ts/characters'))
vi.mock(import('src/ts/hotkey'), () => ({ initMobileGesture: vi.fn() }) as unknown as typeof import('src/ts/hotkey'))
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn(async () => new Response(null, { status: 404 })) }))
vi.mock(import('src/ts/process/modules'), () => ({ moduleUpdate: vi.fn(async () => { }) }) as unknown as typeof import('src/ts/process/modules'))
vi.mock('@tauri-apps/plugin-fs', () => ({
    BaseDirectory: { AppData: 0 },
    readDir: vi.fn(async () => []),
    readFile: vi.fn(async () => { throw new Error('No such file (os error 2)') }),
    writeFile: vi.fn(async () => { }),
    rename: vi.fn(async () => { }),
    remove: vi.fn(async () => { }),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(async () => { }),
}))

//#endregion

import { buildAssetKeepSet, getBasename, getUncleanablesSync } from 'src/ts/globalApi.svelte'

//#region fixtures

type Slot = Record<string, unknown>

const HEX_PACK = 'ab'.repeat(32)
const HEX_OTHER = '3c'.repeat(32)
const PACK_ARCHIVE = `assets/tp-${HEX_PACK}.risutheme`
const PACK_BASENAME = `tp-${HEX_PACK}.risutheme`
const OTHER_ARCHIVE = `assets/tp-${HEX_OTHER}.risutheme`
const OTHER_BASENAME = `tp-${HEX_OTHER}.risutheme`

/** A stored record v1, the shape `installThemePack` emits (T2-9 in install.svelte.test.ts pins the equality). */
function packRecord(archive: string = PACK_ARCHIVE, id = 'pack-1'): Slot {
    return {
        v: 1, id, packId: 'origin-navy', name: 'Origin Navy', version: '1.0.0', license: 'MIT', attribution: 'A. Author',
        modes: ['light', 'dark'], fonts: [{ file: 'fonts/a.woff2', license: 'OFL-1.1' }], archive, bytes: 4096, installedAt: 1_700_000_000_000,
    }
}

function dbOf(themePacks: unknown, extra: Slot = {}): Database {
    return { characters: [], modules: [], personas: [], characterOrder: [], customBackground: '', userIcon: '', themePacks, ...extra } as unknown as Database
}

function dbWithoutPacks(): Database {
    const db = dbOf(undefined)
    delete (db as unknown as Slot).themePacks
    return db
}

/** `levels` nested objects deep, the archive string at the bottom of an array. */
function deepEntry(levels: number, leaf: string): Slot {
    let node: unknown = [leaf, { note: 'x' }]
    for (let i = 0; i < levels; i++) {
        node = { [`k${i}`]: node }
    }
    return { v: 99, future: node }
}

//#endregion

describe('getUncleanablesSync over theme packs', () => {
    test('T2-1: a v1 record keeps the basename of its archive', () => {
        expect(getUncleanablesSync(dbOf([packRecord()]))).toContain(PACK_BASENAME)
    })

    test('T2-1: every record of the list keeps its own archive', () => {
        const kept = getUncleanablesSync(dbOf([packRecord(PACK_ARCHIVE, 'a'), packRecord(OTHER_ARCHIVE, 'b')]))
        expect(kept).toContain(PACK_BASENAME)
        expect(kept).toContain(OTHER_BASENAME)
    })

    test('guard: themePacks that is {}, a string, a list holding null, or absent adds nothing and does not throw', () => {
        expect(getUncleanablesSync(dbOf({}))).toEqual([])
        expect(getUncleanablesSync(dbOf('x'))).toEqual([])
        expect(getUncleanablesSync(dbOf([null]))).toEqual([])
        expect(getUncleanablesSync(dbWithoutPacks())).toEqual([])
    })

    test('T2-3: a backup tree keeps its own packs (the manual clean-up reads each retained tree this way)', () => {
        const tree = dbOf([packRecord()])
        expect(getUncleanablesSync(tree, { chars: [] })).toEqual([PACK_BASENAME])
    })

    test('T2-11: an unknown-version entry keeps every assets/ string at any depth', () => {
        const entry = deepEntry(8, PACK_ARCHIVE)
        expect(getUncleanablesSync(dbOf([entry]))).toContain(PACK_BASENAME)
        const shallow = { v: 99, other: { shape: [{ archives: [OTHER_ARCHIVE] }] } }
        expect(getUncleanablesSync(dbOf([shallow]))).toContain(OTHER_BASENAME)
    })

    test('T2-11: depth 40 is walked too (no depth bound)', () => {
        expect(getUncleanablesSync(dbOf([deepEntry(40, PACK_ARCHIVE)]))).toContain(PACK_BASENAME)
    })

    test('T2-11: a cyclic entry terminates and still keeps its strings', () => {
        const entry: Slot = { v: 99, archive: PACK_ARCHIVE }
        entry.self = entry
        expect(getUncleanablesSync(dbOf([entry]))).toContain(PACK_BASENAME)
    })
})

describe('the store2 config list over theme packs', () => {
    test('T2-2: a v1 record is listed as a literal of the config list', () => {
        const list = deriveConfigAssets(dbOf([packRecord()]), [])
        expect(listHolds(list, PACK_ARCHIVE)).toBe(true)
        expect(list.l).toContain(PACK_BASENAME)
    })

    test('T2-2: an unknown-version entry is listed from any depth', () => {
        const list = deriveConfigAssets(dbOf([deepEntry(10, PACK_ARCHIVE)]), [])
        expect(listHolds(list, PACK_ARCHIVE)).toBe(true)
    })

    test('guard: a database without packs derives a config list without them, and a hostile value derives nothing', () => {
        expect(deriveConfigAssets(dbWithoutPacks(), []).l).toEqual([])
        expect(deriveConfigAssets(dbOf({}), []).l).toEqual([])
        expect(deriveConfigAssets(dbOf('x'), []).l).toEqual([])
        expect(deriveConfigAssets(dbOf([null]), []).l).toEqual([])
    })

    test('T2-6: the closure keep-set holds the literal while a retained manifest names it in its config list', async () => {
        const tree = new Tree()
        const retained = tree.addManifest({ configAssetList: deriveConfigAssets(dbOf([packRecord()]), []) }, 1)
        const current = tree.addManifest({}, 2)
        const result = await buildClosureAssetKeepSet({ commitKey: commitKeyOf({ current, retained: [{ key: retained, at: 0 }] }), reader: tree.reader })
        expect(result.status).toBe('complete')
        if (result.status === 'complete') {
            expect(result.keep.holds(PACK_ARCHIVE)).toBe(true)
            expect(result.keep.holds(OTHER_ARCHIVE)).toBe(false)
        }
    })
})

describe('the boot sweeps over theme packs', () => {
    async function keepSetOf(db: Database): Promise<Set<string>> {
        const { uncleanable } = await buildAssetKeepSet(db)
        return uncleanable
    }

    test('T2-4: the Tauri boot sweep fed the real keep-set keeps the pack file and deletes an unreferenced pack-named file', async () => {
        const removed: string[] = []
        await sweepTauriAssets({
            uncleanable: await keepSetOf(dbOf([packRecord()])),
            listAssets: async () => [{ name: PACK_BASENAME }, { name: OTHER_BASENAME }, { name: 'orphan.png' }],
            removeAsset: async (path) => { removed.push(path) },
            getBasename,
            log: () => { },
            logError: () => { },
        })
        expect([...removed].sort()).toEqual([`assets/${OTHER_BASENAME}`, 'assets/orphan.png'].sort())
    })

    test('T2-4w: the web boot sweep fed the real keep-set keeps the pack file and deletes an unreferenced pack-named file', async () => {
        const removed: string[] = []
        const deps = {
            uncleanable: await keepSetOf(dbOf([packRecord()])),
            removeAsset: async (key: string) => { removed.push(key) },
            getBasename,
        }
        for (const key of [PACK_ARCHIVE, OTHER_ARCHIVE]) {
            await sweepForageAssetKey(key, deps)
        }
        expect(removed).toEqual([OTHER_ARCHIVE])
    })

    test('T2-13: Remove, then each sweep reclaims the archive; Remove alone leaves it in the store; a second record naming it keeps it', async () => {
        const installModule = '../../themePack/install'
        const recordModule = '../../themePack/packRecord'
        const { removeThemePackAt } = await import(/* @vite-ignore */ installModule) as typeof import('src/ts/themePack/install')
        const { listThemePacks } = await import(/* @vite-ignore */ recordModule) as typeof import('src/ts/themePack/packRecord')
        const { DBState } = await import('src/ts/stores.svelte')
        const entries = [packRecord(PACK_ARCHIVE, 'one'), packRecord(PACK_ARCHIVE, 'two')]
        DBState.db = dbOf(entries)
        h.forage.set(PACK_ARCHIVE, new Uint8Array([1]))

        // The first Remove leaves the file, and the second record still names it.
        const first = listThemePacks(DBState.db.themePacks)[0]
        expect(removeThemePackAt(first.index, first.entry)).toEqual({ ok: true })
        expect(h.forage.has(PACK_ARCHIVE)).toBe(true)
        expect(await sweptKeys(DBState.db)).toEqual([])

        // The last Remove frees the archive: the sweep (web and Tauri) reclaims it, the Remove itself did not.
        const second = listThemePacks(DBState.db.themePacks)[0]
        expect(removeThemePackAt(second.index, second.entry)).toEqual({ ok: true })
        expect(h.forage.has(PACK_ARCHIVE)).toBe(true)
        expect(await sweptKeys(DBState.db)).toEqual([PACK_ARCHIVE])
    })

    async function sweptKeys(db: Database): Promise<string[]> {
        const keep = await keepSetOf(db)
        const web: string[] = []
        await sweepForageAssetKey(PACK_ARCHIVE, { uncleanable: keep, removeAsset: async (key) => { web.push(key) }, getBasename })
        const desktop: string[] = []
        await sweepTauriAssets({
            uncleanable: keep, listAssets: async () => [{ name: PACK_BASENAME }], removeAsset: async (path) => { desktop.push(path) },
            getBasename, log: () => { }, logError: () => { },
        })
        expect(desktop).toEqual(web)
        return web
    }
})

describe('the integrity scan over a pack archive', () => {
    afterEach(() => { vi.unstubAllGlobals() })

    test('T2-17 guard: a pack archive name is reported as not content-addressed, never as a mismatch', async () => {
        vi.stubGlobal('caches', { open: vi.fn(async () => ({ match: vi.fn(async () => undefined) })) })
        const { verifyAssetCacheEntry } = await import('src/ts/storage/assetIntegrity')
        expect(await verifyAssetCacheEntry(PACK_ARCHIVE)).toEqual({ status: 'not-content-addressed' })
    })
})

describe('the pack archive key against the store key rules', () => {
    test('T2-12 guard: the key is creatable and addressable on every backend and short enough for the Node server', () => {
        expect(utf8ByteLength(PACK_ARCHIVE)).toBeLessThan(NODE_MAX_WRITE_KEY_BYTES)
        expect(nodeCreatableViolation(PACK_ARCHIVE)).toBeNull()
        expect(tauriCreatableViolation(PACK_ARCHIVE)).toBeNull()
        expect(indexedDbCreatableViolation(PACK_ARCHIVE)).toBeNull()
        expect(nodeAddressableViolation(PACK_ARCHIVE)).toBeNull()
        expect(indexedDbAddressableViolation(PACK_ARCHIVE)).toBeNull()
        expect(tauriAddressableViolation(PACK_ARCHIVE, 'windows')).toBeNull()
        expect(tauriAddressableViolation(PACK_ARCHIVE, 'posix')).toBeNull()
        expect(nodeAssetRouteViolation(PACK_ARCHIVE)).toBeNull()
        expect(assetOrInlayBodyKeyViolation(PACK_ARCHIVE)).toBeNull()
    })
})

//#region the manual clean-up over a key/value page store

type Ctx = {
    cold: typeof import('src/ts/process/coldstorage.svelte')
    listing: typeof import('src/ts/storage/loadTimeListing')
    mainRec: typeof import('src/ts/storage/mainFileRecord')
    stores: typeof import('src/ts/stores.svelte')
    risuSave: typeof import('src/ts/storage/risuSave')
}

let ctx: Ctx

/** Boots a fresh module graph on the web build with this tab owning a fake lock manager. */
async function setupWebPage(): Promise<Ctx> {
    h.forage.clear()
    h.onRemove = undefined
    h.platform.isTauri = false
    h.platform.isNodeServer = false
    const core = new FakeLockManagerCore()
    vi.resetModules()
    Object.defineProperty(window.navigator, 'locks', { value: new FakeTabLockManagerView(core, 'A'), configurable: true })
    const globalApi = await import('src/ts/globalApi.svelte')
    ctx = {
        cold: await import('src/ts/process/coldstorage.svelte'),
        listing: await import('src/ts/storage/loadTimeListing'),
        mainRec: await import('src/ts/storage/mainFileRecord'),
        stores: await import('src/ts/stores.svelte'),
        risuSave: await import('src/ts/storage/risuSave'),
    }
    vi.clearAllMocks()
    ctx.listing.resetLoadTimeListingForTests()
    const { setPageStorageMode } = await import('src/ts/storage/pageStorageMode')
    setPageStorageMode({ kind: 'block' })
    ctx.mainRec.resetMainFileRecordForTests()
    const { injectAppStore } = await import('src/ts/storage/store/appStore')
    injectAppStore(createForageBackedStore(globalApi.forageStorage as unknown as ForageLike))
    return ctx
}

function makeDb(extra: Slot = {}): Database {
    return {
        formatversion: 5, botPresetsId: 0, botPresets: [], modules: [], loadouts: [], plugins: [], pluginCustomStorage: {},
        characterOrder: [], characters: [], coldstorage: false, ...extra,
    } as unknown as Database
}

function seedAsset(name: string): void {
    h.forage.set('assets/' + name, new Uint8Array([9, 9]))
}

function assetKeys(): string[] {
    return Array.from(h.forage.keys()).filter((key) => key.startsWith('assets/'))
}

/** The page has just booted: the committed main file is stored, this tab has read it, and the load-time listing exists. */
async function prime(db: Database): Promise<void> {
    const encoder = new ctx.risuSave.RisuSaveEncoder()
    await encoder.init(db, {})
    const bytes = new Uint8Array(encoder.encode()!)
    h.forage.set('database/database.bin', bytes)
    ctx.mainRec.noteMainFileBytes(bytes.slice())
    await ctx.listing.recordLoadTimeListing()
}

describe('the manual clean-up over theme packs', () => {
    afterEach(() => { vi.useRealTimers() })

    test('T2-5: a pack file the live database names is kept and an unreferenced one is deleted', async () => {
        await setupWebPage()
        seedAsset(PACK_BASENAME)
        seedAsset(OTHER_BASENAME)
        seedAsset('orphan.png')
        const live = makeDb({ themePacks: [packRecord()] })
        ctx.stores.DBState.db = live
        await prime(live)

        await ctx.cold.cleanColdStorage()

        expect(assetKeys()).toContain(PACK_ARCHIVE)
        expect(assetKeys()).not.toContain(OTHER_ARCHIVE)
        expect(assetKeys()).not.toContain('assets/orphan.png')
    })

    test('T2-13: Remove leaves the archive in the store, then the manual clean-up reclaims it', async () => {
        await setupWebPage()
        seedAsset(PACK_BASENAME)
        const installModule = '../../themePack/install'
        const recordModule = '../../themePack/packRecord'
        const { removeThemePackAt } = await import(/* @vite-ignore */ installModule) as typeof import('src/ts/themePack/install')
        const { listThemePacks } = await import(/* @vite-ignore */ recordModule) as typeof import('src/ts/themePack/packRecord')
        const live = makeDb({ themePacks: [packRecord()] })
        ctx.stores.DBState.db = live
        const target = listThemePacks(ctx.stores.DBState.db.themePacks)[0]
        expect(removeThemePackAt(target.index, target.entry)).toEqual({ ok: true })
        expect(assetKeys()).toContain(PACK_ARCHIVE)
        await prime(ctx.stores.DBState.db)

        await ctx.cold.cleanColdStorage()

        expect(assetKeys()).not.toContain(PACK_ARCHIVE)
    })

    test('T2-5: a pack file whose record is added after the keep-set was built is kept by the live check before each batch', async () => {
        await setupWebPage()
        for (let i = 0; i < 250; i++) {
            seedAsset(`filler-${String(i).padStart(3, '0')}.png`)
        }
        seedAsset(PACK_BASENAME)
        const live = makeDb()
        ctx.stores.DBState.db = live
        await prime(live)
        h.onRemove = (key) => {
            if (key.startsWith('assets/')) {
                h.onRemove = undefined
                ;(ctx.stores.DBState.db as unknown as Slot).themePacks = [packRecord()]
            }
        }

        await ctx.cold.cleanColdStorage()

        expect(assetKeys()).not.toContain('assets/filler-000.png')
        expect(assetKeys()).toContain(PACK_ARCHIVE)
    })
})

//#endregion
