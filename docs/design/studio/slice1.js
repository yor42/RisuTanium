/* Studio slice 1 mockup. Synthetic; not proof of native behaviour or performance. Implements docs/design/studio/SLICE1_SPEC.md (rev 1).
   Sections: A infrastructure and tree, B items/forms/history/save, C code items, test and side panel, D search/sheets/origin/states/init. */
(() => {
'use strict';
const D = window.StudioData, IC = window.StudioIcon, ED = window.StudioEditor, SL = window.StudioLint;
const I18N = D.I18N, SUPPORT = D.SUPPORT, KIND_ICON = D.KIND_ICON, OWNER_ICON = D.OWNER_ICON, KINDS = D.KINDS;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const Q = new URLSearchParams(location.search);
const root = document.documentElement;
const now = () => performance.now();
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clone = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));
const hash = (s) => { let h = 5381; s = String(s); for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return h; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SSK = (k) => (window.StudioSS ? k.replace(/^st1:/, window.StudioSS) : k);   // slice 2 uses its own storage prefix so the two mockups never share saved state
const ss = { get(k) { try { return JSON.parse(sessionStorage.getItem(SSK(k))); } catch (_) { return null; } }, set(k, v) { try { sessionStorage.setItem(SSK(k), JSON.stringify(v)); } catch (_) {} }, raw(k, v) { try { sessionStorage.setItem(SSK(k), v); } catch (_) {} }, del(k) { try { sessionStorage.removeItem(SSK(k)); } catch (_) {} } };

/* ------------------------------------------------------------------ state */
const S = {
  lang: Q.get('lang') === 'en' ? 'en' : 'ko', rm: false, lp: false,
  from: ['chat', 'library', 'settings'].includes(Q.get('from')) ? Q.get('from') : 'chat',
  ctx: { char: 'c1', chat: true }, db: null, H: {}, drafts: {}, extra: [],
  open: null, view: { type: 'none' }, sel: null, focusId: null, exp: new Set(['s:modules', 's:presets', 's:plugins']), hideEmpty: false,
  layout: 'wide', phone: 'tree', drawer: false, sideOpen: false, sideOff: false, sideTab: 'problems', treeW: 280,
  save: { state: 'saved', latency: 100, deb: 120, failNext: false, dirty: false, inflight: false, pendSince: 0 },
  layers: [], opener: null, inStudio: true, codeProb: {}, tv: {}, tr: null, tf: null, appliedUntil: 0, remote: {},
  search: { q: '', kinds: new Set(), wide: false, active: 0, hits: [], token: 0, busy: false, opener: null },
  statusKey: '', typeBuf: '', typeAt: 0, rows: [], lastEdit: null, priors: {}, prevLive: {}, peers: {}, leaving: false, peerLog: {}, deleted: [], entryDetail: false, draftFail: false, settingsPage: 'modules'
};
const ST = window.__st1 = { S, ED, ext: {} };   // ext: hooks a later slice registers (slice 2 builder: tgb.js); empty in slice1.html
window.StudioLang = () => S.lang;

function t(k, v) {
  let s = I18N[S.lang][k]; if (s == null) s = I18N.en[k]; if (s == null) return k; if (typeof s !== 'string') return s;
  return v ? s.replace(/\{(\w+)\}/g, (_, n) => (v[n] != null ? v[n] : '')) : s;
}
const nm = (x) => (x && typeof x === 'object' ? x[S.lang] : x == null ? '' : x);
const kindName = (k) => t('kinds')[k];
/* slice 4 (DD-188, DD-194): the shell-level guard for a private-licence character. hidden: its content is not shown anywhere (item names read as the kind name, search and the Test panel find nothing, an item opens the notice);
   locked: hidden or revealed (revealed is read only: nothing can be added, changed, moved, deleted or switched). The hooks answer by owner id; without slice 4 both are false. */
const ownHidden = (oid) => !!(ST.ext.ownerHidden && ST.ext.ownerHidden(oid));
const ownLocked = (oid) => !!(ST.ext.ownerLocked && ST.ext.ownerLocked(oid));
const shownName = (it, o) => (o && it.kind !== 'basic' && ownHidden(o.id) ? kindName(it.kind) : nm(it.name));
const ic =(n, size, cls) => IC(n, size || 20, cls);
const announce = (msg) => { const el = $('#srLive'); el.textContent = ''; setTimeout(() => { el.textContent = msg; }, 20); };

/* ------------------------------------------------------------------ data access */
const O = (id) => S.db.owners[id];
const ownerList = () => S.db.order.map((id) => S.db.owners[id]);
function findItem(id) { for (const o of ownerList()) { const it = o.items.find((i) => i.id === id); if (it) return { o, it }; } return null; }
const isCode = (it) => !!it && (it.kind === 'plugin' || (it.kind === 'scripts' && it.mode === 'lua'));   // scripts are code only in Lua mode (DD-097)
const hasEnabled = (it) => ['lore', 'regex', 'scripts', 'html', 'plugin'].includes(it.kind);       // F-12: only kinds that have an enabled flag
const modeName = (m) => t(m === 'lua' ? 'modeLua' : m === 'v1' ? 'modeV1' : 'modeV2');
const itemsOf = (o, k) => o.items.filter((i) => i.kind === k);
function moduleActive(m) { const sc = m.scope; if (sc === 'all') return true; if (sc === 'chat') return S.ctx.chat; if (sc.startsWith('char:')) return sc === 'char:' + S.ctx.char; return false; }
function moduleBadge(m) { const sc = m.scope; if (sc === 'all') return ['all', t('modOnAll')]; if (sc === 'chat' && S.ctx.chat) return ['chat', t('modOnChat')]; if (sc === 'char:' + S.ctx.char) return ['char', t('modInChar')]; return null; }
const ctxChar = () => O(S.ctx.char);
const activePreset = () => ownerList().find((o) => o.type === 'preset' && o.active);
function contextOwners() { const l = [ctxChar()]; if (S.ctx.chat) l.push(O('chat1')); ownerList().filter((o) => o.type === 'module' && moduleActive(o)).forEach((o) => l.push(o)); l.push(activePreset()); ownerList().filter((o) => o.type === 'plugin').forEach((o) => l.push(o)); return l.filter(Boolean); }
/* DD-096: the combined view lists each kind in its own source-verified engine order; ordinals only where verified.
   toggles: preset, modules, character   (src/lib/SideBars/Toggles.svelte:70-75: customPromptTemplateToggle + getModuleToggles + charToggle)
   regex:   preset, character, modules   (src/ts/process/scripts.ts:264: presetRegex.concat(char.customscript).concat(getModuleRegexScripts))
   lore:    character, chat, modules     (src/ts/process/lorebook.svelte.ts:139: characterLore.concat(chatLore).concat(moduleLorebook))
   scripts: not verified, so listed by owner and not numbered. */
const MERGE = { toggles: { ord: true, src: 'Toggles.svelte:70-75' }, regex: { ord: true, src: 'scripts.ts:264' }, lore: { ord: true, src: 'lorebook.svelte.ts:139' }, scripts: { ord: false, src: null } };
function mergeOrder(kind) {
  const mods = ownerList().filter((x) => x.type === 'module' && moduleActive(x)), p = activePreset(), ch = ctxChar(), chat = S.ctx.chat ? O('chat1') : null;
  const l = kind === 'toggles' ? [p, ...mods, ch] : kind === 'regex' ? [p, ch, ...mods] : kind === 'lore' ? [ch, chat, ...mods] : [ch, ...mods];
  return l.filter((x) => x && !ownHidden(x.id));   /* DD-194: a hidden private character adds no row, no toggle key and no test value to a combined view */
}
function ownerLow(o) { const adv = o && o.items.find((i) => i.kind === 'advanced'); return !!(adv && adv.f && adv.f.lowLevel); }
const ownerIcon = (o) => OWNER_ICON[o.type];

/* problems of non-code items */
function itemProblems(it) {
  const p = []; { const fo = it.kind !== 'basic' && findItem(it.id); if (fo && ownHidden(fo.o.id)) return p; }   /* DD-194: a hidden card reports nothing about its other items */
  if (it.kind === 'basic' && !String(it.f.name || '').trim()) p.push({ sev: 'error', field: 'name', msg: t('errName') });
  if (['lore', 'regex', 'html'].includes(it.kind) && !String(nm(it.name)).trim()) p.push({ sev: 'error', field: 'iname', msg: t('errName') });
  if (it.kind === 'regex' && it.f.find) { try { new RegExp(it.f.find); } catch (e) { p.push({ sev: 'error', field: 'find', msg: t('errRegex', { m: String(e.message).replace(/^Invalid regular expression: /, '') }) }); } }
  if (it.kind === 'lore' && !String(it.f.keys || '').trim() && !it.f.always) p.push({ sev: 'warning', field: 'keys', msg: t('errKeys') });
  if (ST.ext.problems) ST.ext.problems(it).forEach((x) => p.push(x));   // slice 2 (toggle list rows) and slice 3 (CBS checks of long text fields) answer here; each returns [] for items that are not theirs
  return p;
}
const probCount = (it) => (isCode(it) ? (S.codeProb[it.id] || 0) : itemProblems(it).length);
const hasDraft = (id) => !!S.drafts[id];
const draftCount = (o) => o.items.filter((i) => isCode(i) && hasDraft(i.id)).length;

/* ------------------------------------------------------------------ persistence of the simulated store */
function persistPayload() {
  const items = {}; ownerList().forEach((o) => { items[o.id] = o.items; });
  return JSON.stringify({ items, extra: S.extra.map((id) => { const o = O(id); return o ? { id: o.id, type: o.type, name: o.name, scope: o.scope, active: o.active } : null; }).filter(Boolean) });
}
function loadData(keepArg) {
  const keep = keepArg !== undefined ? keepArg : (Q.get('keep') === '1' || !Q.get('state'));
  if (!keep) { ss.del('st1:db'); ss.del('st1:drafts'); ss.del('st1:ui'); ss.del('st1:priors'); ss.del('st1:prevlive'); }
  S.db = D.build(S.lang); S.H = {}; S.extra = []; S.codeProb = {};
  let saved = null; if (keep) { try { saved = JSON.parse(sessionStorage.getItem(SSK('st1:db'))); } catch (_) {} }
  if (saved && saved.items) {
    (saved.extra || []).forEach((x) => { const o = { id: x.id, type: x.type, name: x.name, scope: x.scope, active: x.active, items: [] }; S.db.owners[o.id] = o; S.db.order.push(o.id); S.extra.push(o.id); });
    Object.keys(saved.items).forEach((id) => { if (S.db.owners[id]) S.db.owners[id].items = saved.items[id]; });
  }
  S.drafts = keep ? (ss.get('st1:drafts') || {}) : {};
  S.priors = keep ? (ss.get('st1:priors') || {}) : {}; S.prevLive = keep ? (ss.get('st1:prevlive') || {}) : {}; S.deleted = []; S.peers = {}; S.peerLog = {};
  const ui = keep ? ss.get('st1:ui') : null;
  if (ui) { if (Array.isArray(ui.exp)) S.exp = new Set(ui.exp); S.hideEmpty = !!ui.hideEmpty; if (ui.treeW) { S.treeW = ui.treeW; S.treeSet = true; } S.sideOff = !!ui.sideOff; }
}
const treeNow = () => (S.treeSet ? S.treeW : (Math.round($('#treeCol').getBoundingClientRect().width) || S.treeW));   /* the width the column has now: the user's, or the pack's default */
function saveUi() { ss.set('st1:ui', { exp: [...S.exp], hideEmpty: S.hideEmpty, treeW: S.treeSet ? S.treeW : undefined, sideOff: S.sideOff }); }
const persistDraftsSoon = (() => { let tm = 0; return () => { clearTimeout(tm); tm = setTimeout(() => { if (S.draftFail) { if (!S.draftWarn) { S.draftWarn = true; refreshDraftWarn(); } return; } const was = S.draftWarn; S.draftWarn = false; ss.set('st1:drafts', S.drafts); ss.set('st1:priors', S.priors); ss.set('st1:prevlive', S.prevLive); if (was) refreshDraftWarn(); }, 150); }; })();
function refreshDraftWarn() { const f = S.open && findItem(S.open); if (f && isCode(f.it) && typeof renderCodeBanners === 'function') renderCodeBanners(f.it, f.o); }

/* ------------------------------------------------------------------ static text */
function applyStatic() {
  document.documentElement.lang = S.lang;
  $$('[data-label]').forEach((el) => { const v = t(el.dataset.label); if (el.dataset.label && v !== el.dataset.label) { el.setAttribute('aria-label', v); el.title = v; if (el.classList.contains('txt') && !el.dataset.ic) el.title = v; } });
  $$('[data-ph]').forEach((el) => { el.placeholder = t(el.dataset.ph); el.setAttribute('aria-label', t(el.dataset.ph)); });
  $$('[data-t]').forEach((el) => { el.textContent = t(el.dataset.t); });
  $$('[data-ic]').forEach((el) => { if (!el.dataset.icDone || el.dataset.icLang !== S.lang) { const svg = ic(el.dataset.ic, Number(el.dataset.size) || 20); const first = el.firstElementChild && el.firstElementChild.classList.contains('ic') ? el.firstElementChild : null; if (first) first.outerHTML = svg; else el.insertAdjacentHTML('afterbegin', svg); el.dataset.icDone = '1'; el.dataset.icLang = S.lang; } });
  $('#skip').textContent = t('skip'); $('#treeTitle').textContent = t('treeTitle'); $('#demoSum').innerHTML = ic('sliders', 16) + ' ' + esc(t('demoSum'));
  $('#searchTitle').textContent = t('searchTitle'); $('#searchInput').placeholder = t('searchPh'); $('#searchInput').setAttribute('aria-label', t('searchTitle')); $('#searchWideLbl').textContent = t('searchWide'); $('#searchWideHint').textContent = t('searchWideHint');
  $('#gotoLbl').textContent = t('gotoLbl'); $('#indentLbl').textContent = t('indentLbl'); $('#editor-hint').textContent = t('codeEdHint'); $('#lowLbl').textContent = t('lowLbl'); $('#tMsgLbl').textContent = t('testMsg'); $('#tMsg').placeholder = t('testMsgPh');
  $('#diag-title').textContent = t('tabProblems'); $('#sim-title').textContent = t('testHdr'); $('#engHint').textContent = t('engHint'); $('#editor').setAttribute('aria-label', t('codeEditor')); $('#editor-panel').setAttribute('aria-label', t('codeEditor'));
  $('#sideTabs').setAttribute('aria-label', t('tabProblems') + ' · ' + t('tabTest') + ' · ' + t('tabHistory')); $('#side').setAttribute('aria-label', t('tabProblems') + ' · ' + t('tabTest') + ' · ' + t('tabHistory'));
  $('#treeCol').setAttribute('aria-label', t('treeTitle')); $('#main').setAttribute('aria-label', t('studioTitle')); $('#crumbFull').setAttribute('aria-label', t('crumbLoc'));
  $('#searchList').setAttribute('aria-label', t('searchTitle')); $('#var-grid').setAttribute('aria-label', t('testHdr'));
  document.title = t('studioTitle') + ' · ' + (S.lang === 'ko' ? '1단계 목업' : 'slice 1 mockup');
  $('#splitter').setAttribute('aria-label', t('treeTitle'));
  $('#btn-tabmode').dataset.l = '1';
}

/* ------------------------------------------------------------------ layout */
function layoutOf() { const w = innerWidth; return w >= 1024 ? 'wide' : w >= 600 ? 'mid' : 'phone'; }
function applyLayout() {
  const l = layoutOf(), was = S.layout; S.layout = l;
  const st = $('#studio'); st.dataset.layout = l; st.dataset.phone = S.phone;
  if (was !== l) { S.drawer = false; if (S.sideOpen && l === 'wide') { closeSide(true); } }
  $('#treeCol').classList.toggle('open', S.drawer && l === 'mid');
  $('#drawerBackdrop').classList.toggle('open', S.drawer && l === 'mid');
  $('#drawerBtn').setAttribute('aria-expanded', String(S.drawer));
  $('#body').classList.toggle('side-off', l === 'wide' && S.sideOff);
  $('#sideToggle').setAttribute('aria-expanded', String(!S.sideOff));
  if (S.treeSet) document.documentElement.style.setProperty('--studio-tree-user-width', S.treeW + 'px');   /* DD-266: only a width the user chose; until then the pack's --studio-tree-width applies */
  $('#splitter').setAttribute('aria-valuenow', String(treeNow()));
  $('#treeCol').toggleAttribute('inert', l === 'mid' && !S.drawer);
  if (l === 'mid' || l === 'phone') { $('#side').toggleAttribute('inert', !S.sideOpen); $('#side').setAttribute('aria-hidden', String(!S.sideOpen)); } else { $('#side').removeAttribute('inert'); $('#side').removeAttribute('aria-hidden'); }
  renderHeader(); if (S.view.type === 'item') renderItemHead();
  ED.resize();
}

/* ------------------------------------------------------------------ layers (Back stack, DD-040) */
function pushLayer(l) { S.layers.push(l); syncInert(); }
function dropLayer(l) { const i = S.layers.indexOf(l); if (i >= 0) S.layers.splice(i, 1); syncInert(); }
function closeTopLayer() { const l = S.layers[S.layers.length - 1]; if (!l) return false; l.close(); return true; }
function syncInert() {
  const modal = S.layers.some((l) => l.kind === 'search' || l.kind === 'sheet' || l.modal);
  const sideSheet = S.layers.some((l) => l.kind === 'side'); const drawer = S.layers.some((l) => l.kind === 'drawer');
  const set = (sel, v) => $$(sel).forEach((e) => e.toggleAttribute('inert', v));
  set('#hdr', modal || sideSheet);
  $('#body').toggleAttribute('inert', modal);
  if (!modal) { $('#main').toggleAttribute('inert', sideSheet || drawer); if (S.layout === 'mid') $('#treeCol').toggleAttribute('inert', !S.drawer || sideSheet); else $('#treeCol').toggleAttribute('inert', sideSheet); }
  else { $('#main').removeAttribute('inert'); $('#treeCol').removeAttribute('inert'); if (S.layout === 'mid' && !S.drawer) $('#treeCol').setAttribute('inert', ''); }
}

/* ------------------------------------------------------------------ tree model */
const nid = (id) => 'tr-' + id.replace(/[^a-zA-Z0-9]/g, '-');
function ownerRow(o, lv, extra) {
  const items = o.items.filter((i) => !i.noTree).length, dc = draftCount(o),   /* slice 4: an item flagged noTree (the chat's author note and memory text) is data, not a tree entry */ probN = o.items.reduce((n, i) => n + probCount(i), 0);
  const badge = o.type === 'module' ? moduleBadge(o) : null;
  return Object.assign({ id: 'o:' + o.id, lv, type: 'owner', ownerId: o.id, label: nm(o.name), icon: ownerIcon(o), kind: null, tag: badge ? { c: badge[0], t: badge[1] } : null, draftN: dc, probN, peerN: o.items.filter((i) => S.peers[i.id]).length, cnt: items, exp: S.exp.has('o:' + o.id), ownerType: o.type }, extra || {});
}
function ownerChildren(o, lv, rows) {
  if (!S.exp.has('o:' + o.id)) return;
  const kinds = SUPPORT[o.type].filter((k) => !(S.hideEmpty && itemsOf(o, k).length === 0));
  kinds.forEach((k) => {
    const its = itemsOf(o, k), kid = 'k:' + o.id + ':' + k;
    const dc = its.filter((i) => isCode(i) && hasDraft(i.id)).length;
    rows.push({ id: kid, lv, type: 'kind', ownerId: o.id, kind: k, label: kindName(k), icon: KIND_ICON[k], cnt: ST.ext.kindCount ? ST.ext.kindCount(o, k, its) : its.length, dim: its.length === 0, exp: its.length ? S.exp.has(kid) : null, draftDot: dc > 0, probN: its.reduce((n, i) => n + probCount(i), 0), peerN: its.filter((i) => S.peers[i.id]).length, addable: true });
    if (its.length && S.exp.has(kid)) its.forEach((it) => rows.push(itemRow(it, o, lv + 1)));
  });
}
function itemRow(it, o, lv, extra) {
  return Object.assign({ id: 'i:' + it.id, lv, type: 'item', ownerId: o.id, kind: it.kind, itemId: it.id, label: shownName(it, o), icon: KIND_ICON[it.kind], draft: isCode(it) && hasDraft(it.id), prob: probCount(it), off: !it.on, peer: !!S.peers[it.id], modeTag: it.kind === 'scripts' ? modeName(it.mode) : '' }, extra || {});
}
function mergedKinds() { return ['toggles', 'regex', 'lore', 'scripts']; }
function keysPreview(it) { if (ST.ext.keysPreview) return ST.ext.keysPreview(it); const ks = String(it.f.defs || '').split('\n').map((l) => l.split('=')[0].trim()).filter(Boolean); return ks.length ? ks.slice(0, 3).join(' · ') + (ks.length > 3 ? ' …' : '') : ''; }
function buildRows() {
  const rows = [];
  // merged view
  rows.push({ id: 'merged', lv: 1, type: 'merged', label: t('merged'), icon: 'layers', exp: S.exp.has('merged') });
  if (S.exp.has('merged')) mergedKinds().forEach((k) => {
    const list = []; mergeOrder(k).forEach((o) => itemsOf(o, k).forEach((it) => list.push({ it, o })));
    const kid = 'merged:' + k, mg = MERGE[k];
    rows.push({ id: kid, lv: 2, type: 'mkind', kind: k, label: kindName(k), icon: KIND_ICON[k], cnt: list.length, exp: list.length ? S.exp.has(kid) : null, note: mg.ord ? t('mergedOrdered') : t('mergedUnverified') });
    // F-04: the owner leads (bold line); the second line says what it is (toggle keys, script mode, item name)
    if (S.exp.has(kid)) list.forEach((x, i) => rows.push(itemRow(x.it, x.o, 3, { id: 'mi:' + x.it.id, ord: mg.ord ? i + 1 : 0, label: nm(x.o.name), icon: ownerIcon(x.o), ownerTag: { t: nm(x.o.name) }, subText: k === 'toggles' ? keysPreview(x.it) : k === 'scripts' ? modeName(x.it.mode) : nm(x.it.name), subIcon: KIND_ICON[k], modeTag: '' })));
  });
  const ch = ctxChar(); rows.push(ownerRow(ch, 1)); ownerChildren(ch, 2, rows);
  if (S.ctx.chat) { const c = O('chat1'); rows.push(ownerRow(c, 1)); ownerChildren(c, 2, rows); }
  // modules
  const mods = ownerList().filter((o) => o.type === 'module');
  rows.push({ id: 's:modules', lv: 1, type: 'section', label: t('sectionModules'), icon: 'puzzle', exp: S.exp.has('s:modules'), addModule: true });
  if (S.exp.has('s:modules')) {
    mods.filter(moduleActive).forEach((m) => { rows.push(ownerRow(m, 2)); ownerChildren(m, 3, rows); });
    const others = mods.filter((m) => !moduleActive(m));
    if (others.length) { rows.push({ id: 'g:mods', lv: 2, type: 'group', label: t('otherModules', { n: others.length }), icon: 'folder', exp: S.exp.has('g:mods') }); if (S.exp.has('g:mods')) others.forEach((m) => { rows.push(ownerRow(m, 3, { dimOwner: true })); ownerChildren(m, 4, rows); }); }
  }
  // presets
  const pres = ownerList().filter((o) => o.type === 'preset');
  rows.push({ id: 's:presets', lv: 1, type: 'section', label: t('sectionPresets'), icon: 'file-text', exp: S.exp.has('s:presets') });
  if (S.exp.has('s:presets')) {
    pres.filter((p) => p.active).forEach((p) => { rows.push(ownerRow(p, 2)); ownerChildren(p, 3, rows); });
    const others = pres.filter((p) => !p.active);
    if (others.length) { rows.push({ id: 'g:presets', lv: 2, type: 'group', label: t('otherPresets', { n: others.length }), icon: 'folder', exp: S.exp.has('g:presets') }); if (S.exp.has('g:presets')) others.forEach((p) => { rows.push(ownerRow(p, 3, { dimOwner: true })); ownerChildren(p, 4, rows); }); }
  }
  // plugins
  const plg = ownerList().filter((o) => o.type === 'plugin');
  rows.push({ id: 's:plugins', lv: 1, type: 'section', label: t('sectionPlugins'), icon: 'plug', exp: S.exp.has('s:plugins') });
  if (S.exp.has('s:plugins')) plg.forEach((p) => { rows.push(ownerRow(p, 2)); ownerChildren(p, 3, rows); });
  return rows;
}

function rowHtml(r) {
  const sel = S.sel === r.id, exp = r.exp;
  const chev = exp == null ? '<span class="chev" data-part="studio-tree-row-chevron"></span>' : '<span class="chev" data-part="studio-tree-row-chevron">' + ic('chevron-right', 14) + '</span>';
  let marks = '';
  if (r.type === 'owner') { if (r.draftN) marks += '<span class="mk draft" data-part="studio-tree-row-mark" data-mark="draft" title="' + esc(t('draftsN', { n: r.draftN })) + '">' + esc(t('draftsN', { n: r.draftN })) + '</span>'; }
  if (r.type === 'kind' && r.draftDot) marks += '<span class="mk draft" data-part="studio-tree-row-mark" data-mark="draft" aria-label="' + esc(t('draftMark')) + '" title="' + esc(t('draftMark')) + '">•</span>';
  if ((r.type === 'owner' || r.type === 'kind') && r.probN && exp !== true) marks += '<span class="mk prob" data-part="studio-tree-row-mark" data-mark="prob" role="img" aria-label="' + esc(t('problemsN', { n: r.probN })) + '" title="' + esc(t('problemsN', { n: r.probN })) + '">' + ic('triangle-alert', 14) + '<span>' + r.probN + '</span></span>';   // F-13: roll-up while collapsed
  if ((r.type === 'owner' || r.type === 'kind') && r.peerN && exp !== true) marks += '<span class="mk peer" data-part="studio-tree-row-mark" data-mark="peer" role="img" aria-label="' + esc(t('peerRollup', { n: r.peerN })) + '" title="' + esc(t('peerRollup', { n: r.peerN })) + '">' + ic('git-compare', 14) + '<span>' + r.peerN + '</span></span>';
  if (r.type === 'item') {
    if (r.peer) marks += '<span class="mk peer" data-part="studio-tree-row-mark" data-mark="peer" role="img" aria-label="' + esc(t('peerMark')) + '" title="' + esc(t('peerMark')) + '">' + ic('git-compare', 14) + '</span>';
    if (r.draft) marks += '<span class="mk draft" data-part="studio-tree-row-mark" data-mark="draft" role="img" aria-label="' + esc(t('draftMark')) + '" title="' + esc(t('draftMark')) + '">•</span>';
    if (r.prob) marks += '<span class="mk prob" data-part="studio-tree-row-mark" data-mark="prob" role="img" aria-label="' + esc(t('problemsN', { n: r.prob })) + '" title="' + esc(t('problemsN', { n: r.prob })) + '">' + ic('triangle-alert', 14) + '<span>' + r.prob + '</span></span>';
    if (r.off) marks += '<span class="mk off" data-part="studio-tree-row-mark" data-mark="off" role="img" aria-label="' + esc(t('disabledMark')) + '" title="' + esc(t('disabledMark')) + '">' + ic('circle-off', 14) + '</span>';
  }
  let tag = '';
  if (r.ord) tag += '<span class="tag ord" data-part="studio-tree-row-tag" data-tag="ord" aria-label="' + esc(t('mergedOrdered')) + ' ' + r.ord + '">' + r.ord + '</span>';
  if (r.modeTag) tag += '<span class="tag mode" data-part="studio-tree-row-tag" data-tag="mode">' + esc(r.modeTag) + '</span>';
  if (r.tag) tag += '<span class="tag ' + r.tag.c + '" data-part="studio-tree-row-tag" data-tag="' + r.tag.c + '">' + esc(r.tag.t) + '</span>';
  const cnt = r.cnt != null && (r.type !== 'owner' || exp !== true) ? '<span class="cnt" data-part="studio-tree-row-count">' + r.cnt + '</span>' : '';
  let add = '';
  if (r.type === 'kind' && !ownLocked(r.ownerId)) add = '<button type="button" class="btn add" data-part="studio-tree-row-add" tabindex="-1" data-add="' + esc(r.ownerId + ':' + r.kind) + '" aria-label="' + esc(t('addTo', { k: kindName(r.kind) })) + '" title="' + esc(t('addTo', { k: kindName(r.kind) })) + '">' + ic('plus', 16) + '</button>';
  if (r.type === 'section' && r.addModule) add = '<button type="button" class="btn add" data-part="studio-tree-row-add" tabindex="-1" data-addmod="1" aria-label="' + esc(t('newModule')) + '" title="' + esc(t('newModule')) + '">' + ic('plus', 16) + '</button>';
  const cls = ['tr', r.type === 'owner' ? 'owner' : r.type, r.dim || r.dimOwner ? 'dim' : ''].join(' ').trim();
  const aria = (r.note ? ' aria-description="' + esc(r.note) + '" title="' + esc(r.note) + '"' : '') + (exp != null ? ' aria-expanded="' + exp + '"' : '');
  return '<div class="' + cls + '" data-part="studio-tree-row" data-kind="' + r.type + '"' + (sel ? ' data-selected' : '') + (exp != null ? ' data-open="' + exp + '"' : '') + (r.dim || r.dimOwner ? ' data-dim' : '') + ' role="treeitem" id="' + nid(r.id) + '" data-id="' + esc(r.id) + '" aria-level="' + r.lv + '" aria-selected="' + sel + '"' + aria + ' tabindex="' + (S.focusId === r.id ? 0 : -1) + '"' + (r.ownerTag ? ' data-owner-name="' + esc(r.ownerTag.t) + '"' : '') + ' style="--lv:' + r.lv + '">' +
    chev + '<span class="kic" data-part="studio-tree-row-icon">' + ic(r.icon, 16) + '</span><span class="lbl" data-part="studio-tree-row-label">' + (r.ownerTag ? '<span class="l1">' + esc(r.label) + '</span><small class="otag">' + ic(r.subIcon || r.icon, 11) + esc(r.subText || '') + '</small>' : esc(r.label)) + '</span>' + tag + marks + cnt + add + '</div>';
}
function renderTree() {
  S.rows = buildRows();
  if (!S.rows.some((r) => r.id === S.focusId)) S.focusId = (S.rows.find((r) => r.id === S.sel) || S.rows[0]).id;
  const tree = $('#tree'), active = document.activeElement, keep = active && tree.contains(active) ? active.dataset.id : null;
  const top = tree.scrollTop, html = S.rows.map(rowHtml), ids = S.rows.map((r) => r.id);
  const same = S.rowIds && S.rowIds.length === ids.length && S.rowIds.every((id, i) => id === ids[i]);
  if (same) { for (let i = 0; i < html.length; i++) if (html[i] !== S.rowHtml[i]) { const el = tree.children[i]; if (el) el.outerHTML = html[i]; } S.rowPatched = (S.rowPatched || 0) + 1; }
  else tree.innerHTML = html.join('');
  S.rowIds = ids; S.rowHtml = html; tree.scrollTop = top;
  if (keep) { const e = rowEl(keep); if (e && document.activeElement !== e) e.focus({ preventScroll: true }); }
  renderHeader();
}
const rowEl = (id) => $('#' + nid(id));
function focusRow(id, scroll) { S.focusId = id; $$('#tree .tr[tabindex="0"]').forEach((e) => { e.tabIndex = -1; }); const e = rowEl(id); if (e) { e.tabIndex = 0; e.focus({ preventScroll: !scroll }); if (scroll) e.scrollIntoView({ block: 'nearest' }); } }
function revealOwner(o) {
  if (o.type === 'module' && !moduleActive(o)) { S.exp.add('s:modules'); S.exp.add('g:mods'); }
  if (o.type === 'module') S.exp.add('s:modules');
  if (o.type === 'preset') { S.exp.add('s:presets'); if (!o.active) S.exp.add('g:presets'); }
  if (o.type === 'plugin') S.exp.add('s:plugins');
  S.exp.add('o:' + o.id);
}
function revealItem(it, o) { revealOwner(o); S.exp.add('k:' + o.id + ':' + it.kind); }
function toggleExp(id, force) { const on = force == null ? !S.exp.has(id) : force; if (on) S.exp.add(id); else S.exp.delete(id); saveUi(); renderTree(); }

/* tree interaction */
function rowById(id) { return S.rows.find((r) => r.id === id); }
function activateRow(r, viaKey) {
  clearNotice();
  S.focusId = r.id;
  if (r.type === 'item') { openItem(r.itemId, { fromTree: true, sel: r.id, focus: true }); return; }
  const expandable = r.exp != null;
  if (r.type === 'owner' || r.type === 'kind') {
    if (S.layout !== 'phone') { S.sel = r.id; S.view = { type: r.type, ownerId: r.ownerId, kind: r.kind }; S.open = null; if (expandable) { S.exp[S.exp.has(r.id) ? 'delete' : 'add'](r.id); } else if (r.type === 'kind') { /* empty kind: nothing to expand */ } saveUi(); renderAll(); focusRow(r.id); return; }
    if (expandable) toggleExp(r.id); else if (r.type === 'kind' && r.cnt === 0) addItem(r.ownerId, r.kind);
    focusRow(r.id); return;
  }
  if (r.type === 'mkind' && r.kind === 'toggles' && ST.ext.openMerged) { ST.ext.openMerged(r); return; }
  if (expandable) toggleExp(r.id); focusRow(r.id);
}
$('#tree').addEventListener('click', (e) => {
  const add = e.target.closest('[data-add]'); if (add) { e.stopPropagation(); const [oid, k] = add.dataset.add.split(':'); addItem(oid, k); return; }
  if (e.target.closest('[data-addmod]')) { e.stopPropagation(); openNewModule(e.target.closest('[data-addmod]')); return; }
  const row = e.target.closest('.tr'); if (!row) return; const r = rowById(row.dataset.id); if (r) activateRow(r);
});
$('#tree').addEventListener('focusin', (e) => { const row = e.target.closest('.tr'); if (row && row.dataset.id !== S.focusId) { $$('#tree .tr[tabindex="0"]').forEach((x) => { x.tabIndex = -1; }); S.focusId = row.dataset.id; row.tabIndex = 0; } });
$('#tree').addEventListener('keydown', (e) => {
  const row = e.target.closest('.tr'); if (!row || e.target !== row) return;
  const rows = S.rows, i = rows.findIndex((r) => r.id === row.dataset.id), r = rows[i]; if (!r) return;
  const go = (j) => { j = Math.max(0, Math.min(rows.length - 1, j)); focusRow(rows[j].id, true); };
  switch (e.key) {
    case 'ArrowDown': e.preventDefault(); go(i + 1); break;
    case 'ArrowUp': e.preventDefault(); go(i - 1); break;
    case 'Home': e.preventDefault(); go(0); break;
    case 'End': e.preventDefault(); go(rows.length - 1); break;
    case 'ArrowRight': e.preventDefault(); if (r.exp === false) { toggleExp(r.id, true); focusRow(r.id); } else if (r.exp === true && rows[i + 1] && rows[i + 1].lv > r.lv) go(i + 1); break;
    case 'ArrowLeft': e.preventDefault(); if (r.exp === true) { toggleExp(r.id, false); focusRow(r.id); } else { for (let j = i - 1; j >= 0; j--) if (rows[j].lv < r.lv) { go(j); break; } } break;
    case 'Enter': case ' ': e.preventDefault(); activateRow(r, true); break;
    case '+': case 'Insert': if (r.type === 'kind') { e.preventDefault(); addItem(r.ownerId, r.kind); } break;
    case 'ContextMenu': e.preventDefault(); openRowMenu(r, row); break;
    case 'F10': if (e.shiftKey) { e.preventDefault(); openRowMenu(r, row); } break;
    default:
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const n = now(); S.typeBuf = (n - S.typeAt > 600 ? '' : S.typeBuf) + e.key.toLowerCase(); S.typeAt = n;
        const start = S.typeBuf.length > 1 ? i : i + 1; const order = rows.slice(start).concat(rows.slice(0, start));
        const hit = order.find((x) => x.label.toLowerCase().startsWith(S.typeBuf)); if (hit) { e.preventDefault(); focusRow(hit.id, true); }
      }
  }
});

