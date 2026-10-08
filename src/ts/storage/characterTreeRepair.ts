import { v4 as uuidv4 } from 'uuid'
import { characterIdProblem, isCharacterEntry, isUsableCharacterId } from './characterIds'

/**
 * Makes the `characters` of a decoded tree ones the save can hold, before the
 * tree is installed or written. The tree is changed in place: the caller owns
 * it (a boot or restore tree nothing else reads yet, or an export copy).
 *
 * - boot: no unit is read. A missing id is filled as the boot repair does; an
 *   archived character with an unusable id is installed as it is, and the save
 *   loop pauses on it.
 * - restore: an archived character whose own id is missing or unusable takes
 *   back the id its unit records. An unusable id with no unit that can supply
 *   one refuses the restore.
 * - export: as restore, but nothing is refused; an archived character the unit
 *   cannot name is exported under a fresh id.
 */
export type RepairMode = 'boot' | 'restore' | 'export'

export type RepairNotice =
    /** `count` entries that are not characters were left out. */
    | { kind: 'entries-dropped', count: number }
    /** The character had no id and was given a new one. */
    | { kind: 'id-filled', name: string }
    /** The character's id could not key a block; it has a new one and the lists that named the old one follow it. */
    | { kind: 'id-replaced', name: string }
    /** An archived character took back the id its unit records. */
    | { kind: 'stub-id-recovered', name: string }
    /** An archived character could not be given its unit's id; its content cannot be restored from this tree. */
    | { kind: 'stub-unrestorable', name: string }

export type RepairRefusalReason =
    | 'unit-unreadable'
    | 'unit-not-object'
    | 'unit-id-unusable'
    | 'unit-id-duplicate'

export interface RepairRefusal {
    name: string
    reason: RepairRefusalReason
}

export interface TreeRepair {
    notices: RepairNotice[]
    refusals: RepairRefusal[]
}

/**
 * How many entries a repair left out, how many characters were given a new id
 * (missing, or unable to key a block), and how many archived characters took
 * back the id their archived data records.
 */
export function summarizeRepair(notices: readonly RepairNotice[]): { dropped: number, changed: number, recovered: number } {
    let dropped = 0
    let changed = 0
    let recovered = 0
    for (const notice of notices) {
        if (notice.kind === 'entries-dropped') {
            dropped += notice.count
        } else if (notice.kind === 'stub-id-recovered') {
            recovered++
        } else {
            changed++
        }
    }
    return { dropped, changed, recovered }
}
export interface RepairOptions {
    /**
     * The character an archived character's unit holds, or null when the unit
     * cannot be read. Used only in restore and export, only for an archived
     * character whose own id is missing or unusable.
     */
    readUnitCharacter?: (stub: Record<string, unknown>) => Promise<unknown>
}

type Entry = Record<string, unknown>

function nameOf(entry: Entry): string {
    return typeof entry.name === 'string' ? entry.name : ''
}

function isArchived(entry: Entry): boolean {
    return typeof entry.coldstorage === 'string' && entry.coldstorage !== ''
}

function mapIds(list: unknown[], remaps: ReadonlyMap<string, string>): unknown[] {
    return list.map((item) => (typeof item === 'string' ? (remaps.get(item) ?? item) : item))
}

function changesIds(list: unknown[], remaps: ReadonlyMap<string, string>): boolean {
    return list.some((item) => typeof item === 'string' && remaps.has(item))
}

/**
 * Points every reference that names a replaced id at its new one: the
 * character order and its folders, group members, loadouts, and the `saying` of
 * a character message in any character's chats (groups included). The order and the loadouts are rebuilt as new lists. A
 * character is changed through `own(index)`, which hands back the entry itself
 * when the tree belongs to the caller and a copy when it does not (export).
 */
