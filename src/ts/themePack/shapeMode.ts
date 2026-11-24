// Shape mode of a theme pack (MC-3003): the part of a judged chat sheet that sets geometry, typography, layout and motion
// and no colour, image or gradient. It is a strip over the judge's canonical text: whole declarations are removed and no
// character is ever added, so what remains is a subset of what the judge accepted. The applier judges the stripped text
// again before it is used, so this module never decides what is safe on its own.
//
// Everything is allowlisted. A property the lists below do not name is paint and is removed, so a property added to the
// judge's declaration allowlist later is stripped until it is classified here. The scope allowlist is a strict superset of
// SHAPE_PROPERTY; shapeMode.test.ts pins the partition.
import { decls } from './csslit'
import type { AppliedArea } from './intake'

/** The properties of the judge's declaration allowlist that carry no colour, image or gradient. Everything else on that allowlist counts as paint. */
export const SHAPE_PROPERTY: readonly RegExp[] = [
    /^(opacity|visibility|cursor|pointer-events|user-select|-webkit-user-select|scrollbar-width|scroll-snap-type|stroke-width)$/,
    /^border(-(top|right|bottom|left|block|inline)(-(start|end))?)?-(width|style)$/, /^border(-(top|bottom|start|end)-(left|right|start|end))?-radius$/,
    /^(font|font-(family|size|weight|style|stretch|variant|variant-[a-z-]+|feature-settings|variation-settings|kerning|synthesis|optical-sizing))$/,
    /^(line-height|letter-spacing|word-spacing|text-align|text-align-last|text-decoration-(?!color$)[a-z-]+|text-underline-offset|text-underline-position|text-transform|text-indent|text-overflow|text-wrap(-mode|-style)?|white-space(-collapse)?|word-break|overflow-wrap|word-wrap|hyphens|tab-size|vertical-align|list-style(-type|-position)?|-webkit-line-clamp|line-clamp|-webkit-box-orient|text-rendering|-webkit-font-smoothing|-moz-osx-font-smoothing)$/,
    /^(display|position|top|right|bottom|left|inset(-[a-z-]+)?|float|clear|box-sizing|aspect-ratio|object-fit|object-position|clip|overflow|overflow-x|overflow-y)$/,
    /^((min-|max-)?(width|height|block-size|inline-size))$/, /^(margin|padding)(-(top|right|bottom|left|block|inline)(-(start|end))?)?$/,
    /^(gap|row-gap|column-gap|order|flex|flex-[a-z-]+|align-(content|items|self)|justify-(content|items|self)|place-(content|items|self)|grid|grid-[a-z-]+)$/,
    /^(border-collapse|border-spacing|table-layout|caption-side|empty-cells)$/,
]

/**
 * The pack-settable chat tokens that carry geometry, typography, layout or motion and never a colour: the families of the
 * chat and nexus token files intersected with the names a chat pack may set. Colours, the alpha of colours (`--opacity-*`,
 * `--alpha-*`), shadows, selection, masks, gradient angles, the blur amount and every `*-rgb` channel are paint and stay off.
 *
 * Consumer rule: an app rule may use a listed token inside `box-shadow`, `background*`, a `border` or `outline` shorthand or
 * any other paint property only when the same value already names its colour explicitly. Otherwise the token comes off this
 * list. Without that, a pack value in a listed token could add a colour while shape mode claims to be paint-free.
 */
