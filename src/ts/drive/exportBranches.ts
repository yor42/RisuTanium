/**
 * The `.bin` translation of alternatives (MC-774): a chat whose conversation continued from an alternative (the chain of
 * records below one branch point holds a message of the user) becomes an extra plain chat, as upstream's Branch button
 * writes it: the shared prefix of the active path, the chain, then upstream's own `branchedfrom` marker. Every other
 * leaf, and every record no chain reaches, is counted as left out. Nothing here mutates its input or touches storage:
 * message objects are shared read-only references, and the memory a branch chat carries is a copy.
 *
 * Export data is loosely shaped (units were written by older builds), so a chat is read structurally: an unreadable `alt`
 * is never interpreted, a name that is not a string reads as empty, and a message that cannot be measured only makes
 * the size estimate unknown.
 */
import type { Chat, ChatAlt, ChatAltMemory, Message } from '../storage/database.svelte'
import { BRANCH_FIELD_KEYS, branchState, treeLeaves, type TreeLeaf } from '../process/chatTree'
import { copyNameFor } from '../storage/store2/fastForward/chatCopy'
import { FORK_ONLY_CHAT_KEYS, chatLabelKey, forkOnlyChatLabels, forkOnlyKindsOf, type ForkOnlyChatLabel, type ForkOnlyKind } from './exportAlternatives'

type BranchKey = typeof BRANCH_FIELD_KEYS[number]

/** Which chats of a character are expanded: decided per chat and its position in the chat list. */
export type BranchExpand = (chat: Chat, index: number) => boolean

export interface BranchPlan {
    /** The leaves that become chats, in export order. */
    kept: TreeLeaf[]
    /** Leaves that are not kept, plus the records no chain reaches. */
    omitted: number
}

export interface BranchSummary {
    chats: number
    omitted: number
    /** The estimated bytes the branch chats add; null when a message cannot be measured. */
    bytes: number | null
    /** The fork-only kinds the branch chats carry, in table order. */
    kinds: ForkOnlyKind[]
}

export interface ExpandedCharacter<T> {
    character: T
    /** For the j-th appended chat, the index of the chat it was cut from. */
    parents: number[]
}

