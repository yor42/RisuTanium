/**
 * CHORE-17 FOLLOW-UP — synchronous main-thread cost of today's plugin setter
 * vs. the proposed layer-1 compare, in real Chromium.
 *
 * Real, unmodified, and exercised for real in this file:
 *   - `src/ts/storage/database.svelte.ts`'s `setDatabase`/`setDatabaseLite`/
 *     `getDatabase` (including its ~150 `checkNullish`/`??=` default-fill
 *     checks and its per-character chat loop).
 *   - `src/ts/stores.svelte.ts`'s real `DBState` singleton, INCLUDING its own
 *     baseline top-level `$effect.root` (selected-character/module-update
 *     watcher) that runs in the real app regardless of this measurement.
 *   - `src/ts/storage/dbChangeEffects.svelte.ts`'s real
 *     `registerDbChangeEffects` (the full 6a/6b partitioned effect graph
 *     plus the identity tracker), wired to the real `DBState`.
 *   - `src/ts/storage/characterSaveMarks.ts`'s real `markCharacterForSave`
 *     (used by the V2/V3 setter-wrapper replica below, see the block comment
 *     above `pluginSetDatabaseV3`/`pluginSetDatabaseLiteV2` for why those two
 *     specific functions are a documented replica rather than an import of
 *     `plugins/plugins.svelte.ts` itself).
 *   - `src/ts/storage/risuSave.ts`'s real `RisuSaveEncoder` (reused from the
 *     original harness, for item 2's blocking measurement and item 3's
 *     interleaved-compare variant).
 *   - Svelte 5.55.1's real `flushSync` (`from 'svelte'`), production
 *     conditioned by `vite build`'s default mode.
 *
 * STUBBED, and why (see each stub file's own header for detail): `util.ts`
 * (pulls a real Svelte UI component + Tauri file pickers + `characters.ts`;
 * only `checkNullish` -- reimplemented FAITHFULLY, not a no-op -- is
 * actually exercised by `setDatabase()`'s default-fill checks),
 * `globalApi.svelte.ts` (this repo's ~1900-line hub; `downloadFile`/
 * `saveAsset` are dead code on this path), `gui/colorscheme.ts` (theme
 * application; only its `defaultColorScheme` constant, copied verbatim, is
 * read), `process/memory/hypav3.ts` (2000+ line memory-compression
 * subsystem; only its `createHypaV3Preset()` default-fill factory is
 * called), `process/modules.ts` and `process/scripts.ts` as imported BY
 * `stores.svelte.ts` specifically (module-editor and script-engine
 * subsystems this fixture's `modules: []` never touches).
 *
 * OUT OF SCOPE, per the task: rendering the character grid. No Svelte
 * component is mounted anywhere in this file; nothing here measures DOM
 * output, only the synchronous JS cost of the setter call and the effect
 * graph's own (non-rendering) work.
 */
import localforage from 'localforage'
import { flushSync } from 'svelte'
import {
    resetYieldInstrumentation,
    getActualYieldTimestamps,
} from './chore17-stub-saveyield-instrumented'
import { buildManyCharactersFixture } from './character-scaling-fixture'
import { mulberry32, SEED } from './build'

declare global {
    interface Window {
        __CHORE17_FOLLOWUP_DONE__?: boolean
        __CHORE17_FOLLOWUP_RESULTS__?: unknown
        __CHORE17_FOLLOWUP_ERROR__?: string
        gc?: () => void
    }
}

// ---------------------------------------------------------------------------
// localforage.createInstance ready-patch (same ordering fix and same reason
// as the original chore17-entry.svelte.ts -- see that file's header comment
// for the full localforage-internals explanation). Needed here too because
// this file also drives the real RisuSaveEncoder for items 2 and 3.
// ---------------------------------------------------------------------------
let chaIdSet = new Set<string>()
let idbCharMs = 0
let idbCharCount = 0
function resetIdbCounters() { idbCharMs = 0; idbCharCount = 0 }

// Per-setItem-call timestamps, captured only while `sliceRecordingEnabled`
// is true (item 2) -- {key, enter, resolve} lets the caller reconstruct the
// synchronous JS slice BEFORE each yield point: slice[i] = enter[i] -
// resolve[i-1] (resolve[-1] = the timestamp `set()` itself started at).
let sliceRecordingEnabled = false
let sliceRecords: { key: string; enter: number; resolve: number }[] = []
function resetSliceRecording() { sliceRecords = [] }

