export const DEFAULT_CHAT_LOAD_INITIAL_PAGES = 30
export const DEFAULT_CHAT_LOAD_ADDITIONAL_PAGES = 15

export function normalizeChatLoadPages(value: unknown, fallback: number): number {
    const fallbackValue = Number.isFinite(fallback) && fallback >= 1
        ? Math.floor(fallback)
        : 1
    const numberValue = typeof value === 'number' ? value : Number(value)

    if (!Number.isFinite(numberValue) || numberValue < 1) {
        return fallbackValue
    }

    return Math.floor(numberValue)
}

export function getInitialChatLoadPages(db: { chatLoadInitialPages?: number }): number {
    return normalizeChatLoadPages(db.chatLoadInitialPages, DEFAULT_CHAT_LOAD_INITIAL_PAGES)
}

/**
 * The loaded page count after a visit that kept the chat mounted. An unchanged page-size setting
 * keeps the pages the user scrolled to; a changed one resets to the new size, and `lowered`
 * says the reset shrank the window so the list must scroll back to the bottom.
 */
export function pagesOnReturn(current: number, initialAtHide: number, initialNow: number): { next: number, lowered: boolean } {
    if (initialAtHide === initialNow) {
        return { next: current, lowered: false }
    }
    return { next: initialNow, lowered: initialNow < current }
}

export function getAdditionalChatLoadPages(db: { chatLoadAdditionalPages?: number }): number {
    return normalizeChatLoadPages(db.chatLoadAdditionalPages, DEFAULT_CHAT_LOAD_ADDITIONAL_PAGES)
}
