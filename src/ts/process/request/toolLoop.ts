import { language } from 'src/lang'
import { fillLang } from 'src/lang/fill'
import type { RPCToolCallContent } from '../mcp/mcplib'
import type { RequestDataArgumentExtended, requestDataResponse } from './request'

/** The most tool rounds one user turn may spend, across every loop, retry, fallback and nested call. */
export const TOOL_LOOP_MAX_ROUNDS = 25

/**
 * The tool-loop state of one user turn: shared, never cloned, by every round, retry, fallback and nested
 * internal:aiaccess call of that turn. `capped` stays set once the budget is spent.
 */
export type ToolLoopState = {
    rounds: number
    capped: boolean
    readonly signal: AbortSignal | null
}

export type ToolLoopArg = Pick<RequestDataArgumentExtended, 'abortSignal' | 'toolLoop'>

export function newToolLoop(signal: AbortSignal | null | undefined): ToolLoopState {
    return {
        rounds: 0,
        capped: false,
        signal: signal ?? null
    }
}

/** Whether the run's caller has stopped it. A run without a signal is never aborted. */
export function runAborted(arg: Pick<RequestDataArgumentExtended, 'abortSignal'>): boolean {
    return arg.abortSignal?.aborted === true
}

/** The result of a run that noticed its Stop; the same silent result `requestChatData` returns for one. */
export function abortedResult(): requestDataResponse {
    return {
        type: 'fail',
        result: 'Aborted',
        endsTurn: true
    }
}

function toolLoopLimitText(): string {
    return fillLang(language.errors.toolLoopLimit, { rounds: TOOL_LOOP_MAX_ROUNDS })
}

/** The failure of a turn whose tool budget is spent: no retry, no fallback model, and the error names the cap. */
export function capResult(): requestDataResponse {
    return {
        type: 'fail',
        result: toolLoopLimitText(),
        noRetry: true,
        endsTurn: true
    }
}

/** The error a streaming loop ends its stream with when the tool budget is spent. */
export function capError(): Error {
    return new Error(toolLoopLimitText())
}

export type ToolLoopGate = 'go' | 'aborted' | 'cap'

/**
 * Called once per response that carries tool calls, before any of them is dispatched. It charges one round
 * of the turn's budget; a request that merely retries never reaches it.
 */
export function beginToolRound(arg: ToolLoopArg): ToolLoopGate {
    arg.toolLoop ??= newToolLoop(arg.abortSignal ?? null)
    const state = arg.toolLoop
    if(runAborted(arg) || state.signal?.aborted === true){
        return 'aborted'
    }
    if(state.capped || state.rounds >= TOOL_LOOP_MAX_ROUNDS){
        state.capped = true
        return 'cap'
    }
    state.rounds++
    return 'go'
}

/** Whether a dispatch or a request may still start in the current round. It charges nothing. */
export function toolBlockGate(arg: ToolLoopArg): ToolLoopGate {
    if(runAborted(arg) || arg.toolLoop?.signal?.aborted === true){
        return 'aborted'
    }
    if(arg.toolLoop?.capped === true){
        return 'cap'
    }
    return 'go'
}

/** The non-streaming result for a gate that is not 'go'. */
export function gateResult(gate: Exclude<ToolLoopGate, 'go'>): requestDataResponse {
    return gate === 'cap' ? capResult() : abortedResult()
}

/** Ends a streaming loop for a gate that is not 'go': the cap errors the stream, a Stop closes it silently. */
export function endStreamForGate(controller: ReadableStreamDefaultController<unknown>, gate: Exclude<ToolLoopGate, 'go'>): void {
    if(gate === 'cap'){
        controller.error(capError())
    }
    else{
        controller.close()
    }
}

/**
 * What a tool loop answers a call to a tool that the request did not advertise. The call is never routed, so no
 * client is looked up or started for it, and the answer keeps the model's tool call paired with a result.
 */
export function refusedToolContent(name: string): RPCToolCallContent[] {
    return [{
        type: 'text',
        text: `Tool ${name} is not available.`
    }]
}
