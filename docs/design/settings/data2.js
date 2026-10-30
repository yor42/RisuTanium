/* Settings slice 2 (presets) fixtures. Synthetic; loaded after data.js and before slice2.js / slice1.js.
   Mutates window.SS1_DATA in place (rows, sections, presets) so slice 1 code keeps working on the same arrays, then publishes window.SS2_DATA.
   Sets (?set=): demo (60 presets, 8 folders, 6 favourites, slots 1-5, 5 recents), stress (300 presets, 25 folders), one (a single preset), fresh (12 presets, no folders, slots 1-9 migrated, notice). */
(() => {
'use strict';
const D = window.SS1_DATA;
const Q = new URLSearchParams(location.search);
const SET = ['demo', 'stress', 'one', 'fresh'].includes(Q.get('set')) ? Q.get('set') : 'demo';

/* ---------- rows: relabel, retire, add (slice 1 rows stay; ids stay so search and deep links keep working) ---------- */
const row = (id) => D.rows.find((r) => r.id === id);
const drop = (id) => { const i = D.rows.findIndex((r) => r.id === id); if (i >= 0) D.rows.splice(i, 1); };
Object.assign(row('models.keepAuxOnSwitch'), { ko: '기능별 모델 유지', en: 'Keep per-feature models', desc: '프리셋을 바꿔도 요약·번역 같은 기능별 모델은 그대로예요|Switching presets leaves the per-feature models (summary, translation…) as they are' });
Object.assign(row('models.keepFallbackOnSwitch'), { ko: '대체 모델 유지', en: 'Keep fallback models', desc: '프리셋을 바꿔도 대체 모델은 그대로예요|Switching presets leaves the fallback models as they are' });
Object.assign(row('models.keepParamsOnSwitch'), { ko: '기능별 파라미터 유지', en: 'Keep per-feature parameters', desc: '프리셋을 바꿔도 기능별 파라미터는 그대로예요|Switching presets leaves the per-feature parameters as they are' });
['models.showCompare', 'models.quickPresetNote', 'keys.quickPreset'].forEach(drop);
Object.assign(row('models.presetChain'), { type: 'button', icon: 'link', v: undefined, d: undefined, act: 'ps-chain', desc: '목록에서 프리셋을 골라 이어요|Pick presets from the list', help: '비어 있지 않으면 메시지를 보낼 때마다 이 목록의 프리셋이 무작위로 적용돼요. 프리셋 이름을 바꿔도 체인은 그대로예요.|When not empty, a preset from this list is applied at random on every send. Renaming a preset does not break the chain.' });
Object.assign(row('models.presetIcon'), { desc: '프리셋 카드의 아이콘을 눌러 바꿔요|Tap the icon on the preset card to change it' });
const ins = (r, afterId) => { const i = D.rows.findIndex((x) => x.id === afterId); D.rows.splice(i + 1, 0, Object.assign({ sec: 'models.presets', page: 'models' }, r)); };
ins({ type: 'button', id: 'models.presetsAll', ko: '모든 프리셋', en: 'All presets', icon: 'library-big', act: 'ps-library', syn: 'library list 목록 관리 manage presets 프리셋 목록 폴더 folder 즐겨찾기 favourites sort 정렬' }, 'models.presetChain');
ins({ type: 'button', id: 'models.compare', ko: '프리셋 비교', en: 'Compare presets', icon: 'git-compare', act: 'ps-compare', syn: 'compare diff 비교 showPromptComparison 프리셋 비교 보이기', desc: '두 프리셋의 다른 점을 나란히 봐요|See what differs between two presets' }, 'models.presetsAll');
D.PAGES.find((p) => p.id === 'models').later = ['슬라이스 3–4: 연결·모델·파라미터', 'slices 3-4: connections, models, parameters'];
D.SECTIONS.splice(D.SECTIONS.findIndex((s) => s.id === 'keys.main'), 0, { page: 'keys', id: 'keys.presets', ko: '프리셋 단축키', en: 'Preset shortcuts' });

/* ---------- presets ---------- */
const MODEL_IDS = ['claude-sonnet-45', 'gpt-5-mini', 'gemini-25-pro', 'llama-local-8b', 'claude-haiku-45', 'gpt-41', 'gemini-25-flash', 'claude-opus-41'];
const BASES = ['균형', '롤플레이', '번역', '요약', '시 쓰기', '추리', '판타지', 'SF 모험', '일상 대화', '코딩 도우미', '퀴즈 진행', '영어 연습'];
const STYLES = ['기본', '긴 답변', '짧게', '빠르게', '엄격하게'];
const DEMO_FOLDERS = [['f1', '기본'], ['f2', '롤플레이'], ['f3', '번역·언어'], ['f4', '요약·정리'], ['f5', '창작'], ['f6', '추리·퀴즈'], ['f7', '코딩·학습'], ['f8', '실험']];
const FOLDER_OF = { '균형': 'f1', '일상 대화': 'f1', '롤플레이': 'f2', '번역': 'f3', '영어 연습': 'f3', '요약': 'f4', '시 쓰기': 'f5', '판타지': 'f5', 'SF 모험': 'f5', '추리': 'f6', '퀴즈 진행': 'f6', '코딩 도우미': 'f7' };
const mk = (id, name, model, folder, i) => ({ id, name, model, folder, fav: false, lastUsed: i + 1, icon: 'bookmark', vals: {}, rps: [], undo: [], redo: [], rpTaken: false, rpT: 0 });
const temps = [0.8, 1.0, 0.3, 0.6, 0.9, 1.1, 0.5, 0.7];
let presets = [], folders = [], slots = {}, chain = [], notice = false, activeId = 'p1';

function build() {
  const src = D.presets.slice();
  if (SET === 'one') {
    presets = [mk('p1', '균형', 'claude-sonnet-45', null, 0)];
  } else if (SET === 'fresh') {
    presets = src.slice(0, 12).map((p, i) => mk(p.id, i === 0 ? '균형' : (i === 1 ? '롤플레이 긴 답변' : (i === 2 ? '번역용' : BASES[i % 12] + ' ' + STYLES[i % 5])), MODEL_IDS[i % 4], null, i));
  } else if (SET === 'stress') {
    const FN = ['롤플레이', '번역·언어', '요약·정리', '창작', '추리·퀴즈', '코딩·학습', '실험', '일상', '학교', '여행', '요리', '게임', '시험 대비', '글쓰기', '작사', '회의록', '메일', '상담', '철학', '역사', '과학', '음악', '영화', '운동', '기타'];
    folders = FN.map((n, i) => ({ id: 'f' + (i + 1), name: n }));
    for (let i = 0; i < 300; i++) {
      const f = i < 60 ? 'f1' : 'f' + (2 + ((i - 60) % 24));
      const nm = i === 0 ? '균형' : i === 1 ? '롤플레이 긴 답변' : i === 2 ? '번역용' : BASES[i % 12] + ' ' + STYLES[(i * 7) % 5] + ' ' + (i + 1);
      presets.push(mk('p' + (i + 1), nm, D.models[(i * 3) % 60].id, i >= 60 && i % 17 === 5 ? null : f, i));
    }
    presets[0].folder = 'f1'; presets.forEach((p, i) => { if (i % 15 === 4) p.fav = true; });
  } else {
    folders = DEMO_FOLDERS.map(([id, name]) => ({ id, name }));
    presets = src.slice(0, 60).map((p, i) => {
      const base = BASES.find((b) => p.name === b || p.name.startsWith(b + ' ')) || (p.name === '번역용' ? '번역' : p.name.startsWith('롤플레이') ? '롤플레이' : '');
      let f = FOLDER_OF[base] || 'f8'; if (i >= 56) f = 'f8'; if (i % 12 === 7) f = null;
      return mk(p.id, p.name, p.model, f, i);
    });
    ['p2', 'p4', 'p9', 'p15', 'p22', 'p30'].forEach((id) => { presets.find((p) => p.id === id).fav = true; });
  }
  presets.forEach((p, i) => { p.vals = {}; if (i > 0 && i % 2 === 1) p.vals['models.temperature'] = temps[i % temps.length]; if (i % 3 === 2) p.vals['models.maxResponse'] = 1000 + (i % 5) * 200; });
  // recency: the active preset is newest; five recents follow (demo): p3, p2, p7, p12, p5
  const rec = ['p3', 'p2', 'p7', 'p12', 'p5'];
  presets.forEach((p, i) => { p.lastUsed = 100 + i; });
  rec.forEach((id, k) => { const p = presets.find((x) => x.id === id); if (p) p.lastUsed = 900 - k; });
  presets[0].lastUsed = 1000; presets.find((p) => p.id === 'p2') && (presets.find((p) => p.id === 'p2').icon = 'message-square'); presets.find((p) => p.id === 'p3') && (presets.find((p) => p.id === 'p3').icon = 'languages');
  slots = {}; for (let n = 1; n <= 9; n++) slots[n] = null;
  if (SET === 'demo') { slots[1] = 'p1'; slots[2] = 'p2'; slots[3] = 'p3'; slots[4] = 'p7'; slots[5] = 'p12'; chain = ['p2', 'p3', 'p5']; }
  else if (SET === 'fresh') { for (let n = 1; n <= 9; n++) slots[n] = presets[n - 1].id; notice = true; }
  else if (SET === 'stress') { for (let n = 1; n <= 9; n++) slots[n] = presets[n - 1].id; }
  else slots[1] = 'p1';
  D.presets.length = 0; presets.forEach((p) => D.presets.push(p));
}
build();

const ids0 = new Set(D.presets.map((p) => p.id)); const loadouts = [{ id: 'l1', name: '여행용 세트', presets: ['p2', 'p3'] }, { id: 'l2', name: '작업용 세트', presets: ['p3', 'p5'] }].map((l) => ({ id: l.id, name: l.name, presets: l.presets.filter((x) => ids0.has(x)) })).filter((l) => l.presets.length);   // synthetic loadouts that point at presets by id (DS-030)
window.SS2_DATA = { SET, folders, slots, chain, loadouts, notice, activeId, ICON_CHOICES: ['bookmark', 'star', 'heart', 'moon', 'sun', 'book-open', 'code', 'zap', 'wand', 'pencil', 'message-square', 'languages'], MODEL_IDS, BASES, STYLES };
})();
