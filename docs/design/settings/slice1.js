/* Settings slice 1 mockup: shell + search. Synthetic mockup; not proof of native behaviour or performance.
   Standalone (no network, no dependencies); implements settings/SLICE1_SPEC.md revision 2 (review round: R-01..R-24).
   Sections: helpers, icons, i18n, state, availability and values, index/search, rows, pages, index UI, header, search UI, origin stub, dialogs/menus, navigation, keyboard, demo panel, states, init. */
(() => {
'use strict';
const D = window.SS1_DATA;
const X = window.SS1_EXT || {};   // slice 2 hooks (settings/slice2.js); empty on slice1.html, so slice 1 behaves exactly as before
const $ =(s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const Q = new URLSearchParams(location.search);
const root = document.documentElement;
const now = () => performance.now();
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ icons (Lucide, inline; paths copied, not imported) */
const ICONS = {
  'cpu': '<path d="M12 20v2"/><path d="M12 2v2"/><path d="M17 20v2"/><path d="M17 2v2"/><path d="M2 12h2"/><path d="M2 17h2"/><path d="M2 7h2"/><path d="M20 12h2"/><path d="M20 17h2"/><path d="M20 7h2"/><path d="M7 20v2"/><path d="M7 2v2"/><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="8" y="8" width="8" height="8" rx="1"/>',
  'message-square': '<path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"/>',
  'palette': '<path d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z"/><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/>',
  'hand': '<path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2"/><path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>',
  'languages': '<path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/>',
  'user-round': '<circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/>',
  'puzzle': '<path d="M15.39 4.39a1 1 0 0 0 1.68-.474 2.5 2.5 0 1 1 3.014 3.015 1 1 0 0 0-.474 1.68l1.683 1.682a2.414 2.414 0 0 1 0 3.414L19.61 15.39a1 1 0 0 1-1.68-.474 2.5 2.5 0 1 0-3.014 3.015 1 1 0 0 1 .474 1.68l-1.683 1.682a2.414 2.414 0 0 1-3.414 0L8.61 19.61a1 1 0 0 0-1.68.474 2.5 2.5 0 1 1-3.014-3.015 1 1 0 0 0 .474-1.68l-1.683-1.682a2.414 2.414 0 0 1 0-3.414L4.39 8.61a1 1 0 0 1 1.68.474 2.5 2.5 0 1 0 3.014-3.015 1 1 0 0 1-.474-1.68l1.683-1.682a2.414 2.414 0 0 1 3.414 0z"/>',
  'database': '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/>',
  'keyboard': '<path d="M10 8h.01"/><path d="M12 12h.01"/><path d="M14 8h.01"/><path d="M16 12h.01"/><path d="M18 8h.01"/><path d="M6 8h.01"/><path d="M7 16h10"/><path d="M8 12h.01"/><rect width="20" height="16" x="2" y="4" rx="2"/>',
  'sliders-horizontal': '<line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/>',
  'arrow-left': '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  'arrow-up': '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
  'arrow-down': '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
  'search': '<path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/>',
  'x': '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  'check': '<path d="M20 6 9 17l-5-5"/>',
  'plus': '<path d="M5 12h14"/><path d="M12 5v14"/>',
  'chevron-right': '<path d="m9 18 6-6-6-6"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  'info': '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  'ellipsis': '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  'smartphone': '<rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/>',
  'bookmark': '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>',
  'rotate-ccw': '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  'refresh-cw': '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  'trash-2': '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>',
  'image': '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  'plug': '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>',
  'sliders': '<line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/>',
  'panel-left': '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/>',
  'grid': '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
  'send': '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  'house': '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  'wand': '<path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72"/><path d="m14 7 3 3"/><path d="M5 6v4"/><path d="M19 14v4"/><path d="M10 2v2"/><path d="M7 8H3"/><path d="M21 16h-4"/><path d="M11 3H9"/>',
  'settings': '<path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/>',
  'triangle-alert': '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  'zap': '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
  'wrench': '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z"/>',
  'pencil': '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
};
const icMemo = {};
const ic = (n, size = 'xl', cls = '') => icMemo[n + '|' + size + '|' + cls] || (icMemo[n + '|' + size + '|' + cls] = `<svg class="ic ic-${size} ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[n] || ''}</svg>`);   // size is a name (xs sm md lg xl 2xl inline mark feature): the pixel size and the stroke come from the --icon-size-* and --icon-stroke tokens (theme-tokens.css)

/* ------------------------------------------------------------------ Hangul helpers */
const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const isSyl = (c) => c >= 0xAC00 && c <= 0xD7A3;
const cho = (ch) => { const c = ch.charCodeAt(0); return isSyl(c) ? CHO[((c - 0xAC00) / 588) | 0] : ch; };
const jong = (name) => { const c = String(name).trim().slice(-1).charCodeAt(0); return isSyl(c) ? (c - 0xAC00) % 28 : -1; };
const pRo = (name) => { const j = jong(name); return j < 0 ? '(으)로' : (j === 0 || j === 8 ? '로' : '으로'); };   // 로 after a vowel or ㄹ, 으로 otherwise
const pGwa = (name) => { const j = jong(name); return j < 0 ? '와(과)' : (j === 0 ? '와' : '과'); };

/* ------------------------------------------------------------------ i18n (SLICE1_SPEC section 8 keys plus mockup-only keys; revision 2 additions) */
const pEul = (name) => { const j = jong(name); return j < 0 ? '을(를)' : (j === 0 ? '를' : '을'); };
const T = {
  ko: {
    settings: '설정', skip: '본문으로 건너뛰기', indexNav: '설정 메뉴', sectionNav: '이 화면의 섹션', pageOf: '{p} 섹션',
    backTo: (o) => `${o}${pRo(o)} 돌아가기`, backToIndex: '설정 메뉴로 돌아가기',
    originChat: (n) => `${n}${pGwa(n)}의 채팅`, originHome: '홈', originStudio: '스튜디오',
    searchSettings: '설정 검색', searchClose: '검색 닫기', clearField: '입력 지우기', resultsLabel: '검색 결과',
    resultsCount: (n) => `결과 ${n}개`, showAll: (n) => `모두 보기 (${n})`, noResults: (q) => `‘${q}’에 맞는 설정이 없어요`,
    clearSearch: '검색어 지우기', browseAll: '모든 설정 보기',
    grp: { top: '가장 알맞은 결과', setting: '설정', page: '페이지', preset: '프리셋', model: '모델', connection: '연결', persona: '페르소나', plugin: '플러그인', module: '모듈', help: '도움말' },
    sectionRows: (n) => `이 섹션의 설정 ${n}개 보기`, matchedVia: (w) => `‘${w}’ 일치`,
    changedFromDefault: '기본값과 다름', resetToDefault: '기본값으로', moreActions: '이 설정의 메뉴', helpShow: '도움말',
    scopeDevice: '이 기기', scopePreset: (n) => `프리셋: ${n}`, scopeChat: '이 채팅', scopeSection: (n) => `이 섹션은 프리셋 ‘${n}’에 저장돼요`, openInStudio: '스튜디오에서 열기',
    redesignLater: (s) => `이 화면은 다음 단계에서 새로 디자인해요 (${s})`,
    unavailModel: (m) => `지금 모델(${m})은 이 값을 쓰지 않아요`, unavailExperimental: '실험적 기능을 켜면 보여요', unavailDevice: '이 기기에서는 쓸 수 없어요',
    depSwitch: (n) => `‘${n}’${pEul(n)} 켜면 보여요`, depSelect: (n, v) => `‘${n}’${pEul(n)} ‘${v}’${pRo(v)} 바꾸면 보여요`,
    goToSwitch: (n) => `‘${n}’${pRo(n)} 이동`, unavailTitle: '지금은 이 화면에 보이지 않아요',
    lowPower: '저전력 모드', lowPowerDesc: '흐림·그림자·장식 애니메이션을 끄고 전환을 짧게 해요',
    lowPowerSuggest: '화면이 느린 것 같아요. 저전력 모드를 켤까요?', turnOn: '켜기', noThanks: '괜찮아요', lowPowerAsked: '느릴 때 한 번 제안했어요', lowPowerAskedMany: '느릴 때 제안한 적이 있어요', backToResults: '검색 결과로 돌아가기', backToResultsShort: '검색 결과', looseNote: '일부 단어만 일치해요', rowsAppeared: (n) => `설정 ${n}개가 나타났어요`, rowsGone: (n) => `설정 ${n}개가 사라졌어요`, queryChip: (q) => `‘${q}’ 검색`,
    hotkeysPhone: '키보드를 연결하면 바꿀 수 있어요', settingNotFound: '찾는 설정이 없어요', moduleNameFirst: '새 모듈 이름',
    moduleName: '이름', moduleNameNeeded: '이름을 입력해야 만들 수 있어요', create: '만들기', cancel: '취소', confirm: '확인', close: '닫기', moduleMade: (n) => `‘${n}’ 모듈을 만들었어요 (모의)`, newModuleNote: '새 모듈',
    simulated: (w) => `‘${w}’ — 모의 동작이에요`, aboutLic: '정보·라이선스', termsPrivacy: '약관·개인정보', aboutBody: '이 화면은 목업이에요. 실제 라이선스와 약관 문서로 연결되지 않아요.',
    valOn: '켬', valOff: '끔', valEmpty: '비어 있음', valSet: '설정됨', unavailable: '쓸 수 없음',
    connLabel: (p, s) => `연결: ${p} · ${s}`, statusSet: '설정됨', statusNone: '없음', manageConn: '연결에서 관리', modelLabel: (m) => `모델: ${m}`, changeInModels: '모델·프리셋에서 바꾸기',
    otherServices: (n) => `다른 서비스 (${n})`,
    modelFound: (m, p) => `찾은 모델: ${m} (${p})`, modelFoundNote: '모델 고르기는 슬라이스 3에서 새로 디자인해요', useAsMain: '주 모델로 쓰기', mainSet: '주 모델을 바꿨어요 (모의)',
    active: '사용 중', presetCount: (n) => `프리셋 ${n}개`, personaCount: (n) => `페르소나 ${n}개`, switchedTo: (n) => `‘${n}’ 선택 (모의)`, switchPreset: '이 프리셋으로 바꾸기', presetMenu: (n) => `프리셋 ${n}`,
    helpResetTitle: '기본값으로 되돌리는 법', helpResetBody: '값을 바꾸면 줄 앞에 점이 생겨요. 점이 있는 줄의 ⋯ 버튼, 오른쪽 클릭, Shift+F10 또는 길게 누르기로 ‘기본값으로’를 고르면 원래 값으로 돌아가요. 기본값이 정해진 설정에만 있어요.',
    emptyExperimental: '실험적 기능을 켜면 여기에 보여요', genStatus: (n) => `답변 작성 중… ${n}자`,
    composerPh: '메시지…', composerLabel: '메시지', send: '보내기', msgsLabel: '채팅 내용', originAria: '이전 화면',
    homeTiles: ['세라핀과의 채팅', '주노의 여행', '새 캐릭터'], studioItems: ['프리셋 편집', '모듈 편집', '플러그인 편집'], recent: '최근',
    chatName: '세라핀', draftDefault: '다음 장면은 숲길에서 시작하고 싶어요, 그리고',
    demoOpen: '설정 데모 컨트롤', demoTitle: '설정 데모 컨트롤', demoLang: '언어', demoWidth: '너비', demoRm: '움직임 줄이기', demoLp: '저전력 모드', demoBig: '글자 크기 200%', demoOrigin: '시작한 화면',
    demoModel: '지금 모델', demoExp: '실험적 기능 보이기', demoSlow: '느린 화면 제안 보이기', demoState: '상태', demoGo: '열기', demoReset: '처음으로', demoAuto: '자동', demoOpenSettings: '설정 열기', demoBack: '돌아가기',
    demoStates: '상태: ?state=', demoNote: '목업이에요. 실제 앱의 동작이나 성능을 증명하지 않아요.',
    orgChat: '채팅', orgHome: '홈', orgStudio: '스튜디오', openSettings: '설정', page: '페이지',
    helpOfRow: (l) => `${l} 도움말`, moreOfRow: (l) => `${l} 메뉴`, fromSearch: '검색에서 열었어요', lang: 'ko',
  },
  en: {
    settings: 'Settings', skip: 'Skip to content', indexNav: 'Settings menu', sectionNav: 'Sections on this page', pageOf: '{p} sections',
    backTo: (o) => `Back to ${o}`, backToIndex: 'Back to the settings menu',
    originChat: (n) => `Chat with ${n}`, originHome: 'Home', originStudio: 'Studio',
    searchSettings: 'Search settings', searchClose: 'Close search', clearField: 'Clear input', resultsLabel: 'Search results',
    resultsCount: (n) => `${n} results`, showAll: (n) => `Show all (${n})`, noResults: (q) => `No settings match "${q}"`,
    clearSearch: 'Clear search', browseAll: 'Browse all settings',
    grp: { top: 'Top hit', setting: 'Settings', page: 'Pages', preset: 'Presets', model: 'Models', connection: 'Connections', persona: 'Personas', plugin: 'Plugins', module: 'Modules', help: 'Help' },
    sectionRows: (n) => `Show the ${n} settings in this section`, matchedVia: (w) => `Matches "${w}"`,
    changedFromDefault: 'Changed from default', resetToDefault: 'Reset to default', moreActions: 'Menu for this setting', helpShow: 'Help',
    scopeDevice: 'This device', scopePreset: (n) => `Preset: ${n}`, scopeChat: 'This chat', scopeSection: (n) => `This section is saved in preset "${n}"`, openInStudio: 'Open in Studio',
    redesignLater: (s) => `This screen is redesigned in a later step (${s})`,
    unavailModel: (m) => `The current model (${m}) doesn't use this`, unavailExperimental: 'Shown when experimental features are on', unavailDevice: 'Not available on this device',
    depSwitch: (n) => `Shown when "${n}" is on`, depSelect: (n, v) => `Shown when "${n}" is set to "${v}"`,
    goToSwitch: (n) => `Go to "${n}"`, unavailTitle: 'Not shown on this page right now',
    lowPower: 'Low-power mode', lowPowerDesc: 'Turns off blur, shadows and decorative animation, and shortens transitions.',
    lowPowerSuggest: 'The screen seems slow. Turn on low-power mode?', turnOn: 'Turn on', noThanks: 'No thanks', lowPowerAsked: 'Suggested once when the app was slow', lowPowerAskedMany: 'Suggested when the app was slow', backToResults: 'Back to results', backToResultsShort: 'Results', looseNote: 'Some words match', rowsAppeared: (n) => `${n} settings appeared`, rowsGone: (n) => `${n} settings disappeared`, queryChip: (q) => `Search "${q}"`,
    hotkeysPhone: 'Connect a keyboard to change shortcuts', settingNotFound: "That setting wasn't found", moduleNameFirst: 'Name the new module',
    moduleName: 'Name', moduleNameNeeded: 'Enter a name to create the module', create: 'Create', cancel: 'Cancel', confirm: 'OK', close: 'Close', moduleMade: (n) => `Created module "${n}" (simulated)`, newModuleNote: 'New module',
    simulated: (w) => `"${w}" (simulated)`, aboutLic: 'About & licences', termsPrivacy: 'Terms & privacy', aboutBody: 'This screen is a mockup. It does not link to the real licence and terms documents.',
    valOn: 'On', valOff: 'Off', valEmpty: 'Empty', valSet: 'Set', unavailable: 'Unavailable',
    connLabel: (p, s) => `Connection: ${p} · ${s}`, statusSet: 'Set', statusNone: 'None', manageConn: 'Manage in Connections', modelLabel: (m) => `Model: ${m}`, changeInModels: 'Change in Models & presets',
    otherServices: (n) => `Other services (${n})`,
    modelFound: (m, p) => `Matched model: ${m} (${p})`, modelFoundNote: 'Model picking is redesigned in slice 3', useAsMain: 'Use as main model', mainSet: 'Main model changed (simulated)',
    active: 'In use', presetCount: (n) => `${n} presets`, personaCount: (n) => `${n} personas`, switchedTo: (n) => `Selected "${n}" (simulated)`, switchPreset: 'Switch to this preset', presetMenu: (n) => `Preset ${n}`,
    helpResetTitle: 'How to reset a setting to its default', helpResetBody: 'Changing a value puts a dot before its row. Use the ⋯ button on that row, right-click, Shift+F10 or a long press and choose "Reset to default". Only settings with a defined default have it.',
    emptyExperimental: 'Shown here when experimental features are on', genStatus: (n) => `Writing the reply… ${n} characters`,
    composerPh: 'Message…', composerLabel: 'Message', send: 'Send', msgsLabel: 'Chat transcript', originAria: 'Previous screen',
    homeTiles: ['Chat with Seraphina', "Juno's trip", 'New character'], studioItems: ['Edit preset', 'Edit module', 'Edit plugin'], recent: 'Recent',
    chatName: 'Seraphina', draftDefault: 'I want the next scene to start on the forest road, and',
    demoOpen: 'Settings demo controls', demoTitle: 'Settings demo controls', demoLang: 'Language', demoWidth: 'Width', demoRm: 'Reduced motion', demoLp: 'Low-power mode', demoBig: 'Text size 200%', demoOrigin: 'Opened from',
    demoModel: 'Current model', demoExp: 'Show experimental features', demoSlow: 'Show the slow-screen suggestion', demoState: 'State', demoGo: 'Open', demoReset: 'Reset', demoAuto: 'Auto', demoOpenSettings: 'Open settings', demoBack: 'Go back',
    demoStates: 'States: ?state=', demoNote: 'Mockup. Does not prove real app behaviour or performance.',
    orgChat: 'Chat', orgHome: 'Home', orgStudio: 'Studio', openSettings: 'Settings', page: 'Page',
    helpOfRow: (l) => `${l} help`, moreOfRow: (l) => `${l} menu`, fromSearch: 'Opened from search', lang: 'en',
  },
};
const STATES = ['ss-origin', 'ss-index', 'ss-page-display', 'ss-page-models', 'ss-page-advanced', 'ss-search-typing', 'ss-search-chosung', 'ss-search-en', 'ss-search-named', 'ss-search-unavail', 'ss-search-none', 'ss-search-expand', 'ss-hit', 'ss-help-open', 'ss-changed', 'ss-hotkeys-phone', 'ss-module-new', 'ss-deeplink-bad', 'ss-lowpower-suggest', 'ss-lowpower-on', 'ss-large-text', 'ss-back'];
const PAGE_SUM = { persona: { ko: '이름·메모·가져오기', en: 'Names, notes, import' }, keys: { ko: '키 조합 한눈에 보기', en: 'Key combinations at a glance' } };
const PRESET_SECS = new Set(['models.models', 'models.params', 'models.prompt']);   // DS-012: sections stored in the active preset

/* ------------------------------------------------------------------ state */
const PAGE = Object.fromEntries(D.PAGES.map((p) => [p.id, p]));
const SEC = Object.fromEntries(D.SECTIONS.map((s) => [s.id, s]));
const ROW = Object.fromEntries(D.rows.map((r) => [r.id, r]));
const SECROWS = {}; D.rows.forEach((r) => { (SECROWS[r.sec] = SECROWS[r.sec] || []).push(r); });
const MODEL = Object.fromEntries(D.models.map((m) => [m.id, m]));
const DEPT = new Set(['models.mainModel', 'adv.useExperimental']); D.rows.forEach((r) => { if (r.dep) DEPT.add(r.dep.id); });
const DEMO_MODELS = ['claude-sonnet-45', 'gpt-5-mini', 'gpt-41', 'llama-local-8b'];
const store = { get(k) { try { return localStorage.getItem('ss1.' + k); } catch (_) { return null; } }, set(k, v) { try { localStorage.setItem('ss1.' + k, v); } catch (_) { /* ignore */ } } };
const hermetic = Q.has('state') || Q.has('page') || Q.has('q') || Q.has('lowpower') || Q.has('section') || Q.has('row');
const FROMS = ['chat', 'home', 'studio'];
if (Q.get('from') && !FROMS.includes(Q.get('from'))) console.warn('[settings mockup] unknown from=' + Q.get('from') + '; using chat');
const LP_DAY = 86400000;
function lpInit() { if (!hermetic) { try { const j = JSON.parse(store.get('lpState') || 'null'); if (j) return j; } catch (_) { /* ignore */ } } return { declined: 0, last: 0, on: false }; }
const S = {
  lang: Q.get('lang') === 'en' ? 'en' : 'ko', page: 'models', view: 'index', open: false, from: FROMS.includes(Q.get('from')) ? Q.get('from') : 'chat',
  q: '', searchOpen: false, resShown: false, resume: null, expanded: new Set(), activeOpt: -1, hits: null, lay: 'wide',
  rm: false, lp: false, big: false, frameW: 0, notice: '', modelCallout: null, hlHold: false, connExpanded: false, pageMem: {},
  draft: null, saved: null, opener: null, popExpected: 0, lpState: lpInit(), lpAsked: false, lpPending: false, gen: { chars: 0 },
  presetActive: 'p1', personaActive: 'u1', modules: D.modules.slice(), flags: {}, rmSys: false,
};
const syncAsked = () => { S.lpAsked = S.lpState.declined > 0 || !!S.lpState.on; }; syncAsked();
const perf = { build: 0, lastFilter: 0, samples: [], entries: 0 };
const t = (k, ...a) => { const v = T[S.lang][k]; return typeof v === 'function' ? v(...a) : v; };
const L = (o) => o[S.lang];
const pair = (s) => { const p = String(s || '').split('|'); return S.lang === 'ko' ? p[0] : (p[1] || p[0]); };
const pairArr = (a) => (S.lang === 'ko' ? a[0] : a[1]);
const originName = () => (S.from === 'chat' ? t('originChat', t('chatName')) : S.from === 'home' ? t('originHome') : t('originStudio'));
const curModel = () => MODEL[ROW['models.mainModel'].v] || D.models[0];
const activePreset = () => D.presets.find((p) => p.id === S.presetActive) || D.presets[0];
const hideKeys = () => !!ROW['models.hideApiKey'].v;
const mn = (m) => (S.lang === 'en' && m.en) ? m.en : m.name;
const mprov = (m) => (S.lang === 'en' && m.provEn) ? m.provEn : m.prov;
const pnote = (x) => (S.lang === 'en' && x.noteEn) ? x.noteEn : (x.note || '');

/* ------------------------------------------------------------------ availability and values */
const same = (a, b) => (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 1e-9 : a === b);
const isChanged = (r) => r.d !== undefined && !same(r.v, r.d);
const fmtNum = (v) => String(Math.round(v * 100) / 100);
const optLabel = (r, v) => { if (r.opt && r.opt.length === 1 && r.opt[0][0] === '') { const m = MODEL[v]; return m ? mn(m) : (v === '' ? '—' : v); } const o = (r.opt || []).find((x) => x[0] === v); return o ? (S.lang === 'ko' ? o[1] : o[2]) : String(v); };
const depMet = (r) => { const d = r.dep; if (!d) return true; const v = ROW[d.id].v; return d.in ? d.in.includes(v) : v === d.eq; };
function unavail(r) {   // reasons: device, experimental, model, dependency (R-09)
  if (r.dev) return { code: 'device', text: t('unavailDevice') };
  if (r.exp && !ROW['adv.useExperimental'].v) return { code: 'experimental', text: t('unavailExperimental'), goto: 'adv.useExperimental' };
  if (r.needs && !curModel().params.includes(r.needs)) return { code: 'model', text: t('unavailModel', mn(curModel())), goto: 'models.mainModel' };
  if (r.dep && !depMet(r)) { const tr = ROW[r.dep.id]; const tn = L(tr); return r.dep.in ? { code: 'dependency', text: t('depSelect', tn, r.dep.in.map((v) => optLabel(tr, v)).join(S.lang === 'ko' ? '·' : ' / ')), goto: r.dep.id } : { code: 'dependency', text: t('depSwitch', tn), goto: r.dep.id }; }
  return null;
}
// DS-013: providers that have a value show; the rest collapse into one "다른 서비스 (n)" row
const groupConfigured = (g) => D.rows.some((r) => r.g === g && (r.type === 'secret' || r.type === 'text') && r.v);
const connGroups = () => [...new Set(D.rows.filter((r) => r.g).map((r) => r.g))];
const connHidden = (r) => !!r.g && !S.connExpanded && !groupConfigured(r.g);
const otherCount = () => connGroups().filter((g) => !groupConfigured(g)).length;
function valueText(r) {
  switch (r.type) {
    case 'switch': return r.v ? t('valOn') : t('valOff');
    case 'select': case 'segmented': return optLabel(r, r.v);
    case 'slider': return fmtNum(r.v) + (r.unit || '');
    case 'number': return String(r.v);
    case 'text': return r.v ? String(r.v) : t('valEmpty');
    case 'secret': return r.v ? t('valSet') : t('valEmpty');
    case 'textarea': return r.v ? String(r.v).slice(0, 24) : t('valEmpty');
    case 'key': return r.combo;
    default: return '';
  }
}
const isModelSelect = (r) => r.type === 'select' && r.opt.length === 1 && r.opt[0][0] === '';
const rowDesc = (r) => {
  let d = r.desc ? pair(r.desc) : '';
  if (r.id === 'display.lowPower') d = t('lowPowerDesc');
  return d;
};

/* ------------------------------------------------------------------ search index (built once when Settings opens, SPEC 5.2; matching per word token, R-01) */
const SEP = /[\s·›,\/()\-_.:]/;
function mf(text) {   // field: original text, stripped lowercase string, map to original index, token id per char, token-start set, initial-consonant string
  text = text || ''; const low = text.toLowerCase(); let s = ''; const map = [], tok = []; const wb = new Set(); let prev = true, ti = -1;
  for (let i = 0; i < low.length; i++) { const ch = low[i]; if (SEP.test(ch)) { prev = true; continue; } if (prev) { ti++; wb.add(s.length); } prev = false; map.push(i); tok.push(ti); s += ch; }
  let c = ''; for (let i = 0; i < s.length; i++) c += cho(s[i]);
  return { txt: text, s, map, tok, wb, c };
}
const JAMO = /^[ㄱ-ㅎ]+$/;
function mw(F, q) {   // one query word in one field -> { r, a, b } (stripped coordinates) or null. r: 0 exact, 1 prefix, 2 token start (may run on across separators), 3 inside one token (word of 3+ letters only)
  if (!F || !F.s) return null;
  if (JAMO.test(q)) {
    if (q.length === 1) { for (const i of F.wb) if (F.c[i] === q) return { r: 2, a: i, b: i + 1 }; return null; }
    const i = F.c.indexOf(q); if (i < 0) return null;
    return { r: i === 0 ? (F.c.length === q.length ? 0 : 1) : (F.wb.has(i) ? 2 : 3), a: i, b: i + q.length };
  }
  let i = F.s.indexOf(q), inside = null;
  while (i >= 0) {
    const end = i + q.length; const endsAtToken = end >= F.s.length || F.tok[end] !== F.tok[end - 1];
    if (F.wb.has(i) && (F.tok[i] === F.tok[end - 1] || endsAtToken)) return { r: i === 0 ? (F.s.length === q.length ? 0 : 1) : 2, a: i, b: end };   // running across a separator is only for whole tokens (채팅봇 = 채팅 봇), so "to"+"preset" never gives "top"
    if (!inside && q.length >= 3 && F.tok[i] === F.tok[i + q.length - 1]) inside = { r: 3, a: i, b: i + q.length };
    i = F.s.indexOf(q, i + 1);
  }
  return inside;
}
const normWord = (w) => { let s = ''; for (const ch of w.toLowerCase()) if (!SEP.test(ch)) s += ch; return s; };
let IDX = [];
function splitSyn(syn, id) {   // R-02: ids and camelCase source keys are hidden match terms, never rendered
  const vis = [], hid = [id || '']; for (const w of String(syn || '').split(/\s+/)) { if (!w) continue; if (/[a-z][A-Z]/.test(w) || w.includes('.')) hid.push(w); else vis.push(w); }
  return { vis: vis.join(' '), hid: hid.join(' ') };
}
function mkEntry(k, id, ico, ko, en, syn, hid, crK, crE, dK, dE, hK, hE, extra) {
  return Object.assign({ k, id, ico, ko, en, F: { labK: mf(ko), labE: mf(en), syn: mf(syn), hid: mf(hid), crK: mf(crK), crE: mf(crE), dK: mf(dK), dE: mf(dE), hK: mf(hK), hE: mf(hE) }, ord: IDX.length }, extra);
}
function buildIndex() {
  const t0 = now(); IDX = [];
  const pg = (id) => PAGE[id];
  D.PAGES.forEach((p) => IDX.push(mkEntry('page', 'page:' + p.id, p.icon, p.ko, p.en, p.syn, '', '', '', '', '', '', '', { page: p.id, alias: (p.al || '').split('|').map((x) => normWord(x)).filter(Boolean) })));
  D.SECTIONS.forEach((s) => { if (s.ko) IDX.push(mkEntry('page', 'sec:' + s.id, pg(s.page).icon, s.ko, s.en, '', '', pg(s.page).ko, pg(s.page).en, '', '', '', '', { page: s.page, sec: s.id })); });
  D.rows.forEach((r) => {
    if (r.type === 'note') return; const s = SEC[r.sec]; const p = pg(r.page);
    const cK = p.ko + (s.ko ? ' › ' + s.ko : ''), cE = p.en + (s.en ? ' › ' + s.en : '');
    const dp = r.desc ? r.desc.split('|') : ['', '']; const hp = r.help ? r.help.split('|') : ['', ''];
    const dK = r.id === 'display.lowPower' ? T.ko.lowPowerDesc : dp[0], dE = r.id === 'display.lowPower' ? T.en.lowPowerDesc : (dp[1] || dp[0]);
    const sy = splitSyn(r.syn, r.id);
    IDX.push(mkEntry('setting', r.id, p.icon, r.ko, r.en, sy.vis, sy.hid, cK, cE, dK, dE, hp[0], hp[1] || hp[0], { row: r, page: r.page, sec: r.sec }));
  });
  const crumbs = { preset: ['models', 'models.presets'], model: ['models', 'models.models'], connection: ['models', 'models.connections'], persona: ['persona', 'persona.main'], plugin: ['ext', 'ext.plugins'], module: ['ext', 'ext.modules'] };
  const thing = (kind, id, ico, name, syn, hid, desc, extra, nameEn, descEn) => { extra = Object.assign({ nocr: true }, extra); const [pid, sid] = crumbs[kind]; const p = pg(pid), s = SEC[sid]; IDX.push(mkEntry(kind, kind + ':' + id, ico, name, nameEn || name, syn, hid, p.ko + (s.ko ? ' › ' + s.ko : ''), p.en + (s.en ? ' › ' + s.en : ''), desc, descEn === undefined ? desc : descEn, '', '', Object.assign({ page: pid, sec: sid, thing: id }, extra))); };
  D.presets.forEach((p) => thing('preset', p.id, 'bookmark', p.name, '', p.id, '', { ref: p }));
  D.models.forEach((m) => { if (!m.clone) thing('model', m.id, 'cpu', m.name, m.prov + ' ' + (m.kw || ''), m.id, '', { ref: m }, m.en); });   // clones (the same catalog under another connection, DS-054) are not separate search things
  D.connections.forEach((c) => thing('connection', c.id, 'plug', c.name, c.kw || '', c.id, '', { ref: c }, c.en));
  D.personas.forEach((p) => thing('persona', p.id, 'user-round', p.name, '', p.id, p.note, { ref: p }, p.name, p.noteEn));
  D.plugins.forEach((p) => thing('plugin', p.id, 'puzzle', p.name, '', p.id, p.note, { ref: p }, p.name, p.noteEn));
  S.modules.forEach((m) => thing('module', m.id, 'grid', m.name, '', m.id, m.note || '', { ref: m }, m.name, m.noteEn || (m.note ? undefined : '')));
  IDX.push(mkEntry('help', 'help:reset', 'rotate-ccw', T.ko.helpResetTitle, T.en.helpResetTitle, '초기화 리셋 되돌리기 원래대로 기본값 처음으로 reset restore default revert undo', '', '', '', T.ko.helpResetBody, T.en.helpResetBody, '', '', {}));
  if (X.indexExtra) X.indexExtra(mkEntry, IDX);
  perf.build = now() - t0; perf.entries = IDX.length;
}
const KEYS_KO = ['labK', 'labE', 'syn', 'hid', 'crK', 'crE', 'dK', 'dE', 'hK', 'hE'], KEYS_EN = ['labE', 'labK', 'syn', 'hid', 'crE', 'crK', 'dE', 'dK', 'hE', 'hK'], CLS = [0, 0, 4, 4, 5, 5, 6, 6, 6, 6];
function scoreEntry(e, words, any) {
  const keys = S.lang === 'ko' ? KEYS_KO : KEYS_EN; const multi = words.length > 1; let worst = 0, sum = 0, matched = 0; const info = [];
  for (const w of words) {
    let best = null; const jam = JAMO.test(w); const one = w.length === 1 && !jam;
    for (let i = 0; i < 10; i++) {
      if (e.nocr && (i === 4 || i === 5)) continue;   // named things: the breadcrumb is only shown, never matched
      if (i === 1 && best && best.slot === 0) continue;   // the current-language label wins when it matches (N-08)
      if (one && i >= 3) break;   // N-02: a one-letter word matches only at a label or synonym token start (never breadcrumb, description or in-word)
      const F = e.F[keys[i]]; if (!F.s) continue; const m = mw(F, w); if (!m) continue;
      if (m.r === 3 && !jam && multi) continue;   // in-word hits only for single-word queries (N-02)
      if (one && m.r > 2) continue;
      if (i >= 2 && m.r > 2 && !jam) continue;   // synonyms, breadcrumbs, descriptions and help must start a word
      const r = i < 2 ? (m.r === 3 ? 5 : m.r) : CLS[i];   // a match inside a word ranks below synonyms
      if (!best || r < best.r) best = { r, key: keys[i], slot: i, a: m.a, b: m.b }; if (best.r === 0) break;
    }
    if (!best) { if (any) continue; return null; }
    matched++; if (best.r > worst) worst = best.r; sum += best.r; info.push(best);
  }
  if (!matched) return null;
  return { e, worst, sum, info, k: matched };
}
const FILLER = new Set(['바꾸기', '바꿔', '켜기', '끄기', '만들기', '절약', '줄이기', '하기', '해줘', '방법', 'all', 'the', 'a', 'an', 'my', 'to', 'of', 'for', 'turn', 'on', 'off', 'set', 'change', 'how']);
function collect(words, any) {
  const hits = [], counts = {}, kept = {}; const broad = words.length === 1 && words[0].length === 1; const CAP = 50;   // R-08: broad queries stop collecting after 50 per group
  for (const e of IDX) {
    const h = scoreEntry(e, words, any); if (!h) continue; counts[e.k] = (counts[e.k] || 0) + 1;
    if (broad && (kept[e.k] || 0) >= CAP) continue; kept[e.k] = (kept[e.k] || 0) + 1;
    h.un = e.k === 'setting' ? unavail(e.row) : null; hits.push(h);
  }
  return { hits, counts, broad };
}
function search(raw) {
  const t0 = now(); let words = raw.trim().split(/\s+/).map(normWord).filter(Boolean); let loose = false;
  let r = collect(words, false);
  if (!r.hits.length && words.length) {   // DS-015: retry looser: filler words, joined spacing, plural, then any word
    const nf = words.filter((w) => !FILLER.has(w)); const base = nf.length ? nf : words; const tries = [];
    if (base.length < words.length) tries.push(base);
    if (base.length > 1) tries.push([base.join('')]);
    const sing = base.map((w) => (/^[a-z]{4,}s$/.test(w) ? w.slice(0, -1) : w)); if (sing.join('|') !== base.join('|')) tries.push(sing);
    for (const w of tries) { const rr = collect(w, false); if (rr.hits.length) { r = rr; words = w; break; } }
    if (!r.hits.length && base.length > 1) { r = collect(base, true); words = base; loose = r.hits.length > 0; }
  }
  const { hits, counts, broad } = r; const byKind = {}; for (const h of hits) (byKind[h.e.k] = byKind[h.e.k] || []).push(h);
  // R-05: unavailable sorts after available hits of the same match tier; loose results rank by how many words matched
  Object.values(byKind).forEach((a) => a.sort((x, y) => (loose ? y.k - x.k : 0) || x.worst - y.worst || (x.un ? 1 : 0) - (y.un ? 1 : 0) || x.sum - y.sum || x.e.ord - y.e.ord));
  // R-04 / N-03: a query equal to the start of a page or section name (or an old page name) pins it as the top hit
  let top = null, crumbRows = 0;
  const pw = words.filter((w) => !FILLER.has(w)); const qj = (pw.length ? pw : words).join('');
  if (qj.length >= 2 && !JAMO.test(qj) && !loose) {
    const lk = S.lang === 'ko'; const c = IDX.filter((e) => e.k === 'page' && (e.F.labK.s.startsWith(qj) || e.F.labE.s.startsWith(qj) || (e.alias && e.alias.some((al) => al.startsWith(qj)))));
    if (c.length) {
      const exact = (e) => (e.F.labK.s === qj || e.F.labE.s === qj || (e.alias && e.alias.includes(qj))) ? 0 : 1;
      c.sort((x, y) => exact(x) - exact(y) || (lk ? x.F.labK.s.length - y.F.labK.s.length : x.F.labE.s.length - y.F.labE.s.length) || x.ord - y.ord);
      const e = c[0]; const labKey = lk ? 'labK' : 'labE'; const m = mw(e.F[labKey], qj);
      top = { e, worst: 0, sum: 0, info: m ? [{ r: m.r, key: labKey, slot: 0, a: m.a, b: m.b }] : [], un: null };
      if (byKind.page) { byKind.page = byKind.page.filter((h) => h.e !== e && !h.info.every((i) => i.key === 'crK' || i.key === 'crE')); if (!byKind.page.length) delete byKind.page; }   // N-12
      if (byKind.setting) { let inSec = 0; byKind.setting = byKind.setting.filter((h) => { const only = h.info.every((i) => i.key === 'crK' || i.key === 'crE'); if (!(only && h.e.page === e.page)) return true; if (!e.sec || h.e.sec === e.sec) inSec++; return false; }); crumbRows = inSec; if (!byKind.setting.length) delete byKind.setting; }
    }
  }
  // R-03: a help hit (e.g. 초기화 / reset) is the top hit when no setting matches better than a synonym
  if (!top && byKind.help && byKind.help[0].worst <= 4) { const bs = byKind.setting ? Math.min(...byKind.setting.map((h) => h.worst)) : 9; if (bs >= 4) { top = byKind.help[0]; delete byKind.help; } }
  const total = Object.values(counts).reduce((a, x) => a + x, 0) + (top && !hits.includes(top) ? 1 : 0);
  const ms = now() - t0; return { words, hits, byKind, ms, total, counts, top, crumbRows, capped: broad, loose };
}

/* ------------------------------------------------------------------ rows */
function scopeChip(r) {
  if (r.type === 'link' || r.type === 'nav' || r.type === 'note' || r.type === 'key') return '';
  let kind = r.scope || null; const inPreset = PRESET_SECS.has(r.sec);
  if (kind === 'device' && r.id !== 'display.lowPower') kind = null;
  if (inPreset && kind === 'preset') kind = null;                                   // the section line says it once (DS-012)
  if (!kind) return '';
  const map = { device: ['smartphone', t('scopeDevice')], preset: ['bookmark', t('scopePreset', activePreset().name)], chat: ['message-square', t('scopeChat')] };
  const [i, txt] = map[kind]; return `<span class="chip scope-${kind}">${ic(i, 'sm')}<span>${esc(txt)}</span></span>`;
}
function modelOptionsHTML(sel, none) {
  const groups = {}; D.models.forEach((m) => { (groups[m.prov] = groups[m.prov] || []).push(m); });
  return (none ? `<option value="">—</option>` : '') + Object.entries(groups).map(([p, ms]) => `<optgroup label="${esc(mprov(ms[0]))}">${ms.map((m) => `<option value="${esc(m.id)}"${m.id === sel ? ' selected' : ''}>${esc(mn(m))}</option>`).join('')}</optgroup>`).join('');
}
function controlHTML(r, lid) {
  const id = 'c-' + r.id; const v = r.v;
  switch (r.type) {
    case 'switch': return `<span class="sw" data-part="settings-toggle"><input type="checkbox" role="switch" id="${id}" data-ctl ${v ? 'checked' : ''}><span class="sw-ui" aria-hidden="true"></span></span>`;
    case 'select': return `<select id="${id}" data-ctl data-part="settings-field" class="inp">${isModelSelect(r) ? modelOptionsHTML(v, r.id !== 'models.mainModel' && r.id !== 'models.subModel') : r.opt.map((o) => `<option value="${esc(o[0])}"${o[0] === v ? ' selected' : ''}>${esc(S.lang === 'ko' ? o[1] : o[2])}</option>`).join('')}</select>`;
    case 'segmented': return `<div data-part="settings-segmented" class="seg" role="radiogroup" aria-labelledby="${lid}" id="${id}">${r.opt.map((o, i) => `<button type="button" class="seg-b" role="radio" aria-checked="${o[0] === v}" tabindex="${o[0] === v ? 0 : -1}" data-seg="${esc(o[0])}" ${i === 0 ? 'data-ctl' : ''}>${esc(S.lang === 'ko' ? o[1] : o[2])}</button>`).join('')}</div>`;
    case 'slider': return `<div class="sl"><input type="range" id="${id}" data-ctl min="${r.min}" max="${r.max}" step="${r.step}" value="${v}" aria-valuetext="${esc(fmtNum(v) + (r.unit || ''))}"><output for="${id}">${esc(fmtNum(v) + (r.unit || ''))}</output></div>`;
    case 'number': return `<input type="number" inputmode="numeric" id="${id}" data-ctl data-part="settings-field" class="inp num" min="${r.min}" max="${r.max}" value="${v}">`;
    case 'text': return `<input type="text" id="${id}" data-ctl data-part="settings-field" class="inp" value="${esc(v)}" autocomplete="off" spellcheck="false">`;
    case 'secret': return `<input type="${hideKeys() ? 'password' : 'text'}" id="${id}" data-ctl data-secret data-part="settings-field" class="inp" value="${esc(v)}" autocomplete="off" spellcheck="false">`;
    case 'textarea': return `<textarea id="${id}" data-ctl data-part="settings-field" class="inp ta" rows="3" spellcheck="false">${esc(v)}</textarea>`;
    case 'button': return `<button type="button" data-part="settings-button" class="btn solid r-act" id="${id}" data-ctl data-act="${esc(r.act || (r.confirm ? 'confirm' : 'toast'))}" aria-label="${esc(L(r))}" title="${esc(L(r))}">${ic(r.icon || 'chevron-right', 'xl')}</button>`;
    case 'key': return `<span class="keys">${r.combo.split('+').map((k) => `<kbd>${esc(k)}</kbd>`).join('<span class="plus" aria-hidden="true">+</span>')}</span>`;
    default: return '';
  }
}
const studioHref = (kind, ref, sub) => `../studio/slice1.html?from=settings&owner=${kind}:${encodeURIComponent(ref)}${sub ? '&kind=' + sub : ''}`;   // final shape from the main session (kind optional)
function linkRow(id, label, desc, kind, ref, extraCls, sub) {
  return `<div class="row row-link ${extraCls || ''}" data-row="${esc(id)}" data-row-kind="link" data-part="settings-row"><a class="rl" href="${esc(studioHref(kind, ref, sub))}" data-ctl data-kind="${kind}" data-ref="${esc(ref)}"><span class="r-text"><span data-part="settings-row-label" class="r-label">${esc(label)}</span>${desc ? `<span data-part="settings-row-description" class="r-desc">${esc(desc)}</span>` : ''}</span><span class="rl-end"><span class="rl-txt">${esc(t('openInStudio'))}</span>${ic('chevron-right', 'lg')}</span></a></div>`;
}
function navRowHTML(r) {
  let label = L(r), desc = rowDesc(r), trail = '';
  if (r.nk === 'conn') { const tg = ROW[r.target]; label = t('connLabel', r.prov, tg.v ? t('statusSet') : t('statusNone')); trail = t('manageConn'); desc = ''; }
  else if (r.nk === 'model') { const id = ROW['models.sepModels'].v ? ROW[r.target].v : ROW['models.mainModel'].v; label = t('modelLabel', MODEL[id] ? mn(MODEL[id]) : '—'); trail = t('changeInModels'); desc = ''; }
  return `<div class="row row-link" data-row="${esc(r.id)}" data-row-kind="nav" data-part="settings-row"><button type="button" class="rl" data-ctl data-nav="${esc(r.target)}"><span class="r-text"><span data-part="settings-row-label" class="r-label">${esc(label)}</span>${desc ? `<span data-part="settings-row-description" class="r-desc">${esc(desc)}</span>` : ''}</span><span class="rl-end">${trail ? `<span class="rl-txt">${esc(trail)}</span>` : ''}${ic('chevron-right', 'lg')}</span></button></div>`;
}
function rowHTML(r) {
  const lid = 'l-' + r.id, did = 'd-' + r.id, hid = 'h-' + r.id; const ch = isChanged(r); const lab = L(r);
  if (r.type === 'link') return linkRow(r.id, lab, rowDesc(r), r.kind, r.ref === 'ACTIVE' ? activePreset().id : r.ref, '', r.sk);
  if (r.type === 'note') return `<div class="row row-note" data-row="${esc(r.id)}" data-row-kind="note" data-part="settings-row">${ic('info', 'lg')}<p>${esc(lab)}</p></div>`;
  if (r.type === 'nav') return navRowHTML(r);
  const helpText = r.help ? pair(r.help) : ''; let desc = rowDesc(r);
  if (r.id === 'display.lowPower' && S.lpAsked) desc += (desc ? '\n' : '') + t(S.lpState.declined + (S.lpState.on ? 1 : 0) > 1 ? 'lowPowerAskedMany' : 'lowPowerAsked');
  const noStack = ['switch', 'button', 'key'].includes(r.type);
  const stack = r.type === 'textarea' || (S.lay === 'phone' && !noStack) || (!noStack && lab.length > (S.lay === 'wide' ? 38 : 30)) || (r.type === 'segmented' && r.opt.length > 3 && S.lay !== 'wide');
  const menuable = r.d !== undefined;
  return `<div class="row type-${r.type}${stack ? ' stack' : ''}${ch ? ' changed' : ''}" data-row="${esc(r.id)}" data-type="${r.type}" data-part="${r.type === 'switch' ? 'settings-toggle-row' : 'settings-row'}" role="group" aria-labelledby="${lid}"${desc ? ` aria-describedby="${did}"` : ''}>` +
    `<span class="dot" aria-hidden="true"${ch ? '' : ' hidden'}></span><div class="r-main"><div class="r-text"><div class="r-title">` +
    `<span class="r-lw"><label data-part="settings-row-label" class="r-label" id="${lid}" for="c-${esc(r.id)}">${esc(lab)}<span class="sr-only r-chg">${ch ? ' (' + esc(t('changedFromDefault')) + ')' : ''}</span></label>` +
    (helpText ? `<button type="button" data-part="settings-button" class="btn r-info" aria-expanded="false" aria-controls="${hid}" aria-label="${esc(t('helpOfRow', lab))}" title="${esc(t('helpShow'))}">${ic('info', 'lg')}</button>` : '') + `</span>${scopeChip(r)}</div>` +
    (desc ? `<p data-part="settings-row-description" class="r-desc" id="${did}">${esc(desc).replace(/\n/g, '<br>')}</p>` : '') + `</div>` +
    `<div data-part="settings-row-control" class="r-ctl">${controlHTML(r, lid)}</div>` +
    (menuable ? `<button type="button" data-part="settings-button" class="btn r-more${ch ? '' : ' rest'}"${ch ? '' : ' tabindex="-1"'} aria-haspopup="menu" aria-label="${esc(t('moreOfRow', lab))}" title="${esc(t('moreActions'))}">${ic('ellipsis', 'xl')}</button>` : '') + `</div>` +
    (helpText ? `<p class="r-help" id="${hid}" hidden>${esc(helpText)}</p>` : '') + `</div>`;
}
function unavailNoteHTML(r, un) {
  const sw = un.goto ? ROW[un.goto] : null;
  return `<div class="row unavail-note" data-row="${esc(r.id)}" data-row-kind="unavailable" data-part="settings-row" role="group" aria-labelledby="l-${esc(r.id)}" tabindex="-1">${ic('triangle-alert', 'lg')}<div class="un-body"><p data-part="settings-row-label" class="r-label" id="l-${esc(r.id)}">${esc(L(r))}</p><p data-part="settings-row-description" class="r-desc">${esc(un.text)}</p>` +
    (sw ? `<button type="button" data-part="settings-button" class="btn solid un-go" data-goto="${esc(un.goto)}" data-ctl><span>${esc(t('goToSwitch', L(sw)))}</span>${ic('chevron-right', 'md')}</button>` : '') + `</div></div>`;
}

/* ------------------------------------------------------------------ pages */
function thingRow(kind, id, name, sub, active) {
  return `<li><button type="button" class="thing" data-part="settings-list-item" data-thing="${kind}:${esc(id)}"${kind === 'preset' ? ' aria-haspopup="menu"' : ''}${active ? ' aria-current="true"' : ''}><span class="th-ic">${ic(kind === 'preset' ? 'bookmark' : 'user-round', 'lg')}</span><span class="th-t"><span class="th-name">${esc(name)}</span>${sub ? `<span class="th-sub">${esc(sub)}</span>` : ''}</span>${active ? `<span class="th-on">${ic('check', 'md')}<span>${esc(t('active'))}</span></span>` : ''}</button></li>`;
}
function sectionHTML(s, o) {
  const rows = (SECROWS[s.id] || []); const vis = [];
  for (const r of rows) { if (connHidden(r) && o.reveal !== r.id) continue; const un = unavail(r); if (!un) vis.push(rowHTML(r)); else if (o.reveal === r.id) vis.push(unavailNoteHTML(r, un)); }
  let before = '', after = '';
  if (s.id === 'models.connections') { const n = otherCount(); if (n > 0 || S.connExpanded) after = `<div class="row row-link" data-row="conn.more" data-row-kind="link" data-part="settings-row"><button type="button" class="rl" data-conn-toggle data-ctl aria-expanded="${S.connExpanded}"><span class="r-text"><span data-part="settings-row-label" class="r-label">${esc(t('otherServices', n))}</span></span><span class="rl-end">${ic(S.connExpanded ? 'chevron-down' : 'chevron-right', 'lg')}</span></button></div>`; }
  if (s.id === 'models.presets') before = `<p class="count">${esc(t('presetCount', D.presets.length))}</p><ul class="things" id="presetList">${D.presets.map((p) => thingRow('preset', p.id, p.name, mn(MODEL[p.model]), p.id === S.presetActive)).join('')}</ul>`;
  if (s.id === 'persona.main') before = `<p class="count">${esc(t('personaCount', D.personas.length))}</p><ul class="things">${D.personas.map((p) => thingRow('persona', p.id, p.name, pnote(p), p.id === S.personaActive)).join('')}</ul>`;
  if (s.id === 'ext.plugins') after = D.plugins.map((p) => linkRow('plugin.' + p.id, p.name, `v${p.ver} · ${pnote(p)}`, 'plugin', p.id, '', 'plugincode')).join('');
  if (s.id === 'ext.modules') after = S.modules.map((m) => linkRow('module.' + m.id, m.name, pnote(m) || t('newModuleNote'), 'module', m.id)).join('');
  let body = vis.join(''); if (before) body = before + body; if (after) body += after;
  if (X.sectionBody) { const nb = X.sectionBody(s, body, o); if (nb != null) body = nb; }
  if (s.id === 'adv.experimental' && !vis.length) body = `<div class="row row-note" data-empty data-row-kind="note" data-part="settings-row">${ic('info', 'lg')}<p>${esc(t('emptyExperimental'))}</p><button type="button" data-part="settings-button" class="btn solid un-go" data-goto="adv.useExperimental" data-ctl><span>${esc(t('goToSwitch', L(ROW['adv.useExperimental'])))}</span>${ic('chevron-right', 'md')}</button></div>`;
  if (!body) return '';
  if (o.callout && s.id === 'models.models') body = body.replace(/(<div class="row[^"]*" data-row="models\.mainModel"[\s\S]*?<\/div>\s*(?:<p class="r-help"[^>]*>[^<]*<\/p>)?\s*<\/div>)/, `$1${o.callout}`);
  const name = L(s);
  let scopeLine = PRESET_SECS.has(s.id) ? `<p class="sec-scope">${ic('bookmark', 'sm')}<span>${esc(t('scopeSection', activePreset().name))}</span></p>` : '';
  if (X.scopeLine) scopeLine = X.scopeLine(s, scopeLine);
  return `<section class="sec" id="sec-${esc(s.id)}" data-sec="${esc(s.id)}" data-part="settings-section"${name ? ` aria-labelledby="h-${esc(s.id)}"` : ` aria-label="${esc(L(PAGE[s.page]))}"`}>${name ? `<h2 class="sec-h" id="h-${esc(s.id)}" data-part="settings-section-title" tabindex="-1">${esc(name)}</h2>` : ''}${scopeLine}<div class="rows" data-part="settings-rows">${body}</div></section>`;
}
function calloutHTML() {
  const m = MODEL[S.modelCallout]; if (!m) return '';
  return `<div class="callout" id="modelCallout" data-part="settings-callout" role="status">${ic('cpu', 'lg')}<div><p class="co-t">${esc(t('modelFound', mn(m), mprov(m)))}</p><p data-part="settings-row-description" class="r-desc">${esc(t('modelFoundNote'))}</p><button type="button" data-part="settings-button" class="btn solid cal-use" data-model="${esc(m.id)}"><span>${esc(t('useAsMain'))}</span></button></div></div>`;
}
function pageHTML(pid, o) {
  if (X.pageHTML) { const xh = X.pageHTML(pid, o); if (xh != null) return xh; }
  const P = PAGE[pid]; const secs = D.SECTIONS.filter((s) => s.page === pid); const named = secs.filter((s) => L(s));
  let h = `<div class="pg${o.anim ? ' anim' : ''}" data-page="${pid}" data-part="settings-page-body"><div class="pg-head" data-part="settings-page-header"><h1 class="pg-title" id="pgTitle" tabindex="-1">${esc(L(P))}</h1>`;
  if (S.notice) h += `<p class="banner warn" data-part="settings-warning-banner" data-part-critical role="status">${ic('info', 'lg')}<span>${esc(S.notice)}</span></p>`;
  if (P.later) h += `<p class="banner" data-part="settings-banner">${ic('info', 'lg')}<span>${esc(t('redesignLater', pairArr(P.later)))}</span></p>`;
  if (pid === 'keys' && S.lay === 'phone') h += `<p class="banner" data-part="settings-banner">${ic('keyboard', 'lg')}<span>${esc(t('hotkeysPhone'))}</span></p>`;
  h += `</div>`;
  if (named.length > 1) h += `<nav class="chips" data-part="settings-jump-chips" aria-label="${esc(t('sectionNav'))}">${named.map((s) => `<button type="button" class="chip-b" data-secjump="${esc(s.id)}">${esc(L(s))}</button>`).join('')}</nav>`;   // R-18: the jump chips live in the page at every width
  const opts = Object.assign({}, o, { callout: S.modelCallout && pid === 'models' ? calloutHTML() : '' });
  secs.forEach((s) => { h += sectionHTML(s, opts); });
  return h + '</div>';
}
function savePageMem() {   // R-13: each page keeps its scroll and open help for the session
  const sc = $('#pageScroll'); const pg = sc && $('.pg', sc); if (!pg) return; const p = pg.dataset.page;
  S.pageMem[p] = { scroll: sc.scrollTop, help: $$('.r-help:not([hidden])', sc).map((e) => e.closest('[data-row]').dataset.row) };
}
function renderPage(o = {}) {
  const sc = $('#pageScroll'); const keep = o.keepScroll ? sc.scrollTop : 0;
  sc.innerHTML = pageHTML(S.page, o); if (o.keepScroll) sc.scrollTop = keep; else sc.scrollTop = 0;
  const pg = $('.pg', sc); if (pg && o.anim) pg.addEventListener('animationend', () => pg.classList.remove('anim'), { once: true });
  if (X.rendered) X.rendered(pg);
}
function refreshPage(announceRows) {   // re-render keeping scroll, open help and the focused row control (live hide/show of dependent rows)
  if (!S.open) return; const before = $$('#pageScroll [data-row]').length; const a = document.activeElement; const fr = a && a.closest ? a.closest('#pageScroll [data-row]') : null; const fid = fr ? fr.dataset.row : null;
  savePageMem(); const mem = S.pageMem[S.page];
  renderPage({ keepScroll: true });
  if (mem) mem.help.forEach((id) => { const r = $(`#pageScroll [data-row="${CSS.escape(id)}"]`); if (r) toggleHelp(r, true); });
  if (fid) { const el = $(`#pageScroll [data-row="${CSS.escape(fid)}"] [data-ctl]`); if (el) el.focus({ preventScroll: true }); }
  if (announceRows) { const d = $$('#pageScroll [data-row]').length - before; if (d > 0) announce(t('rowsAppeared', d)); else if (d < 0) announce(t('rowsGone', -d)); }
}
function rerenderRow(r) {
  const el = $(`#pageScroll [data-row="${CSS.escape(r.id)}"]`); if (!el) return; const had = el.contains(document.activeElement); const open = $('.r-help:not([hidden])', el);
  const tmp = document.createElement('div'); tmp.innerHTML = rowHTML(r); const nu = tmp.firstElementChild; el.replaceWith(nu);
  if (open) { const hh = $('.r-help', nu), b = $('.r-info', nu); if (hh && b) { hh.hidden = false; b.setAttribute('aria-expanded', 'true'); } }
  if (had) { const c = $('[data-ctl]', nu); if (c) c.focus({ preventScroll: true }); }
}

/* ------------------------------------------------------------------ layout */
function calcLay() {
  const w = $('#app').clientWidth; const N = window.settingsTheme.num; const l = w >= N('--breakpoint-wide') ? 'wide' : w >= N('--breakpoint-mid') ? 'mid' : 'phone';
  if (l !== S.lay) { S.lay = l; return true; } return false;
}
function applyLayoutClasses() {
  root.dataset.layout = S.lay; root.classList.toggle('framed', !!S.frameW);
  if (S.frameW) $('#app').style.setProperty('--frame-w', S.frameW + 'px');
}
function applyView() {
  const phone = S.lay === 'phone'; const body = $('#body'); body.dataset.view = S.view;
  const searching = resultsVisible(); const idx = $('#index'), pg = $('#page'), res = $('#results');
  const setInert = (el, v) => {   // inert at once; visibility:hidden (class .off) after the slide, so no discrete property is ever transitioned
    el.inert = !!v; if (el._offC) el._offC.cancel();
    if (!v) el.classList.remove('off'); else if (S.rm || S.lp) el.classList.add('off'); else el._offC = window.settingsTheme.afterMotion($('#page'), () => el.classList.add('off'), 80);   // the page slide decides when the covered pane may go visibility:hidden (it ends on the transition, whatever the duration token is)
  };
  if (phone) { setInert(idx, S.view === 'page' || searching); setInert(pg, S.view === 'index' || searching); }
  else { setInert(idx, false); setInert(pg, searching); }
  res.hidden = !searching; $('#indexFoot').hidden = phone && (S.view === 'page' || searching);
}

/* ------------------------------------------------------------------ index UI */
function pageSum(p) { const names = D.SECTIONS.filter((s) => s.page === p.id && L(s)).map((s) => L(s)); return names.length ? names.join(' · ') : (PAGE_SUM[p.id] ? PAGE_SUM[p.id][S.lang] : ''); }
function renderIndex() {
  const searching = resultsVisible(); const phone = S.lay === 'phone'; const ixEl = $('#index'); const keepTop = ixEl.scrollTop;
  const fa = document.activeElement; const fk = fa && ixEl.contains(fa) && fa.dataset.page ? '.idx[data-page="' + fa.dataset.page + '"]' : null;
  $('#indexList').innerHTML = D.PAGES.map((p) => {
    const cur = !searching && p.id === S.page && (!phone || S.view === 'page');
    const tab = (!phone && p.id === S.page) || (phone && p.id === D.PAGES[0].id) ? 0 : -1;
    return `<li class="idx-li${cur ? ' cur' : ''}" data-part="settings-index-item"><button type="button" class="idx" data-part="settings-index-link" data-page="${p.id}" tabindex="${tab}"${cur ? ' aria-current="page"' : ''}><span class="idx-ic">${ic(p.icon, 'xl')}</span><span class="idx-n">${esc(L(p))}${phone ? `<span class="idx-sum">${esc(pageSum(p))}</span>` : ''}</span>${phone ? ic('chevron-right', 'lg', 'idx-chev') : ''}</button></li>`;
  }).join('');
  const foot = $('#indexFoot'); if (foot.dataset.lang !== S.lang) { foot.dataset.lang = S.lang; foot.innerHTML = `<button type="button" class="foot-b" data-foot="about">${esc(t('aboutLic'))}</button><button type="button" class="foot-b" data-foot="terms">${esc(t('termsPrivacy'))}</button>`; }
  $('#index').setAttribute('aria-label', t('indexNav'));
  const nt = $('#idxNotice'); if (nt) { nt.hidden = !(phone && S.view === 'index' && S.notice); nt.innerHTML = S.notice ? ic('info', 'lg') + '<span>' + esc(S.notice) + '</span>' : ''; }
  if (fk) { const nf = $(fk, ixEl); if (nf) { $$('.idx', ixEl).forEach((x) => { x.tabIndex = -1; }); nf.tabIndex = 0; nf.focus({ preventScroll: true }); } }   // a re-render never drops focus
  ixEl.scrollTop = keepTop;   // the index scrolls on its own and keeps the selected row in view
  const cur = $('.idx-li.cur', ixEl); if (cur && ixEl.clientHeight && !phone) { const r = cur.getBoundingClientRect(), b = ixEl.getBoundingClientRect(); if (r.bottom > b.bottom - 8) ixEl.scrollTop += r.bottom - b.bottom + 8; else if (r.top < b.top + 8) ixEl.scrollTop -= b.top + 8 - r.top; }
}

/* ------------------------------------------------------------------ header */
function resultsVisible() { return S.resShown; }
function searchActive() { return S.resShown || (S.lay === 'phone' && S.searchOpen) || !!S.resume; }
function renderHeader() {
  const phone = S.lay === 'phone'; const inPage = phone && S.view === 'page'; const on = originName();
  const pend = !!S.resume && !S.resShown; const back = $('#backBtn'); let label = pend ? t('backToResults') : inPage ? t('backToIndex') : t('backTo', on); let vis = pend ? t('backToResultsShort') : on;
  const bo = X.backLabel && !pend ? X.backLabel() : null; if (bo) { label = bo.label; vis = bo.vis; }
  back.innerHTML = ic('arrow-left', 'xl') + (!phone ? `<span class="back-t">${esc(vis)}</span>` : ''); back.setAttribute('aria-label', label); back.title = label;
  let title = inPage ? L(PAGE[S.page]) : t('settings'); const xt = inPage && X.headerTitle ? X.headerTitle() : null; if (xt) title = xt; $('#hdrTitle').textContent = title;
  $('#hdrSub').textContent = pend && phone ? t('queryChip', S.q) : (phone && !inPage ? on : '');
  const q = $('#q'); q.placeholder = t('searchSettings'); q.setAttribute('aria-label', t('searchSettings'));
  $('.s-ic', $('#searchBox')).innerHTML = ic('search', 'lg');
  const clr = $('#qClear'); clr.innerHTML = ic('x', 'md'); clr.setAttribute('aria-label', phone ? t('searchClose') : t('clearField')); clr.title = phone ? t('searchClose') : t('clearField'); clr.hidden = phone ? !S.searchOpen : !S.q;
  const so = $('#searchOpen'); so.innerHTML = ic('search', 'xl'); so.setAttribute('aria-label', t('searchSettings')); so.title = t('searchSettings');
  document.body.classList.toggle('s-open', phone && S.searchOpen); $('#skip').textContent = t('skip'); $('#results').setAttribute('aria-label', t('resultsLabel'));
}

/* ------------------------------------------------------------------ search UI */
const GROUPS = ['setting', 'page', 'preset', 'model', 'connection', 'persona', 'plugin', 'module', 'help'];
function markHTML(F, text, ranges, clip) {
  const spans = ranges.map(([a, b]) => [F.map[a], F.map[b - 1] + 1]).filter((x) => x[0] !== undefined).sort((x, y) => x[0] - y[0]);
  const merged = []; for (const s of spans) { const l = merged[merged.length - 1]; if (l && s[0] <= l[1]) l[1] = Math.max(l[1], s[1]); else merged.push(s.slice()); }
  let start = 0, end = text.length, pre = '', post = '';
  if (clip && text.length > clip && merged.length) { start = Math.max(0, merged[0][0] - 18); end = Math.min(text.length, start + clip); if (start > 0) pre = '…'; if (end < text.length) post = '…'; }
  let out = '', pos = start; for (const [a, b] of merged) { if (b <= start || a >= end) continue; const aa = Math.max(a, start), bb = Math.min(b, end); out += esc(text.slice(pos, aa)) + '<mark>' + esc(text.slice(aa, bb)) + '</mark>'; pos = bb; }
  return pre + out + esc(text.slice(pos, end)) + post;
}
function synTerm(F, a) {   // R-02: only the one synonym word that matched, never the whole bag
  const ti = F.tok[a]; let s = -1, e = -1; for (let i = 0; i < F.tok.length; i++) { if (F.tok[i] === ti) { if (s < 0) s = F.map[i]; e = F.map[i] + 1; } } return s < 0 ? '' : F.txt.slice(s, e);
}
function optHTML(h, i, opt = {}) {
  const e = h.e; const lk = S.lang === 'ko'; const labKey = lk ? 'labK' : 'labE'; const crKey = lk ? 'crK' : 'crE';
  const lr = h.info.filter((x) => x.key === labKey).map((x) => [x.a, x.b]); const cr = h.info.filter((x) => x.key === crKey).map((x) => [x.a, x.b]);
  const labF = e.F[labKey]; const label = markHTML(labF, labF.txt, lr);
  let via = ''; const o = h.info.find((x) => x.key !== labKey && x.key !== crKey && x.key !== 'hid');
  if (o) {
    const F = e.F[o.key];
    if (o.key === 'syn') { const term = synTerm(F, o.a); if (term) via = `<span class="o-via">${esc(t('matchedVia', term)).replace(esc(term), '<mark>' + esc(term) + '</mark>')}</span>`; }
    else { const mine = h.info.filter((x) => x.key === o.key).map((x) => [x.a, x.b]); via = `<span class="o-via">${markHTML(F, F.txt, mine, 60)}</span>`; }
  }
  const crF = e.F[crKey]; const crumb = crF.s ? markHTML(crF, crF.txt, cr) : '';
  let val = '', reason = '';
  if (e.k === 'setting') { if (h.un) reason = `<span class="o-reason" id="ssreason-${i}">${esc(h.un.text)}</span>`; else { const vt = valueText(e.row); if (vt) val = `<span class="o-val">${esc(vt)}</span>`; } }
  if (e.k === 'preset') val = `<span class="o-val">${esc(mn(MODEL[e.ref.model]))}</span>`;
  if (e.k === 'model') val = `<span class="o-val">${esc(mprov(e.ref))}</span>`;
  if (e.k === 'connection') val = `<span class="o-val">${esc(ROW[e.ref.row].v ? t('statusSet') : t('statusNone'))}</span>`;
  if (e.k === 'persona') val = `<span class="o-val">${esc(pnote(e.ref))}</span>`;
  if (e.k === 'help') { via = ''; }
  const un = h.un ? ' unav' : '';
  return `<div class="opt${un}${opt.top ? ' top' : ''}" data-part="settings-result" role="option" id="ssopt-${i}" data-i="${i}" aria-selected="false"${h.un ? ` aria-disabled="true" aria-describedby="ssreason-${i}"` : ''}><span class="o-ic">${ic(e.ico, 'lg')}</span><span class="o-main"><span class="o-lab">${label}</span>${via}<span class="o-crumb">${crumb}</span>${reason}</span>${val}</div>`;
}
function renderResults(res) {
  const sc = $('#resScroll'); S.hits = []; let html = ''; const raw = S.q.trim(); const q = $('#q');
  if (!res.total) {
    html = `<div class="nores" data-part="settings-no-results"><p class="nores-t">${esc(t('noResults', raw))}</p><div class="nores-b"><button type="button" data-part="settings-button" class="btn solid" data-nr="clear">${ic('x', 'lg')}<span>${esc(t('clearSearch'))}</span></button><button type="button" data-part="settings-button" class="btn solid" data-nr="browse">${ic('sliders-horizontal', 'lg')}<span>${esc(t('browseAll'))}</span></button></div></div>`;
    sc.innerHTML = html; q.removeAttribute('aria-controls'); return;
  }
  html = (res.loose ? `<p class="loose-note" role="note">${esc(t('looseNote'))}</p>` : '') + `<div role="listbox" id="resList" aria-label="${esc(t('resultsLabel'))}">`;
  if (res.top) {
    html += `<div class="grp" data-part="settings-result-group" role="group" aria-labelledby="g-top"><div class="g-head" id="g-top"><span>${esc(t('grp').top)}</span></div>`;
    S.hits.push({ h: res.top, more: null, top: true }); html += optHTML(res.top, S.hits.length - 1, { top: true });
    if (res.crumbRows > 0) { S.hits.push({ h: null, more: 'crumb' }); html += `<div class="opt more" data-part="settings-result" role="option" id="ssopt-${S.hits.length - 1}" data-i="${S.hits.length - 1}" aria-selected="false"><span class="o-ic">${ic('chevron-right', 'lg')}</span><span class="o-main"><span class="o-lab">${esc(t('sectionRows', res.crumbRows))}</span></span></div>`; }
    html += `</div>`;
  }
  for (const k of GROUPS) {
    const arr = res.byKind[k]; if (!arr) continue; const exp = S.expanded.has(k); const shown = exp ? arr : arr.slice(0, 5);
    const n = (res.capped && res.counts[k] > arr.length) ? arr.length + '+' : String(arr.length);
    html += `<div class="grp" data-part="settings-result-group" role="group" aria-labelledby="g-${k}"><div class="g-head" id="g-${k}"><span>${esc(t('grp')[k])}</span><span class="g-n">${n}</span></div>`;
    shown.forEach((h) => { S.hits.push({ h, more: null }); html += optHTML(h, S.hits.length - 1); });
    if (!exp && arr.length > 5) { S.hits.push({ h: null, more: k }); html += `<div class="opt more" data-part="settings-result" role="option" id="ssopt-${S.hits.length - 1}" data-i="${S.hits.length - 1}" aria-selected="false"><span class="o-ic">${ic('chevron-down', 'lg')}</span><span class="o-main"><span class="o-lab">${esc(t('showAll', n))}</span></span></div>`; }
    html += `</div>`;
  }
  html += `</div>`; sc.innerHTML = html; q.setAttribute('aria-controls', 'resList');
}
function setActive(i, scroll = true) {
  const list = $$('#resList .opt'); list.forEach((o) => { const on = +o.dataset.i === i; o.classList.toggle('act', on); o.setAttribute('aria-selected', on ? 'true' : 'false'); });
  S.activeOpt = i; const q = $('#q'); const el = i >= 0 ? $('#ssopt-' + i) : null;
  if (el) { q.setAttribute('aria-activedescendant', el.id); if (scroll) el.scrollIntoView({ block: 'nearest' }); } else q.removeAttribute('aria-activedescendant');
}
let liveT = 0;
function runSearch() {
  const raw = S.q; const t0 = now(); const had = !$('#results').hidden;
  if (!raw.trim()) { hideResults(); return; }
  const res = search(raw); S.res = res; S.resShown = true; renderResults(res);
  const q = $('#q'); q.setAttribute('aria-expanded', res.total ? 'true' : 'false'); if (!had) { $$('.idx-li.cur').forEach((l) => { l.classList.remove('cur'); const bb = $('.idx', l); bb.removeAttribute('aria-current'); }); }
  $('#results').hidden = false; applyView(); setActive(res.total ? 0 : -1, false);
  const ms = now() - t0; perf.lastFilter = ms; perf.samples.push(+ms.toFixed(2)); if (perf.samples.length > 100) perf.samples.shift();
  clearTimeout(liveT); liveT = setTimeout(() => { $('#live').textContent = res.total ? t('resultsCount', res.total) : t('noResults', raw.trim()); }, 500);
}
function hideResults() {   // hides the results; the query stays (clearing it is closeSearch)
  const had = !$('#results').hidden; S.res = null; S.hits = null; S.activeOpt = -1; S.resShown = false; $('#results').hidden = true; const q = $('#q'); q.setAttribute('aria-expanded', 'false'); q.removeAttribute('aria-activedescendant'); q.removeAttribute('aria-controls'); $('#resScroll').innerHTML = '';
  clearTimeout(liveT); if (had) { renderIndex(); } applyView();
}
function setQuery(v, { run = true } = {}) {
  S.q = v; $('#q').value = v; S.resume = null; $('#qClear').hidden = S.lay === 'phone' ? !S.searchOpen : !v; if (run) runSearch();
}
function openSearchPhone() { S.searchOpen = true; renderHeader(); const q = $('#q'); q.focus(); }
function closeSearch(focusTo) {   // clear and close in one step (Back stack)
  const was = searchActive(); S.searchOpen = false; S.q = ''; S.resume = null; $('#q').value = ''; S.expanded.clear(); hideResults(); renderHeader(); applyView();
  if (focusTo !== false && was) { const f = focusTo || (S.lay === 'phone' ? $('#searchOpen') : $('.idx[tabindex="0"]')); if (f) f.focus({ preventScroll: true }); }
}
function resumeSearch() {   // R-06: Back from a page opened from search returns to the results with that hit active
  const r = S.resume; S.resume = null; if (S.lay === 'phone') S.searchOpen = true; renderHeader(); runSearch();
  if (S.hits && S.hits.length) setActive(Math.min(r ? r.i : 0, S.hits.length - 1)); $('#q').focus({ preventScroll: true });
}
function activateOpt(i) {
  const it = S.hits && S.hits[i]; if (!it) return;
  if (it.more === 'crumb') { const top = S.res.top; if (top) openEntry(top, i); return; }
  if (it.more) { S.expanded.add(it.more); const keep = i; renderResults(S.res); setActive(keep, false); $('#q').focus(); const g = S.res.byKind[it.more]; $('#live').textContent = t('resultsCount', g ? g.length : 0); return; }
  openEntry(it.h, i);
}
function openEntry(h, i) {
  const e = h.e; const helpHit = h.info.some((x) => x.key === 'hK' || x.key === 'hE');
  if (e.k === 'action' && X.action) { const op = document.activeElement; closeSearch(false); X.action(e.id, op); return; }
  if (e.k === 'help') { openDialog({ title: t('helpResetTitle'), body: `<p>${esc(t('helpResetBody'))}</p>`, buttons: [{ id: 'ok', label: t('close'), primary: true }] }); openDialog.handlers = {}; return; }
  S.resume = { i: i === undefined ? 0 : i }; S.searchOpen = false; hideResults();   // R-06: the query stays in the field
  if (e.k === 'preset' && X.openPreset) return X.openPreset(e.thing);
  if (e.k === 'setting') return openRow(e.row, { help: helpHit, fromSearch: true });
  if (e.k === 'page') return showPage(e.page, { section: e.sec || null, focusHead: true, fromSearch: true });
  if (e.k === 'model') { S.modelCallout = e.thing; showPage('models', { section: 'models.models', row: ROW['models.mainModel'], fromSearch: true, anim: S.page !== 'models' }); return; }
  if (e.k === 'connection') { const r = ROW[e.ref.row]; return openRow(r, { fromSearch: true }); }
  showPage(e.page, { section: e.sec, thing: e.k + ':' + e.thing, fromSearch: true });
}

/* ------------------------------------------------------------------ origin stub */
function msgHTML() {
  const ko = ['달빛이 숲길 위로 내려앉았어요. 세라핀은 낡은 등불을 들고 천천히 걸음을 옮겼어요.', '“오늘은 늦게까지 걸어야 할 것 같아요. 괜찮으시겠어요?”', '저는 고개를 끄덕이며 어깨에 멘 가방을 고쳐 멨어요.', '“그럼 서둘러요. 저 언덕 너머에 쉴 곳이 있다고 들었어요.”', '길 양쪽의 나무들이 바람에 흔들리며 낮은 소리를 냈어요.', '“들리세요? 마치 누군가 이야기를 속삭이는 것 같아요.”', '우리는 잠시 멈춰 서서 숲의 소리에 귀를 기울였어요.', '“조금만 더 가면 돼요. 발밑을 조심하세요.”', '언덕 위에서 작은 불빛이 깜박이기 시작했어요.', '“저기예요! 저 불빛을 따라가요.”', '세라핀의 목소리에는 안도감이 묻어 있었어요.', '“다음에는 어디로 가고 싶으세요?”'];
  const en = ['Moonlight settled over the forest road. Seraphina lifted an old lantern and walked on slowly.', '"We may have to walk late tonight. Is that all right?"', 'I nodded and shifted the bag on my shoulder.', '"Then let us hurry. I heard there is a place to rest beyond that hill."', 'The trees on both sides swayed in the wind and made a low sound.', '"Can you hear it? It is as if someone were whispering a story."', 'We stopped for a moment and listened to the forest.', '"Just a little further. Watch your step."', 'A small light began to flicker on top of the hill.', '"There! Follow that light."', 'Relief was in Seraphina’s voice.', '"Where would you like to go next?"'];
  const L2 = S.lang === 'ko' ? ko : en; return L2.concat(L2).map((m, i) => `<p class="o-msg${i % 2 ? ' u' : ''}">${esc(m)}</p>`).join('');
}
function buildOrigin() {
  const o = $('#origin'); const keepDraft = $('#oDraft') ? $('#oDraft').value : S.draft; if (keepDraft != null) S.draft = keepDraft;
  o.setAttribute('aria-label', originName()); o.dataset.from = S.from;
  const settingsBtn = `<button type="button" data-part="settings-button" class="btn" id="oSettings" aria-label="${esc(t('settings'))}" title="${esc(t('settings'))}">${ic('settings', 'xl')}</button>`;
  if (S.from === 'chat') {
    o.innerHTML = `<header class="o-hdr"><span class="o-av" aria-hidden="true">${esc(t('chatName')[0])}</span><strong class="o-name">${esc(t('chatName'))}</strong><span class="o-gen" id="oGen">${esc(t('genStatus', S.gen.chars))}</span>${settingsBtn}</header>` +
      `<div class="o-scroll" id="oScroll" tabindex="0" role="log" aria-label="${esc(t('msgsLabel'))}">${msgHTML()}</div>` +
      `<div class="lp-card" id="lpCard" role="region" aria-label="${esc(t('lowPower'))}" hidden>${ic('zap', 'lg')}<p>${esc(t('lowPowerSuggest'))}</p><button type="button" data-part="settings-button" class="btn solid" id="lpYes">${ic('zap', 'md')}<span>${esc(t('turnOn'))}</span></button><button type="button" data-part="settings-button" class="btn" id="lpNo" aria-label="${esc(t('noThanks'))}" title="${esc(t('noThanks'))}">${ic('x', 'lg')}</button></div>` +
      `<div class="o-comp"><textarea id="oDraft" rows="2" aria-label="${esc(t('composerLabel'))}" placeholder="${esc(t('composerPh'))}"></textarea><button type="button" data-part="settings-button" class="btn" id="oSend" aria-label="${esc(t('send'))}" title="${esc(t('send'))}">${ic('send', 'xl')}</button></div>`;
    const d = $('#oDraft'); d.value = S.draft != null ? S.draft : t('draftDefault'); S.draft = d.value;
    d.addEventListener('input', () => { S.draft = d.value; });
  } else {
    const items = S.from === 'home' ? t('homeTiles') : t('studioItems');
    o.innerHTML = `<header class="o-hdr"><span class="o-av" aria-hidden="true">${ic(S.from === 'home' ? 'house' : 'wand', 'md')}</span><strong class="o-name">${esc(S.from === 'home' ? t('originHome') : t('originStudio'))}</strong>${settingsBtn}</header>` +
      `<div class="o-scroll" id="oScroll" tabindex="0"><h2 class="o-h">${esc(t('recent'))}</h2><ul class="o-list">${items.concat(items, items, items).map((x) => `<li><button type="button" data-part="settings-button" class="btn solid o-tile">${esc(x)}</button></li>`).join('')}</ul></div>` +
      `<div class="lp-card" id="lpCard" role="region" aria-label="${esc(t('lowPower'))}" hidden></div>`;
  }
  updateLpCard();
  if (X.origin) X.origin(o);
}
const gotChat = () => S.from === 'chat';
function updateLpCard() { const c = $('#lpCard'); if (!c) return; c.hidden = !(S.lpPending && !S.lp && gotChat()); }
/* R-24: guard rails and re-arm for the slow-screen suggestion. The decision model is pure so the checks can drive it with synthetic frame times and clocks. */
const lpEligible = (nowMs) => !S.lp && !S.lpState.on && (S.lpState.declined === 0 || (S.lpState.declined <= 2 && nowMs - S.lpState.last >= 30 * LP_DAY));
function lpSave() { syncAsked(); if (!hermetic) store.set('lpState', JSON.stringify(S.lpState)); }
function answerLp(turnOn, nowMs) {
  S.lpPending = false; if (turnOn) { S.lpState.on = true; lpSave(); setLowPower(true); } else { S.lpState.declined += 1; S.lpState.last = nowMs === undefined ? Date.now() : nowMs; lpSave(); }
  updateLpCard(); if (S.open) rerenderRowById('display.lowPower');
  const f = $('#oSettings') || $('#oSend'); if (f && S.from === 'chat' && !S.open) f.focus();
}
function triggerSlow(nowMs) { if (!lpEligible(nowMs === undefined ? Date.now() : nowMs)) return false; S.lpPending = true; updateLpCard(); return true; }
function createSampler(opts = {}) {   // frame-time sampler: 30 % of frames over 50 ms in two 10 s windows in a row; ignores the first/resumed 10 s, hidden time and single frames over 1 s; only while the chat streams or scrolls
  const st = { resumeAt: (opts.start || 0) + 10000, elapsed: 0, frames: 0, slow: 0, consec: 0, active: false };
  const reset = () => { st.elapsed = 0; st.frames = 0; st.slow = 0; };
  return {
    st, setActive(v) { st.active = !!v; if (!v) { reset(); st.consec = 0; } },
    resume(tm) { st.resumeAt = tm + 10000; reset(); st.consec = 0; },
    feed(dt, tm, hidden) {
      if (!st.active || hidden || tm < st.resumeAt || dt > 1000) return null;
      st.frames++; st.elapsed += dt; if (dt > 50) st.slow++;
      if (st.elapsed >= 10000) { const slowWin = st.slow / st.frames > 0.3; reset(); st.consec = slowWin ? st.consec + 1 : 0; if (st.consec >= 2) { st.consec = 0; return 'slow'; } }
      return null;
    },
  };
}
function startLiveSampler() {   // opt-in with ?sampler=1; runs only while the chat stub is shown and generating
  const sm = createSampler({ start: performance.now() }); window.__ss1sampler = sm; let last = performance.now();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sm.resume(performance.now()); });
  const tick = (tm) => { const dt = tm - last; last = tm; sm.setActive(S.from === 'chat' && !S.open && S.gen.chars < 4000); if (sm.feed(dt, tm, document.hidden) === 'slow') triggerSlow(); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}
function rerenderRowById(id) { const r = ROW[id]; if (r) rerenderRow(r); }

/* ------------------------------------------------------------------ dialogs, menus, toast */
let dlgReturn = null, menuState = null;
function toast(msg) { const el = $('#toast'); el.textContent = msg; el.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => { el.classList.remove('on'); }, 2600); }
function openDialog({ title, body, buttons, onClose, initial, critical }) {
  const crit = critical === undefined ? buttons.some((b) => b.danger) : !!critical;   // DD-149: a dialog with a danger button is critical by default; critical: true opts in (an ask that moves or drops data), critical: false opts out
  const PN = crit ? { t: 'settings-critical-title', b: 'settings-critical-body', f: 'settings-critical-actions', a: 'settings-critical-action' } : { t: 'settings-dialog-title', b: 'settings-dialog-body', f: 'settings-dialog-actions', a: 'settings-button' };
  closeMenu(); dlgReturn = document.activeElement; const layer = $('#layer');
  const back = document.createElement('div'); back.className = 'dlg-back'; back.setAttribute('data-part', 'settings-dialog-backdrop'); if (crit) back.setAttribute('data-part-critical', '');
  back.innerHTML = `<div class="dlg" ${crit ? 'data-part-critical ' : ''}data-part="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="dlgT"><h2 class="dlg-t" id="dlgT" data-part="${PN.t}">${esc(title)}</h2><div class="dlg-b" data-part="${PN.b}">${body}</div><div class="dlg-f" data-part="${PN.f}">${buttons.map((b) => `<button type="button" class="btn ${b.primary ? 'accent solid' : b.danger ? 'danger solid' : 'solid'}" data-part="${PN.a}" data-dlg="${b.id}"${b.disabled ? ' aria-disabled="true"' : ''}>${b.icon ? ic(b.icon, 'md') + '<span>' + esc(b.label) + '</span>' : esc(b.label)}</button>`).join('')}</div></div>`;
  layer.appendChild(back); document.body.classList.add('dlg-open');
  // The modal contract lives in script, not in a stylesheet: if a pack's rule hides the backdrop or the dialog (display none, visibility hidden), the script puts them back, so focus, the Tab trap and Escape still work (T-02).
  [back, back.firstElementChild].forEach((e, i) => { const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden') { e.style.setProperty('display', i ? 'block' : 'grid', 'important'); e.style.setProperty('visibility', 'visible', 'important'); } });
  const docEsc = (ev) => { if (ev.key === 'Escape' && !back.contains(ev.target) && openDialog.cur === close) { ev.preventDefault(); ev.stopPropagation(); close('cancel'); } };   // focus outside the dialog (a hidden backdrop dropped it to body): Escape still closes it
  document.addEventListener('keydown', docEsc, true);
  const prevInert = ['#settings', '#origin'].map((s) => [$(s), $(s).inert]); prevInert.forEach(([e]) => { e.inert = true; });   // R-20: the rest of the page is inert while the modal is open
  const close = (why) => { openDialog.cur = null; document.removeEventListener('keydown', docEsc, true); back.remove(); document.body.classList.remove('dlg-open'); prevInert.forEach(([e, v]) => { e.inert = v; }); const r = dlgReturn; dlgReturn = null; if (why === 'cancel') S.homePending = false; /* cancelling the guard dialog cancels the trip home it was holding back */ if (onClose) onClose(why); if (r && r.isConnected) r.focus({ preventScroll: true }); };
  back.addEventListener('click', (ev) => { const b = ev.target.closest('[data-dlg]'); if (b) { if (b.getAttribute('aria-disabled') === 'true') return; const res = openDialog.handlers && openDialog.handlers[b.dataset.dlg]; if (res) { if (res() === false) return; } close(b.dataset.dlg); } else if (ev.target === back) close('cancel'); });
  back.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); close('cancel'); return; }
    if (ev.key === 'Tab') { const f = $$('button:not([aria-disabled="true"]), input, a[href]', back); if (!f.length) return; const first = f[0], last = f[f.length - 1]; if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); } else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); } }
  });
  openDialog.cur = close;
  const init = initial ? $(initial, back) : $('[data-dlg]', back); (init || $('[data-dlg]', back)).focus();
  return { back, close };
}
function confirmDialog(r) {
  const text = pair(r.confirm); const d = openDialog({ critical: true, title: L(r), body: `<p>${esc(text)}</p>`, buttons: [{ id: 'cancel', label: t('cancel') }, { id: 'ok', label: t('confirm'), danger: true }], initial: '[data-dlg="cancel"]' });
  openDialog.handlers = { ok: () => { toast(t('simulated', L(r))); } }; void d;
}
function moduleDialog() {
  const d = openDialog({ title: t('moduleNameFirst'), body: `<label class="dlg-l" for="modName">${esc(t('moduleName'))}</label><input id="modName" data-part="settings-field" class="inp" type="text" autocomplete="off" spellcheck="false"><p class="dlg-hint" id="modHint">${esc(t('moduleNameNeeded'))}</p>`, buttons: [{ id: 'cancel', label: t('cancel') }, { id: 'create', label: t('create'), primary: true, disabled: true }], initial: '#modName' });
  const inp = $('#modName', d.back), btn = $('[data-dlg="create"]', d.back);
  inp.addEventListener('input', () => { const ok = !!inp.value.trim(); btn.setAttribute('aria-disabled', ok ? 'false' : 'true'); $('#modHint', d.back).hidden = ok; });
  inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && !ev.isComposing && ev.keyCode !== 229 && inp.value.trim()) { ev.preventDefault(); btn.click(); } });
  openDialog.handlers = { create: () => { const name = inp.value.trim(); if (!name) return false; const m = { id: 'mx' + (S.modules.length + 1), name, note: '' }; S.modules.push(m); buildIndex(); S.createdModule = m.id; setTimeout(() => { if (S.open && S.page === 'ext') { renderPage({ keepScroll: true }); const a = $(`[data-row="module.${m.id}"] a`); if (a) { a.focus({ preventScroll: true }); a.scrollIntoView({ block: 'center' }); } } toast(t('moduleMade', name)); }, 0); } };
  return d;
}
function infoDialog(kind) { openDialog({ title: kind === 'about' ? t('aboutLic') : t('termsPrivacy'), body: `<p>${esc(t('aboutBody'))}</p>`, buttons: [{ id: 'ok', label: t('close'), primary: true }] }); openDialog.handlers = {}; }

