/* Settings slice 3 mockup: connections (named, tested on demand, keys masked), the model picker (Settings + Ctrl+M), the one models page, the fix-it path from a failed chat reply.
   Synthetic mockup; not proof of native behaviour or performance. Standalone (no network, no dependencies): every "request" and test is a timer, keys are fake.
   Loaded after slice2.js and BEFORE slice1.js: it wraps the window.SS1_EXT hooks that slice2.js registered (slice1.js reads them at start-up) and receives slice 1's API in X.boot.
   Implements settings/SLICE3_SPEC.md revision 2 (sections 1-12 plus the review answers of section 13). Sections: helpers, i18n, state, connections (model + operations), problems and marks, picker, models page, fallback editor, connection UI (list, detail, dialogs),
   fix-it path and chat stub, Ctrl+M, hooks, states, public API. */
(() => {
'use strict';
const X = window.SS1_EXT;
const D = window.SS1_DATA, D3 = window.SS3_DATA;
const Q = new URLSearchParams(location.search);
let A = null, B = null;                           // A: slice 1 API (from X.boot); B: window.__ss2 (slice 2)
const { CX, PROV, PROVIDERS, PGROUPS, FLAGS, FLAG, SET3 } = D3;
const KEYS = D3.takeKeys();   // R-29: the fixture keys live only in this closure; nothing exposed on the page carries one
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ic = (n, s, c) => A.ic(n, s, c);
const now = () => performance.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lang = () => A.S.lang;
const KO = () => lang() === 'ko';
const cl = (n, m = 28) => { n = String(n); return n.length > m ? n.slice(0, m - 1) + '…' : n; };
const NAME_MAX = 60;

/* ------------------------------------------------------------------ icons (Lucide paths, inline; copied, not imported) */
const ICONS3 = {
  'key-round': '<path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/>',
  'plug-zap': '<path d="M6.3 20.3a2.4 2.4 0 0 0 3.4 0L12 18l-6-6-2.3 2.3a2.4 2.4 0 0 0 0 3.4Z"/><path d="m2 22 3-3"/><path d="M7.5 13.5 10 11"/><path d="M10.5 16.5 13 14"/><path d="m18 3-4 4h6l-4 4"/>',
  'variable': '<path d="M8 21s-4-3-4-9 4-9 4-9"/><path d="M16 3s4 3 4 9-4 9-4 9"/><line x1="15" x2="9" y1="9" y2="15"/><line x1="9" x2="15" y1="9" y2="15"/>',
  'cloud': '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
  'server': '<rect width="20" height="8" x="2" y="2" rx="2" ry="2"/><rect width="20" height="8" x="2" y="14" rx="2" ry="2"/><line x1="6" x2="6.01" y1="6" y2="6"/><line x1="6" x2="6.01" y1="18" y2="18"/>',
  'route': '<circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>',
  'eye': '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
  'brain': '<path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/><path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4"/><path d="M17.599 6.5a3 3 0 0 0 .399-1.375"/><path d="M6.003 5.125A3 3 0 0 0 6.401 6.5"/><path d="M3.477 10.896a4 4 0 0 1 .585-.396"/><path d="M19.938 10.5a4 4 0 0 1 .585.396"/><path d="M6 18a4 4 0 0 1-1.967-.516"/><path d="M19.967 17.484A4 4 0 0 1 18 18"/>',
  'circle-check': '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  'chevron-up': '<path d="m18 15-6-6-6 6"/>',
  'arrow-right': '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  'chevron-left': '<path d="m15 18-6-6 6-6"/>',
  'minus': '<path d="M5 12h14"/>',
  'plug': '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>',
};

/* ------------------------------------------------------------------ i18n (SLICE3_SPEC section 9 keys plus mockup-only keys; no Korean particle directly after a user-chosen name, DS-038) */
const K = {
  ko: {
    title: '설정 슬라이스 3 · 연결과 모델 목업',
    connections: '연결', addConn: '연결 추가', noConnections: '아직 연결이 없어요. 쓰려는 서비스를 골라 키를 넣으면 돼요.',
    usedBy: (n) => `프리셋 ${n}개에서 사용`, notUsed: '쓰는 프리셋이 없어요',
    keyMissing: '키 없음', keyNeeded: '키 필요', keyAgain: '키 다시 입력 필요', keyNa: '키 필요 없음',
    changeKey: '키 바꾸기', clearKey: '키 지우기', setKey: '키 넣기',
    keyLocal: '키는 실행 취소·복원 지점·공유용 내보내기에는 들어가지 않아요. 전체 백업에는 들어가요.', keyNoUndo: '키는 되돌릴 수 없어요', keysAlwaysHidden: 'API 키는 항상 가려져 있어요 · 끝 4자리만 보여요',
    test: '확인', testing: '확인 중…', testCancel: '확인 취소', testCancelled: '확인을 취소했어요',
    testOk: (n) => `정상 · 모델 ${n}개를 찾았어요`, testBadKey: '키가 맞지 않아요', testUnreachable: '연결할 수 없어요', testQuota: '한도를 넘었어요', notTested: '확인 안 함',
    deleteConnQ: (n) => `‘${n}’ 연결을 지울까요?`, usedHere: '이 연결을 쓰는 곳', andMore: (n) => `외 ${n}개`, connDeleted: (n) => `연결 삭제됨: ${n}`, noConnection: '연결 없음',
    pickModel: (r) => `${r} 고르기`, currentModel: '지금 쓰는 모델', recent: '최근',
    tagRecommended: '추천', tagUnverified: '확인 안 됨', tagDeprecated: '지원 종료', tagCustom: '직접 추가',
    unverifiedQ: '확인되지 않은 모델이에요. 그래도 쓸까요?', useAnyway: '쓰기',
    chipVision: '이미지 입력', chipTools: '도구', chipReasoning: '추론', chipLong: '긴 문맥', chipConnected: '연결된 모델만', filters: '필터',
    modelResults: (n) => `모델 ${n}개`, noModelMatch: (q) => `‘${q}’에 맞는 모델이 없어요`, addAsCustom: (q) => `‘${q}’ 직접 추가`,
    useThisModel: '이 모델 쓰기', modelChanged: (r, m) => `${r} 바꿈: ${m}`, sharedAll: '모든 프리셋 공통', sameAsMain: (n) => `주 모델과 같음 · ${n}`,
    fallbackNote: (n) => `앞에서부터 차례로 시도해요. 모델마다 ${n}번 재시도해요.`, blankNext: '빈 답변이면 다음 모델로', retries: '재시도 횟수',
    failKey: 'API 키가 없거나 맞지 않아요', failModel: '고른 모델을 쓸 수 없어요', failQuota: '사용량 한도를 넘었어요', failNetwork: '서비스에 연결하지 못했어요', failServer: '서비스에 문제가 생겼어요',
    fix: '고치기', retry: '다시 시도', fromChat: (r) => `채팅에서 왔어요: ${r}`, backToChat: '채팅으로 돌아가기', backAndRetry: '채팅으로 돌아가 다시 시도', changedRetryQ: '설정을 바꿨어요 · 다시 시도할까요?',
    // mockup-only
    detailTitle: (n) => n, crumbModels: '모델·프리셋', crumbConn: '연결', crumbNav: '현재 위치', backToConn: '연결로 돌아가기', backToConnShort: '연결', backToModels: '모델 설정으로 돌아가기',
    provider: '공급자', providerFixed: '공급자는 바꿀 수 없어요. 다른 공급자를 쓰려면 새 연결을 만들어요.', name: '이름', rename: '이름 바꾸기', duplicateName: '같은 이름이 있어요', nameCount: (n) => `${n}/${NAME_MAX}`,
    key: '키', keyEnvNote: '환경 변수를 써요', staleUndo: '그 뒤에 다른 변경이 있어서 되돌리지 않았어요', urlNeeded: '주소가 필요해요 · http나 https로 시작해요', envUndoNote: '환경 변수 참조는 되돌리면 다시 살아나요', sameAsSub: (n) => `보조 모델과 같음 · ${n}`,
    hiddenRow: (n) => `연결 없는 모델 ${n}개 숨김 · 보기`, hiddenSearch: (n) => `숨긴 모델 ${n}개가 맞아요 · 보기`, otherModel: '다른 모델 고르기', addUse: '연결 추가하고 쓰기', groupMeta: (n, k) => `${n} · 모델 ${k}개`, warnTip: '마지막 확인 결과예요',
    migratedNote: (n) => `프록시 설정을 연결 ${n}개로 옮겼어요`, migratedRename: '이름 바꾸기', migratedClose: '닫기', modelRowLabel: '모델 변경', keyNew: '새 키', keyPaste: '새 키를 붙여 넣으세요', saveKey: '키 저장', cancel: '취소', save: '저장', saveAndTest: '저장하고 확인', close: '닫기', ok: '확인',
    clearKeyQ: '이 연결의 키를 지울까요?', clearKeyBody: '지운 키는 되돌릴 수 없어요.', clearKeyNano: '모델·공급자 선택도 함께 지워져요', clearBtn: '지우기', keyCleared: '키를 지웠어요', keySaved: '키를 저장했어요', keySavedEnv: '환경 변수를 연결했어요',
    url: '주소', format: '요청 형식', tokenizer: '토크나이저', region: '지역', project: '프로젝트 ID', email: '클라이언트 이메일', ollamaFormat: '요청 형식', sub: '구독 사용',
    fOllamaNative: 'Ollama', fOllamaOpenai: 'OpenAI 호환', testRow: '연결 확인', testHelp: '확인을 누를 때만 요청을 한 번 보내요. 저절로 확인하지 않아요.', lastTest: '마지막 확인',
    models: '모델', refreshList: '모델 목록 새로고침', refreshing: '목록을 가져오는 중…', refreshed: (n) => `모델 ${n}개를 찾았어요`, noListApi: '이 공급자는 목록을 가져올 수 없어요', autoFetch: '시작할 때 목록 가져오기', modelCount: (n) => `카탈로그 모델 ${n}개`,
    customModels: '직접 추가한 모델', addModel: '모델 추가', noCustom: '직접 추가한 모델이 없어요', editModel: '모델 고치기', deleteModel: '모델 지우기',
    modelId: '모델 ID (공급자가 쓰는 이름)', modelName: '표시 이름', ctxLen: '문맥 길이 (토큰)', caps: '기능', modelFormat: '요청 형식', customAdded: (n) => `모델을 추가했어요: ${n}`, customEdited: (n) => `모델을 고쳤어요: ${n}`, customDeleted: (n) => `모델을 지웠어요: ${n}`, idNeeded: 'ID를 입력해야 해요', idTaken: '같은 ID가 있어요', pickConn: '연결', labCustomAdd: (n) => `모델 추가 ‘${cl(n)}’`, labCustomEdit: (n) => `모델 고치기 ‘${cl(n)}’`, labCustomDelete: (n) => `모델 지우기 ‘${cl(n)}’`,
    usedList: '사용 중', usedNone: '쓰는 곳이 없어요', openPreset: '프리셋 열기', delConn: '연결 지우기', menuOpen: '열기', menuUp: '위로', menuDown: '아래로', menuDelete: '지우기', menuTest: '확인', menuRename: '이름 바꾸기',
    cardMenu: (n) => `‘${n}’ 연결 메뉴`, moveAnn: (n, i, t) => `‘${n}’ 이동: 연결 ${t}개 중 ${i}번째`, grip: '끌어서 순서 바꾸기', atTop: '맨 위예요', atBottom: '맨 아래예요',
    undoneConn: (n) => `연결을 되돌렸어요: ${n}`, labConnDelete: (n) => `‘${cl(n)}’ 연결 지우기`, labConnAdd: (n) => `‘${cl(n)}’ 연결 추가`, labConnRename: (n) => `‘${cl(n)}’ 연결 이름 바꾸기`, labConnField: (n, f) => `‘${cl(n)}’ 연결 ${f} 바꾸기`, connAdded: (n) => `연결을 추가했어요: ${n}`, connRenamed: (n) => `연결 이름을 바꿨어요: ${n}`,
    addStepProvider: '공급자 고르기', addStepFields: '연결 정보', providerSearch: '공급자 검색', providerNone: '맞는 공급자가 없어요', changeProvider: '공급자 다시 고르기',
    pgCloud: '클라우드', pgRouter: '라우터', pgLocal: '직접 실행', pgCompat: '호환',
    otherServices: '다른 서비스 키', otherServicesNote: '음성·번역·이미지 서비스의 키와 주소는 다음 단계에서 새로 디자인해요 (슬라이스 5)', providerOptions: '공급자별 옵션', providerOptionsNote: '라우팅 같은 공급자별 옵션은 아직 그대로예요 (슬라이스 4에서 정해요)',
    modelsPage: '모델', sub: '보조 모델', perTask: '기능별 모델', fallbackGroup: '대체 모델', fbCount: (n) => n ? `${n}개` : '없음', fbEmpty: '대체 모델이 없어요', fbAdd: '추가', fbRemove: '빼기', fbOpen: '대체 모델 고치기', revert: '되돌리기', revertTip: '주 모델과 같게 되돌리기',
    lockBadge: '모든 프리셋 공통', lockGo: '잠금 스위치로 가기', fbMoved: (n, i, t) => `‘${n}’ 이동: ${t}개 중 ${i}번째`, fbRemoved: (n) => `대체 모델에서 뺐어요: ${n}`, fbAdded: (n) => `대체 모델에 넣었어요: ${n}`, labFb: (r) => `${r} 바꾸기`,
    streaming: '스트리밍', otherSettings: '기타', pickerSearch: '모델 검색', pickerList: '모델 목록', noConnGroup: (n) => `연결 없음 · 모델 ${n}개`, showMore: (n) => `${n}개 더 보기`, keyNeededTip: '키가 필요해요', needsKeyOpen: '연결에서 키 넣기', chooseNoConn: '연결을 만들면 쓸 수 있어요',
    details: '자세히', detailsBack: '목록으로', copyId: 'ID 복사', copied: 'ID를 복사했어요 (모의)', detConn: '연결', detStatus: '상태', detCtx: '문맥 길이', detMaxOut: '최대 출력', detCaps: '기능', detParams: '파라미터', detParamsLink: '파라미터는 슬라이스 4에서', detTok: '토크나이저', detFormat: '요청 형식', detOther: (n) => `기타: ${n}개`, detNone: '알려진 기능이 없어요', detModel: '모델',
    recommendedWhy: '추천 모델', customWhy: '직접 추가한 모델', unverifiedReason: '공급자가 알려 준 모델이라 동작을 확인하지 않았어요', capImg: '이미지 입력', capTools: '도구 사용', capReason: '추론', capImgOut: '이미지 생성', ctxText: (c) => `문맥 ${c}`,
    fixReasonLine: (m) => `‘${m}’ 모델을 이 연결에서 찾을 수 없어요`, fixMark: '고치기', markNoConn: '연결 없음', markNoKey: '키 없음', markKeyAgain: '키 다시 입력 필요', markGone: '모델을 찾을 수 없음',
    fixBannerSaved: '고쳤어요 · 채팅에서 다시 시도해 보세요', fixUnknown: '실패한 모델을 알 수 없어요', sameModelGroup: (n) => `같은 모델 · ${n}`, backAndRetryTip: '자동으로 다시 시도하지 않아요',
    chatStreaming: '답변을 쓰는 중…', retrying: '다시 시도하는 중…', replyOk: '(다시 시도한 답변 · 모의) 달빛이 숲길 위로 다시 내려앉았어요. 세라핀이 등불을 들어 올렸어요.', chipFix: '연결 고치기', chatChipMark: '연결 없음',
    hkTitle: '모델 선택', hkModel: '모델 선택 단축키', hkChange: '단축키 바꾸기', hkCapture: '키를 누르세요 · Esc로 취소', hkNeedMod: 'Ctrl이나 Alt와 함께 눌러 주세요', hkConflict: (k, w) => `${k} 키는 이미 쓰고 있어요: ‘${w}’. 다른 키를 눌러 주세요`, hkSet: (k) => `모델 선택 키를 바꿨어요: ${k}`, hkFirefox: '일부 브라우저는 Ctrl+M을 탭 음소거에 써요',
    acTitle: '자동 완성', demoS3: '연결·모델 데모', demoSet: '데이터 세트', setDemo: '데모', setStress: '많이 (1,500개)', setNone: '연결 없음', setBroken: '고장 난 연결', demoState: '연결·모델 상태', demoGo: '열기', demoFail: '채팅 오류 만들기', demoTestMs: '확인 시간 길게',
    listLabel: '연결 목록', labelModelCard: '모델', toastDismiss: '알림 닫기', resultsLive: (n) => `모델 ${n}개`, expandNone: '펼치기', collapseNone: '접기',
    tipConn: (c) => `연결: ${c}`, ago: { now: '방금', min: (n) => `${n}분 전`, hour: (n) => `${n}시간 전`, yesterday: '어제', day: (n) => `${n}일 전` },
    genKeepsModel: (n) => `쓰는 중인 답변은 ‘${n}’ 모델을 그대로 써요`, plusMore: (n) => `외 ${n}개`, rowsCount: (n) => `${n}개`, secOf: (n) => `${n}`, unknownModel: '알 수 없는 모델',
  },
  en: {
    title: 'Settings slice 3 · connections and models mockup',
    connections: 'Connections', addConn: 'Add connection', noConnections: 'No connections yet. Pick a service and add its key.',
    usedBy: (n) => `Used by ${n} ${n === 1 ? 'preset' : 'presets'}`, notUsed: 'No preset uses it',
    keyMissing: 'No key', keyNeeded: 'Key needed', keyAgain: 'Enter the key again', keyNa: 'No key needed',
    changeKey: 'Replace key', clearKey: 'Remove key', setKey: 'Add key',
    keyLocal: "Keys aren't kept in undo or restore points, and aren't included in exports for sharing. Full backups keep them.", keyNoUndo: "Key changes can't be undone", keysAlwaysHidden: 'API keys are always hidden; only the last 4 characters show',
    test: 'Check', testing: 'Checking…', testCancel: 'Cancel check', testCancelled: 'Check cancelled',
    testOk: (n) => `OK · found ${n} ${n === 1 ? 'model' : 'models'}`, testBadKey: "The key isn't valid", testUnreachable: "Can't connect", testQuota: 'Over the usage limit', notTested: 'Not checked',
    deleteConnQ: (n) => `Delete the "${n}" connection?`, usedHere: 'Used here', andMore: (n) => `and ${n} more`, connDeleted: (n) => `Connection deleted: ${n}`, noConnection: 'No connection',
    pickModel: (r) => `Choose ${r}`, currentModel: 'Current model', recent: 'Recent',
    tagRecommended: 'Recommended', tagUnverified: 'Unverified', tagDeprecated: 'Retiring', tagCustom: 'Added by you',
    unverifiedQ: "This model isn't verified. Use it anyway?", useAnyway: 'Use',
    chipVision: 'Image input', chipTools: 'Tools', chipReasoning: 'Reasoning', chipLong: 'Long context', chipConnected: 'Connected only', filters: 'Filters',
    modelResults: (n) => `${n} ${n === 1 ? 'model' : 'models'}`, noModelMatch: (q) => `No models match "${q}"`, addAsCustom: (q) => `Add "${q}" yourself`,
    useThisModel: 'Use this model', modelChanged: (r, m) => `${r} changed: ${m}`, sharedAll: 'Shared by all presets', sameAsMain: (n) => `Same as main model · ${n}`,
    fallbackNote: (n) => `Tried in order, ${n} retries each`, blankNext: 'Move to the next model on a blank reply', retries: 'Retries',
    failKey: 'The API key is missing or was rejected', failModel: "The selected model isn't available", failQuota: 'The usage limit was reached', failNetwork: "Couldn't reach the service", failServer: 'The service had a problem',
    fix: 'Fix', retry: 'Try again', fromChat: (r) => `From chat: ${r}`, backToChat: 'Back to chat', backAndRetry: 'Back to chat and try again', changedRetryQ: 'Settings changed · Try again?',
    detailTitle: (n) => n, crumbModels: 'Models & presets', crumbConn: 'Connections', crumbNav: 'You are here', backToConn: 'Back to Connections', backToConnShort: 'Connections', backToModels: 'Back to model settings',
    provider: 'Provider', providerFixed: "The provider can't be changed. Create a new connection to use another one.", name: 'Name', rename: 'Rename', duplicateName: 'A connection with this name exists', nameCount: (n) => `${n}/${NAME_MAX}`,
    key: 'Key', keyEnvNote: 'Uses an environment variable', staleUndo: 'Something changed after it, so nothing was undone', urlNeeded: 'An address is required · it starts with http or https', envUndoNote: 'An environment variable reference comes back with Undo', sameAsSub: (n) => `Same as sub model · ${n}`,
    hiddenRow: (n) => `${n} ${n === 1 ? 'model' : 'models'} without a connection hidden · Show`, hiddenSearch: (n) => `${n} hidden ${n === 1 ? 'model matches' : 'models match'} · Show`, otherModel: 'Choose another model', addUse: 'Add a connection and use it', groupMeta: (n, k) => `${n} · ${k} ${k === 1 ? 'model' : 'models'}`, warnTip: 'The result of the last check',
    migratedNote: (n) => `Moved your proxy settings into ${n} ${n === 1 ? 'connection' : 'connections'}`, migratedRename: 'Rename', migratedClose: 'Close', modelRowLabel: 'Model change', keyNew: 'New key', keyPaste: 'Paste the new key', saveKey: 'Save key', cancel: 'Cancel', save: 'Save', saveAndTest: 'Save and check', close: 'Close', ok: 'OK',
    clearKeyQ: 'Remove the key of this connection?', clearKeyBody: "A removed key can't be brought back.", clearKeyNano: 'The model and provider choices are cleared too', clearBtn: 'Remove', keyCleared: 'Key removed', keySaved: 'Key saved', keySavedEnv: 'Environment variable linked',
    url: 'Address', format: 'Request format', tokenizer: 'Tokenizer', region: 'Region', project: 'Project ID', email: 'Client email', ollamaFormat: 'Request format', sub: 'Use subscription',
    fOllamaNative: 'Ollama', fOllamaOpenai: 'OpenAI compatible', testRow: 'Connection check', testHelp: 'One request is sent only when you press Check. Nothing runs by itself.', lastTest: 'Last check',
    models: 'Models', refreshList: 'Refresh model list', refreshing: 'Fetching the list…', refreshed: (n) => `Found ${n} ${n === 1 ? 'model' : 'models'}`, noListApi: "This provider can't list its models", autoFetch: 'Fetch the list at start-up', modelCount: (n) => `${n} catalog ${n === 1 ? 'model' : 'models'}`,
    customModels: 'Models you added', addModel: 'Add model', noCustom: 'No models added yet', editModel: 'Edit model', deleteModel: 'Delete model',
    modelId: 'Model ID (as the provider expects it)', modelName: 'Display name', ctxLen: 'Context length (tokens)', caps: 'Capabilities', modelFormat: 'Request format', customAdded: (n) => `Model added: ${n}`, customEdited: (n) => `Model edited: ${n}`, customDeleted: (n) => `Model deleted: ${n}`, idNeeded: 'Enter an ID', idTaken: 'This ID exists', pickConn: 'Connection', labCustomAdd: (n) => `add model "${cl(n)}"`, labCustomEdit: (n) => `edit model "${cl(n)}"`, labCustomDelete: (n) => `delete model "${cl(n)}"`,
    usedList: 'In use', usedNone: 'Nothing uses it', openPreset: 'Open preset', delConn: 'Delete connection', menuOpen: 'Open', menuUp: 'Move up', menuDown: 'Move down', menuDelete: 'Delete', menuTest: 'Check', menuRename: 'Rename',
    cardMenu: (n) => `Menu for the "${n}" connection`, moveAnn: (n, i, t) => `Moved "${n}": connection ${i} of ${t}`, grip: 'Drag to reorder', atTop: 'Already at the top', atBottom: 'Already at the bottom',
    undoneConn: (n) => `Undid: ${n}`, labConnDelete: (n) => `delete connection "${cl(n)}"`, labConnAdd: (n) => `add connection "${cl(n)}"`, labConnRename: (n) => `rename connection "${cl(n)}"`, labConnField: (n, f) => `change ${f} of "${cl(n)}"`, connAdded: (n) => `Connection added: ${n}`, connRenamed: (n) => `Connection renamed: ${n}`,
    addStepProvider: 'Choose a provider', addStepFields: 'Connection details', providerSearch: 'Search providers', providerNone: 'No matching provider', changeProvider: 'Choose another provider',
    pgCloud: 'Cloud', pgRouter: 'Routers', pgLocal: 'Run locally', pgCompat: 'Compatible',
    otherServices: 'Other service keys', otherServicesNote: 'Keys and addresses of voice, translation and image services are redesigned in the next step (slice 5)', providerOptions: 'Provider options', providerOptionsNote: 'Provider options such as routing are unchanged for now (decided in slice 4)',
    modelsPage: 'Models', sub: 'Sub model', perTask: 'Per-feature models', fallbackGroup: 'Fallback models', fbCount: (n) => n ? `${n}` : 'None', fbEmpty: 'No fallback models', fbAdd: 'Add', fbRemove: 'Remove', fbOpen: 'Edit fallback models', revert: 'Revert', revertTip: 'Go back to the same as the main model',
    lockBadge: 'Shared by all presets', lockGo: 'Go to the lock switch', fbMoved: (n, i, t) => `Moved "${n}": ${i} of ${t}`, fbRemoved: (n) => `Removed from the fallback list: ${n}`, fbAdded: (n) => `Added to the fallback list: ${n}`, labFb: (r) => `change ${r}`,
    streaming: 'Streaming', otherSettings: 'Other', pickerSearch: 'Search models', pickerList: 'Models', noConnGroup: (n) => `No connection · ${n} ${n === 1 ? 'model' : 'models'}`, showMore: (n) => `Show ${n} more`, keyNeededTip: 'A key is needed', needsKeyOpen: 'Add the key in Connections', chooseNoConn: 'Create a connection to use it',
    details: 'Details', detailsBack: 'Back to the list', copyId: 'Copy ID', copied: 'ID copied (simulated)', detConn: 'Connection', detStatus: 'Status', detCtx: 'Context length', detMaxOut: 'Max output', detCaps: 'Capabilities', detParams: 'Parameters', detParamsLink: 'Parameters come in slice 4', detTok: 'Tokenizer', detFormat: 'Request format', detOther: (n) => `Other: ${n}`, detNone: 'No known capabilities', detModel: 'Model',
    recommendedWhy: 'Recommended model', customWhy: 'A model you added', unverifiedReason: 'Listed by the provider; behaviour has not been checked', capImg: 'Image input', capTools: 'Tool use', capReason: 'Reasoning', capImgOut: 'Image generation', ctxText: (c) => `Context ${c}`,
    fixReasonLine: (m) => `This connection can't find the model "${m}"`, fixMark: 'Fix', markNoConn: 'No connection', markNoKey: 'No key', markKeyAgain: 'Enter the key again', markGone: 'Model not found',
    fixBannerSaved: 'Fixed · Try again in the chat', fixUnknown: "We don't know which model failed", sameModelGroup: (n) => `Same model · ${n}`, backAndRetryTip: 'It does not retry by itself',
    chatStreaming: 'Writing the reply…', retrying: 'Trying again…', replyOk: '(Retried reply · simulated) Moonlight settled over the forest road again. Seraphina raised her lantern.', chipFix: 'Fix the connection', chatChipMark: 'No connection',
    hkTitle: 'Select model', hkModel: 'Model shortcut', hkChange: 'Change shortcut', hkCapture: 'Press a key · Esc to cancel', hkNeedMod: 'Press it together with Ctrl or Alt', hkConflict: (k, w) => `${k} is already used: "${w}". Press another key`, hkSet: (k) => `Model shortcut is now ${k}`, hkFirefox: 'Some browsers use Ctrl+M to mute the tab',
    acTitle: 'Autocomplete', demoS3: 'Connections and models demo', demoSet: 'Data set', setDemo: 'Demo', setStress: 'Stress (1,500)', setNone: 'No connections', setBroken: 'Broken connections', demoState: 'Connections / models state', demoGo: 'Open', demoFail: 'Make a chat error', demoTestMs: 'Long check time',
    listLabel: 'Connection list', labelModelCard: 'Model', toastDismiss: 'Dismiss notice', resultsLive: (n) => `${n} ${n === 1 ? 'model' : 'models'}`, expandNone: 'Expand', collapseNone: 'Collapse',
    tipConn: (c) => `Connection: ${c}`, ago: { now: 'just now', min: (n) => `${n} min ago`, hour: (n) => `${n} h ago`, yesterday: 'yesterday', day: (n) => `${n} days ago` },
    genKeepsModel: (n) => `The reply being written keeps "${n}"`, plusMore: (n) => `and ${n} more`, rowsCount: (n) => `${n}`, secOf: (n) => `${n}`, unknownModel: 'Unknown model',
  },
};
const t3 = (k, ...a) => { const v = K[lang()][k]; return typeof v === 'function' ? v(...a) : v; };
const ROWSHORT = (r) => (r.short ? r.short[KO() ? 0 : 1] : (KO() ? r.ko : r.en));
const RLABEL = (id) => A.L(A.ROW[id]);

/* ------------------------------------------------------------------ state */
const CFG3 = { testMs: 1400, refreshMs: 700, chunk: 32, schunk: 20, recents: 5, gcap: 8, collapseAt: 8 };   // gcap: rows a connection group shows before its own "{n}개 더 보기"; collapseAt: more connection groups than this start collapsed (R-04)
const S3 = {
  view: 'section',            // section | conn | fb   (models page sub-views, like slice 2's library)
  conn: null, fb: null, keyEdit: null, renaming: null,
  fix: null,                  // { fix, conn, msg, reason, saved, row, model }
  mp: null, testing: {}, seq: 1, ver: 1, lockOpen: false,
  chips: { vision: false, tools: false, reasoning: false, long: false, connected: null },
  recents: ['gpt-5-mini', 'claude-haiku-45', 'gemini-25-flash', 'gpt-41', 'llama-local-8b'].map(D3.pairOf),
  asked: new Set(), noneOpen: false, cardRv: null, fbRv: null, failNext: null, hotkeyCapturing: null, replies: {}, undoHold: 0, resume: null, navHook: null, chatRow: null, migrated: SET3 === 'migrated' ? ['c-company', 'c-home', 'c-team'] : null,
};
const perf3 = { open: [], key: [], render: [] };
const bump = () => { S3.ver++; };
const cx = (id) => CX.find((c) => c.id === id) || null;
const MODELS = () => A.MODEL;
const mname = (m) => A.mn(m);
const modelById = (id) => MODELS()[id] || null;
const baseOf = (m) => m.base || m.id;                                  // the provider's own model id (a clone is the same model under another connection: id = connection::base)
const refOf = (connId, baseId) => { const k = connId + '::' + baseId; if (A.MODEL[k]) return k; const m = A.MODEL[baseId]; return m && m.conn === connId ? baseId : null; };   // (connection, model) -> the value a preset stores (DS-054)
const provLabel = (p) => (KO() ? PROV[p].ko : PROV[p].en);
const fmtCtx = (n) => (n >= 1000000 ? (n / 1000000 === Math.round(n / 1000000) ? n / 1000000 + 'M' : (n / 1000000).toFixed(1) + 'M') : n >= 1000 ? Math.round(n / 1000) + 'K' : String(n));
const isEnv = (k) => /^\$\{[A-Za-z0-9_]+\}$/.test(k || '');
const keyNeeds = (c) => PROV[c.provider].key === 'key';
const hasKey = (c) => !!KEYS[c.id];
const last4 = (c) => (KEYS[c.id] || '').slice(-4);
function keyInfo(c) {
  const k = KEYS[c.id] || '';
  if (!k) { if (c.keyState === 'again') return { kind: 'again', text: t3('keyAgain') }; return keyNeeds(c) ? { kind: 'none', text: t3('keyMissing') } : { kind: 'na', text: t3('keyNa') }; }
  if (isEnv(k)) return { kind: 'env', text: k };
  return { kind: 'set', text: '•••• ' + k.slice(-4), l4: k.slice(-4) };
}
function fmtAgo(at) {
  const a = K[lang()].ago; const m = Math.max(0, Math.round((Date.now() - at) / 60000));
  if (m < 1) return a.now; if (m < 60) return a.min(m); const h = Math.round(m / 60); if (h < 24) return a.hour(h); const d = Math.round(h / 24); return d === 1 ? a.yesterday : a.day(d);
}
const TASK_IDS = ['models.memModel', 'models.transModel', 'models.emoModel', 'models.suggestModel', 'models.otherModel'];
const SUB_FIRST = ['models.emoModel', 'models.suggestModel'];   // DS-051: unset 감정 이미지 and 자동 제안 use the sub model; the others use the main model
const FB_IDS = ['models.fallbackModel', 'models.fallbackMem', 'models.fallbackTrans', 'models.fallbackEmo', 'models.fallbackOther'];
const MODEL_ROW_IDS = ['models.mainModel', 'models.subModel'].concat(TASK_IDS);
const fbList = (id, p) => { const v = p ? B.effVal(p, id) : A.ROW[id].v; return String(v || '').split(',').filter(Boolean); };
const valOf = (id, p) => (p ? B.effVal(p, id) : A.ROW[id].v);
const inherits = (id, p) => { if (valOf(id, p) || !TASK_IDS.includes(id)) return null; return SUB_FIRST.includes(id) && valOf('models.subModel', p) ? 'sub' : 'main'; };
const resolved = (id, p) => { const v = valOf(id, p); if (v) return v; if (SUB_FIRST.includes(id)) { const sv = valOf('models.subModel', p); if (sv) return sv; } return valOf('models.mainModel', p); };   // what will actually run (DS-044, DS-051)
const inheritText = (id, name) => t3(inherits(id) === 'sub' ? 'sameAsSub' : 'sameAsMain', name);
const retriesN = () => A.ROW['adv.retries'].v;

/* ------------------------------------------------------------------ problems and marks (DS-043, SPEC 6.3): why a model cannot be used right now */
function problemOfConn(c) {
  if (!c) return { code: 'noConn' };
  if (keyNeeds(c) && !hasKey(c)) return { code: c.keyState === 'again' ? 'keyAgain' : 'noKey', conn: c.id };
  const t = c.test; if (t && t.res !== 'ok') return { code: t.res, conn: c.id };
  return null;
}
function problem(modelId) {
  const m = modelById(modelId); if (!m) return { code: 'gone' };
  const c = m.conn ? cx(m.conn) : null;
  if (!c) return { code: 'noConn', prov: m.pid };
  const p = problemOfConn(c); if (p) return p;
  if (m.gone) return { code: 'modelGone', conn: c.id };
  return null;
}
function probText(p) {
  if (!p) return '';
  return { noConn: t3('markNoConn'), noKey: t3('markNoKey'), keyAgain: t3('markKeyAgain'), badkey: t3('testBadKey'), unreachable: t3('testUnreachable'), quota: t3('testQuota'), modelGone: t3('markGone'), gone: t3('unknownModel') }[p.code] || '';
}
function probFix(p) { return p && (p.code === 'modelGone' ? 'model' : p.code === 'noConn' || p.code === 'gone' ? 'add' : 'key'); }
const markHTML = (p, cls = '') => (p ? `<span class="c3-mark ${cls}" data-code="${esc(p.code)}">${ic('circle-alert', 'sm')}<span>${esc(probText(p))}</span></span>` : '');
function rowProblem(id, p) { const mid = resolved(id, p); return mid ? problem(mid) : null; }
function presetProblem(p) { const pr = [problem(B.effVal(p, 'models.mainModel'))]; MODEL_ROW_IDS.slice(1).concat(FB_IDS).forEach((id) => { const v = B.effVal(p, id); if (!v) return; String(v).split(',').filter(Boolean).forEach((mid) => pr.push(problem(mid))); }); return pr.find(Boolean) || null; }

/* who uses a connection (DS-049): presets by their effective values, with the rows that point at it */
function usersOf(connId) {
  const out = []; const usedBy = (mid) => { const m = modelById(mid); return !!m && m.conn === connId; };
  D.presets.forEach((p) => {
    const rows = [];
    if (usedBy(B.effVal(p, 'models.mainModel'))) rows.push('models.mainModel');
    if (usedBy(B.effVal(p, 'models.subModel'))) rows.push('models.subModel');
    TASK_IDS.forEach((id) => { const v = B.effVal(p, id); if (v && usedBy(v)) rows.push(id); });
    FB_IDS.forEach((id) => { if (fbList(id, p).some(usedBy)) rows.push(id); });
    if (rows.length) out.push({ p, rows });
  });
  return out;
}
const refLabel = (id) => { const r = A.ROW[id]; return FB_IDS.includes(id) ? t3('fallbackGroup') + ': ' + ROWSHORT(r) : ROWSHORT(r); };
const presetsUsing = (connId) => usersOf(connId).length;

/* ------------------------------------------------------------------ connections: operations (keys never enter undo, restore points or exports: DS-027, DS-047) */
const nameTaken = (name, exceptId) => CX.some((c) => c.id !== exceptId && c.name.trim().toLowerCase() === name.trim().toLowerCase());
function uniqueName(base) { if (!nameTaken(base)) return base; let i = 2; while (nameTaken(base + ' ' + i)) i++; return base + ' ' + i; }
function refreshIndexData() {
  D.connections.length = 0;
  CX.forEach((c) => { D.connections.push({ id: c.id, name: c.name, en: c.name, row: 'models.cx.' + c.id, kw: c.kw }); ensureCxRow(c); });
  D.models.forEach((m) => { if (m.kw0 === undefined) m.kw0 = m.kw || ''; const c = m.conn ? cx(m.conn) : null; m.kw = (m.kw0 + ' ' + (c ? c.name : '')).trim(); });   // the connection name is a search synonym of its models
  bump(); if (A.S.open) A.buildIndex();
}
function ensureCxRow(c) {
  const id = 'models.cx.' + c.id; if (A.ROW[id]) { A.ROW[id].ko = A.ROW[id].en = c.name; return; }
  const r = { type: 'note', id, sec: 'models.connections', page: 'models', ko: c.name, en: c.name, cxRow: c.id };
  Object.defineProperty(r, 'v', { configurable: true, enumerable: true, get() { return hasKey(c) || !keyNeeds(c); } });
  A.ROW[id] = r;
}
function patchRows(root, ids, htmlOf, sel) {   // replace only the rows whose markup changed, keeping their neighbours (and the focus) in place
  ids.forEach((id) => {
    const el = $(sel(id), root); if (!el) return; const tmp = document.createElement('div'); tmp.innerHTML = htmlOf(id); const nu = tmp.firstElementChild; if (!nu || nu.outerHTML === el.outerHTML) return;
    const had = el.contains(document.activeElement); const fk = had && document.activeElement.dataset ? (document.activeElement.dataset.c3 || '') : ''; el.replaceWith(nu);
    if (had) { const f = (fk && $(`[data-c3="${fk}"]`, nu)) || $('[data-ctl]', nu); if (f) f.focus({ preventScroll: true }); }
  });
}
function repaintModels() {
  const sc = $('#pageScroll'); if (!sc || !$('#sec-models\\.models', sc)) return;
  patchRows(sc, MODEL_ROW_IDS, modelRowHTML, (id) => `[data-row="${CSS.escape(id)}"].c3-mrow`); patchRows(sc, FB_IDS, fbRowHTML, (id) => `[data-row="${CSS.escape(id)}"].c3-fbrow`);
}
function repaintConnList() {
  const sc = $('#pageScroll'); const sec = sc && $('#sec-models\\.connections .rows', sc); if (!sec) return;
  const ul = $('#c3Cx', sec); const same = !!ul && CX.length > 0 && $$('.c3-card', ul).map((e) => e.dataset.cx).join() === CX.map((c) => c.id).join();
  if (same) { patchRows(sc, CX.map((c) => c.id), (id) => cardHTML(cx(id), CX.indexOf(cx(id))), (id) => `.c3-card[data-cx="${CSS.escape(id)}"]`); return; }
  const had = sec.contains(document.activeElement); const fk = had && document.activeElement.dataset ? (document.activeElement.dataset.c3 || '') : '';
  sec.innerHTML = connListBody(); const cards = $$('[data-cxrv]', sec); if (cards.length) { const cur = cards.find((e) => e.dataset.cx === S3.cardRv) || cards[0]; cards.forEach((e) => { e.tabIndex = e === cur ? 0 : -1; }); }
  if (had) { const f = (fk && $(`[data-c3="${fk}"]`, sec)) || $('[data-cxrv]', sec) || $('[data-c3="add"]', sec); if (f) f.focus({ preventScroll: true }); }
}
function repaintAll(focusSel) {
  paintMarks(); refreshFixState(); if (!A.S.open) return;
  if (S3.view === 'conn' && !cx(S3.conn)) S3.view = 'section';
  if (S3.view === 'section') { if (A.S.page === 'models') { repaintModels(); repaintConnList(); } }
  else { const k = $('#c3KeyIn'); const kv = k ? k.value : ''; const kf = !!k && document.activeElement === k; A.refreshPage(); const k2 = $('#c3KeyIn'); if (k2 && kv) { k2.value = kv; if (kf) k2.focus({ preventScroll: true }); const sv = $('[data-c3="keysave"]'); if (sv) sv.setAttribute('aria-disabled', 'false'); } }   // a partly typed key stays in its field (N-15)
  if (focusSel) { const e = $(focusSel); if (e) e.focus({ preventScroll: true }); }
}
function cloneCatalog(c) {   // DS-054: a further connection of a provider lists the whole catalog too (the same models, keyed (connection, model))
  const ids = []; D3.catalogOf(c.provider).forEach((m) => { const k = D3.mkClone(m, c); D.models.push(k); A.MODEL[k.id] = k; ids.push(k.id); }); return ids;
}
const REL_ROWS = () => MODEL_ROW_IDS.concat(FB_IDS, ['models.fallbackBlank', 'adv.retries']);
function relSig() {   // everything that can alter the failing request: keys (as hashes), addresses and formats, options, model rows, fallbacks, custom models, the connections themselves
  return JSON.stringify([CX.map((c) => [c.id, c.url, c.format, c.tokenizer, c.region, c.project, c.email, c.ollamaFormat, c.sub, c.autoFetch, D3.hash(KEYS[c.id] || ''), c.opts || null]), REL_ROWS().map((id) => (A.ROW[id] ? A.ROW[id].v : null)), D.models.filter((m) => m.custom).map((m) => m.id + ':' + m.ctx + ':' + m.format)]);
}
function fixChanged() { const f = S3.fix; return !!f && f.sig0 !== undefined && f.sig0 !== relSig(); }
function refreshFixState() { const f = S3.fix; if (!f) return; const now = fixChanged(); if (now !== f.saved) { f.saved = now; refreshBanner(); } }
function markChanged() { refreshFixState(); }   // R-14 / DS-055 / N-01: any relevant change turns the banner; undoing it turns it back
function refreshBanner() {
  const pg = $('#pageScroll .pg'); if (!pg || !S3.fix) return; const old = $('.c3-fixbanner', pg); const had = !!old && old.contains(document.activeElement);
  injectBanner(pg); if (had) { const bb = $('.c3-fixbanner [data-c3="backchat"]'); if (bb) bb.focus({ preventScroll: true }); }
}
function addConn({ provider, name, fields = {}, key = '' }) {
  const P = PROV[provider]; const id = 'c-n' + (S3.seq++);
  const c = Object.assign({ id, name: String(name || '').trim().slice(0, NAME_MAX) || uniqueName(provLabel(provider)), provider, url: '', format: 'openai', tokenizer: 'auto', region: 'global', project: '', email: '', ollamaFormat: 'native', sub: false, autoFetch: false, test: null, simForce: '', keyState: key ? 'set' : (P.key === 'key' ? 'none' : 'na'), models: 0, kw: '' }, fields);
  c.kw = (P.kw || '') + ' ' + c.name; CX.push(c); KEYS[id] = key || '';
  const made = cloneCatalog(c); c.models = D.models.filter((m) => m.conn === id).length;
  refreshIndexData(); markChanged();
  const e = B.pushLU(t3('labConnAdd', c.name), () => { const cc = cx(id); if (!cc) return ''; const i = CX.indexOf(cc); CX.splice(i, 1); delete KEYS[id]; D.models.forEach((m) => { if (made.includes(m.id)) m.conn = null; }); refreshIndexData(); if (S3.view === 'conn' && S3.conn === id) S3.view = 'section'; repaintAll(); return ''; }, 'conn-add', { conn: id });
  B.psToast(t3('connAdded', c.name), { kind: 'conn-add', until: 'page', action: luAct(e) }); B.announce(t3('connAdded', c.name));
  repaintAll(); return c;
}
const luAct = (e, stale) => ({ label: B.t2('undo'), title: B.t2('undo') + ' (Alt+Z)', fn: () => { if (stale && stale()) { const i = B.LU.indexOf(e); if (i >= 0) B.LU.splice(i, 1); B.announce(t3('staleUndo')); return; } B.runLU(e.id); } });   // R-11: a toast undoes exactly the change it names, or nothing
function setField(c, field, value, label) {
  const old = c[field]; if (old === value) return false; const oldTest = c.test, oldForce = c.simForce;
  c[field] = value; if (field === 'url') { cancelTest(c.id, true); c.test = null; c.simForce = ''; }   // R-12: a check that is still running must not land on the new address
  if (field !== 'name') markChanged();
  if (field === 'name') { c.kw = (PROV[c.provider].kw || '') + ' ' + value; refreshIndexData(); }
  const lab = field === 'name' ? t3('labConnRename', old) : t3('labConnField', c.name, label || field);
  B.pushLU(lab, () => { const cc = cx(c.id); if (!cc) return ''; cc[field] = old; if (field === 'url') { cc.test = oldTest; cc.simForce = oldForce; } if (field === 'name') { cc.kw = (PROV[cc.provider].kw || '') + ' ' + old; refreshIndexData(); } repaintAll(); return ''; }, 'conn-edit', { conn: c.id, field });
  paintMarks(); return true;
}
function setKey(c, value) {   // no undo entry, no history, no restore point: the key is only ever in KEYS (DS-027)
  const v = String(value || '').trim(); if (!v) return false;
  cancelTest(c.id, true); KEYS[c.id] = v; c.keyState = 'set'; c.test = null; c.simForce = ''; c.fixSaved = true; markChanged();   // R-12: a running check is cancelled, its result never lands on the new key
  bump(); paintMarks(); return true;
}
function clearKey(c) {
  cancelTest(c.id, true); markChanged(); KEYS[c.id] = ''; c.keyState = keyNeeds(c) ? 'none' : 'na'; c.test = null; c.simForce = '';
  if (c.provider === 'nanogpt') { c.sub = false; c.autoFetch = false; clearSelectionsOf(c.id); }   // the side effect is announced in the dialog first
  bump(); paintMarks();
}
function clearSelectionsOf(connId) {   // NanoGPT: the model choices that pointed at it are cleared too (per-task rows and fallback entries)
  const usedBy = (mid) => { const m = modelById(mid); return !!m && m.conn === connId; };
  TASK_IDS.forEach((id) => { const v = A.ROW[id].v; if (v && usedBy(v)) setRowValue(id, ''); });
  FB_IDS.forEach((id) => { const l = fbList(id); const n = l.filter((x) => !usedBy(x)); if (n.length !== l.length) setRowValue(id, n.join(',')); });
}
function planOf(c) {
  const P = PROV[c.provider], k = KEYS[c.id] || '';
  if (P.key === 'key' && !k) return 'badkey';
  if (c.simForce) return c.simForce;
  if (/bad|invalid/i.test(k)) return 'badkey';
  if (/quota|limit/i.test(k)) return 'quota';
  if (P.url && (!c.url || /down|dead|unreach|home\./i.test(c.url))) return 'unreachable';
  return 'ok';
}
function startTest(c, ms) {   // DS-046: only on demand; a timer stands in for the request
  if (S3.testing[c.id]) return false;
  const dur = ms === undefined ? (+Q.get('testms') || CFG3.testMs) : ms; const t0 = Date.now();
  S3.testing[c.id] = { t: setTimeout(() => finishTest(c.id), dur), t0 };
  paintConn(c.id); B.announce(t3('testing') + ' ' + c.name); return true;
}
function finishTest(id) {
  const c = cx(id), st = S3.testing[id]; delete S3.testing[id]; if (!c || !st) return;
  const res = planOf(c); const h = D3.hash(c.id) % 700;
  c.test = { res, at: Date.now(), n: res === 'ok' ? Math.max(1, c.models) : 0, ms: res === 'ok' ? 140 + h : res === 'quota' ? 90 + (h % 200) : 0 };
  bump(); paintConn(id); paintMarks();
  B.announce(testText(c)); if (A.S.open) { const e = $(`#c3Test [data-c3="test"]`); void e; }
}
function cancelTest(id, quiet) { const st = S3.testing[id]; if (!st) return false; clearTimeout(st.t); delete S3.testing[id]; paintConn(id); B.announce(t3('testCancelled')); void quiet; return true; }
const testText = (c) => { const t = c.test; if (!t) return t3('notTested'); return { ok: t3('testOk', t.n), badkey: t3('testBadKey'), unreachable: t3('testUnreachable'), quota: t3('testQuota') }[t.res]; };
const testShort = (c) => { if (S3.testing[c.id]) return t3('testing'); const t = c.test; if (!t) return t3('notTested'); return testText(c) + ' · ' + fmtAgo(t.at); };

/* delete (DS-049): users listed first; the undo brings back the connection, its custom models and every reference, without the key */
function deleteConn(id) {
  const c = cx(id); if (!c) return null; const idx = CX.indexOf(c);
  const users = usersOf(id); const bound = [], customs = []; const envKey = isEnv(KEYS[id]) ? KEYS[id] : '';   // DS-058: a ${NAME} reference is a name, not a secret: it comes back with undo
  const snap = Object.assign({}, c, { test: c.test ? Object.assign({}, c.test) : null });   // the key is NOT in the snapshot
    D.models.slice().forEach((m) => { if (m.conn !== id) return; if (m.custom) { customs.push({ m, i: D.models.indexOf(m) }); D.models.splice(D.models.indexOf(m), 1); m.conn = null; } else { bound.push(m.id); m.conn = null; } });
  cancelTest(id, true); markChanged(); CX.splice(idx, 1); delete KEYS[id];
  if (S3.view === 'conn' && S3.conn === id) S3.view = 'section';
  refreshIndexData();
  const e = B.pushLU(t3('labConnDelete', c.name), () => {
    if (cx(id)) return '';
    const back = Object.assign({}, snap, { keyState: envKey ? 'set' : (keyNeeds(snap) ? 'again' : 'na'), test: null }); /* N-04: the result of the old key is not the new state's */ CX.splice(Math.min(idx, CX.length), 0, back); KEYS[id] = envKey;
    bound.forEach((mid) => { const m = modelById(mid); if (m) m.conn = id; });
    customs.slice().sort((a, b) => a.i - b.i).forEach(({ m, i }) => { m.conn = id; D.models.splice(Math.min(i, D.models.length), 0, m); });
    refreshIndexData(); paintMarks();
    if (A.S.open) { repaintAll(); if (S3.view === 'section' && A.S.page === 'models' && !A.inTextField(document.activeElement)) focusCard(id); }   // DS-057 / N-05: undo stays where you are; focus is on the restored card, which says 키 다시 입력 필요, and the toast offers 키 넣기
    setTimeout(() => { const l = B.S2.lastLU; if (!l || !cx(id)) return; const need = keyNeeds(back) && !KEYS[id]; B.psToast(l.msg, { kind: 'lu-undo', action: need ? { label: t3('setKey'), title: t3('setKey') + ': ' + back.name, fn: () => openConn(id, { keyReplace: true, noAnim: true }) } : undefined }); }, 0);
    return '';
  }, 'conn-delete', { conn: id });
  B.psToast(t3('connDeleted', c.name), { kind: 'conn-delete', until: keyNeeds(c) ? 'conn' : 'page', action: luAct(e) }); B.announce(t3('connDeleted', c.name));
  S3.lastDelete = { id, users: users.length, entry: e };
  repaintAll(); return S3.lastDelete;
}

/* custom models (DS-048) */
function addCustom(connId, o) {
  const c = cx(connId); if (!c) return null; const id = o.id.trim();
  if (!id || D.models.some((m) => m.id === id)) return null;
  const caps = o.caps || [];
  const m = { id, name: o.name.trim() || id, en: o.name.trim() || id, prov: PROV[c.provider].en, provEn: PROV[c.provider].en, kw: '', params: ['temperature', 'top_p', 'top_k', 'min_p'], pid: c.provider, conn: connId, ctx: +o.ctx || 8000, maxOut: 8192, flags: ['stream', 'sysprompt'].concat(caps), xflags: [], custom: true, status: 'custom', format: o.format || (c.provider === 'compat' ? c.format : D3.FMT_NAME && 'openai'), tokenizer: 'auto', g: 'local' };
  D.models.push(m); A.MODEL[id] = m; c.models = D.models.filter((x) => x.conn === connId).length; refreshIndexData();
  B.pushLU(t3('labCustomAdd', m.name), () => { const mm = modelById(id); if (!mm) return ''; D.models.splice(D.models.indexOf(mm), 1); delete A.MODEL[id]; refreshIndexData(); repaintAll(); return ''; }, 'model-add', { model: id });
  return m;
}
function editCustom(id, o) {
  const m = modelById(id); if (!m || !m.custom) return false; const old = { name: m.name, ctx: m.ctx, flags: m.flags.slice(), format: m.format };
  m.name = m.en = o.name.trim() || m.id; m.ctx = +o.ctx || m.ctx; m.flags = ['stream', 'sysprompt'].concat(o.caps || []); if (o.format) m.format = o.format; refreshIndexData();
  B.pushLU(t3('labCustomEdit', m.name), () => { Object.assign(m, { name: old.name, en: old.name, ctx: old.ctx, flags: old.flags, format: old.format }); refreshIndexData(); repaintAll(); return ''; }, 'model-edit', { model: id });
  return true;
}
function deleteCustom(id) {
  const m = modelById(id); if (!m || !m.custom) return false; const i = D.models.indexOf(m);
  D.models.splice(i, 1); const cn = m.conn; refreshIndexData();
  B.pushLU(t3('labCustomDelete', m.name), () => { if (modelById(id) && D.models.includes(m)) return ''; m.conn = cn; D.models.splice(Math.min(i, D.models.length), 0, m); A.MODEL[id] = m; refreshIndexData(); repaintAll(); return ''; }, 'model-delete', { model: id });
  return true;
}

/* ------------------------------------------------------------------ writing a model choice into the active preset (slice 2's live save, undo stack and locks do the rest) */
function setRowValue(id, v) { const r = A.ROW[id]; r.v = v; X.rowChanged(r); }   // slice 2's hook: coalesced history step, shared (locked) value, save status, chip
const ambiguous = (m) => !!m && !!m.conn && CX.filter((c) => c.provider === m.pid).length > 1;   // the same model name is offered by more than one connection
const mlabel = (m) => (ambiguous(m) ? mname(m) + ' · ' + connOf(m).name : mname(m));
function modelsText(v) { const l = String(v || '').split(',').filter(Boolean); return l.map((x) => { const m = modelById(x); return m ? mlabel(m) : x; }).join(', '); }
function commitModel(rowId, nv, o = {}) {
  const r = A.ROW[rowId]; const from = r.v; if (from === nv) return false;
  const shared = B.isShared(rowId); const p0 = B.act(); setRowValue(rowId, nv); markChanged();
  const lab = t3('labFb', A.L(r)); const stale = () => A.S.presetActive !== p0.id || A.ROW[rowId].v !== nv;
  const e = B.pushLU(lab, () => {   // Alt+Z reaches model changes through the library stack (DS-024/036); the preset history step is taken back with it
    if (stale()) { setTimeout(() => B.undoLast(), 0); return ''; }   // stale: Ctrl+Z (the preset's own history) or a preset switch got there first, so this entry is skipped and Alt+Z undoes the next one
    const p = B.act(); const st = p.undo[p.undo.length - 1];
    if (!B.isShared(rowId) && st && !st.bulk && st.id === rowId && st.to === nv) B.doUndo(); else setRowValue(rowId, from);
    repaintAll(); return '';
  }, 'model', { row: rowId });
  const shown = o.text || modelsText(nv) || inheritText(rowId, modelsText(resolved(rowId)));
  const msg = t3('modelChanged', FB_IDS.includes(rowId) ? `${ROWSHORT(r)} (${t3('fallbackGroup')})` : A.L(r), shown) + (shared ? ' · ' + t3('sharedAll') : '');
  const gen = B.S2.gen ? t3('genKeepsModel', modelsText(from) || t3('unknownModel')) : '';   // DS-029: the reply being written keeps the model it started with
  S3.modelToast = { rowId, nv, id: e.id };
  if (!A.S.open && $('#oDraft')) chatConfirm(msg, e, stale);   // DD-130: in the chat the confirmation is an inline row above the input, not a floating toast
  else { B.psToast(msg, { kind: 'model', until: 'page', action: luAct(e, stale), sub: gen }); B.announce(msg + (gen ? '. ' + gen : '')); }
  repaintAll(); return e;
}
function chatRowEl() { const d = $('#oDraft'); if (!d) return null; let r = $('.c3-modelrow'); if (!r) { r = document.createElement('div'); r.className = 'c3-modelrow'; r.setAttribute('data-part', 'settings-chat-status-row'); r.setAttribute('role', 'status'); r.hidden = true; const comp = d.parentElement; comp.parentElement.insertBefore(r, comp); } return r; }
function chatConfirm(msg, e, stale) {   // DD-130 / DD-131: the switch is confirmed by an inline status row with a reachable 실행 취소; Alt+Z undoes it too
  const r = chatRowEl(); if (!r) return; clearTimeout(S3.chatRowT); S3.chatRow = { e, stale };
  r.hidden = false; r.innerHTML = `<span class="c3-mrtext">${esc(msg)}</span><button type="button" data-part="settings-button" class="btn solid" data-c3="rowundo" title="${esc(B.t2('undo') + ' (Alt+Z)')}">${ic('rotate-ccw', 'md')}<span>${esc(B.t2('undo'))}</span></button>`;
  B.announce(msg); S3.chatRowT = setTimeout(hideChatRow, 14000);
}
function hideChatRow() { clearTimeout(S3.chatRowT); S3.chatRow = null; const r = $('.c3-modelrow'); if (r) { r.hidden = true; r.innerHTML = ''; } }
function undoChatRow() {
  const cr = S3.chatRow; if (!cr) return false; if (cr.stale()) { hideChatRow(); B.announce(t3('staleUndo')); return true; }
  B.runLU(cr.e.id); B.hideToast(); const m = B.S2.lastLU && B.S2.lastLU.msg; const r = chatRowEl(); S3.chatRow = null; if (r && m) { r.hidden = false; r.innerHTML = `<span class="c3-mrtext">${esc(m)}</span>`; S3.chatRowT = setTimeout(hideChatRow, 6000); }
  const d = $('#oDraft'); if (d && document.activeElement && document.activeElement.closest && document.activeElement.closest('.c3-modelrow')) d.focus({ preventScroll: true }); return true;
}
function pushRecent(mid) { S3.recents = [mid].concat(S3.recents.filter((x) => x !== mid)).slice(0, 8); }

/* ------------------------------------------------------------------ the model picker (DS-042, DS-045, DS-050) */
const JAMO = /^[ㄱ-ㅎ]+$/;
const CAP_ICONS = [['vision', 'eye', 'capImg'], ['tools', 'wrench', 'capTools'], ['reasoning', 'brain', 'capReason'], ['imgout', 'image', 'capImgOut']];
const capIc = (n) => `<svg class="ic ic-mark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><use href="#c3i-${n}"/></svg>`;   // one <use> per icon: the capability icons are the most repeated nodes in the list
function capsHTML(m) {
  const fl = m.flags; const on = []; for (let i = 0; i < 4; i++) if (fl.indexOf(CAP_ICONS[i][0]) >= 0) on.push(CAP_ICONS[i]);
  if (!on.length) return '';
  return `<span class="mp-caps" aria-hidden="true">${on.map((c) => capIc(c[1])).join('')}</span><span class="sr-only">${esc(on.map((c) => t3(c[2])).join(', '))}</span>`;
}
function sprite() {
  if (document.getElementById('c3Sprite')) return; const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.id = 'c3Sprite'; s.setAttribute('width', '0'); s.setAttribute('height', '0'); s.setAttribute('aria-hidden', 'true'); s.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
  s.innerHTML = '<defs>' + CAP_ICONS.map((c) => '<symbol id="c3i-' + c[1] + '" viewBox="0 0 24 24">' + (ICONS3[c[1]] || A.ICONS[c[1]] || '') + '</symbol>').join('') + '</defs>'; document.body.appendChild(s);
}
const connOf = (m) => (m && m.conn ? cx(m.conn) : null);
function mIdx(m) {
  if (m._iv === S3.ver) return m;
  const c = connOf(m); m._h = A.normWord([m.name, m.en || '', baseOf(m), m.prov, m.kw || '', c ? c.name : ''].join(' '));
  let cc = ''; for (let i = 0; i < m._h.length; i++) cc += A.cho(m._h[i]); m._ch = cc; m._iv = S3.ver; m._F = null; return m;
}
function mF(m) { if (m._F) return m._F; const c = connOf(m); m._F = { name: A.mf(m.name + ' ' + (m.en || '')), id: A.mf(baseOf(m)), conn: A.mf(c ? c.name : ''), prov: A.mf(m.prov + ' ' + (m.kw || '')) }; return m._F; }
function rankModel(m, words) {
  const F = mF(m); let worst = 0, sum = 0;
  for (const w of words) {
    let best = 99; const one = w.length === 1 && !JAMO.test(w);
    let r = A.mw(F.name, w); if (r && !(one && r.r > 2)) best = r.r;
    if (best > 0) { r = A.mw(F.id, w); if (r && r.r <= 2 && 4 + r.r < best) best = 4 + r.r; }
    if (best > 0) { r = A.mw(F.conn, w); if (r && r.r <= 2 && 7 + r.r < best) best = 7 + r.r; }
    if (best > 0) { r = A.mw(F.prov, w); if (r && r.r <= 2 && 10 + r.r < best) best = 10 + r.r; }
    if (best === 99) return null;
    if (best > worst) worst = best; sum += best;
  }
  return { worst, sum };
}
function chipOn(k) { return k === 'connected' ? (S3.chips.connected === null ? CX.length > 0 : S3.chips.connected) : !!S3.chips[k]; }
function passOther(m) {
  if (chipOn('vision') && !m.flags.includes('vision')) return false;
  if (chipOn('tools') && !m.flags.includes('tools')) return false;
  if (chipOn('reasoning') && !m.flags.includes('reasoning')) return false;
  if (chipOn('long') && !(m.ctx >= 128000)) return false;
  return true;
}
function passChips(m) { return passOther(m) && !(chipOn('connected') && !connOf(m)); }
const provHas = () => new Set(CX.map((c) => c.provider));
const unlisted = (m, PH) => !connOf(m) && (!!m.clone || !!m.custom || PH.has(m.pid));   // a model with no connection is listed only while its provider has none (an orphan whose provider has another connection is that connection's model)
let COLL = null, COLLL = '';
const collator = () => { if (COLLL !== lang()) { COLLL = lang(); COLL = new Intl.Collator(KO() ? 'ko' : 'en'); } return COLL; };
const byRec = (a, b) => ((b.status === 'rec') - (a.status === 'rec')) || collator().compare(a._nm, b._nm);
let GC = { ver: 0, lang: '', groups: null, none: null };
function groupsOf() {   // models per connection (recommended first, then by name) and the models that have no connection
  if (GC.ver === S3.ver && GC.lang === lang()) return GC;
  const by = new Map(CX.map((c) => [c.id, []])); const none = []; const PH = provHas();
  D.models.forEach((m) => { m._nm = mname(m); if (m.conn && by.has(m.conn)) by.get(m.conn).push(m); else if (!unlisted(m, PH)) none.push(m); });
  by.forEach((l) => l.sort(byRec)); none.sort(byRec);
  GC = { ver: S3.ver, lang: lang(), groups: CX.map((c) => ({ c, list: by.get(c.id) })), none };
  return GC;
}
function warmIndex() {   // build the match fields in the background (a few ms at a time) so the first keystroke is as cheap as the rest
  let i = 0; groupsOf();
  const step = () => { const t = now(); while (i < D.models.length && now() - t < 5) { const m = D.models[i++]; mIdx(m); mF(m); } if (i < D.models.length) setTimeout(step, 8); };
  setTimeout(step, 300);
}
function searchModels(q) {
  const words = q.trim().split(/\s+/).map(A.normWord).filter(Boolean); if (!words.length) return [];
  const cands = []; let hid = 0; const PH = provHas(); const connOn = chipOn('connected');
  const hit = (m) => { mIdx(m); for (let k = 0; k < words.length; k++) { const w = words[k]; if (!(JAMO.test(w) ? m._ch.indexOf(w) >= 0 : m._h.indexOf(w) >= 0)) return false; } return true; };
  for (let i = 0; i < D.models.length; i++) {
    const m = D.models[i]; if (!passOther(m)) continue; const has = !!connOf(m);
    if (!has && unlisted(m, PH)) continue;
    if (!has && connOn) { if (hit(m)) hid++; continue; }   // R-03 / DS-053: counted, so the list can say how many matches the chip hides
    if (hit(m)) cands.push(m);
  }
  let pool = cands;
  if (cands.length > 160) { const w0 = words[0]; pool = cands.map((m) => [JAMO.test(w0) ? m._ch.indexOf(w0) : m._h.indexOf(w0), m]).sort((a, b) => a[0] - b[0]).slice(0, 160).map((x) => x[1]); }
  const out = []; const first = new Map();
  pool.forEach((m, i) => { const r = rankModel(m, words); if (!r) return; const b = baseOf(m); if (!first.has(b)) first.set(b, i); out.push({ m, worst: r.worst, sum: r.sum, ord: first.get(b), ci: m.conn ? CX.findIndex((c) => c.id === m.conn) : 999 }); });
  out.sort((a, b) => a.worst - b.worst || a.sum - b.sum || ((b.m.status === 'rec') - (a.m.status === 'rec')) || a.ord - b.ord || a.ci - b.ci);   // the same model under several connections stays together, in connection order
  out.total = cands.length === pool.length ? out.length : cands.length; out.hidden = hid;
  return out;
}
function tagHTML(m) {
  if (m.custom) return `<span class="mp-tag tag-custom">${esc(t3('tagCustom'))}</span>`;
  if (m.status === 'rec') return `<span class="mp-tag tag-rec">${esc(t3('tagRecommended'))}</span>`;
  if (m.status === 'unver') return `<span class="mp-tag tag-unver">${esc(t3('tagUnverified'))}</span>`;
  if (m.status === 'depr') return `<span class="mp-tag tag-depr">${esc(t3('tagDeprecated'))}</span>`;
  return '';
}
const reasonOf = (m) => (m.status === 'unver' || m.status === 'depr' ? (KO() ? m.reasonK : m.reasonE) : '');
function needState(m) {   // DS-052: only a missing key blocks; a failed or unreachable last check is a warning that shows its stored result
  const c = connOf(m); if (!c) return null; const p = problemOfConn(c);
  if (p && (p.code === 'noKey' || p.code === 'keyAgain')) return { block: true, code: p.code };
  if (m.gone) return { gone: true };
  if (p) return { warn: true, code: p.code, at: c.test ? c.test.at : 0 };
  return null;
}
function optHTML(i, m, o = {}) {
  const c = connOf(m); const nd = needState(m); const rs = reasonOf(m); const cur = o.cur === m.id;
  const sub = [(o.conn || !c) ? (c ? c.name : t3('noConnection')) : null, fmtCtx(m.ctx)].filter(Boolean).join(' · ');
  const badge = !nd ? '' : nd.block || nd.gone ? `<span class="mp-need" data-part="settings-picker-warning" data-part-critical>${ic('circle-alert', 'sm')}<span>${esc(nd.gone ? t3('markGone') : t3('keyNeeded'))}</span></span>` : `<span class="mp-warn" data-part="settings-picker-warning" data-part-critical title="${esc(t3('warnTip'))}">${ic('circle-alert', 'sm')}<span>${esc(probText({ code: nd.code }))}</span></span>`;
  const opt = `<div data-part="settings-picker-row" class="mp-opt${cur ? ' cur' : ''}${nd && (nd.block || nd.gone) ? ' need' : ''}" role="${S3.mp && S3.mp.tree ? 'treeitem' : 'option'}" id="mpo-${i}" data-i="${i}" data-mid="${esc(baseOf(m))}" data-cx="${esc(m.conn || '')}" data-ref="${esc(m.id)}" aria-selected="false">` +
    `<span class="mp-tx"><span data-part="settings-picker-row-name" class="mp-name" title="${esc(mname(m))}">${esc(mname(m))}</span><span data-part="settings-picker-row-detail" class="mp-sub">${esc(sub)}</span>${rs ? `<span class="mp-why">${esc(rs)}</span>` : ''}${c ? '' : `<span class="mp-addhint">${esc(t3('addUse'))}</span>`}</span>` +
    `<span data-part="settings-picker-row-tags" class="mp-meta">${capsHTML(m)}${tagHTML(m)}${badge}${cur ? `<span class="mp-chk">${ic('check', 'md')}<span class="sr-only">${esc(t3('currentModel'))}</span></span>` : ''}</span></div>`;
  return opt;   // R-18 / N-12: the details button is not part of the row; it sits in an overlay outside the list (placeInfos)
}
function mpBuild() {
  const MP = S3.mp; const q = MP.q.trim(); const items = []; let html = '', gid = 0; const cur = MP.curId; MP.tree = false;
  const grp = (label, body) => `<div role="group" aria-labelledby="mpg-${gid}"><div class="sw-gh" id="mpg-${gid++}">${esc(label)}</div>${body}</div>`;
  const orow = (item, cls, inner, attrs = '') => { items.push(item); const i = items.length - 1; return `<div class="mp-opt ${cls}" data-part="settings-picker-row" role="${MP.tree ? 'treeitem' : 'option'}" id="mpo-${i}" data-i="${i}" aria-selected="false"${attrs}>${inner}</div>`; };
  const nm = (inner) => `<span class="mp-tx"><span data-part="settings-picker-row-name" class="mp-name">${inner}</span></span>`;
  const morerow = (n, extra) => orow(Object.assign({ kind: 'more' }, extra), 'more', nm(esc(t3('showMore', n))));
  const mrow = (m, o) => { items.push({ kind: 'model', id: m.id }); return optHTML(items.length - 1, m, o); };
  if (q) {
    const res = searchModels(q); MP.total = res.total === undefined ? res.length : res.total; const hid = res.hidden || 0;
    const hint = () => (hid ? orow({ kind: 'unhide' }, 'mp-hid', nm(ic('eye', 'md') + ' ' + esc(t3('hiddenSearch', hid)))) : '');
    if (!res.length) {
      const looks = /^[A-Za-z0-9][A-Za-z0-9._:\/-]{2,}$/.test(q) && CX.length > 0;
      const add = looks ? orow({ kind: 'add' }, 'mp-addrow', nm(ic('plus', 'md') + ' ' + esc(t3('addAsCustom', q)))) : '';
      return { items, total: 0, html: `<div class="mp-none"><p>${esc(t3('noModelMatch', q))}</p>${add}${hint()}</div>` };
    }
    const lim = MP.limit; let body = '';
    res.slice(0, lim).forEach((r) => { body += mrow(r.m, { conn: true, cur }); });
    if (res.length > lim) body += morerow(res.length - lim, { nextId: res[lim].m.id });
    return { items, total: res.length, html: grp(t3('modelResults', MP.total), body) + hint() };
  }
  const gc = groupsOf(); const seen = new Set();
  const groups = gc.groups.map((g) => ({ g, list: g.list.filter(passChips) })).filter((x) => x.list.length); const coll = groups.length > CFG3.collapseAt;   // R-04: with many connections every group is a header row that opens on its own
  const noneList = gc.none.filter(passOther); MP.tree = coll || (!chipOn('connected') && noneList.length > 0);   // N-12: headers with a state are tree items, never options
  const rows = (list, o) => { let b = ''; for (const m of list) { if (!o.force && !passChips(m)) continue; if (seen.has(m.id) && !o.dup) continue; if (!o.dup) seen.add(m.id); b += mrow(m, o); } return b; };
  const tm = MP.top ? modelById(MP.top) : null;
  if (tm && connOf(tm)) { html += grp(t3('sameModelGroup', connOf(tm).name), rows([tm], { cur, dup: true, force: true })); seen.add(tm.id); }   // DS-064
  const cm = cur ? modelById(cur) : null;
  if (cm) { const b = rows([cm], { conn: true, cur, dup: true, force: true }); if (b) { html += grp(t3('currentModel'), b); seen.add(cm.id); } }   // the current value is always listed, whatever the chips say
  const rec = S3.recents.map(modelById).filter((m) => m && m.id !== cur && D.models.includes(m) && connOf(m)).slice(0, CFG3.recents);
  if (rec.length) { const b = rows(rec, { conn: true, cur, dup: true }); if (b) html += grp(t3('recent'), b); }
  if (coll && !MP.ginit) { MP.ginit = true; if (cm && cm.conn) MP.gopen.add(cm.conn); }
  const section = (key, name, list, open, cap, o, hdCls) => {
    const fresh = list.filter((m) => !seen.has(m.id)); const shown = fresh.slice(0, cap); const rest = fresh.length - shown.length; const headed = !!hdCls || coll;
    const gidn = 'mpgrp-' + (gid++); const hd = headed ? orow({ kind: 'group', gkey: key }, 'mp-gh' + (hdCls ? ' ' + hdCls : ''), nm(ic(open ? 'chevron-down' : 'chevron-right', 'md') + ' ' + esc(key === 'none' ? t3('noConnGroup', list.length) : t3('groupMeta', name, list.length))), ` data-gkey="${esc(key)}" aria-expanded="${open}"${open ? ` aria-owns="${gidn}"` : ''}`) : '';
    let b = ''; if (open || !headed) { b = rows(shown, o); if (rest > 0) b += morerow(rest, { gkey: key, nextId: fresh[shown.length].id }); }
    return headed ? `${hd}${open ? `<div role="group" id="${gidn}" aria-label="${esc(name)}">${b}</div>` : ''}` : grp(name, b);
  };
  groups.forEach(({ g, list }) => { const key = g.c.id; html += section(key, g.c.name, list, coll ? MP.gopen.has(key) : true, MP.gl[key] || CFG3.gcap, { cur }); });
  if (noneList.length) {
    if (chipOn('connected')) html += orow({ kind: 'unhide' }, 'mp-hid', nm(ic('eye', 'md') + ' ' + esc(t3('hiddenRow', noneList.length))));   // R-03 / DS-053
    else html += section('none', t3('noConnection'), noneList, S3.noneOpen, MP.gl.none || CFG3.chunk, { conn: true, cur }, 'mp-nonehd');
  }
  MP.total = items.filter((x) => x.kind === 'model').length;
  return { items, total: MP.total, html };
}
function mpTitle() { const MP = S3.mp; const r = A.ROW[MP.rowId]; const lab = MP.add ? A.L(r) : ((MP.rowId === 'models.mainModel' || MP.rowId === 'models.subModel') ? ROWSHORT(r) : A.L(r)); return t3('pickModel', KO() ? lab : lab.charAt(0).toLowerCase() + lab.slice(1)); }
function mpRender(keepAct) {
  const MP = S3.mp; if (!MP) return; const t0 = now(); const b = mpBuild(); MP.items = b.items; MP.list.innerHTML = b.html; MP.list.setAttribute('role', MP.tree ? 'tree' : 'listbox'); MP.input.setAttribute('aria-haspopup', MP.tree ? 'tree' : 'listbox'); placeInfos();
  if (!keepAct || MP.act < 0 || MP.act >= MP.items.length) MP.act = MP.items.length ? Math.max(0, MP.items.findIndex((x) => x.kind === 'model' && x.id === MP.focusId)) : -1;
  if (MP.act < 0 && MP.items.length) MP.act = 0;
  mpSetActive(MP.act, false);
  MP.input.placeholder = t3('pickerSearch'); MP.input.setAttribute('aria-label', t3('pickerSearch'));
  perf3.render.push(+(now() - t0).toFixed(2)); if (perf3.render.length > 100) perf3.render.shift();
}
function placeInfos() {   // phones: one details button per row, laid over the row's right edge, outside the listbox (R-18, N-12)
  const MP = S3.mp; if (!MP) return; const box = $('#mpInfos', MP.root); if (!box) return;
  if (MP.mode !== 'sheet') { box.innerHTML = ''; return; }
  const rows = $$('.mp-opt[data-ref]', MP.list).map((o) => [o.dataset.ref, o.offsetTop, o.offsetHeight]);   // offsets (not rects): the sheet may still be sliding in
  box.innerHTML = rows.map(([ref, t, h]) => { const m = modelById(ref); return `<button type="button" data-part="settings-button" class="btn mp-info" tabindex="-1" data-mp="info" data-ref="${esc(ref)}" style="top:${Math.round(t + (h - window.settingsTheme.num('--size-touch')) / 2)}px" aria-label="${esc(t3('details') + ': ' + (m ? mname(m) : ref))}" title="${esc(t3('details'))}">${ic('info', 'lg')}</button>`; }).join('');
}
function mpSetActive(i, scroll = true) {
  const MP = S3.mp; if (!MP) return; const opts = $$('.mp-opt', MP.list);
  opts.forEach((o) => { const on = +o.dataset.i === i; o.classList.toggle('act', on); o.setAttribute('aria-selected', on ? 'true' : 'false'); });
  MP.act = i; const el = i >= 0 ? $('#mpo-' + i, MP.list) : null;
  if (el) { MP.input.setAttribute('aria-activedescendant', el.id); if (scroll) el.scrollIntoView({ block: 'nearest' }); } else MP.input.removeAttribute('aria-activedescendant');
  const it = MP.items[i]; if (it && it.kind === 'model') mpDetail(it.id);
}
function detailHTML(m) {
  const c = connOf(m); const nd = needState(m); const known = m.flags.filter((f) => FLAG[f]); const other = m.flags.length - known.length + (m.xflags ? m.xflags.length : 0);
  const stat = m.custom ? t3('tagCustom') : m.status === 'rec' ? t3('tagRecommended') : m.status === 'unver' ? t3('tagUnverified') : m.status === 'depr' ? t3('tagDeprecated') : '—';
  const why = m.custom ? t3('customWhy') : m.status === 'rec' ? t3('recommendedWhy') : reasonOf(m);
  const dd = (k, v) => `<div class="mp-dr"><dt>${esc(k)}</dt><dd>${v}</dd></div>`;
  const caps = known.length ? `<ul class="mp-capl">${known.map((f) => `<li>${esc(KO() ? FLAG[f][1] : FLAG[f][2])}</li>`).join('')}</ul>` : `<span>${esc(t3('detNone'))}</span>`;
  return `<div class="mp-dh"><button type="button" data-part="settings-button" class="btn mp-dback" data-mp="dback" aria-label="${esc(t3('detailsBack'))}" title="${esc(t3('detailsBack'))}">${ic('arrow-left', 'xl')}</button><h3 class="mp-dt" id="mpDT">${esc(mname(m))}</h3></div>` +
    `<dl class="mp-dl">${dd('ID', `<span class="mp-id">${esc(baseOf(m))}</span> <button type="button" data-part="settings-button" class="btn mp-copy" data-mp="copy" data-mid="${esc(m.id)}" aria-label="${esc(t3('copyId'))}" title="${esc(t3('copyId'))}">${ic('copy', 'md')}</button>`)}` +
    dd(t3('detConn'), esc(c ? c.name : t3('noConnection')) + (nd ? (nd.block || nd.gone ? ` <span class="mp-need" data-part="settings-picker-warning" data-part-critical>${ic('circle-alert', 'sm')}<span>${esc(nd.gone ? t3('markGone') : t3('keyNeeded'))}</span></span>` : ` <span class="mp-warn" data-part="settings-picker-warning" data-part-critical>${ic('circle-alert', 'sm')}<span>${esc(probText({ code: nd.code }) + (nd.at ? ' · ' + fmtAgo(nd.at) : ''))}</span></span>`) : '')) +
    dd(t3('detStatus'), esc(stat) + (why ? `<span class="mp-dwhy">${esc(why)}</span>` : '')) + dd(t3('detCtx'), esc(fmtCtx(m.ctx))) + dd(t3('detMaxOut'), esc(fmtCtx(m.maxOut || 0))) +
    dd(t3('detCaps'), caps + (other ? `<span class="mp-dother">${esc(t3('detOther', other))}</span>` : '')) +
    dd(t3('detParams'), `${esc((m.params || []).join(', '))}<br><button type="button" class="mp-plink" data-mp="params" disabled aria-disabled="true">${esc(t3('detParamsLink'))}</button>`) +
    dd(t3('detTok'), esc(m.tokenizer || '—')) + dd(t3('detFormat'), esc(D3.FMT_NAME[m.format] || m.format || '—')) + `</dl>` +
    `<button type="button" data-part="settings-button" class="btn solid accent mp-use" data-mp="use" data-ref="${esc(m.id)}">${ic('check', 'lg')}<span>${esc(c ? t3('useThisModel') : t3('addUse'))}</span></button>`;
}
function mpDetail(mid) { const MP = S3.mp; const m = modelById(mid); if (!MP || !m) return; if (MP.detId === mid && MP.detLang === lang() && MP.detVer === S3.ver) return; MP.detId = mid; MP.detLang = lang(); MP.detVer = S3.ver; MP.detail.innerHTML = detailHTML(m); }
function chipsHTML() {
  const defs = [['vision', 'chipVision', 'eye'], ['tools', 'chipTools', 'wrench'], ['reasoning', 'chipReasoning', 'brain'], ['long', 'chipLong', 'arrow-right'], ['connected', 'chipConnected', 'plug']];
  return defs.map(([k, lab, icn]) => `<button type="button" data-part="settings-picker-chip" class="mp-chip" data-mp="chip" data-chip="${k}" aria-pressed="${chipOn(k)}">${ic(icn, 'sm')}<span>${esc(t3(lab))}</span></button>`).join('');
}
function saveChips() { try { localStorage.setItem('ss1.mpchips3', JSON.stringify(S3.chips)); } catch (_) { /* ignore */ } }
function loadChips() { if (A.hermetic) return; try { const j = JSON.parse(localStorage.getItem('ss1.mpchips3') || 'null'); if (j) Object.assign(S3.chips, j); } catch (_) { /* ignore */ } }
function openPicker(o = {}) {
  if (S3.mp) closePicker({ noFocus: true });
  const t0 = now(); const a = document.activeElement; if (a && A.inTextField(a)) a.blur(); B.commitPending();
  const rowId = o.rowId || 'models.mainModel'; const wide = $('#app').clientWidth >= window.settingsTheme.num('--breakpoint-sheet'); const r = A.ROW[rowId];
  const MP = S3.mp = { tree: false, rowId, add: !!o.add, mode: wide ? 'dialog' : 'sheet', q: o.q || '', limit: o.q ? CFG3.schunk : CFG3.chunk, act: -1, items: [], opener: o.opener || (a && a !== document.body ? a : null), reason: o.reason || '', focusId: o.focus || null, curId: o.add ? null : (FB_IDS.includes(rowId) ? null : (r.v || null)), step: 'list', hist: false, from: o.from || '', gopen: new Set(o.conn ? [o.conn] : []), gl: {}, ginit: false, top: o.sibling || null };
  const root = document.createElement('div'); root.className = 'mp-root'; root.setAttribute('data-part', 'settings-picker'); root.id = 'mpRoot'; root.dataset.mode = MP.mode; root.dataset.step = 'list';
  root.innerHTML = `<div data-part="settings-picker-scrim" class="mp-scrim" data-mp="scrim"></div><div class="mp-panel" data-part="settings-picker-panel" role="dialog" aria-modal="true" aria-labelledby="mpTitle"><div class="mp-main">` +
    `<div class="mp-head"><button type="button" data-part="settings-button" class="btn mp-x" data-mp="close" aria-label="${esc(B.t2('close'))}" title="${esc(B.t2('close'))}">${ic(wide ? 'x' : 'arrow-left', 'xl')}</button><h2 class="mp-title" id="mpTitle"></h2></div>` +
    `<p class="mp-reason" id="mpReason" role="status" hidden></p><div class="mp-top" data-part="settings-picker-search"><span class="sw-sic" aria-hidden="true">${ic('search', 'lg')}</span><input type="text" class="mp-q" role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="mpList" autocomplete="off" spellcheck="false" enterkeyhint="search"><button type="button" data-part="settings-button" class="btn sw-clr" data-mp="clearq" hidden aria-label="${esc(B.t2('clearSearch'))}" title="${esc(B.t2('clearSearch'))}">${ic('x', 'md')}</button></div>` +
    `<div class="mp-chips" role="group" aria-label="${esc(t3('filters'))}">${chipsHTML()}</div>` +
    `<div class="mp-list" id="mpScroll"><div id="mpList" role="listbox" tabindex="-1" aria-label="${esc(t3('pickerList'))}"></div><div class="mp-infos" id="mpInfos" role="none"></div></div><div class="sr-only" id="mpLive" role="status" aria-live="polite"></div></div>` +
    `<aside class="mp-detail" id="mpDetail" data-part="settings-picker-details" aria-label="${esc(t3('details'))}"></aside></div>`;
  $('#app').appendChild(root); document.body.classList.add('mp-open');
  MP.root = root; MP.panel = $('.mp-panel', root); MP.input = $('.mp-q', root); MP.list = $('#mpList', root); MP.live = $('#mpLive', root); MP.detail = $('#mpDetail', root);
  $('#mpTitle', root).textContent = mpTitle(); MP.input.value = MP.q; $('[data-mp="clearq"]', root).hidden = !MP.q;
  const rs = $('#mpReason', root); rs.hidden = !MP.reason; rs.innerHTML = MP.reason ? ic('circle-alert', 'md') + '<span>' + esc(MP.reason) + '</span>' : '';
  MP.prevInert = ['#settings', '#origin'].map((s) => [$(s), $(s).inert]); MP.prevInert.forEach(([e]) => { e.inert = true; e.setAttribute('aria-hidden', 'true'); });
  mpRender(); if (MP.focusId) { const i = MP.items.findIndex((x) => x.kind === 'model' && x.id === MP.focusId); if (i >= 0) mpSetActive(i); }
  MP.input.focus({ preventScroll: true });
  requestAnimationFrame(() => { if (S3.mp === MP) root.classList.add('open'); });
  bindPicker(root);
  perf3.open.push(+(now() - t0).toFixed(2)); if (perf3.open.length > 60) perf3.open.shift();
  return MP;
}
function closePicker(o = {}) {
  const MP = S3.mp; if (!MP) return false; S3.mp = null; clearTimeout(MP.liveT);
  MP.root.remove(); document.body.classList.remove('mp-open');
  (MP.prevInert || []).forEach(([e, v]) => { e.inert = v; if (!v) e.removeAttribute('aria-hidden'); });
  if (!o.noFocus) {
    let f = MP.opener && MP.opener.isConnected ? MP.opener : null;
    if (!f && A.S.open) f = $(`#pageScroll [data-row="${CSS.escape(MP.rowId)}"] [data-ctl]`) || $('.c3-fixbanner [data-c3="backchat"]') || $('#pgTitle') || $('#pageScroll');
    if (!f) f = $('#psChip') || $('#oSettings');
    if (f) { if (f.tabIndex < 0 && !f.hasAttribute('tabindex')) f.tabIndex = -1; f.focus({ preventScroll: true }); }
  }
  return true;
}
function mpLive(msg) { const MP = S3.mp; if (!MP) return; clearTimeout(MP.liveT); MP.liveT = setTimeout(() => { if (S3.mp === MP) MP.live.textContent = msg; }, 300); }
function mpInput() {
  const MP = S3.mp; const t0 = now(); MP.q = MP.input.value; MP.limit = MP.q.trim() ? CFG3.schunk : CFG3.chunk; MP.act = -1; mpRender();
  $('[data-mp="clearq"]', MP.root).hidden = !MP.q;
  perf3.key.push(+(now() - t0).toFixed(2)); if (perf3.key.length > 200) perf3.key.shift();
  mpLive(MP.q.trim() ? (MP.total ? t3('modelResults', MP.total) : t3('noModelMatch', MP.q.trim())) : t3('modelResults', MP.total));
}
function mpActivate(i) {
  const MP = S3.mp; const it = MP.items[i]; if (!it) return;
  const focusAfter = (pred) => { const k = MP.items.findIndex(pred); if (k >= 0) mpSetActive(k); };
  if (it.kind === 'more') {
    if (it.gkey) MP.gl[it.gkey] = (MP.gl[it.gkey] || (it.gkey === 'none' ? CFG3.chunk : CFG3.gcap)) + CFG3.chunk; else MP.limit += MP.q.trim() ? CFG3.schunk : CFG3.chunk;
    mpRender(true); focusAfter((x) => x.kind === 'model' && x.id === it.nextId); return;
  }
  if (it.kind === 'group') { if (it.gkey === 'none') S3.noneOpen = !S3.noneOpen; else if (MP.gopen.has(it.gkey)) MP.gopen.delete(it.gkey); else MP.gopen.add(it.gkey); mpRender(true); focusAfter((x) => x.kind === 'group' && x.gkey === it.gkey); MP.live.textContent = ''; return; }
  if (it.kind === 'unhide') { S3.chips.connected = false; saveChips(); const cb = $('[data-chip="connected"]', MP.root); if (cb) cb.setAttribute('aria-pressed', 'false'); if (!MP.q.trim()) S3.noneOpen = true; mpRender(); focusAfter((x) => (MP.q.trim() ? x.kind === 'model' : x.kind === 'group' && x.gkey === 'none')); mpLive(t3('modelResults', MP.total)); return; }   // R-03 / DS-053
  if (it.kind === 'add') { const q = MP.q.trim(); const rowId = MP.rowId; closePicker(); openCustomDialog({ id: q, reopen: { rowId } }); return; }
  mpChoose(it.id);
}
function mpReasonLine(text) { const MP = S3.mp; if (!MP) return; const rs = $('#mpReason', MP.root); rs.hidden = false; rs.innerHTML = ic('circle-alert', 'md') + '<span>' + esc(text) + '</span>'; MP.live.textContent = text; }   // builder Q: a refused choice says why on screen, not only to the live region
function mpChoose(ref) {
  const MP = S3.mp; const m = modelById(ref); if (!m) return;
  const c = connOf(m);
  if (!c) { const rowId = MP.rowId, add = MP.add, q = MP.q; closePicker(); openAddDialog({ provider: m.pid, reopen: { rowId, add, q, base: baseOf(m) } }); return; }   // N-09 / DS-066: after 저장 the picker comes back on the same query with the model focused under the new connection
  const nd = needState(m);
  if (nd && nd.gone) { mpReasonLine(t3('fixReasonLine', mname(m))); return; }
  if (nd && nd.block) { const rs = { rowId: MP.rowId, add: MP.add, q: MP.q, mid: ref, conn: c.id }; closePicker(); openConn(c.id, { keyReplace: true }); S3.resume = rs; return; }   // R-09: after the key is saved the picker comes back (same row, same query)
  if (m.status === 'unver' && !S3.asked.has(ref)) { mpAskUnverified(m); return; }   // asked once per (connection, model)
  mpCommit(ref);
}
function mpAskUnverified(m) {
  const MP = S3.mp; MP.root.inert = true; MP.root.setAttribute('aria-hidden', 'true');
  const d = A.openDialog({ critical: true, title: t3('unverifiedQ'), body: `<p><strong>${esc(mname(m))}</strong></p><p class="dlg-hint">${esc(reasonOf(m))}</p>`, buttons: [{ id: 'cancel', label: t3('cancel') }, { id: 'use', label: t3('useAnyway'), primary: true }], initial: '[data-dlg="cancel"]',
    onClose: (why) => { if (!S3.mp) return; S3.mp.root.inert = false; S3.mp.root.removeAttribute('aria-hidden'); if (why !== 'use') { S3.mp.input.focus({ preventScroll: true }); } } });
  A.openDialog.handlers = { use: () => { S3.asked.add(m.id); try { localStorage.setItem('ss1.asked3', JSON.stringify([...S3.asked])); } catch (_) { /* ignore */ } setTimeout(() => { if (S3.mp) mpCommit(m.id); }, 0); } };
  return d;
}
function mpCommit(mid) {
  const MP = S3.mp; const rowId = MP.rowId, add = MP.add; const m = modelById(mid);
  closePicker();
  pushRecent(mid);
  if (add) { const l = fbList(rowId); if (!l.includes(mid)) { l.push(mid); commitModel(rowId, l.join(','), { text: modelsText(l.join(',')) }); B.announce(t3('fbAdded', mname(m))); } if (S3.view === 'fb') { A.refreshPage(); const e = $(`.c3-fbmain[data-mid="${CSS.escape(mid)}"]`); if (e) e.focus({ preventScroll: true }); } return; }
  commitModel(rowId, mid, { text: mlabel(m) });
  settleFocus(rowId);
}
function settleFocus(rowId) {
  if (S3.view === 'section') { const e = $(`#pageScroll [data-row="${CSS.escape(rowId)}"] [data-ctl]`); if (e) { e.focus({ preventScroll: true }); return; } }
  const bb = $('.c3-fixbanner [data-c3="backchat"]') || $('.c3-fixbanner button'); if (bb) { bb.focus({ preventScroll: true }); return; }
  const h = $('#pgTitle'); if (h) h.focus({ preventScroll: true });
}
function mpDetailsStep(on) { const MP = S3.mp; if (!MP) return; MP.step = on ? 'details' : 'list'; MP.root.dataset.step = MP.step; if (on) { const b = $('.mp-dback', MP.detail); if (b) b.focus({ preventScroll: true }); } else MP.input.focus({ preventScroll: true }); }
function bindPicker(root) {
  const MP = S3.mp;
  root.addEventListener('pointerdown', (ev) => { if (ev.target.dataset && ev.target.dataset.mp === 'scrim') { ev.preventDefault(); closePicker(); } });
  root.addEventListener('click', (ev) => {
    const t = ev.target; const b = t.closest('[data-mp]');
    if (b) {
      const k = b.dataset.mp;
      if (k === 'close') { if (MP.mode === 'sheet' && MP.step === 'details') mpDetailsStep(false); else closePicker(); return; }
      if (k === 'clearq') { MP.input.value = ''; mpInput(); MP.input.focus(); return; }
      if (k === 'chip') { const c = b.dataset.chip; if (c === 'connected') S3.chips.connected = !chipOn('connected'); else S3.chips[c] = !S3.chips[c]; saveChips(); b.setAttribute('aria-pressed', String(chipOn(c))); MP.limit = MP.q.trim() ? CFG3.schunk : CFG3.chunk; mpRender(); mpLive(t3('modelResults', MP.total)); return; }
      if (k === 'info') { ev.stopPropagation(); const op = $(`.mp-opt[data-ref="${CSS.escape(b.dataset.ref)}"]`, MP.list); if (op) mpSetActive(+op.dataset.i, false); mpDetailsStep(true); return; }
      if (k === 'dback') { mpDetailsStep(false); return; }
      if (k === 'use') { mpChoose(b.dataset.ref); return; }
      if (k === 'copy') { A.toast(t3('copied')); B.announce(t3('copied')); return; }
    }
    const o = t.closest('.mp-opt'); if (o) { mpSetActive(+o.dataset.i, false); mpActivate(+o.dataset.i); }
  });
  root.addEventListener('mousemove', (ev) => { const o = ev.target.closest && ev.target.closest('.mp-opt'); if (o && +o.dataset.i !== MP.act && !o.classList.contains('mp-addrow')) mpSetActive(+o.dataset.i, false); });
  MP.input.addEventListener('input', mpInput);
  root.addEventListener('keydown', (ev) => {
    if (ev.isComposing || ev.keyCode === 229) return; const k = ev.key; const n = MP.items.length;
    if (k === 'Escape') { ev.preventDefault(); ev.stopPropagation(); if (MP.mode === 'sheet' && MP.step === 'details') mpDetailsStep(false); else closePicker(); return; }
    if (k === 'Tab') { const f = $$('button:not([disabled]):not([tabindex="-1"]), input', MP.panel).filter((e) => e.offsetParent !== null && !e.hidden); if (!f.length) return; const i = f.indexOf(document.activeElement); if (ev.shiftKey ? i <= 0 : i === f.length - 1) { ev.preventDefault(); f[ev.shiftKey ? f.length - 1 : 0].focus(); } return; }
    if (document.activeElement !== MP.input) {
      if (k === 'ArrowLeft' && MP.detail.contains(document.activeElement) && MP.mode === 'dialog') { ev.preventDefault(); MP.input.focus(); }
      return;
    }
    if (k === 'ArrowDown' || k === 'ArrowUp') { ev.preventDefault(); if (n) mpSetActive((MP.act + (k === 'ArrowDown' ? 1 : -1) + n) % n); }
    else if (k === 'Home' || k === 'End') { if (n && (ev.ctrlKey || !MP.input.value)) { ev.preventDefault(); mpSetActive(k === 'Home' ? 0 : n - 1); } }
    else if (k === 'PageDown' || k === 'PageUp') { ev.preventDefault(); if (n) mpSetActive(Math.max(0, Math.min(n - 1, MP.act + (k === 'PageDown' ? 8 : -8)))); }
    else if (k === 'Enter') { ev.preventDefault(); if (MP.act >= 0) mpActivate(MP.act); }
    else if (k === 'ArrowRight' && MP.input.selectionStart === MP.input.value.length && MP.input.selectionEnd === MP.input.value.length) {   // Right at the end of the field opens the details (wide: focus the panel; phone: the details step)
      const it = MP.items[MP.act]; if (it && it.kind === 'model') { ev.preventDefault(); if (MP.mode === 'sheet') mpDetailsStep(true); else { const bu = $('.mp-use', MP.detail); if (bu) bu.focus({ preventScroll: true }); } }
    }
  });
}

/* ------------------------------------------------------------------ the models page (DS-044): main, sub, per-task, fallback in one list */
function modelSubLine(m, skipNoConn) {   // R-27: when the row's mark already says 연결 없음 the sub line does not say it again
  if (!m) return '';
  const c = connOf(m); return [c ? c.name : (skipNoConn ? '' : t3('noConnection')), fmtCtx(m.ctx)].filter(Boolean).join(' · ');
}
function fixMarkBtn(pr, kind, id) { return pr ? `<button type="button" class="c3-markbtn" data-part="settings-fix-mark" data-part-critical data-c3="fixrow" data-kind="${esc(kind)}" data-id="${esc(id)}" data-code="${esc(pr.code)}" aria-label="${esc(probText(pr) + ' · ' + t3('fix'))}" title="${esc(t3('fix'))}">${ic('circle-alert', 'mark')}<span>${esc(probText(pr))}</span></button>` : ''; }
function modelRowHTML(id) {
  const r = A.ROW[id]; const task = TASK_IDS.includes(id); const own = !!r.v; const mid = task ? resolved(id) : r.v; const m = modelById(mid);
  const pr = mid ? problem(mid) : { code: 'gone' }; const desc = r.desc ? A.pair(r.desc) : '';
  const inh = task && !own ? inherits(id) : null; const nameH = inh ? esc(inheritText(id, m ? mname(m) : '—')) : esc(m ? mname(m) : (mid || '—'));
  return `<div class="row c3-mrow${pr ? ' c3-bad' : ''}" data-row="${id}" data-part="settings-model-row" role="group" aria-labelledby="l-${id}"><div class="c3-mline">` +
    `<button type="button" class="c3-mbtn" data-ctl data-c3="pick" data-id="${id}" aria-haspopup="dialog"><span class="c3-mtext"><span class="r-title"><span data-part="settings-row-label" class="r-label" id="l-${id}">${esc(ROWSHORT(r))}</span></span>${desc ? `<span data-part="settings-row-description" class="r-desc">${esc(desc)}</span>` : ''}</span>` +
    `<span class="c3-mval"><span class="c3-mname${task && !own ? ' same' : ''}">${nameH}</span><span class="c3-msub">${esc(modelSubLine(m, !!pr && pr.code === 'noConn'))}${m ? capsHTML(m) : ''}</span></span>${ic('chevron-right', 'lg')}</button>` +
    `${fixMarkBtn(pr, 'row', id)}${task && own ? `<button type="button" data-part="settings-button" class="btn c3-revert" data-c3="revert" data-id="${id}" aria-label="${esc(ROWSHORT(r) + ': ' + t3('revert'))}" title="${esc(t3('revertTip'))}">${ic('rotate-ccw', 'lg')}</button>` : ''}</div></div>`;
}
function fbRowHTML(id) {
  const r = A.ROW[id]; const l = fbList(id); const pr = l.map(problem).find(Boolean);
  return `<div class="row row-link c3-fbrow${pr ? ' c3-bad' : ''}" data-row="${id}" data-part="settings-model-row"><div class="c3-mline"><button type="button" class="rl" data-ctl data-c3="fb" data-id="${id}"><span class="r-text"><span class="r-title"><span data-part="settings-row-label" class="r-label">${esc(ROWSHORT(r))}</span></span><span data-part="settings-row-description" class="r-desc">${esc(l.length ? cl(modelsText(r.v), 70) : t3('fbEmpty'))}</span></span><span class="rl-end"><span class="rl-txt">${esc(t3('fbCount', l.length))}</span>${ic('chevron-right', 'lg')}</span></button>${fixMarkBtn(pr, 'fb', id)}</div></div>`;
}
function lockBadge(lockId) { return A.ROW[lockId].v ? `<button type="button" class="c3-lock" data-c3="golock" data-lock="${lockId}" aria-label="${esc(t3('lockBadge') + ' · ' + t3('lockGo'))}" title="${esc(t3('lockGo'))}">${ic('lock', 'sm')}<span>${esc(t3('lockBadge'))}</span></button>` : ''; }
function retriesRowHTML() {
  const r = A.ROW['adv.retries'];
  return `<div data-part="settings-row" class="row" data-row="adv.retries"><div class="r-main"><div class="r-text"><div class="r-title"><label data-part="settings-row-label" class="r-label" for="c3Retries">${esc(t3('retries'))}</label></div><p data-part="settings-row-description" class="r-desc">${esc(A.pair(r.desc))}</p></div><div data-part="settings-row-control" class="r-ctl"><input type="number" data-part="settings-field" class="inp num" id="c3Retries" data-ctl data-c3="retries" min="${r.min}" max="${r.max}" inputmode="numeric" value="${r.v}"></div></div></div>`;
}
function modelsBody() {
  return modelRowHTML('models.mainModel') + modelRowHTML('models.subModel') +
    `<div class="c3-grp" data-part="settings-model-group" role="group" aria-labelledby="c3gh-task"><h3 class="c3-gh" id="c3gh-task"><span>${esc(t3('perTask'))}</span>${lockBadge('models.keepAuxOnSwitch')}</h3>${TASK_IDS.map(modelRowHTML).join('')}</div>` +
    `<div class="c3-grp" data-part="settings-model-group" role="group" aria-labelledby="c3gh-fb"><h3 class="c3-gh" id="c3gh-fb"><span>${esc(t3('fallbackGroup'))}</span>${lockBadge('models.keepFallbackOnSwitch')}</h3>${FB_IDS.map(fbRowHTML).join('')}${A.rowHTML(A.ROW['models.fallbackBlank'])}${retriesRowHTML()}</div>` +
    (A.ROW['models.streaming'] ? `<div class="c3-grp" data-part="settings-model-group" role="group" aria-labelledby="c3gh-misc"><h3 class="c3-gh" id="c3gh-misc"><span>${esc(t3('otherSettings'))}</span></h3>${A.rowHTML(A.ROW['models.streaming'])}</div>` : '');
}

/* ------------------------------------------------------------------ the fallback editor (SPEC 4.3): an ordered list, undoable */
function fbPageHTML() {
  const id = S3.fb; const r = A.ROW[id]; const l = fbList(id);
  const items = l.map((mid, i) => { const m = modelById(mid); const pr = problem(mid); const key = mid;
    return `<li class="c3-fbli" data-part="settings-fallback-item" data-mid="${esc(mid)}"><div class="c3-fbrow2"><span class="c3-grip${l.length > 1 ? '' : ' off'}" ${l.length > 1 ? 'data-fbgrip' : ''} aria-hidden="true" title="${esc(t3('grip'))}">${ic('grip-vertical', 'lg')}</span>` +
      `<button type="button" class="c3-fbmain" data-fbrv data-c3="fbitem" data-mid="${esc(key)}" data-i="${i}" tabindex="-1" aria-haspopup="menu" aria-label="${esc(`${i + 1}/${l.length} ${m ? mname(m) : mid}${pr ? ' · ' + probText(pr) : ''}`)}"><span class="c3-fbn">${i + 1}</span><span class="c3-fbt"><span class="c3-fbname">${esc(m ? mname(m) : mid)}</span><span class="c3-fbsub">${esc(modelSubLine(m))}</span></span>${pr ? `<span class="c3-mark">${ic('circle-alert', 'sm')}<span>${esc(probText(pr))}</span></span>` : ''}</button>` +
      `<button type="button" data-part="settings-button" class="btn c3-fbrm" data-c3="fbremove" data-mid="${esc(mid)}" aria-label="${esc(t3('fbRemove') + ': ' + (m ? mname(m) : mid))}" title="${esc(t3('fbRemove'))}">${ic('x', 'lg')}</button></div></li>`; }).join('');
  return `<div class="pg c3-pg" data-part="settings-fallback-editor" data-page="models" data-view="fb"><div data-part="settings-page-header" class="pg-head">${crumbHTML([[t3('crumbModels'), 'crumb-models'], [t3('modelsPage'), 'crumb-fbback']], A.L(r))}<h1 class="pg-title" id="pgTitle" tabindex="-1">${esc(A.L(r))}</h1></div>` +
    `<section data-part="settings-section" class="sec" aria-label="${esc(A.L(r))}"><p data-part="settings-row-description" class="c3-fbnote r-desc">${esc(t3('fallbackNote', retriesN()))}</p>${lockBadge(lockOf(id))}<div data-part="settings-rows" class="rows"><ul class="c3-fbl" id="c3Fbl" role="list">${items || `<li class="c3-fbempty">${esc(t3('fbEmpty'))}</li>`}</ul><div data-part="settings-row" class="row row-link"><button type="button" class="rl" data-ctl data-c3="fbadd">${ic('plus', 'xl')}<span class="r-text"><span data-part="settings-row-label" class="r-label">${esc(t3('fbAdd'))}</span></span></button></div></div></section></div>`;
}
const lockOf = (id) => (FB_IDS.includes(id) ? 'models.keepFallbackOnSwitch' : null);
function fbCommit(id, list, announceMsg) {
  const e = commitModel(id, list.join(','), { text: modelsText(list.join(',')) });
  if (S3.view === 'fb') { A.refreshPage(); }
  if (announceMsg) B.announce(announceMsg);
  return e;
}
function fbMove(id, mid, dir) {
  const l = fbList(id); const i = l.indexOf(mid); const j = i + dir; if (i < 0) return false;
  if (j < 0 || j >= l.length) { B.announce(t3(dir < 0 ? 'atTop' : 'atBottom')); return false; }
  l.splice(i, 1); l.splice(j, 0, mid); const m = modelById(mid);
  fbCommit(id, l, t3('fbMoved', m ? mname(m) : mid, j + 1, l.length));
  const e = $(`.c3-fbmain[data-mid="${CSS.escape(mid)}"]`); if (e) { $$('[data-fbrv]').forEach((x) => { x.tabIndex = -1; }); e.tabIndex = 0; e.focus({ preventScroll: true }); }
  return true;
}
function fbRemove(id, mid) {
  const l = fbList(id); const i = l.indexOf(mid); if (i < 0) return false; l.splice(i, 1); const m = modelById(mid);
  fbCommit(id, l, t3('fbRemoved', m ? mname(m) : mid));
  const next = $$('.c3-fbmain')[Math.min(i, l.length - 1)]; const f = next || $('[data-c3="fbadd"]'); if (f) { if (next) { $$('[data-fbrv]').forEach((x) => { x.tabIndex = -1; }); next.tabIndex = 0; } f.focus({ preventScroll: true }); }
  return true;
}
function fbMenu(mid, anchor, point, opener) {
  const l = fbList(S3.fb); const i = l.indexOf(mid); const id = S3.fb;
  A.showMenu([
    { icon: 'arrow-up', label: t3('menuUp'), disabled: i <= 0, fn: () => fbMove(id, mid, -1) },
    { icon: 'arrow-down', label: t3('menuDown'), disabled: i >= l.length - 1, fn: () => fbMove(id, mid, 1) },
    { icon: 'x', label: t3('fbRemove'), fn: () => fbRemove(id, mid) },
  ], anchor, point, opener, t3('fbOpen'));
}
/* generic pointer reorder for a list of <li>: mouse drags by the grip, touch by long-press then move. onDrop(fromIndex, toIndex) is called once. */
let DR = null;
function dragReorder(ev, li, sel, onDrop) {
  const all0 = $$(sel); li.classList.add('dragging'); DR = { li, pid: ev.pointerId, y0: ev.clientY, to: -1, from: all0.indexOf(li) };
  const targetIdx = (y) => { let n = 0; all0.forEach((x) => { if (x === li) return; const r = x.getBoundingClientRect(); if (y > r.top + r.height / 2) n++; }); return n; };
  const mv = (e) => { if (!DR || e.pointerId !== DR.pid) return; e.preventDefault(); li.style.transform = `translateY(${e.clientY - DR.y0}px)`; DR.to = targetIdx(e.clientY); };
  const up = (e) => {
    if (!DR || e.pointerId !== DR.pid) return; document.removeEventListener('pointermove', mv, true); document.removeEventListener('pointerup', up, true); document.removeEventListener('pointercancel', up, true);
    const d = DR; DR = null; li.classList.remove('dragging', 'lifted'); li.style.transform = ''; if (e.type === 'pointercancel') return;
    S3.noClick = true; setTimeout(() => { S3.noClick = false; }, 300); if (d.to >= 0 && d.to !== d.from) onDrop(d.from, d.to);
  };
  document.addEventListener('pointermove', mv, true); document.addEventListener('pointerup', up, true); document.addEventListener('pointercancel', up, true);
}
let LPT = null;   // touch long-press state: 300 ms arms (lift), then a move drags; no move within 300 ms more opens the menu
function lpClear() { if (LPT) { clearTimeout(LPT.t1); clearTimeout(LPT.t2); LPT = null; } }
function bindTouchReorder(sc) {
  sc.addEventListener('pointerdown', (ev) => {
    if (ev.pointerType !== 'touch') return; const m = ev.target.closest('.c3-fbmain, .c3-cmain'); if (!m) return; lpClear();
    const fb = m.classList.contains('c3-fbmain'); const li = m.closest('li'); const sel = fb ? '.c3-fbli' : '.c3-card';
    LPT = { x: ev.clientX, y: ev.clientY, pid: ev.pointerId, m, li, fb, sel, armed: false, dragging: false };
    LPT.t1 = setTimeout(() => { if (!LPT) return; LPT.armed = true; li.classList.add('lifted'); LPT.t2 = setTimeout(lpMenu, 300); }, 300);
  });
  document.addEventListener('pointermove', (ev) => {
    if (!LPT || ev.pointerId !== LPT.pid) return; const d = Math.hypot(ev.clientX - LPT.x, ev.clientY - LPT.y);
    if (!LPT.armed) { if (d > 10) lpClear(); return; }
    if (!LPT.dragging && d > 8) { clearTimeout(LPT.t2); LPT.dragging = true; const l = LPT; lpClear(); S3.noClick = true; dragReorder({ pointerId: l.pid, clientY: l.y }, l.li, l.sel, (f, t) => (l.fb ? fbReorder(f, t) : cxReorder(f, t))); }
  }, true);
  const end = (ev) => { if (!LPT || ev.pointerId !== LPT.pid) return; if (LPT.armed && !LPT.dragging) lpMenu(); else lpClear(); };
  document.addEventListener('pointerup', end, true); document.addEventListener('pointercancel', () => lpClear(), true);
  sc.addEventListener('touchmove', (ev) => { if ((LPT && LPT.armed) || DR) { if (ev.cancelable) ev.preventDefault(); } }, { passive: false });
}
function lpMenu() {
  const l = LPT; if (!l) return; lpClear(); l.li.classList.remove('lifted'); S3.noClick = true; setTimeout(() => { S3.noClick = false; }, 400);
  if (l.fb) fbMenu(l.m.dataset.mid, l.m, null, l.m); else cardMenu(l.m.dataset.cx, $('.c3-more', l.li), null, l.m);
}
function fbReorder(from, to) { const id = S3.fb; const l = fbList(id); const mid = l[from]; if (mid === undefined) return; l.splice(from, 1); l.splice(to, 0, mid); const m = modelById(mid); fbCommit(id, l, t3('fbMoved', m ? mname(m) : mid, to + 1, l.length)); const e = $(`.c3-fbmain[data-mid="${CSS.escape(mid)}"]`); if (e) { $$('[data-fbrv]').forEach((x) => { x.tabIndex = -1; }); e.tabIndex = 0; e.focus({ preventScroll: true }); } }

/* ------------------------------------------------------------------ connections: list (section 연결) and detail page */
function crumbHTML(parts, cur) {
  return `<nav class="ps-crumb" aria-label="${esc(t3('crumbNav'))}"><ol>${parts.map(([lab, act]) => `<li><button type="button" data-c3="${act}">${esc(lab)}</button></li>`).join('')}<li aria-current="page">${esc(cur)}</li></ol></nav>`;
}
function provIconOf(c) { return PROV[c.provider].icon; }
function cardHTML(c, i) {
  const ki = keyInfo(c); const p = problemOfConn(c); const use = presetsUsing(c.id); const tg = S3.testing[c.id];
  const keyTxt = ki.kind === 'env' ? ki.text : ki.text;
  const warnReason = p ? { noKey: t3('keyMissing'), keyAgain: t3('keyAgain'), badkey: t3('testBadKey'), unreachable: t3('testUnreachable'), quota: t3('testQuota') }[p.code] : '';
  return `<li class="c3-card${p ? ' bad' : ''}" data-part="settings-connection-card" data-cx="${esc(c.id)}" data-row="models.cx.${esc(c.id)}"><span class="c3-grip" data-cxgrip aria-hidden="true" title="${esc(t3('grip'))}">${ic('grip-vertical', 'lg')}</span>` +
    `<button type="button" data-part="settings-connection-card-main" class="c3-cmain" data-ctl data-c3="open" data-cx="${esc(c.id)}" data-cxrv tabindex="-1"><span class="c3-cic">${ic(provIconOf(c), 'xl')}</span><span class="c3-ctx"><span data-part="settings-connection-card-name" class="c3-cname">${esc(c.name)}</span>` +
    `<span class="c3-csub">${c.name.trim().toLowerCase() === provLabel(c.provider).toLowerCase() ? '' : `<span>${esc(provLabel(c.provider))}</span>`}<span class="c3-key" data-kind="${ki.kind}">${ki.kind === 'env' ? ic('variable', 'inline') : ''}${esc(keyTxt)}</span></span>` +
    `<span data-part="settings-connection-card-status"${p ? ' data-part-critical' : ''} class="c3-cstat" data-testing="${tg ? 1 : 0}">${tg ? ic('loader', 'inline', 'c3-spin') : ''}${esc(testShort(c))}</span><span class="c3-cuse">${esc(use ? t3('usedBy', use) : t3('notUsed'))}</span>` +
    `${p ? `<span class="c3-cwarn" data-part="settings-connection-warning" data-part-critical>${ic('circle-alert', 'sm')}<span>${esc(warnReason)}</span></span>` : ''}</span></button>` +
    `${tg ? `<button type="button" data-part="settings-button" class="btn c3-test" data-c3="testcancel" data-cx="${esc(c.id)}" aria-label="${esc(t3('testCancel') + ': ' + c.name)}" title="${esc(t3('testCancel'))}">${ic('x', 'lg')}</button>` : `<button type="button" data-part="settings-button" class="btn c3-test" data-c3="test" data-cx="${esc(c.id)}" aria-label="${esc(t3('test') + ': ' + c.name)}" title="${esc(t3('test'))}">${ic('plug-zap', 'lg')}</button>`}` +
    `<button type="button" data-part="settings-button" class="btn c3-more" data-c3="cmenu" data-cx="${esc(c.id)}" aria-haspopup="menu" aria-label="${esc(t3('cardMenu', c.name))}" title="${esc(t3('cardMenu', c.name))}">${ic('ellipsis', 'xl')}</button></li>`;
}
function connListBody() {
  const note = A.ROW['models.hideApiKey'];
  let h = S3.migrated && !S3.migDismissed ? `<div class="row c3-migrate" data-part="settings-migration-notice" data-row="models.migrated" role="status">${ic('info', 'lg')}<p>${esc(t3('migratedNote', S3.migrated.length))} · <button type="button" class="c3-linkbtn" data-ctl data-c3="migrename">${esc(t3('migratedRename'))}</button></p><button type="button" data-part="settings-button" class="btn" data-c3="migdismiss" aria-label="${esc(t3('migratedClose'))}" title="${esc(t3('migratedClose'))}">${ic('x', 'lg')}</button></div>` : '';
  h += `<div data-part="settings-row" class="row row-note" data-row="models.hideApiKey">${ic('info', 'lg')}<p>${esc(A.L(note))}</p></div>`;
  if (!CX.length) h += `<div class="c3-empty" data-row="models.connEmpty"><p>${esc(t3('noConnections'))}</p></div>`;
  else h += `<ul class="c3-cx" id="c3Cx" data-part="settings-connection-list" role="list" aria-label="${esc(t3('listLabel'))}">${CX.map(cardHTML).join('')}</ul>`;
  h += `<div data-part="settings-row" class="row row-link" data-row="models.connAdd"><button type="button" class="rl" data-ctl data-c3="add"><span class="rl-ic">${ic('plus', 'xl')}</span><span class="r-text"><span data-part="settings-row-label" class="r-label">${esc(t3('addConn'))}</span></span></button></div>`;
  const svc = D3.SERVICE_ROWS.map((id) => A.ROW[id]).filter(Boolean);
  h += `<div class="c3-grp" data-part="settings-model-group" role="group" aria-labelledby="c3gh-svc"><h3 class="c3-gh" id="c3gh-svc"><span>${esc(t3('otherServices'))}</span></h3><p data-part="settings-row-description" class="r-desc c3-gnote">${esc(t3('otherServicesNote'))}</p>${svc.map((r) => `<div class="row c3-svc" data-part="settings-row" data-row="${esc(r.id)}"><div class="r-main"><div class="r-text"><span data-part="settings-row-label" class="r-label">${esc(A.L(r))}</span></div><div data-part="settings-row-control" class="r-ctl"><span class="c3-key" data-kind="${r.v ? 'set' : 'none'}">${esc(r.type === 'secret' ? (r.v ? '•••• ' + String(r.v).slice(-4) : t3('keyMissing')) : (r.v ? String(r.v).replace(/^(.{14}).*$/, '$1…') : t3('keyMissing')))}</span></div></div></div>`).join('')}</div>`;
  return h;
}
function drow(id, label, ctl, desc, cls = '') {
  return `<div data-part="settings-row" data-part="settings-row" class="row c3-drow ${cls}" data-row="${id}" role="group" aria-labelledby="l-${id}"><div class="r-main"><div class="r-text"><div class="r-title"><span data-part="settings-row-label" class="r-label" id="l-${id}">${esc(label)}</span></div>${desc ? `<p data-part="settings-row-description" class="r-desc">${desc}</p>` : ''}</div><div data-part="settings-row-control" class="r-ctl">${ctl}</div></div></div>`;
}
const selectHTML = (id, f, opts, val, label) => `<select id="${id}" data-part="settings-field" class="inp" data-ctl data-c3="field" data-f="${f}" aria-label="${esc(label)}">${opts.map((o) => `<option value="${esc(o[0])}"${o[0] === val ? ' selected' : ''}>${esc(KO() ? o[1] : o[2])}</option>`).join('')}</select>`;
function keyRowHTML(c) {
  const ki = keyInfo(c); const editing = S3.keyEdit === c.id;
  let ctl = '';
  if (editing) ctl = `<form class="c3-keyform" data-c3form="key" autocomplete="off"><label class="sr-only" for="c3KeyIn">${esc(t3('keyNew'))}</label><input id="c3KeyIn" data-ctl data-part="settings-field" class="inp" type="password" autocomplete="new-password" spellcheck="false" data-secret placeholder="${esc(t3('keyPaste'))}" aria-describedby="c3KeyNote${fixDesc()}"><button type="button" data-part="settings-button" class="btn solid accent" data-c3="keysave" aria-disabled="true" aria-label="${esc(t3('saveKey'))}" title="${esc(t3('saveKey'))}">${ic('check', 'lg')}</button><button type="button" data-part="settings-button" class="btn" data-c3="keycancel" aria-label="${esc(t3('cancel'))}" title="${esc(t3('cancel'))}">${ic('x', 'lg')}</button></form>`;
  else ctl = `<span class="c3-keyv" data-kind="${ki.kind}">${ki.kind === 'env' ? ic('variable', 'md') : ''}<span class="c3-keytxt">${esc(ki.text)}</span></span><span class="c3-keyctl"><button type="button" data-part="settings-button" class="btn c3-kb" data-ctl data-c3="keyedit" aria-label="${esc((hasKey(c) ? t3('changeKey') : t3('setKey')) + ': ' + c.name)}" title="${esc(hasKey(c) ? t3('changeKey') : t3('setKey'))}">${ic('key-round', 'lg')}<span class="c3-kbt">${esc(hasKey(c) ? t3('changeKey') : t3('setKey'))}</span></button><button type="button" data-part="settings-button" class="btn c3-kb danger" data-c3="keyclear" aria-disabled="${hasKey(c) ? 'false' : 'true'}" aria-label="${esc(t3('clearKey') + ': ' + c.name)}" title="${esc(t3('clearKey'))}">${ic('trash-2', 'lg')}<span class="c3-kbt">${esc(t3('clearKey'))}</span></button></span>`;
  const desc = `<span class="c3-keylocal">${esc(t3('keyLocal'))}</span>${ki.kind === 'env' ? `<span class="c3-keylocal">${esc(A.L(A.ROW['models.envNote']))}</span>` : ''}<span class="c3-keynote" id="c3KeyNote">${esc(t3('keyNoUndo'))}</span>`;
  return drow('c3.key', t3('key'), ctl, desc, 'c3-keyrow');
}
function fieldRows(c) {
  const P = PROV[c.provider]; let h = '';
  if (P.url) h += drow('c3.url', t3('url'), `<input type="text" id="c3Url" data-part="settings-field" class="inp" data-ctl data-c3="field" data-f="url" value="${esc(c.url)}" inputmode="url" autocomplete="off" spellcheck="false" aria-label="${esc(t3('url'))}"${fixDesc() ? ' aria-describedby="c3FixBanner"' : ''}>`);
  const f = P.fields || [];
  if (f.includes('format')) h += drow('c3.format', t3('format'), selectHTML('c3Format', 'format', D3.FORMATS, c.format, t3('format')));
  if (f.includes('tokenizer')) h += drow('c3.tokenizer', t3('tokenizer'), selectHTML('c3Tok', 'tokenizer', D3.TOKENIZERS, c.tokenizer, t3('tokenizer')));
  if (f.includes('project')) h += drow('c3.project', t3('project'), `<input type="text" data-part="settings-field" class="inp" data-c3="field" data-f="project" value="${esc(c.project)}" autocomplete="off" spellcheck="false" aria-label="${esc(t3('project'))}">`) + drow('c3.email', t3('email'), `<input type="text" data-part="settings-field" class="inp" data-c3="field" data-f="email" value="${esc(c.email)}" autocomplete="off" spellcheck="false" aria-label="${esc(t3('email'))}">`);
  if (f.includes('region')) h += drow('c3.region', t3('region'), selectHTML('c3Region', 'region', [['global', 'global', 'global'], ['us-central1', 'us-central1', 'us-central1'], ['us-west1', 'us-west1', 'us-west1']], c.region, t3('region')));
  if (f.includes('ollamaFormat')) h += drow('c3.ollamaFormat', t3('ollamaFormat'), selectHTML('c3OFmt', 'ollamaFormat', [['native', t3('fOllamaNative'), t3('fOllamaNative')], ['openai', t3('fOllamaOpenai'), t3('fOllamaOpenai')]], c.ollamaFormat, t3('ollamaFormat')));
  if (f.includes('sub')) h += drow('c3.sub', t3('sub'), `<span class="sw" data-part="settings-toggle"><input type="checkbox" role="switch" data-ctl data-c3="field" data-f="sub" aria-label="${esc(t3('sub'))}" ${c.sub ? 'checked' : ''}><span class="sw-ui" aria-hidden="true"></span></span>`);
  return h;
}
function testRowHTML(c) {
  const tg = S3.testing[c.id]; const t = c.test;
  const res = tg ? `<span data-part="settings-test-result" class="c3-tres run">${ic('loader', 'md', 'c3-spin')}<span>${esc(t3('testing'))}</span></span>` : `<span data-part="settings-test-result"${t && t.res !== 'ok' ? ' data-part-critical' : ''} class="c3-tres ${t ? t.res : 'none'}">${t ? ic(t.res === 'ok' ? 'circle-check' : 'circle-alert', 'md') : ''}<span>${esc(testText(c))}${t ? ' · ' + esc(fmtAgo(t.at)) + (t.res === 'ok' && t.ms ? ' · ' + t.ms + ' ms' : '') : ''}</span></span>`;
  const btn = tg ? `<button type="button" data-part="settings-button" class="btn solid" data-ctl data-c3="testcancel" data-cx="${esc(c.id)}" aria-label="${esc(t3('testCancel'))}" title="${esc(t3('testCancel'))}">${ic('x', 'lg')}<span>${esc(t3('cancel'))}</span></button>` : `<button type="button" data-part="settings-button" class="btn solid accent" data-ctl data-c3="test" data-cx="${esc(c.id)}" id="c3TestBtn" aria-label="${esc(t3('test') + ': ' + c.name)}" title="${esc(t3('test'))}">${ic('plug-zap', 'lg')}<span>${esc(t3('test'))}</span></button>`;
  return `<div data-part="settings-row" data-part="settings-row" class="row c3-drow c3-testrow" data-row="c3.test" id="c3Test" role="group" aria-labelledby="l-c3.test"><div class="r-main"><div class="r-text"><div class="r-title"><span data-part="settings-row-label" class="r-label" id="l-c3.test">${esc(t3('testRow'))}</span></div><p data-part="settings-row-description" class="r-desc">${esc(t3('testHelp'))}</p><p class="c3-tline" role="status" aria-live="polite">${res}</p></div><div data-part="settings-row-control" class="r-ctl">${btn}</div></div></div>`;
}
function customListHTML(c) {
  const ms = D.models.filter((m) => m.conn === c.id && m.custom);
  const li = ms.map((m) => `<li data-part="settings-connection-model" class="c3-cm" data-mid="${esc(m.id)}"><span class="c3-cmt"><span class="c3-cmn">${esc(m.name)}</span><span class="c3-cmi">${esc(m.id)} · ${esc(fmtCtx(m.ctx))}</span></span><span class="mp-tag tag-custom">${esc(t3('tagCustom'))}</span><button type="button" data-part="settings-button" class="btn c3-more" data-c3="cmmenu" data-mid="${esc(m.id)}" aria-haspopup="menu" aria-label="${esc(t3('cardMenu', m.name))}" title="${esc(t3('cardMenu', m.name))}">${ic('ellipsis', 'xl')}</button></li>`).join('');
  return `<div data-part="settings-row" data-part="settings-row" class="row c3-drow" data-row="c3.custom" role="group" aria-labelledby="l-c3.custom"><div class="r-main"><div class="r-text"><div class="r-title"><span data-part="settings-row-label" class="r-label" id="l-c3.custom">${esc(t3('customModels'))}</span></div></div></div>${ms.length ? `<ul class="c3-cml" role="list">${li}</ul>` : `<p data-part="settings-row-description" class="r-desc">${esc(t3('noCustom'))}</p>`}<button type="button" data-part="settings-button" class="btn solid c3-addm" data-ctl data-c3="addmodel" data-cx="${esc(c.id)}">${ic('plus', 'lg')}<span>${esc(t3('addModel'))}</span></button></div>`;
}
function usedListHTML(c) {
  const us = usersOf(c.id); const shown = us.slice(0, 5);
  const li = shown.map((u) => `<li><button type="button" class="c3-ulink" data-c3="usepreset" data-pid="${esc(u.p.id)}">${ic('bookmark', 'md')}<span class="c3-un">${esc(u.p.name)}</span><span class="c3-ur">${esc(u.rows.map(refLabel).join(' · '))}</span></button></li>`).join('');
  return `<div data-part="settings-row" data-part="settings-row" class="row c3-drow" data-row="c3.used" role="group" aria-labelledby="l-c3.used"><div class="r-main"><div class="r-text"><div class="r-title"><span data-part="settings-row-label" class="r-label" id="l-c3.used">${esc(t3('usedList'))}</span></div></div></div>${us.length ? `<ul class="c3-ul" role="list">${li}${us.length > 5 ? `<li class="c3-umore">${esc(t3('andMore', us.length - 5))}</li>` : ''}</ul>` : `<p data-part="settings-row-description" class="r-desc">${esc(t3('usedNone'))}</p>`}</div>`;
}
const OPT_DEF = {};   // the values the option rows had at start-up: what a connection without its own value shows
function loadOpts(c) { D3.OPTION_ROWS.forEach((id) => { if (D3.OPTION_PROV[id] === c.provider && A.ROW[id]) A.ROW[id].v = c.opts && id in c.opts ? c.opts[id] : OPT_DEF[id]; }); }
function optionsSection(c) {   // DS-059 / DS-061: routing options live on the connection, and their values are the connection's own
  loadOpts(c);   // DS-059: routing and provider options belong to the connection; they show only on a connection of that provider
  const rows = D3.OPTION_ROWS.filter((id) => D3.OPTION_PROV[id] === c.provider).map((id) => A.ROW[id]).filter(Boolean); if (!rows.length) return '';
  return `<section data-part="settings-section" class="sec" aria-labelledby="c3h-opt"><h2 data-part="settings-section-title" class="sec-h" id="c3h-opt" tabindex="-1">${esc(t3('providerOptions'))}</h2><div data-part="settings-rows" class="rows">${rows.map((r) => A.rowHTML(r)).join('')}</div></section>`;
}
function connPageHTML() {
  const c = cx(S3.conn); if (!c) return null; const P = PROV[c.provider];
  const refresh = P.list ? `<div data-part="settings-row" data-part="settings-row" class="row c3-drow" data-row="c3.refresh" role="group" aria-labelledby="l-c3.refresh"><div class="r-main"><div class="r-text"><div class="r-title"><span data-part="settings-row-label" class="r-label" id="l-c3.refresh">${esc(t3('refreshList'))}</span></div><p data-part="settings-row-description" class="r-desc">${esc(t3('modelCount', D.models.filter((m) => m.conn === c.id && !m.custom).length))}</p></div><div data-part="settings-row-control" class="r-ctl"><button type="button" data-part="settings-button" class="btn solid" data-ctl data-c3="refresh" data-cx="${esc(c.id)}" aria-label="${esc(t3('refreshList'))}" title="${esc(t3('refreshList'))}" id="c3Refresh">${ic('refresh-cw', 'lg', S3.refreshing === c.id ? 'c3-spin' : '')}</button></div></div></div>`
    + drow('c3.auto', t3('autoFetch'), `<span class="sw" data-part="settings-toggle"><input type="checkbox" role="switch" data-ctl data-c3="field" data-f="autoFetch" aria-label="${esc(t3('autoFetch'))}" ${c.autoFetch ? 'checked' : ''}><span class="sw-ui" aria-hidden="true"></span></span>`)
    : drow('c3.refresh', t3('refreshList'), `<span class="c3-keytxt">${esc(t3('noListApi'))}</span>`);
  const nameCtl = `<span class="c3-nm" id="c3Name">${esc(c.name)}</span><button type="button" data-part="settings-button" class="btn c3-kb" data-ctl data-c3="rename" aria-label="${esc(t3('rename') + ': ' + c.name)}" title="${esc(t3('rename') + (matchMedia('(pointer: coarse)').matches ? '' : ' (F2)'))}">${ic('pencil', 'lg')}</button>`;
  return `<div class="pg c3-pg" data-part="settings-connection-detail" data-page="models" data-view="conn" data-cx="${esc(c.id)}"><div data-part="settings-page-header" class="pg-head">${crumbHTML([[t3('crumbModels'), 'crumb-models'], [t3('crumbConn'), 'crumb-list']], c.name)}<h1 class="pg-title" id="pgTitle" tabindex="-1">${esc(c.name)}</h1></div>` +
    `<section data-part="settings-section" class="sec" aria-label="${esc(c.name)}"><div data-part="settings-rows" class="rows">${drow('c3.name', t3('name'), nameCtl)}${drow('c3.provider', t3('provider'), `<span class="c3-prov-v">${ic(provIconOf(c), 'md')}<span>${esc(provLabel(c.provider))}</span></span>`, esc(t3('providerFixed')))}${keyRowHTML(c)}${fieldRows(c)}${testRowHTML(c)}</div></section>` +
    `<section data-part="settings-section" class="sec" aria-labelledby="c3h-models"><h2 data-part="settings-section-title" class="sec-h" id="c3h-models" tabindex="-1">${esc(t3('models'))}</h2><div data-part="settings-rows" class="rows">${refresh}${customListHTML(c)}</div></section>` +
    optionsSection(c) +
    `<section data-part="settings-section" class="sec" aria-labelledby="c3h-used"><h2 data-part="settings-section-title" class="sec-h" id="c3h-used" tabindex="-1">${esc(t3('usedList'))}</h2><div data-part="settings-rows" class="rows">${usedListHTML(c)}</div></section>` +
    `<section data-part="settings-section" class="sec" aria-label="${esc(t3('delConn'))}"><div data-part="settings-rows" class="rows"><div data-part="settings-row" class="row row-link c3-danger" data-row="c3.delete"><button type="button" class="rl" data-ctl data-c3="delete" data-cx="${esc(c.id)}">${ic('trash-2', 'xl')}<span class="r-text"><span data-part="settings-row-label" class="r-label">${esc(t3('delConn'))}</span></span></button></div></div></section></div>`;
}
function paintConn(id) {   // repaint the card in the list and the detail test line / buttons without losing focus
  if (!A.S.open) return;
  const li = $(`.c3-card[data-cx="${CSS.escape(id)}"]`); const c = cx(id);
  if (li && c) { const had = li.contains(document.activeElement); const fk = had ? (document.activeElement.dataset.c3 || '') : ''; const tmp = document.createElement('ul'); tmp.innerHTML = cardHTML(c); const nl = tmp.firstElementChild; const rv = $('[data-cxrv]', li); nl.querySelector('[data-cxrv]').tabIndex = rv ? rv.tabIndex : -1; li.replaceWith(nl); if (had) { const f = $(`[data-c3="${fk}"]`, nl) || $('[data-cxrv]', nl); if (f) f.focus({ preventScroll: true }); } }
  if (S3.view === 'conn' && S3.conn === id && c) { const old = $('#c3Test'); if (old) { const had = old.contains(document.activeElement); const tmp = document.createElement('div'); tmp.innerHTML = testRowHTML(c); old.replaceWith(tmp.firstElementChild); if (had) { const f = $('#c3TestBtn') || $('#c3Test [data-ctl]'); if (f) f.focus({ preventScroll: true }); } } const kr = $('[data-row="c3.key"]'); if (kr && S3.keyEdit !== id) { const tmp = document.createElement('div'); tmp.innerHTML = keyRowHTML(c); kr.replaceWith(tmp.firstElementChild); } const ur = $('[data-row="c3.used"]'); void ur; }
}

/* ------------------------------------------------------------------ cards: reorder, menu, rename */
function cxReorder(from, to) {
  const before = CX.slice(); const c = CX[from]; if (!c) return false; CX.splice(from, 1); CX.splice(to, 0, c);
  B.pushLU(t3('labConnField', c.name, KO() ? '순서' : 'order'), () => { before.forEach((x, i) => { const k = CX.indexOf(x); if (k >= 0) { CX.splice(k, 1); CX.splice(Math.min(i, CX.length), 0, x); } }); refreshIndexData(); repaintAll(); return ''; }, 'conn-move', { conn: c.id });
  bump(); refreshIndexData(); B.announce(t3('moveAnn', c.name, to + 1, CX.length)); repaintAll(); focusCard(c.id); return true;
}
function moveCx(id, dir) {
  const i = CX.findIndex((c) => c.id === id); const j = i + dir; if (i < 0) return false;
  if (j < 0 || j >= CX.length) { B.announce(t3(dir < 0 ? 'atTop' : 'atBottom')); return false; }
  return cxReorder(i, j);
}
function focusCard(id) {
  const rv = $$('[data-cxrv]'); const e = $(`.c3-card[data-cx="${CSS.escape(id)}"] [data-cxrv]`); if (!e) return; rv.forEach((x) => { x.tabIndex = -1; }); e.tabIndex = 0; S3.cardRv = id; e.focus({ preventScroll: true }); e.scrollIntoView({ block: 'nearest' });
}
function cardMenu(id, anchor, point, opener) {
  const c = cx(id); if (!c) return; const i = CX.indexOf(c);
  A.showMenu([
    { icon: 'chevron-right', label: t3('menuOpen'), fn: () => openConn(id) },
    { icon: 'plug-zap', label: t3('menuTest'), disabled: !!S3.testing[id], fn: () => { startTest(c); } },
    { icon: 'pencil', label: t3('menuRename') + (matchMedia('(pointer: coarse)').matches ? '' : ' (F2)'), fn: () => startRenameCx(id, 'card') },
    { icon: 'arrow-up', label: t3('menuUp'), disabled: i === 0, fn: () => moveCx(id, -1) },
    { icon: 'arrow-down', label: t3('menuDown'), disabled: i === CX.length - 1, fn: () => moveCx(id, 1) },
    { icon: 'trash-2', label: t3('menuDelete'), fn: () => openDeleteDialog(id) },
  ], anchor, point, opener, t3('cardMenu', c.name));
}
function startRenameCx(id, ctx) {
  const c = cx(id); if (!c) return false; let host, nameEl, main;
  if (ctx === 'detail') { nameEl = $('#c3Name'); host = nameEl && nameEl.parentElement; } else { host = $(`.c3-card[data-cx="${CSS.escape(id)}"]`); main = host && $('.c3-cmain', host); }
  if (!host || (!nameEl && !main)) return false;
  const inp = document.createElement('input'); inp.type = 'text'; inp.className = 'inp c3-rename'; inp.value = c.name; inp.maxLength = NAME_MAX; inp.autocomplete = 'off'; inp.spellcheck = false; inp.setAttribute('aria-label', t3('rename') + ': ' + c.name); inp.title = c.name;
  const warn = document.createElement('span'); warn.className = 'ps-dupwarn'; warn.setAttribute('role', 'status'); warn.hidden = true; warn.textContent = t3('duplicateName');
  inp.addEventListener('input', () => { warn.hidden = !(inp.value.trim() && nameTaken(inp.value, id)); }); const cnt = B.nameCounter(inp);
  let done = false;
  const finish = (commit) => {
    if (done) return; done = true; const v = inp.value.trim(); inp.remove(); warn.remove(); cnt.remove(); if (nameEl) nameEl.hidden = false; if (main) main.hidden = false;
    if (commit && v && v !== c.name) { setField(c, 'name', v.slice(0, NAME_MAX)); B.announce(t3('connRenamed', c.name)); }
    repaintAll();
    if (ctx === 'detail') { const b = $('[data-c3="rename"]'); if (b) b.focus({ preventScroll: true }); } else focusCard(id);
  };
  inp.addEventListener('keydown', (ev) => { if (ev.isComposing || ev.keyCode === 229) return; if (ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); finish(true); } else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); finish(false); } else ev.stopPropagation(); });
  inp.addEventListener('blur', () => finish(true));
  if (nameEl) { nameEl.hidden = true; nameEl.after(inp); inp.after(warn); warn.after(cnt); } else { main.hidden = true; main.before(inp); host.after(warn); warn.after(cnt); }
  inp.focus(); inp.select(); return true;
}

