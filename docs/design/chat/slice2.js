(() => {
'use strict';
/* Chat slice 2 mockup. Synthetic mockup; not proof of native behaviour or performance.
   Builds on slice1.js (loaded first, shared untouched except for small hooks): sidebar gesture, sheets, undo row, motion tokens, KO register.
   Implements docs/design/chat/SLICE2_SPEC.md (do not redesign). */
const pre = { escHome: null };
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const Q2 = new URLSearchParams(location.search);
const S2H = (window.__s2hooks = window.__s2hooks || {});          // slice 3 extension points (none set on this page = slice 2 behaviour)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let X, S, I18N, t, esc, ic;     // filled in start() once slice 1 has initialised

/* ------------------------------------------------------------------ copy (SLICE2_SPEC section 6 keys plus mockup-only keys) */
const S2I = {
en: {
  searchPlaceholder: 'Search characters or chats', allCharacters: 'All characters', newChat: 'New chat', importChat: 'Import chat', exportAll: 'Export all chats', chatMenu: 'Chat menu',
  sortRecent: 'Recent', sortManual: 'My order', sortLabel: 'Sort', editOrder: 'Edit order', doneOrder: 'Done',
  statusGenerating: 'Writing a reply', statusNewReply: 'New reply', statusFailed: 'Reply failed', statusDraft: 'Unsent draft',
  loadingChat: 'Loading the chat…', loadFailed: "Couldn't load the chat", retry: 'Try again', backToPrevious: 'Back to previous chat',
  stripWriting: '{chat} — writing a reply', stripDone: '{chat} — reply finished', stripFailed: "{chat} — couldn't write the reply", stripAutoStopped: '{chat} — auto mode stopped',
  view: 'View', stopBg: 'Stop', dismiss: 'Dismiss', sendBlocked: 'A reply is being written in another chat',
  deleteChatConfirm: 'Delete "{chat}" and its {n} messages?', stopAndDeleteChat: 'Stop and delete', deleteChat: 'Delete chat', deleteChatTitle: 'Delete chat',
  thisChat: 'This chat', scopeThisChat: 'This chat only', scopeCharacter: 'All chats of this character', scopeAll: 'All chats',
  useDefaultPersona: 'Use the default persona', authorNote: 'Author’s note', saved: 'Saved', chatStats: '{n} messages · last {time} · created {date}',
  fallbackPrompt: 'A reply is being written', stopAndGo: 'Stop and switch', wait: 'Wait',
  grpChars: 'Characters', grpThisCharChats: 'Chats of this character', grpOtherChats: 'Chats of other characters', noResults: 'No results', resultsCount: '{n} results',
  noChats: 'This character has no chats yet', rename: 'Rename', moveToFolder: 'Move to folder', noFolder: 'No folder', duplicate: 'Duplicate', exportChat: 'Export', folderN: '{name} ({n})',
  folderOpen: 'Expand folder', folderClose: 'Collapse folder', recentChars: 'Recent characters', current: 'Current', renameLabel: 'Chat name', cancel2: 'Cancel',
  home: 'Home', settings: 'Settings', homeTitle: 'Home', continueStory: 'Continue your story', continueItem: 'Continue', homeNote: 'Home is designed in MAIN_MENU.md; this is a placeholder that shows the Back target.', library: 'Library (placeholder)',
  justNow: 'just now', minAgo: '{n} min ago', hourAgo: '{n} h ago', yesterday: 'Yesterday', msgsN: '{n} messages',
  persona: 'Persona', modules: 'Modules', manageModules: 'Manage modules', lorebook: 'Chat lorebook', entriesN: '{n} entries', openLorebook: 'Open lorebook', bookmarks: 'Bookmarks', noBookmarks: 'No bookmarks yet',
  branches: 'Branches', viewBranches: 'View branches', reading: 'Reading', thisCharGroup: 'This character', memory: 'Memory', memoryType: 'Memory: {name}', viewMemory: 'View memory', openCharSettings: 'Open character settings',
  allChatsGroup: 'All chats', jailbreak: 'Jailbreak', affectsAll: 'Changes affect every chat', fullSettings: 'All settings', pluginsGroup: 'Plugins', manage: 'Manage', toggles: 'Toggles',
  toggleScopeLabel: 'Set separately for this chat', stripAutoSoon: 'auto mode stops after this', stripWritingShort: 'writing', autoStoppedShort: 'auto mode stopped', stripFailedN: '{n} replies failed, view', chatOpened: 'Opened {chat}', resultsShown: 'Showing {shown} of {n} results', savedChar: 'Saved for this character', savedAll: 'Saved for all chats', togglesDiscarded: 'This chat’s own toggle values were discarded', toggleNoteAll: 'Changes affect every chat of this character', jumpTo: 'Jump to message', back: 'Back', placeholder: '(placeholder)',
  demoTitle: 'Slice 2 demo controls', dBgStart: 'Start a reply in “Harbor night”', dBgFail: 'Background replies fail', dCold: 'Simulate cold load (1.5 s)', dLoadFail: 'Chat load fails', dFallback: 'Fallback prompt instead of background', dPlugins: 'Chat plugin menu items', dAuto: 'Auto mode on in this chat', dSugg: 'Reply suggestions', dSound: 'Sound / TTS on', dBack: 'Android Back (simulated)', dBigChar: 'Open the 1,000-chat character', dReset: 'Reset slice 2 data',
  backStack: 'Back stack: {s}', chatLayer: 'chat', homeLayer: 'home', sheetLayer: 'sheet', searchLayer: 'search text', sidebarLayer: 'sidebar',
  sugg1: 'Ask about the harbour', sugg2: 'Tell me more', autoStopNote: 'Auto mode stops after its current turn when the chat leaves the screen.',
  errDetail: 'The reply could not be written (demo error: the provider timed out). You can try again.', newEmptyChat: 'New chat', emptyChat: 'This chat is empty. Say something to begin.',
  imp: 'Imported (simulated)', exp: 'Exported (simulated)', dupDone: 'Duplicated', renamed: 'Renamed', moved: 'Moved', deletedChat: 'Chat deleted', noActive: 'Nothing is open',
  modA: 'Narration style', modB: 'Memory helper', modC: 'Scene cards', tgNarr: 'Narration mode', tgTone: 'Tone', tgNick: 'Nickname', tgCap: 'Toggles come from the character’s definitions.', toneSoft: 'Soft', toneBold: 'Bold', toneDry: 'Dry',
  plugA: 'Word statistics', plugB: 'Export summary', exportThis: 'Export this chat', cloneThis: 'Duplicate this chat', deleteThisChat: 'Delete this chat', settingsPh: 'Settings (placeholder)',
},
ko: {
  searchPlaceholder: '캐릭터나 채팅 검색', allCharacters: '모든 캐릭터', newChat: '새 채팅', importChat: '채팅 가져오기', exportAll: '모든 채팅 내보내기', chatMenu: '채팅 메뉴',
  sortRecent: '최근', sortManual: '내 순서', sortLabel: '정렬', editOrder: '순서 편집', doneOrder: '완료',
  statusGenerating: '답변 생성 중', statusNewReply: '새 답변 있음', statusFailed: '답변 실패', statusDraft: '임시 저장 있음',
  loadingChat: '채팅 불러오는 중…', loadFailed: '채팅을 불러오지 못했어요', retry: '다시 시도', backToPrevious: '이전 채팅으로',
  stripWriting: '{chat} — 답변을 쓰는 중이에요', stripDone: '{chat} — 답변을 다 썼어요', stripFailed: '{chat} — 답변을 쓰지 못했어요', stripAutoStopped: '{chat} — 자동 진행을 멈췄어요',
  view: '보기', stopBg: '중지', dismiss: '닫기', sendBlocked: '다른 채팅에서 답변을 쓰는 중이에요',
  deleteChatConfirm: '“{chat}” 채팅과 메시지 {n}개를 삭제할까요?', stopAndDeleteChat: '중지하고 삭제', deleteChat: '채팅 삭제', deleteChatTitle: '채팅 삭제',
  thisChat: '이 채팅', scopeThisChat: '이 채팅에만 적용', scopeCharacter: '이 캐릭터의 모든 채팅', scopeAll: '모든 채팅에 적용',
  useDefaultPersona: '기본 페르소나 사용', authorNote: '작가 노트', saved: '저장됨', chatStats: '메시지 {n}개 · 마지막 {time} · 만든 날 {date}',
  fallbackPrompt: '답변을 쓰는 중이에요', stopAndGo: '중지하고 이동', wait: '기다리기',
  grpChars: '캐릭터', grpThisCharChats: '이 캐릭터의 채팅', grpOtherChats: '다른 캐릭터의 채팅', noResults: '결과가 없어요', resultsCount: '검색 결과 {n}개',
  noChats: '이 캐릭터에는 아직 채팅이 없어요', rename: '이름 바꾸기', moveToFolder: '폴더로 이동', noFolder: '폴더 없음', duplicate: '복제', exportChat: '내보내기', folderN: '{name} ({n})',
  folderOpen: '폴더 펼치기', folderClose: '폴더 접기', recentChars: '최근 캐릭터', current: '현재', renameLabel: '채팅 이름', cancel2: '취소',
  home: '홈', settings: '설정', homeTitle: '홈', continueStory: '이어서 하기', continueItem: '이어서 하기', homeNote: '홈은 MAIN_MENU.md에서 설계해요. 여기서는 뒤로 가기의 도착지를 보여 주는 자리 표시용이에요.', library: '라이브러리 (자리 표시)',
  justNow: '방금', minAgo: '{n}분 전', hourAgo: '{n}시간 전', yesterday: '어제', msgsN: '메시지 {n}개',
  persona: '페르소나', modules: '모듈', manageModules: '모듈 관리', lorebook: '채팅 로어북', entriesN: '항목 {n}개', openLorebook: '로어북 열기', bookmarks: '북마크', noBookmarks: '북마크가 아직 없어요',
  branches: '분기', viewBranches: '분기 보기', reading: '읽기', thisCharGroup: '이 캐릭터', memory: '메모리', memoryType: '메모리: {name}', viewMemory: '메모리 보기', openCharSettings: '캐릭터 설정 열기',
  allChatsGroup: '모든 채팅', jailbreak: '탈옥 프롬프트', affectsAll: '모든 채팅에 적용돼요', fullSettings: '전체 설정', pluginsGroup: '플러그인', manage: '관리', toggles: '토글',
  toggleScopeLabel: '이 채팅만 따로 설정', stripAutoSoon: '자동 진행은 끝나면 멈춰요', stripWritingShort: '쓰는 중이에요', autoStoppedShort: '자동 진행을 멈췄어요', stripFailedN: '답변 실패 {n}건, 보기', chatOpened: '{chat} 채팅을 열었어요', resultsShown: '검색 결과 {n}개 중 {shown}개 표시', savedChar: '이 캐릭터에 저장됨', savedAll: '모든 채팅에 저장됨', togglesDiscarded: '이 채팅의 설정값을 지웠어요', toggleNoteAll: '이 캐릭터의 모든 채팅에 적용돼요', jumpTo: '메시지로 이동', back: '뒤로', placeholder: '(자리 표시)',
  demoTitle: '슬라이스 2 데모 제어', dBgStart: '“항구의 밤”에서 답변 시작', dBgFail: '백그라운드 답변 실패', dCold: '콜드 로드 시뮬레이션(1.5초)', dLoadFail: '채팅 불러오기 실패', dFallback: '백그라운드 대신 확인 창', dPlugins: '채팅 플러그인 메뉴 항목', dAuto: '이 채팅에서 자동 진행 켜짐', dSugg: '답변 추천', dSound: '소리·읽기 켜짐', dBack: 'Android 뒤로가기(시뮬레이션)', dBigChar: '채팅 1,000개 캐릭터 열기', dReset: '슬라이스 2 데이터 초기화',
  backStack: '뒤로 스택: {s}', chatLayer: '채팅', homeLayer: '홈', sheetLayer: '시트', searchLayer: '검색어', sidebarLayer: '사이드바',
  sugg1: '항구 이야기를 물어보기', sugg2: '더 알려 줘', autoStopNote: '채팅이 화면을 떠나면 자동 진행은 현재 차례 뒤에 멈춰요.',
  errDetail: '답변을 쓰지 못했어요(데모 오류: 제공자 응답 시간 초과). 다시 시도할 수 있어요.', newEmptyChat: '새 채팅', emptyChat: '비어 있는 채팅이에요. 말을 걸어 시작해 보세요.',
  imp: '가져왔어요(시뮬레이션)', exp: '내보냈어요(시뮬레이션)', dupDone: '복제했어요', renamed: '이름을 바꿨어요', moved: '옮겼어요', deletedChat: '채팅을 삭제했어요', noActive: '열린 채팅이 없어요',
  modA: '서술 스타일', modB: '메모리 도우미', modC: '장면 카드', tgNarr: '서술 모드', tgTone: '어조', tgNick: '별명', tgCap: '토글은 캐릭터의 정의에서 가져와요.', toneSoft: '부드럽게', toneBold: '대담하게', toneDry: '담백하게',
  plugA: '단어 통계', plugB: '요약 내보내기', exportThis: '이 채팅 내보내기', cloneThis: '이 채팅 복제', deleteThisChat: '이 채팅 삭제', settingsPh: '설정 (자리 표시)',
},
};

/* ------------------------------------------------------------------ synthetic data */
const CHARS = [
  { id: 'sera', name: { en: 'Seraphina', ko: '세라핀' }, hue: 'warm' },
  { id: 'arch', name: { en: 'Archivist', ko: '기록관' }, hue: 'blue' },
  { id: 'kai', name: { en: 'Kai', ko: '카이' }, hue: 'green' },
  { id: 'dusk', name: { en: 'Dusk', ko: '노을' }, hue: 'rose' },
  { id: 'ledger', name: { en: 'The Great Ledger', ko: '방대한 장부' }, hue: 'violet', big: true },
  { id: 'mina', name: { en: 'Mina', ko: '미나' }, hue: 'gold' },
];
const FOLDERS = {
  sera: [{ id: 'f-done', name: { en: 'Finished', ko: '완결' }, color: '#ffb38a', open: false }, { id: 'f-fav', name: { en: 'Favourites', ko: '즐겨찾기' }, color: '#7fe9ff', open: true }],
};
const LINES_U = [['Good evening. Is anyone here?', '안녕하세요. 누구 계세요?'], ['Tell me about this place.', '이곳에 대해 알려 주세요.'], ['I can wait a little longer.', '조금 더 기다릴 수 있어요.'], ['What happened to the lights?', '불빛은 어떻게 된 거예요?'], ['Thank you for staying with me.', '곁에 있어 줘서 고마워요.']];
const LINES_C = [['You are late. Come in out of the wind, the kettle is still warm.', '늦었네요. 바람 피해서 들어와요, 주전자는 아직 따뜻해요.'], ['This place remembers everyone who stayed. Sit, and I will tell you.', '이곳은 머물렀던 사람을 모두 기억해요. 앉아요, 이야기해 줄게요.'], ['The lights went out the night the tide turned. Nobody lit them again.', '조수가 바뀐 밤에 불빛이 꺼졌어요. 아무도 다시 켜지 않았죠.'], ['Of course. Waiting is the one thing I am good at.', '물론이죠. 기다리는 건 제가 잘하는 일이에요.']];
const NAME_W1 = [['Harbor', '항구'], ['Lighthouse', '등대'], ['Fog', '안개'], ['Moonlight', '달빛'], ['Forest', '숲'], ['Tower', '탑']];
const NAME_W2 = [[' night', '의 밤'], [' records', '의 기록'], [' morning', '의 아침'], [' song', '의 노래']];
let uid = 0;
function mk(charId, o) {
  const c = Object.assign({ id: 'c' + (++uid), charId, name: { en: 'Chat', ko: '채팅' }, age: 600, date: null, base: 12, last: { en: '…', ko: '…' }, folder: null, draft: '', attach: false, msgs: null, built: 0,
    note: '', persona: null, modules: { modA: true, modB: false, modC: true }, localToggles: false, localVals: null, lore: 7, unseen: false, failed: false, err: false, anchor: null, seen: false, suggestions: null, noteSaved: '' }, o);
  return c;
}
function makeChats() {
  const out = [];
  const add = (cid, o) => { const c = mk(cid, o); out.push(c); return c; };
  add('sera', { id: 'c-forest', name: { en: 'Lantern forest', ko: '등불의 숲' }, age: 3, base: 26, last: { en: 'Morning it is. I will have breakfast ready…', ko: '그럼 아침에 봐요. 아침을 차려 둘게요…' }, seen: true });
  add('sera', { id: 'c-harbor', name: { en: 'Harbor night', ko: '항구의 밤' }, age: 25, base: 214, last: { en: 'You are late. Come in out of the wind…', ko: '늦었네요. 오늘은 바람이 거세서…' } });
  add('sera', { id: 'c-light', name: { en: 'The lighthouse keeper', ko: '등대지기' }, age: 1500, base: 88, last: { en: 'The lamp needs oil before dark.', ko: '해 지기 전에 등불에 기름을 채워야 해요.' } });
  add('sera', { id: 'c-first', name: { en: 'First voyage', ko: '첫 항해' }, age: 4000, date: { en: 'Oct 3', ko: '10월 3일' }, base: 12, draft: 'Where should we sail next?', last: { en: 'We leave at dawn, if the wind allows.', ko: '바람이 허락하면 새벽에 떠나요.' } });
  add('sera', { id: 'c-fog', name: { en: 'Foggy pier', ko: '안개 낀 부두' }, age: 5000, date: { en: 'Oct 20', ko: '10월 20일' }, base: 41, last: { en: 'I cannot see the end of the pier.', ko: '부두 끝이 보이지 않아요.' } });
  add('sera', { id: 'c-moon', name: { en: 'Moonlit market', ko: '달빛 시장' }, age: 7000, date: { en: 'Oct 18', ko: '10월 18일' }, base: 63, last: { en: 'Buy the blue lantern, it never goes out.', ko: '파란 등불을 사요, 절대 안 꺼져요.' } });
  add('sera', { id: 'c-rain', name: { en: 'Rainy porch', ko: '비 오는 현관' }, age: 9000, date: { en: 'Oct 12', ko: '10월 12일' }, base: 130, folder: 'f-fav', last: { en: 'The swing never quite stops moving.', ko: '그네는 끝내 완전히 멈추지 않아요.' } });
  ['The last voyage|마지막 항해', 'Winter harbour|겨울 항구', 'The return|귀환', 'Epilogue|에필로그'].forEach((p, i) => { const [en, ko] = p.split('|'); add('sera', { id: 'c-done' + i, name: { en, ko }, age: 20000 + i * 900, date: { en: 'Sep ' + (20 - i), ko: '9월 ' + (20 - i) + '일' }, base: 300 + i * 17, folder: 'f-done', last: { en, ko } }); });
  add('arch', { id: 'c-a1', name: { en: 'Index of tides', ko: '조수 색인' }, age: 12, base: 54, last: { en: 'Entry 14 is missing.', ko: '14번 항목이 사라졌어요.' } });
  add('arch', { id: 'c-a2', name: { en: 'The sealed shelf', ko: '봉인된 서가' }, age: 2000, base: 9, last: { en: 'Not yet.', ko: '아직은 안 돼요.' } });
  add('arch', { id: 'c-a3', name: { en: 'A quiet audit', ko: '조용한 감사' }, age: 6000, date: { en: 'Oct 21', ko: '10월 21일' }, base: 31, last: { en: 'Everything balances, almost.', ko: '모든 게 맞아요, 거의요.' } });
  add('kai', { id: 'c-k1', name: { en: 'Night shift', ko: '야간 근무' }, age: 70, base: 19, last: { en: 'Coffee is on the counter.', ko: '커피는 카운터에 있어요.' } });
  add('dusk', { id: 'c-d1', name: { en: 'Roof at sunset', ko: '해 질 녘 옥상' }, age: 300, base: 77, last: { en: 'Stay a little longer.', ko: '조금만 더 있어요.' } });
  add('dusk', { id: 'c-d2', name: { en: 'The long walk', ko: '긴 산책' }, age: 4500, date: { en: 'Oct 22', ko: '10월 22일' }, base: 25, last: { en: 'We can turn back anytime.', ko: '언제든 돌아갈 수 있어요.' } });
  for (let i = 0; i < 1000; i++) {
    const a = NAME_W1[i % 6], b = NAME_W2[(i * 7 + 1) % 4];
    add('ledger', { id: 'c-L' + i, name: { en: a[0] + b[0] + ' #' + (i + 1), ko: a[1] + b[1] + ' #' + (i + 1) }, age: 60 + i * 45, date: i > 30 ? { en: 'Sep ' + (1 + (i % 28)), ko: '9월 ' + (1 + (i % 28)) + '일' } : null, base: 10 + (i * 13) % 400, last: { en: 'Entry ' + (i + 1) + ': the ledger holds.', ko: (i + 1) + '번 항목: 장부는 버텨요.' } });
  }
  return out;
}
let CHATS = makeChats();
const chatById = (id) => CHATS.find((c) => c.id === id);
const charById = (id) => CHARS.find((c) => c.id === id);
const L = (o) => (o && (o[S.lang] || o.en)) || '';
const chatsOf = (cid) => CHATS.filter((c) => c.charId === cid);
const charIndexInitial = (ch) => [...L(ch.name)][0];

/* ------------------------------------------------------------------ state */
const S2 = {
  charId: 'sera', chatId: 'c-forest', prevChatId: null, search: '', sort: 'recent', edit: false, openFolders: new Set(['f-fav']), recent: ['sera', 'arch', 'kai', 'dusk', 'ledger'],
  job: null, notes: [], toggleUndo: null, bgFail: false, cold: false, loadFail: false, fallback: false, plugins: true, auto: false, sugg: false, sound: true, home: false, soundCount: 0,
  loadToken: 0, loading: '', renaming: '', active: '', menuFor: '', lastChat: {}, renderCount: 0, scrollSave: 0, jobsDone: 0, tts: 0, speed: Number(Q2.get('bgspeed')) || 1,
};
try { const v = localStorage.getItem('s2sort'); if (v === 'manual' || v === 'recent') S2.sort = v; } catch (_) {}
// HOOKS1_SPEC C-3: a stack of Back layers under the sheet that is showing. pushBack(fn) adds one (valid while the same sheet stays open, however often it is swapped); Back / Esc pops it and runs it; popBack() drops the top without running it.
// S2.sheetBack remains for older callers (slice 3) as a one-layer accessor: assigning { fn, at } replaces the stack (valid for that swapSheet only, as before), assigning null clears it.
const BK = [];
Object.defineProperty(S2, 'sheetBack', { configurable: true, enumerable: true, get() { return BK.length ? BK[BK.length - 1] : null; }, set(v) { BK.length = 0; if (v) BK.push(v); } });
const ICONS2 = {
  'search': '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  'circle-alert': '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>',
  'house': '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  'settings': '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  'folder': '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  'download': '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
  'upload': '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>',
  'book-open': '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
  'dot': '<circle cx="12" cy="12" r="5" fill="currentColor"/>',
  'eye': '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
  'users': '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  'globe': '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
};
const ic2 = (n, size = 20, cls = '') => (ICONS2[n] ? `<svg class="ic ${cls}" data-icon-size="${size}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS2[n]}</svg>` : ic(n, size, cls));
const t2 = (k, v) => { const o = S2I[S.lang]; let s = o[k] ?? S2I.en[k]; if (s === undefined) return t(k, v); if (v) for (const x in v) s = s.replaceAll('{' + x + '}', v[x]); return s; };

/* ------------------------------------------------------------------ helpers: time, last line, search, status */
function relTime(c) {
  const a = c.age;
  if (a < 1) return t2('justNow'); if (a < 60) return t2('minAgo', { n: Math.round(a) }); if (a < 1440) return t2('hourAgo', { n: Math.floor(a / 60) }); if (a < 2880) return t2('yesterday');
  return L(c.date || { en: 'Oct 1', ko: '10월 1일' });
}
const plain1 = (raw) => {
  const segs = X.tokenize(raw || '', true).filter((s) => s.type === 'text');
  return segs.map((x) => x.text).join('\n').replace(/\{\{[^}]*\}\}/g, '').replace(/<[^>]+>/g, '').replace(/[*_`#>~]/g, '').split('\n').map((l) => l.trim()).find(Boolean) || '';
};
const msgsOf = (c) => (c.id === S2.chatId && S.msgs ? S.msgs : c.msgs);      // slice 1 may replace S.msgs (deletes): the open chat's list is S.msgs
function lastLine(c) {
  const ms = msgsOf(c);
  if (ms && ms.length) { const m = ms[ms.length - 1]; return plain1(X.altText(m)) || L(c.last); }
  return L(c.last);
}
const chatCount = (c) => { const ms = msgsOf(c); return ms ? c.base + (ms.length - c.built) : c.base; };
const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const cho = (ch) => { const n = ch.charCodeAt(0); return n >= 0xAC00 && n <= 0xD7A3 ? CHO[Math.floor((n - 0xAC00) / 588)] : ch; };
// Hangul by syllable and by initial consonants (초성): every query character matches itself or, when it is a jamo consonant, the initial of a syllable
function hmatch(text, q) {
  const a = [...String(text).toLowerCase()], b = [...String(q).toLowerCase().trim()]; if (!b.length) return true;
  for (let i = 0; i + b.length <= a.length; i++) { let ok = true; for (let j = 0; j < b.length; j++) { if (a[i + j] === b[j]) continue; if (/[ㄱ-ㅎ]/.test(b[j]) && cho(a[i + j]) === b[j]) continue; ok = false; break; } if (ok) return true; }
  return false;
}
const isGenerating = (c) => !!c && ((S2.job && S2.job.chatId === c.id && S2.job.state === 'writing') || (S.streaming && c.id === S2.chatId));
const draftOf = (c) => (c.id === S2.chatId ? ($('#input') ? $('#input').value.trim() : '') : c.draft) || (c.attach && c.id !== S2.chatId ? 'attach' : '');
function statusOf(c) { if (isGenerating(c)) return 'gen'; if (c.unseen) return 'new'; if (c.failed) return 'fail'; if (draftOf(c)) return 'draft'; return ''; }
const STATUS_KEY = { gen: 'statusGenerating', new: 'statusNewReply', fail: 'statusFailed', draft: 'statusDraft' };
const markHTML = (s) => (s === 'gen' ? ic2('loader', 16, 'spin') : s === 'new' ? ic2('dot', 16) : s === 'fail' ? ic2('circle-alert', 16) : s === 'draft' ? ic2('pencil', 16) : '');
const sortedChats = (list) => (S2.sort === 'recent' ? [...list].sort((a, b) => a.age - b.age) : list);
const folderList = (cid) => FOLDERS[cid] || [];

/* ------------------------------------------------------------------ list model + windowed rendering (at most ~40 rows mounted) */
const LST = { items: [], offs: [], total: 0, els: new Map(), q: '' };
const H = { gt: 32, char: 52, chat: 56, folder: 44 };
function buildModel() {
  const items = []; const q = S2.search.trim();
  if (q) {
    const chars = CHARS.filter((ch) => hmatch(ch.name.en, q) || hmatch(ch.name.ko, q));
    const mine = sortedChats(chatsOf(S2.charId)).filter((c) => hmatch(L(c.name), q) || hmatch(lastLine(c), q));
    const other = CHATS.filter((c) => c.charId !== S2.charId && hmatch(L(c.name), q));
    const cap = (arr) => arr.slice(0, 50);
    if (chars.length) { items.push({ k: 'gt', key: 'gt-c', title: t2('grpChars'), n: chars.length }); chars.forEach((ch) => items.push({ k: 'char', key: 'ch-' + ch.id, ch })); }
    if (mine.length) { items.push({ k: 'gt', key: 'gt-m', title: t2('grpThisCharChats'), n: mine.length }); cap(mine).forEach((c) => items.push({ k: 'chat', key: 'm-' + c.id, c })); }
    if (other.length) { items.push({ k: 'gt', key: 'gt-o', title: t2('grpOtherChats'), n: other.length }); cap(other).forEach((c) => items.push({ k: 'chat', key: 'o-' + c.id, c, other: true, nolast: true })); }
    LST.total = chars.length + mine.length + other.length; LST.shown = chars.length + Math.min(50, mine.length) + Math.min(50, other.length);
  } else {
    const all = chatsOf(S2.charId);
    folderList(S2.charId).forEach((f) => {                           // folders first, as in today's app; their chats follow an expanded folder row
      const inF = all.filter((c) => c.folder === f.id); const open = S2.openFolders.has(f.id);
      items.push({ k: 'folder', key: f.id, f, n: inF.length, open });
      if (open) sortedChats(inF).forEach((c) => items.push({ k: 'chat', key: c.id, c, indent: true }));
    });
    sortedChats(all.filter((c) => !c.folder)).forEach((c) => items.push({ k: 'chat', key: c.id, c }));
    LST.total = all.length; LST.shown = all.length;
  }
  LST.items = items; let y = 0; LST.offs = items.map((it) => { const o = y; y += H[it.k]; return o; }); LST.height = y;
}
function sigOf(it) {
  const c = it.c;
  if (it.k === 'chat') return [it.key, L(c.name), relTime(c), statusOf(c), lastLine(c), chatCount(c), c.id === S2.chatId, S2.edit, S2.renaming === c.id, S2.active === it.key, S.lang, it.indent, it.other].join('|');
  if (it.k === 'folder') return [it.key, L(it.f.name), it.n, it.open, S2.edit, S2.active === it.key, S.lang].join('|');
  if (it.k === 'char') return [it.key, L(it.ch.name), it.ch.id === S2.charId, S2.active === it.key, S.lang, charBadge(it.ch)].join('|');
  return [it.key, it.title, it.n, S.lang].join('|');
}
function charBadge(ch) { const cs = chatsOf(ch.id); if (cs.some(isGenerating)) return 'gen'; if (cs.some((c) => c.unseen)) return 'new'; if (cs.some((c) => c.failed)) return 'fail'; return ''; }
function rowLabel(c, other) {
  const s = statusOf(c); return [L(c.name), relTime(c), s ? t2(STATUS_KEY[s]) : '', other ? '' : lastLine(c), t2('msgsN', { n: chatCount(c) })].filter(Boolean).join(', ');
}
function fillRow(el, it) {
  const sig = sigOf(it); if (el.dataset.sig === sig) return; el.dataset.sig = sig; ['data-part', 'data-current', 'data-unread', 'data-open', 'data-status'].forEach((n) => el.removeAttribute(n));
  const tab = S2.active === it.key ? 0 : -1;
  if (it.k === 'gt') { el.className = 's2-row gt'; el.setAttribute('role', 'listitem'); el.innerHTML = `<span class="s2-gt">${esc(it.title)}</span><span class="s2-gtn">${it.n}</span>`; return; }
  if (it.k === 'char') {
    const ch = it.ch; const b = charBadge(ch);
    el.className = 's2-row charrow' + (ch.id === S2.charId ? ' cur' : ''); el.setAttribute('role', 'listitem'); el.setAttribute('data-part', 'chat-list-character'); el.toggleAttribute('data-current', ch.id === S2.charId);
    el.innerHTML = `<button type="button" class="s2-main" tabindex="${tab}" data-char="${ch.id}" aria-label="${esc(L(ch.name) + (b ? ', ' + t2(STATUS_KEY[b]) : ''))}"${ch.id === S2.charId ? ' aria-current="true"' : ''}><span class="avatar">${esc(charIndexInitial(ch))}</span><span class="s2-l1"><span class="s2-name">${esc(L(ch.name))}</span></span><span class="s2-mark" aria-hidden="true">${markHTML(b)}</span></button>`;
    return;
  }
  if (it.k === 'folder') {
    const f = it.f; el.className = 's2-row folder'; el.setAttribute('role', 'listitem'); el.setAttribute('data-part', 'chat-list-folder'); el.toggleAttribute('data-open', !!it.open); el.style.setProperty('--fc', f.color);
    el.innerHTML = `<button type="button" class="s2-main" tabindex="${tab}" data-folder="${f.id}" aria-expanded="${it.open}" aria-label="${esc(t2('folderN', { name: L(f.name), n: it.n }) + ', ' + t2(it.open ? 'folderClose' : 'folderOpen'))}"><span class="s2-fic">${ic2(it.open ? 'chevron-down' : 'chevron-right', 16)}${ic2('folder', 18)}</span><span class="s2-l1"><span class="s2-name">${esc(L(f.name))}</span><span class="s2-time">${it.n}</span></span></button>` + (S2.edit ? editCtl() : '');
    return;
  }
  const cur = c => c.id === S2.chatId; const s = statusOf(c0(it));
  const c = it.c; const isCur = cur(c);
  el.className = 's2-row chat' + (isCur ? ' cur' : '') + (it.indent ? ' indent' : '') + (S2.edit ? ' editing' : ''); el.setAttribute('role', 'listitem'); el.setAttribute('data-part', 'chat-list-row'); el.toggleAttribute('data-current', isCur); el.toggleAttribute('data-unread', s === 'new'); el.dataset.status = s || 'none';
  const nameHTML = S2.renaming === c.id ? `<input class="s2-rename" type="text" value="${esc(L(c.name))}" aria-label="${esc(t2('renameLabel'))}" data-esc-leave2>` : `<span class="s2-name" data-part="chat-list-row-name">${esc(L(c.name))}</span>`;
  el.innerHTML = `<button type="button" class="s2-main" data-part="chat-list-row-main" tabindex="${tab}" data-chat="${c.id}" aria-label="${esc(rowLabel(c, it.other))}"${isCur ? ' aria-current="page"' : ''}${S2.edit ? ' aria-disabled="true"' : ''}>` +
    `<span class="s2-l1"><span class="s2-mark" data-part="chat-list-row-mark" data-status="${s}" aria-hidden="true">${markHTML(s)}</span>${nameHTML}<span class="s2-time" data-part="chat-list-row-time">${esc(relTime(c))}</span></span>` +
    `<span class="s2-l2"><span class="s2-last" data-part="chat-list-row-last">${it.nolast ? esc(L(charById(c.charId).name)) : esc(lastLine(c))}</span><span class="s2-n" data-part="chat-list-row-count">${chatCount(c)}</span></span></button>` +
    `<button type="button" class="btn s2-more" data-part="chat-list-row-menu" tabindex="-1" data-more="${c.id}" aria-haspopup="menu" aria-label="${esc(t2('chatMenu'))}: ${esc(L(c.name))}" title="${esc(t2('chatMenu'))}">${ic('ellipsis-vertical', 18)}</button>` + (S2.edit && !it.other ? editCtl() : '') + `<div class="lp-ring" aria-hidden="true"></div>`;
}
const c0 = (it) => it.c;
const editCtl = () => `<span class="s2-edit"><span class="s2-grip" aria-hidden="true" title="${esc(t('dragHandle'))}">${ic('grip-vertical', 20)}</span><button type="button" class="btn s2-mv" data-mv="-1" tabindex="-1" aria-label="${esc(t('moveUp'))}" title="${esc(t('moveUp'))}">${ic('arrow-up', 18)}</button><button type="button" class="btn s2-mv" data-mv="1" tabindex="-1" aria-label="${esc(t('moveDown'))}" title="${esc(t('moveDown'))}">${ic('arrow-down', 18)}</button></span>`;
function renderList() {
  const sc = $('#s2List'); const cv = $('#s2Canvas'); const t0 = performance.now();
  cv.style.height = LST.height + 'px';
  const top = sc.scrollTop, h = sc.clientHeight || 400;
  let lo = 0, hi = LST.items.length - 1, first = 0;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (LST.offs[mid] + H[LST.items[mid].k] < top) lo = mid + 1; else { first = mid; hi = mid - 1; } }
  let last = first; while (last < LST.items.length && LST.offs[last] < top + h) last++;
  first = Math.max(0, first - 4); last = Math.min(LST.items.length, last + 4);
  const keep = new Set();
  for (let i = first; i < last; i++) {
    const it = LST.items[i]; keep.add(it.key); let el = LST.els.get(it.key);
    if (!el) { el = document.createElement('div'); el.dataset.key = it.key; LST.els.set(it.key, el); cv.appendChild(el); }
    fillRow(el, it); el.setAttribute('aria-setsize', LST.items.length); el.setAttribute('aria-posinset', i + 1); el.style.height = H[it.k] + 'px'; el.style.transform = `translate3d(0,${LST.offs[i]}px,0)`; el.dataset.i = i;
  }
  let prev = null;                                   // keep the DOM order equal to the visual order (reading order)
  for (let i = first; i < last; i++) { const el = LST.els.get(LST.items[i].key); const want = prev ? prev.nextElementSibling : cv.firstElementChild; if (el !== want) cv.insertBefore(el, want); prev = el; }
  for (const [k, el] of LST.els) if (!keep.has(k)) { if (el.contains(document.activeElement)) continue; el.remove(); LST.els.delete(k); }
  S2.renderCount = LST.els.size; S2.lastRenderMs = performance.now() - t0;
}
function refreshList(keepFocus = true) {
  const sc = $('#s2List'); const ae = document.activeElement; const fk = keepFocus && sc.contains(ae) ? ae.closest('[data-key]')?.dataset.key : null; const ft = fk ? (ae.dataset.more ? 'more' : ae.dataset.mv ? 'mv' + ae.dataset.mv : 'main') : null;
  buildModel();
  for (const [, el] of LST.els) delete el.dataset.sig;
  const empty = !S2.search.trim() && chatsOf(S2.charId).length === 0;
  $('#s2Empty').hidden = !empty; sc.hidden = empty;
  if (!LST.items.some((i) => i.key === S2.active)) S2.active = (LST.items.find((i) => i.k === 'chat' && i.c.id === S2.chatId) || LST.items.find((i) => i.k !== 'gt') || {}).key || '';
  renderList();
  if (fk && LST.els.get(fk)) { const el = LST.els.get(fk); const b = ft === 'more' ? $('.s2-more', el) : ft && ft.startsWith('mv') ? $(`[data-mv="${ft.slice(2)}"]`, el) : $('.s2-main', el); if (b) b.focus({ preventScroll: true }); }
  if (S2.search.trim()) { $('#s2Count').textContent = LST.shown < LST.total ? t2('resultsShown', { shown: LST.shown, n: LST.total }) : t2('resultsCount', { n: LST.total }); }
  const empt = S2.search.trim() && LST.total === 0; $('#s2List').classList.toggle('noresults', !!empt);
  let nr = $('#s2NoRes'); if (empt) { if (!nr) { nr = document.createElement('div'); nr.id = 's2NoRes'; nr.className = 's2-nores'; sc.appendChild(nr); } nr.textContent = t2('noResults'); } else if (nr) nr.remove();
}
function ensureVisible(key) {
  const i = LST.items.findIndex((it) => it.key === key); if (i < 0) return; const sc = $('#s2List'); const o = LST.offs[i], h = H[LST.items[i].k];
  if (o < sc.scrollTop) sc.scrollTop = o; else if (o + h > sc.scrollTop + sc.clientHeight) sc.scrollTop = o + h - sc.clientHeight;
  renderList();
}
function focusKey(key, part = 'main') {
  ensureVisible(key); S2.active = key; renderList(); const el = LST.els.get(key); if (!el) return; for (const [, e] of LST.els) $$('.s2-main', e).forEach((b) => (b.tabIndex = e === el ? 0 : -1));
  const b = part === 'more' ? $('.s2-more', el) : $('.s2-main', el); if (b) b.focus({ preventScroll: true });
}
const focusables = () => LST.items.filter((i) => i.k !== 'gt');

/* ------------------------------------------------------------------ strip, head, footer */
function renderStrip() {
  const el = $('#s2Strip'); el.setAttribute('aria-label', t2('recentChars'));
  el.innerHTML = S2.recent.slice(0, S.desktop ? 4 : 5).map((id) => { const ch = charById(id); const b = charBadge(ch); const cur = id === S2.charId;
    return `<button type="button" class="btn s2-av${cur ? ' cur' : ''}" data-char="${id}" aria-label="${esc(L(ch.name) + (cur ? ', ' + t2('current') : '') + (b ? ', ' + t2(STATUS_KEY[b]) : ''))}"${cur ? ' aria-current="true"' : ''} title="${esc(L(ch.name))}"><span class="avatar hue-${ch.hue}">${esc(charIndexInitial(ch))}</span>${b ? `<span class="s2-badge b-${b}" aria-hidden="true">${b === 'gen' ? ic2('loader', 12, 'spin') : b === 'fail' ? ic2('circle-alert', 12) : ''}</span>` : ''}<span class="nm">${esc(L(ch.name))}</span></button>`; }).join('') +
    `<button type="button" class="btn s2-av all" id="s2All" aria-label="${esc(t2('allCharacters'))}" title="${esc(t2('allCharacters'))}"><span class="avatar all">${ic('grid', 20)}</span><span class="nm">${esc(t2('allCharacters'))}</span></button>`;
}
function renderHead() {
  const ch = charById(S2.charId); const el = $('#s2Head');
  el.innerHTML = `<div class="s2-h1"><span class="avatar hue-${ch.hue}" aria-hidden="true">${esc(charIndexInitial(ch))}</span><h2 class="s2-chname">${esc(L(ch.name))}</h2>` +
    `<button type="button" class="btn s2-new" id="s2New">${ic('plus', 18)}<span>${esc(t2('newChat'))}</span></button>` +
    `<button type="button" class="btn s2-nmenu" id="s2NMenu" aria-haspopup="menu" aria-label="${esc(t2('chatMenu'))}" title="${esc(t2('chatMenu'))}">${ic('ellipsis-vertical', 18)}</button></div>` +
    `<div class="s2-h2"><div class="seg s2-sort" role="group" aria-label="${esc(t2('sortLabel'))}"><button type="button" class="btn" data-sort="recent" aria-pressed="${S2.sort === 'recent'}">${esc(t2('sortRecent'))}</button><button type="button" class="btn" data-sort="manual" aria-pressed="${S2.sort === 'manual'}">${esc(t2('sortManual'))}</button></div>` +
    (S2.sort === 'manual' ? `<button type="button" class="btn s2-editbtn" id="s2Edit" aria-pressed="${S2.edit}">${ic(S2.edit ? 'check' : 'sliders', 18)}<span>${esc(t2(S2.edit ? 'doneOrder' : 'editOrder'))}</span></button>` : '') + `</div>`;
  const em = $('#s2Empty'); em.innerHTML = `<p>${esc(t2('noChats'))}</p><button type="button" class="btn solid" id="s2EmptyNew">${ic('plus', 18)}<span>${esc(t2('newChat'))}</span></button>`;
}
function renderStatic() {
  $('#s2Search').placeholder = t2('searchPlaceholder'); $('#s2Search').setAttribute('aria-label', t2('searchPlaceholder'));
  $('.s2-search-ic').innerHTML = ic2('search', 18); $('#s2Clear').innerHTML = ic('x', 16); $('#s2Clear').setAttribute('aria-label', t('removeChip')); $('#s2Clear').title = t('removeChip');
  $('#s2Home').innerHTML = ic2('house', 18) + '<span>' + esc(t2('home')) + '</span>'; $('#s2Settings').innerHTML = ic2('settings', 18) + '<span>' + esc(t2('settings')) + '</span>';
  $('#s2CtlSum').textContent = t2('demoTitle'); $('#s2List').setAttribute('role', 'list'); $('#s2List').setAttribute('aria-label', t2('thisCharGroup'));
  $('#s2Search').removeAttribute('role'); ['aria-expanded', 'aria-autocomplete', 'aria-controls'].forEach((a) => $('#s2Search').removeAttribute(a));
}
function renderSidebar() { renderStatic(); renderStrip(); renderHead(); refreshList(); }

/* ------------------------------------------------------------------ messages for chats that were never opened */
const mkm = (role, en, ko, alts) => ({ id: ++S.seq, role, alts: alts || [{ en, ko }], idx: 0, bookmarked: false, hidden: false, streaming: false });
function ensureMsgs(c) {
  if (c.msgs) return c.msgs;
  if (S2H.ensure) { const r = S2H.ensure(c); if (r) return r; }
  const seed = c.id.length + c.name.en.length; const n = 6 + (seed % 5); const arr = [];
  for (let i = 0; i < n - 1; i++) {
    const fromEnd = n - 1 - i;       // the last message is the character's, then alternate
    if (fromEnd % 2 === 0) { const [en, ko] = LINES_U[(seed + i) % LINES_U.length]; arr.push(mkm('user', en, ko)); }
    else { const [en, ko] = LINES_C[(seed + i) % LINES_C.length]; arr.push(mkm('char', en, ko)); }
  }
  arr.push(mkm('char', c.last.en, c.last.ko));
  const firstChar = arr.find((m) => m.role === 'char');
  if (firstChar && c.base > 20) { const i = LINES_C.length; firstChar.alts = [firstChar.alts[0], { en: 'Another way to say it: ' + firstChar.alts[0].en, ko: '다르게 말하면: ' + firstChar.alts[0].ko }, { en: 'A third take. ' + firstChar.alts[0].en, ko: '세 번째 버전. ' + firstChar.alts[0].ko }]; }
  if (c.id === 'c-harbor') arr[2].bookmarked = true;
  c.msgs = arr; c.built = arr.length; return arr;
}

/* ------------------------------------------------------------------ switching (spec 2.1) */
const curChat = () => chatById(S2.chatId);
function focusTranscript() { const a = X.activeEl(); (a && a.isConnected ? a : $('#input')).focus({ preventScroll: true }); }
function saveAnchor(c) {
  if (!c) return; if (S2H.saveAnchor && S2H.saveAnchor(c)) return; const sc = X.scroller(); const r0 = sc.getBoundingClientRect(); const els = $$('.msg');
  const el = els.find((e) => e.getBoundingClientRect().bottom > r0.top + 56);
  c.anchor = el ? { id: el.dataset.id, off: el.getBoundingClientRect().top - r0.top, bottom: S.atBottom } : null;
}
function setHeader(c) {
  const ch = charById(c ? c.charId : S2.charId);
  I18N.en.charName = ch.name.en; I18N.ko.charName = ch.name.ko;
  $('#hdrName').textContent = L(ch.name); $('#hdrAv').textContent = charIndexInitial(ch); $('#hdrAv').className = 'avatar hue-' + ch.hue;
  $('#hdrChat').textContent = c ? L(c.name) : '';                                  // DD-042: the chat name is a subtitle under the character name
  document.title = (c ? L(c.name) + ' — ' : '') + L(ch.name) + ' · ' + (S2H.title ? S2H.title() : S.lang === 'ko' ? '슬라이스 2 목업' : 'Chat slice 2 mockup');
  const mb = $('#moreBtn'); mb.disabled = !c;
  if (c) X.setLabel(mb, 'chatOptions'); else { mb.title = t2('noChats'); mb.setAttribute('aria-label', t('chatOptions') + ': ' + t2('noChats')); }   // S7: disabled with its reason
  if (S2H.chatChanged) S2H.chatChanged(c, ch);                         // HOOKS1_SPEC C-4: the chat (or its header text) changed: chat open/switch, no chat, language
}
function touchRecent(id) { S2.recent = [id, ...S2.recent.filter((x) => x !== id)]; }
function leaveCurrent(nextId) {
  const c = curChat(); if (!c) return;
  c.msgs = S.msgs;                                                    // B12: keep this chat's own list (slice 1 replaces the array on delete)
  X.hideSnack(false);                                                 // DD-046: switching commits a pending single-message undo
  c.draft = $('#input').value; c.attach = !!S.extras; saveAnchor(c); clearTimeout(S2.seenTimer);
  const autoFlag = S2.auto; S2.auto = false;
  if (S2H.leave && S2H.leave(c, autoFlag)) { /* slice 3: a group round carries on in the background */ }
  else if (S.streaming) { const d = X.detachStream(); if (d) { startJob(c, d); if (autoFlag && S2.job) S2.job.auto = true; } }   // auto mode: stops after this turn, said in the strip
  else if (autoFlag) addNote({ kind: 'auto', chatId: c.id });
  if (autoFlag) syncDemo();
  if (nextId !== undefined) S2.prevChatId = c.id;
}
function crossfadeTo(fn) {
  const sc = X.scroller(); if (S.rm || S.lp) { fn(); return; }
  sc.classList.add('s2-fade'); sc.style.opacity = '0';
  setTimeout(() => { fn(); sc.style.opacity = ''; setTimeout(() => sc.classList.remove('s2-fade'), X.durOf('fast') + 20); }, X.durOf('fast'));
}
function openChat(id, opts = {}) {
  const c = chatById(id); if (!c) return false;
  if (id === S2.chatId && !opts.force) { closeOverlaySidebar(); return true; }
  if (S2.fallback && S.streaming && id !== S2.chatId) { askFallback(() => openChat(id, opts)); return false; }
  const wasOverlay = !S.desktop && S.sbOpen; const keepDocked = S.desktop && $('#sidebar').contains(document.activeElement);
  leaveCurrent(id);
  S2.chatId = id; S2.charId = c.charId; S2.lastChat[c.charId] = id; touchRecent(c.charId); S2.home = false; hideHome(true);
  clearNotes(id);
  setHeader(c); closeOverlaySidebar(); renderSidebar(); updateBlock(); X.announce(t2('chatOpened', { chat: L(c.name) }));
  loadChat(c);
  // focus never drops to body after a switch: transcript (or composer), except while navigating the docked list on wide
  setTimeout(() => { const ae = document.activeElement; if (opts.focus || wasOverlay || !ae || ae === document.body || !document.body.contains(ae)) { if (!(keepDocked && !opts.focus && $('#sidebar').contains(ae))) focusTranscript(); } }, X.durOf('base') + 140);
  return true;
}
function openChar(id) {
  const ch = charById(id); const list = sortedByAge(chatsOf(id));
  const target = S2.lastChat[id] && chatById(S2.lastChat[id]) ? S2.lastChat[id] : (list[0] && list[0].id);
  if (target) return openChat(target);
  if (S2.fallback && S.streaming) { askFallback(() => openChar(id)); return false; }
  leaveCurrent(null); S2.charId = id; S2.chatId = null; touchRecent(id); setHeader(null); closeOverlaySidebar(); renderSidebar(); updateBlock(); showNoChat(); return true;
}
const sortedByAge = (l) => [...l].sort((a, b) => a.age - b.age);
function closeOverlaySidebar() { if (!S.desktop && S.sbOpen) X.closeSidebar(); }
function showNoChat() {
  S.msgs = []; $('#input').value = ''; X.fitInput(); X.renderTranscript(false);
  const p = document.createElement('div'); p.className = 's2-nochat'; p.innerHTML = `<p>${esc(t2('noChats'))}</p><button type="button" class="btn solid" id="s2NoChatNew">${ic('plus', 18)}<span>${esc(t2('newChat'))}</span></button>`; X.thread().appendChild(p);
  $('#s2NoChatNew').addEventListener('click', () => newChat(S2.charId));
  renderSugg();
}
function loadChat(c) {
  const token = ++S2.loadToken; S2.loading = '';
  if (!S2.cold && !S2.loadFail) { crossfadeTo(() => { if (token === S2.loadToken) showChat(c); }); return; }
  S2.loading = c.id; S.msgs = []; X.renderTranscript(false); $('#input').value = c.draft; X.fitInput(); X.syncSend();
  setTimeout(() => { if (token !== S2.loadToken || S2.loading !== c.id) return; const th = X.thread(); const sk = document.createElement('div'); sk.className = 's2-skel'; sk.setAttribute('role', 'status'); sk.innerHTML = `<span class="s2-skel-t">${esc(t2('loadingChat'))}</span><i></i><i></i><i></i><i></i>`; th.appendChild(sk); }, 300);
  setTimeout(() => {
    if (token !== S2.loadToken || S2.loading !== c.id) return;
    $('.s2-skel') && $('.s2-skel').remove();
    if (S2.loadFail) {
      const th = X.thread(); const f = document.createElement('div'); f.className = 's2-loadfail'; f.setAttribute('role', 'alert');
      f.innerHTML = `<p>${esc(t2('loadFailed'))}</p><div class="s2-lf-row"><button type="button" class="btn solid" id="s2Retry">${ic('refresh-cw', 18)}<span>${esc(t2('retry'))}</span></button><button type="button" class="btn" id="s2PrevBtn">${ic('chevron-left', 18)}<span>${esc(t2('backToPrevious'))}</span></button></div>`; th.appendChild(f);
      $('#s2Retry').addEventListener('click', () => loadChat(c));
      $('#s2PrevBtn').addEventListener('click', () => { const p = S2.prevChatId && chatById(S2.prevChatId) ? S2.prevChatId : (sortedByAge(chatsOf(c.charId)).find((x) => x.id !== c.id) || {}).id; S2.loading = ''; if (p) openChat(p, { force: true }); });
      return;
    }
    S2.loading = ''; showChat(c);
  }, 1500);
}
function showChat(c) {
  ensureMsgs(c); S.msgs = c.msgs; S.hideNames = !!c.hideNames; document.documentElement.classList.toggle('hide-names', S.hideNames); S.persona = c.persona == null ? 0 : c.persona; X.setPersonaLabel();
  $('#input').value = c.draft || ''; X.fitInput(); S.extras = !!c.attach; X.renderExtras(); X.syncSend();
  X.renderTranscript(false);
  const job = S2.job && S2.job.chatId === c.id ? S2.job : null;
  if (job && job.state === 'writing') { clearInterval(job.timer); S2.job = null; X.attachStream(job.m, job.full, job.pos); }
  else if (job) S2.job = null;
  const sc = X.scroller();
  if (c.unseen) {                                                   // a reply finished while away: open at the start of that reply
    const m = c.msgs[c.msgs.length - 1]; const el = X.msgEl ? X.msgEl(m) : null; if (el) placeAt(el, 0);
    S2.seenTimer = setTimeout(() => { c.unseen = false; refreshAllSide(); }, 1000);
  } else if (c.anchor && !c.anchor.bottom) { const el = $(`.msg[data-id="${c.anchor.id}"]`); if (el) placeAt(el, c.anchor.off); }
  c.seen = true;
  if (S2H.show) S2H.show(c);
  if (c.failed) { c.failed = false; }
  if (!c.msgs.length) { const p = document.createElement('p'); p.className = 'note s2-emptynote'; p.textContent = t2('emptyChat'); X.thread().appendChild(p); }
  renderSugg(); X.updateCV(); renderGenStrip(); refreshAllSide(); X.syncInert();
}
function placeAt(el, off) {
  const sc = X.scroller(); const apply = () => { const d = el.getBoundingClientRect().top - sc.getBoundingClientRect().top - off; sc.scrollTop += d; S.atBottom = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 24; };
  apply(); requestAnimationFrame(apply);
}
function refreshAllSide() { renderStrip(); refreshList(); renderGenStrip(); if (S2.home) renderHome(); }
function newChat(charId) {
  const ch = charById(charId || S2.charId);
  const c = mk(ch.id, { id: 'c-new' + (++uid), name: { en: 'New chat', ko: '새 채팅' }, age: 0, base: 0, last: { en: '', ko: '' }, msgs: [], built: 0, seen: true });
  if (S2H.newChat) S2H.newChat(c, ch);
  CHATS.unshift(c); openChat(c.id, { force: true }); if (!c.startPanel) toast2(t2('newEmptyChat'));
  return c;
}
function toast2(s) { X.toast(s); }

/* ------------------------------------------------------------------ background generation (spec 2.2, DD-039) */
const addNote = (n) => { S2.notes = S2.notes.filter((x) => x.chatId !== n.chatId); S2.notes.push(n); };
const clearNotes = (id) => { S2.notes = S2.notes.filter((x) => x.chatId !== id); };
function startJob(c, d) {
  const job = { chatId: c.id, charId: c.charId, m: d.m, full: d.full, pos: d.pos, state: 'writing', timer: 0, fail: S2.bgFail, failAt: Math.floor(d.full.length * 0.5), auto: false };
  S2.job = job; job.timer = setInterval(() => jobTick(job), 40); updateBlock(); renderGenStrip(); refreshAllSide();
  X.announce(t2('stripWriting', { chat: stripName(c) }));
}
function jobTick(job) {
  if (S2.job !== job || job.state !== 'writing') { clearInterval(job.timer); return; }
  job.pos = Math.min(job.full.length, job.pos + 5 * S2.speed); job.m.alts[job.m.idx][S.lang] = job.full.slice(0, job.pos);
  if (job.fail && job.pos >= job.failAt) return failJob(job);
  if (job.pos >= job.full.length) finishJob(job);
}
function finishJob(job) {
  clearInterval(job.timer); job.state = 'done'; const c = chatById(job.chatId); const a = job.m.alts[job.m.idx]; a.en = a.ko = job.full;
  if (c && S2.sugg) c.suggestions = [t2('sugg1'), t2('sugg2')];       // suggestions are computed for A and shown only in A
  if (c) { c.unseen = true; c.age = 0; c.err = false; addNote({ kind: 'done', chatId: c.id, auto: !!job.auto }); scheduleDone(); }
  S2.jobsDone++; updateBlock(); renderGenStrip(); refreshAllSide();
  if (c) X.announce(t2('stripDone', { chat: stripName(c) }) + (job.auto ? ' · ' + t2('autoStoppedShort') : ''));       // announced; no sound and no TTS for a reply finished while hidden
}
function failJob(job) {
  clearInterval(job.timer); job.state = 'failed'; const c = chatById(job.chatId);
  if (c) failChatMsg(c, job.m, { reason: 'network', fix: null, conn: '', detail: 'timeout' }, job);       // DD-133: the same failed-reply card as in the open chat (the demo provider timed out)
  else { updateBlock(); renderGenStrip(); refreshAllSide(); }
}
// DD-133: a reply that fails in a chat that is not open waits there as the failed-reply card (slice 1) and shows it when the chat is opened; it replaces the old red note.
// The generation's own alternative is dropped (a failure is not a swipe). The sidebar status, the strip note (B6) and the announcement stay.
function failChatMsg(c, m, fail, job) {
  job = job || (S2.job && S2.job.m === m ? S2.job : null);
  if (job) { clearInterval(job.timer); job.state = 'failed'; const ctx = X.FAILCTX; const keep = ctx.m === m ? ctx.prevCount : m.alts.length - 1; const pi = ctx.m === m ? ctx.prevIdx : m.idx; m.alts.splice(Math.max(0, keep)); m.idx = Math.max(0, Math.min(pi, m.alts.length - 1)); }
  m.streaming = false; X.markFailed(m, fail);
  c.failed = true; c.err = true; addNote({ kind: 'failed', chatId: c.id, auto: !!(job && job.auto) });   // B6: a failure stays until seen or dismissed; later jobs add notes, they do not replace it
  updateBlock(); renderGenStrip(); refreshAllSide(); X.announce(t2('stripFailed', { chat: stripName(c) }));
}
function stopJob() {
  const job = S2.job; if (!job || job.state !== 'writing') return; if (S2H.jobStop && S2H.jobStop(job)) return; clearInterval(job.timer); const a = job.m.alts[job.m.idx]; a.en = a.ko = job.full.slice(0, job.pos); S2.job = null;
  updateBlock(); renderGenStrip(); refreshAllSide(); X.toast(t('stopHint'));
}
// the done strip lasts 4 s but waits while the pointer or keyboard focus is on it, and never disappears under a focused control (B4, B10)
function scheduleDone() { clearTimeout(S2.stripT); S2.stripT = setTimeout(doneTick, 4000); }
function doneTick() {
  const el = $('#genStrip'); if (el.matches(':hover') || el.contains(document.activeElement)) { S2.stripT = setTimeout(doneTick, 1500); return; }
  S2.notes = S2.notes.filter((n) => n.kind !== 'done'); renderGenStrip();
}
function updateBlock() {
  const away = S2.job && S2.job.state === 'writing' && S2.job.chatId !== S2.chatId;
  S.sendBlock = S2.chatId === null ? t2('noChats') : away ? t2('sendBlocked') : '';
  $('#input').placeholder = S.sendBlock || t('composerPh');                 // B8: the reason is visible without a hover
  X.syncSend(); if (S.msgs.length) X.refreshAll();
}
const stripName = (c) => L(charById(c.charId).name) + ' · ' + L(c.name);
function stripState() {
  const away = (n) => n.chatId !== S2.chatId; const fails = S2.notes.filter((n) => n.kind === 'failed' && away(n));
  const job = S2.job && S2.job.state === 'writing' && S2.job.chatId !== S2.chatId ? S2.job : null;
  if (job) return { kind: 'writing', chatId: job.chatId, auto: job.auto, fails: fails.length };
  const done = S2.notes.find((n) => n.kind === 'done' && away(n)); if (done) return { kind: 'done', chatId: done.chatId, auto: done.auto, fails: fails.length };
  const pers = S2.notes.find((n) => (n.kind === 'failed' || n.kind === 'auto') && away(n));
  if (pers) return { kind: pers.kind, chatId: pers.chatId, auto: pers.auto, fails: pers.kind === 'failed' ? fails.length - 1 : fails.length };
  return null;
}
function renderGenStrip() {
  const st = stripState(); const el = $('#genStrip'); const main = $('#main');
  if (!st || !chatById(st.chatId)) { if (!el.hidden && el.contains(document.activeElement)) focusAfterStrip(); el.hidden = true; main.classList.remove('has-strip'); return; }
  const c = chatById(st.chatId); el.hidden = false; main.classList.add('has-strip'); el.dataset.kind = st.kind; el.dataset.chat = c.id;
  const key = { writing: 'stripWriting', done: 'stripDone', failed: 'stripFailed', auto: 'stripAutoStopped' }[st.kind];
  const cur = curChat(); let nm = cur && cur.charId === c.charId ? L(c.name) : stripName(c);   // B5: no character prefix when it is the same character; the name truncates, the status never
  const tpl = t2(key, { chat: '\u0001' }).split('\u0001'); let status = tpl[1].trim();
  if (st.auto && st.kind === 'writing') status += ' · ' + t2('stripAutoSoon'); if (st.auto && st.kind === 'done') status += ' · ' + t2('autoStoppedShort');
  if (st.kind === 'failed' && st.fails > 0) status += ' (+' + st.fails + ')';
  let shownOv = null; if (S2H.stripText) { const r = S2H.stripText(st, c, nm, status); if (r) { nm = r[0]; status = r[1]; shownOv = r[2] || null; } }
  $('#genStrip .gs-name').textContent = nm; const shown = shownOv ? shownOv : st.auto && st.kind === 'writing' ? t2('stripWritingShort') + ' · ' + t2('stripAutoSoon') : status.replace(/^—\s*/, '');   // row 2 is one line; with the auto note the verb is shortened (the spinner and the accessible name carry the rest)
  $('#genStrip .gs-status').textContent = shown; const full = nm + ' ' + status;   // N2: two rows (name, then status); the full text is the tooltip and accessible name
   el.setAttribute('aria-label', full); $('#gsText').title = full;
  $('.gs-ic', el).innerHTML = st.kind === 'writing' ? ic2('loader', 16, 'spin') : st.kind === 'done' ? ic('check', 16) : ic2('circle-alert', 16);
  const view = $('#gsView'); view.innerHTML = ic2('eye', 20); view.setAttribute('aria-label', t2('view') + ': ' + L(c.name)); view.title = t2('view');
  const stop = $('#gsStop'); stop.innerHTML = ic('square', 16); stop.setAttribute('aria-label', t2('stopBg') + ': ' + L(c.name)); stop.title = t2('stopBg'); stop.hidden = st.kind !== 'writing';
  const x = $('#gsX'); x.innerHTML = ic('x', 16); x.setAttribute('aria-label', t2('dismiss')); x.title = t2('dismiss'); x.hidden = st.kind === 'writing' || st.kind === 'done';
  const fl = $('#gsFail'); const showFail = st.fails > 0 && st.kind !== 'failed'; fl.hidden = !showFail;
  if (showFail) { fl.innerHTML = ic2('circle-alert', 16) + '<span>' + st.fails + '</span>'; fl.setAttribute('aria-label', t2('stripFailedN', { n: st.fails })); fl.title = t2('stripFailedN', { n: st.fails }); }
}
function focusAfterStrip() { const a = X.activeEl(); (a && a.isConnected && !$('#hdr').contains(a) ? a : $('#input')).focus({ preventScroll: true }); }
function askFallback(go) {
  X.openSheet({ title: t2('fallbackPrompt'), opener: document.activeElement, build(body) {
    const p = document.createElement('p'); p.className = 'confirm-text'; p.textContent = t2('fallbackPrompt'); body.appendChild(p);
    const row = document.createElement('div'); row.className = 'confirm-row';
    X.markCritical(body); const wait = X.item('clock', t2('wait'), () => X.closeSheet(), '', { 'data-autofocus': '' });
    const stopGo = X.item('square', t2('stopAndGo'), () => { X.closeSheet(false); X.stopStream(); go(); }, 'danger dangerous');
    row.appendChild(wait); row.appendChild(stopGo); body.appendChild(row);
  } });
}

/* ------------------------------------------------------------------ reply suggestions: run and show only in the chat that produced them */
function renderSugg() {
  const el = $('#s2Sugg'); const c = curChat(); const list = c && c.suggestions;
  if (!list || !S2.sugg) { el.hidden = true; el.replaceChildren(); return; }
  el.hidden = false; el.innerHTML = list.map((s) => `<button type="button" class="chip sugg" data-s="${esc(s)}">${ic('sparkles', 16)}<span>${esc(s)}</span></button>`).join('');
}

/* ------------------------------------------------------------------ row menu, rename, move, duplicate, delete (spec 1) */
function menuItems(list) {
  return (body) => list.forEach(([icon, label, fn, cls], n) => { const b = X.item(icon, label, fn, cls || '', { role: 'menuitem' }); if (n === 0) { b.tabIndex = 0; b.setAttribute('data-autofocus', ''); } body.appendChild(b); });
}
function openRowMenu(c, opener, anchor) {
  const items = [];
  if (c.id === S2.chatId) items.push(['sliders', t2('thisChat'), () => { X.closeSheet(false); setTimeout(() => openThisChat(opener), 0); }]);
  items.push(['pencil', t2('rename'), () => { X.closeSheet(false); startRename(c); }]);
  items.push(['folder', t2('moveToFolder'), () => { X.closeSheet(false); setTimeout(() => openMoveMenu(c, opener), 0); }]);
  items.push(['copy', t2('duplicate'), () => { X.closeSheet(); duplicateChat(c); }]);
  items.push(['download', t2('exportChat'), () => { X.closeSheet(); X.toast(t2('exp')); }]);
  items.push(['trash-2', t('deleteThis'), () => { X.closeSheet(false); setTimeout(() => confirmDeleteChat(c, opener), 0); }, 'danger']);
  X.openSheet({ title: L(c.name), opener, anchor, menu: true, build: menuItems(items) });
}
function openMoveMenu(c, opener) {
  const fs = folderList(c.charId); const items = [['x', t2('noFolder'), () => { X.closeSheet(); c.folder = null; X.toast(t2('moved')); refreshList(); }]];
  fs.forEach((f) => items.push(['folder', L(f.name), () => { X.closeSheet(); c.folder = f.id; S2.openFolders.add(f.id); X.toast(t2('moved')); refreshList(); }]));
  X.openSheet({ title: t2('moveToFolder'), opener, menu: true, build: menuItems(items) });
}
function startRename(c) {
  S2.renaming = c.id; refreshList(false); const key = (LST.items.find((i) => i.c && i.c.id === c.id) || {}).key; if (key) ensureVisible(key); renderList();
  const inp = $('.s2-rename'); if (inp) { inp.focus(); inp.select(); }
}
function endRename(save) {
  const id = S2.renaming; if (!id) return; const inp = $('.s2-rename'); const c = chatById(id); S2.renaming = '';
  if (save && inp && inp.value.trim() && c) { const v = inp.value.trim(); c.name = { en: v, ko: v }; }
  refreshList(false); if (c) { const k = (LST.items.find((i) => i.c && i.c.id === id) || {}).key; if (k) focusKey(k); } renderHead(); renderStrip();
  if (c && c.id === S2.chatId) renderGenStrip();
}
function duplicateChat(c) {
  const d = mk(c.charId, { id: 'c-dup' + (++uid), name: { en: L(c.name) + ' (copy)', ko: L(c.name) + ' (복제)' }, age: 0, base: chatCount(c), last: { en: lastLine(c), ko: lastLine(c) }, folder: c.folder });
  CHATS.splice(CHATS.indexOf(c), 0, d); X.toast(t2('dupDone')); refreshList();
}
function pushBack(fn) { BK.push({ fn, gen: X.Sh.gen }); }               // the layer under the one just opened: Esc / Back returns to it instead of closing everything (stack: HOOKS1_SPEC C-3)
const popBack = () => BK.pop() || null;
function confirmDeleteChat(c, opener) {
  const gen = isGenerating(c); const fromThis = X.Sh.open && $('.s2-this');
  const open = (o) => (X.Sh.open ? X.swapSheet(o.title, o.build) : X.openSheet(o));
  open({ title: t2('deleteChatTitle'), opener, build(body) {
    body.replaceChildren(); body.className = 'sheet-body';
    const p = document.createElement('p'); p.className = 'confirm-text'; p.textContent = t2('deleteChatConfirm', { chat: L(c.name), n: chatCount(c) }); body.appendChild(p);
    const row = document.createElement('div'); row.className = 'confirm-row';
    X.markCritical(body); row.appendChild(X.item('x', t('cancel'), () => { if (fromThis) { S2.sheetBack = null; openThisChat(); } else X.closeSheet(); }, '', { 'data-autofocus': '' }));
    row.appendChild(X.item('trash-2', gen ? t2('stopAndDeleteChat') : t('deleteThis'), () => { X.closeSheet(false); deleteChat(c); }, 'danger dangerous', { 'data-confirm': '' }));
    body.appendChild(row);
  } });
  if (fromThis) pushBack(() => openThisChat());
}
function deleteChat(c) {
  if (S2.job && S2.job.chatId === c.id) { clearInterval(S2.job.timer); S2.job = null; }
  const wasCur = c.id === S2.chatId; if (wasCur && S.streaming) X.stopStream();
  const i = CHATS.indexOf(c); if (i >= 0) CHATS.splice(i, 1); if (S2.strip && S2.strip.chatId === c.id) S2.strip = null;
  if (S2.prevChatId === c.id) S2.prevChatId = null;
  X.toast(t2('deletedChat'));
  if (wasCur) {
    const next = sortedByAge(chatsOf(c.charId))[0];
    S2.chatId = null; if (next) openChat(next.id, { force: true }); else newChat(c.charId);
  } else { updateBlock(); renderSidebar(); }
}

/* ------------------------------------------------------------------ reorder (manual order only) */
function siblingsOf(c) { return chatsOf(c.charId).filter((x) => (x.folder || null) === (c.folder || null)); }
function moveSibling(c, steps) {
  const sib = siblingsOf(c); const i = sib.indexOf(c); const j = Math.max(0, Math.min(sib.length - 1, i + steps)); if (i === j) return false;
  const target = sib[j]; CHATS.splice(CHATS.indexOf(c), 1); const ti = CHATS.indexOf(target); CHATS.splice(steps > 0 ? ti + 1 : ti, 0, c); return true;
}
function moveFolder(f, steps) { const a = FOLDERS[S2.charId]; const i = a.indexOf(f); const j = Math.max(0, Math.min(a.length - 1, i + steps)); if (i === j) return false; a.splice(i, 1); a.splice(j, 0, f); return true; }
function onMove(el, dir) {
  const row = el.closest('[data-key]'); const it = LST.items.find((x) => x.key === row.dataset.key); if (!it) return;
  const moved = it.k === 'chat' ? moveSibling(it.c, dir) : moveFolder(it.f, dir); if (moved) { refreshList(); X.announce(t('moveUp') === '' ? '' : (dir < 0 ? t('moveUp') : t('moveDown'))); }
  const k = it.key; focusKey(k); const b = $(`[data-key="${CSS.escape(k)}"] [data-mv="${dir}"]`); if (b && b.getAttribute('aria-disabled') !== 'true') b.focus({ preventScroll: true });
}
function gripDown(e) {
  const grip = e.target.closest('.s2-grip'); if (!grip) return; const row = grip.closest('[data-key]'); const it = LST.items.find((x) => x.key === row.dataset.key); if (!it) return; e.preventDefault();
  const y0 = e.clientY; const h = H[it.k]; row.classList.add('dragging'); try { grip.setPointerCapture(e.pointerId); } catch (_) {}
  const base = LST.offs[LST.items.indexOf(it)];
  const move = (ev) => { row.style.transform = `translate3d(0,${base + ev.clientY - y0}px,0)`; };
  const up = (ev) => { grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up); row.classList.remove('dragging'); const steps = Math.round((ev.clientY - y0) / h); if (steps) { if (it.k === 'chat') moveSibling(it.c, steps); else moveFolder(it.f, steps); } refreshList(); };
  grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up); grip.addEventListener('pointercancel', up);
}

/* ------------------------------------------------------------------ the "This chat" sheet (spec 3) */
const TG = { vals: { sera: { narr: true, tone: 0, nick: '' } }, jb: true, memory: 'HypaV3' };
// HOOKS1_SPEC C-9: one accessor for the two values that are shared today and chat-scoped once a lane adds a scope (jailbreak switch, memory row).
// A lane sets S2H.access = { get(key, c), set(key, v, c), label(key, c), scope(key, c) }; without it slice 2 behaves as before.
const A = {
  get: (k, c) => (S2H.access ? S2H.access.get(k, c) : k === 'jailbreak' ? TG.jb : true),
  set: (k, v, c) => { if (S2H.access) S2H.access.set(k, v, c); else if (k === 'jailbreak') TG.jb = v; },
  label: (k, c) => (S2H.access && S2H.access.label ? S2H.access.label(k, c) : k === 'memory' ? TG.memory : ''),
  scope: (k, c) => (S2H.access && S2H.access.scope ? S2H.access.scope(k, c) : 'all'),
};
const gv = (c) => (c.localToggles ? c.localVals : (TG.vals[c.charId] = TG.vals[c.charId] || { narr: true, tone: 0, nick: '' }));
function flash(el, scope) { const s = $('.saved', el) || el; s.textContent = t2(scope === 'character' ? 'savedChar' : scope === 'all' ? 'savedAll' : 'saved'); clearTimeout(s._t); s._t = setTimeout(() => (s.textContent = ''), 1600); }
function openThisChat(opener) {
  const c = curChat(); if (!c) return;
  const cls = S.desktop ? 'panel' : 's2tall'; const build = (body) => buildThis(body, c);
  if (X.Sh.open) X.swapSheet(t('chatOptions'), build, cls); else X.openSheet({ title: t('chatOptions'), opener: opener || $('#moreBtn'), build, cls });
}
function mkEl(html, cls) { const d = document.createElement('div'); d.className = cls || ''; d.innerHTML = html; return d; }
function grp(body, id, title, scopeKind) {          // scopeKind: null for the group that matches the sheet title, 'character' or 'all' for wider scopes (DD-043)
  const g = document.createElement('section'); g.className = 's2-grp'; g.setAttribute('aria-labelledby', 's2g-' + id);
  const tag = scopeKind ? `<span class="s2-scope k-${scopeKind}" data-scope="${id}">${ic2(scopeKind === 'all' ? 'globe' : 'users', 14)}<span>${esc(t2(scopeKind === 'all' ? 'scopeAll' : 'scopeCharacter'))}</span></span>` : '';
  g.innerHTML = `<h3 class="s2-gh" id="s2g-${id}"><span class="s2-gname">${esc(title)}</span>${tag}</h3>`; body.appendChild(g); return g;
}
function swRow(g, label, checked, onChange, extra = {}) {
  const l = document.createElement('label'); l.className = 'sw s2-sw'; l.innerHTML = `<input type="checkbox" role="switch" ${checked ? 'checked' : ''} ${extra.attr || ''}><span class="sw-ui"></span><span class="lbl">${esc(label)}</span><span class="saved" aria-live="polite"></span>`;
  $('input', l).addEventListener('change', (e) => { onChange(e.target.checked); flash(l, extra.scope); }); g.appendChild(l); return l;
}
function btnRow(g, icon, label, detail, fn, id) {
  const b = document.createElement('button'); b.type = 'button'; b.className = 'btn s2-brow'; if (id) b.id = id;
  b.innerHTML = `<span class="l">${ic(icon, 20)}<span>${esc(label)}</span></span><span class="r">${esc(detail || '')}${ic('chevron-right', 16)}</span>`; b.addEventListener('click', fn); g.appendChild(b); return b;
}
function buildThis(body, c) {
  body.replaceChildren(); body.className = 'sheet-body s2-this';
  const ch = charById(c.charId);
  const tb = mkEl(`<span class="avatar hue-${ch.hue}" aria-hidden="true">${esc(charIndexInitial(ch))}</span><div class="s2-tbt"><button type="button" class="s2-tbname" id="s2TbName" title="${esc(t2('rename'))}"><span>${esc(L(c.name))}</span>${ic('pencil', 14)}</button><div class="s2-tbch">${esc(L(ch.name))}</div><div class="s2-tbstat">${esc(t2('chatStats', { n: chatCount(c), time: relTime(c), date: L(c.date || { en: 'Oct 3', ko: '10월 3일' }) }))}</div></div>`, 's2-tb');
  body.appendChild(tb);
  $('#s2TbName', tb).addEventListener('click', () => {
    const nb = $('#s2TbName', tb); const inp = document.createElement('input'); inp.type = 'text'; inp.className = 's2-tbinput'; inp.value = L(c.name); inp.setAttribute('aria-label', t2('renameLabel')); inp.dataset.escLeave = '';
    nb.replaceWith(inp); inp.focus(); inp.select();
    const done = (save) => { if (save && inp.value.trim()) { const v = inp.value.trim(); c.name = { en: v, ko: v }; refreshAllSide(); setHeaderTitleOnly(); } buildThis(body, c); const nn = $('#s2TbName'); if (nn) nn.focus(); };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); done(true); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); } });
    inp.addEventListener('blur', () => { if (inp.isConnected) done(true); });
  });
  // --- this chat
  let g = grp(body, 'chat', t2('thisChat'), null);
  const pn = c.persona == null ? null : c.persona;
  btnRow(g, 'user', t2('persona'), pn == null ? t2('useDefaultPersona') : t(X.PERSONAS[pn]), () => personaPick(c, body), 's2PersonaRow');
  const noteWrap = mkEl(`<label class="s2-notel" for="s2Note">${esc(t2('authorNote'))}</label><textarea id="s2Note" class="s2-note" rows="3" data-esc-leave>${esc(c.note)}</textarea><span class="saved" aria-live="polite"></span>`, 's2-noterow'); g.appendChild(noteWrap);
  const ta = $('#s2Note', noteWrap); let nt = 0; ta.addEventListener('input', () => { clearTimeout(nt); nt = setTimeout(() => { c.note = ta.value; flash(noteWrap); }, 600); });
  const mods = mkEl(`<div class="s2-sub">${esc(t2('modules'))}</div>`, 's2-mods'); g.appendChild(mods);
  ['modA', 'modB', 'modC'].forEach((k) => swRow(mods, t2(k), !!c.modules[k], (v) => { c.modules[k] = v; }, { attr: `data-mod="${k}"` }));
  btnRow(g, 'grid', t2('manageModules'), '', () => X.toast(t('simulated', { what: t2('manageModules') })));
  btnRow(g, 'book-open', t2('lorebook'), t2('entriesN', { n: c.lore }), () => X.toast(t('simulated', { what: t2('openLorebook') })));
  const marks = msgsOf(c) ? msgsOf(c).filter((m) => m.bookmarked) : [];
  const bm = mkEl(`<div class="s2-sub">${esc(t2('bookmarks'))}</div>`, 's2-bms'); g.appendChild(bm);
  if (!marks.length) bm.appendChild(mkEl(esc(t2('noBookmarks')), 's2-none'));
  marks.forEach((m) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn s2-bm'; b.dataset.mid = m.id; b.setAttribute('aria-label', t2('jumpTo') + ': ' + plain1(X.altText(m)));
    b.innerHTML = `${ic('bookmark', 18)}<span class="s2-bmt"><span class="s2-bmn">${esc(X.nameOf(m))}</span><span class="s2-bmx">${esc(plain1(X.altText(m)))}</span></span>`; b.addEventListener('click', () => jumpTo(m)); bm.appendChild(b); });
  btnRow(g, 'git-branch', t2('branches'), t2('viewBranches'), () => X.toast(t('simulated', { what: t2('viewBranches') })));
  swRow(g, t('c6'), !!c.hideNames, (v) => { c.hideNames = v; S.hideNames = v; document.documentElement.classList.toggle('hide-names', v); X.refreshAll(); }, { attr: 'data-reading' });
  if (S2H.thisChat) S2H.thisChat(body, c, { grp, swRow, btnRow, mkEl, flash, ic2, t2 });          // slice 3: the member panel of a group
  // --- toggles with the scope switch
  // HOOKS1_SPEC C-5: S2H.togglesGroup(body, c, helpers) may draw its own entry here and return true; falsy = the built-in group below
  const drawn = !!(S2H.togglesGroup && S2H.togglesGroup(body, c, { grp, swRow, btnRow, mkEl, flash, ic2, t2, ic }));
  if (!drawn) {
  g = grp(body, 'toggles', t2('toggles'), c.localToggles ? null : 'all');
  const sc = swRow(g, t2('toggleScopeLabel'), c.localToggles, (v) => {
    if (v) { c.localVals = Object.assign({}, TG.vals[c.charId] || { narr: true, tone: 0, nick: '' }); c.localToggles = true; S2.toggleUndo = null; }        // DD-045: start from the current shared values
    else { S2.toggleUndo = { chat: c.id, saved: c.localVals }; c.localVals = null; c.localToggles = false; clearTimeout(S2.tuT); S2.tuT = setTimeout(dropToggleUndo, 6000); }   // turning it off discards the chat's own values, with a short undo
    buildThis(body, c); const f = $('[data-scopesw]'); if (f) f.focus();
  }, { attr: 'data-scopesw' });
  if (S2.toggleUndo && S2.toggleUndo.chat === c.id) {
    const ur = mkEl(`<span>${esc(t2('togglesDiscarded'))}</span><button type="button" class="btn s2-tundo-btn">${ic('undo-2', 18)}<span>${esc(t('undo'))}</span></button>`, 's2-tundo'); ur.setAttribute('role', 'status'); g.appendChild(ur);
    $('button', ur).addEventListener('click', () => { const u = S2.toggleUndo; clearTimeout(S2.tuT); S2.toggleUndo = null; c.localVals = u.saved; c.localToggles = true; buildThis(body, c); const f = $('[data-scopesw]'); if (f) f.focus(); });
  }
  if (!c.localToggles) g.appendChild(mkEl(esc(t2('affectsAll')), 's2-note1'));
  const vals = gv(c);
  const tgScope = c.localToggles ? undefined : 'all';
  swRow(g, t2('tgNarr'), vals.narr, (v) => { gv(c).narr = v; }, { attr: 'data-tg="narr"', scope: tgScope });
  const sel = mkEl(`<label for="s2Tone">${esc(t2('tgTone'))}</label><select id="s2Tone" data-tg="tone">${['toneSoft', 'toneBold', 'toneDry'].map((k, i) => `<option value="${i}" ${vals.tone === i ? 'selected' : ''}>${esc(t2(k))}</option>`).join('')}</select><span class="saved" aria-live="polite"></span>`, 's2-sel'); g.appendChild(sel);
  $('select', sel).addEventListener('change', (e) => { gv(c).tone = Number(e.target.value); flash(sel, tgScope); });
  const tx = mkEl(`<label for="s2Nick">${esc(t2('tgNick'))}</label><input id="s2Nick" type="text" data-tg="nick" value="${esc(vals.nick)}" data-esc-leave><span class="saved" aria-live="polite"></span>`, 's2-sel'); g.appendChild(tx);
  let nk = 0; $('input', tx).addEventListener('input', (e) => { clearTimeout(nk); nk = setTimeout(() => { gv(c).nick = e.target.value; flash(tx, tgScope); }, 400); });
  g.appendChild(mkEl('', 's2-div')); g.appendChild(mkEl(esc(t2('tgCap')), 's2-cap'));
  }
  // --- this character
  g = grp(body, 'char', t2('thisCharGroup'), 'character');
  btnRow(g, 'sparkles', t2('memory'), A.label('memory', c), () => X.toast(t('simulated', { what: t2('viewMemory') })));
  swRow(g, t('c5'), S.renderComplete, (v) => { S.renderComplete = v; X.syncCtl(); }, { attr: 'data-c5', scope: 'character' });
  btnRow(g, 'pencil', t2('openCharSettings'), '', () => X.toast(t('simulated', { what: t2('openCharSettings') })));
  // --- all chats
  g = grp(body, 'all', t2('allChatsGroup'), 'all');
  swRow(g, t2('jailbreak'), A.get('jailbreak', c), (v) => A.set('jailbreak', v, c), { attr: 'data-jb', scope: A.scope('jailbreak', c) }); g.appendChild(mkEl(esc(t2('affectsAll')), 's2-note1'));
  btnRow(g, 'settings', t2('fullSettings'), '', () => X.toast(t2('settingsPh')));
  // --- plugins
  if (S2.plugins) { g = grp(body, 'plug', t2('pluginsGroup'), ''); g.dataset.plugins = '1'; btnRow(g, 'plug', t2('plugA'), '', () => X.toast(t('simulated', { what: t2('plugA') }))); btnRow(g, 'plug', t2('plugB'), '', () => X.toast(t('simulated', { what: t2('plugB') }))); }
  // --- manage
  g = grp(body, 'manage', t2('manage'), '');
  btnRow(g, 'download', t2('exportThis'), '', () => X.toast(t2('exp')));
  btnRow(g, 'copy', t2('cloneThis'), '', () => { duplicateChat(c); });
  const del = btnRow(g, 'trash-2', t2('deleteThisChat'), '', () => confirmDeleteChat(c, $('#moreBtn'))); del.classList.add('danger');
  if (S2H.thisChatBuilt) S2H.thisChatBuilt(body, c);                   // HOOKS1_SPEC C-5/C-9: the sheet is complete (a lane may regroup the jailbreak and memory rows)
}
function dropToggleUndo() { S2.toggleUndo = null; const r = $('.s2-tundo'); if (r) { const had = r.contains(document.activeElement); r.remove(); if (had) { const f = $('[data-scopesw]'); if (f) f.focus(); } } }
function setHeaderTitleOnly() { /* the header shows the character name; the chat name lives in the sheet and the sidebar */ }
function personaPick(c, body) {
  setTimeout(() => pushBack(() => { buildThis(body, c); X.swapSheet(t('chatOptions'), (b) => buildThis(b, c), S.desktop ? 'panel' : 's2tall'); }), 0);
  X.swapSheet(t('personaPick'), (b) => {
    b.replaceChildren(); b.setAttribute('role', 'radiogroup'); b.className = 'sheet-body';
    const rows = [[null, t2('useDefaultPersona')], ...X.PERSONAS.map((k, i) => [i, t(k)])];
    rows.forEach(([v, label], n) => { const it = X.item('user', label, () => { S2.sheetBack = null; c.persona = v; S.persona = v == null ? 0 : v; X.setPersonaLabel(); buildThis(b, c); b.setAttribute('role', 'group'); const r = $('#s2PersonaRow'); if (r) r.focus(); }, '', { role: 'radio', 'aria-checked': String(v === c.persona) }); if (v === c.persona || (n === 0 && c.persona == null)) it.setAttribute('data-autofocus', ''); b.appendChild(it); });
    const back = X.item('chevron-left', t2('back'), () => { S2.sheetBack = null; buildThis(b, c); b.setAttribute('role', 'group'); }, ''); b.appendChild(back);
  }, S.desktop ? 'panel' : 's2tall');
}
function jumpTo(m) {
  X.closeSheet(); const el = X.msgEl(m); if (!el) return;
  setTimeout(() => { const sc = X.scroller(); sc.scrollTop += el.getBoundingClientRect().top - sc.getBoundingClientRect().top - 64; S.atBottom = false; X.setActive(el); el.focus({ preventScroll: true }); el.classList.add('s2-hl'); setTimeout(() => el.classList.remove('s2-hl'), 1800); }, 60);
}

/* ------------------------------------------------------------------ Home placeholder and the Back stack (spec 4, DD-040) */
function renderHome() {
  const el = $('#s2HomeScreen'); el.setAttribute('aria-label', t2('homeTitle'));
  const cur = curChat(); const list = [cur, ...sortedByAge(CHATS.filter((c) => c !== cur && c.age < 5000)).slice(0, 3)].filter(Boolean);
  el.innerHTML = `<div class="s2-home-in"><h1>${esc(t2('homeTitle'))}</h1><p class="s2-hnote">${esc(t2('homeNote'))}</p><h2>${esc(t2('continueStory'))}</h2><ul class="s2-hlist">` +
    list.map((c) => { const s = statusOf(c); return `<li><button type="button" class="btn s2-hrow" data-chat="${c.id}"><span class="avatar hue-${charById(c.charId).hue}" aria-hidden="true">${esc(charIndexInitial(charById(c.charId)))}</span><span class="s2-ht"><span class="s2-hn">${esc(L(charById(c.charId).name))} · ${esc(L(c.name))}</span><span class="s2-hs">${s ? esc(t2(STATUS_KEY[s])) : esc(relTime(c))}</span></span><span class="s2-hgo">${esc(t2('continueItem'))}${ic('chevron-right', 16)}</span></button></li>`; }).join('') +
    `</ul><h2>${esc(t2('library'))}</h2><div class="s2-tiles" aria-hidden="true"><i></i><i></i><i></i></div></div>`;
}
function goHome() {
  if (S2.home) return; const c = curChat(); if (c) { c.draft = $('#input').value; saveAnchor(c); }
  if (!S.desktop && S.sbOpen) X.closeSidebar();
  S2.home = true; S.homeOpen = true; if (S2H.home) S2H.home(); renderHome(); const el = $('#s2HomeScreen'); el.hidden = false; X.syncInert(); const f = $('.s2-hrow', el); if (f) f.focus({ preventScroll: true }); updateStack();
}
function hideHome(silent) { if (!S2.home && $('#s2HomeScreen').hidden) return; if (S2.home && S2H.homeBack) S2H.homeBack(); S2.home = false; S.homeOpen = false; $('#s2HomeScreen').hidden = true; X.syncInert(); const cc = curChat(); if (cc && cc.unseen && !silent) { const m = S.msgs[S.msgs.length - 1]; const el = m && X.msgEl(m); if (el) placeAt(el, 0); clearTimeout(S2.seenTimer); S2.seenTimer = setTimeout(() => { cc.unseen = false; refreshAllSide(); }, 1000); } if (!silent) { const a = X.activeEl(); (a || $('#input')).focus({ preventScroll: true }); } updateStack(); }
function clearSearch() { S2.search = ''; $('#s2Search').value = ''; $('#s2Clear').hidden = true; refreshList(false); }
function stackLayers() {
  const out = []; if (X.Sh.open) out.push(t2('sheetLayer')); if (S2.search.trim()) out.push(t2('searchLayer')); if (!S.desktop && S.sbOpen) out.push(t2('sidebarLayer'));
  out.push(S2.home ? t2('homeLayer') : t2('chatLayer')); if (!S2.home) out.push(t2('homeLayer')); return out;
}
function updateStack() { const el = $('#s2Stack'); if (el) el.textContent = t2('backStack', { s: stackLayers().join(' › ') }); }
// one Back for Android Back, Esc, the mouse back button and the browser Back: open menu/confirm/sheet > search text > overlay sidebar > chat > Home
function popSheet() {
  const sb = BK.pop();
  if (sb && (sb.gen !== undefined ? sb.gen === X.Sh.gen : sb.at === X.Sh.at)) { sb.fn(); return 'sheet-back'; }
  BK.length = 0; X.closeSheet(); return 'sheet';
}
function goBack(src) {
  let r;
  if (X.Sh.open) r = popSheet();                                      // confirm / picker -> the sheet beneath, else the sheet
  else if (S2H.back && S2H.back(src)) r = 'search-in-chat';          // slice 4: the in-chat search bar is one layer
  else if (S2.search.trim() && (S.desktop || S.sbOpen)) { clearSearch(); r = 'search'; }
  else if (!S.desktop && S.sbOpen) { X.closeSidebar(); r = 'sidebar'; }
  else if (!S2.home) { goHome(); r = 'chat'; }
  else r = 'home';
  X.S.log.push('back (' + src + ') -> ' + r); setTimeout(updateStack, 50); return r;
}
const isTextEl = (el) => !!el && (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || (el.tagName === 'INPUT' && /^(text|search|)$/.test(el.type)) || el.isContentEditable);
addEventListener('keydown', (e) => {                                  // registered before slice 1's own handler so the stack order wins
  if (!X || e.key !== 'Escape' || e.isComposing) return; const tg = e.target;
  if (S2.renaming && tg.classList && tg.classList.contains('s2-rename')) { e.preventDefault(); e.stopImmediatePropagation(); endRename(false); return; }
  if (X.Sh.open) { if (tg.dataset && tg.dataset.escLeave !== undefined) return; e.preventDefault(); e.stopImmediatePropagation(); goBack('Esc'); return; }   // Esc in a field leaves the field first (slice 1)
  if (tg.id === 's2Search' && !tg.value && S.desktop) { e.preventDefault(); e.stopImmediatePropagation(); focusTranscript(); return; }   // N3: the first Esc in an empty docked search leaves the field, the next goes Home
  if (tg.id === 'input') { e.preventDefault(); e.stopImmediatePropagation(); tg.blur(); focusTranscript(); return; }   // DD-048: the first Esc leaves the message box, the draft stays
  if (S2.home) return;
  e.preventDefault(); e.stopImmediatePropagation(); goBack('Esc');
}, true);
addEventListener('mouseup', (e) => {
  if (!X || e.button !== 3) return;
  e.preventDefault(); e.stopImmediatePropagation(); goBack('mouse');
}, true);

/* ------------------------------------------------------------------ demo controls */
function syncDemo() { $$('#s2Demo [data-d]').forEach((i) => { i.checked = !!S2[i.dataset.d]; }); updateStack(); }
function renderDemo() {
  const el = $('#s2Demo'); const sw = (k, label) => `<label class="sw"><input type="checkbox" role="switch" data-d="${k}"><span class="sw-ui"></span><span class="lbl">${esc(t2(label))}</span></label>`;
  el.innerHTML = `<h2 class="s2-dh">${esc(t2('demoTitle'))}</h2>` +
    `<button type="button" class="btn act" id="dBgStart">${ic('sparkles', 18)}<span>${esc(t2('dBgStart'))}</span></button>` +
    sw('bgFail', 'dBgFail') + sw('cold', 'dCold') + sw('loadFail', 'dLoadFail') + sw('fallback', 'dFallback') + sw('plugins', 'dPlugins') + sw('auto', 'dAuto') + sw('sugg', 'dSugg') + sw('sound', 'dSound') +
    `<button type="button" class="btn act" id="dBack">${ic('chevron-left', 18)}<span>${esc(t2('dBack'))}</span></button><button type="button" class="btn act" id="dBig">${ic('grid', 18)}<span>${esc(t2('dBigChar'))}</span></button><button type="button" class="btn act" id="dReset">${ic('rotate-ccw', 18)}<span>${esc(t2('dReset'))}</span></button><p class="banner" id="s2Stack"></p>`;
  $$('[data-d]', el).forEach((i) => i.addEventListener('change', () => { S2[i.dataset.d] = i.checked; if (i.dataset.d === 'plugins') { /* applies when the sheet opens */ } if (i.dataset.d === 'sugg') renderSugg(); }));
  $('#dBgStart').addEventListener('click', () => { startBgDemo(); closeCtl(); }); $('#dBack').addEventListener('click', () => goBack('android')); $('#dBig').addEventListener('click', () => { openChar('ledger'); });
  $('#dReset').addEventListener('click', () => location.reload()); syncDemo();
}
const closeCtl = () => { if (!S.desktop && S.sbOpen) X.closeSidebar(); };
function startBgDemo(id = 'c-harbor') {
  const c = chatById(id); if (S2.chatId === id) openChat(id === 'c-forest' ? 'c-harbor' : 'c-forest', { force: true });
  if (S2.job && S2.job.state === 'writing') return;
  const msgs = ensureMsgs(c); let m = msgs[msgs.length - 1];
  if (m.role !== 'char') { m = mkm('char', '', '', []); msgs.push(m); }
  m.alts.push({ en: '', ko: '' }); m.idx = m.alts.length - 1;
  startJob(c, { m, full: X.buildPlan(S.lang).full, pos: 0 });
}

/* ------------------------------------------------------------------ events */
function wire() {
  const sb = $('#sidebar'); let lpT = 0, lpFired = false, ptype = 'mouse', lpRing = null;
  addEventListener('pointerdown', (e) => { ptype = e.pointerType; }, true);
  sb.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (lpFired) { lpFired = false; e.preventDefault(); return; }
    if (b.dataset.chat && b.classList.contains('s2-main')) { if (S2.edit) return; if (S2.search.trim()) clearSearch(); openChat(b.dataset.chat); return; }
    if (b.dataset.folder) { const id = b.dataset.folder; S2.openFolders.has(id) ? S2.openFolders.delete(id) : S2.openFolders.add(id); refreshList(); return; }
    if (b.dataset.char) { if (S2.search.trim()) clearSearch(); openChar(b.dataset.char); return; }
    if (b.dataset.more) { const c = chatById(b.dataset.more); if (c) openRowMenu(c, b); return; }
    if (b.dataset.mv) { onMove(b, Number(b.dataset.mv)); return; }
    if (b.dataset.sort) { S2.sort = b.dataset.sort; try { localStorage.setItem('s2sort', S2.sort); } catch (_) {} if (S2.sort !== 'manual') S2.edit = false; renderHead(); refreshList(); const nb = $(`[data-sort="${S2.sort}"]`); if (nb) nb.focus(); return; }
    if (b.id === 's2Edit') { S2.edit = !S2.edit; renderHead(); refreshList(); const nb = $('#s2Edit'); if (nb) nb.focus(); return; }
    if (b.id === 's2New' || b.id === 's2EmptyNew') { newChat(); return; }
    if (b.id === 's2NMenu') { X.openSheet({ title: t2('chatMenu'), opener: b, menu: true, build: menuItems([['plus', t2('newChat'), () => { X.closeSheet(false); newChat(); }], ...(S2H.newMenu ? S2H.newMenu() : []), ['upload', t2('importChat'), () => { X.closeSheet(); X.toast(t2('imp')); }], ['download', t2('exportAll'), () => { X.closeSheet(); X.toast(t2('exp')); }]]) }); return; }
    if (b.id === 's2All' || b.id === 's2Home') { goHome(); return; }
    if (b.id === 's2Settings') { X.toast(t2('settingsPh')); return; }
    if (b.id === 's2Clear') { clearSearch(); $('#s2Search').focus(); updateStack(); return; }
  });
  let st = 0;
  $('#s2Search').addEventListener('input', () => { const v = $('#s2Search').value; $('#s2Clear').hidden = !v; clearTimeout(st); st = setTimeout(() => { S2.search = v; refreshList(false); $('#s2List').scrollTop = 0; renderList(); updateStack(); }, 150); });
  $('#s2Search').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); clearTimeout(st); S2.search = $('#s2Search').value; refreshList(false); const f = focusables()[0]; if (f) focusKey(f.key); }
    else if (e.key === 'Enter') { e.preventDefault(); clearTimeout(st); S2.search = $('#s2Search').value; buildModel(); const f = LST.items.find((i) => i.k !== 'gt'); if (f) { if (f.k === 'chat') openChat(f.c.id); else openChar(f.ch.id); clearSearch(); } }
  });
  sb.addEventListener('keydown', (e) => {
    const row = e.target.closest && e.target.closest('[data-key]'); if (!row || e.target.classList.contains('s2-rename')) { if (e.target.classList && e.target.classList.contains('s2-rename')) { if (e.key === 'Enter') { e.preventDefault(); endRename(true); } } return; }
    const it = LST.items.find((x) => x.key === row.dataset.key); if (!it) return; const fl = focusables(); const i = fl.indexOf(it);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const n = fl[Math.max(0, Math.min(fl.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]; if (n) focusKey(n.key); else if (e.key === 'ArrowUp') $('#s2Search').focus(); return; }
    if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); const n = e.key === 'Home' ? fl[0] : fl[fl.length - 1]; if (n) focusKey(n.key); return; }
    if (e.key === 'ArrowRight' && it.k === 'folder' && !it.open) { e.preventDefault(); S2.openFolders.add(it.f.id); refreshList(); focusKey(it.key); return; }
    if (e.key === 'ArrowLeft') { if (it.k === 'folder' && it.open) { e.preventDefault(); S2.openFolders.delete(it.f.id); refreshList(); focusKey(it.key); } else if (it.k === 'chat' && it.indent) { e.preventDefault(); focusKey(it.c.folder); } return; }
    if ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') { if (it.k === 'chat') { e.preventDefault(); openRowMenu(it.c, $('.s2-main', row)); } return; }
    if (e.key === 'F2' && it.k === 'chat') { e.preventDefault(); startRename(it.c); }
  });
  sb.addEventListener('focusout', (e) => { if (e.target.classList && e.target.classList.contains('s2-rename') && S2.renaming) setTimeout(() => { if (S2.renaming && !document.activeElement.classList.contains('s2-rename')) endRename(true); }, 0); });
  sb.addEventListener('contextmenu', (e) => { const row = e.target.closest('.s2-row.chat'); if (!row) return; e.preventDefault(); if (ptype === 'touch') return; const it = LST.items.find((x) => x.key === row.dataset.key); if (it) openRowMenu(it.c, $('.s2-main', row), S.desktop || true ? { x: e.clientX, y: e.clientY } : null); });
  sb.addEventListener('pointerdown', (e) => {
    gripDown(e);
    if (e.pointerType === 'mouse' || e.button > 0) return; const b = e.target.closest('.s2-main[data-chat]'); if (!b) return; const c = chatById(b.dataset.chat); if (!c) return;
    const row = b.closest('.s2-row'); lpRing = $('.lp-ring', row); const rr = row.getBoundingClientRect(); if (lpRing) { lpRing.style.left = e.clientX - rr.left + 'px'; lpRing.style.top = e.clientY - rr.top + 'px'; }
    const x0 = e.clientX, y0 = e.clientY; clearTimeout(lpT); lpFired = false;
    const ringT = setTimeout(() => { if (lpRing) { lpRing.classList.remove('run'); void lpRing.offsetWidth; lpRing.classList.add('run'); } }, 200);
    lpT = setTimeout(() => { lpFired = true; setTimeout(() => { lpFired = false; }, 700); if (lpRing) lpRing.classList.remove('run'); X.haptic('long-press'); openRowMenu(c, b); }, 500);
    const cancel = (ev) => { if (ev && ev.type === 'pointermove' && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 10) return; clearTimeout(lpT); clearTimeout(ringT); if (lpRing) lpRing.classList.remove('run'); removeEventListener('pointermove', cancel); removeEventListener('pointerup', cancel); removeEventListener('pointercancel', cancel); };
    addEventListener('pointermove', cancel); addEventListener('pointerup', cancel); addEventListener('pointercancel', cancel);
  });
  $('#s2List').addEventListener('scroll', () => renderList(), { passive: true });
  $('#gsView').addEventListener('click', () => { const id = $('#genStrip').dataset.chat; if (id) openChat(id, { focus: true }); });
  $('#gsStop').addEventListener('click', () => { stopJob(); $('#input').focus({ preventScroll: true }); });
  $('#gsX').addEventListener('click', () => { const id = $('#genStrip').dataset.chat; S2.notes = S2.notes.filter((n) => !(n.chatId === id && n.kind !== 'done')); renderGenStrip(); focusAfterStrip(); });
  $('#gsFail').addEventListener('click', () => { const n = S2.notes.find((x) => x.kind === 'failed' && x.chatId !== S2.chatId); if (n) openChat(n.chatId, { focus: true }); });
  new MutationObserver(() => { const h = $('#hdr'); $('#genStrip').classList.toggle('up', h.classList.contains('hidden') || h.classList.contains('gone')); }).observe($('#hdr'), { attributes: true, attributeFilter: ['class'] });
  $('#s2Sugg').addEventListener('click', (e) => { const b = e.target.closest('[data-s]'); if (!b) return; $('#input').value = b.dataset.s; X.fitInput(); X.syncSend(); $('#input').focus(); });
  $('#s2HomeScreen').addEventListener('click', (e) => { const b = e.target.closest('[data-chat]'); if (!b) return; const id = b.dataset.chat; if (id === S2.chatId) { hideHome(); } else { hideHome(true); openChat(id, { force: true }); } });
  $('#s2HomeScreen').addEventListener('keydown', (e) => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { const r = $$('.s2-hrow'); const i = r.indexOf(document.activeElement); if (i >= 0) { e.preventDefault(); r[Math.max(0, Math.min(r.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))].focus(); } } });
  // shortcuts: Ctrl+K search, Alt+Up/Down previous/next chat (DD-047), Ctrl+. This chat
  addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.shiftKey && !e.altKey && (e.key === 'k' || e.key === 'K')) { if (X.Sh.open) return; e.preventDefault(); openSearch(); return; }
    if (e.altKey && !mod && !e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      if (X.Sh.open || S2.home || (!S.desktop && S.sbOpen) || isTextEl(e.target)) return;   // ignored in sheets, menus, modals and text fields
      e.preventDefault(); stepChat(e.key === 'ArrowDown' ? 1 : -1); return;
    }
    if (mod && !e.shiftKey && !e.altKey && e.key === '.') { e.preventDefault(); if (!X.Sh.open && curChat()) openThisChat(); }
  }, true);
  $('#sbBtn').addEventListener('click', () => setTimeout(updateStack, 400)); $('.sb-close').addEventListener('click', () => setTimeout(updateStack, 400));
}
function openSearch() {
  if (S2.home) hideHome(true);
  if (!S.desktop && !S.sbOpen) X.openSidebar($('#sbBtn'));
  setTimeout(() => { const s = $('#s2Search'); s.focus(); s.select(); }, S.desktop ? 0 : 120);
}
function stepChat(d) {
  const order = []; LST.items.length || buildModel(); const base = S2.search.trim() ? null : LST.items;
  (base || []).forEach((i) => { if (i.k === 'chat') order.push(i.c.id); });
  if (!order.length) { sortedChatsOf().forEach((c) => order.push(c.id)); }
  const i = order.indexOf(S2.chatId); const n = order[(i < 0 ? 0 : i + d + order.length) % order.length]; if (n && n !== S2.chatId) openChat(n);
}
const sortedChatsOf = () => sortedChats(chatsOf(S2.charId));

/* ------------------------------------------------------------------ start */
function start() {
  X = window.__slice1; if (!X) return; S = X.S; I18N = X.I18N; t = X.t; esc = X.esc; ic = X.ic;
  Object.assign(X.ICONS, ICONS2, { clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>' });
  const c0 = chatById('c-forest'); c0.msgs = S.msgs; c0.built = S.msgs.length; if (S.msgs[3]) S.msgs[3].bookmarked = true; if (S.msgs[12]) S.msgs[12].bookmarked = true;
  const mb = $('#moreBtn'); const nb = mb.cloneNode(true); mb.replaceWith(nb); nb.addEventListener('click', () => openThisChat(nb)); nb.setAttribute('aria-keyshortcuts', 'Control+.');
  S.hooks.lang = () => { setHeader(curChat()); renderSidebar(); renderGenStrip(); renderDemo(); renderSugg(); updateBlock(); if (S2.home) renderHome(); if (S2.chatId === null) showNoChat(); };
  S.hooks.streamEnd = (m, stopped) => {
    const c = curChat(); if (!c) return; c.age = 0; c.failed = false;
    if (!stopped) { if (S2.sound && !S2.home) S2.soundCount++; if (S2.sugg) { c.suggestions = [t2('sugg1'), t2('sugg2')]; renderSugg(); } }
    if (S2.home) { c.unseen = true; X.announce(t2('stripDone', { chat: stripName(c) })); }     // B7: a reply that finishes while Home is open still leaves a signal
    refreshAllSide();
  };
  document.addEventListener('chat:sheetclosed', () => { BK.length = 0; });   // HOOKS1_SPEC C-2/C-3: a closed sheet leaves no Back layers behind
  S.hooks.failElsewhere = (chatId, msgId, fail) => {                  // slice 1 failReply(msgId, { chat }): 1 = handled here, 0 = unknown message, false = it is the open chat (slice 1 handles it)
    if (chatId === S2.chatId) return false; const c = chatById(chatId); if (!c || !c.msgs) return 0;
    const m = c.msgs.find((x) => String(x.id) === String(msgId)); if (!m || m.role !== 'char') return 0; failChatMsg(c, m, fail); return 1;
  };
  S.hooks.send = S.hooks.generate = () => { const c = curChat(); if (c && c.suggestions) { c.suggestions = null; renderSugg(); } };   // suggestions end with a send or a new reply
  setHeader(c0); renderSidebar(); renderDemo(); wire(); renderGenStrip(); updateBlock();
  $('#s2Home').addEventListener('keydown', () => {});
  history.pushState({ s2: 1 }, ''); addEventListener('popstate', () => { goBack('browser'); history.pushState({ s2: 1 }, ''); });
  X.S.log.push('slice 2 ready');
  window.__slice2 = { pushBack, popBack, ic2, S2H, scheduleDone, refreshAllSide, mk, S2, CHATS, CHARS, FOLDERS, LST, TG, openChat, openChar, newChat, deleteChat, goBack, goHome, hideHome, openThisChat, startBgDemo, startJob, stopJob, updateBlock, refreshList, renderSidebar, hmatch, cho, relTime, lastLine, chatCount, statusOf, stackLayers, ensureMsgs, stepChat, openSearch, S2I, addNote, focusTranscript, msgsOf, stripName, t2, chatById, curChat, stripState, renderGenStrip, showChat, saveAnchor, clearSearch, openRowMenu, confirmDeleteChat, startRename, endRename, focusKey, H };
  const st = Q2.get('state'); if (st) setTimeout(() => runState2(st), 120);
  if (Q2.get('search') !== null) { $('#s2Search').value = Q2.get('search'); S2.search = Q2.get('search'); $('#s2Clear').hidden = false; refreshList(false); }
}
function runState2(s) {
  const open = () => { if (!S.desktop && !S.sbOpen) X.openSidebar($('#sbBtn')); };
  const setSearch = (v) => { open(); $('#s2Search').value = v; S2.search = v; $('#s2Clear').hidden = !v; refreshList(false); updateStack(); };
  if (s === 'sidebar') open();
  else if (s === 'search') setSearch('항구'.length && (S.lang === 'ko' ? '항구' : 'harbor'));
  else if (s === 'chosung') { S.lang = S.lang; setSearch('ㅎㄱ'); }
  else if (s === 'noresults') setSearch('zzzz');
  else if (s === 'mina') { openChar('mina'); open(); }
  else if (s === 'big') { openChar('ledger'); open(); }
  else if (s === 'folders') { S2.openFolders.add('f-done'); open(); refreshList(); }
  else if (s === 'rename') { open(); startRename(chatById('c-harbor')); }
  else if (s === 'rowmenu') { open(); setTimeout(() => openRowMenu(chatById('c-harbor'), $('.s2-main[data-chat="c-harbor"]') || document.body), 300); }
  else if (s === 'delete') { open(); setTimeout(() => confirmDeleteChat(chatById('c-harbor'), document.body), 300); }
  else if (s === 'reorder') { S2.sort = 'manual'; S2.edit = true; open(); renderHead(); refreshList(); }
  else if (s === 'cold') { S2.cold = true; syncDemo(); openChat('c-harbor'); }
  else if (s === 'loadfail') { S2.loadFail = true; syncDemo(); openChat('c-harbor'); }
  else if (s === 'bg') { startBgDemo(); setTimeout(() => openChat('c-first', { force: true }), 100); }
  else if (s === 'bgfail') { S2.bgFail = true; syncDemo(); startBgDemo(); setTimeout(() => openChat('c-first', { force: true }), 100); }
  else if (s === 'bgdone') { startBgDemo(); setTimeout(() => openChat('c-first', { force: true }), 100); }
  else if (s === 'fallback') { S2.fallback = true; syncDemo(); X.generateNew(); setTimeout(() => openChat('c-harbor'), 1200); }
  else if (s === 'auto') { S2.auto = true; syncDemo(); X.generateNew(); setTimeout(() => openChat('c-harbor'), 600); }
  else if (s === 'sheet') openThisChat();
  else if (s === 'sheet-local') { curChat().localToggles = true; curChat().localVals = { narr: false, tone: 1, nick: 'Juno' }; openThisChat(); }
  else if (s === 'persona') { openThisChat(); setTimeout(() => { const b = $('#s2PersonaRow'); if (b) b.click(); }, 300); }
  else if (s === 'home') goHome();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else setTimeout(start, 0);
})();
