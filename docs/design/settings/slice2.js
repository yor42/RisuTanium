/* Settings slice 2 mockup: presets (switcher, library, CRUD, live save with undo, slots, header chip). Synthetic mockup; not proof of native behaviour or performance.
   Standalone (no network, no dependencies). Loaded BEFORE slice1.js: it registers window.SS1_EXT (hooks that slice1.js calls) and receives slice 1's API in X.boot.
   Implements settings/SLICE2_SPEC.md (revision 1 + the coordinator's width rule for the chip). Sections: helpers, i18n, state, matching, preset operations, save/undo/restore,
   switcher, library, dialogs, settings sections, chip, keyboard, hooks, states, public API. */
(() => {
'use strict';
const X = window.SS1_EXT = {};
const DD = window.SS2_DATA, D = window.SS1_DATA;
const Q = new URLSearchParams(location.search);
let A = null;                                     // slice 1 API (set in X.boot)
/* DS-036: Ctrl+Z (library) and Alt+Z (anywhere in Settings) are listed in 단축키 and so also reserved: slot capture finds them as conflicts */
if (!D.rows.some((r) => r.id === 'keys.undoLib')) {
  [['keys.undoLib', '라이브러리 되돌리기 (프리셋 목록)', 'Undo in the library (preset list)', 'Ctrl+Z'], ['keys.undoAlt', '프리셋 작업·바꾸기 되돌리기 (설정 어디서나)', 'Undo a preset action or switch (anywhere in Settings)', 'Alt+Z']]
    .forEach(([id, ko, en, combo]) => { D.rows.push({ type: 'key', id, sec: 'keys.main', page: 'keys', ko, en, combo, syn: 'undo 실행 취소 되돌리기 hotkey 핫키 shortcut keyboard' }); });
}
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ic = (n, s, c) => A.ic(n, s, c);
const now = () => performance.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ icons (Lucide paths, inline; copied, not imported) */
const ICONS2 = {
  'star': '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>',
  'folder': '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  'folder-plus': '<path d="M12 10v6"/><path d="M9 13h6"/><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  'library-big': '<rect width="8" height="18" x="3" y="3" rx="1"/><path d="M7 3v18"/><path d="M20.4 18.9c.2.5-.1 1.1-.6 1.3l-1.9.7c-.5.2-1.1-.1-1.3-.6L11.1 5.1c-.2-.5.1-1.1.6-1.3l1.9-.7c.5-.2 1.1.1 1.3.6Z"/>',
  'grip-vertical': '<circle cx="9" cy="12" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="19" r="1"/>',
  'list-checks': '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',
  'download': '<path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/>',
  'upload': '<path d="M12 3v12"/><path d="m17 8-5-5-5 5"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>',
  'undo-2': '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/>',
  'redo-2': '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13"/>',
  'copy': '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  'history': '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
  'link': '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  'git-compare': '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><path d="M11 18H8a2 2 0 0 1-2-2V9"/>',
  'ellipsis-vertical': '<circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/>',
  'heart': '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  'moon': '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  'sun': '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  'book-open': '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
  'code': '<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>',
  'external-link': '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  'circle-alert': '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>',
  'loader': '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>',
  'square-check': '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="m9 12 2 2 4-4"/>',
  'square': '<rect width="18" height="18" x="3" y="3" rx="2"/>',
  'lock': '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
};

/* ------------------------------------------------------------------ i18n (SLICE2_SPEC section 10 keys plus mockup-only keys) */
const dEun = { 0: '은', 1: '은', 2: '는', 3: '은', 4: '는', 5: '는', 6: '은', 7: '은', 8: '은', 9: '는' };   // Korean reading of a final digit: 영 일 이 삼 사 오 육 칠 팔 구
let pEun = (name) => { const s = String(name).trim(); const last = s.slice(-1); if (/[0-9]/.test(last)) return dEun[last]; const c = last.charCodeAt(0); if (c >= 0xAC00 && c <= 0xD7A3) return (c - 0xAC00) % 28 === 0 ? '는' : '은'; return '은(는)'; };
const KO = {
  title: '설정 슬라이스 2 · 프리셋 목업', allPresets: (n) => `모든 프리셋 (${n})`, searchPresets: '프리셋 검색', recent: '최근', favs: '즐겨찾기', noFolder: '폴더 없음',
  sortLabel: '정렬', sortManual: '직접 정렬', sortRecent: '최근 사용', sortName: '이름', sortHint: '직접 정렬에서 순서를 바꿀 수 있어요',
  switchedPreset: (n) => `‘${n}’${A.pRo(n)} 바꿨어요`, genKeeps: (n) => `쓰는 중인 답변은 ‘${n}’ 프리셋을 그대로 써요`, undo: '실행 취소', redo: '다시 실행', inUse: '사용 중', managePresets: '프리셋 관리',
  openModelSettings: '모델·프리셋 설정 열기', newPreset: '새 프리셋', newFolder: '새 폴더', startFrom: '시작점', copyCurrent: '지금 프리셋 복사', defaultTemplate: '기본 템플릿', useNow: '만들고 바로 사용',
  presetName: '이름', folder: '폴더', duplicateName: '같은 이름이 있어요', nameNeeded: '이름을 입력해야 만들 수 있어요', create: '만들기', cancel: '취소', close: '닫기', done: '완료', ok: '확인',
  copySuffix: (n) => `${n} 사본`, deletePresetQ: (n) => `‘${n}’ 프리셋을 지울까요?`, lastPreset: '프리셋이 하나는 있어야 해요', lastPresetBody: '마지막 프리셋은 지울 수 없어요. 먼저 다른 프리셋을 만들어 주세요.',
  deletedPreset: (n) => `‘${n}’ 프리셋을 지웠어요`, deletedMany: (n) => `프리셋 ${n}개를 지웠어요`, deleteBtn: '지우기', deletePresetsQ: (n) => `선택한 프리셋 ${n}개를 지울까요?`,
  deleteFolderQ: (n, c) => `‘${n}’ 폴더를 지울까요? 안의 프리셋 ${c}개는 ‘폴더 없음’으로 옮겨져요`, deletedFolder: (n) => `‘${n}’ 폴더를 지웠어요`, deleteFolder: '폴더 삭제',
  detailFolder: '폴더', detailSlot: '단축키', detailFav: '즐겨찾기', detailNone: '없음', yes: '예', deleteActiveNote: (n) => `지금 쓰는 프리셋이에요. 지우면 가장 최근에 쓴 ‘${n}’${A.pRo(n)} 바뀌어요`,
  moveToFolder: '폴더로 이동', moveBtn: '이동', moved: (n, f) => `‘${n}’${A.pEul(n)} ‘${f}’(으)로 옮겼어요`, movedMany: (n, f) => `프리셋 ${n}개를 ‘${f}’(으)로 옮겼어요`,
  assignShortcut: '단축키 지정', slotEmpty: '비어 있음', slotNone: '없음', slotMoveNote: (k, f) => `${k}${pEun(k)} ‘${f}’에서 이 프리셋으로 옮겨져요`, move: '옮기기', slotUnassigned: (k) => `${k}에 지정된 프리셋이 없어요`, assign: '지정하기', assignBtn: '지정',
  slotAssigned: (k, n) => `${k}에 ‘${n}’${A.pEul(n)} 지정했어요`, slotCleared: (n) => `‘${n}’의 단축키를 없앴어요`, slotPick: '단축키로 쓸 키를 고르세요', slotCur: (n) => `지금: ${n}`, slotSame: '이미 이 프리셋에 지정돼 있어요',
  slotMigrated: 'Ctrl+1~9는 이제 순서가 아니라 지정한 프리셋으로 바뀌어요', dismiss: '알림 닫기',
  saved: '저장됨', saving: '저장 중…', saveFailed: '저장 실패 · 저장 다시 시도', scopeSection: (n) => `이 섹션은 프리셋 ‘${n}’에 저장돼요`,
  undoneChange: (r, a, b) => `‘${r}’ ${a} → ${b} 되돌렸어요`, redoneChange: (r, a, b) => `‘${r}’ ${a} → ${b} 다시 적용했어요`, undoneMany: (n) => `변경 ${n}개를 되돌렸어요`, redoneMany: (n) => `변경 ${n}개를 다시 적용했어요`, nothingUndo: '되돌릴 변경이 없어요', nothingRedo: '다시 할 변경이 없어요',
  restorePoints: '복원 지점', restoreOpen: '복원 지점…', changesCount: (n) => `변경 ${n}개`, beforeRestore: '복원 전', restoreBtn: '복원', restoreQ: (t) => `‘${t}’ 지점으로 되돌릴까요?`, restoreBody: (n) => `지금과 다른 설정 ${n}개가 바뀌어요. 지금 상태는 ‘복원 전’ 지점으로 남겨요.`, restored: (n) => `복원했어요 · 변경 ${n}개`,
  rpActivate: '프리셋을 쓰기 시작할 때', rpDaily: '하루에 한 번', rpManual: '직접', rpNone: '아직 복원 지점이 없어요', rpHint: '프리셋을 처음 고칠 때와 하루에 한 번 자동으로 만들어요. 프리셋마다 10개까지 남아요.',
  keepOnSwitch: '프리셋을 바꿔도 유지', chain: '프리셋 체인', chainNone: '없음', chainCount: (n) => `${n}개`, chainTitle: '프리셋 체인', chainHelp: '메시지를 보낼 때마다 이 목록에서 무작위로 하나가 쓰여요. 이름이 바뀌어도 체인은 그대로예요.', chainAdd: '체인에 넣을 프리셋', chainAddBtn: '넣기', chainRemove: (n) => `‘${n}’ 빼기`, chainEmpty: '체인이 비어 있어요',
  compare: '프리셋 비교', compareA: '왼쪽 프리셋', compareB: '오른쪽 프리셋', compareGo: '비교하기', compareTitle: '프리셋 비교', compareModel: '모델', compareNote: '모의 비교 화면이에요', compareSame: '같은 프리셋이에요. 서로 다른 프리셋을 골라 주세요',
  importPreview: '가져오기 미리 보기', keysNotIncluded: 'API 키는 파일에 들어 있지 않아요', import: '가져오기', importBtn: '가져오기', importFile: '모의 파일', importOne: '프리셋 1개 (균형.risup)', importBundle: '묶음 파일 (프리셋 3개)', importIncl: '들어 있는 것', inclParams: '파라미터', inclPrompt: '프롬프트', inclRegex: (n) => `정규식 ${n}개`, inclToggles: (n) => `토글 ${n}개`,
  importClash: (n) => `같은 이름이 있어 ‘${n}’${A.pRo(n)} 가져와요`, importDone: (n) => `프리셋 ${n}개를 가져왔어요`, importTo: '넣을 폴더', importNone: '가져올 프리셋을 골라 주세요', importCount: (n) => `가져오기 (${n})`,
  exportOne: '내보내기', exportedOne: (n) => `‘${n}’${A.pEul(n)} 내보냈어요 (.risup, 모의)`, exportedMany: (n) => `프리셋 ${n}개를 한 파일로 내보냈어요 (모의)`, exportNote: '폴더·즐겨찾기·단축키는 파일에 넣지 않아요',
  select: '선택', selectedCount: (n) => `${n}개 선택`, selectAll: '모두 선택', favAdd: '즐겨찾기 추가', favRemove: '즐겨찾기 해제', favToggle: '즐겨찾기',
  switchTo: '이 프리셋으로 바꾸기', rename: '이름 바꾸기', duplicate: '복제', up: '위로', down: '아래로', openStudio: '스튜디오에서 열기', del: '삭제', iconChange: '아이콘 바꾸기', iconPick: '프리셋 아이콘',
  movedAnnounce: (n, f, i) => `‘${n}’ 이동: ${f} ${i}번째`, atTop: '맨 위예요', atBottom: '맨 아래예요', favMoveNo: '즐겨찾기 묶음에서는 순서를 바꿀 수 없어요. 폴더 안에서 바꿔 주세요',
  folderName: '폴더 이름', folderNameNeeded: '이름을 입력해야 만들 수 있어요', folderMade: (n) => `‘${n}’ 폴더를 만들었어요`, folderRenamed: (n) => `폴더 이름을 ‘${n}’(으)로 바꿨어요`, folderWord: (n) => `${n} 폴더`, folderEmpty: '이 폴더는 비어 있어요',
  presetResults: (n) => `프리셋 ${n}개`, noPresetMatch: (q) => `‘${q}’에 맞는 프리셋이 없어요`, clearSearch: '검색어 지우기', searchResult: (q, n) => `‘${q}’ 결과 ${n}개`, more: (n) => `더 보기 (${n})`,
  renamed: (n) => `이름을 ‘${n}’(으)로 바꿨어요`, copied: (n) => `‘${n}’${A.pEul(n)} 만들었어요`, created: (n) => `‘${n}’ 프리셋을 만들었어요`, createdUse: (n) => `‘${n}’ 프리셋을 만들고 바로 쓰고 있어요`,
  crumb1: '모델·프리셋', crumb2: '프리셋', crumb3: '모든 프리셋', crumbNav: '현재 위치', backToPresets: '프리셋으로 돌아가기', backToPresetsShort: '프리셋',
  libSearchOpen: '프리셋 검색 열기', libSearchClose: '검색 닫기', grip: '끌어서 순서 바꾸기', gripDisabled: '직접 정렬에서만 끌 수 있어요', rowMenu: (n) => `‘${n}’ 메뉴`, folderMenu: (n) => `‘${n}’ 폴더 메뉴`, folderToggle: (n) => `‘${n}’ 폴더`,
  cardMenu: '프리셋 메뉴', changeIcon: (n) => `‘${n}’ 아이콘 바꾸기`, switcherLabel: '프리셋 바꾸기', switchAction: '프리셋 바꾸기…', switchActionEn: 'Switch preset…', libAction: '모든 프리셋 보기…', libActionEn: 'Show all presets…', grpAction: '바로 하기',
  chipLabel: (n, m) => `프리셋: ${n} · ${m}`, chipChanged: (n, m) => `프리셋을 ‘${n}’${A.pRo(n)} 바꿨어요 · ${m}`, chipMenu: '프리셋 메뉴', chatMore: '이 채팅 메뉴', chatSub: '숲길 여행 · 이틀째', charName: '세라핀',
  slotKeys: '프리셋 단축키', slotRow: (n) => `슬롯 ${n}`, slotSelect: (n) => `슬롯 ${n}에 지정할 프리셋`, slotRecap: '키 바꾸기', slotCapture: '키를 누르세요 · Esc로 취소', slotNeedMod: 'Ctrl이나 Alt와 함께 눌러 주세요', slotConflict: (k, w) => `${k}${pEun(k)} ‘${w}’${A.pGwa(w)} 겹쳐요. 다른 키를 눌러 주세요`, slotKeySet: (n, k) => `슬롯 ${n}의 키를 ${k}(으)로 바꿨어요`, slotDefault: '기본 Ctrl+숫자', slotPhoneNote: '키보드를 연결하면 바꿀 수 있어요',
  iconTitle: '프리셋 아이콘', iconSet: '아이콘을 바꿨어요',
  genNote: (n) => `‘${n}’ 프리셋으로 답변을 쓰는 중`, genIdle: '', demoPs: '프리셋 데모', demoSet: '데이터 세트', demoGen: '답변 작성 중으로 두기', demoFail: '다음 저장 실패시키기', demoState: '프리셋 상태', demoGo: '열기',
  setDemo: '데모 (60개)', setStress: '많이 (300개)', setOne: '하나', setFresh: '처음 (12개)', unavailPicker: '목록에서 고르기', studioSub: '스튜디오에서 열기',
  retryDone: '다시 저장했어요', dirty: '저장하지 않은 변경', unnamed: '이름 없음',
};
const EN = {
  title: 'Settings slice 2 · presets mockup', allPresets: (n) => `All presets (${n})`, searchPresets: 'Search presets', recent: 'Recent', favs: 'Favourites', noFolder: 'No folder',
  sortLabel: 'Sort', sortManual: 'Manual', sortRecent: 'Recently used', sortName: 'Name', sortHint: 'Switch to manual order to rearrange',
  switchedPreset: (n) => `Switched to "${n}"`, genKeeps: (n) => `The reply being written keeps "${n}"`, undo: 'Undo', redo: 'Redo', inUse: 'In use', managePresets: 'Manage presets',
  openModelSettings: 'Open Models & presets settings', newPreset: 'New preset', newFolder: 'New folder', startFrom: 'Start from', copyCurrent: 'Copy current preset', defaultTemplate: 'Default template', useNow: 'Create and use now',
  presetName: 'Name', folder: 'Folder', duplicateName: 'A preset with this name exists', nameNeeded: 'Enter a name to create it', create: 'Create', cancel: 'Cancel', close: 'Close', done: 'Done', ok: 'OK',
  copySuffix: (n) => `${n} copy`, deletePresetQ: (n) => `Delete "${n}"?`, lastPreset: 'You need at least one preset', lastPresetBody: "The last preset can't be deleted. Create another preset first.",
  deletedPreset: (n) => `Deleted "${n}"`, deletedMany: (n) => `Deleted ${n} presets`, deleteBtn: 'Delete', deletePresetsQ: (n) => `Delete the ${n} selected presets?`,
  deleteFolderQ: (n, c) => `Delete the "${n}" folder? Its ${c} presets move to No folder.`, deletedFolder: (n) => `Deleted the "${n}" folder`, deleteFolder: 'Delete folder',
  detailFolder: 'Folder', detailSlot: 'Shortcut', detailFav: 'Favourite', detailNone: 'None', yes: 'Yes', deleteActiveNote: (n) => `This is the preset in use. Deleting it switches to the most recent one, "${n}".`,
  moveToFolder: 'Move to folder', moveBtn: 'Move', moved: (n, f) => `Moved "${n}" to "${f}"`, movedMany: (n, f) => `Moved ${n} presets to "${f}"`,
  assignShortcut: 'Assign shortcut', slotEmpty: 'Empty', slotNone: 'None', slotMoveNote: (k, f) => `${k} moves from "${f}" to this preset`, move: 'Move', slotUnassigned: (k) => `No preset is assigned to ${k}`, assign: 'Assign', assignBtn: 'Assign',
  slotAssigned: (k, n) => `Assigned "${n}" to ${k}`, slotCleared: (n) => `Removed the shortcut of "${n}"`, slotPick: 'Pick the key for this preset', slotCur: (n) => `Now: ${n}`, slotSame: 'Already assigned to this preset',
  slotMigrated: 'Ctrl+1–9 now go to the presets you assign, not to list positions', dismiss: 'Dismiss notice',
  saved: 'Saved', saving: 'Saving…', saveFailed: "Couldn't save · Retry save", scopeSection: (n) => `This section is saved in preset "${n}"`,
  undoneChange: (r, a, b) => `Undid "${r}" ${a} → ${b}`, redoneChange: (r, a, b) => `Redid "${r}" ${a} → ${b}`, undoneMany: (n) => `Undid ${n} changes`, redoneMany: (n) => `Redid ${n} changes`, nothingUndo: 'Nothing to undo', nothingRedo: 'Nothing to redo',
  restorePoints: 'Restore points', restoreOpen: 'Restore points…', changesCount: (n) => `${n} changes`, beforeRestore: 'Before restore', restoreBtn: 'Restore', restoreQ: (t) => `Go back to "${t}"?`, restoreBody: (n) => `${n} settings that differ from now will change. The current state is kept as a "Before restore" point.`, restored: (n) => `Restored · ${n} changes`,
  rpActivate: 'When the preset became active', rpDaily: 'Once a day', rpManual: 'Manual', rpNone: 'No restore points yet', rpHint: 'Made automatically at the first edit of a preset and once a day. Up to 10 per preset.',
  keepOnSwitch: 'Keep on preset switch', chain: 'Preset chain', chainNone: 'None', chainCount: (n) => `${n}`, chainTitle: 'Preset chain', chainHelp: 'On every send, one preset from this list is used at random. Renaming a preset keeps the chain intact.', chainAdd: 'Preset to add to the chain', chainAddBtn: 'Add', chainRemove: (n) => `Remove "${n}"`, chainEmpty: 'The chain is empty',
  compare: 'Compare presets', compareA: 'Left preset', compareB: 'Right preset', compareGo: 'Compare', compareTitle: 'Compare presets', compareModel: 'Model', compareNote: 'Simulated compare view', compareSame: 'Same preset. Pick two different presets',
  importPreview: 'Import preview', keysNotIncluded: 'API keys are not in the file', import: 'Import', importBtn: 'Import', importFile: 'Simulated file', importOne: '1 preset (Balanced.risup)', importBundle: 'Bundle (3 presets)', importIncl: 'Included', inclParams: 'Parameters', inclPrompt: 'Prompt', inclRegex: (n) => `${n} regex`, inclToggles: (n) => `${n} toggles`,
  importClash: (n) => `A preset with this name exists, so it is imported as "${n}"`, importDone: (n) => `Imported ${n} presets`, importTo: 'Target folder', importNone: 'Pick presets to import', importCount: (n) => `Import (${n})`,
  exportOne: 'Export', exportedOne: (n) => `Exported "${n}" (.risup, simulated)`, exportedMany: (n) => `Exported ${n} presets to one file (simulated)`, exportNote: 'Folder, favourite and shortcut are not put in the file',
  select: 'Select', selectedCount: (n) => `${n} selected`, selectAll: 'Select all', favAdd: 'Add to favourites', favRemove: 'Remove from favourites', favToggle: 'Favourite',
  switchTo: 'Switch to this preset', rename: 'Rename', duplicate: 'Duplicate', up: 'Move up', down: 'Move down', openStudio: 'Open in Studio', del: 'Delete', iconChange: 'Change icon', iconPick: 'Preset icon',
  movedAnnounce: (n, f, i) => `Moved "${n}": ${f}, position ${i}`, atTop: 'Already at the top', atBottom: 'Already at the bottom', favMoveNo: "Order can't be changed in the favourites group. Rearrange inside a folder",
  folderName: 'Folder name', folderNameNeeded: 'Enter a name to create it', folderMade: (n) => `Created the "${n}" folder`, folderRenamed: (n) => `Renamed the folder to "${n}"`, folderWord: (n) => `${n} folder`, folderEmpty: 'This folder is empty',
  presetResults: (n) => `${n} presets`, noPresetMatch: (q) => `No presets match "${q}"`, clearSearch: 'Clear search', searchResult: (q, n) => `${n} results for "${q}"`, more: (n) => `Show more (${n})`,
  renamed: (n) => `Renamed to "${n}"`, copied: (n) => `Created "${n}"`, created: (n) => `Created preset "${n}"`, createdUse: (n) => `Created "${n}" and switched to it`,
  crumb1: 'Models & presets', crumb2: 'Presets', crumb3: 'All presets', crumbNav: 'You are here', backToPresets: 'Back to Presets', backToPresetsShort: 'Presets',
  libSearchOpen: 'Open preset search', libSearchClose: 'Close search', grip: 'Drag to reorder', gripDisabled: 'Dragging works in manual order only', rowMenu: (n) => `Menu for "${n}"`, folderMenu: (n) => `Menu for the "${n}" folder`, folderToggle: (n) => `"${n}" folder`,
  cardMenu: 'Preset menu', changeIcon: (n) => `Change the icon of "${n}"`, switcherLabel: 'Switch preset', switchAction: 'Switch preset…', switchActionEn: 'Switch preset…', libAction: 'Show all presets…', libActionEn: 'Show all presets…', grpAction: 'Actions',
  chipLabel: (n, m) => `Preset: ${n} · ${m}`, chipChanged: (n, m) => `Preset changed to "${n}" · ${m}`, chipMenu: 'Preset menu', chatMore: 'Chat menu', chatSub: 'Forest road · day two', charName: 'Seraphina',
  slotKeys: 'Preset shortcuts', slotRow: (n) => `Slot ${n}`, slotSelect: (n) => `Preset for slot ${n}`, slotRecap: 'Change key', slotCapture: 'Press a key · Esc to cancel', slotNeedMod: 'Press it together with Ctrl or Alt', slotConflict: (k, w) => `${k} clashes with "${w}". Press another key`, slotKeySet: (n, k) => `Slot ${n} key is now ${k}`, slotDefault: 'Default Ctrl+digit', slotPhoneNote: 'Connect a keyboard to change shortcuts',
  iconTitle: 'Preset icon', iconSet: 'Icon changed',
  genNote: (n) => `Writing a reply with preset "${n}"`, genIdle: '', demoPs: 'Preset demo', demoSet: 'Data set', demoGen: 'Keep a reply generating', demoFail: 'Fail the next save', demoState: 'Preset state', demoGo: 'Open',
  setDemo: 'Demo (60)', setStress: 'Stress (300)', setOne: 'One', setFresh: 'Fresh (12)', unavailPicker: 'Pick from the list', studioSub: 'Open in Studio',
  retryDone: 'Saved again', dirty: 'Unsaved change', unnamed: 'Untitled',
};
/* ---- review fixes (R-15): one particle helper for everything. Final Hangul syllable; digits by their Korean reading; Latin by the letter name; (으)로 style only when unknown. */
const REG = { 'L': 1, 'R': 1 }, OTH = { 'M': 1, 'N': 1 };           // letter names 엘 알 end in ㄹ; 엠 엔 end in another consonant; every other letter name ends in a vowel
const DIGK = { 0: 'o', 1: 'l', 2: 'n', 3: 'o', 4: 'n', 5: 'n', 6: 'o', 7: 'l', 8: 'l', 9: 'n' };   // 영 일 이 삼 사 오 육 칠 팔 구: o other final, l final ㄹ, n none
function finalOf(name) {
  const s = String(name || ''); for (let i = s.length - 1; i >= 0; i--) {
    const ch = s[i], c = ch.charCodeAt(0);
    if (c >= 0xAC00 && c <= 0xD7A3) { const j = (c - 0xAC00) % 28; return j === 0 ? 'n' : j === 8 ? 'l' : 'o'; }
    if (/[0-9]/.test(ch)) return DIGK[ch];
    if (/[A-Za-z]/.test(ch)) { const u = ch.toUpperCase(); return REG[u] ? 'l' : OTH[u] ? 'o' : 'n'; }
  }
  return null;
}
function josa(name, kind) {
  const f = finalOf(name);
  if (kind === 'ro') return f === null ? '(으)로' : (f === 'o' ? '으로' : '로');
  if (kind === 'eul') return f === null ? '을(를)' : (f === 'n' ? '를' : '을');
  if (kind === 'eun') return f === null ? '은(는)' : (f === 'n' ? '는' : '은');
  return f === null ? '와(과)' : (f === 'n' ? '와' : '과');
}
pEun = (name) => josa(name, 'eun');
const cl = (n, m = 28) => { n = String(n); return n.length > m ? n.slice(0, m - 1) + '…' : n; };   // R-13: long names are clipped (one line) in toasts and titles; the full name stays in tooltips
const NAME_MAX = 60;
const ICON_KO = { 'bookmark': '북마크', 'star': '별', 'heart': '하트', 'moon': '달', 'sun': '해', 'book-open': '펼친 책', 'code': '코드', 'zap': '번개', 'wand': '마법봉', 'pencil': '연필', 'message-square': '말풍선', 'languages': '번역' };
const ICON_EN = { 'bookmark': 'Bookmark', 'star': 'Star', 'heart': 'Heart', 'moon': 'Moon', 'sun': 'Sun', 'book-open': 'Open book', 'code': 'Code', 'zap': 'Lightning', 'wand': 'Magic wand', 'pencil': 'Pencil', 'message-square': 'Speech bubble', 'languages': 'Translate' };
Object.assign(KO, {
  switchedPreset: (n) => `‘${cl(n)}’${josa(n, 'ro')} 바꿨어요`, deleteActiveNote: (n) => `지금 쓰는 프리셋이에요. 지우면 가장 최근에 쓴 ‘${cl(n)}’${josa(n, 'ro')} 바뀌어요`,
  moved: (n, f) => `‘${cl(n)}’${josa(n, 'eul')} ‘${cl(f)}’${josa(f, 'ro')} 옮겼어요`, movedMany: (n, f) => `프리셋 ${n}개를 ‘${cl(f)}’${josa(f, 'ro')} 옮겼어요`,
  slotAssigned: (k, n) => `${k}에 ‘${cl(n)}’${josa(n, 'eul')} 지정했어요`, slotCleared: (n) => `‘${cl(n)}’의 단축키를 없앴어요`, slotMoveNote: (k, f) => `${k}${josa(k, 'eun')} ‘${cl(f)}’에서 이 프리셋으로 옮겨져요`,
  importClash: (n) => `같은 이름이 있어 ‘${n}’${josa(n, 'ro')} 가져와요`, exportedOne: (n) => `‘${cl(n)}’${josa(n, 'eul')} 내보냈어요 (.risup, 모의)`, folderRenamed: (n) => `폴더 이름을 ‘${cl(n)}’${josa(n, 'ro')} 바꿨어요`, renamed: (n) => `이름을 ‘${cl(n)}’${josa(n, 'ro')} 바꿨어요`,
  copied: (n) => `‘${cl(n)}’${josa(n, 'eul')} 만들었어요`, chipChanged: (n, m) => `프리셋을 ‘${n}’${josa(n, 'ro')} 바꿨어요 · ${m}`, slotConflict: (k, w) => `${k}${josa(k, 'eun')} ‘${w}’${josa(w, 'gwa')} 겹쳐요. 다른 키를 눌러 주세요`, slotKeySet: (n, k) => `슬롯 ${n}의 키를 ${k}${josa(k, 'ro')} 바꿨어요`,
  deletedPreset: (n) => `‘${cl(n)}’ 프리셋을 지웠어요`, created: (n) => `‘${cl(n)}’ 프리셋을 만들었어요`, createdUse: (n) => `‘${cl(n)}’ 프리셋을 만들고 바로 쓰고 있어요`,
  genKeeps: (n) => `쓰는 중인 답변은 ‘${cl(n)}’ 프리셋을 그대로 써요`,
  nothingUndoPreset: (n) => `‘${cl(n)}’ 프리셋에는 되돌릴 변경이 없어요`, undoLabel: (r) => `실행 취소: ${r}`, redoLabel: (r) => `다시 실행: ${r}`,
  // library undo stack and 최근 삭제 (DS-024 / DS-028)
  trashTitle: '최근 삭제', trashOpen: (n) => `최근 삭제 (${n})`, trashEmpty: '최근에 지운 프리셋이 없어요', trashHint: '다시 열 때까지 보관해요. 30일이 지나면 사라져요 (모의 화면에서는 이 화면을 닫을 때까지).', purgeBtn: '영구 삭제', purgeQ: (n) => `‘${cl(n)}’${josa(n, 'eul')} 영구 삭제할까요?`, purgeBody: '영구 삭제하면 되돌릴 수 없어요.', deletedOn: (d) => `${d}에 지웠어요`, restoredTrash: (n) => `‘${cl(n)}’ 프리셋을 복원했어요`, purged: (n) => `‘${cl(n)}’ 프리셋을 영구 삭제했어요`, moreMenu: '더 보기 메뉴',
  nothingLib: '되돌릴 라이브러리 작업이 없어요', libUndone: (l) => `되돌렸어요: ${l}`, labDelete: (n) => `‘${cl(n)}’ 지우기`, labDeleteMany: (n) => `프리셋 ${n}개 지우기`, labFolderDelete: (n) => `‘${cl(n)}’ 폴더 지우기`, labMove: (n) => `‘${cl(n)}’ 옮기기`, labMoveMany: (n) => `프리셋 ${n}개 옮기기`, labRename: (n) => `‘${cl(n)}’ 이름 바꾸기`, labSlot: (k) => `${k} 지정`, labFolderMake: (n) => `‘${cl(n)}’ 폴더 만들기`, labFolderRename: (n) => `‘${cl(n)}’ 폴더 이름 바꾸기`,
  folderGone: '폴더가 없어서 ‘폴더 없음’에 두었어요', slotTakenSkip: (k) => `${k}${josa(k, 'eun')} 다른 프리셋이 쓰고 있어서 비워 뒀어요`, loadoutBack: '체인과 로드아웃에도 다시 넣었어요',
  // failed save (DS-026)
  failGuardTitle: '저장하지 못한 변경이 있어요', failGuardBody: (n) => `‘${cl(n)}’ 프리셋의 변경을 저장하지 못했어요. 어떻게 할까요?`, retry: '저장 다시 시도', discard: '변경 취소', rowFailed: '저장 실패', chipFailed: '저장 실패', discarded: '저장하지 못한 변경을 취소했어요',
  // locks (DS-025)
  sharedChip: '모든 프리셋 공통', sharedTip: '이 값은 프리셋 밖에 저장돼요. 프리셋을 바꿔도 그대로예요.', lockOffTitle: '공통 값을 이 프리셋에 넣을까요?', lockOffBody: (n) => `잠금을 끄면 공통 값이 지금 프리셋 ‘${cl(n)}’에만 들어가요. 다른 프리셋은 그대로예요.`, lockOffBtn: '끄기', lockedNow: '잠금을 켰어요. 지금 값이 모든 프리셋의 공통 값이 돼요',
  // secrets (DS-027)
  keyKept: '키는 그대로 두었어요', keyNoHistory: '키는 되돌리기 기록에 넣지 않아요',
  // slots
  slotTakeQ: (k, n) => `${k}${josa(k, 'eul')} ‘${cl(n)}’에서 옮길까요?`, slotTakeBody: '옮기면 그 프리셋은 단축키가 없어져요. 라이브러리에서 되돌릴 수 있어요.', slotMovedMsg: (k, n) => `${k}${josa(k, 'eul')} ‘${cl(n)}’에서 옮겼어요`, slotReserved: (k) => `${k}${josa(k, 'eun')} 복사·붙여넣기 같은 기본 동작에 쓰여요. 다른 키를 눌러 주세요`,
  // names (DS-031)
  nameCount: (n) => `${n}/${NAME_MAX}`, folderDup: '같은 이름의 폴더가 있어요',
  // chain / loadouts (DS-030)
  usesLine: (c, l) => `${[c ? `체인 ${c}개` : '', l ? `로드아웃 ${l}개` : ''].filter(Boolean).join(', ')}에서 빠져요`,
  // export (DS-032)
  exportBundle: '묶음 내보내기', exportOrg: '폴더·즐겨찾기 포함', exportOrgHint: '새 기기로 옮길 때만 켜세요. 단축키는 넣지 않아요.', exportDo: '내보내기',
  // import failure states (R-17)
  impOk: '정상 파일', impBad: '읽을 수 없는 파일', impFormat: '프리셋 파일이 아닌 파일', impNewer: '더 새 버전의 파일', impPartial: '일부만 가져올 수 있는 묶음', impEmpty: '빈 묶음 파일',
  impBadMsg: '파일을 읽을 수 없어요. 파일이 깨졌을 수 있어요. 라이브러리는 그대로예요.', impFormatMsg: '프리셋 파일이 아니에요 (.risup 파일을 골라 주세요). 라이브러리는 그대로예요.', impNewerMsg: '더 새 버전에서 만든 파일이에요. 앱을 업데이트한 뒤 다시 시도해 주세요. 라이브러리는 그대로예요.', impEmptyMsg: '파일에 프리셋이 없어요. 라이브러리는 그대로예요.',
  impPartialMsg: (ok, bad) => `${ok}개만 가져올 수 있어요. ${bad}개는 건너뛰어요.`, impInvalid: (why) => `건너뜀: ${why}`, impCaution: '파일에 든 정규식과 토글은 직접 만든 것이 아닐 수 있어요. 가져온 뒤 스튜디오에서 확인해 주세요.', impFileLabel: '모의 파일',
  // DS-029
  msgPreset: (n) => `이 답변은 ‘${cl(n)}’ 프리셋으로 만들었어요. 다시 쓰기·이어 쓰기·넘겨 보기도 같은 프리셋을 써요`,
  restoreKeyNote: '키는 그대로 두었어요', iconNames: ICON_KO,
});
Object.assign(EN, {
  switchedPreset: (n) => `Switched to "${cl(n)}"`, deletedPreset: (n) => `Deleted "${cl(n)}"`, created: (n) => `Created preset "${cl(n)}"`, createdUse: (n) => `Created "${cl(n)}" and switched to it`, renamed: (n) => `Renamed to "${cl(n)}"`, copied: (n) => `Created "${cl(n)}"`, moved: (n, f) => `Moved "${cl(n)}" to "${cl(f)}"`, genKeeps: (n) => `The reply being written keeps "${cl(n)}"`,
  nothingUndoPreset: (n) => `Preset "${cl(n)}" has nothing to undo`, undoLabel: (r) => `Undo: ${r}`, redoLabel: (r) => `Redo: ${r}`,
  trashTitle: 'Recently deleted', trashOpen: (n) => `Recently deleted (${n})`, trashEmpty: 'No recently deleted presets', trashHint: 'Kept until you reopen the app, or 30 days (in this mockup: until this page closes).', purgeBtn: 'Delete forever', purgeQ: (n) => `Delete "${cl(n)}" forever?`, purgeBody: "This can't be undone.", deletedOn: (d) => `Deleted ${d}`, restoredTrash: (n) => `Restored "${cl(n)}"`, purged: (n) => `Deleted "${cl(n)}" forever`, moreMenu: 'More menu',
  nothingLib: 'Nothing to undo in the library', libUndone: (l) => `Undid: ${l}`, labDelete: (n) => `delete "${cl(n)}"`, labDeleteMany: (n) => `delete ${n} presets`, labFolderDelete: (n) => `delete folder "${cl(n)}"`, labMove: (n) => `move "${cl(n)}"`, labMoveMany: (n) => `move ${n} presets`, labRename: (n) => `rename "${cl(n)}"`, labSlot: (k) => `assign ${k}`, labFolderMake: (n) => `create folder "${cl(n)}"`, labFolderRename: (n) => `rename folder "${cl(n)}"`,
  folderGone: 'The folder is gone, so it went to No folder', slotTakenSkip: (k) => `${k} is used by another preset, so it was left empty`, loadoutBack: 'Chain and loadout entries were put back too',
  failGuardTitle: 'Some changes were not saved', failGuardBody: (n) => `Changes to "${cl(n)}" could not be saved. What now?`, retry: 'Retry save', discard: 'Discard changes', rowFailed: 'Not saved', chipFailed: 'Not saved', discarded: 'Discarded the unsaved changes',
  sharedChip: 'Shared by all presets', sharedTip: 'This value is stored outside the preset and stays when you switch.', lockOffTitle: 'Put the shared values into this preset?', lockOffBody: (n) => `Turning the lock off puts the shared values into the current preset "${cl(n)}" only. Other presets are unchanged.`, lockOffBtn: 'Turn off', lockedNow: 'Lock on. The current values become shared by all presets',
  keyKept: 'Keys were left as they are', keyNoHistory: 'Keys are not kept in the undo history',
  slotTakeQ: (k, n) => `Take ${k} from "${cl(n)}"?`, slotTakeBody: 'That preset will have no shortcut. You can undo this in the library.', slotMovedMsg: (k, n) => `Took ${k} from "${cl(n)}"`, slotReserved: (k) => `${k} is used for basic actions like copy and paste. Press another key`,
  nameCount: (n) => `${n}/${NAME_MAX}`, folderDup: 'A folder with this name exists',
  usesLine: (c, l) => `Removed from ${[c ? `${c} chain` : '', l ? `${l} loadout${l > 1 ? 's' : ''}` : ''].filter(Boolean).join(' and ')}`,
  exportBundle: 'Export bundle', exportOrg: 'Include folders and favourites', exportOrgHint: 'Turn on only when moving to a new device. Shortcuts are not included.', exportDo: 'Export',
  impOk: 'Valid file', impBad: 'Unreadable file', impFormat: 'Not a preset file', impNewer: 'File from a newer version', impPartial: 'Partly importable bundle', impEmpty: 'Empty bundle',
  impBadMsg: "The file can't be read. It may be damaged. The library is unchanged.", impFormatMsg: 'This is not a preset file (pick a .risup file). The library is unchanged.', impNewerMsg: 'This file was made by a newer version. Update the app and try again. The library is unchanged.', impEmptyMsg: 'The file has no presets. The library is unchanged.',
  impPartialMsg: (ok, bad) => `Only ${ok} can be imported. ${bad} will be skipped.`, impInvalid: (why) => `Skipped: ${why}`, impCaution: "Regex and toggles inside a file may not be written by you. Check them in Studio after importing.", impFileLabel: 'Simulated file',
  msgPreset: (n) => `This reply was made with preset "${cl(n)}". Regenerate, continue and swipe use the same preset`,
  restoreKeyNote: 'Keys were left as they are', iconNames: ICON_EN,
});
/* ---- re-review fixes (rev 2.1): DS-038 messages that embed a user name never put a particle after it (KO); the helper stays for fixed copy (key names) */
Object.assign(KO, {
  switchedPreset: (n) => `프리셋을 바꿨어요 · ‘${cl(n)}’`, chipChanged: (n, m) => `프리셋을 바꿨어요 · ‘${n}’ · ${m}`,
  deleteActiveNote: (n) => `지금 쓰는 프리셋이에요. 지우면 가장 최근에 쓴 프리셋으로 바뀌어요: ‘${cl(n)}’`,
  moved: (n, f) => `프리셋을 옮겼어요: ‘${cl(n)}’ → ‘${cl(f)}’`, movedMany: (n, f) => `프리셋 ${n}개를 옮겼어요: ‘${cl(f)}’`,
  slotAssigned: (k, n) => `${k} 단축키를 지정했어요: ‘${cl(n)}’`, slotCleared: (n) => `단축키를 없앴어요: ‘${cl(n)}’`,
  slotMoveNote: (k, f) => `${k}${josa(k, 'eun')} 지금 ‘${cl(f)}’ 프리셋이 쓰고 있어요. 이 프리셋으로 옮겨져요`,
  importClash: (n) => `같은 이름이 있어 다른 이름으로 가져와요: ‘${n}’`, exportedOne: (n) => `내보냈어요: ‘${cl(n)}’ (.risup, 모의)`,
  folderRenamed: (n) => `폴더 이름을 바꿨어요: ‘${cl(n)}’`, renamed: (n) => `이름을 바꿨어요: ‘${cl(n)}’`, copied: (n) => `프리셋을 복제했어요: ‘${cl(n)}’`,
  slotConflict: (k, w) => `${k} 키는 이미 쓰고 있어요: ‘${w}’. 다른 키를 눌러 주세요`,
  purgeQ: (n) => `‘${cl(n)}’ 프리셋을 영구 삭제할까요?`, noPresetMatch: (q) => `맞는 프리셋이 없어요: ‘${q}’`,
  scopeSection: (n) => `이 섹션의 값은 프리셋에 저장돼요: ‘${n}’`,
  lockOffBody: (n) => `잠금을 끄면 공통 값이 지금 프리셋에만 들어가요 (‘${cl(n)}’). 다른 프리셋은 그대로예요.`,
  slotTakeQ: (k) => `${k} 단축키를 옮길까요?`,
  slotTakeBody: (n, k2) => [n ? `지금 ‘${cl(n)}’ 프리셋이 쓰고 있어요. 그 프리셋은 단축키가 없어져요.` : '', k2 ? `이 프리셋의 ${k2}${josa(k2, 'eun')} 비게 돼요.` : '', '라이브러리에서 되돌릴 수 있어요.'].filter(Boolean).join(' '),
  slotMovedMsg: (k, n) => `${k} 단축키를 옮겼어요 (이전: ‘${cl(n)}’)`, slotVacated: (k) => `${k}${josa(k, 'eun')} 비었어요`, slotVacateNote: (k) => `${k}${josa(k, 'eun')} 비게 돼요`,
  slotNeedMod: 'Ctrl과 함께 1–9 키를 눌러 주세요', slotOnly: '프리셋 단축키는 Ctrl+1–9만 쓸 수 있어요. 다른 키를 눌러 주세요', slotZero: 'Ctrl+0은 쓰지 않아요. Ctrl+1–9 중에서 골라 주세요',
  usesLine: (c, l, e) => `${[c ? `체인 ${c}곳` : '', l ? `로드아웃 ${l}곳` : ''].filter(Boolean).join(', ')}에서 빠지게 돼요${e ? `. 로드아웃 ${e}곳은 비게 돼요` : ''}`,
  exportOrgHint: '새 기기로 옮길 때만 켜세요.', exportNote: '폴더·즐겨찾기·단축키는 파일에 넣지 않아요', exportNoteOrg: '단축키는 파일에 넣지 않아요',
  trashHint: '30일 동안 보관해요. 그 뒤에는 사라져요.', toastLabel: '알림', luKeys: '(Ctrl+Z · Alt+Z)',
  untilPage: '앱을 닫을 때까지 Alt+Z로 되돌릴 수 있어요 (최근 50개까지)', untilPageMac: '앱을 닫을 때까지 ⌥Z로 되돌릴 수 있어요 (최근 50개까지)', until10s: '10초 안에 되돌리기 버튼이나 Alt+Z로 되돌릴 수 있어요', untilPurge: '영구 삭제하면 끝나요', untilPrev: 'Alt+Z로 되돌릴 수 있어요 · 다른 변경을 하거나 이전 프리셋을 지우면 끝나요', untilPrevMac: '⌥Z로 되돌릴 수 있어요 · 다른 변경을 하거나 이전 프리셋을 지우면 끝나요', untilConn: '키는 다시 넣어야 해요', untilRestore: '이 알림의 되돌리기 버튼은 10초 동안만 있어요',   // DD-223 / DS-166: how long undo lasts
  swap: '바꾸기', keySwapQ: (k, a, b) => `${k} 바꾸기: ‘${cl(a)}’ ↔ ‘${cl(b)}’`,
  keySwapBody: (mine, k) => `두 프리셋의 키가 서로 바뀌어요. 이쪽은 ${k}, 저쪽은 ${mine}. 라이브러리에서 되돌릴 수 있어요.`,
  keySwapped: (k, a, b) => `${k} 바꿨어요: ‘${cl(a)}’ ↔ ‘${cl(b)}’`, labKeySwap: (k) => `${k} 바꾸기`, keySwapSkip: '그 사이에 키가 또 바뀌어서 그대로 뒀어요',
  labCreate: (n) => `‘${cl(n)}’ 만들기`, labDuplicate: (n) => `‘${cl(n)}’ 복제`, labImport: (n) => `프리셋 ${n}개 가져오기`,
});
Object.assign(EN, {
  slotTakeQ: (k) => `Move ${k}?`,
  slotTakeBody: (n, k2) => [n ? `"${cl(n)}" uses it now and will have no shortcut.` : '', k2 ? `This preset's ${k2} will be empty.` : '', 'You can undo this in the library.'].filter(Boolean).join(' '),
  slotMovedMsg: (k, n) => `Moved ${k} (was "${cl(n)}")`, slotVacated: (k) => `${k} is now empty`, slotVacateNote: (k) => `${k} will be empty`,
  slotNeedMod: 'Press 1-9 together with Ctrl', slotOnly: 'Preset shortcuts can only be Ctrl+1-9. Press another key', slotZero: 'Ctrl+0 is not used. Pick one of Ctrl+1-9',
  usesLine: (c, l, e) => `Will be removed from ${[c ? `${c} chain${c > 1 ? 's' : ''}` : '', l ? `${l} loadout${l > 1 ? 's' : ''}` : ''].filter(Boolean).join(' and ')}${e ? `. ${e} loadout${e > 1 ? 's' : ''} will be empty` : ''}`,
  exportOrgHint: 'Turn on only when moving to a new device.', exportNote: 'Folders, favourites and shortcuts are not put in the file', exportNoteOrg: 'Shortcuts are not put in the file',
  trashHint: 'Kept for 30 days, then removed.', toastLabel: 'Notifications', luKeys: '(Ctrl+Z · Alt+Z)',
  untilPage: 'Undo with Alt+Z until you close the app (last 50 changes)', untilPageMac: 'Undo with ⌥Z until you close the app (last 50 changes)', until10s: 'Undo with the button or Alt+Z within 10 s', untilPurge: 'Ends if you delete it forever', untilPrev: 'Undo with Alt+Z until you make another change or delete the previous preset', untilPrevMac: 'Undo with ⌥Z until you make another change or delete the previous preset', untilConn: 'You need to enter the key again', untilRestore: 'The Undo button in this notice stays for 10 s',   // DD-223 / DS-166: how long undo lasts
  swap: 'Swap', keySwapQ: (k, a, b) => `Swap ${k}: "${cl(a)}" ↔ "${cl(b)}"`,
  keySwapBody: (mine, k) => `The two presets trade keys: this one gets ${k}, the other gets ${mine}. You can undo this in the library.`,
  keySwapped: (k, a, b) => `Swapped ${k}: "${cl(a)}" ↔ "${cl(b)}"`, labKeySwap: (k) => `swap ${k}`, keySwapSkip: 'The keys changed again in between, so they were left as they are',
  labCreate: (n) => `create "${cl(n)}"`, labDuplicate: (n) => `duplicate "${cl(n)}"`, labImport: (n) => `import ${n} presets`,
});
const L2 = { ko: KO, en: EN };
const t2 = (k, ...a) => { const v = L2[A.S.lang][k]; return typeof v === 'function' ? v(...a) : v; };

/* ------------------------------------------------------------------ state */
const CFG = { saveMs: 350, toastMs: 10000, toastGraceMs: 3000, failNext: 0, dayOffset: 0, maxUndo: 50, maxRp: 10, recents: 5, switcherChunk: 60, searchChunk: 30 };
const T0 = Date.now(), BASE_T = new Date(2026, 9, 26, 14, 30).getTime(), DAY = 86400000;
const NOWMS = () => BASE_T + CFG.dayOffset * DAY + (Date.now() - T0);
const ST = { state: 'saved', t: 0 };                                // live save status of the active preset
const SW = { open: false, mode: 'popover', q: '', items: [], act: -1, limit: 60, opener: null, hist: false, layout: null };
const LIB = { limit: 20, sort: 'manual', q: '', searchOpen: false, sel: null, anchor: null, rv: null, drag: null };
const S2 = { view: 'section', gen: false, reqPreset: null, migrated: !!DD.notice, tick: 5000, uid: 100, switchedTo: null, chainOpen: false, lastExport: [], capturing: null, restoreTimer: 0 };
const SLOT = DD.slots, CHAIN = DD.chain, FOLD = DD.folders, LOAD = DD.loadouts || [];
const SLOTKEY = {}; for (let n = 1; n <= 9; n++) SLOTKEY[n] = 'Ctrl+' + n;
const COLL = {};            // folder id -> true (collapsed) / false (open); remembered per device
let BASE = {}, PRESET_ROWS = [], SHADOW = {}, loading = false, PM = {};
const pend = {};            // text fields with an uncommitted edit: id -> { from }
const perf = { switcherOpen: [], key: [], folderToggle: [], libRender: [] };
let uidn = 1;

const reindex = () => { PM = {}; D.presets.forEach((p) => { if (p.folder && !FOLD.some((f) => f.id === p.folder)) p.folder = null; PM[p.id] = p; }); };   // R-02 safety net: a preset whose folder is gone belongs to 폴더 없음
const P = (id) => PM[id];
const act = () => P(A.S.presetActive) || D.presets[0];
const FM = () => Object.fromEntries(FOLD.map((f) => [f.id, f]));
const folderName = (fid) => { const f = FOLD.find((x) => x.id === fid); return f ? f.name : t2('noFolder'); };
const slotOf = (id) => { for (let n = 1; n <= 9; n++) if (SLOT[n] === id) return n; return 0; };
const slotLabel = (n) => SLOTKEY[n];
const mshort = (id) => { const m = A.MODEL[id]; if (!m) return id || '—'; const nm = A.mn(m); return nm.replace(/^Claude\s+/, ''); };
const modelFull = (id) => { const m = A.MODEL[id]; return m ? A.mn(m) : id; };
const nameTaken = (name, exceptId) => D.presets.some((p) => p.id !== exceptId && p.name.trim().toLowerCase() === name.trim().toLowerCase());
const uniq = (base) => { let n = base, i = 2; while (nameTaken(n)) { n = base + ' (' + i + ')'; i++; } return n; };
const fmtT = (ms) => {
  const d = new Date(ms), n = new Date(NOWMS()); const hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  const dd = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(); const diff = Math.round((dd(n) - dd(d)) / DAY);
  const ko = A.S.lang === 'ko';
  if (diff === 0) return (ko ? '오늘 ' : 'Today ') + hm; if (diff === 1) return (ko ? '어제 ' : 'Yesterday ') + hm;
  return ko ? `${d.getMonth() + 1}월 ${d.getDate()}일 ${hm}` : `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]} ${d.getDate()}, ${hm}`;
};

/* ------------------------------------------------------------------ matching (name, folder, model; 초성 and word starts via slice 1's rules, R-01) */
let Fv = 1;
function fieldsOf(p) {
  if (p._Fv === Fv && p._F) return p._F;
  const m = A.MODEL[p.model]; p._Fv = Fv;
  p._F = { name: A.mf(p.name), folder: A.mf(p.folder ? folderName(p.folder) : ''), model: A.mf(m ? [m.name, m.en || '', m.prov, m.kw || ''].join(' ') : '') };
  return p._F;
}
const JAMO = /^[ㄱ-ㅎ]+$/;
function parseQ(raw) { return String(raw || '').trim().split(/\s+/).map(A.normWord).filter(Boolean); }
function matchPreset(p, words) {          // -> { worst, sum } or null; every word must match some field (AND)
  const F = fieldsOf(p); let worst = 0, sum = 0;
  for (const w of words) {
    let best = 99; const one = w.length === 1 && !JAMO.test(w);
    let m = A.mw(F.name, w); if (m && !(one && m.r > 2)) best = m.r;
    if (best > 0) { m = A.mw(F.folder, w); if (m && m.r <= 2 && 4 + m.r < best) best = 4 + m.r; }
    if (best > 0) { m = A.mw(F.model, w); if (m && m.r <= 2 && 7 + m.r < best) best = 7 + m.r; }
    if (best === 99) return null;
    if (best > worst) worst = best; sum += best;
  }
  return { worst, sum };
}
function searchPresets(raw) {
  const words = parseQ(raw); if (!words.length) return [];
  const out = []; let i = 0;
  for (const p of D.presets) { const m = matchPreset(p, words); if (m) out.push({ p, worst: m.worst, sum: m.sum, ord: i }); i++; }
  out.sort((a, b) => a.worst - b.worst || a.sum - b.sum || a.ord - b.ord);
  return out;
}

/* ------------------------------------------------------------------ toast with an action (R-04: 10 s, paused while the pointer or focus is inside, never drops focus to body, announced once) */
let toastEl = null, toastT = 0, toastDue = 0, toastHold = false, toastGoneT = 0, toastRelease = () => {};
const announce = (msg) => { if (!msg) return; if (S2.ann && S2.ann.msg === msg && Date.now() - S2.ann.t < 2500) return; S2.ann = { msg, t: Date.now() }; A.announce(msg); };   // one announcement per message (the toast and the caller used to both speak)
function ensureToast() {
  if (toastEl) return toastEl;
  toastEl = document.createElement('div'); toastEl.className = 'ps-toast gone'; toastEl.setAttribute('data-part', 'settings-preset-toast'); toastEl.id = 'psToast'; toastEl.setAttribute('role', 'group'); toastEl.setAttribute('aria-label', t2('toastLabel')); toastEl.setAttribute('aria-hidden', 'true'); toastEl.inert = true;
  toastEl.innerHTML = '<div class="pt-txt" data-part="settings-toast-text"><span class="pt-msg"></span><span class="pt-sub"></span><span class="pt-sub pt-until" hidden></span></div><button type="button" data-part="settings-button" class="btn pt-act" hidden tabindex="-1"></button>';
  $('#app').appendChild(toastEl);
  const hold = () => { toastHold = true; clearTimeout(toastT); };
  const release = () => { if (!S2.toast) return; toastHold = false; clearTimeout(toastT); const left = Math.max(toastDue - Date.now(), CFG.toastGraceMs); toastDue = Date.now() + left; toastT = setTimeout(() => hideToast(true), left); };
  toastRelease = release; toastEl.addEventListener('pointerenter', hold); toastEl.addEventListener('pointerleave', () => { if (!toastEl.contains(document.activeElement)) release(); });
  toastEl.addEventListener('focusin', hold); toastEl.addEventListener('focusout', () => { setTimeout(() => { if (!toastEl.contains(document.activeElement) && !toastEl.matches(':hover')) release(); }, 0); });
  return toastEl;
}
function focusAfterToast() {
  let f = S2.toastNext && S2.toastNext(); S2.toastNext = null;
  if (!f || !f.isConnected) { if (A.S.open && S2.view === 'library') f = $('#psLibList [data-rv][tabindex="0"]') || $('#psLibList [data-rv]'); }
  if (!f || !f.isConnected) f = A.S.open ? ($('#pageScroll') || $('#backBtn')) : ($('#psChip') || $('#oSettings'));
  if (f) { if (f.tabIndex < 0 && !f.hasAttribute('tabindex')) f.tabIndex = -1; f.focus({ preventScroll: true }); }
}
function hideToast(expired) {
  const el = ensureToast(); clearTimeout(toastT); toastHold = false; const had = el.contains(document.activeElement);
  el.classList.remove('on'); el.inert = true; el.setAttribute('aria-hidden', 'true'); $('.pt-act', el).tabIndex = -1; S2.toast = null;
  if (toastGoneT && toastGoneT.cancel) toastGoneT.cancel(); toastGoneT = window.settingsTheme.afterMotion(el, () => { if (!S2.toast) { el.classList.add('gone'); el.removeAttribute('data-part-critical'); } }, 60);   /* R-12: a hidden toast carries no critical mark */     // N-08: visibility:hidden takes the button out of the tab order and the accessibility tree without relying on inert
  paintChip(); if (had) focusAfterToast();
  void expired;
}
/* DD-223 / DS-166: the one helper that says how long an Undo lasts. o.until = 'page' (Alt+Z, or ⌘Z on a Mac, works until the page is left: the LU stack), '10s' (the undo ends with the toast window), or a reason key
   that names the condition that ends it earlier: 'purge' (a delete forever in 최근 삭제), 'prev' (the previous preset is deleted), 'conn' (a deleted connection comes back without its key). The line is a second .pt-sub under the
   toast's own sub line (the sub line a call site passes is never replaced). */
const macUndo = () => { try { const x = window.__ss5a; if (x && x.P5 && x.P5.platform) return x.P5.platform === 'mac'; } catch (_) { /* no slice 5a on this page */ } return /Mac|iPhone|iPad/.test(navigator.platform || ''); };
function untilLine(u) {   // DS-171: the key is Alt+Z (⌥Z on a Mac), never Ctrl+Z or ⌘Z (those run the preset parameter undo); a reason adds what ends Undo
  const mac = macUndo(); const pg = t2(mac ? 'untilPageMac' : 'untilPage');
  if (u === 'page') return pg; if (u === '10s') return t2('until10s'); if (u === 'restore') return t2('untilRestore'); if (u === 'prev') return t2(mac ? 'untilPrevMac' : 'untilPrev');
  if (u === 'purge') return pg + ' · ' + t2('untilPurge'); if (u === 'conn') return pg + ' · ' + t2('untilConn'); return '';
}
function psToast(msg, o = {}) {
  const el = ensureToast(); clearTimeout(toastT); toastHold = false;
  $('.pt-msg', el).innerHTML = esc(msg).replace(/‘[^’]*’|&quot;.*?&quot;/g, (m) => `<span class="pt-name">${m}</span>`); $('.pt-msg', el).title = msg;      /* N-03: only the name is ellipsised (one line); the verb always stays readable */
  const sub = $('.pt-sub', el); sub.textContent = o.sub || ''; sub.hidden = !o.sub;
  const until = o.until ? untilLine(o.until) : ''; const un = $('.pt-until', el); un.textContent = until; un.hidden = !until;
  const b = $('.pt-act', el); if (o.action) { b.hidden = false; b.textContent = o.action.label; b.title = o.action.title || ''; b.tabIndex = 0; b.onclick = () => { const f = o.action.fn; hideToast(); f(); }; } else { b.hidden = true; b.title = ''; b.onclick = null; b.tabIndex = -1; }
  if (toastGoneT && toastGoneT.cancel) toastGoneT.cancel(); el.classList.remove('gone'); el.removeAttribute('aria-hidden'); el.setAttribute('aria-label', t2('toastLabel'));
  el.classList.add('on'); el.inert = false; el.dataset.kind = o.kind || '';
  { const crit = ['delete', 'folder', 'conn-delete'].includes(o.kind); el.toggleAttribute('data-part-critical', crit); $('.pt-txt', el).setAttribute('data-part', crit ? 'settings-critical-body' : 'settings-toast-text'); b.setAttribute('data-part', crit ? 'settings-critical-action' : 'settings-toast-action'); }   /* DS-072: the Undo after a delete is the only way back, so a pack gets tokens for it and no rule */ S2.toast = { msg, kind: o.kind || '', action: o.action ? o.action.label : '', ms: o.ms === undefined ? CFG.toastMs : o.ms, until: o.until || '' }; S2.toastNext = o.next || null;
  const ms = o.ms === undefined ? CFG.toastMs : o.ms; toastDue = Date.now() + ms; toastT = setTimeout(() => hideToast(true), ms); paintChip();
  if (document.body.classList.contains('dlg-open') || document.body.classList.contains('sw-open') || document.body.classList.contains('mp-open')) { toastHold = true; clearTimeout(toastT); }     // N-05: a toast never runs out behind a dialog
  announce(msg + (o.sub ? '. ' + o.sub : '') + (until ? '. ' + until : ''));
}


/* ------------------------------------------------------------------ preset-scoped values (DS-019: rows in 모델 / 파라미터 / 프롬프트 설정 and the reverse-proxy rows write into the active preset) */
const EDITABLE = ['switch', 'select', 'segmented', 'slider', 'number', 'text', 'secret', 'textarea'];
const isPR = (r) => !!r && EDITABLE.includes(r.type) && r.v !== undefined && (A.PRESET_SECS.has(r.sec) || r.scope === 'preset');
const same = (a, b) => (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 1e-9 : a === b);
/* DS-025: while a keep-on-switch lock is on, its fields live outside the preset (SHARED); switching never changes them. */
const LOCKS = {
  'models.keepAuxOnSwitch': ['models.subModel', 'models.sepModels', 'models.memModel', 'models.transModel', 'models.emoModel', 'models.otherModel'],
  'models.keepFallbackOnSwitch': ['models.fallbackModel', 'models.fallbackBlank', 'models.fallbackMem', 'models.fallbackTrans', 'models.fallbackEmo', 'models.fallbackOther'],
  'models.keepParamsOnSwitch': ['models.sepParams'],
};
const SHARED = {};
function lockOf(id) { for (const k in LOCKS) if (LOCKS[k].includes(id)) return k; return null; }
function isShared(id) { const k = lockOf(id); return !!k && !!A.ROW[k].v && id in SHARED; }
const isSecret = (id) => !!A.ROW[id] && A.ROW[id].type === 'secret';                 // DS-027: keys never enter undo history or restore points
const effVal = (p, id) => (isShared(id) ? SHARED[id] : p.id === A.S.presetActive ? A.ROW[id].v : (id === 'models.mainModel' ? p.model : (id in p.vals ? p.vals[id] : BASE[id])));
const histRows = () => PRESET_ROWS.filter((r) => !isShared(r.id) && r.type !== 'secret');
const snapshot = (p) => { const o = {}; histRows().forEach((r) => { o[r.id] = effVal(p, r.id); }); return o; };
function loadVals(p) {
  loading = true;
  PRESET_ROWS.forEach((r) => { r.v = isShared(r.id) ? SHARED[r.id] : (r.id === 'models.mainModel' ? p.model : (r.id in p.vals ? p.vals[r.id] : BASE[r.id])); SHADOW[r.id] = r.v; });
  loading = false; const dm = $('#dModel'); if (dm && [...dm.options].some((o) => o.value === A.ROW['models.mainModel'].v)) dm.value = A.ROW['models.mainModel'].v;
}
const writeVal = (p, id, v) => { if (id === 'models.mainModel') p.model = v; else p.vals[id] = v; };
const clip20 = (v) => { v = String(v); return v.length > 20 ? v.slice(0, 20) + '…' : v; };
const fmtVal = (id, v) => { const r = A.ROW[id]; if (r.type === 'slider' && r.step < 1 && Number.isInteger(v)) return v.toFixed(1) + (r.unit || ''); if (r.type === 'text' || r.type === 'textarea') return v ? clip20(v) : A.valueText(Object.assign({}, r, { v })); return A.valueText(Object.assign({}, r, { v })); };
function lockChange(r) {                                  // a keep-on-switch switch was flipped on the page
  const k = r.id; const ids = LOCKS[k]; const p = act();
  if (r.v) { ids.forEach((id) => { SHARED[id] = A.ROW[id].v; }); dropSharedHistory(ids); announce(t2('lockedNow')); if (A.S.open) A.refreshPage(); return; }
  const d = A.openDialog({ critical: true, title: t2('lockOffTitle'), body: `<p>${esc(t2('lockOffBody', p.name))}</p>`, buttons: [{ id: 'cancel', label: t2('cancel') }, { id: 'off', label: t2('lockOffBtn'), primary: true }], initial: '[data-dlg="cancel"]', onClose: (why) => { if (why !== 'off') { r.v = true; if (A.S.open) A.refreshPage(); } } });
  A.openDialog.handlers = { off: () => { ids.forEach((id) => { if (id in SHARED) { writeVal(p, id, SHARED[id]); SHADOW[id] = SHARED[id]; delete SHARED[id]; } }); setTimeout(() => { save(); if (A.S.open) A.refreshPage(); }, 0); } };
  return d;
}
function dropSharedHistory(ids) {      // N-04: undo steps recorded before the lock would change the preset, not the shared value, so they go
  const set = new Set(ids);
  D.presets.forEach((p) => { [p.undo, p.redo].forEach((st) => { for (let i = st.length - 1; i >= 0; i--) { const x = st[i]; if (x.bulk) { x.changes = x.changes.filter((c) => !set.has(c.id)); if (!x.changes.length) st.splice(i, 1); } else if (set.has(x.id)) st.splice(i, 1); } }); });
}
function decorShared() {                                  // R-08: rows under a lock show a lock marker and "모든 프리셋 공통" (the DS-016 chip returns for exactly this case)
  $$('#pageScroll .ps-shared').forEach((e) => { e.classList.remove('ps-shared'); const c = $('.ps-shared-chip', e); if (c) c.remove(); });
  for (const k in LOCKS) if (A.ROW[k].v) LOCKS[k].forEach((id) => {
    const row = $(`#pageScroll [data-row="${CSS.escape(id)}"]`); if (!row) return; row.classList.add('ps-shared');
    const t = $('.r-title', row); if (t && !$('.ps-shared-chip', t)) { const c = document.createElement('span'); c.className = 'chip ps-shared-chip'; c.title = t2('sharedTip'); c.innerHTML = ic('lock', 'sm') + '<span>' + esc(t2('sharedChip')) + '</span>'; t.appendChild(c); }
  });
}

/* ------------------------------------------------------------------ live save, undo / redo, restore points (SPEC 5) */
const rowFailMark = (ids) => {
  $$('#pageScroll .ps-failed').forEach((e) => { e.classList.remove('ps-failed'); e.removeAttribute('data-part-critical'); const m = $('.ps-rowfail', e); if (m) m.remove(); });
  (ids || []).forEach((id) => { const row = $(`#pageScroll [data-row="${CSS.escape(id)}"]`); if (!row) return; row.classList.add('ps-failed'); row.setAttribute('data-part-critical', ''); const t = $('.r-title', row); if (t && !$('.ps-rowfail', t)) { const m = document.createElement('span'); m.className = 'ps-rowfail'; m.innerHTML = ic('triangle-alert', 'sm') + '<span>' + esc(t2('rowFailed')) + '</span>'; t.appendChild(m); } });
};
function paintSave() {
  const p = act(); ST.state = ST.state === 'saving' ? 'saving' : (p.failed ? 'failed' : 'saved');
  const lab = ST.state === 'saving' ? t2('saving') : ST.state === 'failed' ? t2('saveFailed') : t2('saved');
  $$('[data-ps-status]').forEach((e) => {
    e.dataset.st = ST.state; const t = $('.st-t', e); if (t) t.textContent = lab;
    const g = $('.st-ic', e); if (g) g.innerHTML = ST.state === 'saving' ? ic('loader', 'sm') : ST.state === 'failed' ? ic('circle-alert', 'sm') : ic('check', 'sm');
    if (e.matches('button')) { e.hidden = ST.state !== 'failed'; } else if (e.classList.contains('ps-st')) { e.hidden = ST.state === 'failed'; }
  });
  const uo = p.undo.length > 0, ro = p.redo.length > 0; const lu = p.undo[p.undo.length - 1], lr = p.redo[p.redo.length - 1];
  const rl = (s) => (!s ? '' : s.bulk ? t2('restorePoints') : A.L(A.ROW[s.id]));
  $$('[data-ps-undo]').forEach((b) => { b.setAttribute('aria-disabled', uo ? 'false' : 'true'); const l = uo ? t2('undoLabel', rl(lu)) : t2('undo'); b.title = l + ' (Ctrl+Z)'; b.setAttribute('aria-label', l); });
  $$('[data-ps-redo]').forEach((b) => { b.setAttribute('aria-disabled', ro ? 'false' : 'true'); const l = ro ? t2('redoLabel', rl(lr)) : t2('redo'); b.title = l + ' (Ctrl+Shift+Z)'; b.setAttribute('aria-label', l); });
  rowFailMark(p.failed ? p.failedIds : []); decorShared(); paintChip();
}
function save() {
  ST.state = 'saving'; paintSave(); clearTimeout(ST.t); const sp = act();
  ST.t = setTimeout(() => {
    const p = sp;
    if (CFG.failNext > 0) { CFG.failNext--; p.failed = true; p.failedIds = (p.dirtyIds || []).slice(); ST.state = 'failed'; announce(t2('saveFailed')); }
    else { p.failed = false; p.failedIds = []; p.dirtyIds = []; p.okMap = {}; p.savedLen = p.undo.length; ST.state = 'saved'; }
    paintSave(); updateChrome(true);
    const w = ST.wait; ST.wait = null; if (w) w.forEach((f) => f());     // N-07: switches and closes that waited for this result run now
  }, CFG.saveMs);
}
function retrySave() { save(); }
function discardFailed(p) {                                // 변경 취소: put every failed row back to the last value that was saved
  const keepN = Math.min(p.savedLen || 0, p.undo.length); for (let i = p.undo.length - 1; i >= keepN; i--) { const st = p.undo[i]; if (!st.bulk && (p.failedIds || []).includes(st.id)) p.undo.splice(i, 1); }      // N-18: a discarded edit leaves no undo step behind
  loading = true; (p.failedIds || []).forEach((id) => { if (id in (p.okMap || {})) { const v = p.okMap[id]; if (A.ROW[id]) A.ROW[id].v = v; if (isShared(id)) SHARED[id] = v; else writeVal(p, id, v); SHADOW[id] = v; } }); loading = false;
  p.failed = false; p.failedIds = []; p.dirtyIds = []; p.okMap = {}; ST.state = 'saved'; if (A.S.open && S2.view === 'section') A.refreshPage(); paintSave(); updateChrome(true); announce(t2('discarded'));
}
function openFailDialog(p, then) {                         // DS-026: ask before the failed value is left behind
  const d = A.openDialog({ critical: true, title: t2('failGuardTitle'), body: `<p>${esc(t2('failGuardBody', p.name))}</p>`, buttons: [{ id: 'cancel', label: t2('cancel') }, { id: 'discard', label: t2('discard'), danger: true }, { id: 'retry', label: t2('retry'), primary: true }], initial: '[data-dlg="retry"]' });
  A.openDialog.handlers = {
    discard: () => { setTimeout(() => { discardFailed(p); then(); }, 0); },
    retry: () => { setTimeout(() => { retrySave(); const t0 = Date.now(); const poll = () => { if (!p.failed && ST.state !== 'saving') then(); else if (ST.state === 'saving' && Date.now() - t0 < 4000) setTimeout(poll, 30); else openFailDialog(p, then); }; setTimeout(poll, CFG.saveMs + 30); }, 0); },
  };
  return d;
}
function guardFailed(then) { const p = act(); if (!p.failed) return false; openFailDialog(p, then); return true; }
function takeRP(p, kind, vals) {
  const rp = { id: 'rp' + (uidn++), t: NOWMS(), kind, vals: vals || snapshot(p) }; p.rps.push(rp); p.rpT = rp.t;
  while (p.rps.length > CFG.maxRp) p.rps.shift(); return rp;
}
function ensureRP(p) {
  if (!p.rpTaken) { takeRP(p, 'activate'); p.rpTaken = true; } else if (NOWMS() - (p.rpT || 0) > DAY) takeRP(p, 'daily');
}
function commitStep(id, to, o = {}) {
  const p = act(); const from = SHADOW[id]; if (from === undefined || same(from, to)) return false;
  p.dirtyIds = p.dirtyIds || []; p.okMap = p.okMap || {}; if (!p.dirtyIds.includes(id)) p.dirtyIds.push(id); if (!(id in p.okMap)) p.okMap[id] = from;
  if (isShared(id)) { SHARED[id] = to; SHADOW[id] = to; save(); return true; }                                   // outside the preset: no preset history
  if (isSecret(id)) { writeVal(p, id, to); SHADOW[id] = to; save(); return true; }                              // DS-027: a key is saved but never kept in undo or restore points
  ensureRP(p); const st = p.undo; const last = st[st.length - 1]; const tn = now();
  if (o.coalesce && last && !last.bulk && last.id === id && tn - last.tn < 700) { last.to = to; last.tn = tn; } else { st.push({ id, from, to, tn }); while (st.length > CFG.maxUndo) st.shift(); }
  p.redo.length = 0; writeVal(p, id, to); SHADOW[id] = to; save(); paintCard(); if (id === 'models.mainModel') paintChip(); return true;
}
function commitPending() { const ids = Object.keys(pend); ids.forEach((id) => { delete pend[id]; commitStep(id, A.ROW[id].v); }); return ids.length; }
function applyChanges(p, changes, dir) {   // dir 'undo' -> to = from
  loading = true;
  changes.forEach((c) => { const v = dir === 'undo' ? c.from : c.to; A.ROW[c.id].v = v; if (isShared(c.id)) SHARED[c.id] = v; else writeVal(p, c.id, v); SHADOW[c.id] = v; });   // N-04: with a lock on the value that counts is the shared one
  loading = false;
}
function inView(id) {
  if (!A.S.open) return false; const el = $(`#pageScroll [data-row="${CSS.escape(id)}"]`); if (!el) return false;
  const r = el.getBoundingClientRect(), s = $('#pageScroll').getBoundingClientRect(); return r.bottom > s.top + 4 && r.top < s.bottom - 4;
}
function stepMessage(step, dir) {
  if (step.bulk) return t2(dir === 'undo' ? 'undoneMany' : 'redoneMany', step.changes.length);
  const r = A.ROW[step.id]; const cur = dir === 'undo' ? step.to : step.from, tgt = dir === 'undo' ? step.from : step.to;
  return t2(dir === 'undo' ? 'undoneChange' : 'redoneChange', A.L(r), fmtVal(step.id, cur), fmtVal(step.id, tgt));
}
function doUndoRedo(dir) {
  commitPending(); const p = act(); const from = dir === 'undo' ? p.undo : p.redo, to = dir === 'undo' ? p.redo : p.undo;
  const step = from.pop(); if (!step) { announce(dir === 'undo' ? t2('nothingUndoPreset', p.name) : t2('nothingRedo')); paintSave(); return false; }
  const changes = step.bulk ? step.changes : [step]; applyChanges(p, changes, dir); to.push(step);
  const ids = changes.map((c) => c.id); const visible = ids.length === 1 && inView(ids[0]);
  if (A.S.open) { if (S2.view === 'section') A.refreshPage(); }
  const msg = stepMessage(step, dir);
  if (visible) { const el = $(`#pageScroll [data-row="${CSS.escape(ids[0])}"]`); if (el) A.highlight(el); announce(msg); }
  else { psToast(msg, { kind: 'undo' }); }
  save(); paintCard(); updateChrome(true); S2.lastUndo = { msg, dir, visible, ids }; if (X.undone) X.undone(dir, step); return true;
}
const doUndo = () => doUndoRedo('undo'), doRedo = () => doUndoRedo('redo');
function diffCount(p, vals) { let n = 0; histRows().forEach((r) => { if (r.id in vals && !same(effVal(p, r.id), vals[r.id])) n++; }); return n; }
function restoreRP(rpId) {
  commitPending(); const p = act(); const rp = p.rps.find((x) => x.id === rpId); if (!rp) return;
  const cur = snapshot(p); const changes = []; histRows().forEach((r) => { if (r.id in rp.vals && !same(cur[r.id], rp.vals[r.id])) changes.push({ id: r.id, from: cur[r.id], to: rp.vals[r.id] }); });
  takeRP(p, 'before', cur);
  if (changes.length) { applyChanges(p, changes, 'redo'); p.undo.push({ bulk: true, changes, tn: now() }); while (p.undo.length > CFG.maxUndo) p.undo.shift(); p.redo.length = 0; }
  save(); if (A.S.open && S2.view === 'section') A.refreshPage(); paintCard(); updateChrome(true);
  const hasKeys = PRESET_ROWS.some((r) => r.type === 'secret');
  psToast(t2('restored', changes.length) + (hasKeys ? '. ' + t2('restoreKeyNote') : ''), { action: { label: t2('undo'), fn: doUndo }, kind: 'restore', until: 'restore' });
}
function seedRestorePoints(p) {   // fixture: three earlier restore points on the first preset (12 / 5 / 3 settings differ from now)
  const el = PRESET_ROWS.filter((r) => ['slider', 'number', 'switch'].includes(r.type));
  const make = (n, dt, kind) => { const v = snapshot(p); el.slice(0, n).forEach((r) => { v[r.id] = r.type === 'switch' ? !v[r.id] : r.type === 'slider' || r.type === 'number' ? (v[r.id] >= r.max ? r.min : Math.min(r.max, v[r.id] + (r.max - r.min) * 0.1)) : v[r.id]; }); return { id: 'rp' + (uidn++), t: dt, kind, vals: v }; };
  const d0 = new Date(NOWMS()); const at = (days, h, m) => new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() - days, h, m).getTime();
  p.rps = [make(12, at(3, 9, 40), 'daily'), make(5, at(1, 22, 10), 'activate'), make(3, at(0, 9, 12), 'daily')]; p.rpT = p.rps[2].t; p.rpTaken = false;
}

/* ------------------------------------------------------------------ preset operations */
function updateChrome(soft) {
  paintChip(); paintCard(); paintSave(); { const og = $('#origin'); if (og) tagMessages(og); }
  if (SW.open) renderSw(true);
  if (A.S.open && S2.view === 'library' && !soft) renderLib();
}
function switchTo(id, o = {}) {
  const p = P(id); if (!p) return false;
  commitPending(); const prev = act();
  if (prev.id === id) return false;
  if (!o.force && ST.state === 'saving') { (ST.wait = ST.wait || []).push(() => switchTo(id, o)); return false; }      // N-07: wait for the result, then ask if it failed
  if (!o.force && guardFailed(() => switchTo(id, Object.assign({}, o, { force: true })))) return false;      // DS-026: a failed save is never left behind silently
  A.S.presetActive = id; p.lastUsed = ++S2.tick; p.rpTaken = false; loadVals(p); ST.state = 'saved';
  if (A.S.open && S2.view === 'section') A.refreshPage();
  updateChrome();
  const keeps = S2.gen && S2.reqPreset && S2.reqPreset !== id && P(S2.reqPreset) ? P(S2.reqPreset) : null;
  if (!o.quiet) {
    S2.swUndo = { from: prev.id, to: id, seq: S2.luSeq || 0 };
    psToast(t2('switchedPreset', p.name), { until: 'prev', action: { label: t2('undo'), title: t2('undo') + ' (Alt+Z)', fn: () => { if (!P(prev.id)) { announce(t2('nothingLib')); return; } S2.swUndo = null; switchTo(prev.id, { quiet: true }); announce(t2('switchedPreset', prev.name)); } }, sub: keeps ? t2('genKeeps', keeps.name) : '', kind: 'switch' });
  }
  S2.switchedTo = { id, from: prev.id };
  return true;
}
const newId = () => { let n = D.presets.reduce((m, p) => Math.max(m, parseInt(String(p.id).replace(/\D/g, ''), 10) || 0), 0) + 1; while (PM['p' + n]) n++; return 'p' + n; };
const blankPreset = (id, name, model, folder) => ({ id, name, model, folder: folder || null, fav: false, lastUsed: 0, icon: 'bookmark', vals: {}, rps: [], undo: [], redo: [], rpTaken: false, rpT: 0 });
function insertAtFolderEnd(p, fid) {
  let idx = -1; D.presets.forEach((x, i) => { if ((x.folder || null) === (fid || null)) idx = i; });
  if (idx < 0) D.presets.push(p); else D.presets.splice(idx + 1, 0, p); reindex(); Fv++;
}
function removePresets(ids, backTo) {      // the undo of create, duplicate and import: the presets just go (they were never deleted, so they do not enter 최근 삭제)
  const was = A.S.presetActive; ids = ids.filter((id) => P(id));
  ids.forEach((id) => { const p = P(id); D.presets.splice(D.presets.indexOf(p), 1); clearSlotOf(id); const ci = CHAIN.indexOf(id); if (ci >= 0) CHAIN.splice(ci, 1); LOAD.forEach((l) => { const k = l.presets.indexOf(id); if (k >= 0) l.presets.splice(k, 1); }); });
  reindex(); Fv++;
  if (ids.includes(was)) { const nx = backTo && P(backTo) ? P(backTo) : D.presets.slice().sort((a, b) => b.lastUsed - a.lastUsed)[0]; A.S.presetActive = nx.id; nx.lastUsed = ++S2.tick; nx.rpTaken = false; loadVals(nx); ST.state = 'saved'; }
}
function createPreset({ name, from, folder, useNow }) {
  commitPending(); const cur = act(); const prevId = cur.id; const id = newId(); const p = blankPreset(id, name.trim(), from === 'current' ? cur.model : 'claude-sonnet-45', folder);
  if (from === 'current') { const s = snapshot(cur); PRESET_ROWS.forEach((r) => { if (r.id !== 'models.mainModel' && !same(s[r.id], BASE[r.id])) p.vals[r.id] = s[r.id]; }); }
  insertAtFolderEnd(p, folder); A.buildIndex();
  const le = pushLU(t2('labCreate', p.name), () => { removePresets([id], prevId); return ''; }, 'create', { ids: [id], activeChange: false });
  if (useNow) { switchTo(id, { quiet: true }); psToast(t2('createdUse', p.name), { kind: 'create', until: 'page', action: luAction(le) }); } else { psToast(t2('created', p.name), { kind: 'create', until: 'page', action: luAction(le) }); updateChrome(); }
  announce(t2('created', p.name)); return p;
}
function duplicatePreset(id) {
  commitPending(); const p = P(id); if (!p) return null; const c = blankPreset(newId(), uniq(t2('copySuffix', p.name)).slice(0, NAME_MAX), p.model, p.folder);
  c.icon = p.icon; c.vals = Object.assign({}, p.vals); D.presets.splice(D.presets.indexOf(p) + 1, 0, c); reindex(); Fv++; A.buildIndex(); updateChrome();
  const le = pushLU(t2('labDuplicate', c.name), () => { removePresets([c.id], A.S.presetActive === c.id ? p.id : null); return ''; }, 'duplicate', { ids: [c.id] });
  psToast(t2('copied', c.name), { kind: 'copy', until: 'page', action: luAction(le) }); announce(t2('copied', c.name)); return c;
}
function renamePreset(id, name) {
  const p = P(id); name = String(name || '').trim().slice(0, NAME_MAX); if (!p || !name || name === p.name) return false;
  const old = p.name; p.name = name; Fv++; A.buildIndex(); updateChrome(); announce(t2('renamed', name));
  pushLU(t2('labRename', old), () => { if (p.name === name) { p.name = old; Fv++; } return ''; }, 'rename'); return true;
}
function toggleFav(id) { const p = P(id); if (!p) return; p.fav = !p.fav; updateChrome(); }
function placeIn(pid, fid, idx) {
  const p = P(pid); fid = fid || null; D.presets.splice(D.presets.indexOf(p), 1); p.folder = fid;
  const mem = D.presets.filter((x) => (x.folder || null) === fid);
  if (idx >= mem.length) { if (!mem.length) D.presets.push(p); else D.presets.splice(D.presets.indexOf(mem[mem.length - 1]) + 1, 0, p); }
  else D.presets.splice(D.presets.indexOf(mem[Math.max(0, idx)]), 0, p);
  Fv++; reindex(); return D.presets.filter((x) => (x.folder || null) === fid).indexOf(p);
}
const groupOrder = () => FOLD.map((f) => f.id).concat([null]);        // display order of reorder targets: folders, then 폴더 없음
function moveAnnounce(p) {
  const pos = D.presets.filter((x) => (x.folder || null) === (p.folder || null)).indexOf(p) + 1;
  const msg = t2('movedAnnounce', p.name, p.folder ? t2('folderWord', folderName(p.folder)) : t2('noFolder'), pos); announce(msg); return msg;
}
function kbMove(pid, dir) {                // Alt+Up / Alt+Down, also across folders (SPEC 3.5)
  if (LIB.sort !== 'manual') { announce(t2('sortHint')); return false; }
  const p = P(pid); const fid = p.folder || null; const mem = D.presets.filter((x) => (x.folder || null) === fid); const k = mem.indexOf(p); const go = groupOrder(); const gi = go.indexOf(fid); const before = { f: fid, i: D.presets.indexOf(p) };
  if (dir < 0) {
    if (k > 0) placeIn(pid, fid, k - 1);
    else { if (gi <= 0) { announce(t2('atTop')); return false; } const tf = go[gi - 1]; const n = D.presets.filter((x) => (x.folder || null) === tf).length; placeIn(pid, tf, n); if (tf) COLL[tf] = false; }
  } else {
    if (k < mem.length - 1) placeIn(pid, fid, k + 1);
    else { if (gi >= go.length - 1) { announce(t2('atBottom')); return false; } const tf = go[gi + 1]; placeIn(pid, tf, 0); if (tf) COLL[tf] = false; }
  }
  recMove(p, before); moveAnnounce(p); persistColl(); return true;
}
function moveFolder(fid, dir) {
  const i = FOLD.findIndex((f) => f.id === fid), j = i + dir; if (i < 0 || j < 0 || j >= FOLD.length) { announce(t2(dir < 0 ? 'atTop' : 'atBottom')); return false; }
  const [f] = FOLD.splice(i, 1); FOLD.splice(j, 0, f); announce(t2('movedAnnounce', f.name, t2('folderWord', f.name), j + 1)); return true;
}
function placeFolder(fid, idx) { const i = FOLD.findIndex((f) => f.id === fid); const [f] = FOLD.splice(i, 1); FOLD.splice(Math.max(0, Math.min(idx, FOLD.length)), 0, f); announce(t2('movedAnnounce', f.name, t2('folderWord', f.name), FOLD.indexOf(f) + 1)); }
function createFolder(name) { const id = 'f' + (uidn++) + 'n'; FOLD.push({ id, name: name.trim().slice(0, NAME_MAX) }); Fv++; return id; }
function renameFolder(fid, name) { const f = FOLD.find((x) => x.id === fid); name = String(name || '').trim().slice(0, NAME_MAX); if (!f || !name || name === f.name) return false; const old = f.name; f.name = name; Fv++; announce(t2('folderRenamed', name)); pushLU(t2('labFolderRename', old), () => { if (f.name === name) { f.name = old; Fv++; } return ''; }, 'folder-rename'); return true; }
/* ---- library undo stack (DS-024 / DS-028): every destructive library action has its own inverse. Toasts offer theirs; Ctrl+Z in the library and Alt+Z anywhere in Settings reach the newest. A later toast never cancels an earlier action's undo. */
const LU = [], TRASH = [];
function pushLU(label, undo, kind, data) { S2.luSeq = (S2.luSeq || 0) + 1; const e = { id: 'lu' + (uidn++), label, undo, kind: kind || '', data: data || null, t: NOWMS() }; LU.push(e); while (LU.length > 50) LU.shift(); return e; }
const luAction = (e) => ({ label: t2('undo'), title: t2('undo') + ' (Alt+Z)', fn: () => runLU(e.id) });
function runLU(id, force) {
  const i = LU.findIndex((e) => e.id === id); if (i < 0) return false;
  if (!force && LU[i].data && LU[i].data.activeChange && guardFailed(() => runLU(id, true))) return false;      // N-07: undoing a delete can change the active preset, so the failed-save question comes first
  const e = LU.splice(i, 1)[0]; commitPending();
  const note = e.undo() || ''; reindex(); Fv++; A.buildIndex(); updateChrome();
  if (A.S.open && S2.view === 'section') { if (X.refreshAfterLU && X.refreshAfterLU(e)) { /* the slice that owns the entry repainted only what it changed */ } else A.refreshPage(); }
  const m = t2('libUndone', e.label) + (note ? '. ' + note : ''); S2.lastLU = { label: e.label, msg: m, kind: e.kind };
  psToast(m, { kind: 'lu-undo' });
  const fp = e.data && e.data.ids && e.data.ids.find((x) => P(x)); if (fp && A.S.open && S2.view === 'library') { const q = P(fp); if (q.folder) COLL[q.folder] = false; renderLib({ focusKey: (q.folder || 'none') + ':' + fp }); }      // N-18: focus lands on the restored row
  return true;
}
function undoLast() { const e = LU[LU.length - 1]; if (!e) { announce(t2('nothingLib')); return false; } return runLU(e.id); }
function recMove(p, b) {
  return pushLU(t2('labMove', p.name), () => { const q = P(p.id); if (!q) return ''; D.presets.splice(D.presets.indexOf(q), 1); q.folder = b.f && FOLD.some((f) => f.id === b.f) ? b.f : null; D.presets.splice(Math.min(b.i, D.presets.length), 0, q); return ''; }, 'move');
}
function deleteFolder(fid) {
  const f = FOLD.find((x) => x.id === fid); const idx = FOLD.indexOf(f); const members = D.presets.filter((p) => p.folder === fid).map((p) => p.id);
  D.presets.forEach((p) => { if (p.folder === fid) p.folder = null; }); FOLD.splice(idx, 1); delete COLL[fid]; persistColl(); Fv++;
  f.entry = pushLU(t2('labFolderDelete', f.name), () => { if (!FOLD.some((x) => x.id === f.id)) FOLD.splice(Math.min(idx, FOLD.length), 0, { id: f.id, name: f.name }); members.forEach((id) => { const p = P(id); if (p && !p.folder) p.folder = f.id; }); return ''; }, 'folder-delete');
  return f;
}
function moveManyToFolder(ids, fid) {
  const before = ids.filter((id) => P(id)).map((id) => ({ id, f: P(id).folder || null, i: D.presets.indexOf(P(id)) }));
  ids.forEach((id) => placeIn(id, fid || null, 1e9)); if (fid) COLL[fid] = false; persistColl();
  return pushLU(ids.length > 1 ? t2('labMoveMany', ids.length) : t2('labMove', P(ids[0]).name), () => {
    const live = before.filter((b) => P(b.id)).sort((a, b) => a.i - b.i);
    live.forEach((b) => { const q = P(b.id); D.presets.splice(D.presets.indexOf(q), 1); q.folder = b.f && FOLD.some((f) => f.id === b.f) ? b.f : null; });
    live.forEach((b) => { D.presets.splice(Math.min(b.i, D.presets.length), 0, P(b.id)); }); return '';
  }, 'move');
}
function assignSlot(n, id) { for (let k = 1; k <= 9; k++) if (SLOT[k] === id) SLOT[k] = null; SLOT[n] = id; }
function clearSlotOf(id) { for (let k = 1; k <= 9; k++) if (SLOT[k] === id) SLOT[k] = null; }
function slotOp(label, fn) {
  const before = Object.assign({}, SLOT); fn(); const after = Object.assign({}, SLOT); if (JSON.stringify(before) === JSON.stringify(after)) return null;
  return pushLU(label, () => {
    const notes = []; const changed = []; for (let n = 1; n <= 9; n++) if (before[n] !== after[n]) changed.push(n);
    changed.forEach((n) => { if (SLOT[n] === after[n]) SLOT[n] = null; });                      // pass 1: take back everything the action set, which frees every slot it touched
    changed.forEach((n) => {                                                                     // pass 2: hand the old owners their slots back (N-01: one pass in key order lost the old slot of a preset that moved up)
      const pid = before[n]; if (!pid || !P(pid)) return;
      if (SLOT[n]) { notes.push(t2('slotTakenSkip', slotLabel(n))); return; }                  // someone else really holds it now
      if (slotOf(pid)) return; SLOT[n] = pid;
    });
    return notes.join(' ');
  }, 'slot');
}
const swapSlotU = (n, id) => slotOp(t2('labSlot', slotLabel(n)), () => { const m = slotOf(id), q = SLOT[n]; if (m && q && q !== id) { SLOT[m] = q; SLOT[n] = id; } else assignSlot(n, id); });      // DS-039: two presets trade slots
const assignSlotU = (n, id) => slotOp(t2('labSlot', slotLabel(n)), () => assignSlot(n, id));
const clearSlotU = (id) => { const k = slotOf(id); return slotOp(t2('labSlot', k ? slotLabel(k) : '…'), () => clearSlotOf(id)); };
function snapOf(id) { const p = P(id); return { p, idx: D.presets.indexOf(p), chain: CHAIN.indexOf(id), slot: slotOf(id), load: LOAD.filter((l) => l.presets.includes(id)).map((l) => ({ l, i: l.presets.indexOf(id) })) }; }
function restoreSnap(s, notes) {
  const p = s.p; if (P(p.id)) return;
  if (p.folder && !FOLD.some((f) => f.id === p.folder)) { p.folder = null; notes.push(t2('folderGone')); }
  D.presets.splice(Math.min(s.idx, D.presets.length), 0, p); reindex();
  if (s.chain >= 0 && !CHAIN.includes(p.id)) CHAIN.splice(Math.min(s.chain, CHAIN.length), 0, p.id);
  s.load.forEach((x) => { if (!x.l.presets.includes(p.id)) x.l.presets.splice(Math.min(x.i, x.l.presets.length), 0, p.id); });
  if (s.slot) { if (!SLOT[s.slot] || SLOT[s.slot] === p.id) SLOT[s.slot] = p.id; else notes.push(t2('slotTakenSkip', slotLabel(s.slot))); }
  const ti = TRASH.findIndex((x) => x.p.id === p.id); if (ti >= 0) TRASH.splice(ti, 1);
  trashPersist();
}
function deletePresets(ids) {
  commitPending(); ids = ids.filter((id) => P(id)); if (!ids.length || D.presets.length - ids.length < 1) return null;
  const was = A.S.presetActive; const snaps = ids.map(snapOf).sort((a, b) => a.idx - b.idx);
  let nextActive = null; if (ids.includes(was)) { const rest = D.presets.filter((x) => !ids.includes(x.id)).sort((a, b) => b.lastUsed - a.lastUsed); nextActive = rest[0].id; }
  snaps.slice().reverse().forEach((s) => {
    D.presets.splice(s.idx, 1); if (s.chain >= 0) CHAIN.splice(CHAIN.indexOf(s.p.id), 1); if (s.slot) SLOT[s.slot] = null;
    s.load.forEach((x) => { const k = x.l.presets.indexOf(s.p.id); if (k >= 0) x.l.presets.splice(k, 1); }); TRASH.unshift({ p: s.p, snap: s, at: NOWMS() });
  });
  reindex(); Fv++; trashPersist();
  if (nextActive) { A.S.presetActive = nextActive; const np = P(nextActive); np.lastUsed = ++S2.tick; np.rpTaken = false; loadVals(np); ST.state = 'saved'; }
  A.buildIndex(); if (A.S.open && S2.view === 'section') A.refreshPage();
  const label = ids.length === 1 ? t2('labDelete', snaps[0].p.name) : t2('labDeleteMany', ids.length);
  const e = pushLU(label, () => {
    const notes = []; const live = snaps.filter((s) => e.data.ids.includes(s.p.id));      // N-06: a preset purged from 최근 삭제 is never brought back by this undo
    live.forEach((s) => restoreSnap(s, notes));
    if (nextActive && live.some((s) => s.p.id === was) && A.S.presetActive === nextActive && P(was)) { const p = P(was); A.S.presetActive = was; p.lastUsed = ++S2.tick; p.rpTaken = false; loadVals(p); }
    return notes.join(' ');
  }, 'delete', { ids, activeChange: !!nextActive });
  S2.lastDelete = { snaps, was, nextActive, entry: e };
  const msg = ids.length === 1 ? t2('deletedPreset', snaps[0].p.name) : t2('deletedMany', ids.length);
  psToast(msg, { action: luAction(e), kind: 'delete', until: 'purge' }); updateChrome();
  return S2.lastDelete;
}
function undoDelete() { const d = S2.lastDelete; if (!d) return false; return runLU(d.entry.id); }
/* ---- 최근 삭제 (DS-024 / DS-034): deleted presets stay listed with 복원 and 영구 삭제 for 30 days, across restarts. The mockup keeps them in localStorage (simulated persistence) and, on load, applies those deletions to the synthetic library. */
const TRASH_MS = 30 * DAY;
function trashPersist() {
  if (A.hermetic) return;
  try { A.store.set('trash2', JSON.stringify(TRASH.map((x) => ({ p: x.p, at: x.at, s: { idx: x.snap.idx, chain: x.snap.chain, slot: x.snap.slot, load: x.snap.load.map((y) => ({ l: y.l.id, i: y.i })) } })), (k, v) => (k === '_F' || k === '_Fv' || k === '_o' ? undefined : v))); } catch (_) { /* ignore */ }
}
let GONE = [];      // ids deleted for good (purged from 최근 삭제 or older than 30 days); applied to the synthetic library on load
function goneAdd(id) { if (!GONE.includes(id)) GONE.push(id); if (!A.hermetic) A.store.set('gone2', JSON.stringify(GONE)); }
function dropFromLibrary(id) { const cur = PM[id]; if (!cur) return; D.presets.splice(D.presets.indexOf(cur), 1); clearSlotOf(id); const ci = CHAIN.indexOf(id); if (ci >= 0) CHAIN.splice(ci, 1); LOAD.forEach((l) => { const k = l.presets.indexOf(id); if (k >= 0) l.presets.splice(k, 1); }); }
function trashLoad() {
  if (A.hermetic) return; let arr = []; try { arr = JSON.parse(A.store.get('trash2') || '[]'); GONE = JSON.parse(A.store.get('gone2') || '[]'); } catch (_) { arr = []; GONE = []; }
  GONE.forEach((id) => { if (id !== DD.activeId) dropFromLibrary(id); });
  arr.forEach((x) => {
    if (!x || !x.p || !x.p.id || x.p.id === DD.activeId) return;
    if (!(NOWMS() - x.at <= TRASH_MS)) { dropFromLibrary(x.p.id); goneAdd(x.p.id); return; }     // older than 30 days: gone for good
    dropFromLibrary(x.p.id);
    const p = x.p; p.undo = p.undo || []; p.redo = p.redo || []; p.rps = p.rps || []; p.vals = p.vals || {};
    TRASH.push({ p, at: x.at, snap: { p, idx: x.s.idx, chain: x.s.chain, slot: x.s.slot, load: (x.s.load || []).map((y) => ({ l: LOAD.find((l) => l.id === y.l), i: y.i })).filter((y) => y.l) } });
  });
  reindex(); trashPersist();
}
function restoreTrash(pid) {
  const i = TRASH.findIndex((x) => x.p.id === pid); if (i < 0) return false; const t = TRASH[i]; const notes = []; restoreSnap(t.snap, notes);
  LU.forEach((e) => { if (e.kind === 'delete' && e.data && e.data.ids.includes(pid)) { e.data.ids = e.data.ids.filter((x) => x !== pid); } }); for (let k = LU.length - 1; k >= 0; k--) if (LU[k].kind === 'delete' && LU[k].data.ids.length === 0) LU.splice(k, 1);
  reindex(); Fv++; A.buildIndex(); updateChrome(); if (A.S.open && S2.view === 'section') A.refreshPage();
  const m = t2('restoredTrash', t.p.name) + (notes.length ? '. ' + notes.join(' ') : ''); psToast(m, { kind: 'trash-restore' }); return true;
}
function purgeTrash(pid) { const i = TRASH.findIndex((x) => x.p.id === pid); if (i < 0) return false; const t = TRASH.splice(i, 1)[0]; goneAdd(t.p.id); trashPersist(); for (let k = LU.length - 1; k >= 0; k--) { const e = LU[k]; if (e.kind === 'delete' && e.data.ids.includes(pid)) { e.data.ids = e.data.ids.filter((x) => x !== pid); if (!e.data.ids.length) LU.splice(k, 1); } } updateChrome(true); renderLib(); psToast(t2('purged', t.p.name), { kind: 'purge', ms: 4000 }); return true; }
/* ---- export: built from the preset object itself (R-20). Organisation (folder, favourite, slot) and bookkeeping never travel; a bundle may opt in (DS-032). */
const ORG_KEYS = { folder: 1, fav: 1, lastUsed: 1, rps: 1, undo: 1, redo: 1, rpTaken: 1, rpT: 1, _F: 1, _Fv: 1, _o: 1, id: 1, vals: 1 };
function presetFile(p, withOrg) {
  const o = {}; Object.keys(p).forEach((k) => { if (!ORG_KEYS[k]) o[k] = p[k]; });
  o.values = {}; PRESET_ROWS.forEach((r) => { if (r.type !== 'secret') o.values[r.id] = effVal(p, r.id); });      // DS-035: a locked field is written with the shared value in use
  if (withOrg) o.organisation = { folder: p.folder ? folderName(p.folder) : null, favourite: !!p.fav };
  return o;
}
function exportPresets(ids, opt = {}) {
  const ps = ids.map(P).filter(Boolean); if (!ps.length) return null; const withOrg = !!opt.org && ps.length > 1;
  const files = ps.map((p) => presetFile(p, withOrg));
  const json = JSON.stringify(ps.length === 1 ? { format: 'risup-mock', version: 1, preset: files[0] } : { format: 'risup-bundle-mock', version: 1, presets: files }, null, 1);
  S2.lastExport = { kind: ps.length === 1 ? 'single' : 'bundle', org: withOrg, names: ps.map((p) => p.name), json, files };
  const msg = ps.length === 1 ? t2('exportedOne', ps[0].name) : t2('exportedMany', ps.length); psToast(msg, { kind: 'export', ms: 4000 }); return S2.lastExport;
}
function persistColl() { if (!A.hermetic) A.store.set('coll2', JSON.stringify(COLL)); }
function isCollapsed(fid) { return fid in COLL ? !!COLL[fid] : fid === 'fav' ? D.presets.filter((p) => p.fav).length > 10 : fid !== (act().folder || null); }

/* ------------------------------------------------------------------ the switcher (SPEC 2): popover from the chip, palette from Ctrl+P, tall sheet on phones */
const slotBadge = (p) => { const n = slotOf(p.id); return n ? `<span class="ps-b ps-slot" title="${esc(slotLabel(n))}">${esc(slotLabel(n))}</span>` : ''; };
function swOptHTML(i, p, crumb) {
  const on = p.id === A.S.presetActive;
  return `<div class="sw-opt${on ? ' cur' : ''}" data-part="settings-switcher-option" role="option" id="swo-${i}" data-i="${i}" data-pid="${esc(p.id)}" aria-selected="false"><span class="sw-ic">${ic(p.icon, 'lg')}</span><span class="sw-tx"><span data-part="settings-switcher-option-name" class="sw-name" title="${esc(p.name)}">${esc(p.name)}</span><span class="sw-sub">${crumb ? esc(crumb) + ' · ' : ''}${esc(mshort(p.model))}</span></span>${slotBadge(p)}${p.failed ? `<span class="sw-warn" role="img" aria-label="${esc(t2('chipFailed'))}" title="${esc(t2('chipFailed'))}">${ic('triangle-alert', 'md')}</span>` : ''}${on ? `<span class="sw-chk">${ic('check', 'lg')}<span class="sr-only">${esc(t2('inUse'))}</span></span>` : ''}</div>`;
}
function swBuild() {
  const q = SW.q.trim(); const items = []; let html = ''; let gid = 0;
  const grp = (label, body) => `<div role="group" aria-labelledby="swg-${gid}"><div class="sw-gh" id="swg-${gid++}">${esc(label)}</div>${body}</div>`;
  if (q) {
    const res = searchPresets(q); SW.total = res.length;
    if (!res.length) return { html: `<div class="sw-none"><p>${esc(t2('noPresetMatch', q))}</p><button type="button" data-part="settings-button" class="btn solid" data-sw="clear">${ic('x', 'md')}<span>${esc(t2('clearSearch'))}</span></button></div>`, items };
    const shown = res.slice(0, SW.limit); let body = '';
    shown.forEach((r) => { items.push({ kind: 'preset', id: r.p.id }); body += swOptHTML(items.length - 1, r.p, r.p.folder ? folderName(r.p.folder) : ''); });
    if (res.length > shown.length) { items.push({ kind: 'more' }); body += `<div class="sw-opt more" data-part="settings-switcher-option" role="option" id="swo-${items.length - 1}" data-i="${items.length - 1}" aria-selected="false"><span class="sw-ic">${ic('chevron-down', 'lg')}</span><span class="sw-tx"><span data-part="settings-switcher-option-name" class="sw-name">${esc(t2('more', res.length - shown.length))}</span></span></div>`; }
    html = grp(t2('presetResults', res.length), body); return { html, items };
  }
  SW.total = D.presets.length; let rows = 0, capped = false, rest = 0;
  const seen = new Set(), skipped = new Set();   // R-14: each preset appears once in the browse list (recents first; the rest skip anything already shown)
  const add = (list, crumbOf) => { let body = ''; for (const p of list) { if (seen.has(p.id)) continue; if (rows >= SW.limit) { capped = true; skipped.add(p.id); continue; } seen.add(p.id); items.push({ kind: 'preset', id: p.id }); body += swOptHTML(items.length - 1, p, crumbOf ? crumbOf(p) : ''); rows++; } return body; };
  const act0 = A.S.presetActive;
  const rec = D.presets.filter((p) => p.id !== act0 && p.lastUsed > 0).sort((a, b) => b.lastUsed - a.lastUsed).slice(0, CFG.recents);
  if (rec.length) { const b = add(rec, (p) => (p.folder ? folderName(p.folder) : '')); if (b) html += grp(t2('recent'), b); }
  const favs = D.presets.filter((p) => p.fav); if (favs.length) { const b = add(favs, (p) => (p.folder ? folderName(p.folder) : '')); if (b) html += grp('★ ' + t2('favs'), b); }
  FOLD.forEach((f) => { const l = D.presets.filter((p) => p.folder === f.id); if (!l.length) return; const b = add(l); if (b) html += grp(f.name, b); });
  const fs2 = new Set(FOLD.map((f) => f.id)); const none = D.presets.filter((p) => !p.folder || !fs2.has(p.folder)); if (none.length) { const b = add(none); if (b) html += grp(t2('noFolder'), b); }
  if (capped) { items.push({ kind: 'more' }); html += `<div class="sw-opt more" data-part="settings-switcher-option" role="option" id="swo-${items.length - 1}" data-i="${items.length - 1}" aria-selected="false"><span class="sw-ic">${ic('chevron-down', 'lg')}</span><span class="sw-tx"><span data-part="settings-switcher-option-name" class="sw-name">${esc(t2('more', skipped.size))}</span></span></div>`; }
  return { html, items };
}
function swPlace() {
  const p = SW.panel; const app = $('#app').getBoundingClientRect();
  if (SW.mode === 'popover') {
    const o = SW.opener && SW.opener.isConnected ? SW.opener.getBoundingClientRect() : { right: app.right - 16, bottom: 56, left: app.right - 60 };
    const N = window.settingsTheme.num; const w = N('--sheet-width-panel'), edge = N('--offset-6'), gap = N('--offset-5');   // layout constants come from the tokens (theme-tokens.css), read once
    let left = Math.min(Math.max(o.right - w, app.left + edge), app.right - w - edge); const top = o.bottom + gap;
    p.style.left = (left - app.left) + 'px'; p.style.top = (top - app.top) + 'px'; p.style.maxHeight = Math.max(N('--switcher-min-height'), Math.min(window.innerHeight - top - N('--offset-9'), N('--switcher-max-height'))) + 'px';
  }
}
function renderSw(keepActive) {
  if (!SW.open) return; const t0 = now(); const b = swBuild(); SW.items = b.items; const list = SW.list;
  const prevPid = keepActive && SW.act >= 0 && SW.items[SW.act] ? null : null; void prevPid;
  list.innerHTML = b.html;
  if (SW.act < 0 || SW.act >= SW.items.length) SW.act = b.items.length ? 0 : -1;
  swSetActive(SW.act, false);
  SW.input.placeholder = t2('searchPresets'); SW.input.setAttribute('aria-label', t2('searchPresets'));
  const mg = $('[data-sw="manage"]', SW.panel); if (mg) mg.innerHTML = ic('library-big', 'lg') + '<span>' + esc(t2('managePresets')) + '</span>';
  perf.lastSwRender = now() - t0;
}
function swSetActive(i, scroll = true) {
  const opts = $$('.sw-opt', SW.list); opts.forEach((o) => { const on = +o.dataset.i === i; o.classList.toggle('act', on); o.setAttribute('aria-selected', on ? 'true' : 'false'); });
  SW.act = i; const el = i >= 0 ? $('#swo-' + i, SW.list) : null;
  if (el) { SW.input.setAttribute('aria-activedescendant', el.id); if (scroll) el.scrollIntoView({ block: 'nearest' }); } else SW.input.removeAttribute('aria-activedescendant');
}
let swLiveT = 0;
function swInput() {
  const t0 = now(); SW.q = SW.input.value; SW.limit = SW.q.trim() ? CFG.searchChunk : CFG.switcherChunk; SW.act = -1; renderSw();
  $('[data-sw="clearq"]', SW.panel).hidden = !SW.q;
  perf.key.push(+(now() - t0).toFixed(2)); if (perf.key.length > 200) perf.key.shift();
  clearTimeout(swLiveT); swLiveT = setTimeout(() => { if (SW.live) SW.live.textContent = SW.q.trim() ? (SW.total ? t2('presetResults', SW.total) : t2('noPresetMatch', SW.q.trim())) : t2('presetResults', D.presets.length); }, 300);
}
function swActivate(i) {
  const it = SW.items[i]; if (!it) return;
  if (it.kind === 'more') { SW.limit += SW.q.trim() ? CFG.searchChunk : CFG.switcherChunk; const keep = i; renderSw(); swSetActive(keep); return; }
  const id = it.id; closeSwitcher(); switchTo(id);
}
function openSwitcher(o = {}) {
  if (SW.open) closeSwitcher({ noFocus: true });
  const t0 = now(); const a = document.activeElement; if (a && A.inTextField(a)) a.blur(); commitPending();
  SW.opener = o.opener || (a && a !== document.body ? a : null);
  SW.mode = o.mode || (A.S.lay === 'phone' ? 'sheet' : (o.via !== 'key' && SW.opener && SW.opener.id === 'psChip' ? 'popover' : 'palette'));
  SW.q = o.q || ''; SW.limit = SW.q.trim() ? CFG.searchChunk : CFG.switcherChunk; SW.act = -1; SW.open = true;
  const root = document.createElement('div'); root.className = 'sw-root'; root.setAttribute('data-part', 'settings-switcher'); root.id = 'swRoot'; root.dataset.mode = SW.mode;
  root.innerHTML = `<div data-part="settings-switcher-scrim" class="sw-scrim" data-sw="scrim"></div><div class="sw-panel" data-part="settings-switcher-panel" role="dialog" aria-modal="true" aria-label="${esc(t2('switcherLabel'))}">` +
    `<div class="sw-top">${SW.mode === 'sheet' ? `<button type="button" data-part="settings-button" class="btn" data-sw="close" aria-label="${esc(t2('close'))}" title="${esc(t2('close'))}">${ic('arrow-left', 'xl')}</button>` : ''}<span class="sw-sic" aria-hidden="true">${ic('search', 'lg')}</span>` +
    `<input type="text" data-part="settings-switcher-search" class="sw-q" role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="swList" autocomplete="off" spellcheck="false" enterkeyhint="go" placeholder="${esc(t2('searchPresets'))}" aria-label="${esc(t2('searchPresets'))}">` +
    `<button type="button" data-part="settings-button" class="btn sw-clr" data-sw="clearq" hidden aria-label="${esc(t2('clearSearch'))}" title="${esc(t2('clearSearch'))}">${ic('x', 'md')}</button></div>` +
    `<div class="sw-list" id="swList" role="listbox" tabindex="-1" aria-label="${esc(t2('switcherLabel'))}"></div>` +
    `<div class="sw-foot"><button type="button" data-part="settings-button" class="btn solid" data-sw="manage"></button></div><div class="sr-only" role="status" aria-live="polite" id="swLive"></div></div>`;
  $('#app').appendChild(root); document.body.classList.add('sw-open');
  SW.root = root; SW.panel = $('.sw-panel', root); SW.input = $('.sw-q', root); SW.list = $('#swList', root); SW.live = $('#swLive', root);
  SW.prevInert = ['#settings', '#origin'].map((s) => [$(s), $(s).inert]); SW.prevInert.forEach(([e]) => { e.inert = true; e.setAttribute('aria-hidden', 'true'); });   // R-19: inert is not relied on (older engines ignore it): aria-hidden plus the focus trap below do the same job
  SW.input.value = SW.q; $('[data-sw="clearq"]', root).hidden = !SW.q; swPlace(); renderSw();
  requestAnimationFrame(() => root.classList.add('open')); SW.input.focus({ preventScroll: true });
  if (SW.mode === 'sheet' && !A.S.open) { history.pushState({ ps: 1 }, ''); SW.hist = true; } else SW.hist = false;
  root.addEventListener('pointerdown', (ev) => { if (ev.target.dataset && ev.target.dataset.sw === 'scrim') { ev.preventDefault(); closeSwitcher(); } });
  root.addEventListener('click', (ev) => {
    const o2 = ev.target.closest('.sw-opt'); if (o2) { swActivate(+o2.dataset.i); return; }
    const b = ev.target.closest('[data-sw]'); if (!b) return; const k = b.dataset.sw;
    if (k === 'close') closeSwitcher(); else if (k === 'clear' || k === 'clearq') { SW.input.value = ''; swInput(); SW.input.focus(); }
    else if (k === 'manage') { closeSwitcher({ noFocus: true }); openLibraryFrom(SW.opener); }
  });
  root.addEventListener('mousemove', (ev) => { const o2 = ev.target.closest('.sw-opt'); if (o2 && +o2.dataset.i !== SW.act) swSetActive(+o2.dataset.i, false); });
  SW.input.addEventListener('input', swInput);
  root.addEventListener('keydown', (ev) => {
    if (ev.isComposing || ev.keyCode === 229) return; const n = SW.items.length; const k = ev.key;
    if (k === 'Escape') { ev.preventDefault(); ev.stopPropagation(); closeSwitcher(); return; }
    if ((ev.ctrlKey || ev.metaKey) && (k === 'p' || k === 'P')) { ev.preventDefault(); ev.stopPropagation(); closeSwitcher(); return; }
    if (k === 'Tab') { const f = $$('.sw-q, [data-sw="close"], [data-sw="clearq"]:not([hidden]), [data-sw="manage"]', root); const i = f.indexOf(document.activeElement); if (ev.shiftKey ? i <= 0 : i === f.length - 1) { ev.preventDefault(); f[ev.shiftKey ? f.length - 1 : 0].focus(); } return; }
    if (document.activeElement !== SW.input) return;
    if (k === 'ArrowDown' || k === 'ArrowUp') { ev.preventDefault(); if (n) swSetActive((SW.act + (k === 'ArrowDown' ? 1 : -1) + n) % n); }
    else if (k === 'Home' || k === 'End') { if (n) { ev.preventDefault(); swSetActive(k === 'Home' ? 0 : n - 1); } }
    else if (k === 'Enter') { ev.preventDefault(); if (SW.act >= 0) swActivate(SW.act); }
  });
  perf.switcherOpen.push(+(now() - t0).toFixed(2)); if (perf.switcherOpen.length > 40) perf.switcherOpen.shift();
  return true;
}
function closeSwitcher(o = {}) {
  if (!SW.open) return false; SW.open = false; clearTimeout(swLiveT);
  const root = SW.root; root.remove(); document.body.classList.remove('sw-open'); (SW.prevInert || []).forEach(([e, v]) => { e.inert = v; if (!v) e.removeAttribute('aria-hidden'); }); SW.prevInert = null;
  if (SW.hist) { SW.hist = false; S2.popExpected = (S2.popExpected || 0) + 1; try { history.back(); } catch (_) { S2.popExpected = 0; } }
  const op = SW.opener; if (!o.noFocus) { const f = op && op.isConnected ? op : ($('#psChip') || $('#oSettings')); if (f) f.focus({ preventScroll: true }); }
  return true;
}

/* ------------------------------------------------------------------ the library sub-page (SPEC 3) */
const canMoveNow = () => LIB.sort === 'manual' && !LIB.q.trim();
const hasFine = () => matchMedia('(pointer: fine)').matches;
function libModel() {
  const words = LIB.q.trim() ? parseQ(LIB.q) : null; D.presets.forEach((p, i) => { p._o = i; });
  let list = D.presets.slice();
  if (LIB.sort === 'recent') list.sort((a, b) => b.lastUsed - a.lastUsed || a._o - b._o);
  else if (LIB.sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name, A.S.lang === 'ko' ? 'ko' : 'en') || a._o - b._o);
  if (words) list = list.filter((p) => matchPreset(p, words));
  const favs = list.filter((p) => p.fav); const groups = [];
  FOLD.forEach((f) => { const items = list.filter((p) => p.folder === f.id); if (!words || items.length) groups.push({ gid: f.id, f, items }); });
  const fset = new Set(FOLD.map((f) => f.id)); const none = list.filter((p) => !p.folder || !fset.has(p.folder));   // an unknown folder id still shows, under 폴더 없음 (R-02 safety net)
  return { list, favs, groups, none, searching: !!words };
}
function rowLib(p, gid, canMove) {
  const key = gid + ':' + p.id; const on = p.id === A.S.presetActive; const sel = LIB.sel; const chk = sel && sel.has(p.id);
  const sub = (gid === 'fav' || LIB.q.trim()) && p.folder ? folderName(p.folder) + ' · ' : '';
  const grip = gid === 'fav' ? `<span class="ps-grip off" aria-hidden="true"></span>` : `<span class="ps-grip${canMove ? '' : ' off'}" ${canMove ? 'data-grip' : ''} aria-hidden="true" title="${esc(t2(canMove ? 'grip' : 'gripDisabled'))}">${ic('grip-vertical', 'lg')}</span>`;
  const roleAttr = sel ? ` role="checkbox" aria-checked="${chk ? 'true' : 'false'}"` : ' aria-haspopup="menu"';
  return `<li class="ps-li${on ? ' is-active' : ''}${chk ? ' is-sel' : ''}" data-part="settings-preset-row" data-pid="${esc(p.id)}" data-gid="${esc(gid)}"><div class="ps-row">${grip}` +
    `<button type="button" data-part="settings-preset-row-main" class="ps-main" data-rv data-key="${esc(key)}" data-pid="${esc(p.id)}" data-gid="${esc(gid)}" tabindex="-1"${roleAttr}>${sel ? `<span class="ps-cb">${ic(chk ? 'square-check' : 'square', 'xl')}</span>` : ''}` +
    `<span class="ps-ic">${ic(p.icon, 'xl')}</span><span class="ps-tx"><span data-part="settings-preset-row-name" class="ps-name" title="${esc(p.name)}">${esc(p.name)}</span><span data-part="settings-preset-row-detail" class="ps-sub">${esc(sub)}${esc(mshort(p.model))}</span></span>` +
    `<span class="ps-badges">${p.failed ? `<span class="ps-b ps-warn" data-part="settings-preset-warning" data-part-critical title="${esc(t2('chipFailed'))}">${ic('triangle-alert', 'xs')}<span>${esc(t2('chipFailed'))}</span></span>` : ''}${slotBadge(p)}${on ? `<span class="ps-b ps-on">${esc(t2('inUse'))}</span>` : ''}</span></button>` +
    `<button type="button" data-part="settings-button" class="btn ps-star${p.fav ? ' on' : ''}" data-a="star" data-pid="${esc(p.id)}" tabindex="-1" aria-pressed="${p.fav ? 'true' : 'false'}" aria-label="${esc(t2('favToggle') + ': ' + p.name)}" title="${esc(t2('favToggle'))}">${ic('star', 'lg')}</button>` +
    `<button type="button" data-part="settings-button" class="btn ps-more" data-a="more" data-pid="${esc(p.id)}" tabindex="-1" aria-haspopup="menu" aria-label="${esc(t2('rowMenu', p.name))}" title="${esc(t2('rowMenu', p.name))}">${ic('ellipsis', 'xl')}</button></div></li>`;
}
let RB = Infinity, RBcut = 0;     // rows budget while searching: a long result list renders in chunks ("더 보기") so typing stays cheap on floor devices
const rowsHTML = (items, gid, cm) => { let h = ''; for (const p of items) { if (RB <= 0) { RBcut++; continue; } h += rowLib(p, gid, cm); RB--; } return h; };
function groupHTML(g, m, canMove) {
  if (g.gid === 'fav') {   // R-14: the favourites group collapses like a folder
    if (!m.favs.length) return ''; const open = m.searching || !isCollapsed('fav');
    return `<section data-part="settings-preset-group" class="ps-grp ps-favgrp${open ? '' : ' closed'}" role="group" aria-labelledby="psg-fav" data-gid="fav"><h3 class="ps-gh" id="psg-fav"><button type="button" class="ps-fmain" data-rv data-key="fh:fav" data-fid="fav" tabindex="-1" aria-expanded="${open}"${open ? ' aria-controls="psl-fav"' : ''} aria-labelledby="psfn-fav" aria-describedby="psfc-fav">${ic(open ? 'chevron-down' : 'chevron-right', 'lg')}${ic('star', 'md')}<span class="ps-fname" id="psfn-fav">${esc(t2('favs'))}</span><span class="ps-cnt" id="psfc-fav">${m.favs.length}</span></button></h3>${open ? `<ul class="ps-ul" id="psl-fav" role="list">${rowsHTML(m.favs, 'fav', false)}</ul>` : ''}</section>`;
  }
  if (g.gid === 'none') { if (!m.none.length) return ''; return `<section data-part="settings-preset-group" class="ps-grp" role="group" aria-labelledby="psg-none" data-gid="none" data-fid=""><h3 class="ps-gh" id="psg-none">${ic('folder', 'md')}<span>${esc(t2('noFolder'))}</span><span class="ps-cnt">${m.none.length}</span></h3><ul class="ps-ul" role="list">${rowsHTML(m.none, 'none', canMove)}</ul></section>`; }
  const f = g.f; const open = m.searching || !isCollapsed(f.id); const nm = esc(f.name);
  return `<section data-part="settings-preset-group" class="ps-grp ps-folder${open ? '' : ' closed'}" role="group" aria-labelledby="psf-${esc(f.id)}" data-gid="${esc(f.id)}" data-fid="${esc(f.id)}"><div class="ps-fh" data-fid="${esc(f.id)}"><span class="ps-grip${canMove ? '' : ' off'}" ${canMove ? 'data-grip data-kind="folder"' : ''} aria-hidden="true" title="${esc(t2(canMove ? 'grip' : 'gripDisabled'))}">${ic('grip-vertical', 'lg')}</span>` +
    `<h3 class="ps-fh-t" id="psf-${esc(f.id)}"><button type="button" class="ps-fmain" data-rv data-key="fh:${esc(f.id)}" data-fid="${esc(f.id)}" tabindex="-1" aria-expanded="${open}"${open && g.items.length ? ` aria-controls="psl-${esc(f.id)}"` : ''} aria-labelledby="psfn-${esc(f.id)}" aria-describedby="psfc-${esc(f.id)}">${ic(open ? 'chevron-down' : 'chevron-right', 'lg')}${ic('folder', 'lg')}<span class="ps-fname" id="psfn-${esc(f.id)}" title="${nm}">${nm}</span><span class="ps-cnt" id="psfc-${esc(f.id)}">${g.items.length}</span></button></h3>` +
    `<button type="button" data-part="settings-button" class="btn ps-fmore" data-a="fmore" data-fid="${esc(f.id)}" tabindex="-1" aria-haspopup="menu" aria-label="${esc(t2('folderMenu', f.name))}" title="${esc(t2('folderMenu', f.name))}">${ic('ellipsis', 'xl')}</button></div>` +
    (open ? (g.items.length ? `<ul class="ps-ul" id="psl-${esc(f.id)}" role="list">${rowsHTML(g.items, f.id, canMove)}</ul>` : `<p class="ps-empty">${esc(t2('folderEmpty'))}</p>`) : '') + `</section>`;
}
function libBodyHTML() {
  const m = libModel(); const cm = canMoveNow(); let h = ''; RB = m.searching ? LIB.limit : Infinity; RBcut = 0;
  h += groupHTML({ gid: 'fav' }, m, false);
  m.groups.forEach((g) => { h += groupHTML(g, m, cm); });
  h += groupHTML({ gid: 'none' }, m, cm);
  if (m.searching && !m.list.length) h = `<div class="ps-nores"><p>${esc(t2('noPresetMatch', LIB.q.trim()))}</p><button type="button" data-part="settings-button" class="btn solid" data-a="clearq">${ic('x', 'md')}<span>${esc(t2('clearSearch'))}</span></button></div>`;
  if (RBcut) h += `<button type="button" data-part="settings-button" class="btn solid ps-lmore" data-a="libmore">${esc(t2('more', RBcut))}</button>`;
  h += `<button type="button" data-part="settings-button" class="btn solid ps-trashrow" data-a="trash">${ic('trash-2', 'lg')}<span>${esc(t2('trashOpen', TRASH.length))}</span></button>`;
  LIB.count = m.list.length; return h;
}
function libToolsHTML() {
  const phone = A.S.lay === 'phone'; const sOpen = !phone || LIB.searchOpen || !!LIB.q;
  const seg = (k, lab) => `<button type="button" class="seg-b" role="radio" aria-checked="${LIB.sort === k}" tabindex="${LIB.sort === k ? 0 : -1}" data-a="sort" data-sort="${k}">${esc(lab)}</button>`;
  const ib = (a, icon, lab, extra = '') => `<button type="button" data-part="settings-button" class="btn ps-tb" data-a="${a}" aria-label="${esc(lab)}" title="${esc(lab)}"${extra}>${ic(icon, 'xl')}<span class="ps-tbt">${esc(lab)}</span></button>`;
  return `<div class="ps-tools${sOpen ? ' s-open' : ''}" id="psTools"><div class="ps-trow"><div class="ps-search"><span class="s-ic" aria-hidden="true">${ic('search', 'lg')}</span><input id="psLibQ" type="text" autocomplete="off" spellcheck="false" enterkeyhint="search" value="${esc(LIB.q)}" placeholder="${esc(t2('searchPresets'))}" aria-label="${esc(t2('searchPresets'))}"><button type="button" data-part="settings-button" class="btn s-clear" data-a="clearq" aria-label="${esc(t2('clearSearch'))}" title="${esc(t2('clearSearch'))}"${LIB.q ? '' : ' hidden'}>${ic('x', 'md')}</button></div>` +
    `<button type="button" data-part="settings-button" class="btn ps-sopen" data-a="sopen" aria-label="${esc(t2('libSearchOpen'))}" title="${esc(t2('libSearchOpen'))}">${ic('search', 'xl')}</button>` +
    `<div class="ps-btns">${ib('newfolder', 'folder-plus', t2('newFolder'))}${ib('newpreset', 'plus', t2('newPreset'))}${ib('import', 'download', t2('import'))}${ib('select', 'list-checks', t2('select'), ` aria-pressed="${LIB.sel ? 'true' : 'false'}"`)}${ib('libmore2', 'ellipsis', t2('moreMenu'), ' aria-haspopup="menu"')}</div></div>` +
    `<div class="ps-trow"><div data-part="settings-segmented" class="seg ps-sort" role="radiogroup" aria-label="${esc(t2('sortLabel'))}">${seg('manual', t2('sortManual'))}${seg('recent', t2('sortRecent'))}${seg('name', t2('sortName'))}</div></div>` +
    `<p class="ps-hint" id="psHint" role="note"${LIB.sort === 'manual' ? ' hidden' : ''}>${ic('info', 'md')}<span>${esc(t2('sortHint'))}</span></p>` +
    `<p class="ps-count" id="psCount" role="status"${LIB.q.trim() ? '' : ' hidden'}>${esc(LIB.q.trim() ? t2('searchResult', LIB.q.trim(), LIB.count === undefined ? 0 : LIB.count) : '')}</p></div>`;
}
function libSelBarHTML() {
  if (!LIB.sel) return '<div class="ps-selbar" id="psSelBar" data-part="settings-preset-selbar" hidden></div>';
  const n = LIB.sel.size; const b = (a, icon, lab) => `<button type="button" data-part="settings-button" class="btn solid" data-a="${a}"${n ? '' : ' aria-disabled="true"'}>${ic(icon, 'lg')}<span>${esc(lab)}</span></button>`;
  return `<div class="ps-selbar" id="psSelBar" data-part="settings-preset-selbar" role="toolbar" aria-label="${esc(t2('select'))}"><span class="ps-selc" id="psSelC" role="status">${esc(t2('selectedCount', n))}</span>${b('bulk-move', 'folder', t2('moveToFolder'))}${b('bulk-fav', 'star', t2('favToggle'))}${b('bulk-export', 'download', t2('exportOne'))}${b('bulk-del', 'trash-2', t2('del'))}<button type="button" data-part="settings-button" class="btn accent solid" data-a="done">${esc(t2('done'))}</button></div>`;
}
function libPageHTML() {
  const body = libBodyHTML();
  return `<div data-part="settings-page-body" class="pg ps-libpg" data-page="models" data-view="library"><div data-part="settings-page-header" class="pg-head"><nav class="ps-crumb" aria-label="${esc(t2('crumbNav'))}"><ol><li><button type="button" data-a="crumb">${esc(t2('crumb1'))}</button></li><li><button type="button" data-a="crumb">${esc(t2('crumb2'))}</button></li><li aria-current="page">${esc(t2('crumb3'))}</li></ol></nav>` +
    `<h1 class="pg-title" id="pgTitle" tabindex="-1">${esc(t2('allPresets', D.presets.length))}</h1></div>${libToolsHTML()}<div class="ps-lib" id="psLib" data-part="settings-preset-library"><div id="psLibList">${body}</div><div class="ps-drop" id="psDrop" hidden></div></div>${libSelBarHTML()}</div>`;
}
function applyRoving(focusKey) {
  const rv = $$('#psLibList [data-rv]'); if (!rv.length) return; let cur = (focusKey && rv.find((e) => e.dataset.key === focusKey)) || rv.find((e) => e.dataset.key === LIB.rv) || rv.find((e) => e.classList.contains('ps-main') && e.dataset.pid === A.S.presetActive) || rv[0];
  rv.forEach((e) => { e.tabIndex = e === cur ? 0 : -1; }); LIB.rv = cur.dataset.key; return cur;
}
function rectsByKey() { const o = {}; $$('#psLibList .ps-li').forEach((li) => { o[li.dataset.gid + ':' + li.dataset.pid] = li.getBoundingClientRect(); }); return o; }
function flipAnimate(before, movedKey) {
  if (A.S.lp) return; const rm = A.S.rm;
  $$('#psLibList .ps-li').forEach((li) => {
    const k = li.dataset.gid + ':' + li.dataset.pid; const r0 = before[k]; if (!r0) return; const r1 = li.getBoundingClientRect(); const dy = r0.top - r1.top; if (Math.abs(dy) < 1 && k !== movedKey) return;
    if (rm) { li.style.opacity = 'var(--opacity-disabled)'; li.getBoundingClientRect(); li.classList.add('flip-fade'); li.style.opacity = ''; window.settingsTheme.afterMotion(li, () => li.classList.remove('flip-fade'), 80); return; }
    li.style.transition = 'none'; li.style.transform = `translateY(${dy}px)`; li.getBoundingClientRect(); li.classList.add('flip'); li.style.transition = ''; li.style.transform = '';
    window.settingsTheme.afterMotion(li, () => li.classList.remove('flip'), 120);
  });
}
function renderLib(o = {}) {
  const box = $('#psLibList'); if (!box) return; const t0 = now(); const a = document.activeElement; const inside = a && box.contains(a); const fk = o.focusKey || (inside && a.dataset ? a.dataset.key : null);
  const before = o.flip ? rectsByKey() : null; const keepScroll = $('#pageScroll').scrollTop;
  box.innerHTML = libBodyHTML(); const cur = applyRoving(fk);
  $('#pgTitle').textContent = t2('allPresets', D.presets.length); $('#pageScroll').scrollTop = keepScroll; { const ht = $('#hdrTitle'); if (ht && A.S.lay === 'phone') ht.textContent = t2('allPresets', D.presets.length); }
  paintLibHead();
  if (before) flipAnimate(before, o.movedKey);
  if ((inside || o.focusKey) && cur) cur.focus({ preventScroll: true });
  if (o.focusKey && cur) cur.scrollIntoView({ block: 'nearest' });
  perf.libRender.push(+(now() - t0).toFixed(2)); if (perf.libRender.length > 40) perf.libRender.shift();
}
function paintLibHead() {
  const tools = $('#psTools'); if (!tools) return; $$('.ps-sort .seg-b', tools).forEach((b) => { const on = b.dataset.sort === LIB.sort; b.setAttribute('aria-checked', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1; });
  const h = $('#psHint', tools); h.hidden = LIB.sort === 'manual';
  const c = $('#psCount', tools); const q = LIB.q.trim(); c.hidden = !q; c.textContent = q ? t2('searchResult', q, LIB.count || 0) : '';
  $('[data-a="clearq"]', $('.ps-search', tools)).hidden = !LIB.q; const sb = $('[data-a="select"]', tools); if (sb) sb.setAttribute('aria-pressed', LIB.sel ? 'true' : 'false');
  const bar = $('#psSelBar'); if (bar) { const nb = document.createElement('div'); nb.innerHTML = libSelBarHTML(); bar.replaceWith(nb.firstElementChild); }
  { const nbar = $('#psSelBar'), sc = $('#pageScroll'); if (sc) sc.style.scrollPaddingBottom = LIB.sel && nbar && !nbar.hidden ? (nbar.offsetHeight + 16) + 'px' : ''; }   // DS-078: the sticky selection bar covers the bottom of the list, so focus is scrolled clear of it
  const p = $('.ps-libpg'); if (p) p.classList.toggle('selecting', !!LIB.sel);
}
function toggleFolder(fid, force) {
  const t0 = now(); const was = isCollapsed(fid); const nextCollapsed = force === undefined ? !was : force; COLL[fid] = nextCollapsed; persistColl();
  const sec = fid === 'fav' ? $('#psLibList .ps-favgrp') : $(`#psLibList .ps-folder[data-fid="${CSS.escape(fid)}"]`); if (!sec) return; const m = libModel(); const g = fid === 'fav' ? { gid: 'fav' } : m.groups.find((x) => x.gid === fid); if (!g) return;
  const hadFocus = sec.contains(document.activeElement); const tmp = document.createElement('div'); tmp.innerHTML = groupHTML(g, m, canMoveNow()); sec.replaceWith(tmp.firstElementChild);
  const cur = applyRoving(hadFocus ? 'fh:' + fid : null); if (hadFocus && cur) cur.focus({ preventScroll: true });
  perf.folderToggle.push(+(now() - t0).toFixed(2)); if (perf.folderToggle.length > 40) perf.folderToggle.shift();
  announce(t2('folderToggle', fid === 'fav' ? t2('favs') : folderName(fid)) + ' ' + (nextCollapsed ? '' : t2('presetResults', fid === 'fav' ? m.favs.length : g.items.length)));
}
function openLibrary(o = {}) {
  S2.view = 'library'; LIB.q = o.q !== undefined ? o.q : ''; if (o.q === undefined) LIB.searchOpen = false; if (o.sort) LIB.sort = o.sort;
  const p = o.focus ? P(o.focus) : null; if (p && p.folder) { COLL[p.folder] = false; }
  A.showPage('models', { lib: true, noAnim: o.noAnim !== false, focusHead: !p, section: 'models.presets', fromSearch: o.fromSearch, noRestore: true });
  const sc = $('#pageScroll'); if (sc) sc.scrollTop = 0;
  if (p) { const el = $(`#psLibList .ps-main[data-pid="${CSS.escape(p.id)}"][data-gid]:not([data-gid="fav"])`) || $(`#psLibList .ps-main[data-pid="${CSS.escape(p.id)}"]`); if (el) { el.scrollIntoView({ block: 'center' }); A.highlight(el.closest('li')); applyRoving(el.dataset.key); el.focus({ preventScroll: true }); } }
  return true;
}
function closeLibrary(o = {}) {
  if (S2.view !== 'library') return false; endDrag(true); LIB.sel = null; LIB.q = ''; S2.view = 'section';
  A.showPage('models', { section: 'models.presets', row: A.ROW['models.presetsAll'], noAnim: true, noRestore: true });
  return true;
}
function openLibraryFrom(opener) {
  if (!A.S.open) { A.openSettings(opener || $('#oSettings'), { page: 'models', section: 'models.presets', noFocus: true }); }
  openLibrary({ noAnim: true });
}

/* ---- rows: menu (pointer, touch, keyboard parity), rename, selection */
const hint = (s) => (matchMedia('(pointer: coarse)').matches ? '' : s);   // R-22: keyboard hints are not shown on touch
function presetMenuItems(pid, ctx) {
  const p = P(pid); const act1 = pid === A.S.presetActive; const moveOk = ctx === 'library' && canMoveNow();
  return [
    { icon: 'check', label: t2('switchTo'), disabled: act1, fn: () => switchTo(pid) },
    { icon: 'star', label: p.fav ? t2('favRemove') : t2('favAdd'), fn: () => toggleFav(pid) },
    { icon: 'keyboard', label: t2('assignShortcut') + '…', fn: () => openSlotDialog(pid) },
    { icon: 'pencil', label: t2('rename') + hint(' (F2)'), fn: () => startRename(pid, ctx) },
    { icon: 'copy', label: t2('duplicate'), fn: () => { const c = duplicatePreset(pid); if (c && S2.view === 'library') renderLib({ focusKey: p.folder ? p.folder + ':' + c.id : 'none:' + c.id, flip: true }); } },
    { icon: 'folder', label: t2('moveToFolder') + '…', fn: () => openMoveDialog([pid]) },
    { icon: 'arrow-up', label: t2('up') + hint(' (Alt+↑)'), disabled: !moveOk, fn: () => moveRow(pid, -1) },
    { icon: 'arrow-down', label: t2('down') + hint(' (Alt+↓)'), disabled: !moveOk, fn: () => moveRow(pid, 1) },
    { icon: 'download', label: t2('exportOne'), fn: () => exportPresets([pid]) },
    { icon: 'wand', label: t2('openStudio'), href: A.studioHref('preset', pid) },
    { icon: 'trash-2', label: t2('del'), fn: () => openDeleteDialog([pid]) },
  ];
}
function openRowMenu(pid, anchor, point, opener) { A.showMenu(presetMenuItems(pid, 'library'), anchor, point, opener, t2('rowMenu', P(pid).name)); }
function moveRow(pid, dir) {
  const before = rectsByKey(); const gKey = (document.activeElement && document.activeElement.dataset && document.activeElement.dataset.gid) || null; void gKey;
  if (!kbMove(pid, dir)) return false; const p = P(pid);
  renderLib({ flip: true, focusKey: (p.folder || 'none') + ':' + pid, movedKey: (p.folder || 'none') + ':' + pid }); void before; return true;
}
function startRename(pid, ctx) {
  let host, nameEl, key;
  if (ctx === 'card') { host = $('.ps-card'); nameEl = host && $('.ps-cname', host); }
  else { const main = $(`#psLibList .ps-main[data-pid="${CSS.escape(pid)}"]:not([data-gid="fav"])`) || $(`#psLibList .ps-main[data-pid="${CSS.escape(pid)}"]`); if (main) { host = main.closest('.ps-row'); nameEl = host; key = main.dataset.key; } }
  if (!host) return false; const p = P(pid); const inp = document.createElement('input'); inp.type = 'text'; inp.className = 'inp ps-rename'; inp.value = p.name; inp.setAttribute('aria-label', t2('rename') + ': ' + p.name); inp.autocomplete = 'off'; inp.spellcheck = false; inp.maxLength = NAME_MAX; inp.title = p.name;
  const warn = document.createElement('span'); warn.className = 'ps-dupwarn'; warn.setAttribute('role', 'status'); warn.hidden = true; warn.textContent = t2('duplicateName');
  inp.addEventListener('input', () => { warn.hidden = !(inp.value.trim() && nameTaken(inp.value, pid)); }); const cnt = nameCounter(inp);
  let done = false;
  const finish = (commit) => {
    if (done) return; done = true; const v = inp.value; inp.remove(); warn.remove(); cnt.remove(); host.classList.remove('renaming'); if (ctx === 'card') nameEl.hidden = false;
    if (commit) renamePreset(pid, v);
    if (S2.view === 'library') renderLib({ focusKey: key }); else paintCard();
    const f = ctx === 'card' ? $('.ps-ico', host) : $(`#psLibList [data-key="${CSS.escape(key || '')}"]`); if (f) f.focus({ preventScroll: true });
  };
  inp.addEventListener('keydown', (ev) => { if (ev.isComposing || ev.keyCode === 229) return; if (ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); finish(true); } else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); finish(false); } else ev.stopPropagation(); });
  inp.addEventListener('blur', () => finish(true));
  host.classList.add('renaming'); if (ctx === 'card') { nameEl.hidden = true; nameEl.after(inp); inp.after(warn); warn.after(cnt); } else { host.insertBefore(inp, $('.ps-main', host)); host.after(warn); warn.after(cnt); } inp.focus(); inp.select(); return true;
}
function toggleSel(id, shift) {
  if (!LIB.sel) return; const mains = $$('#psLibList .ps-main:not([data-gid="fav"])'); const ids = mains.map((m) => m.dataset.pid);
  if (shift && LIB.anchor && ids.includes(LIB.anchor)) { const a = ids.indexOf(LIB.anchor), b = ids.indexOf(id); const [lo, hi] = a < b ? [a, b] : [b, a]; for (let i = lo; i <= hi; i++) LIB.sel.add(ids[i]); }
  else { if (LIB.sel.has(id)) LIB.sel.delete(id); else LIB.sel.add(id); LIB.anchor = id; }
  const key = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.key : null; renderLib({ focusKey: key });
  announce(t2('selectedCount', LIB.sel.size));
}
function enterSelect() { if (LIB.sel) return; LIB.sel = new Set(); LIB.anchor = null; renderLib(); }
function exitSelect(focusKey) { if (!LIB.sel) return false; LIB.sel = null; LIB.anchor = null; renderLib({ focusKey }); const b = $('[data-a="select"]', $('#psTools')); if (b && !focusKey) b.focus({ preventScroll: true }); return true; }
function folderMenu(fid, anchor, point, opener) {
  const f = FOLD.find((x) => x.id === fid); const mo = canMoveNow(); const i = FOLD.indexOf(f);
  A.showMenu([
    { icon: 'pencil', label: t2('rename'), fn: () => startFolderRename(fid) },
    { icon: 'arrow-up', label: t2('up'), disabled: !mo || i === 0, fn: () => { moveFolder(fid, -1); renderLib({ flip: false, focusKey: 'fh:' + fid }); } },
    { icon: 'arrow-down', label: t2('down'), disabled: !mo || i === FOLD.length - 1, fn: () => { moveFolder(fid, 1); renderLib({ focusKey: 'fh:' + fid }); } },
    { icon: 'trash-2', label: t2('deleteFolder'), fn: () => openDeleteFolderDialog(fid) },
  ], anchor, point, opener, t2('folderMenu', f.name));
}
function startFolderRename(fid) {
  const f = FOLD.find((x) => x.id === fid); const h = $(`#psLibList .ps-fh[data-fid="${CSS.escape(fid)}"]`); if (!h) return false; const t = $('.ps-fh-t', h); let done = false;
  const inp = document.createElement('input'); inp.type = 'text'; inp.className = 'inp ps-rename'; inp.value = f.name; inp.setAttribute('aria-label', t2('rename') + ': ' + f.name); inp.autocomplete = 'off'; inp.maxLength = NAME_MAX;
  const warn = document.createElement('span'); warn.className = 'ps-dupwarn'; warn.setAttribute('role', 'status'); warn.hidden = true; warn.textContent = t2('folderDup');
  inp.addEventListener('input', () => { warn.hidden = !(inp.value.trim() && FOLD.some((x) => x.id !== fid && x.name.trim().toLowerCase() === inp.value.trim().toLowerCase())); }); const cnt = nameCounter(inp);
  const finish = (commit) => { if (done) return; done = true; const v = inp.value; inp.remove(); warn.remove(); cnt.remove(); t.hidden = false; if (commit) renameFolder(fid, v); renderLib({ focusKey: 'fh:' + fid }); const b = $(`#psLibList [data-key="fh:${CSS.escape(fid)}"]`); if (b) b.focus({ preventScroll: true }); };
  inp.addEventListener('keydown', (ev) => { if (ev.isComposing || ev.keyCode === 229) return; if (ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); finish(true); } else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); finish(false); } else ev.stopPropagation(); });
  inp.addEventListener('blur', () => finish(true)); t.hidden = true; t.after(inp); h.after(warn); warn.after(cnt); inp.focus(); inp.select(); return true;
}

