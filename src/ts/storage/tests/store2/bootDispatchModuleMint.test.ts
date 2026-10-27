// @vitest-environment node
/**
 * The boot's module mint (CHORE-205 L3 stage S4d-1m): which modules a real store2 boot opens as the stubs their index
 * entries stand for, what it reads to do so, and what it leaves resident. Every row boots through the real dispatch
 * over an in-memory backend with the real list derivation (`createListDerivation()`, which carries the list versions
 * stub eligibility needs; `fakeLists` has none, so a boot under it mints nothing). A mocked store says nothing about a
 * native backend.
 *
 * Labels: R rows fail on the base where no module is ever stubbed at boot; M rows need a new symbol and fail on the
 * base plus the seams with the planner returning every handle; G rows are compatibility guards that pass before and
 * after and get their teeth from a named mutant. "G (R precondition)" marks a guard whose row also asserts that stubs
 * were minted, so on the base it fails at that precondition while its own property (no boot ensure, an always-resident
 * module stays whole) is a guard checked by a mutant, not by the base.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    state: { db: undefined } as { db: unknown },
    /** The sets the module planner answered, in call order. */
    planned: [] as (ReadonlySet<string> | null)[],
}))

vi.mock(import('src/ts/alert'), () => ({
    alertError: vi.fn(),
    alertMd: vi.fn(),
    waitAlert: vi.fn(async () => { }),
    alertConfirm: vi.fn(async () => false),
}) as unknown as typeof import('src/ts/alert'))
vi.mock(import('src/ts/characters'), () => ({
    updateLorebooks: vi.fn((book: unknown[]) => book),
}) as unknown as typeof import('src/ts/characters'))
vi.mock(import('src/ts/stores.svelte'), async () => {
    const { writable } = await import('svelte/store')
    return {
        DBState: h.state,
        selectedCharID: writable(-1),
        selIdState: { selId: -1 },
        alertStore: writable({ type: 'none', msg: '' }),
        MobileGUI: writable(false),
        loadedStore: writable(false),
    } as unknown as typeof import('src/ts/stores.svelte')
})
vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))
vi.mock(import('src/ts/storage/store/appStore'), () => ({
    getAppStore: vi.fn(async () => ({
        read: async () => ({ bytes: null, version: null }),
        has: async () => false,
    })),
}) as unknown as typeof import('src/ts/storage/store/appStore'))
vi.mock(import('src/ts/process/modules'), () => ({
    refreshModules: vi.fn(),
    bumpModuleGui: vi.fn(),
}) as unknown as typeof import('src/ts/process/modules'))
// The wrapped functions still run: the spies record what the dispatch handed them and what the module planner answered.
vi.mock(import('src/ts/storage/store2/treeBytes'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        readTreeBytes: vi.fn((backend: Parameters<typeof actual.readTreeBytes>[0], manifestKey: string, options: Parameters<typeof actual.readTreeBytes>[2] = {}) => {
            const planner = options.residentModules
            return actual.readTreeBytes(backend, manifestKey, planner === undefined ? options : {
                ...options,
                residentModules: (input) => {
                    const answer = planner(input)
                    h.planned.push(answer)
                    return answer
                },
            })
        }),
    }
})
vi.mock(import('src/ts/process/moduleLoader'), async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, loadModule: vi.fn(actual.loadModule), loadModuleStubsOf: vi.fn(actual.loadModuleStubsOf) }
})

