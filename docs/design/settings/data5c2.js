/* Settings slice 5c-2 (데이터·백업, 고급, 언어) catalogue, fixtures and copy. Synthetic; loaded after data.js .. data5c1.js and before slice2.js / slice1.js.
   Mutates window.SS1_DATA in place (rows, sections, pages) so slice 1 code keeps working on the same arrays, then publishes window.SS5C2_DATA.
   The data.* and adv.* rows slice 1 invented are replaced HERE (the real fields, defaults and bounds of research/slice5c2-data-adv-lang.md section 1.5 take their place); slice 5b's 번역 rows and slice 5c-1's pages stay as built.
   Nothing here is read from or written to the real app. File names, sizes, counts, dates, the snapshot list, the log lines, the statistics and the .bin leave-out list are invented (the leave-out list is marked mock, DD-227).
   Sets (?set=): demo, failing, other-tab, web-memory, desktop-app, android, empty, experimental. ?speed=<n> scales the mock engine's waits only (the pattern's own timings are never scaled).
   Floor devices (Note 9 / Android 10 WebView, Raspberry Pi 3): no optional chaining, nullish coalescing, .at(), replaceAll or structuredClone. */
(() => {
'use strict';
const D = window.SS1_DATA;
const Q = new URLSearchParams(location.search);
const MB = 1048576, GB = 1073741824;
const SETS = ['demo', 'failing', 'other-tab', 'web-memory', 'desktop-app', 'android', 'empty', 'experimental'];
const SET5D = SETS.indexOf(Q.get('set')) >= 0 ? Q.get('set') : 'demo';
const SPEED = Number(Q.get('speed')) > 0 ? Number(Q.get('speed')) : 1;
const rows = D.rows; const ROWI = {}; rows.forEach((r) => { ROWI[r.id] = r; });
const NOW = new Date(2026, 9, 28, 14, 30, 0).getTime();   // the mockup's fixed "now" (relative times and dates are computed from it)

/* ---------------------------------------------------------------- the platform of each set (what the app would report; the rows below read it live) */
const PLAT = { web: SET5D !== 'desktop-app' && SET5D !== 'android', tauri: SET5D === 'desktop-app' || SET5D === 'android', android: SET5D === 'android' };

/* ---------------------------------------------------------------- the store (what the app would hold; every page reads it by id at render time) */
const makeST = (set) => ({
  set,
  profile: set === 'empty'
    ? { keys: false, connections: 0, characters: 3, chats: 5, presets: 1, personas: 1, assets: 12, inlays: 0, archived: 0, estBytes: 6 * MB, partialBytes: 2 * MB, leftFiles: 4, leftBytes: 3 * MB }
    : { keys: true, connections: 7, characters: 120, chats: 2400, presets: 14, personas: 3, assets: 386, inlays: 58, archived: 31, estBytes: 612 * MB, partialBytes: 48 * MB, leftFiles: 222, leftBytes: 564 * MB },
  snapshots: set === 'empty' ? [] : [
    { id: 'sn3', at: NOW - 22 * 60000, bytes: 604 * MB, chars: 120 },
    { id: 'sn2', at: NOW - 5.4 * 3600000, bytes: 598 * MB, chars: 119 },
    { id: 'sn1', at: NOW - 2.1 * 86400000, bytes: 571 * MB, chars: 112 }],
  snSeq: 3,
  clean: set === 'empty' ? { files: 0, bytes: 0 } : { files: 214, bytes: Math.round(38.4 * MB) },
  cacheBad: [{ name: 'cover-0412.png', bytes: 412 * 1024 }, { name: 'bg-forest.webp', bytes: Math.round(1.8 * MB) }, { name: 'voice-03.wav', bytes: Math.round(5.2 * MB) }],
  cacheChecked: 1284,
  lock: { held: set === 'other-tab' },
  sim: { next: '', memory: set === 'web-memory', failing: set === 'failing' },   // next: a one-shot scenario for the next operation (ok, skips, fail, unknown, over4g)
  banned: [],
  restart: { needed: false, kind: '' },
  lang: { pending: '', applied: '', note: false },
  gate: { exp: false, unrec: false },
  writes: 0,
});
const ST = makeST(SET5D);
const STUDIO_NAMES = { chars: 'Mina, Rook, Sora' };
/* backup files the restore can take (a made-up file list; the file picker is simulated) */
const FILES = [
  { id: 'f1', name: 'risu-backup-20261020.rtb', fmt: 'rtb', ok: true, chars: 118, chats: 2310, bytes: 598 * MB, at: new Date(2026, 9, 20, 22, 4).getTime(), missImg: 12, missBytes: Math.round(38 * MB) },
  { id: 'f2', name: 'local-20261015.bin', fmt: 'bin', ok: true, chars: 112, chats: 2204, bytes: 571 * MB, at: new Date(2026, 9, 15, 9, 40).getTime(), missImg: 0, missBytes: 0 },
  { id: 'f3', name: 'damaged-20261012.rtb', fmt: 'rtb', ok: true, damaged: 2, chars: 109, chats: 2110, bytes: 560 * MB, at: new Date(2026, 9, 12, 18, 15).getTime(), missImg: 3, missBytes: 6 * MB, lostChats: 14 },
  { id: 'f4', name: 'notes.txt', fmt: '', ok: false, why: 'notBackup' },
  { id: 'f5', name: 'broken.bin', fmt: 'bin', ok: false, why: 'unreadable' },
  { id: 'f6', name: 'locked.bin', fmt: 'bin', ok: false, why: 'encrypted' },
];
/* settings files the import can take: the changes are real rows of the earlier slices (so Undo has something to put back) */
const SFILES = [
  { id: 'g1', name: 'risu-settings-20261022.json', ok: true, changes: [['display.zoom', 110], ['display.lineHeight', 1.5], ['display.colorScheme', 'ocean'], ['display.copyBtn', true], ['input.sendWithEnter', false], ['display.roundIcons', true], ['input.swipe', false]] },
  { id: 'g2', name: 'risu-settings-small.json', ok: true, changes: [['display.zoom', 120], ['display.playMessage', true]] },
  { id: 'g3', name: 'chat-export.json', ok: false, why: 'notSettings' },
  { id: 'g4', name: 'with-keys.json', ok: false, why: 'hasKeys' },
];
const LOG_LINES = [
  ['14:02:11', 'POST', '/v1/messages', 200, 1842, '3.1'], ['14:01:20', 'POST', '/v1/messages', 200, 1517, '2.4'], ['13:58:47', 'POST', '/v1/messages', 429, 0, '0.4'], ['13:58:49', 'POST', '/v1/messages', 200, 1604, '2.9'],
  ['13:41:05', 'POST', '/v1/chat/completions', 200, 988, '1.7'], ['13:40:12', 'POST', '/v1/chat/completions', 200, 1203, '2.0'],
];
const STAT_ROWS = [['2026-10', 412, 618400], ['2026-09', 987, 1502200], ['2026-08', 640, 931050], ['2026-07', 205, 301900]];
const BAN_SCRIPTS = [   // the 18 scripts of the ban list: code, KO name, EN name, a sample glyph run (the app labels each with Intl.DisplayNames and a sample)
  ['Latn', '라틴 문자', 'Latin', 'Abc'], ['Hani', '한자', 'Han', '漢字'], ['Arab', '아랍 문자', 'Arabic', 'عربى'], ['Deva', '데바나가리', 'Devanagari', 'हिन्दी'], ['Cyrl', '키릴 문자', 'Cyrillic', 'Абв'], ['Beng', '벵골 문자', 'Bangla', 'বাংলা'],
  ['Hira', '히라가나', 'Hiragana', 'ひらがな'], ['Kana', '가타카나', 'Katakana', 'カタカナ'], ['Telu', '텔루구 문자', 'Telugu', 'తెలుగు'], ['Hang', '한글', 'Hangul', '한글'], ['Taml', '타밀 문자', 'Tamil', 'தமிழ்'], ['Thai', '태국 문자', 'Thai', 'ไทย'],
  ['Gujr', '구자라트 문자', 'Gujarati', 'ગુજરાતી'], ['Knda', '칸나다 문자', 'Kannada', 'ಕನ್ನಡ'], ['Ethi', '에티오피아 문자', 'Ethiopic', 'አማርኛ'], ['Khmr', '크메르 문자', 'Khmer', 'ខ្មែរ'], ['Grek', '그리스 문자', 'Greek', 'Ελλ'], ['Hebr', '히브리 문자', 'Hebrew', 'עברית'],
];
const LANGS_UI = [['de', 'Deutsch'], ['en', 'English'], ['ko', '한국어'], ['cn', '简体中文'], ['zh-Hant', '繁體中文'], ['vi', 'Tiếng Việt'], ['es', 'Español']];   // the app's language list, in native names
/* the .bin leave-out list: synthetic and marked mock (DD-227); Lane A returns the real kinds present */
const LEFTOUT = [{ n: 12, kind: 'chatFields' }, { n: 4, kind: 'members' }, { n: 9, kind: 'failures' }, { n: 3, kind: 'reading' }, { n: 7, kind: 'sort' }];

/* ---------------------------------------------------------------- pages and sections */
const pageOf = (id) => D.PAGES.find((p) => p.id === id);
pageOf('data').syn += ' 백업 복원 불러오기 스냅샷 보관 정리 캐시 점검 내보내기 데이터셋 설정 파일 backup restore snapshot archive cleanup cache verify export import rtb bin';
pageOf('adv').syn += ' 요청 로어북 채팅 불러오기 화면 조정 프롬프트 문제 해결 로그 통계 실험 권장하지 않음 문자 막기 request lorebook chat load troubleshooting logs statistics experimental unrecommended ban characters';
pageOf('lang').syn += ' 앱 언어 번역 파일 받기 lang.json translang language app language reopen';
{ const first = D.SECTIONS.findIndex((s) => s.page === 'data'); const n = D.SECTIONS.filter((s) => s.page === 'data').length;
  D.SECTIONS.splice(first, n, ...[['data', 'data.backup', '백업', 'Backup'], ['data', 'data.transfer', '내보내기·가져오기', 'Export and import'], ['data', 'data.storage', '저장 공간', 'Storage']].map(([page, id, ko, en]) => ({ page, id, ko, en }))); }
{ const first = D.SECTIONS.findIndex((s) => s.page === 'adv'); const n = D.SECTIONS.filter((s) => s.page === 'adv').length;
  D.SECTIONS.splice(first, n, ...[['adv', 'adv.request', '요청', 'Requests'], ['adv', 'adv.lorebook', '로어북', 'Lorebook'], ['adv', 'adv.chatload', '채팅 불러오기', 'Loading chats'], ['adv', 'adv.display', '화면 조정', 'Screen tuning'],
    ['adv', 'adv.prompt', '프롬프트 글', 'Prompt text'], ['adv', 'adv.trouble', '문제 해결', 'Troubleshooting'], ['adv', 'adv.gates', '기능 공개', 'Revealing features'], ['adv', 'adv.experimental', '실험적 기능', 'Experimental features'],
    ['adv', 'adv.unrecommended', '권장하지 않음', 'Not recommended'], ['adv', 'adv.custom', '사용자 지정', 'Custom']].map(([page, id, ko, en]) => ({ page, id, ko, en }))); }

/* ---------------------------------------------------------------- rows: slice 1's invented data.* and adv.* rows go; the real ones come. Kept: the ids other slices use (adv.useExperimental, adv.showUnrec, adv.proTools, adv.easyPanel, adv.requestInfo, adv.keepAlive, data.goCharOnImport). */
const KEEP = ['data.goCharOnImport', 'adv.useExperimental', 'adv.showUnrec', 'adv.proTools', 'adv.easyPanel', 'adv.requestInfo', 'adv.keepAlive'];
for (let i = rows.length - 1; i >= 0; i--) { const r = rows[i]; if ((r.page === 'data' || r.page === 'adv') && KEEP.indexOf(r.id) < 0) { delete ROWI[r.id]; rows.splice(i, 1); } }
let cur = '';
const sec = (id) => { cur = id; };
function add(type, id, ko, en, o) { const r = Object.assign({ type, id, sec: cur, page: cur.split('.')[0], ko, en, p5c2: true }, o || {}); rows.push(r); ROWI[id] = r; return r; }
const opts = (s) => s.split(';').map((p) => { const i = p.indexOf(':'); const v = p.slice(0, i); const l = p.slice(i + 1).split('|'); return [v, l[0], l[1] || l[0]]; });
const sw = (id, ko, en, d, o) => add('switch', id, ko, en, Object.assign({ d, v: d }, o));
const se = (id, ko, en, d, op, o) => add('select', id, ko, en, Object.assign({ d, v: d, opt: opts(op) }, o));
const nu = (id, ko, en, d, r, o) => add('number', id, ko, en, Object.assign({ d, v: d, min: r[0], max: r[1] }, o));
const tx = (id, ko, en, d, o) => add('text', id, ko, en, Object.assign({ d, v: d }, o));
const ta = (id, ko, en, d, o) => add('textarea', id, ko, en, Object.assign({ d, v: d }, o));
const bt = (id, ko, en, icon, op, o) => add('button', id, ko, en, Object.assign({ icon, op }, o));
const nv = (id, ko, en, target, o) => add('nav', id, ko, en, Object.assign({ target }, o));
const dep = (id, ins) => ({ id, in: ins });
const live = (r, name, get) => { Object.defineProperty(r, name, { enumerable: true, configurable: true, get }); return r; };   // a flag the platform decides (r.dev, read by slice 1's unavail)

/* ---- 데이터·백업 */
sec('data.backup');
bt('data.backupMake', '백업 만들기', 'Make a backup', 'archive', 'backup', { desc: '형식과 범위를 고른 다음 시작해요|Pick a format and what to include, then start', syn: 'SaveLocalBackup SavePartialLocalBackup save backup partial backup full backup rtb bin 백업 저장 전체 백업 일부만 백업 캐릭터 에셋 제외 파일로 저장' });
bt('data.restoreFile', '파일에서 불러오기', 'Restore from a file', 'upload', 'restore-file', { desc: '.rtb나 .bin 파일의 내용으로 지금 데이터를 바꿔요|Replaces your current data with the contents of an .rtb or .bin file', syn: 'LoadLocalBackup load backup restore from file rtb bin 복원 파일 불러오기 백업 불러오기' });
bt('data.restoreSnapshot', '자동 스냅샷에서 불러오기', 'Restore from an automatic snapshot', 'history', 'snapshots', { syn: 'loadInternalBackup load internal backup snapshot dbbackup 스냅샷 자동 백업 앱 안의 백업 시점 되돌리기' });
sec('data.transfer');
bt('data.exportDataset', '데이터셋으로 내보내기', 'Export as a dataset', 'download', 'dataset', { desc: '채팅을 캐릭터별로 한 줄씩 담은 dataset.json을 만들어요|Writes dataset.json with one line per chat, grouped by character', syn: 'exportAsDataset export as dataset dataset.json 데이터셋 내보내기 채팅 내보내기' });
bt('data.exportSettings', '설정 파일 내보내기', 'Export a settings file', 'download', 'settings-export', { isNew: true, desc: '앱 설정과 프리셋 선택만 담아요. 연결 키와 채팅은 담기지 않아요|App settings and preset choices only. Connection keys and chats are not included', syn: 'export settings file 설정 파일 설정 내보내기 설정 옮기기' });
bt('data.importSettings', '설정 파일 가져오기', 'Import a settings file', 'upload', 'settings-import', { isNew: true, desc: '무엇이 바뀌는지 먼저 보여 주고, 가져온 뒤 10초 동안 되돌릴 수 있어요|Shows what will change first, and you can undo for 10 seconds', syn: 'import settings file 설정 파일 가져오기 설정 불러오기 설정 옮기기' });
ROWI['data.goCharOnImport'].sec = 'data.transfer'; ROWI['data.goCharOnImport'].desc = 'RisuRealm에서 가져올 때만 쓰여요. 가져온 캐릭터로 바로 가요|Only used when importing from RisuRealm. Jumps to the imported character'; ROWI['data.goCharOnImport'].page = 'data';
sec('data.storage');
sw('data.archiveCharacters', '오래된 캐릭터 보관하기', 'Archive old characters', true, { desc: '오래 안 쓴 캐릭터를 보관소로 옮겨 앱을 가볍게 해요|Moves characters you have not used for a while into the archive to keep the app light', help: '보관한 캐릭터는 열 때 다시 꺼내 와요. 끄면 보관 메모를 지워요.|An archived character is brought back when you open it. Turning this off clears the archive memo.', syn: 'archiveCharacters cold storage coldstorage coldStart archive characters at startup 보관 콜드 스토리지 시작할 때 캐릭터 보관' });
bt('data.cleanCold', '쓰지 않는 보관 데이터와 파일 정리', 'Clean unused archived data and files', 'trash-2', 'clean', { syn: 'cleanColdStorage runManualCleanup clean unused archived data and assets cold storage 정리 삭제 보관 데이터 에셋 이미지 오디오' });
live(bt('data.verifyCache', '이미지 캐시 점검', 'Check the image cache', 'shield-check', 'verify', { desc: '저장된 이미지와 파일이 깨지지 않았는지 지금 확인해요|Checks right now that cached images and files are not corrupted', syn: 'verifyAssetIntegrity verify asset cache integrity asset cache 이미지 캐시 점검 무결성 손상' }), 'dev', () => !!PLAT.tauri);
live(sw('data.checkCorruption', '시작할 때 손상 확인', 'Check for corruption at startup', false, { desc: '시작할 때 표본을 확인해서 깨진 파일이 있으면 알려 줘요|Checks a sample at startup and warns if a file is corrupted', syn: 'checkCorruption asset cache integrity warn on startup 시작할 때 손상 확인 캐시 손상' }), 'dev', () => !!PLAT.tauri);

/* ---- 고급 */
sec('adv.request');
nu('adv.genTime', '한 번에 받을 답 수', 'Replies per request', 1, [0, 4096], { help: '지원하는 모델에서 한 번의 요청으로 받을 답의 수예요. 앱이 받는 값은 0에서 4096까지예요.|How many replies one request asks for, on models that support it. The app accepts 0 to 4096.', syn: 'genTime generation choices 생성 횟수 답변 수 한 번에' });
se('adv.gptVisionQuality', '이미지 이해 품질', 'Image understanding quality', 'low', 'low:낮음|Low;high:높음|High', { syn: 'gptVisionQuality vision quality 비전 품질 이미지 이해' });
live(se('adv.requestLocation', '요청 보낼 지역', 'Request region', '', ':기본|Default;eu:유럽 (EU)|Europe (EU);fedramp:미국 정부용 (FedRAMP)|US government (FedRAMP)', { desc: '웹 브라우저에서만 나와요|Only shown in a web browser', syn: 'requestLocation request location eu fedramp 리퀘스트 위치 지역' }), 'dev', () => !PLAT.web);
sw('adv.autoContinueChat', '끊긴 답 자동으로 이어 쓰기', 'Continue cut-off replies automatically', false, { help: '답이 문장 부호로 끝나지 않으면 이어 쓰라고 다시 요청해요. 문장 부호를 쓰지 않는 언어에서는 켜지 마세요.|When a reply does not end in punctuation, asks the model to continue. Do not turn it on for languages that do not use punctuation.', syn: 'autoContinueChat anti incomplete response auto continue 불완전 문단 방지 자동 컨티뉴' });
nu('adv.autoContinueMinTokens', '이어 쓰기 최소 토큰', 'Auto-continue minimum tokens', 0, [0, undefined], { desc: '자동으로 이어 쓰기와 함께 쓰이는 값이에요|Used together with automatic continuing', syn: 'autoContinueMinTokens auto continue min tokens' });
sw('adv.removeIncompleteResponse', '끊긴 문장 지우기', 'Remove incomplete sentences', false, { syn: 'removeIncompleteResponse remove incomplete response 불완전 문단 제거 끊긴 문장' });
sw('adv.antiServerOverloads', '서버 과부하 피하기', 'Avoid server overload', false, { syn: 'antiServerOverloads antiClaudeOverload anti server overload 서버 과부하' });
sw('adv.forceProxyAsOpenAI', '프록시를 OpenAI 형식으로 강제', 'Force proxy requests into OpenAI format', false, { syn: 'forceProxyAsOpenAI force proxy as openai 프록시 OpenAI 형식' });
sw('adv.autofillRequestUrl', '요청 주소 자동 채우기', 'Autofill the request URL', true, { syn: 'autofillRequestUrl autofill request url 요청 주소 자동' });
sw('adv.newOAIHandle', '새 OpenAI 처리 방식', 'New OpenAI handling', true, { syn: 'newOAIHandle new oai handle 새 OpenAI 처리' });
sw('adv.useSayNothing', '입력이 없으면 “아무 말 없음” 보내기', 'Send “say nothing” when the input is empty', true, { syn: 'useSayNothing say nothing 아무 말 없음 빈 입력' });
sw('adv.useTokenizerCaching', '토크나이저 캐시', 'Tokenizer caching', true, { syn: 'useTokenizerCaching tokenizer caching 토크나이저 캐시' });
sw('adv.auxModelUnderModelSettings', '보조 모델을 모델 설정 아래에 두기', 'Put the auxiliary model under the model settings', false, { syn: 'auxModelUnderModelSettings aux model under model settings 보조 모델' });
sw('adv.disableSeperateParameterChangeOnPresetChange', '프리셋을 바꿔도 따로 둔 파라미터 유지', 'Keep separate parameters when the preset changes', false, { syn: 'disableSeperateParameterChangeOnPresetChange separate parameter preset change 파라미터 프리셋 바꿀 때' });
sw('adv.dynamicModelRegistry', '모델 목록 자동 갱신', 'Update the model list automatically', true, { syn: 'dynamicModelRegistry dynamic model registry 모델 목록 모델 레지스트리' });
sw('adv.noWaitForTranslate', '번역을 기다리지 않고 보내기', 'Send without waiting for translation', false, { syn: 'noWaitForTranslate no wait for translate 번역 기다리지 않기' });
sw('adv.newImageHandlingBeta', '새 이미지 처리 방식 (베타)', 'New image handling (beta)', false, { syn: 'newImageHandlingBeta new image handling beta 새 이미지 처리' });
sw('adv.removePunctuationHypa', '기억 요약에서 문장 부호 빼기', 'Remove punctuation in memory summaries', false, { syn: 'removePunctuationHypa remove punctuation hypa 기억 요약 문장 부호' });
sw('adv.openAIFlexProcessing', 'OpenAI Flex 처리', 'OpenAI flex processing', false, { desc: '아직 실험 중인 기능이에요|Still an experimental feature', exph: true, syn: 'openAIFlexProcessing openai flex processing flex 실험' });
sw('adv.claude1HourCaching', 'Claude 1시간 캐시', 'Claude 1-hour caching', false, { desc: '아직 실험 중인 기능이에요|Still an experimental feature', exph: true, syn: 'claude1HourCaching claude 1 hour caching 1시간 캐시 실험' });
sw('adv.claudeBatching', 'Claude 배치 요청', 'Claude batching', false, { desc: '아직 실험 중인 기능이에요|Still an experimental feature', exph: true, syn: 'claudeBatching claude batching 배치 실험' });
sw('adv.personaNote', '페르소나 노트', 'Persona note', false, { desc: '아직 실험 중인 기능이에요|Still an experimental feature', exph: true, syn: 'personaNote persona note 페르소나 노트 실험' });
sw('adv.localNetworkMode', '로컬 네트워크 모드 (실험 중)', 'Local network mode (experimental)', false, { help: '같은 네트워크의 서버로 요청을 보낼 때 써요. 아직 실험 중이어서 켜지 않아도 모든 걸 쓸 수 있어요.|For requests to a server on your own network. It is still experimental; everything works without it.', exph: true, syn: 'localNetworkMode local network mode 로컬 네트워크 실험' });
nu('adv.localNetworkTimeoutSec', '로컬 네트워크 제한 시간(초)', 'Local network timeout (seconds)', 600, [30, 3600], { dep: { id: 'adv.localNetworkMode', eq: true }, syn: 'localNetworkTimeoutSec local network timeout 제한 시간' });

sec('adv.lorebook');
nu('adv.loreBookDepth', '로어북 검색 깊이', 'Lorebook search depth', 5, [0, 20], { help: '최근 메시지를 몇 개까지 거슬러 올라가며 로어북 낱말을 찾을지 정해요.|How many recent messages are searched for lorebook keywords.', syn: 'loreBookDepth lorebook search depth world info 로어북 검색 깊이' });
nu('adv.loreBookToken', '로어북 최대 토큰', 'Lorebook max tokens', 800, [0, 4096], { help: '로어북 내용이 프롬프트에서 차지할 수 있는 토큰의 한도예요.|The most tokens lorebook content may take in the prompt.', syn: 'loreBookToken lorebook max tokens 로어북 최대 토큰' });

sec('adv.chatload');
nu('adv.chatLoadInitialPages', '처음 불러올 페이지 수', 'Pages loaded first', 30, [1, undefined], { desc: '채팅을 열 때 먼저 불러와요. 단위는 메시지 수가 아니라 페이지예요|Loaded when a chat opens. The unit is pages, not messages', syn: 'chatLoadInitialPages initial chat load pages 처음 불러올 채팅' });
nu('adv.chatLoadAdditionalPages', '더 불러올 페이지 수', 'Pages loaded each time you scroll', 15, [1, undefined], { desc: '위로 올릴 때마다 더 불러와요. 단위는 페이지예요|Loaded each time you scroll up. The unit is pages', syn: 'chatLoadAdditionalPages additional chat load pages 더 불러올 채팅' });

sec('adv.display');
se('adv.heightMode', '화면 높이 계산 방식', 'How screen height is measured', 'normal', 'normal:보통|Normal;percent:화면의 퍼센트|Percent of the screen;vh:화면 높이 단위 (vh)|Screen height unit (vh);dvh:움직이는 화면 높이 (dvh)|Moving screen height (dvh);svh:가장 작은 화면 높이 (svh)|Smallest screen height (svh);lvh:가장 큰 화면 높이 (lvh)|Largest screen height (lvh)', { help: '모바일에서 주소창이나 키보드 때문에 화면 아래가 잘려 보일 때 바꿔 보세요. vh, dvh, svh, lvh는 화면 높이를 재는 단위예요. 어느 쪽이 맞는지는 기기마다 달라요.|Try another one on mobile when the address bar or the keyboard cuts off the bottom. vh, dvh, svh and lvh are units for measuring the screen height; which one fits depends on the device.', syn: 'heightMode height mode vh dvh svh lvh viewport 높이 방식 화면 높이 주소창 키보드' });
sw('adv.imageCompression', '이미지 압축', 'Image compression', true, { help: '캐릭터를 내보낼 때 이미지를 압축해요.|Compresses images when a character is exported.', syn: 'imageCompression image compression 이미지 압축' });
sw('adv.enableScrollToActiveChar', '현재 캐릭터로 스크롤', 'Scroll to the active character', true, { syn: 'enableScrollToActiveChar scroll to active character 현재 캐릭터로 스크롤' });
sw('adv.dynamicAssets', '다이나믹 에셋', 'Dynamic assets', false, { help: '에셋 이름을 못 찾으면 가장 비슷한 에셋을 찾아서 써요.|When an asset name is not found, the closest asset is used.', syn: 'dynamicAssets dynamic assets 다이나믹 에셋' });
nu('adv.assetMaxDifference', '에셋 이름 허용 차이', 'Asset name tolerance', 4, [0, undefined], { dep: { id: 'adv.dynamicAssets', eq: true }, desc: '값이 클수록 이름이 많이 달라도 찾아 줘요|A larger value finds assets whose names differ more', syn: 'assetMaxDifference asset max difference 에셋 최대 차이' });
sw('adv.dynamicAssetsEditDisplay', '표시 수정에서도 다이나믹 에셋 쓰기', 'Use dynamic assets in display edits', false, { dep: { id: 'adv.dynamicAssets', eq: true }, syn: 'dynamicAssetsEditDisplay dynamic assets edit display 표시 수정' });
sw('adv.realmDirectOpen', 'Realm 바로 열기', 'Open Realm directly', false, { syn: 'realmDirectOpen realm direct open 렐름 바로 열기' });

sec('adv.prompt');
ta('adv.additionalPrompt', '추가 프롬프트', 'Additional prompt', 'The assistant must act as {{char}}. Stay in character.', { scope: 'preset', help: '프롬프트 보정이 켜져 있을 때 메인 프롬프트 끝에 붙는 글이에요.|Text appended to the main prompt when prompt adjustment is on.', syn: 'additionalPrompt additional prompt 추가 프롬프트' });
tx('adv.descriptionPrefix', '캐릭터 설명 앞머리', 'Character description prefix', 'description of {{char}}: ', { syn: 'descriptionPrefix description prefix 캐릭터 설명 앞머리' });
ta('adv.presetChain', '프리셋 이어 쓰기', 'Preset chain', '', { help: '프리셋을 차례로 이어서 쓰는 순서를 적어요. 비워 두면 쓰지 않아요.|Write the order in which presets are chained. Blank means unused.', syn: 'presetChain preset chain 프리셋 체인 프리셋 이어 쓰기' });

sec('adv.trouble');
bt('adv.reqLogs', '요청 기록 보기', 'View request logs', 'scroll-text', 'logs', { desc: '최근 요청을 시간 순으로 보여 줘요|Shows recent requests in time order', syn: 'getRequestLog show request logs alertMd 요청 기록 로그' });
bt('adv.stats', '사용 통계 보기', 'View usage statistics', 'chart-column', 'stats', { syn: 'statics show statistics 통계 사용량 토큰' });
bt('adv.bugReport', '문제 신고용 설정 내보내기', 'Export settings for a bug report', 'bug', 'bug', { desc: '연결 키 같은 민감한 항목은 빼고 파일로 만들어요|Writes a file without sensitive items such as connection keys', syn: 'risuai-settings-report export settings for bug report 버그 신고 문제 신고 설정 내보내기' });
sw('adv.enableDevTools', '개발자 도구', 'Developer tools', false, { syn: 'enableDevTools enable dev tools inspector 개발자 도구' });
sw('adv.pluginDevelopMode', '플러그인 개발 모드', 'Plugin development mode', false, { syn: 'pluginDevelopMode plugin develop mode 플러그인 개발 모드' });
sw('adv.returnCSSError', 'CSS 오류 알려 주기', 'Report CSS errors', true, { syn: 'returnCSSError return css error CSS 오류' });
live(sw('adv.promptInfoInsideChat', '채팅에 프롬프트 정보 보이기', 'Show prompt info in the chat', false, { desc: '데스크톱 앱과 서버판에서만 나와요|Only shown in the desktop app and the server build', syn: 'promptInfoInsideChat prompt info inside chat 프롬프트 정보 채팅 안에' }), 'dev', () => PLAT.web);
live(sw('adv.promptTextInfoInsideChat', '프롬프트 정보에 글 내용도 넣기', 'Include the text in the prompt info', false, { dep: { id: 'adv.promptInfoInsideChat', eq: true }, syn: 'promptTextInfoInsideChat prompt text info inside chat 프롬프트 글 내용' }), 'dev', () => PLAT.web);
ROWI['adv.requestInfo'].sec = 'adv.trouble'; ROWI['adv.requestInfo'].page = 'adv';
sw('adv.simplifiedToolUse', '간단한 도구 사용', 'Simplified tool use', false, { syn: 'simplifiedToolUse simplified tool use 간단한 도구 사용' });
sw('adv.rememberToolUsage', '도구 사용 기억', 'Remember tool usage', true, { syn: 'rememberToolUsage remember tool usage 도구 사용 기억' });
ROWI['adv.keepAlive'].sec = 'adv.trouble'; ROWI['adv.keepAlive'].page = 'adv'; live(ROWI['adv.keepAlive'], 'dev', () => PLAT.android);
sw('adv.allowAllExtentionFiles', '모든 파일 형식 고르기 허용', 'Allow choosing any file type', false, { syn: 'allowAllExtentionFiles allow all file select 모든 파일 형식' });
sw('adv.bookmark', '북마크', 'Bookmarks', true, { syn: 'bookmark 북마크' });

sec('adv.gates');
ROWI['adv.showUnrec'].sec = 'adv.gates'; ROWI['adv.useExperimental'].sec = 'adv.gates';
ROWI['adv.useExperimental'].ko = '실험적 기능 보이기'; ROWI['adv.useExperimental'].en = 'Show experimental features'; ROWI['adv.useExperimental'].help = '켜면 아직 다듬는 중인 기능이 아래에 나타나요.|Reveals features that are still being refined, below.';
ROWI['adv.showUnrec'].ko = '권장하지 않는 설정 보이기'; ROWI['adv.showUnrec'].en = 'Show settings that are not recommended'; ROWI['adv.showUnrec'].help = '켜면 권장하지 않거나 더 이상 쓰지 않는 설정이 아래에 나타나요.|Reveals settings that are not recommended or no longer used, below.';
ROWI['adv.proTools'].sec = 'adv.gates'; ROWI['adv.easyPanel'].sec = 'adv.gates';
sec('adv.experimental');
sw('adv.googleClaudeTokenizing', 'Google Cloud 토큰 세기', 'Google Cloud tokenizing', false, { exp: true, syn: 'googleClaudeTokenizing google cloud tokenization 토큰 세기' });
sw('adv.automaticCachePoint', '자동 캐시 지점', 'Automatic cache point', false, { exp: true, syn: 'automaticCachePoint automatic cache point 캐시 지점' });
sw('adv.useExperimentalGoogleTranslator', '새 Google 번역', 'New Google Translate', false, { exp: true, syn: 'useExperimentalGoogleTranslator new google translate 새 구글 번역' });
sw('adv.claudeRetrivalCaching', 'Claude 캐시 다시 쓰기', 'Claude caching retrieval', false, { exp: true, syn: 'claudeRetrivalCaching claude caching retrieval 캐시 다시 쓰기' });
sec('adv.unrecommended');
const U = { id: 'adv.showUnrec', eq: true };
sw('adv.chainOfThought', '생각의 사슬', 'Chain of thought', false, { dep: U, syn: 'chainOfThought chain of thoughts cot 생각의 사슬' });
sw('adv.usePlainFetch', '직접 요청 보내기 (fetch 강제)', 'Force plain fetch', false, { dep: U, syn: 'usePlainFetch force plain fetch 직접 요청 cors' });
sw('adv.showDeprecatedTriggerV1', '이전 트리거 V1 보이기', 'Show deprecated trigger V1', false, { dep: U, help: '이미 쓰지 않는 항목일 수 있어요. 앱을 만든 쪽에서 확인 중이에요.|This may already be dead. The app team is confirming.', syn: 'showDeprecatedTriggerV1 deprecated trigger v1 트리거 이전' });
sw('adv.legacyMediaFindings', '이전 미디어 찾기 방식', 'Old way of finding media', false, { dep: U, help: '이미 쓰지 않는 항목일 수 있어요. 앱을 만든 쪽에서 확인 중이에요.|This may already be dead. The app team is confirming.', syn: 'legacyMediaFindings legacy media findings 미디어 찾기 이전' });
sec('adv.custom');
add('button', 'adv.banCharacterset', '쓰지 않을 문자 종류', 'Script types to ban', { icon: 'chevron-right', op: 'ban', custom: true, syn: 'banCharacterset ban character set 글자 종류 막기 문자 금지 문자 종류 막기 한자 한글 라틴' });
nv('adv.customModels', '사용자 모델', 'Custom models', 'models.mainModel', { syn: 'customModels custom models 사용자 모델 직접 추가한 모델', desc: '모델·프리셋의 연결에서 고쳐요|Edited under Connections in Models and presets' });
/* every p5c2 row also keeps the default for the fixture reset */
const IDS = rows.filter((r) => r.p5c2 && r.d !== undefined).map((r) => r.id);
const MOVED = ['data.goCharOnImport', 'adv.requestInfo', 'adv.keepAlive'];
function reset(set) {
  const fresh = makeST(set);
  Object.keys(ST).forEach((k) => { delete ST[k]; }); Object.assign(ST, fresh);
  rows.forEach((r) => { if (r.d !== undefined && (r.p5c2 || MOVED.indexOf(r.id) >= 0) && !(Object.getOwnPropertyDescriptor(r, 'v') || {}).get) r.v = r.d; });
  ROWI['adv.useExperimental'].v = set === 'experimental'; ROWI['adv.showUnrec'].v = set === 'experimental';
}
ROWI['adv.useExperimental'].v = SET5D === 'experimental'; ROWI['adv.showUnrec'].v = SET5D === 'experimental';
void IDS;

/* ---- 언어: the app language row keeps its id and gets the app's seven languages; the community translation download is a new row */
{ const r = ROWI['lang.ui']; r.opt = LANGS_UI.map((l) => [l[0], l[1], l[1]]); r.desc = undefined; r.syn += ' language 앱 언어 de en ko cn zh-Hant vi es 독일어 영어 한국어 중국어 베트남어 스페인어 reopen'; delete r.d; }
sec('lang.app');
bt('lang.translang', '번역 파일 받기', 'Get the translation file', 'download', 'translang', { desc: '내 언어로 번역하고 싶을 때 쓰는 lang.json을 받아요|Downloads lang.json, the file you translate to add your own language', syn: 'translang translate in your own language lang.json 내 언어로 번역하기 번역 파일 받기 커뮤니티 번역' });

/* ---------------------------------------------------------------- copy: pattern strings (RisuPattern.addStrings) and the page copy (K) */
const PK = {
  ko: {
    'p2.step.prep': '파일 준비', 'p2.step.assets': '이미지·에셋 담기', 'p2.step.inlays': '인레이 담기', 'p2.step.cold': '보관 데이터 담기', 'p2.step.db': '데이터베이스 저장', 'p2.step.review': '담을 항목 확인', 'p2.step.profile': '프로필 이미지 담기',
    'p2.step.check': '파일 확인', 'p2.step.tabs': '다른 탭 확인', 'p2.step.safety': '안전 스냅샷 만들기', 'p2.step.write': '이미지·보관 데이터 쓰기', 'p2.step.replace': '데이터 교체하기', 'p2.step.verify': '저장 확인', 'p2.step.snapcheck': '스냅샷 확인',
    'p2.step.read': '보관소에서 읽기', 'p2.step.build': '파일 만들기', 'p2.step.confirm': '확인', 'p2.step.delete': '지우기', 'p2.step.scan': '읽기', 'p2.step.compare': '확인', 'p2.step.sfile': '파일 확인', 'p2.step.apply': '적용',
    'p2.noun.asset': '이미지·에셋', 'p2.noun.inlay': '인레이', 'p2.noun.cold': '보관 항목', 'p2.noun.profile': '프로필 이미지', 'p2.noun.char': '캐릭터', 'p2.noun.file': '파일', 'p2.noun.setting': '설정',
    'task.title.scan': '{name} 점검하는 중', 'task.titleDone.scan': '{name} 점검', 'task.done.scan': '점검을 마쳤어요', 'task.failed.scan': '점검을 마치지 못했어요',
    'task.title.clean': '쓰지 않는 파일 정리하는 중', 'task.titleDone.clean': '쓰지 않는 파일 정리', 'task.done.clean': '정리를 마쳤어요', 'task.failed.clean': '정리를 마치지 못했어요',
    'task.done.import': '설정 {n}개를 바꿨어요', 'task.undone.summary': '바꿨던 설정 {n}개를 원래대로 돌렸어요',
  },
  en: {
    'p2.step.prep': 'Preparing the file', 'p2.step.assets': 'Adding images and assets', 'p2.step.inlays': 'Adding inlays', 'p2.step.cold': 'Adding archived data', 'p2.step.db': 'Saving the database', 'p2.step.review': 'Checking what to include', 'p2.step.profile': 'Adding profile images',
    'p2.step.check': 'Checking the file', 'p2.step.tabs': 'Checking other tabs', 'p2.step.safety': 'Making a safety snapshot', 'p2.step.write': 'Writing images and archived data', 'p2.step.replace': 'Replacing data', 'p2.step.verify': 'Verifying the save', 'p2.step.snapcheck': 'Checking the snapshot',
    'p2.step.read': 'Reading from the archive', 'p2.step.build': 'Building the file', 'p2.step.confirm': 'Checking', 'p2.step.delete': 'Deleting', 'p2.step.scan': 'Reading', 'p2.step.compare': 'Comparing', 'p2.step.sfile': 'Checking the file', 'p2.step.apply': 'Applying',
    'p2.noun.asset': 'Images and assets', 'p2.noun.inlay': 'Inlays', 'p2.noun.cold': 'Archived', 'p2.noun.profile': 'Profile images', 'p2.noun.char': 'Characters', 'p2.noun.file': 'Files', 'p2.noun.setting': 'Settings',
    'task.title.scan': 'Checking {name}', 'task.titleDone.scan': 'Check {name}', 'task.done.scan': 'Check finished', 'task.failed.scan': 'Check stopped',
    'task.title.clean': 'Cleaning unused files', 'task.titleDone.clean': 'Clean unused files', 'task.done.clean': 'Cleanup finished', 'task.failed.clean': 'Cleanup stopped',
    'task.done.import': 'Changed {n} settings', 'task.undone.summary': 'Put the {n} changed settings back',
  },
};
const K = { ko: {}, en: {} };
Object.assign(K.ko, {
  title: '설정 슬라이스 5c-2 · 데이터·백업, 고급, 언어 목업', cancel: '취소', close: '닫기', later: '나중에', newTag: '새 기능', newTagTitle: '앱에 없던 새 기능이에요 (제안)',
  relMin: (m) => `${m}분 전`, relHour: (h) => `${h}시간 전`, relDay: (d) => `${d}일 전`, archived: '보관됨', damagedBlock: '손상',
  // 백업 만들기
  bkT: '백업 만들기', bkFmt: '형식', bkRtb: '.rtb · 권장', bkRtbD: '이 앱의 모든 데이터와 연결 키가 들어가요', bkBin: '.bin', bkBinD: 'RisuAI와 호환돼요', bkScope: '범위', bkFull: '전체', bkFullD: (s) => `캐릭터 에셋까지 모두 · 약 ${s} (추정)`, bkPart: '일부', bkPartD: (s) => `캐릭터 에셋 제외 · 약 ${s} (추정)`, bkStart: '시작',
  bkSub: (c, ch, s) => `캐릭터 ${c}개 · 채팅 ${ch}개 · 약 ${s} (추정)`, bkCounts: (c, ch, p) => `캐릭터 ${c}개, 채팅 ${ch}개, 프리셋 ${p}개`,
  wKeysH: '연결 키가 파일에 들어가요. 다른 사람에게 보내지 마세요', wKeysC: (n) => `연결 ${n}개의 키가 이 파일에 담겨요`,
  wMemH: '이 기기에서는 파일을 메모리에서 먼저 만들어요', wMemC1: '다 만든 뒤에 한 번에 저장돼요', wMemC2: (s) => `파일이 클수록 메모리를 많이 써요 (약 ${s}, 추정)`,
  wBinH: '.bin에는 이 앱에서만 쓰는 데이터가 담기지 않아요', wBinD1: '전체를 담으려면 .rtb로 만드세요.', wBinD2: '연결 키는 .bin에도 들어가요. 파일을 다른 사람에게 보내지 마세요.', wBinSecondary: '.rtb로 만들기', wBinPrimary: '그래도 .bin으로',
  lo_chatFields: (n) => `채팅 ${n}개의 채팅별 탈옥·기억 문구는 빠져요`, lo_members: (n) => `삭제된 멤버 이름 ${n}개는 빠져요`, lo_failures: (n) => `실패 기록과 편집 초안 ${n}개는 빠져요`, lo_reading: (n) => `읽기 설정 ${n}개는 빠져요`, lo_sort: (n) => `채팅 정렬 기록 ${n}개는 빠져요`,
  wPartH: '일부만 백업해요', wPartC1: (n, m) => `프로필 이미지 ${n}개와 보관 데이터 ${m}개, 데이터베이스는 담겨요`, wPartC2: (n, s) => `감정 이미지·추가 에셋·VITS 파일·인레이 등 파일 ${n}개(약 ${s})는 빠져요`, wPartD1: '빠진 파일은 지금 기기에 그대로 있어요.', wPartD2: '다른 기기에서 복원하면 빠진 이미지는 없어요.', wPartGo: '일부만 백업하기',
  // 불러오기
  rfT: '백업 파일 고르기', rfHint: '.rtb나 .bin 파일을 골라요 (모의 파일 목록)', rfOk: '이 파일 열기', rfOkLine: (n, c, ch) => `${n} · 캐릭터 ${c}개, 채팅 ${ch}개가 들어 있어요`,
  fileBad_notBackup: '백업 파일이 아니에요. .rtb나 .bin 파일을 골라 주세요', fileBad_unreadable: '파일을 읽을 수 없어요. 아무것도 바뀌지 않았어요', fileBad_encrypted: '암호화된 백업은 불러올 수 없어요. 아무것도 바뀌지 않았어요', fileBad_notSettings: '설정 파일이 아니에요', fileBad_hasKeys: '연결 키가 들어 있어서 가져오지 않아요',
  wSalvH: '백업 파일의 일부가 손상됐어요', wSalvC1: (n) => `손상된 블록 ${n}개는 빼고 복원해요`, wSalvC2: (n) => `채팅 ${n}개는 복원되지 않아요`, wSalvC3: '나머지는 정상이에요', wSalvGo: '손상된 부분 빼고 계속',
  wRfH: '백업 파일로 지금 데이터를 바꿔요', wRfC1: (c, ch, c2, ch2) => `캐릭터 ${c}개, 채팅 ${ch}개가 파일 내용으로 바뀌어요 (지금 ${c2}개 / ${ch2}개)`, wRfC2: '파일에 없는 이미지는 지금 것을 그대로 둬요', wRfC2n: (n, s) => `파일에 없는 이미지 ${n}개(약 ${s})는 지금 것을 그대로 둬요`, wRfC3: '바꾸기 전에 지금 상태를 자동 스냅샷으로 남겨요',
  wRfD1: (n, d) => `파일: ${n} · ${d} 저장`, wRfD2: '이미지와 보관 데이터를 쓰기 시작한 뒤에는 멈출 수 없어요.', wRfD3rtb: '.rtb 파일이라 연결 키도 함께 복원돼요.', wRfD3bin: '.bin 파일에는 이 앱에서만 쓰는 데이터가 없을 수 있어요.', wRfGo: '교체하기',
  rfSub: (n, c, ch) => `${n} · 캐릭터 ${c}개 · 채팅 ${ch}개`, rfCounts: (c, ch) => `캐릭터 ${c}개, 채팅 ${ch}개를 불러왔어요`, rfSafetyKept: '바꾸기 전 상태는 자동 스냅샷에 남겼어요', rsSub: (d, s, c) => `${d} 스냅샷 · ${s} · 캐릭터 ${c}개`, rsSafetyKept: '방금 상태가 목록에 저장됐어요',
  wRsH: '자동 스냅샷으로 지금 데이터를 바꿔요', wRsC1: (d, s, c) => `스냅샷: ${d} · ${s} · 캐릭터 ${c}개`, wRsC2: (c, n) => `캐릭터 ${c}개가 스냅샷 내용으로 바뀌어요 (지금 ${n}개)`, wRsC3: '바꾸기 전에 지금 상태를 자동 스냅샷으로 남겨요', wRsD1: '데이터 교체하기 단계부터는 멈출 수 없어요.',
  restart: '다시 시작', rbH: '복원이 끝났어요. 다시 시작하면 바뀐 데이터가 보여요', rbS: '다시 시작하기 전까지는 이 화면에 이전 데이터가 보일 수 있어요', rbUnknownH: '저장이 끝났는지 확인하지 못했어요', rbUnknownS: '다시 시작해서 데이터가 맞는지 확인하세요',
  restartDone: '다시 시작했어요 (모의)', restartDoneSub: '바뀐 데이터가 보여요', lockStill: '아직 다른 탭이 열려 있어요',
  // 자동 스냅샷
  snT: '자동 스냅샷', snHint: '앱이 자동으로 남긴 시점이에요. 하나를 고르면 먼저 무엇이 바뀌는지 보여 드려요', snNone: '아직 자동 스냅샷이 없어요. 앱을 쓰는 동안 자동으로 남겨요 (5분에 한 번까지)', snChars: (n) => `캐릭터 ${n}개`, snSafety: '복원 전 상태', snPickOf: (f) => `${f}, 이 시점으로 불러오기`,
  snDesc: (n) => `앱이 자동으로 남긴 시점 ${n}개 중에서 골라요`, snDescNone: '아직 없어요', snTrail: (n) => `${n}개`,
  // 내보내기·가져오기
  dsSub: (n) => `채팅 ${n}개를 캐릭터별로 담아요`, dsCounts: (c, ch) => `캐릭터 ${c}개, 채팅 ${ch}개`,
  wSeH: '설정 파일에는 앱 설정과 프리셋 선택만 담겨요', wSeC: '연결 키와 채팅은 담기지 않아요', seDone: '설정 파일을 내보냈어요', seNoKeys: '연결 키와 채팅은 담기지 않았어요',
  siT: '설정 파일 고르기', siHint: '앱 설정과 프리셋 선택이 든 파일을 골라요 (모의 파일 목록)', siOk: '이 파일 열기', siMeta: (n) => `설정 ${n}개`, siOkLine: (n, c) => `${n} · 바뀌는 설정 ${c}개`,
  wSiH: (n) => `설정 ${n}개가 바뀌어요`, siLine: (l, a, b) => `${l}: ${a} → ${b}`, wSiD1: '연결 키와 채팅은 바뀌지 않아요.', wSiD2: '가져온 뒤 10초 안에 한 번에 되돌릴 수 있어요.', wSiGo: '가져오기',
  siSub: (n) => `바뀔 설정 ${n}개`, siCounts: (n, c) => `${n} · 설정 ${c}개`, siUndone: '가져온 설정을 되돌렸어요', siToast: (n) => `설정 ${n}개를 바꿨어요`,
  // 저장 공간
  archOff: '끄면 보관 메모가 지워져요', cleanName: '쓰지 않는 파일 정리', wClH: (n) => `쓰지 않는 파일 ${n}개를 지워요`, wClC1: (n, s) => `파일 ${n}개, ${s}를 지워요. 되돌릴 수 없어요`, wClC2: '어떤 캐릭터·모듈·페르소나·설정도 쓰지 않는 이미지와 오디오, 보관 데이터만 지워요',
  wClD1: '첫 파일을 지우기 전까지만 취소할 수 있어요.', wClGo: '지우기', clSub: (n, s) => `파일 ${n}개 · ${s}`, clCounts: (n, s) => `파일 ${n}개, ${s}를 지웠어요`,
  cleanDesc: (n, s) => `지울 수 있는 파일 ${n}개 · ${s}. 되돌릴 수 없어요`, cleanDescNone: '지울 것이 없어요', cleanNoneT: '지울 것이 없어요',
  verifyName: '이미지 캐시', vfSub: (n) => `이미지와 파일 ${n}개 확인`, vfCounts: (n, b) => `${n}개 확인 · 손상 ${b}개`,
  mmT: '손상된 항목', mmHint: (n) => `내용이 저장된 값과 다른 항목 ${n}개를 찾았어요`, mmName: '이름', mmSize: '크기', mmState: '상태', mmDiff: '내용이 달라요', mmGo: '캐시에서 지우기',
  wEvH: (n) => `손상된 항목 ${n}개를 캐시에서 지워요`, wEvC1: (n, s) => `항목 ${n}개, ${s}를 캐시에서 지워요`, wEvC2: '지운 항목은 캐시에서만 사라져요', wEvGo: '캐시에서 지우기', evDone: (n) => `손상된 항목 ${n}개를 캐시에서 지웠어요`, evDoneS: '다시 점검해서 확인할 수 있어요',
  noCacheDesktop: '데스크톱 앱에서는 이미지 캐시 점검과 시작할 때 손상 확인이 나오지 않아요', noCacheAndroid: 'Android 앱에서는 이미지 캐시 점검과 시작할 때 손상 확인이 나오지 않아요',
  busyT: '다른 작업이 아직 돌고 있어요', busyS: '끝난 뒤에 다시 눌러 주세요',
  // 고급
  clampRange: (a, b) => `값은 ${a}에서 ${b}까지예요`, clampMin: (a) => `값은 ${a} 이상이어야 해요`,
  advCalm: '뭘 하는지 모르면 바꾸지 마세요.', reqA: '요청 보내는 방식', reqB: '모델과 캐시', reqC: '아직 실험 중인 항목', noteReqLoc: '요청 지역은 웹 브라우저에서만 나와요', noteInfo: '채팅에 프롬프트 정보 보이기는 데스크톱 앱과 서버판에서만 나와요', noteKeep: '세션 유지는 Android에서는 나오지 않아요',
  emoMoved: '감정 프롬프트는 대화 기능 › 감정 이미지에 있어요', gateExp: '네 가지 · 아직 다듬는 중이에요', gateUnrec: '네 가지 · 권장하지 않거나 더 이상 쓰지 않을 수 있어요',
  banDesc: '체크한 문자 종류의 글자는 쓰지 않게 해요', banCount: (n) => (n ? `${n}개 종류를 막고 있어요` : '막고 있는 종류가 없어요'), cmDesc: '직접 추가한 모델은 모델·프리셋의 ‘연결’에서 더하고 고치고 지워요', cmGo: '연결 열기',
  logT: '요청 기록', logHint: '최근 요청이에요 (가상 기록)', logRetry: '재시도', stT: '사용 통계', stMonth: '달', stReq: '요청', stTok: '토큰', stNote: '2024년 7월 이후의 수치는 정확하지 않을 수 있어요',
  bgT: '문제 신고용 설정 내보내기', bgBody: '아래 항목을 뺀 설정을 파일로 만들고 클립보드에 복사해요', bgC1: '이름에 key, proxy, hypa가 들어간 설정은 모두 빼요', bgC2: '그 밖에 연결 키나 주소 같은 민감한 항목 약 35개도 빼요', bgC3: '채팅과 캐릭터 내용은 들어가지 않아요', bgGo: '내보내기', bgDone: '설정을 내보냈어요', bgDoneS: 'risuai-settings-report.json · 클립보드에도 복사했어요 (모의)',
  // 언어
  langPending: '설정을 닫았다가 다시 열면 바뀌어요', langReopen: '다시 열기', langDone: (n) => `${n}(으)로 바꿨어요`, langDemoOnly: (n) => `${n}을(를) 골랐어요. 이 목업은 한국어와 English만 보여 줘요`, tlDone: 'lang.json을 받았어요 (모의)', tlDoneS: '번역할 때 쓰는 파일이에요',
  // 데모 패널
  demo5c2: '슬라이스 5c-2', demoSet: '데이터 세트', demoNext: '다음 실행 결과', demoLock: '다른 탭이 열려 있음', demoState: '상태 (5c-2)', demoGo: '열기',
  set_demo: '기본', set_failing: '실패', 'set_other-tab': '다른 탭 열림', 'set_web-memory': '메모리로 만들기', 'set_desktop-app': '데스크톱 앱', set_android: 'Android', set_empty: '비어 있음', set_experimental: '실험 기능 켬',
  next_default: '세트에 맞게', next_ok: '정상', next_skips: '건너뜀 있음', next_over4g: '4 GiB 넘는 파일', next_fail: '실패 (데이터 그대로)', next_unknown: '실패 (상태 불명)',
});
Object.assign(K.en, {
  title: 'Settings slice 5c-2 · Data & backup, Advanced and Language mockup', cancel: 'Cancel', close: 'Close', later: 'Later', newTag: 'New', newTagTitle: 'A new feature the app did not have (proposal)',
  relMin: (m) => `${m} min ago`, relHour: (h) => `${h} h ago`, relDay: (d) => `${d} d ago`, archived: 'archived', damagedBlock: 'damaged',
  bkT: 'Make a backup', bkFmt: 'Format', bkRtb: '.rtb · recommended', bkRtbD: 'Everything in this app, including connection keys', bkBin: '.bin', bkBinD: 'Compatible with RisuAI', bkScope: 'What to include', bkFull: 'Everything', bkFullD: (s) => `Including character assets · about ${s} (estimate)`, bkPart: 'Part', bkPartD: (s) => `Without character assets · about ${s} (estimate)`, bkStart: 'Start',
  bkSub: (c, ch, s) => `${c} characters · ${ch} chats · about ${s} (estimate)`, bkCounts: (c, ch, p) => `${c} characters, ${ch} chats, ${p} presets`,
  wKeysH: 'Connection keys go into the file. Do not send it to anyone', wKeysC: (n) => `The keys of ${n} connections are saved in this file`,
  wMemH: 'On this device the file is built in memory first', wMemC1: 'It is saved all at once when it is finished', wMemC2: (s) => `A bigger file uses more memory (about ${s}, estimate)`,
  wBinH: 'The .bin leaves out data only this app uses', wBinD1: 'To keep everything, make an .rtb.', wBinD2: 'Connection keys are in the .bin too. Do not send the file to anyone.', wBinSecondary: 'Make an .rtb instead', wBinPrimary: 'Make the .bin anyway',
  lo_chatFields: (n) => `Per-chat jailbreak and memory text of ${n} chats is left out`, lo_members: (n) => `${n} deleted-member names are left out`, lo_failures: (n) => `${n} failure records and edit drafts are left out`, lo_reading: (n) => `${n} reading settings are left out`, lo_sort: (n) => `${n} chat sort records are left out`,
  wPartH: 'Back up part of your data', wPartC1: (n, m) => `${n} profile images, ${m} archived items and the database are included`, wPartC2: (n, s) => `${n} files (about ${s}) such as emotion images, extra assets, VITS files and inlays are left out`, wPartD1: 'The files left out stay on this device.', wPartD2: 'Restoring on another device will not have the missing images.', wPartGo: 'Back up part',
  rfT: 'Choose a backup file', rfHint: 'Pick an .rtb or .bin file (a made-up file list)', rfOk: 'Open this file', rfOkLine: (n, c, ch) => `${n} · holds ${c} characters and ${ch} chats`,
  fileBad_notBackup: 'This is not a backup file. Pick an .rtb or .bin file', fileBad_unreadable: 'The file could not be read. Nothing was changed', fileBad_encrypted: 'An encrypted backup cannot be restored. Nothing was changed', fileBad_notSettings: 'This is not a settings file', fileBad_hasKeys: 'It holds connection keys, so it is not imported',
  wSalvH: 'Part of the backup file is damaged', wSalvC1: (n) => `${n} damaged blocks are left out of the restore`, wSalvC2: (n) => `${n} chats will not be restored`, wSalvC3: 'The rest is fine', wSalvGo: 'Continue without the damaged part',
  wRfH: 'Replace current data with this backup', wRfC1: (c, ch, c2, ch2) => `${c} characters and ${ch} chats are replaced with the file’s (now ${c2} / ${ch2})`, wRfC2: 'Images that are not in the file stay as they are', wRfC2n: (n, s) => `${n} images (about ${s}) that are not in the file stay as they are`, wRfC3: 'Your current state is saved as an automatic snapshot first',
  wRfD1: (n, d) => `File: ${n} · saved ${d}`, wRfD2: 'Once images and archived data start being written, it cannot be stopped.', wRfD3rtb: 'This is an .rtb file, so connection keys are restored too.', wRfD3bin: 'A .bin file may not hold the data only this app uses.', wRfGo: 'Replace',
  rfSub: (n, c, ch) => `${n} · ${c} characters · ${ch} chats`, rfCounts: (c, ch) => `Restored ${c} characters and ${ch} chats`, rfSafetyKept: 'The state before the replace is kept as an automatic snapshot', rsSub: (d, s, c) => `${d} snapshot · ${s} · ${c} characters`, rsSafetyKept: 'The state just before is saved in the list',
  wRsH: 'Replace current data with this snapshot', wRsC1: (d, s, c) => `Snapshot: ${d} · ${s} · ${c} characters`, wRsC2: (c, n) => `${c} characters are replaced with the snapshot’s (now ${n})`, wRsC3: 'Your current state is saved as an automatic snapshot first', wRsD1: 'It cannot be stopped from the Replacing data step on.',
  restart: 'Restart', rbH: 'The restore is done. Restart to see the restored data', rbS: 'Until you restart, this screen may still show the old data', rbUnknownH: 'Could not confirm that the save finished', rbUnknownS: 'Restart, then check that your data looks right',
  restartDone: 'Restarted (simulated)', restartDoneSub: 'The restored data is shown', lockStill: 'Another tab is still open',
  snT: 'Automatic snapshots', snHint: 'Points the app saved by itself. Pick one to see what would change first', snNone: 'No automatic snapshots yet. The app saves them while you use it (at most once every 5 minutes)', snChars: (n) => `${n} characters`, snSafety: 'Before a restore', snPickOf: (f) => `${f}, restore this point`,
  snDesc: (n) => `Choose from ${n} points the app saved`, snDescNone: 'None yet', snTrail: (n) => `${n}`,
  dsSub: (n) => `${n} chats, grouped by character`, dsCounts: (c, ch) => `${c} characters, ${ch} chats`,
  wSeH: 'A settings file holds app settings and preset choices only', wSeC: 'Connection keys and chats are not included', seDone: 'Settings file exported', seNoKeys: 'Connection keys and chats are not included',
  siT: 'Choose a settings file', siHint: 'Pick a file with app settings and preset choices (a made-up file list)', siOk: 'Open this file', siMeta: (n) => `${n} settings`, siOkLine: (n, c) => `${n} · ${c} settings would change`,
  wSiH: (n) => `${n} settings change`, siLine: (l, a, b) => `${l}: ${a} → ${b}`, wSiD1: 'Connection keys and chats are not changed.', wSiD2: 'You can undo the whole import within 10 seconds.', wSiGo: 'Import',
  siSub: (n) => `${n} settings will change`, siCounts: (n, c) => `${n} · ${c} settings`, siUndone: 'The imported settings were put back', siToast: (n) => `Changed ${n} settings`,
  archOff: 'Turning this off clears the archive memo', cleanName: 'Clean unused files', wClH: (n) => `Delete ${n} unused files`, wClC1: (n, s) => `Deletes ${n} files, ${s}. This can’t be undone`, wClC2: 'Only images, audio and archived data that no character, module, persona or setting uses',
  wClD1: 'You can cancel only before the first file is deleted.', wClGo: 'Delete', clSub: (n, s) => `${n} files · ${s}`, clCounts: (n, s) => `Deleted ${n} files, ${s}`,
  cleanDesc: (n, s) => `${n} files you can delete · ${s}. This can’t be undone`, cleanDescNone: 'Nothing to delete', cleanNoneT: 'Nothing to delete',
  verifyName: 'the image cache', vfSub: (n) => `${n} images and files checked`, vfCounts: (n, b) => `${n} checked · ${b} corrupted`,
  mmT: 'Corrupted items', mmHint: (n) => `${n} items do not match what was stored`, mmName: 'Name', mmSize: 'Size', mmState: 'State', mmDiff: 'Contents differ', mmGo: 'Remove from the cache',
  wEvH: (n) => `Remove ${n} corrupted items from the cache`, wEvC1: (n, s) => `Removes ${n} items, ${s}, from the cache`, wEvC2: 'Removed items disappear from the cache only', wEvGo: 'Remove from the cache', evDone: (n) => `Removed ${n} corrupted items from the cache`, evDoneS: 'You can check again to confirm',
  noCacheDesktop: 'The desktop app does not show the image cache check or the startup corruption check', noCacheAndroid: 'The Android app does not show the image cache check or the startup corruption check',
  busyT: 'Another task is still running', busyS: 'Try again when it is done',
  clampRange: (a, b) => `The value is ${a} to ${b}`, clampMin: (a) => `The value has to be ${a} or more`,
  advCalm: "If you don't know what an option does, don't change it.", reqA: 'How requests are sent', reqB: 'Models and caches', reqC: 'Still experimental', noteReqLoc: 'The request region is only shown in a web browser', noteInfo: 'Prompt info in the chat is only shown in the desktop app and the server build', noteKeep: 'Keep session alive is not shown on Android',
  emoMoved: 'The emotion prompt is under Chat features › Emotion images', gateExp: 'Four items · still being refined', gateUnrec: 'Four items · not recommended, or perhaps no longer used',
  banDesc: 'Characters of the checked script types are not used', banCount: (n) => (n ? `${n} script types banned` : 'No script types banned'), cmDesc: 'Custom models are added, edited and deleted under “Connections” in Models and presets', cmGo: 'Open Connections',
  logT: 'Request logs', logHint: 'Recent requests (a made-up log)', logRetry: 'retry', stT: 'Usage statistics', stMonth: 'Month', stReq: 'Requests', stTok: 'Tokens', stNote: 'Figures after July 2024 may not be accurate',
  bgT: 'Export settings for a bug report', bgBody: 'Makes a file of your settings without the items below and copies it to the clipboard', bgC1: 'Every setting whose name contains key, proxy or hypa is left out', bgC2: 'About 35 other sensitive items, such as connection keys and addresses, are left out too', bgC3: 'Chats and character contents are not included', bgGo: 'Export', bgDone: 'Settings exported', bgDoneS: 'risuai-settings-report.json · also copied to the clipboard (simulated)',
  langPending: 'It changes when you close Settings and open them again', langReopen: 'Reopen', langDone: (n) => `Changed to ${n}`, langDemoOnly: (n) => `You chose ${n}. This mockup only shows Korean and English`, tlDone: 'Got lang.json (simulated)', tlDoneS: 'The file you translate',
  demo5c2: 'Slice 5c-2', demoSet: 'Data set', demoNext: 'Next run result', demoLock: 'Another tab is open', demoState: 'State (5c-2)', demoGo: 'Open',
  set_demo: 'Default', set_failing: 'Failing', 'set_other-tab': 'Other tab open', 'set_web-memory': 'Built in memory', 'set_desktop-app': 'Desktop app', set_android: 'Android', set_empty: 'Empty', set_experimental: 'Experimental on',
  next_default: 'As the set says', next_ok: 'Clean run', next_skips: 'With skips', next_over4g: 'An asset over 4 GiB', next_fail: 'Fails (data unchanged)', next_unknown: 'Fails (state unknown)',
});

/* the store is reset to a set by reset(); used at load and by every state, so a state run after another one starts clean */
window.SS5C2_DATA = { SET5D, SETS, SPEED, ST, K, PK, reset, makeST, FILES, SFILES, LOG_LINES, STAT_ROWS, BAN_SCRIPTS, LANGS_UI, LEFTOUT, PLAT, MB, GB, NOW };
})();
