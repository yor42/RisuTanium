import { language } from 'src/lang'
import { getModelInfo, LLMFormat } from '../../model/modellist'
import type { Database } from '../../storage/database.svelte'
import { getPageStorageMode } from '../../storage/pageStorageMode'
import { isDesktopTransport } from '../../storage/tauriByteTransport'
import { DBState } from '../../stores.svelte'
import { requestChatDataMain, type requestDataResponse } from '../request/request'
import type { TaskPreset } from './taskPreset'
import { assembleUtilityPrompt, type UtilityPromptTurn } from './utilityPrompt'
import { abortUtilityRun, startUtilityRun, type UtilityRun } from './utilityRuns.svelte'

/**
 * The single in-memory Utility conversation. It is lost on reload and is never written to the database. A send builds
 * its request from the preset and the turns alone and calls `requestChatDataMain` with a pinned model, so no chat,
 * character, persona, lorebook, trigger, plugin hook or tool can reach the body.
 */

export type UtilityTurnState = 'streaming' | 'done' | 'stopped' | 'failed'

export interface UtilityTurn {
    role: 'user' | 'assistant'
    content: string
    /** Only an assistant turn has a state. */
    state?: UtilityTurnState
    /** The failure text of a failed assistant turn. */
    error?: string
}

export interface UtilityConversationState {
    turns: UtilityTurn[]
    /** The id of the live run, or null. */
    runId: string | null
    /** The name of the preset the last send found, for the message when it is gone. */
    presetName: string | null
}

const CONVERSATION_ID = 'utility'

export const utilityConversation: UtilityConversationState = $state({
    turns: [],
    runId: null,
    presetName: null,
})

/** The formats a per-request temperature and the schema switch are honoured for. */
const ALLOWED_FORMATS: readonly number[] = [
    LLMFormat.OpenAICompatible,
    LLMFormat.Anthropic,
    LLMFormat.GoogleCloud,
    LLMFormat.VertexAIGemini,
]

/**
 * Whether this page may use Utility: the desktop app, on a page whose profile is a writable store2 tree. Android,
 * hosted web, Node and read-only pages are all refused, because a task preset is saved only by store2.
 */
export function utilityAvailable(): boolean {
    return isDesktopTransport() && getPageStorageMode().kind === 'store2'
}

/**
 * The reason `preset` cannot be sent, or null. The format is judged as the request will judge it: a reverse proxy
 * takes its format from the database setting, not from the model entry.
 */
export function utilityRefusal(preset: Pick<TaskPreset, 'model'>, db: Pick<Database, 'customAPIFormat' | 'useInstructPrompt'>): string | null {
    if (preset.model === '') {
        return language.utility.refusalNoModel
    }
    const info = getModelInfo(preset.model)
    if (preset.model.startsWith('pluginmodel:::') || info.format === LLMFormat.Plugin) {
        return language.utility.refusalPluginModel
    }
    const format = preset.model === 'reverse_proxy' ? db.customAPIFormat : info.format
    if (!ALLOWED_FORMATS.includes(format)) {
        return language.utility.refusalFormat
    }
    if (preset.model === 'openrouter' && db.useInstructPrompt) {
        return language.utility.refusalOpenRouterInstruct
    }
    return null
}

function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

function failedTurn(turn: UtilityTurn, message: string): void {
    turn.state = 'failed'
    turn.error = message
}

/** Reads the cumulative text of a streamed reply into `turn`; the first key of each chunk holds the whole text so far. */
async function readStream(stream: ReadableStream<Record<string, string>>, turn: UtilityTurn, signal: AbortSignal): Promise<void> {
    const reader = stream.getReader()
    const cancelReader = () => {
        void reader.cancel().catch(() => {})
    }
    signal.addEventListener('abort', cancelReader, { once: true })
    try {
        while (!signal.aborted) {
            let read: ReadableStreamReadResult<Record<string, string>>
            try {
                read = await reader.read()
            }
            catch (error) {
                if (signal.aborted) {
                    break
                }
                throw error
            }
            if (read.value) {
                const key = Object.keys(read.value)[0]
                turn.content = read.value[key] ?? ''
            }
            if (read.done) {
                break
            }
        }
    }
    finally {
        signal.removeEventListener('abort', cancelReader)
    }
}

