import { language } from "src/lang"
import { isAndroidTransport } from "../storage/tauriByteTransport"

/** The facts `decidePlainFetch` reads; every field is a plain value so the rule is a pure function. */
export interface PlainFetchInput {
    /** The request host is one of the known local hosts. */
    knownHost: boolean
    isTauri: boolean
    usePlainFetch?: boolean
    plainFetchForce?: boolean
    plainFetchDeforce?: boolean
    /** The request takes the local-network route. */
    localNetworkRoute: boolean
    android: boolean
    /** The parsed `URL.protocol` of the request, lower-case with its colon. */
    protocol: string
}

/**
 * Whether a request takes the plain (WebView) fetch route. On Android an `http:` request never does: the release
 * build's cleartext policy refuses it in the WebView, so it falls through to the native route. Every other input keeps
 * the rule that existed before the exemption.
 */
export function decidePlainFetch(input: PlainFetchInput): boolean {
    if (input.android && input.protocol === 'http:') {
        return false
    }
    return ((input.knownHost && !input.isTauri) || !!input.usePlainFetch || !!input.plainFetchForce)
        && !input.plainFetchDeforce
        && !input.localNetworkRoute
}

/**
 * The message naming why an `http:` request from Android failed in the WebView, or null when this failure is not that
 * case. Only a `TypeError` that says "Failed to fetch" for a parsable `http:` address on Android qualifies: an abort,
 * another error, https, a relative address and a non-Android page are never named.
 */
export function androidHttpBlockedCause(url: string, error: unknown, android: boolean = isAndroidTransport()): string | null {
    if (!android) {
        return null
    }
    if (!(error instanceof TypeError) || !error.message.includes('Failed to fetch')) {
        return null
    }
    try {
        if (new URL(url).protocol !== 'http:') {
            return null
        }
    } catch {
        return null
    }
    return language.errors.androidHttpBlocked
}

/** A direct fetch of an `http:` address that Android refused; its message is the cause shown to the user. */
export class AndroidHttpBlockedError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'AndroidHttpBlockedError'
    }
}

/**
 * The global `fetch`, with one change: a refusal that `androidHttpBlockedCause` names is thrown as
 * `AndroidHttpBlockedError`. Every other rejection, an abort included, is rethrown unchanged.
 */
export async function directFetch(url: string, init?: RequestInit): Promise<Response> {
    try {
        return await fetch(url, init)
    } catch (error) {
        const cause = androidHttpBlockedCause(url, error)
        if (cause !== null) {
            throw new AndroidHttpBlockedError(cause)
        }
        throw error
    }
}
