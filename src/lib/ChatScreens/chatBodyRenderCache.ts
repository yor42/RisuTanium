import isEqual from 'lodash/isEqual'
import type { simpleCharacterArgument } from '../../ts/parser/parser.svelte'

// The last HTML a chat body showed, kept outside the component so a remount (the {#key} in Chat, the hash remount in
// Chats) can start from it instead of blank. Plain TS on purpose: no reactive reads, nothing here is tracked.

type CharArg = simpleCharacterArgument | string | null

/** Largest number of remembered bodies. Past it the oldest-used entry is dropped and its body blanks for one parse, as it did before the cache. */
export const RENDER_CACHE_CAPACITY = 200

/** Recorded for a body that is waiting for its first render, so the next instance of the slot shows the indicator. */
export const AWAITING = Symbol('awaiting')

interface Entry {
    source: string
    role: string | null
    charArg: CharArg
    value: string | typeof AWAITING
}

/** What a run was started with. `scope` names the open chat; `slot` names the message place inside it. */
export interface RenderFingerprint {
    scope: string
    slot: string
    source: string
    role: string | null
    charArg: CharArg
}

export type CacheLookup =
    { kind: 'html', html: string }
    | { kind: 'awaiting' }
    // An entry exists for the slot, but its source, role or character argument differs: its HTML belongs to other input.
    | { kind: 'stale' }
    | { kind: 'none' }

let currentScope: string | null = null
const entries = new Map<string, Entry>()

/** The scope of the open chat; the owner's chaId and the chat id, falling back to the page index for an id-less chat. */
export function scopeOf(chaId: string, chatId: string | undefined, chatPage: number): string {
    return chaId + '\u0000' + (chatId ?? ('page:' + chatPage))
}

// A group bookmark passes a string where Chats passes an object; the two are different inputs for the same index.
export function slotKeyOf(firstMessage: boolean, idx: number, charArg: CharArg): string {
    const charTag = charArg !== null && typeof charArg === 'object' ? 'o' : 's:' + (charArg ?? '')
    return `${firstMessage}|${idx}|${charTag}`
}

export function clearChatBodyRenderCache(): void {
    currentScope = null
    entries.clear()
}

function matches(entry: Entry, fp: RenderFingerprint): boolean {
    return entry.source === fp.source && entry.role === fp.role && isEqual(entry.charArg, fp.charArg)
}

export function lookup(fp: RenderFingerprint): CacheLookup {
    if(fp.scope !== currentScope){
        return { kind: 'none' }
    }
    const entry = entries.get(fp.slot)
    if(!entry){
        return { kind: 'none' }
    }
    if(!matches(entry, fp)){
        return { kind: 'stale' }
    }
    if(entry.value === AWAITING){
        return { kind: 'awaiting' }
    }
    // A hit counts as use.
    entries.delete(fp.slot)
    entries.set(fp.slot, entry)
    return { kind: 'html', html: entry.value }
}

/** Remembers what a body showed (a string) or that it is waiting for its first render (`AWAITING`). A new scope drops every older entry. */
export function record(fp: RenderFingerprint, value: string | typeof AWAITING): void {
    if(fp.scope !== currentScope){
        entries.clear()
        currentScope = fp.scope
    }
    entries.delete(fp.slot)
    entries.set(fp.slot, {
        source: fp.source,
        role: fp.role,
        charArg: fp.charArg,
        value,
    })
    if(entries.size > RENDER_CACHE_CAPACITY){
        const oldest = entries.keys().next()
        if(!oldest.done){
            entries.delete(oldest.value)
        }
    }
}

export interface SpinnerInput {
    /** The run is a translate or retranslate run (`retranslate || translated`). */
    translateRun: boolean
    showTranslationLoading: boolean
    /** The run was started by a render-revision change after the instance had rendered once. */
    revisionChanged: boolean
    /** The instance's own last rendered string, or null if it has not rendered one. */
    shown: string | null
    lookup: CacheLookup
}

/** Whether a translate run shows the translation spinner while it works. First matching rule wins. */
export function runShowsSpinner(input: SpinnerInput): boolean {
    if(!input.translateRun || !input.showTranslationLoading){
        return false
    }
    if(input.revisionChanged){
        return false
    }
    // A remounted body that has not rendered yet keeps the seeded translation; a body that already rendered a string
    // and is asked to translate shows the spinner.
    if(input.shown === null && input.lookup.kind === 'html'){
        return false
    }
    return true
}

export interface DisplayInput {
    /** The selected chat's modules are still loading. */
    pending: boolean
    runSpinner: boolean
    shown: string | null
    lookup: CacheLookup
    /** The run started on the last message while it was streaming. */
    streamingTail: boolean
}

export type PendingDisplay =
    { kind: 'html', html: string }
    | { kind: 'spinner' }
    | { kind: 'indicator' }
    | { kind: 'blank' }

/** What a body shows while its parse is unresolved, or when the parse returned nothing. First matching row wins. */
export function pendingDisplay(input: DisplayInput): PendingDisplay {
    const { pending, runSpinner, shown, lookup } = input
    if(pending && lookup.kind === 'html'){
        return { kind: 'html', html: lookup.html }
    }
    // While pending the instance's own string is never shown: it may belong to another message or chat.
    if(pending){
        return { kind: 'indicator' }
    }
    if(runSpinner){
        return { kind: 'spinner' }
    }
    if(shown !== null){
        return { kind: 'html', html: shown }
    }
    if(lookup.kind === 'html'){
        return { kind: 'html', html: lookup.html }
    }
    if(lookup.kind === 'awaiting'){
        return { kind: 'indicator' }
    }
    // The streaming reply remounts per chunk by design; it stays blank for the parse.
    if(lookup.kind === 'stale' && !input.streamingTail){
        return { kind: 'indicator' }
    }
    return { kind: 'blank' }
}