function closeMenu(refocus) { if (!menuState) return; const m = menuState; menuState = null; m.el.remove(); document.removeEventListener('pointerdown', m.out, true); if (refocus && m.opener && m.opener.isConnected) m.opener.focus({ preventScroll: true }); }
function showMenu(items, anchor, point, opener, aria) {   // items: [{ icon, label, disabled, fn, href }]
  closeMenu(); const el = document.createElement('div'); el.className = 'menu'; el.setAttribute('data-part', 'settings-menu'); el.setAttribute('role', 'menu'); el.setAttribute('aria-label', aria);
  el.innerHTML = items.map((it, i) => it.href ? `<a role="menuitem" class="mi" data-part="settings-menu-item" href="${esc(it.href)}" tabindex="-1" data-mi="${i}">${ic(it.icon, 'md')}<span>${esc(it.label)}</span></a>` : `<button type="button" role="menuitem" class="mi" data-part="settings-menu-item" ${it.disabled ? 'aria-disabled="true"' : ''} tabindex="-1" data-mi="${i}">${ic(it.icon, 'md')}<span>${esc(it.label)}</span></button>`).join('');
  $('#layer').appendChild(el); const ar = anchor ? anchor.getBoundingClientRect() : { left: point.x, right: point.x, bottom: point.y, top: point.y };
  const app = $('#app').getBoundingClientRect(); const w = el.offsetWidth, h = el.offsetHeight;
  let x = (anchor ? ar.right - w : ar.left); let y = ar.bottom + window.settingsTheme.num('--popup-gap'); const pe = window.settingsTheme.num('--popup-edge'), pg = window.settingsTheme.num('--popup-gap'); x = Math.max(app.left + pe, Math.min(x, app.right - w - pe)); if (y + h > innerHeight - pe) y = Math.max(pe, ar.top - h - pg);
  el.style.left = x + 'px'; el.style.top = y + 'px';
  const mis = $$('.mi', el); mis[0].focus();
  const out = (ev) => { if (!el.contains(ev.target)) closeMenu(false); };
  document.addEventListener('pointerdown', out, true);
  menuState = { el, out, opener: opener || anchor };
  el.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); closeMenu(true); } else if (ev.key === 'Tab') { ev.preventDefault(); closeMenu(true); }
    else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); const i = mis.indexOf(document.activeElement); mis[(i + (ev.key === 'ArrowDown' ? 1 : -1) + mis.length) % mis.length].focus(); }
  });
  el.addEventListener('click', (ev) => { const mi = ev.target.closest('.mi'); if (!mi || mi.getAttribute('aria-disabled') === 'true') return; const it = items[+mi.dataset.mi]; closeMenu(false); if (it.fn) it.fn(); });
}
function openMenu(r, anchor, point, opener) { showMenu([{ icon: 'rotate-ccw', label: t('resetToDefault'), disabled: !isChanged(r), fn: () => resetRow(r) }], anchor, point, opener, t('moreOfRow', L(r))); }
function openThingMenu(btn) {   // R-15: opening a preset row never switches at once
  const id = btn.dataset.thing.split(':')[1]; const p = D.presets.find((x) => x.id === id);
  showMenu([{ icon: 'check', label: t('switchPreset'), fn: () => { S.presetActive = id; renderPage({ keepScroll: true }); const b = $(`[data-thing="preset:${id}"]`); if (b) b.focus({ preventScroll: true }); toast(t('switchedTo', activePreset().name)); } }, { icon: 'wand', label: t('openInStudio'), href: studioHref('preset', id) }], btn, null, btn, t('presetMenu', p ? p.name : id));
}
function resetRow(r) {
  r.v = r.d; onRowChanged(r); rerenderRow(r); const c = $(`#pageScroll [data-row="${CSS.escape(r.id)}"] [data-ctl]`); if (c) c.focus({ preventScroll: true });
}

