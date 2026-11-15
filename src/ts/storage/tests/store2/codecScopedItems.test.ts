// @vitest-environment node
import { describe, expect, test } from 'vitest'
import {
    bucketOfKey, groupKeysIntoBuckets, planScopedEncode, previousFrom, unitsToWrite,
    type EncodedTree, type EncodeOptions, type EncodeScope, type ListDerivation, type PreviousEncoding, type ScopedPlan,
} from '../../store2/codec'
import { createKeyMint, type BuildContext } from '../../store2/commit'
import { createListDerivation } from '../../store2/lists/derive'
import { previousOfTree } from '../../store2/previousOfTree'
import type { Database } from '../../database.svelte'
import {
    asDatabase, bodyIn, buildSmall, fakeLists, seededEnv, unitOf, type Obj,
} from './codecFixtures'
import { createClock, testEnv } from './commitFixtures'

/**
 * A pass that meets data it cannot store (a cycle, a BigInt, a throwing `toJSON`) in a module, a preset, a setting or
 * a plugin-data key goes on without that one item and keeps its last saved copy. Every previous encoding below is
 * produced by the real planner and `finalize` (and, where a boot is meant, read back through `previousOfTree`), and
 * every bad value is made by mutating a live object.
 *
 * Labels: C1, C2, C4 to C7, C10 to C10t and C14 are reproducers (the base pass throws a CodecInputError on the first
 * bad value); C3, C11 and C12 are new-rule guards (the base throws the plain CodecInputError, not the module-set error);
 * C8, C9, C13 and C13b to C13c are compatibility guards that hold before and after.
 */

const NOW = 1_700_000_000_000
const SKIP = { skipUnsavableItems: true } as const
const FULL: EncodeScope = { modules: true, characters: 'all', ...SKIP }

const mod = (id: string, extra: Obj = {}): Obj => ({ name: `Module ${id}`, description: `about ${id}`, id, lorebook: [], regex: [], trigger: [], ...extra })

function cyclic(): Obj {
    const value: Obj = {}
    value.self = value
    return value
}

function profile(modules: Obj[] = [mod('m0'), mod('m1'), mod('m2')]): Database {
    const base = JSON.parse(JSON.stringify(buildSmall(3))) as Obj
    base.modules = modules
    base.someSetting = 'kept'
    base.otherSetting = { n: 1 }
    base.taskPresets = [
        { id: 't0', name: 'Task 0', prompt: 'a' },
        { id: 't1', name: 'Task 1', prompt: 'b' },
        { id: 't2', name: 'Task 2', prompt: 'c' },
    ]
    return asDatabase(base)
}

/** A copy of `db` that `mutate` then edits; the bad values go in here, after the clone. */
function live(db: Database, mutate: (copy: Obj) => void): Database {
    const copy = JSON.parse(JSON.stringify(db)) as Obj
    mutate(copy)
    return asDatabase(copy)
}

function chaIdOf(db: Database, index: number): string {
    return (db.characters[index] as unknown as { chaId: string }).chaId
}

function makeRig(envSeed: number, mintSeed: number, lists: ListDerivation = createListDerivation()) {
    const store = new Map<string, Uint8Array>()
    let env = envSeed
    let mint = mintSeed
    let seq = 1
    return {
        lists,
        async pass(db: Database, previous: PreviousEncoding | null, scope: EncodeScope): Promise<{ plan: ScopedPlan, tree: EncodedTree }> {
            seq++
            const options: EncodeOptions = { env: seededEnv(env++), lists, seq, createdAt: NOW, previous }
            const plan = await planScopedEncode(db, options, scope)
            const context: BuildContext = { mint: createKeyMint(testEnv(createClock(), mint++), null).mint, seq, now: NOW }
            return { plan, tree: plan.finalize(context) }
        },
        persist(tree: EncodedTree): void {
            for (const unit of unitsToWrite(tree)) {
                store.set(unit.key, unit.bytes)
            }
        },
        boot(tree: EncodedTree): PreviousEncoding {
            return previousOfTree({ manifestKey: tree.manifestKey, manifest: tree.manifest, source: { get: key => store.get(key) } })
        },
    }
}