/* ------------------------------------------------------------------ header, breadcrumb, status */
function currentOwner() { if (S.open) { const f = findItem(S.open); if (f) return f.o; } if (S.view.ownerId) return O(S.view.ownerId); return null; }
function renderHeader() {
  const f = S.open ? findItem(S.open) : null, o = f ? f.o : (S.view.ownerId ? O(S.view.ownerId) : null);
  const parts = [];
  if (o) { parts.push({ label: nm(o.name), act: 'owner', icon: ownerIcon(o) }); }
  if (S.view.type === 'kind' || f) parts.push({ label: kindName(f ? f.it.kind : S.view.kind), act: 'kind', icon: KIND_ICON[f ? f.it.kind : S.view.kind] });
  if (f && shownName(f.it, f.o) !== kindName(f.it.kind)) parts.push({ label: shownName(f.it, f.o) || kindName(f.it.kind), act: 'item', icon: null, cur: true });
  if (S.view.type === 'tgmerged') parts.push({ label: t('merged') + ' · ' + kindName('toggles'), act: 'root', icon: 'layers' });
  if (!parts.length) parts.push({ label: t('studioTitle'), act: 'root', cur: true });
  else parts[parts.length - 1].cur = true;
  $('#crumbFull').innerHTML = parts.map((p, i) => (i ? '<span class="sepc" data-part="studio-header-crumb-sep">' + ic('chevron-right', 14) + '</span>' : '') + '<button type="button" class="btn cb" data-part="studio-header-crumb" data-act="' + p.act + '"' + (p.cur ? ' aria-current="page"' : '') + '>' + esc(p.label) + '</button>').join('');
  const title = S.view.type === 'tgmerged' ? t('merged') + ' · ' + kindName('toggles') : f ? (shownName(f.it, f.o) || kindName(f.it.kind)) : S.view.type === 'kind' ? kindName(S.view.kind) : o ? nm(o.name) : t('studioTitle');
  const sub = f ? (shownName(f.it, f.o) === kindName(f.it.kind) ? nm(o.name) : nm(o.name) + ' › ' + kindName(f.it.kind)) : S.view.type === 'kind' ? nm(o.name) : o ? '' : (S.ctx.chat ? nm(ctxChar().name) + ' · ' + nm(O('chat1').name) : nm(ctxChar().name));
  const inner = '<strong>' + esc(title) + '</strong>' + (sub ? '<small>' + esc(sub) + '</small>' : '');
  // F-16: on a phone detail the title is also the way to the owner list (the tree stays one tap away)
  $('#crumbShort').innerHTML = S.layout === 'phone' && S.phone === 'detail' ? '<button type="button" class="crumb-btn" data-part="studio-header-title-button" id="crumbList" aria-label="' + esc(t('listBtn') + ': ' + title) + '" title="' + esc(t('listBtn')) + '"><span class="ct">' + inner + '</span>' + ic('chevron-down', 16) + '</button>' : inner;
  renderStatus(); renderUndoRedo();
}
function toTree() {
  if (S.layout !== 'phone') return; const id = S.sel; S.phone = 'tree'; S.entryDetail = false; S.open = null; S.view = { type: 'none' };
  applyLayoutAttrs(); renderAll(); focusRow(rowById(id) ? id : S.rows[0].id, true);
}
document.addEventListener('click', (e) => { if (e.target.closest('#crumbList')) toTree(); });
$('#crumbFull').addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]'); if (!b) return; const f = S.open ? findItem(S.open) : null; const o = f ? f.o : currentOwner();
  if (b.dataset.act === 'owner' && o) { revealOwner(o); S.sel = 'o:' + o.id; S.view = { type: 'owner', ownerId: o.id }; S.open = null; renderAll(); focusRow('o:' + o.id, true); }
  else if (b.dataset.act === 'kind') { const k = f ? f.it.kind : S.view.kind; S.exp.add('o:' + o.id); S.sel = 'k:' + o.id + ':' + k; S.view = { type: 'kind', ownerId: o.id, kind: k }; S.open = null; renderAll(); focusRow('k:' + o.id + ':' + k, true); }
  else if (b.dataset.act === 'item') $('#itemHead').focus();
});

/* status chip: failed > conflict > draft > saving > applied > saved. One announcement per state change. */
function statusModel() {
  const sv = S.save, f = S.open ? findItem(S.open) : null, pn = Object.keys(S.peers).length;
  if (sv.state === 'failed') return { key: 'failed', icon: 'cloud-off', text: t('saveFailed'), retry: true };
  if (f && isCode(f.it) && hasDraft(f.it.id) && S.drafts[f.it.id].baseRev !== f.it.code.liveRev) return { key: 'conflict', icon: 'git-compare', text: t('conflictStatus') };
  if (pn) return { key: 'conflict', icon: 'git-compare', text: pn > 1 ? t('peerCount', { n: pn }) : t('conflictStatus') };   // DD-102: several items can be changed elsewhere at once
  if (f && isCode(f.it) && hasDraft(f.it.id)) return { key: 'draft', icon: 'file-pen', text: t('draftStatus') };
  if (sv.state === 'saving') return { key: 'saving', icon: 'loader', text: t('saving'), spin: true };
  if (S.appliedUntil > Date.now() && f && isCode(f.it)) return { key: 'applied', icon: 'check', text: t('appliedStatus') };
  return { key: 'saved', icon: 'check', text: t('saved') };
}
function renderStatus() {
  const m = statusModel(); const k = m.key + '|' + m.text;
  const el = $('#saveStatus'); el.dataset.state = m.key;
  if (k !== el.dataset.k) { el.dataset.k = k; el.innerHTML = '<span class="st-ic fade" data-part="studio-save-chip-icon">' + ic(m.icon, 14, m.spin ? 'spin' : '') + '</span><span class="st-tx fade" data-part="studio-save-chip-text">' + esc(m.text) + '</span>'; }
  el.toggleAttribute('data-part-critical', m.key === 'failed' || m.key === 'conflict'); el.setAttribute('role', 'img'); el.setAttribute('aria-label', m.key === 'failed' ? t('saveFailedRetry') : m.text); el.title = m.text;
  $('#retryBtn').hidden = !m.retry; $('#retryBtn').toggleAttribute('data-part-critical', !!m.retry); $('#retryBtn').setAttribute('aria-label', t('retry')); $('#retryBtn').title = t('retry');
  if (k !== S.statusKey) { S.statusKey = k; $('#saveLive').textContent = m.key === 'failed' ? t('saveFailedRetry') : m.text; }
}
function renderBar2() {}

/* ================================================================== B. items, forms, owner history, saving */
S.seq = 0;
const DEFAULTS = { basic: () => ({ name: '', description: '', first: '' }), lore: () => ({ keys: '', content: '', always: false }), regex: () => ({ find: '', replace: '', stage: 'output' }), toggles: () => ({ defs: '' }) };
const FORMS = {
  basic: [['name', 'text', 'fName'], ['description', 'area', 'fDesc', { cbs: 1 }], ['first', 'area', 'fFirst', { cbs: 1 }]],
  display: [['body', 'area', 'fBody', { cbs: 1 }]],
  lore: [['iname', 'text', 'fName'], ['keys', 'text', 'fKeys'], ['content', 'area', 'fContent', { cbs: 1 }], ['always', 'sw', 'fAlways']],
  regex: [['iname', 'text', 'fName'], ['find', 'text', 'fFind', { mono: 1 }], ['replace', 'area', 'fReplace', { mono: 1, small: 1 }], ['stage', 'select', 'fStage']],
  toggles: [['defs', 'area', 'fToggleDefs', { mono: 1, help: 'fToggleHelp' }]],
  scripts: [['rules', 'area', 'fRules', { mono: 1 }]],
  html: [['iname', 'text', 'fName'], ['body', 'area', 'fBody', { mono: 1 }]],
  advanced: [['body', 'area', 'fBody', { cbs: 1 }], ['lowLevel', 'sw', 'fLow', { help: 'fLowHelp', charOnly: 1 }]]
};
const FIELD_LABEL = (it, f) => { const fd = (FORMS[it.kind] || []).find((x) => x[0] === f); return fd ? t(fd[2]) : f; };

function stepLabel(key, it, extra) { return t(key, Object.assign({ kind: kindName(it.kind), name: nm(it.name) || kindName(it.kind) }, extra || {})); }

/* ---- owner history: one per owner for this Studio visit (DD-095). Snapshot model: covers live fields, add, remove, reorder, enable/disable and applied code. */
const snapOf = (o) => JSON.stringify(o.items);
function ensureH(oid) {
  if (!S.H[oid]) S.H[oid] = { steps: [{ label: t('historyOpened'), snap: snapOf(O(oid)), at: Date.now(), base: true }], idx: 0, key: null, keyAt: 0 };
  return S.H[oid];
}
function pushStep(oid, label, opts) {
  opts = opts || {}; const h = ensureH(oid), s = snapOf(O(oid));
  const co = opts.key && h.key === opts.key && now() - h.keyAt < 1000 && h.idx === h.steps.length - 1 && h.idx > 0;
  const step = { label, snap: s, at: Date.now(), ext: opts.ext };
  if (co) { step.ext = h.steps[h.idx].ext || opts.ext; h.steps[h.idx] = step; } else { h.steps.length = h.idx + 1; h.steps.push(step); h.idx++; }
  h.key = opts.key || null; h.keyAt = now();
  S.lastEdit = { oid, label, at: Date.now() };
  touchSave(); renderUndoRedo(); renderHistory();
}
function edit(oid, label, fn, opts) { if (ownLocked(oid)) { announce(t('fPrivate')); return; } ensureH(oid); fn(); pushStep(oid, label, opts); }   /* DD-194: the backstop; the entry points below refuse earlier */
const refuseLocked = (oid) => { if (!ownLocked(oid)) return false; showNotice(t('fPrivate')); return true; };
/* DD-116: one history step that spans several owners. Each owner gets its own step carrying the same cross id; undo/redo of any of them undoes/redoes all of them together, or none of them (all-or-nothing) when one owner has changed since */
let crossBusy = false;
function crossEdit(label, oids, fn) { const id = 'x' + (++S.seq); oids.forEach(ensureH); fn(); oids.forEach((oid) => pushStep(oid, label, { ext: { cross: { id, owners: oids.slice() } } })); }
const crossAt = (o, id, off) => { const h = S.H[o]; const st = h && h.steps[h.idx + off]; return !!(st && st.ext && st.ext.cross && st.ext.cross.id === id) && (off === 0 ? h.idx > 0 : true); };
/* snapshots never silently undo a change made elsewhere (DD-102): restore and History reverts keep the whole item as it is now unless the user includes it; undo/redo of ordinary steps keep only the field that changed elsewhere */
function applySnap(oid, snap, include, fieldLevel) {
  const items = JSON.parse(snap), keep = S.peerLog[oid];
  if (keep) keep.forEach((fld, id) => { if (include && include.has(id)) return; const cur = O(oid).items.find((x) => x.id === id); if (!cur) return; const k = items.findIndex((x) => x.id === id); if (k < 0) items.push(clone(cur)); else if (fieldLevel && items[k].f) items[k].f[fld] = cur.f[fld]; else items[k] = clone(cur); });
  O(oid).items = items;
}
function applyExt(ext, which) {
  if (!ext) return; const w = which === 'before' ? 0 : 1;
  if (ext.drafts) { Object.keys(ext.drafts).forEach((id) => { const v = clone(ext.drafts[id][w]); if (v) S.drafts[id] = v; else delete S.drafts[id]; ED.drop(id); }); persistDraftsSoon(); }
  if (ext.priors) { Object.keys(ext.priors).forEach((id) => { const v = clone(ext.priors[id][w]); if (v) S.priors[id] = v; else delete S.priors[id]; }); ss.set('st1:priors', S.priors); }
}
function afterRestore(oid) {
  if (S.open && !findItem(S.open)) { S.open = null; S.view = S.layout === 'phone' ? { type: 'none' } : { type: 'owner', ownerId: oid }; if (S.layout === 'phone') S.phone = 'tree'; }
  const fid = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.f : null;
  renderTree(); renderMain(); renderSide();
  if (fid) { const el = $('#formHost [data-f="' + fid + '"]'); if (el) el.focus({ preventScroll: true }); }
}
function undoOwner(oid) {
  const h = S.H[oid]; if (!h || h.idx <= 0) { announce(t('nothingUndo')); return false; }
  const st = h.steps[h.idx]; const x = st.ext && st.ext.cross;
  if (x && !crossBusy) { const others = x.owners.filter((o) => o !== oid), blocked = others.filter((o) => !crossAt(o, x.id, 0)); if (blocked.length) { if (ST.ext.crossBlocked) ST.ext.crossBlocked(blocked, st); return false; } crossBusy = true; try { others.forEach((o) => undoOwner(o)); } finally { crossBusy = false; } }
  if (ST.ext.guardSnap && ST.ext.guardSnap(oid, h.steps[h.idx - 1].snap, () => undoOwner(oid))) return false;   // slice 4: a step that would turn a risky flag on asks first
  h.idx--; applySnap(oid, h.steps[h.idx].snap, new Set((st.ext && st.ext.include) || []), true); applyExt(st.ext, 'before'); h.key = null;
  afterRestore(oid); touchSave(); renderUndoRedo(); renderHistory(); announce(t('undid', { step: st.label })); if (ST.ext.stepHook) ST.ext.stepHook(oid, st, 'undo'); return true;
}
function redoOwner(oid) {
  const h = S.H[oid]; if (!h || h.idx >= h.steps.length - 1) { announce(t('nothingRedo')); return false; }
  const nx = h.steps[h.idx + 1], xr = nx && nx.ext && nx.ext.cross;
  if (xr && !crossBusy) { const others = xr.owners.filter((o) => o !== oid), blocked = others.filter((o) => !crossAt(o, xr.id, 1)); if (blocked.length) { if (ST.ext.crossBlocked) ST.ext.crossBlocked(blocked, nx); return false; } crossBusy = true; try { others.forEach((o) => redoOwner(o)); } finally { crossBusy = false; } }
  if (ST.ext.guardSnap && ST.ext.guardSnap(oid, nx.snap, () => redoOwner(oid))) return false;
  h.idx++; const st = h.steps[h.idx]; applySnap(oid, st.snap, new Set((st.ext && st.ext.include) || []), true); applyExt(st.ext, 'after'); h.key = null;
  afterRestore(oid); touchSave(); renderUndoRedo(); renderHistory(); announce(t('redid', { step: st.label })); if (ST.ext.stepHook) ST.ext.stepHook(oid, st, 'redo'); return true;
}
function revertTo(oid, idx, opts) {
  opts = opts || {}; const h = ensureH(oid), st = h.steps[idx]; if (!st) return;
  if (ST.ext.guardSnap && ST.ext.guardSnap(oid, st.snap, () => revertTo(oid, idx, opts))) return;
  const label = st.base ? t('stepRestore') : idx > h.idx ? t('stepRedoTo', { step: st.label }) : t('stepRevert', { step: st.label });
  edit(oid, label, () => applySnap(oid, st.snap, opts.include));
  afterRestore(oid); announce(label); toast(st.base ? t('restoreDone') : t('reverted', { step: st.label }), { action: { label: t('undoBtn'), fn: () => undoOwner(oid) } });
}
function undoTarget() { const ov = ST.ext.undoOwner && ST.ext.undoOwner(); return ov ? { o: O(ov.id), name: ov.name } : null; }   /* slice 4 (DD-189): a chat-scoped field's owner and the name to say */
function renderUndoRedo() {
  const ut0 = undoTarget(), o = ut0 && ut0.o ? ut0.o : currentOwner(), h = o && S.H[o.id], on = o ? (ut0 && ut0.o ? ut0.name : nm(o.name)) + ': ' : '';
  const canU = !!h && h.idx > 0, canR = !!h && h.idx < h.steps.length - 1;
  const ut = canU ? on + t('undoStep', { step: h.steps[h.idx].label }) : o ? t('nothingUndoOwner', { o: ut0 && ut0.o ? ut0.name : nm(o.name) }) : t('noOwner'), rt = canR ? on + t('redoStep', { step: h.steps[h.idx + 1].label }) : o ? on + t('nothingRedo') : t('noOwner');
  [['#undoBtn', canU, ut], ['#redoBtn', canR, rt]].forEach(([s, ok, tx]) => { const b = $(s); b.setAttribute('aria-disabled', String(!ok)); b.setAttribute('aria-label', tx); b.title = tx + (s.startsWith('#undo') ? ' (Ctrl+Z)' : ' (Ctrl+Shift+Z)'); });
}
function doUndo() { const ut0 = undoTarget(), o = ut0 && ut0.o ? ut0.o : currentOwner(); if (o) return undoOwner(o.id); announce(t('nothingUndo')); return false; }
function doRedo() { const ut0 = undoTarget(), o = ut0 && ut0.o ? ut0.o : currentOwner(); if (o) return redoOwner(o.id); announce(t('nothingRedo')); return false; }
$('#undoBtn').addEventListener('click', () => { if ($('#undoBtn').getAttribute('aria-disabled') === 'true') { announce($('#undoBtn').getAttribute('aria-label')); return; } doUndo(); });
$('#redoBtn').addEventListener('click', () => { if ($('#redoBtn').getAttribute('aria-disabled') === 'true') { announce($('#redoBtn').getAttribute('aria-label')); return; } doRedo(); });

