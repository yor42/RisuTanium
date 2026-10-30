/* Settings slice 5c-2 mockup: 데이터·백업 (data), 고급 (adv) and 언어 (lang), on the shared warning and task-progress pattern (window.RisuPattern, patterns/pattern.js).
   Synthetic mockup; not proof of native behaviour or performance. Standalone (no network, no dependencies): nothing here reads or writes the real app's storage; backups, restores, the file picker, the clipboard, the cache check and the reopen of the app are simulated by a timer engine.
   Loaded after slice5c1.js and BEFORE slice1.js: it wraps the window.SS1_EXT hooks slices 2 to 5c-1 registered (slice1.js reads them at start-up) and receives slice 1's API in X.boot.
   Implements settings/SLICE5C2_SPEC.md revision 1. Store-first (DS-067): the settings are rows of slice 1's catalogue (data5c2.js) and the compound ones (snapshots, ban list, restart state, language choice) are the SS5C2_DATA.ST store; every page reads them by id at render time.
   The pattern owns the warning sheet, the progress card, focus, inert, the 250 ms arm guard, the 10 s Undo line, reduced motion and low power; this file only supplies the definitions, the counts and the mock engine, and never overrides a pattern part.
   Floor devices (Note 9 / Android 10 WebView, Raspberry Pi 3): no optional chaining, nullish coalescing, .at(), replaceAll or structuredClone; checks/ss5c2/modes.mjs scans for them.
   Sections: helpers, icons, rows, 데이터·백업, backup, restore, other operations, 고급, 언어, events, hooks, states, public API. */
