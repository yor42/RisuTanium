// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { UNIT_TYPE, type ModuleEntry, type ModuleIndex, type Ref } from '../../store2/format'
import { createListDerivation } from '../../store2/lists'
import { moduleBodyOf, uniqueIdHandles } from '../../store2/codec/modules'
import { stubEligible } from '../../store2/codec/split'
import { CodecInputError, StubRefusedError } from '../../store2/codec/types'
import { moduleStubOf } from '../../store2/moduleStubMatch'
import type { SaveEncoder, SavePassRequest, SavePlan } from '../../store2/saveEncoder'
import type { Database } from '../../database.svelte'
import { startStore2, type Store2Kit } from '../store2SaveKit'
import { asDatabase, buildSmall, type Obj } from './codecFixtures'
import type { ListDerivation, ReusableUnit } from '../../store2/codec'

/**
 * Carrying a module stub (CHORE-205 L3 stage B2b). A stub minted from its recorded index entry is carried: the entry
 * and the three previous units it names (module, asset list, inlay list) travel into the next acknowledged encoding
 * without a byte written. Every other stub is refused with a `StubRefusedError` of the module kind: `edited` when the
 * slot is not exactly the stub minted from its recorded entry, `uncarriable` when it cannot stand for it. After the
 * shape check, the edited check comes first, so a stub that differs from its entry never reaches a loader that would
 * drop the difference.
 *
 * Every pass here is a pass the way the loop runs one: a `SaveEncoder` plan, the committer's commit, then
 * `acknowledge`, over the real list derivation (the fake derivation makes no stub eligible).
 *
 * Labels: "reproducer" fails on the code before the carry; "guard" passes before and after.
 */

const MARKER_KEY = 'moduleStub'

function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T
}

function baseModules(): Obj[] {
    return [
        { id: 'm0', name: 'Zero', description: 'first', assets: [['a', `assets/${'ab'.repeat(32)}.png`]], lorebook: [{ content: 'zero' }] },
        { id: 'm1', name: 'One', description: 'plain', assets: [] },
        { id: 'm2', name: 'Two', description: 'third', trigger: [{ effect: 'two' }] },
    ]
}

const NOTHING_MARKED: SavePassRequest = { marked: new Set(), modules: true, whole: false }

interface World {
    kit: Store2Kit
    live: { modules: Obj[] }
    db(): Database
}

async function worldOf(modules: Obj[] = baseModules(), lists: ListDerivation = createListDerivation()): Promise<World> {
    const seed = asDatabase({ ...(buildSmall(1) as unknown as Obj), modules: clone(modules) })
    const kit = await startStore2({ db: seed, lists })
    const live = clone(seed) as unknown as { modules: Obj[] }
    return { kit, live, db: () => live as unknown as Database }
}

function moduleIndexOf(encoder: SaveEncoder): ModuleIndex {
    const index = encoder.acknowledged().objects?.moduleIndex
    if (index === undefined) {
        throw new Error('The acknowledged encoding holds no module index.')
    }
    return index
}

const entryAt = (world: World, position: number): ModuleEntry => moduleIndexOf(world.kit.encoder).entries[position]

/** Replaces the live module at `position` with the stub of its recorded entry. */
function mint(world: World, position: number): Obj {
    const stub = moduleStubOf(entryAt(world, position)) as Obj
    world.live.modules[position] = stub
    return stub
}

async function landPass(world: World, extra: Partial<SavePassRequest> = {}): Promise<SavePlan> {
    const kit = world.kit
    const plan = await kit.encoder.plan(world.db(), { ...NOTHING_MARKED, ...extra })
    const result = await kit.committer.commit(await kit.committer.readCommit(), plan.commitRequest())
    expect(result.status).toBe('committed')
    plan.acknowledge()
    return plan
}

async function thrownBy(run: () => Promise<unknown>): Promise<unknown> {
    try {
        await run()
    } catch (error) {
        return error
    }
    return undefined
}

