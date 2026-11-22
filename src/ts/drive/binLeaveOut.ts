/**
 * Bin Leave-Out
 *
 * What a `.bin` export leaves out because upstream has no place for it, as one summary the export hands to a single
 * leave-out sheet instead of seven prompts. The summary lists the kinds in the order the per-kind prompts ask them, and a
 * kind that is absent from the profile is absent from the list, so an empty list means there is nothing to confirm.
 *
 * Pure: it reads the labels the export already computed and never changes them.
 */

import { FORK_ONLY_CHAT_KEYS, type ForkOnlyChatLabel, type ForkOnlyKind } from './exportAlternatives'

export type BinLeaveOutEntry =
    /** Chats whose alternatives are written as extra chats or left out. `branchChats` is the extra chats written. */
    | { kind: 'alternatives', count: number, labels: readonly ForkOnlyChatLabel[], branchChats: number }
    /** Chats that lose a kind of fork-only data other than alternatives. `kinds` are those kinds in table order. */
    | { kind: 'forkChatData', count: number, labels: readonly ForkOnlyChatLabel[], kinds: readonly ForkOnlyKind[] }
    | { kind: 'taskPresets', count: number, names: readonly string[] }
    | { kind: 'themePacks', count: number, names: readonly string[] }
    | { kind: 'usageStats', count: 1 }
    | { kind: 'chroMemory', count: 1 }
    /** Unsent message edits and long-chat hint flags: drafts edits across all chats, hintChats chats whose hint flag is set. */
    | { kind: 'chatDrafts', drafts: number, hintChats: number }

export interface BinLeaveOutInput {
    /** Every chat that loses fork-only data, as the export labelled them. */
    chats: readonly ForkOnlyChatLabel[]
    taskPresets: readonly string[]
    themePacks: readonly string[]
    usageStats: boolean
    chroMemory: boolean
    /** What the profile holds of the unsent edits and hint flags; both zero means there is nothing to leave out. */
    chatDrafts: { drafts: number, hintChats: number }
}

/** The kinds the chat table names, in table order. */
const CHAT_KIND_ORDER: readonly ForkOnlyKind[] = FORK_ONLY_CHAT_KEYS
    .map((row) => row.kind)
    .filter((kind, index, all): kind is ForkOnlyKind => kind !== null && all.indexOf(kind) === index)

export function binLeaveOutSummary(input: BinLeaveOutInput): BinLeaveOutEntry[] {
    const summary: BinLeaveOutEntry[] = []
    const alternatives = input.chats.filter((label) => label.kinds.includes('alternatives'))
    if (alternatives.length > 0) {
        const branchChats = alternatives.reduce((sum, label) => sum + (label.branches?.chats ?? 0), 0)
        summary.push({ kind: 'alternatives', count: alternatives.length, labels: alternatives, branchChats })
    }
    const forkChats = input.chats.filter((label) => label.kinds.some((kind) => kind !== 'alternatives'))
    if (forkChats.length > 0) {
        const kinds = CHAT_KIND_ORDER.filter((kind) => kind !== 'alternatives' && forkChats.some((label) => label.kinds.includes(kind)))
        summary.push({ kind: 'forkChatData', count: forkChats.length, labels: forkChats, kinds })
    }
    if (input.taskPresets.length > 0) {
        summary.push({ kind: 'taskPresets', count: input.taskPresets.length, names: input.taskPresets })
    }
    if (input.themePacks.length > 0) {
        summary.push({ kind: 'themePacks', count: input.themePacks.length, names: input.themePacks })
    }
    if (input.usageStats) {
        summary.push({ kind: 'usageStats', count: 1 })
    }
    if (input.chroMemory) {
        summary.push({ kind: 'chroMemory', count: 1 })
    }
    if (input.chatDrafts.drafts > 0 || input.chatDrafts.hintChats > 0) {
        summary.push({ kind: 'chatDrafts', drafts: input.chatDrafts.drafts, hintChats: input.chatDrafts.hintChats })
    }
    return summary
}
