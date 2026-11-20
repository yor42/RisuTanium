/**
 * `stripShareSecrets` and `shareSafePreset` on synthetic objects, driven by the
 * real `SECRET_FIELDS` registry (diagnostics of a new helper), plus the scope
 * meta-test: every scope that has a credential entry must name the share-path
 * test that covers it, so a new scope cannot ship without one.
 */
import { describe, expect, test } from 'vitest'
import { SECRET_FIELDS, type SecretFieldEntry } from 'src/ts/secretFields'
import { isNotCredential } from 'src/ts/storage/tests/shareStripFixture'
import { SHARE_ENDPOINT_FIELDS, secretFieldValues, shareSafePreset, stripShareSecrets } from 'src/ts/shareStrip'
import type { botPreset } from 'src/ts/storage/database.svelte'

describe('stripShareSecrets', () => {
    test('U1 top-level, .name, [*], [].key and literal-index paths are blanked', () => {
        const db = {
            claudeAPIKey: 'a',
            novelai: { token: 'b', model: 'kept' },
            OaiCompAPIKeys: { m1: 'c', m2: 'd' },
            customModels: [{ key: 'e', id: 'i1' }, { key: 'f', id: 'i2' }],
            additionalParams: [['header::Authorization', 'g'], ['body-name', 'h']],
        }
        stripShareSecrets(db, 'database')
        expect(db).toEqual({
            claudeAPIKey: '',
            novelai: { token: '', model: 'kept' },
            OaiCompAPIKeys: { m1: '', m2: '' },
            customModels: [{ key: '', id: 'i1' }, { key: '', id: 'i2' }],
            additionalParams: [['header::Authorization', ''], ['body-name', '']],
        })
    })

    test('U1 absent keys, containers and undefined values are not created', () => {
        const db = {
            customModels: [{ id: 'no-key' }],
            additionalParams: [['only-a-name']],
            novelai: { model: 'm' },
            OaiCompAPIKeys: {},
            openAIKey: undefined,
        }
        stripShareSecrets(db, 'database')
        expect(db).toEqual({
            customModels: [{ id: 'no-key' }],
            additionalParams: [['only-a-name']],
            novelai: { model: 'm' },
            OaiCompAPIKeys: {},
            openAIKey: undefined,
        })
        expect(Object.keys(db)).not.toContain('claudeAPIKey')
        expect(Object.keys(db.novelai)).not.toContain('token')
        expect(db.additionalParams[0]).toHaveLength(1)

        const empty = {}
        stripShareSecrets(empty, 'database')
        expect(empty).toEqual({})
    })

    test('U1 a path whose container has the wrong shape is left as written', () => {
        const db = { novelai: null, customModels: { 0: { key: 'k' } }, additionalParams: 'text', OaiCompAPIKeys: ['x'] }
        stripShareSecrets(db, 'database')
        expect(db.customModels[0].key).toBe('k')
        expect(db.additionalParams).toBe('text')
        expect(db.novelai).toBeNull()
    })

    test('U1 notCredential look-alikes are kept', () => {
        const db = {
            customTokenizer: 'name',
            vertexAccessTokenExpires: 99,
            hotkeys: [{ key: 'K', action: 'a' }],
            ainconfig: { stoptokens: '</s>' },
            authRefreshes: [{ tokenUrl: 'https://x.invalid/t', refreshToken: 'r', clientSecret: 's' }],
        }
        stripShareSecrets(db, 'database')
        expect(db.customTokenizer).toBe('name')
        expect(db.vertexAccessTokenExpires).toBe(99)
        expect(db.hotkeys).toEqual([{ key: 'K', action: 'a' }])
        expect(db.ainconfig.stoptokens).toBe('</s>')
        expect(db.authRefreshes).toEqual([{ tokenUrl: 'https://x.invalid/t', refreshToken: '', clientSecret: '' }])
    })

    test('U1 entries of other scopes are untouched', () => {
        const target = { oaiTTSConfig: { apiKey: 's' }, openAIKey: 'k', claudeAPIKey: 'c' }
        stripShareSecrets(target, 'character')
        expect(target).toEqual({ oaiTTSConfig: { apiKey: '' }, openAIKey: 'k', claudeAPIKey: 'c' })
        stripShareSecrets(target, 'botPreset')
        expect(target).toEqual({ oaiTTSConfig: { apiKey: '' }, openAIKey: '', claudeAPIKey: 'c' })
    })
})

