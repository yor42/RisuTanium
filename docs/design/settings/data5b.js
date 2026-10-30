/* Settings slice 5b (대화 기능: 장기 기억, 음성, 감정 이미지, 이미지 생성; 언어 › 번역; 모델 › 임베딩) catalogue, fixtures and copy. Synthetic; loaded after data.js .. data5a.js and before slice2.js / slice1.js.
   Mutates window.SS1_DATA in place (rows, sections, pages) and window.SS3_DATA (the service rows list, the connections of two fixtures) so slice 1 code keeps working on the same arrays, then publishes window.SS5B_DATA.
   DS-132: slice 1's invented 대화 기능 rows are removed HERE, in this slice's data layer only; the pages of slices 1 to 5a keep their own data.
   Nothing here is read from or written to the real app. Keys, addresses and files are invented (.invalid, fake-key-0000). Tests, fetches and downloads of the page are simulated.
   Sets (?set=): demo, legacy, failing, empty. Switches: ?gpu=0|1 (WebGPU), ?char=0|1 (a character is selected), ?web=0|1 (the web build, not the app), ?lang=ko|en (slice 1).
   Floor devices (Note 9 / Android 10 WebView, Raspberry Pi 3): no optional chaining, nullish coalescing, .at(), replaceAll, structuredClone. */
