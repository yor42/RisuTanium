// TM1: the object-list wording resolves to the English text of `en.ts`, and the refusal mapping routes each rule to its
// own sentence. The component tests (restore sheet, History panel) pin where the text is shown.
import { describe, expect, test } from 'vitest'
import { language } from '../../../../lang'
import { OBJ_LIST_MESSAGES } from '../../history/objectLists'
import type { ObjDeletedItem, ObjLabel } from '../../history/objectListOps'
import { LORE_SCAN_DECORATORS } from '../../../process/loreScanDecorators'
import {
    loreDecoratorCopy,
    loreStepText,
    objItemPreview,
    objListChanged,
    objListEarlierVisit,
    objListIdTaken,
    objListLine,
    objListMixed,
    objRefusalText,
    regexStepText,
} from '../objListCopy'

describe('the message table resolves to language keys', () => {
    test('every key the table names exists in the language', () => {
        for (const key of Object.values(OBJ_LIST_MESSAGES.lore)) {
            expect(language[key]).toBeDefined()
        }
    })

    test('the restore line counts one change or several, and the notes are the plain sentences', () => {
        expect(objListLine('lore', 1)).toBe('Lorebook: undo 1 change')
        expect(objListLine('lore', 4)).toBe('Lorebook: undo 4 changes')
        expect(objListChanged('lore')).toBe(language.studioLoreRestoreChanged)
        expect(objListEarlierVisit('lore')).toBe(language.studioLoreRestoreEarlierVisit)
        expect(objListIdTaken('lore')).toBe(language.studioLoreRestoreIdTaken)
        expect(objListMixed('lore')).toBe(language.studioLoreRevertMixed)
    })
})

describe('objRefusalText', () => {
    test('idTaken and mixed have their own sentence; changed and no list rule fall back to the precondition text', () => {
        expect(objRefusalText({ obj: { list: 'lore', kind: 'idTaken' } })).toBe(language.studioLoreRestoreIdTaken)
        expect(objRefusalText({ obj: { list: 'lore', kind: 'mixed' } })).toBe(language.studioLoreRevertMixed)
        expect(objRefusalText({ obj: { list: 'lore', kind: 'changed' } })).toBeNull()
        expect(objRefusalText({})).toBeNull()
    })
})

describe('loreStepText', () => {
    const label = (action: ObjLabel['action'], name: string | null, extra: Partial<ObjLabel> = {}): ObjLabel => ({ kind: 'obj', list: 'lore', action, name, ...extra })

    test('each action reads as its own sentence, with the name', () => {
        expect(loreStepText(label('add', 'Dragon'))).toBe('Added "Dragon"')
        expect(loreStepText(label('delete', 'Dragon', { count: 1 }))).toBe('Deleted "Dragon"')
        expect(loreStepText(label('move', 'Dragon'))).toBe('Moved "Dragon"')
        expect(loreStepText(label('duplicate', 'Dragon'))).toBe('Duplicated "Dragon"')
        expect(loreStepText(label('newId', 'Dragon'))).toBe('Gave "Dragon" a new ID')
        expect(loreStepText(label('link', 'Dragon'))).toBe('Made "Dragon" always active in this chat')
        expect(loreStepText(label('unlink', 'Dragon'))).toBe('Stopped "Dragon" being always active in this chat')
        expect(loreStepText(label('edit', 'Dragon', { field: 'probability' }))).toBe('Changed the probability of "Dragon"')
        expect(loreStepText(label('edit', 'Dragon', { field: 'comment' }))).toBe(`Changed ${language.name} of "Dragon"`)
        expect(loreStepText(label('edit', 'Dragon', { field: 'activationPercent' }))).toBe(`Changed ${language.studioLoreLegacyProbabilityLabel} of "Dragon"`)
        expect(loreStepText(label('folderCreate', 'Lairs'))).toBe('Added folder "Lairs"')
        expect(loreStepText(label('folderRename', 'Lairs'))).toBe('Renamed folder to "Lairs"')
        expect(loreStepText(label('folderActive', 'Lairs'))).toBe('Changed always active of folder "Lairs"')
        expect(loreStepText(label('bulkActive', null, { count: 3 }))).toBe('Changed always active of 3 entries')
        expect(loreStepText(label('bulkActive', null, { count: 1 }))).toBe('Changed always active of 1 entry')
        expect(loreStepText(label('import', null, { count: 2 }))).toBe('Imported 2 entries')
    })

    test('a folder delete says how many items went with it', () => {
        expect(loreStepText(label('folderDelete', 'Lairs', { count: 0 }))).toBe('Deleted folder "Lairs"')
        expect(loreStepText(label('folderDelete', 'Lairs', { count: 1 }))).toBe('Deleted folder "Lairs" and 1 item in it')
        expect(loreStepText(label('folderDelete', 'Lairs', { count: 5 }))).toBe('Deleted folder "Lairs" and 5 items in it')
    })

    test('an unnamed step shows what it is; a settings step shows the settings text', () => {
        expect(loreStepText(label('add', null))).toBe(`Added "${language.sidebarUi.unnamedLore}"`)
        expect(loreStepText(label('folderCreate', null))).toBe(`Added folder "${language.sidebarUi.unnamedFolder}"`)
        expect(loreStepText({ kind: 'prop', prop: 'loreSettings' })).toBe(language.studioLoreStepSettings)
    })
})

