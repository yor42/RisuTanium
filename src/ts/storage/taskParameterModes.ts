import type { botPreset } from './database.svelte'

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