function isObjectValue(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A chat of loosely shaped export data; `treeLeaves` refuses a chat whose `message` or `alt` cannot be read. */
function isChatLike(value: unknown): value is Chat {
    return isObjectValue(value)
}

// ---- The marker ----

/**
 * One rule per token the CBS tokeniser acts on (`parser.svelte.ts`): the role tags it rewrites to `{{user}}`, the openers
 * `{{` and `{#`, the closers `#}` and `}}`, and the `::` the renderer splits on. Every rule shortens the text.
 */
const MARKER_NAME_RULES: readonly (readonly [RegExp, string])[] = [
    [/<(user|char|bot)>/gi, '$1'],
    [/\{[{#]/g, '{'],
    [/[#}]\}/g, '}'],
    [/:{2,}/g, ':'],
    [/:+$/, ''],
]

/**
 * The chat name as the marker may carry it: no token the parser acts on and no `::`. The rules run until a pass changes
 * nothing, because removing one token can join its neighbours into another (`<<user>>`, `{{#`).
 */
export function markerName(name: unknown): string {
    let text = typeof name === 'string' ? name : ''
    for (;;) {
        let next = text
        for (const [pattern, replacement] of MARKER_NAME_RULES) {
            next = next.replace(pattern, replacement)
        }
        if (next === text) {
            return text
        }
        text = next
    }
}

/** A chat or message id as the marker may carry it: ids made of letters, digits, `_` and `-` pass; anything else reads as no id. */
export function markerIdField(id: unknown): string {
    return typeof id === 'string' && /^[A-Za-z0-9_-]+$/.test(id) ? id : ''
}

/** The text upstream's Branch writes: `{{specialcomment::branchedfrom::<parent id>::<parent name>::<message id>::}}`. */
export function branchMarkerData(parentId: unknown, parentName: unknown, pointId: unknown): string {
    return `{{specialcomment::branchedfrom::${markerIdField(parentId)}::${markerName(parentName)}::${markerIdField(pointId)}::}}`
}

// ---- The plan ----

/**
 * Which leaves become chats: those whose chain holds a message of the user, ordered by branch point (the root first),
 * then by departure stamp, then by list position. Null when `alt` cannot be read.
 */
export function branchPlanOf(chat: Chat): BranchPlan | null {
    const tree = treeLeaves(chat)
    if (tree === null) {
        return null
    }
    const alt = chat.alt ?? []
    const kept = tree.leaves.filter((leaf) => leaf.chain.some((k) => alt[k].m.role === 'user'))
    kept.sort((a, b) => {
        const lastA = a.chain[a.chain.length - 1]
        const lastB = b.chain[b.chain.length - 1]
        return a.attachAt - b.attachAt || alt[lastA].a - alt[lastB].a || lastA - lastB
    })
    return { kept, omitted: tree.leaves.length - kept.length + tree.unreachable.length }
}

function idsOf(messages: readonly Message[]): Set<string> {
    const ids = new Set<string>()
    for (const message of messages) {
        if (message.chatId) {
            ids.add(message.chatId)
        }
    }
    return ids
}

/**
 * The branch state the leaf's chat holds: the memory parked on the first record of the leaf's own run, else the live
 * memory trimmed to the branch. Everything is a copy.
 */
function branchMemoryOf(chat: Chat, alt: readonly ChatAlt[], leaf: TreeLeaf): ChatAltMemory {
    let head = leaf.chain.length - 1
    while (head > 0 && alt[leaf.chain[head - 1]].a === alt[leaf.chain[head]].a) {
        head--
    }
    const mem: unknown = alt[leaf.chain[head]].mem
    const parked = isObjectValue(mem) ? mem as ChatAltMemory : undefined
    const prefix = chat.message.slice(0, leaf.attachAt + 1)
    const chain = leaf.chain.map((k) => alt[k].m)
    return branchState(chat, idsOf(chat.message.slice(leaf.attachAt + 1)), idsOf([...prefix, ...chain]), parked, true).next
}

function setBranchKey<K extends BranchKey>(fields: Chat, next: ChatAltMemory, key: K): void {
    const value = next[key]
    if (value === null || value === undefined) {
        Reflect.deleteProperty(fields, key)
    } else {
        fields[key] = value as Chat[K]
    }
}

/**
 * The fields of a branch chat before its id, name and marker: the parent without its alternatives, folder, suggestions
 * and streaming flag, with the branch state of `next` and the given messages. The one place both the builder and the
 * kind computation read, so they cannot disagree.
 */
function branchChatFields(parent: Chat, next: ChatAltMemory, message: Message[]): Chat {
    const fields: Chat = { ...parent, message }
    delete fields.alt
    delete fields.folderId
    delete fields.suggestMessages
    delete fields.isStreaming
    for (const key of BRANCH_FIELD_KEYS) {
        setBranchKey(fields, next, key)
    }
    return fields
}

/** The bookmarks of the parent that name a message the branch chat holds; a key with nothing left is absent. */
function bookmarksOf(parent: Chat, ids: ReadonlySet<string>): Pick<Chat, 'bookmarks' | 'bookmarkNames'> {
    const kept: Pick<Chat, 'bookmarks' | 'bookmarkNames'> = {}
    if (Array.isArray(parent.bookmarks)) {
        const bookmarks = parent.bookmarks.filter((id) => ids.has(id))
        if (bookmarks.length > 0) {
            kept.bookmarks = bookmarks
        }
    }
    if (isObjectValue(parent.bookmarkNames)) {
        const names = Object.entries(parent.bookmarkNames).filter(([id]) => ids.has(id))
        if (names.length > 0) {
            kept.bookmarkNames = Object.fromEntries(names)
        }
    }
    return kept
}

function nameOf(chat: Chat): string {
    return typeof chat.name === 'string' ? chat.name : ''
}

/**
 * The branch chats of one parent, in export order. `parentId` is the id the markers name; `taken` holds every chat
 * name in use and receives the names given here; `newId` supplies the ids of each marker message and each chat.
 */
export function branchChatsOf(parent: Chat, parentId: string, taken: Set<string>, newId: () => string): Chat[] {
    const plan = branchPlanOf(parent)
    const alt = parent.alt
    if (plan === null || alt === undefined) {
        return []
    }
    return plan.kept.map((leaf) => {
        const prefix = parent.message.slice(0, leaf.attachAt + 1)
        const chain = leaf.chain.map((k) => alt[k].m)
        const marker: Message = {
            role: 'char',
            data: branchMarkerData(parentId, parent.name, leaf.attachAt >= 0 ? parent.message[leaf.attachAt].chatId : undefined),
            isComment: true,
            disabled: true,
            chatId: newId(),
        }
        const held = [...prefix, ...chain]
        const fields = branchChatFields(parent, branchMemoryOf(parent, alt, leaf), [...held, marker])
        delete fields.bookmarks
        delete fields.bookmarkNames
        Object.assign(fields, bookmarksOf(parent, idsOf(held)))
        fields.id = newId()
        fields.name = copyNameFor(nameOf(parent), taken, 'Branch')
        taken.add(fields.name)
        return fields
    })
}

/**
 * `character` with the branch chats of every chat that `expand` accepts appended after its existing chats, so
 * `chatPage` keeps its index; the input itself when nothing is added. A parent without an id gets one on its copy.
 * `parents[j]` is the chat the j-th appended chat was cut from.
 */
export function expandBranchChats<T extends { chats: Chat[] }>(character: T, expand: BranchExpand, newId: () => string): ExpandedCharacter<T> {
    if (!isObjectValue(character)) {
        return { character, parents: [] }
    }
    const loose: unknown = character.chats
    if (!Array.isArray(loose)) {
        return { character, parents: [] }
    }
    const chats: unknown[] = loose
    const taken = new Set<string>()
    for (const chat of chats) {
        if (isChatLike(chat) && typeof chat.name === 'string') {
            taken.add(chat.name)
        }
    }
    const stamped: unknown[] = [...chats]
    const added: Chat[] = []
    const parents: number[] = []
    chats.forEach((chat, index) => {
        if (!isChatLike(chat)) {
            return
        }
        const plan = branchPlanOf(chat)
        if (plan === null || plan.kept.length === 0 || !expand(chat, index)) {
            return
        }
        let parent = chat
        if (typeof chat.id !== 'string' || chat.id === '') {
            parent = { ...chat, id: newId() }
            stamped[index] = parent
        }
        for (const branch of branchChatsOf(parent, parent.id ?? '', taken, newId)) {
            added.push(branch)
            parents.push(index)
        }
    })
    if (added.length === 0) {
        return { character, parents: [] }
    }
    return { character: { ...character, chats: [...stamped, ...added] }, parents }
}

// ---- The estimate and the labels ----

/** The kinds in the order of the fork-only table, each once. */
const KIND_ORDER: readonly ForkOnlyKind[] = [...new Set(FORK_ONLY_CHAT_KEYS.flatMap((row) => row.kind === null ? [] : [row.kind]))]

function inTableOrder(kinds: Iterable<ForkOnlyKind>): ForkOnlyKind[] {
    const present = new Set(kinds)
    return KIND_ORDER.filter((kind) => present.has(kind))
}

/** The keys of the parent that a branch chat does not copy as they are; the rest of the parent is the same JSON in each. */
const SHELL_OMITTED: ReadonlySet<string> = new Set(['message', 'alt', 'folderId', 'suggestMessages', 'isStreaming', 'bookmarks', 'bookmarkNames', ...BRANCH_FIELD_KEYS])

/** A stand-in for the id of a marker message; real ones are uuids. */
const PLACEHOLDER_ID = '0'.repeat(36)

/** The branch state without its absent fields, as the branch chat holds it. */
function presentMemory(next: ChatAltMemory): Record<string, unknown> {
    return Object.fromEntries(Object.entries(next).filter(([, value]) => value !== null && value !== undefined))
}

function jsonBytes(value: unknown): number {
    return new TextEncoder().encode(JSON.stringify(value)).length
}

/**
 * What the alternatives become: the chats and left-out replies the plan gives (the same plan the builder runs), the
 * estimated bytes and the fork-only kinds the branch chats carry. Null when `alt` cannot be read.
 */
export function branchSummaryOf(chat: Chat): BranchSummary | null {
    const plan = branchPlanOf(chat)
    const alt = chat.alt
    if (plan === null) {
        return null
    }
    if (alt === undefined || plan.kept.length === 0) {
        return { chats: 0, omitted: plan.omitted, bytes: 0, kinds: [] }
    }
    const kinds = new Set<ForkOnlyKind>()
    const memories = plan.kept.map((leaf) => {
        const next = branchMemoryOf(chat, alt, leaf)
        for (const kind of forkOnlyKindsOf(branchChatFields(chat, next, leaf.chain.map((k) => alt[k].m)))) {
            kinds.add(kind)
        }
        return next
    })
    let bytes: number | null = null
    try {
        const shell = jsonBytes(Object.fromEntries(Object.entries(chat).filter(([key]) => !SHELL_OMITTED.has(key)))) + 96
        const prefixBytes: number[] = [0]
        for (const message of chat.message) {
            prefixBytes.push(prefixBytes[prefixBytes.length - 1] + jsonBytes(message) + 1)
        }
        let total = 0
        plan.kept.forEach((leaf, n) => {
            const held = [...chat.message.slice(0, leaf.attachAt + 1), ...leaf.chain.map((k) => alt[k].m)]
            const marker: Message = {
                role: 'char',
                data: branchMarkerData(PLACEHOLDER_ID, chat.name, leaf.attachAt >= 0 ? PLACEHOLDER_ID : undefined),
                isComment: true,
                disabled: true,
                chatId: PLACEHOLDER_ID,
            }
            const chainBytes = leaf.chain.reduce((sum, k) => sum + jsonBytes(alt[k].m) + 1, 0)
            total += shell + prefixBytes[leaf.attachAt + 1] + chainBytes + jsonBytes(marker) + 1
                + jsonBytes(presentMemory(memories[n])) + jsonBytes(bookmarksOf(chat, idsOf(held)))
        })
        bytes = total
    } catch {
        bytes = null
    }
    return { chats: plan.kept.length, omitted: plan.omitted, bytes, kinds: inTableOrder(kinds) }
}

function chatsOfCharacter(character: unknown): unknown[] | null {
    return isObjectValue(character) && Array.isArray(character.chats) ? character.chats : null
}

/**
 * `forkOnlyChatLabels`, with the alternatives label of each chat that `expand` accepts naming what the alternatives
 * become (`branches`) and the kinds of the branch chats. A chat whose `alt` cannot be read keeps its plain label.
 */
export function branchChatLabels(character: unknown, expand: BranchExpand): ForkOnlyChatLabel[] {
    const labels = forkOnlyChatLabels(character)
    const chats = chatsOfCharacter(character)
    if (chats === null) {
        return labels
    }
    let at = 0
    chats.forEach((chat, index) => {
        if (forkOnlyKindsOf(chat).length === 0) {
            return
        }
        const label = labels[at++]
        if (!label.kinds.includes('alternatives') || !isChatLike(chat) || !expand(chat, index)) {
            return
        }
        const summary = branchSummaryOf(chat)
        if (summary !== null) {
            labels[at - 1] = {
                ...label,
                kinds: inTableOrder([...label.kinds, ...summary.kinds]),
                branches: { chats: summary.chats, omitted: summary.omitted, bytes: summary.bytes },
            }
        }
    })
    return labels
}

/**
 * The labels of the unexpanded `original`, with the kinds of the branch chats `expanded` really holds added to the
 * label of the chat each was cut from: what the strip removes from the written chats, for the after-export notice.
 */
export function lateBranchLabels<T extends { chats: Chat[] }>(original: T, expanded: ExpandedCharacter<T>): ForkOnlyChatLabel[] {
    const labels = forkOnlyChatLabels(original)
    const firstAdded = original.chats.length
    expanded.parents.forEach((parentIndex, j) => {
        const key = chatLabelKey(original, original.chats[parentIndex], parentIndex)
        const found = labels.findIndex((label) => label.key === key)
        if (found !== -1) {
            labels[found] = { ...labels[found], kinds: inTableOrder([...labels[found].kinds, ...forkOnlyKindsOf(expanded.character.chats[firstAdded + j])]) }
        }
    })
    return labels
}
