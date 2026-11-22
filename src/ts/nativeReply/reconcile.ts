import { DBState } from '../stores.svelte'
import { isColdChat } from '../process/coldstorageData'
import type { RunSubject } from '../process/chatOrigin'
import { decodeReplyBlob, isStreamReplyBlob, type ReplyBlob, type StreamReplyBlob } from './blob'
import type { ParkedReply } from './parkedDialog'
import { consumeReply, heldReply } from './pageState'
import type { NativeReplyStore, ReplyListing, ReplyListingState, ReplyOutcome } from './store'
import type { UsageMeterState } from '../usage/usageTypes'

/**
 * Places the replies that were recorded while this page could not see them (the page was frozen, killed or reloaded):
 * at launch and on every return to visible. A reply whose message is already in the chat is consumed, an absent one is
 * appended, one whose chat is gone or in Trash is parked for the person to decide, and anything the page cannot read is
 * kept and reported. Every pass runs on a visible, writable page and never reads a cold character or chat as gone.
 */

export interface ReconcileNotes {
    failedElsewhere(name: string): string
    stoppedElsewhere(name: string): string
    interrupted(name: string): string
    unreadable(key: string, problem: string): string
}

export interface RecoveredReplyInput {
    key: string
    blob: ReplyBlob
    /** The finished text: parsed, escaped, replaced and trimmed. */
    text: string
}

/**
 * What a replayed stream record hands the apply. `complete` is a whole body; otherwise `modelText` is the text of a prefix
 * of one. `modelText` is untrimmed and unscripted, as the stream's consumer holds it. `meter` carries the usage the replay
 * found, and `how` is how the usage settles when the reply is written.
 */
export interface RecoveredStreamInput {
    key: string
    blob: StreamReplyBlob
    modelText: string
    complete: boolean
    outcome: ReplyOutcome | ReplyListingState
    meter: UsageMeterState
    how: 'finished' | 'failed'
}

/**
 * `applied`: the reply is in the chat and awaits its save. `present`: it was there already; a stream apply marks and holds
 * it for the save like an applied one, so the reconcile never consumes on it. `deferred`: a send is running; the apply
 * reruns after it.
 */
export type ApplyOutcome = 'applied' | 'present' | 'deferred' | 'failed'

export interface ReconcileDeps {
    store: Pick<NativeReplyStore, 'list' | 'readBody' | 'readBodyBytes' | 'readPartialBytes' | 'park' | 'discard'>
    /** Android, a writable page, first setup done, saving started and the page visible. */
    gate(): boolean
    /** Queues a note the person closes. */
    notice(text: string): void
    notes: ReconcileNotes
    /** The text of a finished body as the live request would have produced it; null when there is none. */
    recoverText(listing: ReplyListing, blob: ReplyBlob, bodyText: string): Promise<string | null>
    apply(input: RecoveredReplyInput): Promise<ApplyOutcome>
    /** Reads the bytes of a recorded stream through the transform the live request used; `modelText` is empty when they hold no reply. */
    replayStream(blob: StreamReplyBlob, bytes: Uint8Array, complete: boolean): Promise<{ modelText: string, meter: UsageMeterState }>
    /** Applies a replayed stream record: upgrades an interrupted message, appends an absent one, or holds a present one. */
    applyStream(input: RecoveredStreamInput): Promise<ApplyOutcome>
    /** Settles the usage of a reply that is parked instead of applied; the apply settles its own. */
    settleUsage(blob: StreamReplyBlob, meter: UsageMeterState, how: 'finished' | 'failed', modelText: string): void
    /** Brings the cold character back; true when it is warm afterwards. */
    restoreCharacter(chaId: string): Promise<boolean>
    preLoadChat(characterIndex: number, chatIndex: number): Promise<unknown>
    /** Shows the parked replies in turn. */
    showParked(items: ParkedReply[]): Promise<void>
}

export interface Reconciler {
    /** Runs a pass, or marks the running one to run again; resolves when no pass is left to run. */
    request(): Promise<void>
    /** Reports a record that cannot be read: one note per record per launch. It never removes the record. */
    reportUnreadable(key: string, problem: string): void
}

export type TargetState =
    | { kind: 'gone' }
    | { kind: 'trashed' }
    | { kind: 'ambiguous' }
    | { kind: 'cold-character' }
    | { kind: 'cold-chat', characterIndex: number, chatIndex: number }
    | { kind: 'present' }
    | { kind: 'ok' }

