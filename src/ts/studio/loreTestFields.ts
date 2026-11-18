/**
 * What the lorebook rule tester never reads from the live data, shared by the
 * runner (which does not copy it) and the stale signal (which does not watch
 * it). Neither set is read by the scan or by the CBS it parses: the owner's
 * `chats` are replaced by the one context chat, and the memory and branch
 * fields below take no part in which entries match or how many tokens they cost.
 */

export const OWNER_SKIP: ReadonlySet<string> = new Set(['chats'])

export const CHAT_SKIP: ReadonlySet<string> = new Set([
    'alt',
    'hypaV2Data',
    'hypaV3Data',
    'supaMemoryData',
    'supaMemoryCoveredId',
    'lastMemory',
    'sdData',
    'suggestMessages',
    'bookmarks',
    'bookmarkNames',
])
