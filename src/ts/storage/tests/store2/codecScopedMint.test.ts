// @vitest-environment node
import { afterEach, describe, expect, test } from 'vitest'
import {
    assembleDatabase, builtCommitOf, encodeScoped, planScopedEncode, previousFrom, unitsToWrite,
    type EncodedTree, type EncodeOptions, type EncodeScope, type ScopedPlan,
} from '../../store2/codec'
import { checkBuiltUnits, createKeyMint, IMPORT_REPLACES_BASE, type BuildContext, type CommitResult, type KeyMint } from '../../store2/commit'
import { readUnit, UNIT_TYPE, type Manifest } from '../../store2/format'
import type { Database } from '../../database.svelte'
import type { Store2Backend } from '../../store2/backend'
import {
    asDatabase, buildSmall, bytesOf, encodeWith, fakeLists, sameBytes, seededEnv, storeOf, type Obj,
} from './codecFixtures'
import {
    COMMIT_BACKENDS, committerOf, createClock, expectInvariant, hooked, parsedCommit, seedStore, testEnv,
    type OpenedBackend,
} from './commitFixtures'

const NOW = 1_700_000_000_000
const opened: OpenedBackend[] = []

afterEach(async () => {
    await Promise.all(opened.splice(0).map(entry => entry.close()))
})

function clone(db: Database): Obj {
    return JSON.parse(JSON.stringify(db)) as Obj
}

function optionsOf(seed: number, previous: EncodedTree | null): EncodeOptions {
    return { env: seededEnv(seed), lists: fakeLists, seq: 2, createdAt: NOW, previous: previous === null ? null : previousFrom(previous) }
}

function contextOf(mint: KeyMint, seq = 2, now = NOW): BuildContext {
    return { mint, seq, now }
}

function chaIdOf(db: Database, index: number): string {
    return (db.characters[index] as { chaId: string }).chaId
}

function expectCommitted(result: CommitResult): Extract<CommitResult, { status: 'committed' }> {
    expect(result.status).toBe('committed')
    if (result.status !== 'committed') {
        throw new Error(`Expected committed, got ${result.status}.`)
    }
    return result
}

async function setup() {
    const fixture = COMMIT_BACKENDS.find(entry => entry.name === 'memory')
    if (fixture === undefined) {
        throw new Error('The memory backend fixture is missing.')
    }
    const entry = await fixture.open()
    opened.push(entry)
    const clock = createClock()
    await seedStore(entry.backend, testEnv(clock, 1))
    const wrapped = hooked(entry.backend)
    return { raw: entry.backend, wrapped, committer: committerOf(wrapped.backend, clock, 100) }
}

/** Commits the plan and returns the tree the winning build produced. */
async function commitPlan(env: Awaited<ReturnType<typeof setup>>, plan: ScopedPlan): Promise<{ result: CommitResult, built: EncodedTree[] }> {
    const built: EncodedTree[] = []
    const result = await env.committer.commit(await env.committer.readCommit(), {
        newUnits: plan.newUnits, carry: IMPORT_REPLACES_BASE,
        build: (context) => {
            const tree = plan.finalize(context)
            built.push(tree)
            return builtCommitOf(tree)
        },
    })
    return { result, built }
}

async function storedDatabase(backend: Store2Backend): Promise<Database> {
    const key = await parsedCommit(backend)
    const current = key.current
    if (current === null) {
        throw new Error('No current manifest.')
    }
    const keys = await backend.listStore2()
    const stored = await backend.readUnits(keys)
    const manifest = readUnit(stored.get(current.key) as Uint8Array, UNIT_TYPE.manifest)
    if (manifest.status !== 'ok') {
        throw new Error('The current manifest does not parse.')
    }
    // `readUnit` was asked for the manifest type, so the body is a manifest.
    return assembleDatabase(manifest.value.body as Manifest, { get: unitKey => stored.get(unitKey) ?? undefined })
}

const EVERYTHING: EncodeScope = { modules: true, characters: 'all' }

