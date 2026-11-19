import { encodeReplyBlob, REPLY_BLOB_PAGE_VERSION, type ReplyBlobBase } from './blob'
import { holdInflight, noteBound } from './pageState'
import type { OpenAIParseContext } from '../process/request/openAI/chatBodyParse'

/**
 * The right to own one reply's record. A send that qualifies is issued a grant; the request that is allowed to use it
 * binds it into an owner, and the native fetch takes that owner once. Identity decides: a plain object with the same
 * fields, a second take and an unbound grant own nothing, so no earlier fetch of the send, no retry and no plugin can
 * claim the record.
 */

/** What the send knows when it asks for ownership; every one of these must hold. */
export interface NativeReplyFacts {
    androidTransport: boolean
    streaming: boolean
    /** The owner is a single character: a group chat never owns. */
    singleCharacter: boolean
    isContinue: boolean
    isPreview: boolean
    isPromptPreview: boolean
}

export function nativeReplyEligible(facts: NativeReplyFacts): boolean {
    return facts.androidTransport
        && !facts.streaming
        && facts.singleCharacter
        && !facts.isContinue
        && !facts.isPreview
        && !facts.isPromptPreview
}

/** What `streamed_fetch` receives as `replyOwner`. */
export interface NativeReplyOwnerArg {
    key: string
    pageVersion: number
    blob: string
}

/** The bound grant a request hands to `globalFetch`; it carries no data a caller could change. */
export interface NativeReplyOwner {
    readonly key: string
}

export class NativeReplyGrant {
    readonly #key: string
    readonly #base: ReplyBlobBase
    #bound = false

    constructor(key: string, base: ReplyBlobBase) {
        this.#key = key
        this.#base = base
    }

    /** Binds once; null when the grant was bound before or the blob cannot be built. */
    static bind(grant: NativeReplyGrant, parse: OpenAIParseContext): NativeReplyOwner | null {
        if (grant.#bound) {
            return null
        }
        grant.#bound = true
        let blob: string
        try {
            blob = encodeReplyBlob(grant.#base, parse)
        } catch (error) {
            console.error(error)
            return null
        }
        const owner: NativeReplyOwner = Object.freeze({ key: grant.#key })
        pending.set(owner, { key: grant.#key, pageVersion: REPLY_BLOB_PAGE_VERSION, blob })
        noteBound(grant.#key)
        return owner
    }

    static is(value: unknown): value is NativeReplyGrant {
        return typeof value === 'object' && value !== null && #key in value
    }
}

/** Bound owners that no native fetch has taken yet; an object that is not a key here owns nothing. */
const pending = new WeakMap<NativeReplyOwner, NativeReplyOwnerArg>()

/** Issues the grant of `key` and records the send's interest in it. The record does not exist until a request owns it. */
export function issueNativeReplyGrant(key: string, base: ReplyBlobBase): NativeReplyGrant {
    holdInflight(key)
    return new NativeReplyGrant(key, base)
}

/** Binds a grant to the request that parses the reply; null for no grant, a lookalike, a second bind or a failed blob. */
export function bindGrant(grant: unknown, parse: OpenAIParseContext): NativeReplyOwner | null {
    if (!NativeReplyGrant.is(grant)) {
        return null
    }
    return NativeReplyGrant.bind(grant, parse)
}

/** What the native invoke carries, once: a second take, a lookalike and an unbound owner give null. */
export function takeReplyOwner(owner: unknown): NativeReplyOwnerArg | null {
    if (typeof owner !== 'object' || owner === null) {
        return null
    }
    const taken = pending.get(owner as NativeReplyOwner)
    if (taken === undefined) {
        return null
    }
    pending.delete(owner as NativeReplyOwner)
    return taken
}
