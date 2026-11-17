/**
 * Pure preset-list rules: load normalization, by-id operations, ratio
 * clamping and the preset file format. No database or UI is involved.
 */

import { describe, expect, test } from 'vitest'
import {
    addHypaV3Preset,
    clampHypaV3Ratios,
    createHypaV3Preset,
    deleteHypaV3Preset,
    duplicateHypaV3Preset,
    findHypaV3Preset,
    hypaV3PresetFileOf,
    normalizeHypaV3Presets,
    parseHypaV3PresetFile,
    renameHypaV3Preset,
    selectHypaV3Preset,
    type HypaV3Preset,
} from './hypaV3Presets'

type ListDb = Parameters<typeof deleteHypaV3Preset>[0]
type NormalizeInput = Parameters<typeof normalizeHypaV3Presets>[0]

function listOf(...names: string[]): HypaV3Preset[] {
    return names.map((name) => createHypaV3Preset(name))
}

function normalizeInput(presets: object[], index: number | string | null | undefined): NormalizeInput {
    return {
        hypaV3Presets: presets,
        hypaV3PresetId: index,
        hypaV3Settings: {},
        supaMemoryPrompt: '',
    } as unknown as NormalizeInput
}

function bytesOf(value: object | string): Uint8Array {
    return new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value))
}

describe('normalizeHypaV3Presets', () => {
    test('new rule: duplicate, blank and non-string ids are re-minted; the first holder keeps its id', () => {
        const presets = [
            { id: 'a', name: 'A', settings: {} },
            { id: 'a', name: 'B', settings: {} },
            { id: '', name: 'C', settings: {} },
            { id: 7, name: 'D', settings: {} },
            { name: 'E', settings: {} },
        ]
        const data = normalizeInput(presets, 0)
        normalizeHypaV3Presets(data)
        const ids = data.hypaV3Presets.map((p) => p.id)
        expect(ids[0]).toBe('a')
        expect(new Set(ids).size).toBe(5)
        for (const id of ids) {
            expect(typeof id).toBe('string')
            expect(id).not.toBe('')
        }
        expect(data.hypaV3Presets.map((p) => p.name)).toEqual(['A', 'B', 'C', 'D', 'E'])
    })

    test('new rule: a second pass keeps ids and order', () => {
        const data = normalizeInput([{ name: 'Zeta' }, { name: 'Alpha' }], 1)
        normalizeHypaV3Presets(data)
        const first = data.hypaV3Presets.map((p) => p.id)
        normalizeHypaV3Presets(data)
        expect(data.hypaV3Presets.map((p) => p.id)).toEqual(first)
        expect(data.hypaV3Presets.map((p) => p.name)).toEqual(['Zeta', 'Alpha'])
        expect(data.hypaV3PresetId).toBe(1)
    })
})

describe('by-id operations', () => {
    function idLessDb(): ListDb {
        return {
            hypaV3Presets: [{ name: 'Legacy', settings: createHypaV3Preset().settings }, createHypaV3Preset('Two')],
            hypaV3PresetId: 1,
        } as unknown as ListDb
    }

    test.each([undefined, '', 'gone'])('new rule: id %j matches nothing and changes nothing', (id) => {
        const db = idLessDb()
        const before = JSON.stringify(db)
        expect(findHypaV3Preset(db, id)).toBeUndefined()
        expect(deleteHypaV3Preset(db, id)).toBe(false)
        expect(renameHypaV3Preset(db, id, 'x')).toBe(false)
        expect(selectHypaV3Preset(db, id)).toBe(false)
        expect(duplicateHypaV3Preset(db, id, 'copy')).toBeUndefined()
        expect(JSON.stringify(db)).toBe(before)
    })

    test('new rule: deleting a preset before the active one keeps the active preset', () => {
        const presets = listOf('A', 'B', 'C')
        const db = { hypaV3Presets: presets, hypaV3PresetId: 2 } as unknown as ListDb
        expect(deleteHypaV3Preset(db, presets[0].id)).toBe(true)
        expect(db.hypaV3PresetId).toBe(1)
        expect(db.hypaV3Presets[db.hypaV3PresetId].name).toBe('C')
    })

    test('new rule: deleting a preset after the active one leaves the index', () => {
        const presets = listOf('A', 'B', 'C')
        const db = { hypaV3Presets: presets, hypaV3PresetId: 0 } as unknown as ListDb
        expect(deleteHypaV3Preset(db, presets[2].id)).toBe(true)
        expect(db.hypaV3PresetId).toBe(0)
        expect(db.hypaV3Presets.map((p) => p.name)).toEqual(['A', 'B'])
    })

    test('new rule: deleting the active preset selects the first', () => {
        const presets = listOf('A', 'B', 'C')
        const db = { hypaV3Presets: presets, hypaV3PresetId: 1 } as unknown as ListDb
        expect(deleteHypaV3Preset(db, presets[1].id)).toBe(true)
        expect(db.hypaV3PresetId).toBe(0)
    })

    test('new rule: the last preset is refused', () => {
        const presets = listOf('Only')
        const db = { hypaV3Presets: presets, hypaV3PresetId: 0 } as unknown as ListDb
        expect(deleteHypaV3Preset(db, presets[0].id)).toBe(false)
        expect(db.hypaV3Presets).toHaveLength(1)
    })

    test('new rule: select and rename address the preset by id', () => {
        const presets = listOf('A', 'B')
        const db = { hypaV3Presets: presets, hypaV3PresetId: 0 } as unknown as ListDb
        expect(selectHypaV3Preset(db, presets[1].id)).toBe(true)
        expect(db.hypaV3PresetId).toBe(1)
        expect(renameHypaV3Preset(db, presets[0].id, 'Renamed')).toBe(true)
        expect(db.hypaV3Presets[0].name).toBe('Renamed')
        expect(db.hypaV3PresetId).toBe(1)
    })
})

