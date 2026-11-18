/**
 * The lorebook rule tester's runner: one dry run of the real lorebook scan over
 * a private copy of a character and its context chat, plus the typed text.
 *
 * Nothing here writes live data. The scan runs against a sandbox subject that
 * resolves to the copy and whose save mark does nothing, and the scan's flag
 * writes (`@@keep_activate_after_match` and friends) land in the copy. The copy
 * is made key by key so the character's other chats and the chat's memory and
 * branch fields are never read (`copyOwnFields`, `OWNER_SKIP`, `CHAT_SKIP`).
 */
import type { Chat, character, loreBook, Message } from '../storage/database.svelte'
import type { OriginContext, RunSubject } from '../process/chatOrigin'
import {
    loadLoreBookV3Prompt,
    type LoreEntryRecord,
    type LoreHitAt,
    type LoreScanBegin,
    type LoreScanFinal,
    type LoreScanProbe,
} from '../process/lorebook.svelte'
import { getModules } from '../process/modules'
import { isModuleStub } from '../storage/moduleStub'
import { promptViewOf, splitSentMessages } from '../cbs'
import { DBState } from '../stores.svelte'
import { CHAT_SKIP, OWNER_SKIP } from './loreTestFields'

export type LoreTestRefusal = 'missing' | 'group' | 'cold' | 'restricted'

export type LoreTestAt =
    /** `position` is the 1-based place of the message in the stored chat. */
    | { kind: 'message', position: number }
    | { kind: 'typed' }
    | { kind: 'entry', index: number, label: string }

export type LoreTestReason =
    | { kind: 'matched', key: string, at: LoreTestAt }
    | { kind: 'always', linked: boolean }
    | { kind: 'forced', decorator: string }
    | { kind: 'kept' }
    | { kind: 'noKey' }
    | { kind: 'noMatch', query: 'key' | 'secondkey' | 'additional' }
    | { kind: 'excluded', key: string, at: LoreTestAt }
    | { kind: 'excludedNoHit', decorator: string }
    | { kind: 'decorator', name: string }
    | { kind: 'spent' }
    | { kind: 'linkedOff' }
    | { kind: 'invalidRegex', key: string }

export type LoreTestOwner = {
    type: 'character' | 'chat' | 'module'
    /** The chat's id or the module's id; null for the character. */
    id: string | null
    /** Place of the entry in its owner's lorebook. */
    index: number
}

export interface LoreTestEntry {
    /** Place in the scan's combined list: character, then chat, then module entries. */
    index: number
    label: string
    folder: boolean
    owner: LoreTestOwner | null
    activated: boolean
    reason: LoreTestReason
    /** For an activated entry: how the token budget and `@@inject_lore` treated it. */
    outcome: 'kept' | 'cut' | 'injectTargetMissing' | 'merged' | null
    mergedInto: string | null
    warnings: { kind: 'invalidRegex', key: string }[]
    tokens: number | null
    /** 1-based place among the kept entries, in prompt order. */
    order: number | null
    /** Percent chance a real send keeps the entry, when it has `@@probability`. */
    chance: number | null
}

export interface LoreTestResult {
    status: 'ok'
    contextChat: { name: string } | null
    messageAdded: boolean
    budget: { used: number, limit: number }
    scanDepth: number
    attribution: 'ok' | 'unavailable'
    entries: LoreTestEntry[]
}

export type LoreTestOutcome = LoreTestResult | { status: 'refused', reason: LoreTestRefusal }

/**
 * Copies `live`'s own keys one by one. A key in `skip` is never read, so a
 * skipped value is neither touched nor cloned; every other value is cloned on
 * its own, reading through a reactive proxy when `live` is one.
 */
export function copyOwnFields(live: object, skip: ReadonlySet<string>): Record<string, unknown> {
    const copy: Record<string, unknown> = {}
    for (const key of Object.keys(live)) {
        if (skip.has(key)) {
            continue
        }
        const value: unknown = (live as Record<string, unknown>)[key]
        copy[key] = typeof value === 'object' && value !== null ? safeStructuredClone(value) : value
    }
    return copy
}

interface ModuleRange {
    id: string
    lore: loreBook[]
}

/** Where a chat position says the tested message sits, for the explanation. */
export interface LoreTraceContext {
    labelOf(index: number): string
    isFolder(index: number): boolean
    ownerOf(index: number): LoreTestOwner | null
    /** Maps an index into the scanned messages to its stored chat position. */
    positionOf(scanned: number): { position: number, typed: boolean }
}

export interface LoreTrace {
    begin: LoreScanBegin
    records: ReadonlyMap<number, LoreEntryRecord>
    final: LoreScanFinal
}

function atOf(at: LoreHitAt, context: LoreTraceContext): LoreTestAt {
    if ('message' in at) {
        const { position, typed } = context.positionOf(at.message)
        return typed ? { kind: 'typed' } : { kind: 'message', position }
    }
    return { kind: 'entry', index: at.entry, label: context.labelOf(at.entry) }
}

