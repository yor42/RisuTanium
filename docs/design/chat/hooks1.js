/* Chat hooks batch 1: the preset chip in the chat header (Settings DS-020, DS-026), a compact stand-in for the preset switcher and the Ctrl+M model picker,
   the Ctrl+P / Ctrl+1-9 keys (DS-023), and the demo controls for the failed-reply card (DS-043; the card itself lives in slice1.js as window.__chat.failReply).
   Loads after slice1.js and slice2.js and uses only their extension points. Synthetic mockup; not proof of native behaviour or performance.
   Implements docs/design/chat/HOOKS1_SPEC.md (B). The switcher and picker here are STAND-INS: the real ones are the Settings slice 2 switcher (SLICE2_SPEC section 2) and the slice 3 model picker. */
(() => {
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const Q = new URLSearchParams(location.search);
let X, S, Y, S2H;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* ------------------------------------------------------------------ copy (Korean first; keys proposed for lane A) */
const HKI = {
en: {
  chipLabel: 'Preset: {name} · {model}', chipChanged: 'Preset: {name} · {model} · just changed from "{from}"', chipAlert: '{label} · save failed', chipMenu: 'Preset options',
  menuManage: 'Manage presets', menuOpen: 'Open model and preset settings',
  swTitle: 'Switch preset', swSearch: 'Search presets', swRecent: 'Recent', swFav: 'Favourites', swAll: 'All presets', swManage: 'Manage presets', swCount: '{n} presets', swNone: 'No presets match "{q}"', swInUse: 'In use',
  switched: 'Switched to "{name}"', switchedBack: 'Switched back to "{name}"', undo: 'Undo', slotEmpty: 'No preset is assigned to {key}', assign: 'Assign',
  alertNote: "Couldn't save the preset", retry: 'Retry save', discard: 'Undo the change', alertRetried: 'Saved', alertDiscarded: 'Change undone', alertA11y: "Couldn't save the preset",
  mdTitle: 'Choose a model', mdSearch: 'Search models', mdSet: 'Model changed to "{model}"', mdBack: 'Model changed back to "{model}"', mdCount: '{n} models',
  dTitle: 'Chat hooks demo', dChip: 'Preset chip', dOpenSw: 'Open the switcher', dOpenMenu: 'Open the chip menu', dOpenMd: 'Open the model picker (Ctrl+M)', dAlert: 'Show a failed preset save', dLongChar: 'Long character name', dLongPreset: 'Long preset name',
  dFail: 'Failed reply (DS-043)', dFailKey: 'Key', dFailModel: 'Model', dFailQuota: 'Usage limit', dFailNetwork: 'Network', dFailServer: 'Server', dFailRegen: 'New reply fails', dFailNext: 'Next try fails too',
  guardTitle: 'Before switching preset', guardBody: "Couldn't save the preset. What now?",
  dStates: 'States: ?state=hk-fail-key|model|quota|network|server|regen|return, hk-chip, hk-chip-long, hk-chip-switcher, hk-chip-search, hk-chip-menu, hk-chip-alert, hk-chip-alert-switcher, hk-chip-toast, hk-pal, hk-model, hk-slot-empty. Keys: Ctrl+P, Ctrl+1-9, Ctrl+M.',
},
ko: {
  chipLabel: '프리셋: {name} · {model}', chipChanged: '프리셋: {name} · {model} · 방금 ‘{from}’에서 바꿨어요', chipAlert: '{label} · 저장 실패', chipMenu: '프리셋 옵션',
  menuManage: '프리셋 관리', menuOpen: '모델·프리셋 설정 열기',
  swTitle: '프리셋 바꾸기', swSearch: '프리셋 검색', swRecent: '최근', swFav: '즐겨찾기', swAll: '모든 프리셋', swManage: '프리셋 관리', swCount: '프리셋 {n}개', swNone: '‘{q}’에 맞는 프리셋이 없어요', swInUse: '사용 중',
  switched: '프리셋을 바꿨어요 · ‘{name}’', switchedBack: '프리셋을 되돌렸어요 · ‘{name}’', undo: '실행 취소', slotEmpty: '{key}에 지정된 프리셋이 없어요', assign: '지정하기',
  alertNote: '프리셋을 저장하지 못했어요', retry: '저장 다시 시도', discard: '변경 취소', alertRetried: '저장했어요', alertDiscarded: '변경을 취소했어요', alertA11y: '프리셋을 저장하지 못했어요',
  mdTitle: '모델 고르기', mdSearch: '모델 검색', mdSet: '모델을 바꿨어요 · ‘{model}’', mdBack: '모델을 되돌렸어요 · ‘{model}’', mdCount: '모델 {n}개',
  dTitle: '채팅 훅 데모', dChip: '프리셋 칩', dOpenSw: '프리셋 바꾸기 열기', dOpenMenu: '칩 메뉴 열기', dOpenMd: '모델 고르기 열기 (Ctrl+M)', dAlert: '프리셋 저장 실패 보이기', dLongChar: '긴 캐릭터 이름', dLongPreset: '긴 프리셋 이름',
  dFail: '답변 실패 (DS-043)', dFailKey: '키', dFailModel: '모델', dFailQuota: '사용량 한도', dFailNetwork: '네트워크', dFailServer: '서버', dFailRegen: '새 답변이 실패', dFailNext: '다음 시도도 실패',
  guardTitle: '프리셋을 바꾸기 전에', guardBody: '프리셋을 저장하지 못했어요. 어떻게 할까요?',
  dStates: '상태: ?state=hk-fail-key|model|quota|network|server|regen|return, hk-chip, hk-chip-long, hk-chip-switcher, hk-chip-search, hk-chip-menu, hk-chip-alert, hk-chip-alert-switcher, hk-chip-toast, hk-pal, hk-model, hk-slot-empty. 키: Ctrl+P, Ctrl+1~9, Ctrl+M.',
},
};
const tt = (k, v) => { let s = (HKI[S.lang] && HKI[S.lang][k]); if (s === undefined) s = HKI.en[k]; if (s === undefined) return k; if (v) for (const x in v) s = s.replaceAll('{' + x + '}', v[x]); return S.lang === 'ko' ? X.josa(s) : s; };

/* ------------------------------------------------------------------ synthetic presets and models (user data: names stay as typed) */
const PRESETS = [
  { id: 'p-bal', name: '균형', model: 'Sonnet 4.5', folder: '기본', fav: true, slot: 1 },
  { id: 'p-rp', name: '롤플레이 긴 답변', model: 'Opus 4.1', folder: '롤플레이', fav: true, slot: 2 },
  { id: 'p-tr', name: '번역용', model: 'Haiku 4.5', folder: '도구', slot: 3 },
  { id: 'p-fast', name: '빠른 응답', model: 'Gemini 2.5 Flash', folder: '기본' },
  { id: 'p-novel', name: '장문 소설 모드', model: 'GPT-5 mini', folder: '롤플레이', fav: true, slot: 4 },
  { id: 'p-en', name: 'Casual chat', model: 'Sonnet 4.5', folder: '기본' },
  { id: 'p-long', name: '아주 길고 길어서 한 줄에 다 들어가지 않는 프리셋 이름입니다 (실험)', model: 'Claude Sonnet 4.5 (확장 사고 · 긴 모델 이름)', folder: '실험' },
];
const MODELS = ['Sonnet 4.5', 'Opus 4.1', 'Haiku 4.5', 'Gemini 2.5 Flash', 'GPT-5 mini', 'Claude Sonnet 4.5 (확장 사고 · 긴 모델 이름)'];
const H = { active: 'p-bal', recent: ['p-tr', 'p-rp'], alert: false, change: null, charName: '', toast: null, count: 0 };
const byId = (id) => PRESETS.find((p) => p.id === id);
const cur = () => byId(H.active);
const SET = '../settings/slice2.html';
const settingsUrl = (view) => `${SET}?page=models&section=models.presets${view ? '&view=' + view : ''}&from=chat`;

const EXTRA_ICONS = {
  'library-big': '<rect width="8" height="18" x="3" y="3" rx="1"/><path d="M7 3v18"/><path d="M20.4 18.9c.2.5-.1 1.1-.6 1.3l-1.9.7c-.5.2-1.1-.1-1.3-.6L11.1 5.1c-.2-.5.1-1.1.6-1.3l1.9-.7c.5-.2 1.1.1 1.3.6Z"/>',
  'settings': '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  'search': '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  'star': '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>',
};

/* ------------------------------------------------------------------ the chip */
let chip = null;
const label = () => { const p = cur(); const base = tt('chipLabel', { name: p.name, model: p.model }); return H.change ? tt('chipChanged', { name: p.name, model: p.model, from: H.change.from }) + (H.alert ? ' · ' + tt('alertA11y') : '') : (H.alert ? tt('chipAlert', { label: base }) : base); };
function paintChip() {
  if (!chip) return; const p = cur(); const lb = label();
  $('.hk-ic', chip).innerHTML = X.ic(H.alert ? 'triangle-alert' : 'bookmark', 18); $('.hk-pn', chip).textContent = p.name; $('.hk-md', chip).textContent = p.model;
  chip.setAttribute('aria-label', lb); chip.title = lb; chip.classList.toggle('alert', H.alert); chip.dataset.alert = H.alert ? '1' : '0';
  layoutChip();
}
// characters of a truncated text that are really readable: the ellipsis takes about one em of the width
const visChars = (el, len) => (el.scrollWidth > el.clientWidth + 1 ? Math.max(0, Math.floor(len * Math.max(0, el.clientWidth - (parseFloat(getComputedStyle(el).fontSize) || 13)) / el.scrollWidth)) : len);
const chars = (s) => [...s].length;
// SLICE2_SPEC section 6 + R-10: >= 480 icon, name, model (<= 40 % of the header; the model drops first, then the name truncates); 400-479 icon and name (<= 30 %; icon only if fewer than 6 characters of the name fit);
// < 400, or when the character name would truncate below 8 characters: icon only. The character name keeps priority.
function layoutChip() {
  const row = $('#hdr .hdr-row'); if (!chip || !row) return; const W = row.clientWidth; if (!W) return;
  const tier = W >= 480 ? 'full' : W >= 400 ? 'name' : 'icon'; const order = tier === 'full' ? ['full', 'name', 'icon'] : tier === 'name' ? ['name', 'icon'] : ['icon'];
  const pct = tier === 'full' ? 0.4 : 0.3; const maxW = Math.floor(pct * W); const nm = $('#hdrName'); const p = cur();
  let chosen = 'icon'; const why = [];
  for (const mode of order) {
    chip.dataset.mode = mode;
    if (mode === 'icon') { chip.style.maxWidth = ''; chosen = 'icon'; break; }
    chip.style.maxWidth = 'none'; const nat = chip.offsetWidth; chip.style.maxWidth = maxW + 'px';
    if (mode === 'full' && nat > maxW) { why.push('model'); continue; }                                          // the model drops first
    if (tier === 'name' && visChars($('.hk-pn', chip), chars(p.name)) < Math.min(6, chars(p.name))) { why.push('name<6'); continue; }
    const len = chars(nm.textContent); const v = visChars(nm, len);
    if (nm.scrollWidth > nm.clientWidth + 1 && v < 8) { why.push('char<8'); continue; }                           // the character name keeps priority
    chosen = mode; break;
  }
  chip.dataset.mode = chosen; chip.dataset.tier = tier; chip.dataset.why = why.join(',');
}

/* ------------------------------------------------------------------ the switcher (stand-in) and the model picker (stand-in) */
let SW = null;                                                            // { kind, items, q, hi, onPick }
const opts = () => ($$('.hk-opt', $('#hkList')) || []);
function listModel(kind, q) {
  const needle = q.trim().toLowerCase();
  if (kind === 'model') return [{ title: '', items: MODELS.filter((m) => !needle || m.toLowerCase().includes(needle)).map((m) => ({ id: m, name: m, sub: '', active: cur().model === m })) }];
  const all = PRESETS.map((p) => ({ id: p.id, name: p.name, sub: p.model, slot: p.slot, fav: p.fav, active: p.id === H.active, folder: p.folder }));
  if (needle) return [{ title: '', items: all.filter((x) => (x.name + ' ' + x.sub + ' ' + x.folder).toLowerCase().includes(needle)) }];
  const seen = new Set(); const take = (arr) => arr.filter((x) => !seen.has(x.id) && seen.add(x.id));
  const recent = take(H.recent.map((id) => all.find((x) => x.id === id)).filter((x) => x && !x.active)); const favs = take(all.filter((x) => x.fav)); const rest = take(all);
  return [{ title: tt('swRecent'), items: recent }, { title: '★ ' + tt('swFav'), items: favs }, { title: tt('swAll'), items: rest }].filter((g) => g.items.length);
}
function renderList() {
  const box = $('#hkList'); if (!box || !SW) return; const groups = listModel(SW.kind, SW.q); const n = groups.reduce((a, g) => a + g.items.length, 0);
  box.replaceChildren(); let k = 0;
  groups.forEach((g, gi) => {
    const wrap = document.createElement('div'); wrap.className = 'hk-grp'; wrap.setAttribute('role', 'group'); if (g.title) wrap.setAttribute('aria-labelledby', 'hkg' + gi);
    if (g.title) { const h = document.createElement('div'); h.className = 'hk-gh'; h.id = 'hkg' + gi; h.textContent = g.title; wrap.appendChild(h); }
    g.items.forEach((it) => {
      const o = document.createElement('div'); o.className = 'hk-opt'; o.id = 'hko-' + gi + '-' + (k++); o.dataset.id = it.id; o.setAttribute('role', 'option'); o.setAttribute('aria-selected', 'false'); if (it.active) o.setAttribute('aria-current', 'true');
      o.innerHTML = `<span class="hk-on"><span class="hk-nm"></span>${it.sub ? '<span class="hk-sub"></span>' : ''}</span>${it.slot ? `<span class="hk-slot" aria-hidden="true">Ctrl+${it.slot}</span>` : ''}<span class="hk-ck" aria-hidden="true">${it.active ? X.ic('check', 18) : ''}</span>`;
      $('.hk-nm', o).textContent = it.name; if (it.sub) $('.hk-sub', o).textContent = it.sub; o.title = it.name + (it.sub ? ' · ' + it.sub : '');
      o.setAttribute('aria-label', it.name + (it.sub ? ', ' + it.sub : '') + (it.slot ? ', Ctrl+' + it.slot : '') + (it.active ? ', ' + tt('swInUse') : ''));
      o.addEventListener('click', () => pick(it.id)); o.addEventListener('pointermove', () => setHi(o));
      wrap.appendChild(o);
    });
    box.appendChild(wrap);
  });
  if (!n) { const e = document.createElement('div'); e.className = 'hk-none'; e.textContent = tt('swNone', { q: SW.q }); box.appendChild(e); }
  const os = opts(); const a = os.find((o) => o.getAttribute('aria-current') === 'true') || os[0]; setHi(SW.q ? os[0] : a, true);
  const cnt = $('#hkCount'); if (cnt) cnt.textContent = n ? tt(SW.kind === 'model' ? 'mdCount' : 'swCount', { n }) : tt('swNone', { q: SW.q });
}
function setHi(o, noScroll) {
  const inp = $('#hkSearch'); opts().forEach((x) => { x.classList.toggle('kb', x === o); x.setAttribute('aria-selected', String(x === o)); }); if (!inp) return;
  if (o) { inp.setAttribute('aria-activedescendant', o.id); if (!noScroll) o.scrollIntoView({ block: 'nearest' }); } else inp.removeAttribute('aria-activedescendant');
}
function pick(id) { const f = SW && SW.onPick; if (f) f(id); }
function openList({ kind, from, q = '' }) {
  const wide = S.desktop; const pal = wide && from === 'key'; const isModel = kind === 'model';
  const cls = pal ? 'panel hk-pal' : wide ? 'hk-pop' : 's2tall hk-sheet';
  SW = { kind, q, from, onPick: isModel ? chooseModel : choosePreset };
  X.openSheet({ title: tt(isModel ? 'mdTitle' : 'swTitle'), opener: from === 'key' ? (document.activeElement || chip) : chip, cls, width: pal ? 560 : 380, build(body) {
    body.className = 'sheet-body hk-body';
    const alertRow = !isModel && H.alert ? `<div class="hk-alertrow" role="group" aria-label="${esc(tt('alertNote'))}"><span class="hk-at"><span class="hk-ai">${X.ic('triangle-alert', 18)}</span><span>${esc(tt('alertNote'))}</span></span><button type="button" class="btn hk-ab" data-a="retry">${X.ic('rotate-ccw', 18)}<span>${esc(tt('retry'))}</span></button><button type="button" class="btn hk-ab" data-a="discard">${X.ic('undo-2', 18)}<span>${esc(tt('discard'))}</span></button></div>` : '';
    body.innerHTML = `${alertRow}<div class="hk-search"><span class="hk-si" aria-hidden="true">${X.ic('search', 18)}</span><input id="hkSearch" type="search" role="combobox" aria-expanded="true" aria-controls="hkList" aria-autocomplete="list" autocomplete="off" spellcheck="false" placeholder="${esc(tt(isModel ? 'mdSearch' : 'swSearch'))}" aria-label="${esc(tt(isModel ? 'mdSearch' : 'swSearch'))}" data-autofocus></div><div id="hkList" class="hk-list" role="listbox" aria-label="${esc(tt(isModel ? 'mdTitle' : 'swTitle'))}"></div><div id="hkCount" class="sr-only" role="status" aria-live="polite"></div>` +
      (isModel ? '' : `<div class="hk-foot"><button type="button" class="btn item hk-manage" data-href="${esc(settingsUrl('library'))}">${X.ic('library-big', 20)}<span>${esc(tt('swManage'))}</span></button></div>`);
    const inp = $('#hkSearch', body); inp.value = q;
    inp.addEventListener('input', () => { SW.q = inp.value; renderList(); });
    inp.addEventListener('keydown', (e) => {
      if (e.isComposing || e.keyCode === 229) return; const os = opts(); const i = os.findIndex((o) => o.classList.contains('kb'));
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (os.length) setHi(os[(i + (e.key === 'ArrowDown' ? 1 : -1) + os.length) % os.length]); }
      else if (e.key === 'Home' || e.key === 'End') { if (os.length) { e.preventDefault(); setHi(e.key === 'Home' ? os[0] : os[os.length - 1]); } }
      else if (e.key === 'Enter') { e.preventDefault(); if (os[i]) pick(os[i].dataset.id); }
    });
    $$('.hk-ab', body).forEach((b) => b.addEventListener('click', () => { if (b.dataset.a === 'retry') setAlert(false, 'retry'); else setAlert(false, 'discard'); $('.hk-alertrow', body)?.remove(); inp.focus(); }));
    const mg = $('.hk-manage', body); if (mg) mg.addEventListener('click', () => { location.href = mg.dataset.href; });
    renderList();
  } });
  chip.setAttribute('aria-expanded', 'true');
}
function choosePreset(id) {
  const p = byId(id); if (!p) return;
  if (p.id === H.active) { X.closeSheet(true); return; }
  if (H.alert) { askGuard(() => applyPreset(p.id, cur())); return; }
  X.closeSheet(true); applyPreset(p.id, cur());
}
// DS-026 / R-07, DD-134: before any switch from any entry point (switcher, Ctrl+1-9) a failed save asks 다시 시도 / 변경 취소 / 취소. Retry or undo clears the alert, then the switch goes ahead; cancel changes nothing. The alert is never moved to the new preset.
function askGuard(next) {
  const done = (how) => { X.closeSheet(true); if (how) { setAlert(false, how); next(); } };
  const build = (body) => {
    body.className = 'sheet-body'; body.replaceChildren();
    const p = document.createElement('p'); p.className = 'confirm-text'; p.textContent = tt('guardBody'); body.appendChild(p);
    const row = document.createElement('div'); row.className = 'hk-guard'; row.setAttribute('data-part', 'chat-save-guard'); row.setAttribute('data-part-critical', '');
    const a = X.item('rotate-ccw', tt('retry'), () => done('retry'), '', { 'data-autofocus': '', 'data-g': 'retry' }); const b = X.item('undo-2', tt('discard'), () => done('discard'), '', { 'data-g': 'discard', 'data-drops-data': '' }); const c = X.item('x', S.lang === 'ko' ? '취소' : 'Cancel', () => done(''), '', { 'data-g': 'cancel' });
    [a, b, c].forEach((x) => row.appendChild(x)); body.appendChild(row);
  };
  if (X.Sh.open) X.swapSheet(tt('guardTitle'), build); else X.openSheet({ title: tt('guardTitle'), opener: document.activeElement || chip, build });
}
const switchTo = (id) => { if (id === H.active) return; if (H.alert) askGuard(() => applyPreset(id, cur())); else applyPreset(id, cur()); };
function applyPreset(toId, from) {                                          // switch from anywhere (chip switcher, Ctrl+1-9); the toast undoes it
  const to = byId(toId); const prev = from || cur(); H.active = to.id; H.recent = [prev.id, ...H.recent.filter((x) => x !== prev.id && x !== to.id)].slice(0, 5);
  const t = X.actionToast({ text: tt('switched', { name: to.name }), ms: 10000, actions: [{ label: tt('undo'), icon: 'undo-2', undo: true, run: () => { if (H.active !== to.id) return; H.active = prev.id; H.change = null; paintChip(); if (SW && $('#hkList')) renderList(); X.announce(tt('switchedBack', { name: prev.name })); } }], onClose: () => { H.change = null; paintChip(); } });
  H.toast = t; H.change = { from: prev.name, to: to.name }; paintChip(); H.count++;
}
function chooseModel(m) {
  X.closeSheet(true); const p = cur(); if (p.model === m) return; const old = p.model; p.model = m;
  X.actionToast({ text: tt('mdSet', { model: m }), ms: 10000, actions: [{ label: tt('undo'), icon: 'undo-2', undo: true, run: () => { if (p.model !== m) return; p.model = old; paintChip(); if (SW && $('#hkList')) renderList(); X.announce(tt('mdBack', { model: old })); } }] });
  paintChip();
}
function setAlert(on, how) {
  const was = H.alert; H.alert = !!on; paintChip();
  if (on && !was) X.announce(tt('alertA11y') + ': ' + label());
  if (!on && was && how) X.announce(tt(how === 'retry' ? 'alertRetried' : 'alertDiscarded'));
}

/* ------------------------------------------------------------------ the chip menu (long-press, right-click, Shift+F10 / the menu key) */
function openChipMenu(anchor) {
  if (X.Sh.open) return;
  X.openSheet({ title: tt('chipMenu'), opener: chip, anchor, menu: true, build(body) {
    const add = (icon, text, view, n) => { const b = X.item(icon, text, () => { location.href = settingsUrl(view); }, '', { role: 'menuitem', 'data-href': settingsUrl(view) }); b.tabIndex = n === 0 ? 0 : -1; if (n === 0) b.setAttribute('data-autofocus', ''); body.appendChild(b); };
    add('library-big', tt('menuManage'), 'library', 0); add('settings', tt('menuOpen'), '', 1);
  } });
  chip.setAttribute('aria-expanded', 'true');
}
function wireChip() {
  let lp = 0, lpFired = false, lastTouch = -1e9;
  chip.addEventListener('click', (e) => { if (lpFired) { lpFired = false; e.preventDefault(); return; } if (X.Sh.open) return; openList({ kind: 'preset', from: 'chip' }); });
  chip.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return; lastTouch = X.now(); lpFired = false; const x0 = e.clientX, y0 = e.clientY;
    clearTimeout(lp); lp = setTimeout(() => {
      lpFired = true; setTimeout(() => (lpFired = false), 700); openChipMenu(null);
      // the lift that ends the long press must neither close the menu nor take focus out of it: slice 1's tap guards (350 ms items, 600 ms backdrop) restart from the lift
      addEventListener('pointerup', () => { X.Sh.at = X.now(); setTimeout(() => { if (X.Sh.open && X.Sh.kind === 'menu' && document.activeElement === document.body) { const f = $('.sheet-body [role=menuitem]'); if (f) f.focus({ preventScroll: true }); } }, 40); }, { once: true });
    }, 500);
    const cancel = (ev) => { if (ev.type === 'pointermove' && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 10) return; clearTimeout(lp); removeEventListener('pointermove', cancel); removeEventListener('pointerup', cancel); removeEventListener('pointercancel', cancel); };
    addEventListener('pointermove', cancel); addEventListener('pointerup', cancel); addEventListener('pointercancel', cancel);
  });
  chip.addEventListener('contextmenu', (e) => { e.preventDefault(); if (X.now() - lastTouch < 900) return; openChipMenu(e.clientX === 0 && e.clientY === 0 ? null : { x: e.clientX, y: e.clientY }); });
  chip.addEventListener('keydown', (e) => { if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); openChipMenu(null); } });
}
document.addEventListener('chat:sheetclosed', () => { if (chip) chip.setAttribute('aria-expanded', 'false'); SW = null; });

