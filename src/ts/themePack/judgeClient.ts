// The main-thread side of the pack judge: a session over one module worker. The worker is spawned on the first request and
// reused by every later request of the session; it posts only labelled sheet text, and `close()` terminates it. There is
// no main-thread fallback, and the fail-closed rule is whole: a spawn failure, a timeout, a worker error, a malformed job
// list, a missing, extra or malformed verdict, or an `ok: false` answer rejects the request and closes the session, and every
// later request on a closed session rejects without spawning. Intake turns every rejection into `couldNotCheck`. The
// validator is imported as types only, so it never joins the main-thread bundle.
import type { AreaSheetJudgement, FontFaceBlock, LintError, PackSheetsJudgement, ResourceSpan } from './index'
import { APPLIED_AREAS, type AppliedArea, type PackJudge } from './intake'
import { spawnJudgeWorker } from './worker/spawnJudgeWorker'

/** What the client needs of a worker: `Worker` satisfies it, and so does a test channel. */
export interface JudgeWorkerLike {
    postMessage(message: JudgeRequest): void
    terminate(): void
    addEventListener(type: 'message' | 'messageerror' | 'error', listener: (event: Event) => void): void
}
/** One sheet to judge as `area`; `label` names its verdict in the answer. */
export interface JudgeJob { label: string; area: AppliedArea; text: string }
export interface JudgeRequest { id: number; jobs: readonly JudgeJob[] }
/** One verdict per requested label. */
export type JudgeResults = Readonly<Record<string, AreaSheetJudgement>>
export interface JudgeSession {
    /** Intake's judge: one job per sheet, labelled by its area, over this session's worker. */
    readonly judge: PackJudge
    /** Judges the jobs in one request; resolves only when every label has a verdict. */
    jobs(list: readonly JudgeJob[]): Promise<JudgeResults>
    /** Terminates the worker and rejects what is in flight. Idempotent. */
    close(): void
}

export const JUDGE_TIMEOUT_MS = 60_000
/** The most jobs one request may carry; the worker handler enforces the same number. */
export const MAX_JUDGE_JOBS = 16

export class JudgeUnavailableError extends Error {}
export class JudgeTimeoutError extends Error {}
export class JudgeProtocolError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readErrors(value: unknown): LintError[] | null {
    if (!Array.isArray(value)) {
        return null
    }
    const errors: LintError[] = []
    for (const item of value) {
        if (!isRecord(item) || typeof item.selector !== 'string' || typeof item.prop !== 'string' || typeof item.why !== 'string') {
            return null
        }
        const rule = item.rule === 'contrast' || item.rule === 'readability' || item.rule === 'layout' ? item.rule : undefined
        errors.push(rule === undefined ? { selector: item.selector, prop: item.prop, why: item.why } : { selector: item.selector, prop: item.prop, why: item.why, rule })
    }
    return errors
}

/** Safe-integer offsets in order, each span inside the canonical text and starting with the token its form names. */
function readResources(value: unknown, canonical: string): ResourceSpan[] | null {
    if (!Array.isArray(value)) {
        return null
    }
    const spans: ResourceSpan[] = []
    let previousEnd = 0
    for (const item of value) {
        if (!isRecord(item)) {
            return null
        }
        const { start, end, raw, target, form } = item
        if (typeof start !== 'number' || typeof end !== 'number' || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)) {
            return null
        }
        if (typeof raw !== 'string' || typeof target !== 'string' || (form !== 'url-token' && form !== 'string')) {
            return null
        }
        if (start < previousEnd || start >= end || end > canonical.length) {
            return null
        }
        const opening = form === 'url-token' ? canonical.slice(start, start + 4).toLowerCase() === 'url(' : /^["']/.test(canonical.slice(start, start + 1))
        if (!opening) {
            return null
        }
        spans.push({ start, end, raw, target, form })
        previousEnd = end
    }
    return spans
}