/* ---- restore point and history panel */
function diffOwner(oid) {
  const h = S.H[oid]; if (!h) return null;
  const base = JSON.parse(h.steps[0].snap), cur = O(oid).items; const bm = new Map(base.map((i) => [i.id, i])), cm = new Map(cur.map((i) => [i.id, i]));
  const added = cur.filter((i) => !bm.has(i.id)), removed = base.filter((i) => !cm.has(i.id)), changed = cur.filter((i) => bm.has(i.id) && JSON.stringify(bm.get(i.id)) !== JSON.stringify(i));
  const order = cur.filter((i) => bm.has(i.id)).map((i) => i.id).join() !== base.filter((i) => cm.has(i.id)).map((i) => i.id).join();
  const per = {}; const bump = (i, k) => { (per[i.kind] = per[i.kind] || { added: 0, removed: 0, changed: 0 })[k]++; };
  added.forEach((i) => bump(i, 'added')); removed.forEach((i) => bump(i, 'removed')); changed.forEach((i) => bump(i, 'changed'));
  return { added, removed, changed, order, per, total: added.length + removed.length + changed.length + (order && !changed.length ? 1 : 0) };
}
function renderHistory() {
  const host = $('#panelHistory'); const ids = Object.keys(S.H).filter((id) => S.H[id].steps.length > 1);
  const dels = S.deleted.length ? '<div class="hist-owner" data-part="studio-history-owner" role="presentation">' + ic('trash-2', 14) + '<span>' + esc(t('delHistory')) + '</span></div><div class="hist-list" data-part="studio-history-list" role="list" aria-label="' + esc(t('delHistory')) + '">' + S.deleted.map((d) => '<button type="button" role="listitem" class="hist-step" data-part="studio-history-step" data-kind="deleted" data-del="' + esc(d.did) + '" title="' + esc(t('delRestore')) + '"><span>' + esc(d.label) + '</span><span class="t" data-part="studio-history-step-time">' + ic('rotate-ccw', 14) + ' ' + esc(t('delRestore')) + '</span></button>').join('') + '</div>' : '';
  if (!ids.length) { host.innerHTML = (dels || '<p class="hist-empty" data-part="studio-history-note" data-kind="empty">' + esc(t('historyEmpty')) + '</p>') + '<p class="hint hist-local" data-part="studio-history-note" data-kind="local">' + ic('info', 12) + ' ' + esc(t('draftLocal')) + '</p>'; return; }
  const cur = currentOwner(); ids.sort((a, b) => (cur && a === cur.id ? -1 : cur && b === cur.id ? 1 : S.H[b].steps[S.H[b].steps.length - 1].at - S.H[a].steps[S.H[a].steps.length - 1].at));
  host.innerHTML = dels + ids.map((id) => {
    const o = O(id), h = S.H[id];
    const steps = h.steps.map((st, i) => ({ st, i })).reverse();
    return '<div class="hist-owner" data-part="studio-history-owner" role="presentation">' + ic(ownerIcon(o), 14) + '<span>' + esc(nm(o.name)) + '</span></div><div class="hist-list" data-part="studio-history-list" role="list" aria-label="' + esc(nm(o.name)) + '">' +
      steps.map(({ st, i }) => '<button type="button" role="listitem" class="hist-step' + (i > h.idx ? ' future' : '') + '" data-part="studio-history-step" data-kind="step"' + (i > h.idx ? ' data-future' : '') + (i === h.idx ? ' data-current aria-current="true"' : '') + ' data-o="' + esc(id) + '" data-i="' + i + '" title="' + esc(i > h.idx ? t('stepRedoTo', { step: st.label }) : t('historyRevert')) + '"><span>' + esc(i > h.idx ? t('stepRedoTo', { step: st.label }) : st.label) + '</span><span class="t" data-part="studio-history-step-time">' + new Date(st.at).toLocaleTimeString(S.lang === 'ko' ? 'ko-KR' : 'en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + '</span></button>').join('') + '</div>';
  }).join('') + '<p class="hint hist-local" data-part="studio-history-note" data-kind="local">' + ic('info', 12) + ' ' + esc(t('draftLocal')) + '</p>';
}
$('#panelHistory').addEventListener('click', (e) => { const b = e.target.closest('.hist-step'); if (!b) return; if (b.dataset.del) { restoreDeleted(b.dataset.del); return; } revertTo(b.dataset.o, Number(b.dataset.i)); });

/* ---- saving (simulated, DD-095): status chip, 300 ms before "saving", failure keeps the text and offers a retry */
function setSaveState(st) { if (S.save.state === st) return; S.save.state = st; renderStatus(); }
function touchSave() {
  const sv = S.save; sv.dirty = true;
  if (sv.state === 'failed') return;
  if (!sv.pendSince) { sv.pendSince = now(); clearTimeout(sv.showT); sv.showT = setTimeout(() => { if (sv.dirty || sv.inflight) setSaveState('saving'); }, 300); }
  clearTimeout(sv.debT); sv.debT = setTimeout(flushSave, sv.deb);
}
function flushSave() {
  const sv = S.save; if (sv.inflight) { sv.debT = setTimeout(flushSave, 60); return; }
  sv.inflight = true; sv.dirty = false; const payload = persistPayload();
  sv.doneT = setTimeout(() => {
    sv.inflight = false;
    if (sv.failNext) { sv.failNext = false; sv.dirty = true; sv.pendSince = 0; clearTimeout(sv.showT); setSaveState('failed'); return; }
    ss.raw('st1:db', payload);
    if (sv.dirty) { flushSave(); return; }
    sv.pendSince = 0; clearTimeout(sv.showT); setSaveState('saved');
  }, sv.latency);
}
function retrySave() { const sv = S.save; if (sv.state !== 'failed') return; sv.state = 'pending'; sv.pendSince = now(); clearTimeout(sv.showT); sv.showT = setTimeout(() => { if (sv.dirty || sv.inflight) setSaveState('saving'); }, 300); renderStatus(); flushSave(); }
$('#retryBtn').addEventListener('click', retrySave);

/* ---- opening, adding, deleting, moving */
function defaultTestField(it) { const fd = (FORMS[it.kind] || []).find((x) => x[3] && x[3].cbs); return fd ? { f: fd[0], label: t(fd[2]) } : null; }
function openItem(id, opts) {
  opts = opts || {}; if (ST.ext.beforeOpen) ST.ext.beforeOpen(id); const f = findItem(id); if (!f) return false;
  if (opts.user || opts.fromTree) { S.entryDetail = false; clearNotice(); }
  const changed = S.open !== id;
  S.open = id; S.view = { type: 'item' }; revealItem(f.it, f.o); S.sel = opts.sel || 'i:' + id; S.focusId = S.sel;
  if (changed) { S.tf = ownHidden(f.o.id) ? null : defaultTestField(f.it); S.tr = null; }
  if (S.layout === 'phone') S.phone = 'detail';
  if (S.layout === 'mid' && S.drawer) { S.drawer = false; const l = S.layers.find((x) => x.kind === 'drawer'); if (l) dropLayer(l); }
  saveUi(); renderAll();
  if (opts.focus !== false) focusFirst();
  return true;
}
function focusFirst() {
  const f = S.open ? findItem(S.open) : null;
  if (f && isCode(f.it)) { ED.focus(); return; }
  if (f && ST.ext.focusFirst && ST.ext.focusFirst(f.it)) return;
  const el = $('#formHost [data-f]'); if (el) { el.focus({ preventScroll: false }); return; }
  $('#itemHead').focus();
}
function addItem(oid, kind) {
  const o = O(oid); if (!o || refuseLocked(oid)) return;
  if (kind === 'scripts' || (kind === 'toggles' && ST.ext.oneToggles)) { const ex = itemsOf(o, kind)[0]; if (ex) { revealItem(ex, o); openItem(ex.id, { focus: true, user: true }); return; } }   // one script list per owner (DD-097)
  const n = itemsOf(o, kind).length + 1; const id = oid + '.n' + (++S.seq);
  const it = kind === 'scripts' ? { id, kind, name: scriptNameFor('v2'), on: true, mode: 'v2', f: { rules: '' } } : { id, kind, name: { ko: '새 ' + I18N.ko.kindShort[kind] + ' ' + n, en: 'New ' + I18N.en.kindShort[kind] + ' ' + n }, on: true, f: (DEFAULTS[kind] ? DEFAULTS[kind]() : { body: '' }) };
  if (isCode(it)) it.code = { live: '//@name new_plugin\n//@api 3.0\n', liveRev: 1 };
  edit(oid, stepLabel('stepAdd', it), () => o.items.push(it));
  revealOwner(o); S.exp.add('k:' + oid + ':' + kind); saveUi();
  openItem(id, { focus: true, user: true }); toast(stepLabel('stepAdd', it), { action: { label: t('undoBtn'), fn: () => undoOwner(oid) } });
}
function deleteItem(it, o) {
  if (refuseLocked(o.id)) return;
  const dr = S.drafts[it.id], pr = S.priors[it.id], idx = o.items.findIndex((x) => x.id === it.id), label = stepLabel('stepDelete', it);
  const rowIdx = S.rows.findIndex((r) => r.id === 'i:' + it.id || r.id === 'mi:' + it.id);
  const did = 'd' + (++S.seq); S.deleted.unshift({ did, oid: o.id, item: clone(it), index: idx, draft: clone(dr), prior: clone(pr), label: nm(it.name) || kindName(it.kind), at: Date.now() });
  const ext = dr || pr ? { drafts: dr ? { [it.id]: [clone(dr), null] } : undefined, priors: pr ? { [it.id]: [clone(pr), null] } : undefined } : null;
  edit(o.id, label, () => { o.items.splice(idx, 1); delete S.drafts[it.id]; delete S.priors[it.id]; }, { ext });
  persistDraftsSoon(); ED.drop(it.id);
  if (S.open === it.id) { S.open = null; S.view = S.layout === 'phone' ? { type: 'none' } : { type: 'kind', ownerId: o.id, kind: it.kind }; S.sel = S.layout === 'phone' ? null : 'k:' + o.id + ':' + it.kind; if (S.layout === 'phone') S.phone = 'tree'; }
  renderAll(); announce(label);
  // DD-100: one toast per delete; its Undo restores THIS item whatever was edited since (the item also stays in History > deleted until Studio closes)
  toast(t('deleted', { name: nm(it.name) || kindName(it.kind) }), { ms: 10000, endsOnClose: true, action: { label: t('undoBtn'), fn: () => restoreDeleted(did) } });
  const same = S.rows[rowIdx] && S.rows[rowIdx].type === 'item' && S.rows[rowIdx].ownerId === o.id && S.rows[rowIdx].kind === it.kind;
  const next = rowIdx >= 0 ? (same ? S.rows[rowIdx] : S.rows[Math.max(0, rowIdx - 1)]) : (rowById('k:' + o.id + ':' + it.kind) || S.rows[0]);
  focusRow(next.id, true);   // F-14: never BODY
}
function restoreDeleted(did) {
  const d = S.deleted.find((x) => x.did === did); if (!d) return; const o = O(d.oid); if (!o) return;
  const it = clone(d.item), idx = Math.min(d.index, o.items.length);
  const ext = d.draft || d.prior ? { drafts: d.draft ? { [it.id]: [null, clone(d.draft)] } : undefined, priors: d.prior ? { [it.id]: [null, clone(d.prior)] } : undefined } : null;
  edit(o.id, t('stepRestoreDeleted', { kind: kindName(it.kind), name: d.label }), () => { o.items.splice(idx, 0, it); if (d.draft) S.drafts[it.id] = clone(d.draft); if (d.prior) S.priors[it.id] = clone(d.prior); }, { ext });
  S.deleted = S.deleted.filter((x) => x.did !== did); persistDraftsSoon(); revealItem(it, o); renderAll(); announce(t('stepRestoreDeleted', { kind: kindName(it.kind), name: d.label }));
  const r = rowEl('i:' + it.id); if (r) focusRow('i:' + it.id, true);
}
function moveItem(it, o, dir) {
  if (refuseLocked(o.id)) return;
  const same = o.items.map((x, i) => [x, i]).filter(([x]) => x.kind === it.kind); const pos = same.findIndex(([x]) => x.id === it.id), to = pos + dir;
  if (to < 0 || to >= same.length) return;
  edit(o.id, stepLabel('stepMove', it), () => { const a = same[pos][1], b = same[to][1]; [o.items[a], o.items[b]] = [o.items[b], o.items[a]]; });
  renderTree(); renderMain(); toast(t('moved'), {});
}
function setEnabled(it, o, on) { if (refuseLocked(o.id)) return; edit(o.id, stepLabel(on ? 'stepOn' : 'stepOff', it), () => { it.on = on; }); renderTree(); renderItemHead(); renderMain(true); }

/* ---- main column */
function renderAll() { applyLayoutAttrs(); renderTree(); renderMain(); renderSide(); }
function applyLayoutAttrs() { const st = $('#studio'); st.dataset.layout = S.layout; st.dataset.phone = S.phone; renderBar2(); }
function autosize(ta) { ta.style.height = 'auto'; ta.style.height = Math.max(ta.scrollHeight + 2, 0) + 'px'; }
function fieldHtml(it, o, fd) {
  const [f, type, lab, opt] = fd; const o2 = opt || {}; if (o2.charOnly && o.type !== 'char' && o.type !== 'module') return '';
  const id = 'f-' + f, probs = itemProblems(it).filter((p) => p.field === f), invalid = probs.length && probs[0].sev === 'error';
  const v = f === 'iname' ? nm(it.name) : it.f[f]; const desc = o2.help ? ' aria-describedby="h-' + f + '"' : probs.length ? ' aria-describedby="e-' + f + '"' : '';
  let ctl = '';
  if (type === 'text') ctl = '<input type="text" data-part="studio-field-control" id="' + id + '" data-f="' + f + '" value="' + esc(v == null ? '' : v) + '" class="' + (o2.mono ? 'mono' : '') + '" autocomplete="off" spellcheck="false"' + (invalid ? ' aria-invalid="true"' : '') + desc + '>';
  else if (type === 'area') ctl = '<textarea data-part="studio-field-control" id="' + id + '" data-f="' + f + '" class="' + (o2.mono ? 'mono' : '') + '" rows="' + (o2.small ? 3 : 5) + '" spellcheck="false"' + (o2.cbs ? ' data-cbs="1"' : '') + (invalid ? ' aria-invalid="true"' : '') + desc + '>' + esc(v == null ? '' : v) + '</textarea>';
  else if (type === 'select') ctl = '<select data-part="studio-field-control" id="' + id + '" data-f="' + f + '">' + Object.keys(t('stages')).map((k) => '<option value="' + k + '"' + (v === k ? ' selected' : '') + '>' + esc(t('stages')[k]) + '</option>').join('') + '</select>';
  else if (type === 'sw') return '<div class="fld" data-part="studio-field" data-field="' + f + '"><label class="sw" data-part="studio-field-control"><input type="checkbox" id="' + id + '" data-f="' + f + '"' + (v ? ' checked' : '') + desc + '><span class="sw-ui"></span><span class="lbl">' + esc(t(lab)) + '</span></label>' + (o2.help ? '<span class="help" data-part="studio-field-help" id="h-' + f + '">' + esc(t(o2.help)) + '</span>' : '') + (probs.length ? '<span class="err" data-part="studio-field-note" data-kind="error" id="e-' + f + '">' + ic('triangle-alert', 14) + esc(probs[0].msg) + '</span>' : '') + '</div>';
  return '<div class="fld" data-part="studio-field" data-field="' + f + '"><label for="' + id + '" data-part="studio-field-label">' + esc(t(lab)) + '</label>' + ctl + (o2.help ? '<span class="help" data-part="studio-field-help" id="h-' + f + '">' + esc(t(o2.help)) + '</span>' : '') + (probs.length ? '<span class="err" data-part="studio-field-note" data-kind="error" id="e-' + f + '">' + ic('triangle-alert', 14) + esc(probs[0].msg) + '</span>' : '') + '</div>';
}
function renderMain(keepFocus) {
  const v = S.view, host = $('#formHost'), card = $('#editor-panel');
  const f = S.open ? findItem(S.open) : null;
  if (v.type === 'item' && !f) { S.view = { type: 'none' }; S.open = null; }
  if (ST.ext.onMain) ST.ext.onMain(S.view, S.open);   // slice 4: leaving an item ends its visit
  renderItemHead();
  if (S.view.type === 'item') {
    const { o, it } = f;
    if (ownHidden(o.id) && ST.ext.renderForm && ST.ext.renderForm(it, o, host)) {   /* DD-194: any item of a hidden private character opens the notice, never its content (not even a code item's editor) */
      card.hidden = true; if (ST.ext.afterForm) ST.ext.afterForm(it, o, host);
    } else if (isCode(it)) { card.hidden = false; renderCodeBanners(it, o); openCode(it, o); if (ownLocked(o.id) && ST.ext.lockHost) ST.ext.lockHost(host, card, it, o); }
    else {
      card.hidden = true;
      if (!(ST.ext.renderForm && ST.ext.renderForm(it, o, host))) host.innerHTML = peerBannerHtml(it) + '<div class="ph-note">' + ic('flask-conical', 16) + '<span>' + esc(t('placeholderForm')) + '</span></div>' + (it.on ? '' : '<div class="info-banner" data-part="studio-info-banner" data-kind="disabled">' + ic('circle-off', 16) + '<span>' + esc(t('disabledNote')) + '</span></div>') + scriptsTop(it, o) + (FORMS[it.kind] || []).map((fd) => fieldHtml(it, o, fd)).join('');
      $$('textarea', host).forEach(autosize);
      if (ST.ext.afterForm) ST.ext.afterForm(it, o, host);   // slice 3: mounts the long-text editor on the form's long fields
      if (ownLocked(o.id) && ST.ext.lockHost) ST.ext.lockHost(host, card, it, o);   /* DD-194: a revealed private character is read only in every item kind */
    }
  } else {
    card.hidden = true;
    if (S.view.type === 'tgmerged' && ST.ext.renderMerged) ST.ext.renderMerged(host);
    else if (S.view.type === 'kind') {
      const o = O(S.view.ownerId), k = S.view.kind, its = itemsOf(o, k);
      host.innerHTML = '<div class="kind-list" data-part="studio-kind-list">' + (its.length ? its.map((it) => '<button type="button" class="kind-row" data-part="studio-kind-row" data-open="' + esc(it.id) + '">' + ic(KIND_ICON[k], 18) + '<span>' + esc(shownName(it, o)) + '</span>' + (probCount(it) ? '<span class="mk prob">' + ic('triangle-alert', 14) + probCount(it) + '</span>' : '') + (isCode(it) && hasDraft(it.id) ? '<span class="mk draft">•</span>' : '') + '<span class="n">' + ic('chevron-right', 16) + '</span></button>').join('') : '<div class="empty" data-part="studio-empty"><h2>' + esc(t('emptyKind')) + '</h2><p>' + esc(t('emptyKindHelp', { o: nm(o.name), k: kindName(k) })) + '</p></div>') + '</div>';
    } else if (S.view.type === 'owner') {
      const o = O(S.view.ownerId);
      host.innerHTML = '<div class="kind-list" data-part="studio-kind-list" role="list" aria-label="' + esc(t('ownerSummary', { o: nm(o.name) })) + '">' + SUPPORT[o.type].map((k) => { const n = itemsOf(o, k).length; return '<button type="button" role="listitem" class="kind-row" data-part="studio-kind-row" data-kind="' + k + '" data-owner="' + o.id + '">' + ic(KIND_ICON[k], 18) + '<span>' + esc(kindName(k)) + '</span><span class="n">' + n + '</span></button>'; }).join('') + '</div>';
    } else {
      host.innerHTML = '<div class="empty" data-part="studio-empty"><h2>' + esc(t('pickItem')) + '</h2><p>' + esc(S.ctx.chat ? t('oChatTitle') : nm(ctxChar().name)) + '</p></div>';
    }
  }
}
$('#formHost').addEventListener('click', (e) => {
  const op = e.target.closest('[data-open]:not([data-open=""]):not([data-open="true"]):not([data-open="false"])'); if (op) {   /* slice 4 / DD-200: data-open="true|false" (sections, add-a-field rows, tree rows, panels) is a state, not an item id; the rows that open an item carry the id */
    openItem(op.dataset.open, { focus: true }); return; }
  const k = e.target.closest('[data-kind][data-owner]'); if (k) { const o = O(k.dataset.owner);   /* slice 4: only the shell's own kind rows (the forms use data-kind for their kind and for notes) */ S.exp.add('o:' + o.id); S.sel = 'k:' + o.id + ':' + k.dataset.kind; S.view = { type: 'kind', ownerId: o.id, kind: k.dataset.kind }; renderAll(); return; }
  const cmp = e.target.closest('[data-compare]'); if (cmp) { const f = S.open && findItem(S.open); if (f) openConflict(f.it, f.o, cmp); }
});
function onFormInput(e) {
  const el = e.target.closest('[data-f]'); if (!el || !S.open) return; const f = findItem(S.open); if (!f) return; const { o, it } = f; const k = el.dataset.f;
  const val = el.type === 'checkbox' ? el.checked : el.value;
  if (k === 'lowLevel' && o.type !== 'char' && o.type !== 'module') return;
  if (el.tagName === 'TEXTAREA') autosize(el);
  edit(o.id, stepLabel('stepEdit', it), () => { if (k === 'iname') it.name = val; else it.f[k] = val; }, { key: it.id + '.' + k });
  // cheap partial refresh: tree labels and markers, header, problems, test staleness
  renderTree(); renderHeader(); renderItemHeadTitle(); refreshProblemsOnly(); refreshCbsMeta(); refreshFieldErrors(it, o);
}
$('#formHost').addEventListener('input', onFormInput);
$('#formHost').addEventListener('change', (e) => { if (e.target.matches('select[data-f], input[type="checkbox"][data-f]')) onFormInput(e); });
$('#formHost').addEventListener('focusin', (e) => { const el = e.target.closest('[data-cbs]'); if (el && S.open) { const f = findItem(S.open); S.tf = { f: el.dataset.f, label: FIELD_LABEL(f.it, el.dataset.f) }; renderTest(); } });
function refreshFieldErrors(it, o) {
  (FORMS[it.kind] || []).forEach((fd) => {
    const el = $('#formHost [data-f="' + fd[0] + '"]'); if (!el) return; const probs = itemProblems(it).filter((p) => p.field === fd[0]);
    const fld = el.closest('.fld'); let err = fld.querySelector('.err');
    if (probs.length) { if (!err) { err = document.createElement('span'); err.className = 'err'; err.id = 'e-' + fd[0]; fld.appendChild(err); } err.innerHTML = ic('triangle-alert', 14) + esc(probs[0].msg); el.setAttribute('aria-describedby', 'e-' + fd[0]); } else if (err) { err.remove(); if (!(fd[3] && fd[3].help)) el.removeAttribute('aria-describedby'); }
    if (probs.length && probs[0].sev === 'error') el.setAttribute('aria-invalid', 'true'); else el.removeAttribute('aria-invalid');
  });
}

/* item head */
function renderItemTitleText(it) { const f = findItem(it.id); return (f ? shownName(it, f.o) : nm(it.name)) || kindName(it.kind); }
function renderItemHeadTitle() { const f = S.open && findItem(S.open); const h = $('#hName'); if (f && h) h.textContent = renderItemTitleText(f.it); }
function renderItemHead() {
  const head = $('#itemHead'); const f = S.open ? findItem(S.open) : null;
  if (!f || S.view.type !== 'item') {
    const v = S.view; let title = '', sub = '', acts = '';
    if (v.type === 'kind') { const o = O(v.ownerId); title = ic(KIND_ICON[v.kind], 20) + '<span>' + esc(kindName(v.kind)) + '</span>'; sub = '<span class="tag">' + ic(ownerIcon(o), 12) + esc(nm(o.name)) + '</span>'; acts = ownLocked(o.id) ? '' : '<button type="button" class="btn" id="kindAddBtn" data-add="' + o.id + ':' + v.kind + '" aria-label="' + esc(t('addTo', { k: kindName(v.kind) })) + '" title="' + esc(t('addTo', { k: kindName(v.kind) })) + '">' + ic('plus', 18) + '</button>'; }
    else if (v.type === 'tgmerged') { title = ic('layers', 20) + '<span>' + esc(t('merged') + ' · ' + kindName('toggles')) + '</span>'; sub = '<span>' + esc(t('mergedHint')) + '</span>'; }
    else if (v.type === 'owner') { const o = O(v.ownerId); title = ic(ownerIcon(o), 20) + '<span>' + esc(nm(o.name)) + '</span>'; sub = '<span>' + esc(t('owner' + o.type)) + '</span>'; }
    else { title = '<span>' + esc(t('studioTitle')) + '</span>'; }
    head.innerHTML = '<div class="ttl" data-part="studio-item-title"><h1 data-part="studio-item-name">' + title + '</h1>' + (sub ? '<div class="sub" data-part="studio-item-sub">' + sub + '</div>' : '') + '</div><div class="acts" data-part="studio-item-actions">' + acts + panelOpeners() + '</div>';
    head.setAttribute('aria-label', ''); return;
  }
  const { it, o } = f, code = isCode(it); const badge = o.type === 'module' ? moduleBadge(o) : null, phone = S.layout === 'phone';
  let acts = ''; const lockd = ownLocked(o.id);   /* DD-194: nothing to apply, switch or delete on a private character */
  if (code && !lockd) {
    const ok = codeApplyState(it);
    acts += '<button type="button" class="btn" data-part="studio-item-check" id="checkBtn" aria-label="' + esc(t('checkHint')) + '" title="' + esc(t('checkHint')) + '">' + ic('shield-check', 18) + '</button>';
    acts += '<button type="button" class="btn primary" data-part="studio-item-apply" id="applyBtn" aria-label="' + esc(t('applyHint')) + '" title="' + esc(ok.ok ? t('applyHint') : t('applyHint') + ' — ' + ok.why) + '" aria-disabled="' + (!ok.ok) + '">' + ic('upload', 18) + '</button>';
  }
  acts += panelOpeners();
  if (ST.ext.headActs) acts += ST.ext.headActs(it, o);   // after the panel button: refreshPanelBadge() patches the first [data-panel]
  if (hasEnabled(it) && !phone && !lockd) acts += '<label class="sw" title="' + esc(t('enabledSw')) + '"><input type="checkbox" id="onSw"' + (it.on ? ' checked' : '') + '><span class="sw-ui"></span><span class="lbl">' + esc(t('enabledSw')) + '</span></label>';   // F-12: only kinds that can be switched off; on a phone it lives in the item menu (F-11)
  if (!lockd) acts += '<button type="button" class="btn" data-part="studio-item-menu" id="itemMenuBtn" aria-haspopup="menu" aria-label="' + esc(t('more')) + '" title="' + esc(t('more')) + '">' + ic('ellipsis', 18) + '</button>';
  const same = shownName(it, o) === kindName(it.kind);   // F-21: do not say the same word twice
  head.innerHTML = '<div class="ttl" data-part="studio-item-title"><h1 data-part="studio-item-name">' + ic(KIND_ICON[it.kind], 20) + '<span id="hName">' + esc(renderItemTitleText(it)) + '</span></h1><div class="sub" data-part="studio-item-sub"><span class="tag" data-part="studio-item-tag">' + ic(ownerIcon(o), 12) + esc(nm(o.name)) + '</span>' + (same ? '' : '<span>' + esc(kindName(it.kind)) + '</span>') + (it.kind === 'scripts' ? '<span class="tag mode" data-part="studio-item-tag">' + esc(modeName(it.mode)) + '</span>' : '') + (badge ? '<span class="tag ' + badge[0] + '" data-part="studio-item-tag">' + esc(badge[1]) + '</span>' : '') + '</div></div><div class="acts" data-part="studio-item-actions">' + acts + '</div>' + (code ? '<p class="apply-why" id="applyWhy" data-part="studio-item-apply-why" hidden></p>' : '');
  if (code) updateApplyBtn();
}
function panelOpeners() {
  if (S.layout === 'wide') return '';
  const f = S.open && findItem(S.open); const n = f ? probCount(f.it) : 0;   // F-11: one panel button (Problems / Test / History tabs inside), not three
  return '<button type="button" class="btn" data-panel="problems" aria-haspopup="dialog" aria-label="' + esc(t('panelBtn') + ': ' + t('tabProblems') + ' · ' + t('tabTest') + ' · ' + t('tabHistory') + (n ? ' (' + t('problemsN', { n }) + ')' : '')) + '" title="' + esc(t('panelBtn')) + '">' + ic('panel-bottom', 18) + (n ? '<span class="mk prob">' + n + '</span>' : '') + '</button>';
}
$('#itemHead').addEventListener('click', (e) => {
  const f = S.open ? findItem(S.open) : null;
  const pn = e.target.closest('[data-panel]'); if (pn) { openSide(pn.dataset.panel, pn); return; }
  const ad = e.target.closest('[data-add]'); if (ad) { const [oid, k] = ad.dataset.add.split(':'); addItem(oid, k); return; }
  if (!f) return;
  if (e.target.closest('#checkBtn')) { doCheckItem(); return; }
  if (e.target.closest('#applyBtn')) { requestApply(); return; }
  if (e.target.closest('#itemMenuBtn')) { openItemMenu(f.it, f.o, e.target.closest('#itemMenuBtn')); return; }
});
$('#itemHead').addEventListener('change', (e) => { if (e.target.id === 'onSw') { const f = findItem(S.open); if (f) setEnabled(f.it, f.o, e.target.checked); } });

function scriptNameFor(mode) { return mode === 'lua' ? { ko: 'Lua 스크립트', en: 'Lua script' } : mode === 'v1' ? { ko: 'V1 규칙', en: 'V1 rules' } : { ko: 'V2 규칙', en: 'V2 rules' }; }
function scriptsTop(it, o) {
  if (it.kind !== 'scripts') return '';
  const modes = ['v2', 'lua'].concat(it.mode === 'v1' ? ['v1'] : []);
  const seg = '<div class="seg" role="group" aria-label="' + esc(t('scriptMode')) + '">' + modes.map((m) => '<button type="button" class="btn" data-smode="' + m + '" aria-pressed="' + (it.mode === m) + '">' + esc(modeName(m)) + (S.priors[it.id] && S.priors[it.id][m] ? ' •' : '') + '</button>').join('') + '</div>';
  const pr = S.priors[it.id] || {}, keys = Object.keys(pr);
  const prior = keys.length ? '<div class="info-banner" id="priorBanner" data-part="studio-restore-list" data-part-critical>' + ic('history', 16) + '<span data-part="studio-restore-list-text">' + esc(t('storedLists')) + ': ' + keys.map((k) => esc(k === 'aside' ? t('storedAside') : modeName(k))).join(', ') + ' · ' + esc(t('priorNone')) + '</span>' + keys.map((k) => '<button type="button" class="btn solid" data-part="studio-restore-list-action" data-prior="' + k + '" aria-label="' + esc(t('priorRestore') + ': ' + (k === 'aside' ? t('storedAside') : modeName(k))) + '">' + ic('rotate-ccw', 16) + '<span>' + esc(t('priorRestore')) + '</span></button>').join('') + '</div>' : '<p class="hint">' + esc(t('priorNone')) + '</p>';
  return '<div class="fld"><span class="lab">' + esc(t('scriptModeLead', { o: t('owner' + o.type) })) + '</span>' + seg + '</div>' + prior;
}
function priorOf(it) { return { mode: it.mode, rules: (it.f && it.f.rules) || '', live: it.code ? it.code.live : null, liveRev: it.code ? it.code.liveRev : null, draft: clone(S.drafts[it.id]) || null, at: Date.now() }; }
/* DD-103: each mode keeps its own last list (device-only); switching to a mode brings its list back; an untouched empty list never replaces a stored one */
const isEmptyList = (l) => l.mode === 'lua' ? (!l.draft && String(l.live || '').replace(/\s/g, '') === '--newscript') : !String(l.rules || '').trim();
function switchMode(it, o, mode) {
  if (it.mode === mode) return; const before = clone(S.priors[it.id]) || null, dr = clone(S.drafts[it.id]), cur = priorOf(it);
  const lists = Object.assign({}, clone(S.priors[it.id]) || {}); if (!isEmptyList(cur)) lists[it.mode] = cur;
  const target = lists[mode]; delete lists[mode]; const afterDraft = target && mode === 'lua' && target.draft ? clone(target.draft) : null, hasLists = Object.keys(lists).length > 0;
  edit(o.id, stepLabel('stepSwitch', it, { m: modeName(mode) }), () => {
    delete S.drafts[it.id]; it.mode = mode; it.name = scriptNameFor(mode);
    if (target) { it.f.rules = target.rules || ''; if (mode === 'lua') { it.code = { live: target.live, liveRev: target.liveRev }; if (target.draft) S.drafts[it.id] = clone(target.draft); } else delete it.code; }
    else { it.f.rules = ''; if (mode === 'lua') it.code = { live: '-- new script\n', liveRev: 1 }; else delete it.code; }
    if (hasLists) S.priors[it.id] = lists; else delete S.priors[it.id];
  }, { ext: { drafts: { [it.id]: [dr, afterDraft] }, priors: { [it.id]: [before, hasLists ? clone(lists) : null] } } });
  ED.drop(it.id); persistDraftsSoon(); renderAll();
  toast(target ? t('priorRestoredToast', { m: modeName(mode) }) : t('priorKept', { m: modeName(cur.mode) }), { ms: 5000, action: { label: t('undoBtn'), fn: () => undoOwner(o.id) } });
  const b = $('#formHost [data-smode="' + mode + '"]'); if (b) b.focus();
}
function restorePrior(it, o, which) {
  const pr = S.priors[it.id]; if (!pr) return; if (which && which !== 'aside') { switchMode(it, o, which); return; }
  const key = which === 'aside' ? 'aside' : Object.keys(pr)[0]; if (key !== 'aside') { switchMode(it, o, key); return; }
  const cd = clone(S.drafts[it.id]), nd = clone(pr.aside.draft), rest = Object.assign({}, clone(pr)); delete rest.aside; const hasRest = Object.keys(rest).length > 0;
  edit(o.id, stepLabel('stepPriorRestore', it), () => { S.drafts[it.id] = nd; if (hasRest) S.priors[it.id] = rest; else delete S.priors[it.id]; }, { ext: { drafts: { [it.id]: [cd, clone(nd)] }, priors: { [it.id]: [clone(pr), hasRest ? clone(rest) : null] } } });
  ED.drop(it.id); persistDraftsSoon(); renderAll();
}
$('#formHost').addEventListener('click', (e) => {
  const f = S.open && findItem(S.open); if (!f) return;
  const sm = e.target.closest('[data-smode]'); if (sm) { switchMode(f.it, f.o, sm.dataset.smode); return; }
  const pb = e.target.closest('[data-prior]'); if (pb) { restorePrior(f.it, f.o, pb.dataset.prior); return; }
  const pe = e.target.closest('.peer-banner [data-peer]'); if (pe) resolvePeer(pe.dataset.peer);   // slice 4: a field can carry data-peer="changed" (a marker), only the banner's buttons resolve
});
function peerBannerHtml(it) {
  if (!S.peers[it.id]) return '';
  return '<div class="conflict-banner peer-banner" data-part="studio-alert-banner" data-part-critical data-kind="peer" role="alert"><span class="t" data-part="studio-alert-banner-text">' + ic('git-compare', 18) + '<span><strong>' + esc(t('peerTitle')) + '</strong> ' + esc(t('peerBody')) + '</span></span><button type="button" class="btn solid" data-part="studio-alert-banner-action" data-peer="reload">' + ic('rotate-ccw', 18) + '<span>' + esc(t('peerReload')) + '</span></button><button type="button" class="btn solid" data-part="studio-alert-banner-action" data-peer="keep">' + ic('check', 18) + '<span>' + esc(t('peerKeep')) + '</span></button></div>';
}
function peerChange(id) {
  const f = findItem(id || 'c1.lore1'); if (!f || isCode(f.it)) return; const { it, o } = f; const fd = (FORMS[it.kind] || []).find((x) => x[1] === 'area'); if (!fd) return;
  S.peers[it.id] = { itemId: it.id, oid: o.id, field: fd[0], theirs: String(it.f[fd[0]] || '') + (S.lang === 'ko' ? ' (다른 곳에서 고침)' : ' (edited elsewhere)') };
  (S.peerLog[o.id] = S.peerLog[o.id] || new Map()).set(it.id, fd[0]);
  if (S.open === it.id) renderPeerBanner(); renderTree(); renderStatus(); announce(t('peerTitle') + ': ' + (nm(it.name) || kindName(it.kind)));
}
function renderPeerBanner() {
  const host = $('#formHost'); const old = $('.peer-banner', host); if (old) old.remove(); const f = S.open && findItem(S.open); if (!f) return; const h = peerBannerHtml(f.it); if (h) host.insertAdjacentHTML('afterbegin', h);
}
function resolvePeer(how, id) {
  const itemId = id || S.open, p = S.peers[itemId]; if (!p) return; const f = findItem(itemId); delete S.peers[itemId];
  if (f && how === 'reload') { const { it, o } = f; edit(o.id, stepLabel('stepPeerReload', it), () => { it.f[p.field] = p.theirs; }, { ext: { include: [it.id] } }); renderMain(); toast(t('peerReloaded'), { action: { label: t('undoBtn'), fn: () => undoOwner(o.id) } }); }
  else { renderPeerBanner(); toast(t('peerKept'), {}); }
  renderStatus(); renderTree();
}
function openRowMenu(r, el) {
  const items = []; const lk = ownLocked(r.ownerId || (r.itemId && findItem(r.itemId) ? findItem(r.itemId).o.id : ''));
  if (r.type === 'kind' && !lk) items.push(['plus', t('addTo', { k: kindName(r.kind) }), () => addItem(r.ownerId, r.kind), '']);
  if (r.type === 'item' && !lk) { const f = findItem(r.itemId); if (f) { items.push(['arrow-up', t('moveUp'), () => moveItem(f.it, f.o, -1), '']); items.push(['arrow-down', t('moveDown'), () => moveItem(f.it, f.o, 1), '']); items.push(['trash-2', t('del'), () => deleteItem(f.it, f.o), 'danger']); } }
  if (r.exp != null) items.push([r.exp ? 'chevron-up' : 'chevron-down', r.exp ? t('collapseAll') : t('expandAll'), () => { toggleExp(r.id); focusRow(r.id); }, '']);
  if (items.length) openMenu(el, t('rowMenu'), items);
}
/* Settings return ids are the Settings lane's (docs/design/settings/checks/builder-checks.md, Page and section ids) */
const SETTINGS_TO = { preset: { page: 'models', section: 'models.presets' }, presetPrompt: { page: 'models', section: 'models.prompt' }, module: { page: 'ext', section: 'ext.modules' }, plugin: { page: 'ext', section: 'ext.plugins' } };
function settingsUrl() { const to = S.settingsTo; return '../settings/slice1.html?from=studio' + (to ? '&page=' + encodeURIComponent(to.page) + '&section=' + encodeURIComponent(to.section) : ''); }
function showNotice(text) { const n = $('#deepNotice'); n.innerHTML = '<span>' + ic('info', 16) + '<span class="nt">' + esc(text) + '</span></span><button type="button" class="btn sm" id="noticeX" aria-label="' + esc(t('noticeDismiss')) + '" title="' + esc(t('noticeDismiss')) + '">' + ic('x', 16) + '</button>'; n.hidden = false; ST.notice = text; announce(text); }
function clearNotice() { const n = $('#deepNotice'); if (n) { n.hidden = true; n.textContent = ''; } ST.notice = null; }
document.addEventListener('click', (e) => { if (e.target.closest('#noticeX')) clearNotice(); });
/* ================================================================== C. code items (draft, Check, Apply, conflict), side panel, test frame */
function codeSpec(it, o) {
  const dr = S.drafts[it.id];
  return { key: it.id, mode: it.kind === 'plugin' ? 'plugin' : 'lua', title: nm(it.name), text: dr ? dr.text : it.code.live, live: it.code.live, whatIf: dr ? !!dr.whatIf : false, realLow: it.kind === 'lua' ? ownerLow(o) : false };
}
function openCode(it, o) {
  S.suppressDoc = true;
  try {
    const dr = S.drafts[it.id];
    const doc = ED.open(codeSpec(it, o), {});
    if (dr && dr.checked && !doc.checked && dr.checked.hash === hash(doc.text)) doc.checked = { rev: doc.rev, at: new Date(dr.checked.at || Date.now()), errors: dr.checked.errors, warnings: dr.checked.warnings, infos: dr.checked.infos, assume: dr.checked.assume, codes: dr.checked.codes || [] };
    ED.relang();
  } finally { S.suppressDoc = false; }
  updateApplyBtn(); renderTest();
}
function codeApplyState(it) {
  const dr = S.drafts[it.id], doc = ED.doc(it.id);
  if (!dr) return { ok: false, why: t('noDraft') };
  if (dr.baseRev !== it.code.liveRev) return { ok: true, conflict: true, why: t('applyConflictHint') };
  if (!doc || !doc.checked || doc.checked.rev !== doc.rev || doc.checked.errors > 0) return { ok: false, why: t('applyNeedsCheck') };
  if (doc.checked.assume !== doc.realLow) return { ok: false, why: t('applyAssume') };
  return { ok: true };
}
function updateApplyBtn() {
  const f = S.open && findItem(S.open); const b = $('#applyBtn'); if (!f || !b) return;
  const st = codeApplyState(f.it); b.setAttribute('aria-disabled', String(!st.ok)); b.title = st.ok ? t('applyHint') : t('applyHint') + ' — ' + st.why;
  b.dataset.why = st.ok ? '' : st.why;
  // F-08: the reason is visible text next to Apply, with the way out (the real setting), not only a tooltip
  const w = $('#applyWhy'); if (!w) return; const dr = S.drafts[f.it.id]; let why = '', link = false;
  if (dr && !st.ok) { if (st.why === t('applyAssume')) { why = t('whyAssume'); link = true; } else if (st.why === t('applyNeedsCheck')) why = t('whyCheck'); else why = st.why; }
  const sig = why + '|' + link; if (w.dataset.sig === sig) return; w.dataset.sig = sig; w.hidden = !why;
  w.innerHTML = why ? ic('info', 14) + '<span>' + esc(why) + '</span>' + (link ? '<button type="button" class="btn-txt" id="whyLink">' + esc(t('openLowSetting')) + '</button>' : '') : '';
}
document.addEventListener('click', (e) => { if (e.target.closest('#whyLink')) openOwnerSetting(); });
function renderCodeBanners(it, o) {
  const host = $('#formHost'), dr = S.drafts[it.id]; let h = scriptsTop(it, o);
  if (dr && dr.baseRev !== it.code.liveRev) h += '<div class="conflict-banner" data-part="studio-alert-banner" data-part-critical data-kind="conflict" role="alert"><span class="t" data-part="studio-alert-banner-text">' + ic('triangle-alert', 18) + '<span>' + esc(t('conflict')) + '</span></span><button type="button" class="btn solid" data-part="studio-alert-banner-action" data-compare="1">' + ic('diff', 18) + '<span>' + esc(t('conflictCompare')) + '</span></button></div>';
  if (dr) h += '<div class="info-banner draft-note" data-part="studio-info-banner" data-kind="draft">' + ic('file-pen', 16) + '<span>' + esc(t('draftNote')) + ' <span class="local-note">' + esc(t('draftLocal')) + '</span></span></div>';   // DD-099: say where drafts live
  if (S.draftWarn) h += '<div class="conflict-banner" data-part="studio-alert-banner" data-part-critical data-kind="draft-store" role="alert"><span class="t" data-part="studio-alert-banner-text">' + ic('triangle-alert', 18) + '<span>' + esc(t('draftStoreFail')) + '</span></span></div>';
  if (!it.on) h += '<div class="info-banner" data-part="studio-info-banner" data-kind="disabled">' + ic('circle-off', 16) + '<span>' + esc(t('disabledNote')) + '</span></div>';
  host.innerHTML = h;
}
function refreshCodeUi(it, o) { renderTree(); renderStatus(); updateApplyBtn(); if (S.open === it.id) { renderCodeBanners(it, o); } renderSide(); }

/* editor hooks: the editor reports edits, checks and problem counts; the shell stores drafts (persisted through sessionStorage, simulated) */
ED.hooks.header = (doc) => {
  if (S.suppressDoc) return; const f = findItem(doc.key); if (!f) return; const { it, o } = f;
  const cur = ED.current() === doc ? ED.text() : doc.text, had = S.drafts[it.id];
  if (cur === it.code.live) { if (had) { delete S.drafts[it.id]; persistDraftsSoon(); refreshCodeUi(it, o); } return; }
  const d = had || { baseRev: it.code.liveRev }; const wasNew = !had;
  const wasChecked = !!(d.checked), chk = doc.checked && doc.checked.rev === doc.rev ? doc.checked : null;
  d.text = cur; d.whatIf = doc.lowLevel;
  d.checked = chk ? { hash: hash(cur), errors: chk.errors, warnings: chk.warnings, infos: chk.infos, assume: chk.assume, codes: chk.codes, at: chk.at.getTime() } : null;
  S.drafts[it.id] = d; persistDraftsSoon();
  if (wasNew) refreshCodeUi(it, o); else { updateApplyBtn(); if (wasChecked !== !!d.checked) renderStatus(); }
};
ED.hooks.check = (doc, stamp) => { const f = findItem(doc.key); if (!f) return; ED.hooks.header(doc); updateApplyBtn(); renderStatus(); };
ED.hooks.counts = (c) => { const doc = ED.current(); if (!doc) return; S.codeProb[doc.key] = c.errors + c.warnings; refreshPanelBadge(); const cnt = $('#cntProblems'); cnt.textContent = c.errors + c.warnings ? String(c.errors + c.warnings) : ''; cnt.classList.toggle('err', c.errors > 0); renderTreeMarksSoon(); };
const renderTreeMarksSoon = (() => { let tm = 0; return () => { clearTimeout(tm); tm = setTimeout(() => { if (S.inStudio) renderTree(); }, 80); }; })();
ED.hooks.toast = (msg, undo) => toast(msg, undo ? { action: { label: t('undoBtn'), fn: undo } } : {});
ED.hooks.showEditor = () => { if (S.sideOpen) closeSide(); };
ED.hooks.showTest = () => { if (S.layout === 'wide') selectTab('test', true); else openSide('test'); };
ED.hooks.tested = () => { if (S.layout !== 'wide' && !S.sideOpen) openSide('test'); };
ED.hooks.leave = () => { $('#itemHead').focus(); };
ED.hooks.openSetting = () => openOwnerSetting();   // modules have a 고급 kind now, so the setting has a home (F-08)
ED.hooks.run = () => { if (testMode() === 'cbs') { runCbs(); return true; } return false; };
function openOwnerSetting() {
  const f = S.open && findItem(S.open); const o = f ? f.o : null; const adv = o && o.items.find((i) => i.kind === 'advanced');
  if (adv) { if (S.sideOpen) closeSide(); openItem(adv.id, { focus: true }); setTimeout(() => { const sw = $('#f-lowLevel'); if (sw) sw.focus(); }, 30); } else toast(t('noSettingHere'), {});
}
function doCheckItem() { const f = S.open && findItem(S.open); if (!f || !isCode(f.it) || ownLocked(f.o.id)) return;   /* re-check R-3: the editor is not mounted behind the private notice */ ED.check(); }

function requestApply() {
  const f = S.open && findItem(S.open); if (!f || !isCode(f.it)) return; const { it, o } = f, st = codeApplyState(it);
  if (!st.ok) { toast(st.why, {}); return; }
  if (st.conflict) { openConflict(it, o, $('#applyBtn')); return; }
  const doc = ED.doc(it.id), warn = doc.checked.warnings;
  openSheet({ title: t('applyTitle'), opener: $('#applyBtn'), cls: 'dlg', critical: true, kind: 'apply', build(body) {
    body.innerHTML = '<p class="txt">' + esc(t('applyBody')) + '</p>' + (warn ? '<p class="txt warn">' + ic('triangle-alert', 14) + ' ' + esc(t('applyWarn', { n: warn, codes: (doc.checked.codes || []).filter((c) => /-W/.test(c)).join(', ') })) + '</p>' : '') +
      '<div class="confirm-row"><button type="button" class="btn" data-x="cancel" data-autofocus="1">' + ic('x', 18) + '<span>' + esc(t('cancel')) + '</span></button><button type="button" class="btn primary" data-x="ok">' + ic('upload', 18) + '<span>' + esc(t('applyDo')) + '</span></button></div>';
    body.querySelector('[data-x="cancel"]').onclick = () => closeSheet(true);
    body.querySelector('[data-x="ok"]').onclick = () => { closeSheet(false); doApply(it, o); };
  } });
}
function doApply(it, o) {
  const dr = S.drafts[it.id]; if (!dr) return; const before = clone(dr);
  S.prevLive[it.id] = { text: it.code.live, at: Date.now() };   // the replaced live version is kept, device-only, until the next Apply
  edit(o.id, stepLabel('stepApply', it), () => { it.code.live = dr.text; it.code.liveRev++; delete S.drafts[it.id]; }, { ext: { drafts: { [it.id]: [before, null] } } });
  persistDraftsSoon(); ED.drop(it.id); S.appliedUntil = Date.now() + 3000; setTimeout(() => { if (S.inStudio) renderStatus(); }, 3100);
  renderTree(); renderMain(); renderStatus(); renderSide(); announce(t('appliedStatus'));
  toast(t('applied'), { ms: 10000, endsOnClose: true, action: { label: t('undoBtn'), fn: () => undoOwner(o.id) } });
  const b = $('#applyBtn'); if (b) b.focus({ preventScroll: true });
}
function discardDraft(it, o) {
  const dr = S.drafts[it.id]; if (!dr) return; const before = clone(dr), label = stepLabel('stepDiscard', it);
  edit(o.id, label, () => { delete S.drafts[it.id]; }, { ext: { drafts: { [it.id]: [before, null] } } });
  persistDraftsSoon(); ED.drop(it.id); renderTree(); renderMain(); renderStatus(); renderSide(); announce(t('draftDiscarded'));
  toast(t('draftDiscarded'), { ms: 10000, endsOnClose: true, action: { label: t('undoBtn'), fn: () => undoOwner(o.id) } });
}
function remoteChange(id) {
  const f = findItem(id || 'c1.sc'); if (!f) return; const { it, o } = f; if (!isCode(it)) return;
  it.code.live = it.code.live + '\n' + (it.kind === 'plugin' ? '// (edited on another device)' : '-- (edited on another device)'); it.code.liveRev++;
  ss.raw('st1:db', persistPayload());
  // history snapshots must not resurrect the old text for this item
  const h = S.H[o.id]; if (h) h.steps.forEach((st) => { const arr = JSON.parse(st.snap); const x = arr.find((i) => i.id === it.id); if (x) { x.code = clone(it.code); st.snap = JSON.stringify(arr); } });
  if (S.open === it.id) { if (!S.drafts[it.id]) ED.drop(it.id); S.suppressDoc = true; renderMain(); S.suppressDoc = false; }
  refreshCodeUi(it, o); announce(t('conflict'));
}
function openConflict(it, o, opener) {
  const dr = S.drafts[it.id]; if (!dr) return; const df = ED.lineDiff(it.code.live, dr.text);
  let lines = []; df.ops.forEach((op, i) => { if (op.t !== 'eq') lines.push('<span class="d-' + (op.t === 'del' ? 'del' : 'add') + '">' + (op.t === 'del' ? '− ' : '+ ') + esc(op.s) + '</span>'); else if ((df.ops[i - 1] && df.ops[i - 1].t !== 'eq') || (df.ops[i + 1] && df.ops[i + 1].t !== 'eq')) lines.push('<span class="d-eq">  ' + esc(op.s) + '</span>'); });
  if (lines.length > 60) lines = lines.slice(0, 60).concat(['<span class="d-eq">…</span>']);
  openSheet({ title: t('conflict'), opener, cls: 'dlg tall', critical: true, kind: 'conflict', build(body) {
    // F-19: focus starts on the comparison (neutral); the choices run from the safest to the one that overwrites
    body.innerHTML = '<p class="txt">' + esc(t('conflictBody')) + '</p><p class="txt txt-tight"><strong>' + esc(t('conflictDiff')) + '</strong></p><div class="diffbox" tabindex="0" role="group" aria-label="' + esc(t('conflictDiff')) + '">' + lines.join('') + '</div>' +
      '<div class="cf-acts"><button type="button" class="btn item" data-x="theirs">' + ic('rotate-ccw', 20) + '<span>' + esc(t('takeTheirs')) + '</span></button><button type="button" class="btn item" data-x="aside">' + ic('copy', 20) + '<span>' + esc(t('copyAside')) + '</span></button><button type="button" class="btn item" data-x="mine">' + ic('check', 20) + '<span>' + esc(t('keepMine')) + '</span></button><button type="button" class="btn item" data-x="cancel" data-autofocus="1">' + ic('x', 20) + '<span>' + esc(t('cancel')) + '</span></button></div><p class="txt txt-small">' + esc(t('conflictHelp')) + '</p>';
    body.querySelector('[data-x="mine"]').onclick = () => { closeSheet(false); S.prevLive[it.id] = { text: it.code.live, at: Date.now() }; dr.baseRev = it.code.liveRev; persistDraftsSoon(); refreshCodeUi(it, o); toast(t('keptMine'), {}); };
    body.querySelector('[data-x="theirs"]').onclick = () => { closeSheet(false); const before = clone(dr); edit(o.id, stepLabel('stepTakeTheirs', it), () => { delete S.drafts[it.id]; }, { ext: { drafts: { [it.id]: [before, null] } } }); persistDraftsSoon(); ED.drop(it.id); renderTree(); renderMain(); renderStatus(); renderSide(); toast(t('tookTheirs'), { ms: 10000, endsOnClose: true, action: { label: t('undoBtn'), fn: () => undoOwner(o.id) } }); };
    body.querySelector('[data-x="aside"]').onclick = () => {
      closeSheet(false); const before = clone(dr);
      if (it.kind === 'scripts') { // one script list per owner: the aside copy is stored as the previous list and can be restored
        const priorBefore = clone(S.priors[it.id]) || null, lists = Object.assign({}, clone(S.priors[it.id]) || {}, { aside: { mode: 'lua', draft: { text: before.text, baseRev: it.code.liveRev, whatIf: before.whatIf, checked: null }, at: Date.now() } });
        edit(o.id, stepLabel('stepAside', it), () => { delete S.drafts[it.id]; S.priors[it.id] = lists; }, { ext: { drafts: { [it.id]: [before, null] }, priors: { [it.id]: [priorBefore, clone(lists)] } } });
      } else {
        const nid2 = o.id + '.n' + (++S.seq); const copy = { id: nid2, kind: it.kind, name: { ko: nm(it.name) + I18N.ko.copySuffix, en: nm(it.name) + I18N.en.copySuffix }, on: true, f: {}, code: { live: '//@name new_plugin\n//@api 3.0\n', liveRev: 1 } }; const nd = { text: before.text, baseRev: 1, whatIf: before.whatIf, checked: null };
        edit(o.id, stepLabel('stepAside', it), () => { o.items.push(copy); delete S.drafts[it.id]; S.drafts[nid2] = nd; }, { ext: { drafts: { [it.id]: [before, null], [nid2]: [null, clone(nd)] } } });
      }
      persistDraftsSoon(); ED.drop(it.id); renderTree(); renderMain(); renderStatus(); renderSide(); toast(t('copiedAside'), { ms: 10000, endsOnClose: true, action: { label: t('undoBtn'), fn: () => undoOwner(o.id) } });
    };
    body.querySelector('[data-x="cancel"]').onclick = () => closeSheet(true);
  } });
}

/* item menus */
function openItemMenu(it, o, opener) {
  if (ownLocked(o.id)) return;   /* re-check R-4: nothing to move, switch or delete on a private character */
  const items = [];
  if (hasEnabled(it) && S.layout === 'phone') items.push(['circle-check', t('enabledMenu'), () => setEnabled(it, o, !it.on), '', { 'aria-checked': String(!!it.on) }]);
  items.push(['arrow-up', t('moveUp'), () => moveItem(it, o, -1), '']); items.push(['arrow-down', t('moveDown'), () => moveItem(it, o, 1), '']);
  if (isCode(it) && hasDraft(it.id)) items.push(['rotate-ccw', t('discardDraft'), () => discardDraft(it, o), '']);
  if (isCode(it) && S.prevLive[it.id]) items.push(['history', t('prevLive'), () => openPrevLive(it, o), '']);
  items.push(['trash-2', t('del'), () => deleteItem(it, o), 'danger']);
  openMenu(opener, t('more'), items);
}
function openPrevLive(it, o) {
  const pv = S.prevLive[it.id]; if (!pv) return; const before = clone(S.drafts[it.id]), nd = { text: pv.text, baseRev: it.code.liveRev, whatIf: false, checked: null };
  edit(o.id, stepLabel('stepEdit', it), () => { S.drafts[it.id] = nd; }, { ext: { drafts: { [it.id]: [before, clone(nd)] } } });
  persistDraftsSoon(); ED.drop(it.id); renderAll(); toast(t('prevLiveOpened'), {});
}

/* ------------------------------------------------------------------ side panel: Problems / Test / History */
const TABS = window.StudioTabs || ['problems', 'test', 'history'];   // slice 2 adds 'preview'
const visTabs = () => TABS.filter((n) => !$('#tab' + n[0].toUpperCase() + n.slice(1)).hidden);
function selectTab(name, focus) {
  S.sideTab = name;
  TABS.forEach((n) => { const tab = $('#tab' + n[0].toUpperCase() + n.slice(1)), pan = $('#panel' + n[0].toUpperCase() + n.slice(1)); const on = n === name; tab.setAttribute('aria-selected', String(on)); tab.tabIndex = on ? 0 : -1; pan.hidden = !on; });
  if (name === 'test') renderTest(); if (name === 'history') renderHistory(); if (ST.ext.onTab) ST.ext.onTab(name);
  if (S.layout === 'wide' && S.sideOff && focus) { S.sideOff = false; saveUi(); applyLayout(); }
  if (focus) $('#tab' + name[0].toUpperCase() + name.slice(1)).focus();
}
$('#sideTabs').addEventListener('click', (e) => { const b = e.target.closest('.stab'); if (b) selectTab(b.id.replace('tab', '').toLowerCase()); });
$('#sideTabs').addEventListener('keydown', (e) => {
  const vt = visTabs(), i = vt.indexOf(S.sideTab); let n = null;
  if (e.key === 'ArrowRight') n = (i + 1) % vt.length; else if (e.key === 'ArrowLeft') n = (i + vt.length - 1) % vt.length; else if (e.key === 'Home') n = 0; else if (e.key === 'End') n = vt.length - 1;
  if (n != null && e.target.closest('.stab')) { e.preventDefault(); selectTab(vt[n], true); }
});
function openSide(tab, opener) {
  if (tab) S.sideTab = tab;
  if (S.layout === 'wide') { S.sideOff = false; saveUi(); applyLayout(); selectTab(S.sideTab, true); return; }
  if (!S.sideOpen) { S.sideOpen = true; S.sideOpener = opener || document.activeElement; S.sideOpenerKey = S.sideOpener && S.sideOpener.dataset ? S.sideOpener.dataset.panel : null; const l = { kind: 'side', close: () => closeSide() }; S.sideLayer = l; pushLayer(l); }
  applyLayout(); $('#side').classList.add('open'); $('#sideBackdrop').classList.add('open'); selectTab(S.sideTab, false);
  setTimeout(() => { if (S.sideOpen) $('#tab' + S.sideTab[0].toUpperCase() + S.sideTab.slice(1)).focus(); }, 30);
}
function closeSide(silent) {
  if (!S.sideOpen) return; S.sideOpen = false; if (S.sideLayer) { dropLayer(S.sideLayer); S.sideLayer = null; }
  $('#side').classList.remove('open'); $('#sideBackdrop').classList.remove('open'); applyLayout();
  if (!silent) { const o = S.sideOpener; if (o && o.isConnected) o.focus({ preventScroll: true }); else { const b = $('#itemHead [data-panel="' + (S.sideOpenerKey || S.sideTab) + '"]') || $('#itemHead [data-panel]'); if (b) b.focus(); } }
}
$('#sideClose').addEventListener('click', () => closeSide());
$('#sideBackdrop').addEventListener('click', () => closeSide());
$('#sideToggle').addEventListener('click', () => { S.sideOff = !S.sideOff; saveUi(); applyLayout(); ED.resize(); });

function allProblems() {
  const out = [];
  contextOwners().forEach((o) => o.items.forEach((it) => { if (isCode(it)) { const n = S.codeProb[it.id]; if (n) out.push({ o, it, sev: 'warning', msg: t('problemsN', { n }), field: null, code: true }); } else itemProblems(it).forEach((p) => out.push({ o, it, sev: p.sev, msg: p.msg, field: p.field, pos: p.pos, card: p.card })); }));
  return out;
}
function refreshProblemsOnly() { renderProblemsForm(); updateCounts(); }
function renderProblemsForm() {
  const f = S.open && findItem(S.open), code = f && isCode(f.it);
  $('#probForm').hidden = !!code; $('#probCode').hidden = !code; if (code) return;
  const list = allProblems(); const host = $('#probForm');
  host.innerHTML = '<div class="panel-head"><h2 class="panel-title">' + esc(t('tabProblems')) + '</h2><span class="hint">' + esc(t('probFormHint')) + '</span></div>' +
    (list.length ? list.map((p, i) => '<button type="button" class="form-prob ' + (p.sev === 'warning' ? 'warn' : '') + '" data-part="studio-problem" data-severity="' + p.sev + '" data-i="' + i + '">' + ic('triangle-alert', 16) + '<span><span>' + esc(shownName(p.it, p.o) || kindName(p.it.kind)) + '</span><span class="sub">' + esc(p.msg) + ' · ' + esc(nm(p.o.name)) + '</span></span></button>').join('') : '<p class="prob-empty" data-part="studio-problems-empty"><span class="cnt-none">' + ic('circle-check', 16) + ' ' + esc(t('probNone')) + '</span></p>');
  host.onclick = (e) => { const b = e.target.closest('.form-prob'); if (!b) return; const p = list[Number(b.dataset.i)]; if (!p) return; if (S.sideOpen) closeSide(true); openItem(p.it.id, { focus: false }); const el = p.field ? $('#formHost [data-f="' + p.field + '"]') : null; (el || $('#itemHead')).focus(); if (el && p.pos != null && ST.ext.gotoPos) ST.ext.gotoPos(el, p.pos, p.card); };
}
function refreshPanelBadge() {
  const b = $('#itemHead [data-panel]'); if (!b) return; const f = S.open && findItem(S.open); const n = f ? probCount(f.it) : 0;
  const tmp = document.createElement('div'); tmp.innerHTML = panelOpeners(); const nb = tmp.firstElementChild; if (!nb) return;
  if (b.innerHTML !== nb.innerHTML) { b.innerHTML = nb.innerHTML; b.setAttribute('aria-label', nb.getAttribute('aria-label')); }
}
function updateCounts() { refreshPanelBadge();
  const f = S.open && findItem(S.open), code = f && isCode(f.it); const n = code ? (S.codeProb[f.it.id] || 0) : allProblems().length; const hasErr = code ? false : allProblems().some((p) => p.sev === 'error');
  const cnt = $('#cntProblems'); cnt.textContent = n ? String(n) : ''; cnt.classList.toggle('err', hasErr);
}
function renderSide() { if (ST.ext.beforeSide) ST.ext.beforeSide(); renderProblemsForm(); updateCounts(); renderHistory(); renderTest(); selectTabNoRender(); if (ST.ext.afterSide) ST.ext.afterSide(); }
function selectTabNoRender() { TABS.forEach((n) => { const tab = $('#tab' + n[0].toUpperCase() + n.slice(1)), pan = $('#panel' + n[0].toUpperCase() + n.slice(1)); const on = n === S.sideTab; tab.setAttribute('aria-selected', String(on)); tab.tabIndex = on ? 0 : -1; pan.hidden = !on; }); }

/* ---- test frame (SLICE1_SPEC section 7): input, run, result with its basis, scope line */
function testMode() { const f = S.open && findItem(S.open); if (!f) return 'none'; if (ownHidden(f.o.id)) return 'ph'; if (isCode(f.it)) return 'code'; if (S.tf) return 'cbs'; return 'ph'; }
function toggleDefs() { const m = []; mergeOrder('toggles').forEach((o) => itemsOf(o, 'toggles').forEach((it) => String(it.f.defs || '').split('\n').forEach((ln) => { const p = ln.split('='); if (p[0].trim()) m.push({ key: p[0].trim(), label: (p[1] || p[0]).trim(), owner: o }); }))); return m; }
function cbsField() { const f = S.open && findItem(S.open); if (!f || !S.tf || ownHidden(f.o.id)) return null; return { it: f.it, o: f.o, text: String(f.it.f[S.tf.f] || '') }; }
function toggleKeysIn(text) { const ks = []; (text.match(/toggle_([A-Za-z0-9_]+)/g) || []).forEach((m) => { const k = m.slice(7); if (!ks.includes(k)) ks.push(k); }); return ks; }
function cbsSig() { const c = cbsField(); if (!c) return ''; const ks = toggleKeysIn(c.text); return hash(c.text + '|' + ks.map((k) => k + '=' + (S.tv[k] ? 1 : 0)).join() + '|' + $('#tMsg').value); }
function runCbs() {
  if (ST.ext.cbsRun) { ST.ext.cbsRun(); return; }   // slice 3: the sandboxed preview
  const c = cbsField(); if (!c) return; const vars = {}; toggleKeysIn(c.text).forEach((k) => { vars['toggle_' + k] = S.tv[k] ? '1' : '0'; });
  const msg = $('#tMsg').value; let src = c.text.replace(/\{\{(lastusermessage|previoususerchat)\}\}/gi, msg).replace(/\{\{char\}\}/gi, nm(ctxChar().name)).replace(/\{\{user\}\}/gi, S.lang === 'ko' ? '나' : 'me');
  let out; try { out = SL.simRun(src.replace(/^@@.*\n?/gm, '').replace(/\{\{getglobalvar::/g, '{{getvar::'), { vars }); } catch (e) { out = '[simulator error] ' + e.message; }
  S.tr = { sig: cbsSig(), at: Date.now(), out, basis: 'live' }; renderTest(); announce(t('testResult', { when: t('testWhenNow'), basis: t('testBasisLive') }));
}
function renderCbsMeta() {
  if (ST.ext.cbsRender) { ST.ext.cbsRender(cbsField()); return; }   // slice 3: values, writes and the rendered result
  const meta = $('#test-meta'), out = $('#preview-out'); const tr = S.tr;
  if (!tr) { meta.className = 'test-meta'; meta.textContent = t('testNever'); out.className = 'preview-out'; out.textContent = ''; $('#sim-note').textContent = t('cbsNote'); return; }
  const cur = tr.sig === cbsSig(); const age = Math.round((Date.now() - tr.at) / 1000);
  const when = age < 15 ? t('testWhenNow') : age < 90 ? t('testWhenS', { n: age }) : t('testWhenM', { n: Math.round(age / 60) });
  meta.className = 'test-meta ' + (cur ? 'current' : 'stale'); meta.textContent = cur ? t('testResult', { when, basis: tr.basis === 'draft' ? t('testBasisDraft') : t('testBasisLive') }) : t('testStaleLong');
  out.className = 'preview-out' + (cur ? '' : ' stale'); out.textContent = tr.out === '' ? t('cbsOut') : tr.out; $('#sim-note').textContent = t('cbsNote');
}
function refreshCbsMeta() { if (testMode() === 'cbs') renderCbsMeta(); }
function renderTest() {
  const mode = testMode(); const f = S.open && findItem(S.open);
  const show = (sel, on) => { const e = $(sel); if (e) e.hidden = !on; };
  show('#tIn', mode === 'cbs'); show('#tSw', mode === 'cbs'); show('#tPlaceholder', mode === 'ph' || mode === 'none');
  show('#preview-out', mode === 'cbs' || mode === 'code'); show('#test-meta', mode === 'cbs' || mode === 'code'); show('.tact', mode === 'cbs' || mode === 'code'); show('#sim-note', mode === 'cbs' || mode === 'code');
  $('#btn-stop-test').hidden = mode !== 'code'; $('#test-scope').hidden = mode === 'none' || mode === 'ph';
  if (mode !== 'code') { $('#lowlevel-wrap').hidden = true; $('#var-grid').hidden = true; $('#test-stack').hidden = true; }
  if (mode === 'code') { ED.refreshTest(); return; }
  $('#sim-title').textContent = t('testHdr'); $('#sim-sub').textContent = mode === 'cbs' ? 'CBS' : '';
  if (mode === 'cbs') {
    const c = cbsField(); $('#test-scope').textContent = t('testScopeCbs', { f: nm(c.o.name) + ' › ' + (S.tf.label || '') });
    const ks = toggleKeysIn(c.text), defs = toggleDefs(); const sw = $('#tSw');
    sw.innerHTML = '<div class="t">' + esc(ks.length ? t('testToggles') : t('testNoToggles')) + '</div>' + ks.map((k) => { const d = defs.find((x) => x.key === k); return '<label class="sw"><input type="checkbox" data-tk="' + esc(k) + '"' + (S.tv[k] ? ' checked' : '') + '><span class="sw-ui"></span><span class="lbl">' + esc(d ? d.label : k) + ' <small class="hint">' + esc(k) + '</small></span></label>'; }).join('');
    renderCbsMeta();
  } else {
    const k = f ? f.it.kind : null; $('#tPlaceholder').textContent = k === 'regex' ? t('phRegex') : k === 'lore' ? t('phLore') : k === 'scripts' ? t('phTrigger') : k === 'toggles' ? t('phToggles') : t('phNone');
  }
}
$('#tSw').addEventListener('change', (e) => { const k = e.target.dataset && e.target.dataset.tk; if (!k) return; S.tv[k] = e.target.checked; refreshCbsMeta(); });
$('#tMsg').addEventListener('input', refreshCbsMeta);

/* ================================================================== D. sheets, menus, toast, search, origin, shortcuts, demo controls, states, init */
const Sh = { open: false, opener: null, layer: null };
/* DD-200 (THEMING.md rules 2 and 3, DD-149): the parts of the one shared sheet. Menus and ordinary dialogs wear studio-sheet-*. A critical sheet (o.critical: it drops or replaces data, or the slice 4 questions) carries data-part-critical and PROTECTED child parts (studio-critical-*): a pack may give them tokens only. An element that already has a part (slice 4 writes its own) keeps it. */
const SHEET_PARTS = { open: { sheet: 'studio-sheet', header: 'studio-sheet-header', handle: 'studio-sheet-handle', title: 'studio-sheet-title', body: 'studio-sheet-body', text: 'studio-sheet-text', actions: 'studio-sheet-actions', item: 'studio-sheet-item', button: 'studio-sheet-button' },
  crit: { sheet: 'studio-critical-sheet', header: 'studio-critical-header', handle: 'studio-critical-handle', title: 'studio-critical-title', body: 'studio-critical-content', text: 'studio-critical-body', actions: 'studio-critical-actions', item: 'studio-critical-action', button: 'studio-critical-action' } };
function sheetParts(crit, kind, inner) {
  const sh = $('#sheet'), P = SHEET_PARTS[crit ? 'crit' : 'open'], body = $('#sheetBody'); toastSuspend(crit); const set = (el, p) => { if (!el) return; const cur = el.getAttribute('data-part'); if (!cur || cur.startsWith('studio-sheet-')) el.setAttribute('data-part', p); };   // an ordinary sheet part is replaced when the sheet turns critical; a part slice 4 wrote itself stays
  if (!inner) {   // the outer parts: set on every open (slice 4 sets its own after this call and keeps them)
    sh.setAttribute('data-part', P.sheet); if (crit) sh.setAttribute('data-part-critical', ''); else sh.removeAttribute('data-part-critical');
    if (kind) sh.setAttribute('data-kind', kind); else sh.removeAttribute('data-kind');
    $('#sheetTitle').setAttribute('data-part', P.title);
    const d0 = crit ? $('.txt', body) : null; if (d0) { d0.id = 'sheetDesc'; sh.setAttribute('aria-describedby', 'sheetDesc'); } else sh.removeAttribute('aria-describedby');
  }
  const put = (el, p) => { if (el) el.setAttribute('data-part', p); };
  put($('.grab', sh), P.header); put($('.grab i', sh), P.handle); put(body, P.body);
  $$('.txt, .sum, .diffbox, .kbd-table', body).forEach((e) => set(e, P.text));
  $$('.confirm-row, .cf-acts', body).forEach((e) => set(e, P.actions));
  $$('.btn', body).forEach((b) => set(b, b.classList.contains('item') ? P.item : P.button));
  if (crit) $$('label.sw', body).forEach((e) => set(e, P.item));   // the restore choices ("skip this one") are choices of the question
}
function openSheet(o) {
  const rt = $('#sheetRoot'), sh = $('#sheet'); Sh.opener = o.opener || document.activeElement; Sh.open = true;
  if (Sh.layer) dropLayer(Sh.layer);
  sh.className = 'sheet ' + (o.cls || '') + (o.menu ? ' menu' : ''); sh.setAttribute('aria-label', o.title); $('#sheetTitle').textContent = o.title;
  if (o.menu) { sh.setAttribute('role', 'presentation'); sh.removeAttribute('aria-modal'); } else { sh.setAttribute('role', 'dialog'); sh.setAttribute('aria-modal', 'true'); }
  const body = $('#sheetBody'); body.replaceChildren(); body.setAttribute('role', o.menu ? 'menu' : 'group'); body.setAttribute('aria-labelledby', 'sheetTitle'); o.build(body); sheetParts(!!o.critical, o.kind || (o.menu ? 'menu' : 'dialog'));
  rt.hidden = false; sh.style.removeProperty('--ax'); sh.style.removeProperty('--ay'); void rt.offsetWidth; rt.classList.add('open');
  Sh.layer = { kind: 'sheet', close: () => closeSheet(true) }; pushLayer(Sh.layer);
  if (S.layout !== 'phone' && o.menu && Sh.opener && Sh.opener.getBoundingClientRect) { const r = Sh.opener.getBoundingClientRect(), w = 300; let x = Math.max(8, Math.min(innerWidth - w - 8, r.right - w)), y = r.bottom + 4; if (y + 260 > innerHeight) y = Math.max(8, r.top - 4 - Math.min(sh.offsetHeight || 240, innerHeight - 16)); sh.style.setProperty('--ax', x + 'px'); sh.style.setProperty('--ay', y + 'px'); }
  setTimeout(() => { if (Sh.open) { const f = $('[data-autofocus]', body) || $('.item:not([aria-disabled="true"]), input, button', body) || sh; f.focus({ preventScroll: true }); } }, 0);
}
function closeSheet(restore) {
  if (!Sh.open) return; Sh.open = false; toastSuspend(false); const rt = $('#sheetRoot'); rt.classList.remove('open');
  if (Sh.layer) { dropLayer(Sh.layer); Sh.layer = null; }
  setTimeout(() => { if (!Sh.open) rt.hidden = true; }, 220);
  if (restore !== false) { const o = Sh.opener; if (o && o.isConnected) o.focus({ preventScroll: true }); else (S.layout === 'phone' && S.phone === 'tree' ? $('#backBtn') : $('#moreBtn')).focus(); }
}
$('#sheetBackdrop').addEventListener('click', () => closeSheet(true));
$('#sheet').addEventListener('keydown', (e) => {
  const sh = $('#sheet');
  if (e.key === 'Tab') { const f = $$('button:not([aria-disabled="true"]):not(:disabled), input, [tabindex="0"]', sh).filter((x) => x.offsetParent !== null); if (!f.length) return; const first = f[0], last = f[f.length - 1]; if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); } return; }
  if (sh.classList.contains('menu') && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) { const items = $$('.item:not([aria-disabled="true"])', sh); const i = items.indexOf(document.activeElement); let n = e.key === 'ArrowDown' ? (i + 1) % items.length : e.key === 'ArrowUp' ? (i - 1 + items.length) % items.length : e.key === 'Home' ? 0 : items.length - 1; e.preventDefault(); items[n].focus(); }
});
function itemBtn(icon, label, fn, cls, attrs) {
  const b = document.createElement('button'); b.type = 'button'; b.className = 'btn item ' + (cls || ''); b.innerHTML = ic(icon, 20) + '<span>' + esc(label) + '</span>';
  Object.keys(attrs || {}).forEach((k) => b.setAttribute(k, attrs[k])); b.addEventListener('click', () => { if (b.getAttribute('aria-disabled') === 'true') return; fn(b); }); return b;
}
function openMenu(opener, title, items) {
  openSheet({ title, opener, menu: true, build(body) { items.forEach(([icon, label, fn, cls, attrs]) => { const b = itemBtn(icon, label, () => { closeSheet(false); fn(); }, cls, Object.assign({ role: attrs && attrs['aria-checked'] != null ? 'menuitemcheckbox' : 'menuitem' }, attrs || {})); body.appendChild(b); }); } });
}
/* DD-200: a toast with an action is the Undo of a change (delete, discard, apply, reload): critical, with its own child parts. A plain toast is a safe leaf. */
function toastParts(el, o) { const u = !!(o && o.action); el.setAttribute('data-part', u ? 'studio-undo-toast' : 'studio-toast'); if (u) el.setAttribute('data-part-critical', ''); }
function toast(msg, o) {
  o = o || {}; const box = $('#toast'); const el = document.createElement('div'); el.className = 't'; toastParts(el, o);
  el.innerHTML = '<span data-part="' + (o.action ? 'studio-undo-toast-text' : 'studio-toast-text') + '">' + esc(o.endsOnClose ? msg + ' ' + t('undoEndsClose') : msg) + '</span>' + (o.action ? '<button type="button" class="btn toast-act" data-part="studio-undo-toast-action">' + esc(o.action.label) + '</button>' : '');
  box.appendChild(el); while (box.children.length > 3) box.firstElementChild.remove(); box.classList.add('show');
  let tm; const drop = () => { clearTimeout(tm); el.remove(); if (!box.children.length) box.classList.remove('show'); }; const arm = () => { clearTimeout(tm); if (box.hasAttribute('data-suspended')) return; tm = setTimeout(drop, o.ms || 3200); }; el._pause = () => clearTimeout(tm); el._resume = arm;
  el.addEventListener('mouseenter', () => clearTimeout(tm)); el.addEventListener('mouseleave', arm); el.addEventListener('focusin', () => clearTimeout(tm)); el.addEventListener('focusout', arm); arm();
  if (o.action) el.querySelector('.toast-act').onclick = () => { drop(); o.action.fn(); };
}
/* DD-244 (M1): while a protected sheet is open the Undo toast is hidden and its timers are paused (it sat on the sheet's buttons on a phone); it comes back, with a fresh timer, when the sheet closes. */
function toastSuspend(on) { const box = $('#toast'); if (!box) return; box.toggleAttribute('data-suspended', !!on); $$('.t', box).forEach((e) => { if (on) { if (e._pause) e._pause(); } else if (e._resume) e._resume(); }); }
function hideToast() { const b = $('#toast'); b.replaceChildren(); b.classList.remove('show'); }
/* DD-196: the app-wide toast, for a result that arrives after Studio closed (an import that finished). A mockup of the host app's own toast: it sits outside #studio, so it shows on the origin screen. */
function appToast(msg, o) {
  const box = $('#appToast'); if (!box) { toast(msg, o); return; } o = o || {}; const el = document.createElement('div'); el.className = 't'; toastParts(el, o);
  el.innerHTML = '<span data-part="' + (o.action ? 'studio-undo-toast-text' : 'studio-toast-text') + '">' + esc(o.endsOnClose ? msg + ' ' + t('undoEndsClose') : msg) + '</span>' + (o.action ? '<button type="button" class="btn toast-act" data-part="studio-undo-toast-action">' + esc(o.action.label) + '</button>' : '');
  box.appendChild(el); while (box.children.length > 3) box.firstElementChild.remove(); box.classList.add('show');
  let tm; const drop = () => { clearTimeout(tm); el.remove(); if (!box.children.length) box.classList.remove('show'); }; const arm = () => { clearTimeout(tm); tm = setTimeout(drop, o.ms || 7000); };
  el.addEventListener('mouseenter', () => clearTimeout(tm)); el.addEventListener('mouseleave', arm); el.addEventListener('focusin', () => clearTimeout(tm)); el.addEventListener('focusout', arm); arm();
  if (o.action) el.querySelector('.toast-act').onclick = () => { drop(); o.action.fn(); };
}   /* the box is role=status: it announces its own text once (re-check R-5) */

/* ---- restore point (DD-095) */
function openRestore(opener) {
  const o = currentOwner(); if (!o) { toast(t('restoreNone'), {}); return; }
  const d = diffOwner(o.id); const none = !d || d.total === 0;
  const prot = d ? d.changed.filter((i) => S.peerLog[o.id] && S.peerLog[o.id].has(i.id)) : [];
  openSheet({ title: t('restoreTitle'), opener, cls: 'dlg', critical: true, kind: 'restore', build(body) {
    body.innerHTML = '<p class="txt">' + esc(none ? t('restoreNone') : t('restoreBody', { o: nm(o.name) })) + '</p>' + (none ? '' :
      '<ul class="sum">' + Object.keys(d.per).map((k) => '<li>' + ic(KIND_ICON[k], 16) + '<span class="k">' + esc(kindName(k)) + '</span><span>' + [d.per[k].changed ? t('changedN', { n: d.per[k].changed }) : '', d.per[k].added ? t('addedN', { n: d.per[k].added }) : '', d.per[k].removed ? t('removedN', { n: d.per[k].removed }) : ''].filter(Boolean).join(' · ') + '</span></li>').join('') + '</ul>' +
      '<ul class="sum" aria-label="items">' + d.changed.concat(d.added).slice(0, 8).map((i) => '<li>' + ic(KIND_ICON[i.kind], 14) + '<span>' + esc(nm(i.name)) + '</span></li>').join('') + d.removed.slice(0, 4).map((i) => '<li>' + ic('trash-2', 14) + '<span>' + esc(nm(i.name)) + '</span></li>').join('') + '</ul>' +
      (prot.length ? '<p class="txt warn">' + ic('triangle-alert', 14) + ' ' + esc(t('restoreElsewhere')) + '</p>' + prot.map((i) => '<label class="sw"><input type="checkbox" checked data-pid="' + esc(i.id) + '"><span class="sw-ui"></span><span class="lbl">' + esc(t('restoreSkip')) + ': ' + esc(nm(i.name) || kindName(i.kind)) + '</span></label>').join('') : '')) +
      '<div class="confirm-row"><button type="button" class="btn" data-x="cancel" data-autofocus="1">' + ic('x', 18) + '<span>' + esc(t('cancel')) + '</span></button>' + (none ? '' : '<button type="button" class="btn primary" data-x="ok">' + ic('rotate-ccw', 18) + '<span>' + esc(t('restoreDo')) + '</span></button>') + '</div>';
    body.querySelector('[data-x="cancel"]').onclick = () => closeSheet(true);
    const ok = body.querySelector('[data-x="ok"]'); if (ok) ok.onclick = () => { const inc = new Set($$('input[data-pid]', body).filter((x) => !x.checked).map((x) => x.dataset.pid)); closeSheet(false); revertTo(o.id, 0, { include: inc }); };
  } });
}
function openHelp(opener) {
  openSheet({ title: t('helpTitle'), opener, cls: 'dlg tall', build(body) { body.innerHTML = '<dl class="kbd-table">' + t('hKeys').map(([k, d]) => '<dt><kbd>' + esc(k) + '</kbd></dt><dd>' + esc(d) + '</dd>').join('') + '</dl><div class="confirm-row"><button type="button" class="btn" data-x="close" data-autofocus="1">' + ic('x', 18) + '<span>' + esc(t('cancel')) + '</span></button></div>'; body.querySelector('[data-x="close"]').onclick = () => closeSheet(true); } });
}
function openMore(opener) {
  const o = currentOwner(), f = S.open && findItem(S.open); const items = [];
  if (S.layout === 'phone') { // F-11: the phone header has no room for undo/redo, so they live here, named
    const u = $('#undoBtn'), r = $('#redoBtn');
    items.push(['undo-2', u.getAttribute('aria-label'), () => doUndo(), '', { 'aria-disabled': u.getAttribute('aria-disabled') }]); items.push(['redo-2', r.getAttribute('aria-label'), () => doRedo(), '', { 'aria-disabled': r.getAttribute('aria-disabled') }]);
  }
  items.push(['rotate-ccw', t('restorePoint'), () => openRestore($('#moreBtn')), '']);
  items.push(['history', t('history'), () => openSide('history', $('#moreBtn')), '']);
  if (f && isCode(f.it) && hasDraft(f.it.id)) items.push(['file-pen', t('discardDraft'), () => discardDraft(f.it, f.o), '']);
  items.push(['keyboard', t('help'), () => openHelp($('#moreBtn')), '']);
  items.push(['sliders', t('demo'), () => revealDemo(), '']);
  openMenu(opener, t('more'), items);
}
$('#moreBtn').addEventListener('click', (e) => openMore(e.currentTarget));
$('#treeMenuBtn').addEventListener('click', (e) => openMenu(e.currentTarget, t('treeOptions'), [
  ['circle-check', t('hideEmpty'), () => { S.hideEmpty = !S.hideEmpty; saveUi(); renderTree(); }, '', { 'aria-checked': String(S.hideEmpty) }],
  ['chevron-up', t('collapseAll'), () => { S.exp = new Set(); saveUi(); renderTree(); focusRow(S.rows[0].id); }, ''],
  ['chevron-down', t('expandAll'), () => { ownerList().forEach((o) => { if (SUPPORT[o.type]) { if (o.type === 'char' && o.other) return; S.exp.add('o:' + o.id); } }); ['s:modules', 's:presets', 's:plugins', 'g:mods', 'g:presets'].forEach((x) => S.exp.add(x)); saveUi(); renderTree(); }, '']
]));
function revealDemo() { if (S.layout === 'phone' && S.phone === 'detail') { S.phone = 'tree'; applyLayoutAttrs(); } if (S.layout === 'mid' && !S.drawer) openDrawer(); const d = $('#demo'); d.open = true; d.scrollIntoView({ block: 'nearest' }); $('#demoSum').focus(); }
$('#backBtn').addEventListener('click', () => backPress());

/* ---- new module: name first, nothing stored until named (fixes today's ghost module) */
function openNewModule(opener) {
  openSheet({ title: t('modTitle'), opener, cls: 'dlg', build(body) {
    body.innerHTML = '<p class="txt">' + esc(t('modNothing')) + '</p><div class="fld fld-sheet"><label for="modName">' + esc(t('modNameLbl')) + '</label><input type="text" id="modName" autocomplete="off" data-autofocus="1" aria-describedby="modErr"></div><div class="err" id="modErr" role="alert" data-part="studio-field-note" data-kind="error"></div>' +
      '<div class="confirm-row"><button type="button" class="btn" data-x="cancel">' + ic('x', 18) + '<span>' + esc(t('cancel')) + '</span></button><button type="button" class="btn primary" data-x="ok" aria-disabled="true">' + ic('plus', 18) + '<span>' + esc(t('modCreate')) + '</span></button></div>';
    const inp = body.querySelector('#modName'), ok = body.querySelector('[data-x="ok"]'), err = body.querySelector('#modErr');
    const sync = () => { const v = inp.value.trim(); ok.setAttribute('aria-disabled', String(!v)); if (v) err.textContent = ''; };
    const create = () => {
      const v = inp.value.trim(); if (!v) { err.textContent = t('modNameFirst'); inp.setAttribute('aria-invalid', 'true'); inp.focus(); return; }
      if (ownerList().some((x) => x.type === 'module' && nm(x.name).toLowerCase() === v.toLowerCase())) { err.textContent = t('modExists'); inp.focus(); return; }
      closeSheet(false); const id = 'mx' + (++S.seq); const o = { id, type: 'module', name: v, scope: S.ctx.chat ? 'chat' : 'all', active: true, items: [] }; S.db.owners[id] = o; S.db.order.push(id); S.extra.push(id);
      S.exp.add('s:modules'); S.exp.add('o:' + id); saveUi(); touchSave(); S.view = { type: 'owner', ownerId: id }; S.open = null; S.sel = 'o:' + id; if (S.layout === 'phone') S.phone = 'detail'; renderAll(); focusRow('o:' + id, true);
      toast(t('modCreated', { name: v }), { ms: 5000, action: { label: t('undoBtn'), fn: () => { delete S.db.owners[id]; S.db.order = S.db.order.filter((x) => x !== id); S.extra = S.extra.filter((x) => x !== id); if (S.view.ownerId === id) { S.view = { type: 'none' }; if (S.layout === 'phone') S.phone = 'tree'; } touchSave(); renderAll(); } } });
    };
    inp.addEventListener('input', sync); inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); create(); } });
    ok.addEventListener('click', create); body.querySelector('[data-x="cancel"]').onclick = () => closeSheet(true);
  } });
}

