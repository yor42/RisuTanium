import { describe, test, expect } from 'vitest'
import {
    SIDE_SECTION_IDS,
    checkKnownEntryName,
    inlayEntryName,
    parseInlayEntryName,
    parseStoreBlockName,
    sidePrefix,
    storeBlockName,
} from 'src/ts/drive/rtb/entryNames'
import {
    checkKnownSectionEntries,
    checkSectionCounts,
    countOutsideEntries,
    isKnownRow,
    parseSectionTable,
    unknownOptionalRows,
    unknownRequiredRow,
    type SectionRow,
} from 'src/ts/drive/rtb/sections'
import { readDirectory, type ZipIndex } from 'src/ts/drive/rtb/zip64Reader'
import { Zip64Writer } from 'src/ts/drive/rtb/zip64Writer'
import { SegmentSink } from './segmentSink'
import { rangeSourceOfBytes } from './sparseSource'

const encoder = new TextEncoder()

function row(id: string, prefix: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
    return { id, v: 1, required: false, prefix, entries: 0, bytes: 0, ...extra }
}

function reserved(): Record<string, unknown>[] {
    return [
        row('store2', 'u/', { required: true }),
        row('assets', 'a/', { required: true }),
        row('inlays', 'i/', { required: true }),
    ]
}

function table(...extra: unknown[]): unknown {
    return [...reserved(), ...extra]
}

function damagedReason(raw: unknown): string | null {
    const result = parseSectionTable(raw)
    return result.kind === 'damaged' ? result.reason : null
}

describe('T-row the row grammar', () => {
    test('the three reserved rows alone are accepted and typed', () => {
        const result = parseSectionTable(table())
        expect(result.kind).toBe('ok')
        if (result.kind === 'ok') {
            expect(result.rows.map((r) => r.id)).toEqual(['store2', 'assets', 'inlays'])
            expect(result.rows[0]).toMatchObject({ id: 'store2', v: 1, required: true, prefix: 'u/', entries: 0, bytes: 0, meta: null })
        }
    })

    test('an id of 64 characters is accepted, one of 65 is damaged', () => {
        expect(parseSectionTable(table(row('x'.repeat(64), 'x/y/'))).kind).toBe('ok')
        expect(damagedReason(table(row('x'.repeat(65), 'x/y/')))).not.toBeNull()
    })

    test('meta is kept when it is an object', () => {
        const result = parseSectionTable([row('store2', 'u/', { required: true, meta: { req: [] } }), ...reserved().slice(1)])
        expect(result.kind === 'ok' && result.rows[0].meta).toEqual({ req: [] })
    })

    test.each([
        ['an id with an upper-case letter', row('X-test', 'x/y/')],
        ['an id with a space', row('x test', 'x/y/')],
        ['an empty id', row('', 'x/y/')],
        ['v 0', row('x-test.a', 'x/y/', { v: 0 })],
        ['v 1.5', row('x-test.a', 'x/y/', { v: 1.5 })],
        ['v negative', row('x-test.a', 'x/y/', { v: -1 })],
        ['v a string', row('x-test.a', 'x/y/', { v: '1' })],
        ['v missing', { id: 'x-test.a', required: false, prefix: 'x/y/', entries: 0, bytes: 0 }],
        ['required a string', row('x-test.a', 'x/y/', { required: 'false' })],
        ['a prefix with no trailing slash', row('x-test.a', 'x/unknown')],
        ['a prefix with an upper-case letter', row('x-test.a', 'X/')],
        ['a prefix with an empty segment', row('x-test.a', 'x//')],
        ['a prefix that is a slash', row('x-test.a', '/')],
        ['an empty prefix', row('x-test.a', '')],
        ['entries -1', row('x-test.a', 'x/y/', { entries: -1 })],
        ['entries 1.5', row('x-test.a', 'x/y/', { entries: 1.5 })],
        ['entries a string', row('x-test.a', 'x/y/', { entries: '1' })],
        ['bytes -1', row('x-test.a', 'x/y/', { bytes: -1 })],
        ['bytes 1.5', row('x-test.a', 'x/y/', { bytes: 1.5 })],
        ['bytes missing', { id: 'x-test.a', v: 1, required: false, prefix: 'x/y/', entries: 0 }],
        ['meta a list', row('x-test.a', 'x/y/', { meta: [] })],
        ['meta null', row('x-test.a', 'x/y/', { meta: null })],
        ['a row that is a string', 'x-test.a'],
        ['a row that is a list', ['x-test.a']],
    ])('%s is damaged', (_label, bad) => {
        expect(damagedReason(table(bad))).not.toBeNull()
    })

    test('a table that is not a list is damaged', () => {
        expect(damagedReason('x')).not.toBeNull()
        expect(damagedReason({})).not.toBeNull()
    })

    test('store2 at v 1.5 is damaged, not newer', () => {
        const result = parseSectionTable([row('store2', 'u/', { required: true, v: 1.5 }), ...reserved().slice(1)])
        expect(result.kind).toBe('damaged')
    })

    test('a duplicate id is damaged', () => {
        expect(damagedReason(table(row('x-test.a', 'x/y/'), row('x-test.a', 'x/z/')))).not.toBeNull()
    })
})