/**
 * Where the reply of `blob` stands in the live database, read in one synchronous stretch. A cold character or chat is
 * never "gone": it is brought back first. Callers read it again after every await.
 */
export function targetStateOf(blob: ReplyBlob, key: string): TargetState {
    const characters = DBState.db?.characters ?? []
    const holders: number[] = []
    for (let index = 0; index < characters.length; index++) {
        if (characters[index]?.chaId === blob.target.chaId) {
            holders.push(index)
        }
    }
    if (holders.length === 0) {
        return { kind: 'gone' }
    }
    const characterIndex = holders[0]
    const owner = characters[characterIndex]
    if (holders.length === 1 && owner.trashTime) {
        return { kind: 'trashed' }
    }
    if (holders.length > 1) {
        return { kind: 'ambiguous' }
    }
    if (owner.coldstorage) {
        return { kind: 'cold-character' }
    }
    const chats = Array.isArray(owner.chats) ? owner.chats : []
    const chatIndexes: number[] = []
    for (let index = 0; index < chats.length; index++) {
        if (chats[index]?.id === blob.target.chatId) {
            chatIndexes.push(index)
        }
    }
    if (chatIndexes.length === 0) {
        return { kind: 'gone' }
    }
    if (chatIndexes.length > 1) {
        return { kind: 'ambiguous' }
    }
    const chat = chats[chatIndexes[0]]
    if (isColdChat(chat)) {
        return { kind: 'cold-chat', characterIndex, chatIndex: chatIndexes[0] }
    }
    if (chat.message.some((message) => message.chatId === key)) {
        return { kind: 'present' }
    }
    return { kind: 'ok' }
}

export interface RecoverTools {
    escape(text: string): string
    /** The plugins' after-request replacers, in order. */
    replacers(text: string): Promise<string>
    subject?: RunSubject
}

/**
 * The finished text of a recorded body, or null when the body holds no reply: not JSON, a non-2xx status, an `error`
 * field, a body the parser cannot read, or an empty text. It reads the body through the one parser the live request
 * uses, then applies the escape and the replacers the live path applies after a single-text success, and trims. The
 * first candidate of a multiline answer is taken as the live path takes it: without the escape and the replacers.
 */
export async function recoveredText(
    status: number | undefined,
    bodyText: string,
    blob: ReplyBlob,
    tools: RecoverTools,
): Promise<string | null> {
    const parse = blob.parse
    if (parse.kind !== 'openai-chat') {
        // A stream record is read by the stream path; its body is never sniffed as a JSON body.
        return null
    }
    let data: unknown
    try {
        data = JSON.parse(bodyText)
    } catch {
        return null
    }
    if (status !== undefined && (status < 200 || status >= 300)) {
        return null
    }
    // Loaded here, not at the top: the parser module graph is big and boot reaches this module without needing it.
    const { isOpenAIChatBody, parseOpenAIChatBody } = await import('../process/request/openAI/chatBodyParse')
    if (!isOpenAIChatBody(data) || Object.prototype.hasOwnProperty.call(data, 'error')) {
        return null
    }
    let text: string
    let single: boolean
    try {
        const parsed = parseOpenAIChatBody(data, parse, tools.subject)
        single = parsed.type !== 'multiline'
        text = parsed.type === 'multiline' ? (parsed.result[0]?.[1] ?? '') : parsed.result
    } catch {
        return null
    }
    // The live request escapes and replaces only a single-text success; a multiline first candidate is pushed raw.
    if (single) {
        if (blob.escape) {
            text = tools.escape(text)
        }
        text = await tools.replacers(text)
    }
    text = text.trim()
    return text === '' ? null : text
}

