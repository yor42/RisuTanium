import { firstMessageOf } from '../process/firstMessage'
import type { character, groupChat } from '../storage/database.svelte'

/** What the tree model reads of a rendered branch node: its depth and the chat that created it. */
export type BranchNodeLike = { y: number, chatId: number }

export type BranchMove = 'up' | 'down' | 'left' | 'right' | 'home' | 'end'

type BranchOwner = Pick<character | groupChat, 'firstMessage' | 'alternateGreetings' | 'chats'>

/** The longest node name, in code points, ellipsis included. */
const NAME_LIMIT = 40

/**
 * The message a node stands for. A node at depth 0 is a chat's first message, which is not in `message`; a node at
 * depth `y` is `message[y - 1]`.
 */
export function branchNodeText(char: BranchOwner, obj: BranchNodeLike): string {
    const chat = char.chats[obj.chatId]
    if(obj.y === 0){
        return firstMessageOf(char, chat)
    }
    return chat.message[obj.y - 1]?.data ?? ''
}

/**
 * The accessible name of a node: the first line of its message that has a visible character, trimmed, with every
 * whitespace run collapsed to one space and cut to `NAME_LIMIT` code points. A message with no visible character is
 * named by `fallback`. The text is never read as markup.
 */
export function branchNodeName(text: string, fallback: string): string {
    const line = text.split(/\r\n|\n|\r/).find((candidate) => /\S/.test(candidate))
    if(line === undefined){
        return fallback
    }
    const collapsed = line.trim().replace(/\s+/g, ' ')
    const points = Array.from(collapsed)
    if(points.length <= NAME_LIMIT){
        return collapsed
    }
    return points.slice(0, NAME_LIMIT - 1).join('').trimEnd() + '…'
}

/**
 * The identity of a node across renders. Each chat adds one path to the prefix tree and the chat that created a node
 * is stored on it, so no two nodes of one render share a `(chatId, y)`.
 */
export function branchNodeKey(obj: BranchNodeLike): string {
    return `${obj.chatId}:${obj.y}`
}

/** The move a keydown asks for, or `null` for every other key and for any key with a modifier. */
export function classifyBranchKey(e: { key: string, altKey: boolean, ctrlKey: boolean, shiftKey: boolean, metaKey: boolean }): BranchMove | null {
    if(e.altKey || e.ctrlKey || e.shiftKey || e.metaKey){
        return null
    }
    switch(e.key){
        case 'ArrowUp':
            return 'up'
        case 'ArrowDown':
            return 'down'
        case 'ArrowLeft':
            return 'left'
        case 'ArrowRight':
            return 'right'
        case 'Home':
            return 'home'
        case 'End':
            return 'end'
        default:
            return null
    }
}

/**
 * Where a move from `nodes[index]` lands, or `null` when focus stays. `nodes` is in tree order: each node comes
 * before its subtree and the subtrees of later siblings. So the first child is the next node when it is one level
 * deeper, the parent is the nearest earlier node one level up, and the neighbours on a row are the nearest nodes of
 * the same depth in either direction. Only depth is read, never position, and nothing wraps.
 */
export function branchMoveTarget(nodes: readonly BranchNodeLike[], index: number, move: BranchMove): number | null {
    const from = nodes[index]
    if(!from){
        return null
    }
    switch(move){
        case 'down': {
            const next = nodes[index + 1]
            return next && next.y === from.y + 1 ? index + 1 : null
        }
        case 'up':
            return nearestAtDepth(nodes, index, from.y - 1, -1)
        case 'right':
            return nearestAtDepth(nodes, index, from.y, 1)
        case 'left':
            return nearestAtDepth(nodes, index, from.y, -1)
        case 'home': {
            let wanted = from.y - 1
            let found = index
            for(let i = index - 1; i >= 0 && wanted >= 0; i--){
                if(nodes[i].y === wanted){
                    found = i
                    wanted--
                }
            }
            return found === index ? null : found
        }
        case 'end': {
            let found = index
            while(nodes[found + 1] && nodes[found + 1].y === nodes[found].y + 1){
                found++
            }
            return found === index ? null : found
        }
    }
}

function nearestAtDepth(nodes: readonly BranchNodeLike[], index: number, depth: number, step: 1 | -1): number | null {
    if(depth < 0){
        return null
    }
    for(let i = index + step; i >= 0 && i < nodes.length; i += step){
        if(nodes[i].y === depth){
            return i
        }
    }
    return null
}

/**
 * The index of the node that carries `tabindex="0"`: the remembered node while it exists, else the node now at the
 * remembered index (clamped), else the first node. `null` when there are no nodes.
 */
export function resolveBranchStop(nodes: readonly BranchNodeLike[], remembered: { key: string, index: number } | null): number | null {
    if(nodes.length === 0){
        return null
    }
    if(remembered === null){
        return 0
    }
    const found = nodes.findIndex((node) => branchNodeKey(node) === remembered.key)
    if(found !== -1){
        return found
    }
    return Math.min(Math.max(remembered.index, 0), nodes.length - 1)
}
