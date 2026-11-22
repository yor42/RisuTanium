import { alertConfirm, alertToolApproval, type ToolApprovalActionPart } from 'src/ts/alert'
import { language } from 'src/lang'

/** What the user is asked to decide about one model-driven tool call. */
export type ToolApprovalRequest = {
    /** The tool the model called. */
    tool: string
    /** The client the call is routed to. */
    url: string
    kind: 'mutating' | 'third-party'
    /** A readable, plain-text rendering of the call and its arguments. */
    summary: string
    /**
     * Set for a workspace call, which gets the structured dialog: its action line, whether it changes instruction
     * files, the replacement text of an edit, and whether "always for this workspace" is offered.
     */
    view?: {
        action: ToolApprovalActionPart[]
        instructionTarget: boolean
        replacement: string | null
        offerAlways: boolean
        /** "Allow this server for the rest of this chat" is offered. */
        offerServer?: boolean
    }
}

export type ToolDecision = 'once' | 'always' | 'server' | 'deny'

/** The most characters of a call's summary that the prompt shows. */
export const TOOL_SUMMARY_LIMIT = 800

export type ToolApprovalOptions = {
    /** The run's Stop signal: a run that is already stopped is denied without asking. */
    signal?: AbortSignal | null
}

/**
 * Asks the user whether one tool call may run. The prompt is plain text. A run that was stopped before the
 * question is denied without showing it. `always` is returned only when the request offered it.
 */
export async function askToolApproval(request: ToolApprovalRequest, options?: ToolApprovalOptions): Promise<ToolDecision> {
    if(options?.signal?.aborted === true) {
        return 'deny'
    }
    if(request.view) {
        return await alertToolApproval({
            server: request.url,
            summary: request.summary,
            ...request.view,
        }, { signal: options?.signal ?? null })
    }
    const text = language.mcpAccessPrompt
        .replace('{{tool}}', () => request.url)
        .replace('{{action}}', () => request.summary)
    return (await alertConfirm(text, { signal: options?.signal ?? null })) ? 'once' : 'deny'
}
