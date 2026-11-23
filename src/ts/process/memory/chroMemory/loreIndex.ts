// Spec 3.3 lore index: one lexical index per character plus enabled module set, built off the send path from a
// snapshot taken at the send and never awaited by it. The entry hash is injected so this module imports only lexical.ts
// and ccardlib and stays loadable from the S4 harness.
import { CCardLib } from '@risuai/ccardlib'
import { Bm25Index } from './lexical'

/** The entries of one lore scan, in the scan's order: character, then chat, then module lore. */
export interface LoreScanEntries {
    entries: ReadonlyArray<{ content: string, id?: string | null, mode?: string }>
    characterCount: number
    chatCount: number
    /** The module that owns each module entry, parallel to the module part of `entries`. */
    moduleOwners: readonly string[]
}

export type LoreDocIdentity =
    | { kind: 'id', id: string }
    | { kind: 'hash', length: number, hash: number }

export interface LoreIndexDeps {
    /** The scan's content-hash fallback for an entry without an id. */
    hash(content: string): number
    /** Runs one build chunk later; the default is a zero-delay timer. */
    schedule(run: () => void): void
    now(): number
}

export type LoreIndexState = 'none' | 'building' | 'ready' | 'failed'

export interface LoreIndexInfo {
    state: LoreIndexState
    entries: number
    buildMs: number
}

export interface ReadyLoreIndex {
    readonly bm25: Bm25Index
    /** Parallel to the BM25 document ids. */
    readonly docs: readonly LoreDocIdentity[]
    readonly entries: number
    readonly buildMs: number
}

/** The most entries one build chunk processes before yielding. */
export const LORE_BUILD_CHUNK = 300

/** Child and folder entries are never indexed: the scan rewrites child entries in its own clone. */
export function isIndexedMode(mode: string | undefined): boolean {
    return mode !== 'child' && mode !== 'folder'
}

function sourceOf(view: LoreScanEntries, index: number): string {
    if (index < view.characterCount) return 'character'
    if (index < view.characterCount + view.chatCount) return 'chat'
    return 'module:' + (view.moduleOwners[index - view.characterCount - view.chatCount] ?? '')
}

/** `ownerChaId` plus the distinct enabled modules, in first-appearance order. */
export function loreIndexKey(ownerChaId: string, moduleOwners: readonly string[]): string {
    return JSON.stringify([ownerChaId, [...new Set(moduleOwners)]])
}

/** Per source, the count of indexed entries and the summed content length (spec 3.3). */
export function loreFingerprint(view: LoreScanEntries): string {
    const per = new Map<string, [number, number]>()
    for (let i = 0; i < view.entries.length; i++) {
        const e = view.entries[i]
        if (!isIndexedMode(e.mode)) continue
        const src = sourceOf(view, i)
        const acc = per.get(src)
        if (acc) {
            acc[0]++
            acc[1] += e.content.length
        } else per.set(src, [1, e.content.length])
    }
    return JSON.stringify([...per].map(([s, [n, len]]) => [s, n, len]))
}

interface Slot {
    key: string
    fingerprint: string
    generation: number
    state: 'building' | 'ready' | 'failed'
    index: Bm25Index
    docs: LoreDocIdentity[]
    buildMs: number
    entries: number
}

export interface LoreIndexStore {
    /** The ready index for this scan's lore, or null while one is being built (a build is started when none matches). */
    ensure(ownerChaId: string, view: LoreScanEntries): ReadyLoreIndex | null
    /** Drops the current index and builds a new one; used when a ranked identity has no live entry. */
    requestRebuild(ownerChaId: string, view: LoreScanEntries): void
    info(): LoreIndexInfo
    reset(): void
}

