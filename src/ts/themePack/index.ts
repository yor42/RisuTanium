// The theme-pack safety validator (UI-S6 stage 1): the reference validator of docs/design rewritten without a file system,
// plus the pack rules the maintainer decided for the app (MC-1351 bundled fonts and images only, MC-1354 the size warning).
// Nothing in the app installs or applies a pack yet; a later stage should load this module lazily and run it off the main
// thread or in slices, because a large pack takes a noticeable time to judge.
import { lintPack as lintChat, normalise, type LintError, type LintResult } from './engine'
import { extractFontFaces } from './fontFace'
import { packSizeWarning, type PackSizeVerdict } from './packSize'
import { lintHome } from './registries/home'
import { lint5b } from './registries/settings5b'
import { lintPack as lintStudio } from './registries/studio'
import { canonicalStylesheet } from './canonical'

export type { LintError, LintResult } from './engine'
export type { PackSizeVerdict } from './packSize'
export { PACK_SIZE_WARN_BYTES } from './packSize'

export type ThemeArea = 'chat' | 'settings' | 'studio' | 'home'
export const THEME_AREAS: readonly ThemeArea[] = ['chat', 'settings', 'studio', 'home']

/** The reference lint of each area: the registry its newest page set is judged with (docs/design/theme/checks/lib.mjs). */
export const AREA_LINT: Readonly<Record<ThemeArea, (css: string, name: string) => LintResult>> = {
    chat: (css, name) => lintChat(css, name),
    settings: (css, name) => lint5b(css, name),
    studio: (css, name) => lintStudio(css, name),
    home: (css, name) => lintHome(css, name),
}

/**
 * The input stream a browser actually tokenises (CSS Syntax, "preprocessing the input stream"): CR LF, CR and FF become
 * LF and NUL becomes U+FFFD. Every pass judges this text, so no character the browser rewrites can make the validator
 * read a different stylesheet (a CR after a hex escape or inside a string would otherwise hide a rule). The browser
 * applies the same preprocessing to the original, so the original can be applied as it is.
 */
export function preprocessCss(css: string): string {
    return css.replace(/\r\n|\r|\f/g, '\n').replace(/\u0000/g, '\ufffd')
}

/**
 * Judges one area's stylesheet of a pack. The preprocessed text is tokenised under the strict profile (canonical.ts),
 * which also judges every resource it names; the other passes read its canonical text, in which the reference engine's
 * patterns and the browser agree. Top-level @font-face blocks are judged on their own and the rest goes to the area's
 * reference lint unchanged.
 */
export function lintAreaPack(area: ThemeArea, source: string, name = ''): LintResult {
    const canonical = canonicalStylesheet(preprocessCss(source))
    const fonts = extractFontFaces(canonical.text, normalise)
    const engine = AREA_LINT[area](fonts.remainder, name)
    const extra: LintError[] = [...canonical.errors, ...fonts.errors]
    const seen = new Set(engine.errors.map((e) => `${e.selector}|${e.prop}|${e.why}`))
    const errors = [...engine.errors]
    for (const e of extra) {
        const key = `${e.selector}|${e.prop}|${e.why}`
        if (!seen.has(key)) { seen.add(key); errors.push(e) }
    }
    return { ok: errors.length === 0, errors, name }
}

export interface ThemePackInput {
    /** The pack's stylesheet for each area it themes. */
    files: Partial<Record<ThemeArea, string>>
    /** The uncompressed size of the whole pack: its stylesheets and every bundled asset. */
    totalBytes: number
}

export interface ThemePackVerdict {
    ok: boolean
    areas: Partial<Record<ThemeArea, LintResult>>
    size: PackSizeVerdict
}

/** Judges every area stylesheet of a pack; the size warning never changes `ok`. */
export function validateThemePack(input: ThemePackInput): ThemePackVerdict {
    const areas: Partial<Record<ThemeArea, LintResult>> = {}
    let ok = true
    for (const area of THEME_AREAS) {
        const css = input.files[area]
        if (css === undefined) continue
        const result = lintAreaPack(area, css, area)
        areas[area] = result
        if (!result.ok) ok = false
    }
    return { ok, areas, size: packSizeWarning(input.totalBytes) }
}
