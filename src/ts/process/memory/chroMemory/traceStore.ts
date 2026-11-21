import { writable } from 'svelte/store'
import type { ChroMemoryTrace } from './shadow'

/** The newest ChroMemory trace; the modal compares its chatKey with the open chat's. */
export const chroMemoryTrace = writable<Readonly<ChroMemoryTrace> | null>(null)

/** The chat key whose index was discarded by the user, until a trace for that key arrives. */
export const chroMemoryDiscarded = writable<string | null>(null)
