/**
 * How the app treats a model-driven tool call. `read` and `free` dispatch without a prompt; `mutating` and
 * `third-party` need the user's decision.
 */
export type ToolClass = 'read' | 'free' | 'mutating' | 'third-party'

type InternalTable = {
    read?: readonly string[]
    free?: readonly string[]
    mutating?: readonly string[]
}

/**
 * The app's own classification of every built-in tool, by client URL. A name that is not listed under its client
 * is `mutating`, so a tool added to a client stays gated until it is classified here. Tool annotations that a
 * server supplies about itself are never consulted.
 */
const INTERNAL_TOOLS: Readonly<Record<string, InternalTable>> = {
    'internal:risuai': {
        read: [
            'risu-get-chat-history',
            'risu-list-characters',
            'risu-get-character-info',
            'risu-list-character-lorebooks',
            'risu-get-character-lorebook',
            'risu-get-character-regex-scripts',
            'risu-get-character-additional-assets',
            'risu-get-character-lua-script',
            'risu-list-modules',
            'risu-get-module-info',
            'risu-list-module-lorebooks',
            'risu-get-module-lorebook',
            'risu-get-module-regex-scripts',
            'risu-get-module-lua-script',
        ],
        mutating: [
            'risu-set-character-info',
            'risu-set-character-lorebook',
            'risu-delete-character-lorebook',
            'risu-set-character-regex-scripts',
            'risu-delete-character-regex-scripts',
            'risu-delete-character-additional-assets',
            'risu-set-character-lua-script',
            'risu-set-module-info',
            'risu-set-module-lorebook',
            'risu-delete-module-lorebook',
            'risu-set-module-regex-script',
            'risu-delete-module-regex-script',
            'risu-set-module-lua-script',
        ],
    },
    'internal:fs': {
        read: [
            'fs_read_file',
            'fs_list_directory',
            'fs_search_files',
            'fs_get_file_info',
            'fs_watch_directory',
            'fs_find_duplicates',
            'fs_tree_view',
        ],
        mutating: [
            'fs_write_file',
            'fs_create_directory',
            'fs_delete_file',
            'fs_copy_file',
            'fs_move_file',
        ],
    },
    'internal:graphmem': {
        read: ['readMemory'],
        mutating: ['writeMemory'],
    },
    'internal:aiaccess': {
        free: ['runLLM'],
    },
    'internal:googlesearch': {
        free: ['google_search', 'google_search_images'],
    },
    'internal:dice': {
        free: ['rollDice'],
    },
    'internal:workspace': {},
}

/** The URLs of the built-in clients that have a classification table. */
export function classifiedInternalUrls(): string[] {
    return Object.keys(INTERNAL_TOOLS)
}

/** Whether `name` is listed in the table of the built-in client `url`. */
export function isToolClassified(url: string, name: string): boolean {
    const table = INTERNAL_TOOLS[url]
    if(!table) {
        return false
    }
    return [table.read, table.free, table.mutating].some(names => names?.includes(name) === true)
}

export function classifyTool(url: string, name: string): ToolClass {
    if(!url.startsWith('internal:')) {
        return 'third-party'
    }
    const table = INTERNAL_TOOLS[url]
    if(table?.read?.includes(name)) {
        return 'read'
    }
    if(table?.free?.includes(name)) {
        return 'free'
    }
    return 'mutating'
}
