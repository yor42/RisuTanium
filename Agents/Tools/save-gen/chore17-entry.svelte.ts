/**
 * CHORE-17 Report — "Measure first" item A, real Chromium + real IndexedDB.
 *
 * Drives the REAL `RisuSaveEncoder` (`src/ts/storage/risuSave.ts`, imported
 * unmodified) against a real Svelte 5 `$state()` proxy and real
 * `localforage`-over-IndexedDB, inside a headless Chromium page (see
 * `chore17-run.mjs`). This file itself is `.svelte.ts` (not `.svelte.js`) so
 * `@sveltejs/vite-plugin-svelte` compiles its `$state()` call with runes
 * enabled — same convention as every `*.svelte.harness.ts` file in this
 * directory.
 *
 * STUBBED (see the two stub files for why): `src/ts/storage/database.svelte`
 * (`getDatabase`, `presetTemplate` — both dead code on the path measured
 * here), `src/ts/globalApi.svelte` (`forageStorage` — dead code, remote
 * saving is off by default and never enabled here).
 * REAL / NOT stubbed: `localforage` (wrapped only at the `createInstance`
 * boundary for timing — every call still reaches real IndexedDB), `msgpackr`,
 * `fflate`, `src/ts/platform` (isTauri/isNodeServer naturally evaluate
 * false in a real non-Tauri browser page), Svelte 5.55.1 itself
 * (production-conditioned by `vite build`'s default mode).
 *
 * METHOD — phase attribution without touching risuSave.ts's source:
 * `RisuSaveEncoder.set()`'s per-character loop calls `JSON.stringify(character)`
 * itself (not inside `encodeBlock`), then calls `this.encodeBlock(...)`,
 * which internally does TextEncoder + CRC32 + buffer assembly, then
 * `await risuSaveCacheForage.setItem(...)`. Three non-invasive monkey-patches
 * (JS-level function reassignment, not a source edit) isolate each phase
 * during ONE real, unmodified `encoder.set()` call:
 *   1. `JSON.stringify` is wrapped globally; a call is bucketed as
 *      "character" iff its argument has a `chaId` own/inherited property
 *      (true only for character objects on this path — the other
 *      `JSON.stringify` call inside `set()`, the final root/`__directory`
 *      object, has no `chaId`) -> phase (a).
 *   2. `RisuSaveEncoder.prototype.encodeBlock` is wrapped; a call is
 *      bucketed as "character" iff `arg.name` is one of this fixture's
 *      chaIds -> phase (b)+(c) combined (TextEncoder+CRC32+buffer assembly
 *      AND the awaited IndexedDB write both happen inside it).
 *   3. `localforage.createInstance` is wrapped BEFORE risuSave.ts is
 *      imported (via a deferred dynamic `import()`, so ESM module-evaluation
 *      order guarantees the patch is live before risuSave.ts's own top-level
 *      `localforage.createInstance('risuSaveCache')` call runs); the
 *      returned instance's `setItem` is wrapped, bucketed the same way by
 *      the `risuSaveBlock_<chaId>` key -> phase (c) alone.
 * Phase (b) alone = (2) − (c). Phase (d) ("anything else inside set()") =
 * total set() wall time − phase (a) − (phase (b)+(c) combined) — i.e.
 * whatever's left after subtracting every character's stringify+encodeBlock
 * time from the whole call: the `Object.keys(data)` filter loop, the
 * `toSave.character.indexOf`/`.splice` bookkeeping per character, and the
 * final root block's own (tiny) `JSON.stringify`+`encodeBlock`.
 *
 * Read-only w.r.t. `src/` — every import from `src/ts/...` below is the real,
 * unmodified module (or one of the two documented sibling stubs).
 */
import localforage from 'localforage'
import { buildManyCharactersFixture } from './character-scaling-fixture'
import { mulberry32, SEED } from './build'
import {
    resetYieldInstrumentation,
    getActualYieldTimestamps,
} from './chore17-stub-saveyield-instrumented'
import { createYieldBudget as realCreateYieldBudgetDirect, yieldToEventLoop as yieldToEventLoopDirect } from 'src/ts/storage/saveYield'

declare global {
    interface Window {
        __CHORE17_DONE__?: boolean
        __CHORE17_RESULTS__?: unknown
        __CHORE17_ERROR__?: string
        gc?: () => void
    }
}

// ---------------------------------------------------------------------------
// Phase-tagging state, shared by the three monkey-patches below.
// ---------------------------------------------------------------------------
let chaIdSet = new Set<string>()

let charStringifyMs = 0
let otherStringifyMs = 0
let charStringifyCount = 0
function resetStringifyCounters() { charStringifyMs = 0; otherStringifyMs = 0; charStringifyCount = 0 }

