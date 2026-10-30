/* Settings slice 4 mockup: the parameters page (길이, 무작위성, 반복, 사고, 기타, 이 서비스 전용, 고급), per-task parameters beside the task rows of the models page, a request preview.
   Synthetic mockup; not proof of native behaviour or performance. Standalone (no network, no dependencies): nothing here reads or writes the real app's storage.
   Loaded after slice2.js and slice3.js and BEFORE slice1.js: it wraps the window.SS1_EXT hooks they registered (slice1.js reads them at start-up) and receives slice 1's API in X.boot.
   Implements settings/SLICE4_SPEC.md revision 1. Store-first (DS-067): the values live in the active preset's rows (slice 2's store: live save, undo, restore points, locks); every row is read by key at render time, typed text is a draft until it parses.
   Floor devices (Note 9 / Android 10 WebView, Raspberry Pi 3): no optional chaining, nullish coalescing, .at(), replaceAll or structuredClone; checks/ss4/modes.mjs scans for them.
   Sections: helpers and i18n, the model (support, limits, values, defaults), request preview, the parameter row, groups and pages, advanced editors, per-task parameters, events, actions, hooks, states, public API. */
(() => {
'use strict';
const X = window.SS1_EXT;
const D = window.SS1_DATA, D3 = window.SS3_DATA, D4 = window.SS4_DATA;
const Q = new URLSearchParams(location.search);
let A = null, B = null, C3 = null;                  // A: slice 1 API (from X.boot); B: window.__ss2 (slice 2); C3: window.__ss3 (slice 3)
const { PARAMS, BYKEY, GROUPS, SVC, FLAGS24, FLAG_GROUPS, TASKS, TASK_KEYS, SENDABLE, SET4, modelFlag, toStored } = D4;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ic = (n, s, c) => A.ic(n, s, c);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lang = () => A.S.lang;
const KO = () => lang() === 'ko';
const same = (a, b) => (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 1e-9 : a === b);
const fmtN = (n) => Number(n).toLocaleString('en-US');
const cl = (n, m = 28) => { n = String(n); return n.length > m ? n.slice(0, m - 1) + '…' : n; };

/* ------------------------------------------------------------------ icons (Lucide paths, inline; copied, not imported) */
const ICONS4 = {
  'arrow-down-to-line': '<path d="M12 17V3"/><path d="m6 11 6 6 6-6"/><path d="M19 21H5"/>',
  'chevron-up': '<path d="m18 15-6-6-6 6"/>',
  'list-plus': '<path d="M11 12H3"/><path d="M16 6H3"/><path d="M16 18H3"/><path d="M18 9v6"/><path d="M21 12h-6"/>',
  'file-down': '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M12 18v-6"/><path d="m9 15 3 3 3-3"/>',
  'eye': '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
  'send': '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  'undo-2': '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/>',
};

/* ------------------------------------------------------------------ i18n (SLICE4_SPEC section 10 keys plus mockup-only keys; no Korean particle directly after a user-chosen name, DS-038) */
const K = {
  ko: {
    title: '설정 슬라이스 4 · 파라미터 목업',
    paramsTitle: (n) => `파라미터 · ${n}`, mainModelIs: '주 모델', changeModel: '모델 바꾸기', changeModelOf: (m) => `모델 바꾸기: ${m}`,
    groupSvc: (s, c) => `이 서비스 전용 · ${s}${c ? ` (${c})` : ''}`, groupAdv: '고급', groupMenu: (g) => `${g} 묶음 메뉴`, collapsed: (g, n) => `${g}: 이 모델은 안 써요 (${n}개 · 값은 그대로)`, collapseGroup: '접기',
    send: '보내기', sendOf: (l) => `${l} 보내기`, notSent: '서비스 기본값 사용', annSentOff: (l) => `${l}: 서비스 기본값 사용`, annSentOn: (l, v) => `${l}: 보내요 · ${v}`,
    unsupported: '이 모델은 안 써요 · 값은 그대로', unsupportedAria: (l, m, v) => `${l}, 이 모델은 안 써요, ${m}, 값 ${v} 그대로`, viaFlag: '모델 기능 직접 지정으로 켜짐', modelLine: (m) => `모델: ${m}`, noModel: '모델 없음', sameInactive: '주 모델과 같게 쓰고 있어요 · 따로 정한 값은 남아 있지만 지금은 바꿀 수 없어요', taskUseOwn: '따로 정해서 쓰기',
    overMax: (n) => `이 모델은 최대 ${n}`, overCtx: (n) => `최대 컨텍스트 ${n}보다 길어요`, fitTo: (n, jo) => `${n}${jo} 맞추기`, overNote: (n, i) => `고칠 때까지 요청에는 ${n}${i} 쓰여요`, fitted: (l, n, jo) => `${l}: ${n}${jo} 맞췄어요`, checkMark: '파라미터 확인', checkMarkAria: '파라미터 확인: 모델의 한도를 넘는 값이 있어요',
    hintLowHigh: (lo, hi) => `낮을수록 ${lo}, 높을수록 ${hi}`, hintOffOn: (lo, hi) => `끄면 ${lo}, 켜면 ${hi}`, defaultIs: (v) => `기본값 ${v}`, noDefault: '기본값 없음 · 서비스 기본값', more: '자세히', less: '접기', helpOf: (l) => `${l} 자세히`,
    changed: '기본값과 다름', resetRow: '기본값으로', resetGroup: '이 묶음 기본값으로', resetDone: '기본값으로 되돌렸어요', resetOver: '모델 한도를 넘는 값이 있어요', blockedNot: (l) => `${l}: 보내기를 켜면 바꿀 수 있어요`, blockedUns: (l, m) => `${l}: 이 모델은 안 써요 · 값은 그대로 · ${m}`, rangeKept: (l, v) => `${l}: 범위 밖의 값이라 원래 값 ${v} 그대로 뒀어요`, resetGroupDone: (g) => `${g}: 기본값으로 되돌렸어요`, undo: '실행 취소', rowMenu: (l) => `${l} 메뉴`, staleUndo: '그 뒤에 다른 변경이 있어서 되돌리지 않았어요',
    emptyWord: '비어 있음', shared: '모든 프리셋 공통', sharedTip: '이 값은 프리셋이 아니라 모든 프리셋에 같이 저장돼요', random: '무작위', onWord: '켬', offWord: '끔',
    invalid: (lo, hi) => `${lo}에서 ${hi} 사이의 숫자로 입력해요`, invalidNum: '숫자로 입력해요', valueAria: (l, v) => `${l} ${v}`, sliderOf: (l) => `${l} 슬라이더`,
    preview: '보낼 값 보기', previewEstimate: '예상이에요 · 실제 요청과 똑같지는 않을 수 있어요', previewNote: '지금 값으로 이 모델에 보낼 항목이에요', previewLeft: '보내지 않는 값', previewLeftNot: '보내기가 꺼져 있어요', previewLeftUn: '이 모델은 안 써요', previewLeftThink: '사고 토큰을 보내지 않아서 사고를 켜지 않아요', previewLeftNone: '빠진 값이 없어요', previewLeftJson: 'JSON이 올바르지 않아요', previewClampedCtx: '컨텍스트 크기로 줄임', previewModel: '모델', previewHeaders: '헤더', previewClamped: '모델 한도로 줄임', previewEmpty: '보낼 항목이 없어요', previewOpen: '펼치기', previewClose: '접기',
    svcStop: '멈춤 문자열', svcStopAdd: '추가', svcStopEmpty: '멈춤 문자열 없음 · 추가', svcStopDel: (t) => `멈춤 문자열 ‘${t}’ 지우기`, svcStopNew: '새 멈춤 문자열', svcStopDeleted: '멈춤 문자열을 지웠어요', svcDefaultNone: '기본값 없음', svcText: (ph) => `비워 두면 ${ph || '아무것도'} 쓰지 않아요`,
    svcNotHere: (s) => `이 줄은 ${s} 전용이에요. 지금 모델은 그 서비스를 쓰지 않아요`,
    /* 고급 */
    advHint: '편향, 추가 파라미터, 모델 기능 직접 지정, 도구, 모듈 연동', advOpen: '고급 열기', advClose: '고급 닫기',
    biasTitle: '편향', biasSentence: '특정 말이 나올 확률을 높이거나 낮춰요', biasEmpty: '편향 없음 · 추가', biasAdd: '항목 추가', biasText: '말', biasNum: '값', biasDel: (t) => `‘${t || '빈 항목'}’ 항목 지우기`, biasDeleted: '편향 항목을 지웠어요', biasAdded: '편향 항목을 추가했어요',
    biasLegend: '-100은 거의 안 나와요, 100은 자주 나와요, -101은 금지 (일부 모델)', biasRange: '-101에서 100 사이', biasImport: '가져오기', biasExport: '내보내기', biasExported: '편향 표를 내보냈어요 (모의)', biasNumOf: (t) => `${t ? `‘${t}’` : '빈'} 항목 값`, biasTextOf: (n) => `${n}번째 항목의 말`,
    impTitle: '편향 가져오기', impPaste: 'JSON을 붙여 넣어요', impSample: '예시 넣기', impPreview: '미리 보기', impInvalid: 'JSON 형식이 맞지 않아요. [["말", 숫자], …] 모양이어야 해요', impReplaceQ: (n) => `${n}개 항목으로 바꿀까요?`, impBody: (cur, n) => `지금 항목 ${cur}개가 파일의 ${n}개로 모두 바뀌어요`, impReplace: '바꾸기', impDone: (n) => `편향을 ${n}개 항목으로 바꿨어요`, impMore: (n) => `외 ${n}개`, impBack: '다시 고르기',
    apTitle: '추가 파라미터', apSentence: '요청에 직접 덧붙이는 항목이에요', apAdd: '항목 추가', apEmpty: '추가 파라미터 없음 · 추가', apKey: '키', apVal: '값', apType: '종류', apTypeValue: '값', apTypeJson: 'JSON', apTypeHeader: '헤더', apTypeNone: '지우기', apDel: (k) => `‘${k || '빈 항목'}’ 항목 지우기`, apDeleted: '추가 파라미터를 지웠어요', apAdded: '추가 파라미터를 추가했어요',
    apJsonBad: 'JSON으로 읽을 수 없어요 · 입력한 그대로 저장돼요', apCoreOf: (l) => `${l}${josa(l, 'eun')} 위의 ‘${l}’ 행으로 바꾸는 게 좋아요`, applyAll: '모든 모델에 적용', applyAllDesc: '켜면 추가 파라미터를 모든 모델의 요청에 덧붙여요', apNoneHint: '이 키를 요청에서 빼요', apHeaderHint: '요청 헤더로 보내요',
    flagTitle: '모델 기능 직접 지정', flagSentence: '모델이 지원하는 기능을 직접 정해요', flagWarn: '모델이 지원하는 기능을 직접 정해요. 잘못 켜면 요청이 실패할 수 있어요.', flagReveals: (r) => `켜면 ${r.map((x) => `‘${x}’`).join(', ')}${jI(r[r.length - 1])} 보여요`, flagOwn: '모델 기본', flagListLabel: '모델 기능', flagMaster: '모델 기능 직접 지정 사용', flagToggled: (n, on) => `${n}: ${on ? '켬' : '끔'}`,
    toolTitle: '도구', toolSearch: '검색', toolSearchLine: '모델이 웹 검색 도구를 쓸 수 있게 해요. 도구를 지원하는 모델에서만 동작해요.',
    modTitle: '모듈 연동', modLine: '프리셋에 연결할 모듈의 이름 공간을 쉼표로 이어요', modPh: '예: fantasy, dice-rules', modStudio: '모듈의 내용은 스튜디오에서 만들어요',
    /* per-task */
    taskSame: '매개변수: 주 모델과 같음', taskOwn: (n) => (n > 0 ? `매개변수: 따로 · 주 모델과 다른 값 ${n}개` : '매개변수: 따로 · 주 모델과 같은 값'), taskModeSame: '같음', taskModeOwn: '따로', taskEdit: '편집', taskEditOf: (n) => `${n} 매개변수 편집`, taskModeOf: (n) => `${n} 매개변수`,
    taskAnnOwn: (n) => `${n} 매개변수를 따로 정해요`, taskToastSame: '주 모델과 같게 바꿨어요 · 따로 정한 값은 남아 있어요', taskCopied: (n) => `${n} 매개변수를 주 모델 값으로 시작해요`, taskBack: '매개변수로 돌아가기',
    taskPageTitle: (n) => `${n} 매개변수`, taskCrumbModels: '모델·프리셋', taskCrumbModel: '모델', crumbNav: '현재 위치', taskModelLine: (m) => `이 기능의 모델: ${m}`, taskMain: (v) => `주 모델: ${v}`, taskMatch: '주 모델 값으로 맞추기', taskMatched: (n) => `${n} 매개변수를 주 모델 값으로 맞췄어요`, taskUseSame: '주 모델과 같게 쓰기',
    taskLockHint: '기능별 파라미터 유지가 켜져 있어서 모든 프리셋이 같이 써요', backToModels: '모델 설정으로 돌아가기', backToModelsShort: '모델',
    /* demo panel */
    demoS4: '파라미터 데모', demoSet: '데이터 세트', demoState: '파라미터 상태', demoGo: '열기', setDemo: '데모', setService: '서비스 (NovelAI·textgen·NovelList)', setOver: '한도 초과', setEmpty: '모두 기본값', demoModel4: '주 모델', demoModelClaude: 'Claude Sonnet 4.5', demoModelGpt: 'GPT-5',
  },
  en: {
    title: 'Settings slice 4 · parameters mockup',
    paramsTitle: (n) => `Parameters · ${n}`, mainModelIs: 'Main model', changeModel: 'Change model', changeModelOf: (m) => `Change model: ${m}`,
    groupSvc: (s, c) => `This service only · ${s}${c ? ` (${c})` : ''}`, groupAdv: 'Advanced', groupMenu: (g) => `${g} group menu`, collapsed: (g, n) => `${g}: this model doesn't use them (${n} · values kept)`, collapseGroup: 'Collapse',
    send: 'Send', sendOf: (l) => `Send ${l}`, notSent: 'Use the service default', annSentOff: (l) => `${l}: using the service default`, annSentOn: (l, v) => `${l}: sent · ${v}`,
    unsupported: "This model doesn't use it · value kept", unsupportedAria: (l, m, v) => `${l}, this model doesn't use it, ${m}, value ${v} kept`, viaFlag: 'Turned on by model features you set', modelLine: (m) => `Model: ${m}`, noModel: 'No model', sameInactive: 'Same as the main model now · the values you set are kept but cannot be changed now', taskUseOwn: 'Use its own values',
    overMax: (n) => `This model allows up to ${n}`, overCtx: (n) => `Longer than the context size (${n})`, fitTo: (n) => `Set to ${n}`, overNote: (n) => `Until you change it, requests use ${n}`, fitted: (l, n) => `${l}: set to ${n}`, checkMark: 'Check parameters', checkMarkAria: 'Check parameters: a value is over the model limit',
    hintLowHigh: (lo, hi) => `Lower: ${lo}. Higher: ${hi}`, hintOffOn: (lo, hi) => `Off: ${lo}. On: ${hi}`, defaultIs: (v) => `Default ${v}`, noDefault: 'No default · service default', more: 'More', less: 'Less', helpOf: (l) => `More about ${l}`,
    changed: 'Changed from default', resetRow: 'Reset to default', resetGroup: 'Reset this group', resetDone: 'Reset to default', resetOver: 'a value is over the model limit', blockedNot: (l) => `${l}: turn Send on to change it`, blockedUns: (l, m) => `${l}: this model doesn't use it · value kept · ${m}`, rangeKept: (l, v) => `${l}: out of range, kept ${v}`, resetGroupDone: (g) => `${g}: reset to default`, undo: 'Undo', rowMenu: (l) => `Menu for ${l}`, staleUndo: 'Something changed after it, so nothing was undone',
    emptyWord: 'empty', shared: 'Shared by all presets', sharedTip: 'This value is saved once for all presets, not in the preset', random: 'Random', onWord: 'On', offWord: 'Off',
    invalid: (lo, hi) => `Enter a number from ${lo} to ${hi}`, invalidNum: 'Enter a number', valueAria: (l, v) => `${l} ${v}`, sliderOf: (l) => `${l} slider`,
    preview: 'View what is sent', previewEstimate: 'An estimate · the real request may differ', previewNote: 'What this model would get with the current values', previewLeft: 'Left out', previewLeftNot: 'Send is off', previewLeftUn: "This model doesn't use it", previewLeftThink: 'Thinking stays off because the thinking tokens are not sent', previewLeftNone: 'Nothing is left out', previewLeftJson: 'The JSON is not valid', previewClampedCtx: 'cut to the context size', previewModel: 'Model', previewHeaders: 'Headers', previewClamped: 'cut to the model limit', previewEmpty: 'Nothing would be sent', previewOpen: 'Show', previewClose: 'Hide',
    svcStop: 'Stop strings', svcStopAdd: 'Add', svcStopEmpty: 'No stop strings · Add', svcStopDel: (t) => `Remove stop string "${t}"`, svcStopNew: 'New stop string', svcStopDeleted: 'Stop string removed', svcDefaultNone: 'No default', svcText: (ph) => `Empty adds ${ph || 'nothing'}`,
    svcNotHere: (s) => `This row is for ${s} only. The current model doesn't use that service`,
    advHint: 'Bias, additional parameters, custom model features, tools, module integration', advOpen: 'Open Advanced', advClose: 'Close Advanced',
    biasTitle: 'Bias', biasSentence: 'Makes a word or phrase more or less likely', biasEmpty: 'No bias · Add', biasAdd: 'Add entry', biasText: 'Text', biasNum: 'Value', biasDel: (t) => `Remove entry "${t || 'empty'}"`, biasDeleted: 'Bias entry removed', biasAdded: 'Bias entry added',
    biasLegend: '-100 almost never, 100 often, -101 banned (some models)', biasRange: '-101 to 100', biasImport: 'Import', biasExport: 'Export', biasExported: 'Bias table exported (simulated)', biasNumOf: (t) => `Value of ${t || 'empty entry'}`, biasTextOf: (n) => `Text of entry ${n}`,
    impTitle: 'Import bias', impPaste: 'Paste the JSON', impSample: 'Insert an example', impPreview: 'Preview', impInvalid: 'That is not valid JSON of the form [["text", number], …]', impReplaceQ: (n) => `Replace with ${n} ${n === 1 ? 'entry' : 'entries'}?`, impBody: (cur, n) => `Your ${cur} current ${cur === 1 ? 'entry is' : 'entries are'} all replaced by the ${n} in the file`, impReplace: 'Replace', impDone: (n) => `Bias replaced with ${n} ${n === 1 ? 'entry' : 'entries'}`, impMore: (n) => `and ${n} more`, impBack: 'Choose again',
    apTitle: 'Additional parameters', apSentence: 'Items added straight to the request', apAdd: 'Add item', apEmpty: 'No additional parameters · Add', apKey: 'Key', apVal: 'Value', apType: 'Type', apTypeValue: 'Value', apTypeJson: 'JSON', apTypeHeader: 'Header', apTypeNone: 'Remove', apDel: (k) => `Remove item "${k || 'empty'}"`, apDeleted: 'Additional parameter removed', apAdded: 'Additional parameter added',
    apJsonBad: "Can't read it as JSON · saved as typed", apCoreOf: (l) => `${l} is better changed in the "${l}" row above`, applyAll: 'Apply to all models', applyAllDesc: "When on, additional parameters go into every model's requests", apNoneHint: 'Removes this key from the request', apHeaderHint: 'Sent as a request header',
    flagTitle: 'Custom model features', flagSentence: 'Decide for yourself what the model supports', flagWarn: 'Decide for yourself what the model supports. A wrong switch can make requests fail.', flagReveals: (r) => `When on, ${r.map((x) => '"' + x + '"').join(' and ')} ${r.length > 1 ? 'show' : 'shows'}`, flagOwn: 'Model default', flagListLabel: 'Model features', flagMaster: 'Use custom model features', flagToggled: (n, on) => `${n}: ${on ? 'on' : 'off'}`,
    toolTitle: 'Tools', toolSearch: 'Search', toolSearchLine: 'Lets the model use a web search tool. It works only on models that support tools.',
    modTitle: 'Module integration', modLine: 'Module namespaces linked to this preset, separated by commas', modPh: 'e.g. fantasy, dice-rules', modStudio: 'Module content is made in Studio',
    taskSame: 'Parameters: same as main', taskOwn: (n) => (n > 0 ? `Parameters: own · ${n} differ from main` : 'Parameters: own · same values as main'), taskModeSame: 'Same', taskModeOwn: 'Own', taskEdit: 'Edit', taskEditOf: (n) => `Edit parameters of ${n}`, taskModeOf: (n) => `Parameters of ${n}`,
    taskAnnOwn: (n) => `${n} now has its own parameters`, taskToastSame: 'Now the same as the main model · your own values are kept', taskCopied: (n) => `${n} parameters start from the main model's values`, taskBack: 'Back to parameters',
    taskPageTitle: (n) => `${n} parameters`, taskCrumbModels: 'Models & presets', taskCrumbModel: 'Models', crumbNav: 'You are here', taskModelLine: (m) => `Model of this feature: ${m}`, taskMain: (v) => `Main model: ${v}`, taskMatch: 'Match the main model', taskMatched: (n) => `${n} parameters now match the main model`, taskUseSame: 'Use the same as the main model',
    taskLockHint: 'Keep per-feature parameters is on, so every preset shares these', backToModels: 'Back to model settings', backToModelsShort: 'Models',
    demoS4: 'Parameters demo', demoSet: 'Data set', demoState: 'Parameters state', demoGo: 'Open', setDemo: 'Demo', setService: 'Service (NovelAI, textgen, NovelList)', setOver: 'Over the limit', setEmpty: 'All defaults', demoModel4: 'Main model', demoModelClaude: 'Claude Sonnet 4.5', demoModelGpt: 'GPT-5',
  },
};
const t4 = (k, ...a) => { const v = K[lang()][k]; return typeof v === 'function' ? v(...a) : v; };
const josa = (n, kind) => B.josa(n, kind);
const jI = (n) => (B.finalOf(n) === 'n' ? '가' : '이');   // 이/가 after a number or name

/* ------------------------------------------------------------------ state (DS-067: the values are in the rows of slice 2's store; this object holds view state only, never a copy of a value) */
const P4 = {
  view: 'section',            // section | task   (a sub-page of the models page, like slice 3's conn and fb)
  task: null, expanded: new Set(), adv: false, help: new Set(), preview: false, taskReturn: null,
  drafts: {},                 // typed text of a number field that has not parsed yet: { 'src|key': text }
  writes: 0,                  // store writes made by slider input (low power makes fewer: checks/ss4/modes.mjs)
  booted: false,
};
const rowOf = (id) => A.ROW[id];
const isRowId = (id) => !!A.ROW[id];
const modelById = (id) => A.MODEL[id] || null;
const mainModel = () => modelById(rowOf('models.mainModel').v) || A.curModel();
const taskRowId = (task) => TASKS.find((t) => t[0] === task)[1];
const taskInfo = (task) => TASKS.find((t) => t[0] === task);
const taskName = (task) => { const i = taskInfo(task); return KO() ? i[2] : i[3]; };
const taskModel = (task) => modelById(C3.resolved(taskRowId(task))) || mainModel();
const mname = (m) => (m ? A.mn(m) : t4('noModel'));
const connName = (m) => { const c = m && m.conn ? C3.cx(m.conn) : null; return c ? c.name : ''; };

/* ------------------------------------------------------------------ descriptors: one shape for a core parameter and a service sampler row */
const DESC = {};
function mkDescs() {
  PARAMS.forEach((p) => {
    DESC[p.key] = { key: p.key, rowId: p.id, kind: p.kind, group: p.group, api: p.api, min: p.min, max: p.max, step: p.step, dec: p.dec || 0, def: p.def, defSent: p.defSent !== false, sendable: !!p.sendable, sendId: 'models.send.' + p.key, opts: p.opts, needs: p.needs, reveal: p.reveal, task: !!p.task, global: !!p.global, limit: p.limit, hint: p.hint, t: p.t, svc: null, random: !!p.random };
  });
  Object.keys(SVC).forEach((sk) => SVC[sk].rows.forEach((s) => {
    const nd = s.def === null; const hp = s.like ? [BYKEY[s.like].t.ko[4], BYKEY[s.like].t.en[4]] : (s.help || ['', '']);
    const key = 'svc.' + sk + '.' + s.f;
    DESC[key] = { key, rowId: s.id, kind: s.kind, group: 'svc', api: s.f, min: s.min, max: s.max, step: s.step, dec: s.dec || 0, def: nd ? s.v0 : s.def, defSent: !nd, sendable: nd, noDefault: nd, sendId: 'models.send.svc.' + sk + '.' + s.f, needs: 'svc:' + sk, task: false, global: false, svc: sk, ph: s.ph,
      t: { ko: [s.t.ko[0], s.t.ko[1], s.t.ko[2], s.t.ko[3], hp[0]], en: [s.t.en[0], s.t.en[1], s.t.en[2], s.t.en[3], hp[1]] } };
  }));
}
const dText = (d) => d.t[lang()];
const dLabel = (d) => dText(d)[0];

/* ------------------------------------------------------------------ the sources a row can read and write (main preset, or one task's own block) */
function taskGet(task) {
  let o = null; try { o = JSON.parse(rowOf('models.task.' + task).v || 'null'); } catch (e) { o = null; }
  if (!o || typeof o !== 'object') o = {};
  return { mode: o.mode === 'own' ? 'own' : 'same', values: o.values && typeof o.values === 'object' ? o.values : {}, off: Array.isArray(o.off) ? o.off : [] };
}
function taskKept(t) { return Object.keys(t.values).length > 0; }
function setRow(id, v) { flushSlider(); const r = rowOf(id); if (same(r.v, v)) return false; r.v = v; X.rowChanged(r); if (r.type === 'number' || r.type === 'text' || r.type === 'textarea') B.commitPending(); return true; }   // slice 2's hook does the rest: live save, undo step, lock, restore point
const SRC = {
  main: { id: 'main', get: (d) => rowOf(d.rowId).v, sent: (d) => (d.sendable ? !!rowOf(d.sendId).v : true), set: (d, v, co) => (d.global ? gset(d.rowId, v, dLabel(d)) : co ? setRowC(d.rowId, v) : setRow(d.rowId, v)), setSent: (d, on) => setRow(d.sendId, !!on) },
};
function taskSrc(task) {
  return {
    id: task,
    get: (d) => { const t = taskGet(task); return d.key in t.values ? t.values[d.key] : d.def; },
    sent: (d) => { if (!d.sendable) return true; const t = taskGet(task); return t.off.indexOf(d.key) < 0; },
    set: (d, v, co) => { const t = taskGet(task); if (d.key in t.values && same(t.values[d.key], v)) return false; t.values[d.key] = v; return taskPut(task, t, co); },
    setSent: (d, on) => { const t = taskGet(task); const i = t.off.indexOf(d.key); if ((i < 0) === !!on) return false; if (on) t.off.splice(i, 1); else t.off.push(d.key); return taskPut(task, t); },
  };
}
const srcOf = (id) => (id === 'main' ? SRC.main : taskSrc(id));
function taskPut(task, t, co) { const id = 'models.task.' + task; const v = JSON.stringify({ mode: t.mode, values: t.values, off: t.off }); return co ? setRowC(id, v) : setRow(id, v); }
const isChangedD = (d, src) => (d.noDefault ? src.sent(d) !== d.defSent : (!same(src.get(d), d.def) || (d.sendable && src.sent(d) !== d.defSent)));   // a row with no default (NovelAI Mirostat, CFG) differs only by being sent

/* ------------------------------------------------------------------ support (DS-080), limits (DS-085, DS-088), services (DS-083) */
function flagsEff() {   // the custom flags in force for the main model, or null when 모델 기능 직접 지정 is off
  if (!rowOf('models.enableCustomFlags').v) return null;
  const raw = rowOf('models.customFlags').v; let l = null; try { l = raw ? JSON.parse(raw) : null; } catch (e) { l = null; }
  if (Array.isArray(l)) return l;
  const m = mainModel(); return FLAGS24.filter((f) => modelFlag(m, f[0])).map((f) => f[0]);   // starts in the model's own state (design default)
}
function supportOf(d, m, useFlags) {   // { ok, flag }
  if (!d.needs) return { ok: true };
  if (m && (m.params || []).indexOf(d.needs) >= 0) return { ok: true };
  if (useFlags && d.reveal) { const fl = flagsEff(); if (fl && fl.indexOf(d.reveal) >= 0) return { ok: true, flag: d.reveal }; }
  return { ok: false };
}
function limitsOf(m) { if (!m || m.noLimit) return { ctx: null, out: null }; return { ctx: m.ctx || null, out: m.maxOut || null }; }
function svcOf(m) { return !m ? null : m.pid === 'novelai' ? 'novelai' : m.pid === 'textgen' ? 'ooba' : m.pid === 'novellist' ? 'novellist' : null; }
function overInfo(d, v, m) {   // { n, kind } when the value is over a KNOWN model limit (kind 'model', DS-085/088: limits come from model data only, DS-091), or a response longer than the context size (kind 'ctx', R4-5, SLICE4_SPEC 2.3); else null
  if (!d.limit) return null; const l = limitsOf(m)[d.limit]; if (l && v > l) return { n: l, kind: 'model' };
  if (d.key === 'maxResponse' && !l) { const c = Number(rowOf('models.maxContext').v); if (c > 0 && v > c) return { n: c, kind: 'ctx' }; }
  return null;
}
function overOf(d, v, m) { const o = overInfo(d, v, m); return o ? o.n : null; }
const overKind = (d, v, m) => { const o = overInfo(d, v, m); return o ? o.kind : null; };
const overText = (n, kind) => (kind === 'ctx' ? t4('overCtx', fmtN(n)) : t4('overMax', fmtN(n)));
function toolsOk(m) { return !!m && (m.flags || []).indexOf('tools') >= 0; }
function biasOk(m) { return !!m && (m.flags || []).indexOf('bias') >= 0; }
const shownVal = (d, src) => { const v = src.get(d); return fmtVal(d, v); };
function fmtVal(d, v) {
  if (d.kind === 'seg') { const o = d.opts.find((x) => x[0] === v); return o ? (KO() ? o[1] : o[2]) : String(v); }
  if (d.kind === 'switch') return v ? t4('onWord') : t4('offWord');
  if (d.kind === 'text') return String(v);
  if (d.random && v === -1) return t4('random');
  if (d.kind === 'number' || !d.dec) return fmtN(v);
  return Number(v).toFixed(d.dec);
}
const parseCommas = (s) => String(s).replace(/[,\s]/g, '');
function roundTo(n, dec) { const f = Math.pow(10, dec); return Math.round(n * f) / f; }
function parseNum(d, txt) {
  let s = parseCommas(txt); if (s === '') return null;
  if (d.random && /^(무작위|random)$/i.test(s)) return -1;
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const n = Number(s); return isFinite(n) ? roundTo(n, d.dec) : null;
}
const inRange = (d, n) => n >= d.min && n <= d.max;

/* ------------------------------------------------------------------ structured rows: JSON text in the store, parsed when read */
function jget(id, fallback) { let v = null; try { v = JSON.parse(rowOf(id).v || 'null'); } catch (e) { v = null; } return Array.isArray(v) ? v : (fallback === undefined ? [] : fallback); }
const biasGet = () => jget('models.bias').map((e) => [String(e[0] === undefined ? '' : e[0]), Number(e[1]) || 0]);
const apGet = () => jget('models.addParams').map((e) => [String(e[0] === undefined ? '' : e[0]), String(e[1] === undefined ? '' : e[1])]);
const stopGet = () => jget('models.localStopStrings').map(String);
function apParse(raw) {   // stored form -> { type, text }
  if (raw === '{{none}}') return { type: 'none', text: '' };
  if (raw.indexOf('header::') === 0) return { type: 'header', text: raw.slice(8) };
  if (raw.indexOf('json::') === 0) return { type: 'json', text: raw.slice(6) };
  return { type: 'value', text: raw };
}
function apJoin(type, text) { return type === 'none' ? '{{none}}' : type === 'header' ? 'header::' + text : type === 'json' ? 'json::' + text : text; }
function apValue(text) {   // a plain value in the request: numbers, true / false / null, quoted strings, else text
  const s = String(text).trim();
  if (/^(true|false|null)$/.test(s)) return JSON.parse(s);
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (/^".*"$/.test(s)) { try { return JSON.parse(s); } catch (e) { return s.slice(1, -1); } }
  return s;
}
const apJsonOk = (text) => { try { JSON.parse(text); return true; } catch (e) { return false; } };
function summaryOf(id, v) {
  const KOr = KO();
  if (id === 'models.bias' || id === 'models.addParams' || id === 'models.localStopStrings') { let n = 0; try { n = JSON.parse(v || '[]').length; } catch (e) { n = 0; } return KOr ? `${n}개` : String(n); }
  if (id === 'models.customFlags') { let n = 0; try { n = JSON.parse(v || 'null').length; } catch (e) { n = -1; } return n < 0 ? t4('flagOwn') : (KOr ? `${n}개 켬` : `${n} on`); }
  if (/^models\.task\./.test(id)) { const task = id.slice(12); const t = taskGetFrom(v); return t.mode === 'own' ? t4('taskOwn', countChanged(task, t)) : t4('taskSame'); }
  return null;
}
function taskGetFrom(v) { let o = null; try { o = JSON.parse(v || 'null'); } catch (e) { o = null; } if (!o) o = {}; return { mode: o.mode === 'own' ? 'own' : 'same', values: o.values || {}, off: o.off || [] }; }
function countChanged(task, t) {   // 바꾼 값: the fields of the task's own block that differ from the main preset's current values (DS-089: it started as a copy)
  t = t || taskGet(task); let n = 0;
  TASK_KEYS.forEach((k) => {
    const d = DESC[k]; const mv = rowOf(d.rowId).v; const tv = k in t.values ? t.values[k] : mv; if (!same(tv, mv)) n++;
    if (d.sendable) { const ms = !!rowOf(d.sendId).v; const ts = t.off.indexOf(k) < 0; if (ms !== ts) n++; }
  });
  return n;
}
function copyMain() {   // DS-089: the main preset's current values, as a task block
  const values = {}, off = []; TASK_KEYS.forEach((k) => { const d = DESC[k]; values[k] = rowOf(d.rowId).v; if (d.sendable && !rowOf(d.sendId).v) off.push(k); });
  return { values, off };
}

/* ------------------------------------------------------------------ the 보낼 값 보기 panel (DS-095, SLICE4_SPEC 11.4): an ESTIMATE of what a request to the main model would carry, in API units, built from the same send rules as the page (not captured from a real request); what is left out is listed with why */
function previewObj() {
  flushSlider(); const m = mainModel(); const body = {}; const headers = {}; const notes = []; const svc = svcOf(m);
  const put = (path, v) => { const ks = path.split('.'); let o = body; for (let i = 0; i < ks.length - 1; i++) { if (typeof o[ks[i]] !== 'object' || o[ks[i]] === null) o[ks[i]] = {}; o = o[ks[i]]; } o[ks[ks.length - 1]] = v; };
  const left = { notsent: [], unsupported: [], think: [], badjson: [] };   // left out, grouped by why (labels)
  const tt = rowOf('models.thinkingType').v;
  const relevant = (k) => !(k === 'thinkingTokens' && tt !== 'budget') && !(k === 'adaptiveEffort' && tt !== 'adaptive') && !(k === 'dsEffort' && rowOf('models.dsThinking').v !== 'enabled');
  PARAMS.forEach((p) => {
    const d = DESC[p.key]; if (p.key === 'maxContext') return;
    if (!supportOf(d, m, true).ok) { left.unsupported.push(dLabel(d)); return; }
    if (d.sendable && !SRC.main.sent(d)) { if (relevant(p.key)) left.notsent.push(dLabel(d)); return; }
    const v = SRC.main.get(d);
    if (p.key === 'seed') { put('seed', v === -1 ? 'random' : v); return; }   // R4-15: a random seed is shown as random, not dropped
    if (p.key === 'maxResponse') { const o = overOf(d, v, m); put('max_tokens', o ? o : v); if (o) notes.push({ key: 'max_tokens', note: t4(overKind(d, v, m) === 'ctx' ? 'previewClampedCtx' : 'previewClamped') }); return; }
    if (p.key === 'thinkingType') {
      if (v === 'off') return;
      if (v === 'budget') { const dt = DESC.thinkingTokens; if (!(supportOf(dt, m, true).ok && SRC.main.sent(dt))) { left.think.push(dLabel(d)); return; } put('thinking.type', 'enabled'); return; }   // R4-14: thinking is never "enabled" without a budget
      put('thinking.type', 'adaptive'); return;
    }
    if (p.key === 'thinkingTokens') { if (tt === 'budget') put('thinking.budget_tokens', v); return; }
    if (p.key === 'adaptiveEffort') { if (tt === 'adaptive') put('thinking.effort', v); return; }
    if (p.key === 'dsThinking') { if (v === 'enabled') put('deepseek_thinking_type', v); return; }
    if (p.key === 'dsEffort') { if (rowOf('models.dsThinking').v === 'enabled') put('deepseek_reasoning_effort', v); return; }
    put(p.api, v);
  });
  if (svc && SVC[svc]) SVC[svc].rows.forEach((s) => {
    const d = DESC['svc.' + svc + '.' + s.f]; if (d.sendable && !SRC.main.sent(d)) { left.notsent.push(dLabel(d)); return; } const v = rowOf(d.rowId).v; if (d.kind === 'text' && v === '') return; put(s.f, v);
  });
  if (svc === 'ooba') { const st = stopGet(); if (st.length) put('stopping_strings', st); }
  const bias = biasGet().filter((e) => e[0] !== ''); const bl = KO() ? rowOf('models.bias').ko : rowOf('models.bias').en;
  if (bias.length) { if (biasOk(m)) { const o = {}; bias.forEach((e) => { o[e[0]] = e[1]; }); put('logit_bias', o); } else left.unsupported.push(bl); }   // only a model that takes a bias table gets one (R4-4: the row is dimmed and listed as left out)
  if (rowOf('models.modelTools').v) { if (toolsOk(m)) put('tools', ['search']); else left.unsupported.push(t4('toolTitle') + ': ' + t4('toolSearch')); }
  apGet().forEach((e) => {
    const k = e[0]; if (!k) return; const pr = apParse(e[1]);
    if (pr.type === 'none') { const ks = k.split('.'); let o = body; for (let i = 0; i < ks.length - 1 && o; i++) o = o[ks[i]]; if (o && typeof o === 'object') delete o[ks[ks.length - 1]]; notes.push({ key: k, note: t4('apNoneHint') }); }
    else if (pr.type === 'header') headers[k] = pr.text;
    else if (pr.type === 'json') { if (apJsonOk(pr.text)) put(k, JSON.parse(pr.text)); else left.badjson.push(k); }   // R4-15: a JSON value that does not read is left out and listed
    else put(k, apValue(pr.text));
  });
  return { model: mname(m), body, headers, notes, left };
}
function previewText() {
  const o = previewObj(); const out = { model: o.model }; Object.keys(o.body).forEach((k) => { out[k] = o.body[k]; });
  let s = JSON.stringify(out, null, 2);
  if (Object.keys(o.headers).length) s += '\n// ' + t4('previewHeaders') + '\n' + JSON.stringify(o.headers, null, 2);
  if (Object.keys(o.body).length === 0) s += '\n// ' + t4('previewEmpty');
  return s;
}
function leftOutHTML() {
  const o = previewObj(); const L = o.left; const why = [['notsent', 'previewLeftNot'], ['unsupported', 'previewLeftUn'], ['think', 'previewLeftThink'], ['badjson', 'previewLeftJson']];
  const items = why.filter((w) => L[w[0]].length).map((w) => `<li class="p4-lo" data-why="${w[0]}"><span class="p4-low">${esc(t4(w[1]))}</span><span class="p4-lol">${esc(L[w[0]].join(' · '))}</span></li>`).join('');
  const nts = o.notes.map((n) => `<li class="p4-lo" data-why="note"><span class="p4-low">${esc(n.key)}</span><span class="p4-lol">${esc(n.note)}</span></li>`).join('');
  return `<div class="p4-left" data-part="settings-param-leftout" data-part-critical><h4 class="p4-lot">${esc(t4('previewLeft'))}</h4>${items || nts ? `<ul class="p4-lol-l" role="list">${items}${nts}</ul>` : `<p class="p4-lonone">${esc(t4('previewLeftNone'))}</p>`}</div>`;
}
/* ------------------------------------------------------------------ the parameter row (SLICE4_SPEC 2.2): label, changed dot, value field, 보내기; sentence; hint and default; slider; reason / warning; 자세히 (inline help) */
const lockBadge = () => `<span class="chip p4-shared" data-part="settings-param-badge" data-part-critical title="${esc(t4('sharedTip'))}">${ic('lock', 'sm')}<span>${esc(t4('shared'))}</span></span>`;
function hintLine(d, src, taskMain) {
  const t = dText(d); let h;
  if (d.hint) h = d.hint[KO() ? 0 : 1];
  else if (d.kind === 'switch') h = t4('hintOffOn', t[2], t[3]);
  else if (t[2] && t[3]) h = t4('hintLowHigh', t[2], t[3]);
  else h = '';
  let def;
  if (d.noDefault) def = t4('noDefault');
  else if (d.sendable && !d.defSent) def = t4('defaultIs', t4('notSent'));
  else if (d.kind === 'text') def = t4('defaultIs', t4('emptyWord'));
  else def = t4('defaultIs', fmtVal(d, d.def));
  return { h, def };
}
function warnBlock(key, label, over, kind) {   // DS-085: the line, the fix button and the note are one critical surface (settings-param-warning)
  if (!over) return '';
  const n = fmtN(over);
  return `<div class="p4-warn" data-part="settings-param-warning" data-part-critical id="p4w-${key}" role="group" aria-label="${esc(label + ': ' + overText(over, kind))}"><p class="p4-wt">${ic('circle-alert', 'sm')}<span>${esc(overText(over, kind))}</span></p><button type="button" class="btn solid p4-fit" data-part="settings-param-fix" data-p4="fit" data-key="${key}" aria-label="${esc(label + ': ' + t4('fitTo', n, josa(n, 'ro')))}">${ic('arrow-down-to-line', 'md')}<span>${esc(t4('fitTo', n, josa(n, 'ro')))}</span></button><p class="p4-wn">${esc(t4('overNote', n, jI(n)))}</p></div>`;
}
function paramRowHTML(key, srcId, o) {
  o = o || {}; const d = DESC[key]; const src = srcOf(srcId); const task = srcId !== 'main';
  const model = task ? taskModel(srcId) : mainModel(); const sup = d.svc ? { ok: true } : supportOf(d, model, !task);
  const t = dText(d); const label = t[0]; const v = src.get(d); const sent = src.sent(d);
  const chg = isChangedD(d, src); const over = !task ? overOf(d, v, model) : null; const overK = over ? overKind(d, v, model) : null;
  const unsup = !sup.ok; const notSent = d.sendable && !sent; const locked = !task && d.global; const rid = d.rowId;
  const vtxt = fmtVal(d, v); const unsupAria = unsup ? t4('unsupportedAria', label, mname(model), vtxt) : '';
  const ro = unsup ? ' readonly aria-readonly="true" aria-disabled="true"' : (notSent ? ' aria-disabled="true" readonly' : '');
  const dis = unsup ? ' aria-disabled="true"' : '';
  const hl = hintLine(d, src); const mainRow = task && !same(src.get(d), SRC.main.get(d));
  const ids = { d: 'p4d-' + key, h: 'p4h-' + key, w: 'p4w-' + key, n: 'p4n-' + key, x: 'p4x-' + key, e: 'p4e-' + key, f: 'c-' + rid, r: 'p4r-' + key };
  const hasHint = notSent || !!(hl.h || hl.def);
  const descr = [ids.d, hasHint ? ids.h : '', over ? ids.w : '', unsup || sup.flag ? ids.n : ''].filter(Boolean).join(' ');
  let ctl = '';
  if (d.kind === 'seg') {
    let opts = d.opts; if (key === 'reasoningEffort') { const fl = !task ? flagsEff() : null; if (!(fl && fl.indexOf('claudeXHighEffort') >= 0) && v !== 'xhigh') opts = opts.filter((x) => x[0] !== 'xhigh'); }
    ctl = `<div class="seg p4-seg" data-part="settings-segmented" role="radiogroup" aria-labelledby="l-${esc(rid)}" id="${ids.f}" data-p4segs="${key}" data-src="${srcId}">${opts.map((x, i) => `<button type="button" class="seg-b" role="radio" aria-checked="${x[0] === v}" tabindex="${x[0] === v ? 0 : -1}" data-p4seg="${esc(x[0])}" data-key="${key}" data-src="${srcId}"${i === 0 ? ' data-ctl' : ''}${unsup ? ' aria-disabled="true"' : ''}>${esc(KO() ? x[1] : x[2])}</button>`).join('')}</div>`;
  }
  const fieldHTML = (d.kind === 'slider' || d.kind === 'number')
    ? `<input type="text" inputmode="${d.dec ? 'decimal' : 'numeric'}" role="spinbutton" class="inp num p4-field" data-part="settings-param-field" data-part-critical id="${ids.f}" data-ctl data-p4f="${key}" data-src="${srcId}" value="${esc(P4.drafts[srcId + '|' + key] !== undefined ? P4.drafts[srcId + '|' + key] : vtxt)}" aria-valuemin="${d.min}" aria-valuemax="${d.max}" aria-valuenow="${v}" aria-valuetext="${esc(t4('valueAria', label, vtxt))}" aria-describedby="${descr}${P4.drafts[srcId + '|' + key] !== undefined ? ' ' + ids.e : ''}"${P4.drafts[srcId + '|' + key] !== undefined ? ' aria-invalid="true"' : ''} autocomplete="off" spellcheck="false"${ro}>` : '';
  const sendHTML = d.sendable && d.kind !== 'switch'
    ? `<label class="p4-sendbox" data-part="settings-param-send" data-part-critical><span class="sw" data-part="settings-param-send-switch" data-part-critical><input type="checkbox" role="switch" id="${ids.r}s" data-p4s="${key}" data-src="${srcId}" aria-label="${esc(t4('sendOf', label))}"${sent ? ' checked' : ''}${unsup ? ' disabled' : ''}><span class="sw-ui" aria-hidden="true"></span></span><span class="p4-sendl" aria-hidden="true">${esc(t4('send'))}</span></label>` : '';
  let switchCtl = '';
  if (d.kind === 'switch') switchCtl = `<span class="sw p4-valsw" data-part="settings-toggle"><input type="checkbox" role="switch" id="${ids.f}" data-ctl data-p4v="${key}" data-src="${srcId}" aria-label="${esc(label)}" aria-describedby="${descr}"${v ? ' checked' : ''}${unsup ? ' disabled' : ''}><span class="sw-ui" aria-hidden="true"></span></span>`;
  let textCtl = '';
  if (d.kind === 'text') textCtl = `<input type="text" class="inp p4-text" data-part="settings-param-field" data-part-critical id="${ids.f}" data-ctl data-p4t="${key}" data-src="${srcId}" value="${esc(v)}" aria-describedby="${descr}" autocomplete="off" spellcheck="false">`;   // no placeholder: its contrast on the service tint is under 4.5:1 and the hint line says what empty means
  const range = d.kind === 'slider'
    ? `<div class="p4-slidebox"><input type="range" class="p4-range" data-part="settings-param-slider" id="${ids.r}" data-p4r="${key}" data-src="${srcId}" min="${d.min}" max="${d.max}" step="${d.step}" value="${v}" aria-labelledby="l-${esc(rid)}" aria-valuetext="${esc(t4('valueAria', label, vtxt))}" aria-describedby="${descr}"${dis}${notSent ? ' aria-disabled="true"' : ''}></div>` : '';
  const hintHTML = notSent
    ? `<p class="p4-hint notsent" data-part="settings-param-hint" id="${ids.h}">${esc(t4('notSent'))}</p>`
    : (hl.h || hl.def ? `<p class="p4-hint" data-part="settings-param-hint" id="${ids.h}">${hl.h ? `<span class="p4-lh">${esc(hl.h)}</span>` : ''}${hl.def ? `<span class="p4-def">${esc(hl.def)}</span>` : ''}${mainRow ? `<span class="p4-mainv">${esc(t4('taskMain', fmtVal(d, SRC.main.get(d))))}</span>` : ''}</p>` : '');
  const reasonHTML = unsup
    ? `<p class="p4-reason" data-part="settings-param-reason" data-part-critical id="${ids.n}">${ic('circle-alert', 'sm')}<span class="p4-rt">${esc(t4('unsupported'))}</span><span class="p4-rm">${esc(t4('modelLine', mname(model)))}</span></p>`
    : (sup.flag ? `<p class="p4-reason flag" data-part="settings-param-reason" data-part-critical id="${ids.n}">${ic('info', 'sm')}<span class="p4-rt">${esc(t4('viaFlag'))}</span></p>` : '');
  const warnHTML = warnBlock(key, label, over, overK);
  const open = P4.help.has(srcId + '|' + key); const helpText = t[4];
  const helpHTML = helpText ? `<button type="button" class="p4-moreb" data-p4="help" data-key="${key}" data-src="${srcId}" aria-expanded="${open}" aria-controls="${ids.x}" aria-label="${esc(t4('helpOf', label))}">${ic(open ? 'chevron-down' : 'chevron-right', 'sm')}<span>${esc(t4(open ? 'less' : 'more'))}</span></button><p class="p4-help" data-part="settings-param-help" id="${ids.x}"${open ? '' : ' hidden'}>${esc(helpText)}</p>` : '';
  const menuable = !unsup || chg;
  const attrs = `${unsup ? ' data-unsupported' : ''}${notSent ? ' data-not-sent' : ''}${over ? ' data-over' : ''}${locked ? ' data-locked' : ''}`;
  return `<div class="row p4-row${chg ? ' changed' : ''}" data-row="${esc(rid)}" data-p4row="${key}" data-src="${srcId}" data-kind="${d.kind}" data-part="settings-param-row"${attrs} role="group" ${unsup ? `aria-label="${esc(unsupAria)}"` : `aria-labelledby="l-${esc(rid)}"`} aria-describedby="${descr}">` +
    `<span class="dot" aria-hidden="true"${chg ? '' : ' hidden'}></span><div class="p4-main"><div class="p4-line"><div class="p4-lw"><label data-part="settings-param-label" data-part-critical class="r-label p4-label" id="l-${esc(rid)}" for="${ids.f}">${esc(label)}<span class="sr-only r-chg">${chg ? ' (' + esc(t4('changed')) + ')' : ''}</span></label>${locked ? lockBadge() : ''}</div>` +
    `<div class="p4-ctl">${switchCtl}${fieldHTML}${textCtl}${sendHTML}${menuable ? `<button type="button" data-part="settings-button" class="btn p4-menu${chg ? '' : ' rest'}"${chg ? '' : ' tabindex="-1"'} data-p4="menu" data-key="${key}" data-src="${srcId}" aria-haspopup="menu" aria-label="${esc(t4('rowMenu', label))}" title="${esc(t4('rowMenu', label))}">${ic('ellipsis', 'xl')}</button>` : ''}</div></div>` +
    `<p class="p4-sentence r-desc" data-part="settings-row-description" id="${ids.d}">${esc(t[1])}</p>${hintHTML}${ctl}${range}${P4.drafts[srcId + '|' + key] !== undefined ? `<p class="p4-err" id="${ids.e}" role="alert">${esc(d.kind === 'number' && d.random ? t4('invalidNum') : t4('invalid', fmtVal(d, d.min), fmtVal(d, d.max)))}</p>` : ''}${reasonHTML}${warnHTML}${helpHTML}</div></div>`;
}

/* ------------------------------------------------------------------ groups of the 파라미터 page */
const gname = (g) => (KO() ? g.ko : g.en);
function groupMenuBtn(gid, name) { return `<button type="button" data-part="settings-button" class="btn p4-gmore" data-p4="gmenu" data-group="${gid}" aria-haspopup="menu" aria-label="${esc(t4('groupMenu', name))}" title="${esc(t4('groupMenu', name))}">${ic('ellipsis', 'xl')}</button>`; }
function groupHTML(g, srcId, model, o) {
  o = o || {}; const keys = PARAMS.filter((p) => p.group === g.id && (srcId === 'main' || p.task)).map((p) => p.key);
  if (!keys.length) return '';
  const useFlags = srcId === 'main'; const sup = keys.filter((k) => supportOf(DESC[k], model, useFlags).ok); const uns = keys.filter((k) => sup.indexOf(k) < 0);
  const name = gname(g);   // DS-094: a group never collapses for support; every row the model doesn't use is dimmed with its reason (DS-080)
  const rows = sup.concat(uns).map((k) => paramRowHTML(k, srcId)).join('');
  return `<div class="p4-grp" data-part="settings-param-group" data-group="${g.id}" role="group" aria-labelledby="p4gh-${g.id}${srcId === 'main' ? '' : '-t'}"><div class="p4-gh"><h3 class="p4-gt" id="p4gh-${g.id}${srcId === 'main' ? '' : '-t'}">${esc(name)}</h3>${groupMenuBtn(g.id, name)}</div>${rows}</div>`;
}
function svcGroupHTML(svc, model, o) {
  const S = SVC[svc]; const cn = connName(model); const name = t4('groupSvc', KO() ? S.ko : S.en, cn);
  let rows = S.rows.map((s) => paramRowHTML('svc.' + svc + '.' + s.f, 'main')).join('');
  if (S.stop) rows += stopRowHTML();
  return `<div class="p4-grp p4-svc" data-part="settings-service-group" data-svc="${svc}" role="group" aria-labelledby="p4gh-svc"><div class="p4-gh"><h3 class="p4-gt" id="p4gh-svc">${esc(name)}</h3>${groupMenuBtn('svc', name)}</div>${rows}</div>`;
}
function stopRowHTML() {
  const r = rowOf('models.localStopStrings'); const l = stopGet(); const label = KO() ? r.ko : r.en;
  return `<div class="row p4-row p4-stop" data-row="models.localStopStrings" data-part="settings-param-row" data-p4list="stop" data-locked role="group" aria-labelledby="l-models.localStopStrings"><div class="p4-main"><div class="p4-line"><div class="p4-lw"><span data-part="settings-param-label" data-part-critical class="r-label p4-label" id="l-models.localStopStrings">${esc(label)}</span>${lockBadge()}</div></div>` +
    `<p class="p4-sentence r-desc" data-part="settings-row-description">${esc(A.pair(r.desc))}</p>` +
    `<ul class="p4-sl" role="list">${l.map((s, i) => `<li class="p4-sli"><input type="text" class="inp p4-stopin" data-part="settings-param-field" data-part-critical data-p4stop="${i}" value="${esc(s.replace(/\n/g, '\\n'))}" aria-label="${esc(label + ' ' + (i + 1))}" autocomplete="off" spellcheck="false"><button type="button" data-part="settings-button" class="btn p4-del" data-p4="stopdel" data-i="${i}" aria-label="${esc(t4('svcStopDel', s.replace(/\n/g, '\\n')))}" title="${esc(t4('svcStopDel', s.replace(/\n/g, '\\n')))}">${ic('trash-2', 'lg')}</button></li>`).join('')}</ul>` +
    `${l.length ? '' : `<p class="p4-empty">${esc(t4('svcStopEmpty'))}</p>`}<button type="button" data-part="settings-button" class="btn solid p4-add" data-ctl data-p4="stopadd" aria-label="${esc(t4('svcStopAdd') + ': ' + label)}">${ic('plus', 'lg')}<span>${esc(t4('svcStopAdd'))}</span></button>` +
    `<button type="button" class="p4-moreb" data-p4="help" data-key="stop" data-src="main" aria-expanded="${P4.help.has('main|stop')}" aria-controls="p4x-stop" aria-label="${esc(t4('helpOf', label))}">${ic(P4.help.has('main|stop') ? 'chevron-down' : 'chevron-right', 'sm')}<span>${esc(t4(P4.help.has('main|stop') ? 'less' : 'more'))}</span></button><p class="p4-help" data-part="settings-param-help" id="p4x-stop"${P4.help.has('main|stop') ? '' : ' hidden'}>${esc(A.pair(r.help))}</p></div></div>`;
}

/* ------------------------------------------------------------------ 고급 (DS-079): bias, additional parameters, custom flags, tools, module integration */
const ADV_ROWS = ['models.bias', 'models.addParams', 'models.applyAddParamsAll', 'models.enableCustomFlags', 'models.customFlags', 'models.modelTools', 'models.moduleIntegration'];
function infoBtn(key, label) { const open = P4.help.has('main|' + key); return `<button type="button" class="p4-moreb" data-p4="help" data-key="${key}" data-src="main" aria-expanded="${open}" aria-controls="p4x-${key}" aria-label="${esc(t4('helpOf', label))}">${ic(open ? 'chevron-down' : 'chevron-right', 'sm')}<span>${esc(t4(open ? 'less' : 'more'))}</span></button>`; }
function helpP(key, id) { const open = P4.help.has('main|' + key); return `<p class="p4-help" data-part="settings-param-help" id="p4x-${key}"${open ? '' : ' hidden'}>${esc(A.pair(rowOf(id).help))}</p>`; }
function biasHTML() {
  const bok = biasOk(mainModel()); const ro = bok ? '' : ' readonly aria-readonly="true"'; const dis = bok ? '' : ' aria-disabled="true"';   // R4-16: a dimmed bias editor is read-only like the other dimmed rows; an attempted edit is explained (DS-096)
  const l = biasGet(); const r = rowOf('models.bias'); const label = KO() ? r.ko : r.en; const chg = l.length > 0;
  const items = l.map((e, i) => `<li class="p4-bi" data-i="${i}"><input type="text" class="inp p4-bt-text" data-part="settings-param-field" data-part-critical data-p4bias="text" data-i="${i}"${ro} value="${esc(e[0])}" aria-label="${esc(t4('biasTextOf', i + 1))}" autocomplete="off" spellcheck="false"><input type="text" inputmode="numeric" class="inp num p4-bt-num" data-part="settings-param-field" data-part-critical data-p4bias="num" data-i="${i}"${ro} value="${e[1]}" aria-label="${esc(t4('biasNumOf', e[0]))}" aria-describedby="p4bl" autocomplete="off" spellcheck="false"><button type="button" data-part="settings-button" class="btn p4-del" data-p4="biasdel" data-i="${i}"${dis} aria-label="${esc(t4('biasDel', e[0]))}" title="${esc(t4('biasDel', e[0]))}">${ic('trash-2', 'lg')}</button></li>`).join('');
  const breason = bok ? '' : `<p class="p4-reason" data-part="settings-param-reason" data-part-critical id="p4n-bias">${ic('circle-alert', 'sm')}<span class="p4-rt">${esc(t4('unsupported'))}</span><span class="p4-rm">${esc(t4('modelLine', mname(mainModel())))}</span></p>`;   // R4-4 / DS-080: a model that takes no bias table leaves the row dimmed with its reason; the entries are kept
  return `<div class="row p4-row p4-adv-row${chg ? ' changed' : ''}" data-row="models.bias" data-part="settings-param-row" data-p4list="bias"${bok ? '' : ' data-unsupported aria-describedby="p4n-bias"'} role="group" aria-labelledby="l-models.bias"><span class="dot" aria-hidden="true"${chg ? '' : ' hidden'}></span><div class="p4-main"><div class="p4-line"><div class="p4-lw"><span data-part="settings-param-label" data-part-critical class="r-label p4-label" id="l-models.bias">${esc(label)}</span></div>` +
    `<div class="p4-ctl"><button type="button" data-part="settings-button" class="btn p4-ibtn" data-ctl data-p4="biasimport"${dis} aria-label="${esc(t4('biasImport'))}" title="${esc(t4('biasImport'))}">${ic('upload', 'xl')}</button><button type="button" data-part="settings-button" class="btn p4-ibtn" data-p4="biasexport" aria-label="${esc(t4('biasExport'))}" title="${esc(t4('biasExport'))}">${ic('download', 'xl')}</button></div></div>` +
    `<p class="p4-sentence r-desc" data-part="settings-row-description" id="p4bl">${esc(t4('biasSentence'))} · ${esc(t4('biasLegend'))}</p>` +
    `<ul class="p4-bt" data-part="settings-bias-table" role="list" aria-label="${esc(label)}">${items}</ul>${l.length ? '' : `<p class="p4-empty">${esc(t4('biasEmpty'))}</p>`}${breason}` +
    `<button type="button" data-part="settings-button" class="btn solid p4-add" data-p4="biasadd"${dis} aria-label="${esc(t4('biasAdd'))}">${ic('plus', 'lg')}<span>${esc(t4('biasAdd'))}</span></button>${infoBtn('bias', label)}${helpP('bias', 'models.bias')}</div></div>`;
}
const CORE_API = (() => { const o = {}; PARAMS.forEach((p) => { o[p.api] = p.key; }); o.max_tokens = 'maxResponse'; o.top_p = 'topP'; return o; })();
function apHTML() {
  const l = apGet(); const r = rowOf('models.addParams'); const label = KO() ? r.ko : r.en; const chg = l.length > 0;
  const items = l.map((e, i) => {
    const pr = apParse(e[1]); const core = CORE_API[e[0]] ? DESC[CORE_API[e[0]]] : null; const bad = pr.type === 'json' && !apJsonOk(pr.text);
    return `<li class="p4-ai" data-i="${i}"><div class="p4-ai-row"><input type="text" class="inp p4-ap-key" data-part="settings-param-field" data-part-critical data-p4ap="key" data-i="${i}" value="${esc(e[0])}" aria-label="${esc(t4('apKey') + ' ' + (i + 1))}" placeholder="${esc(t4('apKey'))}" autocomplete="off" spellcheck="false">` +
      `<select class="p4-ap-type" data-part="settings-param-field" data-part-critical data-p4ap="type" data-i="${i}" aria-label="${esc(t4('apType') + ' ' + (i + 1))}">${[['value', 'apTypeValue'], ['json', 'apTypeJson'], ['header', 'apTypeHeader'], ['none', 'apTypeNone']].map((x) => `<option value="${x[0]}"${pr.type === x[0] ? ' selected' : ''}>${esc(t4(x[1]))}</option>`).join('')}</select>` +
      `${pr.type === 'none' ? '' : `<input type="text" class="inp p4-ap-val" data-part="settings-param-field" data-part-critical data-p4ap="val" data-i="${i}" value="${esc(pr.text)}" aria-label="${esc(t4('apVal') + ' ' + (i + 1))}" placeholder="${esc(t4('apVal'))}"${bad ? ' aria-invalid="true"' : ''} autocomplete="off" spellcheck="false">`}` +
      `<button type="button" data-part="settings-button" class="btn p4-del" data-p4="apdel" data-i="${i}" aria-label="${esc(t4('apDel', e[0]))}" title="${esc(t4('apDel', e[0]))}">${ic('trash-2', 'lg')}</button></div>` +
      `${bad ? `<p class="p4-note bad" role="status">${ic('circle-alert', 'sm')}<span>${esc(t4('apJsonBad'))}</span></p>` : ''}${core ? `<p class="p4-note" role="status">${ic('info', 'sm')}<span>${esc(t4('apCoreOf', dLabel(core)))}</span></p>` : ''}</li>`;
  }).join('');
  return `<div class="row p4-row p4-adv-row${chg ? ' changed' : ''}" data-row="models.addParams" data-part="settings-param-row" data-p4list="ap" data-locked role="group" aria-labelledby="l-models.addParams"><span class="dot" aria-hidden="true"${chg ? '' : ' hidden'}></span><div class="p4-main"><div class="p4-line"><div class="p4-lw"><span data-part="settings-param-label" data-part-critical class="r-label p4-label" id="l-models.addParams">${esc(label)}</span>${lockBadge()}</div></div>` +
    `<p class="p4-sentence r-desc" data-part="settings-row-description">${esc(t4('apSentence'))}</p>` +
    `<ul class="p4-apt" data-part="settings-addparam-table" role="list" aria-label="${esc(label)}">${items}</ul>${l.length ? '' : `<p class="p4-empty">${esc(t4('apEmpty'))}</p>`}` +
    `<button type="button" data-part="settings-button" class="btn solid p4-add" data-ctl data-p4="apadd" aria-label="${esc(t4('apAdd'))}">${ic('plus', 'lg')}<span>${esc(t4('apAdd'))}</span></button>${infoBtn('ap', label)}${helpP('ap', 'models.addParams')}</div></div>`;
}
function applyHTML() {
  const ar = rowOf('models.applyAddParamsAll');
  return `<div class="row p4-row p4-adv-row" data-row="models.applyAddParamsAll" data-part="settings-param-row" data-locked role="group" aria-labelledby="l-models.applyAddParamsAll"><div class="p4-main"><div class="p4-line"><div class="p4-lw"><label data-part="settings-param-label" data-part-critical class="r-label p4-label" id="l-models.applyAddParamsAll" for="c-models.applyAddParamsAll">${esc(t4('applyAll'))}</label>${lockBadge()}</div><div class="p4-ctl"><span class="sw" data-part="settings-toggle"><input type="checkbox" role="switch" id="c-models.applyAddParamsAll" data-ctl data-p4g="applyAll"${ar.v ? ' checked' : ''}><span class="sw-ui" aria-hidden="true"></span></span></div></div><p class="p4-sentence r-desc" data-part="settings-row-description">${esc(t4('applyAllDesc'))}</p></div></div>`;
}
function flagsHTML() {
  const on = !!rowOf('models.enableCustomFlags').v; const fl = flagsEff() || []; const label = t4('flagTitle'); const chg = on || !!rowOf('models.customFlags').v;
  let body = '';
  if (on) body = `<div class="p4-flags" data-part="settings-flag-list" role="group" aria-label="${esc(t4('flagListLabel'))}">${FLAG_GROUPS.map((g) => `<div class="p4-fg" role="group" aria-labelledby="p4fg-${g[0]}"><h4 class="p4-fgt" id="p4fg-${g[0]}">${esc(KO() ? g[1] : g[2])}</h4>${FLAGS24.filter((f) => f[1] === g[0]).map((f) => {
    const nm = KO() ? f[2] : f[4], line = KO() ? f[3] : f[5]; const rev = f[6] ? f[6].map((k) => dLabel(DESC[k])) : null;
    return `<label class="p4-flag${fl.indexOf(f[0]) >= 0 ? ' on' : ''}" data-flag="${f[0]}"><span class="sw" data-part="settings-toggle"><input type="checkbox" role="switch" data-p4flag="${f[0]}" aria-label="${esc(nm)}"${fl.indexOf(f[0]) >= 0 ? ' checked' : ''}><span class="sw-ui" aria-hidden="true"></span></span><span class="p4-ft"><span class="p4-fn">${esc(nm)}<code class="p4-enum">${esc(f[0])}</code></span><span class="p4-fl">${esc(line)}</span>${rev ? `<span class="p4-frev">${esc(t4('flagReveals', rev))}</span>` : ''}</span></label>`; }).join('')}</div>`).join('')}</div>`;
  const rr = rowOf('models.enableCustomFlags');
  return `<div class="row p4-row p4-adv-row${chg ? ' changed' : ''}" data-row="models.enableCustomFlags" data-part="settings-param-row" data-p4list="flags" role="group" aria-labelledby="l-models.enableCustomFlags"><span class="dot" aria-hidden="true"${chg ? '' : ' hidden'}></span><div class="p4-main"><div class="p4-line"><div class="p4-lw"><label data-part="settings-param-label" data-part-critical class="r-label p4-label" id="l-models.enableCustomFlags" for="c-models.enableCustomFlags">${esc(label)}</label></div><div class="p4-ctl"><span class="sw" data-part="settings-toggle"><input type="checkbox" role="switch" id="c-models.enableCustomFlags" data-ctl data-p4g="flagsOn"${rr.v ? ' checked' : ''}><span class="sw-ui" aria-hidden="true"></span></span></div></div>` +
    `<p class="p4-sentence r-desc" data-part="settings-row-description">${esc(t4('flagSentence'))}</p><p class="p4-warn flagwarn" data-part="settings-param-flags-note" data-part-critical role="note">${ic('triangle-alert', 'sm')}<span>${esc(t4('flagWarn'))}</span></p>${body}${infoBtn('flags', label)}${helpP('flags', 'models.customFlags')}</div></div>`;
}
function toolsHTML() {
  const m = mainModel(); const ok = toolsOk(m); const r = rowOf('models.modelTools'); const chg = !!r.v;
  return `<div class="row p4-row p4-adv-row${chg ? ' changed' : ''}" data-row="models.modelTools" data-part="settings-param-row" data-p4list="tools"${ok ? '' : ' data-unsupported'} role="group" ${ok ? 'aria-labelledby="l-models.modelTools"' : `aria-label="${esc(t4('unsupportedAria', t4('toolTitle') + ': ' + t4('toolSearch'), mname(m), fmtVal({ kind: 'switch' }, r.v)))}"`}><span class="dot" aria-hidden="true"${chg ? '' : ' hidden'}></span><div class="p4-main"><div class="p4-line"><div class="p4-lw"><label data-part="settings-param-label" data-part-critical class="r-label p4-label" id="l-models.modelTools" for="c-models.modelTools">${esc(t4('toolTitle'))}: ${esc(t4('toolSearch'))}</label></div><div class="p4-ctl"><span class="sw" data-part="settings-toggle"><input type="checkbox" role="switch" id="c-models.modelTools" data-ctl data-p4g="tools"${r.v ? ' checked' : ''}${ok ? '' : ' disabled'}><span class="sw-ui" aria-hidden="true"></span></span></div></div>` +
    `<p class="p4-sentence r-desc" data-part="settings-row-description">${esc(t4('toolSearchLine'))}</p>${ok ? '' : `<p class="p4-reason" data-part="settings-param-reason" data-part-critical>${ic('circle-alert', 'sm')}<span class="p4-rt">${esc(t4('unsupported'))}</span><span class="p4-rm">${esc(t4('modelLine', mname(m)))}</span></p>`}</div></div>`;
}
function moduleHTML() {
  const r = rowOf('models.moduleIntegration'); const chg = r.v !== r.d;
  return `<div class="row p4-row p4-adv-row${chg ? ' changed' : ''}" data-row="models.moduleIntegration" data-part="settings-param-row" data-p4list="mod" role="group" aria-labelledby="l-models.moduleIntegration"><span class="dot" aria-hidden="true"${chg ? '' : ' hidden'}></span><div class="p4-main"><div class="p4-line"><div class="p4-lw"><label data-part="settings-param-label" data-part-critical class="r-label p4-label" id="l-models.moduleIntegration" for="c-models.moduleIntegration">${esc(t4('modTitle'))}</label></div></div>` +
    `<p class="p4-sentence r-desc" data-part="settings-row-description">${esc(t4('modLine'))}</p><input type="text" class="inp p4-modin" data-part="settings-param-field" data-part-critical id="c-models.moduleIntegration" data-ctl data-p4g="mod" value="${esc(r.v)}" placeholder="${esc(t4('modPh'))}" autocomplete="off" spellcheck="false" aria-describedby="p4x-mod"><p class="p4-note" id="p4x-mod">${ic('info', 'sm')}<span>${esc(t4('modStudio'))}</span></p>${infoBtn('mod', t4('modTitle'))}${helpP('mod', 'models.moduleIntegration')}</div></div>`;
}
function advHTML() {
  const open = P4.adv;
  return `<div class="p4-grp p4-adv" data-part="settings-param-advanced" ${open ? 'data-open' : 'data-closed'} role="group" aria-labelledby="p4gh-adv"><h3 class="p4-gh p4-gt" id="p4gh-adv"><button type="button" class="p4-advb" data-p4="adv" aria-expanded="${open}" aria-controls="p4adv">${ic(open ? 'chevron-down' : 'chevron-right', 'lg')}<span class="p4-advt">${esc(t4('groupAdv'))}</span><span class="p4-advh">${esc(t4('advHint'))}</span></button></h3>` +
    `<div class="p4-advbody" id="p4adv"${open ? '' : ' hidden'}>${open ? biasHTML() + apHTML() + applyHTML() + flagsHTML() + toolsHTML() + moduleHTML() : ''}</div></div>`;
}
function previewHTML() {
  const open = P4.preview;
  return `<div class="p4-grp p4-pv" data-part="settings-param-preview" ${open ? 'data-open' : 'data-closed'} role="group" aria-labelledby="p4gh-pv"><h3 class="p4-gh p4-gt" id="p4gh-pv"><button type="button" class="p4-advb" data-p4="preview" aria-expanded="${open}" aria-controls="p4pv">${ic(open ? 'chevron-down' : 'chevron-right', 'lg')}<span class="p4-advt">${esc(t4('preview'))}</span></button></h3><div class="p4-pvbody" id="p4pv"${open ? '' : ' hidden'}>${open ? `<p class="p4-estimate" data-part="settings-param-estimate" data-part-critical>${ic('info', 'sm')}<span>${esc(t4('previewEstimate'))}</span></p><p class="p4-sentence r-desc" data-part="settings-row-description">${esc(t4('previewNote'))}</p><pre class="p4-pre" tabindex="0" aria-label="${esc(t4('preview') + ' · ' + t4('previewEstimate'))}">${esc(previewText())}</pre>${leftOutHTML()}` : ''}</div></div>`;
}

/* ------------------------------------------------------------------ the page body of 파라미터 */
function paramsBody(o) {
  o = o || {}; const m = mainModel(); const svc = svcOf(m); const p = A.activePreset();
  const revealKey = o.reveal && rowOfKey(o.reveal);
  let h = `<div class="p4" id="p4Root" data-part="settings-param-page" data-svc="${svc || ''}"><div class="p4-top" data-part="settings-param-header"><p class="p4-title">${esc(t4('paramsTitle', p.name))}</p><div class="p4-modelrow"><span class="p4-mname">${ic('cpu', 'lg')}<span><span class="p4-mlab">${esc(t4('mainModelIs'))}</span> <b>${esc(mname(m))}</b>${connName(m) ? `<span class="p4-mconn"> · ${esc(connName(m))}</span>` : ''}</span></span><button type="button" data-part="settings-button" class="btn solid p4-chg" data-p4="pickmodel" aria-label="${esc(t4('changeModelOf', mname(m)))}">${ic('cpu', 'lg')}<span>${esc(t4('changeModel'))}</span></button></div></div>`;
  GROUPS.forEach((g) => { h += groupHTML(g, 'main', m, { reveal: revealKey }); });
  if (svc) h += svcGroupHTML(svc, m, o);
  else if (o.reveal && /^models\.svc\./.test(o.reveal)) { const r = rowOf(o.reveal); h += `<div class="row unavail-note p4-svcnote" data-row="${esc(o.reveal)}" data-part="settings-row" data-row-kind="unavailable" role="group" aria-labelledby="l-${esc(o.reveal)}" tabindex="-1">${ic('triangle-alert', 'lg')}<div class="un-body"><p data-part="settings-row-label" class="r-label" id="l-${esc(o.reveal)}">${esc(A.L(r))}</p><p data-part="settings-row-description" class="r-desc">${esc(t4('svcNotHere', KO() ? SVC[r.svc].ko : SVC[r.svc].en))}</p></div></div>`; }
  h += advHTML() + previewHTML();
  return h + '</div>';
}
function rowOfKey(rowId) { const p = PARAMS.find((x) => x.id === rowId); return p ? p.key : null; }

/* ------------------------------------------------------------------ writing: undo, toasts, resets */
function setRowC(id, v) {   // like setRow, and a burst of edits of one row inside 700 ms stays one undo step (typing a number, dragging a task slider)
  const p = B.act(); const n0 = p.undo.length; const prev = p.undo[n0 - 1]; const ok = setRow(id, v);
  if (ok && p.undo.length === n0 + 1) { const last = p.undo[n0]; if (prev && !prev.bulk && !last.bulk && prev.id === last.id && last.tn - prev.tn < 700) { prev.to = last.to; prev.tn = last.tn; p.undo.pop(); } }
  return ok;
}
function batch(fn) {   // runs fn, then folds the undo steps it made into one bulk step (group reset, task copy)
  const p = B.act(); const n0 = p.undo.length; const l0 = p.undo[n0 - 1]; const tn0 = l0 ? l0.tn : 0, to0 = l0 ? l0.to : null; fn(); B.commitPending();
  const n1 = p.undo.length; if (n1 === n0 && l0 && (l0.tn !== tn0 || l0.to !== to0)) return l0;   // slice 2 folded the edit into the step just before it (a slider edit inside 700 ms): that step is the one to undo
  if (n1 - n0 >= 2) { const steps = p.undo.splice(n0, n1 - n0); p.undo.push({ bulk: true, changes: steps.filter((s) => !s.bulk).map((s) => ({ id: s.id, from: s.from, to: s.to })), tn: steps[steps.length - 1].tn }); }
  return n1 > n0 ? p.undo[p.undo.length - 1] : null;
}
function undoIfTop(step) { const p = B.act(); if (step && p.undo[p.undo.length - 1] === step) { B.doUndo(); return true; } A.announce(t4('staleUndo')); return false; }
function luStep(label, step) {   // Alt+Z reaches a toasted change through the library stack too (DS-024/036): the entry takes the preset step back if it is still the newest, else it is skipped and Alt+Z goes on to the next entry
  const p0 = B.act();
  return B.pushLU(label, () => { if (A.S.presetActive !== p0.id) { A.announce(t4('staleUndo')); return ''; } const p = B.act(); if (p.undo[p.undo.length - 1] === step) B.doUndo(); else setTimeout(() => B.undoLast(), 0); return ''; }, 'param-step', { step: true });
}
function toastUndo(msg, step, o) {
  o = o || {}; const lu = o.lu || (step ? luStep(msg, step) : null);
  B.psToast(msg, { kind: o.kind || 'param', until: lu ? 'page' : undefined, action: lu ? { label: B.t2('undo'), title: B.t2('undo') + ' (Alt+Z)', fn: () => B.runLU(lu.id) } : null });   // the toast announces itself
}
function gset(id, v, label, o) {   // a value outside the preset (seed, additional parameters, stop strings): its own undo through the library stack (Alt+Z)
  o = o || {}; const r = rowOf(id); const old = r.v; if (same(old, v)) return false; r.v = v;
  const e = B.pushLU(label || A.L(r), () => { r.v = old; repaintAfterWrite(); return ''; }, 'param-g', { row: id });
  if (o.toast) toastUndo(o.toast, null, { lu: e, kind: 'param-g' });
  return e;
}
function resetKeys(keys, srcId, label, o) {
  o = o || {}; const src = srcOf(srcId); let lu = null;
  const step = batch(() => { keys.forEach((k) => { const d = DESC[k]; if (d.global) { lu = src.set(d, d.def) || lu; return; } if (d.noDefault) { src.setSent(d, d.defSent); return; } src.set(d, d.def); if (d.sendable) src.setSent(d, d.defSent); }); });
  keys.forEach((k) => { if (srcId === 'main') { repaintRow(k, srcId); } });
  if (srcId !== 'main') A.refreshPage();
  settleFocus(keys[0], srcId, o.group ? keys[0] && DESC[keys[0]].group : null);   // R4-1: the row was rebuilt under the menu that held the focus; it lands on the row's control, never on the page body
  let msg = o.group ? t4('resetGroupDone', label) : t4('resetDone');
  if (srcId === 'main' && keys.some((k) => DESC[k].limit && overOf(DESC[k], rowOf(DESC[k].rowId).v, mainModel()))) msg += ' · ' + t4('resetOver');   // R4-6: the default can itself be over a small model's limit
  if (step || lu) toastUndo(msg, step, { lu: step ? null : lu, kind: 'param-reset' });
  return step;
}
function settleFocus(key, srcId, gid) {
  const run = () => {
    const a = document.activeElement; if (a && a !== document.body && a.isConnected && !a.closest('.menu, [role=menu]')) return;
    let e = null; if (gid) e = $(`#pageScroll [data-p4="gmenu"][data-group="${gid}"]`); if (!e) { const row = rowEl(key, srcId); e = row && ($('[data-ctl]', row) || $('.p4-menu', row)); }
    if (e) e.focus({ preventScroll: true });
  };
  run(); setTimeout(run, 0); setTimeout(run, 160);
}
function fitKey(key) {
  const d = DESC[key]; const m = mainModel(); const lim = overOf(d, rowOf(d.rowId).v, m); if (!lim) return false;   // the limit when over a known model limit, else the context size for a long response (R4-5)
  const step = batch(() => SRC.main.set(d, lim));
  repaintRow(key, 'main'); const f = $(`[data-p4f="${key}"]`); if (f) f.focus({ preventScroll: true });
  toastUndo(t4('fitted', dLabel(d), fmtN(lim), josa(fmtN(lim), 'ro')), step, { kind: 'param-fit' }); paintTaskLines(); return true;
}
function toggleSend(key, srcId, on) {
  const d = DESC[key]; const src = srcOf(srcId); if (!d.sendable) return false;
  if (!src.setSent(d, on)) return false;
  repaintRow(key, srcId, '[data-p4s]'); paintTaskLines();
  A.announce(on ? t4('annSentOn', dLabel(d), fmtVal(d, src.get(d))) : t4('annSentOff', dLabel(d)));
  return true;
}
function selectSeg(key, srcId, val) {
  const d = DESC[key]; const src = srcOf(srcId); const m = srcId === 'main' ? mainModel() : taskModel(srcId); if (!supportOf(d, m, srcId === 'main').ok) { blocked(key, srcId); return false; }
  if (!src.set(d, val)) return false;
  const row = rowEl(key, srcId); if (row) { $$('[data-p4seg]', row).forEach((b) => { const on = b.dataset.p4seg === val; b.setAttribute('aria-checked', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1; }); liveRow(key, srcId); }
  paintTaskLines(); return true;
}

/* ------------------------------------------------------------------ in-place updates (a slider that is being dragged is never replaced) */
const rowEl = (key, srcId) => $(`#pageScroll .p4-row[data-p4row="${key}"][data-src="${srcId}"]`);
function liveRow(key, srcId, o) {
  o = o || {}; const el = rowEl(key, srcId); if (!el) return; const d = DESC[key]; const src = srcOf(srcId); const v = src.get(d); const txt = fmtVal(d, v); const label = dLabel(d); const chg = isChangedD(d, src);
  el.classList.toggle('changed', chg); const dot = $('.dot', el); if (dot) dot.hidden = !chg;
  const sr = $('.r-chg', el); if (sr) sr.textContent = chg ? ' (' + t4('changed') + ')' : '';
  const mb = $('.p4-menu', el); if (mb) { mb.classList.toggle('rest', !chg); if (chg) mb.removeAttribute('tabindex'); else mb.setAttribute('tabindex', '-1'); }
  const f = $('[data-p4f]', el); if (f) { f.setAttribute('aria-valuenow', v); f.setAttribute('aria-valuetext', t4('valueAria', label, txt)); if (!o.keepField) f.value = txt; if (!o.keepField) f.removeAttribute('aria-invalid'); }
  const r = $('[data-p4r]', el); if (r) { if (!o.keepRange) r.value = v; r.setAttribute('aria-valuetext', t4('valueAria', label, txt)); }
  if (d.limit && srcId === 'main') paintWarn(el, d, key, label);
  if (key === 'maxContext' && srcId === 'main') { const re = rowEl('maxResponse', 'main'); if (re) paintWarn(re, DESC.maxResponse, 'maxResponse', dLabel(DESC.maxResponse)); }   // a response longer than the context size follows the context (R4-5)
}
function paintWarn(el, d, key, label) {
  const v0 = rowOf(d.rowId).v; const over = overOf(d, v0, mainModel()); const kind = over ? overKind(d, v0, mainModel()) : null; const old = $('.p4-warn', el); const had = !!old;
  if (!!over === had && (!over || (old && old.querySelector('.p4-wt span').textContent === overText(over, kind)))) return;
  if (old) old.remove();
  el.toggleAttribute('data-over', !!over);
  if (over) { const tmp = document.createElement('div'); tmp.innerHTML = warnBlock(key, label, over, kind); const anchor = $('.p4-moreb', el); const w = tmp.firstElementChild; if (anchor) anchor.parentNode.insertBefore(w, anchor); else $('.p4-main', el).appendChild(w); }
  const f = $('[data-p4f]', el); if (f) { const ids = (f.getAttribute('aria-describedby') || '').split(' ').filter((x) => x && x !== 'p4w-' + key); if (over) ids.push('p4w-' + key); f.setAttribute('aria-describedby', ids.join(' ')); }
  paintTaskLines();
}
function focusKeyOf(a) {
  if (!a || !a.dataset) return null; const ds = a.dataset;
  for (const k of ['p4f', 'p4r', 'p4s', 'p4v', 'p4t']) if (ds[k] !== undefined) return { sel: `[data-${k}="${ds[k]}"][data-src="${ds.src}"]`, ss: a.selectionStart, se: a.selectionEnd };
  if (ds.p4seg !== undefined) return { sel: `[data-p4seg="${ds.p4seg}"][data-key="${ds.key}"][data-src="${ds.src}"]` };
  const lf = listFocus(a); if (lf) return { sel: lf, ss: a.selectionStart, se: a.selectionEnd };
  if (ds.p4) return { sel: `[data-p4="${ds.p4}"]` + (ds.key ? `[data-key="${ds.key}"]` : '') + (ds.group ? `[data-group="${ds.group}"]` : '') + (ds.task ? `[data-task="${ds.task}"]` : '') + (ds.mode ? `[data-mode="${ds.mode}"]` : '') };
  return null;
}
function restoreFocus(scope, fk) { if (!fk) return; let e = $(fk.sel, scope); if (!e) e = $('[data-ctl]', scope); if (e) { e.focus({ preventScroll: true }); if (fk.ss !== undefined && e.setSelectionRange) { try { e.setSelectionRange(fk.ss, fk.se); } catch (x) { /* not a text field */ } } } }
function repaintRow(key, srcId, focusSel) {
  flushSlider(); const el = rowEl(key, srcId); if (!el) return; P4.painting = true; const had = el.contains(document.activeElement); const fk = had ? focusKeyOf(document.activeElement) : null;
  const tmp = document.createElement('div'); tmp.innerHTML = paramRowHTML(key, srcId); const nu = tmp.firstElementChild; el.replaceWith(nu);
  P4.painting = false;
  if (had) { if (fk && $(fk.sel, nu)) restoreFocus(nu, fk); else if (focusSel && $(focusSel, nu)) $(focusSel, nu).focus({ preventScroll: true }); else { const c = $('[data-ctl]', nu); if (c) c.focus({ preventScroll: true }); } }
  if (key === 'maxContext' && srcId === 'main') { const re = rowEl('maxResponse', 'main'); if (re && !re.contains(document.activeElement)) repaintRow('maxResponse', 'main'); }
}
function repaintParams() {
  flushSlider(); const root = $('#p4Root'); if (!root) return false; P4.painting = true; const sc = $('#pageScroll'); const a = document.activeElement; const had = root.contains(a); const fk = had ? focusKeyOf(a) : null; const st = sc.scrollTop;
  const tmp = document.createElement('div'); tmp.innerHTML = paramsBody({}); const nu = tmp.firstElementChild; root.replaceWith(nu); sc.scrollTop = st; P4.painting = false;
  if (had) { if (fk && $(fk.sel, nu)) restoreFocus(nu, fk); else { const c = $('[data-ctl]', nu) || $('.p4-top button', nu); if (c) c.focus({ preventScroll: true }); } }
  paintTaskLines(); return true;
}
function repaintAfterWrite() { if (P4.view === 'task') A.refreshPage(); else { if (!repaintParams()) paintTaskLines(); } }
function repaintList(which) {   // re-render one structured row of 고급 (bias, additional parameters, flags, tools) and keep the focus where it was
  const el = $(`#pageScroll [data-p4list="${which}"]`); if (!el) return; const a = document.activeElement; const had = el.contains(a); const fk = had ? listFocus(a) : null;
  const html = { bias: biasHTML, ap: apHTML, flags: flagsHTML, tools: toolsHTML, mod: moduleHTML, stop: stopRowHTML }[which](); const tmp = document.createElement('div'); tmp.innerHTML = html;
  const kids = [...tmp.children]; el.replaceWith(...kids);
  if (had && fk) { const e = $(fk, kids[0].parentNode || document); if (e) e.focus({ preventScroll: true }); }
}
function listFocus(a) { const d = a.dataset; if (d.p4bias) return `[data-p4bias="${d.p4bias}"][data-i="${d.i}"]`; if (d.p4ap) return `[data-p4ap="${d.p4ap}"][data-i="${d.i}"]`; if (d.p4stop !== undefined) return `[data-p4stop="${d.p4stop}"]`; if (d.p4) return `[data-p4="${d.p4}"]` + (d.i !== undefined ? `[data-i="${d.i}"]` : ''); if (d.p4flag) return `[data-p4flag="${d.p4flag}"]`; if (d.p4g) return `[data-p4g="${d.p4g}"]`; return null; }

/* ------------------------------------------------------------------ menus */
function rowMenu(key, srcId, anchor, point, opener) {
  const d = DESC[key]; const src = srcOf(srcId); const chg = isChangedD(d, src);
  A.showMenu([{ icon: 'rotate-ccw', label: t4('resetRow'), disabled: !chg, fn: () => resetKeys([key], srcId, dLabel(d)) }], anchor, point, opener, t4('rowMenu', dLabel(d)));
}
function groupMenu(gid, srcId, anchor, opener) {
  const keys = gid === 'svc' ? SVC[svcOf(mainModel())].rows.map((s) => 'svc.' + svcOf(mainModel()) + '.' + s.f) : PARAMS.filter((p) => p.group === gid && (srcId === 'main' || p.task)).map((p) => p.key);
  const g = GROUPS.find((x) => x.id === gid); const name = g ? gname(g) : t4('groupSvc', KO() ? SVC[svcOf(mainModel())].ko : SVC[svcOf(mainModel())].en, '');
  const any = keys.some((k) => isChangedD(DESC[k], srcOf(srcId)));
  A.showMenu([{ icon: 'rotate-ccw', label: t4('resetGroup'), disabled: !any, fn: () => resetKeys(keys, srcId, name, { group: true }) }], anchor, null, opener || anchor, t4('groupMenu', name));
}

/* ------------------------------------------------------------------ 고급 editors: bias, additional parameters, stop strings, custom flags */
function writeList(id, nv, msg, label, o) {   // a preset list row: one undo step through slice 2, plus a library entry so Alt+Z and the toast reach it
  o = o || {}; const ov = rowOf(id).v; const p0 = B.act(); const step = batch(() => setRow(id, nv));
  if (!step) return false;
  if (o.silent) return step;
  const e = B.pushLU(label, () => { if (A.S.presetActive !== p0.id) { A.announce(t4('staleUndo')); return ''; } const p = B.act(); if (p.undo[p.undo.length - 1] === step) B.doUndo(); else setRow(id, ov); repaintAfterWrite(); return ''; }, 'param-list', { row: id });
  toastUndo(msg, null, { lu: e, kind: 'param-list' }); return step;
}
function biasWrite(list, msg, label, o) { return writeList('models.bias', JSON.stringify(list), msg, label, o); }
function biasAdd() { const l = biasGet(); l.push(['', 0]); biasWrite(l, t4('biasAdded'), t4('biasAdded'), { silent: true }); repaintList('bias'); const i = l.length - 1; const e = $(`[data-p4bias="text"][data-i="${i}"]`); if (e) e.focus({ preventScroll: true }); A.announce(t4('biasAdded')); }
function biasDel(i) { const l = biasGet(); if (i < 0 || i >= l.length) return; l.splice(i, 1); biasWrite(l, t4('biasDeleted'), t4('biasDeleted')); repaintList('bias'); const nx = $(`[data-p4bias="text"][data-i="${Math.min(i, l.length - 1)}"]`) || $('[data-p4="biasadd"]'); if (nx) nx.focus({ preventScroll: true }); }
function biasEdit(t) {
  const i = +t.dataset.i; const l = biasGet(); if (!l[i]) return;
  if (t.dataset.p4bias === 'text') { l[i][0] = t.value; biasWrite(l, '', '', { silent: true }); const n = $(`[data-p4bias="num"][data-i="${i}"]`); if (n) n.setAttribute('aria-label', t4('biasNumOf', t.value)); const dl = $(`[data-p4="biasdel"][data-i="${i}"]`); if (dl) { dl.setAttribute('aria-label', t4('biasDel', t.value)); dl.title = t4('biasDel', t.value); } return; }
  const s = String(t.value).trim(); const n = Number(s);
  if (s === '' || !/^-?\d+$/.test(s) || n < -101 || n > 100) { t.value = l[i][1]; A.announce(t4('biasRange')); return; }
  l[i][1] = n; t.value = n; biasWrite(l, '', '', { silent: true });
}
function apWrite(list, msg) { return gset('models.addParams', JSON.stringify(list), t4('apTitle'), msg ? { toast: msg } : {}); }
function apAdd() { const l = apGet(); l.push(['', '']); apWrite(l); repaintList('ap'); const e = $(`[data-p4ap="key"][data-i="${l.length - 1}"]`); if (e) e.focus({ preventScroll: true }); A.announce(t4('apAdded')); }
function apDel(i) { const l = apGet(); if (!l[i]) return; l.splice(i, 1); apWrite(l, t4('apDeleted')); repaintList('ap'); const nx = $(`[data-p4ap="key"][data-i="${Math.min(i, l.length - 1)}"]`) || $('[data-p4="apadd"]'); if (nx) nx.focus({ preventScroll: true }); }
function apEdit(t) {
  const i = +t.dataset.i; const l = apGet(); if (!l[i]) return; const what = t.dataset.p4ap; const cur = apParse(l[i][1]);
  if (what === 'key') l[i][0] = t.value;
  else if (what === 'type') { const nt = t.value; l[i][1] = apJoin(nt, nt === 'none' ? '' : cur.text); }
  else l[i][1] = apJoin(cur.type, t.value);
  apWrite(l); if (what === 'type') { repaintList('ap'); const e = $(`[data-p4ap="type"][data-i="${i}"]`); if (e) e.focus({ preventScroll: true }); return; }
  apNotes(i);
}
function apNotes(i) {   // the inline notes of one item, in place (a repaint on blur would steal the focus from where it is going)
  const li = $(`.p4-ai[data-i="${i}"]`); if (!li) return; const l = apGet(); const e = l[i]; $$('.p4-note', li).forEach((n) => n.remove());
  const pr = apParse(e[1]); const bad = pr.type === 'json' && !apJsonOk(pr.text); const core = CORE_API[e[0]] ? DESC[CORE_API[e[0]]] : null; const v = $('.p4-ap-val', li); if (v) { if (bad) v.setAttribute('aria-invalid', 'true'); else v.removeAttribute('aria-invalid'); }
  if (bad) li.insertAdjacentHTML('beforeend', `<p class="p4-note bad" role="status">${ic('circle-alert', 'sm')}<span>${esc(t4('apJsonBad'))}</span></p>`);
  if (core) li.insertAdjacentHTML('beforeend', `<p class="p4-note" role="status">${ic('info', 'sm')}<span>${esc(t4('apCoreOf', dLabel(core)))}</span></p>`);
}
function stopWrite(list, msg) { return gset('models.localStopStrings', JSON.stringify(list), t4('svcStop'), msg ? { toast: msg } : {}); }
function stopEdit(t) { const i = +t.dataset.p4stop; const l = stopGet(); if (l[i] === undefined) return; l[i] = t.value.replace(/\\n/g, '\n'); stopWrite(l); }
function stopAdd() { const l = stopGet(); l.push(''); stopWrite(l); repaintList('stop'); const e = $(`[data-p4stop="${l.length - 1}"]`); if (e) e.focus({ preventScroll: true }); }
function stopDel(i) { const l = stopGet(); if (l[i] === undefined) return; l.splice(i, 1); stopWrite(l, t4('svcStopDeleted')); repaintList('stop'); const nx = $(`[data-p4stop="${Math.min(i, l.length - 1)}"]`) || $('[data-p4="stopadd"]'); if (nx) nx.focus({ preventScroll: true }); }
function flagToggle(name, on) {
  let l = flagsEff() || []; l = l.slice(); const i = l.indexOf(name); if (on && i < 0) l.push(name); else if (!on && i >= 0) l.splice(i, 1);
  const order = FLAGS24.map((f) => f[0]); l.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  batch(() => setRow('models.customFlags', JSON.stringify(l)));
  const f = FLAGS24.find((x) => x[0] === name); A.announce(t4('flagToggled', KO() ? f[2] : f[4], on));
  const lab = $(`.p4-flag[data-flag="${name}"]`); if (lab) lab.classList.toggle('on', on);
  repaintParams();
}
function globalControl(t) {
  const g = t.dataset.p4g;
  if (g === 'applyAll') gset('models.applyAddParamsAll', !!t.checked, t4('applyAll'));
  else if (g === 'flagsOn') { batch(() => setRow('models.enableCustomFlags', !!t.checked)); repaintParams(); const c = $('#c-models\\.enableCustomFlags'); if (c) c.focus({ preventScroll: true }); }
  else if (g === 'tools') { batch(() => setRow('models.modelTools', !!t.checked)); const row = t.closest('.p4-row'); if (row) { row.classList.toggle('changed', !!t.checked); const dot = $('.dot', row); if (dot) dot.hidden = !t.checked; } }
  else if (g === 'mod') { batch(() => setRow('models.moduleIntegration', t.value)); const row = t.closest('.p4-row'); const r = rowOf('models.moduleIntegration'); if (row) { row.classList.toggle('changed', r.v !== r.d); const dot = $('.dot', row); if (dot) dot.hidden = r.v === r.d; } }
}
/* import preview (DS-079: a preview first, never a silent replace). Step 1 pastes the JSON, step 2 asks "{n}개 항목으로 바꿀까요?" */
const SAMPLE_BIAS = JSON.stringify([['세라핀', 8], ['등불', 12], ['안녕하세요', -30], ['ERROR', -100], ['금지어', -101]]);
function parseBiasJson(txt) {
  let v; try { v = JSON.parse(txt); } catch (e) { return null; }
  if (v && !Array.isArray(v) && typeof v === 'object') v = Object.keys(v).map((k) => [k, v[k]]);
  if (!Array.isArray(v)) return null; const out = [];
  for (const e of v) { if (!Array.isArray(e) || typeof e[0] !== 'string' || typeof e[1] !== 'number' || !isFinite(e[1]) || e[1] < -101 || e[1] > 100) return null; out.push([e[0], Math.round(e[1])]); }
  return out;
}
function openBiasImport(o) {
  o = o || {}; if (o.list) return openBiasPreview(o.list);
  const body = `<label class="dlg-l" for="p4ImpTx">${esc(t4('impPaste'))}</label><textarea id="p4ImpTx" class="inp ta" data-part="settings-field" rows="6" spellcheck="false" autocomplete="off" aria-describedby="p4ImpErr">${esc(o.text || '')}</textarea><p class="dlg-hint p4-imperr" id="p4ImpErr" role="alert" hidden>${esc(t4('impInvalid'))}</p><button type="button" class="btn solid p4-sample" id="p4ImpSample" data-part="settings-button">${ic('file-down', 'lg')}<span>${esc(t4('impSample'))}</span></button>`;
  const d = A.openDialog({ title: t4('impTitle'), body, buttons: [{ id: 'cancel', label: A.t('cancel') }, { id: 'preview', label: t4('impPreview'), primary: true }], initial: '#p4ImpTx' });
  const tx = $('#p4ImpTx', d.back), er = $('#p4ImpErr', d.back);
  $('#p4ImpSample', d.back).onclick = () => { tx.value = SAMPLE_BIAS; er.hidden = true; tx.removeAttribute('aria-invalid'); tx.focus(); };
  A.openDialog.handlers = { preview: () => { const l = parseBiasJson(tx.value); if (!l) { er.hidden = false; tx.setAttribute('aria-invalid', 'true'); tx.focus(); return false; } setTimeout(() => openBiasPreview(l), 0); } };
  return d;
}
function openBiasPreview(list) {
  const cur = biasGet().length; const shown = list.slice(0, 5).map((e) => `<li><span class="p4-pt">${esc(e[0])}</span><span class="p4-pn">${e[1]}</span></li>`).join('') + (list.length > 5 ? `<li class="p4-pm">${esc(t4('impMore', list.length - 5))}</li>` : '');
  const d = A.openDialog({ critical: true, title: t4('impReplaceQ', list.length), body: `<p>${esc(t4('impBody', cur, list.length))}</p><ul class="p4-impl" role="list">${shown}</ul>`, buttons: [{ id: 'cancel', label: A.t('cancel') }, { id: 'replace', label: t4('impReplace'), danger: true }], initial: '[data-dlg="cancel"]' });
  A.openDialog.handlers = { replace: () => { setTimeout(() => { biasWrite(list, t4('impDone', list.length), t4('impDone', list.length)); repaintList('bias'); const b = $('[data-p4="biasimport"]'); if (b) b.focus({ preventScroll: true }); }, 0); } };
  return d;
}

/* ------------------------------------------------------------------ per-task parameters (DS-082, DS-089) */
function taskLineHTML(task) {
  const t = taskGet(task); const name = taskName(task); const own = t.mode === 'own'; const rid = 'models.task.' + task; const txt = own ? t4('taskOwn', countChanged(task, t)) : t4('taskSame');
  return `<div class="row p4-taskline" data-row="${rid}" data-part="settings-task-mode" data-task="${task}" data-mode="${t.mode}" role="group" aria-labelledby="p4tl-${task}"><div class="p4-tl"><div class="r-title p4-tl-title"><span class="p4-tl-text" id="p4tl-${task}">${esc(txt)}</span></div>` +
    `<div class="p4-tl-ctl"><div class="seg p4-tseg" data-part="settings-segmented" role="radiogroup" aria-label="${esc(t4('taskModeOf', name))}">${['same', 'own'].map((m) => `<button type="button" class="seg-b" role="radio" aria-checked="${t.mode === m}" tabindex="${t.mode === m ? 0 : -1}" data-p4="taskmode" data-task="${task}" data-mode="${m}" data-ctl>${esc(t4(m === 'same' ? 'taskModeSame' : 'taskModeOwn'))}</button>`).join('')}</div>` +
    `${own ? `<button type="button" data-part="settings-button" class="btn solid p4-tedit" data-p4="taskedit" data-task="${task}" aria-label="${esc(t4('taskEditOf', name))}" title="${esc(t4('taskEditOf', name))}">${ic('pencil', 'lg')}<span class="sr-only">${esc(t4('taskEdit'))}</span></button>` : ''}</div></div></div>`;
}
function checkLineHTML() {
  const m = mainModel(); const over = PARAMS.some((p) => p.limit && overOf(DESC[p.key], rowOf(p.id).v, m));
  return over ? `<div class="row p4-checkline" data-part="settings-row" data-p4line="check"><button type="button" class="p4-checkmark" data-part="settings-param-models-mark" data-part-critical data-p4="gocheck" aria-label="${esc(t4('checkMarkAria'))}">${ic('circle-alert', 'mark')}<span>${esc(t4('checkMark'))}</span></button></div>` : '';
}
function paintTaskLines() {
  const sec = $('#sec-models\\.models'); if (!sec) return;
  TASKS.forEach((ti) => {
    const row = $(`[data-row="${ti[1]}"].c3-mrow`, sec); if (!row) return; const html = taskLineHTML(ti[0]); const old = $(`.p4-taskline[data-task="${ti[0]}"]`, sec);
    const sigs = P4.sig || (P4.sig = {});
    if (old && sigs[ti[0]] === html) return;   // nothing it shows has changed
    const tmp = document.createElement('div'); tmp.innerHTML = html; const nu = tmp.firstElementChild; sigs[ti[0]] = html;
    if (old) { const fk = old.contains(document.activeElement) ? focusKeyOf(document.activeElement) : null; old.replaceWith(nu); if (fk) { const e = $(fk.sel, nu) || $('[data-ctl]', nu); if (e) e.focus({ preventScroll: true }); } }
    else row.after(nu);
  });
  const main = $('[data-row="models.mainModel"].c3-mrow', sec); const oc = $('.p4-checkline', sec); const ch = checkLineHTML();
  if (!ch) { if (oc) oc.remove(); } else if (!oc && main) main.insertAdjacentHTML('afterend', ch);
  syncLockChips();
}
function syncLockChips() {   // slice 2 decorates the rows of an active lock on every save (its chip is read-aloud only inside slice 3's groups); the task lines also show a visible badge of their own (6.3)
  const on = !!rowOf('models.keepParamsOnSwitch').v;
  $$('.p4-taskline').forEach((l) => {
    l.classList.toggle('ps-shared', on); const t = $('.r-title', l); const c = $('.ps-shared-chip', l); const v = $('.p4-lockchip', l);
    if (on && t && !c) { const s = document.createElement('span'); s.className = 'chip ps-shared-chip'; s.title = B.t2('sharedTip'); s.innerHTML = ic('lock', 'sm') + '<span>' + esc(B.t2('sharedChip')) + '</span>'; t.appendChild(s); } else if (!on && c) c.remove();
    if (on && t && !v) { const s = document.createElement('span'); s.className = 'chip p4-lockchip'; s.setAttribute('data-part', 'settings-param-badge'); s.setAttribute('data-part-critical', ''); s.setAttribute('aria-hidden', 'true'); s.title = t4('sharedTip'); s.innerHTML = ic('lock', 'sm') + '<span>' + esc(t4('shared')) + '</span>'; t.appendChild(s); } else if (!on && v) v.remove();
  });
}
function setTaskMode(task, mode, o) {
  o = o || {}; const t = taskGet(task); if (t.mode === mode) { if (mode === 'own' && !o.noOpen) openTask(task); return false; }
  const name = taskName(task); let copied = false;
  const step = batch(() => { if (mode === 'own') { if (!taskKept(t)) { const c = copyMain(); t.values = c.values; t.off = c.off; copied = true; } t.mode = 'own'; } else t.mode = 'same'; taskPut(task, t); });
  paintTaskLines();
  if (mode === 'own') { const msg = copied ? t4('taskCopied', name) : t4('taskAnnOwn', name); toastUndo(msg, step, { kind: 'param-task' }); A.announce(t4('taskAnnOwn', name)); if (!o.noOpen) openTask(task); }
  else { toastUndo(t4('taskToastSame'), step, { kind: 'param-task' }); if (P4.view === 'task') closeTask(); }
  return true;
}
function openTask(task) {
  if (!A.S.open) A.openSettings($('#oSettings'), { page: 'models', noFocus: true });
  P4.view = 'task'; P4.task = task; A.showPage('models', { p4: true, noAnim: true, keepNotice: true, noRestore: true });
  const h = $('#pgTitle'); if (h) h.focus({ preventScroll: true });
}
function closeTask(o) {
  o = o || {}; const task = P4.task; P4.view = 'section';
  if (o.toTop) { A.showPage('models', { noAnim: true, focusHead: true, noRestore: true }); return; }
  A.showPage('models', { section: 'models.models', row: A.ROW[taskRowId(task)], noAnim: true, noRestore: true, fromJump: true });
  setTimeout(() => { const e = $(`.p4-taskline[data-task="${task}"] [data-p4="taskedit"]`) || $(`.p4-taskline[data-task="${task}"] [data-ctl]`); if (e) e.focus({ preventScroll: true }); }, 0);
}
function taskPageHTML() {
  const task = P4.task || TASKS[0][0]; const name = taskName(task); const model = taskModel(task); const t = taskGet(task); const lock = !!rowOf('models.keepParamsOnSwitch').v; const inactive = t.mode !== 'own';
  const crumb = `<nav class="ps-crumb" aria-label="${esc(t4('crumbNav'))}"><ol><li><button type="button" data-p4="crumb-models">${esc(t4('taskCrumbModels'))}</button></li><li><button type="button" data-p4="crumb-model">${esc(t4('taskCrumbModel'))}</button></li><li aria-current="page">${esc(t4('taskPageTitle', name))}</li></ol></nav>`;
  const groups = ['random', 'repeat', 'think'].map((gid) => groupHTML(GROUPS.find((g) => g.id === gid), task, model, {})).join('');
  return `<div class="pg p4-taskpg" data-part="settings-param-page" data-page="models" data-view="task" data-task="${task}"><div class="pg-head" data-part="settings-page-header">${crumb}<h1 class="pg-title" id="pgTitle" tabindex="-1">${esc(t4('taskPageTitle', name))}</h1></div>` +
    `<section class="sec" data-part="settings-section" aria-label="${esc(t4('taskPageTitle', name))}"><p class="p4-tmodel r-desc" data-part="settings-row-description">${ic('cpu', 'md')}<span>${esc(t4('taskModelLine', mname(model)))}</span></p>${lock ? `<p class="p4-tlock">${lockBadge()}<span class="r-desc" data-part="settings-row-description">${esc(t4('taskLockHint'))}</span></p>` : ''}${inactive ? `<p class="p4-reason flag" data-part="settings-param-reason" data-part-critical>${ic('info', 'sm')}<span class="p4-rt">${esc(t4('sameInactive'))}</span></p><div class="p4-tfoot"><button type="button" data-part="settings-button" class="btn solid" data-p4="taskuseown" data-task="${task}">${ic('pencil', 'lg')}<span>${esc(t4('taskUseOwn'))}</span></button></div>` : ''}` +
    `<div class="rows p4-trows${inactive ? ' inactive' : ''}" data-part="settings-rows" id="p4TaskRoot"${inactive ? ' inert aria-disabled="true"' : ''}>${groups}</div>` +
    `${inactive ? '' : `<div class="p4-tfoot"><button type="button" data-part="settings-button" class="btn solid" data-p4="taskmatch" data-task="${task}">${ic('copy', 'lg')}<span>${esc(t4('taskMatch'))}</span></button><button type="button" data-part="settings-button" class="btn solid" data-p4="taskuse" data-task="${task}">${ic('undo-2', 'lg')}<span>${esc(t4('taskUseSame'))}</span></button></div>`}</section></div>`;
}
function lockInactive() {   // R4-8: while the task is 같음 its kept values are shown, not editable (`inert` where the WebView knows it; disabled controls and no tab stops everywhere)
  $$('.p4-trows.inactive').forEach((r) => { $$('input, button, select, textarea, a[href], [tabindex]', r).forEach((e) => { e.tabIndex = -1; if ('disabled' in e) e.disabled = true; if (e.matches('input[type=text]')) e.readOnly = true; }); });
}
function taskMatch(task) {
  const step = batch(() => { const c = copyMain(); const t = taskGet(task); t.values = c.values; t.off = c.off; taskPut(task, t); });
  A.refreshPage(); toastUndo(t4('taskMatched', taskName(task)), step, { kind: 'param-task' });
}

/* ------------------------------------------------------------------ events. Controls inside .p4-row are handled here (capture phase, then the event stops) so slice 1's generic row handlers never write a value behind the store. Keys that shortcuts use (Ctrl+Z, Alt+Z, Esc ...) are left alone. */
const inRow = (t) => t instanceof Element && !!t.closest('.p4-row');
function rowActive(key, srcId) {
  const d = DESC[key]; const src = srcOf(srcId); if (d.svc) return !d.sendable || src.sent(d);
  const m = srcId === 'main' ? mainModel() : taskModel(srcId); if (!supportOf(d, m, srcId === 'main').ok) return false; return !d.sendable || src.sent(d);
}
function errOn(row, d, key, t) {
  if (!row) return; let e = $('.p4-err', row); if (t.value.trim() === '') { if (e) e.remove(); return; }
  const msg = d.random ? t4('invalidNum') : t4('invalid', fmtVal(d, d.min), fmtVal(d, d.max));
  if (!e) { e = document.createElement('p'); e.className = 'p4-err'; e.id = 'p4e-' + key; e.setAttribute('role', 'alert'); const anchor = $('.p4-slidebox', row) || $('.p4-hint', row) || $('.p4-sentence', row); if (anchor) anchor.after(e); else $('.p4-main', row).appendChild(e); }
  e.textContent = msg; const ids = (t.getAttribute('aria-describedby') || '').split(' ').filter(Boolean); if (ids.indexOf(e.id) < 0) { ids.push(e.id); t.setAttribute('aria-describedby', ids.join(' ')); }
}
function errOff(row, key) { const e = row && $('.p4-err', row); if (e) e.remove(); const f = row && $('[data-p4f]', row); if (f) f.setAttribute('aria-describedby', (f.getAttribute('aria-describedby') || '').split(' ').filter((x) => x && x !== 'p4e-' + key).join(' ')); }
/* Low power (floor devices): a slider drag writes the store at most once per LP_MS instead of on every input event (each write runs slice 2's save and repaint hooks, the costly part: checks/ss4/modes.mjs measures it).
   Until then the typed-in value is the slider's own value and the field text (a draft of the gesture); anything that reads or replaces the store first calls flushSlider(). Normal mode writes on every event. */
const LP_MS = 150; let slTimer = 0, slPend = null;
function flushSlider() {
  clearTimeout(slTimer); slTimer = 0; const p = slPend; slPend = null; if (!p || A.S.presetActive !== p.preset) return;
  P4.writes++; srcOf(p.srcId).set(DESC[p.key], p.v, true); liveRow(p.key, p.srcId, { keepRange: true });
}
function previewField(key, srcId, v) {   // the field and the aria text follow the thumb while the store write waits
  const row = rowEl(key, srcId); if (!row) return; const d = DESC[key]; const f = $('[data-p4f]', row); const txt = fmtVal(d, v);
  if (f) { f.value = txt; f.setAttribute('aria-valuenow', v); f.setAttribute('aria-valuetext', t4('valueAria', dLabel(d), txt)); } const r = $('[data-p4r]', row); if (r) r.setAttribute('aria-valuetext', t4('valueAria', dLabel(d), txt));
}
let lastBlock = { k: '', t: 0 };
function blocked(key, srcId) {   // DS-096: an edit of a not-sent (or unsupported) parameter changes nothing and says why; 보내기 is never switched on by itself
  const d = DESC[key]; const src = srcOf(srcId); const m = srcId === 'main' ? mainModel() : taskModel(srcId);
  const un = !d.svc && !supportOf(d, m, srcId === 'main').ok; const ns = !un && d.sendable && !src.sent(d); if (!un && !ns) return false;
  const msg = un ? t4('blockedUns', dLabel(d), mname(m)) : t4('blockedNot', dLabel(d)); const now = Date.now(); const k = srcId + '|' + key;
  const tt = $('#psToast'); const shown = !!tt && tt.classList.contains('on');
  if (lastBlock.k !== k || now - lastBlock.t > 1500 || !shown) B.psToast(msg, { kind: 'param-blocked', action: null });   // the toast shows it and announces it
  lastBlock = { k, t: now }; P4.blocks = (P4.blocks || 0) + 1; return true;
}
function blockedBias() {   // R4-16: the same explanation as any dimmed row (DS-096)
  const msg = t4('blockedUns', KO() ? rowOf('models.bias').ko : rowOf('models.bias').en, mname(mainModel())); const now = Date.now(); const tt = $('#psToast'); const shown = !!tt && tt.classList.contains('on');
  if (lastBlock.k !== 'bias' || now - lastBlock.t > 1500 || !shown) B.psToast(msg, { kind: 'param-blocked', action: null });
  lastBlock = { k: 'bias', t: now }; P4.blocks = (P4.blocks || 0) + 1;
}
function sliderMove(t) {
  const key = t.dataset.p4r, srcId = t.dataset.src, d = DESC[key], src = srcOf(srcId);
  if (!rowActive(key, srcId)) { t.value = src.get(d); blocked(key, srcId); return; }
  const v = roundTo(Number(t.value), d.dec);
  if (A.S.lp) { slPend = { key, srcId, v, preset: A.S.presetActive }; previewField(key, srcId, v); if (!slTimer) slTimer = setTimeout(flushSlider, LP_MS); return; }
  P4.writes++; src.set(d, v, true); liveRow(key, srcId, { keepRange: true });
}
function fieldInput(t) {
  const key = t.dataset.p4f, srcId = t.dataset.src, d = DESC[key], src = srcOf(srcId); if (d.global || t.readOnly) return;
  const n = parseNum(d, t.value); const k = srcId + '|' + key; const row = t.closest('.p4-row');
  if (n !== null && inRange(d, n)) { delete P4.drafts[k]; t.removeAttribute('aria-invalid'); errOff(row, key); src.set(d, n, true); liveRow(key, srcId, { keepField: true }); }
  else { P4.drafts[k] = t.value; t.setAttribute('aria-invalid', 'true'); errOn(row, d, key, t); }
}
function fieldCommit(t, fromEnter) {
  const key = t.dataset.p4f, srcId = t.dataset.src, d = DESC[key], src = srcOf(srcId); const k = srcId + '|' + key; const row = t.closest('.p4-row');
  const n = parseNum(d, t.value);
  if (n !== null && inRange(d, n)) { delete P4.drafts[k]; errOff(row, key); if (d.global || !same(src.get(d), n)) src.set(d, n); liveRow(key, srcId); return true; }
  if (fromEnter) { P4.drafts[k] = t.value; t.setAttribute('aria-invalid', 'true'); errOn(row, d, key, t); return false; }
  fieldRestore(t, true); return false;
}
function fieldRestore(t, say) {   // say: a blur or Tab with an out-of-range or unreadable entry says what happened (R4-13); Esc restores silently
  const key = t.dataset.p4f, srcId = t.dataset.src, d = DESC[key], src = srcOf(srcId); delete P4.drafts[srcId + '|' + key]; t.removeAttribute('aria-invalid'); errOff(t.closest('.p4-row'), key); const typed = t.value; t.value = fmtVal(d, src.get(d));
  if (say && String(typed).trim() !== '' && typed !== t.value) A.announce(t4('rangeKept', dLabel(d), t.value));
}
const stepOf = (d) => (d.kind === 'number' ? 1 : d.step);
function stepBy(d, v, dir, big) { return Math.min(d.max, Math.max(d.min, roundTo(v + dir * stepOf(d) * (big ? 10 : 1), d.dec))); }
function keyValue(t, k) {   // ArrowUp/Down, PageUp/PageDown, Home/End on a slider or a number field; returns true when handled
  const key = t.dataset.p4r || t.dataset.p4f, srcId = t.dataset.src, d = DESC[key], src = srcOf(srcId);
  let dir = 0, big = false, to = null;
  if (k === 'ArrowUp' || (k === 'ArrowRight' && t.matches('[data-p4r]'))) dir = 1; else if (k === 'ArrowDown' || (k === 'ArrowLeft' && t.matches('[data-p4r]'))) dir = -1; else if (k === 'PageUp') { dir = 1; big = true; } else if (k === 'PageDown') { dir = -1; big = true; } else if (k === 'Home') to = d.min; else if (k === 'End') to = d.max; else return false;
  if (!rowActive(key, srcId)) { blocked(key, srcId); return true; }
  let cur = src.get(d); const typed = t.matches('[data-p4f]') ? parseNum(d, t.value) : null; if (typed !== null && inRange(d, typed)) cur = typed;
  const nv = to !== null ? to : stepBy(d, cur, dir, big); if (d.global) { t.value = fmtVal(d, nv); return true; }
  delete P4.drafts[srcId + '|' + key]; t.removeAttribute('aria-invalid'); errOff(t.closest('.p4-row'), key);
  src.set(d, nv, true); liveRow(key, srcId); return true;
}
function onInput(ev) {
  const t = ev.target; if (!inRow(t)) return; ev.stopPropagation();
  if (t.matches('[data-p4r]')) sliderMove(t); else if (t.matches('[data-p4f]')) fieldInput(t);
}
function onChange(ev) {
  const t = ev.target; if (!inRow(t)) return; ev.stopPropagation(); if (P4.painting) return; flushSlider();   // removing the focused field (a repaint) makes the browser fire change and blur on it: they must not commit or restore anything
  if (t.matches('[data-p4s]')) toggleSend(t.dataset.p4s, t.dataset.src, t.checked);
  else if (t.matches('[data-p4v]')) { const key = t.dataset.p4v; const d = DESC[key]; if (srcOf(t.dataset.src).set(d, !!t.checked)) liveRow(key, t.dataset.src); }
  else if (t.matches('[data-p4t]')) { const key = t.dataset.p4t; const d = DESC[key]; if (srcOf(t.dataset.src).set(d, t.value)) liveRow(key, t.dataset.src); }
  else if (t.matches('[data-p4f]')) fieldCommit(t, false);
  else if (t.matches('[data-p4g]')) globalControl(t);
  else if (t.matches('[data-p4flag]')) flagToggle(t.dataset.p4flag, t.checked);
  else if (t.matches('[data-p4bias]')) biasEdit(t);
  else if (t.matches('[data-p4ap]')) apEdit(t);
  else if (t.matches('[data-p4stop]')) stopEdit(t);
}
function onFocusOut(ev) { if (P4.painting) return; const t = ev.target; if (t instanceof Element && t.isConnected && t.matches('[data-p4f]') && P4.drafts[t.dataset.src + '|' + t.dataset.p4f] !== undefined) fieldRestore(t, true); }
function onKeyP4(ev) {
  const t = ev.target; if (!(t instanceof Element)) return; const k = ev.key;
  if (ev.ctrlKey || ev.altKey || ev.metaKey) return;
  if ((k === 'F10' && ev.shiftKey) || k === 'ContextMenu') {
    const row = t.closest('.p4-row[data-p4row]');
    if (row && !t.matches('input[type=text],textarea,select')) { ev.preventDefault(); ev.stopPropagation(); const r = t.getBoundingClientRect(); rowMenu(row.dataset.p4row, row.dataset.src, null, { x: r.left, y: r.bottom }, t); }
    return;
  }
  if (t.matches('[data-p4r]')) { if (keyValue(t, k)) { ev.preventDefault(); ev.stopPropagation(); } return; }
  if (t.matches('[data-p4bias][readonly]') && (k.length === 1 || k === 'Backspace' || k === 'Delete')) { ev.preventDefault(); ev.stopPropagation(); blockedBias(); return; }
  if (t.matches('[data-p4f]')) {
    if (t.readOnly && (k.length === 1 || k === 'Backspace' || k === 'Delete')) { ev.preventDefault(); ev.stopPropagation(); blocked(t.dataset.p4f, t.dataset.src); return; }   // typing into a not-sent or dimmed field
    if (k === 'Escape') { const key = t.dataset.p4f; const d = DESC[key]; const committed = fmtVal(d, srcOf(t.dataset.src).get(d)); if (P4.drafts[t.dataset.src + '|' + key] !== undefined || t.value !== committed) { ev.preventDefault(); ev.stopPropagation(); fieldRestore(t); } return; }   // Esc restores the last committed value; it does not close Settings while a draft is open
    if (k === 'Enter') { ev.preventDefault(); ev.stopPropagation(); const ok = fieldCommit(t, true); if (ok) A.announce(t4('valueAria', dLabel(DESC[t.dataset.p4f]), t.value)); return; }
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].indexOf(k) >= 0 && !ev.shiftKey) { if (keyValue(t, k)) { ev.preventDefault(); ev.stopPropagation(); } }
    return;
  }
  if (t.matches('[data-p4="taskmode"]')) {   // the 같음 / 따로 radiogroup: the arrows move the focus; Space or Enter chooses (choosing 따로 opens the editor, so the arrows do not choose by themselves)
    const grp = t.closest('[role=radiogroup]'); const bs = $$('[data-p4="taskmode"]', grp); const i = bs.indexOf(t); let go = -1;
    if (k === 'ArrowRight' || k === 'ArrowDown') go = (i + 1) % bs.length; else if (k === 'ArrowLeft' || k === 'ArrowUp') go = (i - 1 + bs.length) % bs.length; else if (k === 'Home') go = 0; else if (k === 'End') go = bs.length - 1;
    if (go >= 0) { ev.preventDefault(); ev.stopPropagation(); bs.forEach((b, j) => { b.tabIndex = j === go ? 0 : -1; }); bs[go].focus(); }
    return;
  }
  if (t.matches('[data-p4seg]')) {
    const grp = t.closest('[data-p4segs]'); const bs = $$('[data-p4seg]', grp); let i = bs.indexOf(t); let go = -1;
    if (k === 'ArrowRight' || k === 'ArrowDown') go = (i + 1) % bs.length; else if (k === 'ArrowLeft' || k === 'ArrowUp') go = (i - 1 + bs.length) % bs.length; else if (k === 'Home') go = 0; else if (k === 'End') go = bs.length - 1;
    if (go >= 0) { ev.preventDefault(); ev.stopPropagation(); selectSeg(t.dataset.key, t.dataset.src, bs[go].dataset.p4seg); const nb = $$('[data-p4seg]', grp)[go]; if (nb) nb.focus(); }
  }
}
function onCtxP4(ev) {
  const t = ev.target; const row = t instanceof Element && t.closest('.p4-row[data-p4row]'); if (!row || t.closest('input,textarea,select')) return;
  ev.preventDefault(); ev.stopPropagation(); rowMenu(row.dataset.p4row, row.dataset.src, null, { x: ev.clientX, y: ev.clientY }, $('[data-ctl]', row));
}
function toggleHelpP4(a) {
  const id = a.dataset.src + '|' + a.dataset.key; const open = !P4.help.has(id); if (open) P4.help.add(id); else P4.help.delete(id);
  const h = $('#' + a.getAttribute('aria-controls')); if (h) h.hidden = !open; a.setAttribute('aria-expanded', open ? 'true' : 'false');
  a.innerHTML = ic(open ? 'chevron-down' : 'chevron-right', 'sm') + '<span>' + esc(t4(open ? 'less' : 'more')) + '</span>';
}
function onClickP4(ev) {
  const t = ev.target; if (!(t instanceof Element)) return;
  const seg = t.closest('[data-p4seg]'); if (seg && seg.closest('.p4-row')) { if (seg.getAttribute('aria-disabled') !== 'true') selectSeg(seg.dataset.key, seg.dataset.src, seg.dataset.p4seg); else blocked(seg.dataset.key, seg.dataset.src); return; }
  const a = t.closest('[data-p4]'); if (a && a.getAttribute('aria-disabled') === 'true' && /^bias(add|del|import)$/.test(a.dataset.p4)) { blockedBias(); return; } if (!a || a.getAttribute('aria-disabled') === 'true') return; const act = a.dataset.p4; const srcId = a.dataset.src || (P4.view === 'task' ? P4.task : 'main');
  switch (act) {
    case 'help': toggleHelpP4(a); break;
    case 'menu': rowMenu(a.dataset.key, srcId, a, null, a); break;
    case 'gmenu': groupMenu(a.dataset.group, P4.view === 'task' ? P4.task : 'main', a, a); break;
    case 'fit': fitKey(a.dataset.key); break;
    case 'pickmodel': C3.openPicker({ rowId: 'models.mainModel', opener: a }); break;
    case 'adv': P4.adv = !P4.adv; repaintParams(); { const b = $('[data-p4="adv"]'); if (b) b.focus({ preventScroll: true }); } break;
    case 'preview': P4.preview = !P4.preview; repaintParams(); { const b = $('[data-p4="preview"]'); if (b) b.focus({ preventScroll: true }); } break;
    case 'biasadd': biasAdd(); break;
    case 'biasdel': biasDel(+a.dataset.i); break;
    case 'biasimport': openBiasImport({}); break;
    case 'biasexport': B.psToast(t4('biasExported'), { kind: 'param' }); break;
    case 'apadd': apAdd(); break;
    case 'apdel': apDel(+a.dataset.i); break;
    case 'stopadd': stopAdd(); break;
    case 'stopdel': stopDel(+a.dataset.i); break;
    case 'taskmode': setTaskMode(a.dataset.task, a.dataset.mode); break;
    case 'taskedit': openTask(a.dataset.task); break;
    case 'gocheck': { const id = PARAMS.filter((p) => p.limit && overOf(DESC[p.key], rowOf(p.id).v, mainModel())).map((p) => p.id)[0]; if (id) A.openRow(A.ROW[id], { noAnim: true }); break; }
    case 'crumb-models': closeTask({ toTop: true }); break;
    case 'crumb-model': closeTask(); break;
    case 'taskmatch': taskMatch(a.dataset.task); break;
    case 'taskuse': setTaskMode(a.dataset.task, 'same'); break;
    case 'taskuseown': setTaskMode(a.dataset.task, 'own', { noOpen: true }); A.refreshPage(); { const h = $('#pgTitle'); if (h) h.focus({ preventScroll: true }); } break;
    default: break;
  }
}
let lpT = null;
function bindPage4() {
  const sc = $('#pageScroll');
  document.addEventListener('keydown', (ev) => { if (slPend && (ev.ctrlKey || ev.metaKey || ev.altKey)) flushSlider(); }, true);   // an undo reads what the drag wrote
  sc.addEventListener('input', onInput, true); sc.addEventListener('change', onChange, true); sc.addEventListener('keydown', onKeyP4, true); sc.addEventListener('contextmenu', onCtxP4, true); sc.addEventListener('focusout', onFocusOut, true); sc.addEventListener('click', onClickP4);
  sc.addEventListener('pointerdown', (ev) => {   // long press (touch) on the label or the sentence opens the row menu, as in slice 1
    const t = ev.target; if (ev.pointerType !== 'touch' || !(t instanceof Element) || !t.closest('.p4-lw, .p4-sentence')) return; const row = t.closest('.p4-row[data-p4row]'); if (!row) return;
    lpT = { x: ev.clientX, y: ev.clientY, id: setTimeout(() => { lpT = null; rowMenu(row.dataset.p4row, row.dataset.src, null, { x: ev.clientX, y: ev.clientY }, $('[data-ctl]', row)); }, 500) };
  });
  const cancel = () => { if (lpT) { clearTimeout(lpT.id); lpT = null; } };
  sc.addEventListener('pointerdown', (ev) => {   // a drag or a tap on the slider, field, segmented control or switch of a not-sent or dimmed row (DS-096)
    const t = ev.target; if (!(t instanceof Element)) return; if (t.closest('[data-p4bias][readonly]')) { blockedBias(); return; } const hit = t.closest('.p4-slidebox, .p4-seg, .p4-valsw, .p4-field[readonly]'); const row = hit && hit.closest('.p4-row[data-p4row]'); if (!row) return;
    if (!rowActive(row.dataset.p4row, row.dataset.src)) blocked(row.dataset.p4row, row.dataset.src);
  }, true);
  sc.addEventListener('pointerup', cancel); sc.addEventListener('pointercancel', cancel); sc.addEventListener('pointermove', (ev) => { if (lpT && Math.hypot(ev.clientX - lpT.x, ev.clientY - lpT.y) > 10) cancel(); });
}

/* ------------------------------------------------------------------ hooks called by slice1.js (wrapping slice 2's and slice 3's) */
const H = {};
['boot', 'sectionBody', 'pageHTML', 'rendered', 'nav', 'back', 'closing', 'backLabel', 'headerTitle', 'indexExtra', 'lang', 'title', 'demoPanel', 'afterInit', 'ready'].forEach((k) => { H[k] = X[k]; });
const MODEL_ROWS = ['models.mainModel', 'models.subModel', 'models.memModel', 'models.transModel', 'models.emoModel', 'models.otherModel'];
X.sectionBody = (s, body, o) => (s.id === 'models.params' ? paramsBody(o) : (H.sectionBody ? H.sectionBody(s, body, o) : undefined));
X.pageHTML = (pid, o) => { if (pid === 'models' && P4.view === 'task') return taskPageHTML(); return H.pageHTML ? H.pageHTML(pid, o) : null; };
X.rendered = (pg) => { if (H.rendered) H.rendered(pg); paintTaskLines(); lockInactive(); };
X.nav = (pid, o) => {
  if (H.nav) H.nav(pid, o);
  if (!o.p4 && P4.view !== 'section') P4.view = 'section';
  if (pid === 'models' && o.row && ADV_ROWS.indexOf(o.row.id) >= 0) P4.adv = true;   // a search result inside the closed 고급 opens it
};
X.back = () => {
  if (!(C3 && C3.S3.mp) && A.S.open && P4.view === 'task' && !A.S.resume) { closeTask(); return true; }   // 1 dialog or menu and 2 the bias preview are closed by slice 1 before this; 3 the task sub-page; then slice 3's order
  return H.back ? H.back() : false;
};
X.backLabel = () => (A.S.open && P4.view === 'task' ? { label: t4('backToModels'), vis: t4('backToModelsShort') } : (H.backLabel ? H.backLabel() : null));
X.headerTitle = () => (A.S.open && P4.view === 'task' ? t4('taskPageTitle', taskName(P4.task)) : (H.headerTitle ? H.headerTitle() : null));
X.closing = () => { flushSlider(); const r = H.closing ? H.closing() : true; if (r === false) return false; P4.view = 'section'; P4.drafts = {}; return true; };
X.indexExtra = (mk, IDX) => {
  if (H.indexExtra) H.indexExtra(mk, IDX);
  for (let i = IDX.length - 1; i >= 0; i--) { const e = IDX[i]; if (e.row && e.row.noIndex) IDX.splice(i, 1); }   // the 보내기 flags and the per-task blocks are state, not settings to search for
};
X.lang = (l) => { if (H.lang) H.lang(l); document.title = K[l].title; };
X.title = (l) => K[l].title;
X.demoPanel = (p) => {
  if (H.demoPanel) H.demoPanel(p);
  const h = document.createElement('div'); h.className = 'ps-demo p4-demo';
  h.innerHTML = `<h3 class="d-h">${esc(t4('demoS4'))}</h3><label class="d-row"><span>${esc(t4('demoSet'))}</span><select id="d4Set">${[['demo', 'setDemo'], ['service', 'setService'], ['over', 'setOver'], ['empty', 'setEmpty']].map(([v, k]) => `<option value="${v}"${SET4 === v ? ' selected' : ''}>${esc(t4(k))}</option>`).join('')}</select></label>` +
    `<label class="d-row"><span>${esc(t4('demoState'))}</span><select id="d4State">${STATES4.map((s) => `<option>${s}</option>`).join('')}</select></label><div class="d-btns"><button type="button" data-part="settings-button" class="btn solid" id="d4Go"><span>${esc(t4('demoGo'))}</span></button></div>`;
  p.appendChild(h);
  $('#d4Set', h).onchange = (e) => { const u = new URL(location.href); u.searchParams.set('set', e.target.value); location.href = u.toString(); };
  $('#d4Go', h).onclick = () => { runState4($('#d4State', h).value); };
};
X.afterInit = (o) => {
  if (H.afterInit) H.afterInit(o);
  if (Q.get('view') === 'taskparams' && TASKS.some((t) => t[0] === Q.get('task'))) { openTask(Q.get('task')); return; }   // ?page=models&section=models.models&view=taskparams&task=<memory|emotion|translate|otherAx> (SLICE4_SPEC 1)
  if (!o.page && !o.section && !o.row && !o.q && !Q.get('view') && !Q.get('fix') && !Q.get('retry') && !Q.get('state') && A.S.open && A.S.page === 'models' && A.S.view === 'page') A.showPage('models', { section: 'models.params', noAnim: true, keepFocus: true });
};
X.ready = () => { if (H.ready) H.ready(); window.__ss4Ready = true; };

function installNeeds() {   // slice 1's own search test (unavail) asks row.needs: keep it in step with the support test of this page (custom flags reveal rows, the service group follows the connection)
  const def = (r, fn) => { Object.defineProperty(r, 'needs', { configurable: true, enumerable: true, get: fn }); };
  PARAMS.forEach((p) => { if (p.needs) def(rowOf(p.id), () => (supportOf(DESC[p.key], mainModel(), true).ok ? undefined : p.needs)); });
  Object.keys(SVC).forEach((sk) => SVC[sk].rows.forEach((s) => def(rowOf(s.id), () => (svcOf(mainModel()) === sk ? undefined : 'svc:' + sk))));
  def(rowOf('models.localStopStrings'), () => (svcOf(mainModel()) === 'ooba' ? undefined : 'svc:ooba'));
  def(rowOf('models.modelTools'), () => (toolsOk(mainModel()) ? undefined : 'tools'));
}
class SumOpts extends Array {   // a search result prints the value of a select row: a count or a short phrase, never the JSON
  constructor(id) { super(); this.rid = id; }
  find(fn) { const r = rowOf(this.rid); const o = [r.v, summaryOf(r.id, r.v) || '', summaryOf(r.id, r.v) || '']; return fn(o) ? o : undefined; }
}
function afterModelChange() { if (!A.S.open) return; if (P4.view === 'task') { A.refreshPage(); return; } repaintParams(); paintTaskLines(); }
X.boot = (api) => {
  if (H.boot) H.boot(api);
  A = api; B = window.__ss2; C3 = window.__ss3; Object.assign(A.ICONS, ICONS4); document.title = K[A.S.lang].title;
  mkDescs();
  B.PRESET_ROWS.slice().forEach((r) => { if (r.global) { const i = B.PRESET_ROWS.indexOf(r); if (i >= 0) B.PRESET_ROWS.splice(i, 1); } });   // seed, additional parameters and stop strings are not in the preset: switching presets never changes them
  const lk = B.LOCKS['models.keepParamsOnSwitch']; lk.length = 0; TASKS.forEach((t) => lk.push('models.task.' + t[0]));   // DS-082: 기능별 파라미터 유지 now keeps the per-task choice and values (the global checkbox is retired)
  ['models.bias', 'models.addParams', 'models.localStopStrings', 'models.customFlags'].forEach((id) => { rowOf(id).opt = new SumOpts(id); });
  installNeeds();
  const ovt = A.valueText; A.valueText = (r) => {   // slice 2 prints these in undo messages
    const s = summaryOf(r.id, r.v); if (s !== null) return s;
    if (/^models\.send\./.test(r.id)) return r.v ? t4('onWord') : t4('offWord');
    const p = PARAMS.find((x) => x.id === r.id); if (p && p.kind === 'slider') return fmtVal(DESC[p.key], r.v);
    return ovt(r);
  };
  const rc0 = X.rowChanged; X.rowChanged = (r) => { if (rc0) rc0(r); if (P4.booted && MODEL_ROWS.indexOf(r.id) >= 0) afterModelChange(); };
  P4.booted = true; bindPage4(); window.__ss4 = API();
  const st = Q.get('state'); if (st && /^(pa|sv|ad|tk|se)-/.test(st)) setTimeout(() => runState4(st), 0);
};

/* ------------------------------------------------------------------ states (SLICE4_SPEC 11.3) */
const STATES4 = ['pa-page', 'pa-dim-gpt5', 'pa-not-sent', 'pa-over', 'pa-over-fixed', 'pa-help-open', 'pa-changed-reset', 'pa-group-reset', 'pa-locked',
  'sv-novelai', 'sv-textgen', 'sv-novellist', 'ad-closed', 'ad-bias', 'ad-bias-import', 'ad-addparams', 'ad-flags', 'ad-tools',
  'tk-models-lines', 'tk-own-new', 'tk-own-page', 'tk-same-kept', 'tk-locked', 'se-param', 'se-dimmed', 'se-advanced'];
const S4TOASTED = () => { const t = document.getElementById('psToast'); return !!t && !t.classList.contains('gone') && (t.classList.contains('on') || !t.hasAttribute('aria-hidden') || true); };
const needSet = (set) => { if (SET4 === set) return false; const u = new URL(location.href); u.searchParams.set('set', set); location.replace(u.toString()); return true; };
async function runState4(name) {
  window.__ss4Ready = false; const q = Q.get('q');
  const openS = (opt) => { if (!A.S.open) A.openSettings($('#oSettings'), Object.assign({ noFocus: true }, opt || {})); };
  const params = () => { openS({ page: 'models' }); P4.view = 'section'; A.showPage('models', { section: 'models.params', noAnim: true, keepFocus: true, force: true }); };
  const models = () => { openS({ page: 'models' }); P4.view = 'section'; A.showPage('models', { section: 'models.models', noAnim: true, keepFocus: true, force: true }); };
  const settle = () => sleep(80);
  const calm = async () => { B.hideToast(); for (let i = 0; i < 60; i++) { const tt = $('#psToast'); if (!tt || tt.classList.contains('gone') || !S4TOASTED()) break; await sleep(20); } };   // a toast that is still fading would be seen by the contrast sweep
  const toRow = (id) => { const e = $(`#pageScroll [data-row="${id}"]`); if (e) e.scrollIntoView({ block: 'center' }); return e; };
  const lockOn = async () => { const r = A.ROW['models.keepParamsOnSwitch']; r.v = true; B.lockChange(r); A.refreshPage(); await settle(); };
  switch (name) {
    case 'pa-page': params(); break;
    case 'pa-dim-gpt5': params(); await settle(); C3.commitModel('models.mainModel', C3.ref('c-openai', 'gpt-5')); await calm(); await settle(); toRow('models.reasoningEffort'); break;
    case 'pa-not-sent': params(); await settle(); toRow('models.topP'); break;
    case 'pa-over': if (needSet('over')) return new Promise(() => {}); params(); await settle(); toRow('models.maxResponse'); break;
    case 'pa-over-fixed': if (needSet('over')) return new Promise(() => {}); params(); await settle(); fitKey('maxResponse'); toRow('models.maxResponse'); break;
    case 'pa-help-open': params(); await settle(); P4.help.add('main|temperature'); repaintParams(); toRow('models.temperature'); break;
    case 'pa-changed-reset': params(); await settle(); { const e = toRow('models.temperature'); const b = e && $('.p4-menu', e); if (b) rowMenu('temperature', 'main', b, null, b); } break;
    case 'pa-group-reset': params(); await settle(); { const b = $('[data-p4="gmenu"][data-group="random"]'); if (b) { b.scrollIntoView({ block: 'center' }); groupMenu('random', 'main', b, b); } } break;
    case 'pa-locked': params(); await settle(); await lockOn(); P4.adv = true; repaintParams(); toRow('models.addParams'); break;
    case 'sv-novelai': if (needSet('service')) return new Promise(() => {}); params(); await settle(); { const g = $('.p4-svc'); if (g) g.scrollIntoView({ block: 'start' }); } break;
    case 'sv-textgen': if (needSet('service')) return new Promise(() => {}); B.switchTo('p2', { quiet: true, force: true }); await calm(); params(); await settle(); { const g = $('.p4-svc'); if (g) g.scrollIntoView({ block: 'start' }); } break;
    case 'sv-novellist': if (needSet('service')) return new Promise(() => {}); B.switchTo('p3', { quiet: true, force: true }); await calm(); params(); await settle(); { const g = $('.p4-svc'); if (g) g.scrollIntoView({ block: 'start' }); } break;
    case 'ad-closed': params(); await settle(); { const g = $('.p4-adv'); if (g) g.scrollIntoView({ block: 'center' }); } break;
    case 'ad-bias': P4.adv = true; params(); await settle(); C3.commitModel('models.mainModel', C3.ref('c-openai', 'gpt-4o')); await calm(); await settle(); toRow('models.bias'); break;   // GPT-4o takes a bias table, so the editor shows live (on Claude it is dimmed, see ad-addparams)
    case 'ad-bias-import': P4.adv = true; params(); await settle(); C3.commitModel('models.mainModel', C3.ref('c-openai', 'gpt-4o')); await calm(); await settle(); toRow('models.bias'); openBiasPreview(parseBiasJson(SAMPLE_BIAS)); break;
    case 'ad-addparams': P4.adv = true; params(); await settle(); toRow('models.addParams'); break;
    case 'ad-flags': P4.adv = true; params(); await settle(); setRow('models.enableCustomFlags', true); await calm(); repaintParams(); toRow('models.enableCustomFlags'); break;
    case 'ad-tools': P4.adv = true; params(); await settle(); toRow('models.modelTools'); break;
    case 'tk-models-lines': models(); await settle(); toRow('models.memModel'); break;
    case 'tk-own-new': models(); await settle(); setTaskMode('emotion', 'own'); await settle(); break;
    case 'tk-own-page': models(); await settle(); openTask('memory'); break;
    case 'tk-same-kept': models(); await settle(); setTaskMode('memory', 'same'); await settle(); toRow('models.transModel'); break;
    case 'tk-locked': models(); await settle(); await lockOn(); toRow('models.memModel'); break;
    case 'se-param': openS({ page: 'models', noFocus: true }); window.__ss1.setQuery(q || 'temperature'); break;
    case 'se-dimmed': openS({ page: 'models', noFocus: true }); window.__ss1.setQuery(q || 'min p'); break;
    case 'se-advanced': openS({ page: 'models', noFocus: true }); window.__ss1.setQuery(q || 'bias'); break;
    default: break;
  }
  await sleep(60); window.__ss4Ready = name;
}

/* ------------------------------------------------------------------ public API (checks, the demo panel and reviewers) */
function API() {
  return {
    P4, DESC, PARAMS, GROUPS, SVC, SET4, K, t4, A, B, C3, SRC, srcOf, taskSrc, STATES: STATES4, runState: runState4,
    taskGet, taskPut, countChanged, copyMain, setTaskMode, openTask, closeTask, paintTaskLines, taskLineHTML, taskPageHTML,
    previewObj, previewText, supportOf, limitsOf, svcOf, overOf, flagsEff, mainModel, taskModel, fmtVal, parseNum, summaryOf,
    fitKey, toggleSend, selectSeg, resetKeys, setRow, setRowC, gset, batch, undoIfTop, biasGet, apGet, stopGet, biasAdd, biasDel, apAdd, apDel, stopAdd, stopDel, flagToggle, openBiasImport, openBiasPreview, parseBiasJson, SAMPLE_BIAS,
    repaintParams, rowMenu, groupMenu, paramRowHTML, groupHTML, paramsBody,
    toStored, fromStored: D4.fromStored, units: (key) => { const d = DESC[key]; const v = SRC.main.get(d); return { display: v, stored: toStored(key, v), legacy: d.sendable && !SRC.main.sent(d) ? -1000 : toStored(key, v), sent: SRC.main.sent(d) }; },
    storeWrite: (id, v) => { const r = rowOf(id); r.v = v; const p = B.act(); if (!r.global) p.vals[id] = v; repaintAfterWrite(); },   // another tab wrote the store: the rows must read it again (DS-067)
    storeRead: (id) => rowOf(id).v,
  };
}
})();
