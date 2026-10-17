import type { ByteStore } from '../store/contract'
import { isOwnerId, type OwnerIdStore } from './owner'

/**
 * The Tauri build's one owner id, kept under a plain key of the page's byte store. The key is app identity, not profile
 * data: it is neither a store2 unit nor one of the gated top-level keys, so it is written without the page gate. An id
 * that is absent, not UTF-8 or not well formed reads as absent, so a damaged value gives the page a fresh id and a
 * foreign-marker path rather than an own marker it cannot prove.
 */

export const OWNER_KEY = 'store2-owner'

export function createOwnerIdStore(store: ByteStore): OwnerIdStore {
    return {
        async read() {
            const { bytes } = await store.read(OWNER_KEY)
            if (bytes === null) {
                return null
            }
            let text: string
            try {
                text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
            } catch {
                return null
            }
            return isOwnerId(text) ? text : null
        },
        async write(id) {
            await store.write(OWNER_KEY, new TextEncoder().encode(id), 'unconditional')
        },
    }
}
