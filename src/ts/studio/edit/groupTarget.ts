// The `group` session owner: the name, the order flag and the member list of one group chat, addressed by the group's
// chaId. A group's members live in three parallel arrays (`characters`, `characterTalks`, `characterActive`) whose index i
// describes one member; this adapter presents them as the one list `members` of rows `{ chaId, talk, active }`, and one
// insert, remove or set of that list is applied to all three arrays by one batch, verified as a whole before the first
// assignment. The history of this owner is memory-only, so nothing here records a step beyond what the owner service does.
// A group with arrays of unequal lengths, a non-array or a hole reads as no list at all: no member op is accepted for it
// and the arrays are never touched, because the engine reads them by index.

import { DBState } from '../../stores.svelte'
import { writeLiveCharacter } from '../../liveCharacterWrite'
import type { groupChat } from '../../storage/database.svelte'
import { isJsonObject } from '../../storage/store2/codec/normalize'
import type { FieldValue, LiveReader, WriteOp } from '../history/historyModel'
import type { ObjWrite } from '../history/objectListOps'
import { groupOwnerKey } from '../history/ownerPhase'
import { selectedStudioCharacterId, studioScreen } from '../studioScreen.svelte'
import type { SessionOwnerAdapter } from './sessionAdapters'

export { groupOwnerKey }

type PropertyBag = Record<string, unknown>

// The live group is read and assigned by property name: the three arrays may hold foreign data, so they are narrowed
// here at one boundary instead of being trusted through the group type.
function bagOf(holder: object): PropertyBag {
    return holder as PropertyBag
}

const MEMBERS = 'members'
const NAME = 'name'
const ORDER = 'orderByOrder'

// The first row of the database that holds the chaId, the one `writeLiveCharacter` writes, when it is a live group.
function liveGroupOf(chaId: string): groupChat | null {
    const characters = DBState.db.characters
    const found = chaId === '' || !Array.isArray(characters) ? undefined : characters.find((candidate) => candidate?.chaId === chaId)
    if (!found || found.type !== 'group' || found.coldstorage) {
        return null
    }
    return found
}

export interface MemberArrays {
    characters: unknown[]
    talks: unknown[]
    active: unknown[]
}

// The three arrays when they can be edited as one list: all arrays, one length, no hole. Never throws, never mutates.
// The reader, `check` and `write` all ask this one predicate.
export function membersReadable(group: object): MemberArrays | null {
    const bag = bagOf(group)
    const characters = bag.characters
    const talks = bag.characterTalks
    const active = bag.characterActive
    if (!Array.isArray(characters) || !Array.isArray(talks) || !Array.isArray(active)) {
        return null
    }
    const length: number = characters.length
    if (talks.length !== length || active.length !== length) {
        return null
    }
    for (let index = 0; index < length; index++) {
        if (!(index in characters) || !(index in talks) || !(index in active)) {
            return null
        }
    }
    return { characters, talks, active }
}

// A row as the history sees it: a fresh plain object; a key whose array element is `undefined` is left out, as a stored
// record leaves it out.
function rowOf(arrays: MemberArrays, index: number): Record<string, unknown> {
    const row: Record<string, unknown> = { chaId: arrays.characters[index] }
    if (arrays.talks[index] !== undefined) {
        row.talk = arrays.talks[index]
    }
    if (arrays.active[index] !== undefined) {
        row.active = arrays.active[index]
    }
    return row
}

function groupReader(id: string): LiveReader {
    return {
        field(path): FieldValue {
            const group = liveGroupOf(id)
            if (group === null) {
                return { had: false }
            }
            const value = bagOf(group)[path]
            if (path === NAME && typeof value === 'string') {
                return { had: true, value }
            }
            if (path === ORDER && typeof value === 'boolean') {
                return { had: true, value }
            }
            return { had: false }
        },
        greetings: () => null,
        fmIndex: () => null,
        objList(list) {
            const group = liveGroupOf(id)
            const arrays = list === MEMBERS && group !== null ? membersReadable(group) : null
            if (arrays === null) {
                return null
            }
            return arrays.characters.map((_chaId, index) => rowOf(arrays, index))
        },
    }
}

// The member ops of a batch: the insert, remove and set of the members list.
type MemberWrite = Exclude<ObjWrite, { op: 'propSet' }>

function isMembersWrite(write: WriteOp): write is MemberWrite {
    return (write.op === 'objInsert' || write.op === 'objRemove' || write.op === 'objSet') && write.list === MEMBERS
}

type GroupSet = { op: 'set'; path: typeof NAME | typeof ORDER; value: FieldValue }

function asGroupSet(write: WriteOp): GroupSet | null {
    return write.op === 'set' && (write.path === NAME || write.path === ORDER) ? { op: 'set', path: write.path, value: write.value } : null
}

