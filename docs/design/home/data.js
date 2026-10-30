/* Home synthetic data and state (DD-157: store-backed). Everything here is invented. Nothing is stored, sent or read from the app.
   store = what the app would hold (characters by id, the library order, Recently deleted as ids with a day count, personas, threads, tasks).
   S     = view state (mode, search, folder, which layer is open) and the draft holder; drafts never live in the store.
   Components read names and counts through the selectors below at render time; nothing caches a copy of a name or count in the DOM text for later. */
(function () {
  'use strict';
  var HS = window.HomeStrings; var t = HS.t; var lang = HS.lang;
  var P = new URLSearchParams(location.search);
  var pick = function (v, list, fb) { return list.indexOf(v) >= 0 ? v : fb; };
  var Home = window.Home = { P: P, lang: lang, t: t, josa: HS.josa, MODES: ['rp', 'hybrid', 'utility'], CAP: 3 /* DD-204: up to 3 parallel runs per mode */, QUEUE_MAX: 5 /* DD-248: at most 5 waiting per mode */, DAYS_KEPT: 30 /* DD-214 / DS-034 */ };
  var loc = function (v) { return v && typeof v === 'object' ? (v[lang] !== undefined ? v[lang] : v.ko) : v; };
  Home.loc = loc;
  var N = function (ko, en) { return { ko: ko, en: en }; };

  // ---------- store ----------
  var chars = {
    sera: { id: 'sera', name: N('세라핀', 'Seraphina'), hue: 18, folder: 'fantasy', recent: 1, chats: 42, tts: true },
    kestrel: { id: 'kestrel', name: N('케스트럴', 'Kestrel'), hue: 205, folder: 'scifi', recent: 2, chats: 17 },
    ashfall: { id: 'ashfall', name: N('잿불 일행', 'Ashfall Crew'), hue: 340, folder: 'fantasy', recent: 3, chats: 9, group: true },
    hollis: { id: 'hollis', name: N('홀리스 교수', 'Professor Hollis'), hue: 140, folder: '', recent: 5, chats: 23 },
    nyx: { id: 'nyx', name: N('닉스', 'Nyx'), hue: 268, folder: 'scifi', recent: 4, chats: 31, tts: true },
    tamsin: { id: 'tamsin', name: N('탬신 리드', 'Tamsin Reed'), hue: 48, folder: 'drafts', recent: 7, chats: 2 },
    orrin: { id: 'orrin', name: N('지도 제작자 오린', 'Orrin the Cartographer'), hue: 95, folder: 'fantasy', recent: 6, chats: 6 },
    lumi: { id: 'lumi', name: N('루미', 'Lumi'), hue: 186, folder: '', recent: 8, chats: 12, tts: true },
    airisu: { id: 'airisu', name: N('Airisu', 'Airisu'), hue: 320, builtIn: true, tts: true, chats: 0 },
    't-quartermaster': { id: 't-quartermaster', name: N('비행선 병참 장교', 'Airship Quartermaster'), hue: 40, folder: '', chats: 3 },
    't-log': { id: 't-log', name: N('낡은 비행선 일지', 'Old Airship Log'), hue: 200, folder: '', chats: 1 },
    't-marlow': { id: 't-marlow', name: N('말로', 'Marlow'), hue: 300, folder: '', chats: 8 },
    't-dummy': { id: 't-dummy', name: N('테스트 더미', 'Test Dummy'), hue: 120, folder: '', chats: 0 }
  };
  var store = Home.store = {
    chars: chars,
    order: ['sera', 'kestrel', 'ashfall', 'hollis', 'nyx', 'tamsin', 'orrin', 'lumi'],
    trash: [{ id: 't-quartermaster', days: 2 }, { id: 't-log', days: 9, flaky: true }, { id: 't-marlow', days: 15 }, { id: 't-dummy', days: 27 }],   // days = days since it was deleted; kept DAYS_KEPT
    folders: [['fantasy', 'folder.fantasy'], ['scifi', 'folder.scifi'], ['drafts', 'folder.drafts']],
    personas: [{ id: 'juno', name: N('주노', 'Juno'), hue: 30, active: true }, { id: 'ines', name: N('이네스 선장', 'Captain Ines'), hue: 210 }],
    stories: [
      { id: 'sera', branch: N('등불 기록관 · 분기 3', 'The Lantern Archive · branch 3'), snippet: N('“등불이 하나씩 꺼졌는데도, 그녀는 눈을 떼지 않았어요.”', '“The lamps went out one by one, and she did not look away from you.”'), memory: 'HypaV3', min: 120 },
      { id: 'kestrel', branch: N('해질녘 항구', 'Harbor at dusk'), snippet: N('“입항료가 또 두 배가 됐어. 화물을 팔든지, 배를 팔든지.”', '“Dock fees doubled again. Either we sell the cargo or we sell the ship.”'), memory: 'SupaMemory', min: 1500 },
      { id: 'ashfall', branch: N('그룹 채팅 · 바른 공성전', 'Group chat · Siege of Varn'), snippet: N('“브람은 성문을 맡아. 일라는 나와 함께. 지도 가진 사람, 지금이야.”', '“Bram, hold the gate. Ila, with me. Whoever has the map, now is the time.”'), memory: '', min: 4320 }
    ],
    realm: [
      [N('태엽 정원사', 'Clockwork Gardener'), N('포근함 · 채팅 1.2k', 'Cosy · 1.2k chats'), 160], [N('정거장 의무관 오엘라란', 'Station Medic Oyelaran'), N('SF · 채팅 860', 'Sci-fi · 860 chats'), 190],
      [N('소금 마녀', 'The Salt Witch'), N('판타지 · 채팅 2.4k', 'Fantasy · 2.4k chats'), 300], [N('마로 탐정', 'Detective Marrow'), N('미스터리 · 채팅 540', 'Mystery · 540 chats'), 30],
      [N('옥상 배달원', 'Rooftop Courier'), N('일상 · 채팅 410', 'Slice of life · 410 chats'), 60], [N('기록관 펠', 'Archivist Pell'), N('판타지 · 채팅 330', 'Fantasy · 330 chats'), 120],
      [N('유리온실 쌍둥이', 'Glasshouse Twins'), N('코미디 · 채팅 290', 'Comedy · 290 chats'), 330], [N('미레유 선장', 'Captain Mireille'), N('모험 · 채팅 270', 'Adventure · 270 chats'), 210],
      [N('뱃사공', 'The Ferryman'), N('공포 · 채팅 240', 'Horror · 240 chats'), 250], [N('퀼', 'Quill'), N('글쓰기 도우미 · 채팅 200', 'Writing helper · 200 chats'), 45]
    ],
    threads: {
      hybrid: [
        { id: 'th-h1', title: N('파서 패치 검토', 'Review the parser patch'), by: 'sera', tag: 'coding', min: 12 },
        { id: 'th-h2', title: N('4장 설정 요약', 'Summarise chapter 4 lore'), by: 'hollis', tag: 'writing', min: 60 },
        { id: 'th-h3', title: N('가게 간판 번역', 'Translate the shop sign set'), by: 'sera', tag: 'translation', min: 1500 },
        { id: 'th-h4', title: N('비행선 이름 아이디어', 'Name ideas for the airship'), by: 'lumi', tag: 'brainstorm', min: 2900 }
      ],
      utility: [
        { id: 'th-u1', title: N('마이그레이션 노트 요약', 'Summarise the migration notes'), tag: 'research', min: 0 },
        { id: 'th-u2', title: N('릴리스 노트 초안', 'Draft release notes'), tag: 'writing', min: 60 },
        { id: 'th-u3', title: N('파서 리팩터링', 'Refactor parser'), tag: 'coding', min: 180 },
        { id: 'th-u4', title: N('토크나이저 토큰 수 비교', 'Compare tokenizer counts'), tag: 'research', min: 1500 },
        { id: 'th-u5', title: N('주사위 굴림 Lua 트리거', 'Lua trigger for dice rolls'), tag: 'coding', min: 2900 }
      ]
    },
    workspaces: [['release', 4], ['parser', 7], ['thesis', 12]],
    tasks: {}      // id -> task (tasks.js)
  };
  Home.tagLabel = function (k) { var m = { coding: ['코딩', 'Coding'], writing: ['글쓰기', 'Writing'], translation: ['번역', 'Translation'], brainstorm: ['아이디어', 'Brainstorm'], research: ['조사', 'Research'], task: ['작업', 'Task'] }[k] || [k, k]; return lang === 'en' ? m[1] : m[0]; };
  Home.ago = function (min) {
    var ko = lang === 'ko';
    if (min < 1) return ko ? '방금' : 'now';
    if (min < 60) return ko ? min + '분 전' : min + ' min';
    if (min < 1440) { var h = Math.round(min / 60); return ko ? h + '시간 전' : h + ' h ago'; }
    if (min < 2880) return ko ? '어제' : 'Yesterday';
    var d = Math.floor(min / 1440); return ko ? d + '일 전' : d + ' days ago';
  };
  // Hue sheet: a character's hue is data, not a theme value, and the product DOM carries no style="" attribute. One generated rule per hue in use: [data-hue="18"] { --h: 18 }.
  var hueSeen = {}; var hueSheet = null;
  Home.hue = function (h) {
    h = Math.round(h) % 360; if (h < 0) h += 360;
    if (!hueSeen[h]) {
      hueSeen[h] = 1;
      if (!hueSheet) { var st = document.createElement('style'); st.id = 'home-hues'; st.setAttribute('data-generated', ''); document.head.appendChild(st); hueSheet = st.sheet; }
      hueSheet.insertRule('[data-hue="' + h + '"] { --h: ' + h + '; }', hueSheet.cssRules.length);
    }
    return h;
  };
  var hangul = /[가-힣]/;
  Home.initials = function (name) {
    name = String(name).trim(); if (!name) return '?';
    if (hangul.test(name[0])) return name[0];
    return name.split(/\s+/).filter(function (w) { return w.toLowerCase() !== 'the'; }).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase();
  };
  Home.esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  Home.name = function (id) { var c = chars[id]; return c ? loc(c.name) : id; };
  Home.charById = function (id) { return chars[id] && !isTrashed(id) ? chars[id] : (id === 'airisu' ? chars.airisu : chars[store.order[0]] || chars.airisu); };
  function isTrashed(id) { return store.trash.some(function (x) { return x.id === id; }); }
  Home.isTrashed = isTrashed;
  Home.library = function () { return store.order.map(function (id) { return chars[id]; }); };
  Home.folderName = function (id) { var f = store.folders.filter(function (x) { return x[0] === id; })[0]; return f ? t(f[1]) : ''; };
  Home.activePersona = function () { return store.personas.filter(function (p) { return p.active; })[0] || store.personas[0]; };

  // ---------- view state and drafts ----------
  var S = Home.S = {
    only: pick(P.get('only'), ['rp', 'utility'], ''),
    mode: pick(P.get('mode'), Home.MODES, 'rp'),
    realm: pick(P.get('realm'), ['populated', 'pending', 'failed', 'empty', 'offline', 'consent', 'hidden'], 'populated'),
    nick: P.get('name') || '',
    lowPower: P.get('lowpower') === '1',
    hubOpen: false, search: '', sort: 'order', folder: '',
    companion: 'sera', framing: 'balanced', voice: true, tools: true, lore: false,
    utilCollapsed: false, utilTools: true, utilWeb: false,
    outcome: 'ok', provider: true, providerIssue: '',
    agreed: false,
    drafts: { hybrid: '', utility: '' },      // the draft holder: separate from the store, restored from the handoff on return (DD-210)
    lib: { manage: false, view: 'library', sel: [], lastRow: '', visible: [], trashSearch: '', failIds: [], msg: null },
    mockRuns: P.get('runs') === 'sample'
  };
  S.agreed = S.realm !== 'consent';
  if (S.only) S.mode = S.only;

  var FIXTURES = ['default', 'empty-library', 'no-matches', 'empty-trash', 'filtered-trash', 'bulk-partial-failure', 'long-library', 'no-companion', 'no-provider', 'missing-key', 'all-modes-hidden-repair'];
  Home.FIXTURES = FIXTURES;
  var fixture = Home.fixture = pick(P.get('fixture'), FIXTURES, 'default');
  if (fixture === 'empty-library') { store.order = []; store.stories = []; store.threads.hybrid = []; store.threads.utility = []; store.workspaces = []; store.trash = []; S.companion = ''; }
  if (fixture === 'no-provider' || fixture === 'missing-key') { S.provider = false; S.providerIssue = fixture === 'missing-key' ? 'key' : 'model'; store.threads.utility = []; }
  if (fixture === 'no-companion') S.companion = '';
  if (fixture === 'all-modes-hidden-repair') { S.only = S.only || S.mode; S.mode = S.only; }
  if (fixture === 'no-matches') S.search = 'zzzz';
  if (fixture === 'empty-trash') store.trash = [];
  if (fixture === 'filtered-trash') { S.lib.view = 'trash'; S.lib.trashSearch = lang === 'en' ? 'airship' : '비행선'; }
  if (fixture === 'bulk-partial-failure') { S.lib.manage = true; S.lib.sel = ['sera', 'nyx', 'orrin']; S.lib.failIds = ['nyx']; S.lib.lastRow = 'sera'; }
  if (fixture === 'long-library') for (var i = 1; i <= 52; i++) { var id = 'syn' + i; chars[id] = { id: id, name: N('기록 목소리 ' + String(i).padStart(2, '0'), 'Archive Voice ' + String(i).padStart(2, '0')), hue: (i * 37) % 360, folder: ['fantasy', 'scifi', 'drafts', ''][i % 4], recent: 20 + i, chats: i % 9 }; store.order.push(id); }
  if (P.get('lang') === 'en' && P.get('name') === null) S.nick = '';

  Home.personaName = function () { return S.nick || loc(Home.activePersona().name); };
  Home.plural = function (n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); };
})();
