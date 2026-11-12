// Settings' pack-install rule (DD-149, DD-155, DD-159, DS-075). The whole rule, Settings' value bounds included, lives in chat's validator (../engine).
// This module only holds the Settings registry and passes it: Settings part lists, the surfaces Settings critical text sits on, and strictSafe: true
// (no positioning in the safe tier at all, whatever chat's POSITIONABLE list says).
import * as chat from '../engine'
import type { ContrastPair, LintResult, NameMatch, RegistryInput, SurfaceCheck, TokenMap } from '../engine'
import type { GeometryChain, GeometrySheet, SheetTerm } from '../geometry'
import { tokenFile } from '../tokens'

/** The content estimate of the Settings dialog height model: title and body length in characters, extra fixed px (a list preview). */
export interface SettingsSheetRef {
    title: number
    body: number
    extra?: number
}

/** The Settings registry as lintPack receives it; a caller's partial registry is completed by full(). */
export interface SettingsRegistry extends RegistryInput {
    sheets: GeometrySheet[]
    chains: GeometryChain[]
    critical: string[]
    safe: string[]
    reach: string[]
    controls: string[]
    surfaces: SurfaceCheck[]
    strictSafe: boolean
    tokens: TokenMap
    settable: NameMatch[]
    pairs: ContrastPair[]
    opaque: string[]
    colours: NameMatch[]
}

// Settings' token defaults (nexus-tokens.css, then settings/theme-tokens.css over it), merged over chat's by lintPack (registry.tokens)
const readTokens = (css: string, into: TokenMap): TokenMap => {
    for (const m of css.matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)) into.set(m[1], m[2].trim())
    return into
}
// the defaults are the plain :root blocks: a later html[data-power="low"] or reduced-transparency block restates --nexus-surface as an opaque swap, which is not the default (DD-242 judges the sheet token against the real default)
const rootBlocks = (css: string): string => [...css.matchAll(/(?:^|\})\s*:root\s*\{([^}]*)\}/g)].map((m) => m[1]).join('\n')
export const SETTINGS_TOKENS: TokenMap = readTokens(rootBlocks(tokenFile('settings/theme-tokens.css')), readTokens(rootBlocks(tokenFile('theme/nexus-tokens.css')) || tokenFile('theme/nexus-tokens.css'), new Map()))


// ---- the Settings registry
export const SETTINGS_CRITICAL: string[] = ['settings-dialog', 'settings-dialog-backdrop', 'settings-critical-title', 'settings-critical-body', 'settings-critical-actions', 'settings-critical-action', 'settings-save-retry', 'settings-fix-banner', 'settings-chat-error-card',
    // rule 3 names warnings: the inline warnings and failure results
    'settings-connection-warning', 'settings-connection-card-status', 'settings-test-result', 'settings-picker-warning', 'settings-fix-mark', 'settings-preset-warning', 'settings-warning-banner']
// parts that are never critical, never hold a critical element and never sit inside one (asserted in the browser by parts.mjs over the whole tour)
export const SETTINGS_SAFE: string[] = ['settings-header', 'settings-search', 'settings-index-item', 'settings-index-link', 'settings-index-foot', 'settings-section-title', 'settings-jump-chips', 'settings-list-item', 'settings-toggle', 'settings-menu', 'settings-menu-item',
    'settings-callout', 'settings-banner', 'settings-toast', 'settings-results', 'settings-result', 'settings-result-group', 'settings-no-results', 'settings-switcher', 'settings-switcher-panel', 'settings-switcher-option', 'settings-switcher-option-name', 'settings-switcher-search', 'settings-switcher-scrim',
    'settings-picker-search', 'settings-picker-row-name', 'settings-picker-chip', 'settings-picker-scrim',
    'settings-connection-card-name', 'settings-fallback-item', 'settings-segmented']
export const SETTINGS_SURFACES: SurfaceCheck[] = [['--nexus-text', 'canvas', 'the canvas', 4.5], ['--nexus-text', 'glass', 'the row glass', 4.5], ['--nexus-text', 'raised', 'a raised surface', 4.5], ['--nexus-text', 'toast', 'the toast', 4.5], ['--nexus-text-secondary', 'canvas', 'the canvas', 4.5], ['--nexus-text-secondary', 'glass', 'the row glass', 4.5], ['--nexus-danger', 'sheet', 'the dialog', 4.5], ['--nexus-danger', 'canvas', 'the canvas', 4.5], ['--nexus-danger', 'glass', 'the row glass', 4.5], ['--nexus-field-border', 'glass', 'the row glass', 2], ['--nexus-ring', 'canvas', 'the canvas', 3], ['--nexus-ring', 'sheet', 'the dialog', 3],
    // DD-242: the warning colour is drawn as text and as the edge of the critical warnings (the over-limit line, the low-power note, the guard); muted text sits on the same rows
    ['--color-warning', 'canvas', 'the canvas', 4.5], ['--color-warning', 'glass', 'the row glass', 4.5], ['--color-warning', 'sheet', 'the dialog', 4.5], ['--nexus-text-muted', 'canvas', 'the canvas', 4.5]]
