/**
 * Drives the file chooser that `selectFileByDom` in `util.ts` opens, in a DOM
 * test environment. `HTMLInputElement.prototype.click` is replaced so the
 * chooser never opens; the test then plays the user: pick files, cancel, or
 * confirm an empty selection. `pending` tells whether a picker promise has
 * settled, so a promise that never settles fails an assertion instead of
 * hanging the test.
 */

export function installDomPicker() {
    const inputs: HTMLInputElement[] = []
    const original = HTMLInputElement.prototype.click
    HTMLInputElement.prototype.click = function (this: HTMLInputElement): void {
        if (this.type === 'file') {
            inputs.push(this)
        }
    }

    function opened(): HTMLInputElement {
        const input = inputs.at(-1)
        if (input === undefined) {
            throw new Error('no file chooser was opened')
        }
        return input
    }

    return {
        inputs,
        /** The newest chooser's `accept` and `multiple` settings. */
        settings(): { accept: string, multiple: boolean } {
            const input = opened()
            return { accept: input.accept, multiple: input.multiple }
        },
        /** The user picks `files` and confirms. */
        pick(files: File[]): void {
            const input = opened()
            Object.defineProperty(input, 'files', { value: files, configurable: true })
            input.dispatchEvent(new Event('change'))
        },
        /** The user confirms with nothing selected. */
        emptyChange(): void {
            const input = opened()
            Object.defineProperty(input, 'files', { value: [], configurable: true })
            input.dispatchEvent(new Event('change'))
        },
        /** The user closes the chooser without choosing. */
        cancel(): void {
            opened().dispatchEvent(new Event('cancel'))
        },
        /** Whether any chooser input is still in the document. */
        leftInDocument(): boolean {
            return document.querySelector('input[type="file"]') !== null
        },
        restore(): void {
            HTMLInputElement.prototype.click = original
            for (const input of inputs) {
                input.remove()
            }
            inputs.length = 0
        },
    }
}

export type DomPicker = ReturnType<typeof installDomPicker>

/** The promise's value once it settled within a short wait, or `pending: true` if it did not. */
export async function settledWithin<T>(promise: Promise<T>, ms = 250): Promise<{ pending: boolean, value?: T }> {
    return await Promise.race([
        promise.then((value) => ({ pending: false, value })),
        new Promise<{ pending: boolean, value?: T }>((resolve) => setTimeout(() => resolve({ pending: true }), ms)),
    ])
}