/* ------------------------------------------------------------------ keys: Ctrl+P (switcher), Ctrl+1-9 (slots), Ctrl+M (model picker). DS-023: they work in text fields, except during IME composition and in inline rename inputs. */
function keys(e) {
  if (!X || !chip || e.defaultPrevented) return;
  const composing = e.isComposing || e.keyCode === 229 || (X.IME && X.IME.composing);
  const t = e.target; if (t && t.matches && t.matches('.s2-rename, .s2-tbinput, [data-rename]')) return;
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
  const code = e.code || '';
  // the letter: a Latin e.key wins (Dvorak, AZERTY); on a Hangul layout e.key is a jamo, so the physical key (KeyP / KeyM) decides (DS-036: by code)
  const k = /^[a-z]$/i.test(e.key) ? e.key.toLowerCase() : code === 'KeyP' ? 'p' : code === 'KeyM' ? 'm' : '';
  const slot = /^Digit([1-9])$/.test(code) ? Number(code.slice(5)) : /^[1-9]$/.test(e.key) ? Number(e.key) : 0;
  if (k !== 'p' && k !== 'm' && !slot) return;
  if (composing) { if (k === 'p' || k === 'm') e.preventDefault(); return; }      // DD-140: nothing opens mid-composition, but a browser build must not print / mute; the digit chords and typing are untouched
  const mine = X.Sh.open && SW;
  if ((S2H && Y.S2 && Y.S2.home) || (X.Sh.open && !mine) || (k === 'p' && !S.desktop && S.sbOpen)) { e.preventDefault(); return; }   // not now, but the browser's print / mute / tab switch must not happen either
  e.preventDefault(); e.stopPropagation();
  if (k === 'p') { if (mine) { X.closeSheet(true); return; } openList({ kind: 'preset', from: 'key' }); return; }
  if (k === 'm') { if (mine) X.closeSheet(true); openList({ kind: 'model', from: 'key' }); return; }
  const p = PRESETS.find((x) => x.slot === slot);
  if (mine) X.closeSheet(true);
  if (!p) { X.actionToast({ text: tt('slotEmpty', { key: 'Ctrl+' + slot }), ms: 10000, actions: [{ label: tt('assign'), icon: 'sliders', href: settingsUrl('library') }] }); return; }
  switchTo(p.id);
}

