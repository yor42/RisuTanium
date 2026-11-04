// @vitest-environment node
import { describe, expect, test } from 'vitest'
import type { JsonObject } from '../../blockFrame'
import type { Database } from '../../database.svelte'
import {
    assembleDatabase, CodecAssembleError, CodecInputError, previousFrom, unitMapSource, type UnitSource,
} from '../../store2/codec'
import {
    encodeUnit, FRAME_HEADER_BYTES, keyOfRef, parseManifest, parseUnitBody, readUnit, refsOf, REQ_MODULE_BUCKETS, REQ_TASK_PRESETS, UNIT_TYPE, type Manifest,
} from '../../store2/format'
import { language } from 'src/lang'
import { createMemoryBackend } from '../../store2/backend'
import { installPick, pickCandidate, unmappedRefPaths } from '../../store2/recoveryPick'
import { readTreeBytes } from '../../store2/treeBytes'
import { flaggedLists } from '../../store2/ui/bootText'
import { createClock, seedTree, testEnv } from '../store2SaveKit'
import { asDatabase, bodyOf, buildSmall, bytesOf, encodeWith, fakeLists, identitiesWhere, seededEnv, storeOf, unitOf, type Obj } from './codecFixtures'

/**
 * Task presets in the store2 format: the `taskPresets` list of a database is stored as type 26 units named by
 * `fixed.taskPresets`, the `task-presets` token marks a store that has them, and a store without any encodes as it always
 * did. Labels: compatibility guard (passes on the base too), regression reproducer (fails on the base).
 */

function preset(n: number, extra: Obj = {}): Obj {
    return { id: `task-${n}`, name: `Preset ${n}`, instructions: `Do thing ${n}.`, model: 'gpt-test', ...extra }
}

function withPresets(presets: unknown, characters = 2): Database {
    return asDatabase({ ...buildSmall(characters) as unknown as Obj, taskPresets: presets })
}

/** The database a tree describes, read through the units of it and of the earlier encodes that wrote the ones it reused. */
function assemble(tree: ReturnType<typeof encodeWith>, ...earlier: ReturnType<typeof encodeWith>[]): Database {
    return assembleDatabase(tree.manifest, storeOf(...earlier, tree))
}

describe('task presets: encode', () => {
    // Literals only (26, 'task-presets'): the base has neither the unit type nor the token constant.
    test('regression reproducer: the presets are type 26 units named by fixed.taskPresets, not config fields', () => {
        const tree = encodeWith(withPresets([preset(0), preset(1)]))
        const config = bodyOf(unitOf(tree, 'config')).f as JsonObject
        expect(config.taskPresets).toBeUndefined()
        const refs = (tree.manifest.fixed as unknown as { taskPresets?: unknown[] }).taskPresets
        expect(refs).toHaveLength(2)
        expect(identitiesWhere(tree, 'taskPreset:')).toEqual(['taskPreset:0', 'taskPreset:1'])
        for (const identity of ['taskPreset:0', 'taskPreset:1']) {
            expect(unitOf(tree, identity).type).toBe(26)
        }
        expect(tree.manifest.req).toEqual([REQ_MODULE_BUCKETS, 'task-presets'])
    })

    test('compatibility guard: the presets round trip deep-equal and an unchanged re-encode reuses every unit', () => {
        const input = withPresets([preset(0), preset(1, { temperature: 0.5, maxTokens: 300 })])
        const first = encodeWith(input)
        const assembled = assemble(first)
        expect(assembled.taskPresets).toEqual(input.taskPresets)
        const second = encodeWith(assembled, { previous: previousFrom(first), seq: 2, env: seededEnv(2) })
        for (const identity of ['taskPreset:0', 'taskPreset:1']) {
            expect(unitOf(second, identity).reused).toBe(true)
        }
    })

    test('regression reproducer: deleting the last preset omits the field but keeps the token, and the carry does not bring it back', () => {
        const first = encodeWith(withPresets([preset(0)]))
        const emptied = withPresets([])
        const second = encodeWith(emptied, { previous: previousFrom(first), seq: 2, env: seededEnv(2) })
        expect(second.manifest.fixed.taskPresets).toBeUndefined()
        expect(second.manifest.req).toEqual([REQ_MODULE_BUCKETS, REQ_TASK_PRESETS])
        expect(identitiesWhere(second, 'taskPreset:')).toEqual([])
        expect(Object.hasOwn(assemble(second, first), 'taskPresets')).toBe(false)
        const absent = encodeWith(asDatabase({ ...buildSmall(2) as unknown as Obj }), { previous: previousFrom(first), seq: 2, env: seededEnv(2) })
        expect(absent.manifest.fixed.taskPresets).toBeUndefined()
        expect(absent.manifest.req).toEqual([REQ_MODULE_BUCKETS, REQ_TASK_PRESETS])
    })

    test('compatibility guard: a store without task presets has no token, no field and no property after assembly', () => {
        const tree = encodeWith(buildSmall(2))
        // The small profile has modules, so the bucketed index's token is the only one: no task-presets token.
        expect(tree.manifest.req).toEqual([REQ_MODULE_BUCKETS])
        expect(Object.hasOwn(tree.manifest.fixed, 'taskPresets')).toBe(false)
        expect(Object.hasOwn(assemble(tree), 'taskPresets')).toBe(false)
        expect(identitiesWhere(tree, 'taskPreset:')).toEqual([])
    })

    test('an empty list encodes as no field and no token', () => {
        const tree = encodeWith(withPresets([]))
        expect(tree.manifest.req).toEqual([REQ_MODULE_BUCKETS])
        expect(Object.hasOwn(tree.manifest.fixed, 'taskPresets')).toBe(false)
    })

    test('a taskPresets value that is not a list is refused', () => {
        expect(() => encodeWith(withPresets('not a list'))).toThrow(CodecInputError)
    })
})

