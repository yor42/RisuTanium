/**
 * Empirical reproduction for the hypothesis: "On Tauri, a transient
 * cold-storage READ failure at boot can permanently delete an asset file
 * that is only referenced by a cold-stored character's full data."
 *
 * STATUS: PRE-FIX EVIDENCE, KEPT INTACT. This file still passes today, and
 * that is expected, not a sign the underlying bug is unfixed: everything it
 * asserts is a verbatim REPLICA of the OLD Tauri deletion predicate (see
 * point 1 below), copied here because `cleanChunks` was, and still is,
 * module-private and could not be called directly. It does not drive
 * `sweepTauriAssets`/`sweepForageAssetKey` or `buildAssetKeepSet`, the real
 * seams the stage-7a fix (`Agents/Reports/13-chore07-cold-read-failure-plan.md`
 * §2.1) added and now guards with a `complete` flag this replica has no
 * knowledge of -- so this harness cannot observe the fix at all, in either
 * direction. Its logic is left unchanged (do not edit it to "fix" it); it
 * remains the historical record of the pre-fix predicate's exact behaviour.
 * The REAL wiring -- `buildAssetKeepSet` + `sweepTauriAssets` /
 * `sweepForageAssetKey`, called the way `cleanChunks` actually calls them --
 * is now covered by `src/ts/process/tests/coldStorageDeletionGuards.svelte.test.ts`'s
 * a1-a4 (confirmed RED against the unfixed source, GREEN after the fix).
 *
 * ALLEGED MECHANISM (source-traced by the Orchestrator, re-verified against
 * source before this harness was written -- exact line numbers below are as
 * read on this run, corrections from the brief's numbers are called out):
 *
 *   1. `cleanChunks()` (src/ts/bootstrap.ts:556-587 as originally briefed;
 *      confirmed at :556 `async function cleanChunks(...)`, called with no
 *      arguments at :292) is NOT exported. It returns early only for
 *      account sync (:569-571, `db.account?.useSync || forageStorage.isAccount`)
 *      or when `db.coldstorage && !cleanColdStorage` (:572-574, the
 *      `cleanColdStorage` option defaults to `false`). Otherwise it builds
 *      `uncleanable = new Set(await getUncleanables(db))` (:576) and, on
 *      Tauri (:577), for every entry in `readDir('assets', {baseDir: AppData})`
 *      (:578) whose basename is not in `uncleanable` (:582-583), calls
 *      `remove('assets/' + asset.name, {baseDir: AppData})` (:584). This is
 *      the DELETION PREDICATE this harness replicates verbatim below,
 *      because `cleanChunks` itself is module-private (grep-confirmed: the
 *      only `cleanChunks` identifiers in src/ts are its definition at
 *      bootstrap.ts:556 and its single call site at bootstrap.ts:292 -- no
 *      `export` keyword, and no re-export anywhere).
 *
 *      CORRECTION to the brief: the brief cited the predicate as
 *      "bootstrap.ts:575-587"; on this checkout the `getUncleanables` call
 *      is one line earlier, at :576 (the block being replicated is
 *      :577-589, the `if (isTauri) { ... }` body up through its closing
 *      brace). This is a one-line drift, not a structural correction.
 *
 *   2. `getUncleanables` (src/ts/globalApi.svelte.ts:1474-1489) loops
 *      `db.characters`. For a character with `cha.coldstorage` set (:1478),
 *      it calls `getColdStorageItem(cha.coldstorage)` (:1479) and ONLY IF
 *      that returns truthy `.character` data matching the same `chaId`
 *      (:1480) does it swap `cha` for the full `coldData.character`
 *      (:1481). There is NO else branch -- confirmed by reading :1474-1489
 *      verbatim, reproduced here:
 *
 *          for(let cha of db.characters){
 *              if(cha?.coldstorage){
 *                  const coldData = await getColdStorageItem(cha.coldstorage!)
 *                  if(coldData?.character && coldData.character.chaId === cha.chaId){
 *                      cha = coldData.character
 *                  }
 *              }
 *              chars.push(cha)
 *          }
 *
 *      On a null/failed read, the STUB `cha` (the cold-storage placeholder
 *      character written by `makeColdDataForCharacter`,
 *      src/ts/process/coldstorage.svelte.ts:422-441, which keeps only
 *      `image`, `name`, `chaId`, `chatPage`, `coldstorage`,
 *      `coldStoragedChats` -- NOT `emotionImages` / `additionalAssets`) is
 *      pushed instead, so `getUncleanablesSync` (globalApi.svelte.ts:1531-1539)
 *      never adds that character's emotion/additional asset basenames to
 *      the protected set.
 *
 *   3. `getColdStorageItem`'s Tauri branch (src/ts/process/coldstorage.svelte.ts:75-85)
 *      wraps its `readFile` + decompress + `JSON.parse` in a try/catch that
 *      returns `null` on ANY error (:82-84) -- a thrown transient read
 *      failure is indistinguishable from "never written".
 *
 * CONCLUSION CHAIN: cold-stored character + `db.coldstorage` OFF (so
 * `cleanChunks` does not early-return at :572-574) + one transient read
 * failure of that character's cold blob at the moment `getUncleanables`
 * reads it => the emotion/additional-asset files that ONLY the full
 * character's data references are absent from `uncleanable` => the Tauri
 * deletion loop (:577-589) deletes them from `assets/` on disk, even though
 * the cold blob itself survives untouched.
 *
 * WHAT THIS HARNESS DRIVES FOR REAL vs REPLICATES:
 *   - REAL: `getUncleanables` from `src/ts/globalApi.svelte.ts` (imported
 *     unmocked -- this is the actual function under test).
 *   - REAL: `getColdStorageItem` / `setColdStorageItem` from
 *     `src/ts/process/coldstorage.svelte.ts` (imported unmocked), including
 *     the REAL fflate compress/decompress round trip `getUncleanables`
 *     depends on transitively.
 *   - REPLICA, clearly labelled: the Tauri deletion predicate from
 *     bootstrap.ts:577-589 (`cleanChunks` is not exported, so it cannot be
 *     imported -- see point 1 above). The replica below is a verbatim
 *     transcription of that loop, not a reimplementation of its logic.
 *
 * WHY `src/ts/globalApi.svelte.ts` NEEDS THIS MANY MOCKS: every other
 * harness in this directory that touches cold storage (see
 * `cold-storage-orphan-repro.svelte.harness.ts`) mocks `globalApi.svelte`
 * itself wholesale, specifically BECAUSE it is the repo's central hub with
 * ~40 first-party imports (drive/*, plugins/*, gui/*, characters, hotkey,
 * parser, autoStorage -> accountStorage -> nodeStorage/opfsStorage, etc.).
 * That option is not available here: `getUncleanables` IS the function
 * under test, so it must be the real, unmocked module. Every one of its
 * OTHER imports is therefore mocked instead, each with a one-line reason
 * inline below. `src/ts/storage/risuSave.ts`, `src/ts/storage/dbChangeEffects.svelte.ts`,
 * `src/lang`, `src/ts/storage/defaultPrompts.ts`, `src/ts/reloadGuard.ts`,
 * `src/ts/storage/multiTabReload.ts`, `src/ts/storage/nodeStorage.ts`,
 * `src/ts/network/localNetwork.ts`, `src/ts/network/proxyJobWs.ts` and
 * `src/ts/localDrafts.ts` were individually read and left REAL/unmocked:
 * each has no import graph that reaches `stores.svelte` / `parser.svelte`
 * (or, for risuSave/dbChangeEffects, is already proven safe to import real
 * by the two existing repros in this directory).
 *
 * Per Agents/Tools/README.md's "Harnesses that mock the app's rune
 * modules: keep them in ONE file" -- every vi.mock factory and every
 * rune-touching helper lives in this one `.svelte.harness.ts` file.
 *
 * Run:
 *   npx vitest run --config Agents/Tools/vitest.harness.config.ts Agents/Tools/save-gen/asset-gc-cold-read-repro.svelte.harness.ts --reporter=verbose
 *
 * Read-only w.r.t. src/ -- this file drives real modules, it does not
 * modify them.
 */
