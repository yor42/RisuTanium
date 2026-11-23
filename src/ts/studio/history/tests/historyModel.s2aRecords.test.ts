// @vitest-environment jsdom
// T2-RB and T2-TX: the records of the S2a paths. A record holding both paths reads back equal through the real
// serializer; a value of the wrong type refuses the record whole; a merge on creator notes is a field `set` that a
// restore point learns, and the registry target of creator notes is a text field path.
import { describe, expect, test, vi } from 'vitest'
import { applyCharacterDefaults } from 'src/ts/storage/characterDefaults'
import type { character } from 'src/ts/storage/database.svelte'
import { applyCharacterWrites, buildFieldEdit, createLiveReader } from '../../edit/studioSetters'
import { assetStepWrites, deriveRestoreWrites, emptyRecord, planReplay, TEXT_FIELD_PATHS, type Op, type RestorePoint, type Step } from '../historyModel'
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

function noteCharacter(): character {
    return applyCharacterDefaults({ chaId: 'c1', creatorNotes: '\n# `en`\nhello', removedQuotes: true } as unknown as character) as character
}

function record(): StoredOwnerRecord {
    const reader = createLiveReader({ character: noteCharacter(), chat: null })
    const built = buildFieldEdit('creatorNotes', '\n# `en`\nhello!', reader)
    if (built.ok === false) {
        throw new Error('no edit')
    }
    const step: Step = { id: 'p:1', at: 1, label: built.label, ops: built.ops }
    const restore: RestorePoint = {
        visitId: 'v1',
        at: 2,
        fields: {
            creatorNotes: { before: reader.field('creatorNotes'), last: { had: true, value: '\n# `en`\nhello!' } },
            removedQuotes: { before: reader.field('removedQuotes'), last: { had: true, value: false } },
        },
    }
    return { ownerKey: OWNER, touchedAt: 3, done: [step], undone: [], deleted: [], restore }
}

describe('T2-RB: the record of the S2a paths', () => {
    test('a record from the real builder reads back equal through the real serializer', () => {
        const written = record()
        expect(written.done[0].ops).toHaveLength(2)
        expect(readBack(written)).toEqual(written)
    })

    test.each([
        ['creatorNotes set holding a boolean', (r: StoredOwnerRecord) => { (r.done[0].ops[0] as { after: unknown }).after = { had: true, value: true } }],
        ['removedQuotes set holding text', (r: StoredOwnerRecord) => { (r.done[0].ops[1] as { after: unknown }).after = { had: true, value: 'no' } }],
        ['creatorNotes restore field holding a boolean', (r: StoredOwnerRecord) => { (r.restore!.fields.creatorNotes as { last: unknown }).last = { had: true, value: false } }],
        ['removedQuotes restore field holding text', (r: StoredOwnerRecord) => { (r.restore!.fields.removedQuotes as { last: unknown }).last = { had: true, value: 'x' } }],
    ])('%s refuses the record whole', (_name, corrupt) => {
        const written = record()
        corrupt(written)
        const shared = new Map<string, string>()
        seedOwner(shared, written, 'w:1')
        expect(storedRecord(shared, OWNER)).toBeNull()
    })
})

describe('T2-TX: a merge on creator notes is a field set that a restore point learns', () => {
    const textEdit = (offset: number, from: string, to: string): Op => ({ op: 'textEdit', target: 'creatorNotes', offset, from, to })

    test('creator notes is a text field path', () => {
        expect(TEXT_FIELD_PATHS).toContain('creatorNotes')
    })

    test('the merge applies as a set of the whole note and an undo restores the text before', () => {
        const live = noteCharacter()
        live.creatorNotes = '\n# `en`\n{{image::smile2}}'
        const ops: Op[] = [textEdit(17, 'smile2', 'smile')]
        const writes = assetStepWrites(ops, createLiveReader({ character: live, chat: null }))
        if (writes === null) {
            throw new Error('the merge does not apply')
        }
        expect(writes).toEqual([{ op: 'set', path: 'creatorNotes', value: { had: true, value: '\n# `en`\n{{image::smile}}' } }])
        applyCharacterWrites(live, writes, null)
        expect(live.creatorNotes).toBe('\n# `en`\n{{image::smile}}')
        expect(live.removedQuotes).toBe(true)
        const plan = planReplay({ ...emptyRecord(OWNER, 0), done: [{ id: 'p:1', at: 1, label: { kind: 'assetMerge', from: 'a', to: 'b' }, ops }] }, 'undo', createLiveReader({ character: live, chat: null }))
        if (plan.ok === false) {
            throw new Error(`undo refused: ${plan.reason}`)
        }
        applyCharacterWrites(live, plan.writes, null)
        expect(live.creatorNotes).toBe('\n# `en`\n{{image::smile2}}')
    })

    test('the restore point keeps the merge: its write for the field carries the merged text', () => {
        const restore = deriveRestoreWrites([textEdit(17, 'smile2', 'smile')], null, { creatorNotes: '\n# `en`\n{{image::smile2}}' })
        expect(restore).toEqual([{ path: 'creatorNotes', before: { had: true, value: '\n# `en`\n{{image::smile2}}' }, after: { had: true, value: '\n# `en`\n{{image::smile}}' } }])
    })
})
