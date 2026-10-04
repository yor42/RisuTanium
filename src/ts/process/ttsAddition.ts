import { stripThoughtsForCopy } from "../chatCopy";
import { filterTTSText } from "./tts";

function graphemeBoundaryAtOrBefore(text: string, cut: number): number {
    if (cut <= 0) return 0
    if (cut >= text.length) return text.length
    if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
        let boundary = 0
        for (const segment of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) {
            if (segment.index > cut) break
            boundary = segment.index
        }
        return boundary
    }
    // A cut between the halves of a surrogate pair moves back before the pair.
    const low = text.charCodeAt(cut)
    const high = text.charCodeAt(cut - 1)
    if (low >= 0xDC00 && low <= 0xDFFF && high >= 0xD800 && high <= 0xDBFF) {
        return cut - 1
    }
    return cut
}

/**
 * What a run adds to a reply, as the text to speak: the filtered, thought-free
 * display text of `after` with the longest common prefix it shares with the
 * same transform of `before` removed. `parse` maps stored text to display text
 * and must use the same options for both. When the earlier text changed, speech
 * starts at the first difference. The cut never splits a grapheme.
 */
export function ttsAddition(
    before: string,
    after: string,
    parse: (stored: string) => string,
    readOnlyQuoted: boolean,
): string {
    const transform = (stored: string) => filterTTSText(stripThoughtsForCopy(parse(stored)), readOnlyQuoted)
    const spokenAfter = transform(after)
    const spokenBefore = transform(before)
    let common = 0
    const limit = Math.min(spokenAfter.length, spokenBefore.length)
    while (common < limit && spokenAfter.charCodeAt(common) === spokenBefore.charCodeAt(common)) {
        common++
    }
    return spokenAfter.slice(graphemeBoundaryAtOrBefore(spokenAfter, common))
}
