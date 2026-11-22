// @vitest-environment node
import { describe, expect, test } from 'vitest'
import {
    assembleDatabase, CodecInputError, createStreamedEncode, planScopedEncode, previousFrom, unitsToWrite,
    type EncodedTree, type EncodeScope, type PreviousEncoding, type ReusableUnit, type ScopedPlan,
} from '../../store2/codec'
import { createKeyMint, type BuildContext } from '../../store2/commit'
import { UNIT_TYPE, type WorkspaceRecord } from '../../store2/format'
import { previousOfTree } from '../../store2/previousOfTree'
import type { Database } from '../../database.svelte'
import { asDatabase, bodyIn, buildSmall, fakeLists, seededEnv, unitOf, type Obj } from './codecFixtures'
import { createClock, testEnv } from './commitFixtures'

/**
 * A workspace file with no text (damaged at boot, or not loaded) is never written empty (#202 S1b): the previous
 * encoding's type 29 unit under its key is carried and its Ref stays in the record; with no such unit the file is left
 * out and reported, or the pass fails when it does not skip items. Every previous encoding is made by the real planner and
 * `finalize`, and the boot's `previous` by `previousOfTree` over the stored units with the damaged file's bytes hidden.
 * Labels: N new-rule test (proven by its scratch mutants), G guard (passes before and after).
 */

const NOW = 1_700_000_000_000
const SKIP: EncodeScope = { modules: true, characters: 'all', skipUnsavableItems: true }
const NO_SKIP: EncodeScope = { modules: true, characters: 'all' }

function file(id: string, path: string, text: string | undefined): Obj {
    return { id, path, ...(text === undefined ? {} : { text }), size: text === undefined ? 4 : new TextEncoder().encode(text).length, mtime: 5 }
}

function dbWith(files: Obj[]): Database {
    return asDatabase({ ...JSON.parse(JSON.stringify(buildSmall(1))) as Obj, utilityWorkspaces: [{ id: 'w1', name: 'W', createdAt: 1, files }] })
}

function rig() {
    const store = new Map<string, Uint8Array>()
    let env = 100
    let mint = 9100
    let seq = 1
    return {
        store,
        async pass(db: Database, previous: PreviousEncoding | null, scope: EncodeScope): Promise<{ plan: ScopedPlan, tree: EncodedTree }> {
            seq++
            const plan = await planScopedEncode(db, { env: seededEnv(env++), lists: fakeLists, seq, createdAt: NOW, previous }, scope)
            const context: BuildContext = { mint: createKeyMint(testEnv(createClock(), mint++), null).mint, seq, now: NOW }
            return { plan, tree: plan.finalize(context) }
        },
        persist(tree: EncodedTree): void {
            for (const unit of unitsToWrite(tree)) {
                store.set(unit.key, unit.bytes)
            }
        },
        /** The previous a boot makes of `tree`; a key in `hide` is a file the boot could not read. */
        boot(tree: EncodedTree, hide: readonly string[] = []): PreviousEncoding {
            return previousOfTree({
                manifestKey: tree.manifestKey, manifest: tree.manifest,
                source: { get: key => (hide.includes(key) ? undefined : store.get(key)) },
            })
        },
        assemble(tree: EncodedTree): Database {
            return assembleDatabase(tree.manifest, { get: key => store.get(key) })
        },
    }
}

async function acknowledged(r: ReturnType<typeof rig>, db: Database): Promise<EncodedTree> {
    const { tree } = await r.pass(db, null, SKIP)
    r.persist(tree)
    return tree
}

function recordOf(tree: EncodedTree, ...earlier: EncodedTree[]): WorkspaceRecord {
    return bodyIn(unitOf(tree, 'ws:w1'), ...earlier) as unknown as WorkspaceRecord
}

const TWO = (): Obj[] => [file('f1', 'AGENTS.md', 'rules'), file('f2', 'notes/a.md', 'note')]

