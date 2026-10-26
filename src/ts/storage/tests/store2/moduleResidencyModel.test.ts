// @vitest-environment node
import fc from 'fast-check'
import { describe, expect, test } from 'vitest'
import {
    ASSET_REF_V, encodeUnit, IL_REF_V, keyOfRef, newUnitKey, readUnit, UNIT_TYPE,
    type CommitKey, type Manifest, type ModuleEntry, type ModuleIndex, type Ref, type UnitType,
} from '../../store2/format'
import type { ListRef } from '../../store2/format'
import { gcPass } from '../../store2/gc/pass'
import { markLiveKeys } from '../../store2/gc/mark'
import { createListDerivation, deriveInlayList } from '../../store2/lists'
import { MODULE_STUB_KEY, MODULE_STUB_VALUE } from '../../moduleStub'
import { moduleStubOf } from '../../store2/moduleStubMatch'
import { StubRefusedError } from '../../store2/codec/types'
import type { SaveEncoder, SavePassRequest } from '../../store2/saveEncoder'
import type { Database } from '../../database.svelte'
import { startStore2, testEnv, createClock, type Hooks, type Store2Kit } from '../store2SaveKit'
import { asDatabase, buildSmall, type Obj } from './codecFixtures'

/**
 * A model of module residency over the real save encoder and committer (CHORE-205 L3 stage B2b): random sequences of
 * edits, deletes, reorders, adds, stub mints, injected and edited stubs, duplicate ids, list-version bumps, save mine,
 * whole passes, module-scope-off passes, commit failures and loads. The live database holds some modules as stubs; the
 * truth model holds every module in full. After every committed pass the saved database must equal the truth the last
 * module-scope commit saw, and every unit the committed module index names must be in the store. A stub that cannot be
 * carried must be refused with the reason a reference function (independent of `stubEligible` and of the leaf's
 * comparison) gives, and nothing is acknowledged then.
 */

const MARKER = MODULE_STUB_KEY

interface Slot {
    live: Obj
    /** The module in full; null for an injected stub that stands for no module. */
    truth: Obj | null
}

interface Model {
    kit: Store2Kit
    live: { modules: Obj[] }
    slots: Slot[]
    /** The modules the last committed module-scope pass saved, in index order. */
    ackTruth: Obj[]
    nextId: number
    /** An acknowledged entry was altered in memory since the last committed module-scope pass. */
    tampered: boolean
    fail: { armed: boolean }
    /** Stubs carried by committed passes in this run. */
    carried: number
    trace: string[]
}

type Op =
    | { kind: 'edit', at: number }
    | { kind: 'delete', at: number }
    | { kind: 'swap', at: number, to: number }
    | { kind: 'add' }
    | { kind: 'mint', at: number }
    | { kind: 'inject', at: number, duplicate: boolean }
    | { kind: 'dup', at: number, to: number }
    | { kind: 'write', at: number, mode: 0 | 1, repair: 0 | 1 | 2 }
    | { kind: 'rewriteAll' }
    | { kind: 'whole' }
    | { kind: 'moduleOff' }
    | { kind: 'bump', at: number, which: 0 | 1 | 2 }
    | { kind: 'failRetry' }
    | { kind: 'load', at: number }
    | { kind: 'namespace', at: number, which: 0 | 1 }
    | { kind: 'ensure', which: 0 | 1 }
    | { kind: 'plain' }

const STEPS = 30
const RUNS = 200
const SEED = 20261026

function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T
}

/** JSON text with sorted object keys: the reference's equality, apart from the code under test. */
function stable(value: unknown): string {
    return JSON.stringify(value, (_key, item: unknown) => {
        if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
            return Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
        }
        return item
    })
}

const isStub = (module: Obj): boolean => Object.hasOwn(module, MARKER) && module[MARKER] === MODULE_STUB_VALUE

function handlesOf(ids: string[]): string[] {
    const seen = new Map<string, number>()
    return ids.map((id) => {
        const occurrence = seen.get(id) ?? 0
        seen.set(id, occurrence + 1)
        return `${id}#${occurrence}`
    })
}

