/**
 * Measurement hooks for the character put-back (`characterPutBack.ts`): reason
 * counters, durations, fingerprint costs, candidate waits and an optional
 * late-write tripwire. Everything is kept in memory as plain data and read
 * through `globalThis.__risuPutBackMeasure`; nothing is persisted and nothing is
 * logged, because a build strips console output.
 *
 * Callers wrap every recording call in `if (MEASURE)`, so a normal build drops
 * them. This module must not import `characterPutBack.ts` or `coldRetained.ts`
 * (the latter records into it): `characterPutBack.ts` registers a provider for
 * what it owns.
 */

import { MEASURE } from './measureFlag'
import { restoredBytesOutside } from './restoredBytes'

/** Why a candidate was or was not put back. */
export type PutBackReason = 'clean' | 'dirty' | 'busy' | 'writing' | 'kept' | 'gone'
/** The reasons plus: candidates dropped without a verdict, and dirty verdicts with no differing key (a fingerprint artefact, not an edit). */
type CounterName = PutBackReason | 'cleared' | 'dirtyNoKeys'
/**
 * What one `fire` did. 'kept-only' is a fire that fingerprinted nothing and
 * dropped candidates (kept in the keep-set, or gone from the list); 'empty' is a
 * fire with nothing to do, or an early exit that cleared the waiting candidates.
 */
export type FireOutcome = 'fingerprinted' | 'busy' | 'writing' | 'kept-only' | 'empty'
/** 'fire-keyhash' is the per-key hash cost of a dirty verdict, which a normal build does not pay and a fire's duration excludes. */
export type FingerprintSource = 'restore' | 'restore-keyhash' | 'fire' | 'fire-keyhash' | 'tripwire'
export type CandidateExit = 'swap' | 'dirty' | 'kept' | 'gone' | 'cleared-selection' | 'cleared-early'

/** What `characterPutBack.ts` owns and this module reads at snapshot time or on a tripwire commit. */
export interface PutBackProvider {
    keepSet(): ReadonlySet<string>
    retainedCount(): number
    fingerprint(cha: object): string
    differingKeys(keyHashes: Record<string, string> | undefined, cha: object): string[]
}

const RING = 512
const DIRTY_SAMPLES = 32
const ID_SPAN = 1e6
/** A tripwire watches a replaced character for this many save commits. */
export const TRIPWIRE_COMMITS = 3

interface Ring<T> {
    items: T[]
    next: number
}

function newRing<T>(): Ring<T> {
    return { items: [], next: 0 }
}

function push<T>(ring: Ring<T>, item: T): void {
    if (ring.items.length < RING) {
        ring.items.push(item)
    } else {
        ring.items[ring.next] = item
        ring.next = (ring.next + 1) % RING
    }
}

interface FireSample { ms: number, outcome: FireOutcome }
interface FingerprintSample { ms: number, length: number, source: FingerprintSource }
interface WaitSample { ms: number, exit: CandidateExit }
interface DirtySample { chaId: string, keys: string[] }
interface LateWrite { chaId: string, keys: string[], atCommit: number }
interface TripEntry {
    readonly chaId: string
    readonly fp: string
    readonly keyHashes: Record<string, string> | undefined
    readonly ref: WeakRef<object>
    /** The plain object the reactive `ref` wraps without copying; either one alive means the full character is still held. */
    readonly rawRef: WeakRef<object> | undefined
    commits: number
    flagged: boolean
}

function zeroCounters(): Record<CounterName, number> {
    return { clean: 0, dirty: 0, busy: 0, writing: 0, kept: 0, gone: 0, cleared: 0, dirtyNoKeys: 0 }
}

let counters = zeroCounters()
let fires = newRing<FireSample>()
let fingerprints = newRing<FingerprintSample>()
let waits = newRing<WaitSample>()
let dirtySamples: DirtySample[] = []
let dirtyByKey: Record<string, number> = {}
/** First time each candidate was added; a re-add keeps it. */
const waitingSince = new Map<string, number>()
let trips: TripEntry[] = []
let lateWrites: LateWrite[] = []
let finalizedProxy = 0
let finalizedRaw = 0
/** Raised by `reset`, so that a registration made before it does not count after it. */
let generation = 0
let registry: FinalizationRegistry<number> | undefined
let provider: PutBackProvider | undefined

