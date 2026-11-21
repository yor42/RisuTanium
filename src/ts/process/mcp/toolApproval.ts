import { alertConfirm } from 'src/ts/alert'
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
}

export type ToolDecision = 'once' | 'deny'

/** The most characters of a call's summary that the prompt shows. */
export const TOOL_SUMMARY_LIMIT = 800

export type ToolApprovalOptions = {
    /** The run's Stop signal: a run that is already stopped is denied without asking. */
    signal?: AbortSignal | null
}

/**
 * Asks the user whether one tool call may run. The prompt is plain text. A run that was stopped before the
 * question is denied without showing it.
 */
export async function askToolApproval(request: ToolApprovalRequest, options?: ToolApprovalOptions): Promise<ToolDecision> {
    if(options?.signal?.aborted === true) {
        return 'deny'
    }
    const text = language.mcpAccessPrompt
        .replace('{{tool}}', () => request.url)
        .replace('{{action}}', () => request.summary)
    return (await alertConfirm(text, { signal: options?.signal ?? null })) ? 'once' : 'deny'
}