function readFontFaceBlocks(value: unknown): FontFaceBlock[] | null {
    if (!Array.isArray(value)) {
        return null
    }
    const blocks: FontFaceBlock[] = []
    for (const item of value) {
        if (!isRecord(item)) {
            return null
        }
        const { start, end, text } = item
        if (typeof start !== 'number' || typeof end !== 'number' || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || typeof text !== 'string') {
            return null
        }
        blocks.push({ start, end, text })
    }
    return blocks
}

function readAreaSheet(value: unknown): AreaSheetJudgement | null {
    if (!isRecord(value) || !isRecord(value.result) || typeof value.canonical !== 'string') {
        return null
    }
    const { ok, errors, name } = value.result
    const errorList = readErrors(errors)
    if (typeof ok !== 'boolean' || errorList === null) {
        return null
    }
    const resources = readResources(value.resources, value.canonical)
    const fontFaceBlocks = readFontFaceBlocks(value.fontFaceBlocks)
    const warnings = readErrors(value.warnings)
    if (resources === null || fontFaceBlocks === null || warnings === null) {
        return null
    }
    return { result: { ok, errors: errorList, name: typeof name === 'string' ? name : '' }, canonical: value.canonical, resources, fontFaceBlocks, warnings }
}

/** Narrows a worker answer into a fresh judgement, or null when any part is out of shape. Only the applied areas are read. */
export function readJudgement(value: unknown): PackSheetsJudgement | null {
    if (!isRecord(value) || typeof value.ok !== 'boolean' || !isRecord(value.areas)) {
        return null
    }
    const areas: PackSheetsJudgement['areas'] = {}
    for (const area of APPLIED_AREAS) {
        const sheet: unknown = Object.hasOwn(value.areas, area) ? value.areas[area] : undefined
        if (sheet !== undefined) {
            const read = readAreaSheet(sheet)
            if (read === null) {
                return null
            }
            areas[area] = read
        }
    }
    return { ok: value.ok, areas }
}

let nextRequestId = 0

interface PendingRequest {
    readonly labels: ReadonlySet<string>
    readonly resolve: (results: JudgeResults) => void
    readonly reject: (error: Error) => void
    readonly timer: ReturnType<typeof setTimeout>
    readonly mark: 'risu:judge:first' | 'risu:judge:next'
    readonly startedAt: number
    readonly areas: ReadonlyMap<string, string>
}

/** User Timing entries survive a production build and CDP can read them, so the judge's cost is measurable on a device. */
function markJudgeTiming(name: string, start: number): void {
    try {
        performance.measure(name, { start, end: performance.now() })
    } catch { }
}

/**
 * The worker-side cost of each requested job, read leniently: a label that was not requested, or a value that is not
 * `{ ms: finite >= 0, cold: boolean }`, is ignored. Timing is observational and never fails a request.
 */
function readTiming(value: unknown, labels: ReadonlySet<string>): Array<{ label: string; ms: number; cold: boolean }> {
    if (!isRecord(value)) {
        return []
    }
    const read: Array<{ label: string; ms: number; cold: boolean }> = []
    for (const label of labels) {
        const item: unknown = Object.hasOwn(value, label) ? value[label] : undefined
        if (isRecord(item) && typeof item.ms === 'number' && Number.isFinite(item.ms) && item.ms >= 0 && typeof item.cold === 'boolean') {
            read.push({ label, ms: item.ms, cold: item.cold })
        }
    }
    return read
}

/**
 * One measure per answered job, `risu:judge:job:<label>`, whose duration is the worker-side cost and whose `detail` carries the cold flag.
 * The worker's clock is not the window's, so a measure ends at the answer's arrival: its placement on this timeline is approximate.
 */
