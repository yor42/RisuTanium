import type { character, groupChat } from "../storage/database.svelte";

/**
 * A character's `ttsMode` produces speech when it is set and is neither `'none'`
 * nor `'normal'` (the value card import writes for "no TTS"). Plugin-defined
 * modes, handled by TTS preprocessors, qualify.
 */
export function isTTSVoiceMode(mode: string | null | undefined): boolean {
    return !!mode && mode !== 'none' && mode !== 'normal'
}

/**
 * Whether the chat owner can produce speech: a character with a qualifying
 * mode, or a group with at least one member (resolved through `findMember`)
 * whose mode qualifies, since group turns are spoken with the member's voice.
 */
export function canChatSpeak(
    owner: character | groupChat | null | undefined,
    findMember: (chaId: string) => { ttsMode?: string } | null | undefined,
): boolean {
    if (!owner) return false
    if (owner.type === 'group') {
        return (owner.characters ?? []).some(id => isTTSVoiceMode(findMember(id)?.ttsMode))
    }
    return isTTSVoiceMode(owner.ttsMode)
}