import { readFileSync } from 'node:fs'
import type { Database } from 'src/ts/storage/database.svelte'
import { crc32 } from 'src/ts/storage/blockFrame'
import { isModuleStub } from 'src/ts/storage/moduleStub'
import { resetPageBlockOwnerForTests } from 'src/ts/storage/pageBlockOwner'
import { getPageStorageMode, resetPageStorageModeForTests } from 'src/ts/storage/pageStorageMode'
import { createMemoryBackend, type MemoryBackend } from 'src/ts/storage/store2/backend'
import { dispatchStore2Boot } from 'src/ts/storage/store2/bootDispatch'
import { resetStore2BootForTest, type Store2BootResult } from 'src/ts/storage/store2/bootActive'
import { assembleDatabase, moduleHandles, previousFrom } from 'src/ts/storage/store2/codec'
import { classifyCommitRead, firstCommitKey } from 'src/ts/storage/store2/commitKey'
import { ASSET_REF_V, encodeUnit, IL_REF_V, keyOfRef, readUnit, UNIT_TYPE, type Manifest, type ModuleEntry, type ModuleIndex } from 'src/ts/storage/store2/format'
import { createListDerivation } from 'src/ts/storage/store2/lists/derive'
import { acquireModule, ModuleLoadError } from 'src/ts/storage/store2/moduleAcquire'
import { isRecordedStub } from 'src/ts/storage/store2/moduleStubMatch'
import { resetResidencyForTest } from 'src/ts/storage/store2/residencyActive'
import { residentModuleHandlesOf } from 'src/ts/storage/store2/residencyPolicy'
import { getActiveStore2Save, resetStore2SaveForTest } from 'src/ts/storage/store2/saveActive'
import { readTreeBytes } from 'src/ts/storage/store2/treeBytes'
import { loadModule, loadModuleStubsOf } from 'src/ts/process/moduleLoader'
import { createMemoryByteStore } from 'src/ts/process/files/tests/memoryByteStore'
import { bootThroughDispatch, countedBackend, createClock, createPeerDouble, fakeLists, savedDatabase, seedTree, testEnv, type CountedBackend, type Hooks } from '../store2SaveKit'
import { buildSmall, type Obj } from './codecFixtures'

type Plain = Record<string, unknown>

interface Rig {
    counted: CountedBackend
    manifestKey: string
    entries: ModuleEntry[]
    /** The call count the backend saw per method name. */
    calls: Map<string, number>
}

function moduleBody(id: string, extra: Obj = {}): Obj {
    return { id, name: `Module ${id}`, description: `about ${id}`, lorebook: [{ comment: 'c', content: `text ${id}`, key: 'k', alwaysActive: false, secondkey: '', selective: false, insertorder: 100, mode: 'normal', bookVersion: 2 }], regex: [], trigger: [], assets: [], ...extra }
}

/** The five modules of the reference rows, in an order that puts unreferenced ones before and between the referenced. */
function fiveModules(): Obj[] {
    return [moduleBody('idc'), moduleBody('ida'), moduleBody('idd'), moduleBody('idb', { namespace: 'ns-a' }), moduleBody('ide')]
}

/** Seeds `modules` and the top-level `settings` (archiving on unless said otherwise) into a counted backend, with the reads and writes of seeding forgotten. */
async function rigOf(modules: Obj[], settings: Obj = {}, seedLists = createListDerivation()): Promise<Rig> {
    const calls = new Map<string, number>()
    const hooks: Hooks = { before: (name, count) => { calls.set(name, count) } }
    const counted = countedBackend({ hooks })
    const source = { ...(buildSmall(2) as unknown as Obj), archiveCharacters: true, enabledModules: [], moduleIntergration: '', modules, ...settings } as unknown as Database
    const seeded = await seedTree(counted.memory, JSON.parse(JSON.stringify(source)) as Database, testEnv(createClock(), 4242), seedLists)
    counted.reset()
    calls.clear()
    const entries = previousFrom(seeded.tree).objects?.moduleIndex?.entries ?? []
    return { counted, manifestKey: seeded.manifestKey, entries, calls }
}

function opened(result: Store2BootResult): Extract<Store2BootResult, { kind: 'store2' }> {
    if (result.kind !== 'store2') {
        throw new Error(`The boot answered ${result.kind}.`)
    }
    return result
}

function slotsOf(result: Store2BootResult): Plain[] {
    return opened(result).database.modules as unknown as Plain[]
}

const stubbed = (slot: Plain): boolean => isModuleStub(slot as never)

/** Which of the modules (by id) the boot left as stubs. */
function stubIds(result: Store2BootResult): string[] {
    return slotsOf(result).filter(stubbed).map(slot => String(slot.id))
}

function keysOf(entry: ModuleEntry): string[] {
    return [entry.unit, entry.al, ...(entry.il === null ? [] : [entry.il])].map(ref => keyOfRef(ref as never))
}