/* ---- drag (pointer: grip; touch: long-press then drag) */
function dropTarget(y, kind, dragId) {
  const box = $('#psLibList'); const lr = $('#psLib').getBoundingClientRect();
  if (kind === 'folder') {
    const hs = $$('.ps-folder .ps-fh', box).filter((h) => h.dataset.fid !== dragId); let idx = hs.length, lineY = hs.length ? hs[hs.length - 1].closest('.ps-folder').getBoundingClientRect().bottom : lr.top;
    for (let i = 0; i < hs.length; i++) { const r = hs[i].getBoundingClientRect(); if (y < r.top + r.height / 2) { idx = i; lineY = r.top; break; } }
    return { kind, idx, lineY: lineY - lr.top };
  }
  const secs = $$('.ps-grp[data-fid]', box); if (!secs.length) return null; let best = secs[0], bd = 1e9;
  secs.forEach((s) => { const r = s.getBoundingClientRect(); const d = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0; if (d < bd) { bd = d; best = s; } });
  const fid = best.dataset.fid || null; const lis = $$('.ps-li', best).filter((li) => li.dataset.pid !== dragId); let idx = lis.length, lineY;
  if (best.classList.contains('closed')) { const r = best.getBoundingClientRect(); return { kind, fid, idx: 1e9, lineY: r.bottom - lr.top }; }
  for (let i = 0; i < lis.length; i++) { const r = lis[i].getBoundingClientRect(); if (y < r.top + r.height / 2) { idx = i; lineY = r.top; break; } }
  if (idx === lis.length) lineY = lis.length ? lis[lis.length - 1].getBoundingClientRect().bottom : best.getBoundingClientRect().bottom - 4;
  return { kind, fid, idx, lineY: lineY - lr.top };
}
function beginDrag(el, kind, id, ev) {
  endDrag(true); const sc = $('#pageScroll'); const r0 = el.getBoundingClientRect();
  LIB.drag = { el, kind, id, y0: ev.clientY, x0: ev.clientX, pid: ev.pointerId, tgt: null, sc, raf: 0, scroll0: sc.scrollTop, lastY: ev.clientY };
  el.classList.add('dragging'); $('#psLib').classList.add('is-dragging'); void r0;
  document.addEventListener('pointermove', dragMove, true); document.addEventListener('pointerup', dragUp, true); document.addEventListener('pointercancel', dragCancel, true); document.addEventListener('keydown', dragKey, true);
  announce(t2('grip'));
}
function dragMove(ev) {
  const d = LIB.drag; if (!d || ev.pointerId !== d.pid) return; ev.preventDefault(); d.lastY = ev.clientY;
  updateDrag(); autoScroll();
}
function updateDrag() {
  const d = LIB.drag; if (!d) return; const dy = d.lastY - d.y0 + (d.sc.scrollTop - d.scroll0); d.el.style.transform = `translateY(${dy}px)`;
  const tg = dropTarget(d.lastY, d.kind, d.kind === 'folder' ? d.id : d.id); d.tgt = tg; const line = $('#psDrop'); if (tg && line) { line.hidden = false; line.style.transform = `translateY(${tg.lineY}px)`; }
}
function autoScroll() {
  const d = LIB.drag; if (!d || d.raf) return; const sr = d.sc.getBoundingClientRect(); const step = () => { d.raf = 0; if (!LIB.drag) return; let dy = 0; if (d.lastY < sr.top + 48) dy = -10; else if (d.lastY > sr.bottom - 48) dy = 10; if (dy) { d.sc.scrollTop += dy; updateDrag(); d.raf = requestAnimationFrame(step); } }; d.raf = requestAnimationFrame(step);
}
function dragUp(ev) { const d = LIB.drag; if (!d || ev.pointerId !== d.pid) return; ev.preventDefault(); d.lastY = ev.clientY; updateDrag(); const tg = d.tgt; const kind = d.kind, id = d.id; endDrag(true, true);
  if (!tg) return; LIB.noClick = true; setTimeout(() => { LIB.noClick = false; }, 300);
  if (kind === 'folder') { placeFolder(id, tg.idx); renderLib({ flip: false, focusKey: 'fh:' + id }); return; }
  const p = P(id); const before0 = { f: p.folder || null, i: D.presets.indexOf(p) }; const pos = placeIn(id, tg.fid, tg.idx); void pos; recMove(p, before0); if (tg.fid) COLL[tg.fid] = false; persistColl();
  moveAnnounce(p); const key = (p.folder || 'none') + ':' + id; renderLib({ flip: true, focusKey: key, movedKey: key });
}
function dragCancel() { endDrag(true); }
function dragKey(ev) { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); endDrag(true); } }
function endDrag(clean, keepNoClick) {
  const d = LIB.drag; document.removeEventListener('pointermove', dragMove, true); document.removeEventListener('pointerup', dragUp, true); document.removeEventListener('pointercancel', dragCancel, true); document.removeEventListener('keydown', dragKey, true);
  if (!d) return; cancelAnimationFrame(d.raf); d.el.classList.remove('dragging', 'lifted'); d.el.style.transform = ''; LIB.drag = null; const line = $('#psDrop'); if (line) line.hidden = true; const lib = $('#psLib'); if (lib) lib.classList.remove('is-dragging'); void clean; void keepNoClick;
}
let lp = null;     // touch long-press: 300 ms arms (lift), then a move drags; no move within 300 ms more opens the menu
function lpClear() { if (lp) { clearTimeout(lp.t1); clearTimeout(lp.t2); lp = null; } }