let charEncodeBlockMs = 0
let otherEncodeBlockMs = 0
let charEncodeBlockCount = 0
function resetEncodeBlockCounters() { charEncodeBlockMs = 0; otherEncodeBlockMs = 0; charEncodeBlockCount = 0 }

let idbCharMs = 0
let idbOtherMs = 0
let idbCharCount = 0
function resetIdbCounters() { idbCharMs = 0; idbOtherMs = 0; idbCharCount = 0 }

// Per-character (stringify + encodeBlock) combined duration, to check the
// coordinator's bound directly: "the largest single block's
// stringify-plus-encode time in this run".
let lastStringifyDurationByChaId = new Map<string, number>()
let maxCombinedCharacterMs = 0
function resetMaxCombinedTracking() { lastStringifyDurationByChaId = new Map(); maxCombinedCharacterMs = 0 }

// ---------------------------------------------------------------------------
// CHORE-17 skip re-measurement: slice reconstruction now has TWO kinds of
// yield points, not one. A skipped block (bytes unchanged) crosses no
// `setItem` macrotask boundary at all -- its only possible yield point is
// `saveYield.ts`'s budgeted `maybeYield()` (real only every ~8ms of
// skips, per `createYieldBudget`'s own doc comment). Both are timestamped
// the same way ({enter, resolve}) and merged into one chronological
// timeline below -- JS is single-threaded, so pushes from either patch
// already land in wall-clock order.
// ---------------------------------------------------------------------------
let sliceRecordingEnabled = false
let sliceRecords: { enter: number; resolve: number; kind: 'write' | 'yield' }[] = []
function resetSliceRecording() { sliceRecords = []; resetYieldInstrumentation() }
/** slice[0] = enter[0]-callStart; slice[i] = enter[i]-resolve[i-1]; a final tail slice is appended. */
function computeSlices(records: { enter: number; resolve: number }[], callStart: number, callEnd: number): number[] {
    const sorted = [...records].sort((a, b) => a.enter - b.enter)
    const slices: number[] = []
    let prevResolve = callStart
    for (const r of sorted) {
        slices.push(r.enter - prevResolve)
        prevResolve = r.resolve
    }
    slices.push(callEnd - prevResolve)
    return slices
}

// PerformanceObserver('longtask') -- the coordinator's suggested "more
// honest" measure. Spec floor is 50ms (the API reports nothing between
// 16-50ms), so it cross-checks this harness's own >50ms slice count only;
// the >16ms bucket still needs the manual slice reconstruction above.
let longTaskEntries: number[] = []
let longTaskObserver: PerformanceObserver | null = null
function startLongTaskObserver(): void {
    longTaskEntries = []
    if (typeof PerformanceObserver === 'undefined') return
    try {
        longTaskObserver = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) longTaskEntries.push(entry.duration)
        })
        longTaskObserver.observe({ entryTypes: ['longtask'] })
    } catch {
        longTaskObserver = null
    }
}
function stopLongTaskObserver(): number[] {
    longTaskObserver?.disconnect()
    longTaskObserver = null
    return longTaskEntries
}

// ---------------------------------------------------------------------------
// Patch 1/3: localforage.createInstance, BEFORE risuSave.ts is imported.
// ---------------------------------------------------------------------------
// IMPORTANT ORDERING NOTE (found by running this harness, not assumed):
// localforage's OWN `LocalForage` constructor kicks off ASYNCHRONOUS driver
// setup (`setDriver()` -> `getDriver().then(extendSelfWithDriver)` ->
// `self._extend(driver)`), which overwrites `inst.setItem` with the real
// driver's implementation a few microtasks AFTER `createInstance()` returns.
// Patching `inst.setItem` synchronously right after `createInstance()`
// (the first thing this file tried) gets silently clobbered by that later
// internal assignment -- every timed call then runs the REAL unwrapped
// setItem, and phase (c) always reads exactly 0. Fix: wrap only after
// `inst.ready()` resolves, which -- confirmed by reading
// localforage/dist/localforage.js's `ready()`/`setDriver()` -- only settles
// AFTER `_extend(driver)` has already run, so nothing overwrites the wrapper
// afterward. `cacheForageReadyPromise` lets main() await this before timing
// starts.
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
            const dt = resolve - enter
            const m = /^risuSaveBlock_(.+)$/.exec(key)
            if (m && chaIdSet.has(m[1])) { idbCharMs += dt; idbCharCount++ } else { idbOtherMs += dt }
            if (sliceRecordingEnabled) sliceRecords.push({ enter, resolve, kind: 'write' })
            return result
        } as typeof inst.setItem
    })
    return inst
}