function readsOf(rig: Rig, entry: ModuleEntry): string[] {
    const keys = new Set(keysOf(entry))
    return rig.counted.reads.filter(key => keys.has(key))
}

function entryOf(rig: Rig, id: string): ModuleEntry {
    const entry = rig.entries.find(candidate => candidate.id === id)
    if (entry === undefined) {
        throw new Error(`No index entry for ${id}.`)
    }
    return entry
}

function plain<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T
}

function withHeader(bytes: Uint8Array, edit: (header: Uint8Array) => void): Uint8Array {
    const out = new Uint8Array(bytes)
    edit(out.subarray(0, 12))
    new DataView(out.buffer, out.byteOffset + 12, 4).setUint32(0, crc32(out.subarray(0, 12)), true)
    return out
}

function flipped(memory: MemoryBackend, key: string): void {
    const bytes = memory.snapshot().get(key)
    if (bytes === undefined) {
        throw new Error(`${key} is not stored.`)
    }
    const copy = new Uint8Array(bytes)
    copy[copy.length - 1] ^= 0xff
    memory.poke(key, copy)
}

async function bootRig(rig: Rig, options: { lists?: ReturnType<typeof createListDerivation> } = {}) {
    const booted = await bootThroughDispatch(rig.counted.backend, { lists: options.lists ?? createListDerivation() })
    if (booted.result.kind === 'store2') {
        h.state.db = booted.result.database
    }
    return booted
}

/** One whole-tree module-flagged pass over `db` through the active save context, planned only. */
async function planPass(db: Database) {
    const context = getActiveStore2Save()
    if (context?.encoder === undefined) {
        throw new Error('No save context.')
    }
    return context.encoder.plan(db, { marked: new Set(), modules: true, whole: true })
}

/** The module index entries of the manifest the commit key currently names. */
async function storedModuleEntries(memory: MemoryBackend): Promise<ModuleEntry[]> {
    const classified = classifyCommitRead(await memory.readCommit())
    if (classified.status !== 'parsed' || classified.value.current === null) {
        throw new Error('The commit key names no current manifest.')
    }
    const stored = memory.snapshot()
    const manifest = readUnit(stored.get(classified.value.current.key) as Uint8Array, UNIT_TYPE.manifest)
    if (manifest.status !== 'ok') {
        throw new Error('The manifest does not parse.')
    }
    const index = readUnit(stored.get(keyOfRef((manifest.value.body as Manifest).fixed.moduleIndex)) as Uint8Array, UNIT_TYPE.moduleIndex)
    if (index.status !== 'ok') {
        throw new Error('The module index does not parse.')
    }
    return (index.value.body as ModuleIndex).entries
}

function resetPage(): void {
    resetStore2SaveForTest()
    resetResidencyForTest()
    resetStore2BootForTest()
    resetPageBlockOwnerForTests()
    resetPageStorageModeForTests()
}

beforeEach(() => {
    vi.clearAllMocks()
    h.planned.length = 0
    h.state.db = undefined
    resetPage()
    vi.spyOn(console, 'error').mockImplementation(() => { })
})

afterEach(() => {
    resetPage()
    vi.restoreAllMocks()
})

describe('the mint reads nothing of an unreferenced module (MC-643)', () => {
    test('R unreferenced-module-units-are-never-read-at-boot', async () => {
        const rig = await rigOf(fiveModules(), { enabledModules: ['ida'], moduleIntergration: ' ns-a , ' })
        const baseline = await rigOf([])

        const boot = await bootRig(rig)
        await bootRig(baseline)

        expect(stubIds(boot.result)).toEqual(['idc', 'idd', 'ide'])
        for (const id of ['idc', 'idd', 'ide']) {
            expect(readsOf(rig, entryOf(rig, id)), id).toEqual([])
        }
        for (const id of ['ida', 'idb']) {
            expect(readsOf(rig, entryOf(rig, id)).sort(), id).toEqual(keysOf(entryOf(rig, id)).sort())
        }
        expect(rig.calls.get('listStore2') ?? 0).toBe(baseline.calls.get('listStore2') ?? 0)
        expect(rig.calls.get('countPrefix') ?? 0).toBe(baseline.calls.get('countPrefix') ?? 0)
        expect(boot.notices.map(notice => notice.name)).toEqual([])
    })

    test('R boot-installs-recorded-stubs-in-index-order', async () => {
        const rig = await rigOf(fiveModules(), { enabledModules: ['ida'], moduleIntergration: ' ns-a , ' })
        const control = await rigOf(fiveModules(), { archiveCharacters: false })

        const boot = await bootRig(rig)
        const whole = await bootRig(control)

        const slots = slotsOf(boot.result)
        expect(slots.map(slot => slot.id)).toEqual(rig.entries.map(entry => entry.id))
        slots.forEach((slot, position) => {
            if (['idc', 'idd', 'ide'].includes(String(slot.id))) {
                expect(isRecordedStub(plain(slot) as never, rig.entries[position]), String(slot.id)).toBe(true)
            } else {
                expect(plain(slot), String(slot.id)).toEqual(plain(slotsOf(whole.result)[position]))
            }
        })
    })
})

