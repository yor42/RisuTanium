// @vitest-environment node
/**
 * The replay checker. Each property has one planted violation, built through the
 * fake's hooks and direct store calls (the only library code used is the pure
 * encoder that makes a commit key's bytes), and the checker must report exactly
 * that property. A clean run of a trivial commit and collection over the Node
 * backend and over the memory backend reports nothing.
 */
import { describe, expect, test } from 'vitest'
import { createNodeBackend } from 'src/ts/storage/store2/backend'
import { gcPass } from 'src/ts/storage/store2/gc/pass'
import {
    encodeUnit, newManifestKey, newShardKey, newStagedKey, newStagingId, newUnitKey, stagingPrefix, UNIT_TYPE,
    type KeyEnv, type Manifest,
} from 'src/ts/storage/store2/format'
import { FENCE_KEY, COMMIT_KEY } from 'src/ts/storage/store2/format/keys'
import {
    buildTree, committerOf, createClock, seedStore, testEnv, treeRequest, type BuildRecord,
} from '../commitFixtures'
import { createChecker, type Violation } from './checker'
import { GARBAGE, memoryRig, nodeRig, plantFenceKeys, plantNextCommit, stepper, storedCommit, tooNewCommitBytes, type NodeRig } from './replayFixtures'
import { createScheduler } from './scheduler'

const clock = createClock()
const env = testEnv(clock, 77)

function propertiesOf(found: readonly Violation[]): string[] {
    return [...new Set(found.map((violation) => violation.property))].sort()
}

async function seeded(): Promise<{ rig: NodeRig, manifest: string, units: string[] }> {
    const rig = nodeRig()
    const manifest = await seedStore(rig.backend, env)
    return { rig, manifest, units: rig.fake.list('store2/') }
}

let committerSeed = 900

/** A second complete tree committed by the library: the first becomes retained. */
async function commitSecond(rig: NodeRig): Promise<string> {
    const record: BuildRecord[] = []
    const result = await committerOf(rig.backend, clock, committerSeed++).commit(await rig.backend.readCommit(), treeRequest(0, { record }))
    expect(result.status).toBe('committed')
    return record[0].manifest
}

async function orphan(rig: NodeRig, scratch: KeyEnv = env): Promise<string> {
    const key = newUnitKey(scratch)
    await rig.fake.store.write(key, encodeUnit(UNIT_TYPE.preset, { v: 1, orphan: key }), { ifVersion: 0 })
    return key
}

async function uploadTree(rig: NodeRig, seq: number): Promise<{ manifestKey: string, body: Manifest }> {
    const built = buildTree(0, {
        mint: { shard: () => newShardKey(env), unit: () => newUnitKey(env), manifest: () => newManifestKey(env) },
        seq,
        now: env.now(),
    }, `planted-${seq}`)
    for (const unit of [...built.units, { key: built.manifest.key, bytes: encodeUnit(UNIT_TYPE.manifest, built.manifest.body) }]) {
        await rig.fake.store.write(unit.key, unit.bytes, { ifVersion: 0 })
    }
    return { manifestKey: built.manifest.key, body: built.manifest.body }
}

describe('a clean state and clean steps report nothing', () => {
    test('observing a step that changed nothing, over a healthy store, is clean', async () => {
        const { rig } = await seeded()
        const step = stepper(createChecker(rig.raw))
        expect(step('a', 'readCommit')).toEqual([])
        expect(step('a', 'listStore2')).toEqual([])
    })

    test('a lost request, which changes nothing, is clean', async () => {
        const { rig } = await seeded()
        const step = stepper(createChecker(rig.raw))
        expect(step('a', 'putUnit', { kind: 'commit' }, { applied: false, fault: 'lost-request' })).toEqual([])
    })
})

