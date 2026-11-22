// @vitest-environment node
import { describe, expect, test } from 'vitest'
import {
    planScopedEncode, previousFrom,
    type EncodedTree, type EncodeScope, type PreviousEncoding,
} from '../../store2/codec'
import { createKeyMint, type BuildContext } from '../../store2/commit'
import type { WorkspaceRecord } from '../../store2/format'
import type { Database } from '../../database.svelte'
import { asDatabase, bodyIn, buildSmall, fakeLists, seededEnv, unitOf, type Obj } from './codecFixtures'
import { createClock, testEnv } from './commitFixtures'

/**
 * A workspace record's top-level fields this build does not know survive every ordinary save (#202 F2): each save adopts
 * the tree `finalize` returns (the rekey), so the rekeyed tree must hold the extras the next pass reads. Every pass is
 * the real planner and `finalize`, adopting the previous between passes as the save encoder does.
 */

const NOW = 1_700_000_000_000
const SCOPE: EncodeScope = { modules: true, characters: 'all', skipUnsavableItems: true }

function db(): Database {
    const files = [{ id: 'f1', path: 'AGENTS.md', text: 'rules', size: 5, mtime: 5 }]
    return asDatabase({ ...JSON.parse(JSON.stringify(buildSmall(1))) as Obj, utilityWorkspaces: [{ id: 'w1', name: 'W', createdAt: 1, files }] })
}

describe('T3c save: record extras across consecutive real saves', () => {
    test('N: the second record written after the extras were first carried still holds them', async () => {
        let env = 100
        let mint = 9100
        let seq = 1
        const pass = async (previous: PreviousEncoding | null, edit: boolean): Promise<EncodedTree> => {
            seq++
            const live = db()
            if (edit) {
                ;(live.utilityWorkspaces as unknown as { name: string }[])[0].name = `W${seq}`
            }
            const plan = await planScopedEncode(live, { env: seededEnv(env++), lists: fakeLists, seq, createdAt: NOW, previous }, SCOPE)
            const context: BuildContext = { mint: createKeyMint(testEnv(createClock(), mint++), null).mint, seq, now: NOW }
            return plan.finalize(context)
        }
        const first = await pass(null, false)
        const seeded: PreviousEncoding = {
            ...previousFrom(first),
            objects: { ...previousFrom(first).objects, workspaces: new Map([['w1', { note: 'from a newer build' }]]) },
        }
        const second = await pass(seeded, true)
        const third = await pass(previousFrom(second), true)

        const record = (tree: EncodedTree): WorkspaceRecord => bodyIn(unitOf(tree, 'ws:w1'), first, second) as unknown as WorkspaceRecord
        expect((record(second) as unknown as Obj).note).toBe('from a newer build')
        expect((record(third) as unknown as Obj).note).toBe('from a newer build')
    })

    test('N: a save that holds the workspace whole (it cannot be read) keeps the extras for the save after it is fixed', async () => {
        let env = 200
        let mint = 9200
        let seq = 1
        const pass = async (previous: PreviousEncoding | null, unreadable: boolean): Promise<EncodedTree> => {
            seq++
            const live = db()
            const ws = (live.utilityWorkspaces as unknown as { name: string, files: Obj[] }[])[0]
            ws.name = `W${seq}`
            if (unreadable) {
                const cycle: Obj = {}
                cycle.self = cycle
                ws.files[0] = { ...ws.files[0], cycle }
            }
            const plan = await planScopedEncode(live, { env: seededEnv(env++), lists: fakeLists, seq, createdAt: NOW, previous }, SCOPE)
            const context: BuildContext = { mint: createKeyMint(testEnv(createClock(), mint++), null).mint, seq, now: NOW }
            return plan.finalize(context)
        }
        const first = await pass(null, false)
        const seeded: PreviousEncoding = {
            ...previousFrom(first),
            objects: { ...previousFrom(first).objects, workspaces: new Map([['w1', { note: 'from a newer build' }]]) },
        }
        const second = await pass(seeded, false)
        const held = await pass(previousFrom(second), true)
        const fixed = await pass(previousFrom(held), false)

        expect(held.manifest.fixed.workspaces?.[0]).toEqual(second.manifest.fixed.workspaces?.[0])
        const record = bodyIn(unitOf(fixed, 'ws:w1'), first, second, held, fixed) as unknown as Obj
        expect(record.note).toBe('from a newer build')
        expect((record.ws as Obj).name).toBe(`W${seq}`)
    })
})
