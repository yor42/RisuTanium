/**
 * CHORE-01 Stage 1, Report 17 §6: "Measure one save after a plugin
 * setDatabase with characters on a large fixture."
 *
 * CONTEXT (verified by reading, not assumed): `plugins.svelte.ts`'s
 * `setDatabase`/`setDatabaseLite` (the V2/V3 plugin-API database setters,
 * `src/ts/plugins/plugins.svelte.ts:753-815`) both end with:
 *   if (Array.isArray(newDb.characters)) {
 *       for (const char of db.characters ?? []) {
 *           markCharacterForSave(char?.chaId);
 *       }
 *   }
 * -- an explicit, maintainer-accepted decision (Report 17 Stage 1 §3.3,
 * re-review F3) to mark EVERY character dirty rather than diff which ones
 * actually changed, because a plugin's live-proxy edits are otherwise
 * invisible to both the selected-character effect and the identity tracker.
 * This ONE `for` loop, with no surrounding `while`/interval, is the entire
 * reach of a single `setDatabase`/`setDatabaseLite` call -- confirmed by
 * reading the whole of `plugins.svelte.ts`: neither setter is itself called
 * in a loop anywhere else in that file (both are one-shot API methods handed
 * to a plugin's own script, invoked whenever THAT SCRIPT chooses to call
 * them). See this file's closing summary for what that does and does not
 * imply about repetition.
 *
 * WHAT THIS FILE MEASURES, at 500 and 1000 characters (sized like
 * `character-scaling-fixture.ts`'s `buildManyCharactersFixture`, same two
 * points this project's other CHORE-01 harnesses already standardized on --
 * 500 chars/~20k msgs as "typical heavy", 1000 chars/~150k msgs as
 * "extreme", per `project-real-character-counts`):
 *
 *   1. `prepareSaveIteration()`'s REAL synchronous main-thread cost
 *      (`src/ts/globalApi.svelte.ts:798+`) with `reloadFlag.state = false`
 *      (there is no reload in this scenario -- `setDatabase`/
 *      `setDatabaseLite` never set `requiresFullEncoderReload`) -- the
 *      snapshot (`safeStructuredClone(tracker)`), the trim, and the
 *      no-reload presence filter (`db.characters` walk building a
 *      `Set<chaId>`, then filtering `toSave.character` against it). Timed
 *      for `toSave.character` = ALL N ids (the plugin-setDatabase case)
 *      versus exactly 1 id (a normal save after an ordinary edit to the
 *      selected character only).
 *   2. `RisuSaveEncoder.set()`'s REAL cost (`src/ts/storage/risuSave.ts:311+`)
 *      for the same two `toSave.character` shapes, against an encoder that
 *      has already been `init()`-ed once (so `this.blocks[chaId]` already
 *      exists for every character -- matching the real app, where `saveDb()`
 *      calls `encoder.init()` once at boot before any `set()` ever runs).
 *      Without that warm-up, `set()`'s own `else if (!this.blocks[chaId])`
 *      branch would re-encode every character regardless of `toSave`,
 *      confounding the very comparison this file exists to make.
 *   3. Heap delta (`process.memoryUsage().heapUsed`, `global.gc()`-gated)
 *      around the all-N `set()` call only, "if cheap to capture" per the
 *      task -- two isolated-scope samples, same discipline as
 *      `dbchange-whole-db-partition-bench.svelte.harness.ts`'s "METHODOLOGY
 *      CORRECTION" (each sample is its own function returning only a
 *      number, so nothing outlives it for `gc()` to fail to reclaim).
 *
 * WHAT IS NOT MEASURED: the marking loop itself (calling
 * `markCharacterForSave` N times) -- that is cheap (`Array.prototype.includes`
 * + `push`) and is explicitly built OUTSIDE the timed section for every
 * scenario below. Also not measured: `encoder.init()`'s own one-time boot
 * cost (already covered by other CHORE-01 harnesses in this directory,
 * e.g. `dbchange-proxy-baseline-bench.svelte.harness.ts`'s P1(b)) -- it runs
 * once per fixture point here, untimed, purely to warm the encoder's
 * `blocks` map the way `saveDb()` really does before its first debounced
 * `set()`.
 *
 * REAL FUNCTIONS, NOT COPIES: `prepareSaveIteration` is imported directly
 * from `src/ts/globalApi.svelte.ts` (unmocked -- this is the function under
 * test), `RisuSaveEncoder`/`toSaveType` directly from
 * `src/ts/storage/risuSave.ts` (unmocked, same precedent as
 * `trash-restore-repro.svelte.harness.ts` and `risuSave.test.ts`), and
 * `markCharacterForSave`/`installCharacterSaveMarks`/
 * `uninstallCharacterSaveMarks`/`resetCharacterSaveMarksForTest` directly
 * from `src/ts/storage/characterSaveMarks.ts` (unmocked) -- so the marking
 * step in this harness is the exact same call plugins.svelte.ts's loop
 * makes, not a hand-rolled `tracker.character.push(...)`. The database
 * itself is a real Svelte 5 `$state()` proxy (this file's name ends
 * `.svelte.harness.ts` so the Svelte vite plugin compiles it with runes
 * enabled -- confirmed against `node_modules/@sveltejs/vite-plugin-svelte`'s
 * module-id regex, which matches any filename containing the `.svelte.`
 * infix followed by zero or more `something.` segments and a final `ts`/`js`
 * extension, not just a literal `.svelte.ts` suffix), so every
 * `db.characters` / `character.chaId` read inside `prepareSaveIteration`'s
 * presence filter and inside `RisuSaveEncoder.set()`'s per-character loop
 * goes through the REAL Svelte proxy `get` trap, not a plain object -- that
 * proxy overhead is part of the cost being measured, not incidental.
 *
 * `prepareSaveIteration` lives inside `src/ts/globalApi.svelte.ts`, this
 * repo's ~1900-line central hub with ~40 first-party imports (drive/*,
 * plugins/*, gui/*, characters, hotkey, parser, autoStorage ->
 * accountStorage -> nodeStorage/opfsStorage, etc.) -- importing it for real
 * means every one of ITS imports must resolve. The mock list below is
 * deliberately the same shape as
 * `asset-gc-cold-read-repro.svelte.harness.ts`'s (which already proved this
 * exact module loads and runs correctly for a different real export,
 * `getUncleanables`, with this mock set), with one addition
 * (`src/ts/process/coldstorage.svelte` is mocked here, not left real --
 * that harness needed the real cold-storage read path for its own subject
 * under test; this one has no use for it, and mocking it away avoids also
 * needing that harness's in-memory Tauri-filesystem mock). Every remaining
 * import `globalApi.svelte.ts` makes that is left unmocked below
 * (`./storage/risuSave`, `./storage/characterSaveMarks`,
 * `./storage/defaultPrompts`, `src/lang`, `./reloadGuard`,
 * `./storage/multiTabReload`, `./storage/nodeStorage`,
 * `./network/localNetwork`, `./network/proxyJobWs`, `./localDrafts`,
 * `svelte/store`, `uuid`) was individually confirmed (by reading each) to
 * have no import graph reaching `stores.svelte`/`parser.svelte`'s
 * top-level-effect trap, matching that same harness's own documented
 * reasoning.
 *
 * A top-level `$effect.root(...)` at `globalApi.svelte.ts:3497` runs
 * unconditionally on import (it watches `chatFoldedState`/`selIdState`
 * against `DBState.db.characters`) -- read and confirmed harmless here: both
 * of its inner effects `return` immediately while `chatFoldedState.data` is
 * `null` (its default, per the module's own `$state({ data: null })`
 * initializer), which this harness never sets, so neither effect ever
 * dereferences the minimal `stores.svelte` mock's `DBState.db`.
 *
 * Run (from the repo root):
 *   NODE_OPTIONS=--expose-gc npx vitest run --config Agents/Tools/vitest.harness.config.ts Agents/Tools/save-gen/chore01-plugin-setdatabase-save-bench.svelte.harness.ts --reporter=verbose
 *
 * NUMBERS ARE BEST-CASE HARDWARE: this file's timings were produced on an
 * i9-13900K desktop CPU. The project's own targets include a Raspberry Pi
 * and mid/low-end phones (`project-perf-numbers-are-best-case-hardware`,
 * `project-user-platform-and-symptoms`); nothing here should be read as
 * "meets a frame budget" on those devices -- it is a same-hardware,
 * before/after COMPARISON of two `toSave.character` sizes, not an absolute
 * budget claim.
 *
 * Read-only w.r.t. src/ -- this file drives real modules, it does not
 * modify them.
 */
