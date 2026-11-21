// @vitest-environment happy-dom

/**
 * Three things: two around environment-variable references in secret fields,
 * and one about preset destinations, all
 * driven against the REAL `database.svelte.ts` (the module mocks below cover
 * only its other imports, none of them secret-related):
 *
 * - completeness: every string field of a default `Database` (and of the
 *   preset template) whose path looks like a credential is listed in
 *   `SECRET_FIELDS`, either resolved or excluded with a reason;
 * - preset import: `importPreset` blanks a whole-field reference in
 *   `openAIKey` and `proxyKey`, so an imported file never carries a
 *   reference that would pick up the importing user's environment;
 * - preset destinations: `importPreset` blanks the four destination URL fields,
 *   removes `koboldURL` and stores non-string keys as '', whatever the preset's
 *   models or format.
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
import { downloadFile } from 'src/ts/globalApi.svelte'
import { alertNormal } from 'src/ts/alert'
import { downloadNotice } from 'src/ts/exportNotice'
import { language } from 'src/lang'
import { changeToPreset, downloadPreset, getDatabase, importPreset, presetFromWorkingSettings, presetTemplate, setDatabase, type Database } from 'src/ts/storage/database.svelte'
import { decode as decodeMsgpack, encode as encodeMsgpack } from 'msgpackr/index-no-eval'
import * as fflate from 'fflate'
import { SECRET_FIELDS, secretFieldPath, type SecretFieldEntry } from 'src/ts/secretFields'
import { isNotCredential, missingSentinels, sentinelObject, sentinelsIn } from 'src/ts/storage/tests/shareStripFixture'

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
        db.connections = [{ id: 'conn-1', name: 'n', provider: 'openai', key: 'k' }]
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
        expect(paths).toContain('connections[0].key')
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

    /** The key of the connection an imported preset references, or undefined when it references none. */
    const referencedKey = (preset: { proxyConnectionId?: string }) =>
        DBState.db.connections?.find((conn) => conn.id === preset.proxyConnectionId)?.key

    test('a plain proxy key moves into the store with an empty URL, and a plain OpenAI key is dropped', async () => {
        await importPreset(presetFile({ openAIKey: 'sk-plain-openai', proxyKey: 'sk-plain-proxy' }))
        const [imported] = DBState.db.botPresets
        expect(imported.openAIKey).toBe('')
        expect(imported.proxyKey).toBe('')
        expect(referencedKey(imported)).toBe('sk-plain-proxy')
    })

    test('a lowercase look-alike and a reference inside a longer value are stored as written', async () => {
        await importPreset(presetFile({ openAIKey: '${risu_x_key}', proxyKey: 'prefix-${RISU_Y_KEY}' }))
        const [imported] = DBState.db.botPresets
        expect(imported.openAIKey).toBe('')
        expect(referencedKey(imported)).toBe('prefix-${RISU_Y_KEY}')
    })

    test('guard: a preset file without key fields imports with the template defaults', async () => {
        await importPreset(presetFile({}))
        const [imported] = DBState.db.botPresets
        expect(imported.openAIKey).toBe('')
        expect(imported.proxyKey).toBe('')
    })

    // The fixture is what downloadPreset writes: the preset template with the keys edited, pretty-printed.
    function producedPreset(keys: { openAIKey: string, proxyKey: string }) {
        return {
            name: 'shared.json',
            data: new TextEncoder().encode(JSON.stringify({ ...presetTemplate, name: 'Shared', ...keys }, null, 2)),
        }
    }

    test('a field with a reference on any line is imported blank (LF, CRLF, either position)', async () => {
        await importPreset(producedPreset({ openAIKey: '${RISU_A_KEY}\nsk-test-B', proxyKey: 'sk-test-A\r\n${RISU_A_KEY}' }))
        const [imported] = DBState.db.botPresets
        expect(imported.openAIKey).toBe('')
        expect(imported.proxyKey).toBe('')
    })

    test('a reference after a lone CR is blanked, since a lone CR separates keys', async () => {
        await importPreset(producedPreset({ openAIKey: 'sk-test-A\r${RISU_A_KEY}', proxyKey: 'sk-test-B' }))
        const [imported] = DBState.db.botPresets
        expect(imported.openAIKey).toBe('')
        expect(referencedKey(imported)).toBe('sk-test-B')
    })

    test('a whole reference is blanked and a plain multi-line key list is stored as written', async () => {
        await importPreset(producedPreset({ openAIKey: '${RISU_A_KEY}', proxyKey: 'sk-test-A\nsk-test-B' }))
        const [imported] = DBState.db.botPresets
        expect(imported.openAIKey).toBe('')
        expect(referencedKey(imported)).toBe('sk-test-A\nsk-test-B')
    })
})

