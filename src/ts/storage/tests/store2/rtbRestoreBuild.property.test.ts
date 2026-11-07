// @vitest-environment node
/**
 * The round trip of a `.rtb` file's store2 section over generated databases (CHORE-128 S4, T4-2, guard): a store written by
 * the real producer is exported with the real walk, planned, built, committed and read back. The restored store assembles to
 * the source database, and the garbage collector's mark finds every live key present.
 *
 * Label: "guard" tests the new contract of `rtb/restoreBuild`; before the module exists its red run is the missing import
 * (diagnostic), and its scratch mutant is what falsifies it.
 */
import fc from 'fast-check'
import { describe, expect, test, vi } from 'vitest'
import { markLiveKeys } from 'src/ts/storage/store2/gc/mark'
import { omittedTailsOf, planRestore } from 'src/ts/storage/store2/rtb/restoreBuild'
import { buildSmall, type Obj } from './codecFixtures'
import { assembleStore, captureExport, commitRestore, rtbWorld } from './rtbFixtures'

const layout = vi.hoisted(() => ({ MODULE_INDEX_LAYOUT: 1 }))
vi.mock('src/ts/storage/store2/codec/moduleIndexParams', () => ({ MODULE_INDEX_PARAMS: layout }))

interface Shape {
    layout: 1 | 2
    characters: number
    chunks: number
    alt: boolean
    taskPresets: number
    pluginKeys: number
}

const shapes = fc.record({
    layout: fc.constantFrom<1 | 2>(1, 2),
    characters: fc.integer({ min: 0, max: 6 }),
    chunks: fc.integer({ min: 1, max: 4 }),
    alt: fc.boolean(),
    taskPresets: fc.integer({ min: 0, max: 3 }),
    pluginKeys: fc.integer({ min: 0, max: 3 }),
})

/** A database of the given shape: the first chat of the first character holds `chunks` chunks, because each message is as large as a chunk. */
function databaseOf(shape: Shape): Obj {
    const db = JSON.parse(JSON.stringify(buildSmall(shape.characters))) as Obj
    const characters = db.characters as Obj[]
    if (characters.length > 0) {
        const chat = (characters[0].chats as Obj[])[0]
        chat.message = Array.from({ length: shape.chunks }, (_, index) => ({
            role: index % 2 === 0 ? 'user' : 'char', data: `${index}:${'x'.repeat(110_000)}`, time: 1 + index,
        }))
        if (shape.alt) {
            chat.alt = [{ m: { role: 'char', data: 'alternative', time: 1 }, p: null, a: 1 }]
        }
    }
    db.taskPresets = Array.from({ length: shape.taskPresets }, (_, index) => ({ name: `tp${index}`, x: index }))
    db.pluginCustomStorage = Object.fromEntries(Array.from({ length: shape.pluginKeys }, (_, index) => [`key-${index}`, `value-${index}`]))
    return db
}

describe('generated databases (T4-2, guard)', () => {
    test('the restored store assembles to the source and the mark finds no absent live key', async () => {
        await fc.assert(fc.asyncProperty(shapes, async (shape) => {
            const world = await rtbWorld({ layout: shape.layout, database: databaseOf(shape), seed: 5 })
            const cap = await captureExport(await world.open())
            expect(cap.omitted).toEqual([])
            const request = planRestore({ frames: cap.frames, root: cap.root, omitted: omittedTailsOf(cap.omitted), target: { legacyKeep: null, req: [] } })
            const restored = await commitRestore(request)

            expect(assembleStore(restored.units, restored.manifestKey)).toEqual(assembleStore(world.store, world.manifestKey))
            const mark = await markLiveKeys(restored.backend, await restored.backend.readCommit())
            expect(mark.status).toBe('marked')
            if (mark.status === 'marked') {
                expect([...mark.live].filter(key => !restored.units.has(key))).toEqual([])
            }
        }), { seed: 20261107, numRuns: 50 })
    }, 240_000)
})
