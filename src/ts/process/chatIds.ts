import { v4 as uuidv4 } from "uuid"

/**
 * Pure id fill and duplicate-warning helpers for chats and characters. Every
 * install route that can bring an id-less chat or character into the
 * database fills the missing id with a fresh one, and the install fills and
 * duplicate warnings never reassign or move an id already present.
 * `repairDatabaseIds` is the one exception: it is boot's own repair. It must
 * never run against the live database at runtime; it runs only at boot and
 * on a decoded backup, before that backup is installed. Work that holds a
 * reference across a backup load (a draft, a unit of work in flight) resolves
 * against the repaired backup once it is installed, which is a known
 * residual rather than something this guards against. Plugin-supplied
 * objects reach this module untyped, so every shape below is a loose
 * structural guard, not a domain type.
 *
 * This module's only runtime import is `uuid`: it never imports the app
 * store (`stores.svelte.ts`) or anything that pulls it in, so storage, boot
 * and backup code can use it without loading the rest of the app. The
 * live-data origin API (`writeAt`, `resolveOrigin`, `beginWork` and the
 * rest), which does need the live database, lives in `chatOrigin.ts`
 * instead.
 */

interface ChatLike {
    id?: string
    [key: string]: unknown
}

interface CharacterLike {
    chaId?: string
    chats?: unknown[]
    [key: string]: unknown
}

interface DatabaseInstallLike {
    characters?: unknown[]
    [key: string]: unknown
}

function isChatLike(value: unknown): value is ChatLike {
    return typeof value === 'object' && value !== null
}

function isCharacterLike(value: unknown): value is CharacterLike {
    return typeof value === 'object' && value !== null
}

function isDatabaseInstallLike(value: unknown): value is DatabaseInstallLike {
    return typeof value === 'object' && value !== null
}

/**
 * Fills a missing `chat.id` with a fresh id. Never inherits the id of the
 * chat this call replaces: deciding which side of a multi-call swap or
 * rotation an id-less object stands for cannot be decided one call at a
 * time, so a missing id is always fresh. A `chat` that already carries an id
 * is left untouched.
 */
export function fillMissingChatSlotId(chat: unknown): void {
    if (!isChatLike(chat) || chat.id) {
        return
    }
    chat.id = uuidv4()
}

/**
 * Fills a missing `chaId` on a character install with a fresh id, and fills
 * a missing id on every chat inside `char` the same way. Never inherits the
 * `chaId` of the character this call replaces, or a chat id by position,
 * for the same reason as `fillMissingChatSlotId`. A `char` or chat that
 * already carries an id is left untouched. Tolerates a `char` with no
 * `chats` array.
 */
export function fillMissingCharacterInstallIds(char: unknown): void {
    if (!isCharacterLike(char)) {
        return
    }
    if (!char.chaId) {
        char.chaId = uuidv4()
    }
    if (Array.isArray(char.chats)) {
        for (const chat of char.chats) {
            if (isChatLike(chat) && !chat.id) {
                chat.id = uuidv4()
            }
        }
    }
}

/**
 * Fills every missing id on a whole-database install's incoming characters
 * (`setDatabase`/`setDatabaseLite`). No id inherits by position here -- a
 * missing `chaId` or chat id is always fresh. Tolerates a `newDb` with no
 * `characters`, and a character with no `chats`.
 *
 * Reads and writes `newDb.characters` and each character's `chats` by index,
 * with the length cached before the loop starts, rather than `for...of`:
 * when either array is the database's own live, proxied array, `for...of`'s
 * iterator protocol costs more per element than a plain indexed read on the
 * same proxy.
 */
export function fillMissingDatabaseInstallIds(newDb: unknown): void {
    if (!isDatabaseInstallLike(newDb) || !Array.isArray(newDb.characters)) {
        return
    }
    const characters = newDb.characters
    const characterCount = characters.length
    for (let i = 0; i < characterCount; i++) {
        const char = characters[i]
        if (!isCharacterLike(char)) {
            continue
        }
        if (!char.chaId) {
            char.chaId = uuidv4()
        }
        if (Array.isArray(char.chats)) {
            const chats = char.chats
            const chatCount = chats.length
            for (let j = 0; j < chatCount; j++) {
                const chat = chats[j]
                if (isChatLike(chat) && !chat.id) {
                    chat.id = uuidv4()
                }
            }
        }
    }
}

