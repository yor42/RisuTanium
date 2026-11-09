/**
 * A `.bin` export leaves out the fork-only keys of every chat and message (MC-774): upstream has no such field, and the
 * fork's own storage keeps them. `FORK_ONLY_CHAT_KEYS` is the one table of them; a key is removed whenever it is present,
 * and named to the person only when its `holds` says it carries something a reader would use. Every function here returns
 * its input itself when it holds nothing to strip and otherwise a copy of the changed character, chat and message only,
 * so a live character, a cached unit value or an inlined copy shared with the page is never changed, and a store without
 * these keys encodes to the same bytes as before.
 *
 * Export data is loosely shaped (units were written by older builds), so the guards below are structural.
 */

type Fields = Record<string, unknown>

/** What a left-out key stands for; each kind has its own text in the export prompt and notice. */
export type ForkOnlyKind = 'alternatives' | 'interruptedNote' | 'memoryCoverage' | 'chatJailbreak' | 'chatMemory' | 'hideNames'

interface ForkOnlyKey {
    /** Where the key lives: on the chat, or on each of its messages. */
    scope: 'chat' | 'message'
    key: string
    /** The kind the prompt names; null for a key that is removed and never named. */
    kind: ForkOnlyKind | null
    /** Whether the present value is worth naming; `owner` is the object that carries the key. A value that is not named is still removed. */
    holds(value: unknown, owner: Fields): boolean
}

