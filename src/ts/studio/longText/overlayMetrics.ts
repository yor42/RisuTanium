// Pure rules for keeping a long-text field's coloured overlay on the same lines as its textarea.
// The overlay inherits every font metric, so none is copied here: only the box (padding, border and, where the
// engine cannot reserve a scrollbar gutter, the right inset) is applied, and none of those lengths is text-zoomed.

// Layout-only classes carried by BOTH the textarea and the overlay, so they break lines identically. Literal
// Tailwind tokens, so the class scanner sees each one. Kerning and ligatures are off because spans split shaping runs.
export const LT_TEXT_LAYOUT = 'whitespace-pre-wrap break-words [word-spacing:normal] normal-case indent-0 text-start [text-rendering:auto] [font-kerning:none] [font-variant-ligatures:none] [scrollbar-gutter:stable]'

export interface BoxComputed {
    paddingTop: string
    paddingRight: string
    paddingBottom: string
    paddingLeft: string
    borderTopWidth: string
    borderRightWidth: string
    borderBottomWidth: string
    borderLeftWidth: string
}

export interface BoxOffsets {
    offsetWidth: number
    clientWidth: number
}

export interface TextMetrics {
    fontSize: string
    lineHeight: string
    fontFamily: string
    fontWeight: string
    letterSpacing: string
}

function px(value: string): number {
    const parsed = parseFloat(value)
    return Number.isFinite(parsed) ? parsed : 0
}

// True only where the engine reserves the scrollbar gutter for `scrollbar-gutter: stable`; jsdom has no `CSS`.
export function supportsScrollbarGutter(): boolean {
    return typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('scrollbar-gutter', 'stable')
}

// The inline box properties for the overlay, as [property, value] pairs. Never a font or spacing length. `right`
// appears only without gutter support, where the overlay must leave room for the textarea's real scrollbar.
export function overlayBoxStyle(computed: BoxComputed, gutterSupported: boolean, offsets: BoxOffsets): [string, string][] {
    const rules: [string, string][] = [
        ['padding-top', computed.paddingTop],
        ['padding-right', computed.paddingRight],
        ['padding-bottom', computed.paddingBottom],
        ['padding-left', computed.paddingLeft],
        ['border-top-width', computed.borderTopWidth],
        ['border-right-width', computed.borderRightWidth],
        ['border-bottom-width', computed.borderBottomWidth],
        ['border-left-width', computed.borderLeftWidth],
    ]
    if (!gutterSupported) {
        const scrollbar = Math.max(0, offsets.offsetWidth - offsets.clientWidth - px(computed.borderLeftWidth) - px(computed.borderRightWidth))
        rules.push(['right', `${scrollbar}px`])
    }
    return rules.filter(([, value]) => value !== '')
}

// Whether two computed text metrics describe the same glyph layout.
export function metricsAgree(a: TextMetrics, b: TextMetrics): boolean {
    return a.fontSize === b.fontSize && a.lineHeight === b.lineHeight && a.fontFamily === b.fontFamily && a.fontWeight === b.fontWeight && a.letterSpacing === b.letterSpacing
}

// A line height below this, or a non-finite one (`normal` parses to NaN), cannot define a trustworthy threshold.
const MIN_LINE_HEIGHT_PX = 8

// A wrap drift is whole lines, so the heights diverge when they differ by almost one line; a sub-line difference
// (a rounding or padding difference) never counts. Fails open: an unusable line height or height is no divergence.
export function heightsDiverge(areaHeight: number, overlayHeight: number, lineHeightPx: number): boolean {
    if (!Number.isFinite(lineHeightPx) || lineHeightPx < MIN_LINE_HEIGHT_PX) return false
    if (!Number.isFinite(areaHeight) || !Number.isFinite(overlayHeight)) return false
    return Math.abs(areaHeight - overlayHeight) >= lineHeightPx - 2
}