// DD-243: navigation (the header with its back control, the index items and links, the index footer, the jump chips) and the toast that carries Undo are reach tier, not safe. Settings has no Tasks, Stop, composer or Apply of its own.
export const SETTINGS_REACH: string[] = ['settings-header', 'settings-index-item', 'settings-index-link', 'settings-index-foot', 'settings-jump-chips', 'settings-toast']
// DD-242: the Settings role tokens a pack may set (THEME_AUDIT "Role tokens (the Settings pack contract)"): every --settings-* name, the shared decoration hooks and the field and contrast tokens. The numbered ladder (--space-N, --size-N, --offset-N, --size-rel-N, --radius-N, --leading-N, --font-size-*) is not listed.
export const SETTINGS_SETTABLE: NameMatch[] = [/^--settings-[a-z0-9-]+$/, /^--(field-padding-[xy]|field-min-height|control-gap|control-padding-x|focus-ring-offset|icon-stroke|icon-scale|icon-size-(xs|sm|md|lg|xl|2xl)|selection-bg|selection-text|scrollbar-color|scrollbar-width|caret-color)$/,
    /^--(body-columns(-mid)?|index-column|page-column|index-width(-mid)?|page-max-width|dialog-width|alpha-[a-z-]+|panel)$/, /^--pattern-[a-z0-9-]+$/, /^--(task|warning)-[a-z0-9-]+$/]
export const SETTINGS_PAIRS: ContrastPair[] = [['--color-on-accent', '--nexus-accent', 4.5, 'the accent fill']]
// DD-256 geometry model (an estimate of the DOM): the height of the critical dialog at 360 px (padding, title, body, margin, two stacked buttons).
// Calibrated against rendered pages at 360x640 touch, Korean. The dialog is a card of padding 18 with max-height 100% and overflow auto: it scrolls as a whole, so nothing is fixed.
// The tallest dialogs are list previews (import preview 536 px, delete a used connection 444 px): their list is the `extra` block.
export const SETTINGS_SHEET_TERMS = (p: SettingsSheetRef): SheetTerm[] => [{ t: '--settings-dialog-padding', n: 2 }, { px: 12 }, { text: { chars: p.title, size: '--font-size-xl', lead: 1.5, hpad: ['--settings-dialog-padding'], hfixed: 24 } }, { text: { chars: p.body, size: '--font-size-base', lead: 1.5, hpad: ['--settings-dialog-padding'], hfixed: 24 } }, { px: p.extra || 0 }, { t: '--settings-dialog-actions-margin-top' }, { t: '--size-touch' }]
export const SETTINGS_SHEET_REF: SettingsSheetRef = { title: 24, body: 60, extra: 420 }
export const SETTINGS_SHEETS: GeometrySheet[] = [{ name: 'settings critical dialog', terms: SETTINGS_SHEET_TERMS(SETTINGS_SHEET_REF), fixed: [], cap: 592 }]
// the real ancestry of the protected rows and cards (settings-frame > settings-shell > settings-body > settings-page > settings-page-body > settings-section > settings-rows > settings-row | settings-preset-card | the connection cards) and of the dialog (settings-frame > backdrop > dialog)
export const SETTINGS_CHAINS: GeometryChain[] = [{ name: 'the row chain (settings-page > settings-page-body > settings-section > settings-rows > settings-row)', parts: ['settings-page', 'settings-page-body', 'settings-section', 'settings-rows', 'settings-row'], defaults: { 'settings-rows': 2, 'settings-row': 36 } }, { name: 'the preset card chain (settings-rows > settings-preset-card)', parts: ['settings-page', 'settings-page-body', 'settings-section', 'settings-rows', 'settings-preset-card'], defaults: { 'settings-rows': 2, 'settings-preset-card': 20 } }, { name: 'the connection chain (settings-rows > settings-connection-list > settings-connection-card > settings-connection-card-main)', parts: ['settings-rows', 'settings-connection-list', 'settings-connection-card', 'settings-connection-card-main'], defaults: { 'settings-rows': 2, 'settings-connection-card-main': 20 } }, { name: 'the dialog chain (settings-dialog-backdrop > settings-dialog)', parts: ['settings-dialog-backdrop', 'settings-dialog'], defaults: { 'settings-dialog-backdrop': 24, 'settings-dialog': 38 } }]
export const SETTINGS_REGISTRY: SettingsRegistry = { sheets: SETTINGS_SHEETS, chains: SETTINGS_CHAINS, critical: SETTINGS_CRITICAL, safe: SETTINGS_SAFE, reach: SETTINGS_REACH, controls: SETTINGS_REACH, surfaces: SETTINGS_SURFACES, strictSafe: true, tokens: SETTINGS_TOKENS, settable: SETTINGS_SETTABLE, pairs: SETTINGS_PAIRS, opaque: ['--settings-surface-opaque', '--settings-surface-raised-opaque'], colours: [/^--panel$/] }
// a caller's partial registry keeps the Settings surfaces, tokens, reach list and settable list; strictSafe is always on
const full = (reg: RegistryInput): RegistryInput => ({ surfaces: SETTINGS_SURFACES, tokens: SETTINGS_TOKENS, colours: SETTINGS_REGISTRY.colours, ...reg, reach: [...SETTINGS_REACH, ...(reg.reach || [])], controls: [...SETTINGS_REACH, ...(reg.controls || [])], sheets: [...SETTINGS_SHEETS, ...(reg.sheets || [])], chains: [...SETTINGS_CHAINS, ...(reg.chains || [])], pairs: [...SETTINGS_PAIRS, ...(reg.pairs || [])], opaque: [...SETTINGS_REGISTRY.opaque, ...(reg.opaque || [])], settable: [...SETTINGS_SETTABLE, ...(reg.settable || [])], strictSafe: true })

export function lintPack(css: string, name = '', reg: RegistryInput = SETTINGS_REGISTRY): LintResult {
    return chat.lintPack(css, name, full(reg))
}
export function lintSelector(sel: string, reg: RegistryInput = SETTINGS_REGISTRY): string[] {
    return chat.lintSelector(sel, full(reg))
}
