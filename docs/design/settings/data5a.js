/* Settings slice 5a (단축키, 페르소나, 확장) fixtures and copy. Synthetic; loaded after data.js .. data4.js and before slice2.js / slice1.js.
   Mutates window.SS1_DATA in place (rows, sections, pages, personas, plugins, modules) so slice 1 code keeps working on the same arrays, then publishes window.SS5A_DATA.
   Nothing here is read from or written to the real app. Plugin "code" is a stub string and never runs. Keys, URLs and files are invented (.invalid).
   Sets (?set=): demo, mac (demo with a Mac platform), empty (1 persona, no plugins, no modules), many (40 modules, 12 personas).
   Switches: ?msel=1 model select handler present (ENGINE_CHANGES 3-10), ?kbd=1 hardware keyboard detected, ?note=0 persona notes off, ?scroll=0 scrollToActiveChar setting off.
   Floor devices (Note 9 / Android 10 WebView, Raspberry Pi 3): no optional chaining, nullish coalescing, .at(), replaceAll, structuredClone. */
(() => {
'use strict';
const D = window.SS1_DATA;
const Q = new URLSearchParams(location.search);
const SET5 = ['demo', 'mac', 'empty', 'many'].includes(Q.get('set')) ? Q.get('set') : 'demo';
const FLAGS = { msel: Q.get('msel') === '1', kbd: Q.get('kbd') === '1', note: Q.get('note') !== '0', scroll: Q.get('scroll') !== '0' };
const PLATFORM = SET5 === 'mac' ? 'mac' : 'win';

/* ---------------------------------------------------------------- pages and sections: slice 5a is these three pages, so the "later" banners go */
['persona', 'ext', 'keys'].forEach((id) => { D.PAGES.find((p) => p.id === id).later = undefined; });
D.PAGES.find((p) => p.id === 'keys').syn += ' shortcuts rebind 키 바꾸기 단축 키 지정 hotkey';
D.PAGES.find((p) => p.id === 'ext').syn += ' plugin module mcp namespace 네임스페이스 설치';
const dropSec = (id) => { const i = D.SECTIONS.findIndex((s) => s.id === id); if (i >= 0) D.SECTIONS.splice(i, 1); };
['keys.main', 'keys.presets'].forEach(dropSec);
[['keys.msg', '메시지', 'Messages'], ['keys.nav', '이동', 'Navigation'], ['keys.slots', '프리셋 슬롯', 'Preset slots'], ['keys.tools', '도구', 'Tools'], ['keys.fixed', '고정 키', 'Fixed keys']].forEach(([id, ko, en]) => {
  const at = D.SECTIONS.findIndex((s) => s.page === 'adv'); D.SECTIONS.splice(at < 0 ? D.SECTIONS.length : at, 0, { page: 'keys', id, ko, en });
});

/* ---------------------------------------------------------------- rows: the old persona / extension / shortcut rows are retired; a few stay as action targets of search (the header buttons carry their ids) */
const KEEP = ['persona.add', 'persona.import', 'ext.pluginImport', 'ext.pluginUpdate', 'ext.moduleNew', 'ext.moduleImport', 'ext.moduleMcp', 'ext.plugPage1', 'ext.plugPage2'];
for (let i = D.rows.length - 1; i >= 0; i--) { const r = D.rows[i]; if ((r.page === 'persona' || r.page === 'ext' || r.page === 'keys') && KEEP.indexOf(r.id) < 0) D.rows.splice(i, 1); }
const row = (id) => D.rows.find((r) => r.id === id);
Object.assign(row('persona.add'), { ko: '새 페르소나', en: 'New persona', syn: 'add persona create 추가 만들기' });
Object.assign(row('persona.import'), { ko: '페르소나 가져오기 (PNG)', en: 'Import a persona (PNG)', syn: 'import persona png 가져오기' });
Object.assign(row('ext.pluginImport'), { ko: '플러그인 설치', en: 'Install a plugin', syn: 'import plugin install file 가져오기 설치 파일' });
Object.assign(row('ext.pluginUpdate'), { ko: '플러그인 업데이트 확인', en: 'Check plugins for updates', syn: 'plugin update check 업데이트' });
Object.assign(row('ext.moduleNew'), { ko: '새 모듈', en: 'New module', syn: 'create module add module 모듈 만들기', act: undefined });
Object.assign(row('ext.moduleImport'), { ko: '모듈 파일 가져오기', en: 'Import a module file', syn: 'import module risum charx lorebook json 가져오기' });
Object.assign(row('ext.moduleMcp'), { ko: 'MCP 연결', en: 'Connect an MCP server', syn: 'mcp import tools server 연결 가져오기' });

/* the shortcut rows: type 'key'. v = the chord now ('' = unbound), d = the default; combo mirrors v (slice 1 prints it in search results). Chord form: modifiers in the order Ctrl, Alt, Shift, then the key ("Ctrl+Alt+R"); Ctrl is shown as the command key on a Mac (DS-109). */
const DUP = SET5 !== 'empty';
const HK = [
  // [code, group, ko, en, default chord, extra synonyms, option]
  ['reroll', 'msg', '다시 생성', 'Regenerate', 'Ctrl+Alt+R', '새 답변 리롤 reroll', {}],
  ['unreroll', 'msg', '이전 답변으로', 'Previous reply', 'Ctrl+Alt+F', '이전 답변 되돌리기 unreroll', {}],
  ['translate', 'msg', '번역', 'Translate', 'Ctrl+Alt+T', 'translate', {}],
  ['remove', 'msg', '메시지 삭제', 'Delete message', 'Ctrl+Alt+D', '삭제 지우기 remove delete', {}],
  ['edit', 'msg', '메시지 수정', 'Edit message', 'Ctrl+Alt+E', '수정 편집 edit', {}],
  ['copy', 'msg', '메시지 복사', 'Copy message', 'Ctrl+Alt+C', '복사 copy', {}],
  ['send', 'msg', '보내기', 'Send', 'Ctrl+Alt+Enter', '전송 send', {}],
  ['settings', 'nav', '설정 열기', 'Open settings', 'Ctrl+S', 'settings', {}],
  ['home', 'nav', '홈', 'Home', 'Ctrl+H', 'home', {}],
  ['presets', 'nav', '프리셋 목록', 'Preset list', 'Ctrl+P', '프리셋 전환 presets', {}],
  ['persona', 'nav', '페르소나 바꾸기', 'Change persona', 'Ctrl+E', 'persona', {}],
  ['prevChar', 'nav', '이전 캐릭터', 'Previous character', 'Ctrl+[', 'prevChar', {}],
  ['nextChar', 'nav', '다음 캐릭터', 'Next character', 'Ctrl+]', 'nextChar', {}],
  ['quickMenu', 'nav', '빠른 메뉴', 'Quick menu', 'Ctrl+`', 'quickMenu', {}],
  ['quickSettings', 'nav', '빠른 설정', 'Quick settings', 'Ctrl+Q', 'quickSettings', {}],
  ['loadout', 'nav', '로드아웃', 'Loadout', 'Ctrl+O', 'loadout', {}],
  ['focusInput', 'nav', '입력창으로 이동', 'Focus the input', 'Space', 'focusInput', {}],
  ['scrollToActiveChar', 'nav', '현재 캐릭터로 스크롤', 'Scroll to the active character', 'Ctrl+G', 'scrollToActiveChar scrollActive', { cond: 'scroll' }],
  ['modelSelect', 'nav', '모델 선택', 'Select model', 'Ctrl+M', 'modelSelect 모델 바꾸기', { cond: 'msel' }],
  ['toggleCSS', 'tool', '안전 모드 켜고 끄기', 'Toggle safe mode', 'Ctrl+.', '커스텀 CSS safe mode toggleCSS', {}],
  ['toggleLog', 'tool', '로그 켜고 끄기', 'Toggle log', 'Ctrl+L', 'toggleLog', { desc: '브라우저가 이 키를 먼저 가져갈 수 있어요|The browser may take this key first' }],
  ['previewRequest', 'tool', '요청 미리보기', 'Preview request', 'Ctrl+U', 'previewRequest', {}],
  ['popupEditor', 'tool', '팝업 편집기', 'Popup editor', 'Ctrl+X', 'popupEditor', { desc: '글을 쓰는 중에는 텍스트 편집이 이 키를 먼저 가져갈 수 있어요|Text editing may take this key first while you type' }],
];
const FIXED = [
  ['esc', '창 닫기', 'Close', 'Esc', '창과 알림을 닫아요', 'Closes windows and notices'],
  ['enter', '확인', 'Confirm', 'Enter', '확인 창에서 확인을 눌러요', 'Presses OK in a confirm'],
  ['undoLib', '프리셋 목록에서 되돌리기', 'Undo in the preset list', 'Ctrl+Z', '목록에서 마지막 작업을 되돌려요', 'Undoes the last action in a list'],
  ['undoAlt', '마지막 작업 되돌리기', 'Undo the last action', 'Alt+Z', '설정 어디서나 마지막 작업을 되돌려요', 'Undoes the last action anywhere in Settings'],
];
const NAMED_DUP = { quickSettings: 'Ctrl+K', loadout: 'Ctrl+K' };   // the stored duplicate of the demo: two actions on Ctrl+K (SLICE5A_SPEC 10.2)
HK.forEach(([code, grp, ko, en, def, syn, o]) => {
  const start = DUP && NAMED_DUP[code] ? NAMED_DUP[code] : def;
  D.rows.push(Object.assign({ type: 'key', id: 'keys.' + code, sec: 'keys.' + ({ msg: 'msg', nav: 'nav', tool: 'tools' }[grp]), page: 'keys', ko, en, grp, code, v: start, d: def, syn: 'hotkey 핫키 shortcut keyboard 단축키 ' + code + ' ' + syn }, o));
});
for (let n = 1; n <= 9; n++) {
  const r = { type: 'key', id: 'keys.presetSlot' + n, sec: 'keys.slots', page: 'keys', ko: '프리셋 ' + n + '번', en: 'Preset ' + n, grp: 'slot', code: 'presetSlot' + n, slot: n, d: 'Ctrl+' + n, syn: 'hotkey 핫키 shortcut 프리셋 슬롯 preset slot presetSlot' + n + ' ctrl ' + n };
  Object.defineProperty(r, 'v', { enumerable: true, configurable: true, get() { const b = window.__ss2; return b && b.SLOTKEY ? b.SLOTKEY[n] : 'Ctrl+' + n; }, set(x) { const b = window.__ss2; if (b && b.SLOTKEY) b.SLOTKEY[n] = x; } });   // the slot keys live in slice 2's store (one place; slice 2's key handler reads them)
  D.rows.push(r);
}
FIXED.forEach(([code, ko, en, chord, dk, de]) => D.rows.push({ type: 'key', id: 'keys.' + code, sec: 'keys.fixed', page: 'keys', ko, en, grp: 'fixed', code, fixed: true, v: chord, d: chord, desc: dk + '|' + de, syn: 'hotkey 핫키 shortcut 고정 fixed ' + code }));
D.rows.filter((r) => r.page === 'keys' && r.type === 'key').forEach((r) => {
  if (!Object.getOwnPropertyDescriptor(r, 'v').get) { /* plain value */ }
  Object.defineProperty(r, 'combo', { enumerable: true, configurable: true, get() { return r.v || ''; } });
});
D.rows.sort((a, b) => D.SECTIONS.findIndex((s) => s.id === a.sec) - D.SECTIONS.findIndex((s) => s.id === b.sec));

/* ---------------------------------------------------------------- characters and chats (the stores the persona bindings and the module layers live in) */
const CHARS = [['ch1', '세라핀', 'Seraphina'], ['ch2', '루나', 'Luna'], ['ch3', '카일', 'Kyle'], ['ch4', '미야', 'Miya'], ['ch5', 'Rex', 'Rex'], ['ch6', '하윤', 'Hayun'], ['ch7', 'Ada', 'Ada'], ['ch8', '도현', 'Dohyun']].map((c) => ({ id: c[0], ko: c[1], en: c[2], modules: [] }));
const CHATS = [['c1', 'ch1', '숲길의 밤', 'Night on the forest road'], ['c2', 'ch1', '언덕 위의 불빛', 'The light on the hill'], ['c3', 'ch2', '달빛 도서관', 'Moonlit library'], ['c4', 'ch3', '새벽 시장', 'Dawn market'], ['c5', 'ch4', '여름 축제', 'Summer festival'], ['c6', 'ch5', 'Debug session', 'Debug session'], ['c7', 'ch6', '비 오는 날', 'A rainy day'], ['c8', 'ch7', '첫 만남', 'First meeting'], ['c9', 'ch8', '항구 마을', 'Harbour town'], ['c10', 'ch2', '별을 세는 밤', 'Counting stars']].map((c) => ({ id: c[0], char: c[1], ko: c[2], en: c[3], persona: '', modules: [] }));

/* ---------------------------------------------------------------- personas */
const PER_SEED = [
  // id, name, note ko, note en, description, icon (a Lucide name; '' = the initial on a tinted disc), large, bound chats
  ['u1', '주노', '기본 페르소나', 'Default persona', '여행을 좋아하는 스무 살 대학생이에요. 말투는 부드럽고 호기심이 많아요.', 'user-round', false, []],
  ['u2', 'Alex', 'Test persona', 'Test persona', 'A careful tester who writes short, direct messages and likes lists.', 'sparkles', false, ['c1', 'c2']],
  ['u3', '미라', '여행 작가', 'Travel writer', '세계 곳곳을 다니며 글을 쓰는 작가예요. 장면을 자세히 묘사하는 걸 좋아해요.', 'compass', true, []],
  ['u4', '서연', '탐정', 'Detective', '', 'book-open', false, []],
  ['u5', 'Kai', '모험가', 'Adventurer', '지도 없이도 길을 찾는 모험가예요.', '', false, ['c4']],
  ['u6', '리나', '마법사', 'Mage', '낡은 마법서를 늘 들고 다니는 견습 마법사예요.', '', false, []],
];
const PER_MORE = [['미소', '요리사', 'Cook'], ['Noah', 'Student', 'Student'], ['예린', '화가', 'Painter'], ['Ethan', 'Pilot', 'Pilot'], ['소라', '기자', 'Reporter'], ['Zoe', 'Hacker', 'Hacker']];
D.personas.length = 0;
if (SET5 === 'empty') D.personas.push({ id: 'u1', name: '주노', note: '기본 페르소나', noteEn: 'Default persona', desc: '', icon: 'user-round', large: false });
else {
  PER_SEED.forEach((p) => D.personas.push({ id: p[0], name: p[1], note: p[2], noteEn: p[3], desc: p[4], icon: p[5], large: p[6] }));
  if (SET5 === 'many') PER_MORE.forEach((p, i) => D.personas.push({ id: 'u' + (7 + i), name: p[0], note: p[1], noteEn: p[2], desc: p[1] + ' 페르소나의 설명이에요.', icon: i % 3 === 0 ? 'star' : '', large: false }));
  PER_SEED.forEach((p) => p[7].forEach((cid) => { CHATS.find((c) => c.id === cid).persona = p[0]; }));
}

/* ---------------------------------------------------------------- plugins: arguments are the schema of the plugin's own settings (//@arg lines); realArg values are in .val */
const arg = (key, kind, meta, def, opts) => ({ key, kind, meta: meta || {}, def, val: def === undefined ? '' : def, opts: opts || null });   // def undefined: the script declares no default (no reset for that argument, DS-010)
D.plugins.length = 0;
if (SET5 !== 'empty') {
  const roll = [
    arg('sec_basic', 'divider', { name: '기본', nameEn: 'Basics' }),
    arg('formula', 'string', { name: '기본 주사위', nameEn: 'Default dice', desc: '‘d20’처럼 쓰면 돼요', descEn: 'Write it like d20', ph: 'd20' }, 'd20'),
    arg('note', 'string', { name: '굴림 메모', nameEn: 'Roll note', desc: '굴린 결과 아래에 붙는 짧은 글이에요', descEn: 'Short text added under a roll', ph: '예: 오늘의 운', textarea: true }),
    arg('mode', 'string', { name: '표시 방식', nameEn: 'Display', desc: '결과를 어떻게 보여 줄지 정해요', descEn: 'How results are shown', radio: [['숫자', 'num', 'Number'], ['주사위', 'dice', 'Dice'], ['둘 다', 'both', 'Both']] }, 'num'),
    arg('speed', 'string', { name: '굴림 속도', nameEn: 'Roll speed', desc: '여섯 가지 중에서 골라요', descEn: 'Pick one of six', radio: [['아주 느리게', 'xs', 'Very slow'], ['느리게', 's', 'Slow'], ['보통', 'm', 'Normal'], ['빠르게', 'l', 'Fast'], ['아주 빠르게', 'xl', 'Very fast'], ['즉시', 'now', 'Instant']] }, 'm'),
    arg('theme', 'select', { name: '주사위 색', nameEn: 'Dice colour', desc: '', descEn: '' }, 'ivory', [['상아색', 'ivory', 'Ivory'], ['검정', 'black', 'Black'], ['빨강', 'red', 'Red']]),
    arg('sides', 'int', { name: '면 수', nameEn: 'Sides', desc: '2에서 100 사이의 숫자예요', descEn: 'A number from 2 to 100', ph: '6', min: 2, max: 100 }, 6),
    arg('sound', 'int', { name: '소리 켜기', nameEn: 'Sound', desc: '굴릴 때 소리를 내요', descEn: 'Plays a sound on a roll', checkbox: true }, 1),
    arg('hidden_cache', 'string', { name: '', nameEn: '' }, 'x'),
  ];
  D.plugins.push({ id: 'pl1', name: 'Dice Roller', note: '주사위를 굴려요', noteEn: 'Rolls dice', vp: '1.2.3', api: '3.0', enabled: true, ipc: 0, hot: false, update: null, fail: false, links: [{ link: 'https://dice.example.invalid/docs', hover: '문서', hoverEn: 'Docs' }, { link: 'https://dice.example.invalid/issues', hover: '문의', hoverEn: 'Support' }], args: roll, code: '// stub: nothing here ever runs' });
  D.plugins.push({ id: 'pl2', name: '자동 번역 보조', note: '번역 결과를 다듬어요', noteEn: 'Polishes translations', vp: '2.0.1', api: '3.0', enabled: true, ipc: 2, hot: false, update: '2.1.0', fail: false, links: [], args: [arg('tone', 'string', { name: '말투', nameEn: 'Tone', desc: '', descEn: '', radio: [['공손', 'polite', 'Polite'], ['편하게', 'casual', 'Casual']] }, 'polite')], code: '// stub' });
  D.plugins.push({ id: 'pl3', name: 'Count Words', note: '단어 수를 세어 줘요', noteEn: 'Counts words', vp: '1.0.0', api: '3.0', enabled: true, ipc: 0, hot: true, update: null, fail: false, links: [], args: [arg('hidden_state', 'string', {}, '')], code: '// stub' });
  D.plugins.push({ id: 'pl4', name: '배경 음악', note: '분위기에 맞는 음악을 틀어요', noteEn: 'Plays music to fit the mood', vp: '0.9.4', api: '3.0', enabled: false, ipc: 0, hot: false, update: null, fail: false, links: [{ link: 'https://music.example.invalid', hover: '곡 목록', hoverEn: 'Track list' }], args: [arg('volume', 'int', { name: '음량', nameEn: 'Volume', desc: '0에서 100 사이예요', descEn: '0 to 100', min: 0, max: 100 }, 40), arg('loop', 'int', { name: '반복 재생', nameEn: 'Loop', checkbox: true }, 1)], code: '// stub' });
  D.plugins.push({ id: 'pl5', name: '채팅 내보내기', note: '채팅을 파일로 저장해요', noteEn: 'Exports the chat to a file', vp: '1.1.0', api: '2.1', enabled: false, ipc: 0, hot: false, update: null, fail: false, links: [], args: [arg('format', 'select', { name: '형식', nameEn: 'Format' }, 'md', [['Markdown', 'md', 'Markdown'], ['텍스트', 'txt', 'Text']])], code: '// stub' });
  D.plugins.push({ id: 'pl6', name: '로어북 정리', note: '로어북 항목을 정리해요', noteEn: 'Tidies lorebook entries', vp: '0.5.0', api: '1', enabled: false, ipc: 0, hot: false, update: null, fail: false, links: [], args: [], code: '// stub' });
}
const PLUGIN_FILES = [
  { id: 'f1', name: 'weather-pack.js', ko: '날씨 정보', en: 'Weather', api: '3.0', vp: '1.0.0', ipc: 1 },
  { id: 'f2', name: 'story-timeline.js', ko: '스토리 타임라인', en: 'Story timeline', api: '3.0', vp: '0.3.2', ipc: 0 },
  { id: 'f3', name: 'old-helper.ts', ko: '옛 도우미', en: 'Old helper', api: '2.1', vp: '1.0.0', ipc: 0 },
];

/* ---------------------------------------------------------------- modules */
const MOD = [
  // id, name, desc ko, desc en, namespace, hideIcon, low, mcp url, assets, lore, regex, scripts, toggles, html
  ['m1', '판타지 세계관 기본', '검과 마법의 세계 설정이에요', 'A world of swords and magic', 'fantasy', false, false, '', 12, 48, 3, 2, 4, true],
  ['m2', '학교 일상 규칙', '', '', '', false, false, '', 0, 6, 1, 0, 0, false],
  ['m3', '주사위 규칙', '판정에 쓰는 주사위 규칙이에요', 'Dice rules for checks', 'dice-rules', false, false, '', 4, 12, 2, 5, 3, false],
  ['m4', 'SF 용어집', '미래 도시의 용어를 모아 놓았어요', 'Terms of a future city', '', true, false, '', 40, 120, 15, 0, 0, true],
  ['m5', '감정 반응 세트', '', '', '', false, false, '', 24, 0, 0, 1, 2, false],
  ['m6', '요약 도우미', '긴 대화를 짧게 줄여 줘요', 'Shortens long chats', 'summary', false, true, '', 0, 2, 0, 8, 1, false],
  ['m7', '나레이션 스타일', '', '', '', false, false, '', 3, 4, 2, 0, 0, false],
  ['m8', '전투 시스템', '턴제 전투 규칙이에요', 'Turn-based combat rules', '', false, false, '', 18, 30, 5, 3, 6, false],
  ['m9', '호감도 시스템', '', '', '', false, false, '', 6, 8, 0, 2, 1, false],
  ['m10', '추리 단서 노트', '단서를 모아 정리해요', 'Collects and sorts clues', '', false, false, '', 0, 22, 4, 1, 0, false],
  ['m11', '여행 일지', '', '', '', false, false, '', 9, 14, 0, 0, 0, false],
  ['m12', '주사위 도구 (MCP)', '주사위를 굴리는 내장 서버예요', 'A built-in server that rolls dice', '', false, false, 'internal:dice', 0, 0, 0, 0, 0, false],
  ['m13', 'DeepWiki', '저장소 문서를 찾아 줘요', 'Looks up repository docs', '', false, false, 'https://mcp.deepwiki.com/mcp', 0, 1, 0, 0, 0, false],
  ['m14', '마법 학원', '학원 생활 설정이에요', 'Magic academy setting', '', false, false, '', 7, 18, 2, 1, 2, false],
];
D.modules.length = 0;
const mkMod = (m, i) => ({ id: m[0], name: m[1], note: m[2], noteEn: m[3], ns: m[4], hideIcon: m[5], low: m[6], mcp: m[7] ? { url: m[7] } : null, assets: m[8], lore: m[9], regex: m[10], scripts: m[11], toggles: m[12], html: m[13], global: false, order: i });
let PRESET_NS = {};   // preset id -> the text of its 모듈 연동 field (the namespace list), for the presets other than the active one
if (SET5 !== 'empty') {
  MOD.forEach((m, i) => D.modules.push(mkMod(m, i)));
  if (SET5 === 'many') for (let i = 15; i <= 40; i++) D.modules.push(mkMod(['m' + i, ['별빛 ', '숲속 ', '사막 ', 'Neon ', 'Iron '][i % 5] + ['모험', '도서관', '시장', 'Rules', 'Kit'][i % 5] + ' ' + i, i % 3 === 0 ? '' : '모듈 ' + i + ' 설명이에요', i % 3 === 0 ? '' : 'Module ' + i, i % 7 === 0 ? 'ns' + i : '', false, i === 22, '', i % 41, i % 30, i % 6, i % 4, i % 3, false], i));
  D.modules.find((m) => m.id === 'm1').global = true;
  D.modules.find((m) => m.id === 'm5').global = true;
  CHARS[0].modules.push('m3');
  CHATS[2].modules.push('m9');
  PRESET_NS = { p2: 'dice-rules' };   // one module is on through a preset: the second preset names dice-rules
}
/* ---------------------------------------------------------------- copy (SLICE5A_SPEC section 9). No Korean particle directly after a user-chosen name (DS-038): names are put on a line of their own or after a colon. Say "첫 메시지", never "greeting". */
const K = {
  ko: {
    title: '설정 슬라이스 5a · 단축키, 페르소나, 확장 목업', undo: '되돌리기', cancel: '취소', ok: '확인', close: '닫기', copy: '복사', copied: '복사했어요', changed: '기본값과 다름', simulated: (w) => `${w}: 모의 동작이에요`, menuOf: (n) => `${n} 메뉴`, chatOpen: '채팅 열기',
    trashBtn: '최근 삭제', trashTitle: '최근 삭제', trashEmpty: '최근에 지운 항목이 없어요', restore: '복원', purge: '영구 삭제', restored: (n) => `복원했어요: ${n}`, purged: (n) => `영구 삭제했어요: ${n}`,
    purgeQ: (n, eul) => `‘${n}’${eul} 영구 삭제할까요?`, purgeBody: (kb) => `항목 1개 · 약 ${kb} KB. 되돌릴 수 없어요.`,   /* DD-229: the name, the count and the size; 되돌릴 수 없어요 is true here because the purge takes the undo step with it */
    backPersona: '페르소나 목록으로 돌아가기', backPersonaShort: '페르소나', backExt: '확장으로 돌아가기', backExtShort: '확장',
    /* 단축키 */
    hkSpace: '스페이스', hkUnbound: '지정 안 됨', hkRecPrompt: '키를 누르세요 · Esc 취소', hkBare: '이 키는 단독으로 쓸 수 없어요 · Ctrl이나 Alt와 함께 눌러요', hkNavKey: '이동·편집 키는 단독으로 쓸 수 없어요', hkShiftOnly: 'Shift만으로는 쓸 수 없어요 · Ctrl이나 Alt와 함께 눌러요', hkMacCtrl: 'Mac에서는 ⌘를 써요', hkSuper: 'Windows 키는 쓸 수 없어요', hkAltGr: 'AltGr은 쓸 수 없어요', hkSwapOutcome: (a, c) => `바꾸면 ‘${a}’ 키: ${c || '지정 안 됨'}`, hkBrowser: '브라우저가 쓰는 키예요', hkEdit: '편집 키예요',
    hkAria: (l, c) => `${l}, 단축키 ${c}, 바꾸려면 Enter`, hkAriaNone: (l) => `${l}, 지정 안 됨, 지정하려면 Enter`, hkRoAria: (c) => `단축키 ${c}`, hkRecAria: (l) => `${l}, 키를 누르세요`,
    hkConflict: (a) => `‘${a}’에 이미 지정돼 있어요`, hkAlso: (a) => `‘${a}’에도 지정돼 있어요`, hkFixed: (k) => `고정 키예요 · ${k}`, hkSwap: '바꾸기', hkSame: '같은 키예요 · 바꾸지 않았어요', hkCancelled: '취소했어요',
    hkSet: '단축키를 바꿨어요', hkCleared: '단축키를 지웠어요', hkSwapped: '단축키를 서로 바꿨어요', hkSkip: '그 뒤에 다른 변경이 있어서 되돌리지 않았어요',
    hkLu: (l) => `단축키: ${l}`, hkLuSwap: (l) => `단축키 바꾸기: ${l}`, hkLuAll: (n) => `단축키 ${n}개 기본값으로`,
    hkMenuRec: '바꾸기', hkMenuReset: '기본값으로', hkMenuClear: '지우기', hkResetAll: '모두 기본값으로', hkResetNone: '바꾼 단축키가 없어요', hkResetAllN: (n) => `바꾼 단축키 ${n}개`,
    hkResetAllQ: (n) => `단축키 ${n}개를 기본값으로 되돌릴까요?`, hkResetAllBody: '바꾼 키가 모두 기본 키로 돌아가요. 되돌리기로 다시 바꿀 수 있어요', hkResetAllDone: (n) => `단축키 ${n}개를 기본값으로 되돌렸어요`,
    hkDupBanner: (n) => `겹치는 단축키 ${n}개`, hkPhone: '키보드를 연결하면 바꿀 수 있어요', hkSlotEmpty: '비어 있음', hkSlotWho: (n) => `이 키에 연결된 프리셋: ${n}`,
    /* 페르소나 */
    perCount: (n) => `페르소나 ${n}개`, perCountOf: (n, t) => `페르소나 ${t}개 중 ${n}개`, perChats: (n) => `연결된 채팅 ${n}개`, perChatsActive: (n) => `연결된 채팅 ${n}개 · 지정 없는 채팅에도 써요`, perBoundNoneActive: '연결한 채팅이 없어요 · 지정 없는 채팅에서 써요', perNewActive: (n) => `지금 쓰는 페르소나가 바뀌어요: ${n}`, perActive: '사용 중', perAdd: '페르소나', perAddAria: '페르소나 추가', perNew: '새로 만들기', perImportMenu: '가져오기 (PNG)', perSearch: '페르소나 찾기', perNone: '찾는 페르소나가 없어요',
    perHandle: (n) => `순서 바꾸기: ${n}`, perUp: '위로', perDown: '아래로', perEdge: '더 옮길 수 없어요', perMoved: (n, i, t) => `${n}: ${t}개 중 ${i}번째`, perNoName: '(이름 없음)', perNewName: '새 페르소나',
    perName: '이름', perNote: '메모', perDesc: '설명', perDescCount: (n) => `${n}자`, perLarge: '큰 초상화', perLargeOn: '채팅에서 초상화를 크게 보여요', perLargeOff: '채팅에서 작은 아이콘으로 보여요', perPortrait: '초상화 바꾸기 (모의)', perImageSet: '초상화를 바꿨어요 (모의)',
    perUse: '사용하기', perUsed: '사용 중이에요', perUsing: '페르소나를 바꿨어요', perExport: '내보내기 (PNG)', perExported: '내보냈어요 (모의)', perExportEmpty: '이름이나 설명이 비어 있어요 · 빈 항목은 빼고 내보내요', perDup: '복제', perDuped: '복제했어요', perCopyName: (n) => `${n} (복사본)`, perCreated: '새 페르소나를 만들었어요',
    perDelete: '삭제', perDelTitle: '페르소나를 지울까요?', perDeleted: '페르소나를 지웠어요', perLast: '페르소나가 하나는 있어야 해요', perBoundQ: (n, a) => `채팅 ${n}개가 이 페르소나로 연결돼 있어요 · 지우면 지금 쓰는 페르소나를 따라가요: ${a}`,
    perBoundList: '이 페르소나를 쓰는 채팅', perBoundNone: '연결한 채팅이 없어요', perBoundHint: '연결은 채팅 메뉴에서 바꿔요',
    perImportTitle: '페르소나 가져오기', perImportPick: 'PNG 파일을 골라요 (모의)', perImportDo: '가져오기', perImportBad: '페르소나 정보가 없는 파일이에요', perImportSummary: (a, b) => `가져올 파일 ${a}개 · 건너뛸 파일 ${b}개`, perImportDone: (n) => `페르소나 ${n}개를 가져왔어요`, perImportSkip: (n) => `건너뛴 파일 ${n}개`,
    perLuUse: (n) => `페르소나 사용: ${n}`, perLuNew: '새 페르소나', perLuDup: (n) => `페르소나 복제: ${n}`, perLuDel: (n) => `페르소나 삭제: ${n}`, perLuMove: (n) => `페르소나 순서: ${n}`, perLuImage: (n) => `초상화: ${n}`, perLuImport: (n) => `페르소나 ${n}개 가져오기`, perLuEdit: (n) => `페르소나 수정: ${n}`,
    /* 플러그인 */
    plWarn: '플러그인은 앱 안에서 코드를 실행해요 · 믿을 수 있는 것만 설치하세요', plAdd: '플러그인', plDevAria: '개발 도구', plDevImport: '개발 모드로 가져오기', plDevDone: '개발 모드로 가져왔어요', plTemplate: '시작 템플릿 받기', plTemplateDone: '시작 템플릿을 받았어요', plCheck: '업데이트 확인',
    plChecking: '확인하는 중…', plAllLatest: '모두 최신이에요', plSomeUpd: (n) => `${n}개 업데이트 있음`, plFailed: (n, names) => `${n}개를 확인하지 못했어요: ${names}`, plMeta: (v, a) => `v${v} · API ${a}`,
    plAccLimited: '제한된 권한 · 허용된 기능만 써요', plAccIpc: (n) => `+ ${n}개 앱 기능`, plAccFull: '전체 권한 · 저장된 데이터와 캐릭터를 읽고 바꿀 수 있어요', plAccV1: '더 이상 지원하지 않아요 · API 3 버전이 필요해요',
    plOn: '켜짐', plOff: '꺼짐', plFullShort: '전체 권한', plSwAria: (n) => n, plDevChip: '개발 중', plUpdChip: (v) => `업데이트 있음 · v${v}`, plUpdBtn: '업데이트', plUpdBtnAria: (n) => `업데이트: ${n}`, plUpdQ: '업데이트할까요?', plUpdBody: (a, b) => `v${a} → v${b}`, plUpdDone: '업데이트했어요',
    plFullT: '전체 권한으로 실행돼요', plFullNote: '켜면 저장된 데이터와 캐릭터를 읽고 바꿀 수 있어요. 믿을 수 있는 플러그인만 켜세요', plFullOn: '켜기',
    plRemoveT: '플러그인을 지울까요?', plRemoveNote: '지우면 플러그인이 저장한 데이터는 되돌리기로도 돌아오지 않을 수 있어요', plRemoved: '플러그인을 지웠어요', plMenuSettings: '설정', plMenuCheck: '업데이트 확인', plMenuFile: '설정 파일', plMenuExport: '내보내기', plMenuDelete: '삭제', plExported: '내보냈어요 (모의)',
    plFileT: '설정 파일', plFileBody: '플러그인 설정값을 파일로 내보내거나 파일에서 불러와요', plFileExport: '값 내보내기', plFileImport: '값 가져오기', plFileReplaced: (n) => `${n}개 값을 바꿨어요`, plLuFile: (n) => `플러그인 설정 파일: ${n}`, plFileExported: '설정값을 내보냈어요 (모의)', plFileImported: '설정값을 불러왔어요 (모의)',
    plNone: '설치한 플러그인이 없어요 · + 플러그인으로 파일을 골라요', plPickT: '플러그인 파일 고르기', plPickBody: '파일을 골라요 (모의). 여러 개를 고르면 설치 전에 한꺼번에 살펴봐요', plInstall: '설치', plBatchT: '플러그인 여러 개 설치', plBatchBody: (n) => `${n}개를 설치해요. 설치한 플러그인은 꺼진 채로 들어와요`, plInstallAll: (n) => `${n}개 설치`, plInstalled: (n) => `플러그인 ${n}개를 설치했어요`,
    plLuUpd: (n) => `플러그인 업데이트: ${n}`, plLuDel: (n) => `플러그인 삭제: ${n}`, plLuInstall: (n) => `플러그인 ${n}개 설치`, plLuArg: (n) => `플러그인 설정: ${n}`,
    plArgReset: '기본값으로', plArgDefault: (v) => `기본값 ${v}`, plArgNum: '숫자로 입력해요', plArgRange: (a, b) => `${a}에서 ${b} 사이의 숫자로 입력해요`, plNoArgs: '바꿀 수 있는 설정이 없어요',
    /* 모듈 */
    moNone: '모듈이 없어요', moNoMatch: '찾는 모듈이 없어요', moSearch: '모듈 찾기', moSort: '정렬', moSortName: '이름', moSortRecent: '최근 추가', moFilters: '모듈 거르기', moFiltOn: '켜진 것', moFiltLow: '고급 권한', moFiltMcp: 'MCP', moCount: (n, t) => (n === t ? `모듈 ${t}개` : `모듈 ${t}개 중 ${n}개`),
    moAdd: '모듈', moAddAria: '모듈 추가', moMenuNew: '새로 만들기', moMenuImport: '파일 가져오기', moMenuMcp: 'MCP 연결', moNoDesc: '설명 없음', moNoName: '(이름 없음)', moBadgeLow: '고급 권한', moChipAssets: (n) => `에셋 ${n}`,
    moWhereGlobal: '전체', moWherePreset: '프리셋', moWhereChars: (n) => `캐릭터 ${n}`, moWhereChats: (n) => `채팅 ${n}`, moSwAria: (n) => `${n}: 전체에서 사용`, moGlobalSw: '전체에서 켜기', moGlobalOn: '전체에서 켰어요', moGlobalOff: '전체에서 껐어요',
    moInfo: '정보', moStudio: 'Studio에서 열기', moExport: '내보내기', moConvert: '캐릭터로 변환', moDelete: '삭제',
    moBasic: '기본 정보', moName: '이름', moDesc: '설명', moNs: '네임스페이스', moNsPh: '예: fantasy', moNsHelp: "프리셋의 '모듈 연동'에 이 이름을 쓰면 그 프리셋에서 켜져요", moHideIcon: '아이콘 숨기기', moNameEmpty: '이름이 비어 있으면 저장하지 않아요', moNsBad: '쉼표나 공백은 쓸 수 없어요', moNsLost: (n) => `프리셋 ${n}개에서 더 이상 켜지지 않아요`, moMcpNoStudio: 'MCP 모듈은 내용이 서버에 있어서 Studio에서 고칠 내용이 없어요', moImpCancelled: '가져오기를 취소했어요 · 추가한 모듈은 없어요',
    moPerm: '권한', moPermOn: '고급 권한: 켜짐', moPermOff: '고급 권한: 꺼짐', moPermOnHelp: 'AI 모델과 저장 공간에 직접 접근할 수 있어요', moPermOffHelp: 'AI 모델과 저장 공간에 직접 접근하지 않아요', moPermChange: 'Studio에서 바꾸기',
    moContent: '내용', moLore: (n) => `로어북 ${n}`, moRegex: (n) => `정규식 ${n}`, moScripts: (n) => `스크립트 ${n}`, moToggles: (n) => `토글 ${n}`, moHtml: (b) => `배경 HTML ${b ? '있음' : '없음'}`, moContentHelp: '내용은 Studio에서 고쳐요. 숫자를 누르면 그 종류로 열려요',
    moMcpUrl: '서버 주소', moReconnect: '다시 연결', moReconnected: '다시 연결했어요 (모의)',
    moWhere: '어디서 켜져 있나요', moLayerGlobal: '전체', moLayerPreset: '프리셋', moLayerChars: '캐릭터', moLayerChats: '채팅', moNoNs: '네임스페이스가 없어서 프리셋으로 켤 수 없어요', moNoPreset: '이 이름을 쓰는 프리셋이 없어요', moPresetField: '모듈 연동',
    moNoChars: '켜 둔 캐릭터가 없어요', moNoChats: '켜 둔 채팅이 없어요', moAddChar: '캐릭터에 켜기', moPickChar: '캐릭터 고르기', moCharOn: '캐릭터에 켰어요', moOffFor: (n) => `끄기: ${n}`, moLayerOff: '껐어요', moDimmed: '전체에서 켜져 있어서 따로 켤 필요 없어요', moChatsHint: '새 채팅에 켜는 일은 채팅 메뉴에서 해요', moDetails: '자세히',
    moLowT: 'AI 모델과 저장 공간에 직접 접근할 수 있어요', moLowTAll: '전체에서 켤까요?', moLowTChar: '이 캐릭터에서 켤까요?', moLowTPreset: '프리셋의 모듈 연동으로 켤까요?', moLowLineChar: (n) => `캐릭터: ${n}`, moLowLinePreset: (n) => `네임스페이스: ${n}`, moLowOn: '켜기',
    moNewT: '새 모듈', moNewName: '이름', moNewDesc: '설명 (선택)', moNewNs: '네임스페이스 (선택)', moNewNeed: '이름을 입력해야 만들 수 있어요', moNewDo: '만들기', moNewDone: '모듈을 만들었어요', moNewStudioHint: 'Studio에서 열어 내용을 채워요',
    moDelT: '모듈을 지울까요?', moDelUse: (a, b, c) => `캐릭터 ${a}개 · 채팅 ${b}개 · 프리셋 ${c}개가 이 모듈을 쓰고 있어요`, moDelNone: '쓰고 있는 곳이 없어요', moDeleted: '모듈을 지웠어요',
    moExportT: '내보내기 형식', moExportCharx: 'CharX (권장)', moExportRisum: '.risum', moExported: (e) => `내보냈어요 (${e}, 모의)`, moConverted: '캐릭터로 변환했어요 (모의)', moConvOpen: '열기',
    moImpT: '모듈 가져오기', moImpPick: '파일을 골라요 (모의). 여러 개도 돼요', moImpDo: '가져오기', moImpDup: '같은 모듈이 있어요', moImpDupAsk: (f) => `${f}: 같은 모듈이 이미 있어요 · 바꾸기 / 따로 추가`, moImpReplace: '바꾸기', moImpSep: '따로 추가', moImpSkip: '건너뛰기',
    moImpLowQ: '이 콘텐츠는 고급 권한(Low Level Access)을 써서 AI 모델과 저장 공간에 직접 접근할 수 있어요. 정말 가져올까요?', moImpAdded: '추가했어요', moImpReplaced: '바꿨어요', moImpSkipped: '건너뛰었어요', moImpDeclined: '고급 권한이라 건너뛰었어요', moImpBad: '지원하지 않는 형식이에요', moImpSummary: (n) => `모듈 ${n}개를 가져왔어요`,
    moMcpT: 'MCP 연결', moMcpSugg: '추천 서버', moMcpDo: '연결', moMcpErrEmpty: '주소를 입력해야 해요', moMcpErrHttp: 'http는 이 기기(localhost)에서만 쓸 수 있어요', moMcpErrScheme: '지원하지 않는 주소예요 · https, internal, stdio, plugin 중 하나로 시작해야 해요', moMcpDone: 'MCP 서버를 연결했어요',
    moLuChar: (n) => `모듈 캐릭터에 켜기: ${n}`, moLuOff: (n) => `모듈 끄기: ${n}`, moLuDel: (n) => `모듈 삭제: ${n}`, moLuEdit: (n) => `모듈 수정: ${n}`, moLuImport: (n) => `모듈 ${n}개 가져오기`, moLuMcp: 'MCP 연결', moLuNew: '새 모듈',
    demo5: '단축키·페르소나·확장 데모', demoSet: '데이터 세트', setDemo: '데모', setMac: 'Mac', setEmpty: '비어 있음', setMany: '많음', demoMsel: '모델 선택 키 (3-10)', demoScroll: '현재 캐릭터로 스크롤 설정', demoNote5: '페르소나 메모', demoKbd: '키보드 연결됨', demoState: '상태', demoGo: '열기',
  },
  en: {
    title: 'Settings slice 5a · shortcuts, personas, extensions mockup', undo: 'Undo', cancel: 'Cancel', ok: 'OK', close: 'Close', copy: 'Copy', copied: 'Copied', changed: 'Changed from default', simulated: (w) => `${w}: simulated`, menuOf: (n) => `Menu for ${n}`, chatOpen: 'Open the chat',
    trashBtn: 'Recently deleted', trashTitle: 'Recently deleted', trashEmpty: 'Nothing was deleted recently', restore: 'Restore', purge: 'Delete for good', restored: (n) => `Restored: ${n}`, purged: (n) => `Deleted for good: ${n}`,
    purgeQ: (n, _eul) => `Delete ‘${n}’ for good?`, purgeBody: (kb) => `1 item · about ${kb} KB. This can’t be undone.`,
    backPersona: 'Back to the persona list', backPersonaShort: 'Personas', backExt: 'Back to Extensions', backExtShort: 'Extensions',
    hkSpace: 'Space', hkUnbound: 'Not set', hkRecPrompt: 'Press a key · Esc to cancel', hkBare: "This key can't be used on its own · press it with Ctrl or Alt", hkNavKey: "Navigation and editing keys can't be used on their own", hkShiftOnly: "Shift alone isn't enough · press it with Ctrl or Alt", hkMacCtrl: 'On a Mac, use ⌘', hkSuper: "The Windows key can't be used", hkAltGr: "AltGr can't be used", hkSwapOutcome: (a, c) => `Swapping gives “${a}”: ${c || 'no key'}`, hkBrowser: 'The browser uses this key', hkEdit: 'This is an editing key',
    hkAria: (l, c) => `${l}, shortcut ${c}, press Enter to change`, hkAriaNone: (l) => `${l}, not set, press Enter to set`, hkRoAria: (c) => `Shortcut ${c}`, hkRecAria: (l) => `${l}, press a key`,
    hkConflict: (a) => `Already used by “${a}”`, hkAlso: (a) => `Also used by “${a}”`, hkFixed: (k) => `Fixed key · ${k}`, hkSwap: 'Swap', hkSame: 'Same key · nothing changed', hkCancelled: 'Cancelled',
    hkSet: 'Shortcut changed', hkCleared: 'Shortcut removed', hkSwapped: 'Shortcuts swapped', hkSkip: 'Something changed after it, so nothing was undone',
    hkLu: (l) => `Shortcut: ${l}`, hkLuSwap: (l) => `Swap shortcut: ${l}`, hkLuAll: (n) => `Reset ${n} shortcuts`,
    hkMenuRec: 'Change', hkMenuReset: 'Reset to default', hkMenuClear: 'Remove', hkResetAll: 'Reset all to defaults', hkResetNone: 'No shortcut was changed', hkResetAllN: (n) => `${n} changed shortcuts`,
    hkResetAllQ: (n) => `Reset ${n} ${n === 1 ? 'shortcut' : 'shortcuts'} to the defaults?`, hkResetAllBody: 'Every changed key goes back to its default. You can undo it', hkResetAllDone: (n) => `${n} ${n === 1 ? 'shortcut' : 'shortcuts'} reset to the defaults`,
    hkDupBanner: (n) => `${n} ${n === 1 ? 'shortcut overlaps' : 'shortcuts overlap'}`, hkPhone: 'Connect a keyboard to change shortcuts', hkSlotEmpty: 'Empty', hkSlotWho: (n) => `Preset on this key: ${n}`,
    perCount: (n) => `${n} ${n === 1 ? 'persona' : 'personas'}`, perCountOf: (n, t) => `${n} of ${t} personas`, perChats: (n) => `${n} linked ${n === 1 ? 'chat' : 'chats'}`, perChatsActive: (n) => `${n} linked · also used where no persona is set`, perBoundNoneActive: 'No linked chats · used in chats with no persona set', perNewActive: (n) => `The persona in use changes to: ${n}`, perActive: 'In use', perAdd: 'Persona', perAddAria: 'Add a persona', perNew: 'Create new', perImportMenu: 'Import (PNG)', perSearch: 'Find a persona', perNone: 'No persona matches',
    perHandle: (n) => `Reorder: ${n}`, perUp: 'Move up', perDown: 'Move down', perEdge: "Can't move further", perMoved: (n, i, t) => `${n}: ${i} of ${t}`, perNoName: '(no name)', perNewName: 'New persona',
    perName: 'Name', perNote: 'Note', perDesc: 'Description', perDescCount: (n) => `${n} characters`, perLarge: 'Large portrait', perLargeOn: 'Shown large in chats', perLargeOff: 'Shown as a small icon in chats', perPortrait: 'Change the portrait (simulated)', perImageSet: 'Portrait changed (simulated)',
    perUse: 'Use', perUsed: 'In use', perUsing: 'Persona changed', perExport: 'Export (PNG)', perExported: 'Exported (simulated)', perExportEmpty: 'The name or description is empty · empty fields are left out', perDup: 'Duplicate', perDuped: 'Duplicated', perCopyName: (n) => `${n} (copy)`, perCreated: 'Created a new persona',
    perDelete: 'Delete', perDelTitle: 'Delete this persona?', perDeleted: 'Persona deleted', perLast: 'There must be at least one persona', perBoundQ: (n, a) => `${n} ${n === 1 ? 'chat is' : 'chats are'} linked to this persona · after deleting it they follow the persona in use: ${a}`,
    perBoundList: 'Chats that use this persona', perBoundNone: 'No linked chats', perBoundHint: 'The binding is changed in the chat menu',
    perImportTitle: 'Import a persona', perImportPick: 'Pick PNG files (simulated)', perImportDo: 'Import', perImportBad: 'This file has no persona data', perImportSummary: (a, b) => `${a} to import · ${b} skipped`, perImportDone: (n) => `Imported ${n} ${n === 1 ? 'persona' : 'personas'}`, perImportSkip: (n) => `${n} skipped`,
    perLuUse: (n) => `Use persona: ${n}`, perLuNew: 'New persona', perLuDup: (n) => `Duplicate persona: ${n}`, perLuDel: (n) => `Delete persona: ${n}`, perLuMove: (n) => `Persona order: ${n}`, perLuImage: (n) => `Portrait: ${n}`, perLuImport: (n) => `Import ${n} personas`, perLuEdit: (n) => `Edit persona: ${n}`,
    plWarn: 'Plugins run code inside the app · install only ones you trust', plAdd: 'Plugin', plDevAria: 'Developer tools', plDevImport: 'Import in development mode', plDevDone: 'Imported in development mode', plTemplate: 'Get the starter template', plTemplateDone: 'Starter template saved', plCheck: 'Check for updates',
    plChecking: 'Checking…', plAllLatest: 'Everything is up to date', plSomeUpd: (n) => `${n} ${n === 1 ? 'update' : 'updates'} available`, plFailed: (n, names) => `Could not check ${n}: ${names}`, plMeta: (v, a) => `v${v} · API ${a}`,
    plAccLimited: 'Limited access · only the features it is allowed', plAccIpc: (n) => `+ ${n} app ${n === 1 ? 'feature' : 'features'}`, plAccFull: 'Full access · can read and change stored data and characters', plAccV1: 'No longer supported · needs an API 3 version',
    plOn: 'On', plOff: 'Off', plFullShort: 'Full access', plSwAria: (n) => n, plDevChip: 'In development', plUpdChip: (v) => `Update available · v${v}`, plUpdBtn: 'Update', plUpdBtnAria: (n) => `Update: ${n}`, plUpdQ: 'Update the plugin?', plUpdBody: (a, b) => `v${a} → v${b}`, plUpdDone: 'Plugin updated',
    plFullT: 'It runs with full access', plFullNote: 'When on, it can read and change stored data and characters. Turn on only plugins you trust', plFullOn: 'Turn on',
    plRemoveT: 'Delete this plugin?', plRemoveNote: 'Data the plugin saved may not come back, even with undo', plRemoved: 'Plugin deleted', plMenuSettings: 'Settings', plMenuCheck: 'Check for updates', plMenuFile: 'Settings file', plMenuExport: 'Export', plMenuDelete: 'Delete', plExported: 'Exported (simulated)',
    plFileT: 'Settings file', plFileBody: "Export the plugin's settings to a file or load them from one", plFileExport: 'Export values', plFileImport: 'Import values', plFileReplaced: (n) => `${n} ${n === 1 ? 'value' : 'values'} replaced`, plLuFile: (n) => `Plugin settings file: ${n}`, plFileExported: 'Settings exported (simulated)', plFileImported: 'Settings loaded (simulated)',
    plNone: 'No plugins installed · pick a file with + Plugin', plPickT: 'Pick plugin files', plPickBody: 'Pick files (simulated). Several files are reviewed together before installing', plInstall: 'Install', plBatchT: 'Install several plugins', plBatchBody: (n) => `Installing ${n}. Installed plugins start switched off`, plInstallAll: (n) => `Install ${n}`, plInstalled: (n) => `Installed ${n} ${n === 1 ? 'plugin' : 'plugins'}`,
    plLuUpd: (n) => `Update plugin: ${n}`, plLuDel: (n) => `Delete plugin: ${n}`, plLuInstall: (n) => `Install ${n} plugins`, plLuArg: (n) => `Plugin setting: ${n}`,
    plArgReset: 'Reset to default', plArgDefault: (v) => `Default ${v}`, plArgNum: 'Enter a number', plArgRange: (a, b) => `Enter a number from ${a} to ${b}`, plNoArgs: 'Nothing to change here',
    moNone: 'No modules', moNoMatch: 'No module matches', moSearch: 'Find a module', moSort: 'Sort', moSortName: 'Name', moSortRecent: 'Recently added', moFilters: 'Filter modules', moFiltOn: 'On', moFiltLow: 'Advanced access', moFiltMcp: 'MCP', moCount: (n, t) => (n === t ? `${t} ${t === 1 ? 'module' : 'modules'}` : `${n} of ${t} modules`),
    moAdd: 'Module', moAddAria: 'Add a module', moMenuNew: 'Create new', moMenuImport: 'Import files', moMenuMcp: 'Connect MCP', moNoDesc: 'No description', moNoName: '(no name)', moBadgeLow: 'Advanced access', moChipAssets: (n) => `${n} assets`,
    moWhereGlobal: 'Everywhere', moWherePreset: 'Preset', moWhereChars: (n) => `${n} ${n === 1 ? 'character' : 'characters'}`, moWhereChats: (n) => `${n} ${n === 1 ? 'chat' : 'chats'}`, moSwAria: (n) => `${n}: used everywhere`, moGlobalSw: 'Turn on everywhere', moGlobalOn: 'Turned on everywhere', moGlobalOff: 'Turned off everywhere',
    moInfo: 'Info', moStudio: 'Open in Studio', moExport: 'Export', moConvert: 'Convert to a character', moDelete: 'Delete',
    moBasic: 'Basics', moName: 'Name', moDesc: 'Description', moNs: 'Namespace', moNsPh: 'e.g. fantasy', moNsHelp: "Write this name in a preset's 'Module integration' and the module turns on in that preset", moHideIcon: 'Hide the icon', moNameEmpty: 'An empty name is not saved', moNsBad: 'No commas or spaces in a namespace', moNsLost: (n) => `Turned off in ${n} ${n === 1 ? 'preset' : 'presets'}`, moMcpNoStudio: 'An MCP module keeps its content on the server, so there is nothing to edit in Studio', moImpCancelled: 'Import cancelled · no module was added',
    moPerm: 'Permission', moPermOn: 'Advanced access: on', moPermOff: 'Advanced access: off', moPermOnHelp: 'It can reach the AI model and your storage directly', moPermOffHelp: 'It does not reach the AI model or your storage directly', moPermChange: 'Change in Studio',
    moContent: 'Content', moLore: (n) => `Lorebook ${n}`, moRegex: (n) => `Regex ${n}`, moScripts: (n) => `Scripts ${n}`, moToggles: (n) => `Toggles ${n}`, moHtml: (b) => `Background HTML: ${b ? 'yes' : 'no'}`, moContentHelp: 'Content is edited in Studio. Each count opens that kind',
    moMcpUrl: 'Server address', moReconnect: 'Reconnect', moReconnected: 'Reconnected (simulated)',
    moWhere: 'Where it is on', moLayerGlobal: 'Everywhere', moLayerPreset: 'Presets', moLayerChars: 'Characters', moLayerChats: 'Chats', moNoNs: "There is no namespace, so a preset can't turn it on", moNoPreset: 'No preset names this namespace', moPresetField: 'Module integration',
    moNoChars: 'No character has it on', moNoChats: 'No chat has it on', moAddChar: 'Turn on for a character', moPickChar: 'Pick a character', moCharOn: 'Turned on for the character', moOffFor: (n) => `Turn off: ${n}`, moLayerOff: 'Turned off', moDimmed: "It is on everywhere, so there's no need to turn it on here", moChatsHint: 'Turning it on for a new chat is done in the chat menu', moDetails: 'Details',
    moLowT: 'It can reach the AI model and your storage directly', moLowTAll: 'Turn it on everywhere?', moLowTChar: 'Turn it on for this character?', moLowTPreset: 'Turn it on through a preset link?', moLowLineChar: (n) => `Character: ${n}`, moLowLinePreset: (n) => `Namespace: ${n}`, moLowOn: 'Turn on',
    moNewT: 'New module', moNewName: 'Name', moNewDesc: 'Description (optional)', moNewNs: 'Namespace (optional)', moNewNeed: 'Enter a name to create the module', moNewDo: 'Create', moNewDone: 'Module created', moNewStudioHint: 'Open it in Studio to fill in the content',
    moDelT: 'Delete this module?', moDelUse: (a, b, c) => `${a} ${a === 1 ? 'character' : 'characters'}, ${b} ${b === 1 ? 'chat' : 'chats'} and ${c} ${c === 1 ? 'preset use' : 'presets use'} this module`, moDelNone: 'Nothing uses it', moDeleted: 'Module deleted',
    moExportT: 'Export format', moExportCharx: 'CharX (recommended)', moExportRisum: '.risum', moExported: (e) => `Exported (${e}, simulated)`, moConverted: 'Converted to a character (simulated)', moConvOpen: 'Open',
    moImpT: 'Import modules', moImpPick: 'Pick files (simulated). Several are fine', moImpDo: 'Import', moImpDup: 'The same module exists', moImpDupAsk: (f) => `${f}: the same module is already here · replace / add separately`, moImpReplace: 'Replace', moImpSep: 'Add separately', moImpSkip: 'Skip',
    moImpLowQ: 'This content uses Low Level Access, which means it can reach the AI model and your storage directly. Do you really want to import it?', moImpAdded: 'Added', moImpReplaced: 'Replaced', moImpSkipped: 'Skipped', moImpDeclined: 'Skipped (advanced access)', moImpBad: 'Not a supported format', moImpSummary: (n) => `Imported ${n} ${n === 1 ? 'module' : 'modules'}`,
    moMcpT: 'Connect MCP', moMcpSugg: 'Suggested servers', moMcpDo: 'Connect', moMcpErrEmpty: 'Enter an address', moMcpErrHttp: 'http works only on this device (localhost)', moMcpErrScheme: 'Unsupported address · it must start with https, internal, stdio or plugin', moMcpDone: 'MCP server connected',
    moLuChar: (n) => `Turn module on for a character: ${n}`, moLuOff: (n) => `Turn module off: ${n}`, moLuDel: (n) => `Delete module: ${n}`, moLuEdit: (n) => `Edit module: ${n}`, moLuImport: (n) => `Import ${n} modules`, moLuMcp: 'Connect MCP', moLuNew: 'New module',
    demo5: 'Shortcuts, personas, extensions demo', demoSet: 'Data set', setDemo: 'Demo', setMac: 'Mac', setEmpty: 'Empty', setMany: 'Many', demoMsel: 'Model select key (3-10)', demoScroll: 'Scroll-to-character setting', demoNote5: 'Persona notes', demoKbd: 'Keyboard connected', demoState: 'State', demoGo: 'Open',
  },
};
const TRASH_KB = { persona: { u1: 180, u2: 24, u3: 96, u4: 150, u5: 24, u6: 210, _: 60 }, plugin: { pl1: 40, pl2: 64, pl3: 18, _: 40 }, module: { m1: 12, m2: 7, m3: 18, _: 12 } };   // synthetic estimates (KB) per fixture item for the 영구 삭제 confirm (DD-229); the copy says 약 / about. A persona with an image is larger than one without
window.SS5A_DATA = { SET5, FLAGS, PLATFORM, CHARS, CHATS, PLUGIN_FILES, PRESET_NS, PER_SEED, K, TRASH_KB };
})();
