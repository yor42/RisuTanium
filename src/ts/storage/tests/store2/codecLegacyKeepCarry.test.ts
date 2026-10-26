// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { builtCommitOf, carryManifest, encodeDatabase, planScopedEncode, previousFrom, type EncodedTree, type PreviousEncoding } from '../../store2/codec'
import { checkBuiltUnits, createKeyMint } from '../../store2/commit'
import {
    canonicalJson, encodeUnit, newUnitKey, readUnit, refOfFrame, refsOf, UNIT_TYPE, type Manifest,
} from '../../store2/format'
import { createSaveEncoder } from '../../store2/saveEncoder'
import type { JsonValue } from '../../blockFrame'
import { buildSmall, bytesOf, encodeWith, fakeLists, seededEnv } from './codecFixtures'

const NOW = 1_700_000_000_000

/** The keep set of a converted tree: a reference to the keep-list unit, with fields this build does not know at every level. */
function keepSetOf(): NonNullable<Manifest['fixed']['legacyKeep']> {
    const key = newUnitKey(seededEnv(31))
    const bytes = encodeUnit(UNIT_TYPE.legacyList, { v: 1, iv: 1, files: [], h: '', l: [], i: { v: 1, u: [], h: '', o: [] } })
    const keep = {
        unit: refOfFrame(key, bytes),
        v: 1,
        files: [{ key: 'coldstorage/a', status: 'ok' as const, futureFileField: { n: 1 } }],
        futureKeepField: ['x', 2],
    }
    return keep as NonNullable<Manifest['fixed']['legacyKeep']>
}

/** The previous encoding of `tree` whose manifest holds `keep`, as a converted tree's previous does. */
function previousWithKeep(tree: EncodedTree, keep: Manifest['fixed']['legacyKeep']): PreviousEncoding {
    const previous = previousFrom(tree)
    const manifest = structuredClone(tree.manifest)
    manifest.fixed.legacyKeep = keep
    return { ...previous, objects: { ...previous.objects, manifest } }
}

function storedKeep(manifestBytes: Uint8Array): JsonValue {
    const parsed = readUnit(manifestBytes, UNIT_TYPE.manifest)
    if (parsed.status !== 'ok') {
        throw new Error('The manifest does not parse.')
    }
    return (parsed.value.body as Manifest).fixed.legacyKeep as unknown as JsonValue
}

function manifestBytesOf(tree: EncodedTree): Uint8Array {
    const unit = tree.units[tree.units.length - 1]
    expect(unit.type).toBe(UNIT_TYPE.manifest)
    return bytesOf(unit)
}

describe('new behaviour: a re-encode carries the previous keep set', () => {
    const db = buildSmall(3)
    const first = encodeWith(db)
    const keep = keepSetOf()

    test('encodeDatabase over a previous with a keep set writes it byte-equal, nested unknown fields included', () => {
        const tree = encodeDatabase(db, { env: seededEnv(2), lists: fakeLists, seq: 2, createdAt: NOW, previous: previousWithKeep(first, keep) })
        expect(canonicalJson(tree.manifest.fixed.legacyKeep)).toBe(canonicalJson(keep))
        expect(canonicalJson(storedKeep(manifestBytesOf(tree)))).toBe(canonicalJson(keep))
    })

    test('the carried keep set is a copy, not the previous encoding\'s object', () => {
        const previous = previousWithKeep(first, keep)
        const tree = encodeDatabase(db, { env: seededEnv(2), lists: fakeLists, seq: 2, createdAt: NOW, previous })
        expect(tree.manifest.fixed.legacyKeep).not.toBe(previous.objects?.manifest?.fixed.legacyKeep)
    })

    test('the save encoder keeps it across a finalized pass and the pass after it', async () => {
        const encoder = createSaveEncoder({ previous: previousWithKeep(first, keep), lists: fakeLists, env: seededEnv(77), now: () => NOW })
        for (let round = 0; round < 2; round++) {
            const next = JSON.parse(JSON.stringify(db)) as { statics: { messages: number } }
            next.statics = { messages: 500 + round }
            const plan = await encoder.plan(next as unknown as typeof db, { marked: new Set(), modules: false, whole: false })
            const { mint, issued } = createKeyMint(seededEnv(40 + round), null)
            const built = await plan.commitRequest().build({ mint, seq: 2, now: NOW })
            expect(checkBuiltUnits(built, issued, plan.newUnits, false)).toBeNull()
            expect(built.units.map(unit => unit.key)).not.toContain(`store2/${keep.unit[0]}`)
            plan.acknowledge()
            expect(canonicalJson(encoder.acknowledged().objects?.manifest?.fixed.legacyKeep)).toBe(canonicalJson(keep))
        }
    })

    test('the keep-list unit stays referenced: the manifest\'s references name it and the pass writes nothing for it', async () => {
        const previous = previousWithKeep(first, keep)
        const plan = await planScopedEncode(db, { env: seededEnv(2), lists: fakeLists, seq: 2, createdAt: NOW, previous }, { modules: false, characters: new Set() })
        const { mint, issued } = createKeyMint(seededEnv(50), null)
        const tree = plan.finalize({ mint, seq: 2, now: NOW })
        const targets = refsOf(UNIT_TYPE.manifest, tree.manifest)
        expect(targets.some(target => target.path === 'fixed.legacyKeep.unit' && target.tail === keep.unit[0])).toBe(true)
        expect(checkBuiltUnits(builtCommitOf(tree), issued, plan.newUnits, false)).toBeNull()
        expect(canonicalJson(storedKeep(manifestBytesOf(tree)))).toBe(canonicalJson(keep))
    })
})

