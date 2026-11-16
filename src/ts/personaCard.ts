import { Buffer } from 'buffer'
import type { RisuPersona } from 'src/ts/storage/database.svelte'

/** The JSON body of the `persona` tEXt chunk in an exported persona PNG. */
export interface PersonaCard {
    name?: string
    personaPrompt?: string
    note?: string
    largePortrait?: true
}

/** A card read from a PNG: the strings are always present, `note` only when the file held a string. */
export interface ParsedPersonaCard {
    name: string
    personaPrompt: string
    note?: string
    largePortrait?: true
}

export type PersonaCardSource = Pick<RisuPersona, 'name' | 'personaPrompt' | 'icon' | 'note' | 'largePortrait'>

/**
 * The chunk body for a persona. Keys keep the order of the original exporter, so a complete persona
 * without the flag serialises byte-identically. `name` and `personaPrompt` are left out when empty
 * and `largePortrait` is written only when it is true, so a file stays readable by an importer that
 * knows neither the flag nor empty fields.
 */
export function buildPersonaCard(p: Pick<RisuPersona, 'name' | 'personaPrompt' | 'note' | 'largePortrait'>): PersonaCard {
    const card: PersonaCard = {}
    if (p.name) {
        card.name = p.name
    }
    if (p.personaPrompt) {
        card.personaPrompt = p.personaPrompt
    }
    card.note = p.note
    if (p.largePortrait === true) {
        card.largePortrait = true
    }
    return card
}

/**
 * Reads the base64 JSON of a `persona` chunk. Null when the payload is not a JSON object. Missing
 * strings become empty, `note` is kept only when it is a string, and `largePortrait` only when it is
 * literally true.
 */
export function parsePersonaCard(b64: string): ParsedPersonaCard | null {
    let data: unknown
    try {
        data = JSON.parse(Buffer.from(b64, 'base64').toString('utf-8'))
    } catch {
        return null
    }
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
        return null
    }
    const record = data as Record<string, unknown>
    const card: ParsedPersonaCard = {
        name: typeof record.name === 'string' ? record.name : '',
        personaPrompt: typeof record.personaPrompt === 'string' ? record.personaPrompt : '',
    }
    if (typeof record.note === 'string') {
        card.note = record.note
    }
    if (record.largePortrait === true) {
        card.largePortrait = true
    }
    return card
}

/** True when an export of this persona leaves a field out. */
export function hasEmptyExportField(p: Pick<RisuPersona, 'name' | 'personaPrompt'>): boolean {
    return !p.name || !p.personaPrompt
}
