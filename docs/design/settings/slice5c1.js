/* Settings slice 5c-1 mockup: 화면·읽기 (display) and 입력·접근성 (input), the DD-250 all-modes-hidden repair state, and the DD-223 undo wording of every Settings toast (the helper itself is slice2.js psToast / untilLine).
   Synthetic mockup; not proof of native behaviour or performance. Standalone (no network, no dependencies): nothing here reads or writes the real app's storage; the permission prompt, the file picker and Home's mode storage are simulated.
   Loaded after slice5b.js and BEFORE slice1.js: it wraps the window.SS1_EXT hooks slices 2 to 5b registered (slice1.js reads them at start-up) and receives slice 1's API in X.boot.
   Implements settings/SLICE5C1_SPEC.md revision 1. Store-first (DS-067): the settings are rows of slice 1's catalogue (data5c1.js) and the compound ones (visible modes, colours, background, sidebar items) are the SS5C1_DATA.ST store; every page reads them by id at render time.
   The only drafts are a colour or quote box being typed in, an open dialog and the collapsed 고급 group.
   Floor devices (Note 9 / Android 10 WebView, Raspberry Pi 3): no optional chaining, nullish coalescing, .at(), replaceAll or structuredClone; checks/ss5c1/modes.mjs scans for them.
   Sections: helpers, icons, undo, rows, modes, theme and colours, chat display, sound, motion, input, sub-pages, key reveal, events, hooks, states, public API. */