function isFields(value: unknown): value is Fields {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function chatsOf(character: unknown): unknown[] | null {
    return isFields(character) && Array.isArray(character.chats) ? character.chats : null
}

/** Whether the chat has alternatives a reader would show; an empty list holds none, so it is removed without a warning. */
export function chatHoldsAlternatives(chat: unknown): boolean {
    if (!isFields(chat) || !('alt' in chat)) {
        return false
    }
    const alt = chat.alt
    return Array.isArray(alt) ? alt.length > 0 : alt !== undefined && alt !== null
}

function firstLine(data: string): string {
    const newline = data.indexOf('\n')
    return newline === -1 ? data : data.slice(0, newline)
}

/** Whether the chat's own jailbreak or memory switch can act: its scope flag is on and the value is a boolean. */
function chatSwitchActs(value: unknown, owner: Fields): boolean {
    return typeof value === 'boolean' && owner.useLocallySetGlobalVariables === true
}

/**
 * The fork-only keys. The messages kept in `alt` leave with it. A coverage pointer is read only while it equals the first
 * line of the chat's `supaMemoryData`; any other value is inert, so it is removed and not named. The same holds for the
 * chat's own jailbreak and memory switches while the chat's scope flag is off or the value is not a boolean, and for
 * `hideNames` unless it is `true`. The new-reply mark `unseenReply` is always removed and never named.
 */
export const FORK_ONLY_CHAT_KEYS: readonly ForkOnlyKey[] = [
    { scope: 'chat', key: 'alt', kind: 'alternatives', holds: (_value, owner) => chatHoldsAlternatives(owner) },
    { scope: 'message', key: 'interrupted', kind: 'interruptedNote', holds: (value) => value === true },
    {
        scope: 'chat',
        key: 'supaMemoryCoveredId',
        kind: 'memoryCoverage',
        holds: (value, owner) => typeof value === 'string' && typeof owner.supaMemoryData === 'string' && value === firstLine(owner.supaMemoryData),
    },
    { scope: 'chat', key: 'scopedJailbreak', kind: 'chatJailbreak', holds: chatSwitchActs },
    { scope: 'chat', key: 'scopedMemory', kind: 'chatMemory', holds: chatSwitchActs },
    { scope: 'chat', key: 'hideNames', kind: 'hideNames', holds: (value) => value === true },
    // A transient mark that clears the next time the chat opens: upstream has no use for it, so it is removed without a warning.
    { scope: 'chat', key: 'unseenReply', kind: null, holds: () => false },
]

const CHAT_KEYS = FORK_ONLY_CHAT_KEYS.filter((row) => row.scope === 'chat')
const MESSAGE_KEYS = FORK_ONLY_CHAT_KEYS.filter((row) => row.scope === 'message')

function carriesKeyOf(rows: readonly ForkOnlyKey[], owner: unknown): boolean {
    return isFields(owner) && rows.some((row) => row.key in owner)
}

/** Whether the chat or one of its messages has a table key at all, whatever it holds; such a key is removed from the export. */
function carriesForkOnly(chat: unknown): boolean {
    if (!isFields(chat)) {
        return false
    }
    return carriesKeyOf(CHAT_KEYS, chat) || (Array.isArray(chat.message) && chat.message.some((message) => carriesKeyOf(MESSAGE_KEYS, message)))
}

/** The kinds the chat holds that are worth naming, in table order and each once. */
function forkOnlyKinds(chat: Fields): ForkOnlyKind[] {
    const kinds: ForkOnlyKind[] = []
    for (const row of FORK_ONLY_CHAT_KEYS) {
        const owners = row.scope === 'chat' ? [chat] : (Array.isArray(chat.message) ? chat.message : [])
        if (row.kind !== null && !kinds.includes(row.kind) && owners.some((owner) => isFields(owner) && row.key in owner && row.holds(owner[row.key], owner))) {
            kinds.push(row.kind)
        }
    }
    return kinds
}

function withoutKeysOf(rows: readonly ForkOnlyKey[], owner: Fields): Fields {
    return Object.fromEntries(Object.entries(owner).filter(([key]) => !rows.some((row) => row.key === key)))
}

/** A copy of the chat without its table keys; only the messages that carry one are copied. */
function withoutForkOnlyKeys(chat: Fields): Fields {
    const bare = withoutKeysOf(CHAT_KEYS, chat)
    if (Array.isArray(bare.message) && bare.message.some((message) => carriesKeyOf(MESSAGE_KEYS, message))) {
        bare.message = bare.message.map((message) => carriesKeyOf(MESSAGE_KEYS, message) ? withoutKeysOf(MESSAGE_KEYS, message as Fields) : message)
    }
    return bare
}

function labelOf(characterName: unknown, chatName: unknown): string {
    const character = typeof characterName === 'string' && characterName !== '' ? characterName : 'Unknown Character'
    const chat = typeof chatName === 'string' && chatName !== '' ? chatName : 'Chat'
    return `${character} / ${chat}`
}

/** `character`, or a copy whose chats and messages carry no table key; the same object when none does. */
export function withoutForkOnlyChatData<T>(character: T): T {
    const chats = chatsOf(character)
    if (chats === null || !chats.some(carriesForkOnly) || !isFields(character)) {
        return character
    }
    return { ...character, chats: chats.map((chat) => carriesForkOnly(chat) ? withoutForkOnlyKeys(chat as Fields) : chat) } as T
}

/**
 * A chat that loses fork-only data in an export. `text` is what the prompt shows (character, then chat); `key` tells
 * chats apart, so two chats with the same text are counted twice and the same chat read through two sources once;
 * `kinds` are the kinds worth naming, never empty.
 */
export type ForkOnlyChatLabel = { key: string, text: string, kinds: ForkOnlyKind[] }

function characterKeyOf(character: Fields): string {
    return typeof character.chaId === 'string' ? `c:${character.chaId}` : `?:${typeof character.name === 'string' ? character.name : ''}`
}

/** The label of each chat of `character` that loses something worth naming. */
export function forkOnlyChatLabels(character: unknown): ForkOnlyChatLabel[] {
    const chats = chatsOf(character)
    if (chats === null || !isFields(character)) {
        return []
    }
    const characterKey = characterKeyOf(character)
    const labels: ForkOnlyChatLabel[] = []
    chats.forEach((chat, index) => {
        const kinds = isFields(chat) ? forkOnlyKinds(chat) : []
        if (kinds.length === 0) {
            return
        }
        const chatId = isFields(chat) && typeof chat.id === 'string' && chat.id !== '' ? `id:${chat.id}` : `at:${index}`
        labels.push({ key: `${characterKey}/${chatId}`, text: labelOf(character.name, isFields(chat) ? chat.name : undefined), kinds })
    })
    return labels
}

/**
 * A cold-storage unit value (a character unit `{ character }`, or a chat unit `{ message }`) without the fork-only data of
 * its chats, and the labels of the chats that held some worth naming. The value itself when it holds nothing to strip.
 * `unitKey` is the unit's storage key: a chat unit has no character, so it is keyed by the unit.
 */
export function withoutColdValueForkOnly(value: unknown, unitKey: string): { value: unknown, labels: ForkOnlyChatLabel[] } {
    if (!isFields(value)) {
        return { value, labels: [] }
    }
    const character = value.character
    if (chatsOf(character)?.some(carriesForkOnly)) {
        return { value: { ...value, character: withoutForkOnlyChatData(character) }, labels: forkOnlyChatLabels(character) }
    }
    if (Array.isArray(value.message) && carriesForkOnly(value)) {
        const kinds = forkOnlyKinds(value)
        return { value: withoutForkOnlyKeys(value), labels: kinds.length > 0 ? [{ key: `u:${unitKey}`, text: labelOf(undefined, value.name), kinds }] : [] }
    }
    return { value, labels: [] }
}

/** The set entry of one kind of one chat: what the prompt named is remembered per kind, so a kind found later is still reported. */
export function forkOnlyConfirmKey(kind: ForkOnlyKind, chatKey: string): string {
    return `${kind}|${chatKey}`
}

/** The entries of every kind of every label, for `lateForkOnlyChats`. */
export function forkOnlyConfirmKeys(labels: readonly ForkOnlyChatLabel[]): Set<string> {
    return new Set(labels.flatMap((label) => label.kinds.map((kind) => forkOnlyConfirmKey(kind, label.key))))
}

/**
 * What the labels name that `confirmed` (see `forkOnlyConfirmKeys`) does not: the texts of the chats whose alternatives
 * were not named, and each other chat with the kinds not named for it. A chat and kind found through several sources
 * counts once.
 */
export function lateForkOnlyChats(labels: readonly ForkOnlyChatLabel[], confirmed: ReadonlySet<string>): { alternatives: string[], other: { text: string, kinds: ForkOnlyKind[] }[] } {
    const seen = new Set<string>()
    const alternatives = new Map<string, string>()
    const other = new Map<string, { text: string, kinds: ForkOnlyKind[] }>()
    for (const label of labels) {
        for (const kind of label.kinds) {
            const entry = forkOnlyConfirmKey(kind, label.key)
            if (confirmed.has(entry) || seen.has(entry)) {
                continue
            }
            seen.add(entry)
            if (kind === 'alternatives') {
                alternatives.set(label.key, label.text)
                continue
            }
            const found = other.get(label.key)
            if (found === undefined) {
                other.set(label.key, { text: label.text, kinds: [kind] })
            } else {
                found.kinds.push(kind)
            }
        }
    }
    return { alternatives: [...alternatives.values()], other: [...other.values()] }
}