/** Settles `turn` from the request's result. A stop wins over anything that arrives after it. */
async function settleTurn(result: requestDataResponse, turn: UtilityTurn, signal: AbortSignal): Promise<void> {
    if (result.type === 'streaming') {
        try {
            await readStream(result.result, turn, signal)
        }
        catch (error) {
            failedTurn(turn, errorText(error))
            return
        }
        turn.state = signal.aborted ? 'stopped' : 'done'
        return
    }
    if (signal.aborted) {
        turn.state = 'stopped'
        return
    }
    if (result.type === 'success') {
        turn.content = result.result
        turn.state = 'done'
        return
    }
    // A failure, or a multi-line result that a Utility request cannot produce.
    failedTurn(turn, result.type === 'fail' ? result.result : language.utility.failureUnsupportedReply)
}

/**
 * Sends `text` to the task preset `presetId`. A refusal or a failure is shown on the assistant turn, never raised and
 * never put in the shared alert store. Resolves when the run has ended.
 */
export async function sendUtility(presetId: string, text: string): Promise<void> {
    if (utilityConversation.runId !== null) {
        return
    }
    const db = DBState.db
    const found = db.taskPresets?.find((candidate) => candidate.id === presetId)
    // Copy the fields now: a later edit or deletion of the preset does not change this send.
    const preset = found ? {
        name: found.name,
        instructions: found.instructions,
        model: found.model,
        temperature: found.temperature,
        maxTokens: found.maxTokens,
    } : null

    const prior: UtilityPromptTurn[] = utilityConversation.turns
        .filter((turn) => turn.content !== '')
        .map((turn) => ({ role: turn.role, content: turn.content }))
    utilityConversation.turns.push({ role: 'user', content: text })
    utilityConversation.turns.push({ role: 'assistant', content: '', state: 'streaming' })
    const turn = utilityConversation.turns[utilityConversation.turns.length - 1]

    if (!utilityAvailable()) {
        failedTurn(turn, language.utility.failureUnavailable)
        return
    }
    if (!preset) {
        failedTurn(turn, language.utility.failurePresetGone(utilityConversation.presetName ?? presetId))
        return
    }
    utilityConversation.presetName = preset.name
    const refusal = utilityRefusal(preset, db)
    if (refusal !== null) {
        failedTurn(turn, refusal)
        return
    }
    const run: UtilityRun | null = startUtilityRun(CONVERSATION_ID)
    if (run === null) {
        failedTurn(turn, language.utility.failureRunInProgress)
        return
    }
    utilityConversation.runId = run.id

    try {
        const result = await requestChatDataMain({
            formated: assembleUtilityPrompt(preset, [...prior, { role: 'user', content: text }]),
            bias: {},
            staticModel: preset.model,
            tools: [],
            noMultiGen: true,
            useStreaming: true,
            maxTokens: preset.maxTokens,
            temperatureOverride: preset.temperature,
            extractJson: '',
            noJsonSchema: true,
            blockPlugins: true,
        }, 'model', run.signal)
        await settleTurn(result, turn, run.signal)
    }
    catch (error) {
        if (run.signal.aborted) {
            turn.state = 'stopped'
        }
        else {
            failedTurn(turn, errorText(error))
        }
    }
    finally {
        run.end()
        if (utilityConversation.runId === run.id) {
            utilityConversation.runId = null
        }
    }
}

/** Stops the live run, keeping the text received so far. */
export function stopUtility(): void {
    if (utilityConversation.runId !== null) {
        abortUtilityRun(utilityConversation.runId)
    }
}

/**
 * Starts a new conversation. When the current one has turns, `confirmDiscard` must agree first; a live run is aborted
 * and its late text can no longer reach the new conversation. Resolves true when the conversation was cleared.
 */
export async function newUtilityConversation(confirmDiscard: () => Promise<boolean>): Promise<boolean> {
    if (utilityConversation.turns.length > 0 && !(await confirmDiscard())) {
        return false
    }
    stopUtility()
    utilityConversation.turns = []
    utilityConversation.runId = null
    utilityConversation.presetName = null
    return true
}
