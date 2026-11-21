/**
 * The Data page data: the section order, that a moved row is the legacy object, that the action items name real
 * English labels, and that every row id is answered by the section lookup.
 *
 * No application module is mocked: the data imports only the legacy Accessibility and Advanced lists.
 */
import { describe, expect, test, vi } from 'vitest'
import type { SettingContext } from './types'

const offer = vi.hoisted(() => ({ cleanUp: true }))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))
vi.mock('src/ts/storage/cleanUpUnusedFiles', () => ({ cleanUpOfferedFor: () => offer.cleanUp }))

import { languageEnglish } from 'src/lang/en'
import { accessibilitySettingsItems } from './accessibilitySettingsData'
import { advancedSettingsItems } from './advancedSettingsData'
import {
    DATA_ACTION_ITEMS,
    DATA_SHELL_SECTIONS,
    dataActionItem,
    dataSectionOfRow,
    dataShellItems,
    dataShellRowIds,
} from './dataShellSettingsData'

const english = languageEnglish as unknown as Record<string, unknown>

describe('Data page sections', () => {
    test('the three groups come in the specified order, none collapsed or gated, with English labels', () => {
        expect(DATA_SHELL_SECTIONS.map((section) => section.id)).toEqual(['data.backup', 'data.transfer', 'data.storage'])
        for (const section of DATA_SHELL_SECTIONS) {
            expect(section.collapsed, section.id).toBe(false)
            expect(section.when, section.id).toBeUndefined()
            expect(typeof english[section.labelKey], section.id).toBe('string')
        }
    })

    test('the rows come in the specified order and every one is found by the section lookup', () => {
        expect(dataShellRowIds()).toEqual([
            'data.backup', 'data.restoreFile', 'data.restoreSnapshot', 'data.dataset', 'data.cleanUp', 'acc.goCharacterOnImport', 'adv.coldstorage',
        ])
        expect(dataSectionOfRow('data.cleanUp')).toBe('data.transfer')
        expect(dataSectionOfRow('data.restoreSnapshot')).toBe('data.backup')
        expect(dataSectionOfRow('acc.goCharacterOnImport')).toBe('data.transfer')
        expect(dataSectionOfRow('adv.coldstorage')).toBe('data.storage')
        expect(dataSectionOfRow('adv.genTime')).toBeNull()
    })
})

describe('Data page rows', () => {
    test('S1-G2: the two moved rows are the legacy objects', () => {
        expect(dataShellItems.find((item) => item.id === 'acc.goCharacterOnImport')).toBe(
            accessibilitySettingsItems.find((item) => item.id === 'acc.goCharacterOnImport'),
        )
        expect(dataShellItems.find((item) => item.id === 'adv.coldstorage')).toBe(
            advancedSettingsItems.find((item) => item.id === 'adv.coldstorage'),
        )
    })

    test('the clean-up row and its search item share one offer rule, so a hidden row is not a search hit', () => {
        const ctx = {} as unknown as SettingContext
        const row = DATA_SHELL_SECTIONS.flatMap((section) => section.rows).find((candidate) => candidate.kind !== 'setting' && candidate.id === 'data.cleanUp')
        const item = dataActionItem('data.cleanUp')
        expect(row?.kind).toBe('shell')
        const rowCondition = row?.kind === 'shell' ? row.condition : undefined
        for (const offered of [true, false]) {
            offer.cleanUp = offered
            expect(rowCondition?.(ctx), `row ${offered}`).toBe(offered)
            expect(item.condition?.(ctx), `item ${offered}`).toBe(offered)
        }
        offer.cleanUp = true
    })

    test('the five action items are buttons with a keyword list and an English label', () => {
        expect(DATA_ACTION_ITEMS.map((item) => item.id)).toEqual(['data.backup', 'data.restoreFile', 'data.restoreSnapshot', 'data.dataset', 'data.cleanUp'])
        for (const item of DATA_ACTION_ITEMS) {
            expect(item.type, item.id).toBe('button')
            expect(item.keywords?.length, item.id).toBeGreaterThan(0)
            expect(typeof english[item.labelKey ?? ''], item.id).toBe('string')
            expect(english[item.labelKey ?? ''], item.id).not.toBe('')
        }
        expect(dataActionItem('data.restoreFile').keywords).toContain('restore')
        expect(() => dataActionItem('data.nope')).toThrow()
    })
})
