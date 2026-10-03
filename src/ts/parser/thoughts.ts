/**
 * Walks `data` and hands the inner text of each closed, exact-case
 * `<Thoughts>...</Thoughts>` block (nesting-aware, outermost match) to `replace`,
 * substituting its return value for the whole block.
 *
 * An unclosed block is left as text and scanning resumes one character later, so a
 * closed block nested inside an unclosed outer one is still replaced. The chat
 * screen and the plain-copy path share this scan so they cannot disagree about
 * what counts as a thinking section.
 */
export function replaceThoughtsBlocks(data: string, replace: (inner: string) => string): string {
    let result = '', i = 0
    while (i < data.length) {
        if (data.slice(i, i + 10) === '<Thoughts>') {
            let j = i + 10, depth = 1
            while (j < data.length && depth > 0) {
                if (data.slice(j, j + 10) === '<Thoughts>') depth++
                if (data.slice(j, j + 11) === '</Thoughts>') depth--
                j++
            }
            if (depth === 0) {
                result += replace(data.substring(i + 10, j - 1))
                i = j + 10
                continue
            }
        }
        result += data[i++]
    }
    return result
}