/* ------------------------------------------------------------------ row events */
function applyFlags() {
  const rmRow = ROW['display.reducedMotion'].v; const rm = rmRow === 'on' ? true : rmRow === 'off' ? false : (S.rmSys || S.rmDemo);
  S.rm = !!rm; root.classList.toggle('rm', S.rm); root.classList.toggle('nexus-low-power', S.lp); root.classList.toggle('big', S.big);
  const sp = ROW['display.animSpeed'].v || 0.4; root.style.setProperty('--risu-animation-speed', String(sp / 0.4));   // today's default 0.4 = 1x
}
function setLowPower(v) { S.lp = !!v; ROW['display.lowPower'].v = !!v; applyFlags(); updateDemo(); updateLpCard(); const el = $('#pageScroll [data-row="display.lowPower"]'); if (el) rerenderRow(ROW['display.lowPower']); }
function setLang(l) {
  S.lang = l; root.lang = l; ROW['lang.ui'].v = l; buildOrigin(); renderIndex(); renderHeader(); if (S.open && D.PAGES) renderPage({ keepScroll: true }); buildDemo(); if (resultsVisible()) runSearch(); if (X.title) document.title = X.title(l); else document.title = l === 'ko' ? '설정 슬라이스 1 · 목업' : 'Settings slice 1 · mockup';
  if (X.lang) X.lang(l);
}
function onRowChanged(r) {
  if (X.rowChanged) X.rowChanged(r);
  switch (r.id) {
    case 'display.lowPower': S.lp = !!r.v; applyFlags(); updateDemo(); updateLpCard(); break;
    case 'display.reducedMotion': case 'display.animSpeed': applyFlags(); updateDemo(); break;
    case 'lang.ui': if (r.v === 'ko' || r.v === 'en') setLang(r.v); else { r.v = S.lang; toast(t('simulated', L(r))); } break;
    case 'models.hideApiKey': $$('#pageScroll [data-secret]').forEach((i) => { i.type = r.v ? 'password' : 'text'; }); break;
    case 'models.mainModel': updateDemo(); refreshPage(true); break;
    case 'adv.useExperimental': updateDemo(); refreshPage(true); break;
    default: if (DEPT.has(r.id)) refreshPage(true); break;   // R-09: dependent rows hide and show live
  }
}
function syncChanged(r, el) {
  const ch = isChanged(r); el.classList.toggle('changed', ch); const dot = $('.dot', el); if (dot) dot.hidden = !ch;
  const sr = $('.r-chg', el); if (sr) sr.textContent = ch ? ' (' + t('changedFromDefault') + ')' : '';
  const mb = $('.r-more', el); if (mb) { mb.classList.toggle('rest', !ch); mb.tabIndex = ch ? 0 : -1; }
}
function rowOf(el) { const re = el.closest('[data-row]'); return re ? { r: ROW[re.dataset.row], el: re } : null; }
const ENTRY_SEL = 'input,textarea,select,[contenteditable]';
function bindPageEvents() {
  const sc = $('#pageScroll');
  sc.addEventListener('input', (ev) => {
    const x = rowOf(ev.target); if (!x || !x.r) return; const { r, el } = x; const tg = ev.target;
    if (r.type === 'slider') { r.v = +tg.value; const txt = fmtNum(r.v) + (r.unit || ''); $('output', el).textContent = txt; tg.setAttribute('aria-valuetext', txt); }
    else if (r.type === 'number') { const n = parseFloat(tg.value); if (!isNaN(n)) r.v = n; }
    else if (r.type === 'text' || r.type === 'secret' || r.type === 'textarea') r.v = tg.value;
    else return;
    syncChanged(r, el); onRowChanged(r);
  });
  sc.addEventListener('change', (ev) => {
    const x = rowOf(ev.target); if (!x || !x.r) return; const { r, el } = x; const tg = ev.target;
    if (r.type === 'switch') r.v = tg.checked; else if (r.type === 'select') r.v = tg.value; else return;
    syncChanged(r, el); onRowChanged(r);
  });
  sc.addEventListener('click', (ev) => {
    const tg = ev.target; if (!(tg instanceof Element)) return;
    const info = tg.closest('.r-info'); if (info) { const row = info.closest('[data-row]'); toggleHelp(row); return; }
    const more = tg.closest('.r-more'); if (more) { const x = rowOf(more); openMenu(x.r, more, null, more); return; }
    const seg = tg.closest('[data-seg]'); if (seg) { const x = rowOf(seg); setSeg(x, seg.dataset.seg); return; }
    const act = tg.closest('[data-act]'); if (act) { const x = rowOf(act); if (act.dataset.act === 'module-new') moduleDialog(); else if (act.dataset.act === 'confirm') confirmDialog(x.r); else toast(t('simulated', L(x.r))); return; }
    const ct = tg.closest('[data-conn-toggle]'); if (ct) { S.connExpanded = !S.connExpanded; refreshPage(); const b = $('[data-conn-toggle]'); if (b) b.focus({ preventScroll: true }); return; }
    const nav = tg.closest('[data-nav]'); if (nav) { const from = rowOf(nav); openRow(ROW[nav.dataset.nav], { fromSearch: false, fromJump: true }); if (from) S.retRow = from.r.id; return; }
    const go = tg.closest('[data-goto]'); if (go) { const from = rowOf(go); openRow(ROW[go.dataset.goto], { fromJump: true }); if (from && !from.el.matches('[data-empty]')) S.retRow = from.r.id; return; }
    const sj = tg.closest('[data-secjump]'); if (sj) { jumpSection(sj.dataset.secjump); return; }
    const th = tg.closest('[data-thing]'); if (th) { const [k, id] = th.dataset.thing.split(':'); if (k === 'preset') openThingMenu(th); else if (k === 'persona') { S.personaActive = id; renderPage({ keepScroll: true }); const b = $(`[data-thing="persona:${id}"]`); if (b) b.focus({ preventScroll: true }); } return; }
    const cu = tg.closest('.cal-use'); if (cu) { ROW['models.mainModel'].v = cu.dataset.model; S.modelCallout = null; toast(t('mainSet')); onRowChanged(ROW['models.mainModel']); return; }
  });
  sc.addEventListener('keydown', (ev) => {
    const seg = ev.target.closest && ev.target.closest('[data-seg]');
    if (seg && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(ev.key)) {
      const grp = seg.parentElement; const bs = $$('[data-seg]', grp); let i = bs.indexOf(seg);
      i = ev.key === 'Home' ? 0 : ev.key === 'End' ? bs.length - 1 : (i + (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp' ? -1 : 1) + bs.length) % bs.length;
      ev.preventDefault(); const x = rowOf(seg); setSeg(x, bs[i].dataset.seg, true); return;
    }
    if ((ev.key === 'F10' && ev.shiftKey) || ev.key === 'ContextMenu') {
      const tgt = ev.target; if (tgt.matches && tgt.matches('textarea,select,input[type=text],input[type=number],input[type=password],[contenteditable]')) return;   // R-11: text entry keeps its native menu; ⋯ stays reachable
      const x = rowOf(tgt); if (x && x.r && x.r.d !== undefined) { ev.preventDefault(); ev.stopPropagation(); const c = $('[data-ctl]', x.el) || tgt; openMenu(x.r, null, { x: c.getBoundingClientRect().left, y: c.getBoundingClientRect().bottom }, c); }
    }
  });
  sc.addEventListener('contextmenu', (ev) => {
    if (ev.target.closest(ENTRY_SEL)) return;   // R-11: never replace the native menu of an input, textarea, select or contenteditable
    const x = rowOf(ev.target); if (!x || !x.r || x.r.d === undefined) return; ev.preventDefault();
    openMenu(x.r, null, { x: ev.clientX, y: ev.clientY }, $('[data-ctl]', x.el));
  });
  // long-press (touch) opens the same menu, from the label/description area only (R-11)
  let lp = null;
  sc.addEventListener('pointerdown', (ev) => {
    if (ev.pointerType !== 'touch' || ev.target.closest(ENTRY_SEL) || !ev.target.closest('.r-text')) return; const x = rowOf(ev.target); if (!x || !x.r || x.r.d === undefined) return;
    lp = { x: ev.clientX, y: ev.clientY, id: setTimeout(() => { lp = null; sc.dataset.lpFired = '1'; openMenu(x.r, null, { x: ev.clientX, y: ev.clientY }, $('[data-ctl]', x.el)); }, 500) };
  });
  const cancelLp = () => { if (lp) { clearTimeout(lp.id); lp = null; } };
  sc.addEventListener('pointerup', cancelLp); sc.addEventListener('pointercancel', cancelLp);
  sc.addEventListener('pointermove', (ev) => { if (lp && Math.hypot(ev.clientX - lp.x, ev.clientY - lp.y) > 10) cancelLp(); });
}
function setSeg(x, val, focus) {
  const { r, el } = x; r.v = val; $$('[data-seg]', el).forEach((b) => { const on = b.dataset.seg === val; b.setAttribute('aria-checked', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1; if (on && focus) b.focus(); });
  syncChanged(r, el); onRowChanged(r);
}
function toggleHelp(row, force) {
  const b = $('.r-info', row), h = $('.r-help', row); if (!b || !h) return; const open = force !== undefined ? force : h.hidden; h.hidden = !open; b.setAttribute('aria-expanded', open ? 'true' : 'false');
}

/* ------------------------------------------------------------------ navigation */
function announce(msg) { const l = $('#live'); l.textContent = ''; setTimeout(() => { l.textContent = msg; }, 60); }
function persistPage() { if (!hermetic) store.set('lastPage', S.page); }
function showPage(pid, o = {}) {
  if (!PAGE[pid]) pid = 'models';
  if (X.nav) X.nav(pid, o);
  const changed =pid !== S.page || o.force || S.view !== 'page' || !$('#pageScroll .pg'); const prev = S.page;
  savePageMem();
  if (!o.fromJump && !o.isReturn) S.retRow = null;
  S.page = pid; S.view = 'page';
  if (!o.fromSearch && (S.q || S.resume || S.searchOpen || S.resShown)) { S.searchOpen = false; S.q = ''; S.resume = null; $('#q').value = ''; S.expanded.clear(); hideResults(); }
  if (!o.keepNotice) S.notice = o.notice || '';
  if (o.notice) announce(o.notice);
  if (S.modelCallout && !(o.row && o.row.id === 'models.mainModel')) S.modelCallout = null;
  if (o.row && connHidden(o.row)) S.connExpanded = true;
  closeMenu();
  renderPage({ anim: changed && !o.noAnim && (o.anim !== false) && prev !== undefined, reveal: o.row && unavail(o.row) ? o.row.id : null });
  const mem = S.pageMem[pid]; if (mem) mem.help.forEach((id) => { const r = $(`#pageScroll [data-row="${CSS.escape(id)}"]`); if (r) toggleHelp(r, true); });
  renderIndex(); renderHeader(); applyView(); persistPage();
  const sc = $('#pageScroll'); const smooth = !(S.rm || S.lp);
  if (o.row) {
    const el = $(`#pageScroll [data-row="${CSS.escape(o.row.id)}"]`);
    if (el) { el.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' }); highlight(el); if (o.help) toggleHelp(el, true); const c = $('[data-ctl]', el) || el; c.focus({ preventScroll: true }); }
  } else if (o.thing) {
    const el = $(`[data-thing="${CSS.escape(o.thing)}"]`) || $(`[data-row="${CSS.escape((o.thing.startsWith('plugin') ? 'plugin.' : 'module.') + o.thing.split(':')[1])}"] a`);
    if (el) { el.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' }); highlight(el.closest('li') || el.closest('.row') || el); el.focus({ preventScroll: true }); }
  } else if (o.section) {
    const h = $(`#h-${CSS.escape(o.section)}`); if (h) { h.scrollIntoView({ block: 'start', behavior: smooth ? 'smooth' : 'auto' }); h.focus({ preventScroll: true }); }
  } else {
    if (mem && !o.noRestore) sc.scrollTop = mem.scroll;   // R-13: the page keeps its scroll for the session
    if (o.focusHead || (S.lay === 'phone' && o.focusTitle !== false && !o.keepFocus)) { const h = $('#pgTitle'); if (h) h.focus({ preventScroll: true }); }
  }
  sc.dataset.page = pid;
}
function openRow(r, o = {}) { showPage(r.page, Object.assign({ row: r, section: r.sec }, o, { noAnim: false })); }
function highlight(el) {
  el.classList.add('hl'); clearTimeout(highlight.t); if (S.hlHold) return; highlight.t = setTimeout(() => el.classList.remove('hl'), 2000);
}
function jumpSection(id) {
  const h = $(`#h-${CSS.escape(id)}`); if (!h) return; const smooth = !(S.rm || S.lp);
  h.scrollIntoView({ block: 'start', behavior: smooth ? 'smooth' : 'auto' }); h.focus({ preventScroll: true });
}
function showIndexView(focus) {
  savePageMem(); S.view = 'index'; renderIndex(); renderHeader(); applyView();
  if (focus !== false) { const b = $(`.idx[data-page="${S.page}"]`) || $('.idx'); if (b) b.focus({ preventScroll: true }); }
}
/* DD-210 return to Home. Accepted only with from=home and a raw value that starts with ../home/home.html or ../mockups/home.html and continues with the end, ? or #.
   A rejected value behaves as if absent (the simulated origin stub) and is never put in the DOM; the console warning names the rule, not the value. */
function checkReturn() {
  const raw = Q.get('return'); if (raw === null) return '';
  const bad = (rule) => { console.warn('[settings mockup] return ignored: ' + rule); return ''; };
  if (Q.get('from') !== 'home') return bad('needs from=home');
  if (!/^\.\.\/(?:home\/home|mockups\/home)\.html(?:[?#]|$)/.test(raw)) return bad('must start with ../home/home.html or ../mockups/home.html');
  if (/[\\\s\x00-\x1f\x7f]/.test(raw)) return bad('no backslash, whitespace or control characters');
  const pathPart = raw.split(/[?#]/)[0];
  if (/\/\/|%2f|%2e|%5c|:/i.test(pathPart)) return bad('no scheme, //, or encoded slash or dot in the path');
  let u; try { u = new URL(raw, location.href); } catch (_) { return bad('not a valid address'); }
  if (u.origin !== location.origin || !/\/(?:home|mockups)\/home\.html$/.test(u.pathname)) return bad('same origin and a Home page only');
  return raw;
}
const HOME_RET = checkReturn();
function goBack(fromPop) {
  S.homePending = false;   // any Back or Esc, including the one that dismisses a guard dialog, cancels a trip home that a failed save held back
  if (openDialog.cur) { openDialog.cur('cancel'); return 'dialog'; }   // N-05: a dialog or menu closes first, whatever the Back source
  if (menuState) { closeMenu(true); return 'menu'; }
  if (X.back && X.back()) return 'ext';   // slice 2: switcher, select mode, library search, library sub-page (in that order)
  if (S.retRow && ROW[S.retRow]) { const id = S.retRow; S.retRow = null; openRow(ROW[id], { isReturn: true, noAnim: true }); return 'jump'; }   // return after a jump (re-review Q1)
  if (S.resume && !S.resShown) { resumeSearch(); return 'results'; }
  if (searchActive()) { closeSearch(); return 'search'; }
  if (S.lay === 'phone' && S.view === 'page') { showIndexView(); return 'index'; }
  closeSettings({ fromPop: !!fromPop, home: !!HOME_RET }); return 'origin';   // DD-210: with a valid return the origin step goes to Home's own page (closeSettings navigates once the close has succeeded)
}
function openSettings(opener, o = {}) {
  if (S.open) return; const org = $('#origin');
  const sc = $('#oScroll'); const d = $('#oDraft');
  S.saved = { scroll: sc ? sc.scrollTop : 0, selStart: d ? d.selectionStart : 0, selEnd: d ? d.selectionEnd : 0 };
  S.opener = opener || document.activeElement || $('#oSettings'); org.hidden = true; $('#settings').hidden = false; S.open = true;
  buildIndex();   // named things are refreshed on every open
  calcLay(); applyLayoutClasses();
  history.pushState({ ss1: 1 }, ''); S.hist = true;
  renderIndex(); renderHeader(); S.view = S.lay === 'phone' ? 'index' : 'page';
  if (S.lay !== 'phone') { showPage(o.page || S.page, { noAnim: true, keepFocus: true, section: o.section || null }); } else if (o.page) showPage(o.page, { section: o.section || null }); else { renderPage({}); applyView(); }
  renderIndex(); renderHeader(); applyView();
  if (!o.noFocus) { const f = S.lay === 'phone' && S.view === 'index' ? $('.idx') : $(`.idx[data-page="${S.page}"]`); if (f && !o.page && !o.section) f.focus({ preventScroll: true }); }
}
function closeSettings(o = {}) {
  if (!S.open) return; const home = !!(HOME_RET && (o.home || S.homePending));
  if (X.closing && X.closing() === false) { if (o.home) S.homePending = true; return; } /* slice 2 may veto: a failed save is still unresolved; the later close the guard dialog runs still goes home */ S.homePending = false; savePageMem(); closeMenu(); closeSearch(false); S.open = false; $('#settings').hidden = true; $('#origin').hidden = false;
  const sc = $('#oScroll'), d = $('#oDraft'); if (sc && S.saved) sc.scrollTop = S.saved.scroll;
  if (d && S.saved) { d.value = S.draft != null ? S.draft : d.value; d.setSelectionRange(S.saved.selStart, S.saved.selEnd); }
  const op = (S.opener && S.opener.isConnected && S.opener.offsetParent !== null) ? S.opener : $('#oSettings'); if (op && !o.noFocus) op.focus({ preventScroll: true });
  updateLpCard();
  if (home) { goHome(!!o.fromPop); return; }
  if (S.hist && !o.fromPop) { S.hist = false; S.popExpected++; try { history.back(); } catch (_) { S.popExpected = 0; } } else S.hist = false;
}
/* DS-149: going Home first steps back out of Settings' own pushed history entry (history.back(), then its popstate), and then replaces the base Settings entry with the return address
   (the value as given, restore=1 and all), so browser Back from Home reaches what was before Home and not Settings. A popstate that never arrives is covered by a 400 ms timeout; it runs once.
   Home's hand-off key in sessionStorage is Home's and stays untouched. */
function goHome(fromPop) {
  if (S.goingHome) return; S.goingHome = true;
  const go = () => { try { location.replace(HOME_RET); } catch (_) { location.href = HOME_RET; } };
  if (fromPop || !S.hist) { S.hist = false; go(); return; }   // a popstate already took the pushed entry (or none was pushed): the current entry is the base one
  S.hist = false; S.popExpected++;
  let done = false; let tm = 0;
  const fin = () => { if (done) return; done = true; window.removeEventListener('popstate', fin); clearTimeout(tm); go(); };
  window.addEventListener('popstate', fin); tm = setTimeout(fin, 400);
  try { history.back(); } catch (_) { fin(); }
}

/* ------------------------------------------------------------------ keyboard */
const inTextField = (el) => !!el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !['checkbox', 'radio', 'range', 'button'].includes(el.type)) || el.isContentEditable);
function regions() {
  const r = [{ name: 'header', el: () => $('#backBtn') }];
  if (S.lay !== 'phone' || S.view === 'index') r.push({ name: 'index', el: () => $(`.idx[tabindex="0"]`) || $('.idx') });
  if (S.lay !== 'phone' || S.view === 'page') r.push({ name: 'page', el: () => $('#pgTitle') });
  if (resultsVisible()) { const k = r.findIndex((x) => x.name === 'page'); if (k >= 0) r.splice(k, 1); r.push({ name: 'results', el: () => $('#q') }); }
  return r;
}
function cycleRegion(dir) {
  const rs = regions(); const a = document.activeElement; const inH = a && a.closest && a.closest('#hdr'); const inI = a && a.closest && a.closest('#index'); const inP = a && a.closest && a.closest('#page, #results');
  let cur = inH ? 'header' : inI ? 'index' : inP ? (resultsVisible() ? 'results' : 'page') : null; let i = rs.findIndex((x) => x.name === cur); if (i < 0) i = dir > 0 ? -1 : 0;
  const n = rs[(i + dir + rs.length) % rs.length]; const e = n.el(); if (e) e.focus({ preventScroll: true });
  return n.name;
}
function onKey(ev) {
  const a = document.activeElement; const key = ev.key;
  if (document.body.classList.contains('dlg-open')) return;   // dialog handles its own keys
  if ((ev.ctrlKey || ev.metaKey) && (key === 's' || key === 'S') && !ev.altKey) {
    if (inTextField(a)) return;   // R-22: nothing in any text field, search included
    ev.preventDefault(); if (S.open) closeSettings(); else openSettings($('#oSettings')); return;
  }
  if (!S.open) return;
  if ((ev.ctrlKey || ev.metaKey) && (key === 'k' || key === 'K')) { ev.preventDefault(); if (S.lay === 'phone') openSearchPhone(); else $('#q').focus(); return; }
  if (key === '/' && !ev.ctrlKey && !ev.altKey && !inTextField(a)) { ev.preventDefault(); if (S.lay === 'phone') openSearchPhone(); else $('#q').focus(); return; }
  if (key === 'F6') { ev.preventDefault(); cycleRegion(ev.shiftKey ? -1 : 1); return; }
  if (key === 'Escape' && !ev.defaultPrevented) {
    if (a && a.id === 'q') return;   // handled by the field (clear, then close)
    if (menuState) return;
    if (inTextField(a)) { const row = a.closest && a.closest('#pageScroll [data-row]'); if (row) { ev.preventDefault(); a.blur(); row.tabIndex = -1; row.focus({ preventScroll: true }); } return; }   // N-07: the first Esc leaves the field, the next follows the Back order
    ev.preventDefault(); goBack();
  }
}
function bindSearchField() {
  const q = $('#q');
  q.addEventListener('input', () => { S.q = q.value; S.resume = null; $('#qClear').hidden = S.lay === 'phone' ? !S.searchOpen : !S.q; runSearch(); });
  q.addEventListener('keydown', (ev) => {
    if (ev.isComposing || ev.keyCode === 229) return;
    const n = S.resShown && S.hits ? S.hits.length : 0;
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { if (!n) { if (S.q.trim()) { ev.preventDefault(); runSearch(); } return; } ev.preventDefault(); const d = ev.key === 'ArrowDown' ? 1 : -1; setActive((S.activeOpt + d + n) % n); }
    else if (ev.key === 'Enter') { if (n) { ev.preventDefault(); activateOpt(S.activeOpt >= 0 ? S.activeOpt : 0); } else if (S.q.trim()) { ev.preventDefault(); S.resume = null; runSearch(); } }
    else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); if (S.q) { setQuery(''); hideResults(); if (S.lay !== 'phone') q.focus(); } else { S.searchOpen = false; renderHeader(); applyView(); const f = S.lay === 'phone' ? $('#searchOpen') : $('.idx[tabindex="0"]'); if (f) f.focus({ preventScroll: true }); } }
  });
  $('#qClear').addEventListener('click', () => { if (S.lay === 'phone') { closeSearch($('#searchOpen')); } else { setQuery(''); hideResults(); q.focus(); } });
  $('#searchOpen').addEventListener('click', openSearchPhone);
  $('#results').addEventListener('click', (ev) => {
    const o = ev.target.closest('.opt'); if (o) { if (o.getAttribute('aria-disabled') === 'true' && false) return; activateOpt(+o.dataset.i); return; }
    const nr = ev.target.closest('[data-nr]'); if (nr) { if (nr.dataset.nr === 'clear') { setQuery(''); hideResults(); if (S.lay === 'phone') { S.searchOpen = true; renderHeader(); } $('#q').focus(); } else { closeSearch(false); if (S.lay === 'phone') { showIndexView(); } else { renderIndex(); applyView(); const b = $('.idx[tabindex="0"]'); if (b) b.focus(); } } }
  });
  $('#results').addEventListener('mousemove', (ev) => { const o = ev.target.closest('.opt'); if (o && +o.dataset.i !== S.activeOpt) setActive(+o.dataset.i, false); });
}
function bindIndex() {
  const idx = $('#index');
  idx.addEventListener('click', (ev) => {
    const b = ev.target.closest('.idx'); if (b) { const same = b.dataset.page === S.page && S.view === 'page'; showPage(b.dataset.page, { focusTitle: true, keepFocus: S.lay !== 'phone', force: !same }); if (S.lay !== 'phone') b.focus({ preventScroll: true }); else { const h = $('#pgTitle'); if (h) h.focus({ preventScroll: true }); } return; }
  });
  $('#indexFoot').addEventListener('click', (ev) => { const f = ev.target.closest('[data-foot]'); if (f) infoDialog(f.dataset.foot); });
  idx.addEventListener('keydown', (ev) => {
    const b = ev.target.closest('.idx'); if (!b) return; const all = $$('.idx', idx); let i = all.indexOf(b); let n = null;
    if (ev.key === 'ArrowDown') n = (i + 1) % all.length; else if (ev.key === 'ArrowUp') n = (i - 1 + all.length) % all.length; else if (ev.key === 'Home') n = 0; else if (ev.key === 'End') n = all.length - 1;
    if (n === null) return; ev.preventDefault(); all.forEach((x) => { x.tabIndex = -1; }); all[n].tabIndex = 0; all[n].focus();
  });
}

/* ------------------------------------------------------------------ demo panel */
const DEMO_WIDTHS = [0, 360, 412, 768, 1024, 1280];
function buildDemo() {
  const btn = $('#demoBtn'); btn.innerHTML = ic('wrench', 'xl'); btn.setAttribute('aria-label', t('demoOpen')); btn.title = t('demoOpen');
  const p = $('#demoPanel'); const open = !p.hidden;
  p.setAttribute('aria-label', t('demoTitle'));
  const sw = (id, label) => `<label class="d-row"><span>${esc(label)}</span><span class="sw"><input type="checkbox" role="switch" id="${id}"><span class="sw-ui" aria-hidden="true"></span></span></label>`;
  p.innerHTML = `<h2 class="d-h">${esc(t('demoTitle'))}</h2><p class="d-note">${esc(t('demoNote'))}</p>` +
    `<label class="d-row"><span>${esc(t('demoLang'))}</span><select id="dLang"><option value="ko">한국어</option><option value="en">English</option></select></label>` +
    `<label class="d-row"><span>${esc(t('demoWidth'))}</span><select id="dW">${DEMO_WIDTHS.map((w) => `<option value="${w}">${w ? w + ' px' : t('demoAuto')}</option>`).join('')}</select></label>` +
    sw('dRm', t('demoRm')) + sw('dLp', t('demoLp')) + sw('dBig', t('demoBig')) + sw('dExp', t('demoExp')) +
    `<label class="d-row"><span>${esc(t('demoOrigin'))}</span><select id="dFrom"><option value="chat">${esc(t('orgChat'))}</option><option value="home">${esc(t('orgHome'))}</option><option value="studio">${esc(t('orgStudio'))}</option></select></label>` +
    `<label class="d-row"><span>${esc(t('demoModel'))}</span><select id="dModel">${DEMO_MODELS.map((m) => `<option value="${m}">${esc(mn(MODEL[m]))}</option>`).join('')}</select></label>` +
    `<div class="d-btns"><button type="button" data-part="settings-button" class="btn solid" id="dSlow">${ic('zap', 'md')}<span>${esc(t('demoSlow'))}</span></button></div>` +
    `<label class="d-row"><span>${esc(t('demoState'))}</span><select id="dState">${STATES.map((s) => `<option>${s}</option>`).join('')}</select></label>` +
    `<div class="d-btns"><button type="button" data-part="settings-button" class="btn solid" id="dGo"><span>${esc(t('demoGo'))}</span></button><button type="button" data-part="settings-button" class="btn solid" id="dOpen"><span>${esc(t('demoOpenSettings'))}</span></button><button type="button" data-part="settings-button" class="btn solid" id="dReset">${ic('rotate-ccw', 'md')}<span>${esc(t('demoReset'))}</span></button></div>` +
    `<p class="d-states">${esc(t('demoStates'))}${STATES.join(', ')}</p>`;
  p.hidden = !open; updateDemo();
  if (X.demoPanel) X.demoPanel(p);
  $('#dLang').onchange = (e) => setLang(e.target.value);
  $('#dW').onchange = (e) => setFrame(+e.target.value);
  $('#dRm').onchange = (e) => { S.rmDemo = e.target.checked; applyFlags(); };
  $('#dLp').onchange = (e) => setLowPower(e.target.checked);
  $('#dBig').onchange = (e) => { S.big = e.target.checked; applyFlags(); afterResize(); };
  $('#dExp').onchange = (e) => { ROW['adv.useExperimental'].v = e.target.checked; onRowChanged(ROW['adv.useExperimental']); };
  $('#dFrom').onchange = (e) => { setFrom(e.target.value); };
  $('#dModel').onchange = (e) => { ROW['models.mainModel'].v = e.target.value; onRowChanged(ROW['models.mainModel']); };
  $('#dSlow').onclick = () => { triggerSlow(); };
  $('#dGo').onclick = () => { applyState($('#dState').value); };
  $('#dOpen').onclick = () => { if (!S.open) openSettings($('#oSettings'));  };
  $('#dReset').onclick = () => { location.href = location.pathname + (S.lang === 'en' ? '?lang=en' : ''); };
}
function updateDemo() {
  const g = (id) => $('#' + id); if (!g('dLang')) return;
  g('dLang').value = S.lang; g('dW').value = String(S.frameW || 0); g('dRm').checked = S.rm; g('dLp').checked = S.lp; g('dBig').checked = S.big; g('dExp').checked = !!ROW['adv.useExperimental'].v; g('dFrom').value = S.from;
  const m = ROW['models.mainModel'].v; g('dModel').value = DEMO_MODELS.includes(m) ? m : DEMO_MODELS[0];
}
function setFrom(f) { S.from = f; buildOrigin(); if (S.open) { renderHeader(); } updateDemo(); }
function setFrame(w) { S.frameW = w; applyLayoutClasses(); afterResize(); updateDemo(); }
function afterResize() {
  calcLay(); applyLayoutClasses();
  if (S.open) {
    if (S.lay !== 'phone' && S.view === 'index') S.view = 'page';
    if (S.lay === 'phone' && S.q && !S.searchOpen) S.searchOpen = true;   // R-07: a query never loses its visible field
    renderIndex(); renderHeader(); if (S.page && $('#pageScroll .pg')) renderPage({ keepScroll: true }); applyView(); if (resultsVisible()) runSearch();
  }
}

/* ------------------------------------------------------------------ states (SPEC 9.3) */
async function applyState(name, o = {}) {
  window.__ss1Ready = false; closeMenu(); document.querySelectorAll('.dlg-back').forEach((d) => d.remove()); document.body.classList.remove('dlg-open'); ['#settings', '#origin'].forEach((s) => { $(s).inert = false; }); S.hlHold = false;
  const settle = () => sleep(60);
  if (S.open && !['ss-back'].includes(name)) { if (searchActive()) closeSearch(false); }
  const ensureOpen = (opt) => { if (!S.open) openSettings($('#oSettings'), Object.assign({ noFocus: true }, opt || {})); };
  const phone = S.lay === 'phone';
  if (name.indexOf('ps-') === 0 && X.state) { await X.state(name, o); await sleep(o.wait === undefined ? 120 : o.wait); window.__ss1Ready = name; return name; }
  switch (name) {
    case 'ss-origin': if (S.open) closeSettings(); S.lpPending = false; updateLpCard(); break;
    case 'ss-index': ensureOpen(); if (phone) showIndexView(false); else showPage(S.page === 'models' ? 'models' : S.page, { noAnim: true, keepFocus: true }); break;
    case 'ss-page-display': ensureOpen(); showPage('display', { noAnim: true }); break;
    case 'ss-page-models': ensureOpen(); showPage('models', { noAnim: true }); break;
    case 'ss-page-advanced': ensureOpen(); showPage('adv', { noAnim: true }); break;
    case 'ss-search-typing': ensureOpen(); if (phone) openSearchPhone(); setQuery('글꼴'); break;
    case 'ss-search-chosung': ensureOpen(); if (phone) openSearchPhone(); setQuery('ㅈㅈㄹ'); break;
    case 'ss-search-en': ensureOpen(); if (phone) openSearchPhone(); setQuery('temperature'); break;
    case 'ss-search-named': ensureOpen(); if (phone) openSearchPhone(); setQuery('균형'); break;
    case 'ss-search-unavail': ensureOpen(); if (phone) openSearchPhone(); setQuery('min p'); break;
    case 'ss-search-none': ensureOpen(); if (phone) openSearchPhone(); setQuery('없는설정'); break;
    case 'ss-search-expand': ensureOpen(); if (phone) openSearchPhone(); S.expanded = new Set(['setting']); setQuery('키'); break;
    case 'ss-hit': ensureOpen(); if (phone) openSearchPhone(); S.hlHold = true; setQuery('온도'); await settle(); activateOpt(0); S.hlHold = true; { const el = $('#pageScroll [data-row="models.temperature"]'); if (el) highlight(el); } break;
    case 'ss-help-open': ensureOpen(); S.hlHold = true; openRow(ROW['models.temperature'], { help: true }); break;
    case 'ss-changed': ensureOpen(); showPage('display', { section: 'display.font', noAnim: true }); await settle(); { const x = ROW['display.lineHeight']; const el = $('#pageScroll [data-row="display.lineHeight"]'); if (el) { el.scrollIntoView({ block: 'center' }); openMenu(x, $('.r-more', el), null, $('.r-more', el)); } } break;
    case 'ss-hotkeys-phone': ensureOpen(); showPage('keys', { noAnim: true }); break;
    case 'ss-module-new': ensureOpen(); showPage('ext', { section: 'ext.modules', noAnim: true }); await settle(); moduleDialog(); break;
    case 'ss-deeplink-bad': if (S.open) closeSettings(); applyDeepLink('nope', null, null, null); break;
    case 'ss-lowpower-suggest': if (S.open) closeSettings(); S.from = 'chat'; buildOrigin(); S.lpState = { declined: 0, last: 0, on: false }; syncAsked(); S.lpPending = true; updateLpCard(); break;
    case 'ss-lowpower-on': ensureOpen(); setLowPower(true); showPage('display', { section: 'display.lowpower', noAnim: true }); break;
    case 'ss-large-text': S.big = true; applyFlags(); ensureOpen(); afterResize(); showPage('display', { noAnim: true }); break;
    case 'ss-back': ensureOpen(); showPage('display', { noAnim: true }); await settle(); closeSettings(); break;
    default: break;
  }
  updateDemo(); await sleep(o.wait === undefined ? 120 : o.wait); window.__ss1Ready = name; return name;
}
function applyDeepLink(page, section, q, row) {   // R-14: strict ids; ?section= alone resolves its page; ?row= opens like a search hit
  if (!S.open) openSettings($('#oSettings'), { noFocus: true });
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);   // own-property lookups: constructor, __proto__ and toString are not pages, sections or rows
  let pid = page, bad = false;
  if (pid && !own(PAGE, pid)) bad = true;
  if (!bad && section && !own(SEC, section)) bad = true;
  if (!bad && row && !own(ROW, row)) bad = true;
  if (!bad && section) pid = SEC[section].page;   // DS-151: a known section opens its own page, whatever page= says
  if (!bad && !pid && row) pid = ROW[row].page;
  if (bad) {
    S.notice = t('settingNotFound');
    if (page && !own(PAGE, page)) { if (S.lay === 'phone') { S.view = 'index'; renderPage({}); renderIndex(); renderHeader(); applyView(); const b = $('.idx'); if (b) b.focus({ preventScroll: true }); announce(S.notice); } else { S.page = 'models'; showPage('models', { notice: t('settingNotFound'), noAnim: true, keepFocus: true }); } return false; }
    showPage(pid || (S.lay === 'phone' ? S.page : S.page), { notice: t('settingNotFound'), noAnim: true, keepNotice: false }); return false;   // known page, unknown section/row: the page opens with the notice
  }
  if (row) { openRow(ROW[row], { noAnim: true }); return true; }
  if (pid) showPage(pid, { section: section || null, noAnim: true });
  if (q) { if (S.lay === 'phone') openSearchPhone(); setQuery(q); }
  return true;
}

/* ------------------------------------------------------------------ init */
function setupGen() { setInterval(() => { if (S.gen.chars < 4000) { S.gen.chars += 6; const g = $('#oGen'); if (g) g.textContent = t('genStatus', S.gen.chars); } }, 200); }
function init() {
  root.lang = S.lang; document.title = S.lang === 'ko' ? '설정 슬라이스 1 · 목업' : 'Settings slice 1 · mockup';
  const mq = matchMedia('(prefers-reduced-motion: reduce)'); S.rmSys = mq.matches || Q.get('reduced') === '1'; mq.addEventListener && mq.addEventListener('change', () => { S.rmSys = mq.matches || Q.get('reduced') === '1'; applyFlags(); });
  S.lp = Q.get('lowpower') === '1'; ROW['display.lowPower'].v = S.lp; ROW['lang.ui'].v = S.lang;
  const w = parseInt(Q.get('w') || '0', 10); if (w >= 280) S.frameW = w;
  if (Q.get('text') === '200') S.big = true;
  calcLay(); applyLayoutClasses(); applyFlags();
  if (X.boot) X.boot({ S, ROW, D, T, L, t, pair, ic, esc, $, $$, Q, root, sleep, toast, announce, openDialog, showMenu, closeMenu, menuOpen: () => !!menuState, renderPage, refreshPage, showPage, openRow, openSettings, closeSettings, goBack, buildIndex, renderIndex, renderHeader, rerenderRow, highlight, mf, mw, cho, normWord, pRo, pEul, pGwa, jong, GROUPS, ICONS, MODEL, mn, mprov, curModel, activePreset, studioHref, inTextField, valueText, fmtNum, optLabel, setFrame, applyFlags, store, hermetic, setLowPower, openSearchPhone, isChanged, PAGE, SEC, SECROWS, rowHTML, calcLay, applyLayoutClasses, afterResize, PRESET_SECS });
  buildOrigin(); buildDemo(); bindPageEvents(); bindSearchField(); bindIndex(); setupGen();
  $('#backBtn').addEventListener('click', () => goBack());
  $('#origin').addEventListener('click', (ev) => {
    const s = ev.target.closest('#oSettings'); if (s) { openSettings(s); return; }
    if (ev.target.closest('#lpYes')) answerLp(true); else if (ev.target.closest('#lpNo')) answerLp(false);
  });
  $('#demoBtn').addEventListener('click', () => { const p = $('#demoPanel'); p.hidden = !p.hidden; $('#demoBtn').setAttribute('aria-expanded', p.hidden ? 'false' : 'true'); });
  document.addEventListener('keydown', onKey, false);
  document.addEventListener('mouseup', (ev) => { if (ev.button === 3 && S.open) { ev.preventDefault(); goBack(); } });
  window.addEventListener('popstate', () => { if (S.popExpected > 0) { S.popExpected--; return; } if (!S.open) return; const r = goBack(true); if (r !== 'origin') { history.pushState({ ss1: 1 }, ''); S.hist = true; } else { S.hist = false; } });
  new ResizeObserver(() => { const changed = calcLay(); applyLayoutClasses(); if (changed) afterResize(); }).observe($('#app'));
  window.__ss1 = {
    S, perf, ROW, D, T, STATES, openDialog, search: (q) => { const r = search(q); return { total: r.total, ms: r.ms, kinds: Object.fromEntries(Object.entries(r.byKind).map(([k, a]) => [k, a.length])) }; },
    buildIndex: () => { buildIndex(); return perf.build; }, setQuery, runSearch, openSettings: (o) => openSettings($('#oSettings'), o || {}), closeSettings, goBack, homeReturn: () => HOME_RET, showPage, openRow: (id, o) => openRow(ROW[id], o || {}), applyState, setLang, setLowPower, triggerSlow, unavail, valueText,
    mw, mf, createSampler, lpEligible, idxStats: () => { const o = {}; IDX.forEach((e) => { o[e.k] = (o[e.k] || 0) + 1; }); return o; }, lay: () => S.lay, resultsVisible, searchActive, setFrom, setFrame, answerLp, applyFlags, isChanged, curModel, hitsText: () => (S.hits || []).map((x) => (x.h ? x.h.e.k + ':' + x.h.e.id : 'more:' + x.more)), openMenu: (id) => { const r = ROW[id]; const el = $(`#pageScroll [data-row="${CSS.escape(id)}"]`); openMenu(r, $('.r-more', el), null, $('.r-more', el)); },
  };
  if (Q.get('sampler') === '1') startLiveSampler();
  const state = Q.get('state');
  if (state) { applyState(state, { wait: 200 }); return; }
  const SEC_ALIAS = { prompts: 'models.prompt' };   // DD-239: Home's documented alias, the only one
  const rawSec = Q.get('section'), section = rawSec !== null && Object.prototype.hasOwnProperty.call(SEC_ALIAS, rawSec) ? SEC_ALIAS[rawSec] : rawSec;
  const page = Q.get('page'), q = Q.get('q'), row = Q.get('row');
  const last = !hermetic ? store.get('lastPage') : null; if (last && PAGE[last]) S.page = last;
  const ok = applyDeepLink(page, section, q, row);
  if (!page && !q && !section && !row && !S.open) openSettings($('#oSettings'), { noFocus: true });
  if (X.afterInit) X.afterInit({ page, section, q, row });
  void ok; setTimeout(() => { window.__ss1Ready = true; if (X.ready) X.ready(); }, 120);
}
init();
})();