function moduleIndexOf(encoder: SaveEncoder): ModuleIndex {
    const index = encoder.acknowledged().objects?.moduleIndex
    if (index === undefined) {
        throw new Error('The acknowledged encoding holds no module index.')
    }
    return index
}

const ownedModuleIdentity = (identity: string): boolean => identity.startsWith('module:') || identity.startsWith('al:module:') || identity.startsWith('il:module:')

/** The expected text of the stub minted from `entry`, written out here and not taken from the leaf. */
function recordedStubText(entry: ModuleEntry): string {
    return stable({ ...entry, unit: entry.unit.slice(), al: entry.al.slice(), il: entry.il === null ? null : entry.il.slice(), [MARKER]: MODULE_STUB_VALUE })
}

/** What the runs exercised, printed once so a model that stops reaching a branch is visible. */
const stats = { commits: 0, edited: 0, uncarriable: 0, failRetry: 0, unchangedChecks: 0, undigestedRuns: 0 }

type Verdict = { kind: 'commit', carried: string[] } | { kind: 'refuse', reason: 'edited' | 'uncarriable' }

/** What a pass must do with the live modules, by the written rules and nothing from the encoder. */
function reference(model: Model, moduleScope: boolean): Verdict {
    if (!moduleScope) {
        return { kind: 'commit', carried: [] }
    }
    const modules = model.live.modules
    const ids = modules.map(module => String(module.id ?? ''))
    const handles = handlesOf(ids)
    const index = moduleIndexOf(model.kit.encoder)
    const recorded = new Map(handlesOf(index.entries.map(entry => entry.id)).map((handle, position) => [handle, index.entries[position]]))
    const carried: string[] = []
    for (let position = 0; position < modules.length; position++) {
        if (!isStub(modules[position])) {
            continue
        }
        const entry = recorded.get(handles[position])
        const shaped = entry !== undefined && Array.isArray(entry.unit) && Array.isArray(entry.al) && (entry.il === null || Array.isArray(entry.il))
        if (!shaped || entry.id !== ids[position]) {
            return { kind: 'refuse', reason: 'uncarriable' }
        }
        if (stable(modules[position]) !== recordedStubText(entry)) {
            return { kind: 'refuse', reason: 'edited' }
        }
        // The units an entry names are always in the acknowledged encoding in this model, so a pass that cannot find one
        // has lost a carried unit and must not be taken for a refusal the rules ask for.
        const id = ids[position]
        const eligible = id.length > 0 && !id.startsWith('~') && ids.filter(other => other === id).length === 1
            && entry.unit[3] === 1 && entry.al[3] === ASSET_REF_V && entry.il !== null && entry.il[3] === IL_REF_V
        if (!eligible) {
            return { kind: 'refuse', reason: 'uncarriable' }
        }
        carried.push(handles[position])
    }
    return { kind: 'commit', carried }
}

// ---- the presence-and-type check ----

/** Throws unless every unit the committed module index names is in `snapshot` and decodes as the expected type. */
function expectIndexUnitsPresent(snapshot: ReadonlyMap<string, Uint8Array>, commit: CommitKey): number {
    const manifestKey = (commit.current as { key: string }).key
    const manifestBytes = snapshot.get(manifestKey)
    if (manifestBytes === undefined) {
        throw new Error('The current manifest is not stored.')
    }
    const manifest = readUnit(manifestBytes, UNIT_TYPE.manifest)
    if (manifest.status !== 'ok') {
        throw new Error(`The current manifest is ${manifest.status}.`)
    }
    const indexBytes = snapshot.get(keyOfRef((manifest.value.body as Manifest).fixed.moduleIndex))
    if (indexBytes === undefined) {
        throw new Error('The module index is not stored.')
    }
    const index = readUnit(indexBytes, UNIT_TYPE.moduleIndex)
    if (index.status !== 'ok') {
        throw new Error(`The module index is ${index.status}.`)
    }
    let checked = 0
    for (const entry of (index.value.body as unknown as ModuleIndex).entries) {
        const named: [string, Ref | ListRef | null, UnitType][] = [
            ['unit', entry.unit, UNIT_TYPE.module], ['al', entry.al, UNIT_TYPE.assetList], ['il', entry.il, UNIT_TYPE.inlayList],
        ]
        for (const [label, ref, type] of named) {
            if (ref === null) {
                continue
            }
            const bytes = snapshot.get(keyOfRef(ref as Ref))
            if (bytes === undefined) {
                throw new Error(`The ${label} unit of module ${entry.id} is named by the index and not stored.`)
            }
            const parsed = readUnit(bytes, type)
            if (parsed.status !== 'ok') {
                throw new Error(`The ${label} unit of module ${entry.id} is ${parsed.status}.`)
            }
            checked++
        }
    }
    return checked
}

