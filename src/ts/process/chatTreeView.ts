import type { Chat, Message } from '../storage/database.svelte'
import { isChatAltReadable } from './chatTree'

/** Where a path message stands among the messages that can take its position. */
export interface SiblingPosition {
    /** The place of the path message in display order, counted from 1. */
    index: number
    /** How many messages can stand at the position, the path message included. */
    count: number
}

export interface TreeView {
    /** The sibling position of path message `i`; null when `i` is not a path position. */
    at(i: number): SiblingPosition | null
    /** How many records follow the last path message (the root for an empty path). */
    continuation: number
}

const ROOT = 'R'

function byDisplayOrder(a: Message, b: Message): number {
    const timeA = a.time ?? 0
    const timeB = b.time ?? 0
    if (timeA !== timeB) {
        return timeA - timeB
    }
    const idA = a.chatId ?? ''
    const idB = b.chatId ?? ''
    return idA < idB ? -1 : idA > idB ? 1 : 0
}

/**
 * The sibling counts a row shows, from one pass over the path and one over `alt`. It follows the order
 * and owner rules of `siblingsAt` in `chatTree.ts`: a record's parent resolves to the first path message
 * holding that id, otherwise to the first record holding it (then the record is not a child of the
 * path), otherwise to the root. A chat whose `alt` cannot be read has an empty view: every position
 * holds its own message alone and nothing follows the last one.
 */
export function treeView(chat: Chat): TreeView {
    const path = Array.isArray(chat.message) ? chat.message : []
    const pathFirst = new Map<string, number>()
    for (let k = 0; k < path.length; k++) {
        const id = path[k].chatId
        if (id && !pathFirst.has(id)) {
            pathFirst.set(id, k)
        }
    }
    const heads = new Map<string, Message[]>()
    if (chat.alt !== undefined && isChatAltReadable(chat)) {
        const altIds = new Set<string>()
        for (const record of chat.alt) {
            const id = record.m.chatId
            if (id) {
                altIds.add(id)
            }
        }
        for (const record of chat.alt) {
            const p = record.p
            let owner = ROOT
            if (p !== null) {
                const onPath = pathFirst.get(p)
                if (onPath !== undefined) {
                    owner = `P${onPath}`
                } else if (altIds.has(p)) {
                    continue
                }
            }
            const list = heads.get(owner)
            if (list) {
                list.push(record.m)
            } else {
                heads.set(owner, [record.m])
            }
        }
    }
    const ownerBefore = (i: number): string | null => {
        if (i === 0) {
            return ROOT
        }
        const id = path[i - 1].chatId
        return id && pathFirst.get(id) === i - 1 ? `P${i - 1}` : null
    }
    const ownerOfEnd = ownerBefore(path.length)
    return {
        at(i: number): SiblingPosition | null {
            if (!Number.isInteger(i) || i < 0 || i >= path.length) {
                return null
            }
            const owner = ownerBefore(i)
            const others = owner === null ? [] : heads.get(owner) ?? []
            const all = [path[i], ...others].sort(byDisplayOrder)
            return { index: all.indexOf(path[i]) + 1, count: all.length }
        },
        continuation: ownerOfEnd === null ? 0 : (heads.get(ownerOfEnd) ?? []).length,
    }
}
