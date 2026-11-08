/**
 * Token counting for the long-text editors. Pure: the counter takes its
 * tokenizer, model name and route as dependencies, so nothing here reads
 * settings or loads a tokenizer.
 *
 * An `app-count` is a successful count by the tokenizer the app itself would
 * run for the selected model. Every other outcome is an `estimate` and carries
 * its reason; an estimate is never reported as an exact count.
 */

export type TokenizerId = 'o200k_base' | 'cl100k_base' | 'mistral' | 'llama' | 'novelai' | 'claude' | 'novellist'
    | 'gemma' | 'cohere' | 'deepseek' | 'deepseek-v4' | 'glm4' | 'glm5' | 'gguf' | 'plugin'

/** `online-only` models are counted by a remote service, which the editor never calls. */
export type TokenRoute = { kind: 'local'; tokenizer: TokenizerId } | { kind: 'online-only' }
    | { kind: 'unavailable'; reason: 'plugin-tokenizer-missing' }

export type TokenResult = { kind: 'app-count'; count: number; tokenizer: TokenizerId; model: string }
    | { kind: 'estimate'; count: number; model: string; reason: 'online-only' | 'unavailable' | 'error' }

export type TokenCounterDeps = {
    encode(text: string): Promise<ArrayLike<number>>
    modelName(): string
    route(): TokenRoute
    prepare?(text: string): string
}

/** Characters that usually cost about one token each, versus a quarter token for the rest. */
export const ESTIMATE_WEIGHTS: { readonly wide: number; readonly other: number } = { wide: 1.0, other: 0.25 }

function isWideCodePoint(cp: number): boolean {
    return (cp >= 0x1100 && cp <= 0x11FF)
        || (cp >= 0x3130 && cp <= 0x318F)
        || (cp >= 0xAC00 && cp <= 0xD7A3)
        || (cp >= 0x3400 && cp <= 0x4DBF)
        || (cp >= 0x4E00 && cp <= 0x9FFF)
        || (cp >= 0x3040 && cp <= 0x30FF)
}

/** A rough count by character class. Iterates by code point, so a lone surrogate is counted, not thrown on. */
export function estimateTokens(text: string): number {
    let sum = 0
    for (const ch of text) {
        sum += isWideCodePoint(ch.codePointAt(0) ?? 0) ? ESTIMATE_WEIGHTS.wide : ESTIMATE_WEIGHTS.other
    }
    return Math.ceil(sum)
}

/**
 * `count` never rejects. `modelName`, `prepare`, `route` and the call to
 * `encode` run in one synchronous turn (no `await` before `encode` starts), so
 * the route that was read and the settings `encode` reads cannot diverge.
 */
export function createTokenCounter(deps: TokenCounterDeps): { count(text: string): Promise<TokenResult> } {
    return {
        async count(text: string): Promise<TokenResult> {
            let model = ''
            try {
                model = deps.modelName()
            } catch {
                model = ''
            }
            const estimate = (basis: string, reason: 'online-only' | 'unavailable' | 'error'): TokenResult =>
                ({ kind: 'estimate', count: estimateTokens(basis), model, reason })

            let prepared = text
            try {
                prepared = deps.prepare?.(text) ?? text
            } catch {
                return estimate(text, 'error')
            }

            let route: TokenRoute
            try {
                route = deps.route()
            } catch {
                return estimate(prepared, 'error')
            }
            if (route.kind === 'online-only') return estimate(prepared, 'online-only')
            if (route.kind === 'unavailable') return estimate(prepared, 'unavailable')

            let pending: Promise<ArrayLike<number>>
            try {
                pending = deps.encode(prepared)
            } catch {
                return estimate(prepared, 'error')
            }
            try {
                const encoded = await pending
                return { kind: 'app-count', count: encoded.length, tokenizer: route.tokenizer, model }
            } catch {
                return estimate(prepared, 'error')
            }
        },
    }
}

/**
 * Runs at most one `count` at a time, in request order. A newer request with
 * the same key supersedes an older one: an unstarted older request never
 * starts and a running one resolves `null` once it settles. Requests with
 * different keys never supersede each other. `request` never rejects and the
 * chain survives a `count` that rejects or throws. Only this counter's own
 * calls are serialised.
 */
export function createSerialTokenCounter(counter: { count(text: string): Promise<TokenResult> }):
    { request(key: string, text: string): Promise<TokenResult | null> } {
    let tail: Promise<void> = Promise.resolve()
    let sequence = 0
    const latest = new Map<string, number>()

    return {
        request(key: string, text: string): Promise<TokenResult | null> {
            const id = ++sequence
            latest.set(key, id)
            const run = tail.then(async (): Promise<TokenResult | null> => {
                if (latest.get(key) !== id) return null
                let result: TokenResult | null = null
                try {
                    result = await counter.count(text)
                } catch {
                    result = null
                }
                if (latest.get(key) !== id) return null
                latest.delete(key)
                return result
            })
            tail = run.then(() => undefined, () => undefined)
            return run
        },
    }
}
