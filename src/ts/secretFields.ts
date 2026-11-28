import type { StoredDatabase, botPreset, character } from 'src/ts/storage/database.svelte'

/**
 * Every credential-bearing field, and whether an environment-variable
 * reference in it is resolved.
 *
 * - `resolved`: the reader calls `resolveSecret` at use time (`stage` is the
 *   rollout stage in which that reader is migrated).
 * - `excluded`: a reference is never resolved there; `reason` says why.
 *
 * Every entry is also a credential that share exports (presets, the settings
 * bug report) blank, unless it is flagged `notCredential`: a look-alike whose
 * path merely resembles one. An unflagged new entry is stripped.
 *
 * `field` is checked against the owning type, so a renamed or removed
 * field breaks the build. `sub` is the path below it; `[]` stands for any
 * array index and `[*]` for any object key.
 */

export type SecretFieldOwner =
    | { scope: 'database', field: keyof StoredDatabase }
    | { scope: 'botPreset', field: keyof botPreset }
    | { scope: 'character', field: keyof character }

export type SecretFieldEntry = SecretFieldOwner & {
    /** Path below `field`, e.g. `.key` or `[*]`. */
    sub?: string
} & (
    | { class: 'resolved', stage: 1 | 2, reader: string }
    | { class: 'excluded', reason: string, notCredential?: true }
)

