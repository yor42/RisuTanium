// @vitest-environment happy-dom
import { describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import type { JsonObject } from '../../blockFrame'

// The real `setPreset` and `savedPresetFor` run (the functions the page host binds); only the modules their import graph
// would start effects in are replaced.
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

import { presetFromWorkingSettings, savedPresetFor, setPreset, type botPreset, type Database } from '../../database.svelte'
import { toPlainJson } from '../../store2/codec'
import { PRESET_LOCK_FIELDS } from '../../presetLocks'
import { PRESET_RECORD_FIELDS, cleanSwitch, decideSwitch, type SwitchOps, type SwitchSide } from '../../store2/fastForward/records'

function asDb(value: object): Database {
    return value as unknown as Database
}

function plain(value: unknown): JsonObject {
    const out = toPlainJson(value)
    if (typeof out !== 'object' || out === null || Array.isArray(out)) {
        throw new Error('not an object')
    }
    return out
}

function pickFields(source: JsonObject, names: readonly string[]): JsonObject {
    const out: JsonObject = {}
    for (const name of names) {
        if (Object.hasOwn(source, name)) {
            out[name] = source[name]
        }
    }
    return out
}

/** The page host's preset operations (`fastForward/index.ts` presetOps), over the real database functions. */
const OPS: SwitchOps = {
    saveInto: (working, slot) => plain(savedPresetFor(asDb(structuredClone(working)), structuredClone(slot) as unknown as botPreset)),
    apply: (working, slot) => {
        const copy = structuredClone(working) as Record<string, unknown>
        setPreset(asDb(copy), structuredClone(slot) as unknown as botPreset)
        return plain(copy)
    },
}

const FALLBACK = (name: string) => ({ memory: [name], emotion: [], translate: [], otherAx: [], model: [] })

/** Three presets with different prompts and fallbacks; the working copy holds a live fallback of its own. */
function fixture(locks: JsonObject) {
    const slots: JsonObject[] = [0, 1, 2].map(index => plain({
        ...presetFromWorkingSettings(asDb({ NAIsettings: {}, mainPrompt: `prompt ${index}`, fallbackModels: FALLBACK(`slot ${index}`) }), `Preset ${index}`, ''),
        NAISettings: {},
    }))
    const seed: JsonObject = { NAIsettings: {}, mainPrompt: 'seed', fallbackModels: FALLBACK('live'), ...locks }
    const working = pickFields(OPS.apply(seed, slots[0]), PRESET_RECORD_FIELDS)
    const base: SwitchSide = { list: slots, id: 0, working, locks: pickFields(locks, PRESET_LOCK_FIELDS) }
    return { slots, base }
}

/** One selection change from `from`, made by a page whose lock state is `locks` (the page's own settings, not the base's). */
function switched(from: SwitchSide, to: number, locks: JsonObject): SwitchSide {
    const list = [...from.list]
    list[from.id as number] = OPS.saveInto({ ...from.working, ...locks }, list[from.id as number] as JsonObject)
    const working = pickFields(OPS.apply({ ...from.working, ...locks }, list[to] as JsonObject), PRESET_RECORD_FIELDS)
    return { list, id: to, working, locks: pickFields(locks, PRESET_LOCK_FIELDS) }
}

const LOCKED: JsonObject = { doNotChangeFallbackModels: true }

describe('L5 the fast-forward switch check under a lock', () => {
    test('compatibility guard: with every lock on, the writes of setPreset are a subset of the record fields', () => {
        for (const field of ['doNotChangeSeperateModels', 'doNotChangeFallbackModels', 'disableSeperateParameterChangeOnPresetChange']) {
            const written = new Set<string>()
            const db = new Proxy({ NAIsettings: {}, [field]: true } as Record<string, unknown>, {
                set(target, name, value) {
                    written.add(String(name))
                    target[String(name)] = value
                    return true
                },
            })
            setPreset(asDb(db), { name: 'p' } as botPreset)
            expect([...written].every(name => (PRESET_RECORD_FIELDS as readonly string[]).includes(name))).toBe(true)
        }
    })

    test('a lock on and both pages switching cleanly to different presets keeps', () => {
        const { base } = fixture(LOCKED)
        const mine = switched(base, 1, LOCKED)
        const theirs = switched(base, 2, LOCKED)
        // The lock mattered: the slot left keeps its own fallback and the live one survives the switch.
        expect((mine.list[0] as JsonObject).fallbackModels).toEqual(FALLBACK('slot 0'))
        expect(mine.working.fallbackModels).toEqual(FALLBACK('live'))
        expect(cleanSwitch(mine, base, OPS)).toBe(true)
        expect(decideSwitch(base, mine, theirs, OPS)).toEqual({ kind: 'keep' })
        expect(decideSwitch(base, theirs, mine, OPS)).toEqual({ kind: 'keep' })
    })

    test('regression: a switch made under a lock is not recognised by a side that reports no lock state (guards the lock-equality check)', () => {
        const { base } = fixture(LOCKED)
        const mine = switched(base, 1, LOCKED)
        expect(cleanSwitch({ ...mine, locks: undefined }, base, OPS)).toBe(false)
    })

    test('the lock state differing between the pages parks (also covered by the no-lock-state case above)', () => {
        const { base } = fixture(LOCKED)
        const lockedHere = switched(base, 1, LOCKED)
        const unlockedThere = switched(base, 2, { doNotChangeFallbackModels: false })
        expect(cleanSwitch(unlockedThere, base, OPS)).toBe(false)
        expect(decideSwitch(base, lockedHere, unlockedThere, OPS).kind).toBe('park')
        expect(decideSwitch(base, unlockedThere, lockedHere, OPS).kind).toBe('park')
    })

    test('a lock toggled on one page alone is not a preset-record change', () => {
        const { base } = fixture(LOCKED)
        const toggled: SwitchSide = { ...base, locks: { doNotChangeFallbackModels: false } }
        expect(decideSwitch(base, toggled, base, OPS)).toEqual({ kind: 'keep' })
        expect(decideSwitch(base, base, toggled, OPS)).toEqual({ kind: 'keep' })
    })

    test('with no lock the check is as before: both clean switches keep, a hand edit parks', () => {
        const { base } = fixture({})
        const mine = switched(base, 1, {})
        const theirs = switched(base, 2, {})
        expect(decideSwitch(base, mine, theirs, OPS)).toEqual({ kind: 'keep' })
        expect(decideSwitch(base, { ...base, working: { ...base.working, mainPrompt: 'hand' } }, theirs, OPS).kind).toBe('park')
    })
})
