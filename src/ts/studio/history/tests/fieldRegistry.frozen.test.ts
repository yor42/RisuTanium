// Append-only guard of the persisted facts of every registered set path. A path new to older builds is refused whole by
// them, and an existing path's facts decide how records written earlier replay, so a row of FROZEN_FIELD_FACTS is
// never edited or removed: a later PR appends its own row (with its own readBack and whole-record refusal tests) and
// lifts the two rule assertions (F-d, F-e) only when it implements nested paths or number values. This table is a
// literal on purpose: deriving it from the registry would make the guard pass for any registry.
import { describe, expect, test } from 'vitest'
import { FIELD_SPECS, type FieldFacts } from '../fieldRegistry'
import { RESTORE_PATH_ORDER } from '../historyModel'

const FROZEN_FIELD_FACTS: readonly (readonly [string, FieldFacts])[] = [
    ['desc', { value: 'text', holders: ['character'], absent: 'keep', editWhenAbsent: true }],
    ['firstMessage', { value: 'text', holders: ['character'], absent: 'keep', editWhenAbsent: false }],
    ['exampleMessage', { value: 'text', holders: ['character'], absent: 'keep', editWhenAbsent: false }],
    ['customModuleToggle', { value: 'text', holders: ['character', 'module'], absent: 'delete', editWhenAbsent: true }],
    ['hideChatIcon', { value: 'bool', holders: ['character'], absent: 'delete', editWhenAbsent: true }],
    ['risutanium_render_when_complete', { value: 'bool', holders: ['character'], absent: 'delete', editWhenAbsent: true }],
    ['note', { value: 'text', holders: ['chat'], absent: 'keep', editWhenAbsent: true }],
]

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

    test('F-d: no path and no property contains a dot (nested holder properties are not implemented)', () => {
        for (const [path, facts] of FROZEN_FIELD_FACTS) {
            expect(path, path).not.toContain('.')
            expect(facts.property ?? '', path).not.toContain('.')
        }
        const specs: Record<string, FieldFacts> = FIELD_SPECS
        for (const path of Object.keys(specs)) {
            expect(path).not.toContain('.')
            expect(specs[path].property ?? '', path).not.toContain('.')
        }
    })

    test('F-e: every value type is text or bool (number values are not implemented)', () => {
        const specs: Record<string, FieldFacts> = FIELD_SPECS
        for (const path of Object.keys(specs)) {
            expect(['text', 'bool'], path).toContain(specs[path].value)
        }
    })
})
