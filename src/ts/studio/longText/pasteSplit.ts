/**
 * Splits pasted text into separate messages. Blank-line mode separates on a
 * run of two or more blank lines; dash mode separates on a line of three or
 * more dashes. Nothing separates inside a code fence (strict fences: the
 * opening line holds three or more backticks and no other backtick, the
 * closing line holds only backticks; an unclosed fence runs to the end).
 */

export type PasteSplitMode = 'blank-lines' | 'dash-lines'

type LineKind = 'text' | 'blank' | 'separator'

const OPENING_FENCE = /^`{3,}[^`]*$/
const CLOSING_FENCE = /^`{3,}$/
const DASH_LINE = /^-{3,}$/

export function splitPastedMessages(text: string, opts: { splitOn: PasteSplitMode }): string[] {
    const lines = text.split('\n')
    const starts: number[] = []
    const contents: string[] = []
    const kinds: LineKind[] = []
    let offset = 0
    let inFence = false
    for (const line of lines) {
        const content = line.endsWith('\r') ? line.slice(0, -1) : line
        starts.push(offset)
        contents.push(content)
        offset += line.length + 1
        if (!inFence && OPENING_FENCE.test(content.trimStart())) {
            inFence = true
            kinds.push('text')
        } else if (inFence) {
            if (CLOSING_FENCE.test(content.trim())) {
                inFence = false
            }
            kinds.push('text')
        } else if (content.trim() === '') {
            kinds.push('blank')
        } else if (opts.splitOn === 'dash-lines' && DASH_LINE.test(content.trim())) {
            kinds.push('separator')
        } else {
            kinds.push('text')
        }
    }

    const groups: Array<[number, number]> = []
    let groupStart = 0
    let i = 0
    while (i < lines.length) {
        if (opts.splitOn === 'dash-lines') {
            if (kinds[i] === 'separator') {
                groups.push([groupStart, i - 1])
                groupStart = i + 1
            }
            i++
        } else if (kinds[i] === 'blank') {
            let runEnd = i
            while (runEnd + 1 < lines.length && kinds[runEnd + 1] === 'blank') {
                runEnd++
            }
            if (runEnd > i) {
                groups.push([groupStart, i - 1])
                groupStart = runEnd + 1
            }
            i = runEnd + 1
        } else {
            i++
        }
    }
    groups.push([groupStart, lines.length - 1])

    const messages: string[] = []
    for (const [from, to] of groups) {
        let first = from
        let end = to
        while (first <= end && contents[first].trim() === '') {
            first++
        }
        while (end >= first && contents[end].trim() === '') {
            end--
        }
        if (first > end) {
            continue
        }
        // A message never ends in a carriage return, however many the last line carries.
        const lastContent = contents[end].replace(/\r+$/, '')
        messages.push(text.slice(starts[first], starts[end] + lastContent.length))
    }
    return messages
}
