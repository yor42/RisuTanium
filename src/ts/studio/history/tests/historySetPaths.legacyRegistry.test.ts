// T1-OB (compatibility guard): a build whose registry holds only the seven frozen rows refuses a record written with the
// S1 paths whole, keeps its bytes aside and never reads it with fewer steps. The factory keeps the rest of the real
// module and cuts only the two tables, so this is the older build's reader; the test only parses, loads and saves and
// must not replay.
import { describe, expect, test, vi } from 'vitest'
import type { OwnerRecord, Step } from '../historyModel'
import { characterOwnerKey } from '../ownerPhase'
import { asideMarkKey, headerKey } from '../studioHistoryStore'
import { createMemoryStudioStore, seedOwner, storedRecord } from './studioStoreDoubles'

vi.mock('../fieldRegistry', async (importOriginal) => {
    const original = await importOriginal<typeof import('../fieldRegistry')>()
    const frozen = ['desc', 'firstMessage', 'exampleMessage', 'customModuleToggle', 'hideChatIcon', 'risutanium_render_when_complete', 'note'] as const
    return {
        ...original,
        FIELD_SPECS: Object.fromEntries(frozen.map((path) => [path, original.FIELD_SPECS[path]])),
        FIELD_PRESENTATION: Object.fromEntries(frozen.map((path) => [path, original.FIELD_PRESENTATION[path]])),
    }
})

const OWNER = characterOwnerKey('c1')

// The serializer does not consult the registry, so the record is written as the S1 build writes it.
function s1Step(id: string, path: string): Step {
    return {
        id,
        at: 1,
        label: { kind: 'field', field: path as never },
        ops: [{ op: 'set', path: path as never, before: { had: true, value: 'a' }, after: { had: true, value: 'b' } }],
    }
}

function s1Record(): OwnerRecord {
    const fields = { 'depth_prompt.prompt': { before: { had: true, value: 'a' }, last: { had: true, value: 'b' } } } as unknown as NonNullable<OwnerRecord['restore']>['fields']
    return {
        ownerKey: OWNER,
        touchedAt: 4,
        done: [s1Step('p:1', 'desc'), s1Step('p:2', 'systemPrompt'), s1Step('p:3', 'depth_prompt.prompt')],
        undone: [],
        deleted: [],
        restore: { visitId: 'v1', at: 2, fields },
    }
}

describe('T1-OB: an older registry refuses an S1 record whole and keeps its bytes', () => {
    test('the record reads unreadable and one save keeps the aside mark and every original entry byte-equal', async () => {
        const shared = new Map<string, string>()
        seedOwner(shared, s1Record(), 'w:1')
        expect(storedRecord(shared, OWNER)).toBeNull()
        const originals = [...shared].filter(([key]) => key.startsWith('e:'))
        expect(originals.length).toBeGreaterThan(0)
        const headerText = shared.get(headerKey(OWNER))

        const store = createMemoryStudioStore({ shared })
        expect(await store.load(OWNER)).toEqual({ kind: 'unreadable' })
        const mine: OwnerRecord = { ownerKey: OWNER, touchedAt: 9, done: [s1Step('p:9', 'desc')], undone: [], deleted: [], restore: null }
        expect(await store.save(OWNER, mine, new Set([OWNER]))).toMatchObject({ kind: 'ok', asided: true })
        expect(shared.get(asideMarkKey(OWNER))).toBe(headerText)
        for (const [key, value] of originals) {
            expect(shared.get(key), key).toBe(value)
        }
    })
})