/* ------------------------------------------------------------------ dialogs (built on slice 1's openDialog: focus trap, Esc, inert page) */
const folderOptions = (sel, withNone = true) => (withNone ? `<option value=""${!sel ? ' selected' : ''}>${esc(t2('noFolder'))}</option>` : '') + FOLD.map((f) => `<option value="${esc(f.id)}"${f.id === sel ? ' selected' : ''}>${esc(f.name)}</option>`).join('');
const presetOptions = (sel, skip) => { let h = ''; const by = {}; D.presets.forEach((p) => { if (skip && skip.includes(p.id)) return; (by[p.folder || ''] = by[p.folder || ''] || []).push(p); }); FOLD.concat([{ id: '', name: t2('noFolder') }]).forEach((f) => { const l = by[f.id]; if (l) h += `<optgroup label="${esc(f.name)}">${l.map((p) => `<option value="${esc(p.id)}"${p.id === sel ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</optgroup>`; }); return h; };
function enterPrimary(back, input) { input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && !ev.isComposing && ev.keyCode !== 229) { const b = $('[data-dlg].accent, [data-dlg][data-primary]', back) || $('[data-dlg="create"]', back) || $('[data-dlg="ok"]', back); if (b && b.getAttribute('aria-disabled') !== 'true') { ev.preventDefault(); b.click(); } } }); }
let ncUid = 0;
function nameCounter(inp, el) {      // N-12: "n/60" from 50 characters on, shared by every name field
  if (!el) { el = document.createElement('span'); el.className = 'ps-ncount'; el.id = 'ncn' + (++ncUid); el.hidden = true; inp.setAttribute('aria-describedby', ((inp.getAttribute('aria-describedby') || '') + ' ' + el.id).trim()); }
  const upd = () => { const n = inp.value.length; el.hidden = n < 50; el.textContent = t2('nameCount', n); }; inp.addEventListener('input', upd); upd(); return el;
}
function openNewDialog() {
  const cur = act();
  const d = A.openDialog({ title: t2('newPreset'), body: `<label class="dlg-l" for="npName">${esc(t2('presetName'))}</label><input id="npName" data-part="settings-field" class="inp" type="text" autocomplete="off" spellcheck="false" maxlength="${NAME_MAX}" aria-describedby="npHint npDup npCount"><p class="dlg-hint" id="npHint">${esc(t2('nameNeeded'))}</p><p class="dlg-hint dlg-count" id="npCount" hidden></p><p class="dlg-hint warn" id="npDup" role="status" hidden>${esc(t2('duplicateName'))}</p>` +
    `<fieldset class="dlg-fs"><legend>${esc(t2('startFrom'))}</legend><label class="dlg-r"><input type="radio" name="npFrom" value="current" checked><span>${esc(t2('copyCurrent'))}</span></label><label class="dlg-r"><input type="radio" name="npFrom" value="template"><span>${esc(t2('defaultTemplate'))}</span></label></fieldset>` +
    `<label class="dlg-l" for="npFolder">${esc(t2('folder'))}</label><select id="npFolder" data-part="settings-field" class="inp">${folderOptions(cur.folder)}</select><label class="dlg-r dlg-use"><input type="checkbox" id="npUse"><span>${esc(t2('useNow'))}</span></label>`,
    buttons: [{ id: 'cancel', label: t2('cancel') }, { id: 'create', label: t2('create'), primary: true, disabled: true }], initial: '#npName' });
  const inp = $('#npName', d.back), btn = $('[data-dlg="create"]', d.back);
  inp.addEventListener('input', () => { const v = inp.value.trim(); btn.setAttribute('aria-disabled', v ? 'false' : 'true'); $('#npHint', d.back).hidden = !!v; $('#npDup', d.back).hidden = !(v && nameTaken(v)); });
  nameCounter(inp, $('#npCount', d.back));
  enterPrimary(d.back, inp);
  A.openDialog.handlers = { create: () => {
    const name = inp.value.trim(); if (!name) return false; const from = ($('input[name="npFrom"]:checked', d.back) || {}).value || 'current'; const folder = $('#npFolder', d.back).value || null; const useNow = $('#npUse', d.back).checked;
    setTimeout(() => { const p = createPreset({ name: name.slice(0, NAME_MAX), from, folder, useNow }); if (S2.view === 'library') renderLib({ focusKey: (p.folder || 'none') + ':' + p.id }); else if (A.S.open) A.refreshPage(); }, 0);
  } };
  return d;
}
function openDeleteDialog(ids) {
  ids = ids.filter((id) => P(id));
  if (D.presets.length - ids.length < 1) {
    const d = A.openDialog({ critical: true, title: t2('lastPreset'), body: `<p>${esc(t2('lastPresetBody'))}</p>`, buttons: [{ id: 'ok', label: t2('close'), primary: true }] }); A.openDialog.handlers = {}; return d;
  }
  let body = '', title;
  if (ids.length === 1) {
    const p = P(ids[0]); title = t2('deletePresetQ', cl(p.name, 40)); const sn = slotOf(p.id);
    body = `<dl class="dlg-dl"><div><dt>${esc(t2('detailFolder'))}</dt><dd>${esc(p.folder ? folderName(p.folder) : t2('noFolder'))}</dd></div><div><dt>${esc(t2('detailSlot'))}</dt><dd>${esc(sn ? slotLabel(sn) : t2('detailNone'))}</dd></div><div><dt>${esc(t2('detailFav'))}</dt><dd>${esc(p.fav ? t2('yes') : t2('detailNone'))}</dd></div></dl>`;
    if (p.id === A.S.presetActive) { const nx = D.presets.filter((x) => x.id !== p.id).sort((a, b) => b.lastUsed - a.lastUsed)[0]; body += `<p class="dlg-hint" id="delNote">${esc(t2('deleteActiveNote', nx.name))}</p>`; }
  } else { title = t2('deletePresetsQ', ids.length); body = `<p>${esc(ids.slice(0, 5).map((id) => cl(P(id).name, 24)).join(', ') + (ids.length > 5 ? ' …' : ''))}</p>`; }
  { const nch = ids.some((id) => CHAIN.includes(id)) ? 1 : 0, nld = LOAD.filter((l) => ids.some((id) => l.presets.includes(id))).length, nem = LOAD.filter((l) => l.presets.length && l.presets.every((x) => ids.includes(x))).length; if (nch || nld) body += `<p class="dlg-hint" id="delUses">${esc(t2('usesLine', nch, nld, nem))}</p>`; }   // DS-030
  const d = A.openDialog({ critical: true, title, body, buttons: [{ id: 'cancel', label: t2('cancel') }, { id: 'del', label: t2('deleteBtn'), danger: true }], initial: '[data-dlg="cancel"]' });
  A.openDialog.handlers = { del: () => { setTimeout(() => { const keyNear = nearKey(ids[0]); exitSelectQuiet(); deletePresets(ids); if (S2.view === 'library') renderLib({ focusKey: keyNear }); }, 0); } };
  return d;
}
function nearKey(pid) { const mains = $$('#psLibList .ps-main:not([data-gid="fav"])'); const i = mains.findIndex((m) => m.dataset.pid === pid); const n = mains[i + 1] || mains[i - 1]; return n ? n.dataset.key : null; }
function exitSelectQuiet() { LIB.sel = null; LIB.anchor = null; const sc = $('#pageScroll'); if (sc) sc.style.scrollPaddingBottom = ''; }
function openMoveDialog(ids) {
  const first = P(ids[0]); const d = A.openDialog({ title: t2('moveToFolder'), body: `<label class="dlg-l" for="mvFolder">${esc(t2('folder'))}</label><select id="mvFolder" data-part="settings-field" class="inp">${folderOptions(ids.length === 1 ? first.folder : '')}</select>`, buttons: [{ id: 'cancel', label: t2('cancel') }, { id: 'mv', label: t2('moveBtn'), primary: true }], initial: '#mvFolder' });
  A.openDialog.handlers = { mv: () => { const fid = $('#mvFolder', d.back).value || null; setTimeout(() => { const le = moveManyToFolder(ids, fid); const nm = fid ? folderName(fid) : t2('noFolder'); psToast(ids.length === 1 ? t2('moved', first.name, nm) : t2('movedMany', ids.length, nm), { kind: 'move', until: 'page', action: luAction(le) }); announce(t2('moved', first.name, nm)); exitSelectQuiet(); if (S2.view === 'library') renderLib({ focusKey: (fid || 'none') + ':' + ids[0], flip: true }); updateChrome(true); }, 0); } };
  return d;
}
function openSlotDialog(pid, preSlot) {
  const p = P(pid); let sel = preSlot === undefined ? slotOf(pid) : preSlot; let touched = preSlot !== undefined;
  const slotHTML = () => Array.from({ length: 9 }, (_, i) => { const n = i + 1; const o = SLOT[n] && P(SLOT[n]); return `<button type="button" class="ps-slotbtn${sel === n ? ' on' : ''}" data-slot="${n}" aria-pressed="${sel === n}"><span class="ps-sk">${esc(slotLabel(n))}</span><span class="ps-sv" title="${esc(o ? o.name : '')}">${esc(o ? o.name : t2('slotEmpty'))}</span></button>`; }).join('') + `<button type="button" class="ps-slotbtn none${sel === 0 ? ' on' : ''}" data-slot="0" aria-pressed="${sel === 0}"><span class="ps-sk">${esc(t2('slotNone'))}</span></button>`;
  const d = A.openDialog({ title: t2('assignShortcut') + ': ' + cl(p.name, 30), body: `<div class="ps-slots" role="group" aria-label="${esc(t2('slotPick'))}" id="slGrid">${slotHTML()}</div><p class="dlg-hint" id="slNote" role="status"></p>`, buttons: [{ id: 'cancel', label: t2('cancel') }, { id: 'assign', label: t2('assignBtn'), primary: true, disabled: !touched && sel === slotOf(pid) }], initial: '[data-slot].on, [data-slot="1"]' });
  const upd = () => {
    const occ = sel > 0 ? SLOT[sel] : null; const other = occ && occ !== pid ? P(occ) : null; const btn = $('[data-dlg="assign"]', d.back); const mine = slotOf(pid);
    $('#slGrid', d.back).innerHTML = slotHTML(); const note = $('#slNote', d.back); const vac = sel > 0 && mine && mine !== sel ? t2('slotVacateNote', slotLabel(mine)) : '';
    if (other && mine && mine !== sel) { note.textContent = t2('keySwapQ', slotLabel(sel), p.name, other.name); btn.textContent = t2('swap'); } else if (other) { note.textContent = t2('slotMoveNote', slotLabel(sel), other.name) + (vac ? '. ' + vac : ''); btn.textContent = t2('move'); } else if (sel > 0 && occ === pid) { note.textContent = t2('slotSame'); btn.textContent = t2('assignBtn'); } else { note.textContent = vac; btn.textContent = t2('assignBtn'); }
    btn.setAttribute('aria-disabled', (!touched || (sel > 0 && occ === pid) || (sel === 0 && !slotOf(pid))) ? 'true' : 'false');
  };
  d.back.addEventListener('click', (ev) => { const b = ev.target.closest('[data-slot]'); if (!b) return; sel = +b.dataset.slot; touched = true; upd(); const nb = $(`[data-slot="${sel}"]`, d.back); if (nb) nb.focus(); });
  upd(); { const f0 = $('[data-slot].on', d.back) || $('[data-slot="1"]', d.back); if (f0) f0.focus(); }      // N-02: upd() rebuilt the grid, so focus goes to the selected slot again
  A.openDialog.handlers = { assign: () => { if (!touched) return false; setTimeout(() => {
    if (sel === 0) { const e = clearSlotU(pid); psToast(t2('slotCleared', p.name), { kind: 'slot', until: 'page', action: e ? luAction(e) : null }); } else { const mine = slotOf(pid); const oth = SLOT[sel] && SLOT[sel] !== pid && P(SLOT[sel]) ? P(SLOT[sel]) : null; if (oth && mine && mine !== sel) { const e = swapSlotU(sel, pid); psToast(t2('keySwapped', slotLabel(sel), p.name, oth.name), { kind: 'slot', until: 'page', action: e ? luAction(e) : null }); } else { const e = assignSlotU(sel, pid); psToast(t2('slotAssigned', slotLabel(sel), p.name), { kind: 'slot', until: 'page', sub: mine && mine !== sel ? t2('slotVacated', slotLabel(mine)) : '', action: e ? luAction(e) : null }); } }
    updateChrome(); if (A.S.open && S2.view === 'section') A.refreshPage(); }, 0); } };
  return d;
}
function openSlotPick(n) {
  const d = A.openDialog({ title: t2('slotSelect', n) + ' (' + slotLabel(n) + ')', body: `<label class="dlg-l" for="spSel">${esc(t2('slotSelect', n))}</label><select id="spSel" data-part="settings-field" class="inp">${presetOptions(act().id)}</select>`, buttons: [{ id: 'cancel', label: t2('cancel') }, { id: 'ok', label: t2('assignBtn'), primary: true }], initial: '#spSel' });
  A.openDialog.handlers = { ok: () => { const id = $('#spSel', d.back).value; setTimeout(() => { const mine = slotOf(id); const e = assignSlotU(n, id); psToast(t2('slotAssigned', slotLabel(n), P(id).name), { kind: 'slot', until: 'page', sub: mine && mine !== n ? t2('slotVacated', slotLabel(mine)) : '', action: e ? luAction(e) : null }); updateChrome(); if (A.S.open && S2.view === 'section') A.refreshPage(); }, 0); } };
}
function openIconDialog() {
  const p = act(); const d = A.openDialog({ title: t2('iconPick') + ': ' + cl(p.name, 30), body: `<div class="ps-icons" role="group" aria-label="${esc(t2('iconPick'))}">${DD.ICON_CHOICES.map((n) => `<button type="button" data-part="settings-button" class="btn solid ps-icbtn${p.icon === n ? ' on' : ''}" data-icon="${n}" aria-pressed="${p.icon === n}" aria-label="${esc(t2('iconNames')[n] || n)}" title="${esc(t2('iconNames')[n] || n)}">${ic(n, '2xl')}</button>`).join('')}</div>`, buttons: [{ id: 'cancel', label: t2('close') }], initial: '.ps-icbtn.on, .ps-icbtn' });
  d.back.addEventListener('click', (ev) => { const b = ev.target.closest('[data-icon]'); if (!b) return; p.icon = b.dataset.icon; d.close('icon'); updateChrome(); if (A.S.open && S2.view === 'section') A.refreshPage(); announce(t2('iconSet')); });
  A.openDialog.handlers = {}; return d;
}
const RP_KIND = { activate: 'rpActivate', daily: 'rpDaily', before: 'beforeRestore', manual: 'rpManual' };
function openRestoreDialog() {
  const p = act(); const list = p.rps.slice().reverse();
  const items = list.length ? `<ul class="ps-rps" data-part="settings-restore-points" role="list">${list.map((r) => `<li><div class="rp-t"><strong>${esc(fmtT(r.t))}</strong><span class="rp-k">${esc(t2(RP_KIND[r.kind] || 'rpManual'))}</span></div><span class="rp-n">${esc(t2('changesCount', diffCount(p, r.vals)))}</span><button type="button" data-part="settings-button" class="btn solid" data-dlg="rp:${esc(r.id)}">${esc(t2('restoreBtn'))}</button></li>`).join('')}</ul>` : `<p>${esc(t2('rpNone'))}</p>`;
  const d = A.openDialog({ critical: true, title: t2('restorePoints') + ': ' + p.name, body: items + `<p class="dlg-hint">${esc(t2('rpHint'))}</p>`, buttons: [{ id: 'cancel', label: t2('close'), primary: true }], onClose: (why) => { if (why && why.indexOf('rp:') === 0) setTimeout(() => openRestoreConfirm(why.slice(3)), 0); }, initial: '[data-dlg^="rp:"]' });
  A.openDialog.handlers = {}; return d;
}
function openRestoreConfirm(rpId) {
  const p = act(); const rp = p.rps.find((x) => x.id === rpId); if (!rp) return; const n = diffCount(p, rp.vals);
  A.openDialog({ critical: true, title: t2('restoreQ', fmtT(rp.t)), body: `<p>${esc(t2('restoreBody', n))}</p>`, buttons: [{ id: 'cancel', label: t2('cancel') }, { id: 'ok', label: t2('restoreBtn'), primary: true }], initial: '[data-dlg="cancel"]' });
  A.openDialog.handlers = { ok: () => { setTimeout(() => restoreRP(rpId), 0); } };
}
const IMPORT_FILES = {   // simulated files; error kinds change nothing in the library (R-17)
  one: { items: [{ name: '균형', model: 'claude-sonnet-45', regex: 3, toggles: 5 }] },
  bundle: { items: [{ name: '번역용', model: 'gpt-5-mini', regex: 1, toggles: 2 }, { name: '새벽 일기', model: 'claude-sonnet-45', regex: 0, toggles: 4 }, { name: '균형', model: 'claude-sonnet-45', regex: 3, toggles: 5 }] },
  partial: { items: [{ name: '여행 도우미', model: 'gpt-5-mini', regex: 2, toggles: 1 }, { name: '', model: 'claude-sonnet-45', regex: 0, toggles: 0, bad: { ko: '이름이 없어요', en: 'no name' } }, { name: '요약 노트', model: 'no-such-model', regex: 0, toggles: 0, bad: { ko: '알 수 없는 모델이에요', en: 'unknown model' } }] },
  bad: { error: 'impBadMsg' }, format: { error: 'impFormatMsg' }, newer: { error: 'impNewerMsg' }, empty: { error: 'impEmptyMsg' },
};
const IMPORT_OPTS = [['one', 'importOne'], ['bundle', 'importBundle'], ['partial', 'impPartial'], ['bad', 'impBad'], ['format', 'impFormat'], ['newer', 'impNewer'], ['empty', 'impEmpty']];
function openImportDialog(which = 'one') {
  let file = which;
  const d = A.openDialog({ critical: true, title: t2('importPreview'), body: '<div id="imBody"></div>', buttons: [{ id: 'cancel', label: t2('cancel') }, { id: 'im', label: t2('importBtn'), primary: true }], initial: '#imFile' });
  const pick = new Set();
  const draw = () => {
    const F = IMPORT_FILES[file]; const items = F.items || []; const taken = new Set(D.presets.map((p) => p.name.trim().toLowerCase())); const lg = A.S.lang;
    const resolved = items.map((it) => { if (it.bad) return it.name; let n = it.name, i = 2; while (taken.has(n.trim().toLowerCase())) { n = it.name + ' (' + i + ')'; i++; } taken.add(n.trim().toLowerCase()); return n; });
    const list = items.map((it, i) => {
      if (it.bad) return `<li class="im-it bad"><span><strong>${esc(it.name || t2('unnamed'))}</strong></span><span class="im-clash" role="note">${esc(t2('impInvalid', it.bad[lg]))}</span></li>`;
      const clash = resolved[i] !== it.name; return `<li class="im-it"><label class="dlg-r"><input type="checkbox" data-im="${i}"${pick.has(i) ? ' checked' : ''}><span><strong>${esc(it.name)}</strong> <span class="im-m">${esc(mshort(it.model))}</span></span></label><span class="im-inc">${esc([t2('inclParams'), t2('inclPrompt'), t2('inclRegex', it.regex), t2('inclToggles', it.toggles)].join(' · '))}</span>${clash ? `<span class="im-clash" role="note">${esc(t2('importClash', resolved[i]))}</span>` : ''}</li>`;
    }).join('');
    const bad = items.filter((it) => it.bad).length; const ok = items.length - bad;
    const opts = IMPORT_OPTS.map(([v, k]) => `<option value="${v}"${file === v ? ' selected' : ''}>${esc(t2(k))}</option>`).join('');
    const head = `<label class="dlg-l" for="imFile">${esc(t2('importFile'))}</label><select id="imFile" data-part="settings-field" class="inp">${opts}</select>`;
    const btn = $('[data-dlg="im"]', d.back);
    if (F.error) { $('#imBody', d.back).innerHTML = head + `<p class="im-err" role="alert" id="imErr">${ic('circle-alert', 'md')} ${esc(t2(F.error))}</p>`; btn.textContent = t2('importCount', 0); btn.setAttribute('aria-disabled', 'true'); return; }
    $('#imBody', d.back).innerHTML = head + (bad ? `<p class="dlg-hint warn" role="status" id="imPartial">${esc(t2('impPartialMsg', ok, bad))}</p>` : '') +
      `<p class="dlg-hint">${esc(t2('importIncl'))}</p><ul class="im-list" role="list">${list}</ul><label class="dlg-l" for="imFolder">${esc(t2('importTo'))}</label><select id="imFolder" data-part="settings-field" class="inp">${folderOptions(act().folder)}</select><p class="dlg-hint" id="imKeys">${ic('info', 'sm')} ${esc(t2('keysNotIncluded'))}</p><p class="dlg-hint" id="imCaution">${ic('triangle-alert', 'sm')} ${esc(t2('impCaution'))}</p>`;
    btn.textContent = t2('importCount', pick.size); btn.setAttribute('aria-disabled', pick.size ? 'false' : 'true'); d.names = resolved;
  };
  const seed = () => { pick.clear(); (IMPORT_FILES[file].items || []).forEach((it, i) => { if (!it.bad) pick.add(i); }); };
  seed(); draw();
  d.back.addEventListener('change', (ev) => {
    if (ev.target.id === 'imFile') { file = ev.target.value; seed(); const fv = $('#imFolder', d.back) && $('#imFolder', d.back).value; draw(); if (fv !== undefined && $('#imFolder', d.back)) $('#imFolder', d.back).value = fv; $('#imFile', d.back).focus(); }
    else if (ev.target.dataset && ev.target.dataset.im !== undefined) { const i = +ev.target.dataset.im; if (ev.target.checked) pick.add(i); else pick.delete(i); const keep = $('#imFolder', d.back).value; draw(); $('#imFolder', d.back).value = keep; const cb = $(`[data-im="${i}"]`, d.back); if (cb) cb.focus(); }
  });
  A.openDialog.handlers = { im: () => { if (IMPORT_FILES[file].error || !pick.size) return false; const fid = $('#imFolder', d.back).value || null; const items = (IMPORT_FILES[file].items || []).filter((it, i) => pick.has(i) && !it.bad); setTimeout(() => {
    const made = []; items.forEach((it) => { const p = blankPreset(newId(), uniq(it.name).slice(0, NAME_MAX), it.model, fid); reindex(); insertAtFolderEnd(p, fid); made.push(p.id); });
    const le = pushLU(t2('labImport', items.length), () => { removePresets(made, null); return ''; }, 'import', { ids: made });
    A.buildIndex(); psToast(t2('importDone', items.length), { kind: 'import', until: 'page', action: luAction(le) }); if (fid) COLL[fid] = false; persistColl(); updateChrome(); if (A.S.open && S2.view === 'section') A.refreshPage(); }, 0); } };
  return d;
}
/* ---- 최근 삭제 dialog (DS-024) and the bundle export dialog (DS-032) */
function openTrashDialog() {
  const d = A.openDialog({ critical: true, title: t2('trashTitle'), body: '<div id="trBody"></div>', buttons: [{ id: 'ok', label: t2('close'), primary: true }], initial: '[data-tr], [data-dlg="ok"]' });
  const draw = () => {
    $('#trBody', d.back).innerHTML = TRASH.length ? `<ul class="ps-rps tr-list" data-part="settings-restore-points" role="list">${TRASH.map((x) => `<li><div class="rp-t"><strong title="${esc(x.p.name)}">${esc(x.p.name)}</strong><span class="rp-k">${esc(t2('deletedOn', fmtT(x.at)))}</span></div><button type="button" data-part="settings-button" class="btn solid" data-tr="restore:${esc(x.p.id)}">${esc(t2('restoreBtn'))}</button><button type="button" data-part="settings-button" class="btn" data-tr="purge:${esc(x.p.id)}">${esc(t2('purgeBtn'))}</button></li>`).join('')}</ul><p class="dlg-hint">${esc(t2('trashHint'))}</p>` : `<p id="trEmpty">${esc(t2('trashEmpty'))}</p>`;
  };
  draw();
  d.back.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-tr]'); if (!b) return; const [k, id] = b.dataset.tr.split(':');
    if (k === 'restore') { restoreTrash(id); draw(); if (S2.view === 'library') renderLib(); const f = $('[data-tr]', d.back) || $('[data-dlg="ok"]', d.back); if (f) f.focus(); }
    else if (k === 'purge') { const x = TRASH.find((t) => t.p.id === id); d.close('purge'); setTimeout(() => openPurgeConfirm(x), 0); }
  });
  d.back.addEventListener('keydown', (ev) => { if ((ev.ctrlKey || ev.metaKey) && !ev.shiftKey && (ev.key === 'z' || ev.key === 'Z')) { ev.preventDefault(); undoLast(); draw(); } });   // Ctrl+Z here undoes the last library action too
  A.openDialog.handlers = {}; return d;
}
function openPurgeConfirm(x) {
  if (!x) return; A.openDialog({ critical: true, title: t2('purgeQ', x.p.name), body: `<p>${esc(t2('purgeBody'))}</p>`, buttons: [{ id: 'cancel', label: t2('cancel') }, { id: 'purge', label: t2('purgeBtn'), danger: true }], initial: '[data-dlg="cancel"]', onClose: (why) => { setTimeout(() => { if (why === 'purge') purgeTrash(x.p.id); openTrashDialog(); }, 0); } });
  A.openDialog.handlers = {};
}
function openExportDialog(ids) {
  const ps = ids.map(P).filter(Boolean); if (ps.length < 2) { exportPresets(ids); return null; }
  const d = A.openDialog({ critical: true, title: t2('exportBundle') + ' (' + ps.length + ')', body: `<label class="dlg-r"><input type="checkbox" id="exOrg"><span>${esc(t2('exportOrg'))}</span></label><p class="dlg-hint" id="exHint">${esc(t2('exportOrgHint'))}</p><p class="dlg-hint" id="exNote">${esc(t2('exportNote'))}</p>`, buttons: [{ id: 'cancel', label: t2('cancel') }, { id: 'go', label: t2('exportDo'), primary: true }], initial: '#exOrg' });
  $('#exOrg', d.back).addEventListener('change', (ev) => { $('#exNote', d.back).textContent = t2(ev.target.checked ? 'exportNoteOrg' : 'exportNote'); });
  A.openDialog.handlers = { go: () => { const org = $('#exOrg', d.back).checked; setTimeout(() => { exportPresets(ids, { org }); }, 0); } };
  return d;
}
function chainSummary() { if (!CHAIN.length) return t2('chainNone'); return CHAIN.slice(0, 2).map((id) => (P(id) || { name: '?' }).name).join(' · ') + (CHAIN.length > 2 ? ' …' : ''); }
function openChainDialog() {
  const d = A.openDialog({ title: t2('chainTitle'), body: '<div id="chBody"></div>', buttons: [{ id: 'ok', label: t2('done'), primary: true }], onClose: () => { if (A.S.open && S2.view === 'section') A.refreshPage(); }, initial: '#chSel' });
  const draw = () => {
    const rest = CHAIN.length ? `<ul class="ch-list" role="list">${CHAIN.map((id) => { const p = P(id); return `<li><span class="ch-i">${ic(p.icon, 'lg')}</span><span class="ch-n">${esc(p.name)}</span><button type="button" data-part="settings-button" class="btn" data-ch-rm="${esc(id)}" aria-label="${esc(t2('chainRemove', p.name))}" title="${esc(t2('chainRemove', p.name))}">${ic('x', 'lg')}</button></li>`; }).join('')}</ul>` : `<p class="dlg-hint">${esc(t2('chainEmpty'))}</p>`;
    $('#chBody', d.back).innerHTML = `<p class="dlg-hint">${esc(t2('chainHelp'))}</p>${rest}<label class="dlg-l" for="chSel">${esc(t2('chainAdd'))}</label><div class="ch-add"><select id="chSel" data-part="settings-field" class="inp">${presetOptions(null, CHAIN)}</select><button type="button" data-part="settings-button" class="btn solid" data-ch-add>${esc(t2('chainAddBtn'))}</button></div>`;
  };
  draw();
  d.back.addEventListener('click', (ev) => {
    const rm = ev.target.closest('[data-ch-rm]'); const ad = ev.target.closest('[data-ch-add]');
    if (rm) { const i = CHAIN.indexOf(rm.dataset.chRm); if (i >= 0) CHAIN.splice(i, 1); draw(); const f = $('#chSel', d.back); if (f) f.focus(); announce(t2('chainCount', CHAIN.length)); }
    else if (ad) { const v = $('#chSel', d.back).value; if (v && !CHAIN.includes(v)) CHAIN.push(v); draw(); $('#chSel', d.back).focus(); announce(t2('chainCount', CHAIN.length)); }
  });
  A.openDialog.handlers = {}; return d;
}
function openCompareDialog() {
  const cur = act().id; const other = (D.presets.find((p) => p.id !== cur) || {}).id || cur;
  const d = A.openDialog({ title: t2('compare'), body: `<label class="dlg-l" for="cmA">${esc(t2('compareA'))}</label><select id="cmA" data-part="settings-field" class="inp">${presetOptions(cur)}</select><label class="dlg-l" for="cmB">${esc(t2('compareB'))}</label><select id="cmB" data-part="settings-field" class="inp">${presetOptions(other)}</select><p class="dlg-hint warn" id="cmSame" role="status" hidden>${esc(t2('compareSame'))}</p>`, buttons: [{ id: 'cancel', label: t2('cancel') }, { id: 'go', label: t2('compareGo'), primary: true }], initial: '#cmA' });
  A.openDialog.handlers = { go: () => { const a = $('#cmA', d.back).value, b = $('#cmB', d.back).value; if (a === b) { $('#cmSame', d.back).hidden = false; return false; } setTimeout(() => openCompareView(a, b), 0); } };
}
function openCompareView(a, b) {
  const pa = P(a), pb = P(b); const ids = ['models.mainModel', 'models.temperature', 'models.maxResponse', 'models.topP', 'models.maxContext'];
  const rows = ids.map((id) => { const va = effVal(pa, id), vb = effVal(pb, id); const diff = !same(va, vb); const lab = id === 'models.mainModel' ? t2('compareModel') : A.L(A.ROW[id]); const f = (v) => (id === 'models.mainModel' ? modelFull(v) : fmtVal(id, v)); return `<tr${diff ? ' class="diff"' : ''}><th scope="row">${esc(lab)}</th><td>${esc(f(va))}</td><td>${esc(f(vb))}</td></tr>`; }).join('');
  A.openDialog({ title: t2('compareTitle'), body: `<table class="cmp"><thead><tr><th></th><th scope="col">${esc(pa.name)}</th><th scope="col">${esc(pb.name)}</th></tr></thead><tbody>${rows}</tbody></table><p class="dlg-hint">${esc(t2('compareNote'))}</p>`, buttons: [{ id: 'ok', label: t2('close'), primary: true }] }); A.openDialog.handlers = {};
}
function openNewFolderDialog() {
  const d = A.openDialog({ title: t2('newFolder'), body: `<label class="dlg-l" for="nfName">${esc(t2('folderName'))}</label><input id="nfName" data-part="settings-field" class="inp" type="text" autocomplete="off" spellcheck="false" maxlength="${NAME_MAX}" aria-describedby="nfHint nfDup nfCount"><p class="dlg-hint" id="nfHint">${esc(t2('folderNameNeeded'))}</p><p class="dlg-hint dlg-count" id="nfCount" hidden></p><p class="dlg-hint warn" id="nfDup" role="status" hidden>${esc(t2('folderDup'))}</p>`, buttons: [{ id: 'cancel', label: t2('cancel') }, { id: 'create', label: t2('create'), primary: true, disabled: true }], initial: '#nfName' });
  const inp = $('#nfName', d.back), btn = $('[data-dlg="create"]', d.back);
  inp.addEventListener('input', () => { const ok = !!inp.value.trim(); btn.setAttribute('aria-disabled', ok ? 'false' : 'true'); $('#nfHint', d.back).hidden = ok; $('#nfDup', d.back).hidden = !(ok && FOLD.some((x) => x.name.trim().toLowerCase() === inp.value.trim().toLowerCase())); }); enterPrimary(d.back, inp); nameCounter(inp, $('#nfCount', d.back));
  A.openDialog.handlers = { create: () => { const name = inp.value.trim(); if (!name) return false; setTimeout(() => { const id = createFolder(name); COLL[id] = false; persistColl(); psToast(t2('folderMade', name), { kind: 'folder', ms: 4000 }); announce(t2('folderMade', name)); if (S2.view === 'library') renderLib({ focusKey: 'fh:' + id }); }, 0); } };
  return d;
}
function openDeleteFolderDialog(fid) {
  const f = FOLD.find((x) => x.id === fid); const n = D.presets.filter((p) => p.folder === fid).length;
  const d = A.openDialog({ critical: true, title: t2('deleteFolder') + ': ' + cl(f.name, 30), body: `<p>${esc(t2('deleteFolderQ', f.name, n))}</p>`, buttons: [{ id: 'cancel', label: t2('cancel') }, { id: 'del', label: t2('deleteBtn'), danger: true }], initial: '[data-dlg="cancel"]' });
  A.openDialog.handlers = { del: () => { setTimeout(() => { const gone = deleteFolder(fid); psToast(t2('deletedFolder', f.name), { kind: 'folder', until: 'page', action: luAction(gone.entry) }); announce(t2('deletedFolder', f.name)); if (S2.view === 'library') renderLib({ focusKey: null }); updateChrome(true); }, 0); } };
  return d;
}
function openCardMenu(anchor, opener) {
  const p = act();
  A.showMenu([
    { icon: 'pencil', label: t2('rename'), fn: () => startRename(p.id, 'card') },
    { icon: 'copy', label: t2('duplicate'), fn: () => duplicatePreset(p.id) && A.refreshPage() },
    { icon: 'keyboard', label: t2('assignShortcut') + '…', fn: () => openSlotDialog(p.id) },
    { icon: 'folder', label: t2('moveToFolder') + '…', fn: () => openMoveDialog([p.id]) },
    { icon: 'download', label: t2('exportOne'), fn: () => exportPresets([p.id]) },
    { icon: 'wand', label: t2('openStudio'), href: A.studioHref('preset', p.id) },
    { icon: 'history', label: t2('restoreOpen'), fn: () => openRestoreDialog() },
  ], anchor, null, opener || anchor, t2('cardMenu'));
}

/* ------------------------------------------------------------------ settings sections: 프리셋 (card, library link, keep-on-switch, chain, compare) and 단축키 › 프리셋 단축키 */
const stLabel = () => (ST.state === 'saving' ? t2('saving') : ST.state === 'failed' ? t2('saveFailed') : t2('saved'));
const stIcon = () => ic(ST.state === 'saving' ? 'loader' : ST.state === 'failed' ? 'circle-alert' : 'check', 'sm');
function statusHTML(live) {
  return `<span class="ps-st"${live ? ' role="status"' : ''} data-ps-status data-st="${ST.state}"${ST.state === 'failed' ? ' hidden' : ''}><span class="st-ic">${stIcon()}</span><span class="st-t">${esc(stLabel())}</span></span>` +
    `<button type="button" class="ps-retry" data-part="settings-save-retry" data-part-critical data-ps-status data-a="retry" data-st="${ST.state}"${ST.state === 'failed' ? '' : ' hidden'}><span class="st-ic">${stIcon()}</span><span class="st-t">${esc(stLabel())}</span></button>`;
}
function undoRedoHTML() {
  const p = act();
  return `<span class="ps-ur"><button type="button" data-part="settings-button" class="btn ps-urb" data-a="undo" data-ps-undo aria-disabled="${p.undo.length ? 'false' : 'true'}" aria-label="${esc(t2('undo'))}" title="${esc(t2('undo'))} (Ctrl+Z)">${ic('undo-2', 'lg')}</button>` +
    `<button type="button" data-part="settings-button" class="btn ps-urb" data-a="redo" data-ps-redo aria-disabled="${p.redo.length ? 'false' : 'true'}" aria-label="${esc(t2('redo'))}" title="${esc(t2('redo'))} (Ctrl+Shift+Z)">${ic('redo-2', 'lg')}</button></span>`;
}
X.scopeLine = (s, def) => (A.PRESET_SECS.has(s.id) ? `<p class="sec-scope ps-scope">${ic('bookmark', 'sm')}<span class="ps-sc-t">${esc(t2('scopeSection', act().name))}</span>${statusHTML(false)}${undoRedoHTML()}</p>` : def);
function cardHTML() {
  const p = act();
  return `<div class="row ps-card" data-row="models.presetIcon" data-part="settings-preset-card" role="group" aria-label="${esc(t2('inUse'))}: ${esc(p.name)}"><button type="button" class="ps-ico" data-ctl data-a="icon" data-ic="${esc(p.icon)}" aria-label="${esc(t2('changeIcon', p.name))}" title="${esc(t2('changeIcon', p.name))}">${ic(p.icon, 'feature')}</button>` +
    `<div class="ps-ct"><span class="ps-cname">${esc(p.name)}</span><span class="ps-csub">${esc(modelFull(p.model))}</span><span class="ps-cs">${statusHTML(true)}</span></div>` +
    `<div class="ps-cact">${undoRedoHTML()}<button type="button" data-part="settings-button" class="btn ps-cmore" data-a="cardmore" aria-haspopup="menu" aria-label="${esc(t2('cardMenu'))}" title="${esc(t2('cardMenu'))}">${ic('ellipsis', 'xl')}</button></div></div>`;
}
function paintCard() {
  const c = $('.ps-card'); if (!c) return; const p = act();
  $('.ps-cname', c).textContent = p.name; $('.ps-csub', c).textContent = modelFull(p.model); c.setAttribute('aria-label', t2('inUse') + ': ' + p.name);
  const ib = $('.ps-ico', c); if (ib.dataset.ic !== p.icon) { ib.innerHTML = ic(p.icon, 'feature'); ib.dataset.ic = p.icon; } ib.setAttribute('aria-label', t2('changeIcon', p.name)); ib.title = t2('changeIcon', p.name);
  $$('.ps-sc-t').forEach((e) => { e.textContent = t2('scopeSection', p.name); });
  const al = $('[data-row="models.presetsAll"] .r-label'); if (al) al.textContent = t2('allPresets', D.presets.length);
}
function presetsBody() {
  const row = (id) => A.rowHTML(A.ROW[id]);
  const notice = S2.migrated ? `<div class="ps-notice" data-part="settings-notice" role="note">${ic('info', 'lg')}<p>${esc(t2('slotMigrated'))}</p><button type="button" data-part="settings-button" class="btn" data-a="dismiss" aria-label="${esc(t2('dismiss'))}" title="${esc(t2('dismiss'))}">${ic('x', 'lg')}</button></div>` : '';
  const chainRow = `<div data-part="settings-row" class="row row-link" data-row="models.presetChain"><button type="button" class="rl" data-ctl data-a="chain"><span class="r-text"><span data-part="settings-row-label" class="r-label">${esc(A.L(A.ROW['models.presetChain']))}</span><span data-part="settings-row-description" class="r-desc">${esc(chainSummary())}</span></span><span class="rl-end"><span class="rl-txt">${esc(CHAIN.length ? t2('chainCount', CHAIN.length) : '')}</span>${ic('chevron-right', 'lg')}</span></button></div>`;
  const cmpRow = `<div data-part="settings-row" class="row row-link" data-row="models.compare"><button type="button" class="rl" data-ctl data-a="compare"><span class="r-text"><span data-part="settings-row-label" class="r-label">${esc(A.L(A.ROW['models.compare']))}</span><span data-part="settings-row-description" class="r-desc">${esc(A.pair(A.ROW['models.compare'].desc))}</span></span><span class="rl-end">${ic('git-compare', 'lg')}${ic('chevron-right', 'lg')}</span></button></div>`;
  const folders = FOLD.length;
  return notice + cardHTML() +
    `<div data-part="settings-row" class="row row-link" data-row="models.presetsAll"><button type="button" class="rl" data-ctl data-a="library"><span class="rl-ic">${ic('library-big', 'xl')}</span><span class="r-text"><span data-part="settings-row-label" class="r-label">${esc(t2('allPresets', D.presets.length))}</span><span data-part="settings-row-description" class="r-desc">${esc(A.S.lang === 'ko' ? (folders ? `폴더 ${folders}개 · 즐겨찾기 ${D.presets.filter((p) => p.fav).length}개` : '폴더 없이 한 목록이에요') : (folders ? `${folders} folders · ${D.presets.filter((p) => p.fav).length} favourites` : 'One list, no folders'))}</span></span><span class="rl-end">${ic('chevron-right', 'lg')}</span></button></div>` +
    `<div class="ps-subh" role="presentation"><h3 class="ps-h3" id="psKeepH">${esc(t2('keepOnSwitch'))}</h3></div>` + row('models.keepAuxOnSwitch') + row('models.keepFallbackOnSwitch') + row('models.keepParamsOnSwitch') + chainRow + cmpRow;
}
const optionsAll = () => presetOptions(null);
function slotsBody() {
  const phone = A.S.lay === 'phone'; let h = '';
  for (let n = 1; n <= 9; n++) {
    const id = SLOT[n]; const p = id && P(id); const keys = SLOTKEY[n].split('+').map((k) => `<kbd>${esc(k)}</kbd>`).join('<span class="plus" aria-hidden="true">+</span>');
    if (phone) { h += `<div data-part="settings-row" class="row ps-slotrow ro" data-slotrow="${n}"><div class="r-main"><div class="r-text"><span data-part="settings-row-label" class="r-label">${esc(t2('slotRow', n))}</span></div><div data-part="settings-row-control" class="r-ctl"><span class="keys">${keys}</span><span class="ps-slotname">${esc(p ? p.name : t2('slotEmpty'))}</span></div></div></div>`; continue; }
    const opts = `<option value="">${esc(t2('slotNone'))}</option>` + presetOptions(id);
    h += `<div data-part="settings-row" class="row ps-slotrow" data-slotrow="${n}"><div class="r-main"><div class="r-text"><label data-part="settings-row-label" class="r-label" for="psSlot${n}">${esc(t2('slotRow', n))}</label></div><div data-part="settings-row-control" class="r-ctl ps-slotctl"><select id="psSlot${n}" data-part="settings-field" class="inp" data-slotsel="${n}" aria-label="${esc(t2('slotSelect', n))}">${opts}</select><span class="keys" data-slotkeys="${n}">${keys}</span><button type="button" data-part="settings-button" class="btn solid ps-recap" data-a="recap" data-slot="${n}" aria-label="${esc(t2('slotRecap') + ': ' + t2('slotRow', n))}">${ic('keyboard', 'md')}<span>${esc(t2('slotRecap'))}</span></button></div></div><p data-part="settings-row-description" class="r-desc ps-capmsg" id="psCap${n}" role="status" hidden></p></div>`;
  }
  return h;
}
X.sectionBody = (s, body) => { if (s.id === 'models.presets') return presetsBody(); if (s.id === 'keys.presets') return slotsBody(); return undefined; };
X.pageHTML = (pid) => (pid === 'models' && S2.view === 'library' ? libPageHTML() : null);

/* ---- shortcut capture (the slice 1 hotkey rows are read-only; this adds the Esc-cancels / names-the-conflict capture the spec calls the slice 1 pattern) */
const comboOf = (ev) => {
  const parts = []; if (ev.ctrlKey || ev.metaKey) parts.push('Ctrl'); if (ev.altKey) parts.push('Alt'); if (ev.shiftKey) parts.push('Shift');
  let k = ev.key; const c = ev.code || ''; let m;
  if ((m = /^Digit(\d)$/.exec(c))) k = m[1]; else if ((m = /^Key([A-Z])$/.exec(c))) k = m[1]; else if (k === ' ') k = 'Space'; else if (k.length === 1) k = k.toUpperCase();
  parts.push(k); return parts.join('+');
};
const normCombo = (s) => String(s).split('+').map((x) => x.trim().toLowerCase()).sort().join('+');
const isModKey = (k) => ['Control', 'Alt', 'Shift', 'Meta', 'AltGraph'].includes(k);
function findConflict(combo, n) {
  const nc = normCombo(combo);
  for (const r of D.rows) if (r.type === 'key' && normCombo(r.combo) === nc) return A.L(r);
  for (let k = 1; k <= 9; k++) if (k !== n && normCombo(SLOTKEY[k]) === nc) return t2('slotRow', k) + (SLOT[k] && P(SLOT[k]) ? ' · ' + P(SLOT[k]).name : '');
  return null;
}
function startCapture(n, btn) {
  stopCapture(); S2.capturing = { n, btn }; btn.classList.add('capturing'); btn.querySelector('span').textContent = t2('slotCapture'); btn.setAttribute('aria-pressed', 'true');
  const msg = $('#psCap' + n); msg.hidden = false; msg.textContent = t2('slotCapture'); announce(t2('slotCapture'));
  document.addEventListener('keydown', onCapture, true);
}
function stopCapture() {
  const c = S2.capturing; document.removeEventListener('keydown', onCapture, true); if (!c) return; S2.capturing = null;
  const b = c.btn; if (b && b.isConnected) { b.classList.remove('capturing'); b.removeAttribute('aria-pressed'); b.querySelector('span').textContent = t2('slotRecap'); }
  const m = $('#psCap' + c.n); if (m) { m.hidden = true; m.textContent = ''; }
}
function slotClash(combo, n) { const nc = normCombo(combo); for (let k = 1; k <= 9; k++) if (k !== n && normCombo(SLOTKEY[k]) === nc) return k; return 0; }
function openKeySwap(n, m, combo) {      // DS-039: a key that another preset holds is swapped, after asking
  stopCapture(); const nameOf = (k) => (SLOT[k] && P(SLOT[k]) ? P(SLOT[k]).name : t2('slotEmpty')); const btn = $(`[data-a="recap"][data-slot="${n}"]`); const mine = SLOTKEY[n];
  const d = A.openDialog({ critical: true, title: t2('keySwapQ', combo, nameOf(n), nameOf(m)), body: `<p>${esc(t2('keySwapBody', mine, combo))}</p>`, buttons: [{ id: 'cancel', label: t2('cancel') }, { id: 'swap', label: t2('swap'), primary: true }], initial: '[data-dlg="cancel"]', onClose: (why) => { if (why !== 'swap' && btn && btn.isConnected) btn.focus({ preventScroll: true }); } });
  A.openDialog.handlers = { swap: () => { setTimeout(() => {
    const kn = SLOTKEY[n], km = SLOTKEY[m]; SLOTKEY[n] = km; SLOTKEY[m] = kn; const a = nameOf(n), b2 = nameOf(m);
    const e = pushLU(t2('labKeySwap', km), () => { if (SLOTKEY[n] === km && SLOTKEY[m] === kn) { SLOTKEY[n] = kn; SLOTKEY[m] = km; return ''; } return t2('keySwapSkip'); }, 'keyswap');
    psToast(t2('keySwapped', km, a, b2), { kind: 'slot', until: 'page', action: luAction(e) }); announce(t2('keySwapped', km, a, b2));
    if (A.S.open && S2.view === 'section') { A.refreshPage(); const nb = $(`[data-a="recap"][data-slot="${n}"]`); if (nb) nb.focus({ preventScroll: true }); }
  }, 0); } };
  return d;
}
function onCapture(ev) {
  const c = S2.capturing; if (!c) return;
  if (ev.key === 'Escape') { ev.preventDefault(); ev.stopImmediatePropagation(); const b = c.btn; stopCapture(); if (b && b.isConnected) b.focus(); return; }
  if (isModKey(ev.key)) return; ev.preventDefault(); ev.stopImmediatePropagation();
  const combo = comboOf(ev); const msg = $('#psCap' + c.n);
  if (!(ev.ctrlKey || ev.metaKey || ev.altKey)) { msg.textContent = t2('slotNeedMod'); announce(t2('slotNeedMod')); return; }
  { const m = slotClash(combo, c.n); if (m) { openKeySwap(c.n, m, combo); return; } }
  const w = findConflict(combo, c.n); if (w) { msg.textContent = t2('slotConflict', combo, w); announce(msg.textContent); return; }
  const kk = combo.split('+').pop(); const only = (ev.ctrlKey || ev.metaKey) && !ev.altKey && !ev.shiftKey && /^[1-9]$/.test(kk);      // R-11 / DS-033: nothing but Ctrl+1-9, no other modifier
  if (!only) { const plain = (ev.ctrlKey || ev.metaKey) && !ev.altKey && !ev.shiftKey; msg.textContent = plain && kk === '0' ? t2('slotZero') : plain && (/^(C|V|X|A|Z|Y|P|F|R|W|T|N|L)$/.test(kk) || kk === 'Tab') ? t2('slotReserved', combo) : t2('slotOnly'); announce(msg.textContent); return; }
  SLOTKEY[c.n] = combo; const b = c.btn, n = c.n; stopCapture(); if (A.S.open && S2.view === 'section') { A.refreshPage(); const nb = $(`[data-a="recap"][data-slot="${n}"]`); if (nb) nb.focus({ preventScroll: true }); } announce(t2('slotKeySet', n, combo)); void b;
}

/* ---- the chat-header chip (SPEC 6 + width rule) */
let chipFitQueued = false;
const chipText = () => { const p = act(); return { name: p.name, model: mshort(p.model), label: t2('chipLabel', p.name, mshort(p.model)) }; };
function chipHTML() {
  const c = chipText();
  return `<button type="button" class="o2-chip" id="psChip" data-part="settings-preset-chip" data-mode="full" aria-haspopup="dialog" aria-label="${esc(c.label)}" title="${esc(c.label)}">${ic('bookmark', 'md')}<span class="c-name">${esc(c.name)}</span><span class="c-model">${esc(c.model)}</span><span class="c-warn" hidden>${ic('triangle-alert', 'sm')}</span></button>`;
}
function paintChip() {
  const ch = $('#psChip'); if (!ch) return; const c = chipText(); const p = act();
  $('.c-name', ch).textContent = c.name; $('.c-model', ch).textContent = c.model;
  const fl = p.failed ? ' · ' + t2('chipFailed') : '';   // DS-026: an unsaved change stays visible on the chip
  const lab = (S2.toast && S2.toast.kind === 'switch' ? t2('chipChanged', p.name, mshort(p.model)) : c.label) + fl; ch.setAttribute('aria-label', lab); ch.title = c.label + fl;
  const w = $('.c-warn', ch); if (w) w.hidden = !p.failed; ch.classList.toggle('is-failed', !!p.failed); ch.toggleAttribute('data-part-critical', !!p.failed);
  fitChip();
}
function fitChip() {
  const ch = $('#psChip'), hdr = $('#o2Hdr'); if (!ch || !hdr || hdr.offsetWidth === 0) return; const W = hdr.clientWidth;
  const nm = $('.o-name', hdr), cm = $('.c-model', ch);
  const N = window.settingsTheme.num; let mode = W >= N('--breakpoint-chip-full') ? 'full' : W >= N('--breakpoint-chip-name') ? 'name' : 'icon'; ch.dataset.mode = mode; ch.style.maxWidth = ''; cm.hidden = false; ch.classList.remove('no-model');
  if (mode === 'full') {   // at most 40 % of the header; the model drops first, then the name truncates
    ch.style.maxWidth = 'none'; const nat = ch.offsetWidth; const cap = Math.floor(W * N('--chip-cap-ratio'));
    if (nat > cap) { ch.classList.add('no-model'); ch.style.maxWidth = cap + 'px'; }
  } else if (mode === 'name') { ch.style.maxWidth = Math.floor(W * N('--chip-name-ratio')) + 'px'; }
  if (mode !== 'icon' && nm) {   // the character name always wins: when it would show fewer than 8 characters, the chip becomes icon-only
    const full = nm.scrollWidth, shown = nm.clientWidth; const chars = Math.max(1, [...nm.textContent].length);
    if (full > shown + 1 && (shown / (full / chars)) < Math.min(8, chars)) { mode = 'icon'; ch.dataset.mode = 'icon'; ch.style.maxWidth = ''; }
  }
  if (mode === 'name') {   // R-10: below 6 visible characters of the preset name the chip carries no information, so it goes icon-only (the name stays in the accessible name and tooltip)
    const cn = $('.c-name', ch), cf = cn.scrollWidth, cs = cn.clientWidth, cc = Math.max(1, [...cn.textContent].length);
    if (cf > cs + 1 && (cs / (cf / cc)) < Math.min(6, cc)) { mode = 'icon'; ch.dataset.mode = 'icon'; ch.style.maxWidth = ''; }
  }
  ch.dataset.shown = mode === 'icon' ? 'icon' : (ch.classList.contains('no-model') || mode === 'name' ? 'name' : 'full');
}
function chipMenu(chip, point) {
  A.showMenu([
    { icon: 'library-big', label: t2('managePresets'), fn: () => openLibraryFrom(chip) },
    { icon: 'settings', label: t2('openModelSettings'), fn: () => { S2.view = 'section'; if (A.S.open) A.showPage('models', { section: 'models.presets', noAnim: true }); else A.openSettings(chip, { page: 'models', section: 'models.presets', noFocus: true }); } },
  ], point ? null : chip, point || null, chip, t2('chipMenu'));
}
const msgPresetId = (k) => (k >= 8 ? 'p2' : 'p1');                // DS-029: each stub reply remembers the preset it was generated with; regenerate, continue and swipe use that one
function regenPresetFor(k) { const id = msgPresetId(k); return P(id) ? id : act().id; }
function tagMessages(o) { $$('.o-scroll .o-msg:not(.u)', o).forEach((m, k) => { const id = regenPresetFor(k); m.dataset.preset = id; m.title = t2('msgPreset', P(id).name); }); }
X.origin = (o) => {
  if (A.S.from !== 'chat') return;
  const hdr = $('.o-hdr', o); if (!hdr) return; const name = A.t('chatName');
  hdr.className = 'o-hdr o2-hdr'; hdr.id = 'o2Hdr';
  hdr.innerHTML = `<span class="o-av" aria-hidden="true">${esc(name[0])}</span><div class="o2-nm"><strong class="o-name">${esc(name)}</strong><span class="o2-sub">${esc(t2('chatSub'))}</span></div>${chipHTML()}` +
    `<button type="button" data-part="settings-button" class="btn" id="oSettings" aria-label="${esc(A.t('settings'))}" title="${esc(A.t('settings'))}">${ic('settings', 'xl')}</button>` +
    `<button type="button" data-part="settings-button" class="btn" id="oMore" aria-haspopup="menu" aria-label="${esc(t2('chatMore'))}" title="${esc(t2('chatMore'))}">${ic('ellipsis-vertical', 'xl')}</button>`;
  const gen = document.createElement('div'); gen.className = 'o2-gen'; gen.id = 'o2Gen'; gen.hidden = !S2.gen;
  gen.innerHTML = `<span id="oGen">${esc(A.t('genStatus', A.S.gen.chars))}</span><span id="psGenPreset">${esc(S2.reqPreset && P(S2.reqPreset) ? t2('genNote', P(S2.reqPreset).name) : '')}</span>`;
  hdr.after(gen); paintChip(); fitChipSoon(); tagMessages(o);
};
function fitChipSoon() { if (chipFitQueued) return; chipFitQueued = true; requestAnimationFrame(() => { chipFitQueued = false; fitChip(); }); }
function setGenerating(v) { S2.gen = !!v; S2.reqPreset = v ? (S2.reqPreset || A.S.presetActive) : null; if (!v) S2.reqPreset = null; const g = $('#o2Gen'); if (g) { g.hidden = !S2.gen; const s = $('#psGenPreset'); if (s) s.textContent = S2.gen && P(S2.reqPreset) ? t2('genNote', P(S2.reqPreset).name) : ''; } }

/* ------------------------------------------------------------------ page events (delegated on #pageScroll, which lives for the whole session) */
function clearLibSearch() { LIB.q = ''; LIB.searchOpen = false; const i = $('#psLibQ'); if (i) i.value = ''; renderLib(); paintTools(); }
function paintTools() { const t = $('#psTools'); if (!t) return; t.classList.toggle('s-open', A.S.lay !== 'phone' || LIB.searchOpen || !!LIB.q); }
function bulkIds() { return LIB.sel ? [...LIB.sel] : []; }
function pressSlot(n) {
  const id = SLOT[n]; const key = slotLabel(n);
  if (!id || !P(id)) { psToast(t2('slotUnassigned', key), { action: { label: t2('assign'), fn: () => openSlotPick(n) }, kind: 'slot-empty' }); announce(t2('slotUnassigned', key)); return false; }
  if (id === A.S.presetActive) { announce(t2('inUse') + ': ' + P(id).name); return false; }
  return switchTo(id);
}
function bindPage() {
  const sc = $('#pageScroll');
  sc.addEventListener('click', (ev) => {
    const tg = ev.target; if (!(tg instanceof Element)) return;
    const ab = tg.closest('[data-a]');
    if (ab) {
      const a = ab.dataset.a;
      switch (a) {
        case 'library': openLibrary({ noAnim: true }); return;
        case 'icon': openIconDialog(); return;
        case 'undo': if (ab.getAttribute('aria-disabled') === 'true') announce(t2('nothingUndo')); else doUndo(); return;
        case 'redo': if (ab.getAttribute('aria-disabled') === 'true') announce(t2('nothingRedo')); else doRedo(); return;
        case 'retry': retrySave(); return;
        case 'dismiss': S2.migrated = false; A.refreshPage(); return;
        case 'cardmore': openCardMenu(ab); return;
        case 'chain': openChainDialog(); return;
        case 'compare': openCompareDialog(); return;
        case 'recap': startCapture(+ab.dataset.slot, ab); return;
        case 'crumb': closeLibrary(); return;
        case 'sort': LIB.sort = ab.dataset.sort; renderLib(); announce(t2('sort' + LIB.sort[0].toUpperCase() + LIB.sort.slice(1))); return;
        case 'sopen': LIB.searchOpen = true; paintTools(); { const i = $('#psLibQ'); if (i) i.focus(); } return;
        case 'libmore': LIB.limit += 20; renderLib({ focusKey: null }); return;
        case 'clearq': LIB.q = ''; LIB.limit = 20; { const i = $('#psLibQ'); if (i) { i.value = ''; } } renderLib(); paintTools(); { const i = $('#psLibQ'); if (i) i.focus(); } return;
        case 'newfolder': openNewFolderDialog(); return;
        case 'newpreset': openNewDialog(); return;
        case 'import': openImportDialog(); return;
        case 'select': if (LIB.sel) exitSelect(); else { enterSelect(); } return;
        case 'done': exitSelect(); return;
        case 'bulk-move': if (ab.getAttribute('aria-disabled') !== 'true') openMoveDialog(bulkIds()); return;
        case 'bulk-fav': if (ab.getAttribute('aria-disabled') !== 'true') { const ids = bulkIds(); const all = ids.every((id) => P(id).fav); ids.forEach((id) => { P(id).fav = !all; }); renderLib(); updateChrome(true); } return;
        case 'bulk-export': if (ab.getAttribute('aria-disabled') !== 'true') openExportDialog(bulkIds()); return;
        case 'trash': openTrashDialog(); return;
        case 'libmore2': A.showMenu([{ icon: 'trash-2', label: t2('trashOpen', TRASH.length), fn: openTrashDialog }, { icon: 'undo-2', label: LU.length ? t2('undo') + ': ' + LU[LU.length - 1].label + hint(' ' + t2('luKeys')) : t2('nothingLib'), disabled: !LU.length, fn: undoLast }], ab, null, ab, t2('moreMenu')); return;
        case 'bulk-del': if (ab.getAttribute('aria-disabled') !== 'true') openDeleteDialog(bulkIds()); return;
        case 'star': { const li = ab.closest('li'); const gid = li ? li.dataset.gid : null; toggleFav(ab.dataset.pid); renderLib(); const nb = $(`#psLibList li[data-gid="${CSS.escape(gid || '')}"][data-pid="${CSS.escape(ab.dataset.pid)}"] .ps-star`); if (nb) nb.focus({ preventScroll: true }); return; }
        case 'more': { const m = $('.ps-main', ab.closest('.ps-row')); openRowMenu(ab.dataset.pid, ab, null, m); return; }
        case 'fmore': folderMenu(ab.dataset.fid, ab, null, ab); return;
        default: break;
      }
    }
    const pm = tg.closest('.ps-main');
    if (pm) { if (LIB.noClick) { LIB.noClick = false; return; } if (LIB.sel) { toggleSel(pm.dataset.pid, ev.shiftKey); return; } const mb = $('.ps-more', pm.closest('.ps-row')); LIB.rv = pm.dataset.key; applyRoving(pm.dataset.key); openRowMenu(pm.dataset.pid, mb, null, pm); return; }
    const fm = tg.closest('.ps-fmain'); if (fm) { if (LIB.noClick) { LIB.noClick = false; return; } toggleFolder(fm.dataset.fid); }
  });
  sc.addEventListener('keydown', (ev) => {
    const t = ev.target; if (!(t instanceof Element)) return;
    if (t.id === 'psLibQ') {
      if (ev.isComposing || ev.keyCode === 229) return;
      if (ev.key === 'Escape') { if (LIB.q) { ev.preventDefault(); ev.stopPropagation(); clearLibSearch(); } else if (LIB.searchOpen && A.S.lay === 'phone') { ev.preventDefault(); ev.stopPropagation(); LIB.searchOpen = false; paintTools(); const b = $('.ps-sopen'); if (b) b.focus(); } }
      else if (ev.key === 'ArrowDown') { const f = applyRoving(); if (f) { ev.preventDefault(); f.focus(); } }
      return;
    }
    if (t.classList.contains('ps-rename')) return;
    const rv = t.closest('[data-rv]'); if (!rv || !rv.closest('#psLibList')) return;
    const folder = rv.classList.contains('ps-fmain'); const all = $$('#psLibList [data-rv]'); const i = all.indexOf(rv); const k = ev.key; let go = null;
    if (ev.altKey && (k === 'ArrowUp' || k === 'ArrowDown') && !ev.ctrlKey && !ev.shiftKey) {
      ev.preventDefault(); const dir = k === 'ArrowUp' ? -1 : 1;
      if (folder) { if (canMoveNow()) { if (moveFolder(rv.dataset.fid, dir)) renderLib({ focusKey: rv.dataset.key }); } else announce(t2('sortHint')); }
      else if (rv.dataset.gid === 'fav') announce(t2('favMoveNo')); else moveRow(rv.dataset.pid, dir);
      return;
    }
    if (k === 'ArrowDown') go = all[Math.min(all.length - 1, i + 1)]; else if (k === 'ArrowUp') go = all[Math.max(0, i - 1)]; else if (k === 'Home') go = all[0]; else if (k === 'End') go = all[all.length - 1];
    if (go) { ev.preventDefault(); all.forEach((e) => { e.tabIndex = -1; }); go.tabIndex = 0; LIB.rv = go.dataset.key; go.focus(); return; }
    if (folder && (k === 'ArrowLeft' || k === 'ArrowRight')) { ev.preventDefault(); const open = rv.getAttribute('aria-expanded') === 'true'; if ((k === 'ArrowLeft' && open) || (k === 'ArrowRight' && !open)) toggleFolder(rv.dataset.fid); return; }
    if ((k === 'F10' && ev.shiftKey) || k === 'ContextMenu') { ev.preventDefault(); ev.stopPropagation(); if (folder) folderMenu(rv.dataset.fid, $('.ps-fmore', rv.closest('.ps-fh')), null, rv); else openRowMenu(rv.dataset.pid, $('.ps-more', rv.closest('.ps-row')), null, rv); return; }
    if (!folder && k === 'F2') { ev.preventDefault(); startRename(rv.dataset.pid, 'library'); return; }
    if (!folder && (k === 'Delete')) { ev.preventDefault(); if (LIB.sel && LIB.sel.size) openDeleteDialog(bulkIds()); else openDeleteDialog([rv.dataset.pid]); return; }
    if (!folder && LIB.sel && k === ' ' && false) toggleSel(rv.dataset.pid, ev.shiftKey);
  });
  sc.addEventListener('contextmenu', (ev) => {
    const t = ev.target; if (!(t instanceof Element) || t.closest('input,textarea,select')) return; const row = t.closest('.ps-row'), fh = t.closest('.ps-fh');
    if (row && row.closest('#psLibList')) { ev.preventDefault(); const m = $('.ps-main', row); openRowMenu(m.dataset.pid, null, { x: ev.clientX, y: ev.clientY }, m); }
    else if (fh) { ev.preventDefault(); folderMenu(fh.dataset.fid, null, { x: ev.clientX, y: ev.clientY }, $('.ps-fmain', fh)); }
  });
  sc.addEventListener('input', (ev) => {
    const t = ev.target; if (t.id === 'psLibQ') { const t0 = now(); LIB.q = t.value; LIB.limit = 20; renderLib(); paintTools(); perf.libKey = (perf.libKey || []); perf.libKey.push(+(now() - t0).toFixed(2)); announce(LIB.q.trim() ? t2('searchResult', LIB.q.trim(), LIB.count || 0) : ''); }
  });
  sc.addEventListener('change', (ev) => {
    const t = ev.target; if (!(t instanceof Element)) return;
    const re = t.closest('[data-row]'); if (re && pend[re.dataset.row]) { const id = re.dataset.row; delete pend[id]; commitStep(id, A.ROW[id].v); return; }
    if (t.dataset && t.dataset.slotsel) {
      const n = +t.dataset.slotsel; const id = t.value; const cur = SLOT[n]; const done = () => { updateChrome(true); A.refreshPage(); const nf = $('#psSlot' + n); if (nf) nf.focus({ preventScroll: true }); };
      if (!id) { const was = cur && P(cur) ? P(cur).name : ''; const e = slotOp(t2('labSlot', slotLabel(n)), () => { SLOT[n] = null; }); psToast(t2('slotCleared', was), { kind: 'slot', until: 'page', action: e ? luAction(e) : null }); done(); return; }
      const own = slotOf(id); const ownOther = own && own !== n ? own : 0; const takenBy = cur && cur !== id && P(cur) ? P(cur) : null;
      if (takenBy || ownOther) {      // R-12 / N-01: a taken slot, or a preset that already owns another slot, asks first
        const swap = !!(takenBy && ownOther); const d = A.openDialog({ critical: true, title: takenBy ? t2('keySwapQ', slotLabel(n), P(id).name, takenBy.name) : t2('slotTakeQ', slotLabel(n)), body: `<p>${esc(swap ? t2('keySwapBody', slotLabel(ownOther), slotLabel(n)) : t2('slotTakeBody', takenBy ? takenBy.name : '', ownOther ? slotLabel(ownOther) : ''))}</p>`, buttons: [{ id: 'cancel', label: t2('cancel') }, { id: 'move', label: swap ? t2('swap') : t2('move'), primary: true }], initial: '[data-dlg="cancel"]', onClose: (why) => { if (why !== 'move') done(); } });
        A.openDialog.handlers = { move: () => { setTimeout(() => { const e = swap ? swapSlotU(n, id) : assignSlotU(n, id); psToast(swap ? t2('keySwapped', slotLabel(n), P(id).name, takenBy.name) : takenBy ? t2('slotMovedMsg', slotLabel(n), takenBy.name) : t2('slotAssigned', slotLabel(n), P(id).name), { kind: 'slot', until: 'page', sub: ownOther ? t2('slotVacated', slotLabel(ownOther)) : '', action: e ? luAction(e) : null }); done(); }, 0); } }; void d; return;
      }
      const e = assignSlotU(n, id); psToast(t2('slotAssigned', slotLabel(n), P(id).name), { kind: 'slot', until: 'page', action: e ? luAction(e) : null }); done();
    }
  });
  sc.addEventListener('focusin', (ev) => { const m = ev.target.closest && ev.target.closest('#psLibList [data-rv]'); if (m) { $$('#psLibList [data-rv]').forEach((e) => { e.tabIndex = e === m ? 0 : -1; }); LIB.rv = m.dataset.key; } });
  // pointer: drag by the handle (mouse / pen), touch long-press then drag
  sc.addEventListener('pointerdown', (ev) => {
    const tg = ev.target; if (!(tg instanceof Element)) return;
    const grip = tg.closest('[data-grip]');
    if (grip && ev.pointerType !== 'touch' && ev.button === 0) {
      const folder = grip.dataset.kind === 'folder'; const el = folder ? grip.closest('.ps-fh') : grip.closest('li'); ev.preventDefault();
      beginDrag(el, folder ? 'folder' : 'row', folder ? el.dataset.fid : el.dataset.pid, ev); return;
    }
    if (ev.pointerType === 'touch' && !LIB.sel) {
      const m = tg.closest('.ps-main, .ps-fmain'); if (!m || !m.closest('#psLibList')) return; lpClear();
      const folder = m.classList.contains('ps-fmain'); const unit = folder ? m.closest('.ps-fh') : m.closest('li');
      lp = { x: ev.clientX, y: ev.clientY, pid: ev.pointerId, m, folder, unit, armed: false, dragging: false };
      lp.t1 = setTimeout(() => {
        if (!lp) return; lp.armed = true; unit.classList.add('lifted');
        if (!(canMoveNow() && (folder || m.dataset.gid !== 'fav'))) lpMenu(); else lp.t2 = setTimeout(lpMenu, 300);
      }, 300);
    }
  });
  document.addEventListener('pointermove', (ev) => {
    if (!lp || ev.pointerId !== lp.pid) return; const d = Math.hypot(ev.clientX - lp.x, ev.clientY - lp.y);
    if (!lp.armed) { if (d > 10) { lpClear(); } return; }
    if (!lp.dragging && d > 8 && canMoveNow() && (lp.folder || lp.m.dataset.gid !== 'fav')) {
      clearTimeout(lp.t2); lp.dragging = true; const l = lp; LIB.noClick = true; lp = null; clearTimeout(l.t1);
      beginDrag(l.unit, l.folder ? 'folder' : 'row', l.folder ? l.unit.dataset.fid : l.unit.dataset.pid, Object.assign({ clientX: l.x, clientY: l.y, pointerId: l.pid }, { clientX: l.x, clientY: l.y }));
      const dd = LIB.drag; if (dd) { dd.lastY = ev.clientY; updateDrag(); }
    }
  }, true);
  const lpEnd = (ev) => { if (!lp || ev.pointerId !== lp.pid) return; if (lp.armed && !lp.dragging) lpMenu(); else lpClear(); };
  document.addEventListener('pointerup', lpEnd, true); document.addEventListener('pointercancel', () => { lpClear(); }, true);
  sc.addEventListener('touchmove', (ev) => { if ((lp && lp.armed) || LIB.drag) { if (ev.cancelable) ev.preventDefault(); } }, { passive: false });
  sc.addEventListener('dragstart', (ev) => { if (ev.target.closest && ev.target.closest('#psLib')) ev.preventDefault(); });
}
function lpMenu() {
  const l = lp; if (!l) return; lpClear(); l.unit.classList.remove('lifted'); LIB.noClick = true; setTimeout(() => { LIB.noClick = false; }, 400);
  if (l.folder) folderMenu(l.unit.dataset.fid, $('.ps-fmore', l.unit), null, l.m); else openRowMenu(l.m.dataset.pid, $('.ps-more', l.m.closest('.ps-row')), null, l.m);
}
function bindOrigin() {
  const o = $('#origin');
  o.addEventListener('click', (ev) => {
    const chip = ev.target.closest('#psChip'); if (chip) { if (S2.chipLp) { S2.chipLp = false; return; } if (SW.open) closeSwitcher(); else openSwitcher({ opener: chip }); return; }
    if (ev.target.closest('#oMore')) A.toast(A.t('simulated', t2('chatMore')));
  });
  o.addEventListener('contextmenu', (ev) => { const chip = ev.target.closest('#psChip'); if (chip) { ev.preventDefault(); chipMenu(chip, { x: ev.clientX, y: ev.clientY }); } });
  o.addEventListener('keydown', (ev) => { const chip = ev.target.closest && ev.target.closest('#psChip'); if (chip && ((ev.key === 'F10' && ev.shiftKey) || ev.key === 'ContextMenu')) { ev.preventDefault(); chipMenu(chip); } });
  let t = null; o.addEventListener('pointerdown', (ev) => { const chip = ev.target.closest('#psChip'); if (chip && ev.pointerType === 'touch') { clearTimeout(t); t = setTimeout(() => { S2.chipLp = true; chipMenu(chip); }, 500); } });
  const stop = () => clearTimeout(t); o.addEventListener('pointerup', stop); o.addEventListener('pointercancel', stop); o.addEventListener('pointermove', (ev) => { if (ev.pointerType === 'touch' && Math.hypot(ev.movementX || 0, ev.movementY || 0) > 6) stop(); });
}