describe('task presets: manifest parse', () => {
    test('regression reproducer: a manifest without the field parses and re-encodes byte-identically (the parser adds no empty list)', () => {
        const tree = encodeWith(buildSmall(2))
        const parsed = parseManifest(tree.manifest as unknown as JsonObject)
        expect(parsed.status).toBe('ok')
        if (parsed.status !== 'ok') {
            return
        }
        expect(Object.hasOwn(parsed.value.fixed, 'taskPresets')).toBe(false)
        const original = encodeUnit(UNIT_TYPE.manifest, tree.manifest)
        expect(Array.from(encodeUnit(UNIT_TYPE.manifest, parsed.value))).toEqual(Array.from(original))
    })

    test('an empty fixed.taskPresets list reads as none', () => {
        const tree = encodeWith(buildSmall(2))
        const raw = JSON.parse(JSON.stringify(tree.manifest)) as Manifest
        ;(raw.fixed as unknown as Obj).taskPresets = []
        const parsed = parseManifest(raw as unknown as JsonObject)
        expect(parsed.status === 'ok' && Object.hasOwn(parsed.value.fixed, 'taskPresets')).toBe(false)
    })

    test('the token is known, and refsOf names every type 26 unit', () => {
        const tree = encodeWith(withPresets([preset(0), preset(1)]))
        const keys = refsOf(UNIT_TYPE.manifest, tree.manifest).map(target => target.path)
        expect(keys.filter(path => path === 'fixed.taskPresets[]')).toHaveLength(2)
    })
})

describe('task presets: open body', () => {
    const FUTURE = { n: [1, 2], flag: true }

    test('regression reproducer: a key this build does not know survives encode, assembly, an edit of another field and a re-encode', () => {
        const first = encodeWith(withPresets([preset(0, { futureKey: FUTURE })]))
        const assembled = assemble(first)
        const list = assembled.taskPresets as unknown as Obj[]
        expect(list[0].futureKey).toEqual(FUTURE)
        list[0].name = 'Renamed'
        const second = encodeWith(assembled, { previous: previousFrom(first), seq: 2, env: seededEnv(2) })
        const again = (assemble(second, first).taskPresets as unknown as Obj[])[0]
        expect(again.futureKey).toEqual(FUTURE)
        expect(again.name).toBe('Renamed')
    })

    test('a body version above this build is too-new', () => {
        const parsed = parseUnitBody(UNIT_TYPE.taskPreset, { v: 2, preset: {} })
        expect(parsed.status).toBe('too-new')
    })
})

describe('task presets: recovery', () => {
    test('regression reproducer: a recovery pick of a manifest with task presets reads, copies and installs every type 26 unit', async () => {
        const backend = createMemoryBackend()
        const clock = createClock()
        await seedTree(backend, buildSmall(2), testEnv(clock, 11), fakeLists)
        const candidate = encodeWith(withPresets([preset(0), preset(1, { futureKey: { n: 1 } })]), { seq: 5, env: seededEnv(9) })
        for (const unit of candidate.units) {
            await backend.putUnit(unit.key, bytesOf(unit))
        }

        const picked = await pickCandidate(backend, await backend.readCommit(), candidate.manifestKey, {
            owner: 'a'.repeat(26),
            env: testEnv(clock, 12),
            assetsPresent: async keys => new Set(keys),
            inlaysPresent: async keys => new Set(keys),
            inlayPrefixesPresent: async prefixes => new Set(prefixes),
        })
        expect(picked.status).toBe('ready')
        if (picked.status !== 'ready') {
            return
        }
        const installed = await installPick(picked, { confirm: true })
        expect(installed.status).toBe('installed')
        if (installed.status !== 'installed') {
            return
        }

        const read = await readTreeBytes(backend, installed.manifestKey)
        expect(read.status).toBe('ok')
        if (read.status !== 'ok') {
            return
        }
        const stored = assembleDatabase(read.tree.manifest, read.tree.source)
        expect((stored.taskPresets as unknown as Obj[]).map(item => item.id)).toEqual(['task-0', 'task-1'])
        expect((stored.taskPresets as unknown as Obj[])[1].futureKey).toEqual({ n: 1 })
        expect(read.tree.manifest.req).toContain(REQ_TASK_PRESETS)
    })

    test('every reference position of the table maps to a unit type in the recovery walk', () => {
        expect(unmappedRefPaths()).toEqual([])
    })
})