type Rig = ReturnType<typeof makeRig>

/** The acknowledged encoding of `db`: a full pass, stored, and the `previous` the next pass reads. */
async function acknowledged(rig: Rig, db: Database): Promise<{ tree: EncodedTree, previous: PreviousEncoding }> {
    const { tree } = await rig.pass(db, null, { modules: true, characters: 'all' })
    rig.persist(tree)
    return { tree, previous: previousFrom(tree) }
}

async function failureOf(run: () => Promise<unknown>): Promise<Error | null> {
    try {
        await run()
        return null
    } catch (error) {
        return error as Error
    }
}

function briefOf(plan: ScopedPlan): Array<{ scope: string, key: string, saved: boolean }> {
    return plan.skippedItems.map(({ scope, key, saved }) => ({ scope, key, saved }))
}

function entryIds(tree: EncodedTree): string[] {
    return (tree.index.objects?.moduleIndex?.entries ?? []).map(entry => entry.id)
}

function entryOf(tree: EncodedTree, id: string): unknown {
    return tree.index.objects?.moduleIndex?.entries.find(entry => entry.id === id)
}

function bodyOfIdentity(tree: EncodedTree, identity: string, ...earlier: EncodedTree[]): Obj {
    return bodyIn(unitOf(tree, identity), ...earlier) as unknown as Obj
}

function configFieldsOf(tree: EncodedTree, ...earlier: EncodedTree[]): Obj {
    return bodyOfIdentity(tree, 'config', ...earlier).f as Obj
}

function isWritten(tree: EncodedTree, identity: string): boolean {
    return tree.units.some(unit => unit.identity === identity && unit.reused === false)
}

describe('C1 a module the pass cannot read is skipped and its saved copy is carried', () => {
    test('reproducer: the character edit lands, the module keeps its units, and a second pass does the same', async () => {
        const rig = makeRig(100, 9100)
        const base = profile()
        const first = await acknowledged(rig, base)
        const chaId = chaIdOf(base, 0)
        const bad = (name: string) => live(base, (o) => {
            (o.modules as Obj[])[1].cycle = cyclic()
            ;(o.characters as Obj[])[0].personality = name
        })

        const second = await rig.pass(bad('edited'), first.previous, { modules: true, characters: new Set([chaId]), ...SKIP })
        expect(briefOf(second.plan)).toEqual([{ scope: 'module', key: 'm1', saved: true }])
        expect(second.plan.encoded).toEqual([chaId])
        expect(second.plan.carried.items).toEqual(['"Module m1"'])
        const idents = ['module:m1#0', 'al:module:m1#0', 'il:module:m1#0'].filter(identity => first.tree.index.units.has(identity))
        expect(idents.length).toBeGreaterThanOrEqual(2)
        for (const identity of idents) {
            expect(second.tree.index.units.get(identity)?.key, identity).toBe(first.tree.index.units.get(identity)?.key)
            expect(isWritten(second.tree, identity), identity).toBe(false)
        }
        expect(entryOf(second.tree, 'm1')).toEqual(entryOf(first.tree, 'm1'))
        expect(entryIds(second.tree)).toEqual(['m0', 'm1', 'm2'])

        // The next pass reads the carried entry as its previous: it is still the saved one.
        const third = await rig.pass(bad('edited again'), previousFrom(second.tree), { modules: true, characters: new Set([chaId]), ...SKIP })
        expect(briefOf(third.plan)).toEqual([{ scope: 'module', key: 'm1', saved: true }])
        for (const identity of idents) {
            expect(third.tree.index.units.get(identity)?.key, identity).toBe(first.tree.index.units.get(identity)?.key)
        }
        expect(entryOf(third.tree, 'm1')).toEqual(entryOf(first.tree, 'm1'))
    })
})

