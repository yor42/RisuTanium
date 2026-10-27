// @vitest-environment node
import { describe, expect, test } from 'vitest'
import {
    encodeDatabase, planScopedEncode, previousFrom, type EncodedTree, type PreviousEncoding,
} from '../../store2/codec'
import { createKeyMint } from '../../store2/commit'
import { createSaveEncoder, type SavePassRequest } from '../../store2/saveEncoder'
import {
    encodeUnit, newUnitKey, readUnit, refOfFrame, refsOf, UNIT_TYPE, type Manifest, type ModuleEntry, type UnitType,
} from '../../store2/format'
import { createListDerivation } from '../../store2/lists'
import { moduleStubOf } from '../../store2/moduleStubMatch'
import { buildColdStub } from '../../../process/coldCharacter'
import type { character, Database } from '../../database.svelte'
import { asDatabase, buildSmall, bytesOf, seededEnv, type Obj } from './codecFixtures'

/**
 * The invariant behind the carry rule: every unit key a commit's new units name is a key that commit writes, a key the
 * new manifest tree itself holds (reused or carried from the acknowledged encoding), or the legacy keep's unit. A
 * reference that is in none of those is a carrier the unit count cannot see, so a Save mine over a base that dropped
 * the manifest could name a unit the collector has already deleted.
 */

const NOW = 1_700_000_000_000

/** The targets named by the new units of `tree` that no allowed key covers, as `owner -> store2/tail`. */
function strayRefs(tree: EncodedTree, allowedExtra: ReadonlySet<string> = new Set()): string[] {
    const allowed = new Set<string>(allowedExtra)
    for (const unit of tree.index.units.values()) {
        allowed.add(unit.key)
    }
    const written = tree.units.filter(unit => unit.reused !== true)
    for (const unit of written) {
        allowed.add(unit.key)
    }
    const keep = tree.manifest.fixed.legacyKeep
    if (keep !== null) {
        allowed.add(`store2/${keep.unit[0]}`)
    }
    const stray: string[] = []
    for (const unit of written) {
        const parsed = readUnit(bytesOf(unit), unit.type as UnitType)
        if (parsed.status !== 'ok' && parsed.status !== 'stale') {
            stray.push(`${unit.key} does not parse`)
            continue
        }
        for (const target of refsOf(unit.type as UnitType, parsed.value.body)) {
            const key = `store2/${target.tail}`
            if (!allowed.has(key)) {
                stray.push(`${unit.key} -> ${key} (${target.path})`)
            }
        }
    }
    return stray
}

function modulesOf(): Obj[] {
    return [
        { id: 'm0', name: 'Zero', description: 'first', assets: [] },
        { id: 'm1', name: 'One', description: 'plain', assets: [] },
        { id: 'm2', name: 'Two', description: 'third' },
    ]
}

interface Fixture {
    db: Database
    previous: PreviousEncoding
    /** Framed bytes of every unit of the base encoding, by key. */
    stored: Map<string, Uint8Array>
    lists: ReturnType<typeof createListDerivation>
    entityOf(index: number): string
}

function fixtureOf(options: { keep?: boolean } = {}): Fixture {
    const lists = createListDerivation()
    const seed = asDatabase({
        ...(JSON.parse(JSON.stringify(buildSmall(4))) as Obj),
        modules: modulesOf(),
        pluginCustomStorage: { 'plugin-0': { counter: 1, items: ['a', 'b'] } },
    })
    const first = encodeDatabase(seed, { env: seededEnv(1), lists, seq: 1, createdAt: NOW })
    const previous = previousFrom(first)
    const manifest = structuredClone(first.manifest)
    const keepKey = newUnitKey(seededEnv(31))
    const keepBytes = encodeUnit(UNIT_TYPE.legacyList, { v: 1, iv: 1, files: [], h: '', l: [], i: { v: 1, u: [], h: '', o: [] } })
    if (options.keep !== false) {
        manifest.fixed.legacyKeep = { unit: refOfFrame(keepKey, keepBytes), v: 1, files: [] }
    }
    previous.objects = { ...previous.objects, manifest }
    const stored = new Map<string, Uint8Array>(first.units.filter(unit => unit.reused !== true).map(unit => [unit.key, bytesOf(unit)]))
    const db = JSON.parse(JSON.stringify(seed)) as Database
    return {
        db, previous, stored, lists,
        entityOf: index => first.index.entities.get(`${(db.characters[index] as unknown as { chaId: string }).chaId}#0`) as string,
    }
}

