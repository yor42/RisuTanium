// @vitest-environment node
/**
 * `checkSendPrerequisites` is the pure pre-send check of the new chat shell. U1 = diagnostic: the module is new, so
 * before the fix these cases fail on the missing import. Each case is gated by a mutant (reverse_proxy blocking,
 * whitespace counting as a key, no presetChain exemption, a missing custom model passing, the check reading subModel).
 * The model lookup is injected, so no catalog or database is needed here; the real catalog is covered in
 * `ChatShell.preSend.svelte.test.ts`.
 */
import { describe, expect, test } from 'vitest'
import { checkSendPrerequisites, type SendModelInfo, type SendPrerequisiteSettings } from '../sendPrerequisites'
import { slotConnection, type ConnectionHolder } from '../../connections/connections'
import { connectionHasKey } from '../../connections/keyAccess'
import { absorbLegacyForTest } from '../../connections/tests/legacyFixture'
import type { LegacyKeyFields } from '../../storage/database.svelte'

const OpenAI = 0
const Anthropic = 1
const GoogleCloud = 2
const VertexAI = 3
const AsIs = 4
const Mistral = 5
const Cohere = 7
const NovelAI = 8
const AWS = 11
const DeepSeek = 12
const Echo = 14
const NanoGPT = 15
const Ollama = 16

const MODELS: Record<string, SendModelInfo> = {
    'gpt-test': { provider: OpenAI },
    'claude-test': { provider: Anthropic },
    'gemini-test': { provider: GoogleCloud },
    'vertex-test': { provider: VertexAI },
    'mistral-test': { provider: Mistral },
    'cohere-test': { provider: Cohere },
    'novelai-test': { provider: NovelAI },
    'aws-test': { provider: AWS },
    'deepseek-test': { provider: DeepSeek, keyIdentifier: 'deepseek' },
    'echo-test': { provider: Echo },
    'nano-test': { provider: NanoGPT },
    'ollama-test': { provider: Ollama },
    reverse_proxy: { provider: AsIs },
    openrouter: { provider: AsIs },
}

function lookup(id: string): SendModelInfo {
    return MODELS[id] ?? { provider: AsIs }
}

/** The settings as a save held them: the keys sit in the legacy fields until the migration absorbs them. */
type StoredSettings = SendPrerequisiteSettings & LegacyKeyFields

function settings(overrides: Partial<StoredSettings> = {}): StoredSettings {
    return {
        aiModel: 'claude-test',
        customModels: [],
        presetChain: '',
        fallbackModels: { model: [] },
        openAIKey: '',
        openrouterKey: '',
        claudeAPIKey: '',
        mistralKey: '',
        cohereAPIKey: '',
        OaiCompAPIKeys: {},
        google: { accessToken: '' },
        novelai: { token: '' },
        ...overrides,
    }
}

/** The check over settings whose legacy keys are absorbed first, with presence read from connections. */
function check(db: StoredSettings, info: (id: string) => SendModelInfo) {
    const absorbed = absorbLegacyForTest(structuredClone(db))
    const holder: ConnectionHolder = { ...absorbed, customModels: [...(absorbed.customModels ?? [])] }
    return checkSendPrerequisites(db, info, (slot) => {
        const conn = slotConnection(holder, slot)
        return conn !== undefined && connectionHasKey(conn)
    })
}

