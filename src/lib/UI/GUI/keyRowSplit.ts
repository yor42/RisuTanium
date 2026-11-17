/**
 * Splitting of one edited API-key row on its settled value.
 *
 * Every engine turns an inserted line break into a space in a single-line input, so whitespace
 * between two runs of non-whitespace is the only separator a key row can observe. The function is
 * pure and idempotent: a row with fewer than two runs is left byte-identical (`null`), and applying
 * it to the focused row of its own result gives `null`.
 */

export interface RowSplit {
    /** The whole row list after the split. */
    rows: string[]
    /** Index in `rows` of the run that keeps the focus. */
    focusRow: number
    /** Caret offset inside that run. */
    caret: number
}

/**
 * Splits `rows[edited]` into one row per run of non-whitespace. The run that holds the caret (the
 * last run starting at or before it; `null` means the end of the text) keeps the focus, with the
 * caret offset translated into that run.
 */
export function splitEditedRow(rows: readonly string[], edited: number, caret: number | null): RowSplit | null {
    const text = rows[edited]
    const runs: { text: string, start: number }[] = []
    for (const match of text.matchAll(/\S+/g)) {
        runs.push({ text: match[0], start: match.index })
    }
    if (runs.length < 2) {
        return null
    }
    const at = caret ?? text.length
    let keep = 0
    for (let k = 0; k < runs.length; k++) {
        if (runs[k].start <= at) {
            keep = k
        }
    }
    const kept = runs[keep]
    return {
        rows: [...rows.slice(0, edited), ...runs.map((run) => run.text), ...rows.slice(edited + 1)],
        focusRow: edited + keep,
        caret: Math.min(Math.max(at - kept.start, 0), kept.text.length),
    }
}