describe('secretFieldValues', () => {
    test('U6 nested, [*] and [] leaves are collected; notCredential entries and non-strings are skipped; the target is not mutated', () => {
        const db = {
            claudeAPIKey: 'a',
            novelai: { token: 'b', model: 'kept' },
            OaiCompAPIKeys: { m1: 'c', m2: 'd' },
            customModels: [{ key: 'e', id: 'i1' }, { key: 'f', id: 'i2' }, { id: 'no-key' }],
            additionalParams: [['header::Authorization', 'g']],
            hotkeys: [{ key: 'K', action: 'a' }],
            customTokenizer: 'name',
            openAIKey: 5,
        }
        const before = JSON.stringify(db)
        expect(secretFieldValues(db, 'database').sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g'])
        expect(JSON.stringify(db)).toBe(before)
    })

    test('U6 accept narrows the walk to the entries it approves', () => {
        const db = { claudeAPIKey: 'a', additionalParams: [['x', 'g']], vertexPrivateKey: 'pem' }
        expect(secretFieldValues(db, 'database', (entry) => entry.field !== 'additionalParams' && entry.field !== 'vertexPrivateKey')).toEqual(['a'])
    })

    test('U6 other scopes, absent keys and wrong shapes yield nothing and never throw', () => {
        expect(secretFieldValues({ oaiTTSConfig: { apiKey: 's' } }, 'database')).toEqual([])
        expect(secretFieldValues({ oaiTTSConfig: { apiKey: 's' } }, 'character')).toEqual(['s'])
        expect(secretFieldValues({}, 'database')).toEqual([])
        expect(secretFieldValues({ novelai: null, customModels: { 0: { key: 'k' } }, additionalParams: 'text' }, 'database')).toEqual([])
    })
})

describe('shareSafePreset', () => {
    test('U1 credentials and the four URLs are blank own keys, koboldURL is removed, the rest is kept', () => {
        const preset = {
            name: 'P', openAIKey: 'k', proxyKey: 'p', koboldURL: 'http://x.invalid/k',
            forceReplaceUrl: 'https://x.invalid/a', ainconfig: { stoptokens: '</s>' }, temperature: 80,
        }
        const result = shareSafePreset(preset as unknown as botPreset)
        expect(result).toBe(preset)
        expect(preset).toEqual({
            name: 'P', openAIKey: '', proxyKey: '', forceReplaceUrl: '', forceReplaceUrl2: '',
            textgenWebUIStreamURL: '', textgenWebUIBlockingURL: '', ainconfig: { stoptokens: '</s>' }, temperature: 80,
        })
        expect('koboldURL' in preset).toBe(false)
    })

    test('U1 koboldURL is the only deleted endpoint field', () => {
        expect(SHARE_ENDPOINT_FIELDS.filter((entry) => entry.mode === 'delete').map((entry) => entry.field)).toEqual(['koboldURL'])
    })
})

describe('share-path coverage of the registry', () => {
    // Scope of a credential entry -> the test that proves a share path strips it.
    const covered: Record<SecretFieldEntry['scope'], string> = {
        botPreset: 'secretFields.test.ts R1 (preset exports)',
        database: 'SettingsExportButtons.secrets.svelte.test.ts R3 (bug report)',
        character: 'characterCards.shareSecrets.test.ts G10 (v3 card export)',
    }

    test('U2 every scope that has a credential entry has a share-path test', () => {
        const scopes = new Set(
            (SECRET_FIELDS as readonly SecretFieldEntry[]).filter((entry) => !isNotCredential(entry)).map((entry) => entry.scope),
        )
        expect([...scopes].filter((scope) => !(scope in covered))).toEqual([])
    })
})