describe('U1 the key rows', () => {
    test.each([
        ['an OpenAI model without openAIKey', 'gpt-test', {}, 'OpenAI'],
        ['openrouter without openrouterKey', 'openrouter', {}, 'OpenRouter'],
        ['an Anthropic model without claudeAPIKey', 'claude-test', {}, 'Anthropic'],
        ['a Google Cloud model without google.accessToken', 'gemini-test', {}, 'Google Cloud'],
        ['a Mistral model without mistralKey', 'mistral-test', {}, 'MistralAI'],
        ['a Cohere model without cohereAPIKey', 'cohere-test', {}, 'Cohere'],
        ['a NovelAI model without novelai.token', 'novelai-test', {}, 'NovelAI'],
        ['a model with a key identifier and no entry in OaiCompAPIKeys', 'deepseek-test', {}, 'deepseek'],
    ])('%s is refused with the key reason', (_name, aiModel, extra, provider) => {
        expect(check(settings({ aiModel, ...extra }), lookup)).toEqual({ reason: 'key', fix: 'botSettings', provider })
    })

    test.each([
        ['OpenAI', 'gpt-test', { openAIKey: 'k' }],
        ['openrouter', 'openrouter', { openrouterKey: 'k' }],
        ['Anthropic', 'claude-test', { claudeAPIKey: 'k' }],
        ['Google Cloud', 'gemini-test', { google: { accessToken: 'k' } }],
        ['Mistral', 'mistral-test', { mistralKey: 'k' }],
        ['Cohere', 'cohere-test', { cohereAPIKey: 'k' }],
        ['NovelAI', 'novelai-test', { novelai: { token: 'k' } }],
        ['a key identifier', 'deepseek-test', { OaiCompAPIKeys: { deepseek: 'k' } }],
    ])('%s with its key set passes', (_name, aiModel, extra) => {
        expect(check(settings({ aiModel, ...extra }), lookup)).toBeNull()
    })

    test('a key made only of whitespace counts as missing', () => {
        expect(check(settings({ claudeAPIKey: '  \n\t ' }), lookup)).toMatchObject({ reason: 'key' })
    })

    test('a key that is not a string counts as missing', () => {
        expect(check(settings({ claudeAPIKey: undefined }), lookup)).toMatchObject({ reason: 'key' })
        expect(check(settings({ aiModel: 'deepseek-test', OaiCompAPIKeys: { deepseek: 5 as unknown as string } }), lookup)).toMatchObject({ reason: 'key' })
    })

    test('a secret reference is never resolved or read: a non-blank reference text passes', () => {
        expect(check(settings({ claudeAPIKey: 'secret:ref-one' }), lookup)).toBeNull()
    })

    test('the refusal never carries a key value', () => {
        const refusal = check(settings({ claudeAPIKey: ' ' }), lookup)
        expect(JSON.stringify(refusal)).not.toContain('"claudeAPIKey"')
    })
})

describe('U1 setups that must never be blocked', () => {
    test.each([
        ['reverse_proxy with an empty proxy key', 'reverse_proxy'],
        ['a local ollama model', 'ollama-test'],
        ['AWS', 'aws-test'],
        ['Vertex AI', 'vertex-test'],
        ['a plugin or custom provider id', 'pluginmodel:::x'],
        ['NanoGPT', 'nano-test'],
        ['Echo', 'echo-test'],
        ['a model id the catalog does not know', 'some-unlisted-model'],
    ])('%s passes', (_name, aiModel) => {
        expect(check(settings({ aiModel }), lookup)).toBeNull()
    })

    test('a preset chain disables the check, because the preset can change inside the send', () => {
        expect(check(settings({ presetChain: 'preset-a,preset-b' }), lookup)).toBeNull()
        expect(check(settings({ presetChain: '' }), lookup)).toMatchObject({ reason: 'key' })
    })

    test('a keyed fallback model passes the check even with an empty main key', () => {
        expect(check(settings({ fallbackModels: { model: ['gpt-test'] } }), lookup)).toBeNull()
    })

    test('a fallback list of blank entries does not exempt the check', () => {
        expect(check(settings({ fallbackModels: { model: ['', '  '] } }), lookup)).toMatchObject({ reason: 'key' })
    })

    test('the sub model is never read: a blank subModel does not matter', () => {
        const withSub = { ...settings({ claudeAPIKey: 'k' }), subModel: '' }
        expect(check(withSub, lookup)).toBeNull()
    })
})

describe('U1 the model reason', () => {
    test('a blank main model is refused with the model reason', () => {
        expect(check(settings({ aiModel: '' }), lookup)).toEqual({ reason: 'model', fix: 'botSettings' })
        expect(check(settings({ aiModel: '   ' }), lookup)).toEqual({ reason: 'model', fix: 'botSettings' })
    })

    test('a custom model id with no entry in customModels is refused with the model reason', () => {
        expect(check(settings({ aiModel: 'xcustom:::gone' }), lookup)).toEqual({ reason: 'model', fix: 'botSettings' })
    })

    test('a custom model id with an entry passes', () => {
        expect(check(settings({ aiModel: 'xcustom:::here', customModels: [{ id: 'xcustom:::here' }] }), lookup)).toBeNull()
    })

    test('the model reason comes before the key reason', () => {
        expect(check(settings({ aiModel: '' }), lookup)).toMatchObject({ reason: 'model' })
    })
})
