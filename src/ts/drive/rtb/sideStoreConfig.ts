/**
 * The localforage options of the six side stores of an `.rtb` file (A3.4), shared by the
 * owner modules and the side-store adapters. Both pass the same frozen object to
 * `createInstance`, so the adapter and the owner cannot name different databases.
 *
 * A config without `storeName` leaves localforage's default object store in place; that
 * is the store the hypaVector owners have always used.
 */
export interface ForageStoreConfig {
    readonly name: string
    readonly storeName?: string
}

export const IRIS_STORE: ForageStoreConfig = Object.freeze({ name: 'iris_dialogues', storeName: 'iris_dialogues' })
export const GOOGLE_SEARCH_STORE: ForageStoreConfig = Object.freeze({ name: 'google-search-credentials', storeName: 'credentials' })
export const HYPA_VECTOR_STORE: ForageStoreConfig = Object.freeze({ name: 'hypaVector' })
export const PLUGIN_SAFE_STORE: ForageStoreConfig = Object.freeze({ name: 'plugin', storeName: 'plugin' })
export const PLUGIN_PERMISSIONS_STORE: ForageStoreConfig = Object.freeze({ name: 'plugin_permissions', storeName: 'plugin_permissions' })
export const MCP_TOOL_CALLS_STORE: ForageStoreConfig = Object.freeze({ name: 'mcp-tool-calls', storeName: 'mcp-tool-calls' })

/** The prefix of every localStorage key and every `plugin` store key a plugin's safe storage owns. */
export const SAFE_PLUGIN_LS_PREFIX = 'safe_plugin_'

/**
 * The localStorage keys of `side.ui-prefs`: a key is carried when it records a deliberate
 * UI choice by the user (a toggle, sort, order, favourites, an accessibility or motion
 * choice, a shell switch, or the view memory of the library, rail or Settings). Device
 * capability flags, diagnostics, caches, storage and lock state, auth and consent,
 * recovery copies, keys naming a database object and per-screen geometry are not carried.
 */
export const UI_PREFS_KEYS: readonly string[] = Object.freeze([
    'risutanium.grid.sort',
    'risutanium.library.tab',
    'risutanium.rail.openFolders',
    'risutanium.rail.scroll',
    'risuChatShell.enabled',
    'risuChatShell.haptics',
    'risuChatShell.enterMode',
    'risuChatShell.chatSort',
    'risuChatShell.actionSlots',
    'risuChatShell.toggleFavourites',
    'risuChatShell.reducedMotion',
    'risuChatShell.reduceCardEffects',
    'risuSettings.enabled',
    'risuStudio.enabled',
    'risuSettings.lastPage',
])
