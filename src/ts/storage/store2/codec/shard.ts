import { crc32 } from '../../blockFrame'
import { carryUnknownFields, KNOWN_FIELDS, type ChunkRef, type ListRef, type Ref, type Shard, type ShardEntry } from '../format'

/** Writer parameter, not format: the manifest carries its own shardCount. */
export const SHARD_COUNT = 16

/** Smallest and largest shard count a writer picks; a count change writes every shard, so the cap keeps that pass off the bulk path. */
export const SHARD_COUNT_MIN = SHARD_COUNT
export const SHARD_COUNT_MAX = 32

function isWriterShardCount(count: number): boolean {
    return count === SHARD_COUNT_MIN || count === SHARD_COUNT_MAX
}

/**
 * Shard count for characters entries. With no usable previous count it is
 * clamp(nextPow2(ceil(characters / 16)), MIN, MAX); otherwise the previous
 * count is kept until the entries outgrow or undercut it by a wide margin, so a
 * count near a boundary does not flip between passes. Passes with no previous
 * (import, convert, recovery) and the pass after them agree: the result for
 * (characters, shardCountFor(characters)) is itself.
 */
export function shardCountFor(characters: number, previous?: number): number {
    if(previous === undefined || !isWriterShardCount(previous)){
        let count = SHARD_COUNT_MIN
        while(count < SHARD_COUNT_MAX && count * 16 < characters){
            count *= 2
        }
        return count
    }
    if(previous < SHARD_COUNT_MAX && characters > previous * 16){
        return previous * 2
    }
    if(previous > SHARD_COUNT_MIN && characters < previous * 2){
        return previous / 2
    }
    return previous
}

/** Shard of a character: `crc32(utf8(u)) mod shardCount`. `u` is the minted entity id, never derived from `chaId`. */
export function shardOfU(u: string, shardCount: number = SHARD_COUNT): number {
    return crc32(new TextEncoder().encode(u)) % shardCount
}

/** The shard bodies for `entries`, one per shard index, each sorted by `u`; a shard without entries is still a body. */
export function groupIntoShards(entries: readonly ShardEntry[], shardCount: number = SHARD_COUNT): Shard[] {
    const shards: Shard[] = Array.from({ length: shardCount }, () => ({ v: 1, entries: [] }))
    for (const entry of entries) {
        shards[shardOfU(entry.u, shardCount)].entries.push(entry)
    }
    for (const shard of shards) {
        shard.entries.sort((a, b) => (a.u < b.u ? -1 : a.u > b.u ? 1 : 0))
    }
    return shards
}

/**
 * `next` with the fields of the previous shards this build does not know. An
 * entry is matched by `u` across every previous shard, whatever its shard
 * index: the shard count is a writer parameter, so an entry may move shards. A
 * chat entry is matched by `cid` within its entry, and only when `cid` is in
 * `stableChats` for that entry (a handle from a unique real chat id); a
 * positional handle carries nothing, because a lost field is preferred to one
 * attached to another chat. An entry or chat the previous shards lack carries
 * nothing. A shard's own top-level fields are carried only when the previous
 * shard count equals the new one: with another count no previous shard
 * corresponds to a new one.
 */
export function carryShards(
    prev: readonly Shard[] | undefined,
    next: Shard[],
    stableChats: ReadonlyMap<string, ReadonlySet<string>>,
): Shard[] {
    if (prev === undefined) {
        return next
    }
    const previousEntries = new Map<string, ShardEntry>()
    prev.forEach((shard) => {
        for (const entry of shard.entries) {
            previousEntries.set(entry.u, entry)
        }
    })
    if (prev.length === next.length) {
        next.forEach((shard, index) => {
            if (prev[index] !== undefined) {
                carryUnknownFields(prev[index], shard, KNOWN_FIELDS.shard)
            }
        })
    }
    for (const shard of next) {
        for (const entry of shard.entries) {
            const before = previousEntries.get(entry.u)
            if (before === undefined) {
                continue
            }
            carryUnknownFields(before, entry, KNOWN_FIELDS.shardEntry)
            const stable = stableChats.get(entry.u)
            const previousChats = new Map(before.chats.map(chat => [chat.cid, chat]))
            for (const chat of entry.chats) {
                const earlier = previousChats.get(chat.cid)
                if (earlier !== undefined && stable?.has(chat.cid) === true) {
                    carryUnknownFields(earlier, chat, KNOWN_FIELDS.chatEntry)
                }
            }
        }
    }
    return next
}

/**
 * The digest of the canonical frame of each shard body this encoder produced. A body parsed at boot, or built by anything
 * else, is never noted, so a lookup answers only for a body whose frame was digested here.
 * INVARIANT: a noted body's canonical frame has the noted digest, so a body noted once is never mutated afterwards:
 * not its fields (unknown top-level fields included), not its entries array.
 */
const shardDigests = new WeakMap<Shard, string>()

export function noteShardDigest(body: Shard, digest: string): void {
    shardDigests.set(body, digest)
}

export function shardDigestOf(body: Shard): string | undefined {
    return shardDigests.get(body)
}

export function refTuple(ref: Ref): Ref {
    return [ref[0], ref[1], ref[2]]
}

export function listRefTuple(ref: Ref, v: number): ListRef {
    return [ref[0], ref[1], ref[2], v]
}

export function chunkRefTuple(ref: Ref, count: number): ChunkRef {
    return [ref[0], ref[1], ref[2], count]
}
