// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import {
    planScopedEncode, previousFrom, unitsToWrite, carryModuleIndex, moduleHandles, moduleEntryFields,
    type EncodedTree, type EncodeOptions, type EncodeScope, type PreviousEncoding,
} from 'src/ts/storage/store2/codec'
import { hasCurrentEntryFields } from 'src/ts/storage/store2/codec/modules'
import { createKeyMint, type BuildContext } from 'src/ts/storage/store2/commit'
import { encodeUnit, keyOfRef, parseModuleIndex, readUnit, UNIT_TYPE, type Manifest, type ModuleEntry, type ModuleIndex } from 'src/ts/storage/store2/format'
import { createListDerivation } from 'src/ts/storage/store2/lists/derive'
import { previousOfTree } from 'src/ts/storage/store2/previousOfTree'
import type { JsonObject } from 'src/ts/storage/blockFrame'
import type { Database } from 'src/ts/storage/database.svelte'
import { asDatabase, buildSmall, seededEnv, type Obj } from 'src/ts/storage/tests/store2/codecFixtures'
import { createClock, testEnv } from 'src/ts/storage/tests/store2/commitFixtures'

/**
 * The entry-fields tag: the fourth element of a module index entry's `unit` Ref says the derived fields of the entry
 * were computed by a build that knows version 1. Every pass here is a production-path pass: `planScopedEncode` under
 * `createListDerivation()` (so unchanged modules take the carried-lists branch), `finalize` under a real mint, and a
 * previous that comes from `previousFrom` (the save path) or from `previousOfTree` over stored bytes (the boot path).
 *
 * Labels, where a test carries one: "reproducer" fails on the code before the tag, "guard" passes before and after.
 * Unlabelled tests exercise the tag predicate itself, which does not exist before the tag.
 */

const NOW = 1_700_000_000_000
const MODS: EncodeScope = { modules: true, characters: new Set() }
const ALL: EncodeScope = { modules: true, characters: 'all' }

interface Rig {
    store: Map<string, Uint8Array>
    pass(db: Database, previous: PreviousEncoding | null, scope: EncodeScope, seq: number): Promise<{ plan: Awaited<ReturnType<typeof planScopedEncode>>, tree: EncodedTree }>
    persist(tree: EncodedTree): void
    /** The previous a boot builds: the stored manifest and the stored unit bytes only. */
    boot(tree: EncodedTree): PreviousEncoding
}

/** Seeds differ from those that generated the frozen fixture, so no new key can equal a fixture key. */
function makeRig(envSeed = 300, mintSeed = 5200): Rig {
    const store = new Map<string, Uint8Array>()
    const lists = createListDerivation()
    let env = envSeed
    let mint = mintSeed
    return {
        store,
        async pass(db, previous, scope, seq) {
            const options: EncodeOptions = { env: seededEnv(env++), lists, seq, createdAt: NOW, previous }
            const plan = await planScopedEncode(db, options, scope)
            const context: BuildContext = { mint: createKeyMint(testEnv(createClock(), mint++), null).mint, seq, now: NOW }
            return { plan, tree: plan.finalize(context) }
        },
        persist(tree) {
            for (const unit of unitsToWrite(tree)) {
                store.set(unit.key, unit.bytes)
            }
        },
        boot(tree) {
            return previousOfTree({ manifestKey: tree.manifestKey, manifest: tree.manifest, source: { get: key => store.get(key) } })
        },
    }
}

const mod = (id: string, extra: JsonObject = {}): JsonObject => ({ name: `Module ${id}`, description: `about ${id}`, id, lorebook: [], regex: [], trigger: [], ...extra })

/** Three kinds of handle: a unique id with `mcp`, a repeated id (one holder with `mcp`), and a plain unique id. */
function profile(options: { uniqMcp?: boolean, edit?: boolean } = {}): Database {
    const base = JSON.parse(JSON.stringify(buildSmall(1))) as Obj
    base.modules = [
        mod('uniq', { name: options.edit === true ? 'edited' : 'Module uniq', ...(options.uniqMcp === false ? {} : { mcp: { url: 'https://mcp.invalid/a' } }) }),
        mod('dup', { name: 'first', mcp: { url: 'https://mcp.invalid/b' } }),
        mod('dup', { name: 'second' }),
        mod('plain'),
    ]
    return asDatabase(base)
}