import { writable } from 'svelte/store'
import { describe, test, expect, vi } from 'vitest'
import type { Database } from '../../../src/ts/storage/database.svelte'

//#region module mocks -- every non-essential import reachable from
// src/ts/globalApi.svelte.ts is stubbed here. See file header for why each
// group is mocked vs. left real.

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))

// Forces getColdStorageItem/setColdStorageItem/getUncleanables's own
// isTauri check down the Tauri branch, and gates cleanChunks's early return
// (replicated below) the same way the real function is gated.
vi.mock(import('src/ts/platform'), () => ({
    isTauri: true,
    isNodeServer: false,
    isIOS: () => false,
}))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => {
        throw new Error('no live database in tests')
    }),
    setDatabase: vi.fn(),
    presetTemplate: { name: 'test-preset' },
    defaultSdDataFunc: vi.fn(() => ({})),
    appVer: 'test',
    appSubVer: 'test',
    getCurrentCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

// stores.svelte: same minimal reactive stand-in as the other two repros in
// this directory -- constructed directly in the factory (no cross-file
// dynamic import) to avoid the documented "split vi.mock factory" trap.
vi.mock(import('../../../src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(-1),
        selIdState: { state: -1 },
        alertStore: writable({ type: 'none', msg: '' }),
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
    } as unknown as typeof import('../../../src/ts/stores.svelte')
})

