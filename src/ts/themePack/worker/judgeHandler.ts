// The worker side of the pack judge: turns one request message into one answer. It is the only run-time importer of the
// validator on the judge path, so the main-thread modules stay free of it. Only the applied areas' sheets are judged; any
// other key of the request is ignored and never reaches the validator.
import { judgePackSheets, type PackSheetsJudgement } from '../index'
import { APPLIED_AREAS, type AppliedArea } from '../intake'

export type JudgeResponse =
    | { id: number; ok: true; judgement: PackSheetsJudgement }
    | { id: number; ok: false; error: string }

interface JudgeInput {
    readonly id: number
    readonly sheets: Partial<Record<AppliedArea, string>>
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Narrows a request message: a safe-integer id and an object of sheets. Only the applied areas' string sheets survive. */
function readRequest(message: unknown): JudgeInput | null {
    if (!isRecord(message)) {
        return null
    }
    const { id, sheets } = message
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || !isRecord(sheets)) {
        return null
    }
    const kept: Partial<Record<AppliedArea, string>> = {}
    for (const area of APPLIED_AREAS) {
        const sheet = Object.hasOwn(sheets, area) ? sheets[area] : undefined
        if (typeof sheet === 'string') {
            kept[area] = sheet
        }
    }
    return { id, sheets: kept }
}

/** Never throws: a malformed request answers id -1, and a validator throw answers `ok: false` with its text. */
export function handleJudgeRequest(message: unknown): JudgeResponse {
    const request = readRequest(message)
    if (request === null) {
        return { id: -1, ok: false, error: 'malformed judge request' }
    }
    try {
        return { id: request.id, ok: true, judgement: judgePackSheets(request.sheets) }
    } catch (error) {
        if (import.meta.env.DEV) {
            console.error('theme pack judge failed', error)
        }
        return { id: request.id, ok: false, error: String(error) }
    }
}
