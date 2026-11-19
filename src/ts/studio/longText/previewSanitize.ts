/**
 * The only HTML the CBS preview ever renders. `previewHtml` is the pipeline the surfaces use: the parser's own
 * markdown pass, then `strictPreviewHtml`. The strict pass runs on its own DOMPurify instance, created with no hooks
 * and no shared configuration, so nothing the parser registers on the shared singleton (the `blob:`/`asset:`
 * force-keep, the `target` and `href` rewrites, the `x-risu-` class prefix) can reach it. Its allowlist keeps no
 * element that loads a resource and no attribute at all beyond a few inert text ones, so no remote request can start.
 */
import createDOMPurify from 'dompurify'
import { parseMarkdownSafe } from '../../parser/parser.svelte'

export type PreviewHtml = { html: string; mediaRemoved: number }

const ALLOWED_TAGS = [
    'p', 'br', 'hr', 'b', 'strong', 'i', 'em', 'u', 's', 'del', 'ins', 'mark', 'small', 'sub', 'sup', 'code', 'pre',
    'kbd', 'q', 'cite', 'abbr', 'blockquote', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'table', 'caption', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'span', 'div', 'details', 'summary', 'ruby',
    'rt', 'rp',
]
const ALLOWED_ATTR = ['title', 'lang', 'dir', 'colspan', 'rowspan', 'open', 'start', 'reversed', 'scope']

/** Elements that show or load media. Only the outermost one of a nest is counted as one removed item. */
const MEDIA_SELECTOR = 'img, picture, source, video, audio, track, iframe, object, embed, svg'

type Purifier = ReturnType<typeof createDOMPurify>
let instance: Purifier | null = null

function purifier(): Purifier {
    instance ??= createDOMPurify(window)
    return instance
}

function hasMediaAncestor(element: Element, root: Element): boolean {
    for (let parent = element.parentElement; parent && parent !== root; parent = parent.parentElement) {
        if (parent.matches(MEDIA_SELECTOR)) return true
    }
    return false
}

/**
 * Parses once into an inert document that loads nothing, counts the outermost media elements, replaces every `math`
 * with the text the first pass left directly inside it (the TeX text of a `$$` formula), then sanitises the result.
 * Only the return value may reach an `{@html}` sink.
 */
export function strictPreviewHtml(html: string): PreviewHtml {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const body = doc.body
    const mediaRemoved = Array.from(body.querySelectorAll(MEDIA_SELECTOR))
        .filter((element) => !hasMediaAncestor(element, body)).length
    for (const math of Array.from(body.querySelectorAll('math'))) {
        const direct = Array.from(math.childNodes)
            .filter((node) => node.nodeType === Node.TEXT_NODE)
            .map((node) => node.nodeValue ?? '')
            .join('')
        math.replaceWith(doc.createTextNode(direct))
    }
    const clean = purifier().sanitize(body.innerHTML, {
        ALLOWED_TAGS,
        ALLOWED_ATTR,
        ALLOW_DATA_ATTR: false,
        ALLOW_ARIA_ATTR: false,
        ALLOWED_URI_REGEXP: /^$/,
        KEEP_CONTENT: true,
    })
    return { html: clean, mediaRemoved }
}

export function previewHtml(parsed: string): PreviewHtml {
    return strictPreviewHtml(parseMarkdownSafe(parsed))
}