async function expectPresent(model: Model): Promise<void> {
    expectIndexUnitsPresent(model.kit.memory.snapshot(), await model.kit.commitKey())
    const marked = await markLiveKeys(model.kit.memory, await model.kit.memory.readCommit())
    expect(marked.status).toBe('marked')
}

async function expectSavedIsTruth(model: Model): Promise<void> {
    const saved = (await model.kit.saved()).modules as unknown as Obj[]
    expect(saved.map(module => stable(module)), model.trace.join(' > ')).toEqual(model.ackTruth.map(module => stable(module)))
}

// ---- the model ----

function sync(model: Model): void {
    model.live.modules = model.slots.map(slot => slot.live)
}

function freshModule(model: Model): Obj {
    const id = `m${model.nextId++}`
    return { id, name: `Module ${id}`, description: 'd0', rev: 0, assets: [], lorebook: [{ content: `text ${id}` }] }
}

/** The recorded entry for the live slot at `position`, by handle; undefined when the acknowledged index holds none. */
function entryFor(model: Model, position: number): { entry: ModuleEntry, ackPosition: number } | undefined {
    const live = handlesOf(model.live.modules.map(module => String(module.id ?? '')))
    const index = moduleIndexOf(model.kit.encoder)
    const ackPosition = handlesOf(index.entries.map(entry => entry.id)).indexOf(live[position])
    return ackPosition < 0 ? undefined : { entry: index.entries[ackPosition], ackPosition }
}

/** Whether the slot at `position` is a resident module the acknowledged index holds exactly as the truth has it. */
function mintable(model: Model, position: number): boolean {
    const slot = model.slots[position]
    if (slot === undefined || slot.truth === null || isStub(slot.live) || stable(slot.live) !== stable(slot.truth)) {
        return false
    }
    const found = entryFor(model, position)
    return found !== undefined && model.ackTruth[found.ackPosition] !== undefined && stable(model.ackTruth[found.ackPosition]) === stable(slot.truth)
}

type Repair = { kind: 'loadAll' } | { kind: 'write', slot: Slot, choice: 0 | 1 | 2 }

interface Applied {
    request: Partial<SavePassRequest>
    failFirst: boolean
    repair: Repair
}