describe('the mint bridge', () => {
    test('keys come from the injected mint, pass checkBuiltUnits, and the count before build is the count minted', async () => {
        const db = buildSmall(4)
        const first = encodeWith(db)
        const next = clone(db)
        ;(next.characters as Obj[])[1].personality = 'edited'
        const plan = await planScopedEncode(asDatabase(next), optionsOf(2, first), { modules: false, characters: new Set([chaIdOf(db, 1)]) })

        const attempt = createKeyMint(testEnv(createClock(), 9), null)
        const tree = plan.finalize(contextOf(attempt.mint))
        expect(attempt.issued.size).toBe(plan.newUnits)
        expect(unitsToWrite(tree).length).toBe(plan.newUnits)
        expect(checkBuiltUnits(builtCommitOf(tree), attempt.issued, plan.newUnits, false)).toBeNull()
        for (const unit of unitsToWrite(tree)) {
            expect(attempt.issued.has(unit.key), unit.identity).toBe(true)
        }
        // A reused unit keeps its previous key and is not one the mint issued.
        for (const unit of tree.units.filter(one => one.reused)) {
            expect(attempt.issued.has(unit.key), unit.identity).toBe(false)
            expect(unit.key).toBe(first.index.units.get(unit.identity)?.key)
        }
    })

    test('a retry finalizes again under its own mint with disjoint keys and the same structure', async () => {
        const db = buildSmall(3)
        const first = encodeWith(db)
        const next = clone(db)
        ;(next.statics as Obj).messages = 500
        const plan = await planScopedEncode(asDatabase(next), optionsOf(2, first), { modules: false, characters: new Set() })
        const a = createKeyMint(testEnv(createClock(), 10), null)
        const b = createKeyMint(testEnv(createClock(), 11), null)
        const treeA = plan.finalize(contextOf(a.mint))
        const treeB = plan.finalize(contextOf(b.mint))
        expect(checkBuiltUnits(builtCommitOf(treeB), b.issued, plan.newUnits, false)).toBeNull()
        expect([...a.issued].some(key => b.issued.has(key))).toBe(false)
        expect(treeA.units.map(unit => unit.identity)).toEqual(treeB.units.map(unit => unit.identity))
        expect(treeA.units.map(unit => unit.reused)).toEqual(treeB.units.map(unit => unit.reused))
    })

    test('the plan finalized under a mint is the single-pass encode under the same mint, key for key', async () => {
        const db = buildSmall(5)
        const first = encodeWith(db)
        const next = clone(db)
        ;(next.characters as Obj[])[2].personality = 'edited'
        ;((next.pluginCustomStorage as Obj)['plugin-4'] as Obj).counter = 5
        const scope: EncodeScope = { modules: false, characters: new Set([chaIdOf(db, 2)]) }
        const plan = await planScopedEncode(asDatabase(next), optionsOf(2, first), scope)
        const viaPlan = plan.finalize(contextOf(createKeyMint(testEnv(createClock(), 12), null).mint))
        const direct = await encodeScoped(asDatabase(next), { ...optionsOf(2, first), keys: createKeyMint(testEnv(createClock(), 12), null).mint }, scope)
        expect(viaPlan.manifestKey).toBe(direct.manifestKey)
        expect(viaPlan.manifest).toEqual(direct.manifest)
        expect(viaPlan.units.map(unit => unit.identity)).toEqual(direct.units.map(unit => unit.identity))
        viaPlan.units.forEach((unit, index) => {
            const other = direct.units[index]
            expect(other.key).toBe(unit.key)
            expect(other.reused, unit.identity).toBe(unit.reused)
            expect(other.ref, unit.identity).toEqual(unit.ref)
            expect(other.digest, unit.identity).toBe(unit.digest)
            if (unit.reused === false && other.reused === false) {
                expect(sameBytes(other.bytes, unit.bytes), unit.identity).toBe(true)
            }
        })
        expect(viaPlan.index.objects).toEqual(direct.index.objects)
        expect([...viaPlan.index.units]).toEqual([...direct.index.units])
    })
})

