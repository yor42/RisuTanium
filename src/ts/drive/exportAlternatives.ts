/**
 * A `.bin` export leaves out the alternatives of every chat (`Chat.alt`): upstream has no such field, and the fork's own
 * storage keeps them. Every function here returns its input itself when it holds nothing to strip and otherwise a copy, so
 * a live character, a cached unit value or an inlined copy shared with the page is never changed, and a store without
 * alternatives encodes to the same bytes as before.
 *
 * Export data is loosely shaped (units were written by older builds), so the guards below are structural.
 */

type Fields = Record<string, unknown>

function isFields(value: unknown): value is Fields {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function chatsOf(character: unknown): unknown[] | null {
    return isFields(character) && Array.isArray(character.chats) ? character.chats : null
}

/** Whether the chat has an `alt` entry at all, whatever it holds; such an entry is removed from the export. */
function carriesAltKey(chat: unknown): boolean {
    return isFields(chat) && 'alt' in chat
}

/** Whether the chat has alternatives a reader would show; an empty list holds none, so it is removed without a warning. */
export function chatHoldsAlternatives(chat: unknown): boolean {
    if (!isFields(chat) || !('alt' in chat)) {
        return false
    }
    const alt = chat.alt
    return Array.isArray(alt) ? alt.length > 0 : alt !== undefined && alt !== null
}

function withoutAltKey(chat: Fields): Fields {
    return Object.fromEntries(Object.entries(chat).filter(([key]) => key !== 'alt'))
}

function labelOf(characterName: unknown, chatName: unknown): string {
    const character = typeof characterName === 'string' && characterName !== '' ? characterName : 'Unknown Character'
    const chat = typeof chatName === 'string' && chatName !== '' ? chatName : 'Chat'
    return `${character} / ${chat}`
}

/** `character`, or a copy whose chats carry no `alt`; the same object when no chat has one. */
export function withoutChatAlternatives<T>(character: T): T {
    const chats = chatsOf(character)
    if (chats === null || !chats.some(carriesAltKey) || !isFields(character)) {
        return character
    }
    return { ...character, chats: chats.map((chat) => carriesAltKey(chat) ? withoutAltKey(chat as Fields) : chat) } as T
}

/** The label (character, then chat) of each chat of `character` that holds alternatives. */
export function alternativeChatLabels(character: unknown): string[] {
    const chats = chatsOf(character)
    if (chats === null || !isFields(character)) {
        return []
    }
    return chats.filter(chatHoldsAlternatives).map((chat) => labelOf(character.name, isFields(chat) ? chat.name : undefined))
}

/**
 * A cold-storage unit value (a character unit `{ character }`, or a chat unit `{ message }`) without the alternatives of
 * its chats, and the labels of the chats that held some. The value itself when it holds nothing to strip.
 */
export function withoutColdValueAlternatives(value: unknown): { value: unknown, labels: string[] } {
    if (!isFields(value)) {
        return { value, labels: [] }
    }
    const character = value.character
    if (chatsOf(character)?.some(carriesAltKey)) {
        return { value: { ...value, character: withoutChatAlternatives(character) }, labels: alternativeChatLabels(character) }
    }
    if (Array.isArray(value.message) && 'alt' in value) {
        return { value: withoutAltKey(value), labels: chatHoldsAlternatives(value) ? [labelOf(undefined, value.name)] : [] }
    }
    return { value, labels: [] }
}