describe('add and duplicate', () => {
    test.each(['', '   '])('new rule: add refuses the blank name %j', (name) => {
        const db = { hypaV3Presets: listOf('A'), hypaV3PresetId: 0 } as unknown as ListDb
        expect(addHypaV3Preset(db, name)).toBeUndefined()
        expect(db.hypaV3Presets).toHaveLength(1)
    })

    test('new rule: add appends and selects', () => {
        const db = { hypaV3Presets: listOf('A'), hypaV3PresetId: 0 } as unknown as ListDb
        const added = addHypaV3Preset(db, 'Fresh')
        expect(added?.name).toBe('Fresh')
        expect(db.hypaV3PresetId).toBe(1)
        expect(db.hypaV3Presets[1]).toBe(added)
    })

    test('new rule: duplicate is an independent copy with a new id, appended and selected', () => {
        const presets = listOf('A', 'B')
        presets[0].settings.maxChatsPerSummary = 11
        const db = { hypaV3Presets: presets, hypaV3PresetId: 1 } as unknown as ListDb
        const copy = duplicateHypaV3Preset(db, presets[0].id, 'A copy')
        expect(copy).toBeDefined()
        expect(copy?.id).not.toBe(presets[0].id)
        expect(db.hypaV3Presets).toHaveLength(3)
        expect(db.hypaV3Presets[2]).toBe(copy)
        expect(db.hypaV3PresetId).toBe(2)
        expect(copy?.settings.maxChatsPerSummary).toBe(11)
        expect(copy?.settings).not.toBe(presets[0].settings)
        copy!.settings.maxChatsPerSummary = 2
        expect(presets[0].settings.maxChatsPerSummary).toBe(11)
    })

    test('new rule: duplicate refuses a blank name', () => {
        const presets = listOf('A')
        const db = { hypaV3Presets: presets, hypaV3PresetId: 0 } as unknown as ListDb
        expect(duplicateHypaV3Preset(db, presets[0].id, ' ')).toBeUndefined()
        expect(db.hypaV3Presets).toHaveLength(1)
    })
})

