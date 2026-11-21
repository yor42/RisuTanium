import { describe, test, expect, vi } from 'vitest'
import { writable } from 'svelte/store'
import {
    EXCLUDED_FIELDS, PRESET_DB_ALIASES, PRESET_FIELD_RULE, PRESET_OMITTED_SOURCE_FIELDS, SETTINGS_FIELDS, SETTINGS_FIELD_RULES,
    presetDbName, type FieldRule,
} from 'src/ts/drive/rtb/settingsFields'
import { checkField, rebuildJson } from 'src/ts/drive/rtb/settingsPayload'
import { SECRET_FIELDS } from 'src/ts/secretFields'
import { SHARE_ENDPOINT_FIELDS } from 'src/ts/shareStrip'
import { PRESET_RECORD_FIELDS } from 'src/ts/storage/store2/fastForward/records'
import { realisticDb } from './settingsTestKit'

// The real setDatabase and presetFromWorkingSettings run; only the modules whose import graph would start effects
// (the reactive stores and the global API) are replaced by plain stand-ins.
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

/** The kind a JSON value has under the field model. */
function kindOf(value: unknown): string {
    if (Array.isArray(value)) return 'array'
    if (value === null) return 'null'
    return typeof value
}

describe('T6 (guard): the field model against the real database', () => {
    const db = realisticDb()
    const record = db as unknown as Record<string, unknown>

    test('the allowlist and the exclusion list are disjoint and the allowlist has no repeats', () => {
        expect(new Set(SETTINGS_FIELDS).size).toBe(SETTINGS_FIELDS.length)
        const allowed = new Set<string>(SETTINGS_FIELDS)
        expect(EXCLUDED_FIELDS.filter((name) => allowed.has(name))).toEqual([])
    })

    test('no credential field of the database is allowlisted, and every credential is excluded', () => {
        const allowed = new Set<string>(SETTINGS_FIELDS)
        const credentials = SECRET_FIELDS
            .filter((entry) => entry.scope === 'database' && !('notCredential' in entry))
            .map((entry) => entry.field)
        expect(credentials.length).toBeGreaterThan(20)
        expect(credentials.filter((name) => allowed.has(name))).toEqual([])
        const excluded = new Set<string>(EXCLUDED_FIELDS)
        expect(credentials.filter((name) => !excluded.has(name))).toEqual([])
    })

    test('a look-alike flagged notCredential is not excluded for that reason alone', () => {
        const lookAlikes = SECRET_FIELDS.filter((entry) => entry.scope === 'database' && 'notCredential' in entry).map((entry) => entry.field)
        expect(lookAlikes).toContain('customTokenizer')
        expect(lookAlikes).toContain('hotkeys')
        const excluded = new Set<string>(EXCLUDED_FIELDS)
        expect(excluded.has('customTokenizer')).toBe(false)
        expect(excluded.has('hotkeys')).toBe(false)
        expect(new Set<string>(SETTINGS_FIELDS).has('customTokenizer')).toBe(true)
    })

    test('every endpoint field the share strip blanks is a preset omit rule or off the allowlist', () => {
        const allowed = new Set<string>(SETTINGS_FIELDS)
        for (const { field: name } of SHARE_ENDPOINT_FIELDS) {
            const rule = (PRESET_FIELD_RULE as Record<string, FieldRule | 'omit' | 'meta' | undefined>)[name]
            if (rule !== undefined) {
                expect(rule, `preset ${name}`).toBe('omit')
            }
            expect(allowed.has(name), `allowlisted ${name}`).toBe(false)
        }
    })

    test('the credential and endpoint preset fields are omit', () => {
        for (const entry of SECRET_FIELDS) {
            if (entry.scope === 'botPreset' && !('notCredential' in entry)) {
                expect(PRESET_FIELD_RULE[entry.field], `preset ${String(entry.field)}`).toBe('omit')
            }
        }
        for (const name of PRESET_OMITTED_SOURCE_FIELDS) {
            expect(new Set<string>(SETTINGS_FIELDS).has(name), name).toBe(false)
        }
    })

    test('each defined non-null default of the real database passes its kind', () => {
        const failures: string[] = []
        for (const name of SETTINGS_FIELDS) {
            const value = record[name]
            if (value === undefined || value === null) continue
            const checked = checkField(name, value)
            if (checked.ok === false) failures.push(`${name}: ${checked.reason} (${kindOf(value)})`)
        }
        expect(failures).toEqual([])
    })

    test('the nullable top-level fields are exactly the ones the producers store as null', () => {
        const nullable = (Object.entries(SETTINGS_FIELD_RULES) as [string, FieldRule][]).filter(([, rule]) => rule.nullable).map(([name]) => name).sort()
        expect(nullable).toEqual(['dynamicOutput', 'localStopStrings', 'promptTemplate', 'thinkingTokens'])
        for (const name of ['NAIsettings', 'promptSettings', 'reverseProxyOobaArgs', 'seperateModels']) {
            expect(checkField(name, null).ok, name).toBe(false)
        }
        for (const name of nullable) {
            expect(checkField(name, null).ok, name).toBe(true)
        }
    })

    test('the preset rule has the kind of the database field it is written to, under the aliases', () => {
        expect(PRESET_DB_ALIASES).toEqual({ NAISettings: 'NAIsettings', regex: 'presetRegex', reasonEffort: 'reasoningEffort' })
        for (const [field, rule] of Object.entries(PRESET_FIELD_RULE)) {
            if (rule === 'omit' || rule === 'meta') continue
            const dbRule = (SETTINGS_FIELD_RULES as Record<string, FieldRule | undefined>)[presetDbName(field)]
            expect(dbRule, `database field of preset ${field}`).toBeDefined()
            expect(rule.kind, field).toBe(dbRule?.kind)
        }
    })

    test('the working preset fields are the preset record fields minus the connection and endpoint ones', () => {
        const allowed = new Set<string>(SETTINGS_FIELDS)
        for (const name of PRESET_RECORD_FIELDS) {
            expect(allowed.has(name), name).toBe(!(PRESET_OMITTED_SOURCE_FIELDS as readonly string[]).includes(name))
        }
    })
})