export const SHAPE_TOKEN_NAMES: ReadonlySet<string> = new Set([
    '--bubble-max-width', '--bubble-pad-end', '--bubble-pad-start', '--bubble-pad-y', '--chat-message-font', '--cl-spacer-display',
    '--composer-field-height', '--composer-field-padding-x', '--composer-field-padding-y', '--composer-gap', '--composer-padding-x', '--composer-padding-y',
    '--control-gap', '--control-padding-x',
    '--dur-base-nominal', '--dur-fast-nominal', '--dur-lowpower-cap', '--dur-slow-nominal', '--dur-spin',
    '--focus-ring-offset', '--focus-ring-offset-inset', '--focus-ring-offset-wide', '--focus-ring-w', '--focus-ring-w-forced',
    '--font', '--mono',
    '--font-size-2xl', '--font-size-2xs', '--font-size-base', '--font-size-lg', '--font-size-md', '--font-size-sm', '--font-size-xl', '--font-size-xs', '--font-weight-regular',
    '--header-height',
    '--icon-scale', '--icon-size-2xl', '--icon-size-2xs', '--icon-size-lg', '--icon-size-md', '--icon-size-sm', '--icon-size-xl', '--icon-size-xs', '--icon-stroke',
    '--item-gap', '--item-padding-x',
    '--message-gap', '--message-inset-start', '--message-meta-gap', '--message-name-row-height',
    '--nexus-dialog-enter-distance', '--nexus-duration-enter', '--nexus-duration-exit', '--nexus-duration-lowpower-cap', '--nexus-duration-press',
    '--nexus-ease', '--nexus-ease-in', '--nexus-ease-out', '--nexus-focus-ring-offset', '--nexus-focus-ring-width', '--nexus-scrim-duration', '--nexus-sheet-enter-distance', '--nexus-touch',
    '--radius-bubble', '--radius-bubble-tail', '--radius-control', '--radius-field', '--radius-pill', '--radius-popup', '--radius-sheet',
    '--row-padding-end', '--row-padding-start', '--scrollbar-width',
    '--sheet-padding-bottom', '--sheet-padding-x', '--sheet-width-dock', '--sheet-width-panel', '--sheet-width-popup', '--sheet-width-tall', '--sheet-width-wide',
    '--sidebar-width', '--sidebar-width-max', '--sidebar-width-phone',
    '--size-avatar', '--size-avatar-lg', '--size-avatar-md', '--size-avatar-sm', '--size-avatar-xl', '--size-touch', '--size-touch-lg', '--size-touch-sm',
    '--status-row-padding-start', '--stroke-bold', '--stroke-heavy', '--stroke-medium', '--stroke-xheavy',
    '--thread-max-width', '--transcript-padding-bottom', '--transcript-padding-top', '--transcript-padding-top-strip', '--transcript-padding-x',
    '--ui-border-width', '--ui-radius', '--ui-radius-2xl', '--ui-radius-3xl', '--ui-radius-4xl', '--ui-radius-lg', '--ui-radius-md', '--ui-radius-sm', '--ui-radius-xl', '--ui-radius-xs',
])

/**
 * Studio's geometry role tokens: the pack-settable names that are sizes, spacing, type scale, radii or hairlines and never a
 * colour, alpha or tint. Every reader in the source tree uses one only as a geometry value (never in a paint property), so a pack
 * value in them cannot add a colour. shapeMode.test.ts scans the consumers, derived tokens included, and pins the set.
 */
const STUDIO_GEOMETRY_TOKEN_NAMES: readonly string[] = [
    '--studio-code-card-min-height', '--studio-code-min-height', '--studio-content-max-width', '--studio-critical-min-width', '--studio-dialog-width',
    '--studio-font-base', '--studio-font-lg', '--studio-font-md', '--studio-font-sm', '--studio-font-xl', '--studio-font-xs',
    '--studio-form-depth-width', '--studio-form-field-gap', '--studio-form-fold-row-height', '--studio-form-group-gap', '--studio-form-label-size',
    '--studio-form-max-width', '--studio-form-member-avatar-size', '--studio-form-portrait-alt-size', '--studio-form-portrait-size',
    '--studio-form-risky-edge-width', '--studio-form-row-height', '--studio-form-section-padding', '--studio-form-talk-segment-height',
    '--studio-form-talk-segment-width', '--studio-form-thumb-size', '--studio-gutter-width', '--studio-header-height', '--studio-leading-body',
    '--studio-leading-tight', '--studio-menu-width', '--studio-radius-1', '--studio-radius-2', '--studio-radius-3', '--studio-radius-card',
    '--studio-radius-row', '--studio-search-width', '--studio-side-width', '--studio-size-hairline', '--studio-size-ring', '--studio-size-touch',
    '--studio-size-touch-lg', '--studio-size-touch-sm', '--studio-skip-hidden-offset', '--studio-sp-10px', '--studio-sp-14px', '--studio-space-1',
    '--studio-space-2', '--studio-space-3', '--studio-space-4', '--studio-space-5', '--studio-space-6', '--studio-space-7', '--studio-space-8',
    '--studio-splitter-width', '--studio-tab-height', '--studio-tab-size', '--studio-toast-max-width', '--studio-tree-head-height',
    '--studio-tree-row-height', '--studio-tree-row-height-fine', '--studio-tree-row-height-owner', '--studio-tree-row-height-owner-fine',
    '--studio-tree-width', '--studio-weight-medium', '--studio-weight-strong',
]
const STUDIO_SHAPE_TOKEN_NAMES: ReadonlySet<string> = new Set([...SHAPE_TOKEN_NAMES, ...STUDIO_GEOMETRY_TOKEN_NAMES])