describe('which global references keep a module resident', () => {
    test('R global-reference-by-id: the named module is whole and an unnamed sibling is a stub', async () => {
        const rig = await rigOf(fiveModules(), { enabledModules: ['idd'] })
        const boot = await bootRig(rig)
        expect(stubIds(boot.result)).toEqual(['idc', 'ida', 'idb', 'ide'])
    })

    test('R global-reference-by-namespace: the module holding the namespace is whole and an unnamed sibling is a stub', async () => {
        const rig = await rigOf(fiveModules(), { moduleIntergration: 'ns-a' })
        const boot = await bootRig(rig)
        expect(stubIds(boot.result)).toEqual(['idc', 'ida', 'idd', 'ide'])
    })

    test('R empty-segment-never-matches-a-namespace: a module with an empty namespace is still a stub', async () => {
        const modules = [moduleBody('idc', { namespace: '' }), moduleBody('ida', { namespace: 'ns-a' })]
        const rig = await rigOf(modules, { moduleIntergration: ' ns-a , ' })
        const boot = await bootRig(rig)
        expect(stubIds(boot.result)).toEqual(['idc'])
    })

    test('R padded-segments-are-trimmed: padded ids and namespaces match', async () => {
        const rig = await rigOf(fiveModules(), { moduleIntergration: '  ida , ns-a  ' })
        const boot = await bootRig(rig)
        expect(stubIds(boot.result)).toEqual(['idc', 'idd', 'ide'])
    })

    test('R archive-undefined-stubs-then-setting-written: a profile that never chose archiving still mints, and the next pass writes the setting', async () => {
        const rig = await rigOf(fiveModules(), { archiveCharacters: undefined })
        const boot = await bootRig(rig)

        expect(stubIds(boot.result)).toHaveLength(5)
        const database = opened(boot.result).database
        expect(database.archiveCharacters).toBe(true)
        expect(boot.notices.filter(notice => notice.name === 'archive-enabled')).toHaveLength(1)
        expect((await savedDatabase(rig.counted.memory)).archiveCharacters).toBeUndefined()
        const committer = getActiveStore2Save()?.session.committer
        const plan = await planPass(database)
        expect(plan.unchanged).toBe(false)
        expect((await committer?.commit(await committer.readCommit(), plan.commitRequest()))?.status).toBe('committed')
        plan.acknowledge()
        expect((await savedDatabase(rig.counted.memory)).archiveCharacters).toBe(true)
        expect(((await savedDatabase(rig.counted.memory)).modules as unknown as Plain[]).map(slot => slot.name)).toEqual(fiveModules().map(slot => slot.name))
    })

    test('R duplicate-id-modules-stay-resident: both holders are whole and a third, unique module is a stub', async () => {
        const rig = await rigOf([moduleBody('dup', { name: 'first' }), moduleBody('dup', { name: 'second' }), moduleBody('uniq')])
        const boot = await bootRig(rig)
        expect(stubIds(boot.result)).toEqual(['uniq'])
        expect(slotsOf(boot.result).slice(0, 2).map(slot => slot.name)).toEqual(['first', 'second'])
    })
})

