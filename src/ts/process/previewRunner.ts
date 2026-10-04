import { get } from "svelte/store"
import { language } from "src/lang"
import { fillLang } from "src/lang/fill"
import { alertClear, alertMd, alertWait, type alertData } from "../alert"
import { alertStore } from "../stores.svelte"
import { alertIdle, promptWaiting } from "../alertPrompts"
import { doingChat, sendChat, type PreviewResult, type SendChatArg } from "./index.svelte"
import { isComposerWindowOpen } from "./generationOwnership.svelte"
import { watchSelectedChat } from "./previewSelectionWatch.svelte"

/**
 * Ends the result that is waiting for its alert to close: its store
 * subscription and its selection watcher. Null while nothing waits.
 */
let endPendingResult: (() => void) | null = null

function dropPendingResult(): void {
    const end = endPendingResult
    endPendingResult = null
    end?.()
}

/**
 * Whether a prompt preview may start. It may not while a generation or the
 * composer's Send holds the chat, nor while a prompt is waiting for its answer
 * (shown, or covered by a toast or notice), nor while an alert is up: the
 * preview's wait notice would replace that alert, and the waiter of a notice
 * would then read the `none` that ends the preview as its own close. A toast
 * does not block, unless it covers a waiting prompt.
 */
export function previewMayStart(): boolean {
    if (get(doingChat) || isComposerWindowOpen() || promptWaiting()) {
        return false
    }
    const type = get(alertStore).type
    return type === 'none' || type === 'toast'
}

/**
 * Shows `md` once nothing is on screen and no prompt is waiting: when the alert
 * prompt controller reports idle (see `alertIdle` in `alertPrompts.ts`). The
 * controller reports it after it has processed the store's `none`, so the
 * momentary `none` between a notice's close and the return of the prompt it
 * covered is not idle, and the result does not depend on the order in which
 * readers subscribed to the store. The result is put in the store from inside
 * that report, and the store delivers a value to all its subscribers before it
 * delivers a write made from inside one, so it never becomes the close a
 * notice's waiter is waiting for. It waits for no timer and holds no flag. A
 * newer preview run, or any change of the selected character or chat, drops it.
 */
function showAfterAlertCloses(md: string): void {
    dropPendingResult()
    let settled = false
    let unsubscribe: (() => void) | undefined
    let unwatch: (() => void) | undefined
    const end = () => {
        if (settled) {
            return
        }
        settled = true
        if (endPendingResult === end) {
            endPendingResult = null
        }
        unsubscribe?.()
        unwatch?.()
    }
    endPendingResult = end
    unwatch = watchSelectedChat(end)
    unsubscribe = alertIdle.subscribe((idle) => {
        if (settled || !idle) {
            return
        }
        end()
        alertMd(md)
    })
    if (settled) {
        unsubscribe()
        unwatch()
    }
}

/**
 * Runs one prompt preview: a wait notice with a Cancel button, a preview send
 * on its own abort signal, and then what `render` makes of the call's own
 * output. Callers check `previewMayStart()` first.
 *
 * - Cancelled: the notice is closed at the press and nothing is shown.
 * - The send returned false, or produced nothing to render: the runner closes
 *   its notice if the store still holds it, and shows nothing. An alert that
 *   replaced the notice (the failure's error, say) stays.
 * - The send threw: the notice is closed the same way and the error propagates.
 * - Otherwise the result is shown now if no prompt is waiting and the store
 *   holds the notice, nothing or a toast. Behind any other alert, or while a
 *   prompt is waiting, it is shown once the store is closed and no prompt
 *   waits; a notice of the runner's own that covers a waiting prompt is closed
 *   so that the prompt comes back.
 *
 * `render` returns the markdown for a result, or undefined when there is none.
 */
export async function runPreview(
    arg: Pick<SendChatArg, 'preview' | 'previewPrompt'>,
    render: (result: PreviewResult) => string | undefined
): Promise<void> {
    dropPendingResult()

    const controller = new AbortController()
    const result: PreviewResult = {}
    let cancelled = false
    let notice: alertData | undefined = undefined

    const closeIfOurs = () => {
        if (notice && get(alertStore) === notice) {
            alertClear()
        }
    }

    notice = alertWait(language.loadingEllipsis, () => {
        if (cancelled) {
            return
        }
        cancelled = true
        closeIfOurs()
        controller.abort()
    })

    try {
        const completed = await sendChat(-1, { ...arg, signal: controller.signal, previewResult: result })
        if (cancelled) {
            return
        }
        const md = completed
            ? (result.noSpeaker ? language.groupPreviewNoSpeaker : render(result))
            : undefined
        if (md === undefined) {
            closeIfOurs()
            return
        }
        const current = get(alertStore)
        const promptUp = promptWaiting()
        if (!promptUp && (current === notice || current.type === 'none' || current.type === 'toast')) {
            alertMd(md)
        } else {
            if (promptUp) {
                closeIfOurs()
            }
            showAfterAlertCloses(md)
        }
    } catch (error) {
        closeIfOurs()
        throw error
    }
}

