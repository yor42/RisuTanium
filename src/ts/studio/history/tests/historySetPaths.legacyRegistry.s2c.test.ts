// T2-OB (compatibility guard, S2c): a build whose registry holds only the rows up to the S2b paths refuses a record
// written with the `bias` path whole, keeps its bytes aside and never reads it with fewer steps. The factory keeps the
// rest of the real module and cuts only the two tables, so this is the older build's reader; the test only parses, loads
// and saves and must not replay.
import { describe, expect, test, vi } from 'vitest'
import type { OwnerRecord, Step } from '../historyModel'
import { characterOwnerKey } from '../ownerPhase'
import { asideMarkKey, headerKey } from '../studioHistoryStore'
import { createMemoryStudioStore, seedOwner, storedRecord } from './studioStoreDoubles'

vi.mock('../fieldRegistry', async (importOriginal) => {
    const original = await importOriginal<typeof import('../fieldRegistry')>()
    const older = [
        'desc', 'firstMessage', 'exampleMessage', 'customModuleToggle', 'hideChatIcon', 'risutanium_render_when_complete', 'note',
        'systemPrompt', 'replaceGlobalNote', 'additionalText', 'personality', 'scenario', 'depth_prompt.prompt', 'additionalData.creator',
        'additionalData.character_version', 'nickname', 'defaultVariables', 'translatorNote',
        'creatorNotes', 'removedQuotes', 'lowLevelAccess', 'utilityBot', 'escapeOutput',
    ] as const
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

function biasStep(id: string): Step {
    return {
        id,
        at: 1,
        label: { kind: 'field', field: 'bias' as never },
        ops: [{ op: 'set', path: 'bias' as never, before: { had: true, value: [['a', 1]] }, after: { had: true, value: [['a', 1], ['b', 2]] } }],
    }
}

describe('T2-OB: an older registry refuses a bias record whole and keeps its bytes', () => {
    test('the record reads unreadable and one save keeps the aside mark and every original entry byte-equal', async () => {
        const written: OwnerRecord = { ownerKey: OWNER, touchedAt: 4, done: [textStep('p:1', 'a', 'b'), biasStep('p:2')], undone: [], deleted: [], restore: null }
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
