// @vitest-environment happy-dom

/**
 * `visibleModes` and `hideUnusedModes` in a loaded database. Both are
 * profile-wide config fields (CHORE-584): `setDatabase` must leave every
 * database with a valid set and a boolean, and must never rewrite the remembered
 * set because hiding is off.
 *
 * This drives the REAL `setDatabase`/`getDatabase`
 * (`src/ts/storage/database.svelte.ts`) with the module mocks of
 * `databaseSupaModelType.test.ts`, none of them touching either field.
 *
 * Labels in the titles:
 * - `reproducer`: fails on a base whose `setDatabase` does not handle the fields.
 * - `guard`: holds with and without the handling.
 */

import { describe, expect, test, vi } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

//#region module mocks

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/util'), () => ({
    checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
    decryptBuffer: vi.fn(async (d: unknown) => d),
    encryptBuffer: vi.fn(async (d: unknown) => d),
    selectSingleFile: vi.fn(async () => null),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    downloadFile: vi.fn(async () => {}),
    saveAsset: vi.fn(async () => ''),
    forageStorage: {
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => {}),
    },
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/alert'), () => ({
    alertNormal: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/gui/colorscheme'), () => ({
    defaultColorScheme: { bgcolor: '#000000' },
}) as unknown as typeof import('src/ts/gui/colorscheme'))

vi.mock(import('src/ts/process/memory/hypav3'), () => ({
    createHypaV3Preset: vi.fn((name: string, settings: unknown) => ({ name, settings })),
}) as unknown as typeof import('src/ts/process/memory/hypav3'))

vi.mock(import('src/ts/translator/presets'), () => ({
    normalizeTranslatorPresetState: vi.fn(),
}) as unknown as typeof import('src/ts/translator/presets'))

vi.mock(import('src/ts/polyfill'), () => ({
    safeStructuredClone: vi.fn((v: unknown) => JSON.parse(JSON.stringify(v))),
}) as unknown as typeof import('src/ts/polyfill'))

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(async () => {}),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(async () => {}),
    readFile: vi.fn(async () => new Uint8Array()),
    BaseDirectory: { AppData: 0 },
}))

// A plain mutable object is enough for `setDatabaseLite`'s `DBState.db = data`
// assignment and `getDatabase()`'s read; no component reactivity is exercised.
vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: {} as unknown as Record<string, unknown> },
    selectedCharID: { subscribe: vi.fn(), set: vi.fn() },
}) as unknown as typeof import('src/ts/stores.svelte'))

// The enums live in the light `model/types.ts`; the real list pulls in the
// provider and plugin graph.
vi.mock(import('src/ts/model/modellist'), async () => {
    const types = await import('src/ts/model/types')
    return {
        LLMFlags: types.LLMFlags,
        LLMFormat: types.LLMFormat,
        LLMTokenizer: types.LLMTokenizer,
    }
})

vi.mock('src/ts/rpack/rpack_js.js', () => ({
    encodeRPack: vi.fn(async (data: Uint8Array) => data),
    decodeRPack: vi.fn(async (data: Uint8Array) => data),
}))

//#endregion

import { setDatabase, getDatabase, type Database } from 'src/ts/storage/database.svelte'
import { decodeRisuSave } from 'src/ts/storage/risuSave'

const ALL_MODES = ['rp', 'hybrid', 'utility']

function loadWith(fields: Record<string, unknown>): Database {
    setDatabase({ pluginCustomStorage: {}, ...fields } as unknown as Database)
    return getDatabase()
}

describe('setDatabase visibleModes and hideUnusedModes', () => {
    test('reproducer: a database without either field loads the defaults', () => {
        const db = loadWith({})
        expect(db.visibleModes).toEqual(ALL_MODES)
        expect(db.hideUnusedModes).toBe(false)
    })

    test.each([
        ['an empty array', []],
        ['an array with no valid token', ['bogus']],
        ['a string', 'rp'],
        ['null', null],
        ['a number', 2],
    ])('reproducer: %s loads as all three modes', (_label, stored) => {
        expect(loadWith({ visibleModes: stored }).visibleModes).toEqual(ALL_MODES)
    })

    test('reproducer: unknown tokens and duplicates are dropped and the order is canonical', () => {
        expect(loadWith({ visibleModes: ['utility', 'rp', 'rp', 'x'] }).visibleModes).toEqual(['rp', 'utility'])
    })

    test.each([
        ['the string yes', 'yes'],
        ['one', 1],
        ['null', null],
        ['the string true', 'true'],
    ])('reproducer: %s loads as hideUnusedModes false', (_label, stored) => {
        expect(loadWith({ hideUnusedModes: stored }).hideUnusedModes).toBe(false)
    })

    test('guard: the boolean true is kept', () => {
        expect(loadWith({ hideUnusedModes: true }).hideUnusedModes).toBe(true)
    })

    // The remembered set must survive a load while hiding is off (DS-170), on every pass of the funnel.
    test('guard: a remembered set with hiding off is kept by a load, a second load and a reload of the live database', () => {
        expect(loadWith({ visibleModes: ['hybrid'], hideUnusedModes: false }).visibleModes).toEqual(['hybrid'])
        expect(loadWith({ visibleModes: ['hybrid'], hideUnusedModes: false }).visibleModes).toEqual(['hybrid'])
        setDatabase(getDatabase())
        const db = getDatabase()
        expect(db.visibleModes).toEqual(['hybrid'])
        expect(db.hideUnusedModes).toBe(false)
    })

    test('guard: a remembered set with hiding on is kept', () => {
        const db = loadWith({ visibleModes: ['rp', 'utility'], hideUnusedModes: true })
        expect(db.visibleModes).toEqual(['rp', 'utility'])
        expect(db.hideUnusedModes).toBe(true)
    })
})

describe('restore of a database written by an upstream build', () => {
    const GOLDEN_DIR = path.resolve(process.env.BIN_GOLDENS_DIR ?? path.join(process.cwd(), 'src/ts/drive/tests/binGoldens'))

    /** The entries of a container: a name length, the name, a data length and the data, each length 32 bits little-endian. */
    function databaseEntryOf(bytes: Uint8Array): Uint8Array {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        const decoder = new TextDecoder()
        let offset = 0
        while (offset + 4 <= bytes.length) {
            const nameLength = view.getUint32(offset, true)
            offset += 4
            const name = decoder.decode(bytes.subarray(offset, offset + nameLength))
            offset += nameLength
            const dataLength = view.getUint32(offset, true)
            offset += 4
            if (name === 'database.risudat') {
                return bytes.slice(offset, offset + dataLength)
            }
            offset += dataLength
        }
        throw new Error('the golden has no database entry')
    }

    // upstream-full.bin is real upstream writer output: its root has neither key, so the restore must supply the defaults.
    test('reproducer: the root of upstream-full.bin lacks both fields and the restore loads the defaults', async () => {
        const bytes = new Uint8Array(fs.readFileSync(path.join(GOLDEN_DIR, 'upstream-full.bin')))
        const decoded = await decodeRisuSave(databaseEntryOf(bytes)) as unknown as Record<string, unknown>
        expect('visibleModes' in decoded).toBe(false)
        expect('hideUnusedModes' in decoded).toBe(false)

        setDatabase(decoded as unknown as Database)
        const db = getDatabase()
        expect(db.visibleModes).toEqual(ALL_MODES)
        expect(db.hideUnusedModes).toBe(false)
    })
})
