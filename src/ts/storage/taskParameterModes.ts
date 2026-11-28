import type { botPreset, SeparateParameters } from './database.svelte'

/**
 * Per-task parameter modes. Each auxiliary task reads either the record's main values (`same`) or its own block in
 * `seperateParameters` (`own`). The modes live inside the `seperateParameters` container under `taskModes`, so the container
 * moves whole on every path that already moves it. `seperateParametersEnabled` stays as the derived field: on exactly when
 * some task is `own`.
 */
export const TASK_KEYS = ['memory', 'emotion', 'translate', 'otherAx'] as const
export type TaskKey = typeof TASK_KEYS[number]
export type TaskMode = 'same' | 'own'
export type TaskModes = Record<TaskKey, TaskMode>

/** The container member that holds the modes. It is never a parameter block and never reaches an upstream-shaped export. */
export const TASK_MODES_KEY = 'taskModes'

/** The fields of a database or preset these helpers read and write. */
export type TaskModeRecord = Pick<botPreset, 'seperateParametersEnabled' | 'seperateParameters'>

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function anyOwn(modes: TaskModes): boolean {
    return TASK_KEYS.some((task) => modes[task] === 'own')
}

function uniform(mode: TaskMode): TaskModes {
    return { memory: mode, emotion: mode, translate: mode, otherAx: mode }
}

/**
 * The modes a record reads as. A mode that is not `same` or `own`, or a missing or non-object key or container, reads as the
 * flag says (`own` with the flag on, `same` with it off). A flag that disagrees with the modes wins, so the flag always
 * equals "some task is own" and a flag written outside these helpers can never leave a record half-way. Nothing is written.
 */
export function effectiveTaskModes(record: TaskModeRecord): TaskModes {
    const flag = Boolean(record.seperateParametersEnabled)
    const fallback: TaskMode = flag ? 'own' : 'same'
    const container: unknown = record.seperateParameters
    const stored = isPlainObject(container) ? container[TASK_MODES_KEY] : undefined
    const raw = isPlainObject(stored) ? stored : {}
    const read = (task: TaskKey): TaskMode => {
        const value = raw[task]
        return value === 'same' || value === 'own' ? value : fallback
    }
    const result: TaskModes = { memory: read('memory'), emotion: read('emotion'), translate: read('translate'), otherAx: read('otherAx') }
    return anyOwn(result) === flag ? result : uniform(fallback)
}

/** The container the writers store the modes in; a record without a usable container gets the five empty members first. */
function containerOf(record: TaskModeRecord): NonNullable<TaskModeRecord['seperateParameters']> {
    const existing: unknown = record.seperateParameters
    if (!isPlainObject(existing)) {
        record.seperateParameters = { memory: {}, emotion: {}, translate: {}, otherAx: {}, overrides: {} }
    }
    return record.seperateParameters
}

function store(record: TaskModeRecord, next: TaskModes) {
    const container = containerOf(record)
    // One synchronous step, so the flag and the modes are never observed apart.
    container[TASK_MODES_KEY] = next
    record.seperateParametersEnabled = anyOwn(next)
}

/**
 * Sets one task's mode. All four readable values are taken from the effective view and written, so an unreadable member is
 * replaced; the flag is set to "some task is own" in the same step.
 */
export function setTaskMode(record: TaskModeRecord, task: TaskKey, mode: TaskMode): void {
    store(record, { ...effectiveTaskModes(record), [task]: mode })
}

/** Sets all four modes and the flag in one step. */
export function setAllTaskModes(record: TaskModeRecord, mode: TaskMode): void {
    store(record, uniform(mode))
}

/**
 * The record without the modes key in its container, for every writer whose output is upstream-shaped. A record whose
 * container does not hold the key is returned as the same object; otherwise the record and its container are new objects and
 * the input is never changed.
 */
export function withoutTaskModes<T extends object>(record: T): T {
    const container: unknown = typeof record === 'object' && record !== null && 'seperateParameters' in record ? record.seperateParameters : undefined
    if (!isPlainObject(container) || !Object.prototype.hasOwnProperty.call(container, TASK_MODES_KEY)) {
        return record
    }
    const { [TASK_MODES_KEY]: _modes, ...rest } = container
    return { ...record, seperateParameters: rest }
}

/**
 * The parameters a block holds that a request reads (`applyParameters`). The display-only thinking-type members of a block
 * are not among them: no request reads them, so a copy never writes them.
 */
export const BLOCK_PARAMETERS = [
    'temperature', 'top_k', 'repetition_penalty', 'min_p', 'top_a', 'top_p',
    'frequency_penalty', 'presence_penalty', 'reasoning_effort', 'thinking_tokens', 'verbosity',
] as const
export type BlockParameter = typeof BLOCK_PARAMETERS[number]