const SECRET_MASK = '••••'

/** A value shown as a mask with the length of what it hides. */
function maskText(secret: string): string {
    return fillLang(language.devTool.maskedChars, { mask: SECRET_MASK, count: secret.length })
}

/** Values that show what is wrong with a credential instead of hiding it. */
function isVisibleNonValue(text: string): boolean {
    return text === '' || text === 'undefined' || text === 'null'
}

function maskHeaderValue(value: unknown, keepScheme: boolean): unknown {
    if (value === null || value === undefined) {
        return value
    }
    const text = typeof value === 'string' ? value : JSON.stringify(value)
    if (isVisibleNonValue(text)) {
        return value
    }
    if (keepScheme) {
        const parts = /^(\S+)\s+(\S[\s\S]*)$/.exec(text)
        if (parts) {
            return isVisibleNonValue(parts[2]) ? value : `${parts[1]} ${maskText(parts[2])}`
        }
    }
    return maskText(text)
}

function isSecretHeader(name: string): boolean {
    const lower = name.toLowerCase()
    return lower === 'cookie' || /key|token|secret|signature|auth/.test(lower)
}

function isSchemeHeader(name: string): boolean {
    const lower = name.toLowerCase()
    return lower === 'authorization' || lower === 'proxy-authorization'
}

/** Masks the value of every query parameter whose name says it is a credential; the URL need not parse. */
function maskUrl(url: string): string {
    return url.replace(
        /([?&])([^=&#\s]*(?:key|token|secret|signature)[^=&#\s]*)=([^&#\s]*)/gi,
        (_match, separator: string, name: string, value: string) =>
            `${separator}${name}=${isVisibleNonValue(value) ? value : maskText(value)}`
    )
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The request as it is shown: credentials masked, everything else as it is. The request itself is untouched. */
function maskRequest(request: Record<string, unknown>): Record<string, unknown> {
    const masked: Record<string, unknown> = { ...request }
    if (typeof masked.url === 'string') {
        masked.url = maskUrl(masked.url)
    }
    if (isPlainObject(masked.headers)) {
        masked.headers = Object.fromEntries(
            Object.entries(masked.headers).map(([name, value]) => [
                name,
                isSecretHeader(name) ? maskHeaderValue(value, isSchemeHeader(name)) : value,
            ])
        )
    }
    return masked
}

/** A code fence that the text cannot close early. */
function fenced(info: string, text: string): string {
    return '```' + info + '\n' + text.replaceAll('```', '\\`\\`\\`') + '\n```\n'
}

/**
 * Text that came from card data, made safe to put in a Markdown heading: one
 * line, with the characters Markdown and HTML act on escaped.
 */
export function escapeMarkdownText(text: string): string {
    return text
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/[\\`*_{}[\]()#+\-.!|~]/g, '\\$&')
}

/**
 * A previewed group member's name as one safe line, or undefined when there is
 * nothing to show: no member, or a name that is empty or only whitespace.
 */
export function memberLabel(memberName?: string): string | undefined {
    if (memberName === undefined) {
        return undefined
    }
    const label = escapeMarkdownText(memberName)
    return label === '' ? undefined : label
}

/**
 * The markdown shown for a request body. A body that is a JSON object is
 * pretty-printed with credentials masked; any other JSON is pretty-printed
 * as it is; anything else is shown as text. The body never closes the fence
 * early. Nothing here throws.
 */
export function renderPromptPreview(body: string, memberName?: string): string {
    let md = '### ' + language.prompt
    const label = memberLabel(memberName)
    if (label !== undefined) {
        md += ' — ' + label
    }
    md += '\n'
    if (body.trim() === '') {
        return md + '> ' + language.devTool.requestBodyEmpty + '\n'
    }
    let parsed: unknown
    try {
        parsed = JSON.parse(body)
    } catch {
        return md + fenced('', body)
    }
    const shown = isPlainObject(parsed) ? maskRequest(parsed) : parsed
    return md + fenced('json', JSON.stringify(shown, null, 2))
}

/** The markdown for a prompt-preview result, or undefined when the call wrote no body. */
export function renderPromptResult(result: PreviewResult): string | undefined {
    return result.body === undefined ? undefined : renderPromptPreview(result.body, result.memberName)
}
