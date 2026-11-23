import type { StreamParseContext } from './blob'
import { bindStreamGrant, type NativeReplyOwner } from './grant'
import { createPumpProbe, isAnnouncedFailure, knowledgeOfStamp, type PumpProbe } from './ownedBody'
import { consumeReply, heldReply, noteAnnounced, notePageEnded, noteReplyPushed, noteTerminal, ownsPushedReply, type ConsumeResult } from './pageState'
import { markCharacterForSave } from '../storage/characterSaveMarks'

/**
 * The page-side facts of an owned stream request, kept per reply: the probe of the request's event pump is registered
 * under the reply's generationId, and nothing here reads a unit, the selection or the current chat. Two live owned
 * requests never settle, announce, abandon or consume each other.
 */

const ownedProbes = new Map<string, PumpProbe>()

/**
 * The probe of the stream request that bound `key`'s grant. Every stamp the pump learns is noted as `key`'s terminal
 * knowledge, and an announced one also tells the send's finally the person was told; a stamp of another key is ignored.
 */
export function createStreamProbe(key: string): PumpProbe {
    const probe = createPumpProbe()
    probe.onStamp = (stamp) => {
        if (stamp.key !== key) {
            return
        }
        noteTerminal(key, knowledgeOfStamp(stamp, probe.head?.status))
        if (stamp.announced === true) {
            noteAnnounced(key)
        }
    }
    ownedProbes.set(key, probe)
    return probe
}

/**
 * The page stopped reading `key`'s owned request: its end is the page's own, and the native request is abandoned so
 * Rust ends it `stopped` (or has already ended it) and the record is consumed at settle. A refused owner has no record
 * and keeps today's unowned behaviour, so it is only noted; an owner not yet answered is abandoned, since a record may
 * be open. Idempotent.
 */
export function endOwnedRead(key: string): void {
    notePageEnded(key)
    const probe = ownedProbes.get(key)
    if (probe !== undefined && probe.owned !== false) {
        probe.abandon?.()
    }
}

/**
 * The stream branch of `key`'s send ended. With the reply still in memory (`reply`) the character is marked and the
 * waiter's target is read after the mark, so the save that covers the mark also covers the settled reply; the record is
 * consumed only after that commit. Without a reply the page's read just ended (`endOwnedRead`). `saveMarkCount` is the
 * page's save-request counter, handed in so this module stays free of the page's save machinery.
 */
export function settleOwnedStreamEnd(key: string, reply: { chaId: string, saveMarkCount: () => number } | null): void {
    if (reply !== null && ownsPushedReply(key)) {
        markCharacterForSave(reply.chaId)
        noteReplyPushed(key, reply.chaId, reply.saveMarkCount())
        return
    }
    endOwnedRead(key)
}

/**
 * The unit settled: `key`'s probe is dropped. A key still `inflight` whose end the page has not noted is one the page
 * will never read again, so it is ended first; every designed path has noted it already and this only deletes.
 */
export function forgetOwnedStream(key: string): void {
    if (!ownedProbes.has(key)) {
        return
    }
    const entry = heldReply(key)
    if (entry?.state === 'inflight' && entry.pageEnded !== true) {
        endOwnedRead(key)
    }
    ownedProbes.delete(key)
}

/** Removes the record of a stream attempt the page read to its end and will not use (a non-200 or non-SSE head). */
export function retireOwnedStream(key: string): Promise<ConsumeResult> {
    return consumeReply(key)
}

/** What a stream request needs to bind the send's grant: the same fields on every provider's request argument. */
export interface OwnedStreamRequest {
    nativeReplyGrant?: unknown
    chatId?: string
    abortSignal?: AbortSignal | null
    replyUsageModelKey?: string
    usageInputEstimate?: number
}

/**
 * Binds the send's grant to this stream request, reading the reply with parse, and registers the probe of its event
 * pump. Null when the request owns nothing (no grant, a lookalike, a second bind, another reply's request, or no input
 * estimate), which leaves the request unowned. Stop and a chat delete reach the request through the abort signal, also
 * before the consumer pushes.
 */
export function bindOwnedStream(req: OwnedStreamRequest, parse: StreamParseContext): { owner: NativeReplyOwner, probe: PumpProbe } | null {
    const owner = bindStreamGrant(req.nativeReplyGrant, req.chatId, parse, {
        modelKey: req.replyUsageModelKey ?? '',
        inputEstimate: req.usageInputEstimate,
    })
    if (owner === null) {
        return null
    }
    const probe = createStreamProbe(owner.key)
    req.abortSignal?.addEventListener('abort', () => endOwnedRead(owner.key), { once: true })
    return { owner, probe }
}

/**
 * Retires an owned attempt the page read to its end and will not use, before any retry pushes. True when the pump's stamp
 * announced a failure, which ends the turn (an announced failure is final); the stamp is read after the record is
 * removed, so an end the pump learned meanwhile counts.
 */
export async function retireFailedHead(key: string, probe: PumpProbe, status: number | undefined): Promise<boolean> {
    await retireOwnedStream(key)
    const stamp = probe.stamp ?? null
    return stamp !== null && isAnnouncedFailure(stamp, knowledgeOfStamp(stamp, status))
}

export function resetOwnedStreamsForTests(): void {
    ownedProbes.clear()
}