describe('guard: no keep set stays no keep set, and the bytes do not change without one', () => {
    const db = buildSmall(3)
    const first = encodeWith(db)

    test('a previous with a null keep set writes null', () => {
        const tree = encodeDatabase(db, { env: seededEnv(2), lists: fakeLists, seq: 2, createdAt: NOW, previous: previousWithKeep(first, null) })
        expect(tree.manifest.fixed.legacyKeep).toBeNull()
        expect(storedKeep(manifestBytesOf(tree))).toBeNull()
    })

    test('a re-encode over a previous whose keep set is explicitly null writes the previous manifest\'s bytes', () => {
        const fresh = encodeDatabase(db, { env: seededEnv(2), lists: fakeLists, seq: 1, createdAt: NOW })
        const previous = previousWithKeep(fresh, null)
        expect(previous.objects?.manifest?.fixed.legacyKeep).toBeNull()
        const again = encodeDatabase(db, { env: seededEnv(3), lists: fakeLists, seq: 1, createdAt: NOW, previous })
        expect(again.manifest.fixed.legacyKeep).toBeNull()
        expect(Buffer.from(manifestBytesOf(again)).equals(Buffer.from(manifestBytesOf(fresh)))).toBe(true)
    })

    test('a next that already holds a keep set is not overwritten by the previous one', () => {
        const own = { ...keepSetOf(), v: 2 }
        const next = structuredClone(first.manifest)
        next.fixed.legacyKeep = own
        const prev = structuredClone(first.manifest)
        prev.fixed.legacyKeep = keepSetOf()
        expect(carryManifest(prev, next).fixed.legacyKeep).toEqual(own)
    })
})

describe('a build that is given the keep of the base it replaces writes that keep, and one that is not given any is unchanged', () => {
    const db = buildSmall(3)
    const first = encodeWith(db)

    async function finalizeWith(previousKeep: Manifest['fixed']['legacyKeep'], context: { legacyKeep?: Manifest['fixed']['legacyKeep'] }): Promise<EncodedTree> {
        const previous = previousWithKeep(first, previousKeep)
        const plan = await planScopedEncode(db, { env: seededEnv(2), lists: fakeLists, seq: 2, createdAt: NOW, previous }, { modules: false, characters: new Set() })
        const { mint } = createKeyMint(seededEnv(60), null)
        return plan.finalize({ mint, seq: 2, now: NOW, ...context })
    }

    test('R12: the substituted keep is in the manifest bytes, in the tree\'s manifest and in the index objects the next pass carries from', async () => {
        const planned = keepSetOf()
        const base = { ...keepSetOf(), v: 7 }
        const tree = await finalizeWith(planned, { legacyKeep: base })
        expect(canonicalJson(storedKeep(manifestBytesOf(tree)))).toBe(canonicalJson(base))
        expect(canonicalJson(tree.manifest.fixed.legacyKeep)).toBe(canonicalJson(base))
        expect(canonicalJson(tree.index.objects?.manifest?.fixed.legacyKeep)).toBe(canonicalJson(base))
    })

    test('R12: a null keep of the base releases the planned keep in all three places', async () => {
        const tree = await finalizeWith(keepSetOf(), { legacyKeep: null })
        expect(storedKeep(manifestBytesOf(tree))).toBeNull()
        expect(tree.manifest.fixed.legacyKeep).toBeNull()
        expect(tree.index.objects?.manifest?.fixed.legacyKeep).toBeNull()
    })

    test('G10: with no keep in the context the output is the planned keep, byte for byte', async () => {
        const planned = keepSetOf()
        const tree = await finalizeWith(planned, {})
        expect(canonicalJson(storedKeep(manifestBytesOf(tree)))).toBe(canonicalJson(planned))
        const explicit = await finalizeWith(planned, { legacyKeep: undefined })
        expect(Buffer.from(manifestBytesOf(explicit)).equals(Buffer.from(manifestBytesOf(tree)))).toBe(true)
    })
})