describe('a unit of an unreferenced module that cannot be read does not fail the boot', () => {
    const parts = [['module unit', 'unit'], ['asset list', 'al'], ['inlay list', 'il']] as const

    test.each(parts)('R damaged %s: the boot opens, nothing is written, and the entry keeps the old unit', async (_label, part) => {
        const rig = await rigOf(fiveModules(), { enabledModules: ['ida'], moduleIntergration: 'ns-a' })
        const target = entryOf(rig, 'idc')
        flipped(rig.counted.memory, keyOfRef(target[part] as never))

        const boot = await bootRig(rig)

        expect(stubIds(boot.result)).toEqual(['idc', 'idd', 'ide'])
        expect(boot.notices.map(notice => notice.name)).toEqual([])
        const database = opened(boot.result).database
        const plan = await planPass(database)
        expect(plan.unchanged).toBe(true)
        // A pass that has something else to write commits, and the stored entry still names the old unit.
        database.globalNote = 'a changed global note'
        const committer = getActiveStore2Save()?.session.committer
        const written = await planPass(database)
        expect(written.unchanged).toBe(false)
        expect((await committer?.commit(await committer.readCommit(), written.commitRequest()))?.status).toBe('committed')
        written.acknowledge()
        expect((await storedModuleEntries(rig.counted.memory))[0]).toEqual(target)
        if (part === 'unit') {
            const error = await acquireModule('idc').then(() => null, (thrown: unknown) => thrown)
            expect(error).toBeInstanceOf(ModuleLoadError)
            expect((error as ModuleLoadError).reason).toBe('damaged')
            expect((error as ModuleLoadError).moduleId).toBe('idc')
        }
    })

    test.each(parts)('R missing %s: the boot opens and nothing is written', async (_label, part) => {
        const rig = await rigOf(fiveModules(), { enabledModules: ['ida'], moduleIntergration: 'ns-a' })
        rig.counted.memory.poke(keyOfRef(entryOf(rig, 'idc')[part] as never), null)

        const boot = await bootRig(rig)

        expect(stubIds(boot.result)).toEqual(['idc', 'idd', 'ide'])
        expect(boot.notices.map(notice => notice.name)).toEqual([])
        expect((await planPass(opened(boot.result).database)).unchanged).toBe(true)
        if (part === 'unit') {
            const error = await acquireModule('idc').then(() => null, (thrown: unknown) => thrown)
            expect((error as ModuleLoadError).reason).toBe('damaged')
        }
    })

    test('R unit-written-by-a-newer-build-of-an-unreferenced-module-boots-writable (MC-645)', async () => {
        const rig = await rigOf(fiveModules(), { enabledModules: ['ida'], moduleIntergration: 'ns-a' })
        const key = keyOfRef(entryOf(rig, 'idc').unit as never)
        rig.counted.memory.poke(key, withHeader(rig.counted.memory.snapshot().get(key) as Uint8Array, (header) => { header[4] = 9 }))

        const boot = await bootRig(rig)

        expect(getPageStorageMode()).toEqual({ kind: 'store2' })
        expect(boot.notices.map(notice => notice.name)).not.toContain('too-new')
        expect(stubIds(boot.result)).toEqual(['idc', 'idd', 'ide'])
        const plan = await planPass(opened(boot.result).database)
        expect(plan.unchanged).toBe(true)
        const error = await acquireModule('idc').then(() => null, (thrown: unknown) => thrown)
        expect(error).toBeInstanceOf(ModuleLoadError)
        expect((error as ModuleLoadError).reason).toBe('too-new')
        expect((error as ModuleLoadError).moduleId).toBe('idc')
    })
})

