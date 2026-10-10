import { untrack } from 'svelte'
import { DBState } from '../stores.svelte'
import { buildIndex, createSearchCache, parseQuery, searchIndex, type SearchStats } from './characterSearch'

/** How long typing must pause before a query reaches the character lists. */
const SEARCH_DEBOUNCE_MS = 150

/**
 * `source()` delayed until it has been stable for `ms`. The first value is
 * taken at once, and an empty or whitespace-only value applies at once and
 * cancels a pending one, so clearing the box never leaves a narrowed list or a
 * late stale query. Contains an effect, so call it while a component (or an
 * effect root) is being initialised; the timer is cleared with its owner.
 */
export function createDebouncedValue(source: () => string, ms: number): { readonly value: string } {
    let value = $state(source())
    $effect(() => {
        const next = source()
        if (untrack(() => value) === next) {
            return
        }
        if (next.trim() === '') {
            value = next
            return
        }
        const timer = setTimeout(() => {
            value = next
        }, ms)
        return () => clearTimeout(timer)
    })
    return {
        get value() {
            return value
        },
    }
}

export interface CharacterSearchOptions {
    debounceMs?: number
    stats?: SearchStats
}

/**
 * The search result shared by a header count and the lists under it. One index
 * of `db.characters` is kept per instance and rebuilt only when something the
 * search reads changes; a query change only re-partitions precomputed text.
 *
 * Every property is a getter over deriveds: a holder of the returned object
 * (an embedded list) sees later results, so never copy a property out of it
 * once at creation. Contains an effect; call it during component
 * initialisation.
 */
export function createCharacterSearch(getQuery: () => string, options: CharacterSearchOptions = {}) {
    const cache = createSearchCache(options.stats)
    const query = createDebouncedValue(getQuery, options.debounceMs ?? SEARCH_DEBOUNCE_MS)
    const index = $derived.by(() => buildIndex(DBState.db.characters, cache))
    const tokens = $derived(parseQuery(query.value))
    const result = $derived(searchIndex(index, tokens))
    return {
        get live() {
            return result.live
        },
        get trash() {
            return result.trash
        },
        get matched() {
            return result.matched
        },
        get trashedTotal() {
            return result.trashedTotal
        },
        /** True while the landed query has at least one word. */
        get searching() {
            return tokens.length > 0
        },
    }
}

export type CharacterSearch = ReturnType<typeof createCharacterSearch>
