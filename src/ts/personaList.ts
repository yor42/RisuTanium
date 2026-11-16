import { v4 } from 'uuid'
import type { Database, RisuPersona } from 'src/ts/storage/database.svelte'
import { isColdStub } from 'src/ts/storage/store2/codec/stub'

/**
 * Pure persona-list helpers over `Database` (callers pass `DBState.db`, so every write lands on the
 * reactive proxy).
 *
 * Mirror invariant (INV-M). When a helper returns, let s = `db.selectedPersona`. Then
 * `0 <= s < personas.length`, `personas.length >= 1`, and `username`, `userIcon`, `personaPrompt` and
 * `userNote` equal `personas[s].name`, `.icon`, `.personaPrompt` and `.note`.
 *
 * The legacy page and the welcome flow edit the mirror first and copy it into the entry later, so a
 * helper that writes begins with `adoptMirror`: a mirror value that leads the entry is never lost.
 * Every id lookup takes the first match, as every resolver of a persona id does.
 */
export type PersonaStore = Pick<Database, 'personas' | 'selectedPersona' | 'username' | 'userIcon' | 'userNote' | 'personaPrompt'>

export type PersonaTextField = 'name' | 'personaPrompt' | 'note' | 'icon'

export interface RemovedPersona {
    copy: RisuPersona
    index: number
    wasActive: boolean
}

export interface PersonaBindings {
    counts: Map<string, number>
    orMore: boolean
}

function hasId(id: unknown): id is string {
    return typeof id === 'string' && id !== ''
}

function indexOfId(db: PersonaStore, id: string): number {
    return db.personas.findIndex((entry) => entry.id === id)
}

/** Copies the mirror into the selected entry, as `saveUserPersona` does. Returns whether anything changed. */
export function adoptMirror(db: PersonaStore): boolean {
    const entry = db.personas[db.selectedPersona]
    if (!entry) {
        return false
    }
    let changed = false
    if (entry.name !== db.username) {
        entry.name = db.username
        changed = true
    }
    if (entry.icon !== db.userIcon) {
        entry.icon = db.userIcon
        changed = true
    }
    if (entry.personaPrompt !== db.personaPrompt) {
        entry.personaPrompt = db.personaPrompt
        changed = true
    }
    if (entry.note !== db.userNote) {
        entry.note = db.userNote
        changed = true
    }
    return changed
}

/** Copies the selected entry into the mirror, as `changeUserPersona` does. Returns whether anything changed. */
export function syncMirror(db: PersonaStore): boolean {
    const entry = db.personas[db.selectedPersona]
    if (!entry) {
        return false
    }
    const note = entry.note ?? ''
    let changed = false
    if (db.username !== entry.name) {
        db.username = entry.name
        changed = true
    }
    if (db.userIcon !== entry.icon) {
        db.userIcon = entry.icon
        changed = true
    }
    if (db.personaPrompt !== entry.personaPrompt) {
        db.personaPrompt = entry.personaPrompt
        changed = true
    }
    if (db.userNote !== note) {
        db.userNote = note
        changed = true
    }
    return changed
}

/**
 * Establishes INV-M for a list that boot or the legacy page left uneven. It adopts the mirror, then
 * stamps a fresh id on every entry whose id is not a non-empty string or repeats an earlier entry's
 * id. The first holder of an id keeps it, so every resolver (all take the first match) resolves
 * exactly as before. Returns whether it wrote anything.
 */
export function normalizePersonas(db: PersonaStore): boolean {
    let changed = adoptMirror(db)
    const seen = new Set<string>()
    for (const entry of db.personas) {
        if (!hasId(entry.id) || seen.has(entry.id)) {
            entry.id = v4()
            changed = true
        }
        seen.add(entry.id)
    }
    if (syncMirror(db)) {
        changed = true
    }
    return changed
}

/**
 * Keys for a keyed `{#each}` over the list. The prefixes make a collision impossible whatever the
 * stored ids are: the first holder of a non-empty string id gets `id:`, every other entry `ix:`.
 */
export function personaRenderKeys(personas: ReadonlyArray<Pick<RisuPersona, 'id'>>): string[] {
    const seen = new Set<string>()
    return personas.map((entry, index) => {
        const id: unknown = entry.id
        if (hasId(id) && !seen.has(id)) {
            seen.add(id)
            return 'id:' + id
        }
        return 'ix:' + index
    })
}

/** Writes one field of the entry with this id, and the mirror when it is the selected one. */
export function editPersona(db: PersonaStore, id: string, field: PersonaTextField, value: string): boolean
export function editPersona(db: PersonaStore, id: string, field: 'largePortrait', value: boolean): boolean
export function editPersona(db: PersonaStore, id: string, field: PersonaTextField | 'largePortrait', value: string | boolean): boolean {
    adoptMirror(db)
    const index = indexOfId(db, id)
    if (index < 0) {
        return false
    }
    const entry = db.personas[index]
    const selected = index === db.selectedPersona
    switch (field) {
        case 'name':
            entry.name = value as string
            if (selected) {
                db.username = value as string
            }
            break
        case 'personaPrompt':
            entry.personaPrompt = value as string
            if (selected) {
                db.personaPrompt = value as string
            }
            break
        case 'note':
            entry.note = value as string
            if (selected) {
                db.userNote = value as string
            }
            break
        case 'icon':
            entry.icon = value as string
            if (selected) {
                db.userIcon = value as string
            }
            break
        case 'largePortrait':
            entry.largePortrait = value as boolean
            break
    }
    return true
}