function applyOp(model: Model, op: Op): Applied {
    const applied: Applied = { request: {}, failFirst: false, repair: { kind: 'loadAll' } }
    const count = model.slots.length
    const at = count === 0 ? -1 : ('at' in op ? op.at % count : -1)
    const slot = at >= 0 ? model.slots[at] : undefined
    model.trace.push(op.kind + (at >= 0 ? `@${at}` : ''))
    switch (op.kind) {
        case 'edit':
            if (slot?.truth && !isStub(slot.live)) {
                slot.truth.description = `d${model.nextId++}`
                slot.truth.rev = Number(slot.truth.rev) + 1
                slot.live = clone(slot.truth)
            }
            break
        case 'delete':
            if (slot !== undefined) {
                model.slots.splice(at, 1)
            }
            break
        case 'swap':
            if (slot !== undefined) {
                const to = op.to % count
                ;[model.slots[at], model.slots[to]] = [model.slots[to], model.slots[at]]
            }
            break
        case 'add': {
            const module = freshModule(model)
            model.slots.push({ live: clone(module), truth: module })
            break
        }
        case 'mint':
            if (slot !== undefined && mintable(model, at)) {
                const found = entryFor(model, at)
                slot.live = moduleStubOf(found!.entry) as Obj
            }
            break
        case 'inject': {
            const donor = model.slots[(op.at + 1) % Math.max(count, 1)]
            const id = op.duplicate && donor !== undefined ? String(donor.live.id) : `ghost${model.nextId++}`
            model.slots.splice(Math.min(Math.max(op.at, 0), count), 0, { live: { id, name: 'Injected', description: '', [MARKER]: MODULE_STUB_VALUE }, truth: null })
            break
        }
        case 'dup':
            if (slot?.truth && !isStub(slot.live)) {
                const target = model.slots[op.to % count]
                if (target.truth && !isStub(target.live) && target !== slot) {
                    target.truth.id = slot.truth.id
                    target.live = clone(target.truth)
                }
            }
            break
        case 'write':
            if (slot?.truth && isStub(slot.live)) {
                if (op.mode === 0) {
                    slot.live.lorebook = []
                } else {
                    slot.live.name = `${String(slot.live.name)} edited`
                }
                applied.repair = { kind: 'write', slot, choice: op.repair }
            }
            break
        case 'rewriteAll':
            applied.request = { rewriteAll: true }
            break
        case 'whole':
            applied.request = { whole: true }
            break
        case 'moduleOff':
            applied.request = { modules: false }
            break
        case 'bump':
            if (slot !== undefined && mintable(model, at)) {
                const found = entryFor(model, at)!
                if (op.which === 0) {
                    ;(found.entry.al as unknown[])[3] = 99
                } else if (op.which === 1) {
                    ;(found.entry.il as unknown[])[3] = 99
                } else {
                    found.entry.unit = found.entry.unit.slice(0, 3) as Ref
                }
                model.tampered = true
                slot.live = moduleStubOf(found.entry) as Obj
            }
            break
        case 'failRetry':
            applied.failFirst = true
            break
        case 'load':
            if (slot !== undefined && isStub(slot.live)) {
                if (slot.truth === null) {
                    model.slots.splice(at, 1)
                } else {
                    slot.live = clone(slot.truth)
                }
            }
            break
        case 'namespace':
            // A namespace is part of the recorded entry, so a stub minted from it carries the namespace a reference by
            // namespace finds it by.
            if (slot?.truth && !isStub(slot.live)) {
                slot.truth.namespace = `ns${op.which}`
                slot.live = clone(slot.truth)
            }
            break
        case 'ensure':
            // What the ensure step does: every stub a namespace reference names is replaced by its module in full.
            for (const candidate of model.slots) {
                if (candidate.truth !== null && isStub(candidate.live) && candidate.truth.namespace === `ns${op.which}`) {
                    candidate.live = clone(candidate.truth)
                }
            }
            break
        case 'plain':
            break
    }
    sync(model)
    return applied
}

function repairAll(model: Model, how: Repair): void {
    if (how.kind === 'write') {
        const position = model.slots.indexOf(how.slot)
        if (position >= 0 && how.choice === 2) {
            model.slots.splice(position, 1)
        } else if (position >= 0 && how.choice === 0) {
            const found = entryFor(model, position)
            if (found !== undefined) {
                how.slot.live = moduleStubOf(found.entry) as Obj
            } else if (how.slot.truth !== null) {
                how.slot.live = clone(how.slot.truth)
            }
        } else if (position >= 0 && how.slot.truth !== null) {
            how.slot.live = clone(how.slot.truth)
        }
    } else {
        model.slots = model.slots.filter(slot => !(isStub(slot.live) && slot.truth === null))
        for (const slot of model.slots) {
            if (isStub(slot.live) && slot.truth !== null) {
                slot.live = clone(slot.truth)
            }
        }
    }
    sync(model)
}

