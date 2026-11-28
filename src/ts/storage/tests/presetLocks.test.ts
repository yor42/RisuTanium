// @vitest-environment happy-dom

/**
 * Preset field locks (#149, stage 1; MC-4811, MC-4812). The real `database.svelte` runs; only the modules its import
 * graph would start effects in are replaced (those of `retiredModelFlags.test.ts`).
 */
import { describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: {} },
    selectedCharID: writable(-1),
    selIdState: { selId: -1 },
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    downloadFile: vi.fn(),
    saveAsset: vi.fn(),
    readImage: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

import {
    appendWorkingSettingsPreset, changeToPreset, copyPreset, presetFromWorkingSettings, savedPresetFor, setPreset,
    type botPreset, type Database,
} from 'src/ts/storage/database.svelte'
import { repairBotPresetsId } from 'src/ts/storage/botPresetRepair'
import { DBState } from 'src/ts/stores.svelte'
import { PRESET_RECORD_FIELDS } from 'src/ts/storage/store2/fastForward/records'
import { LOCK_GROUPS, PRESET_LOCK_FIELDS, forkOnlyLockIds, isLocked, lockedGroups, nextLockList, setLocked, type LockGroup, type LockHost } from 'src/ts/storage/presetLocks'

type Loose = Record<string, unknown>

/** Per group: each slot key with the live (working) value and the slot's own value. */
const VALUES: Record<string, Record<string, [unknown, unknown]>> = {
    auxModels: {
        seperateModelsForAxModels: [true, false],
        seperateModels: [{ memory: 'live', emotion: '', translate: '', otherAx: '' }, { memory: 'slot', emotion: '', translate: '', otherAx: '' }],
    },
    fallbackModels: {
        fallbackModels: [{ memory: ['live'], emotion: [], translate: [], otherAx: [], model: [] }, { memory: ['slot'], emotion: [], translate: [], otherAx: [], model: [] }],
        fallbackWhenBlankResponse: [true, false],
    },
    separateParameters: {
        seperateParameters: [{ memory: { temperature: 1 }, emotion: {}, translate: {}, otherAx: {}, overrides: {} }, { memory: { temperature: 2 }, emotion: {}, translate: {}, otherAx: {}, overrides: {} }],
        seperateParametersEnabled: [true, false],
    },
}

const FLAG_OF: Record<string, string> = {
    auxModels: 'doNotChangeSeperateModels',
    fallbackModels: 'doNotChangeFallbackModels',
    separateParameters: 'disableSeperateParameterChangeOnPresetChange',
}

const GROUP_IDS = LOCK_GROUPS.map(group => group.id)

function liveOf(group: string): Loose {
    return Object.fromEntries(Object.entries(VALUES[group]).map(([key, [live]]) => [key, structuredClone(live)]))
}

function slotOf(group: string): Loose {
    return Object.fromEntries(Object.entries(VALUES[group]).map(([key, [, own]]) => [key, structuredClone(own)]))
}

/** A working database holding the live value of every group, with the locks in `locked` on. */
function working(locked: string[], extra: Loose = {}): Database {
    const db: Loose = { NAIsettings: {}, mainPrompt: 'live prompt', botPresets: [], botPresetsId: 0 }
    for (const id of GROUP_IDS) {
        Object.assign(db, liveOf(id))
    }
    for (const id of locked) {
        db[FLAG_OF[id]] = true
    }
    return { ...db, ...extra } as unknown as Database
}

function slotWith(name: string, groups: string[], extra: Loose = {}): botPreset {
    const slot: Loose = { name, mainPrompt: `${name} prompt` }
    for (const id of groups) {
        Object.assign(slot, slotOf(id))
    }
    return { ...slot, ...extra } as unknown as botPreset
}

function pick(source: object, keys: string[]): Loose {
    const record = source as Loose
    return Object.fromEntries(keys.map(key => [key, record[key]]))
}

function keysOf(group: string): string[] {
    return Object.keys(VALUES[group])
}

