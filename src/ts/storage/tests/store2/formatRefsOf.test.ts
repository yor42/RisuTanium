import { describe, expect, test } from 'vitest'
import type { JsonObject } from '../../blockFrame'
import {
    parseUnitBody, REFS_TABLE, refsOf, refsOfWith, UNIT_TYPE, UNIT_TYPE_IDS, UNITS_WITHOUT_REFS, type RefRow, type UnitType,
} from '../../store2/format'

/** Distinct tails make every position identifiable in a result. */
const ref = (name: string, bytes = 100, crc = 1) => [`u-${name.padEnd(26, '0').slice(0, 26)}`, bytes, crc]
const tailOf = (name: string) => ref(name)[0] as string
const list = (name: string) => [...ref(name), 1]
const chunk = (name: string, count: number) => [...ref(name), count]
const manifestKey = (c: string) => `store2/m-0000001${c.repeat(19)}`

interface Sample {
    type: UnitType
    body: JsonObject
    /** Hand-written: every `path:tail` the sample holds, which is the plan's position list for that type. */
    expected: string[]
}

const COMMIT_SAMPLE: Sample = {
    type: UNIT_TYPE.commit,
    body: {
        fmt: 1, req: [], seq: 1, epoch: '0'.repeat(25) + '1',
        current: { key: manifestKey('a'), at: 1 },
        retained: [{ key: manifestKey('b'), at: 1 }, { key: manifestKey('c'), at: 1 }],
        pins: [{ key: manifestKey('d'), reason: 'r' }, { key: manifestKey('e'), reason: 'r' }],
        staging: null, convertedFrom: null, convertedAt: null,
    },
    expected: [
        `current.key:m-0000001${'a'.repeat(19)}`,
        `retained[].key:m-0000001${'b'.repeat(19)}`,
        `retained[].key:m-0000001${'c'.repeat(19)}`,
        `pins[].key:m-0000001${'d'.repeat(19)}`,
        `pins[].key:m-0000001${'e'.repeat(19)}`,
    ],
}

const MANIFEST_SAMPLE: Sample = {
    type: UNIT_TYPE.manifest,
    body: {
        fmt: 1, req: [], seq: 1, createdAt: 1, shardCount: 2,
        shards: [ref('shard1'), ref('shard2')],
        fixed: {
            config: ref('config'), configAl: list('configal'), il: list('il'), statics: ref('statics'), order: ref('order'),
            loadouts: ref('loadouts'), moduleIndex: ref('moduleindex'),
            presets: [ref('preset1'), ref('preset2')], plugins: [ref('plugin1'), ref('plugin2')],
            pluginStorage: { buckets: 2, refs: [ref('bucket1'), ref('bucket2')] },
            legacyKeep: { unit: ref('legacy'), v: 1, files: [{ key: 'database/database.bin', status: 'ok' }] },
        },
    },
    expected: [
        ['shards[]', 'shard1'], ['shards[]', 'shard2'], ['fixed.config', 'config'], ['fixed.configAl', 'configal'], ['fixed.il', 'il'],
        ['fixed.statics', 'statics'], ['fixed.order', 'order'], ['fixed.loadouts', 'loadouts'], ['fixed.moduleIndex', 'moduleindex'],
        ['fixed.presets[]', 'preset1'], ['fixed.presets[]', 'preset2'], ['fixed.plugins[]', 'plugin1'], ['fixed.plugins[]', 'plugin2'],
        ['fixed.pluginStorage.refs[]', 'bucket1'], ['fixed.pluginStorage.refs[]', 'bucket2'], ['fixed.legacyKeep.unit', 'legacy'],
    ].map(([path, name]) => `${path}:${tailOf(name)}`),
}

const entry = (u: string): JsonObject => ({
    u, type: 'character', name: 'n', chaId: 'x', creatorNotes: '', chatPage: 0, firstMsgIndex: 0, dsp: false,
    core: ref(`${u}core`), lore: ref(`${u}lore`), scripts: ref(`${u}scripts`), al: list(`${u}al`), il: list(`${u}il`),
    chats: [
        { cid: 'c1', core: ref(`${u}c1core`), chunks: [chunk(`${u}c1k1`, 5), chunk(`${u}c1k2`, 3)], alt: [chunk(`${u}c1a1`, 2), chunk(`${u}c1a2`, 1)] },
        { cid: 'c2', core: ref(`${u}c2core`), chunks: [chunk(`${u}c2k1`, 0)] },
    ],
})

