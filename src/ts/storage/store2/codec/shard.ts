import { crc32 } from '../../blockFrame'
import { carryUnknownFields, KNOWN_FIELDS, type ChunkRef, type ListRef, type Ref, type Shard, type ShardEntry } from '../format'

/** Writer parameter, not format: the manifest carries its own `shardCount`. */
export const SHARD_COUNT = 16

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

export function refTuple(ref: Ref): Ref {
    return [ref[0], ref[1], ref[2]]
}

export function listRefTuple(ref: Ref, v: number): ListRef {
    return [ref[0], ref[1], ref[2], v]
}

export function chunkRefTuple(ref: Ref, count: number): ChunkRef {
    return [ref[0], ref[1], ref[2], count]
}
