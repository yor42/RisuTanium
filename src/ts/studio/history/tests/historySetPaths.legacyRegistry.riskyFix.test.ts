// Compatibility guard (#730): a build whose registry holds every row up to `virtualscript`, but not the three risky
// fix paths (`lowLevelAccessFix`, `utilityBotFix`, `escapeOutputFix`), refuses a record written with any of those paths
// whole, keeps its bytes aside and never reads it with fewer steps.
import { describe, expect, test, vi } from 'vitest'
import type { OwnerRecord, Step } from '../historyModel'
import { characterOwnerKey } from '../ownerPhase'
import { asideMarkKey, headerKey } from '../studioHistoryStore'
import { createMemoryStudioStore, seedOwner, storedRecord } from './studioStoreDoubles'

const RISKY_FIX_PATHS = ['lowLevelAccessFix', 'utilityBotFix', 'escapeOutputFix'] as const

vi.mock('../fieldRegistry', async (importOriginal) => {
    const original = await importOriginal<typeof import('../fieldRegistry')>()
    const cut = new Set<string>(['lowLevelAccessFix', 'utilityBotFix', 'escapeOutputFix'])
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

function fixStep(id: string, path: (typeof RISKY_FIX_PATHS)[number]): Step {
    return {
        id,
        at: 1,
        label: { kind: 'field', field: path as never },
        ops: [{ op: 'set', path: path as never, before: { had: 'foreign', value: 1 }, after: { had: true, value: false } }],
    }
}

describe('T-730-old: an older registry refuses a record with a risky fix path whole and keeps its bytes', () => {
    test.each(RISKY_FIX_PATHS)('%s: the record reads unreadable and one save keeps the aside mark and every original entry byte-equal', async (path) => {
        const written: OwnerRecord = { ownerKey: OWNER, touchedAt: 4, done: [textStep('p:1', 'a', 'b'), fixStep('p:2', path)], undone: [], deleted: [], restore: null }
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