/* ------------------------------------------------------------------ search everywhere (SPEC section 4) */
const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const cho = (ch) => { const n = ch.charCodeAt(0); return n >= 0xAC00 && n <= 0xD7A3 ? CHO[Math.floor((n - 0xAC00) / 588)] : ch; };
const isJamo = (c) => /[ㄱ-ㅎ]/.test(c);
const wordStart = (a, i) => i === 0 || !/[\p{L}\p{N}]/u.test(a[i - 1]);
/* TOGGLES_SPEC section 6 initial-consonant rule: two or more jamo match anywhere, ONE jamo only at the start of a word */
function hm(text, q) {
  const a = [...String(text).toLowerCase()], b = [...String(q).toLowerCase().trim()]; if (!b.length) return null;
  const only = b.every(isJamo), single = only && b.length === 1;
  for (let i = 0; i + b.length <= a.length; i++) {
    if (single && !wordStart(a, i)) continue; let ok = true;
    for (let j = 0; j < b.length; j++) { if (a[i + j] === b[j]) continue; if (isJamo(b[j]) && cho(a[i + j]) === b[j]) continue; ok = false; break; }
    if (ok) { let s = 0; for (let k = 0; k < i; k++) s += a[k].length; let l = 0; for (let k = 0; k < b.length; k++) l += a[i + k].length; return [s, s + l]; }
  }
  return null;
}
const SK = { regex: ['regex'], lore: ['lore'], toggles: ['toggles'], scripts: ['scripts', 'plugin'], basic: ['basic'] };
/* DD-101: the default scope is the context plus off modules and other presets (tagged 꺼짐); the switch only adds other characters; low power keeps the switch but searches those by name only */
const isOffOwner = (x) => (x.type === 'module' && !moduleActive(x)) || (x.type === 'preset' && !x.active);
function searchOwners() { const l = contextOwners().slice(); ownerList().filter(isOffOwner).forEach((x) => l.push(x)); if (S.search.wide) ownerList().filter((x) => (x.type === 'char' || x.type === 'group') && x.id !== S.ctx.char).forEach((x) => l.push(x)); return l; }   /* DD-185: groups beside characters */
function searchFields(it, o) {
  if (ST.ext.searchFields) { const ex = ST.ext.searchFields(it, o); if (ex) return ex; }   // slice 4: one entry per field of a character or group form, empty ones included (they carry synonyms)
  const f = it.f || {}; const L = (k) => t(k);
  if (isCode(it)) return [{ k: 'code', label: kindName(it.kind), text: hasDraft(it.id) ? S.drafts[it.id].text : it.code.live }];
  if (it.kind === 'scripts') return [{ k: 'rules', label: t('fRules'), text: f.rules || '' }];
  if (it.kind === 'lore') return [{ k: 'keys', label: L('fKeys'), text: f.keys || '' }, { k: 'content', label: L('fContent'), text: f.content || '' }];
  if (it.kind === 'regex') return [{ k: 'find', label: L('fFind'), text: f.find || '' }, { k: 'replace', label: L('fReplace'), text: f.replace || '' }];
  if (it.kind === 'toggles') return [{ k: 'defs', label: L('fToggleDefs'), text: f.defs || '' }];
  if (it.kind === 'basic') return [{ k: 'name', label: L('fName'), text: f.name || '' }, { k: 'description', label: L('fDesc'), text: f.description || '' }, { k: 'first', label: L('fFirst'), text: f.first || '' }];
  return [{ k: 'body', label: L('fBody'), text: f.body || '' }];
}
/* DD-104: the query is split into words; an item matches when every word matches somewhere in it (name, kind, a field), in any order; 초성 per word */
function qTokens(q) { return String(q || '').trim().split(/\s+/).filter(Boolean); }
function tokRanges(text, toks) { const out = []; toks.forEach((tk) => { const r = hm(text, tk); if (r) out.push(r); }); return out.sort((a, b) => a[0] - b[0]); }
function mergeRanges(rs) { const out = []; rs.slice().sort((a, b) => a[0] - b[0]).forEach((r) => { const l = out[out.length - 1]; if (l && r[0] <= l[1]) l[1] = Math.max(l[1], r[1]); else out.push([r[0], r[1]]); }); return out; }
function markedHtml(text, ranges) { let h = '', p = 0; mergeRanges(ranges).forEach((r) => { h += esc(text.slice(p, r[0])) + '<mark>' + esc(text.slice(r[0], r[1])) + '</mark>'; p = r[1]; }); return h + esc(text.slice(p)); }
function snippetOf(text, ranges) {
  ranges = mergeRanges(ranges); if (!ranges.length) return esc(text.slice(0, 70)); const one = (s) => s.replace(/\s+/g, ' ');
  const segs = []; ranges.forEach((r) => { const l = segs[segs.length - 1]; if (l && r[0] - l.e < 60) { l.rs.push(r); l.e = r[1]; } else segs.push({ s: r[0], e: r[1], rs: [r] }); });
  return segs.slice(0, 3).map((sg) => { const a = Math.max(0, sg.s - 28), b = Math.min(text.length, sg.e + 40); let h = a > 0 ? '…' : '', p = a; sg.rs.forEach((r) => { h += esc(one(text.slice(p, r[0]))) + '<mark>' + esc(one(text.slice(r[0], r[1]))) + '</mark>'; p = r[1]; }); return h + esc(one(text.slice(p, b))) + (b < text.length ? '…' : ''); }).join(' ');
}
function markName(name, q) { return markedHtml(name, q ? tokRanges(name, qTokens(q)) : []); }
function evalSearch(x, q, kinds, hits, ownerIdx) {
  const { o, it } = x; const toks = qTokens(q);
  if (!it) {
    if (!toks.length) return; const all = (txt) => toks.every((tk) => hm(txt, tk));
    const names = typeof o.name === 'object' ? [o.name.ko, o.name.en] : [o.name];
    if (!kinds && names.some(all)) hits.push({ type: 'owner', o, score: 0, idx: ownerIdx, label: nm(o.name) });
    SUPPORT[o.type].forEach((k) => { if (kinds && !kinds.includes(k)) return; if ([I18N.ko.kinds[k], I18N.en.kinds[k]].some(all)) hits.push({ type: 'kind', o, kind: k, score: 1, idx: ownerIdx, label: kindName(k) }); });
    return;
  }
  if (kinds && !kinds.includes(it.kind)) return;
  if (ownHidden(o.id) && it.kind !== 'basic') { if (!toks.length) hits.push({ type: 'name', o, it, score: 0, idx: ownerIdx, label: kindName(it.kind) }); return; }   /* DD-194: a hidden card's other items are not searched, by name or by content */
  const name = nm(it.name), other = typeof it.name === 'object' ? (S.lang === 'ko' ? it.name.en : it.name.ko) : '';
  if (!toks.length) { hits.push({ type: 'name', o, it, score: 0, idx: ownerIdx, label: name }); return; }
  const head = name + ' ' + other + ' ' + I18N.ko.kinds[it.kind] + ' ' + I18N.en.kinds[it.kind];
  const fields = S.lp && o.type === 'char' && o.id !== S.ctx.char ? [] : searchFields(it, o);   // low power: other characters by name only
  const inHead = toks.map((tk) => !!hm(head, tk)), inField = toks.map((tk) => fields.some((fd) => hm(fd.text, tk) || (fd.syn && hm(fd.syn, tk))));
  if (!toks.every((tk, i) => inHead[i] || inField[i])) return;   // every word, anywhere in the item, in any order
  if (inHead.every(Boolean)) hits.push({ type: 'name', o, it, score: 0, idx: ownerIdx, label: name, name: true });
  let n = 0, n2 = 0; fields.forEach((fd) => { const rs = tokRanges(fd.text, toks); if (rs.length) { if (n >= 2) return; n++; hits.push({ type: 'content', o, it, score: 2, idx: ownerIdx, label: name, field: fd, range: rs[0], snip: snippetOf(fd.text, rs) }); } else if (fd.syn && n2 < 6 && toks.some((tk) => hm(fd.label + ' ' + fd.syn, tk))) { n2++; hits.push({ type: 'content', o, it, score: 3, idx: ownerIdx, label: name, field: fd, range: [0, 0], snip: markedHtml(fd.label, tokRanges(fd.label, toks)) + (fd.empty ? ' · ' + esc(t('s4SearchEmptyTag')) : fd.tag ? ' · ' + esc(fd.tag) : '') }); } });
}
function openSearch(opener) {
  const sr = S.search; if ($('#searchRoot').hidden === false) return; sr.opener = opener || document.activeElement;
  $('#searchRoot').hidden = false; $('#searchWideBox').checked = sr.wide; $('#searchWideBox').disabled = false; $('#searchWide').style.opacity = ''; $('#searchWideHint').textContent = S.lp ? t('searchWideLow') : t('searchWideHint');
  renderChips2(); const l = { kind: 'search', close: () => closeSearch(true) }; sr.layer = l; pushLayer(l);
  $('#searchInput').value = sr.q || ''; runSearch(); setTimeout(() => $('#searchInput').focus(), 0);
}
function closeSearch(restore) {
  const sr = S.search; if ($('#searchRoot').hidden) return; sr.token++; $('#searchRoot').hidden = true; if (sr.layer) { dropLayer(sr.layer); sr.layer = null; }
  if (restore !== false) { const o = sr.opener; if (o && o.isConnected) o.focus({ preventScroll: true }); else $('#searchBtn').focus(); }
}
function renderChips2() {
  const sr = S.search, defs = [['all', t('chipAll')], ['regex', t('chipRegex')], ['lore', t('chipLore')], ['toggles', t('chipToggles')], ['scripts', t('chipScripts')], ['basic', t('chipBasic')]];
  $('#searchChips').innerHTML = defs.map(([k, l]) => '<button type="button" data-chip="' + k + '" aria-pressed="' + (k === 'all' ? sr.kinds.size === 0 : sr.kinds.has(k)) + '">' + (k !== 'all' ? ic(KIND_ICON[SK[k][0]], 14) : '') + '<span>' + esc(l) + '</span></button>').join('');
}
$('#searchChips').addEventListener('click', (e) => { const b = e.target.closest('[data-chip]'); if (!b) return; const sr = S.search, k = b.dataset.chip; if (k === 'all') sr.kinds.clear(); else if (sr.kinds.has(k)) sr.kinds.delete(k); else sr.kinds.add(k); renderChips2(); runSearch(); });
$('#searchWideBox').addEventListener('change', (e) => { S.search.wide = e.target.checked; runSearch(); });
$('#searchInput').addEventListener('input', () => { $('#searchClear').hidden = !$('#searchInput').value; clearTimeout(S.search.deb); S.search.deb = setTimeout(runSearch, 60); });
$('#searchClear').addEventListener('click', () => { $('#searchInput').value = ''; $('#searchClear').hidden = true; runSearch(); $('#searchInput').focus(); });
$('#searchClose').addEventListener('click', () => closeSearch(true));
$('#searchBackdrop').addEventListener('click', () => closeSearch(true));
$('#searchBtn').addEventListener('click', (e) => openSearch(e.currentTarget));
function runSearch() {
  const sr = S.search; const q = $('#searchInput').value.trim(); sr.q = q; sr.token++; const tok = sr.token; sr.active = 0;
  const kinds = sr.kinds.size ? [...sr.kinds].flatMap((c) => SK[c]) : null;
  $('#searchClear').hidden = !$('#searchInput').value;
  if (!q && !kinds) { sr.hits = []; sr.busy = false; renderResults(true); return; }
  const owners = searchOwners(), queue = []; owners.forEach((o, oi) => { queue.push({ o, oi }); o.items.forEach((it) => queue.push({ o, it, oi })); });
  const hits = []; let i = 0; const chunk = S.lp ? 8 : 16; sr.busy = true;
  const step = () => {
    if (tok !== sr.token) return; const end = Math.min(queue.length, i + chunk);
    for (; i < end; i++) evalSearch(queue[i], q, kinds, hits, queue[i].oi);
    sr.hits = hits.slice().sort((a, b) => a.idx - b.idx || a.score - b.score);
    if (i < queue.length) { renderResults(false); setTimeout(step, 0); } else { sr.busy = false; renderResults(true); }
  };
  step();
}
function renderResults(final) {
  const sr = S.search, host = $('#searchList'); const hits = sr.hits;
  if (!sr.q && !sr.kinds.size) { host.innerHTML = '<div class="s-none" data-part="studio-search-empty">' + ic('search', 22) + '<span>' + esc(t('searchEmpty')) + '</span></div>'; $('#searchCount').textContent = ''; $('#searchInput').removeAttribute('aria-activedescendant'); return; }
  if (!hits.length) { host.innerHTML = final ? '<div class="s-none" data-part="studio-search-empty">' + ic('search', 22) + '<strong>' + esc(t('searchNone')) + '</strong><button type="button" class="btn solid" id="searchNoneClear">' + ic('x', 16) + '<span>' + esc(t('clearSearch')) + '</span></button></div>' : '<div class="s-none" data-part="studio-search-empty">' + esc(t('searching')) + '</div>'; if (final) $('#searchCount').textContent = t('searchNone'); $('#searchInput').removeAttribute('aria-activedescendant'); const nb = $('#searchNoneClear'); if (nb) nb.onclick = () => { $('#searchInput').value = ''; sr.kinds.clear(); renderChips2(); runSearch(); $('#searchInput').focus(); }; return; }
  let html = '', lastO = null, n = 0;
  hits.forEach((h, i) => {
    if (!lastO || lastO !== h.o.id) { if (lastO) html += '</div>'; lastO = h.o.id; html += '<div role="group" aria-label="' + esc(nm(h.o.name) + (isOffOwner(h.o) ? ' · ' + t('offTag') : '')) + '"><div class="s-grp" data-part="studio-search-group" role="presentation">' + ic(ownerIcon(h.o), 14) + '<span>' + esc(nm(h.o.name)) + '</span>' + (isOffOwner(h.o) ? '<span class="tag off">' + esc(t('offTag')) + '</span>' : '') + '</div>'; }
    const icn = h.type === 'owner' ? ownerIcon(h.o) : h.type === 'kind' ? KIND_ICON[h.kind] : KIND_ICON[h.it.kind];
    const nmh = h.type === 'kind' ? markName(h.label, sr.q) : h.type === 'owner' ? markName(h.label, sr.q) : markName(h.label, sr.q);
    const sub = h.type === 'content' ? '<span class="sn"><b class="sn-field">' + esc(h.field.label) + '</b> ' + h.snip + '</span>' : h.type === 'name' && h.it ? '<span class="sn">' + esc(kindName(h.it.kind)) + '</span>' : h.type === 'kind' ? '<span class="sn">' + esc(t('searchHitKind')) + '</span>' : '';
    html += '<button type="button" class="s-res" data-part="studio-search-result" data-kind="' + h.type + '"' + (i === sr.active ? ' data-selected' : '') + ' role="option" id="sr-' + i + '" data-n="' + i + '" aria-selected="' + (i === sr.active) + '" tabindex="-1"><span class="kic">' + ic(icn, 18) + '</span><span class="tx"><span class="nm">' + nmh + '</span>' + sub + '</span>' + (isOffOwner(h.o) ? '<span class="tag off">' + esc(t('offTag')) + '</span>' : '') + '<span class="tag">' + esc(nm(h.o.name)) + '</span></button>';
    n++;
  });
  html += '</div>'; host.innerHTML = html;
  const cur = $('#sr-' + sr.active); if (cur) $('#searchInput').setAttribute('aria-activedescendant', 'sr-' + sr.active);
  if (final) $('#searchCount').textContent = t('searchCountScope', { n: hits.length, s: sr.wide ? t('scopeWide') : t('scopeCtx') });
}
$('#searchList').addEventListener('click', (e) => { const b = e.target.closest('.s-res'); if (b) openHit(S.search.hits[Number(b.dataset.n)]); });
$('#searchList').addEventListener('mousemove', (e) => { const b = e.target.closest('.s-res'); if (b) setActive(Number(b.dataset.n)); });
function setActive(i) { const sr = S.search; if (i === sr.active || !$('#sr-' + i)) return; const o = $('#sr-' + sr.active); if (o) o.setAttribute('aria-selected', 'false'); sr.active = i; const c = $('#sr-' + i); c.setAttribute('aria-selected', 'true'); c.scrollIntoView({ block: 'nearest' }); $('#searchInput').setAttribute('aria-activedescendant', 'sr-' + i); }
$('#searchInput').addEventListener('keydown', (e) => {
  const sr = S.search;
  if (e.key === 'ArrowDown') { e.preventDefault(); setActive(Math.min(sr.hits.length - 1, sr.active + 1)); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(Math.max(0, sr.active - 1)); }
  else if (e.key === 'Home' && e.ctrlKey) { e.preventDefault(); setActive(0); }
  else if (e.key === 'Enter') { e.preventDefault(); if (sr.hits[sr.active]) openHit(sr.hits[sr.active]); }
  else if (e.key === 'Tab') { const f = [$('#searchInput'), ...$$('#searchPanel button:not([hidden])'), ...$$('#searchPanel input:not(:disabled)')].filter((x, i, a) => a.indexOf(x) === i && x.offsetParent !== null && x.tabIndex >= 0); const i = f.indexOf(document.activeElement); const n = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : (i + 1) % f.length; e.preventDefault(); f[n].focus(); }
});
$('#searchPanel').addEventListener('keydown', (e) => { if (e.key !== 'Tab' || e.target.id === 'searchInput') return; const f = [$('#searchInput'), ...$$('#searchPanel button:not([hidden]):not(.s-res)'), ...$$('#searchPanel input:not(:disabled)')].filter((x, i, a) => a.indexOf(x) === i && x.offsetParent !== null); const i = f.indexOf(document.activeElement); const n = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : (i + 1) % f.length; e.preventDefault(); f[n].focus(); });
function openHit(h) {
  if (!h) return; closeSearch(false);
  if ((h.o.type === 'char' || h.o.type === 'group') && h.o.id !== S.ctx.char) { S.ctx = { char: h.o.id, chat: false }; S.exp = new Set(['s:modules', 's:presets', 's:plugins']); toast(t('ctxOtherChar', { c: nm(h.o.name) }), {}); }
  revealOwner(h.o);
  if (h.type === 'kind') { S.sel = 'k:' + h.o.id + ':' + h.kind; S.view = { type: 'kind', ownerId: h.o.id, kind: h.kind }; S.open = null; S.exp.add('k:' + h.o.id + ':' + h.kind); if (S.layout === 'phone') S.phone = 'detail'; renderAll(); focusRow(S.sel, true); return; }
  if (h.type === 'owner') { S.sel = 'o:' + h.o.id; S.view = { type: 'owner', ownerId: h.o.id }; S.open = null; if (S.layout === 'phone') S.phone = 'detail'; renderAll(); focusRow(S.sel, true); return; }
  openItem(h.it.id, { focus: false, user: true });
  if (ST.ext.openHit && ST.ext.openHit(h)) { announce(t('hitSelected')); return; }   // slice 4: reveal and focus the field by its catalogue key
  if (h.type === 'content') {
    if (isCode(h.it)) { ED.selectRange(h.range[0], h.range[1]); }
    else { const el = $('#formHost [data-f="' + h.field.k + '"]'); if (el) { el.focus(); el.setSelectionRange(h.range[0], h.range[1]); } }
    announce(t('hitSelected'));
  } else { const nameEl = $('#formHost [data-f="iname"]') || $('#formHost [data-f="name"]'); (nameEl || $('#itemHead')).focus(); }
}