const modulesDigested = (model: Model): boolean => [...model.kit.encoder.acknowledged().units]
    .filter(([identity]) => ownedModuleIdentity(identity)).every(([, unit]) => unit.digest !== undefined)

async function land(model: Model, request: SavePassRequest, applied: Applied, verdict: Extract<Verdict, { kind: 'commit' }>): Promise<void> {
    const kit = model.kit
    const db = model.live as unknown as Database
    const cleanBefore = request.modules && !request.whole && request.rewriteAll !== true && !applied.failFirst
        && !model.tampered && model.slots.every(slot => slot.truth !== null)
        && stable(model.slots.map(slot => slot.truth)) === stable(model.ackTruth) && modulesDigested(model)
    const entriesBefore = new Map(moduleIndexOf(kit.encoder).entries.map(entry => [entry.id, stable(entry)]))
    const keysBefore = new Map([...kit.encoder.acknowledged().units].filter(([identity]) => ownedModuleIdentity(identity)).map(([identity, unit]) => [identity, unit.key]))
    if (applied.failFirst) {
        model.fail.armed = true
        const doomed = await kit.encoder.plan(db, request)
        let landed = false
        try {
            landed = (await kit.committer.commit(await kit.committer.readCommit(), doomed.commitRequest())).status === 'committed'
        } catch {
            landed = false
        }
        expect(landed, 'the injected failure stops the commit').toBe(false)
        expect(model.fail.armed).toBe(false)
    }
    const plan = await kit.encoder.plan(db, request)
    const result = await kit.committer.commit(await kit.committer.readCommit(), plan.commitRequest())
    expect(result.status, model.trace.join(' > ')).toBe('committed')
    plan.acknowledge()
    stats.commits++
    if (applied.failFirst) {
        stats.failRetry++
    }
    if (cleanBefore) {
        stats.unchangedChecks++
        expect(plan.unchanged, `an untouched module list plans no unit: ${model.trace.join(' > ')}`).toBe(true)
    }
    if (request.modules) {
        model.ackTruth = model.slots.flatMap(slot => (slot.truth === null ? [] : [clone(slot.truth)]))
        model.tampered = false
    }
    if (request.modules && verdict.carried.length > 0) {
        const index = moduleIndexOf(kit.encoder)
        const handles = handlesOf(index.entries.map(entry => entry.id))
        for (const handle of verdict.carried) {
            const entry = index.entries[handles.indexOf(handle)]
            expect(stable(entry), `the carried entry of ${handle}`).toBe(entriesBefore.get(entry.id))
            for (const identity of [`module:${handle}`, `al:module:${handle}`, `il:module:${handle}`]) {
                expect(kit.encoder.acknowledged().units.get(identity)?.key, identity).toBe(keysBefore.get(identity))
            }
        }
        model.carried += verdict.carried.length
    }
    await expectSavedIsTruth(model)
    await expectPresent(model)
}

async function runPass(model: Model, applied: Applied): Promise<void> {
    const request: SavePassRequest = { marked: new Set(), modules: true, whole: false, ...applied.request }
    const verdict = reference(model, request.modules || request.whole || request.rewriteAll === true)
    if (verdict.kind === 'commit') {
        await land(model, request, applied, verdict)
        return
    }
    const manifestBefore = model.kit.encoder.manifestKey
    const commitBefore = await model.kit.commitKey()
    let thrown: unknown
    try {
        await model.kit.encoder.plan(model.live as unknown as Database, request)
    } catch (error) {
        thrown = error
    }
    expect(thrown, `a stub that cannot be carried is refused: ${model.trace.join(' > ')}`).toBeInstanceOf(StubRefusedError)
    expect((thrown as StubRefusedError).kind).toBe('module')
    expect((thrown as StubRefusedError).reason, model.trace.join(' > ')).toBe(verdict.reason)
    expect(model.kit.encoder.manifestKey).toBe(manifestBefore)
    expect(await model.kit.commitKey()).toEqual(commitBefore)
    stats[verdict.reason]++
    repairAll(model, applied.repair)
    let retry = reference(model, request.modules || request.whole || request.rewriteAll === true)
    if (retry.kind === 'refuse') {
        repairAll(model, { kind: 'loadAll' })
        retry = reference(model, request.modules || request.whole || request.rewriteAll === true)
    }
    expect(retry.kind, 'after the repair the pass can be committed').toBe('commit')
    await land(model, request, applied, retry as Extract<Verdict, { kind: 'commit' }>)
}