(() => {
'use strict';
const X = window.SS1_EXT;
const D = window.SS1_DATA, DC = window.SS5C2_DATA;
const RP = window.RisuPattern;
const Q = new URLSearchParams(location.search);
let A = null, B = null;
const { K, PK, ST, FILES, SFILES, LOG_LINES, STAT_ROWS, BAN_SCRIPTS, LANGS_UI, LEFTOUT, PLAT, MB, NOW } = DC;
const CFG = { speed: DC.SPEED, tick: 45, undoMs: 10000 };
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ic = (n, s, c) => A.ic(n, s, c);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KO = () => A.S.lang === 'ko';
const pick = (ko, en) => (KO() ? ko : (en === undefined || en === '' ? ko : en));
const P = { open: { exp: false, unrec: false }, missing: [], writes: 0, booted: false, defer: false, tasks: [], flow: null, task: null, hold: null, held: null, release: null, runSeq: 0, last: null, trigger: null, restartFlow: null, noNav: false, went: '' };
const t5 = (k, ...a) => { const v = K[A.S.lang][k]; if (v === undefined) { P.missing.push(k); return '⟦' + k + '⟧'; } return typeof v === 'function' ? v(...a) : v; };
const R = (id) => A.ROW[id];
const rv = (id) => A.ROW[id].v;
const lab = (r) => A.L(r);
const mine = (r) => !!r && r.p5c2 === true;
const unavail = (r) => window.__ss1.unavail(r);
const nf = (n) => Number(n).toLocaleString(KO() ? 'ko-KR' : 'en-US');
const sz = (b) => RP.fmtSize(b);
const p2 = (n) => (n < 10 ? '0' : '') + n;
const fmtDate = (ms) => { const d = new Date(ms); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes()); };
const ymd = () => '20261028';
const relTime = (ms) => { const m = Math.max(1, Math.round((NOW - ms) / 60000)); if (m < 60) return t5('relMin', m); const h = Math.round(m / 60); if (h < 24) return t5('relHour', h); return t5('relDay', Math.round(h / 24)); };
const dispatchAsync = (f) => setTimeout(f, 0);
RP.addStrings(PK);

/* ------------------------------------------------------------------ icons (Lucide paths, inline; copied, not imported). Only the ones no earlier slice defined are added in boot. */
const ICONS5D = {
  'archive': '<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
  'history': '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
  'download': '<path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/>',
  'upload': '<path d="M12 3v12"/><path d="m17 8-5-5-5 5"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>',
  'shield-check': '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  'bug': '<path d="m8 2 1.88 1.88"/><path d="M14.12 3.88 16 2"/><path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/><path d="M12 20v-9"/><path d="M6.53 9C4.6 8.8 3 7.1 3 5"/><path d="M6 13H2"/><path d="M3 21c0-2.1 1.7-3.9 3.8-4"/><path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"/><path d="M22 13h-4"/><path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"/>',
  'chart-column': '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
  'scroll-text': '<path d="M15 12h-5"/><path d="M15 8h-5"/><path d="M19 17V5a2 2 0 0 0-2-2H4"/><path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3"/>',
  'circle-alert': '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>',
  'refresh-cw': null, 'trash-2': null,
};

/* ------------------------------------------------------------------ small helpers */
function announce(msg) { A.announce(msg); }
function toast(msg, o) {
  B.psToast(msg, o || {});
  const el = $('#psToast'); const stack = $('[data-part="pattern-task-toasts"]');   // on a phone the pattern's task chip sits at the bottom too: Settings' own toast is lifted above it so neither covers the other
  if (el) el.classList.toggle('p5c2-lift', !!(stack && !stack.hidden && stack.querySelector('[data-part="pattern-task-toast"]:not([hidden])')));
}
function repaint(focusFk) {   // re-render the page keeping scroll; the focused control is found again by its data-fk
  if (!A.S.open) return; const a = document.activeElement; const fk = focusFk || (a && a.getAttribute ? a.getAttribute('data-fk') : '');
  if (P.defer) { setTimeout(() => repaint(fk), 0); return; }
  A.refreshPage(); const sc = $('#pageScroll');
  if (fk && sc) { const e = $(`[data-fk="${CSS.escape(fk)}"]`, sc); if (e) e.focus({ preventScroll: true }); }
}
function focusFk(fk) { const e = fk && $(`#pageScroll [data-fk="${CSS.escape(fk)}"]`); if (e) { e.focus({ preventScroll: true }); return true; } return false; }
const inMine = () => A.S.open && A.S.view === 'page' && (A.S.page === 'data' || A.S.page === 'adv' || A.S.page === 'lang');
function reasonLine(domId, text) { return `<p class="p5b-reason" id="${esc(domId)}" data-part="settings-dim-reason" data-part-critical>${ic('circle-alert', 'sm')}<span class="p5b-rt">${esc(text)}</span></p>`; }
const newTag = () => `<span class="chip p5c-new" data-part="settings-new-tag" title="${esc(t5('newTagTitle'))}">${esc(t5('newTag'))}</span>`;
const noteLine = (cls, icon, text) => `<p class="p5b-note ${cls || ''}" data-part="settings-note">${ic(icon || 'info', 'sm')}<span>${esc(text)}</span></p>`;
const h3 = (text) => `<h3 class="p5b-h3 p5c-h3 p5c2-h3">${esc(text)}</h3>`;
const bannerHTML = (def) => RP.renderWarning(Object.assign({}, def, { form: 'banner' })).root.outerHTML;   // a static pattern banner (no disclosure) as markup
function rowP(r, o) {
  o = o || {}; let h = A.rowHTML(r).replace(/ max="undefined"/, '');
  if (r.isNew) h = h.replace('</label>', '</label>' + newTag());
  return h;
}
function rowsOf(ids, o) {   // the rows of the list that are available now; a row that is not is not in the DOM; a search hit on one shows slice 1's explanation instead
  const out = [];
  ids.forEach((id) => { const r = R(id); const un = unavail(r); if (un) { if (o && o.reveal === id) out.push(revealNote(r)); return; } out.push(rowP(r)); });
  return out;
}
function revealNote(r) {
  const un = unavail(r); if (!un) return ''; const sw = un.goto ? R(un.goto) : null;
  return `<div class="row unavail-note" data-row="${esc(r.id)}" data-row-kind="unavailable" data-part="settings-row" role="group" aria-labelledby="l-${esc(r.id)}" tabindex="-1">${ic('triangle-alert', 'lg')}<div class="un-body"><p data-part="settings-row-label" class="r-label" id="l-${esc(r.id)}">${esc(lab(r))}</p><p data-part="settings-row-description" class="r-desc">${esc(un.text)}</p>` +
    (sw ? `<button type="button" data-part="settings-button" class="btn solid un-go" data-goto="${esc(un.goto)}" data-ctl><span>${esc(A.t('goToSwitch', lab(sw)))}</span>${ic('chevron-right', 'md')}</button>` : '') + '</div></div>';
}
const secOpen = (id, title, cls) => `<section class="sec${cls ? ' ' + cls : ''}" id="sec-${id}" data-sec="${id}" data-part="settings-section" aria-labelledby="h-${id}"><h2 class="sec-h" id="h-${id}" data-part="settings-section-title" tabindex="-1">${esc(title)}</h2>`;
const secBody = (items) => `<div class="rows" data-part="settings-rows">${items.join('')}</div>`;
const stitle = (id) => A.L(A.SEC[id]);
function headHTML(pid, extra) {
  const Pg = A.PAGE[pid]; let h = `<div class="pg p5c2 p5c2-${pid}" data-page="${pid}" data-part="settings-page-body"><div class="pg-head" data-part="settings-page-header"><h1 class="pg-title" id="pgTitle" tabindex="-1">${esc(A.L(Pg))}</h1>`;
  if (A.S.notice) h += `<p class="banner warn" data-part="settings-warning-banner" data-part-critical role="status">${ic('info', 'lg')}<span>${esc(A.S.notice)}</span></p>`;
  return h + (extra || '') + '</div>';
}
function chipsHTML(pid, only) {
  const secs = D.SECTIONS.filter((s) => s.page === pid && A.L(s) && (!only || only.indexOf(s.id) >= 0));
  return `<nav class="chips" data-part="settings-jump-chips" aria-label="${esc(A.t('sectionNav'))}">${secs.map((s) => `<button type="button" class="chip-b" data-secjump="${esc(s.id)}">${esc(A.L(s))}</button>`).join('')}</nav>`;
}
function opRow(r, o) {   // a row that is one button: it opens a sheet or starts an operation (the whole row is the target)
  o = o || {}; const lid = 'l-' + r.id, did = 'd-' + r.id, dis = !!o.disabled; const desc = o.desc !== undefined ? o.desc : A.pair(r.desc || '');
  return `<div class="row row-link p5c2-oprow${dis ? ' p5c2-dim' : ''}" data-row="${esc(r.id)}" data-row-kind="action" data-part="settings-row"><button type="button" class="rl" data-ctl data-p5c2="op" data-op="${esc(r.op)}" data-fk="op:${esc(r.op)}" id="c-${esc(r.id)}"${dis ? ' aria-disabled="true"' : ''} aria-describedby="${did}${dis ? ' dr-' + esc(r.id) : ''}">` +
    `<span class="r-text"><span class="r-lw"><span data-part="settings-row-label" class="r-label" id="${lid}">${esc(lab(r))}</span>${r.isNew ? newTag() : ''}</span>${desc ? `<span data-part="settings-row-description" class="r-desc" id="${did}">${esc(desc)}</span>` : `<span class="sr-only" id="${did}"></span>`}</span>` +
    `<span class="rl-end">${o.trail ? `<span class="rl-txt">${esc(o.trail)}</span>` : ''}${ic(r.icon || 'chevron-right', 'lg')}</span></button>${dis ? reasonLine('dr-' + r.id, o.reason) : ''}</div>`;
}
const devNote = (id, key) => (R(id).dev ? noteLine('', 'info', t5(key)) : '');

/* ------------------------------------------------------------------ pattern: one flow per operation (DS-153). The page keeps a busy flag: a second operation while one runs is refused with a notice (the app's refuseBackupLoadWhileBusy). */
const BG = () => [$('#settings'), $('#origin')];
const busy = () => P.tasks.some((t) => t.state === 'running' || t.state === 'paused' || t.state === 'cancelling');
function refused() {
  if (!busy()) return false;
  toast(t5('busyT'), { sub: t5('busyS'), ms: 5000 }); announce(t5('busyT') + '. ' + t5('busyS')); return true;
}
function layerSync() { const open = RP.openDialogs.size > 0 || !!$('#layer .dlg-back'); document.body.classList.toggle('dlg-open', open); }   // the toasts of Settings wait while a sheet is open (DD-244), the same way they wait behind its own dialogs
function afterLayers(fn) { const t0 = Date.now(); const poll = () => { if (RP.openDialogs.size === 0 && !$('[data-part="pattern-layer"]') && !$('#layer .dlg-back')) fn(); else if (Date.now() - t0 < 8000) setTimeout(poll, 40); }; setTimeout(poll, 40); }
function mkTask(kind, name, steps, o) {
  o = o || {};
  const task = RP.createTask({ kind, name, file: o.file || name, subtitle: o.subtitle || '', background: !!o.background, retrySkipped: false, groupedUndo: kind === 'import', steps });
  P.tasks.push(task); if (P.tasks.length > 12) P.tasks.shift(); P.task = task; return task;
}
const S = (id, mark, o) => Object.assign({ id, key: 'p2.step.' + id, mark, cancel: true }, o || {});
function openFlow(task, o) {
  o = o || {};
  const f = RP.openTaskFlow(task, { warning: o.warning || null, trigger: o.trigger, container: document.body, background: BG(), noBackground: !!o.noBackground, onCheckAgain: o.onCheckAgain, onConfirm: o.onConfirm, onCancel: o.onCancel });
  P.flow = f; layerSync();
  task.on((type) => { if (type === 'state') layerSync(); });
  return f;
}
const waitReal = (ms) => new Promise((r) => setTimeout(r, ms));
const sleepE = (ms) => waitReal(Math.max(0, ms * CFG.speed));
async function waitHold(step, at) {
  const h = P.hold; if (!h || h.step !== step || h.at !== at) return;
  P.held = { step, at }; P.hold = null;
  await new Promise((res) => { P.release = res; });
  P.held = null; P.release = null;
}
function release() { const r = P.release; P.release = null; if (r) r(); }
/* the mock engine: one run of a plan; spec.steps[i] = { id, ms | total, fail: { at?, state, code, kept, failed } }. A step with a total of 0 is skipped. */
async function run(task, spec, o) {
  o = o || {}; const my = ++P.runSeq; const alive = () => P.runSeq === my;
  const settle = async () => {
    if (task.state !== 'cancelling') return false;
    await sleepE(700); if (!alive()) return true;
    task.settleCancel(o.cancelResult ? o.cancelResult() : {}); if (o.onSettled) o.onSettled('cancelled'); return true;
  };
  const unpause = async () => {
    while (task.state === 'paused' && alive()) await waitReal(60);
    return alive();
  };
  const failWith = (f, k, total) => { task.fail({ dataState: f.state || 'same', code: f.code || 'E-MOCK-101', kept: f.kept === 'k' ? k : f.kept, failed: f.failed === 't' ? total - k : f.failed, retrySafe: f.state === 'unknown' ? false : true }); if (o.onSettled) o.onSettled('failed'); };
  if (!o.started) task.start();
  for (let i = 0; i < spec.steps.length; i++) {
    const s = spec.steps[i];
    if (i > 0) task.step(i);
    if (s.total === 0) { task.skipStep(i); continue; }
    if (s.pre) s.pre(task);
    await waitHold(s.id, 0); if (!alive()) return;
    if (s.block && ST.lock.held && s.block === 'other-tab') { task.block('other-tab'); if (!(await unpause())) return; }
    if (await settle()) return;
    if (s.total) {
      const ticks = Math.min(s.total, s.ticks || 14);
      for (let k = 1; k <= ticks; k++) {
        await sleepE(CFG.tick); if (!alive()) return;
        if (task.state === 'paused' && !(await unpause())) return;
        if (await settle()) return;
        const cnt = Math.round(s.total * k / ticks), prev = Math.round(s.total * (k - 1) / ticks);
        if (s.fail && s.fail.at === k) { failWith(s.fail, prev, s.total); return; }   // the k-th unit fails: prev were done before it
        if (task.state === 'running') { task.progress(cnt, s.total); if (s.onTick) s.onTick(cnt, k, ticks); }
        await waitHold(s.id, k); if (!alive()) return;
      }
    } else {
      await sleepE(s.ms || 600); if (!alive()) return;
      if (task.state === 'paused' && !(await unpause())) return;
      if (await settle()) return;
      if (s.fail) { failWith(s.fail, 0, 0); return; }
    }
    if (s.post) s.post(task);
  }
  if (!alive()) return;
  task.finish(spec.finish()); if (o.onSettled) o.onSettled('done');
}
function runPlan(task, makeSpec, sc, o) {   // Retry (the pattern offers it only where repeating is safe) starts the same plan again, this time without the scenario's fault
  let seen = task.attempt;
  task.on(() => { if (task.state === 'running' && task.attempt > seen) { seen = task.attempt; setTimeout(() => run(task, makeSpec('ok'), Object.assign({}, o || {}, { started: true })), 60); } });
  return run(task, makeSpec(sc), o);
}
function scen(op) {
  const n = ST.sim.next; if (n) { ST.sim.next = ''; return n; }
  if (ST.sim.failing) return ({ backup: 'over4g', 'backup-part': 'fail', 'restore-file': 'unknown', 'restore-snap': 'fail', dataset: 'skips', clean: 'fail' })[op] || 'ok';
  return 'ok';
}

/* ------------------------------------------------------------------ 백업 만들기: one action, a sheet with the format and the scope (DS-177), then the pattern */
const PROFILE_IMAGES = 164;
const backupName = (fmt, scope) => (fmt === 'rtb' ? 'risu-' + (scope === 'full' ? 'backup' : 'partial') + '-' + ymd() + '.rtb' : 'local-' + (scope === 'full' ? '' : 'partial-') + ymd() + '.bin');
function leftOutItems() { return LEFTOUT.map((x) => ({ kind: x.kind, count: x.n, text: t5('lo_' + x.kind, x.n) })); }
function defKeys() { return { severity: 'caution', headline: t5('wKeysH'), consequences: [t5('wKeysC', ST.profile.connections)] }; }
function defMemory() { return { severity: 'notice', headline: t5('wMemH'), consequences: [t5('wMemC1'), t5('wMemC2', sz(ST.profile.estBytes))] }; }
function defBin(scope) {
  const pr = ST.profile; const c = leftOutItems().map((x) => x.text);
  const lead = scope === 'part' ? [t5('wPartC1', nf(PROFILE_IMAGES), nf(pr.archived))] : [];
  return { severity: 'caution', headline: t5('wBinH'), consequences: lead.concat(c), detail: [t5('wBinD1'), t5('wBinD2')], leftOut: leftOutItems(), mock: true, actions: { cancel: t5('cancel'), secondary: t5('wBinSecondary'), primary: t5('wBinPrimary') } };
}
function defPartial() {
  const pr = ST.profile;
  return { severity: 'confirm', headline: t5('wPartH'), consequences: [t5('wPartC1', nf(PROFILE_IMAGES), nf(pr.archived)), t5('wPartC2', nf(pr.leftFiles), sz(pr.leftBytes))], detail: [t5('wPartD1'), t5('wPartD2')], actions: { cancel: t5('cancel'), primary: t5('wPartGo') } };
}
function backupSheet(trigger) {
  if (refused()) return null;
  let fmt = 'rtb', scope = 'full';
  const opt = (name, v, title, desc, on) => `<label class="p5c2-opt${on ? ' cur' : ''}" data-part="settings-backup-option" data-v="${v}"><input type="radio" class="p5c-rad" name="p5c2-${name}" value="${v}" data-p5c2="bk-${name}" data-fk="bk:${name}:${v}"${on ? ' checked' : ''}><span class="p5c2-optb"><span class="p5c2-optn">${esc(title)}</span><span class="p5c2-optd">${esc(desc)}</span></span></label>`;
  const body = () => `<div class="p5c2-bk"><fieldset class="p5c2-choices" data-part="settings-backup-choice"><legend class="p5b-leg">${esc(t5('bkFmt'))}</legend>${opt('fmt', 'rtb', t5('bkRtb'), t5('bkRtbD'), fmt === 'rtb')}${opt('fmt', 'bin', t5('bkBin'), t5('bkBinD'), fmt === 'bin')}</fieldset>` +
    `<fieldset class="p5c2-choices" data-part="settings-backup-choice"><legend class="p5b-leg">${esc(t5('bkScope'))}</legend>${opt('scope', 'full', t5('bkFull'), t5('bkFullD', sz(ST.profile.estBytes)), scope === 'full')}${opt('scope', 'part', t5('bkPart'), t5('bkPartD', sz(ST.profile.partialBytes)), scope === 'part')}</fieldset><div class="p5c2-bknotes" id="p5c2-bknotes"></div></div>`;
  const d = A.openDialog({ critical: false, title: t5('bkT'), body: body(), buttons: [{ id: 'cancel', label: t5('cancel') }, { id: 'ok', label: t5('bkStart'), primary: true }], initial: 'input:checked', onClose: () => { layerSync(); } });
  const notes = () => { const h = $('#p5c2-bknotes', d.back); h.replaceChildren(); if (ST.sim.memory && PLAT.web) RP.banner(defMemory(), h); if (fmt === 'rtb' && ST.profile.keys) RP.banner(defKeys(), h); };
  notes();
  d.back.addEventListener('change', (ev) => {
    const el = ev.target; if (!el.matches || !el.matches('input[data-p5c2]')) return;
    if (el.dataset.p5c2 === 'bk-fmt') fmt = el.value; else scope = el.value;
    $$('.p5c2-opt', d.back).forEach((l) => { const inp = $('input', l); l.classList.toggle('cur', inp.checked); }); notes();
  });
  A.openDialog.handlers = { ok: () => { dispatchAsync(() => startBackup(fmt, scope, trigger)); } };
  P.chooser = { get fmt() { return fmt; }, get scope() { return scope; }, close: d.close };
  return d;
}
function backupSpec(fmt, scope, sc) {
  const pr = ST.profile; const full = scope === 'full'; const res = () => backupResult(fmt, scope, sc);
  const fail = sc === 'fail' ? { at: 6, state: 'same', code: 'E-WRITE-101' } : null; const unk = sc === 'unknown' ? { state: 'unknown', code: 'E-DB-UNCONFIRMED' } : null;
  const steps = full ? [{ id: 'prep', ms: 700 }, { id: 'assets', total: pr.assets, fail }, { id: 'inlays', total: pr.inlays }, { id: 'cold', total: pr.archived }, { id: 'db', ms: 800, fail: unk }]
    : [{ id: 'review', ms: 600 }, { id: 'profile', total: PROFILE_IMAGES, fail }, { id: 'cold', total: pr.archived }, { id: 'db', ms: 800, fail: unk }];
  return { steps, finish: res };
}
function backupSteps(scope) {
  return scope === 'full'
    ? [S('prep', 'preparing'), S('assets', 'transfer_out', { counted: true, noun: 'p2.noun.asset', write: true }), S('inlays', 'transfer_out', { counted: true, noun: 'p2.noun.inlay' }), S('cold', 'transfer_out', { counted: true, noun: 'p2.noun.cold' }), S('db', 'finishing', { cancel: false })]
    : [S('review', 'preparing'), S('profile', 'transfer_out', { counted: true, noun: 'p2.noun.profile', write: true }), S('cold', 'transfer_out', { counted: true, noun: 'p2.noun.cold' }), S('db', 'finishing', { cancel: false })];
}
function backupResult(fmt, scope, sc) {
  const pr = ST.profile; const skipped = [];
  if (pr.assets > 20) { skipped.push({ name: 'bg-night.webp', reason: 'notstored' }); if (scope === 'full') skipped.push({ name: 'voice-07.wav', reason: 'notstored' }); }
  if (sc === 'over4g') skipped.push({ name: 'voice-long.wav', reason: 'large', detail: sz(Math.round(4.3 * 1073741824)) });
  if (scope === 'part') skipped.push({ name: 'cover-0412.png', reason: 'notstored' });
  const r = { counts: t5('bkCounts', nf(pr.characters), nf(pr.chats), nf(pr.presets)), size: scope === 'full' ? pr.estBytes : pr.partialBytes, file: backupName(fmt, scope), skipped };
  if (fmt === 'bin') { r.leftOut = leftOutItems(); r.mock = true; }
  return r;
}
function startBackup(fmt, scope, trigger, o) {
  o = o || {};
  if (refused()) return null;
  const pr = ST.profile; const sc = scen(scope === 'full' ? 'backup' : 'backup-part'); const name = backupName(fmt, scope);
  const task = mkTask('backup', name, backupSteps(scope), { background: true, subtitle: () => t5('bkSub', nf(pr.characters), nf(pr.chats), sz(scope === 'full' ? pr.estBytes : pr.partialBytes)) });
  const warning = o.noWarning ? null : fmt === 'bin' ? defBin(scope) : scope === 'part' ? defPartial() : null;
  const go = () => { setTimeout(() => runPlan(task, (x) => backupSpec(fmt, scope, x), sc, { onSettled: () => { P.last = { kind: 'backup', fmt, scope, sc }; } }), 350); };
  const f = openFlow(task, { warning, trigger, onConfirm: (what) => {
    if (what === 'secondary') {   // ".rtb로 만들기": openTaskFlow closes the sheet on a secondary answer and would mount the card into the closing dialog (pattern finding), so the card is dropped and a new .rtb flow opens once the sheet is gone
      try { if (f.view) f.view.destroy(); } catch (e) { /* none */ } f.view = null; if (task.state === 'confirm') task.abandon(); P.tasks = P.tasks.filter((x) => x !== task);
      afterLayers(() => startBackup('rtb', scope, trigger, { noWarning: true })); return;
    }
    go();
  } });
  if (!warning) go();
  return { task, flow: f };
}

/* ------------------------------------------------------------------ 불러오기: a file picker, a danger sheet, the pattern (DS-176, DS-182, DS-190) */
function filePicker(o) {
  let sel = '';
  const body = () => `<p class="dlg-hint">${esc(o.hint)}</p><ul class="p5b-files" role="list">${o.files.map((f) => `<li><label class="p5b-filel"><input type="radio" name="p5c2-file" data-pf="${f.id}"${sel === f.id ? ' checked' : ''}><span>${esc(f.name)}${f.ok ? esc(o.meta(f)) : ''}</span></label></li>`).join('')}</ul><p class="p5b-fmsg" id="p5c2-fmsg" role="alert" aria-live="assertive"></p>`;
  const d = A.openDialog({ critical: false, title: o.title, body: body(), buttons: [{ id: 'cancel', label: t5('cancel') }, { id: 'ok', label: o.ok, primary: true, disabled: true }], initial: '[data-pf]', onClose: () => { layerSync(); } });
  const paint = () => { const f = o.files.find((x) => x.id === sel); const btn = $('[data-dlg="ok"]', d.back); const m = $('#p5c2-fmsg', d.back); btn.setAttribute('aria-disabled', f && f.ok ? 'false' : 'true'); m.textContent = !f ? '' : f.ok ? o.okLine(f) : t5('fileBad_' + f.why); m.className = 'p5b-fmsg' + (f && !f.ok ? ' bad' : ''); };
  d.back.addEventListener('change', (ev) => { const c = ev.target.closest('[data-pf]'); if (c) { sel = c.dataset.pf; paint(); } });
  A.openDialog.handlers = { ok: () => { const f = o.files.find((x) => x.id === sel); if (!f || !f.ok) return false; dispatchAsync(() => o.onPick(f)); } };
  return d;
}
function restoreFilePick(trigger) {
  if (refused()) return null;
  return filePicker({ title: t5('rfT'), hint: t5('rfHint'), files: FILES, ok: t5('rfOk'), meta: (f) => ' · ' + sz(f.bytes) + ' · ' + fmtDate(f.at), okLine: (f) => t5('rfOkLine', f.name, nf(f.chars), nf(f.chats)), onPick: (f) => startRestoreFile(f, trigger) });
}
function defSalvage(f) { return { severity: 'confirm', headline: t5('wSalvH'), consequences: [t5('wSalvC1', f.damaged), t5('wSalvC2', nf(f.lostChats)), t5('wSalvC3')], actions: { cancel: t5('cancel'), primary: t5('wSalvGo') } }; }
function defRestoreFile(f) {
  const pr = ST.profile; const c = [t5('wRfC1', nf(f.chars), nf(f.chats), nf(pr.characters), nf(pr.chats)), t5('wRfC2'), t5('wRfC3')];
  if (f.missImg) c.splice(1, 1, t5('wRfC2n', nf(f.missImg), sz(f.missBytes)));
  return { severity: 'danger', headline: t5('wRfH'), consequences: c, detail: [t5('wRfD1', f.name, fmtDate(f.at)), t5('wRfD2'), f.fmt === 'bin' ? t5('wRfD3bin') : t5('wRfD3rtb')], actions: { cancel: t5('cancel'), primary: t5('wRfGo') } };
}
function restoreFileSteps() {
  return [S('check', 'scanning'), S('tabs', 'scanning'), S('safety', 'transfer_out', { cancel: false }), S('write', 'transfer_in', { counted: true, noun: 'p2.noun.asset', write: true, cancel: false }), S('replace', 'transfer_in', { cancel: false, write: true }), S('verify', 'scanning', { cancel: false })];
}
function restoreFileSpec(f, sc) {
  const pr = ST.profile; const assets = Math.max(8, Math.round(f.bytes / MB / 6));
  const wfail = sc === 'fail' ? { at: 5, state: 'partial', code: 'E-IMG-WRITE', kept: 'k', failed: 't' } : null; const unk = sc === 'unknown' ? { state: 'unknown', code: 'E-SAVE-UNCONFIRMED' } : null;
  return { steps: [{ id: 'check', ms: 700 }, { id: 'tabs', ms: 600, block: 'other-tab' }, { id: 'safety', ms: 800, post: () => { addSafetySnapshot(); } }, { id: 'write', total: assets, fail: wfail }, { id: 'replace', ms: 900 }, { id: 'verify', ms: 700, fail: unk }],
    finish: () => restoreResult(f) };
}
function restoreResult(f) {
  const skipped = [];
  if (f.fmt === 'rtb') skipped.push({ name: 'voice-04.wav', reason: 'large', detail: sz(31 * MB) });
  if (f.damaged) { skipped.push({ name: 'chat-0412 (' + t5('damagedBlock') + ')', reason: 'invalid' }, { name: 'chat-0415 (' + t5('damagedBlock') + ')', reason: 'invalid' }); }
  return { counts: t5('rfCounts', nf(f.chars), nf(f.chats)) + ' · ' + t5('rfSafetyKept'), size: f.bytes, skipped, file: f.name };
}
function addSafetySnapshot() {
  const pr = ST.profile; ST.snSeq++;
  ST.snapshots.unshift({ id: 'sn' + ST.snSeq, at: NOW, bytes: pr.estBytes, chars: pr.characters, safety: true });
}
function startRestoreFile(f, trigger, o) {
  o = o || {};
  const go = () => {
    const sc = scen('restore-file'); const task = mkTask('restore', f.name, restoreFileSteps(), { background: false, subtitle: () => t5('rfSub', f.name, nf(f.chars), nf(f.chats)) });
    const flow = openFlow(task, { warning: defRestoreFile(f), trigger, noBackground: true, onCheckAgain: () => checkTabsAgain(task), onConfirm: () => { setTimeout(() => runPlan(task, (x) => restoreFileSpec(f, x), sc, { onSettled: (how) => restoreSettled(task, flow, how, f) }), 350); } });
    watchRestart(flow, task);
  };
  if (f.damaged) {   // R 1.3 step 6: the engine decodes the database and finds damaged blocks. Proposed: that check moves ahead of the first write, so the question comes while Cancel still works (Engine items)
    const w = RP.openWarning(defSalvage(f), { trigger, container: document.body, background: BG() }); layerSync();
    w.promise.then((what) => { layerSync(); if (what === 'confirm') afterLayers(go); });
    return w;
  }
  go(); return null;
}
function checkTabsAgain(task) {
  if (ST.lock.held) { announce(t5('lockStill')); return; }
  if (task.state === 'paused') task.unblock();
}
function restoreSettled(task, flow, how, f) {
  if (how === 'done') { ST.restart = { needed: true, kind: 'done', apply: () => { ST.profile.characters = f.chars; ST.profile.chats = f.chats; } }; }
  else if (how === 'failed' && task.failure) { ST.restart = { needed: task.failure.dataState === 'unknown', kind: task.failure.dataState, apply: null }; }
  if (A.S.open && A.S.page === 'data') repaint();
}
function watchRestart(flow, task) {   // DS-190: the result card carries 다시 시작 next to the pattern's own Close; the page keeps the same button in a banner until it is pressed
  const find = () => { const sh = flow.dialog && flow.dialog.shell; return sh ? $('[data-part="pattern-task-result-actions"]', sh) : null; };
  const put = () => {
    if (task.state !== 'done' && task.state !== 'done-with-skips' && !(task.state === 'failed' && task.failure && task.failure.dataState === 'unknown')) return;
    const acts = find(); if (!acts || $('[data-part="settings-restart"]', acts)) return;
    const b = RP.button('settings-restart', t5('restart'), { critical: true, variant: 'confirm' }); b.setAttribute('data-p5c2', 'restart'); b.setAttribute('data-fk', 'restart:card');
    acts.insertBefore(b, acts.firstChild); b.addEventListener('click', () => doRestart(flow));
  };
  const mo = new MutationObserver(put); mo.observe(document.body, { childList: true, subtree: true });
  task.on((type) => { if (type === 'state' && task.state === 'idle') mo.disconnect(); });
  P.restartFlow = flow; P.restartMo = mo;
}
function doRestart(flow) {
  const need = ST.restart; ST.restart = { needed: false, kind: '', apply: null }; if (need.apply) need.apply(); P.writes++;
  if (flow && flow.dialog && flow.close) flow.close();
  layerSync(); if (P.restartMo) P.restartMo.disconnect();
  afterLayers(() => { repaint(); toast(t5('restartDone'), { sub: t5('restartDoneSub'), ms: 6000 }); announce(t5('restartDone')); });
}
function restartBannerHTML() {
  const un = ST.restart.kind === 'unknown';
  return `<p class="banner warn p5c2-restart" data-part="settings-restart-banner" data-part-critical role="status">${ic('triangle-alert', 'lg')}<span class="p5c2-rt"><strong>${esc(t5(un ? 'rbUnknownH' : 'rbH'))}</strong><span>${esc(t5(un ? 'rbUnknownS' : 'rbS'))}</span></span><button type="button" class="btn solid accent" data-part="settings-restart" data-part-critical data-p5c2="restart" data-fk="restart:page">${ic('refresh-cw', 'md')}<span>${esc(t5('restart'))}</span></button></p>`;
}

/* ------------------------------------------------------------------ 자동 스냅샷 (DS-181): date, size and character count; choosing one leads to the restore flow */
function snapshotSheet(trigger) {
  if (refused()) return null;
  const list = ST.snapshots;
  const body = () => list.length
    ? `<p class="dlg-hint">${esc(t5('snHint'))}</p><ul class="p5c2-snaps" data-part="settings-snapshot-list" role="list" aria-label="${esc(t5('snT'))}">${list.map((s) => {
      const full = `${fmtDate(s.at)}, ${relTime(s.at)}, ${sz(s.bytes)}, ${t5('snChars', nf(s.chars))}${s.safety ? ', ' + t5('snSafety') : ''}`;
      return `<li><button type="button" class="p5c2-snap" data-part="settings-snapshot-item" data-sn="${esc(s.id)}" aria-label="${esc(t5('snPickOf', full))}"><span class="p5c2-snd"><span class="p5c2-snabs">${esc(fmtDate(s.at))}</span><span class="p5c2-snrel">${esc(relTime(s.at))}</span>${s.safety ? `<span class="chip p5c2-snsafe">${esc(t5('snSafety'))}</span>` : ''}</span><span class="p5c2-snm"><span>${esc(sz(s.bytes))}</span><span>${esc(t5('snChars', nf(s.chars)))}</span></span></button></li>`;
    }).join('')}</ul>`
    : `<p class="p5c2-empty" role="status">${esc(t5('snNone'))}</p>`;
  const d = A.openDialog({ critical: false, title: t5('snT'), body: body(), buttons: [{ id: 'cancel', label: t5('close') }], initial: list.length ? '.p5c2-snap' : '[data-dlg="cancel"]', onClose: () => { layerSync(); } });
  A.openDialog.handlers = {};
  d.back.addEventListener('click', (ev) => { const b = ev.target.closest('[data-sn]'); if (!b) return; const s = list.find((x) => x.id === b.dataset.sn); if (s) { d.close('ok'); dispatchAsync(() => startRestoreSnapshot(s, trigger)); } });
  return d;
}
function defRestoreSnap(s) {
  const pr = ST.profile;
  return { severity: 'danger', headline: t5('wRsH'), consequences: [t5('wRsC1', fmtDate(s.at), sz(s.bytes), nf(s.chars)), t5('wRsC2', nf(s.chars), nf(pr.characters)), t5('wRsC3')], detail: [t5('wRsD1')], actions: { cancel: t5('cancel'), primary: t5('wRfGo') } };
}
function startRestoreSnapshot(s, trigger) {
  if (refused()) return null;
  const sc = scen('restore-snap'); const name = fmtDate(s.at);
  const steps = [S('snapcheck', 'scanning'), S('tabs', 'scanning'), S('safety', 'transfer_out'), S('replace', 'transfer_in', { cancel: false, write: true }), S('verify', 'scanning', { cancel: false })];
  const task = mkTask('restore', name, steps, { background: false, subtitle: () => t5('rsSub', fmtDate(s.at), sz(s.bytes), nf(s.chars)) });
  const spec = (x) => ({ steps: [{ id: 'snapcheck', ms: 700 }, { id: 'tabs', ms: 600, block: 'other-tab' }, { id: 'safety', ms: 800, post: () => { addSafetySnapshot(); } }, { id: 'replace', ms: 900, fail: x === 'fail' ? { state: 'same', code: 'E-WRITE-102' } : null }, { id: 'verify', ms: 700, fail: x === 'unknown' ? { state: 'unknown', code: 'E-SAVE-UNCONFIRMED' } : null }],
    finish: () => ({ counts: t5('rfCounts', nf(s.chars), nf(Math.round(s.chars * 19.9))) + ' · ' + t5('rsSafetyKept'), size: s.bytes, skipped: [], file: name }) });
  const flow = openFlow(task, { warning: defRestoreSnap(s), trigger, noBackground: true, onCheckAgain: () => checkTabsAgain(task), onConfirm: () => { setTimeout(() => runPlan(task, spec, sc, { onSettled: (how) => restoreSettled(task, flow, how, { chars: s.chars, chats: Math.round(s.chars * 19.9) }) }), 350); } });
  watchRestart(flow, task);
  return { task, flow };
}

/* ------------------------------------------------------------------ 내보내기·가져오기, 저장 공간 */
function startDataset(trigger) {
  if (refused()) return null;
  const pr = ST.profile; const sc = scen('dataset');
  const task = mkTask('export', 'dataset.json', [S('read', 'scanning', { counted: true, noun: 'p2.noun.char' }), S('build', 'transfer_out', { write: true })], { file: 'dataset.json', background: true, subtitle: () => t5('dsSub', nf(pr.chats)) });
  const unreadable = sc === 'skips' ? [{ name: 'Rook (' + t5('archived') + ')', reason: 'invalid' }, { name: 'Sora (' + t5('archived') + ')', reason: 'invalid' }] : [];
  const spec = { steps: [{ id: 'read', total: pr.archived, ticks: 12 }, { id: 'build', ms: 800 }], finish: () => ({ counts: t5('dsCounts', nf(pr.characters), nf(pr.chats)), size: Math.round(18.4 * MB), file: 'dataset.json', skipped: unreadable }) };
  const flow = openFlow(task, { trigger });
  setTimeout(() => run(task, pr.archived ? spec : { steps: [{ id: 'read', total: 0 }, { id: 'build', ms: 600 }], finish: spec.finish }, {}), 350);
  return { task, flow };
}
function defClean() {
  const c = ST.clean;
  return { severity: 'danger', headline: t5('wClH', nf(c.files)), consequences: [t5('wClC1', nf(c.files), sz(c.bytes)), t5('wClC2')], detail: [t5('wClD1')], actions: { cancel: t5('cancel'), primary: t5('wClGo') } };
}
function startClean(trigger) {
  if (refused()) return null;
  const c = ST.clean;
  if (!c.files) { toast(t5('cleanNoneT'), { ms: 3500 }); announce(t5('cleanNoneT')); return null; }
  const sc = scen('clean'); const files = c.files; const bytes = c.bytes;
  const task = mkTask('clean', t5('cleanName'), [S('confirm', 'scanning'), S('delete', 'transfer_out', { counted: true, noun: 'p2.noun.file', write: true })], { background: true, subtitle: () => t5('clSub', nf(files), sz(bytes)) });
  const spec = (x) => ({ steps: [{ id: 'confirm', ms: 600 }, { id: 'delete', total: files, ticks: 14, fail: x === 'fail' ? { at: 1, state: 'same', code: 'E-DELETE-103' } : null, onTick: (n) => { ST.clean.files = Math.max(0, files - n); ST.clean.bytes = Math.round(bytes * (files - n) / files); } }],
    finish: () => { ST.clean = { files: 0, bytes: 0 }; return { counts: t5('clCounts', nf(files), sz(bytes)), skipped: [] }; } });
  const flow = openFlow(task, { warning: defClean(), trigger, onConfirm: () => { setTimeout(() => runPlan(task, spec, sc, { onSettled: () => { if (A.S.open && A.S.page === 'data') repaint(); } }), 350); }, onCancel: () => {} });
  return { task, flow };
}
function startVerify(trigger) {
  if (refused()) return null;
  const bad = ST.cacheBad; const total = ST.cacheChecked;
  const task = mkTask('scan', t5('verifyName'), [S('scan', 'scanning', { counted: true, noun: 'p2.noun.file' }), S('compare', 'scanning')], { background: true, subtitle: () => t5('vfSub', nf(total)) });
  const spec = { steps: [{ id: 'scan', total, ticks: 14 }, { id: 'compare', ms: 700 }], finish: () => ({ counts: t5('vfCounts', nf(total), nf(bad.length)), skipped: [] }) };
  const flow = openFlow(task, { trigger });
  const off = task.on(() => { if (task.state === 'idle' && task.result && bad.length) { off(); afterLayers(() => mismatchSheet(trigger)); } });
  setTimeout(() => run(task, spec, {}), 350);
  return { task, flow };
}
function mismatchSheet(trigger) {
  const bad = ST.cacheBad; if (!bad.length) return null;
  const body = () => `<p class="dlg-hint">${esc(t5('mmHint', bad.length))}</p><table class="p5c2-table" data-part="settings-mismatch-table"><caption class="sr-only">${esc(t5('mmT'))}</caption><thead><tr><th scope="col">${esc(t5('mmName'))}</th><th scope="col">${esc(t5('mmSize'))}</th><th scope="col">${esc(t5('mmState'))}</th></tr></thead><tbody>${bad.map((x) => `<tr><th scope="row">${esc(x.name)}</th><td>${esc(sz(x.bytes))}</td><td>${esc(t5('mmDiff'))}</td></tr>`).join('')}</tbody></table>`;
  const d = A.openDialog({ critical: false, title: t5('mmT'), body: body(), buttons: [{ id: 'cancel', label: t5('later') }, { id: 'ok', label: t5('mmGo'), primary: true }], initial: '[data-dlg="cancel"]', onClose: () => { layerSync(); } });
  A.openDialog.handlers = { ok: () => { dispatchAsync(() => evictConfirm(trigger)); } };
  return d;
}
function evictConfirm(trigger) {
  const bad = ST.cacheBad; const bytes = bad.reduce((a, x) => a + x.bytes, 0);
  const def = { severity: 'confirm', headline: t5('wEvH', bad.length), consequences: [t5('wEvC1', bad.length, sz(bytes)), t5('wEvC2')], actions: { cancel: t5('cancel'), primary: t5('wEvGo') } };
  const w = RP.openWarning(def, { trigger, container: document.body, background: BG() }); layerSync();
  w.promise.then((what) => { layerSync(); if (what === 'confirm') { const n = bad.length; ST.cacheBad = []; afterLayers(() => { toast(t5('evDone', n), { sub: t5('evDoneS'), ms: 5000 }); announce(t5('evDone', n)); }); } });
  return w;
}
function settingsExport() {
  const out = {}; D.rows.forEach((r) => { if ((r.type === 'switch' || r.type === 'select' || r.type === 'slider' || r.type === 'number' || r.type === 'segmented') && r.v !== undefined && r.page !== 'models') out[r.id] = r.v; });
  const text = JSON.stringify({ type: 'risu-settings', note: 'mock file; no keys, no chats', settings: out }, null, 1); const name = 'risu-settings-' + ymd() + '.json';
  try { const u = URL.createObjectURL(new Blob([text], { type: 'application/json' })); const a = document.createElement('a'); a.href = u; a.download = name; a.hidden = true; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 1000); } catch (e) { /* ignore */ }
  toast(t5('seDone'), { sub: name + ' · ' + t5('seNoKeys'), ms: 6000 }); announce(t5('seDone') + ' ' + name); P.writes++;
}
function importChanges(f) {
  return f.changes.map((c) => { const r = R(c[0]); const from = window.__ss1.valueText(r); const keep = r.v; r.v = c[1]; const to = window.__ss1.valueText(r); r.v = keep; return { id: c[0], to: c[1], from: keep, line: t5('siLine', lab(r), from, to) }; });
}
function settingsImportPick(trigger) {
  if (refused()) return null;
  return filePicker({ title: t5('siT'), hint: t5('siHint'), files: SFILES, ok: t5('siOk'), meta: (f) => ' · ' + t5('siMeta', f.changes.length), okLine: (f) => t5('siOkLine', f.name, f.changes.length), onPick: (f) => startSettingsImport(f, trigger) });
}
function startSettingsImport(f, trigger) {
  if (refused()) return null;
  const ch = importChanges(f); const olds = ch.map((c) => c.from);
  const def = { severity: 'confirm', headline: t5('wSiH', ch.length), consequences: ch.map((c) => c.line), detail: [t5('wSiD1'), t5('wSiD2')], actions: { cancel: t5('cancel'), primary: t5('wSiGo') } };
  const task = mkTask('import', f.name, [S('sfile', 'scanning'), S('apply', 'transfer_in', { counted: true, noun: 'p2.noun.setting', write: true })], { background: false, subtitle: () => t5('siSub', ch.length) });
  const undo = () => { ch.forEach((c, i) => { R(c.id).v = olds[i]; }); P.writes++; A.buildIndex(); if (A.S.open && inMine()) repaint(); announce(t5('siUndone')); };
  const spec = { steps: [{ id: 'sfile', ms: 600 }, { id: 'apply', total: ch.length, ticks: ch.length, onTick: (n) => { const c = ch[n - 1]; R(c.id).v = c.to; task.markWritten(1); } }],
    finish: () => ({ added: ch.length, counts: t5('siCounts', f.name, ch.length), skipped: [] }) };
  const flow = openFlow(task, { warning: def, trigger, noBackground: true, onConfirm: () => { setTimeout(() => run(task, spec, { onSettled: () => { A.buildIndex(); P.writes++; } }), 350); } });
  task.on((type) => {
    if (type === 'undo') undo();
    if (type === 'state' && task.state === 'idle' && task.undoOpen()) { const left = task.undoUntil - Date.now(); afterLayers(() => { RP.showUndo({ label: t5('siToast', ch.length), windowMs: Math.max(1500, left), onUndo: () => { task.undone = true; undo(); } }); }); }
  });
  return { task, flow };
}

