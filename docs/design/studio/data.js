/* Studio slice 1: strings (ko/en) and synthetic fixtures. All data is invented for this mockup; nothing is read from the app or any service.
   Synthetic context (SLICE1_SPEC section 12): character 세라핀 in chat 등불의 숲, 3 active modules + 2 inactive, preset 기본 롤플레이, 2 plugins,
   chat lorebook with 3 entries; toggle definitions, regex and lorebook entries spread over at least three owners. */
(function () {
  'use strict';
  var KINDS = ['basic', 'display', 'lore', 'regex', 'scripts', 'toggles', 'html', 'advanced', 'plugin'];
  var KIND_ICON = { basic: 'contact', display: 'palette', lore: 'book-open', regex: 'regex', scripts: 'square-terminal', toggles: 'toggle-right', html: 'code-xml', advanced: 'sliders-horizontal', plugin: 'plug' };
  var SUPPORT = { char: ['basic', 'display', 'lore', 'regex', 'scripts', 'toggles', 'html', 'advanced'], chat: ['lore'], module: ['display', 'lore', 'regex', 'scripts', 'toggles', 'html', 'advanced'], preset: ['regex', 'toggles', 'advanced'], plugin: ['plugin'] };
  var OWNER_ICON = { char: 'user', chat: 'message-square', module: 'puzzle', preset: 'file-text', plugin: 'plug' };
  var CODE_KINDS = ['scripts', 'plugin'];   // scripts is code only in Lua mode

  var I18N = {
    ko: {
      studioTitle: '스튜디오', back: '뒤로', openTree: '소유자 목록 열기', closeTree: '소유자 목록 닫기', treeTitle: '소유자와 종류', treeOptions: '목록 옵션', more: '더보기', search: '전체 검색', undo: '되돌리기', redo: '다시 실행',
      toggleSide: '보조 패널 열기·닫기', closeSide: '보조 패널 닫기', retry: '다시 시도', skip: '본문으로 건너뛰기',
      ownerchar: '캐릭터', ownergroup: '그룹', ownerchat: '이 채팅', ownermodule: '모듈', ownerpreset: '프리셋', ownerplugin: '플러그인', merged: '합쳐서 보기', mergedHint: '엔진이 적용하는 순서예요',
      sectionModules: '모듈', sectionPresets: '프리셋', sectionPlugins: '플러그인',
      otherModules: '다른 모듈 ({n})', otherPresets: '다른 프리셋 ({n})', modOnChat: '이 채팅에서 켜짐', modOnAll: '모든 채팅', modInChar: '캐릭터에 포함', modOff: '꺼짐',
      add: '추가', addTo: '{k} 추가', newModule: '모듈 추가', kinds: { basic: '기본 정보', display: '표시와 에셋', lore: '로어북', regex: '정규식', scripts: '스크립트', toggles: '토글 정의', html: '배경 HTML', advanced: '고급', plugin: '플러그인 코드' },
      kindShort: { basic: '정보', display: '표시', lore: '로어북', regex: '정규식', scripts: '스크립트', toggles: '토글', html: 'HTML', advanced: '고급', plugin: '스크립트' },
      draftMark: '초안', problemsN: '문제 {n}개', disabledMark: '꺼진 항목', draftsN: '초안 {n}개', itemsN: '{n}개', ownerOf: '{o}의',
      saved: '저장됨', saving: '저장 중…', saveFailed: '저장 안 됨', saveFailedRetry: '저장 안 됨 · 다시 시도', autoSave: '자동으로 저장돼요', draftStatus: '초안 · 적용 안 됨', checkedStatus: '검사함 · 오류 {e}개', appliedStatus: '적용됨', conflictStatus: '다른 곳에서 바뀜',
      undoStep: '되돌리기: {step}', redoStep: '다시 실행: {step}', nothingUndo: '되돌릴 내용이 없어요', nothingRedo: '다시 실행할 내용이 없어요', undid: '되돌렸어요: {step}', redid: '다시 실행했어요: {step}',
      restorePoint: '스튜디오를 연 시점으로 되돌리기', restoreTitle: '스튜디오를 연 시점으로 되돌릴까요?', restoreNone: '아직 바뀐 내용이 없어요', restoreBody: '스튜디오를 연 뒤 {o}에서 바뀐 내용이에요. 되돌려도 다시 실행으로 돌아올 수 있어요.', restoreDo: '되돌리기', restoreDone: '스튜디오를 연 시점으로 되돌렸어요', changedN: '바뀜 {n}', addedN: '추가 {n}', removedN: '삭제 {n}',
      history: '기록', historyEmpty: '스튜디오를 연 뒤 아직 바뀐 내용이 없어요', historyOwner: '{o}', historyOpened: '스튜디오를 연 시점', historyRevert: '이 단계로 되돌리기', reverted: '이 단계로 되돌렸어요: {step}',
      discardDraft: '초안 버리기', draftDiscarded: '초안을 버렸어요', draftDiscardedUndo: '초안을 버렸어요', draftRestored: '초안을 되살렸어요', help: '단축키와 도움말', demo: '데모 컨트롤',
      deleted: '삭제했어요: {name}', undoBtn: '되돌리기', undoEndsClose: 'Studio를 닫으면 되돌릴 수 없어요', del: '삭제', moveUp: '위로 옮기기', moveDown: '아래로 옮기기', moved: '옮겼어요', duplicate: '복제', enabledSw: '사용', disabledNote: '꺼져 있어서 채팅에 적용되지 않아요',
      hideEmpty: '빈 종류 숨기기', collapseAll: '모두 접기', expandAll: '모두 펼치기',
      placeholderForm: '임시 양식 · 다음 단계에서 다시 디자인', fName: '이름', fDesc: '설명', fFirst: '첫 메시지', fKeys: '키 (쉼표로 구분)', fContent: '내용', fAlways: '항상 켜기', fFind: '찾을 내용', fReplace: '바꿀 내용', fStage: '단계', fBody: '내용', fToggleDefs: '토글 정의 텍스트', fLow: '낮은 수준 접근', fLowHelp: 'Lua의 낮은 수준 접근은 여기서만 바꿀 수 있어요. 스튜디오의 검사는 바꾸지 않아요.', fToggleHelp: '한 줄에 하나: 키=이름=종류=선택지. 목록으로 만드는 화면은 다음 단계에서 나와요(DD-091).',
      stages: { input: '입력 수정', output: '출력 수정', display: '표시 수정', request: '요청 수정', prompt: '프롬프트 변환', run: '직접 실행' },
      errName: '이름이 비어 있어요', errRegex: '올바른 정규식이 아니에요: {m}', errKeys: '키가 비어 있어요(항상 켜기가 아니면 걸리지 않아요)',
      kindIntro: '{k}: {n}개', emptyKind: '아직 없어요', emptyKindHelp: '{o}에는 {k}을(를) 둘 수 있어요.', pickItem: '왼쪽에서 항목을 골라 주세요', ownerSummary: '{o}에 있는 종류예요',
      check: '검사', apply: '적용', checkHint: '검사 (Ctrl+S)', applyHint: '적용 (Ctrl+Enter)', applyNeedsCheck: '검사해서 오류가 0개일 때 적용할 수 있어요', applyAssume: '가정 기준으로 한 검사는 적용에 쓸 수 없어요', applyConflictHint: '다른 곳에서 바뀌어서 비교가 필요해요',
      applyTitle: '적용할까요?', applyBody: '실행 중인 버전이 이 초안으로 바뀌어요. 이전 버전은 기록에 남아서 되돌릴 수 있어요.', applyWarn: '경고 {n}개가 있지만 적용할 수 있어요: {codes}', applyDo: '적용', cancel: '취소', applied: '적용했어요. 이전 버전은 기록에 있어요',
      conflict: '초안을 만든 뒤 다른 곳에서 바뀌었어요', conflictBody: '지금 적용된 버전과 내 초안을 비교해 보세요. 선택하기 전에는 아무것도 바뀌지 않아요.', conflictCompare: '비교', keepMine: '내 것 유지', takeTheirs: '적용된 버전 쓰기', copyAside: '내 것 따로 보관', keptMine: '내 초안을 기준으로 유지했어요. 이제 적용할 수 있어요', tookTheirs: '적용된 버전을 쓰기로 했어요', copiedAside: '내 초안을 새 항목에 보관했어요', copySuffix: ' (내 초안)', conflictLive: '지금 적용된 버전', conflictMine: '내 초안', conflictDiff: '차이(−는 지금 버전, +는 내 초안)', conflictHelp: '적용된 버전 쓰기: 내 초안을 버리고 지금 버전을 열어요. 내 것 따로 보관: 내 초안을 새 항목으로 남기고 지금 버전을 열어요. 내 것 유지: 내 초안으로 적용할 수 있게 해요(지금 버전은 "이전 적용 버전"으로 남아요).',
      draftNote: '초안이에요. 채팅에서는 적용된 버전이 계속 실행돼요.', persisted: '초안이 저장돼 있어요: {n}개', draftRestoredToast: '초안 {n}개를 되살렸어요', noDraft: '초안이 없어요',
      tabProblems: '문제', tabTest: '테스트', tabHistory: '기록', probNone: '문제가 없어요', probFormHint: '이 양식에서 찾은 문제예요', probCodeHint: '규칙으로 확인한 문제예요',
      testHdr: '테스트', testMsg: '시험할 메시지', testMsgPh: '예: 안녕, 세라핀', testRun: '실행', testStop: '중지', testBasisDraft: '초안 기준', testBasisLive: '적용된 버전 기준', testResult: '결과 · {when} · {basis}', testStale: '이전 내용 기준', testStaleLong: '이전 내용 기준 · 필드나 입력이 바뀌었어요. 다시 실행해 주세요', testNever: '아직 실행하지 않았어요',
      testScopeCbs: '범위: {f} · CBS 미리보기 · 아무것도 저장하지 않아요', testToggles: '이 글에 쓰인 토글', testNoToggles: '이 글에는 토글이 없어요', testWhenNow: '방금', testWhenS: '{n}초 전', testWhenM: '{n}분 전',
      phRegex: '정규식 시험은 다음 단계에서 추가돼요', phLore: '로어북 일치 시험은 다음 단계에서 추가돼요', phTrigger: '트리거 시험은 다음 단계에서 추가돼요', phToggles: '토글 미리보기는 토글 목록 화면(다음 단계)에서 나와요', phNone: '시험할 수 있는 글 필드를 열어 보세요',
      cbsOut: '(출력이 비어 있어요)', cbsNote: 'CBS를 가상 변수로 시뮬레이션한 결과예요. 실제 파서는 실행하지 않아요.',
      searchPh: '이름, 종류, 내용 찾기', searchTitle: '전체 검색', clearSearch: '검색 지우기', closeSearch: '검색 닫기', searchWide: '다른 캐릭터까지', searchWideHint: '꺼진 모듈과 다른 프리셋은 기본으로 찾아요. 이 스위치는 다른 캐릭터를 더해요', searchWideLow: '저사양에서는 다른 캐릭터는 이름만 찾아요',
      searchNone: '찾는 항목이 없어요', searchEmpty: '이름, 종류, 내용을 찾아요. 한글은 초성으로도 찾을 수 있어요(예: ㅅㄹㅍ)', searchCount: '결과 {n}개', searchCountScope: '결과 {n}개 · 범위 {s}', scopeCtx: '이 맥락과 꺼진 모듈·프리셋', scopeWide: '다른 캐릭터 포함', searching: '찾는 중…', searchHitName: '이름', searchHitKind: '종류',
      chipAll: '전체', chipRegex: '정규식', chipLore: '로어북', chipToggles: '토글', chipScripts: '스크립트', chipTrigger: '트리거', chipBasic: '정보',
      modTitle: '모듈 추가', modNameLbl: '모듈 이름', modNameFirst: '모듈 이름을 먼저 정해 주세요', modCreate: '만들기', modExists: '같은 이름의 모듈이 있어요', modCreated: '모듈을 만들었어요: {name}', modNothing: '이름을 정하기 전에는 아무것도 저장되지 않아요',
      helpTitle: '단축키', hKeys: [['Ctrl+K', '전체 검색'], ['F6 · Shift+F6', '목록 → 편집 → 보조 패널 → 헤더 이동'], ['↑ ↓ ← → Home End', '목록에서 이동·펼치기·접기'], ['Enter', '항목 열기 · 종류 펼치기'], ['+ · Insert', '종류에 항목 추가'], ['Shift+F10 · 메뉴 키', '행 메뉴(추가, 삭제, 순서)'], ['Ctrl+Z · Ctrl+Shift+Z', '소유자 기록에서 되돌리기·다시 실행'], ['Ctrl+S', '코드 초안 검사 (일반 항목은 자동 저장)'], ['Ctrl+Enter', '검사한 초안 적용'], ['F8 · Shift+F8', '다음·이전 문제'], ['Esc', '검색·메뉴·시트 닫기 → 입력칸에서 항목으로 (스튜디오는 나가지 않아요)'], ['Esc Esc (코드 편집기)', '첫 Esc 뒤 Tab으로 편집기를 벗어나요. Esc를 한 번 더 누르면 항목으로 돌아가요']],
      leaveTitle: '스튜디오', demoSum: '데모 컨트롤', dLang: '언어', dReduced: '모션 줄이기', dLow: '저사양 모드', dFrom: '들어온 곳', dFromChat: '채팅', dFromLib: '라이브러리', dFromSet: '설정', dLatency: '저장 속도', dFast: '빠르게', dSlow: '느리게', dFailNext: '다음 저장 실패', dRemote: '다른 곳에서 바뀜(Lua)', dReload: '새로 고침 시뮬레이션', dSysBack: '시스템 뒤로', dReset: '처음 상태로', dState: '상태로 이동', dOutcome: '다음 코드 시험 결과', dNote: '목업 전용 컨트롤이에요. 앱에는 들어가지 않아요.',
      oChatTitle: '세라핀 · 등불의 숲', oChatNote: '채팅 화면의 자리표시예요 (스튜디오로 들어오는 길)', oThis: '이 채팅', oOpenChar: '캐릭터 설정 열기', oChatLore: '채팅 로어북', oToggleDefs: '토글 정의 편집', oLibTitle: '라이브러리', oOpenStudio: '스튜디오에서 열기', oLibNote: '라이브러리 화면의 자리표시예요', oSetTitle: '설정', oSetModules: '모듈', oSetPrompt: '프롬프트', oSetNote: '설정 화면의 자리표시예요', oBackTo: '{w}(으)로 돌아왔어요', oChatName: '채팅', oLibName: '라이브러리', oSetName: '설정', oMenu: '카드 메뉴', oMsg1: '세라핀: 어서 와요. 오늘 밤은 길이 조금 길어질 거예요.', oMsg2: '나: 등불을 따라가면 되나요?',
      ctxNoChat: '채팅 없이 열었어요. 채팅에 대한 표시는 숨겨요', ctxOtherChar: '{c} 캐릭터로 열었어요', openedAt: '{p}에서 열었어요', hitSelected: '일치한 곳을 골랐어요', needName: '이름을 입력해 주세요',
      outcomeLbl: ['정상', '오류', '시간 초과', '중지', '진단'],
      findInCode: '코드에서 찾기', gotoLine: '줄로 이동', prevMatch: '이전 일치', nextMatch: '다음 일치', matchCase: '대소문자 구분', wholeWord: '단어 단위', showReplace: '바꾸기 보이기', closeFind: '찾기 닫기', replaceOne: '하나 바꾸기', replaceAll: '모두 바꾸기', go: '이동', find: '찾기', replaceWith: '바꿀 내용', gotoLbl: '줄 번호',
      outdent: '내어쓰기', indent: '들여쓰기', prevProblem: '이전 문제', nextProblem: '다음 문제', autoComplete: '자동 완성', indentLbl: '들여쓰기 방식', fixAll: '빠른 수정 모두 적용', runTest: '실행', stopTest: '중지', codeEditor: '코드 편집기',
      lowLbl: '가정: 낮은 수준 접근이 켜져 있다고 보고 검사해요 (시뮬레이션일 뿐, 설정은 바뀌지 않아요)', codeEdHint: 'Tab은 줄이나 선택 영역을 들여써요. Esc를 누른 뒤 Tab을 누르면 편집기를 벗어나요. Esc를 한 번 더 누르면 항목으로 돌아가요. Ctrl+Space는 자동 완성, F8은 다음 문제, Ctrl+F는 찾기예요.',
      simTitle: '테스트', engHint: '진단 메시지는 영어 원문이에요', pluginCodeLabel: '플러그인 코드', luaLabel: 'Lua 스크립트',
      stepPeerReload: "{kind} '{name}' 다른 곳의 변경 불러옴", fRules: 'V2 규칙',
      offTag: '꺼짐', modeLua: 'Lua', modeV2: 'V2 규칙', modeV1: 'V1', scriptMode: '스크립트 방식', scriptModeLead: '이 {o}의 스크립트는 한 가지 방식만 써요',
      priorKept: '{m} 목록을 보관했어요. 다시 그 방식으로 바꾸면 돌아와요. 이 기기에만 있어요', priorRestore: '복원', priorNone: '바꾸기 전 목록은 지워지지 않고 보관돼요', stepSwitch: "{kind} 방식을 {m}(으)로 바꿈", stepPriorRestore: "{kind} 이전 목록 복원", v2Empty: '아직 규칙이 없어요', v1Note: 'V1은 오래된 방식이에요',
      mergedUnverified: '실행 순서는 아직 확인되지 않아 번호를 붙이지 않아요', mergedOrdered: '적용 순서', keysN: '{n}개',
      peerTitle: '다른 곳에서 바뀌었어요', peerBody: '이 항목이 다른 탭이나 기기에서 바뀌었어요. 지금 저장하면 그 변경 위에 덮어써요. 다시 불러와도 내 편집은 되돌리기로 되살릴 수 있어요.', peerReload: '다시 불러오기', peerKeep: '내 것 유지', peerReloaded: '다른 곳의 변경을 불러왔어요', peerKept: '내 것을 유지해요', dRemoteLive: '다른 곳에서 바뀜(항목)',
      restoreElsewhere: '다른 곳에서도 바뀐 항목이에요. 켜 두면 그 항목은 내가 한 편집까지 그대로 둬요. 끄면 내 편집과 다른 곳의 변경이 모두 되돌려져요', restoreSkip: '되돌리지 않기(내 편집도 유지)',
      priorRestoredToast: '{m} 목록을 불러왔어요', peerCount: '다른 곳에서 바뀜 · {n}', peerUndoHint: '다시 불러와도 내 편집은 되돌리기로 되살릴 수 있어요', peerMark: '다른 곳에서 바뀐 항목', peerRollup: '다른 곳에서 바뀐 항목 {n}개',
      leaveFailTitle: '저장되지 않은 변경이 있어요', leaveFailBody: '지금 나가면 저장 안 된 변경이 사라질 수 있어요.', leaveRetry: '다시 시도', leaveAnyway: '그냥 나가기', leaveStay: '머무르기', leaveWaiting: '저장하는 중이에요. 끝나면 나갈게요', leftUnsaved: '저장되지 않은 변경을 두고 나왔어요',
      storedLists: '보관 중인 목록', storedOpen: '열기', storedAside: '내 초안(따로 보관)', noticeDismiss: '알림 닫기',
      draftLocal: '초안과 기록은 이 기기에만 저장돼요. 내보내기·카드·동기화에는 들어가지 않아요', draftStoreFail: '초안을 이 기기에 저장하지 못했어요. 창을 닫으면 사라질 수 있어요', dDraftFail: '초안 저장 실패',
      delHistory: '삭제한 항목', delRestore: '삭제 되돌리기', stepRestoreDeleted: "삭제 되돌리기: {kind} '{name}'", delToastHist: '기록에서도 되돌릴 수 있어요',
      whyCheck: '검사해서 오류가 0개일 때 적용할 수 있어요', whyAssume: '가정 기준 검사는 적용에 쓸 수 없어요. 실제 설정으로 다시 검사해 주세요', openLowSetting: '낮은 수준 접근 설정 열기', panelBtn: '패널', listBtn: '소유자 목록',
      stepRedoTo: '다시 실행: {step}', undoOwnerLbl: '{o}: {step}', nothingUndoOwner: '{o}: 되돌릴 내용이 없어요', noOwner: '항목이나 소유자를 고르면 되돌리기를 쓸 수 있어요', menuUndo: '되돌리기', menuRedo: '다시 실행', rowMenu: '행 메뉴',
      deepKindFallback: '그 종류는 {o}에 없어요. {o} 루트로 열었어요', deepItemMissing: '그 항목을 찾지 못했어요. 종류 화면으로 열었어요', prevLive: '이전 적용 버전을 초안으로 열기', prevLiveOpened: '이전 적용 버전을 초안으로 열었어요', enabledMenu: '사용',
      notFound: '찾을 수 없어요', noSettingHere: '낮은 수준 접근은 캐릭터나 모듈의 설정에서 바꿔요',
      stepEdit: "{kind} '{name}' 편집", stepAdd: "{kind} '{name}' 추가", stepDelete: "{kind} '{name}' 삭제", stepMove: "{kind} '{name}' 순서 변경", stepOn: "{kind} '{name}' 켜기", stepOff: "{kind} '{name}' 끄기", stepApply: "{kind} '{name}' 적용", stepDiscard: "{kind} '{name}' 초안 버리기", stepTakeTheirs: "{kind} '{name}' 적용된 버전 쓰기", stepAside: "{kind} '{name}' 내 것 따로 보관", stepRestore: '스튜디오를 연 시점으로 되돌림', stepRevert: '되돌림: {step}',
      applyLive: '적용된 버전', discardOk: '초안을 버릴까요?', crumbLoc: '위치', srOpenedItem: '{n} 열림'
    },
    en: {
      studioTitle: 'Studio', back: 'Back', openTree: 'Open owner list', closeTree: 'Close owner list', treeTitle: 'Owners and kinds', treeOptions: 'List options', more: 'More', search: 'Search everything', undo: 'Undo', redo: 'Redo',
      toggleSide: 'Show or hide side panel', closeSide: 'Close side panel', retry: 'Try again', skip: 'Skip to content',
      ownerchar: 'Character', ownergroup: 'Group', ownerchat: 'This chat', ownermodule: 'Module', ownerpreset: 'Preset', ownerplugin: 'Plugin', merged: 'Combined', mergedHint: 'In the order the engine applies them',
      sectionModules: 'Modules', sectionPresets: 'Presets', sectionPlugins: 'Plugins',
      otherModules: 'Other modules ({n})', otherPresets: 'Other presets ({n})', modOnChat: 'On in this chat', modOnAll: 'All chats', modInChar: 'Included by character', modOff: 'Off',
      add: 'Add', addTo: 'Add {k}', newModule: 'Add module', kinds: { basic: 'Basics', display: 'Display & assets', lore: 'Lorebook', regex: 'Regex', scripts: 'Scripts', toggles: 'Toggle definitions', html: 'Background HTML', advanced: 'Advanced', plugin: 'Plugin code' },
      kindShort: { basic: 'Basics', display: 'Display', lore: 'Lorebook', regex: 'Regex', scripts: 'Scripts', toggles: 'Toggles', html: 'HTML', advanced: 'Advanced', plugin: 'Scripts' },
      draftMark: 'Draft', problemsN: '{n} problems', disabledMark: 'Disabled item', draftsN: '{n} drafts', itemsN: '{n}', ownerOf: '{o}: ',
      saved: 'Saved', saving: 'Saving…', saveFailed: 'Not saved', saveFailedRetry: 'Not saved · Try again', autoSave: 'Saves automatically', draftStatus: 'Draft · not applied', checkedStatus: 'Checked · {e} errors', appliedStatus: 'Applied', conflictStatus: 'Changed elsewhere',
      undoStep: 'Undo: {step}', redoStep: 'Redo: {step}', nothingUndo: 'Nothing to undo', nothingRedo: 'Nothing to redo', undid: 'Undid: {step}', redid: 'Redid: {step}',
      restorePoint: 'Restore to when Studio was opened', restoreTitle: 'Restore to when Studio was opened?', restoreNone: 'Nothing has changed yet', restoreBody: 'Changes to {o} since Studio was opened. You can undo the restore.', restoreDo: 'Restore', restoreDone: 'Restored to when Studio was opened', changedN: 'changed {n}', addedN: 'added {n}', removedN: 'removed {n}',
      history: 'History', historyEmpty: 'Nothing has changed since Studio was opened', historyOwner: '{o}', historyOpened: 'When Studio was opened', historyRevert: 'Revert to this step', reverted: 'Reverted to: {step}',
      discardDraft: 'Discard draft', draftDiscarded: 'Draft discarded', draftDiscardedUndo: 'Draft discarded', draftRestored: 'Draft restored', help: 'Shortcuts and help', demo: 'Demo controls',
      deleted: 'Deleted: {name}', undoBtn: 'Undo', undoEndsClose: 'Undo ends when Studio closes', del: 'Delete', moveUp: 'Move up', moveDown: 'Move down', moved: 'Moved', duplicate: 'Duplicate', enabledSw: 'Enabled', disabledNote: 'Disabled, so it does not apply in chats',
      hideEmpty: 'Hide empty kinds', collapseAll: 'Collapse all', expandAll: 'Expand all',
      placeholderForm: 'Temporary form · redesigned in a later slice', fName: 'Name', fDesc: 'Description', fFirst: 'First message', fKeys: 'Keys (comma separated)', fContent: 'Content', fAlways: 'Always on', fFind: 'Find', fReplace: 'Replace with', fStage: 'Stage', fBody: 'Content', fToggleDefs: 'Toggle definition text', fLow: 'Low-level access', fLowHelp: 'Low-level access for Lua is only changed here. Studio checks never change it.', fToggleHelp: 'One per line: key=label=type=options. The list builder arrives in a later slice (DD-091).',
      stages: { input: 'Modify input', output: 'Modify output', display: 'Modify display', request: 'Modify request', prompt: 'Prompt transform', run: 'Run directly' },
      errName: 'Name is empty', errRegex: 'Not a valid regular expression: {m}', errKeys: 'Keys are empty (it will not trigger unless Always on)',
      kindIntro: '{k}: {n}', emptyKind: 'None yet', emptyKindHelp: '{o} can hold {k}.', pickItem: 'Pick an item on the left', ownerSummary: 'Kinds in {o}',
      check: 'Check', apply: 'Apply', checkHint: 'Check (Ctrl+S)', applyHint: 'Apply (Ctrl+Enter)', applyNeedsCheck: 'Apply is available once a check finds 0 errors', applyAssume: 'A check made under a what-if cannot be applied', applyConflictHint: 'Changed elsewhere; compare first',
      applyTitle: 'Apply?', applyBody: 'The running version is replaced by this draft. The previous version stays in History so you can undo.', applyWarn: '{n} warnings, still allowed: {codes}', applyDo: 'Apply', cancel: 'Cancel', applied: 'Applied. The previous version is in History',
      conflict: 'Changed elsewhere since your draft', conflictBody: 'Compare the applied version with your draft. Nothing changes until you choose.', conflictCompare: 'Compare', keepMine: 'Keep mine', takeTheirs: 'Use the applied version', copyAside: 'Copy mine aside', keptMine: 'Kept your draft as the base. You can apply now', tookTheirs: 'Using the applied version', copiedAside: 'Saved your draft as a new item', copySuffix: ' (my draft)', conflictLive: 'Applied version now', conflictMine: 'My draft', conflictDiff: 'Differences (− applied now, + my draft)', conflictHelp: 'Use the applied version: discard my draft and open the applied version. Copy mine aside: keep my draft as a new item and open the applied version. Keep mine: let my draft be applied (the current version stays as the previous applied version).',
      draftNote: 'This is a draft. Chats keep running the applied version.', persisted: 'Drafts saved: {n}', draftRestoredToast: 'Restored {n} drafts', noDraft: 'No draft',
      tabProblems: 'Problems', tabTest: 'Test', tabHistory: 'History', probNone: 'No problems', probFormHint: 'Problems found in this form', probCodeHint: 'Problems found by the rules',
      testHdr: 'Test', testMsg: 'Message to try', testMsgPh: 'e.g. Hello, Seraphina', testRun: 'Run', testStop: 'Stop', testBasisDraft: 'based on the draft', testBasisLive: 'based on the applied version', testResult: 'Result · {when} · {basis}', testStale: 'Based on earlier content', testStaleLong: 'Based on earlier content · the field or input changed. Run again', testNever: 'Not run yet',
      testScopeCbs: 'Scope: {f} · CBS preview · nothing is saved', testToggles: 'Toggles used in this text', testNoToggles: 'This text uses no toggles', testWhenNow: 'just now', testWhenS: '{n} s ago', testWhenM: '{n} min ago',
      phRegex: 'The regex tester is added in a later slice', phLore: 'The lorebook match tester is added in a later slice', phTrigger: 'The trigger tester is added in a later slice', phToggles: 'The toggle preview comes with the toggle list builder (later slice)', phNone: 'Open a text field to try it',
      cbsOut: '(empty output)', cbsNote: 'CBS simulated with synthetic variables. The real parser is not run.',
      searchPh: 'Search names, kinds, content', searchTitle: 'Search everything', clearSearch: 'Clear search', closeSearch: 'Close search', searchWide: 'Include other characters', searchWideHint: 'Off modules and other presets are searched by default. This switch adds other characters', searchWideLow: 'In low power, other characters are searched by name only',
      searchNone: 'Nothing found', searchEmpty: 'Search names, kinds and content. Korean initials work too (e.g. ㅅㄹㅍ)', searchCount: '{n} results', searchCountScope: '{n} results · scope {s}', scopeCtx: 'this context plus off modules and presets', scopeWide: 'including other characters', searching: 'Searching…', searchHitName: 'name', searchHitKind: 'kind',
      chipAll: 'All', chipRegex: 'Regex', chipLore: 'Lorebook', chipToggles: 'Toggles', chipScripts: 'Scripts', chipTrigger: 'Triggers', chipBasic: 'Basics',
      modTitle: 'Add module', modNameLbl: 'Module name', modNameFirst: 'Name the module first', modCreate: 'Create', modExists: 'A module with that name exists', modCreated: 'Created module: {name}', modNothing: 'Nothing is stored until it has a name',
      helpTitle: 'Shortcuts', hKeys: [['Ctrl+K', 'Search everything'], ['F6 · Shift+F6', 'Move list → editor → side panel → header'], ['↑ ↓ ← → Home End', 'Move, expand and collapse in the list'], ['Enter', 'Open item · expand kind'], ['+ · Insert', 'Add an item to the kind'], ['Shift+F10 · menu key', 'Row menu (add, delete, order)'], ['Ctrl+Z · Ctrl+Shift+Z', 'Undo and redo in the owner history'], ['Ctrl+S', 'Check a code draft (other items save automatically)'], ['Ctrl+Enter', 'Apply a checked draft'], ['F8 · Shift+F8', 'Next and previous problem'], ['Esc', 'Closes search, menus, sheets, then leaves a text field to the item (it never leaves Studio)'], ['Esc Esc (code editor)', 'The first Esc then Tab leaves the editor; a second Esc returns to the item']],
      leaveTitle: 'Studio', demoSum: 'Demo controls', dLang: 'Language', dReduced: 'Reduce motion', dLow: 'Low power', dFrom: 'Entered from', dFromChat: 'Chat', dFromLib: 'Library', dFromSet: 'Settings', dLatency: 'Save speed', dFast: 'Fast', dSlow: 'Slow', dFailNext: 'Fail next save', dRemote: 'Changed elsewhere (Lua)', dReload: 'Simulate reload', dSysBack: 'System back', dReset: 'Reset', dState: 'Go to state', dOutcome: 'Next code test result', dNote: 'Mockup-only controls. They do not belong in the app.',
      oChatTitle: 'Seraphina · Lantern Forest', oChatNote: 'Placeholder for the chat screen (where Studio is entered from)', oThis: 'This chat', oOpenChar: 'Open character settings', oChatLore: 'Chat lorebook', oToggleDefs: 'Edit toggle definitions', oLibTitle: 'Library', oOpenStudio: 'Open in Studio', oLibNote: 'Placeholder for the library screen', oSetTitle: 'Settings', oSetModules: 'Modules', oSetPrompt: 'Prompt', oSetNote: 'Placeholder for the settings screen', oBackTo: 'Back at {w}', oChatName: 'chat', oLibName: 'library', oSetName: 'settings', oMenu: 'Card menu', oMsg1: 'Seraphina: Welcome. The path may run a little longer tonight.', oMsg2: 'Me: Do I just follow the lantern?',
      ctxNoChat: 'Opened without a chat. Chat badges are hidden', ctxOtherChar: 'Opened character {c}', openedAt: 'Opened at {p}', hitSelected: 'Selected the match', needName: 'Enter a name',
      outcomeLbl: ['Normal', 'Thrown', 'Timeout', 'Stopped', 'Diagnostics'],
      findInCode: 'Find in code', gotoLine: 'Go to line', prevMatch: 'Previous match', nextMatch: 'Next match', matchCase: 'Match case', wholeWord: 'Whole word', showReplace: 'Show replace', closeFind: 'Close find', replaceOne: 'Replace one', replaceAll: 'Replace all', go: 'Go', find: 'Find', replaceWith: 'Replace with', gotoLbl: 'Line number',
      outdent: 'Outdent', indent: 'Indent', prevProblem: 'Previous problem', nextProblem: 'Next problem', autoComplete: 'Auto-complete', indentLbl: 'Indent', fixAll: 'Apply all quick fixes', runTest: 'Run', stopTest: 'Stop', codeEditor: 'Code editor',
      lowLbl: 'What-if: check as if low-level access were on (simulation only; no setting changes)', codeEdHint: 'Tab indents the line or selection. Press Escape, then Tab, to move focus out of the editor; press Escape twice to return to the item. Control plus Space opens completions, F8 jumps to the next problem, Control plus F finds.',
      simTitle: 'Test', engHint: 'Diagnostic messages are English source text', pluginCodeLabel: 'Plugin code', luaLabel: 'Lua script',
      stepPeerReload: "Reload {kind} '{name}' from elsewhere", fRules: 'V2 rules',
      offTag: 'Off', modeLua: 'Lua', modeV2: 'V2 rules', modeV1: 'V1', scriptMode: 'Script mode', scriptModeLead: 'Scripts of this {o} use one mode at a time',
      priorKept: 'Kept the {m} list. Switching back to that mode brings it back. It stays on this device only', priorRestore: 'Restore', priorNone: 'The list before a switch is kept, not wiped', stepSwitch: "Switch {kind} to {m}", stepPriorRestore: "Restore previous {kind} list", v2Empty: 'No rules yet', v1Note: 'V1 is the old mode',
      mergedUnverified: 'The run order is not verified yet, so there are no numbers', mergedOrdered: 'Applied in this order', keysN: '{n}',
      peerTitle: 'Changed elsewhere', peerBody: 'This item changed in another tab or device. Saving now writes over that change. Reloading keeps your edit available through Undo.', peerReload: 'Reload', peerKeep: 'Keep mine', peerReloaded: 'Loaded the change made elsewhere', peerKept: 'Keeping your version', dRemoteLive: 'Changed elsewhere (item)',
      restoreElsewhere: 'Also changed elsewhere. Left on, the item stays as it is now, including your own edits to it. Switched off, your edits and the change made elsewhere are both undone', restoreSkip: 'Do not restore (keeps my edits too)',
      priorRestoredToast: 'Loaded the {m} list', peerCount: 'Changed elsewhere · {n}', peerUndoHint: 'Reloading keeps your edit available through Undo', peerMark: 'Changed elsewhere', peerRollup: '{n} items changed elsewhere',
      leaveFailTitle: 'Some changes were not saved', leaveFailBody: 'If you leave now, the unsaved changes may be lost.', leaveRetry: 'Try again', leaveAnyway: 'Leave anyway', leaveStay: 'Stay', leaveWaiting: 'Saving. Leaving when it is done', leftUnsaved: 'Left with unsaved changes',
      storedLists: 'Stored lists', storedOpen: 'Open', storedAside: 'My draft (kept aside)', noticeDismiss: 'Dismiss notice',
      draftLocal: 'Drafts and history stay on this device only. They are not in exports, cards or sync', draftStoreFail: 'Could not store the draft on this device. It may be lost when you close this window', dDraftFail: 'Draft store fails',
      delHistory: 'Deleted items', delRestore: 'Undo delete', stepRestoreDeleted: "Undo delete: {kind} '{name}'", delToastHist: 'You can also undo it from History',
      whyCheck: 'Apply is available once a check finds 0 errors', whyAssume: 'A what-if check cannot be applied. Check again with the real setting', openLowSetting: 'Open low-level access setting', panelBtn: 'Panel', listBtn: 'Owner list',
      stepRedoTo: 'Redo: {step}', undoOwnerLbl: '{o}: {step}', nothingUndoOwner: '{o}: nothing to undo', noOwner: 'Pick an item or owner to use undo', menuUndo: 'Undo', menuRedo: 'Redo', rowMenu: 'Row menu',
      deepKindFallback: 'That kind does not exist in {o}. Opened the {o} root', deepItemMissing: 'That item was not found. Opened the kind instead', prevLive: 'Open the previous applied version as a draft', prevLiveOpened: 'Opened the previous applied version as a draft', enabledMenu: 'Enabled',
      notFound: 'Not found', noSettingHere: 'Low-level access is changed in the character or module settings',
      stepEdit: "Edit {kind} '{name}'", stepAdd: "Add {kind} '{name}'", stepDelete: "Delete {kind} '{name}'", stepMove: "Reorder {kind} '{name}'", stepOn: "Enable {kind} '{name}'", stepOff: "Disable {kind} '{name}'", stepApply: "Apply {kind} '{name}'", stepDiscard: "Discard draft of {kind} '{name}'", stepTakeTheirs: "Use applied version of {kind} '{name}'", stepAside: "Copy {kind} '{name}' aside", stepRestore: 'Restored to when Studio was opened', stepRevert: 'Reverted: {step}',
      applyLive: 'Applied version', discardOk: 'Discard the draft?', crumbLoc: 'Location', srOpenedItem: '{n} opened'
    }
  };

  // ---------- fixtures ----------
  var LUA_LIVE = '-- Risu trigger script (Lua)\nonOutput = async(function(triggerId)\n  local hp = tonumber(getChatVar(triggerId, "hp")) or 100\n  if hp >= 50 then\n    setChatVar(triggerId, "mood", "confident")\n  else\n    setChatVar(triggerId, "mood", "cautious")\n  end\nend)';
  var LUA_BUGS = '-- Risu trigger script (Lua)\nfunction onOutput(triggerId)\n  local hp = tonumber(getChatVar(triggerId, "hp")) or 0\n  if hp < 20 then\n    local summary = simpleLLM(triggerId, "Summarize danger")\n    setChatVar(triggerId, "danger_note", summary)\n  end\nend';
  var LUA_FIXED = '-- Risu trigger script (Lua)\nonOutput = async(function(triggerId)\n  local hp = tonumber(getChatVar(triggerId, "hp")) or 0\n  if hp < 20 then\n    setChatVar(triggerId, "danger_note", "low hp")\n  end\nend)';
  var LUA_M = '-- narration style check\nonInput = async(function(triggerId)\n  setChatVar(triggerId, "style", "warm")\nend)';
  var PLUGIN_A = '//@name companion_hud\n//@display-name Companion HUD\n//@api 3.0\n//@version 1.0.0\n//@arg api_endpoint string\n//@arg max_retries int\n//@link https://example.invalid/docs Docs\n//@update-url https://example.invalid/hud.js\n\nconst endpoint = await risuai.getArgument("api_endpoint");\nawait risuai.log("Initialized HUD: " + endpoint);';
  var PLUGIN_B = '//@name status_bar\n//@display-name Status bar\n//@api 3.0\n//@version 0.3.1\n\nawait risuai.log("status bar ready");';

  function T2(ko, en) { return { ko: ko, en: en }; }
  function build(lang) {
    var L = lang === 'en' ? 'en' : 'ko';
    function c(ko, en) { return L === 'en' ? en : ko; }
    var DB = { owners: {}, order: [], ctxChar: 'c1' };
    function owner(id, type, name, extra) { var o = Object.assign({ id: id, type: type, name: name, items: [] }, extra || {}); DB.owners[id] = o; DB.order.push(id); return o; }
    function item(o, id, kind, name, f, extra) { var it = Object.assign({ id: id, kind: kind, name: name, on: true, f: f || {} }, extra || {}); o.items.push(it); return it; }
    function script(o, id, mode, d) { var it = item(o, id, 'scripts', mode === 'lua' ? T2('Lua 스크립트', 'Lua script') : T2('V2 규칙', 'V2 rules'), { rules: d.rules || '' }, { mode: mode }); if (mode === 'lua') it.code = { live: d.live, liveRev: d.rev || 1 }; return it; }
    function code(o, id, kind, name, live, rev) { return item(o, id, kind, name, {}, { code: { live: live, liveRev: rev || 1 } }); }

    var ch = owner('c1', 'char', T2('세라핀', 'Seraphina'));
    item(ch, 'c1.basic', 'basic', T2('기본 정보', 'Basics'), {
      name: c('세라핀', 'Seraphina'),
      description: c('등불 숲의 길잡이. 낮에는 고요하고, 밤에는 불빛을 따라 나그네를 안내한다. {{#when::{{getglobalvar::toggle_lantern}}}}손에는 푸른 등불이 켜져 있다.{{:else}}등불은 꺼져 있다.{{/when}}', 'A guide of the Lantern Forest. Quiet by day, she leads travellers by light at night. {{#when::{{getglobalvar::toggle_lantern}}}}A blue lantern burns in her hand.{{:else}}The lantern is dark.{{/when}}'),
      first: c('{{char}}는 숲길 어귀에서 {{user}}를 기다리고 있었다. {{#when::{{getglobalvar::toggle_combat}}}}경계하듯 칼자루를 쥔 채,{{:else}}편안한 얼굴로 손을 흔들며,{{/when}} "어서 와요. 오늘 밤은 길이 조금 길어질 거예요."', '{{char}} was waiting at the edge of the forest path for {{user}}. {{#when::{{getglobalvar::toggle_combat}}}}Hand on her sword hilt,{{:else}}Waving with an easy smile,{{/when}} "Welcome. The path may run a little longer tonight."')
    });
    item(ch, 'c1.display', 'display', T2('표시와 에셋', 'Display & assets'), { body: c('초상화 4개 · 감정 이미지 6개 · 배경 음악 1개', '4 portraits · 6 emotion images · 1 background track') });
    item(ch, 'c1.lore1', 'lore', T2('등불 숲의 규칙', 'Rules of the Lantern Forest'), { keys: c('등불, 숲길', 'lantern, forest path'), content: c('등불이 꺼지면 숲길이 사라진다. 방문자는 반드시 불빛 안에 머물러야 한다.', 'When the lantern goes out the path disappears. Visitors must stay inside the light.'), always: false });
    item(ch, 'c1.lore2', 'lore', T2('세라핀의 과거', 'Seraphina\'s past'), { keys: c('과거, 고향', 'past, home'), content: c('세라핀은 한때 강가 마을의 등대지기였다. {{#when::{{getglobalvar::toggle_mood}}}}지금도 가끔 파도 소리를 그리워한다.{{:else}}과거 이야기를 꺼내지 않는다.{{/when}}', 'Seraphina once kept the lighthouse of a river town. {{#when::{{getglobalvar::toggle_mood}}}}She still misses the sound of waves.{{:else}}She does not bring up the past.{{/when}}'), always: false });
    item(ch, 'c1.re1', 'regex', T2('말투 정리', 'Tidy speech'), { find: '\\s{2,}', replace: ' ', stage: 'output' });
    item(ch, 'c1.re2', 'regex', T2('금칙어 가리기', 'Mask banned words'), { find: '(비속어', replace: '***', stage: 'display' });
    script(ch, 'c1.sc', 'lua', { live: LUA_LIVE, rev: 4 });
    item(ch, 'c1.tg', 'toggles', T2('토글 정의', 'Toggle definitions'), { defs: 'combat=' + c('전투 모드', 'Combat mode') + '\nlantern=' + c('등불 켜기', 'Light the lantern') + '\nmood=' + c('분위기', 'Mood') + '=select=' + c('차분,신비,장난', 'calm,mystic,playful') });
    item(ch, 'c1.adv', 'advanced', T2('고급 설정', 'Advanced settings'), { body: c('예시 대화: (비어 있음)\n시스템 프롬프트: 기본값 사용', 'Example dialogue: (empty)\nSystem prompt: use default'), lowLevel: false });

    var chat = owner('chat1', 'chat', T2('등불의 숲', 'Lantern Forest'));
    item(chat, 'chat1.lore1', 'lore', T2('오늘의 날씨', 'Today\'s weather'), { keys: c('날씨, 안개', 'weather, fog'), content: c('안개가 짙게 깔려 등불 빛이 세 걸음밖에 닿지 않는다.', 'Thick fog; the lantern light reaches only three paces.'), always: true });
    item(chat, 'chat1.lore2', 'lore', T2('동행자 메모', 'Companion note'), { keys: c('동행, 나그네', 'companion, traveller'), content: c('이번 나그네는 길을 잃은 약사다. 세라핀은 그의 짐을 궁금해한다.', 'This traveller is a lost apothecary. Seraphina is curious about his pack.'), always: false });
    item(chat, 'chat1.lore3', 'lore', T2('숨겨진 길', 'The hidden path'), { keys: c('샛길, 이끼', 'side path, moss'), content: c('이끼 낀 돌 뒤에 샛길이 있다. 한 번만 쓸 수 있다.', 'A side path hides behind the mossy stone. It can be used once.'), always: false });

    var m1 = owner('m1', 'module', T2('서술 스타일', 'Narration style'), { scope: 'chat', active: true });
    item(m1, 'm1.lore1', 'lore', T2('문체 지침', 'Style guide'), { keys: c('문체, 서술', 'style, narration'), content: c('3인칭 현재형으로, 감각 묘사를 한 문장 이상 넣는다.', 'Write in third person present tense with at least one sensory sentence.'), always: true });
    item(m1, 'm1.re1', 'regex', T2('문체 보정', 'Style fix'), { find: '했다\\.', replace: '한다.', stage: 'output' });
    script(m1, 'm1.sc', 'lua', { live: LUA_M, rev: 2 });
    item(m1, 'm1.adv', 'advanced', T2('고급 설정', 'Advanced settings'), { body: c('모듈 옵션: 기본값', 'Module options: defaults'), lowLevel: false });
    item(m1, 'm1.tg', 'toggles', T2('토글 정의', 'Toggle definitions'), { defs: 'style_warm=' + c('따뜻한 문체', 'Warm tone') });

    var m2 = owner('m2', 'module', T2('장면 카드', 'Scene cards'), { scope: 'all', active: true });
    item(m2, 'm2.disp1', 'display', T2('카드 스타일', 'Card style'), { body: c('테두리: 얇게 · 배경: 반투명', 'Border: thin · Background: translucent') });
    item(m2, 'm2.re1', 'regex', T2('장면 구분선', 'Scene divider'), { find: '\\*\\*\\*', replace: '<hr>', stage: 'display' });
    item(m2, 'm2.tg', 'toggles', T2('토글 정의', 'Toggle definitions'), { defs: 'scene_cards=' + c('장면 카드 보이기', 'Show scene cards') });
    item(m2, 'm2.adv', 'advanced', T2('고급 설정', 'Advanced settings'), { body: '', lowLevel: false });
    item(m2, 'm2.html1', 'html', T2('장면 카드 배경', 'Scene card background'), { body: '<div class="scene-bg"></div>' });

    var m3 = owner('m3', 'module', T2('메모리 도우미', 'Memory helper'), { scope: 'char:c1', active: true });
    item(m3, 'm3.lore1', 'lore', T2('기억 요약 규칙', 'Memory summary rule'), { keys: c('기억, 요약', 'memory, summary'), content: c('20턴마다 지금까지의 일을 세 줄로 요약해 기억 칸에 넣는다.', 'Every 20 turns, summarise events in three lines and store them as memory.'), always: false });
    script(m3, 'm3.sc', 'v2', { rules: c('조건: 턴 수 % 20 == 0 → 효과: 요약 실행\n조건: 첫 메시지 → 효과: 변수 memory 비우기', 'Condition: turn % 20 == 0 → Effect: run summary\nCondition: first message → Effect: clear variable memory') });
    item(m3, 'm3.adv', 'advanced', T2('고급 설정', 'Advanced settings'), { body: '', lowLevel: false });

    var m4 = owner('m4', 'module', T2('전투 규칙', 'Combat rules'), { scope: 'none', active: false });
    item(m4, 'm4.lore1', 'lore', T2('전투 시작', 'Start of combat'), { keys: c('전투, 칼', 'combat, sword'), content: c('전투는 세 라운드로 끝난다.', 'Combat ends after three rounds.'), always: false });
    item(m4, 'm4.re1', 'regex', T2('피해 표기', 'Damage format'), { find: '(\\d+) 피해', replace: '[$1]', stage: 'display' });
    item(m4, 'm4.tg', 'toggles', T2('토글 정의', 'Toggle definitions'), { defs: 'hardcore=' + c('어려운 전투', 'Hard combat') });
    item(m4, 'm4.adv', 'advanced', T2('고급 설정', 'Advanced settings'), { body: '', lowLevel: false });
    var m5 = owner('m5', 'module', T2('번역 도우미', 'Translation helper'), { scope: 'none', active: false });
    item(m5, 'm5.adv', 'advanced', T2('고급 설정', 'Advanced settings'), { body: '', lowLevel: false });
    item(m5, 'm5.re1', 'regex', T2('영어 병기', 'Add English'), { find: '등불', replace: '등불(lantern)', stage: 'display' });
    item(m5, 'm5.re2', 'regex', T2('존댓말 통일', 'Unify politeness'), { find: '해\\.', replace: '해요.', stage: 'output' });

    var p1 = owner('p1', 'preset', T2('기본 롤플레이', 'Default roleplay'), { active: true });
    item(p1, 'p1.re1', 'regex', T2('공백 정리', 'Whitespace cleanup'), { find: ' +$', replace: '', stage: 'output' });
    item(p1, 'p1.tg', 'toggles', T2('토글 정의', 'Toggle definitions'), { defs: 'longform=' + c('긴 답변', 'Long replies') });
    item(p1, 'p1.adv', 'advanced', T2('프롬프트 옵션', 'Prompt options'), { body: c('템플릿: 기본\n기본 변수: hp=100', 'Template: default\nDefault variables: hp=100') });
    var p2 = owner('p2', 'preset', T2('간결한 응답', 'Concise replies'), { active: false });
    item(p2, 'p2.adv', 'advanced', T2('프롬프트 옵션', 'Prompt options'), { body: c('템플릿: 간결', 'Template: concise') });
    var p3 = owner('p3', 'preset', T2('긴 서사', 'Long narrative'), { active: false });
    item(p3, 'p3.adv', 'advanced', T2('프롬프트 옵션', 'Prompt options'), { body: c('템플릿: 서사', 'Template: narrative') });

    var pl1 = owner('pl1', 'plugin', T2('companion_hud', 'companion_hud'));
    code(pl1, 'pl1.code', 'plugin', T2('companion_hud.js', 'companion_hud.js'), PLUGIN_A, 3);
    var pl2 = owner('pl2', 'plugin', T2('status_bar', 'status_bar'));
    code(pl2, 'pl2.code', 'plugin', T2('status_bar.js', 'status_bar.js'), PLUGIN_B, 1);

    // other characters: only reachable through the wide search switch or the library
    var c2 = owner('c2', 'char', T2('아리아', 'Aria'), { other: true });
    item(c2, 'c2.basic', 'basic', T2('기본 정보', 'Basics'), { name: c('아리아', 'Aria'), description: c('등불 축제의 악사. 등불 노래를 부른다.', 'A musician of the lantern festival. She sings the lantern song.'), first: c('{{char}}가 현을 고르고 있다.', '{{char}} is tuning her strings.') });
    item(c2, 'c2.lore1', 'lore', T2('등불 노래', 'The lantern song'), { keys: c('노래, 등불', 'song, lantern'), content: c('등불이 켜질 때마다 한 소절씩 늘어나는 노래.', 'A song that gains one verse each time a lantern is lit.'), always: false });
    var c3 = owner('c3', 'char', T2('카이', 'Kai'), { other: true });
    item(c3, 'c3.basic', 'basic', T2('기본 정보', 'Basics'), { name: c('카이', 'Kai'), description: c('항구의 짐꾼.', 'A harbour porter.'), first: c('{{char}}가 짐을 내려놓는다.', '{{char}} sets down a crate.') });
    script(c3, 'c3.sc', 'v2', { rules: c('조건: 첫 메시지 → 효과: 짐 목록 표시', 'Condition: first message → Effect: show cargo list') });
    return DB;
  }

  window.StudioData = { KINDS: KINDS, KIND_ICON: KIND_ICON, SUPPORT: SUPPORT, OWNER_ICON: OWNER_ICON, CODE_KINDS: CODE_KINDS, I18N: I18N, build: build, LUA_BUGS: LUA_BUGS, LUA_FIXED: LUA_FIXED, LUA_LIVE: LUA_LIVE };
})();