let cacheForageReadyPromise: Promise<void> = Promise.resolve()
const realCreateInstance = localforage.createInstance.bind(localforage)
;(localforage as unknown as { createInstance: typeof localforage.createInstance }).createInstance = function patchedCreateInstance(opts: any) {
    const inst = realCreateInstance(opts)
    cacheForageReadyPromise = inst.ready().then(() => {
        const realSetItem = inst.setItem.bind(inst)
        inst.setItem = async function patchedSetItem(key: string, value: any) {
            const enter = performance.now()
            const result = await realSetItem(key, value)
            const resolve = performance.now()
            const m = /^risuSaveBlock_(.+)$/.exec(key)
            if (m && chaIdSet.has(m[1])) { idbCharMs += resolve - enter; idbCharCount++ }
            if (sliceRecordingEnabled) sliceRecords.push({ key, enter, resolve })
            return result
        } as typeof inst.setItem
    })
    return inst
}

const risuSaveMod = await import('src/ts/storage/risuSave')
const { RisuSaveEncoder } = await import('src/ts/storage/tests/risuSaveEncoder')
type ToSaveType = import('src/ts/storage/risuSave').toSaveType

const databaseMod = await import('src/ts/storage/database.svelte')
const { setDatabase, setDatabaseLite, getDatabase } = databaseMod
type DatabaseType = import('src/ts/storage/database.svelte').Database

const storesMod = await import('src/ts/stores.svelte')
const { DBState } = storesMod

const dbChangeEffectsMod = await import('src/ts/storage/dbChangeEffects.svelte')
const { registerDbChangeEffects } = dbChangeEffectsMod

const saveMarksMod = await import('src/ts/storage/characterSaveMarks')
const { markCharacterForSave, installCharacterSaveMarks, uninstallCharacterSaveMarks, resetCharacterSaveMarksForTest } = saveMarksMod

// ---------------------------------------------------------------------------
// Replica of plugins.svelte.ts's getV2PluginAPIs().setDatabase /
// .setDatabaseLite wrapper (`src/ts/plugins/plugins.svelte.ts`, the
// `setDatabaseLite`/`setDatabase` closures inside `getV2PluginAPIs()`), for
// the 'characters'-only case this harness's fixture uses (matching the real
// AssetGod call shape the Roadmap documents: "pass the entire cached
// characters array"). NOT an import of `plugins/plugins.svelte.ts` itself --
// that file's own import graph (`globalApi.svelte`, `alert`, `util`,
// `pluginSafety`, `apiV3/*`) is the exact "~40 first-party imports" hub
// problem the original harness's header already documents avoiding, and none
// of it is exercised by the two lines of logic being measured here: the
// `allowedDbKeys` passthrough (real list has 'characters' as its first
// entry, confirmed by reading it) and the mark-all-N loop (which calls the
// REAL, imported `markCharacterForSave` above, not a reimplementation).
function pluginSetDatabaseV3(newDb: { characters: Record<string, unknown>[] }): void {
    const db = getDatabase() as unknown as { characters: unknown[] }
    db.characters = newDb.characters
    setDatabase(db as unknown as DatabaseType)
    for (const char of (db.characters ?? []) as { chaId?: string }[]) {
        markCharacterForSave(char?.chaId)
    }
}
function pluginSetDatabaseLiteV2(newDb: { characters: unknown[] }): void {
    const db = getDatabase() as unknown as { characters: unknown[] }
    db.characters = newDb.characters
    setDatabaseLite(db as unknown as DatabaseType)
    for (const char of (db.characters ?? []) as { chaId?: string }[]) {
        markCharacterForSave(char?.chaId)
    }
}

// ---------------------------------------------------------------------------
// Helpers (duplicated from chore17-entry.svelte.ts rather than shared across
// files -- see Agents/Tools/README.md's "keep them in ONE file" note for
// harnesses that mock/patch app rune modules).
// ---------------------------------------------------------------------------
function median(nums: number[]): number {
    const s = [...nums].sort((a, b) => a - b)
    const mid = Math.floor(s.length / 2)
    return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid]
}
function summarize(nums: number[]) {
    return { median: median(nums), min: Math.min(...nums), max: Math.max(...nums), samples: nums }
}
async function forceGc(): Promise<void> {
    if (typeof window.gc === 'function') {
        window.gc()
        await new Promise((r) => setTimeout(r, 20))
        window.gc()
        await new Promise((r) => setTimeout(r, 20))
    }
}

