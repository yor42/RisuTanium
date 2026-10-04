// @vitest-environment happy-dom

/**
 * Two things around environment-variable references in secret fields, both
 * driven against the REAL `database.svelte.ts` (the module mocks below cover
 * only its other imports, none of them secret-related):
 *
 * - completeness: every string field of a default `Database` (and of the
 *   preset template) whose path looks like a credential is listed in
 *   `SECRET_FIELDS`, either resolved or excluded with a reason;
 * - preset import: `importPreset` blanks a whole-field reference in
 *   `openAIKey` and `proxyKey`, so an imported file never carries a
 *   reference that would pick up the importing user's environment.
 */

import { beforeEach, describe, expect, test, vi } from 'vitest'

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

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: {} as unknown as Record<string, unknown> },
    selectedCharID: { subscribe: vi.fn(), set: vi.fn() },
}) as unknown as typeof import('src/ts/stores.svelte'))

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

import { DBState } from 'src/ts/stores.svelte'
import { getDatabase, importPreset, presetTemplate, setDatabase, type Database } from 'src/ts/storage/database.svelte'
import { SECRET_FIELDS, secretFieldPath, type SecretFieldEntry } from 'src/ts/secretFields'

const CREDENTIAL_LOOKING = /key|token|secret|password/i

interface Leaf {
    scope: SecretFieldEntry['scope']
    path: string
}

/** Every string leaf, as `scope` + dotted path with `[n]` for array indices. */
function walkStrings(value: unknown, path: string, out: { path: string, value: string }[]) {
    if (typeof value === 'string') {
        out.push({ path, value })
    }
    else if (Array.isArray(value)) {
        value.forEach((item, i) => walkStrings(item, `${path}[${i}]`, out))
    }
    else if (value !== null && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) {
            walkStrings(child, path === '' ? key : `${path}.${key}`, out)
        }
    }
    return out
}

function entryMatcher(entry: SecretFieldEntry): RegExp {
    const escaped = secretFieldPath(entry)
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\\\[\\\*\\\]/g, '\\.[^.]+')
        .replace(/\\\[\\\]/g, '\\[\\d+\\]')
    return new RegExp(`^${escaped}$`)
}

function toLeaf(path: string): Leaf {
    const presetPrefix = /^botPresets\[\d+\]\./
    if (presetPrefix.test(path)) {
        return { scope: 'botPreset', path: path.replace(presetPrefix, '') }
    }
    return { scope: 'database', path }
}

function isListed(leaf: Leaf): boolean {
    return SECRET_FIELDS.some((entry) => entry.scope === leaf.scope && entryMatcher(entry).test(leaf.path))
}

beforeEach(() => {
    localStorage.clear()
})

describe('SECRET_FIELDS completeness', () => {
    function defaultLeaves() {
        setDatabase({ pluginCustomStorage: {} } as unknown as Database)
        const db = getDatabase() as unknown as Record<string, unknown>
        // Dynamic-path containers are empty in a fresh database; give them one entry each so
        // their paths are walked.
        db.OaiCompAPIKeys = { 'my-model': 'x' }
        db.customModels = [{ id: 'm', key: 'k', name: 'n' }]
        db.authRefreshes = [{ url: 'u', tokenUrl: 't', refreshToken: 'r', clientId: 'c', clientSecret: 's' }]
        return [
            ...walkStrings(db, '', []),
            ...walkStrings(presetTemplate, 'botPresets[0]', []),
        ]
    }

    test('every credential-looking string field of a default database and the preset template is listed', () => {
        const unlisted = defaultLeaves()
            .filter((leaf) => CREDENTIAL_LOOKING.test(leaf.path))
            .map((leaf) => toLeaf(leaf.path))
            .filter((leaf) => !isListed(leaf))
            .map((leaf) => `${leaf.scope}:${leaf.path}`)
        expect([...new Set(unlisted)]).toEqual([])
    })

    test('the walk reaches the dynamic-path fields, so their entries are exercised', () => {
        const paths = defaultLeaves().map((leaf) => leaf.path)
        expect(paths).toContain('OaiCompAPIKeys.my-model')
        expect(paths).toContain('customModels[0].key')
        expect(paths).toContain('botPresets[0].openAIKey')
    })

    test('every excluded entry states a reason, and every resolved entry names its reader and a stage', () => {
        for (const entry of SECRET_FIELDS as readonly SecretFieldEntry[]) {
            if (entry.class === 'excluded') {
                expect(entry.reason.length, secretFieldPath(entry)).toBeGreaterThan(10)
            }
            else {
                expect(entry.reader.length, secretFieldPath(entry)).toBeGreaterThan(0)
                expect([1, 2]).toContain(entry.stage)
            }
        }
    })

    test('no field path is listed twice', () => {
        const keys = (SECRET_FIELDS as readonly SecretFieldEntry[]).map((entry) => `${entry.scope}:${secretFieldPath(entry)}`)
        expect(new Set(keys).size).toBe(keys.length)
    })
})

describe('importPreset blanks whole-field references', () => {
    function presetFile(fields: Record<string, unknown>) {
        return {
            name: 'shared.json',
            data: new TextEncoder().encode(JSON.stringify({ name: 'Shared', ...fields })),
        }
    }

    beforeEach(() => {
        DBState.db = { botPresets: [] } as unknown as typeof DBState.db
    })

    test('a json preset with reference openAIKey and proxyKey is imported blank', async () => {
        await importPreset(presetFile({ openAIKey: '${RISU_X_KEY}', proxyKey: ' ${RISU_Y_TOKEN} ' }))
        const [imported] = DBState.db.botPresets
        expect(imported.name).toBe('Shared')
        expect(imported.openAIKey).toBe('')
        expect(imported.proxyKey).toBe('')
    })

    test('guard: plain keys are kept as written', async () => {
        await importPreset(presetFile({ openAIKey: 'sk-plain-openai', proxyKey: 'sk-plain-proxy' }))
        const [imported] = DBState.db.botPresets
        expect(imported.openAIKey).toBe('sk-plain-openai')
        expect(imported.proxyKey).toBe('sk-plain-proxy')
    })

    test('guard: a lowercase look-alike and a reference inside a longer value are kept', async () => {
        await importPreset(presetFile({ openAIKey: '${risu_x_key}', proxyKey: 'prefix-${RISU_Y_KEY}' }))
        const [imported] = DBState.db.botPresets
        expect(imported.openAIKey).toBe('${risu_x_key}')
        expect(imported.proxyKey).toBe('prefix-${RISU_Y_KEY}')
    })

    test('guard: a preset file without key fields imports with the template defaults', async () => {
        await importPreset(presetFile({}))
        const [imported] = DBState.db.botPresets
        expect(imported.openAIKey).toBe('')
        expect(imported.proxyKey).toBe('')
    })
})