/* ------------------------------------------------------------------ keyboard: Ctrl+P and slot keys work everywhere (DS-023: also in text fields; not during IME composition or in inline rename inputs); Ctrl+Z outside text fields; Alt+Z undoes the last library action from anywhere in Settings */
function undoSwitch() {
  const sw = S2.swUndo; S2.swUndo = null; if (!sw || !P(sw.from)) { announce(t2('nothingLib')); return false; }
  hideToast(); const ok = switchTo(sw.from, { quiet: true }); if (ok) announce(t2('switchedPreset', P(sw.from).name)); return ok;
}
function altUndo() {      // Alt+Z: the newest thing you did, a library action or a preset switch (N-10)
  const sw = S2.swUndo; if (sw && sw.seq === (S2.luSeq || 0) && A.S.presetActive === sw.to && P(sw.from)) return undoSwitch();
  return undoLast();
}
function slotFromEvent(ev) { const c = normCombo(comboOf(ev)); for (let n = 1; n <= 9; n++) if (normCombo(SLOTKEY[n]) === c) return n; return 0; }
function onKey(ev) {
  if (S2.capturing) return;
  if (document.body.classList.contains('dlg-open')) return;
  if (ev.isComposing || ev.keyCode === 229) return;
  const a = document.activeElement; const k = ev.key; const ctrl = ev.ctrlKey || ev.metaKey; const inRename = !!(a && a.classList && a.classList.contains('ps-rename'));
  if (ctrl && !ev.altKey && !ev.shiftKey && (k === 'p' || k === 'P')) {
    if (SW.open) { ev.preventDefault(); ev.stopImmediatePropagation(); closeSwitcher(); return; }
    if (inRename || A.menuOpen()) return;
    ev.preventDefault(); ev.stopImmediatePropagation(); openSwitcher({ opener: a && a !== document.body ? a : null, via: 'key' }); return;
  }
  if (SW.open) return;
  const isZ = ev.code ? ev.code === 'KeyZ' : (k === 'z' || k === 'Z');       // N-09: matched by code, so Option+Z on a Mac (key "Ω") and Hangul mode still work
  if (ev.altKey && !ctrl && !ev.shiftKey && isZ) { if (!A.S.open) return; ev.preventDefault(); ev.stopImmediatePropagation(); altUndo(); return; }
  if (ctrl && !ev.altKey && isZ) {
    if (A.inTextField(a) || !A.S.open) return; ev.preventDefault(); ev.stopImmediatePropagation();
    if (S2.view === 'library') { if (!ev.shiftKey) undoLast(); return; }       // R-06: in the library Ctrl+Z means the last library action, never a hidden parameter edit
    if (ev.shiftKey) doRedo(); else doUndo(); return;
  }
  if (inRename) return;
  const n = slotFromEvent(ev); if (n) { ev.preventDefault(); ev.stopImmediatePropagation(); pressSlot(n); }
}

