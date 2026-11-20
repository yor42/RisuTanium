// The output contract of the .bin analyzer: bucket edges, fixed label lists and the SHAPE allow-list tree.
// Every label that appears in the output exists only as a key of SHAPE, taken from the constants below and
// never from the analysed data. Every value in the output is a number or an array of numbers.

export const SCHEMA_VERSION = 1

export const MESSAGE_LENGTH_EDGES: readonly number[] = [0, 50, 100, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 4000, 6000, 8000, 12000, 16000, 32000]
export const MESSAGES_PER_CHAT_EDGES: readonly number[] = [0, 1, 10, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]
export const LORE_ENTRIES_EDGES: readonly number[] = [0, 1, 5, 10, 20, 50, 100, 200, 300, 500, 1000, 2000]
export const LORE_CONTENT_EDGES: readonly number[] = [0, 50, 100, 200, 500, 1000, 2000, 4000, 8000, 16000, 32000]
export const REGEX_SCRIPTS_EDGES: readonly number[] = [0, 1, 5, 10, 20, 50, 100, 200, 500]

/** Bands of Hangul code points over letter code points; the band `i` is `edges[i] <= share < edges[i+1]`. */
export const HANGUL_BANDS = ['none', 'low', 'mixed', 'high'] as const
export const HANGUL_BAND_EDGES: readonly number[] = [0, 0.1, 0.5, 0.9]
export type HangulBand = typeof HANGUL_BANDS[number]

export const ROLES = ['user', 'char'] as const
export type Role = typeof ROLES[number]

/** The case labels of the application's lorebook decorator callback. Any other name counts as `other`. */
export const DECORATOR_NAMES = [
    'end', 'activate_only_after', 'activate_only_every', 'keep_activate_after_match', 'dont_activate_after_match',
    'depth', 'reverse_depth', 'instruct_depth', 'reverse_instruct_depth', 'instruct_scan_depth', 'role', 'scan_depth',
    'is_greeting', 'position', 'inject_lore', 'inject_at', 'inject_replace', 'inject_prepend', 'ignore_on_max_context',
    'additional_keys', 'exclude_keys', 'exclude_keys_all', 'match_full_word', 'match_partial_word', 'is_user_icon',
    'activate', 'dont_activate', 'disable_ui_prompt', 'probability', 'priority', 'unrecursive', 'recursive',
    'no_recursive_search',
] as const
export const DECORATOR_KEYS = [...DECORATOR_NAMES, 'other'] as const
export type DecoratorKey = typeof DECORATOR_KEYS[number]

export const LORE_MODES = ['normal', 'constant', 'multiple', 'child', 'folder', 'other'] as const

/** `'n'` is a finite number >= 0; `'n[]'` is an array of such numbers; `'i'` is an integer >= -1 (an index, -1 meaning none). */
export type ShapeLeaf = 'n' | 'n[]' | 'i'
export type Shape = ShapeLeaf | { readonly [key: string]: Shape }

const keysOf = (keys: readonly string[], leaf: Shape): Shape => Object.fromEntries(keys.map((k) => [k, leaf]))

const HIST: Shape = { edges: 'n[]', counts: 'n[]', n: 'n', p50: 'n', p90: 'n', p99: 'n', max: 'n' }

export const SHAPE: Shape = {
    schemaVersion: 'n',
    totals: keysOf([
        'characters', 'groups', 'chats', 'messages', 'messagesUser', 'messagesChar', 'nonStringMessageData',
        'hiddenMessages', 'hiddenByFlag', 'hiddenByReset', 'altMessages', 'modules', 'enabledModules',
        'loreEntriesCharacter', 'loreEntriesGroup', 'loreEntriesChat', 'loreEntriesModule',
        'regexScriptsGroup', 'incompleteUnits', 'omittedBlocks',
    ], 'n'),
    hiddenShare: 'n',
    hangulBandEdges: 'n[]',
    messageLength: {
        edges: 'n[]',
        byRole: keysOf(ROLES, HIST),
        byHangulBand: keysOf(HANGUL_BANDS, HIST),
        byRoleAndHangulBand: keysOf(ROLES, keysOf(HANGUL_BANDS, HIST)),
    },
    messagesPerChat: HIST,
    loreEntriesPerCharacter: HIST,
    loreEntriesPerChat: HIST,
    loreEntriesPerModule: HIST,
    loreContentLength: HIST,
    lore: {
        selective: 'n',
        useRegex: 'n',
        alwaysActive: 'n',
        withDecorators: 'n',
        decoratorLines: 'n',
        decoratorThrows: 'n',
        decorators: keysOf(DECORATOR_KEYS, 'n'),
        mode: keysOf(LORE_MODES, 'n'),
    },
    regexScriptsPerCharacter: HIST,
    regexScriptsPerModule: HIST,
}
