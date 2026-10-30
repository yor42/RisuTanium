/* Chat toggles panel mockup. Synthetic mockup; not proof of native behaviour or performance.
   Loads after slice1.js and slice2.js and extends them through their extension points (S.hooks.plus / S.hooks.lang, window.__s2hooks.back / togglesGroup / access / thisChatBuilt / chatChanged,
   the chat:sheetclosed event, pushBack / popBack, window.__slice1 / window.__slice2 exports). Rev 3 + HOOKS1_SPEC C: the DOM observation, the capture-phase listener and the key interception of rev 3 are gone;
   one DOM regrouping remains (the jailbreak and memory rows move into the "이 채팅" group, DD-086; see HOOKS1_SPEC C-9).
   Implements docs/design/chat/TOGGLES_SPEC.md (draft rev 1, DD-077..DD-080). All data is synthetic; values live in memory only (simulated persistence). */
(() => {
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const Q = new URLSearchParams(location.search);
let X, S, Y, S2, S2H;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* ------------------------------------------------------------------ copy: SPEC section 9 keys first, then mockup-only keys (marked "extra") */
const TGI = {
en: {
  togglesTitle: 'Toggles', togglesSummary: '{n} toggles · {on} on', togglesScopeNoteOn: 'Copied from current values; changes apply only to this chat', togglesScopeNoteOff: 'Applies to every chat',
  togglesSearch: 'Search toggles', togglesChangedOnly: 'On only', togglesFavorites: 'Favourites', togglesSourcePrompt: 'Prompt', togglesSourceCharacter: 'Character', togglesSectionCount: '{n} toggles · {on} on',
  togglesChangedA11y: 'on', togglesChatValue: 'This chat', togglesRevertShared: 'Use the all-chats value', togglesReset: 'Turn off', tgResetSelect: 'Use the first option', tgResetText: 'Clear', tgDupMismatch: 'Same key, different kind: {source}', tgHint: 'Shift+F10 on a row opens favourites and more; Right Arrow reaches its ⋯ button.', tgList: 'Toggle list', tgPillGo: 'Set for this chat only, go to the switch', togglesStar: 'Add to favourites', togglesUnstar: 'Remove from favourites',
  togglesMoveUp: 'Move up', togglesMoveDown: 'Move down', togglesSameValue: 'Same value: {source}', togglesMore: 'More', togglesNone: 'No toggles', togglesNoneHelp: 'Prompts and modules can add toggles.',
  togglesNoMatch: 'No matching toggles', togglesClearSearch: 'Clear search', togglesFilterOff: 'Turn off filter', togglesOnA11y: '{label} on', togglesOffA11y: '{label} off',
  /* extra */
  tgClose: 'Close', tgMenu: 'Options for {label}', tgResults: '{shown} shown · {n} in total', tgOption: 'Option: {opt}', tgSave: 'Save', tgEmpty: '(empty)', tgFavRegion: 'Favourite toggles',
  tgSavedAll: 'Saved for all chats', tgSavedChat: 'Saved for this chat', tgTextSaved: '{label} saved', tgPicked: '{label}: {value}', tgStarred: '{label} added to favourites', tgUnstarred: '{label} removed from favourites',
  tgMovedTo: '{label}: favourite {n} of {total}', tgResetDone: '{label} reset (off / first option / empty)', tgRevertDone: '{label}: using the all-chats value', tgNone: 'None', tgOff: 'off', tgPickTitle: 'Choose {label}',
  tgChipsHead: 'Favourite toggles', tgEditTitle: 'Edit {label}', tgSearchLabel: 'Search toggles', tgChangedState: 'Show only toggles that are on', tgScopeSwitch: 'Set separately for this chat', tgCountLive: '{shown} toggles shown',
  tgPlusValue: '{n} toggles · {on} on', tgBreadcrumb: 'Location', tgLocalTag: 'Set only for this chat',
  dTitle: 'Toggles demo controls', dOpen: 'Open the toggles panel', dSet: 'Toggle set', dSet40: '40 toggles', dSet100: '100 (stress)', dSetNone: 'None', dScope: 'This chat only', dFav4: 'Star 4 toggles', dFav10: 'Star 10 toggles', dFavClear: 'Clear favourites',
  dExpand: 'Expand all sections', dCollapse: 'Collapse all sections', dPlus: 'Open the + menu', dReset: 'Reset', dSheet: 'Open the This chat sheet', dStates: 'States: add ?state=tg-panel, tg-collapsed, tg-expanded, tg-group, tg-select, tg-text, tg-textarea, tg-scope-on, tg-scope-revert, tg-scope-undo, tg-search-label|option|chosung|key|crumb|expand, tg-changed, tg-both, tg-nomatch, tg-favs, tg-fav-menu, tg-chips, tg-dup, tg-stress, tg-empty, tg-sheet.',
},
ko: {
  togglesTitle: '토글', togglesSummary: '{n}개 · {on}개 켜짐', togglesScopeNoteOn: '켜면 지금 값이 복사되고, 이 채팅에서만 바뀌어요', togglesScopeNoteOff: '모든 채팅에 적용돼요',
  togglesSearch: '토글 검색', togglesChangedOnly: '켜진 것만', togglesFavorites: '즐겨찾기', togglesSourcePrompt: '프롬프트', togglesSourceCharacter: '캐릭터', togglesSectionCount: '{n}개 · {on}개 켜짐',
  togglesChangedA11y: '켜짐', togglesChatValue: '이 채팅', togglesRevertShared: '모든 채팅 값으로 되돌리기', togglesReset: '끄기', tgResetSelect: '첫 번째 값으로', tgResetText: '비우기', tgDupMismatch: '같은 키, 종류가 달라요: {source}', tgHint: '행에서 Shift+F10을 누르면 즐겨찾기 같은 옵션이 나와요. 오른쪽 화살표로 ⋯ 버튼에 갈 수 있어요.', tgList: '토글 목록', tgPillGo: '이 채팅만 설정 중, 스위치로 이동', togglesStar: '즐겨찾기 추가', togglesUnstar: '즐겨찾기 해제',
  togglesMoveUp: '위로', togglesMoveDown: '아래로', togglesSameValue: '같은 값: {source}', togglesMore: '더 보기', togglesNone: '토글이 없어요', togglesNoneHelp: '프롬프트나 모듈이 토글을 추가할 수 있어요.',
  togglesNoMatch: '찾는 토글이 없어요', togglesClearSearch: '검색 지우기', togglesFilterOff: '필터 끄기', togglesOnA11y: '{label} 켜짐', togglesOffA11y: '{label} 꺼짐',
  tgClose: '닫기', tgMenu: '{label} 옵션', tgResults: '{shown}개 표시 · 전체 {n}개', tgOption: '옵션: {opt}', tgSave: '저장', tgEmpty: '(비어 있음)', tgFavRegion: '즐겨찾기 토글',
  tgSavedAll: '모든 채팅에 저장됨', tgSavedChat: '이 채팅에 저장됨', tgTextSaved: '{label} 저장됨', tgPicked: '{label}: {value}', tgStarred: '{label}(을)를 즐겨찾기에 추가했어요', tgUnstarred: '{label}(을)를 즐겨찾기에서 뺐어요',
  tgMovedTo: '{label}: 즐겨찾기 {total}개 중 {n}번째', tgResetDone: '{label}(을)를 처음 값으로 되돌렸어요', tgRevertDone: '{label}: 모든 채팅 값을 써요', tgNone: '없음', tgOff: '꺼짐', tgPickTitle: '{label} 고르기',
  tgChipsHead: '즐겨찾기 토글', tgEditTitle: '{label} 고치기', tgSearchLabel: '토글 검색', tgChangedState: '켜진 토글만 보기', tgScopeSwitch: '이 채팅만 따로 설정', tgCountLive: '토글 {shown}개 표시',
  tgPlusValue: '{n}개 · {on}개 켜짐', tgBreadcrumb: '위치', tgLocalTag: '이 채팅에만 설정됨',
  dTitle: '토글 데모 컨트롤', dOpen: '토글 패널 열기', dSet: '토글 세트', dSet40: '토글 40개', dSet100: '100개(부하)', dSetNone: '없음', dScope: '이 채팅만 따로 설정', dFav4: '토글 4개 즐겨찾기', dFav10: '토글 10개 즐겨찾기', dFavClear: '즐겨찾기 비우기',
  dExpand: '섹션 모두 펼치기', dCollapse: '섹션 모두 접기', dPlus: '+ 메뉴 열기', dReset: '처음으로', dSheet: '이 채팅 시트 열기', dStates: '상태: ?state=tg-panel, tg-collapsed, tg-expanded, tg-group, tg-select, tg-text, tg-textarea, tg-scope-on, tg-scope-revert, tg-scope-undo, tg-search-label|option|chosung|key|crumb|expand, tg-changed, tg-both, tg-nomatch, tg-favs, tg-fav-menu, tg-chips, tg-dup, tg-stress, tg-empty, tg-sheet.',
},
};
const tt = (k, v) => { let s = (TGI[S.lang] && TGI[S.lang][k]); if (s === undefined) s = TGI.en[k]; if (s === undefined) return Y.t2(k, v); if (v) for (const x in v) s = s.replaceAll('{' + x + '}', v[x]); return S.lang === 'ko' ? X.josa(s) : s; };
const L = (o) => (o && (o[S.lang] || o.en)) || '';

/* ------------------------------------------------------------------ icons (Lucide); star-fill is the same star with a fill */
const STAR = '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>';
const ICONS_TG = {
  'toggle-right': '<circle cx="15" cy="12" r="3"/><rect width="20" height="14" x="2" y="5" rx="7"/>',
  'filter': '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>',
  'file-text': '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  'puzzle': '<path d="M15.39 4.39a1 1 0 0 0 1.68-.474 2.5 2.5 0 1 1 3.014 3.015 1 1 0 0 0-.474 1.68l1.683 1.682a2.414 2.414 0 0 1 0 3.414L19.61 15.39a1 1 0 0 1-1.68-.474 2.5 2.5 0 1 0-3.014 3.015 1 1 0 0 1 .474 1.68l-1.683 1.682a2.414 2.414 0 0 1-3.414 0L8.61 19.61a1 1 0 0 0-1.68.474 2.5 2.5 0 1 1-3.014-3.015 1 1 0 0 0 .474-1.68l-1.683-1.682a2.414 2.414 0 0 1 0-3.414L4.39 8.61a1 1 0 0 1 1.68.474 2.5 2.5 0 1 0 3.014-3.015 1 1 0 0 1-.474-1.68l1.683-1.682a2.414 2.414 0 0 1 3.414 0z"/>',
  'star': STAR,
  'circle': '<circle cx="12" cy="12" r="10"/>',
  'triangle-alert': '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  'link': '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
};
const ico = (n, size = 20, cls = '') => (n === 'star-fill' ? X.ic('star', size, { cls, fill: true }) : X.ic(n, size, cls));      // HOOKS1_SPEC C-8: ic() has a fill option now

/* ------------------------------------------------------------------ synthetic toggle sets (SPEC section 10) */
const chk = (key, en, ko) => ({ t: 'toggle', key, type: 'check', label: { en, ko } });
const sel = (key, en, ko, opts) => ({ t: 'toggle', key, type: 'select', label: { en, ko }, opts: opts.map(([e, k]) => ({ en: e, ko: k })) });
const txt = (key, en, ko) => ({ t: 'toggle', key, type: 'text', label: { en, ko } });
const tar = (key, en, ko) => ({ t: 'toggle', key, type: 'textarea', label: { en, ko } });
const cap = (en, ko) => ({ t: 'caption', text: { en, ko } });
const dvd = (en, ko) => ({ t: 'divider', label: { en, ko } });
const grp = (en, ko, items) => ({ t: 'group', name: { en, ko }, items });
const NAMES = {
  prompt: { en: 'Prompt', ko: '프롬프트' }, char: { en: 'Character', ko: '캐릭터' },
};
function demoSources() {
  return [
    { id: 'prompt', kind: 'prompt', name: NAMES.prompt, sub: { en: 'Roleplay core', ko: '기본 롤플레이' }, items: [
      cap('Toggles from the active prompt', '현재 프롬프트가 제공하는 토글이에요'),
      chk('jailbreak', 'Jailbreak', '탈옥 프롬프트'),
      chk('reply_ko', 'Answer in Korean', '한국어로 답하기'),
      sel('length', 'Reply length', '답변 길이', [['Short', '짧게'], ['Long', '길게']]),
      sel('pov', 'Point of view', '시점', [['First person', '1인칭'], ['Second person', '2인칭'], ['Third, limited', '3인칭 제한'], ['Third, omniscient', '3인칭 전지적'], ['Alternating', '번갈아'], ['Free', '자유']]),
      dvd('Rules', '규칙'),
      chk('ooc', 'Allow OOC notes', 'OOC 메모 허용'),
      dvd('Notes', '메모'), dvd('Notes', '메모'),
      txt('nick', 'Name for me', '내 호칭'),
      tar('rules', 'Extra rules', '추가 규칙'),
      grp('Response format', '응답 형식', [chk('fmt_md', 'Use Markdown', '마크다운 쓰기'), sel('fmt_tense', 'Tense', '시제', [['Past', '과거형'], ['Present', '현재형']]), chk('fmt_dialog', 'Quote dialogue', '대사에 따옴표')]),
      grp('Mood', '분위기', [sel('mood', 'Mood', '분위기', [['Calm', '잔잔함'], ['Tense', '긴장감'], ['Playful', '장난기']]), chk('humor', 'Add humour', '유머 섞기')]),
    ] },
    { id: 'style', kind: 'module', mod: 'modA', name: { en: 'Narration style', ko: '서술 스타일' }, items: [
      chk('n_detail', 'Detailed description', '상세한 묘사'), chk('n_inner', 'Inner thoughts', '속마음 서술'),
      sel('n_len', 'Narration length', '서술 길이', [['Short', '짧게'], ['Medium', '보통'], ['Long', '길게']]), txt('n_name', 'Narrator name', '서술자 이름'),
      grp('Prose', '문체', [chk('p_poetic', 'Poetic', '시적으로'), chk('p_formal', 'Formal speech', '존댓말'), sel('p_voice', 'Voice', '어조', [['Soft', '부드럽게'], ['Bold', '대담하게'], ['Dry', '담백하게'], ['Witty', '재치 있게']]), chk('p_emoji', 'Emoji', '이모지')]),
      grp('Senses', '감각', [chk('s_smell', 'Smell description', '냄새 묘사'), chk('s_sound', 'Sound description', '소리 묘사')]),
    ] },
    { id: 'cards', kind: 'module', mod: 'modC', name: { en: 'Scene cards', ko: '장면 카드' }, items: [
      chk('c_show', 'Show scene cards', '장면 카드 보이기'), sel('c_style', 'Card detail', '카드 자세히', [['Simple', '간단히'], ['Standard', '표준'], ['Detailed', '자세히']]),
      chk('c_img', 'Card images', '카드에 이미지'), sel('c_pos', 'Card position', '카드 위치', [['Top', '위'], ['Bottom', '아래'], ['Left', '왼쪽'], ['Right', '오른쪽']]),
      txt('c_title', 'Card title', '카드 제목'), tar('c_note', 'Card note', '카드 메모'), chk('c_anim', 'Animate cards', '카드 움직임'), chk('c_sound', 'Card sound', '카드 효과음'),
    ] },
    { id: 'memory', kind: 'module', mod: 'modB', name: { en: 'Memory helper', ko: '메모리 도우미' }, items: [
      chk('m_auto', 'Auto summary', '자동 요약'), sel('m_every', 'Summary interval', '요약 간격', [['Every 10 turns', '10턴마다'], ['Every 20 turns', '20턴마다'], ['Every 30 turns', '30턴마다']]),
      chk('ooc', 'Keep OOC notes', 'OOC 메모도 기억'), chk('m_pin', 'Pin important facts', '중요한 건 고정'),
    ] },
    { id: 'char', kind: 'char', name: NAMES.char, sub: { en: 'Seraphina', ko: '세라핀' }, items: [
      sel('x_outfit', 'Outfit', '의상', [['Casual', '평상복'], ['Formal', '정장'], ['Coat', '코트'], ['Pyjamas', '잠옷']]), chk('x_blush', 'Show reactions', '반응 표현'), chk('x_secret', 'Reveal secrets', '비밀 공개'),
      txt('x_catch', 'Catchphrase', '입버릇'), tar('x_bio', 'Backstory notes', '배경 메모'), chk('memory', 'Use memory', '메모리 사용'),
    ] },
  ];
}
const DEMO_VALS = { jailbreak: true, reply_ko: true, length: 1, fmt_md: true, nick: '유나', rules: 'Keep replies under three paragraphs.', n_detail: true, n_inner: true, p_voice: 1, memory: true };   // 10 on; 장면 카드 and 메모리 도우미 have none (they start folded, DD-084)
function stressSources() {            // 100 toggles: prompt 35 (two groups), three modules (25 with two groups, 20, 12), character 8
  const mkT = (pre, n, from) => Array.from({ length: n }, (_, i) => {
    const k = from + i, nn = String(k).padStart(3, '0'), key = pre + nn, en = 'Setting ' + nn, ko = '설정 ' + nn;
    if (k % 17 === 0) return tar(key, 'Note ' + nn, '메모 ' + nn);
    if (k % 11 === 0) return txt(key, 'Name ' + nn, '이름 ' + nn);
    if (k % 7 === 0) return sel(key, 'Level ' + nn, '단계 ' + nn, [['Low', '낮음'], ['Mid', '중간'], ['High', '높음']]);
    if (k % 13 === 0) return sel(key, 'Mode ' + nn, '방식 ' + nn, [['A', '가'], ['B', '나'], ['C', '다'], ['D', '라'], ['E', '마']]);
    return chk(key, en, ko);
  });
  return [
    { id: 'prompt', kind: 'prompt', name: NAMES.prompt, sub: { en: 'Big prompt', ko: '큰 프롬프트' }, items: [...mkT('p', 15, 1), grp('Group A', '그룹 A', mkT('p', 10, 16)), grp('Group B', '그룹 B', mkT('p', 10, 26))] },
    { id: 'style', kind: 'module', mod: 'modA', name: { en: 'Narration style', ko: '서술 스타일' }, items: [...mkT('s', 10, 36), grp('Prose', '문체', mkT('s', 10, 46)), grp('Senses', '감각', mkT('s', 5, 56))] },
    { id: 'cards', kind: 'module', mod: 'modC', name: { en: 'Scene cards', ko: '장면 카드' }, items: mkT('c', 20, 61) },
    { id: 'memory', kind: 'module', mod: 'modB', name: { en: 'Memory helper', ko: '메모리 도우미' }, items: mkT('m', 12, 81) },
    { id: 'char', kind: 'char', name: NAMES.char, sub: { en: 'Seraphina', ko: '세라핀' }, items: mkT('x', 8, 93) },
  ];
}
const DATASETS = { demo: demoSources, stress: stressSources, empty: () => [] };

/* ------------------------------------------------------------------ state */
const V = { shared: Object.assign({}, DEMO_VALS) };                // shared (all-chats) values by toggle key; the jailbreak toggle mirrors slice 2's Jailbreak switch
const U = {                                                        // panel state (per user): section memory, favourites, filters
  set: DATASETS[Q.get('set')] ? Q.get('set') : 'demo', open: false, host: '', fromThis: false, opener: null, q: '', changedOnly: false,
  secOpen: {}, grpOpen: {}, favs: [], flashed: false, undo: null, undoT: 0, editing: null, scroll: 0, focusKey: '', layer: '', plusParent: false, tipT: 0,
};
let SRC = DATASETS[U.set]();
const wide = () => !!S.desktop && $('#app').clientWidth >= 1024;
const cur = () => Y.curChat();
const defOf = (tg) => (tg.type === 'check' ? false : tg.type === 'select' ? 0 : '');
const getShared = (tg) => (tg.key === 'jailbreak' ? !!Y.TG.jb : (tg.key in V.shared ? V.shared[tg.key] : defOf(tg)));
const scopeOn = (c) => !!(c && c.localToggles);
const getVal = (tg, c) => (scopeOn(c) && c.tgLocal && tg.key in c.tgLocal ? c.tgLocal[tg.key] : getShared(tg));
const isChanged = (tg, c) => getVal(tg, c) !== defOf(tg);
const chatOnly = (tg, c) => scopeOn(c) && !!c.tgLocal && tg.key in c.tgLocal && c.tgLocal[tg.key] !== getShared(tg);
function snapshotShared() { const o = {}; SRC.forEach((s) => walk(s.items, (tg) => { o[tg.key] = getShared(tg); })); return o; }
function walk(items, fn, g) { items.forEach((it) => { if (it.t === 'toggle') fn(it, g); else if (it.t === 'group') walk(it.items, fn, it); }); }
function setVal(tg, v, c) {
  if (scopeOn(c)) { c.tgLocal = c.tgLocal || snapshotShared(); c.tgLocal[tg.key] = v; }
  else if (tg.key === 'jailbreak') Y.TG.jb = !!v;
  else V.shared[tg.key] = v;
}
const srcOn = (src, c) => !src.mod || !!(c && c.modules && c.modules[src.mod]);
function model(c = cur()) {                                         // enabled sources in order, each with its flat toggle list
  const out = [];
  SRC.forEach((src) => { if (!srcOn(src, c)) return; const tgs = []; walk(src.items, (tg, g) => tgs.push({ tg, src, grp: g || null, id: src.id + ':' + tg.key })); if (tgs.length) out.push({ src, tgs }); });
  return out;
}
let IDX = new Map();
function reindex(M) { IDX = new Map(); M.forEach((s) => s.tgs.forEach((x) => IDX.set(x.id, x))); }
function totals(c = cur()) { const M = model(c); const keys = new Map(); M.forEach((s) => s.tgs.forEach((x) => { if (!keys.has(x.tg.key)) keys.set(x.tg.key, isChanged(x.tg, c)); })); return { n: keys.size, on: [...keys.values()].filter(Boolean).length, rows: M.reduce((a, s) => a + s.tgs.length, 0), M }; }   // unique variables: a key defined by two sources counts once (F-08)
const cnt = (arr, c) => ({ n: arr.length, on: arr.filter((x) => isChanged(x.tg, c)).length });
const srcTitle = (src) => L(src.name);
const summaryText = (c) => { const t = totals(c); return t.n ? tt('togglesSummary', { n: t.n, on: t.on }) : tt('tgNone'); };
const hm = (text, q) => Y.hmatch(text, q);
const OPEN_ROWS = 25;                                              // DD-085: above 20 toggles the first section opens, then on-value sections in order until about 25 rows show
const OPEN_ALL_MAX = 20;                                           // DD-084: up to 20 toggles in total every section starts open; above it only the first section and sections with on values
function defOpenMap(c) { if (U.defOpen) return U.defOpen; const M = model(c); const t = totals(c); const m = {}; let rows = 0; const top = (sec) => sec.tgs.filter((x) => !x.grp).length;   /* rows a section shows while its author groups are folded */
  M.forEach((sec, i) => { const open = t.n <= OPEN_ALL_MAX || i === 0 || (rows < OPEN_ROWS && sec.tgs.some((x) => isChanged(x.tg, c))); m[sec.src.id] = open; if (open) rows += top(sec); }); U.defOpen = m; return m; }   // frozen per panel open, so turning the last toggle off does not fold the section under the user
const secIsOpen = (sec) => (sec.src.id in U.secOpen ? U.secOpen[sec.src.id] : !!defOpenMap(cur())[sec.src.id]);
const grpKey = (src, g) => src.id + '/' + g.name.en;
const grpIsOpen = (src, g) => !!U.grpOpen[grpKey(src, g)];
const favValid = (c) => { const M = model(c); reindex(M); return U.favs.filter((id) => IDX.has(id)); };

/* ------------------------------------------------------------------ search and filter */
const JAMO1 = /^[ㄱ-ㅎ]$/;
const hm1 = (text, q) => (JAMO1.test(q.trim()) ? String(text).split(/[\s·›,/()-]+/).some((w) => w && Y.cho(w[0]) === q.trim()) : hm(text, q));   // F-07: one initial consonant only matches the start of a word; two or more match anywhere
function matchBy(x, q) {                                           // null when the toggle does not match; else why it matched
  if (!q) return 'all';
  const { tg, src, grp: g } = x;
  if (hm1(L(tg.label), q)) return 'label';
  if (tg.key.toLowerCase().includes(q.toLowerCase())) return 'key';
  if (hm1(srcTitle(src), q) || (src.sub && hm1(L(src.sub), q))) return 'section';
  if (g && hm1(L(g.name), q)) return 'group';
  if (tg.opts) { const o = tg.opts.find((op) => hm1(L(op), q)); if (o) return 'option:' + L(o); }
  return null;
}
const passes = (x, c, q) => { const by = matchBy(x, q); if (!by) return null; if (U.changedOnly && !(isChanged(x.tg, c) || chatOnly(x.tg, c))) return null; return by; };

/* ------------------------------------------------------------------ panel: shell */
const panelEl = () => $('.tgp');
const listEl = () => $('#tgList');
function buildPanel(host) {                                         // host: the sheet body or the dock
  host.replaceChildren(); if (host.id !== 'tgDock') host.className = 'sheet-body tgp-body';
  const p = document.createElement('div'); p.className = 'tgp'; p.dataset.host = U.host;
  const c = cur(); const M = model(c); const empty = !M.length;
  p.innerHTML = `<div class="tgp-head"><h2 id="tgTitle">${esc(tt('togglesTitle'))}</h2><span class="tgp-tag" id="tgTag"></span><span class="tgp-flash" id="tgFlash" role="status" aria-live="polite"></span><button type="button" class="btn tgp-x" id="tgX" aria-label="${esc(tt('tgClose'))}">${ico('x', 20)}</button></div>` +
    (empty ? '' : `<div class="tgp-pin"><div class="tgp-search"><span class="tgp-sic" aria-hidden="true">${ico('search', 18)}</span><input id="tgSearch" type="search" role="searchbox" autocomplete="off" spellcheck="false" aria-label="${esc(tt('togglesSearch'))}" placeholder="${esc(tt('togglesSearch'))}" value="${esc(U.q)}"><button type="button" class="btn tgp-clear" id="tgClear" aria-label="${esc(tt('togglesClearSearch'))}" ${U.q ? '' : 'hidden'}>${ico('x', 16)}</button></div>` +
      `<button type="button" class="btn tgp-chip" id="tgChanged" aria-pressed="${U.changedOnly}">${ico('filter', 16)}<span>${esc(tt('togglesChangedOnly'))}</span></button></div><div class="tgp-res" id="tgRes"></div><p class="tgp-hint" id="tgHint">${esc(tt('tgHint'))}</p>`) +
    `<div class="tgp-list" id="tgList" tabindex="-1" role="region" aria-label="${esc(tt('tgList'))}"></div><div class="sr-only" id="tgLive" role="status" aria-live="polite"></div>`;
  host.appendChild(p); wirePanel(p); paintTag(); renderList(true);
}
function paintTag() {                                              // DD-081: a persistent "이 채팅" pill while the switch is on (tap = go to the switch); the globe tag while shared (DD-043)
  const t = $('#tgTag'); if (!t) return; const on = scopeOn(cur());
  t.innerHTML = on ? `<button type="button" class="tgp-pill" id="tgPill" aria-label="${esc(tt('togglesChatValue') + ': ' + tt('tgPillGo'))}"><span class="pl">${ico('message', 14)}<span>${esc(tt('togglesChatValue'))}</span></span></button>` : `<span class="s2-scope k-all" data-scope="toggles">${ico('globe', 14)}<span>${esc(Y.t2('scopeAll'))}</span></span>`;
}
function flashSaved() { if (U.flashed) return; U.flashed = true; const f = $('#tgFlash'); if (!f) return; f.textContent = tt(scopeOn(cur()) ? 'tgSavedChat' : 'tgSavedAll'); clearTimeout(f._t); f._t = setTimeout(() => { f.textContent = ''; }, 1500); }

/* ------------------------------------------------------------------ panel: list rendering */
function scopeRow(c) {
  const on = scopeOn(c); const d = document.createElement('div'); d.className = 'tgp-scope';
  d.innerHTML = `<label class="sw tgp-scsw"><input type="checkbox" role="switch" id="tgScope" data-fk="scope" ${on ? 'checked' : ''}><span class="sw-ui"></span><span class="lbl">${esc(Y.t2('toggleScopeLabel'))}</span></label><p class="tgp-note" id="tgScopeNote">${esc(tt(on ? 'togglesScopeNoteOn' : 'togglesScopeNoteOff'))}</p>`;
  $('input', d).setAttribute('aria-describedby', 'tgScopeNote');
  if (U.undo && U.undo.chat === c.id) { const u = document.createElement('div'); u.className = 's2-tundo tgp-undo'; u.setAttribute('role', 'status'); u.innerHTML = `<span>${esc(Y.t2('togglesDiscarded'))}</span><button type="button" class="btn s2-tundo-btn" id="tgUndo" data-fk="undo">${ico('undo-2', 18)}<span>${esc(X.t('undo'))}</span></button>`; d.appendChild(u); }
  return d;
}
const kindIcon = (k) => (k === 'prompt' ? 'file-text' : k === 'char' ? 'user' : 'puzzle');
function renderList(initial) {
  const list = listEl(); if (!list) return;
  const c = cur(); const M = model(c); reindex(M); const q = U.q.trim(); const filt = !!q || U.changedOnly;
  const prevFocus = document.activeElement && list.contains(document.activeElement) ? document.activeElement.dataset.fk || '' : '';
  const scroll = initial ? U.scroll : list.scrollTop; const frag = document.createDocumentFragment();
  let shown = 0, total = 0; const seen = new Set();
  if (!M.length) {
    const e = document.createElement('div'); e.className = 'tgp-empty'; e.innerHTML = `<span class="tgp-eic" aria-hidden="true">${ico('toggle-right', 32)}</span><h3>${esc(tt('togglesNone'))}</h3><p>${esc(tt('togglesNoneHelp'))}</p>`; frag.appendChild(e);
  } else {
    frag.appendChild(scopeRow(c));
    if (!filt) { const fv = favValid(c); if (fv.length) frag.appendChild(favSection(fv, c)); }
    M.forEach((sec) => { total += 0; const el = sectionEl(sec, c, q, filt, seen); if (el) frag.appendChild(el); });
    shown = new Set([...seen].map((i) => i.slice(i.indexOf(':') + 1))).size; total = totals(c).n;
    if (filt && !shown) {
      const e = document.createElement('div'); e.className = 'tgp-nomatch'; e.id = 'tgNoMatch';
      e.innerHTML = `<h3>${esc(tt('togglesNoMatch'))}</h3><div class="tgp-nm-acts">${q ? `<button type="button" class="btn tgp-nm" data-nm="search" data-fk="nm-s">${ico('x', 16)}<span>${esc(tt('togglesClearSearch'))}</span></button>` : ''}${U.changedOnly ? `<button type="button" class="btn tgp-nm" data-nm="filter" data-fk="nm-f">${ico('filter', 16)}<span>${esc(tt('togglesFilterOff'))}</span></button>` : ''}</div>`; frag.appendChild(e);
    }
    const r = $('#tgRes'); if (r) { r.textContent = filt ? tt('tgResults', { shown, n: total }) : ''; r.hidden = !filt; }
    const lv = $('#tgLive'); if (lv && filt) { clearTimeout(U.tipT); U.tipT = setTimeout(() => { if ($('#tgLive')) $('#tgLive').textContent = shown ? tt('tgCountLive', { shown }) : tt('togglesNoMatch'); }, 350); }
  }
  list.replaceChildren(frag); list.scrollTop = scroll;
  const tgt = prevFocus || (initial ? U.focusKey : ''); if (tgt) { const f = $(`[data-fk="${CSS.escape(tgt)}"]`, list); if (f) f.focus({ preventScroll: true }); }
  $$('.tg-row', list).forEach(fillRow);
}
function favSection(ids, c) {
  const s = document.createElement('section'); s.className = 'tgp-sec tgp-favs'; s.dataset.flip = 'fav'; s.setAttribute('aria-labelledby', 'tgFavH');
  s.innerHTML = `<h3 class="tgp-sh static" id="tgFavH"><span class="tgp-sbtn static">${ico('star-fill', 18, 'tgp-star')}<span class="tgp-sn">${esc(tt('togglesFavorites'))}</span> <span class="tgp-cnt">${esc(String(ids.length))}</span></span></h3><div class="tgp-rows"></div>`;
  const rows = $('.tgp-rows', s); ids.forEach((id) => { const x = IDX.get(id); rows.appendChild(buildRow(x, 'fav', { crumb: true })); });
  return s;
}
function sectionEl(sec, c, q, filt, seen) {
  const { src } = sec; const vis = new Map(); sec.tgs.forEach((x) => { const by = passes(x, c, q); if (by) vis.set(x.id, by); });
  if (filt && !vis.size) return null;
  const open = filt ? true : secIsOpen(sec); const ct = cnt(sec.tgs, c); const sid = src.id;
  const el = document.createElement('section'); el.className = 'tgp-sec' + (open ? ' open' : ''); el.dataset.sid = sid; el.dataset.flip = 's:' + sid; el.setAttribute('aria-labelledby', 'tgsh-' + sid);
  el.innerHTML = `<h3 class="tgp-sh" id="tgsh-${sid}"><button type="button" class="btn tgp-sbtn" aria-expanded="${open}" aria-controls="tgs-${sid}" ${filt ? 'aria-disabled="true"' : ''} data-fk="sh:${sid}">${ico(kindIcon(src.kind), 18, 'tgp-kic')}<span class="tgp-sn">${esc(srcTitle(src))}</span> ${src.sub ? `<span class="tgp-ss">${esc(L(src.sub))}</span> ` : ''}<span class="tgp-cnt" data-cnt="s">${esc(tt('togglesSectionCount', ct))}</span>${ico('chevron-down', 18, 'tgp-chev')}</button></h3><div class="tgp-rows" id="tgs-${sid}" ${open ? '' : 'hidden'}></div>`;
  if (open) fillItems($('.tgp-rows', el), src.items, { src, c, q, filt, vis, seen, grp: null, sec });
  return el;
}
let gSeq = 0;
function fillItems(box, items, cx) {
  let lastDiv = null;
  items.forEach((it) => {
    if (it.t === 'toggle') {
      const id = cx.src.id + ':' + it.key; if (!cx.vis.has(id)) return; lastDiv = null; cx.seen.add(id);
      const x = IDX.get(id); const by = cx.vis.get(id);
      box.appendChild(buildRow(x, 'src', { crumb: !!cx.q, by }));
    } else if (it.t === 'caption') { if (cx.filt) return; const p = document.createElement('p'); p.className = 'tgp-capt'; p.textContent = L(it.text); box.appendChild(p); }
    else if (it.t === 'divider') { if (cx.filt) return; const lb = L(it.label); if (lb === lastDiv) return; lastDiv = lb; const d = document.createElement('div'); d.className = 'tgp-div'; d.setAttribute('role', 'separator'); d.innerHTML = `<span>${esc(lb)}</span>`; box.appendChild(d); }
    else if (it.t === 'group') {
      const ids =it.items.filter((t) => t.t === 'toggle').map((t) => cx.src.id + ':' + t.key);
      if (cx.filt && !ids.some((i) => cx.vis.has(i))) return; lastDiv = null;
      const open = cx.filt ? true : grpIsOpen(cx.src, it); const gk = grpKey(cx.src, it); const ct = cnt(ids.map((i) => IDX.get(i)), cx.c);
      const g = document.createElement('div'); g.className = 'tgp-gsec' + (open ? ' open' : ''); g.dataset.gk = gk; g.dataset.flip = 'g:' + gk; const gid = 'tgg' + (gSeq++);
      g.innerHTML = `<h4 class="tgp-gh"><button type="button" class="btn tgp-gbtn" aria-expanded="${open}" aria-controls="${gid}" ${cx.filt ? 'aria-disabled="true"' : ''} data-fk="gh:${esc(gk)}">${ico('chevron-down', 16, 'tgp-chev')}<span class="tgp-sn">${esc(L(it.name))}</span> <span class="tgp-cnt" data-cnt="g">${esc(tt('togglesSectionCount', ct))}</span></button></h4><div class="tgp-grows" id="${gid}" ${open ? '' : 'hidden'}></div>`;
      if (open) fillItems($('.tgp-grows', g), it.items, Object.assign({}, cx, { grp: it }));
      box.appendChild(g);
    }
  });
}

/* ------------------------------------------------------------------ rows */
function buildRow(x, where, o = {}) {
  const { tg } = x; const row = document.createElement('div'); row.className = 'tg-row'; row.dataset.id = x.id; row.dataset.key = tg.key; row.dataset.type = tg.type; row.dataset.in = where;
  if (o.crumb) row.dataset.crumb = srcTitle(x.src) + (x.grp ? ' › ' + L(x.grp.name) : ''); if (o.by && o.by.startsWith('option:')) row.dataset.opt = o.by.slice(7);
  const fk = (k) => `data-fk="r:${where}:${x.id}${k || ''}"`;
  const body = `<span class="tg-txt"><span class="tg-line"><i class="tg-dot" aria-hidden="true"></i><span class="tg-name"></span><span class="tg-starred" aria-hidden="true">${ico('star-fill', 12)}</span></span><span class="tg-meta"></span></span>`;
  const more = `<button type="button" class="btn tg-more" tabindex="-1" aria-haspopup="menu" data-fk="r:${where}:${x.id}:more">${ico('ellipsis-vertical', 20)}</button>`;
  const useSeg = tg.type === 'select' && tg.opts.length <= 3 && tg.opts.every((op) => [...op.ko].length <= 8 && [...op.en].length <= 12);     // same control in both languages
  if (tg.type === 'check') { row.innerHTML = `<label class="tg-hit sw"><input type="checkbox" role="switch" ${fk()}><span class="sw-ui"></span>${body}</label>${more}`; }
  else if (useSeg) { row.classList.add('tgseg'); if (tg.opts.length === 2 && [...tg.label.en].length <= 16 && [...tg.label.ko].length <= 10 && tg.opts.every((op) => [...op.en].length <= 7 && [...op.ko].length <= 4)) row.classList.add('inline'); row.innerHTML = `<div class="tg-hit tg-static">${body}</div>${more}<div class="tg-segw" role="radiogroup">${tg.opts.map((op, i) => `<button type="button" class="btn" role="radio" data-i="${i}" ${fk(':o' + i)}>${esc(L(op))}</button>`).join('')}</div>`; }
  else if (tg.type === 'select') { row.innerHTML = `<button type="button" class="btn tg-hit" aria-haspopup="dialog" ${fk()}>${body}<span class="tg-val"><span class="tg-vt"></span>${ico('chevron-down', 16)}</span></button>${more}`; }
  else { row.innerHTML = `<button type="button" class="btn tg-hit" ${fk()} ${tg.type === 'text' ? 'aria-expanded="false"' : 'aria-haspopup="dialog"'}>${body}<span class="tg-val ${tg.type}"><span class="tg-vt"></span>${ico('pencil', 16)}</span></button>${more}`; }
  return row;
}
function fillRow(row) {
  const x = IDX.get(row.dataset.id); if (!x) return; const c = cur(); const tg = x.tg; const v = getVal(tg, c); const ch = isChanged(tg, c), co = chatOnly(tg, c); const label = L(tg.label);
  row.classList.toggle('changed', ch); row.classList.toggle('chat', co); row.classList.toggle('starred', U.favs.includes(x.id) && row.dataset.in === 'src');
  const nm = $('.tg-name', row); nm.textContent = label; nm.title = label;
  const a11y = label + (ch ? ', ' + tt('togglesChangedA11y') : '') + (co ? ', ' + tt('togglesChatValue') : '');
  // meta line: breadcrumb or matched option, duplicate-key link, chat-only tag
  const meta = $('.tg-meta', row); const parts = [];
  if (row.dataset.crumb) parts.push(`<span class="tg-crumb">${esc(row.dataset.crumb)}</span>`);
  if (row.dataset.opt) parts.push(`<span class="tg-crumb">${esc(tt('tgOption', { opt: row.dataset.opt }))}</span>`);
  const others = [], odd = []; SRC.forEach((s) => { if (s !== x.src && srcOn(s, c) && IDX.has(s.id + ':' + tg.key)) (IDX.get(s.id + ':' + tg.key).tg.type === tg.type ? others : odd).push(s); });
  if (others.length) parts.push(`<span class="tg-dup">${ico('link', 12)}<span>${esc(tt('togglesSameValue', { source: others.map(srcTitle).join(', ') }))}</span></span>`);
  if (odd.length) parts.push(`<span class="tg-dup warn">${ico('triangle-alert', 12)}<span>${esc(tt('tgDupMismatch', { source: odd.map(srcTitle).join(', ') }))}</span></span>`);
  row.querySelectorAll('input[role="switch"], button.tg-hit, [role="radio"]').forEach((e) => e.setAttribute('aria-keyshortcuts', 'Shift+F10'));
  if (co) parts.push(`<span class="tg-chat" title="${esc(tt('tgLocalTag'))}">${esc(tt('togglesChatValue'))}</span>`);
  meta.innerHTML = parts.join(''); meta.hidden = !parts.length;
  const more = $('.tg-more', row); more.setAttribute('aria-label', tt('tgMenu', { label }));
  if (tg.type === 'check') { const inp = $('input', row); inp.checked = !!v; inp.setAttribute('aria-label', a11y); }
  else if ($('.tg-segw', row)) { const g = $('.tg-segw', row); g.setAttribute('aria-label', a11y); $$('button', g).forEach((b, i) => { const on = i === v; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; }); }
  else { const hit = $('.tg-hit', row); const vt = $('.tg-vt', row); let txt, empty = false;
    if (tg.type === 'select') txt = L(tg.opts[v]); else { txt = v; empty = !v; if (empty) txt = tt('tgEmpty'); }
    vt.textContent = txt; vt.classList.toggle('empty', empty); hit.setAttribute('aria-label', label + ': ' + txt + (ch ? ', ' + tt('togglesChangedA11y') : '') + (co ? ', ' + tt('togglesChatValue') : '')); }
}
function patchKey(key) {                                             // in-place update of every row driven by this variable (keeps the switch animation and the scroll position)
  if (U.changedOnly) { renderList(); return; }
  const list = listEl(); if (!list) return; const c = cur();
  $$('.tg-row', list).forEach((r) => { if (r.dataset.key === key) fillRow(r); });
  $$('[data-sid]', list).forEach((s) => { const sec = model(c).find((m) => m.src.id === s.dataset.sid); if (sec) { const cc = $('[data-cnt="s"]', s); if (cc) cc.textContent = tt('togglesSectionCount', cnt(sec.tgs, c)); } });
  $$('[data-gk]', list).forEach((g) => { const gk = g.dataset.gk; const [sid, ...rest] = gk.split('/'); const sec = model(c).find((m) => m.src.id === sid); if (!sec) return; const arr = sec.tgs.filter((x) => x.grp && x.grp.name.en === rest.join('/')); const cc = $('[data-cnt="g"]', g); if (cc) cc.textContent = tt('togglesSectionCount', cnt(arr, c)); });
}
function afterChange(tg, text) {
  patchKey(tg.key); flashSaved(); if (text) X.announce(text);
  if (panelEl() && U.q.trim()) { /* search results are by label, not by value */ }
}

/* ------------------------------------------------------------------ panel events */
function wirePanel(p) {
  p.addEventListener('click', (e) => { const r = e.target.closest('.tg-row'); if (r && r.dataset.lp) { e.preventDefault(); e.stopPropagation(); delete r.dataset.lp; } }, true);   // the lift after a long-press must not toggle the row
  p.addEventListener('click', onClick); p.addEventListener('change', onChange); p.addEventListener('keydown', onKey);
  p.addEventListener('contextmenu', onCtx); p.addEventListener('pointerdown', onPtr);
  const si = $('#tgSearch', p);
  if (si) {
    si.addEventListener('input', () => {                               // F-04: filter 120 ms after the last key; the clear button reacts at once
      $('#tgClear').hidden = !si.value; clearTimeout(U.qT); U.qT = setTimeout(() => { U.q = si.value; U.scroll = 0; renderList(); const l = listEl(); if (l) l.scrollTop = 0; }, 120);
    });
  }
}
function onChange(e) {
  const t = e.target;
  if (t.id === 'tgScope') { setScope(t.checked); return; }
  const row = t.closest('.tg-row'); if (!row || t.type !== 'checkbox') return;
  const x = IDX.get(row.dataset.id); if (!x) return; const c = cur(); setVal(x.tg, t.checked, c);
  afterChange(x.tg, tt(t.checked ? 'togglesOnA11y' : 'togglesOffA11y', { label: L(x.tg.label) }));
}
function onClick(e) {
  const t = e.target; const b = t.closest('button'); if (!b) return;
  if (b.id === 'tgX') { closePanel(); return; }
  if (b.id === 'tgPill') { const sc = $('#tgScope'); if (sc) { sc.scrollIntoView({ block: 'center' }); sc.focus({ preventScroll: true }); } return; }
  if (b.id === 'tgClear') { clearSearch(); $('#tgSearch').focus(); return; }
  if (b.id === 'tgChanged') { U.changedOnly = !U.changedOnly; b.setAttribute('aria-pressed', String(U.changedOnly)); renderList(); return; }
  if (b.id === 'tgUndo') { undoScope(); return; }
  if (b.dataset.nm === 'search') { clearSearch(); const s = $('#tgSearch'); if (s) s.focus(); return; }
  if (b.dataset.nm === 'filter') { U.changedOnly = false; const ch = $('#tgChanged'); ch.setAttribute('aria-pressed', 'false'); renderList(); ch.focus(); return; }
  if (b.classList.contains('tgp-sbtn') && !b.classList.contains('static')) { if (b.getAttribute('aria-disabled') === 'true') return; const sid = b.closest('[data-sid]').dataset.sid; const sec = model().find((m) => m.src.id === sid); if (!sec) return; flip(() => { U.secOpen[sid] = !secIsOpen(sec); renderList(); }); enterFade('#tgs-' + sid); return; }
  if (b.classList.contains('tgp-gbtn')) { if (b.getAttribute('aria-disabled') === 'true') return; const gk = b.closest('[data-gk]').dataset.gk; flip(() => { U.grpOpen[gk] = !U.grpOpen[gk]; renderList(); }); const ge = $(`[data-gk="${CSS.escape(gk)}"] .tgp-grows`); if (ge) enterFade(ge); return; }
  const row = b.closest('.tg-row'); if (!row) return; const x = IDX.get(row.dataset.id); if (!x) return;
  if (b.classList.contains('tg-more')) { rowMenu(x, row.dataset.in, b, null); return; }
  if (b.getAttribute('role') === 'radio') { const i = Number(b.dataset.i); setVal(x.tg, i, cur()); afterChange(x.tg, tt('tgPicked', { label: L(x.tg.label), value: L(x.tg.opts[i]) })); return; }
  if (b.classList.contains('tg-hit')) {
    if (x.tg.type === 'select') selectLayer(x, row.dataset.in, b);
    else if (x.tg.type === 'text') startInline(row, x);
    else if (x.tg.type === 'textarea') editorLayer(x, row.dataset.in, b);
  }
}
function onKey(e) {
  const t = e.target; const row = t.closest && t.closest('.tg-row');
  if (row && t.getAttribute && t.getAttribute('role') === 'radio' && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) {
    e.preventDefault(); const bs = $$('[role="radio"]', row); const i = bs.indexOf(t); const n = e.key === 'Home' ? 0 : e.key === 'End' ? bs.length - 1 : (i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1) + bs.length) % bs.length;
    bs[n].focus(); bs[n].click(); return;
  }
  if (row && e.key === 'ArrowRight' && t.matches && t.matches('input[role="switch"], button.tg-hit') && !U.editing) { e.preventDefault(); const mb = $('.tg-more', row); if (mb) mb.focus(); return; }
  if (row && e.key === 'ArrowLeft' && t.classList && t.classList.contains('tg-more')) { e.preventDefault(); const c0 = rowControl(row); if (c0) c0.focus(); return; }
  if (row && ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') && !t.matches('input[type="text"]')) {
    e.preventDefault(); e.stopPropagation(); const x = IDX.get(row.dataset.id); if (x) rowMenu(x, row.dataset.in, $('.tg-more', row), null, t); return;
  }
  if (t.matches && t.matches('.tg-edit input')) {
    if (e.key === 'Enter') { e.preventDefault(); finishInline(true); }
  }
}
function onCtx(e) {
  const row = e.target.closest('.tg-row'); if (!row) return; if (U.lastPtr === 'touch') { e.preventDefault(); return; }
  e.preventDefault(); if (X.now() - (U.menuAt || 0) < 600) return;       // the contextmenu event that follows Shift+F10 / the Menu key must not reopen the menu
  const x = IDX.get(row.dataset.id); if (x) rowMenu(x, row.dataset.in, $('.tg-more', row), { x: e.clientX, y: e.clientY });
}
function onPtr(e) {
  U.lastPtr = e.pointerType; if (e.pointerType === 'mouse' || e.button > 0) return;
  const row = e.target.closest('.tg-row'); if (!row || e.target.closest('.tg-more') || e.target.closest('.tg-edit')) return; const x = IDX.get(row.dataset.id); if (!x) return;
  const x0 = e.clientX, y0 = e.clientY; let fired = false;
  const timer = setTimeout(() => { fired = true; row.dataset.lp = '1'; setTimeout(() => delete row.dataset.lp, 700); X.haptic('long-press'); rowMenu(x, row.dataset.in, $('.tg-more', row), null, row.querySelector('.tg-hit')); }, 500);
  const cancel = (ev) => { if (ev && ev.type === 'pointermove' && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 10) return; clearTimeout(timer); removeEventListener('pointermove', cancel); removeEventListener('pointerup', cancel); removeEventListener('pointercancel', cancel); };
  addEventListener('pointermove', cancel); addEventListener('pointerup', cancel); addEventListener('pointercancel', cancel);
}
function clearSearch() { clearTimeout(U.qT); U.q = ''; const s = $('#tgSearch'); if (s) s.value = ''; const cl = $('#tgClear'); if (cl) cl.hidden = true; renderList(); }

/* section/group collapse: content fades in (opacity) and the following content moves with transform (no height animation) */
function flip(fn) {
  const list = listEl(); const still = S.rm || S.lp || !list;
  const before = still ? null : new Map($$('[data-flip]', list).map((e) => [e.dataset.flip, e.getBoundingClientRect().top]));
  const fk = document.activeElement && list && list.contains(document.activeElement) ? document.activeElement.dataset.fk : '';
  fn(); if (fk) { const f = $(`[data-fk="${CSS.escape(fk)}"]`, list); if (f) f.focus({ preventScroll: true }); }
  if (!before) return;
  const moved = [];
  $$('[data-flip]', list).forEach((e) => { const b = before.get(e.dataset.flip); if (b === undefined) return; const dy = b - e.getBoundingClientRect().top; if (Math.abs(dy) > 1) { e.style.transform = `translate3d(0,${dy}px,0)`; moved.push(e); } });
  if (!moved.length) return; void list.offsetWidth;
  moved.forEach((e) => { e.classList.add('flipping'); e.style.transform = ''; });
  setTimeout(() => moved.forEach((e) => e.classList.remove('flipping')), X.durOf('base') + 60);
}

function enterFade(sel) {                                              // newly opened content fades in (opacity + a few px of transform); instant under reduced motion and low power
  const e = typeof sel === 'string' ? $(sel) : sel; if (!e || e.hidden || S.rm || S.lp) return; e.classList.remove('enter'); void e.offsetWidth; e.classList.add('enter'); setTimeout(() => e.classList.remove('enter'), X.durOf('base') + 80);
}

/* ------------------------------------------------------------------ inline text editor (Enter or blur saves, Esc reverts) */
function startInline(row, x) {
  if (U.editing) finishInline(true);
  const tg = x.tg; const v = getVal(tg, cur()); const id = 'tgi-' + Date.now();
  U.editing = { id: row.dataset.id, where: row.dataset.in, orig: v };
  const hit = $('.tg-hit', row); hit.hidden = true; $('.tg-more', row).hidden = true; row.classList.add('editing');
  const ed = document.createElement('div'); ed.className = 'tg-edit'; ed.innerHTML = `<label for="${id}">${esc(L(tg.label))}</label><input id="${id}" type="text" value="${esc(String(v))}" data-esc-leave data-fk="edit" autocomplete="off" spellcheck="false">`;
  row.insertBefore(ed, hit); const inp = $('input', ed); inp.focus(); inp.select();
  inp.addEventListener('blur', () => { if (U.editing && inp.isConnected) setTimeout(() => { if (U.editing && !document.activeElement.closest('.tg-edit')) finishInline(true, true); }, 0); });
}
function finishInline(save, fromBlur) {
  const ed = U.editing; if (!ed) return; U.editing = null;
  const row = $(`.tg-row[data-id="${CSS.escape(ed.id)}"][data-in="${ed.where}"]`); const x = IDX.get(ed.id);
  if (!row || !x) return; const inp = $('.tg-edit input', row);
  if (save && inp) { const v = inp.value; if (v !== ed.orig) { setVal(x.tg, v, cur()); X.announce(tt('tgTextSaved', { label: L(x.tg.label) })); flashSaved(); } }
  const ne = buildRow(x, ed.where, { crumb: !!row.dataset.crumb, by: row.dataset.opt ? 'option:' + row.dataset.opt : '' }); if (row.dataset.crumb) ne.dataset.crumb = row.dataset.crumb; if (row.dataset.opt) ne.dataset.opt = row.dataset.opt;
  row.replaceWith(ne); fillRow(ne); patchKey(x.tg.key);
  if (!fromBlur) { const f = $('.tg-hit', ne); if (f) f.focus({ preventScroll: true }); }
}
function cancelInline() { if (!U.editing) return false; finishInline(false); return true; }

/* ------------------------------------------------------------------ layers over the panel: option list, textarea editor, row menu */
function layer({ title, build, cls = '', menu = false, anchor = null, opener = null, arrows = false, back = null, focusKey = '' }) {
  const inSheet = U.open && U.host === 'sheet' && X.Sh.open;
  const l = listEl(); if (l) { U.scroll = l.scrollTop; const a = document.activeElement; U.focusKey = focusKey || (a && l.contains(a) ? a.dataset.fk || '' : U.focusKey); }
  if (inSheet) {                                                       // a layer over the panel: its Back entry returns to the panel (pushBack stack, HOOKS1_SPEC C-3)
    U.layer = title; X.swapSheet(title, build, cls); X.Sh.arrows = arrows;
    Y.pushBack(back || (() => { U.layer = ''; reshowSheet(); }));
  } else { U.layer = title; X.openSheet({ title, build, cls, menu, anchor, opener: opener || document.activeElement, arrows }); if (back) Y.pushBack(back); }
}
function reshowSheet() {                                              // back to the panel inside the shared sheet (the panel's own Back entry is still on the stack)
  U.layer = ''; const cls = (S.desktop ? 'panel' : 's2tall') + ' tgp-sheet';
  X.swapSheet(tt('togglesTitle'), (body) => { U.host = 'sheet'; buildPanel(body); const f = U.focusKey && $(`[data-fk="${CSS.escape(U.focusKey)}"]`, body); if (f) f.setAttribute('data-autofocus', ''); else listEl().setAttribute('data-autofocus', ''); }, cls);
}
function leaveLayer(refocusKey) {                                      // a layer finished: return to the panel, keep focus on the row
  U.focusKey = refocusKey || U.focusKey;
  if (U.open && U.host === 'sheet') { Y.popBack(); reshowSheet(); }
  else { X.closeSheet(true); setTimeout(() => { const f = refocusKey && $(`[data-fk="${CSS.escape(refocusKey)}"]`); if (f) f.focus({ preventScroll: true }); }, 30); }
}
function selectLayer(x, where, opener) {
  const tg = x.tg; const c = cur(); const v = getVal(tg, c); const fk = `r:${where}:${x.id}`;
  layer({ title: L(tg.label), opener, arrows: true, focusKey: fk, build(body) {
    body.replaceChildren(); body.className = 'sheet-body'; body.setAttribute('role', 'radiogroup'); body.setAttribute('aria-label', tt('tgPickTitle', { label: L(tg.label) }));
    tg.opts.forEach((op, i) => {
      const it = X.item(i === v ? 'check' : 'circle', L(op), () => { setVal(tg, i, c); X.announce(tt('tgPicked', { label: L(tg.label), value: L(op) })); flashSaved(); if (U.plusParent) { Y.popBack(); backToPlus(x.id); return; } leaveLayer(fk); patchKey(tg.key); }, '', { role: 'radio', 'aria-checked': String(i === v) });
      it.dataset.i = i; if (i === v) it.setAttribute('data-autofocus', ''); if (i === v) it.tabIndex = 0; else it.tabIndex = -1; body.appendChild(it);
    });
    if (!$('[data-autofocus]', body)) body.firstChild.setAttribute('data-autofocus', '');
  }, back: U.plusParent ? () => backToPlus(x.id) : null });
}
function backToPlus(id) { U.plusParent = false; X.openPlus(); setTimeout(() => { const b = $(`.tg-chip2[data-id="${CSS.escape(id)}"]`); if (b) { $$('[role^="menuitem"]', $('#sheetRoot')).forEach((q) => (q.tabIndex = -1)); b.tabIndex = 0; b.focus({ preventScroll: true }); } }, 60); }
function editorLayer(x, where, opener) {
  const tg = x.tg; const c = cur(); const v = String(getVal(tg, c)); const fk = `r:${where}:${x.id}`;
  layer({ title: tt('tgEditTitle', { label: L(tg.label) }), opener, cls: S.desktop ? 'tall' : '', focusKey: fk, build(body) {
    body.replaceChildren(); body.className = 'sheet-body tg-editor';
    const lab = document.createElement('label'); lab.className = 'tg-ed-l'; lab.htmlFor = 'tgTa'; lab.textContent = L(tg.label);
    const ta = document.createElement('textarea'); ta.id = 'tgTa'; ta.rows = 6; ta.value = v; ta.setAttribute('data-esc-leave', ''); ta.setAttribute('data-autofocus', ''); ta.className = 'tg-ta';
    const row = document.createElement('div'); row.className = 'confirm-row';
    row.appendChild(X.item('x', X.t('cancel'), () => { leaveLayer(fk); }, ''));
    row.appendChild(X.item('check', tt('tgSave'), () => { if (ta.value !== v) { setVal(tg, ta.value, c); X.announce(tt('tgTextSaved', { label: L(tg.label) })); flashSaved(); } leaveLayer(fk); patchKey(tg.key); }, 'accent', { 'data-save': '' }));
    body.appendChild(lab); body.appendChild(ta); body.appendChild(row);
  } });
}
function rowMenu(x, where, opener, anchor, focusEl) {
  U.menuAt = X.now(); const tg = x.tg; const c = cur(); const starred = U.favs.includes(x.id); const favs = favValid(c); const fi = favs.indexOf(x.id); const fk = `r:${where}:${x.id}`; const ret = focusEl || opener;
  const keyBack = ret && ret.dataset ? ret.dataset.fk : fk;
  layer({ title: L(tg.label), opener: ret, anchor, menu: !(U.open && U.host === 'sheet'), arrows: true, focusKey: keyBack, build(body) {
    body.replaceChildren(); if (U.open && U.host === 'sheet') { body.className = 'sheet-body'; body.setAttribute('role', 'menu'); }
    const done = (fn) => () => { fn(); };                               // closeAfter / moveFav leave the layer (leaveLayer pops its Back entry)
    const add = (icon, label, fn, disabled) => { const it = X.item(icon, label, done(fn), '', { role: 'menuitem' }); it.tabIndex = -1;
      if (disabled) it.setAttribute('aria-disabled', 'true'); body.appendChild(it); return it; };
    const doStar = () => { if (starred) U.favs = U.favs.filter((i) => i !== x.id); else U.favs.push(x.id); X.announce(tt(starred ? 'tgUnstarred' : 'tgStarred', { label: L(tg.label) })); closeAfter(() => renderList(), keyBack); };
    add(starred ? ['star', { fill: true }] : 'star', tt(starred ? 'togglesUnstar' : 'togglesStar'), doStar);
    if (where === 'fav') {
      add('arrow-up', tt('togglesMoveUp'), () => moveFav(x, -1, keyBack), fi <= 0); add('arrow-down', tt('togglesMoveDown'), () => moveFav(x, 1, keyBack), fi >= favs.length - 1);
    }
    add('rotate-ccw', tt(tg.type === 'check' ? 'togglesReset' : tg.type === 'select' ? 'tgResetSelect' : 'tgResetText'), () => { setVal(tg, defOf(tg), c); X.announce(tt('tgResetDone', { label: L(tg.label) })); flashSaved(); closeAfter(() => patchKey(tg.key), keyBack); }, !isChanged(tg, c) && !chatOnly(tg, c) && getVal(tg, c) === defOf(tg));
    if (chatOnly(tg, c)) add('undo-2', tt('togglesRevertShared'), () => { revertShared(tg, c); X.announce(tt('tgRevertDone', { label: L(tg.label) })); closeAfter(() => patchKey(tg.key), keyBack); });
    const first = $('.item', body); if (first) { first.tabIndex = 0; first.setAttribute('data-autofocus', ''); }
  } });
}
function closeAfter(fn, key) {                                         // run a change then return to the panel with focus on the row control
  if (U.open && U.host === 'sheet') { fn(); leaveLayer(key); } else { X.closeSheet(true); fn(); setTimeout(() => { const f = key && $(`[data-fk="${CSS.escape(key)}"]`); const t = f || listEl(); if (t) t.focus({ preventScroll: true }); }, 30); }
}
function revertShared(tg, c) { if (c.tgLocal) c.tgLocal[tg.key] = getShared(tg); }
function moveFav(x, d, key) {
  const favs = favValid(cur()); const i = favs.indexOf(x.id); const j = i + d; if (i < 0 || j < 0 || j >= favs.length) return;
  const a = U.favs.indexOf(favs[i]), b = U.favs.indexOf(favs[j]); [U.favs[a], U.favs[b]] = [U.favs[b], U.favs[a]];
  X.announce(tt('tgMovedTo', { label: L(x.tg.label), n: j + 1, total: favs.length })); closeAfter(() => renderList(), key);
}

/* ------------------------------------------------------------------ scope switch (DD-045): copy on enable, discard with a short undo on disable */
function setScope(on) {
  const c = cur(); if (!c) return; clearTimeout(U.undoT);
  if (on) { c.tgLocal = snapshotShared(); c.localVals = c.localVals || {}; c.localToggles = true; U.undo = null; }
  else { U.undo = { chat: c.id, saved: c.tgLocal }; c.tgLocal = null; c.localToggles = false; U.undoT = setTimeout(dropUndo, 10000); /* the panel is a longer task than slice 2's inline row (6 s) */ }
  paintTag(); renderList(); const f = $('#tgScope'); if (f) f.focus({ preventScroll: true });
}
function undoScope() { const u = U.undo; if (!u) return; const c = cur(); clearTimeout(U.undoT); U.undo = null; c.tgLocal = u.saved; c.localToggles = true; paintTag(); renderList(); const f = $('#tgScope'); if (f) f.focus({ preventScroll: true }); }
function dropUndo() { U.undo = null; const r = $('.tgp-undo'); if (r) { const had = r.contains(document.activeElement); r.remove(); if (had) { const f = $('#tgScope'); if (f) f.focus(); } } }

/* ------------------------------------------------------------------ host: shared sheet on narrow, docked right panel on wide */
function registerBack() { Y.pushBack(panelBack); }                   // the panel's own Back entry; layers over it push theirs on top
function panelBack() {                                                 // Back / Esc layers inside the sheet host: inline editor, search text, then the panel itself
  if (cancelInline()) { registerBack(); return; }
  if (U.q.trim()) { clearSearch(); registerBack(); return; }
  U.open = false; U.layer = '';
  if (U.fromThis) { U.fromThis = false; Y.openThisChat(); } else X.closeSheet();
}
function openPanel(o = {}) {
  const host = wide() ? 'dock' : 'sheet'; if (!o.keep) { U.q = ''; U.changedOnly = false; } U.fromThis = !!o.fromThis; U.opener = o.opener || null; U.defOpen = null; U.scroll = o.scroll != null ? o.scroll : 0; U.focusKey = ''; U.layer = ''; U.plusParent = false;
  if (host === 'dock') {
    if (X.Sh.open) X.closeSheet(false);
    U.host = 'dock'; U.kind = 'dock'; U.open = true; const d = $('#tgDock'); d.hidden = false; d.removeAttribute('inert'); buildPanel(d);
    const f = o.focus === 'list' ? listEl() : $('#tgSearch'); if (f) f.focus({ preventScroll: true });
  } else {
    U.host = 'sheet'; U.kind = S.desktop ? 'panel' : 'phone'; U.open = true; const cls = (S.desktop ? 'panel' : 's2tall') + ' tgp-sheet'; const title = tt('togglesTitle');
    const build = (body) => { buildPanel(body); const l = listEl(); if (l) l.setAttribute('data-autofocus', ''); };
    if (X.Sh.open) X.swapSheet(title, build, cls); else X.openSheet({ title, opener: o.opener || document.activeElement, build, cls });
    while (Y.popBack()) { /* a fresh panel starts with a clean Back stack */ }
    registerBack();
  }
  if (o.focusFav) setTimeout(() => focusFav(), 30);
  if (o.focusId) setTimeout(() => focusRow(o.focusId), 30);
}
function closeDock(restore = true) {
  if (!(U.open && U.host === 'dock')) return; U.open = false; U.editing = null; const d = $('#tgDock'); const had = d.contains(document.activeElement); d.hidden = true; d.replaceChildren();
  if (restore || had) { let o = U.opener; if (!o || !o.isConnected || o.closest('[hidden]')) o = $('#moreBtn') || $('#input'); try { o.focus({ preventScroll: true }); } catch (_) {} }
}
function closePanel(restore = true) { if (!U.open) return; if (U.host === 'dock') closeDock(restore); else { U.open = false; U.fromThis = false; X.closeSheet(restore); } }
function rowControl(r) { return $('input[role="switch"], button.tg-hit, [role="radio"][tabindex="0"]', r); }
function focusFav() { const l = listEl(); if (!l) return; const h = $('#tgFavH'); const t = h ? rowControl(h.parentElement.querySelector('.tgp-rows .tg-row')) : null; if (h) { l.scrollTop = Math.max(0, h.parentElement.offsetTop - 4); } if (t) t.focus({ preventScroll: true }); }
function focusRow(id) { const l = listEl(); if (!l) return; const r = $(`.tg-row[data-id="${CSS.escape(id)}"][data-in="fav"]`, l) || $(`.tg-row[data-id="${CSS.escape(id)}"]`, l); if (!r) return; r.scrollIntoView({ block: 'center' }); r.classList.add('hl'); setTimeout(() => r.classList.remove('hl'), 1400); const f = rowControl(r); if (f && f.focus) f.focus({ preventScroll: true }); }

/* ------------------------------------------------------------------ This chat sheet: the 토글 group becomes one summary row (S2H.togglesGroup, HOOKS1_SPEC C-5) */
function summarySection(c) {
  const sc = scopeOn(c); const n = document.createElement('section'); n.className = 's2-grp'; n.dataset.tgsum = '1'; n.setAttribute('aria-labelledby', 'tgSumRow');
  n.innerHTML = `<button type="button" class="btn s2-brow tg-sum" id="tgSumRow" aria-haspopup="dialog"><span class="l">${ico('toggle-right', 20)}<span>${esc(tt('togglesTitle'))}</span>${sc ? '' : `<span class="s2-scope k-all" data-scope="toggles">${ico('globe', 14)}<span>${esc(Y.t2('scopeAll'))}</span></span>`}</span><span class="r"><span id="tgSumVal">${esc(summaryText(c))}</span>${ico('chevron-right', 16)}</span></button>`;
  $('button', n).addEventListener('click', () => {
    U.undo = null; clearTimeout(U.undoT);
    if (wide()) { X.closeSheet(false); setTimeout(() => openPanel({ opener: $('#moreBtn') }), 0); }
    else openPanel({ fromThis: true });
  });
  return n;
}
const findTg = (key) => { let r = null; SRC.forEach((src) => walk(src.items, (tg) => { if (tg.key === key) r = tg; })); return r; };
// DD-082: slice 2's own "모든 채팅" Jailbreak switch and 메모리 row read and write through one scope-aware accessor (S2H.access, HOOKS1_SPEC C-9); the same value as the panel's rows
const ACCESS = {
  get(k, c) { const tg = findTg(k); return tg ? !!getVal(tg, c) : (k === 'jailbreak' ? Y.TG.jb : true); },
  set(k, v, c) { const tg = findTg(k); if (!tg) { if (k === 'jailbreak') Y.TG.jb = v; return; } setVal(tg, v, c); X.announce(tt(v ? 'togglesOnA11y' : 'togglesOffA11y', { label: L(tg.label) })); },
  label(k, c) { return k === 'memory' ? Y.TG.memory + (ACCESS.get('memory', c) ? '' : ' · ' + tt('tgOff')) : ''; },       // the memory row keeps its real type; off adds "· 꺼짐"
  scope(k, c) { return scopeOn(c) ? 'chat' : 'all'; },
};
// DD-086: while chat-only is on, the jailbreak switch and the memory row sit in the "이 채팅" group (S2H.thisChatBuilt: the one DOM regrouping left; see HOOKS1_SPEC C-9)
function regroupSlice2(body, c) {
  if (!c) return; const mrow = $('[aria-labelledby="s2g-char"] .s2-brow', body); if (mrow) mrow.dataset.tgmem = '1';
  if (!scopeOn(c)) return;
  const jb = $('[data-jb]', body); const chat = $('[aria-labelledby="s2g-chat"]', body); if (!chat) return;
  const tag = () => { const t = document.createElement('span'); t.className = 'tg-chat tg-moved'; t.textContent = tt('togglesChatValue'); return t; };
  if (jb && findTg('jailbreak')) { const lab = jb.closest('label'); const grp = jb.closest('.s2-grp'); if (lab && grp !== chat) { chat.appendChild(lab); if (!$('.tg-moved', lab)) $('.lbl', lab).after(tag()); const note = $('.s2-note1', grp); if (note) note.hidden = true; } }
  if (mrow && findTg('memory') && !chat.contains(mrow)) { chat.appendChild(mrow); const r = $('.r', mrow); if (r && !$('.tg-moved', r)) r.prepend(tag()); }
}
function installHooks() {
  S2H.togglesGroup = (body, c) => { body.appendChild(summarySection(c)); return true; };
  S2H.access = ACCESS; S2H.thisChatBuilt = regroupSlice2;
  // keep U.open honest when the shared sheet is closed by Back, a drag, the backdrop or a layer (the dock is not made inert: slice 1 restores focus on close and an inert dock would refuse it)
  document.addEventListener('chat:sheetclosed', () => { if (U.open && U.host === 'sheet') { U.open = false; U.layer = ''; U.fromThis = false; } });
  // the docked panel follows the open chat (S2H.chatChanged, HOOKS1_SPEC C-4)
  const prev = S2H.chatChanged; S2H.chatChanged = (c, ch) => { if (prev) prev(c, ch); if (U.open && U.host === 'dock' && $('#tgList')) { U.undo = null; U.defOpen = null; paintTag(); renderList(); } };
}

/* ------------------------------------------------------------------ + sheet: toggles item and favourite chips (S.hooks.plus) */
function chipsFor(c) { return favValid(c).map((id) => IDX.get(id)); }
function plusHook(body) {
  const c = cur(); if (!c) return; const t = totals(c);
  const it = X.item('toggle-right', tt('togglesTitle'), () => { X.closeSheet(false); setTimeout(() => openPanel({ opener: $('#plusBtn') }), 0); }, 'tg-plusitem', { role: 'menuitem' });
  it.tabIndex = -1; it.dataset.tgPlus = ''; it.insertAdjacentHTML('beforeend', `<span class="tg-plusval">${esc(t.n ? tt('tgPlusValue', { n: t.n, on: t.on }) : tt('tgNone'))}</span>`);
  reindex(t.M); const chips = chipsFor(c);
  if (!chips.length) { body.appendChild(it); return; }                  // no stars: the item closes the list like any other entry
  body.prepend(it);                                                      // with stars the item and the chips lead the menu, so the quick toggles are visible without scrolling
  const shEl = body.closest('.sheet'); if (shEl) shEl.classList.add('tall');                 // room for the chips (slice 1's .tall: 86 % of the height)
  const wrap = document.createElement('div'); wrap.className = 'tg-chips'; wrap.setAttribute('role', 'group'); wrap.setAttribute('aria-labelledby', 'tgChipsH');
  wrap.innerHTML = `<div class="tg-chips-h" id="tgChipsH">${esc(tt('tgChipsHead'))}</div><div class="tg-chiprow"></div>`; const row = $('.tg-chiprow', wrap);
  const shown = chips.slice(0, 8);
  shown.forEach((x) => {
    const tg = x.tg, v = getVal(tg, c), label = L(tg.label);
    const b = document.createElement('button'); b.type = 'button'; b.className = 'btn tg-chip2'; b.dataset.id = x.id; b.tabIndex = -1;
    if (tg.type === 'check') { b.setAttribute('role', 'menuitemcheckbox'); b.setAttribute('aria-checked', String(!!v)); b.classList.toggle('on', !!v); b.innerHTML = `<span class="tg-chk" aria-hidden="true">${v ? ico('check', 14) : ''}</span><span class="tg-cl">${esc(label)}</span>`; b.setAttribute('aria-label', tt(v ? 'togglesOnA11y' : 'togglesOffA11y', { label })); }
    else if (tg.type === 'select') { b.setAttribute('role', 'menuitem'); b.setAttribute('aria-haspopup', 'dialog'); b.innerHTML = `<span class="tg-cl">${esc(label + ': ' + L(tg.opts[v]))}</span>${ico('chevron-down', 14)}`; }
    else { b.setAttribute('role', 'menuitem'); b.setAttribute('aria-haspopup', 'dialog'); b.innerHTML = `<span class="tg-cl">${esc(label)}</span>${ico('pencil', 14)}`; }
    b.addEventListener('click', () => {
      if (X.now() - X.Sh.at < 350) return;
      if (tg.type === 'check') { const nv = !getVal(tg, cur()); setVal(tg, nv, cur()); b.setAttribute('aria-checked', String(nv)); b.classList.toggle('on', nv); $('.tg-chk', b).innerHTML = nv ? ico('check', 14) : ''; b.setAttribute('aria-label', tt(nv ? 'togglesOnA11y' : 'togglesOffA11y', { label })); X.announce(tt(nv ? 'togglesOnA11y' : 'togglesOffA11y', { label })); flashSaved(); const sv = $('.tg-plusval'); if (sv) sv.textContent = tt('tgPlusValue', { n: totals(cur()).n, on: totals(cur()).on }); }
      else if (tg.type === 'select') { U.plusParent = true; selectLayer(x, 'fav', b); }
      else { X.closeSheet(false); setTimeout(() => openPanel({ opener: $('#plusBtn'), focusId: x.id }), 0); }
    });
    row.appendChild(b);
  });
  if (chips.length > 8) {
    const m = document.createElement('button'); m.type = 'button'; m.className = 'btn tg-chip2 more'; m.setAttribute('role', 'menuitem'); m.tabIndex = -1; m.dataset.more = '1';
    m.innerHTML = `<span class="tg-cl">${esc(tt('togglesMore'))}</span>${ico('chevron-right', 14)}`; m.addEventListener('click', () => { if (X.now() - X.Sh.at < 350) return; X.closeSheet(false); setTimeout(() => openPanel({ opener: $('#plusBtn'), focusFav: true }), 0); }); row.appendChild(m);
  }
  it.after(wrap);
}
// slice 1's menu keys now cover menuitemcheckbox (C-7): Up/Down/Home/End walk the toggle item and the chips there; Left/Right (a chip row) are the panel's own addition
function plusKeys(e) {
  if (!X.Sh.open || X.Sh.kind !== 'menu') return; const body = $('#sheetRoot .sheet-body'); if (!$('.tg-chips', body)) return;
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  const all = $$('[role^="menuitem"]', body).filter((x) => x.getAttribute('aria-disabled') !== 'true'); const i = all.indexOf(document.activeElement); if (i < 0 && !all.length) return;
  e.preventDefault(); e.stopImmediatePropagation();
  const n = all[(i + (e.key === 'ArrowRight' ? 1 : -1) + all.length) % all.length];
  all.forEach((x) => (x.tabIndex = -1)); n.tabIndex = 0; n.focus();
}

/* ------------------------------------------------------------------ keys: Ctrl+Shift+T, Esc in an inline editor (sheet host), Back for the dock */
// registered at load, i.e. after slice 2's own window handler and before slice 1's (which registers on DOMContentLoaded): the + menu arrows and Esc in an inline editor are decided here first
addEventListener('keydown', (e) => {
    if (!X || !S || e.isComposing) return;
    if (e.key === 'Escape' && e.target && e.target.matches && e.target.matches('.tg-edit input') && U.editing) { e.preventDefault(); e.stopImmediatePropagation(); cancelInline(); return; }                    // the panel's Back entry was not popped: nothing to register again
    plusKeys(e);
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && (e.key === 't' || e.key === 'T')) {
      const tg = e.target; const inField = tg && tg.matches && tg.matches('input, textarea, select') && tg.id !== 'input';
      if (X.Sh.open || S2.home || (!S.desktop && S.sbOpen) || inField || !cur()) return;
      e.preventDefault(); e.stopImmediatePropagation();
      if (U.open && U.host === 'dock') { const s = $('#tgSearch'); if (s) s.focus(); return; }
      openPanel({ opener: document.activeElement });
    }
}, true);
function installBack() {
  const prev = S2H.back;
  S2H.back = (src) => {
    if (U.open && U.host === 'dock' && !X.Sh.open) {
      if (cancelInline()) return true; if (U.q.trim()) { clearSearch(); return true; } closeDock(); return true;
    }
    return prev ? prev(src) : false;
  };
  addEventListener('resize', () => { if (!U.open) return; const w = wide() ? 'dock' : S.desktop ? 'panel' : 'phone'; if (w !== U.kind) { if (U.host === 'dock') { closeDock(false); openPanel({ keep: true }); } else { X.closeSheet(false); U.open = false; setTimeout(() => openPanel({ keep: true }), 0); } } });
}

