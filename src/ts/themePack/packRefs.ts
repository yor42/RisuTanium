// The reserved name of an installed theme pack's file in the asset store, and the walk that names every asset an installed
// pack keeps. A leaf: it imports nothing, so the keep-list collectors, the `.bin` export and import, and the install can
// all share it.

/** A pack file's basename in the asset store: `tp-` + sha256 hex + one lower-case extension. */
export const PACK_ASSET_NAME = /^tp-[0-9a-f]{64}\.[a-z0-9]{1,16}$/

/** The key form layout A stores: one archive per pack. */
export const PACK_ARCHIVE_KEY = /^assets\/tp-[0-9a-f]{64}\.risutheme$/

/**
 * True when the basename of `nameOrKey` (after the last `/` or `\`), lower-cased, matches `PACK_ASSET_NAME`. Case is
 * folded because a desktop file system that ignores case would let a differently spelled name replace a pack file.
 */
export function isPackAssetName(nameOrKey: string): boolean {
    const cut = Math.max(nameOrKey.lastIndexOf('/'), nameOrKey.lastIndexOf('\\'))
    return PACK_ASSET_NAME.test(nameOrKey.slice(cut + 1).toLowerCase())
}

/**
 * Adds every string that starts with `assets/` found anywhere in `themePacks`, whatever the entry's version or shape
 * (an entry this build cannot read still keeps its files). Iterative, so no depth limit applies; a node already seen is
 * not walked again, so a cyclic value ends. A value that is not an object or an array adds nothing and never throws.
 */
export function collectPackAssetRefs(themePacks: unknown, add: (name: string) => void): void {
    if (typeof themePacks !== 'object' || themePacks === null) {
        return
    }
    const visited = new Set<object>()
    const pending: object[] = [themePacks]
    while (pending.length > 0) {
        const node = pending.pop() as object
        if (visited.has(node)) {
            continue
        }
        visited.add(node)
        const children: unknown[] = Array.isArray(node) ? node : Object.values(node)
        for (const child of children) {
            if (typeof child === 'string') {
                if (child.startsWith('assets/')) {
                    add(child)
                }
            } else if (typeof child === 'object' && child !== null) {
                pending.push(child)
            }
        }
    }
}