(() => {
'use strict';
const X = window.SS1_EXT;
const D = window.SS1_DATA, DC = window.SS5C1_DATA;
const Q = new URLSearchParams(location.search);
let A = null, B = null;
const { K, ST, SCHEMES, COLOR_KEYS, TEXT_KEYS, BG_FILES, POSITIONS, STUDIO_MOVED, MODES } = DC;
const CFG = { undoMs: 10000 };
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ic = (n, s, c) => A.ic(n, s, c);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KO = () => A.S.lang === 'ko';
const pick = (ko, en) => (KO() ? ko : (en === undefined || en === '' ? ko : en));
const P = { sub: '', retRow: '', listScroll: {}, open: { adv: false }, missing: [], writes: 0, booted: false, defer: false, noNav: false, went: '', hl: '', pickSel: '' };
const t5 = (k, ...a) => { const v = K[A.S.lang][k]; if (v === undefined) { P.missing.push(k); return '⟦' + k + '⟧'; } return typeof v === 'function' ? v(...a) : v; };
const R = (id) => A.ROW[id];
const rv = (id) => A.ROW[id].v;
const lab = (r) => A.L(r);
const mine = (r) => !!r && r.p5c === true;
const unavail = (r) => window.__ss1.unavail(r);
const isTouch = () => DC.isTouch() || !(window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const joinNames = (l) => (KO() ? l.join('·') : l.length < 2 ? l.join('') : l.slice(0, -1).join(', ') + ' and ' + l[l.length - 1]);

/* ------------------------------------------------------------------ icons (Lucide paths, inline; copied, not imported). Only the ones no earlier slice defined are added in boot. */
const ICONS5C = {
  'eye': '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
  'eye-off': '<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/>',
  'bell': '<path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/>',
  'bell-off': '<path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M17 17H4a1 1 0 0 1-.74-1.673C4.59 13.956 6 12.499 6 8a6 6 0 0 1 .258-1.742"/><path d="m2 2 20 20"/><path d="M8.668 3.01A6 6 0 0 1 18 8c0 2.687.77 4.653 1.707 6.05"/>',
  'vibrate': '<path d="m2 8 2 2-2 2 2 2-2 2"/><path d="m22 8-2 2 2 2-2 2 2 2"/><rect width="8" height="14" x="8" y="5" rx="1"/>',
  'code-xml': '<path d="m18 16 4-4-4-4"/><path d="m6 8-4 4 4 4"/><path d="m14.5 4-5 16"/>',
  'upload': '<path d="M12 3v12"/><path d="m17 8-5-5-5 5"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>',
  'external-link': '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  'lock': '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  'circle-alert': '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>',
  'download': '<path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/>',
  'palette': null,
};

/* ------------------------------------------------------------------ small helpers */
function announce(msg) { A.announce(msg); }
function toast(msg, o) { B.psToast(msg, o || {}); }
function pushLU(label, undo, kind, data) { return B.pushLU(label, undo, kind, data); }
function toastUndo(msg, entry, o) { toast(msg, Object.assign({ action: { label: t5('undo'), title: t5('undo') + ' (Alt+Z)', fn: () => B.runLU(entry.id) }, until: 'page' }, o || {})); }   // DD-223: the helper in slice2.js adds the line that says how long Undo lasts
const inMine = () => A.S.open && A.S.view === 'page' && (A.S.page === 'display' || A.S.page === 'input');
const pageOfSub = (k) => (k === 'sidebar-items' ? 'input' : 'display');
function repaint(focusFk) {   // re-render the page keeping scroll; the focused control is found again by its data-fk
  if (!A.S.open) return; const a = document.activeElement; const fk = focusFk || (a && a.getAttribute ? a.getAttribute('data-fk') : '');
  if (P.defer) { setTimeout(() => repaint(fk), 0); return; }
  A.refreshPage(); const sc = $('#pageScroll');
  if (fk && sc) { const e = $(`[data-fk="${CSS.escape(fk)}"]`, sc); if (e) e.focus({ preventScroll: true }); }
}
function focusFk(fk) { const e = fk && $(`#pageScroll [data-fk="${CSS.escape(fk)}"]`); if (e) { e.focus({ preventScroll: true }); return true; } return false; }
function ask(o) {   // a confirm: title, body html, ok label, danger?; a dialog with a danger button is critical, one that only changes what is shown is not
  const d = A.openDialog({ critical: !!o.danger, title: o.title, body: o.body, buttons: [{ id: 'cancel', label: t5('cancel') }, { id: 'ok', label: o.ok, danger: !!o.danger, primary: !o.danger }], initial: '[data-dlg="cancel"]', onClose: o.onClose });
  A.openDialog.handlers = { ok: () => { setTimeout(o.onOk, 0); } }; return d;
}
function revealNote(r) {   // a search hit on a row that is not available now: slice 1's explanation, with the way to the switch
  const un = unavail(r); if (!un) return ''; const sw = un.goto ? R(un.goto) : null;
  return `<div class="row unavail-note" data-row="${esc(r.id)}" data-row-kind="unavailable" data-part="settings-row" role="group" aria-labelledby="l-${esc(r.id)}" tabindex="-1">${ic('triangle-alert', 'lg')}<div class="un-body"><p data-part="settings-row-label" class="r-label" id="l-${esc(r.id)}">${esc(lab(r))}</p><p data-part="settings-row-description" class="r-desc">${esc(un.text)}</p>` +
    (sw ? `<button type="button" data-part="settings-button" class="btn solid un-go" data-goto="${esc(un.goto)}" data-ctl><span>${esc(A.t('goToSwitch', lab(sw)))}</span>${ic('chevron-right', 'md')}</button>` : '') + '</div></div>';
}
function goRow(target, ret) { const r = R(target); if (!r) return; A.openRow(r, { fromJump: true, fromSearch: false }); A.S.retRow = ret && R(ret) ? ret : null; }
const studioUrl = (s) => A.studioHref('character', 'ch1', s.kind);   // Studio's owner and kind (SLICE1_SPEC of Studio, section 1): the character, the Screen / lorebook kind
function go(url) { P.went = url; if (!P.noNav) location.assign(url); }

/* ------------------------------------------------------------------ rows: the catalogue rows slice 1 renders, with this slice's decorations (a mark, named steps, a reason line) */
const newTag = () => `<span class="chip p5c-new" data-part="settings-new-tag" title="${esc(t5('newTagTitle'))}">${esc(t5('newTag'))}</span>`;
const stepNameOf = (r) => t5('stepName', r.v);
function reasonLine(domId, text, extra) { return `<p class="p5b-reason" id="${esc(domId)}" data-part="settings-dim-reason" data-part-critical>${ic('circle-alert', 'sm')}<span class="p5b-rt">${esc(text)}</span>${extra || ''}</p>`; }
function dimShell(h, r, reason, extra) {   // DS-096: a dimmed row is read-only and says why (explain-only); its reset menu goes
  h = h.replace(/<button[^>]*class="btn r-more[^>]*>[\s\S]*?<\/button>/, '').replace(/^<div class="row/, '<div class="row p5b-dimrow');
  return h.replace(/<\/div>$/, reasonLine('dr-' + r.id, reason, extra) + '</div>');
}
const dimify = (h, r, reason, extra) => dimShell(h.replace(/<input (type="(?:checkbox|range)")/, `<input disabled aria-describedby="dr-${esc(r.id)}" $1`), r, reason, extra);
function rowP(r, o) {
  o = o || {}; let h = A.rowHTML(r);
  if (r.steps) { const nm = stepNameOf(r); h = h.replace(/aria-valuetext="[^"]*"/, `aria-valuetext="${esc(nm)}"`).replace(/(<output[^>]*>)[^<]*(<\/output>)/, `$1${esc(nm)}$2`); }
  if (r.isNew) h = h.replace('</label>', '</label>' + newTag());
  if (o.dim) h = dimify(h, r, o.dim, o.extra);
  return h;
}
const secOpen = (id, title, cls) => `<section class="sec${cls ? ' ' + cls : ''}" id="sec-${id}" data-sec="${id}" data-part="settings-section" aria-labelledby="h-${id}"><h2 class="sec-h" id="h-${id}" data-part="settings-section-title" tabindex="-1">${esc(title)}</h2>`;
const secBody = (items) => `<div class="rows" data-part="settings-rows">${items.join('')}</div>`;
const noteLine = (cls, icon, text) => `<p class="p5b-note ${cls || ''}" data-part="settings-note">${ic(icon || 'info', 'sm')}<span>${esc(text)}</span></p>`;
const h3 = (text) => `<h3 class="p5b-h3 p5c-h3">${esc(text)}</h3>`;
function rowsOf(ids, o, extra) {   // the rows of the list that are available now; a row that is not (a dependent row) is not in the DOM; a search hit on one shows slice 1's explanation instead
  const out = [];
  ids.forEach((id) => { const r = R(id); const un = unavail(r); if (un) { if (o && o.reveal === id) out.push(revealNote(r)); return; } out.push(extra && extra[id] ? extra[id](r) : rowP(r)); });
  return out;
}
function headHTML(pid, extra) {
  const Pg = A.PAGE[pid]; let h = `<div class="pg p5c p5c-${pid}" data-page="${pid}" data-part="settings-page-body"><div class="pg-head" data-part="settings-page-header"><h1 class="pg-title" id="pgTitle" tabindex="-1">${esc(A.L(Pg))}</h1>`;
  if (A.S.notice) h += `<p class="banner warn" data-part="settings-warning-banner" data-part-critical role="status">${ic('info', 'lg')}<span>${esc(A.S.notice)}</span></p>`;
  return h + (extra || '') + '</div>';
}
function chipsHTML(pid) {
  const secs = D.SECTIONS.filter((s) => s.page === pid && A.L(s));
  return `<nav class="chips" data-part="settings-jump-chips" aria-label="${esc(A.t('sectionNav'))}">${secs.map((s) => `<button type="button" class="chip-b" data-secjump="${esc(s.id)}">${esc(A.L(s))}</button>`).join('')}</nav>`;
}
const stitle = (id) => A.L(A.SEC[id]);

/* ------------------------------------------------------------------ 모드 (DD-250, DS-155, DS-156): the visible set, the hide-unused flag, the repair */
const has = (m) => ST.modes.visible.indexOf(m) >= 0;
const effModes = () => (ST.modes.hideUnused ? MODES.filter(has) : MODES.slice());
const mname = (m) => t5('modeName', m);
function lockOf(m) { const M = ST.modes; if (!M.hideUnused) return 'off'; if (M.home && M.home === m) return 'home'; if (has(m) && M.visible.length === 1) return 'last'; return ''; }   // DS-170: with hiding off every box is checked and locked; the remembered set returns when it goes on
const lockText = (lock) => t5(lock === 'home' ? 'mdLockHome' : lock === 'last' ? 'mdLockLast' : 'mdLockOff');
function statusText() {
  const eff = effModes();
  if (eff.length === 3) return t5('mdStatusAll');
  return t5('mdStatusSome', eff.length, joinNames(eff.map(mname)));
}
const MODE_ROW = { rp: 'display.modeRp', hybrid: 'display.modeHybrid', utility: 'display.modeUtility' };
function modeOptHTML(m) {
  const lock = lockOf(m); const on = lock === 'off' ? true : has(m); const id = 'md-' + m;
  return `<div class="p5c-mopt${on ? ' cur' : ''}" data-part="settings-mode-option" data-part-critical data-row="${MODE_ROW[m]}" data-mode="${m}"${lock ? ` data-lock="${lock}"` : ''}><label class="p5c-mlab"><input type="checkbox" class="p5c-chk" data-p5c="mode" data-mode="${m}" data-fk="md:${m}" data-ctl${on ? ' checked' : ''}${lock ? ' aria-disabled="true"' : ''} aria-describedby="${id}-d${lock ? ' ' + id + '-r' : ''}"><span class="p5c-mb"><span class="p5c-mn">${esc(mname(m))}</span><span class="p5c-md" id="${id}-d">${esc(t5('modeDesc', m))}</span></span></label>` +
    (lock ? reasonLine(id + '-r', lockText(lock)) : '') + '</div>';
}
function bannerHTML() {
  const eff = effModes();
  return `<p class="banner warn p5c-mbanner" data-part="settings-mode-banner" data-part-critical role="status">${ic('triangle-alert', 'lg')}<span class="p5c-mbt"><strong>${esc(t5('mdBanner', joinNames(eff.map(mname))))}</strong><span>${esc(t5('mdBannerSub'))}</span></span></p>`;
}
function modesSecHTML(o) {
  const all = effModes().length === 3;
  const items = [
    `<p class="p5b-note p5c-mnote" data-part="settings-note">${ic('info', 'sm')}<span>${esc(t5('mdNote'))}</span></p>`,
    `<fieldset class="p5c-modes" data-part="settings-mode-group"><legend class="p5b-leg">${esc(t5('mdLegend'))}</legend>${MODES.map(modeOptHTML).join('')}</fieldset>`,
    rowsOf(['display.hideUnused'], o)[0] || '',
    `<div class="p5c-macts" data-row="display.showAllModes"><button type="button" class="btn solid accent p5c-showall" data-part="settings-mode-showall" data-part-critical data-ctl data-p5c="showall" data-fk="md:showall"${all ? ' aria-disabled="true" aria-describedby="dr-showall"' : ''}>${ic('eye', 'lg')}<span>${esc(t5('mdShowAll'))}</span></button>${all ? reasonLine('dr-showall', t5('mdAlready')) : ''}</div>`,
    `<p class="p5c-mstatus" id="p5c-mstatus" data-part="settings-mode-status" data-part-critical role="status" aria-live="polite">${ic('check', 'sm')}<span>${esc(statusText())}</span></p>`,
  ];
  return secOpen('display.modes', stitle('display.modes')) + secBody(items.filter(Boolean)) + '</section>';
}
function toggleMode(m, on) {
  const M = ST.modes; const lk = lockOf(m); if (lk && (!on || lk === 'off')) { announce(lockText(lk)); repaint('md:' + m); return; }
  const from = M.visible.slice(); const v = M.visible.filter((x) => x !== m); if (on) v.push(m); M.visible = MODES.filter((x) => v.indexOf(x) >= 0);
  pushLU(t5('luModes'), () => { M.visible = from.slice(); return ''; }, 'p5c-modes'); P.writes++;
  A.buildIndex(); repaint('md:' + m); announce(t5('mdToggled', mname(m), on) + '. ' + statusText());
}
function showAllAsk() {
  const eff = effModes(); const hidden = MODES.filter((m) => eff.indexOf(m) < 0); const names = joinNames((hidden.length ? hidden : MODES).map(mname));
  ask({ critical: false, title: t5('mdConfirmT'), body: `<p class="p5c-dbody">${esc(t5('mdConfirmBody', names))}</p>`, ok: t5('mdConfirmDo'), onClose: () => { focusFk('md:showall'); }, onOk: doShowAll });
}
function doShowAll() {
  const M = ST.modes; const snap = { visible: M.visible.slice(), hide: M.hideUnused, repair: M.repair };
  M.visible = MODES.slice(); M.hideUnused = false; M.repair = false; P.writes++;
  const e = pushLU(t5('luShowAll'), () => { M.visible = snap.visible; M.hideUnused = snap.hide; M.repair = snap.repair; return ''; }, 'p5c-modes');
  A.buildIndex(); repaint('md:showall'); toastUndo(t5('mdDone'), e, { sub: t5('mdDoneSub') }); announce(t5('mdDone') + '. ' + statusText());
}

/* ------------------------------------------------------------------ 테마와 색 */
const THEME_IDS = ['', 'waifu', 'mobilechat', 'cardboard', 'customHTML'];
function thumbHTML(v) {
  const inner = v === 'customHTML' ? ic('code-xml', '2xl') : '<i></i><i></i><i></i>';
  return `<span class="p5c-thumb p5c-th-${v || 'std'}" data-part="settings-theme-thumb" aria-hidden="true">${inner}</span>`;
}
function themeCardsHTML() {
  const r = R('display.theme'); const cur = r.v;
  return `<fieldset class="p5c-choices p5c-themes" data-part="settings-theme-list" data-row="display.theme"><legend class="p5b-leg">${esc(t5('thLegend'))}</legend><div class="p5c-grid">` + THEME_IDS.map((v) => {
    const on = v === cur; const did = 'td-' + (v || 'std');
    return `<label class="p5c-tcard${on ? ' cur' : ''}" data-part="settings-theme-card" data-v="${esc(v)}">${thumbHTML(v)}<span class="p5c-trow"><input type="radio" class="p5c-rad" name="display.theme" value="${esc(v)}" data-p5c="radio" data-rowid="display.theme" data-fk="rd:display.theme:${esc(v)}"${on ? ' checked data-ctl' : ''} aria-describedby="${did}"><span class="p5c-tn">${esc(A.optLabel(r, v))}</span></span><span class="p5c-td" id="${did}">${esc(t5('thDesc', v))}</span></label>`;
  }).join('') + '</div></fieldset>';
}
function schemeArt(c4) { return `<svg class="p5c-swart" data-part="settings-swatch-art" viewBox="0 0 2 2" aria-hidden="true" focusable="false"><rect x="0" y="0" width="1" height="1" fill="${c4[0]}"/><rect x="1" y="0" width="1" height="1" fill="${c4[1]}"/><rect x="0" y="1" width="1" height="1" fill="${c4[2]}"/><rect x="1" y="1" width="1" height="1" fill="${c4[3]}"/></svg>`; }
function swatchesHTML() {
  const r = R('display.colorScheme'); const cur = r.v; const C = ST.colors;
  const one = (id, name, c4) => { const on = id === cur; return `<label class="p5c-sw${on ? ' cur' : ''}" data-part="settings-swatch" data-v="${esc(id)}">${schemeArt(c4)}<span class="p5c-srow"><input type="radio" class="p5c-rad p5c-swrad" name="display.colorScheme" value="${esc(id)}" data-p5c="radio" data-rowid="display.colorScheme" data-fk="rd:display.colorScheme:${esc(id)}"${on ? ' checked data-ctl' : ''}><span class="p5c-swn">${esc(name)}</span></span></label>`; };
  return `<fieldset class="p5c-choices p5c-swatches" data-part="settings-swatch-list" data-row="display.colorScheme"><legend class="p5b-leg">${esc(t5('scLegend'))}</legend><div class="p5c-sgrid">` +
    SCHEMES.map((s) => one(s[0], pick(s[1], s[2]), [s[3], s[4], s[5], s[6]])).join('') + one('custom', t5('scCustom'), [C.bgcolor, C.darkbg, C.borderc, C.selected]) + '</div></fieldset>';
}
const HEX = /^#[0-9a-fA-F]{6}$/;
function cfieldHTML(grp, key, label, value) {
  const id = `cf-${grp}-${key}`;
  return `<div class="p5c-cfield" data-part="settings-color-field" data-grp="${grp}" data-key="${key}"><label class="p5c-clab" for="${id}">${esc(label)}</label><input type="color" class="p5c-cpick" id="${id}" value="${esc(value)}" data-p5c="color" data-grp="${grp}" data-key="${key}" data-fk="cf:${grp}:${key}:c"><input type="text" class="inp p5c-hex" data-part="settings-field" value="${esc(value)}" maxlength="7" spellcheck="false" autocomplete="off" data-p5c="hex" data-grp="${grp}" data-key="${key}" data-fk="cf:${grp}:${key}:h" aria-label="${esc(t5('hexOf', label))}"></div>`;
}
const fileKb = (f) => t5('bgSize', f.kb);
function bgRowHTML() {
  const r = R('display.background'); const f = ST.bg; const on = !!f;
  const file = on ? `<div class="p5c-bgfile" data-part="settings-bg-file" data-state="${f.type === 'gif' ? 'gif' : 'image'}">${ic('image', 'lg')}<span class="p5c-bgtxt"><span class="p5c-bgname">${esc(f.name)}</span><span class="p5c-bgsize">${esc(t5('bgSize', f.kb))}</span></span><span class="p5c-bgacts"><button type="button" class="btn solid" data-part="settings-button" data-p5c="bg-change" data-fk="bg:change">${ic('upload', 'md')}<span>${esc(t5('bgChange'))}</span></button><button type="button" class="btn solid" data-part="settings-button" data-p5c="bg-clear" data-fk="bg:clear">${ic('trash-2', 'md')}<span>${esc(t5('bgClear'))}</span></button></span></div>` + (f.type === 'gif' ? noteLine('p5c-gifnote', 'triangle-alert', t5('bgGif')) : '') : '';
  return `<div class="row type-switch p5c-bgrow" data-row="display.background" data-type="switch" data-part="settings-toggle-row" role="group" aria-labelledby="l-display.background" aria-describedby="d-display.background"><span class="dot" aria-hidden="true" hidden></span><div class="r-main"><div class="r-text"><div class="r-title"><span class="r-lw"><label data-part="settings-row-label" class="r-label" id="l-display.background" for="c-display.background">${esc(lab(r))}</label></span></div><p data-part="settings-row-description" class="r-desc" id="d-display.background">${esc(A.pair(r.desc))}</p></div><div data-part="settings-row-control" class="r-ctl"><span class="sw" data-part="settings-toggle"><input type="checkbox" role="switch" id="c-display.background" data-ctl data-p5c="bg-toggle" data-fk="bg:toggle"${on ? ' checked' : ''}><span class="sw-ui" aria-hidden="true"></span></span></div></div>${file}</div>`;
}
function optColorRowHTML(id, key) {   // textScreenColor / textScreenBorder: one switch, and the colour only while it is on
  const r = R(id); const on = ST.screenOn[key]; const did = 'd-' + id;
  return `<div class="row type-switch p5c-orow" data-row="${id}" data-type="switch" data-part="settings-toggle-row" role="group" aria-labelledby="l-${id}" aria-describedby="${did}"><span class="dot" aria-hidden="true" hidden></span><div class="r-main"><div class="r-text"><div class="r-title"><span class="r-lw"><label data-part="settings-row-label" class="r-label" id="l-${id}" for="c-${id}">${esc(lab(r))}</label></span></div><p data-part="settings-row-description" class="r-desc" id="${did}">${esc(A.pair(r.desc))}</p></div><div data-part="settings-row-control" class="r-ctl"><span class="sw" data-part="settings-toggle"><input type="checkbox" role="switch" id="c-${id}" data-ctl data-p5c="screen-toggle" data-key="${key}" data-fk="sc:${key}:t"${on ? ' checked' : ''}><span class="sw-ui" aria-hidden="true"></span></span></div></div>${on ? cfieldHTML('screen', key, lab(r), ST.screen[key]) : ''}</div>`;
}
function previewHTML() {
  const sc = ST.screenOn.color ? ST.screen.color : '', bd = ST.screenOn.border ? ST.screen.border : '';
  const round = rv('display.textScreenRounded'), ol = rv('display.textBorder');
  return `<div class="p5c-pv" id="p5c-pv" data-part="settings-preview" role="img" aria-label="${esc(t5('pvLabel') + ': ' + t5('pvText'))}"><svg class="p5c-pvsvg" viewBox="0 0 200 64" aria-hidden="true" focusable="false"><rect class="p5c-pvscreen" x="3" y="3" width="194" height="58" rx="${round ? 14 : 0}"${sc ? ` fill="${sc}"` : ''}${bd ? ` stroke="${bd}" stroke-width="3"` : ''}/><text class="p5c-pvtext${ol ? ' ol' : ''}" x="14" y="38">${esc(t5('pvText'))}</text></svg><span class="p5c-pvcap">${esc(t5('pvLabel'))}</span></div>`;
}
function paintPreview() { const el = $('#p5c-pv'); if (!el) return; const tmp = document.createElement('div'); tmp.innerHTML = previewHTML(); el.replaceWith(tmp.firstElementChild); }
function themeSecHTML(o) {
  const items = [themeCardsHTML()].concat(rowsOf(['display.waifuWidth', 'display.waifuSize', 'display.guiHtml'], o));
  items.push(swatchesHTML()); items.push(...rowsOf(['display.customColors'], o));
  items.push(...rowsOf(['display.textTheme', 'display.customTextTheme'], o));
  items.push(bgRowHTML());
  items.push(h3(t5('chatScreen')), optColorRowHTML('display.textScreenColor', 'color'), optColorRowHTML('display.textScreenBorder', 'border'), ...rowsOf(['display.textScreenRounded', 'display.textBorder'], o), previewHTML());
  return secOpen('display.theme', stitle('display.theme')) + secBody(items) + '</section>';
}

/* ------------------------------------------------------------------ 글꼴과 크기, 채팅 표시, 소리와 알림 */
function fontSecHTML(o) {
  const items = rowsOf(['display.font', 'display.customFont', 'display.zoom', 'display.lineHeight', 'display.iconSize', 'display.textAreaSize', 'display.textAreaText', 'display.sidebarSize', 'display.assetWidth', 'display.assetRem'], o);
  if (A.S.lay === 'phone') items.push(noteLine('', 'info', t5('closeOnlyWide'))); else items.push(...rowsOf(['display.settingsCloseSize'], o));
  return secOpen('display.font', stitle('display.font')) + secBody(items) + '</section>';
}
function quoteBoxesHTML() {
  const q = ST.quotes; const L = ['qOpenD', 'qCloseD', 'qOpenS', 'qCloseS'];
  return `<div class="p5c-qboxes" data-part="settings-quote-boxes" role="group" aria-labelledby="p5c-qlegend"><p class="p5c-qlegend" id="p5c-qlegend">${esc(t5('qLegend'))}</p><div class="p5c-qgrid">` +
    L.map((k, i) => `<label class="p5c-qlab" for="p5c-q${i}"><span>${esc(t5(k))}</span><input type="text" class="inp p5c-q" data-part="settings-field" id="p5c-q${i}" value="${esc(q[i])}" maxlength="4" spellcheck="false" autocomplete="off" data-p5c="quote" data-i="${i}" data-fk="q:${i}"></label>`).join('') +
    `</div><p class="p5c-qprev" id="p5c-qprev" data-part="settings-preview" aria-live="polite"><span class="p5c-qpl">${esc(t5('qPrev'))}</span> <span class="p5c-qps">${esc(t5('qSample', q[0], q[1], q[2], q[3]))}</span></p><p class="p5b-note" data-part="settings-note">${ic('info', 'sm')}<span>${esc(t5('qOne'))}</span></p></div>`;
}
function paintQuotePreview() { const e = $('#p5c-qprev .p5c-qps'); if (e) e.textContent = t5('qSample', ST.quotes[0], ST.quotes[1], ST.quotes[2], ST.quotes[3]); }
function chatSecHTML(o) {
  const q = rowsOf(['display.quoteStyle'], o).concat(rowsOf(['display.blockquote'], o, rv('display.quoteStyle') ? null : { 'display.blockquote': (r) => rowP(r, { dim: t5('bqReason'), extra: `<button type="button" class="btn p5b-lnk" data-part="settings-button" data-p5c="goto" data-target="display.quoteStyle" data-ret="display.blockquote" data-fk="go:quotes">${ic('chevron-right', 'md')}<span>${esc(t5('bqGo'))}</span></button>` }) }));
  const cq = rowsOf(['display.customQuotes'], o); if (rv('display.customQuotes') && cq.length) cq.push(quoteBoxesHTML());
  const swipeOff = rv('input.swipe') === false;
  const fp = rowsOf(['display.firstPages'], o, swipeOff ? { 'display.firstPages': (r) => rowP(r, { dim: t5('fpReason'), extra: `<button type="button" class="btn p5b-lnk" data-part="settings-button" data-p5c="goto" data-target="input.swipe" data-ret="display.firstPages" data-fk="go:swipe">${ic('chevron-right', 'md')}<span>${esc(t5('fpGo'))}</span></button>` }) } : null);
  const rest = rowsOf(['display.copyBtn', 'display.savingIcon', 'display.roundIcons', 'display.folderName', 'display.hideImages', 'display.hideRealm'], o);
  return secOpen('display.chat', stitle('display.chat')) + secBody([...q, ...cq, ...fp, ...rest]) + '</section>';
}
function notifyText() {
  if (ST.nmsg === 'dismissed') return t5('nsDismissed'); if (ST.nmsg) return t5('nsOffByDeny');
  return t5({ granted: 'nsGranted', denied: 'nsDenied', default: 'nsDefault', unsupported: 'nsUnsupported' }[ST.perm]);
}
function notifyRowHTML() {
  const r = R('display.notification'); const on = ST.notify; const dis = ST.perm === 'unsupported' || ST.perm === 'denied';
  const icon = ST.perm === 'granted' ? 'bell' : ST.perm === 'default' ? 'bell' : 'bell-off';
  return `<div class="row type-switch p5c-nrow" data-row="display.notification" data-type="switch" data-part="settings-toggle-row" role="group" aria-labelledby="l-display.notification" aria-describedby="d-display.notification p5c-nstat"><span class="dot" aria-hidden="true" hidden></span><div class="r-main"><div class="r-text"><div class="r-title"><span class="r-lw"><label data-part="settings-row-label" class="r-label" id="l-display.notification" for="c-display.notification">${esc(lab(r))}</label></span></div><p data-part="settings-row-description" class="r-desc" id="d-display.notification">${esc(A.pair(r.desc))}</p></div><div data-part="settings-row-control" class="r-ctl"><span class="sw" data-part="settings-toggle"><input type="checkbox" role="switch" id="c-display.notification" data-ctl data-p5c="notify" data-fk="nt:switch"${on ? ' checked' : ''}${dis ? ' aria-disabled="true"' : ''}><span class="sw-ui" aria-hidden="true"></span></span></div></div>` +
    `<p class="p5c-nstatus" id="p5c-nstat" data-part="settings-notify-status" data-part-critical data-state="${ST.nmsg === 'denied' ? 'denied' : ST.perm}" role="status" aria-live="polite">${ic(icon, 'sm')}<span>${esc(notifyText())}</span></p></div>`;
}
function notifyToggle(on) {
  ST.nmsg = '';
  if (!on) { ST.notify = false; repaint('nt:switch'); announce(t5('nsOff')); return; }
  if (ST.perm === 'unsupported') { ST.notify = false; repaint('nt:switch'); announce(t5('nsUnsupported')); return; }
  if (ST.perm === 'granted') { ST.notify = true; repaint('nt:switch'); announce(t5('nsOn')); return; }
  if (ST.perm === 'denied') { ST.notify = false; ST.nmsg = 'denied'; repaint('nt:switch'); announce(t5('nsOffByDeny')); return; }   // the app asks again; the browser answers "denied" at once and the switch turns itself off
  const d = A.openDialog({ critical: false, title: t5('nsAsk'), body: `<p class="p5c-dbody">${esc(t5('nsAskBody'))}</p>`, buttons: [{ id: 'block', label: t5('nsBlock') }, { id: 'allow', label: t5('nsAllow'), primary: true }], initial: '[data-dlg="block"]', onClose: (why) => {
    if (why === 'allow') { ST.perm = 'granted'; ST.notify = true; announce(t5('nsOn')); } else if (why === 'block') { ST.perm = 'denied'; ST.notify = false; ST.nmsg = 'denied'; announce(t5('nsOffByDeny')); } else { ST.notify = false; ST.nmsg = 'dismissed'; announce(t5('nsDismissed')); }   // Escape or a click outside closes the prompt: the permission stays "not asked"
    repaint('nt:switch'); } });
  A.openDialog.handlers = {}; void d;
}
function soundSecHTML(o) {
  const items = rowsOf(['display.playMessage', 'display.playTranslate'], o); if (R('display.notification') && !unavail(R('display.notification'))) items.push(notifyRowHTML());
  return secOpen('display.sound', stitle('display.sound')) + secBody(items) + '</section>';
}

/* ------------------------------------------------------------------ 움직임과 성능 (DS-157, DS-162) */
const durOf = (pos) => Math.round((1 - pos / 20) * 100) / 100;
const posOf = (d) => Math.round((1 - d) * 20);
const animText = (d) => t5('asText', t5('asName', d), d);
const animDimmed = () => (A.S.lp ? 'lp' : A.S.rm ? (R('display.reducedMotion').v === 'system' ? 'sys' : 'rm') : '');
function animControl(dim) {
  const d = R('display.animSpeed').v; const txt = animText(d);
  return `<div class="sl p5c-animctl" data-part="settings-anim-speed" role="group" aria-labelledby="l-display.animSpeed"${dim ? ' aria-disabled="true"' : ''}><span class="p5c-end" aria-hidden="true">${esc(t5('asSlow'))}</span><input type="range" id="c-display.animSpeed" data-ctl data-p5c="anim" data-fk="an:speed" min="0" max="20" step="1" value="${posOf(d)}" aria-label="${esc(t5('asAria'))}" aria-valuetext="${esc(txt)}"${dim ? ' disabled aria-describedby="dr-display.animSpeed"' : ''}><span class="p5c-end" aria-hidden="true">${esc(t5('asFast'))}</span><output for="c-display.animSpeed" class="p5c-anout">${esc(txt)}</output></div>`;
}
function animRowHTML() {
  const dim = animDimmed(); const r = R('display.animSpeed'); let h = A.rowHTML(r);
  h = h.replace(/<div class="sl">[\s\S]*?<\/output><\/div>/, animControl(dim));
  return dim ? dimShell(h, r, t5(dim === 'lp' ? 'asDimLp' : dim === 'sys' ? 'asDimSys' : 'asDimRm')) : h;
}
function paintAnim() { const row = $('#pageScroll [data-row="display.animSpeed"]'); if (!row) return; const had = row.contains(document.activeElement); const tmp = document.createElement('div'); tmp.innerHTML = animRowHTML(); row.replaceWith(tmp.firstElementChild); if (had) focusFk('an:speed'); }
function applyMine() {   // slice 1's applyFlags reads "animSpeed || 0.4", which turns an instant 0 back into 0.4; this puts the real number back (the fast end of the slider is instant)
  document.documentElement.style.setProperty('--risu-animation-speed', String(R('display.animSpeed').v / 0.4));
}
function motionSecHTML(o) {
  const items = rowsOf(['display.lowPower', 'display.reducedMotion'], o);
  const an = R('display.animSpeed'); if (!unavail(an)) items.push(animRowHTML());
  const hp = rowsOf(['display.haptics'], o); if (hp.length) items.push(...hp); else if (!isTouch()) items.push(noteLine('', 'vibrate', t5('hapticsDesktop')));
  return secOpen('display.lowpower', stitle('display.lowpower')) + secBody(items) + '</section>';
}
function advSecHTML(o) {
  const items = rowsOf(['display.customCss', 'display.betaMobileGui', 'display.fullScreen', 'display.sticker'], o);
  return secOpen('display.advanced', stitle('display.advanced')) + `<details class="p5b-details" id="p5c-adv" data-part="settings-disclosure"${P.open.adv ? ' open' : ''}><summary class="p5b-sum" data-fk="adv:sum">${esc(['display.customCss', 'display.betaMobileGui', 'display.fullScreen', 'display.sticker'].filter((id) => !unavail(R(id))).map((id) => lab(R(id))).join(' · '))}</summary>${secBody(items)}</details></section>`;
}
function displayHTML(o) {
  if (P.sub === 'custom-colors' || P.sub === 'custom-text') { const h = P.sub === 'custom-colors' ? colorsEditorHTML() : textEditorHTML(); if (h) return h; P.sub = ''; }
  const eff = effModes();
  return headHTML('display', ST.modes.repair && eff.length < 3 ? bannerHTML() : '') + chipsHTML('display') + modesSecHTML(o) + themeSecHTML(o) + fontSecHTML(o) + chatSecHTML(o) + soundSecHTML(o) + motionSecHTML(o) + advSecHTML(o) + '</div>';
}

/* ------------------------------------------------------------------ 입력·접근성 */
function posArt(v) {
  const body = '<rect class="p5c-phbody" x="1.5" y="1.5" width="37" height="61" rx="6" stroke-width="2"/>';
  const dots = { 'bottom-center': '<rect class="p5c-dot" x="12" y="50" width="16" height="6" rx="3"/>', 'bottom-right': '<rect class="p5c-dot" x="22" y="50" width="14" height="6" rx="3"/>', 'bottom-left': '<rect class="p5c-dot" x="4" y="50" width="14" height="6" rx="3"/>', 'floating-circle': '<circle class="p5c-dot" cx="30" cy="44" r="5"/>', 'right-center': '<circle class="p5c-dot" cx="33" cy="32" r="4"/>', 'top-bar': '<rect class="p5c-dot" x="7" y="7" width="26" height="5" rx="2.5"/>' };
  return `<svg class="p5c-phone" viewBox="0 0 40 64" aria-hidden="true" focusable="false">${body}${dots[v]}</svg>`;
}
function positionPickerHTML() {
  const r = R('input.newMsgButton'); const cur = r.v;
  return `<fieldset class="p5c-choices p5c-pos" data-part="settings-position-picker" data-row="input.newMsgButton"><legend class="p5b-leg">${esc(t5('npLegend'))}</legend><div class="p5c-pgrid">` + POSITIONS.map((v) => {
    const on = v === cur; return `<label class="p5c-popt${on ? ' cur' : ''}" data-part="settings-position-option" data-v="${v}">${posArt(v)}<span class="p5c-prow"><input type="radio" class="p5c-rad" name="input.newMsgButton" value="${v}" data-p5c="radio" data-rowid="input.newMsgButton" data-fk="rd:input.newMsgButton:${v}"${on ? ' checked data-ctl' : ''}><span class="p5c-pn">${esc(t5('posName', v))}</span></span></label>`;
  }).join('') + `</div><p class="p5b-note" data-part="settings-note">${ic('info', 'sm')}<span>${esc(t5('npNote'))}</span></p></fieldset>`;
}
function sidebarRowHTML() {
  const r = R('input.customSidebar');
  return `<div class="row row-link p5c-sbrow" data-row="input.customSidebar" data-row-kind="nav" data-part="settings-row"><button type="button" class="rl" data-ctl data-p5c="open-sidebar" data-fk="sb:open"><span class="r-text"><span data-part="settings-row-label" class="r-label">${esc(lab(r))}</span><span data-part="settings-row-description" class="r-desc">${esc(A.pair(r.desc))}</span></span><span class="rl-end"><span class="rl-txt">${esc(t5('sbCount', ST.sidebar.length))}</span>${ic('chevron-right', 'lg')}</span></button></div>`;
}
function inputHTML(o) {
  if (P.sub === 'sidebar-items') { const h = sidebarItemsHTML(); if (h) return h; P.sub = ''; }
  const touchOnly = isTouch();
  const sec = (id, items) => secOpen(id, stitle(id)) + secBody(items) + '</section>';
  const send = sec('input.send', [...rowsOf(['input.sendWithEnter', 'input.fixedInput'], o), h3(t5('inputMenuH')), ...rowsOf(['input.menuChatList', 'input.menuHypa', 'input.menuReroll'], o)]);
  const edit = sec('input.edit', rowsOf(['input.clickEdit', 'input.longPressEdit', 'input.dragEdit', 'input.blockEdit'], o, touchOnly ? { 'input.blockEdit': (r) => rowP(r, { dim: t5('hoverOnly') }) } : null));
  const scrollRows = rowsOf(['input.autoScroll', 'input.alwaysScroll'], o); const np = R('input.newMsgButton');
  if (!unavail(np)) scrollRows.push(positionPickerHTML()); else if (o && o.reveal === np.id) scrollRows.push(revealNote(np));
  if (!rv('input.autoScroll')) scrollRows.push(noteLine('p5c-scrollnote', 'info', t5('scrollNoteOff'))); else if (rv('input.alwaysScroll')) scrollRows.push(noteLine('p5c-scrollnote', 'info', t5('scrollNoteAlways')));   // N-6: say why the button position is not there
  const scroll = sec('input.scroll', scrollRows);
  const gest = sec('input.gestures', rowsOf(['input.swipe', 'input.edgeSwipe', 'input.menuBottom', 'input.hapticsLink'], o));
  const menu = sec('input.menu', [...rowsOf(['input.menuSidebar', 'input.botAtStart'], o), sidebarRowHTML(), ...rowsOf(['input.proTools', 'input.reduceTransparency'], o)]);
  const conf = [...rowsOf(['input.askRemoval'], o)];
  conf.push(rowP(R('input.instantRemove')));
  conf.push(...rowsOf(['input.branchFolder', 'input.inlayError', 'input.showTransLoading'], o));
  const easy = sec('input.a11y', [noteLine('', 'info', t5('easyNote')), ...rowsOf(['input.easyContrast', 'input.easySize', 'input.easyInput'], o)]);
  return headHTML('input') + chipsHTML('input') + send + edit + scroll + gest + menu + sec('input.confirm', conf) + easy + '</div>';
}

/* ------------------------------------------------------------------ sub-pages (a drill-in with Back): your colours, your text colours, the sidebar items */
function subHead(kind, title, note) { return `<div class="pg p5c p5c-sub" data-page="${pageOfSub(kind)}" data-view="${kind}" data-part="settings-page-body"><div class="pg-head" data-part="settings-page-header"><h1 class="pg-title" id="pgTitle" tabindex="-1">${esc(title)}</h1>${note ? `<p class="p5c-subnote">${esc(note)}</p>` : ''}</div>`; }
function colorsPreview() {
  const C = ST.colors;
  return `<div class="p5c-cprev" id="p5c-cprev" data-part="settings-preview" role="img" aria-label="${esc(t5('edColorsT'))}"><svg class="p5c-cpsvg" viewBox="0 0 160 64" aria-hidden="true" focusable="false"><rect x="0" y="0" width="80" height="32" fill="${C.bgcolor}"/><rect x="80" y="0" width="80" height="32" fill="${C.darkbg}"/><rect x="0" y="32" width="80" height="32" fill="${C.borderc}"/><rect x="80" y="32" width="80" height="32" fill="${C.selected}"/><text x="8" y="22" font-size="14" fill="${C.textcolor}">Aa</text><text x="88" y="22" font-size="14" fill="${C.textcolor2}">Aa</text><text x="88" y="54" font-size="14" fill="${C.draculared}">Aa</text></svg></div>`;
}
const COLOR_LABEL = { bgcolor: 'ckBg', darkbg: 'ckDarkbg', borderc: 'ckBorderc', selected: 'ckSelected', draculared: 'ckDraculared', textcolor: 'ckTextcolor', textcolor2: 'ckTextcolor2', darkBorderc: 'ckDarkBorderc', darkbutton: 'ckDarkbutton' };
function colorsEditorHTML() {
  const C = ST.colors;
  const type = `<fieldset class="p5c-typef"><legend class="p5b-leg">${esc(t5('edType'))}</legend>` + ['dark', 'light'].map((v) => `<label class="p5c-tlab${C.type === v ? ' cur' : ''}"><input type="radio" class="p5c-rad" name="cc-type" value="${v}" data-p5c="ctype" data-fk="ct:${v}"${C.type === v ? ' checked' : ''}><span>${esc(t5(v === 'dark' ? 'edDark' : 'edLight'))}</span></label>`).join('') + '</fieldset>';
  const files = `<div class="p5c-cfiles"><button type="button" class="btn solid" data-part="settings-button" data-p5c="ce-export" data-fk="ce:export">${ic('download', 'md')}<span>${esc(t5('ceExport'))}</span></button><button type="button" class="btn solid" data-part="settings-button" data-p5c="ce-import" data-fk="ce:import">${ic('upload', 'md')}<span>${esc(t5('ceImport'))}</span></button></div>`;
  return subHead('custom-colors', t5('edColorsT'), t5('edColorsNote')) + `<section class="sec" id="sec-display.customColors" data-sec="display.customColors" data-part="settings-section" aria-label="${esc(t5('edColorsT'))}"><div class="rows" data-part="settings-rows">${files}${type}${colorsPreview()}<div class="p5c-clist">` + COLOR_KEYS.map((k) => cfieldHTML('colors', k, t5(COLOR_LABEL[k]), C[k])).join('') + '</div></div></section></div>';
}
function textPreview() {
  const T = ST.textColors; const s = t5('edTextSample');
  return `<div class="p5c-tprev" id="p5c-tprev" data-part="settings-preview" role="img" aria-label="${esc(t5('edTextPrev'))}"><svg class="p5c-tpsvg" viewBox="0 0 240 90" aria-hidden="true" focusable="false"><text x="8" y="16" font-size="13" fill="${T.FontColorStandard}">${esc(s[0])}</text><text x="8" y="32" font-size="13" font-style="italic" fill="${T.FontColorItalic}">${esc(s[1])}</text><text x="8" y="48" font-size="13" font-weight="700" fill="${T.FontColorBold}">${esc(s[2])}</text><text x="8" y="64" font-size="13" font-weight="700" font-style="italic" fill="${T.FontColorItalicBold}">${esc(s[3])}</text><text x="8" y="80" font-size="13" fill="${T.FontColorQuote1}">${esc(s[4])}</text><text x="128" y="80" font-size="13" fill="${T.FontColorQuote2}">${esc(s[5])}</text></svg></div>`;
}
function textEditorHTML() {
  const T = ST.textColors;
  return subHead('custom-text', t5('edTextT'), t5('edTextNote')) + `<section class="sec" id="sec-display.customTextTheme" data-sec="display.customTextTheme" data-part="settings-section" aria-label="${esc(t5('edTextT'))}"><div class="rows" data-part="settings-rows">${textPreview()}<div class="p5c-clist">` + TEXT_KEYS.map((k) => cfieldHTML('text', k, t5('tk' + k), T[k])).join('') + '</div></div></section></div>';
}
const itemName = (it) => pick(it.ko, it.en);
const itemKind = (it) => t5('sbTypes')[it.type] || it.type;
function sidebarItemsHTML() {
  const list = ST.sidebar.length ? `<ul class="p5c-slist" data-part="settings-sidebar-list" role="list" aria-label="${esc(t5('sbT'))}">` + ST.sidebar.map((it) => `<li class="p5c-sitem" data-part="settings-sidebar-item" data-id="${esc(it.id)}"><span class="p5c-sico" aria-hidden="true">${ic(it.type === 'setting' ? 'sliders-horizontal' : it.type === 'persona' ? 'user-round' : it.type === 'model' ? 'cpu' : 'bookmark', 'lg')}</span><span class="p5c-sname">${esc(itemName(it))}</span><span class="chip p5c-skind">${esc(itemKind(it))}</span><button type="button" class="btn" data-part="settings-button" data-p5c="sb-remove" data-id="${esc(it.id)}" data-fk="sb:rm:${esc(it.id)}" aria-label="${esc(t5('sbRemoveOf', itemName(it)))}" title="${esc(t5('sbRemove'))}">${ic('trash-2', 'lg')}</button></li>`).join('') + '</ul>' : noteLine('p5c-empty', 'info', t5('sbEmpty'));
  return subHead('sidebar-items', t5('sbT'), t5('sbNote')) + `<section class="sec" id="sec-input.customSidebar" data-sec="input.customSidebar" data-part="settings-section" aria-label="${esc(t5('sbT'))}"><div class="rows" data-part="settings-rows">${list}<div class="p5c-sbadd"><button type="button" class="btn solid" data-part="settings-button" data-p5c="sb-add" data-fk="sb:add">${ic('plus', 'md')}<span>${esc(t5('sbAdd'))}</span></button></div></div></section></div>`;
}
function sbRemove(id) {
  const i = ST.sidebar.findIndex((x) => x.id === id); if (i < 0) return; const it = ST.sidebar.splice(i, 1)[0]; P.writes++;
  const e = pushLU(t5('sbLu'), () => { if (!ST.sidebar.some((x) => x.id === id)) ST.sidebar.splice(Math.min(i, ST.sidebar.length), 0, it); return ''; }, 'p5c-sidebar');
  const nx = ST.sidebar[i] || ST.sidebar[i - 1]; repaint(nx ? 'sb:rm:' + nx.id : 'sb:add'); toastUndo(t5('sbRemoved'), e, { sub: itemName(it) }); announce(t5('sbRemoved') + ' ' + itemName(it));
}
function sbAddDialog() {
  let step = 'type'; let q = ''; let type = '';
  const types = ['model', 'preset', 'loadout', 'persona', 'setting'];
  const body = () => {
    if (step === 'type') return `<p class="dlg-hint">${esc(t5('sbTypeFirst'))}</p><div class="p5c-stypes" role="group" aria-label="${esc(t5('sbAddT'))}">${types.map((v) => `<button type="button" class="btn solid" data-part="settings-button" data-sbtype="${v}">${esc(t5('sbTypes')[v])}</button>`).join('')}</div>`;
    return `<p class="dlg-hint">${esc(t5('sbSettingHint'))}</p><label class="dlg-l" for="p5c-sbq">${esc(t5('sbSettingQ'))}</label><input id="p5c-sbq" class="inp" data-part="settings-field" type="search" value="${esc(q)}" autocomplete="off" spellcheck="false" aria-controls="p5c-sbres"><ul class="p5c-sbres" id="p5c-sbres" role="list">${settingHits(q).map((r) => `<li><button type="button" class="btn" data-part="settings-button" data-sbset="${esc(r.id)}">${esc(lab(r))}</button></li>`).join('') || `<li class="p5c-sbno">${esc(t5('sbNoHit'))}</li>`}</ul><div class="p5c-sbback"><button type="button" class="btn" data-part="settings-button" data-sbback>${ic('arrow-left', 'md')}<span>${esc(t5('sbBack'))}</span></button></div>`;
  };
  const d = A.openDialog({ critical: false, title: t5('sbAddT'), body: body(), buttons: [{ id: 'cancel', label: t5('cancel') }], initial: '[data-sbtype]', onClose: () => { focusFk('sb:add'); } });
  A.openDialog.handlers = {};
  const add = (it) => {
    ST.sidebar.push(it); P.writes++; const e = pushLU(t5('sbAddedT'), () => { const k = ST.sidebar.indexOf(it); if (k >= 0) ST.sidebar.splice(k, 1); return ''; }, 'p5c-sidebar');
    d.close('ok'); setTimeout(() => { repaint('sb:add'); toastUndo(t5('sbAddedT'), e, { sub: itemName(it) }); announce(t5('sbAddedT') + ' ' + itemName(it)); }, 0);
  };
  const paint = () => { const b = $('.dlg-b', d.back); b.innerHTML = body(); const f = $(step === 'type' ? '[data-sbtype]' : '#p5c-sbq', d.back); if (f) f.focus(); };
  d.back.addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-sbtype]'); if (t) { type = t.dataset.sbtype; if (type === 'setting') { step = 'setting'; q = ''; paint(); } else { ST.sbSeq++; add({ id: 's' + ST.sbSeq, type, ko: K.ko.sbTypes[type], en: K.en.sbTypes[type] }); } return; }
    const s = ev.target.closest('[data-sbset]'); if (s) { const r = R(s.dataset.sbset); ST.sbSeq++; add({ id: 's' + ST.sbSeq, type: 'setting', ref: r.id, ko: r.ko, en: r.en }); return; }
    if (ev.target.closest('[data-sbback]')) { step = 'type'; paint(); }
  });
  d.back.addEventListener('input', (ev) => { if (ev.target.id === 'p5c-sbq') { q = ev.target.value; const ul = $('#p5c-sbres', d.back); ul.innerHTML = settingHits(q).map((r) => `<li><button type="button" class="btn" data-part="settings-button" data-sbset="${esc(r.id)}">${esc(lab(r))}</button></li>`).join('') || `<li class="p5c-sbno">${esc(t5('sbNoHit'))}</li>`; } });
  return d;
}
function settingHits(q) {   // any setting of the catalogue by its name (both languages) or its field name, six at most
  const w = A.normWord(q || ''); const out = []; if (!w) return D.rows.filter((r) => /^(input|display)\./.test(r.id) && (r.type === 'switch' || r.type === 'slider' || r.type === 'segmented' || r.type === 'select')).slice(0, 6);
  for (const r of D.rows) { if (out.length >= 6) break; if (r.type === 'note' || r.type === 'nav' || r.type === 'button' || r.type === 'link' || r.type === 'key') continue; if (A.normWord(r.ko).indexOf(w) >= 0 || A.normWord(r.en).indexOf(w) >= 0 || A.normWord(r.id).indexOf(w) >= 0) out.push(r); }
  return out;
}
function openSub(kind, retRow) {
  const sc = $('#pageScroll'); if (!P.sub && sc) P.listScroll[pageOfSub(kind)] = sc.scrollTop; P.retRow = retRow || '';
  P.sub = kind; A.showPage(pageOfSub(kind), { p5c: true, noRestore: true, noAnim: false, keepFocus: true, force: true });
  const h = $('#pgTitle'); if (h) h.focus({ preventScroll: true });
}
function subClose() {
  if (!P.sub) return; const page = pageOfSub(P.sub); const ret = P.retRow; P.sub = '';
  A.showPage(page, { p5c: true, noAnim: true, noRestore: true, keepFocus: true, force: true }); const sc = $('#pageScroll'); if (sc && P.listScroll[page] !== undefined) sc.scrollTop = P.listScroll[page];
  const f = ret && $(`#pageScroll [data-row="${CSS.escape(ret)}"] [data-ctl]`); if (f) f.focus({ preventScroll: true }); else { const h = $('#pgTitle'); if (h) h.focus({ preventScroll: true }); }
}
const subTitleOf = () => (P.sub === 'custom-colors' ? t5('edColorsT') : P.sub === 'custom-text' ? t5('edTextT') : P.sub === 'sidebar-items' ? t5('sbT') : '');

/* ------------------------------------------------------------------ the key reveal (DS-164): every key field has its own show button; the global switch is gone */
function revealButton(inp) {
  const lbl = (inp.getAttribute('aria-label') || '') || (inp.id && $(`label[for="${CSS.escape(inp.id)}"]`) ? $(`label[for="${CSS.escape(inp.id)}"]`).textContent : '') || '';
  const b = document.createElement('button'); b.type = 'button'; b.className = 'btn p5c-reveal'; b.setAttribute('data-part', 'settings-reveal'); b.setAttribute('data-p5c', 'reveal'); b.setAttribute('aria-pressed', 'false');
  b.setAttribute('aria-label', lbl ? t5('revOf', lbl.trim()) : t5('revShow')); b.title = t5('revShow'); b.innerHTML = ic('eye', 'lg'); return b;
}
function wireReveals() {
  $$('input[data-secret]:not([data-p5c-rev])').forEach((inp) => { inp.setAttribute('data-p5c-rev', '1'); inp.insertAdjacentElement('afterend', revealButton(inp)); });
}
function toggleReveal(b) {
  const inp = b.previousElementSibling; if (!inp || !inp.matches('input')) return; const show = inp.type === 'password'; inp.type = show ? 'text' : 'password';
  const lbl = (inp.getAttribute('aria-label') || '') || (inp.id && $(`label[for="${CSS.escape(inp.id)}"]`) ? $(`label[for="${CSS.escape(inp.id)}"]`).textContent : '') || '';
  b.setAttribute('aria-pressed', show ? 'true' : 'false'); b.setAttribute('aria-label', lbl ? t5(show ? 'revHideOf' : 'revOf', lbl.trim()) : t5(show ? 'revHide' : 'revShow')); b.title = t5(show ? 'revHide' : 'revShow'); b.innerHTML = ic(show ? 'eye-off' : 'eye', 'lg');
}

/* ------------------------------------------------------------------ reset (the ⋯ menu), side effects of a change, enhancing the rows slice 1 renders */
function openResetMenu(r, anchor) { A.showMenu([{ icon: 'rotate-ccw', label: A.t('resetToDefault'), disabled: !A.isChanged(r), fn: () => resetMine(r) }], anchor, null, anchor, A.t('moreOfRow', lab(r))); }
function resetMine(r) {
  const from = r.v; const to = r.d; r.v = to; P.writes++;
  if (r.id === 'display.lowPower') A.setLowPower(!!to);
  onMineChanged(r);
  const e = pushLU(t5('luReset', lab(r)), () => { if (r.v !== to) return t5('luSkip'); r.v = from; if (r.id === 'display.lowPower') A.setLowPower(!!from); onMineChanged(r); return ''; }, 'p5c-reset');
  repaint(); toastUndo(t5('resetDone', lab(r)), e); announce(t5('resetDone', lab(r)));
}
const REFRESH = new Set(['display.customQuotes', 'display.hideUnused', 'display.quoteStyle']);   // rows whose change adds or removes a block that is not a catalogue row (the quote boxes, the caution, the repair banner)
function onMineChanged(r) {
  P.writes++;
  if (r.id === 'display.reducedMotion' || r.id === 'display.lowPower' || r.id === 'display.animSpeed') { setTimeout(() => { applyMine(); paintAnim(); }, 0); }
  if (r.id === 'display.textScreenRounded' || r.id === 'display.textBorder') paintPreview();
}
let enhancing = false;
function enhance(root) {   // idempotent: runs after every render and after slice 1 re-renders one row on its own (reset, the low-power suggestion)
  const sc = root || $('#pageScroll'); if (!sc || enhancing) return; enhancing = true;
  try {
    $$('.row[data-row]', sc).forEach((row) => {
      const r = R(row.dataset.row); if (!mine(r)) return;
      if (r.steps) { const nm = stepNameOf(r); const o = $('output', row), s = $('input[type=range]', row); if (o && o.textContent !== nm) o.textContent = nm; if (s && s.getAttribute('aria-valuetext') !== nm) s.setAttribute('aria-valuetext', nm); }
      if (r.id === 'display.animSpeed' && !$('.p5c-animctl', row)) { const sl = $('.sl', row); if (sl) { const tmp = document.createElement('div'); tmp.innerHTML = animControl(animDimmed()); sl.replaceWith(tmp.firstElementChild); } }
      if (r.isNew && !$('.p5c-new', row)) { const lb = $('.r-label', row); if (lb) lb.insertAdjacentHTML('afterend', newTag()); }
    });
  } finally { enhancing = false; }
}

/* ------------------------------------------------------------------ events: the controls this slice draws itself (data-p5c); plain rows (switch, select, text, slider, segmented) are slice 1's */
function setChoice(rowId, v) {
  const r = R(rowId); if (!r || r.v === v) return; r.v = v; P.writes++; A.buildIndex();
  repaint('rd:' + rowId + ':' + v); announce(lab(r) + ': ' + A.optLabel(r, v));
}
function setColor(grp, key, hex) {
  if (grp === 'colors') ST.colors[key] = hex; else if (grp === 'text') ST.textColors[key] = hex; else ST.screen[key] = hex;
  P.writes++;
  if (grp === 'screen') paintPreview(); else if (grp === 'colors') { const e = $('#p5c-cprev'); if (e) { const tmp = document.createElement('div'); tmp.innerHTML = colorsPreview(); e.replaceWith(tmp.firstElementChild); } } else { const e = $('#p5c-tprev'); if (e) { const tmp = document.createElement('div'); tmp.innerHTML = textPreview(); e.replaceWith(tmp.firstElementChild); } }
}
function onHex(el, final) {
  const f = el.closest('.p5c-cfield'); const grp = el.dataset.grp, key = el.dataset.key; const pickEl = $('.p5c-cpick', f); let v = el.value.trim(); if (v && v.charAt(0) !== '#') v = '#' + v;
  let err = $('.p5b-err', f);
  if (HEX.test(v)) { el.removeAttribute('aria-invalid'); if (err) err.hidden = true; v = v.toLowerCase(); pickEl.value = v; setColor(grp, key, v); if (final) el.value = v; }
  else if (final) { const cur = grp === 'colors' ? ST.colors[key] : grp === 'text' ? ST.textColors[key] : ST.screen[key]; el.value = cur; el.removeAttribute('aria-invalid'); if (err) err.hidden = true; }
  else { el.setAttribute('aria-invalid', 'true'); if (!err) { err = document.createElement('p'); err.className = 'p5b-err'; err.setAttribute('role', 'alert'); f.appendChild(err); } err.hidden = false; err.textContent = t5('hexBad'); }
}
function bgPick(fromToggle) {
  P.pickSel = '';
  const body = () => `<p class="dlg-hint">${esc(t5('bgPickHint'))}</p><ul class="p5b-files" role="list">${BG_FILES.map((f) => `<li><label class="p5b-filel"><input type="radio" name="p5c-file" data-pf="${f.id}"${P.pickSel === f.id ? ' checked' : ''}><span>${esc(f.name)} · ${esc(fileKb(f))}</span></label></li>`).join('')}</ul><p class="p5b-fmsg" id="p5c-fmsg" role="alert" aria-live="assertive"></p>`;
  const d = A.openDialog({ critical: false, title: t5('bgPickT'), body: body(), buttons: [{ id: 'cancel', label: t5('cancel') }, { id: 'ok', label: t5('bgPickDo'), primary: true, disabled: true }], initial: '[data-pf]', onClose: () => { repaint('bg:toggle'); } });
  const paint = () => { const f = BG_FILES.find((x) => x.id === P.pickSel); const btn = $('[data-dlg="ok"]', d.back); const m = $('#p5c-fmsg', d.back); btn.setAttribute('aria-disabled', f && f.ok ? 'false' : 'true'); m.textContent = !f ? '' : f.ok ? t5('bgOkLine', f.name) : t5('bgBad'); m.className = 'p5b-fmsg' + (f && !f.ok ? ' bad' : ''); };
  d.back.addEventListener('change', (ev) => { const c = ev.target.closest('[data-pf]'); if (c) { P.pickSel = c.dataset.pf; paint(); } });
  A.openDialog.handlers = { ok: () => { const f = BG_FILES.find((x) => x.id === P.pickSel); if (!f || !f.ok) return false;
    setTimeout(() => { const old = ST.bg; ST.bg = { name: f.name, kb: f.kb, type: f.type }; P.writes++; const e = pushLU(t5('bgSet'), () => { ST.bg = old; return ''; }, 'p5c-bg'); repaint('bg:change'); toastUndo(t5('bgSet'), e, { sub: f.name }); announce(t5('bgSet') + ' ' + f.name); }, 0); } };
  void fromToggle; return d;
}
function bgClear() {
  const old = ST.bg; if (!old) return; ST.bg = null; P.writes++;
  const e = pushLU(t5('bgLu'), () => { if (!ST.bg) ST.bg = old; return ''; }, 'p5c-bg'); repaint('bg:toggle'); toastUndo(t5('bgCleared'), e, { sub: old.name }); announce(t5('bgCleared'));
}
function colorsExport() {
  const text = JSON.stringify({ type: ST.colors.type, colors: COLOR_KEYS.reduce((o, k) => { o[k] = ST.colors[k]; return o; }, {}) }, null, 1);
  try { const u = URL.createObjectURL(new Blob([text], { type: 'application/json' })); const a = document.createElement('a'); a.href = u; a.download = 'risu-colors.json'; a.hidden = true; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 1000); } catch (e) { /* ignore */ }
  toast(t5('ceExported'), { ms: 4000 }); announce(t5('ceExported'));
}
function colorsImport() {   // DS-174: simulated; a broken or foreign file is refused with a message
  let sel = '';
  const body = () => `<p class="dlg-hint">${esc(t5('ceImportHint'))}</p><ul class="p5b-files" role="list">${DC.COLOR_FILES.map((f) => `<li><label class="p5b-filel"><input type="radio" name="p5c-cfile" data-pf="${f.id}"${sel === f.id ? ' checked' : ''}><span>${esc(f.name)}</span></label></li>`).join('')}</ul><p class="p5b-fmsg" id="p5c-cfmsg" role="alert" aria-live="assertive"></p>`;
  const d = A.openDialog({ critical: false, title: t5('ceImportT'), body: body(), buttons: [{ id: 'cancel', label: t5('cancel') }, { id: 'ok', label: t5('ceImportDo'), primary: true, disabled: true }], initial: '[data-pf]', onClose: () => { focusFk('ce:import'); } });
  const paint = () => { const f = DC.COLOR_FILES.find((x) => x.id === sel); const btn = $('[data-dlg="ok"]', d.back); const m = $('#p5c-cfmsg', d.back); btn.setAttribute('aria-disabled', f && f.ok ? 'false' : 'true'); m.textContent = !f ? '' : f.ok ? t5('ceImportOk', f.name) : t5('ceImportBad'); m.className = 'p5b-fmsg' + (f && !f.ok ? ' bad' : ''); };
  d.back.addEventListener('change', (ev) => { const c0 = ev.target.closest('[data-pf]'); if (c0) { sel = c0.dataset.pf; paint(); } });
  A.openDialog.handlers = { ok: () => { const f = DC.COLOR_FILES.find((x) => x.id === sel); if (!f || !f.ok) return false;
    setTimeout(() => { const old = Object.assign({}, ST.colors); Object.assign(ST.colors, f.colors); P.writes++; const e = pushLU(t5('ceLu'), () => { Object.assign(ST.colors, old); return ''; }, 'p5c-colors'); repaint('ce:import'); toastUndo(t5('ceImported'), e, { sub: f.name }); announce(t5('ceImported')); }, 0); } };
  return d;
}
function onClick(ev) {
  const t = ev.target; if (!(t instanceof Element)) return; const sc = $('#pageScroll'); if (!sc.contains(t)) return;
  const more = t.closest('.r-more');
  if (more) { const row = more.closest('[data-row]'); const r = row && R(row.dataset.row); if (mine(r) && r.d !== undefined) { ev.preventDefault(); ev.stopPropagation(); openResetMenu(r, more); return; } }
  const act = t.closest('[data-act]');
  if (act && /^p5c-/.test(act.dataset.act)) { ev.preventDefault(); ev.stopPropagation(); const a = act.dataset.act; const row = act.closest('[data-row]'); if (a === 'p5c-open-colors') openSub('custom-colors', 'display.customColors'); else if (a === 'p5c-open-text') openSub('custom-text', 'display.customTextTheme'); else if (a === 'p5c-showall') showAllAsk(); else if (a === 'p5c-open-sidebar') openSub('sidebar-items', row ? row.dataset.row : 'input.customSidebar'); return; }
  const b = t.closest('[data-p5c]'); if (!b || !sc.contains(b)) return; const k = b.dataset.p5c;
  if (k === 'mode') { if (b.getAttribute('aria-disabled') === 'true') { ev.preventDefault(); ev.stopPropagation(); announce(lockText(lockOf(b.dataset.mode))); } return; }   // the live region only: a toast would replace a live Undo toast
  if (k === 'notify') { if (b.getAttribute('aria-disabled') === 'true') { ev.preventDefault(); ev.stopPropagation(); announce(notifyText()); } return; }
  if (k === 'radio' || k === 'ctype' || k === 'screen-toggle' || k === 'bg-toggle' || k === 'anim' || k === 'color' || k === 'hex' || k === 'quote') return;
  ev.preventDefault(); if (b.getAttribute('aria-disabled') === 'true') { ev.stopPropagation(); if (k === 'showall') announce(t5('mdAlready')); return; }
  ev.stopPropagation(); const d = b.dataset;
  switch (k) {
    case 'showall': showAllAsk(); break;
    case 'bg-change': bgPick(false); break;
    case 'bg-clear': bgClear(); break;
    case 'ce-export': colorsExport(); break;
    case 'ce-import': colorsImport(); break;
    case 'goto': goRow(d.target, d.ret); break;
    case 'open-sidebar': openSub('sidebar-items', 'input.customSidebar'); break;
    case 'sb-add': sbAddDialog(); break;
    case 'sb-remove': sbRemove(d.id); break;
    default: break;
  }
}
function onChange(ev) { P.defer = true; try { onChange0(ev); } finally { P.defer = false; } }
function onChange0(ev) {
  const el = ev.target; const sc = $('#pageScroll'); if (!(el instanceof Element) || !sc.contains(el)) return; const k = el.dataset ? el.dataset.p5c : '';
  if (!k) return; ev.stopPropagation();
  if (k === 'mode') { toggleMode(el.dataset.mode, el.checked); return; }
  if (k === 'radio') { setChoice(el.dataset.rowid, el.value); return; }
  if (k === 'ctype') { ST.colors.type = el.value; P.writes++; repaint('ct:' + el.value); return; }
  if (k === 'bg-toggle') { if (el.checked) bgPick(true); else bgClear(); return; }
  if (k === 'screen-toggle') { ST.screenOn[el.dataset.key] = el.checked; P.writes++; repaint('sc:' + el.dataset.key + ':t'); return; }
  if (k === 'notify') { notifyToggle(el.checked); return; }
  if (k === 'hex') { onHex(el, true); return; }
  if (k === 'color') { setColor(el.dataset.grp, el.dataset.key, el.value); const f = el.closest('.p5c-cfield'); $('.p5c-hex', f).value = el.value; return; }
  if (k === 'anim') { animSet(el); return; }
}
function animSet(el) {
  const d = durOf(+el.value); const r = R('display.animSpeed'); r.v = d; P.writes++; const txt = animText(d);
  el.setAttribute('aria-valuetext', txt); const o = $('.p5c-anout', el.closest('.row')); if (o) o.textContent = txt;
  const row = el.closest('.row'); const dot = $('.dot', row); const ch = A.isChanged(r); row.classList.toggle('changed', ch); if (dot) dot.hidden = !ch;
  applyMine();
}
function onInput(ev) {
  const el = ev.target; const sc = $('#pageScroll'); if (!(el instanceof Element) || !sc.contains(el)) return; const k = el.dataset ? el.dataset.p5c : '';
  if (k === 'hex') { ev.stopPropagation(); onHex(el, false); return; }
  if (k === 'color') { ev.stopPropagation(); setColor(el.dataset.grp, el.dataset.key, el.value); const f = el.closest('.p5c-cfield'); $('.p5c-hex', f).value = el.value; const er = $('.p5b-err', f); if (er) er.hidden = true; $('.p5c-hex', f).removeAttribute('aria-invalid'); return; }
  if (k === 'quote') { ev.stopPropagation(); ST.quotes[+el.dataset.i] = el.value; P.writes++; paintQuotePreview(); return; }
  if (k === 'anim') { ev.stopPropagation(); animSet(el); return; }
}
function onKeydown(ev) {
  const t = ev.target; const sc = $('#pageScroll'); if (!(t instanceof Element) || !sc.contains(t)) return;
  if (ev.key === 'Enter' && !ev.isComposing && ev.keyCode !== 229 && t.matches('input[type=radio][data-p5c]')) { ev.preventDefault(); if (!t.checked) t.click(); return; }
  if (ev.key === 'Enter' && t.matches('.p5c-hex')) { ev.preventDefault(); onHex(t, true); }
}
function bindPage5c() {
  const sc = $('#pageScroll');
  [['click', onClick], ['input', onInput], ['change', onChange], ['keydown', onKeydown]].forEach((p) => sc.addEventListener(p[0], p[1], true));
  sc.addEventListener('toggle', (ev) => { if (ev.target.id === 'p5c-adv') P.open.adv = ev.target.open; }, true);
  new MutationObserver(() => { enhance(); }).observe(sc, { childList: true, subtree: true });
  document.addEventListener('click', (ev) => { const b = ev.target instanceof Element ? ev.target.closest('.p5c-reveal') : null; if (b) { ev.preventDefault(); ev.stopPropagation(); toggleReveal(b); } }, true);
  let rafT = 0; new MutationObserver(() => { if (rafT) return; rafT = requestAnimationFrame(() => { rafT = 0; wireReveals(); }); }).observe(document.body, { childList: true, subtree: true });
  new MutationObserver(() => { applyMine(); if (A.S.open && $('#pageScroll [data-row="display.animSpeed"]') && (!!$('#pageScroll [data-row="display.animSpeed"] .p5b-reason') !== !!animDimmed())) paintAnim(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
}

/* ------------------------------------------------------------------ hooks called by slice1.js (wrapping slice 2's, 3's, 4's, 5a's and 5b's) */
const H = {};
['boot', 'pageHTML', 'rendered', 'nav', 'back', 'closing', 'backLabel', 'headerTitle', 'indexExtra', 'lang', 'title', 'demoPanel', 'afterInit', 'ready', 'rowChanged', 'sectionBody', 'action'].forEach((k) => { H[k] = X[k]; });
X.pageHTML = (pid, o) => {
  if (pid === 'display') return displayHTML(o || {});
  if (pid === 'input') return inputHTML(o || {});
  return H.pageHTML ? H.pageHTML(pid, o) : null;
};
X.sectionBody = (s, body, o) => {
  const r = H.sectionBody ? H.sectionBody(s, body, o) : undefined;
  if (s.id === 'models.presets') {   // DS-163: "프리셋 비교 보이기" sits next to the compare button
    const src = r != null ? r : body; const tmp = document.createElement('div'); tmp.innerHTML = src; const cmp = tmp.querySelector('[data-row="models.compare"]');
    const have = tmp.querySelector('[data-row="models.showCompare"]');
    if (cmp && have) { cmp.insertAdjacentElement('afterend', have); return tmp.innerHTML; }
    if (cmp) { cmp.insertAdjacentHTML('afterend', A.rowHTML(R('models.showCompare'))); return tmp.innerHTML; }
  }
  return r;
};
X.rowChanged = (r) => {
  if (H.rowChanged) H.rowChanged(r);
  if (!mine(r)) return;
  if (r.steps) { const row = $(`#pageScroll [data-row="${CSS.escape(r.id)}"]`); if (row) enhance(row.parentElement); }
  onMineChanged(r);
  if (REFRESH.has(r.id) && A.S.open) setTimeout(() => A.refreshPage(true), 0);
};
X.rendered = (pg) => { if (H.rendered) H.rendered(pg); enhance(); wireReveals(); };
X.nav = (pid, o) => {
  if (H.nav) H.nav(pid, o);
  if (!o.p5c) P.sub = '';
  const r = o.row; if ((r && r.sec === 'display.advanced') || o.section === 'display.advanced') P.open.adv = true;
};
X.back = () => {
  if (A.S.open && P.sub && !A.S.resume && inMine()) { subClose(); return true; }
  return H.back ? H.back() : false;
};
X.backLabel = () => {
  if (A.S.open && P.sub && inMine()) { return pageOfSub(P.sub) === 'input' ? { label: t5('backInput'), vis: t5('backInputS') } : { label: t5('backDisplay'), vis: t5('backDisplayS') }; }
  return H.backLabel ? H.backLabel() : null;
};
X.headerTitle = () => { if (A.S.open && P.sub && inMine()) { const t = subTitleOf(); if (t) return t; } return H.headerTitle ? H.headerTitle() : null; };
X.closing = () => { const r = H.closing ? H.closing() : true; if (r === false) return false; P.sub = ''; return true; };
X.lang = (l) => { if (H.lang) H.lang(l); document.title = K[l].title; };
X.title = (l) => K[l].title;
X.indexExtra = (mk, IDX) => {
  if (H.indexExtra) H.indexExtra(mk, IDX);
  STUDIO_MOVED.forEach((s) => IDX.push(mk('action', 'action:studio:' + s.id, 'external-link', K.ko.stLabel(s.ko), K.en.stLabel(s.en), s.syn, 'action:studio:' + s.id + ' ' + s.id, '스튜디오', 'Studio', K.ko.stGo, K.en.stGo, '', '', {})));   // DS-163: search-only, not a row
};
X.action = (id, opener) => {
  const m = /^action:studio:(\w+)$/.exec(id);
  if (m) { const s = STUDIO_MOVED.find((x) => x.id === m[1]); if (s) go(studioUrl(s)); return; }
  if (H.action) H.action(id, opener);
};
X.demoPanel = (p) => {
  if (H.demoPanel) H.demoPanel(p);
  const h = document.createElement('div'); h.className = 'ps-demo p5c-demo';
  const opt = (arr, cur, label) => arr.map((v) => `<option value="${v}"${v === cur ? ' selected' : ''}>${esc(label(v))}</option>`).join('');
  h.innerHTML = `<h3 class="d-h">${esc(t5('demo5c'))}</h3><label class="d-row"><span>${esc(t5('demoSet'))}</span><select id="d5cSet">${opt(DC.SETS, DC.SET5C, (v) => t5({ demo: 'setDemo', touch: 'setTouch', 'desktop-app': 'setDesktop', custom: 'setCustom', denied: 'setDenied' }[v]))}</select></label>` +
    `<label class="d-row"><span>${esc(t5('demoPerm'))}</span><select id="d5cPerm">${opt(DC.PERMS, ST.perm, (v) => t5({ granted: 'permGranted', default: 'permDefault', denied: 'permDenied', unsupported: 'permUnsupported' }[v]))}</select></label>` +
    `<label class="d-row"><span>${esc(t5('demoMode'))}</span><select id="d5cMode">${opt(MODES, DC.HOME || 'hybrid', mname)}</select></label>` +
    `<label class="d-row"><span>${esc(t5('demoFix'))}</span><span class="sw" data-part="settings-toggle"><input type="checkbox" role="switch" id="d5cFix"${DC.FIXTURE ? ' checked' : ''}><span class="sw-ui" aria-hidden="true"></span></span></label>` +
    `<label class="d-row"><span>${esc(t5('demoState'))}</span><select id="d5cState">${STATES5C.map((s) => `<option>${s}</option>`).join('')}</select></label><div class="d-btns"><button type="button" data-part="settings-button" class="btn solid" id="d5cGo"><span>${esc(t5('demoGo'))}</span></button></div>`;
  p.appendChild(h);
  const reload = (kv) => { const u = new URL(location.href); Object.keys(kv).forEach((k) => { if (kv[k] === '') u.searchParams.delete(k); else u.searchParams.set(k, kv[k]); }); location.href = u.toString(); };
  $('#d5cSet', h).onchange = (e) => reload({ set: e.target.value });
  $('#d5cPerm', h).onchange = (e) => { ST.perm = e.target.value; ST.nmsg = ''; if (ST.perm !== 'granted') ST.notify = false; if (A.S.open && inMine()) repaint(); };
  $('#d5cMode', h).onchange = (e) => { reload({ mode: e.target.value, from: 'home' }); };
  $('#d5cFix', h).onchange = (e) => { reload({ fixture: e.target.checked ? 'all-modes-hidden-repair' : '', page: 'display', from: e.target.checked ? 'home' : '' }); };
  $('#d5cGo', h).onclick = () => { runState5c($('#d5cState', h).value); };
};
X.afterInit = (o) => {
  const v = Q.get('view');
  if (v === 'custom-colors' || v === 'custom-text' || v === 'sidebar-items') {
    if (H.afterInit) H.afterInit({ page: o.page, section: o.section, q: o.q, row: o.row });   // the earlier hooks see the same call, without the view they do not know
    A.showPage(pageOfSub(v), { p5c: true, noAnim: true, keepFocus: true, force: true }); openSub(v, v === 'custom-colors' ? 'display.customColors' : v === 'custom-text' ? 'display.customTextTheme' : 'input.customSidebar'); return;
  }
  if (H.afterInit) H.afterInit(o);
};
X.ready = () => { if (H.ready) H.ready(); window.__ss5c1Ready = true; };
X.boot = (api) => {
  if (H.boot) H.boot(api);
  A = api; B = window.__ss2; document.title = K[A.S.lang].title;
  Object.keys(ICONS5C).forEach((n) => { if (ICONS5C[n] && !A.ICONS[n]) A.ICONS[n] = ICONS5C[n]; });
  DC.isPhone = () => A.S.lay === 'phone';
  P.booted = true; bindPage5c(); wireReveals(); applyMine(); window.__ss5c1 = API();
  const st = Q.get('state'); if (st && STATES5C.indexOf(st) >= 0) setTimeout(() => runState5c(st), 0);
};

/* ------------------------------------------------------------------ states (SLICE5C1_SPEC 8.3) */
const STATES5C = ['di-theme-waifu', 'di-theme-html', 'di-swatches', 'di-custom-colors', 'di-text-custom', 'di-bg-gif', 'di-asset-custom', 'di-quotes-on', 'di-notify-denied', 'di-motion-reduced', 'di-lowpower', 'di-advanced-open',
  'in-scroll-picker', 'in-scroll-hidden', 'in-instant-caution', 'in-sidebar-items', 'in-sidebar-undo', 'in-touch-hover',
  'mo-repair', 'mo-repair-confirm', 'mo-repair-done', 'mo-last-mode',
  'un-toast-page', 'un-toast-10s', 'un-toast-reason',
  'se-hideapikey', 'se-lorebook-moved', 'se-memlimit-none'];
function resetState() {
  try { B.hideToast(); } catch (e) { /* no toast yet */ }
  DC.reset(DC.SET5C, DC.FIXTURE, DC.HOME, DC.PERM_Q); P.sub = ''; P.open.adv = false; P.pickSel = '';
  R('display.reducedMotion').v = 'system'; R('display.animSpeed').v = R('display.animSpeed').d; A.setLowPower(Q.get('lowpower') === '1'); A.applyFlags(); applyMine();
}
async function until(f, ms) { const t0 = Date.now(); while (Date.now() - t0 < (ms || 4000)) { if (f()) return true; await sleep(15); } return false; }
async function runState5c(name) {
  window.__ss5c1Ready = false;
  const openS = (opt) => { if (!A.S.open) A.openSettings($('#oSettings'), Object.assign({ noFocus: true }, opt || {})); };
  resetState();
  const page = (pid, opt) => { openS({ page: pid }); P.sub = ''; A.showPage(pid, Object.assign({ noAnim: true, keepFocus: true, force: true }, opt || {})); };
  const toEl = (sel) => { const e = $(sel); if (e) e.scrollIntoView({ block: 'center' }); return e; };
  const settle = () => sleep(60);
  const q = Q.get('q');
  switch (name) {
    case 'di-theme-waifu': R('display.theme').v = 'waifu'; page('display', { section: 'display.theme' }); await settle(); toEl('[data-row="display.waifuWidth"]'); break;
    case 'di-theme-html': R('display.theme').v = 'customHTML'; R('display.guiHtml').v = ST.html; page('display', { section: 'display.theme' }); await settle(); toEl('[data-row="display.guiHtml"]'); break;
    case 'di-swatches': page('display', { section: 'display.theme' }); await settle(); toEl('.p5c-swatches'); break;
    case 'di-custom-colors': R('display.colorScheme').v = 'custom'; page('display'); await settle(); openSub('custom-colors', 'display.customColors'); break;
    case 'di-text-custom': R('display.textTheme').v = 'custom'; page('display'); await settle(); openSub('custom-text', 'display.customTextTheme'); break;
    case 'di-bg-gif': ST.bg = { name: 'rain-window.gif', kb: 3270, type: 'gif' }; page('display', { section: 'display.theme' }); await settle(); toEl('.p5c-bgrow'); break;
    case 'di-asset-custom': R('display.assetWidth').v = 'custom'; page('display', { section: 'display.font' }); await settle(); toEl('[data-row="display.assetRem"]'); break;
    case 'di-quotes-on': R('display.customQuotes').v = true; page('display', { section: 'display.chat' }); await settle(); toEl('.p5c-qboxes'); break;
    case 'di-notify-denied': ST.perm = 'denied'; ST.notify = false; ST.nmsg = 'denied'; page('display', { section: 'display.sound' }); await settle(); toEl('.p5c-nrow'); break;
    case 'di-motion-reduced': R('display.reducedMotion').v = 'on'; A.applyFlags(); applyMine(); page('display', { section: 'display.lowpower' }); await settle(); toEl('.p5c-animctl'); break;
    case 'di-lowpower': A.setLowPower(true); page('display', { section: 'display.lowpower' }); await settle(); toEl('.p5c-animctl'); break;
    case 'di-advanced-open': P.open.adv = true; page('display', { section: 'display.advanced' }); await settle(); toEl('#p5c-adv'); break;
    case 'in-scroll-picker': page('input', { section: 'input.scroll' }); await settle(); toEl('.p5c-pos'); break;
    case 'in-scroll-hidden': R('input.alwaysScroll').v = true; page('input', { section: 'input.scroll' }); await settle(); toEl('[data-row="input.alwaysScroll"]'); break;
    case 'in-instant-caution': R('input.instantRemove').v = true; page('input', { section: 'input.confirm' }); await settle(); toEl('#p5c-caution'); break;
    case 'in-sidebar-items': page('input'); await settle(); openSub('sidebar-items', 'input.customSidebar'); break;
    case 'in-sidebar-undo': page('input'); await settle(); openSub('sidebar-items', 'input.customSidebar'); await settle(); sbRemove('s2'); break;
    case 'in-touch-hover': ST.platform.touch = true; page('input', { section: 'input.edit' }); await settle(); toEl('[data-row="input.blockEdit"]'); break;
    case 'mo-repair': DC.reset(DC.SET5C, 'all-modes-hidden-repair', DC.HOME || 'hybrid', DC.PERM_Q); page('display', { section: 'display.modes' }); break;
    case 'mo-repair-confirm': DC.reset(DC.SET5C, 'all-modes-hidden-repair', DC.HOME || 'hybrid', DC.PERM_Q); page('display', { section: 'display.modes' }); await settle(); showAllAsk(); break;
    case 'mo-repair-done': DC.reset(DC.SET5C, 'all-modes-hidden-repair', DC.HOME || 'hybrid', DC.PERM_Q); page('display', { section: 'display.modes' }); await settle(); doShowAll(); break;
    case 'mo-last-mode': DC.reset(DC.SET5C, '', '', DC.PERM_Q); ST.modes.visible = ['utility']; ST.modes.hideUnused = true; page('display', { section: 'display.modes' }); break;
    case 'un-toast-page': page('input'); await settle(); openSub('sidebar-items', 'input.customSidebar'); await settle(); sbRemove('s1'); break;
    case 'un-toast-10s': page('display'); await settle(); toast(window.__ss5b ? window.__ss5b.t5('cacheCleared', '1,284') : 'cache', { kind: 'delete', until: '10s', action: { label: t5('undo'), fn: () => {} } }); break;
    case 'un-toast-reason': page('display'); await settle(); toast(KO() ? '프리셋을 지웠어요' : 'Preset deleted', { kind: 'delete', until: 'purge', sub: pick('밤 이야기', 'Night story'), action: { label: t5('undo'), fn: () => {} } }); break;
    case 'se-hideapikey': openS({ page: 'display', noFocus: true }); window.__ss1.setQuery(q || 'hideApiKey'); break;
    case 'se-lorebook-moved': openS({ page: 'display', noFocus: true }); window.__ss1.setQuery(q || 'bulkEnabling'); break;
    case 'se-memlimit-none': openS({ page: 'display', noFocus: true }); window.__ss1.setQuery(q || 'showMemoryLimit'); break;
    default: break;
  }
  await sleep(60); window.__ss5c1Ready = name;
}

/* ------------------------------------------------------------------ public API (checks, the demo panel and reviewers) */
function API() {
  return {
    P, ST, K, CFG, DC, t5, A, B, D, STATES: STATES5C, runState: runState5c, repaint, openSub, subClose, enhance, mine, rowP, lockOf, effModes, statusText, toggleMode, showAllAsk, doShowAll, setChoice, resetMine, notifyToggle, sbRemove, sbAddDialog, bgPick, bgClear,
    colorsImport, colorsExport, animText, durOf, posOf, applyMine, wireReveals, toggleReveal, studioUrl, go, settingHits, paintAnim, isTouch, newTag, onHex, setColor,
  };
}
void until; void sleep;
})();