async function expectRefused(world: World, reason: 'edited' | 'uncarriable', extra: Partial<SavePassRequest> = {}): Promise<StubRefusedError> {
    const manifestBefore = world.kit.encoder.manifestKey
    const commitBefore = await world.kit.commitKey()
    const error = await thrownBy(() => world.kit.encoder.plan(world.db(), { ...NOTHING_MARKED, ...extra }))
    expect(error).toBeInstanceOf(StubRefusedError)
    const refusal = error as StubRefusedError
    expect(refusal.kind).toBe('module')
    expect(refusal.reason).toBe(reason)
    expect(world.kit.encoder.manifestKey).toBe(manifestBefore)
    expect(await world.kit.commitKey()).toEqual(commitBefore)
    return refusal
}

const MODULE_IDENTITIES = (handle: string): string[] => [`module:${handle}`, `al:module:${handle}`, `il:module:${handle}`]

function writtenModuleUnits(world: World, mark: Map<string, Uint8Array>): string[] {
    return world.kit.writtenSince(mark).filter(name => name === 'module' || name === 'assetList' || name === 'inlayList')
}

describe('the fixture', () => {
    test('a freshly minted stub of the fixture is eligible, so the rows below can only see a refusal they cause', async () => {
        const world = await worldOf()
        const handles = uniqueIdHandles(moduleIndexOf(world.kit.encoder).entries)
        for (let position = 0; position < 3; position++) {
            expect(stubEligible(entryAt(world, position), handles, createListDerivation().moduleListVersions)).toBe(true)
        }
    })
})