function buildDbShape(characters: Record<string, unknown>[]) {
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
    }
}

function toJSONIfPresent(v: any): any {
    return v !== null && typeof v === 'object' && typeof v.toJSON === 'function' ? v.toJSON() : v
}
function isNonFiniteNumber(v: any): boolean {
    return typeof v === 'number' && !Number.isFinite(v)
}
function normalizeForValueSlot(v: any): any {
    v = toJSONIfPresent(v)
    if (v === undefined || typeof v === 'function' || typeof v === 'symbol') return null
    if (v === null) return null
    if (isNonFiniteNumber(v)) return null
    return v
}
function jsonValueEqual(a: any, b: any): boolean {
    const an = normalizeForValueSlot(a)
    const bn = normalizeForValueSlot(b)
    if (an === null || bn === null) return an === null && bn === null
    const aArr = Array.isArray(an)
    const bArr = Array.isArray(bn)
    if (aArr !== bArr) return false
    if (aArr) return jsonArrayEqual(an, bn)
    const at = typeof an
    const bt = typeof bn
    if (at !== bt) return false
    if (at === 'object') return jsonObjectEqual(an, bn)
    return an === bn
}
function jsonArrayEqual(a: any[], b: any[]): boolean {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
        if (!jsonValueEqual(a[i], b[i])) return false
    }
    return true
}
function jsonObjectKeysFiltered(o: any): string[] {
    const keys = Object.keys(o)
    const out: string[] = []
    for (const k of keys) {
        const v = o[k]
        if (v !== undefined && typeof v !== 'function' && typeof v !== 'symbol') out.push(k)
    }
    return out
}
function jsonObjectEqual(a: any, b: any): boolean {
    const ak = jsonObjectKeysFiltered(a)
    const bk = jsonObjectKeysFiltered(b)
    if (ak.length !== bk.length) return false
    for (let i = 0; i < ak.length; i++) {
        if (ak[i] !== bk[i]) return false
    }
    for (const k of ak) {
        if (!jsonValueEqual(a[k], b[k])) return false
    }
    return true
}

/** Computes slice durations (ms) from a set of {enter, resolve} timestamps plus the wall-clock start of the whole call. slice[0] = enter[0]-callStart; slice[i] = enter[i]-resolve[i-1]; a final tail slice (resolve[last] -> callEnd) is appended. */
function computeSlices(records: { enter: number; resolve: number }[], callStart: number, callEnd: number): number[] {
    const slices: number[] = []
    let prevResolve = callStart
    for (const r of records) {
        slices.push(r.enter - prevResolve)
        prevResolve = r.resolve
    }
    slices.push(callEnd - prevResolve)
    return slices
}

