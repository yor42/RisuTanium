import { untrack } from 'svelte'
import { packBaseTone, type SchemeTone } from '../gui/surfaceTone'

/**
 * The surface gate: a theme pack's sheet may be on only while the screen it was judged against is shown, and at most
 * one sheet is ever on. A screen declares itself while mounted (`declareSurface`); App masks the declaration with its
 * own cover. The gate switches only the `media` attribute of the elements the apply code registered, never a document
 * query, so a `style[data-theme-pack]` rendered by card or model HTML is never touched. While a registered sheet is on,
 * the gate also marks the document root (`data-theme-pack-base`) and sets the base tone, in the same call as the media,
 * so the tokens the pack does not set resolve to the base it was judged against instead of the user's colour scheme.
 */

/** The areas a sheet can be gated to. Registered elements of any other area are never switched on. */
export type GatedArea = 'chat'

let generation = 0
let installed = false
let cover: () => boolean = () => false
let stopRoot: (() => void) | null = null
const declared: Record<GatedArea, number> = { chat: 0 }
const registry = new Map<HTMLStyleElement, { area: string, base: SchemeTone }>()
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

/**
 * The root attribute that selects the pack's fixed base. Present exactly while a registered element is on; its value is
 * empty for the dark base and `light` for the light base.
 */
const BASE_ATTRIBUTE = 'data-theme-pack-base'

/**
 * Sets each registered element on exactly when its area is the shown surface, and marks the document root and the
 * base tone while one is on. The registry decides, never a document query.
 */
export function syncThemePackMedia(): void {
    const shown = shownSurface()
    let on = false
    let base: SchemeTone = 'dark'
    for (const [element, entry] of registry) {
        const wanted = entry.area === shown ? 'all' : 'not all'
        if (wanted === 'all') {
            on = true
            base = entry.base
        }
        if (element.getAttribute('media') !== wanted) element.setAttribute('media', wanted)
    }
    const root = document.documentElement
    const value = base === 'light' ? 'light' : ''
    if (on) {
        if (root.getAttribute(BASE_ATTRIBUTE) !== value) root.setAttribute(BASE_ATTRIBUTE, value)
    }
    else if (root.hasAttribute(BASE_ATTRIBUTE)) {
        root.removeAttribute(BASE_ATTRIBUTE)
    }
    packBaseTone.set(on ? base : null)
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
export function registerThemePackElement(element: HTMLStyleElement, area: string, base: SchemeTone = 'dark'): () => void {
    registry.set(element, { area, base })
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
    document.documentElement.removeAttribute(BASE_ATTRIBUTE)
    packBaseTone.set(null)
    generation += 1
    untrack(() => { version = 0 })
}