/* ------------------------------------------------------------------ demo controls (the failed-reply card has its own in slice1.js: window.__chat.demoFail) */
function setCharName(s) { H.charName = s || ''; const n = $('#hdrName'); if (!n) return; if (H.charName) n.textContent = H.charName; else if (Y.curChat && Y.curChat()) { /* restored by the next header update */ const ch = Y.CHARS.find((c) => c.id === Y.curChat().charId); n.textContent = ch ? (ch.name[S.lang] || ch.name.en) : n.textContent; } layoutChip(); }
function renderDemo() {
  const el = $('#hkDemo'); if (!el) return; $('#hkCtlSum').textContent = tt('dTitle');
  const btn = (id, ic, lb) => `<button type="button" class="btn act" id="${id}">${X.ic(ic, 18)}<span>${esc(lb)}</span></button>`;
  const sw = (id, lb, on) => `<label class="sw"><input type="checkbox" role="switch" id="${id}" ${on ? 'checked' : ''}><span class="sw-ui"></span><span class="lbl">${esc(lb)}</span></label>`;
  el.innerHTML = `<h2 class="s2-dh">${esc(tt('dChip'))}</h2>` + btn('hkdSw', 'bookmark', tt('dOpenSw')) + btn('hkdMenu', 'ellipsis-vertical', tt('dOpenMenu')) + btn('hkdMd', 'sliders', tt('dOpenMd')) +
    sw('hkdAlert', tt('dAlert'), H.alert) + sw('hkdLongC', tt('dLongChar'), !!H.charName) + sw('hkdLongP', tt('dLongPreset'), H.active === 'p-long') +
    `<h2 class="s2-dh">${esc(tt('dFail'))}</h2>` + ['key', 'model', 'quota', 'network', 'server'].map((r) => btn('hkdF-' + r, 'circle-alert', tt('dFail' + r[0].toUpperCase() + r.slice(1)))).join('') + btn('hkdF-regen', 'rotate-ccw', tt('dFailRegen')) +
    sw('hkdNext', tt('dFailNext'), false) + `<p class="banner">${esc(tt('dStates'))}</p>`;
  const run = (fn) => { if (!S.desktop && S.sbOpen) { X.closeSidebar(); setTimeout(fn, X.durOf('base') + 80); } else fn(); };
  $('#hkdSw').onclick = () => run(() => { if (!X.Sh.open) openList({ kind: 'preset', from: 'chip' }); });
  $('#hkdMenu').onclick = () => run(() => openChipMenu(null)); $('#hkdMd').onclick = () => run(() => { if (!X.Sh.open) openList({ kind: 'model', from: 'key' }); });
  $('#hkdAlert').onchange = (e) => setAlert(e.target.checked, e.target.checked ? '' : 'retry');
  $('#hkdLongC').onchange = (e) => setCharName(e.target.checked ? '아주 긴 이름의 캐릭터 세라핀 다이애나' : '');
  $('#hkdLongP').onchange = (e) => { const was = cur(); H.active = e.target.checked ? 'p-long' : 'p-bal'; H.recent = [was.id, ...H.recent.filter((x) => x !== was.id)].slice(0, 5); paintChip(); };
  ['key', 'model', 'quota', 'network', 'server'].forEach((r) => { $('#hkdF-' + r).onclick = () => run(() => window.__chat.demoFail(r, { after: 700 })); });
  $('#hkdF-regen').onclick = () => run(() => window.__chat.demoFail('model', { after: 700, regen: true }));
  $('#hkdNext').onchange = (e) => { window.__chat.failNext(e.target.checked ? window.__chat.DEMO_FAIL.key : null, 700); };
}

