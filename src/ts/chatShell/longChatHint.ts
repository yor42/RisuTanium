// A chat over this many messages gets the one-line hint, once.
export const LONG_CHAT_MESSAGES = 2000
// How long the hint stays when the reader does nothing.
export const HINT_MS = 8000

export interface HintChat {
    cha: string
    // Undefined for a chat that has no id yet; its "shown" flag lives for the session only.
    chat: string | undefined
    // Position among the character's chats; tells idless chats apart.
    slot: number
}

export interface LongChatHintDeps {
    setTimer: (callback: () => void, ms: number) => number
    clearTimer: (id: number) => void
    // The persisted "shown" flag of a chat with an id. Both calls must be untracked by the caller's reactive context.
    read: (cha: string, chat: string) => boolean
    write: (cha: string, chat: string) => void
    // Called after every change of `state`, so a view can re-read it.
    onChange?: () => void
}

export interface LongChatHintState {
    // The message count shown; null while the hint is hidden.
    count: number | null
}

export interface LongChatHint {
    // Decides for the chat now shown. Returns true when this call made the hint visible. Asking again for the chat whose hint is
    // visible changes nothing; asking for another chat hides the hint first.
    open: (chat: HintChat, count: number) => boolean
    // Search, a sheet, the reader's first move: hides the hint without clearing the flag.
    dismiss: () => void
    readonly state: LongChatHintState
}

function keyOf(chat: HintChat): string {
    return chat.chat === undefined ? `${chat.cha}:#${chat.slot}` : `${chat.cha}:${chat.chat}`
}

// Chats without an id are limited for the session, across shell mounts; they never reach the persisted flag.
const sessionShown = new Set<string>()

export function createLongChatHint(deps: LongChatHintDeps): LongChatHint {
    let state: LongChatHintState = { count: null }
    let shownFor: string | null = null
    let timer: number | null = null

    function changed(): void { deps.onChange?.() }
    function disarm(): void {
        if (timer !== null) deps.clearTimer(timer)
        timer = null
    }
    function hide(): void {
        disarm()
        shownFor = null
        if (state.count === null) return
        state = { count: null }
        changed()
    }
    return {
        open: (chat, count) => {
            const key = keyOf(chat)
            if (shownFor === key) return false
            hide()
            if (count <= LONG_CHAT_MESSAGES) return false
            if (chat.chat === undefined ? sessionShown.has(key) : deps.read(chat.cha, chat.chat)) return false
            if (chat.chat === undefined) sessionShown.add(key)
            else {
                try {
                    deps.write(chat.cha, chat.chat)
                } catch (error) {
                    console.error(error)
                }
            }
            shownFor = key
            state = { count }
            timer = deps.setTimer(() => { timer = null; hide() }, HINT_MS)
            changed()
            return true
        },
        dismiss: hide,
        get state() { return state },
    }
}
