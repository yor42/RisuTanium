/**
 * A cheap preview source for a clamped character note.
 *
 * `previewCut(text)` returns an offset `c` such that rendering `text.slice(0, c)`
 * gives the same leading HTML as rendering the whole note (I1):
 * `stripMedia(ParseMarkdown(text))` starts with
 * `stripMedia(ParseMarkdown(text.slice(0, c))).trimEnd()`. A clamped row then
 * parses a short prefix instead of a long note. `null` means "no provably safe
 * cut": the caller parses the whole note, exactly as before.
 *
 * Why the rules are enough. A note is only cut when it holds nothing that a
 * whole-text pass of `ParseMarkdown`, or a construct that spans blank lines,
 * could act on:
 * - `<` followed by a letter, `!`, `?` or `/` (raw HTML, comments, autolinks,
 *   `<Thoughts>` and tool tags, `<style>`): the HTML-aware passes and the HTML
 *   block rules of markdown-it are then inert, and every HTML block, which can
 *   span blank lines, is excluded.
 * - `$$` (math is replaced over the whole text), `{{inlay` (inlay assets are
 *   replaced over the whole text), `]:` (a reference definition can sit after
 *   the cut and change how an earlier link renders).
 * - U+E9B0 to U+E9C1: the parser's private placeholder characters. A note that
 *   already holds one could be unescaped into markup.
 * - `&#`: a numeric character reference decodes into such a placeholder before
 *   the placeholders are turned into markup.
 * - a lone CR: markdown-it treats it as a line break, the line walk below does
 *   not.
 * - a run of three backticks or three tildes anywhere: a fence, including one
 *   nested in a blockquote or a list item, can span blank lines and feeds the
 *   syntax-highlight pass over the whole text. Any such run rejects the note, so
 *   no fence has to be tracked.
 *
 * What remains is processed line by line or character by character, and every
 * markdown-it block ends with a newline. The only block that spans a blank line
 * is then a list item. A cut is the first blank line (markdown-it's definition:
 * spaces and tabs only, so U+3000 and NBSP lines are text) at or after
 * `minChars` whose next non-blank line starts in column 0 and does not begin a
 * list marker: that line closes any open list, blockquote, table or paragraph,
 * so nothing after the cut can change the blocks before it.
 */

export const PREVIEW_MIN_CHARS = 1000

const UNSAFE = /<[A-Za-z!?/]|\$\$|\{\{inlay|\]:|[\uE9B0-\uE9C1]|\r(?!\n)|`{3}|~{3}|&#/
const BLANK_LINE = /^[ \t]*\r?$/
const INDENTED_LINE = /^\s/
const LIST_MARKER = /^([-+*]|\d{1,9}[.)])(\s|$)/

export function previewCut(text: string, minChars: number = PREVIEW_MIN_CHARS): number | null {
    if (text.length <= minChars || UNSAFE.test(text)) {
        return null
    }
    const lines = text.split('\n')
    let start = 0
    for (let i = 0; i < lines.length; i++) {
        const offset = start
        start += lines[i].length + 1
        if (offset < minChars || !BLANK_LINE.test(lines[i])) {
            continue
        }
        let next = i + 1
        while (next < lines.length && BLANK_LINE.test(lines[next])) {
            next++
        }
        if (next >= lines.length) {
            return null
        }
        if (INDENTED_LINE.test(lines[next]) || LIST_MARKER.test(lines[next])) {
            continue
        }
        return offset
    }
    return null
}
