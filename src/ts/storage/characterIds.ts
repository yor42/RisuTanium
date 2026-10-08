import { isWellFormedUtf16 } from './store/keyRules'

/** The longest block name the save file's framing can carry, in UTF-8 bytes. */
export const MAX_CHARACTER_ID_BYTES = 255

/**
 * Names a character id may not take: the save file's own blocks, and
 * `__proto__`, which cannot key a plain object's own property. Other
 * prototype names (`constructor`, `toString`) are ordinary ids: blocks are
 * held in a prototype-free object and every lookup by id is an own-key one.
 */
const RESERVED_BLOCK_NAMES: ReadonlySet<string> = new Set(['root', 'config', 'preset', 'modules', 'loadouts', 'plugins', 'pluginStorage', '__proto__'])

/** The shape of nearly every id (a uuid or a short name): decided without encoding it. */
const PLAIN_ID = /^[A-Za-z0-9_-]{1,80}$/

const textEncoder = new TextEncoder()

/** A character entry: a non-null object that is not a list. Anything else in `characters` is not a character. */
export function isCharacterEntry(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** An id the save treats as absent: every falsy value, as the boot repair does. */
export function isMissingCharacterId(id: unknown): boolean {
    return !id
}

/**
 * An id that can key a block: a non-empty string or a finite number whose text
 * form fits the block name field, is well-formed UTF-16, and is not one of the
 * names in `RESERVED_BLOCK_NAMES`.
 */
export function isUsableCharacterId(id: unknown): id is string | number {
    if (typeof id === 'string' && PLAIN_ID.test(id)) {
        return !RESERVED_BLOCK_NAMES.has(id)
    }
    if (typeof id === 'number') {
        if (!Number.isFinite(id) || id === 0) {
            return false
        }
    } else if (typeof id !== 'string' || id === '') {
        return false
    }
    const key = String(id)
    if (!isWellFormedUtf16(key) || RESERVED_BLOCK_NAMES.has(key)) {
        return false
    }
    return textEncoder.encode(key).length <= MAX_CHARACTER_ID_BYTES
}

/** Why an id cannot key a block, or null when it can. */
export type CharacterIdProblem = 'missing' | 'unusable'

export function characterIdProblem(id: unknown): CharacterIdProblem | null {
    if (isMissingCharacterId(id)) {
        return 'missing'
    }
    return isUsableCharacterId(id) ? null : 'unusable'
}

/** The key a block is held under: the id's text form, the coercion a plain object's property access applies. */
export function characterBlockName(id: string | number): string {
    return String(id)
}