describe('importPreset never lets a preset choose where stored secrets are sent', () => {
    type Loose = Record<string, unknown>

    // The user's working settings: their own keys, headers and destinations.
    function userDb(extra: Loose = {}): Loose {
        return {
            botPresets: [], botPresetsId: -1, NAIsettings: {},
            proxyKey: 'sk-user-proxy', forceReplaceUrl: 'https://user-proxy.test/v1',
            google: { accessToken: 'user-gemini-key' }, mancerHeader: 'user-mancer-key',
            textgenWebUIBlockingURL: 'https://user-ooba.test/api/', textgenWebUIStreamURL: 'wss://user-ooba.test/api/',
            koboldURL: 'http://user-kobold.test/api/v1', openAIKey: 'sk-user-openai',
            additionalParams: [['header::Authorization', 'Bearer user-proxy-secret']],
            ooba: {}, ainconfig: {}, reverseProxyOobaArgs: { mode: 'instruct' }, promptSettings: { assistantPrefill: '' },
            customAPIFormat: 0, customFlags: [], seperateModels: { memory: '', emotion: '', translate: '', otherAx: '' },
            fallbackModels: { memory: [], emotion: [], translate: [], otherAx: [], model: [] }, seperateParameters: null,
            modelTools: [], presetRegex: [], promptTemplate: null, mainPrompt: 'm', jailbreak: 'j', formatingOrder: [], aiModel: 'gpt-x',
            apiType: 'x', temperature: 80, maxContext: 4000, maxResponse: 300, frequencyPenalty: 70, PresensePenalty: 70,
            ...extra,
        }
    }

    // A real export: what `presetFromWorkingSettings` produces with the six fields `downloadPreset` blanks.
    function exportedBase(): Loose {
        const exported = presetFromWorkingSettings(userDb() as unknown as Database, 'Shared', '') as unknown as Loose
        for (const field of ['openAIKey', 'forceReplaceUrl', 'forceReplaceUrl2', 'proxyKey', 'textgenWebUIStreamURL', 'textgenWebUIBlockingURL']) {
            exported[field] = ''
        }
        return exported
    }

    const asJson = (o: unknown) => new TextEncoder().encode(JSON.stringify(o, null, 2))
    const asRisupreset = (o: unknown) => fflate.compressSync(encodeMsgpack({ presetVersion: 2, type: 'preset', preset: encodeMsgpack(o) }))
    const working = () => DBState.db as unknown as Loose

    /** Selecting an imported preset leaves the working proxy empty: no reference, and nothing of the attacker's pair. */
    function expectNoImportedProxy() {
        expect(working().proxyConnectionId).toBe('')
        expect(String(working().forceReplaceUrl)).not.toContain('attacker')
    }

    async function importFile(name: string, data: Uint8Array): Promise<Loose> {
        await importPreset({ name, data })
        const list = DBState.db.botPresets as unknown as Loose[]
        return list[list.length - 1]
    }

    beforeEach(() => {
        DBState.db = userDb() as unknown as typeof DBState.db
        vi.mocked(downloadFile).mockClear()
    })

    const attackerA1 = () => ({
        ...exportedBase(), aiModel: 'reverse_proxy', forceReplaceUrl: 'https://attacker.test/v1',
        forceReplaceUrl2: 'https://attacker2.test/v1', proxyKey: null,
    })

    test('T1 json: attacker proxy URLs are blanked and select keeps nothing of them', async () => {
        const stored = await importFile('shared.json', asJson(attackerA1()))
        expect(stored.forceReplaceUrl2).toBe('')
        changeToPreset(0)
        expectNoImportedProxy()
        expect(stored.forceReplaceUrl).toBe('')
        expect(stored.proxyKey).toBe('')
    })

    test('T2 risupreset wrapper', async () => {
        await importFile('imported.risupreset', asRisupreset(attackerA1()))
        changeToPreset(0)
        expectNoImportedProxy()
    })

    test('T3 risup wrapper', async () => {
        await importFile('p.risup', asRisupreset(attackerA1()))
        changeToPreset(0)
        expectNoImportedProxy()
    })

    test('T4 Google format with a blank proxy key', async () => {
        await importFile('g.json', asJson({
            ...exportedBase(), aiModel: 'reverse_proxy', customAPIFormat: 5,
            forceReplaceUrl: 'https://attacker.test/v1beta', proxyKey: '',
        }))
        changeToPreset(0)
        expectNoImportedProxy()
    })

    test('T5 mancer textgen URLs', async () => {
        await importFile('m.json', asJson({
            ...exportedBase(), aiModel: 'mancer',
            textgenWebUIBlockingURL: 'https://attacker.test/api/', textgenWebUIStreamURL: 'wss://attacker.test/api/',
        }))
        changeToPreset(0)
        expect(working().textgenWebUIBlockingURL).toBe('')
        expect(working().textgenWebUIStreamURL).toBe('')
    })

    test('T6 non-string keys are stored blank', async () => {
        const stored = await importFile('k.json', asJson({ ...exportedBase(), openAIKey: 7, proxyKey: null }))
        expect(stored.openAIKey).toBe('')
        expect(stored.proxyKey).toBe('')
    })

    test('T7 reverse_proxy with the Kobold format keeps the user Kobold URL', async () => {
        const stored = await importFile('kf.json', asJson({
            ...exportedBase(), aiModel: 'reverse_proxy', customAPIFormat: 14, koboldURL: 'http://attacker-kobold.test/api/v1',
        }))
        expect(stored.koboldURL).toBeUndefined()
        changeToPreset(0)
        expect(working().customAPIFormat).toBe(14)
        expect(working().koboldURL).toBe('http://user-kobold.test/api/v1')
    })

    test('T8 risupreset with the Kobold format keeps the user Kobold URL', async () => {
        await importFile('imported.risupreset', asRisupreset({
            ...exportedBase(), aiModel: 'reverse_proxy', customAPIFormat: 14, koboldURL: 'http://attacker-kobold.test/api/v1',
        }))
        changeToPreset(0)
        expect(working().koboldURL).toBe('http://user-kobold.test/api/v1')
    })

    test('T9 a reverse_proxy sub-model under a non-proxy main model', async () => {
        await importFile('sub.json', asJson({
            ...exportedBase(), aiModel: 'gpt-x', subModel: 'reverse_proxy', forceReplaceUrl: 'https://attacker.test/v1',
        }))
        changeToPreset(0)
        expect(working().subModel).toBe('reverse_proxy')
        expectNoImportedProxy()
    })

    test('T10 native kobold model with an attacker koboldURL', async () => {
        DBState.db = userDb({ applyAdditionalParamsToAll: true }) as unknown as typeof DBState.db
        const stored = await importFile('nk.json', asJson({
            ...exportedBase(), aiModel: 'kobold', koboldURL: 'http://attacker-kobold.test/api/v1',
        }))
        changeToPreset(0)
        expect(working().koboldURL).toBe('http://user-kobold.test/api/v1')
        expect(stored.koboldURL).toBeUndefined()
    })

    // The rule must not depend on the preset's models or format: every shape, including one whose
    // models consume none of the fields, ends up with the same stored destinations.
    const attackAll = {
        forceReplaceUrl: 'https://attacker.test/v1', forceReplaceUrl2: 'https://attacker2.test/v1',
        textgenWebUIStreamURL: 'wss://attacker.test/api/', textgenWebUIBlockingURL: 'https://attacker.test/api/',
        koboldURL: 'http://attacker-kobold.test/api/v1', proxyKey: null,
    }
    const shapes: [string, Loose][] = [
        ['a reverse_proxy with the Kobold format', { aiModel: 'reverse_proxy', customAPIFormat: 14 }],
        ['b inert: no model consumes a destination field', { aiModel: 'gpt-x', subModel: 'gpt-x', customAPIFormat: 0 }],
        ['c native kobold', { aiModel: 'kobold' }],
        ['d sub-model reverse_proxy', { aiModel: 'gpt-x', subModel: 'reverse_proxy' }],
        ['e separate model for memory', {
            aiModel: 'gpt-x', seperateModelsForAxModels: true,
            seperateModels: { memory: 'reverse_proxy', emotion: '', translate: '', otherAx: '' },
        }],
        ['f fallback model', {
            aiModel: 'gpt-x',
            fallbackModels: { memory: [], emotion: [], translate: [], otherAx: [], model: ['reverse_proxy'] },
        }],
        ['g mancer', { aiModel: 'mancer' }],
    ]

    test.each(shapes)('T11 row %s', async (_label, shape) => {
        const stored = await importFile('t11.json', asJson({ ...exportedBase(), ...attackAll, ...shape }))
        expect(stored.forceReplaceUrl).toBe('')
        expect(stored.forceReplaceUrl2).toBe('')
        expect(stored.textgenWebUIStreamURL).toBe('')
        expect(stored.textgenWebUIBlockingURL).toBe('')
        expect(stored.koboldURL).toBeUndefined()
        expect(stored.proxyKey).toBe('')
    })

    // Round trip: an upstream or fork export imports unchanged except for the dropped `koboldURL`.
    function sourceDb(): Loose {
        return userDb({
            botPresetsId: 0, botPresets: [{ name: 'Src' }], mainPrompt: 'custom main', temperature: 55, top_k: 40,
            presetRegex: [{ comment: 'r', in: 'a', out: 'b', type: 'editinput' }], koboldURL: 'http://src-kobold.test/api/v1',
            proxyKey: 'sk-src', forceReplaceUrl: 'https://src.test/v1',
        })
    }

    function expectImportsAsExported(stored: Loose, exported: Loose) {
        for (const key of Object.keys(exported)) {
            if (key !== 'koboldURL') {
                expect(stored[key], key).toEqual(exported[key])
            }
        }
        for (const key of Object.keys(presetTemplate)) {
            if (!(key in exported)) {
                expect(stored[key], key).toEqual((presetTemplate as unknown as Loose)[key])
            }
        }
    }

    test('G1 guard: a json export imports equal on every key except koboldURL', async () => {
        DBState.db = sourceDb() as unknown as typeof DBState.db
        await downloadPreset(0, 'json')
        const bytes = vi.mocked(downloadFile).mock.calls[0][1] as Uint8Array
        const exported = JSON.parse(Buffer.from(bytes).toString('utf-8')) as Loose
        DBState.db = userDb() as unknown as typeof DBState.db
        expectImportsAsExported(await importFile('Src_preset.json', bytes), exported)
    })

    test('G2 guard: a risup export imports equal on every key except koboldURL', async () => {
        DBState.db = sourceDb() as unknown as typeof DBState.db
        const result = await downloadPreset(0, 'return')
        const exported = JSON.parse(JSON.stringify(result.data)) as Loose
        DBState.db = userDb() as unknown as typeof DBState.db
        expectImportsAsExported(await importFile('x.risup', result.buf as Uint8Array), exported)
    })

    test('G4 guard: selecting a preset the user saved applies its own proxy connection and destinations', () => {
        const own = presetFromWorkingSettings(userDb({
            proxyConnectionId: 'conn-own', koboldURL: 'http://own-kobold.test/api/v1',
        }) as unknown as Database, 'Own', '')
        DBState.db.botPresets.push(own)
        working().proxyConnectionId = 'conn-user'
        changeToPreset(0)
        expect(working().proxyConnectionId).toBe('conn-own')
        expect(working().koboldURL).toBe('http://own-kobold.test/api/v1')
    })
})