describe('commits of codec-built trees', () => {
    test('the first tree goes through the bulk path, a scoped edit through the ordinary path, and every key the manifest names reads', async () => {
        const env = await setup()
        const db = buildSmall(6)
        const firstPlan = await planScopedEncode(db, optionsOf(1, null), EVERYTHING)
        expect(firstPlan.newUnits).toBeGreaterThan(59)
        const first = await commitPlan(env, firstPlan)
        expect(expectCommitted(first.result).mode).toBe('bulk')
        await expectInvariant(env.raw)
        const firstTree = first.built[first.built.length - 1]

        const next = clone(db)
        ;(((next.characters as Obj[])[2].chats as Obj[])[0].message as Obj[])[0].data = 'edited in place'
        const plan = await planScopedEncode(asDatabase(next), optionsOf(2, firstTree), { modules: false, characters: new Set([chaIdOf(db, 2)]) })
        expect(plan.newUnits).toBeLessThanOrEqual(59)
        const putsBefore = env.wrapped.count('putUnit')
        const second = await commitPlan(env, plan)
        expect(expectCommitted(second.result).mode).toBe('ordinary')
        expect(env.wrapped.count('putUnit')).toBe(putsBefore)
        await expectInvariant(env.raw)

        const stored = await storedDatabase(env.raw)
        const reference = encodeWith(asDatabase(next))
        const full = assembleDatabase(reference.manifest, storeOf(reference))
        expect(stored).toEqual(full)
    })

    test('a scoped pass with carried characters that writes more than 59 units takes the bulk path and every carried key still reads', async () => {
        const env = await setup()
        const db = buildSmall(6)
        const first = await commitPlan(env, await planScopedEncode(db, optionsOf(1, null), EVERYTHING))
        expectCommitted(first.result)
        const firstTree = first.built[first.built.length - 1]

        const next = clone(db)
        const storage = next.pluginCustomStorage as Obj
        for (let i = 0; i < 70; i++) {
            storage[`bulk-key-${i}`] = { i }
        }
        const plan = await planScopedEncode(asDatabase(next), optionsOf(2, firstTree), { modules: false, characters: new Set() })
        expect(plan.newUnits).toBeGreaterThan(59)
        const putsBefore = env.wrapped.count('putUnit')
        const second = await commitPlan(env, plan)
        expect(expectCommitted(second.result).mode).toBe('bulk')
        expect(env.wrapped.count('putUnit') - putsBefore).toBe(plan.newUnits)
        await expectInvariant(env.raw)
        const reference = encodeWith(asDatabase(next))
        const stored = await storedDatabase(env.raw)
        expect(stored).toEqual(assembleDatabase(reference.manifest, storeOf(reference)))
    })

    test('a chain of scoped passes keeps naming units the store holds', async () => {
        const env = await setup()
        let db = buildSmall(4)
        let tree = (await commitPlan(env, await planScopedEncode(db, optionsOf(1, null), EVERYTHING))).built.at(-1) as EncodedTree
        for (let round = 0; round < 3; round++) {
            const next = clone(db)
            ;(next.characters as Obj[])[round].personality = `round ${round}`
            db = asDatabase(next)
            const done = await commitPlan(env, await planScopedEncode(db, optionsOf(10 + round, tree), { modules: false, characters: new Set([chaIdOf(db, round)]) }))
            expectCommitted(done.result)
            tree = done.built.at(-1) as EncodedTree
            await expectInvariant(env.raw)
        }
        const reference = encodeWith(db)
        expect(await storedDatabase(env.raw)).toEqual(assembleDatabase(reference.manifest, storeOf(reference)))
    })
})

describe('the attempt context and the no-change plan', () => {
    test('finalize frames the manifest with the attempt\'s seq and clock reading', async () => {
        const db = buildSmall(3)
        const first = encodeWith(db)
        const next = clone(db)
        ;(next.statics as Obj).messages = 3
        const plan = await planScopedEncode(asDatabase(next), optionsOf(2, first), { modules: false, characters: new Set() })
        const tree = plan.finalize(contextOf(createKeyMint(testEnv(createClock(), 20), null).mint, 41, 1_800_000_000_123))
        expect(tree.manifest.seq).toBe(41)
        expect(tree.manifest.createdAt).toBe(1_800_000_000_123)
        const stamped = readUnit(bytesOf(tree.units[tree.units.length - 1]), UNIT_TYPE.manifest)
        expect(stamped.status).toBe('ok')
        if (stamped.status === 'ok') {
            expect((stamped.value.body as Manifest).seq).toBe(41)
            expect((stamped.value.body as Manifest).createdAt).toBe(1_800_000_000_123)
        }
        expect(tree.index.objects?.manifest?.seq).toBe(41)
    })

    test('a committed scoped manifest carries the commit\'s own seq', async () => {
        const env = await setup()
        const db = buildSmall(6)
        const seen: number[] = []
        const first = await env.committer.commit(await env.committer.readCommit(), {
            newUnits: (await planScopedEncode(db, optionsOf(1, null), EVERYTHING)).newUnits, carry: IMPORT_REPLACES_BASE,
            build: async (context) => {
                const tree = (await planScopedEncode(db, optionsOf(1, null), EVERYTHING)).finalize(context)
                seen.push(context.seq, tree.manifest.seq)
                return builtCommitOf(tree)
            },
        })
        expectCommitted(first)
        expect(seen[0]).toBe(seen[1])
    })

    test('unchanged is true exactly when only the manifest would be written', async () => {
        const db = buildSmall(4)
        const first = encodeWith(db)
        const same = await planScopedEncode(db, optionsOf(2, first), { modules: false, characters: new Set() })
        expect(same.unchanged).toBe(true)
        expect(same.newUnits).toBe(1)
        const next = clone(db)
        ;(next.statics as Obj).messages = 1234
        const changed = await planScopedEncode(asDatabase(next), optionsOf(2, first), { modules: false, characters: new Set() })
        expect(changed.unchanged).toBe(false)
        expect(changed.newUnits).toBe(2)
    })
})