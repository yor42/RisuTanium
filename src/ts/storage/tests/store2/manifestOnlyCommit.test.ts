// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { assembleDatabase, encodeDatabase, previousFrom, unitsToWrite, type PreviousEncoding } from 'src/ts/storage/store2/codec'
import { manifestStateEquals } from 'src/ts/storage/store2/codec/manifest'
import { createKeyMint, type BuiltCommit } from 'src/ts/storage/store2/commit'
import { encodeUnit, readUnit, UNIT_TYPE, type Manifest } from 'src/ts/storage/store2/format'
import { createListDerivation } from 'src/ts/storage/store2/lists/derive'
import { previousOfTree } from 'src/ts/storage/store2/previousOfTree'
import { createSaveEncoder, type SavePassRequest } from 'src/ts/storage/store2/saveEncoder'
import { asDatabase, buildSmall, seededEnv, type Obj } from 'src/ts/storage/tests/store2/codecFixtures'

/**
 * A change that alters only the manifest (the list of plugin, bot preset or task preset refs, with every other unit
 * reused) must be committed: `plan.unchanged` holds only when the manifest names what the previous one names, `seq` and
 * `createdAt` aside, and an unedited profile still plans unchanged and settles after a commit.
 *
 * Labels: T1-T6 and T9 are reproducers (the base skips the commit); T7, T8, T8b and T9b are guards (pass before and after);
 * the manifestStateEquals rows pin the helper's own rule.
 */

const NOW = 1_700_000_000_000
const lists = createListDerivation()

const requests: Array<[string, SavePassRequest]> = [
    ['front', { marked: new Set(), modules: false, whole: false }],
    ['modules', { marked: new Set(), modules: true, whole: false }],
    ['whole', { marked: new Set(), modules: true, whole: true }],
]

function profile(): Obj {
    const db = JSON.parse(JSON.stringify(buildSmall(2))) as Obj
    db.taskPresets = [{ name: 'T0', prompt: 'a' }, { name: 'T1', prompt: 'b' }]
    db.botPresetsId = 0
    return db
}

function list(db: Obj, field: string): unknown[] {
    return (db[field] ?? []) as unknown[]
}

/** The persisted units, keyed as the committer writes them, and a previous encoding parsed back from the stored manifest bytes as a boot reads it. */
function rig() {
    const store = new Map<string, Uint8Array>()
    const persistBuilt = (built: BuiltCommit) => {
        for (const unit of built.units) {
            store.set(unit.key, unit.bytes)
        }
        store.set(built.manifest.key, encodeUnit(UNIT_TYPE.manifest, built.manifest.body))
    }
    const parsedBoot = (manifestKey: string): PreviousEncoding => {
        const bytes = store.get(manifestKey)
        if (bytes === undefined) {
            throw new Error('manifest not stored')
        }
        const parsed = readUnit(bytes, UNIT_TYPE.manifest)
        if (parsed.status !== 'ok') {
            throw new Error(`manifest ${parsed.status}`)
        }
        return previousOfTree({ manifestKey, manifest: parsed.value.body as Manifest, source: { get: key => store.get(key) } })
    }
    const assembled = (manifest: Manifest): Obj => assembleDatabase(manifest, { get: key => store.get(key) }) as unknown as Obj
    return { store, persistBuilt, parsedBoot, assembled }
}

function firstTree(r: ReturnType<typeof rig>) {
    const first = encodeDatabase(asDatabase(profile()), { env: seededEnv(1), lists, seq: 1, createdAt: NOW })
    for (const unit of unitsToWrite(first)) {
        r.store.set(unit.key, unit.bytes)
    }
    return first
}

type Source = 'previousFrom' | 'parsedBoot'

