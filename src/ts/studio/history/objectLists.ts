// The per-list tables of the object-list op family (`objInsert`, `objRemove`, `objSet`, `propSet`): which owner
// property holds each list, which fields a list's `objSet` may change and of which kind, how an entry is identified,
// what its anchor leaves out, and the keys of its history messages. Pure data with no imports but types, and every
// table is keyed by list name, so a test can replace this module and spread a probe list into each table. Every
// list-dependent rule (totality, field kinds, kind acceptance, journal lines, mixed revert, session holders, unknown
// names) reads these tables and nothing else; adding a list is one row in each table.

export type ObjFieldKind = 'text' | 'number' | 'bool' | 'object' | 'numberOrNull'

export interface ObjListFieldsRow {
    // Every field accepts `{ had: false }` on either side; a present value must fit the kind.
    readonly fields: Readonly<Record<string, ObjFieldKind>>
    // Label fields that are not settable.
    readonly labelOnly: readonly string[]
    // `field` is refused on an entry whose `whenField` is `equals`.
    readonly refused: readonly { readonly field: string; readonly whenField: string; readonly equals: string }[]
}

export interface ObjIdentityRow {
    // The key holding a non-empty string id.
    readonly id: string | null
    readonly folder: { readonly whenField: string; readonly equals: string; readonly key: string } | null
    // Rows holding neither identity are identified by their content.
    readonly content: boolean
}

export type ObjHolderRow = Partial<Record<'character' | 'chat' | 'module', string>>

export interface ObjPropRow {
    readonly holders: readonly ('character' | 'chat' | 'module')[]
    // The list whose visit journal and restore line the property joins.
    readonly journal: string
}

export const OBJ_LIST_HOLDERS = {
    lore: { character: 'globalLore', chat: 'localLore', module: 'lorebook' },
} as const satisfies Record<string, ObjHolderRow>

export const OBJ_LIST_FIELDS = {
    lore: {
        fields: {
            comment: 'text',
            key: 'text',
            secondkey: 'text',
            content: 'text',
            insertorder: 'number',
            alwaysActive: 'bool',
            selective: 'bool',
            useRegex: 'bool',
            extentions: 'object',
            activationPercent: 'numberOrNull',
            folder: 'text',
        },
        labelOnly: ['probability'],
        refused: [{ field: 'key', whenField: 'mode', equals: 'folder' }],
    },
} as const satisfies Record<string, ObjListFieldsRow>

// The settable lore fields. Append-only: a record written with a field must stay readable. `id`, `mode` and
// `bookVersion` are never settable (a changed id is a remove and an insert).
export const LORE_FIELDS = OBJ_LIST_FIELDS.lore.fields

export const OBJ_LIST_IDENTITY = {
    lore: { id: 'id', folder: { whenField: 'mode', equals: 'folder', key: 'key' }, content: true },
} as const satisfies Record<string, ObjIdentityRow>

// Top-level keys the anchor and the content identity leave out.
export const OBJ_LIST_ANCHOR_EXCLUDED = { lore: ['bookVersion'] } as const satisfies Record<string, readonly string[]>

// A `textEdit` target under this prefix belongs to the list (the mixed-revert refusal).
export const OBJ_LIST_ASSET_PREFIX = { lore: 'lore/' } as const satisfies Record<string, string>

// Plain strings in S7-0; the list UI narrows the type to the language keys when it adds them.
export const OBJ_LIST_MESSAGES = {
    lore: {
        line: 'studioLoreRestoreLine',
        changed: 'studioLoreRestoreChanged',
        earlierVisit: 'studioLoreRestoreEarlierVisit',
        idTaken: 'studioLoreRestoreIdTaken',
        mixed: 'studioLoreRevertMixed',
    },
} as const satisfies Record<string, Readonly<Record<'line' | 'changed' | 'earlierVisit' | 'idTaken' | 'mixed', string>>>

export const OBJ_PROPS = {
    loreSettings: { holders: ['character'], journal: 'lore' },
    loreExt: { holders: ['character'], journal: 'lore' },
} as const satisfies Record<string, ObjPropRow>

export type ObjListName = keyof typeof OBJ_LIST_FIELDS
export type PropName = keyof typeof OBJ_PROPS