describe('L1 registry closure', () => {
    test('compatibility guard (passes before and after): every group field is a field setPreset assigns and a record field, in no two groups', () => {
        const written = new Set<string>()
        const db = new Proxy({ NAIsettings: {} } as Loose, {
            set(target, name, value) {
                written.add(String(name))
                target[String(name)] = value
                return true
            },
        })
        setPreset(db as unknown as Database, { name: 'p' } as botPreset)
        const seen = new Set<string>()
        for (const group of LOCK_GROUPS) {
            for (const key of group.dbKeys) {
                expect(written.has(key), `${group.id}.${key} is assigned by setPreset`).toBe(true)
                expect((PRESET_RECORD_FIELDS as readonly string[]).includes(key), `${group.id}.${key} is a record field`).toBe(true)
                expect(seen.has(key), `${key} is in two groups`).toBe(false)
                seen.add(key)
            }
            const built = presetFromWorkingSettings(working([]), 'x', '') as unknown as Loose
            for (const key of group.slotKeys) {
                expect(Object.hasOwn(built, key), `${group.id}.${key} is a preset slot key`).toBe(true)
            }
            expect(group.slotKeys.map(String).sort()).toEqual(keysOf(group.id).sort())
        }
    })

    test('the lock storage fields name the three upstream flags and the fork-only list; group ids are unique', () => {
        expect([...PRESET_LOCK_FIELDS]).toEqual([...Object.values(FLAG_OF), 'presetFieldLocks'].sort((a, b) => (a === 'presetFieldLocks' ? 1 : b === 'presetFieldLocks' ? -1 : 0)))
        expect(new Set(GROUP_IDS).size).toBe(GROUP_IDS.length)
    })
})

describe('L2 setPreset skips a locked group', () => {
    test.each(GROUP_IDS)('lock %s: on keeps the live value, off takes the slot value', (id) => {
        const slot = slotWith('S', [id])
        const locked = working([id])
        setPreset(locked, slot)
        expect(pick(locked, keysOf(id))).toEqual(liveOf(id))
        expect(locked.mainPrompt).toBe('S prompt')
        const open = working([])
        setPreset(open, slot)
        expect(pick(open, keysOf(id))).toEqual(slotOf(id))
    })

    test('a lock leaves the other groups to the switch', () => {
        const all = GROUP_IDS.slice()
        const slot = slotWith('S', all)
        const db = working([GROUP_IDS[0]])
        setPreset(db, slot)
        for (const id of GROUP_IDS.slice(1)) {
            expect(pick(db, keysOf(id))).toEqual(slotOf(id))
        }
    })
})

describe('L3 saving into a slot keeps a locked group the slot already holds', () => {
    test.each(GROUP_IDS)('regression reproducer (fails on base): lock %s on keeps the slot\'s own value; off writes the working value', (id) => {
        const slot = slotWith('S', [id])
        const saved = savedPresetFor(working([id]), slot) as unknown as Loose
        expect(pick(saved, keysOf(id))).toEqual(slotOf(id))
        expect(saved.mainPrompt).toBe('live prompt')
        const open = savedPresetFor(working([]), slot) as unknown as Loose
        expect(pick(open, keysOf(id))).toEqual(liveOf(id))
    })

    test.each(GROUP_IDS)('lock %s on: a slot that holds nothing of the group stays without it', (id) => {
        const saved = savedPresetFor(working([id]), slotWith('S', [])) as unknown as Loose
        for (const key of keysOf(id)) {
            expect(Object.hasOwn(saved, key)).toBe(false)
        }
    })

    test('the slot\'s identity and the other groups are saved as before', () => {
        const slot = slotWith('S', GROUP_IDS, { id: 'slot-id' })
        const saved = savedPresetFor(working([GROUP_IDS[0]]), slot) as unknown as Loose
        expect(saved.id).toBe('slot-id')
        expect(saved.name).toBe('S')
        for (const id of GROUP_IDS.slice(1)) {
            expect(pick(saved, keysOf(id))).toEqual(liveOf(id))
        }
    })

    test('the kept value is a copy, not the slot\'s own object', () => {
        const slot = slotWith('S', ['fallbackModels'])
        const saved = savedPresetFor(working(['fallbackModels']), slot)
        expect(saved.fallbackModels).toEqual(slot.fallbackModels)
        expect(saved.fallbackModels).not.toBe(slot.fallbackModels)
    })
})

