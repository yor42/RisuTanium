// The Settings part registry as slice 5b extends it (on top of slice 5a's, checks/th5a/registry5a.mjs, which is imported unchanged). checks/th/packlint-settings.mjs, registry4.mjs and registry5a.mjs are left as they are; this file adds the slice 5b names to their lists and passes them to
// the same validator (lintPack(css, name, registry), chat's validator since DD-160 / DD-195). The main session lifts these names into packlint-settings.mjs when it integrates slice 5b (SLICE5B_SPEC Appendix, integration notes).
import { SETTINGS_SURFACES, SETTINGS_TOKENS, lintPack as lintSettings } from '../th/packlint-settings.mjs';
import { CRITICAL5, SAFE5, MINIMUMS5 } from '../th5a/registry5a.mjs';
// the 34 new part names (SLICE5B_SPEC Appendix: Parts)
export const NEW_PARTS = ['settings-choice-list', 'settings-choice', 'settings-choice-recommended', 'settings-choice-legacy', 'settings-service-chip', 'settings-service-missing', 'settings-service-list', 'settings-service-row', 'settings-service-fields', 'settings-test-button', 'settings-service-test-result',
  'settings-preset-bar', 'settings-preset-summary', 'settings-preset-guard', 'settings-ratio-bar', 'settings-cost-line', 'settings-embedding-line', 'settings-embedding-row', 'settings-dim-reason', 'settings-prompt-view', 'settings-studio-link', 'settings-link-card',
  'settings-voice-list', 'settings-voice-row', 'settings-model-list', 'settings-model-option', 'settings-lora-list', 'settings-cache-block', 'settings-note', 'settings-notes', 'settings-disclosure', 'settings-readout', 'settings-notice', 'settings-ratio-remainder'];
// critical (a pack cannot name them, so cannot hide or recolour them): the "이전 방식" mark of a method, the missing-connection state, the result of a test (a failure must not be hidden), the last-preset guard and the reason line of a dimmed row (DS-096)
export const NEW_CRITICAL = ['settings-choice-legacy', 'settings-service-missing', 'settings-service-test-result', 'settings-preset-guard', 'settings-dim-reason', 'settings-cost-line', 'settings-notes', 'settings-notice', 'settings-ratio-remainder'];   // fix round 1 (R5B-5): the cost and download lines, the --api and licence notices, the notices that decisions mandate (DS-137 shared note, DS-139 cache reason, DS-141 stale-memory warning, DS-144 paid warning and test voice) and the remainder share
// safe leaves (never critical, never hold a critical element, never sit inside one; asserted in the browser by parts.mjs): the "권장" mark, the three-line preset summary, the ratio bar (the legend, the remainder and the number fields carry the same values), the embedding line,
// the decorative one-line notes, and the read-only max ratio. The rows, lists, cards, caches and fields hold controls with no other way, so they are reach tier
export const NEW_SAFE = ['settings-choice-recommended', 'settings-preset-summary', 'settings-ratio-bar', 'settings-embedding-line', 'settings-note', 'settings-readout'];
// reach tier (restyle, not hide): the lists and rows hold critical parts and the controls
export const REACH = NEW_PARTS.filter((n) => !NEW_CRITICAL.includes(n) && !NEW_SAFE.includes(n));
export const CRITICAL5B = [...CRITICAL5, ...NEW_CRITICAL];
export const SAFE5B = [...SAFE5, ...NEW_SAFE];
// DD-182 / DD-187 / DD-195: a floor for the bar of the missing-connection state, the failed test, the dimmed reason and the guard (the smallest edge at which they still read as a warning); units px only. The earlier floors stay.
export const MINIMUMS5B = { ...MINIMUMS5, '--p5b-bar': '2px' };
export const REG5B = { critical: CRITICAL5B, safe: SAFE5B, surfaces: SETTINGS_SURFACES, tokens: SETTINGS_TOKENS, strictSafe: true, minimums: MINIMUMS5B, settable: [/^--param-[a-z0-9-]+$/, /^--p5-[a-z0-9-]+$/, /^--p5b-[a-z0-9-]+$/] };   // DD-242: the slice 4, 5a and 5b role tokens
export const lint5b = (css, name = '') => lintSettings(css, name, REG5B);