describe('T15 / T39 prefix uniqueness and nesting', () => {
    test('equal prefixes are damaged', () => {
        expect(damagedReason(table(row('x-test.a', 'x/y/'), row('x-test.b', 'x/y/')))).not.toBeNull()
    })

    test('nested prefixes are damaged in either order', () => {
        expect(damagedReason(table(row('x-test.a', 'x/'), row('x-test.b', 'x/y/')))).not.toBeNull()
        expect(damagedReason(table(row('x-test.b', 'x/y/'), row('x-test.a', 'x/')))).not.toBeNull()
    })

    test('a prefix that only shares leading characters is not nested', () => {
        expect(parseSectionTable(table(row('x-test.a', 'x/ab/'), row('x-test.b', 'x/abc/'))).kind).toBe('ok')
    })
})

describe('T40 / T-resprefix reserved ids', () => {
    test.each(['store2', 'assets', 'inlays'])('a missing %s row is damaged', (id) => {
        expect(damagedReason(reserved().filter((r) => r.id !== id))).not.toBeNull()
    })

    test.each([
        ['store2', 'u/'],
        ['assets', 'a/'],
        ['inlays', 'i/'],
    ])('%s as an optional row is damaged', (id, prefix) => {
        const others = reserved().filter((r) => r.id !== id)
        expect(damagedReason([...others, row(id, prefix, { required: false })])).not.toBeNull()
    })

    test.each([
        ['store2', 'u/', 'x/'],
        ['assets', 'a/', 'y/'],
        ['inlays', 'i/', 'z/'],
    ])('%s at v 1 under a prefix other than %s is damaged', (id, _canonical, prefix) => {
        const others = reserved().filter((r) => r.id !== id)
        expect(damagedReason([...others, row(id, prefix, { required: true })])).not.toBeNull()
    })

    test.each(['store2', 'assets', 'inlays'])('%s as an optional row at a higher v and another prefix is damaged', (id) => {
        const others = reserved().filter((r) => r.id !== id)
        expect(damagedReason([...others, row(id, 'q/', { required: false, v: 2 })])).not.toBeNull()
    })

    test('a reserved id at a higher v may sit at another prefix and is an unknown required row', () => {
        const raw = [row('store2', 'q/', { required: true, v: 2 }), ...reserved().slice(1)]
        const result = parseSectionTable(raw)
        expect(result.kind).toBe('ok')
        if (result.kind === 'ok') {
            expect(unknownRequiredRow(result.rows)?.id).toBe('store2')
        }
    })
})

