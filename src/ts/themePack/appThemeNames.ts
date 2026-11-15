// The custom-property names a pack may set (UI-S6 I0a, axis D of Rule SCOPE) and the names it never may, because the app owns
// them on every screen: the Tailwind theme names (the app's own `@theme` blocks and Tailwind's default theme) and the names the
// colour scheme writes inline on the document root. A pack stylesheet is applied to one screen only (MC-1608), but a custom
// property declared on :root is document-wide, so the set of names a pack may declare is a closed list.
//
// The two name lists below are generated data: appThemeNames.test.ts recomputes them from src/styles.css, the stylesheets it
// imports and the installed tailwindcss/theme.css, and prints the expected constant on a mismatch. They are constants rather
// than `?raw` imports so the validator needs no Tailwind-processed stylesheet at run time or in the worker bundle.
import { effective, isPackSettable } from './engine'
import type { ScopedArea } from './areaParts'
import { STUDIO_REGISTRY } from './registries/studio'
import { tokenFile, type TokenFile } from './tokens'
import type { ThemeArea } from './index'

/** The token stylesheets each area's engine reads as the app's own tokens (engine APP merged with the registry's tokens). */
export const APP_TOKEN_FILES: Readonly<Record<ThemeArea, readonly TokenFile[]>> = {
    chat: ['chat/theme-tokens.css', 'theme/nexus-tokens.css'],
    settings: ['chat/theme-tokens.css', 'theme/nexus-tokens.css', 'settings/theme-tokens.css'],
    studio: ['chat/theme-tokens.css', 'theme/nexus-tokens.css', 'studio/studio-tokens.css', 'studio/st4.css'],
    home: ['chat/theme-tokens.css', 'theme/nexus-tokens.css', 'home/home-tokens.css'],
}

const APP_THEME_NAME_LIST: readonly string[] = [
    '--animate-nexus-breathe', '--animate-nexus-enter', '--blur-nexus', '--border-width-1', '--color-bgcolor', '--color-borderc',
    '--color-danger-100', '--color-danger-200', '--color-danger-300', '--color-danger-400', '--color-danger-50', '--color-danger-500',
    '--color-danger-600', '--color-danger-700', '--color-danger-800', '--color-danger-900', '--color-darkbg', '--color-darkborderc',
    '--color-darkbutton', '--color-draculared', '--color-neutral-100', '--color-neutral-200', '--color-neutral-300', '--color-neutral-400',
    '--color-neutral-50', '--color-neutral-500', '--color-neutral-600', '--color-neutral-700', '--color-neutral-800', '--color-neutral-900',
    '--color-nexus-accent', '--color-nexus-bloom', '--color-nexus-canvas', '--color-nexus-core-from', '--color-nexus-core-to', '--color-nexus-danger',
    '--color-nexus-ring', '--color-nexus-text', '--color-nexus-text-muted', '--color-nexus-text-secondary', '--color-nexus-warm',
    '--color-nexus-warm-from', '--color-nexus-warm-to', '--color-primary-100', '--color-primary-200', '--color-primary-300', '--color-primary-400',
    '--color-primary-50', '--color-primary-500', '--color-primary-600', '--color-primary-700', '--color-primary-800', '--color-primary-900',
    '--color-secondary-100', '--color-secondary-200', '--color-secondary-300', '--color-secondary-400', '--color-secondary-50',
    '--color-secondary-500', '--color-secondary-600', '--color-secondary-700', '--color-secondary-800', '--color-secondary-900', '--color-selected',
    '--color-success-100', '--color-success-200', '--color-success-300', '--color-success-400', '--color-success-50', '--color-success-500',
    '--color-success-600', '--color-success-700', '--color-success-800', '--color-success-900', '--color-textcolor', '--color-textcolor2',
    '--container-100vw', '--container-14', '--container-24', '--container-36', '--container-80p', '--container-80vw', '--container-half',
    '--default-ring-color', '--ease-nexus', '--height-110', '--height-124', '--height-138', '--height-96', '--min-height-110', '--min-height-124',
    '--min-height-138', '--min-height-14', '--min-height-2', '--min-height-20', '--min-height-32', '--min-height-4', '--min-height-5',
    '--min-height-8', '--min-height-96', '--min-width-110', '--min-width-12', '--min-width-124', '--min-width-138', '--min-width-14', '--min-width-2',
    '--min-width-20', '--min-width-5', '--min-width-6', '--min-width-8', '--min-width-96', '--min-width-half', '--width-110', '--width-124',
    '--width-138', '--width-2xl', '--width-3xl', '--width-4xl', '--width-7xl',
]

