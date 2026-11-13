// Literal-array `#each` simulation for the CBS problem checker: copies of the engine pieces that
// turn an `#each` block into the text it splices into the input (parser.svelte.ts, `risuChatParser`
// and its helpers). Each copy names its engine source and the invariant it keeps; the differential
// test in cbsEach.parserDiff.test.ts holds them to the real engine.
//
// Invariants:
// - A header, a block end and an expansion are exactly what the engine computes for the same text,
//   so splicing `expandEach(...)` into the input gives the engine's later structure.
// - `expansionBound` never under-estimates the length `expandEach` builds, so a caller that checks the
//   bound first never builds an oversized expansion.
// - Pure functions; this module imports nothing.

// The value domain of `JSON.parse`; the `§` list path yields strings only.
export type EachElement = string | number | boolean | null | readonly EachElement[] | { readonly [key: string]: EachElement }

// `dropped`: the header has no space at all, so the engine splices nothing.
export type EachHeader = { array: readonly EachElement[]; slotName: string; keep: boolean } | { dropped: true }

// The engine splices without any cap; the checker stops instead of building more than this.
export const EACH_MAX_ELEMENTS = 1000
export const EACH_CHAR_BUDGET = 200_000

// Engine `parseArray`: a JSON array, else the text split on `§`. (The macro registry's own
// `parseArray` returns `[]` on failure and never splits, so it is not a substitute.)
function parseArray(text: string): readonly EachElement[] {
    try{
        const parsed: EachElement = JSON.parse(text)
        if(Array.isArray(parsed)){
            return parsed
        }
        return text.split('§')
    }
    catch{
        return text.split('§')
    }
}

// Engine `blockStartMatcher` (`#each` branch) and the close of `risuChatParser`: `headText` is the
// whole head of a complete `#each` frame, starting `#each`. After the optional `::keep ` and a
// leading `as `, the array is everything before the last ` as `, else before the last space; a
// header with no space at all splices nothing.
export function parseEachHeader(headText: string): EachHeader {
    let rest = headText.substring(5).trim()
    let keep = false
    if(rest.startsWith('::keep ')){
        keep = true
        rest = rest.substring(7).trim()
    }
    if(rest.startsWith('as ')){
        rest = rest.substring(3).trim()
    }
    const asIndex = rest.lastIndexOf(' as ')
    if(asIndex !== -1){
        return { array: parseArray(rest.substring(0, asIndex)), slotName: rest.substring(asIndex + 4).trim(), keep }
    }
    const spaceIndex = rest.lastIndexOf(' ')
    if(spaceIndex === -1){
        return { dropped: true }
    }
    return { array: parseArray(rest.substring(0, spaceIndex)), slotName: rest.substring(spaceIndex + 1), keep }
}

// The loop variable of a header whose array is partly a value: `tail` is the header text after its
// last nested value. Once the tail holds ` as `, the evaluated header's last ` as ` lies in the tail
// for any non-empty leading value (an empty one lets the engine drop the block, see the checker's
// loop exemption); without it the value decides, so the name is unknown (null).
export function eachLoopVar(tailAfterLastNested: string): string | null {
    const tail = tailAfterLastNested.trimEnd()
    const at = tail.lastIndexOf(' as ')
    return at === -1 ? null : tail.substring(at + 4).trim()
}

// Engine `legacyBlockMatcher`: what a legacy `{#...#}` frame is replaced by, or null when the frame
// stays as written. `frameText` is the frame's content between `{#` and `#}`.
export function legacyFrameOutput(frameText: string): string | null {
    const lineEnd = frameText.indexOf('\n')
    if(lineEnd === -1){
        return null
    }
    const logic = frameText.substring(0, lineEnd)
    const content = frameText.substring(lineEnd + 1)
    const statement = logic.split(' ', 2)
    if(statement[0] === 'if'){
        if(['', '0', '-1'].includes(statement[1])){
            return ''
        }
        return content.trim()
    }
    return null
}

// Engine `trimLines`.
function trimLines(text: string): string {
    return text.split('\n').map((line) => line.trimStart()).join('\n').trim()
}

// Engine `blockEndMatcher` (`each` case): the text of the body that every element expands.
export function eachBodyOutput(buffer: string, keep: boolean): string {
    return keep ? buffer : trimLines(buffer.trim())
}

function slotNeedle(slotName: string): string {
    return `{{slot::${slotName}}}`
}

function elementText(element: EachElement): string {
    return typeof element === 'string' ? element : JSON.stringify(element)
}

function countOf(text: string, needle: string): number {
    let count = 0
    for(let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + needle.length)){
        count++
    }
    return count
}

function dollarCount(text: string, followers: string): number {
    let count = 0
    for(let at = text.indexOf('$'); at !== -1; at = text.indexOf('$', at + 1)){
        if(followers.includes(text[at + 1] ?? '\n')){
            count++
        }
    }
    return count
}

// An upper bound of `expandEach(header, bodyOutput).length`, computed without building anything.
// For a string pattern `replaceAll` expands `$`` and `$'` (at most the body length each) and `$&`
// (the needle); `$$` yields fewer characters than it consumes and `$n` / `$<` stay literal without
// capture groups. Per element the result is at most the body length plus, for every needle
// occurrence, the element text and those expansions.
export function expansionBound(header: EachHeader, bodyOutput: string): number {
    if('dropped' in header){
        return 0
    }
    const needle = slotNeedle(header.slotName)
    const occurrences = countOf(bodyOutput, needle)
    const length = bodyOutput.length
    let bound = 0
    for(const element of header.array){
        const text = elementText(element)
        const bodyCopies = dollarCount(text, '`\'')
        const needleCopies = dollarCount(text, '&')
        bound += length + occurrences * (text.length + bodyCopies * length + needleCopies * needle.length)
    }
    return bound
}

// Engine `risuChatParser` (`#each` close): every element replaces the slot macro with a string
// replacement, so `$` patterns apply; the result is trimmed unless `::keep`.
export function expandEach(header: EachHeader, bodyOutput: string): string {
    if('dropped' in header){
        return ''
    }
    const needle = slotNeedle(header.slotName)
    let added = ''
    for(const element of header.array){
        added += bodyOutput.replaceAll(needle, elementText(element))
    }
    return header.keep ? added : added.trim()
}
