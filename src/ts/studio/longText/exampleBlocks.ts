/**
 * Splits a character's example-dialogue text into an opening and `<START>`
 * blocks, and joins them back. Every byte of the input belongs to exactly one
 * part, so an unedited split joins back to the identical text.
 */

/** A marker line (terminator included) and every line up to the next marker line. */
export type ExampleBlock = { marker: string; body: string }
/** `opening` holds the lines before the first marker line. */
export type ExampleText = { opening: string; blocks: ExampleBlock[] }

type Eol = '\n' | '\r\n'

/**
 * The marker rule of `exampleMessage`: the trimmed, lower-cased line equals
 * `<start>`. `line` is a line without its `\n`; a trailing `\r` is trimmed away.
 */
export function isExampleMarkerLine(line: string): boolean {
    return line.trim().toLocaleLowerCase() === '<start>'
}

export function splitExampleText(text: string): ExampleText {
    const lines = text.split('\n')
    const last = lines.length - 1
    let opening = ''
    const blocks: ExampleBlock[] = []
    for (let i = 0; i <= last; i++) {
        const owned = i < last ? lines[i] + '\n' : lines[i]
        if (isExampleMarkerLine(lines[i])) {
            blocks.push({ marker: owned, body: '' })
        } else if (blocks.length === 0) {
            opening += owned
        } else {
            blocks[blocks.length - 1].body += owned
        }
    }
    return { opening, blocks }
}

/**
 * Concatenates the parts in order. Before a non-empty part, a non-empty output
 * that does not end in a line feed receives one `eol`, so two parts never fuse
 * into one line. An unedited split result never triggers this: only the part
 * holding the text's last line can lack a final `\n`, and every part after it
 * is empty.
 */
export function joinExampleText(t: ExampleText, eol: Eol): string {
    let out = ''
    const emit = (part: string) => {
        if (part === '') {
            return
        }
        if (out !== '' && !out.endsWith('\n')) {
            out += eol
        }
        out += part
    }
    emit(t.opening)
    for (const block of t.blocks) {
        emit(block.marker)
        emit(block.body)
    }
    return out
}

/** CRLF when it occurs more often than a lone LF; otherwise (tie, no newline) LF. */
export function detectEol(text: string): Eol {
    const crlf = text.match(/\r\n/g)?.length ?? 0
    const lf = text.match(/\n/g)?.length ?? 0
    return crlf > lf - crlf ? '\r\n' : '\n'
}

export function newExampleBlock(body: string, eol: Eol): ExampleBlock {
    return { marker: '<START>' + eol, body }
}