/* ------------------------------------------------------------------ Back (DD-040), origin stub, entry points */
function backPress() {
  if (!S.inStudio) return 'origin';
  if (closeTopLayer()) return 'layer';
  // DD-098: entered straight into a detail (chat, library, settings): Back goes to where Studio was opened; the list is one tap away on the title
  if (S.layout === 'phone' && S.phone === 'detail' && !S.entryDetail) { toTree(); return 'tree'; }
  const g = leaveStudio(); return g || 'leave';
}
function leaveFailSheet() {
  openSheet({ title: t('leaveFailTitle'), opener: $('#backBtn'), cls: 'dlg', critical: true, kind: 'leave', build(body) {
    body.innerHTML = '<p class="txt warn">' + ic('cloud-off', 16) + ' ' + esc(t('leaveFailBody')) + '</p><div class="confirm-row"><button type="button" class="btn primary" data-x="retry">' + ic('rotate-ccw', 18) + '<span>' + esc(t('leaveRetry')) + '</span></button><button type="button" class="btn" data-x="leave">' + ic('arrow-left', 18) + '<span>' + esc(t('leaveAnyway')) + '</span></button><button type="button" class="btn" data-x="stay" data-autofocus="1">' + ic('x', 18) + '<span>' + esc(t('leaveStay')) + '</span></button></div>';
    body.querySelector('[data-x="retry"]').onclick = () => { closeSheet(false); retrySave(); leaveStudio(); };
    body.querySelector('[data-x="leave"]').onclick = () => { closeSheet(false); leaveStudio(true); };
    body.querySelector('[data-x="stay"]').onclick = () => closeSheet(true);
  } });
}
/* N-05: never drop a save silently: wait for a pending save, offer Retry / Leave anyway / Stay after a failure */
function leaveGuard() {
  const sv = S.save; if (S.leaving) return 'wait';
  if (sv.state === 'failed') { leaveFailSheet(); return 'ask'; }
  if (sv.dirty || sv.inflight || sv.pendSince) {
    S.leaving = true; announce(t('leaveWaiting')); toast(t('leaveWaiting'), {}); clearTimeout(sv.debT); if (!sv.inflight) flushSave(); const t0 = now();
    const iv = setInterval(() => { const s = S.save; if (s.state === 'failed') { clearInterval(iv); S.leaving = false; leaveFailSheet(); } else if (!(s.dirty || s.inflight || s.pendSince)) { clearInterval(iv); S.leaving = false; leaveStudio(true); } else if (now() - t0 > 10000) { clearInterval(iv); S.leaving = false; leaveFailSheet(); } }, 40);
    return 'wait';
  }
  return null;
}
function leaveStudio(force) {
  if (!force && S.inStudio) { const g = leaveGuard(); if (g) return g; }
  const unsaved = S.save.state === 'failed'; ST.leftUnsaved = unsaved;
  if (ST.ext.onLeave) ST.ext.onLeave();   /* slice 4 (DD-188): revealed private content hides again */
  S.inStudio = false; closeSheet(false); closeSearch(false); closeSide(true); hideToast(); S.deleted = [];   // deleted items stay in History until Studio closes
  const url = S.from === 'settings' ? settingsUrl() : null; ST.lastLeave = url || S.from;
  if (url && !Q.has('nonav')) { $('#studio').hidden = true; location.href = url; return; }   // Settings owns its own screen: Back goes to it
  $('#studio').hidden = true; const og = $('#origin'); og.hidden = false; const oldN = $('.o-unsaved', og); if (oldN) oldN.remove();
  if (unsaved) og.querySelector('.o-body').insertAdjacentHTML('afterbegin', '<p class="o-note o-unsaved" role="status">' + esc(t('leftUnsaved')) + '</p>');
  const op = S.opener && S.opener.isConnected ? S.opener : $('#origin button'); if (op) op.focus();
  announce(t('oBackTo', { w: t({ chat: 'oChatName', library: 'oLibName', settings: 'oSetName' }[S.from]) }) + (unsaved ? '. ' + t('leftUnsaved') : ''));
}
function enterStudio(o) {
  o = o || {}; if (o.from) S.from = o.from;
  S.ctx = S.from === 'chat' ? { char: (o.at && o.at.char) || 'c1', chat: true } : { char: (o.at && o.at.char) || 'c1', chat: false };
  if (S.from === 'chat' && S.ctx.char !== 'c1') S.ctx.chat = false;
  S.opener = o.opener || null; S.inStudio = true; S.entryDetail = false; S.deleted = []; S.peers = {}; clearNotice(); S.settingsTo = o.at && o.at.module ? SETTINGS_TO.module : o.at === 'preset' ? SETTINGS_TO.presetPrompt : SETTINGS_TO.module; $('#origin').hidden = true; $('#studio').hidden = false;
  S.open = null; S.view = { type: 'none' }; S.sel = null; S.phone = 'tree'; S.drawer = false; S.layers.length = 0; S.sideOpen = false; $('#side').classList.remove('open'); $('#sideBackdrop').classList.remove('open'); $('#drawerBackdrop').classList.remove('open');
  buildOriginIfNeeded(); applyLayout(); renderAll();
  const at = o.at; const ch = ctxChar();
  if (at === 'char') openItem(ch.items.find((i) => i.kind === 'basic').id, { focus: false });
  else if (at === 'chatlore') { const c = O('chat1'); revealOwner(c); S.exp.add('k:chat1:lore'); S.sel = 'k:chat1:lore'; S.view = { type: 'kind', ownerId: 'chat1', kind: 'lore' }; if (S.layout === 'phone') S.phone = 'detail'; renderAll(); }
  else if (at && at.toggles) { const ow = O(at.toggles), it = ow.items.find((i) => i.kind === 'toggles'); revealOwner(ow); if (it) openItem(it.id, { focus: false }); }
  else if (at && at.module) { const ow = O(at.module); revealOwner(ow); S.sel = 'o:' + ow.id; S.view = { type: 'owner', ownerId: ow.id }; if (S.layout === 'phone') S.phone = 'detail'; renderAll(); }
  else if (at === 'preset') { const ow = activePreset(); revealOwner(ow); S.sel = 'o:' + ow.id; S.view = { type: 'owner', ownerId: ow.id }; if (S.layout === 'phone') S.phone = 'detail'; renderAll(); }
  else if (at && at.char) { S.sel = null; renderAll(); }
  S.entryDetail = S.layout === 'phone' && S.phone === 'detail';
  if (S.layout === 'phone' && S.phone === 'tree') focusRow(S.focusId || S.rows[0].id); else if (!o.noFocus) { $('#main').focus({ preventScroll: true }); }
  if (o.announce !== false) announce(S.ctx.chat ? t('studioTitle') + ' · ' + nm(ctxChar().name) + ' · ' + nm(O('chat1').name) : t('studioTitle') + ' · ' + nm(ctxChar().name) + ' · ' + t('ctxNoChat'));
}
let originBuilt = '';
function buildOriginIfNeeded() { const key = S.from + S.lang; if (originBuilt !== key) buildOrigin(); }
function buildOrigin() {
  originBuilt = S.from + S.lang; const og = $('#origin'); const hdr = (title) => '<div class="o-hdr"><strong>' + esc(title) + '</strong></div>';
  const open = (id, o) => { const el = document.getElementById(id); if (el) el.addEventListener('click', () => enterStudio(Object.assign({ opener: el }, o))); };
  if (S.from === 'chat') {
    og.innerHTML = hdr(t('oChatTitle')) + '<div class="o-body"><p class="o-note">' + esc(t('oChatNote')) + '</p><p class="o-msg">' + esc(t('oMsg1')) + '</p><p class="o-msg">' + esc(t('oMsg2')) + '</p><div class="o-card" role="group" aria-label="' + esc(t('oThis')) + '"><h3>' + esc(t('oThis')) + '</h3>' +
      '<button type="button" class="btn item" id="o-char">' + ic('user', 20) + '<span>' + esc(t('oOpenChar')) + '</span></button><button type="button" class="btn item" id="o-chatlore">' + ic('book-open', 20) + '<span>' + esc(t('oChatLore')) + '</span></button><button type="button" class="btn item" id="o-toggles">' + ic('toggle-right', 20) + '<span>' + esc(t('oToggleDefs')) + '</span></button></div></div>';
    open('o-char', { from: 'chat', at: 'char' }); open('o-chatlore', { from: 'chat', at: 'chatlore' }); open('o-toggles', { from: 'chat', at: { toggles: 'm1' } });
  } else if (S.from === 'library') {
    og.innerHTML = hdr(t('oLibTitle')) + '<div class="o-body"><p class="o-note">' + esc(t('oLibNote')) + '</p><div class="o-grid">' + ['c1', 'c2', 'c3'].map((id) => '<div class="o-char"><span class="av">' + esc(nm(O(id).name)[0]) + '</span><div class="row"><strong>' + esc(nm(O(id).name)) + '</strong><button type="button" class="btn sm" id="o-lib-menu-' + id + '" aria-haspopup="menu" aria-label="' + esc(t('oMenu') + ': ' + nm(O(id).name)) + '" title="' + esc(t('oMenu')) + '">' + ic('ellipsis', 18) + '</button></div></div>').join('') + '</div></div>';
    ['c1', 'c2', 'c3'].forEach((id) => { const b = document.getElementById('o-lib-menu-' + id); b.addEventListener('click', () => openMenu(b, t('oMenu'), [['code-xml', t('oOpenStudio'), () => enterStudio({ from: 'library', at: { char: id }, opener: b }), '']])); });
  } else {
    og.innerHTML = hdr(t('oSetTitle')) + '<div class="o-body"><p class="o-note">' + esc(t('oSetNote')) + '</p><div class="o-card" role="group" aria-label="' + esc(t('oSetModules')) + '"><h3>' + esc(t('oSetModules')) + '</h3>' + ownerList().filter((o) => o.type === 'module' && !o.id.startsWith('mx')).map((m) => '<button type="button" class="btn item" id="o-set-' + m.id + '">' + ic('puzzle', 20) + '<span>' + esc(nm(m.name)) + '</span></button>').join('') + '</div><div class="o-card" role="group" aria-label="' + esc(t('oSetPrompt')) + '"><h3>' + esc(t('oSetPrompt')) + '</h3><button type="button" class="btn item" id="o-set-prompt">' + ic('file-text', 20) + '<span>' + esc(nm(activePreset().name)) + '</span></button></div></div>';
    ownerList().filter((o) => o.type === 'module' && !o.id.startsWith('mx')).forEach((m) => open('o-set-' + m.id, { from: 'settings', at: { module: m.id } })); open('o-set-prompt', { from: 'settings', at: 'preset' });
  }
}

