// @vitest-environment node
import { describe, expect, test } from 'vitest'
import {
    ASSET_REF_V, encodeUnit, IL_REF_V, keyOfRef, newUnitKey, readUnit, refOfFrame, UNIT_TYPE,
    type AssetList, type InlayList, type ModuleIndex, type Ref,
} from '../../store2/format'
import { unitDigest, type ListDerivation, type PreviousEncoding } from '../../store2/codec'
import { createKeyMint, type BuildContext } from '../../store2/commit'
import { gcPass } from '../../store2/gc/pass'
import { markLiveKeys } from '../../store2/gc/mark'
import { createListDerivation, deriveInlayList, deriveModuleAssets } from '../../store2/lists'
import { previousOfTree } from '../../store2/previousOfTree'
import { createSaveEncoder, type SaveEncoder, type SavePassRequest, type SavePlan } from '../../store2/saveEncoder'
import { buildClosureAssetKeepSet, buildInlayKeepSet, createBackendClosureReader } from '../../store2/sweep'
import { readTreeBytes } from '../../store2/treeBytes'
import type { Database } from '../../database.svelte'
import { startStore2, testEnv, createClock, type Store2Kit } from '../store2SaveKit'
import { asDatabase, buildSmall, seededEnv, type Obj } from './codecFixtures'

/**
 * Carrying a module's list units (CHORE-225 stage A (iii)). When a module's unit is reused, the previous index entry
 * and the units map agree, and the derivation opts in, the encode keeps the module's asset list and inlay list units
 * instead of deriving them again. "Carried equals fresh" holds under the writer invariant (every list unit an index
 * entry names was derived from the module unit that same entry names) and while a derivation change bumps the list
 * version: the differential below is the evidence, the golden pin below is what makes a derivation change without a
 * bump fail. Every pass here is a pass the way the loop runs one: a `SaveEncoder` plan, the committer's commit, then
 * `acknowledge`, so every previous is the acknowledged encoding of a real commit.
 *
 * Labels: "reproducer" fails on the code before the carry (the derivation count or the unit counts differ), "guard"
 * passes before and after.
 */

const HEX = {
    A: 'ab'.repeat(32),
    B: 'cd'.repeat(32),
    C: '0f'.repeat(32),
    D: '3e'.repeat(32),
}
const UUID1 = '0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b'
const UUID2 = '1c1c1c1c-1c1c-4c1c-9c1c-1c1c1c1c1c1c'
const png = (hex: string): string => `assets/${hex}.png`

function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T
}

