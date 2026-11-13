export type RootLayout = 'phone' | 'mid' | 'wide'
export type RootInput = 'touch' | 'hover'

// The one source of the shell breakpoints and the hover/touch rule: the root mirror and ChatShell both call these.
export const WIDE_MIN_WIDTH = 900
export const MID_MIN_WIDTH = 600
export const HOVER_QUERY = '(hover: hover) and (pointer: fine)'

interface MediaHost {
    matchMedia?: (query: string) => { matches: boolean }
}

export function layoutOf(width: number): RootLayout {
    return width >= WIDE_MIN_WIDTH ? 'wide' : width >= MID_MIN_WIDTH ? 'mid' : 'phone'
}

export function inputOf(host: MediaHost): RootInput {
    return host.matchMedia?.(HOVER_QUERY).matches ? 'hover' : 'touch'
}

// Writes data-layout and data-input on <html> now, again on every window resize and on every change of the hover query.
// The returned function removes both listeners and leaves the last attributes in place.
export function startRootAttributeMirror(win: Window, doc: Document): () => void {
    const root = doc.documentElement
    const apply = () => {
        root.dataset.layout = layoutOf(win.innerWidth)
        root.dataset.input = inputOf(win)
    }
    apply()
    win.addEventListener('resize', apply)
    const hoverQuery = win.matchMedia?.(HOVER_QUERY)
    hoverQuery?.addEventListener('change', apply)
    return () => {
        win.removeEventListener('resize', apply)
        hoverQuery?.removeEventListener('change', apply)
    }
}
