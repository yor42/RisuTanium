import { derived, writable, type Readable } from "svelte/store";

export type SchemeTone = 'dark' | 'light'

// The scheme type of the user's colour scheme. Lives here, dependency-free,
// so components that only need the tone do not pull in colorscheme.ts.
export const ColorSchemeTypeStore = writable<SchemeTone>('dark')

// Set by the theme-pack base while it paints pattern surfaces on a fixed
// base; null means the surfaces follow the user's scheme.
export const packBaseTone = writable<SchemeTone | null>(null)

export function surfaceToneFor(scheme: SchemeTone, packBase: SchemeTone | null): SchemeTone {
    return packBase ?? scheme
}

// The tone of the surface a pattern component sits on.
export const patternSurfaceTone: Readable<SchemeTone> = derived(
    [ColorSchemeTypeStore, packBaseTone],
    ([scheme, packBase]) => surfaceToneFor(scheme, packBase)
)