/* ------------------------------------------------------------------ demo controls */
function resetAll(keepSet) {
  SRC = DATASETS[U.set](); V.shared = U.set === 'demo' ? Object.assign({}, DEMO_VALS) : {}; Y.TG.jb = U.set === 'demo';
  if (U.set === 'stress') { SRC.forEach((s) => walk(s.items, (tg, g) => { const n = Number(tg.key.slice(1)); if (tg.type === 'check' && n % 9 === 0 && /^[pm]/.test(tg.key)) V.shared[tg.key] = true; /* on values only in the prompt and memory sections, so the others start folded (DD-084) */ })); }
  U.favs = []; U.secOpen = {}; U.grpOpen = {}; U.defOpen = null; U.q = ''; U.changedOnly = false; U.undo = null; U.flashed = false;
  Y.CHATS.forEach((c) => { c.tgLocal = null; c.localToggles = false; c.localVals = null; if (c.modules) { c.modules.modA = true; c.modules.modB = true; c.modules.modC = true; } });
}
function setDataset(k) { U.set = k; resetAll(); if (U.open) { const was = U.host; if (was === 'dock') buildPanel($('#tgDock')); else if (panelEl() && X.Sh.open) { const b = $('#sheetRoot .sheet-body'); buildPanel(b); } } renderDemo(); }
const seedFavs = (n) => { const M = model(); reindex(M); const want = ['prompt:length', 'style:p_voice', 'cards:c_note', 'prompt:reply_ko', 'char:x_catch', 'cards:c_show', 'char:x_outfit', 'style:n_detail', 'memory:m_auto', 'prompt:pov', 'cards:c_pos', 'style:n_len']; U.favs = want.filter((id) => IDX.has(id)).slice(0, n); };
function renderDemo() {
  const el = $('#tgDemo'); if (!el) return; $('#tgCtlSum').textContent = tt('dTitle'); const c = cur();
  const btn = (id, ic, label) => `<button type="button" class="btn act" id="${id}">${X.ic(ic, 18)}<span>${esc(label)}</span></button>`;
  const seg = (k, label) => `<button type="button" class="btn" data-set="${k}" aria-pressed="${U.set === k}">${esc(label)}</button>`;
  el.innerHTML = `<h2 class="s2-dh">${esc(tt('dTitle'))}</h2>` + btn('tgdOpen', 'toggle-right', tt('dOpen')) + btn('tgdSheet', 'sliders', tt('dSheet')) +
    `<div class="seg" role="group" aria-label="${esc(tt('dSet'))}">${seg('demo', tt('dSet40'))}${seg('stress', tt('dSet100'))}${seg('empty', tt('dSetNone'))}</div>` +
    `<label class="sw"><input type="checkbox" role="switch" id="tgdScope" ${scopeOn(c) ? 'checked' : ''}><span class="sw-ui"></span><span class="lbl">${esc(tt('dScope'))}</span></label>` +
    btn('tgdFav4', 'star', tt('dFav4')) + btn('tgdFav10', 'star', tt('dFav10')) + btn('tgdFavClear', 'x', tt('dFavClear')) + btn('tgdExpand', 'chevron-down', tt('dExpand')) + btn('tgdCollapse', 'chevron-right', tt('dCollapse')) + btn('tgdPlus', 'plus', tt('dPlus')) + btn('tgdReset', 'rotate-ccw', tt('dReset')) + `<p class="banner">${esc(tt('dStates'))}</p>`;
  const run = (fn) => { if (!S.desktop && S.sbOpen) { X.closeSidebar(); setTimeout(fn, X.durOf('base') + 80); } else fn(); };
  $('#tgdOpen').onclick = () => run(() => openPanel({ opener: $('#moreBtn') })); $('#tgdSheet').onclick = () => run(() => Y.openThisChat());
  $$('[data-set]', el).forEach((b) => (b.onclick = () => setDataset(b.dataset.set)));
  $('#tgdScope').onchange = (e) => { setScope(e.target.checked); renderDemo(); };
  $('#tgdFav4').onclick = () => { seedFavs(4); if (panelEl()) renderList(); }; $('#tgdFav10').onclick = () => { seedFavs(10); if (panelEl()) renderList(); }; $('#tgdFavClear').onclick = () => { U.favs = []; if (panelEl()) renderList(); };
  $('#tgdExpand').onclick = () => { model().forEach((m) => { U.secOpen[m.src.id] = true; walk(m.src.items, () => {}); m.src.items.forEach((it) => { if (it.t === 'group') U.grpOpen[grpKey(m.src, it)] = true; }); }); if (panelEl()) renderList(); };
  $('#tgdCollapse').onclick = () => { model().forEach((m) => { U.secOpen[m.src.id] = false; }); if (panelEl()) renderList(); };
  $('#tgdPlus').onclick = () => run(() => $('#plusBtn').click()); $('#tgdReset').onclick = () => { resetAll(); if (panelEl()) renderList(); renderDemo(); };
}