describe('C2 a module that was never saved is left out', () => {
    test('reproducer: a BigInt module added after the acknowledgement is not in the index, the rest saves', async () => {
        const rig = makeRig(110, 9200)
        const base = profile()
        const first = await acknowledged(rig, base)
        const next = live(base, (o) => {
            (o.modules as Obj[]).push({ ...mod('m3'), big: 10n })
            ;(o.characters as Obj[])[0].personality = 'edited'
        })
        const second = await rig.pass(next, first.previous, { modules: true, characters: 'all', ...SKIP })
        expect(briefOf(second.plan)).toEqual([{ scope: 'module', key: 'm3', saved: false }])
        expect(entryIds(second.tree)).toEqual(['m0', 'm1', 'm2'])
        expect(second.plan.carried.items).toEqual([])
    })
})

describe('the whole module set is carried when one module cannot be told from another', () => {
    test('C3 new-rule guard: a live shared id with a fault throws the module-set error', async () => {
        const rig = makeRig(120, 9300)
        const base = profile()
        const first = await acknowledged(rig, base)
        // The previous index holds m1 once; the live list holds it twice and the second holder is the unreadable one.
        const next = live(base, (o) => {
            (o.modules as Obj[]).splice(2, 0, { ...mod('m1', { name: 'copy' }), cycle: cyclic() })
        })
        const failure = await failureOf(() => rig.pass(next, first.previous, FULL))
        expect(failure?.name).toBe('ModuleSetUnsavableError')
    })

    test('C11 new-rule guard: an id the previous index holds twice with one holder deleted throws the module-set error', async () => {
        const rig = makeRig(130, 9400)
        const base = profile([mod('m0'), mod('dup', { name: 'first' }), mod('dup', { name: 'second' }), mod('m2')])
        const first = await acknowledged(rig, base)
        const next = live(base, (o) => {
            const modules = o.modules as Obj[]
            modules.splice(1, 1)
            modules[1].cycle = cyclic()
        })
        const failure = await failureOf(() => rig.pass(next, first.previous, FULL))
        expect(failure?.name).toBe('ModuleSetUnsavableError')
    })

    test('C12 new-rule guard: a module whose named unit the previous encoding lacks throws the module-set error', async () => {
        const rig = makeRig(140, 9500)
        const base = profile()
        const first = await acknowledged(rig, base)
        const units = new Map(first.previous.units)
        expect(units.delete('al:module:m1#0')).toBe(true)
        const next = live(base, (o) => {
            (o.modules as Obj[])[1].cycle = cyclic()
        })
        const failure = await failureOf(() => rig.pass(next, { ...first.previous, units }, FULL))
        expect(failure?.name).toBe('ModuleSetUnsavableError')
    })

    test('a module fault with no previous module index is the plain input error', async () => {
        const rig = makeRig(150, 9600)
        const next = live(profile(), (o) => {
            (o.modules as Obj[])[1].cycle = cyclic()
        })
        const failure = await failureOf(() => rig.pass(next, null, FULL))
        expect(failure?.name).toBe('CodecInputError')
    })
})