function remapReferences(
    tree: { characterOrder?: unknown, loadouts?: unknown },
    characters: Entry[],
    remaps: ReadonlyMap<string, string>,
    own: (index: number) => Entry,
    copying: boolean,
): void {
    const order = tree.characterOrder
    if (Array.isArray(order)) {
        tree.characterOrder = order.map((item) => {
            if (typeof item === 'string') {
                return remaps.get(item) ?? item
            }
            if (isCharacterEntry(item) && Array.isArray(item.data) && changesIds(item.data, remaps)) {
                return { ...item, data: mapIds(item.data, remaps) }
            }
            return item
        })
    }
    const loadouts = tree.loadouts
    if (Array.isArray(loadouts)) {
        tree.loadouts = loadouts.map((loadout) => (
            isCharacterEntry(loadout) && Array.isArray(loadout.characterIds) && changesIds(loadout.characterIds, remaps)
                ? { ...loadout, characterIds: mapIds(loadout.characterIds, remaps) }
                : loadout
        ))
    }
    for (let i = 0; i < characters.length; i++) {
        const members = characters[i].characters
        if (Array.isArray(members) && changesIds(members, remaps)) {
            own(i).characters = mapIds(members, remaps)
        }
        const chats = characters[i].chats
        if (!Array.isArray(chats)) {
            continue
        }
        let chatsOut: unknown[] | null = null
        for (let c = 0; c < chats.length; c++) {
            const chat: unknown = chats[c]
            if (!isCharacterEntry(chat) || !Array.isArray(chat.message)) {
                continue
            }
            let messagesOut: unknown[] | null = null
            for (let m = 0; m < chat.message.length; m++) {
                const message: unknown = chat.message[m]
                if (!isCharacterEntry(message) || message.role !== 'char' || !Object.hasOwn(message, 'saying') || typeof message.saying !== 'string') {
                    continue
                }
                const to = remaps.get(message.saying)
                if (to === undefined) {
                    continue
                }
                if (!copying) {
                    message.saying = to
                    continue
                }
                messagesOut ??= chat.message.slice()
                messagesOut[m] = { ...message, saying: to }
            }
            if (messagesOut !== null) {
                chatsOut ??= chats.slice()
                chatsOut[c] = { ...chat, message: messagesOut }
            }
        }
        if (chatsOut !== null) {
            own(i).chats = chatsOut
        }
    }
}
export async function repairCharacterTree(tree: { characters?: unknown }, mode: RepairMode, options: RepairOptions = {}): Promise<TreeRepair> {
    const result: TreeRepair = { notices: [], refusals: [] }
    if (!Array.isArray(tree.characters)) {
        return result
    }
    // An export works on a copy of the page's tree: the list is its own, and an
    // entry is copied before it is changed, because the entries are the page's.
    const copying = mode === 'export'
    const list: unknown[] = copying ? tree.characters.slice() : tree.characters
    if (copying) {
        tree.characters = list
    }

    let dropped = 0
    for (let i = list.length - 1; i >= 0; i--) {
        if (!isCharacterEntry(list[i])) {
            list.splice(i, 1)
            dropped++
        }
    }
    if (dropped > 0) {
        result.notices.push({ kind: 'entries-dropped', count: dropped })
    }
    const characters = list as Entry[]
    const copied = new Set<number>()
    const own = (index: number): Entry => {
        if (copying && !copied.has(index)) {
            characters[index] = { ...characters[index] }
            copied.add(index)
        }
        return characters[index]
    }

    const inUse = new Set<string>()
    for (const entry of characters) {
        if (isUsableCharacterId(entry.chaId)) {
            inUse.add(String(entry.chaId))
        }
    }

    const remaps = new Map<string, string>()
    const freshId = (): string => {
        let id = uuidv4()
        while (inUse.has(id)) {
            id = uuidv4()
        }
        inUse.add(id)
        return id
    }
    const give = (index: number, id: string): void => {
        const target = own(index)
        const old = target.chaId
        target.chaId = id
        // The first holder of an unusable id, by position, takes the lists that name it.
        if (typeof old === 'string' && old !== '' && !remaps.has(old)) {
            remaps.set(old, id)
        }
    }

    for (let index = 0; index < characters.length; index++) {
        const entry = characters[index]
        const problem = characterIdProblem(entry.chaId)
        if (problem === null) {
            continue
        }
        const archived = isArchived(entry)
        if (!archived) {
            give(index, freshId())
            result.notices.push({ kind: problem === 'missing' ? 'id-filled' : 'id-replaced', name: nameOf(entry) })
            continue
        }
        if (mode === 'boot') {
            if (problem === 'missing') {
                give(index, freshId())
                result.notices.push({ kind: 'id-filled', name: nameOf(entry) })
            }
            continue
        }
        const read = options.readUnitCharacter
        let unitId: unknown
        let failure: RepairRefusalReason | null = 'unit-unreadable'
        if (read !== undefined) {
            const unit = await read(entry)
            if (unit === null || unit === undefined) {
                failure = 'unit-unreadable'
            } else if (!isCharacterEntry(unit)) {
                failure = 'unit-not-object'
            } else {
                unitId = unit.chaId
                if (!isUsableCharacterId(unitId)) {
                    failure = 'unit-id-unusable'
                } else if (inUse.has(String(unitId))) {
                    failure = 'unit-id-duplicate'
                } else {
                    failure = null
                }
            }
        }
        if (failure === null) {
            const id = String(unitId)
            inUse.add(id)
            give(index, id)
            result.notices.push({ kind: 'stub-id-recovered', name: nameOf(entry) })
            continue
        }
        if (problem === 'missing') {
            give(index, freshId())
            result.notices.push({ kind: 'id-filled', name: nameOf(entry) })
        } else if (mode === 'restore') {
            result.refusals.push({ name: nameOf(entry), reason: failure })
        } else {
            give(index, freshId())
            result.notices.push({ kind: 'stub-unrestorable', name: nameOf(entry) })
        }
    }

    if (remaps.size > 0) {
        remapReferences(tree as { characterOrder?: unknown, loadouts?: unknown }, characters, remaps, own, copying)
    }
    return result
}
/**
 * Keeps only the personas that are objects, treating a missing or non-list
 * `personas` as empty, and re-resolves the selected persona by reference so
 * the same persona stays selected after earlier entries were dropped. Returns
 * how many entries were dropped (a non-list counts as none).
 */
export function repairPersonas(db: { personas?: unknown, selectedPersona?: unknown }): number {
    if (!Array.isArray(db.personas)) {
        db.personas = []
        return 0
    }
    const personas: unknown[] = db.personas
    const selected = typeof db.selectedPersona === 'number' ? personas[db.selectedPersona] : undefined
    const kept = personas.filter((persona) => isCharacterEntry(persona))
    const dropped = personas.length - kept.length
    if (dropped === 0) {
        return 0
    }
    db.personas = kept
    if (typeof db.selectedPersona === 'number') {
        const at = isCharacterEntry(selected) ? kept.indexOf(selected) : -1
        db.selectedPersona = at >= 0 ? at : 0
    }
    return dropped
}
