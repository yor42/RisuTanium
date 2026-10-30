// Regression suite for the fail-closed theme lint (DD-242, DD-243, DD-235, DD-236).  Node only, no browser.
//   node theme/checks/run.mjs [--json]      exits 1 when an assertion fails; writes theme/checks/results.json and results.log
// Sections: 1 shipped packs, 2 Studio review packs, 3 Home re-review packs, 4 new DD-242/243 packs, 5 benign fixtures per area, 6 legacy suites of the areas, 7 single-token fuzz, 8 shared tokens.
import fs from 'node:fs'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
import { LINT, REG, PACKS, here, DESIGN, read, reasons } from './lib.mjs';
import { HOME_BENIGN, NEW_BENIGN, NEW_HOSTILE } from './fixtures/benign.mjs';
const fx = (n) => JSON.parse(fs.readFileSync(path.join(here, 'fixtures', n), 'utf8'));
const imp = (rel) => import(pathToFileURL(path.join(DESIGN, rel)).href);
const rows = []; let cur = '';
const A = (id, name, ok, detail = '') => { rows.push({ section: cur, id, name, ok: !!ok, detail: String(detail).slice(0, 400) }); if (!ok) console.log(`FAIL [${cur}] ${id} ${name}${detail ? '  -- ' + String(detail).slice(0, 300) : ''}`); };
const sec = (s) => { cur = s; };
const why = (r) => reasons(r).join(' | ');
const NAVY_STUDIO = read('studio/themes/origin-navy.css');

// ---- helper variables: a hostile pack that chains through --x, --a ... is also judged with those names listed, so the underlying floor logic is shown to still work
const HELPERS = [/^--(x\d?|a|b|z|t|w|r)$/];
const lintOpen = {
  chat: (css, n) => REG.chat.lintPack(css, n, { settable: HELPERS }),
  settings: (css, n) => REG.sbase.lintPack(css, n, { ...REG.s5b.REG5B, settable: HELPERS }),
  studio: (css, n) => { const r = REG.st.lintPack(css, n, { ...REG.st.STUDIO_REGISTRY, settable: [...REG.st.STUDIO_SETTABLE, ...HELPERS] }); const e = REG.st.riskyColourPass(css); if (e.length) { r.errors.push(...e); r.ok = false; } return r; },
  home: (css, n) => { const r = REG.chat.lintPack(css, n, { ...REG.home.HOME_REGISTRY, settable: [...REG.home.HOME_SETTABLE, ...HELPERS] }); const e = REG.home.homeSupplement(css); if (e.length) { r.errors.push(...e); r.ok = false; } return r; },
};

// ================= 1. shipped packs
sec('1 shipped packs');
// A shipped pack that fails the new rules is NOT edited here: it is listed for its area owner with the fix it needs.
export const NEEDS_FIX = {
};
const shipped = {};
for (const [k, f] of Object.entries(PACKS)) {
  const r = LINT[k.split('/')[0]](read(f), f); shipped[k] = r;
  A('shipped:' + k, r.ok ? 'accepted' : 'rejected and listed as needing a pack fix', r.ok || !!NEEDS_FIX[k], r.ok ? '' : `${r.errors.length} errors; first: ${why(r).slice(0, 200)}`);
  if (NEEDS_FIX[k]) A('shipped-listed:' + k, 'a pack listed as needing a fix still fails (remove from the list once fixed)', !r.ok);
}

