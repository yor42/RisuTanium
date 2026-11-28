// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
    assembleDatabase, planScopedEncode, previousFrom, unitsToWrite,
    type EncodedTree, type EncodeOptions, type EncodeScope, type PreviousEncoding,
} from 'src/ts/storage/store2/codec'
import { moduleHandles } from 'src/ts/storage/store2/codec/modules'
import { createKeyMint, type BuildContext } from 'src/ts/storage/store2/commit'
import type { ModuleEntry, ModuleIndex } from 'src/ts/storage/store2/format'
import { createListDerivation } from 'src/ts/storage/store2/lists/derive'
import { moduleStubOf } from 'src/ts/storage/store2/moduleStubMatch'
import { previousOfTree } from 'src/ts/storage/store2/previousOfTree'
import { residentModuleHandlesOf } from 'src/ts/storage/store2/residencyPolicy'
import type { Database } from 'src/ts/storage/database.svelte'
import type { RisuModule } from 'src/ts/process/modules'
import { asDatabase, buildSmall, seededEnv, type Obj } from 'src/ts/storage/tests/store2/codecFixtures'
import { createClock, testEnv } from 'src/ts/storage/tests/store2/commitFixtures'

/**
 * A module that takes its own id (`giveModuleCopyOwnId`) under store2. The rows are plain JSON module objects, the shape in
 * which a `.bin` import delivers them; no in-app producer of shared ids exists. The real re-id helper runs over a plain
 * database object, and every encoding pass is a production-path pass: `planScopedEncode` under `createListDerivation()` with
 * a previous from `previousFrom` (the save path) or from `previousOfTree` over stored bytes (the boot path).
 *
 * The re-id moves handles: the copy leaves `X#1` for `Y#0`, and the rows behind it shift from `X#m` to `X#(m-1)`. Labels:
 * these tests are guards of an unchanged store2 format, so each passes before and after the change that adds the re-id.
 */

const h = vi.hoisted(() => ({ db: { current: null as unknown } }))

vi.mock('src/ts/alert', () => ({ alertError: vi.fn(), alertConfirm: vi.fn() }))
vi.mock('src/ts/stores.svelte', () => ({ DBState: { get db() { return h.db.current } } }))
vi.mock('src/ts/storage/store2/moduleAcquire', () => ({ acquireModule: vi.fn() }))
vi.mock('src/ts/process/modules', () => ({ exportModule: vi.fn(), exportModuleLegacy: vi.fn(), refreshModules: vi.fn() }))
vi.mock('src/ts/globalApi.svelte', () => ({ checkCharOrder: vi.fn() }))
vi.mock('src/ts/interchangeability', () => ({ convertModuleToCharacter: vi.fn() }))

import { giveModuleCopyOwnId } from 'src/ts/process/moduleListOps'

const NOW = 1_700_000_000_000
const MODS: EncodeScope = { modules: true, characters: new Set() }
const ALL: EncodeScope = { modules: true, characters: 'all' }

interface Rig {
    store: Map<string, Uint8Array>
    pass(db: Database, previous: PreviousEncoding | null, scope: EncodeScope, seq: number): Promise<EncodedTree>
    persist(tree: EncodedTree): void
    /** The previous a boot builds: the stored manifest and the stored unit bytes only. */
    boot(tree: EncodedTree): PreviousEncoding
}

function makeRig(envSeed = 700, mintSeed = 8200): Rig {
    const store = new Map<string, Uint8Array>()
    const lists = createListDerivation()
    let env = envSeed
    let mint = mintSeed
    return {
        store,
        async pass(db, previous, scope, seq) {
            const options: EncodeOptions = { env: seededEnv(env++), lists, seq, createdAt: NOW, previous }
            const plan = await planScopedEncode(db, options, scope)
            const context: BuildContext = { mint: createKeyMint(testEnv(createClock(), mint++), null).mint, seq, now: NOW }
            return plan.finalize(context)
        },
        persist(tree) {
            for (const unit of unitsToWrite(tree)) {
                store.set(unit.key, unit.bytes)
            }
        },
        boot(tree) {
            return previousOfTree({ manifestKey: tree.manifestKey, manifest: tree.manifest, source: { get: key => store.get(key) } })
        },
    }
}

const hex = (seed: string): string => seed.repeat(64).slice(0, 64)

/** A module with its own body, asset list and retained list, so a row that lost or gained another's data shows. */
function moduleOf(id: string, tag: string, extra: Obj = {}): Obj {
    return {
        name: `Module ${tag}`,
        description: `about ${tag}`,
        id,
        namespace: `ns-${tag}`,
        lorebook: [{ key: tag, comment: tag, content: `lore ${tag}` }],
        regex: [],
        trigger: [],
        assets: [[`asset-${tag}`, `assets/${hex(tag)}.png`]],
        risutanium_asset_retained: [[`kept-${tag}`, `assets/${hex(tag + tag)}.png`]],
        ...extra,
    }
}

function databaseOf(modules: Obj[]): Database {
    const base = JSON.parse(JSON.stringify(buildSmall(1))) as Obj
    base.modules = modules
    return asDatabase(base)
}

function indexOfTree(tree: EncodedTree): ModuleIndex {
    const index = tree.index.objects?.moduleIndex
    if (index === undefined) {
        throw new Error('The encoding holds no module index.')
    }
    return index
}

const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

