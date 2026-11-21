import { describe, expect, test } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { checkKnownEntryName } from 'src/ts/drive/rtb/entryNames'
import { classifyRtb } from 'src/ts/drive/rtb/rtbClassify'
import { verifyRtb } from 'src/ts/drive/rtb/rtbVerify'
import { isKnownRow, parseSectionTable, unknownRequiredRow } from 'src/ts/drive/rtb/sections'
import { SIDE_LINE_MAX_BYTES } from 'src/ts/drive/rtb/sideLines'
import { fillPiece } from 'src/ts/drive/rtb/zip64Writer'
import { rangeSourceOfBytes } from './sparseSource'
import { craftedFile, SETTINGS_ROW, settingsFile, type CraftedEntry } from './settingsFileKit'

const GOLDEN_DIR = path.resolve(process.env.RTB_GOLDENS_DIR ?? path.join(process.cwd(), 'src/ts/drive/tests/rtbGoldens'))

function row(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
    return { id, v: 1, required: true, prefix: `${id}/`, entries: 1, bytes: 0, ...over }
}

const store2Row = row('store2', { prefix: 'u/' })
const assetsRow = row('assets', { prefix: 'a/' })
const inlaysRow = row('inlays', { prefix: 'i/' })
const settings = row('settings')

const DATA: CraftedEntry = { name: 'settings/data.jsonl', body: '{"k":"theme","j":"x"}\n' }

describe('T1 (guard): the section table of a settings-only file', () => {
    test('the settings row alone is a table, with or without the ui-prefs row', () => {
        expect(parseSectionTable([settings]).kind).toBe('ok')
        expect(parseSectionTable([settings, row('side.ui-prefs', { required: false, prefix: 's/ui-prefs/' })]).kind).toBe('ok')
    })

    test('an optional settings row, or one off its prefix, is damaged', () => {
        expect(parseSectionTable([row('settings', { required: false })])).toMatchObject({ kind: 'damaged', reason: expect.stringContaining('optional') })
        expect(parseSectionTable([row('settings', { prefix: 'cfg/' })])).toMatchObject({ kind: 'damaged', reason: expect.stringContaining('prefix') })
    })

    test.each([['store2', store2Row], ['assets', assetsRow], ['inlays', inlaysRow]])('a %s row beside the settings row is damaged, whatever the version of either', (_name, beside) => {
        expect(parseSectionTable([settings, beside]).kind).toBe('damaged')
        expect(parseSectionTable([row('settings', { v: 2 }), beside]).kind).toBe('damaged')
        expect(parseSectionTable([settings, { ...beside, v: 2 }]).kind).toBe('damaged')
    })

    test('without the settings row the three required rows are still required', () => {
        expect(parseSectionTable([row('side.ui-prefs', { required: false, prefix: 's/ui-prefs/' })])).toMatchObject({ kind: 'damaged', reason: expect.stringContaining('store2 is missing') })
        expect(parseSectionTable([store2Row, assetsRow, inlaysRow]).kind).toBe('ok')
    })

    test('settings v1 is known; a settings v2 row is an unknown required row, so the file is newer and not damaged', () => {
        const v1 = parseSectionTable([settings])
        const v2 = parseSectionTable([row('settings', { v: 2, prefix: 'anything/' })])
        if (v1.kind !== 'ok' || v2.kind !== 'ok') {
            throw new Error('the tables must be ok')
        }
        expect(isKnownRow(v1.rows[0])).toBe(true)
        expect(unknownRequiredRow(v1.rows)).toBeNull()
        expect(isKnownRow(v2.rows[0])).toBe(false)
        expect(unknownRequiredRow(v2.rows)?.id).toBe('settings')
    })

    test('the data entry is the only name a settings row owns', () => {
        expect(checkKnownEntryName('settings', 'settings/data.jsonl')).toBeNull()
        expect(checkKnownEntryName('settings', 'settings/other')).not.toBeNull()
        expect(checkKnownEntryName('settings', 'settings/x/data.jsonl')).not.toBeNull()
    })
})

describe('T2 (guard): classification', () => {
    test('the file the writer makes classifies settings, with or without ui-prefs', async () => {
        const plain = await settingsFile({ settings: [{ key: 'theme', value: 'x' }] })
        const classified = await classifyRtb(plain.source)
        expect(classified.kind).toBe('settings')
        expect(classified.kind === 'settings' && classified.rows.map((r) => r.id)).toEqual(['settings'])
        const withPrefs = await settingsFile({ settings: [{ key: 'theme', value: 'x' }], uiPrefs: [{ key: 'k', value: 'v' }] })
        const second = await classifyRtb(withPrefs.source)
        expect(second.kind).toBe('settings')
        expect(second.kind === 'settings' && second.rows.map((r) => r.id)).toEqual(['settings', 'side.ui-prefs'])
    })

    test('a whole backup (the frozen golden) still classifies ok and never settings', async () => {
        const golden = fs.readFileSync(path.join(GOLDEN_DIR, 'v1-sealed-small.plain.rtb'))
        expect((await classifyRtb(rangeSourceOfBytes(golden))).kind).toBe('ok')
    })

    test.each([
        ['store2', { id: 'store2', prefix: 'u/' }, [{ name: 'u/2/0.blk', body: 'b' }]],
        ['an empty store2', { id: 'store2', prefix: 'u/' }, []],
        ['assets', { id: 'assets', prefix: 'a/' }, []],
        ['inlays', { id: 'inlays', prefix: 'i/' }, []],
    ])('a %s row beside the settings row is damaged and never classifies settings or ok', async (_name, beside, extra) => {
        const file = await craftedFile({
            entries: [DATA, ...extra],
            defs: [SETTINGS_ROW, { ...beside, required: true }],
        })
        expect((await classifyRtb(file.source)).kind).toBe('damaged')
    })

    test('a settings v2 row is newer, named as the required row', async () => {
        const file = await craftedFile({ entries: [DATA], defs: [{ ...SETTINGS_ROW, v: 2 }] })
        expect(await classifyRtb(file.source)).toEqual({ kind: 'newer', reason: { why: 'required-row', id: 'settings', v: 2 } })
    })

    test('an entry under settings/ that is not the data entry is damaged', async () => {
        const file = await craftedFile({ entries: [DATA, { name: 'settings/extra.jsonl', body: '' }], defs: [SETTINGS_ROW] })
        const classified = await classifyRtb(file.source)
        expect(classified).toMatchObject({ kind: 'damaged', reason: expect.stringContaining('settings/extra.jsonl') })
    })
})