describe('one planted violation per property is reported as exactly that property', () => {
    test('I1: a unit of the current tree is gone', async () => {
        const { rig, manifest, units } = await seeded()
        const step = stepper(createChecker(rig.raw))
        const victim = units.find((key) => key !== manifest)!
        await rig.fake.store.delete(victim, 'unconditional')
        const found = step('a', 'delete')
        expect(propertiesOf(found)).toEqual(['I1'])
        expect(found[0].detail).toContain(victim)
    })

    test('I1: a standing violation is reported once, not at every later step', async () => {
        const { rig, manifest, units } = await seeded()
        const step = stepper(createChecker(rig.raw))
        await rig.fake.store.delete(units.find((key) => key !== manifest)!, 'unconditional')
        expect(step('a', 'delete')).toHaveLength(1)
        expect(step('a', 'readCommit')).toEqual([])
    })

    test('the I1 walk is skipped while the commit key does not parse', async () => {
        const { rig, manifest, units } = await seeded()
        const step = stepper(createChecker(rig.raw))
        // The unit goes and the key is damaged within one step, so only the walk could report it.
        await rig.fake.store.delete(units.find((key) => key !== manifest)!, 'unconditional')
        rig.fake.damage(COMMIT_KEY, GARBAGE)
        expect(step('a', 'delete')).toEqual([])
    })

    describe('I1: nothing is removed while the commit key allows no deleter', () => {
        test('the commit key is damaged', async () => {
            const { rig } = await seeded()
            const step = stepper(createChecker(rig.raw))
            const key = await orphan(rig)
            rig.fake.damage(COMMIT_KEY, GARBAGE)
            expect(step('$env', 'damage-commit', null, { kind: 'env', fault: 'damage-commit' })).toEqual([])
            await rig.fake.store.delete(key, 'unconditional')
            const found = step('g', 'removeBatch', { kind: 'gc' })
            expect(propertiesOf(found)).toEqual(['I1'])
            expect(found[0].detail).toContain('while the commit key was')
        })

        test('the commit key is absent', async () => {
            const rig = nodeRig()
            const step = stepper(createChecker(rig.raw))
            const key = await orphan(rig)
            expect(step('a', 'putUnit')).toEqual([])
            await rig.fake.store.delete(key, 'unconditional')
            expect(propertiesOf(step('g', 'removeBatch', { kind: 'gc' }))).toEqual(['I1'])
        })

        test('the commit key is too new', async () => {
            const { rig } = await seeded()
            const step = stepper(createChecker(rig.raw))
            const key = await orphan(rig)
            rig.fake.damage(COMMIT_KEY, await tooNewCommitBytes(rig.fake))
            expect(step('$env', 'damage-commit', null, { kind: 'env', fault: 'damage-commit' })).toEqual([])
            await rig.fake.store.delete(key, 'unconditional')
            expect(propertiesOf(step('g', 'removeBatch', { kind: 'gc' }))).toEqual(['I1'])
        })

        test('the commit key names no current', async () => {
            const { rig } = await seeded()
            const step = stepper(createChecker(rig.raw))
            const key = await orphan(rig)
            await plantNextCommit(rig.fake, { current: null }, env)
            step('a', 'casCommit', { kind: 'recovery-begin', owner: 'a' })
            await rig.fake.store.delete(key, 'unconditional')
            expect(propertiesOf(step('g', 'removeBatch', { kind: 'gc' }))).toEqual(['I1'])
        })

        test('a removal under a healthy commit key is clean', async () => {
            const { rig } = await seeded()
            const step = stepper(createChecker(rig.raw))
            const key = await orphan(rig)
            await rig.fake.store.delete(key, 'unconditional')
            expect(step('g', 'removeBatch', { kind: 'gc' })).toEqual([])
        })
    })

    test('b: a restore installs a manifest whose tree lost a unit, and it is not also reported as I1', async () => {
        const { rig, manifest: first, units: firstUnits } = await seeded()
        const second = await commitSecond(rig)
        const step = stepper(createChecker(rig.raw))
        await rig.fake.store.delete(firstUnits.find((key) => key !== first)!, 'unconditional')
        await plantNextCommit(rig.fake, { current: { key: first, at: 5 }, retained: [{ key: second, at: 4 }] }, env)
        const found = step('a', 'restore', { kind: 'restore', owner: 'a' })
        expect(propertiesOf(found)).toEqual(['b'])
        expect(propertiesOf(step('a', 'readCommit'))).toEqual([])
    })

    test('b is for a restore only: the same write by a commit is an I1 violation', async () => {
        const { rig, manifest: first, units: firstUnits } = await seeded()
        const second = await commitSecond(rig)
        const step = stepper(createChecker(rig.raw))
        await rig.fake.store.delete(firstUnits.find((key) => key !== first)!, 'unconditional')
        await plantNextCommit(rig.fake, { current: { key: first, at: 5 }, retained: [{ key: second, at: 4 }] }, env)
        expect(propertiesOf(step('a', 'commit', { kind: 'commit', owner: 'a' }))).toEqual(['I1'])
    })

    test('I2: a unit key created, removed and created again', async () => {
        const { rig } = await seeded()
        const step = stepper(createChecker(rig.raw))
        const key = await orphan(rig)
        expect(step('a', 'putUnit')).toEqual([])
        await rig.fake.store.delete(key, 'unconditional')
        expect(step('a', 'removeBatch')).toEqual([])
        await rig.fake.store.write(key, encodeUnit(UNIT_TYPE.preset, { v: 1, again: true }), { ifVersion: 2 })
        expect(propertiesOf(step('a', 'putUnit'))).toEqual(['I2'])
    })

    test('I2: a unit rewritten in place', async () => {
        const { rig } = await seeded()
        const step = stepper(createChecker(rig.raw))
        const key = await orphan(rig)
        expect(step('a', 'putUnit')).toEqual([])
        await rig.fake.store.write(key, encodeUnit(UNIT_TYPE.preset, { v: 1, other: true }), 'unconditional')
        expect(propertiesOf(step('a', 'putUnit'))).toEqual(['I2'])
    })

    test('I3: a commit-key write that did not present the stored version', async () => {
        const { rig } = await seeded()
        const step = stepper(createChecker(rig.raw))
        const before = await storedCommit(rig.fake)
        await plantNextCommit(rig.fake, {}, env)
        const found = step('a', 'casCommit', { kind: 'commit' }, { commitExpect: { kind: 'revision', revision: before.revision - 1 } })
        expect(propertiesOf(found)).toEqual(['I3'])
    })

    test('I3: a commit-key value that was not built from the stored seq', async () => {
        const { rig } = await seeded()
        const step = stepper(createChecker(rig.raw))
        const before = await storedCommit(rig.fake)
        await plantNextCommit(rig.fake, {}, env, { seq: before.key.seq + 5 })
        const found = step('a', 'casCommit', { kind: 'commit' }, { commitExpect: { kind: 'revision', revision: before.revision } })
        expect(propertiesOf(found)).toEqual(['I3'])
    })

    test('I3: an honest write that presented the stored version is clean', async () => {
        const { rig } = await seeded()
        const step = stepper(createChecker(rig.raw))
        const before = await storedCommit(rig.fake)
        await plantNextCommit(rig.fake, {}, env)
        expect(step('a', 'casCommit', { kind: 'commit' }, { commitExpect: { kind: 'revision', revision: before.revision } })).toEqual([])
    })

    test('h: a staging marker set by an operation that may not set one', async () => {
        const { rig } = await seeded()
        const step = stepper(createChecker(rig.raw))
        const prefix = stagingPrefix(newStagingId(env))
        await plantNextCommit(rig.fake, { staging: { owner: 'a', prefix, startedAt: 1, label: 'bulk' } }, env)
        expect(propertiesOf(step('a', 'casCommit', { kind: 'commit', owner: 'a' }))).toEqual(['h'])
    })

    test('h: the same marker set by a bulk begin of its owner is clean', async () => {
        const { rig } = await seeded()
        const step = stepper(createChecker(rig.raw))
        const prefix = stagingPrefix(newStagingId(env))
        await plantNextCommit(rig.fake, { staging: { owner: 'a', prefix, startedAt: 1, label: 'bulk' } }, env)
        expect(step('a', 'casCommit', { kind: 'bulk-begin', owner: 'a' })).toEqual([])
    })

    test('h: an abandon-clear is allowed only for the marker it names', async () => {
        const { rig } = await seeded()
        const step = stepper(createChecker(rig.raw))
        const prefix = stagingPrefix(newStagingId(env))
        await plantNextCommit(rig.fake, { staging: { owner: 'dead', prefix, startedAt: 1, label: 'bulk' } }, env)
        expect(step('dead', 'casCommit', { kind: 'bulk-begin', owner: 'dead' })).toEqual([])
        await plantNextCommit(rig.fake, { staging: null }, env)
        expect(propertiesOf(step('a', 'casCommit', { kind: 'abandon-clear', owner: 'a', abandon: { owner: 'dead', prefix: `${prefix}x` } }))).toEqual(['h'])
    })

    test('h: a removal under a standing staging prefix, also while the commit key is damaged', async () => {
        const { rig } = await seeded()
        const step = stepper(createChecker(rig.raw))
        const stagingId = newStagingId(env)
        const prefix = stagingPrefix(stagingId)
        await plantNextCommit(rig.fake, { staging: { owner: 'a', prefix, startedAt: 1, label: 'bulk' } }, env)
        expect(step('a', 'casCommit', { kind: 'bulk-begin', owner: 'a' })).toEqual([])
        const staged = newStagedKey(stagingId, 'u', env)
        await rig.fake.store.write(staged, encodeUnit(UNIT_TYPE.preset, { v: 1, staged: true }), { ifVersion: 0 })
        expect(step('a', 'putUnit', { kind: 'bulk-begin', owner: 'a' })).toEqual([])
        rig.fake.damage(COMMIT_KEY, GARBAGE)
        expect(step('$env', 'damage-commit', null, { kind: 'env', fault: 'damage-commit' })).toEqual([])
        await rig.fake.store.delete(staged, 'unconditional')
        // The same removal is also a deletion under a commit key that allows none.
        expect(propertiesOf(step('g', 'removeBatch', { kind: 'gc' }))).toEqual(['I1', 'h'])
    })

    test('h: a write that clears a standing marker over a damaged commit key is judged against the value before the damage', async () => {
        const { rig } = await seeded()
        const step = stepper(createChecker(rig.raw))
        const prefix = stagingPrefix(newStagingId(env))
        const marked = await plantNextCommit(rig.fake, { staging: { owner: 'a', prefix, startedAt: 1, label: 'bulk' } }, env)
        expect(step('a', 'casCommit', { kind: 'bulk-begin', owner: 'a' })).toEqual([])
        rig.fake.damage(COMMIT_KEY, GARBAGE)
        expect(step('$env', 'damage-commit', null, { kind: 'env', fault: 'damage-commit' })).toEqual([])
        // Written at the stored (unchanged) revision: silent damage keeps it.
        await rig.fake.store.write(COMMIT_KEY, encodeUnit(UNIT_TYPE.commit, { ...marked, seq: marked.seq + 1, staging: null }), { ifVersion: rig.fake.peek(COMMIT_KEY).revision })
        expect(propertiesOf(step('b', 'casCommit', { kind: 'commit', owner: 'b' }))).toEqual(['h'])
    })

    describe('amendment J: the deleter gate is judged at the deleter\'s own read', () => {
        test('(i) a deleter that read the damaged commit key and then deleted is reported', async () => {
            const { rig } = await seeded()
            const step = stepper(createChecker(rig.raw))
            const key = await orphan(rig)
            rig.fake.damage(COMMIT_KEY, GARBAGE)
            expect(step('$env', 'damage-commit', null, { kind: 'env', fault: 'damage-commit' })).toEqual([])
            expect(step('g', 'readCommit', { kind: 'gc' })).toEqual([])
            await rig.fake.store.delete(key, 'unconditional')
            const found = step('g', 'removeBatch', { kind: 'gc' })
            expect(propertiesOf(found)).toEqual(['I1'])
            expect(found[0].detail).toContain('while the commit key was')
        })

        test('a deleter that read the damaged commit key is reported even after the key was healed before the removal', async () => {
            const { rig } = await seeded()
            const step = stepper(createChecker(rig.raw))
            const key = await orphan(rig)
            const healthy = rig.fake.peek(COMMIT_KEY).bytes!
            rig.fake.damage(COMMIT_KEY, GARBAGE)
            expect(step('$env', 'damage-commit', null, { kind: 'env', fault: 'damage-commit' })).toEqual([])
            expect(step('g', 'readCommit', { kind: 'gc' })).toEqual([])
            rig.fake.damage(COMMIT_KEY, healthy)
            // The heal step reuses the `damage-commit` env kind because there is no heal kind.
            expect(step('$env', 'damage-commit', null, { kind: 'env', fault: 'damage-commit' })).toEqual([])
            await rig.fake.store.delete(key, 'unconditional')
            const found = step('g', 'removeBatch', { kind: 'gc' })
            expect(propertiesOf(found)).toEqual(['I1'])
            expect(found[0].detail).toContain('while the commit key was')
        })

        test('(ii) damage after the gate read, garbage unreachable from the pre-damage key: clean', async () => {
            const { rig } = await seeded()
            const step = stepper(createChecker(rig.raw))
            const key = await orphan(rig)
            expect(step('g', 'readCommit', { kind: 'gc' })).toEqual([])
            rig.fake.damage(COMMIT_KEY, GARBAGE)
            expect(step('$env', 'damage-commit', null, { kind: 'env', fault: 'damage-commit' })).toEqual([])
            await rig.fake.store.delete(key, 'unconditional')
            expect(step('g', 'removeBatch', { kind: 'gc' })).toEqual([])
        })

        test('(iii) damage after the gate read, the removed key reachable from the pre-damage key: I1', async () => {
            const { rig, manifest, units } = await seeded()
            const step = stepper(createChecker(rig.raw))
            const victim = units.find((key) => key !== manifest)!
            expect(step('g', 'readCommit', { kind: 'gc' })).toEqual([])
            rig.fake.damage(COMMIT_KEY, GARBAGE)
            expect(step('$env', 'damage-commit', null, { kind: 'env', fault: 'damage-commit' })).toEqual([])
            await rig.fake.store.delete(victim, 'unconditional')
            const found = step('g', 'removeBatch', { kind: 'gc' })
            expect(propertiesOf(found)).toEqual(['I1'])
            expect(found[0].detail).toContain(victim)
            expect(found[0].detail).toContain('before it was damaged')
        })

        test('(iv) a deleter that read a blocked fence and then deleted is reported', async () => {
            const { rig } = await seeded()
            const step = stepper(createChecker(rig.raw))
            const listed = await orphan(rig)
            const other = await orphan(rig)
            await plantFenceKeys(rig.fake, [listed])
            expect(step('a', 'casFence', { kind: 'fence-exit' })).toEqual([])
            rig.fake.damage(FENCE_KEY, GARBAGE)
            expect(step('$env', 'damage-fence', null, { kind: 'env', fault: 'damage-fence' })).toEqual([])
            expect(step('g', 'readFence', { kind: 'gc' })).toEqual([])
            await rig.fake.store.delete(other, 'unconditional')
            const found = step('g', 'removeBatch', { kind: 'gc' })
            expect(propertiesOf(found)).toEqual(['G1'])
            expect(found[0].detail).toContain('after it read a fence')
        })

        test('(v) fence damage after the read, garbage not in the pre-damage list: clean', async () => {
            const { rig } = await seeded()
            const step = stepper(createChecker(rig.raw))
            const listed = await orphan(rig)
            const other = await orphan(rig)
            await plantFenceKeys(rig.fake, [listed])
            expect(step('a', 'casFence', { kind: 'fence-exit' })).toEqual([])
            expect(step('g', 'readFence', { kind: 'gc' })).toEqual([])
            rig.fake.damage(FENCE_KEY, GARBAGE)
            expect(step('$env', 'damage-fence', null, { kind: 'env', fault: 'damage-fence' })).toEqual([])
            await rig.fake.store.delete(other, 'unconditional')
            expect(step('g', 'removeBatch', { kind: 'gc' })).toEqual([])
        })

        test('(vi) fence damage after the read, the removed key in the pre-damage list: G1', async () => {
            const { rig } = await seeded()
            const step = stepper(createChecker(rig.raw))
            const listed = await orphan(rig)
            await plantFenceKeys(rig.fake, [listed])
            expect(step('a', 'casFence', { kind: 'fence-exit' })).toEqual([])
            expect(step('g', 'readFence', { kind: 'gc' })).toEqual([])
            rig.fake.damage(FENCE_KEY, GARBAGE)
            expect(step('$env', 'damage-fence', null, { kind: 'env', fault: 'damage-fence' })).toEqual([])
            await rig.fake.store.delete(listed, 'unconditional')
            const found = step('g', 'removeBatch', { kind: 'gc' })
            expect(propertiesOf(found)).toEqual(['G1'])
            expect(found[0].detail).toContain('before it was damaged')
        })

        test('a ByteStore read of the commit key is the gate read: damage after it is judged against the pre-damage key', async () => {
            const { rig, manifest, units } = await seeded()
            const step = stepper(createChecker(rig.raw))
            const garbage = await orphan(rig)
            const victim = units.find((key) => key !== manifest)!
            expect(step('g', 'read', { kind: 'gc' }, { target: COMMIT_KEY })).toEqual([])
            rig.fake.damage(COMMIT_KEY, GARBAGE)
            expect(step('$env', 'damage-commit', null, { kind: 'env', fault: 'damage-commit' })).toEqual([])
            await rig.fake.store.delete(garbage, 'unconditional')
            expect(step('g', 'deleteMany', { kind: 'gc' })).toEqual([])
            await rig.fake.store.delete(victim, 'unconditional')
            expect(propertiesOf(step('g', 'deleteMany', { kind: 'gc' }))).toEqual(['I1'])
        })

        test('a ByteStore read of the fence key is the gate read: a blocked fence read, then a removal, is G1', async () => {
            const { rig } = await seeded()
            const step = stepper(createChecker(rig.raw))
            const listed = await orphan(rig)
            const other = await orphan(rig)
            await plantFenceKeys(rig.fake, [listed])
            expect(step('a', 'casFence', { kind: 'fence-exit' })).toEqual([])
            rig.fake.damage(FENCE_KEY, GARBAGE)
            expect(step('$env', 'damage-fence', null, { kind: 'env', fault: 'damage-fence' })).toEqual([])
            expect(step('g', 'read', { kind: 'gc' }, { target: FENCE_KEY })).toEqual([])
            await rig.fake.store.delete(other, 'unconditional')
            const found = step('g', 'deleteMany', { kind: 'gc' })
            expect(propertiesOf(found)).toEqual(['G1'])
            expect(found[0].detail).toContain('after it read a fence')
        })
    })

    test('G1: a key a standing fence lists is removed', async () => {
        const { rig } = await seeded()
        const step = stepper(createChecker(rig.raw))
        const key = await orphan(rig)
        await plantFenceKeys(rig.fake, [key])
        expect(step('a', 'casFence', { kind: 'fence-exit' })).toEqual([])
        await rig.fake.store.delete(key, 'unconditional')
        expect(propertiesOf(step('g', 'removeBatch', { kind: 'gc' }))).toEqual(['G1'])
    })

    test('G1: nothing is removed while the fence cannot be understood', async () => {
        const { rig } = await seeded()
        const step = stepper(createChecker(rig.raw))
        const listed = await orphan(rig)
        const other = await orphan(rig)
        await plantFenceKeys(rig.fake, [listed])
        expect(step('a', 'casFence', { kind: 'fence-exit' })).toEqual([])
        rig.fake.damage(FENCE_KEY, GARBAGE)
        expect(step('$env', 'damage-fence', null, { kind: 'env', fault: 'damage-fence' })).toEqual([])
        await rig.fake.store.delete(other, 'unconditional')
        const found = step('g', 'removeBatch', { kind: 'gc' })
        expect(propertiesOf(found)).toEqual(['G1'])
        expect(found[0].detail).toContain('could not be understood')
    })

    test('G1: the fence key is written by an operation that is not a fence exit', async () => {
        const { rig } = await seeded()
        const step = stepper(createChecker(rig.raw))
        await plantFenceKeys(rig.fake, [await orphan(rig)])
        const found = step('a', 'casFence', { kind: 'restore', owner: 'a' })
        expect(propertiesOf(found)).toEqual(['G1'])
        expect(found[0].detail).toContain('not a fence exit')
    })

    test('G1: the fence key is removed by an operation that is not a fence discard', async () => {
        const { rig } = await seeded()
        const step = stepper(createChecker(rig.raw))
        await plantFenceKeys(rig.fake, [await orphan(rig)])
        expect(step('a', 'casFence', { kind: 'fence-exit' })).toEqual([])
        await rig.fake.store.delete(FENCE_KEY, 'unconditional')
        const found = step('g', 'removeBatch', { kind: 'gc' })
        expect(propertiesOf(found)).toEqual(['G1'])
        expect(found[0].detail).toContain('not a fence discard')
    })

    test('G1: a fence discard removes the fence key without a report', async () => {
        const { rig } = await seeded()
        const step = stepper(createChecker(rig.raw))
        await plantFenceKeys(rig.fake, [await orphan(rig)])
        expect(step('a', 'casFence', { kind: 'fence-exit' })).toEqual([])
        await rig.fake.store.delete(FENCE_KEY, 'unconditional')
        expect(step('a', 'casFence', { kind: 'fence-discard' })).toEqual([])
    })

    test('G1: a removal that presented a fence other than the stored one', async () => {
        const { rig } = await seeded()
        const step = stepper(createChecker(rig.raw))
        const key = await orphan(rig)
        await plantFenceKeys(rig.fake, [await orphan(rig)])
        expect(step('a', 'casFence', { kind: 'fence-exit' })).toEqual([])
        const stored = rig.fake.peek(FENCE_KEY).revision
        await rig.fake.store.delete(key, 'unconditional')
        const found = step('g', 'removeBatch', { kind: 'gc' }, { fenceExpect: { kind: 'revision', revision: stored - 1 } })
        expect(propertiesOf(found)).toEqual(['G1'])
        expect(found[0].detail).toContain('other than the one it presented')
    })

    test('G1: a removal while no fence stands is clean', async () => {
        const { rig } = await seeded()
        const step = stepper(createChecker(rig.raw))
        const key = await orphan(rig)
        expect(step('a', 'setup')).toEqual([])
        await rig.fake.store.delete(key, 'unconditional')
        expect(step('g', 'removeBatch', { kind: 'gc' })).toEqual([])
    })

    test('G10: a fence write that drops a listed key', async () => {
        const { rig } = await seeded()
        const step = stepper(createChecker(rig.raw))
        const [one, two] = [await orphan(rig), await orphan(rig)]
        await plantFenceKeys(rig.fake, [one, two])
        expect(step('a', 'casFence', { kind: 'fence-exit' })).toEqual([])
        await plantFenceKeys(rig.fake, [one])
        expect(propertiesOf(step('a', 'casFence', { kind: 'fence-exit' }))).toEqual(['G10'])
    })

    test('G10: over a damaged fence the list to keep is the last one that parsed', async () => {
        const { rig } = await seeded()
        const step = stepper(createChecker(rig.raw))
        const [one, two] = [await orphan(rig), await orphan(rig)]
        await plantFenceKeys(rig.fake, [one, two])
        expect(step('a', 'casFence', { kind: 'fence-exit' })).toEqual([])
        rig.fake.damage(FENCE_KEY, GARBAGE)
        expect(step('$env', 'damage-fence', null, { kind: 'env', fault: 'damage-fence' })).toEqual([])
        await plantFenceKeys(rig.fake, [one])
        expect(propertiesOf(step('a', 'casFence', { kind: 'fence-exit' }))).toEqual(['G10'])
    })

    test('G10: a fence write that only grows its list is clean', async () => {
        const { rig } = await seeded()
        const step = stepper(createChecker(rig.raw))
        const [one, two] = [await orphan(rig), await orphan(rig)]
        await plantFenceKeys(rig.fake, [one])
        expect(step('a', 'casFence', { kind: 'fence-exit' })).toEqual([])
        await plantFenceKeys(rig.fake, [one, two])
        expect(step('a', 'casFence', { kind: 'fence-exit' })).toEqual([])
    })

    test('i: a bulk install that names units another actor uploaded', async () => {
        const { rig } = await seeded()
        const step = stepper(createChecker(rig.raw))
        const prefix = stagingPrefix(newStagingId(env))
        await plantNextCommit(rig.fake, { staging: { owner: 'me', prefix, startedAt: 1, label: 'bulk' } }, env)
        expect(step('me', 'casCommit', { kind: 'bulk-begin', owner: 'me' })).toEqual([])
        const planted = await uploadTree(rig, 9)
        expect(step('other', 'putUnit', { kind: 'bulk-begin', owner: 'other' })).toEqual([])
        await plantNextCommit(rig.fake, { current: { key: planted.manifestKey, at: 6 }, staging: null, manifests: [planted.body] }, env)
        const found = step('me', 'casCommit', { kind: 'bulk-final', owner: 'me' })
        expect(propertiesOf(found)).toEqual(['i'])
    })

    test('i: the same install of units its own actor uploaded is clean', async () => {
        const { rig } = await seeded()
        const step = stepper(createChecker(rig.raw))
        const prefix = stagingPrefix(newStagingId(env))
        await plantNextCommit(rig.fake, { staging: { owner: 'me', prefix, startedAt: 1, label: 'bulk' } }, env)
        expect(step('me', 'casCommit', { kind: 'bulk-begin', owner: 'me' })).toEqual([])
        const planted = await uploadTree(rig, 9)
        expect(step('me', 'putUnit', { kind: 'bulk-begin', owner: 'me' })).toEqual([])
        await plantNextCommit(rig.fake, { current: { key: planted.manifestKey, at: 6 }, staging: null, manifests: [planted.body] }, env)
        expect(step('me', 'casCommit', { kind: 'bulk-final', owner: 'me' })).toEqual([])
    })

    test('p: pins changed by an operation that is not a pin operation', async () => {
        const { rig, manifest } = await seeded()
        const step = stepper(createChecker(rig.raw))
        await plantNextCommit(rig.fake, { pins: [{ key: manifest, reason: 'planted' }] }, env)
        expect(propertiesOf(step('a', 'casCommit', { kind: 'commit' }))).toEqual(['p'])
    })

    test('p: the same change by a pin is clean', async () => {
        const { rig, manifest } = await seeded()
        const step = stepper(createChecker(rig.raw))
        await plantNextCommit(rig.fake, { pins: [{ key: manifest, reason: 'planted' }] }, env)
        expect(step('a', 'casCommit', { kind: 'pin' })).toEqual([])
    })

    test('r: a restore that does not push the previous current', async () => {
        const { rig, manifest: first } = await seeded()
        await commitSecond(rig)
        const step = stepper(createChecker(rig.raw))
        await plantNextCommit(rig.fake, { current: { key: first, at: 5 }, retained: [] }, env)
        expect(propertiesOf(step('a', 'restore', { kind: 'restore', owner: 'a' }))).toEqual(['r'])
    })

    test('r: a restore that pushes the previous current is clean', async () => {
        const { rig, manifest: first } = await seeded()
        const second = await commitSecond(rig)
        const step = stepper(createChecker(rig.raw))
        await plantNextCommit(rig.fake, { current: { key: first, at: 5 }, retained: [{ key: second, at: 4 }] }, env)
        expect(step('a', 'restore', { kind: 'restore', owner: 'a' })).toEqual([])
    })

    test('I4: the commit key is removed', async () => {
        const { rig } = await seeded()
        const step = stepper(createChecker(rig.raw))
        await rig.fake.store.delete(COMMIT_KEY, 'unconditional')
        expect(propertiesOf(step('a', 'delete'))).toEqual(['I4'])
    })
})