import { writable } from 'svelte/store'
import { describe, test, expect, vi } from 'vitest'
import type { Database } from '../../../src/ts/storage/database.svelte'
import { buildManyCharactersFixture } from './character-scaling-fixture'

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

// Forces the CHARACTER_WITH_CHAT `option.remote === 'prefer'` branch in
// RisuSaveEncoder.encodeBlock (risuSave.ts:437-451) down the LOCAL
// (encodeRawBlock) path, not encodeRemoteBlock -- matching this project's
// most common real deployment (`project-user-platform-and-symptoms`: hosted
// web / local HTTP more common than Tauri) and avoiding any need to mock a
// remote-save network path that has nothing to do with this measurement.
vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}))

vi.mock(
    import('src/ts/storage/database.svelte'),
    () =>
        ({
            getDatabase: vi.fn(() => {
                throw new Error('no live database in tests -- prepareSaveIteration takes getDatabase via opts, this should never be called')
            }),
            setDatabase: vi.fn(),
            presetTemplate: { name: 'test-preset' },
            defaultSdDataFunc: vi.fn(() => ({})),
            appVer: 'test',
            appSubVer: 'test',
            getCurrentCharacter: vi.fn(),
        }) as unknown as typeof import('src/ts/storage/database.svelte'),
)

// stores.svelte: minimal reactive stand-in, same pattern as every other
// harness in this directory that mocks it (constructed directly in the
// factory, no cross-file dynamic import -- the documented "split vi.mock
// factory" trap). This harness builds its OWN separate $state() database
// container below (not DBState) -- this mock exists purely to satisfy
// globalApi.svelte.ts's top-level import and its harmless top-level
// $effect.root (see file header).
vi.mock(import('../../../src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
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
        CharEmotion: writable({}),
        MobileGUIStack: writable([]),
        OpenRealmStore: writable(false),
    } as unknown as typeof import('../../../src/ts/stores.svelte')
})

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

