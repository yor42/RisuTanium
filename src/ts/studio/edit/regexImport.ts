// The strict reading of a regex script file the Studio import accepts: the bytes are UTF-8 JSON (a BOM is accepted, invalid
// bytes are refused), the top level is `{ type: 'regex', data: [...] }`, and every element of `data` is a readable script.
// One element that is not refuses the whole file. The accepted entries are the parsed values as read (unknown keys and stage
// values included); the list builder's completion copies them, so nothing is normalised here.
import { classifyRegexRow, isJsonSafe, type RegexReason } from './regexEntry'

export type RegexImportResult =
    | { kind: 'ok', entries: unknown[] }
    | { kind: 'notRegex' }
    | { kind: 'empty' }
    | { kind: 'bad', count: number, position: number, reasons: RegexReason[] }

const NOT_REGEX: RegexImportResult = { kind: 'notRegex' }

/** Decodes and checks a file's bytes. `position` of a bad result is the 1-based index of the first element that is not a readable script. */
export function parseRegexImport(bytes: Uint8Array): RegexImportResult {
    let text: string
    try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    }
    catch {
        return NOT_REGEX
    }
    let parsed: unknown
    try {
        parsed = JSON.parse(text)
    }
    catch {
        return NOT_REGEX
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return NOT_REGEX
    const top = parsed as Record<string, unknown>
    if (top.type !== 'regex') return NOT_REGEX
    const data = top.data
    if (!Array.isArray(data)) return NOT_REGEX
    if (data.length === 0) return { kind: 'empty' }
    if (!isJsonSafe(data)) return NOT_REGEX
    let failed = 0
    let first = -1
    let reasons: RegexReason[] = []
    for (let i = 0; i < data.length; i++) {
        const row = classifyRegexRow(data[i])
        if (row.kind === 'ok') continue
        if (failed === 0) {
            first = i
            reasons = row.kind === 'inert' ? [row.reason] : row.reasons
        }
        failed++
    }
    if (failed > 0) return { kind: 'bad', count: failed, position: first + 1, reasons }
    return { kind: 'ok', entries: data }
}