/**
 * Repairs ids in place: a missing `chaId` or chat id gets a fresh one, and
 * an id already seen (by any character or chat of either kind, in array
 * order) is treated as missing too, so the first holder by position keeps
 * it. Holds one id set for the whole target. A character whose `chats` is
 * `undefined` or `null` gets `[]`; a `chats` value that is present but not an
 * array is never assigned to (so it is not replaced by a different value),
 * and its chats are skipped, since there is no array here to repair ids
 * into.
 *
 * This is boot's own repair algorithm (`assignIds`, `src/ts/bootstrap.ts`),
 * factored out here so a backup load can run it directly on a decoded
 * object, before that object ever enters `$state`, without importing
 * `bootstrap.ts` and its whole boot-time module graph. `assignIds` itself
 * delegates here for its own `DBState.db` case, so both callers run the
 * exact same algorithm.
 */
export function repairDatabaseIds(target: { characters?: unknown[] } | null | undefined): void {
    if (!target || !Array.isArray(target.characters)) {
        return
    }
    const assignedIds = new Set<string>()
    for (const cha of target.characters) {
        repairCharacterIds(cha, assignedIds)
    }
}

/**
 * The per-character step of `repairDatabaseIds`, which calls it for every entry in array order. `assignedIds` is the
 * one id set of the whole target (chaIds and chat ids of every character already repaired); the step reads and extends
 * it, so a caller that repairs one character at a time must hand every call the same set. An entry that is not an
 * object is left alone.
 */
export function repairCharacterIds(cha: unknown, assignedIds: Set<string>): void {
    if (!isCharacterLike(cha)) {
        return
    }
    if (!cha.chaId) {
        cha.chaId = uuidv4()
    }
    if (assignedIds.has(cha.chaId)) {
        console.warn(`Duplicate chaId found: ${cha.chaId}. Assigning new ID.`)
        cha.chaId = uuidv4()
    }
    assignedIds.add(cha.chaId)
    if (cha.chats === undefined || cha.chats === null) {
        cha.chats = []
    }
    if (!Array.isArray(cha.chats)) {
        return
    }
    for (const chat of cha.chats) {
        if (!isChatLike(chat)) {
            continue
        }
        if (!chat.id) {
            chat.id = uuidv4()
        }
        if (assignedIds.has(chat.id)) {
            console.warn(`Duplicate chat ID found: ${chat.id}. Assigning new ID.`)
            chat.id = uuidv4()
        }
        assignedIds.add(chat.id)
    }
}

/**
 * Whether `repairDatabaseIds` over `characters` would change any `chaId`: one is falsy, or equals an id already held
 * by an earlier character or chat (chat ids of earlier characters count; a chat id repaired to a fresh one adds
 * nothing that can collide). Reads only, so the whole list can be checked without repairing it. The id set and its
 * SameValueZero comparison on raw values are the repair's own, so a number never equals its string form. A list that
 * is not an array, and an entry that is not an object, change nothing.
 */
export function chaIdRepairNeeded(characters: unknown): boolean {
    if (!Array.isArray(characters)) {
        return false
    }
    const seen = new Set<unknown>()
    for (const cha of characters) {
        if (!isCharacterLike(cha)) {
            continue
        }
        if (!cha.chaId || seen.has(cha.chaId)) {
            return true
        }
        seen.add(cha.chaId)
        if (!Array.isArray(cha.chats)) {
            continue
        }
        for (const chat of cha.chats) {
            if (isChatLike(chat) && chat.id && !seen.has(chat.id)) {
                seen.add(chat.id)
            }
        }
    }
    return false
}

/**
 * Logs the state after an install call, never a verdict on it: whether a
 * particular call created a duplicate cannot be decided from that call
 * alone, because a sequence of calls -- a swap, for example -- can leave or
 * move one. So the message never says a plugin "installed a duplicate" or
 * "introduced" one. It names the kind and id, names the plugin when known,
 * says the duplicate may be transient (the first call of a two-call swap
 * always leaves one) or may predate this call, and states the consequence
 * while it lasts.
 */
function warnDuplicateId(kind: 'chat id' | 'chaId', id: string, pluginName: string | undefined): void {
    const holder = kind === 'chaId' ? 'character' : 'chat'
    const lead = pluginName ? `After an install by plugin "${pluginName}", ` : 'After an install, '
    const consequence = kind === 'chaId'
        ? 'writes addressed by id to either holder are skipped, and saving is paused for that chaId, whose last saved block is kept'
        : 'writes addressed by id to either holder are skipped'
    console.warn(
        `${lead}${kind} (${id}) is held by more than one ${holder}. This may be transient -- the first `
        + `call of a swap made with two per-slot setters always leaves one duplicate in place -- or it `
        + `may predate this call. While it lasts, ${consequence}.`
    )
}

/**
 * Warns when installing `newId` at a chat slot introduces a duplicate: some
 * other chat in `chats` (excluding the slot itself) already held `newId`
 * before this call. Never fires when `newId` equals the slot's previous id
 * (nothing changed) or when nothing was filled or supplied.
 */
