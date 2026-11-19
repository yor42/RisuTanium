/**
 * What the token chip of a long-text field shows for one count. An exact count and an estimate never share a
 * label: only the tokenizer the app itself would run reports an exact count, every other outcome is labelled an
 * estimate with its reason. The note says what was counted: the text as written (a raw count) or the text after the
 * preview filled it in (a filled count). Only an exact count of filled text can be marked as varying, because only
 * filled text can change between runs.
 */
import type { TokenResult } from './tokenCount'

export type TokenChipCopy = {
    tokens(n: string, model: string): string
    tokensEst(n: string): string
    tokensVaries(n: string, model: string): string
    estOnline(model: string): string
    estUnavailable(model: string): string
    estError(model: string): string
    noteRaw: string
    noteFilled: string
}

export type TokenChipView = { text: string; reason: string | null; note: string; estimate: boolean }

/** What was counted: `filled` for the preview's output, `varies` when that output differs from run to run. */
export type FilledCount = { filled: boolean; varies: boolean }

const RAW_COUNT: FilledCount = { filled: false, varies: false }

export function tokenChipView(result: TokenResult, copy: TokenChipCopy, counted: FilledCount = RAW_COUNT): TokenChipView {
    const n = String(result.count)
    const note = counted.filled ? copy.noteFilled : copy.noteRaw
    if (result.kind === 'app-count') {
        const text = counted.filled && counted.varies ? copy.tokensVaries(n, result.model) : copy.tokens(n, result.model)
        return { text, reason: null, note, estimate: false }
    }
    const reason = result.reason === 'online-only' ? copy.estOnline(result.model)
        : result.reason === 'unavailable' ? copy.estUnavailable(result.model)
            : copy.estError(result.model)
    return { text: copy.tokensEst(n), reason, note, estimate: true }
}
