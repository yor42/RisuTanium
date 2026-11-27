// The tables of the group session kind: key parsing, the set and list rows, the registry row of the order flag, the
// per-kind rules and the compatibility guards the new kind must not disturb (stored keys, frozen S7 records).
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { language } from 'src/lang'
import { FIELD_PRESENTATION, FIELD_SPECS } from '../fieldRegistry'
import { holdsObjList, isOpAllowedFor, parseOwnerRecord, RESTORE_PATHS_BY_KIND, SET_PATHS_BY_KIND, type Op } from '../historyModel'
import {
    OBJ_LIST_ANCHOR_EXCLUDED,
    OBJ_LIST_ASSET_PREFIX,
    OBJ_LIST_FIELDS,
    OBJ_LIST_HOLDERS,
    OBJ_LIST_IDENTITY,
    OBJ_LIST_MESSAGES,
} from '../objectLists'
import { boundCharacterHides, hasChatNote } from '../ownerKindRules'
import { characterOwnerKey, chatOwnerKey, groupOwnerKey, isStoredOwnerKey, moduleOwnerKey, parseOwnerKey, parseSessionOwnerKey, parseStoredOwnerKey } from '../ownerPhase'
import { SESSION_OWNER_KINDS } from '../sessionKinds'

const insertOp: Op = { op: 'objInsert', list: 'members', index: 0, entry: { chaId: 'X', talk: 0.5, active: true }, counts: { id: 1 } }
const removeOp: Op = { op: 'objRemove', list: 'members', index: 0, entry: { chaId: 'X', talk: 0.5, active: true }, counts: { id: 1 } }
const setOp: Op = {
    op: 'objSet',
    list: 'members',
    index: 0,
    field: 'talk',
    before: { had: true, value: 0.5 },
    after: { had: true, value: 0.25 },
    anchorBefore: 1,
    anchorAfter: 2,
}

describe('T4: the group kind is a session kind with its own rows', () => {
    test('a group key parses as a session key and never as a stored key', () => {
        expect(parseOwnerKey('group:X')).toEqual({ kind: 'group', id: 'X' })
        expect(parseSessionOwnerKey('group:X')).toEqual({ kind: 'group', id: 'X' })
        expect(parseStoredOwnerKey('group:X')).toBeNull()
        expect(isStoredOwnerKey('group:X')).toBe(false)
        expect(groupOwnerKey('X')).toBe('group:X')
        expect(parseOwnerKey('group:')).toBeNull()
    })

    test('the set and restore rows are the name and the order flag', () => {
        expect(SET_PATHS_BY_KIND.group).toEqual(['name', 'orderByOrder'])
        expect(RESTORE_PATHS_BY_KIND.group).toEqual(['name', 'orderByOrder'])
        expect(SESSION_OWNER_KINDS.group.objLists).toEqual(['members'])
    })

    test('only the group holds the members list', () => {
        expect(holdsObjList('group', 'members')).toBe(true)
        for (const kind of ['character', 'chat', 'module', 'preset'] as const) {
            expect(holdsObjList(kind, 'members'), kind).toBe(false)
        }
        expect(holdsObjList('group', 'lore')).toBe(false)
    })

    test('a members op is allowed for a group and for no stored kind', () => {
        for (const op of [insertOp, removeOp, setOp]) {
            expect(isOpAllowedFor('group', op), op.op).toBe(true)
            expect(isOpAllowedFor('character', op), op.op).toBe(false)
            expect(isOpAllowedFor('chat', op), op.op).toBe(false)
            expect(isOpAllowedFor('module', op), op.op).toBe(false)
        }
    })

    test('the members row of every list table', () => {
        expect(OBJ_LIST_HOLDERS.members).toEqual({})
        expect(OBJ_LIST_FIELDS.members).toEqual({ fields: { talk: 'number', active: 'bool' }, labelOnly: [], refused: [] })
        expect(OBJ_LIST_IDENTITY.members).toEqual({ id: 'chaId', folder: null, content: false })
        expect(OBJ_LIST_ANCHOR_EXCLUDED.members).toEqual([])
        expect(OBJ_LIST_ASSET_PREFIX.members).toBe('members/')
        expect(OBJ_LIST_MESSAGES.members).toEqual({
            line: 'studioMembersRestoreLine',
            changed: 'studioMembersRestoreChanged',
            earlierVisit: 'studioMembersRestoreEarlierVisit',
            idTaken: 'studioMembersRestoreIdTaken',
            mixed: 'studioMembersRevertMixed',
        })
        // The character id is never settable: a changed member is a remove and an insert.
        expect(Object.keys(OBJ_LIST_FIELDS.members.fields)).not.toContain('chaId')
    })
})

describe('T28: the per-kind rules answer for the group', () => {
    test('a bound character does not hide a group history, and a group restore point has no chat note', () => {
        const parsed = parseOwnerKey(groupOwnerKey('X'))
        expect(boundCharacterHides(parsed)).toBe(false)
        expect(hasChatNote(parsed)).toBe(false)
        // The stored kinds keep their answers.
        expect(boundCharacterHides(parseOwnerKey(characterOwnerKey('X')))).toBe(true)
        expect(boundCharacterHides(parseOwnerKey(chatOwnerKey('X', 'c')))).toBe(true)
        expect(boundCharacterHides(parseOwnerKey(moduleOwnerKey('X')))).toBe(false)
        expect(hasChatNote(parseOwnerKey(characterOwnerKey('X')))).toBe(true)
    })
})

describe('T29: the order flag row', () => {
    test('is a session-only boolean that deletes when absent and is editable when absent', () => {
        expect(FIELD_SPECS.orderByOrder).toEqual({ value: 'bool', holders: [], absent: 'delete', editWhenAbsent: true })
        for (const kind of ['character', 'chat', 'module'] as const) {
            expect(SET_PATHS_BY_KIND[kind], kind).not.toContain('orderByOrder')
        }
    })

    test('has a presentation whose label is an existing language key', () => {
        const presentation = FIELD_PRESENTATION.orderByOrder
        expect(presentation.labelKey).toBe('orderByOrder')
        expect(typeof language[presentation.labelKey]).toBe('string')
    })
})

describe('T26: compatibility guards (pass before and after the change)', () => {
    test('the committed S7 records still parse for their stored owners', () => {
        const committed: Record<string, unknown> = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 's7Records.json'), 'utf8'))
        const keys = { character: characterOwnerKey('A'), chat: chatOwnerKey('A', 'c1'), module: moduleOwnerKey('M1') }
        for (const [kind, key] of Object.entries(keys)) {
            expect(parseOwnerRecord(committed[kind], key), kind).not.toBeNull()
        }
    })

    test('a group key is not a stored key', () => {
        expect(parseStoredOwnerKey('group:x')).toBeNull()
    })
})
