import { v4 as uuidv4 } from 'uuid'
import type { Database, character } from '../../database.svelte'
import { applyStubStateOnRestore } from '../../../process/coldCharacter'
import {
    formatColdStorageLoadError, isRestorableColdStorageKey, mergeRetriedColdChatSideFields, type RetryLegacyColdChatSideFields,
} from '../../../process/coldstorageData'
import { DERIVED_COLD_FIELDS } from '../codec/bodies'
import { StubRefusedError } from '../codec/types'
import { legacyFirstMessageRef, legacyPluginRefs, legacyRefsOfCharacter, type LegacyRefKind } from './refs'

/**
 * Legacy tree to store2 tree. The legacy forms keep part of a profile outside
 * the main tree, behind four kinds of pointer: a character stub and its unit,
 * `coldStoragedChats`, a chat whose first message is a cold-storage pointer, and
 * the `_coldplugin` mapping of plugin storage. `resolveLegacyTree` reads those
 * units through an injected reader (the `.bin` entries on import, the store on
 * conversion) and returns a database the codec encodes: no stub, no pointer.
 *
 * Absence is not an error here. A unit that is missing or unusable becomes the
 * legacy load-error text (or a placeholder character) and is listed in
 * `incomplete` for the caller to show. A failure of the read itself aborts the
 * whole resolve, because it says nothing about whether the unit exists.
 */

/** What the reader found under one unit id. `unparsable`: an entry exists but its body is not JSON. */
export type LegacyUnitRead =
    | { status: 'ok', value: unknown }
    | { status: 'missing' }
    | { status: 'unparsable' }
    | { status: 'error', error: unknown }

export interface LegacyEntryReader {
    /** `key` is the bare unit id. A reader failure is `{status: 'error'}` or a rejection; both abort the caller. */
    read(key: string): Promise<LegacyUnitRead>
}

/** A unit could not be read (as opposed to being absent). */
export class LegacyReadError extends Error {
    constructor(public readonly key: string, public readonly kind: LegacyRefKind | 'unit', public readonly cause: unknown) {
        super(`The cold-storage unit ${key} could not be read.`)
        this.name = 'LegacyReadError'
    }
}

/**
 * Reads `key` through `reader`. A key that cannot be a storage name is never
 * offered to the reader and counts as missing. Both a rejection and an error
 * status become `LegacyReadError`.
 */
export async function readLegacyUnit(reader: LegacyEntryReader, key: string, kind: LegacyRefKind | 'unit'): Promise<Exclude<LegacyUnitRead, { status: 'error' }>> {
    if (!isRestorableColdStorageKey(key)) {
        return { status: 'missing' }
    }
    let result: LegacyUnitRead
    try {
        result = await reader.read(key)
    } catch (error) {
        throw new LegacyReadError(key, kind, error)
    }
    if (result.status === 'error') {
        throw new LegacyReadError(key, kind, result.error)
    }
    return result
}

export type IncompleteCharacterReason = 'missing' | 'unparsable' | 'shape' | 'mismatch'

/** Something the resolve could not bring in; the tree it returned holds the legacy text or placeholder instead. */
export type IncompleteItem =
    | { kind: 'character', chaId: string, name: string, key: string, reason: IncompleteCharacterReason }
    | { kind: 'chat', chaId: string, name: string, chatIndex: number, key: string, reason: 'missing' | 'invalid' }
    | { kind: 'plugin', slotKey: string, key: string, reason: 'missing' | 'collision' }

export interface ResolveOptions {
    /** Id of a placeholder character's chat; a v4 uuid by default. */
    newId?: () => string
    /** Time of a placeholder character's message; the clock by default. */
    now?: () => number
}

export interface ResolvedLegacyTree {
    database: Database
    incomplete: IncompleteItem[]
}

type Fields = Record<string, unknown>

function isFields(value: unknown): value is Fields {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function defineOwn(target: Fields, key: string, value: unknown): void {
    Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true })
}

function stringOr(value: unknown, fallback: string): string {
    return typeof value === 'string' ? value : fallback
}

