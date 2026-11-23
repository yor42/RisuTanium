// The records the S1 tests share: a character record built the way the real producer builds it. Each op comes from
// `buildFieldEdit` over a live reader of a character holding every S1 text, and the restore point holds the reading and
// the written value of each path. Importers must mock `src/ts/stores.svelte`, as the setter tests do.
import { applyCharacterDefaults } from 'src/ts/storage/characterDefaults'
import type { character } from 'src/ts/storage/database.svelte'
import { buildFieldEdit, createLiveReader } from '../../edit/studioSetters'
import type { OwnerRecord, RestorePoint, SetPath, Step } from '../historyModel'
import { characterOwnerKey, type OwnerKey } from '../ownerPhase'
import { seedOwner, storedRecord } from './studioStoreDoubles'

export const S1_PATHS: readonly SetPath[] = [
    'systemPrompt', 'replaceGlobalNote', 'additionalText', 'personality', 'scenario', 'depth_prompt.prompt',
    'additionalData.creator', 'additionalData.character_version', 'nickname', 'defaultVariables', 'translatorNote',
]

export const S1_OWNER: OwnerKey = characterOwnerKey('c1')

export function s1Character(): character {
    return applyCharacterDefaults({
        chaId: 'c1',
        desc: 'd0',
        firstMessage: 'f0',
        exampleMessage: 'e0',
        systemPrompt: 's0',
        replaceGlobalNote: 'r0',
        additionalText: 'a0',
        personality: 'p0',
        scenario: 'c0',
        depth_prompt: { depth: 1, prompt: 'dp0' },
        additionalData: { tag: [], creator: 'cr0', character_version: 'v0' },
        nickname: 'n0',
        defaultVariables: 'dv0',
        translatorNote: 't0',
    } as unknown as character) as character
}

export const s1Value = (path: SetPath): string => `x-${path}`

export function s1Step(path: SetPath, index: number): Step {
    const built = buildFieldEdit(path, s1Value(path), createLiveReader({ character: s1Character(), chat: null }))
    if (built.ok === false) {
        throw new Error(`no edit for ${path}`)
    }
    return { id: `p:${index + 1}`, at: index + 1, label: built.label, ops: built.ops }
}

export function s1Restore(): RestorePoint {
    const reader = createLiveReader({ character: s1Character(), chat: null })
    const fields: RestorePoint['fields'] = {}
    for (const path of S1_PATHS) {
        fields[path] = { before: reader.field(path), last: { had: true, value: s1Value(path) } }
    }
    return { visitId: 'v1', at: 20, fields }
}

export function s1Record(): OwnerRecord {
    return { ownerKey: S1_OWNER, touchedAt: 30, done: S1_PATHS.map((path, index) => s1Step(path, index)), undone: [], deleted: [], restore: s1Restore() }
}

// The strict reader's view of a record written by the real serializer.
export function readBack(record: OwnerRecord): OwnerRecord | null {
    const shared = new Map<string, string>()
    seedOwner(shared, record, 'w:1')
    return storedRecord(shared, record.ownerKey)?.record ?? null
}
