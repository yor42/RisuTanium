import { mount, unmount } from 'svelte'
import PasswordPrompt from '../lib/Others/PasswordPrompt.svelte'

/**
 * Asks for a password in a masked field mounted on `document.body`, outside the alert queue, so the text never enters
 * `alertStore`. Resolves with the text exactly as typed (no trimming), or `null` when the person cancels. The component is
 * unmounted before the answer is returned, and the password is handed to this one caller only. The page behind the prompt is
 * inert while it is open. The prompt returns no focus on close: the caller's next surface takes focus.
 */
export function askPassword(options: { message: string }): Promise<string | null> {
    return new Promise((resolve) => {
        const background = Array.from(document.body.children).filter((child): child is HTMLElement => child instanceof HTMLElement)
        const target = document.createElement('div')
        document.body.appendChild(target)
        const app = mount(PasswordPrompt, {
            target,
            props: {
                message: options.message,
                background,
                onanswer: (password) => {
                    void unmount(app)
                    target.remove()
                    resolve(password)
                },
            },
        })
    })
}