/** The character a stub's unit holds, or why it cannot be used for this stub. */
function characterOfUnit(read: Exclude<LegacyUnitRead, { status: 'error' }>, stub: Fields): { character: Fields } | { reason: IncompleteCharacterReason } {
    if (read.status === 'missing') {
        return { reason: 'missing' }
    }
    if (read.status === 'unparsable') {
        return { reason: 'unparsable' }
    }
    const character = isFields(read.value) ? read.value.character : undefined
    if (!isFields(character)) {
        return { reason: 'shape' }
    }
    return character.chaId === stub.chaId ? { character } : { reason: 'mismatch' }
}

/** The character that stands for one whose unit cannot be used: the stub's own identity and one chat that says why. */
function placeholderCharacter(stub: Fields, key: string, options: Required<ResolveOptions>): Fields {
    const placeholder: Fields = {
        type: stub.type === 'group' ? 'group' : 'character',
        name: stringOr(stub.name, ''),
        chaId: stringOr(stub.chaId, ''),
    }
    for (const field of ['image', 'lastInteraction', 'trashTime']) {
        if (stub[field] !== undefined) {
            defineOwn(placeholder, field, stub[field])
        }
    }
    if (stub.type === 'group') {
        defineOwn(placeholder, 'characters', Array.isArray(stub.characters) ? [...stub.characters] : [])
    }
    defineOwn(placeholder, 'chats', [{
        id: options.newId(),
        message: [{ time: options.now(), data: formatColdStorageLoadError(key), role: 'char' }],
        note: '',
        name: '',
        localLore: [],
    }])
    defineOwn(placeholder, 'chatPage', 0)
    defineOwn(placeholder, 'firstMsgIndex', 0)
    return placeholder
}

const SIDE_FIELDS = ['hypaV2Data', 'hypaV3Data', 'scriptstate', 'localLore'] as const

/** The messages and side fields of a chat unit, or null when the unit is not a chat or its first message is a pointer again. */
function chatOfUnit(read: Exclude<LegacyUnitRead, { status: 'error' }>): { message: unknown[], side: Fields | null } | null {
    if (read.status !== 'ok') {
        return null
    }
    const value = read.value
    let message: unknown[]
    // A legacy bare message array carries no side fields and leaves the chat's own; an object unit sets all four, an absent one included.
    let side: Fields | null = null
    if (Array.isArray(value)) {
        message = value
    } else if (isFields(value) && Array.isArray(value.message)) {
        message = value.message
        side = {}
        for (const field of SIDE_FIELDS) {
            defineOwn(side, field, value[field])
        }
    } else {
        return null
    }
    // A pointer inside a unit is refused, never followed: a pointer must not reach the codec. Chains of load-error text are
    // resolved by `resolveChat`, which ends them with its visited set.
    if (legacyFirstMessageRef({ message })?.kind === 'chatPointer') {
        return null
    }
    return { message, side }
}

/**
 * The chat after its unit is read. A pointer chat takes the unit's side fields as a lazy load does (all four set, an
 * absent one cleared); a load-error chat merges them as the fork's retry does (`mergeRetriedColdChatSideFields`).
 * Null when that merge cannot be done, which leaves the chat as it was.
 */
function restoredChat(
    chat: Fields, tail: unknown[], unit: { message: unknown[], side: Fields | null }, kind: 'chatPointer' | 'errorText',
): Fields | null {
    const next: Fields = { ...chat, message: [...unit.message, ...tail] }
    if (unit.side === null) {
        return next
    }
    let fields: Fields = unit.side
    if (kind === 'errorText') {
        const dropped = (chat.message as unknown[])[0]
        const droppedId = isFields(dropped) && typeof dropped.chatId === 'string' ? dropped.chatId : undefined
        try {
            fields = mergeRetriedColdChatSideFields(
                chat as unknown as RetryLegacyColdChatSideFields, unit.side as unknown as RetryLegacyColdChatSideFields, droppedId,
            ) as unknown as Fields
        } catch {
            return null
        }
    }
    for (const field of SIDE_FIELDS) {
        if (fields[field] === undefined) {
            delete next[field]
        } else {
            defineOwn(next, field, fields[field])
        }
    }
    return next
}