describe('the resident set is one object', () => {
    test('M planner-set-identity: a handle outside the planner set pushes no unit and is stubbed; a handle inside reads all its units and is whole', async () => {
        const rig = await rigOf(fiveModules(), { enabledModules: ['ida'], moduleIntergration: 'ns-a' })

        const boot = await bootRig(rig)

        expect(h.planned).toHaveLength(1)
        const planned = h.planned[0]
        expect(planned).not.toBeNull()
        const handles = moduleHandles(rig.entries)
        rig.entries.forEach((entry, position) => {
            const resident = planned?.has(handles[position]) === true
            expect(stubbed(slotsOf(boot.result)[position]), handles[position]).toBe(!resident)
            expect(readsOf(rig, entry).sort(), handles[position]).toEqual(resident ? keysOf(entry).sort() : [])
        })
        expect([...planned ?? []].sort()).toEqual(['ida#0', 'idb#0'])
    })

    test('M planner-callback-absent-or-index-body-missing-keeps-every-module-resident', async () => {
        const rig = await rigOf(fiveModules(), { enabledModules: [] })
        const everything = rig.entries.flatMap(keysOf).sort()

        for (const options of [{}, { residentModules: () => null }]) {
            rig.counted.reset()
            const read = await readTreeBytes(rig.counted.backend, rig.manifestKey, options)
            expect(read.status).toBe('ok')
            expect(rig.counted.reads.filter(key => everything.includes(key)).sort()).toEqual(everything)
        }
        const versions = createListDerivation().moduleListVersions
        expect(residentModuleHandlesOf({ config: {} }, versions)).toBeNull()
        expect(residentModuleHandlesOf({ modules: rig.entries, config: null }, versions)).toBeNull()
    })
})

describe('guards: what stays resident', () => {
    test('G archive-off-boots-every-module-resident', async () => {
        const rig = await rigOf(fiveModules(), { archiveCharacters: false })
        const boot = await bootRig(rig)
        expect(stubIds(boot.result)).toEqual([])
        expect(rig.entries.flatMap(keysOf).every(key => rig.counted.reads.includes(key))).toBe(true)
    })

    test.each([
        ['enabledModules is not an array', { enabledModules: 'ida' }],
        ['enabledModules holds a number', { enabledModules: ['ida', 4] }],
        ['moduleIntergration is not a string', { moduleIntergration: 5 }],
    ] as const)('G malformed-global-reference-list-boots-all-resident: %s', async (_label, settings) => {
        const rig = await rigOf(fiveModules(), settings)
        const boot = await bootRig(rig)
        expect(stubIds(boot.result)).toEqual([])
    })

    test('G untagged-entries-stay-resident: the frozen MVP-shaped index', async () => {
        interface FixtureFile { manifestKey: string, units: { key: string, bytes: string }[] }
        const fixture = JSON.parse(readFileSync(new URL('./moduleIndexPreB1.fixture.json', import.meta.url), 'utf8')) as FixtureFile
        const memory = createMemoryBackend()
        for (const unit of fixture.units) {
            await memory.putUnit(unit.key, new Uint8Array(Buffer.from(unit.bytes, 'base64')))
        }
        const manifest = readUnit(memory.snapshot().get(fixture.manifestKey) as Uint8Array, UNIT_TYPE.manifest)
        if (manifest.status !== 'ok') {
            throw new Error('The fixture manifest does not parse.')
        }
        const env = testEnv(createClock(), 7)
        const first = firstCommitKey({ current: { key: fixture.manifestKey, at: env.now() }, staging: null, manifests: [manifest.value.body as Manifest] }, env)
        await memory.casCommit((await memory.readCommit()).token, encodeUnit(UNIT_TYPE.commit, first))

        const boot = await bootThroughDispatch(memory, { lists: createListDerivation() })

        const slots = slotsOf(boot.result)
        expect(slots.length).toBeGreaterThanOrEqual(3)
        expect(slots.filter(stubbed)).toEqual([])
    })

    test.each([
        ['a newer', ASSET_REF_V + 1, IL_REF_V],
        ['an older', ASSET_REF_V - 1, IL_REF_V],
    ] as const)('G stale-asset-list-version-stays-resident: a boot whose asset list version is %s than the entries', async (_label, asset, inlay) => {
        const rig = await rigOf(fiveModules())
        const lists = { ...createListDerivation(), moduleListVersions: { asset, inlay } }
        const boot = await bootRig(rig, { lists })
        expect(stubIds(boot.result)).toEqual([])
    })

    test('G newer-inlay-list-version-entry-is-ineligible-so-it-stays-resident', async () => {
        const rig = await rigOf(fiveModules())
        const lists = { ...createListDerivation(), moduleListVersions: { asset: ASSET_REF_V, inlay: IL_REF_V + 1 } }
        const boot = await bootRig(rig, { lists })
        expect(stubIds(boot.result)).toEqual([])
    })

    test('R duplicate-id-with-one-referenced-holder-keeps-both-resident: eligibility is judged over the whole index', async () => {
        const rig = await rigOf([moduleBody('dup', { namespace: 'ns-x', name: 'first' }), moduleBody('dup', { name: 'second' }), moduleBody('uniq')], { moduleIntergration: 'ns-x' })
        const boot = await bootRig(rig)
        expect(stubIds(boot.result)).toEqual(['uniq'])
        expect(slotsOf(boot.result).slice(0, 2).map(slot => slot.name)).toEqual(['first', 'second'])
    })

    test('G (R precondition) empty-id-and-tilde-id-stay-resident: a unique module beside them is a stub', async () => {
        const rig = await rigOf([moduleBody(''), moduleBody('~positional'), moduleBody('uniq')])
        const boot = await bootRig(rig)
        expect(stubIds(boot.result)).toEqual(['uniq'])
    })

    test('G derivation-without-moduleListVersions-boots-all-resident', async () => {
        const rig = await rigOf(fiveModules())
        const boot = await bootRig(rig, { lists: fakeLists })
        expect(stubIds(boot.result)).toEqual([])
    })

    test('G damaged-unit-of-a-referenced-module-still-opens-recovery', async () => {
        const rig = await rigOf(fiveModules(), { enabledModules: ['ida'] })
        flipped(rig.counted.memory, keyOfRef(entryOf(rig, 'ida').unit as never))
        const boot = await bootRig(rig)
        expect(boot.result.kind).toBe('stopped')
        expect(getPageStorageMode().kind).not.toBe('store2')
    })

    test('G newer-unit-of-a-referenced-module-still-makes-the-page-read-only', async () => {
        const rig = await rigOf(fiveModules(), { enabledModules: ['ida'] })
        const key = keyOfRef(entryOf(rig, 'ida').unit as never)
        rig.counted.memory.poke(key, withHeader(rig.counted.memory.snapshot().get(key) as Uint8Array, (header) => { header[4] = 9 }))
        const boot = await bootRig(rig)
        expect(boot.result.kind).toBe('stopped')
        expect(getPageStorageMode()).toEqual({ kind: 'read-only', reason: 'too-new', source: 'tree' })
        expect(boot.notices.map(notice => notice.name)).toContain('too-new')
    })
})