describe('T39 side prefixes and optional rows under u/ a/ i/', () => {
    test('there are eight v1 side sections, each with its own s/<name>/ prefix', () => {
        expect(SIDE_SECTION_IDS.length).toBe(8)
        expect(sidePrefix('side.iris')).toBe('s/iris/')
        expect(sidePrefix('side.plugin-safe-ls')).toBe('s/plugin-safe-ls/')
        expect(sidePrefix('side.unknown')).toBeNull()
        expect(sidePrefix('store2')).toBeNull()
        for (const id of SIDE_SECTION_IDS) {
            expect(parseSectionTable(table(row(id, sidePrefix(id)!))).kind).toBe('ok')
        }
    })

    test('a v1 side id under another prefix is damaged', () => {
        expect(damagedReason(table(row('side.iris', 's/other/')))).not.toBeNull()
        expect(damagedReason(table(row('side.iris', 'x/iris/')))).not.toBeNull()
    })

    test('another id that equals or nests with a v1 side prefix is damaged, whether or not the side row is present', () => {
        for (const prefix of ['s/iris/', 's/', 's/iris/sub/']) {
            expect(damagedReason(table(row('x-test.a', prefix)))).not.toBeNull()
            expect(damagedReason(table(row('side.iris', 's/iris/'), row('x-test.a', prefix)))).not.toBeNull()
        }
    })

    test('a known side id at a higher v keeps its own prefix and is an unknown optional row', () => {
        const result = parseSectionTable(table(row('side.iris', 's/iris/', { v: 2 })))
        expect(result.kind).toBe('ok')
        if (result.kind === 'ok') {
            expect(unknownOptionalRows(result.rows).map((r) => r.id)).toEqual(['side.iris'])
            expect(unknownRequiredRow(result.rows)).toBeNull()
        }
    })

    test('an unknown optional row under another s/ prefix is accepted', () => {
        expect(parseSectionTable(table(row('x-test.unknown', 's/brand-new/'))).kind).toBe('ok')
    })

    test('an optional row under u/, a/ or i/ is damaged even when the reserved row sits elsewhere', () => {
        for (const prefix of ['u/', 'a/', 'i/', 'u/sub/', 'a/x/', 'i/y/']) {
            const raw = [row('store2', 'q/', { required: true, v: 2 }), row('assets', 'r/', { required: true, v: 2 }), row('inlays', 'p/', { required: true, v: 2 }), row('x-test.a', prefix)]
            expect(damagedReason(raw)).not.toBeNull()
        }
    })
})

describe('T4 / T14 known and unknown rows', () => {
    function rowsOf(raw: unknown): SectionRow[] {
        const result = parseSectionTable(raw)
        if (result.kind !== 'ok') {
            throw new Error(`table is ${result.reason}`)
        }
        return result.rows
    }

    test('a row is known when its id is known at v 1', () => {
        const rows = rowsOf(table(row('side.iris', 's/iris/'), row('side.iris-2', 'x/two/'), row('x-test.unknown', 'x/unknown/')))
        expect(rows.map(isKnownRow)).toEqual([true, true, true, true, false, false])
    })

    test('a known id at a higher v is unknown', () => {
        const rows = rowsOf([row('store2', 'u/', { required: true, v: 2 }), ...reserved().slice(1), row('side.iris', 's/iris/', { v: 3 })])
        expect(rows.map(isKnownRow)).toEqual([false, true, true, false])
    })

    test('the first unknown required row is returned, an unknown optional row is not', () => {
        const rows = rowsOf(table(row('x-test.req', 'x/req/', { required: true }), row('x-test.opt', 'x/opt/')))
        expect(unknownRequiredRow(rows)?.id).toBe('x-test.req')
        expect(unknownOptionalRows(rows).map((r) => r.id)).toEqual(['x-test.opt'])
    })

    test('a v1 table has no unknown rows', () => {
        const rows = rowsOf(table(row('side.ui-prefs', 's/ui-prefs/')))
        expect(unknownRequiredRow(rows)).toBeNull()
        expect(unknownOptionalRows(rows)).toEqual([])
    })
})

