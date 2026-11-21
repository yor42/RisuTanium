// The lorebook entries the latest send put into its prompt, for the list under that send's reply. Held in memory
// only: never saved, gone on reload, and replaced by the next send's scan (MC-3333). Leaf module: it imports only
// svelte/store, so chat components and suites that mock the app stores can load it.
import { writable, type Readable } from 'svelte/store'

export type LoreUseSource = 'character' | 'chat' | 'module'

/** One entry that reached a prompt, named where it lives: `index` is its position in that source's own list. */
export interface LoreUsedEntry {
    source: LoreUseSource
    /** The character's `chaId`, the chat's `id` or the module's `id`; empty when the scan could not tell. */
    ownerId: string
    index: number
    name: string
}

export interface LoreUseRecord {
    /** The `chatId` the send gives its reply message. */
    replyChatId: string
    entries: readonly LoreUsedEntry[]
}

/** The name a list shows for an entry: its comment, else its keys, as the lorebook editors name it. */
export function loreEntryName(entry: { comment?: string, key?: string } | undefined): string {
    return entry?.comment || entry?.key || ''
}

const latest = writable<LoreUseRecord | null>(null)

export const latestLoreUse: Readable<LoreUseRecord | null> = { subscribe: latest.subscribe }

/** Records a send's scan against the reply it will write. A scan that sent no entry clears the list. */
export function noteLoreUse(replyChatId: string, entries: readonly LoreUsedEntry[]): void {
    latest.set(entries.length === 0 ? null : { replyChatId, entries: [...entries] })
}

/** A continue that gives the extended reply a new `chatId` carries that reply's list over to it. */
export function renameLoreUseReply(oldId: string, newId: string): void {
    latest.update((record) => record && record.replyChatId === oldId ? { replyChatId: newId, entries: record.entries } : record)
}

/** The entries to show under a message: only the reply of the latest send has any. */
export function loreUseOf(record: LoreUseRecord | null, chatId: string | undefined): readonly LoreUsedEntry[] {
    if (!record || !chatId || record.replyChatId !== chatId) return []
    return record.entries
}

export interface LoreEntryTarget {
    owner: { type: LoreUseSource, id: string }
    kind: 'lore'
    /** Present only while the live list still holds an entry of the same name at the recorded index. */
    item?: string
}

/**
 * Where the lorebook editor opens for a listed entry. Entries can be moved, renamed or deleted after the send, so
 * the entry itself is named only when the live list still has the same name at that index; otherwise the editor
 * opens on the owner's lorebook list. The item id is the Studio's `<ownerId>/lore:<index>`.
 */
export function loreEntryTarget(entry: LoreUsedEntry, liveList: readonly { comment?: string, key?: string }[] | undefined): LoreEntryTarget {
    const target: LoreEntryTarget = { owner: { type: entry.source, id: entry.ownerId }, kind: 'lore' }
    const live = liveList?.[entry.index]
    if (live && loreEntryName(live) === entry.name) target.item = `${entry.ownerId}/lore:${entry.index}`
    return target
}