vi.mock(import('src/ts/drive/drive'), () => ({
    checkDriverInit: vi.fn(async () => {}),
    syncDrive: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/drive/drive'))

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

// registerDbChangeEffects is not exercised by this harness --
// prepareSaveIteration does not touch dbChangeEffects at all. Mocked to
// avoid wiring an unrelated $effect graph.
vi.mock(import('src/ts/storage/dbChangeEffects.svelte'), () => ({
    registerDbChangeEffects: vi.fn(),
}) as unknown as typeof import('src/ts/storage/dbChangeEffects.svelte'))

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

// Not needed by prepareSaveIteration; mocked away (unlike
// asset-gc-cold-read-repro.svelte.harness.ts, which needs the real
// coldstorage read path for ITS subject under test) to avoid also needing
// that harness's in-memory Tauri-filesystem mock.
vi.mock(import('src/ts/process/coldstorage.svelte'), () => ({
    getColdStorageItem: vi.fn(async () => null),
    makeColdData: vi.fn(async () => ({})),
}) as unknown as typeof import('src/ts/process/coldstorage.svelte'))

vi.mock(import('src/ts/storage/accountStorage'), () => ({
    AccountSyncConflictError: class extends Error {},
}) as unknown as typeof import('src/ts/storage/accountStorage'))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(async () => {}),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(async () => {}),
    readFile: vi.fn(async () => new Uint8Array()),
    readDir: vi.fn(async () => []),
    remove: vi.fn(async () => {}),
    BaseDirectory: { AppData: 0 },
}))

