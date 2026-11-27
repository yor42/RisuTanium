// The words of the group member steps and of the members restore line: every key the tables name exists in the English
// table with the shape the caller uses, and the step text carries the member's name.
import { describe, expect, test } from 'vitest'
import { languageEnglish } from 'src/lang/en'
import { OBJ_LIST_MESSAGES } from '../../history/objectLists'
import type { ObjLabel } from '../../history/objectListOps'
import { memberStepText, objListChanged, objListEarlierVisit, objListIdTaken, objListLine, objListMixed } from '../objListCopy'

const label = (action: ObjLabel['action'], name: string | null, field?: string): ObjLabel => ({ kind: 'obj', list: 'members', action, name, ...(field === undefined ? {} : { field }) })

describe('T28: member step text', () => {
    test('add, remove, talk and active each name the member', () => {
        expect(memberStepText(label('add', 'Aria'))).toBe(languageEnglish.studioMembersStepAdd('Aria'))
        expect(memberStepText(label('delete', 'Aria'))).toBe(languageEnglish.studioMembersStepRemove('Aria'))
        expect(memberStepText(label('edit', 'Aria', 'talk'))).toBe(languageEnglish.studioMembersStepTalk('Aria'))
        expect(memberStepText(label('edit', 'Aria', 'active'))).toBe(languageEnglish.studioMembersStepActive('Aria'))
        for (const action of ['add', 'delete'] as const) {
            expect(memberStepText(label(action, 'Aria'))).toContain('"Aria"')
        }
        expect(memberStepText(label('edit', 'Aria', 'talk'))).toContain('"Aria"')
        expect(memberStepText(label('edit', 'Aria', 'active'))).toContain('"Aria"')
    })

    test('the four steps read differently from one another', () => {
        const texts = [label('add', 'A'), label('delete', 'A'), label('edit', 'A', 'talk'), label('edit', 'A', 'active')].map(memberStepText)
        expect(new Set(texts).size).toBe(4)
    })

    test('a member without a name reads as the missing-member label', () => {
        expect(memberStepText(label('delete', null))).toBe(languageEnglish.studioMembersStepRemove(languageEnglish.studioGroupMemberMissing))
    })
})

describe('T28: members restore copy', () => {
    test('every message key of the members list is a real en.ts key of the right shape', () => {
        const keys = OBJ_LIST_MESSAGES.members
        expect(typeof languageEnglish[keys.line]).toBe('function')
        for (const key of [keys.changed, keys.earlierVisit, keys.idTaken, keys.mixed]) {
            expect(typeof languageEnglish[key]).toBe('string')
            expect(languageEnglish[key].length).toBeGreaterThan(0)
        }
    })

    test('the restore line counts its changes', () => {
        expect(objListLine('members', 1)).toBe(languageEnglish.studioMembersRestoreLine(1))
        expect(objListLine('members', 3)).toContain('3')
        expect(objListLine('members', 1)).not.toContain('1 changes')
        expect(objListLine('members', 2)).not.toBe(objListLine('members', 1))
    })

    test('the notes are the members ones, not the lorebook ones', () => {
        expect(objListChanged('members')).toBe(languageEnglish.studioMembersRestoreChanged)
        expect(objListEarlierVisit('members')).toBe(languageEnglish.studioMembersRestoreEarlierVisit)
        expect(objListIdTaken('members')).toBe(languageEnglish.studioMembersRestoreIdTaken)
        expect(objListMixed('members')).toBe(languageEnglish.studioMembersRevertMixed)
        expect(objListChanged('members')).not.toBe(objListChanged('lore'))
    })

    test('the form strings exist', () => {
        for (const key of ['studioOwnerRoleGroup', 'studioGroupMemberArchived', 'studioGroupMemberMissing', 'studioGroupMembersMismatch'] as const) {
            expect(languageEnglish[key].length).toBeGreaterThan(0)
        }
    })
})
