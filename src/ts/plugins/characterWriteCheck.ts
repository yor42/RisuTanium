import { isCharacterEntry, isMissingCharacterId, isUsableCharacterId } from '../storage/characterIds'

/**
 * What a plugin's write to the character list may not do: leave `characters`
 * or `modules` as something that is not a list, put an entry that is not a
 * character into the list, or introduce an id that cannot be saved. A missing
 * id is allowed (the install path fills it). An unusable id is allowed only
 * where the page already holds it, so a round trip (`setDatabase(getDatabase())`,
 * `setChar(getChar())`) keeps working while saving waits on such a character,
 * but a write cannot add one more holder of it or move it onto another slot.
 *
 * Each check returns the reason a write is refused, or null. The setters throw
 * it (or reject with it) before anything is prompted or written, and check
 * again after a prompt's wait, against the list as it is then.
 */

/** The key under which two ids are the same: text and numbers by their text form, anything else by identity. */
function idKey(id: unknown): unknown {
    return typeof id === 'string' || typeof id === 'number' ? `id:${String(id)}` : id
}

function describeId(id: unknown): string {
    if (typeof id === 'symbol') {
        return id.toString()
    }
    if (typeof id === 'object' && id !== null) {
        return 'an object'
    }
    const text = String(id)
    return text.length > 40 ? `${text.slice(0, 40)}...` : text
}

function unusableIdCounts(list: readonly unknown[] | undefined): Map<unknown, number> {
    const counts = new Map<unknown, number>()
    for (const entry of list ?? []) {
        if (isCharacterEntry(entry) && !isMissingCharacterId(entry.chaId) && !isUsableCharacterId(entry.chaId)) {
            const key = idKey(entry.chaId)
            counts.set(key, (counts.get(key) ?? 0) + 1)
        }
    }
    return counts
}

/**
 * Why a write of `incoming` as the whole character list is refused, given the
 * list the page holds now.
 */
export function characterListProblem(live: readonly unknown[] | undefined, incoming: unknown): string | null {
    if (!Array.isArray(incoming)) {
        return 'characters must be a list.'
    }
    const allowed = unusableIdCounts(live)
    for (let i = 0; i < incoming.length; i++) {
        const entry: unknown = incoming[i]
        if (!isCharacterEntry(entry)) {
            return `Entry ${i} of characters is not a character.`
        }
        const id = entry.chaId
        if (isMissingCharacterId(id) || isUsableCharacterId(id)) {
            continue
        }
        const key = idKey(id)
        const left = allowed.get(key) ?? 0
        if (left <= 0) {
            return `The character id ${describeId(id)} cannot be saved.`
        }
        allowed.set(key, left - 1)
    }
    return null
}

/** Why a write of the module list is refused. */
export function moduleListProblem(incoming: unknown): string | null {
    return Array.isArray(incoming) ? null : 'modules must be a list.'
}

/**
 * Why a write of one character into the slot that holds `replaced` is
 * refused: it must be a character, and an unusable id is allowed only when the
 * replaced character already has that same id.
 */
export function singleCharacterProblem(incoming: unknown, replaced: unknown): string | null {
    if (!isCharacterEntry(incoming)) {
        return 'The character must be an object.'
    }
    const id = incoming.chaId
    if (isMissingCharacterId(id) || isUsableCharacterId(id)) {
        return null
    }
    const replacedId = isCharacterEntry(replaced) ? replaced.chaId : undefined
    if (!isMissingCharacterId(replacedId) && !isUsableCharacterId(replacedId) && idKey(replacedId) === idKey(id)) {
        return null
    }
    return `The character id ${describeId(id)} cannot be saved.`
}

/** Why a write of the keys of `newDb` is refused, given the page's database. */
export function databaseWriteProblem(live: { characters?: readonly unknown[] }, newDb: Record<string, unknown>): string | null {
    if (Object.hasOwn(newDb, 'characters')) {
        const problem = characterListProblem(live.characters, newDb.characters)
        if (problem !== null) {
            return problem
        }
    }
    if (Object.hasOwn(newDb, 'modules')) {
        return moduleListProblem(newDb.modules)
    }
    return null
}
