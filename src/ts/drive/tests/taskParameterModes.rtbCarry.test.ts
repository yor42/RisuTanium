// @vitest-environment node

/**
 * #929 S1b T-C8 (compatibility guard; passes before and after the S1b change): the store2 encode and the full `.rtb` export
 * and restore carry the per-task modes key inside the container, in the root and in every preset slot. The store is the
 * fixture world's real producer output with a keyed profile.
 */
import { describe, expect, test, vi } from 'vitest'
import { TASK_MODES_KEY } from 'src/ts/storage/taskParameterModes'
import { omittedTailsOf, planRestore } from 'src/ts/storage/store2/rtb/restoreBuild'
import { buildSmall } from 'src/ts/storage/tests/store2/codecFixtures'
import { assembleStore, captureExport, commitRestore, rtbWorld } from 'src/ts/storage/tests/store2/rtbFixtures'

const layout = vi.hoisted(() => ({ MODULE_INDEX_LAYOUT: 1 }))
vi.mock('src/ts/storage/store2/codec/moduleIndexParams', () => ({ MODULE_INDEX_PARAMS: layout }))

type Loose = Record<string, unknown>

const MIX = { memory: 'own', emotion: 'same', translate: 'same', otherAx: 'same' }

function container(extra: Loose = {}): Loose {
    return { memory: { temperature: 11 }, emotion: {}, translate: {}, otherAx: {}, overrides: {}, ...extra }
}

function containerOf(record: unknown): Loose {
    return (record as { seperateParameters: Loose }).seperateParameters
}

describe('T-C8 the store2 encode and the full .rtb keep the key', () => {
    const SLOT_KEYED = { name: 'Keyed', seperateParametersEnabled: true, seperateParameters: container({ taskModes: { ...MIX } }) }

    function profile(): Loose {
        return {
            ...(buildSmall(2) as unknown as Loose),
            seperateParametersEnabled: true,
            seperateParameters: container({ taskModes: { ...MIX } }),
            botPresetsId: 0,
            botPresets: [SLOT_KEYED],
        }
    }

    function keyed(db: unknown): void {
        const root = db as { seperateParameters: Loose, botPresets: unknown[] }
        expect(root.seperateParameters[TASK_MODES_KEY]).toEqual(MIX)
        expect(containerOf(root.botPresets[0])[TASK_MODES_KEY]).toEqual(MIX)
    }

    test('guard: the encoded store assembles with the key in the root and the slot', async () => {
        const world = await rtbWorld({ layout: 1, database: profile() as never })

        keyed(assembleStore(world.store, world.manifestKey))
    })

    test('guard: a full .rtb export and restore carry the key in the root and the slot', async () => {
        const world = await rtbWorld({ layout: 1, database: profile() as never })
        const captured = await captureExport(await world.open())

        const restored = await commitRestore(planRestore({
            frames: captured.frames, root: captured.root, omitted: omittedTailsOf(captured.omitted), target: { legacyKeep: null, req: [] },
        }))

        keyed(assembleStore(restored.units, restored.manifestKey))
    })
})