describe('C4 and C7 a plugin-data key the pass cannot read keeps its saved value', () => {
    const DERIVATIONS: Array<[string, () => ListDerivation]> = [
        ['the real derivation', () => createListDerivation()],
        ['the fixture derivation', () => fakeLists],
    ]

    test.each(DERIVATIONS)('reproducer: the other keys save, the unit is the saved one, and il:config is the overflow body (%s)', async (_label, make) => {
        const rig = makeRig(160, 9700, make())
        const base = profile()
        const first = await acknowledged(rig, base)
        const next = live(base, (o) => {
            const storage = o.pluginCustomStorage as Obj
            storage['plugin-3'] = { toJSON() { throw new Error('toJSON fault') } }
            storage['plugin-5'] = { changed: true }
        })
        const second = await rig.pass(next, first.previous, FULL)
        expect(briefOf(second.plan)).toEqual([{ scope: 'pluginData', key: 'plugin-3', saved: true }])
        expect(second.plan.carried.items).toEqual(['"plugin-3"'])
        expect(second.tree.index.units.get('psv:plugin-3')?.key).toBe(first.tree.index.units.get('psv:plugin-3')?.key)
        expect(isWritten(second.tree, 'psv:plugin-3')).toBe(false)
        expect(isWritten(second.tree, 'psv:plugin-5')).toBe(true)
        const bucket = bodyOfIdentity(second.tree, `bucket:${bucketOfKey('plugin-3')}`, first.tree) as unknown as { entries: Array<{ k: string, ref: unknown[] }> }
        expect(bucket.entries.find(entry => entry.k === 'plugin-3')?.ref).toEqual(first.tree.index.units.get('psv:plugin-3')?.ref)
        expect(bodyOfIdentity(first.tree, 'il:config').x).toBeUndefined()
        expect(bodyOfIdentity(second.tree, 'il:config', first.tree).x).toBe(true)
    })

    test('a faulted key that was never saved is dropped and recorded as never saved', async () => {
        const rig = makeRig(170, 9800)
        const base = profile()
        const first = await acknowledged(rig, base)
        const next = live(base, (o) => {
            (o.pluginCustomStorage as Obj)['brand-new'] = { value: 10n }
        })
        const second = await rig.pass(next, first.previous, FULL)
        expect(briefOf(second.plan)).toEqual([{ scope: 'pluginData', key: 'brand-new', saved: false }])
        expect(second.tree.index.units.has('psv:brand-new')).toBe(false)
        expect(bodyOfIdentity(second.tree, 'il:config', first.tree).x).toBeUndefined()
    })
})

describe('C5 and C6 a setting the pass cannot read keeps its saved value', () => {
    test('C5 reproducer: over two consecutive passes the saved value stays and the lists stay exact', async () => {
        const rig = makeRig(180, 9900)
        const base = profile()
        const first = await acknowledged(rig, base)
        const bad = (n: number) => live(base, (o) => {
            o.someSetting = 10n
            o.otherSetting = { n }
        })
        const second = await rig.pass(bad(2), first.previous, FULL)
        expect(briefOf(second.plan)).toEqual([{ scope: 'settings', key: 'someSetting', saved: true }])
        expect(configFieldsOf(second.tree, first.tree).someSetting).toBe('kept')
        expect(configFieldsOf(second.tree, first.tree).otherSetting).toEqual({ n: 2 })
        expect(bodyOfIdentity(second.tree, 'il:config', first.tree).x).toBeUndefined()

        const third = await rig.pass(bad(3), previousFrom(second.tree), FULL)
        expect(briefOf(third.plan)).toEqual([{ scope: 'settings', key: 'someSetting', saved: true }])
        expect(configFieldsOf(third.tree, first.tree, second.tree).someSetting).toBe('kept')
        expect(configFieldsOf(third.tree, first.tree, second.tree).otherSetting).toEqual({ n: 3 })
    })

    test('C6 reproducer: the first pass after a boot keeps the saved value as well', async () => {
        const rig = makeRig(190, 10000)
        const base = profile()
        const first = await acknowledged(rig, base)
        const next = live(base, (o) => {
            o.someSetting = 10n
        })
        const second = await rig.pass(next, rig.boot(first.tree), FULL)
        expect(briefOf(second.plan)).toEqual([{ scope: 'settings', key: 'someSetting', saved: true }])
        expect(configFieldsOf(second.tree, first.tree).someSetting).toBe('kept')
    })

    test('a field that was never saved is omitted and recorded as never saved', async () => {
        const rig = makeRig(200, 10100)
        const base = profile()
        const first = await acknowledged(rig, base)
        const next = live(base, (o) => {
            o.freshSetting = 10n
        })
        const second = await rig.pass(next, first.previous, FULL)
        expect(briefOf(second.plan)).toEqual([{ scope: 'settings', key: 'freshSetting', saved: false }])
        expect(Object.hasOwn(configFieldsOf(second.tree, first.tree), 'freshSetting')).toBe(false)
    })
})