describe('rebuildJson (guard)', () => {
    test('follows JSON.parse(JSON.stringify) on fresh plain objects', () => {
        const source = { a: NaN, b: -0, c: undefined, d: () => 1, e: [undefined, NaN, Symbol('s'), 1], f: { g: undefined, h: 'x' } }
        const rebuilt = rebuildJson(source)
        expect(rebuilt).toEqual({ a: null, b: 0, e: [null, null, null, 1], f: { h: 'x' } })
        expect(Object.is((rebuilt as { b: number }).b, -0)).toBe(false)
        expect(rebuilt).not.toBe(source)
    })

    test('a top-level value that rebuilds to nothing, or is non-finite, is absent', () => {
        expect(rebuildJson(undefined)).toBeUndefined()
        expect(rebuildJson(NaN)).toBeUndefined()
        expect(rebuildJson(Infinity)).toBeUndefined()
        expect(rebuildJson(() => 1)).toBeUndefined()
        const cycle: Record<string, unknown> = {}
        cycle.self = cycle
        expect(rebuildJson(cycle)).toBeUndefined()
    })

    test('drops __proto__, constructor and prototype keys at every depth', () => {
        const parsed = JSON.parse('{"__proto__":{"x":1},"constructor":{"y":2},"prototype":3,"ok":{"__proto__":{"z":1},"keep":1}}')
        const rebuilt = rebuildJson(parsed) as Record<string, unknown>
        expect(Object.keys(rebuilt)).toEqual(['ok'])
        expect(Object.keys(rebuilt.ok as object)).toEqual(['keep'])
        expect(Object.getPrototypeOf(rebuilt)).toBe(Object.prototype)
    })
})
