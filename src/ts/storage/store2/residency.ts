import type { JsonObject } from '../blockFrame'
import type { character, groupChat } from '../database.svelte'
import type { Store2Backend } from './backend/types'
import {
    assembleCharacter, characterMatchesAcknowledged, CodecAssembleError, overlayStub, stubFromEntry,
    type AcknowledgedVerdict, type UnitSource,
} from './codec'
import { defaultKeyEnv, type ShardEntry } from './format'
import { hydrateEntityDigests } from './previousOfTree'
import type { Store2SaveContext } from './saveActive'
import type { SaveEncoder } from './saveEncoder'
import { readEntityBytes } from './treeBytes'

/**
 * Residency: which characters of the acknowledged encoding are held by the page as stubs, and how one is loaded,
 * judged and turned back into a stub. It works over the save loop's own encoder, so the entry it loads, the digests
 * it hydrates and the verdict it gives are all against the one encoding the next pass compares with.
 */

type Slot = character | groupChat

/**
 * A character read from its units. It answers as the legacy cold-storage reader does, so one redirect can serve both:
 * a unit that is absent or damaged is `error` with kind `damaged`, and a failure of the store is `error` with no kind.
 * A store2 entity is many units, so one absent unit is partial damage and is never `missing`.
 */
export type ResidencyRead =
    | { status: 'ok', value: { character: JsonObject }, entry: ShardEntry, source: UnitSource, bytes: number }
    | { status: 'error', error: unknown, kind?: 'damaged' }

export interface Residency {
    /** The entry the latest acknowledged encoding holds under `u`. */
    entryOf(u: string): ShardEntry | null
    /** Reads and assembles the character of `u` as a copy: nothing is hydrated. */
    readCharacter(u: string): Promise<ResidencyRead>
    /** `readCharacter`, then gives the units just read their digests in place, so the loaded character is reused whole by its first pass. */
    load(u: string): Promise<ResidencyRead>
    /**
     * Gives the units of a read made earlier by `readCharacter` their digests in place. A unit whose key or Ref is no
     * longer the acknowledged encoding's is left as it is, so a read that went stale hydrates nothing it should not.
     */
    hydrate(read: Extract<ResidencyRead, { status: 'ok' }>): void
    /**
     * Whether the resident character `slot` is the acknowledged one: clean means every unit is the acknowledged unit and the
     * entry agrees outside `lastInteraction` and `trashTime`, which survive an unload only because `stubFor(slot)` carries them.
     */
    verdict(slot: Slot): AcknowledgedVerdict
    /** The stub of the acknowledged entry of `slot`, with the fields a stub may change taken from `slot`; null when the encoding cannot stand a stub in for it. */
    stubFor(slot: Slot): JsonObject | null
}

export interface ResidencyOptions {
    backend: Store2Backend
    /**
     * The context the save loop runs with (`activateStore2Save`). The residency takes its encoder, list derivation and key
     * environment from it and has no copies of its own, so a verdict is judged by the very encoding and lists the next pass uses.
     */
    context: Pick<Store2SaveContext, 'lists' | 'env'> & { encoder: SaveEncoder }
}

export function createResidency(options: ResidencyOptions): Residency {
    const { backend } = options
    const { encoder, lists } = options.context
    const env = options.context.env ?? defaultKeyEnv
    // Entries by `u`, rebuilt only when the acknowledged encoding's shards are a different array.
    let indexedShards: unknown = null
    let entries = new Map<string, ShardEntry>()

    function entryOf(u: string): ShardEntry | null {
        const shards = encoder.acknowledged().objects?.shards
        if (shards === undefined) {
            return null
        }
        if (shards !== indexedShards) {
            entries = new Map()
            for (const shard of shards) {
                for (const entry of shard.entries) {
                    entries.set(entry.u, entry)
                }
            }
            indexedShards = shards
        }
        return entries.get(u) ?? null
    }

    async function readCharacter(u: string): Promise<ResidencyRead> {
        const entry = entryOf(u)
        if (entry === null) {
            return { status: 'error', kind: 'damaged', error: new Error(`The acknowledged encoding holds no entity ${u}.`) }
        }
        try {
            const read = await readEntityBytes(backend, entry)
            switch (read.status) {
                case 'damaged':
                    return { status: 'error', kind: 'damaged', error: new Error(read.reason) }
                case 'too-new':
                    return { status: 'error', error: new Error(read.reason) }
                case 'unreadable':
                    return { status: 'error', error: read.cause }
                case 'ok':
                    return { status: 'ok', value: { character: assembleCharacter(entry, read.source) }, entry, source: read.source, bytes: read.bytes }
            }
        } catch (error) {
            // Units that passed their check but do not hold a character are damaged; anything else is the store failing.
            return error instanceof CodecAssembleError ? { status: 'error', kind: 'damaged', error } : { status: 'error', error }
        }
    }

    function hydrate(read: Extract<ResidencyRead, { status: 'ok' }>): void {
        hydrateEntityDigests(encoder.acknowledged(), read.entry, read.source)
    }

    return {
        entryOf,
        readCharacter,
        async load(u) {
            const read = await readCharacter(u)
            if (read.status === 'ok') {
                hydrate(read)
            }
            return read
        },
        hydrate,
        verdict: slot => characterMatchesAcknowledged(slot, { env, lists, previous: encoder.acknowledged() }),
        stubFor(slot) {
            const previous = encoder.acknowledged()
            const chaId = String((slot as { chaId?: unknown }).chaId ?? '')
            const u = previous.entities.get(`${chaId}#0`)
            const entry = u === undefined || previous.entities.has(`${chaId}#1`) ? null : entryOf(u)
            return entry === null ? null : stubFromEntry(overlayStub(entry, slot))
        },
    }
}