describe('T3b workspace files without text', () => {
    test('N: a file with no text carries the previous type 29 unit and keeps its Ref; the healthy file is rewritten when edited', async () => {
        const r = rig()
        const first = await acknowledged(r, dbWith(TWO()))
        const keyOfF2 = unitOf(first, 'wsf:w1:f2').key
        const boot = r.boot(first, [keyOfF2])

        const second = await r.pass(dbWith([file('f1', 'AGENTS.md', 'edited'), file('f2', 'notes/a.md', undefined)]), boot, SKIP)
        expect(second.plan.skippedItems).toEqual([])
        expect(second.tree.units.some(unit => unit.identity === 'wsf:w1:f2')).toBe(false)
        expect(second.tree.index.units.get('wsf:w1:f2')?.key).toBe(keyOfF2)
        expect(recordOf(second.tree).files.map(entry => entry.id)).toEqual(['f1', 'f2'])
        expect(recordOf(second.tree).files[1].ref).toEqual(recordOf(first).files[1].ref)
        expect(unitOf(second.tree, 'wsf:w1:f1').reused).toBe(false)

        r.persist(second.tree)
        const files = (r.assemble(second.tree).utilityWorkspaces as unknown as { files: Obj[] }[])[0].files
        expect(files.map(entry => entry.text)).toEqual(['edited', 'note'])
    })

    test('N: the carry holds without skipping items, and the next pass from the carried encoding still carries', async () => {
        const r = rig()
        const first = await acknowledged(r, dbWith(TWO()))
        const live = dbWith([file('f1', 'AGENTS.md', 'rules'), file('f2', 'notes/a.md', undefined)])
        const second = await r.pass(live, r.boot(first, [unitOf(first, 'wsf:w1:f2').key]), NO_SKIP)
        expect(second.tree.index.units.get('wsf:w1:f2')?.key).toBe(unitOf(first, 'wsf:w1:f2').key)
        r.persist(second.tree)
        const third = await r.pass(live, previousFrom(second.tree), NO_SKIP)
        expect(third.tree.index.units.get('wsf:w1:f2')?.key).toBe(unitOf(first, 'wsf:w1:f2').key)
        expect(recordOf(third.tree, second.tree, first).files[1].ref).toEqual(recordOf(first).files[1].ref)
    })

    test('N: with no previous unit the file is left out and reported when items are skipped, and fails the pass otherwise', async () => {
        const r = rig()
        const live = dbWith([file('f1', 'AGENTS.md', 'rules'), file('f2', 'notes/a.md', undefined)])
        const skipped = await r.pass(live, null, SKIP)
        expect(skipped.plan.skippedItems.map(({ scope, key, saved }) => ({ scope, key, saved }))).toEqual([{ scope: 'workspaces', key: 'wsf:w1:f2', saved: false }])
        expect(skipped.plan.skippedItems[0].label).toBe('"notes/a.md"')
        expect(recordOf(skipped.tree).files.map(entry => entry.id)).toEqual(['f1'])
        await expect(r.pass(live, null, NO_SKIP)).rejects.toBeInstanceOf(CodecInputError)
    })

    test('N: a previous unit of another type under the key is not carried: the file is left out and reported', async () => {
        const r = rig()
        const first = await acknowledged(r, dbWith(TWO()))
        const boot = r.boot(first)
        const held = boot.units.get('wsf:w1:f2') as ReusableUnit
        const units = new Map(boot.units)
        units.set('wsf:w1:f2', { ...held, type: UNIT_TYPE.pluginStorageValue })
        const second = await r.pass(dbWith([file('f1', 'AGENTS.md', 'rules'), file('f2', 'notes/a.md', undefined)]), { ...boot, units }, SKIP)
        expect(second.plan.skippedItems.map(({ scope, key, saved }) => ({ scope, key, saved }))).toEqual([{ scope: 'workspaces', key: 'wsf:w1:f2', saved: false }])
        expect(recordOf(second.tree).files.map(entry => entry.id)).toEqual(['f1'])
        expect(second.tree.index.units.has('wsf:w1:f2')).toBe(false)
    })

    test('G: a file with text is written as before and nothing is reported', async () => {
        const r = rig()
        const first = await acknowledged(r, dbWith(TWO()))
        const second = await r.pass(dbWith(TWO()), previousFrom(first), SKIP)
        expect(second.plan.skippedItems).toEqual([])
        expect(unitOf(second.tree, 'wsf:w1:f1').reused).toBe(true)
        expect(unitOf(second.tree, 'wsf:w1:f2').reused).toBe(true)
    })
})

describe('T3b a file without text that names its stored unit by its own ref (the import)', () => {
    async function placeholderOf(ref: unknown): Promise<{ plan: ScopedPlan, record: WorkspaceRecord | undefined }> {
        const r = rig()
        const first = await acknowledged(r, dbWith(TWO()))
        const stored = (ref === 'stored' ? recordOf(first).files[1].ref : ref) as unknown
        const live = dbWith([file('f1', 'AGENTS.md', 'rules'), { ...file('f2', 'notes/a.md', undefined), ref: stored }])
        const plan = await planScopedEncode(live, { env: seededEnv(300), lists: fakeLists, seq: 2, createdAt: NOW }, NO_SKIP)
        const context: BuildContext = { mint: createKeyMint(testEnv(createClock(), 9500), null).mint, seq: 2, now: NOW }
        const tree = plan.finalize(context)
        return { plan, record: tree.index.units.has('wsf:w1:f2') ? recordOf(tree, first) : undefined }
    }

    test('N: the whole plan carries the stored unit, keeps its Ref in the record and counts it as carried', async () => {
        const { plan, record } = await placeholderOf('stored')
        expect(record?.files.map(entry => entry.id)).toEqual(['f1', 'f2'])
        expect(plan.carried.units).toBeGreaterThanOrEqual(1)
    })

    test('N: the streamed encode counts the carried unit in `reused`, so the import commit names the base it carried from', async () => {
        const r = rig()
        const first = await acknowledged(r, dbWith(TWO()))
        const ref = recordOf(first).files[1].ref
        const live = dbWith([file('f1', 'AGENTS.md', 'rules'), { ...file('f2', 'notes/a.md', undefined), ref }])
        const encode = createStreamedEncode(seededEnv(301), fakeLists)
        const root = { ...live, characters: [] } as unknown as Database
        const finished = await encode.finish(root)
        expect(finished.reused).toBe(1)
    })

    test('G: a ref that is not a well-formed unit Ref carries nothing: the pass fails as for a file with no stored unit', async () => {
        await expect(placeholderOf(['not a key', 1, 2])).rejects.toBeInstanceOf(CodecInputError)
        await expect(placeholderOf('nonsense')).rejects.toBeInstanceOf(CodecInputError)
    })
})