describe('objItemPreview', () => {
    const item = (entries: Record<string, unknown>[]): ObjDeletedItem => ({
        id: 'd1',
        at: 0,
        list: 'lore',
        entries: entries.map((entry, index) => ({ index, entry: entry as ObjDeletedItem['entries'][number]['entry'], counts: {} })),
    })

    test('the deleted entry, and how many more went with it', () => {
        expect(objItemPreview(item([{ comment: 'Dragon', mode: 'normal' }]))).toBe('Dragon')
        expect(objItemPreview(item([{ comment: 'Lairs', key: 'K', mode: 'folder' }, { comment: 'Dragon', mode: 'normal' }, { comment: 'Cave', mode: 'normal' }]))).toBe('Lairs and 2 more')
    })

    test('the folder is the subject even when a child row comes first; an unnamed row shows what it is', () => {
        expect(objItemPreview(item([{ comment: 'Dragon', mode: 'normal' }, { comment: 'Lairs', key: 'K', mode: 'folder' }]))).toBe('Lairs and 1 more')
        expect(objItemPreview(item([{ comment: '', key: '', mode: 'normal' }]))).toBe(language.sidebarUi.unnamedLore)
    })
})

describe('regex step and deleted-item text', () => {
    const label = (action: ObjLabel extends { action: infer A } ? A : never, name: string | null): ObjLabel => ({ kind: 'obj', list: 'regex', action, name })

    test('each list action names the script; an unnamed one shows the unnamed fallback', () => {
        expect(regexStepText(label('add', 'Alpha'))).toBe(language.studioRegexStepAdd('Alpha'))
        expect(regexStepText(label('delete', 'Alpha'))).toBe(language.studioRegexStepDelete('Alpha'))
        expect(regexStepText(label('move', 'Alpha'))).toBe(language.studioRegexStepMove('Alpha'))
        expect(regexStepText(label('duplicate', null))).toBe(language.studioRegexStepDuplicate(language.sidebarUi.unnamedScript))
        expect(regexStepText(label('add', 'Alpha'))).not.toBe(regexStepText(label('delete', 'Alpha')))
    })

    test('a deleted regex row previews as its name, else the unnamed script; an unreadable one says so', () => {
        const item = (entry: Record<string, unknown>): ObjDeletedItem => ({ id: 'd1', at: 0, list: 'regex', entries: [{ index: 0, entry: entry as ObjDeletedItem['entries'][number]['entry'], counts: {} }] })
        expect(objItemPreview(item({ comment: 'Alpha', in: '', out: '', type: 'editinput' }))).toBe('Alpha')
        expect(objItemPreview(item({ comment: '', in: '', out: '', type: 'editinput' }))).toBe(language.sidebarUi.unnamedScript)
        expect(objItemPreview(item({ in: '', out: '', type: 'editinput' }))).toContain(language.studioRegexWhyField('comment'))
        expect(objItemPreview(item({ comment: 'Beta', in: 5, out: '', type: 'editinput' }))).toBe(`Beta: ${language.studioRegexUnreadable(language.studioRegexWhyField('in'))}`)
    })
})

describe('loreDecoratorCopy', () => {
    test('every scan decorator has a help line and the picker count reads singular and plural', () => {
        const copy = loreDecoratorCopy()
        for (const name of LORE_SCAN_DECORATORS) {
            expect(copy.help(name).length).toBeGreaterThan(0)
        }
        expect(copy.matches(1)).toBe('1 decorator')
        expect(copy.matches(4)).toBe('4 decorators')
        expect(copy.unknown('foo')).toBe('@@foo isn\'t a decorator this app knows. It\'s ignored.')
        expect(copy.listLabel()).toBe(language.studioLoreDecoListLabel)
    })
})
