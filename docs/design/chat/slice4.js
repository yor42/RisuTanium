/* Chat slice 4 mockup: long chats. Synthetic mockup; not proof of native behaviour or performance (desktop Chrome numbers are indicative only).
   Loads after slice1-3 and extends them through hooks; the bounded message list below replaces slice 1's simple list on this page only.
   Implements docs/design/chat/SLICE4_SPEC.md (draft rev 1, DD-066..DD-071). */
(() => {
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const Q4 = new URLSearchParams(location.search);
let X, S, ST, Y, S2, S2H, Z;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const now = () => performance.now();
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* ------------------------------------------------------------------ copy (SLICE4_SPEC section 13 plus mockup-only keys) */
const S4I = {
en: {
  longChatLine: 'Long chat · {n} messages', chatStart: 'Start of chat · {date}', jumpLatest: 'Jump to latest', newCount: '{n} new', searchInChat: 'Search in chat', searchPlaceholder: 'Search this chat',
  searchPrev: 'Previous match', searchNext: 'Next match', searchFilters: 'Filters', searchAll: 'See all', includeThinking: 'Include thinking', filterSpeaker: 'Speaker', filterHasImage: 'Has image', filterDate: 'Date',
  noResults: 'No messages found', clearFilters: 'Clear filters', hiddenLabel: 'Hidden from the prompt', jumpSheet: 'Go to', jumpFirst: 'First message', jumpNewest: 'Newest message', jumpDate: 'Go to date', jumpNumber: 'Go to message number',
  noTimeSkipped: 'Messages without a date are skipped', goBack: 'Go back', position: 'Message {i} of {n}', scrubberBubble: '{i} / {n} · {date}',
  /* extra */
  navGroup: 'Find in this chat', search: 'Search', go: 'Go', jump: 'Go to', bookmarks: 'Bookmarks', noBookmarks: 'No bookmarks in this chat', closeSearch: 'Close search', matchLabel: 'Match {i} of {n}', matchLabelPartial: 'Match {i} of at least {n}', searching: 'Searching…',
  speakerMe: 'Me', speakerChar: 'Character', speakerAny: 'Anyone', from: 'From', to: 'To', dismiss: 'Dismiss', noDate: 'no date', scrubLabel: 'Position in the chat', newerBelow: 'Newer messages below', filtersOn: 'Filters on',
  dTitle: 'Slice 4 demo controls', dChat: 'Open a chat', dFlingStart: 'Fling to the start', dFlingEnd: 'Fling to the newest', dEditor: 'Open an editor on an old message', dStreamBack: 'Reply streams while scrolled back', dCap: 'Mounted cap', dSearch: 'Search “lantern”', dJump: 'Open the jump sheet', dAnchor: 'Save position, switch chat, come back',
  dLatest: 'Scroll up 3 screens (jump to latest)', dBadge: 'Jump to latest with 3 new replies', dScrub: 'Show the position scrubber', dSlow: 'Slow search (partial counter)', dNone: 'Search with no results', dChip: 'Long jump to the start (Go back chip)',
  dHint: 'Show the long-chat hint again', dSel: 'Select across 4 messages (pinned)', dDraft: 'Editor with a kept draft',
  matchInside: 'The match is inside this message', rMounted: 'Mounted', rNodes: 'DOM nodes', rLong: 'Last long task', rDrift: 'Text moved after correction', rShift: 'Layout shift seen', rSync: 'Slowest list pass', rCost: 'Mock mount cost', rMax: 'max', dReset: 'Reset',
  rNoteCap: 'The cap only binds with ?minmount or ?cap; on a phone screen the overscan decides.', rNoteCost: 'This mock fills a message with innerHTML (about 0.4 to 1.5 ms). The app measured 1.6 to 7.5 ms per message (Report 19): not representative.', rNoteShift: 'Layout shift = how far visible text moved before the list corrected it (an image without a reserved size cannot be corrected).',
  jumpedBack: 'Moved. “Go back” returns to where you were.', readEarlier: 'Read {n} earlier messages', readLater: 'Read {n} later messages', numberError: 'Enter a number from 1 to {n}', bookmarksFirst: 'Showing the first {n}', copyChat: 'Copy chat', copiedChat: 'Copied {n} characters (simulated)', selectedVisible: 'Selected the {n} messages on screen. “Copy chat” copies all.',
  editorCancel: 'Cancel', discardDraft: 'Discard what you wrote?', discardYes: 'Discard', keepEditing: 'Keep editing', draftKept: 'Draft kept', selectionTrim: 'The selection is too long to keep in full', allResults: 'See all',
  sampleMarker: 'lantern', pinnedNote: 'Open editor (pinned)', editorDone: 'Done', editorLabel: 'Edit message',
},
ko: {
  longChatLine: '긴 채팅이에요 · 메시지 {n}개', chatStart: '채팅의 시작 · {date}', jumpLatest: '최신 메시지로', newCount: '새 메시지 {n}', searchInChat: '채팅에서 검색', searchPlaceholder: '이 채팅에서 검색',
  searchPrev: '이전 결과', searchNext: '다음 결과', searchFilters: '필터', searchAll: '모두 보기', includeThinking: '생각 포함', filterSpeaker: '말한 사람', filterHasImage: '이미지 있음', filterDate: '날짜',
  noResults: '검색 결과가 없어요', clearFilters: '필터 지우기', hiddenLabel: '프롬프트에서 숨김', jumpSheet: '이동', jumpFirst: '처음으로', jumpNewest: '최신으로', jumpDate: '날짜로', jumpNumber: '메시지 번호로',
  noTimeSkipped: '날짜 정보가 없는 메시지는 건너뛰어요', goBack: '돌아가기', position: '메시지 {i} / {n}', scrubberBubble: '{i} / {n} · {date}',
  navGroup: '이 채팅에서 찾기', search: '검색', go: '이동', jump: '이동', bookmarks: '북마크', noBookmarks: '이 채팅에는 북마크가 없어요', closeSearch: '검색 닫기', matchLabel: '{n}개 중 {i}번째 결과', matchLabelPartial: '{n}개 이상 중 {i}번째 결과', searching: '검색하는 중…',
  speakerMe: '나', speakerChar: '캐릭터', speakerAny: '모두', from: '시작', to: '끝', dismiss: '닫기', noDate: '날짜 없음', scrubLabel: '채팅 속 위치', newerBelow: '아래에 더 새로운 메시지가 있어요', filtersOn: '필터 사용 중',
  dTitle: '슬라이스 4 데모 컨트롤', dChat: '채팅 열기', dFlingStart: '처음까지 빠르게 스크롤', dFlingEnd: '최신까지 빠르게 스크롤', dEditor: '오래된 메시지에서 편집기 열기', dStreamBack: '위로 스크롤한 채 답변 받기', dCap: '마운트 상한', dSearch: '“lantern” 검색', dJump: '이동 시트 열기', dAnchor: '위치 저장 후 채팅 바꿨다 돌아오기',
  dLatest: '3화면 위로 (최신 메시지로 버튼)', dBadge: '새 답변 3개와 함께 최신으로 버튼', dScrub: '위치 스크롤바 보이기', dSlow: '느린 검색 (부분 개수)', dNone: '결과 없는 검색', dChip: '처음으로 멀리 이동 (돌아가기 칩)',
  dHint: '긴 채팅 안내 다시 보기', dSel: '메시지 4개에 걸쳐 선택 (고정됨)', dDraft: '작성 내용이 남아 있는 편집기',
  matchInside: '일치한 부분이 이 메시지 안에 있어요', rMounted: '마운트된 메시지', rNodes: 'DOM 노드', rLong: '마지막 긴 작업', rDrift: '보정 뒤 글자 이동', rShift: '감지한 레이아웃 이동', rSync: '가장 느린 목록 처리', rCost: '목업 마운트 비용', rMax: '최대', dReset: '처음으로',
  rNoteCap: '상한은 ?minmount나 ?cap을 쓸 때만 걸려요. 폰 화면에서는 오버스캔이 정해요.', rNoteCost: '이 목업은 메시지를 innerHTML로 채워요 (약 0.4~1.5 ms). 앱은 메시지당 1.6~7.5 ms로 측정됐어요 (Report 19). 대표값이 아니에요.', rNoteShift: '레이아웃 이동 = 목록이 보정하기 전에 보이는 글자가 움직인 거리 (크기를 잡아 두지 않은 이미지는 보정할 수 없어요).',
  jumpedBack: '이동했어요. “돌아가기”로 이전 위치로 돌아갈 수 있어요.', readEarlier: '이전 메시지 {n}개 읽기', readLater: '다음 메시지 {n}개 읽기', numberError: '1부터 {n} 사이의 번호를 입력하세요', bookmarksFirst: '처음 {n}개만 보여요', copyChat: '채팅 복사', copiedChat: '{n}자를 복사했어요 (시뮬레이션)', selectedVisible: '화면에 있는 메시지 {n}개를 선택했어요. 전체는 “채팅 복사”로 복사해요.',
  editorCancel: '취소', discardDraft: '작성한 내용을 버릴까요?', discardYes: '버리기', keepEditing: '계속 편집', draftKept: '작성 내용은 그대로 두었어요', selectionTrim: '선택이 너무 길어서 전부는 유지하지 못해요', allResults: '모두 보기',
  sampleMarker: 'lantern', pinnedNote: '편집기가 열려 있어요 (고정됨)', editorDone: '완료', editorLabel: '메시지 편집',
},
};
const t4 = (k, v) => { let s = S4I[S.lang][k] ?? S4I.en[k]; if (s === undefined) return Y.t2(k, v); if (v) for (const x in v) s = s.replaceAll('{' + x + '}', v[x]); return S.lang === 'ko' ? X.josa(s) : s; };
const fmt = (n) => Number(n).toLocaleString(S.lang === 'ko' ? 'ko-KR' : 'en-US');
const fmtDate = (ms) => (ms ? new Date(ms).toLocaleDateString(S.lang === 'ko' ? 'ko-KR' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : t4('noDate'));
const L = (o) => (o && (o[S.lang] || o.en)) || '';

/* ------------------------------------------------------------------ icons (Lucide) */
const ICONS4 = {
  'arrow-down': '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
  'search': '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  'chevron-up': '<path d="m18 15-6-6-6 6"/>', 'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  'sliders-horizontal': '<line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/>',
  'x': '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>', 'list': '<line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/>',
  'corner-up-left': '<polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/>',
  'calendar': '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
  'hash': '<line x1="4" x2="20" y1="9" y2="9"/><line x1="4" x2="20" y1="15" y2="15"/><line x1="10" x2="8" y1="3" y2="21"/><line x1="16" x2="14" y1="3" y2="21"/>',
  'arrow-up-to-line': '<path d="M5 3h14"/><path d="m18 13-6-6-6 6"/><path d="M12 7v14"/>', 'arrow-down-to-line': '<path d="M12 17V3"/><path d="m6 11 6 6 6-6"/><path d="M19 21H5"/>',
  'bookmark': '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>', 'image': '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  'check': '<path d="M20 6 9 17l-5-5"/>', 'pencil': '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
};
const icon = (n, size = 20, cls = '') => (ICONS4[n] ? `<svg class="ic ${cls}" data-icon-size="${size}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS4[n]}</svg>` : Y.ic2(n, size, cls));

/* ------------------------------------------------------------------ synthetic chats: seeded, client-side, deterministic */
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const EW = 'the lantern keeper walked along harbor wall while fog rolled over tide and nobody spoke of lights that went out long ago so she counted stairs again and found a different number each time because the lamp needs oil before dark and the kettle was still warm by stove where stories are told until morning comes with gulls and salt wind over quiet water'.split(' ');
const KW = '등대지기는 안개가 낀 항구의 방파제를 따라 걸었고 아무도 오래전에 꺼진 불빛에 대해 말하지 않았다 그래서 계단을 다시 세어 보았지만 매번 다른 숫자가 나왔다 등불에는 해 지기 전에 기름이 필요하고 주전자는 난로 곁에서 아직 따뜻했다 이야기는 아침이 올 때까지 이어지고 갈매기와 짠 바람이 고요한 물 위를 지나간다'.split(' ');
const SENT_END_EN = ['.', '.', '.', '?', '!', '…']; const SENT_END_KO = ['.', '.', '요.', '다.', '?', '…'];
function sentence(r, W, ko) { const n = 4 + Math.floor(r() * 9); const w = []; for (let i = 0; i < n; i++) w.push(W[Math.floor(r() * W.length)]); let s = w.join(' '); s = s[0].toUpperCase() + s.slice(1); return s + (ko ? SENT_END_KO : SENT_END_EN)[Math.floor(r() * 6)]; }
const CODE = ['```js\nfunction count(stairs) {\n  let n = 0;\n  for (const s of stairs) n += s.worn ? 0 : 1;\n  return n;\n}\n```', '```py\nfor step in range(12):\n    print(step, "creaks" if step == 3 else "holds")\n```', '```\nlamp: oil 40%\ntide: turning\n```'];
const MARKERS = [[97, 'lantern'], [499, 'quasar'], [333, '등불지기']];                // exact words planted at fixed indices: tests count them independently
// one chat: N messages; roles alternate (character first); deterministic from the seed. members: group member ids (cycled) or null.
function generateChat(id, n, seed, members) {
  const r = rng(seed); const msgs = []; const t0 = Date.UTC(2024, 0, 3, 9, 0, 0); let tms = t0; const planted = { lantern: 0, quasar: 0, '등불지기': 0, images: 0, code: 0, html: 0, thinking: 0, hidden: 0, bookmarked: 0, untimed: 0 };
  for (let i = 0; i < n; i++) {
    const role = i % 2 === 0 ? 'char' : 'user'; const u = r(); const nS = u < 0.4 ? 1 : u < 0.75 ? 2 + Math.floor(r() * 2) : u < 0.95 ? 4 + Math.floor(r() * 4) : 10 + Math.floor(r() * 5);
    const para = (ko) => { let out = ''; for (let k = 0; k < nS; k++) { out += sentence(r, ko ? KW : EW, ko) + (k < nS - 1 ? (r() < 0.25 ? '\n\n' : ' ') : ''); } return out; };
    let en = para(false); let ko = para(true);
    MARKERS.forEach(([every, word]) => { if (i % every === 0 && i > 0) { en += ' ' + word; ko += ' ' + word; planted[word]++; } });
    const rr = r();
    if (rr < 0.05) { en += '\n\n{{img::scene' + (i % 7) + '}}'; ko += '\n\n{{img::scene' + (i % 7) + '}}'; planted.images++; }
    else if (rr < 0.11) { const c = CODE[i % 3]; en += '\n\n' + c; ko += '\n\n' + c; planted.code++; }
    else if (rr < 0.14) { const h = '<style>.glow' + i + ' { color: #7fe9ff; }</style>'; en = h + en; ko = h + ko; planted.html++; }
    else if (rr < 0.16) { en = '<Thoughts>' + sentence(r, EW, false) + '</Thoughts>' + en; ko = '<Thoughts>' + sentence(r, KW, true) + '</Thoughts>' + ko; planted.thinking++; }
    tms += Math.round((0.1 + r() * 2.2) * 3600e3);
    const m = { id: 100000 + i, role, alts: [{ en, ko }], idx: 0, bookmarked: false, hidden: false, streaming: false };
    if (role === 'char' && members) m.saying = members[Math.floor(i / 2) % members.length];
    if (r() < 0.9) m.time = tms; else planted.untimed++;
    if (r() < 0.012) { m.bookmarked = true; planted.bookmarked++; }
    if (r() < 0.01) { m.hidden = true; planted.hidden++; }
    msgs.push(m);
  }
  return { msgs, planted, created: t0 };
}

/* ------------------------------------------------------------------ the bounded message list (SLICE4_SPEC section 1, DD-068) */
const W = {
  msgs: null, N: 0, chat: null, H: null, M: null, pre: null, preDirty: true, idIndex: new Map(), mounted: new Map(), body: null, topOff: 0,
  cap: Number(Q4.get('cap')) || 100, minMount: Number(Q4.get('minmount')) || 0, mountMs: 1.2, capLP: 60, pinIds: new Set(), editing: new Set(), hitId: null, keepId: null, cache: null, lk: '', ratio: 1,
  anchor: null, stick: true, fast: false, lastTop: 0, lastT: 0, vel: 0, raf: 0, settleT: 0, deferred: false, ro: null, ours: -1, freeze: false, dragging: false, sc: null,
  stats: { max: 0, maxEver: 0, drift: 0, driftMax: 0, shift: 0, shiftMax: 0, long: 0, longAt: 0, longMax: 0, syncs: 0, syncMax: 0 },
  selIds: null, keepSet: new Set(), drafts: new Map(), obs: null, plainCache: new Map(), act: -1e9, hint: null,
};
const capNow = () => (S.lp ? Math.min(W.capLP, W.cap) : W.cap);
const ovTop = () => (S.lp ? 1 : 1.5); const ovBot = () => 1;
const rootFs = () => Math.round(parseFloat(getComputedStyle(document.documentElement).fontSize) * 10) / 10;
const layoutKey = () => Math.round(W.sc.clientWidth / 20) + '|' + S.lang + '|' + (S.hideNames ? 1 : 0) + '|' + rootFs() + '|' + (document.documentElement.getAttribute('data-theme') || '');          // width bucket, language, hide-names, font size, theme (SPEC section 1)
const textOf = (m) => X.altText(m);
// estimated height from the text, kind and the running correction ratio (replaced by the measured height once a message has been mounted)
function estimate(m) {
  const raw = textOf(m); const ko = S.lang === 'ko'; const k = rootFs() / 16; const wpx = Math.min(W.sc.clientWidth - 24, 72 * 8 * k + 28) - 28; const cpl = Math.max(14, Math.floor(wpx / ((ko ? 15 : 8.2) * k)));
  let lines = 0; const paras = raw.split(/\n{2,}/); for (const p of paras) lines += Math.max(1, Math.ceil(p.replace(/<style>[\s\S]*?<\/style>/g, '').length / cpl));
  let h = 28 + lines * 25.6 * k + (paras.length - 1) * 12 + 36;
  if (raw.includes('{{img::')) h += 200; const fence = raw.match(/```[\s\S]*?```/g); if (fence) fence.forEach((f) => { h += f.split('\n').length * 20 + 20; }); if (raw.includes('<style>')) h += 34; if (raw.includes('<Thoughts>')) h += 40;
  return Math.max(70, h * W.ratio);
}
function rebuild() {
  const oldMsgs = W.msgs;
  W.msgs = S.msgs; W.N = S.msgs.length; W.lk = layoutKey(); const cache = W.cache; W.H = new Float64Array(W.N); W.M = new Uint8Array(W.N); W.idIndex = new Map();
  for (let i = 0; i < W.N; i++) { const m = W.msgs[i]; W.idIndex.set(m.id, i); const c = cache.get(m.id + '|' + W.lk); if (c !== undefined) { W.H[i] = c; W.M[i] = 1; } else W.H[i] = estimate(m); }
  W.preDirty = true;
  if (oldMsgs && oldMsgs !== W.msgs) {                    // the list changed under us (a delete, an undo, a new array): follow the messages by id
    const nm = new Map(); W.mounted.forEach((el, i) => { const j = W.idIndex.get(Number(el.dataset.id)); if (j === undefined) { W.ro.unobserve(el); el.remove(); } else nm.set(j, el); }); W.mounted = nm;
    const mapI = (i) => { const m = oldMsgs[i]; const j = m ? W.idIndex.get(m.id) : undefined; return j === undefined ? clamp(i, 0, Math.max(0, W.N - 1)) : j; };
    if (W.anchor) W.anchor = { i: mapI(W.anchor.i), rel: W.anchor.rel }; if (SR.hits.length) { SR.hits = SR.hits.map((i) => oldMsgs[i]).filter(Boolean).map((m) => W.idIndex.get(m.id)).filter((j) => j !== undefined); SR.cur = clamp(SR.cur, -1, SR.hits.length - 1); }
  }
}
function grow() {                                       // append-only growth (a new reply): no rebuild
  const n = W.msgs.length; const H2 = new Float64Array(n); H2.set(W.H); const M2 = new Uint8Array(n); M2.set(W.M);
  for (let i = W.N; i < n; i++) { W.idIndex.set(W.msgs[i].id, i); H2[i] = estimate(W.msgs[i]); }
  W.H = H2; W.M = M2; W.N = n; W.preDirty = true;
}
function checkMsgs() {
  if (S.msgs !== W.msgs) { rebuild(); return; }
  if (S.msgs.length > W.N && W.idIndex.get(S.msgs[W.N - 1] && S.msgs[W.N - 1].id) === W.N - 1) { grow(); return; }
  if (S.msgs.length !== W.N || layoutKey() !== W.lk) rebuild();
}
function prefix() { if (!W.preDirty) return; const N = W.N; const p = W.pre && W.pre.length === N + 1 ? W.pre : (W.pre = new Float64Array(N + 1)); let s = 0; for (let i = 0; i < N; i++) { p[i] = s; s += W.H[i]; } p[N] = s; W.preDirty = false; }
function indexAt(y) { const p = W.pre; let lo = 0, hi = W.N - 1; if (y <= 0) return 0; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (p[mid] <= y) lo = mid; else hi = mid - 1; } return lo; }
const topOffNow = () => { const r = W.body.getBoundingClientRect(); return r.top - W.sc.getBoundingClientRect().top + W.sc.scrollTop; };
function anchorNow() {
  prefix(); const sc = W.sc; const st = sc.scrollTop; const y = st - W.topOff; const i = indexAt(y); const el = W.mounted.get(i);
  // the real position of a mounted message beats the model (the model lags behind a height change that has not been measured yet)
  return { i, rel: el ? el.getBoundingClientRect().top - sc.getBoundingClientRect().top : W.pre[i] + W.topOff - st };
}
const BOTTOM_PX = 100;                                                  // DD-088: within about 100 px of the end counts as "at the bottom" (new replies are followed; further up they get the jump button and a count)
const nearBottom = () => W.sc.scrollHeight - W.sc.scrollTop - W.sc.clientHeight < BOTTOM_PX;

// messages that must stay mounted: streaming, editors, selection, focus, newest, the shown search hit, the jump target
// the selection's two end messages, remembered while the selection is not collapsed (the browser moves a range whose nodes are removed to the container, so it cannot be read later)
function noteSelection() {
  const sel = getSelection(); if (!sel || !sel.rangeCount || sel.isCollapsed) { W.selIds = null; W.selWarned = false; return; }
  const idOf = (n) => { const e = n && (n.nodeType === 1 ? n : n.parentElement); const mm = e && e.closest && e.closest('.msg'); return mm ? Number(mm.dataset.id) : null; };
  const a = idOf(sel.anchorNode), f = idOf(sel.focusNode); if (a != null || f != null) W.selIds = [a != null ? a : f, f != null ? f : a];
}
function pinnedIdx() {
  const out = new Set(); if (W.N) out.add(W.N - 1);
  if (ST && ST.m && W.idIndex.has(ST.m.id)) out.add(W.idIndex.get(ST.m.id));
  W.editing.forEach((id) => { if (W.idIndex.has(id)) out.add(W.idIndex.get(id)); });
  [W.hitId, W.keepId, ...W.keepSet].forEach((id) => { if (id != null && W.idIndex.has(id)) out.add(W.idIndex.get(id)); });
  const a = document.activeElement; const fm = a && a.closest && a.closest('.msg'); if (fm && W.idIndex.has(Number(fm.dataset.id))) out.add(W.idIndex.get(Number(fm.dataset.id)));
  noteSelection();
  if (W.selIds) { const ia = W.idIndex.get(W.selIds[0]), ib = W.idIndex.get(W.selIds[1]); const ends = [ia, ib].filter((x) => x !== undefined); if (ends.length) { let lo = Math.min(...ends), hi = Math.max(...ends); const room = Math.max(6, capNow() - 24); if (hi - lo + 1 > room) { ends.forEach((x) => out.add(x)); if (!W.selWarned) { W.selWarned = true; X.toast(t4('selectionTrim')); } } else { for (let k = lo; k <= hi; k++) out.add(k); } W.selPin = true; } }
  return out;
}
function measure() {                                    // batch read: heights of everything mounted
  let changed = false;
  W.mounted.forEach((el, i) => { const h = el.getBoundingClientRect().height; if (h > 0 && Math.abs(h - W.H[i]) > 0.02) { const old = W.H[i]; W.H[i] = h; changed = true; if (!W.M[i]) { W.M[i] = 1; const e = estimate(W.msgs[i]) / W.ratio; if (e > 0) W.ratio = clamp(W.ratio * 0.97 + (h / e) * 0.03, 0.5, 2.5); } W.cache.set(W.msgs[i].id + '|' + W.lk, h); } else if (h > 0 && !W.M[i]) { W.M[i] = 1; W.cache.set(W.msgs[i].id + '|' + W.lk, h); } });
  if (changed) W.preDirty = true;
}
function applyCV() {                                    // content-visibility with the cached height as the intrinsic size (never a guess), all but the newest three; fractional sizes (a rounded one makes every skipped message up to 0.5 px off)
  W.mounted.forEach((el, i) => { const cv = i < W.N - 3 && !W.editing.has(W.msgs[i].id) && !(ST.m && ST.m === W.msgs[i]); if (cv) { const v = 'auto ' + Math.max(40, W.H[i] - 20).toFixed(2) + 'px'; if (el.style.containIntrinsicSize !== v) el.style.containIntrinsicSize = v; if (!el.classList.contains('cv')) el.classList.add('cv'); } else if (el.classList.contains('cv')) { el.classList.remove('cv'); el.style.containIntrinsicSize = ''; } });
}
let mountCount = 0;
function mountEl(i) {
  const el = X.renderMsg(W.msgs[i], i); el.classList.add('s4m'); decorate(el, W.msgs[i], i); W.mounted.set(i, el); W.ro.observe(el); mountCount++; return el;
}
// messages that slice 1 put into the list itself (undo of a delete) become part of the mounted set
function adoptStrays() {
  if (!W.body || !W.idIndex) return; const known = new Set(W.mounted.values());
  [...W.body.children].forEach((el) => { if (!el.classList.contains('msg') || known.has(el)) return; const i = W.idIndex.get(Number(el.dataset.id)); if (i === undefined) { el.remove(); return; }
    const old = W.mounted.get(i); if (old && old !== el) { W.ro.unobserve(old); old.remove(); } el.classList.add('s4m'); decorate(el, W.msgs[i], i); W.mounted.set(i, el); W.ro.observe(el); });
}
function unmountEl(i) { const el = W.mounted.get(i); if (!el) return; W.ro.unobserve(el); el.remove(); W.mounted.delete(i); }
// SPEC section 1 (screen readers): a focusable, named stop at each edge of a gap; focusing it mounts the next block and moves focus into it (tabindex -1: not a Tab stop)
function mkSent(dir, edge, count) {
  const b = document.createElement('button'); b.type = 'button'; b.className = 's4-sent'; b.tabIndex = -1; b.dataset.dir = dir; b.dataset.edge = String(edge);
  b.textContent = t4(dir === 'up' ? 'readEarlier' : 'readLater', { n: fmt(Math.min(12, count)) });
  const go = () => readMore(dir, Number(b.dataset.edge)); b.addEventListener('focus', go); b.addEventListener('click', go); return b;
}
function readMore(dir, edge) {
  const js = []; if (dir === 'up') for (let k = edge - 1; k >= Math.max(0, edge - 12); k--) js.push(k); else for (let k = edge + 1; k <= Math.min(W.N - 1, edge + 12); k++) js.push(k);
  if (!js.length) return; js.forEach((k) => W.keepSet.add(W.msgs[k].id)); sync({ budget: 1e9 }); setTimeout(() => js.forEach((k) => W.keepSet.delete(W.msgs[k] && W.msgs[k].id)), 4000);
  const el = W.mounted.get(js[0]); if (el) { X.setActive(el); el.focus(); }
}
function mkPh(a, b) { const d = document.createElement('div'); d.className = 's4-ph'; d.style.height = Math.max(0, W.pre[b] - W.pre[a]) + 'px'; d.dataset.a = a; d.dataset.b = b - 1; d.setAttribute('aria-hidden', 'true'); return d; }

// one pass: decide the mounted set, change the DOM minimally (focus is never lost), measure, restore the anchor
function sync(o = {}) {
  if (!W.msgs || !W.body || !W.body.isConnected) return; const t0 = now();
  checkMsgs(); adoptStrays(); const sc = W.sc; prefix(); W.topOff = topOffNow();
  const wasStick = W.stick && nearBottom() || (W.stick && o.stick);
  const obs0 = W.obs && W.obs.el.isConnected && W.mounted.get(W.obs.i) === W.obs.el ? W.obs : null; let shift0 = 0; if (obs0) { const r = obs0.el.getBoundingClientRect().top - sc.getBoundingClientRect().top; shift0 = r - obs0.rel; if (Math.abs(shift0) > 0.5 && !W.dragging) { W.stats.shift = Math.round(Math.abs(shift0) * 10) / 10; if (W.stats.shift > W.stats.shiftMax) W.stats.shiftMax = W.stats.shift; } }
  measure(); prefix();
  const anchor = o.anchor || W.anchor || anchorNow(); const st = sc.scrollTop; const vh = sc.clientHeight; const N = W.N;
  if (!N) { W.body.replaceChildren(); W.mounted.clear(); return; }
  const yTop = st - W.topOff; const f = indexAt(yTop); const l = indexAt(yTop + vh);
  const lo = indexAt(yTop - ovTop() * vh); const hi = indexAt(yTop + vh + ovBot() * vh);
  const pins = pinnedIdx(); const cap = capNow();
  // priority order: visible top-down, then the overscan nearest first
  const order = []; for (let i = f; i <= l; i++) order.push(i);
  for (let d = 1; d <= Math.max(f - lo, hi - l); d++) { if (l + d <= hi) order.push(l + d); if (f - d >= lo) order.push(f - d); }
  const want = new Set(); pins.forEach((i) => want.add(i));
  for (const i of order) { if (want.size >= cap) break; want.add(i); }
  // test knob (?minmount=100): fill the window up to a count so a phone-sized screen can be checked with a full 100-message window
  if (W.minMount) for (let d = 1; want.size < Math.min(cap, W.minMount) && (f - d >= 0 || l + d < N); d++) { if (f - d >= 0) want.add(f - d); if (want.size < Math.min(cap, W.minMount) && l + d < N) want.add(l + d); }
  // budget: adaptive, about 9 ms of mounting per frame whatever the device (a slow CPU mounts fewer per frame); existing ones stay
  let budget = o.budget === undefined ? (W.fast ? 0 : clamp(Math.floor(9 / Math.max(0.4, W.mountMs)), 2, 14)) : o.budget; let more = false; const final = new Set();
  W.mounted.forEach((el, i) => { if (want.has(i) || pins.has(i)) final.add(i); });
  const fresh = [...want].filter((i) => !W.mounted.has(i) && !pins.has(i)); const pinNew = [...pins].filter((i) => !W.mounted.has(i));
  pinNew.forEach((i) => final.add(i));
  const rank = new Map(order.map((i, k) => [i, k])); fresh.sort((a, b) => (rank.get(a) ?? 1e9) - (rank.get(b) ?? 1e9));
  for (const i of fresh) { if (budget <= 0) { more = true; break; } final.add(i); budget--; }
  if (W.freeze) { more = false; }
  // cap: drop the farthest non-pinned if over
  if (final.size > cap) { const centre = (f + l) / 2; const arr = [...final].filter((i) => !pins.has(i)).sort((a, b) => Math.abs(b - centre) - Math.abs(a - centre)); while (final.size > cap && arr.length) final.delete(arr.shift()); }
  // DOM: unmount, then build placeholders + elements in order without moving the nodes that stay
  W.mounted.forEach((el, i) => { if (!final.has(i)) unmountEl(i); });
  const foreign = []; [...W.body.children].forEach((n) => { if (!n.classList.contains('msg') && !n.classList.contains('s4-ph') && !n.classList.contains('s4-sent')) { let nx = n.nextElementSibling; while (nx && !nx.classList.contains('msg')) nx = nx.nextElementSibling; foreign.push({ n, nid: nx ? Number(nx.dataset.id) : null }); } });      // slice 1's own rows (Generate reply, the undo row) stay where they are
  $$('.s4-ph, .s4-sent', W.body).forEach((p) => p.remove());
  const idx = [...final].sort((a, b) => a - b); let cursor = W.body.firstChild; let prev = 0; const place = (node) => { if (cursor === node) cursor = cursor.nextSibling; else W.body.insertBefore(node, cursor); };
  // placeholders do not exist at this point; mounted elements keep their relative order in the DOM
  const needNew = []; idx.forEach((i) => { if (!W.mounted.has(i)) needNew.push(i); }); const tm = now(); needNew.forEach((i) => mountEl(i)); if (needNew.length && o.budget === undefined) W.mountMs = W.mountMs * 0.6 + ((now() - tm) / needNew.length) * 0.4;
  W.preDirty = true; // heights of the new elements are measured below
  const nodes = []; let next = 0; let prevI = -1;
  for (const i of idx) { if (i > next) { if (prevI >= 0) nodes.push(mkSent('down', prevI, i - next)); nodes.push(mkPh(next, i)); nodes.push(mkSent('up', i, i - next)); } nodes.push(W.mounted.get(i)); next = i + 1; prevI = i; }
  if (next < N) { nodes.push(mkSent('down', prevI, N - next)); nodes.push(mkPh(next, N)); }
  foreign.forEach(({ n, nid }) => { const at = nid == null ? -1 : nodes.findIndex((x) => x.classList.contains('msg') && Number(x.dataset.id) === nid); if (at < 0) nodes.push(n); else nodes.splice(at, 0, n); });
  // minimal diff: keep existing mounted nodes in place (no re-parenting), insert the rest
  for (const n of nodes) place(n);
  while (cursor) { const nx = cursor.nextSibling; cursor.remove(); cursor = nx; }
  measure(); prefix();
  // placeholders were sized from the heights before measuring: resize them now so positions are consistent
  $$('.s4-ph', W.body).forEach((p) => { p.style.height = Math.max(0, W.pre[Number(p.dataset.b) + 1] - W.pre[Number(p.dataset.a)]) + 'px'; });
  W.topOff = topOffNow();
  applyCV(); roving(); refreshStale();
  // restore: bottom stays at the bottom, otherwise the anchor message stays where it was
  if (wasStick || (o.stick)) { W.ours = sc.scrollHeight - sc.clientHeight; sc.scrollTop = W.ours; }
  else if (anchor) { const want2 = W.pre[anchor.i] + W.topOff - anchor.rel; const max = sc.scrollHeight - sc.clientHeight; const v = clamp(want2, 0, max); if (Math.abs(v - sc.scrollTop) > 0.3) { W.ours = v; sc.scrollTop = v; } }
  W.anchor = anchorNow();
  // residual text movement: the text at the top of the screen against where the scroll position puts it, after the correction (px, from the DOM, not from the model)
  if (obs0 && obs0.el.isConnected && !wasStick) { const real = obs0.el.getBoundingClientRect().top - sc.getBoundingClientRect().top; const exp = obs0.rel; const drift = Math.abs(real - exp); W.stats.drift = Math.round(drift * 10) / 10; if (drift > W.stats.driftMax) W.stats.driftMax = W.stats.drift; }
  setObs();
  W.deferred = more; W.stats.syncs++; W.stats.max = W.mounted.size; if (W.mounted.size > W.stats.maxEver) W.stats.maxEver = W.mounted.size; const dt = now() - t0; if (dt > W.stats.syncMax) W.stats.syncMax = dt;
  if (more && !W.fast) schedule(true);
  afterSync();
}
// one roving tab stop among the mounted messages (slice 1 expects exactly one)
function setObs() { const a = W.anchor; const el = a && W.mounted.get(a.i); W.obs = el ? { el, i: a.i, rel: el.getBoundingClientRect().top - W.sc.getBoundingClientRect().top, st: W.sc.scrollTop } : null; }
// messages refreshed lazily (a new reply, a language switch): the ones near the screen at once, the others when they come within 300 px
function refreshStale() {
  let n = 0; const r0 = W.sc.getBoundingClientRect();
  for (const [i, el] of W.mounted) { if (!el._stale) continue; const r = el.getBoundingClientRect(); if (r.bottom > r0.top - 300 && r.top < r0.bottom + 300) { const kb = !el._staleBody; el._stale = false; el._staleBody = false; X.fillMsg(el, W.msgs[i], i, { keepBody: kb || !!W.msgs[i].streaming }); if (++n >= 6) { schedule(); break; } } }
}
function roving() { const els = [...W.mounted.values()]; if (!els.length || els.some((e) => e.tabIndex === 0)) return; const pick = (W.hitId != null && W.mounted.get(W.idIndex.get(W.hitId))) || W.mounted.get(W.N - 1) || els[0]; X.setActive(pick); }
function schedule(forceFill) { if (W.raf) return; W.raf = requestAnimationFrame(() => { W.raf = 0; sync({}); }); }
let latestT = 0; function updateLatestSoon() { if (latestT) return; latestT = requestAnimationFrame(() => { latestT = 0; updateLatest(); updateScrub(); }); }
function afterSync() { updateLatest(); updateScrub(); if (W.hitId != null) highlightHit(); updateReadout(false); }

// ---- scroll handling: anchor from the scroll position, fast-scroll detection (placeholders only, no mounting), settle
function onScrollW() {
  const sc = W.sc; const st = sc.scrollTop; const t = now();
  if (W.ours >= 0 && Math.abs(st - W.ours) < 1.5) { W.ours = -1; return; } W.ours = -1;
  prefix(); W.stick = nearBottom(); S.atBottom = W.stick; W.anchor = anchorNow(); setObs();      // slice 1 ignores scroll events for 150 ms after each programmatic scroll-to-bottom: while a reply streams that is always, so a reader who scrolls away must be noticed here
  const dt = t - W.lastT; if (dt > 0 && W.lastT) { W.vel = Math.abs(st - W.lastTop) / dt; } W.lastTop = st; W.lastT = t;
  W.fast = W.vel > 2.2 || W.dragging; sc.classList.toggle('s4-fast', W.fast); clearTimeout(W.settleT); W.settleT = setTimeout(() => { if (W.dragging || W.freeze) return; W.fast = false; W.vel = 0; sc.classList.remove('s4-fast'); sync({}); }, W.fast ? 110 : 40);
  if (!W.fast) schedule(); else { updateLatest(); updateScrub(); }
  if (now() - (W.act || -1e9) < 2500) { showScrub(); hideHint(); if (W.chipSt != null && Math.abs(st - W.chipSt) > 80) hideBackChip(); }
}
// jumps: load around the target, scroll it to the upper third, align once more after measuring (estimates above never move it)
function scrollToIndex(i, o = {}) {
  checkMsgs(); if (!W.msgs[i]) return; W.obs = null; prefix(); const sc = W.sc; const vh = sc.clientHeight; W.keepId = W.msgs[i].id; W.topOff = topOffNow();
  const frac = o.where === 'top' ? 0.06 : o.where === 'bottom' ? 0.8 : 1 / 3;
  const want = i === 0 ? 0 : W.pre[i] + W.topOff - vh * frac; const max = Math.max(0, W.pre[W.N] + W.topOff + 80 - vh); const v = clamp(want, 0, max); W.ours = v; sc.scrollTop = v; W.stick = false; W.anchor = anchorNow();
  W.obs = null; sync({ budget: 1e9, anchor: W.anchor });
  for (let k = 0; k < (i === 0 ? 0 : 2); k++) { const el = W.mounted.get(i); if (!el) break; const d = el.getBoundingClientRect().top - sc.getBoundingClientRect().top - vh * frac; if (Math.abs(d) < 1.5 || (v === 0 && d < 0)) break; W.ours = sc.scrollTop + d; sc.scrollTop = W.ours; W.anchor = anchorNow(); W.obs = null; sync({ budget: 1e9, anchor: W.anchor }); }
  const kid = W.msgs[i].id; setTimeout(() => { if (W.keepId === kid) W.keepId = null; }, 600);
  W.stick = nearBottom();
}
function scrollToBottom(animated) {
  W.obs = null; const sc = W.sc; checkMsgs(); W.stick = true;
  const go = () => { sync({ stick: true, budget: 1e9 }); sc.scrollTop = sc.scrollHeight; W.stick = true; W.anchor = anchorNow(); sync({ stick: true, budget: 6 }); };
  if (!animated || S.rm || S.lp || W.N < 2) { go(); return Promise.resolve(); }
  prefix(); const dist = sc.scrollHeight - sc.clientHeight - sc.scrollTop; const vh = sc.clientHeight; const travel = 2 * vh;
  if (dist > travel) { const jumpTo = sc.scrollHeight - sc.clientHeight - travel; W.ours = jumpTo; sc.scrollTop = jumpTo; W.stick = false; W.anchor = anchorNow(); W.obs = null; sync({ budget: 1e9, anchor: W.anchor }); }
  const from = sc.scrollTop; const t0 = now(); const dur = 260;
  return new Promise((res) => { const step = () => { const p = clamp((now() - t0) / dur, 0, 1); const e = 1 - Math.pow(1 - p, 3); const target = sc.scrollHeight - sc.clientHeight; const v = from + (target - from) * e; W.ours = v; sc.scrollTop = v; W.anchor = anchorNow(); if (p < 1) { requestAnimationFrame(step); } else { go(); res(); } }; requestAnimationFrame(step); });
}

/* ------------------------------------------------------------------ mounting details: lazy images, thumbnail avatars, hidden label */
const HUES = { warm: ['#ffb38a', '#ffc58f'], blue: ['#8fb7ff', '#587bff'], green: ['#9af0c0', '#3fc39a'], rose: ['#ffb0c4', '#ff6b81'], violet: ['#cdb0ff', '#8a63ff'], gold: ['#ffe08a', '#ffb347'] };
const svgUri = (w, h, body) => 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`);
const sceneUri = (k) => { const c = ['#2a3b8f', '#6a2f7a', '#1f6d6b', '#8a4b2a', '#3a4f9a', '#7a2f4a', '#2f7a4a'][k % 7]; return svgUri(160, 160, `<rect width="160" height="160" fill="${c}"/><circle cx="${40 + k * 12}" cy="56" r="22" fill="#ffd27a"/><path d="M0 130 L50 90 L90 120 L130 80 L160 110 V160 H0Z" fill="#0b0f2e" opacity=".75"/>`); };
const thumbUri = (hue, letter) => { const [a, b] = HUES[hue] || HUES.violet; return svgUri(48, 48, `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="48" height="48" rx="24" fill="url(#g)"/><text x="24" y="31" font-size="22" font-family="sans-serif" font-weight="700" text-anchor="middle" fill="#14153a">${esc(letter)}</text>`); };
function decorate(el, m) {
  if (!el || !m) return;
  const pi = W.idIndex ? W.idIndex.get(m.id) : undefined;
  if (pi !== undefined) { let ps = $('.s4-pos', el); if (!ps) { ps = document.createElement('span'); ps.className = 'sr-only s4-pos'; ps.id = 's4p-' + m.id; el.appendChild(ps); el.setAttribute('aria-labelledby', 'nm-' + m.id + ' ' + ps.id); } ps.textContent = t4('position', { i: fmt(pi + 1), n: fmt(W.N) }); el.setAttribute('aria-posinset', pi + 1); el.setAttribute('aria-setsize', W.N); }
  // inline images: <img loading=lazy decoding=async> with the size reserved (the figure is 160x160), never CSS backgrounds
  $$('figure.img', el).forEach((f, k) => { if (f.querySelector('img')) return; const raw = X.altText(m); const mm = [...raw.matchAll(/\{\{img::scene(\d+)\}\}/g)][k]; const img = document.createElement('img'); img.loading = 'lazy'; img.decoding = 'async'; img.width = 160; img.height = 160; img.alt = ''; img.src = sceneUri(mm ? Number(mm[1]) : k); f.replaceChildren(img); });
  // thumbnail avatars at 2x the displayed size, as <img>
  const av = $('.meta .avatar', el); if (av && m.role === 'char' && !av.querySelector('img')) { const letter = av.textContent || '?'; const hue = (av.className.match(/hue-(\w+)/) || [])[1] || 'warm'; const img = document.createElement('img'); img.className = 's4-av'; img.loading = 'lazy'; img.decoding = 'async'; img.width = 24; img.height = 24; img.alt = ''; img.src = thumbUri(hue, letter); av.textContent = ''; av.appendChild(img); }
  const bd = $('.meta .badges', el); if (bd && m.hidden && !$('.s4-hid', el)) { const s = document.createElement('span'); s.className = 's4-hid'; s.textContent = t4('hiddenLabel'); bd.after(s); }
}

/* ------------------------------------------------------------------ stats / readout (demo panel) */
function updateReadout(force) {
  const t = now(); if (!force && t - (updateReadout.t || 0) < 250) return; updateReadout.t = t; const el = $('#s4Read'); if (!el) return;
  const nodes = ($('#s4Ctl').open || force) ? X.thread().getElementsByTagName('*').length : (updateReadout.n || 0); updateReadout.n = nodes;
  const age = W.stats.longAt ? Math.round((now() - W.stats.longAt) / 1000) : 0;
  el.innerHTML = `<dl class="s4-dl"><dt>${esc(t4('rMounted'))}</dt><dd id="s4rM">${W.mounted.size} / ${capNow()} <small>${esc(t4('rMax'))} ${W.stats.maxEver}</small></dd><dt>${esc(t4('rNodes'))}</dt><dd id="s4rN">${nodes}</dd><dt>${esc(t4('rLong'))}</dt><dd id="s4rL">${W.stats.long ? W.stats.long.toFixed(0) + ' ms <small>' + age + ' s · ' + esc(t4('rMax')) + ' ' + W.stats.longMax.toFixed(0) + '</small>' : '-'}</dd><dt>${esc(t4('rSync'))}</dt><dd id="s4rS">${W.stats.syncMax.toFixed(1)} ms</dd><dt>${esc(t4('rDrift'))}</dt><dd id="s4rD">${W.stats.drift} px <small>${esc(t4('rMax'))} ${W.stats.driftMax}</small></dd><dt>${esc(t4('rShift'))}</dt><dd id="s4rH">${W.stats.shift} px <small>${esc(t4('rMax'))} ${W.stats.shiftMax}</small></dd><dt>${esc(t4('rCost'))}</dt><dd id="s4rC">${W.mountMs.toFixed(1)} ms</dd></dl><p class="s4-rnote">${esc(t4('rNoteCap'))}</p><p class="s4-rnote">${esc(t4('rNoteShift'))}</p><p class="s4-rnote" id="s4rNoteCost">${esc(t4('rNoteCost'))}</p>`;
}
function stats() { return { mounted: W.mounted.size, max: W.stats.maxEver, cap: capNow(), nodes: X.thread().getElementsByTagName('*').length, long: W.stats.long, longMax: W.stats.longMax, drift: W.stats.drift, driftMax: W.stats.driftMax, shift: W.stats.shift, shiftMax: W.stats.shiftMax, mountMs: Math.round(W.mountMs * 100) / 100, syncs: W.stats.syncs, syncMax: Math.round(W.stats.syncMax * 10) / 10, N: W.N, scrollHeight: W.sc.scrollHeight, mountCount }; }
function installObservers() {
  W.ro = new ResizeObserver((entries) => {
    // a stream tick only resizes the streaming message, which is the newest one: update its height and the total, touch nothing else
    if (ST && ST.m && W.msgs && entries.every((e) => { const i = W.idIndex.get(Number(e.target.dataset.id)); return i === W.N - 1; })) { const i = W.N - 1; const el = W.mounted.get(i); if (el) { const h = el.getBoundingClientRect().height; if (h > 0) { W.H[i] = h; W.preDirty = true; } } updateLatestSoon(); return; }
    if (!W.raf && !W.freeze) { W.raf = requestAnimationFrame(() => { W.raf = 0; sync({ budget: 0 }); }); }
  });
  try { new PerformanceObserver((list) => { list.getEntries().forEach((e) => { W.stats.long = e.duration; W.stats.longAt = now(); if (e.duration > W.stats.longMax) W.stats.longMax = e.duration; }); }).observe({ entryTypes: ['longtask'] }); } catch (_) {}
}

/* ------------------------------------------------------------------ transcript hooks */
function installList() {
  document.addEventListener('selectionchange', () => { if (!W.msgs) return; noteSelection(); if (W.selAllEls && !W.selIds) { W.selAllEls.forEach((e) => e.classList.remove('selectable')); W.selAllEls = null; } if (W.selPin && !W.selIds) { W.selPin = false; schedule(); } });
  document.addEventListener('focusout', () => { if (W.msgs) setTimeout(() => { const a = document.activeElement; if (!(a && a.closest && a.closest('.msg'))) schedule(); }, 0); });
  W.sc = X.scroller(); W.sc.addEventListener('scroll', onScrollW, { passive: true });
  ['wheel', 'touchstart', 'touchmove', 'pointerdown', 'keydown'].forEach((ev) => W.sc.addEventListener(ev, () => { W.act = now(); }, { passive: true, capture: true }));          // the scrubber follows the reader's own scrolling, not the list's programmatic jumps
  W.sc.addEventListener('pointermove', (e) => { if (e.pointerType !== 'mouse') return; const r = W.sc.getBoundingClientRect(); if (e.clientX > r.right - 120) showScrub(); }, { passive: true });          // mouse: the scrubber shows while the pointer is near the right edge
  new MutationObserver(() => { if (W.msgs) { sync({ budget: 1e9 }); updateReadout(true); } }).observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });      // low power changes the cap and the overscan
  new MutationObserver(() => { updateScrub(); updateLatest(); if (X.Sh.open) hideHint(); }).observe($('#sheetRoot'), { attributes: true, attributeFilter: ['class', 'hidden'] });       // hidden while any sheet is open
  S.hooks.transcript = (keepScroll) => {
    const th = X.thread(); const head = $('#s4Head'); const c = Y.curChat(); W.sc = X.scroller(); th.replaceChildren(); head.replaceChildren(); W.mounted.clear(); W.editing.clear(); W.hitId = null; W.keepId = null;       // #thread holds only messages, placeholders and slice 1's own rows; the note and the start line sit above it
    const note = document.createElement('p'); note.className = 'note'; note.textContent = X.t('banner'); head.appendChild(note);
    const sl = document.createElement('div'); sl.className = 's4-startline'; sl.id = 's4Start'; head.appendChild(sl); W.body = th;
    W.chat = c; W.cache = (c && (c.hc = c.hc || new Map())) || new Map(); W.msgs = null; rebuild(); W.anchor = null;
    const first = W.msgs[0]; sl.textContent = t4('chatStart', { date: fmtDate(first && first.time ? first.time : (c && c.gen ? (c.gen.created || 0) : 0)) }); sl.setAttribute('role', 'note');
    const l = X.lastMsg(); if (l && l.role === 'user' && !S.streaming) th.appendChild(X.genRow());
    W.newCount = 0; closeSearchQuiet();
    const a = c && c.s4a;
    if (a && !a.bottom && W.idIndex.has(a.id)) { W.stick = false; sync({ budget: 0, anchor: { i: 0, rel: 0 } }); prefix(); W.topOff = topOffNow(); const i = W.idIndex.get(a.id); W.stick = false; W.sc.scrollTop = W.pre[i] + W.topOff - a.rel; W.ours = W.sc.scrollTop; W.anchor = anchorNow(); sync({ budget: 12, anchor: W.anchor }); }
    else { W.stick = true; W.sc.scrollTop = 1e9; sync({ stick: true, budget: 12 }); W.sc.scrollTop = 1e9; }
    S.atBottom = W.stick;       // slice 1's own resize observer pulls to the bottom while this is true
    updateCV4(); showHint(); updateLatest(); updateScrub();
  };
  S.hooks.edit = (m) => { const i = W.idIndex.get(m.id); if (i !== undefined) openEditor(i, { focus: true }); };
  const prevGen = S.hooks.generate; S.hooks.generate = () => { W.preGen = W.stick || nearBottom(); if (prevGen) return prevGen(); };          // slice 1 removes the Generate reply row (about 70 px) before it appends: the reader's distance to the end is taken before that
  S.hooks.append = (m) => { const wasNear = W.preGen != null ? W.preGen : (W.stick || nearBottom()); W.preGen = null; if (m.role === 'char' && !wasNear) { W.newCount++; } sync({ stick: wasNear, budget: 1e9 }); if (wasNear) { W.sc.scrollTop = W.sc.scrollHeight; } };
  S.hooks.mounted = (keepBody) => {
    if (!W.cache || !W.body || !W.body.isConnected) return []; if (S.msgs !== W.msgs || S.msgs.length !== W.N) { checkMsgs(); if (S.msgs !== W.msgs) rebuild(); sync({ budget: 1e9 }); }
    const all = [...W.mounted].map(([i, el]) => ({ m: W.msgs[i], i, el })); if (all.length <= 24) return all;
    // refreshing every mounted message at once (a new reply, a language change) would be a long task with 100 mounted: the ones near the screen now, the rest in small idle chunks
    const r0 = W.sc.getBoundingClientRect(); const near = [], far = [];
    all.forEach((x) => { const r = x.el.getBoundingClientRect(); (r.bottom > r0.top - 300 && r.top < r0.bottom + 300 || x.i >= W.N - 3 || x.m.streaming ? near : far).push(x); });
    far.forEach((x) => { x.el._stale = true; x.el._staleBody = x.el._staleBody || !keepBody; });          // refreshed when they come within 300 px of the screen (refreshStale)
    return near;
  };
  S.hooks.afterFill = (a, m) => { decorate(a, m); if (!a.classList.contains('active')) { if (a.tabIndex !== -1) a.tabIndex = -1; $$('.pins .btn, .cluster .btn, .altrow .btn, .hover-row .btn, pre.code', a).forEach((b) => { if (b.tabIndex !== -1) b.tabIndex = -1; }); } };          // a message that is not the roving tab stop keeps its controls out of the Tab order, however it was (re)filled
  const prevPlan = S.hooks.plan; S.hooks.plan = (m, o) => (W.longReply ? { full: longReplyText(), holds: [] } : prevPlan ? prevPlan(m, o) : null);      // checks stream a 7.5 k-character reply (SLICE4_SPEC section 11) through slice 1's own renderer
  const prevLang = S.hooks.lang; S.hooks.lang = () => { if (prevLang) prevLang(); rebuild(); sync({ budget: 1e9 }); const hadQ = document.activeElement && document.activeElement.id === 's4Q'; const qs = hadQ ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null; renderBars(); if (SR.open && norm(SR.q)) restartSearch(); if (hadQ) { const q = $('#s4Q'); q.focus(); try { q.setSelectionRange(qs[0], qs[1]); } catch (_) {} } showLongLine(); const st = $('#s4Start'); if (st && W.msgs[0]) st.textContent = t4('chatStart', { date: fmtDate(W.msgs[0].time) }); renderDemo4(); };
  const prevTC = S2H.thisChat;                                                 // header ⋮ -> This chat: search in chat and Go to sit right under the chat's name
  S2H.thisChat = (body, c, H) => { if (prevTC) prevTC(body, c, H); if (!W.msgs || Y.curChat() !== c) return; const g = H.grp(body, 'nav', t4('navGroup'), null); H.btnRow(g, 'search', t4('searchInChat'), '', () => { X.closeSheet(); setTimeout(() => openSearch(), X.durOf('base') + 120); }, 's4NavSearch'); H.btnRow(g, 'list', t4('jumpSheet'), '', () => { X.closeSheet(); setTimeout(() => openJump($('#moreBtn')), 320); }, 's4NavJump'); H.btnRow(g, 'copy', t4('copyChat'), '', () => { X.closeSheet(); setTimeout(copyChat, 320); }, 's4NavCopy'); body.insertBefore(g, body.children[1] || null); };
  const prevShow = S2H.show; S2H.show = (c) => { if (prevShow) prevShow(c); if (c.unseen && c.s4a && !c.s4a.bottom && W.chat === c && W.idIndex.has(c.s4a.id)) showBackChip({ i: W.idIndex.get(c.s4a.id), rel: c.s4a.rel, bottom: false }); };      // slice 2 opens at a reply that finished while the reader was away: that is a long jump, so the old position is offered
  S2H.saveAnchor = (c) => { if (c && W.chat === c && W.msgs && W.anchor) { c.s4a = { id: W.msgs[W.anchor.i] ? W.msgs[W.anchor.i].id : null, rel: W.anchor.rel, bottom: W.stick || nearBottom() }; } c.anchor = null; return true; };
  S2H.ensure = (c) => { if (!c.gen) return null; const g = generateChat(c.id, c.gen.n, c.gen.seed, c.gen.members); c.msgs = g.msgs; c.built = g.msgs.length; c.planted = g.planted; c.gen.created = g.created; c.gen.planted = g.planted; return c.msgs; };
  S2H.back = (src) => { const ae = document.activeElement; const ed = ae && ae.closest && ae.closest('.s4-editor'); if (ed && ed._leave) { ed._leave(); return true; } if (!SR.open) return false; if (src === 'Esc' && SR.q) { setQuery(''); $('#s4Q').focus(); } else closeSearch(); return true; };      // Esc clears the query first (SPEC section 4); Back (android, browser, mouse) closes the bar in one step
  const iw = new ResizeObserver(() => { if (W.msgs) { W.sc = X.scroller(); sync({ budget: 1e9 }); } }); iw.observe(X.scroller());
}
const updateCV4 = () => {};
function longReplyText() { const r = rng(7); let out = ''; let k = 0; while (out.length < 7500) { out += sentence(r, S.lang === 'ko' ? KW : EW, S.lang === 'ko') + (r() < 0.2 ? '\n\n' : ' '); if (++k % 25 === 0) out += '\n\n```js\nconst n = ' + k + ';\n```\n\n'; } return out; }
function ensureMounted(i) { if (W.mounted.has(i)) return W.mounted.get(i); W.keepId = W.msgs[i].id; sync({ budget: 1e9 }); setTimeout(() => { W.keepId = null; }, 1500); return W.mounted.get(i); }

/* ------------------------------------------------------------------ jump to latest, long-chat line, scrubber, jump sheet */
function buildBars() {
  const main = $('#main');
  const lt = document.createElement('button'); lt.type = 'button'; lt.className = 'btn s4-latest'; lt.id = 's4Latest'; lt.hidden = true; lt.addEventListener('click', () => { scrollToBottom(true).then(() => { const e = W.mounted.get(W.N - 1); if (e) { X.setActive(e); e.focus({ preventScroll: true }); } }); }); main.insertBefore(lt, X.scroller().nextSibling);
  const ll = document.createElement('div'); ll.className = 's4-long'; ll.id = 's4Long'; ll.hidden = true; ll.setAttribute('role', 'note'); main.appendChild(ll);
  const sc = document.createElement('div'); sc.className = 's4-scrub'; sc.id = 's4Scrub'; sc.setAttribute('aria-hidden', 'true'); sc.innerHTML = '<div class="s4-track"></div><div class="s4-thumb" id="s4Thumb"><span class="s4-grip"></span></div><div class="s4-bubble" id="s4Bubble" hidden></div>'; main.appendChild(sc);
  const bk = document.createElement('button'); bk.type = 'button'; bk.className = 'btn s4-backchip'; bk.id = 's4Back'; bk.hidden = true; main.insertBefore(bk, X.scroller().nextSibling);
  const bar = document.createElement('div'); bar.className = 's4-bar'; bar.id = 's4SBar'; bar.hidden = true; bar.setAttribute('role', 'search'); main.insertBefore(bar, $('#hdr').nextSibling);
  const nr = document.createElement('div'); nr.className = 's4-noresults'; nr.id = 's4None'; nr.hidden = true; nr.setAttribute('role', 'status'); main.appendChild(nr);
  scrubEvents(); renderBars();
}
function renderBars() {
  const lt = $('#s4Latest'); if (lt) { lt.innerHTML = icon('arrow-down', 22) + '<span class="s4-badge" id="s4LBadge" hidden></span>'; updateLatest(); }
  const bk = $('#s4Back'); if (bk) { bk.innerHTML = icon('corner-up-left', 18) + '<span>' + esc(t4('goBack')) + '</span>'; bk.onclick = () => { const p = W.prevPos; hideBackChip(); if (p) gotoAnchor(p); }; }
  renderSearchBar();
}
function updateLatest() {
  const lt = $('#s4Latest'); if (!lt || !W.sc) return; const sc = W.sc; const gap = sc.scrollHeight - sc.scrollTop - sc.clientHeight; const far = W.N > 1 && gap > sc.clientHeight;
  if (gap < BOTTOM_PX && W.newCount) W.newCount = 0;                       // DD-075: replies are counted whenever the reader is not at the bottom; only getting back to the bottom clears the count
  const show = (far || W.newCount > 0) && !X.Sh.open; lt.hidden = !show; const b = $('#s4LBadge'); if (b) { b.hidden = !W.newCount; b.textContent = W.newCount ? (W.newCount > 99 ? '99+' : String(W.newCount)) : ''; }
  const label = t4('jumpLatest') + (W.newCount ? ', ' + t4('newCount', { n: W.newCount }) : ''); lt.setAttribute('aria-label', label); lt.title = label;
}
// DD-072: a transient one-line hint over the top of the transcript: no layout, never pinned, gone on the first scroll by the reader or after about 8 s
function showHint() {
  const el = $('#s4Long'); if (!el) return; clearTimeout(W.hintT); const c = Y.curChat();
  if (!c || W.N <= 2000 || c.s4longDone || SR.open || X.Sh.open) { el.hidden = true; return; }
  c.s4longDone = true; el.textContent = t4('longChatLine', { n: fmt(W.N) }); el.hidden = false; W.hintAt = now(); X.announce(el.textContent); W.hintT = setTimeout(hideHint, 8000);
}
function hideHint() { clearTimeout(W.hintT); const el = $('#s4Long'); if (el) el.hidden = true; }
function showLongLine() { const el = $('#s4Long'); if (el && !el.hidden) el.textContent = t4('longChatLine', { n: fmt(W.N) }); }
// ---- scrubber (by message index, thumb inset 28 dp, touch target is the thumb only)
let scrubT = 0;
function showScrub(ms = 1500) { const el = $('#s4Scrub'); if (!el) return; el.classList.add('on'); clearTimeout(scrubT); scrubT = setTimeout(() => { if (!W.dragging) el.classList.remove('on'); }, ms); }
function updateScrub() {
  const el = $('#s4Scrub'); if (!el || !W.sc || !W.pre) return; const hide = X.Sh.open || W.N < 8; el.hidden = hide; if (hide || W.dragging) return;
  const sc = W.sc; const y = sc.scrollTop - W.topOff; const f = indexAt(y); const l = indexAt(y + sc.clientHeight); const span = Math.max(1, W.N - 1 - (l - f)); const frac = clamp(f / span, 0, 1);
  const track = $('.s4-track', el).getBoundingClientRect(); const th = $('#s4Thumb'); const room = Math.max(0, track.height - X.tokNum('--scrub-thumb-height')); th.style.transform = `translate3d(0,${(frac * room).toFixed(1)}px,0)`; th.dataset.index = String(Math.min(W.N, f + 1)); el.dataset.pos = String(f);
}
function scrubEvents() {
  const el = $('#s4Scrub'); const th = $('#s4Thumb'); const bub = $('#s4Bubble'); let drag = null;
  const idxFor = (clientY) => { const tr = $('.s4-track', el).getBoundingClientRect(); const room = Math.max(1, tr.height - X.tokNum('--scrub-thumb-height')); const frac = clamp((clientY - tr.top - 28) / room, 0, 1); return Math.round(frac * (W.N - 1)); };
  const label = (i) => t4('scrubberBubble', { i: fmt(i + 1), n: fmt(W.N), date: W.msgs[i] && W.msgs[i].time ? fmtDate(W.msgs[i].time) : t4('noDate') });
  const startDrag = (pe) => { drag = { id: pe.id, lastTick: -1 }; press = null; W.dragging = true; W.fast = true; W.sc.classList.add('s4-fast'); el.classList.add('on', 'drag'); bub.hidden = false; el.dataset.dragging = '1'; };
  let press = null;
  th.addEventListener('pointerdown', (e) => { try { th.setPointerCapture(e.pointerId); } catch (_) {} press = { id: e.pointerId, x: e.clientX, y: e.clientY, t: now() }; press.timer = setTimeout(() => { if (press && !drag) startDrag(press); }, 260); });
  th.addEventListener('pointermove', (e) => {
    if (press && !drag && e.pointerId === press.id && Math.abs(e.clientY - press.y) > 6) { clearTimeout(press.timer); startDrag(press); }
    if (!drag || e.pointerId !== drag.id) return; const i = idxFor(e.clientY); prefix(); W.sc.scrollTop = clamp(W.pre[i] + W.topOff, 0, W.sc.scrollHeight - W.sc.clientHeight); W.ours = W.sc.scrollTop; const tr = $('.s4-track', el).getBoundingClientRect(); const frac = i / Math.max(1, W.N - 1); th.style.transform = `translate3d(0,${(frac * Math.max(0, tr.height - X.tokNum('--scrub-thumb-height'))).toFixed(1)}px,0)`; bub.textContent = label(i); bub.style.transform = `translate3d(0,${(frac * Math.max(0, tr.height - X.tokNum('--scrub-thumb-height'))).toFixed(1)}px,0)`; th.dataset.index = String(i + 1);
    const tick = Math.floor(frac * 10); if (tick !== drag.lastTick) { drag.lastTick = tick; try { X.haptic('scrub 10%'); } catch (_) {} } drag.i = i; });
  const end = (e) => {
    if (press && e.pointerId === press.id) { clearTimeout(press.timer); const pr = press; press = null; if (e.type === 'pointerup') { th.style.pointerEvents = 'none'; const under = document.elementFromPoint(pr.x, pr.y); th.style.pointerEvents = ''; if (under && under !== th && under.click) under.click(); } return; }       // a tap on the thumb goes to whatever is under it (a message's action button)
    if (!drag || e.pointerId !== drag.id) return; const i = drag.i; drag = null; W.dragging = false; W.fast = false; W.sc.classList.remove('s4-fast'); el.classList.remove('drag'); bub.hidden = true; delete el.dataset.dragging; if (i !== undefined) scrollToIndex(i, { where: 'top' }); else sync({}); showScrub(); };
  th.addEventListener('pointerup', end); th.addEventListener('pointercancel', end);
  $('.s4-track', el).addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') return; const tr = e.currentTarget.getBoundingClientRect(); const thr = th.getBoundingClientRect(); if (e.clientY > thr.bottom || e.clientY < thr.top) { W.sc.scrollTop += (e.clientY > thr.bottom ? 1 : -1) * W.sc.clientHeight * 0.9; } });
  th.addEventListener('click', (e) => { if (e.detail === 2) openJump(th); });
}
// ---- jump sheet (first, newest, date, number, bookmarks) and the "go back" chip after long jumps
let backT = 0;
function hideBackChip() { clearTimeout(backT); W.chipSt = null; const b = $('#s4Back'); if (b) b.hidden = true; }
function gotoAnchor(p) { W.obs = null; if (p.bottom) { scrollToBottom(false); return; } prefix(); W.topOff = topOffNow(); const i = clamp(p.i, 0, W.N - 1); W.stick = false; W.sc.scrollTop = clamp(W.pre[i] + W.topOff - p.rel, 0, W.sc.scrollHeight); W.ours = W.sc.scrollTop; W.obs = null; sync({ budget: 1e9, anchor: { i, rel: p.rel } }); }
// F-26: the chip is announced, stays until the reader scrolls on or 15 s have passed (longer while hovered or focused), and sits after the transcript in the tab order
function showBackChip(prev) {
  W.prevPos = prev; const b = $('#s4Back'); b.hidden = false; W.chipSt = W.sc.scrollTop; clearTimeout(backT); X.announce(t4('jumpedBack'));
  const arm = () => { backT = setTimeout(() => { if (b.matches(':hover') || b.contains(document.activeElement)) arm(); else hideBackChip(); }, 15000); }; arm();
}
function longJump(run, target) {
  prefix(); const prev = anchorNow(); prev.bottom = W.stick || nearBottom(); const from = prev.i; run();
  const to = target === 'bottom' ? W.N - 1 : target; if (Math.abs(to - from) > 50) showBackChip(prev);
}
function openJump(opener) {
  X.openSheet({ title: t4('jumpSheet'), opener: opener || $('#moreBtn'), cls: S.desktop ? 'panel' : 's2tall', build(body) {
    body.className = 'sheet-body s4-jump'; const N = W.N; const untimed = W.msgs.some((m) => !m.time);
    const go = (fn, target) => { X.closeSheet(); setTimeout(() => { longJump(fn, target); const i = target === 'bottom' ? W.N - 1 : target; const e = W.mounted.get(i); if (e) { X.setActive(e); e.focus({ preventScroll: true }); } }, 40); };
    body.appendChild(X.item('arrow-up-to-line', t4('jumpFirst'), () => go(() => scrollToIndex(0, { where: 'top' }), 0), '', { 'data-autofocus': '' }));
    body.appendChild(X.item('arrow-down-to-line', t4('jumpNewest'), () => go(() => scrollToBottom(false), 'bottom'), ''));
    body.appendChild(X.item('search', t4('searchInChat'), () => { X.closeSheet(); setTimeout(() => openSearch(), X.durOf('base') + 120); }, ''));
    const dr = document.createElement('div'); dr.className = 's4-jrow'; dr.innerHTML = `<label for="s4Date">${esc(t4('jumpDate'))}</label><div class="s4-jin"><input id="s4Date" type="date" data-esc-leave><button type="button" class="btn solid" id="s4DateGo">${esc(t4('go'))}</button></div>${untimed ? `<p class="s4-note">${esc(t4('noTimeSkipped'))}</p>` : ''}`; body.appendChild(dr);
    $('#s4DateGo', dr).addEventListener('click', () => { const v = $('#s4Date', dr).value; if (!v) return; const ms = dayStart(v); const i = W.msgs.findIndex((m) => m.time && m.time >= ms); if (i < 0) { X.toast(t4('noResults')); return; } go(() => scrollToIndex(i, { where: 'third' }), i); });
    const nr = document.createElement('div'); nr.className = 's4-jrow'; nr.innerHTML = `<label for="s4Num">${esc(t4('jumpNumber'))}</label><div class="s4-jin"><input id="s4Num" type="number" min="1" max="${N}" step="1" inputmode="numeric" placeholder="1–${fmt(N)}" data-esc-leave><button type="button" class="btn solid" id="s4NumGo">${esc(t4('go'))}</button></div>`; body.appendChild(nr);
    $('#s4NumGo', nr).addEventListener('click', () => { const inp = $('#s4Num', nr); const v = Number(inp.value); if (inp.value === '' || !Number.isInteger(v) || v < 1 || v > N) { inp.setAttribute('aria-invalid', 'true'); X.toast(t4('numberError', { n: fmt(N) })); return; } inp.removeAttribute('aria-invalid'); go(() => scrollToIndex(v - 1, { where: 'third' }), v - 1); });
    const bm = W.msgs.map((m, i) => (m.bookmarked ? i : -1)).filter((i) => i >= 0); const h = document.createElement('h3'); h.className = 's4-jh'; h.textContent = t4('bookmarks') + ' · ' + bm.length; body.appendChild(h);
    if (!bm.length) { const p = document.createElement('p'); p.className = 's4-note'; p.textContent = t4('noBookmarks'); body.appendChild(p); }
    if (bm.length > 60) { const p = document.createElement('p'); p.className = 's4-note'; p.textContent = t4('bookmarksFirst', { n: 60 }); body.appendChild(p); }
    bm.slice(0, 60).forEach((i) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn s4-bmrow'; b.innerHTML = `${icon('bookmark', 18)}<span class="s4-bmt"><span class="s4-bmn">${esc(t4('position', { i: fmt(i + 1), n: fmt(N) }))}</span><span class="s4-bmx">${esc(snippet(W.msgs[i], 70))}</span></span>`; b.addEventListener('click', () => go(() => scrollToIndex(i, { where: 'third' }), i)); body.appendChild(b); });
  } });
}

/* ------------------------------------------------------------------ in-chat search (SLICE4_SPEC section 4, DD-069) */
const SR = { open: false, q: '', qT: 0, firstT: 0, maxSlice: 0, hits: [], cur: -1, done: true, token: 0, prev: null, scanned: 0, delay: Number(Q4.get('scanms')) || 0, f: { speaker: 'any', image: false, from: '', to: '', thinking: false }, lastMs: 0, firstMs: 0, t0: 0 };
const idle = () => new Promise((res) => (SR.delay ? setTimeout(res, SR.delay) : (window.requestIdleCallback ? requestIdleCallback(() => res(), { timeout: 30 }) : setTimeout(res, 0))));
// ---- what search matches (DD-074): the stored text, cleaned the same way for the query and for the text; no macro or regex-script expansion
const INLINE_TAGS = 'a|b|i|u|s|em|strong|del|ins|mark|small|sub|sup|code|kbd|span|font|abbr|cite|q|time|var|samp|dfn|bdi|bdo|wbr|ruby|rt|rp';
const BLOCK_TAGS = 'p|br|hr|div|ul|ol|li|dl|dt|dd|h[1-6]|blockquote|pre|table|thead|tbody|tfoot|tr|td|th|img|figure|figcaption|details|summary|center|section|article|aside|header|footer|nav|label|button|input|textarea|select|option|audio|video|source|iframe|link|caption|col|colgroup|fieldset|legend|form|picture|svg|path|g|rect|circle|line';
const INLINE_RE = new RegExp('</?(?:' + INLINE_TAGS + ')(?:\\s[^<>]*)?/?>', 'gi');
const BLOCK_RE = new RegExp('</?(?:' + BLOCK_TAGS + ')(?:\\s[^<>]*)?/?>', 'gi');
const ENTITY = { amp: '&', lt: '<', gt: '>', quot: '"', nbsp: ' ', '#39': String.fromCharCode(39) };
function norm(raw, thinking) {
  let s = String(raw == null ? '' : raw);
  s = thinking ? s.replace(/<\/?Thoughts>/gi, ' ') : s.replace(/<Thoughts>[\s\S]*?<\/Thoughts>/gi, ' ');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/\{\{(?:img|inlay|asset|video)::[^}]*\}\}/gi, ' ')
    .replace(INLINE_RE, '').replace(BLOCK_RE, ' ')                                   // only known tags: "Array<string>" and "a < b and c > d" stay as written
    .replace(/^[ \t]*(`{3,}|~{3,}).*$/gm, ' ').replace(/`/g, '')                      // code fences and inline code marks
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')                                          // [text](url) and ![alt](url): the text only, never the address (N-02)
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '').replace(/^[ \t]{0,3}>+[ \t]?/gm, '')   // heading and quote markers at a line start (so "c#" and "a > b" stay)
    .replace(/\*+/g, '').replace(/~~/g, '').replace(/(^|[\s(\[])_+(?=\S)/g, '$1').replace(/(\S)_+(?=$|[\s)\].,!?;:])/g, '$1')   // emphasis marks only; "snake_case" stays
    .replace(/&(amp|lt|gt|quot|nbsp|#39);/g, (m, k) => ENTITY[k]);
  return s.replace(/\s+/g, ' ').trim().normalize('NFC').toLowerCase();
}
function plain(m) {
  const a = m.alts[m.idx]; const raw = a ? (a[S.lang] || a.en) : ''; const k = S.lang + (SR.f.thinking ? 1 : 0); const c = W.plainCache.get(m.id);
  if (c && c.k === k && c.r === raw) return c.t;
  const t = norm(raw, SR.f.thinking); if (W.plainCache.size > 3000) { let n = 0; for (const key of W.plainCache.keys()) { W.plainCache.delete(key); if (++n > 600) break; } }
  W.plainCache.set(m.id, { k, r: raw, t }); return t;
}
const dayStart = (v) => { const [y, mo, d] = String(v).split('-').map(Number); return new Date(y, mo - 1, d).getTime(); };         // a date the user picked is a local day (the same days the messages are shown with)
const dayEnd = (v) => { const [y, mo, d] = String(v).split('-').map(Number); return new Date(y, mo - 1, d + 1).getTime(); };
function passes(m) {
  const f = SR.f; if (f.speaker === 'me' && m.role !== 'user') return false; if (f.speaker === 'char' && m.role !== 'char') return false; if (f.speaker !== 'any' && f.speaker !== 'me' && f.speaker !== 'char' && m.saying !== f.speaker) return false;
  if (f.image && !X.altText(m).includes('{{img::')) return false;
  if (f.from || f.to) { if (!m.time) return false; if (f.from && m.time < dayStart(f.from)) return false; if (f.to && m.time >= dayEnd(f.to)) return false; }
  return true;
}
const filtersOn = () => SR.f.speaker !== 'any' || SR.f.image || SR.f.from || SR.f.to || SR.f.thinking;
async function scan(token) {
  const q = norm(SR.q); if (!q) return; const chunk = S.lp ? 250 : 500; SR.done = false; SR.t0 = now(); SR.firstMs = 0; SR.maxSlice = 0; let i = W.N - 1;
  while (i >= 0) {
    if (token !== SR.token) return; const tS = now(); let n = 0;
    while (i >= 0 && n < chunk) { const m = W.msgs[i]; if (passes(m) && plain(m).includes(q)) SR.hits.push(i); i--; n++; if ((n & 15) === 0 && now() - tS > 8) break; }          // a slice is at most 500 (250 low power) messages and about 8 ms
    if (n > SR.maxSlice) SR.maxSlice = n; SR.scanned = W.N - 1 - i;
    if (SR.hits.length && SR.cur < 0 && !SR.firstT) {                                // the first hit is shown once the reader has paused typing (about 150 ms), not on every keystroke
      SR.firstT = setTimeout(() => { SR.firstT = 0; if (token === SR.token && SR.hits.length && SR.cur < 0) { SR.cur = 0; SR.firstMs = now() - SR.t0; showHit(0); } }, Math.max(0, 150 - (now() - SR.qT)));
    }
    updateCounter(); await idle();
  }
  if (token !== SR.token) return; SR.done = true; SR.lastMs = now() - SR.t0; if (!SR.hits.length) SR.firstMs = 0; updateCounter();
}
function setQuery(v) { SR.q = v; SR.qT = now(); clearTimeout(SR.firstT); SR.firstT = 0; const inp = $('#s4Q'); if (inp && inp.value !== v) inp.value = v; SR.token++; SR.hits = []; SR.cur = -1; SR.done = !norm(v); SR.scanned = 0; clearMarks(); W.hitId = null; updateCounter(); if (norm(v)) scan(SR.token); }
function restartSearch() { setQuery(SR.q); }
function countText() { const n = SR.hits.length; if (!norm(SR.q)) return ''; if (!n) return SR.done ? '0' : '…'; return (SR.cur < 0 ? '…' : SR.cur + 1) + ' / ' + fmt(n) + (SR.done ? '' : '+'); }
function updateCounter() {
  const c = $('#s4Cnt'); if (!c) return; const txt = countText(); c.textContent = txt; const n = SR.hits.length; const row2 = $('#s4Row2'); if (row2) row2.hidden = !txt;
  c.setAttribute('aria-label', !txt ? '' : n ? (SR.done ? t4('matchLabel', { i: Math.max(1, SR.cur + 1), n }) : t4('matchLabelPartial', { i: Math.max(1, SR.cur + 1), n })) : t4('noResults'));
  const all = $('#s4All'); if (all) all.setAttribute('aria-disabled', n ? 'false' : 'true');
  const none = $('#s4None'); if (none) { const show = SR.open && norm(SR.q) && SR.done && !n; none.hidden = !show; if (show) { none.innerHTML = `<p>${esc(t4('noResults'))}${filtersOn() ? ' · ' + esc(filterSummary()) : ''}</p>` + (filtersOn() ? `<button type="button" class="btn solid" id="s4NoClear">${esc(t4('clearFilters'))}</button>` : ''); const b = $('#s4NoClear'); if (b) b.onclick = () => { clearFilters(); }; } }
  const fb = $('#s4Filt'); if (fb) fb.classList.toggle('on', filtersOn());
}
function filterSummary() { const p = []; const f = SR.f; if (f.speaker !== 'any') p.push(speakerName(f.speaker)); if (f.image) p.push(t4('filterHasImage')); if (f.from || f.to) p.push((f.from || '…') + ' – ' + (f.to || '…')); if (f.thinking) p.push(t4('includeThinking')); return p.join(', '); }
function speakerName(id) { if (id === 'me') return t4('speakerMe'); if (id === 'char') return t4('speakerChar'); return window.__slice3 && window.__slice3.MEM[id] ? L(window.__slice3.MEM[id].name) : id; }
function clearFilters() { SR.f = { speaker: 'any', image: false, from: '', to: '', thinking: false }; restartSearch(); const s = $('#sheetRoot .s4-filters'); if (s) buildFilters(s); }
function showHit(k) {
  if (k < 0 || k >= SR.hits.length) return; SR.cur = k; const i = SR.hits[k]; if (!SR.prev) { prefix(); SR.prev = anchorNow(); SR.prev.bottom = W.stick || nearBottom(); }
  W.hitId = W.msgs[i].id; scrollToIndex(i); highlightHit(true); alignMark(i); updateCounter(); X.announce(t4('matchLabel', { i: k + 1, n: SR.hits.length }));
}
const nextHit = (d) => { if (!SR.hits.length) return; let k = SR.cur + d; if (k >= SR.hits.length) k = SR.done ? 0 : SR.hits.length - 1; if (k < 0) k = SR.hits.length - 1; showHit(k); };
function clearMarks() {
  $$('.s4-hitmsg').forEach((e) => e.classList.remove('s4-hitmsg')); $$('.s4-hitnote').forEach((e) => e.remove());
  $$('mark.s4-mark').forEach((m) => { const p = m.parentNode; if (!p) return; p.replaceChild(document.createTextNode(m.textContent), m); p.normalize(); });
  if (W.opened) { W.opened.forEach((d) => { d.open = false; }); W.opened = null; }
}
// highlight by text offsets across nodes: the rendered text is collapsed the way norm() collapses whitespace, so a match that spans inline markup ("a **bold** word") is marked in every node it touches
function highlightHit(force) {
  if (W.hitId == null || !norm(SR.q)) return; const i = W.idIndex.get(W.hitId); const el = W.mounted.get(i); if (!el) return; if (!force && $('mark.s4-mark', el)) return;
  clearMarks(); const q = norm(SR.q); const body = $('.reply-body', el); if (!body) return;
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT); let str = ''; const map = []; let lastSpace = true;
  while (walker.nextNode()) { const n = walker.currentNode; if (n.nodeType === 1) { if (/^(BR|P|DIV|LI|UL|OL|H[1-6]|PRE|BLOCKQUOTE|TR|SUMMARY|FIGURE)$/.test(n.tagName) && !lastSpace) { str += ' '; map.push(null, 0); lastSpace = true; } continue; } if (n.parentElement && n.parentElement.closest('style,script')) continue; const d = n.nodeValue; for (let k = 0; k < d.length; k++) { let ch = d[k]; if (/\s/.test(ch)) { if (lastSpace) continue; ch = ' '; lastSpace = true; } else lastSpace = false; const lc = ch.toLowerCase(); str += lc.length === 1 ? lc : ch; map.push(n, k); } }
  const segs = []; let at = str.indexOf(q); while (at >= 0) { let s0 = at; const e0 = at + q.length - 1; while (s0 <= e0) { const node = map[s0 * 2]; if (!node) { s0++; continue; } let e1 = s0; while (e1 + 1 <= e0 && map[(e1 + 1) * 2] === node) e1++; segs.push({ node, a: map[s0 * 2 + 1], b: map[e1 * 2 + 1] + 1 }); s0 = e1 + 1; } at = str.indexOf(q, at + q.length); }
  const byNode = new Map(); segs.forEach((g) => { if (!byNode.has(g.node)) byNode.set(g.node, []); byNode.get(g.node).push(g); });
  byNode.forEach((list, node) => { list.sort((x, y) => y.a - x.a).forEach((g) => { try { const r = document.createRange(); r.setStart(node, g.a); r.setEnd(node, g.b); const mk = document.createElement('mark'); mk.className = 's4-mark'; r.surroundContents(mk); } catch (_) {} }); });
  if (!$('mark.s4-mark', el)) { el.classList.add('s4-hitmsg'); if (!$('.s4-hitnote', el)) { const nt = document.createElement('div'); nt.className = 's4-hitnote'; nt.setAttribute('role', 'note'); nt.textContent = t4('matchInside'); body.before(nt); } X.announce(t4('matchInside')); return; }          // DD-087: the cleaned text and the rendered text differ here; outline the message and say the match is inside it
  $$('mark.s4-mark', el).forEach((mk) => { const d = mk.closest('details'); if (d && !d.open) { d.open = true; (W.opened = W.opened || []).push(d); } });      // a hit inside the collapsed thinking block opens it while the hit is shown
}
// the match, not the top of the message, goes to the upper third when the message is tall or the match is not on screen (SPEC section 4)
function alignMark(i) {
  const el = W.mounted.get(i); const mk = el && $('mark.s4-mark', el); if (!mk) return; const sc = W.sc; const r0 = sc.getBoundingClientRect(); const vh = r0.height; const mr = mk.getBoundingClientRect(); const er = el.getBoundingClientRect();
  const inView = mr.top >= r0.top + 56 && mr.bottom <= r0.bottom - 8; if (er.height <= vh * 0.6 && inView) return;
  const d = mr.top - r0.top - vh / 3; if (Math.abs(d) < 2) return; W.obs = null; const v = clamp(sc.scrollTop + d, 0, sc.scrollHeight - sc.clientHeight); W.ours = v; sc.scrollTop = v; W.stick = false; W.anchor = anchorNow(); W.obs = null; sync({ budget: 1e9, anchor: W.anchor });
}
function openSearch(prefill) {
  if (SR.open) { $('#s4Q').focus(); return; } hideHint(); const fa = document.activeElement; SR.openerId = fa && fa.classList && fa.classList.contains('msg') ? Number(fa.dataset.id) : null; SR.openerBox = !!(fa && fa.id === 'input'); SR.open = true; $('#main').classList.add('s4-searching'); const bar = $('#s4SBar'); bar.hidden = false; $('#hdr').setAttribute('inert', ''); $('#s4Q').focus(); if (prefill) { setQuery(prefill); } updateCounter();
}
// DD-073: closing keeps the reader where they are; "Go back" offers the position from before the search
function closeSearch(keepPos) {
  if (!SR.open) return; const prev = SR.prev; SR.open = false; SR.token++; clearTimeout(SR.firstT); SR.firstT = 0; SR.hits = []; SR.cur = -1; SR.done = true; SR.q = ''; SR.prev = null; clearMarks(); W.hitId = null; const inp = $('#s4Q'); if (inp) inp.value = ''; $('#s4SBar').hidden = true; $('#s4None').hidden = true; $('#main').classList.remove('s4-searching'); $('#hdr').removeAttribute('inert');
  const oe = SR.openerId != null && W.mounted.get(W.idIndex.get(SR.openerId)); SR.openerId = null; const mb = $('#moreBtn'); const ob = SR.openerBox; SR.openerBox = false; if (ob) $('#input').focus({ preventScroll: true }); else if (oe) { X.setActive(oe); oe.focus({ preventScroll: true }); } else if (mb && !mb.disabled) mb.focus({ preventScroll: true });
  sync({ budget: 1e9 }); if (prev && !keepPos) { prefix(); const cur = anchorNow(); if (Math.abs(cur.i - prev.i) > 50 || (prev.bottom && !nearBottom())) showBackChip(prev); }
}
function closeSearchQuiet() { if (!SR.open && !SR.hits.length) return; SR.open = false; SR.token++; clearTimeout(SR.firstT); SR.firstT = 0; SR.hits = []; SR.cur = -1; SR.q = ''; SR.prev = null; W.hitId = null; const inp = $('#s4Q'); if (inp) inp.value = ''; const b = $('#s4SBar'); if (b) b.hidden = true; const n = $('#s4None'); if (n) n.hidden = true; $('#main').classList.remove('s4-searching'); $('#hdr').removeAttribute('inert'); }
function renderSearchBar() {
  const bar = $('#s4SBar'); if (!bar) return; const val = SR.q;
  bar.innerHTML = `<div class="s4-brow"><span class="s4-sic" aria-hidden="true">${icon('search', 18)}</span><input id="s4Q" type="search" autocomplete="off" spellcheck="false" placeholder="${esc(t4('searchPlaceholder'))}" aria-label="${esc(t4('searchInChat'))}" value="${esc(val)}">` +
    `<button type="button" class="btn s4-sb" id="s4Prev" aria-label="${esc(t4('searchPrev'))}" title="${esc(t4('searchPrev'))}">${icon('chevron-up', 20)}</button><button type="button" class="btn s4-sb" id="s4Next" aria-label="${esc(t4('searchNext'))}" title="${esc(t4('searchNext'))}">${icon('chevron-down', 20)}</button>` +
    `<button type="button" class="btn s4-sb${filtersOn() ? ' on' : ''}" id="s4Filt" aria-label="${esc(t4('searchFilters'))}" title="${esc(t4('searchFilters'))}" aria-haspopup="dialog">${icon('sliders-horizontal', 20)}</button><button type="button" class="btn s4-sb" id="s4SClose" aria-label="${esc(t4('closeSearch'))}" title="${esc(t4('closeSearch'))}">${icon('x', 20)}</button></div>` +
    `<div class="s4-brow2" id="s4Row2" hidden><span class="s4-cnt" id="s4Cnt" role="status" aria-live="off"></span><button type="button" class="btn s4-all" id="s4All">${icon('list', 16)}<span>${esc(t4('searchAll'))}</span></button></div>`;
  const inp = $('#s4Q', bar); inp.addEventListener('input', () => setQuery(inp.value));
  inp.addEventListener('keydown', (e) => { if (e.isComposing || e.keyCode === 229) return; if (e.key === 'Enter') { e.preventDefault(); if (!SR.hits.length) { setQuery(inp.value); return; } nextHit(e.shiftKey ? -1 : 1); } });          // an IME's own Enter (composition commit) is not "next"
  $('#s4Prev', bar).onclick = () => nextHit(-1); $('#s4Next', bar).onclick = () => nextHit(1); $('#s4SClose', bar).onclick = () => closeSearch(); $('#s4Filt', bar).onclick = (e) => openFilters(e.currentTarget); $('#s4All', bar).onclick = (e) => { if (SR.hits.length) openResults(e.currentTarget); };
  updateCounter();
}
function snippet(m, len) { const t = plain(m); const q = SR.open ? norm(SR.q) : ''; let at = q ? t.indexOf(q) : 0; if (at < 0) at = 0; const a = Math.max(0, at - 24); let s = t.slice(a, a + len + 24).replace(/\s+/g, ' ').trim(); return (a > 0 ? '… ' : '') + s; }
function snippetHtml(m, len) { const s = snippet(m, len); const q = norm(SR.q); if (!q) return esc(s); const low = s.toLowerCase(); let out = ''; let from = 0; let at = low.indexOf(q); while (at >= 0) { out += esc(s.slice(from, at)) + '<mark class="s4-mark">' + esc(s.slice(at, at + q.length)) + '</mark>'; from = at + q.length; at = low.indexOf(q, from); } return out + esc(s.slice(from)); }
function whoOf(m) { if (m.role === 'user') return X.personaName ? X.personaName() : t4('speakerMe'); const g = window.__slice3 && window.__slice3.cg(); if (g && m.saying) return g.g.st[m.saying] && g.g.st[m.saying].missing ? Y.t2('missingMember') : (window.__slice3.MEM[m.saying] ? L(window.__slice3.MEM[m.saying].name) : m.saying); return X.t('charName'); }
function openResults(opener) {
  if (!SR.hits.length) return; const ROW = 78;
  X.openSheet({ title: t4('searchAll') + ' · ' + SR.hits.length + (SR.done ? '' : '+'), opener, cls: S.desktop ? 'panel' : 's2tall', build(body) {
    body.className = 'sheet-body s4-results'; const list = document.createElement('div'); list.className = 's4-rl'; list.setAttribute('role', 'list'); list.setAttribute('aria-label', t4('searchAll')); const spacer = document.createElement('div'); spacer.className = 's4-rsp'; list.appendChild(spacer); body.appendChild(list);
    const paint = () => { const top = list.scrollTop; const vh = list.clientHeight || 400; const a = Math.max(0, Math.floor(top / ROW) - 3); const b = Math.min(SR.hits.length, Math.ceil((top + vh) / ROW) + 3); spacer.style.height = SR.hits.length * ROW + 'px'; $$('.s4-rrow', list).forEach((r) => r.remove());
      for (let k = a; k < b; k++) { const m = W.msgs[SR.hits[k]]; const r = document.createElement('button'); r.type = 'button'; r.className = 'btn s4-rrow'; r.setAttribute('role', 'listitem'); r.style.transform = `translate3d(0,${k * ROW}px,0)`; r.dataset.k = k;
        r.innerHTML = `<span class="avatar ${m.role === 'user' ? 'user' : 'hue-warm'}" aria-hidden="true">${esc([...whoOf(m)][0])}</span><span class="s4-rt"><span class="s4-rh"><b>${esc(whoOf(m))}</b><small>${esc(m.time ? fmtDate(m.time) : t4('noDate'))}${m.hidden ? ' · ' + esc(t4('hiddenLabel')) : ''}</small></span><span class="s4-rs">${snippetHtml(m, 110)}</span></span>`; r.addEventListener('click', () => { X.closeSheet(); setTimeout(() => showHit(k), 40); }); list.appendChild(r); } };
    list.addEventListener('scroll', paint); setTimeout(paint, 0); new ResizeObserver(paint).observe(list);
  } });
}
function buildFilters(body) {
  body.replaceChildren(); body.className = 'sheet-body s4-filters'; const c = Y.curChat(); const g = window.__slice3 && window.__slice3.groupOf(c);
  const sp = document.createElement('div'); sp.className = 's4-frow'; sp.innerHTML = `<div class="s4-fl" id="s4FSp">${esc(t4('filterSpeaker'))}</div><div class="s4-seg" role="radiogroup" aria-labelledby="s4FSp"></div>`; body.appendChild(sp);
  const opts = [['any', t4('speakerAny')], ['me', t4('speakerMe')], ['char', t4('speakerChar')]]; if (g) g.members.filter((id) => !g.st[id].missing).forEach((id) => opts.push([id, speakerName(id)]));
  opts.forEach(([v, lab]) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn'; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(SR.f.speaker === v)); b.dataset.v = v; b.textContent = lab; b.addEventListener('click', () => { SR.f.speaker = v; restartSearch(); buildFilters(body); const f = $(`[data-v="${v}"]`, body); if (f) f.focus(); }); $('.s4-seg', sp).appendChild(b); });
  const sw = (key, label) => { const l = document.createElement('label'); l.className = 'sw'; l.innerHTML = `<input type="checkbox" role="switch" ${SR.f[key] ? 'checked' : ''} data-k="${key}"><span class="sw-ui"></span><span class="lbl">${esc(label)}</span>`; $('input', l).addEventListener('change', (e) => { SR.f[key] = e.target.checked; restartSearch(); updateCounter(); }); body.appendChild(l); };
  sw('image', t4('filterHasImage')); sw('thinking', t4('includeThinking'));
  const dr = document.createElement('div'); dr.className = 's4-frow'; dr.innerHTML = `<div class="s4-fl">${esc(t4('filterDate'))}</div><div class="s4-jin"><label>${esc(t4('from'))} <input type="date" id="s4DFrom" value="${esc(SR.f.from)}" data-esc-leave></label><label>${esc(t4('to'))} <input type="date" id="s4DTo" value="${esc(SR.f.to)}" data-esc-leave></label></div>`; body.appendChild(dr);
  $('#s4DFrom', dr).addEventListener('change', (e) => { SR.f.from = e.target.value; restartSearch(); }); $('#s4DTo', dr).addEventListener('change', (e) => { SR.f.to = e.target.value; restartSearch(); });
  const cl = X.item('x', t4('clearFilters'), () => clearFilters(), ''); cl.id = 's4FClear'; body.appendChild(cl);
}
function openFilters(opener) { X.openSheet({ title: t4('searchFilters'), opener, build: buildFilters }); }

/* ------------------------------------------------------------------ demo panel, helpers for states and checks */
async function fling(toStart, o = {}) {
  const sc = W.sc; const vh = sc.clientHeight; const target = toStart ? 0 : sc.scrollHeight - vh; const step = o.frames ? Math.max(vh * 0.9, sc.scrollHeight / o.frames) : (o.step || 0.9) * vh; let frames = 0;
  return new Promise((res) => { const run = () => { const cur = sc.scrollTop; const next = toStart ? Math.max(0, cur - step) : Math.min(sc.scrollHeight - vh, cur + step); sc.scrollTop = next; frames++; if (o.maxFrames && frames >= o.maxFrames) { res(frames); return; } if (next === (toStart ? 0 : sc.scrollHeight - vh) && (toStart ? next <= 0 : sc.scrollHeight - vh - next < 2)) { setTimeout(() => res(frames), 160); return; } requestAnimationFrame(run); }; requestAnimationFrame(run); });
}
function draftKey(m) { const c = Y.curChat(); return (c ? c.id : '') + ':' + m.id; }
function openEditor(i, o = {}) {
  const el = ensureMounted(i); if (!el) return null; const m = W.msgs[i]; W.editing.add(m.id); let box = $('.s4-editor', el);
  if (!box) {
    box = document.createElement('div'); box.className = 's4-editor';
    box.innerHTML = `<label class="s4-fl" for="s4Ed${m.id}">${esc(t4('editorLabel'))}</label><textarea id="s4Ed${m.id}" rows="4" data-esc-leave></textarea><div class="s4-edrow"><span class="s4-note">${esc(t4('pinnedNote'))}</span><span class="s4-edbtns"><button type="button" class="btn" data-a="cancel">${icon('x', 16)}<span>${esc(t4('editorCancel'))}</span></button><button type="button" class="btn solid" data-a="done">${icon('check', 16)}<span>${esc(t4('editorDone'))}</span></button></span></div>`;
    $('.reply-body', el).after(box); const ta = $('textarea', box); const orig = X.altText(m); const key = draftKey(m); ta.value = o.draft !== undefined ? o.draft : (W.drafts.has(key) ? W.drafts.get(key) : orig);
    ta.addEventListener('input', () => W.drafts.set(key, ta.value));
    const back = () => { const k = W.idIndex.get(m.id); const e = W.mounted.get(k); if (e) { X.setActive(e); e.focus({ preventScroll: true }); } };
    const close = (apply) => { W.editing.delete(m.id); W.drafts.delete(key); box.remove(); if (apply) { const a = m.alts[m.idx]; a[S.lang] = ta.value; W.preDirty = true; const k = W.idIndex.get(m.id); const e = W.mounted.get(k); if (e) X.fillMsg(e, m, k); } back(); sync({ budget: 0 }); };
    $('[data-a=done]', box).addEventListener('click', () => close(true));
    $('[data-a=cancel]', box).addEventListener('click', (e) => {
      if (ta.value === orig) { close(false); return; }
      X.openSheet({ title: t4('discardDraft'), opener: e.currentTarget, build(body) { body.appendChild(X.item('x', t4('discardYes'), () => { X.closeSheet(false); close(false); }, 'danger', { 'data-drops-data': '' })); const k = X.item('pencil', t4('keepEditing'), () => { X.closeSheet(); }, '', { 'data-autofocus': '' }); body.appendChild(k); } });
    });
    box._leave = () => { W.drafts.set(key, ta.value); back(); X.announce(t4('draftKept')); };        // Esc / Back: the draft stays, focus leaves the box (DD-048)
    box._done = close;
  }
  if (o.focus) $('textarea', box).focus({ preventScroll: true });
  return box;
}
function selectAcross() { const i = Math.max(0, Math.floor(W.N * 0.4)); scrollToIndex(i, { where: 'top' }); const els = [0, 1, 2, 3].map((k) => W.mounted.get(i + k)).filter(Boolean); if (els.length < 2) return; els.forEach((e) => e.classList.add('selectable')); W.selAllEls = els; const a = $('.reply-body', els[0]), z = $('.reply-body', els[els.length - 1]); const r = document.createRange(); r.setStart(a, 0); r.setEnd(z, z.childNodes.length); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); noteSelection(); }
function draftState() { const i = Math.floor(W.N * 0.3); scrollToIndex(i, { where: 'top' }); const box = openEditor(i, { focus: true, draft: 'my carefully written edit' }); if (box) { box.querySelector('textarea').dispatchEvent(new Event('input', { bubbles: true })); box._leave(); } }
function streamBack() { prefix(); const mid = Math.floor(W.N * 0.4); scrollToIndex(mid); setTimeout(() => { S.atBottom = false; X.generateNew(); }, 300); }
function chatBtns() { return [['c-s1k', '1,000'], ['c-s5k', '5,000'], ['c-s20k', '20,000'], ['c-sgrp', S.lang === 'ko' ? '그룹 3,000' : 'Group 3,000']]; }
function renderDemo4() {
  const el = $('#s4Demo'); if (!el) return; $('#s4CtlSum').textContent = t4('dTitle'); const away = () => { if (!S.desktop && S.sbOpen) X.closeSidebar(); };
  const ACTS = [
    ['d4Start', 'arrow-up-to-line', 'dFlingStart', () => { away(); fling(true, { frames: 150 }); }], ['d4End', 'arrow-down-to-line', 'dFlingEnd', () => { away(); fling(false, { frames: 150 }); }],
    ['d4Latest', 'arrow-down', 'dLatest', () => { away(); W.sc.scrollTop = Math.max(0, W.sc.scrollTop - 3 * W.sc.clientHeight); }], ['d4Badge', 'arrow-down', 'dBadge', () => { away(); W.sc.scrollTop = Math.max(0, W.sc.scrollTop - 3 * W.sc.clientHeight); W.newCount = 3; setTimeout(updateLatest, 250); }],
    ['d4Scrub', 'list', 'dScrub', () => { away(); W.sc.scrollTop = W.sc.scrollTop - W.sc.clientHeight * 6; showScrub(8000); }], ['d4Editor', 'pencil', 'dEditor', () => { away(); openEditor(Math.floor(W.N * 0.25)); }],
    ['d4Stream', 'arrow-down', 'dStreamBack', () => { away(); streamBack(); }], ['d4Search', 'search', 'dSearch', () => { away(); openSearch('lantern'); }],
    ['d4Slow', 'search', 'dSlow', () => { away(); SR.delay = 700; openSearch('lantern'); }], ['d4None', 'search', 'dNone', () => { away(); openSearch('zzzzqq'); }],
    ['d4Jump', 'list', 'dJump', () => { away(); setTimeout(() => openJump($('#moreBtn')), 300); }], ['d4Chip', 'corner-up-left', 'dChip', () => { away(); longJump(() => scrollToIndex(0, { where: 'top' }), 0); }],
    ['d4Hint', 'list', 'dHint', () => { away(); const c = Y.curChat(); if (c) c.s4longDone = false; showHint(); }], ['d4Sel', 'pencil', 'dSel', () => { away(); selectAcross(); }], ['d4Draft', 'pencil', 'dDraft', () => { away(); draftState(); }],
    ['d4Anchor', 'corner-up-left', 'dAnchor', () => { const c = Y.curChat(); const id = c.id; away(); scrollToIndex(Math.floor(W.N * 0.4)); setTimeout(() => { Y.openChat('c-s1k' === id ? 'c-s5k' : 'c-s1k', { force: true }); setTimeout(() => Y.openChat(id, { force: true }), 700); }, 400); }],
  ];
  el.innerHTML = `<h2 class="s2-dh">${esc(t4('dTitle'))}</h2><div class="s4-read" id="s4Read" role="status" aria-live="off"></div><div class="s4-chats" role="group" aria-label="${esc(t4('dChat'))}">${chatBtns().map(([id, l]) => `<button type="button" class="btn act s4-cb" data-chat="${id}">${esc(l)}</button>`).join('')}</div>` +
    ACTS.map(([id, ico, label]) => `<button type="button" class="btn act" id="${id}">${icon(ico, 18)}<span>${esc(t4(label))}</span></button>`).join('') +
    `<label class="s3-speedl">${esc(t4('dCap'))}<select id="d4Cap" data-esc-leave>${[100, 60, 20, 12].map((v) => `<option value="${v}" ${W.cap === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label><button type="button" class="btn act" id="d4Reset">${icon('x', 18)}<span>${esc(t4('dReset'))}</span></button>`;
  $$('.s4-cb', el).forEach((b) => b.addEventListener('click', () => { openLong(b.dataset.chat); }));
  ACTS.forEach(([id, , , fn]) => { $('#' + id).onclick = fn; });
  $('#d4Cap').onchange = (e) => { W.cap = Number(e.target.value); sync({ budget: 1e9 }); }; $('#d4Reset').onclick = () => location.reload();
  updateReadout(true);
}
function openLong(id) { if (!S.desktop && S.sbOpen) X.closeSidebar(); Y.openChat(id, { force: true }); }

/* ------------------------------------------------------------------ keyboard (Ctrl+F, Ctrl+G, End) and message-to-message arrows across the mount edge */
const isField = (el) => !!el && (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || (el.tagName === 'INPUT' && /^(text|search|number|date|)$/.test(el.type)) || el.isContentEditable);
// Ctrl+A in the transcript selects what is on screen (mounted), says so, and "Copy chat" copies everything
function selectVisible() {
  const els = [...W.mounted.keys()].sort((a, b) => a - b).map((i) => W.mounted.get(i)); if (!els.length) return; const a = $('.reply-body', els[0]), z = $('.reply-body', els[els.length - 1]); if (!a || !z) return;
  els.forEach((e) => e.classList.add('selectable')); W.selAllEls = els;          // slice 1 keeps message text unselectable until "Select text"; Ctrl+A turns it on for what is on screen and the selection ends it
  const r = document.createRange(); r.setStart(a, 0); r.setEnd(z, z.childNodes.length); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); noteSelection(); X.toast(t4('selectedVisible', { n: els.length }));
}
function chatText() { return W.msgs.map((m) => (m.role === 'user' ? t4('speakerMe') : whoOf(m)) + ': ' + plain(m)).join('\n'); }
function copyChat() { const n = chatText().length; X.toast(t4('copiedChat', { n: fmt(n) })); return n; }
function installKeys4() {
  addEventListener('keydown', (e) => {
    const tg = e.target; const inChat = !isField(tg) && !X.Sh.open && !S2.home && (!S.desktop ? !S.sbOpen : true);
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === 'f' || e.key === 'F')) { if (isField(tg) && tg.id !== 's4Q' && tg.id !== 'input') return; if (X.Sh.open || S2.home) return; e.preventDefault(); openSearch(); return; }          // DD-076: the message box too; other fields keep the browser's find
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === 'g' || e.key === 'G')) { if (isField(tg) || X.Sh.open || S2.home) return; e.preventDefault(); openJump(document.activeElement && document.activeElement !== document.body ? document.activeElement : $('#moreBtn')); return; }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === 'a' || e.key === 'A') && tg.closest && tg.closest('#scroller') && !isField(tg) && inChat) { e.preventDefault(); selectVisible(); return; }
    if ((e.key === 'End') && !e.altKey && !e.shiftKey && tg.closest && tg.closest('#scroller') && !isField(tg) && inChat) { e.preventDefault(); scrollToBottom(true).then(() => { const n = W.mounted.get(W.N - 1); if (n) { X.setActive(n); n.focus({ preventScroll: true }); } }); return; }
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && tg.classList && tg.classList.contains('msg') && !e.altKey && !e.ctrlKey) {   // keyboard reading past the mounted range mounts the next block first
      const i = W.idIndex.get(Number(tg.dataset.id)); const j = i + (e.key === 'ArrowDown' ? 1 : -1); if (j >= 0 && j < W.N && !W.mounted.has(j)) ensureMounted(j);
    }
  }, true);
}