/** What the pass wrote for the first part of the tree, in put order: it fixes the real keys the mint hands out. */
function frontOrderOf(tree: EncodedTree): string[] {
    return tree.units.map(unit => unit.identity).filter(identity => /^(preset|taskPreset|plugin|psv|bucket):/.test(identity))
}

function expectedFrontOrder(db: Obj, storage: Obj): string[] {
    const order: string[] = []
    ;(db.botPresets as unknown[]).forEach((_, index) => order.push(`preset:${index}`))
    ;(db.taskPresets as unknown[]).forEach((_, index) => order.push(`taskPreset:${index}`))
    ;(db.plugins as unknown[]).forEach((_, index) => order.push(`plugin:plugins:${index}`))
    ;(db.pluginV2 as unknown[]).forEach((_, index) => order.push(`plugin:pluginV2:${index}`))
    groupKeysIntoBuckets(Object.keys(storage)).forEach((keys, bucket) => {
        for (const key of keys) {
            order.push(`psv:${key}`)
        }
        order.push(`bucket:${bucket}`)
    })
    return order
}

describe('C8 compatibility guard: for valid data the flag changes no byte and the front keeps its put order', () => {
    function shaped(): Database {
        const shared = { a: 1, b: [1, 2] }
        return live(profile(), (o) => {
            const storage = o.pluginCustomStorage as Obj
            storage.dateKey = new Date(1_700_000_000_000)
            storage.undefKey = undefined
            storage.fnKey = () => 1
            storage.shared1 = shared
            storage.shared2 = shared
            storage.perKeyJson = { toJSON() { return { j: 1 } } }
            o.dateSetting = new Date(1_700_000_000_000)
            o.undefSetting = undefined
            o.fnSetting = () => 1
            o.sharedSetting = { x: shared, y: shared }
        })
    }

    function rootJson(): Database {
        return live(profile(), (o) => {
            o.pluginCustomStorage = { ignored: 1, toJSON() { return { z: 1, y: { k: 'v' }, a: [1], 'plugin-9': 'x', m: null } } }
        })
    }

    /**
     * The same database encoded twice under the same seeds, once more over the first encoding (the pass that reads per
     * key needs an earlier encoding to fall back on), with the flag off and on.
     */
    async function bothWays(db: Database): Promise<{ on: EncodedTree, off: EncodedTree, onAgain: EncodedTree, offAgain: EncodedTree }> {
        const offRig = makeRig(210, 10200)
        const off = await offRig.pass(db, null, { modules: true, characters: 'all' })
        const offAgain = await offRig.pass(db, previousFrom(off.tree), { modules: true, characters: 'all' })
        const onRig = makeRig(210, 10200)
        const on = await onRig.pass(db, null, FULL)
        const onAgain = await onRig.pass(db, previousFrom(on.tree), FULL)
        return { on: on.tree, off: off.tree, onAgain: onAgain.tree, offAgain: offAgain.tree }
    }

    function expectSameBytes(a: EncodedTree, b: EncodedTree): void {
        expect(b.units.map(unit => unit.identity)).toEqual(a.units.map(unit => unit.identity))
        a.units.forEach((unit, index) => {
            const other = b.units[index]
            expect(other.key, unit.identity).toBe(unit.key)
            expect(other.digest, unit.identity).toBe(unit.digest)
            expect(other.ref, unit.identity).toEqual(unit.ref)
        })
    }

    test('values a JSON read drops or rewrites give the same tree with the flag on and off, in the base put order', async () => {
        const db = shaped()
        const { on, off, onAgain, offAgain } = await bothWays(db)
        expectSameBytes(off, on)
        expectSameBytes(offAgain, onAgain)
        const storage: Obj = { ...(db as unknown as Obj).pluginCustomStorage as Obj }
        for (const key of ['undefKey', 'fnKey']) {
            delete storage[key]
        }
        expect(frontOrderOf(on)).toEqual(expectedFrontOrder(db as unknown as Obj, storage))
        expect(new Set(groupKeysIntoBuckets(Object.keys(storage)).map((keys, bucket) => (keys.length > 0 ? bucket : -1)))).not.toEqual(new Set([-1]))
        expect(groupKeysIntoBuckets(Object.keys(storage)).filter(keys => keys.length > 0).length).toBeGreaterThan(1)
    })

    test('a plugin-storage root that carries a toJSON is read whole, as the base reads it', async () => {
        const db = rootJson()
        const { on, off, onAgain, offAgain } = await bothWays(db)
        expectSameBytes(off, on)
        expectSameBytes(offAgain, onAgain)
        const read =JSON.parse(JSON.stringify((db as unknown as Obj).pluginCustomStorage)) as Obj
        expect(frontOrderOf(on)).toEqual(expectedFrontOrder(db as unknown as Obj, read))
        expect(bodyOfIdentity(on, 'psv:z').value).toBe(1)
    })
})

