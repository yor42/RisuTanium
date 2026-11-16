/**
 * What the token chip of a long-text field shows for one count. An exact count and an estimate never share a
 * label: only the tokenizer the app itself would run reports an exact count, every other outcome is labelled an
 * estimate with its reason. The note about the text being counted as written is part of every view.
 */
import type { TokenResult } from './tokenCount'

export type TokenChipCopy = {
    tokens(n: string, model: string): string
    tokensEst(n: string): string
    estOnline(model: string): string
    estUnavailable(model: string): string
    estError(model: string): string
    noteRaw: string
}

export type TokenChipView = { text: string; reason: string | null; note: string; estimate: boolean }

export function tokenChipView(result: TokenResult, copy: TokenChipCopy): TokenChipView {
    const n = String(result.count)
    if (result.kind === 'app-count') {
        return { text: copy.tokens(n, result.model), reason: null, note: copy.noteRaw, estimate: false }
    }
    const reason = result.reason === 'online-only' ? copy.estOnline(result.model)
        : result.reason === 'unavailable' ? copy.estUnavailable(result.model)
            : copy.estError(result.model)
    return { text: copy.tokensEst(n), reason, note: copy.noteRaw, estimate: true }
}