(() => {
'use strict';
const D = window.SS1_DATA, D3 = window.SS3_DATA;
const Q = new URLSearchParams(location.search);
const SETS = ['demo', 'legacy', 'failing', 'empty'];
const SET5B = SETS.indexOf(Q.get('set')) >= 0 ? Q.get('set') : 'demo';
const FL = { gpu: Q.has('gpu') ? Q.get('gpu') !== '0' : ('gpu' in navigator), char: Q.get('char') !== '0', web: Q.get('web') !== '0' };
const rows = D.rows; const ROWI = {}; rows.forEach((r) => { ROWI[r.id] = r; });

/* ---------------------------------------------------------------- pages and sections */
D.PAGES.find((p) => p.id === 'chatfeat').later = undefined;
D.PAGES.find((p) => p.id === 'chatfeat').syn += ' 장기 기억 음성 읽어주기 감정 이미지 이미지 생성 번역 서비스 memory voice emotion image generation translation embedding 임베딩';
D.SECTIONS.splice(D.SECTIONS.findIndex((s) => s.id === 'lang.app') + 1, 0, { page: 'lang', id: 'lang.translate', ko: '번역', en: 'Translation' });
D.PAGES.find((p) => p.id === 'lang').syn += ' translator translation 번역 번역기 번역 방식 deepl google';

/* ---------------------------------------------------------------- DS-132: the invented rows go, the real ones come */
for (let i = rows.length - 1; i >= 0; i--) { if (rows[i].page === 'chatfeat' || rows[i].id === 'lang.restartNote') rows.splice(i, 1); }
let cur = '';
const sec = (id) => { cur = id; };
function add(type, id, ko, en, o) { const r = Object.assign({ type, id, sec: cur, page: cur.split('.')[0], ko, en, p5b: true }, o || {}); rows.push(r); ROWI[id] = r; return r; }
const opts = (s) => s.split(';').map((p) => { const i = p.indexOf(':'); const v = p.slice(0, i); const l = p.slice(i + 1).split('|'); return [v, l[0], l[1] || l[0]]; });
const sw = (id, ko, en, d, o) => add('switch', id, ko, en, Object.assign({ v: d }, d === undefined ? {} : { d }, o));
const se = (id, ko, en, d, op, o) => add('select', id, ko, en, Object.assign({ v: d, opt: opts(op) }, d === undefined ? {} : { d }, o));
const sg = (id, ko, en, d, op, o) => add('segmented', id, ko, en, Object.assign({ v: d, opt: opts(op) }, d === undefined ? {} : { d }, o));
const nu = (id, ko, en, d, r, o) => add('number', id, ko, en, Object.assign({ v: d, min: r[0], max: r[1], step: r[2] || 1 }, d === undefined ? {} : { d }, o));
const tx = (id, ko, en, d, o) => add('text', id, ko, en, Object.assign({ v: d }, d === undefined ? {} : { d }, o));
const ta = (id, ko, en, d, o) => add('textarea', id, ko, en, Object.assign({ v: d }, d === undefined ? {} : { d }, o));
const sk = (id, ko, en, d, o) => add('secret', id, ko, en, Object.assign({ v: d }, o));
const dep = (id, ins) => ({ id, in: ins });

/* ---------------------------------------------------------------- stores */
const ENG = ['none', 'hypav3', 'hanurai', 'hypav2', 'supa'];
const ALGO = { none: 'none', hypav3: 'hypaMemoryV3', hanurai: 'hanuraiMemory', hypav2: 'hypaMemoryV2', supa: 'supaMemory' };
const MF_KEYS = ['hypaV3', 'hypav2', 'supaModelType', 'hanuraiEnable', 'memoryAlgorithmType'];
const mf = { hypaV3: false, hypav2: false, supaModelType: 'none', hanuraiEnable: false, memoryAlgorithmType: 'none' };
const engineOf = (m) => (m.hypaV3 ? 'hypav3' : m.hypav2 ? 'hypav2' : m.hanuraiEnable ? 'hanurai' : m.supaModelType !== 'none' ? 'supa' : 'none');   // OBSERVED today (OtherBotSettings.svelte:1015-1054): the select derives its value from four flags
function writeEngine(m, e) {   // the engine is one choice; the five derived fields are written together, as today
  m.hypaV3 = e === 'hypav3'; m.hypav2 = e === 'hypav2'; m.hanuraiEnable = e === 'hanurai';
  if (e === 'none') m.supaModelType = 'none'; else if ((e === 'supa' || e === 'hypav2') && m.supaModelType === 'none') m.supaModelType = 'distilbart';
  if (e === 'supa') { m.hypav2 = false; }
  m.memoryAlgorithmType = ALGO[e] || 'none';
}
const HV3_DEF = () => ({ summarizationModel: 'subModel', summarizationPrompt: '', reSummarizationPrompt: '', memoryTokensRatio: 0.2, extraSummarizationRatio: 0, maxChatsPerSummary: 6, queryChatCount: 3, summaryChunkSeparator: '\\n\\n', recentMemoryRatio: 0.4, similarMemoryRatio: 0.4, preserveOrphanedMemory: false, processRegexScript: false, doNotSummarizeUserMessage: false, useExperimentalImpl: false, alwaysToggleOn: false, summarizationRequestsPerMinute: 20, summarizationMaxConcurrent: 1, embeddingRequestsPerMinute: 100, embeddingMaxConcurrent: 1, enableSimilarityCorrection: false });
const mkHv = (id, name, over) => ({ id, name, settings: Object.assign(HV3_DEF(), over || {}) });
const ST = {
  mf,
  presets: [mkHv('hp1', '기본'), mkHv('hp2', '빠른 요약', { memoryTokensRatio: 0.15, maxChatsPerSummary: 10, queryChatCount: 2, recentMemoryRatio: 0.5, similarMemoryRatio: 0.3, summarizationPrompt: '핵심 사건만 세 문장 안에 요약해 주세요.' }), mkHv('hp3', '긴 이야기용', { memoryTokensRatio: 0.3, extraSummarizationRatio: 0.1, maxChatsPerSummary: 4, queryChatCount: 6, recentMemoryRatio: 0.3, similarMemoryRatio: 0.5, preserveOrphanedMemory: true, useExperimentalImpl: true })],
  presetActive: 'hp1', editId: '', seq: 1,
  trPresets: [{ id: 'tp1', name: '기본', prompt: '', maxResponse: 1000 }, { id: 'tp2', name: '존댓말 유지', prompt: 'Translate the text into {{slot}}. Keep honorifics and the speaker\'s politeness level.', maxResponse: 1000 }, { id: 'tp3', name: '웹소설체', prompt: 'Translate into {{slot}} in the style of a web novel: short lines, vivid verbs, keep the names.', maxResponse: 1500 }],
  trActive: 'tp1', trCache: 1284, trSeq: 1,
  voices: [{ id: 'ch1', engine: 'elevenlab', voice: 'Rachel', quote: true }, { id: 'ch2', engine: 'VOICEVOX', voice: 'ずんだもん · ノーマル', quote: false }, { id: 'ch3', engine: 'openai', voice: 'alloy', quote: true }, { id: 'ch4', engine: '', voice: '', quote: false }],
  ws: { model: '', loras: [], ref: 'none', models: [] },
  chars: [{ id: 'ch1', prompt: 'masterpiece, best quality, 1girl, silver hair, lantern, forest road', negative: 'lowres, bad anatomy, extra fingers, watermark', writer: '장면을 한 줄로 묘사하고, 인물의 표정과 조명을 먼저 적어요.' }],
  trEdit: '', activeChar: FL.char ? 'ch1' : '',
  emotions: ['happy', 'sad', 'angry', 'surprised', 'neutral', 'shy', 'smile', 'worried'],
  sim: { fail: {}, all: false, hf503: false, wsFetch: 'ok' },
  extWrites: 0,
};
const hvp = () => ST.presets.find((p) => p.id === (ST.editId || ST.presetActive)) || ST.presets[0];

/* ---------------------------------------------------------------- 장기 기억 */
sec('chatfeat.memory');
const eng = se('chatfeat.memEngine', '장기 기억 방식', 'Long-term memory type', undefined, 'none:끄기|Off;hypav3:HypaMemory V3|HypaMemory V3;hanurai:HanuraiMemory|HanuraiMemory;hypav2:HypaMemory V2|HypaMemory V2;supa:SupaMemory|SupaMemory', { syn: 'memoryAlgorithmType hypaV3 hypav2 hanuraiEnable supaModelType 장기기억 기억력 기억 hypa supa hanurai 하이파 수파 하누라이 메모리 other bots 다른 봇 memory engine 방식 엔진 long term memory' });
Object.defineProperty(eng, 'v', { enumerable: true, configurable: true, get() { return engineOf(mf); }, set(x) { writeEngine(mf, x); } });
const ME = (e) => dep('chatfeat.memEngine', e);
nu('chatfeat.hanuraiTokens', '청크 크기 (HanuraiMemory)', 'Chunk size (HanuraiMemory)', 1000, [100, null], { dep: ME(['hanurai']), syn: 'hanuraiTokens chunk size 청크', desc: '검색할 때 메시지를 묶는 크기예요. 100 이상|The size of the groups messages are cut into for search. At least 100' });
sw('chatfeat.hanuraiSplit', '문장 나누기', 'Split into sentences', false, { dep: ME(['hanurai']), syn: 'hanuraiSplit text splitting 문장 나누기 텍스트 분할' });
nu('chatfeat.hypaChunkSize', '청크 크기 (HypaMemory V2)', 'Chunk size (HypaMemory V2)', 3000, [100, null], { dep: ME(['hypav2']), syn: 'hypaChunkSize chunk size 청크', desc: '한 번에 요약하는 글의 크기예요. 100 이상|How much text is summarised at once. At least 100' });
nu('chatfeat.hypaAllocatedTokens', '할당 토큰 (HypaMemory V2)', 'Allocated tokens (HypaMemory V2)', 3000, [100, null], { dep: ME(['hypav2']), syn: 'hypaAllocatedTokens allocated tokens 할당 토큰', desc: '요약과 검색에 쓸 토큰 수예요. 100 이상|Tokens given to summaries and search. At least 100' });
se('chatfeat.supaModelType', '요약 모델', 'Summary model', 'distilbart', 'distilbart:이 기기의 작은 모델 (distilbart)|Small model on this device (distilbart);instruct35:OpenAI 모델 (instruct 3.5)|OpenAI model (instruct 3.5);subModel:기억 모델 (모델 페이지에서 정해요)|Memory model (set on the Models page)', { dep: ME(['supa', 'hypav2']), syn: 'supaModelType summary model 요약 모델 subModel instruct35 distilbart supaMemoryKey' });
Object.defineProperty(ROWI['chatfeat.supaModelType'], 'v', { enumerable: true, configurable: true, get() { return mf.supaModelType === 'none' ? 'distilbart' : mf.supaModelType; }, set(x) { mf.supaModelType = x; } });
nu('chatfeat.maxSupaChunkSize', '최대 청크 (SupaMemory)', 'Max chunk size (SupaMemory)', 1200, [100, null], { dep: ME(['supa']), syn: 'maxSupaChunkSize max chunk size 최대 청크', desc: '한 덩어리로 요약할 글의 최대 크기예요. 100 이상|The largest piece of text summarised as one block. At least 100' });
ta('chatfeat.supaMemoryPrompt', '요약 프롬프트', 'Summary prompt', '', { ph: true, dep: ME(['supa', 'hypav2']), syn: 'supaMemoryPrompt summary prompt 요약 프롬프트', desc: '비워 두면 기본 프롬프트를 써요|Blank uses the built-in prompt' });
sw('chatfeat.hypaMemory', '검색도 함께 쓰기', 'Also use vector search', false, { dep: ME(['supa']), syn: 'hypaMemory enable hypamemory 검색 벡터 vector' });
/* the HypaV3 preset fields: template rows whose value is the preset open in the editor (ST.editId) or the active one; ratios are shown in percent */
function hv(field, type, ko, en, d, o) {
  o = o || {}; const pct = !!o.pct;
  const base = Object.assign({ hv: field, dep: ME(['hypav3']) }, o); base.syn = field + ' hypaV3 ' + (o.syn || 'preset 프리셋');
  const r = add(type, 'chatfeat.hv3.' + field, ko, en, Object.assign({ v: d, d, pkey: 'editId', pact: 'presetActive' }, base));
  Object.defineProperty(r, 'v', { enumerable: true, configurable: true, get() { const v = hvp().settings[field]; return pct ? Math.round(v * 100) : v; }, set(x) { hvp().settings[field] = pct ? x / 100 : x; } });
  return r;
}
hv('summarizationModel', 'select', '요약 모델 (프리셋)', 'Summary model (preset)', 'subModel', { opt: opts('subModel:기억 모델 (모델 페이지에서 정해요)|Memory model (set on the Models page);qwen3-1.7b:이 기기 · Qwen3 1.7B (GPU)|On this device · Qwen3 1.7B (GPU);qwen3-4b:이 기기 · Qwen3 4B (GPU)|On this device · Qwen3 4B (GPU);qwen3-8b:이 기기 · Qwen3 8B (GPU)|On this device · Qwen3 8B (GPU)'), syn: '요약 모델 summarization model' });
hv('summarizationPrompt', 'textarea', '요약 프롬프트 (프리셋)', 'Summary prompt (preset)', '', { ph: true, desc: '비워 두면 기본 프롬프트를 써요|Blank uses the built-in prompt', syn: '요약 프롬프트' });
hv('reSummarizationPrompt', 'textarea', '다시 요약 프롬프트', 'Re-summary prompt', '', { ph: true, desc: '요약을 한 번 더 줄일 때 써요. 비워 두면 기본 프롬프트를 써요|Used when a summary is shortened again. Blank uses the built-in prompt', syn: '재요약 프롬프트 resummarization' });
hv('memoryTokensRatio', 'slider', '기억 비율', 'Memory ratio', 20, { pct: true, min: 0, max: 100, step: 1, unit: '%', desc: '프롬프트에서 기억이 차지할 몫이에요|The share of the prompt memory may take', syn: 'memory tokens ratio 기억 비율' });
hv('extraSummarizationRatio', 'slider', '추가 요약 비율', 'Extra summary ratio', 0, { pct: true, min: 0, max: 100, step: 1, unit: '%', desc: '기억 비율을 뺀 나머지 안에서만 정할 수 있어요|Can only be set within what is left after the memory ratio', syn: 'extra summarization ratio 추가 요약' });
hv('maxChatsPerSummary', 'number', '요약 하나에 묶는 채팅 수', 'Chats per summary', 6, { min: 1, max: null, step: 1, syn: 'max chats per summary 요약 하나 채팅 수' });
hv('queryChatCount', 'number', '검색에 쓰는 최근 채팅 수', 'Chats used as the search query', 3, { min: 1, max: 20, step: 1, syn: 'query chat count 검색 쿼리 채팅 수' });
hv('summaryChunkSeparator', 'text', '요약 구분자', 'Summary separator', '\\n\\n', { syn: 'summary chunk separator 요약 구분자 줄바꿈', desc: '요약을 이어 붙일 때 사이에 넣는 글자예요|What goes between joined summaries' });
hv('recentMemoryRatio', 'slider', '최근 몫', 'Recent share', 40, { pct: true, min: 0, max: 100, step: 1, unit: '%', syn: 'recent memory ratio 최근 몫 최근' });
hv('similarMemoryRatio', 'slider', '비슷한 몫', 'Similar share', 40, { pct: true, min: 0, max: 100, step: 1, unit: '%', syn: 'similar memory ratio 비슷한 몫 유사' });
hv('preserveOrphanedMemory', 'switch', '짝 잃은 요약 남기기', 'Keep orphaned summaries', false, { desc: '지운 메시지에 달려 있던 요약도 그대로 둬요|Keeps summaries whose messages were deleted', syn: 'preserve orphaned memory 고아 요약' });
hv('processRegexScript', 'switch', '정규식 스크립트 적용', 'Apply regex scripts', false, { desc: '요약하기 전에 정규식 스크립트를 먼저 돌려요|Runs regex scripts before summarising', syn: 'process regex script 정규식' });
hv('doNotSummarizeUserMessage', 'switch', '내 메시지는 요약하지 않기', 'Do not summarise my messages', false, { syn: 'do not summarize user message 사용자 메시지 요약 안 함' });
hv('useExperimentalImpl', 'switch', '실험적 구현 쓰기', 'Use the experimental implementation', false, { desc: '켜면 속도 제한 설정이 나와요|Shows the rate limit settings when on', syn: 'use experimental impl 실험 experimental' });
hv('alwaysToggleOn', 'switch', '캐릭터를 고르면 자동으로 켜기', 'Turn on automatically when a character is chosen', false, { desc: '캐릭터를 고를 때 채팅의 장기 기억을 자동으로 켜요|Turns the chat\'s long-term memory on when a character is chosen', syn: 'always toggle on 자동 켜기 auto activate' });
['summarizationRequestsPerMinute:요약 요청 (분당):Summary requests (per minute):20:1:x', 'summarizationMaxConcurrent:요약 동시 요청:Summary requests at once:1:1:10', 'embeddingRequestsPerMinute:임베딩 요청 (분당):Embedding requests (per minute):100:1:x', 'embeddingMaxConcurrent:임베딩 동시 요청:Embedding requests at once:1:1:10'].forEach((s) => {
  const p = s.split(':'); hv(p[0], 'number', p[1], p[2], Number(p[3]), { min: Number(p[4]), max: p[5] === 'x' ? null : Number(p[5]), step: 1, dep: dep('chatfeat.hv3.useExperimentalImpl', [true]), syn: 'rate limit 속도 제한' });
});
hv('enableSimilarityCorrection', 'switch', '비슷함 보정', 'Similarity correction', false, { dep: dep('chatfeat.hv3.useExperimentalImpl', [false]), syn: 'enable similarity correction 유사도 보정' });
ROWI['chatfeat.hv3.useExperimentalImpl'].dep = ME(['hypav3']);
Object.keys(ROWI).filter((k) => /^chatfeat\.hv3\.(summarizationRequestsPerMinute|summarizationMaxConcurrent|embeddingRequestsPerMinute|embeddingMaxConcurrent)$/.test(k)).forEach((k) => { ROWI[k].dep = { id: 'chatfeat.hv3.useExperimentalImpl', eq: true }; });
ROWI['chatfeat.hv3.enableSimilarityCorrection'].dep = { id: 'chatfeat.hv3.useExperimentalImpl', eq: false };

/* ---------------------------------------------------------------- 모델 › 임베딩 (DS-137): one shared row */
sec('models.models');
const EMB = [['MiniLM', 'MiniLM L6 v2', 'MiniLM L6 v2', 'cpu', 23], ['nomic', 'Nomic Embed Text v1.5', 'Nomic Embed Text v1.5', 'cpu', 137], ['bge-small', 'BGE Small English', 'BGE Small English', 'cpu', 34], ['bge-m3', 'BGE Medium 3', 'BGE Medium 3', 'cpu', 560], ['multiMiniLM', 'Multilingual MiniLM L12 v2', 'Multilingual MiniLM L12 v2', 'cpu', 118], ['bge-m3-ko', 'BGE Medium 3 Korean', 'BGE Medium 3 Korean', 'cpu', null],
  ['MiniLM-gpu', 'MiniLM L6 v2', 'MiniLM L6 v2', 'gpu', 23], ['nomic-gpu', 'Nomic Embed Text v1.5', 'Nomic Embed Text v1.5', 'gpu', 137], ['bge-small-gpu', 'BGE Small English', 'BGE Small English', 'gpu', 34], ['bge-m3-gpu', 'BGE Medium 3', 'BGE Medium 3', 'gpu', 560], ['multiMiniLM-gpu', 'Multilingual MiniLM L12 v2', 'Multilingual MiniLM L12 v2', 'gpu', 118], ['bge-m3-ko-gpu', 'BGE Medium 3 Korean', 'BGE Medium 3 Korean', 'gpu', null],
  ['openai-3-small', 'OpenAI text-embedding-3-small', 'OpenAI text-embedding-3-small', 'hosted', 0], ['openai-3-large', 'OpenAI text-embedding-3-large', 'OpenAI text-embedding-3-large', 'hosted', 0], ['ada', 'OpenAI Ada', 'OpenAI Ada', 'hosted', 0], ['voyageContext3', 'Voyage Context 3', 'Voyage Context 3', 'hosted', 0],
  ['custom', '직접 지정 (OpenAI 호환)', 'Custom (OpenAI compatible)', 'custom', 0]];
const emb = add('select', 'models.embedModel', '임베딩 모델', 'Embedding model', { v: 'MiniLM', d: 'MiniLM', opt: EMB.map((e) => [e[0], e[1], e[2]]), grp: Object.fromEntries(EMB.map((e) => [e[0], e[3]])), mb: Object.fromEntries(EMB.map((e) => [e[0], e[4]])), syn: 'hypaModel embedding model 임베딩 모델 벡터 vector minilm bge nomic voyage 임베딩 hypaCustomSettings', desc: '장기 기억, 감정 이미지, 추가 텍스트 등에서 같이 써요|Shared by long-term memory, emotion images, additional text and more' });
tx('models.embedCustomModel', '직접 지정 임베딩 모델 이름', 'Custom embedding model name', '', { dep: dep('models.embedModel', ['custom']), syn: 'hypaCustomSettings model custom embedding 모델 이름' });

/* ---------------------------------------------------------------- 음성 */
sec('chatfeat.voice');
sw('chatfeat.ttsAutoSpeech', '자동으로 읽기', 'Read aloud automatically', false, { syn: 'ttsAutoSpeech auto speech auto play tts 자동 재생 읽어 주기 낭독', desc: '목소리가 정해진 캐릭터의 답변이 끝나면 읽어요|Reads a reply aloud when it ends, for characters that have a voice' });

/* ---------------------------------------------------------------- 감정 이미지 */
sec('chatfeat.emotion');
se('chatfeat.emotionProcesser', '감정 고르는 방식', 'How the emotion is chosen', 'submodel', 'submodel:감정 모델이 골라요|The emotion model chooses;embedding:문장 비슷함으로 골라요|Chosen by how similar the text is', { syn: 'emotionProcesser emotion method 감정 이미지 emotion images 감정 판별 방식 embedding submodel' });
ta('chatfeat.emotionPrompt2', '감정 프롬프트', 'Emotion prompt', '', { ph: true, dep: dep('chatfeat.emotionProcesser', ['submodel']), syn: 'emotionPrompt2 emotionPrompt emotion prompt adv.emoPrompt 감정 프롬프트 고급', desc: '비워 두면 기본 프롬프트(영어)를 써요|Blank uses the built-in prompt (in English)' });

/* ---------------------------------------------------------------- 이미지 생성 */
sec('chatfeat.imagegen');
const IMG_PROV = [['webui', 'Stable Diffusion WebUI', 'Stable Diffusion WebUI', 'url', 'webuiUrl'], ['novelai', 'NovelAI', 'NovelAI', 'urlkey', 'novelai'], ['dalle', 'DALL·E', 'DALL·E', 'key', 'openai'], ['stability', 'Stability AI', 'Stability AI', 'key', 'stabilityKey'], ['fal', 'Fal', 'Fal', 'key', 'falKey'], ['comfyui', 'ComfyUI', 'ComfyUI', 'url', 'comfyUrl'], ['Imagen', 'Google Imagen', 'Google Imagen', 'key', 'google'], ['openai-compat', 'OpenAI 호환', 'OpenAI compatible', 'urlkey', 'compat'], ['wavespeed', 'WaveSpeed', 'WaveSpeed', 'key', 'waveKey']];
const sdp = se('chatfeat.sdProvider', '이미지 생성 서비스', 'Image generation service', '', ':끄기|Off;' + IMG_PROV.map((p) => p[0] + ':' + p[1] + '|' + p[2]).join(';') + ';comfy:ComfyUI (이전 방식)|ComfyUI (older)', { syn: 'sdProvider image generation provider stable diffusion sd 이미지 생성 그림 그리기 이미지 서비스 other bots 다른 봇' });
const SP = (p) => dep('chatfeat.sdProvider', p);
nu('chatfeat.sdSteps', '단계 수', 'Steps', 30, [0, 100], { v: 30, dep: SP(['webui']), syn: 'sdSteps steps sampling steps 스텝 단계' });
nu('chatfeat.sdCFG', 'CFG', 'CFG scale', 7, [0, 20, 0.5], { v: 7, dep: SP(['webui']), syn: 'sdCFG cfg scale guidance 프롬프트 반영도' });
nu('chatfeat.sdWidth', '너비', 'Width', 512, [0, 2048], { v: 512, dep: SP(['webui', 'fal']), syn: 'width sdConfig size 가로', desc: 'Fal과 같은 크기를 써요 (최대 2048)|Shared with Fal (up to 2048)' });
nu('chatfeat.sdHeight', '높이', 'Height', 512, [0, 2048], { v: 512, dep: SP(['webui', 'fal']), syn: 'height sdConfig size 세로', desc: 'Fal과 같은 크기를 써요 (최대 2048)|Shared with Fal (up to 2048)' });
const SAMPLERS = ['Euler a', 'Euler', 'DPM++ 2M Karras', 'DPM++ SDE Karras', 'DPM++ 2M SDE', 'DDIM', 'UniPC', 'LMS'];
se('chatfeat.sdSampler', '샘플러', 'Sampler', 'Euler a', SAMPLERS.map((s) => s + ':' + s).join(';'), { v: 'Euler a', dep: SP(['webui']), syn: 'sampler_name sampler sdConfig 샘플러 오일러' });
sw('chatfeat.sdHr', '고해상도 보정', 'Hires fix', false, { v: false, dep: SP(['webui']), syn: 'enable_hr hires hr 고해상도' });
nu('chatfeat.sdDenoise', '노이즈 제거 강도', 'Denoising strength', 0.7, [0, 10, 0.05], { v: 0.7, dep: SP(['webui']), syn: 'denoising_strength denoising 노이즈 제거' });
nu('chatfeat.sdHrScale', '배율', 'Scale', 1.25, [0, 10, 0.05], { v: 1.25, dep: SP(['webui']), syn: 'hr_scale scale 배율' });
tx('chatfeat.sdHrUpscaler', '업스케일러', 'Upscaler', 'Latent', { v: 'Latent', dep: SP(['webui']), syn: 'hr_upscaler upscaler 업스케일러' });
tx('chatfeat.oaiImgModel', '모델', 'Model', '', { v: '', dep: SP(['openai-compat']), syn: 'openaiCompatImage model image model 모델' });
se('chatfeat.oaiImgSize', '크기', 'Size', '1024x1024', '1024x1024:1024 × 1024|1024 × 1024;1536x1024:1536 × 1024 (가로)|1536 × 1024 (wide);1024x1536:1024 × 1536 (세로)|1024 × 1536 (tall);1792x1024:1792 × 1024|1792 × 1024;1024x1792:1024 × 1792|1024 × 1792', { v: '1024x1024', dep: SP(['openai-compat']), syn: 'openaiCompatImage size 크기' });
sg('chatfeat.oaiImgQuality', '품질', 'Quality', 'auto', 'auto:자동|Auto;low:낮음|Low;medium:보통|Medium;high:높음|High', { v: 'auto', dep: SP(['openai-compat']), syn: 'openaiCompatImage quality 품질' });
sg('chatfeat.wsRef', '참고 이미지', 'Reference', 'none', 'none:없음|None;image:이미지|Image;character:캐릭터|Character', { v: 'none', dep: SP(['wavespeed']), syn: 'wavespeedImage reference 참고 이미지 reference image' });
Object.defineProperty(ROWI['chatfeat.wsRef'], 'v', { enumerable: true, configurable: true, get() { return ST.ws.ref; }, set(x) { ST.ws.ref = x; } });

/* ---------------------------------------------------------------- 번역 (on the 언어 page) */
sec('lang.translate');
const LANGS = [['ko', '한국어', 'Korean'], ['ru', '러시아어', 'Russian'], ['zh', '중국어 (간체)', 'Chinese (Simplified)'], ['zh-TW', '중국어 (번체)', 'Chinese (Traditional)', true], ['fa', '페르시아어', 'Persian', true], ['ja', '일본어', 'Japanese'], ['fr', '프랑스어', 'French'], ['es', '스페인어', 'Spanish'], ['pt', '포르투갈어', 'Portuguese'], ['de', '독일어', 'German'], ['id', '인도네시아어', 'Indonesian'], ['ms', '말레이어', 'Malay'], ['uk', '우크라이나어', 'Ukrainian']];
const TTYPES = ['google', 'deepl', 'deeplx', 'llm', 'bergamot'];
se('lang.translator', '번역할 언어', 'Translate into', '', ':끄기|Off;' + LANGS.map((l) => l[0] + ':' + l[1] + '|' + l[2]).join(';'), { syn: 'translator language 번역 언어 번역기 translation target' });
se('lang.translatorType', '번역 방식', 'Translation method', 'google', 'google:Google|Google;deepl:DeepL|DeepL;deeplx:DeepLX|DeepLX;llm:AI 모델|AI model;bergamot:기기에서 번역 (Firefox 엔진)|On this device (Firefox engine)', { dep: dep('lang.translator', LANGS.map((l) => l[0])), syn: 'translatorType translator type 번역 방식 google deepl deeplx llm bergamot firefox ax model ax. model' });
const TLANG = LANGS.map((l) => l[0]);
const TD = (ins) => ({ id: 'lang.translatorType', in: ins });
se('lang.translatorInputLanguage', '원문 언어', 'Source language', 'auto', 'auto:자동 감지|Detect automatically;en:영어|English;zh:중국어|Chinese;ja:일본어|Japanese;ko:한국어|Korean;fr:프랑스어|French;es:스페인어|Spanish;de:독일어|German;ru:러시아어|Russian', { dep: TD(['google']), syn: 'translatorInputLanguage source language input language 원문 언어 소스', desc: 'Google에서만 고를 수 있어요|Only Google lets you choose this' });
const trp = () => ST.trPresets.find((p) => p.id === (ST.trEdit || ST.trActive)) || ST.trPresets[0];
const trPrompt = ta('lang.trPrompt', '번역 프롬프트', 'Translation prompt', '', { ph: true, dep: TD(['llm']), trp: true, pkey: 'trEdit', pact: 'trActive', syn: 'translatorPrompt translator prompt 번역 프롬프트 slot', desc: '비워 두면 기본 프롬프트를 써요. {{slot}}은 번역할 언어로 바뀌어요|Blank uses the built-in prompt. {{slot}} becomes the target language' });
Object.defineProperty(trPrompt, 'v', { enumerable: true, configurable: true, get() { return trp().prompt; }, set(x) { trp().prompt = x; } });
const trMax = nu('lang.trMaxResponse', '최대 응답 길이', 'Max response length', 1000, [0, 2048], { dep: TD(['llm']), trp: true, pkey: 'trEdit', pact: 'trActive', syn: 'translatorMaxResponse max response 최대 응답', desc: '번역 하나에 쓸 수 있는 토큰이에요. 0에서 2048|Tokens one translation may use. 0 to 2048' });
Object.defineProperty(trMax, 'v', { enumerable: true, configurable: true, get() { return trp().maxResponse; }, set(x) { trp().maxResponse = x; } });
sw('lang.autoTranslate', '자동 번역', 'Translate automatically', false, { dep: dep('lang.translator', TLANG), syn: 'autoTranslate auto translation 자동 번역', desc: '새 메시지가 오면 바로 번역해요|Translates new messages as they arrive' });
sw('lang.combineTranslation', '번역 합치기', 'Combine translations', false, { dep: dep('lang.translator', TLANG), syn: 'combineTranslation combine translation 합쳐서 번역', desc: '원문과 번역을 한 메시지에 같이 보여 줘요|Shows the original and the translation together in one message' });
sw('lang.legacyTranslation', '이전 번역 방식', 'Older translation method', false, { dep: dep('lang.translator', TLANG), syn: 'legacyTranslation legacy translation 레거시 번역', desc: '예전 방식으로 문단을 나눠 번역해요|Translates paragraph by paragraph the old way' });
sw('lang.htmlTranslation', 'HTML 번역', 'HTML translation', false, { dep: TD(['bergamot']), syn: 'htmlTranslation html translate bergamot HTML 번역', desc: '기기에서 번역할 때 HTML 서식을 그대로 둬요|Keeps HTML formatting when translating on this device' });
sw('lang.translateBeforeHTMLFormatting', 'HTML 서식 전에 번역', 'Translate before HTML formatting', false, { dep: TD(['llm']), syn: 'translateBeforeHTMLFormatting translate before html formatting 서식 전에 번역' });
sw('lang.autoTranslateCachedOnly', '저장된 번역만 자동으로', 'Auto-translate saved translations only', false, { dep: TD(['llm']), syn: 'autoTranslateCachedOnly cached only 캐시된 번역만', desc: '이미 번역한 메시지만 자동으로 보여 줘요|Only shows translations that already exist' });

/* the link card of 대화 기능 to the translator (DS-133) */
sec('chatfeat.translate');
add('nav', 'chatfeat.trLink', '번역은 언어 페이지에서 설정해요', 'Translation is set on the Language page', { target: 'lang.translator', syn: 'translator translation 번역 번역기 translate 언어 페이지', desc: '번역할 언어와 방식, AI 번역 프리셋, 번역 캐시|The language, the method, AI translation presets and the cache' });

/* ---------------------------------------------------------------- the service rows of 연결 (DS-011, DS-013): values per fixture, new rows for the services this slice needs */
const SVC = (id) => ROWI[id];
const fish = ROWI['models.fishUrl'];   // DS-132: Fish Audio has a key and a fixed host, not an address
if (fish) { fish.id = 'models.fishKey'; fish.type = 'secret'; fish.ko = 'Fish Audio 키'; fish.en = 'Fish Audio key'; fish.syn = 'fishSpeechKey fish speech audio 피시 오디오 키'; fish.v = ''; fish.d = ''; delete ROWI['models.fishUrl']; ROWI['models.fishKey'] = fish; }
sec('models.connections');
sk('models.hfKey', 'Hugging Face 키', 'Hugging Face key', '', { syn: 'huggingfaceKey huggingface 허깅페이스 키 tts' });
sk('models.stabilityKey', 'Stability AI 키', 'Stability AI key', '', { syn: 'stabilityKey stability ai 스테빌리티 키' });
sk('models.falKey', 'Fal 키', 'Fal key', '', { syn: 'falToken fal 키' });
sk('models.voyageKey', 'Voyage 키', 'Voyage key', '', { syn: 'voyageApiKey voyage 임베딩 키' });
const svcRows = D3.SERVICE_ROWS; svcRows[svcRows.indexOf('models.fishUrl')] = 'models.fishKey'; svcRows.push('models.hfKey', 'models.stabilityKey', 'models.falKey', 'models.voyageKey');
ROWI['models.webuiUrl'].syn += ' webUiUrl'; ROWI['models.comfyUrl'].syn += ' comfyUiUrl'; ROWI['models.voicevoxUrl'].syn += ' voicevoxUrl'; ROWI['models.elevenKey'].syn += ' elevenLabKey'; ROWI['models.waveKey'].syn += ' wavespeedImage'; ROWI['models.deeplKey'].syn += ' deeplOptions'; ROWI['models.deeplxUrl'].syn += ' deeplXOptions'; ROWI['models.deeplFree'].syn += ' freeApi';
const FIX = {
  demo: { 'models.elevenKey': '${ELEVEN_KEY}', 'models.voicevoxUrl': 'http://voicevox.invalid:50021', 'models.fishKey': '', 'models.hfKey': 'fake-key-0000-hf', 'models.webuiUrl': 'http://webui.invalid:7860', 'models.comfyUrl': 'http://comfy.invalid:8188', 'models.waveKey': 'fake-key-0000-wave', 'models.deeplKey': '', 'models.deeplxUrl': 'http://deeplx.invalid:1188', 'models.deeplxToken': '', 'models.stabilityKey': '', 'models.falKey': '', 'models.voyageKey': '' },
  empty: { 'models.elevenKey': '', 'models.voicevoxUrl': '', 'models.fishKey': '', 'models.hfKey': '', 'models.webuiUrl': '', 'models.comfyUrl': '', 'models.waveKey': '', 'models.deeplKey': '', 'models.deeplxUrl': '', 'models.deeplxToken': '', 'models.stabilityKey': '', 'models.falKey': '', 'models.voyageKey': '' },
};
FIX.legacy = Object.assign({}, FIX.demo, { 'models.comfyUrl': 'http://comfy.invalid:8188' }); FIX.failing = Object.assign({}, FIX.demo);
Object.keys(FIX[SET5B]).forEach((k) => { if (ROWI[k]) ROWI[k].v = FIX[SET5B][k]; });

/* ---------------------------------------------------------------- fixtures per set */
const set = (id, v) => { if (ROWI[id]) ROWI[id].v = v; };
set('chatfeat.ttsAutoSpeech', SET5B !== 'empty'); ROWI['chatfeat.ttsAutoSpeech'].v = SET5B !== 'empty';
if (SET5B === 'demo' || SET5B === 'failing') {
  writeEngine(mf, 'hypav3'); set('models.embedModel', 'multiMiniLM'); set('chatfeat.emotionProcesser', 'submodel'); set('chatfeat.sdProvider', 'webui'); set('lang.translator', 'ko'); set('lang.translatorType', 'llm');
}
if (SET5B === 'legacy') {
  writeEngine(mf, 'supa'); mf.supaModelType = 'instruct35'; set('models.embedModel', 'MiniLM'); set('chatfeat.sdProvider', 'comfy'); set('lang.translator', 'ko'); set('lang.translatorType', 'bergamot'); ST.trCache = 0;
}
if (SET5B === 'empty') { writeEngine(mf, 'none'); set('models.embedModel', 'MiniLM'); set('chatfeat.sdProvider', ''); set('lang.translator', ''); ST.trCache = 0; ST.voices.forEach((v) => { v.engine = ''; v.voice = ''; }); }
if (SET5B === 'failing') { ST.sim.all = true; ST.sim.wsFetch = 'fail'; ROWI['models.voicevoxUrl'].v = 'http://voicevox.invalid:50021'; }
ST.ws.model = (SET5B === 'demo' || SET5B === 'legacy') ? 'wavespeed-ai/flux-dev' : '';
ST.extWrites = 0;
/* connections: legacy has no OpenAI connection (Supa's instruct35 needs one), empty has none at all */
const gone = SET5B === 'empty' ? D3.CX.map((c) => c.id) : SET5B === 'legacy' ? D3.CX.filter((c) => c.provider === 'openai').map((c) => c.id) : [];
if (gone.length) {
  for (let i = D3.CX.length - 1; i >= 0; i--) { if (gone.indexOf(D3.CX[i].id) >= 0) D3.CX.splice(i, 1); }
  D.connections.length = 0; D3.CX.forEach((c) => D.connections.push({ id: c.id, name: c.name, en: c.name, row: 'models.cx.' + c.id, kw: c.kw }));
  const take0 = D3.takeKeys; D3.takeKeys = function () { const k = take0(); gone.forEach((id) => { delete k[id]; }); return k; };
}

/* ---------------------------------------------------------------- WaveSpeed models (a synthetic fetched list) */
const WS_MODELS = [
  { id: 'wavespeed-ai/flux-dev', name: 'Flux Dev', price: 0.004, lora: true, ref: false },
  { id: 'wavespeed-ai/flux-schnell', name: 'Flux Schnell', price: 0.003, lora: false, ref: false },
  { id: 'wavespeed-ai/flux-dev-ultra-fast', name: 'Flux Dev Ultra Fast', price: 0.005, lora: true, ref: false },
  { id: 'wavespeed-ai/hidream-i1-full', name: 'HiDream I1 Full', price: 0.012, lora: false, ref: false },
  { id: 'wavespeed-ai/flux-kontext-dev', name: 'Flux Kontext Dev', price: 0.025, lora: true, ref: true },
  { id: 'bytedance/seedream-v3', name: 'Seedream V3', price: 0.03, lora: false, ref: true },
  { id: 'google/imagen4', name: 'Imagen 4', price: null, lora: false, ref: false },
];
if (SET5B === 'demo' || SET5B === 'legacy') ST.ws.models = WS_MODELS.map((m) => Object.assign({}, m));   // the list a good fetch found earlier
const ENGINES = [['elevenlab', 'ElevenLabs'], ['VOICEVOX', 'VOICEVOX'], ['openai', 'OpenAI'], ['novelai', 'NovelAI'], ['huggingface', 'Hugging Face'], ['fishspeech', 'Fish Audio'], ['webspeech', '브라우저 음성|Browser voice'], ['vits', 'VITS'], ['gptsovits', 'GPT-SoVITS']];
const FILES = {   // synthetic files of the pick dialogs (nothing is read from the device)
  hypa: [{ id: 'f1', file: 'hypaV3_export_가벼운 요약.json', name: '가벼운 요약', ok: true, kind: 'risu' }, { id: 'f2', file: 'persona-미라.png', ok: false, kind: 'foreign' }, { id: 'f3', file: 'broken.json', ok: false, kind: 'broken' }],
  tr: [{ id: 't1', file: '존댓말-예의.risutl', name: '예의 바른 말투', prompt: 'Translate into {{slot}} with a very polite tone.', maxResponse: 800, ok: true, kind: 'risutl' }, { id: 't2', file: 'notes.txt', ok: false, kind: 'foreign' }],
  cache: [{ id: 'k1', file: 'translation-cache-2026-10.json', count: 312, ok: true }, { id: 'k2', file: 'old-cache.json', count: 0, ok: false }],
};
const SIMFAIL = SET5B === 'failing';

/* ---------------------------------------------------------------- copy (Korean first; SLICE5B_SPEC section 9 is generated from this object by checks/tools/gen-copy5b.mjs and read back by the ss5b koen section).
   DS-038: no Korean particle directly after a user-chosen name (preset, character, connection, query): such a name stands after a colon or a middle dot, or inside quotes before a verb. Product and engine names are fixed copy. "첫 메시지", never "greeting". */
const K = {
  ko: {
    title: '설정 슬라이스 5b · 대화 기능, 번역, 임베딩 목업', undo: '되돌리기', cancel: '취소', close: '닫기',
    /* connections and services */
    connChip: (n) => `연결: ${n}`, connNeed: '연결 필요', connAdd: '연결 추가', connAddOf: (n) => `연결 추가: ${n}`, connAria: (n) => `연결: ${n} · 열기`, connOpen: '연결 페이지에서 열기',
    needKey: '키', needAddr: '주소', needAddrKey: '주소 + 키', needAddrToken: '주소와 토큰', needNone: '없음', needFile: '캐릭터에서 파일 선택',
    svcAddTitle: (n) => `연결 추가: ${n}`, svcAddKeyHint: '키는 이 기기에만 저장돼요', svcAddAddrHint: '주소는 http:// 또는 https://로 시작해요', svcAddr: '주소', svcKey: '키', svcSave: '저장', svcAddrBad: '주소는 http:// 또는 https://로 시작해야 해요', svcKeyBad: '키를 입력하세요', svcAdded: (n) => `연결을 추가했어요: ${n}`, luSvc: (n) => `연결 추가: ${n}`,
    /* tests (DS-140) */
    test: '테스트', testOf: (n) => `테스트: ${n}`, testCancel: '취소', testCancelOf: (n) => `테스트 취소: ${n}`, testRunning: '테스트하는 중이에요…', testRunVoice: '“안녕하세요, 목소리 테스트예요”를 읽는 중이에요…', testRunImage: '작은 테스트 이미지를 만드는 중이에요…', testRunTr: '샘플 문장을 번역하는 중이에요…', testCancelled: '테스트를 취소했어요',
    testOkShort: '테스트에 성공했어요', testOkVoice: '읽었어요 · “안녕하세요, 목소리 테스트예요”', testOkImage: (s, c) => `${s}초 걸렸어요 · 예상 비용 ${c}`, testOkImageNoCost: (s) => `${s}초 걸렸어요`, testOkTr: (o) => `“Hello, nice to meet you.” → ${o}`, costFree: '무료',
    phDefault: '비워 두면 기본 프롬프트를 써요', testOffline: '번역 서버에 닿지 못했어요 · 인터넷 연결을 확인하세요', testNoTrModel: '번역에 쓸 모델이 없어요 · 모델 페이지에서 정해요', testDlFail: '번역 모델을 내려받지 못했어요 · 인터넷 연결을 확인하세요', testPaid: '요금이 나갈 수 있어요',
    testVoiceUses: (c, v) => `테스트 목소리: ${c} · ${v}`, testVoiceDefault: '이 서비스를 쓰는 캐릭터가 없어서 서비스의 기본 목소리로 읽어요', costDownloadNoSize: '처음 쓸 때 모델을 내려받아요',
    embWarn: '저장된 기억을 다시 만들어야 할 수 있어요', demoPending: '목업 표시 · Lane A 확인 대기', demoSim: '이 목업에서 테스트, 목록 가져오기, 내려받기는 시뮬레이션이에요',
    memAlways: 'HypaMemory V3는 프리셋에서 ‘캐릭터를 고르면 자동으로 켜기’를 켜면 새 채팅에서 저절로 켜져요', emoPromptNote: '캐릭터가 자기 감정 지침을 더할 수도 있어요 · Studio에서 바꿔요', vcNoVoiceTab: '목소리 설정은 아직 Studio에 없어요 · 캐릭터만 열려요',
    testNoKey: '연결에 키가 없어요 · 연결을 먼저 추가하세요', testNoAddr: '연결에 주소가 없어요 · 연결을 먼저 추가하세요', testUnreachable: '주소에 닿지 못했어요 · 서버가 켜져 있는지 확인하세요', testBadKey: '서비스가 키를 받아 주지 않았어요 · 키를 다시 확인하세요', testTimeout: '시간 안에 답이 오지 않았어요 (ComfyUI · 60초)', testWarming: '모델을 깨우는 중이에요 · 최대 30초 · 잠시 뒤에 다시 시도하세요', testNoModel: 'WaveSpeed 모델을 먼저 고르세요',
    /* undo labels */
    luSkip: '그 사이에 바뀌어서 되돌리지 않았어요', luEdit: (l) => `${l} 바꾸기`, luEngine: '장기 기억 방식 바꾸기', luPmChoose: (l) => `${l} 고르기`, luPmNew: (l) => `${l} 만들기`, luPmDup: (l) => `${l} 복제`, luPmRename: (n) => `‘${n}’ 이름 바꾸기`, luPmImport: (l) => `${l} 가져오기`, luPmDel: (n) => `‘${n}’ 지우기`, luPedReset: (n) => `‘${n}’ 기본값으로`, luWsModel: '모델 고르기', luLoraAdd: 'LoRA 추가', luLoraDel: 'LoRA 지우기', luCacheImport: '번역 캐시 가져오기', luCacheClear: '번역 캐시 비우기',
    resetDone: (l) => `기본값으로 되돌렸어요: ${l}`, numBad: (l, a, b) => `${l}: ${a}에서 ${b} 사이로 입력하세요`, numRange: (a, b) => `${a}에서 ${b} 사이로 입력하세요`, numMin: (l, a) => `${l}: ${a} 이상으로 입력하세요`, numMinR: (a) => `${a} 이상으로 입력하세요`,
    /* 장기 기억 */
    memLegend: '장기 기억 방식', engNoneN: '끄기', engNone: '오래된 메시지는 그냥 맥락에서 빠져요', engV3: '오래된 대화를 요약하고, 관련 있는 요약을 찾아 함께 보내요 · 프리셋으로 조절해요', engHanurai: '요약 없이 비슷한 메시지만 찾아서 보내요', engV2: '요약과 검색을 함께 써요', engSupa: '오래된 대화를 한 덩어리로 요약해 보내요',
    tagRec: '권장', tagOld: '이전 방식', memPerChat: '채팅마다 켜고 끌 수 있어요 · 채팅 메뉴의 ‘장기 기억’', engSwitched: (n) => `장기 기억을 ‘${n}’(으)로 바꿨어요`,
    memNeedOpenai: 'OpenAI 연결이 필요해요', memModelIs: (n) => `기억 모델: ${n}`, memModelGo: '모델 페이지에서 바꾸기', memSumMem: (n) => `기억 모델 (${n})`,
    memEmbA: (m) => `임베딩: ${m} · `, memEmbGo: '모델 페이지에서 바꿔요', memEmbB: ' · 감정 이미지와 같이 써요', memEmbC: ' · 장기 기억과 같이 써요', costRequests: '요약할 때 기억 모델로 요청을 더 보내요', costDownload: (s) => `처음 쓸 때 모델을 내려받아요 (약 ${s})`,
    pmLabelMem: '프리셋', pmLabelTr: '번역 프리셋', pmChooseAria: (n) => `프리셋 고르기 (지금: ${n})`, pmChooseMenu: '프리셋 고르기', pmEdit: '편집', pmEditAria: (n) => `프리셋 편집: ${n}`, pmMenuAria: '프리셋 메뉴',
    pmNew: '새로 만들기', pmDup: '복제', pmRename: '이름 바꾸기', pmExport: (e) => `내보내기 (${e})`, pmImport: '가져오기', pmDelete: '삭제', pmLast: '프리셋이 하나는 있어야 해요',
    pmNewT: '새 프리셋', pmName: '이름', pmCreate: '만들기', pmNameTaken: '같은 이름의 프리셋이 있어요', pmNewNameMem: '새 프리셋', pmNewNameTr: '새 번역 프리셋', pmCopyName: (n) => `${n} 복사본`, pmCreated: '프리셋을 만들었어요', pmDuped: '프리셋을 복제했어요',
    pmRenameT: '이름 바꾸기', pmRenameDo: '바꾸기', pmRenamed: '이름을 바꿨어요', pmExported: '내보냈어요', pmImportT: '프리셋 가져오기', pmImportPick: '가져올 파일을 고르세요', pmImportDo: '가져오기', pmImportOkLine: (n) => `가져올 프리셋: ${n}`, pmImportBroken: '파일을 읽지 못했어요 · 깨진 파일 같아요', pmImportForeign: '프리셋 파일이 아니에요 · 이 파일은 가져오지 않아요', pmImported: '프리셋을 가져왔어요',
    pmDelT: '프리셋을 지울까요?', pmDelBody: '지운 뒤에도 바로 되돌릴 수 있어요', pmDelDo: '지우기', pmDeleted: '프리셋을 지웠어요', pmChosen: '프리셋을 바꿨어요', pmSame: '이미 쓰고 있는 프리셋이에요',
    pmSumAria: (n) => `프리셋 요약: ${n}`, pmSumRatio: (p) => `기억 비율 ${p}%`, pmSumShares: (a, b, c) => `최근 ${a}% · 비슷한 ${b}% · 무작위 ${c}%`, pmSumModel: (m) => `요약 모델: ${m}`,
    pedActive: '지금 쓰고 있는 프리셋이에요', pedNotActive: '아직 쓰고 있지 않은 프리셋이에요 · 고쳐도 쓰는 프리셋은 그대로예요', pedUse: '이 프리셋 쓰기', pedUsed: '쓰는 중', pedResetAll: '프리셋 전체 기본값으로', pedResetDone: '프리셋을 기본값으로 되돌렸어요', pedResetNone: '이미 모두 기본값이에요',
    pedSumSec: '요약', pedRatioSec: '기억 비율', pedAdvSec: '고급', pedAdvSum: '고급 설정 보기', pedSepHelpA: '줄바꿈은', pedSepHelpB: '처럼 적어요 · 지금 값:',
    ratTitle: '기억을 나누는 몫', ratRecent: (p) => `최근 ${p}%`, ratSimilar: (p) => `비슷한 ${p}%`, ratRandom: (p) => `무작위 ${p}%`, ratRemain: (p) => `무작위 ${p}% (남는 몫)`, ratVtRecent: '최근', ratVtSimilar: '비슷한', ratClamped: (l) => `합이 100%를 넘지 않게 ${l}%로 맞췄어요`,
    maxTitle: '최대 기억 비율', maxNone: '캐릭터를 고르면 계산해요', maxHave: (c) => `계산한 캐릭터: ${c}`,
    /* 음성 */
    vsTitle: '목소리 서비스', vsListedTitle: '그 밖의 목소리', vsListedNote: '이 목소리들은 캐릭터에서 고르거나, 따로 설정할 게 없어요', vsEleven: '모델은 multilingual v2로 고정돼 있어요', vsVoicevox: 'VOICEVOX는 일본어로 번역해서 읽어요 · 번역 설정을 써요', vsVoicevoxTr: (n) => `지금 번역: ${n}`, vsVoicevoxGo: '번역 설정 열기', vsOpenai: '채팅과 같은 OpenAI 연결을 써요 · 캐릭터마다 다른 주소를 쓸 수 있어요 (Studio)', vsHf: '영어가 아닌 언어는 번역 설정을 써요 · 모델이 자고 있으면 깨우는 데 최대 30초 걸려요',
    listBrowser: '브라우저 음성', listVits: 'VITS', listSovits: 'GPT-SoVITS',
    vcTitle: '캐릭터 목소리', vcSummary: (n, m) => `${m}명 중 ${n}명이 목소리를 써요`, vcIntro: '목소리는 캐릭터마다 정해요 · 바꾸려면 Studio에서 열어요', vcVoice: (e, v) => `${e} · ${v}`, vcAuto: '자동', vcNone: '목소리 없음', vcQuote: '따옴표 안만 읽기', vcStudio: 'Studio에서 바꾸기', vcStudioOf: (n) => `Studio에서 바꾸기: ${n}`, vcNote: '엔진, 목소리, 속도, 따옴표 안만 읽기는 캐릭터마다 Studio에서 정해요',
    /* 감정 이미지 */
    emoLegend: '감정을 고르는 방식', emoModelL: '감정 모델이 골라요', emoModelD: '모델 페이지의 감정 모델에게 짧게 물어봐요 · 요청이 하나 더 가요', emoModelIs: (n) => `감정 모델: ${n}`, emoModelGo: '모델 페이지에서 바꾸기', emoEmbL: '문장 비슷함으로 골라요', emoEmbD: '요청 없이 기기에서 계산해요',
    emoPromptDim: '감정 모델이 고를 때만 쓰여요 · 방식을 바꾸면 고칠 수 있어요', dimBlocked: '이 칸은 지금 고칠 수 없어요 · 방식을 감정 모델로 바꾸면 고칠 수 있어요', emoPerChar: '감정 이미지는 캐릭터마다 정해요', emoNames: (n) => `감정 이름 · ${n}`, emoStudio: 'Studio에서 열기', emoStudioOf: (n) => `Studio에서 열기: ${n}`, noChar: '캐릭터를 고르면 보여 줘요', emoNoChar: '캐릭터를 고르면 Studio에서 열 수 있어요',
    /* 이미지 생성 */
    igLegend: '이미지 생성 서비스', igOff: '끄기', igOffD: '이미지를 만들지 않아요', igCost: '이미지 하나에 보조 모델 요청 1번 + 서비스 요청 1번', igFieldsOf: (n) => `${n} 설정`, igAddr: '주소', igAddrKey: '주소 + 키', igKey: '키', igListed: '이번 시안에는 필드 이름만 나와요:', igSubNote: '이 서비스의 설정이에요',
    igFieldsNai: '주소, 키, 모델, 크기, 샘플러, 노이즈 스케줄, 단계, 스케일, CFG 보정, 참고 이미지(바이브/캐릭터), SMEA, DYN, Variety+, Decrisp, 이미지로 이미지', igFieldsDalle: '키, 품질(표준/HD)', igFieldsStab: '키, 모델(ultra, core, sd3-large, sd3-medium), core 스타일', igFieldsFal: '키, 크기, 모델, LoRA 주소와 세기', igFieldsComfy: '주소, 워크플로, 제한 시간(1–120초)', igFieldsImagen: '키, 모델, 이미지 크기(1K/2K), 가로세로 비율, 사람 생성', igFieldsComfyOld: '주소, 워크플로, 제한 시간, 긍정/부정 프롬프트 노드 번호와 필드 이름',
    sdCustom: '직접 입력', sdBlank: '샘플러 이름을 비울 수 없어요 · 이전 값을 그대로 뒀어요', sdCustomL: '샘플러 이름', sdSamplerD: '자주 쓰는 샘플러를 고르거나 직접 입력해요', sdHiresSum: '고해상도 보정 (선택)', sdApi: 'WebUI를 --api 옵션으로 실행해야 연결돼요', sdLicense: 'WebUI는 AGPL 라이선스예요 · 이 앱에 들어 있지 않아요', sdTunnel: '웹 버전에서는 내 PC의 WebUI에 닿으려면 터널이 필요해요',
    pvTitle: '프롬프트 (캐릭터마다 정해요)', pvOf: (n) => `프롬프트 · ${n}`, pvPrefix: '앞에 붙는 말', pvNegative: '빼는 말', pvStudio: 'Studio에서 바꾸기', pvStudioOf: (n) => `Studio에서 바꾸기: ${n}`,
    wsSearch: '모델 검색', wsRefresh: '모델 목록 새로 불러오기', wsListAria: 'WaveSpeed 모델', wsLoading: '모델 목록을 불러오는 중이에요…', wsFail: '목록을 불러오지 못했어요 · 키와 네트워크를 확인하세요', wsEmpty: '불러온 모델이 없어요', wsNever: '아직 목록을 불러오지 않았어요 · 새로고침을 눌러 주세요', wsNoMatch: (q) => `맞는 모델이 없어요: ${q}`, wsCount: (n, m) => (n === m ? `모델 ${n}개` : `모델 ${m}개 중 ${n}개`), wsLoaded: (n) => `모델 ${n}개를 불러왔어요`, wsLora: 'LoRA', wsRef: '참고 이미지', wsYes: '지원', wsNo: '지원 안 함', wsChosen: (n, p) => `고른 모델: ${n} · ${p}`, wsChosenNoPrice: (n) => `고른 모델: ${n}`, wsNone: '모델을 아직 고르지 않았어요', wsPicked: '모델을 골랐어요', wsNoLora: '이 모델은 LoRA를 지원하지 않아요', wsNoRef: '이 모델은 참고 이미지를 지원하지 않아요',
    loraTitle: 'LoRA (최대 3개)', loraUrl: (i) => `LoRA ${i} 주소`, loraUrlPh: 'LoRA 주소', loraScale: (i) => `LoRA ${i} 세기`, loraDel: (i) => `LoRA ${i} 지우기`, loraAdd: 'LoRA 추가', loraMax: (n) => `${n}/3개`, loraFull: 'LoRA는 3개까지 쓸 수 있어요', loraAdded: (n) => `LoRA ${n}개`, loraRemoved: 'LoRA를 지웠어요',
    /* 번역 */
    googleOnly: 'Google에서만', googleOnlyWarn: '이 언어는 Google에서만 번역돼요 · 다른 방식에서는 번역되지 않아요', trTypeLegend: '번역 방식', ttGoogle: '무료 · 공개 주소를 써요', ttDeepl: '키가 필요해요 · 연결에서 키를 관리해요', ttDeeplx: '주소와 토큰이 필요해요 · 연결에서 관리해요', ttLlm: '번역 모델에게 맡겨요 · 프리셋으로 말투를 정해요', ttLocal: '기기에서 번역해요 · 처음 쓸 때 모델을 내려받아요', ttLlmN: 'AI 모델', ttLocalN: '기기에서 번역 (Firefox 엔진)',
    deeplWeb: '웹 버전에서는 DeepL에 직접 닿지 못할 수 있어요 · 프록시가 필요해요', srcNote: '원문 언어는 Google에서만 고를 수 있어요', trOffNote: '번역이 꺼져 있어요 · 언어를 고르면 방식을 정할 수 있어요', trModelIs: (n) => `번역 모델: ${n}`, trModelGo: '모델 페이지에서 바꾸기',
    trPresetTitle: 'AI 번역 프리셋', trPromptDefault: '(기본 프롬프트)', trMaxIs: (n) => `최대 응답 ${n}`, trSum: (l, t) => `${l} · ${t}`, trSumOff: '번역이 꺼져 있어요', trLinkT: '번역은 언어 페이지에서 설정해요', trLinkGo: '언어에서 열기', trVoicevox: '음성: VOICEVOX가 이 번역을 써요', trVoicevoxGo: '음성 설정 열기',
    trTestTitle: '번역 테스트', trSample: '샘플 문장: “Hello, nice to meet you.”', trpTitle: '프롬프트와 길이', trpSlot: '{{slot}}은 번역할 언어로 바뀌어요',
    cacheTitle: '번역 캐시', cacheCount: (n) => `저장된 번역 ${n}개`, cacheExport: '내보내기', cacheImport: '가져오기', cacheClear: '비우기', cacheNa: '번역 캐시는 AI 모델 방식에만 있어요', cacheEmpty: '캐시가 비어 있어요', cacheExported: (n) => `번역 ${n}개를 내보냈어요`, cacheImportT: '번역 캐시 가져오기', cacheImportBody: '가져오면 지금 캐시에 합쳐져요', cacheImportDo: '가져오기', cacheImportOk: (n) => `번역 ${n}개를 합쳐요`, cacheImportBad: '캐시 파일이 아니에요', cacheImported: (n) => `번역 ${n}개를 가져왔어요`,
    cacheClearT: '번역 캐시를 비울까요?', cacheClearBody: (n) => `저장된 번역 ${n}개가 지워져요 · 10초 안에는 되돌릴 수 있어요`, cacheClearDo: '비우기', cacheCleared: (n) => `번역 ${n}개를 비웠어요`, cacheGone: '10초가 지나서 되돌릴 수 없어요',
    /* 모델 › 임베딩 */
    embCpu: '이 기기 (CPU)', embGpu: '이 기기 (GPU · WebGPU)', embHosted: '호스팅 서비스', embCustom: '직접 지정', embShared: '장기 기억과 감정 이미지(문장 비슷함 방식)가 같이 써요 · 여기서 바꾸면 둘 다 바뀌어요',
    /* sub-page back labels, search groups, demo */
    backMem: '장기 기억으로 돌아가기', backMemS: '장기 기억', backVoice: '음성으로 돌아가기', backVoiceS: '음성', backImg: '이미지 생성으로 돌아가기', backImgS: '이미지 생성', backTr: '번역으로 돌아가기', backTrS: '번역',
    grpItem: '프리셋·서비스', srchMemPreset: 'HypaMemory V3 프리셋', srchTrPreset: 'AI 번역 프리셋', srchVoice: '음성 서비스', srchImg: '이미지 생성 서비스', srchTrType: '번역 방식',
    demo5b: '대화 기능 데모', demoSet: '데이터 세트', setDemo: '기본', setLegacy: '이전 방식 중심', setFailing: '모두 실패', setEmpty: '빈 상태', demoGpu: 'WebGPU 있음', demoChar: '캐릭터 고르기', demoWeb: '웹 버전', demoAllFail: '모든 테스트 실패', demoHf: 'Hugging Face 503', demoWsFetch: 'WaveSpeed 목록 불러오기', demoState: '상태', demoGo: '열기',
  },
  en: {
    title: 'Settings slice 5b · chat features, translation, embedding mockup', undo: 'Undo', cancel: 'Cancel', close: 'Close',
    connChip: (n) => `Connection: ${n}`, connNeed: 'Connection needed', connAdd: 'Add connection', connAddOf: (n) => `Add connection: ${n}`, connAria: (n) => `Connection: ${n} · open`, connOpen: 'Open on the Connections page',
    needKey: 'Key', needAddr: 'Address', needAddrKey: 'Address + key', needAddrToken: 'Address and token', needNone: 'None', needFile: 'Pick a file in the character',
    svcAddTitle: (n) => `Add connection: ${n}`, svcAddKeyHint: 'The key stays on this device', svcAddAddrHint: 'The address starts with http:// or https://', svcAddr: 'Address', svcKey: 'Key', svcSave: 'Save', svcAddrBad: 'The address must start with http:// or https://', svcKeyBad: 'Enter a key', svcAdded: (n) => `Connection added: ${n}`, luSvc: (n) => `add connection: ${n}`,
    test: 'Test', testOf: (n) => `Test: ${n}`, testCancel: 'Cancel', testCancelOf: (n) => `Cancel test: ${n}`, testRunning: 'Testing…', testRunVoice: 'Reading “Hello, this is a voice test” aloud…', testRunImage: 'Making a small test image…', testRunTr: 'Translating a sample sentence…', testCancelled: 'Test cancelled',
    testOkShort: 'The test worked', testOkVoice: 'Read it aloud · “Hello, this is a voice test”', testOkImage: (s, c) => `Took ${s} s · estimated cost ${c}`, testOkImageNoCost: (s) => `Took ${s} s`, testOkTr: (o) => `“Hello, nice to meet you.” → ${o}`, costFree: 'Free',
    phDefault: 'Blank uses the built-in prompt', testOffline: 'Could not reach the translation server · check your internet connection', testNoTrModel: 'No model is set for translation · choose one on the Models page', testDlFail: 'Could not download the translation model · check your internet connection', testPaid: 'This may cost money',
    testVoiceUses: (c, v) => `Test voice: ${c} · ${v}`, testVoiceDefault: 'No character uses this service, so the default voice of the service reads it', costDownloadNoSize: 'Downloads the model the first time you use it',
    embWarn: 'Memories already stored may need to be rebuilt', demoPending: 'Mockup mark · waiting for Lane A', demoSim: 'In this mockup tests, list fetches and downloads are simulated',
    memAlways: 'HypaMemory V3: turn on ‘Turn on automatically when a character is chosen’ in the preset and memory starts on in new chats', emoPromptNote: 'A character may add its own emotion instructions · change them in Studio', vcNoVoiceTab: 'Voice settings are not in Studio yet · only the character opens',
    testNoKey: 'The connection has no key · add the connection first', testNoAddr: 'The connection has no address · add the connection first', testUnreachable: 'Could not reach the address · check that the server is running', testBadKey: 'The service did not accept the key · check the key again', testTimeout: 'No answer in time (ComfyUI · 60 s)', testWarming: 'Waking the model up · up to 30 s · try again in a moment', testNoModel: 'Pick a WaveSpeed model first',
    luSkip: 'It changed in the meantime, so nothing was undone', luEdit: (l) => `change ${l}`, luEngine: 'change the long-term memory type', luPmChoose: (l) => `choose ${l}`, luPmNew: (l) => `create ${l}`, luPmDup: (l) => `duplicate ${l}`, luPmRename: (n) => `rename "${n}"`, luPmImport: (l) => `import ${l}`, luPmDel: (n) => `delete "${n}"`, luPedReset: (n) => `reset "${n}" to defaults`, luWsModel: 'choose a model', luLoraAdd: 'add a LoRA', luLoraDel: 'remove a LoRA', luCacheImport: 'import the translation cache', luCacheClear: 'clear the translation cache',
    resetDone: (l) => `Reset to its default: ${l}`, numBad: (l, a, b) => `${l}: enter a value from ${a} to ${b}`, numRange: (a, b) => `Enter a value from ${a} to ${b}`, numMin: (l, a) => `${l}: enter ${a} or more`, numMinR: (a) => `Enter ${a} or more`,
    memLegend: 'Long-term memory type', engNoneN: 'Off', engNone: 'Old messages simply drop out of the context', engV3: 'Summarises old conversation and sends the relevant summaries along · tuned with presets', engHanurai: 'Finds and sends similar messages, with no summaries', engV2: 'Uses summaries and search together', engSupa: 'Summarises old conversation into one block and sends it',
    tagRec: 'Recommended', tagOld: 'Older method', memPerChat: 'Each chat can turn it on or off · “Long-term memory” in the chat menu', engSwitched: (n) => `Long-term memory is now “${n}”`,
    memNeedOpenai: 'Needs an OpenAI connection', memModelIs: (n) => `Memory model: ${n}`, memModelGo: 'Change on the Models page', memSumMem: (n) => `Memory model (${n})`,
    memEmbA: (m) => `Embedding: ${m} · `, memEmbGo: 'Change on the Models page', memEmbB: ' · shared with emotion images', memEmbC: ' · shared with long-term memory', costRequests: 'Summaries send extra requests to the memory model', costDownload: (s) => `Downloads the model the first time you use it (about ${s})`,
    pmLabelMem: 'Preset', pmLabelTr: 'Translation preset', pmChooseAria: (n) => `Choose preset (now: ${n})`, pmChooseMenu: 'Choose a preset', pmEdit: 'Edit', pmEditAria: (n) => `Edit preset: ${n}`, pmMenuAria: 'Preset menu',
    pmNew: 'New', pmDup: 'Duplicate', pmRename: 'Rename', pmExport: (e) => `Export (${e})`, pmImport: 'Import', pmDelete: 'Delete', pmLast: 'There must be at least one preset',
    pmNewT: 'New preset', pmName: 'Name', pmCreate: 'Create', pmNameTaken: 'A preset with this name exists', pmNewNameMem: 'New preset', pmNewNameTr: 'New translation preset', pmCopyName: (n) => `${n} copy`, pmCreated: 'Preset created', pmDuped: 'Preset duplicated',
    pmRenameT: 'Rename', pmRenameDo: 'Rename', pmRenamed: 'Renamed', pmExported: 'Exported', pmImportT: 'Import a preset', pmImportPick: 'Choose the file to import', pmImportDo: 'Import', pmImportOkLine: (n) => `Preset to import: ${n}`, pmImportBroken: 'Could not read the file · it looks broken', pmImportForeign: 'This is not a preset file · it will not be imported', pmImported: 'Preset imported',
    pmDelT: 'Delete this preset?', pmDelBody: 'You can undo it right after', pmDelDo: 'Delete', pmDeleted: 'Preset deleted', pmChosen: 'Preset changed', pmSame: 'This preset is already in use',
    pmSumAria: (n) => `Preset summary: ${n}`, pmSumRatio: (p) => `Memory ratio ${p}%`, pmSumShares: (a, b, c) => `Recent ${a}% · similar ${b}% · random ${c}%`, pmSumModel: (m) => `Summary model: ${m}`,
    pedActive: 'This preset is in use', pedNotActive: 'This preset is not in use yet · editing it does not change the one in use', pedUse: 'Use this preset', pedUsed: 'In use', pedResetAll: 'Reset the whole preset', pedResetDone: 'Preset reset to its defaults', pedResetNone: 'Everything is already at its default',
    pedSumSec: 'Summaries', pedRatioSec: 'Memory ratio', pedAdvSec: 'Advanced', pedAdvSum: 'Show advanced settings', pedSepHelpA: 'Write a line break as', pedSepHelpB: ' · current value:',
    ratTitle: 'How memory is shared', ratRecent: (p) => `Recent ${p}%`, ratSimilar: (p) => `Similar ${p}%`, ratRandom: (p) => `Random ${p}%`, ratRemain: (p) => `Random ${p}% (the rest)`, ratVtRecent: 'Recent', ratVtSimilar: 'Similar', ratClamped: (l) => `Kept the total at 100%: set to ${l}%`,
    maxTitle: 'Max memory ratio', maxNone: 'Choose a character to calculate it', maxHave: (c) => `Calculated for: ${c}`,
    vsTitle: 'Voice services', vsListedTitle: 'Other voices', vsListedNote: 'These voices are chosen in the character, or need no setup', vsEleven: 'The model is fixed to multilingual v2', vsVoicevox: 'VOICEVOX reads in Japanese: it translates first, using the translation settings', vsVoicevoxTr: (n) => `Translation now: ${n}`, vsVoicevoxGo: 'Open translation settings', vsOpenai: 'Uses the same OpenAI connection as chat · a character can use its own address (Studio)', vsHf: 'Languages other than English use the translation settings · a sleeping model can take up to 30 s to wake',
    listBrowser: 'Browser voice', listVits: 'VITS', listSovits: 'GPT-SoVITS',
    vcTitle: 'Character voices', vcSummary: (n, m) => `${n} of ${m} characters have a voice`, vcIntro: 'A voice is chosen per character · open Studio to change it', vcVoice: (e, v) => `${e} · ${v}`, vcAuto: 'Automatic', vcNone: 'No voice', vcQuote: 'Quoted text only', vcStudio: 'Change in Studio', vcStudioOf: (n) => `Change in Studio: ${n}`, vcNote: 'Engine, voice, speed and quoted-text-only are set per character in Studio',
    emoLegend: 'How the emotion is chosen', emoModelL: 'The emotion model chooses', emoModelD: 'Asks the emotion model of the Models page a short question · one more request', emoModelIs: (n) => `Emotion model: ${n}`, emoModelGo: 'Change on the Models page', emoEmbL: 'Chosen by how similar the text is', emoEmbD: 'Calculated on this device, no request',
    emoPromptDim: 'Only used when the emotion model chooses · switch the method to edit it', dimBlocked: 'This field cannot be edited now · switch the method to the emotion model to edit it', emoPerChar: 'Emotion images are set per character', emoNames: (n) => `Emotion names · ${n}`, emoStudio: 'Open in Studio', emoStudioOf: (n) => `Open in Studio: ${n}`, noChar: 'Choose a character to see it', emoNoChar: 'Choose a character to open it in Studio',
    igLegend: 'Image generation service', igOff: 'Off', igOffD: 'No images are made', igCost: 'Each image costs one request to the sub model and one to the service', igFieldsOf: (n) => `${n} settings`, igAddr: 'Address', igAddrKey: 'Address + key', igKey: 'Key', igListed: 'This mockup lists the field names only:', igSubNote: 'The settings of this service',
    igFieldsNai: 'address, key, model, size, sampler, noise schedule, steps, scale, CFG rescale, reference (vibe/character), SMEA, DYN, Variety+, Decrisp, image to image', igFieldsDalle: 'key, quality (standard/HD)', igFieldsStab: 'key, model (ultra, core, sd3-large, sd3-medium), core style', igFieldsFal: 'key, size, model, LoRA address and strength', igFieldsComfy: 'address, workflow, timeout (1–120 s)', igFieldsImagen: 'key, model, image size (1K/2K), aspect ratio, person generation', igFieldsComfyOld: 'address, workflow, timeout, positive/negative prompt node numbers and field names',
    sdCustom: 'Type your own', sdBlank: 'The sampler name cannot be blank · the previous value was kept', sdCustomL: 'Sampler name', sdSamplerD: 'Pick a common sampler or type your own', sdHiresSum: 'Hires fix (optional)', sdApi: 'Start WebUI with the --api option so it can connect', sdLicense: 'WebUI is under the AGPL licence · it is not bundled with this app', sdTunnel: 'On the web build you need a tunnel to reach the WebUI on your PC',
    pvTitle: 'Prompt (set per character)', pvOf: (n) => `Prompt · ${n}`, pvPrefix: 'Added in front', pvNegative: 'Left out', pvStudio: 'Change in Studio', pvStudioOf: (n) => `Change in Studio: ${n}`,
    wsSearch: 'Search models', wsRefresh: 'Reload the model list', wsListAria: 'WaveSpeed models', wsLoading: 'Loading the model list…', wsFail: 'Could not load the list · check the key and the network', wsEmpty: 'No models were found', wsNever: 'The list has not been loaded yet · press reload', wsNoMatch: (q) => `No matching model: ${q}`, wsCount: (n, m) => (n === m ? `${n} models` : `${n} of ${m} models`), wsLoaded: (n) => `Loaded ${n} models`, wsLora: 'LoRA', wsRef: 'Reference image', wsYes: 'supported', wsNo: 'not supported', wsChosen: (n, p) => `Chosen model: ${n} · ${p}`, wsChosenNoPrice: (n) => `Chosen model: ${n}`, wsNone: 'No model chosen yet', wsPicked: 'Model chosen', wsNoLora: 'This model does not support LoRA', wsNoRef: 'This model does not support a reference image',
    loraTitle: 'LoRA (up to 3)', loraUrl: (i) => `LoRA ${i} address`, loraUrlPh: 'LoRA address', loraScale: (i) => `LoRA ${i} strength`, loraDel: (i) => `Remove LoRA ${i}`, loraAdd: 'Add LoRA', loraMax: (n) => `${n}/3`, loraFull: 'You can use up to 3 LoRAs', loraAdded: (n) => `${n} LoRA`, loraRemoved: 'LoRA removed',
    googleOnly: 'Google only', googleOnlyWarn: 'This language is only translated by Google · the other methods will not translate it', trTypeLegend: 'Translation method', ttGoogle: 'Free · uses a public address', ttDeepl: 'Needs a key · the key is managed under Connections', ttDeeplx: 'Needs an address and a token · managed under Connections', ttLlm: 'Leaves it to the translation model · presets set the tone', ttLocal: 'Translates on this device · downloads a model the first time', ttLlmN: 'AI model', ttLocalN: 'On this device (Firefox engine)',
    deeplWeb: 'On the web build DeepL may not be reachable directly · a proxy is needed', srcNote: 'The source language can only be chosen with Google', trOffNote: 'Translation is off · choose a language to pick a method', trModelIs: (n) => `Translation model: ${n}`, trModelGo: 'Change on the Models page',
    trPresetTitle: 'AI translation presets', trPromptDefault: '(default prompt)', trMaxIs: (n) => `Max response ${n}`, trSum: (l, t) => `${l} · ${t}`, trSumOff: 'Translation is off', trLinkT: 'Translation is set on the Language page', trLinkGo: 'Open in Language', trVoicevox: 'Voice: VOICEVOX uses this translation', trVoicevoxGo: 'Open voice settings',
    trTestTitle: 'Translation test', trSample: 'Sample sentence: “Hello, nice to meet you.”', trpTitle: 'Prompt and length', trpSlot: '{{slot}} becomes the language to translate into',
    cacheTitle: 'Translation cache', cacheCount: (n) => `${n} saved translations`, cacheExport: 'Export', cacheImport: 'Import', cacheClear: 'Clear', cacheNa: 'The translation cache only exists for the AI model method', cacheEmpty: 'The cache is empty', cacheExported: (n) => `Exported ${n} translations`, cacheImportT: 'Import a translation cache', cacheImportBody: 'It is merged into the current cache', cacheImportDo: 'Import', cacheImportOk: (n) => `Merges ${n} translations`, cacheImportBad: 'This is not a cache file', cacheImported: (n) => `Imported ${n} translations`,
    cacheClearT: 'Clear the translation cache?', cacheClearBody: (n) => `${n} saved translations will be removed · you can undo within 10 seconds`, cacheClearDo: 'Clear', cacheCleared: (n) => `Cleared ${n} translations`, cacheGone: 'More than 10 seconds have passed, so it cannot be undone',
    embCpu: 'On this device (CPU)', embGpu: 'On this device (GPU · WebGPU)', embHosted: 'Hosted services', embCustom: 'Custom', embShared: 'Long-term memory and emotion images (similarity method) share it · changing it here changes both',
    backMem: 'Back to long-term memory', backMemS: 'Long-term memory', backVoice: 'Back to voice', backVoiceS: 'Voice', backImg: 'Back to image generation', backImgS: 'Image generation', backTr: 'Back to translation', backTrS: 'Translation',
    grpItem: 'Presets and services', srchMemPreset: 'HypaMemory V3 preset', srchTrPreset: 'AI translation preset', srchVoice: 'Voice service', srchImg: 'Image generation service', srchTrType: 'Translation method',
    demo5b: 'Chat features demo', demoSet: 'Data set', setDemo: 'Default', setLegacy: 'Older methods', setFailing: 'Everything fails', setEmpty: 'Empty', demoGpu: 'Has WebGPU', demoChar: 'A character is chosen', demoWeb: 'Web build', demoAllFail: 'Every test fails', demoHf: 'Hugging Face 503', demoWsFetch: 'WaveSpeed list fetch', demoState: 'State', demoGo: 'Open',
  },
};

/*@@K2@@*/

window.SS5B_DATA = { SET5B, FL, ST, K, ENG, ALGO, MF_KEYS, engineOf, writeEngine, hvp, HV3_DEF, mkHv, EMB, IMG_PROV, SAMPLERS, LANGS, TTYPES, WS_MODELS, ENGINES, FILES, SIMFAIL };
})();