export function warnIfChatSlotIdDuplicated(
    chats: unknown,
    slotIndex: number,
    newId: string | undefined,
    oldId: string | undefined,
    pluginName?: string,
): void {
    if (!newId || newId === oldId || !Array.isArray(chats)) {
        return
    }
    const collides = chats.some((c, i) => i !== slotIndex && isChatLike(c) && c.id === newId)
    if (collides) {
        warnDuplicateId('chat id', newId, pluginName)
    }
}

/**
 * Warns when installing `newChaId` at a character slot introduces a
 * duplicate: some other character in `characters` (excluding the slot
 * itself) already held `newChaId` before this call. Never fires when
 * `newChaId` equals the slot's previous `chaId` (nothing changed) or when
 * nothing was filled or supplied.
 */
export function warnIfCharacterChaIdDuplicated(
    characters: unknown,
    slotIndex: number,
    newChaId: string | undefined,
    oldChaId: string | undefined,
    pluginName?: string,
): void {
    if (!newChaId || newChaId === oldChaId || !Array.isArray(characters)) {
        return
    }
    const collides = characters.some((c, i) => i !== slotIndex && isCharacterLike(c) && c.chaId === newChaId)
    if (collides) {
        warnDuplicateId('chaId', newChaId, pluginName)
    }
}

/**
 * Warns for a chat id that a character install's own `chats` holds twice or
 * more, when the baseline chat list held that id fewer than twice, as a
 * noise filter only: the comparison decides whether to warn, never whether
 * this call is at fault -- see `warnDuplicateId`, whose text makes no claim
 * of blame. Returns before touching `characters` at all when `newChats`
 * itself holds no id twice or more, since no baseline could then change the
 * outcome.
 *
 * The baseline is the prior holder of `newChaId`, found by scanning
 * `characters` (the database as it stood right before this call) for a
 * character whose own `chaId` already equals `newChaId`: the slot being
 * replaced can hold a different `chaId` than the one being installed there,
 * as one call of a swap does, so its own chats are the wrong baseline for
 * that case. When no character holds `newChaId` yet, `replacedChats` (the
 * slot being replaced) is the baseline instead. When more than one character
 * already holds `newChaId`, that `chaId` is already a pre-existing
 * duplicate, and this returns without warning about chat ids for it --
 * which of those two chat lists to compare against cannot be decided from
 * here. Never fires for a multiplicity the baseline already had, and never
 * fires for an id held only once.
 *
 * Known limits of this detection: chat ids are compared within the
 * installed character only, never against another character's chats;
 * nothing is reported here once `newChaId` already has more than one
 * holder, for the reason above; and a duplicate made in place on a live
 * chat list, without going through a call to this function, is never seen.
 */
export function warnIfCharacterInstallDuplicatesChatIds(
    newChats: unknown,
    newChaId: string | undefined,
    characters: unknown,
    replacedChats: unknown,
    pluginName?: string,
): void {
    if (!Array.isArray(newChats)) {
        return
    }
    const newCounts = countBy(newChats, (c) => (isChatLike(c) ? c.id : undefined))
    let hasDuplicate = false
    for (const count of newCounts.values()) {
        if (count >= 2) {
            hasDuplicate = true
            break
        }
    }
    if (!hasDuplicate) {
        return
    }
    let priorChats = replacedChats
    if (newChaId && Array.isArray(characters)) {
        let priorHolder: CharacterLike | undefined
        let priorHolderCount = 0
        const characterCount = characters.length
        for (let i = 0; i < characterCount; i++) {
            const candidate = characters[i]
            if (isCharacterLike(candidate) && candidate.chaId === newChaId) {
                priorHolderCount++
                priorHolder = candidate
            }
        }
        if (priorHolderCount > 1) {
            return
        }
        if (priorHolderCount === 1) {
            priorChats = priorHolder?.chats
        }
    }
    const oldCounts = Array.isArray(priorChats)
        ? countBy(priorChats, (c) => (isChatLike(c) ? c.id : undefined))
        : new Map<string, number>()
    for (const [id, count] of newCounts) {
        if (count >= 2 && (oldCounts.get(id) ?? 0) < 2) {
            warnDuplicateId('chat id', id, pluginName)
        }
    }
}

// Both helpers below read their array by index, with the length cached
// before the loop, rather than `for...of`: they run against the database's
// own live, proxied `characters` array, where a plain indexed read costs
// less per element than the iterator protocol `for...of` uses.
function countBy<T>(items: readonly T[], keyOf: (item: T) => string | undefined): Map<string, number> {
    const counts = new Map<string, number>()
    const count = items.length
    for (let i = 0; i < count; i++) {
        const key = keyOf(items[i])
        if (key) {
            counts.set(key, (counts.get(key) ?? 0) + 1)
        }
    }
    return counts
}