function chanceOf(percents: number[]): number | null {
    if (percents.length === 0) {
        return null
    }
    let chance = 1
    for (const percent of percents) {
        // The scan keeps an entry unless `roll * 100 > percent`, so NaN always keeps it.
        chance *= Number.isNaN(percent) ? 1 : Math.min(1, Math.max(0, percent / 100))
    }
    return Math.round(chance * 10000) / 100
}

function whyActive(record: LoreEntryRecord, context: LoreTraceContext): LoreTestReason {
    if (record.forcedBy === 'activate') {
        return { kind: 'forced', decorator: 'activate' }
    }
    if (record.forcedBy === 'keep_activate_after_match') {
        return { kind: 'kept' }
    }
    if (record.alwaysActive) {
        return { kind: 'always', linked: record.child === 'linked' }
    }
    for (const query of record.queries) {
        if ((query.kind === 'key' || query.kind === 'secondkey' || query.kind === 'additional') && query.hits.length > 0) {
            return { kind: 'matched', key: query.hits[0].key, at: atOf(query.hits[0].at, context) }
        }
    }
    return { kind: 'always', linked: false }
}

function whyInactive(record: LoreEntryRecord, context: LoreTraceContext): LoreTestReason {
    if (record.skipped === 'noKey') {
        return { kind: 'noKey' }
    }
    if (record.forcedBy === 'dont_activate') {
        return { kind: 'decorator', name: 'dont_activate' }
    }
    if (record.forcedBy === 'dont_activate_after_match') {
        return { kind: 'spent' }
    }
    if (record.child === 'originalActive' || record.child === 'noOriginal') {
        return { kind: 'linkedOff' }
    }
    if (record.blockedBy.length > 0) {
        return { kind: 'decorator', name: record.blockedBy[0] }
    }
    // The query that ended the evaluation is the last one: the scan stops at the first that decides.
    const decided = record.queries[record.queries.length - 1]
    if (!decided) {
        return { kind: 'noMatch', query: 'key' }
    }
    if (decided.kind === 'exclude' || decided.kind === 'excludeAll') {
        if (decided.hits.length > 0) {
            return { kind: 'excluded', key: decided.hits[0].key, at: atOf(decided.hits[0].at, context) }
        }
        return { kind: 'excludedNoHit', decorator: decided.kind === 'excludeAll' ? 'exclude_keys_all' : 'exclude_keys' }
    }
    if (decided.invalidRegex !== undefined) {
        return { kind: 'invalidRegex', key: decided.invalidRegex }
    }
    return { kind: 'noMatch', query: decided.kind }
}

/** Turns what the scan reported into one explained row per entry, in scan order. Pure. */
export function explainLoreTrace(trace: LoreTrace, context: LoreTraceContext): LoreTestEntry[] {
    const keptOrder = new Map<number, number>()
    trace.final.kept.forEach((index, place) => keptOrder.set(index, place + 1))
    const cut = new Set(trace.final.cut)
    const dead = new Set(trace.final.deadInjectors)
    const mergedInto = new Map<number, number>()
    for (const merge of trace.final.merged) {
        mergedInto.set(merge.index, merge.into)
    }
    const entries: LoreTestEntry[] = []
    for (let index = 0; index < trace.begin.total; index++) {
        const record = trace.records.get(index)
        if (!record) {
            continue
        }
        const entry: LoreTestEntry = {
            index,
            label: context.labelOf(index),
            folder: context.isFolder(index),
            owner: context.ownerOf(index),
            activated: record.activated,
            reason: record.activated ? whyActive(record, context) : whyInactive(record, context),
            outcome: null,
            mergedInto: null,
            warnings: [],
            tokens: record.activated ? record.tokens ?? null : null,
            order: null,
            chance: chanceOf(record.probability),
        }
        if (record.activated) {
            for (const query of record.queries) {
                if (query.invalidRegex !== undefined) {
                    entry.warnings.push({ kind: 'invalidRegex', key: query.invalidRegex })
                }
            }
            if (cut.has(index)) {
                entry.outcome = 'cut'
            }
            else if (dead.has(index)) {
                entry.outcome = 'injectTargetMissing'
            }
            else if (mergedInto.has(index)) {
                entry.outcome = 'merged'
                entry.mergedInto = context.labelOf(mergedInto.get(index))
            }
            else if (keptOrder.has(index)) {
                entry.outcome = 'kept'
                entry.order = keptOrder.get(index)
            }
        }
        entries.push(entry)
    }
    return entries
}

function freshChat(): Chat {
    return { message: [], note: '', name: '', localLore: [], scriptstate: {} }
}

/**
 * Runs the scan once for `chaId`'s character with `text` as a new last user
 * message (none when `text` is blank). The whole copy is taken in the first
 * synchronous turn, before the first await, so a later edit can never reach
 * the run half-way.
 */
