import type { Database } from '../../database.svelte'
import type { SalvageOmittedKind } from '../../risuSave'
import type { SkippedLegacyEntry } from './lenient'

/**
 * The shapes in an older-format tree that the store2 codec refuses, found without running the codec (CHORE-391): a part
 * that must be a list and is not, an element that must be an object and is not. The conversion uses it to count a
 * strict decode that holds one as not decoded, so a good backup or "convert without these" follows instead of a thrown
 * `CodecInputError`. "Convert without these" names each kind once (`coalesceFaults`) and leaves the faults out of the
 * converted copy (`dropLegacyFaults`).
 *
 * Invariants:
 *  - Pure and total: it reads the tree it is given, never writes it, and never throws for a value a decoder produces.
 *    `dropLegacyFaults` never mutates and never splices: every container on the path to a change is replaced, every
 *    other one is shared, because the resolved tree shares its arrays and objects with the decoded tree.
 *  - Its rules mirror the codec's refusals (`encodeFront`, `encodePlugins`, `encodePluginStorage`, `encodeModuleSet`,
 *    `normalizeCharacterFromPlain`, `chatMessages`), except the module stub marker, which is deliberately not a fault:
 *    a module that holds it is refused by the codec, never stripped or converted around. A part the codec tolerates
 *    (`loadouts` elements, an absent or null list, a `chaId` of any type) is not a fault. "Present" means neither
 *    `undefined` nor `null`, as in `listOrEmpty`.
 *  - A value is judged the way the codec reads it: `toJSON` is applied once per level, a boxed primitive is its
 *    primitive, so a `Date` or a boxed number is not an object.
 *  - Deep faults (a BigInt or a cycle inside an element) are not seen here; the conversion's safety net catches them. A
 *    cycle first spins the legacy list's string walk, which keeps no visited set, before the net can fire.
 *  - Type-only imports: the module loads in a node test run and on a page that never converts.
 */

/** What a fault is in, in the vocabulary of the "convert without these" list. */
export type LegacyFaultKind = Extract<SalvageOmittedKind, 'presets' | 'modules' | 'loadouts' | 'plugins' | 'pluginStorage' | 'character' | 'chats'>

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

/**
 * The entries "convert without these" names. A skipped character slot is one entry each (a slot that is not an object has
 * no id, so its name is empty); every other kind is one entry, however many parts of it are faulty, and none that
 * `salvaged` (the block-format salvage's own entries, kept as they are) already names.
 */
export function coalesceFaults(faults: readonly LegacyFault[], salvaged: readonly SkippedLegacyEntry[] = []): SkippedLegacyEntry[] {
    const entries: SkippedLegacyEntry[] = [...salvaged]
    const named = new Set<SalvageOmittedKind>(salvaged.filter(entry => entry.kind !== 'character').map(entry => entry.kind))
    for (const fault of faults) {
        if (fault.kind === 'character') {
            entries.push({ name: '', kind: 'character', reason: fault.reason })
        } else if (!named.has(fault.kind)) {
            named.add(fault.kind)
            entries.push({ name: fault.field, kind: fault.kind, reason: fault.reason })
        }
    }
    return entries
}

/** The elements of a list that stay, with the new position of each. */
interface Survivors {
    items: unknown[]
    newIndex: Map<number, number>
}

/** The elements of `list` the codec reads as objects; null when every element is one, so the caller keeps the list it has. */
function keepObjectLike(list: readonly unknown[]): Survivors | null {
    const survivors: Survivors = { items: [], newIndex: new Map() }
    list.forEach((element, index) => {
        if (isObjectLike(element)) {
            survivors.newIndex.set(index, survivors.items.length)
            survivors.items.push(element)
        }
    })
    return survivors.items.length === list.length ? null : survivors
}

/**
 * A position kept in step with a list that lost elements: the new position when its element stays, `fallback` when the
 * element was dropped, and the value as it is when it was not a position in the old list at all.
 */
function indexAfterDrop(old: unknown, oldLength: number, survivors: Survivors, fallback: number): unknown {
    if (typeof old !== 'number' || !Number.isInteger(old) || old < 0 || old >= oldLength) {
        return old
    }
    return survivors.newIndex.get(old) ?? fallback
}

