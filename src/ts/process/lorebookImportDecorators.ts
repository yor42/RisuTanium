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
 * position, and a string position, gives no line. An entry without these
 * fields gives no lines and keeps its own `selective`.
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