async function sweep(model: Model, label: string): Promise<void> {
    model.trace.push(label)
    const orphan = newUnitKey(testEnv(createClock(), 9))
    await model.kit.memory.putUnit(orphan, encodeUnit(UNIT_TYPE.inlayList, deriveInlayList([{ id: 'orphan' }])))
    expect(model.kit.memory.snapshot().has(orphan)).toBe(true)
    const result = await gcPass({ backend: model.kit.memory, kind: 'indexeddb', idleReason: () => null })
    expect(result.status).toBe('done')
    expect(result.status === 'done' ? result.stopped : 'refused', `the sweep ran to its end: ${model.trace.join(' > ')}`).toBeUndefined()
    expect(model.kit.memory.snapshot().has(orphan), 'the sweep removed the planted orphan').toBe(false)
    await expectPresent(model)
    await expectSavedIsTruth(model)
}

async function newModel(undigested: boolean): Promise<Model> {
    const modules: Obj[] = []
    for (let id = 0; id < 4; id++) {
        modules.push({ id: `m${id}`, name: `Module m${id}`, description: 'd0', rev: 0, assets: [], lorebook: [{ content: `text m${id}` }] })
    }
    const fail = { armed: false }
    const hooks: Hooks = {
        before: async (name) => {
            if (fail.armed && name === 'commitOrdinary') {
                fail.armed = false
                throw new Error('The injected commit failure.')
            }
        },
    }
    const seed = asDatabase({ ...(buildSmall(1) as unknown as Obj), modules: clone(modules) })
    const kit = await startStore2({ db: seed, lists: createListDerivation(), hooks })
    if (undigested) {
        for (const [identity, unit] of kit.encoder.acknowledged().units) {
            if (ownedModuleIdentity(identity)) {
                Object.assign(unit, { digest: undefined })
            }
        }
    }
    const model: Model = {
        kit,
        live: clone(seed) as unknown as { modules: Obj[] },
        slots: modules.map(module => ({ live: clone(module), truth: clone(module) })),
        ackTruth: clone(modules),
        nextId: 4,
        tampered: false,
        fail,
        carried: 0,
        trace: [],
    }
    sync(model)
    return model
}