/* ------------------------------------------------------------------ 데이터·백업 page */
function dataHTML(o) {
  const pr = ST.profile; const sn = ST.snapshots.length; const q = ST.profile.keys;
  const rb = ST.restart.needed ? restartBannerHTML() : '';
  const back = [opRow(R('data.backupMake')), opRow(R('data.restoreFile')),
    sn ? opRow(R('data.restoreSnapshot'), { desc: t5('snDesc', sn), trail: t5('snTrail', sn) }) : opRow(R('data.restoreSnapshot'), { desc: t5('snDescNone'), disabled: true, reason: t5('snNone') })];
  const trans = [opRow(R('data.exportDataset')), opRow(R('data.exportSettings')), `<div class="p5c2-seban">${bannerHTML({ severity: 'notice', headline: t5('wSeH'), consequences: [t5('wSeC')] })}</div>`, opRow(R('data.importSettings')), rowP(R('data.goCharOnImport'))];
  const arch = rv('data.archiveCharacters');
  const c = ST.clean;
  const store = [rowP(R('data.archiveCharacters'))]; if (!arch) store.push(noteLine('p5c2-archoff', 'info', t5('archOff')));
  store.push(c.files ? opRow(R('data.cleanCold'), { desc: t5('cleanDesc', nf(c.files), sz(c.bytes)) }) : opRow(R('data.cleanCold'), { desc: t5('cleanDescNone'), disabled: true, reason: t5('cleanNoneT') }));
  if (PLAT.tauri) store.push(noteLine('', 'info', t5(PLAT.android ? 'noCacheAndroid' : 'noCacheDesktop')));
  else { store.push(opRow(R('data.verifyCache'))); store.push(rowP(R('data.checkCorruption'))); }
  void q;
  return headHTML('data', rb) + chipsHTML('data') + secOpen('data.backup', stitle('data.backup')) + secBody(back) + '</section>' + secOpen('data.transfer', stitle('data.transfer')) + secBody(trans) + '</section>' + secOpen('data.storage', stitle('data.storage')) + secBody(store) + '</section></div>';
}