/* ------------------------------------------------------------------ data, states, start */
function setupData4() {
  const CH = Y.CHARS; const CT = Y.CATS || Y.CHATS; if (CH.find((c) => c.id === 'longs')) return;
  CH.push({ id: 'longs', name: { en: 'Long archive', ko: '긴 기록' }, hue: 'blue' });
  const defs = [['c-s1k', 'One thousand messages', '메시지 1,000개', 1000, 11, 3], ['c-s5k', 'Five thousand messages', '메시지 5,000개', 5000, 22, 2], ['c-s20k', 'Twenty thousand messages', '메시지 20,000개', 20000, 33, 1]];
  defs.forEach(([id, en, ko, n, seed, age]) => { const c = Y.mk('longs', { id, name: { en, ko }, age, base: n, last: { en: '…', ko: '…' }, msgs: null, built: 0, seen: true, persona: 0 }); c.gen = { n, seed }; CT.push(c); });
  const g = Y.mk('trio', { id: 'c-sgrp', name: { en: 'Group, three thousand messages', ko: '그룹, 메시지 3,000개' }, age: 4, base: 3000, last: { en: '…', ko: '…' }, msgs: null, built: 0, seen: true, persona: 2 }); g.g = { queue: [], notice: null, skips: [] }; g.gen = { n: 3000, seed: 44, members: ['sera', 'juno', 'mira'] }; CT.push(g);
  Y.S2.recent = ['longs', ...Y.S2.recent.filter((x) => x !== 'longs')].slice(0, 5);
}
const CHATMAP = { '1k': 'c-s1k', '5k': 'c-s5k', '20k': 'c-s20k', group: 'c-sgrp' };
function runState4(s) {
  const open = (id, fn, wait = 700) => { Y.openChat(id, { force: true }); setTimeout(fn, wait); };
  const c5 = (fn, w) => open('c-s5k', fn, w); const c20 = (fn, w) => open('c-s20k', fn, w);
  switch (s) {
    case 's4-open': return c5(() => {});
    case 's4-open-1k': return open('c-s1k', () => {}); case 's4-open-20k': return c20(() => {}); case 's4-group': return open('c-sgrp', () => {});
    case 's4-anchor': return c5(() => { scrollToIndex(Math.floor(W.N * 0.4)); setTimeout(() => { Y.openChat('c-s1k', { force: true }); setTimeout(() => Y.openChat('c-s5k', { force: true }), 700); }, 400); }, 600);
    case 's4-fling': return c20(() => { W.freeze = true; W.fast = true; W.sc.classList.add('s4-fast'); W.sc.scrollTop = W.sc.scrollHeight * 0.5; showScrub(); }, 600);
    case 's4-start': return c20(() => scrollToIndex(0, { where: 'top' }), 600);
    case 's4-latest': return c5(() => { W.sc.scrollTop = Math.max(0, W.sc.scrollTop - 3 * W.sc.clientHeight); }, 600);
    case 's4-latest-badge': return c5(() => { W.sc.scrollTop = Math.max(0, W.sc.scrollTop - 3 * W.sc.clientHeight); W.newCount = 3; setTimeout(updateLatest, 200); }, 600);
    case 's4-longline': return c20(() => {});
    case 's4-search-typing': return c20(() => { SR.delay = 600; openSearch(); const i = $('#s4Q'); i.value = 'quasar'; setQuery('quasar'); }, 600);
    case 's4-search-partial': return c20(() => { SR.delay = 900; openSearch(); setQuery('lantern'); }, 600);
    case 's4-search-hit': return c20(() => { openSearch(); setQuery('quasar'); }, 600);
    case 's4-search-step': return c20(() => { openSearch(); setQuery('quasar'); setTimeout(() => { nextHit(1); nextHit(1); }, 900); }, 600);
    case 's4-search-results': return c20(() => { openSearch(); setQuery('quasar'); setTimeout(() => openResults($('#s4All')), 1200); }, 600);
    case 's4-search-filters': return c20(() => { openSearch(); setQuery('quasar'); setTimeout(() => openFilters($('#s4Filt')), 700); }, 600);
    case 's4-search-none': return c20(() => { openSearch(); setQuery('zzzzqq'); }, 600);
    case 's4-search-none-filters': return c20(() => { SR.f.image = true; openSearch(); setQuery('zzzzqq'); }, 600);
    case 's4-scrub': return c20(() => { W.sc.scrollTop = W.sc.scrollHeight * 0.4; showScrub(20000); }, 600);
    case 's4-scrub-drag': return c20(() => { W.sc.scrollTop = W.sc.scrollHeight * 0.4; const sc = $('#s4Scrub'); sc.classList.add('on', 'drag'); const b = $('#s4Bubble'); b.hidden = false; const i = Math.floor(W.N * 0.62); b.textContent = t4('scrubberBubble', { i: fmt(i + 1), n: fmt(W.N), date: fmtDate(W.msgs[i].time) }); const tr = $('.s4-track').getBoundingClientRect(); const y = 0.62 * Math.max(0, tr.height - X.tokNum('--scrub-thumb-height')); $('#s4Thumb').style.transform = `translate3d(0,${y}px,0)`; b.style.transform = `translate3d(0,${y}px,0)`; W.dragging = true; }, 600);
    case 's4-jump': return c20(() => openJump($('#moreBtn')), 600);
    case 's4-jump-date': return c20(() => { openJump($('#moreBtn')); setTimeout(() => { $('#s4Date').value = '2024-06-01'; }, 500); }, 600);
    case 's4-jump-number': return c20(() => { openJump($('#moreBtn')); setTimeout(() => { $('#s4Num').value = '12345'; }, 500); }, 600);
    case 's4-backchip': return c20(() => longJump(() => scrollToIndex(0, { where: 'top' }), 0), 600);
    case 's4-selection': return c5(() => selectAcross(), 600);
    case 's4-editor-draft': return c5(() => draftState(), 600);
    case 's4-editor': return c5(() => { const i = Math.floor(W.N * 0.25); openEditor(i); }, 600);
    case 's4-editor-far': return c5(() => { openEditor(Math.floor(W.N * 0.25)); setTimeout(() => scrollToBottom(false), 400); }, 600);
    case 's4-stream-back': return c5(() => streamBack(), 600);
    default: return undefined;
  }
}
function init4() {
  X = window.__slice1; S = X.S; ST = X.ST; Y = window.__slice2; S2 = Y.S2; S2H = Y.S2H; Z = window.__slice3;
  document.title = 'Chat slice 4 · mockup'; $('#app').classList.add('s4');
  Object.keys(ICONS4).forEach((k) => { if (!X.ICONS[k]) X.ICONS[k] = ICONS4[k]; }); setupData4(); installObservers(); installList(); buildBars(); installKeys4(); renderDemo4();
  const st = Q4.get('state'); const chat = CHATMAP[Q4.get('chat')] || (st && /^s4-(group)$/.test(st) ? 'c-sgrp' : 'c-s5k');
  if (!st || !/^s4-/.test(st)) { Y.openChat(chat, { force: true }); }
  Y.refreshList(); Y.renderSidebar();
  if (st && /^s4-/.test(st)) setTimeout(() => runState4(st), 150);
  setInterval(() => updateReadout(false), 500);
  window.__slice4 = { W, SR, stats, sync, scrollToIndex, scrollToBottom, openSearch, closeSearch, setQuery, nextHit, showHit, openJump, openEditor, fling, ensureMounted, indexAt, prefix, anchorNow, gotoAnchor, longJump, plain, passes, generateChat, updateScrub, showScrub, openResults, openFilters, t4, S4I, streamBack, openLong, snippet, MARKERS, BOTTOM_PX, updateReadout, fmtDate, longReplyText, estimate, textOf, pinnedIdx, whoOf, capNow, norm, showBackChip, hideBackChip, selectVisible, readMore, dayStart, copyChat, chatText, noteSelection, alignMark, showHint, hideHint, highlightHit };
}
(function wait() { if (window.__slice3 && window.__slice2 && window.__slice2.S2 && window.__slice2.CHARS && window.__slice1) init4(); else setTimeout(wait, 20); })();
})();
