export type EnterMode = 'auto' | 'send' | 'newline'

const ENTER_MODE_KEY = 'risuChatShell.enterMode'

export function readEnterMode(sendWithEnter: boolean): EnterMode {
    const fallback: EnterMode = sendWithEnter ? 'auto' : 'newline'
    try {
        const stored = localStorage.getItem(ENTER_MODE_KEY)
        return stored === 'auto' || stored === 'send' || stored === 'newline' ? stored : fallback
    } catch {
        return fallback
    }
}

export function writeEnterMode(mode: EnterMode): void {
    try {
        localStorage.setItem(ENTER_MODE_KEY, mode)
    } catch {
        // The current session can continue when device storage is unavailable.
    }
}

export type ChatSort = 'recent' | 'manual'

const CHAT_SORT_KEY = 'risuChatShell.chatSort'

/** The chat-list order this device uses. An absent, unknown or unreadable value reads as 'recent' and is never rewritten. */
export function readChatSort(): ChatSort {
    try {
        const stored = localStorage.getItem(CHAT_SORT_KEY)
        return stored === 'recent' || stored === 'manual' ? stored : 'recent'
    } catch {
        return 'recent'
    }
}

export function writeChatSort(sort: ChatSort): void {
    try {
        localStorage.setItem(CHAT_SORT_KEY, sort)
    } catch {
        // The current session can continue when device storage is unavailable.
    }
}
