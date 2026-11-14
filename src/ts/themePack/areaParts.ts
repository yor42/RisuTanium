// The `data-part` names a stylesheet of each themed screen may name (UI-S6 I0a, axis B of Rule SCOPE). A stylesheet is applied to
// one screen only (MC-1608), so its selectors may name only the parts that screen renders: a part rendered on another screen
// would be restyled by a sheet that was judged against this one.
//
// CHAT_PARTS is generated from the markup and guarded by areaParts.test.ts, which recomputes it and prints the expected constant
// on a mismatch. The chat screen is the shell surface: the ChatShell tree and the shell sidebar (src/lib/ChatShell/**).

/** The areas whose stylesheets the scope rules judge. */
export type ScopedArea = 'chat' | 'studio'

/** Parts the shell renders from a component under src/lib/ChatScreens/** that the legacy chat screen renders as well. */
export const SHARED_CHAT_PARTS: readonly string[] = ['notifications-off-notice']

/** Parts only the legacy chat screen renders: no shell element carries them, so a rule on them could never match the themed screen. */
export const LEGACY_CHAT_PARTS: readonly string[] = ['chat-messages']

const CHAT_PART_NAMES: readonly string[] = [
    'chat-action-group', 'chat-ai-law-notice', 'chat-announcer', 'chat-attachment-chip', 'chat-cold-loading', 'chat-cold-notice', 'chat-composer',
    'chat-composer-enter-scope', 'chat-composer-host', 'chat-composer-input', 'chat-composer-persona', 'chat-composer-plus', 'chat-composer-progress',
    'chat-composer-row', 'chat-composer-stop', 'chat-composer-tools', 'chat-composer-translate', 'chat-critical-action', 'chat-critical-body', 'chat-critical-handle',
    'chat-critical-header', 'chat-critical-title', 'chat-customize-action', 'chat-customize-preview', 'chat-drag-handle', 'chat-drop-indicator', 'chat-extras-strip',
    'chat-failed-card', 'chat-first-message', 'chat-floating-actions', 'chat-folder', 'chat-folder-host', 'chat-folder-menu', 'chat-folder-name',
    'chat-folder-name-input', 'chat-gen-strip', 'chat-generate-reply', 'chat-header', 'chat-header-avatar', 'chat-header-back', 'chat-header-chat', 'chat-header-heading',
    'chat-header-host', 'chat-header-menu', 'chat-header-title', 'chat-jump-bookmarks', 'chat-jump-date', 'chat-jump-number', 'chat-legacy-cold-notice', 'chat-list', 'chat-list-character', 'chat-list-folder', 'chat-list-row',
    'chat-list-row-count', 'chat-list-row-last', 'chat-list-row-main', 'chat-list-row-mark', 'chat-list-row-menu', 'chat-list-row-name', 'chat-list-row-time',
    'chat-list-scroller', 'chat-load-more', 'chat-long-press-ring', 'chat-message', 'chat-message-actions', 'chat-message-actions-float', 'chat-message-actions-hover',
    'chat-message-alts', 'chat-message-avatar', 'chat-message-badges', 'chat-message-body', 'chat-message-branch-origin', 'chat-message-container',
    'chat-message-delete-pending', 'chat-message-divider', 'chat-message-draft-restored', 'chat-message-editor', 'chat-message-editor-controls', 'chat-message-end',
    'chat-message-failed', 'chat-message-generation-info', 'chat-message-interrupted', 'chat-message-list', 'chat-message-memory-limit', 'chat-message-meta',
    'chat-message-name', 'chat-message-name-row', 'chat-message-render-failed', 'chat-message-retranslate', 'chat-message-spacer', 'chat-message-stage',
    'chat-message-stop-tts', 'chat-message-text', 'chat-message-translate', 'chat-message-translation-edit', 'chat-message-translation-editor', 'chat-message-tts',
    'chat-move-down', 'chat-move-up', 'chat-new-message', 'chat-order-status', 'chat-persona-settings', 'chat-plugin-panel', 'chat-plugin-panels', 'chat-preset-chip', 'chat-return-chip', 'chat-row',
    'chat-row-draft', 'chat-row-editing', 'chat-row-host', 'chat-row-menu', 'chat-row-name', 'chat-row-name-input', 'chat-row-preview', 'chat-row-time',
    'chat-save-guard', 'chat-search-character', 'chat-search-chat', 'chat-search-group', 'chat-search-results', 'chat-search-scroller', 'chat-search-status', 'chat-send',
    'chat-sheet', 'chat-sheet-body', 'chat-sheet-handle', 'chat-sheet-item', 'chat-sheet-item-value', 'chat-sheet-layer', 'chat-sheet-scrim', 'chat-sheet-title',
    'chat-shell', 'chat-sidebar', 'chat-sidebar-footer', 'chat-sidebar-header', 'chat-sidebar-list', 'chat-sidebar-search', 'chat-sidebar-search-field',
    'chat-sidebar-strip', 'chat-sidebar-toggle', 'chat-status-row', 'chat-sticker-assets', 'chat-stream-finished', 'chat-stream-open', 'chat-stream-thinking',
    'chat-streaming-view', 'chat-suggestions', 'chat-swipe-arm', 'chat-swipe-commit-mark', 'chat-swipe-meter', 'chat-swipe-peek', 'chat-swipe-peek-chip', 'chat-swipe-peek-text',
    'chat-switch-actions', 'chat-switch-back', 'chat-switch-frame', 'chat-switch-retry', 'chat-switch-skeleton', 'chat-switch-text', 'chat-toast', 'chat-transcript',
    'chat-translate-preview', 'more-list', 'more-studio', 'more-subview', 'notifications-off-notice', 'plus-chip', 'plus-chip-label', 'plus-chip-mark', 'plus-chip-more',
    'plus-chip-options', 'plus-chip-options-head', 'plus-chip-row', 'plus-chips', 'plus-chips-head', 'plus-live', 'row-menu', 'row-menu-group', 'row-menu-reason',
    'sidebar-edit-order', 'sidebar-home', 'sidebar-more', 'sidebar-more-panel', 'sidebar-settings', 'sidebar-sort', 'strip-all', 'strip-avatar', 'strip-group-glyph',
    'strip-name', 'this-chat-all-settings', 'this-chat-body', 'this-chat-delete', 'this-chat-delete-reason', 'this-chat-export', 'this-chat-field', 'this-chat-group',
    'this-chat-hide-names', 'this-chat-jailbreak', 'this-chat-jump', 'this-chat-memory', 'this-chat-memory-view', 'this-chat-modules', 'this-chat-name-input', 'this-chat-note',
    'this-chat-persona', 'this-chat-plugin', 'this-chat-rename', 'this-chat-row', 'this-chat-scope-tag', 'this-chat-stats', 'this-chat-status', 'this-chat-studio',
    'this-chat-title', 'this-chat-title-block', 'this-chat-toggles', 'this-chat-value', 'toggle-badge', 'toggle-chat-tag', 'toggle-dot', 'toggle-label', 'toggle-menu',
    'toggle-menu-button', 'toggle-move-down', 'toggle-move-up', 'toggle-on-a11y', 'toggle-preview', 'toggle-reset', 'toggle-revert', 'toggle-row', 'toggle-row-line',
    'toggle-row-main', 'toggle-scope-switch', 'toggle-select', 'toggle-select-list', 'toggle-select-option', 'toggle-star', 'toggle-star-mark', 'toggle-switch',
    'toggle-tags', 'toggle-text-button', 'toggle-text-input', 'toggles-announce', 'toggles-caption', 'toggles-chevron', 'toggles-close', 'toggles-count', 'toggles-crumb',
    'toggles-crumb-option', 'toggles-crumb-path', 'toggles-divider', 'toggles-editor', 'toggles-editor-actions', 'toggles-editor-cancel', 'toggles-editor-field',
    'toggles-editor-save', 'toggles-editor-title', 'toggles-fav-title', 'toggles-fav-unreadable', 'toggles-favourites', 'toggles-filter-chip', 'toggles-flash',
    'toggles-group', 'toggles-group-head', 'toggles-hint', 'toggles-list', 'toggles-live', 'toggles-nomatch', 'toggles-nomatch-clear', 'toggles-nomatch-filter-off',
    'toggles-none', 'toggles-none-help', 'toggles-panel-body', 'toggles-picker', 'toggles-picker-option', 'toggles-results', 'toggles-scope', 'toggles-search',
    'toggles-search-bar', 'toggles-search-clear', 'toggles-search-icon', 'toggles-search-input', 'toggles-section', 'toggles-section-detail', 'toggles-section-head',
    'toggles-section-title', 'toggles-title', 'toggles-titlebar', 'toggles-total',
]

/** The chat registry's own part names plus the names rendered under src/lib/ChatShell/**, minus the names rendered on any other screen, plus the shared list, minus the legacy list. */
export const CHAT_PARTS: ReadonlySet<string> = new Set<string>(CHAT_PART_NAMES)

const STUDIO_PART = /^studio(-[a-z0-9-]+)?$/

/** The Studio screen's parts: `studio` and every `studio-*` name (no such name is rendered outside src/lib/Studio/**). */
export const isStudioPart = (name: string): boolean => STUDIO_PART.test(name)

/** Whether a stylesheet of the area may name this part. */
export function isAreaPart(area: ScopedArea, name: string): boolean {
    return area === 'chat' ? CHAT_PARTS.has(name) : isStudioPart(name)
}
