// Types for the state-link API that the patched Svelte client runtime (patches/svelte-5.57.3) adds to
// `svelte/internal/client`. Svelte ships that entry untyped. These declarations cannot detect an unpatched
// runtime; the build (a missing export fails it), the load-hook test and the plugin do.
declare module 'svelte/internal/client' {
    /** One link: a proxy with record `r` held the child under key `k` (`null` for an array parent). */
    export interface StateRecordLink {
        r: StateRecord
        k: PropertyKey | null
    }

    /**
     * What the patch keeps for a state proxy: its first link, the other links, and `tag`, a slot the patch never
     * touches and the write hook owns. Links are never removed. Two proxies share a record only when both are arrays.
     */
    export interface StateRecord {
        r: StateRecord | null
        k: PropertyKey | null
        more: StateRecordLink[] | null
        tag: unknown
    }

    /** 0 = set trap (changed value only), 1 = delete of an existing key, 2 = defineProperty. */
    export type StateWriteKind = 0 | 1 | 2

    export type StateWriteCallback = (kind: StateWriteKind, owner: object, prop: PropertyKey, value: unknown, stored: unknown) => void
    export type StateLinkCallback = (child: object, childRecord: StateRecord, parentRecord: StateRecord) => void

    export function set_state_write_hook(
        fn: StateWriteCallback | null,
        onError?: ((error: unknown) => void) | null,
        onLink?: StateLinkCallback | null,
    ): void
    export function link_state_child(child: unknown, parent: object | StateRecord, key: PropertyKey | null): void
    export const state_records: WeakMap<object, StateRecord>
    export function record_of(proxy: object): StateRecord
    export const PATCH_ID: string
}
