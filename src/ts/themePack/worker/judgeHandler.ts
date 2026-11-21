// The worker side of the pack judge: turns one request message into one answer. It is the only run-time importer of the
// validator on the judge path, so the main-thread modules stay free of it. A request carries labelled jobs; only the jobs of
// applied areas are judged and answered, and a job of any other area is dropped and never reaches the validator.
import { judgeAreaSheet, type AreaSheetJudgement } from '../index'
import { APPLIED_AREAS, type AppliedArea } from '../intake'

export type JudgeResponse =
    | { id: number; ok: true; results: Record<string, AreaSheetJudgement> }
    | { id: number; ok: false; error: string }

/** The most jobs one request may carry. */
export const MAX_JUDGE_JOBS = 16

interface JudgeJobInput {
    readonly label: string
    readonly area: string
    readonly text: string
}

interface JudgeInput {
    readonly id: number
    readonly jobs: readonly JudgeJobInput[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isAppliedArea(area: string): area is AppliedArea {
    return (APPLIED_AREAS as readonly string[]).includes(area)
}

/** Narrows a request message: a safe-integer id and at most 16 jobs, each a unique non-empty label with a string area and text. */
function readRequest(message: unknown): JudgeInput | null {
    if (!isRecord(message)) {
        return null
    }
    const { id, jobs } = message
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || !Array.isArray(jobs) || jobs.length > MAX_JUDGE_JOBS) {
        return null
    }
    const read: JudgeJobInput[] = []
    const labels = new Set<string>()
    for (const job of jobs) {
        if (!isRecord(job)) {
            return null
        }
        const { label, area, text } = job
        if (typeof label !== 'string' || label === '' || labels.has(label) || typeof area !== 'string' || typeof text !== 'string') {
            return null
        }
        labels.add(label)
        read.push({ label, area, text })
    }
    return { id, jobs: read }
}

/** Never throws: a malformed request answers id -1, and a validator throw answers `ok: false` with its text. */
export function handleJudgeRequest(message: unknown): JudgeResponse {
    const request = readRequest(message)
    if (request === null) {
        return { id: -1, ok: false, error: 'malformed judge request' }
    }
    try {
        const entries: Array<[string, AreaSheetJudgement]> = []
        for (const job of request.jobs) {
            if (isAppliedArea(job.area)) {
                entries.push([job.label, judgeAreaSheet(job.area, job.text, undefined, job.area)])
            }
        }
        // `fromEntries` defines each label as an own data property, so no label can reach a prototype.
        return { id: request.id, ok: true, results: Object.fromEntries(entries) }
    } catch (error) {
        if (import.meta.env.DEV) {
            console.error('theme pack judge failed', error)
        }
        return { id: request.id, ok: false, error: String(error) }
    }
}
