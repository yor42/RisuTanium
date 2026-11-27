/**
 * The two DeepL key items of the language settings are followed by a "connection used" row of their own slot,
 * under the same condition as the key item. Drives the REAL
 * `languageSettingsItems`. The row has no `labelKey`, which keeps it out of settings search.
 */
import { describe, expect, test, vi } from 'vitest'

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/util'), () => ({
    sleep: vi.fn(async () => {}),
    selectFileByDom: vi.fn(),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/alert'), () => ({
    alertSelect: vi.fn(),
    alertNormal: vi.fn(),
    alertClear: vi.fn(),
    alertConfirm: vi.fn(),
    alertError: vi.fn(),
    alertWait: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/globalApi.svelte'), () => new Proxy({ downloadFile: vi.fn() } as Record<string, unknown>, {
    get: (target, key) => (key in target ? target[key as string] : key === 'then' ? undefined : vi.fn()),
    has: () => true,
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/translator/translator'), () => ({
    exportLLMCacheAsJSON: vi.fn(),
    importLLMCacheFromJSON: vi.fn(),
    clearLLMCache: vi.fn(),
}) as unknown as typeof import('src/ts/translator/translator'))

vi.mock(import('src/ts/characters'), () => ({
    getCharImage: vi.fn(async () => ''),
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: {} },
    selIdState: { selId: 0 },
}) as unknown as typeof import('src/ts/stores.svelte'))

import { languageSettingsItems } from './languageSettingsData.svelte'
import { getSettingValue, setSettingValue } from './utils'
import { DBState } from '../stores.svelte'
import type { Database } from '../storage/database.svelte'
import type { SettingContext } from './types'

const ctxFor = (translatorType: string) => ({ db: { translator: 'ko', translatorType } }) as unknown as Parameters<NonNullable<typeof languageSettingsItems[number]['condition']>>[0]

describe('language settings service rows', () => {
    test.each([
        { keyId: 'lang.deeplKey', rowId: 'lang.deeplConnection', service: 'deeplOptions.key', type: 'deepl', other: 'deeplX' },
        { keyId: 'lang.deeplXToken', rowId: 'lang.deeplXConnection', service: 'deeplXOptions.token', type: 'deeplX', other: 'deepl' },
    ])('$rowId follows $keyId with its slot and condition and no label', ({ keyId, rowId, service, type, other }) => {
        const keyIndex = languageSettingsItems.findIndex((item) => item.id === keyId)
        const row = languageSettingsItems.find((item) => item.id === rowId)
        expect(keyIndex).toBeGreaterThanOrEqual(0)
        expect(row).toMatchObject({ type: 'custom', componentId: 'ServiceConnectionRow', componentProps: { service } })
        expect(row && 'labelKey' in row ? row.labelKey : undefined).toBeUndefined()
        const keyItem = languageSettingsItems[keyIndex]
        // Only the free-form `bindPath` items sit between the key and its row; nothing reorders them apart.
        expect(languageSettingsItems.indexOf(row!)).toBeGreaterThan(keyIndex)
        expect(row!.condition?.(ctxFor(type))).toBe(true)
        expect(row!.condition?.(ctxFor(other))).toBe(false)
        expect(keyItem.condition?.(ctxFor(type))).toBe(true)
    })
})

describe('language settings DeepL key editors', () => {
    test.each([
        { id: 'lang.deeplKey', provider: 'deepl', legacy: 'deeplOptions', field: 'key' },
        { id: 'lang.deeplXToken', provider: 'deeplx', legacy: 'deeplXOptions', field: 'token' },
    ])('$id writes the key into a $provider connection and not into the legacy field', async ({ id, provider, legacy, field }) => {
        DBState.db = {
            deeplOptions: { key: '', freeApi: true },
            deeplXOptions: { url: 'http://localhost:1188', token: '' },
        } as unknown as Database
        const item = languageSettingsItems.find((candidate) => candidate.id === id)!
        const ctx = { db: DBState.db } as unknown as SettingContext

        setSettingValue(item, 'SYN-dl', ctx)
        await vi.waitFor(() => expect(DBState.db.connections).toEqual([expect.objectContaining({ provider, key: 'SYN-dl' })]))

        const legacyValue = (DBState.db as unknown as Record<string, Record<string, unknown>>)[legacy][field]
        expect(legacyValue).toBe('')
        expect(getSettingValue(item, ctx)).toBe('SYN-dl')
    })
})