/**
 * Home's geometry role tokens: the pack-settable `--home-*` names that are sizes, spacing, type scale, radii or hairlines and
 * never a colour, alpha, tint, duration or stacking value. Every reader in the source tree uses one only as a geometry value
 * (never in a paint property), so a pack value in them cannot add a colour; shapeMode.test.ts scans the consumers, derived
 * tokens included, and pins the set. The `--home-z-*` names stay off: the app reads none of them today, and a reader that
 * took one as `z-index` would need the stacking refusal that Settings has for `--pattern-z-*` (MC-3422) before any joined.
 * `--home-hairline` stays off because a `box-shadow` and a `border` shorthand read it.
 */
const HOME_GEOMETRY_TOKEN_NAMES: readonly string[] = [
    '--home-avatar-lg', '--home-avatar-md', '--home-avatar-radius-lg', '--home-avatar-radius-md', '--home-avatar-radius-sq', '--home-avatar-rail', '--home-avatar-sm', '--home-avatar-xs', '--home-bar-height', '--home-bar-w', '--home-card-gap', '--home-card-pad', '--home-card-pad-lg', '--home-card-radius', '--home-center-width', '--home-center-width-narrow', '--home-char-card-min', '--home-control-gap', '--home-control-height', '--home-control-pad-x', '--home-control-radius', '--home-dialog-margin', '--home-dialog-pad', '--home-dialog-radius', '--home-dialog-width', '--home-dialog-width-wide', '--home-drawer-width', '--home-field-radius', '--home-focus-offset', '--home-focus-w', '--home-hero-pad-y', '--home-icon-size', '--home-icon-size-sm', '--home-icon-stroke', '--home-leading-body', '--home-leading-field', '--home-leading-tight', '--home-main-pad-bottom', '--home-main-pad-top', '--home-main-pad-x', '--home-mode-option-radius', '--home-mode-radius', '--home-note-basis', '--home-pill-height', '--home-portrait-height', '--home-presence-radius', '--home-quick-min', '--home-radius-1', '--home-radius-2', '--home-radius-3', '--home-radius-4', '--home-radius-5', '--home-radius-6', '--home-radius-7', '--home-rail-icon-size', '--home-rail-inset', '--home-rail-pad-x', '--home-rail-pad-y', '--home-rail-radius', '--home-rail-width-collapsed', '--home-rail-width-hybrid', '--home-rail-width-rp', '--home-rail-width-utility', '--home-realm-list-max', '--home-realm-min-height', '--home-realm-status-min', '--home-row-height', '--home-run-mark-size', '--home-search-basis', '--home-sel-size', '--home-shelf-card-min', '--home-shelf-columns', '--home-side-width', '--home-space-1', '--home-space-10', '--home-space-11', '--home-space-12', '--home-space-13', '--home-space-14', '--home-space-15', '--home-space-2', '--home-space-3', '--home-space-4', '--home-space-5', '--home-space-6', '--home-space-7', '--home-space-8', '--home-space-9', '--home-text-2xl', '--home-text-base', '--home-text-hero', '--home-text-lg', '--home-text-md', '--home-text-sm', '--home-text-xl', '--home-text-xs', '--home-tip-gap', '--home-toast-offset', '--home-topbar-gap-x', '--home-topbar-gap-y', '--home-topbar-pad-bottom', '--home-topbar-pad-top', '--home-topbar-pad-x', '--home-touch', '--home-weight-regular', '--home-weight-strong',
]
const HOME_SHAPE_TOKEN_NAMES: ReadonlySet<string> = new Set([...SHAPE_TOKEN_NAMES, ...HOME_GEOMETRY_TOKEN_NAMES])

/**
 * Settings keeps the chat list and nothing else: no `--settings-*` name (no live reader paints or sizes from one yet) and no
 * `--pattern-*`, `--warning-*` or `--task-*` name, which the pattern dialog, the toasts and the backup chooser read (H-7a). A
 * test pins it as SHAPE_TOKEN_NAMES intersected with `allowedTokenNames('settings')`.
 */
const SETTINGS_SHAPE_TOKEN_NAMES: ReadonlySet<string> = SHAPE_TOKEN_NAMES

