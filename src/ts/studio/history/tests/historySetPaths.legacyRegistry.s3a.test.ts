// T-LP-old (compatibility guard, S3a): a build whose registry holds every row up to `lorePlus`, but not the ten Studio S3a
// rows (the name, the Display form's paths and the four `newGenData` keys), refuses a record written with any of those
// paths whole, keeps its bytes aside and never reads it with fewer steps. The factory keeps the rest of the real module and
// cuts only the two tables, so this is the older build's reader; the test only parses, loads and saves and must not replay.
// It passes before and after S3a.
import { describe, expect, test, vi } from 'vitest'
import type { OwnerRecord, Step } from '../historyModel'
import { characterOwnerKey } from '../ownerPhase'
import { asideMarkKey, headerKey } from '../studioHistoryStore'
import { createMemoryStudioStore, seedOwner, storedRecord } from './studioStoreDoubles'

const S3A_PATHS = ['name', 'viewScreen', 'largePortrait', 'inlayViewScreen', 'prebuiltAssetCommand', 'prebuiltAssetStyle', 'newGenData.prompt', 'newGenData.negative', 'newGenData.instructions', 'newGenData.emotionInstructions'] as const

vi.mock('../fieldRegistry', async (importOriginal) => {
    const original = await importOriginal<typeof import('../fieldRegistry')>()
    const cut = new Set<string>(['name', 'viewScreen', 'largePortrait', 'inlayViewScreen', 'prebuiltAssetCommand', 'prebuiltAssetStyle', 'newGenData.prompt', 'newGenData.negative', 'newGenData.instructions', 'newGenData.emotionInstructions'])
    const older = Object.keys(original.FIELD_SPECS).filter((path) => !cut.has(path)) as (keyof typeof original.FIELD_SPECS)[]
    return {
        ...original,
        FIELD_SPECS: Object.fromEntries(older.map((path) => [path, original.FIELD_SPECS[path]])),
        FIELD_PRESENTATION: Object.fromEntries(older.map((path) => [path, original.FIELD_PRESENTATION[path]])),
    }
})

const OWNER = characterOwnerKey('c1')

function textStep(id: string, before: string, after: string): Step {
    return { id, at: 1, label: { kind: 'field', field: 'desc' }, ops: [{ op: 'set', path: 'desc', before: { had: true, value: before }, after: { had: true, value: after } }] }
}

function s3aStep(id: string, path: (typeof S3A_PATHS)[number]): Step {
    const boolean = path === 'largePortrait' || path === 'inlayViewScreen' || path === 'prebuiltAssetCommand'
    return {
        id,
        at: 1,
        label: { kind: 'field', field: path as never },
        ops: [{ op: 'set', path: path as never, before: { had: false }, after: { had: true, value: boolean ? true : 'x' } }],
    }
}

describe('T-LP-old: an older registry refuses a record with an S3a path whole and keeps its bytes', () => {
    test.each(S3A_PATHS)('%s: the record reads unreadable and one save keeps the aside mark and every original entry byte-equal', async (path) => {
        const written: OwnerRecord = { ownerKey: OWNER, touchedAt: 4, done: [textStep('p:1', 'a', 'b'), s3aStep('p:2', path)], undone: [], deleted: [], restore: null }
        const shared = new Map<string, string>()
        seedOwner(shared, written, 'w:1')
        expect(storedRecord(shared, OWNER)).toBeNull()
        const originals = [...shared].filter(([key]) => key.startsWith('e:'))
        expect(originals.length).toBeGreaterThan(0)
        const headerText = shared.get(headerKey(OWNER))

        const store = createMemoryStudioStore({ shared })
        expect(await store.load(OWNER)).toEqual({ kind: 'unreadable' })
        const mine: OwnerRecord = { ownerKey: OWNER, touchedAt: 9, done: [textStep('p:9', 'a', 'b')], undone: [], deleted: [], restore: null }
        expect(await store.save(OWNER, mine, new Set([OWNER]))).toMatchObject({ kind: 'ok', asided: true })
        expect(shared.get(asideMarkKey(OWNER))).toBe(headerText)
        for (const [key, value] of originals) {
            expect(shared.get(key), key).toBe(value)
        }
    })
})
