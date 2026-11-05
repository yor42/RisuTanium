# UI-S1a shell parts (2026-11-06, records batch 59, MC-1087)

Source: `data-part` attributes in `src/lib/ChatShell/*.svelte` at the local WIP commit 42d881e96 (branch `uis1a-wip`, not on main); the documented list is `docs/design/chat/THEME_AUDIT.md` (read-only; the maintainer's design package, not edited by the campaign). Maintainer decision (MC-1087): the shell uses the documented names where a documented counterpart exists; the remainder is listed here so the design package owner can add them.

## Renamed to the documented name (2026-11-06)
| Old name | Documented name |
|---|---|
| `chat-alternatives` | `chat-message-alts` |
| `chat-message-meta-actions` | `chat-message-actions` |
| `chat-message-status` | `chat-status-row` |

## Used and documented (24)
`chat-composer`, `chat-composer-input`, `chat-composer-persona`, `chat-composer-plus`, `chat-header`, `chat-header-menu`, `chat-header-title`, `chat-message`, `chat-message-actions`, `chat-message-alts`, `chat-message-avatar`, `chat-message-badges`, `chat-message-body`, `chat-message-name`, `chat-message-name-row`, `chat-send`, `chat-sheet`, `chat-sheet-body`, `chat-sheet-item`, `chat-sheet-scrim`, `chat-sheet-title`, `chat-shell`, `chat-status-row`, `chat-transcript`

## Used and NOT in THEME_AUDIT.md (55): for the design package owner to document, or rename
`chat-action-group`, `chat-ai-law-notice`, `chat-attachment-chip`, `chat-cold-loading`, `chat-cold-notice`, `chat-composer-enter-scope`, `chat-composer-host`, `chat-composer-progress`, `chat-composer-row`, `chat-composer-stop`, `chat-composer-tools`, `chat-composer-translate`, `chat-customize-action`, `chat-customize-preview`, `chat-extras-strip`, `chat-first-message`, `chat-floating-actions`, `chat-generate-reply`, `chat-header-back`, `chat-header-host`, `chat-legacy-cold-notice`, `chat-load-more`, `chat-long-press-ring`, `chat-message-branch-origin`, `chat-message-container`, `chat-message-delete-pending`, `chat-message-divider`, `chat-message-draft-restored`, `chat-message-editor`, `chat-message-editor-controls`, `chat-message-end`, `chat-message-failed`, `chat-message-generation-info`, `chat-message-interrupted`, `chat-message-list`, `chat-message-memory-limit`, `chat-message-meta`, `chat-message-render-failed`, `chat-message-retranslate`, `chat-message-stop-tts`, `chat-message-translate`, `chat-message-translation-edit`, `chat-message-translation-editor`, `chat-new-message`, `chat-plugin-panel`, `chat-plugin-panels`, `chat-sheet-layer`, `chat-sticker-assets`, `chat-stream-finished`, `chat-stream-open`, `chat-stream-thinking`, `chat-streaming-view`, `chat-suggestions`, `chat-swipe-arm`, `chat-translate-preview`

Notes: `role="log"` sits on `chat-message-list` while THEME_AUDIT.md places it on `chat-transcript`; both parts exist (the transcript wraps the list). No part carries `data-part-critical` except the protected surfaces (checked by the `criticalParts` scan test).