/** A chat without its faults: a message list that is not a list becomes empty, a message that is not an object goes. */
function dropChatFaults(chat: unknown, fields: Fields): unknown {
    const message = fields.message
    if (!present(message)) {
        return chat
    }
    if (!Array.isArray(message)) {
        return { ...fields, message: [] }
    }
    const kept = keepObjectLike(message)
    return kept === null ? chat : { ...fields, message: kept.items }
}

/**
 * A character without its chat faults. A character left with no chat gets one new empty chat (the shape the app's own
 * repair of a chatless character builds), and `chatPage` follows the chats that stay. `fmIndex` is never touched: it
 * selects a first message, not a position in the message list.
 */
function dropCharacterFaults(slot: unknown, fields: Fields, newId: () => string): unknown {
    const chats = fields.chats
    if (fields.coldstorage || !present(chats)) {
        return slot
    }
    let next: unknown[] = []
    let chatPage = fields.chatPage
    if (Array.isArray(chats)) {
        const survivors: Survivors = { items: [], newIndex: new Map() }
        let changed = false
        chats.forEach((chat: unknown, index) => {
            const chatFields = objectView(chat)
            if (chatFields === null) {
                changed = true
                return
            }
            const fixed = dropChatFaults(chat, chatFields)
            changed = changed || fixed !== chat
            survivors.newIndex.set(index, survivors.items.length)
            survivors.items.push(fixed)
        })
        if (!changed) {
            return slot
        }
        next = survivors.items
        if (next.length > 0 && next.length < chats.length) {
            chatPage = indexAfterDrop(chatPage, chats.length, survivors, next.length - 1)
        }
    }
    if (next.length === 0) {
        next = [{ id: newId(), message: [], note: '', name: 'Chat 1', localLore: [] }]
        chatPage = 0
    }
    const fixed: Fields = { ...fields, chats: next }
    if (chatPage !== fields.chatPage) {
        fixed.chatPage = chatPage
    }
    return fixed
}

/**
 * `db` without the faults `findLegacyFaults` reports, for the copy "convert without these" installs. Returns a new
 * top-level object; the input and everything it shares are untouched.
 *
 * A part that is present and not a list becomes empty; an element that is not an object is left out. `botPresetsId`
 * follows the presets that stay: a selected preset that was dropped points one past the last kept one, where the boot
 * repair appends the working settings as a new preset, and an id that is not a position in the old list is left alone.
 * `presetsEmptied` says no preset is left, so the caller supplies the Default preset. The `characters` list itself
 * is never judged here.
 */
export function dropLegacyFaults(db: Database, newId: () => string): { database: Database, presetsEmptied: boolean } {
    const out: Fields = { ...(db as unknown as Fields) }
    const set = (key: string, value: unknown): void => {
        if (value !== out[key]) {
            out[key] = value
        }
    }
    const listPart = (key: string, judgeElements: boolean): void => {
        const value = out[key]
        if (!present(value)) {
            return
        }
        set(key, !Array.isArray(value) ? [] : judgeElements ? (keepObjectLike(value)?.items ?? value) : value)
    }
    let presetsEmptied = false
    const presets = out.botPresets
    if (present(presets)) {
        if (!Array.isArray(presets)) {
            set('botPresets', [])
            presetsEmptied = true
        } else {
            const kept = keepObjectLike(presets)
            if (kept !== null) {
                out.botPresets = kept.items
                presetsEmptied = kept.items.length === 0
                if (!presetsEmptied) {
                    set('botPresetsId', indexAfterDrop(out.botPresetsId, presets.length, kept, kept.items.length))
                }
            }
        }
    }
    listPart('modules', true)
    listPart('loadouts', false)
    listPart('plugins', true)
    listPart('pluginV2', true)
    if (present(out.pluginCustomStorage) && !isObjectLike(out.pluginCustomStorage)) {
        out.pluginCustomStorage = {}
    }
    const characters = out.characters
    if (Array.isArray(characters)) {
        const next: unknown[] = []
        let changed = false
        for (const slot of characters) {
            const fields = objectView(slot)
            if (fields === null) {
                changed = true
                continue
            }
            const fixed = dropCharacterFaults(slot, fields, newId)
            changed = changed || fixed !== slot
            next.push(fixed)
        }
        if (changed) {
            out.characters = next
        }
    }
    return { database: out as unknown as Database, presetsEmptied }
}