/* ------------------------------------------------------------------ hooks called by slice1.js */
X.rowChanged = (r) => {
  if (loading) return;
  if (LOCKS[r.id]) { lockChange(r); return; }
  if (!isPR(r)) return;
  if (['text', 'secret', 'textarea', 'number'].includes(r.type)) { if (!(r.id in pend)) pend[r.id] = { from: SHADOW[r.id] }; return; }
  commitStep(r.id, r.v, { coalesce: r.type === 'slider' });
};
X.rendered = () => { if (S2.view === 'library') applyRoving(); paintSave(); };
X.nav = (pid, o) => { if (S2.view === 'library' && !o.lib) { S2.view = 'section'; endDrag(true); LIB.sel = null; } };
X.closing = () => {
  commitPending(); if (ST.state === 'saving') { (ST.wait = ST.wait || []).push(() => A.closeSettings()); return false; }
  if (guardFailed(() => { A.closeSettings(); })) return false;     // DS-026: ask before leaving with an unsaved change
  closeSwitcher({ noFocus: true }); endDrag(true); LIB.sel = null; LIB.q = ''; S2.view = 'section'; return true;
};
X.back = () => {
  if (SW.open) { closeSwitcher(); return true; }
  if (S2.view === 'library') {
    if (LIB.sel) { exitSelect(); return true; }
    if (LIB.q || LIB.searchOpen) { clearLibSearch(); return true; }
    if (!A.S.resume) { closeLibrary(); return true; }
  }
  return false;
};
X.headerTitle = () => (A.S.open && S2.view === 'library' ? t2('allPresets', D.presets.length) : null);
X.backLabel = () => (A.S.open && S2.view === 'library' ? { label: t2('backToPresets'), vis: t2('backToPresetsShort') } : null);
X.openPreset = (id) => { openLibrary({ focus: id, fromSearch: true, noAnim: true }); };
X.action = (id, opener) => { if (id === 'action:switch') openSwitcher({ opener: opener && opener.isConnected ? opener : null }); else if (id === 'action:library') openLibrary({ noAnim: true, fromSearch: false }); };
X.indexExtra = (mk, IDX) => {
  IDX.push(mk('action', 'action:switch', 'bookmark', KO.switchAction, EN.switchAction, '프리셋 전환 프리셋 변경 프리셋 선택 switcher change preset switch preset ctrl p', 'action:switch', '', '', '', '', '', '', {}));
  IDX.push(mk('action', 'action:library', 'library-big', KO.libAction, EN.libAction, '프리셋 목록 프리셋 관리 폴더 즐겨찾기 library manage presets folders favourites', 'action:library', '', '', '', '', '', '', {}));
};
X.lang = () => { paintChip(); if (SW.open) renderSw(); const t = $('#psToast'); if (t && S2.toast) hideToast(); };
X.title = (l) => L2[l].title;
X.demoPanel = (p) => {
  const h = document.createElement('div'); h.className = 'ps-demo';
  h.innerHTML = `<h3 class="d-h">${esc(t2('demoPs'))}</h3><label class="d-row"><span>${esc(t2('demoSet'))}</span><select id="dSet">${[['demo', 'setDemo'], ['stress', 'setStress'], ['one', 'setOne'], ['fresh', 'setFresh']].map(([v, k]) => `<option value="${v}"${DD.SET === v ? ' selected' : ''}>${esc(t2(k))}</option>`).join('')}</select></label>` +
    `<label class="d-row"><span>${esc(t2('demoGen'))}</span><span class="sw"><input type="checkbox" role="switch" id="dGen"${S2.gen ? ' checked' : ''}><span class="sw-ui" aria-hidden="true"></span></span></label>` +
    `<label class="d-row"><span>${esc(t2('demoFail'))}</span><span class="sw"><input type="checkbox" role="switch" id="dFail"${CFG.failNext > 0 ? ' checked' : ''}><span class="sw-ui" aria-hidden="true"></span></span></label>` +
    `<label class="d-row"><span>${esc(t2('demoState'))}</span><select id="dPsState">${PS_STATES.map((s) => `<option>${s}</option>`).join('')}</select></label><div class="d-btns"><button type="button" data-part="settings-button" class="btn solid" id="dPsGo"><span>${esc(t2('demoGo'))}</span></button></div>`;
  p.appendChild(h);
  $('#dSet', h).onchange = (e) => { const u = new URL(location.href); u.searchParams.set('set', e.target.value); location.href = u.toString(); };
  $('#dGen', h).onchange = (e) => setGenerating(e.target.checked);
  $('#dFail', h).onchange = (e) => { CFG.failNext = e.target.checked ? 1 : 0; };
  $('#dPsGo', h).onclick = () => { window.__ss1.applyState($('#dPsState', h).value); };
};

