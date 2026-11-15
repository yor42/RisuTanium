import { untrack } from 'svelte'

/**
 * The surface gate: a theme pack's sheet may be on only while the screen it was judged against is shown, and at most
 * one sheet is ever on. A screen declares itself while mounted (`declareSurface`); App masks the declaration with its
 * own cover. The gate switches only the `media` attribute of the elements the apply code registered, never a document
 * query, so a `style[data-theme-pack]` rendered by card or model HTML is never touched.
 */

/** The areas a sheet can be gated to. Registered elements of any other area are never switched on. */
export type GatedArea = 'chat'

let generation = 0
let installed = false
let cover: () => boolean = () => false
let stopRoot: (() => void) | null = null
const declared: Record<GatedArea, number> = { chat: 0 }
const registry = new Map<HTMLStyleElement, string>()
// Declarations change this signal; the gate effect reads it. It is written under `untrack` so a caller that declares
// from inside its own `$effect` never reads what it writes.
let version = $state(0)

function bumpVersion(): void {
    untrack(() => { version += 1 })
}

/** A counted declaration that `area` is mounted. The returned release is idempotent. */
export function declareSurface(area: GatedArea): () => void {
    const owner = generation
    let released = false
    declared[area] += 1
    bumpVersion()
    return () => {
        if (released) return
        released = true
        // A release that outlives a test reset belongs to a count that no longer exists.
        if (owner !== generation) return
        declared[area] -= 1
        bumpVersion()
    }
}

/** The area whose surface is shown now, or null (no gate installed, nothing declared, or covered). */
export function shownSurface(): GatedArea | null {
    void version
    if (!installed) return null
    if (cover()) return null
    return declared.chat > 0 ? 'chat' : null
}

/** Sets each registered element on exactly when its area is the shown surface. */
export function syncThemePackMedia(): void {
    const shown = shownSurface()
    for (const [element, area] of registry) {
        const wanted = area === shown ? 'all' : 'not all'
        if (element.getAttribute('media') !== wanted) element.setAttribute('media', wanted)
    }
}

/** Installs the gate once; `coveredNow` is App's own cover predicate, read by the gate effect. */
export function installThemePackGate(coveredNow: () => boolean): void {
    if (installed) return
    installed = true
    cover = coveredNow
    stopRoot = $effect.root(() => {
        $effect(() => {
            syncThemePackMedia()
        })
    })
}

/** Registers a stylesheet element the apply code created; the returned function unregisters it on removal. */
export function registerThemePackElement(element: HTMLStyleElement, area: string): () => void {
    registry.set(element, area)
    return () => { registry.delete(element) }
}

/** Test seam: drops the gate, the declarations and the registry so a later mount starts clean. */
export function resetThemePackGateForTests(): void {
    stopRoot?.()
    stopRoot = null
    installed = false
    cover = () => false
    declared.chat = 0
    registry.clear()
    generation += 1
    untrack(() => { version = 0 })
}
