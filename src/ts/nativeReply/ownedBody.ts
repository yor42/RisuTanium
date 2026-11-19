import { heldReply, noteAnnounced, noteBodySource, notePageEnded, noteTerminal, type TerminalKnowledge } from './pageState'
import type { NativeReplyStore, ReplyListing, ReplyOutcome } from './store'

/**
 * Where the body of an owned request comes from. The native side keeps the reply in a record, so once the live branch
 * has settled one decision is made, once: the page-ended case takes the live result; otherwise the end stamp (or one
 * listing, on a visible page) says whether a stored `done` body exists, and then the record is the body. Anything else
 * takes the live result. Nothing here waits for a later event: an undecided key is left to the reconcile.
 */

/** What an owned request's end event carries about its record. */
export interface ReplyStamp {
    key: string
    outcome: ReplyOutcome
    stored: boolean
    /** Set when the native side told the person already; absent means the turn may be retried. */
    announced?: boolean
    /** The HTTP status of an announced stamp; the head may be lost, so the stamp carries it. */
    status?: number
}

const OUTCOMES: readonly string[] = ['done', 'failed', 'stopped']

export function parseReplyStamp(value: unknown): ReplyStamp | null {
    if (typeof value !== 'object' || value === null) {
        return null
    }
    const raw = value as Record<string, unknown>
    if (typeof raw.key !== 'string' || typeof raw.outcome !== 'string' || !OUTCOMES.includes(raw.outcome) || typeof raw.stored !== 'boolean') {
        return null
    }
    const stamp: ReplyStamp = { key: raw.key, outcome: raw.outcome as ReplyOutcome, stored: raw.stored }
    if (raw.announced === true) {
        stamp.announced = true
    }
    if (typeof raw.status === 'number' && Number.isInteger(raw.status)) {
        stamp.status = raw.status
    }
    return stamp
}

/** True only for the additive `announced: true` of a stamp or a listing: the person was told, whatever the outcome. */
export function wasAnnounced(source: { announced?: unknown } | null | undefined): boolean {
    return source?.announced === true
}

/**
 * True when the person was told of a failure the turn must not retry: an announced failed outcome or an announced done
 * whose HTTP status is not 2xx. It never reads `ok`: an announced 200 whose body is not JSON was told as a reply, so it
 * stays retryable. Every other failure stays retryable too.
 */
export function isAnnouncedFailure(source: { announced?: unknown } | null | undefined, knowledge: TerminalKnowledge | null): boolean {
    if (!wasAnnounced(source) || knowledge === null) {
        return false
    }
    if (knowledge.outcome === 'failed') {
        return true
    }
    return knowledge.outcome === 'done'
        && knowledge.status !== undefined
        && (knowledge.status < 200 || knowledge.status >= 300)
}

/** An owned request's event that has no pump left to receive it: its record may be ready for the reconcile. */
export function isOrphanReplyEvent(parsed: unknown): boolean {
    if (typeof parsed !== 'object' || parsed === null) {
        return false
    }
    const event = parsed as { type?: unknown, reply?: unknown }
    return event.type === 'stopped' || event.reply !== undefined
}

/** What the native event pump of one fetch learned; written by the pump, read when the live branch settles. */
export interface PumpProbe {
    /** The owner event's answer; null until it arrives. */
    owned: boolean | null
    head: { status: number, headers: { [key: string]: string } } | null
    stamp: ReplyStamp | null
    /** Ends the native request and the pump without an error; null until the pump exists. */
    abandon: (() => void) | null
}

export function createPumpProbe(): PumpProbe {
    return { owned: null, head: null, stamp: null, abandon: null }
}

export interface OwnedFetchResult {
    ok: boolean
    data: unknown
    headers: { [key: string]: string }
    status: number
    nativeFinal?: boolean
}