async function main() {
    const CHARACTER_COUNT = 1000
    const TOTAL_MESSAGES = 150000
    const WARMUP = 2
    const MEASURED = 5

    const results: any = { chromeUserAgent: navigator.userAgent }

    // -----------------------------------------------------------------
    // Shared fixture + boot, matching the app's own real boot sequence as
    // closely as this harness can: build characters, load them via the REAL
    // setDatabaseLite (so DBState.db is populated the way the app populates
    // it at startup, not via a hand-built $state container), THEN register
    // the REAL registerDbChangeEffects (matches saveDb()'s own real
    // ordering: init() -> registerDbChangeEffects seeded from
    // the characters init() encoded).
    // -----------------------------------------------------------------
    await cacheForageReadyPromise
    const { characters: rawCharacters, stats } = buildManyCharactersFixture({
        characterCount: CHARACTER_COUNT,
        totalMessages: TOTAL_MESSAGES,
        seedOffset: 71000,
    })
    results.fixtureStats = stats

    const liveClone = structuredClone(rawCharacters)
    setDatabaseLite(buildDbShape(liveClone) as unknown as DatabaseType)
    const allChaIds = liveClone.map((c) => c.chaId as string)
    chaIdSet = new Set(allChaIds)

    const encoder = new RisuSaveEncoder()
    await encoder.init(DBState.db as unknown as DatabaseType, { compression: false })
    // The encoder no longer hands out the proxies it encoded; the live characters are the same objects.
    const seed = (DBState.db as unknown as DatabaseType).characters

    function makeTracker(): ToSaveType {
        return { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
    }
    const tracker = makeTracker()
    let markChangedCallCount = 0
    const markChanged = (_dirty: boolean) => { markChangedCallCount++ }

    // The V2/V3 setter-wrapper replica below calls the REAL
    // `markCharacterForSave`, which writes into whatever
    // `installCharacterSaveMarks` last installed (a module-level singleton,
    // same convention `chore01-plugin-setdatabase-save-bench.svelte.harness.ts`
    // already established) -- install it onto the SAME tracker
    // `registerDbChangeEffects` below writes into, matching the real app's
    // one-shared-tracker-per-debounce-cycle design.
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => {} })

    // registerDbChangeEffects must run inside an active effect root -- same
    // requirement, same call shape, as the real app's boot sequence.
    $effect.root(() => {
        registerDbChangeEffects({ tracker, markChanged, seed })
    })
    // Let the FIRST run of every effect (which never marks anything -- see
    // dbChangeEffects.svelte.ts's own "ranOnce"/identity-seed comments)
    // settle before any timed call, matching the real app (registration
    // happens once at boot, well before the first plugin call).
    flushSync()
    tracker.character.length = 0
    markChangedCallCount = 0

    // -----------------------------------------------------------------
    // Item 1: synchronous setter cost, V3-style and V2-style, plus the
    // effect-flush cost that follows each.
    // -----------------------------------------------------------------
    const rng = mulberry32(SEED + 55000)
    function buildV3IncomingWithOneDiff(): Record<string, unknown>[] {
        // "As $state.snapshot would produce": a fresh, plain (non-proxied)
        // deep copy of the live data, matching what a V3 plugin's own
        // getDatabase({snapshot:true}) call would hand back, with exactly
        // one deep leaf mutated (same mutation shape as the layer-1 compare
        // measurement in the original entry file).
        const incoming = structuredClone(rawCharacters)
        const chaIdx = Math.floor(rng() * incoming.length)
        const chats = (incoming[chaIdx] as any).chats as any[]
        const chatIdx = Math.floor(rng() * chats.length)
        const messages = chats[chatIdx].message as any[]
        const msgIdx = Math.floor(rng() * messages.length)
        messages[msgIdx].data = messages[msgIdx].data + ' MUTATED'
        return incoming
    }

    async function timeSetterAndFlush(run: () => void): Promise<{ setterMs: number; flushMs: number }> {
        tracker.character.length = 0
        markChangedCallCount = 0
        await forceGc()
        const t0 = performance.now()
        run()
        const t1 = performance.now()
        flushSync()
        const t2 = performance.now()
        return { setterMs: t1 - t0, flushMs: t2 - t1 }
    }

    // --- V3-style: fresh plain characters array, one character changed ---
    const v3SetterSamples: number[] = []
    const v3FlushSamples: number[] = []
    for (let i = 0; i < WARMUP; i++) {
        await timeSetterAndFlush(() => pluginSetDatabaseV3({ characters: buildV3IncomingWithOneDiff() }))
    }
    for (let i = 0; i < MEASURED; i++) {
        const { setterMs, flushMs } = await timeSetterAndFlush(() => pluginSetDatabaseV3({ characters: buildV3IncomingWithOneDiff() }))
        v3SetterSamples.push(setterMs)
        v3FlushSamples.push(flushMs)
    }

    // --- V2-style: in-place edit on the LIVE proxied array, then
    // setDatabaseLite with that SAME array reference (matches the real V2
    // path: getDatabase() is a live wrapper over DBState.db, so a plugin
    // mutates elements in place and passes the same array back). ---
    const v2SetterSamples: number[] = []
    const v2FlushSamples: number[] = []
    function v2InPlaceEditAndSetLite(): void {
        const db = getDatabase() as unknown as { characters: any[] }
        const idx = Math.floor(rng() * db.characters.length)
        const chats = db.characters[idx].chats as any[]
        const chatIdx = Math.floor(rng() * chats.length)
        const messages = chats[chatIdx].message as any[]
        const msgIdx = Math.floor(rng() * messages.length)
        messages[msgIdx].data = messages[msgIdx].data + ' MUTATED'
        pluginSetDatabaseLiteV2({ characters: db.characters })
    }
    for (let i = 0; i < WARMUP; i++) {
        await timeSetterAndFlush(v2InPlaceEditAndSetLite)
    }
    for (let i = 0; i < MEASURED; i++) {
        const { setterMs, flushMs } = await timeSetterAndFlush(v2InPlaceEditAndSetLite)
        v2SetterSamples.push(setterMs)
        v2FlushSamples.push(flushMs)
    }

    results.item1_setterCost = {
        excludes: 'rendering the character grid -- no Svelte component is mounted anywhere in this harness',
        v3Style_freshArrayOneChanged: {
            setterMs: summarize(v3SetterSamples),
            effectFlushMs: summarize(v3FlushSamples),
        },
        v2Style_inPlaceEditPlusSetDatabaseLite: {
            setterMs: summarize(v2SetterSamples),
            effectFlushMs: summarize(v2FlushSamples),
            note: 'expected near-zero effect-flush: setDatabaseLite(db) self-assigns the SAME array reference DBState.db already holds, so Svelte\'s proxy sees no identity change and schedules nothing -- this is exactly why CHORE-17\'s mark-all-N loop exists for V2 (the identity tracker in dbChangeEffects.svelte.ts cannot see this edit).',
        },
    }

    // -----------------------------------------------------------------
    // Item 2: blocking in today's all-N set() -- longest synchronous slice
    // between awaits, and counts over 16ms/50ms.
    // -----------------------------------------------------------------
    function makeAllMarkedTracker(): ToSaveType {
        return { character: [...allChaIds], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
    }
    const dbForEncode = buildDbShape(structuredClone(rawCharacters))
    // Independent encoder + independent (non-reactive) plain db object for
    // this item -- item 2 measures RisuSaveEncoder.set()'s OWN blocking
    // behaviour in isolation, same subject as the original entry file's
    // phase breakdown, not the setter/effect path above.
    const encoder2 = new RisuSaveEncoder()
    await encoder2.init(dbForEncode as unknown as DatabaseType, { compression: false })

    // CHORE-17 skip re-measurement: with the encodeRawBlock skip, this
    // all-N/all-unchanged set() crosses NO setItem boundary at all (every
    // block skips), so setItem timestamps alone would show one giant slice.
    // Real yield points now come from src/ts/storage/saveYield.ts's
    // maybeYield() instead -- see chore17-stub-saveyield-instrumented.ts,
    // redirected the same way for risuSave.ts's own import in this bundle's
    // vite config. Both sources are merged the same way the original
    // chore17-entry.svelte.ts's item 1 does.
    const allSliceSamples: number[][] = []
    for (let i = 0; i < WARMUP; i++) {
        resetIdbCounters()
        sliceRecordingEnabled = false
        await encoder2.set(dbForEncode as unknown as DatabaseType, makeAllMarkedTracker())
    }
    for (let i = 0; i < MEASURED; i++) {
        resetIdbCounters()
        resetSliceRecording()
        resetYieldInstrumentation()
        sliceRecordingEnabled = true
        await forceGc()
        const callStart = performance.now()
        await encoder2.set(dbForEncode as unknown as DatabaseType, makeAllMarkedTracker())
        const callEnd = performance.now()
        sliceRecordingEnabled = false
        const merged = [...sliceRecords, ...getActualYieldTimestamps().map((r) => ({ ...r, key: 'yield' }))]
        const slices = computeSlices(merged, callStart, callEnd)
        allSliceSamples.push(slices)
    }
    const flatLongest = allSliceSamples.map((s) => Math.max(...s))
    const over16 = allSliceSamples.map((s) => s.filter((x) => x > 16).length)
    const over50 = allSliceSamples.map((s) => s.filter((x) => x > 50).length)
    results.item2_blockingInAllNSet = {
        method: "merges TWO yield-point sources: risuSaveCacheForage.setItem completions (real writes, now 0 in this all-unchanged scenario) and real saveYield.ts yieldFn invocations -- i.e. every time the internal 8ms budget branch was actually taken, recorded via createYieldBudget's own opts.yieldFn extension point, NOT inferred from resume latency (see chore17-stub-saveyield-instrumented.ts). A slice is the synchronous JS between one such completion and the next.",
        longestSliceMs: summarize(flatLongest),
        slicesOver16msPerRun: summarize(over16),
        slicesOver50msPerRun: summarize(over50),
        totalSlicesPerRun: sliceRecords.length + 1,
    }

    // -----------------------------------------------------------------
    // Item 3: layer-1 compare, chunked (yield every K via setTimeout(0)),
    // plus the "compare one at a time inside the save loop" variant.
    // -----------------------------------------------------------------
    function buildIncomingOneDiff(): Record<string, unknown>[] {
        const incoming = structuredClone(rawCharacters)
        const chaIdx = Math.floor(rng() * incoming.length)
        const chats = (incoming[chaIdx] as any).chats as any[]
        const chatIdx = Math.floor(rng() * chats.length)
        const messages = chats[chatIdx].message as any[]
        const msgIdx = Math.floor(rng() * messages.length)
        messages[msgIdx].data = messages[msgIdx].data + ' MUTATED'
        return incoming
    }

    async function timeChunkedCompare(K: number): Promise<{ totalMs: number; longestSliceMs: number; sliceCount: number }> {
        const incoming = buildIncomingOneDiff()
        const live = (DBState.db as unknown as { characters: any[] }).characters
        const slices: number[] = []
        const callStart = performance.now()
        let sliceStart = callStart
        for (let i = 0; i < incoming.length; i++) {
            jsonValueEqual(incoming[i], live[i])
            if ((i + 1) % K === 0) {
                const now = performance.now()
                slices.push(now - sliceStart)
                await new Promise((resolve) => setTimeout(resolve, 0))
                sliceStart = performance.now()
            }
        }
        const callEnd = performance.now()
        slices.push(callEnd - sliceStart)
        return { totalMs: callEnd - callStart, longestSliceMs: Math.max(...slices), sliceCount: slices.length }
    }

    const chunked: Record<string, any> = {}
    for (const K of [25, 100]) {
        const totalSamples: number[] = []
        const longestSamples: number[] = []
        for (let i = 0; i < MEASURED; i++) {
            const r = await timeChunkedCompare(K)
            totalSamples.push(r.totalMs)
            longestSamples.push(r.longestSliceMs)
        }
        chunked[`K=${K}`] = { totalMs: summarize(totalSamples), longestSliceMs: summarize(longestSamples) }
    }

    // "Compare one at a time inside the save loop, just before encoding it":
    // per-character compare cost distribution -- this variant needs no
    // artificial chunking because it is naturally interleaved with the
    // existing per-character `await risuSaveCacheForage.setItem(...)` yield
    // point (item 2), one compare per character, immediately before that
    // character would otherwise be unconditionally re-encoded.
    const live = (DBState.db as unknown as { characters: any[] }).characters
    const perCharCompareSamples: number[] = []
    for (let rep = 0; rep < MEASURED; rep++) {
        const incoming = buildIncomingOneDiff()
        for (let i = 0; i < incoming.length; i++) {
            const t0 = performance.now()
            jsonValueEqual(incoming[i], live[i])
            perCharCompareSamples.push(performance.now() - t0)
        }
    }
    perCharCompareSamples.sort((a, b) => a - b)
    const n = perCharCompareSamples.length
    results.item3_layer1CompareChunked = {
        chunked,
        perCharacterInsideSaveLoop: {
            note: 'one jsonValueEqual(incoming[i], live[i]) call per character, timed individually, immediately before where that character would otherwise be unconditionally re-encoded -- naturally yields at the SAME point set() already yields (the per-character await), so no separate chunking parameter applies.',
            medianMs: perCharCompareSamples[Math.floor(n / 2)],
            p95Ms: perCharCompareSamples[Math.floor(n * 0.95)],
            maxMs: perCharCompareSamples[n - 1],
            totalMsAcrossAllRuns: perCharCompareSamples.reduce((a, b) => a + b, 0),
            sampleCount: n,
        },
    }

    window.__CHORE17_FOLLOWUP_RESULTS__ = results
    window.__CHORE17_FOLLOWUP_DONE__ = true
}

main().catch((err) => {
    window.__CHORE17_FOLLOWUP_ERROR__ = err && err.stack ? err.stack : String(err)
    window.__CHORE17_FOLLOWUP_DONE__ = true
})