describe('task presets: the boot prompt names a dropped preset by position', () => {
    test('a flagged task preset gets its own list, one line per position, apart from the characters', () => {
        const lists = flaggedLists([
            { kind: 'task-preset', position: 1, key: 'k1', why: 'damaged', name: '' },
            { kind: 'character-part', chaId: 'c1', part: 'core', key: 'k2', why: 'missing', name: 'Ann' },
            { kind: 'task-preset', position: 0, key: 'k0', why: 'missing', name: '' },
        ])
        expect(lists).toHaveLength(2)
        expect(lists[1].heading).toBe(language.store2Boot.flaggedTaskPresetsHeading)
        expect(lists[1].items).toEqual([
            language.store2Boot.flaggedTaskPresetLine(2, language.store2Boot.flaggedDamaged),
            language.store2Boot.flaggedTaskPresetLine(1, language.store2Boot.flaggedMissing),
        ])
        expect(lists[0].items).toHaveLength(1)
    })
})

describe('task presets: the position of a flagged unit', () => {
    test('guard: a damaged unit is flagged at its place in the list and the prompt line names that place', async () => {
        const backend = createMemoryBackend()
        const seeded = await seedTree(backend, withPresets([preset(0), preset(1), preset(2)]), testEnv(createClock(), 21), fakeLists)
        const damagedKey = keyOfRef((seeded.tree.manifest.fixed.taskPresets ?? [])[2])
        const flipped = new Uint8Array(backend.snapshot().get(damagedKey) as Uint8Array)
        flipped[FRAME_HEADER_BYTES + 1] ^= 0xff
        backend.poke(damagedKey, flipped)

        const read = await readTreeBytes(backend, seeded.manifestKey)

        expect(read.status).toBe('ok')
        if (read.status !== 'ok') {
            return
        }
        expect(read.flagged).toEqual([{ kind: 'task-preset', position: 2, key: damagedKey, why: 'damaged' }])
        const lists = flaggedLists(read.flagged.map(leaf => ({ ...leaf, name: '' })))
        expect(lists[0].items).toEqual([language.store2Boot.flaggedTaskPresetLine(3, language.store2Boot.flaggedDamaged)])
    })
})

describe('task presets: damaged units', () => {
    function withoutKey(source: UnitSource, key: string): UnitSource {
        return { get: k => (k === key ? undefined : source.get(k)) }
    }

    test('strict assembly throws on a missing unit; the skip option leaves exactly that preset out, in order', () => {
        const tree = encodeWith(withPresets([preset(0), preset(1), preset(2)]))
        const refs = tree.manifest.fixed.taskPresets ?? []
        const lost = keyOfRef(refs[1])
        const source = withoutKey(unitMapSource(tree.units), lost)
        expect(() => assembleDatabase(tree.manifest, source)).toThrow(CodecAssembleError)
        const partial = assembleDatabase(tree.manifest, source, { skipTaskPresets: new Set([lost]) })
        expect((partial.taskPresets as unknown as Obj[]).map(item => item.id)).toEqual(['task-0', 'task-2'])
    })

    test('skipping every preset defines no property', () => {
        const tree = encodeWith(withPresets([preset(0)]))
        const lost = keyOfRef((tree.manifest.fixed.taskPresets ?? [])[0])
        const partial = assembleDatabase(tree.manifest, withoutKey(unitMapSource(tree.units), lost), { skipTaskPresets: new Set([lost]) })
        expect(Object.hasOwn(partial, 'taskPresets')).toBe(false)
    })

    test('the units are stored in a store the reader can parse back', () => {
        const tree = encodeWith(withPresets([preset(0)]))
        const unit = unitOf(tree, 'taskPreset:0')
        expect(readUnit(storeOf(tree).get(unit.key) as Uint8Array, UNIT_TYPE.taskPreset).status).toBe('ok')
    })
})