describe('T-canon canonical names of the known sections', () => {
    test('store blocks: decimal type 1-255 and seq from 0 with no leading zeros', () => {
        expect(parseStoreBlockName('u/2/0.blk')).toEqual({ type: 2, seq: 0 })
        expect(parseStoreBlockName('u/255/12.blk')).toEqual({ type: 255, seq: 12 })
        expect(storeBlockName(27, 3)).toBe('u/27/3.blk')
        for (const bad of ['u/0/0.blk', 'u/02/0.blk', 'u/256/0.blk', 'u/1000/0.blk', 'u/2/00.blk', 'u/2/01.blk', 'u/2/-1.blk', 'u/2/0.blk2', 'u/2/0.bin', 'u/2/0', 'u/2/0.blk/', 'u/x/0.blk', 'u//0.blk', 'u/2/', 'u/2.blk', 'a/2/0.blk']) {
            expect(parseStoreBlockName(bad), bad).toBeNull()
        }
    })

    test('inlay entries: <enc>.meta and <enc>.body with a canonical enc that holds no dot', () => {
        expect(parseInlayEntryName('i/inlay-1.meta')).toEqual({ id: 'inlay-1', enc: 'inlay-1', part: 'meta' })
        expect(parseInlayEntryName('i/inlay-1.body')?.part).toBe('body')
        expect(parseInlayEntryName('i/Ab%20c.meta')).toBeNull()
        expect(parseInlayEntryName('i/%41b.meta')?.id).toBe('Ab')
        expect(inlayEntryName('Ab', 'body')).toBe('i/%41b.body')
        expect(inlayEntryName('', 'body')).toBeNull()
        for (const bad of ['i/.meta', 'i/x.other', 'i/x', 'i/x.meta.body', 'i/a.b.meta', 'i/%61.meta', 'i/%zz.meta', 'i/A.meta', 'i/x/y.meta', 'a/x.meta']) {
            expect(parseInlayEntryName(bad), bad).toBeNull()
        }
    })

    test('checkKnownEntryName per known id', () => {
        expect(checkKnownEntryName('store2', 'u/2/0.blk')).toBeNull()
        expect(checkKnownEntryName('store2', 'u/2/00.blk')).not.toBeNull()
        expect(checkKnownEntryName('assets', 'a/%46oo.png')).toBeNull()
        expect(checkKnownEntryName('assets', 'a/Foo.png')).not.toBeNull()
        expect(checkKnownEntryName('assets', 'a/%61')).not.toBeNull()
        expect(checkKnownEntryName('inlays', 'i/x.meta')).toBeNull()
        expect(checkKnownEntryName('inlays', 'i/x.png')).not.toBeNull()
        expect(checkKnownEntryName('side.iris', 's/iris/data.jsonl')).toBeNull()
        expect(checkKnownEntryName('side.iris', 's/iris/data.v2')).not.toBeNull()
        expect(checkKnownEntryName('side.iris', 's/iris/sub/data.jsonl')).not.toBeNull()
        expect(checkKnownEntryName('side.ui-prefs', 's/iris/data.jsonl')).not.toBeNull()
    })
})

interface FileEntry {
    name: string
    body: string
    method?: 0 | 8
}

async function buildIndex(entries: FileEntry[]): Promise<{ bytes: Uint8Array, index: ZipIndex }> {
    const sink = new SegmentSink()
    const writer = new Zip64Writer({ sink, createdAt: Date.UTC(2024, 1, 3) })
    for (const entry of entries) {
        const body = encoder.encode(entry.body)
        await writer.addBuffered(entry.name, entry.method ?? 0, body, body.length)
    }
    await writer.finish({})
    const bytes = sink.toBytes()
    const walk = await readDirectory(rangeSourceOfBytes(bytes))
    if (!walk.index || walk.findings.length > 0) {
        throw new Error('fixture does not walk cleanly')
    }
    return { bytes, index: walk.index }
}

function rowsFor(raw: unknown): SectionRow[] {
    const result = parseSectionTable(raw)
    if (result.kind !== 'ok') {
        throw new Error(`table is ${result.reason}`)
    }
    return result.rows
}

