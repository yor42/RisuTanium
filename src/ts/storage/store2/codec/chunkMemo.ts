import type { UnitType } from '../format'

/**
 * The largest charge one character's remembered chunks may have, and the most all remembered chunks together may be
 * charged. Engineering constants, not settings; the memo has its own pool, separate from the verdict shadows.
 */
export const CHUNK_MEMO_CHARACTER_CAP = 16 * 1024 * 1024
export const CHUNK_MEMO_TOTAL_BUDGET = 64 * 1024 * 1024

/** What one remembered payload is charged: V8 keeps text at up to two bytes per unit; plus the entry and its string header. */
export function chunkMemoChargeOf(payload: string): number {
    return 2 * payload.length + 96
}

interface Remembered {
    readonly type: UnitType
    readonly payload: string
    readonly digest: string
    readonly charge: number
}

interface Bucket {
    readonly entries: Map<string, Remembered>
    charged: number
}

/** The entity a unit identity belongs to: the segment after the identity's first colon (`chat:<u>:<cid>:chunk:<k>`). */
function bucketOf(identity: string): string {
    const start = identity.indexOf(':') + 1
    const end = identity.indexOf(':', start)
    return end === -1 ? identity : identity.slice(start, end)
}

/**
 * Remembers, per chunk identity, the last canonical payload string and the digest of its frame. It is a cache of the
 * pure function payload -> digest: a lookup answers only for the exact payload (string equality), so it can never name
 * a digest for changed content. It never decides reuse; the sink takes the previous unit only when the previous
 * encoding's unit at that identity already carries the digest the memo returns.
 *
 * Memory: each entry is charged `chunkMemoChargeOf`. A payload that would push its character over the per-character cap
 * is not remembered; the oldest characters (least recently looked up or remembered) are dropped past the total budget.
 */
export class ChunkMemo {
    private readonly buckets = new Map<string, Bucket>()
    private charged = 0

    constructor(
        private readonly characterCap: number = CHUNK_MEMO_CHARACTER_CAP,
        private readonly totalBudget: number = CHUNK_MEMO_TOTAL_BUDGET,
    ) {}

    /** The digest of the frame of exactly `payload` as `type` at `identity`, or undefined when it is not what was remembered. */
    digestOf(identity: string, type: UnitType, payload: string): string | undefined {
        const key = bucketOf(identity)
        const bucket = this.buckets.get(key)
        const held = bucket?.entries.get(identity)
        if (bucket === undefined || held === undefined || held.type !== type || held.payload !== payload) {
            return undefined
        }
        this.buckets.delete(key)
        this.buckets.set(key, bucket)
        return held.digest
    }

    /** Remembers `payload` and its frame's `digest` at `identity`, replacing what was there; false when the caps refuse it. */
    remember(identity: string, type: UnitType, payload: string, digest: string): boolean {
        const key = bucketOf(identity)
        let bucket = this.buckets.get(key)
        const replaced = bucket?.entries.get(identity)
        if (bucket !== undefined && replaced !== undefined) {
            bucket.entries.delete(identity)
            bucket.charged -= replaced.charge
            this.charged -= replaced.charge
        }
        const charge = chunkMemoChargeOf(payload)
        const fitsBucket = charge <= this.characterCap && (bucket?.charged ?? 0) + charge <= this.characterCap
        if (fitsBucket && charge <= this.totalBudget) {
            for (const [other, one] of this.buckets) {
                if (this.charged + charge <= this.totalBudget) {
                    break
                }
                if (other !== key) {
                    this.charged -= one.charged
                    this.buckets.delete(other)
                }
            }
        }
        if (!fitsBucket || this.charged + charge > this.totalBudget) {
            if (bucket !== undefined && bucket.entries.size === 0) {
                this.buckets.delete(key)
            }
            return false
        }
        if (bucket === undefined) {
            bucket = { entries: new Map(), charged: 0 }
        } else {
            this.buckets.delete(key)
        }
        this.buckets.set(key, bucket)
        bucket.entries.set(identity, { type, payload, digest, charge })
        bucket.charged += charge
        this.charged += charge
        return true
    }

    /** How many chunks are remembered and what they are charged in total: at most the total budget. */
    stats(): { entries: number, charged: number } {
        let entries = 0
        for (const bucket of this.buckets.values()) {
            entries += bucket.entries.size
        }
        return { entries, charged: this.charged }
    }
}