// ================= 2. Studio review packs (reviews/studio-theme-review/hostile.mjs, copied)
sec('2 studio review packs');
const R_ALLOW = /not on the declaration allowlist|can contain, be or sit inside|translucent text/;
const STUDIO_EXPECT = {
  H01: /protected part studio-save-chip/, H02: /protected part studio-save-retry/, H03: /translucent text|allowlist/, H04: R_ALLOW, H05: R_ALLOW,
  P04: /larger than 64 px/, S04: /names no part|protected part/, S12: /names no part/, S13: /names no part/, S14: /names no part/, S15: /names no part/, S16: /names no part/, S17: /names no part/, S18: /names no part/, S19: /names no part/,
  T01: /fully transparent/, T02: /would be [\d.]+:1/, T03: /fully transparent/, T04: /critical minimum/, T05: /not a pack-settable/, T06: /not a pack-settable/, T07: /not a pack-settable/, T08: /not a pack-settable/, T09: /not a pack-settable/, T10: /not a pack-settable/, T11: /not a pack-settable/, T12: /not a pack-settable/,
  T13: /critical minimum/, T14: /fully transparent/, T15: /not a pack-settable/, T16: /would be [\d.]+:1/, T17: /would be [\d.]+:1/, T18: /critical maximum/, T19: /would be [\d.]+:1/, T20: /would be [\d.]+:1/, T21: /not a pack-settable/, T22: /not a pack-settable/, T23: /not a pack-settable/, T24: /would be [\d.]+:1/, T25: /would be [\d.]+:1/, T26: /would be [\d.]+:1/,
};
// accepted BY DECISION: DD-243 protects the key controls only; "other safe parts keep DD-155's freedom". These stay accepted and are reported as residual risk (review M4), not failures.
const STUDIO_DECIDED_ACCEPT = new Set(['H06', 'H07', 'H08', 'P06', 'P07', 'P08', 'P09', 'P10', 'P11', 'P17']);   // P04 (4000 px padding on an ordinary toast) is rejected since DD-260 bounded safe-tier padding
const sh = fx('studio-hostile.json'); let sRej = 0, sRight = 0; const sWrong = [], sAcc = [];
for (const f of sh) {
  for (const [label, css] of [['bare', f.css], ['on Navy', NAVY_STUDIO + '\n' + f.css]]) {
    const r = LINT.studio(css, f.id);
    if (STUDIO_DECIDED_ACCEPT.has(f.id)) { A(`studio:${f.id} ${label}`, 'accepted by decision (DD-243 leaves other safe parts free)', r.ok, f.name); sAcc.push(f.id); continue; }
    const re = STUDIO_EXPECT[f.id] || /./; const ok = !r.ok && r.errors.some((e) => re.test(e.why));
    if (!r.ok) sRej++; if (ok) sRight++; else sWrong.push(`${f.id} ${label}: ${r.ok ? 'ACCEPTED' : why(r).slice(0, 120)}`);
    A(`studio:${f.id} ${label}`, `${f.name.slice(4)} rejected for the right reason (${re})`, ok, r.ok ? 'ACCEPTED' : why(r).slice(0, 200));
  }
}
const studioExtra = [
  ['B1-token sheet transparent', ':root{--color-surface-sheet:transparent}', /fully transparent|opaque/], ['B1-token sheet alpha .05', ':root{--color-surface-sheet:rgb(0 1 28 / 0.05)}', /opaque colour/], ['toast transparent', ':root{--color-surface-toast:transparent}', /fully transparent|opaque/],
  ['sheet = canvas colour translucent', ':root{--color-surface-sheet:rgb(0 1 28 / 0.1)}', /opaque colour/], ['edge transparent', ':root{--nexus-edge:transparent;--nexus-edge-strong:transparent}', /fully transparent/], ['studio-tint-sheet-92 holder', ':root{--studio-tint-sheet-92:transparent}', /not a pack-settable/],
  ['M6 tree width 100px', ':root{--studio-tree-width:100px}', /critical minimum/], ['M6 tree width 400px accepted? (inside 160..480)', null, null], ['M6 side width 3000px', ':root{--studio-side-width:3000px}', /critical maximum/], ['M6 side width 100px', ':root{--studio-side-width:100px}', /critical minimum/],
  ['B2 animation speed', ':root{--risu-animation-speed:100}', /not a pack-settable/], ['B2 sizes ladder', ':root{--studio-sz-12vh:3000px;--studio-sp-2px:3000px}', /not a pack-settable/],
];
for (const [n, css, re] of studioExtra) { if (!css) { const r = LINT.studio(':root{--studio-tree-width:400px}', n); A('studio-extra:' + n, 'a tree width inside its limits is accepted', r.ok, why(r)); continue; } const r = LINT.studio(css, n); A('studio-extra:' + n, `rejected (${re})`, !r.ok && r.errors.some((e) => re.test(e.why)), r.ok ? 'ACCEPTED' : why(r).slice(0, 160)); }

// ================= 3. Home re-review packs (reviews/home-rereview/hostile-packs*.json, copied)
sec('3 home review packs');
// right reason by group: K colours, L focus, S/N/M/H/V/W/T/G/F ... each must be rejected with a reason from the group's set
const HOME_RIGHT = (id) => {
  if (/^K(1|2|5|6|7|8|9|10|11|12|14|17|18|19|21|22|23)$/.test(id)) return /cannot be resolved to a concrete sRGB|would be [\d.]+:1|cannot be checked/;
  if (/^K(3|4|13|15|16|20|24)$/.test(id)) return /fully transparent|opaque|would be [\d.]+:1|cannot be resolved|primary button label/;
  if (/^L[1-7]$/.test(id)) return /outlines|indication of focus|allowlist|visibility|not allowed in a pack selector/;   // L3 uses :focus, which no pack selector may use at all
  if (/^(H\d+|V\d|W\d|T\d|N\d+|G\d+|M\d+)$/.test(id) || id === 'A8') return /allowlist|can place|position|negative margin|outline|cursor|transform|clip|filter|z-index|animation|transition|font size|translucent|not allowed|beyond|inset|float|can cover, fade or disable|larger than 64|text colour that is|background that makes|writing-mode/;
  if (/^F\d+$/.test(id)) return /critical m|cannot be|not a pack-settable|not allowed|@/;
  if (/^C\d+$/.test(id)) return /would be [\d.]+:1|fully transparent|cannot be resolved|not allowed|@media|not a pack-settable/;
  if (/^[ARS]\d+$/.test(id)) return /protected part|data-part-critical|not allowed|allowlist|url|@|transform|position|animation|transition|content|z-index|background|opaque/;
  return /./;
};
const HOME_DECIDED_ACCEPT = new Set(['H52']);   // font-family "Wingdings" on Send: a font family is a pack's freedom (fonts are out of scope for lint); reported as residual
const hh = fx('home-hostile.json'); let hRej = 0, hRight = 0; const hWrong = [], hViaHelper = [];
for (const f of hh) {
  const key = f.id;
  const r = LINT.home(f.css, key);
  if (HOME_DECIDED_ACCEPT.has(key)) { A('home:' + key, 'accepted by decision (a font family is free)', r.ok, f.name); continue; }
  const re = HOME_RIGHT(key); let ok = !r.ok && r.errors.some((e) => re.test(e.why));
  let via = '';
  if (!r.ok && !ok && r.errors.some((e) => /not a pack-settable/.test(e.why))) {   // rejected because it chains through a helper variable: show that the original mechanism still rejects it once the helpers are listed
    const o = lintOpen.home(f.css, key); ok = !o.ok && o.errors.some((e) => re.test(e.why)); via = ' (via helper variables listed)'; if (ok) hViaHelper.push(key);
  }
  if (!r.ok) hRej++; if (ok) hRight++; else hWrong.push(`${key}: ${r.ok ? 'ACCEPTED' : why(r).slice(0, 120)}`);
  A('home:' + key, `${f.name.slice(0, 60)} rejected for the right reason${via}`, ok, r.ok ? 'ACCEPTED' : why(r).slice(0, 200));
  if (/^F(1|5|6|7|8|17|18|20)$/.test(key) || key === 'F19' || key === 'F2') {   // the floor and ceiling cases: with their helper variables listed, the ORIGINAL mechanism (the worst-case floors) still rejects them
    const o = lintOpen.home(f.css, key); A('home-open:' + key, 'with its helper variables listed, the floor / ceiling logic still rejects it', !o.ok && o.errors.some((e) => /critical m|cannot be/.test(e.why)), o.ok ? 'ACCEPTED' : why(o).slice(0, 160));
  }
}

