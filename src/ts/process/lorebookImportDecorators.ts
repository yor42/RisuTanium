/**
 * Pure helpers for lorebook import. No app imports, so both import paths and
 * their tests can use them without pulling in the database or the loader.
 */

/** The fields of an external (SillyTavern, NovelAI, Agnai) entry that map to decorators. */
export interface ExternalDecoratorSource {
    disable?: boolean
    enabled?: boolean
    useProbability?: boolean
    probability?: number | null
    position?: number | string | null
    depth?: number | null
    role?: number | null
    selective?: boolean
    selectiveLogic?: number
    secondary_keys?: string[]
    keysecondary?: string[]
    /** SillyTavern: the insertion order; when present, weight is not the order. */
    order?: number | null
    /** Agnai: decides which matched entries survive the token budget. */
    priority?: number | null
    /** Agnai: decides the order of the surviving entries in the prompt. */
    weight?: number | null
}

/** The fields of an external entry that can give its insertion order, in the order they are tried. */
export interface ExternalOrderSource {
    order?: number | null
    weight?: number | null
    priority?: number | null
    contextConfig?: { budgetPriority?: number | null } | null
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value)
}

/**
 * The insertion order of an imported entry: SillyTavern `order`, then Agnai
 * `weight`, then Agnai `priority`, then NovelAI `budgetPriority`, else 0.
 * Agnai places higher weight first and keeps higher priority under the budget,
 * the same directions as the engine's order and priority, so weight is the
 * order and a differing priority travels as `@@priority`.
 */
export function externalInsertOrder(entry: ExternalOrderSource): number {
    if (isFiniteNumber(entry.order)) {
        return entry.order
    }
    if (isFiniteNumber(entry.weight)) {
        return entry.weight
    }
    if (isFiniteNumber(entry.priority)) {
        return entry.priority
    }
    const budgetPriority = entry.contextConfig?.budgetPriority
    return isFiniteNumber(budgetPriority) ? budgetPriority : 0
}

export interface ExternalDecorators {
    /** Decorator lines to put before the entry content, in order. */
    lines: string[]
    /** The `selective` flag the imported entry gets. */
    selective: boolean
    /** True when the source marks the entry as switched off. */
    disabled: boolean
}

const ROLE_NAMES = ['system', 'user', 'assistant']

/**
 * Maps an external entry to RisuAI decorator lines. Only a numeric `position`
 * is read: 1 places after the description, 4 places at a depth. Any other
 * position, and a string position, gives no line. An Agnai entry whose weight
 * is its insertion order keeps a differing integer priority as `@@priority`,
 * the last line. An entry without these fields gives no lines and keeps its
 * own `selective`.
 */
export function externalEntryDecorators(entry: ExternalDecoratorSource): ExternalDecorators {
    const lines: string[] = []

    if (entry.useProbability && typeof entry.probability === 'number'
        && Number.isFinite(entry.probability) && entry.probability !== 100) {
        lines.push(`@@probability ${entry.probability}`)
    }

    if (entry.position === 1) {
        lines.push('@@position after_desc')
    }
    else if (entry.position === 4) {
        const depth = typeof entry.depth === 'number' && Number.isFinite(entry.depth) ? entry.depth : 4
        lines.push(depth > 0 ? `@@reverse_depth ${depth}` : `@@depth ${depth}`)
        if (entry.role === 0 || entry.role === 1 || entry.role === 2) {
            lines.push(`@@role ${ROLE_NAMES[entry.role]}`)
        }
    }

    let selective = entry.selective ?? false
    const secondary = entry.secondary_keys ?? entry.keysecondary ?? []
    if (entry.selective && secondary.length > 0) {
        switch (entry.selectiveLogic) {
            case 1:
                selective = false
                lines.push(`@@exclude_keys_all ${secondary.join(',')}`)
                break
            case 2:
                selective = false
                for (const key of secondary) {
                    lines.push(`@@exclude_keys ${key}`)
                }
                break
            case 3:
                selective = false
                for (const key of secondary) {
                    lines.push(`@@additional_keys ${key}`)
                }
                break
        }
    }

    // Weight became the insertion order, which is also the default budget
    // priority, so Agnai's own priority is restored as a decorator.
    if (!isFiniteNumber(entry.order) && isFiniteNumber(entry.weight)
        && Number.isInteger(entry.priority) && entry.priority !== entry.weight) {
        lines.push(`@@priority ${entry.priority}`)
    }

    return {
        lines,
        selective,
        disabled: entry.disable === true || entry.enabled === false,
    }
}

/**
 * Makes an imported entry inert whatever its own content says. The marker
 * goes as a line just before the first non-decorator line of the assembled
 * content, so it is the last decorator of the leading run and wins over any
 * `@@activate` the entry carries. Content made only of decorators gets it
 * appended as a new last line. Leading whitespace is dropped; the decorator
 * parser trims the content anyway. A non-string input counts as empty.
 */
export function placeDisabledMarker(assembled: string): string {
    const lines = (typeof assembled === 'string' ? assembled : '').trimStart().split('\n')
    const end = lines.findIndex((line) => !line.trim().startsWith('@@'))
    if (end === -1) {
        lines.push('@@dont_activate')
    }
    else {
        lines.splice(end, 0, '@@dont_activate')
    }
    return lines.join('\n')
}
