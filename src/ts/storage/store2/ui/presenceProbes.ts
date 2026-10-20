import { decodeInlayId, encodeInlayId, INLAY_META_PREFIX } from '../../../process/files/inlayKeys'
import type { ByteStore } from '../../store/contract'
import { assetRefKey } from '../format'
import { PresenceProbeError, type PickOptions } from '../recoveryPick'

/**
 * The presence probes of a recovery pick (MC-291): which asset files and inlay records the store holds, answered from
 * one listing of `assets/` and one of `inlays/m-` per pick.
 *
 * Invariants:
 *  - A pick makes at most one `store.list` call per prefix. After the first failure or skip of a pick no probe lists
 *    again: every later probe call of that pick throws the first cause.
 *  - Every rejection of `store.list` becomes a `PresenceProbeError('list-failed')`, whatever its type, because no store
 *    types its listing failures. Only the listing call is wrapped: a defect in the reduction is not a probe error.
 *  - `skip()` settles every pending probe call with `PresenceProbeError('skipped')`. The listing itself is not
 *    cancellable and keeps running; its result is dropped.
 *  - `reset()` starts a new pick: caches, the skip flag and the cause are cleared and the skip signal is renewed, so an
 *    earlier skip cannot settle a later pick's calls. A listing that settles after a `reset()` never fills a cache.
 *  - Ids are compared lower-cased and re-encoded, as the contract of `InlaysPresent` says. Prefix probes use the raw
 *    listed keys, as the contract of `InlayPrefixesPresent` says.
 */

const ASSETS_PREFIX = 'assets/'

type ProbeCause = 'skipped' | 'list-failed'

const SKIPPED = Symbol('skipped')

interface SkipSignal {
    promise: Promise<typeof SKIPPED>
    fire(): void
}

function newSkipSignal(): SkipSignal {
    let fire = (): void => {}
    const promise = new Promise<typeof SKIPPED>((resolve) => {
        fire = () => resolve(SKIPPED)
    })
    return { promise, fire }
}

interface Slot<T> {
    value: T | null
    inflight: Promise<T> | null
}

interface InlayIndex {
    /** The listed keys as the store holds them, sorted, for prefix probes. */
    raw: readonly string[]
    /** The listed keys with the id lower-cased and re-encoded, for id probes. */
    normalized: ReadonlySet<string>
}

function inlayIndexOf(keys: readonly string[]): InlayIndex {
    const normalized = new Set<string>()
    for (const key of keys) {
        if (!key.startsWith(INLAY_META_PREFIX)) {
            continue
        }
        const id = decodeInlayId(key.slice(INLAY_META_PREFIX.length))
        if (id === null) {
            continue
        }
        const encoded = encodeInlayId(id.toLowerCase())
        if (encoded !== null) {
            normalized.add(INLAY_META_PREFIX + encoded)
        }
    }
    return { raw: [...keys].sort(), normalized }
}

/** Whether some key of the sorted `raw` starts with `prefix`. */
function hasPrefix(raw: readonly string[], prefix: string): boolean {
    let low = 0
    let high = raw.length
    while (low < high) {
        const middle = (low + high) >>> 1
        if (raw[middle] < prefix) {
            low = middle + 1
        } else {
            high = middle
        }
    }
    return low < raw.length && raw[low].startsWith(prefix)
}

export interface PresenceProbes {
    probes: Pick<PickOptions, 'assetsPresent' | 'inlaysPresent' | 'inlayPrefixesPresent'>
    /** Sticky until `reset()`: settles every pending probe call, and every later one, with `PresenceProbeError('skipped')`. */
    skip(): void
    /** Starts a new pick. */
    reset(): void
    /** The first cause of this pick's failure to check, or null when none. */
    cause(): ProbeCause | null
}

export function createPresenceProbes(store: ByteStore): PresenceProbes {
    let generation = 0
    let cause: ProbeCause | null = null
    let signal = newSkipSignal()
    const assets: Slot<ReadonlySet<string>> = { value: null, inflight: null }
    const inlays: Slot<InlayIndex> = { value: null, inflight: null }

    function record(from: ProbeCause, at: number): void {
        if (at === generation && cause === null) {
            cause = from
        }
    }

    async function listed<T>(slot: Slot<T>, prefix: string, reduce: (keys: string[]) => T): Promise<T> {
        if (cause !== null) {
            throw new PresenceProbeError(cause)
        }
        if (slot.value !== null) {
            return slot.value
        }
        const at = generation
        const awaitedSignal = signal
        if (slot.inflight === null) {
            const inflight = (async (): Promise<T> => {
                let keys: string[]
                try {
                    keys = await store.list(prefix)
                } catch (error) {
                    throw new PresenceProbeError('list-failed', error)
                }
                const value = reduce(keys)
                if (at === generation) {
                    slot.value = value
                }
                return value
            })()
            slot.inflight = inflight
            // A rejected listing is not kept, and one that lost the race to a skip rejects with nobody waiting on it.
            const release = (): void => {
                if (at === generation && slot.inflight === inflight) {
                    slot.inflight = null
                }
            }
            inflight.then(release, release)
        }
        let outcome: T | typeof SKIPPED
        try {
            outcome = await Promise.race([slot.inflight as Promise<T>, awaitedSignal.promise])
        } catch (error) {
            if (error instanceof PresenceProbeError) {
                record(error.reason, at)
            }
            throw error
        }
        if (outcome === SKIPPED) {
            record('skipped', at)
            throw new PresenceProbeError('skipped')
        }
        return outcome
    }

    return {
        probes: {
            async assetsPresent(refKeys) {
                const present = await listed(assets, ASSETS_PREFIX, keys => new Set(keys.map(assetRefKey)))
                return new Set(refKeys.filter(key => present.has(key)))
            },
            async inlaysPresent(metaKeys) {
                const index = await listed(inlays, INLAY_META_PREFIX, inlayIndexOf)
                return new Set(metaKeys.filter(key => index.normalized.has(key)))
            },
            async inlayPrefixesPresent(prefixes) {
                const index = await listed(inlays, INLAY_META_PREFIX, inlayIndexOf)
                return new Set(prefixes.filter(prefix => hasPrefix(index.raw, prefix)))
            },
        },
        skip() {
            if (cause === null) {
                cause = 'skipped'
            }
            signal.fire()
        },
        reset() {
            generation++
            assets.value = null
            assets.inflight = null
            inlays.value = null
            inlays.inflight = null
            cause = null
            signal = newSkipSignal()
        },
        cause: () => cause,
    }
}
