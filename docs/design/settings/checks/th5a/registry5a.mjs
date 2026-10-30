// The Settings part registry as slice 5a extends it (on top of slice 4's, checks/th4/registry4.mjs, which is imported unchanged). checks/th/packlint-settings.mjs and registry4.mjs are left as they are; this file adds the slice 5a names to their lists and passes them to
// the same validator (lintPack(css, name, registry), chat's validator since DD-160 / DD-195). The main session lifts these names into packlint-settings.mjs when it integrates slice 5a (SLICE5A_SPEC Appendix, integration notes).
import { SETTINGS_SURFACES, SETTINGS_TOKENS, lintPack as lintSettings } from '../th/packlint-settings.mjs';
import { CRITICAL4, SAFE4, MINIMUMS4 } from '../th4/registry4.mjs';
// the 40 new part names (SLICE5A_SPEC Appendix: Parts)
export const NEW_PARTS = ['settings-hotkey-row', 'settings-hotkey-chord', 'settings-hotkey-recording', 'settings-hotkey-conflict', 'settings-hotkey-conflict-action', 'settings-hotkey-banner', 'settings-list-tools', 'settings-search-field', 'settings-empty',
  'settings-persona-list', 'settings-persona-card', 'settings-persona-handle', 'settings-persona-active', 'settings-persona-count', 'settings-persona-editor', 'settings-persona-portrait', 'settings-persona-guard', 'settings-persona-bound',
  'settings-plugin-list', 'settings-plugin-row', 'settings-plugin-meta', 'settings-plugin-chip', 'settings-plugin-access', 'settings-plugin-result', 'settings-plugin-warning', 'settings-plugin-args', 'settings-plugin-arg', 'settings-plugin-unsupported', 'settings-plugin-switch',
  'settings-module-list', 'settings-module-row', 'settings-module-badge', 'settings-module-chip', 'settings-module-studio', 'settings-module-access', 'settings-module-counts', 'settings-module-mcp', 'settings-module-where', 'settings-module-layer', 'settings-module-switch'];
// R5-11: the switch of a plugin row and of a module row is the only control that turns the item off, so it is a critical part of its own (slice 1's settings-toggle is a safe leaf that a pack may hide)
// critical (a pack cannot name them, so cannot hide or recolour them): the chord and the recording line (the shortcut itself), the conflict warning and its two buttons, the active mark and the last-persona guard, what a plugin can reach (the access line,
// the page-top warning, the update result which must not be silent, the not-supported line), and what a module can reach (the 고급 권한 badge, the permission block, the primary Studio button)
export const NEW_CRITICAL = ['settings-hotkey-chord', 'settings-hotkey-recording', 'settings-hotkey-conflict', 'settings-hotkey-conflict-action', 'settings-persona-active', 'settings-persona-guard', 'settings-plugin-access', 'settings-plugin-result', 'settings-plugin-warning', 'settings-plugin-unsupported', 'settings-module-badge', 'settings-module-studio', 'settings-module-access', 'settings-plugin-switch', 'settings-module-switch'];
// safe leaves (never critical, never hold a critical element, never sit inside one; asserted in the browser by parts.mjs): a banner that repeats what the rows say, the search field, the empty state, the drag handle (the menu and Alt+Up/Down are the other ways), the chat count, the list of bound chats, the version line, the chips and the content counts. The tool bars, the portrait button and the MCP box hold controls with no other way, so they are reach tier
export const NEW_SAFE = ['settings-hotkey-banner', 'settings-search-field', 'settings-empty', 'settings-persona-handle', 'settings-persona-count', 'settings-persona-bound', 'settings-plugin-meta', 'settings-plugin-chip', 'settings-module-chip', 'settings-module-counts'];
// reach tier (restyle, not hide): the rows, lists, cards, editor, layers and the where-block hold critical parts
export const REACH = NEW_PARTS.filter((n) => !NEW_CRITICAL.includes(n) && !NEW_SAFE.includes(n));
export const CRITICAL5 = [...CRITICAL4, ...NEW_CRITICAL];
export const SAFE5 = [...SAFE4, ...NEW_SAFE];
// DD-182 / DD-187 / DD-195: a floor for the bar of the conflict warning and the access lines (the smallest edge at which they still read as a warning); units px only. Slice 4's two floors stay.
export const MINIMUMS5 = { ...MINIMUMS4, '--p5-warn-bar': '2px' };
export const REG5 = { critical: CRITICAL5, safe: SAFE5, surfaces: SETTINGS_SURFACES, tokens: SETTINGS_TOKENS, strictSafe: true, minimums: MINIMUMS5, settable: [/^--param-[a-z0-9-]+$/, /^--p5-[a-z0-9-]+$/] };   // DD-242: the slice 4 and 5a role tokens
export const lint5 = (css, name = '') => lintSettings(css, name, REG5);