export const SECRET_FIELDS = [
    //#region chat providers (stage 1)
    { scope: 'database', field: 'openAIKey', class: 'resolved', stage: 1, reader: 'legacy slot, absorbed at load; written by .bin translation' },
    { scope: 'database', field: 'proxyKey', class: 'resolved', stage: 1, reader: 'legacy slot, absorbed at load; written by .bin translation' },
    { scope: 'botPreset', field: 'openAIKey', class: 'resolved', stage: 1, reader: 'legacy preset copy, absorbed at load; blanked on preset import; written by .bin translation' },
    { scope: 'botPreset', field: 'proxyKey', class: 'resolved', stage: 1, reader: 'legacy preset copy, absorbed at load; blanked on preset import; written by .bin translation' },
    { scope: 'database', field: 'claudeAPIKey', class: 'resolved', stage: 1, reader: 'legacy slot, absorbed at load; written by .bin translation' },
    { scope: 'database', field: 'openrouterKey', class: 'resolved', stage: 1, reader: 'legacy slot, absorbed at load; written by .bin translation' },
    { scope: 'database', field: 'nanogptKey', class: 'resolved', stage: 1, reader: 'legacy slot, absorbed at load; written by .bin translation' },
    { scope: 'database', field: 'mistralKey', class: 'resolved', stage: 1, reader: 'legacy slot, absorbed at load; written by .bin translation' },
    { scope: 'database', field: 'cohereAPIKey', class: 'resolved', stage: 1, reader: 'legacy slot, absorbed at load; written by .bin translation' },
    { scope: 'database', field: 'ollamaApiKey', class: 'resolved', stage: 1, reader: 'legacy slot, absorbed at load; written by .bin translation' },
    { scope: 'database', field: 'novellistAPI', class: 'resolved', stage: 1, reader: 'legacy slot, absorbed at load; written by .bin translation' },
    { scope: 'database', field: 'mancerHeader', class: 'resolved', stage: 1, reader: 'legacy slot, absorbed at load; written by .bin translation' },
    { scope: 'database', field: 'novelai', sub: '.token', class: 'resolved', stage: 1, reader: 'legacy slot, absorbed at load; written by .bin translation' },
    { scope: 'database', field: 'hordeConfig', sub: '.apiKey', class: 'resolved', stage: 1, reader: 'legacy slot, absorbed at load; written by .bin translation' },
    { scope: 'database', field: 'google', sub: '.accessToken', class: 'resolved', stage: 1, reader: 'legacy slot, absorbed at load; written by .bin translation' },
    { scope: 'database', field: 'vertexPrivateKey', class: 'resolved', stage: 1, reader: 'legacy slot, absorbed at load; written by .bin translation' },
    { scope: 'database', field: 'OaiCompAPIKeys', sub: '[*]', class: 'resolved', stage: 1, reader: 'legacy slot, absorbed at load; written by .bin translation' },
    { scope: 'database', field: 'customModels', sub: '[].key', class: 'resolved', stage: 1, reader: 'legacy slot, absorbed at load; written by .bin translation' },
    { scope: 'database', field: 'connections', sub: '[].key', class: 'resolved', stage: 1, reader: 'connections/keyAccess.ts (chat requests and the service readers through serviceKeys.ts)' },
    { scope: 'database', field: 'connections', sub: '[].keyWrapped', class: 'excluded', reason: 'Keystore ciphertext of [].key; never a reference, read only through keyAccess' },
    //#endregion

    //#region stage 2 readers
    { scope: 'database', field: 'elevenLabKey', class: 'resolved', stage: 2, reader: 'legacy slot, absorbed at load; written by .bin translation' },
    { scope: 'database', field: 'huggingfaceKey', class: 'resolved', stage: 2, reader: 'legacy slot, absorbed at load; written by .bin translation' },
    { scope: 'database', field: 'fishSpeechKey', class: 'resolved', stage: 2, reader: 'legacy slot, absorbed at load; written by .bin translation' },
    { scope: 'database', field: 'NAIApiKey', class: 'resolved', stage: 2, reader: 'legacy slot, absorbed at load; written by .bin translation' },
    { scope: 'database', field: 'stabilityKey', class: 'resolved', stage: 2, reader: 'legacy slot, absorbed at load; written by .bin translation' },
    { scope: 'database', field: 'falToken', class: 'resolved', stage: 2, reader: 'legacy slot, absorbed at load; written by .bin translation' },
    { scope: 'database', field: 'openaiCompatImage', sub: '.key', class: 'resolved', stage: 2, reader: 'legacy slot, absorbed at load; written by .bin translation' },
    { scope: 'database', field: 'wavespeedImage', sub: '.key', class: 'resolved', stage: 2, reader: 'legacy slot, absorbed at load; written by .bin translation' },
    { scope: 'database', field: 'deeplOptions', sub: '.key', class: 'resolved', stage: 2, reader: 'legacy slot, absorbed at load; written by .bin translation' },
    { scope: 'database', field: 'deeplXOptions', sub: '.token', class: 'resolved', stage: 2, reader: 'legacy slot, absorbed at load; written by .bin translation' },
    { scope: 'database', field: 'supaMemoryKey', class: 'resolved', stage: 2, reader: 'legacy slot, absorbed at load; written by .bin translation' },
    { scope: 'database', field: 'hypaMemoryKey', class: 'resolved', stage: 2, reader: 'stored only; no request reader found' },
    { scope: 'database', field: 'voyageApiKey', class: 'resolved', stage: 2, reader: 'legacy slot, absorbed at load; written by .bin translation' },
    { scope: 'database', field: 'hypaCustomSettings', sub: '.key', class: 'resolved', stage: 2, reader: 'legacy slot, absorbed at load; written by .bin translation' },
    //#endregion

    //#region exclusions
    { scope: 'character', field: 'oaiTTSConfig', sub: '.apiKey', class: 'excluded', reason: 'card-controlled field next to a card-controlled base URL; a reference there never resolves' },
    { scope: 'database', field: 'authRefreshes', sub: '[].refreshToken', class: 'excluded', reason: 'OAuth credential minted and rotated by the app, not typed by the user' },
    { scope: 'database', field: 'authRefreshes', sub: '[].clientSecret', class: 'excluded', reason: 'OAuth credential minted and rotated by the app, not typed by the user' },
    { scope: 'database', field: 'vertexAccessToken', class: 'excluded', reason: 'the minted Vertex access token lives in memory only and is always written empty; the field stays for upstream .bin' },
    { scope: 'database', field: 'vertexAccessTokenExpires', class: 'excluded', reason: 'always 0: the minted Vertex access token lives in memory only', notCredential: true },
    { scope: 'database', field: 'authRefreshes', sub: '[].tokenUrl', class: 'excluded', reason: 'an endpoint URL, not a credential', notCredential: true },
    { scope: 'database', field: 'customTokenizer', class: 'excluded', reason: 'a tokenizer name, not a credential', notCredential: true },
    { scope: 'database', field: 'ainconfig', sub: '.stoptokens', class: 'excluded', reason: 'stop sequences, not a credential', notCredential: true },
    { scope: 'botPreset', field: 'ainconfig', sub: '.stoptokens', class: 'excluded', reason: 'stop sequences, not a credential', notCredential: true },
    { scope: 'database', field: 'hotkeys', sub: '[].key', class: 'excluded', reason: 'a keyboard shortcut, not a credential', notCredential: true },
    { scope: 'database', field: 'hotkeys', sub: '[].action', class: 'excluded', reason: 'a shortcut action name; the word hotkeys is in its path', notCredential: true },
    { scope: 'database', field: 'additionalParams', sub: '[][1]', class: 'excluded', reason: 'header and body parameter values; a header:: entry can carry an Authorization value; a reference there is never resolved' },
    //#endregion
] as const satisfies readonly SecretFieldEntry[]

/** Path of an entry in the form the completeness walk produces. */
export function secretFieldPath(entry: SecretFieldEntry): string {
    return `${entry.field}${entry.sub ?? ''}`
}
