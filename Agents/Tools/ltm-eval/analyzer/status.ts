// Error indexing and the numbers-only status file. No error message, name or stack from application code is
// stored, rethrown or written: only indices into the fixed lists below are.
import fs from 'node:fs'
import path from 'node:path'
import { checkShape } from './allowList'
import type { SealResult } from './seal'
import { SCHEMA_VERSION, type Shape } from './schema'

export const STEP_NAMES = ['index', 'scan', 'readDatabase', 'decode', 'resolve', 'aggregate'] as const
export const STEP = { index: 0, scan: 1, readDatabase: 2, decode: 3, resolve: 4, aggregate: 5 } as const
export const ERROR_CLASSES = [
    'Error', 'TypeError', 'RangeError', 'SyntaxError', 'CriticalBlockError', 'BinFileChangedError',
    'RisuSaveReadError', 'LegacyReadError', 'other', 'non-Error',
] as const
const KNOWN_CLASSES = 8
const OTHER = 8
const NON_ERROR = 9

function listedClass(candidate: unknown): number {
    if (typeof candidate !== 'string') return -1
    const index = (ERROR_CLASSES as readonly string[]).indexOf(candidate)
    return index >= 0 && index < KNOWN_CLASSES ? index : -1
}

/** The index of an error's class in ERROR_CLASSES. Names are only compared, never kept; a throwing getter gives `other`. */
export function classIndexOf(error: unknown): number {
    if (!(error instanceof Error)) return NON_ERROR
    let named = -1
    try {
        named = listedClass(error.name)
    } catch {
        return OTHER
    }
    if (named < 0) return OTHER
    if (named !== 0) return named
    // A subclass that never sets `name` still reports 'Error'; its constructor name is the class.
    let byConstructor = -1
    try {
        byConstructor = listedClass(error.constructor.name)
    } catch {
        byConstructor = -1
    }
    return byConstructor > 0 ? byConstructor : 0
}

/** The only error that leaves a step: a fixed message plus two numbers. */
export class StepError extends Error {
    constructor(readonly step: number, readonly errorClass: number) {
        super('ltm-eval: ' + STEP_NAMES[step] + ' failed (' + ERROR_CLASSES[errorClass] + ')')
    }
}

/** Runs one named step; any failure becomes a StepError carrying only the step index and the class index. */
export async function safeStep<T>(step: number, fn: () => T | Promise<T>): Promise<T> {
    try {
        return await fn()
    } catch (error) {
        throw new StepError(step, classIndexOf(error))
    }
}

export const STATUS_SHAPE: Shape = {
    schemaVersion: 'n',
    completed: 'n',
    failedStep: 'i',
    errorClass: 'i',
    consoleCalls: 'n',
    streamWrites: 'n',
    warningCalls: 'n',
    incompleteUnits: 'n',
    omittedBlocks: 'n',
    degraded: 'n',
}

export type RunStatus = {
    schemaVersion: number
    completed: number
    failedStep: number
    errorClass: number
    consoleCalls: number
    streamWrites: number
    warningCalls: number
    incompleteUnits: number
    omittedBlocks: number
    degraded: number
}

/** The status of a sealed run. `degraded` is 1 when a cold unit was unreadable or a block was left out. */
export function statusOf(result: SealResult<{ incompleteUnits: number; omittedBlocks: number }>): RunStatus {
    const incompleteUnits = result.ok ? result.value.incompleteUnits : 0
    const omittedBlocks = result.ok ? result.value.omittedBlocks : 0
    return {
        schemaVersion: SCHEMA_VERSION,
        completed: result.ok ? 1 : 0,
        failedStep: 'failedStep' in result ? result.failedStep : -1,
        errorClass: 'errorClass' in result ? result.errorClass : -1,
        consoleCalls: result.counts.console,
        streamWrites: result.counts.streams,
        warningCalls: result.counts.warnings,
        incompleteUnits,
        omittedBlocks,
        degraded: incompleteUnits > 0 || omittedBlocks > 0 ? 1 : 0,
    }
}

/** Writes `ltm-status.json` only when it conforms to STATUS_SHAPE. */
export function writeStatus(outDir: string, status: RunStatus): void {
    const violations = checkShape(status, STATUS_SHAPE)
    if (violations.length > 0) throw new Error('ltm-eval: status refused, ' + violations.length + ' allow-list violations')
    fs.mkdirSync(outDir, { recursive: true })
    fs.writeFileSync(path.join(outDir, 'ltm-status.json'), JSON.stringify(status, null, 1))
}