describe('a stub equal to its recorded entry is carried', () => {
    test('stub-carried-not-written: reproducer. Nothing is written for it, its entry and three units travel on, and the next pass is unchanged too', async () => {
        const world = await worldOf()
        const previous = world.kit.encoder.acknowledged()
        const before = entryAt(world, 1)
        const unitsBefore = MODULE_IDENTITIES('m1#0').map(identity => ({ ...previous.units.get(identity)! }))
        mint(world, 1)
        const mark = new Map(world.kit.memory.snapshot())
        const plan = await landPass(world)
        expect(plan.unchanged).toBe(true)
        expect(writtenModuleUnits(world, mark)).toEqual([])
        const held = entryAt(world, 1)
        expect(held).toEqual(before)
        expect(held).not.toBe(before)
        expect(held.unit).toHaveLength(4)
        expect(held.unit[3]).toBe(1)
        const after = world.kit.encoder.acknowledged()
        MODULE_IDENTITIES('m1#0').forEach((identity, position) => {
            const unit = after.units.get(identity)
            expect(unit?.key, identity).toBe(unitsBefore[position].key)
            expect(unit?.type, identity).toBe(unitsBefore[position].type)
            expect(unit?.ref, identity).toEqual(unitsBefore[position].ref)
        })
        const second = await landPass(world)
        expect(second.unchanged).toBe(true)
        expect(entryAt(world, 1)).toEqual(before)
        expect(((await world.kit.saved()).modules as unknown as Obj[])[1]).toEqual(baseModules()[1])
    })

    test('carry-returns-fresh-entry: reproducer. On a pass that reuses the module index the held entry and its arrays are copies', async () => {
        const world = await worldOf()
        const before = entryAt(world, 1)
        const alBefore = [...before.al]
        mint(world, 1)
        await landPass(world)
        const held = entryAt(world, 1)
        expect(held).not.toBe(before)
        expect(held.al).not.toBe(before.al)
        expect(held.unit).not.toBe(before.unit)
        ;(held.al as unknown[]).push('changed')
        expect(before.al).toEqual(alBefore)
    })

    test('stub-carried-with-trailing-al-element: reproducer. A trailing element beyond the known Ref length is minted, carried and compared equal', async () => {
        const world = await worldOf()
        const recorded = entryAt(world, 1)
        ;(recorded.al as unknown[]).push('future')
        const stub = mint(world, 1)
        expect((stub.al as unknown[]).at(-1)).toBe('future')
        expect(stub.al).not.toBe(recorded.al)
        await landPass(world)
        expect(entryAt(world, 1).al).toEqual(recorded.al)
        expect(entryAt(world, 1).al).not.toBe(recorded.al)
        expect((entryAt(world, 1).al as unknown[]).at(-1)).toBe('future')
        expect((await landPass(world)).unchanged).toBe(true)
    })

    test('stub-carried-with-undigested-previous: reproducer. A previous unit with no digest (a boot read) is carried by its ref head', async () => {
        const world = await worldOf()
        const previous = world.kit.encoder.acknowledged()
        for (const identity of MODULE_IDENTITIES('m1#0')) {
            Object.assign(previous.units.get(identity)!, { digest: undefined })
        }
        mint(world, 1)
        const before = entryAt(world, 1)
        await landPass(world)
        expect(entryAt(world, 1)).toEqual(before)
    })

    test('stub-carried-under-rewriteAll: reproducer. The stub keeps its keys, the others are written anew, and the carried units have no digest', async () => {
        const world = await worldOf()
        const first = world.kit.encoder.acknowledged()
        const keysBefore = new Map(['m0#0', 'm1#0', 'm2#0'].map(handle => [handle, first.units.get(`module:${handle}`)!.key]))
        const stubKeys = MODULE_IDENTITIES('m1#0').map(identity => first.units.get(identity)!.key)
        mint(world, 1)
        await landPass(world, { rewriteAll: true })
        const after = world.kit.encoder.acknowledged()
        expect(after.units.get('module:m0#0')!.key).not.toBe(keysBefore.get('m0#0'))
        expect(after.units.get('module:m2#0')!.key).not.toBe(keysBefore.get('m2#0'))
        expect(MODULE_IDENTITIES('m1#0').map(identity => after.units.get(identity)!.key)).toEqual(stubKeys)
        for (const identity of MODULE_IDENTITIES('m1#0')) {
            expect(after.units.get(identity)!.digest, identity).toBeUndefined()
        }
        expect(((await world.kit.saved()).modules as unknown as Obj[])).toEqual(baseModules())
    })

    test('stub-carried-under-whole: reproducer. A whole pass carries the stub and writes nothing for it', async () => {
        const world = await worldOf()
        const stubKeys = MODULE_IDENTITIES('m1#0').map(identity => world.kit.encoder.acknowledged().units.get(identity)!.key)
        mint(world, 1)
        await landPass(world, { whole: true })
        expect(MODULE_IDENTITIES('m1#0').map(identity => world.kit.encoder.acknowledged().units.get(identity)!.key)).toEqual(stubKeys)
        expect(((await world.kit.saved()).modules as unknown as Obj[])).toEqual(baseModules())
    })

    test('a field set to undefined is dropped by the plain copy, so the stub still equals its entry', async () => {
        const world = await worldOf()
        const stub = mint(world, 1)
        stub.extra = undefined
        await landPass(world)
        expect(((await world.kit.saved()).modules as unknown as Obj[])[1]).toEqual(baseModules()[1])
    })

    test('guard: module-scope-off-stub-untouched. A pass that does not flag the modules writes no module unit with a stub resident', async () => {
        const world = await worldOf()
        mint(world, 1)
        const mark = new Map(world.kit.memory.snapshot())
        await landPass(world, { modules: false })
        expect(writtenModuleUnits(world, mark)).toEqual([])
        expect(entryAt(world, 1).id).toBe('m1')
    })
})

describe('a stub that differs from its entry is edited', () => {
    const EDITS: [string, (stub: Obj) => void][] = [
        ['name', (stub) => { stub.name = 'Renamed' }],
        ['hideIcon', (stub) => { stub.hideIcon = true }],
        ['unit', (stub) => { (stub.unit as unknown[])[0] = 'zz' }],
        ['a pushed field', (stub) => { stub.lorebook = [] }],
        ['a deleted field', (stub) => { delete stub.description }],
    ]

    test.each(EDITS)('edited-stub-refused-loudly: reproducer. %s', async (label, edit) => {
        const world = await worldOf()
        const stub = mint(world, 1)
        edit(stub)
        const refusal = await expectRefused(world, 'edited')
        expect(refusal.chaId).toBe('m1')
        expect(refusal.message).toContain('m1')
        expect(refusal.message).toContain('edited')
        expect(refusal.moduleName).toBe(label === 'name' ? 'Renamed' : 'One')
    })

    test('a slot whose marker value is not the stub value is not a stub and is stored as the module it is', async () => {
        const world = await worldOf()
        const stub = mint(world, 1)
        stub[MARKER_KEY] = 2
        await landPass(world)
        expect(((await world.kit.saved()).modules as unknown as Obj[])[1][MARKER_KEY]).toBe(2)
    })

    test('edited-and-ineligible-is-edited: reproducer. Both faults read as edited', async () => {
        const world = await worldOf([{ id: 'd', name: 'D0', description: '' }, { id: 'd', name: 'D1', description: '' }])
        const stub = mint(world, 1)
        stub.name = 'changed'
        await expectRefused(world, 'edited')
    })

    test('edited-and-locator-mismatch-is-edited: reproducer. Both faults read as edited', async () => {
        const world = await worldOf()
        const stub = mint(world, 1)
        stub.name = 'changed'
        const unit = world.kit.encoder.acknowledged().units.get('module:m1#0')!
        Object.assign(unit, { ref: ['zz', unit.ref[1], unit.ref[2]] })
        await expectRefused(world, 'edited')
    })
})

