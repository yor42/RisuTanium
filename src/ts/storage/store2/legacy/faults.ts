/**
 * The shapes in an older-format tree that the store2 codec refuses, found without running the codec (CHORE-391): a part
 * that must be a list and is not, an element that must be an object and is not. The conversion uses it to count a
 * strict decode that holds one as not decoded, so a good backup or "convert without these" follows instead of a thrown
 * `CodecInputError`.
 *
 * Invariants:
 *  - Pure and total: it reads the tree it is given, never writes it, and never throws for a value a decoder produces.
 *  - Its rules mirror the codec's refusals (`encodeFront`, `encodePlugins`, `encodePluginStorage`, `encodeModuleSet`,
 *    `normalizeCharacterFromPlain`, `chatMessages`); a part the codec tolerates (`loadouts` elements, an absent or null
 *    list, a `chaId` of any type) is not a fault. "Present" means neither `undefined` nor `null`, as in `listOrEmpty`.
 *  - A value is judged the way the codec reads it: `toJSON` is applied once per level, a boxed primitive is its
 *    primitive, so a `Date` or a boxed number is not an object.
 *  - Deep faults (a BigInt or a cycle inside an element) are not seen here; the conversion's safety net catches them.
 *  - Type-only imports: the module loads in a node test run and on a page that never converts.
 */

/** What a fault is in, in the vocabulary of the "convert without these" list. */
export type LegacyFaultKind = 'presets' | 'modules' | 'loadouts' | 'plugins' | 'pluginStorage' | 'character' | 'chats'

export interface LegacyFault {
    kind: LegacyFaultKind
    /** The tree path of the malformed part, for diagnostics. */
    field: string
    /** English diagnostic, never shown as the label. */
    reason: string
}

type Fields = Record<string, unknown>

/**
 * The object the codec reads `value` as, or null when it reads it as anything else. `toJSON` is applied once (a `Date`
 * becomes its string), then a boxed Number, String or Boolean is its primitive and an array is a list.
 */
function objectView(value: unknown): Fields | null {
    if (typeof value !== 'object' || value === null) {
        return null
    }
    const toJson = (value as { toJSON?: unknown }).toJSON
    const read: unknown = typeof toJson === 'function' ? toJson.call(value) : value
    if (typeof read !== 'object' || read === null || Array.isArray(read)) {
        return null
    }
    if (read instanceof Number || read instanceof String || read instanceof Boolean) {
        return null
    }
    return read as Fields
}

/** Whether the codec reads `value` as a JSON object. The single definition the detector shares with any later consumer. */
export function isObjectLike(value: unknown): boolean {
    return objectView(value) !== null
}

function present(value: unknown): boolean {
    return value !== undefined && value !== null
}

/** The faults of one named list part: the part itself when present and not a list, else each element that is not an object. */
function listFaults(faults: LegacyFault[], kind: LegacyFaultKind, field: string, value: unknown, elementsMustBeObjects: boolean): void {
    if (!present(value)) {
        return
    }
    if (!Array.isArray(value)) {
        faults.push({ kind, field, reason: `${field} is not a list.` })
        return
    }
    if (!elementsMustBeObjects) {
        return
    }
    value.forEach((element: unknown, index) => {
        if (!isObjectLike(element)) {
            faults.push({ kind, field: `${field}[${index}]`, reason: `${field}[${index}] is not an object.` })
        }
    })
}

/**
 * The chat faults of one character: its `chats` when present and not a list, each chat that is not an object, and in
 * each chat its `message` when present and not a list and each message that is not an object. `where` names the
 * character in the `field` of each fault. A character that is not an object has no chats to judge.
 */
export function findCharacterFaults(character: unknown, where = 'character'): LegacyFault[] {
    const faults: LegacyFault[] = []
    const fields = objectView(character)
    if (fields === null) {
        return faults
    }
    const chats = fields.chats
    listFaults(faults, 'chats', `${where}.chats`, chats, true)
    if (Array.isArray(chats)) {
        chats.forEach((chat: unknown, index) => {
            const chatFields = objectView(chat)
            if (chatFields !== null) {
                listFaults(faults, 'chats', `${where}.chats[${index}].message`, chatFields.message, true)
            }
        })
    }
    return faults
}

/**
 * Every fault in `tree`, as read. A character with a truthy `coldstorage` is a stub: its own `chats` are never given to
 * the codec (the unit's character replaces them), so they are not judged. A `characters` that is not a list is not
 * reported here; `legacyCharactersRefused` decides that.
 */
export function findLegacyFaults(tree: unknown): LegacyFault[] {
    const faults: LegacyFault[] = []
    if (typeof tree !== 'object' || tree === null) {
        return faults
    }
    const fields = tree as Fields
    listFaults(faults, 'presets', 'botPresets', fields.botPresets, true)
    listFaults(faults, 'modules', 'modules', fields.modules, true)
    listFaults(faults, 'loadouts', 'loadouts', fields.loadouts, false)
    listFaults(faults, 'plugins', 'plugins', fields.plugins, true)
    listFaults(faults, 'plugins', 'pluginV2', fields.pluginV2, true)
    if (present(fields.pluginCustomStorage) && !isObjectLike(fields.pluginCustomStorage)) {
        faults.push({ kind: 'pluginStorage', field: 'pluginCustomStorage', reason: 'pluginCustomStorage is not an object.' })
    }
    if (Array.isArray(fields.characters)) {
        fields.characters.forEach((slot: unknown, index) => {
            const character = objectView(slot)
            if (character === null) {
                faults.push({ kind: 'character', field: `characters[${index}]`, reason: `characters[${index}] is not an object.` })
            } else if (!character.coldstorage) {
                faults.push(...findCharacterFaults(slot, `characters[${index}]`))
            }
        })
    }
    return faults
}

/**
 * Whether the tree's `characters` rules out converting it: present and not a list, in either format; or, when
 * `requireList`, absent or null as well (the older msgpack format always writes the list, so a missing one is damage,
 * whereas a block-format save with no characters writes none). A root that is not an object is refused when
 * `requireList`.
 */
export function legacyCharactersRefused(tree: unknown, requireList: boolean): boolean {
    if (typeof tree !== 'object' || tree === null) {
        return requireList
    }
    const characters = (tree as Fields).characters
    return present(characters) ? !Array.isArray(characters) : requireList
}
