/**
 * The macro (CBS function) list for the long-text editor: entries collected
 * from the registry's own registrations, and a lookup that follows the parser's
 * name-matching rule. Descriptions are the registry's English text split at
 * `Usage::`; nothing here reads a locale table.
 */
import type { CBSRegisterArg } from '../../cbs'

export type MacroEntry = {
    name: string
    aliases: readonly string[]
    summary: string
    usage: string | null
    docOnly: boolean
    internalOnly: boolean
    /** The name starts with `#` or `:`, so it is written as a block, not as a plain call. */
    blockSyntax: boolean
    deprecated: { message: string; replacement?: string } | null
}

export type RegisterLike = (arg: CBSRegisterArg) => void

type RegistrationArg = Parameters<CBSRegisterArg['registerFunction']>[0]

const USAGE_MARKER = 'Usage::'

/** `summary` is the text before the first `Usage::`; `usage` the trimmed text after it, or null. */
export function deriveUsage(description: string): { summary: string; usage: string | null } {
    const at = description.indexOf(USAGE_MARKER)
    if (at < 0) {
        return { summary: description.trim(), usage: null }
    }
    return {
        summary: description.slice(0, at).trim(),
        usage: description.slice(at + USAGE_MARKER.length).trim(),
    }
}

/**
 * Collects every registration in order, duplicates and internal entries
 * included. Registration invokes no callback.
 */
export function buildMacroEntries(register: RegisterLike, base: CBSRegisterArg): MacroEntry[] {
    const collected: MacroEntry[] = []
    const collect = (arg: RegistrationArg): void => {
        const { summary, usage } = deriveUsage(arg.description)
        collected.push({
            name: arg.name,
            aliases: [...arg.alias],
            summary,
            usage,
            docOnly: arg.callback === 'doc_only',
            internalOnly: arg.internalOnly === true,
            blockSyntax: arg.name.startsWith('#') || arg.name.startsWith(':'),
            deprecated: arg.deprecated
                ? { message: arg.deprecated.message, replacement: arg.deprecated.replacement }
                : null,
        })
    }
    register({ ...base, registerFunction: collect })
    return collected
}

/**
 * The parser's key rule: split on `::` when the first `:` is followed by `:`,
 * otherwise on `:`; take the first piece, lower-case it and drop whitespace,
 * `_` and `-`.
 */
export function cbsNameKey(dat: string): string {
    const colonIndex = dat.indexOf(':')
    const pieces = colonIndex !== -1 && dat[colonIndex + 1] === ':' ? dat.split('::') : dat.split(':')
    return pieces[0].toLocaleLowerCase().replace(/[\s_-]/g, '')
}

export type MacroIndex = {
    /** Every non-internal registration in registration order, duplicates included. */
    entries: readonly MacroEntry[]
    /** The entry the engine would run for the text between the braces, or null. */
    lookup(dat: string): MacroEntry | null
    /** True when typing the entry's own name reaches it. */
    typedNameWorks(e: MacroEntry): boolean
}

/**
 * `lookup` matches the key against the raw, unnormalised names and aliases of
 * every entry, doc_only and internal included. Among matches that are not
 * doc_only the last registered wins, as in the parser; when every match is
 * doc_only, the last of those.
 */
export function createMacroIndex(all: readonly MacroEntry[]): MacroIndex {
    const entries = all.filter((e) => !e.internalOnly)
    const callable = new Map<string, MacroEntry>()
    const documented = new Map<string, MacroEntry>()
    for (const entry of all) {
        const target = entry.docOnly ? documented : callable
        for (const raw of [entry.name, ...entry.aliases]) {
            target.set(raw, entry)
        }
    }
    return {
        entries,
        lookup(dat: string): MacroEntry | null {
            const key = cbsNameKey(dat)
            return callable.get(key) ?? documented.get(key) ?? null
        },
        typedNameWorks(e: MacroEntry): boolean {
            const key = cbsNameKey(e.name)
            return e.name === key || e.aliases.includes(key)
        },
    }
}
