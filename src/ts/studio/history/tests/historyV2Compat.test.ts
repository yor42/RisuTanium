import { describe, expect, test } from 'vitest'
import type { OwnerRecord } from '../historyModel'
import { characterOwnerKey, type OwnerKey } from '../ownerPhase'
import { createMemoryStudioStore, storedRecord } from './studioStoreDoubles'
import fixture from './fixtures/historyV2.b0.json'

// The bytes in the fixture were written by the version 2 writer before the first message and the example message
// joined the set paths. The widened reader still reads every shape that writer produced, and loading writes nothing.
const stored = fixture as unknown as { ownerKey: OwnerKey; record: OwnerRecord; entries: [string, string][] }

describe('version 2 bytes written before the set paths widened', () => {
    test('the stored record reads back deep-equal, with text edits on legacy and other targets, the restore entry and the desc label', () => {
        const shared = new Map<string, string>(stored.entries)
        const view = storedRecord(shared, characterOwnerKey('c1'))
        expect(view?.record).toEqual(stored.record)
        const targets = stored.record.done.flatMap((step) => step.ops.flatMap((op) => (op.op === 'textEdit' ? [op.target] : [])))
        expect(targets).toEqual(['desc', 'alternateGreetings/0', 'lore/0/content', 'regex/0/out', 'systemPrompt', 'trigger/0/effect/0/value'])
        expect(stored.record.done.every((step) => step.label.kind === 'field' && step.label.field === 'desc')).toBe(true)
        expect(Object.keys(stored.record.restore?.fields ?? {})).toEqual(['desc', 'hideChatIcon', 'alternateGreetings'])
    })

    test('loading them is ok and writes nothing, and every stored value keeps version 2', async () => {
        const shared = new Map<string, string>(stored.entries)
        const before = new Map(shared)
        const store = createMemoryStudioStore({ shared })
        expect(await store.load(characterOwnerKey('c1'))).toEqual({ kind: 'ok', record: stored.record })
        expect(shared).toEqual(before)
        expect(store.writes).toEqual([])
        expect(new Set([...shared.values()].map((text) => (JSON.parse(text) as { v: number }).v))).toEqual(new Set([2]))
    })
})