describe('share-safe preset export', () => {
    type Loose = Record<string, unknown>
    type Kind = 'json' | 'risupreset' | 'return'
    const kinds: Kind[] = ['json', 'risupreset', 'return']

    const USER_KOBOLD = 'http://user-kobold.invalid/api/v1'
    const endpoints = {
        koboldURL: 'http://sentinel-kobold.invalid/api/v1',
        forceReplaceUrl: 'https://sentinel-proxy.invalid/v1',
        forceReplaceUrl2: 'https://sentinel-proxy2.invalid/v1',
        textgenWebUIStreamURL: 'wss://sentinel-ooba.invalid/api/',
        textgenWebUIBlockingURL: 'https://sentinel-ooba.invalid/api/',
    }
    const preset = sentinelObject('botPreset')

    // The working settings a preset is saved from.
    function workingDb(extra: Loose = {}): Loose {
        return {
            botPresets: [], botPresetsId: -1, NAIsettings: {},
            proxyKey: 'sk-user-proxy', forceReplaceUrl: 'https://user-proxy.invalid/v1',
            google: { accessToken: 'user-gemini-key' }, mancerHeader: 'user-mancer-key',
            textgenWebUIBlockingURL: 'https://user-ooba.invalid/api/', textgenWebUIStreamURL: 'wss://user-ooba.invalid/api/',
            koboldURL: USER_KOBOLD, openAIKey: 'sk-user-openai',
            additionalParams: [['header::Authorization', 'Bearer user-proxy-secret']],
            ooba: {}, ainconfig: {}, reverseProxyOobaArgs: { mode: 'instruct' }, promptSettings: { assistantPrefill: '' },
            customAPIFormat: 0, customFlags: [], seperateModels: { memory: '', emotion: '', translate: '', otherAx: '' },
            fallbackModels: { memory: [], emotion: [], translate: [], otherAx: [], model: [] }, seperateParameters: null,
            modelTools: [], presetRegex: [], promptTemplate: null, mainPrompt: 'm', jailbreak: 'j', formatingOrder: [], aiModel: 'gpt-x',
            apiType: 'x', temperature: 80, maxContext: 4000, maxResponse: 300, frequencyPenalty: 70, PresensePenalty: 70,
            ...extra,
        }
    }

    // Saved through the real producer: `downloadPreset` saves the working settings into preset 0 first.
    function producerDb(): Loose {
        return workingDb({
            botPresetsId: 0, botPresets: [{ name: 'Src' }], ...endpoints, ...preset.object,
            ainconfig: { stoptokens: '</s>\n###' },
        })
    }

    // A stored preset holding a value at every botPreset registry path; `botPresetsId` -1 keeps it as stored.
    function directDb(): Loose {
        return workingDb({
            botPresetsId: -1,
            botPresets: [{
                ...presetFromWorkingSettings(workingDb() as unknown as Database, 'Direct', ''),
                ...endpoints, ...preset.object,
            }],
        })
    }

    const working = () => DBState.db as unknown as Loose

    async function exportAs(kind: Kind): Promise<Loose> {
        vi.mocked(downloadFile).mockClear()
        const result = await downloadPreset(0, kind)
        if (kind === 'return') {
            return JSON.parse(JSON.stringify(result.data)) as Loose
        }
        const bytes = vi.mocked(downloadFile).mock.calls[0][1] as Uint8Array
        if (kind === 'json') {
            return JSON.parse(Buffer.from(bytes).toString('utf-8')) as Loose
        }
        const wrapper = decodeMsgpack(fflate.decompressSync(bytes)) as { preset: Uint8Array }
        return decodeMsgpack(wrapper.preset) as Loose
    }

    test.each(kinds)('R2 reproducer: a %s export carries no endpoint URL and no koboldURL key', async (kind) => {
        DBState.db = producerDb() as unknown as typeof DBState.db
        for (const url of Object.values(endpoints)) {
            expect(JSON.stringify(DBState.db)).toContain(url)
        }

        const exported = await exportAs(kind)

        expect('koboldURL' in exported).toBe(false)
        for (const url of Object.values(endpoints)) {
            expect(JSON.stringify(exported)).not.toContain(url)
        }
    })

    test('G3 reproducer: selecting an exported preset keeps the importer koboldURL', async () => {
        DBState.db = producerDb() as unknown as typeof DBState.db
        const exported = await exportAs('return')

        DBState.db = workingDb() as unknown as typeof DBState.db
        DBState.db.botPresets.push(exported as unknown as (typeof DBState.db.botPresets)[number])
        changeToPreset(0)

        expect(working().koboldURL).toBe(USER_KOBOLD)
    })

    const fixtures: [string, () => Loose][] = [['producer', producerDb], ['direct', directDb]]

    describe.each(fixtures)('%s fixture', (_label, build) => {
        test.each(kinds)('R1 guard: a %s export holds no botPreset credential sentinel', async (kind) => {
            DBState.db = build() as unknown as typeof DBState.db
            expect(missingSentinels(DBState.db, preset.leaves)).toEqual([])

            const exported = await exportAs(kind)

            expect(sentinelsIn(exported, preset.leaves)).toEqual([])
        })

        test('G11 guard: the live database keeps its keys and URLs after an export', async () => {
            DBState.db = build() as unknown as typeof DBState.db
            await exportAs('return')

            expect(missingSentinels(DBState.db, preset.leaves)).toEqual([])
            for (const url of Object.values(endpoints)) {
                expect(JSON.stringify(DBState.db)).toContain(url)
            }
        })
    })

    test.each(kinds)('G5 guard: a %s export keeps ainconfig.stoptokens', async (kind) => {
        DBState.db = producerDb() as unknown as typeof DBState.db
        const exported = await exportAs(kind)
        expect((exported.ainconfig as Loose).stoptokens).toBe('</s>\n###')
    })

    test.each(kinds)('G6 guard: a %s export writes the keys and four URLs as blank own keys', async (kind) => {
        DBState.db = producerDb() as unknown as typeof DBState.db
        const exported = await exportAs(kind)
        for (const field of ['openAIKey', 'proxyKey', 'forceReplaceUrl', 'forceReplaceUrl2', 'textgenWebUIStreamURL', 'textgenWebUIBlockingURL']) {
            expect(Object.hasOwn(exported, field), field).toBe(true)
            expect(exported[field], field).toBe('')
        }
    })

    describe('the notice that keys and endpoint URLs were left out', () => {
        const fileKinds: Kind[] = ['json', 'risupreset']

        function lastAlert(): string {
            const calls = vi.mocked(alertNormal).mock.calls
            return calls[calls.length - 1][0]
        }

        test.each(fileKinds)('R4 regression reproducer: a saved %s export appends the notice to the success alert', async (kind) => {
            const notice = language.shareExportKeysLeftOut
            expect(typeof notice).toBe('string')
            DBState.db = producerDb() as unknown as typeof DBState.db
            vi.mocked(alertNormal).mockClear()
            vi.mocked(downloadFile).mockResolvedValueOnce(true as never)

            await downloadPreset(0, kind)

            expect(vi.mocked(alertNormal)).toHaveBeenCalledTimes(1)
            expect(lastAlert()).not.toBe(downloadNotice(language.successExport))
            expect(lastAlert()).toBe(`${downloadNotice(language.successExport)}\n\n${notice}`)
        })

        test.each(fileKinds)('G7 guard: a dismissed %s save shows no alert and no notice', async (kind) => {
            DBState.db = producerDb() as unknown as typeof DBState.db
            vi.mocked(alertNormal).mockClear()
            vi.mocked(downloadFile).mockResolvedValueOnce(false as never)

            await downloadPreset(0, kind)

            expect(vi.mocked(alertNormal)).not.toHaveBeenCalled()
        })

        test('guard: a return export shows no alert', async () => {
            DBState.db = producerDb() as unknown as typeof DBState.db
            vi.mocked(alertNormal).mockClear()

            await downloadPreset(0, 'return')

            expect(vi.mocked(alertNormal)).not.toHaveBeenCalled()
        })
    })

    test('U3 diagnostic: every URL-looking string field of a preset is a share endpoint field', async () => {
        const { SHARE_ENDPOINT_FIELDS } = await import('src/ts/shareStrip')
        const listed = new Set<string>(SHARE_ENDPOINT_FIELDS.map((entry) => entry.field))
        const produced = presetFromWorkingSettings(workingDb(endpoints) as unknown as Database, 'Probe', '')
        const unlisted = [...walkStrings(presetTemplate, '', []), ...walkStrings(produced, '', [])]
            .filter((leaf) => /url/i.test(leaf.path))
            .map((leaf) => leaf.path.split(/[.[]/)[0])
            .filter((field) => !listed.has(field))
        expect([...new Set(unlisted)]).toEqual([])
        expect(listed.has('koboldURL')).toBe(true)
    })

    test('registry flag: notCredential entries are exactly the look-alikes', () => {
        const flagged = (SECRET_FIELDS as readonly SecretFieldEntry[]).filter(isNotCredential).map((entry) => `${entry.scope}:${secretFieldPath(entry)}`)
        expect(flagged.sort()).toEqual([
            'botPreset:ainconfig.stoptokens',
            'database:ainconfig.stoptokens',
            'database:authRefreshes[].tokenUrl',
            'database:customTokenizer',
            'database:hotkeys[].action',
            'database:hotkeys[].key',
            'database:vertexAccessTokenExpires',
        ])
    })
})
