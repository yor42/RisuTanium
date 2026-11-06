// Focus the shell produces itself (a handover to a successor row, a refocus after a delete, a sheet returning focus to its
// opener) restores a focus the reader already placed. `focus()` fires its focus events synchronously, so a listener that
// checks isShellFocusing() sees the mark for exactly the focus the wrapped call produced.
let shellFocusDepth = 0

export function asShellFocus<T>(run: () => T): T {
    shellFocusDepth += 1
    try {
        return run()
    } finally {
        shellFocusDepth -= 1
    }
}

export function isShellFocusing(): boolean {
    return shellFocusDepth > 0
}