/** Two presets that each hold their own value of every group, the working copy holding the live one. */
function twoPresets(locked: string[]): Database {
    const db = working(locked, { botPresets: [slotWith('A', GROUP_IDS, { id: 'a' }), slotWith('B', GROUP_IDS.map(id => id), { id: 'b' })], botPresetsId: 0 })
    // B's own values differ from A's, so a switch that loaded or wrote the wrong one shows.
    const b = (db as unknown as { botPresets: Loose[] }).botPresets[1]
    b.fallbackModels = { memory: ['B'], emotion: [], translate: [], otherAx: [], model: [] }
    b.seperateModels = { memory: 'B', emotion: '', translate: '', otherAx: '' }
    b.seperateParameters = { memory: { temperature: 3 }, emotion: {}, translate: {}, otherAx: {}, overrides: {} }
    return db
}

describe('L4 a round trip A, B, A', () => {
    test.each(GROUP_IDS)('regression: lock %s on leaves A\'s and B\'s own values intact and the live value unchanged', (id) => {
        const db = twoPresets([id])
        const a0 = structuredClone(pick((db as unknown as { botPresets: Loose[] }).botPresets[0], keysOf(id)))
        const b0 = structuredClone(pick((db as unknown as { botPresets: Loose[] }).botPresets[1], keysOf(id)))
        DBState.db = db
        changeToPreset(1)
        expect(pick(db, keysOf(id))).toEqual(liveOf(id))
        changeToPreset(0)
        expect(pick(db, keysOf(id))).toEqual(liveOf(id))
        const slots = db.botPresets as unknown as Loose[]
        expect(pick(slots[0], keysOf(id))).toEqual(a0)
        expect(pick(slots[1], keysOf(id))).toEqual(b0)
        expect(db.mainPrompt).toBe('live prompt')
    })

    test.each(GROUP_IDS)('lock %s off: the switch away writes the working value into A and the return takes it back', (id) => {
        const db = twoPresets([])
        DBState.db = db
        changeToPreset(1)
        changeToPreset(0)
        const slots = db.botPresets as unknown as Loose[]
        expect(pick(slots[0], keysOf(id))).toEqual(liveOf(id))
    })
})

describe('L6 reader and writer rule of the lock list', () => {
    const KNOWN = ['sampling', 'reasoning']
    const groups: LockGroup[] = [
        ...LOCK_GROUPS,
        { id: 'sampling', storage: { kind: 'list' }, slotKeys: ['temperature'], dbKeys: ['temperature'] },
        { id: 'reasoning', storage: { kind: 'list' }, slotKeys: ['thinkingType'], dbKeys: ['thinkingType'] },
    ]

    test('the reader applies a known id and no lock for an unknown id, a non-string member or a non-array', () => {
        expect(isLocked({ presetFieldLocks: ['reasoning'] }, 'reasoning', groups)).toBe(true)
        expect(isLocked({ presetFieldLocks: ['future', 7, null] as unknown as string[] }, 'reasoning', groups)).toBe(false)
        expect(isLocked({ presetFieldLocks: 'sampling' as unknown as string[] }, 'sampling', groups)).toBe(false)
        expect(isLocked({}, 'sampling', groups)).toBe(false)
        expect(isLocked({ presetFieldLocks: ['future'] }, 'future', groups)).toBe(false)
        expect(lockedGroups({ doNotChangeFallbackModels: true, presetFieldLocks: ['reasoning', 'x'] }, groups).map(group => group.id)).toEqual(['fallbackModels', 'reasoning'])
    })

    test('the writer puts the known ids first in registry order, then every other member in its original order', () => {
        expect(nextLockList(['future', 'reasoning', 7, 'sampling', 'other'], 'sampling', false, KNOWN)).toEqual(['reasoning', 'future', 7, 'other'])
        expect(nextLockList(['z', 'reasoning', null], 'sampling', true, KNOWN)).toEqual(['sampling', 'reasoning', 'z', null])
        expect(nextLockList(['reasoning', 'sampling', 'reasoning', 'sampling'], 'reasoning', true, KNOWN)).toEqual(['sampling', 'reasoning'])
        expect(nextLockList(['future', 7], 'sampling', true, KNOWN)).toEqual(['sampling', 'future', 7])
    })

    test('a non-array value is read as no lock and is left in place until a lock is changed', () => {
        const host: LockHost = { presetFieldLocks: 'oops' as unknown as string[] }
        expect(setLocked(host, 'sampling', false, groups)).toBe(false)
        expect(host.presetFieldLocks).toBe('oops')
        expect(setLocked(host, 'sampling', true, groups)).toBe(true)
        expect(host.presetFieldLocks).toEqual(['sampling'])
    })

    test('a toggle writes the list once and keeps unknown members; a no-op writes nothing', () => {
        const host: LockHost = { presetFieldLocks: ['future', 7 as unknown as string] }
        const writes = vi.fn()
        const watched = new Proxy(host, { set(target, name, value) { writes(name); Reflect.set(target, name, value); return true } })
        expect(setLocked(watched, 'reasoning', true, groups)).toBe(true)
        expect(writes).toHaveBeenCalledTimes(1)
        expect(host.presetFieldLocks).toEqual(['reasoning', 'future', 7])
        expect(setLocked(watched, 'reasoning', true, groups)).toBe(false)
        expect(setLocked(watched, 'nonsense', true, groups)).toBe(false)
        expect(writes).toHaveBeenCalledTimes(1)
    })

    test('a legacy group is held by its upstream flag, never by the list', () => {
        const host: LockHost = { presetFieldLocks: ['future'] }
        expect(setLocked(host, 'fallbackModels', true, groups)).toBe(true)
        expect(host.doNotChangeFallbackModels).toBe(true)
        expect(host.presetFieldLocks).toEqual(['future'])
        expect(setLocked(host, 'fallbackModels', false, groups)).toBe(true)
        expect(host.doNotChangeFallbackModels).toBe(false)
    })
})