/* ------------------------------------------------------------------ 고급 page */
const ADV_REQ_A = ['adv.genTime', 'adv.gptVisionQuality', 'adv.requestLocation', 'adv.autoContinueChat', 'adv.autoContinueMinTokens', 'adv.removeIncompleteResponse', 'adv.antiServerOverloads', 'adv.forceProxyAsOpenAI', 'adv.autofillRequestUrl', 'adv.newOAIHandle', 'adv.useSayNothing'];
const ADV_REQ_B = ['adv.useTokenizerCaching', 'adv.auxModelUnderModelSettings', 'adv.disableSeperateParameterChangeOnPresetChange', 'adv.dynamicModelRegistry', 'adv.noWaitForTranslate', 'adv.newImageHandlingBeta', 'adv.removePunctuationHypa'];
const ADV_REQ_C = ['adv.openAIFlexProcessing', 'adv.claude1HourCaching', 'adv.claudeBatching', 'adv.personaNote', 'adv.localNetworkMode', 'adv.localNetworkTimeoutSec'];
const ADV_TROUBLE_A = ['adv.enableDevTools', 'adv.pluginDevelopMode', 'adv.returnCSSError', 'adv.promptInfoInsideChat', 'adv.promptTextInfoInsideChat', 'adv.requestInfo', 'adv.simplifiedToolUse', 'adv.rememberToolUsage', 'adv.keepAlive', 'adv.allowAllExtentionFiles', 'adv.bookmark'];
function banHTML() {
  const r = R('adv.banCharacterset'); const b = ST.banned;
  return `<fieldset class="p5c2-ban" data-row="adv.banCharacterset" data-part="settings-ban-grid"><legend class="p5b-leg" id="l-adv.banCharacterset">${esc(lab(r))}</legend><p class="p5c2-bandesc" id="p5c2-bandesc">${esc(t5('banDesc'))}</p><p class="p5c2-bancount" id="p5c2-bancount" role="status" aria-live="polite">${esc(t5('banCount', b.length))}</p><div class="p5c2-bangrid">` +
    BAN_SCRIPTS.map((s) => { const on = b.indexOf(s[0]) >= 0; return `<label class="p5c2-banopt${on ? ' cur' : ''}" data-part="settings-ban-option"><input type="checkbox" class="p5c-chk" data-p5c2="ban" data-code="${s[0]}" data-fk="ban:${s[0]}"${on ? ' checked' : ''} aria-describedby="p5c2-bandesc"><span class="p5c2-banb"><span class="p5c2-bannm">${esc(pick(s[1], s[2]))}</span><span class="p5c2-bansample" aria-hidden="true">${esc(s[3])}</span></span></label>`; }).join('') + '</div></fieldset>';
}
function customModelsRow() {
  const r = R('adv.customModels');
  return `<div class="row row-link p5c2-oprow" data-row="adv.customModels" data-row-kind="nav" data-part="settings-row"><button type="button" class="rl" data-ctl data-p5c2="goconn" data-fk="go:conn" aria-describedby="d-adv.customModels"><span class="r-text"><span data-part="settings-row-label" class="r-label">${esc(lab(r))}</span><span data-part="settings-row-description" class="r-desc" id="d-adv.customModels">${esc(t5('cmDesc'))}</span></span><span class="rl-end"><span class="rl-txt">${esc(t5('cmGo'))}</span>${ic('chevron-right', 'lg')}</span></button></div>`;
}
function gateBlock(id, secId, title, ids, summary, open, o) {
  const rows = rowsOf(ids, o);
  return `<section class="sec p5c2-gsec" id="sec-${secId}" data-sec="${secId}" data-part="settings-section" aria-labelledby="h-${secId}"><h2 class="sec-h" id="h-${secId}" data-part="settings-section-title" tabindex="-1">${esc(title)}</h2><details class="p5b-details p5c2-gate" id="${id}" data-part="settings-gate-section"${open ? ' open' : ''}><summary class="p5b-sum" data-fk="gate:${id}">${esc(summary)}</summary>${secBody(rows)}</details></section>`;
}
function advHTML(o) {
  const exp = rv('adv.useExperimental'), unrec = rv('adv.showUnrec');
  const head = `<p class="banner p5c2-calm" data-part="settings-banner">${ic('info', 'lg')}<span>${esc(t5('advCalm'))}</span></p>`;
  const only = ['adv.request', 'adv.lorebook', 'adv.chatload', 'adv.display', 'adv.prompt', 'adv.trouble', 'adv.gates'].concat(exp ? ['adv.experimental'] : []).concat(unrec ? ['adv.unrecommended'] : []).concat(['adv.custom']);
  let h = headHTML('adv', head) + chipsHTML('adv', only);
  const req = [h3(t5('reqA'))].concat(rowsOf(ADV_REQ_A, o), [devNote('adv.requestLocation', 'noteReqLoc')], [h3(t5('reqB'))], rowsOf(ADV_REQ_B, o), [h3(t5('reqC'))], rowsOf(ADV_REQ_C, o));
  h += secOpen('adv.request', stitle('adv.request')) + secBody(req) + '</section>';
  h += secOpen('adv.lorebook', stitle('adv.lorebook')) + secBody(rowsOf(['adv.loreBookDepth', 'adv.loreBookToken'], o)) + '</section>';
  h += secOpen('adv.chatload', stitle('adv.chatload')) + secBody(rowsOf(['adv.chatLoadInitialPages', 'adv.chatLoadAdditionalPages'], o)) + '</section>';
  h += secOpen('adv.display', stitle('adv.display')) + secBody(rowsOf(['adv.heightMode', 'adv.imageCompression', 'adv.enableScrollToActiveChar', 'adv.dynamicAssets', 'adv.assetMaxDifference', 'adv.dynamicAssetsEditDisplay', 'adv.realmDirectOpen'], o)) + '</section>';
  h += secOpen('adv.prompt', stitle('adv.prompt')) + secBody(rowsOf(['adv.additionalPrompt', 'adv.descriptionPrefix', 'adv.presetChain'], o).concat([noteLine('', 'info', t5('emoMoved'))])) + '</section>';
  const tr = [opRow(R('adv.reqLogs')), opRow(R('adv.stats')), opRow(R('adv.bugReport'))].concat(rowsOf(ADV_TROUBLE_A, o), [devNote('adv.promptInfoInsideChat', 'noteInfo'), devNote('adv.keepAlive', 'noteKeep')]);
  h += secOpen('adv.trouble', stitle('adv.trouble')) + secBody(tr) + '</section>';
  h += secOpen('adv.gates', stitle('adv.gates')) + secBody(rowsOf(['adv.showUnrec', 'adv.useExperimental', 'adv.proTools', 'adv.easyPanel'], o)) + '</section>';
  const rev = (sec) => !!(o && o.reveal && R(o.reveal) && R(o.reveal).sec === sec);   // a search hit on a row of a closed gate: its section shows with slice 1's explanation of why the row is not there
  if (exp || rev('adv.experimental')) h += gateBlock('p5c2-exp', 'adv.experimental', stitle('adv.experimental'), ['adv.googleClaudeTokenizing', 'adv.automaticCachePoint', 'adv.useExperimentalGoogleTranslator', 'adv.claudeRetrivalCaching'], t5('gateExp'), P.open.exp || !exp, o);
  if (unrec || rev('adv.unrecommended')) h += gateBlock('p5c2-unrec', 'adv.unrecommended', stitle('adv.unrecommended'), ['adv.chainOfThought', 'adv.usePlainFetch', 'adv.showDeprecatedTriggerV1', 'adv.legacyMediaFindings'], t5('gateUnrec'), P.open.unrec || !unrec, o);
  h += secOpen('adv.custom', stitle('adv.custom')) + secBody([banHTML(), customModelsRow()]) + '</section></div>';
  return h;
}
function ban(code, on) {
  const i = ST.banned.indexOf(code); if (on && i < 0) ST.banned.push(code); else if (!on && i >= 0) ST.banned.splice(i, 1); P.writes++;
  const l = $(`.p5c2-banopt input[data-code="${code}"]`); if (l) l.closest('.p5c2-banopt').classList.toggle('cur', on);
  const c = $('#p5c2-bancount'); if (c) c.textContent = t5('banCount', ST.banned.length);
}
function dlgInfo(title, body, fk) {
  const d = A.openDialog({ critical: false, title, body, buttons: [{ id: 'ok', label: t5('close'), primary: true }], initial: '[data-dlg="ok"]', onClose: () => { layerSync(); if (fk) focusFk(fk); } });
  A.openDialog.handlers = {}; return d;
}
function logsSheet() {
  const lines = LOG_LINES.map((l) => `${l[0]}  ${l[1]} ${l[2]}  ${l[3]}${l[4] ? '  ' + nf(l[4]) + ' tok  ' + l[5] + ' s' : '  ' + t5('logRetry')}`).join('\n');
  return dlgInfo(t5('logT'), `<p class="dlg-hint">${esc(t5('logHint'))}</p><pre class="p5c2-log" data-part="settings-log" tabindex="0" aria-label="${esc(t5('logT'))}">${esc(lines)}</pre>`, 'op:logs');
}
function statsSheet() {
  return dlgInfo(t5('stT'), `<table class="p5c2-table" data-part="settings-stats-table"><caption class="sr-only">${esc(t5('stT'))}</caption><thead><tr><th scope="col">${esc(t5('stMonth'))}</th><th scope="col">${esc(t5('stReq'))}</th><th scope="col">${esc(t5('stTok'))}</th></tr></thead><tbody>${STAT_ROWS.map((r) => `<tr><th scope="row">${esc(r[0])}</th><td>${esc(nf(r[1]))}</td><td>${esc(nf(r[2]))}</td></tr>`).join('')}</tbody></table><p class="p5b-note" data-part="settings-note">${ic('info', 'sm')}<span>${esc(t5('stNote'))}</span></p>`, 'op:stats');
}
function bugSheet() {
  const d = A.openDialog({ critical: false, title: t5('bgT'), body: `<p class="dlg-hint">${esc(t5('bgBody'))}</p><ul class="p5c2-list" role="list"><li>${esc(t5('bgC1'))}</li><li>${esc(t5('bgC2'))}</li><li>${esc(t5('bgC3'))}</li></ul>`, buttons: [{ id: 'cancel', label: t5('cancel') }, { id: 'ok', label: t5('bgGo'), primary: true }], initial: '[data-dlg="ok"]', onClose: () => { layerSync(); focusFk('op:bug'); } });
  A.openDialog.handlers = { ok: () => { dispatchAsync(() => { const text = JSON.stringify({ note: 'mock report; keys and addresses removed', settings: {} }); try { const u = URL.createObjectURL(new Blob([text], { type: 'application/json' })); const a = document.createElement('a'); a.href = u; a.download = 'risuai-settings-report.json'; a.hidden = true; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 1000); } catch (e) { /* ignore */ } toast(t5('bgDone'), { sub: t5('bgDoneS'), ms: 6000 }); announce(t5('bgDone')); }); } };
  return d;
}

