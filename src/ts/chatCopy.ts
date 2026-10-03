import { replaceThoughtsBlocks } from './parser/thoughts'

export type CopyOutcome =
    | { ok: true }
    | { ok: false, errorName: string }

function errorNameOf(error: unknown): string {
    return error instanceof Error ? error.name : 'UnknownError'
}

/**
 * Copies `text` through a temporary readonly textarea and `document.execCommand('copy')`.
 * Returns false when the command is unavailable, fails or throws.
 */
function execCommandCopy(text: string): boolean {
    if(typeof document.execCommand !== 'function'){
        return false
    }
    const previous = document.activeElement
    const area = document.createElement('textarea')
    area.value = text
    area.readOnly = true
    area.setAttribute('aria-hidden', 'true')
    area.style.position = 'fixed'
    area.style.top = '0'
    area.style.left = '-9999px'
    area.style.opacity = '0'
    document.body.appendChild(area)
    try {
        area.focus({preventScroll: true})
        area.select()
        area.setSelectionRange(0, text.length)
        return document.execCommand('copy') === true
    } catch {
        return false
    } finally {
        area.remove()
        if(previous instanceof HTMLElement && previous.isConnected){
            previous.focus({preventScroll: true})
        }
    }
}

/**
 * Puts plain `text` on the clipboard and reports the outcome once.
 *
 * `navigator.clipboard.writeText` is called synchronously, so a caller inside a
 * click handler keeps the user gesture the browser requires. The
 * `execCommand('copy')` fallback runs only when the clipboard API is absent or
 * rejects; when it fails too, the outcome names the first failure.
 */
export function copyPlainText(text: string, report: (outcome: CopyOutcome) => void): void {
    const fallback = (firstFailure: string) => {
        report(execCommandCopy(text) ? { ok: true } : { ok: false, errorName: firstFailure })
    }

    const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard
    if(!clipboard || typeof clipboard.writeText !== 'function'){
        fallback('NotSupportedError')
        return
    }

    let pending: Promise<void>
    try {
        pending = Promise.resolve(clipboard.writeText(text))
    } catch (error) {
        fallback(errorNameOf(error))
        return
    }
    pending.then(
        () => report({ ok: true }),
        (error: unknown) => fallback(errorNameOf(error)),
    )
}

function countLineBreaks(run: string): number {
    return run.split('\n').length - 1
}

/**
 * Removes closed `<Thoughts>` sections (the chat screen's exact-case, nesting-aware
 * rule) from `text` for the plain copy.
 *
 * A line break is `\n` or `\r\n`. A section at the very start leaves no leading line
 * breaks (spaces and tabs stay). Elsewhere, the runs of line breaks before and after
 * a removed section join into the longer one (the run before wins a tie), so a
 * paragraph break is never collapsed. A section inside a line leaves its
 * surroundings as written. When nothing but whitespace would remain, `text` is
 * returned unchanged so a thinking-only message still copies its content.
 */
export function stripThoughtsForCopy(text: string): string {
    let marker = '\uE000'
    while (text.includes(marker)) marker += '\uE000'

    const segments = replaceThoughtsBlocks(text, () => marker).split(marker)
    if (segments.length === 1) return text

    let out = segments[0]
    for (let k = 1; k < segments.length; k++) {
        const segment = segments[k]
        const pre = /(?:\r?\n)+$/.exec(out)?.[0] ?? ''
        const post = /^(?:\r?\n)+/.exec(segment)?.[0] ?? ''
        const base = out.slice(0, out.length - pre.length)
        const rest = segment.slice(post.length)
        if (base === '') {
            out = rest
        } else {
            out = base + (countLineBreaks(post) > countLineBreaks(pre) ? post : pre) + rest
        }
    }
    return out.trim() === '' && text.trim() !== '' ? text : out
}
