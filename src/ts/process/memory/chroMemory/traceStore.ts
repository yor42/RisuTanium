import { writable } from 'svelte/store'
import type { ChroLoreTrace } from './loreRecall'
import type { ChroMemoryTrace } from './shadow'

/** The newest ChroMemory trace; the modal compares its chatKey with the open chat's. */
export const chroMemoryTrace = writable<Readonly<ChroMemoryTrace> | null>(null)

/** The newest lore recall trace; in memory only, compared by chatKey like the memory trace. */
export const chroLoreTrace = writable<Readonly<ChroLoreTrace> | null>(null)

/** The chat key whose index was discarded by the user, until a trace for that key arrives. */
export const chroMemoryDiscarded = writable<string | null>(null)