describe('a stub equal to its entry that cannot be carried is uncarriable', () => {
    type Tamper = (world: World, identity: string) => void
    const TAMPERS: [string, Tamper][] = [
        ['tail', (world, identity) => { const unit = world.kit.encoder.acknowledged().units.get(identity)!; Object.assign(unit, { ref: ['zz', ...unit.ref.slice(1)] }) }],
        ['bytes', (world, identity) => { const unit = world.kit.encoder.acknowledged().units.get(identity)!; Object.assign(unit, { ref: [unit.ref[0], Number(unit.ref[1]) + 1, ...unit.ref.slice(2)] }) }],
        ['crc', (world, identity) => { const unit = world.kit.encoder.acknowledged().units.get(identity)!; Object.assign(unit, { ref: [unit.ref[0], unit.ref[1], Number(unit.ref[2]) + 1, ...unit.ref.slice(3)] }) }],
        ['missing', (world, identity) => { (world.kit.encoder.acknowledged().units as Map<string, ReusableUnit>).delete(identity) }],
        ['wrong type', (world, identity) => { Object.assign(world.kit.encoder.acknowledged().units.get(identity)!, { type: UNIT_TYPE.statics }) }],
    ]
    const CASES = ['module:m1#0', 'al:module:m1#0', 'il:module:m1#0'].flatMap(identity => TAMPERS.map(([label, tamper]) => [`${identity} ${label}`, identity, tamper] as const))

    test.each(CASES)('locator-mismatch-is-uncarriable: reproducer. %s', async (_label, identity, tamper) => {
        const world = await worldOf()
        mint(world, 1)
        tamper(world, identity)
        await expectRefused(world, 'uncarriable')
    })

    test('index-present-entry-absent-is-uncarriable: reproducer. A stub whose handle the previous index does not hold', async () => {
        const world = await worldOf()
        const stub = mint(world, 1)
        stub.id = 'never-saved'
        world.live.modules[1] = stub
        const refusal = await expectRefused(world, 'uncarriable')
        expect(refusal.chaId).toBe('never-saved')
    })

    test('malformed-entry-is-uncarriable-not-typeerror: reproducer. A damaged recorded entry is refused, never a TypeError', async () => {
        for (const damage of [
            (entry: Obj) => { entry.il = undefined },
            (entry: Obj) => { entry.unit = 'x' },
            (entry: Obj) => { entry.al = null },
            (entry: Obj) => { entry.il = 'x' },
        ]) {
            const world = await worldOf()
            mint(world, 1)
            damage(entryAt(world, 1) as unknown as Obj)
            const refusal = await expectRefused(world, 'uncarriable')
            expect(refusal).toBeInstanceOf(StubRefusedError)
        }
    })

    test('ineligible-stub-refused-uncarriable: reproducer. Each is a stub equal to its entry, so only eligibility refuses it', async () => {
        const rows: [string, (world: World) => void, ListDerivation?][] = [
            ['al version stale', (world) => { (entryAt(world, 1).al as unknown[])[3] = 99 }],
            ['il version stale', (world) => { (entryAt(world, 1).il as unknown[])[3] = 99 }],
            ['il null', (world) => { entryAt(world, 1).il = null }],
            ['tag absent', (world) => { entryAt(world, 1).unit = entryAt(world, 1).unit.slice(0, 3) as Ref }],
            ['tag not 1', (world) => { (entryAt(world, 1).unit as unknown[])[3] = 2 }],
        ]
        for (const [label, damage] of rows) {
            const world = await worldOf()
            damage(world)
            mint(world, 1)
            await expectRefused(world, 'uncarriable')
            expect(label).not.toBe('')
        }
        const { moduleListVersions: _versions, ...withoutVersions } = createListDerivation()
        const plain = await worldOf(baseModules(), withoutVersions)
        mint(plain, 1)
        await expectRefused(plain, 'uncarriable')
    })

    test.each([
        ['empty id', [{ id: '', name: 'E', description: '' }, { id: 'x', name: 'X', description: '' }]],
        ['positional id', [{ id: '~p', name: 'P', description: '' }, { id: 'x', name: 'X', description: '' }]],
        ['duplicate id', [{ id: 'd', name: 'D0', description: '' }, { id: 'd', name: 'D1', description: '' }]],
    ] as [string, Obj[]][])('ineligible-stub-refused-uncarriable: reproducer. %s', async (_label, modules) => {
        const world = await worldOf(modules)
        mint(world, 0)
        await expectRefused(world, 'uncarriable')
    })

    test('duplicate-id-stub-refused: reproducer. Two stubs with one id are uncarriable, not a body error', async () => {
        const world = await worldOf([{ id: 'd', name: 'D0', description: '' }, { id: 'd', name: 'D1', description: '' }, { id: 'e', name: 'E', description: '' }])
        mint(world, 0)
        mint(world, 1)
        const refusal = await expectRefused(world, 'uncarriable')
        expect(refusal.kind).toBe('module')
        expect(refusal.chaId).toBe('d')
    })
})