/** Makes the persona with this id the one in use: `changeUserPersona(i, 'save')` by id. */
export function activatePersona(db: PersonaStore, id: string): boolean {
    adoptMirror(db)
    const index = indexOfId(db, id)
    if (index < 0) {
        return false
    }
    db.selectedPersona = index
    syncMirror(db)
    return true
}

/** Appends an empty persona with a new id. It does not become the one in use. */
export function createPersona(db: PersonaStore, name: string): string {
    adoptMirror(db)
    const id = v4()
    db.personas.push({ name, icon: '', personaPrompt: '', note: '', id })
    return id
}

/** Appends a deep copy of the persona with a new id. It does not become the one in use. */
export function duplicatePersona(db: PersonaStore, id: string): string | null {
    adoptMirror(db)
    const index = indexOfId(db, id)
    if (index < 0) {
        return null
    }
    const copy = safeStructuredClone(db.personas[index])
    copy.id = v4()
    db.personas.push(copy)
    return copy.id
}

/**
 * The persona that is in use after removing the one with this id: the first remaining entry when the
 * active one goes, otherwise the unchanged active one. Reads only; the active entry is overlaid with
 * the mirror because the mirror may lead it.
 */
export function nextActiveAfterRemove(db: PersonaStore, id: string): RisuPersona | null {
    const index = indexOfId(db, id)
    if (index < 0 || db.personas.length < 2) {
        return null
    }
    if (index === db.selectedPersona) {
        return db.personas[index === 0 ? 1 : 0]
    }
    return { ...db.personas[db.selectedPersona], name: db.username }
}

/**
 * Removes the persona with this id. Refuses with `'last'` for the only persona and returns null when
 * no entry has the id. The returned copy is taken before the splice, so it never aliases a reactive
 * proxy. Removing the active persona makes the first remaining one active; bindings are not touched.
 */
export function removePersona(db: PersonaStore, id: string): RemovedPersona | 'last' | null {
    adoptMirror(db)
    const index = indexOfId(db, id)
    if (index < 0) {
        return null
    }
    if (db.personas.length <= 1) {
        return 'last'
    }
    const copy = safeStructuredClone(db.personas[index])
    const wasActive = index === db.selectedPersona
    db.personas.splice(index, 1)
    if (wasActive) {
        db.selectedPersona = 0
    } else if (index < db.selectedPersona) {
        db.selectedPersona = db.selectedPersona - 1
    }
    syncMirror(db)
    return { copy, index, wasActive }
}

/**
 * Reinserts a removed persona at its index (clamped), keeping the active identity, or making it
 * active again when it was active. Refuses when an entry with the same id is back.
 */
export function restorePersona(db: PersonaStore, copy: RisuPersona, index: number, wasActive: boolean): 'restored' | 'present' {
    adoptMirror(db)
    if (indexOfId(db, copy.id ?? '') >= 0) {
        return 'present'
    }
    const at = Math.min(Math.max(index, 0), db.personas.length)
    db.personas.splice(at, 0, safeStructuredClone(copy))
    if (wasActive) {
        db.selectedPersona = at
    } else if (at <= db.selectedPersona) {
        db.selectedPersona = db.selectedPersona + 1
    }
    syncMirror(db)
    return 'restored'
}

/** Moves the persona with this id to position `to` (clamped); the active identity is kept. */
export function movePersona(db: PersonaStore, id: string, to: number): boolean {
    adoptMirror(db)
    const from = indexOfId(db, id)
    if (from < 0) {
        return false
    }
    const target = Math.min(Math.max(to, 0), db.personas.length - 1)
    if (target === from) {
        return false
    }
    const selected = db.selectedPersona
    const [entry] = db.personas.splice(from, 1)
    db.personas.splice(target, 0, entry)
    if (selected === from) {
        db.selectedPersona = target
    } else if (from < selected && target >= selected) {
        db.selectedPersona = selected - 1
    } else if (from > selected && target <= selected) {
        db.selectedPersona = selected + 1
    }
    syncMirror(db)
    return true
}

/**
 * Counts explicit `bindedPersona` ids over the loaded characters. A cold stub's placeholder chat
 * carries no binding, so a stub is skipped and sets `orMore`: its real chats may hold bindings.
 */
export function countBindings(characters: ReadonlyArray<{ chats?: ReadonlyArray<{ bindedPersona?: string }> }>): PersonaBindings {
    const counts = new Map<string, number>()
    let orMore = false
    for (const slot of characters) {
        if (isColdStub(slot)) {
            orMore = true
            continue
        }
        for (const chat of slot.chats ?? []) {
            const bound = chat.bindedPersona
            if (hasId(bound)) {
                counts.set(bound, (counts.get(bound) ?? 0) + 1)
            }
        }
    }
    return { counts, orMore }
}
