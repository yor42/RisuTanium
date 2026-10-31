/**
 * The answer format of the cancellable select and input prompts. This module has no imports so the Back
 * table can name the cancel answer without pulling the prompt module into the main bundle.
 *
 * A confirming answer is `{"value":<index or text>}`; a cancel is the constant `PATTERN_PROMPT_CANCEL`.
 * Decoding is total: anything that is not a well-formed answer of the right kind decodes to `null`, so a
 * stray `none` message can never read as a choice.
 */
export const PATTERN_PROMPT_CANCEL = '{"cancel":true}'

export function encodeChoice(index: number): string {
    return JSON.stringify({ value: index })
}

export function encodeText(text: string): string {
    return JSON.stringify({ value: text })
}

function decodeValue(msg: string): string | number | null {
    let parsed: unknown
    try {
        parsed = JSON.parse(msg)
    } catch {
        return null
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed) || 'cancel' in parsed || !('value' in parsed)) {
        return null
    }
    const value = parsed.value
    return typeof value === 'string' || typeof value === 'number' ? value : null
}

/** The chosen index, or `null` for a cancel, a malformed message, a text answer or an index outside `0..count-1`. */
export function decodeChoice(msg: string, count: number): number | null {
    const value = decodeValue(msg)
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value >= count) {
        return null
    }
    return value
}

/** The entered text, or `null` for a cancel, a malformed message or a choice answer. */
export function decodeText(msg: string): string | null {
    const value = decodeValue(msg)
    return typeof value === 'string' ? value : null
}
