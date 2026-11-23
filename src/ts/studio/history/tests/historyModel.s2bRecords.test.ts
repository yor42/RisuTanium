// @vitest-environment jsdom
// T2-RB (S2b): the record of the three risky flags. A record holding every flag path reads back equal through the real
// serializer, and a value of the wrong type refuses the record whole.
import { describe, expect, test, vi } from 'vitest'
import { applyCharacterDefaults } from 'src/ts/storage/characterDefaults'
import type { character } from 'src/ts/storage/database.svelte'
import { buildFieldEdit, createLiveReader } from '../../edit/studioSetters'
import type { RestorePoint, SetPath, Step } from '../historyModel'
import { characterOwnerKey } from '../ownerPhase'
import type { StoredOwnerRecord } from '../studioHistoryStore'
import { readBack } from './s1Records.test-helpers'
import { seedOwner, storedRecord } from './studioStoreDoubles'

vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return {
        DBState: { db: { characters: [], modules: [] } },
        selIdState: { selId: 0 },
        MobileGUI: writable(false),
        settingsOpen: writable(false),
        clearCharEmotionCache: () => {},
    }
})

const OWNER = characterOwnerKey('c1')
const FLAGS: readonly SetPath[] = ['lowLevelAccess', 'utilityBot', 'escapeOutput']

function flagCharacter(): character {
    return applyCharacterDefaults({ chaId: 'c1' } as unknown as character) as character
}

function record(): StoredOwnerRecord {
    const reader = createLiveReader({ character: flagCharacter(), chat: null })
    const done: Step[] = FLAGS.map((path, index) => {
        const built = buildFieldEdit(path, true, reader, false)
        if (built.ok === false) {
            throw new Error(`no edit for ${path}`)
        }
        return { id: `p:${index + 1}`, at: index + 1, label: built.label, ops: built.ops }
    })
    const fields: RestorePoint['fields'] = {}
    for (const path of FLAGS) {
        fields[path] = { before: reader.field(path), last: { had: true, value: true } }
    }
    return { ownerKey: OWNER, touchedAt: 9, done, undone: [], deleted: [], restore: { visitId: 'v1', at: 5, fields } }
}

describe('T2-RB: the record of the S2b paths', () => {
    test('a record from the real builder reads back equal through the real serializer', () => {
        const written = record()
        expect(written.done.map((step) => step.ops)).toHaveLength(3)
        expect(readBack(written)).toEqual(written)
    })

    test.each(FLAGS.map((path, index) => [path, index] as const))('%s: a set holding text or a restore field holding text refuses the record whole', (_path, index) => {
        for (const corrupt of [
            (r: StoredOwnerRecord) => { (r.done[index].ops[0] as { after: unknown }).after = { had: true, value: 'yes' } },
            (r: StoredOwnerRecord) => { (r.restore!.fields[FLAGS[index]] as { last: unknown }).last = { had: true, value: 'yes' } },
        ]) {
            const written = record()
            corrupt(written)
            const shared = new Map<string, string>()
            seedOwner(shared, written, 'w:1')
            expect(storedRecord(shared, OWNER)).toBeNull()
        }
    })
})