export interface OwnedFetchDeps {
    probe: PumpProbe
    /** The signal the request runs under: Stop, a relayed caller abort, a delete or a Trash of the chat. */
    signal: AbortSignal | undefined
    isVisible(): boolean
    /** Calls `callback` on every return to visible; the returned function stops it. */
    onVisible(callback: () => void): () => void
    store: Pick<NativeReplyStore, 'list' | 'readBody'>
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** What a listing says about the end of the record: only a terminal entry knows. A `done` body counts as stored when it was kept. */
function knowledgeOfListing(entry: ReplyListing | undefined): TerminalKnowledge | null {
    if (!entry || entry.state !== 'terminal' || entry.outcome === undefined) {
        return null
    }
    const stored = entry.outcome === 'done'
        && entry.bodyBytes !== undefined
        && entry.detail !== 'body-not-stored'
        && entry.detail !== 'body-too-large'
    return { outcome: entry.outcome, stored, status: entry.status }
}

function knowledgeOfStamp(stamp: ReplyStamp, headStatus: number | undefined): TerminalKnowledge {
    return { outcome: stamp.outcome, stored: stamp.stored, status: stamp.status ?? headStatus }
}

/**
 * The record as a fetch result, or null when the body could not be read (the caller keeps the live result). A body that
 * was read but is not JSON is a failure of the record itself, as the live read of the same body would be; the same text
 * fails the same way on every read, so the page may consume it.
 */
async function readRecord(
    key: string,
    deps: OwnedFetchDeps,
    listingStatus: number | undefined,
): Promise<OwnedFetchResult | null> {
    let text: string
    try {
        text = await deps.store.readBody(key)
    } catch (error) {
        console.error(error)
        return null
    }
    const head = deps.probe.head
    let data: unknown
    try {
        data = JSON.parse(text)
    } catch (error) {
        return { ok: false, data: `${error}`, headers: head?.headers ?? {}, status: head?.status ?? listingStatus ?? 400 }
    }
    const status = head?.status ?? listingStatus
    if (status !== undefined) {
        return { ok: status >= 200 && status < 300, data, headers: head?.headers ?? {}, status }
    }
    // Only the stamp was seen and the head was lost: the status is read from the body.
    const ok = !(isRecord(data) && 'error' in data)
    return { ok, data, headers: {}, status: ok ? 200 : 400 }
}

/**
 * Resolves an owned request. `live` is the request read from its events and never rejects. The first of the live
 * branch's settle and a visible return that finds a stored body decides; only the winner records what the page learned.
 */
export function resolveOwnedFetch(key: string, live: Promise<OwnedFetchResult>, deps: OwnedFetchDeps): Promise<OwnedFetchResult> {
    return new Promise<OwnedFetchResult>((resolve) => {
        let decided = false
        let observing = false

        const decide = (result: OwnedFetchResult, record: () => void): boolean => {
            if (decided) {
                return false
            }
            decided = true
            stopWatching()
            record()
            resolve(result)
            return true
        }

        // The page learned that the native side told the person; the send's finally reads it to skip its own notice.
        const noteTold = (source: { announced?: unknown } | null | undefined): void => {
            if (wasAnnounced(source)) {
                noteAnnounced(key)
            }
        }

        // While the live branch is pending a visible return can find the stored body. It observes and never waits.
        const observe = async (): Promise<void> => {
            if (decided || observing || deps.signal?.aborted || deps.probe.owned === false || !heldReply(key)?.invoked) {
                return
            }
            observing = true
            try {
                const entry = (await deps.store.list()).find((listing) => listing.key === key)
                const knowledge = knowledgeOfListing(entry)
                if (decided || knowledge === null || knowledge.outcome !== 'done' || !knowledge.stored) {
                    return
                }
                const record = await readRecord(key, deps, knowledge.status)
                if (record === null) {
                    return
                }
                const won = decide(isAnnouncedFailure(entry, knowledge) ? { ...record, nativeFinal: true } : record, () => {
                    noteTerminal(key, knowledge)
                    noteBodySource(key, 'record')
                    noteTold(entry)
                })
                if (won) {
                    deps.probe.abandon?.()
                }
            } catch (error) {
                console.error(error)
            } finally {
                observing = false
            }
        }
        const stopWatching = deps.onVisible(() => { void observe() })

        void live.then(async (liveResult) => {
            if (decided) {
                return
            }
            if (deps.signal?.aborted) {
                decide(liveResult, () => notePageEnded(key))
                return
            }
            const entry = heldReply(key)
            const probe = deps.probe
            if (!entry?.invoked || probe.owned === false) {
                decide(liveResult, () => {})
                return
            }
            let knowledge: TerminalKnowledge | null = null
            let source: { announced?: unknown } | null = null
            if (probe.stamp !== null) {
                knowledge = knowledgeOfStamp(probe.stamp, probe.head?.status)
                source = probe.stamp
            } else if (deps.isVisible()) {
                try {
                    const listing = (await deps.store.list()).find((candidate) => candidate.key === key)
                    knowledge = knowledgeOfListing(listing)
                    source = listing ?? null
                } catch (error) {
                    console.error(error)
                }
                if (decided) {
                    return
                }
            }
            // Final by outcome and status, never by `ok`: the record branch and the live branch decide it the same way.
            const final = isAnnouncedFailure(source, knowledge)
            if (knowledge !== null && knowledge.outcome === 'done' && knowledge.stored) {
                const record = await readRecord(key, deps, knowledge.status)
                if (decided) {
                    return
                }
                if (record !== null) {
                    const terminal = knowledge
                    decide(final ? { ...record, nativeFinal: true } : record, () => {
                        noteTerminal(key, terminal)
                        noteBodySource(key, 'record')
                        noteTold(source)
                    })
                    return
                }
            }
            const terminal = knowledge
            decide(final && !liveResult.ok ? { ...liveResult, nativeFinal: true } : liveResult, () => {
                if (terminal !== null) {
                    noteTerminal(key, terminal)
                }
                noteTold(source)
            })
        })
    })
}
