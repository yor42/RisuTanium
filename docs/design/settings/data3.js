/* Settings slice 3 (connections and model choice) fixtures. Synthetic; loaded after data.js and data2.js, before slice2.js / slice3.js / slice1.js.
   Mutates window.SS1_DATA in place (rows, sections, models, connections) so slice 1 and 2 code keeps working on the same arrays, then publishes window.SS3_DATA.
   Keys are fake ("fake-key-0000-..."), hosts are *.invalid. Nothing here is read from or written to the real app.
   Sets (?set=): demo (7 connections, ~190 catalog models, 3 custom models, one per-task override, two fallback lists), stress (20 connections, 1,500 models, 40 custom models),
   none (no connections: first run), broken (the active preset's connection deleted and another one keyless: fix marks everywhere), migrated (demo with the reverse-proxy settings migrated into host-named connections, DS-060).
   ?set= is shared with slice 2 (demo / stress / one / fresh): "stress" also gives slice 2's 300 presets; "none" and "broken" fall back to slice 2's demo presets. */
(() => {
'use strict';
const D = window.SS1_DATA;
const Q = new URLSearchParams(location.search);
const SET3 = ['demo', 'stress', 'none', 'broken', 'migrated'].includes(Q.get('set')) ? Q.get('set') : 'demo';
const rowOf = (id) => D.rows.find((r) => r.id === id);

/* ------------------------------------------------------------------ capability flags (28 known flags, short plain phrases) */
const FLAGS = [
  ['vision', '이미지 입력', 'Image input'], ['tools', '도구 사용', 'Tool use'], ['reasoning', '추론', 'Reasoning'], ['imgout', '이미지 생성', 'Image generation'],
  ['stream', '실시간 출력', 'Streaming'], ['json', 'JSON 출력', 'JSON output'], ['schema', '구조화된 출력', 'Structured output'], ['sysprompt', '시스템 프롬프트', 'System prompt'],
  ['cache', '프롬프트 캐시', 'Prompt caching'], ['ptools', '도구 동시 호출', 'Parallel tool calls'], ['search', '웹 검색', 'Web search'], ['audioin', '음성 입력', 'Audio input'],
  ['audioout', '음성 출력', 'Audio output'], ['videoin', '영상 입력', 'Video input'], ['pdf', 'PDF 읽기', 'PDF reading'], ['think', '생각 예산 조절', 'Thinking budget'],
  ['prefill', '답변 미리 채우기', 'Reply prefill'], ['logprob', '로그 확률', 'Log probabilities'], ['seed', '시드 지정', 'Seed'], ['stop', '중단 문구', 'Stop sequences'],
  ['topk', 'Top K', 'Top K'], ['minp', 'Min P', 'Min P'], ['rep', '반복 억제', 'Repetition penalty'], ['bias', '편향 조절', 'Logit bias'],
  ['fim', '코드 이어 쓰기', 'Fill in the middle'], ['batch', '일괄 요청', 'Batch requests'], ['cite', '출처 표시', 'Citations'], ['lang', '다국어', 'Multilingual'],
];
const FLAG = Object.fromEntries(FLAGS.map((f) => [f[0], f]));

/* ------------------------------------------------------------------ providers (17) */
// key: 'key' | 'opt' (optional) | 'none'; url: needs an address; fields: extra fields shown for this provider only
const PROVIDERS = [
  { id: 'openai', ko: 'OpenAI', en: 'OpenAI', grp: 'cloud', icon: 'cloud', key: 'key', list: true, kw: '오픈에이아이 챗지피티 지피티 gpt openai api key 키' },
  { id: 'anthropic', ko: 'Anthropic', en: 'Anthropic', grp: 'cloud', icon: 'cloud', key: 'key', list: true, kw: '앤트로픽 클로드 claude anthropic api key 키' },
  { id: 'google', ko: 'Google AI Studio', en: 'Google AI Studio', grp: 'cloud', icon: 'cloud', key: 'key', list: true, kw: '구글 제미나이 젬마 gemini google ai studio api key 키' },
  { id: 'vertex', ko: 'Vertex AI', en: 'Vertex AI', grp: 'cloud', icon: 'cloud', key: 'key', list: false, fields: ['project', 'email', 'region'], kw: '버텍스 구글 vertex google cloud 프로젝트' },
  { id: 'aws', ko: 'AWS Bedrock (Claude)', en: 'AWS Bedrock (Claude)', grp: 'cloud', icon: 'cloud', key: 'key', list: false, kw: '아마존 aws bedrock claude 베드록' },
  { id: 'mistral', ko: 'Mistral', en: 'Mistral', grp: 'cloud', icon: 'cloud', key: 'key', list: true, kw: '미스트랄 mistral api key 키' },
  { id: 'cohere', ko: 'Cohere', en: 'Cohere', grp: 'cloud', icon: 'cloud', key: 'key', list: true, kw: '코히어 cohere api key 키' },
  { id: 'novelai', ko: 'NovelAI', en: 'NovelAI', grp: 'cloud', icon: 'cloud', key: 'key', list: false, kw: '노벨에이아이 novelai bearer token 토큰' },
  { id: 'novellist', ko: 'NovelList', en: 'NovelList', grp: 'cloud', icon: 'cloud', key: 'key', list: false, kw: '노벨리스트 novellist' },
  { id: 'mancer', ko: 'Mancer', en: 'Mancer', grp: 'cloud', icon: 'cloud', key: 'key', list: false, kw: '맨서 mancer' },
  { id: 'openrouter', ko: 'OpenRouter', en: 'OpenRouter', grp: 'router', icon: 'route', key: 'key', list: true, kw: '오픈라우터 openrouter api key 키 라우터' },
  { id: 'nanogpt', ko: 'NanoGPT', en: 'NanoGPT', grp: 'router', icon: 'route', key: 'key', list: true, fields: ['sub'], kw: '나노지피티 nanogpt 구독 subscription' },
  { id: 'horde', ko: 'Horde', en: 'Horde', grp: 'router', icon: 'route', key: 'opt', list: false, kw: '호드 horde stable horde 익명' },
  { id: 'ollama', ko: 'Ollama', en: 'Ollama', grp: 'local', icon: 'house', key: 'opt', url: true, list: true, fields: ['ollamaFormat'], kw: '올라마 ollama 로컬 local 서버 주소 url' },
  { id: 'kobold', ko: 'Kobold', en: 'Kobold', grp: 'local', icon: 'house', key: 'none', url: true, list: false, kw: '코볼드 kobold koboldcpp 로컬 local 서버 주소 url' },
  { id: 'textgen', ko: 'textgen WebUI', en: 'textgen WebUI', grp: 'local', icon: 'house', key: 'none', url: true, list: false, kw: 'textgen ooba oobabooga webui 로컬 local 서버 주소 url' },
  { id: 'compat', ko: '호환 서버', en: 'Compatible server', grp: 'compat', icon: 'server', key: 'opt', url: true, list: true, fields: ['format', 'tokenizer'], kw: '호환 프록시 리버스 프록시 reverse proxy compatible custom endpoint openai 호환 url 주소' },
];
const PROV = Object.fromEntries(PROVIDERS.map((p) => [p.id, p]));
const PGROUPS = [['cloud', '클라우드', 'Cloud'], ['router', '라우터', 'Routers'], ['local', '직접 실행', 'Run locally'], ['compat', '호환', 'Compatible']];
const FORMATS = [['openai', 'OpenAI 호환', 'OpenAI compatible'], ['response', 'Responses API', 'Responses API'], ['anthropic', 'Anthropic', 'Anthropic'], ['mistral', 'Mistral', 'Mistral'], ['google', 'Google Cloud', 'Google Cloud'], ['cohere', 'Cohere', 'Cohere']];
const TOKENIZERS = [['auto', '자동', 'Automatic'], ['tiktoken', 'tiktoken', 'tiktoken'], ['llama', 'LLaMA', 'LLaMA'], ['gemma', 'Gemma', 'Gemma']];
const PROV_OF = { 'OpenAI': 'openai', 'Anthropic': 'anthropic', 'Google AI Studio': 'google', 'Vertex AI': 'vertex', 'Mistral': 'mistral', 'Cohere': 'cohere', 'Ollama': 'ollama', 'NovelAI': 'novelai', 'Horde': 'horde', '리버스 프록시': 'compat', 'OpenRouter': 'openrouter', 'NanoGPT': 'nanogpt' };

/* ------------------------------------------------------------------ catalog: enrich the existing models, then generate more */
const D_FLAGS = {
  claude: ['vision', 'tools', 'reasoning', 'stream', 'json', 'sysprompt', 'cache', 'pdf', 'think', 'prefill', 'search', 'cite', 'stop', 'lang', 'batch'],
  gpt5: ['vision', 'tools', 'reasoning', 'stream', 'json', 'schema', 'sysprompt', 'ptools', 'seed', 'logprob', 'cache', 'search', 'stop', 'lang', 'batch'],
  gpt4: ['vision', 'tools', 'stream', 'json', 'schema', 'sysprompt', 'ptools', 'seed', 'logprob', 'stop', 'lang', 'batch', 'bias'],
  gemini: ['vision', 'tools', 'reasoning', 'stream', 'json', 'schema', 'sysprompt', 'audioin', 'videoin', 'pdf', 'search', 'think', 'stop', 'lang', 'cache'],
  mistral: ['tools', 'stream', 'json', 'sysprompt', 'seed', 'stop', 'lang', 'fim', 'ptools'],
  cohere: ['tools', 'stream', 'json', 'sysprompt', 'seed', 'stop', 'cite', 'lang', 'rep'],
  local: ['stream', 'sysprompt', 'seed', 'topk', 'minp', 'rep', 'stop', 'bias'],
  nai: ['stream', 'topk', 'minp', 'rep', 'stop', 'bias'],
};
const PARAM_G = { 'temperature,top_p,top_k,thinking': 'claude', 'reasoning_effort,verbosity,seed': 'gpt5', 'temperature,top_p,frequency_penalty,presence_penalty,seed': 'gpt4', 'temperature,top_p,top_k': 'gemini', 'temperature,top_p,top_k,frequency_penalty,presence_penalty,seed': 'cohere', 'temperature,top_p,top_k,top_a,min_p,repetition_penalty,seed': 'local', 'temperature,top_p,top_k,top_a,min_p,repetition_penalty': 'nai' };
const REC = new Set(['claude-sonnet-45', 'claude-opus-41', 'claude-haiku-45', 'gpt-5', 'gpt-5-mini', 'gpt-41', 'gpt-4o', 'gemini-25-pro', 'gemini-25-flash', 'llama-local-8b', 'mistral-large', 'command-a', 'nai-erato', 'vx-gemini-25-pro', 'rp-custom-1']);
const UNVER = new Set(['gemini-exp', 'horde-auto', 'horde-llama', 'horde-mythomax', 'horde-nemo', 'rp-custom-5', 'rp-custom-8', 'rp-custom-9', 'rp-custom-10', 'gpt-oss-20b', 'ministral-3b', 'aya-local-8b', 'yi-local-34b']);
const DEPR = { 'gpt-35-turbo': [2027, 1], 'gpt-4-turbo': [2027, 3], 'claude-3-opus': [2027, 1], 'claude-35-sonnet': [2027, 2], 'claude-3-haiku': [2027, 2], 'gemini-15-pro': [2027, 1], 'gemini-15-flash': [2027, 1], 'command-light': [2027, 4], 'nai-euterpe': [2027, 6] };
const CTX = { claude: 200000, gpt5: 400000, gpt4: 128000, gemini: 1000000, mistral: 128000, cohere: 128000, local: 32000, nai: 8000 };
const MAXOUT = { claude: 64000, gpt5: 128000, gpt4: 16384, gemini: 65536, mistral: 32768, cohere: 4096, local: 8192, nai: 2048 };
const FMT = { openai: 'openai', anthropic: 'anthropic', google: 'google', vertex: 'google', aws: 'anthropic', mistral: 'mistral', cohere: 'cohere', ollama: 'ollama', novelai: 'novelai', horde: 'horde', compat: 'openai', openrouter: 'openai', nanogpt: 'openai' };
const TOK = { openai: 'tiktoken', anthropic: 'claude', google: 'gemma', vertex: 'gemma', mistral: 'mistral', cohere: 'cohere', ollama: 'llama', novelai: 'novelai', horde: 'llama', compat: 'auto', openrouter: 'auto', nanogpt: 'auto' };
const FMT_NAME = { openai: 'OpenAI', anthropic: 'Anthropic', google: 'Google', mistral: 'Mistral', cohere: 'Cohere', ollama: 'Ollama', novelai: 'NovelAI', horde: 'Horde' };
const hash = (s) => { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };
function enrich(m) {
  const g = PARAM_G[(m.params || []).join(',')] || 'local';
  const pid = m.pid || PROV_OF[m.prov] || 'compat';
  m.pid = pid; m.g = g;
  let fl = (D_FLAGS[g] || []).slice();
  if (/local|\(로컬\)/.test(m.name) || g === 'local') fl = fl.filter((f) => ['stream', 'sysprompt', 'seed', 'topk', 'minp', 'rep', 'stop', 'bias', 'tools', 'vision'].includes(f)); else fl = fl.filter((f, i) => (hash(m.id + f) % 7) !== 0 || i < 5);
  if (/mini|nano|lite|haiku|flash|small|3b|7b|8b/i.test(m.id)) fl = fl.filter((f) => !['reasoning', 'think', 'audioin', 'videoin', 'search'].includes(f) || hash(m.id + f) % 3 === 0);
  if (/-image|imagen|gpt-image/.test(m.id)) fl.push('imgout');
  if (/llama-local-70b|qwen-local|gemma-local|deepseek|phi|nemo-local/.test(m.id) && !fl.includes('tools')) fl.push('tools');
  if (/deepseek|r1|o3|o4/.test(m.id) && !fl.includes('reasoning')) fl.push('reasoning');
  if (/pixtral|llama-4|gemma-local|qwen-local/.test(m.id) && !fl.includes('vision')) fl.push('vision');
  m.flags = fl;
  const x = hash(m.id) % 5; m.xflags = x === 0 ? ['x-legacy', 'x-beta'] : x === 1 ? ['x-lab'] : [];   // flags this mockup has no phrase for: "기타: n개"
  m.ctx = /^(or-|ng-)/.test(m.id) ? [32000, 128000, 200000, 1000000][hash(m.id) % 4] : (m.id === 'gpt-35-turbo' ? 16000 : (CTX[g] || m.ctx));
  if (/claude-sonnet-45|claude-sonnet-4$/.test(m.id)) m.ctx = 1000000;
  m.maxOut = MAXOUT[g] || 8192; m.format = FMT[pid]; m.tokenizer = TOK[pid];
  m.status = REC.has(m.id) ? 'rec' : UNVER.has(m.id) ? 'unver' : DEPR[m.id] ? 'depr' : '';
  if (DEPR[m.id]) { const [y, mo] = DEPR[m.id]; m.reasonK = `${y}년 ${mo}월에 종료돼요`; m.reasonE = `Retires in ${['', 'January', 'February', 'March', 'April', 'May', 'June', 'July'][mo]} ${y}`; }
  else if (m.status === 'unver') { m.reasonK = '공급자가 알려 준 모델이라 동작을 확인하지 않았어요'; m.reasonE = 'Listed by the provider; behaviour has not been checked'; }
  return m;
}
D.models.forEach(enrich);
// a few more catalog entries that carry the image-generation flag and the pure "long context" case
const more = [
  { id: 'gemini-25-flash-image', name: 'Gemini 2.5 Flash Image', prov: 'Google AI Studio', params: ['temperature', 'top_p', 'top_k'] },
  { id: 'gpt-image-1', name: 'gpt-image-1', prov: 'OpenAI', params: ['temperature', 'top_p', 'frequency_penalty', 'presence_penalty', 'seed'] },
];
more.forEach((m) => { m.en = m.name; m.provEn = m.prov; m.kw = ''; D.models.push(enrich(m)); });
D.models.find((m) => m.id === 'gemini-25-flash-image').flags.push('imgout');
D.models.find((m) => m.id === 'gpt-image-1').flags.push('imgout');

/* OpenRouter and generated models */
const VENDORS = ['meta', 'qwen', 'deepseek', 'mistralai', 'google', 'anthropic', 'openai', 'cohere', 'nvidia', 'microsoft', 'xai', 'moonshot', 'zhipu', 'baidu', 'amazon', 'perplexity'];
const SERIES = ['Aurora', 'Borealis', 'Cascade', 'Delta', 'Ember', 'Fjord', 'Glacier', 'Harbor', 'Island', 'Juniper', 'Kestrel', 'Lagoon', 'Meadow', 'Nimbus', 'Orchid', 'Prairie', 'Quartz', 'Ridge', 'Summit', 'Tundra'];
const SIZES = ['7B', '8B', '14B', '27B', '32B', '70B', '120B', 'Mini', 'Pro', 'Lite', 'Max', 'Turbo'];
let gen = 0;
function genModel(connId, pid, provName, i) {
  const vend = VENDORS[i % VENDORS.length], ser = SERIES[(i * 7) % SERIES.length], sz = SIZES[(i * 5) % SIZES.length], ver = 1 + (i % 4);
  const id = `gen-${++gen}-${vend}-${ser.toLowerCase()}-${sz.toLowerCase()}`;
  const name = `${ser} ${ver} ${sz}`;
  const g = ['claude', 'gpt5', 'gpt4', 'gemini', 'mistral', 'cohere', 'local'][i % 7];
  const prm = Object.keys(PARAM_G).find((k) => PARAM_G[k] === (g === 'claude' ? 'claude' : g === 'gpt5' ? 'gpt5' : g === 'gpt4' ? 'gpt4' : g === 'gemini' ? 'gemini' : g === 'mistral' ? 'gpt4' : g === 'cohere' ? 'cohere' : 'local')).split(',');
  const m = { id, name: `${name} (${vend})`, en: `${name} (${vend})`, prov: provName, provEn: provName, params: prm, kw: '', pid, conn: connId, fetched: true };
  enrich(m); m.pid = pid; if (i % 11 === 0) { m.status = 'unver'; m.reasonK = '공급자가 알려 준 모델이라 동작을 확인하지 않았어요'; m.reasonE = 'Listed by the provider; behaviour has not been checked'; }
  if (i % 17 === 5) { m.status = 'depr'; m.reasonK = '2027년 2월에 종료돼요'; m.reasonE = 'Retires in February 2027'; }
  if (i % 13 === 3) m.status = 'rec';
  return m;
}

/* ------------------------------------------------------------------ connections */
const CX = [], KEYS = {};   // KEYS never leaves this closure: slice3.js takes it once through takeKeys() (R-29)
const T0 = Date.now();
const mkc = (o) => Object.assign({ url: '', format: 'openai', tokenizer: 'auto', region: 'global', project: '', email: '', ollamaFormat: 'native', sub: false, autoFetch: false, test: null, simForce: '', keyState: 'set', models: 0, kw: '' }, o);
const ago = (min) => T0 - min * 60000;
function addC(o, key) { const c = mkc(o); c.kw = (PROV[c.provider].kw || '') + ' ' + c.name; CX.push(c); KEYS[c.id] = key || ''; c.keyState = key ? 'set' : (PROV[c.provider].key === 'key' ? 'none' : 'na'); return c; }   // keyState: set | none (a key is needed) | na (no key needed) | again (restored after a delete: enter it again)
const connByProvider = {};   // first connection per provider: where catalog models of that provider live
function buildDemo() {
  addC({ id: 'c-anthropic', name: 'Anthropic', provider: 'anthropic', test: { res: 'ok', at: ago(3), n: 10, ms: 412 } }, 'fake-key-0000-ant-7f3a');
  addC({ id: 'c-openai', name: 'OpenAI', provider: 'openai', test: { res: 'ok', at: ago(60 * 22), n: 16, ms: 238 } }, 'fake-key-0000-oai-91c2');
  addC({ id: 'c-google', name: 'Google AI Studio', provider: 'google', test: { res: 'badkey', at: ago(60 * 26), n: 0, ms: 190 }, simForce: 'badkey' }, 'fake-key-0000-gem-bad1');
  addC({ id: 'c-openrouter', name: 'OpenRouter', provider: 'openrouter', autoFetch: true, test: { res: 'ok', at: ago(11), n: 84, ms: 655 } }, 'fake-key-0000-rtr-d4e9');
  addC({ id: 'c-company', name: '회사 프록시', provider: 'compat', url: 'https://proxy.company.invalid/v1', format: 'openai', tokenizer: 'tiktoken', test: { res: 'ok', at: ago(40), n: 7, ms: 301 } }, '${COMPANY_KEY}');
  addC({ id: 'c-home', name: '집 서버', provider: 'compat', url: 'http://home.invalid:8080/v1', format: 'openai', tokenizer: 'llama', test: { res: 'unreachable', at: ago(120), n: 0, ms: 0 }, simForce: 'unreachable' }, 'fake-key-0000-home-22aa');
  addC({ id: 'c-ollama', name: 'Ollama', provider: 'ollama', url: 'http://ollama.invalid:11434', test: null }, '');
}
function buildMigrated() {   // DS-060: one connection per distinct address + key, named after the host
  buildDemo();
  const co = CX.find((c) => c.id === 'c-company'), ho = CX.find((c) => c.id === 'c-home'); co.name = 'proxy.company.invalid'; ho.name = 'llm.home.invalid'; co.kw = (PROV.compat.kw || '') + ' ' + co.name; ho.kw = (PROV.compat.kw || '') + ' ' + ho.name;
  addC({ id: 'c-team', name: 'api.team.invalid', provider: 'compat', url: 'https://api.team.invalid/v1', format: 'openai', tokenizer: 'auto', test: null }, 'fake-key-0000-team-5c10');
}
function buildStress() {
  buildDemo();
  const extra = [['openai', 'OpenAI 2'], ['openai', 'OpenAI 팀'], ['anthropic', 'Anthropic 2'], ['google', 'Google 2'], ['vertex', 'Vertex AI'], ['mistral', 'Mistral'], ['cohere', 'Cohere'], ['openrouter', 'OpenRouter 2'], ['nanogpt', 'NanoGPT'], ['compat', '프록시 1'], ['compat', '프록시 2'], ['compat', '프록시 3'], ['ollama', 'Ollama 서재']];
  extra.forEach(([p, nm], i) => addC({ id: 'c-x' + i, name: nm, provider: p, url: PROV[p].url ? `http://x${i}.invalid:11434` : '', test: i % 4 === 1 ? { res: 'quota', at: ago(30 + i), n: 0, ms: 150 } : { res: 'ok', at: ago(5 + i * 9), n: 12 + i, ms: 200 + i * 31 } }, PROV[p].key === 'none' ? '' : `fake-key-0000-s${i}-${(1000 + i * 37).toString(16)}`));
}
if (SET3 === 'demo') buildDemo();
else if (SET3 === 'stress') buildStress();
else if (SET3 === 'migrated') buildMigrated();
else if (SET3 === 'broken') {
  buildDemo();
  CX.splice(CX.findIndex((c) => c.id === 'c-anthropic'), 1); delete KEYS['c-anthropic'];   // the active preset's connection is gone
  const oa = CX.find((c) => c.id === 'c-openai'); KEYS['c-openai'] = ''; oa.keyState = 'none'; oa.test = null;   // another one keyless
}
CX.forEach((c) => { if (!connByProvider[c.provider]) connByProvider[c.provider] = c.id; });
// DS-054 / N-06: the catalog models of a provider belong to no connection; every connection (the first like any other) lists the whole catalog as its own (connection, model) pairs, ids `connection::model`
D.models.forEach((m) => { m.conn = null; });
const catalogOf = (provider) => D.models.filter((m) => !m.custom && !m.clone && !m.fetched && m.pid === provider);
function mkClone(m, c) { const k = Object.assign({}, m, { id: c.id + '::' + m.id, base: m.id, clone: true, conn: c.id }); delete k._iv; delete k._h; delete k._ch; delete k._F; delete k._nm; return k; }
CX.forEach((c) => { catalogOf(c.provider).forEach((m) => D.models.push(mkClone(m, c))); });
// OpenRouter: a large list (demo ~190 models in total, stress 1,500)
const orConn = CX.find((c) => c.provider === 'openrouter');
if (SET3 === 'demo' || SET3 === 'broken') {
  const have = D.models.filter((m) => !m.clone).length;   // the catalog itself; every connection's own pairs come on top
  for (let i = 0; i < 190 - have; i++) D.models.push(genModel(orConn ? orConn.id : null, 'openrouter', 'OpenRouter', i));
} else if (SET3 === 'none') {
  for (let i = 0; i < 70; i++) D.models.push(genModel(null, 'openrouter', 'OpenRouter', i));
} else if (SET3 === 'stress') {
  const total = 1500, have = D.models.length; const pool = CX.filter((c) => PROV[c.provider].list !== false || true);
  for (let i = 0; i < total - have; i++) { const c = pool[i % pool.length]; D.models.push(genModel(c.id, c.provider, PROV[c.provider].en, i)); }
}
CX.forEach((c) => { c.models = D.models.filter((m) => m.conn === c.id).length; });

/* custom models (DS-048): live under their connection, tagged 직접 추가 */
function customM(id, name, connId, ctx, caps, fmt) {
  const base = { id, name, en: name, prov: connId && CX.find((c) => c.id === connId) ? PROV[CX.find((c) => c.id === connId).provider].en : '—', provEn: '', kw: name, params: ['temperature', 'top_p', 'top_k', 'min_p'], pid: connId && CX.find((c) => c.id === connId) ? CX.find((c) => c.id === connId).provider : 'compat', conn: connId, ctx, maxOut: 8192, flags: ['stream', 'sysprompt'].concat(caps), xflags: [], custom: true, status: 'custom', format: fmt || 'openai', tokenizer: 'auto', g: 'local' };
  base.provEn = base.prov; D.models.push(base); return base;
}
const hasC = (id) => CX.some((c) => c.id === id);
if (SET3 === 'demo' || SET3 === 'broken') {
  if (hasC('c-company')) customM('my-llama-tuned', '내 라마 튜닝', 'c-company', 32000, ['tools'], 'openai');
  if (hasC('c-ollama')) customM('phi4-mini-local', 'Phi-4 mini (내 PC)', 'c-ollama', 16000, [], 'ollama');
  if (hasC('c-openrouter')) customM('or-experimental-x', 'OpenRouter 실험 모델', 'c-openrouter', 128000, ['vision', 'tools'], 'openai');
} else if (SET3 === 'stress') {
  for (let i = 0; i < 40; i++) { const c = CX[i % CX.length]; customM('custom-' + (i + 1), '내 모델 ' + (i + 1), c.id, 8000 * (1 + (i % 6)), i % 3 === 0 ? ['tools'] : [], 'openai'); }
}
CX.forEach((c) => { c.models = D.models.filter((m) => m.conn === c.id).length; if (c.test && c.test.res === 'ok') c.test.n = c.models; });   // a stored good check found as many models as the connection lists
const MODEL_ALL = D.models;
// keep the lookup the slice 1 code built from D.models in step (slice1.js builds MODEL after this file runs, so nothing to do here)

/* ------------------------------------------------------------------ search things: connections (named, DS-041) */
D.connections.length = 0;
CX.forEach((c) => D.connections.push({ id: c.id, name: c.name, en: c.name, row: 'models.cx.' + c.id, kw: c.kw }));

/* ------------------------------------------------------------------ rows */
// retired: the Display toggle is gone (keys are always masked); searching for it lands on a note (SLICE3_SPEC section 1)
Object.assign(rowOf('models.hideApiKey'), { type: 'note', ko: 'API 키는 항상 가려져 있어요 · 끝 4자리만 보여요', en: 'API keys are always hidden; only the last 4 characters show' });
['v', 'd', 'desc', 'help', 'scope'].forEach((k) => delete rowOf('models.hideApiKey')[k]);
rowOf('models.hideApiKey').retired = true;
// rows replaced by connection fields: kept (other pages point at them) but never rendered or indexed; v reflects "the connection has a key/address"
const REPLACED = { 'models.openaiKey': 'openai', 'models.claudeKey': 'anthropic', 'models.googleKey': 'google', 'models.vertexProject': 'vertex', 'models.vertexEmail': 'vertex', 'models.vertexKey': 'vertex', 'models.vertexRegion': 'vertex', 'models.awsKey': 'aws', 'models.mistralKey': 'mistral', 'models.cohereKey': 'cohere', 'models.novelaiKey': 'novelai', 'models.novellistKey': 'novellist', 'models.mancerKey': 'mancer', 'models.openrouterKey': 'openrouter', 'models.nanogptKey': 'nanogpt', 'models.nanogptSub': 'nanogpt', 'models.ollamaUrl': 'ollama', 'models.ollamaKey': 'ollama', 'models.ollamaFormat': 'ollama', 'models.proxyUrl': 'compat', 'models.proxyKey': 'compat', 'models.proxyModel': 'compat', 'models.proxyFormat': 'compat', 'models.proxyTokenizer': 'compat', 'models.koboldUrl': 'kobold', 'models.hordeKey': 'horde', 'models.textgenUrl': 'textgen' };
const RETIRED_MODEL_ROWS = ['models.refreshModels', 'models.dynamicRegistry', 'models.customModels'];
Object.keys(REPLACED).concat(RETIRED_MODEL_ROWS).forEach((id) => {
  const r = rowOf(id); if (!r) return;
  const pid = REPLACED[id]; r.retired = true; r.type = 'note'; r.replacedBy = pid || 'models';
  ['v', 'd', 'g', 'scope', 'desc', 'help'].forEach((k) => delete r[k]);
  if (pid) Object.defineProperty(r, 'v', { configurable: true, enumerable: true, get() { return CX.some((c) => c.provider === pid && (KEYS[c.id] || PROV[pid].key !== 'key' || c.url)); } });
});
// the routing / NovelAI / Ooba options stay as plain rows under the list (O-3 stays open); the service credentials (voice, translation, image) wait for slice 5
const OPTION_ROWS = ['models.orOrder', 'models.orOnly', 'models.orIgnore', 'models.orFallback', 'models.orMiddleOut', 'models.naiAdventure', 'models.naiAppendName', 'models.oobaMode', 'models.oobaChatMode', 'models.oobaPrefix'];
const OPTION_PROV = { 'models.orOrder': 'openrouter', 'models.orOnly': 'openrouter', 'models.orIgnore': 'openrouter', 'models.orFallback': 'openrouter', 'models.orMiddleOut': 'openrouter', 'models.naiAdventure': 'novelai', 'models.naiAppendName': 'novelai', 'models.oobaMode': 'textgen', 'models.oobaChatMode': 'textgen', 'models.oobaPrefix': 'textgen' };   // DS-059: these rows live on the detail page of a connection of that provider
const SERVICE_ROWS = ['models.elevenKey', 'models.voicevoxUrl', 'models.fishUrl', 'models.webuiUrl', 'models.comfyUrl', 'models.deeplKey', 'models.deeplFree', 'models.deeplxUrl', 'models.deeplxToken', 'models.waveKey'];
OPTION_ROWS.forEach((id) => { const r = rowOf(id); if (r) delete r.g; });
SERVICE_ROWS.forEach((id) => { const r = rowOf(id); if (r) delete r.g; });
// one models page (DS-044): rows keep their ids; sepModels and the per-task dependencies are retired
Object.assign(rowOf('models.sepModels'), { type: 'note', retired: true });
['v', 'd', 'desc', 'scope'].forEach((k) => delete rowOf('models.sepModels')[k]);
['models.memModel', 'models.transModel', 'models.emoModel', 'models.otherModel'].forEach((id) => { delete rowOf(id).dep; });
{ // DS-051: 자동 제안 is a per-task row of its own (it used to be hidden behind the sub model)
  const emo = rowOf('models.emoModel'); const sug = Object.assign({}, emo, { id: 'models.suggestModel', ko: '자동 제안 모델', en: 'Auto suggest model', syn: 'auto suggest suggestion suggestions 자동 제안 추천 질문 제안 모델 suggest model' }); delete sug.dep; D.rows.splice(D.rows.indexOf(emo) + 1, 0, sug);
}
const LABELS = {
  'models.mainModel': ['주 모델', 'Main model', '주 모델', 'Main model', '채팅에서 답변을 쓰는 모델이에요.', 'The model that writes replies in chat.'],
  'models.subModel': ['보조 모델', 'Sub model', '보조 모델', 'Sub model', '감정 이미지와 자동 제안에 써요. 싸고 빠른 모델을 권해요.', 'Used for emotion images and auto suggest. A cheap, fast model works well.'],
  'models.memModel': ['장기 기억 모델', 'Long-term memory model', '장기 기억', 'Long-term memory', '', ''],
  'models.transModel': ['번역 모델', 'Translation model', '번역', 'Translation', '', ''],
  'models.emoModel': ['감정 이미지 모델', 'Emotion image model', '감정 이미지', 'Emotion images', '', ''],
  'models.suggestModel': ['자동 제안 모델', 'Auto suggest model', '자동 제안', 'Auto suggest', '', ''],
  'models.otherModel': ['그 밖의 기능 모델', 'Other features model', '기타', 'Other features', '', ''],
  'models.fallbackModel': ['대체 모델: 주 모델', 'Fallback models: main model', '주 모델', 'Main model', '', ''],
  'models.fallbackMem': ['대체 모델: 장기 기억', 'Fallback models: long-term memory', '장기 기억', 'Long-term memory', '', ''],
  'models.fallbackTrans': ['대체 모델: 번역', 'Fallback models: translation', '번역', 'Translation', '', ''],
  'models.fallbackEmo': ['대체 모델: 감정 이미지', 'Fallback models: emotion images', '감정 이미지', 'Emotion images', '', ''],
  'models.fallbackOther': ['대체 모델: 기타', 'Fallback models: other features', '기타', 'Other features', '', ''],
};
Object.entries(LABELS).forEach(([id, a]) => { const r = rowOf(id); Object.assign(r, { ko: a[0], en: a[1], short: [a[2], a[3]], desc: a[4] ? a[4] + '|' + a[5] : undefined }); delete r.help; if (!a[4]) delete r.desc; });
// the model rows are rendered by slice 3 itself; their `opt` is an array whose find() resolves a model id to its name on demand, so slice 1 never builds 1,500 <option>s for them
// and the search results still print the model's name as the row's value. (length 1 and a non-empty first value keep isModelSelect() false.)
class ModelOpts extends Array { find(fn) { for (const m of D.models) { const o = [m.id, m.name, m.en || m.name]; if (fn(o)) return o; } return undefined; } }
['models.mainModel', 'models.subModel', 'models.memModel', 'models.transModel', 'models.emoModel', 'models.suggestModel', 'models.otherModel', 'models.fallbackModel', 'models.fallbackMem', 'models.fallbackTrans', 'models.fallbackEmo', 'models.fallbackOther'].forEach((id) => { const o = new ModelOpts(); o.push(['*', '', '']); rowOf(id).opt = o; });
// the fallback rows hold an ordered list as a comma-joined string (immutable, so slice 2's undo and save handle it like any other value)
['models.fallbackModel', 'models.fallbackMem', 'models.fallbackTrans', 'models.fallbackEmo', 'models.fallbackOther'].forEach((id) => { rowOf(id).fb = true; });
Object.assign(rowOf('models.fallbackBlank'), { ko: '빈 답변이면 다음 모델로', en: 'Move to the next model on a blank reply', desc: '대체 모델 목록에서 다음 모델로 넘어가요|Moves on to the next model in the fallback list' });
// 재시도 횟수 moves here from Advanced; it is a device setting, not a preset value, so it has its own row type (slice 2 only versions editable preset rows)
{
  const r = rowOf('adv.retries'); r.type = 'stepper'; r.sec = 'models.models'; r.page = 'models'; r.ko = '재시도 횟수'; r.en = 'Retries'; r.syn = (r.syn || '') + ' requestRetrys 모델마다 재시도 실패하면 다시 요청 retry'; r.desc = '요청이 실패하면 모델마다 몇 번 더 시도할지 정해요|How many more times each model is tried when a request fails'; r.min = 0; r.max = 20; delete r.help;
}
// the model shortcut gets its own section next to the preset slot keys
D.SECTIONS.splice(D.SECTIONS.findIndex((s) => s.id === 'keys.main'), 0, { page: 'keys', id: 'keys.model', ko: '모델 선택 단축키', en: 'Model shortcut' });
Object.assign(rowOf('keys.modelSelect'), { sec: 'keys.model', syn: 'hotkey 핫키 shortcut keyboard modelSelect 모델 고르기 모델 바꾸기 picker ctrl m' });
D.PAGES.find((p) => p.id === 'models').later = ['슬라이스 4: 파라미터', 'slice 4: parameters'];
// slice 3 values: per-task rows start empty ("주 모델과 같음"), one override, two fallback lists
const setv = (id, v) => { const r = rowOf(id); r.v = v; r.d = v; };
setv('models.mainModel', 'claude-sonnet-45'); setv('models.subModel', 'gpt-5-mini');
setv('models.memModel', ''); setv('models.transModel', ''); setv('models.emoModel', ''); setv('models.suggestModel', ''); setv('models.otherModel', '');
setv('models.fallbackModel', ''); setv('models.fallbackMem', ''); setv('models.fallbackTrans', ''); setv('models.fallbackEmo', ''); setv('models.fallbackOther', '');
// a few presets use the other connections, so every connection in the demo is in use by someone (and the delete dialog has real users to list)
if (SET3 === 'demo' || SET3 === 'broken' || SET3 === 'stress') {
  const orM = D.models.filter((m) => m.clone && /^or-/.test(m.base) && m.conn === connByProvider.openrouter && !m.status).map((m) => m.id);
  D.presets.forEach((p, i) => { if (i % 12 === 5 && orM.length) p.model = orM[(i / 12 | 0) % orM.length]; else if (i % 12 === 8) p.model = 'rp-custom-' + (1 + ((i / 12 | 0) % 4)); else if (i % 12 === 10 && hasC('c-home')) p.model = 'c-home::rp-custom-' + (7 + ((i / 12 | 0) % 2)); });
}
{ const p1 = D.presets.find((p) => p.id === 'p1'); if (p1) { p1.vals['models.transModel'] = 'claude-haiku-45'; p1.vals['models.fallbackModel'] = 'gpt-41,gemini-25-flash'; p1.vals['models.fallbackTrans'] = 'gpt-5-mini'; } }   // the active preset: one per-task override and two fallback lists
['models.mainModel', 'models.subModel', 'models.memModel', 'models.transModel', 'models.emoModel', 'models.suggestModel', 'models.otherModel', 'models.fallbackModel', 'models.fallbackMem', 'models.fallbackTrans', 'models.fallbackEmo', 'models.fallbackOther'].forEach((id) => { delete rowOf(id).d; });   // no "changed from default" dot on model rows
// request retries: the device default
{ const r = rowOf('adv.retries'); r.v = 2; delete r.d; }

/* fixture values are pairs too: a plain catalog id in a preset or row means "that model on the first connection of its provider" (only here, in the fixtures; the app never reads a plain id that way) */
const pairOf = (id) => { if (!id || String(id).indexOf('::') >= 0) return id; const m = D.models.find((x) => x.id === id && !x.clone); const c = m && connByProvider[m.pid]; return c ? c + '::' + id : id; };
const mapList = (v) => String(v || '').split(',').filter(Boolean).map(pairOf).join(',');
const MROWS = ['models.mainModel', 'models.subModel', 'models.memModel', 'models.transModel', 'models.emoModel', 'models.suggestModel', 'models.otherModel', 'models.fallbackModel', 'models.fallbackMem', 'models.fallbackTrans', 'models.fallbackEmo', 'models.fallbackOther'];
MROWS.forEach((id) => { const r = rowOf(id); r.v = mapList(r.v); });
D.presets.forEach((p) => { p.model = pairOf(p.model); MROWS.forEach((id) => { if (p.vals && id in p.vals) p.vals[id] = mapList(p.vals[id]); }); });
let keysOnce = KEYS;
const takeKeys = () => { const k = keysOnce; keysOnce = null; delete window.SS3_DATA.takeKeys; return k; };   // R-29: the fixture secrets are handed to slice3.js once and are in no page global afterwards
window.SS3_DATA = { SET3, FLAGS, FLAG, PROVIDERS, PROV, PGROUPS, FORMATS, TOKENIZERS, CX, takeKeys, mkClone, catalogOf, pairOf, connByProvider, OPTION_PROV, REPLACED, OPTION_ROWS, SERVICE_ROWS, RETIRED_MODEL_ROWS, genModel, enrich, T0, hash, FMT_NAME, MODEL_ALL, customM };
})();