/* ------------------------------------------------------------------ dialogs (built on slice 1's openDialog: focus trap, Esc, inert page) */
function dlgFoot(d, buttons) { $('.dlg-f', d.back).innerHTML = buttons.map((b) => `<button type="button" data-part="settings-button" class="btn ${b.primary ? 'accent solid' : b.danger ? 'danger solid' : 'solid'}" data-dlg="${b.id}"${b.disabled ? ' aria-disabled="true"' : ''}>${esc(b.label)}</button>`).join(''); }
function openAddDialog(o = {}) {
  const reopen = o.reopen || null; let prov = o.provider || null; let q = '';
  const d = A.openDialog({ title: t3('addConn'), body: '<div id="c3AddBody"></div>', buttons: [{ id: 'cancel', label: t3('cancel') }], initial: '#c3PQ' });
  const body = () => $('#c3AddBody', d.back);
  const gname = { cloud: 'pgCloud', router: 'pgRouter', local: 'pgLocal', compat: 'pgCompat' };
  const step1 = () => {
    const words = q.trim().split(/\s+/).map(A.normWord).filter(Boolean); let any = false;
    const hit = (p) => { const hay = A.normWord((p.ko + ' ' + p.en + ' ' + (p.kw || ''))); return words.every((w) => hay.includes(w) || (JAMO.test(w) && [...hay].map((c) => A.cho(c)).join('').includes(w))); };
    const groups = PGROUPS.map(([g]) => { const l = PROVIDERS.filter((p) => p.grp === g && hit(p)); if (l.length) any = true; return l.length ? `<div role="group" aria-labelledby="c3pg-${g}"><div class="sw-gh" id="c3pg-${g}">${esc(t3(gname[g]))}</div>${l.map((p) => `<button type="button" class="c3-prov" data-prov="${p.id}">${ic(p.icon, 'lg')}<span>${esc(provLabel(p.id))}</span></button>`).join('')}</div>` : ''; }).join('');
    body().innerHTML = `<label class="dlg-l" for="c3PQ">${esc(t3('providerSearch'))}</label><input id="c3PQ" data-part="settings-field" class="inp" type="text" autocomplete="off" spellcheck="false" value="${esc(q)}"><div class="c3-provs" role="group" aria-label="${esc(t3('addStepProvider'))}">${groups || `<p class="dlg-hint" role="status">${esc(t3('providerNone'))}</p>`}</div>`;
    dlgFoot(d, [{ id: 'cancel', label: t3('cancel') }]); A.openDialog.handlers = {};
  };
  let nameV = '', keyV = '';
  const step2 = () => {
    const P = PROV[prov]; const f = P.fields || []; const first = !nameV; if (first) nameV = uniqueName(provLabel(prov));
    let h = `<p class="c3-pchosen">${ic(P.icon, 'lg')}<strong>${esc(provLabel(prov))}</strong><button type="button" data-part="settings-button" class="btn c3-pback" data-c3d="back" aria-label="${esc(t3('changeProvider'))}" title="${esc(t3('changeProvider'))}">${ic('arrow-left', 'lg')}</button></p>`;
    h += `<label class="dlg-l" for="c3AName">${esc(t3('name'))}</label><input id="c3AName" data-part="settings-field" class="inp" type="text" maxlength="${NAME_MAX}" autocomplete="off" spellcheck="false" value="${esc(nameV)}" aria-describedby="c3ADup c3ACnt"><p class="dlg-hint warn" id="c3ADup" role="status" hidden>${esc(t3('duplicateName'))}</p><p class="dlg-hint dlg-count" id="c3ACnt" hidden></p>`;
    if (P.key !== 'none') h += `<label class="dlg-l" for="c3AKey">${esc(t3('key'))}${P.key === 'opt' ? ' ' + (KO() ? '(선택)' : '(optional)') : ''}</label><input id="c3AKey" data-part="settings-field" class="inp" type="password" autocomplete="new-password" spellcheck="false" data-secret value="${esc(keyV)}"><p class="dlg-hint">${esc(t3('keyLocal'))}</p>`;
    if (P.url) h += `<label class="dlg-l" for="c3AUrl">${esc(t3('url'))}</label><input id="c3AUrl" data-part="settings-field" class="inp" type="text" inputmode="url" autocomplete="off" spellcheck="false" value="${esc(o.url || '')}" aria-describedby="c3AUrlMsg"><p class="dlg-hint warn" id="c3AUrlMsg" role="alert" hidden></p>`;
    if (f.includes('format')) h += `<label class="dlg-l" for="c3AFmt">${esc(t3('format'))}</label>${selectHTML('c3AFmt', 'format', D3.FORMATS, 'openai', t3('format')).replace(' data-ctl data-c3="field" data-f="format"', '')}`;
    if (f.includes('tokenizer')) h += `<label class="dlg-l" for="c3ATok">${esc(t3('tokenizer'))}</label>${selectHTML('c3ATok', 'tokenizer', D3.TOKENIZERS, 'auto', t3('tokenizer')).replace(' data-ctl data-c3="field" data-f="tokenizer"', '')}`;
    if (f.includes('project')) h += `<label class="dlg-l" for="c3AProj">${esc(t3('project'))}</label><input id="c3AProj" data-part="settings-field" class="inp" type="text" autocomplete="off" spellcheck="false"><label class="dlg-l" for="c3AMail">${esc(t3('email'))}</label><input id="c3AMail" data-part="settings-field" class="inp" type="text" autocomplete="off" spellcheck="false">`;
    if (f.includes('region')) h += `<label class="dlg-l" for="c3AReg">${esc(t3('region'))}</label><select id="c3AReg" data-part="settings-field" class="inp"><option>global</option><option>us-central1</option><option>us-west1</option></select>`;
    body().innerHTML = h;
    dlgFoot(d, [{ id: 'cancel', label: t3('cancel') }, { id: 'save', label: t3('save'), disabled: !nameV.trim() }, { id: 'savetest', label: t3('saveAndTest'), primary: true, disabled: !nameV.trim() }]);
    const ni = $('#c3AName', d.back); const upd = () => { nameV = ni.value; const ok = !!ni.value.trim(); $$('[data-dlg="save"],[data-dlg="savetest"]', d.back).forEach((b) => b.setAttribute('aria-disabled', ok ? 'false' : 'true')); $('#c3ADup', d.back).hidden = !(ok && nameTaken(ni.value)); }; ni.addEventListener('input', upd); B.nameCounter(ni, $('#c3ACnt', d.back));
    const doSave = (test) => () => {
      const nm = ni.value.trim(); if (!nm) return false; const fields = {};
      if (P.url) { const u = ($('#c3AUrl', d.back).value || '').trim(); if (!/^https?:\/\/[^\s/]+\S*$/i.test(u)) { const mg = $('#c3AUrlMsg', d.back), ui = $('#c3AUrl', d.back); mg.hidden = false; mg.textContent = t3('urlNeeded'); ui.setAttribute('aria-invalid', 'true'); ui.focus(); return false; } fields.url = u; }   // R-13: the address is the one required field of these providers
      if ($('#c3AFmt', d.back)) fields.format = $('#c3AFmt', d.back).value; if ($('#c3ATok', d.back)) fields.tokenizer = $('#c3ATok', d.back).value;
      if ($('#c3AProj', d.back)) { fields.project = $('#c3AProj', d.back).value; fields.email = $('#c3AMail', d.back).value; fields.region = $('#c3AReg', d.back).value; }
      const key = $('#c3AKey', d.back) ? $('#c3AKey', d.back).value.trim() : ''; if ($('#c3AKey', d.back)) $('#c3AKey', d.back).value = '';
      setTimeout(() => { const c = addConn({ provider: prov, name: nm.slice(0, NAME_MAX), fields, key }); if (test) startTest(c); if (reopen) { const m = openPicker({ rowId: reopen.rowId, add: reopen.add, q: reopen.q || '', focus: reopen.base ? refOf(c.id, reopen.base) : null }); void m; } else if (A.S.open && S3.view === 'section' && CX.length) focusCard(c.id); }, 0);
    };
    A.openDialog.handlers = { save: doSave(false), savetest: doSave(true) };
    ni.focus(); ni.select();
    ni.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && !ev.isComposing && ev.keyCode !== 229 && ni.value.trim()) { ev.preventDefault(); $('[data-dlg="savetest"]', d.back).click(); } });
  };
  d.back.addEventListener('click', (ev) => { const p = ev.target.closest('[data-prov]'); if (p) { prov = p.dataset.prov; step2(); return; } if (ev.target.closest('[data-c3d="back"]')) { step1(); const i = $('#c3PQ', d.back); if (i) i.focus(); } });
  d.back.addEventListener('input', (ev) => { if (ev.target.id === 'c3PQ') { q = ev.target.value; const pos = ev.target.selectionStart; const keep = $('.c3-provs', d.back); const tmp = document.createElement('div'); void tmp; step1(); const i = $('#c3PQ', d.back); i.focus(); i.setSelectionRange(pos, pos); void keep; } });
  d.back.addEventListener('keydown', (ev) => { if (ev.target.id === 'c3PQ' && ev.key === 'Enter' && !ev.isComposing) { const f = $('.c3-prov', d.back); if (f) { ev.preventDefault(); f.click(); } } });
  if (prov) step2(); else { step1(); const i = $('#c3PQ', d.back); if (i) i.focus(); }
  return d;
}
function openDeleteDialog(id) {
  const c = cx(id); if (!c) return null; const us = usersOf(id); const shown = us.slice(0, 5);
  let body;
  if (!us.length) body = `<p>${esc(isEnv(KEYS[id]) ? (KO() ? '이 연결을 쓰는 프리셋이 없어요.' : 'No preset uses this connection.') : (KO() ? '이 연결을 쓰는 프리셋이 없어요. 지우면 이 연결에 넣은 키도 함께 지워져요.' : 'No preset uses this connection. Its key is removed with it.'))}</p>`;
  else body = `<p class="c3-usedh" id="c3UsedH">${esc(t3('usedHere'))}</p><ul class="c3-ul" aria-labelledby="c3UsedH" role="list">${shown.map((u) => `<li><span class="c3-un" title="${esc(u.p.name)}">${esc(u.p.name)}</span><span class="c3-ur">${esc(u.rows.map(refLabel).join(' · '))}</span></li>`).join('')}${us.length > 5 ? `<li class="c3-umore" id="c3UsedMore">${esc(t3('andMore', us.length - 5))}</li>` : ''}</ul><p class="dlg-hint">${esc(KO() ? ('지운 뒤에는 이 프리셋들에 ‘연결 없음’ 표시가 붙어요. 실행 취소로 되돌릴 수 있어요.' + (isEnv(KEYS[id]) ? '' : ' 키는 다시 넣어야 해요.')) : ('These presets show "No connection" afterwards. Undo brings it back.' + (isEnv(KEYS[id]) ? '' : ' You have to enter the key again.')))}</p>`;
  if (isEnv(KEYS[id])) body += `<p class="dlg-hint" id="c3EnvNote">${esc(t3('envUndoNote'))}</p>`;   // DS-058: only when the key is a reference
  const d = A.openDialog({ critical: true, title: t3('deleteConnQ', cl(c.name, 40)), body, buttons: [{ id: 'cancel', label: t3('cancel') }, { id: 'del', label: t3('clearBtn'), danger: true }], initial: '[data-dlg="cancel"]' });
  $('[data-dlg="del"]', d.back).textContent = KO() ? '지우기' : 'Delete';
  A.openDialog.handlers = { del: () => { setTimeout(() => { const keyNear = (CX[CX.indexOf(c) + 1] || CX[CX.indexOf(c) - 1] || {}).id; const wasDetail = S3.view === 'conn'; deleteConn(id); repaintAll(); if (wasDetail && A.S.open) closeSub(); else if (keyNear) focusCard(keyNear); else { const b = $('[data-c3="add"]'); if (b) b.focus({ preventScroll: true }); } }, 0); } };
  return d;
}
function openClearKeyDialog(id) {
  const c = cx(id); if (!c) return null; const nano = c.provider === 'nanogpt';
  const d = A.openDialog({ critical: true, title: t3('clearKeyQ'), body: `<p>${esc(t3('clearKeyBody'))}</p>${nano ? `<p class="dlg-hint warn" id="c3NanoWarn" role="note">${esc(t3('clearKeyNano'))}</p>` : ''}`, buttons: [{ id: 'cancel', label: t3('cancel') }, { id: 'clear', label: t3('clearBtn'), danger: true }], initial: '[data-dlg="cancel"]' });
  A.openDialog.handlers = { clear: () => { setTimeout(() => { clearKey(c); repaintAll(); B.announce(t3('keyCleared')); const b = $('[data-c3="keyedit"]'); if (b) b.focus({ preventScroll: true }); }, 0); } };
  return d;
}
function openCustomDialog(o = {}) {
  const edit = o.edit ? modelById(o.edit) : null; let connId = o.conn || (edit && edit.conn) || (CX[0] && CX[0].id);
  if (!connId) { B.psToast(t3('noConnections'), { kind: 'info', ms: 4000 }); return null; }
  const m = edit; const cur = (k, dflt) => (m ? m[k] : dflt);
  const capOn = (f) => !!(m && m.flags.includes(f));
  const d = A.openDialog({ title: edit ? t3('editModel') : t3('addModel'), body:
    `<label class="dlg-l" for="c3MConn">${esc(t3('pickConn'))}</label><select id="c3MConn" data-part="settings-field" class="inp"${edit ? ' disabled' : ''}>${CX.map((c) => `<option value="${esc(c.id)}"${c.id === connId ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select>` +
    `<label class="dlg-l" for="c3MId">${esc(t3('modelId'))}</label><input id="c3MId" data-part="settings-field" class="inp" type="text" autocomplete="off" spellcheck="false" value="${esc(edit ? edit.id : (o.id || ''))}"${edit ? ' readonly' : ''} aria-describedby="c3MHint"><p class="dlg-hint warn" id="c3MHint" role="status" hidden></p>` +
    `<label class="dlg-l" for="c3MName">${esc(t3('modelName'))}</label><input id="c3MName" data-part="settings-field" class="inp" type="text" autocomplete="off" spellcheck="false" maxlength="${NAME_MAX}" value="${esc(edit ? edit.name : '')}">` +
    `<label class="dlg-l" for="c3MCtx">${esc(t3('ctxLen'))}</label><input id="c3MCtx" data-part="settings-field" class="inp num" type="number" min="1000" step="1000" inputmode="numeric" value="${cur('ctx', 128000)}">` +
    `<fieldset class="dlg-fs"><legend>${esc(t3('caps'))}</legend>${CAP_ICONS.map(([f, icn, lab]) => `<label class="dlg-r"><input type="checkbox" data-cap="${f}"${capOn(f) ? ' checked' : ''}><span>${ic(icn, 'md')} ${esc(t3(lab))}</span></label>`).join('')}</fieldset>` +
    `<div id="c3MFmtBox"></div>`, buttons: [{ id: 'cancel', label: t3('cancel') }, { id: 'save', label: t3('save'), primary: true, disabled: !(edit || o.id) }], initial: edit ? '#c3MName' : '#c3MId' });
  const fmtBox = () => { const c = cx($('#c3MConn', d.back).value); $('#c3MFmtBox', d.back).innerHTML = c && c.provider === 'compat' ? `<label class="dlg-l" for="c3MFmt">${esc(t3('modelFormat'))}</label>${selectHTML('c3MFmt', 'format', D3.FORMATS, edit ? edit.format : 'openai', t3('modelFormat')).replace(' data-ctl data-c3="field" data-f="format"', '')}` : ''; };
  fmtBox(); $('#c3MConn', d.back).addEventListener('change', fmtBox);
  const idI = $('#c3MId', d.back), btn = $('[data-dlg="save"]', d.back), hint = $('#c3MHint', d.back);
  const upd = () => { const v = idI.value.trim(); const taken = !edit && D.models.some((x) => x.id === v); btn.setAttribute('aria-disabled', v && !taken ? 'false' : 'true'); hint.hidden = !(taken || (!v && idI.dataset.t)); hint.textContent = taken ? t3('idTaken') : t3('idNeeded'); }; idI.addEventListener('input', () => { idI.dataset.t = '1'; upd(); }); upd();
  A.openDialog.handlers = { save: () => {
    const id = idI.value.trim(); if (!id) return false; if (!edit && D.models.some((x) => x.id === id)) return false;
    const caps = $$('[data-cap]:checked', d.back).map((e) => e.dataset.cap); const data = { id, name: $('#c3MName', d.back).value, ctx: $('#c3MCtx', d.back).value, caps, format: $('#c3MFmt', d.back) ? $('#c3MFmt', d.back).value : undefined }; const cid = $('#c3MConn', d.back).value;
    setTimeout(() => { let mm; if (edit) { editCustom(edit.id, data); mm = edit; B.psToast(t3('customEdited', mname(mm)), { kind: 'model-edit' }); } else { mm = addCustom(cid, data); if (mm) B.psToast(t3('customAdded', mname(mm)), { kind: 'model-add' }); }
      repaintAll(); if (o.reopen && mm) openPicker({ rowId: o.reopen.rowId, q: mm.id, focus: mm.id }); else { const b = $(`.c3-cm[data-mid="${CSS.escape(mm ? mm.id : '')}"] .c3-more`) || $('[data-c3="addmodel"]'); if (b) b.focus({ preventScroll: true }); } }, 0);
  } };
  return d;
}
function customMenu(mid, anchor, point, opener) {
  const m = modelById(mid); if (!m) return;
  A.showMenu([{ icon: 'pencil', label: t3('editModel'), fn: () => openCustomDialog({ edit: mid }) }, { icon: 'trash-2', label: t3('deleteModel'), fn: () => { const cid = m.conn; deleteCustom(mid); repaintAll(); B.psToast(t3('customDeleted', mname(m)), { kind: 'model-delete', until: 'page', action: luAct(B.LU[B.LU.length - 1]) }); void cid; } }], anchor, point, opener, t3('cardMenu', m.name));
}

/* ------------------------------------------------------------------ opening and leaving the sub-views */
function openConn(id, o = {}) {
  const c = cx(id); if (!c) return false;
  if (!A.S.open) A.openSettings(o.opener || $('#oSettings'), { page: 'models', noFocus: true });
  S3.view = 'conn'; S3.conn = id; S3.keyEdit = o.keyReplace ? id : null;
  A.showPage('models', { c3: true, noAnim: o.noAnim !== false, keepNotice: true, noRestore: true, fromSearch: o.fromSearch });
  const f = o.keyReplace ? $('#c3KeyIn') : o.focusTest ? $('#c3TestBtn') : $('#pgTitle'); if (f) f.focus({ preventScroll: true });
  return true;
}
function openFb(id) {
  if (!A.S.open) A.openSettings($('#oSettings'), { page: 'models', noFocus: true });
  S3.view = 'fb'; S3.fb = id;
  A.showPage('models', { c3: true, noAnim: true, keepNotice: true, noRestore: true }); const rv = $$('[data-fbrv]'); if (rv[0]) rv[0].tabIndex = 0; const f = rv[0] || $('[data-c3="fbadd"]') || $('#pgTitle'); if (f) f.focus({ preventScroll: true });
}
function closeSub(o = {}) {
  const was = S3.view, wasConn = S3.conn, wasFb = S3.fb; S3.view = 'section'; S3.keyEdit = null; S3.resume = null;
  if (was === 'fb' && !o.toTop) A.showPage('models', { section: 'models.models', row: A.ROW[wasFb], noAnim: true, noRestore: true, fromJump: true });
  else if (was === 'conn' && !o.toTop) A.showPage('models', { section: 'models.connections', noAnim: true, noRestore: true, fromJump: true });
  else A.showPage('models', { noAnim: true, focusHead: true, noRestore: true });
  if (was === 'conn' && !o.toTop) focusCard(wasConn);
  if (was === 'fb' && !o.toTop) { const e = $(`[data-row="${CSS.escape(wasFb)}"] [data-ctl]`); if (e) e.focus({ preventScroll: true }); }
}

/* ------------------------------------------------------------------ fix marks (SPEC 6.3): connection cards and model rows are rendered with them; the library rows and the chat chip are decorated here */
let libObs = null;
function decorateLib() {
  const list = $('#psLibList'); if (!list) return; if (libObs) libObs.disconnect();
  $$('.ps-li', list).forEach((li) => {
    const pid = li.dataset.pid; const p = B.P(pid); const row = $('.ps-row', li); if (!p || !row) return;
    const pr = presetProblem(p); let m = $('.c3-markbtn.lib', row);
    if (!pr) { if (m) m.remove(); return; }
    const sig = pr.code + ':' + (pr.conn || '') + ':' + lang(); if (m && m.dataset.sig === sig) return; if (m) m.remove();
    const b = document.createElement('button'); b.type = 'button'; b.className = 'c3-markbtn lib'; b.setAttribute('data-part', 'settings-fix-mark'); b.setAttribute('data-part-critical', ''); b.dataset.c3 = 'fixlib'; b.dataset.pid = pid; b.dataset.sig = sig; b.dataset.code = pr.code;
    b.setAttribute('aria-label', `${probText(pr)} · ${t3('fix')}: ${p.name}`); b.title = t3('fix'); b.innerHTML = ic('circle-alert', 'sm') + '<span>' + esc(probText(pr)) + '</span>'; $('.ps-main', row).after(b);
  });
  if (libObs) libObs.observe($('#pageScroll'), { childList: true, subtree: true });
}
function paintMarks() {
  const b = $('#c3ChipFix'); const p = B ? presetProblem(B.act()) : null;
  if (b) { b.hidden = !p; if (p) { const lab = `${probText(p)} · ${t3('chipFix')}`; b.setAttribute('aria-label', lab); b.title = lab; b.dataset.code = p.code; } }
  decorateLib();
}
function fixFor(pr, rowId, mid, opts = {}) {
  const m = modelById(mid);
  if (pr.code === 'noConn' || pr.code === 'gone') {
    const sib = m ? CX.find((c) => c.provider === m.pid) : null; const sref = sib && m ? refOf(sib.id, baseOf(m)) : null;
    if (sref) { openPicker({ rowId, sibling: sref, focus: sref, conn: sib.id }); return; }   // DS-064: no automatic re-bind; the sibling's pair is first in the list
    openAddDialog({ provider: m ? m.pid : null, reopen: m ? { rowId, base: baseOf(m), q: '' } : null }); return;
  }
  if (pr.code === 'modelGone' && opts.active !== false) { openPicker({ rowId, reason: t3('fixReasonLine', mname(m)), focus: mid }); return; }
  const c = cx(pr.conn); if (!c) { openAddDialog({ provider: m ? m.pid : null }); return; }
  openConn(c.id, { keyReplace: keyNeeds(c) && ['noKey', 'keyAgain', 'badkey'].includes(pr.code), focusTest: !(keyNeeds(c) && ['noKey', 'keyAgain', 'badkey'].includes(pr.code)) });
}

/* ------------------------------------------------------------------ the fix-it path (DS-043): chat stub with the agreed failReply API, arrival in Settings, return */
const REASONS = { key: 'failKey', model: 'failModel', quota: 'failQuota', network: 'failNetwork', server: 'failServer' };
function cardHTMLChat(msgId, o) {
  const fix = o.fix || null; const href = `slice3.html?fix=${fix}&conn=${encodeURIComponent(o.conn || '')}&reason=${encodeURIComponent(o.reason || 'server')}${o.reason === 'model' && o.model && o.row ? `&model=${encodeURIComponent(o.model)}&row=${encodeURIComponent(o.row)}` : ''}&back=chat&msg=${encodeURIComponent(msgId)}&lang=${lang()}${o.chat ? '&chat=' + encodeURIComponent(o.chat) : ''}${window.settingsTheme.name ? '&theme=' + window.settingsTheme.name : ''}`;   // SLICE3_SPEC 6.1 / R-15 / R-16 (DD-139: lang travels like chat's link; the card is rebuilt by renderReplies on a language change): fix=key|model, reason=key|model|quota|network|server
  return `${ic('circle-alert', 'xl')}<div class="c3-errt"><p class="c3-errl">${esc(t3(REASONS[o.reason] || 'failServer'))}</p>${o.detail ? `<p class="c3-errd">${esc(o.detail)}</p>` : ''}<div class="c3-erra">${fix ? `<a data-part="settings-button" class="btn solid accent" href="${esc(href)}" data-c3="fixchat">${ic('wrench', 'lg')}<span>${esc(t3('fix'))}</span></a>` : ''}<button type="button" data-part="settings-button" class="btn solid" data-c3="retrychat" data-msg="${esc(msgId)}">${ic('rotate-ccw', 'lg')}<span>${esc(t3('retry'))}</span></button></div></div>`;
}
function failReply(msgId, opts = {}) {   // same signature and output as the agreed window.__chat.failReply (chat lane); only the link base differs (this file lives in settings/)
  const log = $('#oScroll'); if (!log) return null;
  const o = { reason: opts.reason || 'server', fix: opts.fix === undefined ? null : opts.fix, conn: opts.conn || '', detail: opts.detail, chat: opts.chat || '', model: opts.model || '', row: opts.row || '' };
  const card = document.createElement('div'); card.className = 'c3-err'; card.setAttribute('data-part', 'settings-chat-error-card'); card.setAttribute('data-part-critical', ''); card.setAttribute('role', 'alert'); card.tabIndex = -1;
  card.dataset.msg = msgId; card.dataset.history = '0'; card.dataset.reason = o.reason;   // history 0: the failed reply keeps its place but is not a swipe and is not sent as chat history
   card.dataset.fix = o.fix || ''; card.dataset.conn = o.conn; card.dataset.chat = o.chat; card.dataset.model = o.model; card.dataset.row = o.row; card.innerHTML = cardHTMLChat(msgId, o);
  const old = log.querySelector(`[data-msg="${CSS.escape(msgId)}"]`); if (old) old.replaceWith(card); else log.appendChild(card);
  S3.replies[msgId] = { state: 'error', opts: o }; card.scrollIntoView({ block: 'nearest' }); return card;
}
function ensureStream(msgId) {
  const log = $('#oScroll'); if (!log) return null; let el = log.querySelector(`[data-msg="${CSS.escape(msgId)}"]`);
  if (!el) { el = document.createElement('p'); el.className = 'o-msg c3-stream'; el.dataset.msg = msgId; el.setAttribute('aria-busy', 'true'); el.textContent = t3('chatStreaming'); log.appendChild(el); }
  S3.replies[msgId] = S3.replies[msgId] || { state: 'stream' }; el.scrollIntoView({ block: 'nearest' }); return el;
}
function renderReplies() {   // the origin stub is rebuilt on language changes: put the stand-in replies back
  Object.entries(S3.replies).forEach(([id, r]) => { if (r.state === 'error') failReply(id, r.opts); else if (r.state === 'stream') { delete S3.replies[id]; ensureStream(id); } else if (r.state === 'ok') { const log = $('#oScroll'); if (log && !log.querySelector(`[data-msg="${CSS.escape(id)}"]`)) { const p = document.createElement('p'); p.className = 'o-msg'; p.dataset.msg = id; p.textContent = t3('replyOk'); log.appendChild(p); } } });
}
const FAIL_MAP = { noKey: { reason: 'key', fix: 'key' }, keyAgain: { reason: 'key', fix: 'key' }, badkey: { reason: 'key', fix: 'key' }, quota: { reason: 'quota', fix: 'key' }, unreachable: { reason: 'network', fix: 'addr' }, modelGone: { reason: 'model', fix: 'model' }, noConn: { reason: 'key', fix: 'key' }, gone: { reason: 'model', fix: 'model' } };
function derivedFailure(mid) {   // what the chat would report for this model right now
  const pr = problem(mid); if (!pr) return null; const m = modelById(mid);
  const f = Object.assign({ conn: (m && m.conn) || '' }, FAIL_MAP[pr.code]);
  if (pr.code === 'modelGone' && m) { f.model = baseOf(m); f.row = 'main'; }
  if (f.fix === 'addr') { const c = cx(f.conn); f.fix = c && PROV[c.provider].url ? 'address' : null; }   // DS-056: a network error gets 고치기 only where the user set the address
  return f;
}
function retryReply(msgId) {   // 다시 시도 regenerates in place; whether it works depends on the current state of the connection
  const log = $('#oScroll'); if (!log) return; const old = log.querySelector(`[data-msg="${CSS.escape(msgId)}"]`);
  const st = document.createElement('p'); st.className = 'o-msg c3-stream'; st.dataset.msg = msgId; st.setAttribute('aria-busy', 'true'); st.textContent = t3('retrying'); if (old) old.replaceWith(st); else log.appendChild(st);
  S3.replies[msgId] = { state: 'stream' }; B.announce(t3('retrying'));
  setTimeout(() => {
    const cur = log.querySelector(`[data-msg="${CSS.escape(msgId)}"]`); if (!cur) return;
    const f = derivedFailure(A.ROW['models.mainModel'].v);
    if (f) { failReply(msgId, f); const card = log.querySelector(`.c3-err[data-msg="${CSS.escape(msgId)}"]`); if (card && document.activeElement === document.body) card.focus({ preventScroll: true }); }
    else { const p = document.createElement('p'); p.className = 'o-msg'; p.dataset.msg = msgId; p.textContent = t3('replyOk'); p.tabIndex = -1; cur.replaceWith(p); S3.replies[msgId] = { state: 'ok' }; p.focus({ preventScroll: true }); }
    S3.retried = (S3.retried || 0) + 1;
  }, 700);
}
const ROWMAP = { main: 'models.mainModel', sub: 'models.subModel', mem: 'models.memModel', trans: 'models.transModel', emo: 'models.emoModel', suggest: 'models.suggestModel', other: 'models.otherModel' };
const fixDesc = () => (S3.fix && S3.fix.back ? ' c3FixBanner' : '');
function bannerReason(f) { return f.fix === 'model' ? (f.modelName ? t3('fixReasonLine', f.modelName) : t3('failModel')) : t3(REASONS[f.reason] || 'failKey'); }
function arriveFix(o) {
  const rowId = ROWMAP[o.row] || (o.row && A.ROW[o.row] ? o.row : 'models.mainModel'); const reason = o.reason || (o.fix === 'model' ? 'model' : 'key');
  const cur = modelById(A.ROW[rowId].v || resolved(rowId)); const conn = o.conn || (cur && cur.conn) || null;
  const baseId = o.model || ''; const rk = baseId && conn ? refOf(conn, baseId) : null; const named = baseId ? ((rk && modelById(rk)) || modelById(baseId)) : null; const modelName = baseId ? (named ? mname(named) : baseId) : '';
  if (o.fix === 'model' && rk && modelById(rk)) { modelById(rk).gone = true; bump(); paintMarks(); }   // the connection cannot find it (what the chat just reported)
  S3.fix = { fix: o.fix, conn, msg: o.msg || null, reason, saved: false, row: rowId, model: baseId, modelName, back: o.back !== 'none', ext: !!o.ext, chat: o.chat || null };
  if (!A.S.open) A.openSettings($('#oSettings'), { page: 'models', noFocus: true });
  S3.fix.sig0 = relSig();
  if (o.fix === 'key' || o.fix === 'address') {
    const c = cx(S3.fix.conn);
    if (!c) { S3.view = 'section'; A.showPage('models', { section: 'models.models', noAnim: true }); openAddDialog({ provider: named ? named.pid : (cur ? cur.pid : null) }); return S3.fix; }
    if ((reason === 'network' || o.fix === 'address') && PROV[c.provider].url) { openConn(c.id, { noAnim: true }); const u = $('#c3Url'); if (u) { u.focus({ preventScroll: true }); const r = u.closest('.row'); if (r) A.highlight(r); } }
    else if (reason === 'quota') openConn(c.id, { noAnim: true, focusTest: true });   // DS-056: a 429 is not cured by a new key: show the check and offer another model
    else openConn(c.id, { keyReplace: true, noAnim: true });
  } else {
    S3.view = 'section'; A.showPage('models', { section: 'models.models', row: A.ROW[rowId], noAnim: true });
    openPicker({ rowId, reason: modelName ? t3('fixReasonLine', modelName) : t3('fixUnknown'), focus: rk || null, conn });   // DS-063: the failed model and row come from the link; without them nothing is guessed
  }
  B.announce(t3('fromChat', bannerReason(S3.fix)));   // N-14: said once on arrival, and the focused field is described by the banner
  const fa = document.activeElement; if (fa && fa.id && S3.fix.back && (fa.getAttribute('aria-describedby') || '').indexOf('c3FixBanner') < 0) fa.setAttribute('aria-describedby', ((fa.getAttribute('aria-describedby') || '') + ' c3FixBanner').trim());
  return S3.fix;
}
function chatReturnUrl() {   // SPEC 6.1 / DS-055: ../chat/slice1.html?from=settings&retry=<msg>[&changed=1]&lang=<ko|en>[&chat=<id>]; changed only after a relevant change
  const f = S3.fix; let u = '../chat/slice1.html?from=settings'; if (f && f.msg) u += '&retry=' + encodeURIComponent(f.msg); if (f && f.saved) u += '&changed=1'; const ql = Q.get('lang'); u += '&lang=' + (S3.langChosen || (ql === 'ko' || ql === 'en' ? ql : lang()));   // DD-138: the chat opens in the language of the visit
  if (f && f.chat) u += '&chat=' + encodeURIComponent(f.chat); if (window.settingsTheme.name) u += '&theme=' + window.settingsTheme.name; return u;   // T-16: the pack travels with the link (mockup only)
}
const navigate = (u) => { if (S3.navHook) S3.navHook(u); else location.assign(u); };
function returnToChat() {
  if (!A.S.open) return false; const f = S3.fix;
  if (f && f.ext) { navigate(chatReturnUrl()); return true; }   // arrived by the link: go back to the real chat page
  A.closeSettings(); return true;                                // arrived from the stub on this page: the stub chat is right behind
}
function afterReturn(f) {   // DD-132: the stub's return row only reads the question (no button of its own); focus lands on the card's own 다시 시도
  if (!f || !f.msg) return; const card = $(`.c3-err[data-msg="${CSS.escape(f.msg)}"]`) || $(`[data-msg="${CSS.escape(f.msg)}"]`); if (!card) return;
  const old = $('.c3-retryrow', card); if (old) old.remove();
  if (f.saved) { const r = document.createElement('p'); r.className = 'c3-retryrow'; r.setAttribute('role', 'status'); r.textContent = t3('changedRetryQ'); ($('.c3-errt', card) || card).appendChild(r); B.announce(t3('changedRetryQ')); }
  const btn = $('[data-c3="retrychat"]', card);
  if (btn) btn.focus({ preventScroll: true }); else { if (card.tabIndex < 0 && !card.hasAttribute('tabindex')) card.tabIndex = -1; card.focus({ preventScroll: true }); }
  card.scrollIntoView({ block: 'nearest' });
}
function bannerHTML() {
  const f = S3.fix; if (!f || !f.back) return ''; const lead = f.saved ? t3('fixBannerSaved') : t3('fromChat', bannerReason(f));
  return `<div class="banner warn c3-fixbanner" id="c3FixBanner" ${f.saved ? '' : 'data-part-critical '}data-part="settings-fix-banner" role="status" data-saved="${f.saved ? 1 : 0}">${ic('circle-alert', 'lg')}<span class="c3-fbt2">${esc(lead)}</span>${f.reason === 'quota' && f.fix === 'key' ? `<button type="button" data-part="settings-button" class="btn solid" data-c3="othermodel">${ic('cpu', 'lg')}<span>${esc(t3('otherModel'))}</span></button>` : ''}<button type="button" data-part="settings-button" class="btn solid${f.saved ? ' accent' : ''}" data-c3="backchat">${ic('arrow-left', 'lg')}<span>${esc(f.saved ? t3('backAndRetry') : t3('backToChat'))}</span></button></div>`;
}
function injectBanner(pg) {
  if (!pg || pg.dataset.page !== 'models') return; const old = $('.c3-fixbanner', pg); if (old) old.remove(); const h = bannerHTML(); if (!h || !S3.fix) return;
  const head = $('.pg-head', pg); if (head) head.insertAdjacentHTML('beforeend', h);
}

/* ------------------------------------------------------------------ the chat stub: header fix mark, composer with a {{ autocomplete */
function acOpen() { const p = $('#c3Ac'); return !!p && !p.hidden; }
function setupChat(o) {
  const hdr = $('#o2Hdr', o); const chip = hdr && $('#psChip', hdr);
  if (chip && !$('#c3ChipFix', hdr)) { const b = document.createElement('button'); b.type = 'button'; b.id = 'c3ChipFix'; b.className = 'btn c3-chipfix'; b.setAttribute('data-part', 'settings-button'); b.hidden = true; b.dataset.c3 = 'chipfix'; b.innerHTML = ic('circle-alert', 'xl'); chip.after(b); }
  $$('.o-scroll .o-msg', o).forEach((m, i) => { m.dataset.msg = 'm' + (i + 1); });
  const d = $('#oDraft', o); if (d && !d._ac) {
    d._ac = 1; const comp = d.parentElement; comp.style.position = 'relative';
    const upd = () => { const v = d.value.slice(0, d.selectionStart); const on = /\{\{[^}\s]*$/.test(v); let p = $('#c3Ac', comp); if (on && !p) { p = document.createElement('div'); p.id = 'c3Ac'; p.className = 'c3-ac'; p.setAttribute('role', 'listbox'); p.setAttribute('aria-label', t3('acTitle')); p.innerHTML = ['{{char}}', '{{user}}', '{{random}}'].map((x, i) => `<div role="option" class="c3-aco" aria-selected="${i === 0}">${x}</div>`).join(''); comp.appendChild(p); } if (p) p.hidden = !on; };
    d.addEventListener('input', upd); d.addEventListener('keyup', (ev) => { if (ev.key.length > 1 && ['Escape', 'Control', 'Shift', 'Alt', 'Meta', 'Tab'].indexOf(ev.key) < 0) upd(); }); d.addEventListener('blur', () => { const p = $('#c3Ac'); if (p) p.hidden = true; });
    d.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && acOpen()) { ev.preventDefault(); ev.stopPropagation(); $('#c3Ac').hidden = true; } });
  }
  renderReplies(); paintMarks();
}

/* ------------------------------------------------------------------ Ctrl+M (DS-042) and the rebindable model shortcut row in 단축키 */
const normCombo = (s) => String(s).split('+').map((x) => x.trim().toLowerCase()).sort().join('+');
function comboOfEv(ev) { return B.comboOf(ev); }
function onModelKey(ev) {
  if (ev.isComposing || ev.keyCode === 229 || !A) return;
  if (S3.hotkeyCapturing || B.S2.capturing) return;
  const mod = ev.ctrlKey || ev.metaKey || ev.altKey; if (!mod) return;
  { const a0 = document.activeElement;   // Ctrl+Z inside the connection list or the fallback list undoes the newest list action (DS-049, SPEC 4.3)
    if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && !ev.shiftKey && ev.code === 'KeyZ' && A.S.open && !S3.mp && a0 && a0.closest && a0.closest('#c3Cx, #c3Fbl') && !A.inTextField(a0) && !document.body.classList.contains('dlg-open')) { ev.preventDefault(); ev.stopImmediatePropagation(); B.undoLast(); return; } }
  const combo = comboOfEv(ev); const mine = normCombo(A.ROW['keys.modelSelect'].combo);
  if (S3.mp && normCombo(combo) !== mine && (((ev.ctrlKey || ev.metaKey) && /^(KeyP|KeyZ|Digit[1-9])$/.test(ev.code || '')) || (ev.altKey && ev.code === 'KeyZ'))) { ev.preventDefault(); ev.stopImmediatePropagation(); return; }   // the switcher, slot keys and undo wait while the picker is open
  if (!A.S.open && ev.altKey && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey && ev.code === 'KeyZ' && S3.chatRow) { ev.preventDefault(); ev.stopImmediatePropagation(); undoChatRow(); return; }   // DD-131: Alt+Z in the chat undoes the switch the inline row confirmed
  if (normCombo(combo) !== mine) return;
  if (ev.repeat) { ev.preventDefault(); ev.stopImmediatePropagation(); return; }   // R-05: a held Ctrl+M does not flicker the picker
  { const kin = $('#c3KeyIn'); if (kin && kin.value) return; }                    // N-15: unsaved key input is never put at risk by a shortcut
  const a = document.activeElement;
  if (a && a.classList && (a.classList.contains('ps-rename') || a.classList.contains('c3-rename'))) return;   // inline rename keeps its keys (DS-023)
  if (acOpen()) return;                                                                                          // so does the {{ autocomplete
  if (document.body.classList.contains('dlg-open')) return;                                                       // R-06: a dialog over the picker (the unverified question) gets its keys first
  ev.preventDefault(); ev.stopImmediatePropagation();                                                            // Firefox maps Ctrl+M to "mute tab": not checked there
  if (S3.mp) { closePicker(); return; }
  if ($('#swRoot') || A.menuOpen()) return;
  const op = a && a !== document.body ? a : null;
  if (!A.S.open && B.guardFailed(() => openPicker({ rowId: 'models.mainModel', opener: op }))) return;   // DD-134: in the chat the failed-save question comes first, like Ctrl+P (DS-026)
  openPicker({ rowId: 'models.mainModel', opener: op });
}
function hotkeyBody() {
  const r = A.ROW['keys.modelSelect']; const phone = A.S.lay === 'phone'; const keys = r.combo.split('+').map((k) => `<kbd>${esc(k)}</kbd>`).join('<span class="plus" aria-hidden="true">+</span>');
  return `<div data-part="settings-row" class="row c3-hk" data-row="keys.modelSelect"><div class="r-main"><div class="r-text"><label data-part="settings-row-label" class="r-label" for="c3HkBtn">${esc(t3('hkModel'))}</label><p data-part="settings-row-description" class="r-desc">${esc(t3('hkFirefox'))}</p></div><div data-part="settings-row-control" class="r-ctl c3-hkctl"><span class="keys" id="c3HkKeys">${keys}</span>${phone ? '' : `<button type="button" data-part="settings-button" class="btn solid" id="c3HkBtn" data-ctl data-c3="hkcap" aria-label="${esc(t3('hkChange') + ': ' + t3('hkModel'))}">${ic('keyboard', 'md')}<span>${esc(t3('hkChange'))}</span></button>`}</div></div>${phone ? `<p data-part="settings-row-description" class="r-desc">${esc(A.t('hotkeysPhone'))}</p>` : ''}<p data-part="settings-row-description" class="r-desc c3-capmsg" id="c3CapMsg" role="status" hidden></p></div>`;
}
function stopHkCapture() { const c = S3.hotkeyCapturing; document.removeEventListener('keydown', onHkCapture, true); if (!c) return; S3.hotkeyCapturing = null; const b = $('#c3HkBtn'); if (b) { b.classList.remove('capturing'); b.removeAttribute('aria-pressed'); $('span', b).textContent = t3('hkChange'); } const m = $('#c3CapMsg'); if (m) { m.hidden = true; m.textContent = ''; } }
function startHkCapture(btn) { stopHkCapture(); S3.hotkeyCapturing = true; btn.classList.add('capturing'); btn.setAttribute('aria-pressed', 'true'); $('span', btn).textContent = t3('hkCapture'); const m = $('#c3CapMsg'); m.hidden = false; m.textContent = t3('hkCapture'); B.announce(t3('hkCapture')); document.addEventListener('keydown', onHkCapture, true); }
function onHkCapture(ev) {
  if (ev.key === 'Escape') { ev.preventDefault(); ev.stopImmediatePropagation(); const b = $('#c3HkBtn'); stopHkCapture(); if (b) b.focus(); return; }
  if (['Control', 'Alt', 'Shift', 'Meta', 'AltGraph'].includes(ev.key)) return; ev.preventDefault(); ev.stopImmediatePropagation();
  const combo = comboOfEv(ev); const m = $('#c3CapMsg');
  if (!(ev.ctrlKey || ev.metaKey || ev.altKey)) { m.textContent = t3('hkNeedMod'); B.announce(t3('hkNeedMod')); return; }
  const nc = normCombo(combo); let w = null;
  D.rows.forEach((r) => { if (!w && r.type === 'key' && r.id !== 'keys.modelSelect' && normCombo(r.combo) === nc) w = A.L(r); });
  for (let k = 1; k <= 9; k++) if (!w && normCombo(B.SLOTKEY[k]) === nc) w = B.t2('slotRow', k);
  const kk = combo.split('+').pop(); if (!w && (ev.ctrlKey || ev.metaKey) && !ev.altKey && !ev.shiftKey && (/^(C|V|X|A|Z|Y|F|R|W|T|N|L)$/.test(kk) || kk === 'Tab')) w = KO() ? '복사·붙여넣기 같은 기본 동작' : 'basic actions such as copy and paste';
  if (w) { m.textContent = t3('hkConflict', combo, w); B.announce(m.textContent); return; }
  A.ROW['keys.modelSelect'].combo = combo; stopHkCapture(); A.refreshPage(); const b = $('#c3HkBtn'); if (b) b.focus({ preventScroll: true }); B.announce(t3('hkSet', combo));
}

/* ------------------------------------------------------------------ page events (delegated on #pageScroll, which lives for the whole session) */
function repaintKeyRow() { const c = cx(S3.conn); const kr = $('[data-row="c3.key"]'); if (!c || !kr) return; const tmp = document.createElement('div'); tmp.innerHTML = keyRowHTML(c); kr.replaceWith(tmp.firstElementChild); }
function saveKeyFromInput() {
  const c = cx(S3.conn); const inp = $('#c3KeyIn'); if (!c || !inp) return false; const v = inp.value.trim(); if (!v) return false;
  inp.value = ''; S3.keyEdit = null; const env = isEnv(v); const rs = S3.resume && S3.resume.conn === c.id ? S3.resume : null; S3.resume = null; setKey(c, v); repaintAll(); const b = $('[data-c3="keyedit"]'); if (b) b.focus({ preventScroll: true });
  B.psToast(env ? t3('keySavedEnv') : t3('keySaved'), { kind: 'key', sub: t3('keyNoUndo'), ms: 4000 }); B.announce(env ? t3('keySavedEnv') : t3('keySaved'));
  if (rs) setTimeout(() => resumePicker(rs), 0);   // R-09: back to the picker, same row, same query, the model now choosable
  return true;
}
function resumePicker(rs) {
  S3.view = 'section'; S3.keyEdit = null;
  if (rs.add) openFb(rs.rowId); else A.showPage('models', { section: 'models.models', row: A.ROW[rs.rowId], noAnim: true, noRestore: true, fromJump: true });
  openPicker({ rowId: rs.rowId, add: rs.add, q: rs.q, focus: rs.mid });
}
function doRefresh(c) {
  if (S3.refreshing) return; S3.refreshing = c.id; const b = $('#c3Refresh'); if (b) b.setAttribute('aria-busy', 'true'); B.announce(t3('refreshing')); paintRefresh(c);
  setTimeout(() => { S3.refreshing = null; const n = D.models.filter((m) => m.conn === c.id && !m.custom).length; c.models = D.models.filter((m) => m.conn === c.id).length; B.psToast(t3('refreshed', n), { kind: 'refresh', ms: 4000 }); paintRefresh(c); }, CFG3.refreshMs);
}
function paintRefresh(c) { const b = $('#c3Refresh'); if (!b) return; b.innerHTML = ic('refresh-cw', 'lg', S3.refreshing === c.id ? 'c3-spin' : ''); if (S3.refreshing !== c.id) b.removeAttribute('aria-busy'); }
function bindPageC3() {
  const sc = $('#pageScroll');
  sc.addEventListener('click', (ev) => {
    const tg = ev.target; if (!(tg instanceof Element)) return; const b = tg.closest('[data-c3]'); if (!b) return;
    if (S3.noClick && (b.dataset.c3 === 'open' || b.dataset.c3 === 'fbitem')) { S3.noClick = false; return; }
    const a = b.dataset.c3; const id = b.dataset.cx || b.dataset.id; const c = id && cx(id);
    switch (a) {
      case 'add': openAddDialog({}); break;
      case 'open': openConn(b.dataset.cx); break;
      case 'test': if (c) startTest(c); break;
      case 'testcancel': cancelTest(b.dataset.cx || S3.conn); break;
      case 'cmenu': cardMenu(b.dataset.cx, b, null, b); break;
      case 'crumb-models': closeSub({ toTop: true }); break;
      case 'crumb-list': case 'crumb-fbback': closeSub(); break;
      case 'keyedit': S3.keyEdit = S3.conn; repaintKeyRow(); { const i = $('#c3KeyIn'); if (i) i.focus(); } break;
      case 'keycancel': S3.keyEdit = null; repaintKeyRow(); { const k = $('[data-c3="keyedit"]'); if (k) k.focus(); } break;
      case 'keysave': if (b.getAttribute('aria-disabled') !== 'true') saveKeyFromInput(); break;
      case 'keyclear': if (b.getAttribute('aria-disabled') !== 'true') openClearKeyDialog(S3.conn); break;
      case 'rename': startRenameCx(S3.conn, 'detail'); break;
      case 'refresh': if (c) doRefresh(c); break;
      case 'addmodel': openCustomDialog({ conn: b.dataset.cx }); break;
      case 'cmmenu': customMenu(b.dataset.mid, b, null, b); break;
      case 'usepreset': B.openLibrary({ focus: b.dataset.pid, noAnim: true }); break;
      case 'delete': openDeleteDialog(b.dataset.cx); break;
      case 'pick': openPicker({ rowId: b.dataset.id, opener: b }); break;
      case 'revert': commitModel(b.dataset.id, ''); { const e = $(`[data-row="${CSS.escape(b.dataset.id)}"] [data-ctl]`); if (e) e.focus({ preventScroll: true }); } break;
      case 'fixrow': { const rid = b.dataset.id; if (b.dataset.kind === 'fb') { const l = fbList(rid); const mid = l.find((x) => problem(x)); fixFor(problem(mid), rid, mid); } else { const mid = resolved(rid); fixFor(problem(mid), rid, mid); } break; }
      case 'fb': openFb(b.dataset.id); break;
      case 'fbitem': fbMenu(b.dataset.mid, b, null, b); break;
      case 'fbremove': fbRemove(S3.fb, b.dataset.mid); break;
      case 'fbadd': openPicker({ rowId: S3.fb, add: true, opener: b }); break;
      case 'golock': { const from = b.closest('[data-row]'); A.openRow(A.ROW[b.dataset.lock], { fromJump: true }); A.S.retRow = from ? from.dataset.row : 'models.mainModel'; if (!from) A.S.retRow = 'models.mainModel'; break; }
      case 'backchat': returnToChat(); break;
      case 'othermodel': { const f = S3.fix; if (f) openPicker({ rowId: f.row || 'models.mainModel', opener: b, reason: t3('failQuota') }); break; }
      case 'migrename': if (S3.migrated && S3.migrated[0]) startRenameCx(S3.migrated[0], 'card'); break;
      case 'migdismiss': S3.migDismissed = true; A.refreshPage(); { const f = $('[data-c3="add"]'); if (f) f.focus({ preventScroll: true }); } break;
      case 'fixlib': { const p = B.P(b.dataset.pid); const pr = p && presetProblem(p); if (pr) { const mid = B.effVal(p, 'models.mainModel'); fixFor(pr, 'models.mainModel', problem(mid) ? mid : null, { active: p.id === A.S.presetActive }); } break; }
      case 'hkcap': startHkCapture(b); break;
      default: break;
    }
  });
  sc.addEventListener('input', (ev) => {
    const t = ev.target;
    if (t.id === 'c3KeyIn') { const sv = $('[data-c3="keysave"]'); if (sv) sv.setAttribute('aria-disabled', t.value.trim() ? 'false' : 'true'); }
  });
  sc.addEventListener('change', (ev) => {
    const t = ev.target; if (!(t instanceof Element)) return; const a = t.dataset && t.dataset.c3;
    if (a === 'retries') { let n = parseInt(t.value, 10); if (isNaN(n)) n = A.ROW['adv.retries'].v; n = Math.max(0, Math.min(20, n)); A.ROW['adv.retries'].v = n; t.value = n; B.announce(t3('retries') + ': ' + n); }
    else if (a === 'field') { const c = cx(S3.conn); if (!c) return; const f = t.dataset.f; const v = t.type === 'checkbox' ? t.checked : t.value; const labels = { url: t3('url'), format: t3('format'), tokenizer: t3('tokenizer'), region: t3('region'), project: t3('project'), email: t3('email'), ollamaFormat: t3('ollamaFormat'), sub: t3('sub'), autoFetch: t3('autoFetch') }; setField(c, f, v, labels[f]); if (f === 'url') { paintConn(c.id); } }
  });
  sc.addEventListener('keydown', (ev) => {
    const t = ev.target; if (!(t instanceof Element) || ev.isComposing || ev.keyCode === 229) return; const k = ev.key;
    if (t.id === 'c3KeyIn') { if (k === 'Enter') { ev.preventDefault(); ev.stopPropagation(); saveKeyFromInput(); } else if (k === 'Escape') { ev.preventDefault(); ev.stopPropagation(); S3.keyEdit = null; repaintKeyRow(); const kb = $('[data-c3="keyedit"]'); if (kb) kb.focus(); } return; }
    if (t.classList.contains('c3-rename')) return;
    const rv = t.closest('[data-cxrv]');
    if (rv) {
      const all = $$('[data-cxrv]'); const i = all.indexOf(rv); let go = null; const id = rv.dataset.cx;
      if (ev.altKey && (k === 'ArrowUp' || k === 'ArrowDown') && !ev.ctrlKey && !ev.shiftKey) { ev.preventDefault(); moveCx(id, k === 'ArrowUp' ? -1 : 1); return; }
      if (k === 'ArrowDown') go = all[Math.min(all.length - 1, i + 1)]; else if (k === 'ArrowUp') go = all[Math.max(0, i - 1)]; else if (k === 'Home') go = all[0]; else if (k === 'End') go = all[all.length - 1];
      if (go) { ev.preventDefault(); all.forEach((e) => { e.tabIndex = -1; }); go.tabIndex = 0; S3.cardRv = go.dataset.cx; go.focus(); return; }
      if ((k === 'F10' && ev.shiftKey) || k === 'ContextMenu') { ev.preventDefault(); ev.stopPropagation(); cardMenu(id, $('.c3-more', rv.closest('li')), null, rv); return; }
      if (k === 'F2') { ev.preventDefault(); startRenameCx(id, 'card'); return; }
      if (k === 'Delete') { ev.preventDefault(); openDeleteDialog(id); return; }
      return;
    }
    const fb = t.closest('[data-fbrv]');
    if (fb) {
      const all = $$('[data-fbrv]'); const i = all.indexOf(fb); let go = null; const mid = fb.dataset.mid;
      if (ev.altKey && (k === 'ArrowUp' || k === 'ArrowDown') && !ev.ctrlKey && !ev.shiftKey) { ev.preventDefault(); fbMove(S3.fb, mid, k === 'ArrowUp' ? -1 : 1); return; }
      if (k === 'ArrowDown') go = all[Math.min(all.length - 1, i + 1)]; else if (k === 'ArrowUp') go = all[Math.max(0, i - 1)]; else if (k === 'Home') go = all[0]; else if (k === 'End') go = all[all.length - 1];
      if (go) { ev.preventDefault(); all.forEach((e) => { e.tabIndex = -1; }); go.tabIndex = 0; go.focus(); return; }
      if ((k === 'F10' && ev.shiftKey) || k === 'ContextMenu') { ev.preventDefault(); ev.stopPropagation(); fbMenu(mid, fb, null, fb); return; }
      if (k === 'Delete') { ev.preventDefault(); fbRemove(S3.fb, mid); return; }
      return;
    }
    if (k === 'F2' && S3.view === 'conn' && !A.inTextField(t)) { ev.preventDefault(); startRenameCx(S3.conn, 'detail'); }
  });
  sc.addEventListener('contextmenu', (ev) => {
    const t = ev.target; if (!(t instanceof Element)) return; const card = t.closest('.c3-card'); const fb = t.closest('.c3-fbli');
    if (card) { ev.preventDefault(); cardMenu(card.dataset.cx, null, { x: ev.clientX, y: ev.clientY }, $('.c3-cmain', card)); } else if (fb) { ev.preventDefault(); const m = $('.c3-fbmain', fb); fbMenu(m.dataset.mid, null, { x: ev.clientX, y: ev.clientY }, m); }
  });
  sc.addEventListener('focusin', (ev) => {
    const m = ev.target.closest && ev.target.closest('[data-cxrv]'); if (m) { $$('[data-cxrv]').forEach((e) => { e.tabIndex = e === m ? 0 : -1; }); S3.cardRv = m.dataset.cx; }
    const f = ev.target.closest && ev.target.closest('[data-fbrv]'); if (f) $$('[data-fbrv]').forEach((e) => { e.tabIndex = e === f ? 0 : -1; });
  });
  sc.addEventListener('pointerdown', (ev) => {
    const g = ev.target.closest && ev.target.closest('[data-cxgrip], [data-fbgrip]'); if (g && ev.pointerType !== 'touch' && ev.button === 0) { ev.preventDefault(); if (g.hasAttribute('data-fbgrip')) dragReorder(ev, g.closest('li'), '.c3-fbli', fbReorder); else dragReorder(ev, g.closest('li'), '.c3-card', cxReorder); }
  });
  bindTouchReorder(sc);
}
function bindOriginC3() {
  const o = $('#origin');
  o.addEventListener('click', (ev) => {
    const a = ev.target.closest && ev.target.closest('[data-c3]'); if (!a) return;
    if (a.dataset.c3 === 'fixchat') { ev.preventDefault(); const card = a.closest('.c3-err'); arriveFix({ fix: card.dataset.fix, conn: card.dataset.conn, msg: card.dataset.msg, reason: card.dataset.reason, model: card.dataset.model || undefined, row: card.dataset.row || undefined, chat: card.dataset.chat || undefined }); }
    else if (a.dataset.c3 === 'rowundo') undoChatRow();
    else if (a.dataset.c3 === 'retrychat') retryReply(a.dataset.msg);
    else if (a.dataset.c3 === 'chipfix') { const p = presetProblem(B.act()); if (p) { const mid = [B.effVal(B.act(), 'models.mainModel')].concat(MODEL_ROW_IDS.slice(1).map((id) => resolved(id))).concat(FB_IDS.flatMap((id) => fbList(id))).find((x) => problem(x)); fixFor(problem(mid), 'models.mainModel', mid); } }
  });
}

/* ------------------------------------------------------------------ hooks called by slice1.js (wrapping slice 2's) */
const H = {};
['boot', 'sectionBody', 'pageHTML', 'rendered', 'nav', 'back', 'closing', 'backLabel', 'headerTitle', 'origin', 'indexExtra', 'action', 'lang', 'title', 'demoPanel', 'afterInit', 'ready'].forEach((k) => { H[k] = X[k]; });
X.sectionBody = (s, body, o) => { if (s.id === 'models.models') return modelsBody(); if (s.id === 'models.connections') return connListBody(); if (s.id === 'keys.model') return hotkeyBody(); return H.sectionBody ? H.sectionBody(s, body, o) : undefined; };
X.pageHTML = (pid, o) => {
  if (pid === 'models' && S3.view === 'conn') { const h = connPageHTML(); if (h) return h; S3.view = 'section'; }
  if (pid === 'models' && S3.view === 'fb') return fbPageHTML();
  return H.pageHTML ? H.pageHTML(pid, o) : null;
};
X.rendered = (pg) => {
  if (H.rendered) H.rendered(pg); injectBanner(pg);
  const cards = $$('[data-cxrv]'); if (cards.length) { const cur = cards.find((e) => e.dataset.cx === S3.cardRv) || cards[0]; cards.forEach((e) => { e.tabIndex = e === cur ? 0 : -1; }); }
  const fbs = $$('[data-fbrv]'); if (fbs.length) { fbs.forEach((e, i) => { e.tabIndex = i === 0 ? 0 : -1; }); }
  decorateLib();
};
X.nav = (pid, o) => {
  if (H.nav) H.nav(pid, o);
  if (!o.c3 && S3.view !== 'section') { S3.view = 'section'; S3.keyEdit = null; }
  // search: a model result opens the picker for the main model with that model focused; a connection result opens its detail (SLICE3_SPEC section 1)
  if (A.S.modelCallout && o.fromSearch && o.row && o.row.id === 'models.mainModel') { const mid = A.S.modelCallout; A.S.modelCallout = null; setTimeout(() => openPicker({ rowId: 'models.mainModel', focus: mid }), 0); }
  if (o.row && o.row.cxRow && cx(o.row.cxRow)) { S3.view = 'conn'; S3.conn = o.row.cxRow; o.c3 = true; setTimeout(() => { const h = $('#pgTitle'); if (h && !S3.mp) h.focus({ preventScroll: true }); }, 0); }
  else if (o.row && o.row.replacedBy && pid === 'models') {   // another page points at a retired loose key / address row: open that provider's connection (or the list)
    const rb = o.row.replacedBy; const c = CX.find((x) => x.provider === rb);
    if (c) { S3.view = 'conn'; S3.conn = c.id; o.c3 = true; setTimeout(() => { const h = $('#pgTitle'); if (h) h.focus({ preventScroll: true }); }, 0); } else { o.row = A.ROW['models.connAdd'] || null; o.section = 'models.connections'; }
  } else if (o.row && D3.OPTION_PROV[o.row.id] && pid === 'models') {   // DS-059: a routing option lives on its provider's connection
    const c = CX.find((x) => x.provider === D3.OPTION_PROV[o.row.id]);
    if (c) { S3.view = 'conn'; S3.conn = c.id; o.c3 = true; } else { o.row = A.ROW['models.connAdd'] || null; o.section = 'models.connections'; }
  }
};
X.back = () => {
  if (S3.mp) { if (S3.mp.mode === 'sheet' && S3.mp.step === 'details') mpDetailsStep(false); else closePicker(); return true; }
  if (H.back && H.back()) return true;
  if (A.S.open && S3.view !== 'section' && !A.S.resume) { if (S3.fix && S3.view === 'conn') { returnToChat(); return true; } closeSub(); return true; }
  if (A.S.open && S3.fix && S3.view === 'section' && !A.S.resume && A.S.page === 'models') { returnToChat(); return true; }
  return false;
};
X.closing = () => {
  const r = H.closing ? H.closing() : true; if (r === false) return false;
  if (S3.mp) closePicker({ noFocus: true }); stopHkCapture();
  const f = S3.fix; S3.fix = null; S3.view = 'section'; S3.keyEdit = null; S3.renaming = null; S3.resume = null;
  if (f) setTimeout(() => afterReturn(f), 0);
  return true;
};
X.backLabel = () => {
  if (A.S.open && S3.fix && S3.view !== 'x') return { label: t3('backToChat'), vis: KO() ? '채팅' : 'Chat' };
  if (A.S.open && S3.view === 'conn') return { label: t3('backToConn'), vis: t3('backToConnShort') };
  if (A.S.open && S3.view === 'fb') return { label: t3('backToModels'), vis: t3('modelsPage') };
  return H.backLabel ? H.backLabel() : null;
};
X.headerTitle = () => (A.S.open && S3.view === 'conn' && cx(S3.conn) ? cx(S3.conn).name : A.S.open && S3.view === 'fb' ? A.L(A.ROW[S3.fb]) : (H.headerTitle ? H.headerTitle() : null));
X.origin = (o) => { if (H.origin) H.origin(o); if (A && A.S.from === 'chat') setupChat(o); };
X.indexExtra = (mk, IDX) => {
  if (H.indexExtra) H.indexExtra(mk, IDX);
  const r = A.ROW['models.hideApiKey']; const P = A.PAGE.models, S = A.SEC['models.connections'];
  const sy = (r.syn || '').split(/\s+/).filter((w) => !(/[a-z][A-Z]/.test(w) || w.includes('.'))).join(' ');
  IDX.push(mk('setting', r.id, P.icon, r.ko, r.en, sy, r.id + ' hideApiKeys', P.ko + ' › ' + S.ko, P.en + ' › ' + S.en, '', '', '', '', { row: r, page: 'models', sec: 'models.connections' }));
  IDX.push(mk('action', 'action:picker', 'cpu', '모델 고르기…', 'Choose model…', '모델 선택 모델 바꾸기 모델 변경 model picker change model switch model ctrl m', 'action:picker', '', '', '', '', '', '', {}));
  CX.forEach((c) => { if (PROV[c.provider].key !== 'none') IDX.push(mk('action', 'action:key:' + c.id, 'key-round', `키 바꾸기: ${c.name}`, `Replace key: ${c.name}`, '키 바꾸기 키 변경 키 넣기 api key replace key change key add key ' + (PROV[c.provider].kw || ''), 'action:key:' + c.id, '', '', '', '', '', '', {})); });   // R-25: the key action of every connection is searchable
  IDX.push(mk('action', 'action:addconn', 'plug', '연결 추가…', 'Add connection…', '연결 만들기 새 연결 키 넣기 api key provider add connection new connection', 'action:addconn', '', '', '', '', '', '', {}));
};
X.action = (id, opener) => {
  if (id === 'action:picker') { openPicker({ rowId: 'models.mainModel', opener: opener && opener.isConnected ? opener : null }); return; }
  if (id.indexOf('action:key:') === 0) { const cid = id.slice(11); if (cx(cid)) openConn(cid, { keyReplace: true, opener: opener && opener.isConnected ? opener : null }); return; }
  if (id === 'action:addconn') { if (!A.S.open) A.openSettings($('#oSettings'), { page: 'models', noFocus: true }); A.showPage('models', { section: 'models.connections', noAnim: true }); openAddDialog({}); return; }
  if (H.action) H.action(id, opener);
};
X.lang = (l) => {
  if (S3.booted) S3.langChosen = l;   // DS-062: the language last chosen in Settings goes back with the return link
  if (H.lang) H.lang(l); document.title = K[l].title;
  if (S3.mp) { const MP = S3.mp; $('#mpTitle', MP.root).textContent = mpTitle(); $('.mp-chips', MP.root).innerHTML = chipsHTML(); $('.mp-chips', MP.root).setAttribute('aria-label', t3('filters')); MP.list.setAttribute('aria-label', t3('pickerList')); MP.detId = null; mpRender(true); }
  renderReplies(); paintMarks();
};
X.title = (l) => K[l].title;
X.demoPanel = (p) => {
  if (H.demoPanel) H.demoPanel(p);
  const h = document.createElement('div'); h.className = 'ps-demo c3-demo';
  h.innerHTML = `<h3 class="d-h">${esc(t3('demoS3'))}</h3><label class="d-row"><span>${esc(t3('demoSet'))}</span><select id="d3Set">${[['demo', 'setDemo'], ['stress', 'setStress'], ['none', 'setNone'], ['broken', 'setBroken']].map(([v, k]) => `<option value="${v}"${SET3 === v ? ' selected' : ''}>${esc(t3(k))}</option>`).join('')}</select></label>` +
    `<label class="d-row"><span>${esc(t3('demoState'))}</span><select id="d3State">${STATES3.map((s) => `<option>${s}</option>`).join('')}</select></label><div class="d-btns"><button type="button" data-part="settings-button" class="btn solid" id="d3Go"><span>${esc(t3('demoGo'))}</span></button></div>`;
  p.appendChild(h);
  $('#d3Set', h).onchange = (e) => { const u = new URL(location.href); u.searchParams.set('set', e.target.value); location.href = u.toString(); };
  $('#d3Go', h).onclick = () => { runState($('#d3State', h).value); };
};
X.boot = (api) => {
  if (H.boot) H.boot(api);
  A = api; B = window.__ss2; Object.assign(A.ICONS, ICONS3); document.title = K[A.S.lang].title;
  D3.OPTION_ROWS.forEach((id) => { if (A.ROW[id]) OPT_DEF[id] = A.ROW[id].v; });
  sprite(); CX.forEach(ensureCxRow); loadChips(); warmIndex(); try { const j = JSON.parse(A.hermetic ? 'null' : (localStorage.getItem('ss1.asked3') || 'null')); if (j) j.forEach((x) => S3.asked.add(x)); } catch (_) { /* ignore */ }
  refreshIndexData();
  const ovt = A.valueText; A.valueText = (r) => {   // slice 2 prints these in undo messages
    if (MODEL_ROW_IDS.includes(r.id)) return r.v ? (modelById(r.v) ? mlabel(modelById(r.v)) : String(r.v)) : inheritText(r.id, modelsText(resolved(r.id)));
    if (FB_IDS.includes(r.id)) return modelsText(r.v) || t3('fbCount', 0);
    return ovt(r);
  };
  libObs = new MutationObserver(() => { if (libObs) { libObs.disconnect(); decorateLib(); } });
  if (B.LOCKS['models.keepAuxOnSwitch'].indexOf('models.suggestModel') < 0) B.LOCKS['models.keepAuxOnSwitch'].push('models.suggestModel');   // DS-051: the new per-task row is one of the rows 보조 모델 유지 keeps
  const rc0 = X.rowChanged; const relevantRow = (id) => MODEL_ROW_IDS.includes(id) || FB_IDS.includes(id) || id === 'models.fallbackBlank' || id === 'adv.retries' || !!D3.OPTION_PROV[id];
  X.rowChanged = (r) => { if (rc0) rc0(r); if (D3.OPTION_PROV[r.id] && S3.view === 'conn') { const c = cx(S3.conn); if (c && c.provider === D3.OPTION_PROV[r.id]) (c.opts = c.opts || {})[r.id] = r.v; } if (S3.fix && relevantRow(r.id)) markChanged(); };   // R-14: routing and fallback edits count too
  X.refreshAfterLU = (e) => { if (['model', 'conn-add', 'conn-delete', 'conn-edit', 'conn-move', 'model-add', 'model-edit', 'model-delete'].includes(e.kind)) { repaintAll(); return true; } return false; };   // N-16: undoing one of our changes repaints only what it touched
  X.undone = () => { refreshFixState(); const m = S3.modelToast, t = B.S2.toast; if (m && t && t.kind === 'model' && A.ROW[m.rowId].v !== m.nv) B.hideToast(); };   // R-11: Ctrl+Z dismisses the toast of the model change it took back
  document.addEventListener('keydown', onModelKey, true);
  document.addEventListener('focusin', (ev) => { const MP = S3.mp; if (MP && !MP.root.contains(ev.target) && !(ev.target.closest && (ev.target.closest('.dlg-back') || ev.target.closest('.menu') || ev.target.closest('#psToast')))) MP.input.focus({ preventScroll: true }); });
  new ResizeObserver(() => { const MP = S3.mp; if (MP) { const wide = $('#app').clientWidth >= window.settingsTheme.num('--breakpoint-sheet'); const m = wide ? 'dialog' : 'sheet'; if (m !== MP.mode) { MP.mode = m; MP.root.dataset.mode = m; MP.step = 'list'; MP.root.dataset.step = 'list'; $('.mp-x', MP.root).innerHTML = ic(wide ? 'x' : 'arrow-left', 'xl'); mpRender(true); } } }).observe($('#app'));
  window.addEventListener('popstate', () => { /* the picker is not a history entry */ });
  bindPageC3(); bindOriginC3();
  if (Q.get('state') && /^(cx|mp|md|fx|km)-/.test(Q.get('state'))) setTimeout(() => runState(Q.get('state')), 0);
  window.__ss3 = API();
};
X.afterInit = (o) => {
  if (H.afterInit) H.afterInit(o);
  if (Q.get('fix')) { const f = Q.get('fix'); if (f === 'key' || f === 'model' || f === 'address') arriveFix({ fix: f, conn: Q.get('conn') || undefined, msg: Q.get('msg') || undefined, reason: Q.get('reason') || undefined, model: Q.get('model') || undefined, row: Q.get('row') || undefined, back: Q.get('back') === 'chat' ? 'chat' : 'none', ext: Q.get('back') === 'chat', chat: Q.get('chat') || undefined }); return; }
  if (Q.get('view') === 'conn' && cx(Q.get('conn'))) { openConn(Q.get('conn'), { noAnim: true }); return; }
  if (Q.get('retry') && !A.S.open) { ensureStream(Q.get('retry')); failReply(Q.get('retry'), { reason: 'key', fix: 'key', conn: 'c-google' }); afterReturn({ msg: Q.get('retry'), saved: Q.get('changed') === '1' }); return; }   // what the real chat does with ?from=settings&retry=<msg>[&changed=1]
  if (Q.get('section') === 'models.connections') A.showPage('models', { section: 'models.connections', noAnim: true, keepFocus: true });
};
X.ready = () => { if (H.ready) H.ready(); S3.booted = true; window.__ss3Ready = true; };

/* ------------------------------------------------------------------ states (SPEC 10.3) */
const STATES3 = ['cx-list', 'cx-add-provider', 'cx-add-fields', 'cx-detail', 'cx-key-replace', 'cx-env-key', 'cx-test-running', 'cx-test-ok', 'cx-test-badkey', 'cx-test-unreachable', 'cx-custom-add', 'cx-delete-used', 'cx-delete-undo', 'cx-key-again', 'cx-empty', 'cx-migrated',
  'mp-open', 'mp-search', 'mp-chosung', 'mp-filter-vision', 'mp-details', 'mp-phone-details', 'mp-unverified-ask', 'mp-key-needed', 'mp-no-match', 'mp-stress',
  'md-page', 'md-locked', 'md-fallback-editor', 'md-fix-mark', 'md-changed-toast',
  'fx-chat', 'fx-chat-error-key', 'fx-chat-error-model', 'fx-chat-error-network', 'fx-arrive-key', 'fx-arrive-model', 'fx-fixed-back', 'fx-chat-retry-toast', 'km-chat-picker', 'km-hotkeys'];
const needSet = (set) => { if (SET3 === set) return false; const u = new URL(location.href); u.searchParams.set('set', set); location.replace(u.toString()); return true; };
function fxSetup(kind) {   // make the active preset's main model fail for the reason the stub reports (no history left behind)
  const target = kind === 'key' ? refOf('c-google', 'gemini-25-pro') : kind === 'model' ? (D.models.find((m) => m.clone && /^or-/.test(m.base) && m.conn) || {}).id : refOf('c-home', 'rp-custom-7');
  if (!target) return null;
  if (A.ROW['models.mainModel'].v !== target) B.editRow('models.mainModel', target);
  const p = B.act(); p.undo.length = 0; p.redo.length = 0; B.hideToast(); if (kind === 'model') modelById(target).gone = true; paintMarks();
  return target;
}
async function runState(name) {
  window.__ss3Ready = false; const q = Q.get('q');
  const toOrigin = () => { closePicker({ noFocus: true }); B.hideToast(); if (A.S.open) A.closeSettings({ noFocus: true }); if (A.S.from !== 'chat') window.__ss1.setFrom('chat'); S3.fix = null; };
  const openS = (opt) => { if (!A.S.open) A.openSettings($('#oSettings'), Object.assign({ noFocus: true }, opt || {})); };
  const list = () => { openS({ page: 'models' }); S3.view = 'section'; A.showPage('models', { section: 'models.connections', noAnim: true, keepFocus: true }); };
  const page = () => { openS({ page: 'models' }); S3.view = 'section'; A.showPage('models', { section: 'models.models', noAnim: true, keepFocus: true }); };
  const settle = () => sleep(80);
  const chipsNoSave = (o) => { Object.assign(S3.chips, o); };
  switch (name) {
    case 'cx-list': list(); break;
    case 'cx-add-provider': list(); await settle(); openAddDialog({}); break;
    case 'cx-add-fields': list(); await settle(); openAddDialog({ provider: 'compat' }); break;
    case 'cx-detail': openS({ page: 'models' }); openConn('c-openai'); break;
    case 'cx-key-replace': openS({ page: 'models' }); openConn('c-google', { keyReplace: true }); break;
    case 'cx-env-key': openS({ page: 'models' }); openConn('c-company'); break;
    case 'cx-test-running': openS({ page: 'models' }); openConn('c-ollama'); startTest(cx('c-ollama'), 600000); break;
    case 'cx-test-ok': openS({ page: 'models' }); openConn('c-ollama'); startTest(cx('c-ollama'), 40); await sleep(160); break;
    case 'cx-test-badkey': openS({ page: 'models' }); openConn('c-google'); startTest(cx('c-google'), 40); await sleep(160); break;
    case 'cx-test-unreachable': openS({ page: 'models' }); openConn('c-home'); startTest(cx('c-home'), 40); await sleep(160); break;
    case 'cx-custom-add': openS({ page: 'models' }); openConn('c-company'); await settle(); openCustomDialog({ conn: 'c-company', id: 'my-new-model-7b' }); break;
    case 'cx-delete-used': list(); await settle(); openDeleteDialog('c-anthropic'); break;
    case 'cx-delete-undo': list(); await settle(); deleteConn('c-anthropic'); repaintAll(); break;
    case 'cx-key-again': list(); await settle(); deleteConn('c-anthropic'); B.runLU(S3.lastDelete.entry.id); break;
    case 'cx-empty': if (needSet('none')) return new Promise(() => {}); list(); break;
    case 'cx-migrated': if (needSet('migrated')) return new Promise(() => {}); list(); break;
    case 'mp-open': page(); await settle(); openPicker({ rowId: 'models.mainModel' }); break;
    case 'mp-search': page(); await settle(); openPicker({ rowId: 'models.mainModel', q: q || 'sonnet' }); break;
    case 'mp-chosung': page(); await settle(); openPicker({ rowId: 'models.mainModel', q: q || 'ㅅㄴ' }); break;
    case 'mp-filter-vision': page(); await settle(); chipsNoSave({ vision: true }); openPicker({ rowId: 'models.mainModel' }); break;
    case 'mp-details': page(); await settle(); openPicker({ rowId: 'models.mainModel', focus: refOf('c-anthropic', 'claude-sonnet-45') }); break;
    case 'mp-phone-details': page(); await settle(); openPicker({ rowId: 'models.mainModel', focus: refOf('c-anthropic', 'claude-sonnet-45') }); mpDetailsStep(true); break;
    case 'mp-unverified-ask': page(); await settle(); openPicker({ rowId: 'models.mainModel', q: KO() ? '프록시 모델 5' : 'proxy model 5' }); mpChoose(refOf('c-company', 'rp-custom-5')); break;
    case 'mp-key-needed': page(); await settle(); clearKey(cx('c-google')); paintMarks(); A.refreshPage(); openPicker({ rowId: 'models.mainModel', q: 'gemini', focus: refOf('c-google', 'gemini-25-pro') }); break;
    case 'mp-no-match': page(); await settle(); openPicker({ rowId: 'models.mainModel', q: q || 'zzzqq' }); break;
    case 'mp-stress': if (needSet('stress')) return new Promise(() => {}); page(); await settle(); openPicker({ rowId: 'models.mainModel' }); break;
    case 'md-page': page(); break;
    case 'md-locked': page(); await settle(); ['models.keepAuxOnSwitch', 'models.keepFallbackOnSwitch'].forEach((id) => { A.ROW[id].v = true; B.lockChange(A.ROW[id]); }); A.refreshPage(); break;
    case 'md-fallback-editor': openS({ page: 'models' }); openFb('models.fallbackModel'); break;
    case 'md-fix-mark': if (needSet('broken')) return new Promise(() => {}); page(); break;
    case 'md-changed-toast': page(); await settle(); { const g = refOf('c-openai', 'gpt-5'); commitModel('models.mainModel', g, { text: mname(modelById(g)) }); } break;
    case 'fx-chat': toOrigin(); await settle(); ensureStream('m25'); break;
    case 'fx-chat-error-key': toOrigin(); await settle(); fxSetup('key'); ensureStream('m25'); failReply('m25', { reason: 'key', fix: 'key', conn: 'c-google' }); break;
    case 'fx-chat-error-model': toOrigin(); await settle(); { const mid = fxSetup('model'); ensureStream('m25'); failReply('m25', { reason: 'model', fix: 'model', conn: modelById(mid).conn, model: baseOf(modelById(mid)), row: 'main' }); } break;
    case 'fx-chat-error-network': toOrigin(); await settle(); fxSetup('network'); ensureStream('m25'); failReply('m25', { reason: 'network', fix: 'address', conn: 'c-home' }); break;
    case 'fx-arrive-key': toOrigin(); await settle(); fxSetup('key'); ensureStream('m25'); failReply('m25', { reason: 'key', fix: 'key', conn: 'c-google' }); arriveFix({ fix: 'key', conn: 'c-google', msg: 'm25', reason: 'key' }); break;
    case 'fx-arrive-model': toOrigin(); await settle(); { const mid = fxSetup('model'); ensureStream('m25'); failReply('m25', { reason: 'model', fix: 'model', conn: modelById(mid).conn, model: baseOf(modelById(mid)), row: 'main' }); arriveFix({ fix: 'model', conn: modelById(mid).conn, msg: 'm25', reason: 'model', model: baseOf(modelById(mid)), row: 'main' }); } break;
    case 'fx-fixed-back': toOrigin(); await settle(); fxSetup('key'); ensureStream('m25'); failReply('m25', { reason: 'key', fix: 'key', conn: 'c-google' }); arriveFix({ fix: 'key', conn: 'c-google', msg: 'm25', reason: 'key' }); await settle(); S3.keyEdit = null; setKey(cx('c-google'), 'fake-key-0000-fixed-ok01'); repaintAll(); break;
    case 'fx-chat-retry-toast': toOrigin(); await settle(); fxSetup('key'); ensureStream('m25'); failReply('m25', { reason: 'key', fix: 'key', conn: 'c-google' }); setKey(cx('c-google'), 'fake-key-0000-fixed-ok01'); afterReturn({ msg: 'm25', saved: true }); break;
    case 'km-chat-picker': toOrigin(); await settle(); openPicker({ rowId: 'models.mainModel', opener: $('#oDraft') }); break;
    case 'km-hotkeys': openS({ page: 'keys', section: 'keys.model' }); A.showPage('keys', { section: 'keys.model', noAnim: true }); break;
    default: break;
  }
  await sleep(60); window.__ss3Ready = name;
}

/* ------------------------------------------------------------------ public API (checks and the demo panel) */
function API() {
  window.__ss3ChatStub = { failReply, ensureStream, retry: retryReply };
  return {
    S3, CX, SET3, CFG3, ref: refOf, baseOf, chatReturnUrl, markChanged, hasKey, undoChatRow, resumePicker, hideChatRow, perf3, K, t3, cx, problem, problemOfConn, presetProblem, usersOf, openPicker, closePicker, openConn, openFb, closeSub, openAddDialog, openDeleteDialog, openCustomDialog, openClearKeyDialog, addConn, deleteConn, addCustom, editCustom, deleteCustom,
    startTest, finishTest, cancelTest, setKey, clearKey, setField, commitModel, setRowValue, fbList, fbMove, fbRemove, fbReorder, cxReorder, moveCx, searchModels, groupsOf, mpRender, mpInput, mpChoose, mpActivate, mpDetailsStep, mpSetActive,
    failReply, ensureStream, retryReply, arriveFix, returnToChat, afterReturn, derivedFailure, runState, STATES: STATES3, paintMarks, keyInfo, last4, fixFor, mname, modelById, startRenameCx, cardMenu, startHkCapture, refreshIndexData, repaintAll, resolved, retriesN, probText, fmtAgo, onModelKey,
  };
}
})();