export function createReconciler(deps: ReconcileDeps): Reconciler {
    // One launch's memory: notes, unreadable reports, queued dialogs and the cold restores already tried.
    const reported = new Set<string>()
    const restoreTried = new Set<string>()
    const preLoadTried = new Set<string>()
    let current: Promise<void> | null = null
    let rerun = false

    function once(token: string): boolean {
        if (reported.has(token)) {
            return false
        }
        reported.add(token)
        return true
    }

    function reportUnreadable(key: string, problem: string): void {
        if (once(`unreadable:${key}`)) {
            deps.notice(deps.notes.unreadable(key, problem))
        }
    }

    function noteOnce(key: string, text: string): void {
        if (once(`note:${key}`)) {
            deps.notice(text)
        }
    }

    /** Brings a cold character or chat back, once per launch per key, and reads the state again. */
    async function settleTarget(blob: ReplyBlob, key: string): Promise<TargetState> {
        let state = targetStateOf(blob, key)
        if (state.kind === 'cold-character' && !restoreTried.has(key)) {
            restoreTried.add(key)
            await deps.restoreCharacter(blob.target.chaId)
            state = targetStateOf(blob, key)
        }
        if (state.kind === 'cold-chat' && !preLoadTried.has(key)) {
            preLoadTried.add(key)
            await deps.preLoadChat(state.characterIndex, state.chatIndex)
            state = targetStateOf(blob, key)
        }
        return state
    }

    async function queueParked(listing: ReplyListing, blob: ReplyBlob, text: string, items: ParkedReply[]): Promise<void> {
        if (once(`dialog:${listing.key}`)) {
            items.push({ key: listing.key, name: blob.targetName, text, createdMs: listing.createdMs ?? 0 })
        }
    }

    async function placeFinished(listing: ReplyListing, blob: ReplyBlob, text: string, items: ParkedReply[]): Promise<void> {
        const key = listing.key
        const state = await settleTarget(blob, key)
        switch (state.kind) {
            case 'gone':
            case 'trashed':
                try {
                    await deps.store.park(key)
                } catch (error) {
                    console.error(error)
                    return
                }
                await queueParked(listing, blob, text, items)
                return
            case 'present':
                await consumeReply(key)
                return
            case 'ok': {
                const outcome = await deps.apply({ key, blob, text })
                if (outcome === 'failed') {
                    noteOnce(`apply:${key}`, deps.notes.failedElsewhere(blob.targetName))
                }
                return
            }
            default:
                // Ambiguous, or still cold after the one try: the record is kept for a later pass.
                return
        }
    }

    /** The note of a record that ended without a reply the person can read as finished; null for a state that has no end yet. */
    function endNote(listing: ReplyListing, blob: ReplyBlob): string | null {
        if (listing.state === 'incomplete' || listing.state === 'dead') {
            return deps.notes.interrupted(blob.targetName)
        }
        if (listing.state !== 'terminal') {
            return null
        }
        switch (listing.outcome) {
            case 'failed':
            case 'done':
                return deps.notes.failedElsewhere(blob.targetName)
            case 'stopped':
                return deps.notes.stoppedElsewhere(blob.targetName)
            default:
                return null
        }
    }

    /**
     * A stream record: a finished one (`terminal` and `done`) is read from its body, one that did not finish from the raw
     * bytes kept beside it (`partialBytes`). The bytes are replayed through the live transform and the apply decides what
     * the chat does with the text. A record whose message exists is consumed only through the save waiter the apply sets
     * up; these rows consume at once: no text, no body, and a partial whose chat is gone.
     */
    async function handleStream(listing: ReplyListing, blob: StreamReplyBlob, items: ParkedReply[]): Promise<void> {
        const key = listing.key
        const complete = listing.state === 'terminal' && listing.outcome === 'done'
        const partial = !complete && (listing.partialBytes ?? 0) > 0
        const note = endNote(listing, blob)
        if (!complete && !partial) {
            if (note !== null) {
                noteOnce(key, note)
                await consumeReply(key)
            }
            return
        }
        let bytes: Uint8Array
        try {
            bytes = complete ? await deps.store.readBodyBytes(key) : await deps.store.readPartialBytes(key)
        } catch (error) {
            // An IO error is not an answer about the reply: the record is kept.
            console.error(error)
            return
        }
        // The live request keeps a stream only for status 200, not any 2xx; a partial implies it.
        const readable = !complete || listing.status === undefined || listing.status === 200
        let replayed: { modelText: string, meter: UsageMeterState } | null = null
        if (readable) {
            try {
                replayed = await deps.replayStream(blob, bytes, complete)
            } catch (error) {
                // A replay that throws never consumes: the record is kept and reported.
                console.error(error)
                reportUnreadable(key, 'the stream record cannot be replayed')
                return
            }
        }
        const text = replayed === null ? '' : replayed.modelText.trim()
        if (replayed === null || text === '') {
            if (listing.parked) {
                reportUnreadable(key, 'the parked reply no longer reads as text')
                return
            }
            if (note !== null) {
                noteOnce(key, note)
            }
            await consumeReply(key)
            return
        }
        if (complete && listing.parked) {
            await queueParked(listing, blob, text, items)
            return
        }
        const how = listing.outcome === 'failed' ? 'failed' : 'finished'
        const state = await settleTarget(blob, key)
        switch (state.kind) {
            case 'gone':
            case 'trashed':
                if (!complete) {
                    // Rust parks only finished records: the person is told and the record goes.
                    if (note !== null) {
                        noteOnce(key, note)
                    }
                    await consumeReply(key)
                    return
                }
                try {
                    await deps.store.park(key)
                } catch (error) {
                    console.error(error)
                    return
                }
                await queueParked(listing, blob, text, items)
                // Once, right after the park: the parked record is never replayed for usage again.
                deps.settleUsage(blob, replayed.meter, how, replayed.modelText)
                return
            case 'present':
            case 'ok': {
                const outcome = await deps.applyStream({
                    key,
                    blob,
                    modelText: replayed.modelText,
                    complete,
                    outcome: listing.outcome ?? listing.state,
                    meter: replayed.meter,
                    how,
                })
                if (outcome === 'applied' || outcome === 'present') {
                    if (!complete && note !== null) {
                        noteOnce(key, note)
                    }
                } else if (outcome === 'failed' && note !== null) {
                    noteOnce(`apply:${key}`, note)
                }
                return
            }
            default:
                // Ambiguous, or still cold after the one try: the record is kept for a later pass.
                return
        }
    }

    async function handle(listing: ReplyListing, items: ParkedReply[]): Promise<void> {
        const key = listing.key
        if (listing.state === 'live') {
            return
        }
        const held = heldReply(key)
        if (held && (held.state === 'inflight' || held.state === 'awaiting-save')) {
            return
        }
        if (held && held.state === 'release') {
            await consumeReply(key)
            return
        }
        if (listing.state === 'unreadable') {
            reportUnreadable(key, listing.problem ?? 'the record cannot be read')
            return
        }
        const decoded = decodeReplyBlob(listing.blob, listing.pageVersion)
        if (!('blob' in decoded)) {
            reportUnreadable(key, decoded.problem)
            return
        }
        const blob = decoded.blob
        if (isStreamReplyBlob(blob)) {
            await handleStream(listing, blob, items)
            return
        }
        if (listing.state === 'incomplete' || listing.state === 'dead') {
            noteOnce(key, deps.notes.interrupted(blob.targetName))
            await consumeReply(key)
            return
        }
        if (listing.state !== 'terminal') {
            return
        }
        if (listing.outcome === 'failed' || listing.outcome === 'stopped') {
            noteOnce(key, listing.outcome === 'failed'
                ? deps.notes.failedElsewhere(blob.targetName)
                : deps.notes.stoppedElsewhere(blob.targetName))
            await consumeReply(key)
            return
        }
        if (listing.outcome !== 'done') {
            return
        }
        let bodyText: string
        try {
            bodyText = await deps.store.readBody(key)
        } catch (error) {
            // An IO error is not an answer about the reply: the record is kept.
            console.error(error)
            return
        }
        const text = await deps.recoverText(listing, blob, bodyText)
        if (text === null) {
            if (listing.parked) {
                // Discard is the person's act: a parked record that no longer reads as text stays parked and is reported.
                reportUnreadable(key, 'the parked reply no longer reads as text')
                return
            }
            noteOnce(key, deps.notes.failedElsewhere(blob.targetName))
            await consumeReply(key)
            return
        }
        if (listing.parked) {
            await queueParked(listing, blob, text, items)
            return
        }
        await placeFinished(listing, blob, text, items)
    }

    async function pass(): Promise<void> {
        if (!deps.gate()) {
            return
        }
        let listings: ReplyListing[]
        try {
            listings = await deps.store.list()
        } catch (error) {
            console.error(error)
            return
        }
        // The list was a wait: the page may have hidden or stopped saving meanwhile.
        if (!deps.gate()) {
            return
        }
        const items: ParkedReply[] = []
        for (const listing of listings) {
            try {
                await handle(listing, items)
            } catch (error) {
                console.error(error)
            }
        }
        if (items.length > 0) {
            await deps.showParked(items)
        }
    }

    return {
        request(): Promise<void> {
            if (current !== null) {
                rerun = true
                return current
            }
            current = (async () => {
                try {
                    do {
                        rerun = false
                        await pass()
                    } while (rerun)
                } finally {
                    current = null
                }
            })()
            return current
        },
        reportUnreadable,
    }
}
