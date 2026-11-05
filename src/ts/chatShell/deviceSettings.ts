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