describe('L13 a preset created from the working settings takes the working values of every group', () => {
    test.each(GROUP_IDS)('appendWorkingSettingsPreset with lock %s on (regression for auxModels only; guard for the others)', (id) => {
        const db = working([id], { botPresets: [slotWith('A', GROUP_IDS)] })
        appendWorkingSettingsPreset(db)
        const created = (db.botPresets as unknown as Loose[])[1]
        expect(pick(created, keysOf(id))).toEqual(liveOf(id))
        expect(db.botPresetsId).toBe(1)
    })

    test.each(GROUP_IDS)('the botPresetsId repair with lock %s on (regression for auxModels only; guard for the others)', (id) => {
        const db = working([id], { botPresets: [slotWith('A', GROUP_IDS)], botPresetsId: 9 })
        expect(repairBotPresetsId(db)).toBe(true)
        const created = (db.botPresets as unknown as Loose[])[1]
        expect(pick(created, keysOf(id))).toEqual(liveOf(id))
    })
})

describe('L14 copyPreset clones the source slot', () => {
    test.each(GROUP_IDS)('compatibility guard (passes before and after): lock %s on, the copy of another preset and of the active one', (id) => {
        const db = twoPresets([id])
        DBState.db = db
        const slots = db.botPresets as unknown as Loose[]
        const b0 = structuredClone(pick(slots[1], keysOf(id)))
        copyPreset(1)
        expect(pick(slots[2], keysOf(id))).toEqual(b0)
        const a0 = structuredClone(pick(slots[0], keysOf(id)))
        copyPreset(0)
        expect(pick(slots[3], keysOf(id))).toEqual(a0)
    })
})

describe('L15 unlocking', () => {
    test('diagnostic: a slot saved while unlocked holds that time\'s value, and the next switch loads it', () => {
        const db = twoPresets([])
        DBState.db = db
        changeToPreset(1)
        // A now holds the live fallback of the moment it was left. Lock, change the live value, unlock, return.
        Reflect.set(db, 'doNotChangeFallbackModels', true)
        Reflect.set(db, 'fallbackModels', { memory: ['changed while locked'], emotion: [], translate: [], otherAx: [], model: [] })
        Reflect.set(db, 'doNotChangeFallbackModels', false)
        changeToPreset(0)
        expect(db.fallbackModels.memory).toEqual(['live'])
    })
})

describe('L1b the lock list is not a record field', () => {
    test('compatibility guard: no lock storage field is written by setPreset', () => {
        for (const field of PRESET_LOCK_FIELDS) {
            expect((PRESET_RECORD_FIELDS as readonly string[]).includes(field)).toBe(false)
        }
    })
})

describe('forkOnlyLockIds (stage 2)', () => {
    test('returns the string members in list order, and nothing for an absent or non-array list', () => {
        expect(forkOnlyLockIds({ presetFieldLocks: ['sampling', 7 as unknown as string, 'reasoning'] })).toEqual(['sampling', 'reasoning'])
        expect(forkOnlyLockIds({})).toEqual([])
        expect(forkOnlyLockIds({ presetFieldLocks: 'sampling' as unknown as string[] })).toEqual([])
    })
})