function markJobTimings(timings: ReadonlyArray<{ label: string; ms: number; cold: boolean }>, areas: ReadonlyMap<string, string>): void {
    for (const { label, ms, cold } of timings) {
        try {
            performance.measure(`risu:judge:job:${label}`, { start: performance.now() - ms, duration: ms, detail: { cold, area: areas.get(label) } })
        } catch { }
    }
}

/** `risu:judge:ready`: from the spawn to the moment the worker finished loading its validator, clamped into [spawn, now]. */
function markJudgeReady(spawnedAt: number, readyAt: unknown): void {
    if (typeof readyAt !== 'number' || !Number.isFinite(readyAt)) {
        return
    }
    try {
        const now = performance.now()
        const end = Math.min(Math.max(readyAt - performance.timeOrigin, spawnedAt), now)
        performance.measure('risu:judge:ready', { start: spawnedAt, end })
    } catch { }
}

/** Null when the list is acceptable: at most 16 jobs, unique non-empty string labels, string text, an applied area. */
function jobsProblem(list: readonly JudgeJob[]): string | null {
    if (list.length > MAX_JUDGE_JOBS) {
        return `a judge request carries at most ${MAX_JUDGE_JOBS} jobs`
    }
    const labels = new Set<string>()
    for (const job of list) {
        if (!isRecord(job) || typeof job.label !== 'string' || job.label === '' || labels.has(job.label)) {
            return 'a judge job needs a unique non-empty label'
        }
        labels.add(job.label)
        if (typeof job.text !== 'string' || !(APPLIED_AREAS as readonly string[]).includes(job.area)) {
            return 'a judge job needs string text and an applied area'
        }
    }
    return null
}

/** One verdict per requested label and no other key, each read by own key and narrowed; null when anything is out of shape. */
function readResults(value: unknown, labels: ReadonlySet<string>): JudgeResults | null {
    if (!isRecord(value) || Object.keys(value).some((key) => !labels.has(key))) {
        return null
    }
    const entries: Array<[string, AreaSheetJudgement]> = []
    for (const label of labels) {
        const read = Object.hasOwn(value, label) ? readAreaSheet(value[label]) : null
        if (read === null) {
            return null
        }
        entries.push([label, read])
    }
    return Object.fromEntries(entries)
}