describe('clampHypaV3Ratios', () => {
    function ratios(recent: number, similar: number, memoryTokens = 0.2, extra = 0) {
        return {
            recentMemoryRatio: recent,
            similarMemoryRatio: similar,
            memoryTokensRatio: memoryTokens,
            extraSummarizationRatio: extra,
        }
    }

    test('new rule: edited recent at 0 still clamps an out-of-range similar', () => {
        const r = ratios(0, 1.3)
        clampHypaV3Ratios(r, 'recent')
        expect(r.similarMemoryRatio).toBe(1)
        expect(r.recentMemoryRatio).toBe(0)
    })

    test('new rule: NaN and negative ratios become 0', () => {
        const r = ratios(Number.NaN, -0.2, -1, -3)
        clampHypaV3Ratios(r, 'recent')
        expect(r).toEqual(ratios(0, 0, 0, 0))
    })

    test('new rule: the ratio that was not edited yields', () => {
        const a = ratios(0.8, 0.4)
        clampHypaV3Ratios(a, 'recent')
        expect(a.recentMemoryRatio).toBe(0.8)
        expect(a.similarMemoryRatio).toBeCloseTo(0.2, 9)
        const b = ratios(0.4, 0.8)
        clampHypaV3Ratios(b, 'similar')
        expect(b.similarMemoryRatio).toBe(0.8)
        expect(b.recentMemoryRatio).toBeCloseTo(0.2, 9)
    })

    test('new rule: editing memoryTokens leaves a valid pair alone and lets similar yield otherwise', () => {
        const ok = ratios(0.4, 0.4)
        clampHypaV3Ratios(ok, 'memoryTokens')
        expect(ok.recentMemoryRatio).toBe(0.4)
        expect(ok.similarMemoryRatio).toBe(0.4)
        const bad = ratios(0.7, 0.7)
        clampHypaV3Ratios(bad, 'memoryTokens')
        expect(bad.recentMemoryRatio).toBe(0.7)
        expect(bad.similarMemoryRatio).toBeCloseTo(0.3, 9)
    })

    test('new rule: extra is capped at 1 - memoryTokens and follows it down', () => {
        const r = ratios(0.4, 0.4, 0.9, 0.3)
        clampHypaV3Ratios(r, 'memoryTokens')
        expect(r.extraSummarizationRatio).toBeLessThanOrEqual(0.1)
        expect(r.extraSummarizationRatio).toBeGreaterThan(0.09)
    })

    test('new rule: stability: a second clamp with the other edited field writes nothing', () => {
        const r = ratios(0.7, 0.5)
        clampHypaV3Ratios(r, 'recent')
        const settled = { ...r }
        clampHypaV3Ratios(r, 'similar')
        expect(r).toEqual(settled)
    })
})

describe('preset file', () => {
    const settings = { memoryTokensRatio: 0.3, recentMemoryRatio: 0.9, similarMemoryRatio: 0.9 }

    test('new rule: broken JSON is reported as broken', () => {
        expect(parseHypaV3PresetFile(bytesOf('{not json'))).toEqual({ ok: false, reason: 'broken' })
    })

    test.each([
        ['another type', { type: 'other', data: { name: 'x', settings } }],
        ['no data', { type: 'risu' }],
        ['no settings', { type: 'risu', data: { name: 'x' } }],
        ['settings without a known key', { type: 'risu', data: { name: 'x', settings: { nothing: 1 } } }],
        ['a known key of the wrong type', { type: 'risu', data: { name: 'x', settings: { memoryTokensRatio: 'high' } } }],
        ['a JSON array', []],
        ['JSON null', null],
    ])('new rule: %s is foreign', (_label, file) => {
        expect(parseHypaV3PresetFile(bytesOf(file as object))).toEqual({ ok: false, reason: 'foreign' })
    })

    test('new rule: an inherited name such as __proto__ is not a usable setting and is not copied', () => {
        const file = JSON.parse('{"type":"risu","data":{"name":"x","settings":{"__proto__":{}}}}')
        expect(parseHypaV3PresetFile(bytesOf(file))).toEqual({ ok: false, reason: 'foreign' })

        const created = createHypaV3Preset('x', JSON.parse('{"__proto__":{"polluted":1}}'))
        expect(Object.getPrototypeOf(created.settings)).toBe(Object.prototype)
        expect(Object.hasOwn(created.settings, 'polluted')).toBe(false)
    })

    test('new rule: the file id is ignored and ratios are clamped', () => {
        const file = { type: 'risu', ver: 1, data: { id: 'file-id', name: 'Shared', settings } }
        const result = parseHypaV3PresetFile(bytesOf(file))
        expect(result.ok).toBe(true)
        if (!result.ok) return
        expect(result.preset.id).not.toBe('file-id')
        expect(result.preset.id).not.toBe('')
        expect(result.preset.name).toBe('Shared')
        expect(result.preset.settings.similarMemoryRatio).toBe(0.9)
        expect(result.preset.settings.recentMemoryRatio).toBeCloseTo(0.1, 9)
    })

    test('new rule: a nameless file gets a default name', () => {
        const result = parseHypaV3PresetFile(bytesOf({ type: 'risu', data: { settings } }))
        expect(result.ok && result.preset.name).toBe('Imported Preset')
    })

    test('new rule: the export carries only type, ver and data{name, settings}', () => {
        const preset = createHypaV3Preset('Out')
        const file = hypaV3PresetFileOf(preset)
        expect(Object.keys(file).sort()).toEqual(['data', 'type', 'ver'])
        expect(Object.keys(file.data).sort()).toEqual(['name', 'settings'])
        expect(JSON.stringify(file)).not.toContain(preset.id)
    })
})
