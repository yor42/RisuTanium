/**
 * Page-level facts that Home's chrome shares with controls outside the Home files. Not persisted.
 * `phoneDrawer` is true while the phone landing shows the menu button and drawer, so the sidebar
 * arrow (which would open the legacy rail on top of it) stays away. `landing` is true while a Home
 * shell is mounted, Realm view included, and Sidebar reads it for the rail look. Each flag is true
 * while at least one holder holds it, and one holder's release never clears another holder's hold,
 * so a shell built before the old one is destroyed keeps the flag. HomeShell is the only holder.
 */
export const homeChrome = $state({ phoneDrawer: false, landing: false })

export type HomeChromeFlag = 'phoneDrawer' | 'landing'

// Plain module state, never read by an effect: taking or releasing a hold creates no reactive dependency.
const holds: Record<HomeChromeFlag, number> = { phoneDrawer: 0, landing: 0 }

/** Raises the flag and returns its release; a second call of the release does nothing. */
export function holdHomeChrome(flag: HomeChromeFlag): () => void {
    holds[flag]++
    homeChrome[flag] = true
    let released = false
    return () => {
        if (released) return
        released = true
        holds[flag]--
        homeChrome[flag] = holds[flag] > 0
    }
}
