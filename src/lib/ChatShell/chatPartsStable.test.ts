// Compatibility guard (passes before and after the icon change): the icon swap adds no data-part and renames none, so the parts of
// the controls whose glyphs became icons stay in the generated CHAT_PARTS that theme packs are judged against.
import { describe, expect, test } from 'vitest'
import { CHAT_PARTS } from '../../ts/themePack/areaParts'

const TOUCHED_PARTS = [
    'chat-header-back', 'chat-header-menu',
    'chat-composer-persona', 'chat-composer-plus', 'chat-send', 'chat-composer-stop', 'chat-composer-enter-scope',
    'chat-message-actions', 'chat-message-badges', 'chat-generate-reply', 'chat-message-alts', 'chat-message-end',
    'chat-extras-strip', 'chat-attachment-chip',
    'plus-chip', 'plus-chip-mark', 'plus-chip-more', 'plus-chip-label',
    'toggles-close', 'toggle-menu-button', 'toggle-select-list', 'toggle-text-button', 'toggle-preview', 'toggles-chevron',
]

describe('chat parts touched by the icon change', () => {
    test('every part stays in CHAT_PARTS', () => {
        expect(TOUCHED_PARTS).toHaveLength(24)
        expect(TOUCHED_PARTS.filter((name) => !CHAT_PARTS.has(name))).toEqual([])
    })
})