/* ------------------------------------------------------------------ states (SPEC 11.3) */
const PS_STATES = ['ps-switcher-chip', 'ps-switcher-palette', 'ps-switcher-phone', 'ps-switcher-search', 'ps-switcher-chosung', 'ps-switched-toast', 'ps-library', 'ps-library-sorted-name', 'ps-library-search', 'ps-library-select', 'ps-row-menu', 'ps-rename', 'ps-reorder-kb', 'ps-folder-new', 'ps-folder-delete', 'ps-new', 'ps-delete-active', 'ps-delete-undo', 'ps-delete-last', 'ps-import-preview', 'ps-slot-assign', 'ps-slot-move', 'ps-slot-empty-key', 'ps-hotkeys-slots', 'ps-migrated', 'ps-live-saved', 'ps-save-failed', 'ps-undo', 'ps-restore-points', 'ps-chip-narrow', 'ps-chip-menu', 'ps-stress-library', 'ps-one'];
const needSet = (set) => { if (DD.SET === set) return false; const u = new URL(location.href); u.searchParams.set('set', set); location.replace(u.toString()); return true; };
function editRow(id, v) { const r = A.ROW[id]; r.v = v; A.rerenderRow(r); X.rowChanged(r); }
X.state = async (name, o) => {
  window.__ss2Ready = false; const q = Q.get('q');
  const toOrigin = () => { closeSwitcher({ noFocus: true }); hideToast(); if (A.S.open) A.closeSettings({ noFocus: true }); if (A.S.from !== 'chat') window.__ss1.setFrom('chat'); };
  const ensureOpen = (opt) => { closeSwitcher({ noFocus: true }); hideToast(); if (!A.S.open) A.openSettings($('#oSettings'), Object.assign({ noFocus: true }, opt || {})); };
  const lib = (opt) => { ensureOpen({ page: 'models', section: 'models.presets' }); openLibrary(Object.assign({ noAnim: true }, opt || {})); };
  const settle = () => sleep(80);
  switch (name) {
    case 'ps-switcher-chip': toOrigin(); await settle(); openSwitcher({ opener: $('#psChip') }); break;
    case 'ps-switcher-palette': toOrigin(); await settle(); openSwitcher({ mode: A.S.lay === 'phone' ? 'sheet' : 'palette' }); break;
    case 'ps-switcher-phone': toOrigin(); await settle(); openSwitcher({ mode: 'sheet', opener: $('#psChip') }); break;
    case 'ps-switcher-search': toOrigin(); await settle(); openSwitcher({ opener: $('#psChip'), q: q || '롤' }); break;
    case 'ps-switcher-chosung': toOrigin(); await settle(); openSwitcher({ opener: $('#psChip'), q: q || 'ㄹㅍ' }); break;
    case 'ps-switched-toast': toOrigin(); await settle(); switchTo('p2'); break;
    case 'ps-library': lib(); break;
    case 'ps-library-sorted-name': lib({ sort: 'name' }); { const f = FOLD[1]; if (f) toggleFolder(f.id, false); } break;
    case 'ps-library-search': lib({ q: q || '롤' }); break;
    case 'ps-library-select': lib(); await settle(); enterSelect(); { const ms = $$('#psLibList .ps-main:not([data-gid="fav"])'); toggleSel(ms[0].dataset.pid); toggleSel(ms[1].dataset.pid); } break;
    case 'ps-row-menu': lib(); await settle(); { const ms = $$('#psLibList .ps-main:not([data-gid="fav"])'); const m = ms[1] || ms[0]; m.scrollIntoView({ block: 'center' }); openRowMenu(m.dataset.pid, $('.ps-more', m.closest('.ps-row')), null, m); } break;
    case 'ps-rename': lib(); await settle(); startRename(A.S.presetActive, 'library'); break;
    case 'ps-reorder-kb': lib(); await settle(); toggleFolder(FOLD.length > 1 ? FOLD[1].id : FOLD[0].id, false); { const f = FOLD.length > 1 ? FOLD[1] : FOLD[0]; const first = D.presets.find((p) => p.folder === (f && f.id)); if (first) { const key = f.id + ':' + first.id; const el = $(`#psLibList [data-key="${CSS.escape(key)}"]`); if (el) el.focus(); moveRow(first.id, 1); } } break;
    case 'ps-folder-new': lib(); await settle(); openNewFolderDialog(); break;
    case 'ps-folder-delete': lib(); await settle(); openDeleteFolderDialog(FOLD.length > 1 ? FOLD[1].id : FOLD[0].id); break;
    case 'ps-new': lib(); await settle(); openNewDialog(); break;
    case 'ps-delete-active': lib(); await settle(); openDeleteDialog([A.S.presetActive]); break;
    case 'ps-delete-undo': lib(); await settle(); deletePresets([A.S.presetActive]); renderLib(); break;
    case 'ps-delete-last': if (needSet('one')) return new Promise(() => {}); lib(); await settle(); openDeleteDialog([A.S.presetActive]); break;
    case 'ps-import-preview': lib(); await settle(); openImportDialog(); break;
    case 'ps-slot-assign': ensureOpen({ page: 'models', section: 'models.presets' }); await settle(); openSlotDialog('p9'); break;
    case 'ps-slot-move': ensureOpen({ page: 'models', section: 'models.presets' }); await settle(); openSlotDialog('p9', 3); break;
    case 'ps-slot-empty-key': toOrigin(); await settle(); pressSlot(8); break;
    case 'ps-hotkeys-slots': ensureOpen({ page: 'keys', section: 'keys.presets' }); break;
    case 'ps-migrated': if (needSet('fresh')) return new Promise(() => {}); ensureOpen({ page: 'models', section: 'models.presets' }); break;
    case 'ps-live-saved': ensureOpen({ page: 'models', section: 'models.presets' }); await settle(); editRow('models.temperature', 1.0); await sleep(CFG.saveMs + 120); break;
    case 'ps-save-failed': ensureOpen({ page: 'models', section: 'models.presets' }); await settle(); CFG.failNext = 1; editRow('models.temperature', 1.1); await sleep(CFG.saveMs + 120); break;
    case 'ps-undo': ensureOpen({ page: 'models', section: 'models.presets' }); await settle(); editRow('models.temperature', 1.0); await sleep(CFG.saveMs + 60); $('#pageScroll').scrollTop = 0; await settle(); doUndo(); break;
    case 'ps-restore-points': ensureOpen({ page: 'models', section: 'models.presets' }); await settle(); openRestoreDialog(); break;
    case 'ps-chip-narrow': toOrigin(); window.__ss1.setFrame(360); await settle(); fitChip(); break;
    case 'ps-chip-menu': toOrigin(); await settle(); chipMenu($('#psChip')); break;
    case 'ps-stress-library': if (needSet('stress')) return new Promise(() => {}); lib(); break;
    case 'ps-one': if (needSet('one')) return new Promise(() => {}); lib(); break;
    default: break;
  }
  await sleep(o && o.wait === undefined ? 60 : 40); window.__ss2Ready = name;
};
X.afterInit = (o) => {
  if (Q.get('view') === 'library') { openLibrary({ noAnim: true, q: Q.get('lq') || '' }); return; }
  if (!o.page && !o.section && !o.row && !o.q && A.S.open && A.S.page === 'models' && A.S.view === 'page') A.showPage('models', { section: 'models.presets', noAnim: true, keepFocus: true });
};
X.ready = () => { window.__ss2Ready = true; fitChip(); };

