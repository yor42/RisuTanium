import { writable } from 'svelte/store'

// Leaf module: it imports nothing from stores.svelte, so suites that mock that module wholesale still reach
// the real flag. True while the App-level character grid (the Sidebar rail's Characters button) replaces
// the sidebar; the last-character restore treats it as the user leaving Home.
export const charGridOpen = writable(false)
