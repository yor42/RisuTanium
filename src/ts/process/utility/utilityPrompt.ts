import type { OpenAIChat } from '../index.svelte'
import type { TaskPreset } from './taskPreset'

/** One finished turn of a Utility conversation, as the request carries it. */
export interface UtilityPromptTurn {
    role: 'user' | 'assistant'
    content: string
}

/**
 * The messages of a Utility request: the preset's instructions as the system message, then the turns in order. The
 * text is literal; nothing is expanded, replaced or added from a character, persona, lorebook or the chat. A blank
 * instruction leaves out the system message rather than sending an empty one.
 */
export function assembleUtilityPrompt(preset: Pick<TaskPreset, 'instructions'>, turns: readonly UtilityPromptTurn[]): OpenAIChat[] {
    const messages: OpenAIChat[] = []
    if (preset.instructions.trim() !== '') {
        messages.push({ role: 'system', content: preset.instructions })
    }
    for (const turn of turns) {
        messages.push({ role: turn.role, content: turn.content })
    }
    return messages
}