/* ------------------------------------------------------------------ 언어 (DS-188, DS-189): the app language with the reopen line, and the translation file */
const langApplied = () => (ST.lang.applied || A.S.lang);
function langRowHTML() {
  const r = R('lang.ui'); let h = A.rowHTML(r).replace('<select id="c-lang.ui" data-ctl', '<select id="c-lang.ui" data-ctl data-p5c2="lang" data-fk="lang:ui"');
  if (ST.lang.pending) h += `<p class="p5c2-langnote" id="p5c2-langnote" data-part="settings-lang-pending" data-part-critical role="status" aria-live="polite">${ic('info', 'sm')}<span>${esc(t5('langPending'))}</span><button type="button" class="btn solid accent p5c2-reopen" data-part="settings-lang-reopen" data-part-critical data-p5c2="lang-reopen" data-fk="lang:reopen">${ic('refresh-cw', 'md')}<span>${esc(t5('langReopen'))}</span></button></p>`;
  else if (ST.lang.note) h += `<p class="p5b-note p5c2-langnote ok" id="p5c2-langnote" data-part="settings-note" role="status">${ic('check', 'sm')}<span>${esc(t5('langDemoOnly', langName(ST.lang.applied)))}</span></p>`;
  return h;
}
const langName = (code) => { const l = LANGS_UI.find((x) => x[0] === code); return l ? l[1] : code; };
function langChosen(code) {
  const r = R('lang.ui'); r.v = code; ST.lang.pending = code !== langApplied() ? code : ''; ST.lang.note = false;
  P.writes++; if (A.S.open) repaint('lang:ui'); announce(ST.lang.pending ? t5('langPending') : lab(r) + ': ' + langName(code));
}
function langReopen() {
  const code = ST.lang.pending; if (!code) return; ST.lang.pending = ''; ST.lang.applied = code; P.writes++;
  if (code === 'ko' || code === 'en') { ST.lang.note = false; window.__ss1.setLang(code); announce(t5('langDone', langName(code))); const e = $('#pgTitle'); if (e) e.focus({ preventScroll: true }); }
  else { ST.lang.note = true; repaint('lang:ui'); announce(t5('langDemoOnly', langName(code))); }
}
function translangDownload() {
  try { const u = URL.createObjectURL(new Blob(['{}'], { type: 'application/json' })); const a = document.createElement('a'); a.href = u; a.download = 'lang.json'; a.hidden = true; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 1000); } catch (e) { /* ignore */ }
  toast(t5('tlDone'), { sub: t5('tlDoneS'), ms: 6000 }); announce(t5('tlDone'));
}
function langSection(body) {   // the section 앱 언어: the row (with the reopen line) and the translation file row, in place of slice 1's plain rows
  return langRowHTML() + opRow(R('lang.translang'));
}

