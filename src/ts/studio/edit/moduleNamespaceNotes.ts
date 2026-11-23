// The info notes of the module namespace field: pure readings of the module list and of the working Module Integration
// text, so the form only chooses the text. A note never blocks a write. It also holds the one reading of a stored module
// value the form shows, so every control classifies a stored value the same way the history reader does.
import type { JsonValue } from '../../storage/blockFrame'
import { toPlainJson } from '../../storage/store2/codec/normalize'

const FOREIGN_TEXT_LIMIT = 80

export interface StoredReading {
    // The value as text: the string itself, and empty for anything else.
    text: string
    // The engine's reading by truthiness; a typed boolean is itself.
    on: boolean
    // The stored value's JSON text, cut for display, when it is of another type than the field's; else null.
    foreign: string | null
}

/**
 * Reads one stored module field by its stored (plain JSON) form, as a save keeps it. An absent value, `undefined`, a
 * function or a value the codec cannot store reads as absent: empty and off, with no foreign note.
 */
export function readStored(raw: unknown, type: 'text' | 'bool'): StoredReading {
    let plain: JsonValue | undefined
    try {
        plain = toPlainJson(raw)
    } catch {
        plain = undefined
    }
    if (plain === undefined) return { text: '', on: false, foreign: null }
    if (type === 'text' && typeof plain === 'string') return { text: plain, on: false, foreign: null }
    if (type === 'bool' && typeof plain === 'boolean') return { text: '', on: plain, foreign: null }
    const json = JSON.stringify(plain)
    return { text: '', on: Boolean(plain), foreign: json.length > FOREIGN_TEXT_LIMIT ? `${json.slice(0, FOREIGN_TEXT_LIMIT)}…` : json }
}

/** The Module Integration references, with the same comma split and trim the engine's reference list uses. */
export function integrationRefs(integration: string): string[] {
    return integration === '' ? [] : integration.split(',').map((part) => part.trim())
}

function listed(integration: string, namespace: string): boolean {
    return namespace !== '' && integrationRefs(integration).includes(namespace)
}

/** The names of the other modules (every slot but `selfIndex`) that use the same non-empty namespace, in list order. */
export function sharedNamespaceNames(namespace: string, modules: readonly { name?: unknown, namespace?: unknown }[], selfIndex: number): string[] {
    if (namespace === '') return []
    const names: string[] = []
    modules.forEach((row, index) => {
        if (index !== selfIndex && row?.namespace === namespace) names.push(typeof row.name === 'string' ? row.name : '')
    })
    return names
}

/**
 * True when Module Integration cannot find the namespace: it trims each entry and splits on commas, so a namespace with
 * spaces at its ends or a comma inside it matches no entry.
 */
export function namespaceUnmatchable(namespace: string): boolean {
    return namespace !== '' && (namespace !== namespace.trim() || namespace.includes(','))
}

export type IntegrationNote =
    | { kind: 'off', before: string, after: string }
    | { kind: 'on', after: string }

/**
 * The Module Integration note after a landed namespace write. `before` is the namespace before that write (a foreign
 * value counts as none), `live` the namespace now, and `integration` the working Module Integration text. It reads the
 * live values, so an undo that moves `live` back gives the right note again. Null when no write landed or nothing listed
 * is affected.
 */
export function integrationNoteOf(before: string | null, live: string, integration: string): IntegrationNote | null {
    if (before === null || before === live) return null
    if (listed(integration, live)) return { kind: 'on', after: live }
    if (listed(integration, before)) return { kind: 'off', before, after: live }
    return null
}
