/* Studio slice 4, part 4: the Display form (SLICE4_SPEC section 5) and the simulated images and assets (section 7). Three segments (Portrait / Screen / Assets); the main portrait, alternates with a menu (no hidden remove mode);
   the screen mode with its default wording made visible; emotion image rows (add several, rename, reorder, durable delete); additional assets (thumbnails always, audio and video on tap, "used in", rename warning).
   NO real file, file picker, storage or network is touched: images are tinted tiles, the picker is a sheet of invented sample files, every delay is a timer. Synthetic. */
(function () {
  'use strict';
  const ST = window.__st1, A = ST.api, S = A.S, LT = window.LTX, S4 = window.__st4, DD = window.StudioData4;
  const { nm, ic, esc, $, $$ } = A; const t = (k, v) => A.t(k, v);
  const K = S4.core, H = S4.h, BY = S4.BYKEY, dr = K.dr;
  const ALLOW = { portrait: ['png', 'webp', 'gif', 'jpg', 'jpeg'], emotion: ['png', 'webp', 'gif'], asset: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'mp3', 'wav', 'mp4', 'webm', 'ttf', 'otf', 'woff2', 'css'] };
  ALLOW.group = ALLOW.portrait; S4.ALLOW = ALLOW;
  const IMG = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg'], AUD = ['mp3', 'wav'], VID = ['mp4', 'webm'];
  const typeOf = (ext) => { ext = String(ext).toLowerCase(); return IMG.includes(ext) ? 'image' : AUD.includes(ext) ? 'audio' : VID.includes(ext) ? 'video' : ext === 'css' ? 'css' : 'font'; };
  const TYPE_IC = { audio: 'music', video: 'video', font: 'type', css: 'file-code' };
  const defText = (k) => DD.DEFAULTS[k][S.lang];
  const newId = () => 'n' + (++S4.seq);
  const fileOf = (f) => f.name + '.' + f.ext;
  S4.typeOf = typeOf;

  /* ---------------------------------------------------------------- the simulated picker (a sheet of invented sample files; nothing real is read) */
  function openPicker(opt) {
    const oid = S4.cur.oid, files = DD.pickerFiles(S.lang), v = dr(oid), single = !opt.multi; v.pick = new Set();
    A.openSheet({ title: t('fPickTitle'), opener: opt.opener, cls: 'dlg tall', build(body) {
      const root = document.createElement('div'); root.className = 'studio-sheet-root'; body.appendChild(root);   /* #sheetBody is reused by every sheet: the listeners live on this wrapper */
      root.innerHTML = '<div class="studio-image-picker" data-part="studio-image-picker" data-mode="' + opt.mode + '"><p class="txt">' + esc(t('s4PickHint')) + '</p><ul class="studio-pick-list" role="list" tabindex="-1" data-autofocus="1" aria-label="' + esc(t('fPickTitle')) + '">' +
        files.map((f) => '<li><label class="studio-image-picker-item" data-part="studio-image-picker-item" data-id="' + f.id + '"><input type="' + (single ? 'radio' : 'checkbox') + '" name="s4pick" value="' + f.id + '">' + H.tile(f, { type: typeOf(f.ext) === 'image' ? null : TYPE_IC[typeOf(f.ext)], ic: 20 }) + '<span class="studio-pick-name"><span class="n">' + esc(fileOf(f)) + '</span><span class="m">' + esc(t('s4Ext', { ext: f.ext, size: t('s4FakeKb', { n: f.size }) })) + '</span></span></label></li>').join('') + '</ul>' +
        '<div class="confirm-row"><button type="button" class="btn primary" data-x="add" aria-disabled="true">' + ic('plus', 18) + '<span>' + esc(t('s4PickSelected', { n: 0 })) + '</span></button><button type="button" class="btn" data-x="close">' + ic('x', 18) + '<span>' + esc(t('fPickClose')) + '</span></button></div></div>';
      const addB = root.querySelector('[data-x="add"]'), sync = () => { addB.setAttribute('aria-disabled', String(!v.pick.size)); addB.querySelector('span').textContent = t('s4PickSelected', { n: v.pick.size }); };
      root.addEventListener('change', (e) => { const i = e.target.closest('input'); if (!i) return; if (single) v.pick = new Set([i.value]); else if (i.checked) v.pick.add(i.value); else v.pick.delete(i.value); sync(); });
      root.addEventListener('click', (e) => {
        if (e.target.closest('[data-x="close"]')) { v.pick = null; A.closeSheet(true); return; }
        if (e.target.closest('[data-x="add"]')) { if (!v.pick.size) return; const sel = files.filter((f) => v.pick.has(f.id)); v.pick = null; A.closeSheet(false); opt.onAdd(sel); }
      });
    } });
  }
  S4.openPicker = openPicker;

  /* ---------------------------------------------------------------- import: per-file results (stored, wrong type, store failure) instead of all-or-nothing. A synthetic 400 ms per file */
  function startImport(oid, mode, files, onOk) {
    const v = dr(oid), allowed = ALLOW[mode]; S4.cur.focusAdd = mode === 'portrait' || mode === 'group' ? 'mainPortrait' : mode === 'emotion' ? 'emotions' : 'assets';
    const plan = files.map((f) => { const ext = String(f.ext).toLowerCase(); return !allowed.includes(ext) ? { f, res: 'reject', why: t('fPickBadType', { ext: '.' + ext }) } : f.fail && !f.retry ? { f, res: 'fail' } : { f, res: 'ok' }; });
    const imp = { id: 'imp' + (++S4.seq), oid, mode, timer: null };   /* N-4: each import owns its timer and its rows; finishing one never touches another */
    const done = () => {
      clearTimeout(imp.timer); S4.imports.delete(imp.id); v.importing = v.importing.filter((r) => r.imp !== imp.id);
      const ok = plan.filter((p) => p.res === 'ok'), bad = plan.filter((p) => p.res !== 'ok');
      v.rejects = (v.rejects || []).concat(plan.filter((p) => p.res === 'reject').map((p) => ({ name: fileOf(p.f), why: p.why })));
      v.failed = (v.failed || []).concat(plan.filter((p) => p.res === 'fail').map((p) => ({ id: newId(), f: p.f, mode })));
      const here = S4.viewing(oid, 'display');
      if (here) {   /* the form is open: redraw it, and give the caret back to the field the author is typing in */
        const ae = document.activeElement, host = $('#formHost'), keep = ae && ae.id && host.contains(ae) && /^(INPUT|TEXTAREA)$/.test(ae.tagName) ? { id: ae.id, s: ae.selectionStart, e: ae.selectionEnd } : null;
        if (ok.length) onOk(ok.map((p) => p.f)); else K.rerender();
        if (keep) { const el = document.getElementById(keep.id); if (el && el !== document.activeElement) { el.focus({ preventScroll: true }); try { el.setSelectionRange(keep.s, keep.e); } catch (_) {} } }
      } else if (ok.length) { S4.quiet = true; try { onOk(ok.map((p) => p.f)); } finally { S4.quiet = false; } A.renderTree(); }   /* N-3: the step and the tree only; no form is redrawn, no focus moves */
      const msg = bad.length ? t('fPickResult', { n: ok.length, m: bad.length }) : t('s4PickOk', { n: ok.length }); if (S.inStudio) S4.say(msg); else S4.last = msg; S4.lastImport = { ok: ok.length, bad: bad.length, away: !here, closed: !S.inStudio };
      if (!here) {
        v.keepOnce = true; const dit = K.itemOf(oid, 'display');
        const open = () => { if (!dit) return; K.uiOf(oid).seg = mode === 'asset' ? 'assets' : mode === 'emotion' ? 'screen' : 'photo'; K.saveUI(); if (!S.inStudio) ST.enter({ from: S.from || 'chat', at: { char: oid } }); A.openItem(dit.id, { focus: true, user: true }); };
        if (S.inStudio) A.toast(msg, { ms: 7000, action: { label: t('s4ImportOpen'), fn: open } });
        else ST.appToast(msg, { ms: 9000, action: { label: t('s4ImportOpenApp'), fn: open } });   /* DD-196: Studio is closed: the app-wide toast, with the way back */
      }
    };
    const pending = plan.filter((p) => p.res !== 'reject');
    if (S4.importMs > 0 && pending.length) { v.importing = v.importing.concat(pending.map((p) => ({ id: newId(), imp: imp.id, name: p.f.name, ext: p.f.ext, tone: p.f.tone, mode }))); S4.imports.set(imp.id, imp); K.rerender(); imp.timer = setTimeout(done, S4.importMs * pending.length); } else done();
  }
  S4.imports = new Map();
  S4.startImport = startImport;
  const spin = () => (S.rm || S.lp ? '' : ic('loader', 14, 'spin'));   /* reduced motion and low power: the words only */
  const entry = (f) => ({ id: newId(), name: f.name, ext: f.ext, size: f.size, tone: f.tone || ((S4.seq % 6) + 1), state: 'ok' });
  const hasPng = (files) => files.some((f) => String(f.ext).toLowerCase() === 'png');

  /* ---------------------------------------------------------------- generic list operations (emotion images, assets; the group form registers its members here too): move, drop, delete with a durable undo */
  const OPS = S4.rowOps = {};
  OPS.emotions = { kind: 'display', key: 'emotions', rowSel: '.studio-emotion-row', add: '[data-focus="emotions"]', nameOf: (e) => e.name, moveLabel: 's4StepEmotionMove', delLabel: 's4StepEmotionDel' };
  OPS.assets = { kind: 'display', key: 'assets', rowSel: '.studio-asset-row', add: '[data-focus="assets"]', nameOf: (e) => e.name, moveLabel: 's4StepAssetMove', delLabel: 's4StepAssetDel' };
  const arr = (list, oid) => K.fOf(oid, OPS[list].kind)[OPS[list].key] || [];
  const setArr = (list, oid, a, label) => K.W(oid, OPS[list].kind, t(label), (f) => { f[OPS[list].key] = a; });
  function focusRow(list, id, ctl) {
    const o = OPS[list]; const sel = ctl === 'menu' ? '.studio-row-menu' : '.studio-row-handle'; const el = $(o.rowSel + '[data-row="' + id + '"] ' + sel, $('#formHost')) || $(o.rowSel + '[data-row="' + id + '"] ' + '.studio-row-menu', $('#formHost')); if (el) el.focus({ preventScroll: false });
  }
  function moveRow(list, oid, id, dir, ctl) {
    const o = OPS[list]; if (o.move) return o.move(oid, id, dir, ctl); const a = arr(list, oid).slice(), i = a.findIndex((x) => x.id === id), j = i + dir; if (i < 0) return;
    if (j < 0 || j >= a.length) { S4.say(t('ltMoveEnd')); return; }
    [a[i], a[j]] = [a[j], a[i]]; setArr(list, oid, a, o.moveLabel); K.rerender(() => null); focusRow(list, id, ctl); S4.say(t('s4MovedAnn', { name: o.nameOf(a[j]), n: j + 1 }));
  }
  function dropRow(list, oid, from, to, pos) {
    const o = OPS[list]; const a = arr(list, oid).slice(), i = a.findIndex((x) => x.id === from), j = a.findIndex((x) => x.id === to); if (i < 0 || j < 0) return; let dest = j + (pos === 'after' ? 1 : 0); if (i < dest) dest--; if (dest === i) return;
    const [x] = a.splice(i, 1); a.splice(dest, 0, x); if (o.set) o.set(oid, a, o.moveLabel); else setArr(list, oid, a, o.moveLabel); K.rerender(() => null); focusRow(list, from, 'handle'); S4.say(t('s4MovedAnn', { name: o.nameOf(x), n: dest + 1 }));
  }
  function delRow(list, oid, id) {
    const o = OPS[list]; if (o.del) return o.del(oid, id); const a = arr(list, oid), i = a.findIndex((x) => x.id === id); if (i < 0) return; const rem = JSON.parse(JSON.stringify(a[i]));
    setArr(list, oid, a.filter((x) => x.id !== id), o.delLabel); A.renderTree(); const alive = S4.undoGuard(oid);
    const left = arr(list, oid); const next = left[i] || left[i - 1];
    K.rerender(() => (next ? $(o.rowSel + '[data-row="' + next.id + '"] .studio-row-handle', $('#formHost')) : $(o.add, $('#formHost'))));
    const msg = t('s4Deleted', { name: o.nameOf(rem) }); S4.say(msg);
    A.toast(msg, { ms: 10000, endsOnClose: true, action: { label: t('undoBtn'), fn: () => { if (!alive() || arr(list, oid).some((x) => x.id === rem.id)) return; const cur = arr(list, oid).slice(); cur.splice(Math.min(i, cur.length), 0, rem); setArr(list, oid, cur, 's4StepRestoreRow'); A.renderTree(); K.rerender(() => $(o.rowSel + '[data-row="' + rem.id + '"] .studio-row-handle', $('#formHost'))); } } });
  }
  S4.moveRow = moveRow; S4.delRow = delRow; S4.dropRow = dropRow;
  /* the menu a row's ... button opens */
  S4.acts.rowmenu = (b) => {
    const oid = S4.cur.oid, list = b.dataset.list, id = b.dataset.id, o = OPS[list]; const a = (o.get ? o.get(oid) : arr(list, oid)), i = a.findIndex((x) => x.id === id); if (i < 0) return;
    const items = (o.menu ? o.menu(oid, id, i, a) : []).concat([]);
    const std = [['up', 'arrow-up', t('moveUp'), () => moveRow(list, oid, id, -1, 'menu'), '', i <= 0 ? { 'aria-disabled': 'true' } : {}], ['down', 'arrow-down', t('moveDown'), () => moveRow(list, oid, id, 1, 'menu'), '', i >= a.length - 1 ? { 'aria-disabled': 'true' } : {}], ['del', 'trash-2', o.delText ? t(o.delText) : t('del'), () => delRow(list, oid, id), 'danger']];
    A.openMenu(b, t('s4MenuOf', { name: o.nameOf(a[i]) }), items.concat(std.filter((x) => !(o.hide && o.hide.includes(x[0]))).map((x) => x.slice(1))));
  };
  /* Alt+Up / Alt+Down only while the handle or the ... button has focus: inside a text field the keys keep their meaning */
  S4.keys.rows = (e) => {
    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return false;
    const b = e.target.closest && e.target.closest('.studio-row-handle, .studio-row-menu'); if (!b) return false; const list = b.dataset.list; if (!OPS[list]) return false;
    e.preventDefault(); moveRow(list, S4.cur.oid, b.dataset.id, e.key === 'ArrowUp' ? -1 : 1, b.classList.contains('studio-row-menu') ? 'menu' : 'handle'); return true;
  };
  /* drag by the handle (fine pointer): the row follows the pointer unless motion is reduced; the drop is one instant move */
  (function () {
    let d = null; const host = document;
    host.addEventListener('pointerdown', (e) => { const g = e.target.closest && e.target.closest('.studio-row-handle'); if (!g || e.pointerType === 'touch' || e.button || !$('#formHost').contains(g)) return; const row = g.closest('[data-row]'); if (!row) return; d = { row, list: g.dataset.list, from: g.dataset.id, y0: e.clientY, id: e.pointerId, moved: false, target: null, pos: null }; try { g.setPointerCapture(e.pointerId); } catch (_) {} e.preventDefault(); });
    host.addEventListener('pointermove', (e) => {
      if (!d || e.pointerId !== d.id) return; if (!d.moved && Math.abs(e.clientY - d.y0) > 4) { d.moved = true; d.row.dataset.dragging = 'true'; } if (!d.moved) return; if (!S.rm) d.row.style.transform = 'translateY(' + (e.clientY - d.y0) + 'px)';
      $$('[data-drop]', $('#formHost')).forEach((q) => q.removeAttribute('data-drop')); const hit = document.elementsFromPoint(e.clientX, e.clientY).find((q) => q.dataset && q.dataset.row && q !== d.row && q.dataset.list === d.list);
      if (hit) { const r = hit.getBoundingClientRect(); d.target = hit; d.pos = e.clientY < r.top + r.height / 2 ? 'before' : 'after'; hit.dataset.drop = d.pos; } else d.target = null;
    });
    const end = (e, cancel) => { if (!d || e.pointerId !== d.id) return; const x = d; d = null; x.row.removeAttribute('data-dragging'); x.row.style.transform = ''; $$('[data-drop]', $('#formHost')).forEach((q) => q.removeAttribute('data-drop')); if (!cancel && x.moved && x.target) { const o = OPS[x.list]; dropRow(x.list, S4.cur.oid, x.from, x.target.dataset.row, x.pos); } };
    host.addEventListener('pointerup', (e) => end(e, false)); host.addEventListener('pointercancel', (e) => end(e, true));
  })();

  /* ---------------------------------------------------------------- text-field scan: where an asset name is used (chunked and cancellable, derived from the store on every render) */
  function textFields(oid) {
    const o = A.O(oid), out = []; const add = (key, label, itemId, text, extra) => { if (txt(text)) out.push(Object.assign({ key, label, itemId, text: String(text) }, extra || {})); }; const txt = K.txt;
    const b = K.itemOf(oid, 'basic'), a = K.itemOf(oid, 'advanced'), dd = K.itemOf(oid, 'display');
    if (b && o.type === 'char') { add('desc', t('fl_desc'), b.id, b.f.description); add('firstMessage', t('fl_firstMessage'), b.id, b.f.first); (b.f.alts || []).forEach((s, i) => add('alternateGreetings', t('fl_alternateGreetings') + ' ' + (i + 1), b.id, s, { card: i })); }
    if (a && o.type === 'char') {
      ['systemPrompt', 'replaceGlobalNote', 'additionalText', 'personality', 'scenario', 'depth_prompt', 'exampleMessage', 'defaultVariables', 'translatorNote'].forEach((k) => add(k, t('fl_' + k), a.id, a.f[BY[k].sk]));   /* re-review m-2: default variables and the translator note are text too */
      Object.keys(a.f.creatorNotes || {}).forEach((l) => add('creatorNotes', t('fl_creatorNotes') + ' · ' + l.toUpperCase(), a.id, a.f.creatorNotes[l], { lang: l }));   /* ... and so are the creator comments, one per language */
    }
    if (dd && o.type === 'char') ['emotionInstr', 'imgPrompt', 'imgNeg', 'imgInstr'].forEach((k) => add(k, t(BY[k].lab), dd.id, dd.f[k]));
    if (o.type === 'char') o.items.forEach((x) => {
      const kn = A.kindName(x.kind) + ' · ' + (nm(x.name) || A.kindName(x.kind)), add2 = (text, field) => add('item:' + x.id, kn, x.id, text, { itemKind: x.kind, field });
      if (x.kind === 'lore') { add2(x.f.keys, 'keys'); add2(x.f.content, 'content'); } else if (x.kind === 'regex') { add2(x.f.find, 'find'); add2(x.f.replace, 'replace'); } else if (x.kind === 'scripts') { add2(x.f.rules, 'rules'); if (x.code) add2(x.code.live, 'code'); }
    });
    return out;
  }
  const esc2 = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  function usesOf(oid, name) {
    if (!String(name).trim()) return []; const re = new RegExp('\\{\\{(?:image|img|bg|audio|video|raw|asset|emotion|inlay|source)::' + esc2(name) + '\\}\\}', 'g'), hits = [];
    textFields(oid).forEach((fd) => { let off = 0; fd.text.split('\n').forEach((line, li) => { re.lastIndex = 0; let m; while ((m = re.exec(line))) hits.push({ key: fd.key, label: fd.label, itemId: fd.itemId, line: li + 1, card: fd.card, field: fd.field, lang: fd.lang, pos: off + m.index }); off += line.length + 1; }); });
    return hits;
  }
  S4.usesOf = usesOf; S4.textFields = textFields;
  let scanGen = 0;
  function scan(oid) {
    const gen = ++scanGen, v = dr(oid), rows = (K.fOf(oid, 'display').assets || []).map((x) => ({ id: x.id, name: x.name })).concat(Object.keys(v.rename).map((id) => ({ id: 'old:' + id, name: v.rename[id] })));
    v.scan = {}; v.scanDone = false; let i = 0;
    const step = () => {
      if (gen !== scanGen || !document.getElementById('s4-assets-list')) return; const end = Math.min(rows.length, i + 4);
      for (; i < end; i++) { v.scan[rows[i].id] = usesOf(oid, rows[i].name); paintUses(oid, rows[i].id); }
      if (i < rows.length) setTimeout(step, 0); else { v.scanDone = true; }
    };
    setTimeout(step, 0);
  }
  function paintUses(oid, id) {
    const v = dr(oid), hits = v.scan[id]; if (!hits) return;
    const b = document.querySelector('[data-uses-btn="' + id + '"]'); if (b) { const n = hits.length; b.textContent = n ? t('fAssetUses', { n }) : t('s4UsesNone'); b.dataset.n = String(n); b.disabled = !n; b.setAttribute('aria-expanded', String(!!v.uses[id])); const li = b.closest('[data-row]'); if (li) li.dataset.uses = String(n); }
    refreshRenameNote(oid, id.replace(/^old:/, ''));
  }
  function refreshRenameNote(oid, id) {
    const v = dr(oid), a = (K.fOf(oid, 'display').assets || []).find((x) => x.id === id); if (!a) return; const oldName = v.rename[id]; const p = document.getElementById('s4-an-' + id); if (!p) return;
    const hits = oldName != null && oldName !== a.name ? (v.scan && v.scan['old:' + id]) : null; const n = hits ? hits.length : 0; p.hidden = !n;
    if (n) { p.dataset.kind = 'info'; p.innerHTML = ic('info', 14) + '<span>' + esc(t('fAssetRenamed', { n })) + '</span><button type="button" class="btn-txt" data-s4-act="oldshow" data-id="' + id + '" aria-expanded="' + !!v.uses['old:' + id] + '">' + esc(t('s4Show')) + '</button>' + (v.uses['old:' + id] ? placesList(hits, 'old:' + id) : ''); } else p.innerHTML = '';
  }
  const placesList = (hits, id) => '<ul class="studio-places" role="list" aria-label="' + esc(t('s4UsesTitle', { name: '' }).trim()) + '">' + hits.map((h, i) => '<li><button type="button" class="studio-place" data-s4-act="usejump" data-id="' + id + '" data-i="' + i + '">' + ic('corner-down-right', 14) + '<span>' + esc(h.label + ' · ' + t('s4UsesLine', { n: h.line })) + '</span></button></li>').join('') + '</ul>';
  S4.acts.useshow = (b) => { const oid = S4.cur.oid, v = dr(oid), id = b.dataset.id; v.uses[id] = !v.uses[id]; let box = document.getElementById('s4-up-' + id); const hits = (v.scan && v.scan[id]) || []; if (!box) return; box.hidden = !v.uses[id]; box.innerHTML = v.uses[id] ? placesList(hits, id) : ''; b.setAttribute('aria-expanded', String(!!v.uses[id])); };
  S4.acts.oldshow = (b) => { const oid = S4.cur.oid, v = dr(oid), id = b.dataset.id; v.uses['old:' + id] = !v.uses['old:' + id]; refreshRenameNote(oid, id); const nb = document.querySelector('#s4-an-' + id + ' [data-s4-act="oldshow"]'); if (nb) nb.focus(); };
  S4.acts.usejump = (b) => {
    const oid = S4.cur.oid, v = dr(oid), id = b.dataset.id, hits = (v.scan && v.scan[id]) || (v.scan && v.scan['old:' + id.replace(/^old:/, '')]) || []; const h = hits[+b.dataset.i]; if (!h) return;
    if (String(h.key).indexOf('item:') === 0) {   /* m-1: the field the text is in, at the place, not the item's name */
      A.openItem(h.itemId, { focus: false, user: true });
      if (h.field === 'code' && ST.ED) { ST.ED.focus(); try { ST.ED.selectRange(h.pos, h.pos); } catch (_) {} return; }
      const F = LT.fields.get(h.itemId + ':' + h.field), el = $('#formHost [data-f="' + h.field + '"]');
      if (F && LT.gotoPos) LT.gotoPos(F, h.pos); else if (el && el.focus) { el.focus(); try { el.setSelectionRange(h.pos, h.pos); } catch (_) {} }
      return;
    }
    if (h.key === 'creatorNotes' && h.lang) { dr(oid).lang = h.lang; }
    S4.reveal(oid, h.key, { focus: true });
    if (h.key === 'alternateGreetings') { const el = $('#ltAlts'); if (el && LT.gotoCard) LT.gotoCard('alts', h.card, h.pos); } else { const sk = BY[h.key].sk, F = LT.fields.get(h.itemId + ':' + sk + (h.key === 'creatorNotes' && h.lang ? '.' + h.lang : '')) || LT.fields.get(h.itemId + ':' + sk); if (F) LT.gotoPos(F, h.pos); }
  };

  /* ---------------------------------------------------------------- rows */
  function emotionRows(oid, f, ro) {
    const list = f.emotions || [], names = {}; list.forEach((e) => { const k = String(e.name).trim().toLowerCase(); names[k] = (names[k] || 0) + 1; }); const imp = dr(oid).importing.filter((x) => x.mode === 'emotion');
    const rows = list.map((e) => {
      const dup = e.name.trim() && names[e.name.trim().toLowerCase()] > 1, failed = e.state === 'failed';
      return '<li class="studio-emotion-row" data-part="studio-emotion-row" role="listitem" data-row="' + e.id + '" data-list="emotions" data-image="' + (e.state || 'ok') + '">' + (ro ? '' : H.handleBtn('emotions', e.id, e.name)) + H.tile(e, { cls: 'studio-thumb-lg', ic: 26 }) +
        '<div class="studio-row-main"><label class="sr-only" for="s4-en-' + e.id + '">' + esc(t('fEmotionName')) + '</label><input type="text" id="s4-en-' + e.id + '" class="studio-input" data-part="studio-emotion-name" data-s4in="emName" data-id="' + e.id + '" value="' + esc(e.name) + '" placeholder="' + esc(t('fEmotionName')) + '" autocomplete="off" spellcheck="false"' + (ro ? ' disabled' : '') + '>' +
        '<span class="studio-row-meta">' + esc(t('s4Ext', { ext: e.ext, size: t('s4FakeKb', { n: e.size }) })) + '</span>' + (failed ? '<span class="studio-row-state" data-kind="error">' + ic('image-off', 14) + '<span>' + esc(t('fLoadFail')) + '</span></span>' : '') + '</div>' +
        (ro ? '' : H.menuBtn('emotions', e.id, e.name)) + '<p class="studio-field-note" data-part="studio-field-note" data-kind="info" id="s4-ed-' + e.id + '"' + (dup ? '' : ' hidden') + '>' + (dup ? ic('info', 14) + '<span>' + esc(t('fEmotionDup')) + '</span>' : '') + '</p></li>';
    }).concat(imp.map((x) => '<li class="studio-emotion-row" data-part="studio-emotion-row" role="listitem" data-row="' + x.id + '" data-image="loading">' + H.tile(x, { state: 'loading', cls: 'studio-thumb-lg' }) + '<div class="studio-row-main"><span class="studio-row-state" role="status">' + spin() + esc(t('s4Importing', { name: x.name })) + '</span></div></li>'));
    return '<ul class="studio-emotion-list" id="s4-emotions-list" role="list" aria-label="' + esc(t('s4EmotionList')) + '">' + rows.join('') + '</ul>' + (list.length || imp.length ? '' : '<p class="studio-empty-line">' + ic('image', 16) + '<span>' + esc(t('fNoImages')) + '</span></p>') + '<p class="studio-field-note" data-part="studio-field-note" data-kind="info">' + esc(t('s4EmotionHint')) + '</p>';
  }
  function refreshEmotionDups(oid) {
    const list = K.fOf(oid, 'display').emotions || [], names = {}; list.forEach((e) => { const k = String(e.name).trim().toLowerCase(); names[k] = (names[k] || 0) + 1; });
    list.forEach((e) => { const p = document.getElementById('s4-ed-' + e.id); if (!p) return; const dup = e.name.trim() && names[e.name.trim().toLowerCase()] > 1; p.hidden = !dup; p.innerHTML = dup ? ic('info', 14) + '<span>' + esc(t('fEmotionDup')) + '</span>' : ''; });
  }
  S4.ins.emName = (el) => { const oid = S4.cur.oid, id = el.dataset.id, v = el.value; K.W(oid, 'display', t('s4StepEmotionName'), (f) => { const e = (f.emotions || []).find((x) => x.id === id); if (e) e.name = v; }, 'em.' + id); refreshEmotionDups(oid); };
  function assetRows(oid, f, ro) {
    const list = f.assets || [], v = dr(oid), pv = S4.settings.previewSetting; const imp = v.importing.filter((x) => x.mode === 'asset');
    const rows = list.map((e) => {
      const ty = typeOf(e.ext), media = ty === 'audio' || ty === 'video', excl = !!e.exclude, playing = !!v.preview[e.id];
      return '<li class="studio-asset-row" data-part="studio-asset-row" role="listitem" data-row="' + e.id + '" data-list="assets" data-type="' + ty + '"' + (excl ? ' data-excluded="true"' : '') + '>' + (ro ? '' : H.handleBtn('assets', e.id, e.name)) + H.tile(e, { type: ty === 'image' ? null : TYPE_IC[ty], cls: 'studio-thumb-lg', ic: 26, part: ty === 'image' ? 'studio-thumb' : 'studio-thumb-placeholder' }) +
        '<div class="studio-row-main"><label class="sr-only" for="s4-an-in-' + e.id + '">' + esc(t('s4Name')) + '</label><input type="text" id="s4-an-in-' + e.id + '" class="studio-input" data-part="studio-asset-name" data-s4in="assetName" data-id="' + e.id + '" value="' + esc(e.name) + '" autocomplete="off" spellcheck="false"' + (ro ? ' disabled' : '') + '>' +
        '<span class="studio-row-meta">' + esc(t('s4Ext', { ext: e.ext, size: t('s4FakeKb', { n: e.size }) })) + (excl ? ' · ' + esc(t('s4PreviewExcluded')) : '') + '</span>' +
        '<button type="button" class="btn-txt studio-uses-btn" data-uses-btn="' + e.id + '" data-s4-act="useshow" data-id="' + e.id + '" aria-expanded="false" aria-controls="s4-up-' + e.id + '" disabled>' + esc(t('s4Counting')) + '</button>' +
        (media ? '<button type="button" class="btn sm studio-preview-btn" data-s4-act="mediaplay" data-id="' + e.id + '" aria-pressed="' + playing + '">' + ic(playing ? 'pause' : 'play', 16) + '<span>' + esc(playing ? t('s4Stop') : t('s4Preview')) + '</span></button>' + (playing ? '<div class="studio-media" role="group" aria-label="' + esc(e.name) + '" data-playing="true"><span class="studio-media-bar"></span><span class="sr-only">' + esc(t('fPlay')) + '</span></div>' : '') : '') + '</div>' +
        (ro ? '' : H.menuBtn('assets', e.id, e.name)) + '<div class="studio-uses-box" id="s4-up-' + e.id + '" hidden></div><p class="studio-field-note" data-part="studio-field-note" id="s4-an-' + e.id + '" hidden></p></li>';
    }).concat(imp.map((x) => '<li class="studio-asset-row" data-part="studio-asset-row" role="listitem" data-row="' + x.id + '" data-image="loading">' + H.tile(x, { state: 'loading', cls: 'studio-thumb-lg' }) + '<div class="studio-row-main"><span class="studio-row-state" role="status">' + spin() + esc(t('s4Importing', { name: x.name })) + '</span></div></li>'));
    return '<ul class="studio-asset-list" id="s4-assets-list" role="list" aria-label="' + esc(t('s4AssetList')) + '">' + rows.join('') + '</ul>' + (list.length || imp.length ? '' : '<p class="studio-empty-line">' + ic('image', 16) + '<span>' + esc(t('fNoImages')) + '</span></p>');
  }
  S4.ins.assetName = (el) => { const oid = S4.cur.oid, id = el.dataset.id, v = el.value; K.W(oid, 'display', t('s4StepAssetName'), (f) => { const e = (f.assets || []).find((x) => x.id === id); if (e) e.name = v; }, 'as.' + id); const w = dr(oid); w.scan = w.scan || {}; w.scan[id] = usesOf(oid, v); paintUses(oid, id); w.scan['old:' + id] = w.rename[id] != null ? usesOf(oid, w.rename[id]) : []; refreshRenameNote(oid, id); };
  S4.chg['in:assetName'] = (el) => { const oid = S4.cur.oid, id = el.dataset.id, v = dr(oid); if (v.rename[id] == null) v.rename[id] = el.value; if (v.scan && v.scan['old:' + id] == null) { v.scan['old:' + id] = usesOf(oid, el.value); } };
  S4.acts.mediaplay = (b) => { const oid = S4.cur.oid, id = b.dataset.id, v = dr(oid); v.preview[id] = !v.preview[id]; K.rerender('[data-s4-act="mediaplay"][data-id="' + id + '"]'); };
  OPS.assets.menu = (oid, id, i, a) => {
    const e = a[i], ty = typeOf(e.ext), items = [];
    if (ty === 'audio' || ty === 'video') items.push(['play', t('s4Preview'), () => S4.acts.mediaplay({ dataset: { id } }), '']);
    if (S4.settings.previewSetting) items.push([e.exclude ? 'eye' : 'eye-off', e.exclude ? t('fPreviewOn') : t('fPreviewOff'), () => { K.W(oid, 'display', t('s4StepAssetPreview'), (f) => { const x = (f.assets || []).find((y) => y.id === id); if (x) x.exclude = !x.exclude; }); K.rerender(() => $('.studio-asset-row[data-row="' + id + '"] .studio-row-menu', $('#formHost'))); }, '']);
    return items;
  };
  OPS.assets.get = (oid) => K.fOf(oid, 'display').assets || [];
  OPS.emotions.get = (oid) => K.fOf(oid, 'display').emotions || [];
  OPS.emotions.menu = () => [];

  /* ---------------------------------------------------------------- portraits */
  const portraitMenu = (id, isMain, name) => H.menuBtn(isMain ? 'portrait-main' : 'portrait', id, name);
  OPS['portrait-main'] = { kind: 'display', key: 'main', nameOf: (e) => e.name, get: (oid) => { const m = K.fOf(oid, 'display').main; return m ? [m] : []; }, hide: ['up', 'down', 'del'], rowSel: '', add: '[data-focus="mainPortrait"]', menu: (oid, id) => [['image', t('s4Replace'), () => addPhoto(S4.cur.oid, $('[data-focus="mainPortrait"]')), ''], ['trash-2', t('del'), () => delPortrait(oid, id), 'danger']] };
  OPS.portrait = { kind: 'display', key: 'alts', nameOf: (e) => e.name, get: (oid) => K.fOf(oid, 'display').alts || [], hide: ['up', 'down', 'del'], rowSel: '.studio-portrait-alt', add: '[data-focus="mainPortrait"]', menu: (oid, id) => [['star', t('fMakeMain'), () => makeMain(oid, id), ''], ['trash-2', t('del'), () => delPortrait(oid, id), 'danger']] };
  function addPhoto(oid, opener) { openPicker({ mode: 'portrait', multi: false, opener, onAdd: (files) => startImport(oid, 'portrait', files, (ok) => {
    const nf = entry(ok[0]); K.W(oid, 'display', t('s4StepPortraitAdd'), (f) => { if (f.main) f.alts = (f.alts || []).concat([f.main]); f.main = nf; }); const v = dr(oid); v.png = hasPng(ok) ? 3 : 0; A.renderTree();
    K.rerender('[data-focus="mainPortrait"]'); S4.say(t('s4PickOk', { n: 1 }));
  }) }); }
  function makeMain(oid, id) {
    K.W(oid, 'display', t('s4StepPortraitMain'), (f) => { const i = (f.alts || []).findIndex((x) => x.id === id); if (i < 0) return; const m = f.main, a = f.alts.slice(); f.main = a[i]; if (m) a[i] = m; else a.splice(i, 1); f.alts = a; });
    K.rerender('[data-focus="mainPortrait"]'); S4.say(t('s4StepPortraitMain'));
  }
  function delPortrait(oid, id) {
    const f0 = K.fOf(oid, 'display'), isMain = f0.main && f0.main.id === id; const rem = JSON.parse(JSON.stringify(isMain ? f0.main : (f0.alts || []).find((x) => x.id === id) || null)); if (!rem) return; const idx = isMain ? -1 : f0.alts.findIndex((x) => x.id === id);
    const alive = (() => { K.W(oid, 'display', t('s4StepPortraitDel'), (f) => { if (isMain) { f.main = (f.alts || [])[0] || null; f.alts = (f.alts || []).slice(1); } else f.alts = f.alts.filter((x) => x.id !== id); }); return S4.undoGuard(oid); })(); A.renderTree();
    K.rerender('[data-focus="mainPortrait"]'); const msg = isMain && (f0.alts || []).length ? t('fPromoted') : t('s4Deleted', { name: rem.name }); S4.say(msg);
    A.toast(msg, { ms: 10000, endsOnClose: true, action: { label: t('undoBtn'), fn: () => { if (!alive()) return; K.W(oid, 'display', t('s4StepRestoreRow'), (f) => { if (isMain) { if (f.main) f.alts = [f.main].concat(f.alts || []); f.main = rem; } else { const a = (f.alts || []).slice(); a.splice(Math.min(idx, a.length), 0, rem); f.alts = a; } }); A.renderTree(); K.rerender('[data-focus="mainPortrait"]'); } } });
  }
  S4.delPortrait = delPortrait; S4.acts.photoadd = (b) => addPhoto(S4.cur.oid, b);
  S4.acts.portraitmenu = (b) => S4.acts.rowmenu(b);

  function photoPanel(oid, f, ro) {
    const m = f.main, alts = f.alts || [], v = dr(oid), tall = !!f.largePortrait && !!m, d = BY.mainPortrait;
    let h = '<div class="studio-field studio-portrait-block" data-part="studio-field" data-field="mainPortrait" data-filled="' + !!m + '"><div class="studio-field-label" data-part="studio-field-label"><span id="s4-lab-main">' + esc(t('fMainPortrait')) + '</span></div>';
    h += m ? '<div class="studio-portrait-main" data-part="studio-portrait-main" data-shape="' + (tall ? 'tall' : 'square') + '" data-id="' + m.id + '">' + H.tile(m, { cls: 'studio-thumb-xl', shape: tall ? 'tall' : 'square', ic: 40 }) + '<div class="studio-portrait-cap"><span class="studio-portrait-name">' + esc(m.name) + '</span><span class="studio-row-meta">' + esc(t('s4Ext', { ext: m.ext, size: t('s4FakeKb', { n: m.size }) })) + '</span></div>' + (ro ? '' : H.menuBtn('portrait-main', m.id, m.name)) + '</div>'
      : '<div class="studio-portrait-main" data-part="studio-portrait-main" data-shape="square" data-empty="true"><span class="studio-thumb" data-part="studio-thumb-placeholder" data-image="placeholder" aria-hidden="true">' + ic('image', 40) + '</span><span class="studio-portrait-name">' + esc(t('s4NoMain')) + '</span></div>';
    h += ro ? '' : '<div class="studio-portrait-actions"><button type="button" class="btn solid" data-s4-act="photoadd" data-focus="mainPortrait">' + ic('plus', 16) + '<span>' + esc(t('fAddPhoto')) + '</span></button></div><p class="studio-field-note" data-part="studio-field-note" data-kind="info">' + esc(t('fAddPhotoNote')) + '</p>';
    const imp = v.importing.filter((x) => x.mode === 'portrait'); if (imp.length) h += '<p class="studio-field-note" role="status" data-kind="info">' + spin() + esc(t('s4Importing', { name: imp[0].name })) + '</p>';
    if (v.png) h += '<p class="studio-field-note" data-part="studio-field-note" data-kind="info" id="s4-png-note" role="status">' + ic('info', 14) + '<span>' + esc(t('fPngNote', { n: v.png })) + '</span></p>';
    h += rejectsHtml(oid, 'portrait') + '</div>';
    h += '<div class="studio-field" data-part="studio-field" data-field="altPortraits" data-filled="' + (alts.length > 0) + '"><div class="studio-field-label" data-part="studio-field-label"><span id="s4-lab-alts">' + esc(t('s4AltPhotos')) + '</span></div>' + (alts.length ? '<ul class="studio-portrait-alts" role="list" aria-labelledby="s4-lab-alts">' + alts.map((a) => '<li class="studio-portrait-alt" data-part="studio-portrait-alt" role="listitem" data-row="' + a.id + '" data-list="portrait">' + H.tile(a, { cls: 'studio-thumb-md', ic: 24 }) + '<span class="studio-portrait-name">' + esc(a.name) + '</span>' + (ro ? '' : H.menuBtn('portrait', a.id, a.name)) + '</li>').join('') + '</ul>' : '<p class="studio-empty-line">' + ic('image', 16) + '<span>' + esc(t('fNoImages')) + '</span></p>') + '</div>';
    if (m) h += H.swField(oid, BY.largePortrait, !!f.largePortrait, { ro });
    h += H.swField(oid, BY.hideChatIcon, !!f.hideChatIcon, { ro });
    return h;
  }
  function rejectsHtml(oid, mode) {
    const v = dr(oid); let h = '';
    if (v.rejects.length) h += '<div class="studio-rejects" role="group" aria-label="' + esc(t('s4Rejected')) + '"><ul>' + v.rejects.map((r) => '<li>' + ic('circle-alert', 14) + '<span class="n">' + esc(r.name) + '</span><span class="w">' + esc(r.why) + '</span></li>').join('') + '</ul><button type="button" class="btn-txt" data-s4-act="rejectclear">' + esc(t('s4Dismiss')) + '</button></div>';
    const fl = v.failed.filter((x) => x.mode === mode); if (fl.length) h += '<ul class="studio-failed" aria-label="' + esc(t('fStoreFail')) + '">' + fl.map((x) => '<li data-id="' + x.id + '">' + ic('triangle-alert', 14) + '<span class="n">' + esc(fileOf(x.f)) + '</span><span class="w">' + esc(t('fStoreFail')) + '</span><button type="button" class="btn sm txt" data-s4-act="failretry" data-id="' + x.id + '">' + esc(t('fRetry')) + '</button><button type="button" class="btn sm txt" data-s4-act="faildrop" data-id="' + x.id + '">' + esc(t('fDropRow')) + '</button></li>').join('') + '</ul>';
    return h;
  }
  S4.acts.rejectclear = () => { dr(S4.cur.oid).rejects = []; K.rerender('[data-focus="' + S4.cur.focusAdd + '"]'); };
  S4.acts.faildrop = (b) => { const v = dr(S4.cur.oid); v.failed = v.failed.filter((x) => x.id !== b.dataset.id); K.rerender(() => $('[data-focus="' + (S4.cur.focusAdd || 'mainPortrait') + '"]', $('#formHost'))); };
  S4.acts.failretry = (b) => {
    const oid = S4.cur.oid, v = dr(oid), x = v.failed.find((y) => y.id === b.dataset.id); if (!x) return; v.failed = v.failed.filter((y) => y.id !== x.id); const f = Object.assign({}, x.f, { retry: true });
    const hand = { portrait: (ok) => { const nf = entry(ok[0]); K.W(oid, 'display', t('s4StepPortraitAdd'), (ff) => { if (ff.main) ff.alts = (ff.alts || []).concat([ff.main]); ff.main = nf; }); K.rerender(); }, emotion: (ok) => addEmotions(oid, ok), asset: (ok) => addAssets(oid, ok), group: (ok) => S4.setGroupPic && S4.setGroupPic(oid, ok[0]) };
    startImport(oid, x.mode, [f], hand[x.mode]);
  };

  function screenPanel(oid, f, ro) {
    const mode = f.viewScreen || 'none', isD = f.isDefault || {}; const anyDef = visibleKeys(f).some((k) => isD[k] === true && txt(f[k]));
    const sel = '<div class="studio-field" data-part="studio-field" data-field="viewScreen" data-filled="' + (mode !== 'none') + '"><div class="studio-field-label" data-part="studio-field-label"><label for="f-viewScreen">' + esc(t('fScreenMode')) + '</label></div><div class="studio-field-control" data-part="studio-field-control"><select id="f-viewScreen" class="studio-input" data-s4in="mode" data-focus="viewScreen"' + (ro ? ' disabled' : '') + '>' + [['none', 'fScreenNone'], ['emotion', 'fScreenEmotion'], ['imggen', 'fScreenImgGen']].map(([v, k]) => '<option value="' + v + '"' + (mode === v ? ' selected' : '') + '>' + esc(t(k)) + '</option>').join('') + '</select></div>' + (anyDef ? '<p class="studio-field-note" data-part="studio-field-note" data-kind="info" id="s4-fill-note" role="status">' + ic('info', 14) + '<span>' + esc(t('fScreenFilled')) + '</span></p>' : '<p class="studio-field-note" id="s4-fill-note" hidden></p>') + '</div>';
    let h = sel; const dflt = (k) => { const on = isD[k] === true && K.txt(f[k]), has = k in isD; return { tagExtra: on ? '<span class="studio-field-tag" data-tag="default">' + esc(t('fDefaultTag')) + '</span>' : '', below: has ? '<div class="studio-field-below"><button type="button" class="btn sm txt" data-s4-act="resetdef" data-key="' + k + '">' + ic('rotate-ccw', 14) + '<span>' + esc(t('fDefaultReset')) + '</span></button></div>' : '', attr: on ? ' data-default="true"' : '' }; };
    if (mode === 'emotion') {
      h += '<p class="studio-field-note" data-part="studio-field-note" data-kind="info" id="s4-aux">' + ic('info', 14) + '<span>' + esc(t('fAuxModel')) + '</span></p>';
      h += '<div class="studio-field" data-part="studio-field" data-field="emotions" data-filled="' + ((f.emotions || []).length > 0) + '"><div class="studio-field-label" data-part="studio-field-label"><span>' + esc(t('fScreenEmotion')) + '</span></div>' + emotionRows(oid, f, ro) + (ro ? '' : '<button type="button" class="btn solid studio-add" data-s4-act="emotionadd" data-focus="emotions">' + ic('plus', 16) + '<span>' + esc(t('fPickAdd')) + '</span></button>') + rejectsHtml(oid, 'emotion') + '</div>';
      h += H.swField(oid, BY.inlay, !!f.inlay, { ro });
      if (f.inlay) h += H.ltField(oid, BY.emotionInstr, f.emotionInstr, Object.assign({ ro }, dflt('emotionInstr')));
    } else if (mode === 'imggen') {
      ['imgPrompt', 'imgNeg', 'imgInstr'].forEach((k) => { h += H.ltField(oid, BY[k], f[k], Object.assign({ ro }, dflt(k))); });
      h += H.swField(oid, BY.inlay, !!f.inlay, { ro });
    }
    return h;
  }
  const txt = (v) => K.txt(v);
  const visibleKeys = (f) => ((f.viewScreen || 'none') === 'emotion' ? (f.inlay ? ['emotionInstr'] : []) : f.viewScreen === 'imggen' ? ['imgPrompt', 'imgNeg', 'imgInstr'] : []);
  function setScreenMode(oid, mode) {
    const filled = []; K.W(oid, 'display', t('s4StepScreen'), (ff) => {
      ff.viewScreen = mode; const isD = Object.assign({}, ff.isDefault || {}); const need = mode === 'emotion' ? ['emotionInstr'] : mode === 'imggen' ? ['imgPrompt', 'imgNeg', 'imgInstr'] : [];
      need.forEach((k) => { if (!txt(ff[k]) || isD[k]) { ff[k] = defText(k); isD[k] = true; filled.push(k); } }); ff.isDefault = isD;
    });
    K.rerender('#f-viewScreen'); A.renderTree(); S4.lastFill = filled; const seen = filled.filter((k) => visibleKeys(K.fOf(oid, 'display')).includes(k)), hid = filled.length - seen.length;
    if (filled.length) S4.say((seen.length ? t('s4FillAnn', { n: seen.length }) : '') + (hid ? (seen.length ? ' · ' : '') + t('s4FillHidden') : ''));
  }
  S4.chg.mode = (el) => setScreenMode(S4.cur.oid, el.value);
  S4.acts.resetdef = (b) => { const oid = S4.cur.oid, k = b.dataset.key; K.W(oid, 'display', t('s4StepDefault'), (ff) => { ff[k] = defText(k); ff.isDefault = Object.assign({}, ff.isDefault || {}, { [k]: true }); }); K.rerender('[data-focus="' + k + '"]'); S4.say(t('s4StepDefault')); };
  /* switches of the Display form: written here (history label, tile shape and the inlay field follow at once) */
  S4.chg.sw = (el) => { const oid = S4.cur.oid, key = el.dataset.key, d = BY[key], sk = el.dataset.sk, on = el.checked; K.W(oid, d.kind, t('s4StepPortraitSwitch', { f: H.label(d) }), (f) => { f[sk] = on; }); K.rerender('#' + el.id); };
  S4.acts.emotionadd = (b) => { S4.cur.focusAdd = 'emotions'; const oid = S4.cur.oid; openPicker({ mode: 'emotion', multi: true, opener: b, onAdd: (files) => startImport(oid, 'emotion', files, (ok) => addEmotions(oid, ok)) }); };
  function addEmotions(oid, files) { const es = files.map(entry); K.W(oid, 'display', t('s4StepEmotionAdd'), (f) => { f.emotions = (f.emotions || []).concat(es); }); A.renderTree(); K.rerender('[data-focus="emotions"]'); }
  S4.acts.assetadd = (b) => { S4.cur.focusAdd = 'assets'; const oid = S4.cur.oid; openPicker({ mode: 'asset', multi: true, opener: b, onAdd: (files) => startImport(oid, 'asset', files, (ok) => addAssets(oid, ok)) }); };
  function addAssets(oid, files) { const es = files.map(entry); K.W(oid, 'display', t('s4StepAssetAdd'), (f) => { f.assets = (f.assets || []).concat(es); }); A.renderTree(); K.rerender('[data-focus="assets"]'); }
  S4.addEmotions = addEmotions; S4.addAssets = addAssets;
  S4.onTextWrite = (it, sk, val) => {
    if (it.kind !== 'display' || !['emotionInstr', 'imgPrompt', 'imgNeg', 'imgInstr'].includes(sk)) return; const box = document.querySelector('.studio-field[data-field="' + sk + '"]'); if (!box) return;
    box.removeAttribute('data-default'); $$('.studio-field-tag[data-tag="default"]', box).forEach((e) => e.remove());
    const left = ['emotionInstr', 'imgPrompt', 'imgNeg', 'imgInstr'].some((k) => (it.f.isDefault || {})[k] === true && K.txt(it.f[k])); const note = document.getElementById('s4-fill-note'); if (note && !left) { note.hidden = true; note.innerHTML = ''; }
  };
  S4.chg.assetOpt = (el) => { const oid = S4.cur.oid, sk = el.dataset.sk; const val = el.type === 'checkbox' ? el.checked : el.value; K.W(oid, 'display', t('s4StepPortraitSwitch', { f: el.dataset.label }), (f) => { f[sk] = val; }); };

  function assetsPanel(oid, f, ro) {
    let h = '';
    if (S4.settings.assetCommandSetting) h += '<div class="studio-field studio-field-switch" data-part="studio-field" data-field="assetCmd"><label class="sw"><input type="checkbox" role="switch" id="f-assetCmd" data-s4in="assetOpt" data-sk="assetCmd" data-label="' + esc(t('s4AssetPrompt')) + '"' + (f.assetCmd ? ' checked' : '') + (ro ? ' disabled' : '') + '><span class="sw-ui"></span><span class="lbl">' + esc(t('s4AssetPrompt')) + '</span></label></div>';
    if (S4.settings.newImageBeta) h += '<div class="studio-field" data-part="studio-field" data-field="assetStyle"><div class="studio-field-label" data-part="studio-field-label"><label for="f-assetStyle">' + esc(t('s4AssetStyle')) + '</label></div><div class="studio-field-control" data-part="studio-field-control"><select id="f-assetStyle" class="studio-input" data-s4in="assetOpt" data-sk="assetStyle" data-label="' + esc(t('s4AssetStyle')) + '"' + (ro ? ' disabled' : '') + '><option value="static"' + (f.assetStyle !== 'dynamic' ? ' selected' : '') + '>' + esc(t('s4StyleStatic')) + '</option><option value="dynamic"' + (f.assetStyle === 'dynamic' ? ' selected' : '') + '>' + esc(t('s4StyleDynamic')) + '</option></select></div></div>';
    const hd = { key: 'assetName', help: true, lab: 'fSegAssets' }; const hopen = !!dr(oid).help.assetName;
    h += '<div class="studio-field" data-part="studio-field" data-field="assets" data-filled="' + ((f.assets || []).length > 0) + '"><div class="studio-field-label" data-part="studio-field-label"><span>' + esc(t('fAssetHelp')) + '</span><button type="button" class="btn sm studio-field-help-btn" data-s4-act="help" data-key="assetName" aria-expanded="' + hopen + '" aria-controls="s4-help-assetName" aria-label="' + esc(t('s4Help')) + '" title="' + esc(t('s4Help')) + '">' + ic('circle-help', 16) + '</button></div><p class="studio-field-help" data-part="studio-field-help" id="s4-help-assetName" role="group" aria-label="' + esc(t('s4Help')) + '"' + (hopen ? '' : ' hidden') + '>' + esc(t('fh_assetName')) + '</p>' +
      assetRows(oid, f, ro) + (ro ? '' : '<button type="button" class="btn solid studio-add" data-s4-act="assetadd" data-focus="assets">' + ic('plus', 16) + '<span>' + esc(t('fPickAdd')) + '</span></button>') + rejectsHtml(oid, 'asset') + '</div>';
    return h;
  }

  function dispForm(it, o) {
    if (K.hiddenPrivate(o.id)) return S4.hiddenForm('display', o);
    const oid = o.id, f = it.f, ro = K.isPrivate(oid), ui = K.uiOf(oid); const seg = ['photo', 'screen', 'assets'].includes(ui.seg) ? ui.seg : 'photo'; S4.cur.seg = seg;
    const nPhoto = (f.main ? 1 : 0) + (f.alts || []).length, nAssets = (f.assets || []).length, nEm = (f.emotions || []).length;
    const tabs = [['photo', 'fSegPhoto', nPhoto], ['screen', 'fSegScreen', 0], ['assets', 'fSegAssets', nAssets]];
    let h = A.peerBannerHtml(it) + (ro ? S4.privateNote(oid) : '');
    h += '<div class="studio-segments" data-part="studio-segments" role="tablist" aria-label="' + esc(t('fKindDisplay')) + '">' + tabs.map(([k, lab, n]) => '<button type="button" role="tab" class="studio-segment" data-part="studio-segment" id="s4-tab-' + k + '" data-s4-act="seg" data-seg="' + k + '" aria-selected="' + (k === seg) + '" aria-controls="s4-seg-' + k + '" tabindex="' + (k === seg ? 0 : -1) + '">' + (k === seg ? ic('check', 14) : '') + '<span>' + esc(t(lab) + (n ? ' ' + n : '')) + '</span></button>').join('') + '</div>';
    h += tabs.map(([k]) => '<section class="studio-form-section" data-part="studio-form-section" role="tabpanel" id="s4-seg-' + k + '" data-seg="' + k + '" aria-labelledby="s4-tab-' + k + '"' + (k === seg ? '' : ' hidden') + '>' + (k === seg ? '<div class="studio-form-section-body" data-part="studio-form-section-body">' + (k === 'photo' ? photoPanel(oid, f, ro) : k === 'screen' ? screenPanel(oid, f, ro) : assetsPanel(oid, f, ro)) + '</div>' : '') + '</section>').join('');
    return S4.wrapForm('display', oid, h);
  }
  S4.acts.seg = (b) => { const oid = S4.cur.oid; K.uiOf(oid).seg = b.dataset.seg; K.saveUI(); K.rerender('[role="tab"][aria-selected="true"]'); S4.say(b.textContent.trim()); };
  S4.forms['char:display'] = dispForm;
  S4.mounts['char:display'] = (it, o) => { if (S4.cur.seg === 'assets') scan(o.id); };
  S4.afterRenderScan = scan;
})();