describe.each<Source>(['previousFrom', 'parsedBoot'])('manifest-only changes, previous from %s', (way) => {
    function start(r: ReturnType<typeof rig>) {
        const first = firstTree(r)
        const previous = way === 'previousFrom' ? previousFrom(first) : r.parsedBoot(first.manifestKey)
        return { first, previous }
    }

    /** Plans `raw` over `previous`, commits the plan, and plans again over the committed encoding; the persisted units stay in `r`. */
    async function passAndSettle(r: ReturnType<typeof rig>, previous: PreviousEncoding, raw: Obj, request: SavePassRequest) {
        const after = asDatabase(raw)
        const encoder = createSaveEncoder({ previous, lists, env: seededEnv(77), now: () => NOW + 9 })
        const plan = await encoder.plan(after, request)
        const built = await plan.commitRequest().build({ mint: createKeyMint(seededEnv(70), null).mint, seq: 2, now: NOW + 19 })
        plan.acknowledge()
        r.persistBuilt(built)
        const encoder2 = way === 'previousFrom' ? encoder : createSaveEncoder({ previous: r.parsedBoot(built.manifest.key), lists, env: seededEnv(78), now: () => NOW + 29 })
        const next = await encoder2.plan(after, request)
        return { plan, built, encoder2, next }
    }

    const removals: Array<[string, (db: Obj) => void, string[]]> = [
        ['T1 the trailing plugin', (db) => { list(db, 'plugins').pop() }, ['plugins']],
        ['T2 every plugin', (db) => { db.plugins = [] }, ['plugins']],
        ['T3 the pluginV2 entry', (db) => { db.pluginV2 = [] }, ['pluginV2']],
        ['T4 the trailing bot preset, the selected id unchanged', (db) => { list(db, 'botPresets').pop() }, ['botPresets']],
        ['T5 the last task preset', (db) => { list(db, 'taskPresets').pop() }, ['taskPresets']],
        ['T6 every task preset', (db) => { db.taskPresets = [] }, ['taskPresets']],
    ]

    describe.each(requests)('reproducers, %s request', (_label, request) => {
        test.each(removals)('%s: the plan is not unchanged, the commit lands the removal and the next plan settles', async (_name, mutate, fields) => {
            const r = rig()
            const { previous } = start(r)
            const raw = profile()
            mutate(raw)
            const { plan, built, next } = await passAndSettle(r, previous, raw, request)
            expect(plan.unchanged).toBe(false)
            expect(plan.newUnits).toBe(1)
            const assembled = r.assembled(built.manifest.body)
            for (const field of fields) {
                expect(list(assembled, field).length).toBe(list(raw, field).length)
            }
            expect(next.unchanged).toBe(true)
        })
    })

    describe.each(requests)('guards, %s request', (label, request) => {
        test('T7 an unedited profile plans unchanged with the manifest as its only unit, and still does after a commit', async () => {
            const r = rig()
            const { previous } = start(r)
            const { plan, next } = await passAndSettle(r, previous, profile(), request)
            expect(plan.unchanged).toBe(true)
            expect(plan.newUnits).toBe(1)
            expect(next.unchanged).toBe(true)
        })

        test.each<[string, (db: Obj) => void]>([
            ['plugins, leading removal', (db) => { list(db, 'plugins').shift() }],
            ['plugins, reorder', (db) => { list(db, 'plugins').reverse() }],
            ['bot presets, leading removal', (db) => { list(db, 'botPresets').shift() }],
            ['bot presets, reorder', (db) => { list(db, 'botPresets').reverse() }],
        ])('T8 %s still commits more than the manifest', async (_name, mutate) => {
            const r = rig()
            const { previous } = start(r)
            const raw = profile()
            mutate(raw)
            const { plan, next } = await passAndSettle(r, previous, raw, request)
            expect(plan.unchanged).toBe(false)
            expect(plan.newUnits).toBeGreaterThan(1)
            expect(next.unchanged).toBe(true)
        })

        if (label === 'front') {
            test('T8b a front pass carries the modules whole, so edited modules leave it unchanged', async () => {
                const r = rig()
                const { previous } = start(r)
                const raw = profile()
                list(raw, 'modules').pop()
                list(raw, 'modules').reverse()
                const { plan } = await passAndSettle(r, previous, raw, request)
                expect(plan.modulesEncoded).toBe(false)
                expect(plan.unchanged).toBe(true)
            })
        }
    })
})

describe('the previous manifest decides', () => {
    test('T9 reproducer: a previous encoding with no manifest object is never planned unchanged', async () => {
        const r = rig()
        const first = firstTree(r)
        const full = previousFrom(first)
        const previous: PreviousEncoding = { ...full, objects: { ...full.objects, manifest: undefined } }
        const encoder = createSaveEncoder({ previous, lists, env: seededEnv(77), now: () => NOW + 9 })
        const plan = await encoder.plan(asDatabase(profile()), { marked: new Set(), modules: true, whole: true })
        expect(plan.unchanged).toBe(false)
    })

    test('T9b guard: fields a newer writer added to the stored manifest are carried, so an unedited profile stays unchanged', async () => {
        const r = rig()
        const first = firstTree(r)
        const stored = readUnit(r.store.get(first.manifestKey) as Uint8Array, UNIT_TYPE.manifest)
        if (stored.status !== 'ok') {
            throw new Error(`manifest ${stored.status}`)
        }
        const body = JSON.parse(JSON.stringify(stored.value.body)) as Obj
        body.futureTop = { added: 1 }
        ;(body.fixed as Obj).futureFixed = ['x']
        r.store.set(first.manifestKey, encodeUnit(UNIT_TYPE.manifest, body as unknown as Manifest))
        const previous = r.parsedBoot(first.manifestKey)
        const encoder = createSaveEncoder({ previous, lists, env: seededEnv(77), now: () => NOW + 9 })
        const plan = await encoder.plan(asDatabase(profile()), { marked: new Set(), modules: true, whole: true })
        expect(plan.unchanged).toBe(true)
    })
})

describe('manifestStateEquals', () => {
    const sample = (): Manifest => encodeDatabase(asDatabase(profile()), { env: seededEnv(1), lists, seq: 1, createdAt: NOW }).manifest

    test('an absent previous manifest is never equal', () => {
        expect(manifestStateEquals(sample(), undefined)).toBe(false)
    })

    test('seq and createdAt do not count, and key order does not count', () => {
        const next = sample()
        const previous = JSON.parse(JSON.stringify(next)) as Manifest
        next.seq += 5
        next.createdAt += 5
        const reordered = Object.fromEntries(Object.entries(previous).reverse()) as unknown as Manifest
        expect(manifestStateEquals(next, reordered)).toBe(true)
    })

    test('a differing ref, a missing key on either side and a differing req are not equal', () => {
        const base = sample()
        const clone = () => JSON.parse(JSON.stringify(base)) as Manifest
        const shorter = clone()
        shorter.fixed.plugins.pop()
        expect(manifestStateEquals(base, shorter)).toBe(false)
        expect(manifestStateEquals(shorter, base)).toBe(false)
        const withoutTaskPresets = clone()
        delete withoutTaskPresets.fixed.taskPresets
        expect(manifestStateEquals(base, withoutTaskPresets)).toBe(false)
        expect(manifestStateEquals(withoutTaskPresets, base)).toBe(false)
        const extra = clone() as unknown as Obj
        extra.futureTop = 1
        expect(manifestStateEquals(base, extra as unknown as Manifest)).toBe(false)
        expect(manifestStateEquals(extra as unknown as Manifest, base)).toBe(false)
        const req = clone()
        req.req = [...req.req, 'other']
        expect(manifestStateEquals(base, req)).toBe(false)
    })
})