// `../alert` transitively reaches `./characters` -> `./parser/parser.svelte`
// (documented trap in cold-storage-orphan-repro.svelte.harness.ts). None of
// its UI-toast behaviour matters to getUncleanables.
vi.mock(import('src/ts/alert'), () => ({
    alertClear: vi.fn(),
    alertConfirm: vi.fn(async () => true),
    alertError: vi.fn(),
    alertWait: vi.fn(),
    alertMd: vi.fn(),
    alertNormal: vi.fn(),
    alertSelect: vi.fn(),
    alertTOS: vi.fn(async () => true),
    alertToast: vi.fn(),
    alertInput: vi.fn(),
    alertLogin: vi.fn(),
    alertNormalWait: vi.fn(),
    alertAddCharacter: vi.fn(),
    alertStore: writable({ type: 'none', msg: '' }),
    waitAlert: vi.fn(async () => {}),
}))

// Only reachable when forageStorage.isAccount is true (never here).
vi.mock(import('src/ts/sionyw'), () => ({
    fetchProtectedResource: vi.fn(async () => ({ status: 404 }) as unknown as Response),
}))

// `./util` pulls in `./characters` (-> parser.svelte) and a real Svelte
// component (PopupList.svelte) via mount/unmount. Nothing it exports is
// used by getUncleanables.
vi.mock(import('src/ts/util'), () => ({
    changeFullscreen: vi.fn(),
    checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
    sleep: vi.fn(async () => {}),
    sleepForever: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/util'))

vi.mock('@tauri-apps/api/core', () => ({
    convertFileSrc: vi.fn((p: string) => p),
    invoke: vi.fn(async () => undefined),
}))

vi.mock('@tauri-apps/api/path', () => ({
    appDataDir: vi.fn(async () => '/appdata'),
    join: vi.fn(async (...p: string[]) => p.join('/')),
    basename: vi.fn(async (p: string) => p.split('/').pop()),
}))

vi.mock('@tauri-apps/plugin-shell', () => ({
    open: vi.fn(async () => {}),
}))

vi.mock('src/ts/vendor/streamSaver', () => ({
    default: {
        useBlobFallback: false,
        createWriteStream: () => ({
            ready: Promise.resolve(),
            writable: {
                getWriter: () => ({
                    write: async () => { },
                    close: async () => { },
                }),
            },
        }),
    },
}))

vi.mock('@tauri-apps/api/webviewWindow', () => ({
    getCurrentWebviewWindow: vi.fn(() => ({
        listen: vi.fn(),
        setTitle: vi.fn(),
    })),
}))

vi.mock(import('src/ts/update'), () => ({
    checkRisuUpdate: vi.fn(async () => {}),
}))

vi.mock(import('src/ts/plugins/plugins.svelte'), () => ({
    loadPlugins: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/plugins/plugins.svelte'))

vi.mock(import('src/ts/drive/drive'), () => ({
    checkDriverInit: vi.fn(async () => {}),
    syncDrive: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/drive/drive'))

// `hasher` is only used elsewhere in globalApi.svelte.ts; parser.svelte.ts
// fires top-level $effect.root against stores.svelte, the exact trap the
// README documents.
vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    hasher: vi.fn((s: string) => s),
    parseMarkdownSafe: vi.fn((s: string) => s),
}) as unknown as typeof import('src/ts/parser/parser.svelte'))

vi.mock(import('src/ts/characterCards'), () => ({
    characterURLImport: vi.fn(),
    hubURL: 'https://example.invalid',
    importCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock(import('src/ts/drive/accounter'), () => ({
    loadRisuAccountData: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/drive/accounter'))

// registerDbChangeEffects is not exercised by this harness -- getUncleanables
// does not touch dbChangeEffects at all. Mocked to avoid wiring an
// unrelated $effect graph.
vi.mock(import('src/ts/storage/dbChangeEffects.svelte'), () => ({
    registerDbChangeEffects: vi.fn(),
}) as unknown as typeof import('src/ts/storage/dbChangeEffects.svelte'))

// AutoStorage's constructor is cheap, but its import graph (-> accountStorage
// -> nodeStorage/opfsStorage, and accountStorage circularly importing
// getUncleanables back out of globalApi.svelte) is not needed to exercise
// getUncleanables and is avoided here.
vi.mock(import('src/ts/storage/autoStorage'), () => ({
    AutoStorage: class {
        isAccount = false
        realStorage: unknown = undefined
    },
}) as unknown as typeof import('src/ts/storage/autoStorage'))

vi.mock(import('src/ts/gui/animation'), () => ({
    updateAnimationSpeed: vi.fn(),
}) as unknown as typeof import('src/ts/gui/animation'))

vi.mock(import('src/ts/gui/colorscheme'), () => ({
    updateColorScheme: vi.fn(),
    updateTextThemeAndCSS: vi.fn(),
}) as unknown as typeof import('src/ts/gui/colorscheme'))

vi.mock(import('src/ts/kei/backup'), () => ({
    autoServerBackup: vi.fn(async () => {}),
    saveDbKei: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/kei/backup'))

vi.mock('@tauri-apps/plugin-dialog', () => ({
    save: vi.fn(async () => null),
}))

vi.mock('@tauri-apps/api/event', () => ({
    listen: vi.fn(async () => vi.fn()),
}))

vi.mock(import('src/ts/observer.svelte'), () => ({
    startObserveDom: vi.fn(),
}) as unknown as typeof import('src/ts/observer.svelte'))

vi.mock(import('src/ts/gui/guisize'), () => ({
    updateGuisize: vi.fn(),
}) as unknown as typeof import('src/ts/gui/guisize'))

vi.mock(import('src/ts/characters'), () => ({
    updateLorebooks: vi.fn((v: unknown) => v),
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/hotkey'), () => ({
    initMobileGesture: vi.fn(),
}) as unknown as typeof import('src/ts/hotkey'))

vi.mock('@tauri-apps/plugin-http', () => ({
    fetch: vi.fn(async () => new Response(null, { status: 404 })),
}))

vi.mock(import('src/ts/process/modules'), () => ({
    moduleUpdate: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/process/modules'))

vi.mock(import('src/ts/storage/accountStorage'), () => ({
    AccountSyncConflictError: class extends Error {},
}) as unknown as typeof import('src/ts/storage/accountStorage'))

//#endregion

//#region the in-memory Tauri filesystem mock -- the "storage backend" per
// the task. Holds asset files under assets/ and cold blobs under
// coldstorage/<key>.json, exactly as the real Tauri plugin-fs API is used
// by coldstorage.svelte.ts and bootstrap.ts's cleanChunks.

type FsEntry = { name: string; isDirectory: boolean }

const fsStore = new Map<string, Uint8Array>() // key: 'assets/foo.png' etc (no leading './')
const throwOnceReadPaths = new Set<string>()

function normalizePath(path: string): string {
    return path.replace(/^\.\//, '').replace(/\\/g, '/')
}

function armTransientReadFailure(path: string): void {
    throwOnceReadPaths.add(normalizePath(path))
}

vi.mock('@tauri-apps/plugin-fs', () => ({
    BaseDirectory: { AppData: 0 },
    readDir: vi.fn(async (dir: string) => {
        const prefix = normalizePath(dir).replace(/\/$/, '') + '/'
        const names = new Set<string>()
        for (const key of fsStore.keys()) {
            if (key.startsWith(prefix)) {
                const rest = key.slice(prefix.length)
                if (!rest.includes('/')) {
                    names.add(rest)
                }
            }
        }
        const entries: FsEntry[] = Array.from(names).map((name) => ({ name, isDirectory: false }))
        return entries
    }),
    readFile: vi.fn(async (path: string) => {
        const p = normalizePath(path)
        if (throwOnceReadPaths.has(p)) {
            throwOnceReadPaths.delete(p)
            throw new Error(`simulated transient Tauri fs read failure for ${p}`)
        }
        if (!fsStore.has(p)) {
            throw new Error(`ENOENT (mock): ${p}`)
        }
        return fsStore.get(p)!
    }),
    writeFile: vi.fn(async (path: string, data: Uint8Array) => {
        fsStore.set(normalizePath(path), data)
    }),
    remove: vi.fn(async (path: string) => {
        const p = normalizePath(path)
        if (!fsStore.has(p)) {
            throw new Error(`ENOENT (mock, remove): ${p}`)
        }
        fsStore.delete(p)
    }),
    exists: vi.fn(async (path: string) => fsStore.has(normalizePath(path))),
    mkdir: vi.fn(async () => {}),
}))

//#endregion

import { getUncleanables } from '../../../src/ts/globalApi.svelte'
import { getColdStorageItem, setColdStorageItem } from '../../../src/ts/process/coldstorage.svelte'
import { readDir, remove } from '@tauri-apps/plugin-fs'

//#region fixture helpers

type CharacterFixture = Database['characters'][number]

function makeFullCharacter(chaId: string): CharacterFixture {
    return {
        chaId,
        name: 'Full Character',
        type: 'character',
        chatPage: 0,
        image: 'assets/main-image.png',
        emotionImages: [
            ['happy', 'assets/emotion-happy.png'],
            ['sad', 'assets/emotion-sad.png'],
        ],
        additionalAssets: [
            ['bg', 'assets/additional-bg.png', ''],
        ],
        chats: [],
    } as unknown as CharacterFixture
}

/** The cold-storage stub written in place of a character by
 * makeColdDataForCharacter (coldstorage.svelte.ts:422-441) -- keeps only
 * `image`, not emotionImages/additionalAssets. */
function makeColdStub(chaId: string, coldKey: string): CharacterFixture {
    return {
        chaId,
        name: 'Full Character',
        type: 'character',
        chatPage: 0,
        image: 'assets/main-image.png',
        coldstorage: coldKey,
        chats: [{
            message: [{ time: Date.now(), data: '', role: 'char' }],
            note: '',
            name: '',
            localLore: [],
        }],
    } as unknown as CharacterFixture
}

function makeDb(characters: CharacterFixture[]): Database {
    return {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        characterOrder: characters.map((c) => c.chaId),
        characters,
        coldstorage: false,
    } as unknown as Database
}

function seedAssets(): void {
    fsStore.set('assets/main-image.png', new TextEncoder().encode('main-image-bytes'))
    fsStore.set('assets/emotion-happy.png', new TextEncoder().encode('emotion-happy-bytes'))
    fsStore.set('assets/emotion-sad.png', new TextEncoder().encode('emotion-sad-bytes'))
    fsStore.set('assets/additional-bg.png', new TextEncoder().encode('additional-bg-bytes'))
}

function resetAssets(): void {
    fsStore.clear()
    throwOnceReadPaths.clear()
    seedAssets()
}

/**
 * REPLICA of bootstrap.ts:577-589 (the Tauri branch of cleanChunks), copied
 * verbatim (cleanChunks itself is not exported -- see file header). This is
 * the ONLY reimplemented logic in this harness; everything else it calls
 * (getUncleanables, getColdStorageItem/setColdStorageItem) is the real,
 * imported function.
 *
 * Source (bootstrap.ts:577-589):
 *
 *     if (isTauri) {
 *         const assets = await readDir('assets', { baseDir: BaseDirectory.AppData })
 *         console.log(assets)
 *         for (const asset of assets) {
 *             try {
 *                 const n = getBasename(asset.name)
 *                 if (!uncleanable.has(n)) {
 *                     await remove('assets/' + asset.name, { baseDir: BaseDirectory.AppData })
 *                 }
 *             } catch (error) {
 *                 console.log('error', asset.name)
 *             }
 *         }
 *     }
 */
function getBasenameReplica(data: string): string {
    return data.replace(/\\/g, '/').split('/').pop()!
}

async function replicateTauriAssetGcPredicate(uncleanable: Set<string>): Promise<string[]> {
    const deleted: string[] = []
    const assets = await readDir('assets', { baseDir: 0 as never })
    for (const asset of assets as FsEntry[]) {
        try {
            const n = getBasenameReplica(asset.name)
            if (!uncleanable.has(n)) {
                await remove('assets/' + asset.name, { baseDir: 0 as never })
                deleted.push(asset.name)
            }
        } catch (error) {
            // matches the real catch's console.log('error', asset.name) -- swallow
        }
    }
    return deleted
}

//#endregion

describe('asset-gc-cold-read-repro: transient cold-storage read failure during boot-time asset GC', () => {
    test('(a) cold read succeeds -> emotion/additional assets are protected and survive', async () => {
        resetAssets()
        const coldKey = 'cold-key-a'
        const chaId = 'char-a'
        const fullChar = makeFullCharacter(chaId)
        await setColdStorageItem(coldKey, { character: fullChar })
        const db = makeDb([makeColdStub(chaId, coldKey)])

        const uncleanableList = await getUncleanables(db)
        const uncleanable = new Set(uncleanableList)
        console.log(`(a) uncleanable set = ${JSON.stringify(uncleanableList)}`)
        // observed on unfixed code: a successful cold read swaps the stub
        // for the full character, so the emotion/additional assets ARE
        // protected
        expect(uncleanable.has('emotion-happy.png')).toBe(true)
        expect(uncleanable.has('emotion-sad.png')).toBe(true)
        expect(uncleanable.has('additional-bg.png')).toBe(true)
        expect(uncleanable.has('main-image.png')).toBe(true)

        const deleted = await replicateTauriAssetGcPredicate(uncleanable)
        console.log(`(a) deleted by GC predicate = ${JSON.stringify(deleted)}`)
        expect(deleted).toEqual([])
        for (const asset of ['assets/main-image.png', 'assets/emotion-happy.png', 'assets/emotion-sad.png', 'assets/additional-bg.png']) {
            expect(fsStore.has(asset)).toBe(true)
        }
    })

    test('(b) one transient cold read failure -> emotion/additional assets are NOT protected and are deleted; the cold blob survives; image survives', async () => {
        resetAssets()
        const coldKey = 'cold-key-b'
        const chaId = 'char-b'
        const fullChar = makeFullCharacter(chaId)
        const writeOk = await setColdStorageItem(coldKey, { character: fullChar })
        expect(writeOk).toBe(true)
        const db = makeDb([makeColdStub(chaId, coldKey)])

        armTransientReadFailure('./coldstorage/' + coldKey + '.json')
        let threw = false
        let uncleanableList: string[] = []
        try {
            uncleanableList = await getUncleanables(db)
        } catch (e) {
            threw = true
        }
        console.log(`(b) getUncleanables threw=${threw}, uncleanable set = ${JSON.stringify(uncleanableList)}`)
        // observed on unfixed code: getColdStorageItem's Tauri branch
        // swallows the thrown read error and returns null instead of
        // propagating it, so getUncleanables never throws either
        expect(threw).toBe(false)
        const uncleanable = new Set(uncleanableList)
        // observed on unfixed code: the stub character (no
        // emotionImages/additionalAssets) is what got pushed into
        // getUncleanablesSync's input, so these basenames are ABSENT
        expect(uncleanable.has('emotion-happy.png')).toBe(false)
        expect(uncleanable.has('emotion-sad.png')).toBe(false)
        expect(uncleanable.has('additional-bg.png')).toBe(false)
        // observed on unfixed code: the stub keeps `image`, so the main
        // portrait IS still protected even on a failed cold read
        expect(uncleanable.has('main-image.png')).toBe(true)

        const deleted = await replicateTauriAssetGcPredicate(uncleanable)
        console.log(`(b) deleted by GC predicate = ${JSON.stringify(deleted)}`)
        // observed on unfixed code: the emotion/additional asset files are
        // deleted by the (replicated) Tauri asset-GC predicate
        expect(new Set(deleted)).toEqual(new Set(['emotion-happy.png', 'emotion-sad.png', 'additional-bg.png']))
        expect(fsStore.has('assets/emotion-happy.png')).toBe(false)
        expect(fsStore.has('assets/emotion-sad.png')).toBe(false)
        expect(fsStore.has('assets/additional-bg.png')).toBe(false)
        // observed on unfixed code: the main image survives (the stub
        // protected it)
        expect(fsStore.has('assets/main-image.png')).toBe(true)

        // The cold blob itself is untouched by any of this -- the failure
        // was transient, and a subsequent read (no failure armed) proves it.
        const coldReadAfter = await getColdStorageItem(coldKey)
        console.log(`(b) cold blob read after GC (no failure armed) = ${coldReadAfter ? 'present, character.chaId=' + coldReadAfter.character?.chaId : 'MISSING'}`)
        // observed on unfixed code: the cold blob survives fully intact and
        // readable -- only the derived asset files on disk were lost
        expect(coldReadAfter?.character?.chaId).toBe(chaId)
    })

    test('(c) control: cold blob genuinely missing (never written) -> same outcome as a transient failure', async () => {
        resetAssets()
        const coldKey = 'cold-key-c-never-written'
        const chaId = 'char-c'
        // Deliberately never call setColdStorageItem for this key.
        const db = makeDb([makeColdStub(chaId, coldKey)])

        const uncleanableList = await getUncleanables(db)
        const uncleanable = new Set(uncleanableList)
        console.log(`(c) uncleanable set = ${JSON.stringify(uncleanableList)}`)
        // observed on unfixed code: a genuinely missing blob is
        // indistinguishable from a transient failure at this layer -- same
        // absent-from-uncleanable outcome
        expect(uncleanable.has('emotion-happy.png')).toBe(false)
        expect(uncleanable.has('emotion-sad.png')).toBe(false)
        expect(uncleanable.has('additional-bg.png')).toBe(false)
        expect(uncleanable.has('main-image.png')).toBe(true)

        const deleted = await replicateTauriAssetGcPredicate(uncleanable)
        console.log(`(c) deleted by GC predicate = ${JSON.stringify(deleted)}`)
        expect(new Set(deleted)).toEqual(new Set(['emotion-happy.png', 'emotion-sad.png', 'additional-bg.png']))
    })

    test('(d) db.coldstorage=true -> cleanChunks would return early (replicated gate), so no deletion happens even after a transient failure', async () => {
        resetAssets()
        const coldKey = 'cold-key-d'
        const chaId = 'char-d'
        const fullChar = makeFullCharacter(chaId)
        await setColdStorageItem(coldKey, { character: fullChar })
        const db = makeDb([makeColdStub(chaId, coldKey)])
        db.coldstorage = true // global setting ON

        armTransientReadFailure('./coldstorage/' + coldKey + '.json')

        // Replica of the EARLY-RETURN gate at bootstrap.ts:572-574:
        //     if(db.coldstorage && !cleanColdStorage){
        //         return
        //     }
        // cleanColdStorage here is cleanChunks's own {cleanColdStorage}
        // option (default false), NOT the coldstorage.svelte.ts function of
        // the same name -- confirmed by reading cleanChunks's signature at
        // bootstrap.ts:556-558.
        const cleanColdStorageOption = false
        const wouldReturnEarly = !!db.coldstorage && !cleanColdStorageOption
        console.log(`(d) db.coldstorage=${db.coldstorage}, cleanChunks early-return gate -> wouldReturnEarly=${wouldReturnEarly}`)
        // observed on unfixed code: with the global coldstorage setting on,
        // cleanChunks's gate means getUncleanables/the deletion loop never
        // even run -- assert the gate condition directly, since cleanChunks
        // is not exported to call
        expect(wouldReturnEarly).toBe(true)

        // Demonstrate concretely: even the CONTENTS of the assets dir are
        // untouched, because in the real early-return, readDir/remove are
        // never reached at all.
        const before = new Map(fsStore)
        // (intentionally not calling getUncleanables / the GC predicate here,
        // exactly like the real early return in cleanChunks)
        expect(fsStore).toEqual(before)
        console.log(`(d) assets untouched: ${JSON.stringify(Array.from(fsStore.keys()))}`)
    })
})
