import type { JsonObject } from '../blockFrame'
import type { character, groupChat } from '../database.svelte'
import type { Store2Backend } from './backend/types'
import {
    assembleCharacter, assembleModule, characterMatchesAcknowledged, CodecAssembleError, moduleHandles, overlayStub, stubFromEntry,
    type AcknowledgedVerdict, type UnitSource,
} from './codec'
import { defaultKeyEnv, type ModuleEntry, type ShardEntry } from './format'
import { createLeafFallback } from './leafFallback'
import { hydrateEntityDigests, hydrateModuleDigests } from './previousOfTree'
import type { Store2SaveContext } from './saveActive'
import type { SaveEncoder } from './saveEncoder'
import { readEntityBytes, readModuleBytes, type FlaggedLeaf } from './treeBytes'

/**
 * Residency: which characters of the acknowledged encoding are held by the page as stubs, and how one is loaded,
 * judged and turned back into a stub. It works over the save loop's own encoder, so the entry it loads, the digests
 * it hydrates and the verdict it gives are all against the one encoding the next pass compares with.
 */

type Slot = character | groupChat

/**
 * A character read from its units. It answers as the legacy cold-storage reader does, so one redirect can serve both:
 * a unit that is absent or damaged is `error` with kind `damaged`, and a failure of the store is `error` with no kind.
 * A store2 entity is many units, so one absent unit is partial damage and is never `missing`. The one unit that is not
 * damage to the character is an alternatives unit: the character reads `ok` with its main conversation, `droppedAlt`
 * names the units left out, and their bytes are not in `source`, so the next pass writes the chat without them.
 */
export type ResidencyRead =
    | { status: 'ok', value: { character: JsonObject }, entry: ShardEntry, source: UnitSource, bytes: number, droppedAlt: readonly FlaggedLeaf[] }
    | { status: 'error', error: unknown, kind?: 'damaged' }

/**
 * A module read from its units, as a copy. `error` carries why: `no-entry` (the acknowledged encoding holds no module
 * under the handle), `damaged` (the module unit is absent, damaged or not a module), `too-new` or `unreadable` (the
 * store failed). An asset or inlay list that is absent, damaged or of a version above this build's is not an error:
 * the module reads `ok`, that list's bytes are withheld from `source`, and it is left for the next pass to derive.
 */
export type ResidencyModuleRead =
    | { status: 'ok', value: JsonObject, handle: string, entry: ModuleEntry, source: UnitSource, bytes: number }
    | { status: 'error', reason: 'no-entry' | 'damaged' | 'too-new' | 'unreadable', error: unknown }