/* ------------------------------------------------------------------ pane cycling, global keys */
function visiblePanes() {
  const l = S.layout, p = [];
  if (l === 'wide' || (l === 'mid' && S.drawer) || (l === 'phone' && S.phone === 'tree')) p.push('tree');
  if (l !== 'phone' || S.phone === 'detail') p.push('editor');
  if ((l === 'wide' && !S.sideOff) || S.sideOpen) p.push('side');
  p.push('header'); return p;
}
function paneOf(el) { if (!el) return null; if (el.closest('#hdr')) return 'header'; if (el.closest('#treeCol')) return 'tree'; if (el.closest('#side')) return 'side'; if (el.closest('#main')) return 'editor'; return null; }
function focusPane(p) {
  if (p === 'tree') { const r = rowEl(S.focusId) || $('#tree .tr'); if (r) { r.tabIndex = 0; r.focus(); } }
  else if (p === 'editor') { const f = S.open && findItem(S.open); if (f && isCode(f.it)) ED.focus(); else { const el = $('#formHost [data-f], #formHost button'); (el || $('#itemHead')).focus(); } }
  else if (p === 'side') { $('#tab' + S.sideTab[0].toUpperCase() + S.sideTab.slice(1)).focus(); }
  else $('#backBtn').focus();
}
function cyclePane(dir) { const ps = visiblePanes(); const cur = paneOf(document.activeElement); let i = ps.indexOf(cur); i = i < 0 ? 0 : (i + dir + ps.length) % ps.length; focusPane(ps[i]); }
function openDrawer() { if (S.layout !== 'mid' || S.drawer) return; S.drawer = true; const l = { kind: 'drawer', close: () => closeDrawer(true) }; S.drawerLayer = l; pushLayer(l); applyLayout(); setTimeout(() => focusPane('tree'), 30); }
function closeDrawer(restore) { if (!S.drawer) return; S.drawer = false; if (S.drawerLayer) { dropLayer(S.drawerLayer); S.drawerLayer = null; } applyLayout(); if (restore) $('#drawerBtn').focus(); }
$('#drawerBtn').addEventListener('click', () => (S.drawer ? closeDrawer(true) : openDrawer()));
$('#drawerBackdrop').addEventListener('click', () => closeDrawer(true));
const isFormField = (el) => !!el && el.matches && el.matches('input[type="text"], textarea') && !!el.closest('#formHost, .lt-focus');
// Ctrl+K is the only Studio search shortcut: Ctrl+P is the global preset switcher (Settings lane DS-020/021)
addEventListener('keydown', (e) => {
  if (!S.inStudio) return; const mod = e.ctrlKey || e.metaKey, k = e.key, kl = k.toLowerCase(), inCode = e.target && e.target.closest && e.target.closest('#editor-panel');
  if (mod && !e.altKey && !e.shiftKey && kl === 'k') { e.preventDefault(); openSearch(document.activeElement); return; }
  if (k === 'F6') { e.preventDefault(); cyclePane(e.shiftKey ? -1 : 1); return; }
  if (mod && !e.altKey && !e.shiftKey && kl === 's') { e.preventDefault(); const f = S.open && findItem(S.open); if (f && isCode(f.it)) doCheckItem(); else { announce(t('autoSave')); toast(t('autoSave'), {}); } return; }
  if (mod && !e.altKey && k === 'Enter') { const f = S.open && findItem(S.open); if (f && isCode(f.it) && hasDraft(f.it.id)) { e.preventDefault(); requestApply(); } return; }
  if (mod && !e.altKey && (kl === 'z' || kl === 'y') && !inCode) {
    const a = document.activeElement;
    if (isFormField(a) && a.value !== a.dataset.fv && kl === 'z') return;      // the field's own undo first, then the owner history
    e.preventDefault(); if (kl === 'y' || e.shiftKey) doRedo(); else doUndo(); return;
  }
  if (k === 'Escape') {
    if (inCode) return; if (e.defaultPrevented) return;
    if (closeTopLayer()) { e.preventDefault(); return; }
    const a = document.activeElement; if (a && a.matches && a.matches('input, textarea, select') && $('#main').contains(a)) { e.preventDefault(); $('#itemHead').focus(); }
  }
}, true);
document.addEventListener('focusin', (e) => { if (isFormField(e.target)) e.target.dataset.fv = e.target.value; });
addEventListener('mouseup', (e) => { if (e.button === 3 && S.inStudio) { e.preventDefault(); backPress(); } }, true);