function indexOfTree(tree: EncodedTree): ModuleIndex {
    const index = tree.index.objects?.moduleIndex
    if (index === undefined) {
        throw new Error('The encoding holds no module index.')
    }
    return index
}

/** The module index as the stored bytes decode, reached through the manifest of `tree`. */
function storedIndex(rig: Rig, tree: Pick<EncodedTree, 'manifestKey'>): ModuleIndex {
    const manifestBytes = rig.store.get(tree.manifestKey)
    if (manifestBytes === undefined) {
        throw new Error('The manifest was not persisted.')
    }
    const manifest = readUnit(manifestBytes, UNIT_TYPE.manifest)
    if (manifest.status !== 'ok') {
        throw new Error('The manifest does not parse.')
    }
    const indexBytes = rig.store.get(keyOfRef((manifest.value.body as Manifest).fixed.moduleIndex))
    if (indexBytes === undefined) {
        throw new Error('The module index unit was not persisted.')
    }
    const index = readUnit(indexBytes, UNIT_TYPE.moduleIndex)
    if (index.status !== 'ok') {
        throw new Error('The module index does not parse.')
    }
    return index.value.body as ModuleIndex
}

function unitHeadOf(tree: EncodedTree, identity: string): unknown[] {
    const unit = tree.units.find(candidate => candidate.identity === identity)
    if (unit === undefined) {
        throw new Error(`No unit ${identity}.`)
    }
    return [unit.ref[0], unit.ref[1], unit.ref[2]]
}

function expectTagged(index: ModuleIndex, tree: EncodedTree, label: string): void {
    expect(index.entries.length, label).toBeGreaterThan(0)
    moduleHandles(index.entries).forEach((handle, position) => {
        const entry = index.entries[position]
        expect(hasCurrentEntryFields(entry), `${label}: tag of ${handle}`).toBe(true)
        expect(entry.unit.slice(0, 3), `${label}: head of ${handle}`).toEqual(unitHeadOf(tree, `module:${handle}`))
    })
}

describe('the entry-fields tag on a production-path pass', () => {
    test.each([['previous present (save path)', true], ['previous absent (import and install path)', false]] as const)(
        'tag-survives-finalize, %s: reproducer, every entry carries the tag with the final Ref head',
        async (_label, withPrevious) => {
            const rig = makeRig()
            const first = await rig.pass(profile(), null, ALL, 1)
            rig.persist(first.tree)
            expectTagged(indexOfTree(first.tree), first.tree, 'first import')
            const edited = await rig.pass(profile({ edit: true }), withPrevious ? previousFrom(first.tree) : null, withPrevious ? MODS : ALL, 2)
            rig.persist(edited.tree)
            const index = indexOfTree(edited.tree)
            expectTagged(index, edited.tree, 'finalized index')
            expectTagged(storedIndex(rig, edited.tree), edited.tree, 'stored index bytes')
            for (const entry of index.entries) {
                expect(entry.unit[0].startsWith('u-vvvvvvvvvv'), 'no placeholder tail is left').toBe(false)
            }
        },
    )

    test.each([['previousFrom', false], ['previousOfTree', true]] as const)(
        'mcp-removed-entry-drops-mcp, %s: reproducer, a removed mcp leaves no stale field under a valid tag',
        async (_label, fromBytes) => {
            const rig = makeRig(400, 6200)
            const first = await rig.pass(profile(), null, ALL, 1)
            rig.persist(first.tree)
            const before = indexOfTree(first.tree).entries
            // The unique handle is the only kind `carryModuleIndex` carries unknown fields for, so a field the build does not know would survive here.
            expect(before[0].mcp, 'mcp is written for a module that has it').toBe(true)
            expect(before[1].mcp, 'mcp is written for a repeated id too').toBe(true)
            expect(before[2].mcp).toBeUndefined()
            expect(before[3].mcp).toBeUndefined()
            const second = await rig.pass(profile({ uniqMcp: false }), fromBytes ? rig.boot(first.tree) : previousFrom(first.tree), MODS, 2)
            const after = indexOfTree(second.tree).entries
            expect(after[0].id).toBe('uniq')
            expect('mcp' in after[0], 'the removed mcp is not carried').toBe(false)
            expect(hasCurrentEntryFields(after[0])).toBe(true)
        },
    )
})