describe('guards: the boot does not ensure modules (MC-644)', () => {
    // The dispatch is the only boot path hosted here: a boot ensure placed in `loadData` is not seen by this row, and the
    // selection load is covered by `moduleReferenceTrigger.svelte.test.ts`.
    test('G (R precondition) no-boot-ensure-for-always-resident-characters: a resident character that names a stub loads nothing at boot', async () => {
        // A character the policy keeps resident (an empty id) whose own module list names an unreferenced module.
        const characters = (buildSmall(2).characters as unknown as Plain[]).map((slot, position) => position === 0 ? { ...slot, chaId: '', modules: ['idc'] } : slot)
        const named = await rigOf(fiveModules(), { characters, characterOrder: characters.map(slot => slot.chaId) })

        const boot = await bootRig(named)

        expect(stubIds(boot.result)).toEqual(['idc', 'ida', 'idd', 'idb', 'ide'])
        // A load the boot started would reach the loader through a lazy import, so give it time to arrive.
        await new Promise<void>(resolve => setTimeout(resolve, 25))
        expect(loadModule).not.toHaveBeenCalled()
        expect(loadModuleStubsOf).not.toHaveBeenCalled()
        expect(readsOf(named, entryOf(named, 'idc'))).toEqual([])
    })

    test('G legacy-read-only-boot-never-mints: a page that hands the legacy profile back read-only reads no store2 tree (convert, restore, import and seed boots do mint)', async () => {
        const result = await dispatchStore2Boot({
            store: createMemoryByteStore(),
            upstreamMainFile: async () => true,
            readColdStorageItem: async () => ({ status: 'missing' }),
            listBackupTimes: async () => [],
        }, {
            ui: {
                notice: () => { },
                blocked: async () => { },
                offerRestoreOrImport: async () => 'import',
                confirmConvert: async () => false,
                declined: async () => 'import',
                confirmConvertWithout: async () => 'decline',
                confirmFromBackup: async () => 'decline',
                confirmIncomplete: async () => false,
                confirmFlaggedOpen: async () => 'decline',
                foreignMarker: async () => 'wait',
                recovery: async () => { },
                peer: createPeerDouble(),
            },
            kind: 'opfs-transitional',
        })
        expect(result.kind).toBe('legacy-readonly')
        expect(vi.mocked(readTreeBytes)).not.toHaveBeenCalled()
        expect(h.planned).toEqual([])
    })
})

