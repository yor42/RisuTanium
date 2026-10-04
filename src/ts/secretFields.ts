import type { Database, botPreset, character } from 'src/ts/storage/database.svelte'

/**
 * Every credential-bearing field, and whether an environment-variable
 * reference in it is resolved.
 *
 * - `resolved`: the reader calls `resolveSecret` at use time (`stage` is the
 *   rollout stage in which that reader is migrated).
 * - `excluded`: a reference is never resolved there; `reason` says why.
 *
 * `field` is checked against the owning type, so a renamed or removed
 * field breaks the build. `sub` is the path below it; `[]` stands for any
 * array index and `[*]` for any object key.
 */

export type SecretFieldOwner =
    | { scope: 'database', field: keyof Database }
    | { scope: 'botPreset', field: keyof botPreset }
    | { scope: 'character', field: keyof character }

export type SecretFieldEntry = SecretFieldOwner & {
    /** Path below `field`, e.g. `.key` or `[*]`. */
    sub?: string
} & (
    | { class: 'resolved', stage: 1 | 2, reader: string }
    | { class: 'excluded', reason: string }
)

export const SECRET_FIELDS = [
    //#region chat providers (stage 1)
    { scope: 'database', field: 'openAIKey', class: 'resolved', stage: 1, reader: 'openAI requests/responses; reverse proxy fallback' },
    { scope: 'database', field: 'proxyKey', class: 'resolved', stage: 1, reader: 'openAI requests/responses (reverse proxy)' },
    { scope: 'botPreset', field: 'openAIKey', class: 'resolved', stage: 1, reader: 'preset copy of db.openAIKey; blanked on preset import' },
    { scope: 'botPreset', field: 'proxyKey', class: 'resolved', stage: 1, reader: 'preset copy of db.proxyKey; blanked on preset import' },
    { scope: 'database', field: 'claudeAPIKey', class: 'resolved', stage: 1, reader: 'anthropic (Bedrock: whole AKID:SECRET:region triple)' },
    { scope: 'database', field: 'openrouterKey', class: 'resolved', stage: 1, reader: 'openAI requests (OpenRouter)' },
    { scope: 'database', field: 'nanogptKey', class: 'resolved', stage: 1, reader: 'openAI requests/responses (NanoGPT)' },
    { scope: 'database', field: 'mistralKey', class: 'resolved', stage: 1, reader: 'openAI requests (Mistral)' },
    { scope: 'database', field: 'cohereAPIKey', class: 'resolved', stage: 1, reader: 'request.ts (Cohere)' },
    { scope: 'database', field: 'ollamaApiKey', class: 'resolved', stage: 1, reader: 'request.ts (Ollama)' },
    { scope: 'database', field: 'novellistAPI', class: 'resolved', stage: 1, reader: 'request.ts (NovelList)' },
    { scope: 'database', field: 'mancerHeader', class: 'resolved', stage: 1, reader: 'request.ts (Mancer)' },
    { scope: 'database', field: 'novelai', sub: '.token', class: 'resolved', stage: 1, reader: 'request.ts (NovelAI)' },
    { scope: 'database', field: 'hordeConfig', sub: '.apiKey', class: 'resolved', stage: 1, reader: 'request.ts (AI Horde)' },
    { scope: 'database', field: 'google', sub: '.accessToken', class: 'resolved', stage: 1, reader: 'google.ts (Gemini key, Vertex)' },
    { scope: 'database', field: 'vertexPrivateKey', class: 'resolved', stage: 1, reader: 'google.ts (Vertex PEM; minted token stays in memory)' },
    { scope: 'database', field: 'OaiCompAPIKeys', sub: '[*]', class: 'resolved', stage: 1, reader: 'openAI requests/responses (per-model keys)' },
    { scope: 'database', field: 'customModels', sub: '[].key', class: 'resolved', stage: 1, reader: 'request.ts (custom models)' },
    //#endregion

    //#region stage 2 readers
    { scope: 'database', field: 'elevenLabKey', class: 'resolved', stage: 2, reader: 'tts.ts' },
    { scope: 'database', field: 'huggingfaceKey', class: 'resolved', stage: 2, reader: 'tts.ts' },
    { scope: 'database', field: 'fishSpeechKey', class: 'resolved', stage: 2, reader: 'tts.ts' },
    { scope: 'database', field: 'NAIApiKey', class: 'resolved', stage: 2, reader: 'stableDiff.ts, tts.ts (NovelAI)' },
    { scope: 'database', field: 'stabilityKey', class: 'resolved', stage: 2, reader: 'stableDiff.ts' },
    { scope: 'database', field: 'falToken', class: 'resolved', stage: 2, reader: 'stableDiff.ts' },
    { scope: 'database', field: 'openaiCompatImage', sub: '.key', class: 'resolved', stage: 2, reader: 'stableDiff.ts' },
    { scope: 'database', field: 'wavespeedImage', sub: '.key', class: 'resolved', stage: 2, reader: 'stableDiff.ts, globalApi.svelte.ts' },
    { scope: 'database', field: 'deeplOptions', sub: '.key', class: 'resolved', stage: 2, reader: 'translator.ts' },
    { scope: 'database', field: 'deeplXOptions', sub: '.token', class: 'resolved', stage: 2, reader: 'translator.ts' },
    { scope: 'database', field: 'supaMemoryKey', class: 'resolved', stage: 2, reader: 'memory (supaMemory, hypamemory, hypav2/v3)' },
    { scope: 'database', field: 'hypaMemoryKey', class: 'resolved', stage: 2, reader: 'stored only; no request reader found' },
    { scope: 'database', field: 'voyageApiKey', class: 'resolved', stage: 2, reader: 'contextualEmbedding.ts' },
    { scope: 'database', field: 'hypaCustomSettings', sub: '.key', class: 'resolved', stage: 2, reader: 'hypamemory custom embedding' },
    //#endregion

    //#region exclusions
    { scope: 'character', field: 'oaiTTSConfig', sub: '.apiKey', class: 'excluded', reason: 'card-controlled field next to a card-controlled base URL; a reference there never resolves' },
    { scope: 'database', field: 'authRefreshes', sub: '[].refreshToken', class: 'excluded', reason: 'OAuth credential minted and rotated by the app, not typed by the user' },
    { scope: 'database', field: 'authRefreshes', sub: '[].clientSecret', class: 'excluded', reason: 'OAuth credential minted and rotated by the app, not typed by the user' },
    { scope: 'database', field: 'vertexAccessToken', class: 'excluded', reason: 'derived cache of the minted Vertex access token' },
    { scope: 'database', field: 'vertexAccessTokenExpires', class: 'excluded', reason: 'derived cache expiry of the minted Vertex access token' },
    { scope: 'database', field: 'authRefreshes', sub: '[].tokenUrl', class: 'excluded', reason: 'an endpoint URL, not a credential' },
    { scope: 'database', field: 'customTokenizer', class: 'excluded', reason: 'a tokenizer name, not a credential' },
    { scope: 'database', field: 'ainconfig', sub: '.stoptokens', class: 'excluded', reason: 'stop sequences, not a credential' },
    { scope: 'botPreset', field: 'ainconfig', sub: '.stoptokens', class: 'excluded', reason: 'stop sequences, not a credential' },
    { scope: 'database', field: 'hotkeys', sub: '[].key', class: 'excluded', reason: 'a keyboard shortcut, not a credential' },
    { scope: 'database', field: 'hotkeys', sub: '[].action', class: 'excluded', reason: 'a shortcut action name; the word hotkeys is in its path' },
    //#endregion
] as const satisfies readonly SecretFieldEntry[]

/** Path of an entry in the form the completeness walk produces. */
export function secretFieldPath(entry: SecretFieldEntry): string {
    return `${entry.field}${entry.sub ?? ''}`
}
