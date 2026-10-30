/* Settings slice 5c-1 (화면·읽기 and 입력·접근성, the DD-250 repair state, DD-223 undo wording) catalogue, fixtures and copy. Synthetic; loaded after data.js .. data5b.js and before slice2.js / slice1.js.
   Mutates window.SS1_DATA in place (rows, sections, pages) so slice 1 code keeps working on the same arrays, then publishes window.SS5C1_DATA.
   The display.* and input.* rows slice 1 invented are replaced HERE (the real fields of research/slice5c1-display-input.md section 1 take their place); slices 1 to 5b keep their own pages and data.
   Nothing here is read from or written to the real app. File names, sizes, colours and the sidebar items are invented. The browser permission prompt and the file picker are simulated.
   Sets (?set=): demo, touch, desktop-app, custom, denied. Fixture (?fixture=all-modes-hidden-repair) with ?mode=rp|hybrid|utility (Home's mode, from=home). ?notif=granted|default|denied|unsupported overrides the permission of the set.
   Floor devices (Note 9 / Android 10 WebView, Raspberry Pi 3): no optional chaining, nullish coalescing, .at(), replaceAll, structuredClone. */
(() => {
'use strict';
const D = window.SS1_DATA;
const Q = new URLSearchParams(location.search);
const SETS = ['demo', 'touch', 'desktop-app', 'custom', 'denied'];
const SET5C = SETS.indexOf(Q.get('set')) >= 0 ? Q.get('set') : 'demo';
const FIXTURE = Q.get('fixture') === 'all-modes-hidden-repair' ? 'all-modes-hidden-repair' : '';
const MODES = ['rp', 'hybrid', 'utility'];
const MODE_Q = MODES.indexOf(Q.get('mode')) >= 0 ? Q.get('mode') : '';
const PERMS = ['granted', 'default', 'denied', 'unsupported'];
const rows = D.rows; const ROWI = {}; rows.forEach((r) => { ROWI[r.id] = r; });

/* ---------------------------------------------------------------- the store (what the app would hold; every page reads it by id at render time) */
const HOME = (Q.get('from') === 'home' || FIXTURE) ? (MODE_Q || (FIXTURE ? 'hybrid' : '')) : '';   // the mode Home is in (from=home&mode=); the fixture needs one, so hybrid when it is missing; '' = not opened from Home
const makeST = (set, fixture, home, perm) => ({
  modes: { visible: fixture ? [home] : MODES.slice(), hideUnused: !!fixture, home, repair: !!fixture },
  colors: { bgcolor: '#282a36', darkbg: '#21222c', borderc: '#6272a4', selected: '#44475a', draculared: '#ff5555', textcolor: '#f8f8f2', textcolor2: '#64748b', darkBorderc: '#4b5563', darkbutton: '#374151', type: 'dark' },
  textColors: { FontColorStandard: '#f8f8f2', FontColorBold: '#f8f8f2', FontColorItalic: '#8C8D93', FontColorItalicBold: '#8C8D93', FontColorQuote1: '#8BE9FD', FontColorQuote2: '#FFB86C' },
  bg: null,                                      // { name, kb, type } of the chosen background file, or null (customBackground '')
  screen: { color: '#121212', border: '#121212' },
  quotes: ['“', '”', '‘', '’'],
  assetRem: 20,
  html: '<div class="msg {{role}}">\n  <b>{{name}}</b>\n  <div>{{message}}</div>\n</div>',
  sidebar: [{ id: 's1', type: 'preset', ko: '프리셋', en: 'Presets' }, { id: 's2', type: 'persona', ko: '페르소나', en: 'Personas' }, { id: 's3', type: 'setting', ref: 'models.temperature', ko: '온도', en: 'Temperature' }],
  sbSeq: 3,
  perm, notify: false, nmsg: '', quoteStyle: true, screenOn: { color: false, border: false },
  platform: { touch: set === 'touch', desktop: set === 'desktop-app' },
  extWrites: 0,
});
const permOf = (x) => (PERMS.indexOf(x) >= 0 ? x : '');
const PERM_Q = permOf(Q.get('notif'));
const ST = makeST(SET5C, FIXTURE, HOME, PERM_Q || (SET5C === 'denied' ? 'denied' : 'granted'));
const BG_FILES = [
  { id: 'f1', name: 'forest-night.png', kb: 1840, type: 'png', ok: true },
  { id: 'f2', name: 'dawn-hills.webp', kb: 640, type: 'webp', ok: true },
  { id: 'f3', name: 'rain-window.gif', kb: 3270, type: 'gif', ok: true },
  { id: 'f4', name: 'notes.txt', kb: 2, type: 'txt', ok: false },
];
const SCHEMES = [   // id, KO name, EN name (the app shows the id with capitals), then the four colours of the swatch (bgcolor, darkbg, borderc, selected) and the type; the values are the app's presets (colorscheme.ts)
  ['default', '기본', 'Default', '#282a36', '#21222c', '#6272a4', '#44475a', 'dark'], ['dark', '어둡게', 'Dark', '#1a1a1a', '#141414', '#525252', '#3d3d3d', 'dark'], ['light', '밝게', 'Light', '#ffffff', '#f0f0f0', '#0f172a', '#e0e0e0', 'light'],
  ['cherry', '체리', 'Cherry', '#450a0a', '#7f1d1d', '#ea580c', '#d97706', 'dark'], ['galaxy', '갤럭시', 'Galaxy', '#0f172a', '#1f2a48', '#8be9fd', '#457b9d', 'dark'], ['nature', '네이처', 'Nature', '#1b4332', '#2d6a4f', '#a8dadc', '#4d908e', 'dark'],
  ['ocean', '오션', 'Ocean', '#0b1f2a', '#08202b', '#38bdf8', '#164e63', 'dark'], ['aurora', '오로라', 'Aurora', '#10201c', '#152a24', '#5eead4', '#315c52', 'dark'], ['twilight', '트와일라잇', 'Twilight', '#171324', '#201936', '#c084fc', '#3b2a5a', 'dark'],
  ['realblack', '리얼 블랙', 'Realblack', '#000000', '#000000', '#6272a4', '#44475a', 'dark'], ['monokai-light', '모노카이 라이트', 'Monokai Light', '#f8f8f2', '#e8e8e3', '#75715e', '#d8d8d0', 'light'], ['monokai-black', '모노카이 블랙', 'Monokai Black', '#272822', '#1e1f1a', '#75715e', '#3e3d32', 'dark'],
  ['sky-light', '스카이 라이트', 'Sky Light', '#f6fbff', '#e8f3fb', '#0284c7', '#d7ecf8', 'light'], ['sage-light', '세이지 라이트', 'Sage Light', '#f7faf5', '#e8f0e6', '#3f6212', '#d9e8d3', 'light'], ['lavender-light', '라벤더 라이트', 'Lavender Light', '#f8f7ff', '#ede9fe', '#6d28d9', '#ddd6fe', 'light'],
  ['slate-light', '슬레이트 라이트', 'Slate Light', '#f8fafc', '#e2e8f0', '#334155', '#cbd5e1', 'light'], ['lite', '경량', 'Lite', '#1f2937', '#1C2533', '#475569', '#475569', 'dark'],
];
const COLOR_FILES = [{ id: 'c1', name: 'ocean-night.json', ok: true, colors: { type: 'dark', bgcolor: '#0b1f2a', darkbg: '#08202b', borderc: '#38bdf8', selected: '#164e63', draculared: '#ff6b6b', textcolor: '#e6f6fb', textcolor2: '#7aa3b3', darkBorderc: '#1e3a4a', darkbutton: '#123142' } }, { id: 'c2', name: 'broken-colors.json', ok: false }, { id: 'c3', name: 'preset-export.json', ok: false }];
const COLOR_KEYS = ['bgcolor', 'darkbg', 'borderc', 'selected', 'draculared', 'textcolor', 'textcolor2', 'darkBorderc', 'darkbutton'];
const TEXT_KEYS = ['FontColorStandard', 'FontColorItalic', 'FontColorBold', 'FontColorItalicBold', 'FontColorQuote1', 'FontColorQuote2'];
const STEP_KO = ['가장 작게', '훨씬 더 작게', '아주 작게', '더 작게', '작게', '기본', '크게', '더 크게', '아주 크게', '훨씬 더 크게', '가장 크게'];   // guiSizeText (-5..5), the app's hard-coded English words in Korean
const STEP_EN = ['Tiniest', 'Tinier', 'Tiny', 'Smaller', 'Small', 'Default', 'Big', 'Bigger', 'Huge', 'Huger', 'Hugest'];
const POSITIONS = ['bottom-center', 'bottom-right', 'bottom-left', 'floating-circle', 'right-center', 'top-bar'];
const STUDIO_MOVED = [   // DS-163: rows that belong to Studio; Settings keeps a search-only entry (no row) that says so and links to Studio
  { id: 'useAdditionalAssetsPreview', ko: '추가 에셋 미리보기', en: 'Additional-asset preview', syn: 'useAdditionalAssetsPreview additional assets preview 에셋 미리보기 추가 에셋', kind: 'display' },
  { id: 'localActivationInGlobalLorebook', ko: '전역 로어북의 지역 활성화', en: 'Local activation in a global lorebook', syn: 'localActivationInGlobalLorebook local activation global lorebook 로어북 지역 활성화 전역', kind: 'lorebook' },
  { id: 'bulkEnabling', ko: '로어북 한꺼번에 켜기', en: 'Enable lorebook entries in bulk', syn: 'bulkEnabling bulk enabling lorebook 로어북 한꺼번에 일괄 켜기', kind: 'lorebook' },
];

/* ---------------------------------------------------------------- pages and sections */
const pageOf = (id) => D.PAGES.find((p) => p.id === id);
pageOf('display').syn += ' 모드 보이기 숨기기 홈 modes hidden repair 테마 색 글꼴 글자 크기 알림 움직임 애니메이션 저전력 theme colour colors font size notification motion low power 배경 이미지 따옴표';
pageOf('input').syn += ' 보내기 편집 스크롤 제스처 사이드바 삭제 확인 보기 쉽게 send edit scroll gestures sidebar confirm delete 진동 투명도';
const firstDisplay = D.SECTIONS.findIndex((s) => s.page === 'display');
const nSecs = D.SECTIONS.filter((s) => s.page === 'display' || s.page === 'input').length;
const NEWSECS = [
  ['display', 'display.modes', '모드', 'Modes'], ['display', 'display.theme', '테마와 색', 'Theme and colours'], ['display', 'display.font', '글꼴과 크기', 'Fonts and sizes'], ['display', 'display.chat', '채팅 표시', 'Chat display'],
  ['display', 'display.sound', '소리와 알림', 'Sound and notifications'], ['display', 'display.lowpower', '움직임과 성능', 'Motion and performance'], ['display', 'display.advanced', '고급', 'Advanced'],
  ['input', 'input.send', '보내기와 입력창', 'Sending and the input box'], ['input', 'input.edit', '메시지 편집', 'Editing messages'], ['input', 'input.scroll', '스크롤', 'Scrolling'], ['input', 'input.gestures', '제스처와 터치', 'Gestures and touch'],
  ['input', 'input.menu', '메뉴와 사이드바', 'Menus and the sidebar'], ['input', 'input.confirm', '삭제와 확인', 'Deleting and confirming'], ['input', 'input.a11y', '보기 쉽게', 'Easier to read'],
].map(([page, id, ko, en]) => ({ page, id, ko, en }));
D.SECTIONS.splice(firstDisplay, nSecs, ...NEWSECS);

/* ---------------------------------------------------------------- rows: slice 1's invented display.* and input.* rows go; the real ones come (DS-154); the dead ones are simply not here (DS-159) */
for (let i = rows.length - 1; i >= 0; i--) { const r = rows[i]; if (r.page === 'display' || r.page === 'input' || r.id === 'adv.legacyGui' || r.id === 'adv.mobileGuiBeta' || r.id === 'adv.keepAlive' || r.id === 'adv.lbBulk' || r.id === 'adv.lbLocal') rows.splice(i, 1); }   // the legacy GUI is dropped (DS-168); the beta mobile GUI moves into 화면·읽기 › 고급; keep alive is 5c-2's, re-homed below
let cur = '';
const sec = (id) => { cur = id; };
function add(type, id, ko, en, o) { const r = Object.assign({ type, id, sec: cur, page: cur.split('.')[0], ko, en, p5c: true }, o || {}); rows.push(r); ROWI[id] = r; return r; }
const opts = (s) => s.split(';').map((p) => { const i = p.indexOf(':'); const v = p.slice(0, i); const l = p.slice(i + 1).split('|'); return [v, l[0], l[1] || l[0]]; });
const sw = (id, ko, en, d, o) => add('switch', id, ko, en, Object.assign({ d, v: d }, o));
const se = (id, ko, en, d, op, o) => add('select', id, ko, en, Object.assign({ d, v: d, opt: opts(op) }, o));
const sg = (id, ko, en, d, op, o) => add('segmented', id, ko, en, Object.assign({ d, v: d, opt: opts(op) }, o));
const sl = (id, ko, en, d, r, o) => add('slider', id, ko, en, Object.assign({ d, v: d, min: r[0], max: r[1], step: r[2], unit: r[3] || '' }, o));
const tx = (id, ko, en, d, o) => add('text', id, ko, en, Object.assign({ d, v: d }, o));
const ta = (id, ko, en, d, o) => add('textarea', id, ko, en, Object.assign({ d, v: d }, o));
const bt = (id, ko, en, icon, act, o) => add('button', id, ko, en, Object.assign({ icon, act }, o));
const nv = (id, ko, en, target, o) => add('nav', id, ko, en, Object.assign({ target }, o));
const dep = (id, ins) => ({ id, in: ins });
const live = (r, get, set) => { Object.defineProperty(r, 'v', { enumerable: true, configurable: true, get, set }); return r; };   // a row whose value is a field of the store (no copy anywhere)
const has = (m) => ST.modes.visible.indexOf(m) >= 0;
const setMode = (m, on) => { const v = ST.modes.visible.filter((x) => x !== m); if (on) v.push(m); ST.modes.visible = MODES.filter((x) => v.indexOf(x) >= 0); };

/* ---- 모드 (DD-250, DS-155, DS-156) */
sec('display.modes');
live(sw('display.modeRp', '롤플레이 모드 보이기', 'Show Roleplay mode', true, { syn: 'visibleModes rp roleplay 롤플레이 모드 홈에 보이기 mode home' }), () => has('rp'), (x) => setMode('rp', !!x));
live(sw('display.modeHybrid', '하이브리드 모드 보이기', 'Show Hybrid mode', true, { syn: 'visibleModes hybrid 하이브리드 모드 홈에 보이기 mode home' }), () => has('hybrid'), (x) => setMode('hybrid', !!x));
live(sw('display.modeUtility', '유틸리티 모드 보이기', 'Show Utility mode', true, { syn: 'visibleModes utility 유틸리티 모드 홈에 보이기 mode home' }), () => has('utility'), (x) => setMode('utility', !!x));
live(sw('display.hideUnused', '쓰지 않는 모드 숨기기', 'Hide unused modes', false, { desc: '켜면 체크를 푼 모드는 홈에서 사라져요|When on, modes you unchecked disappear from Home', syn: 'hideUnusedModes hide unused modes 모드 숨기기 안 쓰는 모드 홈' }), () => ST.modes.hideUnused, (x) => { ST.modes.hideUnused = !!x; });
bt('display.showAllModes', '모든 모드 보이기', 'Show all modes', 'eye', 'p5c-showall', { syn: 'repair show all modes 모든 모드 보이기 다시 보이기 복구 숨긴 모드 hidden modes restore' });

/* ---- 테마와 색 */
sec('display.theme');
se('display.theme', '채팅 테마', 'Chat theme', '', ':기본|Standard;waifu:와이푸|Waifu;mobilechat:모바일 채팅|Mobile chat;cardboard:카드보드|Cardboard;customHTML:직접 만든 HTML|Custom HTML', { desc: '채팅 화면의 전체 모양을 골라요|Pick the overall look of the chat screen', syn: 'theme gui waifu mobilechat cardboard customHTML 와이푸 카드보드 모바일 채팅 레이아웃 모양 화면 스타일' });
sl('display.waifuWidth', '채팅 폭', 'Chat width', 100, [50, 200, 1, '%'], { dep: dep('display.theme', ['waifu']), desc: '와이푸 테마에서 대화 칸의 폭이에요|The width of the chat column in the Waifu theme', syn: 'waifuWidth waifu chat width 와이푸 채팅 폭' });
sl('display.waifuSize', '캐릭터 크기', 'Character size', 100, [20, 150, 1, '%'], { dep: dep('display.theme', ['waifu']), desc: '와이푸 테마에서 캐릭터 그림의 크기예요|The size of the character picture in the Waifu theme', syn: 'waifuWidth2 waifu character size 와이푸 캐릭터 크기' });
ta('display.guiHtml', '채팅 HTML', 'Chat HTML', '', { dep: dep('display.theme', ['customHTML']), help: '메시지 하나를 어떻게 그릴지 HTML로 적어요. 비워 두면 기본 모양을 써요|Write the HTML that draws one message. Blank uses the default look', syn: 'guiHTML custom html chat html 직접 만든 HTML 메시지 모양' });
se('display.colorScheme', '색 구성', 'Colour scheme', 'default', SCHEMES.map((s) => s[0] + ':' + s[1] + '|' + s[2]).join(';') + ';custom:직접 만들기|Custom', { desc: '앱 전체 색을 골라요|Pick the colours of the whole app', syn: 'colorSchemeName color scheme 다크 다크모드 어둡게 어두운 밝게 라이트 라이트모드 dark mode light 밤모드 night 색상 색깔' });
bt('display.customColors', '직접 만든 색 고치기', 'Edit your colours', 'palette', 'p5c-open-colors', { dep: dep('display.colorScheme', ['custom']), syn: 'customColorScheme custom colors editor 직접 만든 색 색 고치기' });
sg('display.textTheme', '글자 색', 'Text colour', 'standard', 'standard:기본|Standard;highcontrast:고대비|High contrast;custom:직접 만들기|Custom', { desc: '고대비는 글자를 더 또렷하게 보여요|High contrast makes text stand out more', syn: 'textTheme highcontrast high contrast text color 고대비 글자 색 텍스트 색 읽기 쉽게 접근성 accessibility' });
bt('display.customTextTheme', '글자 색 직접 만들기', 'Edit your text colours', 'palette', 'p5c-open-text', { dep: dep('display.textTheme', ['custom']), syn: 'customTextTheme custom text theme 글자 색 직접 만들기 굵게 기울임' });
live(sw('display.background', '배경 이미지', 'Background image', false, { desc: 'png, webp, gif 파일을 배경으로 써요|Use a png, webp or gif file as the background', syn: 'customBackground background image 배경 배경화면 이미지 gif png webp' }), () => !!ST.bg, (x) => { if (!x) ST.bg = null; });
live(sw('display.textScreenColor', '화면 색', 'Screen colour', false, { desc: '채팅 칸 뒤에 깔 색이에요. 끄면 색 구성을 따라요|The colour behind the chat. Off follows the colour scheme', syn: 'textScreenColor custom text screen color 채팅 화면 색 채팅 칸' }), () => ST.screenOn.color, (x) => { ST.screenOn.color = !!x; });
live(sw('display.textScreenBorder', '테두리 색', 'Border colour', false, { desc: '채팅 칸 둘레의 테두리 색이에요. 끄면 테두리가 없어요|The colour of the border around the chat. Off means no border', syn: 'textScreenBorder text screen borders 채팅 화면 테두리 테두리 색' }), () => ST.screenOn.border, (x) => { ST.screenOn.border = !!x; });
sw('display.textScreenRounded', '둥근 모서리', 'Rounded corners', false, { desc: '채팅 칸의 모서리를 둥글게 해요|Rounds the corners of the chat area', syn: 'textScreenRounded round text screen 채팅 화면 둥글게' });
sw('display.textBorder', '글자 윤곽선', 'Text outline', false, { desc: '글자 둘레에 윤곽선을 둘러 읽기 쉽게 해요|Draws an outline around text so it is easier to read', syn: 'textBorder text outlines 글자 테두리 윤곽선' });

/* ---- 글꼴과 크기 */
sec('display.font');
se('display.font', '글꼴', 'Font', 'default', 'default:기본|Default;timesnewroman:Times New Roman|Times New Roman;custom:직접 입력|Type a name', { syn: 'font 폰트 서체 글씨체 typeface timesnewroman customFont' });
tx('display.customFont', '글꼴 이름', 'Font name', '', { dep: dep('display.font', ['custom']), help: '기기에 설치된 글꼴 이름을 그대로 적어요|Type the name of a font installed on this device', syn: 'customFont custom font name 글꼴 이름 직접 입력' });
sl('display.zoom', '채팅 글자 크기', 'Chat text size', 100, [50, 200, 1, '%'], { desc: '메시지 편집 칸의 글자도 같이 커져요|The message editor scales with it', syn: 'zoomsize zoom size text size 글자 크기 글씨 폰트 크기 글자 글씨 크게 작게 font bigger larger big 큰' });
sl('display.lineHeight', '줄 간격', 'Line spacing', 1.25, [0.5, 3, 0.05], { syn: 'lineHeight line height 줄간격 행간 spacing' });
sl('display.iconSize', '프로필 사진 크기', 'Profile picture size', 100, [50, 200, 1, '%'], { desc: '채팅에 나오는 캐릭터 사진의 크기예요|The size of the character picture in chat', syn: 'iconsize icon size avatar 프로필 사진 아이콘 크기 캐릭터 사진' });
sl('display.textAreaSize', '입력창 크기', 'Input box size', 0, [-5, 5, 1], { steps: true, syn: 'textAreaSize text area size input area 입력창 크기 입력 칸' });
sl('display.textAreaText', '입력창 글자 크기', 'Input box text size', 0, [0, 3, 1], { steps: true, syn: 'textAreaTextSize input text size 입력창 글자 입력 글자 크기' });
sl('display.sidebarSize', '사이드바 폭', 'Sidebar width', 0, [0, 3, 1], { steps: true, syn: 'sideBarSize sidebar size 사이드바 폭 크기 사이드바 넓이' });
sg('display.assetWidth', '에셋 이미지 최대 폭', 'Asset image max width', 'unlimited', 'unlimited:제한 없음|No limit;hidden:숨기기|Hidden;custom:직접 정하기|Set a size', { desc: '채팅에 나오는 에셋 이미지의 폭이에요|The width of asset images shown in chat', syn: 'assetWidth asset width 에셋 넓이 이미지 폭 이미지 최대 너비' });
sl('display.assetRem', '최대 폭', 'Max width', 20, [1, 40, 1, 'rem'], { dep: dep('display.assetWidth', ['custom']), syn: 'assetWidth rem 에셋 최대 폭 직접 정하기' });
sl('display.settingsCloseSize', '설정 닫기 버튼 크기', 'Settings close button size', 24, [16, 48, 1, 'px'], { help: '설정 창 오른쪽 위 닫기 버튼의 크기예요|The size of the close button at the top right of the settings window', syn: 'settingsCloseButtonSize settings close button size 닫기 버튼 크기' });
Object.defineProperty(ROWI['display.settingsCloseSize'], 'dev', { enumerable: true, configurable: true, get() { return DC.isPhone(); } });   // desktop layouts only (a phone shows a note instead)

/* ---- 채팅 표시 */
sec('display.chat');
live(sw('display.quoteStyle', '따옴표 꾸미기', 'Style quotes', true, { desc: '따옴표 안의 글을 다른 색으로 보여요|Shows quoted text in a different colour', syn: 'unformatQuotes disable quote formatting 따옴표 서식 꾸미기 끄기 따옴표 인용' }), () => ST.quoteStyle, (x) => { ST.quoteStyle = !!x; });   // the app's field is the negative (unformatQuotes); the row is shown positively and stores the inverse
sw('display.blockquote', '인용문 꾸미기', 'Style block quotes', false, { desc: '따옴표로 묶은 말을 따로 한 덩어리로 띄워 보여요|Sets quoted dialogue apart as its own block', syn: 'blockquoteStyling blockquote styling 인용문 블록 인용' });
sw('display.customQuotes', '따옴표 직접 정하기', 'Choose your own quote marks', false, { desc: '켜면 따옴표 네 개를 직접 정해요|When on, you choose the four quote marks', syn: 'customQuotes customQuotesData custom quotes 따옴표 직접 정하기 따옴표 모양' });
sw('display.firstPages', '첫 메시지 넘기기 표시', 'Show first-message pages', false, { desc: '첫 메시지에 “1/3” 같은 쪽 표시를 보여요|Shows a “1/3” pager on the first message', syn: 'showFirstMessagePages show first message pages 첫 메시지 쪽 넘기기 페이지 인사' });
sw('display.copyBtn', '메시지 복사 버튼', 'Message copy button', false, { desc: '메시지마다 복사 버튼을 보여요|Shows a copy button on every message', syn: 'useChatCopy chat message copy 메시지 복사 복사 버튼' });
sw('display.savingIcon', '저장 중 아이콘', 'Saving icon', false, { desc: '저장하는 동안 작은 아이콘을 보여요|Shows a small icon while saving', syn: 'showSavingIcon saving icon 저장 아이콘 저장 중' });
sw('display.roundIcons', '둥근 프로필 사진', 'Round profile pictures', false, { syn: 'roundIcons round icons 둥근 아이콘 프로필 동그랗게' });
sw('display.folderName', '폴더 이름 표시', 'Show folder names', false, { syn: 'showFolderName show folder name 폴더 이름' });
sw('display.hideImages', '모든 이미지 숨기기', 'Hide all images', false, { help: '캐릭터 아이콘, 캐릭터 에셋 이미지, RisuRealm 표지를 숨겨요. 채팅 속 이미지는 그대로예요|Hides character icons, character asset images and RisuRealm covers. Images inside chats stay', syn: 'hideAllImages hide all images 이미지 숨기기 그림 숨기기' });
sw('display.hideRealm', 'RisuRealm 숨기기', 'Hide RisuRealm', false, { syn: 'hideRealm hide realm risurealm 리슈렐름 렐름 숨기기' });

/* ---- 소리와 알림 */
sec('display.sound');
sw('display.playMessage', '메시지 알림음', 'Message sound', false, { desc: '답이 오면 짧은 알림음이 나요. 소리 내어 읽어 주는 건 아니에요|Plays a short sound when a reply arrives. It does not read the reply aloud', syn: 'playMessage play message audio 알림음 소리 띵 효과음' });
sw('display.playTranslate', '번역 끝 알림음', 'Translation-done sound', false, { syn: 'playMessageOnTranslateEnd play audio on translate completion 번역 알림음 번역 끝 소리' });
live(sw('display.notification', '알림', 'Notifications', false, { scope: undefined, desc: '답이 오면 기기 알림으로 알려요|Tells you about new replies with a device notification', syn: 'notification 푸시 알림 알려주기 permission 알림 허용 알림 권한' }), () => ST.notify, (x) => { ST.notify = !!x; });

/* ---- 움직임과 성능 (DS-157, DS-162): lowPower, reducedMotion and animSpeed keep slice 1's ids (slice 1 reads them) */
sec('display.lowpower');
const lp = sw('display.lowPower', '저전력 모드', 'Low-power mode', false, { scope: 'device', desc: '흐림·그림자·장식 애니메이션을 끄고 전환을 짧게 해요|Turns off blur, shadows and decorative animation, and shortens transitions.', syn: 'low power battery saver performance 성능 저사양 절전 느림 slow lag nexus-low-power lowPower 배터리 절전 느려요 버벅 렉 부드럽게 battery 버벅임 발열 절약 뜨거워요' });
void lp;
sg('display.reducedMotion', '움직임 줄이기', 'Reduce motion', 'system', 'system:시스템 설정 따르기|Follow system;on:켜기|On;off:끄기|Off', { desc: '화면이 움직이는 효과를 줄여요|Cuts the moving effects on screen', syn: 'reducedMotion reduced motion animation reduce 애니메이션 모션 prefers-reduced-motion 움직임 줄이기 멀미' });
sl('display.animSpeed', '애니메이션 속도', 'Animation speed', 0.4, [0, 1, 0.05, 's'], { desc: '빠름 끝은 즉시(0초)예요|The fast end is instant (0 s)', syn: 'animationSpeed animation speed 애니메이션 속도 에니메이션 속도 느림 빠름 전환 속도 duration' });
sw('display.haptics', '진동 끄기', 'Turn off vibration', false, { isNew: true, desc: '버튼을 누를 때 나는 진동을 꺼요|Stops the vibration when you press things', syn: 'haptics hapticsOff haptic vibration vibrate 진동 햅틱 진동 반응 끄기' });
Object.defineProperty(ROWI['display.haptics'], 'dev', { enumerable: true, configurable: true, get() { return !DC.isTouch(); } });   // touch devices only

/* ---- 고급 (collapsed) */
sec('display.advanced');
ta('display.customCss', '사용자 CSS', 'Custom CSS', '', { help: '앱 모양을 CSS로 바꿔요. 잘못 쓰면 화면이 깨질 수 있어요|Restyle the app with CSS. A mistake can break the layout', syn: 'customCSS custom css style 스타일 사용자 CSS 커스텀 CSS' });
sw('display.betaMobileGui', '새 모바일 화면 (베타)', 'New mobile layout (beta)', false, { help: '폭 800px 이하에서만, 새로고침 후 적용돼요|Only at 800px wide or less, and after a reload', syn: 'betaMobileGUI beta mobile gui 베타 모바일 화면 모바일 GUI' });
sw('display.fullScreen', '전체 화면', 'Full screen', false, { desc: '데스크톱 앱에서만 쓸 수 있어요|Only available in the desktop app', syn: 'fullScreen fullscreen full screen 전체 화면 전체화면' });
Object.defineProperty(ROWI['display.fullScreen'], 'dev', { enumerable: true, configurable: true, get() { return !ST.platform.desktop; } });
sw('display.sticker', '채팅 스티커', 'Chat stickers', false, { dep: { id: 'adv.showUnrec', eq: true }, desc: '추천하지 않아요|Not recommended', syn: 'useChatSticker use chat sticker 스티커 채팅 스티커' });

/* ---- 보내기와 입력창 */
sec('input.send');
sw('input.sendWithEnter', 'Enter로 보내기', 'Send with Enter', true, { desc: '꺼져 있으면 Shift+Enter로 보내요|When off, Shift+Enter sends', syn: 'sendWithEnter send with enter key 엔터 전송 엔터키로 보내기 shift enter 엔터로 줄바꿈 줄바꿈' });
sw('input.fixedInput', '입력창을 화면 아래에 고정', 'Pin the input box to the bottom of the screen', false, { syn: 'fixedChatTextarea fixed chat textarea 입력창 고정 하단 고정' });
sw('input.menuChatList', '채팅 목록 메뉴', 'Chat list menu', false, { desc: '입력창 메뉴에 채팅 목록을 넣어요|Adds the chat list to the input box menu', syn: 'showMenuChatList show menu chat list 채팅 목록 메뉴 입력창 메뉴' });
sw('input.menuHypa', '기억 요약 창 메뉴', 'Memory summary menu', false, { desc: '입력창 메뉴에 기억 요약 창을 여는 항목을 넣어요|Adds an item that opens the memory summary window', syn: 'showMenuHypaMemoryModal show menu hypa modal 기억 요약 창 하이파 요약 입력창 메뉴' });
sw('input.menuReroll', '옆 메뉴 다시 생성 버튼', 'Side-menu regenerate button', false, { desc: '옆 메뉴에 답을 다시 만드는 버튼을 넣어요|Adds a button that regenerates the reply', syn: 'sideMenuRerollButton side menu reroll button 옆 메뉴 다시 생성 리롤' });

/* ---- 메시지 편집 */
sec('input.edit');
sw('input.clickEdit', '글자를 눌러 편집', 'Tap text to edit', false, { syn: 'clickToEdit click to edit 눌러서 수정 클릭해서 수정하기 글자 눌러 편집' });
sw('input.longPressEdit', '길게 눌러 편집 창 열기', 'Long-press to open the editor', false, { desc: '터치 기기에서 메시지를 길게 누르면 편집 창이 열려요|On touch devices, a long press on a message opens the editor window', syn: 'longPressToPopupEditor long press popup editor 길게 눌러 팝업 편집기' });
sw('input.dragEdit', '끌어 선택해 부분 편집', 'Select text to edit part of it', false, { syn: 'enableDragPartialEdit drag partial edit select text edit 드래그 부분 수정' });
sw('input.blockEdit', '마우스를 올려 부분 편집', 'Hover to edit part of a message', false, { desc: '마우스를 문단에 올리면 그 부분만 고칠 수 있어요|Hover over a paragraph to edit just that part', syn: 'enableBlockPartialEdit block partial edit hover 블록 부분 수정 마우스' });

/* ---- 스크롤 */
sec('input.scroll');
sw('input.autoScroll', '새 메시지로 자동 스크롤', 'Scroll to new messages', true, { syn: 'autoScrollToNewMessage auto scroll to new message 자동 스크롤 새 메시지' });
sw('input.alwaysScroll', '항상 스크롤', 'Always scroll', false, { dep: { id: 'input.autoScroll', eq: true }, desc: '위로 올려 보고 있어도 새 메시지가 오면 맨 아래로 가요|Jumps to the bottom on a new message even if you scrolled up', syn: 'alwaysScrollToNewMessage always scroll ignore scroll position 항상 스크롤' });
se('input.newMsgButton', '새 메시지 버튼 위치', 'New-message button position', 'bottom-center', 'bottom-center:아래 가운데|Bottom centre;bottom-right:아래 오른쪽|Bottom right;bottom-left:아래 왼쪽|Bottom left;floating-circle:떠 있는 원|Floating circle;right-center:오른쪽 가운데|Right centre;top-bar:위 막대|Top bar', { help: '위로 올려 보고 있을 때 나타나요|Appears when you have scrolled up', syn: 'newMessageButtonStyle new message button style 새 메시지 버튼 위치 모양 아래로 가기 버튼' });
Object.defineProperty(ROWI['input.newMsgButton'], 'dep', { enumerable: true, configurable: true, get() { return ROWI['input.autoScroll'].v ? { id: 'input.alwaysScroll', eq: false } : { id: 'input.autoScroll', eq: true }; } });   // shown only when auto-scroll is on and always-scroll is off (ASD:173)

/* ---- 제스처와 터치 */
sec('input.gestures');
sw('input.swipe', '스와이프로 다시 생성', 'Swipe to regenerate', true, { desc: '답을 옆으로 밀어 다시 만들어요|Swipe a reply sideways to make a new one', syn: 'swipe use swipe for regeneration 스와이프 리롤 밀기 새 답변 gesture 제스처' });
sw('input.edgeSwipe', '가장자리 스와이프로 사이드바 열기', 'Open the sidebar with an edge swipe', true, { isNew: true, desc: '화면 가장자리에서 밀면 사이드바가 열려요|Swipe in from the screen edge to open the sidebar', syn: 'edge swipe edgeSwipe sidebar gesture 가장자리 스와이프 사이드바 열기' });
sw('input.menuBottom', '메뉴 버튼을 사이드바 아래로', 'Move the menu button to the bottom of the sidebar', false, { desc: '한 손으로 누르기 쉬워요|Easier to reach with one hand', syn: 'hamburgerButtonBottom hamburger button bottom 메뉴 버튼 아래 햄버거 한 손' });
nv('input.hapticsLink', '진동 끄기', 'Turn off vibration', 'display.haptics', { desc: '화면·읽기 › 움직임과 성능에 있어요|It lives in Display › Motion and performance', syn: 'haptics vibration 진동 끄기 햅틱' });

/* ---- 메뉴와 사이드바 */
sec('input.menu');
sw('input.menuSidebar', '사이드바 보이기', 'Show the sidebar', false, { desc: '켜면 화면 옆에 사이드바가 나와요. 끄면 사이드바가 사라져요|Shows the sidebar beside the screen. Off hides it', syn: 'menuSideBar menu side bar 사이드바 보이기 메뉴 사이드바' });
sw('input.botAtStart', '시작할 때 캐릭터 메뉴 열기', 'Open the character menu at start', false, { syn: 'botSettingAtStart bot menu when launch 시작할 때 캐릭터 메뉴 봇 메뉴 시작' });
add('button', 'input.customSidebar', '사이드바 항목 직접 정하기', 'Choose sidebar items', { icon: 'panel-left', act: 'p5c-open-sidebar', desc: '사이드바에 넣을 항목을 더하고 빼요|Add and remove the items in the sidebar', syn: 'customSidebarItems custom sidebar config items 사이드바 항목 직접 정하기 사이드바 구성' });
sw('input.proTools', '고급 도구 보이기', 'Show advanced tools', true, { desc: '플러그인 도구와 플러그인 설정 항목이 나타나요|Shows the plugin tools and the plugin settings entry', syn: 'enableRisuaiProTools enable pro tools 고급 도구 프로 도구 플러그인 도구' });
sw('input.reduceTransparency', '투명도 줄이기', 'Reduce transparency', false, { isNew: true, desc: '반투명 배경을 불투명하게 바꿔요|Makes see-through surfaces solid', syn: 'reduce transparency prefers-reduced-transparency blur 투명도 줄이기 흐림 반투명' });

/* ---- 삭제와 확인 */
sec('input.confirm');
sw('input.askRemoval', '메시지 지울 때 확인', 'Confirm before deleting a message', true, { syn: 'askRemoval ask removal confirm delete 삭제 확인 지울 때 확인' });
sw('input.instantRemove', '지울 때 범위 묻기', 'Ask what to delete', false, { desc: '켜면 메시지를 지울 때 ‘이 메시지만’ 또는 ‘이 메시지와 뒤의 대화’를 골라요|When on, deleting a message asks: this message only, or this message and the conversation after it', syn: 'instantRemove remove subsequent when message remove 삭제 범위 이 메시지만 뒤의 대화 삭제 시 이후 메시지도 삭제 뒤 메시지 지우기 범위 묻기' });
sw('input.branchFolder', '분기할 때 폴더 만들기', 'Make a folder when branching', true, { syn: 'createFolderOnBranch create folder on branch 분기 폴더 만들기' });
sw('input.inlayError', '오류를 채팅에 표시', 'Show errors in the chat', false, { desc: '켜면 오류가 채팅 메시지로 나와요|Errors appear as a chat message', syn: 'inlayErrorResponse inlay error response 오류 채팅에 표시 에러' });
sw('input.showTransLoading', '번역 중 표시', 'Show when translating', false, { syn: 'showTranslationLoading show translation loading 번역 중 표시 번역 로딩' });

/* ---- 보기 쉽게: jump links only (DS-158: no duplicate rows) */
sec('input.a11y');
nv('input.easyContrast', '글자 색 (고대비)', 'Text colour (high contrast)', 'display.textTheme', { desc: '화면·읽기에서 글자를 더 또렷하게 바꿔요|Make text stand out more in Display', syn: 'high contrast 고대비 읽기 쉽게 보기 쉽게 접근성 accessibility' });
nv('input.easySize', '글자 크기', 'Text size', 'display.zoom', { desc: '화면·읽기에서 채팅 글자를 키워요|Make chat text bigger in Display', syn: 'text size 글자 크기 키우기 읽기 쉽게 보기 쉽게 접근성 accessibility' });
nv('input.easyInput', '입력창 크기', 'Input box size', 'display.textAreaSize', { desc: '화면·읽기에서 입력창과 그 글자를 키워요|Make the input box and its text bigger in Display', syn: 'input size 입력창 크기 키우기 읽기 쉽게 보기 쉽게 접근성 accessibility' });

/* ---- rows that moved in (DS-163): the owning page gets a plain row now; 5c-2 regroups 데이터·백업 and 고급 */
sec('models.presets');
sw('models.showCompare', '프리셋 비교 보이기', 'Show preset comparison', false, { desc: '프리셋 편집에 비교 버튼을 보여요|Shows the compare button in the preset editor', syn: 'showPromptComparison show prompt comparison compare diff 비교 프롬프트 비교', p5c: false });
sec('data.backup');
sw('data.goCharOnImport', '가져온 뒤 캐릭터로 이동', 'Go to the character after import', false, { desc: 'RisuRealm에서 가져오면 그 캐릭터로 바로 가요|After importing from RisuRealm, jump to that character', syn: 'goCharacterOnImport go to character on realm import 가져온 뒤 캐릭터로 이동 가져오기', p5c: false });
sec('adv.dev');
sw('adv.requestInfo', '채팅에 요청 정보 보이기', 'Show request info in the chat', false, { desc: '모델, 토큰 같은 요청 정보를 메시지 아래에 보여요|Shows request details such as the model and tokens under messages', syn: 'requestInfoInsideChat show request info inside chat 요청 정보 채팅 안에 요청 정보 토큰', p5c: false });
const keep = add('select', 'adv.keepAlive', '세션 유지', 'Keep session alive', { d: 'off', v: 'off', opt: opts('off:끔|Off;sound:소리로 유지|Via sound'), help: '앱이 백그라운드에서도 계속 돌게 해요. Android에서는 이미 따로 돌고 있어서 이 설정이 나오지 않아요.|Keeps the app running in the background. On Android it already runs as a service, so the setting is not shown there.', syn: 'keepSessionAlive keep session alive background 세션 유지', p5c: false });
void keep;

{ const r = ROWI['adv.proTools']; if (r) { Object.assign(r, { type: 'nav', target: 'input.proTools', ko: '고급 도구 보이기', en: 'Show advanced tools', desc: '입력·접근성에 있어요|It lives in Input & accessibility' }); delete r.v; delete r.d; } const ep = ROWI['adv.easyPanel']; if (ep) ep.dep = { id: 'input.proTools', eq: true }; }
/* ---------------------------------------------------------------- slice 3's retired note: the global switch is gone, every key field has its own show button (DS-164) */
{ const n = ROWI['models.hideApiKey']; if (n) { n.ko = '키는 항상 가려져요 · 칸마다 보기 버튼이 있어요'; n.en = 'Keys are always hidden · every key field has a Show button'; n.syn = (n.syn || '') + ' hideApiKey hide api keys 키 숨기기 키 보기 눈 reveal'; } }

/* rows the page draws itself (radio cards, swatches, the mode boxes, the background and notification rows): they carry no reset menu, because slice 1's reset would redraw them as a plain control. d0 keeps the default for reset(). */
['display.theme', 'display.colorScheme', 'display.modeRp', 'display.modeHybrid', 'display.modeUtility', 'display.background', 'display.textScreenColor', 'display.textScreenBorder', 'display.notification'].forEach((id) => { const r = ROWI[id]; r.d0 = r.d; r.d = undefined; r.custom = true; });

/* ---------------------------------------------------------------- fixtures: reset() puts the store and every row of this slice back to a set (used at load and by every state, so a state run after another one starts clean) */
const MOVED_IDS = ['models.showCompare', 'data.goCharOnImport', 'adv.requestInfo', 'adv.keepAlive'];
const KEEP_IDS = ['display.lowPower', 'display.reducedMotion', 'display.animSpeed'];   // slice 1 owns these three (the URL, the demo panel and the system setting set them); the slice's states reset them by calling slice 1
const isLive = (r) => { const d = Object.getOwnPropertyDescriptor(r, 'v'); return !!(d && d.get); };
function applySet(set, fixture) {
  if (set === 'custom') {
    ROWI['display.theme'].v = 'customHTML'; ROWI['display.guiHtml'].v = '<div class="card {{role}}">\n  <h4>{{name}}</h4>\n  <p>{{message}}</p>\n</div>';
    ROWI['display.colorScheme'].v = 'custom'; ST.colors = { bgcolor: '#1e2a2f', darkbg: '#162126', borderc: '#7fb8a4', selected: '#2f4a4f', draculared: '#ff6b6b', textcolor: '#eef6f2', textcolor2: '#8aa3a0', darkBorderc: '#3d5559', darkbutton: '#2a3d42', type: 'dark' };
    ROWI['display.customQuotes'].v = true; ST.quotes = ['「', '」', '『', '』'];
    ROWI['display.font'].v = 'custom'; ROWI['display.customFont'].v = 'Noto Serif KR';
    ST.bg = { name: 'rain-window.gif', kb: 3270, type: 'gif' };
  }
  if (fixture) ROWI['display.hideUnused'].v = true;
}
function reset(set, fixture, home, perm) {
  const fresh = makeST(set, fixture, home, perm || (set === 'denied' ? 'denied' : 'granted'));
  Object.keys(ST).forEach((k) => { delete ST[k]; }); Object.assign(ST, fresh);
  rows.forEach((r) => { const base = r.d !== undefined ? r.d : r.d0; if ((r.p5c || MOVED_IDS.indexOf(r.id) >= 0) && base !== undefined && !isLive(r) && KEEP_IDS.indexOf(r.id) < 0) r.v = base; });
  ROWI['display.hideUnused'].v = !!fixture; applySet(set, fixture);
}
applySet(SET5C, FIXTURE);

/* ---------------------------------------------------------------- copy */
const K = { ko: {}, en: {} };
Object.assign(K.ko, {
  title: '설정 슬라이스 5c-1 · 화면·읽기, 입력·접근성 목업', undo: '되돌리기', cancel: '취소', ok: '확인', newTag: '새 기능', newTagTitle: '앱에 없던 새 기능이에요 (제안)', moreTitle: '이 설정의 메뉴',
  back: '돌아가기', backDisplay: '화면·읽기로 돌아가기', backDisplayS: '화면·읽기', backInput: '입력·접근성으로 돌아가기', backInputS: '입력·접근성',
  // 모드 (DD-250)
  mdNote: '홈에 보일 모드를 골라요. 하나는 항상 보여야 해요.', mdLegend: '홈에 보일 모드',
  modeName: (m) => ({ rp: '롤플레이', hybrid: '하이브리드', utility: '유틸리티' }[m] || m),
  modeDesc: (m) => ({ rp: '캐릭터와 이야기를 이어 가요', hybrid: '캐릭터와 함께 글쓰기나 코딩 같은 일을 해요', utility: '캐릭터 없이 작업만 맡겨요' }[m] || ''),
  mdLockHome: '지금 쓰고 있는 모드예요', mdLockLast: '하나는 보여야 해요', mdLockOff: '숨기기가 꺼져 있어요',
  mdBanner: (n) => `홈에 ${n} 모드만 보이고 있어요`, mdBannerSub: '아래에서 다시 보이게 할 수 있어요.',
  mdStatusAll: '모드 3개가 모두 보여요', mdStatusSome: (k, names) => `모드 3개 중 ${k}개가 보여요: ${names}`,
  mdShowAll: '모든 모드 보이기', mdAlready: '이미 모두 보여요',
  mdConfirmT: '모든 모드를 보일까요?', mdConfirmBody: (names) => `${names} 모드가 홈에 다시 보여요. ‘쓰지 않는 모드 숨기기’도 꺼져요.`, mdConfirmDo: '모두 보이기',
  mdDone: '모든 모드를 다시 보이게 했어요', mdDoneSub: '홈으로 돌아가면 바로 보여요', mdToggled: (n, on) => `${n} 모드를 ${on ? '보이게' : '숨기게'} 했어요`, luModes: '모드 보이기 바꾸기', luShowAll: '모든 모드 보이기',
  // 테마와 색
  thLegend: '채팅 테마', thDesc: (v) => ({ '': '메시지가 위아래로 이어지는 기본 모양이에요', waifu: '캐릭터 그림을 크게 두고 옆에 대화를 보여요', mobilechat: '메신저처럼 말풍선이 좌우로 나뉘어요', cardboard: '메시지가 카드 모양 상자에 담겨요', customHTML: '메시지 모양을 HTML로 직접 짜요' }[v] || ''),
  scLegend: '색 구성', scCustom: '직접 만들기', scName: (id) => id,
  edColorsT: '직접 만든 색', edColorsNote: '앱 전체에 쓸 색 아홉 개와 어두운·밝은 종류를 정해요. 색 구성에서 ‘직접 만들기’를 고르면 이 색을 써요.', edType: '종류', edDark: '어두운 색', edLight: '밝은 색',
  edTextT: '직접 만든 글자 색', edTextNote: '글자 종류마다 색을 정해요. 글자 색에서 ‘직접 만들기’를 고르면 이 색을 써요.', edTextPrev: '미리보기', edTextSample: ['보통 글자', '기울인 글자', '굵은 글자', '굵은 기울임', '“큰따옴표 안”', '‘작은따옴표 안’'],
  ckBg: '배경', ckDarkbg: '어두운 배경', ckBorderc: '테두리', ckSelected: '선택한 항목', ckDraculared: '위험·삭제', ckTextcolor: '글자', ckTextcolor2: '보조 글자', ckDarkBorderc: '어두운 테두리', ckDarkbutton: '어두운 버튼',
  tkFontColorStandard: '보통 글자', tkFontColorItalic: '기울인 글자', tkFontColorBold: '굵은 글자', tkFontColorItalicBold: '굵은 기울임', tkFontColorQuote1: '큰따옴표 안', tkFontColorQuote2: '작은따옴표 안',
  hexOf: (l) => `${l} (16진수)`, hexBad: '#과 여섯 자리 16진수로 적어 주세요. 예: #1a2b3c', pickOf: (l) => `${l} 색 고르기`,
  bgNone: '고른 파일이 없어요', bgPick: '파일 고르기', bgChange: '바꾸기', bgClear: '지우기', bgPickT: '배경 이미지 고르기', bgPickDo: '이 파일 쓰기', bgPickHint: 'png, webp, gif 파일만 쓸 수 있어요 (모의 파일 목록)', bgBad: '이 형식은 쓸 수 없어요. png, webp, gif만 골라 주세요', bgOkLine: (n) => `${n} · 쓸 수 있어요`,
  bgGif: '움직이는 배경은 저전력 기기에서 느릴 수 있어요', bgSet: '배경 이미지를 바꿨어요', bgCleared: '배경 이미지를 지웠어요', bgLu: '배경 이미지 지우기', bgSize: (kb) => (kb >= 1024 ? (kb / 1024).toFixed(1) + ' MB' : kb + ' KB'),
  chatScreen: '채팅 화면', pvLabel: '미리보기', pvText: '안녕하세요, 오늘은 어디로 갈까요?',
  // 글꼴과 크기
  stepName: (v) => STEP_KO[v + 5], stepOf: (n, name) => `${n}: ${name}`, closeOnlyWide: '설정 닫기 버튼 크기는 넓은 화면에서만 쓰여요', resetTo100: '100%로',
  // 채팅 표시
  qLegend: '따옴표 모양', qOpenD: '여는 큰따옴표', qCloseD: '닫는 큰따옴표', qOpenS: '여는 작은따옴표', qCloseS: '닫는 작은따옴표', qPrev: '미리보기', qSample: (a, b, c, d) => `${a}안녕하세요${b} ${c}괜찮아요${d}`, qOne: '한두 글자까지 쓸 수 있어요',
  fpReason: '스와이프가 꺼져 있어서 지금은 쓰지 않아요', fpGo: '스와이프로 이동', bqReason: '따옴표 꾸미기가 꺼져 있어서 지금은 쓰지 않아요', bqGo: '따옴표 꾸미기로 이동',
  // 소리와 알림
  nsGranted: '브라우저 권한: 허용됨', nsDenied: '브라우저 권한: 차단됨 (브라우저 설정에서 바꿔요)', nsDefault: '켜면 브라우저가 허용을 물어봐요', nsUnsupported: '이 기기에서는 지원하지 않아요', nsOffByDeny: '알림이 차단돼서 껐어요 (브라우저 설정에서 바꿔요)',
  nsAsk: '알림을 허용할까요?', nsAskBody: '브라우저가 묻는 창이에요 (모의). 허용하면 새 답이 왔을 때 알려 드려요.', nsAllow: '허용', nsBlock: '차단', nsOn: '알림을 켰어요', nsOff: '알림을 껐어요', nsDismissed: '묻는 창을 닫아서 알림은 꺼져 있어요',
  // 움직임과 성능
  asSlow: '느림', asFast: '빠름', asName: (d) => (d === 0 ? '즉시' : d <= 0.25 ? '빠름' : d < 0.6 ? '보통' : '느림'), asText: (name, d) => (d === 0 ? `${name} (0초)` : `${name}, ${d}초`), asAria: '애니메이션 속도, 느림에서 빠름까지',
  asDimRm: '움직임 줄이기가 켜져 있어 지금은 쓰지 않아요', asDimSys: '시스템이 움직임 줄이기를 쓰고 있어 지금은 쓰지 않아요', asDimLp: '저전력 모드가 켜져 있어 지금은 쓰지 않아요', hapticsDesktop: '진동은 터치 기기에서만 써요',
  // 입력
  hoverOnly: '마우스가 있어야 써요', hoverOnlyReason: '이 기기는 터치만 쓸 수 있어서 마우스를 올릴 수 없어요',
  scrollNoteOff: '자동 스크롤이 꺼져 있어서 항상 스크롤과 새 메시지 버튼 위치는 나오지 않아요', scrollNoteAlways: '항상 스크롤이 켜져 있어서 새 메시지 버튼 위치는 나오지 않아요',
  npLegend: '새 메시지 버튼 위치', npNote: '위로 올려 보고 있을 때 나타나요',
  posName: (v) => ({ 'bottom-center': '아래 가운데', 'bottom-right': '아래 오른쪽', 'bottom-left': '아래 왼쪽', 'floating-circle': '떠 있는 원', 'right-center': '오른쪽 가운데', 'top-bar': '위 막대' }[v] || v),
  inputMenuH: '입력창 메뉴',
  sbCount: (n) => `항목 ${n}개`, sbOpen: '고치기', sbT: '사이드바 항목', sbNote: '사이드바에 넣을 항목을 더하고 빼요', sbEmpty: '아직 항목이 없어요', sbAdd: '항목 더하기', sbRemove: '지우기', sbRemoveOf: (n) => `${n} 지우기`, sbRemoved: '사이드바 항목을 지웠어요', sbLu: '사이드바 항목 지우기', sbAddedT: '사이드바 항목을 더했어요',
  sbAddT: '항목 더하기', sbTypes: { model: '모델', preset: '프리셋', loadout: '로드아웃', persona: '페르소나', setting: '설정' }, sbSettingQ: '설정 찾기', sbSettingHint: '더할 설정을 찾아서 골라요', sbNoHit: '맞는 설정이 없어요', sbBack: '종류 다시 고르기', sbTypeFirst: '더할 항목의 종류를 골라요',
  easyNote: '글자 색, 글자 크기, 입력창 크기는 화면·읽기에 있어요',
  // 되돌리기 / 다시 정하기
  resetDone: (l) => `기본값으로 되돌렸어요: ${l}`, luReset: (l) => `${l} 기본값으로`, luSkip: '그 사이에 바뀌어서 되돌리지 않았어요',
  // 키 보기 (DS-164)
  revShow: '키 보기', revHide: '키 가리기', revOf: (n) => `${n} 보기`, revHideOf: (n) => `${n} 가리기`,
  // 검색
  ceExport: '색 내보내기', ceImport: '색 가져오기', ceExported: '직접 만든 색을 파일로 내보냈어요', ceImportT: '색 파일 가져오기', ceImportDo: '이 파일 쓰기', ceImportHint: '직접 만든 색 파일(.json)을 골라요 (모의 파일 목록)', ceImportBad: '이 파일은 색 파일이 아니에요. 내용이 깨졌거나 다른 종류예요', ceImportOk: (n) => `${n} · 색 아홉 개와 종류가 들어 있어요`, ceImported: '색 파일을 가져왔어요', ceLu: '색 가져오기',
  stGo: '스튜디오에서 바꿔요', stLabel: (n) => `${n} · 스튜디오에서 바꿔요`,
  // 숫자
  jump: '이동',
  demo5c: '슬라이스 5c-1', demoSet: '데이터 세트', demoPerm: '알림 권한', demoMode: '홈의 모드', demoFix: '모드 복구 상태', demoState: '상태 (5c-1)', demoGo: '열기',
  setDemo: '기본', setTouch: '터치 기기', setDesktop: '데스크톱 앱', setCustom: '직접 만든 설정', setDenied: '알림 차단',
  permGranted: '허용됨', permDefault: '아직 안 물음', permDenied: '차단됨', permUnsupported: '지원 안 함',
});
Object.assign(K.en, {
  title: 'Settings slice 5c-1 · Display and input mockup', undo: 'Undo', cancel: 'Cancel', ok: 'OK', newTag: 'New', newTagTitle: 'A new feature the app did not have (proposal)', moreTitle: 'Menu for this setting',
  back: 'Back', backDisplay: 'Back to Display & reading', backDisplayS: 'Display & reading', backInput: 'Back to Input & accessibility', backInputS: 'Input & accessibility',
  mdNote: 'Choose the modes Home shows. One has to stay visible.', mdLegend: 'Modes shown on Home',
  modeName: (m) => ({ rp: 'Roleplay', hybrid: 'Hybrid', utility: 'Utility' }[m] || m),
  modeDesc: (m) => ({ rp: 'Carry on stories with characters', hybrid: 'Work on writing or code together with a character', utility: 'Hand off a task, no character needed' }[m] || ''),
  mdLockHome: 'The mode you are using now', mdLockLast: 'One has to stay visible', mdLockOff: 'Hiding is off',
  mdBanner: (n) => `Home shows only ${n}`, mdBannerSub: 'You can show the others again below.',
  mdStatusAll: 'All 3 modes are visible', mdStatusSome: (k, names) => `${k} of 3 modes are visible: ${names}`,
  mdShowAll: 'Show all modes', mdAlready: 'All modes are already visible',
  mdConfirmT: 'Show all modes?', mdConfirmBody: (names) => `${names} will show on Home again. “Hide unused modes” turns off too.`, mdConfirmDo: 'Show all',
  mdDone: 'All modes are visible again', mdDoneSub: 'They show on Home as soon as you go back', mdToggled: (n, on) => `${n} is now ${on ? 'shown' : 'hidden'}`, luModes: 'change visible modes', luShowAll: 'show all modes',
  thLegend: 'Chat theme', thDesc: (v) => ({ '': 'The default look: messages stacked top to bottom', waifu: 'A large character picture with the chat beside it', mobilechat: 'Speech bubbles on left and right, like a messenger', cardboard: 'Each message sits in a card-like box', customHTML: 'Write the message layout yourself in HTML' }[v] || ''),
  scLegend: 'Colour scheme', scCustom: 'Custom', scName: (id) => id,
  edColorsT: 'Your colours', edColorsNote: 'Set nine colours for the whole app and whether it is dark or light. Choose “Custom” under Colour scheme to use them.', edType: 'Type', edDark: 'Dark colours', edLight: 'Light colours',
  edTextT: 'Your text colours', edTextNote: 'Set a colour for each kind of text. Choose “Custom” under Text colour to use them.', edTextPrev: 'Preview', edTextSample: ['Normal text', 'Italic text', 'Bold text', 'Bold italic', '“Inside double quotes”', '‘Inside single quotes’'],
  ckBg: 'Background', ckDarkbg: 'Dark background', ckBorderc: 'Border', ckSelected: 'Selected item', ckDraculared: 'Danger and delete', ckTextcolor: 'Text', ckTextcolor2: 'Secondary text', ckDarkBorderc: 'Dark border', ckDarkbutton: 'Dark button',
  tkFontColorStandard: 'Normal text', tkFontColorItalic: 'Italic text', tkFontColorBold: 'Bold text', tkFontColorItalicBold: 'Bold italic', tkFontColorQuote1: 'Inside double quotes', tkFontColorQuote2: 'Inside single quotes',
  hexOf: (l) => `${l} (hex)`, hexBad: 'Write # and six hex digits. Example: #1a2b3c', pickOf: (l) => `Pick the ${l} colour`,
  bgNone: 'No file chosen', bgPick: 'Choose a file', bgChange: 'Change', bgClear: 'Clear', bgPickT: 'Choose a background image', bgPickDo: 'Use this file', bgPickHint: 'Only png, webp and gif files work (a made-up file list)', bgBad: 'That format does not work. Choose png, webp or gif', bgOkLine: (n) => `${n} · works`,
  bgGif: 'An animated background can be slow on low-power devices', bgSet: 'Background image changed', bgCleared: 'Background image cleared', bgLu: 'clear the background image', bgSize: (kb) => (kb >= 1024 ? (kb / 1024).toFixed(1) + ' MB' : kb + ' KB'),
  chatScreen: 'Chat screen', pvLabel: 'Preview', pvText: 'Hello, where shall we go today?',
  stepName: (v) => STEP_EN[v + 5], stepOf: (n, name) => `${n}: ${name}`, closeOnlyWide: 'The settings close button size only applies on wide screens', resetTo100: 'To 100%',
  qLegend: 'Quote marks', qOpenD: 'Opening double quote', qCloseD: 'Closing double quote', qOpenS: 'Opening single quote', qCloseS: 'Closing single quote', qPrev: 'Preview', qSample: (a, b, c, d) => `${a}Hello${b} ${c}It is fine${d}`, qOne: 'One or two characters each',
  fpReason: 'Swipe is off, so this is not used right now', fpGo: 'Go to Swipe', bqReason: 'Style quotes is off, so this is not used right now', bqGo: 'Go to Style quotes',
  nsGranted: 'Browser permission: allowed', nsDenied: 'Browser permission: blocked (change it in the browser settings)', nsDefault: 'When you turn it on, the browser asks for permission', nsUnsupported: 'Not supported on this device', nsOffByDeny: 'Notifications are blocked, so they were turned off (change it in the browser settings)',
  nsAsk: 'Allow notifications?', nsAskBody: 'This stands in for the browser prompt (simulated). If you allow it, you are told when a new reply arrives.', nsAllow: 'Allow', nsBlock: 'Block', nsOn: 'Notifications are on', nsOff: 'Notifications are off', nsDismissed: 'The prompt was closed, so notifications stay off',
  asSlow: 'Slow', asFast: 'Fast', asName: (d) => (d === 0 ? 'Instant' : d <= 0.25 ? 'Fast' : d < 0.6 ? 'Normal' : 'Slow'), asText: (name, d) => (d === 0 ? `${name} (0 s)` : `${name}, ${d} s`), asAria: 'Animation speed, from slow to fast',
  asDimRm: 'Reduce motion is on, so this is not used right now', asDimSys: 'The system asks for reduced motion, so this is not used right now', asDimLp: 'Low-power mode is on, so this is not used right now', hapticsDesktop: 'Vibration only works on touch devices',
  hoverOnly: 'Needs a mouse', hoverOnlyReason: 'This device is touch only, so there is nothing to hover with',
  scrollNoteOff: 'Auto-scroll is off, so Always scroll and the new-message button position are not shown', scrollNoteAlways: 'Always scroll is on, so the new-message button position is not shown',
  npLegend: 'New-message button position', npNote: 'Appears when you have scrolled up',
  posName: (v) => ({ 'bottom-center': 'Bottom centre', 'bottom-right': 'Bottom right', 'bottom-left': 'Bottom left', 'floating-circle': 'Floating circle', 'right-center': 'Right centre', 'top-bar': 'Top bar' }[v] || v),
  inputMenuH: 'Input box menu',
  sbCount: (n) => `${n} item${n === 1 ? '' : 's'}`, sbOpen: 'Edit', sbT: 'Sidebar items', sbNote: 'Add and remove the items in the sidebar', sbEmpty: 'No items yet', sbAdd: 'Add an item', sbRemove: 'Remove', sbRemoveOf: (n) => `Remove ${n}`, sbRemoved: 'Sidebar item removed', sbLu: 'remove a sidebar item', sbAddedT: 'Sidebar item added',
  sbAddT: 'Add an item', sbTypes: { model: 'Model', preset: 'Preset', loadout: 'Loadout', persona: 'Persona', setting: 'Setting' }, sbSettingQ: 'Find a setting', sbSettingHint: 'Find the setting to add and pick it', sbNoHit: 'No setting matches', sbBack: 'Pick another kind', sbTypeFirst: 'Pick the kind of item to add',
  easyNote: 'Text colour, text size and input box size are in Display & reading',
  resetDone: (l) => `Reset to its default: ${l}`, luReset: (l) => `reset ${l}`, luSkip: 'It changed in the meantime, so nothing was undone',
  revShow: 'Show key', revHide: 'Hide key', revOf: (n) => `Show ${n}`, revHideOf: (n) => `Hide ${n}`,
  ceExport: 'Export colours', ceImport: 'Import colours', ceExported: 'Your colours were exported to a file', ceImportT: 'Import a colour file', ceImportDo: 'Use this file', ceImportHint: 'Pick a custom colour file (.json) (a made-up file list)', ceImportBad: 'This is not a colour file. It is broken or another kind of file', ceImportOk: (n) => `${n} · holds nine colours and the type`, ceImported: 'Colour file imported', ceLu: 'import colours',
  stGo: 'Change it in Studio', stLabel: (n) => `${n} · change it in Studio`,
  jump: 'Go',
  demo5c: 'Slice 5c-1', demoSet: 'Data set', demoPerm: 'Notification permission', demoMode: 'Home’s mode', demoFix: 'Mode repair state', demoState: 'State (5c-1)', demoGo: 'Open',
  setDemo: 'Default', setTouch: 'Touch device', setDesktop: 'Desktop app', setCustom: 'Custom setup', setDenied: 'Notifications blocked',
  permGranted: 'Allowed', permDefault: 'Not asked yet', permDenied: 'Blocked', permUnsupported: 'Not supported',
});

const DC = window.SS5C1_DATA = { SET5C, SETS, FIXTURE, HOME, MODES, MODE_Q, PERMS, PERM_Q, ST, K, reset, makeST, SCHEMES, COLOR_FILES, COLOR_KEYS, TEXT_KEYS, BG_FILES, STEP_KO, STEP_EN, POSITIONS, STUDIO_MOVED,
  isPhone: () => false, isTouch: () => ST.platform.touch };
})();