export interface Residency {
    /** The entry the latest acknowledged encoding holds under `u`. */
    entryOf(u: string): ShardEntry | null
    /** The module index entry the latest acknowledged encoding holds under `handle` (`<id>#<occurrence>`). */
    moduleEntryOf(handle: string): ModuleEntry | null
    /** Reads and assembles the module of `handle` as a copy: nothing is hydrated and nothing is installed. */
    readModule(handle: string): Promise<ResidencyModuleRead>
    /**
     * Gives the module unit and lists of a read made earlier by `readModule` their digests in place, so an unedited
     * loaded module is reused whole by its first pass. A unit whose key or Ref is no longer the acknowledged
     * encoding's is left as it is, so a read that went stale hydrates nothing it should not.
     */
    hydrateModule(read: Extract<ResidencyModuleRead, { status: 'ok' }>): void
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
     * `unknown` for every character while a save attempt of unknown outcome is pending (`SaveEncoder.pendingKey`).
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
            const manifestKey = encoder.manifestKey
            const read = await readEntityBytes(backend, entry, { manifestKey })
            switch (read.status) {
                case 'damaged':
                    return { status: 'error', kind: 'damaged', error: new Error(read.reason) }
                case 'too-new':
                    return { status: 'error', error: new Error(read.reason) }
                case 'unreadable':
                    return { status: 'error', error: read.cause }
                case 'moved':
                    // The commit key moved while alternatives were to be dropped: a refusal that changes nothing, never damage.
                    return { status: 'error', error: new Error('The saved data changed while the character was being read.') }
                case 'ok': {
                    const character = read.droppedAlt.length === 0
                        ? assembleCharacter(entry, read.source)
                        : createLeafFallback(read.droppedAlt, env.now).character(entry, read.source)
                    return { status: 'ok', value: { character }, entry, source: read.source, bytes: read.bytes, droppedAlt: read.droppedAlt }
                }
            }
        } catch (error) {
            // Units that passed their check but do not hold a character are damaged; anything else is the store failing.
            return error instanceof CodecAssembleError ? { status: 'error', kind: 'damaged', error } : { status: 'error', error }
        }
    }

    function hydrate(read: Extract<ResidencyRead, { status: 'ok' }>): void {
        hydrateEntityDigests(encoder.acknowledged(), read.entry, read.source)
    }

    // Module entries by handle, rebuilt only when the acknowledged encoding's module index is a different object.
    let indexedModules: unknown = null
    let moduleEntries = new Map<string, ModuleEntry>()

    function moduleEntryOf(handle: string): ModuleEntry | null {
        const index = encoder.acknowledged().objects?.moduleIndex
        if (index === undefined) {
            return null
        }
        if (index !== indexedModules) {
            const handles = moduleHandles(index.entries)
            moduleEntries = new Map(index.entries.map((entry, position) => [handles[position], entry] as const))
            indexedModules = index
        }
        return moduleEntries.get(handle) ?? null
    }

    async function readModule(handle: string): Promise<ResidencyModuleRead> {
        const entry = moduleEntryOf(handle)
        if (entry === null) {
            return { status: 'error', reason: 'no-entry', error: new Error(`The acknowledged encoding holds no module ${handle}.`) }
        }
        try {
            const read = await readModuleBytes(backend, entry)
            switch (read.status) {
                case 'damaged':
                    return { status: 'error', reason: 'damaged', error: new Error(read.reason) }
                case 'too-new':
                    return { status: 'error', reason: 'too-new', error: new Error(read.reason) }
                case 'unreadable':
                    return { status: 'error', reason: 'unreadable', error: read.cause }
                case 'ok':
                    return { status: 'ok', value: assembleModule(entry, read.source), handle, entry, source: read.source, bytes: read.bytes }
            }
        } catch (error) {
            // A unit that passed its check but does not hold a module is damaged; anything else is the store failing.
            return error instanceof CodecAssembleError
                ? { status: 'error', reason: 'damaged', error }
                : { status: 'error', reason: 'unreadable', error }
        }
    }

    return {
        entryOf,
        moduleEntryOf,
        readModule,
        hydrateModule: read => hydrateModuleDigests(encoder.acknowledged(), read.entry, read.handle, read.source),
        readCharacter,
        async load(u) {
            const read = await readCharacter(u)
            if (read.status === 'ok') {
                hydrate(read)
            }
            return read
        },
        hydrate,
        // A save attempt whose outcome is unknown may have landed with newer units than the acknowledged encoding holds, so
        // the acknowledged encoding is not yet what a stub made from it would be carried against: no character is judged then.
        verdict: slot => encoder.pendingKey === null ? characterMatchesAcknowledged(slot, { env, lists, previous: encoder.acknowledged() }) : 'unknown',
        stubFor(slot) {
            const previous = encoder.acknowledged()
            const chaId = String((slot as { chaId?: unknown }).chaId ?? '')
            const u = previous.entities.get(`${chaId}#0`)
            const entry = u === undefined || previous.entities.has(`${chaId}#1`) ? null : entryOf(u)
            return entry === null ? null : stubFromEntry(overlayStub(entry, slot))
        },
    }
}
