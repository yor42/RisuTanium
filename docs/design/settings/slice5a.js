/* Settings slice 5a mockup: 단축키 (shortcuts), 페르소나 (personas) and 확장 (plugins and modules, with the module info page).
   Synthetic mockup; not proof of native behaviour or performance. Standalone (no network, no dependencies): nothing here reads or writes the real app's storage; plugin "code" is a stub that never runs.
   Loaded after slice2.js, slice3.js and slice4.js and BEFORE slice1.js: it wraps the window.SS1_EXT hooks they registered (slice1.js reads them at start-up) and receives slice 1's API in X.boot.
   Implements settings/SLICE5A_SPEC.md revision 1. Store-first (DS-067): the shortcut rows are rows of slice 1's catalogue, the personas, plugins and modules are the arrays of SS1_DATA, characters and chats are SS5A_DATA stores;
   every page reads them by id at render time. The only drafts are the text being typed, the recording state and an open dialog.
   Floor devices (Note 9 / Android 10 WebView, Raspberry Pi 3): no optional chaining, nullish coalescing, .at(), replaceAll or structuredClone; checks/ss5a/modes.mjs scans for them.
   Sections: helpers, icons, state and stores, undo and 최근 삭제, shortcuts, personas, plugins, modules, dialogs, events, hooks, states, public API. */
(() => {
'use strict';
const X = window.SS1_EXT;
const D = window.SS1_DATA, D5 = window.SS5A_DATA;
const Q = new URLSearchParams(location.search);
let A = null, B = null;                  // A: slice 1 API (from X.boot); B: window.__ss2 (slice 2: undo stack, toast)
const { K, FLAGS, CHARS, CHATS, PLUGIN_FILES } = D5;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ic = (n, s, c) => A.ic(n, s, c);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KO = () => A.S.lang === 'ko';
const pick = (ko, en) => (KO() ? ko : (en === undefined || en === '' ? ko : en));
const P5 = {
  platform: D5.PLATFORM, flags: FLAGS, kbd: FLAGS.kbd,
  sub: null,                              // { kind: 'persona' | 'plugin' | 'module', id }: the open sub-page (a drill-in with Back)
  hk: { rec: null, conf: null, msg: '' },  // the recording state and the conflict being asked about (drafts; nothing else holds a copy)
  per: { q: '', sel: '', drag: null }, mod: { q: '', sort: 'name', on: false, low: false, mcp: false },
  pl: { res: null, checking: false, autoRun: false }, trash: [], listScroll: {}, retFk: '', pending: null, roForce: false,
  open: { details: false }, fresh: '', missing: [], booted: false, seq: 0, writes: 0, argDraft: {},
};
const t5 = (k, ...a) => { const v = K[A.S.lang][k]; if (v === undefined) { P5.missing.push(k); return '⟦' + k + '⟧'; } return typeof v === 'function' ? v(...a) : v; };
const MAC = () => P5.platform === 'mac';
const pageOf = (kind) => (kind === 'persona' ? 'persona' : 'ext');

/* ------------------------------------------------------------------ icons (Lucide paths, inline; copied, not imported) */
const ICONS5 = {
  'at-sign': '<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/>',
  'waypoints': '<path d="m10.586 5.414-5.172 5.172"/><path d="m18.586 13.414-5.172 5.172"/><path d="M6 12h12"/><circle cx="12" cy="20" r="2"/><circle cx="12" cy="4" r="2"/><circle cx="20" cy="12" r="2"/><circle cx="4" cy="12" r="2"/>',
  'file-up': '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M12 12v6"/><path d="m15 15-3-3-3 3"/>',
  'shield-alert': '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
  'shield-check': '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  'sparkles': '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/>',
  'compass': '<circle cx="12" cy="12" r="10"/><path d="m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z"/>',
  'eraser': '<path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/>',
  'user-plus': '<path d="M2 21a8 8 0 0 1 13.292-6"/><circle cx="10" cy="8" r="5"/><path d="M19 16v6"/><path d="M22 19h-6"/>',
};

/* ------------------------------------------------------------------ small helpers */
const jI = (n) => n; void jI;
function announce(msg) { A.announce(msg); }
const stores = () => ({ personas: D.personas, plugins: D.plugins, modules: A.S.modules });
const byId = (list, id) => list.find((x) => x.id === id) || null;
const persona = (id) => byId(D.personas, id);
const plugin = (id) => byId(D.plugins, id);
const mod = (id) => byId(A.S.modules, id);
const chat = (id) => byId(CHATS, id);
const char = (id) => byId(CHARS, id);
const nameOf = (x) => (x ? pick(x.ko !== undefined ? x.ko : x.name, x.en) : '');
const pname = (p) => p.name;
const pnote = (p) => (KO() ? p.note : (p.noteEn || p.note)) || '';
const firstLine = (s) => String(s || '').split(/\r?\n/)[0];
const mnote = (m) => (KO() ? m.note : (m.noteEn || m.note)) || '';
const plnote = (p) => (KO() ? p.note : (p.noteEn || p.note)) || '';
const studioLink = (id, kind) => '../studio/slice1.html?owner=module:' + encodeURIComponent(id) + (kind ? '&kind=' + kind : '') + '&from=settings';
const initialOf = (n) => String(n || '?').trim().slice(0, 1).toUpperCase() || '?';
function copyText(s) { try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(s); } catch (e) { /* the mockup only announces */ } }
function download(name, text) {   // a real download of synthetic text (no network): blob URL, one click
  try { const u = URL.createObjectURL(new Blob([text], { type: 'text/plain' })); const a = document.createElement('a'); a.href = u; a.download = name; a.hidden = true; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 1000); } catch (e) { /* ignore */ }
}
function toast(msg, o) { B.psToast(msg, o || {}); }
function toastUndo(msg, entry, o) { toast(msg, Object.assign({ action: { label: t5('undo'), title: t5('undo') + ' (Alt+Z)', fn: () => B.runLU(entry.id) }, until: 'page' }, o || {})); }
function pushLU(label, undo, kind, data) { return B.pushLU(label, undo, kind, data); }
const inMine = () => A.S.open && (A.S.page === 'keys' || A.S.page === 'persona' || A.S.page === 'ext') && A.S.view === 'page';
function repaint(focusFk) {   // re-render the page keeping scroll; the focused control is found again by its data-fk
  if (!A.S.open) return; const a = document.activeElement; const fk = focusFk || (a && a.getAttribute ? a.getAttribute('data-fk') : '');
  if (P5.defer) { setTimeout(() => repaint(fk), 0); return; }   // a change event fired by a blur: the page is not replaced while the browser is still moving focus
  A.refreshPage(); const mine = $('#pageScroll');
  if (fk && mine) { const e = $(`[data-fk="${CSS.escape(fk)}"]`, mine); if (e) e.focus({ preventScroll: true }); }
}
function focusFk(fk) { const e = fk && $(`#pageScroll [data-fk="${CSS.escape(fk)}"]`); if (e) { e.focus({ preventScroll: true }); return true; } return false; }

/* ------------------------------------------------------------------ 최근 삭제 (DS-024): the deleted personas, plugins and modules of this session, with 복원 and 영구 삭제 */
function trashAdd(kind, item, restore, label) { const e = { id: 'tr' + (++P5.seq), kind, item, restore, label, at: Date.now() }; P5.trash.unshift(e); return e; }
function luDrop(tr) { if (!tr || !tr.lu) return; const i = B.LU.findIndex((x) => x.id === tr.lu); if (i >= 0) B.LU.splice(i, 1); }   // a purge or a restore from 최근 삭제 takes the matching undo step with it (R5-8a)
function trashDrop(id) { const i = P5.trash.findIndex((e) => e.id === id); if (i >= 0) P5.trash.splice(i, 1); }
function openTrash(kind) {
  const items = P5.trash.filter((e) => e.kind === kind);
  const body = items.length ? `<ul class="p5-trashl" role="list">${items.map((e) => `<li class="p5-trashi"><span class="p5-trashn">${esc(e.label)}</span><button type="button" class="btn solid" data-dlg="restore:${e.id}" aria-label="${esc(t5('restore') + ': ' + e.label)}" data-part="settings-button">${ic('undo-2', 'md')}<span>${esc(t5('restore'))}</span></button><button type="button" class="btn" data-dlg="purge:${e.id}" aria-label="${esc(t5('purge') + ': ' + e.label)}" title="${esc(t5('purge'))}" data-part="settings-button">${ic('trash-2', 'lg')}</button></li>`).join('')}</ul>` : `<p class="p5-trashe">${esc(t5('trashEmpty'))}</p>`;
  const d = A.openDialog({ title: t5('trashTitle'), body, buttons: [{ id: 'ok', label: t5('close'), primary: true }] });
  const h = {};
  items.forEach((e) => {
    h['restore:' + e.id] = () => { setTimeout(() => { e.restore(); luDrop(e); trashDrop(e.id); A.buildIndex(); repaint(); toast(t5('restored', e.label), { kind: 'trash-restore' }); }, 0); };
    h['purge:' + e.id] = () => { setTimeout(() => confirmPurge(e), 0); };   // DD-229: 영구 삭제 asks first (the list closes with the click; Cancel comes back to it)
  });
  A.openDialog.handlers = h; return d;
}
function confirmPurge(e) {   // DD-229: name, count and size; the undo step goes with the purge, so 되돌릴 수 없어요 is true
  if (!P5.trash.some((x) => x.id === e.id)) return;
  const tb = (D5.TRASH_KB || {})[e.kind] || {}; const kb = tb[e.item && e.item.id] !== undefined ? tb[e.item.id] : (tb._ || 0); const eul = KO() ? (B.josa ? B.josa(e.label, 'eul') : A.pEul(e.label)) : '';   // slice 2's josa also reads Latin letters and digits (Alex: 를); slice 1's pEul is the fallback
  const d = A.openDialog({ critical: true, title: t5('purgeQ', e.label, eul), body: `<p>${esc(t5('purgeBody', A.fmtNum(kb)))}</p>`, buttons: [{ id: 'cancel', label: t5('cancel') }, { id: 'ok', label: t5('purge'), danger: true, icon: 'trash-2' }], initial: '[data-dlg="cancel"]',
    onClose: (why) => setTimeout(() => {   // Cancel and Esc come back to the list on this item; Confirm comes back to it too when items remain, on the next item (nothing left: no list, focus returns to the 최근 삭제 button)
      const rest = P5.trash.filter((x) => x.kind === e.kind); if (!rest.length) return;
      const l = openTrash(e.kind); const target = why === 'ok' ? rest[Math.min(Math.max(order, 0), rest.length - 1)] : e; const b = l && target && l.back.querySelector('[data-dlg="purge:' + target.id + '"]'); if (b) b.focus({ preventScroll: true });
    }, 0) });
  const order = P5.trash.filter((x) => x.kind === e.kind).indexOf(e);
  A.openDialog.handlers = { ok: () => { luDrop(e); trashDrop(e.id); toast(t5('purged', e.label), { kind: 'purge', ms: 4000 }); } };
  void d;
}
const trashBtn = (kind) => { const n = P5.trash.filter((e) => e.kind === kind).length; return `<button type="button" class="btn p5-trashbtn" data-p5="trash" data-kind="${kind}" data-fk="trash:${kind}" aria-label="${esc(t5('trashBtn') + (n ? ' (' + n + ')' : ''))}" title="${esc(t5('trashBtn'))}" data-part="settings-button">${ic('history', 'xl')}${n ? `<span class="p5-trashn2">${n}</span>` : ''}</button>`; };
function ask(o) {   // a confirm: title, body html, ok label, danger?, critical dialogs get the critical parts
  const d = A.openDialog({ critical: o.critical !== false, title: o.title, body: o.body, buttons: [{ id: 'cancel', label: t5('cancel') }, { id: 'ok', label: o.ok, danger: !!o.danger, primary: !o.danger }], initial: '[data-dlg="cancel"]', onClose: o.onClose });
  A.openDialog.handlers = { ok: () => { setTimeout(o.onOk, 0); } }; return d;
}

/* ------------------------------------------------------------------ page frame shared by the three pages */
function headHTML(pid, extra) {
  const P = A.PAGE[pid]; let h = `<div class="pg p5 p5-${pid}${A.S.big ? '' : ''}" data-page="${pid}" data-part="settings-page-body"><div class="pg-head" data-part="settings-page-header"><h1 class="pg-title" id="pgTitle" tabindex="-1">${esc(A.L(P))}</h1>`;
  if (A.S.notice) h += `<p class="banner warn" data-part="settings-warning-banner" data-part-critical role="status">${ic('info', 'lg')}<span>${esc(A.S.notice)}</span></p>`;
  return h + (extra || '') + '</div>';
}
function subHead(title, sub, extra) {   // the head of a sub-page: the name is the h1
  let h = `<div class="pg p5 p5-sub" data-page="${pageOf(P5.sub.kind)}" data-view="${P5.sub.kind}" data-part="settings-page-body"><div class="pg-head" data-part="settings-page-header"><h1 class="pg-title" id="pgTitle" tabindex="-1">${esc(title)}</h1>`;
  if (sub) h += sub;
  return h + (extra || '') + '</div>';
}
const secOpen = (id, title, cls) => `<section class="sec${cls ? ' ' + cls : ''}" id="sec-${id}" data-sec="${id}" data-part="settings-section" aria-labelledby="h-${id}"><h2 class="sec-h" id="h-${id}" data-part="settings-section-title" tabindex="-1">${esc(title)}</h2>`;