/* ------------------------------------------------------------------ events: the controls this slice draws itself (data-p5c2); plain rows (switch, select, text, number) are slice 1's */
function runOp(op, btn) {
  switch (op) {
    case 'backup': backupSheet(btn); break;
    case 'restore-file': restoreFilePick(btn); break;
    case 'snapshots': snapshotSheet(btn); break;
    case 'dataset': startDataset(btn); break;
    case 'settings-export': settingsExport(); break;
    case 'settings-import': settingsImportPick(btn); break;
    case 'clean': startClean(btn); break;
    case 'verify': startVerify(btn); break;
    case 'logs': logsSheet(); break;
    case 'stats': statsSheet(); break;
    case 'bug': bugSheet(); break;
    case 'translang': translangDownload(); break;
    default: break;
  }
}
function onClick(ev) {
  const t = ev.target; if (!(t instanceof Element)) return; const sc = $('#pageScroll'); if (!sc.contains(t)) return;
  const b = t.closest('[data-p5c2]'); if (!b || !sc.contains(b)) return; const k = b.dataset.p5c2;
  if (k === 'ban' || k === 'lang') return;
  ev.preventDefault();
  if (b.getAttribute('aria-disabled') === 'true') { ev.stopPropagation(); const r = b.closest('[data-row]'); const msg = r ? ($('.p5b-rt', r) || {}).textContent : ''; if (msg) announce(msg); return; }
  ev.stopPropagation();
  switch (k) {
    case 'op': runOp(b.dataset.op, b); break;
    case 'restart': doRestart(P.restartFlow); break;
    case 'lang-reopen': langReopen(); break;
    case 'goconn': A.showPage('models', { section: 'models.connections', fromJump: true }); A.S.retRow = 'adv.customModels'; break;
    default: break;
  }
}
function clampNumber(el) {   // the app's bounds hold: a value outside them (or no number) goes to the nearest bound, and the live region says what the bounds are
  const row = el.closest('[data-row]'); const r = row && R(row.dataset.row); if (!mine(r) || r.type !== 'number') return;
  let v = parseFloat(el.value); const lo = r.min, hi = r.max; let bad = false;
  if (isNaN(v)) { v = r.d; bad = true; } else { if (lo !== undefined && v < lo) { v = lo; bad = true; } if (hi !== undefined && v > hi) { v = hi; bad = true; } }
  if (!bad) return;
  r.v = v; el.value = String(v); announce(hi === undefined ? t5('clampMin', lo) : t5('clampRange', lo, hi));
  const dot = $('.dot', row); const ch = A.isChanged(r); row.classList.toggle('changed', ch); if (dot) dot.hidden = !ch;
}
function onChange(ev) { P.defer = true; try { onChange0(ev); } finally { P.defer = false; } }
function onChange0(ev) {
  const el = ev.target; const sc = $('#pageScroll'); if (!(el instanceof Element) || !sc.contains(el)) return;
  if (el.id === 'c-lang.ui') { ev.stopPropagation(); langChosen(el.value); return; }
  if (el.type === 'number') { clampNumber(el); return; }
  const k = el.dataset ? el.dataset.p5c2 : ''; if (!k) return;
  if (k === 'ban') { ev.stopPropagation(); ban(el.dataset.code, el.checked); announce(t5('banCount', ST.banned.length)); }
}
function bindPage5c2() {
  const sc = $('#pageScroll');
  [['click', onClick], ['change', onChange]].forEach((p) => sc.addEventListener(p[0], p[1], true));
  sc.addEventListener('toggle', (ev) => { if (ev.target.id === 'p5c2-exp') P.open.exp = ev.target.open; else if (ev.target.id === 'p5c2-unrec') P.open.unrec = ev.target.open; }, true);
  new MutationObserver(() => { layerSync(); }).observe(document.body, { childList: true });
}

