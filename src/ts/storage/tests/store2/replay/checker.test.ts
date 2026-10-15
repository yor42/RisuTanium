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
        // The label is wrong for the marker (h) and another owner's marker went with no consent (h2).
        expect(propertiesOf(step('a', 'casCommit', { kind: 'abandon-clear', owner: 'a', abandon: { owner: 'dead', prefix: `${prefix}x` } }))).toEqual(['h', 'h2'])
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
        // h judges against the value before the damage; h2 does not apply to a replacement of an unparsable key.
        expect(propertiesOf(step('b', 'casCommit', { kind: 'commit', owner: 'b' }))).toEqual(['h'])
    })

    describe('h2: another owner\'s marker changes only with a consent recorded for that marker', () => {
        const marker = (owner: string, prefix: string) => ({ owner, prefix, startedAt: 1, label: 'seed' as const })

        async function withMarker(owner: string): Promise<{ rig: NodeRig, prefix: string, step: ReturnType<typeof stepper>, checker: ReturnType<typeof createChecker> }> {
            const { rig } = await seeded()
            const prefix = stagingPrefix(newStagingId(env))
            await plantNextCommit(rig.fake, { staging: marker(owner, prefix) }, env)
            const checker = createChecker(rig.raw)
            return { rig, prefix, step: stepper(checker), checker }
        }

        test('a foreign marker cleared with no consent is red, whatever label the write carries', async () => {
            const { rig, step } = await withMarker('x')
            await plantNextCommit(rig.fake, { staging: null }, env)
            const found = step('a', 'casCommit', { kind: 'foreign-clear', owner: 'a' })
            expect(propertiesOf(found)).toEqual(['h2'])
            expect(found[0].detail).toContain('without a consent')
        })

        test('a foreign marker replaced by another one with no consent is red', async () => {
            const { rig, step } = await withMarker('x')
            await plantNextCommit(rig.fake, { staging: marker('a', stagingPrefix(newStagingId(env))) }, env)
            expect(propertiesOf(step('a', 'casCommit', { kind: 'recovery-begin', owner: 'a' }))).toEqual(['h2'])
        })

        test('the same change after a consent of the acting page for that marker is clean', async () => {
            const { rig, prefix, step, checker } = await withMarker('x')
            checker.consent({ page: 'a', owner: 'x', prefix })
            await plantNextCommit(rig.fake, { staging: null }, env)
            expect(step('a', 'casCommit', { kind: 'foreign-clear', owner: 'a' })).toEqual([])
        })

        test('a consent for another prefix, another owner or another page does not count', async () => {
            const { rig, prefix, step, checker } = await withMarker('x')
            checker.consent({ page: 'a', owner: 'x', prefix: `${prefix}other` })
            checker.consent({ page: 'a', owner: 'y', prefix })
            checker.consent({ page: 'b', owner: 'x', prefix })
            await plantNextCommit(rig.fake, { staging: null }, env)
            expect(propertiesOf(step('a', 'casCommit', { kind: 'foreign-clear', owner: 'a' }))).toEqual(['h2'])
        })

        test('a consent given after the change does not excuse it', async () => {
            const { rig, prefix, step, checker } = await withMarker('x')
            await plantNextCommit(rig.fake, { staging: null }, env)
            const found = step('a', 'casCommit', { kind: 'foreign-clear', owner: 'a' })
            checker.consent({ page: 'a', owner: 'x', prefix })
            expect(propertiesOf(found)).toEqual(['h2'])
        })

        test('the damage rule: a foreign marker replaced while the stored commit key is damaged is not judged by h2', async () => {
            const { rig } = await seeded()
            const planted = await plantNextCommit(rig.fake, { staging: marker('x', stagingPrefix(newStagingId(env))) }, env)
            const step = stepper(createChecker(rig.raw))
            rig.fake.damage(COMMIT_KEY, GARBAGE)
            expect(step('$env', 'damage-commit', null, { kind: 'env', fault: 'damage-commit' })).toEqual([])
            const replacement = marker('a', stagingPrefix(newStagingId(env)))
            await rig.fake.store.write(COMMIT_KEY, encodeUnit(UNIT_TYPE.commit, { ...planted, seq: planted.seq + 1, staging: replacement }), { ifVersion: rig.fake.peek(COMMIT_KEY).revision })
            expect(step('a', 'casCommit', { kind: 'recovery-begin', owner: 'a' })).toEqual([])
        })

        async function damagedAfterMarker(readBeforeDamage: boolean) {
            const { rig } = await seeded()
            const planted = await plantNextCommit(rig.fake, { staging: marker('x', stagingPrefix(newStagingId(env))) }, env)
            const step = stepper(createChecker(rig.raw))
            if (readBeforeDamage) {
                expect(step('a', 'readCommit', { kind: 'recovery-begin', owner: 'a' })).toEqual([])
            }
            rig.fake.damage(COMMIT_KEY, GARBAGE)
            expect(step('$env', 'damage-commit', null, { kind: 'env', fault: 'damage-commit' })).toEqual([])
            if (!readBeforeDamage) {
                expect(step('a', 'readCommit', { kind: 'recovery-begin', owner: 'a' })).toEqual([])
            }
            const replacement = marker('a', stagingPrefix(newStagingId(env)))
            await rig.fake.store.write(COMMIT_KEY, encodeUnit(UNIT_TYPE.commit, { ...planted, seq: planted.seq + 1, staging: replacement }), { ifVersion: rig.fake.peek(COMMIT_KEY).revision })
            return step('a', 'casCommit', { kind: 'recovery-begin', owner: 'a' })
        }

        test('the damage rule: a parsed read, then damage, then the foreign marker replaced is judged by h2', async () => {
            expect(propertiesOf(await damagedAfterMarker(true))).toEqual(['h2'])
        })

        test('the damage rule: a read of the damaged key, then the foreign marker replaced, is not judged by h2', async () => {
            expect(await damagedAfterMarker(false)).toEqual([])
        })

        test('the damage rule: a damaged read, a heal by another owner\'s marker, then a replacement with no re-read is judged by h2', async () => {
            const { rig } = await seeded()
            const planted = await plantNextCommit(rig.fake, { staging: marker('x', stagingPrefix(newStagingId(env))) }, env)
            const step = stepper(createChecker(rig.raw))
            rig.fake.damage(COMMIT_KEY, GARBAGE)
            expect(step('$env', 'damage-commit', null, { kind: 'env', fault: 'damage-commit' })).toEqual([])
            expect(step('a', 'readCommit', { kind: 'recovery-begin', owner: 'a' })).toEqual([])
            const healed = { ...planted, seq: planted.seq + 1, staging: marker('b', stagingPrefix(newStagingId(env))) }
            await rig.fake.store.write(COMMIT_KEY, encodeUnit(UNIT_TYPE.commit, healed), { ifVersion: rig.fake.peek(COMMIT_KEY).revision })
            expect(step('b', 'casCommit', { kind: 'recovery-begin', owner: 'b' })).toEqual([])
            // An unconditional write, as on a backend with no precondition: only h2 guards b's marker.
            const replaced = { ...healed, seq: healed.seq + 1, staging: marker('a', stagingPrefix(newStagingId(env))) }
            await rig.fake.store.write(COMMIT_KEY, encodeUnit(UNIT_TYPE.commit, replaced), 'unconditional')
            expect(propertiesOf(step('a', 'casCommit', { kind: 'recovery-begin', owner: 'a' }))).toEqual(['h2'])
        })

        test('the same replacement while the stored commit key parses is judged by h2', async () => {
            const { rig, step } = await withMarker('x')
            await plantNextCommit(rig.fake, { staging: marker('a', stagingPrefix(newStagingId(env))) }, env)
            expect(propertiesOf(step('a', 'casCommit', { kind: 'recovery-begin', owner: 'a' }))).toEqual(['h2'])
        })

        test('the owner\'s own change is clean without any consent', async () => {
            const { rig, step } = await withMarker('x')
            await plantNextCommit(rig.fake, { staging: null }, env)
            expect(step('x', 'casCommit', { kind: 'start-clear', owner: 'x' })).toEqual([])
        })
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

    describe('G1: a fence removal acts on the fence its actor last read', () => {
        async function fenceStanding(): Promise<{ rig: NodeRig, step: ReturnType<typeof stepper>, listed: string }> {
            const { rig } = await seeded()
            const step = stepper(createChecker(rig.raw))
            const listed = await orphan(rig)
            await plantFenceKeys(rig.fake, [listed])
            expect(step('a', 'casFence', { kind: 'fence-exit' })).toEqual([])
            return { rig, step, listed }
        }

        test('a discard after another actor rewrote the fence is reported', async () => {
            const { rig, step, listed } = await fenceStanding()
            expect(step('d', 'readFence', { kind: 'fence-discard' })).toEqual([])
            await plantFenceKeys(rig.fake, [listed, await orphan(rig)])
            expect(step('e', 'casFence', { kind: 'fence-exit' })).toEqual([])
            await rig.fake.store.delete(FENCE_KEY, 'unconditional')
            const found = step('d', 'casFence', { kind: 'fence-discard' })
            expect(propertiesOf(found)).toEqual(['G1'])
            expect(found[0].actor).toBe('d')
            expect(found[0].detail).toContain('removed a fence other than the one it read')
        })

        test('a discard of the fence the actor read is clean', async () => {
            const { rig, step } = await fenceStanding()
            expect(step('d', 'readFence', { kind: 'fence-discard' })).toEqual([])
            await rig.fake.store.delete(FENCE_KEY, 'unconditional')
            expect(step('d', 'casFence', { kind: 'fence-discard' })).toEqual([])
        })

        test('a ByteStore read of the fence key is the read the removal is judged against', async () => {
            const { rig, step, listed } = await fenceStanding()
            expect(step('d', 'read', { kind: 'fence-discard' }, { target: FENCE_KEY })).toEqual([])
            await plantFenceKeys(rig.fake, [listed, await orphan(rig)])
            expect(step('e', 'casFence', { kind: 'fence-exit' })).toEqual([])
            await rig.fake.store.delete(FENCE_KEY, 'unconditional')
            expect(propertiesOf(step('d', 'removeTop', { kind: 'fence-discard' }))).toEqual(['G1'])
        })

        test('damage after the read is judged by amendment J: a discard of the damaged fence is clean', async () => {
            const { rig, step } = await fenceStanding()
            expect(step('d', 'readFence', { kind: 'fence-discard' })).toEqual([])
            rig.fake.damage(FENCE_KEY, GARBAGE)
            expect(step('$env', 'damage-fence', null, { kind: 'env', fault: 'damage-fence' })).toEqual([])
            await rig.fake.store.delete(FENCE_KEY, 'unconditional')
            expect(step('d', 'casFence', { kind: 'fence-discard' })).toEqual([])
        })

        test('A-B-A: the fence was rewritten and put back to the bytes the remover read: clean', async () => {
            const { rig, step, listed } = await fenceStanding()
            const read = rig.fake.peek(FENCE_KEY).bytes!
            expect(step('d', 'readFence', { kind: 'fence-discard' })).toEqual([])
            await plantFenceKeys(rig.fake, [listed, await orphan(rig)])
            expect(step('e', 'casFence', { kind: 'fence-exit' })).toEqual([])
            await rig.fake.store.write(FENCE_KEY, read, 'unconditional')
            step('e', 'casFence', { kind: 'fence-exit' })
            await rig.fake.store.delete(FENCE_KEY, 'unconditional')
            expect(step('d', 'casFence', { kind: 'fence-discard' })).toEqual([])
        })

        test('an actor that never read the fence is not reported by this rule', async () => {
            const { rig, step, listed } = await fenceStanding()
            await plantFenceKeys(rig.fake, [listed, await orphan(rig)])
            expect(step('e', 'casFence', { kind: 'fence-exit' })).toEqual([])
            await rig.fake.store.delete(FENCE_KEY, 'unconditional')
            expect(step('d', 'casFence', { kind: 'fence-discard' })).toEqual([])
        })
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

describe('INST: an install reported as done is a commit-key write the actor made under its recovery install, naming the installed manifest', () => {
    async function installWrite(): Promise<{ rig: NodeRig, checker: ReturnType<typeof createChecker>, manifest: string }> {
        const { rig, manifest } = await seeded()
        const checker = createChecker(rig.raw)
        const step = stepper(checker)
        await plantNextCommit(rig.fake, {}, env)
        expect(step('a', 'casCommit', { kind: 'recovery-install', owner: 'a' })).toEqual([])
        return { rig, checker, manifest }
    }

    /** The commit-key bytes the store holds now: what a read-back after the install returns. */
    async function held(rig: NodeRig): Promise<Uint8Array> {
        return (await rig.fake.store.read(COMMIT_KEY)).bytes as Uint8Array
    }

    test('its own applied write naming the key is clean, whatever bytes the key holds by now', async () => {
        const { rig, checker, manifest } = await installWrite()
        const step = stepper(checker)
        // A peer rewrote the key keeping the same current: the bytes no longer equal the actor's write.
        await plantNextCommit(rig.fake, {}, env)
        step('b', 'casCommit', { kind: 'pin', owner: 'b' })
        checker.installed('a', manifest, await held(rig))
        expect(checker.violations).toEqual([])
    })

    test('its own write naming another manifest key does not satisfy the result', async () => {
        const { rig, checker, manifest } = await installWrite()
        checker.installed('a', `${manifest}-other`, await held(rig))
        expect(checker.violations.map((violation) => violation.property)).toEqual(['INST'])
    })

    test('a peer write naming the key does not satisfy the result', async () => {
        const { rig, checker, manifest } = await installWrite()
        checker.installed('b', manifest, await held(rig))
        expect(checker.violations.map((violation) => violation.property)).toEqual(['INST'])
    })

    test('a write under another context naming the key does not satisfy the result', async () => {
        const { rig, manifest } = await seeded()
        const checker = createChecker(rig.raw)
        const step = stepper(checker)
        await plantNextCommit(rig.fake, {}, env)
        step('a', 'casCommit', { kind: 'commit', owner: 'a' })
        checker.installed('a', manifest, await held(rig))
        expect(checker.violations.map((violation) => violation.property)).toEqual(['INST'])
    })

    test('no write at all is reported', async () => {
        const { rig, manifest } = await seeded()
        const checker = createChecker(rig.raw)
        checker.installed('a', manifest, await held(rig))
        expect(checker.violations.map((violation) => violation.property)).toEqual(['INST'])
    })

    test('a recovery-install write that was not applied is not an install write', async () => {
        const { rig, manifest } = await seeded()
        const checker = createChecker(rig.raw)
        const step = stepper(checker)
        await plantNextCommit(rig.fake, {}, env)
        step('a', 'casCommit', { kind: 'recovery-install', owner: 'a' }, { applied: false, fault: 'lost-request' })
        checker.installed('a', manifest, await held(rig))
        expect(checker.violations.map((violation) => violation.property)).toEqual(['INST'])
    })

    test('its own applied write naming the key does not satisfy a result whose bytes name another current: the write was superseded', async () => {
        const { rig, checker, manifest } = await installWrite()
        const step = stepper(checker)
        // A peer commit replaced the current after the actor's install write; the result reports what the read-back returned.
        const second = await commitSecond(rig)
        expect(second).not.toBe(manifest)
        expect(step('b', 'casCommit')).toEqual([])
        checker.installed('a', manifest, await held(rig))
        const found = checker.violations
        expect(found.map((violation) => violation.property)).toEqual(['INST'])
        expect(found[0].detail).toContain('bytes of that result')
    })
})

describe('an environment remove-unit step excuses its own keys from the I1 walk and nothing else', () => {
    const lost = { kind: 'env', fault: 'remove-unit' } as const

    test('a manifest the commit key names, taken out by the environment, is clean and stays clean', async () => {
        const { rig, manifest } = await seeded()
        const step = stepper(createChecker(rig.raw))
        rig.fake.remove(manifest)
        expect(step('$env', 'remove-unit', null, lost)).toEqual([])
        expect(step('a', 'readCommit')).toEqual([])
    })

    test('the same removal by an actor is I1, whatever operation the actor declared', async () => {
        for (const context of [null, { kind: 'gc' }, { kind: 'commit' }, { kind: 'restore' }] as const) {
            const { rig, manifest } = await seeded()
            const step = stepper(createChecker(rig.raw))
            rig.fake.remove(manifest)
            const found = step('a', 'delete', context)
            expect(propertiesOf(found), JSON.stringify(context)).toContain('I1')
            expect(found.some((violation) => violation.property === 'I1' && violation.detail.includes(manifest))).toBe(true)
        }
    })

    test('a step of another environment kind that removed the unit is not excused', async () => {
        const { rig, manifest } = await seeded()
        const step = stepper(createChecker(rig.raw))
        rig.fake.remove(manifest)
        expect(propertiesOf(step('$env', 'damage-commit', null, { kind: 'env', fault: 'damage-commit' }))).toEqual(['I1'])
    })

    test('only the keys the step removed are excused: a unit an actor removes afterwards is still I1', async () => {
        const { rig, manifest, units } = await seeded()
        const step = stepper(createChecker(rig.raw))
        const [lostUnit, victim] = units.filter((key) => key !== manifest)
        rig.fake.remove(lostUnit)
        expect(step('$env', 'remove-unit', null, lost)).toEqual([])
        await rig.fake.store.delete(victim, 'unconditional')
        const found = step('a', 'delete', { kind: 'commit' })
        expect(propertiesOf(found)).toEqual(['I1'])
        expect(found).toHaveLength(1)
        expect(found[0].detail).toContain(victim)
        expect(found[0].detail).not.toContain(lostUnit)
    })

    test('a unit only the lost manifest names stays protected while the commit key names it: a deletion there is I1, the removal alone is clean', async () => {
        for (const deleted of [true, false]) {
            const { rig, manifest: first, units: firstUnits } = await seeded()
            await commitSecond(rig)
            const victim = firstUnits.find((key) => key !== first)!
            const step = stepper(createChecker(rig.raw))
            step('g', 'readCommit', { kind: 'gc' })
            rig.fake.remove(first)
            expect(step('$env', 'remove-unit', null, lost), `deleted ${deleted}`).toEqual([])
            if (deleted) {
                await rig.fake.store.delete(victim, 'unconditional')
            }
            const found = step('g', 'delete', { kind: 'gc' })
            expect(propertiesOf(found), `deleted ${deleted}`).toEqual(deleted ? ['I1'] : [])
            if (deleted) {
                expect(found.some((violation) => violation.detail.includes(victim) && violation.detail.includes(first))).toBe(true)
            }
        }
    })

    test('the protection ends once the commit key no longer names the lost manifest', async () => {
        const { rig, manifest: first, units: firstUnits } = await seeded()
        const second = await commitSecond(rig)
        const victim = firstUnits.find((key) => key !== first)!
        const step = stepper(createChecker(rig.raw))
        rig.fake.remove(first)
        expect(step('$env', 'remove-unit', null, lost)).toEqual([])
        await plantNextCommit(rig.fake, { current: { key: second, at: 5 }, retained: [] }, env)
        expect(step('a', 'writeChecked', { kind: 'commit', owner: 'a' })).toEqual([])
        await rig.fake.store.delete(victim, 'unconditional')
        expect(step('g', 'delete', { kind: 'gc' })).toEqual([])
    })

    test('a restore that installs a manifest naming the lost unit is still reported (b)', async () => {
        const { rig, manifest: first, units: firstUnits } = await seeded()
        const second = await commitSecond(rig)
        const step = stepper(createChecker(rig.raw))
        rig.fake.remove(firstUnits.find((key) => key !== first)!)
        expect(step('$env', 'remove-unit', null, lost)).toEqual([])
        await plantNextCommit(rig.fake, { current: { key: first, at: 5 }, retained: [{ key: second, at: 4 }] }, env)
        expect(propertiesOf(step('a', 'restore', { kind: 'restore', owner: 'a' }))).toEqual(['b'])
    })
})

describe('the commit key a backend conflict carried is the actor\'s commit read', () => {
    const marker = (owner: string, prefix: string) => ({ owner, prefix, startedAt: 1, label: 'seed' as const })

    /**
     * a read the damaged key; b healed it with its own marker; a's compare then conflicted and the conflict carried that marker
     * (or the conflict was hidden by a lost reply); the key was damaged again and a replaced it with its own marker.
     */
    async function replacementAfterConflict(carried: boolean): Promise<ReturnType<typeof stepper>> {
        const { rig } = await seeded()
        const planted = await plantNextCommit(rig.fake, { staging: marker('x', stagingPrefix(newStagingId(env))) }, env)
        const step = stepper(createChecker(rig.raw))
        rig.fake.damage(COMMIT_KEY, GARBAGE)
        expect(step('$env', 'damage-commit', null, { kind: 'env', fault: 'damage-commit' })).toEqual([])
        expect(step('a', 'readCommit', { kind: 'recovery-begin', owner: 'a' })).toEqual([])
        const healed = { ...planted, seq: planted.seq + 1, staging: marker('b', stagingPrefix(newStagingId(env))) }
        await rig.fake.store.write(COMMIT_KEY, encodeUnit(UNIT_TYPE.commit, healed), { ifVersion: rig.fake.peek(COMMIT_KEY).revision })
        expect(step('b', 'casCommit', { kind: 'recovery-begin', owner: 'b' })).toEqual([])
        // a's compare fails on the healed key and changes nothing.
        expect(step('a', 'casCommit', { kind: 'recovery-begin', owner: 'a' }, carried ? { commitConflictRead: rig.fake.peek(COMMIT_KEY).bytes } : {})).toEqual([])
        rig.fake.damage(COMMIT_KEY, GARBAGE)
        expect(step('$env', 'damage-commit', null, { kind: 'env', fault: 'damage-commit' })).toEqual([])
        const replaced = { ...healed, seq: healed.seq + 1, staging: marker('a', stagingPrefix(newStagingId(env))) }
        await rig.fake.store.write(COMMIT_KEY, encodeUnit(UNIT_TYPE.commit, replaced), { ifVersion: rig.fake.peek(COMMIT_KEY).revision })
        return step
    }

    test('damage after a conflict read that parsed does not exempt the replacement from h2', async () => {
        const step = await replacementAfterConflict(true)
        expect(propertiesOf(step('a', 'casCommit', { kind: 'recovery-begin', owner: 'a' }))).toEqual(['h2'])
    })

    test('a conflict a lost reply hid carries nothing: a\'s last read is still the damaged one, and the replacement is not judged', async () => {
        const step = await replacementAfterConflict(false)
        expect(step('a', 'casCommit', { kind: 'recovery-begin', owner: 'a' })).toEqual([])
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

describe('an environment restart excuses no dropped unit', () => {
    const restart = { kind: 'env', fault: 'restart' } as const

    test('a unit the commit key names, dropped by a restart, is I1, and a dropped unit nothing names is clean', async () => {
        const { rig, manifest, units } = await seeded()
        const stray = await orphan(rig)
        const step = stepper(createChecker(rig.raw))
        rig.fake.remove(stray)
        expect(step('$env', 'restart', null, restart), 'a dropped orphan').toEqual([])
        expect(step('a', 'readCommit')).toEqual([])
        const named = units.find((key) => key !== manifest)!
        rig.fake.remove(named)
        const found = step('$env', 'restart', null, restart)
        expect(propertiesOf(found), 'a dropped unit the commit key names').toEqual(['I1'])
        expect(found[0].detail).toContain(named)
    })

    test('the same removal by an actor, even one labelled as a restart step of a call, is I1', async () => {
        for (const extra of [{}, { fault: 'restart' as const }]) {
            const { rig, manifest, units } = await seeded()
            const step = stepper(createChecker(rig.raw))
            const victim = units.find((key) => key !== manifest)!
            rig.fake.remove(victim)
            const found = step('a', 'delete', { kind: 'gc' }, extra)
            expect(propertiesOf(found), JSON.stringify(extra)).toEqual(['I1'])
            expect(found[0].detail).toContain(victim)
        }
    })

    test('a restart that dropped an orphan does not hide a unit an actor removes afterwards: it is still I1', async () => {
        const { rig, manifest, units } = await seeded()
        const dropped = await orphan(rig)
        const step = stepper(createChecker(rig.raw))
        const victim = units.find((key) => key !== manifest)!
        rig.fake.remove(dropped)
        expect(step('$env', 'restart', null, restart)).toEqual([])
        await rig.fake.store.delete(victim, 'unconditional')
        const found = step('a', 'delete', { kind: 'commit' })
        expect(propertiesOf(found)).toEqual(['I1'])
        expect(found[0].detail).toContain(victim)
        expect(found[0].detail).not.toContain(dropped)
    })

    test('a commit key a restart puts back is judged as stored: a unit that older key names and a deleter removed meanwhile is I1 at the restart', async () => {
        for (const removedMeanwhile of [true, false]) {
            const { rig, manifest: first, units: firstUnits } = await seeded()
            const older = rig.fake.peek(COMMIT_KEY).bytes!
            const second = await commitSecond(rig)
            const victim = firstUnits.find((key) => key !== first)!
            const step = stepper(createChecker(rig.raw))
            // The newer commit key drops the first tree from the live set; the pass that follows may remove it.
            await plantNextCommit(rig.fake, { current: { key: second, at: 5 }, retained: [] }, env)
            expect(step('a', 'writeChecked', { kind: 'commit', owner: 'a' })).toEqual([])
            step('g', 'readCommit', { kind: 'gc' })
            if (removedMeanwhile) {
                await rig.fake.store.delete(victim, 'unconditional')
                expect(step('g', 'delete', { kind: 'gc' }), 'the removal is legal under the newer key').toEqual([])
            }
            rig.fake.damage(COMMIT_KEY, older)
            const found = step('$env', 'restart', null, restart)
            expect(propertiesOf(found), `removed meanwhile ${removedMeanwhile}`).toEqual(removedMeanwhile ? ['I1'] : [])
            if (removedMeanwhile) {
                expect(found[0].detail).toContain(victim)
            }
        }
    })

    test('a restart may put the commit key back to absent; an actor\'s removal and another environment step\'s are I4', async () => {
        for (const [name, extra, expected] of [
            ['restart', restart, []],
            ['damage-commit', { kind: 'env', fault: 'damage-commit' } as const, ['I4']],
            ['actor', {}, ['I4']],
        ] as const) {
            const { rig } = await seeded()
            const step = stepper(createChecker(rig.raw))
            rig.fake.remove(COMMIT_KEY)
            expect(propertiesOf(step(name === 'actor' ? 'a' : '$env', name, null, extra)), name).toEqual(expected)
        }
    })
})