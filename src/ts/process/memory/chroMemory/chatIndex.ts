import { Bm25Index, rareTerms } from './lexical'
import { recordTextOf, type MessageRecord } from './records'
import { UNIT_CHARS, splitRecord } from './units'

/** The share of the indexed units a query term may occur in to count as rare (S0 builder `rare`). */
export const RARE_SHARE = 0.005

/** One searchable piece of a record. `key` names the record it came from; `ordinal` is its place among that record's pieces. */
export interface IndexedUnit {
    key: string
    ordinal: number
    off: number
    text: string
}

/** Why a reconcile rebuilt the whole index: the first build, or a change that is not a pure tail removal plus appends. */
export type RebuildCause = 'fresh' | 'mid-removal'

export interface Reconcile {
    units: number
    removed: number
    added: number
    churn: number
    rebuilt: boolean
    fresh: boolean
    rebuildCause: RebuildCause | null
}

interface IndexedRecord {
    key: string
    units: IndexedUnit[]
}

const KEY_SEP = '\u0000'

/** chatId + rawHash, with the duplicate's number appended for a repeated pair in one D0, so a key is unique per D0. */
export function recordKeysOf(d0: readonly MessageRecord[]): string[] {
    const seen = new Map<string, number>()
    return d0.map((rec) => {
        const base = rec.chatId + KEY_SEP + rec.rawHash
        const n = seen.get(base) ?? 0
        seen.set(base, n + 1)
        return n === 0 ? base : base + KEY_SEP + n
    })
}

/**
 * The in-memory BM25 index of one chat's D0. Unit ids are always in D0 order,
 * then by offset, which keeps the newer-wins tie-break of the S0 ranker exact.
 * A kept key keeps the text it was indexed with; a record is split and its
 * text read only when its key is new.
 */
export class ChatUnitIndex {
    readonly chatKey: string
    private readonly limit: number
    private bm25 = new Bm25Index()
    private recs: IndexedRecord[] = []
    private flat: IndexedUnit[] = []
    private built = false

    constructor(chatKey: string, limit: number = UNIT_CHARS) {
        this.chatKey = chatKey
        this.limit = limit
    }

    get unitCount(): number {
        return this.flat.length
    }

    reconcile(d0: readonly MessageRecord[]): Reconcile {
        const keys = recordKeysOf(d0)
        const before = this.flat.length
        const fresh = !this.built
        const existing = this.recs
        const wanted = new Set(keys)
        let prefix = 0
        while (prefix < existing.length && prefix < keys.length && existing[prefix].key === keys[prefix]) prefix++
        let tailGone = true
        for (let i = prefix; i < existing.length; i++) {
            if (wanted.has(existing[i].key)) {
                tailGone = false
                break
            }
        }
        const unitsOf = (rec: MessageRecord, key: string): IndexedRecord => ({
            key,
            units: splitRecord(recordTextOf(rec.preWrap), this.limit).map((p, ordinal) => ({ key, ordinal, off: p.off, text: p.text })),
        })

        let removed = 0
        let added = 0
        let rebuilt = false
        let rebuildCause: RebuildCause | null = null

        if (fresh || !tailGone) {
            // Rebuild from the units already held for kept keys; only new keys are split.
            const held = new Map<string, IndexedRecord>()
            for (const r of existing) held.set(r.key, r)
            const next: IndexedRecord[] = []
            for (let i = 0; i < keys.length; i++) {
                const h = held.get(keys[i])
                if (h) next.push(h)
                else {
                    const made = unitsOf(d0[i], keys[i])
                    added += made.units.length
                    next.push(made)
                }
            }
            const kept = new Set(next)
            for (const r of existing) if (!kept.has(r)) removed += r.units.length
            this.recs = next
            this.flat = next.flatMap((r) => r.units)
            const index = new Bm25Index()
            for (const u of this.flat) index.add(u.text)
            this.bm25 = index
            rebuilt = true
            rebuildCause = fresh ? 'fresh' : 'mid-removal'
        } else {
            if (prefix < existing.length) {
                const keep = existing.slice(0, prefix).reduce((n, r) => n + r.units.length, 0)
                removed = this.flat.length - keep
                this.bm25.truncate(keep)
                this.flat.length = keep
                this.recs = existing.slice(0, prefix)
            }
            for (let i = prefix; i < keys.length; i++) {
                const made = unitsOf(d0[i], keys[i])
                for (const u of made.units) {
                    this.bm25.add(u.text)
                    this.flat.push(u)
                }
                added += made.units.length
                this.recs.push(made)
            }
        }
        this.built = true
        return {
            units: this.flat.length,
            removed,
            added,
            churn: fresh ? 0 : removed / Math.max(1, before),
            rebuilt,
            fresh,
            rebuildCause,
        }
    }

    /** The S0 `rare` ranker: scored units best first (newer wins a tie), then every unscored unit, newest first. */
    rank(queryText: string, share: number): { order: IndexedUnit[], terms: string[] } {
        const terms = rareTerms(this.bm25, queryText, share)
        const s = this.bm25.scoreTokens(terms)
        const ids: number[] = []
        for (let i = 0; i < this.flat.length; i++) if (s[i] > 0) ids.push(i)
        ids.sort((a, b) => s[b] - s[a] || b - a)
        const seen = new Set(ids)
        for (let i = this.flat.length - 1; i >= 0; i--) if (!seen.has(i)) ids.push(i)
        return { order: ids.map((i) => this.flat[i]), terms }
    }
}
