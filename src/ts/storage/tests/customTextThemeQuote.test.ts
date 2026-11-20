// @vitest-environment happy-dom

/**
 * `setDatabase` normalizes the Custom text theme quotes on load. A null or absent quote is stored
 * as null ("follow the scheme"), never as a colour; a stored string is kept as it is. Real
 * `setDatabase`, mocked stores as in the colour scheme seed test.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: {} },
    selectedCharID: writable(-1),
    selIdState: { selId: -1 },
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    downloadFile: vi.fn(),
    saveAsset: vi.fn(),
    readImage: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

import { setDatabase, type Database } from '../database.svelte'
import { DBState } from '../../stores.svelte'

const COLOURS = {
    FontColorStandard: '#111111',
    FontColorItalic: '#222222',
    FontColorBold: '#333333',
    FontColorItalicBold: '#444444',
}

function baseDatabase(extra: Record<string, unknown>): Database {
    return {
        characters: [],
        botPresets: [],
        botPresetsId: -1,
        personas: [],
        selectedPersona: 0,
        enabledModules: [],
        globalChatVariables: {},
        ...extra,
    } as unknown as Database
}

beforeEach(() => {
    DBState.db = {} as unknown as Database
})

describe('custom text theme quote normalization', () => {
    test('ST-1: null quotes stay null', () => {
        setDatabase(baseDatabase({
            customTextTheme: { ...COLOURS, FontColorQuote1: null, FontColorQuote2: null },
        }))
        expect(DBState.db.customTextTheme.FontColorQuote1).toBeNull()
        expect(DBState.db.customTextTheme.FontColorQuote2).toBeNull()
    })

    test('ST-1: absent quote keys are stored as null, never undefined and never a colour', () => {
        setDatabase(baseDatabase({ customTextTheme: { ...COLOURS } }))
        expect(DBState.db.customTextTheme.FontColorQuote1).toBeNull()
        expect(DBState.db.customTextTheme.FontColorQuote2).toBeNull()
    })

    test('ST-2 (passes before and after): string quotes survive unchanged', () => {
        setDatabase(baseDatabase({
            customTextTheme: { ...COLOURS, FontColorQuote1: '#8BE9FD', FontColorQuote2: '#123456' },
        }))
        expect(DBState.db.customTextTheme.FontColorQuote1).toBe('#8BE9FD')
        expect(DBState.db.customTextTheme.FontColorQuote2).toBe('#123456')
    })

    test('ST-2 (passes before and after): a missing customTextTheme still gets the dark default strings', () => {
        setDatabase(baseDatabase({}))
        expect(DBState.db.customTextTheme.FontColorQuote1).toBe('#8BE9FD')
        expect(DBState.db.customTextTheme.FontColorQuote2).toBe('#FFB86C')
    })
})