// Deferred dynamic import: static imports in this module would be hoisted
// and evaluated BEFORE the patch above runs, which is exactly the ordering
// bug this avoids (same trap `Agents/Tools/README.md` documents for split
// `vi.mock` factories, same underlying cause — an ES module's top-level
// `localforage.createInstance('risuSaveCache')` call, which in risuSave.ts
// runs at module-evaluation time, not lazily).
const risuSaveMod = await import('src/ts/storage/risuSave')
const { RisuSaveEncoder } = await import('src/ts/storage/tests/risuSaveEncoder')
type ToSaveType = import('src/ts/storage/risuSave').toSaveType

// ---------------------------------------------------------------------------
// Patch 2/3: RisuSaveEncoder.prototype.encodeBlock (phase b+c combined).
// ---------------------------------------------------------------------------
const realEncodeBlock = RisuSaveEncoder.prototype.encodeBlock
RisuSaveEncoder.prototype.encodeBlock = async function patchedEncodeBlock(this: any, arg: any, option: any) {
    const t0 = performance.now()
    const result = await realEncodeBlock.call(this, arg, option)
    const dt = performance.now() - t0
    if (chaIdSet.has(arg.name)) {
        charEncodeBlockMs += dt
        charEncodeBlockCount++
        const stringifyDt = lastStringifyDurationByChaId.get(arg.name) ?? 0
        const combined = stringifyDt + dt
        if (combined > maxCombinedCharacterMs) maxCombinedCharacterMs = combined
    } else { otherEncodeBlockMs += dt }
    return result
} as typeof realEncodeBlock

// ---------------------------------------------------------------------------
// Patch 3/3: JSON.stringify (phase a).
// ---------------------------------------------------------------------------
const realStringify = JSON.stringify
JSON.stringify = function patchedStringify(value: any, ...rest: any[]) {
    const t0 = performance.now()
    // eslint-disable-next-line prefer-spread
    const result = realStringify.apply(JSON, [value, ...rest] as any)
    const dt = performance.now() - t0
    if (value !== null && typeof value === 'object' && 'chaId' in value) {
        charStringifyMs += dt
        charStringifyCount++
        lastStringifyDurationByChaId.set((value as { chaId: string }).chaId, dt)
    } else {
        otherStringifyMs += dt
    }
    return result
} as typeof JSON.stringify

// ---------------------------------------------------------------------------
// Helpers
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
function heapUsed(): number {
    const mem = (performance as unknown as { memory?: { usedJSHeapSize?: number } }).memory
    return mem && typeof mem.usedJSHeapSize === 'number' ? mem.usedJSHeapSize : NaN
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

// ---------------------------------------------------------------------------
// JSON-semantics deep compare (layer 1 candidate) — see reply for the
// semantics this covers and does not cover.
// ---------------------------------------------------------------------------
function toJSONIfPresent(v: any): any {
    return v !== null && typeof v === 'object' && typeof v.toJSON === 'function' ? v.toJSON() : v
}
function isNonFiniteNumber(v: any): boolean {
    return typeof v === 'number' && !Number.isFinite(v)
}
/** Normalizes a value the way JSON.stringify would AT A POSITION where some value must be emitted (array element or a value already known to be an object property with a defined value) — undefined/function/symbol/NaN/+-Infinity all collapse to what JSON.stringify would render as `null` in that position. */
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
/** Own string keys whose value is defined (JSON.stringify drops undefined/function/symbol-valued object properties entirely — NOT the same rule as array elements, which become `null` instead of being dropped). Reads `o[k]` via bracket access (not a descriptor), so a Svelte Proxy's `get` trap fires exactly as it would for `JSON.stringify`. */
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
        if (ak[i] !== bk[i]) return false // key-order sensitive, matching JSON.stringify's own output byte-for-byte
    }
    for (const k of ak) {
        if (!jsonValueEqual(a[k], b[k])) return false
    }
    return true
}
function stringifyEqual(a: any, b: any): boolean {
    return realStringify(a) === realStringify(b)
}

