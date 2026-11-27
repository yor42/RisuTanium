import type { character, groupChat } from "../storage/database.svelte";
import { isUsableCharacterId } from "../storage/characterIds";

/** The colour slots a group hands out (DD-064). */
export const GROUP_MEMBER_SLOTS = 8

export type GroupMemberRecord = {
    name: string
    slot: number
}

const UNKNOWN_MEMBER_NAME = 'Unknown Character'

function isPlainMap(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isValidRecord(value: unknown): value is GroupMemberRecord {
    if(!isPlainMap(value)){
        return false
    }
    if(!Object.hasOwn(value, 'name') || !Object.hasOwn(value, 'slot')){
        return false
    }
    const slot = value.slot
    return typeof value.name === 'string'
        && typeof slot === 'number' && Number.isInteger(slot) && slot >= 0 && slot < GROUP_MEMBER_SLOTS
}

/** The group's own member map when it is a plain object; absent and malformed both read as null. */
function memberMap(group: { risutanium_members?: unknown }): Record<string, unknown> | null {
    if(!Object.hasOwn(group, 'risutanium_members')){
        return null
    }
    const map = group.risutanium_members
    return isPlainMap(map) ? map : null
}

/** The group's own valid record for an id, or null. Inherited values never resolve as a record. */
export function memberRecord(group: { risutanium_members?: unknown }, id: unknown): GroupMemberRecord | null {
    if(typeof id !== 'string' && typeof id !== 'number'){
        return null
    }
    const map = memberMap(group)
    if(map === null){
        return null
    }
    const key = String(id)
    if(!Object.hasOwn(map, key)){
        return null
    }
    const record = map[key]
    return isValidRecord(record) ? record : null
}

/** The live non-group character with this chaId: the same predicate findCharacterbyId uses. */
export function liveMember(characters: readonly (character | groupChat)[], id: string): character | null {
    for(const char of characters){
        if(char.type !== 'group' && char.chaId === id){
            return char
        }
    }
    return null
}

/**
 * The display name of a group member: the live character, else the owner's
 * record (only a group has one), else "Unknown Character". For a non-group
 * owner or an id with no record this is findCharacterbyId(id).name.
 */
export function memberName(characters: readonly (character | groupChat)[], owner: character | groupChat | null | undefined, id: string): string {
    const live = liveMember(characters, id)
    if(live){
        return live.name
    }
    if(owner && owner.type === 'group'){
        const record = memberRecord(owner, id)
        if(record){
            return record.name
        }
    }
    return UNKNOWN_MEMBER_NAME
}

/**
 * The slot a joining member takes. The joining id's own earlier record is left
 * out of the count: a rejoin must not find its old slot held by itself.
 */
function slotFor(group: groupChat, id: string, previous: GroupMemberRecord | null): number {
    const held: number[] = new Array(GROUP_MEMBER_SLOTS).fill(0)
    for(const member of new Set(group.characters)){
        if(member === id){
            continue
        }
        const record = memberRecord(group, member)
        if(record){
            held[record.slot] += 1
        }
    }
    if(previous && held[previous.slot] === 0){
        return previous.slot
    }
    const free = held.indexOf(0)
    if(free !== -1){
        return free
    }
    return held.indexOf(Math.min(...held))
}

/**
 * Writes the join record of a member that was just added to `group.characters`.
 * It writes by plain assignment, which a Svelte state proxy accepts. A malformed
 * map is left as it is and no record is written into it.
 */
export function joinRecord(group: groupChat, id: unknown, name: string): void {
    if(!isUsableCharacterId(id)){
        return
    }
    const key = String(id)
    let map: Record<string, unknown> | null = null
    if(Object.hasOwn(group, 'risutanium_members') && group.risutanium_members !== undefined){
        map = memberMap(group)
        if(map === null){
            return
        }
    }
    const record: GroupMemberRecord = {
        name,
        slot: slotFor(group, key, map ? memberRecord(group, key) : null),
    }
    if(map === null){
        group.risutanium_members = { [key]: record }
        return
    }
    map[key] = record
}

/** The map with its keys remapped: a new object when a key changes, else the same one. */
export function remapMemberKeys(map: unknown, remaps: ReadonlyMap<string, string>): unknown {
    if(!isPlainMap(map)){
        return map
    }
    const keys = Object.keys(map)
    if(!keys.some((key) => remaps.has(key))){
        return map
    }
    const next: Record<string, unknown> = {}
    for(const key of keys){
        Object.defineProperty(next, remaps.get(key) ?? key, {
            value: map[key],
            writable: true,
            enumerable: true,
            configurable: true,
        })
    }
    return next
}