/* ------------------------------------------------------------------ hooks called by slice1.js (wrapping slice 2's to 5c-1's) */
const H = {};
['boot', 'pageHTML', 'rendered', 'nav', 'sectionBody', 'rowChanged', 'lang', 'title', 'demoPanel', 'afterInit', 'ready'].forEach((k) => { H[k] = X[k]; });
X.pageHTML = (pid, o) => {
  if (pid === 'data') return dataHTML(o || {});
  if (pid === 'adv') return advHTML(o || {});
  return H.pageHTML ? H.pageHTML(pid, o) : null;
};
X.sectionBody = (s, body, o) => {
  if (s.id === 'lang.app') return langSection(body);
  return H.sectionBody ? H.sectionBody(s, body, o) : undefined;
};
const REFRESH = new Set(['data.archiveCharacters']);
X.rowChanged = (r) => {
  if (H.rowChanged) H.rowChanged(r);
  if (!mine(r) && r.id !== 'data.goCharOnImport') return;
  P.writes++;
  if (REFRESH.has(r.id) && A.S.open) setTimeout(() => A.refreshPage(true), 0);
};
X.rendered = (pg) => { if (H.rendered) H.rendered(pg); };
X.nav = (pid, o) => {
  if (H.nav) H.nav(pid, o);
  const r = o.row; const sid = (r && r.sec) || o.section;
  if (sid === 'adv.experimental') P.open.exp = true; if (sid === 'adv.unrecommended') P.open.unrec = true;
};
X.lang = (l) => { if (H.lang) H.lang(l); document.title = K[l].title; };
X.title = (l) => K[l].title;
X.demoPanel = (p) => {
  if (H.demoPanel) H.demoPanel(p);
  const h = document.createElement('div'); h.className = 'ps-demo p5c2-demo';
  const opt = (arr, cur, label) => arr.map((v) => `<option value="${v}"${v === cur ? ' selected' : ''}>${esc(label(v))}</option>`).join('');
  h.innerHTML = `<h3 class="d-h">${esc(t5('demo5c2'))}</h3><label class="d-row"><span>${esc(t5('demoSet'))}</span><select id="d5dSet">${opt(DC.SETS, DC.SET5D, (v) => t5('set_' + v))}</select></label>` +
    `<label class="d-row"><span>${esc(t5('demoNext'))}</span><select id="d5dNext">${opt(['', 'ok', 'skips', 'over4g', 'fail', 'unknown'], '', (v) => t5('next_' + (v || 'default')))}</select></label>` +
    `<label class="d-row"><span>${esc(t5('demoLock'))}</span><span class="sw" data-part="settings-toggle"><input type="checkbox" role="switch" id="d5dLock"${ST.lock.held ? ' checked' : ''}><span class="sw-ui" aria-hidden="true"></span></span></label>` +
    `<label class="d-row"><span>${esc(t5('demoState'))}</span><select id="d5dState">${STATES5C2.map((s) => `<option>${s}</option>`).join('')}</select></label><div class="d-btns"><button type="button" data-part="settings-button" class="btn solid" id="d5dGo"><span>${esc(t5('demoGo'))}</span></button></div>`;
  p.appendChild(h);
  const reload = (kv) => { const u = new URL(location.href); Object.keys(kv).forEach((k) => { if (kv[k] === '') u.searchParams.delete(k); else u.searchParams.set(k, kv[k]); }); location.href = u.toString(); };
  $('#d5dSet', h).onchange = (e) => reload({ set: e.target.value });
  $('#d5dNext', h).onchange = (e) => { ST.sim.next = e.target.value; };
  $('#d5dLock', h).onchange = (e) => { ST.lock.held = e.target.checked; };
  $('#d5dGo', h).onclick = () => { runState5c2($('#d5dState', h).value); };
};
X.afterInit = (o) => { if (H.afterInit) H.afterInit(o); };
X.ready = () => { if (H.ready) H.ready(); window.__ss5c2Ready = true; };
X.boot = (api) => {
  if (H.boot) H.boot(api);
  A = api; B = window.__ss2; document.title = K[A.S.lang].title;
  Object.keys(ICONS5D).forEach((n) => { if (ICONS5D[n] && !A.ICONS[n]) A.ICONS[n] = ICONS5D[n]; });
  R('lang.ui').v = A.S.lang;
  P.booted = true; bindPage5c2(); window.__ss5c2 = API();
  const st = Q.get('state'); if (st && STATES5C2.indexOf(st) >= 0) setTimeout(() => runState5c2(st), 0);
};

