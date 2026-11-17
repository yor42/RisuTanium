/**
 * The long-text fields' one token counter. The app's tokenizer module is heavy, so it is imported on the first
 * request only, and one serial counter serves every field: requests run one at a time, and a newer request with
 * the same key supersedes the older one. A failed import resolves `null`; the next request tries again.
 */
import { createSerialTokenCounter, type TokenResult } from './tokenCount'

export type TokenRequester = { request(key: string, text: string): Promise<TokenResult | null> }

let seam: TokenRequester | null = null
let loaded: Promise<TokenRequester> | null = null

function load(): Promise<TokenRequester> {
    if (loaded === null) {
        loaded = import('./tokenCountApp').then(
            (module) => createSerialTokenCounter(module.createAppTokenCounter()),
            (error: unknown) => {
                loaded = null
                throw error
            },
        )
    }
    return loaded
}

export async function requestTokens(key: string, text: string): Promise<TokenResult | null> {
    if (seam) return seam.request(key, text)
    try {
        return await (await load()).request(key, text)
    } catch {
        return null
    }
}

/** Replaces the counter, or restores the real one with `null`. The real counter is also forgotten. */
export function setTokenCounterForTests(counter: TokenRequester | null): void {
    seam = counter
    if (counter === null) loaded = null
}
