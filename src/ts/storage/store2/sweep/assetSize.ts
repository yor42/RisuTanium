import type { ByteStore } from '../../store/contract'
import type { Store2Session } from '../session'

/**
 * The total stored size of a set of assets, for the confirm of the manual clean-up. It is a hint, never a gate: any failure
 * of the size source answers `null` ("size unknown") and the clean-up may go on. It never goes through `store.read`, so no
 * asset body crosses the bridge or the network just to be counted; the IndexedDB source loads one stored value at a time.
 */

const ASSETS_PREFIX = 'assets/'

/** Names sized between two yields of the event loop. */
export const SIZE_PACE_EVERY = 200

export type AssetSizeKind = Extract<Store2Session['kind'], 'tauri' | 'indexeddb' | 'node'>

export interface AssetSizeInput {
    kind: AssetSizeKind
    store: ByteStore
    /** The bare asset names, without the `assets/` prefix. */
    names: readonly string[]
    /** Awaited every `SIZE_PACE_EVERY` names of a per-name source. */
    pace?: () => Promise<void>
    /** Checked before every name: true ends the measurement at once. */
    shouldStop: () => boolean
    /** Replaces the Tauri stored-size probe, for tests. */
    sizeOf?: (key: string) => Promise<number | null>
}

export type AssetSizeResult = { status: 'sized', bytes: number | null } | { status: 'stopped' }

function errorText(error: unknown): string {
    if (typeof error === 'string') {
        return error
    }
    return String((error as { message?: unknown } | null | undefined)?.message ?? error)
}

/**
 * The stored size of `key` through a zero-length ranged read, so no body crosses the bridge. A missing file answers null; any
 * other rejection propagates, so a failure is never counted as an absent file.
 */
export async function tauriAssetSize(key: string): Promise<number | null> {
    const transport = await import('../../tauriByteTransport')
    try {
        return await transport.statStoredSize(key)
    } catch (error) {
        if (transport.MISSING_FILE_ERROR.test(errorText(error))) {
            return null
        }
        throw error
    }
}

/** The Tauri probe on the android and desktop transports, whose reads are ranged; nothing on any other transport. */
async function tauriProbe(sizeOf: AssetSizeInput['sizeOf']): Promise<((key: string) => Promise<number | null>) | null> {
    if (sizeOf !== undefined) {
        return sizeOf
    }
    const transport = await import('../../tauriByteTransport')
    return transport.transportKind() === 'other' ? null : tauriAssetSize
}

/** Sums the per-name sizes; a name whose size is null (vanished) counts 0. */
async function sumPerName(input: AssetSizeInput, sizeOf: (name: string) => Promise<number | null>): Promise<AssetSizeResult> {
    let total = 0
    for (let i = 0; i < input.names.length; i++) {
        if (input.shouldStop()) {
            return { status: 'stopped' }
        }
        if (i > 0 && i % SIZE_PACE_EVERY === 0) {
            await input.pace?.()
        }
        total += (await sizeOf(input.names[i])) ?? 0
    }
    return { status: 'sized', bytes: total }
}

async function measure(input: AssetSizeInput): Promise<AssetSizeResult> {
    const { kind, store } = input
    if (kind === 'node') {
        if (store.listSized === undefined) {
            return { status: 'sized', bytes: null }
        }
        if (input.shouldStop()) {
            return { status: 'stopped' }
        }
        const listed = await store.listSized(ASSETS_PREFIX, 0)
        if (listed === null) {
            return { status: 'sized', bytes: null }
        }
        // The answer holds only keys above the minimum, so a name it omits is empty (or gone since the listing), not unknown.
        const sizes = new Map(listed.map(entry => [entry.key, entry.size]))
        return { status: 'sized', bytes: input.names.reduce((sum, name) => sum + (sizes.get(`${ASSETS_PREFIX}${name}`) ?? 0), 0) }
    }
    if (kind === 'indexeddb') {
        if (store.readValue === undefined) {
            return { status: 'sized', bytes: null }
        }
        const readValue = store.readValue.bind(store)
        return sumPerName(input, async name => {
            const value = await readValue(`${ASSETS_PREFIX}${name}`)
            if (value === null) {
                return null
            }
            return value instanceof Uint8Array ? value.length : value.size
        })
    }
    const probe = await tauriProbe(input.sizeOf)
    if (probe === null) {
        return { status: 'sized', bytes: null }
    }
    return sumPerName(input, name => probe(`${ASSETS_PREFIX}${name}`))
}

/** Sizes `names`; a rejection of the source gives `bytes: null`, only a stop gives `stopped`. */
export async function sizeAssets(input: AssetSizeInput): Promise<AssetSizeResult> {
    try {
        return await measure(input)
    } catch {
        return { status: 'sized', bytes: null }
    }
}
