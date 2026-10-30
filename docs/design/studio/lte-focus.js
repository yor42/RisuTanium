/* Studio slice 3, part 2: focus mode (full-screen editor for one field), find and replace, revert to when opened, preview pane. Synthetic. */
(function () {
  'use strict';
  const ST = window.__st1, A = ST.api, S = A.S, C = window.LTCore, LT = window.LTX;
  const { t, nm, ic, esc, $, $$, announce } = A;
  const FM = LT.FM = { open: false, F: null, G: null, key: '', opener: null, opened: '', pv: false, tab: 'edit', find: false, repl: false, hits: [], cur: -1, cs: false, layer: null };
  let root = null;
  const phoneLike = () => innerWidth < 1024;
  /* DD-149: the revert button puts the text back to how it was when focus mode opened (it replaces what was written since): critical, own part, no protected children (an icon only). */
  const btnPart = (id) => (id === 'ltfRevert' ? ' data-part="studio-lt-revert" data-part-critical' : id === 'ltfMore' ? ' data-part="studio-lt-focus-more"' : ' data-part="studio-lt-focus-tool"');
  const btn = (id, icon, label, extra) => '<button type="button" class="btn sm ' + (extra || '') + '"' + btnPart(id) + ' id="' + id + '"' + (id === 'ltfMore' ? ' aria-haspopup="menu"' : '') + ' aria-label="' + esc(label) + '" title="' + esc(label) + '">' + ic(icon, 18) + '</button>';
  function build() {
    if (root) return root;
    root = document.createElement('div'); root.id = 'ltFocus'; root.className = 'lt-focus'; root.setAttribute('data-part', 'studio-lt-focus'); root.hidden = true; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-labelledby', 'ltfTitle');
    root.innerHTML = '<header class="ltf-hdr" data-part="studio-lt-focus-header"><button type="button" class="btn" data-part="studio-lt-focus-back" id="ltfBack"></button><div class="ltf-ttl" data-part="studio-lt-focus-titles"><h2 id="ltfTitle" data-part="studio-lt-focus-title"></h2><div class="ltf-crumb" data-part="studio-lt-focus-crumb" id="ltfCrumb"></div></div><span class="status ltf-status" data-part="studio-lt-focus-status" id="ltfStatus" data-state="saved"></span>' +
      '<button type="button" class="btn sm" data-part="studio-lt-focus-undo" id="ltfUndo" data-ic="undo-2"></button><button type="button" class="btn sm" data-part="studio-lt-focus-redo" id="ltfRedo" data-ic="redo-2"></button></header>' +
      '<div class="ltf-tools" data-part="studio-lt-focus-tools" id="ltfToolRow"><div class="ltf-btns" data-part="studio-lt-focus-toolbar" id="ltfTools" role="toolbar"></div><span class="ltf-sp"></span><span class="lt-tokw" id="ltfTok"></span><div class="ltf-btns" data-part="studio-lt-focus-toolbar-end" id="ltfToolsR"></div></div>' +
      '<div class="ltf-find" data-part="studio-lt-find" id="ltfFind" role="search" hidden><div class="ltf-frow" data-part="studio-lt-find-row"><input type="text" data-part="studio-lt-find-input" id="ltfQ" autocomplete="off" spellcheck="false" enterkeyhint="search"><span class="ltf-cnt" data-part="studio-lt-find-count" id="ltfCnt" role="status" aria-live="polite"></span><button type="button" class="btn sm" data-part="studio-lt-find-step" data-step="prev" id="ltfPrev"></button><button type="button" class="btn sm" data-part="studio-lt-find-step" data-step="next" id="ltfNext"></button><button type="button" class="btn sm txt" data-part="studio-lt-find-toggle" data-toggle="case" id="ltfCase" aria-pressed="false">Aa</button><button type="button" class="btn sm" data-part="studio-lt-find-toggle" data-toggle="replace" id="ltfRT" aria-pressed="false" aria-controls="ltfRrow"></button><button type="button" class="btn sm" data-part="studio-lt-find-close" id="ltfFClose"></button></div><div class="ltf-frow" data-part="studio-lt-find-replace-row" id="ltfRrow" hidden><input type="text" data-part="studio-lt-find-replace-input" id="ltfR" autocomplete="off" spellcheck="false"><button type="button" class="btn sm" data-part="studio-lt-find-replace" id="ltfRep1"></button><button type="button" class="btn sm" data-part="studio-lt-replace-all" data-part-critical id="ltfRepAll"></button></div></div>' +
      '<div class="ltf-tabs seg" data-part="studio-lt-focus-tabs" id="ltfTabs" role="group" hidden><button type="button" class="btn sm txt" data-part="studio-lt-focus-tab" data-ltf-tab="edit" aria-pressed="true"></button><button type="button" class="btn sm txt" data-part="studio-lt-focus-tab" data-ltf-tab="preview" aria-pressed="false"></button></div>' +
      '<div class="ltf-body" data-part="studio-lt-focus-body" id="ltfBody"><div class="ltf-ed" data-part="studio-lt-focus-editor" id="ltfEd"></div><div class="ltf-pv" data-part="studio-lt-focus-preview" id="ltfPv" hidden><div class="ltf-pvh" data-part="studio-lt-focus-preview-head"><h3 class="sb-h" data-part="studio-lt-focus-preview-title" id="ltfPvT"></h3><button type="button" class="btn sm" data-part="studio-lt-focus-preview-run" id="ltfPvRun"></button></div><div class="sb-out" data-part="studio-lt-focus-preview-output" id="ltfPvOut" tabindex="0"></div></div></div>';
    $('#studio').appendChild(root);
    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
    new MutationObserver(syncHdr).observe($('#saveStatus'), { attributes: true, childList: true, subtree: true, characterData: true });
    ['#undoBtn', '#redoBtn'].forEach((s) => new MutationObserver(syncHdr).observe($(s), { attributes: true }));
    return root;
  }
  function labels() {
    const set = (s, k) => { const e = $(s, root); e.setAttribute('aria-label', t(k)); e.title = t(k); };
    $('#ltfBack', root).innerHTML = ic(phoneLike() ? 'arrow-left' : 'minimize-2', 20); set('#ltfBack', phoneLike() ? 'ltfBack' : 'ltFocusClose');
    $('#ltfTools', root).setAttribute('aria-label', t('ltfTools'));
    $('#ltfTools', root).innerHTML = btn('ltfFindBtn', 'search', t('ltFind')) + (FM.G && FM.G.flags.cbs ? btn('ltfMacro', 'braces', t('ltInsertMacro')) + btn('ltfPvBtn', 'eye', t('ltPvToggle')) : '') ; $('#ltfToolsR', root).innerHTML = btn('ltfRevert', 'rotate-ccw', t('ltRevert'), 'ltf-rev') + btn('ltfMore', 'ellipsis', t('ltMore'), 'ltf-more');   // under 600 px the revert button lives in the more menu so the row fits
    $('#ltfPrev', root).innerHTML = ic('chevron-up', 16); set('#ltfPrev', 'ltPrevM'); $('#ltfNext', root).innerHTML = ic('chevron-down', 16); set('#ltfNext', 'ltNext');
    $('#ltfCase', root).setAttribute('aria-label', t('ltCase')); $('#ltfCase', root).title = t('ltCase');
    $('#ltfRT', root).innerHTML = ic('replace', 16); set('#ltfRT', 'ltToggleReplace'); $('#ltfFClose', root).innerHTML = ic('x', 16); set('#ltfFClose', 'ltFindClose');
    $('#ltfQ', root).placeholder = t('ltFindPh'); $('#ltfQ', root).setAttribute('aria-label', t('ltFindPh')); $('#ltfR', root).placeholder = t('ltReplPh'); $('#ltfR', root).setAttribute('aria-label', t('ltReplPh'));
    $('#ltfRep1', root).innerHTML = ic('replace', 16); set('#ltfRep1', 'ltReplOne'); $('#ltfRepAll', root).innerHTML = ic('list', 16); set('#ltfRepAll', 'ltReplaceAll');
    const tabs = $$('[data-ltf-tab]', root); tabs[0].textContent = t('ltfEditTab'); tabs[1].textContent = t('ltfPrevTab');
    $('#ltfPvT', root).innerHTML = ic('eye', 14) + '<span>' + esc(t('sbOutTitle')) + '</span>'; $('#ltfPvRun', root).innerHTML = ic('refresh-cw', 16); set('#ltfPvRun', 'sbRefresh');
    $('#ltfUndo', root).innerHTML = ic('undo-2', 18); $('#ltfRedo', root).innerHTML = ic('redo-2', 18);
  }
  function syncHdr() {
    if (!root || !FM.open) return; const s = $('#saveStatus'), m = $('#ltfStatus', root); m.innerHTML = s.innerHTML; m.dataset.state = s.dataset.state || ''; m.setAttribute('aria-label', s.textContent.trim()); m.title = s.textContent.trim();
    [['#undoBtn', '#ltfUndo'], ['#redoBtn', '#ltfRedo']].forEach(([a, b]) => { const x = $(a), y = $(b, root); y.setAttribute('aria-disabled', x.getAttribute('aria-disabled') || 'false'); y.setAttribute('aria-label', x.getAttribute('aria-label') || ''); y.title = x.title || ''; });
  }
  const origin = () => LT.fields.get(FM.key) || null;
  function openFocus(F, opener, opts) {
    if (FM.open) return; opts = opts || {}; LT.flushAll(); LT.acClose(); LT.closeTip(); build();
    FM.open = true; FM.F = F; FM.key = F.key; FM.opener = opener || F.ta; FM.opened = F.ta.value; FM.pv = false; FM.tab = 'edit'; FM.find = false; FM.repl = false; FM.hits = []; FM.cur = -1;
    const ed = $('#ltfEd', root); ed.innerHTML = '<textarea id="ltfTa" aria-label="' + esc(F.label) + '"></textarea>';
    const ta = $('#ltfTa', root);
    const G = FM.G = LT.mountField(ta, {
      key: 'ltf', mode: F.mode, label: F.label, noHead: true, chipHost: $('#ltfTok', root), fill: true, noGrip: true, keep: true, value: F.ta.value, card: F.o.card, field: F.o.field, itemId: F.o.itemId,
      set: (val, o) => { const O = origin(); if (!O) return; O.ta.value = val; O.text = val; O.o.set(val, o); },
      onTok: null
    });
    G.wrap.classList.add('lt-fillw'); LT.sync(G.wrap);
    const f = F.o.itemId && A.findItem(F.o.itemId); $('#ltfTitle', root).textContent = F.label || ''; $('#ltfCrumb', root).innerHTML = f ? '<span class="tag" data-part="studio-lt-focus-crumb-tag">' + ic(A.ownerIcon(f.o), 12) + esc(nm(f.o.name)) + '</span><span data-part="studio-lt-focus-crumb-name">' + esc(nm(f.it.name) || A.kindName(f.it.kind)) + '</span>' : '';
    labels(); syncHdr(); G.chipHost && LT.drawChip(G);
    root.hidden = false; void root.offsetWidth; root.classList.add('open'); layout();
    FM.layer = { kind: 'ltfocus', modal: true, close: () => closeFocus(true) }; A.pushLayer(FM.layer);
    LT.fit(G); LT.render(G, { force: true }); ta.focus({ preventScroll: true }); ta.setSelectionRange(Math.min(F.ta.selectionStart || 0, ta.value.length), Math.min(F.ta.selectionEnd || 0, ta.value.length));
    LT.countNow(G, true);
    if (opts.find) openFind(false);
    announce(t('ltFocus') + ': ' + (F.label || ''));
  }
  function closeFocus(restore) {
    if (!FM.open) return; const G = FM.G; if (G) LT.flush(G); FM.open = false; LT.acClose(); LT.closeTip();
    if (FM.layer) { A.dropLayer(FM.layer); FM.layer = null; }
    root.classList.remove('open'); const fast = S.rm || S.lp; if (fast) root.hidden = true; else LT.later(() => { if (!FM.open) root.hidden = true; }, 120);
    const key = FM.key, text = G ? G.ta.value : null; if (G) { const k = G; G.o.keep = false; LT.fields.delete('ltf'); k.ro && k.ro.disconnect(); LT.cancel(k.tokT); LT.cancel(k.pendT); }
    FM.G = null; FM.find = false; FM.hits = []; const O = LT.fields.get(key);
    if (O) { if (text != null && O.ta.value !== text) O.ta.value = text; O.marks = null; LT.render(O, { force: true }); LT.fit(O); LT.tokSchedule(O, 0); if (restore) O.ta.focus({ preventScroll: true }); LT.sb.target = O; }
    else if (restore) { const m = $('#main'); if (m) m.focus(); }
    LT.sbMark(O, true);
  }
  function layout() {
    if (!root) return; const split = !phoneLike(); root.dataset.split = FM.pv && split ? '1' : '0'; root.dataset.tab = phoneLike() ? FM.tab : 'edit';
    const tabs = $('#ltfTabs', root); tabs.hidden = !(phoneLike() && FM.G && FM.G.flags.cbs); $$('[data-ltf-tab]', root).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.ltfTab === FM.tab)));
    const showPv = FM.G && FM.G.flags.cbs && (phoneLike() ? FM.tab === 'preview' : FM.pv); $('#ltfPv', root).hidden = !showPv; $('#ltfEd', root).hidden = phoneLike() && FM.tab === 'preview';
    const eb = $('#ltfPvBtn', root); if (eb) eb.setAttribute('aria-pressed', String(!!showPv));
    $('#ltfBack', root).innerHTML = ic(phoneLike() ? 'arrow-left' : 'minimize-2', 20); $('#ltfBack', root).setAttribute('aria-label', t(phoneLike() ? 'ltfBack' : 'ltFocusClose')); $('#ltfBack', root).title = t(phoneLike() ? 'ltfBack' : 'ltFocusClose');
    if (showPv) renderPv();
  }
  addEventListener('resize', () => { if (FM.open) layout(); });
  function renderPv() {
    const G = FM.G; if (!G) return; const res = C.evalCbs(G.ta.value, LT.sbVals()), shown = res.out.length > 6000 ? res.out.slice(0, 6000) + '…' : res.out, out = $('#ltfPvOut', root);
    out.className = 'sb-out' + (LT.sb.raw ? ' raw' : ''); if (LT.sb.raw) out.textContent = shown || t('sbEmpty'); else out.innerHTML = shown ? LT.renderRich(shown) : '<span class="hint">' + esc(t('sbEmpty')) + '</span>'; out.removeAttribute('data-stale'); FM.pvText = G.ta.value;
  }
  LT.onWrite = (F) => {
    if (!FM.open) return;
    if (F === FM.G) { if (!$('#ltfPv', root).hidden) { if (S.lp) { $('#ltfPvOut', root).setAttribute('data-stale', '1'); } else { LT.cancel(FM.pvT); FM.pvT = LT.later(() => { if (FM.open && !$('#ltfPv', root).hidden) renderPv(); }, 300); } } if (FM.find) refind(false); }
  };
  LT.afterForm = () => {   // the form was rebuilt (undo, language): follow the new instance of the field
    if (!FM.open) return; const O = origin(); if (!O) { closeFocus(false); return; }
    FM.F = O; const G = FM.G; if (G && !G.composing && G.ta.value !== O.ta.value) { G.ta.value = O.ta.value; LT.render(G, { force: true }); LT.fit(G); }
    syncHdr();
  };

  /* ---- find and replace (this field only) */
  function openFind(repl) {
    if (!FM.open) return; FM.find = true; $('#ltfFind', root).hidden = false; if (repl) { FM.repl = true; $('#ltfRrow', root).hidden = false; $('#ltfRT', root).setAttribute('aria-pressed', 'true'); }
    const q = $('#ltfQ', root), G = FM.G, s = G.ta.value.slice(G.ta.selectionStart, G.ta.selectionEnd); if (s && s.indexOf('\n') < 0) q.value = s;
    q.focus(); q.select(); refind(true);
  }
  function closeFind() { if (!FM.find) return; FM.find = false; $('#ltfFind', root).hidden = true; const G = FM.G; if (G) { G.marks = null; LT.render(G, { force: true }); G.ta.focus({ preventScroll: true }); } }
  function refind(jump) {
    const G = FM.G; if (!G) return; const q = $('#ltfQ', root).value; FM.cs = $('#ltfCase', root).getAttribute('aria-pressed') === 'true'; FM.hits = C.findAll(G.ta.value, q, FM.cs);
    if (!FM.hits.length) FM.cur = -1; else if (FM.cur < 0 || FM.cur >= FM.hits.length || jump) { const p = G.ta.selectionStart; let i = FM.hits.findIndex((h) => h >= p); FM.cur = i < 0 ? 0 : i; }
    draw(jump);
  }
  function draw(jump) {
    const G = FM.G, n = FM.hits.length, q = $('#ltfQ', root).value; $('#ltfCnt', root).textContent = q ? (n ? t('ltFindCount', { i: FM.cur + 1, n }) : t('ltNoMatch')) : '';
    G.marks = G.ta.value.length <= LT.BIG ? FM.hits.map((h, i) => ({ s: h, e: h + q.length, cur: i === FM.cur })) : null; LT.render(G, { force: true });
    if (jump && FM.cur >= 0) show(FM.hits[FM.cur], q.length);
  }
  function show(pos, len) { const G = FM.G, ta = G.ta; ta.setSelectionRange(pos, pos + len); const m = LT.measureCaret(G, pos); if (m) { const top = ta.scrollTop; if (m.offTop < top + 20 || m.offTop > top + ta.clientHeight - 40) ta.scrollTop = Math.max(0, m.offTop - ta.clientHeight / 3); } G.mir.scrollTop = ta.scrollTop; }
  function step(d) { if (!FM.hits.length) return; FM.cur = (FM.cur + d + FM.hits.length) % FM.hits.length; draw(true); }
  function replaceOne() {
    const G = FM.G; if (!G || FM.cur < 0) return; const q = $('#ltfQ', root).value, r = $('#ltfR', root).value, s = FM.hits[FM.cur]; LT.replaceRange(G, s, s + q.length, r, r.length); LT.flush(G); const keep = FM.cur; FM.cur = -1; refind(false); if (FM.hits.length) { FM.cur = Math.min(keep, FM.hits.length - 1); draw(true); } $('#ltfR', root).focus();
  }
  /* replace all and revert change one range (first hit to last hit; the part that differs), keep the caret and the scroll, and above 20 000 characters set the value directly: the editing command is quadratic on big text (8 s at 100 000 characters). The owner history records one step either way; the textarea's own undo is lost on the direct path. */
  function replaceAll() {
    const G = FM.G; if (!G) return; const q = $('#ltfQ', root).value; if (!q) return; LT.flush(G); const text = G.ta.value, hits = C.findAll(text, q, FM.cs); if (!hits.length) { announce(t('ltNoMatch')); return; }
    const from = hits[0], to = hits[hits.length - 1] + q.length, res = C.replaceAll(text.slice(from, to), q, $('#ltfR', root).value, FM.cs);
    LT.setRange(G, from, to, res.text, t('ltStepReplAll')); G.dirty = false; refind(false); A.toast(t('ltReplAllDone', { n: hits.length }), { ms: 3000 }); announce(t('ltReplAllDone', { n: hits.length })); $('#ltfR', root).focus();
  }
  function revert() {
    const G = FM.G; if (!G) return; LT.flush(G); const cur = G.ta.value, old = FM.opened; if (cur === old) { A.toast(t('ltRevertSame'), { ms: 2500 }); announce(t('ltRevertSame')); return; }
    let a = 0; const m = Math.min(cur.length, old.length); while (a < m && cur.charCodeAt(a) === old.charCodeAt(a)) a++; let b = 0; while (b < m - a && cur.charCodeAt(cur.length - 1 - b) === old.charCodeAt(old.length - 1 - b)) b++;
    LT.setRange(G, a, cur.length - b, old.slice(a, old.length - b), t('ltStepRevert')); if (FM.find) refind(false); A.toast(t('ltReverted'), { ms: 4000 }); announce(t('ltReverted'));
  }
  LT.revertFocus = revert; LT.replaceAllFocus = replaceAll; LT.openFind = openFind; LT.closeFind = closeFind; LT.findStep = step;
  function onClick(e) {
    const b = e.target.closest('button'); if (!b) return; const id = b.id;
    if (id === 'ltfBack') closeFocus(true);
    else if (id === 'ltfFindBtn') (FM.find ? closeFind() : openFind(false));
    else if (id === 'ltfMacro') LT.openMacroSheet(FM.G, b);
    else if (id === 'ltfPvBtn') { if (phoneLike()) { FM.tab = FM.tab === 'preview' ? 'edit' : 'preview'; } else FM.pv = !FM.pv; layout(); }
    else if (id === 'ltfRevert') revert();
    else if (id === 'ltfMore') { const tt = document.getElementById('toast'); if (tt) { tt.replaceChildren(); tt.classList.remove('show'); } /* a toast sits over the bottom edge and would cover the menu item */ A.openMenu(b, t('ltMore'), [['rotate-ccw', t('ltRevert'), () => revert()]]); }
    else if (id === 'ltfUndo') { if (b.getAttribute('aria-disabled') !== 'true') ST.doUndo(); }
    else if (id === 'ltfRedo') { if (b.getAttribute('aria-disabled') !== 'true') { const f = A.findItem(S.open); if (f) A.redoOwner(f.o.id); } }
    else if (id === 'ltfPrev') step(-1); else if (id === 'ltfNext') step(1);
    else if (id === 'ltfCase') { b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true')); refind(true); }
    else if (id === 'ltfRT') { FM.repl = !FM.repl; $('#ltfRrow', root).hidden = !FM.repl; b.setAttribute('aria-pressed', String(FM.repl)); }
    else if (id === 'ltfFClose') closeFind();
    else if (id === 'ltfRep1') replaceOne(); else if (id === 'ltfRepAll') replaceAll();
    else if (id === 'ltfPvRun') renderPv();
    else if (b.dataset.ltfTab) { FM.tab = b.dataset.ltfTab; layout(); }
  }
  function onInput(e) { if (e.target.id === 'ltfQ') { refind(true); } }
  /* keys while focus mode is open (called by window.__ltKey) */
  LT.focusKey = (e, F) => {
    if (!FM.open) return false; const k = e.key, kl = k.length === 1 ? k.toLowerCase() : k, mod = e.ctrlKey || e.metaKey, inRoot = root.contains(e.target);
    if (!inRoot) return false;
    if (k === 'Tab') {
      const f = $$('button:not([disabled]):not([aria-disabled="true"]), input, textarea, [tabindex="0"]', root).filter((x) => x.offsetParent !== null && !x.closest('[hidden]') && x.tabIndex >= 0); if (!f.length) return false;
      const first = f[0], last = f[f.length - 1], a = document.activeElement;
      if (e.shiftKey && (a === first || !root.contains(a))) { e.preventDefault(); last.focus(); return true; } if (!e.shiftKey && (a === last || !root.contains(a))) { e.preventDefault(); first.focus(); return true; } return false;
    }
    if (mod && !e.altKey && !e.shiftKey && kl === 'f') { e.preventDefault(); openFind(false); return true; }
    if (mod && !e.altKey && !e.shiftKey && kl === 'h') { e.preventDefault(); openFind(true); return true; }
    if (k === 'Escape' && FM.find && e.target.closest('#ltfFind')) { e.preventDefault(); closeFind(); return true; }
    if (k === 'Enter' && e.target.id === 'ltfQ') { e.preventDefault(); step(e.shiftKey ? -1 : 1); return true; }
    if (k === 'Enter' && e.target.id === 'ltfR') { e.preventDefault(); replaceOne(); return true; }
    return false;
  };
  LT.openFocus = openFocus; LT.closeFocus = closeFocus;
})();
