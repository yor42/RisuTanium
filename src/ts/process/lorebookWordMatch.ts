/**
 * Word characters for full-word lorebook matching: letters of every script,
 * numbers, combining marks and `_`. Script letters (Korean, Chinese, Japanese)
 * are word characters, so a key never matches inside a longer run of them.
 * The expression has no `g` or `y` flag, so `test` keeps no state between calls.
 */
export const UNICODE_WORD = /[\p{L}\p{N}\p{M}_]/u

/**
 * SillyTavern-style word characters: only English letters, digits and `_`.
 * Every other character, including every non-English letter, is a boundary.
 * No `g` or `y` flag, for the same reason as `UNICODE_WORD`.
 */
export const ASCII_WORD = /[A-Za-z0-9_]/

/**
 * Whether `key` occurs in `text` as a whole word or phrase: the code point
 * before the occurrence and the one after it are each a text edge or a
 * non-word character. A key with internal spaces is a literal phrase, so its
 * spaces must match exactly; it is never split into tokens.
 *
 * Every occurrence is tried: after a rejected hit the search resumes one
 * UTF-16 unit later, so an overlapping occurrence (`a-a` in `xa-a-a`) is
 * still found. No RegExp is built from the key, so key text is never
 * interpreted as a pattern.
 */
export function fullWordIncludes(text: string, key: string, wordChar: RegExp): boolean {
    // An empty key would never advance the search below, and it never matches (maintainer rule).
    if (key.length === 0) {
        return false
    }
    let at = text.indexOf(key)
    while (at !== -1) {
        const end = at + key.length
        if (!isWordBefore(text, at, wordChar) && !isWordAt(text, end, wordChar)) {
            return true
        }
        at = text.indexOf(key, at + 1)
    }
    return false
}

/**
 * The part of `Intl.Segmenter` the word-start rule needs, so a test can inject
 * a fake and the rule does not rest on one runtime's dictionary data.
 */
export interface WordBoundaries {
    segment(text: string): { containing(index: number): { index: number } | undefined }
}

/**
 * A Japanese word segmenter, or `null` where `Intl.Segmenter` is missing or
 * cannot be built; the caller then applies the Hangul rule to Han and Kana keys.
 * The locale is fixed, so the UI language does not change which keys match.
 */
export function defaultWordBoundaries(): WordBoundaries | null {
    if (typeof Intl === 'undefined' || typeof Intl.Segmenter !== 'function') {
        return null
    }
    try {
        return new Intl.Segmenter('ja', { granularity: 'word' })
    } catch {
        return null
    }
}

const CJK_KEY_START = /^[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u
const HANGUL_KEY_START = /^\p{Script=Hangul}/u

interface ScannedText {
    /** The text without U+0020, which is what keys are searched in. */
    stripped: string
    /** For each index of `stripped`, its index in the original text; `null` when the text has no space. */
    original: Int32Array | null
    segments?: ReturnType<WordBoundaries['segment']>
}

/**
 * Builds the word-start key matcher for one lorebook scan. A key whose first
 * code point is Hangul, Han, Hiragana or Katakana matches only where one of its
 * occurrences begins at a word start; anything may follow it. Any other key is
 * the plain substring test.
 *
 * Spaces are ignored in both text and key, as in the plain partial-word test,
 * but the boundary is judged in the original text, so a space before the
 * occurrence is a boundary. A word start is the text edge or a code point
 * before it that is not a word character. For a Hangul key that is the whole
 * rule. For a Han or Kana key a word character before it still counts when the
 * segmenter reports a word boundary at the occurrence; without a segmenter
 * such a key follows the Hangul rule. Every occurrence is tried.
 *
 * Per key hit, the result implies the plain substring test, so the rule only
 * removes hits. An entry can still gain an activation, because a removed
 * exclude-key hit no longer suppresses it.
 *
 * `boundaries` is called at most once, and only when a Han or Kana occurrence
 * follows a word character. Each distinct text is stripped and segmented at
 * most once for the life of the returned matcher, so create one per scan.
 */
export function createWordStartIncludes(boundaries: () => WordBoundaries | null): (text: string, key: string) => boolean {
    let resolved = false
    let segmenter: WordBoundaries | null = null
    const texts = new Map<string, ScannedText>()

    const scanned = (text: string): ScannedText => {
        let found = texts.get(text)
        if (!found) {
            let stripped = text
            let original: Int32Array | null = null
            if (text.includes(' ')) {
                const kept: number[] = []
                for (let i = 0; i < text.length; i++) {
                    if (text.charCodeAt(i) !== 0x20) {
                        kept.push(i)
                    }
                }
                original = Int32Array.from(kept)
                stripped = text.replace(/ /g, '')
            }
            found = { stripped, original }
            texts.set(text, found)
        }
        return found
    }

    const startsWord = (text: string, found: ScannedText, index: number, hangul: boolean): boolean => {
        if (!isWordBefore(text, index, UNICODE_WORD)) {
            return true
        }
        if (hangul) {
            return false
        }
        if (!resolved) {
            resolved = true
            segmenter = boundaries()
        }
        if (!segmenter) {
            return false
        }
        found.segments ??= segmenter.segment(text)
        return found.segments.containing(index)?.index === index
    }

    return (text, key) => {
        const found = scanned(text)
        const strippedKey = key.replace(/ /g, '')
        if (!CJK_KEY_START.test(strippedKey)) {
            return found.stripped.includes(strippedKey)
        }
        const hangul = HANGUL_KEY_START.test(strippedKey)
        let at = found.stripped.indexOf(strippedKey)
        while (at !== -1) {
            if (startsWord(text, found, found.original ? found.original[at] : at, hangul)) {
                return true
            }
            at = found.stripped.indexOf(strippedKey, at + 1)
        }
        return false
    }
}

/** The whole code point that ends at `index`, so an astral letter is not read as a lone low surrogate. */
function isWordBefore(text: string, index: number, wordChar: RegExp): boolean {
    if (index <= 0) {
        return false
    }
    let start = index - 1
    const unit = text.charCodeAt(start)
    if (unit >= 0xDC00 && unit <= 0xDFFF && start > 0) {
        const lead = text.charCodeAt(start - 1)
        if (lead >= 0xD800 && lead <= 0xDBFF) {
            start--
        }
    }
    return wordChar.test(text.slice(start, index))
}

function isWordAt(text: string, index: number, wordChar: RegExp): boolean {
    if (index >= text.length) {
        return false
    }
    return wordChar.test(String.fromCodePoint(text.codePointAt(index) as number))
}