// ================= 4. new DD-242 / DD-243 packs
sec('4 new rules');
let nRej = 0, nRight = 0; const nWrong = [];
for (const [area, name, css, re] of NEW_HOSTILE) {
  for (const a of area === 'all' ? Object.keys(LINT) : [area]) {
    const r = LINT[a](css, name); const ok = !r.ok && r.errors.some((e) => re.test(e.why)); if (!r.ok) nRej++; if (ok) nRight++; else nWrong.push(`${a}/${name}: ${r.ok ? 'ACCEPTED' : why(r).slice(0, 110)}`);
    A(`new:${a}:${name}`, `rejected for the right reason (${re})`, ok, r.ok ? 'ACCEPTED' : why(r).slice(0, 200));
  }
}
// the opaque rule and the pair rule hold in every alternative: a good value declared last does not hide a bad one in an @media block (covered above), and the default Deep Nexus pack (no rules) is accepted everywhere
for (const a of Object.keys(LINT)) { const r = LINT[a]('', 'empty'); A('new:empty:' + a, 'an empty pack (Deep Nexus as is) is accepted: no default fails its own rules', r.ok, why(r)); }
{ // registry.same (generic): a channel must stand for its colour
  const bad = REG.chat.lintPack(':root{--nexus-accent-rgb:255 0 0}', 'same', { same: [['--nexus-accent-rgb', '--nexus-canvas', 'test']] }), good = REG.chat.lintPack('', 'same', { same: [['--nexus-canvas', '--nexus-canvas', 't']] });
  A('new:same', 'registry.same rejects a channel that is not its colour', !bad.ok && bad.errors.some((e) => /is not the colour of/.test(e.why)) && good.ok, why(bad).slice(0, 160));
  const off = REG.chat.lintPack(':root{--pack-y:#fee500}', 'off', { privatePrefix: '' });
  A('new:private-prefix', 'DD-258: --pack-* is the one private prefix in every registry (a registry may turn it off with "")', LINT.chat(':root{--pack-y:#fee500}', 'p').ok && Object.keys(LINT).every((a) => LINT[a](':root{--pack-y:#fee500}', 'p').ok) && !off.ok && !LINT.chat(':root{--bc-y:#fee500}', 'bc').ok, why(off).slice(0, 100));
}