/**
 * Resolves one chat from the unit its first message names. Each restore makes the messages `[...unit, ...previous tail]`,
 * and when the restored chat then starts with load-error text that is resolved the same way, so a chain of archived
 * chats resolves to its end. A key met twice for this chat, a unit that starts with a pointer, or a unit that is missing
 * or unusable at any depth stops the chain: the chat keeps the text it stopped at (a pointer never survives) with its
 * tail, and `failure` names the key that stopped it. A read error aborts the resolve.
 */
async function resolveChat(
    chat: Fields, first: { key: string, kind: 'chatPointer' | 'errorText' }, reader: LegacyEntryReader,
): Promise<{ chat: Fields, failure: { key: string, reason: 'missing' | 'invalid' } | null }> {
    let current = chat
    let step: { key: string, kind: 'chatPointer' | 'errorText' } | null = first
    const visited = new Set<string>()
    while (step !== null) {
        if (visited.has(step.key)) {
            return { chat: current, failure: { key: step.key, reason: 'invalid' } }
        }
        visited.add(step.key)
        const read = await readLegacyUnit(reader, step.key, step.kind)
        const unit = chatOfUnit(read)
        const next = unit === null ? null : restoredChat(current, (current.message as unknown[]).slice(1), unit, step.kind)
        if (next === null) {
            const messages = current.message as unknown[]
            // A pointer must not reach the codec; load-error text already is what the chat holds.
            const stopped = step.kind === 'chatPointer'
                ? { ...current, message: [{ ...(messages[0] as Fields), data: formatColdStorageLoadError(step.key) }, ...messages.slice(1)] }
                : current
            return { chat: stopped, failure: { key: step.key, reason: read.status === 'missing' ? 'missing' : 'invalid' } }
        }
        current = next
        const again = legacyFirstMessageRef(current)
        step = again?.kind === 'errorText' ? { key: again.key, kind: 'errorText' } : null
    }
    return { chat: current, failure: null }
}

async function resolveChats(
    character: Fields, characterIndex: number, reader: LegacyEntryReader, incomplete: IncompleteItem[],
): Promise<Fields> {
    if (!Array.isArray(character.chats)) {
        return character
    }
    const refs = legacyRefsOfCharacter(character, characterIndex).filter(ref => ref.kind === 'chatPointer' || ref.kind === 'errorText')
    if (refs.length === 0) {
        return character
    }
    const chats: unknown[] = [...character.chats]
    for (const ref of refs) {
        const chatIndex = ref.chatIndex as number
        const outcome = await resolveChat(chats[chatIndex] as Fields, { key: ref.key, kind: ref.kind as 'chatPointer' | 'errorText' }, reader)
        chats[chatIndex] = outcome.chat
        if (outcome.failure !== null) {
            incomplete.push({
                kind: 'chat',
                chaId: stringOr(character.chaId, ''),
                name: stringOr(character.name, ''),
                chatIndex,
                key: outcome.failure.key,
                reason: outcome.failure.reason,
            })
        }
    }
    return { ...character, chats }
}

function withoutColdFields(character: Fields): Fields {
    const copy: Fields = { ...character }
    for (const field of DERIVED_COLD_FIELDS) {
        delete copy[field]
    }
    return copy
}

/**
 * Resolves every pointer of `db` through `reader`. `db` is not modified: a
 * character or chat that changes is a new object. The result passes the
 * codec's stub and pointer checks, so it encodes without `StubRefusedError`.
 *
 * - A stub character takes its unit's character, with the stub's trash state
 *   (`applyStubStateOnRestore`); entity ids are not set here, the codec mints
 *   them. A missing, unparsable, differently shaped or other-character unit
 *   gives a placeholder holding one chat of the load-error text.
 * - `coldStoragedChats` only names units; it is dropped.
 * - A chat whose first message points at a unit takes the unit's messages
 *   (and side fields) before its tail. A missing or unusable unit replaces the
 *   pointer text by the load-error text for that key and keeps the tail.
 * - A chat whose first message is load-error text and whose unit is present
 *   resolves as the fork's retry does: messages restored, side fields merged by
 *   `mergeRetriedColdChatSideFields`, not listed. With the unit missing or
 *   unusable the text and tail stay and the chat is listed. A restored chat that
 *   again starts with load-error text is resolved again (see `resolveChat`).
 * - `_coldplugin` is kept as stored and each unit's value is placed under its
 *   unit id in plugin storage, where the codec makes it a per-key unit. The
 *   caller decides how resident those values are; the resolve holds them all.
 *   A value whose unit id is already a plain plugin storage key leaves the
 *   plain value and is listed as a collision.
 */