const TAILWIND_DEFAULT_NAME_LIST: readonly string[] = [
    '--animate-bounce', '--animate-ping', '--animate-pulse', '--animate-spin', '--aspect-video', '--blur', '--blur-2xl', '--blur-3xl', '--blur-lg',
    '--blur-md', '--blur-sm', '--blur-xl', '--blur-xs', '--breakpoint-2xl', '--breakpoint-lg', '--breakpoint-md', '--breakpoint-sm',
    '--breakpoint-xl', '--color-amber-100', '--color-amber-200', '--color-amber-300', '--color-amber-400', '--color-amber-50', '--color-amber-500',
    '--color-amber-600', '--color-amber-700', '--color-amber-800', '--color-amber-900', '--color-amber-950', '--color-black', '--color-blue-100',
    '--color-blue-200', '--color-blue-300', '--color-blue-400', '--color-blue-50', '--color-blue-500', '--color-blue-600', '--color-blue-700',
    '--color-blue-800', '--color-blue-900', '--color-blue-950', '--color-cyan-100', '--color-cyan-200', '--color-cyan-300', '--color-cyan-400',
    '--color-cyan-50', '--color-cyan-500', '--color-cyan-600', '--color-cyan-700', '--color-cyan-800', '--color-cyan-900', '--color-cyan-950',
    '--color-emerald-100', '--color-emerald-200', '--color-emerald-300', '--color-emerald-400', '--color-emerald-50', '--color-emerald-500',
    '--color-emerald-600', '--color-emerald-700', '--color-emerald-800', '--color-emerald-900', '--color-emerald-950', '--color-fuchsia-100',
    '--color-fuchsia-200', '--color-fuchsia-300', '--color-fuchsia-400', '--color-fuchsia-50', '--color-fuchsia-500', '--color-fuchsia-600',
    '--color-fuchsia-700', '--color-fuchsia-800', '--color-fuchsia-900', '--color-fuchsia-950', '--color-gray-100', '--color-gray-200',
    '--color-gray-300', '--color-gray-400', '--color-gray-50', '--color-gray-500', '--color-gray-600', '--color-gray-700', '--color-gray-800',
    '--color-gray-900', '--color-gray-950', '--color-green-100', '--color-green-200', '--color-green-300', '--color-green-400', '--color-green-50',
    '--color-green-500', '--color-green-600', '--color-green-700', '--color-green-800', '--color-green-900', '--color-green-950',
    '--color-indigo-100', '--color-indigo-200', '--color-indigo-300', '--color-indigo-400', '--color-indigo-50', '--color-indigo-500',
    '--color-indigo-600', '--color-indigo-700', '--color-indigo-800', '--color-indigo-900', '--color-indigo-950', '--color-lime-100',
    '--color-lime-200', '--color-lime-300', '--color-lime-400', '--color-lime-50', '--color-lime-500', '--color-lime-600', '--color-lime-700',
    '--color-lime-800', '--color-lime-900', '--color-lime-950', '--color-mauve-100', '--color-mauve-200', '--color-mauve-300', '--color-mauve-400',
    '--color-mauve-50', '--color-mauve-500', '--color-mauve-600', '--color-mauve-700', '--color-mauve-800', '--color-mauve-900', '--color-mauve-950',
    '--color-mist-100', '--color-mist-200', '--color-mist-300', '--color-mist-400', '--color-mist-50', '--color-mist-500', '--color-mist-600',
    '--color-mist-700', '--color-mist-800', '--color-mist-900', '--color-mist-950', '--color-neutral-100', '--color-neutral-200',
    '--color-neutral-300', '--color-neutral-400', '--color-neutral-50', '--color-neutral-500', '--color-neutral-600', '--color-neutral-700',
    '--color-neutral-800', '--color-neutral-900', '--color-neutral-950', '--color-olive-100', '--color-olive-200', '--color-olive-300',
    '--color-olive-400', '--color-olive-50', '--color-olive-500', '--color-olive-600', '--color-olive-700', '--color-olive-800', '--color-olive-900',
    '--color-olive-950', '--color-orange-100', '--color-orange-200', '--color-orange-300', '--color-orange-400', '--color-orange-50',
    '--color-orange-500', '--color-orange-600', '--color-orange-700', '--color-orange-800', '--color-orange-900', '--color-orange-950',
    '--color-pink-100', '--color-pink-200', '--color-pink-300', '--color-pink-400', '--color-pink-50', '--color-pink-500', '--color-pink-600',
    '--color-pink-700', '--color-pink-800', '--color-pink-900', '--color-pink-950', '--color-purple-100', '--color-purple-200', '--color-purple-300',
    '--color-purple-400', '--color-purple-50', '--color-purple-500', '--color-purple-600', '--color-purple-700', '--color-purple-800',
    '--color-purple-900', '--color-purple-950', '--color-red-100', '--color-red-200', '--color-red-300', '--color-red-400', '--color-red-50',
    '--color-red-500', '--color-red-600', '--color-red-700', '--color-red-800', '--color-red-900', '--color-red-950', '--color-rose-100',
    '--color-rose-200', '--color-rose-300', '--color-rose-400', '--color-rose-50', '--color-rose-500', '--color-rose-600', '--color-rose-700',
    '--color-rose-800', '--color-rose-900', '--color-rose-950', '--color-sky-100', '--color-sky-200', '--color-sky-300', '--color-sky-400',
    '--color-sky-50', '--color-sky-500', '--color-sky-600', '--color-sky-700', '--color-sky-800', '--color-sky-900', '--color-sky-950',
    '--color-slate-100', '--color-slate-200', '--color-slate-300', '--color-slate-400', '--color-slate-50', '--color-slate-500', '--color-slate-600',
    '--color-slate-700', '--color-slate-800', '--color-slate-900', '--color-slate-950', '--color-stone-100', '--color-stone-200', '--color-stone-300',
    '--color-stone-400', '--color-stone-50', '--color-stone-500', '--color-stone-600', '--color-stone-700', '--color-stone-800', '--color-stone-900',
    '--color-stone-950', '--color-taupe-100', '--color-taupe-200', '--color-taupe-300', '--color-taupe-400', '--color-taupe-50', '--color-taupe-500',
    '--color-taupe-600', '--color-taupe-700', '--color-taupe-800', '--color-taupe-900', '--color-taupe-950', '--color-teal-100', '--color-teal-200',
    '--color-teal-300', '--color-teal-400', '--color-teal-50', '--color-teal-500', '--color-teal-600', '--color-teal-700', '--color-teal-800',
    '--color-teal-900', '--color-teal-950', '--color-violet-100', '--color-violet-200', '--color-violet-300', '--color-violet-400',
    '--color-violet-50', '--color-violet-500', '--color-violet-600', '--color-violet-700', '--color-violet-800', '--color-violet-900',
    '--color-violet-950', '--color-white', '--color-yellow-100', '--color-yellow-200', '--color-yellow-300', '--color-yellow-400',
    '--color-yellow-50', '--color-yellow-500', '--color-yellow-600', '--color-yellow-700', '--color-yellow-800', '--color-yellow-900',
    '--color-yellow-950', '--color-zinc-100', '--color-zinc-200', '--color-zinc-300', '--color-zinc-400', '--color-zinc-50', '--color-zinc-500',
    '--color-zinc-600', '--color-zinc-700', '--color-zinc-800', '--color-zinc-900', '--color-zinc-950', '--container-2xl', '--container-2xs',
    '--container-3xl', '--container-3xs', '--container-4xl', '--container-5xl', '--container-6xl', '--container-7xl', '--container-lg',
    '--container-md', '--container-sm', '--container-xl', '--container-xs', '--default-font-family', '--default-font-feature-settings',
    '--default-font-variation-settings', '--default-mono-font-family', '--default-mono-font-feature-settings',
    '--default-mono-font-variation-settings', '--default-transition-duration', '--default-transition-timing-function', '--drop-shadow',
    '--drop-shadow-2xl', '--drop-shadow-lg', '--drop-shadow-md', '--drop-shadow-sm', '--drop-shadow-xl', '--drop-shadow-xs', '--ease-in',
    '--ease-in-out', '--ease-out', '--font-mono', '--font-sans', '--font-serif', '--font-weight-black', '--font-weight-bold',
    '--font-weight-extrabold', '--font-weight-extralight', '--font-weight-light', '--font-weight-medium', '--font-weight-normal',
    '--font-weight-semibold', '--font-weight-thin', '--inset-shadow-2xs', '--inset-shadow-sm', '--inset-shadow-xs', '--leading-loose',
    '--leading-normal', '--leading-relaxed', '--leading-snug', '--leading-tight', '--max-width-prose', '--perspective-distant',
    '--perspective-dramatic', '--perspective-midrange', '--perspective-near', '--perspective-normal', '--radius', '--radius-2xl', '--radius-3xl',
    '--radius-4xl', '--radius-lg', '--radius-md', '--radius-sm', '--radius-xl', '--radius-xs', '--shadow', '--shadow-2xl', '--shadow-2xs',
    '--shadow-inner', '--shadow-lg', '--shadow-md', '--shadow-sm', '--shadow-xl', '--shadow-xs', '--spacing', '--text-2xl', '--text-2xl--line-height',
    '--text-3xl', '--text-3xl--line-height', '--text-4xl', '--text-4xl--line-height', '--text-5xl', '--text-5xl--line-height', '--text-6xl',
    '--text-6xl--line-height', '--text-7xl', '--text-7xl--line-height', '--text-8xl', '--text-8xl--line-height', '--text-9xl',
    '--text-9xl--line-height', '--text-base', '--text-base--line-height', '--text-lg', '--text-lg--line-height', '--text-shadow-2xs',
    '--text-shadow-lg', '--text-shadow-md', '--text-shadow-sm', '--text-shadow-xs', '--text-sm', '--text-sm--line-height', '--text-xl',
    '--text-xl--line-height', '--text-xs', '--text-xs--line-height', '--tracking-normal', '--tracking-tight', '--tracking-tighter', '--tracking-wide',
    '--tracking-wider', '--tracking-widest',
]

