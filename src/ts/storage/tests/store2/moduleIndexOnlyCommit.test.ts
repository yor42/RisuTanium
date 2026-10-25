// @vitest-environment node
import { describe, expect, test } from 'vitest'
import {
    planScopedEncode, previousFrom, unitsToWrite, moduleHandles,
    type EncodedTree, type EncodeOptions, type EncodeScope, type PreviousEncoding,
} from 'src/ts/storage/store2/codec'
import { hasCurrentEntryFields } from 'src/ts/storage/store2/codec/modules'
import { createMemoryBackend } from 'src/ts/storage/store2/backend'
import { createKeyMint, type BuildContext } from 'src/ts/storage/store2/commit'
import { keyOfRef, readUnit, UNIT_TYPE, type Manifest, type ModuleIndex } from 'src/ts/storage/store2/format'
import { createListDerivation } from 'src/ts/storage/store2/lists/derive'
import { previousOfTree } from 'src/ts/storage/store2/previousOfTree'
import { installPick, pickCandidate } from 'src/ts/storage/store2/recoveryPick'
import type { Database } from 'src/ts/storage/database.svelte'
import { asDatabase, buildSmall, seededEnv, type Obj } from 'src/ts/storage/tests/store2/codecFixtures'
import { createClock, testEnv } from 'src/ts/storage/tests/store2/commitFixtures'

/**
 * After one module edit, the module-flagged passes settle: the edit pass writes exactly the new module unit, the index
 * and the manifest, and the next pass over an unedited profile writes nothing but the manifest it skips. The settle
 * holds for a previous taken from the acknowledged tree and for one rebuilt from stored bytes, and a recovery install
 * (which rewrites every key without changing content) keeps every entry's tag valid.
 *
 * Labels: rows 1 and 2 are guards (pass before and after the tag); row 3 is a reproducer (the base writer has no tag).
 */

const NOW = 1_700_000_000_000
const MODS: EncodeScope = { modules: true, characters: new Set() }
const ALL: EncodeScope = { modules: true, characters: 'all' }

const mod = (id: string, extra: Obj = {}): Obj => ({ name: `Module ${id}`, description: `about ${id}`, id, lorebook: [], regex: [], trigger: [], ...extra })

function profile(edit: boolean): Database {
    const base = JSON.parse(JSON.stringify(buildSmall(1))) as Obj
    base.modules = [
        mod('uniq', { name: edit ? 'edited' : 'Module uniq', mcp: { url: 'https://mcp.invalid/a' } }),
        mod('dup', { name: 'first', mcp: { url: 'https://mcp.invalid/b' } }),
        mod('dup', { name: 'second' }),
        mod('plain'),
    ]
    return asDatabase(base)
}

function makeRig(envSeed: number, mintSeed: number) {
    const store = new Map<string, Uint8Array>()
    const lists = createListDerivation()
    let env = envSeed
    let mint = mintSeed
    return {
        store,
        async pass(db: Database, previous: PreviousEncoding | null, scope: EncodeScope, seq: number) {
            const options: EncodeOptions = { env: seededEnv(env++), lists, seq, createdAt: NOW, previous }
            const plan = await planScopedEncode(db, options, scope)
            const context: BuildContext = { mint: createKeyMint(testEnv(createClock(), mint++), null).mint, seq, now: NOW }
            return { plan, tree: plan.finalize(context) }
        },
        persist(tree: EncodedTree) {
            for (const unit of unitsToWrite(tree)) {
                store.set(unit.key, unit.bytes)
            }
        },
        boot(tree: EncodedTree): PreviousEncoding {
            return previousOfTree({ manifestKey: tree.manifestKey, manifest: tree.manifest, source: { get: key => store.get(key) } })
        },
    }
}

const ways = [
    ['previousFrom', (rig: ReturnType<typeof makeRig>, tree: EncodedTree) => previousFrom(tree)],
    ['previousOfTree', (rig: ReturnType<typeof makeRig>, tree: EncodedTree) => rig.boot(tree)],
] as const

describe.each(ways)('the module-flagged passes after one edit, previous from %s', (_name, previousOf) => {
    test('rows 1 and 2, guards: the edit pass writes the module unit, the index and the manifest; the next pass is unchanged', async () => {
        const rig = makeRig(600, 8200)
        const imported = await rig.pass(profile(false), null, ALL, 1)
        rig.persist(imported.tree)

        const edit = await rig.pass(profile(true), previousOf(rig, imported.tree), MODS, 2)
        expect(edit.plan.unchanged).toBe(false)
        expect(unitsToWrite(edit.tree).map(unit => unit.identity).sort()).toEqual(['manifest', 'module:uniq#0', 'moduleIndex'])
        rig.persist(edit.tree)

        const settled = await rig.pass(profile(true), previousOf(rig, edit.tree), MODS, 3)
        expect(settled.plan.unchanged).toBe(true)
        expect(unitsToWrite(settled.tree).map(unit => unit.identity)).toEqual(['manifest'])
    })
})

describe('row 3: a recovery install', () => {
    test('reproducer: every entry of the installed index keeps a valid tag', async () => {
        const rig = makeRig(700, 9200)
        const imported = await rig.pass(profile(false), null, ALL, 1)
        rig.persist(imported.tree)
        const edit = await rig.pass(profile(true), previousFrom(imported.tree), MODS, 2)
        rig.persist(edit.tree)

        const backend = createMemoryBackend()
        for (const [key, bytes] of rig.store) {
            await backend.putUnit(key, bytes)
        }
        await backend.casCommit((await backend.readCommit()).token, Uint8Array.from([0, 1, 2, 250, 251, 252, 253, 254, 255, 62, 63]))
        const clock = createClock()
        const picked = await pickCandidate(backend, await backend.readCommit(), edit.tree.manifestKey, {
            owner: 'a'.repeat(26),
            env: testEnv(clock, 77),
            assetsPresent: async keys => new Set(keys),
            inlaysPresent: async keys => new Set(keys),
            inlayPrefixesPresent: async prefixes => new Set(prefixes),
        })
        expect(picked.status).toBe('ready')
        if (picked.status !== 'ready') {
            return
        }
        const installed = await installPick(picked, { confirm: true })
        expect(installed.status).toBe('installed')
        if (installed.status !== 'installed') {
            return
        }

        const read = async (key: string, type: typeof UNIT_TYPE.manifest | typeof UNIT_TYPE.moduleIndex) => {
            const bytes = (await backend.readUnits([key])).get(key)
            if (bytes === null || bytes === undefined) {
                throw new Error(`${key} is not stored.`)
            }
            const parsed = readUnit(bytes, type)
            if (parsed.status !== 'ok') {
                throw new Error(`${key} does not parse.`)
            }
            return parsed.value.body
        }
        const manifest = await read(installed.manifestKey, UNIT_TYPE.manifest) as Manifest
        const index = await read(keyOfRef(manifest.fixed.moduleIndex), UNIT_TYPE.moduleIndex) as ModuleIndex
        expect(moduleHandles(index.entries)).toEqual(['uniq#0', 'dup#0', 'dup#1', 'plain#0'])
        const originalTails = new Set((edit.tree.index.objects?.moduleIndex?.entries ?? []).map(entry => entry.unit[0]))
        expect(originalTails.size).toBe(4)
        for (const entry of index.entries) {
            expect(hasCurrentEntryFields(entry), `tag of ${entry.id}`).toBe(true)
            expect(originalTails.has(entry.unit[0]), 'the unit Ref was rewritten to an installed key').toBe(false)
        }
    })
})
