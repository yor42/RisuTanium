// SLICE1_SPEC §5.1-5.2: unavailable ids stay in storage so a returning action retains its position.
export const ACTION_IDS = ['copy', 'selectText', 'edit', 'translate', 'readAloud', 'stepPrev', 'stepNext', 'newReply', 'branch', 'bookmark', 'hideAI', 'delete', 'deleteAfter', 'customizeButtons'] as const
export type ActionId = typeof ACTION_IDS[number] | `plugin:${string}`
export interface ActionSlots { order: ActionId[]; pinned: ActionId[] }
export const DEFAULT_PINNED: ActionId[] = ['edit', 'delete']
export const NARROW_PIN_LIMIT = 3
export const WIDE_PIN_LIMIT = 6
const KEY = 'risuChatShell.actionSlots'
const DEFAULT_ORDER: ActionId[] = ['edit', 'delete', 'copy', 'translate', 'readAloud', 'selectText', 'stepPrev', 'stepNext', 'newReply', 'branch', 'bookmark', 'hideAI', 'deleteAfter', 'customizeButtons']

function isActionId(value: string): value is ActionId {
    return ACTION_IDS.some(id => id === value) || value.startsWith('plugin:') && value.length > 7
}

function ids(value: unknown): ActionId[] {
    if (!Array.isArray(value)) return []
    const result: ActionId[] = []
    for (const item of value) {
        if (typeof item === 'string' && isActionId(item) && !result.includes(item)) result.push(item)
    }
    return result
}

export function readSlots(): ActionSlots {
    try {
        const raw = localStorage.getItem(KEY)
        if (raw === null) return { order: [...DEFAULT_ORDER], pinned: [...DEFAULT_PINNED] }
        const value: unknown = JSON.parse(raw)
        if (typeof value !== 'object' || value === null || !('order' in value) || !('pinned' in value) || !Array.isArray(value.order) || !Array.isArray(value.pinned)) {
            return { order: [...DEFAULT_ORDER], pinned: [...DEFAULT_PINNED] }
        }
        return { order: ids(value.order), pinned: ids(value.pinned) }
    } catch {
        return { order: [...DEFAULT_ORDER], pinned: [...DEFAULT_PINNED] }
    }
}

export function writeSlots(slots: ActionSlots): void {
    try {
        localStorage.setItem(KEY, JSON.stringify({ order: ids(slots.order), pinned: ids(slots.pinned) }))
    } catch {
        // The current session can continue when device storage is unavailable.
    }
}

export function partition(slots: ActionSlots, availableActions: readonly ActionId[], limit = NARROW_PIN_LIMIT): { pinned: ActionId[]; overflow: ActionId[] } {
    const available = ids(availableActions)
    const order = [...ids(slots.order), ...available.filter(id => !slots.order.includes(id))]
    const pinned = order.filter(id => available.includes(id) && slots.pinned.includes(id) && id !== 'deleteAfter').slice(0, Math.max(0, limit))
    const overflow = order.filter(id => available.includes(id) && !pinned.includes(id))
    // SLICE1_SPEC §5.2: Delete remains reachable even when a caller omitted it from a scoped list.
    if (!pinned.includes('delete') && !overflow.includes('delete')) overflow.push('delete')
    return { pinned, overflow }
}