const SHARD_SAMPLE: Sample = {
    type: UNIT_TYPE.shard,
    body: { v: 1, entries: [entry('a')] },
    expected: [
        ['entries[].core', 'acore'], ['entries[].lore', 'alore'], ['entries[].scripts', 'ascripts'], ['entries[].al', 'aal'],
        ['entries[].il', 'ail'], ['entries[].chats[].core', 'ac1core'], ['entries[].chats[].core', 'ac2core'],
        ['entries[].chats[].chunks[]', 'ac1k1'], ['entries[].chats[].chunks[]', 'ac1k2'], ['entries[].chats[].chunks[]', 'ac2k1'],
        ['entries[].chats[].alt[]', 'ac1a1'], ['entries[].chats[].alt[]', 'ac1a2'],
    ].map(([path, name]) => `${path}:${tailOf(name)}`),
}

const MODULE_INDEX_SAMPLE: Sample = {
    type: UNIT_TYPE.moduleIndex,
    body: {
        v: 1,
        entries: [1, 2].map(n => ({
            id: `m${n}`, unit: ref(`mu${n}`), al: list(`mal${n}`), il: list(`mil${n}`), name: 'n', description: 'd', hasToggle: false, dsp: false,
        })),
    },
    expected: [
        ['entries[].unit', 'mu1'], ['entries[].al', 'mal1'], ['entries[].il', 'mil1'],
        ['entries[].unit', 'mu2'], ['entries[].al', 'mal2'], ['entries[].il', 'mil2'],
    ].map(([path, name]) => `${path}:${tailOf(name)}`),
}

const BUCKET_SAMPLE: Sample = {
    type: UNIT_TYPE.pluginStorageBucket,
    body: { v: 1, entries: [{ k: 'a', ref: ref('val1') }, { k: 'b', ref: ref('val2') }] },
    expected: [`entries[].ref:${tailOf('val1')}`, `entries[].ref:${tailOf('val2')}`],
}

const SAMPLES = [COMMIT_SAMPLE, MANIFEST_SAMPLE, SHARD_SAMPLE, MODULE_INDEX_SAMPLE, BUCKET_SAMPLE]

/** The guard: what `table` finds in the sample against what the sample holds. Empty when they agree. */
function guardDiff(table: readonly RefRow[], sample: Sample): string[] {
    const body = parsedBody(sample)
    const found = refsOfWith(table, sample.type, body).map(target => `${target.path}:${target.tail}`)
    const missing = sample.expected.filter(item => !found.includes(item)).map(item => `missing ${item}`)
    const extra = found.filter(item => !sample.expected.includes(item)).map(item => `extra ${item}`)
    return [...missing, ...extra]
}

function parsedBody(sample: Sample): object {
    const parsed = parseUnitBody(sample.type, sample.body)
    if (parsed.status !== 'ok') {
        throw new Error(`The sample of type ${sample.type} is not valid: ${parsed.status}`)
    }
    return parsed.value
}

describe('refsOf guard', () => {
    test('the plan lists every position the table must cover', () => {
        const have = new Set(REFS_TABLE.map(row => `${row.type}:${row.path}`))
        const required: [UnitType, string[]][] = [
            [UNIT_TYPE.commit, ['current.key', 'retained[].key', 'pins[].key']],
            [UNIT_TYPE.manifest, ['shards[]', 'fixed.config', 'fixed.configAl', 'fixed.il', 'fixed.statics', 'fixed.order', 'fixed.loadouts',
                'fixed.moduleIndex', 'fixed.presets[]', 'fixed.plugins[]', 'fixed.pluginStorage.refs[]', 'fixed.legacyKeep.unit']],
            [UNIT_TYPE.shard, ['entries[].core', 'entries[].lore', 'entries[].scripts', 'entries[].al', 'entries[].il',
                'entries[].chats[].core', 'entries[].chats[].chunks[]', 'entries[].chats[].alt[]']],
            [UNIT_TYPE.moduleIndex, ['entries[].unit', 'entries[].al', 'entries[].il']],
            [UNIT_TYPE.pluginStorageBucket, ['entries[].ref']],
        ]
        for (const [type, paths] of required) {
            for (const path of paths) {
                expect(have.has(`${type}:${path}`), `${type}:${path}`).toBe(true)
            }
        }
    })

    test('rows are unique and the table or the no-refs list covers all 23 types exactly once', () => {
        expect(new Set(REFS_TABLE.map(row => `${row.type}:${row.path}`)).size).toBe(REFS_TABLE.length)
        const withRows = new Set(REFS_TABLE.map(row => row.type))
        for (const type of UNIT_TYPE_IDS) {
            expect(withRows.has(type) !== UNITS_WITHOUT_REFS.includes(type), String(type)).toBe(true)
        }
        expect(UNITS_WITHOUT_REFS).toContain(UNIT_TYPE.fenceRecord)
    })

    test.each(SAMPLES.map(sample => [sample.type, sample] as const))('the table finds every position of the type %i sample', (_type, sample) => {
        expect(guardDiff(REFS_TABLE, sample)).toEqual([])
    })

    describe('one generated mutant per table row', () => {
        test.each(REFS_TABLE.map((row, index) => [`${row.type}:${row.path}`, index] as const))('dropping the row %s fails the guard', (_name, index) => {
            const row = REFS_TABLE[index]
            const mutant = REFS_TABLE.filter((_, i) => i !== index)
            const sample = SAMPLES.find(candidate => candidate.type === row.type)
            expect(sample).toBeDefined()
            if (sample) {
                const diff = guardDiff(mutant, sample)
                expect(diff.length).toBeGreaterThan(0)
                expect(diff.every(line => line.startsWith('missing ') && line.includes(`${row.path}:`))).toBe(true)
            }
        })
    })
})

