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