describe('C9 compatibility guard: an import, which names no flag, still refuses what cannot be stored', () => {
    const IMPORT: EncodeScope = { modules: true, characters: 'all' }
    const CASES: Array<[string, (o: Obj) => void]> = [
        ['a cyclic module', (o) => { (o.modules as Obj[])[0].cycle = cyclic() }],
        ['a cyclic plugin-data key', (o) => { (o.pluginCustomStorage as Obj)['plugin-1'] = cyclic() }],
        ['a BigInt setting', (o) => { o.someSetting = 10n }],
        ['a cyclic bot preset', (o) => { (o.botPresets as Obj[])[1].cycle = cyclic() }],
        ['a cyclic task preset', (o) => { (o.taskPresets as Obj[])[1].cycle = cyclic() }],
    ]

    test.each(CASES)('%s fails the pass with the input error and no skip record', async (_label, mutate) => {
        const rig = makeRig(220, 10300)
        const failure = await failureOf(() => rig.pass(live(profile(), mutate), null, IMPORT))
        expect(failure?.name).toBe('CodecInputError')
    })

    test.each(CASES)('%s fails against a previous encoding too when the scope names no flag', async (_label, mutate) => {
        const rig = makeRig(230, 10400)
        const base = profile()
        const first = await acknowledged(rig, base)
        const failure = await failureOf(() => rig.pass(live(base, mutate), first.previous, IMPORT))
        expect(failure?.name).toBe('CodecInputError')
    })
})