describe('a converted legacy profile opens through the same stored-tree open', () => {
    // A conversion plans the tree under the dispatch's own list derivation and opens it through the same stored-tree
    // open, so it mints like any stored tree; the first pass carries the stubs and rewrites no module reference.
    test.each([true, undefined])('M converted-legacy-profile-mints-and-the-first-pass-carries: archiveCharacters %s', async (archive) => {
        const legacy = {
            ...(buildSmall(2) as unknown as Obj),
            archiveCharacters: archive,
            enabledModules: ['m1'],
            moduleIntergration: '',
            modules: [moduleBody('m1'), moduleBody('m2'), moduleBody('m3')],
        } as unknown as Database
        const store = createMemoryByteStore()
        store.files.set('database/database.bin', new Uint8Array([1, 2, 3]))
        const memory = createMemoryBackend()
        const result = await dispatchStore2Boot({
            store,
            upstreamMainFile: async () => true,
            readColdStorageItem: async () => ({ status: 'missing' }),
            listBackupTimes: async () => [],
        }, {
            ui: {
                notice: () => { },
                blocked: async () => { },
                offerRestoreOrImport: async () => 'import',
                confirmConvert: async () => true,
                declined: async () => 'import',
                confirmConvertWithout: async () => 'decline',
                confirmFromBackup: async () => 'decline',
                confirmIncomplete: async () => false,
                confirmFlaggedOpen: async () => 'decline',
                foreignMarker: async () => 'wait',
                recovery: async () => { },
                peer: createPeerDouble(),
            },
            kind: 'indexeddb',
            backend: async () => memory,
            keyEnv: testEnv(createClock(), 9001),
            lists: createListDerivation(),
            decoders: {
                strict: async () => JSON.parse(JSON.stringify(legacy)) as Database,
                lenient: async () => { throw new Error('The file does not decode, even leniently.') },
            },
        })

        const database = opened(result).database
        expect((database.modules as unknown as Plain[]).map(stubbed)).toEqual([false, true, true])
        const context = getActiveStore2Save()
        const bootEntries = plain(context?.encoder?.acknowledged().objects?.moduleIndex?.entries.map(entry => [entry.unit, entry.al, entry.il]))
        if (archive === true) {
            expect((await planPass(database)).unchanged).toBe(true)
        } else {
            // The setting is written once by the first pass; no module reference changes with it.
            const plan = await planPass(database)
            expect(plan.unchanged).toBe(false)
            expect((await context?.session.committer.commit(await context.session.committer.readCommit(), plan.commitRequest()))?.status).toBe('committed')
            plan.acknowledge()
            expect(plain(context?.encoder?.acknowledged().objects?.moduleIndex?.entries.map(entry => [entry.unit, entry.al, entry.il]))).toEqual(bootEntries)
            expect((await storedModuleEntries(memory)).map(entry => plain([entry.unit, entry.al, entry.il]))).toEqual(bootEntries)
        }
    })
})

describe('the assemble hook', () => {
    test('M the hook gets the handle of each entry in index order and decides each module on its own', async () => {
        const rig = await rigOf(fiveModules())
        const read = await readTreeBytes(rig.counted.backend, rig.manifestKey)
        if (read.status !== 'ok') {
            throw new Error(`The tree read ${read.status}.`)
        }
        const seen: string[] = []
        const database = assembleDatabase(read.tree.manifest, read.tree.source, {
            module: (entry, _source, handle) => {
                seen.push(handle)
                return { id: entry.id, handle }
            },
        })
        expect(seen).toEqual(moduleHandles(rig.entries))
        expect((database.modules as unknown as Plain[]).map(slot => slot.handle)).toEqual(seen)
    })
})