/* ------------------------------------------------------------------ 단축키 (DS-103, DS-106 to DS-109) */
const hkHidden = (r) => (r.cond === 'scroll' && !P5.flags.scroll) || (r.cond === 'msel' && !P5.flags.msel);   // DS-108: an action without a handler is not listed; scrollToActiveChar follows its setting
const hkRows = () => D.rows.filter((r) => r.page === 'keys' && r.type === 'key' && !hkHidden(r));
const hkRow = (id) => D.rows.find((r) => r.id === id) || null;
const norm = (c) => String(c || '').split('+').map((x) => x.toLowerCase()).sort().join('+');
const cparts = (c) => (c ? String(c).split('+') : []);
const KEYCAP = { Plus: '+', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Backspace: '⌫', Delete: 'Del' };
function cap(tok) { if (MAC()) { if (tok === 'Ctrl') return '⌘'; if (tok === 'Alt') return '⌥'; if (tok === 'Shift') return '⇧'; } return KEYCAP[tok] || tok; }
function spoken(c) { return cparts(c).map((tok) => (MAC() ? ({ Ctrl: 'Command', Alt: 'Option', Shift: 'Shift' }[tok] || tok) : tok === 'Space' ? t5('hkSpace') : tok)).join(' '); }
function capsHTML(c, extraCls) {
  const p = cparts(c); if (!p.length) return `<span class="p5-unbound">${esc(t5('hkUnbound'))}</span>`;
  return `<span class="keys p5-keys${extraCls ? ' ' + extraCls : ''}">${p.map((k) => `<kbd>${esc(cap(k))}</kbd>`).join(MAC() ? '' : '<span class="plus" aria-hidden="true">+</span>')}</span>`;
}
const display = (c) => (c ? cparts(c).map(cap).join(MAC() ? '' : '+') : t5('hkUnbound'));
const fineInput = () => !!(window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches);
const hkRO = () => P5.roForce || ($('#app').clientWidth < 768 && !P5.kbd && !fineInput());   // phones and tablets without a hardware keyboard: a read-only list (SLICE1_SPEC 3.2); a desktop window with a mouse and a keyboard is never read-only however narrow it is (R5-5)
function dupsOf(r) { const c = norm(r.v); if (!c) return []; return hkRows().filter((x) => x !== r && norm(x.v) === c); }
function dupChords() { const m = {}; hkRows().forEach((r) => { const c = norm(r.v); if (c) (m[c] = m[c] || []).push(r); }); return Object.keys(m).filter((c) => m[c].length > 1); }
const slotWho = (r) => { const id = B.SLOT[r.slot]; const p = id && B.P(id); return p ? p.name : t5('hkSlotEmpty'); };
function hkRowHTML(r, ro) {
  const lab = A.L(r), c = r.v || '', fixed = !!r.fixed, ch = !fixed && c !== (r.d || '');
  const rec = !!P5.hk.rec && P5.hk.rec.id === r.id, cf = P5.hk.conf && P5.hk.conf.id === r.id ? P5.hk.conf : null, dups = fixed ? [] : dupsOf(r);
  const lid = 'l-' + r.id, did = 'd-' + r.id;
  let sub = r.slot ? t5('hkSlotWho', slotWho(r)) : (r.desc ? A.pair(r.desc) : '');
  let chord;
  if (fixed || ro) chord = `<span class="p5-chord ro" data-part="settings-hotkey-chord" data-part-critical role="img" aria-label="${esc(t5('hkRoAria', spoken(c)))}">${capsHTML(c)}</span>`;
  else if (rec) {
    const held = cparts(P5.hk.rec.held);
    chord = `<button type="button" class="btn p5-chord rec" data-part="settings-hotkey-chord" data-part-critical data-p5="rec" data-id="${esc(r.id)}" data-fk="hk:${esc(r.id)}:chord" data-ctl aria-pressed="true" aria-label="${esc(t5('hkRecAria', lab))}"><span class="keys p5-keys">${held.map((k) => `<kbd>${esc(cap(k))}</kbd>`).join(MAC() ? '' : '<span class="plus" aria-hidden="true">+</span>')}${held.length ? (MAC() ? '' : '<span class="plus" aria-hidden="true">+</span>') : ''}<kbd class="p5-wait">…</kbd></span></button>`;
  } else chord = `<button type="button" class="btn p5-chord" data-part="settings-hotkey-chord" data-part-critical data-p5="rec" data-id="${esc(r.id)}" data-fk="hk:${esc(r.id)}:chord" data-ctl aria-label="${esc(c ? t5('hkAria', lab, spoken(c)) : t5('hkAriaNone', lab))}">${capsHTML(c)}</button>`;
  const recLine = rec ? `<p class="p5-recline" data-part="settings-hotkey-recording" data-part-critical role="status" aria-live="polite">${ic('keyboard', 'sm')}<span>${esc(P5.hk.msg || t5('hkRecPrompt'))}</span></p>` : '';
  let conflict = '';
  if (cf && !ro) {
    const o = hkRow(cf.other); const fx = !!o.fixed;
    conflict = `<div class="p5-conflict" data-part="settings-hotkey-conflict" data-part-critical data-kind="${fx ? 'fixed' : 'swap'}" role="alert"><p class="p5-conft">${ic('triangle-alert', 'md')}<span class="p5-pend">${capsHTML(cf.combo)}</span><span class="p5-conmsg">${esc(fx ? t5('hkFixed', display(cf.combo)) : t5('hkConflict', A.L(o)))}</span></p>${fx ? '' : `<p class="p5-confo">${esc(t5('hkSwapOutcome', A.L(o), c ? display(c) : ''))}</p>`}<div class="p5-confb">${fx ? '' : `<button type="button" class="btn solid" data-part="settings-hotkey-conflict-action" data-part-critical data-p5="swap" data-id="${esc(r.id)}" data-fk="hk:${esc(r.id)}:swap">${ic('refresh-cw', 'md')}<span>${esc(t5('hkSwap'))}</span></button>`}<button type="button" class="btn solid" data-part="settings-hotkey-conflict-action" data-part-critical data-p5="conf-cancel" data-id="${esc(r.id)}" data-fk="hk:${esc(r.id)}:cancel">${ic('x', 'md')}<span>${esc(fx ? t5('ok') : t5('cancel'))}</span></button></div></div>`;
  } else if (dups.length) conflict = `<div class="p5-conflict" data-part="settings-hotkey-conflict" data-part-critical data-kind="dup" role="group" aria-label="${esc(lab + ': ' + t5('hkAlso', dups.map(A.L).join(', ')))}"><p class="p5-conft">${ic('triangle-alert', 'md')}<span>${esc(t5('hkAlso', dups.map(A.L).join(' · ')))}</span></p></div>`;
  const menu = fixed || ro ? '' : `<button type="button" class="btn p5-more" data-part="settings-button" data-p5="hk-menu" data-id="${esc(r.id)}" data-fk="hk:${esc(r.id)}:menu" aria-haspopup="menu" aria-label="${esc(t5('menuOf', lab))}" title="${esc(t5('menuOf', lab))}">${ic('ellipsis', 'xl')}</button>`;
  return `<div class="row p5-hk${ch ? ' changed' : ''}${rec ? ' rec' : ''}" data-row="${esc(r.id)}" data-part="settings-hotkey-row" role="group" aria-labelledby="${lid}"${sub ? ` aria-describedby="${did}"` : ''}${fixed ? ' tabindex="-1"' : ''}${dups.length || cf ? ' data-conflict' : ''}>` +
    `<span class="dot" aria-hidden="true"${ch ? '' : ' hidden'}></span><div class="p5-hkmain"><div class="r-text"><span class="r-label" id="${lid}" data-part="settings-row-label">${esc(lab)}<span class="sr-only r-chg">${ch ? ' (' + esc(t5('changed')) + ')' : ''}</span></span>${sub ? `<span class="r-desc" id="${did}" data-part="settings-row-description">${esc(sub)}</span>` : ''}</div><div class="p5-hkctl">${chord}${menu}</div></div>${recLine}${conflict}</div>`;
}
function keysPageHTML() {
  const ro = hkRO(); const dc = dupChords();
  let tools = '';
  if (!ro) { const n = hkRows().filter((r) => !r.fixed && (r.v || '') !== (r.d || '')).length; tools = `<div class="p5-tools" data-part="settings-list-tools"><button type="button" class="btn solid" data-part="settings-button" data-p5="hk-resetall" data-fk="hk:resetall" data-ctl${n ? '' : ' aria-disabled="true"'} title="${esc(n ? t5('hkResetAllN', n) : t5('hkResetNone'))}">${ic('rotate-ccw', 'md')}<span>${esc(t5('hkResetAll'))}</span></button></div>`; }
  let extra = '';
  if (ro) extra += `<p class="banner" data-part="settings-hotkey-banner" role="note">${ic('keyboard', 'lg')}<span>${esc(t5('hkPhone'))}</span></p>`;
  if (dc.length) extra += `<p class="banner warn" id="hkDupBanner" data-part="settings-hotkey-banner" role="status">${ic('triangle-alert', 'lg')}<span>${esc(t5('hkDupBanner', dc.length))}</span></p>`;
  let h = headHTML('keys', extra) + tools;
  const groups = [['msg', 'keys.msg'], ['nav', 'keys.nav'], ['slot', 'keys.slots'], ['tool', 'keys.tools'], ['fixed', 'keys.fixed']].map((g) => [g[1], hkRows().filter((r) => r.grp === g[0])]).filter((g) => g[1].length);
  h += `<nav class="chips" data-part="settings-jump-chips" aria-label="${esc(A.t('sectionNav'))}">${groups.map((g) => `<button type="button" class="chip-b" data-secjump="${g[0]}">${esc(A.L(A.SEC[g[0]]))}</button>`).join('')}</nav>`;
  groups.forEach((g) => { h += secOpen(g[0], A.L(A.SEC[g[0]])) + `<div class="rows" data-part="settings-rows">${g[1].map((r) => hkRowHTML(r, ro)).join('')}</div></section>`; });
  return h + '</div>';
}
function hkPaint(id, refocus) {   // one row in place (the recording preview and its messages); the focus stays on the chord button
  const r = hkRow(id), el = $(`#pageScroll .p5-hk[data-row="${CSS.escape(id)}"]`); if (!r || !el) return;
  const had = refocus || el.contains(document.activeElement); const tmp = document.createElement('div'); tmp.innerHTML = hkRowHTML(r, hkRO()); el.replaceWith(tmp.firstElementChild);
  if (had) { const b = $(`#pageScroll [data-fk="hk:${CSS.escape(id)}:chord"]`) || $(`#pageScroll [data-fk="hk:${CSS.escape(id)}:swap"]`); if (b) b.focus({ preventScroll: true }); }
}
function hkListen(on) { const f = on ? 'addEventListener' : 'removeEventListener'; document[f]('keydown', hkKey, true); document[f]('keyup', hkKeyUp, true); document[f]('pointerdown', hkOutside, true); document[f]('focusin', hkFocusMoved, true); window[f]('blur', hkLeft); }
function hkCancelRec() { const r = P5.hk.rec; if (!r) return; hkStopRec(); announce(t5('hkCancelled')); }
function hkOutside(ev) { if (P5.hk.rec && !(ev.target && ev.target.closest && ev.target.closest('.p5-hk.rec'))) hkCancelRec(); }   // a click anywhere else ends recording (R5-2)
function hkFocusMoved(ev) { const r = P5.hk.rec; if (r && !(ev.target && ev.target.getAttribute && ev.target.getAttribute('data-fk') === 'hk:' + r.id + ':chord')) hkCancelRec(); }   // so does focus leaving the chord button
function hkLeft() { hkCancelRec(); }
function hkStartRec(id) {
  hkStopRec(true); const old = P5.hk.conf; P5.hk.conf = null; if (old) hkPaint(old.id);
  P5.hk.rec = { id, held: '' }; P5.hk.msg = ''; hkListen(true); hkPaint(id, true); announce(t5('hkRecPrompt'));
}
function hkStopRec(silent) { const r = P5.hk.rec; if (!r) return false; P5.hk.rec = null; P5.hk.msg = ''; hkListen(false); if (!silent) hkPaint(r.id); return true; }
function badMods(ev) { if (ev.getModifierState && ev.getModifierState('AltGraph')) return 'hkAltGr'; if (MAC()) return ev.ctrlKey ? 'hkMacCtrl' : ''; return ev.metaKey ? 'hkSuper' : ''; }   // DS-120: the control key on a Mac is refused, the Windows / Super key is never recorded as Ctrl, AltGr is not a chord
function heldOf(ev) { const ctrl = MAC() ? ev.metaKey : ev.ctrlKey; return [ctrl ? 'Ctrl' : '', ev.altKey ? 'Alt' : '', ev.shiftKey ? 'Shift' : ''].filter(Boolean).join('+'); }
function hkPreview(ev) { const rec = P5.hk.rec; if (!rec) return; const h = heldOf(ev); if (h === rec.held) return; rec.held = h; hkPaint(rec.id, true); }
function hkKeyUp(ev) { if (P5.hk.rec && ['Control', 'Alt', 'Shift', 'Meta', 'AltGraph'].indexOf(ev.key) >= 0) { ev.stopImmediatePropagation(); hkPreview(ev); } }
function keyName(ev) {
  const code = ev.code || ''; let m; if ((m = /^Digit(\d)$/.exec(code))) return m[1]; if ((m = /^Key([A-Z])$/.exec(code))) return m[1];
  const k = ev.key; if (k === ' ') return 'Space'; if (k === '+') return 'Plus'; return k.length === 1 ? k.toUpperCase() : k;
}
function chordOf(ev) { const h = heldOf(ev); const key = keyName(ev); return { mods: h, key, str: (h ? h + '+' : '') + key, plain: !h, bad: badMods(ev) }; }
const NAVKEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backspace', 'Delete', 'Home', 'End', 'PageUp', 'PageDown', 'Insert', 'ContextMenu', 'CapsLock', 'NumLock', 'ScrollLock', 'Pause', 'PrintScreen'];
function hkValidate(r, c) {   // the keys that cannot be recorded (DS-106, DS-118, DS-120 and SLICE5A_SPEC 2.2); null when it can
  if (c.bad) return c.bad;
  const fk = /^F([1-9]|1[0-2])$/.test(c.key);
  if (c.plain) {   // DS-118: every shortcut needs a modifier or an F-key; Space alone only for focus input
    if (fk) return ['F5', 'F11', 'F12'].indexOf(c.key) >= 0 ? 'hkBrowser' : null;
    if (c.key === 'Space' && r.code === 'focusInput') return null;
    return NAVKEYS.indexOf(c.key) >= 0 ? 'hkNavKey' : 'hkBare';
  }
  if (c.mods === 'Shift' && !fk) return 'hkShiftOnly';
  if (c.mods === 'Ctrl') { if (['W', 'T', 'N', 'L', 'R'].indexOf(c.key) >= 0) return 'hkBrowser'; if (['V', 'C', 'X', 'A', 'Z'].indexOf(c.key) >= 0) return 'hkEdit'; }
  if (c.mods === 'Ctrl+Shift' && ['T', 'N', 'W'].indexOf(c.key) >= 0) return 'hkBrowser';
  if (c.mods === 'Alt' && c.key === 'F4') return 'hkBrowser';
  return null;
}
function hkKey(ev) {
  const rec = P5.hk.rec; if (!rec) return;
  if (ev.isComposing || ev.keyCode === 229) return;                         // IME composition is ignored (no preventDefault: the IME keeps its key)
  const fa = document.activeElement; if (!fa || !fa.getAttribute || fa.getAttribute('data-fk') !== 'hk:' + rec.id + ':chord') { hkStopRec(true); return; }   // focus is elsewhere (typing in search, a dialog): nothing is swallowed (R5-2)
  if (ev.key === 'Tab') { hkStopRec(); return; }                              // Tab and Shift+Tab leave recording without a change; focus is never trapped
  ev.preventDefault(); ev.stopImmediatePropagation(); if (ev.repeat) return;
  if (ev.key === 'Escape') { const id = rec.id; hkStopRec(); announce(t5('hkCancelled')); focusFk('hk:' + id + ':chord'); return; }
  if (['Control', 'Alt', 'Shift', 'Meta', 'AltGraph'].indexOf(ev.key) >= 0) { hkPreview(ev); return; }   // a modifier alone only updates the preview
  const r = hkRow(rec.id); const c = chordOf(ev); const err = hkValidate(r, c);
  if (err) { P5.hk.msg = t5(err); hkPaint(rec.id, true); announce(P5.hk.msg); return; }
  hkAssign(r, c.str);
}
function hkAssign(r, combo) {   // commit, or stop and ask when another action has the chord (DS-106)
  if (norm(combo) === norm(r.v)) { hkStopRec(); announce(t5('hkSame')); focusFk('hk:' + r.id + ':chord'); return; }
  const o = hkRows().filter((x) => x !== r && norm(x.v) === norm(combo))[0];
  if (o) { hkStopRec(true); P5.hk.conf = { id: r.id, combo, other: o.id }; hkPaint(r.id); const f = $(`#pageScroll [data-fk="hk:${CSS.escape(r.id)}:${o.fixed ? 'cancel' : 'swap'}"]`); if (f) f.focus({ preventScroll: true }); announce(o.fixed ? t5('hkFixed', display(combo)) : t5('hkConflict', A.L(o))); return; }
  hkCommit(r, combo);
}
function hkCommit(r, combo) {
  const old = r.v || ''; hkStopRec(true); P5.hk.conf = null; r.v = combo;
  const e = pushLU(t5('hkLu', A.L(r)), () => { if ((r.v || '') === combo) { r.v = old; return ''; } return t5('hkSkip'); }, 'hotkey');
  A.buildIndex(); repaint('hk:' + r.id + ':chord'); toastUndo(combo ? t5('hkSet') : t5('hkCleared'), e, { sub: A.L(r) + ' · ' + display(combo) }); announce(A.L(r) + ': ' + display(combo));
}
function hkSwap(id) {
  const cf = P5.hk.conf; if (!cf || cf.id !== id) return; const r = hkRow(id), o = hkRow(cf.other); if (!r || !o || o.fixed) return;
  const mine = r.v || '', theirs = o.v || ''; P5.hk.conf = null; r.v = cf.combo; o.v = mine;
  const e = pushLU(t5('hkLuSwap', A.L(r)), () => { if ((r.v || '') === cf.combo && (o.v || '') === mine) { r.v = mine; o.v = theirs; return ''; } return t5('hkSkip'); }, 'hotkey');
  A.buildIndex(); repaint('hk:' + r.id + ':chord'); toastUndo(t5('hkSwapped'), e, { sub: A.L(r) + ' ⇄ ' + A.L(o) }); announce(t5('hkSwapped'));
}
function hkClear(r) { if (!r.v) return; hkCommit(r, ''); }
function hkResetOne(r) { if ((r.v || '') === (r.d || '')) return; hkAssign(r, r.d); }
function hkResetAll() {
  const rows = hkRows().filter((r) => !r.fixed && (r.v || '') !== (r.d || '')); if (!rows.length) { announce(t5('hkResetNone')); return; }
  ask({ title: t5('hkResetAllQ', rows.length), body: `<p>${esc(t5('hkResetAllBody'))}</p>`, ok: t5('hkResetAll'), onOk: () => {
    const before = rows.map((r) => [r, r.v || '']); rows.forEach((r) => { r.v = r.d; });
    const e = pushLU(t5('hkLuAll', rows.length), () => { before.forEach((b) => { b[0].v = b[1]; }); return ''; }, 'hotkey');
    A.buildIndex(); repaint('hk:resetall'); toastUndo(t5('hkResetAllDone', rows.length), e); },
    onClose: () => { const b = $('#pageScroll [data-fk="hk:resetall"]'); if (b) b.focus({ preventScroll: true }); } });
}
function hkMenu(id, anchor, point, opener) {
  const r = hkRow(id); const ch = (r.v || '') !== (r.d || '');
  A.showMenu([{ icon: 'keyboard', label: t5('hkMenuRec'), fn: () => hkStartRec(id) }, { icon: 'rotate-ccw', label: t5('hkMenuReset'), disabled: !ch, fn: () => hkResetOne(r) }, { icon: 'eraser', label: t5('hkMenuClear'), disabled: !r.v, fn: () => hkClear(r) }], anchor, point || null, opener || anchor, t5('menuOf', A.L(r)));
}