describe('the frozen pre-tag fixture', () => {
    interface FixtureFile { generatedBy: string, manifestKey: string, units: { identity: string, key: string, bytes: string }[], database: Obj }
    const fixture = JSON.parse(readFileSync(new URL('./moduleIndexPreB1.fixture.json', import.meta.url), 'utf8')) as FixtureFile

    function loaded(): { rig: Rig, tree: Pick<EncodedTree, 'manifestKey' | 'manifest'> } {
        const rig = makeRig(500, 7200)
        for (const unit of fixture.units) {
            rig.store.set(unit.key, new Uint8Array(Buffer.from(unit.bytes, 'base64')))
        }
        const manifestBytes = rig.store.get(fixture.manifestKey)
        const manifest = manifestBytes === undefined ? undefined : readUnit(manifestBytes, UNIT_TYPE.manifest)
        if (manifest === undefined || manifest.status !== 'ok') {
            throw new Error('The fixture manifest does not parse.')
        }
        return { rig, tree: { manifestKey: fixture.manifestKey, manifest: manifest.value.body as Manifest } }
    }

    test('guard: the fixture was written by a build before the tag, so every entry unit has three elements', () => {
        const { rig, tree } = loaded()
        const index = storedIndex(rig, tree)
        expect(index.entries.length).toBeGreaterThanOrEqual(3)
        for (const entry of index.entries) {
            expect(entry.unit).toHaveLength(3)
            expect(entry.mcp).toBeUndefined()
        }
        expect(moduleHandles(index.entries)).toContain('dup#1')
    })

    test('entry-rewrite-adds-tag: reproducer, one module-flagged pass rewrites exactly the index and the manifest, then the next is unchanged', async () => {
        const { rig, tree } = loaded()
        const previous = previousOfTree({ manifestKey: tree.manifestKey, manifest: tree.manifest, source: { get: key => rig.store.get(key) } })
        const database = asDatabase(JSON.parse(JSON.stringify(fixture.database)) as Obj)
        const before = storedIndex(rig, tree)

        const stamping = await rig.pass(database, previous, MODS, 2)
        expect(stamping.plan.unchanged).toBe(false)
        expect(unitsToWrite(stamping.tree).map(unit => unit.identity).sort()).toEqual(['manifest', 'moduleIndex'])
        const index = indexOfTree(stamping.tree)
        expect(index.entries).toHaveLength(before.entries.length)
        index.entries.forEach((entry, position) => {
            expect(hasCurrentEntryFields(entry), `tag of entry ${position}`).toBe(true)
            expect(entry.unit.slice(0, 3), `module unit of entry ${position} is the reused one`).toEqual(before.entries[position].unit)
            expect(entry.al, `asset list of entry ${position} is the reused one`).toEqual(before.entries[position].al)
            expect(entry.il, `inlay list of entry ${position} is the reused one`).toEqual(before.entries[position].il)
        })
        expect(index.entries[0].mcp, 'the entry fields are derived again').toBe(true)
        rig.persist(stamping.tree)

        const settled = await rig.pass(database, rig.boot(stamping.tree), MODS, 3)
        expect(settled.plan.unchanged).toBe(true)
    })
})