export function createLoreIndexStore(deps: LoreIndexDeps): LoreIndexStore {
    let slot: Slot | null = null
    let generation = 0

    function startBuild(key: string, fingerprint: string, view: LoreScanEntries): void {
        // The snapshot holds references to the content strings only; nothing is processed on the send path.
        const snapshot: Array<{ content: string, id: string | null | undefined }> = []
        for (const e of view.entries) if (isIndexedMode(e.mode)) snapshot.push({ content: e.content, id: e.id })
        const mine: Slot = { key, fingerprint, generation: ++generation, state: 'building', index: new Bm25Index(), docs: [], buildMs: 0, entries: 0 }
        slot = mine
        let cursor = 0
        const runChunk = () => {
            if (slot !== mine) return
            const started = deps.now()
            try {
                const end = Math.min(snapshot.length, cursor + LORE_BUILD_CHUNK)
                for (; cursor < end; cursor++) {
                    const { content, id } = snapshot[cursor]
                    mine.index.add(CCardLib.decorator.parse(content, () => undefined))
                    mine.docs.push(id != null ? { kind: 'id', id } : { kind: 'hash', length: content.length, hash: deps.hash(content) })
                }
            } catch {
                mine.state = 'failed'
                snapshot.length = 0
                return
            }
            mine.buildMs += deps.now() - started
            if (cursor < snapshot.length) {
                deps.schedule(runChunk)
                return
            }
            mine.entries = mine.docs.length
            mine.state = 'ready'
            // Releases every content string reference held for the build.
            snapshot.length = 0
        }
        deps.schedule(runChunk)
    }

    return {
        ensure(ownerChaId, view) {
            const key = loreIndexKey(ownerChaId, view.moduleOwners)
            const fingerprint = loreFingerprint(view)
            if (!slot || slot.key !== key || slot.fingerprint !== fingerprint) {
                startBuild(key, fingerprint, view)
                return null
            }
            if (slot.state !== 'ready') return null
            return { bm25: slot.index, docs: slot.docs, entries: slot.entries, buildMs: slot.buildMs }
        },
        requestRebuild(ownerChaId, view) {
            if (slot && slot.state === 'building') return
            startBuild(loreIndexKey(ownerChaId, view.moduleOwners), loreFingerprint(view), view)
        },
        info() {
            if (!slot) return { state: 'none', entries: 0, buildMs: 0 }
            return { state: slot.state, entries: slot.entries, buildMs: slot.buildMs }
        },
        reset() {
            slot = null
            generation++
        },
    }
}

export type LoreResolution =
    | { kind: 'prefiltered' }
    | { kind: 'matches', indexes: number[] }

export interface LoreLiveLookup {
    resolve(doc: LoreDocIdentity): LoreResolution
    /** How many `deps.hash` calls this send's lookups made. */
    hashCalls(): number
}

/**
 * Maps a ranked document identity onto this scan's live entries. A hash document is compared only inside its length
 * bucket, and only when that bucket holds an entry the scan recorded as a keyword miss: nothing else can be recalled,
 * so hashing it would change no decision.
 */
export function createLoreLiveLookup(view: LoreScanEntries, isMissed: (index: number) => boolean, hash: (content: string) => number): LoreLiveLookup {
    let byId: Map<string, number[]> | null = null
    let byLength: Map<number, number[]> | null = null
    const hashed = new Map<number, number>()
    let hashCalls = 0
    const build = () => {
        byId = new Map()
        byLength = new Map()
        for (let i = 0; i < view.entries.length; i++) {
            const e = view.entries[i]
            if (!isIndexedMode(e.mode)) continue
            if (e.id != null) {
                const list = byId.get(e.id)
                if (list) list.push(i)
                else byId.set(e.id, [i])
            } else {
                const list = byLength.get(e.content.length)
                if (list) list.push(i)
                else byLength.set(e.content.length, [i])
            }
        }
    }
    const hashOf = (j: number): number => {
        let h = hashed.get(j)
        if (h === undefined) {
            hashCalls++
            h = hash(view.entries[j].content)
            hashed.set(j, h)
        }
        return h
    }
    return {
        resolve(doc) {
            if (!byId || !byLength) build()
            if (doc.kind === 'id') return { kind: 'matches', indexes: byId!.get(doc.id)?.slice() ?? [] }
            const bucket = byLength!.get(doc.length) ?? []
            if (!bucket.some(isMissed)) return { kind: 'prefiltered' }
            return { kind: 'matches', indexes: bucket.filter((j) => hashOf(j) === doc.hash) }
        },
        hashCalls: () => hashCalls,
    }
}

export const defaultLoreIndexScheduler = (run: () => void): void => {
    setTimeout(run, 0)
}
