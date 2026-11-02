import type { loreBook } from "../storage/database.svelte";

/**
 * Every entry removed when `target` is deleted: the target itself and, for a folder,
 * everything inside it at any depth.
 *
 * A folder whose key is not a non-empty string contributes no children, so an empty
 * `folder` field on a top-level entry is never matched. Each folder key is expanded
 * once, so cyclic folder references terminate.
 */
export function getLoreBookSubtree(lore: loreBook[], target: loreBook): Set<loreBook> {
    const removed = new Set<loreBook>([target])
    if (target.mode !== 'folder') {
        return removed
    }

    const expanded = new Set<string>()
    const pending: string[] = []
    const expand = (folder: loreBook) => {
        if (typeof folder.key !== 'string' || folder.key === '' || expanded.has(folder.key)) {
            return
        }
        expanded.add(folder.key)
        pending.push(folder.key)
    }

    expand(target)
    while (pending.length > 0) {
        const key = pending.pop()
        for (const item of lore) {
            if (item.folder !== key || removed.has(item)) {
                continue
            }
            removed.add(item)
            if (item.mode === 'folder') {
                expand(item)
            }
        }
    }
    return removed
}