describe('refsOf results', () => {
    test('a commit key names manifests by key: the tail comes back, bytes and crc are null, byKey is set', () => {
        const targets = refsOf(UNIT_TYPE.commit, parsedBody(COMMIT_SAMPLE))
        expect(targets).toHaveLength(5)
        for (const target of targets) {
            expect(target).toMatchObject({ bytes: null, crc: null, byKey: true })
            expect(target.tail.startsWith('m-')).toBe(true)
        }
    })

    test('a Ref position carries tail, bytes and crc, and the chunk tuple yields its framed length', () => {
        const chunkTargets = refsOf(UNIT_TYPE.shard, parsedBody(SHARD_SAMPLE)).filter(target => target.path === 'entries[].chats[].chunks[]')
        expect(chunkTargets).toHaveLength(3)
        expect(chunkTargets[0]).toMatchObject({ bytes: 100, crc: 1, byKey: false })
    })

    test('null positions are skipped: no lore, no scripts, no il, no legacyKeep, current null', () => {
        const manifest = structuredClone(MANIFEST_SAMPLE.body)
        ;(manifest.fixed as JsonObject).legacyKeep = null
        const parsed = parseUnitBody(UNIT_TYPE.manifest, manifest)
        expect(parsed.status).toBe('ok')
        if (parsed.status === 'ok') {
            expect(refsOf(UNIT_TYPE.manifest, parsed.value).some(target => target.path === 'fixed.legacyKeep.unit')).toBe(false)
        }
        const bare = structuredClone(SHARD_SAMPLE.body)
        const bareEntry = (bare.entries as JsonObject[])[0]
        bareEntry.lore = null
        bareEntry.scripts = null
        bareEntry.il = null
        const shard = parseUnitBody(UNIT_TYPE.shard, bare)
        expect(shard.status).toBe('ok')
        if (shard.status === 'ok') {
            const paths = refsOf(UNIT_TYPE.shard, shard.value).map(target => target.path)
            expect(paths).not.toContain('entries[].lore')
            expect(paths).not.toContain('entries[].scripts')
            expect(paths).not.toContain('entries[].il')
            expect(paths).toContain('entries[].core')
        }
        const noCurrent = structuredClone(COMMIT_SAMPLE.body)
        noCurrent.current = null
        const commit = parseUnitBody(UNIT_TYPE.commit, noCurrent)
        expect(commit.status).toBe('ok')
        if (commit.status === 'ok') {
            expect(refsOf(UNIT_TYPE.commit, commit.value).some(target => target.path === 'current.key')).toBe(false)
        }
    })

    test('the fence record and every content type name nothing', () => {
        for (const type of UNITS_WITHOUT_REFS) {
            expect(refsOf(type, { v: 1, keys: ['m-x'], entries: [{ core: ref('x') }] })).toEqual([])
        }
    })

    test('a malformed position is refused, not skipped', () => {
        expect(() => refsOf(UNIT_TYPE.manifest, { fixed: { config: 'not a tuple' } })).toThrow(TypeError)
        expect(() => refsOf(UNIT_TYPE.commit, { current: { key: 'elsewhere/x' } })).toThrow(TypeError)
    })
})