describe('a clean run of a trivial commit and collection reports no violation', () => {
    test('over the Node backend on the Node-semantics fake', async () => {
        const rig = nodeRig()
        await seedStore(rig.backend, env)
        await orphan(rig)
        const checker = createChecker(rig.raw)
        const scheduler = createScheduler({ seed: 21, onStep: (info) => checker.observe(info) })
        scheduler.spawn('committer', async (actor) => {
            const backend = createNodeBackend(actor.byteStore(rig.fake.store))
            actor.setContext({ kind: 'commit' })
            await committerOf(backend, clock, 3001).commit(await backend.readCommit(), treeRequest(0))
        })
        scheduler.spawn('collector', async (actor) => {
            const store = actor.byteStore(rig.fake.store)
            actor.setContext({ kind: 'gc' })
            await gcPass({ backend: createNodeBackend(store), kind: 'node', idleReason: () => null, probe: () => store.guarded!.probe() })
        })
        const result = await scheduler.run()
        expect(result.status).toBe('finished')
        expect(result.actors.committer.state).toBe('done')
        expect(result.actors.collector.state).toBe('done')
        expect(result.steps).toBeGreaterThan(10)
        expect(checker.violations).toEqual([])
    })

    test('over the memory backend', async () => {
        const rig = memoryRig()
        await seedStore(rig.memory, env)
        await rig.memory.putUnit(newUnitKey(env), encodeUnit(UNIT_TYPE.preset, { v: 1, orphan: true }))
        const checker = createChecker(rig.raw)
        const scheduler = createScheduler({ seed: 22, onStep: (info) => checker.observe(info) })
        scheduler.spawn('committer', async (actor) => {
            const backend = actor.backend(rig.memory)
            actor.setContext({ kind: 'commit' })
            await committerOf(backend, clock, 3002).commit(await backend.readCommit(), treeRequest(0))
        })
        scheduler.spawn('collector', async (actor) => {
            actor.setContext({ kind: 'gc' })
            await gcPass({ backend: actor.backend(rig.memory), kind: 'indexeddb', idleReason: () => null })
        })
        const result = await scheduler.run()
        expect(result.status).toBe('finished')
        expect(result.steps).toBeGreaterThan(8)
        expect(checker.violations).toEqual([])
    })

    test('under random lost calls and crashes, two committers and a collector keep every property', async () => {
        let faulted = 0
        for (let seed = 1; seed <= 20; seed++) {
            const rig = nodeRig()
            await seedStore(rig.backend, env)
            await orphan(rig)
            const checker = createChecker(rig.raw)
            const scheduler = createScheduler({
                seed,
                faults: { mode: 'random', probability: 0.15, budget: { lostPerActor: 1, crashPerActor: 1 } },
                onStep: (info) => checker.observe(info),
            })
            for (const id of ['c1', 'c2']) {
                scheduler.spawn(id, async (actor) => {
                    const backend = createNodeBackend(actor.byteStore(rig.fake.store))
                    actor.setContext({ kind: 'commit', owner: id })
                    await committerOf(backend, clock, 4000 + seed * 10 + (id === 'c1' ? 1 : 2)).commit(await backend.readCommit(), treeRequest(0))
                })
            }
            scheduler.spawn('gc', async (actor) => {
                const store = actor.byteStore(rig.fake.store)
                actor.setContext({ kind: 'gc' })
                await gcPass({ backend: createNodeBackend(store), kind: 'node', idleReason: () => null, probe: () => store.guarded!.probe() })
            })
            const result = await scheduler.run()
            expect(result.status, `seed ${seed}`).toBe('finished')
            expect(Object.values(result.actors).filter((actor) => actor.state === 'failed'), `seed ${seed}`).toEqual([])
            expect(checker.violations, `seed ${seed}`).toEqual([])
            faulted += scheduler.log.filter((entry) => entry.fault !== null).length
        }
        expect(faulted).toBeGreaterThan(0)
    })
})
