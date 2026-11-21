/**
 * The literal the chat-key `.bin` round trip runs over: a legacy-shaped (upstream-shaped) database with a non-empty value at
 * every in-scope key position, and presets built by upstream's own `saveCurrentPreset`. It imports only the upstream preset
 * mirror and types, so it travels with the compat round-trip file into a run against the tree before connections existed.
 * The values are synthetic and carry a multi-line list and a `${NAME}` reference where the transport must keep them verbatim.
 */
import type { StoredDatabase } from 'src/ts/storage/database.svelte'
import { upstreamSaveCurrentPreset } from 'src/ts/drive/tests/upstreamPresetMirror'

export const PRESET_PAIRS: ReadonlyArray<readonly [url: string, key: string]> = [
    ['https://a.invalid/v1', 'K-a'],
    ['https://b.invalid/v1', 'K-b'],
    ['https://a.invalid/v1', 'K-a'],
]

/** The in-scope legacy fields of the working settings, each non-empty. */
export const LEGACY_ROOT_KEYS = {
    openAIKey: 'sk-oa\nsk-ob',
    claudeAPIKey: 'sk-ant',
    openrouterKey: 'sk-or',
    nanogptKey: 'sk-ng',
    mistralKey: '${MISTRAL_KEY}',
    cohereAPIKey: 'sk-co',
    ollamaApiKey: 'sk-ol',
    novellistAPI: 'sk-nl',
    mancerHeader: 'sk-mn',
    vertexPrivateKey: '-----BEGIN PRIVATE KEY-----\nMIIsynthetic\n-----END PRIVATE KEY-----',
    novelai: { token: 'sk-nai' },
    hordeConfig: { apiKey: 'sk-horde' },
    google: { accessToken: 'sk-google', projectId: 'proj' },
    OaiCompAPIKeys: { deepinfra: 'sk-di', deepseek: 'sk-ds' },
} as const

/**
 * A legacy database: working pair equal to the active preset's, three presets whose pairs upstream's save produced, and each
 * preset's `openAIKey` set to `sk-preset` (upstream copies the working key into every preset it saves).
 */
export function roundTripLiteral(): Record<string, unknown> {
    const db: Record<string, unknown> = {
        botPresets: PRESET_PAIRS.map((_, index) => ({ name: `P${index}` })),
        botPresetsId: 0,
        openAIKey: 'sk-preset',
        forceReplaceUrl: '',
        proxyKey: '',
    }
    PRESET_PAIRS.forEach(([url, key], index) => {
        db.botPresetsId = index
        db.forceReplaceUrl = url
        db.proxyKey = key
        upstreamSaveCurrentPreset(db as unknown as StoredDatabase)
    })
    db.botPresetsId = 0
    db.forceReplaceUrl = PRESET_PAIRS[0][0]
    db.proxyKey = PRESET_PAIRS[0][1]
    Object.assign(db, structuredClone(LEGACY_ROOT_KEYS))
    db.customModels = [
        { id: 'xcustom:::m1', name: 'M1', internalId: 'm1', url: 'https://m1.invalid/v1', key: 'k-m1', format: 0, flags: [], tokenizer: 0 },
        { id: 'xcustom:::m2', name: 'M2', internalId: 'm2', url: 'https://m2.invalid/v1', key: 'k-m2\nk-m2b', format: 0, flags: [], tokenizer: 0 },
    ]
    return db
}
