import type { customscript } from '../storage/database.svelte'

// A span of reply text that must render as one unit: `q` is where it starts, `e` where it ends (Infinity while it is open).
// A block boundary `b` is held when some span has `q < b < e`.
export interface SpanInterval {
    q: number
    e: number
}

// A display regex that can span paragraphs, reduced to its literal lead so an opener can be found cheaply.
// `regex` is sticky and tried at each occurrence of `lead`.
export interface SpanProbe {
    lead: string
    regex: RegExp
    ignoreCase: boolean
}

export interface SpanRules {
    probes: readonly SpanProbe[]
}

export const NO_SPANS: SpanRules = { probes: [] }

export const MAX_PROBES = 32

const cbsOpener = /^\{\{#(?:if|if_pure|when|pure|puredisplay|pure_display|code|escape|each|func)(?=[ :}]|$)/

// Block-level CBS balance: `{{#if ...}}` style openers against `{{/...}}` closers. A closer at depth 0 is ignored, so a
// stray closer holds nothing. Depth above 0 at the end of the text gives an open span.
export function cbsIntervals(text: string): SpanInterval[] {
    const intervals: SpanInterval[] = []
    let depth = 0
    let from = 0
    let opened = 0
    for (;;) {
        const at = text.indexOf('{{', from)
        if (at < 0) break
        if (text[at + 2] === '#') {
            if (cbsOpener.test(text.slice(at, at + 24))) {
                if (depth === 0) opened = at
                depth++
            }
            from = at + 1
            continue
        }
        if (text[at + 2] === '/' && text[at + 3] !== '/') {
            const close = text.indexOf('}}', at + 3)
            if (close < 0) {
                from = at + 3
                continue
            }
            if (depth > 0) {
                depth--
                if (depth === 0) intervals.push({ q: opened, e: close + 2 })
            }
            from = close + 2
            continue
        }
        // A third brace may start the real opener (`{{{#if`), so scanning resumes one character on.
        from = at + 1
    }
    if (depth > 0) intervals.push({ q: opened, e: Infinity })
    return intervals
}

// The text cut at the opener of the CBS block that is still open: `head` is what comes before it and `held` is the
// opener and everything after. Only the last interval can be open. With no open block `held` is empty, and always
// `head + held === text`.
export function splitAtOpenCbsSpan(text: string): { head: string, held: string } {
    const open = cbsIntervals(text).find((interval) => interval.e === Infinity)
    if (!open) return { head: text, held: '' }
    return { head: text.slice(0, open.q), held: text.slice(open.q) }
}

function escapeLiteral(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function findLead(text: string, probe: SpanProbe, from: number): number {
    if (!probe.ignoreCase) return text.indexOf(probe.lead, from)
    const scan = new RegExp(escapeLiteral(probe.lead), 'gi')
    scan.lastIndex = from
    return scan.exec(text)?.index ?? -1
}

// The spans of the probed display regexes: each occurrence of a lead is tried with the sticky regex against the text so
// far. A failed attempt is an open span (the closer has not arrived); a match is a closed span and scanning resumes after it.
export function probeIntervals(text: string, rules: SpanRules): SpanInterval[] {
    const intervals: SpanInterval[] = []
    for (const probe of rules.probes) {
        let from = 0
        for (;;) {
            const q = findLead(text, probe, from)
            if (q < 0) break
            probe.regex.lastIndex = q
            const match = probe.regex.exec(text)
            if (!match) {
                intervals.push({ q, e: Infinity })
                break
            }
            const e = q + match[0].length
            intervals.push({ q, e })
            from = Math.max(e, q + 1)
        }
    }
    return intervals
}

export function spanIntervals(text: string, rules: SpanRules): SpanInterval[] {
    return [...cbsIntervals(text), ...probeIntervals(text, rules)]
}

// The smallest start among the spans that are still open, or -1 when none is.
export function openSpanStart(text: string, rules: SpanRules): number {
    let cut = -1
    for (const interval of spanIntervals(text, rules)) {
        if (interval.e === Infinity && (cut < 0 || interval.q < cut)) cut = interval.q
    }
    return cut
}

// Whether any span covers the boundary strictly inside it.
export function isHeld(intervals: readonly SpanInterval[], boundary: number): boolean {
    return intervals.some((interval) => interval.q < boundary && boundary < interval.e)
}

// Flags and actions as executeScript derives them: `<...>` metadata of a flagged script becomes actions, unsupported and
// repeated flag characters are dropped, and an empty result is `u`.
export function deriveScriptFlags(script: customscript): { flags: string, actions: string[] } {
    let flag = 'g'
    if (script.ableFlag) flag = script.flag || 'g'
    const actions: string[] = []
    if (script.ableFlag && script.flag?.includes('<')) {
        flag = (script.flag ?? '').replace(/<(.+?)>/g, (_whole: string, inner: string) => {
            for (const meta of inner.split(',').map((part) => part.trim())) {
                if (!meta.startsWith('order ')) actions.push(meta)
            }
            return ''
        })
    }
    flag = flag.trim().replace(/[^dgimsuvy]/g, '')
    flag = flag.split('').filter((value, index, all) => all.indexOf(value) === index).join('')
    if (flag.length === 0) flag = 'u'
    return { flags: flag, actions }
}

// Whether the pattern can match a newline, and whether it has a top-level alternation. Escapes are read in pairs;
// inside a character class `|` is a literal.
function scanPattern(source: string, flags: string): { newline: boolean, alternation: boolean } {
    let newline = false
    let alternation = false
    let inClass = false
    for (let i = 0; i < source.length; i++) {
        const ch = source[i]
        if (ch === '\\') {
            const next = source[i + 1]
            if (next === 's' || next === 'n' || next === 'W' || next === 'D') newline = true
            i++
            continue
        }
        if (inClass) {
            if (ch === ']') inClass = false
            continue
        }
        if (ch === '[') {
            inClass = true
            if (source[i + 1] === '^') newline = true
        } else if (ch === '|') alternation = true
        else if (ch === '.' && flags.includes('s')) newline = true
    }
    return { newline, alternation }
}

// Whether the pattern has a `^` anchor outside a character class. The probe runs on a slice of the reply, so an anchor
// would be read against the slice start instead of the whole text.
function hasAnchor(source: string): boolean {
    let inClass = false
    for (let i = 0; i < source.length; i++) {
        const ch = source[i]
        if (ch === '\\') { i++; continue }
        if (inClass) {
            if (ch === ']') inClass = false
        } else if (ch === '[') inClass = true
        else if (ch === '^') return true
    }
    return false
}

const leadStops = '.*+?()[]{}|^$'

// The literal characters a pattern must begin with, or null when it has none worth probing (a lookaround, or fewer than 2).
export function leadLiteral(source: string): string | null {
    let i = 0
    if (source[i] === '^') i++
    for (;;) {
        if (source.startsWith('(?:', i)) i += 3
        else if (source.startsWith('(?<', i) && source[i + 3] !== '=' && source[i + 3] !== '!') {
            const close = source.indexOf('>', i)
            if (close < 0) return null
            i = close + 1
        } else if (source[i] === '(' && source[i + 1] === '?') return null
        else if (source[i] === '(') i++
        else break
    }
    let lead = ''
    let stop = ''
    for (; i < source.length; i++) {
        const ch = source[i]
        if (ch === '\\') {
            const next = source[i + 1]
            if (next === undefined || /[A-Za-z0-9]/.test(next)) { stop = '\\'; break }
            lead += next
            i++
            continue
        }
        if (leadStops.includes(ch)) { stop = ch; break }
        lead += ch
    }
    if (stop === '*' || stop === '?' || stop === '{') lead = lead.slice(0, -1)
    return lead.length >= 2 ? lead : null
}

// The probe of one display script, or null when the script is not a multi-paragraph display regex the hold can follow.
export function parseProbe(script: customscript): SpanProbe | null {
    if (script.type !== 'editdisplay' || script.in === '' || script.out.startsWith('@@')) return null
    const { flags, actions } = deriveScriptFlags(script)
    if (actions.includes('cbs')) return null
    let compiled: RegExp
    try { compiled = new RegExp(script.in, flags) } catch { return null }
    const scanned = scanPattern(script.in, flags)
    if (!scanned.newline || scanned.alternation || hasAnchor(script.in)) return null
    const lead = leadLiteral(script.in)
    if (lead === null) return null
    const sticky = flags.replace('g', '').replace('y', '') + 'y'
    return { lead, regex: new RegExp(compiled.source, sticky), ignoreCase: flags.includes('i') }
}

// The first MAX_PROBES eligible scripts, in the order the display pass runs them.
export function buildProbes(scripts: readonly customscript[]): SpanProbe[] {
    const probes: SpanProbe[] = []
    for (const script of scripts) {
        if (probes.length >= MAX_PROBES) break
        const probe = parseProbe(script)
        if (probe) probes.push(probe)
    }
    return probes
}
