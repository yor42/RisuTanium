/**
 * Bookkeeping for the parents of hand-mounted message roots.
 *
 * Roots mounted by one run of the Chats effect must stay children of ONE parent (a holder): sibling roots keep
 * stale links to each other once the effect re-runs and detaches them, and a later flush then traverses a root
 * through its sibling's link and leaves it unable to update. A holder is created per run that mounts anything,
 * is released root by root, and is destroyed once its last mounted root is released.
 */
export type MountHolderRun<K> = {
    /** Records a root that was actually mounted under this holder. Call it right after the mount succeeded. */
    add: (key: K) => void
    /** Supplies the function that destroys the holder, once the holder exists. */
    attach: (destroy: () => void) => void
    /** Ends the run; a holder that ended up with no mounted root is destroyed at once. */
    finish: () => void
}

export type MountHolders<K> = {
    begin: () => MountHolderRun<K>
    /** Releases one root; destroys its holder when that was the holder's last member. A no-op for an unknown key. */
    release: (key: K) => void
    destroyAll: () => void
}

type Holder<K> = {
    members: Set<K>
    destroy: (() => void) | null
    destroyed: boolean
    finished: boolean
}

export function createMountHolders<K>(): MountHolders<K> {
    const holderOf = new Map<K, Holder<K>>()
    const live = new Set<Holder<K>>()

    const destroyHolder = (holder: Holder<K>) => {
        if (holder.destroyed) return
        holder.destroyed = true
        live.delete(holder)
        const destroy = holder.destroy
        holder.destroy = null
        destroy?.()
    }

    const unlink = (key: K) => {
        const holder = holderOf.get(key)
        if (!holder) return
        holderOf.delete(key)
        holder.members.delete(key)
        if (holder.finished && holder.members.size === 0) {
            destroyHolder(holder)
        }
    }

    return {
        begin: () => {
            const holder: Holder<K> = { members: new Set(), destroy: null, destroyed: false, finished: false }
            live.add(holder)
            return {
                add: (key) => {
                    unlink(key)
                    holder.members.add(key)
                    holderOf.set(key, holder)
                },
                attach: (destroy) => {
                    if (holder.destroyed) {
                        destroy()
                        return
                    }
                    holder.destroy = destroy
                },
                finish: () => {
                    holder.finished = true
                    if (holder.members.size === 0) {
                        destroyHolder(holder)
                    }
                },
            }
        },
        release: unlink,
        destroyAll: () => {
            holderOf.clear()
            for (const holder of [...live]) {
                holder.members.clear()
                destroyHolder(holder)
            }
        },
    }
}