/**
 * Indexes `characters` by `chaId`, reading only that one field -- never
 * `chats` -- so building this index stays cheap even when `characters` is
 * the database's own live, proxied array.
 */
function indexCharactersByChaId(characters: readonly unknown[]): Map<string, CharacterLike> {
    const index = new Map<string, CharacterLike>()
    const count = characters.length
    for (let i = 0; i < count; i++) {
        const c = characters[i]
        if (isCharacterLike(c) && c.chaId) {
            index.set(c.chaId, c)
        }
    }
    return index
}

/**
 * Warns about every `chaId` and, within a character, every chat id whose
 * multiplicity a whole-database install's incoming `characters` counts
 * higher than `beforeCharacters` (the database as it stood right before
 * this call) did. The comparison is a noise filter, not a verdict: it
 * decides whether to warn, never whether this call is at fault -- see
 * `warnDuplicateId`, whose text makes no claim of blame. `chaId` duplicates
 * are counted database-wide; chat id duplicates are counted within the
 * character holding them, matched to `beforeCharacters` by that character's
 * own `chaId`.
 *
 * Three shortcuts keep this cheap against `beforeCharacters` when it is
 * `DBState.db`'s own live, proxied array, which is what makes reading it
 * expensive:
 * - When `newDb.characters` is that same array (the v2.1
 *   `setDatabaseLite(getDatabase())` idiom), this call cannot have
 *   introduced anything, so nothing is read from either side at all.
 * - Counting an incoming character's own chat ids reads that character's
 *   `chats` once, for every character in `newDb.characters` not skipped by
 *   the identity check below. Reading into a `beforeCharacters` character's
 *   own fields, by contrast, happens only on demand: its `chaId` is read,
 *   across the whole array, only once the `chaId` counts over
 *   `newDb.characters` show some `chaId` occurring twice or more; a single
 *   prior character's `chats` is read only for the one prior character
 *   whose `chaId` matches an incoming character whose own `chats` already
 *   holds a chat id twice or more.
 * - An incoming character that is the same object (`===`) as one already in
 *   `beforeCharacters` never has its own `chats` counted at all: at call
 *   time its chats are the very same live data as before, so nothing this
 *   call did could have raised their multiplicity. Building the identity set
 *   this checks against iterates `beforeCharacters` once, at the array
 *   level only -- never into any character's own `chats`.
 */
export function warnDuplicatesInDatabaseInstall(newDb: unknown, beforeCharacters: unknown, pluginName?: string): void {
    if (!isDatabaseInstallLike(newDb) || !Array.isArray(newDb.characters)) {
        return
    }
    if (newDb.characters === beforeCharacters) {
        return
    }
    const newCharacters = newDb.characters
    const priorCharacters = Array.isArray(beforeCharacters) ? beforeCharacters : []
    const priorCharacterSet = new Set(priorCharacters)

    const newChaIdCounts = countBy(newCharacters, (c) => (isCharacterLike(c) ? c.chaId : undefined))
    let priorChaIdCounts: Map<string, number> | undefined
    for (const [chaId, count] of newChaIdCounts) {
        if (count < 2) {
            continue
        }
        priorChaIdCounts ??= countBy(priorCharacters, (c) => (isCharacterLike(c) ? c.chaId : undefined))
        if (count > (priorChaIdCounts.get(chaId) ?? 0)) {
            warnDuplicateId('chaId', chaId, pluginName)
        }
    }

    let priorCharactersByChaId: Map<string, CharacterLike> | undefined
    const newCharacterCount = newCharacters.length
    for (let i = 0; i < newCharacterCount; i++) {
        const char = newCharacters[i]
        if (!isCharacterLike(char) || !Array.isArray(char.chats) || priorCharacterSet.has(char)) {
            continue
        }
        const newChatIdCounts = countBy(char.chats, (c) => (isChatLike(c) ? c.id : undefined))
        let hasDuplicate = false
        for (const count of newChatIdCounts.values()) {
            if (count >= 2) {
                hasDuplicate = true
                break
            }
        }
        if (!hasDuplicate) {
            continue
        }
        priorCharactersByChaId ??= indexCharactersByChaId(priorCharacters)
        const priorChar = char.chaId ? priorCharactersByChaId.get(char.chaId) : undefined
        const priorChatIdCounts = (priorChar && Array.isArray(priorChar.chats))
            ? countBy(priorChar.chats, (c) => (isChatLike(c) ? c.id : undefined))
            : undefined
        for (const [chatId, count] of newChatIdCounts) {
            if (count >= 2 && count > (priorChatIdCounts?.get(chatId) ?? 0)) {
                warnDuplicateId('chat id', chatId, pluginName)
            }
        }
    }
}