/* tree splitter */
(() => {
  const sp = $('#splitter'); let drag = null;
  const set = (w) => { S.treeSet = true; S.treeW = Math.max(220, Math.min(400, Math.round(w))); document.documentElement.style.setProperty('--studio-tree-user-width', S.treeW + 'px'); sp.setAttribute('aria-valuenow', String(S.treeW)); saveUi(); ED.resize(); };
  sp.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, w: treeNow() }; sp.setPointerCapture(e.pointerId); e.preventDefault(); });
  sp.addEventListener('pointermove', (e) => { if (drag) set(drag.w + e.clientX - drag.x); });
  sp.addEventListener('pointerup', () => { drag = null; }); sp.addEventListener('pointercancel', () => { drag = null; });
  sp.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft') { e.preventDefault(); set(treeNow() - 16); } else if (e.key === 'ArrowRight') { e.preventDefault(); set(treeNow() + 16); } else if (e.key === 'Home') { e.preventDefault(); set(220); } else if (e.key === 'End') { e.preventDefault(); set(400); } });
})();

/* ------------------------------------------------------------------ reload simulation (drafts persist, DD-095) */
function reloadSim() {
  if (S.save.state !== 'failed') ss.raw('st1:db', persistPayload());
  ss.set('st1:drafts', S.drafts); saveUi();
  const f = S.open; ED.drop && Object.keys(S.drafts).forEach((id) => ED.drop(id)); (ownerList().forEach((o) => o.items.forEach((i) => isCode(i) && ED.drop(i.id))));
  clearTimeout(S.save.debT); clearTimeout(S.save.doneT); clearTimeout(S.save.showT); S.save.inflight = false; S.save.dirty = false; S.save.pendSince = 0; S.save.state = 'saved'; S.statusKey = '';
  loadData(true); S.layers.length = 0; closeSheet(false); closeSearch(false); closeSide(true); recomputeCodeProb();
  const ok = f && findItem(f); S.open = ok ? f : null; S.view = ok ? { type: 'item' } : { type: 'none' };
  if (!ok && S.layout === 'phone') S.phone = 'tree'; applyLayout(); renderAll();
  const n = Object.keys(S.drafts).length; toast(n ? t('draftRestoredToast', { n }) : t('noDraft'), {}); announce(n ? t('draftRestoredToast', { n }) : t('noDraft'));
  if (ST.ext.afterReload) ST.ext.afterReload();   // slice 4: a pending risky question comes back
}
function recomputeCodeProb() {
  S.codeProb = {};
  ownerList().forEach((o) => o.items.forEach((it) => { if (!isCode(it)) return; const text = hasDraft(it.id) ? S.drafts[it.id].text : it.code.live; let d = []; try { d = it.kind === 'plugin' ? SL.lintPlugin(text).diags : SL.lintLua(text, ownerLow(o)); } catch (_) {} const n = d.filter((x) => x.severity !== 'info').length; if (n) S.codeProb[it.id] = n; }));
}

