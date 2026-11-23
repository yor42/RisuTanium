// Append-only guard of the persisted facts of every registered set path. A path new to older builds is refused whole by
// them, and an existing path's facts decide how records written earlier replay, so a row of FROZEN_FIELD_FACTS is
// never edited or removed: a later PR appends its own row (with its own readBack and whole-record refusal tests) and
// lifts the rule assertions (F-d′, F-e) only when it implements further nested containers or number values. This table is a
// literal on purpose: deriving it from the registry would make the guard pass for any registry.
import { describe, expect, test } from 'vitest'
import { CONTAINER_SEEDS, FIELD_SPECS, type FieldFacts } from '../fieldRegistry'
import { RESTORE_PATH_ORDER } from '../historyModel'

const FROZEN_FIELD_FACTS: readonly (readonly [string, FieldFacts])[] = [
    ['desc', { value: 'text', holders: ['character'], absent: 'keep', editWhenAbsent: true }],
    ['firstMessage', { value: 'text', holders: ['character'], absent: 'keep', editWhenAbsent: false }],
    ['exampleMessage', { value: 'text', holders: ['character'], absent: 'keep', editWhenAbsent: false }],
    ['customModuleToggle', { value: 'text', holders: ['character', 'module'], absent: 'delete', editWhenAbsent: true }],
    ['hideChatIcon', { value: 'bool', holders: ['character'], absent: 'delete', editWhenAbsent: true }],
    ['risutanium_render_when_complete', { value: 'bool', holders: ['character'], absent: 'delete', editWhenAbsent: true }],
    ['note', { value: 'text', holders: ['chat'], absent: 'keep', editWhenAbsent: true }],
    ['systemPrompt', { value: 'text', holders: ['character'], absent: 'keep', editWhenAbsent: false }],
    ['replaceGlobalNote', { value: 'text', holders: ['character'], absent: 'keep', editWhenAbsent: false }],
    ['additionalText', { value: 'text', holders: ['character'], absent: 'keep', editWhenAbsent: false }],
    ['personality', { value: 'text', holders: ['character'], absent: 'keep', editWhenAbsent: false }],
    ['scenario', { value: 'text', holders: ['character'], absent: 'keep', editWhenAbsent: false }],
    ['depth_prompt.prompt', { value: 'text', holders: ['character'], absent: 'keep', editWhenAbsent: false }],
    ['additionalData.creator', { value: 'text', holders: ['character'], absent: 'delete', editWhenAbsent: true }],
    ['additionalData.character_version', { value: 'text', holders: ['character'], absent: 'delete', editWhenAbsent: true }],
    ['nickname', { value: 'text', holders: ['character'], absent: 'delete', editWhenAbsent: true }],
    ['defaultVariables', { value: 'text', holders: ['character'], absent: 'delete', editWhenAbsent: true }],
    ['translatorNote', { value: 'text', holders: ['character'], absent: 'delete', editWhenAbsent: true }],
    ['creatorNotes', { value: 'text', holders: ['character'], absent: 'keep', editWhenAbsent: false }],
    ['removedQuotes', { value: 'bool', holders: ['character'], absent: 'delete', editWhenAbsent: true }],
    ['lowLevelAccess', { value: 'bool', holders: ['character'], absent: 'delete', editWhenAbsent: true }],
    ['utilityBot', { value: 'bool', holders: ['character'], absent: 'keep', editWhenAbsent: false }],
    ['escapeOutput', { value: 'bool', holders: ['character'], absent: 'delete', editWhenAbsent: true }],
]

// The containers a dotted path names, with the value an absent container reads as. An undo replays a seed reading, so
// the seeds are persisted facts.
const FROZEN_CONTAINER_SEEDS = {
    depth_prompt: { depth: 0, prompt: '' },
    additionalData: { tag: [], creator: '', character_version: '' },
}

describe('T-FZ: the persisted facts of the registered paths are frozen', () => {
    test('F-a: the registry holds exactly the frozen paths, in order', () => {
        expect(Object.keys(FIELD_SPECS)).toEqual(FROZEN_FIELD_FACTS.map(([path]) => path))
    })

    test('F-b: each registered entry holds exactly its frozen facts (no added, removed or changed fact)', () => {
        const specs: Record<string, FieldFacts> = FIELD_SPECS
        for (const [path, facts] of FROZEN_FIELD_FACTS) {
            expect(specs[path], path).toStrictEqual(facts)
        }
    })

    test('F-c: the restore order is the frozen paths followed by the list path', () => {
        expect(RESTORE_PATH_ORDER).toEqual([...FROZEN_FIELD_FACTS.map(([path]) => path), 'alternateGreetings'])
    })

    test('F-d′: a dotted path names one registered container and a key, is character-held only and has no property; no property has a dot', () => {
        const specs: Record<string, FieldFacts> = FIELD_SPECS
        for (const path of Object.keys(specs)) {
            expect(specs[path].property ?? '', path).not.toContain('.')
            if (!path.includes('.')) {
                continue
            }
            const parts = path.split('.')
            expect(parts, path).toHaveLength(2)
            expect(parts[0].length, path).toBeGreaterThan(0)
            expect(parts[1].length, path).toBeGreaterThan(0)
            expect(Object.keys(CONTAINER_SEEDS), path).toContain(parts[0])
            expect(specs[path].property, path).toBeUndefined()
            expect(specs[path].holders, path).toEqual(['character'])
        }
    })

    test('F-f: the container seeds are frozen, in key order', () => {
        expect(CONTAINER_SEEDS).toStrictEqual(FROZEN_CONTAINER_SEEDS)
        expect(Object.keys(CONTAINER_SEEDS)).toEqual(Object.keys(FROZEN_CONTAINER_SEEDS))
    })

    test('F-e: every value type is text or bool (number values are not implemented)', () => {
        const specs: Record<string, FieldFacts> = FIELD_SPECS
        for (const path of Object.keys(specs)) {
            expect(['text', 'bool'], path).toContain(specs[path].value)
        }
    })
})
