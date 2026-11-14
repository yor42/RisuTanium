/**
 * The Input page data: the section order, that a plain row is the legacy object, that an override keeps everything
 * but the label, and that the page and the sidebar picker still agree on the legacy ids.
 *
 * No application module is mocked: the data imports only the legacy Accessibility list.
 */
import { describe, expect, test } from 'vitest'
import { languageEnglish } from 'src/lang/en'
import { accessibilitySettingsItems } from './accessibilitySettingsData'
import {
    INPUT_NOT_OFFERED_IDS,
    INPUT_SHELL_SECTIONS,
    inputSectionOfRow,
    inputShellItems,
    inputShellRowIds,
} from './inputShellSettingsData'
import { rowIdsOf } from './shellSections'

const english = languageEnglish as unknown as Record<string, unknown>

function legacy(id: string) {
    const found = accessibilitySettingsItems.find((item) => item.id === id)
    if (!found) throw new Error(`no legacy item ${id}`)
    return found
}

describe('Input page sections', () => {
    test('the nine groups come in the specified order with English labels', () => {
        expect(INPUT_SHELL_SECTIONS.map((section) => section.id)).toEqual([
            'input.send', 'input.edit', 'input.scroll', 'input.gestures', 'input.menu',
            'input.confirm', 'input.a11y', 'input.other', 'input.preview',
        ])
        for (const section of INPUT_SHELL_SECTIONS) {
            expect(typeof english[section.labelKey], section.id).toBe('string')
            expect(english[section.labelKey], section.id).not.toBe('')
        }
    })

    test('the preview and switch group is last, never collapsed, and its rows have no condition', () => {
        const last = INPUT_SHELL_SECTIONS[INPUT_SHELL_SECTIONS.length - 1]
        expect(last.id).toBe('input.preview')
        expect(last.collapsed).toBe(false)
        expect(last.when).toBeUndefined()
        expect(last.rows.map((row) => rowIdsOf(row)[0])).toEqual(['acc.chatShellPreview', 'acc.settingsShellPreview', 'acc.studio'])
        for (const row of last.rows) {
            expect(row.kind).toBe('setting')
            if (row.kind === 'setting') {
                expect(row.item.condition).toBeUndefined()
                expect(row.item).toBe(legacy(row.item.id))
            }
        }
    })

    test('no section is collapsed', () => {
        expect(INPUT_SHELL_SECTIONS.every((section) => !section.collapsed)).toBe(true)
    })

    test('a jump row opens Display and every label and hint key is a non-empty English string', () => {
        const jumps = INPUT_SHELL_SECTIONS.flatMap((section) => section.rows).filter((row) => row.kind === 'jump')
        expect(jumps.map((row) => row.id)).toEqual(['input.easyContrast', 'input.easySize', 'input.easyInput'])
        for (const row of INPUT_SHELL_SECTIONS.flatMap((section) => section.rows)) {
            const keys: Array<string | undefined> = []
            if (row.kind === 'jump') {
                expect(row.index).toBe(3)
                keys.push(row.labelKey, row.hintKey)
            } else if (row.kind === 'setting') {
                keys.push(row.item.labelKey, row.hintKey, row.touchNoteKey)
            }
            for (const key of keys) {
                if (key === undefined) continue
                expect(typeof english[key], key).toBe('string')
                expect(english[key], key).not.toBe('')
            }
        }
    })
})

describe('Input page rows', () => {
    test('a row without a new label is the legacy object', () => {
        for (const id of ['acc.customSidebarConfig', 'acc.goCharacterOnImport', 'acc.bulkEnabling', 'acc.chatShellPreview']) {
            const row = INPUT_SHELL_SECTIONS.flatMap((section) => section.rows).find((candidate) => rowIdsOf(candidate).includes(id))
            expect(row?.kind, id).toBe('setting')
            if (row?.kind === 'setting') expect(row.item, id).toBe(legacy(id))
        }
    })

    test('an override changes only the label of the legacy item', () => {
        for (const item of inputShellItems) {
            const base = legacy(item.id)
            if (item === base) continue
            expect({ ...item, labelKey: base.labelKey }, item.id).toEqual(base)
            expect(item.labelKey, item.id).not.toBe(base.labelKey)
            expect(item.bindKey, item.id).toBe(base.bindKey)
            expect(item.type, item.id).toBe(base.type)
            expect(item.condition, item.id).toBe(base.condition)
        }
    })

    test('the instantRemove row reads the renamed label with its hint', () => {
        const item = inputShellItems.find((candidate) => candidate.id === 'acc.instantRemove')
        expect(item?.labelKey).toBe('settingsShellInputInstantRemove')
        expect(english.settingsShellInputInstantRemove).toBe('Ask what to delete')
    })

    test('the new-message picker row keeps the legacy condition and the hover-only row has a touch note', () => {
        const row = INPUT_SHELL_SECTIONS.flatMap((section) => section.rows).find((candidate) => candidate.kind === 'shell')
        expect(row?.kind).toBe('shell')
        if (row?.kind === 'shell') {
            expect(row.id).toBe('acc.newMessageButtonStyle')
            expect(row.condition).toBe(legacy('acc.newMessageButtonStyle').condition)
        }
        const hover = INPUT_SHELL_SECTIONS.flatMap((section) => section.rows).find((candidate) => rowIdsOf(candidate).includes('acc.enableBlockPartialEdit'))
        expect(hover?.kind === 'setting' ? hover.touchNoteKey : undefined).toBe('settingsShellInputBlockEditTouch')
    })

    test('Display stays out of this page: menuSideBar and the not-offered header are on no Input row', () => {
        const ids = inputShellRowIds()
        expect(ids).not.toContain('display.menuSideBar')
        for (const id of INPUT_NOT_OFFERED_IDS) expect(ids).not.toContain(id)
    })

    test('the section lookup names the holding group', () => {
        expect(inputSectionOfRow('acc.sendWithEnter')).toBe('input.send')
        expect(inputSectionOfRow('acc.bulkEnabling')).toBe('input.other')
        expect(inputSectionOfRow('nope')).toBeNull()
    })
})