/* ------------------------------------------------------------------ 페르소나 (DS-110, DS-111) */
const ICON_CYCLE = ['', 'user-round', 'sparkles', 'compass', 'book-open', 'star', 'heart', 'moon'];
const PER_FILES = [{ id: 'i1', file: '주디.png', name: '주디', desc: '한적한 마을에서 약을 짓는 약사예요.', ok: true }, { id: 'i2', file: 'Rex.png', name: 'Rex', desc: 'A retired racing pilot who tells long stories.', ok: true }, { id: 'i3', file: 'broken.png', name: '', desc: '', ok: false }];
const activePersonaId = () => { const a = persona(A.S.personaActive); return a ? a.id : (D.personas[0] ? D.personas[0].id : ''); };
const boundChats = (id) => CHATS.filter((c) => c.persona === id);
const perSplit = () => A.S.lay === 'wide';
function perCurrentId() {
  if (P5.sub && P5.sub.kind === 'persona' && persona(P5.sub.id)) return P5.sub.id;
  if (P5.per.sel && persona(P5.per.sel)) return P5.per.sel; return activePersonaId();
}
function avatarHTML(p, cls) {
  return `<span class="p5-av${cls ? ' ' + cls : ''}" aria-hidden="true">${p.icon ? ic(p.icon, 'xl') : `<span class="p5-ini">${esc(initialOf(p.name))}</span>`}</span>`;
}
function perCardHTML(p, i, n, sel) {
  const act = p.id === activePersonaId(), cnt = boundChats(p.id).length, note = P5.flags.note ? firstLine(pnote(p)) : '';
  const nm = p.name || t5('perNoName');
  return `<li class="p5-card${sel ? ' is-sel' : ''}${act ? ' cur' : ''}${P5.fresh === p.id ? ' p5-new' : ''}" data-p5id="persona:${p.id}" data-part="settings-persona-card"${act ? ' data-current' : ''}${sel ? ' data-selected' : ''}>` +
    `<button type="button" class="btn p5-handle" data-part="settings-persona-handle" tabindex="-1" aria-hidden="true" data-p5="drag" data-id="${p.id}" data-fk="pe:${p.id}:drag" aria-label="${esc(t5('perHandle', nm))}" title="${esc(t5('perHandle', nm))}">${ic('grip-vertical', 'lg')}</button>` +
    `<a class="p5-cardmain" href="?page=persona&view=persona&id=${p.id}" data-p5="open-persona" aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown" data-id="${p.id}" data-fk="pe:${p.id}:open"${sel ? ' aria-current="true"' : ''}>${avatarHTML(p)}<span class="p5-ct"><span class="p5-nrow"><span class="p5-name">${esc(nm)}</span>${act ? `<span class="p5-active" data-part="settings-persona-active" data-part-critical>${ic('check', 'md')}<span>${esc(t5('perActive'))}</span></span>` : ''}</span>${note ? `<span class="p5-note">${esc(note)}</span>` : ''}<span class="p5-cnt" data-part="settings-persona-count">${esc(act ? t5('perChatsActive', cnt) : t5('perChats', cnt))}</span></span></a>` +
    `<button type="button" class="btn p5-more" data-part="settings-button" data-p5="per-menu" data-id="${p.id}" data-fk="pe:${p.id}:menu" aria-haspopup="menu" aria-label="${esc(t5('menuOf', nm))}" title="${esc(t5('menuOf', nm))}">${ic('ellipsis', 'xl')}</button></li>`;
}
function perEditorHTML(p, noHead) {
  const act = p.id === activePersonaId(), last = D.personas.length <= 1, bound = boundChats(p.id), nm = p.name || t5('perNoName');
  return `<section class="p5-ed" data-part="settings-persona-editor" data-id="${p.id}" ${noHead ? `aria-label="${esc(nm)}">` : `aria-labelledby="p5-edh"><h2 class="sec-h p5-edh" id="p5-edh" data-part="settings-section-title" tabindex="-1">${esc(nm)}</h2>`}` +
    `<div class="p5-edtop"><button type="button" class="p5-portrait${p.large ? ' large' : ''}" data-part="settings-persona-portrait" data-p5="portrait" data-id="${p.id}" data-fk="pe:${p.id}:portrait" aria-label="${esc(t5('perPortrait'))}" title="${esc(t5('perPortrait'))}">${avatarHTML(p, 'big')}<span class="p5-portcap">${ic('image', 'md')}</span></button>` +
    `<div class="p5-edsw"><label class="p5-swl"><span class="sw" data-part="settings-toggle"><input type="checkbox" role="switch" data-p5i="large" data-id="${p.id}" data-fk="pe:${p.id}:large"${p.large ? ' checked' : ''}><span class="sw-ui" aria-hidden="true"></span></span><span class="p5-swt">${esc(t5('perLarge'))}</span></label><p class="r-desc" data-part="settings-row-description">${esc(p.large ? t5('perLargeOn') : t5('perLargeOff'))}</p></div></div>` +
    `<div class="p5-fld"><label class="dlg-l" for="p5n-${p.id}">${esc(t5('perName'))}</label><input id="p5n-${p.id}" class="inp" data-part="settings-field" data-p5i="name" data-id="${p.id}" data-fk="pe:${p.id}:name" value="${esc(p.name)}" autocomplete="off" spellcheck="false"></div>` +
    (P5.flags.note ? `<div class="p5-fld"><label class="dlg-l" for="p5m-${p.id}">${esc(t5('perNote'))}</label><input id="p5m-${p.id}" class="inp" data-part="settings-field" data-p5i="note" data-id="${p.id}" data-fk="pe:${p.id}:note" value="${esc(pnote(p))}" autocomplete="off" spellcheck="false"></div>` : '') +
    `<div class="p5-fld"><label class="dlg-l" for="p5d-${p.id}">${esc(t5('perDesc'))}</label><textarea id="p5d-${p.id}" class="inp ta" data-part="settings-field" data-p5i="desc" data-id="${p.id}" data-fk="pe:${p.id}:desc" rows="5" spellcheck="false">${esc(p.desc)}</textarea><p class="p5-count r-desc" id="p5c-${p.id}" data-part="settings-row-description">${esc(t5('perDescCount', p.desc.length))}</p></div>` +
    `<div class="p5-acts"><button type="button" class="btn solid${act ? '' : ' accent'}" data-part="settings-button" data-p5="per-use" data-id="${p.id}" data-fk="pe:${p.id}:use"${act ? ' aria-disabled="true"' : ''}>${ic(act ? 'check' : 'user-round', 'md')}<span>${esc(act ? t5('perUsed') : t5('perUse'))}</span></button>` +
    `<button type="button" class="btn solid" data-part="settings-button" data-p5="per-export" data-id="${p.id}" data-fk="pe:${p.id}:export">${ic('download', 'md')}<span>${esc(t5('perExport'))}</span></button>` +
    `<button type="button" class="btn solid" data-part="settings-button" data-p5="per-dup" data-id="${p.id}" data-fk="pe:${p.id}:dup">${ic('copy', 'md')}<span>${esc(t5('perDup'))}</span></button>` +
    `<button type="button" class="btn solid danger" data-part="settings-button" data-p5="per-del" data-id="${p.id}" data-fk="pe:${p.id}:del"${last ? ' aria-disabled="true" aria-describedby="p5-guard"' : ''}>${ic('trash-2', 'md')}<span>${esc(t5('perDelete'))}</span></button></div>` +
    (last ? `<p class="p5-guard" id="p5-guard" data-part="settings-persona-guard" data-part-critical role="note">${ic('triangle-alert', 'md')}<span>${esc(t5('perLast'))}</span></p>` : '') +
    `<div class="p5-bound" data-part="settings-persona-bound"><h3 class="p5-h3">${esc(t5('perBoundList'))}</h3>${bound.length ? `<ul class="p5-bl" role="list">${bound.map((c) => `<li><a href="#chat-${c.id}" data-p5="chat" data-id="${c.id}" data-fk="pe:${p.id}:chat:${c.id}">${ic('message-square', 'md')}<span>${esc(pick(c.ko, c.en))}</span><span class="p5-chn">${esc(nameOf(char(c.char)))}</span></a></li>`).join('')}</ul>` : `<p class="r-desc" data-part="settings-row-description">${esc(act ? t5('perBoundNoneActive') : t5('perBoundNone'))}</p>`}<p class="r-desc" data-part="settings-row-description">${esc(t5('perBoundHint'))}</p></div></section>`;
}
function personaPageHTML() {
  if (P5.sub && P5.sub.kind === 'persona' && !persona(P5.sub.id)) P5.sub = null;
  const split = perSplit(); const n = D.personas.length; const cur = perCurrentId(); if (n < 8) P5.per.q = '';   // the filter never outlives its field (R5-16)
  if (P5.sub && P5.sub.kind === 'persona' && !split) { const p = persona(P5.sub.id); return subHead(p.name || t5('perNoName'), '') + perEditorHTML(p, true) + '</div>'; }
  const search = n >= 8 ? `<div class="search p5-search" data-part="settings-search-field"><span class="s-ic" aria-hidden="true">${ic('search', 'lg')}</span><input id="p5-pq" type="text" class="p5-q" data-p5i="per-q" data-fk="pe:q" value="${esc(P5.per.q)}" placeholder="${esc(t5('perSearch'))}" aria-label="${esc(t5('perSearch'))}" autocomplete="off" spellcheck="false"></div>` : '';
  const q = P5.per.q.trim().toLowerCase(); const shown = D.personas.filter((p) => !q || (p.name + ' ' + pnote(p)).toLowerCase().indexOf(q) >= 0);
  let h = headHTML('persona', `<p class="count" id="p5-pcount">${esc(t5('perCount', n))}</p>`);
  h += `<div class="p5-tools" data-part="settings-list-tools">${search}<span class="p5-act" data-row="persona.add"><button type="button" class="btn solid" data-part="settings-button" data-p5="per-add" data-fk="pe:add" data-ctl aria-haspopup="menu" aria-label="${esc(t5('perAddAria'))}">${ic('plus', 'md')}<span>${esc(t5('perAdd'))}</span></button></span>${trashBtn('persona')}</div>`;
  h += `<div class="p5-split${split ? ' on' : ''}"><div class="p5-listcol"><ul class="p5-grid" role="list" aria-label="${esc(A.L(A.PAGE.persona))}" data-part="settings-persona-list">${shown.map((p) => perCardHTML(p, D.personas.indexOf(p), n, split && p.id === cur)).join('')}</ul><p class="p5-none r-desc" id="p5-pnone"${shown.length ? ' hidden' : ''} data-part="settings-row-description">${esc(t5('perNone'))}</p></div>`;
  if (split) h += `<div class="p5-edcol">${perEditorHTML(persona(cur))}</div>`;
  return h + '</div></div>';
}
function perOpen(id, focusName) {
  P5.per.sel = id; P5.retFk = 'pe:' + id + ':open';
  if (perSplit()) { repaint(); if (focusName) { const f = $('#pageScroll [data-p5i="name"]'); if (f) { f.focus({ preventScroll: true }); f.select(); } } return; }
  P5.listScroll.persona = $('#pageScroll').scrollTop; P5.sub = { kind: 'persona', id }; A.showPage('persona', { p5: true, noRestore: true, noAnim: false, keepFocus: true });
  const f = focusName ? $('#pageScroll [data-p5i="name"]') : $('#pgTitle'); if (f) { f.focus({ preventScroll: true }); if (focusName && f.select) f.select(); }
}
function subClose(kind) {
  const k = kind || (P5.sub && P5.sub.kind); if (!P5.sub) return; const page = pageOf(k); const fk = P5.retFk; P5.sub = null;
  A.showPage(page, { p5: true, noAnim: true, noRestore: true, keepFocus: true }); const sc = $('#pageScroll'); if (sc && P5.listScroll[page] !== undefined) sc.scrollTop = P5.listScroll[page];
  if (!focusFk(fk)) { const h = $('#pgTitle'); if (h) h.focus({ preventScroll: true }); }
}
function perUse(id) {
  const p = persona(id); if (!p) return; const was = activePersonaId(); if (was === id) { announce(t5('perUsed')); return; }
  A.S.personaActive = id; const e = pushLU(t5('perLuUse', p.name), () => { if (persona(was)) A.S.personaActive = was; return ''; }, 'persona-use');
  A.buildIndex(); repaint('pe:' + id + ':use'); toastUndo(t5('perUsing'), e, { sub: p.name }); announce(t5('perUsing') + ' ' + p.name);
}
function perNew() {
  const id = 'u' + (100 + (++P5.seq)); const p = { id, name: t5('perNewName'), note: '', noteEn: '', desc: '', icon: '', large: false }; D.personas.push(p);
  const e = pushLU(t5('perLuNew'), () => { const i = D.personas.indexOf(p); if (i >= 0) D.personas.splice(i, 1); if (P5.sub && P5.sub.id === id) P5.sub = null; if (P5.per.sel === id) P5.per.sel = ''; return ''; }, 'persona-new');
  P5.fresh = id; A.buildIndex(); perOpen(id, true); toastUndo(t5('perCreated'), e, { sub: p.name }); announce(t5('perCreated'));
}
function perDup(id) {
  const p = persona(id); if (!p) return; const nid = 'u' + (100 + (++P5.seq)); const c = Object.assign({}, p, { id: nid, name: t5('perCopyName', p.name) }); const i = D.personas.indexOf(p); D.personas.splice(i + 1, 0, c);
  const e = pushLU(t5('perLuDup', p.name), () => { const k = D.personas.indexOf(c); if (k >= 0) D.personas.splice(k, 1); if (P5.sub && P5.sub.id === nid) P5.sub = null; return ''; }, 'persona-dup');
  P5.fresh = nid; A.buildIndex(); P5.per.sel = nid; repaint('pe:' + nid + ':open'); toastUndo(t5('perDuped'), e, { sub: c.name });
}
function perDelete(id) {
  const p = persona(id); if (!p) return;
  if (D.personas.length <= 1) { announce(t5('perLast')); return; }                      // DS-111: the last persona stays; the button says why
  const bound = boundChats(id); const wasAct = id === activePersonaId(); const na = wasAct ? D.personas.find((x) => x.id !== id) : persona(activePersonaId());
  const go = () => perDoDelete(id);
  if (bound.length) ask({ title: t5('perDelTitle'), body: `<p class="p5-dname">${esc(p.name)}</p><p>${esc(t5('perBoundQ', bound.length, na ? na.name : ''))}</p>${wasAct ? `<p>${esc(t5('perNewActive', na ? na.name : ''))}</p>` : ''}`, ok: t5('perDelete'), danger: true, onOk: go, onClose: () => { if (persona(id)) focusFk('pe:' + id + ':del') || focusFk('pe:' + id + ':menu'); } });
  else go();
}
function perDoDelete(id) {
  const p = persona(id); if (!p) return; const idx = D.personas.indexOf(p), was = activePersonaId(), bound = boundChats(id).map((c) => c.id), wasSel = P5.per.sel;
  D.personas.splice(idx, 1); bound.forEach((cid) => { chat(cid).persona = ''; });
  if (was === id) A.S.personaActive = D.personas[0].id; if (P5.per.sel === id) P5.per.sel = '';
  const restore = () => { if (persona(id)) return; D.personas.splice(Math.min(idx, D.personas.length), 0, p); bound.forEach((cid) => { if (chat(cid) && !chat(cid).persona) chat(cid).persona = id; }); if (was === id) A.S.personaActive = id; };
  const tr = trashAdd('persona', p, restore, p.name);
  const e = pushLU(t5('perLuDel', p.name), () => { restore(); trashDrop(tr.id); return ''; }, 'persona-delete', { ids: [id] }); tr.lu = e.id;
  const wasSub = P5.sub && P5.sub.kind === 'persona' && P5.sub.id === id; if (wasSub) { P5.sub = null; A.showPage('persona', { p5: true, noAnim: true, keepFocus: true }); } else repaint();
  A.buildIndex(); const nf = D.personas[Math.min(idx, D.personas.length - 1)]; if (nf) focusFk('pe:' + nf.id + ':open');
  toastUndo(t5('perDeleted'), e, { kind: 'delete', sub: p.name + (bound.length ? ' · ' + t5('perChats', bound.length) : '') + (was === id ? ' · ' + t5('perNewActive', D.personas[0].name) : '') }); announce(t5('perDeleted') + ' ' + p.name); void wasSel;
}
function perMove(id, delta, viaKey) {
  const i = D.personas.findIndex((p) => p.id === id), j = i + delta; if (i < 0 || j < 0 || j >= D.personas.length) { announce(t5('perEdge')); return; }
  const order = D.personas.map((p) => p.id); const p = D.personas[i]; D.personas.splice(i, 1); D.personas.splice(j, 0, p);
  const e = pushLU(t5('perLuMove', p.name), () => { const cur = D.personas.indexOf(p); if (cur >= 0) { D.personas.splice(cur, 1); D.personas.splice(Math.min(i, D.personas.length), 0, p); } return ''; }, 'persona-move'); void order; void e;
  A.buildIndex(); repaint('pe:' + id + (viaKey ? ':open' : ':menu')); announce(t5('perMoved', p.name || t5('perNoName'), j + 1, D.personas.length));
}
function perExport(id) {
  const p = persona(id); if (!p) return; const empty = !p.name.trim() || !p.desc.trim();
  const o = { format: 'persona-mock', name: p.name || undefined, description: p.desc || undefined, note: p.note || undefined, largePortrait: p.large };   // DS design default: largePortrait is exported; empty fields are left out
  download((p.name || 'persona').replace(/[<>:"/\\|?*.,]/g, '') + '.persona.json', JSON.stringify(o, null, 1));
  toast(t5('perExported'), { sub: empty ? t5('perExportEmpty') : p.name }); announce(t5('perExported') + (empty ? '. ' + t5('perExportEmpty') : ''));
}
function perPortrait(id) {
  const p = persona(id); if (!p) return; const old = p.icon; const nx = ICON_CYCLE[(ICON_CYCLE.indexOf(old) + 1) % ICON_CYCLE.length]; p.icon = nx;   // an image change keeps the persona id (ENGINE note 5a: the id never changes)
  const e = pushLU(t5('perLuImage', p.name), () => { p.icon = old; return ''; }, 'persona-image'); repaint('pe:' + id + ':portrait'); toastUndo(t5('perImageSet'), e);
}
function perImport() {
  let sel = {}; const body = () => `<p>${esc(t5('perImportPick'))}</p><ul class="p5-files" role="list">${PER_FILES.map((f) => `<li><label class="p5-filel"><input type="checkbox" data-pf="${f.id}"${sel[f.id] ? ' checked' : ''}><span>${esc(f.file)}</span></label></li>`).join('')}</ul><div class="p5-prev" id="p5-prev" aria-live="polite"></div>`;
  const d = A.openDialog({ title: t5('perImportTitle'), body: body(), buttons: [{ id: 'cancel', label: t5('cancel') }, { id: 'ok', label: t5('perImportDo'), primary: true, disabled: true }], initial: '[data-pf]' });
  const paint = () => {
    const ch = PER_FILES.filter((f) => sel[f.id]); const ok = ch.filter((f) => f.ok); const prev = $('#p5-prev', d.back); const btn = $('[data-dlg="ok"]', d.back);
    btn.setAttribute('aria-disabled', ok.length ? 'false' : 'true');
    if (!ch.length) prev.innerHTML = '';
    else if (ch.length === 1 && ok.length === 1) { const f = ok[0]; prev.innerHTML = `<div class="p5-card prev" data-part="settings-persona-card">${avatarHTML({ name: f.name, icon: '' })}<span class="p5-ct"><span class="p5-name">${esc(f.name)}</span><span class="p5-note">${esc(f.desc.slice(0, 40))}${f.desc.length > 40 ? '…' : ''}</span></span></div>`; }
    else prev.innerHTML = `<p class="r-desc" data-part="settings-row-description">${esc(t5('perImportSummary', ok.length, ch.length - ok.length))}</p>` + (ch.length - ok.length ? `<p class="p5-note-bad">${ic('triangle-alert', 'sm')}<span>${esc(t5('perImportBad'))}</span></p>` : '');
  };
  d.back.addEventListener('change', (ev) => { const c = ev.target.closest('[data-pf]'); if (c) { sel[c.dataset.pf] = c.checked; paint(); } });
  A.openDialog.handlers = { ok: () => {
    const ok = PER_FILES.filter((f) => sel[f.id] && f.ok); const bad = PER_FILES.filter((f) => sel[f.id] && !f.ok).length; if (!ok.length) return false;
    setTimeout(() => {
      const made = ok.map((f) => ({ id: 'u' + (100 + (++P5.seq)), name: f.name, note: '', noteEn: '', desc: f.desc, icon: '', large: false })); made.forEach((p) => D.personas.push(p));
      const e = pushLU(t5('perLuImport', made.length), () => { made.forEach((p) => { const k = D.personas.indexOf(p); if (k >= 0) D.personas.splice(k, 1); }); if (P5.per.sel && !persona(P5.per.sel)) P5.per.sel = ''; return ''; }, 'persona-import');
      A.buildIndex(); perOpen(made[made.length - 1].id, false); toastUndo(t5('perImportDone', made.length), e, { sub: bad ? t5('perImportSkip', bad) : '' });
    }, 0);
  } };
  return d;
}
function perMenu(id, anchor) {
  const p = persona(id), i = D.personas.indexOf(p), n = D.personas.length, act = id === activePersonaId();
  A.showMenu([{ icon: 'check', label: t5('perUse'), disabled: act, fn: () => perUse(id) }, { icon: 'copy', label: t5('perDup'), fn: () => perDup(id) }, { icon: 'arrow-up', label: t5('perUp'), disabled: i <= 0, fn: () => perMove(id, -1) }, { icon: 'arrow-down', label: t5('perDown'), disabled: i >= n - 1, fn: () => perMove(id, 1) }, { icon: 'download', label: t5('perExport'), fn: () => perExport(id) }, { icon: 'trash-2', label: t5('perDelete'), disabled: n <= 1, fn: () => perDelete(id) }], anchor, null, anchor, t5('menuOf', p.name || t5('perNoName')));
}
function perAddMenu(anchor) { A.showMenu([{ icon: 'plus', label: t5('perNew'), fn: perNew }, { icon: 'file-up', label: t5('perImportMenu'), fn: perImport }], anchor, null, anchor, t5('perAddAria')); }
function perDragStart(ev, id) {   // drag on the handle: the card follows the pointer in the DOM, the store changes once on release
  const ul = $('#pageScroll .p5-grid'); const li = ul && $(`[data-p5id="persona:${CSS.escape(id)}"]`, ul); if (!li) return; ev.preventDefault();
  const order0 = D.personas.map((p) => p.id); li.classList.add('dragging'); P5.per.drag = { id, order0 };
  let lastY = null; const sc = $('#pageScroll');
  const auto = setInterval(() => { if (lastY === null) return; const R = sc.getBoundingClientRect(); const d = lastY < R.top + 48 ? -12 : lastY > R.bottom - 48 ? 12 : 0; if (d) { sc.scrollTop += d; move({ clientY: lastY }); } }, 16);   // near the top or bottom edge of the page the list scrolls under the pointer (the review's no-autoscroll note)
  const move = (e) => { lastY = e.clientY; const lis = $$('.p5-card', ul).filter((x) => x !== li); let before = null; for (const o of lis) { const r = o.getBoundingClientRect(); if (e.clientY < r.top + r.height / 2) { before = o; break; } } if (before) ul.insertBefore(li, before); else ul.appendChild(li); };
  const up = () => {
    clearInterval(auto); document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); document.removeEventListener('pointercancel', up); li.classList.remove('dragging');
    const order = $$('.p5-card', ul).map((x) => x.dataset.p5id.slice(8)); P5.per.drag = null; const same0 = order.join() === order0.join();
    if (!same0) {
      const prev = D.personas.slice(); const byid = {}; D.personas.forEach((p) => { byid[p.id] = p; }); D.personas.length = 0; order.forEach((k) => D.personas.push(byid[k]));
      pushLU(t5('perLuMove', byid[id].name), () => { D.personas.length = 0; prev.forEach((p) => { if (byid[p.id]) D.personas.push(p); }); return ''; }, 'persona-move'); A.buildIndex();
      announce(t5('perMoved', byid[id].name || t5('perNoName'), order.indexOf(id) + 1, order.length));
    }
    repaint('pe:' + id + ':drag');
  };
  document.addEventListener('pointermove', move); document.addEventListener('pointerup', up); document.addEventListener('pointercancel', up);
}

/* ------------------------------------------------------------------ 확장 › 플러그인 (DS-112, DS-113) */
const plLevel = (p) => (p.api === '1' ? 'v1' : (p.api === '2.1' || p.api === '2') ? 'full' : 'limited');
const argVisible = (p) => p.args.filter((a) => a.key.indexOf('hidden_') !== 0);
const plHasSettings = (p) => p.api !== '1' && argVisible(p).some((a) => a.kind !== 'divider');
function accessHTML(p, cls) {
  const lv = plLevel(p); let txt, icon;
  if (lv === 'limited') { txt = t5('plAccLimited') + (p.ipc ? ' · ' + t5('plAccIpc', p.ipc) : ''); icon = 'shield-check'; }
  else if (lv === 'full') { txt = t5('plAccFull'); icon = 'triangle-alert'; }
  else { txt = t5('plAccV1'); icon = 'circle-alert'; }
  return `<p class="p5-access${cls ? ' ' + cls : ''}" data-part="settings-plugin-access" data-part-critical data-level="${lv}">${ic(icon, 'md')}<span>${esc(txt)}</span></p>`;
}
const plMeta = (p) => t5('plMeta', p.vp, p.api);
function plRowHTML(p) {
  const lv = plLevel(p), v1 = lv === 'v1'; const nm = p.name;
  const chips = (p.hot ? `<span class="chip p5-chip" data-part="settings-plugin-chip" data-kind="dev">${ic('code', 'sm')}<span>${esc(t5('plDevChip'))}</span></span>` : '') +
    (p.chk === 'update' && p.update ? `<span class="p5-updw"><span class="chip p5-chip" data-part="settings-plugin-chip" data-kind="update">${ic('refresh-cw', 'sm')}<span>${esc(t5('plUpdChip', p.update))}</span></span><button type="button" class="btn solid p5-updbtn" data-part="settings-button" data-p5="pl-upd" data-id="${p.id}" data-fk="pl:${p.id}:upd" aria-label="${esc(t5('plUpdBtnAria', nm))}">${ic('download', 'md')}<span>${esc(t5('plUpdBtn'))}</span></button></span>` : '');
  return `<li class="p5-plrow${P5.fresh === p.id ? ' p5-new' : ''}" data-p5id="plugin:${p.id}" data-part="settings-plugin-row" data-level="${lv}"${p.enabled ? ' data-enabled' : ''}${p.hot ? ' data-dev' : ''}>` +
    `<div class="p5-plmain"><div class="p5-plhead"><a class="p5-name" href="?page=ext&view=plugin&id=${p.id}" data-p5="open-plugin" data-id="${p.id}" data-fk="pl:${p.id}:open">${esc(nm)}</a><span class="p5-meta" data-part="settings-plugin-meta">${esc(plMeta(p))}</span>${chips}</div>${accessHTML(p)}</div>` +
    `<div class="p5-plctl"><label class="p5-swl"><span class="sw" data-part="settings-plugin-switch" data-part-critical><input type="checkbox" role="switch" data-p5i="pl-on" data-id="${p.id}" data-fk="pl:${p.id}:sw" aria-label="${esc(t5('plSwAria', nm))}"${p.enabled ? ' checked' : ''}${v1 ? ' disabled' : ''}><span class="sw-ui" aria-hidden="true"></span></span><span class="p5-swt" aria-hidden="true">${esc(p.enabled ? t5('plOn') : t5('plOff'))}</span></label>` +
    `<button type="button" class="btn p5-more" data-part="settings-button" data-p5="pl-menu" data-id="${p.id}" data-fk="pl:${p.id}:menu" aria-haspopup="menu" aria-label="${esc(t5('menuOf', nm))}" title="${esc(t5('menuOf', nm))}">${ic('ellipsis', 'xl')}</button></div></li>`;
}
function plResultHTML() {
  let kind, txt;
  if (P5.pl.checking) { kind = 'checking'; txt = t5('plChecking'); }
  else if (P5.pl.ran) {
    const fails = D.plugins.filter((p) => p.chk === 'fail'), upds = D.plugins.filter((p) => p.chk === 'update');
    if (fails.length) { kind = 'fail'; txt = t5('plFailed', fails.length, fails.map((p) => p.name).join(', ')) + (upds.length ? ' · ' + t5('plSomeUpd', upds.length) : ''); }
    else if (upds.length) { kind = 'upd'; txt = t5('plSomeUpd', upds.length); } else { kind = 'ok'; txt = t5('plAllLatest'); }
  } else return `<p class="p5-updres" id="p5-updres" data-part="settings-plugin-result" data-part-critical role="status" hidden></p>`;
  return `<p class="p5-updres" id="p5-updres" data-part="settings-plugin-result" data-part-critical role="status" data-kind="${kind}">${ic(kind === 'fail' ? 'triangle-alert' : kind === 'checking' ? 'loader' : kind === 'upd' ? 'refresh-cw' : 'circle-check', 'md')}<span>${esc(txt)}</span></p>`;
}
function pluginsSectionHTML() {
  const l = D.plugins;
  const tools = `<div class="p5-tools" data-part="settings-list-tools"><span class="p5-act" data-row="ext.pluginImport"><button type="button" class="btn solid" data-part="settings-button" data-p5="pl-add" data-fk="pl:add" data-ctl>${ic('plus', 'md')}<span>${esc(t5('plAdd'))}</span></button></span>` +
    `<button type="button" class="btn" data-part="settings-button" data-p5="pl-dev" data-fk="pl:dev" aria-haspopup="menu" aria-label="${esc(t5('plDevAria'))}" title="${esc(t5('plDevAria'))}">${ic('code', 'xl')}</button>` +
    `<span class="p5-act" data-row="ext.pluginUpdate"><button type="button" class="btn solid" data-part="settings-button" data-p5="pl-check" data-fk="pl:check" data-ctl${P5.pl.checking ? ' aria-disabled="true"' : ''}>${ic('refresh-cw', 'md')}<span>${esc(t5('plCheck'))}</span></button></span>${trashBtn('plugin')}</div>`;
  return secOpen('ext.plugins', A.L(A.SEC['ext.plugins'])) + `<p class="banner warn p5-plwarn" data-part="settings-plugin-warning" data-part-critical role="note">${ic('triangle-alert', 'lg')}<span>${esc(t5('plWarn'))}</span></p>` + tools + plResultHTML() +
    (l.length ? `<ul class="p5-list" role="list" data-part="settings-plugin-list">${l.map(plRowHTML).join('')}</ul>` : `<p class="p5-empty" data-part="settings-empty">${ic('puzzle', 'lg')}<span>${esc(t5('plNone'))}</span></p>`) + '</section>';
}
function plLast() { if (P5.pl.last === undefined) { let v = 0; if (!A.hermetic) { try { v = Number(A.store.get('p5.plLast')) || 0; } catch (e) { v = 0; } } P5.pl.last = v; } return P5.pl.last; }
const plAutoDue = () => Date.now() - plLast() > 864e5;
function plApplyKnown() { D.plugins.forEach((p) => { p.chk = p.api === '1' ? '' : p.fail ? 'fail' : p.update ? 'update' : 'latest'; }); P5.pl.ran = true; plPaintList(); }
function plCheck(auto) {
  if (P5.pl.checking) return; P5.pl.checking = true; P5.pl.ran = true; plPaintResult(); const btn = $('#pageScroll [data-p5="pl-check"]'); if (btn) btn.setAttribute('aria-disabled', 'true');
  setTimeout(() => {
    D.plugins.forEach((p) => { p.chk = p.api === '1' ? '' : p.fail ? 'fail' : p.update ? 'update' : 'latest'; });
    P5.pl.checking = false; P5.pl.last = Date.now(); if (!A.hermetic) { try { A.store.set('p5.plLast', String(P5.pl.last)); } catch (e) { /* ignore */ } } plPaintList();
    const fails = D.plugins.filter((p) => p.chk === 'fail'), upds = D.plugins.filter((p) => p.chk === 'update'); announce(fails.length ? t5('plFailed', fails.length, fails.map((p) => p.name).join(', ')) : upds.length ? t5('plSomeUpd', upds.length) : t5('plAllLatest'));
  }, auto ? 120 : 240);
}
function plPaintList() {   // the plugin list and its status line in place: the rest of the page (a highlighted module, a field being typed in) is not touched
  const ul = $('#pageScroll [data-part="settings-plugin-list"]'); const a = document.activeElement; const fk = a && a.getAttribute ? a.getAttribute('data-fk') : ''; const hl = ul && $('.hl', ul); const hid = hl ? hl.dataset.p5id : '';
  if (ul) { ul.innerHTML = D.plugins.map(plRowHTML).join(''); if (fk && ul.contains(a)) focusFk(fk); if (hid) { const n = $('[data-p5id="' + hid + '"]', ul); if (n) A.highlight(n); } }
  plPaintResult(); const btn = $('#pageScroll [data-p5="pl-check"]'); if (btn) btn.removeAttribute('aria-disabled');
}
function plPaintResult() { const el = $('#p5-updres'); if (!el) return; const tmp = document.createElement('div'); tmp.innerHTML = plResultHTML(); el.replaceWith(tmp.firstElementChild); }
function plToggle(id, on, input) {
  const p = plugin(id); if (!p || plLevel(p) === 'v1') return;
  if (on && plLevel(p) === 'full') {   // DS-113: a full-access plugin asks once per enable
    ask({ title: t5('plFullT'), body: `<p class="p5-dname">${esc(p.name)}</p>${accessHTML(p, 'in-dlg')}<p class="r-desc" data-part="settings-row-description">${esc(t5('plFullNote'))}</p>`, ok: t5('plFullOn'), danger: true,
      onOk: () => { p.enabled = true; repaint('pl:' + id + ':sw'); announce(t5('plOn') + ': ' + p.name); }, onClose: () => { if (!p.enabled) { repaint('pl:' + id + ':sw'); } } });
    if (input) input.checked = false; return;
  }
  p.enabled = !!on; const row = $(`#pageScroll [data-p5id="plugin:${CSS.escape(id)}"]`);
  if (row) { row.toggleAttribute('data-enabled', p.enabled); const w = $('.p5-swt', row); if (w) w.textContent = p.enabled ? t5('plOn') : t5('plOff'); }
  announce((p.enabled ? t5('plOn') : t5('plOff')) + ': ' + p.name);
}
function plUpdate(id) {
  const p = plugin(id); if (!p || !p.update) return;
  ask({ critical: false, title: t5('plUpdQ'), body: `<p class="p5-dname">${esc(p.name)}</p><p>${esc(t5('plUpdBody', p.vp, p.update))}</p>`, ok: t5('plUpdBtn'), onOk: () => { const old = p.vp, nv = p.update; p.vp = nv; p.update = null; p.chk = 'latest';
    const e = pushLU(t5('plLuUpd', p.name), () => { if (p.vp === nv) { p.vp = old; p.update = nv; p.chk = 'update'; } return ''; }, 'plugin-update');
    A.buildIndex(); repaint('pl:' + id + ':open'); toastUndo(t5('plUpdDone'), e, { sub: p.name + ' · v' + nv }); }, onClose: () => focusFk('pl:' + id + ':upd') });
}
function plRemove(id) {
  const p = plugin(id); if (!p) return;
  ask({ title: t5('plRemoveT'), body: `<p class="p5-dname">${esc(p.name)}</p><p>${esc(t5('plRemoveNote'))}</p>`, ok: t5('plMenuDelete'), danger: true, onOk: () => {
    const idx = D.plugins.indexOf(p); D.plugins.splice(idx, 1); const restore = () => { if (!plugin(id)) D.plugins.splice(Math.min(idx, D.plugins.length), 0, p); }; const tr = trashAdd('plugin', p, restore, p.name);
    const e = pushLU(t5('plLuDel', p.name), () => { restore(); trashDrop(tr.id); return ''; }, 'plugin-delete', { ids: [id] }); tr.lu = e.id;
    const wasSub = P5.sub && P5.sub.kind === 'plugin' && P5.sub.id === id; A.buildIndex();
    if (wasSub) { P5.sub = null; A.showPage('ext', { p5: true, noAnim: true, keepFocus: true }); } else repaint();
    const nf = D.plugins[Math.min(idx, D.plugins.length - 1)]; if (nf) focusFk('pl:' + nf.id + ':open'); else focusFk('pl:add');
    toastUndo(t5('plRemoved'), e, { kind: 'delete', sub: p.name }); announce(t5('plRemoved') + ' ' + p.name); } });
}
function plFileDialog(id) {
  const p = plugin(id); const d = A.openDialog({ title: t5('plFileT'), body: `<p class="p5-dname">${esc(p.name)}</p><p class="r-desc" data-part="settings-row-description">${esc(t5('plFileBody'))}</p>`, buttons: [{ id: 'export', label: t5('plFileExport'), primary: true }, { id: 'import', label: t5('plFileImport') }, { id: 'cancel', label: t5('cancel') }] });
  A.openDialog.handlers = { export: () => { const o = {}; p.args.forEach((a) => { if (a.kind !== 'divider') o[a.key] = a.val; }); download(p.name.replace(/\s+/g, '-') + '.settings.json', JSON.stringify(o, null, 1)); toast(t5('plFileExported'), { sub: p.name }); },
    import: () => { setTimeout(() => { const before = p.args.map((a) => [a, a.val]); let n = 0; p.args.forEach((a) => { if (a.kind !== 'divider' && a.def !== undefined && String(a.val) !== String(a.def)) { a.val = a.def; n++; } });
      const e = pushLU(t5('plLuFile', p.name), () => { before.forEach((b) => { b[0].val = b[1]; }); return ''; }, 'plugin-arg'); repaint(); toastUndo(t5('plFileImported'), e, { sub: t5('plFileReplaced', n) }); }, 0); } };
  return d;
}
function plMenu(id, anchor) {
  const p = plugin(id); const items = [];
  if (plHasSettings(p)) items.push({ icon: 'sliders-horizontal', label: t5('plMenuSettings'), fn: () => openSub('plugin', id) });
  items.push({ icon: 'refresh-cw', label: t5('plMenuCheck'), disabled: plLevel(p) === 'v1', fn: () => plCheckOne(id) });
  items.push({ icon: 'file-up', label: t5('plMenuFile'), disabled: !plHasSettings(p), fn: () => plFileDialog(id) });
  items.push({ icon: 'download', label: t5('plMenuExport'), fn: () => { download(p.name.replace(/\s+/g, '-') + '.js', '// @name ' + p.name + '\n// @version ' + p.vp + '\n// @api ' + p.api + '\n// stub: nothing here ever runs\n'); toast(t5('plExported'), { sub: p.name }); } });
  (p.links || []).forEach((l) => items.push({ icon: 'external-link', label: pick(l.hover, l.hoverEn) || l.link, href: l.link }));
  items.push({ icon: 'trash-2', label: t5('plMenuDelete'), fn: () => plRemove(id) });
  A.showMenu(items, anchor, null, anchor, t5('menuOf', p.name));
}
function plCheckOne(id) {
  const p = plugin(id); if (!p) return; p.chk = p.fail ? 'fail' : p.update ? 'update' : 'latest'; P5.pl.ran = true; repaint('pl:' + id + ':menu');
  announce(p.chk === 'fail' ? t5('plFailed', 1, p.name) : p.chk === 'update' ? t5('plUpdChip', p.update) : t5('plAllLatest'));
}
function plPick() {   // "+ 플러그인": a simulated file picker; several files go to a batch review
  let sel = {}; const body = () => `<p>${esc(t5('plPickBody'))}</p><ul class="p5-files" role="list">${PLUGIN_FILES.map((f) => `<li><label class="p5-filel"><input type="checkbox" data-pf="${f.id}"${sel[f.id] ? ' checked' : ''}><span>${esc(f.name)}</span></label></li>`).join('')}</ul>`;
  const d = A.openDialog({ critical: true, title: t5('plPickT'), body: body(), buttons: [{ id: 'cancel', label: t5('cancel') }, { id: 'ok', label: t5('plInstall'), primary: true, disabled: true }], initial: '[data-pf]' });
  d.back.addEventListener('change', (ev) => { const c = ev.target.closest('[data-pf]'); if (c) { sel[c.dataset.pf] = c.checked; $('[data-dlg="ok"]', d.back).setAttribute('aria-disabled', PLUGIN_FILES.some((f) => sel[f.id]) ? 'false' : 'true'); } });
  A.openDialog.handlers = { ok: () => {
    const files = PLUGIN_FILES.filter((f) => sel[f.id]); if (!files.length) return false;
    if (files.length === 1) { setTimeout(() => plInstall(files), 0); return; }
    $('.dlg-t', d.back).textContent = t5('plBatchT'); $('.dlg-b', d.back).innerHTML = `<p>${esc(t5('plBatchBody', files.length))}</p><ul class="p5-batch" role="list">${files.map((f) => `<li class="p5-batchi"><span class="p5-name">${esc(f.name)}</span><span class="p5-batchmeta">${esc(t5('plMeta', f.vp, f.api))}</span>${accessHTML({ api: f.api, ipc: f.ipc })}</li>`).join('')}</ul>`;
    $('.dlg-f', d.back).innerHTML = `<button type="button" class="btn solid" data-part="settings-button" data-dlg="cancel">${esc(t5('cancel'))}</button><button type="button" class="btn accent solid" data-part="settings-button" data-dlg="all">${esc(t5('plInstallAll', files.length))}</button>`;
    A.openDialog.handlers = { all: () => { setTimeout(() => plInstall(files), 0); } }; return false; } };
  return d;
}
function plInstall(files) {
  const made = files.map((f) => ({ id: 'pl' + (100 + (++P5.seq)), name: f.ko, note: '', noteEn: '', vp: f.vp, api: f.api, enabled: false, ipc: f.ipc, hot: false, update: null, fail: false, links: [], args: [], chk: '', code: '// stub' }));
  made.forEach((p) => D.plugins.push(p));
  const e = pushLU(t5('plLuInstall', made.length), () => { made.forEach((p) => { const k = D.plugins.indexOf(p); if (k >= 0) D.plugins.splice(k, 1); }); return ''; }, 'plugin-install');
  P5.fresh = made[0].id; A.buildIndex(); repaint('pl:' + made[0].id + ':open'); toastUndo(t5('plInstalled', made.length), e, { sub: made.map((p) => p.name).join(', ') });
}
function plDevMenu(anchor) {
  A.showMenu([{ icon: 'code', label: t5('plDevImport'), fn: () => { const p = { id: 'pl' + (100 + (++P5.seq)), name: 'Hot Reload Demo', note: '', noteEn: '', vp: '0.0.1', api: '3.0', enabled: false, ipc: 0, hot: true, update: null, fail: false, links: [], args: [], chk: '', code: '// stub' }; D.plugins.push(p);
    const e = pushLU(t5('plLuInstall', 1), () => { const k = D.plugins.indexOf(p); if (k >= 0) D.plugins.splice(k, 1); return ''; }, 'plugin-install'); A.buildIndex(); repaint('pl:' + p.id + ':open'); toastUndo(t5('plDevDone'), e, { sub: p.name }); } },
  { icon: 'download', label: t5('plTemplate'), fn: () => { download('plugin_start.js', '// @name Starter\n// @version 0.0.1\n// @api 3.0\n// stub: a starter template (synthetic)\n'); toast(t5('plTemplateDone')); } }], anchor, null, anchor, t5('plDevAria'));
}
/* the plugin's own settings page (view=plugin): rows in slice 1's row style; values commit on blur or Enter */
function argKind(a) { return a.kind === 'divider' ? 'divider' : a.kind === 'select' ? 'select' : a.kind === 'int' ? (a.meta.checkbox ? 'switch' : 'number') : a.meta.radio ? (a.meta.radio.length <= 4 ? 'seg' : 'select') : a.meta.textarea ? 'ta' : 'text'; }
const argChanged = (a) => a.def !== undefined && String(a.val) !== String(a.def);
function argRowHTML(p, a) {
  const k = argKind(a), lab = pick(a.meta.name, a.meta.nameEn) || a.key;
  if (k === 'divider') return lab && a.meta.name ? `<h3 class="p5-argdiv" data-part="settings-plugin-arg" data-kind="divider">${esc(lab)}</h3>` : '<hr class="p5-argsep" data-part="settings-plugin-arg" data-kind="divider">';
  const id = `p5a-${p.id}-${a.key}`, ch = argChanged(a), desc = pick(a.meta.desc || '', a.meta.descEn || ''), dk = `data-p5arg="${esc(a.key)}" data-id="${p.id}" data-fk="pl:${p.id}:a:${esc(a.key)}"`; const draft = P5.argDraft[p.id + '|' + a.key];
  let ctl;
  if (k === 'switch') ctl = `<span class="sw" data-part="settings-toggle"><input type="checkbox" role="switch" id="${id}" ${dk} aria-label="${esc(lab)}"${Number(a.val) ? ' checked' : ''}><span class="sw-ui" aria-hidden="true"></span></span>`;
  else if (k === 'seg') ctl = `<div class="seg" role="radiogroup" aria-labelledby="l-${id}" id="${id}" data-part="settings-segmented">${a.meta.radio.map((o, i) => `<button type="button" class="seg-b" role="radio" aria-checked="${o[1] === a.val}" tabindex="${o[1] === a.val || (i === 0 && !a.meta.radio.some((x) => x[1] === a.val)) ? 0 : -1}" data-p5seg="${esc(o[1])}" data-p5arg="${esc(a.key)}" data-id="${p.id}" data-fk="pl:${p.id}:a:${esc(a.key)}:${i}">${esc(pick(o[0], o[2]))}</button>`).join('')}</div>`;
  else if (k === 'select') { const opts = a.opts || a.meta.radio; ctl = `<select id="${id}" class="inp" data-part="settings-field" ${dk}>${opts.map((o) => `<option value="${esc(o[1])}"${o[1] === a.val ? ' selected' : ''}>${esc(pick(o[0], o[2]))}</option>`).join('')}</select>`; }
  else if (k === 'ta') ctl = `<textarea id="${id}" class="inp ta" data-part="settings-field" ${dk} rows="3" placeholder="${esc(a.meta.ph || '')}" spellcheck="false">${esc(a.val)}</textarea>`;
  else if (k === 'number') ctl = `<input id="${id}" class="inp num" data-part="settings-field" type="text" inputmode="numeric" ${dk} value="${esc(draft !== undefined ? draft : a.val)}" placeholder="${esc(a.meta.ph || '')}"${draft !== undefined ? ` aria-invalid="true" aria-describedby="${id}-e"` : ''} autocomplete="off" spellcheck="false">`;
  else ctl = `<input id="${id}" class="inp" data-part="settings-field" type="text" ${dk} value="${esc(a.val)}" placeholder="${esc(a.meta.ph || '')}" autocomplete="off" spellcheck="false">`;
  const rng = a.meta.min !== undefined ? t5('plArgRange', a.meta.min, a.meta.max) : t5('plArgNum');
  return `<div class="row p5-arg${ch ? ' changed' : ''}" data-row="p5arg.${p.id}.${esc(a.key)}" data-part="settings-plugin-arg" data-kind="${k}" role="group" aria-labelledby="l-${id}"><span class="dot" aria-hidden="true"${ch ? '' : ' hidden'}></span><div class="p5-argmain"><div class="r-text"><label class="r-label" id="l-${id}" for="${id}" data-part="settings-row-label">${esc(lab)}<span class="sr-only r-chg">${ch ? ' (' + esc(t5('changed')) + ')' : ''}</span></label>${desc ? `<span class="r-desc" data-part="settings-row-description">${esc(desc)}</span>` : ''}${a.def !== undefined && a.def !== '' ? `<span class="r-desc p5-defv" data-part="settings-row-description">${esc(t5('plArgDefault', k === 'switch' ? (Number(a.def) ? t5('plOn') : t5('plOff')) : k === 'seg' || k === 'select' ? pick(((a.opts || a.meta.radio).find((o) => o[1] === a.def) || [a.def, '', a.def])[0], ((a.opts || a.meta.radio).find((o) => o[1] === a.def) || [a.def, '', a.def])[2]) : a.def))}</span>` : ''}</div><div class="p5-argctl">${ctl}${ch ? `<button type="button" class="btn p5-argreset" data-part="settings-button" data-p5="arg-reset" data-key="${esc(a.key)}" data-id="${p.id}" data-fk="pl:${p.id}:r:${esc(a.key)}" aria-label="${esc(t5('plArgReset') + ': ' + lab)}" title="${esc(t5('plArgReset'))}">${ic('rotate-ccw', 'lg')}</button>` : ''}</div></div>${draft !== undefined ? `<p class="p5-err" id="${id}-e" role="alert">${esc(rng)}</p>` : ''}</div>`;
}
function pluginSubHTML(p) {
  const meta = `<p class="p5-meta p5-submeta" data-part="settings-plugin-meta">${esc(plMeta(p))}${p.hot ? ' · ' + esc(t5('plDevChip')) : ''}</p>` + accessHTML(p);
  let h = subHead(p.name, meta) + `<div class="p5-args" data-part="settings-plugin-args">`;
  if (plLevel(p) === 'v1') h += `<p class="p5-unsup" data-part="settings-plugin-unsupported" data-part-critical role="note">${ic('circle-alert', 'md')}<span>${esc(t5('plAccV1'))}</span></p>`;
  else { const l = argVisible(p); h += l.some((a) => a.kind !== 'divider') ? `<div class="rows" data-part="settings-rows">${l.map((a) => argRowHTML(p, a)).join('')}</div>` : `<p class="p5-empty">${esc(t5('plNoArgs'))}</p>`; }
  return h + '</div></div>';
}
function argCommit(p, a, v) {
  const old = a.val; if (String(old) === String(v)) return false; a.val = v;
  pushLU(t5('plLuArg', pick(a.meta.name, a.meta.nameEn) || a.key), () => { if (String(a.val) === String(v)) a.val = old; return ''; }, 'plugin-arg'); P5.writes++; return true;
}
function argInput(el) {   // change on a text, textarea, number or select control: blur and Enter commit
  const p = plugin(el.dataset.id); const a = p && p.args.find((x) => x.key === el.dataset.p5arg); if (!a) return; const k = argKind(a); const dk = p.id + '|' + a.key;
  if (k === 'number') {
    const s = el.value.replace(/[,\s]/g, ''); const n = /^-?\d+$/.test(s) ? Number(s) : NaN; const ok = !isNaN(n) && (a.meta.min === undefined || (n >= a.meta.min && n <= a.meta.max));
    if (!ok) { P5.argDraft[dk] = el.value; repaint('pl:' + p.id + ':a:' + a.key); announce(a.meta.min !== undefined ? t5('plArgRange', a.meta.min, a.meta.max) : t5('plArgNum')); return; }
    delete P5.argDraft[dk]; argCommit(p, a, n);
  } else argCommit(p, a, el.value);
  repaint('pl:' + p.id + ':a:' + a.key);
}
function argSeg(btn) { const p = plugin(btn.dataset.id), a = p && p.args.find((x) => x.key === btn.dataset.p5arg); if (!a) return; argCommit(p, a, btn.dataset.p5seg); repaint('pl:' + p.id + ':a:' + a.key + ':' + $$('[data-p5seg]', btn.parentNode).indexOf(btn)); }

/* ------------------------------------------------------------------ 확장 › 모듈 (DS-102, DS-104, DS-114 to DS-117) */
function openSub(kind, id) {
  P5.retFk = (kind === 'plugin' ? 'pl:' : kind === 'module' ? 'md:' : 'pe:') + id + ':open'; const pg = pageOf(kind); const sc = $('#pageScroll'); P5.listScroll[pg] = sc ? sc.scrollTop : 0; P5.sub = { kind, id };
  A.showPage(pg, { p5: true, noRestore: true, keepFocus: true }); const h = $('#pgTitle'); if (h) h.focus({ preventScroll: true });
}
const presetNs = (p) => { let v = ''; try { v = p.id === A.S.presetActive ? A.ROW['models.moduleIntegration'].v : B.effVal(p, 'models.moduleIntegration'); } catch (e) { v = ''; } return String(v || '').split(',').map((x) => x.trim()).filter(Boolean); };
const presetsOf = (m) => (m.ns ? D.presets.filter((p) => presetNs(p).indexOf(m.ns) >= 0) : []);
const charsOf = (m) => CHARS.filter((c) => c.modules.indexOf(m.id) >= 0);
const chatsOf = (m) => CHATS.filter((c) => c.modules.indexOf(m.id) >= 0);
const modOn = (m) => m.global || charsOf(m).length > 0 || chatsOf(m).length > 0 || presetsOf(m).length > 0;
function modWhereChips(m) {
  const pr = presetsOf(m).length, ch = charsOf(m).length, ct = chatsOf(m).length; const c = [];
  if (m.global) c.push(t5('moWhereGlobal')); if (pr) c.push(t5('moWherePreset')); if (ch) c.push(t5('moWhereChars', ch)); if (ct) c.push(t5('moWhereChats', ct)); return c;
}
function modList() {
  const f = P5.mod; const q = f.q.trim().toLowerCase();
  let l = A.S.modules.filter((m) => (!q || (m.name + ' ' + mnote(m) + ' ' + (m.ns || '')).toLowerCase().indexOf(q) >= 0) && (!f.on || modOn(m)) && (!f.low || m.low) && (!f.mcp || m.mcp));
  l = l.slice().sort(f.sort === 'recent' ? (a, b) => b.order - a.order : (a, b) => String(a.name).localeCompare(String(b.name), KO() ? 'ko' : 'en'));
  return l;
}
function lowBadge() { return `<span class="chip p5-badge" data-part="settings-module-badge" data-part-critical>${ic('shield-alert', 'sm')}<span>${esc(t5('moBadgeLow'))}</span></span>`; }
function modChips(m) {
  const c = []; if (m.low) c.push(lowBadge()); if (m.mcp) c.push(`<span class="chip p5-chip" data-part="settings-module-chip" data-kind="mcp">${ic('waypoints', 'sm')}<span>MCP</span></span>`);
  if (m.ns) c.push(`<span class="chip p5-chip" data-part="settings-module-chip" data-kind="ns">${ic('at-sign', 'sm')}<span>${esc(m.ns)}</span></span>`);
  if (m.assets) c.push(`<span class="chip p5-chip" data-part="settings-module-chip" data-kind="assets">${ic('image', 'sm')}<span>${esc(t5('moChipAssets', m.assets))}</span></span>`);
  modWhereChips(m).forEach((w) => c.push(`<span class="chip p5-chip" data-part="settings-module-chip" data-kind="where">${esc(w)}</span>`)); return c.join('');
}
function modRowHTML(m) {
  const nm = m.name || t5('moNoName'), desc = mnote(m);
  return `<li class="p5-mdrow${P5.fresh === m.id ? ' p5-new' : ''}" data-p5id="module:${m.id}" data-part="settings-module-row"${m.low ? ' data-low' : ''}${m.mcp ? ' data-mcp' : ''}${m.global ? ' data-enabled' : ''}>` +
    `<span class="p5-mdic" aria-hidden="true">${ic(m.mcp ? 'waypoints' : 'puzzle', 'xl')}</span><div class="p5-mdmain"><a class="p5-name" href="?page=ext&view=module&id=${m.id}" data-p5="open-module" data-id="${m.id}" data-fk="md:${m.id}:open">${esc(nm)}</a>` +
    `<p class="${desc ? 'p5-mddesc' : 'p5-mddesc none'}">${esc(desc || t5('moNoDesc'))}</p><div class="p5-chips">${modChips(m)}</div></div>` +
    `<div class="p5-plctl"><label class="p5-swl"><span class="sw" data-part="settings-module-switch" data-part-critical><input type="checkbox" role="switch" data-p5i="md-on" data-id="${m.id}" data-fk="md:${m.id}:sw" aria-label="${esc(t5('moSwAria', nm))}"${m.global ? ' checked' : ''}><span class="sw-ui" aria-hidden="true"></span></span></label>` +
    `<button type="button" class="btn p5-more" data-part="settings-button" data-p5="md-menu" data-id="${m.id}" data-fk="md:${m.id}:menu" aria-haspopup="menu" aria-label="${esc(t5('menuOf', nm))}" title="${esc(t5('menuOf', nm))}">${ic('ellipsis', 'xl')}</button></div></li>`;
}
function modToolsHTML() {
  const f = P5.mod; const chip = (k, lab) => `<button type="button" class="chip-b p5-fchip" data-p5="md-filter" data-f="${k}" data-fk="md:f:${k}" aria-pressed="${f[k]}">${esc(lab)}</button>`;
  return `<div class="p5-tools" data-part="settings-list-tools"><div class="search p5-search" data-part="settings-search-field"><span class="s-ic" aria-hidden="true">${ic('search', 'lg')}</span><input id="p5-mq" type="text" class="p5-q" data-p5i="md-q" data-fk="md:q" value="${esc(f.q)}" placeholder="${esc(t5('moSearch'))}" aria-label="${esc(t5('moSearch'))}" autocomplete="off" spellcheck="false"></div>` +
    `<span class="p5-act" data-row="ext.moduleNew"><button type="button" class="btn solid" data-part="settings-button" data-p5="md-add" data-fk="md:add" data-ctl aria-haspopup="menu" aria-label="${esc(t5('moAddAria'))}">${ic('plus', 'md')}<span>${esc(t5('moAdd'))}</span></button></span>${trashBtn('module')}</div>` +
    `<div class="p5-filters" role="group" aria-label="${esc(t5('moFilters'))}">${chip('on', t5('moFiltOn'))}${chip('low', t5('moFiltLow'))}${chip('mcp', t5('moFiltMcp'))}<label class="p5-sortl"><span class="sr-only">${esc(t5('moSort'))}</span><select class="inp p5-sort" data-p5i="md-sort" data-fk="md:sort" aria-label="${esc(t5('moSort'))}" data-part="settings-field"><option value="name"${f.sort === 'name' ? ' selected' : ''}>${esc(t5('moSortName'))}</option><option value="recent"${f.sort === 'recent' ? ' selected' : ''}>${esc(t5('moSortRecent'))}</option></select></label></div>`;
}
function modulesSectionHTML() {
  const all = A.S.modules, l = modList();
  let h = secOpen('ext.modules', A.L(A.SEC['ext.modules'])) + modToolsHTML();
  h += `<p class="count" id="p5-mcount">${esc(t5('moCount', l.length, all.length))}</p>`;
  if (!all.length) h += `<p class="p5-empty" data-part="settings-empty">${ic('puzzle', 'lg')}<span>${esc(t5('moNone'))}</span></p>`;
  else h += `<ul class="p5-list" role="list" data-part="settings-module-list" id="p5-mlist">${l.map(modRowHTML).join('')}</ul><p class="p5-none r-desc" id="p5-mnone"${l.length ? ' hidden' : ''} data-part="settings-row-description">${esc(t5('moNoMatch'))}</p>`;
  return h + '</section>';
}
function extPageHTML() {
  if (P5.sub && P5.sub.kind === 'plugin') { const p = plugin(P5.sub.id); if (p) return pluginSubHTML(p); P5.sub = null; }
  if (P5.sub && P5.sub.kind === 'module') { const m = mod(P5.sub.id); if (m) return moduleSubHTML(m); P5.sub = null; }
  let h = headHTML('ext');
  h += `<nav class="chips" data-part="settings-jump-chips" aria-label="${esc(A.t('sectionNav'))}">${['ext.plugins', 'ext.modules', 'ext.pluginpages'].map((s) => `<button type="button" class="chip-b" data-secjump="${s}">${esc(A.L(A.SEC[s]))}</button>`).join('')}</nav>`;
  h += pluginsSectionHTML() + modulesSectionHTML();
  h += secOpen('ext.pluginpages', A.L(A.SEC['ext.pluginpages'])) + `<div class="rows" data-part="settings-rows">${A.SECROWS['ext.pluginpages'].map((r) => A.rowHTML(r)).join('')}</div></section>`;
  return h + '</div>';
}
/* the module info page (view=module): info, permission, content counts, MCP, where it is on, actions. Contents are edited in Studio; there is no second contents editor (DS-104). */
const studioBtn = (m, cls) => `<a class="btn solid accent p5-studio${cls ? ' ' + cls : ''}" href="${esc(studioLink(m.id))}" data-part="settings-module-studio" data-part-critical data-p5="studio" data-id="${m.id}" data-fk="md:${m.id}:studio">${ic('external-link', 'md')}<span>${esc(t5('moStudio'))}</span></a>`;
function layerRow(key, title, body, dim) { return `<div class="p5-layer${dim ? ' dim' : ''}" data-part="settings-module-layer" data-layer="${key}" role="group" aria-labelledby="p5-ly-${key}"><h3 class="p5-lyt" id="p5-ly-${key}">${esc(title)}</h3><div class="p5-lyb">${body}</div></div>`; }
function whereHTML(m) {
  const g = m.global, pr = presetsOf(m), chs = charsOf(m), cts = chatsOf(m);
  const glob = layerRow('global', t5('moLayerGlobal'), `<label class="p5-swl"><span class="sw" data-part="settings-module-switch" data-part-critical><input type="checkbox" role="switch" data-p5i="md-on" data-id="${m.id}" data-fk="md:${m.id}:gsw" aria-label="${esc(t5('moSwAria', m.name))}"${g ? ' checked' : ''}><span class="sw-ui" aria-hidden="true"></span></span><span class="p5-swt">${esc(t5('moGlobalSw'))}</span></label>`);
  const preset = layerRow('preset', t5('moLayerPreset'), !m.ns ? `<p class="r-desc" data-part="settings-row-description">${esc(t5('moNoNs'))}</p>` : pr.length ? `<ul class="p5-ll" role="list">${pr.map((p) => `<li><a href="?page=models&row=models.moduleIntegration" data-p5="md-preset" data-id="${esc(p.id)}" data-fk="md:${m.id}:pr:${esc(p.id)}">${ic('bookmark', 'md')}<span>${esc(p.name)}</span><span class="p5-chn">${esc(t5('moPresetField'))}</span></a></li>`).join('')}</ul>` : `<p class="r-desc" data-part="settings-row-description">${esc(t5('moNoPreset'))}</p>`);
  const dimNote = g ? `<p class="p5-dimnote r-desc" data-part="settings-row-description">${esc(t5('moDimmed'))}</p>` : '';
  const chars = layerRow('chars', t5('moLayerChars'), `${chs.length ? `<ul class="p5-ll" role="list">${chs.map((c) => `<li><span class="p5-lln">${ic('user-round', 'md')}<span>${esc(nameOf(c))}</span></span><button type="button" class="btn p5-x" data-part="settings-button" data-p5="md-unchar" data-id="${m.id}" data-c="${c.id}" data-fk="md:${m.id}:uc:${c.id}" aria-label="${esc(t5('moOffFor', nameOf(c)))}" title="${esc(t5('moOffFor', nameOf(c)))}">${ic('x', 'lg')}</button></li>`).join('')}</ul>` : `<p class="r-desc" data-part="settings-row-description">${esc(t5('moNoChars'))}</p>`}${dimNote}<button type="button" class="btn solid p5-addc" data-part="settings-button" data-p5="md-addchar" data-id="${m.id}" data-fk="md:${m.id}:addc"${CHARS.every((c) => c.modules.indexOf(m.id) >= 0) ? ' aria-disabled="true"' : ''}>${ic('plus', 'md')}<span>${esc(t5('moAddChar'))}</span></button>`, g);
  const chats = layerRow('chats', t5('moLayerChats'), `${cts.length ? `<ul class="p5-ll" role="list">${cts.map((c) => `<li><a class="p5-lln" href="#chat-${c.id}" data-p5="chat" data-id="${c.id}" data-fk="md:${m.id}:ct:${c.id}">${ic('message-square', 'md')}<span>${esc(pick(c.ko, c.en))}</span><span class="p5-chn">${esc(nameOf(char(c.char)))}</span></a><button type="button" class="btn p5-x" data-part="settings-button" data-p5="md-unchat" data-id="${m.id}" data-c="${c.id}" data-fk="md:${m.id}:uk:${c.id}" aria-label="${esc(t5('moOffFor', pick(c.ko, c.en)))}" title="${esc(t5('moOffFor', pick(c.ko, c.en)))}">${ic('x', 'lg')}</button></li>`).join('')}</ul>` : `<p class="r-desc" data-part="settings-row-description">${esc(t5('moNoChats'))}</p>`}${dimNote}<p class="r-desc" data-part="settings-row-description">${esc(t5('moChatsHint'))}</p>`, g);
  return `<div class="p5-where" data-part="settings-module-where">${glob}${preset}${chars}${chats}</div>`;
}
function moduleSubHTML(m) {
  const nm = m.name || t5('moNoName'); const badges = (m.low ? lowBadge() : '') + (m.mcp ? `<span class="chip p5-chip" data-part="settings-module-chip" data-kind="mcp">${ic('waypoints', 'sm')}<span>MCP</span></span>` : '');
  const subExtra = `<div class="p5-subbar">${badges ? `<span class="p5-chips">${badges}</span>` : ''}${m.mcp ? '' : studioBtn(m)}</div>`;
  let h = subHead(nm, subExtra);
  const row = (k, lab, ctl, help) => `<div class="row p5-mrow" data-row="p5mod.${k}" data-part="settings-row" role="group" aria-labelledby="l-p5m-${k}"><div class="p5-argmain"><div class="r-text"><label class="r-label" id="l-p5m-${k}" for="p5m-${k}" data-part="settings-row-label">${esc(lab)}</label>${help ? `<span class="r-desc" data-part="settings-row-description" id="p5m-${k}-h">${esc(help)}</span>` : ''}</div><div class="p5-argctl">${ctl}</div></div></div>`;
  h += secOpen('mod.basic', t5('moBasic')) + `<div class="rows" data-part="settings-rows">` +
    row('name', t5('moName'), `<input id="p5m-name" class="inp" data-part="settings-field" data-p5i="m-name" data-id="${m.id}" data-fk="md:${m.id}:name" value="${esc(m.name)}" autocomplete="off" spellcheck="false" aria-describedby="p5m-name-e">`, '') + `<p class="p5-err" id="p5m-name-e" role="alert" hidden>${esc(t5('moNameEmpty'))}</p>` +
    row('desc', t5('moDesc'), `<textarea id="p5m-desc" class="inp ta" data-part="settings-field" data-p5i="m-desc" data-id="${m.id}" data-fk="md:${m.id}:desc" rows="3" spellcheck="false">${esc(mnote(m))}</textarea>`, '') +
    row('ns', t5('moNs'), `<input id="p5m-ns" class="inp" data-part="settings-field" data-p5i="m-ns" data-id="${m.id}" data-fk="md:${m.id}:ns" value="${esc(m.ns || '')}" autocomplete="off" spellcheck="false" aria-describedby="p5m-ns-h p5m-ns-e" placeholder="${esc(t5('moNsPh'))}">`, t5('moNsHelp')) + `<p class="p5-err" id="p5m-ns-e" role="alert" hidden>${esc(t5('moNsBad'))}</p>` +
    row('hide', t5('moHideIcon'), `<span class="sw" data-part="settings-toggle"><input id="p5m-hide" type="checkbox" role="switch" data-p5i="m-hide" data-id="${m.id}" data-fk="md:${m.id}:hide"${m.hideIcon ? ' checked' : ''}><span class="sw-ui" aria-hidden="true"></span></span>`, '') + '</div></section>';
  h += secOpen('mod.perm', t5('moPerm')) + `<div class="p5-perm" data-part="settings-module-access" data-part-critical data-low="${m.low ? 'on' : 'off'}">${ic(m.low ? 'shield-alert' : 'shield-check', 'lg')}<div><p class="p5-permt">${esc(m.low ? t5('moPermOn') : t5('moPermOff'))}</p><p class="r-desc" data-part="settings-row-description">${esc(m.low ? t5('moPermOnHelp') : t5('moPermOffHelp'))}</p>${m.mcp ? '' : `<a class="p5-link" href="${esc(studioLink(m.id, 'advanced'))}" data-p5="studio" data-id="${m.id}" data-fk="md:${m.id}:perm">${ic('external-link', 'md')}<span>${esc(t5('moPermChange'))}</span></a>`}</div></div></section>`;
  const cnt = (kind, lab) => `<li><a class="p5-link" href="${esc(studioLink(m.id, kind))}" data-p5="studio" data-id="${m.id}" data-fk="md:${m.id}:k:${kind}">${ic('external-link', 'md')}<span>${esc(lab)}</span></a></li>`;
  h += m.mcp ? secOpen('mod.content', t5('moContent')) + `<p class="r-desc" data-part="settings-row-description">${esc(t5('moMcpNoStudio'))}</p></section>` : secOpen('mod.content', t5('moContent')) + `<ul class="p5-counts" role="list" data-part="settings-module-counts">${cnt('lore', t5('moLore', m.lore))}${cnt('regex', t5('moRegex', m.regex))}${cnt('scripts', t5('moScripts', m.scripts))}${cnt('toggles', t5('moToggles', m.toggles))}${cnt('display', t5('moChipAssets', m.assets))}${cnt('html', t5('moHtml', m.html))}</ul><p class="r-desc" data-part="settings-row-description">${esc(t5('moContentHelp'))}</p></section>`;
  if (m.mcp) h += secOpen('mod.mcp', 'MCP') + `<div class="p5-mcp" data-part="settings-module-mcp"><label class="dlg-l" for="p5-mcpurl">${esc(t5('moMcpUrl'))}</label><div class="p5-mcprow"><input id="p5-mcpurl" class="inp" readonly value="${esc(m.mcp.url)}" aria-readonly="true" data-part="settings-field"><button type="button" class="btn" data-part="settings-button" data-p5="copy" data-v="${esc(m.mcp.url)}" data-fk="md:${m.id}:copyurl" aria-label="${esc(t5('copy'))}" title="${esc(t5('copy'))}">${ic('copy', 'lg')}</button><button type="button" class="btn solid" data-part="settings-button" data-p5="md-reconnect" data-id="${m.id}" data-fk="md:${m.id}:reconnect">${ic('refresh-cw', 'md')}<span>${esc(t5('moReconnect'))}</span></button></div></div></section>`;
  h += secOpen('mod.where', t5('moWhere')) + whereHTML(m) + '</section>';
  h += `<section class="sec" data-sec="mod.more" data-part="settings-section"><details class="p5-details" id="p5-details"${P5.open.details ? ' open' : ''}><summary class="p5-sum" data-fk="md:${m.id}:sum">${esc(t5('moDetails'))}</summary><div class="p5-idrow"><span class="r-label" data-part="settings-row-label">ID</span><code class="p5-id">${esc(m.id)}</code><button type="button" class="btn" data-part="settings-button" data-p5="copy" data-v="${esc(m.id)}" data-fk="md:${m.id}:copyid" aria-label="${esc(t5('copy') + ' ID')}" title="${esc(t5('copy') + ' ID')}">${ic('copy', 'lg')}</button></div></details></section>`;
  h += `<div class="p5-acts p5-modacts">${m.mcp ? '' : `<button type="button" class="btn solid" data-part="settings-button" data-p5="md-export" data-id="${m.id}" data-fk="md:${m.id}:export">${ic('download', 'md')}<span>${esc(t5('moExport'))}</span></button>`}<button type="button" class="btn solid" data-part="settings-button" data-p5="md-convert" data-id="${m.id}" data-fk="md:${m.id}:convert">${ic('user-plus', 'md')}<span>${esc(t5('moConvert'))}</span></button><button type="button" class="btn solid danger" data-part="settings-button" data-p5="md-del" data-id="${m.id}" data-fk="md:${m.id}:del">${ic('trash-2', 'md')}<span>${esc(t5('moDelete'))}</span></button></div>`;
  return h + '</div>';
}
function modMenu(id, anchor) {
  const m = mod(id); const items = [{ icon: 'info', label: t5('moInfo'), fn: () => openSub('module', id) }];
  if (!m.mcp) { items.push({ icon: 'external-link', label: t5('moStudio'), href: studioLink(id) }); items.push({ icon: 'download', label: t5('moExport'), fn: () => modExport(id) }); }
  items.push({ icon: 'user-plus', label: t5('moConvert'), fn: () => modConvert(id) }); items.push({ icon: 'trash-2', label: t5('moDelete'), fn: () => modDelete(id) });
  A.showMenu(items, anchor, null, anchor, t5('menuOf', m.name || t5('moNoName')));
}
function modAddMenu(anchor) { A.showMenu([{ icon: 'plus', label: t5('moMenuNew'), fn: modNew }, { icon: 'file-up', label: t5('moMenuImport'), fn: modImport }, { icon: 'waypoints', label: t5('moMenuMcp'), fn: modMcp }], anchor, null, anchor, t5('moAddAria')); }
function lowAsk(m, onOk, onCancel, where) {   // DS-114: turning a low-level module on asks once per action
  const wk = where && where.k === 'char' ? 'moLowTChar' : where && where.k === 'preset' ? 'moLowTPreset' : 'moLowTAll';   // the title says where it turns on; the name goes on its own line (DS-038)
  const wl = where && where.k === 'char' ? `<p class="p5-dwhere">${esc(t5('moLowLineChar', where.v))}</p>` : where && where.k === 'preset' ? `<p class="p5-dwhere">${esc(t5('moLowLinePreset', where.v))}</p>` : '';
  ask({ title: t5(wk), body: `<p class="p5-dname">${esc(m.name)}</p>${wl}<div class="p5-lowline" data-part="settings-module-access" data-part-critical data-low="on">${ic('shield-alert', 'md')}<span>${esc(t5('moPermOnHelp'))}</span></div>`, ok: t5('moLowOn'), danger: true, onOk, onClose: (why) => { if (why !== 'ok' && onCancel) onCancel(); } });
}
function modSetGlobal(id, on, input) {
  const m = mod(id); if (!m) return;
  const apply = () => { m.global = on; repaint(); announce((on ? t5('moGlobalOn') : t5('moGlobalOff')) + ': ' + m.name); };
  if (on && m.low) { lowAsk(m, apply, () => repaint(), { k: 'all' }); if (input) input.checked = false; return; }
  apply();
}
function modAddChar(id) {
  const m = mod(id); const free = CHARS.filter((c) => c.modules.indexOf(id) < 0); if (!free.length) return;
  const d = A.openDialog({ title: t5('moPickChar'), body: `<ul class="p5-pick" role="list">${free.map((c) => `<li><button type="button" class="btn solid" data-dlg="pick:${c.id}" data-part="settings-button">${ic('user-round', 'md')}<span>${esc(nameOf(c))}</span></button></li>`).join('')}</ul>`, buttons: [{ id: 'cancel', label: t5('cancel') }], initial: '[data-dlg^="pick"]' });
  const h = {}; free.forEach((c) => { h['pick:' + c.id] = () => { setTimeout(() => { const go = () => modCharOn(id, c.id); if (m.low) lowAsk(m, go, null, { k: 'char', v: nameOf(c) }); else go(); }, 0); }; }); A.openDialog.handlers = h; return d;
}
function modCharOn(id, cid) {
  const m = mod(id), c = char(cid); if (!m || !c || c.modules.indexOf(id) >= 0) return; c.modules.push(id);
  const e = pushLU(t5('moLuChar', m.name), () => { const k = c.modules.indexOf(id); if (k >= 0) c.modules.splice(k, 1); return ''; }, 'module-layer'); repaint('md:' + id + ':addc'); toastUndo(t5('moCharOn'), e, { sub: nameOf(c) }); announce(t5('moCharOn') + ' ' + nameOf(c));
}
function modLayerOff(kind, id, cid) {
  const m = mod(id), c = kind === 'char' ? char(cid) : chat(cid); if (!m || !c) return; const k = c.modules.indexOf(id); if (k < 0) return; c.modules.splice(k, 1);
  const e = pushLU(t5('moLuOff', m.name), () => { if (c.modules.indexOf(id) < 0) c.modules.splice(Math.min(k, c.modules.length), 0, id); return ''; }, 'module-layer');
  repaint('md:' + id + ':' + (kind === 'char' ? 'addc' : 'sum')); toastUndo(t5('moLayerOff'), e, { sub: kind === 'char' ? nameOf(c) : pick(c.ko, c.en) }); announce(t5('moLayerOff'));
}
function modNew() {
  const d = A.openDialog({ title: t5('moNewT'), body: `<label class="dlg-l" for="p5-nn">${esc(t5('moNewName'))}</label><input id="p5-nn" class="inp" data-part="settings-field" autocomplete="off" spellcheck="false"><p class="dlg-hint" id="p5-nnh">${esc(t5('moNewNeed'))}</p><label class="dlg-l p5-gap" for="p5-nd">${esc(t5('moNewDesc'))}</label><input id="p5-nd" class="inp" data-part="settings-field" autocomplete="off" spellcheck="false"><label class="dlg-l p5-gap" for="p5-ns">${esc(t5('moNewNs'))}</label><input id="p5-ns" class="inp" data-part="settings-field" autocomplete="off" spellcheck="false">`, buttons: [{ id: 'cancel', label: t5('cancel') }, { id: 'create', label: t5('moNewDo'), primary: true, disabled: true }], initial: '#p5-nn' });
  const inp = $('#p5-nn', d.back), btn = $('[data-dlg="create"]', d.back);
  inp.addEventListener('input', () => { const ok = !!inp.value.trim(); btn.setAttribute('aria-disabled', ok ? 'false' : 'true'); $('#p5-nnh', d.back).hidden = ok; });
  d.back.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && !ev.isComposing && ev.keyCode !== 229 && ev.target.matches && ev.target.matches('input') && inp.value.trim()) { ev.preventDefault(); btn.click(); } });
  A.openDialog.handlers = { create: () => {
    const name = inp.value.trim(); if (!name) return false; const desc = $('#p5-nd', d.back).value.trim(), ns = $('#p5-ns', d.back).value.trim();
    setTimeout(() => {   // DS-116: the module exists only from here
      const m = { id: 'm' + (100 + (++P5.seq)), name, note: desc, noteEn: '', ns, hideIcon: false, low: false, mcp: null, assets: 0, lore: 0, regex: 0, scripts: 0, toggles: 0, html: false, global: false, order: Math.max.apply(null, A.S.modules.map((x) => x.order).concat([0])) + 1 }; A.S.modules.push(m);
      const e = pushLU(t5('moLuNew'), () => { const k = A.S.modules.indexOf(m); if (k >= 0) A.S.modules.splice(k, 1); if (P5.sub && P5.sub.id === m.id) { P5.sub = null; } return ''; }, 'module-new');
      A.buildIndex(); if (A.S.page !== 'ext') A.showPage('ext', { p5: true, noAnim: true }); openSub('module', m.id); toastUndo(t5('moNewDone'), e, { sub: t5('moNewStudioHint') }); announce(t5('moNewDone'));
    }, 0);
  } };
  return d;
}
function modDelete(id) {
  const m = mod(id); if (!m) return; const a = charsOf(m).length, b = chatsOf(m).length, c = presetsOf(m).length;
  ask({ title: t5('moDelT'), body: `<p class="p5-dname">${esc(m.name)}</p><p>${esc(a + b + c ? t5('moDelUse', a, b, c) : t5('moDelNone'))}</p>`, ok: t5('moDelete'), danger: true, onOk: () => {
    const idx = A.S.modules.indexOf(m), ch = charsOf(m).map((x) => [x, x.modules.indexOf(id)]), ct = chatsOf(m).map((x) => [x, x.modules.indexOf(id)]), g = m.global;
    A.S.modules.splice(idx, 1); ch.concat(ct).forEach((x) => { x[0].modules.splice(x[0].modules.indexOf(id), 1); }); m.global = false;   // the character and chat ids are cleaned (engine note); undo puts them back
    const restore = () => { if (mod(id)) return; A.S.modules.splice(Math.min(idx, A.S.modules.length), 0, m); m.global = g; ch.concat(ct).forEach((x) => { if (x[0].modules.indexOf(id) < 0) x[0].modules.splice(Math.min(x[1], x[0].modules.length), 0, id); }); };
    const tr = trashAdd('module', m, restore, m.name); const e = pushLU(t5('moLuDel', m.name), () => { restore(); trashDrop(tr.id); return ''; }, 'module-delete', { ids: [id] }); tr.lu = e.id;
    const wasSub = P5.sub && P5.sub.kind === 'module' && P5.sub.id === id; A.buildIndex();
    if (wasSub) { P5.sub = null; A.showPage('ext', { p5: true, noAnim: true, keepFocus: true }); } else repaint();
    const nf = A.S.modules[Math.min(idx, A.S.modules.length - 1)]; if (!focusFk(nf ? 'md:' + nf.id + ':open' : 'md:add')) focusFk('md:add');
    toastUndo(t5('moDeleted'), e, { kind: 'delete', sub: m.name }); announce(t5('moDeleted') + ' ' + m.name); },
    onClose: (why) => { if (why !== 'ok') focusFk('md:' + id + ':del') || focusFk('md:' + id + ':menu'); } });
}
function modExport(id) {
  const m = mod(id); const d = A.openDialog({ title: t5('moExportT'), body: `<p class="p5-dname">${esc(m.name)}</p>`, buttons: [{ id: 'charx', label: t5('moExportCharx'), primary: true }, { id: 'risum', label: t5('moExportRisum') }, { id: 'cancel', label: t5('cancel') }] });
  const go = (ext) => () => { download((m.name || 'module').replace(/[<>:"/\\|?*]/g, '') + ext, 'stub: a synthetic export of ' + m.id + '\n'); toast(t5('moExported', ext), { sub: m.name }); };
  A.openDialog.handlers = { charx: go('.charx'), risum: go('.risum') }; return d;
}
function modConvert(id) { const m = mod(id); toast(t5('moConverted'), { sub: m.name, action: { label: t5('moConvOpen'), fn: () => toast(t5('simulated', t5('moConvOpen'))) } }); announce(t5('moConverted')); }
const MCP_SUGG = [['internal:aiaccess', 'AI 호출 클라이언트', 'AI call client'], ['internal:dice', '주사위', 'Dice'], ['internal:graphmem', '그래프 기억', 'Graph memory'], ['https://mcp.deepwiki.com/mcp', 'DeepWiki', 'DeepWiki'], ['https://mcp.linear.example.invalid/mcp', 'Linear', 'Linear'], ['stdio:fs', '파일 시스템', 'File system']];
function mcpCheck(u) {
  u = u.trim(); if (!u) return t5('moMcpErrEmpty');
  const m = /^([a-z][a-z0-9+.-]*):(.*)$/i.exec(u); if (!m) return t5('moMcpErrScheme'); const s = m[1].toLowerCase();
  if (s === 'http') return /^http:\/\/(localhost|127\.\d+\.\d+\.\d+)([:/]|$)/i.test(u) ? '' : t5('moMcpErrHttp');
  if (['https', 'internal', 'stdio', 'plugin'].indexOf(s) < 0) return t5('moMcpErrScheme'); return m[2].replace(/^\/*/, '') ? '' : t5('moMcpErrEmpty');
}
function modMcp() {
  const d = A.openDialog({ title: t5('moMcpT'), body: `<label class="dlg-l" for="p5-mu">${esc(t5('moMcpUrl'))}</label><input id="p5-mu" class="inp" data-part="settings-field" autocomplete="off" spellcheck="false" placeholder="https://" aria-describedby="p5-mue"><p class="p5-err" id="p5-mue" role="alert" hidden></p><p class="dlg-hint">${esc(t5('moMcpSugg'))}</p><ul class="p5-pick" role="list">${MCP_SUGG.map((s, i) => `<li><button type="button" class="btn" data-sugg="${i}" data-part="settings-button">${esc(pick(s[1], s[2]))}</button></li>`).join('')}</ul>`, buttons: [{ id: 'cancel', label: t5('cancel') }, { id: 'go', label: t5('moMcpDo'), primary: true }], initial: '#p5-mu' });
  const inp = $('#p5-mu', d.back), er = $('#p5-mue', d.back);
  d.back.addEventListener('click', (ev) => { const s = ev.target.closest('[data-sugg]'); if (s) { inp.value = MCP_SUGG[+s.dataset.sugg][0]; er.hidden = true; inp.removeAttribute('aria-invalid'); inp.focus(); } });
  d.back.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && !ev.isComposing && ev.keyCode !== 229 && ev.target === inp) { ev.preventDefault(); $('[data-dlg="go"]', d.back).click(); } });
  A.openDialog.handlers = { go: () => {
    const why = mcpCheck(inp.value); if (why) { er.textContent = why; er.hidden = false; inp.setAttribute('aria-invalid', 'true'); announce(why); return false; }
    const u = inp.value.trim(); const sg = MCP_SUGG.find((s) => s[0] === u); const host = (/^[a-z]+:(?:\/\/)?([^/:]+)/i.exec(u) || [])[1] || u;
    setTimeout(() => { const m = { id: 'm' + (100 + (++P5.seq)), name: sg ? pick(sg[1], sg[2]) : host, note: 'MCP: ' + host, noteEn: '', ns: '', hideIcon: false, low: false, mcp: { url: u }, assets: 0, lore: 1, regex: 0, scripts: 0, toggles: 0, html: false, global: false, order: Math.max.apply(null, A.S.modules.map((x) => x.order).concat([0])) + 1 }; A.S.modules.push(m);
      const e = pushLU(t5('moLuMcp'), () => { const k = A.S.modules.indexOf(m); if (k >= 0) A.S.modules.splice(k, 1); return ''; }, 'module-new'); P5.fresh = m.id; A.buildIndex(); repaint('md:' + m.id + ':open'); toastUndo(t5('moMcpDone'), e, { sub: m.name }); }, 0);
  } };
  return d;
}
const IMP_FILES = [{ id: 'g1', name: 'fantasy-pack.risum', mod: { name: '판타지 소품 모음', ns: 'props', low: false, id: 'imp-1' } }, { id: 'g2', name: 'dice-rules.charx', mod: { name: '주사위 규칙', ns: 'dice-rules', low: false, id: 'm3' } }, { id: 'g3', name: 'deep-script.lorebook', mod: { name: '깊은 스크립트', ns: '', low: true, id: 'imp-3' } }, { id: 'g4', name: 'notes.txt', mod: null }];
function modImport() {
  let sel = {}; const body = () => `<p>${esc(t5('moImpPick'))}</p><ul class="p5-files" role="list">${IMP_FILES.map((f) => `<li><label class="p5-filel"><input type="checkbox" data-pf="${f.id}"${sel[f.id] ? ' checked' : ''}><span>${esc(f.name)}</span></label></li>`).join('')}</ul>`;
  let finished = false; const d = A.openDialog({ critical: true, onClose: () => { if (!finished) announce(t5('moImpCancelled')); }, title: t5('moImpT'), body: body(), buttons: [{ id: 'cancel', label: t5('cancel') }, { id: 'ok', label: t5('moImpDo'), primary: true, disabled: true }], initial: '[data-pf]' });
  d.back.addEventListener('change', (ev) => { const c = ev.target.closest('[data-pf]'); if (c) { sel[c.dataset.pf] = c.checked; $('[data-dlg="ok"]', d.back).setAttribute('aria-disabled', IMP_FILES.some((f) => sel[f.id]) ? 'false' : 'true'); } });
  const step = (title, bodyHtml, buttons, handlers) => { $('.dlg-t', d.back).textContent = title; $('.dlg-b', d.back).innerHTML = bodyHtml; $('.dlg-f', d.back).innerHTML = buttons.map((b) => `<button type="button" class="btn ${b.primary ? 'accent solid' : b.danger ? 'danger solid' : 'solid'}" data-part="settings-button" data-dlg="${b.id}">${esc(b.label)}</button>`).join(''); A.openDialog.handlers = handlers; const f = $('[data-dlg]', d.back); if (f) f.focus(); return false; };
  A.openDialog.handlers = { ok: () => {
    const files = IMP_FILES.filter((f) => sel[f.id]); if (!files.length) return false;
    const done = []; const added = []; const replaced = []; let i = 0;
    const finish = () => {
      finished = true; let ord = Math.max.apply(null, A.S.modules.map((x) => x.order).concat([0])); added.forEach((m) => { m.order = ++ord; A.S.modules.push(m); }); replaced.forEach((r) => { Object.assign(r.m, r.patch); });   // everything is written here, once
      const lines = done.map((x) => `<li class="p5-impl" data-res="${x.res}"><span>${esc(x.file)}</span><span class="p5-impr">${esc(x.text)}</span></li>`).join('');
      const snap = added.slice(); const reps = replaced.slice();
      if (snap.length || reps.length) {
        const e = pushLU(t5('moLuImport', snap.length + reps.length), () => { snap.forEach((m) => { const k = A.S.modules.indexOf(m); if (k >= 0) A.S.modules.splice(k, 1); }); reps.forEach((r) => { Object.assign(r.m, r.old); }); return ''; }, 'module-import');
        setTimeout(() => { A.buildIndex(); repaint(); toastUndo(t5('moImpSummary', snap.length + reps.length), e); }, 0);
      }
      return step(t5('moImpT'), `<p>${esc(t5('moImpSummary', added.length + replaced.length))}</p><ul class="p5-impls" role="list">${lines}</ul>`, [{ id: 'close', label: t5('close'), primary: true }], {});
    };
    const next = () => {
      if (i >= files.length) return finish(); const f = files[i++];
      if (!f.mod) { done.push({ file: f.name, res: 'bad', text: t5('moImpBad') }); return next(); }
      const ex = mod(f.mod.id); const mk = () => ({ id: f.mod.id.indexOf('imp') === 0 ? 'm' + (100 + (++P5.seq)) : f.mod.id + '-b' + (++P5.seq), name: f.mod.name, note: '', noteEn: '', ns: f.mod.ns, hideIcon: false, low: f.mod.low, mcp: null, assets: 2, lore: 3, regex: 0, scripts: f.mod.low ? 2 : 0, toggles: 0, html: false, global: false, order: Math.max.apply(null, A.S.modules.map((x) => x.order).concat([0])) + 1 });
      const addNew = () => { const m = mk(); added.push(m); done.push({ file: f.name, res: 'added', text: t5('moImpAdded') }); };
      const proceed = () => {
        if (ex) return step(t5('moImpDup'), `<p class="p5-dname">${esc(ex.name)}</p><p>${esc(t5('moImpDupAsk', f.name))}</p>`, [{ id: 'skip', label: t5('moImpSkip') }, { id: 'sep', label: t5('moImpSep') }, { id: 'rep', label: t5('moImpReplace'), primary: true }],
          { skip: () => { done.push({ file: f.name, res: 'skip', text: t5('moImpSkipped') }); return next(); }, sep: () => { addNew(); return next(); }, rep: () => { replaced.push({ m: ex, old: Object.assign({}, ex), patch: { name: f.mod.name, assets: 2, lore: 3 } }); done.push({ file: f.name, res: 'replaced', text: t5('moImpReplaced') }); return next(); } });
        addNew(); return next();
      };
      if (f.mod.low) return step(t5('moLowT'), `<p class="p5-dname">${esc(f.mod.name)}</p><p>${esc(t5('moImpLowQ'))}</p>`, [{ id: 'skip', label: t5('moImpSkip') }, { id: 'go', label: t5('moImpDo'), danger: true }], { skip: () => { done.push({ file: f.name, res: 'skip', text: t5('moImpDeclined') }); return next(); }, go: () => proceed() });
      return proceed();
    };
    return next(); } };
  return d;
}

/* ------------------------------------------------------------------ in-place updates (typing never repaints the field being typed in) */
function modPaintList() {
  const l = modList(); const ul = $('#p5-mlist'); if (ul) ul.innerHTML = l.map(modRowHTML).join('');
  const c = $('#p5-mcount'); if (c) c.textContent = t5('moCount', l.length, A.S.modules.length); const n = $('#p5-mnone'); if (n) n.hidden = l.length > 0;
}
function perFilter() {
  const q = P5.per.q.trim().toLowerCase(); let n = 0;
  $$('#pageScroll .p5-grid .p5-card').forEach((li) => { const p = persona(li.dataset.p5id.slice(8)); const ok = !!p && (!q || (p.name + ' ' + pnote(p)).toLowerCase().indexOf(q) >= 0); li.hidden = !ok; if (ok) n++; });
  const none = $('#p5-pnone'); if (none) none.hidden = n > 0; const c = $('#p5-pcount'); if (c) c.textContent = q ? t5('perCountOf', n, D.personas.length) : t5('perCount', D.personas.length);
}
function perLive(el) {   // a field of the persona editor: the store is written at once and the card follows in place (DS-111)
  const p = persona(el.dataset.id); if (!p) return; const f = el.dataset.p5i;
  if (f === 'name') { p.name = el.value; const nm = p.name || t5('perNoName'); const c = $(`#pageScroll [data-p5id="persona:${CSS.escape(p.id)}"] .p5-name`); if (c) c.textContent = nm; const ini = $(`#pageScroll [data-p5id="persona:${CSS.escape(p.id)}"] .p5-ini`); if (ini) ini.textContent = initialOf(p.name); const h = $('#p5-edh'); if (h) h.textContent = nm; const t = $('#pgTitle'); if (t && P5.sub) t.textContent = nm; $$('.p5-ed .p5-ini').forEach((x) => { x.textContent = initialOf(p.name); }); }
  else if (f === 'note') { if (KO()) p.note = el.value; else p.noteEn = el.value; const c = $(`#pageScroll [data-p5id="persona:${CSS.escape(p.id)}"] .p5-note`); const line = firstLine(pnote(p)); if (c) { c.textContent = line; c.hidden = !line; } }
  else if (f === 'desc') { p.desc = el.value; const c = $('#p5c-' + CSS.escape(p.id)); if (c) c.textContent = t5('perDescCount', p.desc.length); }
  P5.writes++;
}
function perFieldDone(el) {   // when the field is left: one undo step for the whole edit
  const p = persona(el.dataset.id); if (!p || el._from === undefined) return; const f = el.dataset.p5i; const to = el.value, from = el._from; el._from = to; if (to === from) return;
  const set = (v) => { if (f === 'name') p.name = v; else if (f === 'note') { if (KO()) p.note = v; else p.noteEn = v; } else p.desc = v; };
  pushLU(t5('perLuEdit', p.name || t5('perNoName')), () => { if (({ name: p.name, note: KO() ? p.note : p.noteEn, desc: p.desc })[f] === to) set(from); return ''; }, 'persona-edit'); A.buildIndex();
}
function modLive(el) {
  const m = mod(el.dataset.id); if (!m) return; const f = el.dataset.p5i; const err = $('#p5m-name-e');
  if (f === 'm-name') { const v = el.value.trim(); if (!v) { if (err) err.hidden = false; el.setAttribute('aria-invalid', 'true'); return; } if (err) err.hidden = true; el.removeAttribute('aria-invalid'); m.name = el.value; const h = $('#pgTitle'); if (h) h.textContent = m.name; }
  else if (f === 'm-desc') { if (KO()) m.note = el.value; else m.noteEn = el.value; }
  else if (f === 'm-ns') {
    const v = el.value.trim(); const er = $('#p5m-ns-e');
    if (nsBad(el.value)) { el.setAttribute('aria-invalid', 'true'); if (er) er.hidden = false; return; }   // a comma or a space cannot be in a namespace: presets read a comma-separated list
    el.removeAttribute('aria-invalid'); if (er) er.hidden = true;
    if (m.low && v && !presetsOf(m).length && presetsForNs(v).length) return;   // this would switch a low-level module on through a preset: asked when the field is left (DS-124)
    m.ns = v; repaintWhere();
  }
  P5.writes++;
}
const nsBad = (v) => /[,\s]/.test(String(v).trim());
const presetsForNs = (ns) => (ns ? D.presets.filter((p) => presetNs(p).indexOf(ns) >= 0) : []);
function repaintWhere() { const w = $('#pageScroll .p5-where'); const m = P5.sub && P5.sub.kind === 'module' && mod(P5.sub.id); if (w && m) { const t = document.createElement('div'); t.innerHTML = whereHTML(m); w.replaceWith(t.firstElementChild); } }
function modFieldDone(el) {
  const m = mod(el.dataset.id); if (!m) return; const f = el.dataset.p5i;
  if (f === 'm-name' && !el.value.trim()) { el.value = m.name; el.removeAttribute('aria-invalid'); const err = $('#p5m-name-e'); if (err) err.hidden = true; announce(t5('moNameEmpty')); toast(t5('moNameEmpty'), { ms: 4000 }); el._from = m.name; return; }
  if (f === 'm-ns') {
    const v = el.value.trim(); const er = $('#p5m-ns-e'); const old = el._from !== undefined ? el._from : (m.ns || '');
    if (nsBad(el.value)) { el.value = m.ns || ''; el.removeAttribute('aria-invalid'); if (er) er.hidden = true; announce(t5('moNsBad')); toast(t5('moNsBad'), { ms: 4000 }); el._from = el.value; return; }
    if (m.low && v && v !== (m.ns || '') && !presetsOf(m).length && presetsForNs(v).length) {   // DS-124: the confirm appears on every path that turns a low-level module on, a namespace edit through a preset included
      lowAsk(m, () => { m.ns = v; el._from = v; pushLU(t5('moLuEdit', m.name), () => { m.ns = old; return ''; }, 'module-edit'); A.buildIndex(); repaintWhere(); announce(t5('moWherePreset') + ': ' + v); }, () => { m.ns = old; el.value = old; el._from = old; repaintWhere(); }, { k: 'preset', v: v });
      return;
    }
    if (old && old !== v && presetsForNs(old).length && !presetsForNs(v).length) { const n = presetsForNs(old).length; announce(t5('moNsLost', n)); toast(t5('moNsLost', n), { sub: m.name, ms: 5000 }); }
  }
  if (el._from === undefined) return; const from = el._from, to = el.value; el._from = to; if (from === to) return;
  const get = () => (f === 'm-name' ? m.name : f === 'm-desc' ? (KO() ? m.note : m.noteEn) : m.ns); const set = (v) => { if (f === 'm-name') m.name = v; else if (f === 'm-desc') { if (KO()) m.note = v; else m.noteEn = v; } else m.ns = v; };
  void get; pushLU(t5('moLuEdit', m.name), () => { set(from); return ''; }, 'module-edit'); A.buildIndex();
}

/* ------------------------------------------------------------------ events. Everything inside the three pages is handled here in the capture phase and stops, so slice 1's generic row handlers never write behind the store (the shortcut rows are rows of its catalogue). */
function onClick(ev) {
  const t = ev.target; if (!(t instanceof Element)) return; const b = t.closest('[data-p5]'); const sc = $('#pageScroll'); if (!b || b === sc || !sc.contains(b)) return;
  const k = b.dataset.p5, id = b.dataset.id; if (b.getAttribute('aria-disabled') === 'true' && k === 'hk-resetall') { ev.stopPropagation(); ev.preventDefault(); announce(t5('hkResetNone')); toast(t5('hkResetNone'), { ms: 3000 }); return; }
  if (b.getAttribute('aria-disabled') === 'true' && k !== 'per-del') { ev.stopPropagation(); ev.preventDefault(); return; }
  if (k !== 'studio') ev.preventDefault(); ev.stopPropagation();
  switch (k) {
    case 'rec': hkStartRec(id); break;
    case 'hk-menu': hkMenu(id, b); break;
    case 'swap': hkSwap(id); break;
    case 'conf-cancel': { P5.hk.conf = null; hkPaint(id); focusFk('hk:' + id + ':chord'); announce(t5('hkCancelled')); break; }
    case 'hk-resetall': hkResetAll(); break;
    case 'open-persona': perOpen(id, false); break;
    case 'per-menu': perMenu(id, b); break;
    case 'per-add': perAddMenu(b); break;
    case 'per-use': perUse(id); break;
    case 'per-export': perExport(id); break;
    case 'per-dup': perDup(id); break;
    case 'per-del': if (D.personas.length <= 1) announce(t5('perLast')); else perDelete(id); break;
    case 'portrait': perPortrait(id); break;
    case 'trash': openTrash(b.dataset.kind); break;
    case 'open-plugin': openSub('plugin', id); break;
    case 'pl-menu': plMenu(id, b); break;
    case 'pl-add': plPick(); break;
    case 'pl-dev': plDevMenu(b); break;
    case 'pl-check': plCheck(false); break;
    case 'pl-upd': plUpdate(id); break;
    case 'arg-reset': { const p = plugin(id), a = p && p.args.find((x) => x.key === b.dataset.key); if (a) { delete P5.argDraft[id + '|' + a.key]; argCommit(p, a, a.def); repaint('pl:' + id + ':a:' + a.key); } break; }
    case 'open-module': openSub('module', id); break;
    case 'md-menu': modMenu(id, b); break;
    case 'md-add': modAddMenu(b); break;
    case 'md-filter': P5.mod[b.dataset.f] = !P5.mod[b.dataset.f]; repaint('md:f:' + b.dataset.f); break;
    case 'md-unchar': modLayerOff('char', id, b.dataset.c); break;
    case 'md-unchat': modLayerOff('chat', id, b.dataset.c); break;
    case 'md-addchar': modAddChar(id); break;
    case 'md-preset': { const pid = id; const go = () => A.openRow(A.ROW['models.moduleIntegration'], {}); if (pid !== A.S.presetActive) { B.switchTo(pid, { quiet: true, force: true }); setTimeout(go, 0); } else go(); break; }
    case 'md-reconnect': toast(t5('moReconnected'), { sub: mod(id).name }); announce(t5('moReconnected')); break;
    case 'md-export': modExport(id); break;
    case 'md-convert': modConvert(id); break;
    case 'md-del': modDelete(id); break;
    case 'copy': copyText(b.dataset.v); toast(t5('copied'), { ms: 2500 }); announce(t5('copied')); break;
    case 'chat': toast(t5('simulated', t5('chatOpen'))); break;
    case 'studio': break;
    default: break;
  }
}
function onInput(ev) {
  const el = ev.target; const f = el.dataset && el.dataset.p5i; if (!f || !$('#pageScroll').contains(el)) return; ev.stopPropagation();
  if (f === 'name' || f === 'note' || f === 'desc') perLive(el);
  else if (f === 'per-q') { P5.per.q = el.value; perFilter(); }
  else if (f === 'md-q') { P5.mod.q = el.value; modPaintList(); }
  else if (f === 'm-name' || f === 'm-desc' || f === 'm-ns') modLive(el);
}
function onChange(ev) { P5.defer = true; try { onChange0(ev); } finally { P5.defer = false; } }
function onChange0(ev) {
  const el = ev.target; const sc = $('#pageScroll'); if (!sc.contains(el)) return;
  if (el.dataset && el.dataset.p5arg) { ev.stopPropagation(); if (el.matches('[data-p5seg]')) return; if (el.type === 'checkbox') { const p = plugin(el.dataset.id), a = p && p.args.find((x) => x.key === el.dataset.p5arg); if (a) { argCommit(p, a, el.checked ? 1 : 0); repaint('pl:' + p.id + ':a:' + a.key); } } else argInput(el); return; }
  const f = el.dataset && el.dataset.p5i; if (!f) return; ev.stopPropagation();
  if (f === 'pl-on') plToggle(el.dataset.id, el.checked, el);
  else if (f === 'md-on') modSetGlobal(el.dataset.id, el.checked, el);
  else if (f === 'large') { const p = persona(el.dataset.id); if (p) { p.large = el.checked; pushLU(t5('perLuEdit', p.name || t5('perNoName')), () => { p.large = !el.checked; return ''; }, 'persona-edit'); repaint('pe:' + p.id + ':large'); } }
  else if (f === 'name' || f === 'note' || f === 'desc') perFieldDone(el);
  else if (f === 'm-name' || f === 'm-desc' || f === 'm-ns') modFieldDone(el);
  else if (f === 'm-hide') { const m = mod(el.dataset.id); if (m) { m.hideIcon = el.checked; pushLU(t5('moLuEdit', m.name), () => { m.hideIcon = !el.checked; return ''; }, 'module-edit'); } }
  else if (f === 'md-sort') { P5.mod.sort = el.value; repaint('md:sort'); }
}
function onFocusin(ev) { const el = ev.target; if (el.dataset && el.dataset.p5i && /^(name|note|desc|m-name|m-desc|m-ns)$/.test(el.dataset.p5i)) { if (el._from === undefined) el._from = el.value; } }
function onKeydown(ev) {
  const t = ev.target; const sc = $('#pageScroll'); if (!(t instanceof Element) || !sc.contains(t)) return;
  const card = t.closest('.p5-cardmain');
  if (card && ev.altKey && (ev.key === 'ArrowUp' || ev.key === 'ArrowDown')) { ev.preventDefault(); ev.stopPropagation(); perMove(card.dataset.id, ev.key === 'ArrowUp' ? -1 : 1, true); return; }
  const seg = t.closest('[data-p5seg]');
  if (seg && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].indexOf(ev.key) >= 0) {
    ev.preventDefault(); ev.stopPropagation(); const bs = $$('[data-p5seg]', seg.parentNode); let i = bs.indexOf(seg);
    i = ev.key === 'Home' ? 0 : ev.key === 'End' ? bs.length - 1 : (i + (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp' ? -1 : 1) + bs.length) % bs.length; argSeg(bs[i]); return;
  }
  const hk = t.closest('.p5-hk'); const menuKey = (ev.key === 'F10' && ev.shiftKey) || ev.key === 'ContextMenu';
  if (hk && menuKey && !hk.classList.contains('rec')) { const r = hkRow(hk.dataset.row); if (r && !r.fixed && !hkRO()) { ev.preventDefault(); ev.stopPropagation(); const c = $('.p5-chord', hk); hkMenu(r.id, null, { x: c.getBoundingClientRect().left, y: c.getBoundingClientRect().bottom }, c); } else { ev.stopPropagation(); } return; }
  if (ev.key === 'Enter' && t.matches && t.matches('input[data-p5arg], input[data-p5i="m-name"], input[data-p5i="m-ns"], input[data-p5i="name"], input[data-p5i="note"]') && !ev.isComposing && ev.keyCode !== 229) { ev.preventDefault(); t.dispatchEvent(new Event('change', { bubbles: true })); }   // preventDefault: the keypress must not land on a dialog button that this change opens
}
function onCtx(ev) {
  const t = ev.target; if (!(t instanceof Element)) return; const hk = t.closest('.p5-hk'); if (!hk || !$('#pageScroll').contains(hk)) return; ev.stopPropagation();
  if (t.closest('input,textarea,select')) return; ev.preventDefault(); const r = hkRow(hk.dataset.row); if (r && !r.fixed && !hkRO() && !hk.classList.contains('rec')) hkMenu(r.id, null, { x: ev.clientX, y: ev.clientY }, $('.p5-chord', hk));
}
function onPointerDown(ev) {
  const t = ev.target; if (!(t instanceof Element)) return; const h = t.closest('[data-p5="drag"]');
  if (h && $('#pageScroll').contains(h)) { ev.stopPropagation(); perDragStart(ev, h.dataset.id); return; }
  if (t.closest('.p5-hk') && ev.pointerType === 'touch') ev.stopPropagation();   // slice 1's long-press menu would reset a shortcut behind the page; the ⋯ button is the way here
}
function onDocKey(ev) {
  if (!A || !A.S.open) return;
  if (!P5.kbd && (ev.ctrlKey || ev.altKey || ev.metaKey)) { P5.kbd = true; P5.roForce = false; if (A.S.page === 'keys' && A.S.view === 'page' && $('#app').clientWidth < 768) repaint(); }   // a keydown with a modifier: a hardware keyboard (Shift is not a signal: soft keyboards set it)
  if (document.body.classList.contains('dlg-open') || P5.hk.rec || !inMine()) return;
  const z = ev.code ? ev.code === 'KeyZ' : (ev.key === 'z' || ev.key === 'Z');
  if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && !ev.shiftKey && z && !A.inTextField(document.activeElement)) { ev.preventDefault(); ev.stopImmediatePropagation(); B.undoLast(); }   // Ctrl+Z in these lists undoes the last list action (DS-036); Alt+Z does it anywhere (slice 2)
}
function bindPage5() {
  const sc = $('#pageScroll');
  [['click', onClick], ['input', onInput], ['change', onChange], ['focusin', onFocusin], ['keydown', onKeydown], ['contextmenu', onCtx], ['pointerdown', onPointerDown]].forEach((p) => sc.addEventListener(p[0], p[1], true));
  document.addEventListener('keydown', onDocKey, true);
  const mq = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)'); if (mq) { const f = () => { if (A.S.open && A.S.page === 'keys') repaint(); }; if (mq.addEventListener) mq.addEventListener('change', f); else if (mq.addListener) mq.addListener(f); }
  const det = $('#pageScroll'); det.addEventListener('toggle', (ev) => { if (ev.target.id === 'p5-details') P5.open.details = ev.target.open; }, true);
}

/* ------------------------------------------------------------------ hooks called by slice1.js (wrapping slice 2's, 3's and 4's) */
const H = {};
['boot', 'pageHTML', 'rendered', 'nav', 'back', 'closing', 'backLabel', 'headerTitle', 'indexExtra', 'lang', 'title', 'demoPanel', 'afterInit', 'ready', 'refreshAfterLU'].forEach((k) => { H[k] = X[k]; });
const split = () => perSplit();
X.pageHTML = (pid, o) => {
  if (pid === 'keys') return keysPageHTML(); if (pid === 'persona') return personaPageHTML(); if (pid === 'ext') return extPageHTML();
  return H.pageHTML ? H.pageHTML(pid, o) : null;
};
function runPending() {
  const pd = P5.pending; P5.pending = null; if (!pd || !A.S.open) return;
  if (pd.kind === 'persona' && P5.sub && !split()) { const h = $('#pgTitle'); if (h) h.focus({ preventScroll: true }); return; }
  const el = $(`#pageScroll [data-p5id="${pd.kind}:${CSS.escape(pd.id)}"]`); if (!el) return;
  el.scrollIntoView({ block: 'center', behavior: A.S.rm || A.S.lp ? 'auto' : 'smooth' }); A.highlight(el); const f = $('.p5-name, .p5-cardmain', el); if (f) f.focus({ preventScroll: true });
}
X.rendered = (pg) => {
  if (H.rendered) H.rendered(pg);
  P5.fresh = '';
  if (P5.hk.rec && !$(`#pageScroll .p5-hk[data-row="${CSS.escape(P5.hk.rec.id)}"]`)) hkStopRec(true);
  if (A.S.page === 'ext' && !P5.sub && !P5.pl.autoRun && D.plugins.length) { P5.pl.autoRun = true; if (plAutoDue()) plCheck(true); else plApplyKnown(); }   // DS-126: at most one automatic check a day; the last results are shown either way
};
X.nav = (pid, o) => {
  if (H.nav) H.nav(pid, o);
  if (!o.p5) P5.sub = null;
  if (o.thing) {
    const m = /^(persona|plugin|module):(.+)$/.exec(o.thing);
    if (m) { P5.pending = { kind: m[1], id: m[2] }; if (m[1] === 'persona') { P5.per.sel = m[2]; if (!split()) P5.sub = { kind: 'persona', id: m[2] }; } setTimeout(runPending, 0); }
  }
  if (pid !== 'keys' && P5.hk.rec) hkStopRec(true); if (pid !== 'keys') P5.hk.conf = null;
};
X.back = () => {
  if (A.S.open && P5.hk.rec) { hkStopRec(); return true; }
  if (A.S.open && P5.hk.conf) { const id = P5.hk.conf.id; P5.hk.conf = null; hkPaint(id); focusFk('hk:' + id + ':chord'); return true; }
  if (A.S.open && P5.sub && !(P5.sub.kind === 'persona' && split()) && !A.S.resume && inMine()) { subClose(); return true; }
  return H.back ? H.back() : false;
};
X.backLabel = () => {
  if (A.S.open && P5.sub && !(P5.sub.kind === 'persona' && split()) && inMine()) return P5.sub.kind === 'persona' ? { label: t5('backPersona'), vis: t5('backPersonaShort') } : { label: t5('backExt'), vis: t5('backExtShort') };
  return H.backLabel ? H.backLabel() : null;
};
X.headerTitle = () => {
  if (A.S.open && P5.sub && inMine()) { const x = P5.sub.kind === 'persona' ? persona(P5.sub.id) : P5.sub.kind === 'plugin' ? plugin(P5.sub.id) : mod(P5.sub.id); if (x) return x.name || (P5.sub.kind === 'persona' ? t5('perNoName') : t5('moNoName')); }
  return H.headerTitle ? H.headerTitle() : null;
};
X.closing = () => {
  const r = H.closing ? H.closing() : true; if (r === false) return false;
  hkStopRec(true); P5.hk.conf = null; P5.sub = null; P5.argDraft = {}; return true;
};
X.indexExtra = (mk, IDX) => {
  if (H.indexExtra) H.indexExtra(mk, IDX);
  for (let i = IDX.length - 1; i >= 0; i--) { const e = IDX[i]; if ((e.k === 'persona' || e.k === 'plugin' || e.k === 'module') || (e.k === 'setting' && e.row && e.row.page === 'keys' && hkHidden(e.row))) IDX.splice(i, 1); }
  const pg = A.PAGE;
  const thing = (kind, id, ico, name, nameEn, syn, desc, descEn, ref, pid, sid, tagKo, tagEn) => { const p = pg[pid], s = A.SEC[sid]; IDX.push(mk(kind, kind + ':' + id, ico, name, nameEn || name, syn, id, p.ko + (s.ko ? ' › ' + s.ko : '') + (tagKo ? ' · ' + tagKo : ''), p.en + (s.en ? ' › ' + s.en : '') + (tagEn ? ' · ' + tagEn : ''), desc, descEn === undefined ? desc : descEn, '', '', { page: pid, sec: sid, thing: id, nocr: true, ref })); };
  D.personas.forEach((p) => thing('persona', p.id, 'user-round', p.name, p.name, '', p.note, p.noteEn, p, 'persona', 'persona.main'));
  D.plugins.forEach((p) => thing('plugin', p.id, 'puzzle', p.name, p.name, '', plMeta(p), plMeta(p), p, 'ext', 'ext.plugins', plLevel(p) === 'full' ? K.ko.plFullShort : '', plLevel(p) === 'full' ? K.en.plFullShort : ''));
  A.S.modules.forEach((m) => thing('module', m.id, m.mcp ? 'waypoints' : 'puzzle', m.name, m.name, (m.ns ? m.ns + ' @' + m.ns + ' ' : '') + (m.low ? '고급 권한 low level ' : '') + (m.mcp ? 'mcp ' : ''), m.note || '', m.noteEn || m.note || '', m, 'ext', 'ext.modules', m.low ? K.ko.moBadgeLow : '', m.low ? K.en.moBadgeLow : ''));
};
X.lang = (l) => { if (H.lang) H.lang(l); document.title = K[l].title; if (P5.hk.rec) hkStopRec(true); };
X.title = (l) => K[l].title;
X.demoPanel = (p) => {
  if (H.demoPanel) H.demoPanel(p);
  const h = document.createElement('div'); h.className = 'ps-demo p5-demo';
  const sw = (id, label, on) => `<label class="d-row"><span>${esc(label)}</span><span class="sw" data-part="settings-toggle"><input type="checkbox" role="switch" id="${id}"${on ? ' checked' : ''}><span class="sw-ui" aria-hidden="true"></span></span></label>`;
  h.innerHTML = `<h3 class="d-h">${esc(t5('demo5'))}</h3><label class="d-row"><span>${esc(t5('demoSet'))}</span><select id="d5Set">${[['demo', 'setDemo'], ['mac', 'setMac'], ['empty', 'setEmpty'], ['many', 'setMany']].map(([v, k]) => `<option value="${v}"${D5.SET5 === v ? ' selected' : ''}>${esc(t5(k))}</option>`).join('')}</select></label>` +
    sw('d5Msel', t5('demoMsel'), P5.flags.msel) + sw('d5Scroll', t5('demoScroll'), P5.flags.scroll) + sw('d5Note', t5('demoNote5'), P5.flags.note) + sw('d5Kbd', t5('demoKbd'), P5.kbd) +
    `<label class="d-row"><span>${esc(t5('demoState'))}</span><select id="d5State">${STATES5.map((s) => `<option>${s}</option>`).join('')}</select></label><div class="d-btns"><button type="button" data-part="settings-button" class="btn solid" id="d5Go"><span>${esc(t5('demoGo'))}</span></button></div>`;
  p.appendChild(h);
  $('#d5Set', h).onchange = (e) => { const u = new URL(location.href); u.searchParams.set('set', e.target.value); location.href = u.toString(); };
  const flag = (id, k) => { $(id, h).onchange = (e) => { P5.flags[k] = e.target.checked; if (k === 'kbd') P5.kbd = e.target.checked; A.buildIndex(); if (A.S.open) repaint(); }; };
  flag('#d5Msel', 'msel'); flag('#d5Scroll', 'scroll'); flag('#d5Note', 'note'); $('#d5Kbd', h).onchange = (e) => { P5.kbd = e.target.checked; if (A.S.open) repaint(); };
  $('#d5Go', h).onclick = () => { runState5($('#d5State', h).value); };
};
X.afterInit = (o) => {
  if (H.afterInit) H.afterInit(o);
  const v = Q.get('view'), id = Q.get('id');
  if (v && id && /^(persona|plugin|module)$/.test(v)) { const ok = v === 'persona' ? persona(id) : v === 'plugin' ? plugin(id) : mod(id); if (ok) { if (v === 'persona' && split()) { P5.per.sel = id; A.showPage('persona', { p5: true, noAnim: true, keepFocus: true, force: true }); } else { A.showPage(pageOf(v), { p5: true, noAnim: true, keepFocus: true, force: true }); openSub(v, id); } } else { A.showPage(pageOf(v), { noAnim: true, notice: A.t('settingNotFound'), force: true }); } }
};
X.ready = () => { if (H.ready) H.ready(); window.__ss5aReady = true; };
X.boot = (api) => {
  if (H.boot) H.boot(api);
  A = api; B = window.__ss2; Object.assign(A.ICONS, ICONS5); document.title = K[A.S.lang].title;
  Object.keys(D5.PRESET_NS).forEach((pid) => { const p = B.P(pid); if (p) p.vals['models.moduleIntegration'] = D5.PRESET_NS[pid]; });   // one module is on through a preset (a preset that names its namespace)
  A.S.personaActive = D.personas.length ? D.personas[0].id : '';
  P5.booted = true; bindPage5(); window.__ss5a = API();
  const st = Q.get('state'); if (st && STATES5.indexOf(st) >= 0) setTimeout(() => runState5(st), 0);
};

/* ------------------------------------------------------------------ states (SLICE5A_SPEC 10.3) */
const STATES5 = ['hk-page', 'hk-recording', 'hk-conflict', 'hk-swap-done', 'hk-reserved', 'hk-dup-banner', 'hk-reset-all', 'hk-phone', 'hk-phone-kbd', 'hk-mac',
  'pe-list', 'pe-editor', 'pe-delete-bound', 'pe-last', 'pe-import-preview', 'pe-reorder',
  'pl-list', 'pl-confirm-full', 'pl-update-results', 'pl-settings', 'pl-v1', 'pl-remove',
  'mo-list', 'mo-filter-lowlevel', 'mo-info', 'mo-info-mcp', 'mo-where', 'mo-lowlevel-confirm', 'mo-create', 'mo-delete', 'mo-import-dup', 'mo-mcp-connect',
  'se-hotkey', 'se-module-ns', 'se-persona'];
const needSet = (set) => { if (D5.SET5 === set) return false; const u = new URL(location.href); u.searchParams.set('set', set); location.replace(u.toString()); return true; };
async function runState5(name) {
  window.__ss5aReady = false; const q = Q.get('q');
  const openS = (opt) => { if (!A.S.open) A.openSettings($('#oSettings'), Object.assign({ noFocus: true }, opt || {})); };
  const page = (pid, opt) => { openS({ page: pid }); P5.sub = null; A.showPage(pid, Object.assign({ noAnim: true, keepFocus: true, force: true }, opt || {})); };
  const toRow = (sel) => { const e = $(sel); if (e) e.scrollIntoView({ block: 'center' }); return e; };
  const settle = () => sleep(60);
  switch (name) {
    case 'hk-page': page('keys'); break;
    case 'hk-recording': P5.kbd = true; page('keys'); await settle(); hkStartRec('keys.reroll'); toRow('[data-row="keys.reroll"]'); break;
    case 'hk-conflict': P5.kbd = true; page('keys'); await settle(); hkAssign(hkRow('keys.reroll'), 'Ctrl+H'); toRow('[data-row="keys.reroll"]'); break;
    case 'hk-swap-done': P5.kbd = true; page('keys'); await settle(); hkAssign(hkRow('keys.reroll'), 'Ctrl+H'); hkSwap('keys.reroll'); toRow('[data-row="keys.reroll"]'); break;
    case 'hk-reserved': P5.kbd = true; page('keys'); await settle(); hkStartRec('keys.reroll'); P5.hk.msg = t5('hkBrowser'); hkPaint('keys.reroll', true); toRow('[data-row="keys.reroll"]'); break;
    case 'hk-dup-banner': page('keys'); await settle(); toRow('[data-row="keys.quickSettings"]'); break;
    case 'hk-reset-all': page('keys'); await settle(); hkResetAll(); break;
    case 'hk-phone': A.setFrame(360); P5.roForce = true; page('keys'); break;
    case 'hk-phone-kbd': A.setFrame(360); P5.kbd = true; P5.roForce = false; page('keys'); break;
    case 'hk-mac': if (needSet('mac')) return new Promise(() => {}); page('keys'); break;
    case 'pe-list': page('persona'); break;
    case 'pe-editor': page('persona'); await settle(); perOpen('u3', false); break;
    case 'pe-delete-bound': page('persona'); await settle(); perDelete('u2'); break;
    case 'pe-last': if (needSet('empty')) return new Promise(() => {}); page('persona'); await settle(); perOpen('u1', false); break;
    case 'pe-import-preview': page('persona'); await settle(); { const d = perImport(); const c = $('[data-pf="i1"]', d.back); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); } break;
    case 'pe-reorder': page('persona'); await settle(); perMove('u3', -1, true); break;
    case 'pl-list': page('ext', { section: 'ext.plugins' }); await settle(); break;
    case 'pl-confirm-full': page('ext', { section: 'ext.plugins' }); await settle(); plToggle('pl5', true, null); break;
    case 'pl-update-results': page('ext', { section: 'ext.plugins' }); await settle(); D.plugins.find((p) => p.id === 'pl3').fail = true; plCheck(false); for (let i = 0; i < 60 && P5.pl.checking; i++) await sleep(20); await settle(); break;
    case 'pl-settings': page('ext'); await settle(); openSub('plugin', 'pl1'); break;
    case 'pl-v1': page('ext'); await settle(); openSub('plugin', 'pl6'); break;
    case 'pl-remove': page('ext', { section: 'ext.plugins' }); await settle(); plRemove('pl4'); break;
    case 'mo-list': page('ext', { section: 'ext.modules' }); await settle(); break;
    case 'mo-filter-lowlevel': page('ext', { section: 'ext.modules' }); await settle(); P5.mod.low = true; repaint(); break;
    case 'mo-info': page('ext'); await settle(); openSub('module', 'm3'); break;
    case 'mo-info-mcp': page('ext'); await settle(); openSub('module', 'm12'); break;
    case 'mo-where': page('ext'); await settle(); openSub('module', 'm3'); await settle(); toRow('.p5-where'); break;
    case 'mo-lowlevel-confirm': page('ext', { section: 'ext.modules' }); await settle(); modSetGlobal('m6', true, null); break;
    case 'mo-create': page('ext', { section: 'ext.modules' }); await settle(); modNew(); break;
    case 'mo-delete': page('ext', { section: 'ext.modules' }); await settle(); modDelete('m3'); break;
    case 'mo-import-dup': page('ext', { section: 'ext.modules' }); await settle(); { const d = modImport(); const c = $('[data-pf="g2"]', d.back); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); $('[data-dlg="ok"]', d.back).click(); } break;
    case 'mo-mcp-connect': page('ext', { section: 'ext.modules' }); await settle(); { const d = modMcp(); const i = $('#p5-mu', d.back); i.value = 'ftp://files.example.invalid/mcp'; $('[data-dlg="go"]', d.back).click(); } break;
    case 'se-hotkey': openS({ page: 'keys', noFocus: true }); window.__ss1.setQuery(q || '다시 생성'); break;
    case 'se-module-ns': openS({ page: 'ext', noFocus: true }); window.__ss1.setQuery(q || 'dice-rules'); break;
    case 'se-persona': openS({ page: 'persona', noFocus: true }); window.__ss1.setQuery(q || '미라'); break;
    default: break;
  }
  await sleep(60); window.__ss5aReady = name;
}

/* ------------------------------------------------------------------ public API (checks, the demo panel and reviewers) */
function API() {
  return {
    P5, K, t5, A, B, D, D5, CHARS, CHATS, STATES: STATES5, runState: runState5, repaint, openSub, subClose,
    hkRows, hkRow, hkStartRec, hkStopRec, hkAssign, hkSwap, hkClear, hkResetOne, hkResetAll, hkValidate, chordOf, dupChords, dupsOf, norm, display, spoken, hkRO,
    persona, plugin, mod, activePersonaId, boundChats, perUse, perNew, perDup, perDelete, perDoDelete, perMove, perOpen, perExport, perImport, PER_FILES,
    plLevel, plToggle, plCheck, plUpdate, plRemove, plMenu, plPick, argRowHTML, argCommit, argKind, accessHTML,
    modList, presetsOf, charsOf, chatsOf, modOn, modSetGlobal, modNew, modDelete, modImport, modMcp, mcpCheck, modAddChar, modCharOn, modLayerOff, studioLink, IMP_FILES, MCP_SUGG,
    openTrash, trashAdd, plAutoDue, plLast, presetsForNs, nsBad, luDrop,
    storeWrite: (kind, id, v) => {   // another tab or lane wrote the store: every page must read it again (DS-067)
      if (kind === 'hotkey') hkRow(id).v = v; else if (kind === 'persona') Object.assign(persona(id), v); else if (kind === 'plugin') Object.assign(plugin(id), v); else if (kind === 'module') Object.assign(mod(id), v);
      else if (kind === 'char') Object.assign(char(id), v); else if (kind === 'chat') Object.assign(chat(id), v); else if (kind === 'active-persona') A.S.personaActive = id;
      else if (kind === 'preset-ns') { const p = B.P(id); if (p.id === A.S.presetActive) A.ROW['models.moduleIntegration'].v = v; else p.vals['models.moduleIntegration'] = v; }
      A.buildIndex(); if (A.S.open) A.refreshPage();
    },
    storeRead: (kind, id) => (kind === 'hotkey' ? hkRow(id).v : kind === 'persona' ? persona(id) : kind === 'plugin' ? plugin(id) : kind === 'module' ? mod(id) : kind === 'char' ? char(id) : chat(id)),
  };
}
})();
