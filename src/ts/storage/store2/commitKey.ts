import {
    carryUnknownFields, commitKeyReq, defaultKeyEnv, KNOWN_FIELDS, randomId26, readUnit, UNIT_TYPE,
    type CommitKey, type KeyEnv,
} from './format'

/**
 * The logical-write rules of the commit key over parsed values. Nothing here
 * touches a backend: a caller reads, classifies, builds the next value and
 * compare-and-writes it.
 */

/** The most `retained` entries a commit key keeps, newest first. */
export const RETAINED_MAX = 20

export type CommitRead =
    | { status: 'absent' }
    | { status: 'damaged', reason: string }
    | { status: 'too-new', reason: string }
    | { status: 'parsed', value: CommitKey }

/**
 * What a read of the commit key holds. `readUnit` already separates a newer
 * writer's frame or body (`too-new`: `fmt` above 1, unknown codec, reserved
 * byte, type or `req` token) from a damaged one (bad magic, checksum, JSON or
 * schema), so this reuses it and only adds `absent` and the type check. A frame
 * of another unit type under the commit key is damaged.
 */
export function classifyCommitRead(read: { bytes: Uint8Array | null }): CommitRead {
    if (read.bytes === null) {
        return { status: 'absent' }
    }
    const unit = readUnit(read.bytes, UNIT_TYPE.commit)
    switch (unit.status) {
        case 'ok':
        case 'stale':
            return { status: 'parsed', value: unit.value.body as CommitKey }
        case 'too-new':
        case 'unreadable':
            return { status: 'too-new', reason: unit.reason }
        case 'damaged':
            return { status: 'damaged', reason: unit.reason }
    }
}

/** What one logical write changes. A field left out keeps the base's value, so a clear writes back exactly what it read. */
export interface CommitKeyChange {
    current?: CommitKey['current']
    /** Newest first; the first `RETAINED_MAX` entries are kept. */
    retained?: CommitKey['retained']
    pins?: CommitKey['pins']
    staging?: CommitKey['staging']
    convertedFrom?: CommitKey['convertedFrom']
    convertedAt?: CommitKey['convertedAt']
    /** Sets the snapshot pointer; left out, the base's pointer is carried. */
    snapshot?: CommitKey['snapshot']
    /**
     * The explicit drop member: removes the snapshot pointer from the written key. Only the old-data deletion's
     * completion write passes it; no other writer ever drops a pointer, so a pointer whose snapshot unit is absent,
     * unparsable or digest-mismatched stays on the key and is a no-op (it deletes nothing and keeps nothing live).
     */
    dropSnapshot?: boolean
    /** The writer's own `req` needs. */
    req?: readonly string[]
    /** Every manifest the new key names (`current`, `retained`, `pins`): their `req` joins the key's. */
    manifests?: readonly { req: readonly string[] }[]
}

function cloneList<T extends object>(list: readonly T[]): T[] {
    return list.map(entry => ({ ...entry }))
}

function cloneOrNull<T extends object>(value: T | null): T | null {
    return value === null ? null : { ...value }
}

/**
 * The snapshot pointer a write publishes: the change's own, else a copy of the base's (nested members copied whole), or
 * none. The property is omitted when there is no pointer, never written as `null`. A malformed stored pointer already
 * reads as absent, so its bytes are never carried and the next writer drops them.
 */
function applySnapshot(next: CommitKey, base: CommitKey | null, change: CommitKeyChange): void {
    if (change.snapshot !== undefined && change.dropSnapshot === true) {
        throw new TypeError('A write either sets or drops the snapshot pointer, not both.')
    }
    const pointer = change.dropSnapshot === true ? undefined : change.snapshot ?? base?.snapshot
    if (pointer !== undefined) {
        next.snapshot = { ...pointer }
    }
}

/**
 * The commit key a logical write publishes over `base`: `seq` one above the
 * base's, a fresh `epoch`, `req` the union of the base's, the writer's and every
 * named manifest's (never lowered), `convertedFrom` and `convertedAt` copied
 * unless the change sets them, `retained` capped, and every field this build
 * does not know carried over. Nested entries are copied, so the result shares
 * nothing mutable with `base`.
 */
export function nextCommitKey(base: CommitKey, change: CommitKeyChange, env: Pick<KeyEnv, 'random'> = defaultKeyEnv): CommitKey {
    const next: CommitKey = {
        fmt: 1,
        req: commitKeyReq([...base.req, ...(change.req ?? [])], change.manifests ?? []),
        seq: base.seq + 1,
        epoch: randomId26({ ...defaultKeyEnv, ...env }),
        current: cloneOrNull(change.current === undefined ? base.current : change.current),
        retained: cloneList(change.retained ?? base.retained).slice(0, RETAINED_MAX),
        pins: cloneList(change.pins ?? base.pins),
        staging: cloneOrNull(change.staging === undefined ? base.staging : change.staging),
        convertedFrom: change.convertedFrom === undefined ? base.convertedFrom : change.convertedFrom,
        convertedAt: change.convertedAt === undefined ? base.convertedAt : change.convertedAt,
    }
    applySnapshot(next, base, change)
    return carryUnknownFields(base, next, KNOWN_FIELDS.commitKey)
}

/** What a first-life commit key (a marker or the first commit over an absent key) is made of. */
export interface FirstCommitKey extends CommitKeyChange {
    current: CommitKey['current']
    staging: CommitKey['staging']
}

/** The first commit key of a store: `seq` 1, a fresh `epoch`, nothing retained or pinned unless given. */
export function firstCommitKey(first: FirstCommitKey, env: Pick<KeyEnv, 'random'> = defaultKeyEnv): CommitKey {
    const key: CommitKey = {
        fmt: 1,
        req: commitKeyReq(first.req ?? [], first.manifests ?? []),
        seq: 1,
        epoch: randomId26({ ...defaultKeyEnv, ...env }),
        current: cloneOrNull(first.current),
        retained: cloneList(first.retained ?? []).slice(0, RETAINED_MAX),
        pins: cloneList(first.pins ?? []),
        staging: cloneOrNull(first.staging),
        convertedFrom: first.convertedFrom ?? null,
        convertedAt: first.convertedAt ?? null,
    }
    applySnapshot(key, null, first)
    return key
}