function hexOf(bytes: Uint8Array): string {
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

function baseModules(): Obj[] {
    return [
        {
            id: 'm0', name: 'Zero', description: '', assets: [['a', png(HEX.A)], ['b', 'Voice.WAV']], icon: png(HEX.B),
            lorebook: [{ content: `see {{inlay::${UUID1}}} and {{inlay::${UUID2}}}` }],
        },
        { id: 'm1', name: 'One', description: 'plain', assets: [] },
        { id: 'm2', name: 'Two', assets: [['c', png(HEX.C)]], trigger: [{ effect: `{{inlay::custom-id}} and assets/${HEX.D}` }] },
        { id: 'm3', name: 'Three', description: 'x' },
    ]
}

function databaseOf(modules: Obj[]): Database {
    return asDatabase({ ...(buildSmall(2) as unknown as Obj), modules: clone(modules) })
}

// ---- derivation spy ----

interface Spy {
    lists: ListDerivation
    assets: string[]
    inlays: string[]
    /** The module ids derived since the last take, asset and inlay together; clears both. */
    take(): { assets: string[], inlays: string[] }
}

/** `base` counting the module derivations; `optedIn` keeps (or, for a non-default cap, supplies) `moduleListVersions`. */
function spyOn(base: ListDerivation, optedIn: boolean): Spy {
    const assets: string[] = []
    const inlays: string[] = []
    const lists: ListDerivation = {
        configAssets: base.configAssets,
        configInlays: base.configInlays,
        characterAssets: base.characterAssets,
        characterInlays: base.characterInlays,
        moduleAssets: (module) => {
            assets.push(String(module.id))
            return base.moduleAssets(module)
        },
        moduleInlays: (module) => {
            inlays.push(String(module.id))
            return base.moduleInlays(module)
        },
        ...(optedIn ? { moduleListVersions: base.moduleListVersions ?? { asset: ASSET_REF_V, inlay: IL_REF_V } } : {}),
    }
    return {
        lists,
        assets,
        inlays,
        take: () => {
            const taken = { assets: [...assets], inlays: [...inlays] }
            assets.length = 0
            inlays.length = 0
            return taken
        },
    }
}

// ---- passes ----

const NOTHING_MARKED: SavePassRequest = { marked: new Set(), modules: true, whole: false }

interface Landed {
    plan: SavePlan
    manifestKey: string
}

/** One pass the way the loop commits it: plan, the committer builds and lands it, then the encoder acknowledges. */
async function landPass(kit: Store2Kit, db: Database, extra: Partial<SavePassRequest> = {}): Promise<Landed> {
    const plan = await kit.encoder.plan(db, { ...NOTHING_MARKED, ...extra })
    const result = await kit.committer.commit(await kit.committer.readCommit(), plan.commitRequest())
    expect(result.status).toBe('committed')
    plan.acknowledge()
    return { plan, manifestKey: kit.encoder.manifestKey }
}

function moduleIndexOf(encoder: SaveEncoder): ModuleIndex {
    const index = encoder.acknowledged().objects?.moduleIndex
    if (index === undefined) {
        throw new Error('The acknowledged encoding holds no module index.')
    }
    return index
}

/** The module handles the way the codec names them: the id, told apart from a repeated id by occurrence. */
function handlesOf(index: ModuleIndex): string[] {
    const seen = new Map<string, number>()
    return index.entries.map((entry) => {
        const occurrence = seen.get(entry.id) ?? 0
        seen.set(entry.id, occurrence + 1)
        return `${entry.id}#${occurrence}`
    })
}

const sameHead = (a: Ref | undefined, b: Ref): boolean => a !== undefined && a[0] === b[0] && a[1] === b[1] && a[2] === b[2]

/**
 * The acknowledged index and units map agree: each entry's module, asset list and inlay list refs are the units map's,
 * and the module-owned identities of the units map are exactly the current handles' (no stale one, no missing one).
 */
function expectConsistent(encoder: SaveEncoder): void {
    const previous = encoder.acknowledged()
    const index = moduleIndexOf(encoder)
    const handles = handlesOf(index)
    const owned = [...previous.units.keys()].filter(id => id.startsWith('module:') || id.startsWith('al:module:') || id.startsWith('il:module:')).sort()
    const expected: string[] = []
    index.entries.forEach((entry, position) => {
        const handle = handles[position]
        expected.push(`module:${handle}`, `al:module:${handle}`)
        expect(sameHead(previous.units.get(`module:${handle}`)?.ref, entry.unit), `unit of ${handle}`).toBe(true)
        expect(sameHead(previous.units.get(`al:module:${handle}`)?.ref, entry.al), `asset list of ${handle}`).toBe(true)
        if (entry.il !== null) {
            expected.push(`il:module:${handle}`)
            expect(sameHead(previous.units.get(`il:module:${handle}`)?.ref, entry.il), `inlay list of ${handle}`).toBe(true)
        }
    })
    expect(owned).toEqual(expected.sort())
}

// ---- the differential ----

interface Step {
    label: string
    /** Edits the live database before the pass. */
    edit?: (modules: Obj[], db: Obj) => void
    request?: Partial<SavePassRequest>
}

interface Case {
    label: string
    steps: Step[]
    /** The derivation under test; default `createListDerivation()`. */
    lists?: ListDerivation
    modules?: Obj[]
    /** Edits the acknowledged encoding the first pass runs over (a previous the writer invariant does not cover). */
    tamper?: (previous: PreviousEncoding) => void
}

interface PassRecord {
    outcome: string
    newUnits: number
    unchanged: boolean
    derived: { assets: string[], inlays: string[] }
    store: string
    acknowledged: string
}

interface ArmRun {
    kit: Store2Kit
    records: PassRecord[]
}

const NO_CHANGE: Step = { label: 'no change' }

function acknowledgedText(encoder: SaveEncoder): string {
    const previous = encoder.acknowledged()
    const units = [...previous.units].map(([identity, unit]) => [identity, unit.key, unit.type, unit.ref, unit.digest ?? null]).sort((a, b) => (a[0] as string).localeCompare(b[0] as string))
    return JSON.stringify({ units, entities: [...previous.entities].sort(), objects: previous.objects ?? null })
}

function storeText(kit: Store2Kit): string {
    return JSON.stringify([...kit.memory.snapshot()].map(([key, bytes]) => [key, hexOf(bytes)]).sort((a, b) => a[0].localeCompare(b[0])))
}

/** Runs `setup`'s steps, then two no-change passes, over one fresh store; `optedIn` false is the derive-everything arm. */
async function runArm(setup: Case, optedIn: boolean): Promise<ArmRun> {
    const spy = spyOn(setup.lists ?? createListDerivation(), optedIn)
    const seed = databaseOf(setup.modules ?? baseModules())
    const kit = await startStore2({ db: seed, lists: spy.lists })
    spy.take()
    setup.tamper?.(kit.encoder.acknowledged())
    const live = clone(seed) as unknown as Obj
    const records: PassRecord[] = []
    for (const step of [...setup.steps, NO_CHANGE, NO_CHANGE]) {
        step.edit?.(live.modules as Obj[], live)
        let outcome = 'ok'
        let landed: Landed | null = null
        try {
            landed = await landPass(kit, live as unknown as Database, step.request)
        } catch (error) {
            outcome = `${(error as Error).name}: ${(error as Error).message}`
        }
        records.push({
            outcome,
            newUnits: landed?.plan.newUnits ?? -1,
            unchanged: landed?.plan.unchanged ?? false,
            derived: spy.take(),
            store: storeText(kit),
            acknowledged: acknowledgedText(kit.encoder),
        })
        if (landed !== null) {
            expectConsistent(kit.encoder)
        }
    }
    return { kit, records }
}

const PROBE_NAMES = [
    ...Object.values(HEX).flatMap(hex => [png(hex), png(hex.toUpperCase()), `assets\\${hex.toUpperCase()}.PNG`]),
    'Voice.WAV', 'voice.wav', 'Dir\\Name.WAV', 'dir/name.wav', 'missing.png',
]

/** The asset and inlay keep-sets of the store's closure, as comparable text. */
async function keepSetsOf(kit: Store2Kit): Promise<string> {
    const commitKey = await kit.commitKey()
    const reader = createBackendClosureReader(kit.memory)
    const assets = await buildClosureAssetKeepSet({ commitKey, reader })
    const inlays = await buildInlayKeepSet({ commitKey, reader })
    if (assets.status !== 'complete' || inlays.status !== 'complete') {
        return JSON.stringify({ assets: assets.status, inlays: inlays.status })
    }
    return JSON.stringify({
        held: PROBE_NAMES.filter(name => assets.keep.holds(name)),
        uuids: [...inlays.keep.uuids].sort(),
        stems: [...inlays.keep.stems].sort(),
        others: [...inlays.keep.others].sort(),
        owners: inlays.keep.owners,
        unknown: inlays.keep.unknownOwners,
    })
}

/** Carried and derive-everything arms of `setup` give the same passes, the same store and the same keep-sets. */
async function expectDifferential(setup: Case): Promise<{ carried: ArmRun, fresh: ArmRun }> {
    const carried = await runArm(setup, true)
    const fresh = await runArm(setup, false)
    expect(carried.records.length).toBe(fresh.records.length)
    carried.records.forEach((record, position) => {
        const label = `pass ${position}`
        const other = fresh.records[position]
        expect(record.outcome, `${label} outcome`).toBe(other.outcome)
        expect(record.newUnits, `${label} newUnits`).toBe(other.newUnits)
        expect(record.unchanged, `${label} unchanged`).toBe(other.unchanged)
        expect(record.store, `${label} store`).toBe(other.store)
        expect(record.acknowledged, `${label} acknowledged encoding`).toBe(other.acknowledged)
        // A carried pass never derives more than the derive-everything arm.
        expect(record.derived.assets.length, `${label} asset derivations`).toBeLessThanOrEqual(other.derived.assets.length)
        expect(record.derived.inlays.length, `${label} inlay derivations`).toBeLessThanOrEqual(other.derived.inlays.length)
    })
    if (carried.records.every(record => record.outcome === 'ok')) {
        expect(await keepSetsOf(carried.kit)).toBe(await keepSetsOf(fresh.kit))
    }
    return { carried, fresh }
}

class Holder {
    constructor(public label: string, public count: number) {}
}

const text = (modules: Obj[], index: number, field: string, value: unknown): void => {
    modules[index][field] = value
}

const CASES: Case[] = [
    { label: 'no change', steps: [NO_CHANGE] },
    { label: 'a module text change', steps: [{ label: 'edit', edit: m => text(m, 1, 'description', 'changed') }] },
    { label: 'a module icon change', steps: [{ label: 'edit', edit: m => text(m, 0, 'icon', png(HEX.C)) }] },
    { label: 'an asset row added', steps: [{ label: 'edit', edit: m => (m[1].assets as unknown[]).push(['n', png(HEX.A)]) }] },
    { label: 'asset rows removed', steps: [{ label: 'edit', edit: m => text(m, 0, 'assets', []) }] },
    { label: 'an asset row renamed', steps: [{ label: 'edit', edit: m => { ((m[0].assets as unknown[][])[0])[1] = png(HEX.D) } }] },
    {
        label: 'upper-case hash names and backslash separators',
        steps: [{ label: 'edit', edit: m => text(m, 1, 'assets', [['u', `assets\\${HEX.A.toUpperCase()}.PNG`], ['v', 'Dir\\Name.WAV']]) }],
    },
    { label: 'uuid-bearing text', steps: [{ label: 'edit', edit: m => text(m, 1, 'description', `x ${UUID1.toUpperCase()} y`) }] },
    { label: 'inlay tokens of other shapes', steps: [{ label: 'edit', edit: m => text(m, 3, 'description', '{{inlay::abc}} {{inlayed::def}}') }] },
    {
        label: 'inlay overflow before and after (cap 60 bytes, opted in explicitly)',
        lists: createListDerivation({ maxInlayBodyBytes: 60 }),
        steps: [
            NO_CHANGE,
            { label: 'shrink the overflowing module', edit: m => text(m, 0, 'lorebook', []) },
            { label: 'grow it again', edit: m => text(m, 0, 'lorebook', [{ content: `${UUID1} ${UUID2}` }]) },
        ],
    },
    {
        label: 'a version bump of the previous entries',
        steps: [{ label: 'edit', edit: m => text(m, 3, 'description', 'y') }],
        tamper: (previous) => {
            const entries = previous.objects?.moduleIndex?.entries ?? []
            entries[1].al[3] = 0
            entries[2].il![3] = 0
        },
    },
    {
        label: 'non-JSON values: a class instance, a Map, an undefined property and slot',
        steps: [{
            label: 'edit',
            edit: (m) => {
                m[1].held = new Holder('h', 1)
                m[1].map = new Map([['k', 'v']])
                m[1].gone = undefined
                m[1].slots = [1, undefined, 2]
            },
        }],
    },
    {
        label: 'non-JSON values: Date, -0, NaN, a toJSON object (the outcome is compared, a refusal included)',
        steps: [{
            label: 'edit',
            edit: (m) => {
                m[2].when = new Date(0)
                m[2].zero = -0
                m[2].nan = Number.NaN
                m[2].custom = { toJSON: () => ({ id: UUID1, asset: png(HEX.A) }) }
            },
        }],
    },
    { label: 'a lone surrogate string', steps: [{ label: 'edit', edit: m => text(m, 1, 'description', 'a\ud800b') }] },
    {
        label: 'duplicate ids: made duplicate, contents swapped, first holder deleted',
        steps: [
            { label: 'duplicate', edit: m => text(m, 2, 'id', 'm0') },
            { label: 'swap contents', edit: (m) => { const first = m[0]; m[0] = m[2]; m[2] = first } },
            { label: 'delete the first holder', edit: m => { m.splice(0, 1) } },
        ],
    },
    { label: 'an empty-id module and an empty module', steps: [{ label: 'edit', edit: (m) => { m.push({ id: '', name: 'blank' }, {}) } }] },
    { label: 'a module removed', steps: [{ label: 'edit', edit: (m) => { m.splice(1, 1) } }] },
    { label: 'a module added', steps: [{ label: 'edit', edit: (m) => { m.push({ id: 'm9', name: 'Nine', assets: [['z', png(HEX.D)]] }) } }] },
    { label: 'modules reordered', steps: [{ label: 'edit', edit: (m) => { m.reverse() } }] },
    { label: 'rewriteAll (no digests, nothing carries)', steps: [{ label: 'rewrite', request: { rewriteAll: true } }] },
    {
        label: 'a previous whose list units carry no digest',
        steps: [NO_CHANGE],
        tamper: (previous) => {
            for (const [identity, unit] of previous.units) {
                if (identity.startsWith('al:module:') || identity.startsWith('il:module:')) {
                    delete unit.digest
                }
            }
        },
    },
    {
        label: 'a previous entry whose inlay list is null',
        steps: [NO_CHANGE],
        tamper: (previous) => {
            const entries = previous.objects?.moduleIndex?.entries ?? []
            entries[1].il = null
            entries[2].il = null
        },
    },
    {
        label: 'a previous entry whose asset list ref disagrees with the units map',
        steps: [NO_CHANGE],
        tamper: (previous) => {
            const entries = previous.objects?.moduleIndex?.entries ?? []
            entries[1].al[1] += 1
        },
    },
    {
        label: 'a previous entry whose module ref disagrees with the units map',
        steps: [NO_CHANGE],
        tamper: (previous) => {
            const entries = previous.objects?.moduleIndex?.entries ?? []
            entries[1].unit[1] += 1
        },
    },
    {
        label: 'a previous entry whose inlay list ref disagrees with the units map',
        steps: [NO_CHANGE],
        tamper: (previous) => {
            const entries = previous.objects?.moduleIndex?.entries ?? []
            entries[2].il![2] += 1
        },
    },
    {
        label: 'a previous without a module index',
        steps: [NO_CHANGE],
        tamper: (previous) => {
            if (previous.objects !== undefined) {
                delete previous.objects.moduleIndex
            }
        },
    },
]

describe('differential: a carried pass equals a derive-everything pass, over three chained passes', () => {
    test.each(CASES.map(item => [item.label, item] as const))('%s', async (_label, item) => {
        await expectDifferential(item)
    }, 60_000)

    test('guard: the explicit non-JSON case commits instead of being refused by both arms', async () => {
        const { carried } = await expectDifferential(CASES.find(item => item.label.startsWith('non-JSON values: a class'))!)
        expect(carried.records.map(record => record.outcome)).toEqual(['ok', 'ok', 'ok'])
    })

    test('an edited module is derived again and its neighbours are carried', async () => {
        const { carried, fresh } = await expectDifferential(CASES[1])
        expect(carried.records[0].derived).toEqual({ assets: ['m1'], inlays: ['m1'] })
        expect(fresh.records[0].derived.assets.length).toBe(baseModules().length)
        expect(carried.records[1].derived).toEqual({ assets: [], inlays: [] })
    })

    test('a version bump derives the stale entries again and writes the same lists', async () => {
        const { carried } = await expectDifferential(CASES.find(item => item.label === 'a version bump of the previous entries')!)
        // m3 changed; m1 (asset list version) and m2 (inlay list version) are stale, and a module whose pair is not
        // wholly carryable derives both lists: m0 is the only one carried.
        expect(carried.records[0].derived.assets.slice().sort()).toEqual(['m1', 'm2', 'm3'])
        expect(carried.records[0].derived.inlays.slice().sort()).toEqual(['m1', 'm2', 'm3'])
    })
})

describe('reproducer: the second and third passes derive no module list', () => {
    test('R1: nothing changed, over three chained passes: no derivation, unchanged, only the manifest written', async () => {
        const spy = spyOn(createListDerivation(), true)
        const kit = await startStore2({ db: databaseOf(baseModules()), lists: spy.lists })
        spy.take()
        const live = clone(databaseOf(baseModules()))
        for (let pass = 0; pass < 3; pass++) {
            const landed = await landPass(kit, live)
            expect(spy.take(), `pass ${pass}`).toEqual({ assets: [], inlays: [] })
            expect(landed.plan.unchanged, `pass ${pass}`).toBe(true)
            expect(landed.plan.newUnits, `pass ${pass}`).toBe(1)
            expectConsistent(kit.encoder)
        }
    })

    test('R2: one module edited among four: only that module derives, then nothing does', async () => {
        const spy = spyOn(createListDerivation(), true)
        const kit = await startStore2({ db: databaseOf(baseModules()), lists: spy.lists })
        spy.take()
        const live = clone(databaseOf(baseModules())) as unknown as { modules: Obj[] }
        live.modules[2].description = 'edited'
        const edit = await landPass(kit, live as unknown as Database)
        expect(spy.take()).toEqual({ assets: ['m2'], inlays: ['m2'] })
        expect(edit.plan.unchanged).toBe(false)
        // The module unit, the module index and the manifest.
        expect(edit.plan.newUnits).toBe(3)
        for (let pass = 0; pass < 2; pass++) {
            const landed = await landPass(kit, live as unknown as Database)
            expect(spy.take(), `pass ${pass}`).toEqual({ assets: [], inlays: [] })
            expect(landed.plan.unchanged, `pass ${pass}`).toBe(true)
            expect(landed.plan.newUnits, `pass ${pass}`).toBe(1)
            expectConsistent(kit.encoder)
        }
    })

    test('R4: a previous read back from the store the way a boot reads it carries too', async () => {
        const spy = spyOn(createListDerivation(), true)
        const kit = await startStore2({ db: databaseOf(baseModules()), lists: spy.lists })
        const live = clone(databaseOf(baseModules())) as unknown as { modules: Obj[] }
        live.modules[3].description = 'edited before the boot'
        const landed = await landPass(kit, live as unknown as Database)
        expect(landed.plan.unchanged).toBe(false)
        const read = await readTreeBytes(kit.memory, landed.manifestKey, {
            resident: input => new Set(input.entries.map(entry => entry.u)),
        })
        if (read.status !== 'ok') {
            throw new Error(`The committed tree read ${read.status}.`)
        }
        const booted = createSaveEncoder({ previous: previousOfTree(read.tree), lists: spy.lists, env: seededEnv(5), now: () => kit.clock.now })
        spy.take()
        const plan = await booted.plan(live as unknown as Database, NOTHING_MARKED)
        expect(spy.take()).toEqual({ assets: [], inlays: [] })
        expect(plan.unchanged).toBe(true)
        expect(plan.newUnits).toBe(1)
    })
})

describe('the writer-side rules of the carry', () => {
    test('opt-in: the real derivation opts in with the current list versions, and only with the default cap', () => {
        expect(createListDerivation().moduleListVersions).toEqual({ asset: ASSET_REF_V, inlay: IL_REF_V })
        expect(createListDerivation({}).moduleListVersions).toEqual({ asset: ASSET_REF_V, inlay: IL_REF_V })
        expect(createListDerivation({ maxInlayBodyBytes: 8 * 1024 * 1024 }).moduleListVersions).toEqual({ asset: ASSET_REF_V, inlay: IL_REF_V })
        expect(createListDerivation({ maxInlayBodyBytes: 60 }).moduleListVersions).toBeUndefined()
        expect(createListDerivation({ maxInlayBodyBytes: Number.POSITIVE_INFINITY }).moduleListVersions).toBeUndefined()
    })

    test('a derivation that does not opt in derives every module on every pass', async () => {
        const spy = spyOn(createListDerivation(), false)
        const kit = await startStore2({ db: databaseOf(baseModules()), lists: spy.lists })
        spy.take()
        await landPass(kit, clone(databaseOf(baseModules())))
        expect(spy.take().assets.length).toBe(baseModules().length)
    })

    test('a previous without a module index derives every module', async () => {
        const spy = spyOn(createListDerivation(), true)
        const kit = await startStore2({ db: databaseOf(baseModules()), lists: spy.lists })
        spy.take()
        delete kit.encoder.acknowledged().objects!.moduleIndex
        await landPass(kit, clone(databaseOf(baseModules())))
        expect(spy.take().assets.length).toBe(baseModules().length)
    })

    test('an entry whose list ref the units map does not name is derived again, not carried', async () => {
        const spy = spyOn(createListDerivation(), true)
        const kit = await startStore2({ db: databaseOf(baseModules()), lists: spy.lists })
        spy.take()
        moduleIndexOf(kit.encoder).entries[1].al[1] += 1
        await landPass(kit, clone(databaseOf(baseModules())))
        expect(spy.take()).toEqual({ assets: ['m1'], inlays: ['m1'] })
    })

    test('an entry whose module ref the units map does not name is derived again, not carried', async () => {
        const spy = spyOn(createListDerivation(), true)
        const kit = await startStore2({ db: databaseOf(baseModules()), lists: spy.lists })
        spy.take()
        moduleIndexOf(kit.encoder).entries[1].unit[1] += 1
        await landPass(kit, clone(databaseOf(baseModules())))
        expect(spy.take()).toEqual({ assets: ['m1'], inlays: ['m1'] })
    })

    test('an entry without an inlay list is derived again', async () => {
        const spy = spyOn(createListDerivation(), true)
        const kit = await startStore2({ db: databaseOf(baseModules()), lists: spy.lists })
        spy.take()
        moduleIndexOf(kit.encoder).entries[2].il = null
        await landPass(kit, clone(databaseOf(baseModules())))
        expect(spy.take()).toEqual({ assets: ['m2'], inlays: ['m2'] })
    })

    test('a previous list unit with no digest is never carried', async () => {
        const spy = spyOn(createListDerivation(), true)
        const kit = await startStore2({ db: databaseOf(baseModules()), lists: spy.lists })
        spy.take()
        delete kit.encoder.acknowledged().units.get('il:module:m0#0')!.digest
        await landPass(kit, clone(databaseOf(baseModules())))
        expect(spy.take()).toEqual({ assets: ['m0'], inlays: ['m0'] })
    })

    test('a list unit carried by the stale version number is derived again', async () => {
        const spy = spyOn(createListDerivation(), true)
        const kit = await startStore2({ db: databaseOf(baseModules()), lists: spy.lists })
        spy.take()
        moduleIndexOf(kit.encoder).entries[0].al[3] = ASSET_REF_V + 1
        await landPass(kit, clone(databaseOf(baseModules())))
        expect(spy.take()).toEqual({ assets: ['m0'], inlays: ['m0'] })
    })
})

describe('pending, adopt and a second finalize keep the carried units', () => {
    test('a pass kept as pending and adopted: the next pass derives nothing and is unchanged', async () => {
        const spy = spyOn(createListDerivation(), true)
        const kit = await startStore2({ db: databaseOf(baseModules()), lists: spy.lists })
        spy.take()
        const live = clone(databaseOf(baseModules())) as unknown as { modules: Obj[] }
        live.modules[1].description = 'edited'
        const plan = await kit.encoder.plan(live as unknown as Database, NOTHING_MARKED)
        const result = await kit.committer.commit(await kit.committer.readCommit(), plan.commitRequest())
        expect(result.status).toBe('committed')
        // The loop met an unknown outcome: it keeps the attempt, then sees its manifest current and adopts it.
        plan.keepAsPending()
        expect(kit.encoder.adoptIfCurrent((await kit.commitKey()).current!.key)).toBe(true)
        expectConsistent(kit.encoder)
        spy.take()
        const next = await kit.encoder.plan(live as unknown as Database, NOTHING_MARKED)
        expect(spy.take()).toEqual({ assets: [], inlays: [] })
        expect(next.unchanged).toBe(true)
        expect(next.newUnits).toBe(1)
    })

    test('finalize under two mints: the carried list refs are the previous ones under both, and the index holds them', async () => {
        const spy = spyOn(createListDerivation(), true)
        const kit = await startStore2({ db: databaseOf(baseModules()), lists: spy.lists })
        const before = kit.encoder.acknowledged()
        const live = clone(databaseOf(baseModules())) as unknown as { modules: Obj[] }
        live.modules[1].description = 'edited'
        const plan = await kit.encoder.plan(live as unknown as Database, NOTHING_MARKED)
        const mintOf = (attempt: number): BuildContext => ({ mint: createKeyMint(seededEnv(900 + attempt), null).mint, seq: 2, now: 1_700_000_000_000 })
        const indexOfBuild = async (attempt: number): Promise<ModuleIndex> => {
            const built = await plan.commitRequest().build(mintOf(attempt))
            const stored = built.units.find((unit) => {
                const parsed = readUnit(unit.bytes)
                return parsed.status === 'ok' && parsed.value.type === UNIT_TYPE.moduleIndex
            })
            const parsed = readUnit(stored!.bytes, UNIT_TYPE.moduleIndex)
            if (parsed.status !== 'ok') {
                throw new Error('The module index does not parse.')
            }
            return parsed.value.body as unknown as ModuleIndex
        }
        const first = await indexOfBuild(1)
        const second = await indexOfBuild(2)
        const carriedHandles = [0, 2, 3]
        for (const position of carriedHandles) {
            const handle = `m${position}#0`
            expect(second.entries[position].al).toEqual(first.entries[position].al)
            expect(second.entries[position].il).toEqual(first.entries[position].il)
            expect(second.entries[position].al.slice(0, 3)).toEqual(before.units.get(`al:module:${handle}`)!.ref)
        }
        plan.acknowledge()
        for (const position of carriedHandles) {
            const handle = `m${position}#0`
            expect(kit.encoder.acknowledged().units.get(`al:module:${handle}`)!.key).toBe(before.units.get(`al:module:${handle}`)!.key)
            expect(kit.encoder.acknowledged().units.get(`il:module:${handle}`)!.key).toBe(before.units.get(`il:module:${handle}`)!.key)
        }
        expectConsistent(kit.encoder)
    })
})

describe('guard: the store stays whole and collectable around a carried pass', () => {
    test('a carried pass committed to a memory backend survives a GC pass and reads back complete', async () => {
        const spy = spyOn(createListDerivation(), true)
        const kit = await startStore2({ db: databaseOf(baseModules()), lists: spy.lists })
        const live = clone(databaseOf(baseModules())) as unknown as { modules: Obj[] }
        live.modules[3].description = 'edited'
        const landed = await landPass(kit, live as unknown as Database)
        const carriedKeys = ['m0#0', 'm1#0', 'm2#0'].flatMap(handle => [`al:module:${handle}`, `il:module:${handle}`].map(identity => kit.encoder.acknowledged().units.get(identity)!.key))
        const marked = await markLiveKeys(kit.memory, await kit.memory.readCommit())
        expect(marked.status).toBe('marked')
        for (const key of carriedKeys) {
            expect(marked.status === 'marked' && marked.live.has(key), key).toBe(true)
        }
        const result = await gcPass({ backend: kit.memory, kind: 'indexeddb', idleReason: () => null })
        expect(result.status).toBe('done')
        const read = await readTreeBytes(kit.memory, landed.manifestKey, { resident: input => new Set(input.entries.map(entry => entry.u)) })
        expect(read.status).toBe('ok')
        for (const key of carriedKeys) {
            expect(kit.memory.snapshot().has(key), key).toBe(true)
        }
    })
})

describe('pins: what a carry keeps and what it re-derives', () => {
    test('T-S: a superset inlay list the previous entry names is carried while the module is unchanged, and dropped when it changes', async () => {
        const spy = spyOn(createListDerivation(), true)
        const kit = await startStore2({ db: databaseOf(baseModules()), lists: spy.lists })
        const exact = deriveInlayList([baseModules()[1]])
        const superset: InlayList = { ...exact, u: [UUID2] }
        const bytes = encodeUnit(UNIT_TYPE.inlayList, superset)
        const key = newUnitKey(testEnv(createClock(), 4))
        await kit.memory.putUnit(key, bytes)
        const ref: Ref = refOfFrame(key, bytes)
        const previous = kit.encoder.acknowledged()
        previous.units.get('il:module:m1#0')!.key = key
        Object.assign(previous.units.get('il:module:m1#0')!, { ref, digest: unitDigest(bytes) })
        moduleIndexOf(kit.encoder).entries[1].il = [ref[0], ref[1], ref[2], IL_REF_V]
        spy.take()
        const live = clone(databaseOf(baseModules())) as unknown as { modules: Obj[] }
        await landPass(kit, live as unknown as Database)
        expect(spy.take()).toEqual({ assets: [], inlays: [] })
        expect(keyOfRef(moduleIndexOf(kit.encoder).entries[1].il!)).toBe(key)
        const kept = await buildInlayKeepSet({ commitKey: await kit.commitKey(), reader: createBackendClosureReader(kit.memory) })
        expect(kept.status === 'complete' && kept.keep.uuids.has(UUID2)).toBe(true)

        live.modules[1].description = 'edited so the list is derived again'
        await landPass(kit, live as unknown as Database)
        expect(spy.take()).toEqual({ assets: ['m1'], inlays: ['m1'] })
        const after = moduleIndexOf(kit.encoder).entries[1].il!
        const stored = readUnit(kit.memory.snapshot().get(keyOfRef(after))!, UNIT_TYPE.inlayList)
        expect(stored.status === 'ok' ? (stored.value.body as unknown as InlayList).u : null).toEqual(exact.u)
    })

    test('T-O: an overflowed list of an unchanged module is carried and its owner stays unknown to the cleanup', async () => {
        const spy = spyOn(createListDerivation({ maxInlayBodyBytes: 60 }), true)
        const kit = await startStore2({ db: databaseOf(baseModules()), lists: spy.lists })
        spy.take()
        await landPass(kit, clone(databaseOf(baseModules())))
        expect(spy.take()).toEqual({ assets: [], inlays: [] })
        const kept = await buildInlayKeepSet({ commitKey: await kit.commitKey(), reader: createBackendClosureReader(kit.memory) })
        expect(kept.status).toBe('complete')
        expect(kept.status === 'complete' && kept.keep.unknownOwners.some(owner => owner.kind === 'module' && owner.id === 'm0')).toBe(true)
    })
})

describe('golden: the module list derivation is pinned to its list versions', () => {
    // A change to what these derivations return for this module (or to `assetRefKey`, `hexStemToBase64url`, the inlay
    // scan or the list body shape) is a change to every stored module list: bump `ASSET_REF_V` / `IL_REF_V` and update
    // the expected bodies here together, so a carried list of the old rule is derived again instead of kept.
    const GOLDEN_MODULE = {
        id: 'g',
        icon: png(HEX.A),
        assets: [['a', `assets\\${HEX.B.toUpperCase()}.PNG`], ['b', 'Voice.WAV'], ['c', png(HEX.C)]],
        lorebook: [{ content: `{{inlay::${UUID1}}} assets/${HEX.D} {{inlay::Odd-Id}}` }],
    }

    test('the exact asset and inlay list bodies of the golden module, with the versions they were written under', () => {
        expect({ asset: ASSET_REF_V, inlay: IL_REF_V }).toEqual({ asset: 1, inlay: 1 })
        const assets: AssetList = deriveModuleAssets(GOLDEN_MODULE)
        const inlays: InlayList = deriveInlayList([GOLDEN_MODULE])
        expect(assets).toEqual(GOLDEN_ASSETS)
        expect(inlays).toEqual(GOLDEN_INLAYS)
    })

    test('the opted-in versions are the versions the golden bodies carry', () => {
        expect(createListDerivation().moduleListVersions).toEqual({ asset: GOLDEN_ASSETS.v, inlay: GOLDEN_INLAYS.v })
    })
})

const GOLDEN_ASSETS: AssetList = {
    v: 1,
    h: 'Dw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8q6urq6urq6urq6urq6urq6urq6urq6urq6urq6urq6szc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc0',
    l: ['voice.wav'],
}
const GOLDEN_INLAYS: InlayList = {
    v: 1,
    u: [UUID1],
    h: 'Dw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8Pj4-Pj4-Pj4-Pj4-Pj4-Pj4-Pj4-Pj4-Pj4-Pj4-Pj4q6urq6urq6urq6urq6urq6urq6urq6urq6urq6urq6s',
    o: ['Odd-Id'],
}