/* ------------------------------------------------------------------ ?state= */
async function runState(s) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  switch (s) {
    case 'hk-chip': break;
    case 'hk-chip-long': setCharName('아주 긴 이름의 캐릭터 세라핀 다이애나'); H.active = 'p-long'; paintChip(); break;
    case 'hk-chip-switcher': openList({ kind: 'preset', from: 'chip' }); break;
    case 'hk-chip-search': openList({ kind: 'preset', from: 'chip', q: Q.get('q') || (S.lang === 'ko' ? '롤' : 'casual') }); break;
    case 'hk-chip-menu': openChipMenu(null); break;
    case 'hk-chip-alert': setAlert(true); break;
    case 'hk-chip-alert-switcher': setAlert(true); await wait(30); openList({ kind: 'preset', from: 'chip' }); break;
    case 'hk-chip-toast': applyPreset('p-rp', cur()); break;
    case 'hk-pal': openList({ kind: 'preset', from: 'key' }); break;
    case 'hk-model': openList({ kind: 'model', from: 'key' }); break;
    case 'hk-slot-empty': document.dispatchEvent(new KeyboardEvent('keydown', { key: '5', code: 'Digit5', ctrlKey: true, bubbles: true, cancelable: true })); break;
    default: break;
  }
}

/* ------------------------------------------------------------------ init */
function init() {
  X = window.__slice1; S = X.S; Y = window.__slice2; S2H = Y.S2H;
  for (const k in EXTRA_ICONS) if (!X.ICONS[k]) X.ICONS[k] = EXTRA_ICONS[k];        // only the icons the shared set does not have yet
  const row = $('#hdr .hdr-row'); chip = document.createElement('button'); chip.type = 'button'; chip.id = 'hkChip'; chip.className = 'btn hk-chip'; chip.setAttribute('data-part', 'chat-preset-chip'); chip.setAttribute('aria-haspopup', 'dialog'); chip.setAttribute('aria-expanded', 'false'); chip.setAttribute('aria-keyshortcuts', 'Control+P');
  chip.innerHTML = '<span class="hk-in"><span class="hk-ic"></span><span class="hk-pn"></span><span class="hk-md-w" aria-hidden="true"><span class="hk-sep">·</span><span class="hk-md"></span></span></span>';
  row.insertBefore(chip, $('#moreBtn')); wireChip(); paintChip(); renderDemo();
  const prevCh = S2H.chatChanged; S2H.chatChanged = (c, ch) => { if (prevCh) prevCh(c, ch); if (H.charName) $('#hdrName').textContent = H.charName; layoutChip(); };   // HOOKS1_SPEC C-4 is used here too
  const prevLang = S.hooks.lang; S.hooks.lang = () => { if (prevLang) prevLang(); renderDemo(); paintChip(); };
  new ResizeObserver(() => layoutChip()).observe(row); addEventListener('resize', layoutChip);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(layoutChip);
  addEventListener('keydown', keys, true); addEventListener('blur', () => { if (X.IME) X.IME.composing = false; }, true);
  document.title = 'Chat hooks batch 1 · ' + (S.lang === 'ko' ? '목업' : 'mockup');
  window.__hk1 = { H, PRESETS, MODELS, layoutChip, paintChip, openList, openChipMenu, setAlert, setCharName, applyPreset, choosePreset, chooseModel, byId, cur, tt, label, settingsUrl, chip: () => chip, SW: () => SW };
  const st = Q.get('state'); const q = Q.get('active'); if (q && byId(q)) { H.active = q; paintChip(); } if (Q.get('char') === 'long') setCharName('아주 긴 이름의 캐릭터 세라핀 다이애나');
  setTimeout(async () => { if (st && /^hk-(chip|pal|model|slot)/.test(st)) { try { await runState(st); } catch (e) { console.error(e); } } setTimeout(() => { window.__hk1Ready = true; }, 300); }, 260);
}
(function wait() { if (window.__slice1 && window.__chat && window.__slice2 && window.__slice2.S2 && window.__slice2.CHARS) init(); else setTimeout(wait, 20); })();
})();
