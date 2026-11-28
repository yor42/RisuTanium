// Pure checks of a classic regex script for the Studio: whether its pattern compiles, and what one entry does to a
// sample text. Nothing here reads a store, the database or the CBS parser, and nothing is written; the flags come from
// the same helper the chat script pass and the translation pass use.
import { effectiveRegexFlag } from '../../process/effectiveRegexFlag'
import type { EffectiveRegexFlag } from '../../process/effectiveRegexFlag'

/** The fields of a script entry the checks read. */
export type RegexCheckEntry = {
    in: string
    out: string
    type: string
    flag?: string
    ableFlag?: boolean
}

export type RegexProblems = {
    /** The engine's error text for a pattern that does not compile, else null. */
    invalid: string | null
    /** An empty Find does nothing. */
    emptyFind: boolean
    /** A `cbs` entry gets its real pattern only after CBS runs, so it is not compiled here. */
    cbsFirst: boolean
}

export type RegexTrySpan = { index: number, text: string }

export type RegexTryResult =
    | { outcome: 'neverRuns' }
    | { outcome: 'emptyFind' }
    | { outcome: 'invalid', message: string }
    | { outcome: 'cbsFind' }
    | {
        outcome: 'ran'
        engine: 'main' | 'translation'
        /** Every match the entry acts on. */
        count: number
        /** The first matches only. */
        spans: RegexTrySpan[]
        /** The entry moves, injects, repeats or sets an emotion; its effect is not run. */
        directive: boolean
        /** The replaced sample before CBS; null for a directive. */
        text: string | null
    }

const MAIN_STAGES = ['editinput', 'editoutput', 'editprocess', 'editdisplay']
const MAX_SPANS = 20

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

/**
 * What the engine would say about the Find and flag text of an entry. The stage is ignored: the flag text is read the
 * same way in every stage.
 */
export function regexProblems(entry: Pick<RegexCheckEntry, 'in' | 'flag' | 'ableFlag'>): RegexProblems {
    if (entry.in === '') {
        return { invalid: null, emptyFind: true, cbsFirst: false }
    }
    try {
        const eff = effectiveRegexFlag(entry.flag, entry.ableFlag)
        const cbsFirst = eff.actions.includes('cbs')
        if (cbsFirst) return { invalid: null, emptyFind: false, cbsFirst: true }
        new RegExp(entry.in, eff.flags)
        return { invalid: null, emptyFind: false, cbsFirst: false }
    } catch (error) {
        return { invalid: messageOf(error), emptyFind: false, cbsFirst: false }
    }
}

/** The chat script pass handles these directives itself; the translation pass has only the two moves. */
function isMainDirective(out: string, actions: string[]): boolean {
    return out.startsWith('@@emo ') || out.startsWith('@@inject') ||
        out.startsWith('@@move_top') || out.startsWith('@@move_bottom') || out.startsWith('@@repeat_back') ||
        actions.includes('inject') || actions.includes('move_top') || actions.includes('move_bottom') ||
        actions.includes('repeat_back')
}

function isTranslationDirective(actions: string[]): boolean {
    return actions.includes('move_top') || actions.includes('move_bottom')
}

/**
 * The matches the entry acts on, from a fresh pattern: all of them for a global pattern, else the one match the
 * replace reads at `startAt` (a sticky pattern matches only there).
 */
function matchesOf(entry: RegexCheckEntry, eff: EffectiveRegexFlag, sample: string, startAt: number): { count: number, spans: RegexTrySpan[] } {
    const reg = new RegExp(entry.in, eff.flags)
    let found: RegExpExecArray[]
    if (eff.flags.includes('g')) {
        found = Array.from(sample.matchAll(reg))
    } else {
        reg.lastIndex = startAt
        const one = reg.exec(sample)
        found = one ? [one] : []
    }
    return {
        count: found.length,
        spans: found.slice(0, MAX_SPANS).map((m) => ({ index: m.index ?? 0, text: m[0] })),
    }
}

/** The chat script pass for one entry: test first for `@@` and action entries, directives not run. */
function tryMain(entry: RegexCheckEntry, eff: EffectiveRegexFlag, reg: RegExp, sample: string): RegexTryResult {
    let out = entry.out.replaceAll('$n', '\n').replace(/{{data}}/g, '$&')
    if (out.endsWith('>') && !eff.actions.includes('no_end_nl')) {
        out += '\n'
    }
    const directive = isMainDirective(out, eff.actions)
    const testFirst = out.startsWith('@@') || eff.actions.length > 0
    const hit = testFirst ? reg.test(sample) : true
    const afterTest = reg.lastIndex
    const none = { count: 0, spans: [] as RegexTrySpan[] }
    if (directive) {
        // A move resets the position the test advanced; the emotion and inject directives read from it.
        const readsAdvanced = out.startsWith('@@emo ') || out.startsWith('@@inject') || eff.actions.includes('inject')
        const moves = !readsAdvanced && (
            out.startsWith('@@move_top') || out.startsWith('@@move_bottom') ||
            eff.actions.includes('move_top') || eff.actions.includes('move_bottom'))
        const matches = hit ? matchesOf(entry, eff, sample, moves ? 0 : afterTest) : none
        return { outcome: 'ran', engine: 'main', ...matches, directive: true, text: null }
    }
    const matches = hit ? matchesOf(entry, eff, sample, afterTest) : none
    const text = hit ? sample.replace(reg, out) : sample
    return { outcome: 'ran', engine: 'main', ...matches, directive: false, text }
}

/** The translation pass for one entry: only `$n` is rewritten, no test first, `@@` is not read. */
function tryTranslation(entry: RegexCheckEntry, eff: EffectiveRegexFlag, reg: RegExp, sample: string): RegexTryResult {
    const matches = matchesOf(entry, eff, sample, 0)
    if (isTranslationDirective(eff.actions)) {
        return { outcome: 'ran', engine: 'translation', ...matches, directive: true, text: null }
    }
    const text = sample.replace(reg, entry.out.replaceAll('$n', '\n'))
    return { outcome: 'ran', engine: 'translation', ...matches, directive: false, text }
}

/**
 * Runs one entry on a sample the way the engine of its stage would, without CBS, other entries or any effect. A `cbs`
 * entry is not run: its pattern exists only after CBS.
 */
export function tryRegexEntry(entry: RegexCheckEntry, sample: string): RegexTryResult {
    if (entry.type !== 'edittrans' && !MAIN_STAGES.includes(entry.type)) {
        return { outcome: 'neverRuns' }
    }
    if (entry.in === '') {
        return { outcome: 'emptyFind' }
    }
    let eff: EffectiveRegexFlag
    let reg: RegExp
    try {
        eff = effectiveRegexFlag(entry.flag, entry.ableFlag)
        if (eff.actions.includes('cbs')) {
            return { outcome: 'cbsFind' }
        }
        reg = new RegExp(entry.in, eff.flags)
    } catch (error) {
        return { outcome: 'invalid', message: messageOf(error) }
    }
    return entry.type === 'edittrans' ? tryTranslation(entry, eff, reg, sample) : tryMain(entry, eff, reg, sample)
}