async function finalized(fixture: Fixture, scope: Parameters<typeof planScopedEncode>[2]): Promise<EncodedTree> {
    const plan = await planScopedEncode(fixture.db, { env: seededEnv(2), lists: fixture.lists, seq: 2, createdAt: NOW, previous: fixture.previous }, scope)
    const { mint } = createKeyMint(seededEnv(70), null)
    return plan.finalize({ mint, seq: 2, now: NOW })
}

describe('the references a pass writes stay inside the units it writes and the tree it names', () => {
    test('G15 self-check: a tree whose new units name a key outside the allowed set is reported', async () => {
        const fixture = fixtureOf()
        const tree = await finalized(fixture, { modules: true, characters: 'all' })
        expect(strayRefs(tree)).toEqual([])
        // Only the manifest is written and the tree holds no other unit: every reference it makes is outside the allowed set.
        const foreign = strayRefs({ ...tree, units: tree.units.filter(unit => unit.type === UNIT_TYPE.manifest), index: { ...tree.index, units: new Map() } })
        expect(foreign.length).toBeGreaterThan(0)
    })

    test('G15: a pass that edits one character and reuses the rest names no unit outside its own tree', async () => {
        const fixture = fixtureOf()
        ;(fixture.db.characters[0] as unknown as Obj).personality = 'edited'
        const tree = await finalized(fixture, { modules: false, characters: new Set([(fixture.db.characters[0] as unknown as { chaId: string }).chaId]) })
        expect(strayRefs(tree)).toEqual([])
    })

    test('G15: a full pass that carries a cold stub, a module stub and a legacy keep names no unit outside its own tree', async () => {
        const fixture = fixtureOf()
        const characters = fixture.db.characters as unknown as Obj[]
        characters[1] = buildColdStub(JSON.parse(JSON.stringify(characters[1])) as character, fixture.entityOf(1), ['chat-a']) as unknown as Obj
        const entry = fixture.previous.objects?.moduleIndex?.entries[1] as ModuleEntry
        ;(fixture.db.modules as unknown as Obj[])[1] = moduleStubOf(entry) as Obj
        const tree = await finalized(fixture, { modules: true, characters: 'all' })
        expect(tree.manifest.fixed.legacyKeep).not.toBeNull()
        expect(strayRefs(tree)).toEqual([])
    })
})

// ---- the carried set the commit request declares (MC-699 step 1 oracle) ----

function passOf(over: Partial<SavePassRequest> = {}): SavePassRequest {
    return { marked: new Set(), modules: false, whole: false, ...over }
}

/** The unit type a reference at `path` of the manifest points at when that unit names further units; null for a leaf. */
function parentTypeAt(path: string): UnitType | null {
    if (path.startsWith('shards[]')) {
        return UNIT_TYPE.shard
    }
    if (path === 'fixed.moduleIndex') {
        return UNIT_TYPE.moduleIndex
    }
    if (path.startsWith('fixed.pluginStorage.refs')) {
        return UNIT_TYPE.pluginStorageBucket
    }
    return null
}

/** Every key the manifest tree names through the one reference table, descending through every parent unit, reused or not. */
function closureOf(manifest: Manifest, bodies: ReadonlyMap<string, Uint8Array>): { keys: Set<string>, parents: number } {
    const keys = new Set<string>()
    let parents = 0
    const walk = (type: UnitType, body: object): void => {
        for (const target of refsOf(type, body)) {
            const key = `store2/${target.tail}`
            if (keys.has(key)) {
                continue
            }
            keys.add(key)
            const childType = parentTypeAt(target.path)
            if (childType !== null) {
                const bytes = bodies.get(key)
                if (bytes === undefined) {
                    throw new Error(`The parent ${key} (${target.path}) is in no store the fixture knows.`)
                }
                const parsed = readUnit(bytes, childType)
                if (parsed.status !== 'ok' && parsed.status !== 'stale') {
                    throw new Error(`The parent ${key} does not parse.`)
                }
                parents++
                walk(childType, parsed.value.body)
            }
        }
    }
    walk(UNIT_TYPE.manifest, manifest)
    return { keys, parents }
}

