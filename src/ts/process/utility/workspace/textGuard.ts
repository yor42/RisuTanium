import { isWellFormedUtf16 } from '../../../storage/store/keyRules'

/** Why text was refused as a workspace file body. */
export type TextGuardRefusal = 'binary' | 'nul' | 'malformed-text'

export type TextGuardResult = { ok: true } | { ok: false, reason: TextGuardRefusal }
export type DecodeResult = { ok: true, text: string } | { ok: false, reason: TextGuardRefusal }

const encoder = new TextEncoder()

/** The UTF-8 byte length of `text`, which is what every cap counts. */
export function utf8ByteLength(text: string): number {
    return encoder.encode(text).length
}

/**
 * Text already in memory: a NUL marks binary content, and a lone surrogate cannot be stored as UTF-8 without changing it.
 * Workspace files are text only; nothing else is accepted.
 */
export function checkWorkspaceText(text: string): TextGuardResult {
    if (typeof text !== 'string' || !isWellFormedUtf16(text)) {
        return { ok: false, reason: 'malformed-text' }
    }
    if (text.includes('\u0000')) {
        return { ok: false, reason: 'nul' }
    }
    return { ok: true }
}

/** Raw bytes: strict UTF-8 (a leading byte order mark is dropped) with no NUL; anything else is binary. */
export function decodeWorkspaceBytes(bytes: Uint8Array): DecodeResult {
    let text: string
    try {
        // The decoder drops one leading byte order mark itself.
        text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
        return { ok: false, reason: 'binary' }
    }
    if (text.includes('\u0000')) {
        return { ok: false, reason: 'binary' }
    }
    return { ok: true, text }
}
