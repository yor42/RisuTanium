/**
 * `stream_options.include_usage` is sent only to the official OpenAI host: other
 * OpenAI-compatible hosts may reject an unknown field. Same predicate as the
 * request module's official-host check, kept here so this module stays pure.
 */
export function wantsStreamUsage(url: string): boolean {
    try {
        return new URL(url).hostname === 'api.openai.com'
    } catch {
        return false
    }
}