interface Observed {
    carry: { from: string, units: number }
    manifestKey: string
    /** Keys the pass acknowledges that it does not write (reused, carried), as the encoder's own index holds them. */
    acknowledgedUnwritten: Set<string>
    /** Keys the new manifest tree reaches that the pass does not write, minus the legacy keep's unit. */
    derivedUnwritten: Set<string>
    derivedHasKeep: boolean
    parents: number
}

const sorted = (keys: Iterable<string>): string[] => [...keys].sort()

/** Plans `pass` through the real SaveEncoder, builds the request's commit, acknowledges it and derives the carried set independently of the index. */
async function observe(fixture: Fixture, pass: SavePassRequest): Promise<Observed> {
    const encoder = createSaveEncoder({ previous: fixture.previous, lists: fixture.lists, env: seededEnv(77), now: () => NOW })
    const manifestKey = encoder.manifestKey
    const plan = await encoder.plan(fixture.db, pass)
    const request = plan.commitRequest()
    const { mint } = createKeyMint(seededEnv(70), null)
    const built = await request.build({ mint, seq: 2, now: NOW })
    plan.acknowledge()
    const bodies = new Map<string, Uint8Array>(fixture.stored)
    const written = new Set<string>([built.manifest.key])
    for (const unit of built.units) {
        bodies.set(unit.key, unit.bytes)
        written.add(unit.key)
    }
    const acknowledgedUnwritten = new Set<string>()
    for (const unit of encoder.acknowledged().units.values()) {
        if (!written.has(unit.key)) {
            acknowledgedUnwritten.add(unit.key)
        }
    }
    const closure = closureOf(built.manifest.body, bodies)
    const keep = built.manifest.body.fixed.legacyKeep
    const keepKey = keep === null ? null : `store2/${keep.unit[0]}`
    const derivedUnwritten = new Set<string>()
    for (const key of closure.keys) {
        if (!written.has(key) && key !== keepKey) {
            derivedUnwritten.add(key)
        }
    }
    const carry = request.carry as { from: string, units: number }
    return { carry, manifestKey, acknowledgedUnwritten, derivedUnwritten, derivedHasKeep: keepKey !== null && closure.keys.has(keepKey), parents: closure.parents }
}

/**
 * The shared assertions. A key the index names that the tree does not reach is an overcount (the commit check then fires
 * more often and fails safe); a key the tree reaches that the index does not name is an undercount (a carried unit the
 * request does not count, the defect this oracle exists to find).
 */
function expectCarriedSet(seen: Observed, options: { keep: boolean }): void {
    const undercount = sorted([...seen.derivedUnwritten].filter(key => !seen.acknowledgedUnwritten.has(key)))
    const overcount = sorted([...seen.acknowledgedUnwritten].filter(key => !seen.derivedUnwritten.has(key)))
    expect({ undercount }).toEqual({ undercount: [] })
    expect({ overcount }).toEqual({ overcount: [] })
    expect(sorted(seen.acknowledgedUnwritten)).toEqual(sorted(seen.derivedUnwritten))
    expect(seen.carry.units).toBe(seen.derivedUnwritten.size)
    expect(seen.carry.units === 0).toBe(seen.derivedUnwritten.size === 0)
    expect(seen.carry.from).toBe(seen.manifestKey)
    expect(seen.derivedHasKeep).toBe(options.keep)
    expect(seen.parents).toBeGreaterThan(0)
}