/** T: every name the app's own `@theme` blocks declare (src/styles.css and the stylesheets it imports). */
export const APP_THEME_NAMES: ReadonlySet<string> = new Set(APP_THEME_NAME_LIST)

/** D: every name Tailwind's default theme declares. */
export const TAILWIND_DEFAULT_NAMES: ReadonlySet<string> = new Set(TAILWIND_DEFAULT_NAME_LIST)

const INLINE_NAME = /^(--risu-theme-[a-z0-9-]+|--fontcolor[a-z0-9]*|--risu-font-family)$/
/** I: the names the colour scheme writes inline on the document root (src/ts/gui/colorscheme.ts), as a pack writes them (lower case). */
export const isColourSchemeInlineName = (name: string): boolean => INLINE_NAME.test(name)

const RESERVED_WHY_THEME = (name: string): string => `${name} belongs to the app's Tailwind theme, which styles every screen including Settings; a pack may set only its own areas' tokens (MC-1586)`
const RESERVED_WHY_INLINE = (name: string): string => `${name} is written by the colour scheme on the document root, which wins over any stylesheet; a pack may set only its own areas' tokens (MC-1586)`

/** The reason a name is reserved by the app (T, D or I), or '' when it is not. */
export function reservedNameReason(name: string): string {
    if (APP_THEME_NAMES.has(name) || TAILWIND_DEFAULT_NAMES.has(name)) return RESERVED_WHY_THEME(name)
    if (isColourSchemeInlineName(name)) return RESERVED_WHY_INLINE(name)
    return ''
}

/** The names an area's token stylesheets declare, in file order. */
export function declaredTokenNames(area: ThemeArea): string[] {
    const names = APP_TOKEN_FILES[area].flatMap((file) => [...tokenFile(file).matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]))
    return [...new Set(names)]
}

const allowedCache = new Map<ScopedArea, ReadonlySet<string>>()
/**
 * A_tok(area): the names the area's token stylesheets declare or its registry bounds that the engine admits as pack-settable,
 * minus the reserved names T, D and I. A pack may declare these and its own `--pack-*` helpers, and nothing else.
 */
export function allowedTokenNames(area: ScopedArea): ReadonlySet<string> {
    let names = allowedCache.get(area)
    if (!names) {
        const registry = area === 'studio' ? STUDIO_REGISTRY : undefined
        const bounded = effective(registry)
        const candidates = [...declaredTokenNames(area), ...Object.keys(bounded.minimums), ...Object.keys(bounded.maximums)]
        names = new Set(candidates.filter((name) => isPackSettable(name, registry) && !reservedNameReason(name)))
        allowedCache.set(area, names)
    }
    return names
}