/* ------------------------------------------------------------------ boot (called by slice1.js init with its API) */
X.boot = (api) => {
  A = api; Object.assign(A.ICONS, ICONS2);
  A.GROUPS.unshift('action'); A.T.ko.grp.action = KO.grpAction; A.T.en.grp.action = EN.grpAction;
  document.title = L2[A.S.lang].title;
  if (Q.get('char')) { A.T.ko.chatName = A.T.en.chatName = Q.get('char'); }
  { const t = document.createElement('div'); t.style.cssText = 'display:flex;flex-direction:column;row-gap:1px;position:absolute;visibility:hidden'; t.appendChild(document.createElement('div')); t.appendChild(document.createElement('div')); document.body.appendChild(t); const ok = t.scrollHeight === 1; t.remove(); if (!ok) A.root.classList.add('no-flexgap'); }   // R-19 feature test for flex gap
  reindex(); trashLoad(); A.S.presetActive = DD.activeId;
  PRESET_ROWS = D.rows.filter(isPR); PRESET_ROWS.forEach((r) => { BASE[r.id] = r.v; });
  loadVals(act()); seedRestorePoints(act());
  if (!A.hermetic) { try { Object.assign(COLL, JSON.parse(A.store.get('coll2') || '{}')); } catch (_) { /* ignore */ } }
  if (Q.get('save') === 'fail') CFG.failNext = 1;
  if (Q.get('gen') === '1') { S2.gen = true; S2.reqPreset = A.S.presetActive; }
  ensureToast(); bindPage(); bindOrigin();
  // R-19: no reliance on inert alone. While a dialog or the switcher is open the page behind is aria-hidden and focus is pulled back in by script.
  const modalSync = () => { const dlg = $('#layer .dlg-back'); const hide = !!dlg || SW.open; ['#settings', '#origin'].forEach((q) => { const e = $(q); if (!e) return; if (hide) e.setAttribute('aria-hidden', 'true'); else e.removeAttribute('aria-hidden'); }); };
  new MutationObserver(modalSync).observe($('#layer'), { childList: true });
  document.addEventListener('focusin', (ev) => {
    const dlg = $('#layer .dlg-back .dlg'); const tg = ev.target;
    if (dlg && !dlg.contains(tg) && !(tg.closest && tg.closest('.menu'))) { const f = $('[data-dlg]', dlg) || dlg; f.focus({ preventScroll: true }); return; }
    if (!dlg && SW.open && SW.root && !SW.root.contains(tg) && !(tg.closest && tg.closest('.menu')) && !(tg.closest && tg.closest('#psToast'))) SW.input.focus({ preventScroll: true });
  });
  new MutationObserver(() => {      // N-05: the toast waits (timer paused) while a dialog or the switcher is open
    if (!S2.toast) return; const m = document.body.classList.contains('dlg-open') || document.body.classList.contains('sw-open') || document.body.classList.contains('mp-open');
    if (m) { toastHold = true; clearTimeout(toastT); } else if (toastHold && !toastEl.matches(':hover') && !toastEl.contains(document.activeElement)) toastRelease();
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('keydown', onKey, false);
  window.addEventListener('popstate', () => { if (S2.popExpected > 0) { S2.popExpected--; return; } if (SW.open && SW.hist && !A.S.open) { SW.hist = false; closeSwitcher(); } });
  new ResizeObserver(() => { fitChipSoon(); if (SW.open) swPlace(); }).observe($('#app'));
  window.__ss2 = {
    S2, LIB, SW, CFG, ST, perf, SLOT, L2, t2, deleteFolder, moveManyToFolder, closeLibrary, LU, TRASH, LOCKS, SHARED, LOAD, runLU, undoLast, openTrashDialog, openExportDialog, presetFile, josa, finalOf, assignSlotU, clearSlotU, isShared, openFailDialog, discardFailed, restoreTrash, purgeTrash, announce, cl, pushLU, lockChange, guardFailed,  SLOTKEY, CHAIN, FOLD, COLL, DD, PRESET_ROWS, BASE, P, act, openSwitcher, closeSwitcher, renderSw, switchTo, openLibrary, closeLibrary, renderLib, toggleFolder, kbMove, moveRow, placeIn, doUndo, doRedo, editRow, commitPending, restoreRP,
    deletePresets, undoDelete, createPreset, duplicatePreset, renamePreset, assignSlot, pressSlot, exportPresets, setGenerating, openNewDialog, openDeleteDialog, openSlotDialog, openImportDialog, openRestoreDialog, openChainDialog, openCompareDialog, openMoveDialog, openNewFolderDialog, openDeleteFolderDialog, openIconDialog,
    fitChip, regenPresetFor, tagMessages, searchPresets, hideToast, psToast, swapSlotU, openKeySwap, undoSwitch, altUndo, nameCounter, trashLoad, trashPersist, removePresets, dropSharedHistory, libModel, canMoveNow, startRename, enterSelect, exitSelect, toggleSel, retrySave, takeRP, snapshot, effVal, diffCount, chipMenu, openRowMenu, folderMenu, presetMenuItems, openCardMenu, comboOf, findConflict, slotOf, mshort, advanceDays: (n) => { CFG.dayOffset += n; }, isCollapsed, startCapture, stopCapture, setLibQuery: (v) => { LIB.q = v; LIB.limit = 20; const i = $('#psLibQ'); if (i) i.value = v; renderLib(); paintTools(); },
  };
};
})();
