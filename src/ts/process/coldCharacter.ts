import { v4 as uuidv4 } from "uuid"
import type { Chat, character, groupChat } from "../storage/database.svelte"
import { isTrashPurgeDue } from "../storage/trashPurge"

/**
 * The archived-character placeholder (the "stub"): what stands in the
 * character list for a character whose full data lives in a cold-storage
 * unit, and the pure rules around it.
 *
 * This module must stay free of `characters.ts`, `index.svelte.ts`, `util.ts`
 * (which loads `characters.ts`) and `coldstorage.svelte.ts` (which imports
 * this module): the restore side, which does read storage, lives in
 * `coldCharacterRestore.ts`.
 */

/**
 * Value of `coldVersion` on a stub built by `buildColdStub` or rewritten by
 * `enrichLegacyStub`. A stub without it was made by the upstream application
 * and restores the same way. `isLegacyStub` treats a stub below it as not yet
 * up to date, so the boot archive pass rewrites each such stub once; raising it
 * makes every older stub be read from its unit and rewritten at the next boot
 * where the pass runs. Version 3 added `tags` and `creator`.
 */
export const COLD_STUB_VERSION = 3

/**
 * Lowest `coldVersion` whose `coldChatCount` `coldStubChatCount` trusts. It is
 * deliberately lower than `COLD_STUB_VERSION`: a stub that has not been
 * upgraded yet still shows its real chat count, and only the upgrade gate moves
 * with the current version.
 */
export const COLD_STUB_CHAT_COUNT_VERSION = 2

/** Longest description a stub carries; the grid shows only a few lines of it. */
const COLD_STUB_DESCRIPTION_LIMIT = 500

type Slot = character | groupChat

/**
 * Exactly the fields a stub carries. It is deliberately not a full
 * `character` or `groupChat`; it is cast to one at the single place that
 * builds it, because every list reader and the save code only read these.
 */
interface ColdStubFields {
    type: 'character' | 'group'
    name: string
    image?: string
    chaId: string
    lastInteraction?: number
    trashTime?: number
    characters?: string[]
    creatorNotes: string
    coldstorage: string
    coldStoragedChats: string[]
    chats: Chat[]
    chatPage: number
    firstMsgIndex: number
    coldVersion: number
    coldChatCount: number
    tags?: string[]
    creator?: string
}

/**
 * The text the character grid shows for a description: the `en` section of a
 * multilingual `creatorNotes`, else the text outside any section. It applies
 * the same rule as `parseMultilangString` in `util.ts` (not importable here)
 * and the grid's `['en'] || ['xx']`.
 */
function shownDescription(notes: string): string {
    const sections = /# `(.+?)`\n([\s\S]+?)(?=\n# `|$)/g
    let en = ''
    let match: RegExpExecArray | null
    while ((match = sections.exec(notes)) !== null) {
        if (match.index === sections.lastIndex) {
            sections.lastIndex++
        }
        if (match[1] === 'en') {
            en = match[2]
        }
    }
    return en || notes.replace(sections, '')
}

/**
 * The description a stub carries, chosen the way the grid chooses it and then
 * cut to a bounded length, so the stub renders as the full character does. The
 * character search matches loaded and archived characters on this same text,
 * and on the stub's `tags` and `creator`, so archiving never changes what a
 * search finds.
 */
export function stubDescription(creatorNotes: unknown): string {
    const text = shownDescription(typeof creatorNotes === 'string' ? creatorNotes : '')
    if (text.length <= COLD_STUB_DESCRIPTION_LIMIT) {
        return text
    }
    let cut = text.slice(0, COLD_STUB_DESCRIPTION_LIMIT)
    const last = cut.charCodeAt(cut.length - 1)
    if (last >= 0xD800 && last <= 0xDBFF) {
        cut = cut.slice(0, -1)
    }
    return cut
}

