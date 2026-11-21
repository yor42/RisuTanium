import { untrack } from 'svelte'
import { packBaseTone, type SchemeTone } from '../gui/surfaceTone'

/**
 * The surface gate: a theme pack's sheet may be on only while the screen it was judged against is shown, and at most
 * one sheet is ever on. A screen declares itself while mounted (`declareSurface`); App masks the declaration per area with its
 * own cover (`screenMasked`). The gate switches only the `media` attribute of the elements the apply code registered, never a document
 * query, so a `style[data-theme-pack]` rendered by card or model HTML is never touched. While a registered sheet is on,
 * the gate also marks the document root (`data-theme-pack-base`) and sets the base tone, in the same call as the media,
 * so the tokens the pack does not set resolve to the base it was judged against instead of the user's colour scheme.
 */

/** The areas a sheet can be gated to. Registered elements of any other area are never switched on. */
export type GatedArea = 'chat' | 'studio'

/** The screens in the order they win when more than one is declared and unmasked: settings > studio > chat > home. */
const PRECEDENCE: readonly GatedArea[] = ['studio', 'chat']

let generation = 0
let installed = false
let masked: (area: GatedArea) => boolean = () => false
let stopRoot: (() => void) | null = null
const declared: Record<GatedArea, number> = { chat: 0, studio: 0 }
// A null base marks shape mode: the element is on, but no fixed base applies.
const registry = new Map<HTMLStyleElement, { area: string, base: SchemeTone | null }>()
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

/**
 * Whether App's current screen state hides `area`'s sheet. Chat sits under Settings and Studio. Studio is hidden while
 * Settings is open or Studio is closed, so the chat and studio masks are exclusive: exactly one of `studioOpen` and
 * `!studioOpen` holds, and a late release of a closing Studio can never turn its sheet on.
 */
export function screenMasked(area: GatedArea, open: { settingsOpen: boolean, studioOpen: boolean }): boolean {
    if (area === 'studio') return open.settingsOpen || !open.studioOpen
    return open.settingsOpen || open.studioOpen
}

/** The highest-precedence screen that is declared and not masked, or null (no gate installed, nothing declared, or all masked). At most one sheet is on. */
export function shownScreen(): GatedArea | null {
    void version
    if (!installed) return null
    for (const area of PRECEDENCE) {
        if (declared[area] > 0 && !masked(area)) return area
    }
    return null
}

/**
 * The root attribute that selects the pack's fixed base. Present exactly while a registered element with a base is on
 * (colour mode); its value is empty for the dark base and `light` for the light base. An element registered with a null
 * base (shape mode) sets neither the attribute nor the base tone.
 */
const BASE_ATTRIBUTE = 'data-theme-pack-base'

/**
 * Sets each registered element on exactly when its area is the shown surface, and marks the document root and the
 * base tone while one is on. The registry decides, never a document query.
 */
export function syncThemePackMedia(): void {
    const shown = shownScreen()
    let on = false
    let base: SchemeTone = 'dark'
    for (const [element, entry] of registry) {
        const wanted = entry.area === shown ? 'all' : 'not all'
        if (wanted === 'all' && entry.base !== null) {
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

/** Installs the gate once; `maskedNow` is App's per-area mask, read by the gate effect. */
export function installThemePackGate(maskedNow: (area: GatedArea) => boolean): void {
    if (installed) return
    installed = true
    masked = maskedNow
    stopRoot = $effect.root(() => {
        $effect(() => {
            syncThemePackMedia()
        })
    })
}

/** Registers a stylesheet element the apply code created; the returned function unregisters it on removal. A null base is shape mode. */
export function registerThemePackElement(element: HTMLStyleElement, area: string, base: SchemeTone | null = 'dark'): () => void {
    registry.set(element, { area, base })
    return () => { registry.delete(element) }
}

/** Re-registers a registered element under another base (colour mode or shape mode); the caller then syncs the gate. */
export function setThemePackElementBase(element: HTMLStyleElement, base: SchemeTone | null): void {
    const entry = registry.get(element)
    if (entry !== undefined) {
        registry.set(element, { area: entry.area, base })
    }
}

/** Test seam: drops the gate, the declarations and the registry so a later mount starts clean. */
export function resetThemePackGateForTests(): void {
    stopRoot?.()
    stopRoot = null
    installed = false
    masked = () => false
    declared.chat = 0
    declared.studio = 0
    registry.clear()
    document.documentElement.removeAttribute(BASE_ATTRIBUTE)
    packBaseTone.set(null)
    generation += 1
    untrack(() => { version = 0 })
}