describe('T3 (compatibility guard; passes before and after once the writer exists): the file as an older reader sees it', () => {
    test('with the row id renamed, today\'s classifier calls the file damaged for its missing store2', async () => {
        const file = await craftedFile({ entries: [DATA], defs: [{ id: 'cfg', prefix: 'settings/', required: true }] })
        const classified = await classifyRtb(file.source)
        expect(classified).toMatchObject({ kind: 'damaged', reason: expect.stringContaining('store2 is missing') })
    })
})

describe('T4 and T23 (guard): verification refuses a damaged settings file', () => {
    test('a good file verifies as settings with its decoded lines', async () => {
        const file = await settingsFile({ settings: [{ key: 'a', value: 1 }, { key: 'b', value: { c: [true] } }], uiPrefs: [{ key: 'p', value: 'q' }] })
        const verdict = await verifyRtb(file.source)
        expect(verdict.kind).toBe('settings')
        if (verdict.kind !== 'settings') {
            return
        }
        expect(verdict.verified.values).toEqual([{ key: 'a', value: 1 }, { key: 'b', value: { c: [true] } }])
        expect(verdict.verified.uiPrefs).toEqual([{ key: 'p', value: 'q' }])
        expect(verdict.verified.taggedLines).toEqual([])
    })

    test('a file without the ui-prefs row has no ui-prefs', async () => {
        const verdict = await verifyRtb((await settingsFile({ settings: [] })).source)
        expect(verdict.kind === 'settings' && verdict.verified.uiPrefs).toBeNull()
    })

    test('a broken CRC in the data entry is damaged', async () => {
        const file = await craftedFile({ entries: [DATA], defs: [SETTINGS_ROW] })
        const bytes = file.bytes().slice()
        const at = new TextDecoder().decode(bytes).indexOf('"theme"')
        bytes[at + 2] ^= 0x01
        expect((await verifyRtb(rangeSourceOfBytes(bytes))).kind).toBe('damaged')
    })

    test('two data entries are damaged', async () => {
        const file = await craftedFile({ entries: [DATA, DATA], defs: [SETTINGS_ROW] })
        expect((await verifyRtb(file.source)).kind).toBe('damaged')
    })

    test('a data entry over the line limit is damaged before it is read', async () => {
        const file = await craftedFile({ entries: [{ name: 'settings/data.jsonl', body: fillPiece(0x20, SIDE_LINE_MAX_BYTES + 1) }], defs: [SETTINGS_ROW] })
        const verdict = await verifyRtb(file.source)
        expect(verdict).toMatchObject({ kind: 'damaged', reason: expect.stringContaining('byte limit') })
    })

    test('a line that is not JSON is damaged', async () => {
        const file = await craftedFile({ entries: [{ name: 'settings/data.jsonl', body: '{"k":"a","j":1}\nnot json\n' }], defs: [SETTINGS_ROW] })
        expect(await verifyRtb(file.source)).toMatchObject({ kind: 'damaged', reason: expect.stringContaining('line 2') })
    })

    test('a bad ui-prefs line is damaged', async () => {
        const file = await craftedFile({
            entries: [DATA, { name: 's/ui-prefs/data.jsonl', body: '{"k":"a"}\n' }],
            defs: [SETTINGS_ROW, { id: 'side.ui-prefs', prefix: 's/ui-prefs/' }],
        })
        expect(await verifyRtb(file.source)).toMatchObject({ kind: 'damaged', reason: expect.stringContaining('ui-prefs') })
    })

    test('T23: a key twice, and a key as a plain line and as a tagged line, are damaged and nothing is carried', async () => {
        const twice = await craftedFile({ entries: [{ name: 'settings/data.jsonl', body: '{"k":"theme","j":"a"}\n{"k":"theme","j":"b"}\n' }], defs: [SETTINGS_ROW] })
        expect(await verifyRtb(twice.source)).toMatchObject({ kind: 'damaged', reason: expect.stringContaining('"theme"') })
        const tagged = await craftedFile({ entries: [{ name: 'settings/data.jsonl', body: '{"k":"theme","j":"a"}\n{"k":"theme","t":"unknown-tag","b":""}\n' }], defs: [SETTINGS_ROW] })
        expect(await verifyRtb(tagged.source)).toMatchObject({ kind: 'damaged', reason: expect.stringContaining('"theme"') })
    })

    test('a tagged line of its own is kept apart, never carried as a value', async () => {
        const file = await craftedFile({ entries: [{ name: 'settings/data.jsonl', body: '{"k":"theme","j":"a"}\n{"k":"zoomsize","t":"unknown-tag","b":""}\n' }], defs: [SETTINGS_ROW] })
        const verdict = await verifyRtb(file.source)
        expect(verdict.kind === 'settings' && verdict.verified.values.map((v) => v.key)).toEqual(['theme'])
        expect(verdict.kind === 'settings' && verdict.verified.taggedLines).toEqual([{ key: 'zoomsize', tag: 'unknown-tag' }])
    })
})