/** The main-value fields of a working database (`working`) or of a saved preset slot (`slot`); a slot names its reasoning field `reasonEffort`. */
export interface MainValueFields {
    temperature?: number
    top_k?: number
    repetition_penalty?: number
    min_p?: number
    top_a?: number
    top_p?: number
    frequencyPenalty?: number
    PresensePenalty?: number
    reasoningEffort?: number
    reasonEffort?: number
    thinkingTokens?: number
    verbosity?: number
}
export type TaskCopySource = 'working' | 'slot'

/**
 * A block holding the record's main values under the block's own names. Values are copied verbatim, `null` included, and a
 * value that is absent stays absent. A slot's constant fallbacks apply as `setPreset` loads them (`top_p` 1, reasoning 0,
 * thinking budget null, verbosity 1); a working database is read as it is. Every call returns a new object.
 */
export function mainValuesAsBlock(record: MainValueFields, source: TaskCopySource): SeparateParameters {
    const slot = source === 'slot'
    const values: Record<BlockParameter, number | null | undefined> = {
        temperature: record.temperature,
        top_k: record.top_k,
        repetition_penalty: record.repetition_penalty,
        min_p: record.min_p,
        top_a: record.top_a,
        top_p: slot ? record.top_p ?? 1 : record.top_p,
        frequency_penalty: record.frequencyPenalty,
        presence_penalty: record.PresensePenalty,
        reasoning_effort: slot ? record.reasonEffort ?? 0 : record.reasoningEffort,
        thinking_tokens: slot ? record.thinkingTokens ?? null : record.thinkingTokens,
        verbosity: slot ? record.verbosity ?? 1 : record.verbosity,
    }
    const block: SeparateParameters = {}
    for (const parameter of BLOCK_PARAMETERS) {
        const value = values[parameter]
        if (value !== undefined) {
            block[parameter] = value
        }
    }
    return block
}

/** The parameters whose value `applyParameters` divides by 100 on both paths, so `null` reads as 0 on both. */
const SCALED_PARAMETERS: readonly BlockParameter[] = ['temperature', 'frequency_penalty', 'presence_penalty']

/**
 * Whether a main value survives the move into a block: a request sends the same data from the block as from the main field.
 * Strict and data-only, judged on what `applyParameters` returns for both paths. A number other than NaN is the same on
 * both; `null` is the same only where both paths scale it; the reasoning and verbosity parameters go through one helper on
 * both paths; anything else (an absent value, NaN, a non-number) is sent by the main path and skipped by the block path.
 */
export function representable(parameter: BlockParameter, value: unknown): boolean {
    if (parameter === 'reasoning_effort' || parameter === 'verbosity') {
        return true
    }
    if (typeof value === 'number') {
        return !Number.isNaN(value)
    }
    return value === null && SCALED_PARAMETERS.includes(parameter)
}

/** What a translation cannot carry for one task: a main value upstream's block path would not send, or a stored block it replaces. */
export interface TaskParameterLeaveOut {
    task: TaskKey
    parameter: BlockParameter | 'replacedBlock'
}

function sameBlock(stored: Record<string, unknown>, copy: SeparateParameters): boolean {
    const storedKeys = Object.keys(stored)
    const copyKeys = Object.keys(copy)
    return storedKeys.length === copyKeys.length && storedKeys.every((key) => Object.hasOwn(copy, key) && Object.is(stored[key], copy[key as BlockParameter]))
}

/**
 * The record as an upstream-shaped export holds it: the modes key is removed, and with the flag on every task that reads as
 * `same` gets a new block that is a copy of the record's main values. A flag-off record, and one whose tasks all read `own`,
 * only loses the key. The flag, the other blocks and `overrides` are untouched and the input is never changed. `leftOut`
 * lists, per `same` task, each main value a request could not send from a block and each non-empty stored block the copy
 * replaces that differs from it.
 */
export function translateTaskParameters<T extends TaskModeRecord & MainValueFields>(record: T, source: TaskCopySource): { record: T, leftOut: TaskParameterLeaveOut[] } {
    if (!isPlainObject(record)) {
        return { record, leftOut: [] }
    }
    const stripped = withoutTaskModes(record)
    const container: NonNullable<TaskModeRecord['seperateParameters']> = stripped.seperateParameters
    if (!record.seperateParametersEnabled || !isPlainObject(container)) {
        return { record: stripped, leftOut: [] }
    }
    const modes = effectiveTaskModes(record)
    const same = TASK_KEYS.filter((task) => modes[task] === 'same')
    if (same.length === 0) {
        return { record: stripped, leftOut: [] }
    }
    const leftOut: TaskParameterLeaveOut[] = []
    const next = { ...container }
    for (const task of same) {
        const copy = mainValuesAsBlock(record, source)
        for (const parameter of BLOCK_PARAMETERS) {
            if (!representable(parameter, copy[parameter])) {
                leftOut.push({ task, parameter })
            }
        }
        const existing: unknown = container[task]
        if (isPlainObject(existing) && Object.keys(existing).length > 0 && !sameBlock(existing, copy)) {
            leftOut.push({ task, parameter: 'replacedBlock' })
        }
        next[task] = copy
    }
    return { record: { ...stripped, seperateParameters: next }, leftOut }
}
