/**
 * Page-level facts that Home's chrome shares with controls outside the Home files. Not persisted.
 * `phoneDrawer` is true while the phone landing shows the menu button and drawer, so the sidebar
 * arrow (which would open the legacy rail on top of it) stays away. HomeShell owns the writes.
 */
export const homeChrome = $state({ phoneDrawer: false })
