// T2-OB (compatibility guard): a build whose registry holds only the rows up to the S2a paths refuses a record written
// with the S2b paths whole, keeps its bytes aside and never reads it with fewer steps. The factory keeps the rest of the
// real module and cuts only the two tables, so this is the older build's reader; the test only parses, loads and saves
// and must not replay.
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
        'creatorNotes', 'removedQuotes',
    ] as const
    return {
        ...original,
        FIELD_SPECS: Object.fromEntries(older.map((path) => [path, original.FIELD_SPECS[path]])),
        FIELD_PRESENTATION: Object.fromEntries(older.map((path) => [path, original.FIELD_PRESENTATION[path]])),
    }
})

const OWNER = characterOwnerKey('c1')

function step(id: string, path: string, before: string | boolean, after: string | boolean): Step {
    return {
        id,
        at: 1,
        label: { kind: 'field', field: path as never },
        ops: [{ op: 'set', path: path as never, before: { had: true, value: before }, after: { had: true, value: after } }],
    }
}

describe('T2-OB: an older registry refuses an S2b record whole and keeps its bytes', () => {
    test.each([
        ['lowLevelAccess', true, false],
        ['utilityBot', false, true],
        ['escapeOutput', true, false],
    ] as const)('a record holding %s reads unreadable and one save keeps the aside mark and every original entry byte-equal', async (path, before, after) => {
        const written: OwnerRecord = { ownerKey: OWNER, touchedAt: 4, done: [step('p:1', 'desc', 'a', 'b'), step('p:2', path, before, after)], undone: [], deleted: [], restore: null }
        const shared = new Map<string, string>()
        seedOwner(shared, written, 'w:1')
        expect(storedRecord(shared, OWNER)).toBeNull()
        const originals = [...shared].filter(([key]) => key.startsWith('e:'))
        expect(originals.length).toBeGreaterThan(0)
        const headerText = shared.get(headerKey(OWNER))

        const store = createMemoryStudioStore({ shared })
        expect(await store.load(OWNER)).toEqual({ kind: 'unreadable' })
        const mine: OwnerRecord = { ownerKey: OWNER, touchedAt: 9, done: [step('p:9', 'desc', 'a', 'b')], undone: [], deleted: [], restore: null }
        expect(await store.save(OWNER, mine, new Set([OWNER]))).toMatchObject({ kind: 'ok', asided: true })
        expect(shared.get(asideMarkKey(OWNER))).toBe(headerText)
        for (const [key, value] of originals) {
            expect(shared.get(key), key).toBe(value)
        }
    })
})