// ================= 4b. DD-258: private variables cannot launder a value; DD-260: ceilings, safe padding, ancestor chains; DD-256: sheet height
sec('4b private, ceilings, chains, height');
const PRIV = [   // [name, css, accepted?, reason]
  ['a private colour used by a control', ':root{--pack-y:#fee500}[data-part="chat-send"]{background:var(--pack-y);color:#191919}', true],
  ['text colour through a private variable', ':root{--pack-t:#0e0f2b;--nexus-text:var(--pack-t)}', false, /would be [\d.]+:1/],
  ['colour-mix through a private variable', ':root{--pack-t:color-mix(in srgb,red,blue);--nexus-text:var(--pack-t)}', false, /cannot be resolved to a concrete sRGB/],
  ['oklch through a chain of two', ':root{--pack-a:var(--pack-b);--pack-b:oklch(0.1 0 0);--nexus-danger:var(--pack-a)}', false, /cannot be resolved to a concrete sRGB/],
  ['transparent sheet through a private variable', ':root{--pack-s:transparent;--color-surface-sheet:var(--pack-s)}', false, /fully transparent|opaque/],
  ['translucent sheet through a private variable', ':root{--pack-s:rgb(14 15 42 / 0.4);--color-surface-sheet:var(--pack-s)}', false, /opaque colour/],
  ['a floor through a private variable', ':root{--pack-s:0px;--nexus-focus-ring-width:var(--pack-s)}', false, /critical minimum/],
  ['a ceiling through a private variable', ':root{--pack-s:900px;--header-height:var(--pack-s)}', false, /critical maximum/],
  ['a ceiling through a private variable in calc()', ':root{--pack-s:400px;--header-height:calc(var(--pack-s) * 2)}', false, /critical maximum/],
  ['the bad value only under a root attribute', ':root{--pack-t:#fff}html[data-layout="phone"]{--pack-t:#0e0f2b}:root{--nexus-text:var(--pack-t)}', false, /would be [\d.]+:1/],
  ['the bad value only in an @media block', ':root{--pack-t:#fff}@media (min-width:1px){:root{--pack-t:#0e0f2b}}:root{--nexus-text:var(--pack-t)}', false, /would be [\d.]+:1/],
  ['the bad value declared first, a good one last', '@media (min-width:1px){:root{--pack-t:#0e0f2b}}:root{--pack-t:#fff;--nexus-text:var(--pack-t)}', false, /would be [\d.]+:1/],
  ['padding through a private variable under a root attribute', 'html[data-layout="phone"]{--pack-p:9999px}[data-part="chat-send"]{padding:var(--pack-p)}', false, /larger than 64 px/],
  ['padding through a fallback', '[data-part="chat-send"]{padding:var(--pack-none,9999px)}', false, /larger than 64 px/],
  ['a private variable chaining to a ladder token', ':root{--pack-g:var(--space-3);--control-gap:var(--pack-g)}', true],
  ['a cycle', ':root{--pack-a:var(--pack-b);--pack-b:var(--pack-a)}', false, /cannot be judged/],
  ['a private variable set on a part (inlined as one more value, judged wherever it is read)', '[data-part="chat-send"]{--pack-a:1px}', true],
  ['a part-scoped private value that reaches a ceiling', '[data-part="chat-send"]{--pack-a:900px}:root{--header-height:var(--pack-a)}', false, /critical maximum/],
  ['an unlisted name that only looks private', ':root{--packs-x:#fff}', false, /not a pack-settable/],
  ['background through a private variable on a kind selector', ':root{--pack-b:#fff}[data-kind="restore"]{background:var(--pack-b)}', false, /names no part/],
  ['outline through a private variable', ':root{--pack-o:none}[data-part="chat-message-name"]{outline:var(--pack-o)}', false, /outlines/],
  ['display through a private variable on Send', ':root{--pack-d:none}[data-part="chat-send"]{display:var(--pack-d)}', false, /allowlist/],
  ['a text colour through a private variable on a reach part', ':root{--pack-c:#0e0f2b}[data-part="chat-list-row"]{color:var(--pack-c)}', false, /text colour that is/],
];
for (const [n, css, want, re] of PRIV) for (const a of Object.keys(LINT)) {
  if (n.includes('studio') && a !== 'studio') continue;
  const r = LINT[a](css, n); const ok = want ? r.ok : !r.ok && r.errors.some((e) => re.test(e.why));
  A(`private:${a}:${n}`, want ? 'accepted' : `rejected (${re})`, ok, r.ok ? 'ACCEPTED' : why(r).slice(0, 160));
}
const FIX_ROUND = [   // Studio fix round (review M2, M3, M6): the save chip and Retry are protected, their ancestors leave the safe tier, --studio-critical-min-width is a floored role token
  ['hide the failing chip icon', '[data-part="studio-save-chip-icon"]{display:none}', /protected part studio-save-chip-icon/],
  ['hide the failing chip text', '[data-part="studio-save-chip-text"]{font-size:0}', /protected part studio-save-chip-text/],
  ['transparent chip text', '[data-part="studio-save-chip-text"]{color:transparent}', /protected part studio-save-chip-text/],
  ['hide the chip while failed (by state)', '[data-part="studio-save-chip"][data-state="failed"]{display:none}', /protected part studio-save-chip/],
  ['hide the chip in conflict', '[data-part="studio-save-chip"][data-state="conflict"]{opacity:0}', /protected part studio-save-chip/],
  ['hide Retry', '[data-part="studio-save-retry"]{display:none}', /protected part studio-save-retry/],
  ['hide the header (it holds the chip)', '[data-part="studio-header"]{display:none}', /allowlist/],
  ['hide the save slot', '[data-part="studio-save-slot"]{visibility:hidden}', /allowlist/],
  ['squeeze a banner: min width 40px', ':root{--studio-critical-min-width:40px}', /critical minimum/],
  ['squeeze a banner: min width 159px', ':root{--studio-critical-min-width:159px}', /critical minimum/],
  ['squeeze under a phone layout', 'html[data-layout="phone"]{--studio-critical-min-width:100px}', /critical minimum/],
  ['squeeze in an @media block', '@media (max-width:400px){:root{--studio-critical-min-width:0}}', /critical minimum/],
  ['squeeze through a private variable', ':root{--pack-w:20px;--studio-critical-min-width:var(--pack-w)}', /critical minimum/],
  ['squeeze with a relative unit', ':root{--studio-critical-min-width:10vw}', /critical minimum/],
  ['min width beyond a phone', ':root{--studio-critical-min-width:900px}', /critical maximum/],
  ['squeeze by ancestor padding (form host 100 + body 20 a side)', '[data-part="studio-form-host"]{padding:0 100px}[data-part="studio-body"]{padding:0 20px}', /ancestor padding along/],
  ['the splitter\'s own variable is not settable', ':root{--studio-tree-user-width:100px}', /not a pack-settable/],
  ['the old unprefixed tab size is not settable', ':root{--tab-size:99}', /not a pack-settable/],
  ['tab size 99', ':root{--studio-tab-size:99}', /critical maximum/],
  ['tab size 0', ':root{--studio-tab-size:0}', /critical minimum/],
  ['tree width 100 (bounded 160 to 480)', ':root{--studio-tree-width:100px}', /critical minimum/],
  ['side width 3000 (bounded 240 to 560)', ':root{--studio-side-width:3000px}', /critical maximum/],
];
for (const [n, css, re] of FIX_ROUND) { const r = LINT.studio(css, n), nv = LINT.studio(read('studio/themes/origin-navy.css') + '\n' + css, n); A(`studio-fix:${n}`, `rejected (${re}), bare and on Origin Navy`, !r.ok && r.errors.some((e) => re.test(e.why)) && !nv.ok, r.ok ? 'ACCEPTED' : why(r).slice(0, 160)); }
for (const [n, css] of [['min width at the page default 160px', ':root{--studio-critical-min-width:160px}'], ['min width 240px', ':root{--studio-critical-min-width:240px}'], ['tab size 4', ':root{--studio-tab-size:4}'], ['tree width 300px', ':root{--studio-tree-width:300px}'], ['count error background transparent', ':root{--studio-count-error-bg:transparent}'], ['recolour the header (reach)', '[data-part="studio-header"]{border-radius:12px;padding:4px 12px}'], ['form host padding 16px a side', '[data-part="studio-form-host"]{padding:0 16px}']]) { const r = LINT.studio(css, n); A(`studio-fix-ok:${n}`, 'accepted', r.ok, why(r)); }
{ // DD-265: the Studio review's ancestor-reach packs (reviews/studio-theme-review/reach.mjs R1..R16, copied by reading the file), judged by the Studio lint
  const src = fs.readFileSync(path.join(DESIGN, 'reviews/studio-theme-review/reach.mjs'), 'utf8'); const R = [...src.matchAll(/\['(R\d+) ([^']*)', '((?:[^'\\]|\\.)*)'\]/g)].map((m) => [m[1], m[2], m[3]]);
  const MUST = { R1: /ancestor padding|larger than 64/, R2: /larger than 64|ancestor padding/, R3: /ancestor padding/, R4: /ancestor padding/, R11: /names no part/, R12: /names no part/, R15: /names no part|outlines/, R16: /root of a protected sheet/ };
  const verdicts = [];
  for (const [id, name, css] of R) { const r = LINT.studio(css, id); verdicts.push(id + (r.ok ? ' accepted' : ' rejected')); if (MUST[id]) A(`studio-reach:${id}`, `${name} is rejected (${MUST[id]})`, !r.ok && r.errors.some((e) => MUST[id].test(e.why)), r.ok ? 'ACCEPTED' : why(r).slice(0, 160)); }
  A('studio-reach:count', `all ${R.length} reach packs were read (R1..R16)`, R.length === 16, verdicts.join(', '));
}
const DD265 = [   // a selector that names no part may not change a size; the root of a protected sheet keeps the page's width
  ['all', 'padding on a kind selector', '[data-kind="peer"]{padding:64px}', /names no part can resize/], ['all', 'border width on a kind selector', '[data-kind="conflict"]{border:16px dashed #f8f8f2}', /names no part can resize/],
  ['all', 'border-width on a state selector', '[data-state="failed"]{border-width:16px}', /names no part can resize/], ['all', 'font-size on a kind selector', '[data-kind="restore"]{font-size:40px}', /names no part can resize/],
  ['all', 'width on a kind selector', '[data-kind="apply"]{width:50%}', /names no part can resize/], ['all', 'max-width on a kind selector', '[data-kind="leave"]{max-width:50%}', /names no part can resize/], ['all', 'min-width on a state selector', '[data-state="ask"]{min-width:900px}', /names no part can resize/],
  ['all', 'padding-inline on a state selector', '[data-state="failed"]{padding-inline:50px}', /names no part can resize/], ['all', 'padding through a private variable', ':root{--pack-p:64px}[data-kind="peer"]{padding:var(--pack-p)}', /names no part can resize/],
  ['all', 'inside @media', '@media (max-width:2000px){[data-kind="peer"]{padding:64px}}', /names no part can resize/], ['all', 'with a root attribute in front', 'html[data-layout="phone"] [data-kind="peer"]{padding:64px;font-size:40px}', /names no part can resize/],
  ['studio', 'sheet root width 50%', '[data-part="studio-sheet-root"]{width:50%;max-width:50%}', /root of a protected sheet/], ['studio', 'sheet root width 200px', '[data-part="studio-sheet-root"]{width:200px}', /root of a protected sheet/], ['studio', 'sheet root min-width 900px', '[data-part="studio-sheet-root"]{min-width:900px}', /root of a protected sheet/],
  ['chat', 'chat sheet width 50%', '[data-part="chat-sheet"]{width:50%}', /root of a protected sheet/], ['chat', 'chat sheet body max-width 100px', '[data-part="chat-sheet-body"]{max-width:100px}', /root of a protected sheet/], ['home', 'home dialog width 150px', '[data-part="home-dialog"]{width:150px}', /root of a protected sheet/],
];
for (const [ar, n, css, re] of DD265) for (const a of ar === 'all' ? Object.keys(LINT) : [ar]) { const r = LINT[a](css, n); A(`dd265:${a}:${n}`, `rejected (${re})`, !r.ok && r.errors.some((e) => re.test(e.why)), r.ok ? 'ACCEPTED' : why(r).slice(0, 160)); }
for (const a of Object.keys(LINT)) for (const [n, css] of [['colour and radius on a kind selector', '[data-kind="peer"]{border-color:#f8f8f2;border-radius:12px;color:#fff}'], ['a width of auto or 100% on a sheet root', '[data-part="studio-sheet-root"]{width:100%;max-width:none}']]) { if (/sheet root/.test(n) && a !== 'studio') continue; const r = LINT[a](css, n); A(`dd265-ok:${a}:${n}`, 'accepted', r.ok, why(r)); }
const CEIL_PACKS = [   // DD-260
  ['chat', 'header height 3000px', ':root{--header-height:3000px}', /critical maximum/], ['chat', 'message gap 3000px', ':root{--message-gap:3000px}', /critical maximum/], ['chat', 'composer field height 900px', ':root{--composer-field-height:900px}', /critical maximum/],
  ['chat', 'sidebar width 3000px', ':root{--sidebar-width:3000px}', /critical maximum/], ['chat', 'avatar 500px', ':root{--size-avatar:500px}', /critical maximum/], ['chat', 'font size xl 300px', ':root{--font-size-xl:300px}', /critical maximum/],
  ['chat', 'touch size 300px', ':root{--size-touch:300px}', /critical maximum/], ['chat', 'bubble padding 500px', ':root{--bubble-pad-start:500px}', /critical maximum/],
  ['studio', 'tab height 900px', ':root{--studio-tab-height:900px}', /critical maximum/], ['studio', 'tree row height 900px', ':root{--studio-tree-row-height:900px}', /critical maximum/], ['studio', 'splitter 900px', ':root{--studio-splitter-width:900px}', /critical maximum/],
  ['studio', 'padding 4000px on an ordinary toast (P04)', '[data-part="studio-toast"]{padding:4000px}', /larger than 64 px/],
  ['home', 'padding 500px on a safe card', '[data-part="home-story"]{padding:500px}', /larger than 64 px/], ['settings', 'padding 500px on a safe leaf', '[data-part="settings-section-title"]{padding:500px}', /larger than 64 px/],
  ['studio', 'M3 main + body padding 64px (ancestor chain 256 px)', '[data-part="studio-main"]{padding:64px}[data-part="studio-body"]{padding:64px}', /ancestor padding along/],
  ['studio', 'M3 main + body + form host (each 40px a side, 240 px)', '[data-part="studio-main"]{padding:0 40px}[data-part="studio-body"]{padding:0 40px}[data-part="studio-form-host"]{padding:0 40px}', /ancestor padding along/],
  ['studio', 'M3 sheet root alone 64px', '[data-part="studio-sheet-root"]{padding:64px}', /ancestor padding along/],
  ['home', 'shell + main + library padding 48px each side', '[data-part="home-shell"]{padding:0 48px}[data-part="home-main"]{padding:0 48px}[data-part="home-library"]{padding:0 48px}', /ancestor padding along/],
  ['chat', 'transcript + message + body padding', '[data-part="chat-transcript"]{padding:0 64px}[data-part="chat-message"]{padding:0 64px}', /ancestor padding along/],
];
for (const [a, n, css, re] of CEIL_PACKS) { const r = LINT[a](css, n); A(`dd260:${a}:${n}`, `rejected (${re})`, !r.ok && r.errors.some((e) => re.test(e.why)), r.ok ? 'ACCEPTED' : why(r).slice(0, 160)); }
for (const [a, n, css] of [['studio', 'main + body padding 12px a side (48 px more than the default 24, 72 px in all), within the budget', '[data-part="studio-main"]{padding:0 12px}[data-part="studio-body"]{padding:0 12px}'], ['chat', 'a roomy header and gaps inside the ceilings', ':root{--header-height:64px;--message-gap:32px;--composer-field-height:72px}'], ['home', 'card padding 24px', '[data-part="home-story"]{padding:24px}']]) { const r = LINT[a](css, n); A(`dd260-ok:${a}:${n}`, 'accepted', r.ok, why(r)); }
{ const { dd256 } = await import('./dd256.mjs'); dd256(A, LINT, REG, here, why); }  // DD-256: the sheet-height rule per area, its calibration against rendered pages and its engine

// ================= 5. benign fixtures
sec('5 benign');
for (const [n, css] of HOME_BENIGN) { const r = LINT.home(css, n); A('benign-home:' + n.slice(0, 3), n.slice(4), r.ok, why(r)); }
for (const a of Object.keys(LINT)) for (const [n, css] of [...NEW_BENIGN.all, ...(NEW_BENIGN[a] || [])]) { const r = LINT[a](css, n); A(`benign-new:${a}:${n}`, n, r.ok, why(r)); }
{ // the area files' own benign lists
  const ch = await imp('chat/checks/th/packlint-hostile.mjs');
  for (const [n, css] of [...ch.BENIGN, ...ch.BENIGN_2]) { const r = LINT.chat(css, n); A('benign-chat:' + n.slice(0, 4), n, r.ok, why(r)); }
  const sv = await imp('chat/checks/th/packlint-values.mjs');
  for (const [k, [css]] of Object.entries(sv.ACCEPT)) { const r = REG.chat.lintPack(css, k, sv.SETTINGS_REGISTRY); A('benign-settings-values:' + k, k, r.ok, why(r)); }
  const idx = fs.readFileSync(path.join(DESIGN, 'settings/checks/th/fixtures/index-right.css'), 'utf8'); const ri = LINT.settings(idx, 'index-right'); A('benign-settings:index-right', 'the index on the right through role tokens', ri.ok, why(ri));
  const st = REG.st; const mins = ':root{' + Object.entries(st.STUDIO_MINIMUMS).map(([k, v]) => `${k}:${v}`).join(';') + '}', maxs = ':root{' + Object.entries(st.STUDIO_MAXIMUMS).map(([k, v]) => `${k}:${v}`).join(';') + '}';
  const sheetToks = /^--studio-(space-5|font-xl|font-base|size-touch-lg|space-3)$/; const maxsNoSheet = ':root{' + Object.entries(st.STUDIO_MAXIMUMS).filter(([k]) => !sheetToks.test(k)).map(([k, v]) => `${k}:${v}`).join(';') + '}';
  for (const [n, css] of [['every floor value together', mins], ['every ceiling value together except the sheet geometry', maxsNoSheet], ['a compact form', ':root{--studio-font-md:12px;--studio-font-base:13px;--studio-space-3:6px;--studio-form-row-height:36px;--studio-form-risky-edge-width:3px;--studio-form-risky-tint-alpha:0.07}']]) { const r = LINT.studio(css, n); A('benign-studio:' + n, n, r.ok, why(r)); }
}

// ================= 6. legacy suites of the areas (hostile lists written for DD-149/155/161/182/195)
sec('6 legacy');
{
  const ch = await imp('chat/checks/th/packlint-hostile.mjs');
  const miss = [...ch.HOSTILE, ...ch.HOSTILE_3, ...ch.HOSTILE_2.filter(([n]) => !ch.BORDERLINE_OK.includes(n))].filter(([, css]) => LINT.chat(css, '').ok).map(([n]) => n);
  A('legacy-chat:hostile', `chat's ${ch.HOSTILE.length + ch.HOSTILE_3.length + ch.HOSTILE_2.length - ch.BORDERLINE_OK.length} hostile rules are still rejected`, miss.length === 0, miss.join(', '));
  const sv = await imp('chat/checks/th/packlint-values.mjs');
  const missS = Object.entries(sv.REJECT).filter(([k, [css]]) => REG.chat.lintPack(css, k, sv.SETTINGS_REGISTRY).ok).map(([k]) => k);
  A('legacy-settings:values', `Settings' ${Object.keys(sv.REJECT).length} value-space fixtures are still rejected`, missS.length === 0, missS.join(', '));
  const dir = path.join(DESIGN, 'settings/checks/th/fixtures'); const bad = [];
  for (const f of ['backdrop-hidden', 'backdrop-top', 'cancel-hidden', 'footer-row-reverse', 'retry-hidden', 'row-hidden', 'toast-faded']) if (LINT.settings(fs.readFileSync(path.join(dir, f + '.css'), 'utf8'), f).ok) bad.push(f);
  A('legacy-settings:fixtures', 'the seven Settings negative fixture files are still rejected', bad.length === 0, bad.join(', '));
}

// ================= 7. single-token fuzz (the Studio review's method: ONE token at :root, extreme value, lint)
sec('7 fuzz');
const kind = (v, isCol) => (isCol ? 'col' : /^[\d. ]+$/.test(v) && v.trim().split(/\s+/).length === 3 ? 'chan' : /^-?[\d.]+(px|rem|em|vh|vw|%)?$/.test(v) ? (/^-?[\d.]+$/.test(v) ? 'num' : 'len') : /\d(ms|s)$/.test(v) ? 'dur' : 'other');
const VALS = { col: ['transparent', 'rgb(0 0 0 / 0)', 'color-mix(in srgb, red, blue)', 'oklch(0.5 0.1 200)', 'light-dark(#000, #fff)', 'currentcolor', 'var(--nope)'], chan: ['0 0 0', '255 255 255', '1 2'], num: ['0', '100'], len: ['0px', '1px', '3000px'], dur: ['0ms', '5000ms'], other: [] };
const UNRES = new Set(['color-mix(in srgb, red, blue)', 'oklch(0.5 0.1 200)', 'light-dark(#000, #fff)', 'currentcolor', 'var(--nope)', '1 2']);
const FUZZ = {
  chat: { tokens: REG.chat.lintPack ? await (async () => { const m = await imp('chat/checks/th/packlint.mjs'); return m.CHAT_REGISTRY.app; })() : new Map(), reg: undefined },
  settings: { tokens: (await imp('settings/checks/th/packlint-settings.mjs')).SETTINGS_TOKENS, reg: { ...REG.s5b.REG5B, settable: [...REG.sbase.SETTINGS_SETTABLE], reach: REG.sbase.SETTINGS_REACH, opaque: REG.sbase.SETTINGS_REGISTRY.opaque, colours: REG.sbase.SETTINGS_REGISTRY.colours, pairs: REG.sbase.SETTINGS_PAIRS } },
  studio: { tokens: REG.st.STUDIO_TOKENS, reg: REG.st.STUDIO_REGISTRY },
  home: { tokens: REG.home.HOME_TOKENS, reg: REG.home.HOME_REGISTRY },
};
const fuzzSummary = {};
for (const [area, { tokens, reg }] of Object.entries(FUZZ)) {
  let tested = 0, passed = 0, notSettable = 0, otherRej = 0; const badPass = [], settablePass = new Set(), colPass = [];
  for (const [n, v] of tokens) {
    if (!n.startsWith('--')) continue;
    const isCol = /-rgb$/.test(n) ? false : (() => { try { return !!REG.chat.lintPack && /^(#|rgba?\(|hsla?\(|transparent$)/i.test(v.trim()); } catch { return false; } })();
    const k = /-rgb$/.test(n) && /^[\d. ]+$/.test(v) ? 'chan' : kind(v, isCol);
    for (const x of VALS[k]) {
      tested++; const r = reg === undefined ? REG.chat.lintPack(`:root{${n}:${x}}`, 'f') : area === 'studio' ? REG.st.lintPack(`:root{${n}:${x}}`, 'f') : area === 'home' ? REG.home.lintHome(`:root{${n}:${x}}`, 'f') : REG.sbase.lintPack(`:root{${n}:${x}}`, 'f', reg);
      const settable = REG.chat.isPackSettable(n, reg);
      if (r.ok) { passed++; settablePass.add(n); if (!settable) badPass.push(`${n}=${x}`); if (UNRES.has(x) && (k === 'col' || k === 'chan')) colPass.push(`${n}=${x}`); }
      else if (r.errors.some((e) => /not a pack-settable/.test(e.why))) notSettable++; else otherRej++;
      if (!r.ok && !settable && !r.errors.some((e) => /not a pack-settable/.test(e.why))) badPass.push(`${n}=${x} (rejected, but not for settability)`);
    }
  }
  fuzzSummary[area] = { tested, passed, notSettable, otherRej, settablePassTokens: settablePass.size, passingTokens: [...settablePass] };
  A(`fuzz:${area}:closed`, `no token outside the pack-settable list is ever accepted (${tested} single-token packs: ${passed} pass, ${notSettable} refused as not settable, ${otherRej} refused by a bound or a colour rule)`, badPass.length === 0, badPass.slice(0, 5).join('; '));
  A(`fuzz:${area}:colours`, 'no colour or channel token accepts an unresolvable colour (color-mix, oklch, light-dark, currentcolor, unresolved var, two-number channel)', colPass.length === 0, colPass.slice(0, 5).join('; '));
}

// ================= 8. shared tokens (theme/nexus-tokens.css)
sec('8 shared tokens');
{
  const css = read('theme/nexus-tokens.css'); const g = (n) => (new RegExp('(' + n + ')\\s*:\\s*([^;]+);').exec(css) || [])[2];
  A('tokens:field-border', 'DD-236: --nexus-field-border is 36%', /0\.36/.test(g('--nexus-field-border') || ''), g('--nexus-field-border'));
  for (const n of ['--nexus-warm-rgb', '--nexus-success-rgb', '--nexus-touch', '--nexus-focus-ring-width', '--nexus-focus-ring-offset']) A('tokens:' + n, `DD-235: ${n} is defined`, !!g(n), g(n));
  for (const n of ['--nexus-warm-rgb', '--nexus-success-rgb', '--nexus-touch', '--nexus-focus-ring-width', '--nexus-focus-ring-offset']) { const r = LINT.chat(`:root{${n}:${n.endsWith('rgb') ? '10 20 30' : n.includes('touch') ? '40px' : '3px'}}`, n); A('tokens-settable:' + n, `${n} is pack-settable`, r.ok, why(r)); }
}

// ================= report
const pass = rows.filter((r) => r.ok).length, fail = rows.length - pass;
const bySec = {}; for (const r of rows) { (bySec[r.section] ||= { pass: 0, fail: 0 })[r.ok ? 'pass' : 'fail']++; }
const lines = [`Theme lint regression suite, ${new Date().toISOString()}`, `TOTAL ${pass}/${rows.length} pass, ${fail} fail`, ...Object.entries(bySec).map(([s, c]) => `  ${s}: ${c.pass} pass, ${c.fail} fail`),
  `studio review packs: ${sh.length} (x2 for bare / on Navy): ${sRej} rejections, ${sRight} for the right reason, ${sAcc.length} accepted by decision (${[...new Set(sAcc)].join(' ')})`,
  `home review packs: ${hh.length}: ${hRej} rejected, ${hRight} for the right reason (${hViaHelper.length} only after listing their helper variables: ${hViaHelper.join(' ')}), ${HOME_DECIDED_ACCEPT.size} accepted by decision (H52)`,
  `new packs: ${nRej} rejections, ${nRight} for the right reason`, `fuzz: ${JSON.stringify(fuzzSummary)}`,
  `shipped: ${Object.entries(shipped).map(([k, r]) => k + '=' + (r.ok ? 'ACCEPT' : 'NEEDS FIX')).join(', ')}`];
console.log(lines.join('\n'));
fs.writeFileSync(path.join(here, 'results.log'), lines.join('\n') + '\n' + rows.filter((r) => !r.ok).map((r) => `FAIL [${r.section}] ${r.id}: ${r.detail}`).join('\n') + '\n');
fs.writeFileSync(path.join(here, 'results.json'), JSON.stringify({ pass, total: rows.length, fail, bySec, fuzz: fuzzSummary, shipped: Object.fromEntries(Object.entries(shipped).map(([k, r]) => [k, r.ok ? 'accept' : reasons(r).slice(0, 8)])), rows }, null, 1));
process.exit(fail ? 1 : 0);