//#endregion

import { prepareSaveIteration, type PrepareSaveIterationOptions } from '../../../src/ts/globalApi.svelte'
import { RisuSaveEncoder, type toSaveType } from '../../../src/ts/storage/risuSave'
import {
    installCharacterSaveMarks,
    markCharacterForSave,
    resetCharacterSaveMarksForTest,
    uninstallCharacterSaveMarks,
} from '../../../src/ts/storage/characterSaveMarks'

//#region helpers

function makeTracker(): toSaveType {
    return { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
}

/**
 * Marks `chaIds` for save via the REAL `markCharacterForSave` (not a hand-
 * rolled `tracker.character.push`) -- the exact call
 * `plugins.svelte.ts`'s `setDatabase`/`setDatabaseLite` loop makes, once per
 * character. `resetCharacterSaveMarksForTest`/`uninstallCharacterSaveMarks`
 * bracket every call so this module-level singleton (shared across every
 * `test()` in this file) never leaks a mark from one scenario into the next.
 */
function buildTrackerViaRealMarks(chaIds: string[]): toSaveType {
    const tracker = makeTracker()
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => {} })
    for (const chaId of chaIds) {
        markCharacterForSave(chaId)
    }
    uninstallCharacterSaveMarks()
    return tracker
}

function median(nums: number[]): number {
    const sorted = [...nums].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

interface TimingResult { medianMs: number; maxMs: number; minMs: number; samples: number[] }
function summarize(samples: number[]): TimingResult {
    return { minMs: Math.min(...samples), medianMs: median(samples), maxMs: Math.max(...samples), samples }
}
function fmt(r: TimingResult): string {
    return `median=${r.medianMs.toFixed(3)}ms max=${r.maxMs.toFixed(3)}ms min=${r.minMs.toFixed(3)}ms [n=${r.samples.length}]`
}

function gcAvailable(): boolean {
    return typeof (global as any).gc === 'function'
}

/** Builds a minimal but shape-valid Database around `characters`, same required-field set as the other harnesses' installDb() helpers. */
function buildDbShape(characters: Record<string, unknown>[]): Database {
    return {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        characterOrder: characters.map((c) => c.chaId as string),
        characters,
    } as unknown as Database
}

//#endregion

interface FixturePoint { characterCount: number; totalMessages: number; label: string }
const FIXTURE_POINTS: FixturePoint[] = [
    { characterCount: 500, totalMessages: 20000, label: '500 chars / ~20k msgs' },
    { characterCount: 1000, totalMessages: 150000, label: '1000 chars / ~150k msgs' },
]

const WARMUP = 2
const MEASURED = 6

describe('CHORE-01 §6 — plugin setDatabase (mark-all-N) vs a normal save (mark-1): prepareSaveIteration + RisuSaveEncoder.set()', () => {
    for (const point of FIXTURE_POINTS) {
        test(`@ ${point.label}`, async () => {
            const { characters: rawCharacters, stats } = buildManyCharactersFixture({
                characterCount: point.characterCount,
                totalMessages: point.totalMessages,
                seedOffset: 61000 + point.characterCount,
            })
            const clone = structuredClone(rawCharacters)
            // Real $state() proxy -- proxy reads inside prepareSaveIteration's
            // presence filter and RisuSaveEncoder.set()'s per-character loop
            // go through Svelte's real Proxy get trap, not a plain object.
            const dbState = $state(buildDbShape(clone))
            const allChaIds = clone.map((c) => c.chaId as string)
            const singleChaId = allChaIds[0] // 'big-0', the largest character -- stands in for "the selected character a normal edit marks"

            const lines: string[] = ['', `=== CHORE-01 §6 @ ${point.label} (actual stats: ${JSON.stringify(stats)}) ===`]

            // Warm the encoder exactly like saveDb() does at boot (untimed --
            // this is a one-time cost this file does not re-measure; see
            // dbchange-proxy-baseline-bench.svelte.harness.ts's P1(b)).
            const encoder = new RisuSaveEncoder()
            await encoder.init(dbState as unknown as Database, { compression: false })

            const reinitEncoderShouldNotBeCalled = async (): Promise<RisuSaveEncoder> => {
                throw new Error('reinitEncoder should never be called: this scenario never sets reloadFlag.state = true')
            }

            /** Times ONE prepareSaveIteration call (item 1) + ONE encoder.set() call (item 2) for a given toSave.character shape. Returns both timings plus the toSave actually produced, for a sanity check. */
            async function timeOneIteration(chaIds: string[]): Promise<{ prepareMs: number; setMs: number; toSaveLen: number }> {
                const tracker = buildTrackerViaRealMarks(chaIds)
                const opts: PrepareSaveIterationOptions = {
                    tracker,
                    encoder,
                    reloadFlag: { state: false },
                    reinitEncoder: reinitEncoderShouldNotBeCalled,
                    getDatabase: () => dbState as unknown as Database,
                }
                const t0 = performance.now()
                const { toSave } = await prepareSaveIteration(opts)
                const t1 = performance.now()
                await encoder.set(dbState as unknown as Database, toSave)
                const t2 = performance.now()
                return { prepareMs: t1 - t0, setMs: t2 - t1, toSaveLen: chaIds.length === allChaIds.length ? allChaIds.length : 1 }
            }

            for (const [scenarioName, chaIds] of [
                ['plugin setDatabase (mark ALL N)', allChaIds],
                ['normal save (mark 1, selected character)', [singleChaId]],
            ] as const) {
                for (let i = 0; i < WARMUP; i++) {
                    await timeOneIteration(chaIds)
                }
                const prepareSamples: number[] = []
                const setSamples: number[] = []
                let lastToSaveLen = -1
                for (let i = 0; i < MEASURED; i++) {
                    const { prepareMs, setMs, toSaveLen } = await timeOneIteration(chaIds)
                    prepareSamples.push(prepareMs)
                    setSamples.push(setMs)
                    lastToSaveLen = toSaveLen
                }
                lines.push(`  [${scenarioName}] (toSave.character length = ${lastToSaveLen})`)
                lines.push(`    1. prepareSaveIteration (snapshot+trim+presence-filter): ${fmt(summarize(prepareSamples))}`)
                lines.push(`    2. RisuSaveEncoder.set():                                ${fmt(summarize(setSamples))}`)
            }

            // --- item 3: heap delta around the all-N set() call only, if cheap to capture ---
            // Each sample is its own function returning only a number, so nothing
            // outlives it for the next gc() to fail to reclaim (same discipline as
            // dbchange-whole-db-partition-bench.svelte.harness.ts's "METHODOLOGY
            // CORRECTION"). encoder.set() is async but does no I/O on this path
            // (compression:false, remote branch never taken -- see the platform
            // mock comment above), so awaiting it only costs a microtask tick; no
            // allocation happens between "await" and the gc() below that this
            // delta would miss.
            if (!gcAvailable()) {
                lines.push('  3. heap delta (all-N set()): UNMEASURED -- global.gc unavailable. Re-run with NODE_OPTIONS=--expose-gc.')
            } else {
                const gc = (global as any).gc as () => void
                async function measureAllNSetHeapDelta(): Promise<number> {
                    const tracker = buildTrackerViaRealMarks(allChaIds)
                    gc()
                    const before = process.memoryUsage().heapUsed
                    await encoder.set(dbState as unknown as Database, tracker)
                    gc()
                    const after = process.memoryUsage().heapUsed
                    return after - before
                }
                const run1 = await measureAllNSetHeapDelta()
                const run2 = await measureAllNSetHeapDelta()
                const toMB = (b: number) => (b / 1024 / 1024).toFixed(2)
                lines.push(`  3. heap delta, all-N RisuSaveEncoder.set(): runs=[${toMB(run1)} MB, ${toMB(run2)} MB]`)
            }

            console.log(lines.join('\n') + '\n=== end ===\n')
            expect(allChaIds.length).toBe(point.characterCount)
        }, 240000)
    }
})
