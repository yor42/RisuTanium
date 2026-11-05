import type { CbsConditions } from '../parser/parser.svelte'
import type { DisplayParseOptions } from '../process/displayParseOptions'

export interface StreamingSplit {
    finished: string[]
    open: string
}

const blockStart = /^(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s?|```|~~~)/
const cssProperty = /\{\s*(?:--[\w-]+|color|background(?:-color|-image)?|margin(?:-[\w-]+)?|padding(?:-[\w-]+)?|font(?:-[\w-]+)?|border(?:-[\w-]+)?|display|width|height|opacity)\s*:/i

function openConstruct(text: string): boolean {
    const lines = text.split('\n')
    let fence = ''
    for (const line of lines) {
        const marker = /^\s{0,3}(`{3,})/.exec(line)?.[1]
        if (marker && (!fence || (marker[0] === fence[0] && marker.length >= fence.length))) {
            fence = fence ? '' : marker
        }
    }
    if (fence) return true
    const styleOpen = text.search(/<style\b[^>]*>(?![\s\S]*<\/style\s*>)/i)
    if (styleOpen >= 0) return true
    const thoughtsOpen = text.search(/<Thoughts>(?![\s\S]*<\/Thoughts>)/)
    if (thoughtsOpen >= 0) return true
    if (/(?:^|[\s>])<(?:[A-Za-z!/][^>]*|)$/.test(text.trimEnd())) return true
    const macro = text.lastIndexOf('{{')
    if (macro >= 0 && text.indexOf('}}', macro) < 0 && text.length - macro <= 64) return true
    if (cssProperty.test(text) && text.lastIndexOf('{') > text.lastIndexOf('}')) return true
    return false
}

export function splitStreamingText(text: string): StreamingSplit {
    const finished: string[] = []
    let start = 0
    for (let i = 0; i < text.length; i++) {
        if (text[i] !== '\n') continue
        const blank = text[i + 1] === '\n'
        const nextLine = text.slice(i + (blank ? 2 : 1))
        const currentLine = text.slice(text.lastIndexOf('\n', i - 1) + 1, i)
        const boundary = blank || blockStart.test(nextLine) || /^\s{0,3}~~~\s*$/.test(currentLine)
        if (!boundary) continue
        const end = i + (blank ? 2 : 1)
        const block = text.slice(start, end)
        if (openConstruct(block)) continue
        // Finished blocks are emitted only after a complete boundary and never change as text grows.
        finished.push(block)
        start = end
        if (blank) i++
    }
    return { finished, open: text.slice(start) }
}

export function renderOpenParagraphSource(open: string): string {
    let result = open
    const thoughts = result.lastIndexOf('<Thoughts>')
    if (thoughts >= 0 && result.indexOf('</Thoughts>', thoughts) < 0) {
        result = result.slice(0, thoughts)
    }
    const style = /<style\b[^>]*>/gi
    let match: RegExpExecArray | null
    let lastOpen = -1
    while ((match = style.exec(result))) lastOpen = match.index
    if (lastOpen >= 0 && !/<\/style\s*>/i.test(result.slice(lastOpen))) {
        result = result.slice(0, lastOpen)
    }
    const lines = result.split('\n')
    let fenceStart = -1
    for (let i = 0; i < lines.length; i++) {
        if (/^\s{0,3}`{3,}/.test(lines[i])) fenceStart = fenceStart < 0 ? i : -1
    }
    if (fenceStart >= 0) result = lines.slice(0, fenceStart).join('\n')
    if (cssProperty.test(result) && result.lastIndexOf('{') > result.lastIndexOf('}')) {
        const brace = result.lastIndexOf('{')
        const cssLines = result.slice(brace).split('\n')
        if (cssLines.length <= 40) {
            result = result.slice(0, result.lastIndexOf('\n', brace) + 1)
        }
    }
    const macro = result.lastIndexOf('{{')
    if (macro >= 0 && result.indexOf('}}', macro) < 0 && result.length - macro <= 64) {
        result = result.slice(0, macro)
    }
    const tag = /(?:^|[\s>])<(?:[A-Za-z!/][^>]*|)$/.exec(result)
    if (tag) result = result.slice(0, tag.index + tag[0].indexOf('<'))
    const emphasis = /(^|\s)(\*{1,2})([^*\n]+)$/.exec(result)
    if (emphasis) result = result.slice(0, emphasis.index + emphasis[1].length) + emphasis[3]
    return result
}

export interface SafeHtmlDependencies {
    display: (source: string) => string
    sanitize: (html: string) => string
    watermark: (html: string) => string
}

export function toSafeHtml(source: string, deps: SafeHtmlDependencies): string {
    const displayed = deps.display(source)
    const sanitized = deps.sanitize(displayed)
    // The chain is the completed-message chain (watermark of the sanitized markup). The watermark only appends
    // zero-width text, and a second sanitize here would re-parse decoded <risu-style> CSS as HTML and drop it.
    return deps.watermark(sanitized)
}

// The word count of a Thoughts block that has opened and not yet closed in the open source, or null when none is open.
export function openThoughtsWordCount(open: string): number | null {
    const thoughts = open.lastIndexOf('<Thoughts>')
    if (thoughts < 0 || open.indexOf('</Thoughts>', thoughts) >= 0) return null
    const words = open.slice(thoughts + '<Thoughts>'.length).trim()
    return words === '' ? 0 : words.split(/\s+/).length
}

export interface StreamingParseContext {
    chatID?: number
    cbsConditions?: CbsConditions
    displayOptions?: DisplayParseOptions
}

export async function createToSafeHtml(modelShortName: string, charArg: Parameters<typeof import('../parser/parser.svelte').ParseMarkdown>[1] = null, context: StreamingParseContext = {}): Promise<(source: string) => Promise<string>> {
    const parser = await import('../parser/parser.svelte')
    const scripts = await import('../process/scripts')
    const { chatID = -1, cbsConditions, displayOptions } = context
    return async (source: string) => {
        let parsed = source
        if (displayOptions) {
            try { parsed = scripts.risuChatParser(source, displayOptions) } catch { parsed = source }
        }
        const displayed = await parser.ParseMarkdown(parsed, charArg, 'notrim', chatID, cbsConditions)
        return toSafeHtml(source, {
            display: () => displayed,
            sanitize: parser.trimMarkdown,
            watermark: (html) => parser.addMetadataToElement(html, modelShortName),
        })
    }
}