/** Popups declares no custom property (Rule SCOPE), so its shape variant keeps no token name. */
const NO_SHAPE_TOKEN_NAMES: ReadonlySet<string> = new Set()

/**
 * The custom properties an applied area's shape variant keeps. Chat keeps its own list. Studio keeps the chat list, which its
 * allowlist also accepts, and its geometry tokens; Home likewise with its own; Settings keeps the chat list. A test pins each against `allowedTokenNames(area)`.
 */
export function shapeTokenNames(area: AppliedArea): ReadonlySet<string> {
    if (area === 'studio') return STUDIO_SHAPE_TOKEN_NAMES
    if (area === 'home') return HOME_SHAPE_TOKEN_NAMES
    if (area === 'popups') return NO_SHAPE_TOKEN_NAMES
    return area === 'settings' ? SETTINGS_SHAPE_TOKEN_NAMES : SHAPE_TOKEN_NAMES
}

/** True when the text declares nothing: empty, comment-only, or only rule blocks emptied by the shape strip. */
export function hasNoDeclarations(text: string): boolean {
    try {
        return decls(text).length === 0
    } catch {
        return true
    }
}

const ROOT_SELECTOR = /^(:root|html)$/i
// Anything that fetches or draws an image. Only list-style and cursor can carry one among the shape properties.
const IMAGE_VALUE = /(?:^|[^\w-])(?:url|image|image-set|-webkit-image-set|cross-fade|element|paint)\(|-gradient\(/i
// A `var()` in these can resolve to an image held in a `--pack-*` helper, so such a value is removed too.
const IMAGE_PROPERTY = /^(list-style|cursor)$/

/** Splits a selector list at its top-level commas. */
function selectorList(selector: string): string[] {
    const parts: string[] = []
    let depth = 0
    let start = 0
    for (let i = 0; i < selector.length; i++) {
        const ch = selector[i]
        if (ch === '(' || ch === '[') depth++
        else if (ch === ')' || ch === ']') depth--
        else if (ch === ',' && depth === 0) {
            parts.push(selector.slice(start, i))
            start = i + 1
        }
    }
    parts.push(selector.slice(start))
    return parts.map((part) => part.trim())
}

function keepsCustomProperty(name: string, names: ReadonlySet<string>): boolean {
    return names.has(name) || name.startsWith('--pack-')
}

/**
 * The canonical chat sheet without its paint: whole declarations are removed (the declaration and its terminating `;`),
 * every other character is kept, and an emptied rule stays as an empty block.
 * - A top-level `:root` or `html` rule keeps only a custom property that is a shape token or a `--pack-*` helper (pack-private
 *   names that no app rule reads), so no app colour token and no `color-scheme` survives.
 * - Any other rule keeps a declaration whose property is on SHAPE_PROPERTY and whose value draws no image; its custom
 *   properties follow the root test. A `list-style` or `cursor` value that reads a variable goes too, because a `--pack-*`
 *   helper can hold an image.
 * - A `@font-face` block is kept whole: a font is typography.
 * Deterministic and never throws; a sheet the walker cannot read gives `''`, which applies nothing.
 */
export function shapeOnlySheet(canonical: string, names: ReadonlySet<string> = SHAPE_TOKEN_NAMES): string {
    try {
        const cuts: Array<[number, number]> = []
        for (const decl of decls(canonical)) {
            if (decl.ctx.at.some((prelude) => /^@font-face\b/i.test(prelude))) continue
            let keep: boolean
            if (decl.prop.startsWith('--')) {
                keep = keepsCustomProperty(decl.prop, names)
            } else if (!decl.ctx.keyframes && selectorList(decl.ctx.selector).every((part) => ROOT_SELECTOR.test(part))) {
                keep = false
            } else {
                keep = !decl.ctx.keyframes && SHAPE_PROPERTY.some((pattern) => pattern.test(decl.prop)) && !IMAGE_VALUE.test(decl.value) && !(IMAGE_PROPERTY.test(decl.prop) && /var\(/i.test(decl.value))
            }
            if (!keep) {
                cuts.push([decl.ds, canonical[decl.de] === ';' ? decl.de + 1 : decl.de])
            }
        }
        let out = canonical
        for (let i = cuts.length - 1; i >= 0; i--) {
            out = out.slice(0, cuts[i][0]) + out.slice(cuts[i][1])
        }
        return out
    } catch {
        return ''
    }
}
