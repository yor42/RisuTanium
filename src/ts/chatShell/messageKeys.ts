import type { ActionId } from './actionSlots'

export type MessageKeyAction = ActionId | 'openActions' | 'activate' | 'close' | 'focusPrev' | 'focusNext' | 'focusFirst' | 'focusLast' | 'none'
export interface MessageKeyEvent { key: string; ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean; shiftKey?: boolean; repeat?: boolean }
export interface MessageKeyContext { focus: 'message' | 'alternatives' | 'control' | 'other'; index: number; count: number; newestCharacter: boolean; firstMessage?: boolean; selectedText?: boolean; control?: ActionId; now: number }
export const GENERATE_GUARD_MS = 500

// SLICE1_SPEC §3.1 and §5.5: pager keys browse; only an explicit regenerate path may generate.
export function createMessageKeys() {
    let lastPageChange = -Infinity
    let lastGenerate = -Infinity
    function markPageChange(now: number): void { lastPageChange = now }
    function handle(event: MessageKeyEvent, context: MessageKeyContext): MessageKeyAction {
        const focused = context.focus !== 'other'
        const modified = !!(event.ctrlKey || event.altKey || event.metaKey)
        if (event.key === 'Escape') return focused ? 'close' : 'none'
        if (event.ctrlKey && event.altKey && event.key.toLowerCase() === 'r') {
            if (event.repeat || !context.newestCharacter && !context.firstMessage) return 'none'
            if (context.index < context.count - 1) { markPageChange(context.now); return 'stepNext' }
            if (context.firstMessage || context.now - lastPageChange < GENERATE_GUARD_MS || context.now - lastGenerate < GENERATE_GUARD_MS) return 'none'
            lastGenerate = context.now
            return 'newReply'
        }
        if (!focused || modified) {
            if (focused && (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'c' && !context.selectedText) return 'copy'
            return 'none'
        }
        if (event.key === 'Delete') return event.shiftKey ? 'deleteAfter' : 'delete'
        if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') return 'openActions'
        if (context.focus === 'message' || context.focus === 'alternatives') {
            if (event.key === 'ArrowLeft' && context.index > 0) { markPageChange(context.now); return 'stepPrev' }
            if (event.key === 'ArrowRight' && context.index < context.count - 1) { markPageChange(context.now); return 'stepNext' }
        }
        if (context.focus === 'message') {
            if (event.key === 'ArrowUp') return 'focusPrev'
            if (event.key === 'ArrowDown') return 'focusNext'
            if (event.key === 'Home') return 'focusFirst'
            if (event.key === 'End') return 'focusLast'
            if (event.key === 'Enter') return 'openActions'
        }
        if (context.focus === 'control' && (event.key === 'Enter' || event.key === ' ')) {
            if (context.control === 'newReply') {
                if (event.repeat || context.firstMessage || context.now - lastPageChange < GENERATE_GUARD_MS || context.now - lastGenerate < GENERATE_GUARD_MS) return 'none'
                lastGenerate = context.now
            }
            return context.control ?? 'activate'
        }
        return 'none'
    }
    return { handle, markPageChange }
}