/* ------------------------------------------------------------------ ?state= */
function expandAll() { model().forEach((m) => { U.secOpen[m.src.id] = true; }); }
const QS = (en, ko) => (S.lang === 'ko' ? ko : en);
async function runStateTg(s) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const open = (o) => openPanel(Object.assign({ keep: true }, o));
  const click = async (sel, ms = 200) => { await wait(ms); const b = $(sel); if (b) b.click(); await wait(150); };
  const localize = () => { const c = cur(); setScope(true); c.tgLocal.length = 0; c.tgLocal.p_voice = 2; c.tgLocal.c_style = 2; c.tgLocal.reply_ko = false; renderList(); };
  switch (s) {
    case 'tg-sheet': Y.openThisChat(); await wait(150); { const r = $('#tgSumRow'); if (r) r.scrollIntoView({ block: 'center' }); } break;
    case 'tg-panel': open(); break;
    case 'tg-collapsed': model().forEach((m) => { U.secOpen[m.src.id] = false; }); open(); break;
    case 'tg-expanded': expandAll(); model().forEach((m) => m.src.items.forEach((it) => { if (it.t === 'group') U.grpOpen[grpKey(m.src, it)] = true; })); open(); break;
    case 'tg-group': U.grpOpen['prompt/Response format'] = true; open(); await wait(80); { const g = $('[data-gk="prompt/Response format"]'); if (g) listEl().scrollTop = Math.max(0, g.offsetTop - 60); } break;
    case 'tg-select': open(); await click('.tg-row[data-key="pov"][data-in="src"] .tg-hit'); break;
    case 'tg-text': open(); await click('.tg-row[data-key="nick"][data-in="src"] .tg-hit'); break;
    case 'tg-textarea': open(); await click('.tg-row[data-key="rules"][data-in="src"] .tg-hit'); break;
    case 'tg-scope-on': open(); await wait(60); localize(); break;
    case 'tg-scope-revert': open(); await wait(60); localize(); await click('.tg-row[data-key="length"][data-in="src"] .tg-more', 150); break;
    case 'tg-scope-undo': open(); await wait(60); setScope(true); setScope(false); break;
    case 'tg-search-label': U.q = QS('length', '길이'); open(); break;
    case 'tg-search-option': U.q = QS('bold', '대담'); open(); break;
    case 'tg-search-chosung': U.q = QS('inner', 'ㅅㅁㅇ'); open(); break;
    case 'tg-search-key': U.q = 'fmt_md'; open(); break;
    case 'tg-search-crumb': U.q = QS('prose', '문체'); open(); break;
    case 'tg-search-expand': U.q = QS('smell', '냄새'); open(); break;
    case 'tg-changed': U.changedOnly = true; open(); break;
    case 'tg-both': U.q = QS('description', '묘사'); U.changedOnly = true; open(); break;
    case 'tg-nomatch': U.q = 'zzzz'; open(); break;
    case 'tg-favs': seedFavs(4); open(); break;
    case 'tg-fav-menu': seedFavs(4); open(); await click('.tg-row[data-in="fav"]:nth-of-type(2) .tg-more', 200); break;
    case 'tg-chips': seedFavs(10); await wait(80); $('#plusBtn').click(); await wait(200); break;
    case 'tg-dup': U.secOpen.memory = true; U.secOpen.prompt = true; open(); await wait(80); { const r = $('.tg-row[data-key="ooc"][data-in="src"]'); if (r) listEl().scrollTop = Math.max(0, r.offsetTop - 120); } break;
    case 'tg-stress': U.set = 'stress'; resetAll(); renderDemo(); open(); break;
    case 'tg-empty': U.set = 'empty'; resetAll(); renderDemo(); open(); break;
    default: break;
  }
}

