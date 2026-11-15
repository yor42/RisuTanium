// @vitest-environment node
/**
 * A `.rtb` library export of a profile that holds installed theme packs: the export's referenced set names each pack's
 * archive (so the files the export carries include it), and a restore of the exported closure brings back the records and
 * the active id. The store is the real producer's (`encodeDatabase` with the real list derivation, `rtbFixtures.ts`);
 * the restore is the real `planRestore` committed over a seeded store. A mocked backend says nothing about a native one.
 *
 * Titles: `reproducer` fails when the config asset list does not name the archive; `guard` passes before and after.
 */
import { beforeAll, describe, expect, test, vi } from 'vitest'
import { exportClosure } from 'src/ts/storage/store2/rtb/exportClosure'
import { omittedTailsOf, planRestore } from 'src/ts/storage/store2/rtb/restoreBuild'
import { buildSmall, type Obj } from './codecFixtures'
import { assembleStore, captureExport, commitRestore, rtbWorld, type RtbWorld } from './rtbFixtures'

const layout = vi.hoisted(() => ({ MODULE_INDEX_LAYOUT: 1 }))
vi.mock('src/ts/storage/store2/codec/moduleIndexParams', () => ({ MODULE_INDEX_PARAMS: layout }))

const HEX_PACK = 'ab'.repeat(32)
const HEX_OTHER = '3c'.repeat(32)
const ARCHIVE = `assets/tp-${HEX_PACK}.risutheme`

/** A stored record v1, the shape `installThemePack` emits. */
function record(id: string, archive = ARCHIVE): Obj {
    return {
        v: 1, id, packId: 'origin-navy', name: 'Origin Navy', version: '1.0.0', license: 'MIT', attribution: 'A. Author',
        modes: ['light', 'dark'], fonts: [{ file: 'fonts/a.woff2', license: 'OFL-1.1' }], archive, bytes: 4096, installedAt: 1_700_000_000_000,
    }
}

const UNREADABLE = { v: 99, future: { deep: { more: [`assets/tp-${HEX_OTHER}.risutheme`] } } }

let world: RtbWorld

beforeAll(async () => {
    const database = JSON.parse(JSON.stringify(buildSmall(2))) as Obj
    database.themePacks = [record('pack-1'), UNREADABLE]
    database.activeThemePack = 'pack-1'
    world = await rtbWorld({ layout: 1, database })
})

describe('the .rtb export of a profile that holds theme packs', () => {
    test('T2-8 reproducer: the referenced set holds the archive of a record and of an entry this build cannot read, and no other pack name', async () => {
        const closure = await exportClosure(await world.open(), { onUnits: async () => { } })

        expect(closure.referenced.notices).toEqual([])
        expect(closure.referenced.assets.mode).toBe('filter')
        if (closure.referenced.assets.mode === 'filter') {
            const holds = closure.referenced.assets.holds
            expect(holds(ARCHIVE)).toBe(true)
            expect(holds(`assets/tp-${HEX_OTHER}.risutheme`)).toBe(true)
            expect(holds(`assets/tp-${'9'.repeat(64)}.risutheme`)).toBe(false)
        }
    })

    test('T2-8 guard: a restore of the exported closure brings back the records and the active id, byte for byte', async () => {
        const cap = await captureExport(await world.open())
        const request = planRestore({ frames: cap.frames, root: cap.root, omitted: omittedTailsOf(cap.omitted), target: { legacyKeep: null, req: [] } })

        const restored = await commitRestore(request)

        const database = assembleStore(restored.units, restored.manifestKey) as Obj
        expect(database.themePacks).toEqual([record('pack-1'), UNREADABLE])
        expect(database.activeThemePack).toBe('pack-1')
        expect(assembleStore(restored.units, restored.manifestKey)).toEqual(assembleStore(world.store, world.manifestKey))
    })
})
