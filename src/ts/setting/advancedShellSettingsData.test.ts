/**
 * The Advanced page data: the section order, the two gated sections, that a plain row is the legacy object, that an
 * override changes only labels, and that the streaming row is not offered.
 *
 * MOCKED: the platform module (the Advanced list reads it for its conditions). The data is real.
 */
import { describe, expect, test, vi } from 'vitest'

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))

import { languageEnglish } from 'src/lang/en'
import type { Database } from 'src/ts/storage/database.svelte'
import { accessibilitySettingsItems } from './accessibilitySettingsData'
import { advancedSettingsItems } from './advancedSettingsData'
import {
    ADVANCED_NOT_OFFERED_IDS,
    ADVANCED_SHELL_SECTIONS,
    advancedSectionOfRow,
    advancedShellItems,
    advancedShellRowIds,
    unplacedLegacyAdvancedIds,
} from './advancedShellSettingsData'
import { rowIdsOf } from './shellSections'
import type { SettingContext } from './types'

const english = languageEnglish as unknown as Record<string, unknown>

function legacy(id: string) {
    const found = advancedSettingsItems.find((item) => item.id === id)
    if (!found) throw new Error(`no legacy item ${id}`)
    return found
}

function section(id: string) {
    const found = ADVANCED_SHELL_SECTIONS.find((candidate) => candidate.id === id)
    if (!found) throw new Error(`no section ${id}`)
    return found
}

function ctxWith(db: Partial<Database>): SettingContext {
    return { db: db as Database, modelInfo: {} as SettingContext['modelInfo'], subModelInfo: {} as SettingContext['subModelInfo'] }
}

describe('Advanced page sections', () => {
    test('the groups come in the specified order', () => {
        expect(ADVANCED_SHELL_SECTIONS.map((candidate) => candidate.id)).toEqual([
            'adv.request', 'adv.lorebook', 'adv.chatload', 'adv.display', 'adv.prompt', 'adv.trouble',
            'adv.gates', 'adv.experimental', 'adv.unrecommended', 'adv.custom', 'adv.other',
        ])
        for (const candidate of ADVANCED_SHELL_SECTIONS) {
            expect(typeof english[candidate.labelKey], candidate.id).toBe('string')
        }
    })

    test('only the two gated sections are collapsed, and each reads its own flag', () => {
        expect(ADVANCED_SHELL_SECTIONS.filter((candidate) => candidate.collapsed).map((candidate) => candidate.id)).toEqual([
            'adv.experimental', 'adv.unrecommended',
        ])
        const experimental = section('adv.experimental')
        const unrecommended = section('adv.unrecommended')
        expect(experimental.when?.({ useExperimental: true, showUnrecommended: false } as Database)).toBe(true)
        expect(experimental.when?.({ useExperimental: false, showUnrecommended: true } as Database)).toBe(false)
        expect(unrecommended.when?.({ useExperimental: false, showUnrecommended: true } as Database)).toBe(true)
        expect(unrecommended.when?.({ useExperimental: true, showUnrecommended: false } as Database)).toBe(false)
        for (const candidate of ADVANCED_SHELL_SECTIONS) {
            if (!candidate.collapsed) expect(candidate.when, candidate.id).toBeUndefined()
        }
    })

    test('the streaming row, the title and the red warning are not placed', () => {
        const ids = advancedShellRowIds()
        for (const id of ADVANCED_NOT_OFFERED_IDS) expect(ids).not.toContain(id)
        expect(ids).not.toContain('adv.streamingDisplayOpt')
        expect(unplacedLegacyAdvancedIds()).toEqual([])
    })

    test('the request info row sits in Troubleshooting and the Pro Tools link opens Input', () => {
        expect(advancedSectionOfRow('acc.requestInfoInsideChat')).toBe('adv.trouble')
        const link = section('adv.gates').rows.find((row) => row.kind === 'jump')
        expect(link?.kind === 'jump' ? link.index : undefined).toBe(11)
    })
})

describe('Advanced page rows', () => {
    test('rows kept as they are are the legacy objects', () => {
        for (const id of ['adv.coldstorage', 'adv.export', 'adv.banChar', 'adv.customModels', 'adv.emoPrompt', 'adv.retries']) {
            const row = ADVANCED_SHELL_SECTIONS.flatMap((candidate) => candidate.rows).find((candidate) => rowIdsOf(candidate).includes(id))
            expect(row?.kind, id).toBe('setting')
            if (row?.kind === 'setting') expect(row.item, id).toBe(legacy(id))
        }
    })

    test('an override changes only labels: bindings, conditions and numeric bounds are the legacy ones', () => {
        const base = new Map([...advancedSettingsItems, ...accessibilitySettingsItems].map((item) => [item.id, item]))
        for (const item of advancedShellItems) {
            const original = base.get(item.id)
            expect(original, item.id).toBeDefined()
            if (!original || item === original) continue
            expect(item.type, item.id).toBe(original.type)
            expect(item.bindKey, item.id).toBe(original.bindKey)
            expect(item.getValue, item.id).toBe(original.getValue)
            expect(item.setValue, item.id).toBe(original.setValue)
            expect(item.componentId, item.id).toBe(original.componentId)
            expect(item.options?.min, item.id).toBe(original.options?.min)
            expect(item.options?.max, item.id).toBe(original.options?.max)
            if (item.id !== 'adv.legacyMedia') expect(item.condition, item.id).toBe(original.condition)
        }
    })

    test('genTime keeps the legacy bounds 0 to 4096', () => {
        const item = advancedShellItems.find((candidate) => candidate.id === 'adv.genTime')
        expect(item?.options).toEqual(legacy('adv.genTime').options)
        expect(item?.options?.min).toBe(0)
        expect(item?.options?.max).toBe(4096)
    })

    test('the old media finder follows the unrecommended gate while the legacy row does not', () => {
        const item = advancedShellItems.find((candidate) => candidate.id === 'adv.legacyMedia')
        expect(item?.condition?.(ctxWith({ showUnrecommended: true }))).toBe(true)
        expect(item?.condition?.(ctxWith({ showUnrecommended: false }))).toBe(false)
        expect(legacy('adv.legacyMedia').condition).toBeUndefined()
    })

    test('the height mode keeps its six stored values under plain-words labels', () => {
        const item = advancedShellItems.find((candidate) => candidate.id === 'adv.heightMode')
        expect(item?.options?.selectOptions?.map((option) => option.value)).toEqual(['normal', 'percent', 'vh', 'dvh', 'svh', 'lvh'])
        for (const option of item?.options?.selectOptions ?? []) {
            expect(typeof english[option.labelKey ?? ''], option.value).toBe('string')
        }
    })

    test('the shared gated hints and every label and hint key are non-empty English strings', () => {
        for (const row of ADVANCED_SHELL_SECTIONS.flatMap((candidate) => candidate.rows)) {
            const keys: Array<string | undefined> = row.kind === 'setting' ? [row.item.labelKey, row.hintKey] : row.kind === 'jump' ? [row.labelKey, row.hintKey] : []
            for (const key of keys) {
                if (key === undefined) continue
                expect(typeof english[key], key).toBe('string')
                expect(english[key], key).not.toBe('')
            }
        }
    })
})