describe('parsing the entry fields', () => {
    const head = (tail: string): [string, number, number] => [tail, 10, 1]
    const bodyOf = (entry: Record<string, unknown>) => ({
        v: 1,
        entries: [{
            id: 'm', unit: [...head('u-aaaaaaaaaaaaaaaaaaaaaaaaaa'), 1], al: [...head('u-bbbbbbbbbbbbbbbbbbbbbbbbbb'), 1], il: null,
            name: 'n', description: '', hasToggle: false, dsp: true, ...entry,
        }],
    })
    const parsedEntry = (entry: Record<string, unknown>): ModuleEntry => {
        const parsed = readUnit(encodeUnit(UNIT_TYPE.moduleIndex, bodyOf(entry) as never), UNIT_TYPE.moduleIndex)
        if (parsed.status !== 'ok') {
            throw new Error('The index does not parse.')
        }
        return (parsed.value.body as ModuleIndex).entries[0]
    }

    test('new-entry-fields-parse: guard, the stored bytes keep the tag as written and mcp as a boolean', () => {
        const entry = parsedEntry({ mcp: true })
        expect(entry.unit).toEqual(['u-aaaaaaaaaaaaaaaaaaaaaaaaaa', 10, 1, 1])
        expect(hasCurrentEntryFields(entry)).toBe(true)
        expect(entry.mcp).toBe(true)
        expect(parsedEntry({ mcp: false }).mcp).toBe(false)
    })

    test.each([['a string', 'yes'], ['a number', 1], ['null', null], ['an object', { url: 'x' }], ['an array', []]] as const)(
        'bad-type-field-reads-absent: reproducer, mcp as %s reads as absent',
        (_label, value) => {
            const entry = parsedEntry({ mcp: value })
            expect('mcp' in entry).toBe(false)
            expect(entry.unit).toHaveLength(4)
        },
    )

    test.each([[2], ['1'], [null], [true], [0], [[1]]] as const)('bad-type-field-reads-absent: a tag of %j is not the current tag', (tag) => {
        const entry = parsedEntry({ unit: [...head('u-aaaaaaaaaaaaaaaaaaaaaaaaaa'), tag] })
        expect(hasCurrentEntryFields(entry)).toBe(false)
    })

    test('bad-type-field-reads-absent: a missing tag is not the current tag, and the tag 1 is', () => {
        expect(hasCurrentEntryFields(parsedEntry({ unit: head('u-aaaaaaaaaaaaaaaaaaaaaaaaaa') }))).toBe(false)
        expect(hasCurrentEntryFields(parsedEntry({ unit: [...head('u-aaaaaaaaaaaaaaaaaaaaaaaaaa'), 1] }))).toBe(true)
    })

    test('guard: parseModuleIndex reads the entry fields straight from a body', () => {
        const parsed = parseModuleIndex(bodyOf({ mcp: true }) as never)
        expect(parsed.status).toBe('ok')
    })
})

describe('entry fields derived from a module', () => {
    test('reproducer: mcp is written only as true, only for a non-null object', () => {
        expect(moduleEntryFields(mod('x', { mcp: { url: 'u' } })).mcp).toBe(true)
        expect(moduleEntryFields(mod('x', { mcp: [] })).mcp).toBe(true)
        for (const value of [null, 'text', 3, false, true, undefined]) {
            expect('mcp' in moduleEntryFields(mod('x', { mcp: value as never })), `mcp ${String(value)}`).toBe(false)
        }
        expect('mcp' in moduleEntryFields(mod('x'))).toBe(false)
    })

    test('duplicate-or-empty-id-fields-dropped: guard, an unknown field is carried only for a unique non-empty id', () => {
        const entry = (id: string, extra: Record<string, unknown>): ModuleEntry => ({
            ...moduleEntryFields(mod(id)), id, unit: ['u-aaaaaaaaaaaaaaaaaaaaaaaaaa', 1, 1, 1], al: ['u-bbbbbbbbbbbbbbbbbbbbbbbbbb', 1, 1, 1], il: null, ...extra,
        } as ModuleEntry)
        const previous: ModuleIndex = { v: 1, entries: [entry('only', { future: 'a' }), entry('twice', { future: 'b' }), entry('twice', { future: 'c' }), entry('', { future: 'd' })] }
        const next: ModuleIndex = { v: 1, entries: [entry('only', {}), entry('twice', {}), entry('twice', {}), entry('', {})] }
        const carried = carryModuleIndex(previous, next).entries as unknown as Record<string, unknown>[]
        expect(carried[0].future).toBe('a')
        expect(carried[1].future).toBeUndefined()
        expect(carried[2].future).toBeUndefined()
        expect(carried[3].future).toBeUndefined()
    })
})
