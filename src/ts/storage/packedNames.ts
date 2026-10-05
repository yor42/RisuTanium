import { ROOT_BLOCK_NAME, isFixedBlockName } from './blockKeys'

/** The part of a character the packing rule reads. Group chats and stubs fit it as well. */
export interface PackableCharacter {
    readonly chaId?: unknown
    readonly coldstorage?: unknown
}

/**
 * The names whose block lives in the stubs pack rather than under a key of its
 * own: the archived characters (`coldstorage` set) whose name has exactly one
 * holder in `characters`. Never packed, whatever the character says:
 *
 * - a name held by two or more characters: its block is the encoder's frozen
 *   one and keeps its own key. `frozenKeys` (the encoder's) names such keys
 *   too, so a stale frozen key keeps a name out even when the holders were
 *   already reduced to one;
 * - a fixed block name, or the root's name, which are not character blocks.
 *
 * A name is `String(chaId)`, the key the encoder files the character's block
 * under. Pure: it reads its arguments and nothing else.
 */
export function packedNamesOf(
    characters: ReadonlyArray<PackableCharacter>,
    frozenKeys: ReadonlySet<string> = new Set<string>(),
): Set<string> {
    const holders = new Map<string, number>()
    for (const character of characters) {
        const name = String(character.chaId)
        holders.set(name, (holders.get(name) ?? 0) + 1)
    }
    const packed = new Set<string>()
    for (const character of characters) {
        if (!character.coldstorage) {
            continue
        }
        const name = String(character.chaId)
        if (holders.get(name) === 1 && !isFixedBlockName(name) && name !== ROOT_BLOCK_NAME && !frozenKeys.has(name)) {
            packed.add(name)
        }
    }
    return packed
}