describe('the request carries exactly the units the new manifest tree reaches without writing them', () => {
    test('a pass that edits one character carries the reused units of the rest', async () => {
        const fixture = fixtureOf()
        const chaId = (fixture.db.characters[0] as unknown as { chaId: string }).chaId
        ;(fixture.db.characters[0] as unknown as Obj).personality = 'edited'
        const seen = await observe(fixture, passOf({ marked: new Set([chaId]) }))
        expectCarriedSet(seen, { keep: true })
        expect(seen.derivedUnwritten.size).toBeGreaterThan(0)
    })

    test('a digested whole pass counts every reused unit', async () => {
        const fixture = fixtureOf()
        const chaId = (fixture.db.characters[0] as unknown as { chaId: string }).chaId
        ;(fixture.db.characters[0] as unknown as Obj).personality = 'edited'
        const seen = await observe(fixture, passOf({ marked: new Set([chaId]), whole: true }))
        expectCarriedSet(seen, { keep: true })
        expect(seen.derivedUnwritten.size).toBeGreaterThan(0)
    })

    test('a Save mine pass over a cold stub and a module stub carries their units', async () => {
        const fixture = fixtureOf()
        const characters = fixture.db.characters as unknown as Obj[]
        characters[1] = buildColdStub(JSON.parse(JSON.stringify(characters[1])) as character, fixture.entityOf(1), ['chat-a']) as unknown as Obj
        const entry = fixture.previous.objects?.moduleIndex?.entries[1] as ModuleEntry
        ;(fixture.db.modules as unknown as Obj[])[1] = moduleStubOf(entry) as Obj
        const seen = await observe(fixture, passOf({ rewriteAll: true }))
        expectCarriedSet(seen, { keep: true })
        expect(seen.derivedUnwritten.size).toBeGreaterThan(0)
    })

    test('a Save mine pass over a skipped saved character carries that character', async () => {
        const fixture = fixtureOf()
        const cyclic: Obj = {}
        cyclic.self = cyclic
        ;(fixture.db.characters[1] as unknown as Obj).personality = cyclic
        const seen = await observe(fixture, passOf({ rewriteAll: true }))
        expectCarriedSet(seen, { keep: true })
        expect(seen.derivedUnwritten.size).toBeGreaterThan(0)
    })

    test('modules carried whole beside an edited character', async () => {
        const fixture = fixtureOf()
        const chaId = (fixture.db.characters[0] as unknown as { chaId: string }).chaId
        ;(fixture.db.characters[0] as unknown as Obj).personality = 'edited'
        const seen = await observe(fixture, passOf({ marked: new Set([chaId]), modules: true, carryModules: true }))
        expectCarriedSet(seen, { keep: true })
        expect(seen.derivedUnwritten.size).toBeGreaterThan(0)
    })

    test('a Save mine pass with nothing stubbed carries nothing but the legacy keep, so the count is zero', async () => {
        const fixture = fixtureOf()
        const seen = await observe(fixture, passOf({ rewriteAll: true }))
        expectCarriedSet(seen, { keep: true })
        expect(seen.carry.units).toBe(0)
        expect(seen.derivedUnwritten.size).toBe(0)
    })

    test('a base without a legacy keep counts the same way and names no keep', async () => {
        const fixture = fixtureOf({ keep: false })
        const chaId = (fixture.db.characters[0] as unknown as { chaId: string }).chaId
        ;(fixture.db.characters[0] as unknown as Obj).personality = 'edited'
        const seen = await observe(fixture, passOf({ marked: new Set([chaId]) }))
        expectCarriedSet(seen, { keep: false })
        expect(seen.derivedUnwritten.size).toBeGreaterThan(0)
    })

    test('self-check: an index that lacks one carried key is reported as an undercount, one that holds an extra key as an overcount', async () => {
        const fixture = fixtureOf()
        const chaId = (fixture.db.characters[0] as unknown as { chaId: string }).chaId
        ;(fixture.db.characters[0] as unknown as Obj).personality = 'edited'
        const seen = await observe(fixture, passOf({ marked: new Set([chaId]) }))
        const some = [...seen.derivedUnwritten][0]
        const lacking = { ...seen, acknowledgedUnwritten: new Set([...seen.acknowledgedUnwritten].filter(key => key !== some)), carry: { ...seen.carry, units: seen.carry.units - 1 } }
        expect(() => expectCarriedSet(lacking, { keep: true })).toThrow()
        const extra = { ...seen, acknowledgedUnwritten: new Set([...seen.acknowledgedUnwritten, 'store2/u-not-reached']) }
        expect(() => expectCarriedSet(extra, { keep: true })).toThrow()
    })
})
