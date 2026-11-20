// Text glyphs the chat shell used as icons before they became Lucide svgs. Separators inside running text (crumb arrows, ellipses, dashes) are outside the set.
const GLYPHS = /[‹›⋮⋯✎×⟳➤■▾✓⇤★☆⧉文♪⑂◐⌫⚙•]/
const BARE_GLYPHS = new Set(['+', '^', 'T'])

// Glyphs used as icons: text inside a button, an image role or an aria-hidden element that is a listed glyph, or that is only `+`, `^` or `T`.
export function glyphsIn(root: ParentNode): string[] {
    const found: string[] = []
    const walker = document.createTreeWalker(root as Node, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const owner = node.parentElement
        if (!owner?.closest('button, [role="img"], [aria-hidden="true"]')) continue
        const trimmed = (node.textContent ?? '').trim()
        if (trimmed === '') continue
        if (BARE_GLYPHS.has(trimmed)) found.push(trimmed)
        else for (const char of trimmed) if (GLYPHS.test(char)) found.push(char)
    }
    return found
}

// The Lucide svgs under the root; each must be hidden from assistive technology.
export function iconsIn(root: ParentNode): SVGElement[] {
    return [...root.querySelectorAll<SVGElement>('svg.lucide-icon')]
}

export function lucideNames(root: ParentNode): string[] {
    return iconsIn(root).map((svg) => [...svg.classList].find((name) => name.startsWith('lucide-') && name !== 'lucide-icon') ?? '')
}
