/**
 * The macro picker's pure half: where a `{{` trigger sits, which table rows and registry entries are offered, how
 * they filter and what each inserts. The field owns the DOM and the write; nothing here touches either.
 */
import { textMatches } from '../../chatShell/toggleSearch'
import { registryNameFor } from './cbsBlocks'
import type { MacroEntry, MacroIndex } from './macroIndex'
import type { MacroGroupId, MacroRow, MacroRowId } from './macroGroups'

export type MacroTrigger = { start: number; query: string }

/** An insertion: the text and the caret as an offset inside it (relative to the insertion start). */
export type Insertion = { text: string; caret: number }

export type PickItem = {
    key: string
    name: string
    aliases: readonly string[]
    label: string
    usage: string | null
    insertion: Insertion
    group: MacroGroupId | null
}

/** A second list the field can offer beside the macro picker; the field stays unaware of what the items are. */
export type PickSource = {
    trigger(beforeCaret: string): MacroTrigger | null
    items(): readonly PickItem[]
    matches?(n: number): string
    label?(): string
}

const TRIGGER = /\{\{([^{}:\s]*)$/

/** The open `{{` before the caret and the name typed after it, or null when the caret is not inside one. */
export function macroTrigger(beforeCaret: string): MacroTrigger | null {
    const found = TRIGGER.exec(beforeCaret)
    return found === null ? null : { start: found.index, query: found[1] }
}

/**
 * What a table row inserts. A block gets its opener and closer, with the caret at the condition when the head ends
 * with a space and after the opener otherwise (a head such as `#pure` takes no condition).
 */
export function insertionFor(row: MacroRow): Insertion {
    switch (row.kind) {
        case 'plain': {
            const text = `{{${row.name}}}`
            return { text, caret: text.length }
        }
        case 'args': {
            const text = `{{${row.name}::}}`
            return { text, caret: text.length - 2 }
        }
        case 'block': {
            const opener = `{{${row.head}}}`
            return { text: `${opener}${row.closer}`, caret: row.head.endsWith(' ') ? 2 + row.head.length : opener.length }
        }
        case 'else': {
            const text = `{{${row.raw}}}`
            return { text, caret: text.length }
        }
        case 'comment': {
            const text = `{{${row.raw} }}`
            return { text, caret: text.length - 2 }
        }
    }
}

/** What an entry of the registry that no table row covers inserts: its name between braces, caret at the end. */
export function insertionForName(name: string): Insertion {
    const text = `{{${name}}}`
    return { text, caret: text.length }
}

function entryNamed(index: MacroIndex, name: string | null): MacroEntry | null {
    return name === null ? null : index.entries.find((entry) => entry.name === name) ?? null
}

// The registry entry a table row stands for, or null when the registry has none.
function entryOf(row: MacroRow, index: MacroIndex): MacroEntry | null {
    switch (row.kind) {
        case 'plain':
        case 'args':
            return index.lookup(row.name)
        case 'block':
            return entryNamed(index, registryNameFor(row.keyword))
        case 'else':
        case 'comment':
            return entryNamed(index, row.raw)
    }
}

function nameOf(row: MacroRow): string {
    switch (row.kind) {
        case 'plain':
        case 'args':
            return row.name
        case 'block':
            return row.head.trim()
        case 'else':
        case 'comment':
            return row.raw
    }
}

/**
 * Every offered item: the table rows in order, then one item for each registry entry that is typeable, current and
 * not reached by a row. The table owns blocks, `:else` and `//` (`blockSyntax` entries are never offered twice).
 */
export function pickItems(rows: readonly MacroRow[], index: MacroIndex, label: (id: MacroRowId) => string): PickItem[] {
    const reached = new Set<MacroEntry>()
    const items: PickItem[] = []
    for (const row of rows) {
        const entry = entryOf(row, index)
        if (entry !== null) reached.add(entry)
        items.push({
            key: `row:${row.id}`,
            name: nameOf(row),
            aliases: row.kind === 'plain' || row.kind === 'args' ? entry?.aliases ?? [] : [],
            label: label(row.id),
            usage: entry?.usage ?? null,
            insertion: insertionFor(row),
            group: row.group,
        })
    }
    for (const entry of index.entries) {
        if (entry.docOnly || entry.deprecated !== null || entry.blockSyntax) continue
        if (!index.typedNameWorks(entry) || index.lookup(entry.name) !== entry || reached.has(entry)) continue
        items.push({
            key: `other:${entry.name}`,
            name: entry.name,
            aliases: entry.aliases,
            label: entry.summary,
            usage: entry.usage,
            insertion: insertionForName(entry.name),
            group: null,
        })
    }
    return items
}

// Lower is better: exact name or alias, name prefix, alias prefix, label match. null drops the item.
function rankOf(item: PickItem, query: string): number | null {
    const needle = query.toLowerCase()
    const name = item.name.toLowerCase()
    const aliases = item.aliases.map((alias) => alias.toLowerCase())
    if (name === needle || aliases.includes(needle)) return 0
    if (name.startsWith(needle)) return 1
    if (aliases.some((alias) => alias.startsWith(needle))) return 2
    return textMatches(item.label, query) ? 3 : null
}

/** The items the query keeps, best match first; equal ranks keep their order. An empty query keeps all. */
export function filterPicks(items: readonly PickItem[], query: string): PickItem[] {
    if (query === '') return [...items]
    const ranked: { item: PickItem; rank: number; at: number }[] = []
    items.forEach((item, at) => {
        const rank = rankOf(item, query)
        if (rank !== null) ranked.push({ item, rank, at })
    })
    ranked.sort((a, b) => a.rank - b.rank || a.at - b.at)
    return ranked.map((entry) => entry.item)
}

/** Distance from the window's bottom edge to the visual viewport's bottom edge: the strip rides above the keyboard. */
export function stripBottom(innerHeight: number, vv: { height: number; offsetTop: number }): number {
    return Math.max(0, Math.round(innerHeight - (vv.height + vv.offsetTop)))
}
