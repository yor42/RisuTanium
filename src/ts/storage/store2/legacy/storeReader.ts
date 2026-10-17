import type { ColdReadErrorKind } from '../../../process/coldstorageData'
import type { LegacyEntryReader, LegacyUnitRead } from './resolve'

/**
 * The production `LegacyEntryReader`: the old cold-storage units of the page's own store, read through an injected
 * three-way reader (`readColdStorageItem`; the page supplies it, so this module imports none of the page's graph).
 *
 * Only a unit that is stored and does not decode is `unparsable`. A reader failure of any other kind (the store cannot
 * be reached, an unclassified decode error) says nothing about whether the unit exists, so it is `error`, which aborts
 * the caller before anything is written.
 */

/** What the injected reader answers, as `readColdStorageItem` does. */
export type ColdUnitRead =
    | { status: 'ok', value: unknown }
    | { status: 'missing' }
    | { status: 'error', error: unknown, kind?: ColdReadErrorKind }

export function createLegacyStoreReader(read: (key: string) => Promise<ColdUnitRead>): LegacyEntryReader {
    return {
        async read(key: string): Promise<LegacyUnitRead> {
            const result = await read(key)
            switch (result.status) {
                case 'ok':
                    return { status: 'ok', value: result.value }
                case 'missing':
                    return { status: 'missing' }
                case 'error':
                    return result.kind === 'damaged' ? { status: 'unparsable' } : { status: 'error', error: result.error }
            }
        },
    }
}
