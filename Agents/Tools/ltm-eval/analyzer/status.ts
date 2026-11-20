// Error indexing and the numbers-only status file. No error message, name or stack from application code is
// stored, rethrown or written: only indices into the fixed lists below are.
import fs from 'node:fs'
import path from 'node:path'
import { checkShape } from './allowList'
import type { SealResult } from './seal'
import type { Shape } from './schema'

export const STEP_NAMES = ['index', 'scan', 'readDatabase', 'decode', 'resolve', 'aggregate', 'stream'] as const
export const STEP = { index: 0, scan: 1, readDatabase: 2, decode: 3, resolve: 4, aggregate: 5, stream: 6 } as const

/** The application's `BinStreamDeclineReason` values, in a fixed order, then `other`. Only the index is ever written. */
export const DECLINE_REASONS = [
    'format', 'not-gzip', 'ext', 'root-shape', 'characters', 'trailing', 'second-member', 'isize', 'inflate', 'decode',
    'blocks', 'other',
] as const
const DECLINE_OTHER = DECLINE_REASONS.length - 1

/** The index of a decline reason in DECLINE_REASONS; a reason that is not listed is `other`. */
export function declineIndexOf(reason: unknown): number {
    const index = typeof reason === 'string' ? (DECLINE_REASONS as readonly string[]).indexOf(reason) : -1
    return index >= 0 && index < DECLINE_OTHER ? index : DECLINE_OTHER
}
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
        // A nested step keeps the inner step and class: the failure is attributed to where it began.
        if (error instanceof StepError) throw error
        throw new StepError(step, classIndexOf(error))
    }
}

/** Version of the status file only; the aggregates file keeps SCHEMA_VERSION. */
export const STATUS_SCHEMA_VERSION = 2

export const STATUS_SHAPE: Shape = {
    schemaVersion: 'n',
    started: 'n',
    phase: 'i',
    streamed: 'i',
    declineReason: 'i',
    peakHeapMiB: 'n',
    maxRssMiB: 'n',
    heapLimitMiB: 'n',
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
    /** 1 once the run passed its guards and began; the file then exists for every later crash. */
    started: number
    /** The last STEP index reached (-1 before the walk). A lower bound on how far the run got. */
    phase: number
    /** -1 not decided yet, 0 whole-tree path, 1 streamed path. */
    streamed: number
    /** Index into DECLINE_REASONS when the stream declined, else -1. */
    declineReason: number
    /** Peak sampled used heap, a lower bound between samples. */
    peakHeapMiB: number
    maxRssMiB: number
    heapLimitMiB: number
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

/** What a run knows about itself between the guards and the end: numbers only. */
export type RunProgress = {
    phase: number
    streamed: number
    declineReason: number
    peakHeapMiB: number
    maxRssMiB: number
    heapLimitMiB: number
}

export const IDLE_PROGRESS: RunProgress = { phase: -1, streamed: -1, declineReason: -1, peakHeapMiB: 0, maxRssMiB: 0, heapLimitMiB: 0 }

/** The status of a sealed run. `degraded` is 1 when a cold unit was unreadable or a block was left out. */
export function statusOf(
    result: SealResult<{ incompleteUnits: number; omittedBlocks: number }>, progress: RunProgress = IDLE_PROGRESS,
): RunStatus {
    const incompleteUnits = result.ok ? result.value.incompleteUnits : 0
    const omittedBlocks = result.ok ? result.value.omittedBlocks : 0
    return {
        schemaVersion: STATUS_SCHEMA_VERSION,
        started: 1,
        phase: progress.phase,
        streamed: progress.streamed,
        declineReason: progress.declineReason,
        peakHeapMiB: progress.peakHeapMiB,
        maxRssMiB: progress.maxRssMiB,
        heapLimitMiB: progress.heapLimitMiB,
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

/** The status written before and during the analysis: started, not completed, failure unknown. */
export function startedStatus(progress: RunProgress): RunStatus {
    return {
        schemaVersion: STATUS_SCHEMA_VERSION,
        started: 1,
        phase: progress.phase,
        streamed: progress.streamed,
        declineReason: progress.declineReason,
        peakHeapMiB: progress.peakHeapMiB,
        maxRssMiB: progress.maxRssMiB,
        heapLimitMiB: progress.heapLimitMiB,
        completed: 0,
        failedStep: -1,
        errorClass: -1,
        consoleCalls: 0,
        streamWrites: 0,
        warningCalls: 0,
        incompleteUnits: 0,
        omittedBlocks: 0,
        degraded: 0,
    }
}

/** Writes `ltm-status.json` only when it conforms to STATUS_SHAPE. */
export function writeStatus(outDir: string, status: RunStatus): void {
    const violations = checkShape(status, STATUS_SHAPE)
    if (violations.length > 0) throw new Error('ltm-eval: status refused, ' + violations.length + ' allow-list violations')
    fs.mkdirSync(outDir, { recursive: true })
    fs.writeFileSync(path.join(outDir, 'ltm-status.json'), JSON.stringify(status, null, 1))
}
