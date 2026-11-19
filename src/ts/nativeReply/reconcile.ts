import { DBState } from '../stores.svelte'
import { isColdChat } from '../process/coldstorageData'
import type { RunSubject } from '../process/chatOrigin'
import { decodeReplyBlob, type ReplyBlob } from './blob'
import type { ParkedReply } from './parkedDialog'
import { consumeReply, heldReply } from './pageState'
import type { NativeReplyStore, ReplyListing } from './store'

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

/** `applied`: the reply is in the chat and awaits its save. `present`: it was there already. `deferred`: a send is running; the apply reruns after it. */
export type ApplyOutcome = 'applied' | 'present' | 'deferred' | 'failed'

export interface ReconcileDeps {
    store: Pick<NativeReplyStore, 'list' | 'readBody' | 'park' | 'discard'>
    /** Android, a writable page, first setup done, saving started and the page visible. */
    gate(): boolean
    /** Queues a note the person closes. */
    notice(text: string): void
    notes: ReconcileNotes
    /** The text of a finished body as the live request would have produced it; null when there is none. */
    recoverText(listing: ReplyListing, blob: ReplyBlob, bodyText: string): Promise<string | null>
    apply(input: RecoveredReplyInput): Promise<ApplyOutcome>
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
        const parsed = parseOpenAIChatBody(data, blob.parse, tools.subject)
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
