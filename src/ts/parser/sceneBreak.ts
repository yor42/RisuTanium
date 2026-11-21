import type MarkdownIt from 'markdown-it'
import type { StateBlock } from 'markdown-it'

// A line of three or more tildes and nothing else, tested after the block's indentation is removed.
export const SCENE_BREAK_LINE = /^~{3,}[ \t]*$/

// A lone tilde line is a scene divider when the next line is blank or the text ends; text on the next line makes
// it a fence opener, which the fence rule handles. The end of an enclosing container does not count as the end of
// the text, so a fence inside a list item keeps its fence meaning.
function sceneBreak(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
    if (state.sCount[startLine] - state.blkIndent >= 4) return false
    const start = state.bMarks[startLine] + state.tShift[startLine]
    const line = state.src.slice(start, state.eMarks[startLine])
    if (!SCENE_BREAK_LINE.test(line)) return false
    if (startLine + 1 < endLine && !state.isEmpty(startLine + 1)) return false
    if (silent) return true
    state.line = startLine + 1
    const token = state.push('hr', 'hr', 0)
    token.attrSet('data-risu-scene-break', '')
    token.markup = line.trimEnd()
    token.map = [startLine, startLine + 1]
    return true
}

export function sceneBreakPlugin(md: MarkdownIt): void {
    md.block.ruler.before('fence', 'scene_break', sceneBreak, { alt: ['paragraph', 'reference', 'blockquote', 'list'] })
}