// ---------------------------------------------------------------------------
// Self-check: known JSON.stringify edge cases the compare above claims to
// cover. Logged, not thrown — a failure here invalidates the "correctness"
// claim in the reply and must be surfaced, not hidden.
// ---------------------------------------------------------------------------
function selfCheckJsonSemantics(): { name: string; pass: boolean }[] {
    const cases: { name: string; a: any; b: any; expect: boolean }[] = [
        { name: 'undefined property is dropped (object)', a: { x: 1, y: undefined }, b: { x: 1 }, expect: true },
        { name: 'undefined array element becomes null', a: [1, undefined, 3], b: [1, null, 3], expect: true },
        { name: 'NaN becomes null', a: { x: NaN }, b: { x: null }, expect: true },
        { name: 'Infinity becomes null', a: [Infinity, -Infinity], b: [null, null], expect: true },
        { name: 'array vs object with same content differ', a: [1, 2], b: { 0: 1, 1: 2 }, expect: false },
        { name: 'key order matters', a: { x: 1, y: 2 }, b: { y: 2, x: 1 }, expect: false },
        { name: 'function property is dropped', a: { x: 1, f: () => 1 }, b: { x: 1 }, expect: true },
        { name: 'nested deep leaf difference is caught', a: { c: { d: [{ e: 1 }] } }, b: { c: { d: [{ e: 2 }] } }, expect: false },
        { name: 'string vs number differ', a: { x: '1' }, b: { x: 1 }, expect: false },
        { name: 'deeply equal large-ish object', a: { arr: [1, 2, { z: 'q' }], s: 'abc' }, b: { arr: [1, 2, { z: 'q' }], s: 'abc' }, expect: true },
    ]
    return cases.map((c) => {
        const got = jsonValueEqual(c.a, c.b)
        const groundTruth = stringifyEqual(c.a, c.b)
        return { name: c.name, pass: got === c.expect && got === groundTruth }
    })
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
    const CHARACTER_COUNT = 1000
    const TOTAL_MESSAGES = 150000
    const WARMUP = 2
    const MEASURED = 5

    const results: any = { hardware: 'reported by driver script', chromeUserAgent: navigator.userAgent }

    // --- self-check first ---
    const selfCheck = selfCheckJsonSemantics()
    results.selfCheck = selfCheck

    // --- build fixture ---
    const t0build = performance.now()
    const { characters: rawCharacters, stats } = buildManyCharactersFixture({
        characterCount: CHARACTER_COUNT,
        totalMessages: TOTAL_MESSAGES,
        seedOffset: 71000,
    })
    results.fixtureStats = stats
    results.fixtureBuildMs = performance.now() - t0build

    const liveClone = structuredClone(rawCharacters)
    // Real Svelte 5 $state() proxy — this file's `.svelte.` infix is what
    // makes vite-plugin-svelte compile this rune for real.
    const dbState = $state(buildDbShape(liveClone)) as any
    const allChaIds = liveClone.map((c) => c.chaId as string)
    chaIdSet = new Set(allChaIds)

    function makeAllMarkedTracker(): ToSaveType {
        return { character: [...allChaIds], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
    }

    // Wait for localforage's async driver setup (see the ordering note above
    // the createInstance patch) to finish installing the setItem wrapper
    // before any encoder call that would otherwise be measured unwrapped.
    await cacheForageReadyPromise

    // --- warm the encoder exactly like saveDb() does at boot (untimed) ---
    const encoder = new RisuSaveEncoder()
    await encoder.init(dbState, { compression: false })

    // ============================================================
    // Item 1: phase breakdown of one all-N set()
    // ============================================================
    const totalSamples: number[] = []
    const aSamples: number[] = []
    const bSamples: number[] = []
    const cSamples: number[] = []
    const dSamples: number[] = []
    const heapDeltaSamples: number[] = []
    const charStringifyCountSamples: number[] = []
    const longestSliceSamples: number[] = []
    const over16Samples: number[] = []
    const over50Samples: number[] = []
    const longTaskOver50Samples: number[] = []
    const yieldActualCountSamples: number[] = []
    const idbWriteCountSamples: number[] = []
    const maxCombinedCharacterMsSamples: number[] = []

    /**
     * Runs one real `encoder.set()` call. `tracker` is caller-supplied (not
     * always all-N marked-but-unchanged) so this same function drives both
     * the CHORE-17 skip re-measurement item 1 (all-N, unchanged) and item 2
     * (all-N marked, exactly one changed).
     */
    async function oneSetRun(tracker: ToSaveType, record: boolean) {
        resetStringifyCounters()
        resetEncodeBlockCounters()
        resetIdbCounters()
        resetSliceRecording()
        resetMaxCombinedTracking()
        sliceRecordingEnabled = record
        startLongTaskObserver()
        await forceGc()
        const heapBefore = heapUsed()
        const t0 = performance.now()
        await encoder.set(dbState, tracker)
        const t1 = performance.now()
        const longTasks = stopLongTaskObserver()
        sliceRecordingEnabled = false
        await forceGc()
        const heapAfter = heapUsed()
        const idbWriteCount = idbCharCount
        if (record) {
            const total = t1 - t0
            const a = charStringifyMs
            const cVal = idbCharMs
            const bVal = charEncodeBlockMs - idbCharMs
            const dVal = total - a - charEncodeBlockMs
            totalSamples.push(total)
            aSamples.push(a)
            bSamples.push(bVal)
            cSamples.push(cVal)
            dSamples.push(dVal)
            heapDeltaSamples.push(heapAfter - heapBefore)
            charStringifyCountSamples.push(charStringifyCount)

            const mergedRecords = [...sliceRecords, ...getActualYieldTimestamps().map((r) => ({ ...r, kind: 'yield' as const }))]
            const slices = computeSlices(mergedRecords, t0, t1)
            longestSliceSamples.push(Math.max(...slices))
            over16Samples.push(slices.filter((x) => x > 16).length)
            over50Samples.push(slices.filter((x) => x > 50).length)
            longTaskOver50Samples.push(longTasks.filter((x) => x > 50).length)
            yieldActualCountSamples.push(getActualYieldTimestamps().length)
            idbWriteCountSamples.push(idbWriteCount)
            maxCombinedCharacterMsSamples.push(maxCombinedCharacterMs)
        }
        return { idbWriteCount }
    }

    for (let i = 0; i < WARMUP; i++) await oneSetRun(makeAllMarkedTracker(), false)
    for (let i = 0; i < MEASURED; i++) await oneSetRun(makeAllMarkedTracker(), true)

    // Retained-bytes finding (question 3): read the encoder's private
    // `blocks` map at runtime (TS privacy is compile-time only) to confirm
    // and size what it actually retains after a real set().
    const blocksMap: Record<string, Uint8Array> = (encoder as any).blocks
    const blockKeys = Object.keys(blocksMap)
    let totalBlockBytes = 0
    let characterBlockBytes = 0
    for (const k of blockKeys) {
        totalBlockBytes += blocksMap[k].byteLength
        if (chaIdSet.has(k)) characterBlockBytes += blocksMap[k].byteLength
    }

    results.setPhaseBreakdown = {
        scenario: 'all-N marked, ALL unchanged (nothing mutates dbState.characters between encoder.init() and every encoder.set() call below, including warmup runs, so every character block hits the CHORE-17 skip path from the very first measured run onward)',
        totalMs: summarize(totalSamples),
        phaseA_stringifyThroughProxy: summarize(aSamples),
        phaseB_encodePlusCompareCombined: summarize(bSamples),
        phaseC_indexedDbWrite: summarize(cSamples),
        phaseD_everythingElse: summarize(dSamples),
        longestSliceMs: summarize(longestSliceSamples),
        slicesOver16msPerRun: summarize(over16Samples),
        slicesOver50msPerRun: summarize(over50Samples),
        longtaskApiOver50msPerRun: summarize(longTaskOver50Samples),
        actualYieldCountPerRun: summarize(yieldActualCountSamples),
        indexedDbWriteCountPerRun: summarize(idbWriteCountSamples),
        maxCombinedCharacterStringifyPlusEncodeMs: summarize(maxCombinedCharacterMsSamples),
        heapDeltaBytes: summarize(heapDeltaSamples),
        charStringifyCountPerRun: summarize(charStringifyCountSamples),
        comparisonToPreSkipFigures: {
            totalMs: { before: 1155.2, after: median(totalSamples) },
            indexedDbMs: { before: 417.7, after: median(cSamples) },
            longestSliceMs: { before: 43.9, after: median(longestSliceSamples) },
            slicesOver16ms: { before: 10, after: median(over16Samples) },
        },
        note: "phaseB is now encode+compare COMBINED (TextEncoder+CRC32+buffer assembly AND rawBlockBytesEqual both happen inside encodeBlock, before the skip decision -- see item 3's standalone replica for compare cost alone). phaseD = total - phaseA - (phaseB+phaseC); bundles the final root block's own tiny work plus indexOf/splice/Object.keys bookkeeping. Slicing now merges TWO DIRECT yield-point sources: real risuSaveCacheForage.setItem completions (real writes) and real saveYield.ts yieldFn invocations -- i.e. every time the internal budget branch was actually taken, recorded via createYieldBudget's own opts.yieldFn extension point, NOT inferred from resume latency (an earlier, WRONG version of this harness used a duration threshold and undercounted real yields whose resume happened to be fast). maxCombinedCharacterStringifyPlusEncodeMs is the largest single character's own (JSON.stringify + encodeBlock) time this run -- the bound the longest slice should not exceed by more than one budget window (8ms) if no yields are being missed.",
    }
    results.retainedBlocks = {
        blockCount: blockKeys.length,
        totalBlockBytes,
        characterBlockBytes,
        note: 'encoder["blocks"] (private field, read via bracket access) after a real set() — confirms what RisuSaveEncoder retains in memory between saves.',
    }

    // ============================================================
    // CHORE-17 skip re-measurement, item 2: same all-N set(), but exactly
    // one character's content actually differs from what's cached. Mutates
    // a FRESH field on a LIVE proxied character each repeat (so this run's
    // content really differs from whatever this.blocks currently holds,
    // including from the previous repeat's own write), then marks all N and
    // times the real set() call.
    // ============================================================
    const rngOneChanged = mulberry32(SEED + 88000)
    const oneChangedTotalSamples: number[] = []
    const oneChangedLongestSliceSamples: number[] = []
    const oneChangedWriteCountSamples: number[] = []
    for (let i = 0; i < WARMUP + MEASURED; i++) {
        const chaIdx = Math.floor(rngOneChanged() * dbState.characters.length)
        const chats = dbState.characters[chaIdx].chats
        const chatIdx = Math.floor(rngOneChanged() * chats.length)
        const messages = chats[chatIdx].message
        const msgIdx = Math.floor(rngOneChanged() * messages.length)
        messages[msgIdx].data = messages[msgIdx].data + ` CHANGED-${i}`

        const tracker = makeAllMarkedTracker()
        resetSliceRecording()
        resetIdbCounters()
        const record = i >= WARMUP
        sliceRecordingEnabled = record
        startLongTaskObserver()
        const t0 = performance.now()
        await encoder.set(dbState, tracker)
        const t1 = performance.now()
        stopLongTaskObserver()
        sliceRecordingEnabled = false
        if (record) {
            oneChangedTotalSamples.push(t1 - t0)
            const merged = [...sliceRecords, ...getActualYieldTimestamps().map((r) => ({ ...r, kind: 'yield' as const }))]
            oneChangedLongestSliceSamples.push(Math.max(...computeSlices(merged, t0, t1)))
            oneChangedWriteCountSamples.push(idbCharCount)
        }
    }
    results.oneCharacterChanged = {
        totalMs: summarize(oneChangedTotalSamples),
        longestSliceMs: summarize(oneChangedLongestSliceSamples),
        indexedDbWriteCountPerRun: summarize(oneChangedWriteCountSamples),
        note: 'exactly one deep leaf mutated (a fresh field each repeat, so it never coincidentally matches a stale cached value) on a LIVE proxied character just before each set() call. indexedDbWriteCountPerRun should read exactly 1 if the skip correctly leaves every OTHER unchanged character alone.',
    }

    // ============================================================
    // CHORE-17 skip re-measurement, item 3: the cost of the byte
    // comparison alone, summed over all blocks. rawBlockBytesEqualReplica
    // below is a byte-for-byte REPLICA of risuSave.ts's own (unexported,
    // so it cannot be imported or monkey-patched) rawBlockBytesEqual --
    // confirmed identical by reading that function immediately before
    // writing this copy. Applied to REAL data: existing is read straight
    // out of the encoder's own this.blocks[chaId] (left untouched by a
    // direct encodeBlock() call -- only set()'s own loop reassigns
    // this.blocks), and candidate is a freshly built buffer from a real
    // encoder.encodeBlock() call on the same unchanged character data.
    // ============================================================
    function rawBlockBytesEqualReplica(a: Uint8Array, b: Uint8Array): boolean {
        if (a.length !== b.length) return false
        const length = a.length
        if (a.byteOffset === 0 && b.byteOffset === 0) {
            const wordCount = length >>> 2
            const aWords = new Uint32Array(a.buffer, 0, wordCount)
            const bWords = new Uint32Array(b.buffer, 0, wordCount)
            for (let i = 0; i < wordCount; i++) {
                if (aWords[i] !== bWords[i]) return false
            }
            for (let i = wordCount * 4; i < length; i++) {
                if (a[i] !== b[i]) return false
            }
            return true
        }
        for (let i = 0; i < length; i++) {
            if (a[i] !== b[i]) return false
        }
        return true
    }
    // RisuSaveType.CHARACTER_WITH_CHAT's numeric value (2), read from the
    // real (unexported) enum in risuSave.ts -- hardcoded here since the enum
    // itself cannot be imported, only its type.
    const CHARACTER_WITH_CHAT_TYPE = 2
    const compareOnlyTotalSamples: number[] = []
    for (let rep = 0; rep < MEASURED; rep++) {
        let sum = 0
        for (const character of dbState.characters as Record<string, unknown>[]) {
            const chaId = character.chaId as string
            const existing = (encoder as any).blocks[chaId] as Uint8Array
            const candidate = await encoder.encodeBlock(
                { compression: false, data: realStringify(character), type: CHARACTER_WITH_CHAT_TYPE as any, name: chaId },
                { remote: 'prefer' },
            )
            const t0 = performance.now()
            rawBlockBytesEqualReplica(candidate, existing)
            sum += performance.now() - t0
        }
        compareOnlyTotalSamples.push(sum)
    }
    results.compareOnlyCostSummedOverAllBlocks = {
        totalMsPerRun: summarize(compareOnlyTotalSamples),
        note: 'summed over all 1000 character blocks per run; a standalone replica of rawBlockBytesEqual, not the live monkey-patched call (that function is unexported and cannot be intercepted from outside) -- see comment above for why this is still real data.',
    }

    // ============================================================
    // CHORE-17 skip re-measurement, item 4 (informational): does gzip
    // (CompressionStream) produce identical bytes for identical input in
    // this Chromium? Not exercised by the main measurements above
    // (compression:false throughout), but relevant to whether a FUTURE
    // compression:true skip-compare could rely on encoder determinism.
    // ============================================================
    async function gzipOnce(text: string): Promise<Uint8Array> {
        const cs = new CompressionStream('gzip')
        const writer = cs.writable.getWriter()
        writer.write(new TextEncoder().encode(text))
        writer.close()
        const buf = await new Response(cs.readable).arrayBuffer()
        return new Uint8Array(buf)
    }
    const gzipSampleText = realStringify(dbState.characters[0])
    const gzipA = await gzipOnce(gzipSampleText)
    const gzipB = await gzipOnce(gzipSampleText)
    let gzipBytesEqual = gzipA.length === gzipB.length
    if (gzipBytesEqual) {
        for (let i = 0; i < gzipA.length; i++) {
            if (gzipA[i] !== gzipB[i]) { gzipBytesEqual = false; break }
        }
    }
    results.gzipDeterminism = {
        sameLength: gzipA.length === gzipB.length,
        identicalBytes: gzipBytesEqual,
        lengthA: gzipA.length,
        lengthB: gzipB.length,
        note: "same character JSON, compressed twice via CompressionStream('gzip') in this Chromium session, compared byte-for-byte.",
    }

    // ============================================================
    // Diagnostic A (corrected): a STANDALONE, isolated sanity check of the
    // REAL `createYieldBudget` (imported directly, not through the
    // risuSave.ts redirect), using the SAME direct yieldFn-injection method
    // as the main measurement below -- no duration threshold anywhere.
    // Loops calling `maybeYield()` after ~0.7ms of synchronous busy-work
    // each (matching this fixture's real phaseA+phaseB per-character
    // average), for enough iterations to exceed the 8ms budget several
    // times over.
    // ============================================================
    function busyWaitMs(ms: number): void {
        const end = performance.now() + ms
        while (performance.now() < end) { /* spin */ }
    }
    const directYieldTimestamps: { enter: number; resolve: number }[] = []
    const directBudget = realCreateYieldBudgetDirect({
        yieldFn: async () => {
            const enter = performance.now()
            await yieldToEventLoopDirect()
            directYieldTimestamps.push({ enter, resolve: performance.now() })
        },
    })
    const directLoopStart = performance.now()
    for (let i = 0; i < 200; i++) {
        busyWaitMs(0.7)
        await directBudget.maybeYield()
    }
    const directLoopTotalMs = performance.now() - directLoopStart
    results.standaloneYieldBudgetDiagnostic = {
        note: 'REAL createYieldBudget, imported directly (not through the risuSave.ts redirect), called 200 times after ~0.7ms of synchronous busy-work each (~140ms total busy-work, budgetMs defaults to 8) -- isolates the mechanism from encodeRawBlock entirely. actualYieldCount counts direct yieldFn invocations (budget branch taken), not inferred from resume latency.',
        totalLoopMs: directLoopTotalMs,
        callCount: 200,
        actualYieldCount: directYieldTimestamps.length,
        expectedApproxYieldCount: Math.floor(directLoopTotalMs / 8),
    }

    // ============================================================
    // Diagnostic B: does PerformanceObserver('longtask') even work in this
    // headless setup? A deliberate ~100ms synchronous busy loop MUST be
    // reported as a longtask if the observer works at all -- if it isn't,
    // every longtaskApiOver50msPerRun figure elsewhere in this report is
    // meaningless and should be disclosed as such, not quietly trusted.
    // ============================================================
    startLongTaskObserver()
    busyWaitMs(100)
    await new Promise((resolve) => setTimeout(resolve, 0)) // let the observer's callback (a microtask/task) actually run before reading it
    const selfTestLongTasks = stopLongTaskObserver()
    results.longtaskObserverSelfTest = {
        note: "a deliberate ~100ms synchronous busy loop, observed the same way as the main measurements -- if this does not show at least one entry > 50ms, PerformanceObserver('longtask') is not functioning in this headless setup and every longtaskApiOver50msPerRun figure elsewhere should be treated as unavailable, not as a real zero.",
        entriesMs: selfTestLongTasks,
        working: selfTestLongTasks.some((d) => d > 50),
    }

    // Raw (non-proxied) stringify comparison, standalone (not inside set()).
    const rawStringifySamples: number[] = []
    for (let i = 0; i < MEASURED; i++) {
        const freshRaw = structuredClone(rawCharacters)
        const t0 = performance.now()
        for (const c of freshRaw) realStringify(c)
        rawStringifySamples.push(performance.now() - t0)
    }
    results.rawObjectStringifyAllN = summarize(rawStringifySamples)

    // ============================================================
    // Item 2: layer-1 compare cost
    // ============================================================
    const rng = mulberry32(SEED + 99000)

    function buildIncomingAllEqual(): Record<string, unknown>[] {
        return structuredClone(rawCharacters)
    }
    /** Mutates exactly one leaf, at a random depth, inside one randomly chosen character's chats. */
    function buildIncomingOneDiff(): { incoming: Record<string, unknown>[]; mutated: { chaIdx: number; chatIdx: number; msgIdx: number } } {
        const incoming = structuredClone(rawCharacters)
        const chaIdx = Math.floor(rng() * incoming.length)
        const chats = (incoming[chaIdx] as any).chats as any[]
        const chatIdx = Math.floor(rng() * chats.length)
        const messages = chats[chatIdx].message as any[]
        const msgIdx = Math.floor(rng() * messages.length)
        messages[msgIdx].data = messages[msgIdx].data + ' MUTATED'
        return { incoming, mutated: { chaIdx, chatIdx, msgIdx } }
    }

    function timeCompareLoop(incoming: Record<string, unknown>[], compareFn: (a: any, b: any) => boolean): { ms: number; equalCount: number } {
        const t0 = performance.now()
        let equalCount = 0
        for (let i = 0; i < incoming.length; i++) {
            if (compareFn(incoming[i], dbState.characters[i])) equalCount++
        }
        return { ms: performance.now() - t0, equalCount }
    }

    async function measureScenario(label: string, buildIncoming: () => Record<string, unknown>[]) {
        const walkMs: number[] = []
        const stringifyMs: number[] = []
        const heapDelta: number[] = []
        let equalCountWalk = -1
        let equalCountStringify = -1
        for (let i = 0; i < MEASURED; i++) {
            const incoming = buildIncoming()
            await forceGc()
            const hBefore = heapUsed()
            const walk = timeCompareLoop(incoming, jsonValueEqual)
            const hAfter = heapUsed()
            heapDelta.push(hAfter - hBefore)
            walkMs.push(walk.ms)
            equalCountWalk = walk.equalCount
            const strRes = timeCompareLoop(incoming, stringifyEqual)
            stringifyMs.push(strRes.ms)
            equalCountStringify = strRes.equalCount
        }
        return {
            label,
            recursiveWalk: summarize(walkMs),
            stringifyBothSides: summarize(stringifyMs),
            heapDeltaBytes: summarize(heapDelta),
            equalCountWalk,
            equalCountStringify,
            agree: equalCountWalk === equalCountStringify,
        }
    }

    const allEqualResult = await measureScenario('all 1000 equal', buildIncomingAllEqual)
    let mutatedInfo: any = null
    const oneDiffResult = await measureScenario('exactly one deep leaf differs', () => {
        const built = buildIncomingOneDiff()
        mutatedInfo = built.mutated
        return built.incoming
    })

    results.layer1Compare = {
        allEqual: allEqualResult,
        oneDifferent: { ...oneDiffResult, mutatedAt: mutatedInfo },
    }

    // ============================================================
    // Item 3: layer-2 fraction (derived from item 1's medians)
    // ============================================================
    const medA = median(aSamples)
    const medB = median(bSamples)
    const medC = median(cSamples)
    results.layer2Fraction = {
        medianPhaseA_ms: medA,
        medianPhaseB_ms: medB,
        medianPhaseC_ms: medC,
        skippableFraction_cOverABC: medC / (medA + medB + medC),
        unavoidableFraction_abOverABC: (medA + medB) / (medA + medB + medC),
        note: 'remote write is opt-in and off by default in this fixture (isTauri=false, isNodeServer=false) — not measured, only noted per the task.',
    }

    results.fixtureStats = stats
    window.__CHORE17_RESULTS__ = results
    window.__CHORE17_DONE__ = true
}

main().catch((err) => {
    window.__CHORE17_ERROR__ = (err && err.stack) ? err.stack : String(err)
    window.__CHORE17_DONE__ = true
})
