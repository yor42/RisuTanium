import type { Database, botPreset } from './database.svelte'

/**
 * Preset field locks (#149). A lock is a switch-time exemption held in the settings, never a value and never inside a
 * preset: while a group is locked, a preset switch does not read the group from the slot, and saving the working copy
 * into a slot leaves that slot's own value of the group as it is. The working copy stays the single live value.
 */

/** The three upstream lock flags. Each is the whole storage of one group, so the `.bin` carries it as upstream's field. */
export type LegacyLockFlag = 'doNotChangeSeperateModels' | 'doNotChangeFallbackModels' | 'disableSeperateParameterChangeOnPresetChange'

/** The settings fields that hold lock state: the flags and the fork-only list of the groups that have no upstream flag. */
export const PRESET_LOCK_FIELDS = [
    'doNotChangeSeperateModels', 'doNotChangeFallbackModels', 'disableSeperateParameterChangeOnPresetChange', 'presetFieldLocks',
] as const satisfies readonly (keyof Database)[]

/** The part of the settings the lock accessors read. Every member may be absent: absent means no lock. */
export type LockHost = Partial<Pick<Database, typeof PRESET_LOCK_FIELDS[number]>>

export interface LockGroup {
    /** Stable id; the order of `LOCK_GROUPS` is the order a page lists them. */
    id: string
    /** `flag`: held by an upstream boolean. `list`: held as a member of `presetFieldLocks`. */
    storage: { kind: 'flag', field: LegacyLockFlag } | { kind: 'list' }
    /** The preset slot keys the group covers: what the save side copies from the slot while locked. */
    slotKeys: readonly (keyof botPreset)[]
    /** The database keys `setPreset` writes for the group, where they differ from the slot keys. */
    dbKeys: readonly (keyof Database)[]
}

export const LOCK_GROUPS = [
    {
        id: 'auxModels',
        storage: { kind: 'flag', field: 'doNotChangeSeperateModels' },
        slotKeys: ['seperateModelsForAxModels', 'seperateModels'],
        dbKeys: ['seperateModelsForAxModels', 'seperateModels'],
    },
    {
        id: 'fallbackModels',
        storage: { kind: 'flag', field: 'doNotChangeFallbackModels' },
        slotKeys: ['fallbackModels', 'fallbackWhenBlankResponse'],
        dbKeys: ['fallbackModels', 'fallbackWhenBlankResponse'],
    },
    {
        id: 'separateParameters',
        storage: { kind: 'flag', field: 'disableSeperateParameterChangeOnPresetChange' },
        slotKeys: ['seperateParameters', 'seperateParametersEnabled'],
        dbKeys: ['seperateParameters', 'seperateParametersEnabled'],
    },
] as const satisfies readonly LockGroup[]

export type LockGroupId = typeof LOCK_GROUPS[number]['id']

/** Whether the group `id` is locked. An id the registry does not know is never locked. */
export function isLocked(host: LockHost, id: string, groups: readonly LockGroup[] = LOCK_GROUPS): boolean {
    const group = groups.find(item => item.id === id)
    if (group === undefined) {
        return false
    }
    if (group.storage.kind === 'flag') {
        return Boolean(host[group.storage.field])
    }
    const held = host.presetFieldLocks
    return Array.isArray(held) && held.includes(id)
}

/** The locked groups, in registry order. */
export function lockedGroups(host: LockHost, groups: readonly LockGroup[] = LOCK_GROUPS): LockGroup[] {
    return groups.filter(group => isLocked(host, group.id, groups))
}

/**
 * The list `presetFieldLocks` becomes when the group `id` is switched on or off. Reader rule: a member this build does
 * not know and a member that is not a string are kept untouched; a value that is not an array reads as no members and
 * is replaced by the list written here (it is left alone until a lock is changed, because this is only called then).
 * Writer rule: the known ids come first, in registry order and without duplicates, then every other member in its
 * original relative order.
 */
export function nextLockList(current: unknown, id: string, on: boolean, knownIds: readonly string[]): unknown[] {
    const members: unknown[] = Array.isArray(current) ? current : []
    const known = new Set<string>(knownIds)
    const wanted = new Set<string>(members.filter((member): member is string => typeof member === 'string' && known.has(member)))
    if (on) {
        wanted.add(id)
    } else {
        wanted.delete(id)
    }
    return [
        ...knownIds.filter(item => wanted.has(item)),
        ...members.filter(member => typeof member !== 'string' || !known.has(member)),
    ]
}

/** Switches the group `id` on or off. Returns whether anything was written (one write per call, none for a no-op). */
export function setLocked(host: LockHost, id: string, on: boolean, groups: readonly LockGroup[] = LOCK_GROUPS): boolean {
    const group = groups.find(item => item.id === id)
    if (group === undefined || isLocked(host, id, groups) === on) {
        return false
    }
    if (group.storage.kind === 'flag') {
        host[group.storage.field] = on
        return true
    }
    const knownIds = groups.filter(item => item.storage.kind === 'list').map(item => item.id)
    host.presetFieldLocks = nextLockList(host.presetFieldLocks, id, on, knownIds) as string[]
    return true
}
