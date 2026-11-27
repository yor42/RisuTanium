// Shared by the group member tests: groups shaped like the producer (`createNewGroup` in characters.ts, members appended
// in the order classic's `addGroupChar` writes them), archived stubs, loaded characters and the splices classic's
// `rmCharFromGroup` and `addGroupChar` perform outside Studio. Each test file keeps its own `vi.mock` of the store and the
// save-mark counter, because a mock is per file.

import { DBState } from 'src/ts/stores.svelte'
import type { LiveReader } from '../historyModel'
import type { ObjDraft } from '../objectListOps'
import type { ObjBuildResult } from '../ownerHistory.svelte'

export const GROUP_ID = 'G'

export interface MemberFixture {
    chaId: string
    talk: number
    active: boolean
}

export interface GroupFixture {
    type: 'group'
    chaId: string
    name: string
    characters: string[]
    characterTalks: number[]
    characterActive: boolean[]
    orderByOrder?: boolean
    chatPage: number
    chats: { id: string; message: { role: string; data: string; saying?: string }[]; note: string; name: string; localLore: unknown[] }[]
}

// Talk values are the sixths the form offers.
export const sixths = (n: number): number => n / 6

export function member(chaId: string, talk: number, active = true): MemberFixture {
    return { chaId, talk, active }
}

// The default group of the tests: three loaded members with distinct talks and active flags.
export const DEFAULT_MEMBERS: readonly MemberFixture[] = [member('A', sixths(1), true), member('B', sixths(2), false), member('C', sixths(3), true)]

export function makeGroup(members: readonly MemberFixture[] = DEFAULT_MEMBERS, extra: Partial<GroupFixture> = {}): GroupFixture {
    return {
        type: 'group',
        chaId: GROUP_ID,
        name: 'Group',
        characters: members.map((entry) => entry.chaId),
        characterTalks: members.map((entry) => entry.talk),
        characterActive: members.map((entry) => entry.active),
        chatPage: 0,
        chats: [{ id: 'chat1', message: [{ role: 'char', data: 'hello', saying: 'A' }], note: '', name: 'Chat 1', localLore: [] }],
        ...extra,
    }
}

export function loadedCharacter(chaId: string): Record<string, unknown> {
    return { type: 'character', chaId, name: `Name ${chaId}`, firstMessage: `first ${chaId}`, chats: [], chatPage: 0 }
}

// An archived character as the cold store leaves it: a stub that names its unit and holds none of the character's data.
export function archivedStub(chaId: string): Record<string, unknown> {
    return { type: 'character', chaId, name: `Name ${chaId}`, coldstorage: `cold-${chaId}` }
}

export function putWorld(rows: readonly unknown[]): void {
    DBState.db.characters = [...rows] as unknown as typeof DBState.db.characters
}

export function liveGroup(): GroupFixture {
    const found = (DBState.db.characters as unknown as { chaId: string }[]).find((candidate) => candidate.chaId === GROUP_ID)
    if (!found) {
        throw new Error('the group fixture is not in the database')
    }
    return found as unknown as GroupFixture
}

export interface Arrays {
    characters: unknown[]
    talks: unknown[]
    active: unknown[]
}

// Plain copies of the three arrays as they are now.
export function arraysOf(): Arrays {
    const group = liveGroup()
    return { characters: Array.from(group.characters), talks: Array.from(group.characterTalks), active: Array.from(group.characterActive) }
}

// Replaces one live property by foreign data, as a hand-edited or plugin-written group could hold.
export function corrupt(key: 'characters' | 'characterTalks' | 'characterActive', value: unknown): void {
    ;(liveGroup() as unknown as Record<string, unknown>)[key] = value
}

// What `rmCharFromGroup` does, without the selection.
export function removeOutsideStudio(index: number): void {
    const group = liveGroup()
    group.characters.splice(index, 1)
    group.characterTalks.splice(index, 1)
    group.characterActive.splice(index, 1)
}

// What `addGroupChar` does at the end, at an index here.
export function insertOutsideStudio(index: number, entry: MemberFixture): void {
    const group = liveGroup()
    group.characters.splice(index, 0, entry.chaId)
    group.characterTalks.splice(index, 0, entry.talk)
    group.characterActive.splice(index, 0, entry.active)
}

// A builder that hands the service raw drafts of the `members` list, for the cases the real builders refuse first.
export function draftBuild(drafts: ObjDraft[], action: 'add' | 'delete' | 'edit' = 'edit', field?: string): (id: string, live: LiveReader) => ObjBuildResult {
    return () => ({ ok: true, label: { kind: 'obj', list: 'members', action, name: null, ...(field === undefined ? {} : { field }) }, drafts, coalesceKey: null })
}