/**
 * The creator the character lists and the search use: the edited
 * `additionalData.creator` when it is a non-empty string, else the top-level
 * `creator` when it is a string, else ''. A stub has no `additionalData`, so for
 * a stub this is the resolved `creator` it carries.
 */
export function characterCreator(slot: Slot): string {
    const edited = (slot as character).additionalData?.creator
    if (typeof edited === 'string' && edited.length > 0) {
        return edited
    }
    const creator = (slot as character).creator
    return typeof creator === 'string' ? creator : ''
}

/**
 * The tags of `source` that are strings, as a new array; [] when `tags` is not
 * an array. Never throws.
 */
export function stubTags(source: Slot): string[] {
    const tags = (source as character).tags
    return Array.isArray(tags) ? tags.filter((tag): tag is string => typeof tag === 'string') : []
}

/**
 * The stub for `source`, which is written into the unit `unitKey`.
 * `coldStoragedChats` lists the chat units `source` already points at. Returns
 * a new object; `source` is not modified.
 *
 * Besides the pointer fields (`coldstorage`, `coldStoragedChats` and the one
 * dummy chat, whose first message must stay empty) the stub carries what the
 * character lists show: the real `type` (and a group's member list), name,
 * image, `lastInteraction`, `trashTime`, the chat count and the description,
 * and for a character its tags and resolved creator (`characterCreator`), whole
 * and untruncated. It carries no message content. `trashTime` and
 * `lastInteraction` are left off when unset, so a saved stub has no such key.
 * It never throws on odd saved data, because one bad character must not stop
 * the archive pass: a group without a member list gets an empty one, and a
 * description that is not a string gives an empty description.
 */
export function buildColdStub(source: character, unitKey: string, coldStoragedChats: string[]): character
export function buildColdStub(source: groupChat, unitKey: string, coldStoragedChats: string[]): groupChat
export function buildColdStub(source: Slot, unitKey: string, coldStoragedChats: string[]): Slot
export function buildColdStub(source: Slot, unitKey: string, coldStoragedChats: string[]): Slot {
    const stub: ColdStubFields = {
        type: source.type === 'group' ? 'group' : 'character',
        name: source.name,
        image: source.image,
        chaId: source.chaId,
        creatorNotes: stubDescription(source.creatorNotes),
        coldstorage: unitKey,
        coldStoragedChats: [...coldStoragedChats],
        chats: [{
            id: uuidv4(),
            message: [{
                time: Date.now(),
                data: '',
                role: 'char'
            }],
            note: "",
            name: "",
            localLore: []
        }],
        chatPage: 0,
        firstMsgIndex: 0,
        coldVersion: COLD_STUB_VERSION,
        coldChatCount: Array.isArray(source.chats) ? source.chats.length : 0,
    }
    if (typeof source.lastInteraction === 'number') {
        stub.lastInteraction = source.lastInteraction
    }
    if (source.trashTime) {
        stub.trashTime = source.trashTime
    }
    if (source.type === 'group') {
        stub.characters = Array.isArray(source.characters) ? [...source.characters] : []
    } else {
        stub.tags = stubTags(source)
        stub.creator = characterCreator(source)
    }
    return stub as unknown as Slot
}

/**
 * Whether the boot archive pass may turn `cha` into a stub: it is not one
 * already, and the startup purge, which runs after the pass in the same boot,
 * is not about to remove it (`isTrashPurgeDue`). A trashed character is
 * archivable; its stub carries its `trashTime` (`buildColdStub`), and the stub
 * is authoritative for the trash state (`applyStubStateOnRestore`).
 */
export function isArchivableCharacter(cha: Slot, now: number): boolean {
    return !cha.coldstorage && !isTrashPurgeDue(cha.trashTime, now)
}

/**
 * What a cold-storage unit holds for `source`: everything but `trashTime`. The
 * stub is the only carrier of the trash state on this fork. A unit that carried
 * one would bring it back when upstream opens the stub, because upstream
 * replaces the slot wholesale with the unit's character, and upstream's startup
 * purge could then delete a character the user had taken out of the trash. The
 * fork never reads a unit's `trashTime` (`applyStubStateOnRestore`,
 * `enrichLegacyStub`).
 */
