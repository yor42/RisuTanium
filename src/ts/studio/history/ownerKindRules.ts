// Per-kind rules the Studio panels share, as pure functions of a parsed owner key so a test pins each kind's answer.

import type { ParsedOwnerKey } from './ownerPhase'

// Whether a private or group bound character hides this owner's history. A module's and a preset's history is its
// own, so the bound character does not hide it, as it does not stop Ctrl+Z from replaying it.
export function boundCharacterHides(parsed: ParsedOwnerKey | null): boolean {
    if (parsed === null) return true
    switch (parsed.kind) {
        case 'module':
        case 'preset':
            return false
        case 'character':
        case 'chat':
            return true
        default: {
            // Adding an owner kind must decide here whether a private or group bound character hides it.
            const unhandled: never = parsed
            void unhandled
            return true
        }
    }
}

// The restore sheet's note about chats applies to a character's restore point only.
export function hasChatNote(parsed: ParsedOwnerKey | null): boolean {
    if (parsed === null) return false
    switch (parsed.kind) {
        case 'character':
            return true
        case 'chat':
        case 'module':
        case 'preset':
            return false
        default: {
            // Adding an owner kind must decide its note here; the fallback is no note.
            const unhandled: never = parsed
            void unhandled
            return false
        }
    }
}