/* ------------------------------------------------------------------ states (SLICE5C2_SPEC 7.3) */
const STATES5C2 = ['da-backup-sheet', 'da-bin-caution', 'da-rtb-run', 'da-run-cancel-hidden', 'da-backup-done', 'da-partial-confirm', 'da-restore-warning', 'da-restore-run', 'da-restore-unknown', 'da-restore-done', 'da-snapshots', 'da-clean-confirm', 'da-verify-table', 'da-settings-import', 'da-settings-undo', 'da-busy-refused', 'da-archive-off',
  'ad-groups', 'ad-experimental', 'ad-unrecommended', 'ad-diagnostics-logs', 'ad-diagnostics-stats', 'ad-custom-models-undo', 'ad-banchars',
  'la-change-pending', 'la-translang', 'la-deepl-web',
  'se-persist-none', 'se-streaming-none', 'se-archive-moved', 'se-emotionprompt'];
function resetState() {
  P.runSeq++; release(); P.hold = null; P.held = null; P.tasks = []; P.flow = null; P.task = null; P.restartFlow = null;
  try { RP.closeAll(); } catch (e) { /* none open */ }
  if (A.openDialog.cur) { try { A.openDialog.cur('cancel'); } catch (e) { /* closed */ } }
  try { B.hideToast(); } catch (e) { /* no toast yet */ }
  document.body.classList.remove('dlg-open');
  DC.reset(DC.SET5D); P.open.exp = false; P.open.unrec = false; CFG.speed = DC.SPEED; ST.lang = { pending: '', applied: '', note: false };
  R('lang.ui').v = A.S.lang; R('display.reducedMotion').v = 'system'; A.setLowPower(Q.get('lowpower') === '1'); A.applyFlags();
}
async function until(f, ms) { const t0 = Date.now(); while (Date.now() - t0 < (ms || 6000)) { if (f()) return true; await sleep(15); } return false; }
async function runState5c2(name) {
  window.__ss5c2Ready = false;
  const openS = (opt) => { if (!A.S.open) A.openSettings($('#oSettings'), Object.assign({ noFocus: true }, opt || {})); };
  resetState();
  const page = (pid, opt) => { openS({ page: pid }); A.showPage(pid, Object.assign({ noAnim: true, keepFocus: true, force: true }, opt || {})); };
  const settle = () => sleep(60);
  const trig = (op) => $(`#pageScroll [data-op="${op}"]`);
  const q = Q.get('q');
  const fast = () => { CFG.speed = 0.02; };
  switch (name) {
    case 'da-backup-sheet': page('data'); await settle(); backupSheet(trig('backup')); await settle(); break;
    case 'da-bin-caution': page('data'); await settle(); startBackup('bin', 'full', trig('backup')); await until(() => $('[data-part="pattern-warn-root"]')); break;
    case 'da-rtb-run': page('data'); await settle(); P.hold = { step: 'prep', at: 0 }; startBackup('rtb', 'full', trig('backup')); await until(() => P.held); await settle(); break;
    case 'da-run-cancel-hidden': page('data'); await settle(); P.hold = { step: 'assets', at: 7 }; startBackup('rtb', 'full', trig('backup')); await until(() => P.held, 12000); await until(() => !$('[data-part="pattern-task-cancel"]') || $('[data-part="pattern-task-cancel"]').hidden, 4000); await settle(); break;
    case 'da-backup-done': page('data'); await settle(); fast(); ST.sim.next = 'skips'; startBackup('rtb', 'full', trig('backup')); await until(() => $('[data-part="pattern-task-result"]'), 20000); await settle(); break;
    case 'da-partial-confirm': page('data'); await settle(); startBackup('rtb', 'part', trig('backup')); await until(() => $('[data-part="pattern-warn-root"]')); break;
    case 'da-restore-warning': page('data'); await settle(); startRestoreFile(FILES[0], trig('restore-file')); await until(() => $('[data-part="pattern-warn-root"]')); break;
    case 'da-restore-run': page('data'); await settle(); P.hold = { step: 'tabs', at: 0 }; startRestoreFile(FILES[0], trig('restore-file')); await until(() => $('[data-part="pattern-warn-primary"], [data-part="pattern-warn-action-primary"]')); { const b = $('[data-part="pattern-warn-action-primary"]'); await sleep(400); if (b) b.click(); } await until(() => P.held, 12000); await settle(); break;
    case 'da-restore-unknown': page('data'); await settle(); fast(); ST.sim.next = 'unknown'; startRestoreFile(FILES[0], trig('restore-file')); await until(() => $('[data-part="pattern-warn-action-primary"]')); await sleep(400); { const b = $('[data-part="pattern-warn-action-primary"]'); if (b) b.click(); } await until(() => $('[data-part="pattern-task-result"]'), 25000); await settle(); break;
    case 'da-restore-done': page('data'); await settle(); fast(); startRestoreFile(FILES[0], trig('restore-file')); await until(() => $('[data-part="pattern-warn-action-primary"]')); await sleep(400); { const b = $('[data-part="pattern-warn-action-primary"]'); if (b) b.click(); } await until(() => $('[data-part="pattern-task-result"]') && $('[data-part="settings-restart"]'), 25000); await settle(); break;
    case 'da-snapshots': page('data'); await settle(); snapshotSheet(trig('snapshots')); await settle(); break;
    case 'da-clean-confirm': page('data', { section: 'data.storage' }); await settle(); startClean(trig('clean')); await until(() => $('[data-part="pattern-warn-root"]')); break;
    case 'da-verify-table': page('data', { section: 'data.storage' }); await settle(); mismatchSheet(trig('verify')); await settle(); break;
    case 'da-settings-import': page('data', { section: 'data.transfer' }); await settle(); startSettingsImport(SFILES[0], trig('settings-import')); await until(() => $('[data-part="pattern-warn-root"]')); break;
    case 'da-settings-undo': page('data', { section: 'data.transfer' }); await settle(); fast(); startSettingsImport(SFILES[0], trig('settings-import')); await until(() => $('[data-part="pattern-warn-action-primary"]')); await sleep(400); { const b = $('[data-part="pattern-warn-action-primary"]'); if (b) b.click(); } await until(() => $('[data-part="pattern-task-undo-import"]'), 20000); await settle(); break;
    case 'da-busy-refused': page('data'); await settle(); P.hold = { step: 'read', at: 4 }; { const r = startDataset(trig('dataset')); await until(() => P.held, 12000); r.flow.toBackground(); await sleep(400); } runOp('backup', trig('backup')); await settle(); break;
    case 'da-archive-off': page('data', { section: 'data.storage' }); await settle(); R('data.archiveCharacters').v = false; A.refreshPage(); await settle(); break;
    case 'ad-groups': page('adv'); await settle(); break;
    case 'ad-experimental': R('adv.useExperimental').v = true; P.open.exp = true; page('adv', { section: 'adv.experimental' }); await settle(); break;
    case 'ad-unrecommended': R('adv.showUnrec').v = true; P.open.unrec = true; page('adv', { section: 'adv.unrecommended' }); await settle(); break;
    case 'ad-diagnostics-logs': page('adv', { section: 'adv.trouble' }); await settle(); logsSheet(); await settle(); break;
    case 'ad-diagnostics-stats': page('adv', { section: 'adv.trouble' }); await settle(); statsSheet(); await settle(); break;
    case 'ad-custom-models-undo': page('adv', { section: 'adv.custom' }); await settle(); break;
    case 'ad-banchars': ST.banned = ['Hani', 'Hira', 'Kana']; page('adv', { section: 'adv.custom' }); await settle(); { const e = $('.p5c2-ban'); if (e) e.scrollIntoView({ block: 'start' }); } break;
    case 'la-change-pending': page('lang'); await settle(); langChosen('de'); await settle(); break;
    case 'la-translang': page('lang'); await settle(); { const e = $('[data-row="lang.translang"]'); if (e) e.scrollIntoView({ block: 'center' }); } break;
    case 'la-deepl-web': R('lang.translator').v = 'ko'; R('lang.translatorType').v = 'deepl'; page('lang', { section: 'lang.translate' }); await settle(); break;
    case 'se-persist-none': openS({ page: 'data', noFocus: true }); window.__ss1.setQuery(q || 'persist'); break;
    case 'se-streaming-none': openS({ page: 'adv', noFocus: true }); window.__ss1.setQuery(q || 'streamingDisplayOptimizationMode'); break;
    case 'se-archive-moved': openS({ page: 'adv', noFocus: true }); window.__ss1.setQuery(q || 'archiveCharacters'); break;
    case 'se-emotionprompt': openS({ page: 'adv', noFocus: true }); window.__ss1.setQuery(q || 'emotionPrompt2'); break;
    default: break;
  }
  await sleep(60); window.__ss5c2Ready = name;
}

/* ------------------------------------------------------------------ public API (checks, the demo panel and reviewers) */
function API() {
  return {
    P, ST, K, PK, CFG, DC, t5, A, B, D, RP, STATES: STATES5C2, runState: runState5c2, repaint, mine, release, busy, refused,
    backupSheet, startBackup, backupSpec, backupName, restoreFilePick, startRestoreFile, snapshotSheet, startRestoreSnapshot, startDataset, startClean, startVerify, mismatchSheet, evictConfirm,
    settingsExport, settingsImportPick, startSettingsImport, importChanges, logsSheet, statsSheet, bugSheet, langChosen, langReopen, translangDownload, ban, doRestart,
    defBin, defPartial, defRestoreFile, defRestoreSnap, defClean, defKeys, defMemory, defSalvage, restoreFileSteps, backupSteps, leftOutItems, nf, relTime, fmtDate,
    runOp, run, scen,
  };
}
void until; void sleep;
})();