describe('the handle set is the pass snapshot', () => {
    test('handles-from-pass-snapshot: reproducer. A duplicate pushed during a yield does not change this pass, and the next pass refuses', async () => {
        const world = await worldOf()
        mint(world, 1)
        let pushed = false
        const plan = await world.kit.encoder.plan(world.db(), {
            ...NOTHING_MARKED,
            yield: async () => {
                if (!pushed) {
                    pushed = true
                    world.live.modules.push({ id: 'm1', name: 'Late duplicate', description: '' })
                }
            },
        })
        const result = await world.kit.committer.commit(await world.kit.committer.readCommit(), plan.commitRequest())
        expect(result.status).toBe('committed')
        plan.acknowledge()
        expect(pushed).toBe(true)
        expect(moduleIndexOf(world.kit.encoder).entries.map(entry => entry.id)).toEqual(['m0', 'm1', 'm2'])
        await expectRefused(world, 'uncarriable')
    })

    test('stub-met-without-snapshot-stub: reproducer. A module that became a stub during a yield is refused by its own state, never carried on a set it was not part of', async () => {
        const world = await worldOf()
        const late = world.live.modules[2]
        const recorded = moduleStubOf(entryAt(world, 2)) as Obj
        const error = await thrownBy(() => world.kit.encoder.plan(world.db(), {
            ...NOTHING_MARKED,
            yield: async () => {
                for (const key of Object.keys(late)) {
                    delete late[key]
                }
                Object.assign(late, recorded)
            },
        }))
        expect(error).toBeInstanceOf(StubRefusedError)
        expect((error as StubRefusedError).reason).toBe('uncarriable')
    })

    test('a marker added to an unvisited module during a yield makes it edited', async () => {
        const world = await worldOf()
        const late = world.live.modules[2]
        const error = await thrownBy(() => world.kit.encoder.plan(world.db(), {
            ...NOTHING_MARKED,
            yield: async () => { late[MARKER_KEY] = 1 },
        }))
        expect(error).toBeInstanceOf(StubRefusedError)
        expect((error as StubRefusedError).reason).toBe('edited')
    })
})

describe('the body path', () => {
    test('guard: moduleBodyOf-stub-still-refuses. A stub reaching the body path is a CodecInputError', async () => {
        const world = await worldOf()
        const stub = moduleStubOf(entryAt(world, 1))
        expect(() => moduleBodyOf(stub)).toThrow(CodecInputError)
    })
})
