/**
 * Lifecycle status of catalog model ids, keyed by the id as registered in the model catalog
 * (`-vertex` twins have their own rows; `-response-api` twins inherit their base row at lookup).
 * Data only: it names ids and never imports the catalog, so the catalog test checks the keys.
 *
 * - retired: the provider no longer serves the model, or the entry has no working successor.
 * - redirected: the provider shut the model down and answers its requests with `target`.
 * - deprecated: the provider announced a shutdown `date`; the lookup reports it as retired from
 *   that local day on.
 */

export type ModelStatusSource =
    | 'anthropic'
    | 'openai'
    | 'geminiApi'
    | 'geminiChangelog'
    | 'vertex'
    | 'bedrock'
    | 'mistral'
    | 'deepseek'
    | 'novelai'

/** The public page each source key refers to, for re-checking a date. */
export const MODEL_STATUS_SOURCE_URLS: Readonly<Record<ModelStatusSource, string>> = {
    anthropic: 'https://platform.claude.com/docs/en/about-claude/model-deprecations',
    openai: 'https://developers.openai.com/api/docs/deprecations',
    geminiApi: 'https://ai.google.dev/gemini-api/docs/deprecations',
    geminiChangelog: 'https://ai.google.dev/gemini-api/docs/changelog',
    vertex: 'https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/model-versions',
    bedrock: 'https://docs.aws.amazon.com/bedrock/latest/userguide/model-lifecycle-legacy.html',
    mistral: 'https://docs.mistral.ai/getting-started/models/',
    deepseek: 'https://api-docs.deepseek.com/updates',
    novelai: 'https://docs.novelai.net/en/text/models',
}

/** Dates are local calendar days in `YYYY-MM-DD` form. */
export type ModelStatusEntry =
    | { kind: 'retired', date?: string, source: ModelStatusSource }
    | { kind: 'redirected', target: string, date?: string, source: ModelStatusSource }
    | { kind: 'deprecated', date: string, source: ModelStatusSource }

export type ModelStatusRow = readonly [id: string, entry: ModelStatusEntry]

function retiredOn(date: string | undefined, source: ModelStatusSource, ids: readonly string[]): ModelStatusRow[] {
    return ids.map((id): ModelStatusRow => [id, date === undefined ? { kind: 'retired', source } : { kind: 'retired', date, source }])
}

function deprecatedOn(date: string, source: ModelStatusSource, ids: readonly string[]): ModelStatusRow[] {
    return ids.map((id): ModelStatusRow => [id, { kind: 'deprecated', date, source }])
}

function redirectedTo(date: string, source: ModelStatusSource, id: string, target: string): ModelStatusRow[] {
    return [[id, { kind: 'redirected', target, date, source }]]
}

/** Builds the lookup record; a key listed twice is an authoring error, not a silent override. */
export function buildModelStatusTable(groups: readonly (readonly ModelStatusRow[])[]): Readonly<Record<string, ModelStatusEntry>> {
    const table: Record<string, ModelStatusEntry> = {}
    for (const group of groups) {
        for (const [id, entry] of group) {
            if (Object.prototype.hasOwnProperty.call(table, id)) {
                throw new Error(`Duplicate model status row: ${id}`)
            }
            table[id] = entry
        }
    }
    return table
}

