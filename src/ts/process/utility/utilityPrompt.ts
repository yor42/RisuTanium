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
 * instruction leaves out the system message rather than sending an empty one. Workspace instruction text, when a run
 * has a workspace, follows the preset's instructions in the same system message; it is data and nothing else is derived
 * from it.
 */
export function assembleUtilityPrompt(preset: Pick<TaskPreset, 'instructions'>, turns: readonly UtilityPromptTurn[], workspaceInstructions = ''): OpenAIChat[] {
    const messages: OpenAIChat[] = []
    const system = [preset.instructions, workspaceInstructions].filter(part => part.trim() !== '').join('\n\n')
    if (system !== '') {
        messages.push({ role: 'system', content: system })
    }
    for (const turn of turns) {
        messages.push({ role: turn.role, content: turn.content })
    }
    return messages
}
