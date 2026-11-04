// @vitest-environment node
/**
 * Regression reproducer plus guard (CHORE-412 stage S3b, acceptance A1): over a profile of 164 modules, a description edit of one
 * module rewrites only the bucket of the module index that holds its entry, not the whole index. The writer is the real
 * one: no mock sets the layout, so the test names the layout the build writes. Before the bucketed index the same edit
 * rewrote one type 10 unit that lists every module, and the byte assertion below fails there; with the bucketed index it
 * passes.
 *
 * The bound is computed from the encoding itself, independent of the layout: B(E) is the canonical JSON of the logical
 * entries that belong to the edited module's bucket among 16, which is what one bucket unit holds.
 */
import { describe, expect, test } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'
import {
    bucketOfKey, planScopedEncode, previousFrom, unitsToWrite,
    type EncodedTree, type EncodeOptions, type EncodeScope, type PreviousEncoding,
} from 'src/ts/storage/store2/codec'
import { createKeyMint, type BuildContext } from 'src/ts/storage/store2/commit'
import { canonicalJson, encodeUnit, UNIT_TYPE, type Manifest } from 'src/ts/storage/store2/format'
import { createListDerivation } from 'src/ts/storage/store2/lists/derive'
import { asDatabase, buildSmall, bytesOf, seededEnv, type Obj } from './codecFixtures'
import { createClock, testEnv } from './commitFixtures'

const NOW = 1_700_000_000_000
const MODULE_COUNT = 164
const BUCKETS_AT_164 = 16
const MODS: EncodeScope = { modules: true, characters: new Set() }
const ALL: EncodeScope = { modules: true, characters: 'all' }
/** What a bucket unit adds to the canonical JSON of its entries: the frame and the `v` field. */
const BUCKET_FRAME_ALLOWANCE = 64
/** The most the manifest grows by naming the 16 bucket units and the token. */
const MANIFEST_GROWTH_BOUND = 818
const EDITED_ID = 'm-0042'

const mod = (id: string, extra: Obj = {}): Obj => ({ name: `Module ${id}`, description: `about ${id}`, id, lorebook: [], regex: [], trigger: [], ...extra })

function profile(editedDescription: string | null): Database {
    const base = JSON.parse(JSON.stringify(buildSmall(1))) as Obj
    base.modules = Array.from({ length: MODULE_COUNT }, (_, index) => {
        const id = `m-${String((index * 7) % MODULE_COUNT).padStart(4, '0')}`
        return mod(id, id === EDITED_ID && editedDescription !== null ? { description: editedDescription } : {})
    })
    return asDatabase(base)
}

async function pass(db: Database, previous: PreviousEncoding | null, scope: EncodeScope, seq: number, seeds: { env: number, mint: number }): Promise<EncodedTree> {
    const options: EncodeOptions = { env: seededEnv(seeds.env), lists: createListDerivation(), seq, createdAt: NOW, previous }
    const plan = await planScopedEncode(db, options, scope)
    const context: BuildContext = { mint: createKeyMint(testEnv(createClock(), seeds.mint), null).mint, seq, now: NOW }
    return plan.finalize(context)
}

const utf8Length = (text: string): number => new TextEncoder().encode(text).length

describe('the module index after a description edit over 164 modules', () => {
    test('regression reproducer: the index units written are no larger than the edited module\'s bucket, and no root is rewritten', async () => {
        const first = await pass(profile(null), null, ALL, 1, { env: 2100, mint: 31200 })
        const edit = await pass(profile('an edited description'), previousFrom(first), MODS, 2, { env: 2101, mint: 31201 })

        const logical = edit.index.objects?.moduleIndex
        if (logical === undefined) {
            throw new Error('The encoding holds no logical module index.')
        }
        expect(logical.entries).toHaveLength(MODULE_COUNT)
        const editedBucket = bucketOfKey(EDITED_ID, BUCKETS_AT_164)
        const bucketEntries = logical.entries.filter(entry => bucketOfKey(entry.id, BUCKETS_AT_164) === editedBucket)
        const bucketBytes = utf8Length(canonicalJson({ v: 1, entries: bucketEntries }))
        // The precondition of the bound: one bucket is a small fraction of the whole index.
        const wholeIndexBytes = utf8Length(canonicalJson({ v: 1, entries: logical.entries }))
        expect(bucketBytes).toBeLessThan(wholeIndexBytes / 2)

        const indexUnits = unitsToWrite(edit).filter(unit => unit.identity === 'moduleIndex' || unit.identity.startsWith('moduleIndex:bucket:'))
        const written = indexUnits.reduce((sum, unit) => sum + bytesOf(unit).length, 0)
        expect(written).toBeLessThanOrEqual(bucketBytes + BUCKET_FRAME_ALLOWANCE)
        expect(indexUnits.map(unit => unit.identity)).toEqual([`moduleIndex:bucket:${editedBucket}`])
    })

    test('guard: the manifest grows by no more than the bucket references and the token (passes before the bucketed index as well)', async () => {
        const first = await pass(profile(null), null, ALL, 1, { env: 2200, mint: 31300 })
        const edit = await pass(profile('an edited description'), previousFrom(first), MODS, 2, { env: 2201, mint: 31301 })
        const stripped = structuredClone(edit.manifest) as Manifest
        delete stripped.fixed.moduleBuckets
        stripped.req = stripped.req.filter(token => token !== 'module-buckets')
        const withoutBuckets = encodeUnit(UNIT_TYPE.manifest, stripped as never).length
        const actual = bytesOf(edit.units.find(unit => unit.identity === 'manifest')!).length
        expect(actual).toBeLessThanOrEqual(withoutBuckets + MANIFEST_GROWTH_BOUND)
    })
})