export const MODEL_STATUS_TABLE: Readonly<Record<string, ModelStatusEntry>> = buildModelStatusTable([
    //#region retired: Anthropic
    retiredOn('2026-08-05', 'anthropic', ['claude-opus-4-1-20250805']),
    retiredOn('2026-06-15', 'anthropic', ['claude-sonnet-4-20250514', 'claude-opus-4-20250514']),
    retiredOn('2026-02-19', 'anthropic', [
        'claude-3-7-sonnet-20250219',
        'claude-3-7-sonnet-latest',
        'claude-3-5-haiku-20241022',
        'claude-3-5-haiku-latest',
    ]),
    retiredOn('2025-10-28', 'anthropic', [
        'claude-3-5-sonnet-20241022',
        'claude-3-5-sonnet-20240620',
        'claude-3-5-sonnet-latest',
    ]),
    retiredOn('2026-04-20', 'anthropic', ['claude-3-haiku-20240307']),
    retiredOn('2026-01-05', 'anthropic', ['claude-3-opus-20240229']),
    retiredOn('2025-07-21', 'anthropic', [
        'claude-3-sonnet-20240229',
        'claude-2.1',
        'claude-2',
        'claude-2-100k',
    ]),
    retiredOn('2024-11-06', 'anthropic', [
        'claude-1.0',
        'claude-1.2',
        'claude-instant-1.2',
        'claude-v1',
        'claude-v1-100k',
        'claude-instant-v1',
        'claude-instant-v1-100k',
    ]),
    //#endregion

    //#region retired: OpenAI
    retiredOn('2026-08-10', 'openai', ['gpt-5.2-chat-latest']),
    retiredOn('2026-07-23', 'openai', [
        'gpt-5.1-chat-latest',
        'gpt-5-chat-latest',
        'o3-deep-research',
        'o4-mini-deep-research',
    ]),
    retiredOn('2025-07-14', 'openai', ['gpt-4.5-preview', 'gpt-4.5-preview-2025-02-27']),
    retiredOn('2025-07-28', 'openai', ['gpt4o1-preview']),
    retiredOn('2025-10-27', 'openai', ['gpt4o1-mini']),
    retiredOn('2026-02-17', 'openai', ['gpt4o-chatgpt']),
    retiredOn('2026-03-26', 'openai', ['gpt4_0125', 'gpt4_0314']),
    retiredOn('2026-09-28', 'openai', ['gpt35_1106', 'instructgpt35']),
    retiredOn('2024-12-06', 'openai', ['gptvi4_1106']),
    retiredOn('2025-06-06', 'openai', ['gpt4_32k', 'gpt4_32k_0613']),
    retiredOn('2024-09-13', 'openai', [
        'gpt35_0613',
        'gpt35_16k_0613',
        'gpt35_0301',
        'gpt35_16k',
    ]),
    //#endregion

    //#region retired and redirected: Gemini API
    redirectedTo('2026-03-09', 'geminiChangelog', 'gemini-3-pro-preview', 'gemini-3.1-pro-preview'),
    redirectedTo('2026-10-08', 'geminiChangelog', 'gemini-3.5-flash', 'gemini-3.6-flash'),
    redirectedTo('2026-10-08', 'geminiChangelog', 'gemini-3.7-flash', 'gemini-3.8-flash'),
    retiredOn('2026-06-25', 'geminiChangelog', ['gemini-3-pro-image-preview']),
    retiredOn('2026-03-31', 'geminiApi', ['gemini-2.5-flash-lite-preview-09-2025']),
    retiredOn('2026-02-17', 'geminiApi', ['gemini-2.5-flash-preview-09-2025']),
    retiredOn('2025-11-18', 'geminiApi', ['gemini-2.5-flash-preview-05-20']),
    retiredOn('2025-11-18', 'geminiChangelog', ['gemini-2.5-flash-lite-preview-06-17']),
    retiredOn('2025-12-02', 'geminiApi', ['gemini-2.5-pro-preview-06-05', 'gemini-2.5-pro-preview-05-06']),
    retiredOn('2025-12-02', 'geminiChangelog', [
        'gemini-2.0-flash-thinking-exp-01-21',
        'gemini-2.0-flash-thinking-exp-1219',
    ]),
    retiredOn('2025-12-09', 'geminiApi', ['gemini-2.0-flash-lite-preview-02-05']),
    retiredOn('2025-12-09', 'geminiChangelog', ['gemini-2.0-flash-exp', 'gemini-2.0-pro-exp']),
    retiredOn('2025-06-26', 'geminiChangelog', ['gemini-2.5-pro-exp-03-25']),
    retiredOn('2025-07-15', 'geminiChangelog', ['gemini-2.5-flash-preview-04-17']),
    retiredOn('2026-01-15', 'geminiChangelog', ['gemini-2.5-flash-image-preview']),
    retiredOn('2026-06-01', 'geminiApi', [
        'gemini-2.0-flash',
        'gemini-2.0-flash-001',
        'gemini-2.0-flash-lite',
        'gemini-2.0-flash-lite-001',
    ]),
    retiredOn('2025-11-14', 'geminiChangelog', ['gemini-2.0-flash-preview-image-generation']),
    retiredOn('2025-09-29', 'geminiChangelog', [
        'gemini-1.5-flash',
        'gemini-1.5-pro-002',
        'gemini-1.5-flash-002',
        'gemini-1.5-pro-latest',
    ]),
    retiredOn('2025-02-18', 'geminiChangelog', ['gemini-pro']),
    retiredOn('2024-07-12', 'geminiChangelog', ['gemini-pro-vision']),
    //#endregion

    //#region retired: Vertex AI twins
    retiredOn('2026-06-01', 'vertex', ['gemini-2.0-flash-vertex', 'gemini-2.0-flash-lite-vertex']),
    retiredOn('2025-09-24', 'vertex', ['gemini-1.5-pro-002-vertex', 'gemini-1.5-flash-002-vertex']),
    retiredOn('2025-04-21', 'vertex', ['gemini-pro-vertex', 'gemini-pro-vision-vertex']),
    //#endregion

    //#region retired: other providers
    retiredOn('2026-05-31', 'mistral', ['mistral-large-2411']),
    retiredOn('2026-07-31', 'mistral', ['open-mistral-nemo']),
    retiredOn('2026-07-24', 'deepseek', ['deepseek-chat', 'deepseek-reasoner']),
    retiredOn(undefined, 'novelai', ['novelai']),
    //#endregion

    //#region deprecated
    deprecatedOn('2026-11-30', 'anthropic', ['claude-sonnet-4-5-20250929']),
    deprecatedOn('2026-10-23', 'openai', [
        'o4-mini',
        'gpt41-nano',
        'o1-pro',
        'o3-mini',
        'o1',
        'gpt4o-2024-05-13',
        'gpt4_turbo',
        'gpt4_turbo_20240409',
        'gpt35_0125',
        'gpt35',
        'gpt4_0613',
        'gpt4',
    ]),
    deprecatedOn('2026-12-11', 'openai', [
        'gpt-5-2025-08-07',
        'gpt-5-mini-2025-08-07',
        'gpt-5-nano-2025-08-07',
    ]),
    deprecatedOn('2027-04-01', 'openai', ['gpt-5.1']),
    deprecatedOn('2027-03-15', 'geminiApi', ['gemini-2.5-flash-image']),
    deprecatedOn('2026-10-14', 'bedrock', ['anthropic.claude-sonnet-4-20250514-v1:0']),
    deprecatedOn('2027-01-08', 'bedrock', ['anthropic.claude-opus-4-1-20250805-v1:0']),
    deprecatedOn('2027-04-08', 'bedrock', ['anthropic.claude-sonnet-4-5-20250929-v1:0']),
    deprecatedOn('2026-10-20', 'vertex', [
        'gemini-2.5-pro-vertex',
        'gemini-2.5-flash-vertex',
        'gemini-2.5-flash-lite-vertex',
    ]),
    deprecatedOn('2026-11-19', 'vertex', ['gemini-3.6-flash-vertex']),
    deprecatedOn('2027-01-28', 'vertex', ['gemini-3.7-flash-vertex']),
    deprecatedOn('2027-03-15', 'vertex', ['gemini-2.5-flash-image-vertex']),
    //#endregion
])
