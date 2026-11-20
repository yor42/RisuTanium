// The light reference base of a light-only pack, as the judge reads it. The declarations are the ones in
// chat-light-base.css, re-headed as one plain `:root` block: the judge reads `:root` maps, and the attribute selector is
// the app's own. The test suite compares this text with the stylesheet declaration by declaration, so the two cannot
// drift. Main thread only; this module imports no validator module.
//
// The `--pattern-*` labels of the stylesheet are left out: a pack may not set them, so a sheet that names them is refused
// whole. They are CSS-only and need no judgement of their own.
const LIGHT_BASE_DECLARATIONS: readonly string[] = [
    '--nexus-canvas: #f6f7fb',
    '--nexus-canvas-bloom: transparent',
    '--nexus-canvas-warm: transparent',
    '--nexus-surface: rgb(20 24 48 / 0.04)',
    '--nexus-surface-raised: rgb(20 24 48 / 0.08)',
    '--nexus-surface-flat: #ffffff',
    '--nexus-edge: rgb(20 24 48 / 0.14)',
    '--nexus-edge-strong: rgb(20 24 48 / 0.5)',
    '--nexus-field-border: rgb(var(--nexus-overlay-rgb) / 0.55)',
    '--nexus-text: #1c2140',
    '--nexus-text-secondary: #3d4363',
    '--nexus-text-muted: #4f5577',
    '--color-placeholder: #4f5577',
    '--nexus-accent-rgb: 61 75 168',
    '--nexus-accent: rgb(var(--nexus-accent-rgb))',
    '--nexus-ring: #3d4ba8',
    '--nexus-core-from: #3d4ba8',
    '--nexus-core-to: #2e3a8c',
    '--nexus-danger-rgb: 179 38 60',
    '--nexus-danger: rgb(var(--nexus-danger-rgb))',
    '--nexus-warning-rgb: 135 88 0',
    '--nexus-overlay-rgb: 20 24 48',
    '--alpha-switch-off: 0.55',
    '--color-surface-sheet: #ffffff',
    '--color-surface-toast: #ffffff',
    '--color-scheme: light',
    '--color-surface-bar: #eceef6',
    '--chat-speaker-0: #7a3b12',
    '--chat-speaker-1: #1f3f8a',
    '--chat-speaker-2: #0d5434',
    '--chat-speaker-3: #6b4a00',
    '--chat-speaker-4: #5b2f9e',
    '--chat-speaker-5: #8c1a42',
    '--chat-speaker-6: #0a4f61',
    '--chat-speaker-7: #7a2a8f',
    '--color-scope-character-text: #4b2a8a',
    '--color-scope-character-edge: #7a55d6',
    '--color-scope-character-rgb: 122 85 214',
    '--color-scope-all-text: #7a4a00',
    '--color-scope-all-edge: #c27c00',
    '--color-scope-all-rgb: 194 124 0',
    '--color-hit: #7a4f00',
    '--color-hit-rgb: 255 236 120',
    '--color-hit-bg: rgb(var(--color-hit-rgb) / 0.6)',
    '--color-syntax-keyword: #5b3fa0',
    '--color-surface-kbd: #e3e5ee',
    '--color-key: #ffffff',
    '--color-code-bg-inline: rgb(20 24 48 / 0.07)',
    '--color-code-bg: rgb(20 24 48 / 0.05)',
    '--color-shimmer: rgb(255 255 255 / 0.6)',
    '--color-on-accent: #ffffff',
    '--color-on-avatar: #1c2140',
    '--nexus-warm: #7a3b12',
]

/** Put in front of the pack's canonical chat sheet for the eligibility judgement; the pack's values then win later. */
export const LIGHT_BASE_JUDGE_PREFIX: string = `:root {\n${LIGHT_BASE_DECLARATIONS.map((declaration) => `  ${declaration};`).join('\n')}\n}`

/** True for a pack whose manifest modes are exactly `['light']`; any other label keeps the dark base. */
export function wantsLightBase(modes: readonly string[]): boolean {
    return modes.length === 1 && modes[0] === 'light'
}