function assembledModules(rig: Rig, tree: EncodedTree): Obj[] {
    const database = assembleDatabase(tree.manifest, { get: key => rig.store.get(key) }) as unknown as { modules: Obj[] }
    return database.modules
}

/** Makes the plain list of `db` the live list the re-id helper edits. */
function installLive(db: Database): void {
    h.db.current = db
}

const giveOwnId = (db: Database, index: number, id: string): RisuModule | null =>
    giveModuleCopyOwnId((db.modules as unknown as RisuModule[])[index], () => id)

beforeEach(() => {
    h.db.current = null
})

describe('T12: a later copy takes its own id, then a store2 save and a boot', () => {
    test.each([['previousFrom (save path)', false], ['previousOfTree (boot path)', true]] as const)(
        'handles shift and the following row re-encodes under its new handle; the first holder keeps its units, %s',
        async (_label, fromBytes) => {
            const rig = makeRig()
            const db = databaseOf([moduleOf('X', 'a'), moduleOf('X', 'b'), moduleOf('X', 'c')])
            const first = await rig.pass(db, null, ALL, 1)
            rig.persist(first)
            const before = indexOfTree(first).entries
            expect(moduleHandles(before)).toEqual(['X#0', 'X#1', 'X#2'])
            const bodiesBefore = plain(db.modules)
            expect(plain(assembledModules(rig, first))).toEqual(bodiesBefore)

            installLive(db)
            const made = giveOwnId(db, 1, 'Y')
            expect(made).not.toBeNull()
            expect((db.modules as unknown as Obj[]).map((row) => row.id)).toEqual(['X', 'Y', 'X'])

            const second = await rig.pass(db, fromBytes ? rig.boot(first) : previousFrom(first), MODS, 2)
            rig.persist(second)
            const after = indexOfTree(second).entries
            expect(moduleHandles(after)).toEqual(['X#0', 'Y#0', 'X#1'])
            // The first holder is reused whole.
            expect(after[0].unit).toEqual(before[0].unit)
            expect(after[0].al).toEqual(before[0].al)
            expect(after[0].il).toEqual(before[0].il)
            // The row behind the copy now stands under the handle the copy left; its unit is another one than the copy's was, with its own content.
            expect(after[2].unit).not.toEqual(before[1].unit)
            expect(after[2].unit.slice(1, 3)).toEqual(before[2].unit.slice(1, 3))
            expect(after[2].al.slice(1, 3)).toEqual(before[2].al.slice(1, 3))

            // A boot of the saved tree gives every row its own body, asset list and retained list back.
            const booted = plain(assembledModules(rig, second))
            expect(booted).toEqual(plain(db.modules))
            expect(booted.map((row) => row.name)).toEqual(['Module a', 'Module b', 'Module c'])
            expect(booted[1].id).toBe('Y')
            expect(booted[1].assets).toEqual(bodiesBefore[1].assets)
            expect(booted[1].risutanium_asset_retained).toEqual(bodiesBefore[1].risutanium_asset_retained)
            expect(booted[2].assets).toEqual(bodiesBefore[2].assets)
        },
    )

    test('the next pass over the booted previous finds nothing to write', async () => {
        const rig = makeRig(710, 8300)
        const db = databaseOf([moduleOf('X', 'a'), moduleOf('X', 'b'), moduleOf('X', 'c')])
        const first = await rig.pass(db, null, ALL, 1)
        rig.persist(first)
        installLive(db)
        giveOwnId(db, 1, 'Y')
        const second = await rig.pass(db, previousFrom(first), MODS, 2)
        rig.persist(second)
        const plan = await planScopedEncode(db, {
            env: seededEnv(900), lists: createListDerivation(), seq: 3, createdAt: NOW, previous: rig.boot(second),
        }, MODS)
        expect(plan.unchanged).toBe(true)
    })

    test('after the re-id the first holder is unique, so it may be stubbed, and a stub of it is carried unchanged', async () => {
        const versions = createListDerivation().moduleListVersions
        const config = { enabledModules: [] as string[], moduleIntergration: '', archiveCharacters: true }
        const rig = makeRig(720, 8400)
        const db = databaseOf([moduleOf('X', 'a'), moduleOf('X', 'b')])
        const first = await rig.pass(db, null, ALL, 1)
        rig.persist(first)
        // While the id is shared, every holder is resident: a stub would be matched to its entry by id.
        const entriesBefore = indexOfTree(first).entries
        expect(residentModuleHandlesOf({ modules: entriesBefore, config }, versions)?.has('X#0')).toBe(true)

        installLive(db)
        giveOwnId(db, 1, 'Y')
        const second = await rig.pass(db, previousFrom(first), MODS, 2)
        rig.persist(second)
        const entries: readonly ModuleEntry[] = indexOfTree(second).entries
        const resident = residentModuleHandlesOf({ modules: entries, config }, versions)
        expect(resident?.has('X#0')).toBe(false)
        expect(resident?.has('Y#0')).toBe(false)

        // The slot of the first holder becomes the stub its entry stands for; the pass carries the entry and its units.
        const stubbed = databaseOf([])
        stubbed.modules = [moduleStubOf(entries[0]) as unknown as Database['modules'][number], (db.modules as unknown as Database['modules'])[1]]
        const third = await rig.pass(stubbed, previousFrom(second), MODS, 3)
        const carried = indexOfTree(third).entries
        expect(carried[0]).toEqual(entries[0])
        expect(moduleHandles(carried)).toEqual(['X#0', 'Y#0'])
    })
})