export function coldUnitCharacter<T extends Slot>(source: T): T {
    const copy = { ...source }
    delete copy.trashTime
    return copy
}

function isCurrentStub(stub: Slot): boolean {
    return typeof stub.coldVersion === 'number' && stub.coldVersion >= COLD_STUB_VERSION
}

function hasTrustedChatCount(stub: Slot): boolean {
    return typeof stub.coldVersion === 'number' && stub.coldVersion >= COLD_STUB_CHAT_COUNT_VERSION
}

/**
 * Whether `slot` is a stub that is not up to date: a non-empty string
 * `coldstorage`, a `coldVersion` below `COLD_STUB_VERSION` or none (an older
 * archived character, whether the upstream application or an earlier version of
 * this one made it), and a `chaId` that may name a block and a unit (a non-empty
 * string without the `§` hidden-character prefix). `enrichLegacyStub` turns it
 * into a current stub.
 */
export function isLegacyStub(slot: unknown): boolean {
    if (typeof slot !== 'object' || slot === null) {
        return false
    }
    const cha = slot as Slot
    return typeof cha.coldstorage === 'string'
        && cha.coldstorage.length > 0
        && !isCurrentStub(cha)
        && typeof cha.chaId === 'string'
        && cha.chaId.length > 0
        && !cha.chaId.startsWith('§')
}

/**
 * The current stub for `stub`, an older stub (`isLegacyStub`), from
 * `unitCharacter`, the character its unit holds (the caller has checked the two `chaId`s match).
 * Returns a new object; neither argument is modified.
 *
 * From the unit it takes the real `type`, a group's member list, the chat
 * count, the bounded description and, for a character, its tags and resolved
 * creator. `lastInteraction` is the newer of the stub's and the unit's (a
 * put-back refreshes the stub, not the unit), so the upgrade never moves it
 * backwards. Every other field is the stub's own, `trashTime` included, present
 * or absent: the stub is authoritative for the trash state, and a unit's
 * `trashTime` copied onto a stub that has none would let the startup purge
 * delete the character on the same boot. A group's member list comes from the
 * unit, so a list remapped by duplicate-id repair reverts here exactly as it
 * does on restore. It never throws on odd saved data, as `buildColdStub` does
 * not.
 */
export function enrichLegacyStub<T extends Slot>(stub: T, unitCharacter: Slot): T {
    const enriched = { ...stub } as unknown as ColdStubFields
    enriched.type = unitCharacter.type === 'group' ? 'group' : 'character'
    enriched.creatorNotes = stubDescription(unitCharacter.creatorNotes)
    enriched.coldChatCount = Array.isArray(unitCharacter.chats) ? unitCharacter.chats.length : 0
    enriched.coldVersion = COLD_STUB_VERSION
    if (typeof unitCharacter.lastInteraction === 'number'
        && (typeof enriched.lastInteraction !== 'number' || unitCharacter.lastInteraction > enriched.lastInteraction)) {
        enriched.lastInteraction = unitCharacter.lastInteraction
    }
    if (unitCharacter.type === 'group') {
        enriched.characters = Array.isArray(unitCharacter.characters) ? [...unitCharacter.characters] : []
    } else {
        enriched.tags = stubTags(unitCharacter)
        enriched.creator = characterCreator(unitCharacter)
    }
    return enriched as unknown as T
}

/**
 * Gives the character restored from a unit the trash state of the stub it
 * replaces, and returns it. Only `trashTime` and `lastInteraction` are touched.
 *
 * Every stub is authoritative for the trash state, including its absence: a
 * trash applied to (or lifted from) the stub after the unit was written is the
 * state the user last saw, so a stub with a `trashTime` gives the restored
 * character that `trashTime` and a stub without one leaves it with none,
 * whatever the unit holds.
 *
 * `lastInteraction` keeps the newer of stub and unit: a stub whose value is
 * newer than the unit's (the stub was refreshed after the unit was written)
 * gives its value to the restored character, a unit without a numeric value
 * takes the stub's, and a stub value that is not a number leaves the unit's.
 */
