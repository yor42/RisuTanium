import { writable } from 'svelte/store'

// Leaf module: it imports nothing from stores.svelte, so suites that mock that module wholesale
// can load every shared component that reads this flag.
export const studioOpen = writable(false)
