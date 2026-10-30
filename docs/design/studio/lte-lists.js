/* Studio slice 3, part 3: structured lists for the character's alternate first messages (the array; cards only, DD-122) and example messages (one stored string, <START> blocks; the cards are a view of it, DD-120).
   Marker rule as the engine's (DD-123): a line that is exactly <start> after trimming and lower-casing starts a block. Round trip: untouched blocks keep their exact bytes (also CRLF); a changed card is written as "<START>" + its body.
   A marker line typed or pasted inside a card splits it into two cards when typing pauses, as one undo step (DD-124). Synthetic. */
(function () {
  'use strict';
  const ST = window.__st1, A = ST.api, S = A.S, C = window.LTCore, LT = window.LTX;
  const { t, nm, ic, esc, $, $$, announce } = A;
  LT.uids = {}; LT.uidN = 0;
  const newUid = () => 'u' + (++LT.uidN);
  const uidsFor = (key, n) => { const u = LT.uids[key] = LT.uids[key] || []; while (u.length < n) u.push(newUid()); if (u.length > n) u.length = n; return u; };
  const cur = (id) => A.findItem(id);
  const lab = (kind, i) => t(kind === 'alts' ? 'ltAltTitle' : 'ltExTitle') + ' · ' + t('ltCardN', { n: i + 1 });
  const charName = () => nm(A.ctxChar().name);
  const norm = (s) => String(s).replace(/\r\n/g, '\n').replace(/\s+$/, '');

  /* ---------------------------------------------------------------- models */
  const altsOf = (it) => (Array.isArray(it.f.alts) ? it.f.alts : []);
  function exModel(it) {
    const raw = String(it.f.examples || ''), X = C.splitExamples(raw), cards = [];
    if (X.pre.trim()) cards.push({ type: 'pre', raw: X.pre, body: norm(X.pre) });   // dialogue before the first marker: the engine reads it too
    X.blocks.forEach((b, i) => cards.push({ type: 'blk', bi: i, raw: b, body: norm(C.blockBody(b)) }));
    return { raw, X, cards };
  }
  LT.exModel = exModel;
  const write = (itemId, label, fn, key, defer) => { const f = cur(itemId); if (!f) return; A.edit(f.o.id, label, () => fn(f.it), key ? { key } : undefined); A.renderHeader(); LT.shellRefresh(defer); LT.sbMark(null, true); };
  function setExamples(it, pre, blocks) { it.f.examples = C.joinExamples(pre, blocks); }
  const stripSpeaker = (body) => body.replace(/^[ \t]*(\{\{user\}\}|<user>|\{\{char\}\}|<bot>)[ \t]*:[ \t]*/i, '');

  /* ---------------------------------------------------------------- section builders */
  const headHtml = (kind, n) => '<div class="lt-sech" data-part="studio-lt-list-head"><h3 class="lt-sect" data-part="studio-lt-list-title">' + ic(kind === 'alts' ? 'messages-square' : 'message-square', 16) + '<span>' + esc(t(kind === 'alts' ? 'ltAltTitle' : 'ltExTitle')) + '</span><span class="lt-secn" data-part="studio-lt-list-count">' + n + '</span></h3><span class="lt-tokw" data-total="' + kind + '"></span>' +
    (kind === 'ex' ? '<div class="seg lt-vseg" data-part="studio-lt-view" role="group" aria-label="' + esc(t('ltViewLbl')) + '"><button type="button" class="btn sm txt" data-part="studio-lt-view-button" data-lt-view="ex:list" aria-label="' + esc(t('ltViewList')) + '" title="' + esc(t('ltViewList')) + '" aria-pressed="' + (LT.view.ex === 'list') + '">' + ic('list', 16) + '<span>' + esc(t('ltViewList')) + '</span></button><button type="button" class="btn sm txt" data-part="studio-lt-view-button" data-lt-view="ex:text" aria-label="' + esc(t('ltViewText')) + '" title="' + esc(t('ltViewText')) + '" aria-pressed="' + (LT.view.ex === 'text') + '">' + ic('file-text', 16) + '<span>' + esc(t('ltViewText')) + '</span></button></div>' : '') + '</div>';
  function cardHtml(kind, i, uid, title, sub, pre) {
    const tools = '<button type="button" class="btn sm" data-part="studio-lt-card-tool" data-lt-card-act="preview" aria-label="' + esc(t('ltPreview')) + '" title="' + esc(t('ltPreview')) + '">' + ic('eye', 18) + '</button><button type="button" class="btn sm" data-part="studio-lt-card-tool" data-lt-card-act="focus" aria-label="' + esc(t('ltFocus')) + '" title="' + esc(t('ltFocus')) + '">' + ic('maximize-2', 18) + '</button><button type="button" class="btn sm" data-part="studio-lt-card-tool" data-lt-card-act="menu" aria-haspopup="menu" aria-label="' + esc(t('ltCardMenu')) + '" title="' + esc(t('ltCardMenu')) + '">' + ic('ellipsis', 18) + '</button>';
    const grip = pre ? '' : '<button type="button" class="lt-grip" data-part="studio-lt-card-grip" data-grip aria-label="' + esc(t('ltGrip')) + '" title="' + esc(t('ltGrip')) + '" aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown">' + ic('grip-vertical', 16) + '</button>';
    return '<article class="lt-card' + (pre ? ' opening' : '') + '" data-part="studio-lt-card" id="ltc-' + uid + '" data-uid="' + uid + '" data-lt-kind="' + kind + '" role="listitem"><header class="lt-chead" data-part="studio-lt-card-head">' + grip + '<span class="lt-no" data-part="studio-lt-card-number">' + (pre ? ic('message-square', 14) : i + 1) + '</span><div class="lt-cttl" data-part="studio-lt-card-titles"><h4 class="lt-ct" data-part="studio-lt-card-title">' + esc(title) + '</h4><span class="lt-cs" data-part="studio-lt-card-sub">' + esc(sub) + '</span></div><span class="lt-tokw" data-chip></span><span class="lt-tools" data-part="studio-lt-card-tools">' + tools + '</span></header><div class="lt-cbody" data-part="studio-lt-card-body"><textarea id="ltta-' + uid + '"></textarea></div></article>';
  }
  function addHtml(kind) { return '<div class="lt-addrow" data-part="studio-lt-add-row"><button type="button" class="btn solid" data-part="studio-lt-add" data-lt-add="' + kind + '">' + ic('plus', 16) + '<span>' + esc(t(kind === 'alts' ? 'ltAddAlt' : 'ltAddEx')) + '</span></button>' + (kind === 'alts' ? '<button type="button" class="btn solid" data-part="studio-lt-add" data-lt-pastemany="alts">' + ic('clipboard-paste', 16) + '<span>' + esc(t('ltPasteMany')) + '</span></button>' : '') + '</div>'; }
  const empty = (kind) => '<p class="lt-empty" data-part="studio-lt-empty">' + esc(t(kind === 'alts' ? 'ltEmptyAlt' : 'ltEmptyEx')) + '</p>';
  const cardSub = (c, n) => (c.type === 'pre' ? t('ltOpeningSub') : t('ltTurns', { n: C.turns(c.body, charName()) })) + (C.colonCuts(c.body, charName()) ? ' · ' + t('ltColonCut', { n: C.colonCuts(c.body, charName()) }) : '');

  /* ---------------------------------------------------------------- render */
  function mountCard(kind, itemId, uid, text, mode, extra) {
    const ta = $('#ltta-' + uid); if (!ta) return null; const card = ta.closest('.lt-card');
    return LT.mountField(ta, Object.assign({ key: kind + ':' + itemId + ':' + uid, mode, label: card.querySelector('.lt-ct').textContent, noHead: true, chipHost: card.querySelector('[data-chip]'), collapsed: true, card: true, noGrip: true, itemId, field: kind, value: text, onTok: () => totalsSoon(itemId) }, extra));
  }
  function renderAlts(itemId, after) {
    const sec = $('#ltAlts'), f = cur(itemId); if (!sec || !f) return; const arr = altsOf(f.it), uids = uidsFor(itemId + ':alts', arr.length);
    clearFields('alts:' + itemId + ':');
    const h = headHtml('alts', arr.length) + (arr.length ? '<div class="lt-cards" data-part="studio-lt-cards" role="list" aria-label="' + esc(t('ltAltTitle')) + '">' + arr.map((s, i) => cardHtml('alts', i, uids[i], C.firstLine(s) || t('ltCardN', { n: i + 1 }), t('ltCardN', { n: i + 1 }), false)).join('') + '</div>' : empty('alts'));
    sec.innerHTML = h + addHtml('alts');
    arr.forEach((s, i) => { const u = uids[i]; mountCard('alts', itemId, u, s, 'html+cbs', { label: lab('alts', i), set: (val, o) => setAlt(itemId, u, val, o) }); });
    drawTotals(itemId); LT.syncAll(sec); finishFocus(after, itemId + ':alts');
  }
  function setAlt(itemId, u, val, o) {
    const f = cur(itemId); if (!f || !u) return; const i = (LT.uids[itemId + ':alts'] || []).indexOf(u); if (i < 0) return; const old = altsOf(f.it)[i]; val = C.mergeEdit(old == null ? '' : old, val); if (old === val) return;
    write(itemId, o.label || t('ltStepAltEdit'), (it) => { it.f.alts = altsOf(it).slice(); it.f.alts[i] = val; }, o.label ? null : itemId + '.alts.' + u, o.defer);
    const card = $('#ltc-' + u); if (card) card.querySelector('.lt-ct').textContent = C.firstLine(val) || t('ltCardN', { n: i + 1 });
    totalsSoon(itemId);
  }
  function renderEx(itemId, after) {
    const sec = $('#ltEx'), f = cur(itemId); if (!sec || !f) return; const M = exModel(f.it), uids = uidsFor(itemId + ':ex', M.cards.length), view = LT.view.ex;
    clearFields('ex:' + itemId + ':'); const h = headHtml('ex', M.X.blocks.length);
    if (view === 'text') {
      sec.innerHTML = h + '<div class="lt-textv" data-part="studio-lt-text-view" data-view="text"><div class="fld"><textarea id="ltExTa" data-lt="ex"></textarea></div><p class="hint" data-part="studio-lt-text-view-note">' + esc(t('ltExTextNote')) + '</p></div>';
      LT.mountField($('#ltExTa'), { key: 'ex-text:' + itemId, mode: 'ex', label: t('ltExTitle') + ' · ' + t('ltViewText'), value: M.raw.replace(/\r\n/g, '\n'), noChip: true, itemId, field: 'examples' });
    } else {
      let n = 0;
      const cards = M.cards.map((c, k) => { const pre = c.type === 'pre'; const title = pre ? t('ltOpening') : (C.firstLine(stripSpeaker(c.body)) || t('ltCardN', { n: n + 1 })); const html = cardHtml('ex', pre ? 0 : n, uids[k], title, cardSub(c), pre); if (!pre) n++; return html; }).join('');
      sec.innerHTML = h + (M.cards.length ? '<div class="lt-cards" data-part="studio-lt-cards" role="list" aria-label="' + esc(t('ltExTitle')) + '">' + cards + '</div>' : empty('ex')) + addHtml('ex');
      let bi = 0; M.cards.forEach((c, k) => { const pre = c.type === 'pre'; const num = pre ? 0 : ++bi; const key = uids[k]; mountCard('ex', itemId, key, c.body, 'ex', { label: pre ? t('ltOpening') : lab('ex', num - 1), set: (val, o) => setExCard(itemId, key, val, o), holds: (F) => markerHeld(F.ta) }); });
    }
    drawTotals(itemId); LT.syncAll(sec); finishFocus(after, itemId + ':ex');
  }
  /* a card's text was written: the card is found by its identity; if the cards and the stored blocks no longer line up, the cards are drawn again and nothing is written (never into a neighbour) */
  /* DD-128: a start line that was typed splits the card only once the caret has left that line (or on Enter, which moves it). While the caret is still on it nothing is written, so deleting the marker never splits and leaves no empty card; a pasted or dropped marker splits at once */
  function markerHeld(ta) {
    if (!ta || document.activeElement !== ta || /^insertFrom(Paste|Drop)/.test(ta.dataset.it || '')) return false;
    const v = ta.value, p = ta.selectionStart, a = p ? v.lastIndexOf('\n', p - 1) + 1 : 0; let b = v.indexOf('\n', p); if (b < 0) b = v.length; return C.isMarker(v.slice(a, b));
  }
  function setExCard(itemId, u, val, o) {
    const f = cur(itemId); if (!f) return; const uids = LT.uids[itemId + ':ex'] || [], M = exModel(f.it), k = uids.indexOf(u);
    if (k < 0 || uids.length !== M.cards.length) { if (k >= 0 || uids.length) { LT.uids[itemId + ':ex'] = []; renderEx(itemId, null); } return; }
    const c = M.cards[k], cn = charName(); let pre = M.X.pre, blocks = M.X.blocks.slice(); const parts = C.splitExamples(val);
    if (parts.blocks.length) { const ta = $('#ltta-' + u); if (markerHeld(ta)) { const F = [...LT.fields.values()].find((x) => x.ta === ta); if (F) F.dirty = true; return; } splitCard(itemId, M, k, c, val, parts, o); return; }   // a marker line was typed or pasted inside the card (DD-124)
    if (norm(val) === c.body) return;   // only trailing spaces or blank lines changed: no write, no undo step
    if (c.type === 'pre') { const tail = C.blockTail(pre), eol = C.eolOf(pre), oldTrim = pre.slice(0, pre.length - tail.length); pre = C.mergeEdit(oldTrim, val.replace(/\s+$/, '')) + (/\n/.test(tail) ? tail : eol); }
    else { const body = C.blockBody(c.raw), tail = C.blockTail(c.raw), eol = C.eolOf(c.raw); blocks[c.bi] = '<START>' + eol + C.mergeEdit(body.slice(0, body.length - tail.length), val.replace(/\s+$/, '')) + (tail || eol); }
    write(itemId, o.label || t('ltStepExEdit'), (it) => { setExamples(it, pre, blocks); }, o.label ? null : itemId + '.ex.' + u, o.defer);
    const card = $('#ltc-' + u); if (card) { card.querySelector('.lt-ct').textContent = c.type === 'pre' ? t('ltOpening') : (C.firstLine(stripSpeaker(val)) || t('ltCardN', { n: c.bi + 1 })); card.querySelector('.lt-cs').textContent = cardSub({ type: c.type, body: val }); }
    totalsSoon(itemId);
  }
  function splitCard(itemId, M, k, c, val, parts, o) {
    const eol = C.eolOf(c.raw), ae = document.activeElement, mine = ae && ae.tagName === 'TEXTAREA' && ae.id === 'ltta-' + (LT.uids[itemId + ':ex'] || [])[k], caret = mine ? ae.selectionStart : null;
    const conv = (x) => x.replace(/\r?\n/g, eol), tail = C.blockTail(c.raw) || eol; let pre = M.X.pre, blocks = M.X.blocks.slice(), made = [];
    const typed = parts.blocks.map((b, i) => (i === parts.blocks.length - 1 ? conv(b.replace(/\s+$/, '')) + tail : conv(/\n$/.test(b) ? b : b + '\n')));
    if (c.type === 'pre') { pre = conv(parts.pre.replace(/\s+$/, '')) + (parts.pre.trim() ? eol : '') ; if (!parts.pre.trim()) pre = ''; blocks = typed.concat(blocks); }
    else { const first = parts.pre.trim() ? [C.blockFrom(parts.pre, c.raw)] : []; made = first; blocks.splice(c.bi, 1, ...first, ...typed); }
    const nBefore = M.cards.length, starts = (c.type === 'pre' || parts.pre.trim() ? [0] : []).concat(C.markerStarts(val));
    let idx = 0; if (caret != null) starts.forEach((s, i) => { if (s <= caret) idx = i; }); else idx = starts.length - 1;
    const target = k + idx, off = caret != null && starts[idx] != null ? Math.max(0, caret - starts[idx] - (idx === 0 && (c.type === 'pre' || parts.pre.trim()) ? 0 : (val.slice(starts[idx]).indexOf('\n') + 1))) : 0;
    write(itemId, t('ltStepExSplit'), (it) => { setExamples(it, pre, blocks); }, null);
    LT.uids[itemId + ':ex'] = []; renderEx(itemId, { idx: target, sel: [off, off] }); const n = exModel(cur(itemId).it).cards.length - nBefore;
    A.toast(t('ltSplit', { n }), { ms: 3000 }); announce(t('ltSplit', { n }));
  }
  function clearFields(prefix) { [...LT.fields.keys()].forEach((k) => { if (k.indexOf(prefix) === 0 || (k.indexOf('ex-text:') === 0 && prefix.indexOf('ex') === 0)) { const F = LT.fields.get(k); if (F && F.dirty) LT.flush(F); LT.fields.delete(k); if (F && F.ro) F.ro.disconnect(); } }); }
  function finishFocus(after, ukey) {
    if (!after) return; const uid = after.uid || (after.idx != null && (LT.uids[ukey] || [])[after.idx]); if (!uid) return;
    if (after.ctl === 'menu' || after.menu) { const b = $('#ltc-' + uid + ' [data-lt-card-act="menu"]'); if (b) b.focus({ preventScroll: true }); return; }
    if (after.ctl === 'grip') { const b = $('#ltc-' + uid + ' .lt-grip') || $('#ltc-' + uid + ' [data-lt-card-act="menu"]'); if (b) b.focus({ preventScroll: true }); return; }
    const card = $('#ltc-' + uid); if (!card) return; const ta = card.querySelector('textarea.lt-in'); if (ta) { ta.focus({ preventScroll: false }); if (after.sel) ta.setSelectionRange(after.sel[0], after.sel[1]); }
  }

  /* ---------------------------------------------------------------- totals */
  function drawTotals(itemId) {
    const f = cur(itemId); if (!f) return;
    [['alts', altsOf(f.it)], ['ex', exModel(f.it).cards.map((c) => c.body)]].forEach(([kind, texts]) => {
      const host = $('[data-total="' + kind + '"]'); if (!host) return; if (!texts.length) { host.innerHTML = ''; return; }
      if (S.lp) { host.dataset.state = 'stale'; const ps = { n: 'tot-' + kind, chipHost: host, tok: 'stale' }; LT.drawChip(ps); return; }
      let n = 0, vary = false; texts.forEach((x) => { const r = LT.countRaw(x); n += r.n; vary = vary || r.vary; }); const pseudo = { n: 'tot-' + kind, chipHost: host, tok: { n, vary } }; LT.drawChip(pseudo);
      const tx = host.querySelector('.lt-toktx'); if (tx) tx.textContent = t('ltTotal') + ' ' + tx.textContent;
    });
  }
  const totalsSoon = (itemId) => { LT.cancel(LT.totT); LT.totT = LT.later(() => drawTotals(itemId), LT.TOK_PAUSE); };
  LT.drawTotals = drawTotals;

  /* ---------------------------------------------------------------- operations (every structural change is one owner-history step) */
  function altIndex(itemId, u) { return (LT.uids[itemId + ':alts'] || []).indexOf(u); }
  function exCardIndex(itemId, u) { return (LT.uids[itemId + ':ex'] || []).indexOf(u); }
  function opAdd(kind, itemId) {
    LT.flushAll(); const u = newUid();
    if (kind === 'alts') { write(itemId, t('ltStepAltAdd'), (it) => { it.f.alts = altsOf(it).concat(['']); }); const us = (LT.uids[itemId + ':alts'] || []).slice(); us.push(u); LT.uids[itemId + ':alts'] = us; renderAlts(itemId, { uid: u }); }
    else { const f = cur(itemId), M = exModel(f.it); write(itemId, t('ltStepExAdd'), (it) => { setExamples(it, M.X.pre, M.X.blocks.concat([C.blockFrom('', M.X.blocks.length ? M.X.blocks[M.X.blocks.length - 1] : null)])); }); const us = (LT.uids[itemId + ':ex'] || []).slice(); us.push(u); LT.uids[itemId + ':ex'] = us; renderEx(itemId, { uid: u }); }
    announce(t(kind === 'alts' ? 'ltStepAltAdd' : 'ltStepExAdd'));
  }
  function opMove(kind, itemId, u, dir, after) {
    LT.flushAll(); const f = cur(itemId); if (!f) return;
    if (kind === 'alts') {
      const i = altIndex(itemId, u), j = i + dir, arr = altsOf(f.it); if (i < 0 || j < 0 || j >= arr.length) { announce(t('ltMoveEnd')); return; }
      write(itemId, t('ltStepAltMove'), (it) => { const a = altsOf(it).slice(); [a[i], a[j]] = [a[j], a[i]]; it.f.alts = a; }); const us = LT.uids[itemId + ':alts']; [us[i], us[j]] = [us[j], us[i]]; renderAlts(itemId, Object.assign({ uid: u }, after));
    } else {
      const M = exModel(f.it), k = exCardIndex(itemId, u), c = M.cards[k]; if (!c || c.type === 'pre') return; const bi = c.bi, bj = bi + dir; if (bj < 0 || bj >= M.X.blocks.length) { announce(t('ltMoveEnd')); return; }
      const blocks = M.X.blocks.slice(); [blocks[bi], blocks[bj]] = [blocks[bj], blocks[bi]]; write(itemId, t('ltStepExMove'), (it) => { setExamples(it, M.X.pre, blocks); }); const off = M.cards[0] && M.cards[0].type === 'pre' ? 1 : 0, us = LT.uids[itemId + ':ex']; [us[bi + off], us[bj + off]] = [us[bj + off], us[bi + off]]; renderEx(itemId, Object.assign({ uid: u }, after));
    }
    announce(t('ltMoved'));
  }
  function opDup(kind, itemId, u) {
    LT.flushAll(); const f = cur(itemId); if (!f) return; const nu = newUid();
    if (kind === 'alts') { const i = altIndex(itemId, u); write(itemId, t('ltStepAltDup'), (it) => { const a = altsOf(it).slice(); a.splice(i + 1, 0, a[i]); it.f.alts = a; }); LT.uids[itemId + ':alts'].splice(i + 1, 0, nu); renderAlts(itemId, { uid: nu }); }
    else { const M = exModel(f.it), k = exCardIndex(itemId, u), c = M.cards[k]; if (!c || c.type === 'pre') return; const blocks = M.X.blocks.slice(); blocks.splice(c.bi + 1, 0, c.raw + (/\n$/.test(c.raw) ? '' : C.eolOf(c.raw))); write(itemId, t('ltStepExDup'), (it) => { setExamples(it, M.X.pre, blocks); }); LT.uids[itemId + ':ex'].splice(k + 1, 0, nu); renderEx(itemId, { uid: nu }); }
  }
  function opDelete(kind, itemId, u) {
    LT.flushAll(); const f = cur(itemId); if (!f) return; let removed, index, name;
    if (kind === 'alts') { const i = altIndex(itemId, u); if (i < 0) return; removed = altsOf(f.it)[i]; index = i; name = C.firstLine(removed) || t('ltCardN', { n: i + 1 }); write(itemId, t('ltStepAltDel'), (it) => { const a = altsOf(it).slice(); a.splice(i, 1); it.f.alts = a; }); LT.uids[itemId + ':alts'].splice(i, 1); renderAlts(itemId, null); }
    else { const M = exModel(f.it), k = exCardIndex(itemId, u), c = M.cards[k]; if (!c) return; removed = c.raw; index = k; name = c.type === 'pre' ? t('ltOpening') : (C.firstLine(c.body) || t('ltCardN', { n: c.bi + 1 })); let pre = M.X.pre, blocks = M.X.blocks.slice(); if (c.type === 'pre') pre = ''; else blocks.splice(c.bi, 1); write(itemId, t('ltStepExDel'), (it) => { setExamples(it, pre, blocks); }); LT.uids[itemId + ':ex'].splice(k, 1); renderEx(itemId, null); }
    const label = t('ltDeleted', { name }), hs = A.S.H[f.o.id], dstep = hs && hs.steps[hs.idx];   /* slice 4 review M1: the toast's Undo and a history Undo must not both put the card back */
    A.toast(label, { ms: 10000, endsOnClose: true, action: { label: t('undoBtn'), fn: () => { const k = hs ? hs.steps.indexOf(dstep) : -1; if (hs && (k < 0 || k > hs.idx)) { const gone = A.t('s4ToastGone'); if (gone !== 's4ToastGone') { announce(gone); A.toast(gone, { ms: 2500 }); } return; } restore(kind, itemId, removed, index); } } }); announce(label);
    const add = $('[data-lt-add="' + kind + '"]'); const cards = $$('#' + (kind === 'alts' ? 'ltAlts' : 'ltEx') + ' .lt-card'); const next = cards[Math.min(index, cards.length - 1)]; const nb = next && next.querySelector('[data-lt-card-act="menu"]'); (nb || add || $('#main')).focus({ preventScroll: true });
  }
  /* durable undo (DD-100): puts exactly this card back where it was, whatever was edited since */
  function restore(kind, itemId, removed, index) {
    const f = cur(itemId); if (!f) return; const nu = newUid();
    if (kind === 'alts') { const i = Math.min(index, altsOf(f.it).length); write(itemId, t('ltStepRestore'), (it) => { const a = altsOf(it).slice(); a.splice(i, 0, removed); it.f.alts = a; }); (LT.uids[itemId + ':alts'] = LT.uids[itemId + ':alts'] || []).splice(i, 0, nu); renderAlts(itemId, { uid: nu, menu: true }); }
    else { const M = exModel(f.it), off = M.cards[0] && M.cards[0].type === 'pre' ? 1 : 0; let pre = M.X.pre, blocks = M.X.blocks.slice(); if (C.isMarker(String(removed).split('\n')[0])) { const bi = Math.max(0, Math.min(index - off, blocks.length)); blocks.splice(bi, 0, removed); } else pre = removed; write(itemId, t('ltStepRestore'), (it) => { setExamples(it, pre, blocks); }); const k = Math.min(index, (LT.uids[itemId + ':ex'] || []).length); LT.uids[itemId + ':ex'].splice(k, 0, nu); renderEx(itemId, { uid: nu, menu: true }); }
    announce(t('ltStepRestore'));
  }
  /* "swap": the card takes the place of the main first message, and the main first message takes the card's place (nothing is lost) */
  function opMakeMain(itemId, u) {
    LT.flushAll(); const f = cur(itemId); if (!f) return; const i = altIndex(itemId, u); if (i < 0) return;
    write(itemId, t('ltStepMain'), (it) => { const a = altsOf(it).slice(), m = it.f.first; it.f.first = a[i]; a[i] = m == null ? '' : m; it.f.alts = a; });
    const Fm = LT.fields.get(itemId + ':first'); if (Fm) { Fm.ta.value = f.it.f.first; LT.render(Fm); LT.fit(Fm); LT.tokSchedule(Fm, 0); }
    renderAlts(itemId, { uid: u, menu: true }); A.toast(t('ltMadeMain'), { ms: 3500 }); announce(t('ltMadeMain'));
  }
  function opConvertPre(itemId, u) {   // give the opening dialogue a start mark: it becomes the first block
    LT.flushAll(); const f = cur(itemId); if (!f) return; const M = exModel(f.it); if (!M.cards[0] || M.cards[0].type !== 'pre') return;
    const blocks = M.X.blocks.slice(); blocks.unshift('<START>' + C.eolOf(M.X.pre) + M.X.pre.replace(/^(?:[ \t]*\r?\n)+/, '')); write(itemId, t('ltStepExAdd'), (it) => { setExamples(it, '', blocks); }); renderEx(itemId, { uid: u });
  }
  /* paste several (DD-122): one-time split of pasted text into new cards at the end; the rule and a preview are shown before anything is applied */
  function openPasteMany(itemId, opener) {
    A.openSheet({ title: t('ltPasteManyTitle'), opener, cls: 'dlg tall ltpm', kind: 'lt-paste', build(body) {
      body.innerHTML = '<p class="txt">' + esc(t('ltPasteManyRule')) + '</p><div class="fld" data-part="studio-field"><label for="pmTa" data-part="studio-field-label">' + esc(t('ltPasteManyLbl')) + '</label><textarea data-part="studio-field-control" id="pmTa" rows="7" data-autofocus="1" placeholder="' + esc(t('ltPasteManyPh')) + '"></textarea></div><label class="pm-opt" data-part="studio-lt-paste-option" for="pmDash"><input type="checkbox" id="pmDash"><span>' + esc(t('ltPmDash')) + '</span></label><p class="pm-hint" data-part="studio-lt-paste-hint" id="pmDashHint">' + esc(t('ltPmDashHint')) + '</p><p class="pm-count" data-part="studio-lt-paste-count" id="pmCount" role="status" aria-live="polite"></p><ol class="pm-prev" data-part="studio-lt-paste-preview" id="pmPrev" aria-label="' + esc(t('ltPmPreview')) + '"></ol><div class="confirm-row"><button type="button" class="btn" data-x="cancel">' + ic('x', 16) + '<span>' + esc(t('ltPmCancel')) + '</span></button><button type="button" class="btn primary" data-x="apply" aria-disabled="true">' + ic('plus', 16) + '<span>' + esc(t('ltPmApply')) + '</span></button></div>';
      const root = document.createElement('div'); root.classList.add('lt-contents');   /* DD-200: was an inline display: contents */ while (body.firstChild) root.appendChild(body.firstChild); body.appendChild(root);   // #sheetBody is reused by every sheet: the click listener lives on this wrapper, not on the body
      const dashEl = $('#pmDash', root), ta = $('#pmTa', root), cnt = $('#pmCount', root), prev = $('#pmPrev', root), ok = $('[data-x="apply"]', root); let parts = [];
      const draw = () => { parts = C.splitMany(ta.value, { dash: dashEl.checked }); cnt.textContent = ta.value.trim() ? (parts.length ? t('ltPmCount', { n: parts.length }) : t('ltPmNone')) : ''; prev.innerHTML = parts.slice(0, 12).map((x) => '<li data-part="studio-lt-paste-item"><span class="pm-t" data-part="studio-lt-paste-item-title">' + esc(C.firstLine(x, 60)) + '</span><small>' + esc(t('ltPmLines', { n: x.split('\n').length })) + '</small></li>').join('') + (parts.length > 12 ? '<li class="pm-more" data-part="studio-lt-paste-more">' + esc(t('ltProbMore', { n: parts.length - 12 })) + '</li>' : ''); ok.setAttribute('aria-disabled', String(!parts.length)); };
      ta.addEventListener('input', draw); dashEl.addEventListener('change', draw); dashEl.setAttribute('aria-describedby', 'pmDashHint');
      root.addEventListener('click', (e) => { const b = e.target.closest('[data-x]'); if (!b) return; if (b.dataset.x === 'cancel') A.closeSheet(true); else if (parts.length) { A.closeSheet(false); opPasteMany(itemId, parts); } });
    } });
  }
  function opPasteMany(itemId, parts) {
    LT.flushAll(); const f = cur(itemId); if (!f) return; const n0 = altsOf(f.it).length;
    write(itemId, t('ltStepAltPaste'), (it) => { it.f.alts = altsOf(it).concat(parts); }); const us = (LT.uids[itemId + ':alts'] || []).slice(); parts.forEach(() => us.push(newUid())); LT.uids[itemId + ':alts'] = us;
    renderAlts(itemId, { uid: us[n0] }); A.toast(t('ltPmDone', { n: parts.length }), { ms: 3500 }); announce(t('ltPmDone', { n: parts.length }));
  }

  /* ---------------------------------------------------------------- events (one set per section, bound when the section is first built) */
  function itemIdOf() { return S.open; }
  function cardOf(el) { const c = el.closest && el.closest('.lt-card'); return c ? { c, kind: c.dataset.ltKind, uid: c.dataset.uid } : null; }
  function openCardMenu(kind, u, opener) {
    const itemId = itemIdOf(), f = cur(itemId); if (!f) return; const items = []; let i, n;
    if (kind === 'alts') { i = altIndex(itemId, u); n = altsOf(f.it).length; } else { const M = exModel(f.it), k = exCardIndex(itemId, u), c = M.cards[k]; if (!c) return;
      if (c.type === 'pre') { A.openMenu(opener, t('ltCardMenu'), [['message-square', t('ltConvertStart'), () => opConvertPre(itemId, u)], ['trash-2', t('ltDelete'), () => opDelete('ex', itemId, u), 'danger']]); return; }
      i = c.bi; n = M.X.blocks.length; }
    const dis = (x) => (x ? { 'aria-disabled': 'true' } : {});
    items.push(['copy', t('ltDup'), () => opDup(kind, itemId, u)], ['arrow-up', t('ltUp'), () => opMove(kind, itemId, u, -1, { ctl: 'menu' }), '', dis(i <= 0)], ['arrow-down', t('ltDown'), () => opMove(kind, itemId, u, 1, { ctl: 'menu' }), '', dis(i >= n - 1)]);
    if (kind === 'alts') items.push(['star', t('ltMakeMain'), () => opMakeMain(itemId, u)]);
    items.push(['trash-2', t('ltDelete'), () => opDelete(kind, itemId, u), 'danger']); A.openMenu(opener, t('ltCardMenu'), items);
  }
  document.addEventListener('click', (e) => {
    const v = e.target.closest('[data-lt-view]'); if (v) { const [kind, view] = v.dataset.ltView.split(':'); if (LT.view[kind] !== view) { LT.flushAll(); LT.view[kind] = view; renderEx(itemIdOf(), null); const nb = $('[data-lt-view="' + kind + ':' + view + '"]'); if (nb) nb.focus({ preventScroll: true }); announce(t(view === 'list' ? 'ltViewList' : 'ltViewText')); } return; }
    const ad = e.target.closest('[data-lt-add]'); if (ad) { opAdd(ad.dataset.ltAdd, itemIdOf()); return; }
    const pm = e.target.closest('[data-lt-pastemany]'); if (pm) { openPasteMany(itemIdOf(), pm); return; }
    const b = e.target.closest('[data-lt-card-act]'); if (!b) return; const cd = cardOf(b); if (!cd) return; const a = b.dataset.ltCardAct, F = [...LT.fields.values()].find((x) => x.ta.id === 'ltta-' + cd.uid);
    if (a === 'menu') openCardMenu(cd.kind, cd.uid, b); else if (a === 'focus' && F) LT.openFocus(F, b); else if (a === 'preview' && F) LT.showPreview(F, b);
  });
  /* drag to reorder (fine pointer only; the menu and Alt+Up/Down on the handle are the other ways) */
  (function () {
    let d = null; const host = document;
    const dropAt = (x, y) => { if (!d) return; $$('.lt-card.drop-before, .lt-card.drop-after').forEach((q) => q.classList.remove('drop-before', 'drop-after')); const hit = document.elementsFromPoint(x, y).find((q) => q.classList && q.classList.contains('lt-card') && q !== d.card && q.dataset.ltKind === d.card.dataset.ltKind && !q.classList.contains('opening')); if (hit) { const r = hit.getBoundingClientRect(); d.target = hit; d.pos = y < r.top + r.height / 2 ? 'before' : 'after'; hit.classList.add('drop-' + d.pos); } else d.target = null; };
    host.addEventListener('pointerdown', (e) => { const g = e.target.closest && e.target.closest('.lt-grip'); if (!g || e.pointerType === 'touch' || e.button) return; const card = g.closest('.lt-card'); if (!card) return; d = { card, y0: e.clientY, id: e.pointerId, moved: false, target: null, pos: null }; try { g.setPointerCapture(e.pointerId); } catch (_) {} e.preventDefault(); });
    host.addEventListener('pointermove', (e) => { if (!d || e.pointerId !== d.id) return; if (!d.moved && Math.abs(e.clientY - d.y0) > 4) { d.moved = true; d.card.classList.add('dragging'); } if (!d.moved) return; d.card.style.transform = 'translateY(' + (e.clientY - d.y0) + 'px)'; dropAt(e.clientX, e.clientY); });
    const end = (e, cancel) => { if (!d || e.pointerId !== d.id) return; const x = d; d = null; x.card.classList.remove('dragging'); x.card.style.transform = ''; $$('.lt-card.drop-before, .lt-card.drop-after').forEach((q) => q.classList.remove('drop-before', 'drop-after')); if (!cancel && x.moved && x.target) dropMove(x.card.dataset.ltKind, x.card.dataset.uid, x.target.dataset.uid, x.pos); };
    host.addEventListener('pointerup', (e) => end(e, false)); host.addEventListener('pointercancel', (e) => end(e, true));
  })();
  function dropMove(kind, from, to, pos) {
    const itemId = itemIdOf(), f = cur(itemId); if (!f) return; LT.flushAll();
    if (kind === 'alts') { const us = LT.uids[itemId + ':alts'], i = us.indexOf(from), j = us.indexOf(to); if (i < 0 || j < 0) return; let dest = j + (pos === 'after' ? 1 : 0); if (i < dest) dest--; if (dest === i) return; write(itemId, t('ltStepAltMove'), (it) => { const a = altsOf(it).slice(), [x] = a.splice(i, 1); a.splice(dest, 0, x); it.f.alts = a; }); const [x] = us.splice(i, 1); us.splice(dest, 0, x); renderAlts(itemId, { uid: from, ctl: 'grip' }); }
    else { const M = exModel(f.it), us = LT.uids[itemId + ':ex'], i = us.indexOf(from), j = us.indexOf(to), ci = M.cards[i], cj = M.cards[j]; if (!ci || !cj || ci.type === 'pre' || cj.type === 'pre') return; let dest = cj.bi + (pos === 'after' ? 1 : 0); if (ci.bi < dest) dest--; if (dest === ci.bi) return; const blocks = M.X.blocks.slice(), [x] = blocks.splice(ci.bi, 1); blocks.splice(dest, 0, x); write(itemId, t('ltStepExMove'), (it) => { setExamples(it, M.X.pre, blocks); }); const off = M.cards[0].type === 'pre' ? 1 : 0, [u] = us.splice(ci.bi + off, 1); us.splice(dest + off, 0, u); renderEx(itemId, { uid: from, ctl: 'grip' }); }
    announce(t('ltMoved'));
  }
  LT.dropMove = dropMove;
  /* Alt+Up/Down moves a card only while focus is on its handle or its menu button: inside the text the keys keep their editing meaning (macOS option-arrows) */
  LT.listKey = (e) => {
    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return false; const tg = e.target; if (!tg || !tg.closest || tg.matches('textarea, input')) return false;
    const cd = cardOf(tg); if (!cd || !(tg.matches('.lt-grip') || tg.matches('[data-lt-card-act="menu"]'))) return false;
    e.preventDefault(); opMove(cd.kind, itemIdOf(), cd.uid, e.key === 'ArrowUp' ? -1 : 1, { ctl: tg.matches('.lt-grip') ? 'grip' : 'menu' }); return true;
  };
  LT.gotoCard = (list, card, pos) => {
    const itemId = itemIdOf(), f = cur(itemId); if (!f) return; if (list === 'examples' && LT.view.ex === 'text') { const F = LT.fields.get('ex-text:' + itemId); if (F) LT.gotoPos(F, pos || 0); return; }
    if (list === 'alts') { const u = (LT.uids[itemId + ':alts'] || [])[card || 0], F = [...LT.fields.values()].find((x) => x.ta.id === 'ltta-' + u); if (F) LT.gotoPos(F, pos || 0); return; }
    const M = exModel(f.it); let start = M.X.pre.length, k = -1, bi = -1; const off = M.cards[0] && M.cards[0].type === 'pre' ? 1 : 0;
    if (pos < M.X.pre.length && off) k = 0; else { for (let b = 0; b < M.X.blocks.length; b++) { const end = start + M.X.blocks[b].length; if (pos >= start && pos < end) { bi = b; break; } start = end; } if (bi < 0) bi = M.X.blocks.length - 1; k = bi + off; }
    const u = (LT.uids[itemId + ':ex'] || [])[k], F = [...LT.fields.values()].find((x) => x.ta.id === 'ltta-' + u); if (!F) return; let o = 0; if (bi >= 0) { const raw = M.X.blocks[bi]; o = Math.max(0, Math.min(F.ta.value.length, pos - start - (raw.length - C.blockBody(raw).length))); } LT.gotoPos(F, o);
  };
  LT.mountLists = (it, o, host) => { LT.listItem = it.id; uidsFor(it.id + ':alts', altsOf(it).length); uidsFor(it.id + ':ex', exModel(it).cards.length); renderAlts(it.id, null); renderEx(it.id, null); };
  LT.rerenderLists = (itemId) => { LT.flushAll(); LT.uids[itemId + ':alts'] = []; LT.uids[itemId + ':ex'] = []; renderAlts(itemId, null); renderEx(itemId, null); };
  LT.listOps = { add: opAdd, move: opMove, dup: opDup, del: opDelete, restore, makeMain: opMakeMain, dropMove, pasteMany: opPasteMany, openPasteMany };
})();