export async function runLoreTest(input: { chaId: string, text: string }): Promise<LoreTestOutcome> {
    const characters = DBState.db.characters
    const ownerIndex = characters.findIndex((candidate) => candidate.chaId === input.chaId)
    const live = ownerIndex === -1 ? undefined : characters[ownerIndex]
    if (!live) {
        return { status: 'refused', reason: 'missing' }
    }
    if (live.type === 'group') {
        return { status: 'refused', reason: 'group' }
    }
    if (live.coldstorage) {
        return { status: 'refused', reason: 'cold' }
    }
    if (live.license === 'private') {
        return { status: 'refused', reason: 'restricted' }
    }

    // The one live read of `chats`: the context chat at the page the user is on.
    const chatPage = live.chatPage
    const liveChat: Chat | undefined = live.chats[chatPage]
    const chatCopy = (liveChat ? copyOwnFields(liveChat, CHAT_SKIP) : freshChat()) as unknown as Chat
    if (!Array.isArray(chatCopy.message)) {
        chatCopy.message = []
    }
    const typed = input.text.trim() !== ''
    if (typed) {
        const message: Message = { role: 'user', data: input.text, time: Date.now() }
        chatCopy.message.push(message)
    }
    const ownerCopy = copyOwnFields(live, OWNER_SKIP) as unknown as character
    const chats: Chat[] = []
    chats[chatPage] = chatCopy
    ownerCopy.chats = chats

    const context: OriginContext = {
        owner: ownerCopy,
        ownerIndex,
        chat: chatCopy,
        chatIndex: chatPage,
        member: null,
        memberIndex: null,
    }
    const subject: RunSubject = {
        origin: { chaId: input.chaId, chatId: chatCopy.id ?? '' },
        resolve: () => context,
        status: () => 'ok',
        memberStatus: () => null,
        mark: () => {},
    }
    const split = splitSentMessages(chatCopy.message)
    const promptView = promptViewOf(split, split.resetAt === -1)

    const ranges: ModuleRange[] = []
    for (const module of getModules(subject)) {
        if (!module || isModuleStub(module) || !module.lorebook) {
            continue
        }
        ranges.push({ id: module.id, lore: module.lorebook })
    }

    const seen: { begin: LoreScanBegin | null, final: LoreScanFinal | null } = { begin: null, final: null }
    const records = new Map<number, LoreEntryRecord>()
    const probe: LoreScanProbe = {
        roll: () => 0,
        begin: (info) => { seen.begin = info },
        entry: (record) => { records.set(record.index, record) },
        final: (info) => { seen.final = info },
    }
    await loadLoreBookV3Prompt(subject, promptView, probe)
    const { begin, final } = seen
    if (!begin || !final) {
        throw new Error('The lorebook scan did not report its result.')
    }

    const moduleTotal = ranges.reduce((sum, range) => sum + range.lore.length, 0)
    const attributed = begin.characterCount === (ownerCopy.globalLore?.length ?? 0)
        && begin.chatCount === (chatCopy.localLore?.length ?? 0)
        && begin.total === begin.characterCount + begin.chatCount + moduleTotal

    const locate = (index: number): { lore: loreBook, owner: LoreTestOwner | null } | null => {
        if (index < begin.characterCount) {
            return { lore: ownerCopy.globalLore[index], owner: attributed ? { type: 'character', id: null, index } : null }
        }
        const inChat = index - begin.characterCount
        if (inChat < begin.chatCount) {
            return { lore: chatCopy.localLore[inChat], owner: attributed ? { type: 'chat', id: chatCopy.id ?? null, index: inChat } : null }
        }
        if (!attributed) {
            return null
        }
        let rest = inChat - begin.chatCount
        for (const range of ranges) {
            if (rest < range.lore.length) {
                return { lore: range.lore[rest], owner: { type: 'module', id: range.id, index: rest } }
            }
            rest -= range.lore.length
        }
        return null
    }
    const typedIndex = typed ? chatCopy.message.length - 1 : -1
    const traceContext: LoreTraceContext = {
        labelOf: (index) => {
            const lore = locate(index)?.lore
            return lore ? (lore.comment || lore.key || '') : ''
        },
        isFolder: (index) => locate(index)?.lore?.mode === 'folder',
        ownerOf: (index) => locate(index)?.owner ?? null,
        positionOf: (scanned) => {
            const chatIndex = split.chatIndexes[scanned]
            return { position: chatIndex + 1, typed: chatIndex === typedIndex }
        },
    }
    const entries = explainLoreTrace({ begin, records, final }, traceContext)
    let used = 0
    for (const entry of entries) {
        if (entry.outcome === 'kept' || entry.outcome === 'merged') {
            used += entry.tokens ?? 0
        }
    }
    return {
        status: 'ok',
        contextChat: liveChat ? { name: chatCopy.name } : null,
        messageAdded: typed,
        budget: { used, limit: begin.budget },
        scanDepth: begin.scanDepth,
        attribution: attributed ? 'ok' : 'unavailable',
        entries,
    }
}