/* ------------------------------------------------------------------ deep links: ?owner=<character|chat|preset|module|plugin>:<id>&kind=<kind> */
const OWNER_TYPES = { character: 'char', group: 'group', chat: 'chat', preset: 'preset', module: 'module', plugin: 'plugin' };   // slice 4: group owners
function openDeep(ownerParam, kindParam, itemParam) {
  const m = /^([a-z]+):(.+)$/.exec(ownerParam || ''); const type = m && OWNER_TYPES[m[1]]; const o = m && type && S.db.owners[m[2]];
  if (!o || o.type !== type) { ST.deep = { status: 'missing', owner: ownerParam }; showNotice(t('notFound')); return false; }
  const wasChar = S.ctx.char; let notice0 = '';
  if ((type === 'char' || type === 'group') && o.id !== S.ctx.char) { S.ctx = { char: o.id, chat: false }; notice0 = t('ctxOtherChar', { c: nm(o.name) }); }
  if (type === 'chat') S.ctx.chat = true;
  S.settingsTo = type === 'preset' ? (kindParam === 'advanced' ? SETTINGS_TO.presetPrompt : SETTINGS_TO.preset) : type === 'plugin' ? SETTINGS_TO.plugin : type === 'module' ? SETTINGS_TO.module : null;
  const ALIAS = { plugincode: 'plugin', lua: 'scripts', trigger: 'scripts' }; const kind = ALIAS[kindParam] || kindParam;
  revealOwner(o); let notice = '';
  if (kind && SUPPORT[o.type].includes(kind)) {
    S.exp.add('k:' + o.id + ':' + kind); S.sel = 'k:' + o.id + ':' + kind; S.view = { type: 'kind', ownerId: o.id, kind }; ST.deep = { status: 'ok', owner: o.id, kind };
    const di = !itemParam && ST.ext.deepItem ? ST.ext.deepItem(o, kind) : null;   // slice 4: a character or group kind opens its form directly
    const it = (itemParam && o.items.find((i) => i.id === itemParam && i.kind === kind)) || (di && o.items.find((i) => i.id === di));
    if (itemParam && !it) { ST.deep.status = 'item-missing'; notice = t('deepItemMissing'); }
    if (it) { if (notice0) showNotice(notice0); S.open = null; S.entryDetail = true; saveUi(); renderAll(); openItem(it.id, { focus: false }); S.entryDetail = S.layout === 'phone'; ST.deep.item = it.id; if (ST.ext.afterDeep) ST.ext.afterDeep(it, Q.get('field')); return true; }
  } else { S.sel = 'o:' + o.id; S.view = { type: 'owner', ownerId: o.id }; ST.deep = { status: kind ? 'kind-fallback' : 'ok', owner: o.id, kind: kind || null }; if (kind) notice = t('deepKindFallback', { o: nm(o.name) }); }
  if (notice || notice0) showNotice(notice || notice0); if (ST.deep) ST.deep.notice = notice || notice0 || null;
  S.open = null; if (S.layout === 'phone') { S.phone = 'detail'; S.entryDetail = true; }
  saveUi(); renderAll(); focusRow(S.sel, true); return true;
}

/* ------------------------------------------------------------------ demo controls (collapsed) */
function buildDemo() {
  const b = $('#demoBody'); const pr = (on) => ' aria-pressed="' + on + '"';
  b.innerHTML = '<label class="l">' + esc(t('dLang')) + '</label><div class="row"><button type="button" class="btn" data-d="lang:ko"' + pr(S.lang === 'ko') + '>한국어</button><button type="button" class="btn" data-d="lang:en"' + pr(S.lang === 'en') + '>English</button></div>' +
    '<div class="row"><button type="button" class="btn" data-d="rm"' + pr(S.rm) + '>' + ic('circle-off', 14) + esc(t('dReduced')) + '</button><button type="button" class="btn" data-d="lp"' + pr(S.lp) + '>' + esc(t('dLow')) + '</button></div>' +
    '<label class="l">' + esc(t('dFrom')) + '</label><div class="row">' + [['chat', 'dFromChat'], ['library', 'dFromLib'], ['settings', 'dFromSet']].map(([k, l]) => '<button type="button" class="btn" data-d="from:' + k + '"' + pr(S.from === k) + '>' + esc(t(l)) + '</button>').join('') + '</div>' +
    '<label class="l">' + esc(t('dLatency')) + '</label><div class="row"><button type="button" class="btn" data-d="lat:fast"' + pr(S.save.latency < 500) + '>' + esc(t('dFast')) + '</button><button type="button" class="btn" data-d="lat:slow"' + pr(S.save.latency >= 500) + '>' + esc(t('dSlow')) + '</button><button type="button" class="btn" data-d="fail"' + pr(S.save.failNext) + '>' + esc(t('dFailNext')) + '</button></div>' +
    '<div class="row"><button type="button" class="btn" data-d="remote">' + esc(t('dRemote')) + '</button><button type="button" class="btn" data-d="peer">' + esc(t('dRemoteLive')) + '</button><button type="button" class="btn" data-d="dfail" aria-pressed="' + S.draftFail + '">' + esc(t('dDraftFail')) + '</button><button type="button" class="btn" data-d="reload">' + ic('rotate-ccw', 14) + esc(t('dReload')) + '</button><button type="button" class="btn" data-d="sysback">' + ic('arrow-left', 14) + esc(t('dSysBack')) + '</button><button type="button" class="btn" data-d="reset">' + esc(t('dReset')) + '</button></div>' +
    '<label class="l" for="dOutcome">' + esc(t('dOutcome')) + '</label><select id="dOutcome">' + ['normal', 'thrown', 'timeout', 'stopped', 'diag'].map((v, i) => '<option value="' + v + '">' + esc(t('outcomeLbl')[i]) + '</option>').join('') + '</select>' +
    '<label class="l" for="dState">' + esc(t('dState')) + '</label><select id="dState"><option value="">—</option>' + Object.keys(STATES).map((n) => '<option>' + n + '</option>').join('') + '</select><p class="demo-note">' + esc(t('dNote')) + '</p>';
}
$('#demoBody').addEventListener('click', (e) => {
  const b = e.target.closest('[data-d]'); if (!b) return; const [k, v] = b.dataset.d.split(':');
  if (k === 'lang') setLang(v); else if (k === 'rm') { S.rm = !S.rm; applyFlags(); buildDemo(); } else if (k === 'lp') { S.lp = !S.lp; applyFlags(); buildDemo(); }
  else if (k === 'from') { S.from = v; buildOrigin(); enterStudio({ from: v, at: v === 'settings' ? { module: 'm1' } : 'char', noFocus: true }); buildDemo(); }
  else if (k === 'lat') { S.save.latency = v === 'slow' ? 1800 : 100; buildDemo(); } else if (k === 'fail') { S.save.failNext = !S.save.failNext; buildDemo(); }
  else if (k === 'remote') remoteChange('c1.sc'); else if (k === 'peer') peerChange('c1.lore1'); else if (k === 'dfail') { S.draftFail = !S.draftFail; persistDraftsSoon(); buildDemo(); } else if (k === 'reload') reloadSim(); else if (k === 'sysback') backPress(); else if (k === 'reset') { ss.del('st1:db'); ss.del('st1:drafts'); ss.del('st1:ui'); location.search = location.search.replace(/[?&]keep=1/, ''); }
});
$('#demoBody').addEventListener('change', (e) => {
  if (e.target.id === 'dOutcome') $('#sel-outcome').value = e.target.value;
  if (e.target.id === 'dState' && e.target.value) { const v = e.target.value; location.search = '?state=' + v + (S.lang === 'en' ? '&lang=en' : ''); }
});
function setLang(l) {
  if (S.lang === l) return; S.lang = l; S.statusKey = ''; $$('[data-ic]').forEach((e) => { delete e.dataset.icDone; }); applyStatic(); buildDemo(); buildOrigin(); ED.relang(); renderAll(); renderUndoRedo(); announce(l === 'ko' ? '한국어' : 'English');
}
/* DD-144, DD-153: state a pack may style is mirrored as data-*; the classes and aria stay for the code and the checks. One attribute observer per group, fired before the next paint. */
['#treeCol', '#side', '#sheetRoot', '#drawerBackdrop', '#sideBackdrop'].forEach((q) => { const el = $(q); if (!el) return; const sync = () => el.toggleAttribute('data-open', el.classList.contains('open')); sync(); new MutationObserver(sync).observe(el, { attributes: true, attributeFilter: ['class'] }); });
['#sideTabs', '#searchList'].forEach((q) => { const host = $(q); if (!host) return; const sync = (e) => { if (e.hasAttribute('aria-selected')) e.toggleAttribute('data-selected', e.getAttribute('aria-selected') === 'true'); }; $$('[aria-selected]', host).forEach(sync); new MutationObserver((rs) => rs.forEach((r) => sync(r.target))).observe(host, { attributes: true, subtree: true, attributeFilter: ['aria-selected'] }); });
function applyFlags() { root.classList.toggle('rm', S.rm); root.classList.toggle('nexus-low-power', S.lp); root.setAttribute('data-motion', S.rm ? 'reduced' : 'full'); root.setAttribute('data-power', S.lp ? 'low' : 'normal'); }
matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (e) => { if (e.matches) { S.rm = true; applyFlags(); } });

/* ------------------------------------------------------------------ scripted demo states (?state=st-...) */
const typeInto = (sel, val) => { const el = $(sel); el.focus(); el.value = val; el.dispatchEvent(new Event('input', { bubbles: true })); };
const settle = async (ms) => { await sleep(ms || (S.rm ? 40 : 280)); await new Promise((r) => { let d = false; const f = () => { if (!d) { d = true; r(); } }; requestAnimationFrame(() => requestAnimationFrame(f)); setTimeout(f, 60); }); };   // a hidden tab never fires requestAnimationFrame: the timer wins
const expand = (id) => { S.exp.add(id); renderTree(); };
const begin = async (o) => { enterStudio(Object.assign({ from: S.from, noFocus: true }, o || {})); };
const openOnly = (id) => async () => { await begin(); openItem(id, { focus: false }); };
const searchState = (q, o) => async () => { await begin(); openSearch($('#searchBtn')); o && o.wide && (S.search.wide = true, $('#searchWideBox').checked = !S.lp); o && o.chip && (S.search.kinds.add(o.chip), renderChips2()); $('#searchInput').value = q; runSearch(); await sleep(160); };
const luaDraft = async (text) => { await begin(); openItem('c1.sc', { focus: false }); await sleep(30); ED.setText(text, 'Edit'); await sleep(40); };
const STATES = {
  'st-tree': async () => { await begin(); },
  'st-owner-expanded': async () => { await begin(); expand('o:c1'); },
  'st-kinds-empty': async () => { await begin(); expand('o:c1'); expand('o:m2'); },
  'st-other-collapsed': async () => { await begin(); },
  'st-other-expanded': async () => { await begin(); expand('g:mods'); expand('o:m4'); },
  'st-merged': async () => { await begin(); ['merged', 'merged:toggles', 'merged:regex', 'merged:lore', 'merged:scripts'].forEach(expand); },
  'st-search-name': async () => searchState(S.lang === 'ko' ? '세라' : 'sera')(),
  'st-search-content': async () => searchState(S.lang === 'ko' ? '안개' : 'fog')(),
  'st-search-cho': async () => searchState('ㅅㄹㅍ')(),
  'st-search-chip': async () => searchState('', { chip: 'regex' })(),
  'st-search-wide': async () => searchState(S.lang === 'ko' ? '노래' : 'song', { wide: true })(),
  'st-search-none': async () => searchState(S.lang === 'ko' ? '없는말' : 'zzzq')(),
  'st-item-basic': openOnly('c1.basic'), 'st-item-regex': openOnly('c1.re2'), 'st-item-lore': openOnly('c1.lore1'), 'st-item-toggles': openOnly('c1.tg'),
  'st-item-lua': openOnly('c1.sc'), 'st-item-plugin': openOnly('pl1.code'), 'st-item-generic': openOnly('m3.sc'),
  'st-save-saved': async () => { await begin(); openItem('c1.lore1', { focus: false }); typeInto('#f-keys', '등불, 숲길, 안개'); await sleep(S.save.deb + S.save.latency + 120); },
  'st-save-saving': async () => { await begin(); S.save.latency = 2500; openItem('c1.lore1', { focus: false }); typeInto('#f-keys', '등불, 숲길, 안개'); await sleep(S.save.deb + 380); },
  'st-save-failed': async () => { await begin(); S.save.failNext = true; openItem('c1.lore1', { focus: false }); typeInto('#f-keys', '등불, 숲길, 안개'); await sleep(S.save.deb + S.save.latency + 150); },
  'st-undo': async () => { await begin(); openItem('c1.re1', { focus: false }); typeInto('#f-iname', S.lang === 'ko' ? '말투' : 'Speech'); await sleep(1100); typeInto('#f-find', '\\s{3,}'); await sleep(300); },
  'st-redo': async () => { await STATES['st-undo'](); doUndo(); await sleep(100); },
  'st-delete': async () => { await begin(); openItem('c1.re1', { focus: false }); deleteItem(findItem('c1.re1').it, O('c1')); },
  'st-restore': async () => { await begin(); openItem('c1.lore1', { focus: false }); typeInto('#f-iname', S.lang === 'ko' ? '규칙 수정' : 'Edited rules'); await sleep(1100); setEnabled(findItem('c1.re1').it, O('c1'), false); addItem('c1', 'regex'); await sleep(150); openRestore($('#moreBtn')); await sleep(150); },
  'st-restored': async () => { await STATES['st-restore'](); $('#sheet [data-x="ok"]').click(); await sleep(150); },
  'st-history': async () => { await begin(); openItem('c1.lore1', { focus: false }); typeInto('#f-iname', S.lang === 'ko' ? '규칙 수정' : 'Edited rules'); await sleep(1100); setEnabled(findItem('c1.re1').it, O('c1'), false); await sleep(100); openSide('history'); await sleep(150); },
  'st-lua-dirty': async () => { await luaDraft(D.LUA_BUGS); },
  'st-lua-errors': async () => { await luaDraft(D.LUA_BUGS); ED.check(); await sleep(60); },
  'st-lua-fixed': async () => { await luaDraft(D.LUA_BUGS); ED.check(); ED.setText(D.LUA_FIXED, 'Fix'); ED.check(); await sleep(60); },
  'st-lua-applied': async () => { await STATES['st-lua-fixed'](); requestApply(); await sleep(100); $('#sheet [data-x="ok"]').click(); await sleep(150); },
  'st-lua-undo-apply': async () => { await STATES['st-lua-applied'](); undoOwner('c1'); await sleep(150); },
  'st-draft-reload': async () => { await luaDraft(D.LUA_FIXED); await sleep(250); reloadSim(); await sleep(150); },
  'st-conflict': async () => { await luaDraft(D.LUA_FIXED); ED.check(); await sleep(60); remoteChange('c1.sc'); await sleep(100); },
  'st-conflict-view': async () => { await STATES['st-conflict'](); openConflict(findItem('c1.sc').it, O('c1'), $('#applyBtn')); await sleep(150); },
  'st-test-cbs': async () => { await begin(); openItem('c1.basic', { focus: false }); if (S.layout === 'wide') selectTab('test'); else openSide('test'); S.tv.lantern = true; renderTest(); runCbs(); await sleep(100); },
  'st-test-code': async () => { await begin(); openItem('c1.sc', { focus: false }); if (S.layout === 'wide') selectTab('test'); else openSide('test'); ED.test(); await sleep(150); },
  'st-test-stale': async () => { await STATES['st-test-cbs'](); const ta = $('#f-description'); ta.value += ' (+)'; ta.dispatchEvent(new Event('input', { bubbles: true })); await sleep(100); },
  'st-module-new': async () => { await begin(); openNewModule($('#tree [data-addmod]')); await sleep(100); $('#modName').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await sleep(60); },
  'st-from-chat': async () => { S.from = 'chat'; await begin({ at: 'char' }); },
  'st-from-library': async () => { S.from = 'library'; buildOrigin(); await begin({ from: 'library', at: { char: 'c1' } }); },
  'st-from-settings': async () => { S.from = 'settings'; buildOrigin(); await begin({ from: 'settings', at: { module: 'm1' } }); },
  'st-back': async () => { buildOrigin(); const b = $('#o-char'); b.focus(); enterStudio({ from: 'chat', at: 'char', opener: b }); await sleep(80); backPress(); await sleep(80); if (S.inStudio) { backPress(); await sleep(80); } },   // phone: the first Back goes from the item to the list
  'st-origin': async () => { buildOrigin(); S.inStudio = false; $('#studio').hidden = true; $('#origin').hidden = false; },
  'st-menu': async () => { await begin({ at: 'char' }); openMore($('#moreBtn')); await sleep(120); },
  'st-help': async () => { await begin({ at: 'char' }); openHelp($('#moreBtn')); await sleep(120); },
  'st-tree-menu': async () => { await begin(); $('#treeMenuBtn').click(); await sleep(120); },
  'st-drawer': async () => { await begin({ at: 'char' }); openDrawer(); await sleep(250); },
  'st-script-v2': openOnly('m3.sc'),
  'st-script-switch': async () => { await begin(); openItem('c1.sc', { focus: false }); await sleep(30); switchMode(findItem('c1.sc').it, O('c1'), 'v2'); await sleep(80); },
  'st-script-restore': async () => { await STATES['st-script-switch'](); restorePrior(findItem('c1.sc').it, O('c1')); await sleep(80); },
  'st-peer': async () => { await begin(); openItem('c1.lore1', { focus: false }); await sleep(30); peerChange('c1.lore1'); await sleep(60); },
  'st-restore-peer': async () => { await begin(); openItem('c1.lore1', { focus: false }); typeInto('#f-iname', S.lang === 'ko' ? '규칙 수정' : 'Edited rules'); await sleep(1100); peerChange('c1.lore1'); resolvePeer('reload'); await sleep(100); openRestore($('#moreBtn')); await sleep(150); },
  'st-search-off': async () => searchState(S.lang === 'ko' ? '전투 시작' : 'Start of combat')(),
  'st-delete-late': async () => { await begin(); openItem('c1.re1', { focus: false }); deleteItem(findItem('c1.re1').it, O('c1')); await sleep(40); openItem('c1.lore1', { focus: false }); typeInto('#f-iname', S.lang === 'ko' ? '나중 편집' : 'Later edit'); await sleep(200); },
  'st-draft-fail': async () => { await luaDraft(D.LUA_FIXED); S.draftFail = true; ED.setText(D.LUA_FIXED + '\n-- x', 'Edit'); await sleep(400); },
  'st-side': async () => { await begin(); openItem('c1.re2', { focus: false }); openSide('problems'); await sleep(250); }
};
ST.STATES = STATES;
async function runState(name) {
  window.__stReady = false;
  const fn = STATES[name]; if (!fn) { ST.stateError = 'unknown state ' + name; if (ST.ext.unknownState) ST.ext.unknownState(name); window.__stReady = 'unknown:' + name; return; }
  try { await fn(); await settle(); } catch (e) { ST.stateError = String(e && e.stack || e); console.error(e); }
  window.__stReady = name;
}

ST.api = { sheetCritical: (kind) => sheetParts(true, kind, true), S, t, nm, ic, esc, $, $$, O, findItem, itemsOf, mergeOrder, moduleActive, edit, toast, announce, openMenu, openSheet, closeSheet, openItem, openSide, closeSide, selectTab, selectTabNoRender, renderAll, renderTree, renderMain, renderHeader, renderSide, renderStatus, renderHistory, undoOwner, redoOwner, pushLayer, dropLayer, kindName, ownerIcon, focusRow, rowEl, hash, clone, sleep, ownerList, refreshProblemsOnly, updateCounts, touchSave, activePreset, ctxChar, KIND_ICON, saveUi, backPress, peerBannerHtml, openItemMenu, openRestore, showNotice, openSearch, runSearch, crossEdit };

/* ------------------------------------------------------------------ init */
function init() {
  S.rm = Q.get('reduced') === '1' || matchMedia('(prefers-reduced-motion: reduce)').matches; S.lp = Q.get('lowpower') === '1'; applyFlags();
  loadData(Q.get('keep') === '1' || !Q.get('state')); recomputeCodeProb(); applyStatic(); buildDemo(); buildOrigin();
  addEventListener('resize', () => { applyLayout(); renderAll(); });
  selectTabNoRender(); S.layout = layoutOf(); applyLayout();
  ST.t = t; ST.enter = enterStudio; ST.back = backPress; ST.leave = leaveStudio; ST.openItem = openItem; ST.toast = toast; ST.appToast = appToast; ST.edit = edit; ST.undoOwner = undoOwner; ST.redoOwner = redoOwner; ST.reloadSim = reloadSim; ST.runState = runState; ST.openSearch = openSearch; ST.closeSearch = closeSearch;
  ST.peerChange = peerChange; ST.addItem = addItem; ST.deleteItem = deleteItem; ST.setLang = setLang; ST.findItem = findItem; ST.O = O; ST.hm = hm; ST.remoteChange = remoteChange; ST.openSide = openSide; ST.closeSide = closeSide; ST.requestApply = requestApply; ST.openDeep = openDeep; ST.revertTo = revertTo; ST.diffOwner = diffOwner; ST.contextOwners = contextOwners; ST.flushSave = flushSave; ST.retrySave = retrySave; ST.STATES = STATES; ST.doUndo = doUndo; ST.layers = S.layers;
  const state = Q.get('state');
  if (state) { runState(state); return; }
  const ow = Q.get('owner');
  if (ow) { S.from = S.from; enterStudio({ from: S.from, at: null, noFocus: true }); openDeep(ow, Q.get('kind'), Q.get('item')); window.__stReady = 'deep'; return; }
  enterStudio({ from: S.from, at: S.layout === 'phone' ? null : 'char', noFocus: true }); window.__stReady = 'default';
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
