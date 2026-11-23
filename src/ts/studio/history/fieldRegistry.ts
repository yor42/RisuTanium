// The one registry of the Studio set paths: the persisted facts of each path (FIELD_SPECS) and its presentation
// (FIELD_PRESENTATION). Every per-kind table, parser row, restore row, reader, writer, label and focus target derives
// from these two tables, so a new builtin-host field is one entry in each (plus its frozen row in the frozen-facts
// test). The module is pure: type-only imports, no behaviour. The functions that read the tables live in
// fieldAccess.ts.
//
// Rules for every later change (persisted facts):
// - A path is a stable history identity string. It is recorded in set ops, step labels and restore keys, and it is
//   never derived from the holder property and never required to equal it. Holder access goes only through
//   `propertyOf(path)`, which is `property` when given and the path otherwise. To move a field to another holder
//   property, set `property`; never rename the path.
// - A dot in a path or in a `property` is reserved for nested holder properties (a dotted path names container `a`,
//   key `b`, for example `depth_prompt.depth`). No dotted path and no `number` value is registered yet: the generic
//   reader and writer support flat properties and text or boolean values only.
// - Never rename or remove a path, and never change an existing path's `value`, `absent`, `editWhenAbsent`,
//   `holders` or `property`: older builds refuse a record whole on a path they do not know, and the frozen-facts test
//   (append-only) pins every existing row. A path new to older builds is a widening they refuse whole.
// - `absent` is applied by the builtin-holder writers only. `editWhenAbsent` is enforced by the kind-independent edit
//   builder for every kind.
// - Adding an existing path to another builtin kind's row is a widening for older builds too.

import type { languageEnglish } from '../../../lang/en'
import type { Chat, character } from '../../storage/database.svelte'
import type { RisuModule } from '../../process/modules'

export type StringKeyOf<T> = { [K in keyof T]: T[K] extends string ? K : never }[keyof T] & string

export type Holder = 'character' | 'chat' | 'module'

// The persisted facts of a path: frozen by the append-only guard.
export interface FieldFacts {
    value: 'text' | 'bool'
    // The builtin owner kinds whose set row and restore row hold the path, and whose writers write it.
    holders: readonly Holder[]
    // What a builtin-holder writer does with `{ had: false }`: leave the key or delete it.
    absent: 'keep' | 'delete'
    // False: an edit whose live value is absent is refused `precondition` (an undo could not put the key back).
    editWhenAbsent: boolean
    // The holder property; absent means the path itself.
    property?: string
}

export interface FieldPresentation {
    labelKey: StringKeyOf<typeof languageEnglish>
    // Where focus goes after a history action changed the path: the two special first message and example list
    // targets, an element named by its form and part, or nothing.
    focus: 'firstMessage' | 'example' | { form: string; part: string } | null
}

export const FIELD_SPECS = {
    desc: { value: 'text', holders: ['character'], absent: 'keep', editWhenAbsent: true },
    firstMessage: { value: 'text', holders: ['character'], absent: 'keep', editWhenAbsent: false },
    exampleMessage: { value: 'text', holders: ['character'], absent: 'keep', editWhenAbsent: false },
    customModuleToggle: { value: 'text', holders: ['character', 'module'], absent: 'delete', editWhenAbsent: true },
    hideChatIcon: { value: 'bool', holders: ['character'], absent: 'delete', editWhenAbsent: true },
    risutanium_render_when_complete: { value: 'bool', holders: ['character'], absent: 'delete', editWhenAbsent: true },
    note: { value: 'text', holders: ['chat'], absent: 'keep', editWhenAbsent: true },
} as const satisfies Record<string, FieldFacts>

export type SetPath = keyof typeof FIELD_SPECS

export const FIELD_PRESENTATION: { readonly [P in SetPath]: FieldPresentation } = {
    desc: { labelKey: 'description', focus: { form: 'studio-character-form', part: 'studio-form-desc' } },
    firstMessage: { labelKey: 'firstMessage', focus: 'firstMessage' },
    exampleMessage: { labelKey: 'exampleMessage', focus: 'example' },
    customModuleToggle: { labelKey: 'customPromptTemplateToggle', focus: null },
    hideChatIcon: { labelKey: 'hideChatIcon', focus: { form: 'studio-character-form', part: 'studio-form-hide-icon' } },
    risutanium_render_when_complete: { labelKey: 'studioFormRenderWhenComplete', focus: { form: 'studio-character-form', part: 'studio-form-render-when-complete' } },
    note: { labelKey: 'note', focus: { form: 'studio-chat-note-form', part: 'studio-form-note' } },
}

// Compile-time check: every registered path's holder property (`property`, else the path) is a key of each listed
// holder's type, so a typo or a wrong holder fails `pnpm check` before it can write a stray key onto a character,
// chat or module.
interface HolderTypes {
    character: character
    chat: Chat
    module: RisuModule
}
type PropertyName<P extends SetPath> = (typeof FIELD_SPECS)[P] extends { readonly property: infer Q extends string } ? Q : P
type MissingHolderProperty = {
    [P in SetPath]: {
        [H in (typeof FIELD_SPECS)[P]['holders'][number]]: PropertyName<P> extends keyof HolderTypes[H] ? never : P
    }[(typeof FIELD_SPECS)[P]['holders'][number]]
}[SetPath]
export const HOLDER_PROPERTIES_EXIST: [MissingHolderProperty] extends [never] ? true : never = true