/* ------------------------------------------------------------------ init */
function init() {
  X = window.__slice1; S = X.S; Y = window.__slice2; S2 = Y.S2; S2H = Y.S2H;
  Object.assign(X.ICONS, ICONS_TG);
  if (!DATASETS[U.set]) U.set = 'demo';
  resetAll();
  const prevLang = S.hooks.lang;
  S.hooks.lang = () => {
    if (prevLang) prevLang();
    renderDemo(); if (U.open && U.host === 'sheet' && !X.Sh.open) { U.open = false; }
    if (U.open && U.host === 'dock') buildPanel($('#tgDock'));
  };
  S.hooks.plus = plusHook;
  installHooks(); installBack(); renderDemo();
  document.title = 'Chat toggles panel · ' + (S.lang === 'ko' ? '목업' : 'mockup');
  window.__tg = { U, V, S: () => SRC, model, totals, getVal, setVal, isChanged, chatOnly, tt, openPanel, closePanel, renderList, setScope, matchBy, IDX: () => IDX, wide, seedFavs, resetAll, setDataset, cur, snapshotShared, defOf, favValid, runStateTg, TGI };
  const q = Q.get('q'); if (q) U.q = q; if (Q.get('changed') === '1') U.changedOnly = true;
  const st = Q.get('state');
  setTimeout(async () => { if (st) { try { await runStateTg(st); } catch (e) { console.error(e); } } setTimeout(() => { window.__tgReady = true; }, 450); }, 260);
}
(function wait() { if (window.__slice1 && window.__slice2 && window.__slice2.S2 && window.__slice2.CHARS) init(); else setTimeout(wait, 20); })();
})();