// Whether a `set` can be assigned: a string name, a boolean flag, or the removal of the flag (an absent flag is a state
// of its own; an absent name is not).
function setAssignable(op: GroupSet): boolean {
    if (op.value.had === true) {
        return op.path === NAME ? typeof op.value.value === 'string' : typeof op.value.value === 'boolean'
    }
    return op.path === ORDER && op.value.had === false
}

function assignSet(group: PropertyBag, op: GroupSet): void {
    if (op.value.had === true) {
        group[op.path] = op.value.value
    } else {
        delete group[op.path]
    }
}

// A member write the batch can apply to a list of this length, with the length the next write sees; null when it cannot.
function simulateMember(write: MemberWrite, length: number): number | null {
    if (!Number.isInteger(write.index)) {
        return null
    }
    switch (write.op) {
        case 'objInsert':
            // A member is an object; any other element refuses the whole batch.
            return write.index >= 0 && write.index <= length && isJsonObject(write.entry) && typeof write.entry.chaId === 'string' && write.entry.chaId !== '' ? length + 1 : null
        case 'objRemove':
            return write.index >= 0 && write.index < length ? length - 1 : null
        case 'objSet': {
            if (write.index < 0 || write.index >= length) {
                return null
            }
            if (write.field !== 'talk' && write.field !== 'active') {
                return null
            }
            const value = write.value
            if (value.had === true && (write.field === 'talk' ? typeof value.value !== 'number' : typeof value.value !== 'boolean')) {
                return null
            }
            return length
        }
    }
}

function applyMember(arrays: MemberArrays, write: MemberWrite): void {
    switch (write.op) {
        case 'objInsert':
            if (!isJsonObject(write.entry)) {
                return
            }
            arrays.characters.splice(write.index, 0, write.entry.chaId)
            // A key the entry lacks inserts `undefined`, never a default: the row restores as it was recorded.
            arrays.talks.splice(write.index, 0, write.entry.talk)
            arrays.active.splice(write.index, 0, write.entry.active)
            return
        case 'objRemove':
            arrays.characters.splice(write.index, 1)
            arrays.talks.splice(write.index, 1)
            arrays.active.splice(write.index, 1)
            return
        case 'objSet': {
            const array = write.field === 'talk' ? arrays.talks : arrays.active
            array[write.index] = write.value.had === true ? write.value.value : undefined
            return
        }
    }
}

export const groupAdapter: SessionOwnerAdapter = {
    resolve(id) {
        if (id !== selectedStudioCharacterId() || id !== studioScreen.chaId) {
            return { ok: false, reason: 'not-selected' }
        }
        const holders = (DBState.db.characters ?? []).filter((candidate) => candidate?.chaId === id)
        // writeLiveCharacter writes the FIRST holder of a chaId, which may not be the selected one.
        if (holders.length > 1) {
            return { ok: false, reason: 'duplicate-id' }
        }
        const holder = holders[0]
        if (!holder || holder.type !== 'group' || holder.coldstorage) {
            return { ok: false, reason: 'gone' }
        }
        return { ok: true, target: { session: 'group', id, reader: groupReader(id) } }
    },
    // A members batch is refused whole when the arrays cannot be edited as one list. A batch with no members write is
    // answered without reading, copying or measuring the arrays, so a name edit stays possible on foreign data.
    check(id, writes) {
        if (!writes.some(isMembersWrite)) {
            return 'ok'
        }
        const group = liveGroupOf(id)
        if (group === null) {
            return 'ok'
        }
        return membersReadable(group) === null ? 'precondition' : 'ok'
    },
    // The whole batch is verified before the first assignment: `writeLiveCharacter`'s callback cannot veto, and it marks
    // the group for save after it ran.
    write(id, writes) {
        const group = liveGroupOf(id)
        if (group === null) {
            return false
        }
        const members = writes.some(isMembersWrite)
        let length = 0
        if (members) {
            const arrays = membersReadable(group)
            if (arrays === null) {
                return false
            }
            length = arrays.characters.length
        }
        for (const write of writes) {
            if (isMembersWrite(write)) {
                const next = simulateMember(write, length)
                if (next === null) {
                    return false
                }
                length = next
                continue
            }
            const op = asGroupSet(write)
            if (op === null || !setAssignable(op)) {
                return false
            }
        }
        return writeLiveCharacter(id, (target) => {
            const arrays = members ? membersReadable(target) : null
            for (const write of writes) {
                if (isMembersWrite(write)) {
                    if (arrays !== null) {
                        applyMember(arrays, write)
                    }
                    continue
                }
                const op = asGroupSet(write)
                if (op !== null) {
                    assignSet(bagOf(target), op)
                }
            }
        })
    },
}