export async function resolveLegacyTree(db: Database, reader: LegacyEntryReader, options: ResolveOptions = {}): Promise<ResolvedLegacyTree> {
    const resolved: Required<ResolveOptions> = { newId: options.newId ?? uuidv4, now: options.now ?? Date.now }
    const incomplete: IncompleteItem[] = []
    const characters: unknown[] = []
    const source: unknown[] = Array.isArray(db.characters) ? db.characters : []
    for (let index = 0; index < source.length; index++) {
        const slot = source[index]
        if (!isFields(slot)) {
            characters.push(slot)
            continue
        }
        // Any truthy `coldstorage` is a stub, as in the codec; one that is not a unit id has no unit to read.
        const stubRef = legacyRefsOfCharacter(slot, index).find(ref => ref.kind === 'stub')
        if (stubRef !== undefined) {
            const unit = stubRef.key === '' ? { reason: 'shape' as const } : characterOfUnit(await readLegacyUnit(reader, stubRef.key, 'stub'), slot)
            if ('reason' in unit) {
                incomplete.push({ kind: 'character', chaId: stringOr(slot.chaId, ''), name: stringOr(slot.name, ''), key: stubRef.key, reason: unit.reason })
                characters.push(placeholderCharacter(slot, stubRef.key, resolved))
                continue
            }
            const restored = applyStubStateOnRestore(slot as unknown as character, withoutColdFields(unit.character) as unknown as character) as unknown as Fields
            characters.push(await resolveChats(restored, index, reader, incomplete))
            continue
        }
        characters.push(await resolveChats(withoutColdFields(slot), index, reader, incomplete))
    }

    let pluginCustomStorage = db.pluginCustomStorage
    const refs = legacyPluginRefs(db)
    if (refs.length > 0) {
        const storage: Fields = { ...(db.pluginCustomStorage as Fields) }
        const placed = new Set<string>()
        for (const ref of refs) {
            const read = await readLegacyUnit(reader, ref.key, 'plugin')
            if (read.status !== 'ok') {
                incomplete.push({ kind: 'plugin', slotKey: ref.slotKey as string, key: ref.key, reason: 'missing' })
            } else if (Object.hasOwn(storage, ref.key) && !placed.has(ref.key)) {
                incomplete.push({ kind: 'plugin', slotKey: ref.slotKey as string, key: ref.key, reason: 'collision' })
            } else {
                defineOwn(storage, ref.key, read.value)
                placed.add(ref.key)
            }
        }
        pluginCustomStorage = storage as unknown as Database['pluginCustomStorage']
    }

    const database = { ...db, characters, pluginCustomStorage } as unknown as Database
    assertResolved(database)
    return { database, incomplete }
}

/** The codec's own refusals, asked before the caller encodes: no stub and no pointer chat survives a resolve. */
function assertResolved(db: Database): void {
    const characters: unknown[] = db.characters
    for (const slot of characters) {
        if (!isFields(slot)) {
            continue
        }
        const chaId = stringOr(slot.chaId, '')
        if (slot.coldstorage) {
            throw new StubRefusedError('character', chaId, null)
        }
        if (Array.isArray(slot.chats)) {
            slot.chats.forEach((chat: unknown, index: number) => {
                if (legacyFirstMessageRef(chat)?.kind === 'chatPointer') {
                    throw new StubRefusedError('chat', chaId, index)
                }
            })
        }
    }
}
