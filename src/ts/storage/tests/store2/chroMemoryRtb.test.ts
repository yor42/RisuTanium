// @vitest-environment node
/**
 * A `.rtb` library export of a profile that holds the ChroMemory choice and settings: a restore of the exported closure
 * brings both keys back unchanged, unknown settings fields included. The store is the real producer's (`encodeDatabase`
 * with the real list derivation, `rtbFixtures.ts`); the restore is the real `planRestore` committed over a seeded store. A
 * mocked backend says nothing about a native one.
 *
 * Title: `guard` passes before and after, because the store keeps unknown top-level keys and the export needs no ChroMemory code.
 */
import { beforeAll, describe, expect, test, vi } from 'vitest'
import { omittedTailsOf, planRestore } from 'src/ts/storage/store2/rtb/restoreBuild'
import { buildSmall, type Obj } from './codecFixtures'
import { assembleStore, captureExport, commitRestore, rtbWorld, type RtbWorld } from './rtbFixtures'

const layout = vi.hoisted(() => ({ MODULE_INDEX_LAYOUT: 1 }))
vi.mock('src/ts/storage/store2/codec/moduleIndexParams', () => ({ MODULE_INDEX_PARAMS: layout }))

const SETTINGS = { budgetTokens: 1800, future: { deep: [1] } }

let world: RtbWorld

beforeAll(async () => {
    const database = JSON.parse(JSON.stringify(buildSmall(2))) as Obj
    database.ltmEngine = true
    database.ltmSettings = SETTINGS
    world = await rtbWorld({ layout: 1, database })
})

describe('the .rtb export of a profile that holds ChroMemory', () => {
    test('P2 guard: a restore of the exported closure brings back ltmEngine and ltmSettings, byte for byte', async () => {
        const cap = await captureExport(await world.open())
        const request = planRestore({ frames: cap.frames, root: cap.root, omitted: omittedTailsOf(cap.omitted), target: { legacyKeep: null, req: [] } })

        const restored = await commitRestore(request)

        const database = assembleStore(restored.units, restored.manifestKey) as Obj
        expect(database.ltmEngine).toBe(true)
        expect(database.ltmSettings).toEqual(SETTINGS)
        expect(assembleStore(restored.units, restored.manifestKey)).toEqual(assembleStore(world.store, world.manifestKey))
    })

    test('P2 guard: the source store itself holds both keys, so the comparison above is not between two empty profiles', () => {
        const source = assembleStore(world.store, world.manifestKey) as Obj
        expect(source.ltmEngine).toBe(true)
        expect(source.ltmSettings).toEqual(SETTINGS)
    })
})
