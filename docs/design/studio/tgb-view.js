/* Studio slice 2 mockup, part 2 (rev 2): text view, panel preview, combined view, demo states (?state=tg-...) and the test hook window.__st2. Synthetic. */
(function () {
  'use strict';
  const ST = window.__st1, A = ST.api, S = A.S, TG = window.TGX, C = window.TGCore;
  const { t, nm, ic, esc, $, $$, announce } = A;
  const LH = 20;
  const ownerName = (m, i) => m.oa.a.names[i] || '';

  /* ------------------------------------------------------------------ text view */
  function lintOf(m) {
    const out = [], po = m.oa.po, rows = m.rows; let open = null;
    rows.forEach((r) => {
      if (r.kind === 'bad') out.push({ i: r.i, sev: 'warning', msg: t('tgUnreadable') + ' · ' + t(r.reason === 'caption' ? 'tgWhyCaption' : 'tgWhyKeyLabel') });
      if (r.extra && r.kind !== 'blank') out.push({ i: r.i, sev: 'info', msg: t('tgLintExtra') });
      if (r.unknownType) out.push({ i: r.i, sev: 'info', msg: t('tgLintUnknown', { type: r.type }) });
      if (C.isValue(r) && po.dupKeys.indexOf(r.key) >= 0) out.push({ i: r.i, sev: 'error', msg: t('tgDupKey') + ' · ' + r.key });
      if (r.kind === 'select' && r.opts.length < 2) out.push({ i: r.i, sev: 'warning', msg: t('tgFewOpts', { name: r.label }) });
      if (C.isValue(r) && po.shared[r.i]) { const sh = po.shared[r.i]; out.push({ i: r.i, sev: sh.kindDiff ? 'warning' : 'info', msg: t(sh.kindDiff ? 'tgSharedDiff' : 'tgShared', { owner: sh.owners.map((i) => ownerName(m, i)).join(', ') }) }); }
      if (r.kind === 'group') { if (open) out.push({ i: r.i, sev: 'info', msg: t('tgLintNest') }); open = r; }
      else if (r.kind === 'groupEnd') { if (!open) out.push({ i: r.i, sev: 'info', msg: t('tgLintOrphanEnd') }); open = null; }
    });
    m.st.nodes.forEach((n) => { if (n.type === 'group' && n.children.length === 0) out.push({ i: n.row.i, sev: 'info', msg: t('tgEmptyGroup') }); });
    if (po.spill) out.push({ i: po.spill.row.i, sev: po.spill.hard ? 'error' : 'warning', msg: po.spill.hard ? t('tgSpill') : t('tgUnclosed') });
    if (po.split) out.push({ i: po.split.row.i, sev: 'info', msg: t('tgSplitGroup') });
    return out.sort((a, b) => a.i - b.i);
  }
  const sevIc = { error: 'circle-alert', warning: 'triangle-alert', info: 'info' };
  TG.lintOf = lintOf;
  TG.textHtml = (m) => {
    const ex = [['check', t('tgHelpCheck')], ['select', t('tgHelpSelect')], ['text', t('tgHelpText')], ['textarea', t('tgHelpArea')], ['group', t('tgHelpGroup')], ['divider', t('tgHelpDiv')], ['caption', t('tgHelpCap')]];
    const code = { check: 'combat=전투 모드', select: 'mood=분위기=select=차분,신비,장난', text: 'nick=호칭=text', textarea: 'memo=메모=textarea', group: 'extra=추가 설정=group  …  extra_end=추가 설정=groupEnd', divider: '=구분 제목=divider', caption: '=설명 글=caption' };
    return '<div class="tgt" id="tgText" data-part="studio-tgb-text"><details class="tgt-help" id="tgHelp" data-part="studio-tgb-help"><summary data-part="studio-tgb-help-summary">' + ic('circle-help', 16) + '<span>' + esc(t('tgHelpTitle')) + '</span></summary><p class="hint" data-part="studio-tgb-help-lead">' + esc(t('tgHelpLead')) + '</p><dl class="tgt-hl" data-part="studio-tgb-help-list">' +
      ex.map(([k, d]) => '<dt data-part="studio-tgb-help-term">' + ic(TG.KICON[k], 14) + esc(TG.kname(k)) + '</dt><dd data-part="studio-tgb-help-desc"><code>' + esc(code[k]) + '</code><span>' + esc(d) + '</span></dd>').join('') + '</dl></details>' +
      '<div class="tgt-wrap" id="tgWrap" data-part="studio-tgb-text-wrap"><div class="tgt-gut" id="tgGut" data-part="studio-tgb-gutter" aria-hidden="true"></div><textarea id="tgTa" data-part="studio-tgb-text-input" class="tgt-ta" spellcheck="false" wrap="off" autocomplete="off" autocapitalize="off" aria-label="' + esc(t('fToggleDefs')) + '" aria-describedby="tgTaHint tgLint"></textarea></div>' +
      '<p class="hint" id="tgTaHint" data-part="studio-tgb-text-hint">' + esc(t('tgTextHint')) + '</p><div class="tgt-lintw" data-part="studio-tgb-lint"><h3 data-part="studio-tgb-lint-title">' + esc(t('tgLintTitle')) + ' <span id="tgLintN"></span></h3><ul class="tgt-lint" id="tgLint" data-part="studio-tgb-lint-list" aria-label="' + esc(t('tgLintTitle')) + '"></ul></div></div>';
  };
  function sizeTa() { const ta = $('#tgTa'); if (!ta) return; const n = ta.value.split('\n').length; ta.style.height = Math.max(n, 8) * LH + 18 + 'px'; const g = $('#tgGut'); if (g) g.style.height = ta.style.height; }
  function renderGut(m, lint) {
    const g = $('#tgGut'); if (!g) return; const marks = {}; lint.forEach((l) => { const c = marks[l.i]; if (!c || (l.sev === 'error') || (l.sev === 'warning' && c !== 'error')) marks[l.i] = l.sev; });
    const n = m.text.split('\n').length; let h = '';
    for (let i = 0; i < n; i++) h += '<div class="gl' + (marks[i] ? ' ' + marks[i] : '') + '" data-l="' + i + '" data-part="studio-tgb-gutter-line"' + (marks[i] ? ' data-sev="' + marks[i] + '"' : '') + '><span class="gm" data-part="studio-tgb-gutter-mark">' + (marks[i] ? ic(sevIc[marks[i]], 12) : '') + '</span><span class="gn" data-part="studio-tgb-gutter-num">' + (i + 1) + '</span></div>';
    g.innerHTML = h;
  }
  function renderLint(m, lint) {
    const ul = $('#tgLint'); if (!ul) return; $('#tgLintN').textContent = lint.length ? '(' + lint.length + ')' : '';
    ul.innerHTML = lint.length ? lint.map((l) => '<li><button type="button" class="tgt-li ' + l.sev + '" data-part="studio-tgb-lint-item" data-sev="' + l.sev + '" data-line="' + l.i + '">' + ic(sevIc[l.sev], 14) + '<span class="ln" data-part="studio-tgb-lint-line">' + esc(t('tgLineN', { n: l.i + 1 })) + '</span><span class="lm" data-part="studio-tgb-lint-msg">' + esc(l.msg) + '</span></button></li>').join('') : '<li class="tgt-ok" data-part="studio-tgb-lint-ok">' + ic('circle-check', 14) + '<span>' + esc(t('tgLintNone')) + '</span></li>';
  }
  function refreshText(keepTa) {
    const f = TG.cur(); if (!f) return; const m = TG.model(f.it, f.o), lint = lintOf(m), ta = $('#tgTa'); if (!ta) return;
    if (!keepTa && ta.value !== m.text) ta.value = m.text;
    sizeTa(); renderGut(m, lint); renderLint(m, lint); TG.lastLint = lint;
  }
  TG.viewHook = () => refreshText(document.activeElement === $('#tgTa'));
  let textRaf = 0;
  const schedText = () => { if (textRaf) return; textRaf = requestAnimationFrame(() => { textRaf = 0; if (TG.view === 'text') TG.viewHook(); }); };
  TG.afterText = (m) => {
    const hp = $('#tgHelp'); if (hp) hp.addEventListener('toggle', () => hp.toggleAttribute('data-open', hp.open));
    const ta = $('#tgTa'); if (!ta) return; ta.value = m.text; refreshText(false);
    ta.addEventListener('input', () => {
      const f = TG.cur(); if (!f) return; const val = ta.value;
      A.edit(f.o.id, t('tgStepText'), () => { f.it.f.defs = val; }, { key: f.it.id + '.tgtext' });
      caret(); schedText(); TG.schedPreview(); TG.renderBanners(); TG.schedSecondary();   // M-7: typing never rebuilds the tree or the preview synchronously
    });
    ta.addEventListener('change', () => TG.refreshNotice());   // M-3: a rename or reorder typed here raises the same question when the field is left
    const caret = () => { const f = TG.cur(); if (!f) return; const id = TG.ident(f.it); const line = ta.value.slice(0, ta.selectionStart).split('\n').length - 1; const u = id.uids[line]; if (u) { TG.sel[f.it.id] = u; TG.textCaretUid = u; } };
    ['keyup', 'click', 'focus'].forEach((ev) => ta.addEventListener(ev, caret));
  };
  TG.gotoLine = (uid, focus) => {
    const f = TG.cur(); const ta = $('#tgTa'); if (!f || !ta || !uid) return; const id = TG.ident(f.it); const i = id.uids.indexOf(uid); if (i < 0) return;
    const lines = ta.value.split('\n'); let pos = 0; for (let k = 0; k < i; k++) pos += lines[k].length + 1;
    ta.setSelectionRange(pos, pos); const w = $('#tgWrap'); if (w) { const top = i * LH; if (top < w.scrollTop || top > w.scrollTop + w.clientHeight - 3 * LH) w.scrollTop = Math.max(0, top - 2 * LH); }
    if (focus) ta.focus({ preventScroll: true });
  };
  $('#formHost').addEventListener('click', (e) => {
    const b = e.target.closest('.tgt-li'); if (!b) return; const f = TG.cur(); if (!f) return; const id = TG.ident(f.it); const u = id.uids[Number(b.dataset.line)]; if (u) { TG.sel[f.it.id] = u; TG.gotoLine(u, true); }
  });

  /* ------------------------------------------------------------------ panel preview (SLICE2_SPEC section 8) */
  const OWNER_TAG = { preset: 'tgSrcPreset', module: 'tgSrcModule', char: 'tgSrcChar' };
  function pvRow(e, ctx) {
    const r = e.row, key = r.key, cls = 'pv-row' + (ctx.curOwner === e.oi ? ' cur' : '') + (ctx.selI === r.i && ctx.selOi === e.oi ? ' sel' : '');
    const isCur = ctx.curOwner === e.oi, rowPart = ' data-part="studio-tgb-preview-row" data-kind="' + e.type + '"' + (isCur ? ' data-current' : '') + (ctx.selI === r.i && ctx.selOi === e.oi ? ' data-selected' : '');
    const data = ' data-oi="' + e.oi + '" data-line="' + r.i + '"', tip = ' title="' + esc(t('tgPvKeyTip', { key })) + '"';
    const kline = ctx.dupLabels.has(r.label) && key ? '<small class="pv-k" data-part="studio-tgb-preview-key">' + esc(key) + '</small>' : '';
    if (e.type === 'divider') return '<div class="pv-div' + (ctx.curOwner === e.oi ? ' cur' : '') + '" role="separator"' + data + ' data-part="studio-tgb-preview-divider"' + (isCur ? ' data-current' : '') + '>' + (r.label ? '<span>' + esc(r.label) + '</span>' : '') + '</div>';
    if (e.type === 'caption') return '<p class="pv-cap' + (ctx.curOwner === e.oi ? ' cur' : '') + '"' + data + ' data-part="studio-tgb-preview-caption"' + (isCur ? ' data-current' : '') + '>' + esc(r.label) + '</p>';
    if (e.type === 'select') {
      const unset = TG.pv[key] == null, v = Number(TG.pv[key] || 0); const short = r.opts.length <= 3 && r.opts.every((o) => [...o].length <= 6);   // m-9: an unset select is blank (the app reads '')
      if (short) return '<div class="' + cls + ' pv-selr" role="radiogroup" aria-label="' + esc(r.label) + '"' + data + rowPart + tip + '><span class="pv-l" data-part="studio-tgb-preview-label">' + esc(r.label) + kline + '</span><div class="pv-seg" data-part="studio-tgb-preview-seg">' + r.opts.map((o, i) => '<button type="button" role="radio" class="btn" data-part="studio-tgb-preview-seg-button" aria-checked="' + (!unset && i === v) + '"' + (!unset && i === v ? ' data-checked' : '') + ' data-k="' + esc(key) + '" data-v="' + i + '"' + ((unset ? i === 0 : i === v) ? '' : ' tabindex="-1"') + '>' + esc(o) + '</button>').join('') + '</div></div>';
      return '<label class="' + cls + ' pv-selr"' + data + rowPart + tip + '><span class="pv-l" data-part="studio-tgb-preview-label">' + esc(r.label) + kline + '</span><select data-part="studio-tgb-preview-input" data-k="' + esc(key) + '" aria-label="' + esc(r.label) + '">' + (unset ? '<option value="" selected>' + esc(t('tgPvUnset')) + '</option>' : '') + r.opts.map((o, i) => '<option value="' + i + '"' + (!unset && i === v ? ' selected' : '') + '>' + esc(o) + '</option>').join('') + '</select></label>';
    }
    if (e.type === 'text') return '<label class="' + cls + '"' + data + rowPart + tip + '><span class="pv-l" data-part="studio-tgb-preview-label">' + esc(r.label) + kline + '</span><input type="text" data-part="studio-tgb-preview-input" data-k="' + esc(key) + '" value="' + esc(TG.pv[key] || '') + '" aria-label="' + esc(r.label) + '" autocomplete="off"></label>';
    if (e.type === 'textarea') return '<label class="' + cls + ' pv-area"' + data + rowPart + tip + '><span class="pv-l" data-part="studio-tgb-preview-label">' + esc(r.label) + kline + '</span><textarea rows="2" data-part="studio-tgb-preview-input" data-k="' + esc(key) + '" aria-label="' + esc(r.label) + '">' + esc(TG.pv[key] || '') + '</textarea></label>';
    return '<label class="' + cls + ' sw"' + data + rowPart + tip + '><span class="lbl pv-l" data-part="studio-tgb-preview-label">' + esc(r.label) + kline + '</span><input type="checkbox" data-part="studio-tgb-preview-input" data-k="' + esc(key) + '"' + (TG.pv[key] === '1' ? ' checked' : '') + '><span class="sw-ui" data-part="studio-tgb-preview-switch"></span></label>';
  }
  function pvHtmlFor(joined, owners, ctx) {
    const top = C.visible(joined); let h = '', run = null;
    const labels = {}; const count = (e) => { if (e.type === 'group') C.visible(e.children).forEach(count); else if (e.type !== 'divider' && e.type !== 'caption') labels[e.row.label] = (labels[e.row.label] || 0) + 1; }; top.forEach(count);
    ctx.dupLabels = new Set(Object.keys(labels).filter((k) => labels[k] > 1));   // n-3: identical labels show their key under the label
    const closeRun = () => { if (run !== null) { h += '</section>'; run = null; } };
    top.forEach((e) => {
      if (run !== e.oi) {
        closeRun(); run = e.oi; const po = owners[e.oi], o = A.O(po.id);
        h += '<section class="pv-sec' + (ctx.curOwner === e.oi ? ' cur' : '') + '" data-oi="' + e.oi + '" data-part="studio-tgb-preview-section"' + (ctx.curOwner === e.oi ? ' data-current' : '') + '><h3 class="pv-sh" data-part="studio-tgb-preview-section-head">' + ic(A.ownerIcon(o), 14) + '<span class="n" data-part="studio-tgb-preview-section-name">' + esc(po.name) + '</span><span class="tag" data-part="studio-tgb-preview-section-tag">' + esc(t(OWNER_TAG[o.type] || 'tgSrcModule')) + '</span></h3>';
      }
      if (e.type === 'group') {
        const gk = owners[e.oi].id + ':' + e.row.i, kids = C.visible(e.children);
        const open = TG.pvOpen.has(gk) || (ctx.selOi != null && e.children.some((c) => c.oi === ctx.selOi && c.row.i === ctx.selI)) || (e.oi === ctx.selOi && e.row.i === ctx.selI);
        h += '<div class="pv-grp" data-part="studio-tgb-preview-group"><button type="button" class="pv-gh" data-part="studio-tgb-preview-group-head" aria-expanded="' + open + '"' + (open ? ' data-open' : '') + ' data-gk="' + esc(gk) + '" data-oi="' + e.oi + '" data-line="' + e.row.i + '">' + ic(open ? 'chevron-down' : 'chevron-right', 14) + '<span>' + esc(e.row.label || t('tgNoName')) + '</span><small>' + esc(t('tgSumGroup', { n: e.children.length })) + '</small></button><div class="pv-gk" data-part="studio-tgb-preview-group-body"' + (open ? ' data-open' : '') + (open ? '' : ' hidden') + '>' + kids.map((c) => pvRow(c, ctx)).join('') + '</div></div>';
      } else h += pvRow(e, ctx);
    });
    closeRun(); return h;
  }
  TG.renderPreview = function () {
    const host = $('#panelPreview'); if (!host) return; const f = TG.cur();
    if (!f && S.view.type !== 'tgmerged') { host.innerHTML = ''; return; }
    const scope = f ? TG.scope : 'all'; let an, curOwner = null, selOi = null, selI = null, bad = 0;
    if (scope === 'owner') { an = TG.solo(f.o); curOwner = 0; const m = TG.model(f.it, f.o); const r = TG.selRow(m); if (r) { selOi = 0; selI = r.i; } bad = an.bad[0]; }
    else { an = TG.analysis(); if (f) { curOwner = an.owners.findIndex((x) => x.id === f.o.id); const m = TG.model(f.it, f.o); const r = TG.selRow(m); if (r && curOwner >= 0) { selOi = curOwner; selI = r.i; } } bad = an.bad.reduce((a, b) => a + b, 0); }
    const body = pvHtmlFor(an.joined, an.owners, { curOwner: scope === 'all' ? curOwner : null, selOi, selI });
    const focusKey = document.activeElement && host.contains(document.activeElement) ? (document.activeElement.dataset.k || document.activeElement.dataset.gk || '') : null;
    host.innerHTML = '<div class="panel-head" data-part="studio-tgb-preview-head"><h2 class="panel-title" id="pv-title" tabindex="-1" data-part="studio-tgb-preview-title">' + esc(t('tabPreview')) + '</h2><span class="hint" data-part="studio-tgb-preview-owner">' + esc(f ? nm(f.o.name) : t('merged')) + '</span></div><div class="tframe pv-frame" data-part="studio-tgb-preview-frame">' +
      (f ? '<div class="seg pv-scope" data-part="studio-tgb-preview-scope" role="group" aria-label="' + esc(t('tgScopeLbl')) + '"><button type="button" class="btn sm" data-part="studio-tgb-preview-scope-button" data-pv="owner" aria-pressed="' + (scope === 'owner') + '"' + (scope === 'owner' ? ' data-active' : '') + '>' + esc(t('tgScopeOwner')) + '</button><button type="button" class="btn sm" data-part="studio-tgb-preview-scope-button" data-pv="all" aria-pressed="' + (scope === 'all') + '"' + (scope === 'all' ? ' data-active' : '') + '>' + esc(t('tgScopeAll')) + '</button></div>' : '') +
      '<p class="hint pv-note" data-part="studio-tgb-preview-note">' + ic('flask-conical', 12) + ' ' + esc(t('tgPreviewNote')) + '</p>' + (bad ? '<p class="hint pv-bad" data-part="studio-tgb-preview-warn">' + ic('triangle-alert', 12) + ' ' + esc(t('tgPreviewBad', { n: bad })) + '</p>' : '') +
      '<div class="pv-panel" id="pvPanel" data-part="studio-tgb-preview-panel">' + (body || '<p class="pv-none" data-part="studio-tgb-preview-none">' + esc(t('tgPreviewNone')) + '</p>') + '</div></div>';
    if (focusKey) { const e = host.querySelector('[data-k="' + focusKey + '"],[data-gk="' + focusKey + '"]'); if (e) { TG.pvBusy = true; try { e.focus({ preventScroll: true }); } finally { TG.pvBusy = false; } } }
  };
  function pvSelect(oi, line, scopeAll) {
    const f = TG.cur(); const an = scopeAll ? TG.analysis() : (f ? TG.solo(f.o) : TG.analysis()); const po = an.owners[oi]; if (!po) return;
    const o = A.O(po.id), it = TG.ownerItem(o); if (!it) return; const id = TG.ident(it); const u = id.uids[line]; if (!u) return;
    if (f && f.it.id === it.id && TG.sel[it.id] === u) return;
    TG.sel[it.id] = u;
    if (!f || f.o.id !== o.id) A.openItem(it.id, { focus: false });
    else if (TG.view === 'list') { TG.selectRow(u, {}); const e = $('#tgr-' + u); if (e) { e.scrollIntoView({ block: 'nearest' }); } }
    else TG.gotoLine(u, false);
    if (TG.view === 'list') { const e = $('#tgr-' + u); if (e) e.scrollIntoView({ block: 'nearest' }); }
    TG.renderPreview();
    announce(t('tgPvSelected', { name: TG.labelOf(TG.rowByUid(TG.model(it, o), u) || { kind: 'check', label: '' }) }));
  }
  const pvHost = $('#panelPreview');
  pvHost.addEventListener('click', (e) => {
    const sc = e.target.closest('[data-pv]'); if (sc) { TG.scope = sc.dataset.pv; TG.renderPreview(); const b = $('#panelPreview [data-pv="' + TG.scope + '"]'); if (b) b.focus(); return; }
    const gh = e.target.closest('.pv-gh'); if (gh) { const k = gh.dataset.gk; if (TG.pvOpen.has(k)) TG.pvOpen.delete(k); else TG.pvOpen.add(k); const sel = gh.getAttribute('aria-expanded') === 'true'; gh.setAttribute('aria-expanded', String(!sel)); gh.querySelector('svg').outerHTML = ic(sel ? 'chevron-right' : 'chevron-down', 14); gh.nextElementSibling.hidden = sel; gh.toggleAttribute('data-open', !sel); gh.nextElementSibling.toggleAttribute('data-open', !sel); pvSelect(Number(gh.dataset.oi), Number(gh.dataset.line), TG.scope === 'all'); return; }
    const seg = e.target.closest('.pv-seg .btn'); if (seg) { TG.pv[seg.dataset.k] = String(seg.dataset.v); TG.renderPreview(); }
  });
  pvHost.addEventListener('change', (e) => {
    const el = e.target.closest('[data-k]'); if (!el) return; const k = el.dataset.k;
    if (el.type === 'checkbox') TG.pv[k] = el.checked ? '1' : '0'; else if (el.tagName === 'SELECT' && el.value === '') delete TG.pv[k]; else TG.pv[k] = el.value;
    refreshSharedValues(k);
  });
  pvHost.addEventListener('input', (e) => { const el = e.target.closest('input[type="text"][data-k], textarea[data-k]'); if (el) { TG.pv[el.dataset.k] = el.value; } });
  pvHost.addEventListener('focusin', (e) => { if (TG.pvBusy) return; const row = e.target.closest('.pv-row, .pv-grp .pv-gh'); if (row && row.dataset.oi != null && !row.classList.contains('pv-gh')) { const oi = Number(row.dataset.oi), line = Number(row.dataset.line); const f = TG.cur(); const scopeAll = (f ? TG.scope : 'all') === 'all'; if (!(f && TG.sel[f.it.id] && !scopeAll && TG.selRow(TG.model(f.it, f.o)) && TG.selRow(TG.model(f.it, f.o)).i === line)) pvSelect(oi, line, scopeAll); } });
  pvHost.addEventListener('keydown', (e) => {
    const b = e.target.closest('.pv-seg .btn'); if (!b) return;
    if (['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].indexOf(e.key) < 0) return; e.preventDefault();
    const sib = $$('.btn', b.parentElement), i = sib.indexOf(b), n = sib[(i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : sib.length - 1)) % sib.length]; TG.pv[n.dataset.k] = String(n.dataset.v); TG.renderPreview(); const nb = $('#panelPreview .pv-seg .btn[data-k="' + n.dataset.k + '"][data-v="' + n.dataset.v + '"]'); if (nb) nb.focus();
  });
  function refreshSharedValues(k) { $$('#panelPreview [data-k="' + CSS.escape(k) + '"]').forEach((el) => { if (el.type === 'checkbox') el.checked = TG.pv[k] === '1'; else if (el.tagName === 'SELECT' || el.type === 'text' || el.tagName === 'TEXTAREA') el.value = TG.pv[k] == null ? '' : TG.pv[k]; }); }
  ST.ext.beforeSide = () => { const show = !!TG.cur() || S.view.type === 'tgmerged'; const tab = $('#tabPreview'); tab.hidden = !show; if (!show && S.sideTab === 'preview') S.sideTab = 'problems'; if (show && S.view.type === 'tgmerged' && S.sideTab === 'problems') S.sideTab = 'preview'; };
  ST.ext.afterSide = () => { if (S.sideTab === 'preview' && TG.renderPreview) TG.renderPreview(); };
  ST.ext.onTab = (name) => { if (name === 'preview') TG.renderPreview(); };

  /* ------------------------------------------------------------------ combined view (SLICE2_SPEC section 7) */
  function mergedEntries(po, names) {
    const st = C.structure(po.rows); let h = '';
    const line = (r, lv) => {
      if (r.kind === 'bad') return '';
      const valued = C.isValue(r), sh = valued && po.shared[r.i], dup = valued && po.dupKeys.indexOf(r.key) >= 0;
      return '<li class="tgm-r lv' + lv + '" data-part="studio-tgb-merged-item" data-level="' + lv + '"><button type="button" class="tgm-row" data-part="studio-tgb-merged-row" data-open="' + esc(po.id) + '" data-line="' + r.i + '">' + ic(TG.KICON[r.kind === 'groupEnd' ? 'bad' : r.kind] || 'dot', 16) + '<span class="l" data-part="studio-tgb-merged-label">' + esc(TG.labelOf(r)) + '</span>' + (valued ? '<small class="k" data-part="studio-tgb-merged-key">' + esc(r.key) + '</small>' : '') +
        (dup ? '<span class="tgr-flag err" data-part="studio-tgb-row-flag" data-tone="err">' + ic('circle-alert', 13) + '<span>' + esc(t('tgDupKey')) + '</span></span>' : '') +
        (sh ? '<span class="tgr-flag ' + (sh.kindDiff ? 'warn' : 'info') + '" data-part="studio-tgb-row-flag" data-tone="' + (sh.kindDiff ? 'warn' : 'info') + '">' + ic('link', 13) + '<span>' + esc(t(sh.kindDiff ? 'tgSharedDiff' : 'tgShared', { owner: sh.owners.map((i) => names[i]).join(', ') })) + '</span></span>' : '') + '</button></li>';
    };
    st.nodes.forEach((n) => { if (n.type === 'row') h += line(n.row, 0); else { h += line(n.row, 0); n.children.forEach((c) => { h += line(c.row, 1); }); } });
    return h;
  }
  function mergedSection(po, idx, o, off, names) {
    const bad = po.rows.filter((r) => r.kind === 'bad').length; const spill = po.spill;
    return '<section class="tgm-sec' + (off ? ' off' : '') + '" data-oid="' + esc(po.id) + '" data-part="studio-tgb-merged-section"' + (off ? ' data-off' : '') + '><h2 class="tgm-h" data-part="studio-tgb-merged-head">' + (off ? '' : '<span class="ord" data-part="studio-tgb-merged-order" aria-label="' + esc(t('mergedOrdered')) + ' ' + (idx + 1) + '">' + (idx + 1) + '</span>') + ic(A.ownerIcon(o), 16) + '<span class="n" data-part="studio-tgb-merged-name">' + esc(po.name) + '</span><span class="tag" data-part="studio-tgb-merged-tag">' + esc(t(OWNER_TAG[o.type] || 'tgSrcModule')) + '</span>' + (off ? '<span class="tag off" data-part="studio-tgb-merged-tag" data-tone="off">' + esc(t('offTag')) + '</span>' : '') + '</h2>' +
      (spill ? '<div class="tgb-banner err" role="alert" data-part="studio-tgb-alert" data-part-critical data-kind="open-group" data-severity="' + (spill.hard ? 'error' : 'warning') + '">' + ic(spill.hard ? 'circle-alert' : 'triangle-alert', 18) + '<span class="t" data-part="studio-tgb-alert-text">' + esc(spill.hard ? t('tgSpill') : t('tgUnclosed')) + '</span><button type="button" class="btn solid" data-part="studio-tgb-alert-action" data-tg-act="close-group" data-oid="' + esc(po.id) + '">' + ic('check', 16) + '<span>' + esc(t('tgCloseGroup')) + '</span></button></div>' : '') +
      (po.split ? '<div class="tgb-banner info" data-part="studio-tgb-banner" data-kind="info">' + ic('info', 16) + '<span class="t" data-part="studio-tgb-banner-text">' + esc(t('tgSplitGroup')) + '</span></div>' : '') +
      (po.swallowed && !off ? '<div class="tgb-banner info" data-part="studio-tgb-banner" data-kind="info">' + ic('info', 16) + '<span class="t" data-part="studio-tgb-banner-text">' + esc(t('tgSwallowed')) + '</span></div>' : '') +
      '<ul class="tgm-list" data-part="studio-tgb-merged-list" role="list">' + mergedEntries(po, names) + '</ul>' + (bad ? '<p class="hint" data-part="studio-tgb-merged-note">' + ic('triangle-alert', 12) + ' ' + esc(t('tgBadList', { n: bad })) + '</p>' : '') + '</section>';
  }
  TG.mergedHtml = () => {
    const an = TG.analysis(); const owners = TG.ctxOwners();
    let h = '<div class="tgm" data-part="studio-tgb-merged"><div class="tgm-top" data-part="studio-tgb-merged-top"><p class="hint" data-part="studio-tgb-merged-lead">' + esc(t('tgMergedLead')) + '</p><button type="button" class="btn solid" data-part="studio-tgb-merged-preview" data-tg-act="pv-all">' + ic('eye', 16) + '<span>' + esc(t('tgPreviewAll')) + '</span></button></div>';
    if (!owners.length) h += '<p class="tgm-none" data-part="studio-tgb-merged-none">' + esc(t('tgEmpty')) + '</p>';
    an.owners.forEach((po, i) => { h += mergedSection(po, i, A.O(po.id), false, an.names); });
    const offs = A.ownerList().filter((o) => o.type === 'module' && !A.moduleActive(o) && TG.ownerItem(o));
    if (offs.length) { h += '<h3 class="tgm-offh" data-part="studio-tgb-merged-offhead">' + esc(t('tgOffModules')) + '</h3>'; offs.forEach((o) => { const v = TG.solo(o); h += mergedSection(v.owners[0], 0, o, true, v.names); }); }
    return h + '</div>';
  };
  ST.ext.renderMerged = (host) => { host.classList.add('tgb-host'); host.innerHTML = TG.mergedHtml(); };
  TG.renderMergedNow = () => { const host = $('#formHost'); if (S.view.type === 'tgmerged') { const y = $('#main').scrollTop; host.innerHTML = TG.mergedHtml(); $('#main').scrollTop = y; } };
  $('#formHost').addEventListener('click', (e) => {
    if (S.view.type !== 'tgmerged') return;
    const row = e.target.closest('.tgm-row');
    if (row) { const o = A.O(row.dataset.open), it = TG.ownerItem(o); if (!it) return; const id = TG.ident(it); TG.sel[it.id] = id.uids[Number(row.dataset.line)]; TG.view = 'list'; A.openItem(it.id, { focus: true, user: true }); return; }
    if (e.target.closest('[data-tg-act="pv-all"]')) { TG.scope = 'all'; A.openSide('preview', e.target.closest('button')); return; }
  });

  /* ------------------------------------------------------------------ demo states and the test hook (no fixed sleeps: a state waits for two frames) */
  const STATES = ST.STATES, tick = () => Promise.resolve();   // no requestAnimationFrame in a state script: a hidden tab never fires it (re-review harness note); every step below is synchronous and ends in syncNow()
  const begin = async (o) => { ST.enter(Object.assign({ from: 'chat', noFocus: true }, o || {})); await tick(); };
  const lang = (ko, en) => (S.lang === 'en' ? en : ko);
  const openTg = async (id) => { await begin(); ST.openItem(id || 'p1.tg', { focus: false }); await tick(); };
  const setText = (id, text) => { const f = A.findItem(id); f.it.f.defs = text; TG.rebase(id); };
  const selKey = (key) => { const m = TG.curModel(); const r = m.rows.find((x) => x.key === key && x.kind !== 'blank'); if (r) { TG.selectRow(TG.uidOf(m, r), { force: true }); return r; } return null; };
  const selKind = (kind) => { const m = TG.curModel(); const r = m.rows.find((x) => x.kind === kind); if (r) { TG.selectRow(TG.uidOf(m, r), { force: true }); return r; } return null; };
  const showEditor = (r) => { if (r && TG.edMode() !== 'inline') TG.openEditor(TG.uidOf(TG.curModel(), r), false); };
  const typeInto = (sel, val) => { const el = $(sel); el.focus(); el.value = val; el.dispatchEvent(new Event('input', { bubbles: true })); TG.flushPending(); return el; };
  const blur = (sel) => { const el = $(sel); el.dispatchEvent(new Event('change', { bubbles: true })); el.blur(); };
  const editorState = (kind, pickKey) => async () => { await openTg('p1.tg'); const r = pickKey ? selKey(pickKey) : selKind(kind); await tick(); showEditor(r); await tick(); };
  const renameKeyUi = async (to) => { const d = $('#tgAdv'); if (d) d.open = true; $('#tgf-key').focus(); typeInto('#tgf-key', to); blur('#tgf-key'); await tick(); };
  const noticeBtn = (which) => $('#tgBanners .tgn [data-tg-act="' + which + '"], #tgEd .tgn [data-tg-act="' + which + '"]');
  Object.assign(STATES, {
    'tg-list': async () => { await openTg('p1.tg'); },
    'tg-list-char': async () => { await openTg('c1.tg'); },
    'tg-group-expanded': async () => { await openTg('p1.tg'); const m = TG.curModel(); const g = m.st.nodes.find((n) => n.type === 'group'); TG.selectRow(TG.uidOf(m, g.children[0].row), {}); },
    'tg-group-collapsed': async () => { await openTg('p1.tg'); const m = TG.curModel(); const g = m.st.nodes.find((n) => n.type === 'group'); TG.collapsed.add(TG.uidOf(m, g.row)); TG.renderList(); },
    'tg-picker': async () => { await openTg('p1.tg'); TG.openPicker({}, $('#tgAddEnd')); await tick(); },
    'tg-editor-check': editorState('check', 'longform'), 'tg-editor-select': editorState('select', 'reply_len'), 'tg-editor-text': editorState('text'), 'tg-editor-textarea': editorState('textarea'),
    'tg-editor-group': editorState('group'), 'tg-editor-divider': editorState('divider'), 'tg-editor-caption': editorState('caption'),
    'tg-key-auto': async () => { await openTg('c1.tg'); TG.addRow('check', {}); await tick(); typeInto('#tgEd [data-tg="label"]', 'Combat mode'); await tick(); },
    'tg-key-auto-ko': async () => { await openTg('c1.tg'); TG.addRow('check', {}); await tick(); typeInto('#tgEd [data-tg="label"]', '숲길 안내'); await tick(); const d = $('#tgAdv'); if (d) d.open = true; },
    'tg-key-edited': async () => { await openTg('c1.tg'); TG.addRow('check', {}); await tick(); typeInto('#tgEd [data-tg="label"]', 'Combat mode'); const d = $('#tgAdv'); d.open = true; typeInto('#tgf-key', 'fight'); typeInto('#tgEd [data-tg="label"]', 'Combat mode hard'); await tick(); },
    'tg-err-eq': async () => { await openTg('p1.tg'); const r = selKey('longform'); await tick(); showEditor(r); await tick(); typeInto('#tgEd [data-tg="label"]', 'a=b'); await tick(); },
    'tg-err-comma': async () => { await openTg('p1.tg'); const r = selKey('reply_len'); await tick(); showEditor(r); await tick(); typeInto('#tgEd [data-tg="opt"][data-oi="1"]', 'a,b'); await tick(); },
    'tg-dup-key': async () => { await openTg('p1.tg'); const f = A.findItem('p1.tg'); setText('p1.tg', f.it.f.defs + '\nlongform=' + lang('또 다른 긴 답변', 'Another long reply')); A.renderAll(); await tick(); selKey('longform'); },
    'tg-select-warn': async () => { await openTg('c1.tg'); setText('c1.tg', 'mood=' + lang('분위기', 'Mood') + '=select=' + lang('차분', 'calm') + '\n' + A.findItem('c1.tg').it.f.defs); A.renderAll(); await tick(); const r = selKey('mood'); showEditor(r); await tick(); },
    'tg-unreadable': async () => { await openTg('c1.tg'); const m = TG.curModel(); const r = m.rows.find((x) => x.kind === 'bad'); TG.selectRow(TG.uidOf(m, r), { force: true }); showEditor(r); await tick(); },
    'tg-unreadable-caption': async () => { await openTg('c1.tg'); const m = TG.curModel(); const r = m.rows.find((x) => x.kind === 'bad' && x.reason === 'caption'); TG.selectRow(TG.uidOf(m, r), { force: true }); showEditor(r); await tick(); },
    'tg-orphan-end': async () => { await openTg('c1.tg'); setText('c1.tg', A.findItem('c1.tg').it.f.defs + '\nghost_end=Ghost=groupEnd'); A.renderAll(); await tick(); const m = TG.curModel(); const r = m.rows.find((x) => x.kind === 'groupEnd'); TG.selectRow(TG.uidOf(m, r), { force: true }); showEditor(r); await tick(); },
    'tg-empty-group': async () => { await openTg('c1.tg'); setText('c1.tg', A.findItem('c1.tg').it.f.defs + '\nvoid=' + lang('빈 묶음', 'Empty group') + '=group\nvoid_end=' + lang('빈 묶음', 'Empty group') + '=groupEnd'); A.renderAll(); await tick(); },
    'tg-text-lint': async () => { await openTg('c1.tg'); TG.setView('text'); await tick(); },
    'tg-text-lint-long': async () => { await openTg('m4.tg'); TG.setView('text'); await tick(); },
    'tg-paste': async () => { await openTg('c1.tg'); TG.pasteLines('trust=' + lang('신뢰도', 'Trust') + '\npace=' + lang('속도', 'Pace') + '=select=' + lang('느림,보통,빠름', 'slow,normal,fast'), {}); await tick(); },
    'tg-paste-sheet': async () => { await openTg('c1.tg'); TG.openPicker({}, $('#tgAddEnd')); await tick(); $('#sheet [data-k="paste"]').click(); await tick(); },
    'tg-carry-notice': async () => { await openTg('c1.tg'); const r = selKey('combat'); await tick(); showEditor(r); await tick(); await renameKeyUi('battle'); },
    'tg-carry-yes': async () => { await STATES['tg-carry-notice'](); noticeBtn('carry-yes').click(); await tick(); },
    'tg-carry-no': async () => { await STATES['tg-carry-notice'](); noticeBtn('carry-no').click(); await tick(); },
    'tg-carry-undo': async () => { await STATES['tg-carry-yes'](); A.undoOwner('c1'); await tick(); },
    'tg-carry-again': async () => { await STATES['tg-carry-yes'](); const r = selKey('battle'); await tick(); showEditor(r); await tick(); await renameKeyUi('fight'); },
    'tg-carry-refs-updated': async () => { await STATES['tg-carry-notice'](); $('#tgBanners .tgn [data-tg-act="refs-update"], #tgEd .tgn [data-tg-act="refs-update"]').click(); await tick(); },
    'tg-carry-type': async () => { await openTg('c1.tg'); const r = selKey('lantern'); await tick(); showEditor(r); await tick(); const s = $('#tgf-type'); s.value = 'select'; s.dispatchEvent(new Event('change', { bubbles: true })); await tick(); },
    'tg-carry-options': async () => { await openTg('c1.tg'); const r = selKey('mood'); await tick(); showEditor(r); await tick(); TG.optOp('down', 0); await tick(); },
    'tg-carry-text': async () => { await openTg('c1.tg'); TG.setView('text'); await tick(); const ta = $('#tgTa'); ta.value = ta.value.replace('combat=', 'battle=').replace('차분,신비,장난', '장난,차분,신비').replace('calm,mystic,playful', 'playful,calm,mystic'); ta.dispatchEvent(new Event('input', { bubbles: true })); ta.dispatchEvent(new Event('change', { bubbles: true })); await tick(); },
    'tg-carry-drop': async () => { await openTg('c1.tg'); const r = selKey('lantern'); await tick(); showEditor(r); await tick(); const s = $('#tgf-type'); s.value = 'divider'; s.dispatchEvent(new Event('change', { bubbles: true })); await tick(); },
    'tg-move-alt': async () => { await openTg('p1.tg'); const r = selKey('reply_len'); TG.moveNode(TG.uidOf(TG.curModel(), r), 1); await tick(); },
    'tg-move-menu': async () => { await openTg('p1.tg'); const r = selKey('longform'); TG.openRowMenu(TG.uidOf(TG.curModel(), r), $('#tgr-' + TG.uidOf(TG.curModel(), r) + ' .tgr-more')); await tick(); },
    'tg-move-drag': async () => { await openTg('p1.tg'); const m = TG.curModel(); const a = m.rows.find((x) => x.key === 'longform'), b = m.rows.find((x) => x.key === 'reply_len'); TG.dropMove(TG.uidOf(m, a), TG.uidOf(m, b), 'after'); await tick(); },
    'tg-group-in-group': async () => { await openTg('p1.tg'); const m = TG.curModel(); const g = m.st.nodes.filter((n) => n.type === 'group'); TG.dropMove(TG.uidOf(m, g[1].row), TG.uidOf(m, g[0].children[0].row), 'after'); await tick(); },
    'tg-delete': async () => { await openTg('p1.tg'); const r = selKey('longform'); TG.deleteNode(TG.uidOf(TG.curModel(), r)); await tick(); },
    'tg-combined-shared': async () => { await begin(); ST.openItem('p1.tg', { focus: false }); await tick(); TG.openMerged(); await tick(); },
    'tg-combined-spill': async () => { await begin(); setText('m1.tg', A.findItem('m1.tg').it.f.defs + '\nopen_group=' + lang('열린 묶음', 'Open group') + '=group'); ST.openItem('m1.tg', { focus: false }); await tick(); TG.openMerged(); await tick(); const b = $('#formHost .tgb-banner.err'); if (b) b.scrollIntoView({ block: 'center' }); },
    'tg-spill-owner': async () => { await begin(); setText('m1.tg', A.findItem('m1.tg').it.f.defs + '\nopen_group=' + lang('열린 묶음', 'Open group') + '=group'); ST.openItem('m1.tg', { focus: false }); await tick(); },
    'tg-preview-owner': async () => { await openTg('p1.tg'); TG.scope = 'owner'; if (S.layout !== 'wide') A.openSide('preview'); TG.renderPreview(); await tick(); },
    'tg-preview-all': async () => { await openTg('p1.tg'); TG.scope = 'all'; if (S.layout !== 'wide') A.openSide('preview'); TG.renderPreview(); await tick(); },
    'tg-preview-sandbox': async () => { await openTg('p1.tg'); TG.scope = 'all'; if (S.layout !== 'wide') A.openSide('preview'); TG.renderPreview(); await tick(); const cb = $('#panelPreview input[type="checkbox"]'); if (cb) { cb.click(); } const sg = $('#panelPreview .pv-seg .btn[data-v="2"]'); if (sg) sg.click(); await tick(); },
    'tg-preview-select': async () => { await openTg('p1.tg'); TG.scope = 'all'; if (S.layout !== 'wide') A.openSide('preview'); TG.renderPreview(); await tick(); const row = $('#panelPreview .pv-row[data-oi="1"] input, #panelPreview .pv-row[data-oi="1"] button'); if (row) row.focus(); await tick(); },
    'tg-empty': async () => { await begin(); setText('m2.tg', ''); ST.openItem('m2.tg', { focus: false }); await tick(); },
    'tg-roundtrip': async () => { await begin(); setText('m2.tg', D2().FX[S.lang].roundtrip); ST.openItem('m2.tg', { focus: false }); await tick(); selKey('a'); TG.setField('label', lang('바뀐 이름', 'Changed name')); TG.setView('text'); await tick(); }
  });
  const D2 = () => window.StudioData2 || {};
  // everything a frame or a timer would do later, done now, so ?state= is complete in a hidden tab too
  TG.syncNow = () => { clearTimeout(TG.secT); if (TG.pvRaf) { cancelAnimationFrame(TG.pvRaf); TG.pvRaf = 0; } TG.flushPending(); A.renderTree(); A.refreshProblemsOnly(); if (TG.cur()) TG.renderBanners(); if (TG.view === 'text' && TG.viewHook) TG.viewHook(); if (TG.previewVisible() || S.view.type === 'tgmerged') TG.renderPreview(); };
  Object.keys(STATES).filter((k) => k.indexOf('tg-') === 0).forEach((k) => { const f = STATES[k]; STATES[k] = async () => { await f(); TG.syncNow(); }; });
  window.__st2 = Object.assign(TG, { states: Object.keys(STATES).filter((k) => k.indexOf('tg-') === 0), STATES });
})();