describe('T15 counts against the central directory', () => {
    const entries: FileEntry[] = [
        { name: 'mimetype', body: 'application/vnd.risutanium.rtb' },
        { name: 'u/2/0.blk', body: 'abcd' },
        { name: 'u/2/1.blk', body: 'efghij' },
        { name: 'a/x', body: 'yz' },
        { name: 'x/unknown/one', body: '12345' },
        { name: 'manifest.json', body: '{}' },
    ]

    function rowsWith(overrides: Record<string, Partial<{ entries: number, bytes: number }>>): SectionRow[] {
        const base: Record<string, { entries: number, bytes: number }> = {
            store2: { entries: 2, bytes: 10 },
            assets: { entries: 1, bytes: 2 },
            inlays: { entries: 0, bytes: 0 },
            'x-test.unknown': { entries: 1, bytes: 5 },
        }
        const counts = (id: string) => ({ ...base[id], ...overrides[id] })
        return rowsFor([
            row('store2', 'u/', { required: true, ...counts('store2') }),
            row('assets', 'a/', { required: true, ...counts('assets') }),
            row('inlays', 'i/', { required: true, ...counts('inlays') }),
            row('x-test.unknown', 'x/unknown/', counts('x-test.unknown')),
        ])
    }

    test('counts and byte sums that match are accepted, for known and unknown rows', async () => {
        const { index } = await buildIndex(entries)
        expect(checkSectionCounts(rowsWith({}), index)).toBeNull()
    })

    test.each([
        ['store2 one entry too many', { store2: { entries: 3 } }],
        ['store2 one entry too few', { store2: { entries: 1 } }],
        ['store2 one byte too many', { store2: { bytes: 11 } }],
        ['assets one byte too few', { assets: { bytes: 1 } }],
        ['inlays an entry that is not there', { inlays: { entries: 1 } }],
        ['an unknown row with the wrong count', { 'x-test.unknown': { entries: 2 } }],
        ['an unknown row with the wrong bytes', { 'x-test.unknown': { bytes: 4 } }],
    ])('%s is damaged', async (_label, overrides) => {
        const { index } = await buildIndex(entries)
        expect(checkSectionCounts(rowsWith(overrides), index)).not.toBeNull()
    })

    test('an empty row with entries 0 is present-empty, and a 0-byte entry counts as one entry', async () => {
        const { index } = await buildIndex([
            { name: 'mimetype', body: 'm' },
            { name: 's/iris/data.jsonl', body: '' },
            { name: 'manifest.json', body: '{}' },
        ])
        const rows = rowsFor(table(row('side.iris', 's/iris/', { entries: 1, bytes: 0 }), row('side.ui-prefs', 's/ui-prefs/', { entries: 0, bytes: 0 })))
        expect(checkSectionCounts(rows, index)).toBeNull()
    })
})

describe('T-m93 / T-canon / T-outside entries of the known rows', () => {
    const rows = rowsFor(table(row('x-test.unknown', 'x/unknown/')))

    test('a non-canonical name in a known section is damaged', async () => {
        const { index } = await buildIndex([
            { name: 'mimetype', body: 'm' },
            { name: 'u/2/0.blk', body: 'a' },
            { name: 'manifest.json', body: '{}' },
        ])
        expect(checkKnownSectionEntries(rows, index)).toBeNull()
        const bad = await buildIndex([
            { name: 'mimetype', body: 'm' },
            { name: 'u/2/00.blk', body: 'a' },
            { name: 'manifest.json', body: '{}' },
        ])
        expect(checkKnownSectionEntries(rows, bad.index)).not.toBeNull()
    })

    test('names under an unknown row are not checked for canonical form', async () => {
        const { index } = await buildIndex([
            { name: 'mimetype', body: 'm' },
            { name: 'x/unknown/Any Thing.v9', body: 'a' },
            { name: 'manifest.json', body: '{}' },
        ])
        expect(checkKnownSectionEntries(rows, index)).toBeNull()
    })

    test('names outside every prefix, other than mimetype and manifest.json, are counted', async () => {
        const { index } = await buildIndex([
            { name: 'mimetype', body: 'm' },
            { name: 'u/2/0.blk', body: 'a' },
            { name: 'x/unknown/one', body: 'a' },
            { name: 'readme.txt', body: 'a' },
            { name: 'extra/more/readme.txt', body: 'a' },
            { name: 'manifest.json', body: '{}' },
        ])
        expect(countOutsideEntries(rows, index)).toBe(2)
    })
})