export function registerPutBackProvider(next: PutBackProvider): void {
    provider = next
}

export function countReason(name: CounterName): void {
    counters[name] += 1
}

export function readReasonCounters(): Record<PutBackReason, number> {
    const { clean, dirty, busy, writing, kept, gone } = counters
    return { clean, dirty, busy, writing, kept, gone }
}

export function noteFire(outcome: FireOutcome, ms: number): void {
    push(fires, { ms, outcome })
}

/** The length is the first field of the fingerprint label, so no second pass over the character is needed. */
export function noteFingerprint(source: FingerprintSource, ms: number, label: string): void {
    const length = parseInt(label, 10)
    push(fingerprints, { ms, length: Number.isFinite(length) ? length : -1, source })
}

export function noteCandidate(chaId: string): void {
    if (!waitingSince.has(chaId)) {
        waitingSince.set(chaId, performance.now())
    }
}

export function noteCandidateExit(chaId: string, exit: CandidateExit): void {
    const since = waitingSince.get(chaId)
    if (since === undefined) {
        return
    }
    waitingSince.delete(chaId)
    push(waits, { ms: performance.now() - since, exit })
    if (exit === 'cleared-selection' || exit === 'cleared-early') {
        countReason('cleared')
    }
}

/** Tallies the keys a dirty verdict differs in; an empty list is counted apart from edits. */
export function noteDirty(chaId: string, keys: string[]): void {
    if (keys.length === 0) {
        countReason('dirtyNoKeys')
    }
    for (const key of keys) {
        dirtyByKey[key] = (dirtyByKey[key] ?? 0) + 1
    }
    if (dirtySamples.length < DIRTY_SAMPLES) {
        dirtySamples.push({ chaId, keys })
    }
}

/**
 * Starts watching `replaced`, the full character a put-back is about to drop,
 * through a weak reference only: neither the entry nor the registry may keep it
 * alive. Capture `fp` and `keyHashes` before the record is dropped. The caller
 * checks `tripwireEnabled()`, so a run without the tripwire does no weak-reference work.
 */
export function noteReplaced(chaId: string, fp: string, keyHashes: Record<string, string> | undefined, replaced: object, rawRef?: WeakRef<object>): void {
    registry ??= new FinalizationRegistry<number>(onFinalized)
    const id = trips.length
    registry.register(replaced, heldValue(false, id))
    const raw = rawRef?.deref()
    if (raw !== undefined) {
        registry.register(raw, heldValue(true, id))
    }
    trips.push({ chaId, fp, keyHashes, ref: new WeakRef(replaced), rawRef, commits: 0, flagged: false })
}

/** A plain number: the generation, whether it is the raw object, and the entry id. No closure or object is held. Exported for the test of `onFinalized`. */
export function heldValue(raw: boolean, id: number): number {
    return (generation * 2 + (raw ? 1 : 0)) * ID_SPAN + id
}

/** The finalization callback: counts a collected object unless it was registered before the last `reset`. */
export function onFinalized(held: number): void {
    const group = Math.floor(held / ID_SPAN)
    if (Math.floor(group / 2) !== generation) {
        return
    }
    if (group % 2 === 1) {
        finalizedRaw += 1
    } else {
        finalizedProxy += 1
    }
}

/**
 * One save commit for every watched character still inside its window: a
 * character still alive whose fingerprint changed was written after the
 * put-back. Returns whether another commit is wanted.
 */
export function tripwireStep(): boolean {
    let more = false
    for (const entry of trips) {
        if (entry.commits >= TRIPWIRE_COMMITS) {
            continue
        }
        entry.commits += 1
        const target = entry.ref.deref()
        if (target !== undefined && !entry.flagged && provider) {
            const startedAt = performance.now()
            const label = provider.fingerprint(target)
            noteFingerprint('tripwire', performance.now() - startedAt, label)
            if (label !== entry.fp) {
                entry.flagged = true
                lateWrites.push({ chaId: entry.chaId, keys: provider.differingKeys(entry.keyHashes, target), atCommit: entry.commits })
            }
        }
        if (entry.commits < TRIPWIRE_COMMITS) {
            more = true
        }
    }
    return more
}