export function openJudgeSession(options: { spawn?: () => JudgeWorkerLike; timeoutMs?: number } = {}): JudgeSession {
    const spawn = options.spawn ?? spawnJudgeWorker
    const timeoutMs = options.timeoutMs ?? JUDGE_TIMEOUT_MS
    const pending = new Map<number, PendingRequest>()
    let worker: JudgeWorkerLike | null = null
    let spawnedAt = 0
    let posted = false
    let readyMarked = false
    let closed = false

    /** Closes the session once and rejects everything still in flight with `error`. */
    function shutdown(error: Error): void {
        if (closed) {
            return
        }
        closed = true
        worker?.terminate()
        const inFlight = [...pending.values()]
        pending.clear()
        for (const request of inFlight) {
            clearTimeout(request.timer)
            request.reject(error)
        }
    }

    function onMessage(event: Event): void {
        if (closed) {
            return
        }
        const data: unknown = (event as MessageEvent<unknown>).data
        if (!isRecord(data) || typeof data.id !== 'number') {
            return
        }
        const request = pending.get(data.id)
        if (request === undefined) {
            return
        }
        pending.delete(data.id)
        clearTimeout(request.timer)
        markJudgeTiming(request.mark, request.startedAt)
        if (data.ok !== true) {
            const error = new Error(typeof data.error === 'string' ? data.error : 'the judge failed')
            request.reject(error)
            shutdown(error)
            return
        }
        const results = readResults(data.results, request.labels)
        if (results === null) {
            const error = new JudgeProtocolError('the judge answered with a missing, extra or malformed verdict')
            request.reject(error)
            shutdown(error)
            return
        }
        // The verdict resolves first: the timing marks are observational and must never delay or block it.
        request.resolve(results)
        markJobTimings(readTiming(data.timing, request.labels), request.areas)
        if (!readyMarked) {
            readyMarked = true
            markJudgeReady(spawnedAt, data.readyAt)
        }
    }

    function jobs(list: readonly JudgeJob[]): Promise<JudgeResults> {
        if (closed) {
            return Promise.reject(new JudgeUnavailableError('the judge session is closed'))
        }
        const problem = jobsProblem(list)
        if (problem !== null) {
            const error = new JudgeProtocolError(problem)
            shutdown(error)
            return Promise.reject(error)
        }
        return new Promise<JudgeResults>((resolve, reject) => {
            if (worker === null) {
                try {
                    worker = spawn()
                } catch (error) {
                    const failure = new JudgeUnavailableError(`the judge worker could not start: ${String(error)}`)
                    shutdown(failure)
                    reject(failure)
                    return
                }
                spawnedAt = performance.now()
                worker.addEventListener('message', onMessage)
                worker.addEventListener('messageerror', () => shutdown(new JudgeProtocolError('the judge answer could not be read')))
                worker.addEventListener('error', () => shutdown(new JudgeUnavailableError('the judge worker failed')))
            }
            nextRequestId += 1
            const id = nextRequestId
            const first = !posted
            posted = true
            const timer = setTimeout(() => shutdown(new JudgeTimeoutError(`the judge gave no answer within ${timeoutMs} ms`)), timeoutMs)
            pending.set(id, {
                labels: new Set(list.map((job) => job.label)), resolve, reject, timer,
                mark: first ? 'risu:judge:first' : 'risu:judge:next', startedAt: first ? spawnedAt : performance.now(),
                areas: new Map(list.map((job) => [job.label, job.area])),
            })
            const request: JudgeRequest = { id, jobs: list.map((job) => ({ label: job.label, area: job.area, text: job.text })) }
            try {
                worker.postMessage(request)
            } catch (error) {
                shutdown(new JudgeUnavailableError(`the judge request could not be sent: ${String(error)}`))
            }
        })
    }

    const judge: PackJudge = async (sheets) => {
        const list: JudgeJob[] = []
        for (const area of APPLIED_AREAS) {
            const text = sheets[area]
            if (text !== undefined) {
                list.push({ label: area, area, text })
            }
        }
        const results = await jobs(list)
        const areas: PackSheetsJudgement['areas'] = {}
        let ok = true
        for (const job of list) {
            const verdict = results[job.label]
            areas[job.area] = verdict
            if (!verdict.result.ok) {
                ok = false
            }
        }
        return { ok, areas }
    }

    return { judge, jobs, close: () => shutdown(new JudgeUnavailableError('the judge session was closed')) }
}

/** The one-request session: each call spawns its own worker, judges once and terminates the worker. */
export function createJudgeClient(options: { spawn?: () => JudgeWorkerLike; timeoutMs?: number } = {}): PackJudge {
    return async (sheets) => {
        const session = openJudgeSession(options)
        try {
            return await session.judge(sheets)
        } finally {
            session.close()
        }
    }
}

/** Test seam: a session whose jobs run one by one through `judge`; a rejected or unanswered job rejects the whole request. */
export function judgeSessionOverForTests(judge: PackJudge): JudgeSession {
    let closed = false
    async function jobs(list: readonly JudgeJob[]): Promise<JudgeResults> {
        if (closed) {
            throw new JudgeUnavailableError('the judge session is closed')
        }
        const entries: Array<[string, AreaSheetJudgement]> = []
        for (const job of list) {
            const judged = await judge({ [job.area]: job.text })
            const verdict = judged?.areas?.[job.area]
            if (verdict === undefined) {
                throw new JudgeProtocolError('the judge gave no verdict for a job')
            }
            entries.push([job.label, verdict])
        }
        return Object.fromEntries(entries)
    }
    return { judge, jobs, close: () => { closed = true } }
}