describe('presets are held whole, bot and task separately', () => {
    function inserted(o: Obj, bad: boolean): void {
        const presets = o.botPresets as Obj[]
        const last = presets[presets.length - 1]
        presets.splice(0, 0, { name: 'New first', mainPrompt: 'n', jailbreak: '', temperature: 70 })
        presets[presets.length - 1] = bad ? { ...last, cycle: cyclic() } : last
        o.botPresetsId = 1
    }

    test('C10 reproducer: an insert at the front plus a cyclic preset keeps the acknowledged list over two passes, then the full list saves', async () => {
        const rig = makeRig(240, 10500)
        const base = profile()
        const first = await acknowledged(rig, base)
        const ackRefs = first.tree.manifest.fixed.presets
        expect(ackRefs.length).toBe(4)

        const second = await rig.pass(live(base, o => inserted(o, true)), first.previous, FULL)
        expect(briefOf(second.plan)).toEqual([{ scope: 'presets', key: 'presets', saved: true }])
        expect(second.plan.carried.items).toEqual(['"Preset 3"'])
        expect(second.tree.manifest.fixed.presets).toEqual(ackRefs)
        const afterSecond = previousFrom(second.tree)
        ackRefs.forEach((ref, index) => {
            expect(afterSecond.units.get(`preset:${index}`)?.ref.slice(0, 3), `preset:${index}`).toEqual(ref)
        })
        expect(afterSecond.units.has('preset:4')).toBe(false)
        expect(bodyOfIdentity(second.tree, 'il:config', first.tree).x).toBe(true)

        const third = await rig.pass(live(base, o => inserted(o, true)), afterSecond, FULL)
        expect(third.tree.manifest.fixed.presets).toEqual(ackRefs)
        expect(briefOf(third.plan)).toEqual([{ scope: 'presets', key: 'presets', saved: true }])

        const fixed = await rig.pass(live(base, o => inserted(o, false)), previousFrom(third.tree), FULL)
        expect(fixed.plan.skippedItems).toEqual([])
        expect(fixed.tree.manifest.fixed.presets.length).toBe(5)
        expect((bodyOfIdentity(fixed.tree, 'preset:0', first.tree, second.tree, third.tree).preset as Obj).name).toBe('New first')
        expect(bodyOfIdentity(fixed.tree, 'il:config', first.tree, second.tree, third.tree).x).toBeUndefined()
    })

    test('C10l a faulted preset with no name is named by its position', async () => {
        const rig = makeRig(250, 10600)
        const base = profile()
        const first = await acknowledged(rig, base)
        const next = live(base, (o) => {
            (o.botPresets as Obj[]).push({ cycle: cyclic() })
        })
        const second = await rig.pass(next, first.previous, FULL)
        expect(second.plan.carried.items).toEqual(['"botPresets[4]"'])
    })

    test('C10t reproducer: a cyclic task preset holds the task list, and the bot list still saves', async () => {
        const rig = makeRig(260, 10700)
        const base = profile()
        const first = await acknowledged(rig, base)
        const ackTask = first.tree.manifest.fixed.taskPresets
        expect(ackTask?.length).toBe(3)
        const next = live(base, (o) => {
            const tasks = o.taskPresets as Obj[]
            tasks.splice(0, 0, { id: 'tn', name: 'Task new', prompt: 'z' })
            tasks[tasks.length - 1] = { ...tasks[tasks.length - 1], cycle: cyclic() }
            ;(o.botPresets as Obj[])[0].name = 'Edited'
        })
        const second = await rig.pass(next, first.previous, FULL)
        expect(briefOf(second.plan)).toEqual([{ scope: 'taskPresets', key: 'taskPresets', saved: true }])
        expect(second.plan.carried.items).toEqual(['"Task 2"'])
        expect(second.tree.manifest.fixed.taskPresets).toEqual(ackTask)
        const after = previousFrom(second.tree)
        ackTask?.forEach((ref, index) => {
            expect(after.units.get(`taskPreset:${index}`)?.ref.slice(0, 3), `taskPreset:${index}`).toEqual(ref)
        })
        expect(after.units.has('taskPreset:3')).toBe(false)
        expect((bodyOfIdentity(second.tree, 'preset:0', first.tree).preset as Obj).name).toBe('Edited')
        expect(configFieldsOf(second.tree, first.tree).botPresetsId).toBe(0)
    })

    test('C10e an acknowledged empty task list is carried as the empty list', async () => {
        const rig = makeRig(270, 10800)
        const base = live(profile(), (o) => {
            o.taskPresets = []
        })
        const first = await acknowledged(rig, base)
        const next = live(base, (o) => {
            o.taskPresets = [{ id: 'tn', name: 'Task new', cycle: cyclic() }]
        })
        const second = await rig.pass(next, first.previous, FULL)
        expect(briefOf(second.plan)).toEqual([{ scope: 'taskPresets', key: 'taskPresets', saved: true }])
        expect(second.tree.manifest.fixed.taskPresets ?? []).toEqual([])
    })

    test('C13 compatibility guard: with no previous encoding a cyclic preset fails the pass', async () => {
        const rig = makeRig(280, 10900)
        const next = live(profile(), (o) => {
            (o.botPresets as Obj[])[1].cycle = cyclic()
        })
        const failure = await failureOf(() => rig.pass(next, null, FULL))
        expect(failure?.name).toBe('CodecInputError')
    })

    const BROKEN: Array<[string, string, (o: Obj) => void]> = [
        ['bot', 'preset', (o) => { (o.botPresets as Obj[])[1].cycle = cyclic() }],
        ['task', 'taskPreset', (o) => { (o.taskPresets as Obj[])[1].cycle = cyclic() }],
    ]

    test.each(BROKEN)('C13b compatibility guard: a %s list whose previous unit is missing or has another head fails the pass', async (_label, prefix, mutate) => {
        const rig = makeRig(290, 11000)
        const base = profile()
        const first = await acknowledged(rig, base)
        const removed = new Map(first.previous.units)
        expect(removed.delete(`${prefix}:1`)).toBe(true)
        const other = new Map(first.previous.units)
        const unit = other.get(`${prefix}:1`)
        expect(unit).toBeDefined()
        other.set(`${prefix}:1`, { ...unit!, ref: [unit!.ref[0], unit!.ref[1] + 1, unit!.ref[2]] })
        for (const units of [removed, other]) {
            const failure = await failureOf(() => rig.pass(live(base, mutate), { ...first.previous, units }, FULL))
            expect(failure?.name).toBe('CodecInputError')
        }
    })

    test.each(BROKEN)('C13e compatibility guard: a previous encoding that holds no manifest object cannot name a held %s list, so the pass fails and no empty list is carried', async (_label, _prefix, mutate) => {
        const rig = makeRig(281, 10950)
        const base = profile()
        const first = await acknowledged(rig, base)
        const { objects, ...withoutObjects } = first.previous
        expect(objects).toBeDefined()
        const failure = await failureOf(() => rig.pass(live(base, mutate), withoutObjects, FULL))
        expect(failure?.name).toBe('CodecInputError')
    })

    const NEVER_SAVED: Array<[string, (o: Obj) => void]> = [
        ['a cyclic plugin-data key', (o) => { (o.pluginCustomStorage as Obj)['plugin-1'] = cyclic() }],
        ['a BigInt setting', (o) => { o.someSetting = 10n }],
    ]

    test.each(NEVER_SAVED)('C13d compatibility guard: with no previous encoding %s fails the pass and is never dropped', async (_label, mutate) => {
        const rig = makeRig(285, 11020)
        const failure = await failureOf(() => rig.pass(live(profile(), mutate), null, FULL))
        expect(failure?.name).toBe('CodecInputError')
    })

    test('C13c compatibility guard: a cyclic plugin is not skippable and fails the pass', async () => {
        const rig = makeRig(295, 11050)
        const base = profile()
        const first = await acknowledged(rig, base)
        const next = live(base, (o) => {
            (o.plugins as Obj[])[0].cycle = cyclic()
        })
        const failure = await failureOf(() => rig.pass(next, first.previous, FULL))
        expect(failure?.name).toBe('CodecInputError')
    })

    test('C14 reproducer: while the bot list is held the saved selection names no stored preset', async () => {
        const rig = makeRig(300, 11100)
        const base = profile()
        const first = await acknowledged(rig, base)
        const moved = live(base, (o) => {
            const presets = o.botPresets as Obj[]
            const [head] = presets.splice(0, 1)
            presets.splice(2, 0, head)
            o.botPresetsId = 2
            presets[3] = { ...presets[3], cycle: cyclic() }
        })
        const second = await rig.pass(moved, first.previous, FULL)
        expect(configFieldsOf(second.tree, first.tree).botPresetsId).toBe(first.tree.manifest.fixed.presets.length)
        expect(second.tree.index.objects?.config?.botPresetsId).toBe(first.tree.manifest.fixed.presets.length)

        // Not held: the live selection is saved as it is.
        const fine = live(base, (o) => {
            o.botPresetsId = 2
        })
        const third = await rig.pass(fine, previousFrom(second.tree), FULL)
        expect(configFieldsOf(third.tree, first.tree, second.tree).botPresetsId).toBe(2)
    })
})