interface Stats { count: number, p50: number, p95: number, max: number }

function statsOf(values: number[]): Stats {
    if (values.length === 0) {
        return { count: 0, p50: 0, p95: 0, max: 0 }
    }
    const sorted = [...values].sort((a, b) => a - b)
    const at = (q: number): number => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))]
    return { count: sorted.length, p50: at(0.5), p95: at(0.95), max: sorted[sorted.length - 1] }
}

function groupStats<T extends string, S>(samples: S[], tag: (sample: S) => T, ms: (sample: S) => number): Partial<Record<T, Stats>> {
    const groups = new Map<T, number[]>()
    for (const sample of samples) {
        const key = tag(sample)
        const list = groups.get(key) ?? []
        list.push(ms(sample))
        groups.set(key, list)
    }
    const out: Partial<Record<T, Stats>> = {}
    for (const [key, list] of groups) {
        out[key] = statsOf(list)
    }
    return out
}

export function snapshot() {
    const now = performance.now()
    let oldest = 0
    for (const since of waitingSince.values()) {
        oldest = Math.max(oldest, now - since)
    }
    let collected = 0
    let pinned = 0
    let undetermined = 0
    let proxyAlive = 0
    let rawAlive = 0
    for (const entry of trips) {
        const proxyIsAlive = entry.ref.deref() !== undefined
        const rawIsAlive = entry.rawRef?.deref() !== undefined
        proxyAlive += proxyIsAlive ? 1 : 0
        rawAlive += rawIsAlive ? 1 : 0
        if (!proxyIsAlive && !rawIsAlive) {
            collected += 1
        } else if (entry.commits >= TRIPWIRE_COMMITS) {
            pinned += 1
        } else {
            undetermined += 1
        }
    }
    const keep = provider?.keepSet()
    return {
        counters: { ...counters },
        fire: {
            fingerprinting: statsOf(fires.items.filter((s) => s.outcome === 'fingerprinted').map((s) => s.ms)),
            byOutcome: groupStats(fires.items, (s) => s.outcome, (s) => s.ms),
            samples: [...fires.items],
        },
        fingerprint: {
            bySource: groupStats(fingerprints.items, (s) => s.source, (s) => s.ms),
            samples: [...fingerprints.items],
        },
        candidateWait: {
            ...statsOf(waits.items.map((s) => s.ms)),
            byExit: groupStats(waits.items, (s) => s.exit, (s) => s.ms),
            samples: [...waits.items],
            stillPending: waitingSince.size,
            oldestPendingMs: oldest,
        },
        dirty: { byKey: { ...dirtyByKey }, samples: dirtySamples.map((s) => ({ chaId: s.chaId, keys: [...s.keys] })) },
        restoredBytesOutside: restoredBytesOutside(keep),
        retainedCount: provider?.retainedCount() ?? 0,
        tripwire: {
            swaps: trips.length,
            finalizedProxy,
            finalizedRaw,
            collected,
            pinned,
            proxyAlive,
            rawAlive,
            undetermined,
            lateWrites: lateWrites.map((w) => ({ chaId: w.chaId, keys: [...w.keys], atCommit: w.atCommit })),
        },
    }
}

/** Clears what was measured; candidates still waiting keep their first-add time. */
export function reset(): void {
    counters = zeroCounters()
    fires = newRing()
    fingerprints = newRing()
    waits = newRing()
    dirtySamples = []
    dirtyByKey = {}
    trips = []
    lateWrites = []
    finalizedProxy = 0
    finalizedRaw = 0
    generation += 1
}

export function resetPutBackMeasureForTest(): void {
    reset()
    waitingSince.clear()
}

if (MEASURE) {
    (globalThis as { __risuPutBackMeasure?: { snapshot: typeof snapshot, reset: typeof reset } }).__risuPutBackMeasure = { snapshot, reset }
}
