/* Studio slice 2 mockup: toggle list builder (SLICE2_SPEC.md rev 2). Synthetic data; not proof of native behaviour or performance.
   Part 1 (this file): state, model, edit operations, list, row editor, carry-over. Part 2 (tgb-view.js): text view, panel preview, combined view, states, test hooks.
   Plugs into studio/slice1.js through window.__st1.ext (hooks) and window.__st1.api (shell helpers); slice1.html never loads this file. */
(function () {
  'use strict';
  const ST = window.__st1, A = ST.api, C = window.TGCore, S = A.S;
  const { t, nm, ic, esc, $, $$, O, edit, toast, announce } = A;
  const TG = window.TGX = {
    view: 'list', sel: {}, ident: {}, auto: new Set(), err: {}, notices: {}, base: {}, first: {}, collapsed: new Set(), pv: {}, pvOpen: new Set(), scope: 'owner', adv: false,
    uidN: 0, flip: false, note: '', lastItem: null, keyFrom: {}, drag: null, page: null, sheetEd: false, pw: null
  };
  Object.defineProperty(TG, 'notice', { get() { const f = cur(); const n = f && TG.notices[f.it.id]; return n ? Object.assign({ type: n.issues[0] && n.issues[0].type }, n) : null; } });
  ST.ext.oneToggles = true;
  /* DD-115: an unanswered question (and the baseline it compares with) is kept on this device with the drafts (sessionStorage in the mockup) and comes back as a banner when the item reopens, also after a reload. A fresh ?state= page starts clean. */
  const SKEY = (window.StudioSS || 'st1:') + 'tgn'; let lastPersist = '';
  if (new URLSearchParams(location.search).get('state')) { try { sessionStorage.removeItem(SKEY); } catch (_) {} } else { try { const o = JSON.parse(sessionStorage.getItem(SKEY) || 'null'); if (o) { TG.notices = o.n || {}; TG.base = o.base || {}; } } catch (_) {} }
  function persistNotices() { try { const n = {}; Object.keys(TG.notices).forEach((id) => { if (TG.notices[id].state === 'ask') n[id] = TG.notices[id]; }); const v = JSON.stringify({ n, base: TG.base }); if (v !== lastPersist) { lastPersist = v; sessionStorage.setItem(SKEY, v); } } catch (_) {} }
  TG.visit = {}; TG.visitN = 0;   // N-4: the carry's own undo lasts for the current visit to the item
  const newUid = () => 'u' + (++TG.uidN);
  const KICON = { check: 'toggle-right', select: 'list', text: 'text-cursor-input', textarea: 'align-left', group: 'folder', divider: 'minus', caption: 'text', bad: 'triangle-alert' };
  const KTYPES = ['check', 'select', 'text', 'textarea', 'group', 'divider', 'caption'];
  const kname = (k) => t('tgType_' + k);
  const reduced = () => document.documentElement.classList.contains('rm') || document.documentElement.classList.contains('nexus-low-power');
  const tick = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  /* ------------------------------------------------------------------ data access */
  const txt = (it) => String(it.f.defs == null ? '' : it.f.defs);
  const cur = () => { const f = S.open && A.findItem(S.open); return f && f.it.kind === 'toggles' ? f : null; };
  const ownerItem = (o) => A.itemsOf(o, 'toggles')[0] || null;
  const ownerText = (o) => { const i = ownerItem(o); return i ? txt(i) : ''; };
  function ident(it) {
    const text = txt(it); const id = TG.ident[it.id]; if (id && id.text === text) return id;
    const lines = text.split('\n'); let uids;
    if (id) {
      const ol = id.text.split('\n'); let p = 0; while (p < ol.length && p < lines.length && ol[p] === lines[p]) p++;
      let q = 0; while (q < ol.length - p && q < lines.length - p && ol[ol.length - 1 - q] === lines[lines.length - 1 - q]) q++;
      uids = []; for (let i = 0; i < p; i++) uids.push(id.uids[i]);
      for (let i = p; i < lines.length - q; i++) uids.push(newUid());
      for (let i = lines.length - q; i < lines.length; i++) uids.push(id.uids[ol.length - (lines.length - i)]);
      const sel = TG.sel[it.id]; if (sel && uids.indexOf(sel) < 0) { const oi = id.uids.indexOf(sel); if (oi >= 0) TG.sel[it.id] = uids[Math.min(oi, uids.length - 1)]; }
    } else uids = lines.map(newUid);
    return (TG.ident[it.id] = { text, uids });
  }
  /* analysis of the owners the chat really joins (preset, active modules, character); every other owner of the app only takes part in the shared-key check (values are app-wide) */
  let anCache = { key: '', v: null };
  const toggleOwners = () => A.ownerList().filter((o) => ownerItem(o));
  const allKey = () => toggleOwners().map((o) => o.id + '\u0001' + ownerText(o)).join('\u0002');
  function ctxOwners() { return A.mergeOrder('toggles').filter((o) => ownerItem(o)); }
  const asOwner = (o) => ({ id: o.id, name: nm(o.name), text: ownerText(o) });
  function analysis() {
    const list = ctxOwners(), key = allKey() + '|' + list.map((o) => o.id).join();
    if (anCache.key === key) return anCache.v;
    const inJ = new Set(list.map((o) => o.id));
    const v = C.analyze(list.map(asOwner), toggleOwners().filter((o) => !inJ.has(o.id)).map(asOwner)); anCache = { key, v }; return v;
  }
  const soloCache = {};
  function solo(o) {   // this source alone (an off module, or the "this source only" preview); the rest of the app still counts for shared keys
    const k = o.id + '\u0001' + allKey(); if (soloCache[o.id] && soloCache[o.id].k === k) return soloCache[o.id].v;
    const v = C.analyze([asOwner(o)], toggleOwners().filter((x) => x.id !== o.id).map(asOwner)); soloCache[o.id] = { k, v }; return v;
  }
  function ownerAn(o) { const a = analysis(), i = a.owners.findIndex((x) => x.id === o.id); if (i >= 0) return { a, po: a.owners[i], oi: i, inJoin: true }; const v = solo(o); return { a: v, po: v.owners[0], oi: 0, inJoin: false }; }
  function model(it, o) {
    const text = txt(it), rows = C.parse(text), st = C.structure(rows), id = ident(it), oa = ownerAn(o);
    return { it, o, text, rows, st, id, oa };
  }
  const curModel = () => { const f = cur(); return f ? model(f.it, f.o) : null; };
  const selUid = (m) => TG.sel[m.it.id] || null;
  const selRow = (m) => { const u = selUid(m); const i = u ? m.id.uids.indexOf(u) : -1; return i >= 0 ? m.rows[i] : null; };
  const uidOf = (m, r) => m.id.uids[r.i];
  const rowByUid = (m, u) => { const i = m.id.uids.indexOf(u); return i >= 0 ? m.rows[i] : null; };
  const badLike = (r) => r.kind === 'bad' || r.kind === 'groupEnd';
  const labelOf = (r) => (r.kind === 'bad' ? t('tgUnreadable') : r.kind === 'groupEnd' ? t('tgOrphanEnd') : r.label || (r.kind === 'divider' ? t('tgDivNoName') : t('tgNoName')));
  /* DD-112: every key of every owner of the app (the value store is app-wide); the current item also contributes its group keys */
  function appKeys(itemId, exceptLine) {
    const out = [];
    toggleOwners().forEach((o) => A.itemsOf(o, 'toggles').forEach((it) => C.parse(txt(it)).forEach((r) => { if (it.id === itemId && r.i === exceptLine) return; if (C.isValue(r) || (it.id === itemId && r.kind === 'group')) out.push(r.key); })));
    return out;
  }
  const takenKeys = (m, exceptI) => appKeys(m.it.id, exceptI);
  const ownerSlug = (o) => { const en = o.name && typeof o.name === 'object' ? o.name.en : o.name; let s = ''; C.slug(en || '').split('_').filter(Boolean).forEach((w) => { if ((s ? s.length + 1 : 0) + w.length <= 16 || !s) s = s ? s + '_' + w : w.slice(0, 16); }); return s || C.slug(o.id) || 'owner'; };   // whole words, at most 16 characters (N-9); renaming the owner later does not rename keys
  const ownersUsing = (key, exceptItemId) => toggleOwners().filter((o) => A.itemsOf(o, 'toggles').some((it) => it.id !== exceptItemId && C.parse(txt(it)).some((r) => C.isValue(r) && r.key === key)));

  /* ------------------------------------------------------------------ carry-over baseline and notices (DD-106, DD-110, DD-114) */
  function baseText(it, o) {
    if (TG.base[it.id] != null) return TG.base[it.id];
    const h = S.H[o.id]; if (h && h.steps[0]) { try { const x = JSON.parse(h.steps[0].snap).find((i) => i.id === it.id); if (x && x.f) return String(x.f.defs == null ? '' : x.f.defs); } catch (_) {} }
    return TG.first[it.id] != null ? TG.first[it.id] : txt(it);
  }
  const rebase = (id) => { delete TG.base[id]; delete TG.notices[id]; const f = A.findItem(id); if (f) TG.first[id] = txt(f.it); };
  const issueKeys = (n) => { const s = new Set(); (n.issues || []).forEach((i) => { if (i.key) s.add(i.key); if (i.from) s.add(i.from); if (i.to) s.add(i.to); }); return s; };
  function issueLine(i) {
    if (i.type === 'key') return t('tgCarryLineKey', { from: i.from, to: i.to });
    if (i.type === 'options') return t('tgCarryLineOpts', { name: i.label });
    if (i.type === 'type') return t('tgCarryLineType', { name: i.label, from: kname(i.from), to: kname(i.to) });
    return t('tgCarryLineDrop', { key: i.key, to: kname(i.to) });
  }
  function refRe(key) { return new RegExp('toggle_' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![A-Za-z0-9_])', 'g'); }
  /* DD-113: where CBS text reads toggle_<key>: every field of every non-toggle item of every owner (prompts, lorebook, scripts, character text) */
  function findRefs(key, exceptItemId) {
    const re = refRe(key), out = [], defining = new Set(ownersUsing(key, exceptItemId).map((o) => o.id));
    A.ownerList().forEach((o) => o.items.forEach((it) => {
      if (it.kind === 'toggles') return;
      const fields = Object.keys(it.f || {}).map((k) => [k, it.f[k]]); if (it.code && typeof it.code.live === 'string') fields.push(['code', it.code.live]);
      fields.forEach(([k, v]) => { if (typeof v === 'string') { re.lastIndex = 0; const n = (v.match(re) || []).length; if (n) out.push({ oid: o.id, owner: nm(o.name), itemId: it.id, item: nm(it.name) || A.kindName(it.kind), field: k, n, skip: defining.has(o.id) }); } });
    }));
    return out;
  }
  function updateRefs(from, to, include, exceptItemId) {
    const re = refRe(from), touched = [], defining = new Set(ownersUsing(from, exceptItemId).map((o) => o.id)), inc = new Set(include || []); let places = 0, plan = [];
    A.ownerList().forEach((o) => {
      if (defining.has(o.id) && !inc.has(o.id)) return;   // DD-117: a source that still defines the old key keeps its uses unless the author opts in
      const hit = o.items.filter((it) => it.kind !== 'toggles' && (Object.keys(it.f || {}).some((k) => typeof it.f[k] === 'string' && (re.lastIndex = 0, re.test(it.f[k]))) || (it.code && typeof it.code.live === 'string' && (re.lastIndex = 0, re.test(it.code.live)))));
      if (!hit.length) return;
      plan.push({ o, hit });
    });
    if (!plan.length) return { touched, places };
    A.crossEdit(t('tgStepRefs', { from, to }), plan.map((x) => x.o.id), () => { plan.forEach(({ hit }) => { hit.forEach((it) => { Object.keys(it.f || {}).forEach((k) => { if (typeof it.f[k] === 'string') { re.lastIndex = 0; if (re.test(it.f[k])) { places++; re.lastIndex = 0; it.f[k] = it.f[k].replace(re, 'toggle_' + to); } } }); if (it.code && typeof it.code.live === 'string') { re.lastIndex = 0; if (re.test(it.code.live)) { places++; re.lastIndex = 0; it.code.live = it.code.live.replace(re, 'toggle_' + to); } } }); }); });
    plan.forEach((x) => touched.push(x.o.id));
    return { touched, places };
  }
  function refreshNotice(o2) {
    const f = cur(); if (!f) return; o2 = o2 || {}; const it = f.it, text = txt(it), iss = C.carryIssues(baseText(it, f.o), text), old = TG.notices[it.id];
    if (!iss.length) { if (old && old.state === 'ask') { delete TG.notices[it.id]; announce(t('tgCarryCancelled')); } renderBanners(); patchNoticeRows(); return; }
    const sig = JSON.stringify(iss);
    if (old && old.state === 'ask') { const ch = old.sig !== sig; old.issues = iss; old.sig = sig; old.text = text; if (ch) { renderBanners(); patchNoticeRows(); if (inSheet()) renderEditor(); announce(t('tgCarryHead') + ': ' + iss.map(issueLine).join(', ')); } return; }
    if (TG.base[it.id] == null) TG.base[it.id] = baseText(it, f.o);
    TG.notices[it.id] = { state: 'ask', issues: iss, sig, text };
    renderBanners(); patchNoticeRows(); if (inSheet()) renderEditor(); announce(t('tgCarryHead') + ': ' + iss.map(issueLine).join(', '));   // Q-4: announced, the banner sits right under the header, focus stays where the author was
    A.renderTree(); A.refreshProblemsOnly();
  }
  const inSheet = () => TG.sheetEd && $('#sheetRoot') && $('#sheetRoot').classList.contains('open');
  function patchNoticeRows() { if (TG.view !== 'list') return; const m = curModel(); if (m) m.rows.forEach((r) => { if (C.isValue(r)) patchRow(m, uidOf(m, r), true); }); }
  function noticeHtml(f, where) {
    const n = TG.notices[f.it.id]; if (!n) return '';
    if (n.state !== 'ask') {
      if (n.text !== txt(f.it)) { delete TG.notices[f.it.id]; return ''; }
      const yes = n.state === 'yes'; return '<div class="tgb-banner ok tgn-done" role="status" ' + (yes ? 'data-part="studio-tgb-carry" data-part-critical data-state="done"' : 'data-part="studio-tgb-banner" data-kind="ok"') + '>' + ic(n.state === 'yes' ? 'check' : 'info', 16) + '<span class="t" data-part="' + (yes ? 'studio-tgb-carry-text' : 'studio-tgb-banner-text') + '">' + esc(t(n.state === 'yes' ? 'tgCarried' : 'tgLeft')) + '</span>' + (n.state === 'yes' ? '<button type="button" class="btn solid" data-part="studio-tgb-carry-action" data-tg-act="carry-undo">' + ic('rotate-ccw', 16) + '<span>' + esc(t('tgCarriedUndo')) + '</span></button>' : '') + '</div>';
    }
    const types = new Set(n.issues.map((i) => i.type)), transfer = types.has('key') || types.has('options');
    const paras = [['key', 'tgCarryAskKey'], ['options', 'tgCarryAskOpts'], ['type', 'tgCarryAskType'], ['drop', 'tgCarryAskDrop']].filter(([k]) => types.has(k)).map(([, k]) => '<p data-part="studio-tgb-carry-text">' + esc(t(k)) + '</p>').join('');
    let warn = '', refs = '';
    n.issues.filter((i) => i.type === 'key').forEach((i) => {
      const use = ownersUsing(i.to, f.it.id), oth = ownersUsing(i.from, f.it.id);
      if (use.length) warn += '<p class="tgn-warn" data-part="studio-tgb-carry-warn">' + ic('triangle-alert', 14) + esc(t('tgCarryOverwrite', { key: i.to, owner: use.map((o) => nm(o.name)).join(', ') })) + '</p>';
      if (oth.length) warn += '<p class="tgn-warn" data-part="studio-tgb-carry-warn">' + ic('info', 14) + esc(t('tgCarryOthers', { key: i.from, owner: oth.map((o) => nm(o.name)).join(', ') })) + '</p>';
      const all = findRefs(i.from, f.it.id), rs = all.filter((r) => !r.skip), sk = all.filter((r) => r.skip), skOwners = [...new Set(sk.map((r) => r.oid))];
      if (all.length) refs += '<div class="tgn-refs" data-part="studio-tgb-carry-refs"><strong data-part="studio-tgb-carry-refs-title">' + esc(t('tgRefsTitle', { key: i.from, n: all.length })) + '</strong><ul>' + rs.slice(0, 6).map((r) => '<li><button type="button" class="btn-txt" data-part="studio-tgb-carry-ref" data-tg-act="ref-open" data-item="' + esc(r.itemId) + '">' + esc(t('tgRefsRow', { owner: r.owner, item: r.item, field: r.field })) + '</button></li>').join('') + '</ul>' + (skOwners.length ? '<p class="tgn-warn" data-part="studio-tgb-carry-warn">' + ic('info', 14) + esc(t('tgRefsSkipped', { key: i.from })) + '</p><ul class="tgn-skip">' + skOwners.map((oid) => '<li><span>' + esc(nm(O(oid).name) + ' · ' + sk.filter((r) => r.oid === oid).reduce((a, r) => a + r.n, 0) + t('tgPlaces')) + '</span><button type="button" class="btn solid" data-part="studio-tgb-carry-action" data-tg-act="refs-also" data-oid="' + esc(oid) + '" data-from="' + esc(i.from) + '" data-to="' + esc(i.to) + '">' + esc(t('tgRefsAlso', { owner: nm(O(oid).name) })) + '</button></li>').join('') + '</ul>' : '') + '<div class="tgn-acts" data-part="studio-tgb-carry-actions">' + (rs.length ? '<button type="button" class="btn solid" data-part="studio-tgb-carry-action" data-tg-act="refs-update" data-from="' + esc(i.from) + '" data-to="' + esc(i.to) + '">' + ic('replace', 16) + '<span>' + esc(t('tgRefsUpdate')) + '</span></button>' : '') + '<button type="button" class="btn solid" data-part="studio-tgb-carry-action" data-tg-act="refs-search" data-from="' + esc(i.from) + '">' + ic('search', 16) + '<span>' + esc(t('tgRefsSearch')) + '</span></button></div></div>';
    });
    return '<div class="tgb-banner warn tgn" role="group" aria-labelledby="tgnT-' + where + '" data-part="studio-tgb-carry" data-part-critical data-state="ask">' + ic('triangle-alert', 18) + '<div class="tgn-b" data-part="studio-tgb-carry-body"><strong id="tgnT-' + where + '" data-part="studio-tgb-carry-title">' + esc(t('tgCarryHead')) + '</strong><ul class="tgn-l" data-part="studio-tgb-carry-list">' + n.issues.map((i) => '<li data-part="studio-tgb-carry-line">' + esc(issueLine(i)) + '</li>').join('') + '</ul>' + paras + warn +
      '<div class="tgn-acts" data-part="studio-tgb-carry-actions">' + (transfer ? '<button type="button" class="btn solid primary" data-part="studio-tgb-carry-action" data-tg-act="carry-yes">' + ic('rotate-ccw', 16) + '<span>' + esc(t('tgCarryYes')) + '</span></button>' : '') + '<button type="button" class="btn solid" data-part="studio-tgb-carry-action" data-tg-act="carry-no">' + ic('check', 16) + '<span>' + esc(t(transfer ? 'tgCarryNo' : 'tgCarryOk')) + '</span></button></div>' + (transfer ? '<p class="hint" data-part="studio-tgb-carry-hint">' + esc(t('tgCarryYesHint')) + '</p>' : '') + refs + '</div></div>';
  }
  function answer(how) {
    const f = cur(); if (!f) return; const n = TG.notices[f.it.id]; if (!n || n.state !== 'ask') return; flushPending();
    const text = txt(f.it), prev = baseText(f.it, f.o);
    if (how === 'yes') {
      const what = n.issues.filter((i) => i.type === 'key' || i.type === 'options').map(issueLine).join(', ');
      edit(f.o.id, t('tgStepCarry', { what }), () => {}, { ext: { carry: { id: f.it.id, prev, base: text, issues: n.issues, visit: TG.visit[f.it.id] } } });   // its own undo step (DD-114): the rename stays a step of its own
      n.state = 'yes'; n.text = text; TG.base[f.it.id] = text;
      toast(t('tgCarried'), { ms: 10000, endsOnClose: true, action: { label: t('tgCarriedUndo'), fn: () => A.undoOwner(f.o.id) } }); announce(t('tgCarried'));
    } else { n.state = 'no'; n.text = text; TG.base[f.it.id] = text; announce(t('tgLeft')); }
    renderBanners(); patchNoticeRows(); if (inSheet()) renderEditor(); A.renderTree(); A.refreshProblemsOnly(); A.renderHeader(); persistNotices();
    const b = $('#tgEd [data-tg="label"]'); if (b) b.focus();
  }
  /* undo or redo of a step: the carry is one of them (its own undo), any other undo re-checks a pending question */
  ST.ext.stepHook = (oid, st, dir) => {
    const c = st.ext && st.ext.carry;
    if (c && c.visit !== TG.visit[c.id]) { toast(t('tgCarryNoUndo'), { ms: 6000 }); announce(t('tgCarryNoUndo')); }   // N-4: an older visit: the step moves in the history but the values are not reopened
    else if (c) { const f = A.findItem(c.id); if (f) { if (dir === 'undo') { TG.base[c.id] = c.prev; delete TG.notices[c.id]; const iss = C.carryIssues(c.prev, txt(f.it)); if (iss.length) TG.notices[c.id] = { state: 'ask', issues: iss, sig: JSON.stringify(iss), text: txt(f.it) }; } else { TG.base[c.id] = c.base; TG.notices[c.id] = { state: 'yes', issues: c.issues, text: c.base }; } } }
    else { const f = cur(); const n = f && TG.notices[f.it.id]; if (n && n.state === 'ask') { const iss = C.carryIssues(baseText(f.it, f.o), txt(f.it)); if (!iss.length) delete TG.notices[f.it.id]; else { n.issues = iss; n.sig = JSON.stringify(iss); n.text = txt(f.it); } } }
    if (cur()) { renderBanners(); if (TG.view === 'list') patchNoticeRows(); }
    // focus never falls to the page after an undo (m-7)
    setTimeout(() => { const f = cur(); if (!f) return; if (TG.view === 'text') { const ta = $('#tgTa'); if (ta) ta.focus({ preventScroll: true }); } else if (TG.sel[f.it.id] && $('#tgr-' + TG.sel[f.it.id])) focusRowEl(TG.sel[f.it.id]); }, 0);
  };
  ST.ext.crossBlocked = (blocked, st) => { const names = blocked.map((id) => nm(O(id).name)).join(', '); const msg = t('tgRefsBlocked', { owners: names }); toast(msg, { ms: 8000 }); announce(msg); };

  /* ------------------------------------------------------------------ problems (tree markers, Problems tab) */
  function tgProblems(it) {
    const f = A.findItem(it.id); if (!f) return [];
    const o = f.o, oa = ownerAn(o), po = oa.po, out = [], rows = po.rows;
    if (ownerItem(o) !== it) return out;
    const uidsOf = (i) => 'tgrow:' + i;
    po.dupKeys.forEach((k) => { const r = rows.find((x) => C.isValue(x) && x.key === k); out.push({ sev: 'error', field: uidsOf(r.i), msg: t('tgDupKey') + ' · ' + k }); });
    rows.forEach((r) => {
      if (r.kind === 'bad') out.push({ sev: 'warning', field: uidsOf(r.i), msg: t('tgUnreadable') + ' · ' + t(r.reason === 'caption' ? 'tgWhyCaption' : 'tgWhyKeyLabel') });
      if (r.kind === 'select' && r.opts.length < 2) out.push({ sev: 'warning', field: uidsOf(r.i), msg: t('tgFewOpts', { name: r.label }) });
    });
    if (po.spill) out.push({ sev: po.spill.hard ? 'error' : 'warning', field: uidsOf(po.spill.row.i), msg: po.spill.hard ? t('tgSpill') : t('tgUnclosed') });
    const n = TG.notices[it.id]; if (n && n.state === 'ask') { const k = [...issueKeys(n)][0]; const r = rows.find((x) => C.isValue(x) && x.key === k) || rows.find((x) => C.isValue(x)); out.push({ sev: 'warning', field: r ? uidsOf(r.i) : null, msg: t('tgCarryPendingProb') }); }
    const id = TG.ident[it.id]; Object.keys(TG.err).forEach((k) => { const [u] = k.split('|'); if (id && id.uids.indexOf(u) >= 0) out.push({ sev: 'error', field: uidsOf(id.uids.indexOf(u)), msg: t(errMsgKey(TG.err[k].code)) }); });
    return out;
  }
  ST.ext.problems = tgProblems;
  ST.ext.beforeOpen = (id) => { if (TG.pw && TG.pw.item !== id) flushPending(); if (id !== TG.lastItem) TG.lastItem = null; };   // opening anything else ends the visit to the toggle item (N-4)
  ST.ext.keysPreview = (it) => { const ks = C.parse(txt(it)).filter((r) => C.isValue(r)).map((r) => r.key); return ks.length ? ks.slice(0, 3).join(' · ') + (ks.length > 3 ? ' …' : '') : ''; };
  const errMsgKey = (code) => (code === 'eq' ? 'tgErrEq' : code === 'comma' ? 'tgErrComma' : code === 'nl' ? 'tgErrNl' : code === 'emptyKey' ? 'tgErrKeyEmpty' : code === 'emptyLabel' ? 'tgErrLabelEmpty' : code === 'emptyOpt' ? 'tgErrOptEmpty' : 'tgErrEq');

  /* ------------------------------------------------------------------ commit helpers (M-7: typing patches one row; the rest is coalesced) */
  function commit(m, lines, uids, label, opts, lite) {
    const text = lines.join('\n'), { it, o } = m;
    edit(o.id, label, () => { it.f.defs = text; }, opts);
    TG.ident[it.id] = { text, uids };
    afterEdit(lite);
  }
  const previewVisible = () => S.sideTab === 'preview' && (S.layout === 'wide' ? !S.sideOff : S.sideOpen);
  function schedPreview() { if (TG.pvRaf) return; TG.pvRaf = requestAnimationFrame(() => { TG.pvRaf = 0; if (TG.renderPreview && (previewVisible() || S.view.type === 'tgmerged')) TG.renderPreview(); }); }
  function schedSecondary(ms) { clearTimeout(TG.secT); TG.secT = setTimeout(() => { A.renderTree(); A.refreshProblemsOnly(); }, ms == null ? 150 : ms); }
  /* N-6: a move between neighbours reorders the two row blocks in the DOM instead of rebuilding the list (and animates only those two) */
  function fastMove(lite, f) {
    const el = $('#tgr-' + lite.uid), nb = $('#tgr-' + lite.nb); if (!el || !nb) return false;
    const blk = (e) => (e.classList.contains('k-group') ? e.closest('.tgg') : e), a = blk(el), b = blk(nb); if (!a || !b || a.parentNode !== b.parentNode) return false;
    const anim = !reduced(), ta = anim ? a.getBoundingClientRect().top : 0, tb = anim ? b.getBoundingClientRect().top : 0, had = document.activeElement === el;
    b.parentNode.insertBefore(a, lite.dir < 0 ? b : b.nextSibling);
    const mm = model(f.it, f.o); $$('#tgList .tgr').forEach((e) => { const i = mm.id.uids.indexOf(e.dataset.uid); if (i >= 0) { e.dataset.i = i; e.setAttribute('data-f', 'tgrow:' + i); } });
    if (anim) [[a, ta], [b, tb]].forEach(([e, t0]) => { const d = t0 - e.getBoundingClientRect().top; if (Math.abs(d) < 1) return; e.style.transform = 'translateY(' + d + 'px)'; e.style.transition = 'none'; requestAnimationFrame(() => requestAnimationFrame(() => { e.style.transition = ''; e.style.transform = ''; })); });
    if (had) el.focus({ preventScroll: true });
    return true;
  }
  function afterEdit(lite) {
    const f = cur(); if (!f) return;
    if (lite && lite.move && TG.view === 'list' && fastMove(lite.move, f)) { syncEditorLight(); renderBanners(); schedPreview(); schedSecondary(60); return; }
    if (lite && TG.view === 'list') {
      const m = model(f.it, f.o), sig = m.oa.po.dupKeys.join('|') + '#' + (TG.notices[f.it.id] ? 1 : 0);
      if (sig !== lite.sig) renderList(); else patchRow(m, lite.uid);
      syncEditorLight(); renderBanners(); schedPreview(); schedSecondary(); return;
    }
    if (TG.view === 'list') { renderList(); syncEditorLight(); } else if (TG.viewHook) TG.viewHook();
    renderBanners(); schedPreview(); schedSecondary(60);   // N-6: a move no longer rebuilds the tree and Problems synchronously
  }
  function stepLabel(key, name, extra) { return t(key, Object.assign({ name: name || '' }, extra || {})); }

  /* ------------------------------------------------------------------ line operations */
  const groupNodeOf = (m, i) => m.st.nodes.find((n) => n.type === 'group' && (n.row.i === i)) || null;
  function parentGroup(m, i) { return m.st.nodes.find((n) => n.type === 'group' && n.children.some((c) => c.row.i === i)) || null; }
  function nodeRange(m, r) {
    if (r.kind === 'group') { const g = groupNodeOf(m, r.i); return g ? [g.start, g.end] : [r.i, r.i]; }
    return [r.i, r.i];
  }
  function siblings(m, r) {
    const pg = parentGroup(m, r.i);
    if (pg) return { list: pg.children.map((c) => ({ row: c.row, start: c.start, end: c.end })), parent: pg };
    return { list: m.st.nodes.map((n) => ({ row: n.row, start: n.start, end: n.end })), parent: null };
  }
  /* the one place text is rearranged: take [a0,a1] out and put it at `to` (original numbering); top-level destinations after a group that was never closed first close it */
  function relocate(m, a0, a1, to, top) {
    let lines = m.text.split('\n'), uids = m.id.uids.slice();
    const len = a1 - a0 + 1, blk = lines.splice(a0, len), bu = uids.splice(a0, len); let at = to > a1 ? to - len : to;
    if (top) {
      const st2 = C.structure(C.parse(lines.join('\n'))), og = st2.openGroup;
      if (og && at > og.end) { lines.splice(og.end + 1, 0, C.endLineOf(og.row)); uids.splice(og.end + 1, 0, newUid()); at = Math.max(at, og.end + 2); }
    }
    lines.splice.apply(lines, [at, 0].concat(blk)); uids.splice.apply(uids, [at, 0].concat(bu));
    return { lines, uids, start: at };
  }
  function moveNode(uid, dir) {
    flushPending();
    const m = curModel(); if (!m) return; const r = rowByUid(m, uid); if (!r || r.kind === 'blank') return;
    const sb = siblings(m, r), k = sb.list.findIndex((x) => x.row.i === r.i), n = sb.list[k + dir];
    if (!n) { announce(t('tgMoveEnd')); return; }
    const [a0, a1] = nodeRange(m, r), to = dir < 0 ? n.start : n.end + 1;
    const res = relocate(m, a0, a1, to, !sb.parent);
    TG.flip = true; TG.flipSet = new Set(m.id.uids.slice(Math.min(a0, to), Math.max(a1 + 1, to))); const name = labelOf(r);
    commit(m, res.lines, res.uids, stepLabel('tgStepMove', name), { key: null }, { move: { uid, nb: m.id.uids[n.row.i], dir } });
    announce(t('tgMovedTo', { name, n: k + dir + 1 })); TG.flip = false; TG.flipSet = null;
    focusRowEl(uid);
  }
  function insertionFor(m, ctx) {
    if (ctx && ctx.group) { const gr = rowByUid(m, ctx.group), g = gr && groupNodeOf(m, gr.i); if (g) return { at: g.endRow ? g.endRow.i : g.end + 1, top: false, parent: g }; }
    if (ctx && ctx.after) {
      const r = rowByUid(m, ctx.after);
      if (r) { const sb = siblings(m, r); const [, a1] = nodeRange(m, r); return { at: a1 + 1, top: !sb.parent, parent: sb.parent }; }
    }
    let last = -1; m.rows.forEach((r) => { if (r.kind !== 'blank') last = r.i; });
    return { at: last + 1, top: true, parent: null };
  }
  function defaultRows(kind, m) {
    const name = t('tgNew_' + kind), taken = takenKeys(m, -1).slice(), pre = ownerSlug(m.o);
    const mk = (k) => ({ kind: k, key: '', label: '', opts: [] });
    if (kind === 'check' || kind === 'text' || kind === 'textarea') { const r = mk(kind); r.label = name; r.key = C.suggestKey(name, taken, pre); return [r]; }
    if (kind === 'select') { const r = mk('select'); r.label = name; r.key = C.suggestKey(name, taken, pre); r.opts = [t('tgOptN', { n: 1 }), t('tgOptN', { n: 2 })]; return [r]; }
    if (kind === 'group') { const g = mk('group'); g.label = name; g.key = C.suggestKey(name, taken, pre); const e = mk('groupEnd'); e.label = name; e.key = g.key + '_end'; return [g, e]; }
    if (kind === 'divider') return [mk('divider')];
    const c = mk('caption'); c.label = name; return [c];
  }
  function addRow(kind, ctx) {
    flushPending();
    const m = curModel(); if (!m) return;
    const ins = insertionFor(m, ctx), rows = defaultRows(kind, m), nl = rows.map(C.canon), nu = rows.map(() => newUid());
    let lines = m.text.split('\n'), uids = m.id.uids.slice(), at = ins.at;
    const allBlank = m.rows.every((r) => r.kind === 'blank');
    if (allBlank) { lines = []; uids = []; at = 0; }
    else if (ins.top) { const og = m.st.openGroup; if (og && at > og.end) { lines.splice(og.end + 1, 0, C.endLineOf(og.row)); uids.splice(og.end + 1, 0, newUid()); at = og.end + 2; } }
    lines.splice.apply(lines, [at, 0].concat(nl)); uids.splice.apply(uids, [at, 0].concat(nu));
    if (C.isValue(rows[0]) || rows[0].kind === 'group') TG.auto.add(nu[0]);
    TG.sel[m.it.id] = nu[0]; TG.fresh = nu[0]; TG.keyFrom[nu[0]] = rows[0].key;
    commit(m, lines, uids, stepLabel('tgStepAdd', rows[0].label || kname(kind)), {});
    announce(t('tgAdded', { name: rows[0].label || kname(kind) }));
    afterAdd(nu[0]);
  }
  function afterAdd(uid) {
    renderList(); focusRowEl(uid);
    const mode = edMode();
    if (mode === 'inline') { renderEditor(); const f = $('#tgEd [data-tg="label"]'); if (f) { f.focus(); f.select(); } }
    else openEditor(uid, true);
  }
  function deleteNode(uid) {
    flushPending();
    const m = curModel(); if (!m) return; const r = rowByUid(m, uid); if (!r) return;
    const [a0, a1] = nodeRange(m, r), lines = m.text.split('\n'), uids = m.id.uids.slice();
    const saved = { lines: lines.slice(a0, a1 + 1), uids: uids.slice(a0, a1 + 1), at: a0, after: a0 > 0 ? uids[a0 - 1] : null }; const name = labelOf(r);
    const sb = siblings(m, r), k = sb.list.findIndex((x) => x.row.i === r.i), nb = sb.list[k + 1] || sb.list[k - 1] || null;
    const nextUid = nb ? uids[nb.row.i] : (sb.parent ? uids[sb.parent.row.i] : null);
    lines.splice(a0, a1 - a0 + 1); uids.splice(a0, a1 - a0 + 1);
    if (lines.length === 0) { lines.push(''); uids.push(newUid()); }
    TG.sel[m.it.id] = nextUid || null; if (TG.page === uid) closePage(true);
    Object.keys(TG.err).forEach((e) => { if (saved.uids.indexOf(e.split('|')[0]) >= 0) delete TG.err[e]; });
    commit(m, lines, uids, stepLabel('tgStepDel', name), {});
    const itemId = m.it.id, oid = m.o.id;
    toast(t('tgDeleted', { name }), { ms: 10000, endsOnClose: true, action: { label: t('undoBtn'), fn: () => restoreRows(itemId, oid, saved, name) } });
    announce(t('tgDeleted', { name }));
    if (TG.view === 'list') { renderEditor(); if (nextUid) focusRowEl(nextUid); else { const l = $('#tgList'); if (l) l.focus(); } }
  }
  function restoreRows(itemId, oid, saved, name) {
    const f = A.findItem(itemId); if (!f) return; const m = model(f.it, f.o), lines = m.text.split('\n'), uids = m.id.uids.slice();
    // m-5: anchor on the row that was before it (a later delete or move cannot misplace it); the old index is only the fallback
    let at = saved.after ? uids.indexOf(saved.after) + 1 : 0; if (saved.after && at === 0) at = Math.min(saved.at, lines.length);
    const onlyBlank = m.rows.every((r) => r.kind === 'blank');
    if (onlyBlank) { lines.length = 0; uids.length = 0; at = 0; }
    lines.splice.apply(lines, [at, 0].concat(saved.lines)); uids.splice.apply(uids, [at, 0].concat(saved.uids));
    if (S.open !== itemId) A.openItem(itemId, { focus: false });
    const m2 = curModel() || m; TG.sel[itemId] = saved.uids[0];
    commit(m2, lines, uids, stepLabel('tgStepRestore', name), {}); renderEditor(); focusRowEl(saved.uids[0]);
  }
  function duplicateNode(uid) {
    flushPending();
    const m = curModel(); if (!m) return; const r = rowByUid(m, uid); if (!r) return;
    const [a0, a1] = nodeRange(m, r), lines = m.text.split('\n'), uids = m.id.uids.slice();
    const taken = takenKeys(m, -1).slice(), nl = [], nu = []; let gkey = null;
    for (let i = a0; i <= a1; i++) {
      const rr = m.rows[i]; let line = lines[i];
      if (rr.kind !== 'blank' && rr.kind !== 'bad' && (C.isValue(rr) || rr.kind === 'group')) { const nk = C.copyKey(rr.key, taken); taken.push(nk); if (rr.kind === 'group') gkey = nk; line = C.canon(Object.assign({}, rr, { key: nk })); }
      else if (rr.kind === 'groupEnd') { const g = groupNodeOf(m, a0); line = g && gkey ? C.endLineOf(Object.assign({}, g.row, { key: gkey })) : line; }
      nl.push(line); nu.push(newUid());
    }
    lines.splice.apply(lines, [a1 + 1, 0].concat(nl)); uids.splice.apply(uids, [a1 + 1, 0].concat(nu));
    TG.sel[m.it.id] = nu[0]; const name = labelOf(r);
    commit(m, lines, uids, stepLabel('tgStepDup', name), {}); announce(t('tgDuplicated', { name })); focusRowEl(nu[0]); renderEditor();
  }
  function moveToGroup(uid, gUid) {   // gUid null = out of its group
    flushPending();
    const m = curModel(); if (!m) return; const r = rowByUid(m, uid); if (!r || r.kind === 'group') { if (r && r.kind === 'group') note(t('tgNoGroupInGroup')); return; }
    const [a0, a1] = nodeRange(m, r); let res;
    if (gUid) { const gr = rowByUid(m, gUid), g = gr && groupNodeOf(m, gr.i); if (!g) return; res = relocate(m, a0, a1, g.endRow ? g.endRow.i : g.end + 1, false); }
    else { const pg = parentGroup(m, r.i); if (!pg) return; res = relocate(m, a0, a1, pg.endRow ? pg.endRow.i + 1 : pg.end + 1, true); }
    TG.flip = true; const name = labelOf(r);
    commit(m, res.lines, res.uids, stepLabel('tgStepMove', name), {}); TG.flip = false;
    announce(t(gUid ? 'tgMovedInto' : 'tgMovedOut', { name })); focusRowEl(uid); renderEditor();
  }
  function dropMove(uid, targetUid, pos) {
    flushPending();
    const m = curModel(); if (!m || uid === targetUid) return; const r = rowByUid(m, uid), tr = rowByUid(m, targetUid); if (!r || !tr) return;
    const [a0, a1] = nodeRange(m, r); const tpg = parentGroup(m, tr.i);
    if (r.kind === 'group' && tpg) { note(t('tgNoGroupInGroup')); announce(t('tgNoGroupInGroup')); return; }
    let to, top = true;
    if (tr.kind === 'group') {
      const g = groupNodeOf(m, tr.i);
      if (pos === 'after' && r.kind !== 'group' && !TG.collapsed.has(targetUid)) { to = tr.i + 1; top = false; }
      else if (pos === 'after') to = g.end + 1; else to = g.start;
    } else { const [, e] = nodeRange(m, tr); to = pos === 'before' ? tr.i : e + 1; top = !tpg; }
    if (to >= a0 && to <= a1 + 1) return;
    const res = relocate(m, a0, a1, to, top); TG.flip = true; const name = labelOf(r);
    commit(m, res.lines, res.uids, stepLabel('tgStepMove', name), {}); TG.flip = false; announce(t('tgMoved', { name })); focusRowEl(uid);
  }
  function note(msg) { TG.note = msg; const n = $('#tgNote'); if (n) { n.textContent = msg; n.hidden = !msg; } announce(msg); clearTimeout(TG.noteT); TG.noteT = setTimeout(() => { TG.note = ''; const n2 = $('#tgNote'); if (n2) { n2.textContent = ''; n2.hidden = true; } }, 5000); }
  function pasteLines(text, ctx) {
    flushPending();
    const m = curModel(); if (!m) return; const ls = String(text).replace(/\r/g, '').split('\n'); while (ls.length && ls[ls.length - 1] === '') ls.pop(); if (!ls.length) return;
    // m-1: a pasted group never lands inside a group (groups do not nest) and is always closed
    const pst = C.structure(C.parse(ls.join('\n'))), hasGroup = C.parse(ls.join('\n')).some((r) => r.kind === 'group'); let c2 = ctx, moved = false;
    if (hasGroup && ctx) {
      let g = null; if (ctx.group) g = rowByUid(m, ctx.group); else if (ctx.after) { const rr = rowByUid(m, ctx.after); const pg = rr && parentGroup(m, rr.i); if (pg) g = pg.row; }
      if (g) { c2 = { after: uidOf(m, g) }; moved = true; }
    }
    if (pst.openGroup) ls.push(C.endLineOf(pst.openGroup.row));
    const ins = insertionFor(m, c2); let lines = m.text.split('\n'), uids = m.id.uids.slice(), at = ins.at; const nu = ls.map(() => newUid());
    if (m.rows.every((r) => r.kind === 'blank')) { lines = []; uids = []; at = 0; }
    else if (ins.top) { const og = m.st.openGroup; if (og && at > og.end) { lines.splice(og.end + 1, 0, C.endLineOf(og.row)); uids.splice(og.end + 1, 0, newUid()); at = og.end + 2; } }
    lines.splice.apply(lines, [at, 0].concat(ls)); uids.splice.apply(uids, [at, 0].concat(nu));
    TG.sel[m.it.id] = nu[0];
    commit(m, lines, uids, t('tgStepPaste', { n: ls.length }), {}); toast(moved ? t('tgPasteMoved') : t('tgPasted', { n: ls.length }), {}); announce(moved ? t('tgPasteMoved') : t('tgPasted', { n: ls.length })); focusRowEl(nu[0]); renderEditor();
  }
  function closeGroup(oid) {
    flushPending();
    const o = O(oid), it = o && ownerItem(o); if (!it) return; const po = ownerAn(o).po; if (!po.spill) return;
    const lines = txt(it).split('\n'), el = C.endLineOf(po.spill.row), gi = po.spill.row.i;
    if (lines[lines.length - 1].trim() === '') lines[lines.length - 1] = el; else lines.push(el);
    const text = lines.join('\n'); edit(o.id, t('tgStepClose', { name: po.spill.row.label }), () => { it.f.defs = text; }, {});
    announce(t('tgClosed')); toast(t('tgClosed'), { ms: 5000, action: { label: t('undoBtn'), fn: () => A.undoOwner(o.id) } });
    if (S.view.type === 'tgmerged' && TG.renderMergedNow) { TG.renderMergedNow(); A.renderTree(); A.renderHeader(); A.refreshProblemsOnly(); schedPreview(); const b = $('#formHost .tgm-sec[data-oid="' + oid + '"] .tgm-row'); if (b) b.focus(); }
    else { afterEdit(); const id = ident(it); const u = id.uids[gi]; if (u && $('#tgr-' + u)) focusRowEl(u); }
  }

  /* ------------------------------------------------------------------ field edits (row editor) */
  const showErrFor = (u, field, oi, code, val) => { const k = u + '|' + field + (oi == null ? '' : oi); if (code) TG.err[k] = { code, val }; else delete TG.err[k]; };
  function showErr(field, code, oi) {
    const host = $('#tgEd'); if (!host) return;
    const box = host.querySelector('[data-tg-err="' + field + '"]'); const inp = field === 'opt' ? host.querySelector('[data-tg="opt"][data-oi="' + oi + '"]') : host.querySelector('[data-tg="' + field + '"]');
    if (box) { box.innerHTML = code ? ic('circle-alert', 14) + '<span>' + esc(t(errMsgKey(code))) + '</span>' : ''; box.toggleAttribute('data-shown', !!code); }
    if (inp) { if (code) { inp.setAttribute('aria-invalid', 'true'); inp.setAttribute('data-invalid', ''); } else { inp.removeAttribute('aria-invalid'); inp.removeAttribute('data-invalid'); } }
  }
  function fieldCode(field, val, r) {
    let code = C.checkField(field === 'opt' ? 'opt' : field, val);
    const req = (field === 'key' && C.isValue(r)) || (field === 'label' && (C.isValue(r) || r.kind === 'caption')) || field === 'opt';
    if (!code && req && val === '') code = field === 'key' ? 'emptyKey' : field === 'opt' ? 'emptyOpt' : 'emptyLabel';
    return code;
  }
  /* Q-4: names, keys and options are written after a short pause or at once on blur/compositionend, never in the middle of an IME composition */
  function schedWrite(el) {
    if (el.dataset.composing) return; const field = el.dataset.tg, oi = field === 'opt' ? Number(el.dataset.oi) : null;
    const m = curModel(); const r = m && selRow(m); if (!r) return; const u = uidOf(m, r);
    flushOther(field, oi);
    const code = field === 'raw' ? null : fieldCode(field, el.value, r);
    if (code) { TG.pw = null; clearTimeout(TG.pwT); showErrFor(u, field, oi, code, el.value); showErr(field, code, oi); patchRow(m, u, true); schedSecondary(); return; }
    if (field !== 'raw') { showErrFor(u, field, oi, null); showErr(field, null, oi); }
    TG.pw = { field, el, oi, uid: u, val: el.value, item: m.it.id }; clearTimeout(TG.pwT); TG.pwT = setTimeout(flushPending, 40);
  }
  function flushOther(field, oi) { const p = TG.pw; if (p && (p.field !== field || p.oi !== oi)) flushPending(); }
  function flushPending() {
    clearTimeout(TG.pwT); const p = TG.pw; if (!p) return; TG.pw = null;
    const val = p.el && p.el.isConnected ? p.el.value : p.val;
    const f = A.findItem(p.item); if (!f) return; if (S.open !== p.item) { const keep = S.open; S.open = p.item; try { if (p.field === 'raw') setRawNow(val, p.uid); else setField(p.field, val, p.oi, p.uid); } finally { S.open = keep; } return; }   // N-5: written to the item it was typed in, even when another item is already opening
    if (p.field === 'raw') setRawNow(val, p.uid); else setField(p.field, val, p.oi, p.uid);
  }
  function setField(field, val, oi, uid) {
    const m = curModel(); if (!m) return; const r = uid ? rowByUid(m, uid) : selRow(m); if (!r) return; const u = uidOf(m, r);
    const code = fieldCode(field, val, r);
    if (code) { showErrFor(u, field, oi, code, val); showErr(field, code, oi); patchRow(m, u, true); schedSecondary(); return; }
    showErrFor(u, field, oi, null); if (u === selUid(m)) showErr(field, null, oi);
    const nr = Object.assign({}, r, { opts: r.opts.slice() });
    if (field === 'opt') nr.opts[oi] = val; else nr[field] = val;
    if (field === 'key') { TG.auto.delete(u); if (TG.keyFrom[u] == null) TG.keyFrom[u] = r.key; }
    if (field === 'label' && TG.auto.has(u) && (C.isValue(nr) || nr.kind === 'group')) nr.key = C.suggestKey(val, takenKeys(m, r.i), ownerSlug(m.o));
    const line = C.canon(nr); if (line === r.raw) { patchRow(m, u, true); return; }
    const lines = m.text.split('\n'), uids = m.id.uids.slice(); lines[r.i] = line;
    if (r.kind === 'group' && (nr.label !== r.label || nr.key !== r.key)) { const g = groupNodeOf(m, r.i); if (g && g.endRow && g.endRow.raw === C.endLineOf(r)) lines[g.endRow.i] = C.endLineOf(nr); }
    let lab = stepLabel('tgStepEdit', nr.label || r.label || kname(r.kind));
    if (field === 'key') lab = t('tgStepKey', { from: TG.keyFrom[u], to: val });
    else if (field === 'opt') lab = stepLabel('tgStepOpts', nr.label);
    commit(m, lines, uids, lab, { key: m.it.id + '.tg.' + u + '.' + field + (oi == null ? '' : oi) }, { uid: u, sig: m.oa.po.dupKeys.join('|') + '#' + (TG.notices[m.it.id] ? 1 : 0) });
  }
  function keyChanged(u) {
    flushPending(); const m = curModel(); if (!m) return; const r = rowByUid(m, u); if (!r || !C.isValue(r)) return;
    delete TG.keyFrom[u]; refreshNotice();
  }
  const valueClass = (k) => (k === 'check' ? 'check' : k === 'select' ? 'select' : k === 'text' || k === 'textarea' ? 'text' : null);
  function changeType(nk) {
    flushPending();
    const m = curModel(); if (!m) return; const r = selRow(m); if (!r || r.kind === nk || r.kind === 'group' || badLike(r)) return; const u = uidOf(m, r);
    const nr = { kind: nk, key: '', label: r.label, opts: [] };
    if (nk === 'divider' || nk === 'caption') { nr.key = ''; if (nk === 'caption' && !nr.label) nr.label = t('tgNew_caption'); }
    else { nr.key = C.isValue(r) ? r.key : C.suggestKey(r.label, takenKeys(m, r.i), ownerSlug(m.o)); if (!C.isValue(r)) TG.auto.add(u); if (!nr.label) nr.label = t('tgNew_' + nk); if (nk === 'select') nr.opts = [t('tgOptN', { n: 1 }), t('tgOptN', { n: 2 })]; }
    const dropped = r.kind === 'select' && r.opts.length > 0;
    const lines = m.text.split('\n'); lines[r.i] = C.canon(nr); const oid = m.o.id;
    commit(m, lines, m.id.uids.slice(), t('tgStepType', { name: labelOf(r), from: kname(r.kind), to: kname(nk) }), {});
    if (dropped) toast(t('tgOptsDropped'), { ms: 10000, endsOnClose: true, action: { label: t('undoBtn'), fn: () => A.undoOwner(oid) } });
    renderEditor(); renderList(); refreshNotice();
  }
  function optOp(op, oi) {
    flushPending();
    const m = curModel(); if (!m) return; const r = selRow(m); if (!r || r.kind !== 'select') return;
    const nr = Object.assign({}, r, { opts: r.opts.slice() }); let lab;
    if (op === 'add') { nr.opts.push(t('tgOptN', { n: nr.opts.length + 1 })); lab = stepLabel('tgStepOptAdd', r.label); }
    else if (op === 'del') { if (nr.opts.length <= 2) return; nr.opts.splice(oi, 1); lab = stepLabel('tgStepOptDel', r.label); }
    else { const to = op === 'up' ? oi - 1 : oi + 1; if (to < 0 || to >= nr.opts.length) return; const x = nr.opts[oi]; nr.opts[oi] = nr.opts[to]; nr.opts[to] = x; lab = stepLabel('tgStepOptMove', r.label); }
    const lines = m.text.split('\n'); lines[r.i] = C.canon(nr);
    commit(m, lines, m.id.uids.slice(), lab, {});
    TG.focusOpt = op === 'add' ? nr.opts.length - 1 : op === 'del' ? Math.min(oi, nr.opts.length - 1) : (op === 'up' ? oi - 1 : oi + 1);
    renderEditor(); renderList(); refreshNotice({ focus: op === 'add' ? false : undefined });
    if (TG.notices[m.it.id] && TG.notices[m.it.id].state === 'ask' && op !== 'add') return;   // focus moved to the question (M-4)
    const el = $('#tgEd [data-tg="opt"][data-oi="' + TG.focusOpt + '"]'); if (el) { if (op === 'add') el.select(); else if (op === 'up' || op === 'down') { const b = $('#tgEd [data-tg-act="opt-' + op + '"][data-oi="' + TG.focusOpt + '"]'); (b && b.getAttribute('aria-disabled') !== 'true' ? b : el).focus(); } else el.focus(); }
  }
  /* M-6: the raw line field keeps its element while you type; the editor is rebuilt only on blur if the line became a normal row */
  function setRawNow(val, uid) {
    const m = curModel(); if (!m) return; const r = rowByUid(m, uid); if (!r || val === r.raw) return;
    const lines = m.text.split('\n'); lines[r.i] = val;
    commit(m, lines, m.id.uids.slice(), stepLabel('tgStepFix'), { key: m.it.id + '.tg.' + uid + '.raw' }, { uid, sig: m.oa.po.dupKeys.join('|') + '#' + (TG.notices[m.it.id] ? 1 : 0) });
  }
  const setRaw = (val) => { const m = curModel(); const r = m && selRow(m); if (r) setRawNow(val, uidOf(m, r)); };

  /* ------------------------------------------------------------------ the list */
  const edMode = () => { const l = S.layout; if (l === 'phone') return 'page'; if (l === 'mid') return 'sheet'; const h = $('#formHost'); return h && h.clientWidth >= 560 ? 'inline' : 'sheet'; };
  const summaryOf = (r, kids) => (r.kind === 'select' ? t('tgSumSelect', { n: r.opts.length }) : r.kind === 'text' ? t('tgSumText') : r.kind === 'textarea' ? t('tgSumArea') : r.kind === 'group' ? t('tgSumGroup', { n: kids }) : r.kind === 'check' ? t('tgSumCheck') : '');
  function rowHtml(m, r, lv, kids) {
    const u = uidOf(m, r), sel = selUid(m) === u, bad = badLike(r), valued = C.isValue(r);
    const po = m.oa.po, dup = valued && po.dupKeys.indexOf(r.key) >= 0, sh = valued && po.shared[r.i], hasErr = Object.keys(TG.err).some((k) => k.indexOf(u + '|') === 0);
    const few = r.kind === 'select' && r.opts.length < 2, nt = TG.notices[m.it.id], pend = !!(nt && nt.state === 'ask' && valued && issueKeys(nt).has(r.key));
    const flags = [];
    if (hasErr) flags.push('<span class="tgr-flag err" data-part="studio-tgb-row-flag" data-tone="err" title="' + esc(t('tgNotWritten')) + '">' + ic('circle-alert', 13) + '<span>' + esc(t('tgNotWritten')) + '</span></span>');
    if (dup) flags.push('<span class="tgr-flag err" data-part="studio-tgb-row-flag" data-tone="err">' + ic('circle-alert', 13) + '<span>' + esc(t('tgDupKey')) + '</span></span>');
    if (few) flags.push('<span class="tgr-flag warn" data-part="studio-tgb-row-flag" data-tone="warn">' + ic('triangle-alert', 13) + '<span>' + esc(t('tgFew')) + '</span></span>');
    if (r.kind === 'group' && kids === 0) flags.push('<span class="tgr-flag info" data-part="studio-tgb-row-flag" data-tone="info">' + ic('info', 13) + '<span>' + esc(t('tgEmptyGroup')) + '</span></span>');
    let shText = ''; if (sh) { const names = sh.owners.map((i) => m.oa.a.names[i]).filter(Boolean).join(', '); shText = sh.kindDiff ? t('tgSharedDiff', { owner: names }) : t('tgShared', { owner: names }); flags.push('<span class="tgr-flag ' + (sh.kindDiff ? 'warn' : 'info') + '" data-part="studio-tgb-row-flag" data-tone="' + (sh.kindDiff ? 'warn' : 'info') + '">' + ic('link', 13) + '<span>' + esc(shText) + '</span></span>'); }
    if (pend) flags.push('<span class="tgr-flag warn" data-part="studio-tgb-row-flag" data-tone="warn">' + ic('help-circle', 13) + '<span>' + esc(t('tgCarryPending')) + '</span></span>');
    if (r.unknownType) flags.push('<span class="tgr-flag info" data-part="studio-tgb-row-flag" data-tone="info" title="' + esc(t('tgLintUnknown', { type: r.type })) + '">' + ic('info', 13) + '<span>' + esc(r.type) + '</span></span>');
    const open = r.kind === 'group' ? !TG.collapsed.has(u) : null;
    const lbl = labelOf(r);
    const aria = bad ? lbl + ': ' + r.raw : lbl + ', ' + kname(r.kind) + (valued ? ', ' + t('tgKey') + ' ' + r.key : '') + (dup ? ', ' + t('tgDupKey') : '') + (hasErr ? ', ' + t('tgNotWritten') : '') + (few ? ', ' + t('tgFew') : '') + (shText ? ', ' + shText : '') + (pend ? ', ' + t('tgCarryPending') : '') + (r.kind === 'group' && kids === 0 ? ', ' + t('tgEmptyGroup') : '');
    const kcls = ['tgr', 'k-' + r.kind, sel ? 'sel' : '', bad ? 'bad' : '', dup || hasErr ? 'bad-field' : ''].filter(Boolean).join(' ');
    const roving = sel ? '0' : '-1';
    const sub = bad ? '<code class="tgr-raw" data-part="studio-tgb-row-raw">' + esc(r.raw) + '</code>' : valued ? '<small class="tgr-k" data-part="studio-tgb-row-key">' + ic('key', 11) + t('tgKeyDot') + esc(r.key) + '</small>' : '';
    return '<div class="' + kcls + '" data-part="studio-tgb-row" data-kind="' + r.kind + '"' + (sel ? ' data-selected' : '') + (open ? ' data-open' : '') + (bad ? ' data-invalid="unreadable"' : dup || hasErr ? ' data-invalid="field"' : '') + ' role="treeitem" id="tgr-' + u + '" data-uid="' + u + '" data-i="' + r.i + '" data-f="tgrow:' + r.i + '" aria-level="' + lv + '" aria-selected="' + sel + '"' + (open != null ? ' aria-expanded="' + open + '"' : '') + ' aria-label="' + esc(aria) + '" tabindex="' + roving + '" aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown Delete">' +
      '<span class="grip" aria-hidden="true" data-part="studio-tgb-row-grip">' + ic('grip-vertical', 16) + '</span>' +
      (open != null ? '<button type="button" class="tgr-chev btn sm" data-part="studio-tgb-row-chevron" tabindex="-1" data-tg-act="fold" aria-label="' + esc(t(open ? 'tgFold' : 'tgUnfold')) + '">' + ic(open ? 'chevron-down' : 'chevron-right', 16) + '</button>' : '') +
      '<span class="tgr-ic" data-part="studio-tgb-row-icon">' + ic(KICON[bad ? 'bad' : r.kind] || 'dot', 18) + '</span>' +
      '<span class="tgr-tx" data-part="studio-tgb-row-text"><span class="tgr-l' + (r.label || bad ? '' : ' muted') + '" data-part="studio-tgb-row-label"' + (r.label || bad ? '' : ' data-muted') + '>' + esc(lbl) + '</span>' + sub + (flags.length ? '<span class="tgr-flags" data-part="studio-tgb-row-flags">' + flags.join('') + '</span>' : '') + '</span>' +
      '<span class="tgr-sum" data-part="studio-tgb-row-summary">' + esc(bad ? '' : summaryOf(r, kids)) + '</span>' +
      (r.kind === 'group' ? '<button type="button" class="btn sm tgr-add" data-part="studio-tgb-row-add" tabindex="-1" data-tg-act="add" data-group="' + u + '" aria-label="' + esc(t('tgAddInGroup') + ': ' + lbl) + '" title="' + esc(t('tgAddInGroup')) + '">' + ic('plus', 18) + '</button>' : '') +
      '<button type="button" class="btn sm tgr-more" data-part="studio-tgb-row-more" tabindex="-1" data-tg-act="more" aria-haspopup="menu" aria-label="' + esc(t('tgRowMenu') + ': ' + lbl) + '" title="' + esc(t('tgRowMenu')) + '">' + ic('ellipsis', 18) + '</button></div>';
  }
  function patchRow(m, uid, keepFocus) {
    const e = $('#tgr-' + uid); const r = rowByUid(m, uid); if (!e || !r) return;
    const lv = +e.getAttribute('aria-level'), g = r.kind === 'group' ? groupNodeOf(m, r.i) : null, active = document.activeElement === e;
    const tmp = document.createElement('div'); tmp.innerHTML = rowHtml(m, r, lv, g ? g.children.length : 0); const ne = tmp.firstElementChild;
    if (e.className === ne.className && e.innerHTML === ne.innerHTML) return;
    e.replaceWith(ne); if (active) ne.focus({ preventScroll: true });
  }
  function addBtn(label) {
    return '<button type="button" class="btn tgb-add" data-part="studio-tgb-add" data-tg-act="add" id="tgAddEnd" aria-label="' + esc(t('tgAdd')) + '" title="' + esc(t('tgAdd')) + '">' + ic('plus', 18) + (label ? '<span>' + esc(t('tgAdd')) + '</span>' : '') + '</button>';
  }
  function listHtml(m) {
    let h = '';
    m.st.nodes.forEach((n) => {
      if (n.type === 'row') { h += rowHtml(m, n.row, 1, 0); return; }
      const u = uidOf(m, n.row), open = !TG.collapsed.has(u);
      h += '<div class="tgg" data-g="' + u + '" data-part="studio-tgb-group"' + (open ? ' data-open' : '') + '>' + rowHtml(m, n.row, 1, n.children.length) + '<div class="tgr-kids" data-part="studio-tgb-kids" role="group"' + (open ? '' : ' hidden') + '>' + n.children.map((c) => rowHtml(m, c.row, 2, 0)).join('') + '</div></div>';
    });
    return h;
  }
  function renderList() {
    const f = cur(), host = $('#tgList'); if (!f || !host) return;
    const m = model(f.it, f.o), had = host.contains(document.activeElement);
    const old = {}, only = TG.flipSet; if (TG.flip && !reduced()) $$('.tgr', host).forEach((e) => { if (only && !only.has(e.dataset.uid)) return; old[e.dataset.uid] = e.getBoundingClientRect().top; });   // N-6: only the rows the move passes over are measured
    const empty = m.rows.every((r) => r.kind === 'blank');
    $('#tgListWrap').dataset.empty = empty ? '1' : '0';
    host.innerHTML = listHtml(m);
    if (!$('.tgr[tabindex="0"]', host)) { const first = $('.tgr', host); if (first) first.tabIndex = 0; }
    const bn = $('#tgBadN'); if (bn) { const n = m.rows.filter((r) => r.kind === 'bad').length; bn.textContent = n ? t('tgBadList', { n }) : ''; bn.hidden = !n; }
    if (TG.flip && !reduced()) {
      $$('.tgr', host).forEach((e) => { if (only && !only.has(e.dataset.uid)) return; const o2 = old[e.dataset.uid]; if (o2 == null) return; const d = o2 - e.getBoundingClientRect().top; if (Math.abs(d) < 1) return; e.style.transform = 'translateY(' + d + 'px)'; e.style.transition = 'none'; requestAnimationFrame(() => requestAnimationFrame(() => { e.style.transition = ''; e.style.transform = ''; })); });
    }
    if (had) { const s = $('.tgr[aria-selected="true"]', host) || $('.tgr', host); if (s) s.focus({ preventScroll: true }); }
    const empt = $('#tgEmpty'); if (empt) empt.hidden = !empty;
  }
  function focusRowEl(uid) { const e = $('#tgr-' + uid); if (!e) return; $$('#tgList .tgr[tabindex="0"]').forEach((x) => { x.tabIndex = -1; }); e.tabIndex = 0; e.focus({ preventScroll: false }); e.scrollIntoView({ block: 'nearest' }); }
  function selectRow(uid, o2) {
    const f = cur(); if (!f) return; o2 = o2 || {}; flushPending(); const changed = TG.sel[f.it.id] !== uid;
    TG.sel[f.it.id] = uid; if (changed) TG.fresh = null;
    $$('#tgList .tgr').forEach((e) => { const on = e.dataset.uid === uid; e.classList.toggle('sel', on); e.setAttribute('aria-selected', String(on)); e.toggleAttribute('data-selected', on); e.tabIndex = on ? 0 : -1; });
    if (o2.focus) focusRowEl(uid);
    if (changed || o2.force) { renderEditor(); schedPreview(); }
    if (TG.view === 'text' && TG.gotoLine) TG.gotoLine(uid);
  }
  function visibleRows() { return $$('#tgList .tgr').filter((e) => !e.closest('[hidden]')); }
  function toggleFold(uid, force) {
    const open = !TG.collapsed.has(uid); const want = force == null ? !open : force; if (want === open) return;
    if (want) TG.collapsed.delete(uid); else TG.collapsed.add(uid);
    renderList();
  }
  function onListKey(e) {
    const row = e.target.closest('.tgr'); if (!row || e.target !== row) return; const uid = row.dataset.uid;
    const rows = visibleRows(), i = rows.indexOf(row);
    const go = (j) => { j = Math.max(0, Math.min(rows.length - 1, j)); selectRow(rows[j].dataset.uid, { focus: true }); };
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); moveNode(uid, e.key === 'ArrowUp' ? -1 : 1); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); go(i + 1); break;
      case 'ArrowUp': e.preventDefault(); go(i - 1); break;
      case 'Home': e.preventDefault(); go(0); break;
      case 'End': e.preventDefault(); go(rows.length - 1); break;
      case 'ArrowRight': if (row.getAttribute('aria-expanded') === 'false') { e.preventDefault(); toggleFold(uid, true); focusRowEl(uid); } else if (row.getAttribute('aria-expanded') === 'true') { e.preventDefault(); go(i + 1); } break;
      case 'ArrowLeft': e.preventDefault(); if (row.getAttribute('aria-expanded') === 'true') { toggleFold(uid, false); focusRowEl(uid); } else if (row.getAttribute('aria-level') === '2') { const g = row.closest('.tgg'); if (g) selectRow(g.dataset.g, { focus: true }); } break;
      case 'Enter': case ' ': e.preventDefault(); selectRow(uid, { force: true }); openEditor(uid, true); break;
      case 'Delete': e.preventDefault(); deleteNode(uid); break;
      case '+': case 'Insert': e.preventDefault(); openPicker(row.classList.contains('k-group') ? { group: uid } : { after: uid }, row); break;
      case 'ContextMenu': e.preventDefault(); openRowMenu(uid, row.querySelector('.tgr-more') || row); break;
      case 'F10': if (e.shiftKey) { e.preventDefault(); openRowMenu(uid, row.querySelector('.tgr-more') || row); } break;
    }
  }
  function onListClick(e) {
    const act = e.target.closest('[data-tg-act]'), row = e.target.closest('.tgr');
    if (act && act.dataset.tgAct === 'add') { openPicker(act.dataset.group ? { group: act.dataset.group } : {}, act); return; }
    if (!row) return; const uid = row.dataset.uid;
    if (act && act.dataset.tgAct === 'fold') { toggleFold(uid); focusRowEl(uid); return; }
    if (act && act.dataset.tgAct === 'more') { selectRow(uid); openRowMenu(uid, act); return; }
    selectRow(uid, { focus: true, force: true });
    if (edMode() !== 'inline') openEditor(uid, true);
  }
  function openRowMenu(uid, opener) {
    const m = curModel(); if (!m) return; const r = rowByUid(m, uid); if (!r) return;
    const sb = siblings(m, r), k = sb.list.findIndex((x) => x.row.i === r.i), items = [];
    items.push(['copy', t('tgDuplicate'), () => duplicateNode(uid), '']);
    items.push(['arrow-up', t('moveUp'), () => moveNode(uid, -1), '', k <= 0 ? { 'aria-disabled': 'true' } : {}]);
    items.push(['arrow-down', t('moveDown'), () => moveNode(uid, 1), '', k >= sb.list.length - 1 ? { 'aria-disabled': 'true' } : {}]);
    if (r.kind !== 'group') items.push(['folder-open', t('tgMoveToGroup'), () => setTimeout(() => openGroupMenu(uid, opener), 0), '']);
    items.push(['trash-2', t('del'), () => deleteNode(uid), 'danger']);
    A.openMenu(opener, t('tgRowMenu'), items);
  }
  function openGroupMenu(uid, opener) {
    const m = curModel(); if (!m) return; const r = rowByUid(m, uid); if (!r) return; const pg = parentGroup(m, r.i), items = [];
    m.st.nodes.filter((n) => n.type === 'group' && n !== pg).forEach((n) => items.push(['folder', n.row.label || t('tgNoName'), () => moveToGroup(uid, uidOf(m, n.row)), '']));
    if (pg) items.push(['corner-down-right', t('tgMoveOut'), () => moveToGroup(uid, null), '']);
    if (!items.length) items.push(['info', t('tgNoGroups'), () => {}, '', { 'aria-disabled': 'true' }]);
    A.openMenu(opener.isConnected ? opener : $('#tgList'), t('tgMoveToGroup'), items);
  }
  function openPicker(ctx, opener) {
    flushPending();
    const kinds = ['check', 'select', 'text', 'textarea', 'group', 'divider', 'caption'];
    A.openSheet({ title: t('tgAdd'), opener: opener || $('#tgAddEnd') || document.activeElement, cls: 'dlg tgpick', build(body) {
      body.innerHTML = '<p class="txt">' + esc(t('tgPickHint')) + '</p><div class="tgpick-grid" data-part="studio-tgb-pick-grid" role="group" aria-label="' + esc(t('tgPickTitle')) + '">' + kinds.map((k) => '<button type="button" class="btn tgpick-b" data-part="studio-tgb-pick-kind" data-kind="' + k + '" data-k="' + k + '"' + (k === 'group' && ctx && ctx.group ? ' aria-disabled="true" data-disabled' : '') + '>' + ic(KICON[k], 22) + '<span class="n" data-part="studio-tgb-pick-name">' + esc(kname(k)) + '</span><span class="h" data-part="studio-tgb-pick-hint">' + esc(t('tgHint_' + k)) + '</span></button>').join('') + '</div>' +
        '<button type="button" class="btn item tgpick-paste" data-part="studio-tgb-pick-paste" data-k="paste">' + ic('clipboard-paste', 20) + '<span>' + esc(t('tgPasteText')) + '</span></button>';
      body.addEventListener('click', (e) => {
        const b = e.target.closest('[data-k]'); if (!b || b.getAttribute('aria-disabled') === 'true') { if (b && b.dataset.k === 'group') note(t('tgNoGroupInGroup')); return; }
        A.closeSheet(false);
        if (b.dataset.k === 'paste') setTimeout(() => openPasteSheet(ctx), 0); else addRow(b.dataset.k, ctx);
      });
      const grid = body.querySelector('.tgpick-grid'); const btns = $$('.tgpick-b, .tgpick-paste', body);
      body.addEventListener('keydown', (e) => {
        const keys = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 2, ArrowUp: -2 }; if (!(e.key in keys) && e.key !== 'Home' && e.key !== 'End') return;
        const i = btns.indexOf(document.activeElement); if (i < 0) return; e.preventDefault();
        const cols = Math.max(1, Math.round(grid.getBoundingClientRect().width / (btns[0].getBoundingClientRect().width || 1)));
        let n = e.key === 'Home' ? 0 : e.key === 'End' ? btns.length - 1 : e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'ArrowDown' ? i + cols : i - cols;
        n = Math.max(0, Math.min(btns.length - 1, n)); btns[n].focus();
      });
    } });
  }
  function openPasteSheet(ctx) {
    A.openSheet({ title: t('tgPasteText'), opener: $('#tgAddEnd') || document.activeElement, cls: 'dlg', build(body) {
      body.innerHTML = '<p class="txt">' + esc(t('tgPasteHint')) + '</p><div class="fld tgpaste-fld" data-part="studio-tgb-paste-field"><label for="tgPasteTa" data-part="studio-tgb-paste-label">' + esc(t('tgPasteLbl')) + '</label><textarea id="tgPasteTa" data-part="studio-tgb-paste-input" class="mono" rows="6" spellcheck="false" data-autofocus="1"></textarea></div>' +
        '<div class="confirm-row"><button type="button" class="btn" data-x="cancel">' + ic('x', 18) + '<span>' + esc(t('cancel')) + '</span></button><button type="button" class="btn primary" data-x="ok">' + ic('check', 18) + '<span>' + esc(t('tgPasteDo')) + '</span></button></div>';
      body.querySelector('[data-x="cancel"]').onclick = () => A.closeSheet(true);
      body.querySelector('[data-x="ok"]').onclick = () => { const v = body.querySelector('#tgPasteTa').value; A.closeSheet(false); if (v.trim()) pasteLines(v, ctx); };
    } });
  }

  /* ------------------------------------------------------------------ row editor */
  const snippet = (key) => '{{getglobalvar::toggle_' + key + '}}';
  function fieldHtml(id, field, label, value, o2) {
    o2 = o2 || {};
    return '<div class="fld" data-part="studio-tgb-field" data-field="' + field + '"><label for="' + id + '" data-part="studio-tgb-field-label">' + esc(label) + (o2.opt ? ' <small class="hint">' + esc(t('tgOptional')) + '</small>' : '') + '</label><input type="text" id="' + id + '" data-part="studio-tgb-field-input" data-tg="' + field + '" value="' + esc(value) + '" autocomplete="off" spellcheck="false" aria-describedby="e-' + field + '"' + (o2.mono ? ' class="mono"' : '') + '><div class="tge-err" data-part="studio-tgb-field-error" id="e-' + field + '" data-tg-err="' + field + '" aria-live="polite"></div></div>';
  }
  function keyHintHtml(m, r) {
    const hs = C.keyHints(r.key, appKeys(m.it.id, r.i)); let h = '';
    hs.forEach((x) => { if (x === 'edge') h += '<p class="hint tge-sp" data-part="studio-tgb-adv-hint">' + esc(t('tgKeySpace')) + '</p>'; else if (x === 'inner') h += '<p class="hint tge-sp" data-part="studio-tgb-adv-hint">' + esc(t('tgKeyInner')) + '</p>'; else if (x.indexOf('twin:') === 0) h += '<p class="hint tge-sp" data-part="studio-tgb-adv-hint">' + esc(t('tgKeyTwin', { other: x.slice(5) })) + '</p>'; });
    return h;
  }
  function editorHtml(m, r) {
    const u = uidOf(m, r);
    if (badLike(r)) {
      const why = r.kind === 'groupEnd' ? t('tgWhyOrphan') : t(r.reason === 'caption' ? 'tgWhyCaption' : 'tgWhyKeyLabel');
      return '<div class="tge" data-uid="' + u + '" data-part="studio-tgb-edit" data-kind="' + r.kind + '"><div class="tge-head" data-part="studio-tgb-edit-head">' + ic('triangle-alert', 18) + '<strong data-part="studio-tgb-edit-title">' + esc(labelOf(r)) + '</strong></div><p class="tge-why" data-part="studio-tgb-edit-why">' + esc(why) + '. ' + esc(t('tgBadKept')) + '</p>' +
        '<div class="fld" data-part="studio-tgb-field" data-field="raw"><label for="tgf-raw" data-part="studio-tgb-field-label">' + esc(t('tgRawLine')) + '</label><input type="text" id="tgf-raw" data-part="studio-tgb-field-input" data-tg="raw" class="mono" value="' + esc(r.raw) + '" autocomplete="off" spellcheck="false"></div>' +
        '<div class="tge-acts" data-part="studio-tgb-edit-actions"><button type="button" class="btn solid danger" data-part="studio-tgb-edit-delete" data-tg-act="del">' + ic('trash-2', 16) + '<span>' + esc(t('del')) + '</span></button></div></div>';
    }
    const valued = C.isValue(r), isG = r.kind === 'group', isDiv = r.kind === 'divider', isCap = r.kind === 'caption';
    const labelName = isCap ? t('tgLblCaption') : isG ? t('tgLblGroup') : t('tgName');
    let h = '<div class="tge" data-uid="' + u + '" data-part="studio-tgb-edit" data-kind="' + r.kind + '"><div class="tge-head" data-part="studio-tgb-edit-head">' + ic(KICON[r.kind], 18) + '<strong data-part="studio-tgb-edit-title">' + esc(kname(r.kind)) + '</strong></div>';
    if (r.extra) h += '<p class="tge-warn" data-part="studio-tgb-edit-warn">' + ic('info', 14) + esc(t('tgWarnTail')) + '</p>';
    else if (r.unknownType) h += '<p class="tge-warn" data-part="studio-tgb-edit-warn">' + ic('info', 14) + esc(t('tgWarnUnknown', { type: r.type })) + '</p>';
    h += fieldHtml('tgf-label', 'label', labelName, r.label, { opt: isDiv });
    if (!isG) h += '<div class="fld" data-part="studio-tgb-field" data-field="type"><label for="tgf-type" data-part="studio-tgb-field-label">' + esc(t('tgTypeLbl')) + '</label><select id="tgf-type" data-part="studio-tgb-field-input" data-tg="type">' + KTYPES.filter((k) => k !== 'group').map((k) => '<option value="' + k + '"' + (k === r.kind ? ' selected' : '') + '>' + esc(kname(k)) + '</option>').join('') + '</select></div>';
    if (r.kind === 'select') {
      h += '<div class="fld tge-optsw" data-part="studio-tgb-opts" role="group" aria-labelledby="tgf-opts-l"><span class="lab" id="tgf-opts-l" data-part="studio-tgb-field-label">' + esc(t('tgOptions')) + '</span><ol class="tge-opts" data-part="studio-tgb-opt-list">' + r.opts.map((o2, i) => '<li data-part="studio-tgb-opt"><input type="text" data-part="studio-tgb-field-input" data-tg="opt" data-oi="' + i + '" value="' + esc(o2) + '" aria-label="' + esc(t('tgOptionN', { n: i + 1 })) + '" autocomplete="off" spellcheck="false" aria-describedby="e-opt">' +
        '<button type="button" class="btn sm" data-part="studio-tgb-opt-button" data-tg-act="opt-up" data-oi="' + i + '" aria-label="' + esc(t('tgOptUp', { n: i + 1 })) + '"' + (i === 0 ? ' aria-disabled="true" data-disabled' : '') + '>' + ic('arrow-up', 16) + '</button>' +
        '<button type="button" class="btn sm" data-part="studio-tgb-opt-button" data-tg-act="opt-down" data-oi="' + i + '" aria-label="' + esc(t('tgOptDown', { n: i + 1 })) + '"' + (i === r.opts.length - 1 ? ' aria-disabled="true" data-disabled' : '') + '>' + ic('arrow-down', 16) + '</button>' +
        '<button type="button" class="btn sm" data-part="studio-tgb-opt-button" data-tg-act="opt-del" data-oi="' + i + '" aria-label="' + esc(t('tgOptDel', { n: i + 1 })) + '"' + (r.opts.length <= 2 ? ' aria-disabled="true" data-disabled' : '') + '>' + ic('trash-2', 16) + '</button></li>').join('') + '</ol>' +
        '<div class="tge-err" data-part="studio-tgb-field-error" id="e-opt" data-tg-err="opt" aria-live="polite"></div><button type="button" class="btn solid" data-part="studio-tgb-opt-add" data-tg-act="opt-add">' + ic('plus', 16) + '<span>' + esc(t('tgAddOption')) + '</span></button>' + (r.opts.length < 2 ? '<p class="tge-warn" data-part="studio-tgb-edit-warn">' + ic('triangle-alert', 14) + esc(t('tgFewHint')) + '</p>' : '') + '</div>';
    }
    if (valued || isG) {
      const dup = valued && m.oa.po.dupKeys.indexOf(r.key) >= 0;
      h += '<details class="tge-adv" id="tgAdv" data-part="studio-tgb-adv"' + (TG.adv ? ' open data-open' : '') + '><summary data-part="studio-tgb-adv-summary">' + ic('key', 16) + '<span>' + esc(t('tgAdvanced')) + '</span><small>' + esc(t('tgKeyDot') + r.key) + '</small></summary>' + fieldHtml('tgf-key', 'key', t('tgKey'), r.key, { mono: true }) +
        '<p class="tge-dup err" data-part="studio-tgb-adv-dup" id="tgDupMsg"' + (dup ? '' : ' hidden') + '>' + ic('circle-alert', 14) + esc(t('tgDupKey')) + '</p><div id="tgKeyHints" data-part="studio-tgb-adv-hints">' + keyHintHtml(m, r) + '</div>' +
        (valued ? '<div class="tge-snip" data-part="studio-tgb-snippet"><code id="tgSnip" data-part="studio-tgb-snippet-code">' + esc(snippet(r.key)) + '</code><button type="button" class="btn sm" data-part="studio-tgb-snippet-copy" data-tg-act="copy" aria-label="' + esc(t('tgCopy')) + '" title="' + esc(t('tgCopy')) + '">' + ic('copy', 16) + '</button></div>' : '<p class="hint" data-part="studio-tgb-adv-hint">' + esc(t('tgGroupKeyNote')) + '</p>') + '</details>';
    }
    h += '<div class="tge-acts" data-part="studio-tgb-edit-actions"><button type="button" class="btn solid" data-part="studio-tgb-edit-duplicate" data-tg-act="dup">' + ic('copy', 16) + '<span>' + esc(t('tgDuplicate')) + '</span></button><button type="button" class="btn solid danger" data-part="studio-tgb-edit-delete" data-tg-act="del">' + ic('trash-2', 16) + '<span>' + esc(t('del')) + '</span></button></div></div>';
    return h;
  }
  function renderEditor() {
    const host = $('#tgEd'); if (!host) return; const f = cur(); const m = curModel(); if (!m) return; const r = selRow(m);
    if (!r) { host.innerHTML = '<div class="tge-none" data-part="studio-tgb-editor-none">' + ic('list', 22) + '<p>' + esc(t('tgPickRow')) + '</p></div>'; return; }
    host.innerHTML = (inSheet() ? noticeHtml(f, 'ed') : '') + editorHtml(m, r);
    const adv = $('#tgAdv', host); if (adv) adv.addEventListener('toggle', () => { TG.adv = adv.open; adv.toggleAttribute('data-open', adv.open); });
    // m-10: a text that was refused is kept in its field (with the error) until the author changes it
    const u = uidOf(m, r);
    Object.keys(TG.err).forEach((k) => { if (k.indexOf(u + '|') !== 0) return; const mm = /^\w+\|(label|key|opt)(\d*)$/.exec(k); if (!mm) return; const oi = mm[1] === 'opt' ? Number(mm[2]) : null; const inp = mm[1] === 'opt' ? host.querySelector('[data-tg="opt"][data-oi="' + oi + '"]') : host.querySelector('[data-tg="' + mm[1] + '"]'); if (inp) { inp.value = TG.err[k].val; showErr(mm[1], TG.err[k].code, oi); } });
  }
  function syncEditorLight() {
    const host = $('#tgEd'); const m = curModel(); if (!host || !m) return; const r = selRow(m); if (!r) return;
    if (!badLike(r)) { const k = host.querySelector('[data-tg="key"]'); if (k && k !== document.activeElement) k.value = r.key; }
    const sn = $('#tgSnip', host); if (sn) sn.textContent = snippet(r.key);
    const sm = $('#tgDupMsg', host); if (sm) sm.hidden = !(C.isValue(r) && m.oa.po.dupKeys.indexOf(r.key) >= 0);
    const hs = $('#tgKeyHints', host); if (hs && !badLike(r)) hs.innerHTML = keyHintHtml(m, r);
    const sum = $('#tgAdv > summary small', host); if (sum) sum.textContent = t('tgKeyDot') + r.key;
    const ph = $('.tgb-pagehd strong'); if (ph) ph.textContent = labelOf(r);
  }
  function onEdInput(e) {
    const el = e.target.closest('[data-tg]'); if (!el || el.tagName === 'SELECT') return; if (e.isComposing || el.dataset.composing) return;
    schedWrite(el);
  }
  function onEdChange(e) {
    const el = e.target.closest('[data-tg]'); if (!el) return; const k = el.dataset.tg;
    if (k === 'type') { changeType(el.value); return; }
    flushPending();
    if (k === 'key') { const m = curModel(); const r = m && selRow(m); if (r) keyChanged(uidOf(m, r)); }
    else if (k === 'raw') { const m = curModel(); const r = m && selRow(m); const u0 = r && uidOf(m, r); setTimeout(() => { const m2 = curModel(), r2 = m2 && selRow(m2); if (r2 && uidOf(m2, r2) === u0 && !badLike(r2)) { renderEditor(); renderList(); } }, 0); }
  }
  function onEdFocusIn(e) {
    const el = e.target.closest('[data-tg="key"]'); if (!el) return; const m = curModel(); const r = m && selRow(m); if (r && TG.keyFrom[uidOf(m, r)] == null) TG.keyFrom[uidOf(m, r)] = r.key;
  }
  function onEdClick(e) {
    const b = e.target.closest('[data-tg-act]'); if (!b) return; const a = b.dataset.tgAct; if (b.getAttribute('aria-disabled') === 'true') return;
    const m = curModel(); const r = m && selRow(m); const oi = Number(b.dataset.oi);
    if (a === 'carry-yes') answer('yes'); else if (a === 'carry-no') answer('no'); else if (a === 'carry-undo') { const f = cur(); if (f) A.undoOwner(f.o.id); }
    else if (a === 'opt-add') optOp('add'); else if (a === 'opt-del') optOp('del', oi); else if (a === 'opt-up') optOp('up', oi); else if (a === 'opt-down') optOp('down', oi);
    else if (a === 'del' && r) { deleteNode(uidOf(m, r)); if (edMode() === 'sheet') A.closeSheet(false); }
    else if (a === 'dup' && r) duplicateNode(uidOf(m, r));
    else if (a === 'copy' && r) { TG.auto.delete(uidOf(m, r)); copySnippet(r.key); }   // m-12: once the snippet was copied the key is fixed
    else if (a === 'refs-update') doUpdateRefs(b.dataset.from, b.dataset.to); else if (a === 'refs-also') doUpdateRefs(b.dataset.from, b.dataset.to, [b.dataset.oid]);
    else if (a === 'refs-search') { A.openSearch(b); const i = $('#searchInput'); i.value = 'toggle_' + b.dataset.from; A.runSearch(); }
    else if (a === 'ref-open') { A.openItem(b.dataset.item, { focus: true, user: true }); }
  }
  function doUpdateRefs(from, to, include) {
    flushPending(); const f = cur(); const res = updateRefs(from, to, include, f && f.it.id); if (!res.places) return;
    announce(t('tgRefsDone', { n: res.places }));
    toast(t('tgRefsDone', { n: res.places }), { ms: 8000, action: { label: t('tgRefsUndo'), fn: () => A.undoOwner(res.touched[0]) } });   // DD-116: one cross-owner step; undo is all-or-nothing and says which owner changed since
    renderBanners(); A.renderTree(); A.refreshProblemsOnly(); A.renderHeader();
  }
  function copySnippet(key) {
    const s = snippet(key); let ok = false;
    try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(s).catch(() => {}); ok = true; } } catch (_) {}
    if (!ok) { try { const ta = document.createElement('textarea'); ta.value = s; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); } catch (_) {} }
    TG.lastCopy = s; toast(t('tgCopied'), {}); announce(t('tgCopied'));
  }
  function onEdPaste(e) {
    const inp = e.target.closest('[data-tg]'); if (!inp || inp.tagName !== 'INPUT' || inp.dataset.tg === 'raw') return;
    const tx = e.clipboardData && e.clipboardData.getData('text'); if (!tx || !/[\r\n]/.test(tx)) return; e.preventDefault();
    const f = inp.dataset.tg, m = curModel(), r = m && selRow(m); if (!r) return; const oi = f === 'opt' ? Number(inp.dataset.oi) : null;
    showErrFor(uidOf(m, r), f, oi, 'nl', inp.value); showErr(f, 'nl', oi); patchRow(m, uidOf(m, r), true); schedSecondary();
  }
  function bindEditor(el) {
    el.addEventListener('paste', onEdPaste); el.addEventListener('input', onEdInput); el.addEventListener('change', onEdChange); el.addEventListener('click', onEdClick); el.addEventListener('focusin', onEdFocusIn);
    el.addEventListener('compositionstart', (e) => { if (e.target.dataset) e.target.dataset.composing = '1'; });
    el.addEventListener('compositionend', (e) => { if (e.target.dataset) { delete e.target.dataset.composing; if (e.target.dataset.tg) schedWrite(e.target); } });
    el.addEventListener('focusout', (e) => { if (e.target.dataset && e.target.dataset.tg && e.target.dataset.tg !== 'type' && !e.target.dataset.composing) flushPending(); });
  }
  function openEditor(uid, focus) {
    const mode = edMode(); const f = cur(); if (!f) return;
    if (mode === 'inline') { renderEditor(); if (focus) { const x = $('#tgEd [data-tg="label"], #tgEd [data-tg="raw"]'); if (x) x.focus(); } return; }
    if (mode === 'sheet') {
      TG.sheetEd = true;
      A.openSheet({ title: t('tgEditRow'), opener: $('#tgr-' + uid) || document.activeElement, cls: 'dlg tall tgside', build(body) { body.innerHTML = '<div id="tgEd" class="tgb-ed in-sheet" data-part="studio-tgb-editor" data-in="sheet"></div>'; bindEditor(body); renderEditor(); const x = $('#tgEd [data-tg="label"], #tgEd [data-tg="raw"]', body); if (x) { x.setAttribute('data-autofocus', '1'); if (TG.fresh === uid) setTimeout(() => { if (document.activeElement !== x) x.focus(); x.select(); }, 20); } } });
      return;
    }
    openPage(uid);
  }
  function openPage(uid) {
    TG.page = uid; const layer = { kind: 'tgpage', close: () => closePage(true) }; TG.pageLayer = layer; A.pushLayer(layer);
    renderBuilder(); const x = $('#tgEd [data-tg="label"], #tgEd [data-tg="raw"]'); if (x) { x.focus(); if (TG.fresh === uid && x.select) x.select(); }
  }
  function closePage(restore) {
    if (!TG.page) return; flushPending(); const uid = TG.page; TG.page = null; if (TG.pageLayer) { A.dropLayer(TG.pageLayer); TG.pageLayer = null; }
    if (!cur()) return; renderBuilder(); if (restore) focusRowEl(uid);
  }

  /* ------------------------------------------------------------------ builder shell */
  function renderBanners() {
    const f = cur(), host = $('#tgBanners'); if (!f || !host) return; const oa = ownerAn(f.o), po = oa.po; let h = '';
    h += inSheet() ? '' : noticeHtml(f, 'bn');
    if (po.spill) h += '<div class="tgb-banner err" role="alert" data-part="studio-tgb-alert" data-part-critical data-kind="open-group" data-severity="' + (po.spill.hard ? 'error' : 'warning') + '">' + ic(po.spill.hard ? 'circle-alert' : 'triangle-alert', 18) + '<span class="t" data-part="studio-tgb-alert-text">' + esc(po.spill.hard ? t('tgSpill') : t('tgUnclosed')) + '</span><button type="button" class="btn solid" data-part="studio-tgb-alert-action" data-tg-act="close-group">' + ic('check', 16) + '<span>' + esc(t('tgCloseGroup')) + '</span></button></div>';
    if (po.split) h += '<div class="tgb-banner info" data-part="studio-tgb-banner" data-kind="info">' + ic('info', 16) + '<span class="t" data-part="studio-tgb-banner-text">' + esc(t('tgSplitGroup')) + '</span></div>';
    if (oa.inJoin && po.swallowed) h += '<div class="tgb-banner info" data-part="studio-tgb-banner" data-kind="info">' + ic('info', 16) + '<span class="t" data-part="studio-tgb-banner-text">' + esc(t('tgSwallowed')) + '</span></div>';
    if (!oa.inJoin) h += '<div class="tgb-banner info" data-part="studio-tgb-banner" data-kind="info">' + ic('circle-off', 16) + '<span class="t" data-part="studio-tgb-banner-text">' + esc(t('tgOffOwner')) + '</span></div>';
    if (host.innerHTML !== h) host.innerHTML = h;
    persistNotices();
  }
  function renderBuilder() {
    const f = cur(), host = $('#formHost'); if (!f) return;
    const m = model(f.it, f.o), mode = edMode(); let page = mode === 'page' && TG.page;
    const pageRow = page ? rowByUid(m, TG.page) : null;
    if (page && !pageRow) { TG.page = null; page = false; if (TG.pageLayer) { A.dropLayer(TG.pageLayer); TG.pageLayer = null; } }
    host.classList.add('tgb-host');
    const seg = '<div class="seg tgb-seg" data-part="studio-tgb-view-seg" role="group" aria-label="' + esc(t('tgViewLbl')) + '"><button type="button" class="btn" data-part="studio-tgb-view-button" data-tg-act="view" data-v="list" aria-pressed="' + (TG.view === 'list') + '"' + (TG.view === 'list' ? ' data-active' : '') + '>' + ic('list', 18) + '<span>' + esc(t('tgViewList')) + '</span></button><button type="button" class="btn" data-part="studio-tgb-view-button" data-tg-act="view" data-v="text" aria-pressed="' + (TG.view === 'text') + '"' + (TG.view === 'text' ? ' data-active' : '') + '>' + ic('file-text', 18) + '<span>' + esc(t('tgViewText')) + '</span></button></div>';
    const bar = '<div class="tgb-bar" data-part="studio-tgb-bar">' + seg + '<span class="sp"></span><button type="button" class="btn sm" data-part="studio-tgb-merged-button" data-tg-act="merged" aria-label="' + esc(t('tgMergedBtn')) + '" title="' + esc(t('tgMergedBtn')) + '">' + ic('layers', 18) + '</button></div>';
    let body;
    if (TG.view === 'text') body = TG.textHtml ? TG.textHtml(m) : '';
    else if (page && TG.page) body = '<div class="tgb-page" data-part="studio-tgb-page"><div class="tgb-pagehd" data-part="studio-tgb-page-head"><button type="button" class="btn" data-part="studio-tgb-page-back" data-tg-act="page-back" aria-label="' + esc(t('tgBackToList')) + '" title="' + esc(t('tgBackToList')) + '">' + ic('arrow-left', 20) + '</button><strong data-part="studio-tgb-page-title">' + esc(labelOf(pageRow)) + '</strong></div><div id="tgEd" class="tgb-ed" data-part="studio-tgb-editor" data-in="page"></div></div>';
    else body = '<div class="tgb-cols' + (mode === 'inline' ? ' two' : '') + '" data-part="studio-tgb-cols"' + (mode === 'inline' ? ' data-split' : '') + '><section class="tgb-listcol" data-part="studio-tgb-listcol" id="tgListWrap" aria-label="' + esc(t('tgListLbl')) + '"><p class="tgb-note" data-part="studio-tgb-note" id="tgNote" role="status" hidden></p><p class="hint tgb-bad" data-part="studio-tgb-bad-count" id="tgBadN" hidden></p>' +
      '<div class="tgb-empty" id="tgEmpty" data-part="studio-tgb-empty" hidden><h2 data-part="studio-tgb-empty-title">' + esc(t('tgEmpty')) + '</h2><p data-part="studio-tgb-empty-text">' + esc(t('tgEmptyHint')) + '</p><div class="tgb-empty-grid" data-part="studio-tgb-empty-grid">' + ['check', 'select', 'text', 'textarea', 'group', 'divider', 'caption'].map((k) => '<button type="button" class="btn solid" data-part="studio-tgb-empty-kind" data-kind="' + k + '" data-tg-act="add-kind" data-k="' + k + '">' + ic(KICON[k], 18) + '<span>' + esc(kname(k)) + '</span></button>').join('') + '</div></div>' +
      '<div class="tgb-list" data-part="studio-tgb-list" id="tgList" role="tree" aria-label="' + esc(t('tgListLbl')) + '" aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown Delete"></div><div class="tgb-addrow" data-part="studio-tgb-addrow">' + addBtn(true) + '</div></section>' +
      (mode === 'inline' ? '<section class="tgb-ed" id="tgEd" data-part="studio-tgb-editor" data-in="inline" aria-label="' + esc(t('tgEditRow')) + '"></section>' : '') + '</div>';
    host.innerHTML = A.peerBannerHtml(f.it) + '<div id="tgBanners" class="tgb-banners" data-part="studio-tgb-banners"></div>' + bar + '<div class="tgb" data-part="studio-tgb" data-mode="' + mode + '" data-view="' + TG.view + '">' + body + '</div>';
    if (TG.view === 'list' && !page) { renderList(); renderEditor(); } else if (page) { renderEditor(); } else if (TG.afterText) TG.afterText(m);
    renderBanners();
  }
  ST.ext.renderForm = (it, o, host) => {
    if (it.kind !== 'toggles') { host.classList.remove('tgb-host'); return false; }
    if (TG.first[it.id] == null) TG.first[it.id] = txt(it);
    if (TG.lastItem !== it.id) { flushPending(); TG.lastItem = it.id; TG.visit[it.id] = ++TG.visitN; Object.keys(TG.notices).forEach((id) => { if (TG.notices[id].state !== 'ask') delete TG.notices[id]; }); if (window.StudioTabs) { S.sideTab = 'preview'; } TG.page = null; if (TG.pageLayer) { A.dropLayer(TG.pageLayer); TG.pageLayer = null; } }
    // a pending question stays (item, row, after Back); only its content is brought up to date with the text
    const n = TG.notices[it.id]; if (n && n.state === 'ask') { const iss = C.carryIssues(baseText(it, o), txt(it)); if (!iss.length) delete TG.notices[it.id]; else { n.issues = iss; n.sig = JSON.stringify(iss); n.text = txt(it); } }
    const m0 = model(it, o); if (!TG.sel[it.id] || m0.id.uids.indexOf(TG.sel[it.id]) < 0) { const first = m0.st.nodes[0]; TG.sel[it.id] = first ? m0.id.uids[first.row.i] : null; }
    renderBuilder(); return true;
  };
  ST.ext.focusFirst = (it) => { if (it.kind !== 'toggles') return false; const r = $('#tgList .tgr[tabindex="0"]') || $('#tgList .tgr') || $('#tgAddEnd') || $('#formHost .tgb-bar button'); if (r) { r.focus({ preventScroll: true }); return true; } return false; };
  ST.ext.headActs = (it) => (it.kind === 'toggles' && S.layout !== 'wide' ? '<button type="button" class="btn" data-tg-act="preview" data-panel="preview" aria-haspopup="dialog" aria-label="' + esc(t('tgPreviewBtn')) + '" title="' + esc(t('tgPreviewBtn')) + '">' + ic('eye', 18) + '</button>' : '');
  ST.ext.unknownState = (name) => { ST.enter({ from: 'chat', noFocus: true }); A.showNotice(t('tgUnknownState', { name })); };
  /* events (delegated once on #formHost) */
  (function bind() {
    const host = $('#formHost');
    host.addEventListener('keydown', (e) => { if (e.target.closest('#tgList')) onListKey(e); });
    host.addEventListener('click', (e) => {
      if (e.target.closest('#tgList')) { onListClick(e); return; }
      const b = e.target.closest('[data-tg-act]'); if (!b) return; const a = b.dataset.tgAct;
      if (a === 'view') setView(b.dataset.v); else if (a === 'merged') openMerged(); else if (a === 'close-group') { const f = cur(), oid = b.dataset.oid || (f && f.o.id); if (oid) closeGroup(oid); }
      else if (a === 'add') openPicker({}, b); else if (a === 'add-kind') addRow(b.dataset.k, {}); else if (a === 'page-back') closePage(true);
    });
    bindEditor(host);
    host.addEventListener('focusin', (e) => { const row = e.target.closest && e.target.closest('#tgList .tgr'); if (row && e.target === row) { const f = cur(); if (f && TG.sel[f.it.id] !== row.dataset.uid) selectRow(row.dataset.uid, {}); } });
    host.addEventListener('paste', (e) => { if (!e.target.closest('#tgList')) return; const tx = e.clipboardData && e.clipboardData.getData('text'); if (!tx || tx.indexOf('\n') < 0 && !/=/.test(tx)) return; e.preventDefault(); const row = e.target.closest('.tgr'); pasteLines(tx, row ? (row.classList.contains('k-group') ? { group: row.dataset.uid } : { after: row.dataset.uid }) : {}); });
    // drag (fine pointer only; the menu and Alt+Up/Down are the other ways); m-15: the list scrolls near its edges
    const dropAt = (x, y) => {
      const d = TG.drag; if (!d) return; $$('#tgList .drop-before, #tgList .drop-after').forEach((q) => { q.classList.remove('drop-before', 'drop-after'); q.removeAttribute('data-drop'); });
      const t2 = document.elementsFromPoint(x, y).filter((q) => q.classList && q.classList.contains('tgr') && q !== d.row)[0];
      if (t2) { const rc = t2.getBoundingClientRect(); d.target = t2.dataset.uid; d.pos = y < rc.top + rc.height / 2 ? 'before' : 'after'; t2.classList.add('drop-' + d.pos); t2.setAttribute('data-drop', d.pos); } else d.target = null;
    };
    const scrollLoop = () => {
      const d = TG.drag; if (!d || !d.moved) { TG.scrollRaf = 0; return; } const main = $('#main'), rc = main.getBoundingClientRect(); let v = 0;
      if (d.ly < rc.top + 48) v = -14; else if (d.ly > rc.bottom - 48) v = 14;
      if (v) { const before = main.scrollTop; main.scrollTop += v; if (main.scrollTop !== before) { d.row.style.transform = 'translateY(' + (d.ly - d.y0 + (main.scrollTop - d.s0)) + 'px)'; dropAt(d.lx, d.ly); } }
      TG.scrollRaf = requestAnimationFrame(scrollLoop);
    };
    host.addEventListener('pointerdown', (e) => {
      const g = e.target.closest('.grip'); if (!g || e.pointerType === 'touch' || e.button !== 0) return; const row = g.closest('.tgr'); if (!row) return;
      TG.drag = { uid: row.dataset.uid, row, y0: e.clientY, moved: false, target: null, pos: null, id: e.pointerId, lx: e.clientX, ly: e.clientY, s0: $('#main').scrollTop }; try { g.setPointerCapture(e.pointerId); } catch (_) {} e.preventDefault(); selectRow(row.dataset.uid, {});
    });
    host.addEventListener('pointermove', (e) => {
      const d = TG.drag; if (!d || e.pointerId !== d.id) return; d.lx = e.clientX; d.ly = e.clientY;
      if (!d.moved && Math.abs(e.clientY - d.y0) > 4) { d.moved = true; d.row.classList.add('dragging'); d.row.setAttribute('data-dragging', ''); document.body.classList.add('tg-dragging'); if (!TG.scrollRaf) TG.scrollRaf = requestAnimationFrame(scrollLoop); }
      if (!d.moved) return; d.row.style.transform = 'translateY(' + (e.clientY - d.y0 + ($('#main').scrollTop - d.s0)) + 'px)'; dropAt(e.clientX, e.clientY);
    });
    const endDrag = (e, cancel) => {
      const d = TG.drag; if (!d || e.pointerId !== d.id) return; TG.drag = null; d.row.classList.remove('dragging'); d.row.removeAttribute('data-dragging'); d.row.style.transform = ''; document.body.classList.remove('tg-dragging');
      $$('#tgList .drop-before, #tgList .drop-after').forEach((x) => { x.classList.remove('drop-before', 'drop-after'); x.removeAttribute('data-drop'); });
      if (!cancel && d.moved && d.target) dropMove(d.uid, d.target, d.pos);
    };
    host.addEventListener('pointerup', (e) => endDrag(e, false)); host.addEventListener('pointercancel', (e) => endDrag(e, true));
    new MutationObserver(() => { const rt = $('#sheetRoot'); if (TG.sheetEd && !rt.classList.contains('open')) { TG.sheetEd = false; flushPending(); requestAnimationFrame(() => { const f = cur(); if (!f) return; renderBanners(); if (f && TG.sel[f.it.id]) focusRowEl(TG.sel[f.it.id]); }); } }).observe($('#sheetRoot'), { attributes: true, attributeFilter: ['class'] });
    addEventListener('resize', () => { const f = cur(); if (f && S.inStudio) { const mode = edMode(), b = $('#formHost .tgb'); if (b && b.dataset.mode !== mode) { if (mode !== 'page' && TG.page) closePage(false); renderBuilder(); } } });
  })();
  function setView(v) {
    if (TG.view === v) return; flushPending(); const f = cur(); if (!f) return;
    if (v === 'list' && TG.textCaretUid) { TG.sel[f.it.id] = TG.textCaretUid; }
    TG.view = v; renderBuilder();
    if (v === 'text' && TG.gotoLine) TG.gotoLine(TG.sel[f.it.id], true);
    const b = $('#formHost [data-tg-act="view"][data-v="' + v + '"]'); if (b) b.focus();
    announce(t(v === 'list' ? 'tgViewList' : 'tgViewText'));
  }
  function openMerged() {
    const r = { id: 'merged:toggles', type: 'mkind', kind: 'toggles' };
    flushPending(); S.exp.add('merged'); S.exp.add('merged:toggles'); ST.ext.openMerged(r);
  }
  ST.ext.openMerged = (r) => {
    TG.lastItem = null;
    S.exp.add('merged'); S.exp.add('merged:toggles'); S.view = { type: 'tgmerged' }; S.open = null; S.sel = 'merged:toggles'; S.focusId = 'merged:toggles';
    if (S.layout === 'phone') S.phone = 'detail'; if (S.layout === 'mid' && S.drawer) { S.drawer = false; }
    A.saveUi(); A.renderAll(); A.focusRow('merged:toggles', true);
  };
  Object.assign(TG, { A, C, model, curModel, cur, ownerAn, analysis, solo, ownerItem, ownerText, selRow, rowByUid, uidOf, labelOf, kname, KICON, edMode, renderBuilder, renderList, renderEditor, renderBanners, addRow, deleteNode, duplicateNode, moveNode, moveToGroup, dropMove, pasteLines, closeGroup, setField, setRaw, optOp, changeType, answer, selectRow, openPicker, openEditor, openPage, closePage, openRowMenu, setView, openMerged, afterEdit, commit, txt, ident, tgProblems, note, focusRowEl, keyChanged, copySnippet, reduced, stepLabel, snippet, ctxOwners, newUid, flushPending, schedPreview, schedSecondary, refreshNotice, rebase, baseText, findRefs, updateRefs, doUpdateRefs, takenKeys, ownerSlug, ownersUsing, appKeys, tick, patchRow, previewVisible });
})();
