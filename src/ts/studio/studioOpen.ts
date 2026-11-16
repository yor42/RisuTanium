import { writable, type Writable } from 'svelte/store'
import { flushStudioFields } from './fieldFlush'

// Leaf module: it imports nothing from stores.svelte (only the leaf field registry), so suites that mock that
// module wholesale can load every shared component that reads this flag.
const inner = writable(false)
let current = false

// Every close passes through here, so the held text of the Studio fields is written exactly once, before the
// value changes and before any subscriber runs or is queued, wherever the close is made from.
function set(value: boolean): void {
    if (current && !value) flushStudioFields('leave')
    current = value
    inner.set(value)
}

export const studioOpen: Writable<boolean> = {
    subscribe: inner.subscribe,
    set,
    update: (updater) => set(updater(current)),
}