export function applyStubStateOnRestore<T extends Slot>(stub: Slot, restored: T): T {
    if (stub.trashTime) {
        restored.trashTime = stub.trashTime
    } else {
        delete restored.trashTime
    }
    if (typeof stub.lastInteraction === 'number'
        && (typeof restored.lastInteraction !== 'number' || stub.lastInteraction > restored.lastInteraction)) {
        restored.lastInteraction = stub.lastInteraction
    }
    return restored
}

/**
 * Why a stub offered by a plugin may not go into the character list: the
 * character holding its `chaId` is already full (`live-full`), it is a stub
 * for another unit (`other-unit`), or no character holds the `chaId`
 * (`no-holder`).
 */
export type StubRefusal = 'live-full' | 'other-unit' | 'no-holder'

/**
 * Whether `incoming`, a character offered by a plugin, may take a place in the
 * character list, given `holders`, the characters in the list that hold its
 * `chaId`: null, or the reason it may not. Only a stub can be refused, and
 * only a stub that is not the same placeholder (same `chaId`, same unit key) as
 * one already in the list; that is what a plugin hands back after reading the
 * list. A full character is always allowed, even over a live stub.
 */
export function stubRefusal(holders: readonly Slot[], incoming: Slot): StubRefusal | null {
    if (!incoming?.coldstorage) {
        return null
    }
    if (holders.length === 0) {
        return 'no-holder'
    }
    if (holders.some((cha) => cha.coldstorage === incoming.coldstorage)) {
        return null
    }
    return holders.some((cha) => !cha.coldstorage) ? 'live-full' : 'other-unit'
}

/**
 * `incoming`, a character array offered by a plugin to replace `live`, with
 * every refused stub (`stubRefusal`) swapped for the live character it would
 * have displaced, or left out when none holds its `chaId`. The other elements
 * are untouched. Returns a new array and the refusals.
 *
 * `live` is indexed by `chaId` once, and only when `incoming` holds a stub, so
 * the cost is linear in both lists however many characters are archived.
 */
export function reconcileIncomingCharacters(live: readonly Slot[], incoming: readonly Slot[]): { characters: Slot[], refused: { chaId: string, reason: StubRefusal }[] } {
    const characters: Slot[] = []
    const refused: { chaId: string, reason: StubRefusal }[] = []
    let holdersByChaId: Map<string, Slot[]> | undefined
    for (const cha of incoming) {
        if (!cha?.coldstorage) {
            characters.push(cha)
            continue
        }
        if (!holdersByChaId) {
            holdersByChaId = new Map()
            for (const candidate of live) {
                if (!candidate) {
                    continue
                }
                const held = holdersByChaId.get(candidate.chaId)
                if (held) {
                    held.push(candidate)
                } else {
                    holdersByChaId.set(candidate.chaId, [candidate])
                }
            }
        }
        const holders = holdersByChaId.get(cha.chaId) ?? []
        const reason = stubRefusal(holders, cha)
        if (!reason) {
            characters.push(cha)
            continue
        }
        refused.push({ chaId: cha.chaId, reason })
        if (holders.length > 0) {
            characters.push(holders[0])
        }
    }
    return { characters, refused }
}

/**
 * The chat count a character list shows: the full character's count for a
 * stub built here (any `coldVersion` from `COLD_STUB_CHAT_COUNT_VERSION`),
 * `chats.length` for a full character and for a stub made by the upstream
 * application.
 */
export function coldStubChatCount(cha: Slot): number {
    if (cha.coldstorage && hasTrustedChatCount(cha) && typeof cha.coldChatCount === 'number') {
        return cha.coldChatCount
    }
    return cha.chats.length
}