const position = fc.nat(7)
const pick = <K extends 'edit' | 'delete' | 'mint' | 'load'>(kind: K): fc.Arbitrary<Op> => position.map((at): Op => ({ kind, at }))
const opArb: fc.Arbitrary<Op> = fc.oneof(
    { weight: 3, arbitrary: pick('edit') },
    { weight: 1, arbitrary: pick('delete') },
    { weight: 2, arbitrary: fc.tuple(position, position).map(([at, to]): Op => ({ kind: 'swap', at, to })) },
    { weight: 1, arbitrary: fc.constant<Op>({ kind: 'add' }) },
    { weight: 8, arbitrary: pick('mint') },
    { weight: 1, arbitrary: fc.tuple(position, fc.boolean()).map(([at, duplicate]): Op => ({ kind: 'inject', at, duplicate })) },
    { weight: 1, arbitrary: fc.tuple(position, position).map(([at, to]): Op => ({ kind: 'dup', at, to })) },
    { weight: 2, arbitrary: fc.tuple(position, fc.constantFrom<0 | 1>(0, 1), fc.constantFrom<0 | 1 | 2>(0, 1, 2)).map(([at, mode, repair]): Op => ({ kind: 'write', at, mode, repair })) },
    { weight: 1, arbitrary: fc.constant<Op>({ kind: 'rewriteAll' }) },
    { weight: 1, arbitrary: fc.constant<Op>({ kind: 'whole' }) },
    { weight: 1, arbitrary: fc.constant<Op>({ kind: 'moduleOff' }) },
    { weight: 1, arbitrary: fc.tuple(position, fc.constantFrom<0 | 1 | 2>(0, 1, 2)).map(([at, which]): Op => ({ kind: 'bump', at, which })) },
    { weight: 1, arbitrary: fc.constant<Op>({ kind: 'failRetry' }) },
    { weight: 2, arbitrary: pick('load') },
    { weight: 1, arbitrary: fc.tuple(position, fc.constantFrom<0 | 1>(0, 1)).map(([at, which]): Op => ({ kind: 'namespace', at, which })) },
    { weight: 1, arbitrary: fc.constantFrom<0 | 1>(0, 1).map((which): Op => ({ kind: 'ensure', which })) },
    { weight: 3, arbitrary: fc.constant<Op>({ kind: 'plain' }) },
)

describe('module residency model', () => {
    test('the presence check goes red for a unit the index names and the store lacks', async () => {
        const model = await newModel(false)
        const full = new Map(model.kit.memory.snapshot())
        const commit = await model.kit.commitKey()
        expect(expectIndexUnitsPresent(full, commit)).toBeGreaterThan(0)
        const entries = moduleIndexOf(model.kit.encoder).entries
        for (const ref of [entries[1].al, entries[2].unit, entries[0].il as ListRef]) {
            const scratch = new Map(full)
            expect(scratch.delete(keyOfRef(ref as Ref))).toBe(true)
            expect(() => expectIndexUnitsPresent(scratch, commit)).toThrow()
        }
    })

    test('the sweep guard: a planted orphan is removed and the committed units stay', async () => {
        const model = await newModel(false)
        model.live.modules[1] = moduleStubOf(moduleIndexOf(model.kit.encoder).entries[1]) as Obj
        model.slots[1].live = model.live.modules[1]
        await runPass(model, { request: {}, failFirst: false, repair: { kind: 'loadAll' } })
        expect(model.carried).toBe(1)
        await sweep(model, 'sweep')
    })

    test('random residency operations keep the saved modules equal to the truth, carry stubs and keep every named unit', async () => {
        const perRun: number[] = []
        const started = Date.now()
        await fc.assert(fc.asyncProperty(
            fc.array(opArb, { minLength: STEPS, maxLength: STEPS }),
            fc.integer({ min: 8, max: 22 }),
            fc.boolean(),
            async (ops, midSweep, undigested) => {
                const model = await newModel(undigested)
                stats.undigestedRuns += undigested ? 1 : 0
                for (let step = 0; step < ops.length; step++) {
                    const applied = applyOp(model, ops[step])
                    await runPass(model, applied)
                    if (step === midSweep) {
                        await sweep(model, 'mid-run sweep')
                    }
                }
                await sweep(model, 'final sweep')
                perRun.push(model.carried)
            },
        ), { numRuns: RUNS, seed: SEED })
        const carriedRuns = perRun.filter(count => count > 0).length
        const total = perRun.reduce((sum, count) => sum + count, 0)
        console.info(`module residency model: runs=${perRun.length} steps=${STEPS} seed=${SEED} runsWithCarry=${carriedRuns} totalStubCarries=${total} min=${Math.min(...perRun)} max=${Math.max(...perRun)} ms=${Date.now() - started} stats=${JSON.stringify(stats)}`)
        expect(perRun.length).toBe(RUNS)
        expect(total, `committed stub carries per run: ${perRun.join(',')}`).toBeGreaterThan(0)
        expect(carriedRuns / perRun.length, `committed stub carries per run: ${perRun.join(',')}`).toBeGreaterThan(0.9)
    }, 900_000)
})
