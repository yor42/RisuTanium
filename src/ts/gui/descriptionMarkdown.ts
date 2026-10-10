/**
 * Character descriptions in the catalog lists are markdown, rendered by the
 * same `ParseMarkdown` the Creator Notes box uses, minus anything that loads
 * media.
 *
 * `stripMedia` removes media elements from the finished HTML before it reaches
 * the document. It works on an inert `<template>`, which fetches nothing while
 * the HTML is parsed, and it removes (not hides) the elements: a hidden image
 * still loads. Inline styles and `<style>` blocks that could pull an image in
 * through `url()` are removed with them.
 *
 * `renderDescription` parses once per text and keeps the result in a bounded
 * cache, so a row that scrolls back into range is not parsed again. The cache
 * holds at most `MAX_CACHED_DESCRIPTIONS` texts, least recently used leaving
 * first. The parser is loaded on first use, so lists that never come near the
 * viewport do not pay for it.
 */

export type MarkdownParser = (text: string) => Promise<string>

export const MAX_CACHED_DESCRIPTIONS = 200

const MEDIA_SELECTOR = [
    'img', 'picture', 'source', 'video', 'audio', 'track', 'iframe', 'embed', 'object',
    'canvas', 'link', 'style', 'map', 'svg', 'input[type="image" i]',
].join(',')

// A backslash in a style is a CSS escape, which can spell `url(` past the
// pattern, so such a style goes whole.
const IMAGE_FETCHING_STYLE = /url\s*\(|image-set\s*\(|@import|\\/i

// Attributes the app acts on from rendered markup (media controls, buttons,
// triggers, highlight hooks): a description in a list must not drive them.
const APP_CONTROL_ATTRIBUTE = /^(risu-|x-hl-lang$|x-hl-text$|formaction$|form$|action$)/i

const WEB_LINK = /^https?:/i

export function stripMedia(html: string): string {
    const template = document.createElement('template')
    template.innerHTML = html
    for (const el of Array.from(template.content.querySelectorAll(MEDIA_SELECTOR))) {
        el.remove()
    }
    // A form's text stays but nothing can submit.
    for (const form of Array.from(template.content.querySelectorAll('form'))) {
        form.replaceWith(...Array.from(form.childNodes))
    }
    for (const el of Array.from(template.content.querySelectorAll('*'))) {
        for (const name of el.getAttributeNames()) {
            if (APP_CONTROL_ATTRIBUTE.test(name) || name === 'background') {
                el.removeAttribute(name)
            }
        }
        if (IMAGE_FETCHING_STYLE.test(el.getAttribute('style') ?? '')) {
            el.removeAttribute('style')
        }
        // An empty or non-web href would reload the app when clicked.
        if (el.localName === 'a' && el.hasAttribute('href') && !WEB_LINK.test((el.getAttribute('href') ?? '').trim())) {
            el.removeAttribute('href')
        }
    }
    return template.innerHTML
}

/** True when the event came from inside a live link (one with an href), which opens itself and must not trigger the entry. */
export function clickedLink(event: Event): boolean {
    const target = event.target
    return target instanceof Element && target.closest('a[href]') !== null
}

/** True when the event came from inside a button, which has its own meaning. */
export function clickedButton(event: Event): boolean {
    const target = event.target
    return target instanceof Element && target.closest('button') !== null
}

/** True when the user has selected text inside `row`, so the click ending a drag-select is not a pick. */
export function selectedInside(row: Node, selection: Selection | null): boolean {
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        return false
    }
    return row.contains(selection.getRangeAt(0).commonAncestorContainer)
}
const cache = new Map<string, string>()
const inflight = new Map<string, Promise<string>>()

let parserModule: Promise<typeof import('../parser/parser.svelte')> | null = null

async function defaultParser(text: string): Promise<string> {
    // One shared load, so rows asking at the same moment do not each import it.
    parserModule ??= import('../parser/parser.svelte').catch((error: unknown) => {
        parserModule = null
        throw error
    })
    const { ParseMarkdown } = await parserModule
    return ParseMarkdown(text)
}

/** The cached HTML for `text`, if any; a hit counts as a use. */
export function cachedDescriptionHtml(text: string): string | undefined {
    const hit = cache.get(text)
    if (hit !== undefined) {
        cache.delete(text)
        cache.set(text, hit)
    }
    return hit
}

export function renderDescription(text: string, parse: MarkdownParser = defaultParser): Promise<string> {
    const hit = cachedDescriptionHtml(text)
    if (hit !== undefined) {
        return Promise.resolve(hit)
    }
    const pending = inflight.get(text)
    if (pending) {
        return pending
    }
    const run = parse(text).then((html) => {
        const safe = stripMedia(html)
        cache.set(text, safe)
        while (cache.size > MAX_CACHED_DESCRIPTIONS) {
            cache.delete(cache.keys().next().value as string)
        }
        return safe
    }).finally(() => {
        inflight.delete(text)
    })
    inflight.set(text, run)
    return run
}

export function clearDescriptionCache(): void {
    cache.clear()
    inflight.clear()
}
