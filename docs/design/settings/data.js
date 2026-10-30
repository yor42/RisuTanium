/* Settings slice 1: synthetic catalog (rows) and named things. Synthetic mockup data; nothing here is read from or written to the real app.
   KO/EN labels come from src/lang/ko.ts and en.ts where the key exists (read through checks/tools/extract-labels.mjs); the rest are authored for the mockup.
   Keys and URLs are fake (fake-key-0000, .invalid). Preset, persona, plugin and module names are invented. */
(() => {
'use strict';
const rows = [];
let cur = '';
const sec = (id) => { cur = id; };
function add(type, id, ko, en, o) { rows.push(Object.assign({ type, id, sec: cur, page: cur.split('.')[0], ko, en }, o || {})); }
const opts = (s) => s.split(';').map((p) => { const i = p.indexOf(':'); const v = p.slice(0, i); const l = p.slice(i + 1).split('|'); return [v, l[0], l[1] || l[0]]; });
const sw = (id, ko, en, d, o) => add('switch', id, ko, en, Object.assign({ d, v: d }, o));
const se = (id, ko, en, d, op, o) => add('select', id, ko, en, Object.assign({ d, v: d, opt: opts(op) }, o));
const sg = (id, ko, en, d, op, o) => add('segmented', id, ko, en, Object.assign({ d, v: d, opt: opts(op) }, o));
const sl = (id, ko, en, d, r, o) => add('slider', id, ko, en, Object.assign({ d, v: d, min: r[0], max: r[1], step: r[2], unit: r[3] || '' }, o));
const nu = (id, ko, en, d, r, o) => add('number', id, ko, en, Object.assign({ d, v: d, min: r[0], max: r[1] }, o));
const tx = (id, ko, en, d, o) => add('text', id, ko, en, Object.assign({ d, v: d }, o));
const sk = (id, ko, en, d, o) => add('secret', id, ko, en, Object.assign({ d, v: d }, o));
const ta = (id, ko, en, d, o) => add('textarea', id, ko, en, Object.assign({ d, v: d }, o));
const bt = (id, ko, en, icon, o) => add('button', id, ko, en, Object.assign({ icon }, o));
const lk = (id, ko, en, kind, ref, o) => add('link', id, ko, en, Object.assign({ kind, ref }, o));
const nv = (id, ko, en, target, o) => add('nav', id, ko, en, Object.assign({ target }, o));
const kb = (id, ko, en, combo, o) => add('key', id, ko, en, Object.assign({ combo }, o));
const nt = (id, ko, en, o) => add('note', id, ko, en, o);

const SECTIONS = [
  // page, id, ko, en
  ['models', 'models.models', '모델', 'Models'], ['models', 'models.params', '파라미터', 'Parameters'], ['models', 'models.presets', '프리셋', 'Presets'], ['models', 'models.connections', '연결', 'Connections'], ['models', 'models.prompt', '프롬프트 설정', 'Prompt settings'],
  ['chatfeat', 'chatfeat.memory', '장기 기억', 'Long-term memory'], ['chatfeat', 'chatfeat.voice', '음성', 'Voice'], ['chatfeat', 'chatfeat.emotion', '감정 이미지', 'Emotion images'], ['chatfeat', 'chatfeat.imagegen', '이미지 생성', 'Image generation'], ['chatfeat', 'chatfeat.translate', '번역', 'Translation'],
  ['display', 'display.theme', '테마', 'Theme'], ['display', 'display.font', '글꼴·크기', 'Fonts & size'], ['display', 'display.chat', '채팅 표시', 'Chat display'], ['display', 'display.lowpower', '저전력·움직임', 'Low power & motion'],
  ['input', 'input.send', '보내기·편집', 'Sending & editing'], ['input', 'input.gestures', '제스처', 'Gestures'], ['input', 'input.a11y', '접근성', 'Accessibility'], ['input', 'input.menu', '메뉴·사이드바', 'Menu & sidebar'],
  ['lang', 'lang.app', '앱 언어', 'App language'],
  ['persona', 'persona.main', '', ''],
  ['ext', 'ext.plugins', '플러그인', 'Plugins'], ['ext', 'ext.modules', '모듈', 'Modules'], ['ext', 'ext.pluginpages', '플러그인 설정 화면', 'Plugin-defined pages'],
  ['data', 'data.backup', '백업', 'Backup'], ['data', 'data.storage', '저장 공간', 'Storage'],
  ['keys', 'keys.main', '', ''],
  ['adv', 'adv.request', '요청', 'Requests'], ['adv', 'adv.lorebook', '로어북', 'Lorebook'], ['adv', 'adv.features', '메뉴에 보일 기능', 'Features in menus'], ['adv', 'adv.experimental', '실험적 기능', 'Experimental'], ['adv', 'adv.dev', '개발', 'Development'],
].map(([page, id, ko, en]) => ({ page, id, ko, en }));

const PAGES = [
  { id: 'models', icon: 'cpu', ko: '모델·프리셋', en: 'Models & presets', later: ['슬라이스 2–4: 프리셋·연결·파라미터', 'slices 2-4: presets, connections, parameters'], syn: '채팅 봇 채팅봇 chat bot model 모델 모델 설정 preset prompt template 프롬프트 템플릿 easy panel 쉬운 설정' },
  { id: 'chatfeat', icon: 'message-square', ko: '대화 기능', en: 'Chat features', later: ['슬라이스 5', 'slice 5'], syn: '다른 봇 기타 봇 other bots auxiliary 보조 hypa memory tts emotion image generation translator' },
  { id: 'display', icon: 'palette', ko: '화면·읽기', en: 'Display & reading', syn: '디스플레이 소리 및 디스플레이 display & audio theme 화면 appearance' },
  { id: 'input', icon: 'hand', ko: '입력·접근성', en: 'Input & accessibility', syn: '접근성 accessibility 입력 input keyboard gestures 사이드바 sidebar' },
  { id: 'lang', icon: 'languages', ko: '언어', en: 'Language', syn: 'language 로캘 locale ui 언어' },
  { id: 'persona', icon: 'user-round', ko: '페르소나', en: 'Personas', later: ['슬라이스 5', 'slice 5'], syn: 'persona 사용자 user profile' },
  { id: 'ext', icon: 'puzzle', ko: '확장', en: 'Extensions', later: ['슬라이스 5', 'slice 5'], syn: 'plugin 플러그인 module 모듈 확장 기능 extensions mcp' },
  { id: 'data', icon: 'database', ko: '데이터·백업', en: 'Data & backup', syn: '백업 & 파일 backup and files storage 저장 공간 export import 내보내기' },
  { id: 'keys', icon: 'keyboard', ko: '단축키', en: 'Shortcuts', later: ['슬라이스 5', 'slice 5'], syn: 'hotkey 핫키 keyboard shortcut 키보드' },
  { id: 'adv', icon: 'sliders-horizontal', ko: '고급', en: 'Advanced', syn: '고급 설정 advanced settings 개발자 developer' },
];

/* ---------------------------------------------------------------- 1 모델·프리셋 */
sec('models.connections');
sw('models.hideApiKey', 'API 키 숨기기', 'Hide API keys', false, { desc: '키 입력칸을 가려요|Masks the key fields', syn: 'hide api key hideApiKeys 키 숨기기 API key hide 디스플레이 display' , scope: 'device' });
nt('models.envNote', '키 대신 ${이름} 형식으로 환경 변수를 쓸 수 있어요', 'You can use ${NAME} instead of a key to read an environment variable', { syn: 'environment variable env 환경 변수' });
sk('models.openaiKey', 'OpenAI 키', 'OpenAI key', 'fake-key-0000-openai', { syn: 'openai api key gpt', help: 'TTS와 이미지 생성도 이 키를 써요. 여기서만 바꿔요.|TTS and image generation use this key too. Change it only here.' });
sk('models.claudeKey', 'Anthropic 키', 'Anthropic key', 'fake-key-0000-claude', { syn: 'claude api key anthropic' });
sk('models.googleKey', 'Google AI Studio 키', 'Google AI Studio key', 'fake-key-0000-gemini', { syn: 'gemini google cloud api key' });
tx('models.vertexProject', 'Vertex AI 프로젝트 ID', 'Vertex AI project ID', 'demo-project-0000', { syn: 'vertex google cloud' });
tx('models.vertexEmail', 'Vertex AI 클라이언트 이메일', 'Vertex AI client email', 'svc@demo.invalid', { syn: 'vertex client email service account' });
sk('models.vertexKey', 'Vertex AI 개인 키', 'Vertex AI private key', 'fake-key-0000-vertex', { syn: 'vertex private key' });
se('models.vertexRegion', 'Vertex AI 지역', 'Vertex AI region', 'global', 'global:global;us-central1:us-central1;us-west1:us-west1', { syn: 'vertex region' });
sk('models.awsKey', 'AWS 키 (Claude)', 'AWS key (Claude)', '', { syn: 'aws bedrock claude' });
sk('models.mistralKey', 'Mistral 키', 'Mistral key', '', { syn: 'mistral api key' });
sk('models.cohereKey', 'Cohere 키', 'Cohere key', '', { syn: 'cohere api key' });
sk('models.novelaiKey', 'NovelAI 토큰', 'NovelAI token', 'fake-key-0000-nai', { syn: 'novelai bearer token' });
sk('models.novellistKey', 'NovelList 키', 'NovelList key', '', { syn: 'novellist' });
sk('models.mancerKey', 'Mancer 키', 'Mancer key', '', { syn: 'mancer header' });
sk('models.openrouterKey', 'OpenRouter 키', 'OpenRouter key', 'fake-key-0000-router', { syn: 'openrouter api key' });
sk('models.nanogptKey', 'NanoGPT 키', 'NanoGPT key', '', { syn: 'nanogpt api key' });
sw('models.nanogptSub', 'NanoGPT 구독 사용', 'Use NanoGPT subscription', false, { syn: 'nanogpt subscription endpoint' });
tx('models.ollamaUrl', 'Ollama 서버 주소', 'Ollama server URL', 'http://ollama.invalid:11434', { syn: 'ollama local url 로컬 서버' });
sk('models.ollamaKey', 'Ollama 키 (선택)', 'Ollama key (optional)', '', { syn: 'ollama cloud api key' });
se('models.ollamaFormat', 'Ollama 요청 형식', 'Ollama request format', 'native', 'native:Ollama|Ollama;openai:OpenAI 호환|OpenAI compatible', { syn: 'ollama format' });
tx('models.proxyUrl', '리버스 프록시 주소', 'Reverse proxy URL', 'https://proxy.invalid/v1', { scope: 'preset', syn: 'reverse proxy 역방향 프록시 url custom endpoint' });
sk('models.proxyKey', '프록시 키', 'Proxy key', 'fake-key-0000-proxy', { scope: 'preset', syn: 'reverse proxy key' });
tx('models.proxyModel', '요청 모델 이름', 'Request model name', 'my-model', { scope: 'preset', syn: 'reverse proxy request model' });
se('models.proxyFormat', '요청 형식', 'Request format', 'openai', 'openai:OpenAI 호환|OpenAI compatible;response:Responses API|Responses API;anthropic:Anthropic|Anthropic;mistral:Mistral|Mistral;google:Google Cloud|Google Cloud;cohere:Cohere|Cohere', { scope: 'preset', syn: 'reverse proxy request format customAPIFormat' });
se('models.proxyTokenizer', '토크나이저', 'Tokenizer', 'auto', 'auto:자동|Automatic;tiktoken:tiktoken|tiktoken;llama:LLaMA|LLaMA;gemma:Gemma|Gemma', { scope: 'preset', syn: 'tokenizer custom tokenizer' });
sw('models.oobaMode', 'Ooba 모드', 'Ooba mode', false, { scope: 'preset', syn: 'ooba oobabooga textgen' });
tx('models.koboldUrl', 'Kobold 주소', 'Kobold URL', 'http://kobold.invalid:5001', { syn: 'koboldcpp kobold url' });
sk('models.hordeKey', 'Horde 키', 'Horde key', '0000000000', { syn: 'horde api key stable horde' });
tx('models.textgenUrl', 'textgen WebUI 주소', 'textgen WebUI URL', 'http://textgen.invalid:5000', { syn: 'text generation webui ooba url' });

sec('models.models');
se('models.mainModel', '주 모델', 'Main model', 'claude-sonnet-45', '', { scope: 'preset', help: '채팅에서 답변을 쓰는 모델이에요.|The model that writes replies in chat.', syn: 'model 모델 선택 ai model aiModel' });
se('models.subModel', '보조 모델', 'Sub model', 'gpt-5-mini', '', { scope: 'preset', help: '감정 이미지와 자동 제안에 쓰는 모델이에요. 싸고 빠른 모델을 권해요.|Used for emotion images and auto suggest. A cheap, fast model works well.', syn: 'sub model 서브 모델 subModel' });
bt('models.refreshModels', '모델 목록 새로고침', 'Refresh model list', 'refresh-cw', { syn: 'model data refresh 모델 데이터 갱신' });
sw('models.dynamicRegistry', '동적 모델 레지스트리', 'Dynamic model registry', false, { help: '시작할 때 내 API 키로 Google, Anthropic, OpenAI의 모델 목록을 가져와요.|Fetches the model lists of Google, Anthropic and OpenAI with your key at start-up.', syn: 'dynamic model registry 고급 advanced' });
bt('models.customModels', '커스텀 모델 관리', 'Manage custom models', 'sliders', { syn: 'custom models 커스텀 모델 고급 advanced' });
sw('models.sepModels', '기능별 모델 따로 쓰기', 'Use separate models per feature', false, { scope: 'preset', syn: 'separate models aux 보조 모델 분리 seperateModelsForAxModels auxModelUnderModelSettings 보조 모델 분리를 모델 설정에 표시' , desc: '켜면 아래 기능마다 다른 모델을 골라요|When on, pick a different model for each feature below' });
se('models.memModel', '장기 기억 모델', 'Long-term memory model', 'gpt-5-mini', '', { scope: 'preset', syn: 'memory model hypa' });
se('models.transModel', '번역 모델', 'Translation model', 'gpt-5-mini', '', { scope: 'preset', syn: 'translation model translator' });
se('models.emoModel', '감정 이미지 모델', 'Emotion image model', 'gpt-5-mini', '', { scope: 'preset', syn: 'emotion model' });
se('models.otherModel', '그 밖의 기능 모델', 'Other features model', 'gpt-5-mini', '', { scope: 'preset', syn: 'other ax model otherAx' });
se('models.fallbackModel', '대체 모델', 'Fallback model', '', '', { scope: 'preset', syn: 'fallback models 폴백', help: '주 모델이 실패하면 이 모델로 다시 시도해요.|If the main model fails, the request is retried with this model.' });
sw('models.fallbackBlank', '빈 응답이면 대체 모델로 넘어가기', 'Switch to the fallback model on a blank reply', false, { scope: 'preset', syn: 'fallbackWhenBlankResponse' });
sw('models.streaming', '스트리밍', 'Streaming', true, { syn: 'stream useStreaming 실시간 출력' });

sec('models.params');
nu('models.maxContext', '최대 컨텍스트 크기', 'Max context size', 16000, [0, 2000000], { scope: 'preset', syn: 'max context tokens 토큰 컨텍스트 길이', desc: '프롬프트로 보낼 수 있는 토큰 수예요|How many tokens a prompt may hold' });
nu('models.maxResponse', '최대 응답 크기', 'Max response size', 1024, [0, 2048], { scope: 'preset', syn: 'max response tokens 응답 길이 max output', v: 1500 });
nu('models.seed', '시드', 'Seed', -1, [-1, 999999], { scope: 'preset', needs: 'seed', syn: 'seed random generationSeed' });
sl('models.temperature', '온도', 'Temperature', 1, [0, 2, 0.01], { scope: 'preset', needs: 'temperature', syn: 'temperature randomness 무작위성 창의성', help: '높을수록 답변이 다양하고 예측하기 어려워요. 낮으면 일관돼요.|Higher values make replies more varied and less predictable. Lower is steadier.', v: 0.8 });
sl('models.topP', 'Top P', 'Top P', 1, [0, 1, 0.01], { scope: 'preset', needs: 'top_p', syn: 'top p nucleus sampling' });
sl('models.topK', 'Top K', 'Top K', 40, [0, 100, 1], { scope: 'preset', needs: 'top_k', syn: 'top k sampling' });
sl('models.minP', 'Min P', 'Min P', 0, [0, 1, 0.01], { scope: 'preset', needs: 'min_p', syn: 'min p' });
sl('models.topA', 'Top A', 'Top A', 0, [0, 1, 0.01], { scope: 'preset', needs: 'top_a', syn: 'top a' });
sl('models.repPenalty', '반복 패널티', 'Repetition penalty', 1, [0, 2, 0.01], { scope: 'preset', needs: 'repetition_penalty', syn: 'repetition penalty 반복 억제' });
sl('models.freqPenalty', '빈도 패널티', 'Frequency penalty', 0, [-2, 2, 0.01], { scope: 'preset', needs: 'frequency_penalty', syn: 'frequency penalty frequence' });
sl('models.presPenalty', '존재 패널티', 'Presence penalty', 0, [-2, 2, 0.01], { scope: 'preset', needs: 'presence_penalty', syn: 'presence penalty presense 프리센스 패널티' });
sg('models.reasoningEffort', '추론 수준', 'Reasoning effort', 'medium', 'minimal:최소|Minimal;low:낮음|Low;medium:보통|Medium;high:높음|High', { scope: 'preset', needs: 'reasoning_effort', syn: 'reasoning effort thinking 생각 수준' });
sg('models.verbosity', '답변 길이 성향', 'Verbosity', 'medium', 'low:짧게|Low;medium:보통|Medium;high:길게|High', { scope: 'preset', needs: 'verbosity', syn: 'verbosity 장황함' });
sg('models.thinkingType', '사고 모드', 'Thinking mode', 'off', 'off:끔|Off;on:켬|On;adaptive:적응형|Adaptive', { scope: 'preset', needs: 'thinking', syn: 'thinking mode claude extended thinking 사고' });
sl('models.thinkingTokens', '사고 토큰', 'Thinking tokens', 4096, [0, 64000, 200], { scope: 'preset', needs: 'thinking', syn: 'thinking tokens budget' });
sw('models.sepParams', '기능별 파라미터 따로 쓰기', 'Use separate parameters per feature', false, { scope: 'preset', syn: 'separate parameters seperateParametersEnabled 분리된 파라미터' });
bt('models.addParams', '추가 파라미터 편집', 'Edit additional parameters', 'plus', { syn: 'additional params additionalParams 추가 매개변수' });
sw('models.applyAddParamsAll', '추가 파라미터를 모든 모델에 적용', 'Apply additional parameters to all models', false, { syn: 'applyAdditionalParamsToAll 모든 모델에 추가 매개변수 적용' });

sec('models.presets');
sw('models.showCompare', '프리셋 비교 보이기', 'Show preset comparison', false, { syn: 'showPromptComparison compare diff 비교' });
tx('models.presetChain', '프리셋 체인', 'Preset chain', '', { desc: '이름을 쉼표로 이으면 메시지마다 무작위로 프리셋을 바꿔요|Names separated by commas switch the preset at random on every message', help: '비어 있지 않으면 메시지를 보낼 때마다 이 목록의 프리셋이 무작위로 적용돼요. 이름이 바뀌면 체인도 어긋나요.|When not empty, a preset from this list is applied at random on every send. Renaming a preset breaks the chain.', syn: 'preset chain presetChain random 무작위 프리셋' });
sw('models.keepAuxOnSwitch', '프리셋을 바꿔도 보조 모델 유지', 'Keep auxiliary models when switching preset', false, { syn: 'doNotChangeSeperateModels 유지 lock' });
sw('models.keepFallbackOnSwitch', '프리셋을 바꿔도 대체 모델 유지', 'Keep fallback models when switching preset', false, { syn: 'doNotChangeFallbackModels 유지 lock' });
sw('models.keepParamsOnSwitch', '프리셋을 바꿔도 기능별 파라미터 유지', 'Keep separate parameters when switching preset', false, { syn: 'disableSeperateParameterChangeOnPresetChange 프리셋 변경 시 매개변수 분리 변경 비활성화', desc: '켜면 프리셋을 바꿔도 기능별 파라미터가 그대로예요|When on, a preset switch leaves the per-feature parameters as they are' });
nt('models.quickPresetNote', 'Ctrl+1~9로 앞의 프리셋 9개를 바로 바꿀 수 있어요', 'Ctrl+1 to 9 switch to the first nine presets', { syn: 'quick preset 빠르게 변경 단축키 shortcut ctrl' });

sec('models.prompt');
ta('models.mainPrompt', '메인 프롬프트', 'Main prompt', '당신은 이야기를 함께 쓰는 동료예요.', { scope: 'preset', syn: 'main prompt system prompt 시스템 프롬프트', help: '모델의 기본 방향을 정하는 프롬프트예요.|The prompt that sets the model’s general direction.' });
ta('models.jailbreak', '탈옥 프롬프트', 'Jailbreak prompt', '', { scope: 'preset', syn: 'jailbreak ujb' });
ta('models.globalNote', '글로벌 노트', 'Global note', '', { scope: 'preset', syn: 'global note ujb', help: '모델에 강한 영향을 주는 프롬프트예요.|A prompt that strongly influences the model.' });
lk('models.editBlocks', '프롬프트 블록 편집', 'Edit prompt blocks', 'preset', 'ACTIVE', { sk: 'advanced', desc: '순서와 블록 내용은 스튜디오에서 바꿔요|Order and block text are edited in Studio', syn: 'prompt template 프롬프트 템플릿 blocks 순서 formatting order 포맷 순서' });
lk('models.editRegex', '프리셋 정규식 편집', 'Edit preset regex', 'preset', 'ACTIVE', { syn: 'regex 정규식 scripts' });
se('models.systemRole', '시스템 역할 대체', 'System role replacement', 'system', 'system:시스템|System;user:사용자|User;assistant:어시스턴트|Assistant', { scope: 'preset', syn: 'system role replacement' });
sw('models.jsonSchema', 'JSON 스키마 사용', 'Use JSON schema', false, { scope: 'preset', syn: 'json schema structured output' });
ta('models.jsonSchemaText', 'JSON 스키마', 'JSON schema', '', { scope: 'preset', syn: 'json schema text' });
ta('models.groupTemplate', '그룹 채팅 템플릿', 'Group chat template', '', { scope: 'preset', syn: 'group chat template 그룹 템플릿' });
sw('models.autoSuggest', '자동 제안', 'Auto suggest', false, { help: '내가 쓸 답변 후보를 보조 모델이 미리 만들어 줘요.|The sub model drafts replies you could send.', syn: 'auto suggest 제안 suggestion choices' });
ta('models.suggestPrompt', '자동 제안 프롬프트', 'Auto suggest prompt', '', { scope: 'preset', syn: 'suggest prompt' });

/* ---------------------------------------------------------------- 2 대화 기능 */
sec('chatfeat.memory');
se('chatfeat.memType', '장기 기억 방식', 'Long-term memory type', 'hypav3', 'none:사용 안 함|None;supa:SupaMemory|SupaMemory;hanurai:HanuraiMemory|HanuraiMemory;hypav2:HypaMemory V2|HypaMemory V2;hypav3:HypaMemory V3|HypaMemory V3', { syn: 'long term memory 장기기억 hypa supa hanurai other bots 다른 봇' });
se('chatfeat.memPreset', 'HypaMemory 프리셋', 'HypaMemory preset', 'default', 'default:기본|Default;fast:빠르게|Fast;deep:깊게|Deep', { syn: 'hypa v3 preset' });
sl('chatfeat.memRatio', '기억 비율', 'Memory ratio', 20, [0, 100, 1, '%'], { syn: 'memory ratio supa chunk 비율' });
nu('chatfeat.memChunk', '요약 묶음 크기', 'Summary chunk size', 1000, [100, 8000], { syn: 'chunk size 청크' });
nu('chatfeat.memRecent', '최근 대화 유지 개수', 'Recent messages to keep', 6, [0, 100], { syn: 'recent messages keep' });
se('chatfeat.memEmbed', '임베딩 모델', 'Embedding model', 'minilm', 'minilm:MiniLM|MiniLM;bge:BGE 소형|BGE small;openai:OpenAI 임베딩|OpenAI embedding', { syn: 'embedding model vector' });
sl('chatfeat.memSim', '유사도 기준', 'Similarity threshold', 0.75, [0, 1, 0.01], { syn: 'similarity threshold' });
sw('chatfeat.memAuto', '자동 요약', 'Summarize automatically', true, { syn: 'auto summarize hypa 자동 요약' });
ta('chatfeat.memPrompt', '요약 프롬프트', 'Summary prompt', '이야기의 핵심을 짧게 요약해 주세요.', { syn: 'summary prompt supa prompt' });
sw('chatfeat.memRemovePunct', '구두점 제거 후 검색', 'Remove punctuation before searching', false, { syn: 'removePunctuationHypa' });
sw('chatfeat.memLimit', '기억 한계선 보이기', 'Show memory limit', false, { syn: 'showMemoryLimit 기억 한계치 보이기 display 디스플레이' });
sl('chatfeat.memLimitThickness', '기억 한계선 두께', 'Memory limit thickness', 2, [1, 8, 1, 'px'], { syn: 'memoryLimitThickness' });

sec('chatfeat.voice');
se('chatfeat.ttsEngine', '음성 엔진', 'Voice engine', 'browser', 'none:사용 안 함|None;browser:브라우저|Browser;elevenlabs:ElevenLabs|ElevenLabs;openai:OpenAI|OpenAI;voicevox:VOICEVOX|VOICEVOX;fish:Fish Speech|Fish Speech;vits:VITS|VITS', { syn: 'tts text to speech 읽어 주기 other bots 다른 봇' });
sk('chatfeat.elevenKey', 'ElevenLabs 키', 'ElevenLabs key', '', { syn: 'elevenlabs api key' });
se('chatfeat.elevenVoice', 'ElevenLabs 음성', 'ElevenLabs voice', 'rachel', 'rachel:Rachel|Rachel;adam:Adam|Adam;mina:Mina|Mina', { syn: 'elevenlabs voice' });
se('chatfeat.openaiVoice', 'OpenAI 음성', 'OpenAI voice', 'alloy', 'alloy:alloy|alloy;echo:echo|echo;nova:nova|nova;shimmer:shimmer|shimmer', { syn: 'openai tts voice' });
tx('chatfeat.voicevoxUrl', 'VOICEVOX 주소', 'VOICEVOX URL', 'http://voicevox.invalid:50021', { syn: 'voicevox url' });
se('chatfeat.voicevoxSpeaker', 'VOICEVOX 화자', 'VOICEVOX speaker', '1', '1:화자 1|Speaker 1;2:화자 2|Speaker 2;3:화자 3|Speaker 3', { syn: 'voicevox speaker' });
tx('chatfeat.fishUrl', 'Fish Speech 주소', 'Fish Speech URL', '', { syn: 'fish speech url' });
sl('chatfeat.ttsSpeed', '읽는 속도', 'Speaking speed', 1, [0.5, 2, 0.1, '×'], { syn: 'tts speed rate 속도' });
sw('chatfeat.ttsAuto', '새 답변을 자동으로 읽어 주기', 'Read new replies aloud automatically', false, { syn: 'auto play tts autoplay 자동 재생' });
sw('chatfeat.ttsSplit', '문장 단위로 나눠 읽기', 'Read sentence by sentence', true, { syn: 'sentence split' });
sw('chatfeat.ttsSkipCode', '코드 블록 건너뛰기', 'Skip code blocks', true, { syn: 'skip code' });

sec('chatfeat.emotion');
se('chatfeat.emoMethod', '감정 판별 방식', 'Emotion detection', 'llm', 'none:사용 안 함|None;classify:분류 모델|Classifier;llm:보조 모델|Sub model', { syn: 'emotion method emotion image 감정 이미지 other bots' });
ta('chatfeat.emoPrompt', '감정 프롬프트', 'Emotion prompt', '', { help: '감정을 고를 때 보조 모델에 보내는 프롬프트예요.|The prompt sent to the sub model to choose an emotion.', syn: 'emotion prompt emoPrompt' });
tx('chatfeat.emoDefault', '기본 감정', 'Default emotion', 'neutral', { syn: 'default emotion' });
sw('chatfeat.emoShow', '채팅에 감정 이미지 표시', 'Show emotion images in chat', true, { syn: 'show emotion image' });
sl('chatfeat.emoSize', '감정 이미지 크기', 'Emotion image size', 100, [30, 200, 5, '%'], { syn: 'emotion image size' });
sw('chatfeat.emoCache', '감정 판별 결과 캐시', 'Cache emotion results', true, { syn: 'cache emotion' });
sw('chatfeat.emoSticker', '스티커형 이미지 허용', 'Allow sticker-style images', false, { syn: 'sticker chat sticker useChatSticker' });

sec('chatfeat.imagegen');
se('chatfeat.imgProvider', '이미지 생성 서비스', 'Image generation service', 'none', 'none:사용 안 함|None;webui:Stable Diffusion WebUI|Stable Diffusion WebUI;novelai:NovelAI|NovelAI;comfyui:ComfyUI|ComfyUI;openai:OpenAI 이미지|OpenAI images;wavespeed:WaveSpeed|WaveSpeed', { syn: 'image generation provider sd webui stable diffusion 이미지 생성 other bots' });
tx('chatfeat.imgWebuiUrl', 'WebUI 주소', 'WebUI URL', 'http://webui.invalid:7860', { syn: 'webui url automatic1111' });
nu('chatfeat.imgSteps', '스텝 수', 'Steps', 28, [1, 150], { syn: 'steps sampling steps' });
sl('chatfeat.imgCfg', 'CFG 스케일', 'CFG scale', 7, [1, 30, 0.5], { syn: 'cfg scale guidance' });
se('chatfeat.imgSampler', '샘플러', 'Sampler', 'euler_a', 'euler_a:Euler a|Euler a;dpmpp:DPM++ 2M|DPM++ 2M;ddim:DDIM|DDIM', { syn: 'sampler' });
nu('chatfeat.imgW', '가로 크기', 'Width', 832, [64, 2048], { syn: 'width image size' });
nu('chatfeat.imgH', '세로 크기', 'Height', 1216, [64, 2048], { syn: 'height image size' });
tx('chatfeat.imgPositive', '기본 프롬프트', 'Base prompt', 'masterpiece, best quality', { syn: 'positive prompt quality tags' });
tx('chatfeat.imgNegative', '네거티브 프롬프트', 'Negative prompt', 'lowres, bad anatomy', { syn: 'negative prompt' });
se('chatfeat.imgNaiModel', 'NovelAI 모델', 'NovelAI model', 'v4', 'v3:Diffusion V3|Diffusion V3;v4:Diffusion V4|Diffusion V4', { syn: 'novelai image model' });
sw('chatfeat.imgNaiSmea', 'SMEA 사용', 'Use SMEA', false, { syn: 'smea dyn' });
tx('chatfeat.imgComfyUrl', 'ComfyUI 주소', 'ComfyUI URL', '', { syn: 'comfyui url' });
bt('chatfeat.imgComfyFlow', 'ComfyUI 워크플로 불러오기', 'Load ComfyUI workflow', 'plus', { syn: 'comfyui workflow json' });
se('chatfeat.imgOpenaiModel', 'OpenAI 이미지 모델', 'OpenAI image model', 'gpt-image', 'gpt-image:gpt-image|gpt-image;dalle:DALL·E 3|DALL·E 3', { syn: 'openai image model dall-e' });
se('chatfeat.imgQuality', '이미지 품질', 'Image quality', 'medium', 'low:낮음|Low;medium:보통|Medium;high:높음|High', { syn: 'image quality' });
sk('chatfeat.imgWaveKey', 'WaveSpeed 키', 'WaveSpeed key', '', { syn: 'wavespeed api key' });
sl('chatfeat.imgStrength', '참고 이미지 강도', 'Reference image strength', 0.6, [0, 1, 0.05], { syn: 'img2img strength reference' });
nu('chatfeat.imgSeed', '이미지 시드', 'Image seed', -1, [-1, 4294967295], { syn: 'image seed' });
sw('chatfeat.imgAuto', '답변마다 이미지 자동 생성', 'Generate an image for every reply', false, { syn: 'auto generate image' });
sw('chatfeat.imgRefChar', '캐릭터 이미지를 참고로 쓰기', 'Use the character image as reference', true, { syn: 'reference image character' });

sec('chatfeat.translate');
se('chatfeat.trLang', '번역기 언어', 'Translator language', 'ko', 'ko:한국어|Korean;en:영어|English;ja:일본어|Japanese;zh:중국어|Chinese', { syn: 'translator language 번역 언어 translation' });
se('chatfeat.trType', '번역기 종류', 'Translator type', 'llm', 'llm:LLM|LLM;google:Google|Google;deepl:DeepL|DeepL;deeplx:DeepLX|DeepLX;bergamot:Bergamot|Bergamot', { syn: 'translator type 번역기 타입' });
se('chatfeat.trSource', '원본 언어', 'Source language', 'auto', 'auto:자동|Automatic;en:영어|English;ja:일본어|Japanese', { syn: 'source language' });
sk('chatfeat.trDeeplKey', 'DeepL 키', 'DeepL key', '', { syn: 'deepl api key' });
sw('chatfeat.trDeeplFree', 'DeepL 무료 키', 'DeepL free key', false, { syn: 'deepl free' });
tx('chatfeat.trDeeplxUrl', 'DeepLX 주소', 'DeepLX URL', '', { syn: 'deeplx url' });
sk('chatfeat.trDeeplxToken', 'DeepLX 토큰', 'DeepLX token', '', { syn: 'deeplx token' });
sw('chatfeat.trAuto', '자동 번역', 'Auto translation', false, { syn: 'auto translate 자동 번역' });
sw('chatfeat.trCombine', '결합 번역', 'Combine translation', false, { syn: 'combine translation' });
sw('chatfeat.trLegacy', '레거시 번역', 'Legacy translation', false, { syn: 'legacy translation' });
sw('chatfeat.trBeforeHtml', 'HTML 포맷 전에 번역', 'Translate before HTML formatting', false, { syn: 'translate before html' });
sw('chatfeat.trCachedOnly', '캐시된 메시지만 자동 번역', 'Auto-translate cached messages only', false, { syn: 'cached only' });
sw('chatfeat.trHtml', 'HTML 번역', 'HTML translate', false, { syn: 'bergamot html translate' });
bt('chatfeat.trExport', '번역 캐시 내보내기', 'Export translation cache', 'arrow-down', { syn: 'export translation cache 번역 캐시' });
bt('chatfeat.trImport', '번역 캐시 가져오기', 'Import translation cache', 'arrow-up', { syn: 'import translation cache' });
bt('chatfeat.trClear', '번역 캐시 지우기', 'Clear translation cache', 'trash-2', { confirm: '번역 캐시를 지울까요? 되돌릴 수 없어요|Clear the translation cache? This cannot be undone', syn: 'clear translation cache 삭제' });

/* ---------------------------------------------------------------- 3 화면·읽기 */
sec('display.theme');
se('display.theme', '테마', 'Theme', 'standard', 'standard:표준|Standard;waifu:Waifu형|Waifulike;mobilechat:모바일 채팅|Mobile Chat;cardboard:카드보드|CardBoard;custom:커스텀 HTML|Custom HTML', { syn: 'theme gui 화면 레이아웃' });
se('display.colorScheme', '색상 구성', 'Color scheme', 'deepnexus', 'deepnexus:딥 넥서스|Deep Nexus;light:밝게|Light;contrast:고대비|High contrast', { syn: 'color scheme 색상 모드 dark light' });
se('display.textTheme', '텍스트 색상', 'Text color', 'standard', 'standard:표준|Standard;highlight:강조|Highlight;custom:커스텀|Custom', { syn: 'text theme color' });
se('display.background', '배경', 'Background', 'network', 'network:네트워크|Network;solid:단색|Solid;image:이미지|Image', { syn: 'background 배경 이미지' });
bt('display.bgImage', '배경 이미지 고르기', 'Choose a background image', 'image', { syn: 'background image' });
sw('display.textBorder', '채팅창 윤곽선', 'Text screen borders', false, { syn: 'text screen border' });
sw('display.useSticker', '채팅 스티커 사용', 'Use chat stickers', false, { syn: 'use chat sticker useChatSticker' });
bt('display.customGui', '커스텀 GUI 정의', 'Define custom GUI', 'sliders', { syn: 'custom gui builder 커스텀 GUI' });

sec('display.font');
se('display.font', '글꼴', 'Font', 'nanum-gothic', 'nanum-neo:NanumSquare Neo|NanumSquare Neo;nanum-gothic:나눔고딕|Nanum Gothic;system:시스템 글꼴|System font;serif:명조체|Serif;mono:고정폭|Monospace', { syn: 'font 폰트 typeface 나눔고딕' });
tx('display.customFont', '직접 입력한 글꼴', 'Custom font name', '', { syn: 'custom font' });
sl('display.zoom', '채팅 텍스트 크기', 'Chat text size', 110, [50, 200, 5, '%'], { syn: 'zoom size text size 글자 크기 zoomsize 폰트 크기', d: 100, v: 110 });
sl('display.lineHeight', '줄간격', 'Line height', 1.5, [1, 3, 0.05], { syn: 'line height lineHeight 행간' });
sl('display.iconSize', '아이콘 크기', 'Icon size', 100, [50, 200, 5, '%'], { syn: 'icon size iconsize' });
sl('display.textAreaSize', '입력창 크기', 'Input area size', 100, [50, 200, 5, '%'], { syn: 'text area size textarea input area' });
sl('display.textAreaText', '입력창 글자 크기', 'Input area text size', 100, [50, 200, 5, '%'], { syn: 'input text size' });
sl('display.sidebarSize', '사이드바 크기', 'Sidebar size', 100, [50, 200, 5, '%'], { syn: 'sidebar size' });
sl('display.assetWidth', '이미지 최대 너비', 'Asset images max width', 100, [20, 100, 5, '%'], { syn: 'asset width 에셋 넓이' });
sl('display.settingsCloseSize', '설정 닫기 버튼 크기', 'Settings close button size', 100, [50, 200, 5, '%'], { syn: 'settings close button size', help: '데스크톱에서 설정을 닫는 버튼의 크기예요.|The size of the button that closes settings on desktop.' });

sec('display.chat');
sw('display.hideRealm', 'RisuRealm 숨기기', 'Hide RisuRealm', false, { syn: 'hide realm' });
sw('display.hideImages', '모든 이미지 숨기기', 'Hide all images', false, { syn: 'hide all images hideAllImages' });
sw('display.folderName', '폴더 이름 보이기', 'Show folder names', false, { syn: 'show folder name' });
sw('display.savingIcon', '저장 아이콘 표시', 'Show saving icon', true, { syn: 'saving icon' });
se('display.notification', '알림', 'Notification', 'off', 'off:끔|Off;bg:백그라운드일 때|When in background;on:항상|Always', { scope: 'device', syn: 'notification 알림 permission' });
sw('display.fullscreen', '전체 화면', 'Fullscreen', false, { dev: true, scope: 'device', syn: 'fullscreen full screen', help: '데스크톱 앱에서만 쓸 수 있어요.|Only available in the desktop app.' });
tx('display.quoteOpen', '여는 큰따옴표', 'Leading double quote', '“', { syn: 'leading double quote 선행 이중 따옴표' });
tx('display.quoteClose', '닫는 큰따옴표', 'Trailing double quote', '”', { syn: 'trailing double quote 후행 이중 따옴표' });
tx('display.sQuoteOpen', '여는 작은따옴표', 'Leading single quote', '‘', { syn: 'leading single quote' });
tx('display.sQuoteClose', '닫는 작은따옴표', 'Trailing single quote', '’', { syn: 'trailing single quote' });
ta('display.customCss', '커스텀 CSS', 'Custom CSS', '', { help: '스타일을 바꾸는 CSS예요. 문제가 생기면 Ctrl+.로 끄고 켤 수 있어요.|CSS to restyle the app. If something breaks, press Ctrl+. to switch it off and on.', syn: 'custom css style 스타일' });

sec('display.lowpower');
sw('display.lowPower', '저전력 모드', 'Low-power mode', false, { scope: 'device', desc: '흐림·그림자·장식 애니메이션을 끄고 전환을 짧게 해요|Turns off blur, shadows and decorative animation, and shortens transitions.', syn: 'low power battery saver performance 성능 저사양 절전 느림 slow lag nexus-low-power' });
sg('display.reducedMotion', '움직임 줄이기', 'Reduce motion', 'system', 'system:시스템 설정 따르기|Follow system;on:줄이기|Reduce;off:그대로|Full', { scope: 'device', syn: 'reduced motion animation reduce 애니메이션 모션 prefers-reduced-motion' });
sl('display.animSpeed', '애니메이션 속도', 'Animation speed', 0.4, [0.1, 1.5, 0.05, '×'], { scope: 'device', syn: 'animation speed 에니메이션 속도 animationSpeed' });
sw('display.haptics', '진동 반응', 'Haptic feedback', true, { dev: true, scope: 'device', syn: 'haptic vibration 진동 haptics' });
sg('display.streamOpt', '스트리밍 표시 최적화', 'Streaming display optimization', 'off', 'off:끔|Off;balanced:균형|Balanced;strong:강하게|Strong', { exp: true, scope: 'device', syn: 'streaming display optimization streamingDisplayOptimizationMode' });
se('display.keepAlive', '세션 유지', 'Keep session alive', 'off', 'off:끔|Off;sound:소리로 유지|Via sound', { dev: true, scope: 'device', syn: 'keep session alive keepSessionAlive background', help: '앱이 백그라운드에서도 계속 돌게 해요. Android에서만 쓸 수 있어요.|Keeps the app running in the background. Android only.' });

/* ---------------------------------------------------------------- 4 입력·접근성 */
sec('input.send');
sw('input.sendWithEnter', 'Enter 키로 보내기', 'Send with the Enter key', true, { desc: '끄면 Shift+Enter로 보내요|When off, Shift+Enter sends', syn: 'enter key send with enter sendWithEnter 엔터키로 메세지 보내기 shift enter 엔터 전송 엔터키' });
sw('input.fixedInput', '입력창 하단 고정', 'Pin the input box to the bottom', true, { syn: 'fixed chat textarea fixedChatTextarea 채팅창 하단 고정' });
sw('input.clickEdit', '글을 눌러서 수정', 'Click text to edit', false, { syn: 'click to edit clickToEdit 클릭해서 수정하기' });
sw('input.blockEdit', '블록 부분 수정', 'Block partial edit', false, { syn: 'enable block partial edit enableBlockPartialEdit' });
sw('input.dragEdit', '드래그 부분 수정', 'Drag partial edit', false, { syn: 'enable drag partial edit select text edit' });
sw('input.longPressEdit', '길게 눌러 팝업 편집기 열기', 'Long press to open the popup editor', false, { syn: 'long press popup editor longPressToPopupEditor' });
sw('input.askRemoval', '삭제 확인', 'Ask before removal', true, { syn: 'ask removal askRemoval confirm delete' });
sw('input.instantRemove', '삭제 시 이후 메시지도 삭제', 'Remove following messages when deleting', false, { syn: 'instant remove subsequent instantRemove 삭제 시 그 이후 채팅 삭제' });
sw('input.botAtStart', '실행 시 설정으로 시작', 'Start in settings', false, { syn: 'bot menu when launch botSettingAtStart' });
sw('input.inlayError', '오류를 채팅 안에 표시', 'Show errors inside the chat', true, { syn: 'inlay error response inlayErrorResponse' });

sec('input.gestures');
sw('input.swipe', '스와이프로 새 답변', 'Swipe for a new reply', true, { syn: 'swipe reroll regeneration 스와이프 리롤 사용 gesture 제스처' });
sw('input.autoScroll', '새 메시지로 자동 스크롤', 'Scroll to new messages', true, { syn: 'auto scroll to new message autoScrollToNewMessage' });
sw('input.alwaysScroll', '항상 새 메시지로 스크롤', 'Always scroll to new messages', false, { syn: 'always scroll alwaysScrollToNewMessage ignore scroll position' });
se('input.newMsgButton', '새 메시지 버튼 모양', 'New message button style', 'icon', 'icon:아이콘|Icon;text:글자|Text;off:숨김|Hidden', { syn: 'new message button style newMessageButtonStyle' });
sw('input.edgeSwipe', '화면 가장자리 스와이프로 사이드바 열기', 'Open the sidebar with an edge swipe', true, { syn: 'edge swipe sidebar gesture' });

sec('input.a11y');
sw('input.largeTargets', '큰 터치 영역', 'Larger touch targets', false, { scope: 'device', syn: 'larger touch targets 터치 영역 44' });
sw('input.reduceTransparency', '투명도 줄이기', 'Reduce transparency', false, { scope: 'device', syn: 'reduce transparency prefers-reduced-transparency blur 흐림' });
sw('input.showTransLoading', '번역 중 표시', 'Show translation loading', true, { syn: 'show translation loading showTranslationLoading' });
sw('input.requestInfo', '채팅 안에 요청 정보 보이기', 'Show request info in the chat', false, { syn: 'request info inside chat requestInfoInsideChat' });
sw('input.screenReader', '화면 낭독기용 안내 늘리기', 'More hints for screen readers', false, { scope: 'device', syn: 'screen reader aria voiceover talkback 낭독' });
sg('input.focusRing', '초점 표시', 'Focus ring', 'normal', 'normal:보통|Normal;thick:굵게|Thick', { scope: 'device', syn: 'focus ring outline 포커스' });

sec('input.menu');
sw('input.menuBottom', '메뉴 버튼을 사이드바 하단으로', 'Move the menu button to the bottom of the sidebar', false, { syn: 'hamburger button bottom hamburgerButtonBottom 햄버거' });
sw('input.menuChatList', '메뉴에 채팅 목록 보이기', 'Show the chat list in the menu', true, { syn: 'show menu chat list showMenuChatList' });
sw('input.menuHypa', '메뉴에 장기 기억 요약 창 보이기', 'Show the memory summary window in the menu', false, { syn: 'show menu hypa modal showMenuHypaMemoryModal 하이파 요약' });
sw('input.menuReroll', '사이드 메뉴에 새 답변 버튼', 'Show a new-reply button in the side menu', false, { syn: 'side menu reroll button sideMenuRerollButton' });
sw('input.menuSidebar', '메뉴 사이드바', 'Menu side bar', true, { syn: 'menu sidebar menuSideBar' });
bt('input.customSidebar', '사이드바 구성 편집', 'Customize the sidebar', 'panel-left', { syn: 'custom sidebar config CustomSidebarConfig 사이드바 설정' });
sw('input.goCharOnImport', '가져온 뒤 캐릭터로 이동', 'Go to the character after import', true, { syn: 'go to character on import goCharacterOnImport' });
sw('input.branchFolder', '분기할 때 폴더 만들기', 'Create a folder when branching', false, { syn: 'create folder on branch createFolderOnBranch' });

/* ---------------------------------------------------------------- 5 언어 */
sec('lang.app');
se('lang.ui', 'UI 언어', 'UI language', 'ko', 'ko:한국어|한국어;en:English|English;zh:中文|中文;zh-Hant:繁體中文|繁體中文;de:Deutsch|Deutsch;es:Español|Español;vi:Tiếng Việt|Tiếng Việt', { syn: 'ui language interface language 언어 language 영어 한국어', desc: '이 데모에서는 한국어와 English만 바뀌어요|In this demo only Korean and English switch' });
nt('lang.restartNote', '번역은 이제 ‘대화 기능 › 번역’에 있어요', 'Translation settings now live under Chat features › Translation', { syn: 'translator moved 번역기' });

/* ---------------------------------------------------------------- 6 페르소나 */
sec('persona.main');
tx('persona.note', '페르소나 노트', 'Persona note', '', { syn: 'persona note personaNote' });
bt('persona.add', '새 페르소나', 'New persona', 'plus', { syn: 'add persona 추가' });
bt('persona.import', '페르소나 가져오기', 'Import a persona', 'arrow-up', { syn: 'import persona' });
sw('persona.perChat', '채팅마다 페르소나 기억', 'Remember the persona per chat', true, { scope: 'chat', syn: 'persona per chat binding' });

/* ---------------------------------------------------------------- 7 확장 */
sec('ext.plugins');
bt('ext.pluginImport', '플러그인 가져오기', 'Import a plugin', 'arrow-up', { syn: 'import plugin install 설치' });
bt('ext.pluginUpdate', '업데이트 확인', 'Check for updates', 'refresh-cw', { syn: 'plugin update' });
sec('ext.modules');
sw('ext.modulesAll', '모듈 전체 사용', 'Enable modules globally', true, { syn: 'global modules enable' });
bt('ext.moduleNew', '새 모듈', 'New module', 'plus', { syn: 'create module add module 모듈 만들기', act: 'module-new' });
bt('ext.moduleImport', '모듈 가져오기', 'Import a module', 'arrow-up', { syn: 'import module' });
bt('ext.moduleMcp', 'MCP 가져오기', 'Import MCP', 'plug', { syn: 'mcp import tools' });
sec('ext.pluginpages');
bt('ext.plugPage1', 'Dice Roller 설정 열기', 'Open Dice Roller settings', 'chevron-right', { syn: 'plugin defined settings additionalSettingsMenu callback', desc: '플러그인이 직접 보여 주는 화면이에요|A screen the plugin shows itself' });
bt('ext.plugPage2', '배경 음악 설정 열기', 'Open Background music settings', 'chevron-right', { syn: 'plugin defined settings background music callback' });

/* ---------------------------------------------------------------- 8 데이터·백업 */
sec('data.backup');
bt('data.saveFull', '전체 백업 저장', 'Save a full backup', 'arrow-down', { syn: 'full backup save export 백업 저장' });
bt('data.savePartial', '일부만 백업', 'Save a partial backup', 'arrow-down', { syn: 'partial backup' });
bt('data.loadLocal', '파일에서 백업 불러오기', 'Load a backup from a file', 'arrow-up', { confirm: '지금 데이터가 백업 내용으로 바뀌어요. 계속할까요?|Your current data will be replaced by the backup. Continue?', syn: 'load backup restore 복원 local' });
bt('data.loadInternal', '앱 안의 백업 불러오기', 'Load an in-app backup', 'arrow-up', { confirm: '지금 데이터가 백업 내용으로 바뀌어요. 계속할까요?|Your current data will be replaced by the backup. Continue?', syn: 'load internal backup' });
bt('data.exportDataset', '데이터셋으로 내보내기', 'Export as a dataset', 'arrow-down', { syn: 'export dataset' });
bt('data.exportSettings', '설정 파일 내보내기', 'Export the settings file', 'arrow-down', { syn: 'export settings file' });
bt('data.importSettings', '설정 파일 가져오기', 'Import a settings file', 'arrow-up', { syn: 'import settings file' });
sec('data.storage');
bt('data.cleanCold', '사용하지 않는 보관 데이터 정리', 'Clean unused archived data', 'trash-2', { confirm: '쓰지 않는 보관 데이터와 에셋을 지울까요? 되돌릴 수 없어요|Delete unused archived data and assets? This cannot be undone', syn: 'clean cold storage coldstorage 정리 삭제' });
sw('data.coldStart', '시작할 때 캐릭터 보관', 'Archive characters at startup', false, { syn: 'archive characters at startup coldStorage' });
bt('data.integrity', '저장 공간 점검', 'Check storage integrity', 'check', { syn: 'storage integrity maintenance' });
sw('data.persist', '저장 공간 유지 요청', 'Ask the browser to keep storage', true, { dev: false, syn: 'persistent storage' });

/* ---------------------------------------------------------------- 9 단축키 */
sec('keys.main');
[['reroll', '새 답변', 'New reply', 'Ctrl+Alt+R'], ['unreroll', '이전 답변', 'Previous reply', 'Ctrl+Alt+F'], ['translate', '번역', 'Translate', 'Ctrl+Alt+T'], ['remove', '삭제', 'Delete', 'Ctrl+Alt+D'], ['edit', '수정', 'Edit', 'Ctrl+Alt+E'], ['copy', '복사', 'Copy', 'Ctrl+Alt+C'], ['send', '보내기', 'Send', 'Ctrl+Alt+Enter'],
  ['settings', '설정 열기', 'Open settings', 'Ctrl+S'], ['home', '홈', 'Home', 'Ctrl+H'], ['presets', '프리셋 목록', 'Preset list', 'Ctrl+P'], ['persona', '페르소나 바꾸기', 'Change persona', 'Ctrl+E'], ['modelSelect', '모델 선택', 'Select model', 'Ctrl+M'], ['toggleCss', '커스텀 CSS 켜고 끄기', 'Toggle custom CSS', 'Ctrl+.'],
  ['prevChar', '이전 캐릭터', 'Previous character', 'Ctrl+['], ['nextChar', '다음 캐릭터', 'Next character', 'Ctrl+]'], ['quickMenu', '빠른 메뉴', 'Quick menu', 'Ctrl+`'], ['quickSettings', '빠른 설정', 'Quick settings', 'Ctrl+Q'], ['toggleVoice', '음성 켜고 끄기', 'Toggle voice', 'Ctrl+V'], ['toggleLog', '로그 켜고 끄기', 'Toggle log', 'Ctrl+L'],
  ['previewRequest', '요청 미리보기', 'Preview request', 'Ctrl+U'], ['webcam', '웹캠', 'Webcam', 'Ctrl+W'], ['focusInput', '입력창으로 이동', 'Focus the input', 'Space'], ['scrollActive', '현재 캐릭터로 스크롤', 'Scroll to the active character', 'Ctrl+G'], ['popupEditor', '팝업 편집기', 'Popup editor', 'Ctrl+X'], ['loadout', '로드아웃', 'Loadout', 'Ctrl+O'], ['quickPreset', '프리셋 1~9 바로 바꾸기', 'Switch to preset 1 to 9', 'Ctrl+1–9']]
  .forEach(([k, ko, en, combo]) => kb('keys.' + k, ko, en, combo, { syn: 'hotkey 핫키 shortcut keyboard ' + k }));

/* ---------------------------------------------------------------- 10 고급 */
sec('adv.request');
nu('adv.retries', '실패하면 다시 요청할 횟수', 'Retries when a request fails', 2, [0, 20], { help: '요청이 실패하면 몇 번 더 시도할지 정해요.|How many more times to try when a request fails.', syn: 'request retrys requestretrys 재요청 재시도' });
nu('adv.genTimes', '한 번에 만들 답변 수', 'Replies to generate at once', 1, [1, 8], { help: '지원하는 모델에서 한 번에 만들 답변 수예요.|How many replies a supporting model writes at once.', syn: 'generation choices genTimes 생성 횟수' });
sg('adv.reqLocation', '요청 보낼 곳', 'Request location', 'default', 'default:기본|Default;direct:직접|Direct;server:서버|Server', { syn: 'request location 리퀘스트 위치' });
sw('adv.plainFetch', '직접 요청 보내기', 'Force plain fetch', false, { syn: 'force plain fetch 직접 요청 cors' });
sw('adv.forceOpenAI', 'OpenAI 형식으로 강제', 'Force OpenAI format', false, { syn: 'force proxy as openai forceProxyAsOpenAI' });
sw('adv.autoContinue', '문장이 끊기면 자동으로 이어 쓰기', 'Continue automatically when a reply is cut off', false, { help: '문장 부호로 끝나지 않으면 이어서 써 달라고 요청해요.|Asks the model to continue when a reply does not end in punctuation.', syn: 'anti incomplete response auto continue 불완전 문단 방지 자동 컨티뉴' });
sw('adv.removeIncomplete', '끊긴 문장 지우기', 'Remove incomplete sentences', false, { syn: 'remove incomplete response removeIncompleteResponse 불완전 문단 제거' });
nu('adv.autoContinueMin', '자동 이어 쓰기 목표 토큰', 'Auto-continue target tokens', 0, [0, 8000], { syn: 'target tokens auto continue autoContinueMinTokens' });
ta('adv.additionalPrompt', '추가 프롬프트', 'Additional prompt', '', { scope: 'preset', syn: 'additional prompt additionalPrompt', help: '프롬프트 보정이 켜져 있을 때 메인 프롬프트 끝에 붙는 글이에요.|Text appended to the main prompt when prompt adjustment is on.' });
tx('adv.descPrefix', '캐릭터 설명 앞머리', 'Character description prefix', '', { syn: 'description prefix descriptionPrefix' });
se('adv.visionQuality', '이미지 이해 품질', 'Vision quality', 'low', 'low:낮음|Low;high:높음|High', { syn: 'vision quality 비전 품질' });
sw('adv.imageCompress', '이미지 압축', 'Image compression', true, { syn: 'image compression imageCompression' });
sw('adv.antiOverload', '서버 과부하 방지', 'Anti-server overload', false, { syn: 'anti server overload antiServerOverload' });
sw('adv.flex', 'OpenAI Flex 처리', 'OpenAI flex processing', false, { syn: 'openai flex processing openAIFlexProcessing' });
sw('adv.claudeCache1h', 'Claude 1시간 캐시', 'Claude 1-hour caching', false, { syn: 'claude 1 hour caching claude1HourCaching' });
sw('adv.claudeBatch', 'Claude 배치 요청', 'Claude batching', false, { syn: 'claude batching claudeBatching' });
sw('adv.noWaitTrans', '번역을 기다리지 않고 보내기', 'Send without waiting for translation', false, { syn: 'no wait for translate noWaitForTranslate' });
sw('adv.tokCache', '토크나이저 캐시', 'Tokenizer caching', true, { syn: 'use tokenizer caching useTokenizerCaching' });

sec('adv.lorebook');
nu('adv.lbDepth', '로어북 검색 깊이', 'Lorebook search depth', 5, [0, 100], { syn: 'lorebook search depth loreBookDepth world info' });
nu('adv.lbToken', '로어북 최대 토큰', 'Lorebook max tokens', 1000, [0, 20000], { syn: 'lorebook max tokens loreBookToken' });
sw('adv.lbBulk', '로어북 한꺼번에 켜기 버튼', 'Lorebook bulk enabling button', false, { syn: 'lorebook bulk enabling bulkEnabling 한번에 로어북 활성화 버튼' });
sw('adv.lbLocal', '전역 로어북에서 로컬 활성화', 'Local activation in the global lorebook', false, { syn: 'local activation in global lorebook localActivationInGlobalLorebook' });
sw('adv.dynAssets', '다이나믹 에셋', 'Dynamic assets', false, { help: '에셋 이름을 못 찾으면 가장 비슷한 에셋을 벡터 검색으로 찾아요.|When an asset name is not found, the closest asset is found by vector search.', syn: 'dynamic assets dynamicAssets' });
nu('adv.assetDiff', '에셋 최대 차이', 'Asset max difference', 4, [0, 20], { syn: 'asset max difference assetMaxDifference' });

sec('adv.features');
sw('adv.legacyGui', '레거시 GUI 사용', 'Use legacy GUI', false, { help: '탭으로 나뉜 페이지를 한 줄로 쭉 이어서 보여 줘요.|Shows tabbed pages as one long page.', syn: 'use legacy gui useLegacyGUI display 디스플레이' });
sw('adv.mobileGuiBeta', '베타 모바일 GUI', 'Beta mobile GUI', false, { help: '작은 화면에서 베타 모바일 GUI를 써요. 새로고침이 필요해요.|Uses the beta mobile GUI on small screens. Needs a reload.', syn: 'beta mobile gui betaMobileGUI display 디스플레이' });
sw('adv.proTools', 'Pro Tools', 'Pro Tools', false, { syn: 'enable risuai pro tools enableRisuaiProTools easy panel 쉬운 설정 접근성 accessibility' });
sw('adv.showUnrec', '권장하지 않는 설정 보이기', 'Show unrecommended settings', false, { help: '권장하지 않거나 더 이상 쓰지 않는 설정을 보여 줘요.|Shows settings that are not recommended or deprecated.', syn: 'show unrecommended settings showUnrecommended' });
sw('adv.useExperimental', '실험적 기능 보이기', 'Show experimental features', false, { help: '켜면 아직 다듬는 중인 기능이 나타나요.|Reveals features that are still being refined.', syn: 'use experimental enable experimental features useExperimental 실험적 요소 보이기' });
sw('adv.promptInfo', '채팅에 프롬프트 정보 붙이기', 'Add prompt info to the chat', false, { syn: 'prompt info inside chat promptInfoInsideChat' });
sw('adv.cot', '생각의 사슬', 'Chain of thoughts', false, { syn: 'chain of thoughts cot' });
sw('adv.showDeprecatedTrigger', '권장하지 않는 트리거 V1 보이기', 'Show deprecated trigger V1', false, { unrec: true, syn: 'deprecated trigger v1' });

sec('adv.experimental');
sw('adv.exp.localNet', '로컬 네트워크 모드', 'Local network mode', false, { exp: true, syn: 'local network mode localNetworkMode' });
nu('adv.exp.localNetTimeout', '로컬 네트워크 제한 시간(초)', 'Local network timeout (sec)', 60, [1, 600], { exp: true, syn: 'local network timeout' });
sw('adv.exp.googleToken', 'Google Cloud 토큰화', 'Google Cloud tokenization', false, { exp: true, syn: 'google cloud tokenization googleCloudTokenization' });
sw('adv.exp.cachePoint', '자동 캐시 포인트', 'Automatic cache point', false, { exp: true, syn: 'automatic cache point automaticCachePoint' });
sw('adv.exp.googleTrans', '새 Google 번역', 'New Google Translate', false, { exp: true, syn: 'new google translate experimental' });
sw('adv.exp.claudeRet', 'Claude 캐시 다시 쓰기', 'Claude cache retrieval', false, { exp: true, syn: 'claude caching retrival' });
sw('adv.exp.newOai', '새 OpenAI 처리 방식', 'New OpenAI handling', false, { exp: true, syn: 'new oai handle newOAIHandle' });
sw('adv.exp.newImage', '새 이미지 처리 방식 (베타)', 'New image handling (beta)', false, { exp: true, syn: 'new image handling beta newImageHandlingBeta' });
sw('adv.exp.dynAssetsEdit', '표시 수정에 다이나믹 에셋 사용', 'Use dynamic assets in display edits', false, { exp: true, syn: 'dynamic assets in display' });
sw('adv.exp.allFiles', '모든 파일 형식 고르기 허용', 'Allow selecting any file type', false, { exp: true, syn: 'allow all file select allowAllFileSelect' });

sec('adv.dev');
sw('adv.pluginDev', '플러그인 개발 모드', 'Plugin development mode', false, { syn: 'plugin develop mode pluginDevelopMode' });
sw('adv.devTools', '개발자 도구', 'Developer tools', false, { syn: 'enable dev tools enableDevTools inspector' });
sw('adv.cssError', 'CSS 오류 보여 주기', 'Return CSS errors', false, { syn: 'return css error returnCSSError' });
sw('adv.bookmark', '북마크', 'Bookmark', true, { syn: 'bookmark' });
sw('adv.simpleTool', '간단한 도구 사용', 'Simplified tool use', false, { syn: 'simplified tool use simplifiedToolUse' });
sw('adv.rememberTool', '도구 사용 기억', 'Remember tool usage', false, { syn: 'remember tool usage rememberToolUsage' });
sw('adv.realmDirect', 'Realm 바로 열기', 'Open Realm directly', false, { syn: 'realm direct open realmDirectOpen' });
se('adv.heightMode', '높이 방식', 'Height mode', 'normal', 'normal:보통|Normal;percent:퍼센트|Percent', { syn: 'height mode heightMode' });
nu('adv.chatLoadInitial', '처음 불러올 채팅 수', 'Initial chat load count', 20, [1, 500], { help: '채팅을 열 때 처음 불러오는 메시지 수예요.|How many messages are loaded when a chat opens.', syn: 'initial chat load count chatLoadInitialPages' });
nu('adv.chatLoadMore', '더 불러올 채팅 수', 'Additional chat load count', 20, [1, 500], { syn: 'additional chat load count chatLoadAdditionalPages' });

/* ---------------------------------------------------------------- review round: rows the research lists that were missing (R-19), Easy panel (R-09), reference rows (DS-011) */
sec('models.presets'); bt('models.presetIcon', '프리셋 아이콘 바꾸기', 'Change the preset icon', 'image', { desc: '지금은 채팅 봇 > 기타에서 바꿔요|Today it is set under Chat bot > Others', syn: 'preset icon image 프리셋 이미지 아이콘 그림' });
sec('models.params');
bt('models.bias', '편향(바이어스) 표 편집', 'Edit the bias table', 'sliders', { syn: 'bias 바이어스 logit 확률 편향' });
bt('models.customFlags', '모델 기능 표시 직접 지정', 'Set custom model flags', 'sliders', { syn: 'custom flags 플래그 모델 플래그 기능 지정' });
sw('models.moduleIntegration', '프롬프트에 모듈 내용 넣기', 'Include module content in the prompt', true, { syn: 'module integration 모듈 통합 모듈 연동' });
bt('models.modelTools', '모델 도구 편집', 'Edit model tools', 'plug', { syn: 'tools model tools 도구 함수 호출 툴' });
sec('models.models');
se('models.fallbackMem', '장기 기억 대체 모델', 'Long-term memory fallback model', '', '', { scope: 'preset', syn: 'fallback memory 폴백' });
se('models.fallbackTrans', '번역 대체 모델', 'Translation fallback model', '', '', { scope: 'preset', syn: 'fallback translate 폴백' });
se('models.fallbackEmo', '감정 이미지 대체 모델', 'Emotion image fallback model', '', '', { scope: 'preset', syn: 'fallback emotion 폴백' });
se('models.fallbackOther', '그 밖의 기능 대체 모델', 'Other features fallback model', '', '', { scope: 'preset', syn: 'fallback other 폴백' });
sec('models.connections');
tx('models.orOrder', 'OpenRouter 공급자 순서', 'OpenRouter provider order', '', { syn: 'openrouter provider order routing 라우팅 순서' });
tx('models.orOnly', 'OpenRouter 허용할 공급자', 'OpenRouter allowed providers', '', { syn: 'openrouter only allow 허용' });
tx('models.orIgnore', 'OpenRouter 제외할 공급자', 'OpenRouter ignored providers', '', { syn: 'openrouter ignore 제외' });
sw('models.orFallback', 'OpenRouter 다른 공급자로 넘어가기', 'OpenRouter fallback providers', true, { syn: 'openrouter allow fallbacks 대체 공급자' });
sw('models.orMiddleOut', '긴 프롬프트 가운데 줄이기', 'Middle-out for long prompts', false, { syn: 'openrouter middle-out middleout 압축 줄이기' });
se('models.oobaChatMode', 'Ooba 채팅 방식', 'Ooba chat mode', 'instruct', 'instruct:지시|Instruct;chat:채팅|Chat;chat-instruct:채팅+지시|Chat-instruct', { syn: 'ooba mode instruct 오바 채팅 방식' });
tx('models.oobaPrefix', 'Ooba 접두 문구', 'Ooba prefix text', '', { syn: 'ooba prefix 접두 오바' });
sw('models.naiAdventure', 'NovelAI 어드벤처 모드', 'NovelAI adventure mode', false, { syn: 'novelai adventure 어드벤처' });
sw('models.naiAppendName', 'NovelAI 이름 덧붙이기', 'NovelAI append names', false, { syn: 'novelai append name 이름 붙이기' });
sec('adv.request'); tx('adv.banChars', '쓰지 않을 문자', 'Characters to ban', '', { syn: 'ban character set 금지 문자 문자 금지 제외' });
sec('adv.features'); nv('adv.easyPanel', '쉬운 설정 패널 열기', 'Open the Easy panel', 'models.mainModel', { syn: 'easy panel 이지 패널 쉬운 설정 간단 설정', desc: 'Pro Tools를 켜면 보여요|Shown when Pro Tools is on', nk: 'plain' });
sec('persona.main');
ta('persona.desc', '페르소나 설명', 'Persona description', '', { syn: 'persona description 설명 소개' });
bt('persona.portrait', '초상화 바꾸기', 'Change the portrait', 'image', { syn: 'persona portrait image 초상화 이미지 사진' });
bt('persona.export', '페르소나 내보내기', 'Export the persona', 'arrow-down', { syn: 'export persona' });
bt('persona.remove', '페르소나 삭제', 'Delete the persona', 'trash-2', { confirm: '이 페르소나를 삭제할까요? 되돌릴 수 없어요|Delete this persona? This cannot be undone', syn: 'delete remove persona 삭제 지우기' });
sec('chatfeat.voice');
nv('chatfeat.refEleven', '연결: ElevenLabs', 'Connection: ElevenLabs', 'models.elevenKey', { prov: 'ElevenLabs', nk: 'conn', syn: 'elevenlabs key 일레븐랩스 키' });
nv('chatfeat.refOpenaiTts', '연결: OpenAI', 'Connection: OpenAI', 'models.openaiKey', { prov: 'OpenAI', nk: 'conn', syn: 'openai key tts 키' });
sec('chatfeat.translate');
nv('chatfeat.refDeepl', '연결: DeepL', 'Connection: DeepL', 'models.deeplKey', { prov: 'DeepL', nk: 'conn', syn: 'deepl key 딥엘 키' });
nv('chatfeat.refDeeplx', '연결: DeepLX', 'Connection: DeepLX', 'models.deeplxUrl', { prov: 'DeepLX', nk: 'conn', syn: 'deeplx 딥엘엑스' });
nv('chatfeat.transModelLink', '번역에 쓰는 모델', 'Model used for translation', 'models.transModel', { nk: 'model', syn: 'translation model 모델' });
sec('chatfeat.imagegen');
nv('chatfeat.refNai', '연결: NovelAI', 'Connection: NovelAI', 'models.novelaiKey', { prov: 'NovelAI', nk: 'conn', syn: 'novelai key 노벨에이아이 토큰' });
nv('chatfeat.refWave', '연결: WaveSpeed', 'Connection: WaveSpeed', 'models.waveKey', { prov: 'WaveSpeed', nk: 'conn', syn: 'wavespeed key 웨이브스피드' });
nv('chatfeat.refOpenaiImg', '연결: OpenAI', 'Connection: OpenAI', 'models.openaiKey', { prov: 'OpenAI', nk: 'conn', syn: 'openai image key 키' });
sec('chatfeat.memory'); nv('chatfeat.memModelLink', '장기 기억에 쓰는 모델', 'Model used for long-term memory', 'models.memModel', { nk: 'model', syn: 'memory model 모델' });
sec('chatfeat.emotion'); nv('chatfeat.emoModelLink', '감정 이미지에 쓰는 모델', 'Model used for emotion images', 'models.emoModel', { nk: 'model', syn: 'emotion model 모델' });

/* ---------------------------------------------------------------- named things */
const PRESET_BASES = ['균형', '롤플레이', '번역', '요약', '시 쓰기', '추리', '판타지', 'SF 모험', '일상 대화', '코딩 도우미', '퀴즈 진행', '영어 연습'];
const PRESET_STYLES = ['기본', '긴 답변', '짧게', '빠르게', '엄격하게'];
const presetNames = ['균형', '롤플레이 긴 답변', '번역용'];
for (const b of PRESET_BASES) for (const s of PRESET_STYLES) { const n = b + ' ' + s; if (!presetNames.includes(n) && presetNames.length < 60) presetNames.push(n); }
while (presetNames.length < 60) presetNames.push('균형 ' + (presetNames.length - 56));
const presets = presetNames.slice(0, 60).map((name, i) => ({ id: 'p' + (i + 1), name, model: ['claude-sonnet-45', 'gpt-5-mini', 'gemini-25-pro', 'llama-local-8b'][i % 4] }));
presets.forEach((p, i) => { p.active = i === 0; });

const mk = (prov, list) => list.map(([id, name, g]) => ({ id, name, prov, g }));
const G = {   // parameter groups
  claude: ['temperature', 'top_p', 'top_k', 'thinking'], gpt4: ['temperature', 'top_p', 'frequency_penalty', 'presence_penalty', 'seed'], gpt5: ['reasoning_effort', 'verbosity', 'seed'],
  gemini: ['temperature', 'top_p', 'top_k'], mistral: ['temperature', 'top_p', 'frequency_penalty', 'presence_penalty', 'seed'], cohere: ['temperature', 'top_p', 'top_k', 'frequency_penalty', 'presence_penalty', 'seed'],
  local: ['temperature', 'top_p', 'top_k', 'min_p', 'top_a', 'repetition_penalty', 'seed'], nai: ['temperature', 'top_p', 'top_k', 'top_a', 'min_p', 'repetition_penalty'],
};
const base = [].concat(
  mk('OpenAI', [['gpt-5', 'GPT-5', 'gpt5'], ['gpt-5-mini', 'GPT-5 mini', 'gpt5'], ['gpt-5-nano', 'GPT-5 nano', 'gpt5'], ['gpt-41', 'GPT-4.1', 'gpt4'], ['gpt-41-mini', 'GPT-4.1 mini', 'gpt4'], ['gpt-4o', 'GPT-4o', 'gpt4'], ['gpt-4o-mini', 'GPT-4o mini', 'gpt4'], ['o3', 'o3', 'gpt5'], ['o3-mini', 'o3-mini', 'gpt5'], ['o4-mini', 'o4-mini', 'gpt5'], ['gpt-4-turbo', 'GPT-4 Turbo', 'gpt4'], ['gpt-35-turbo', 'GPT-3.5 Turbo', 'gpt4'], ['gpt-oss-120b', 'gpt-oss-120b', 'gpt5'], ['gpt-oss-20b', 'gpt-oss-20b', 'gpt5']]),
  mk('Anthropic', [['claude-sonnet-45', 'Claude Sonnet 4.5', 'claude'], ['claude-opus-41', 'Claude Opus 4.1', 'claude'], ['claude-haiku-45', 'Claude Haiku 4.5', 'claude'], ['claude-sonnet-4', 'Claude Sonnet 4', 'claude'], ['claude-opus-4', 'Claude Opus 4', 'claude'], ['claude-37-sonnet', 'Claude 3.7 Sonnet', 'claude'], ['claude-35-sonnet', 'Claude 3.5 Sonnet', 'claude'], ['claude-35-haiku', 'Claude 3.5 Haiku', 'claude'], ['claude-3-opus', 'Claude 3 Opus', 'claude'], ['claude-3-haiku', 'Claude 3 Haiku', 'claude']]),
  mk('Google AI Studio', [['gemini-25-pro', 'Gemini 2.5 Pro', 'gemini'], ['gemini-25-flash', 'Gemini 2.5 Flash', 'gemini'], ['gemini-25-flash-lite', 'Gemini 2.5 Flash-Lite', 'gemini'], ['gemini-20-flash', 'Gemini 2.0 Flash', 'gemini'], ['gemini-20-flash-lite', 'Gemini 2.0 Flash-Lite', 'gemini'], ['gemini-15-pro', 'Gemini 1.5 Pro', 'gemini'], ['gemini-15-flash', 'Gemini 1.5 Flash', 'gemini'], ['gemma-3-27b', 'Gemma 3 27B', 'gemini'], ['gemma-3-12b', 'Gemma 3 12B', 'gemini'], ['gemini-exp', 'Gemini Experimental', 'gemini']]),
  mk('Vertex AI', [['vx-gemini-25-pro', 'Gemini 2.5 Pro (Vertex)', 'gemini'], ['vx-gemini-25-flash', 'Gemini 2.5 Flash (Vertex)', 'gemini'], ['vx-claude-sonnet-45', 'Claude Sonnet 4.5 (Vertex)', 'claude'], ['vx-claude-opus-41', 'Claude Opus 4.1 (Vertex)', 'claude'], ['vx-claude-haiku-45', 'Claude Haiku 4.5 (Vertex)', 'claude'], ['vx-gemini-20-flash', 'Gemini 2.0 Flash (Vertex)', 'gemini'], ['vx-llama-4', 'Llama 4 (Vertex)', 'local'], ['vx-mistral-large', 'Mistral Large (Vertex)', 'mistral']]),
  mk('Mistral', [['mistral-large', 'Mistral Large', 'mistral'], ['mistral-medium', 'Mistral Medium', 'mistral'], ['mistral-small', 'Mistral Small', 'mistral'], ['codestral', 'Codestral', 'mistral'], ['ministral-8b', 'Ministral 8B', 'mistral'], ['ministral-3b', 'Ministral 3B', 'mistral'], ['pixtral-large', 'Pixtral Large', 'mistral'], ['mistral-nemo', 'Mistral Nemo', 'mistral']]),
  mk('Cohere', [['command-a', 'Command A', 'cohere'], ['command-r-plus', 'Command R+', 'cohere'], ['command-r', 'Command R', 'cohere'], ['command-r7b', 'Command R7B', 'cohere'], ['command-light', 'Command Light', 'cohere'], ['command-nightly', 'Command Nightly', 'cohere']]),
  mk('Ollama', [['llama-local-8b', 'Llama 3.1 8B (로컬)', 'local'], ['llama-local-70b', 'Llama 3.3 70B (로컬)', 'local'], ['qwen-local-14b', 'Qwen 2.5 14B (로컬)', 'local'], ['gemma-local-9b', 'Gemma 2 9B (로컬)', 'local'], ['mistral-local-7b', 'Mistral 7B (로컬)', 'local'], ['phi-local-14b', 'Phi-4 14B (로컬)', 'local'], ['deepseek-local-r1', 'DeepSeek R1 (로컬)', 'local'], ['nemo-local-12b', 'Mistral Nemo 12B (로컬)', 'local'], ['yi-local-34b', 'Yi 34B (로컬)', 'local'], ['aya-local-8b', 'Aya 8B (로컬)', 'local']]),
  mk('NovelAI', [['nai-kayra', 'Kayra', 'nai'], ['nai-clio', 'Clio', 'nai'], ['nai-erato', 'Erato', 'nai'], ['nai-euterpe', 'Euterpe', 'nai']]),
  mk('Horde', [['horde-auto', 'Horde 자동 선택', 'local'], ['horde-llama', 'Horde Llama', 'local'], ['horde-mythomax', 'Horde MythoMax', 'local'], ['horde-nemo', 'Horde Nemo', 'local']]),
  mk('리버스 프록시', [['rp-custom-1', '내 프록시 모델 1', 'gpt4'], ['rp-custom-2', '내 프록시 모델 2', 'gpt4'], ['rp-custom-3', '내 프록시 모델 3', 'gpt4'], ['rp-custom-4', '내 프록시 모델 4', 'gpt4'], ['rp-custom-5', '내 프록시 모델 5', 'gpt4'], ['rp-custom-6', '내 프록시 모델 6', 'gpt4'], ['rp-custom-7', '내 프록시 모델 7', 'gpt4'], ['rp-custom-8', '내 프록시 모델 8', 'gpt4'], ['rp-custom-9', '내 프록시 모델 9', 'gpt4'], ['rp-custom-10', '내 프록시 모델 10', 'gpt4']])
);
const extra = []; // OpenRouter (24) and NanoGPT (12) re-list others under their own ids
const pick = base.filter((m) => ['OpenAI', 'Anthropic', 'Google AI Studio', 'Mistral', 'Ollama'].includes(m.prov));
for (let i = 0; i < 24; i++) { const m = pick[(i * 2) % pick.length]; extra.push({ id: 'or-' + m.id + '-' + i, name: m.name + ' (OpenRouter)', prov: 'OpenRouter', g: m.g }); }
for (let i = 0; i < 12; i++) { const m = pick[(i * 3 + 1) % pick.length]; extra.push({ id: 'ng-' + m.id + '-' + i, name: m.name + ' (NanoGPT)', prov: 'NanoGPT', g: m.g }); }
const models = base.concat(extra).map((m) => ({ id: m.id, name: m.name, prov: m.prov, params: G[m.g], ctx: [32000, 128000, 200000, 1000000][m.id.length % 4] }));

models.forEach((m) => { m.en = m.name.replace('(로컬)', '(local)').replace('내 프록시 모델', 'My proxy model').replace('Horde 자동 선택', 'Horde auto'); m.provEn = m.prov === '리버스 프록시' ? 'Reverse proxy' : m.prov; });
const KO_WORDS = [[/GPT|^o3|^o4|gpt-oss/, '지피티 챗지피티 오픈에이아이'], [/Claude/, '클로드 앤트로픽'], [/Sonnet/, '소넷'], [/Opus/, '오푸스'], [/Haiku/, '하이쿠'], [/Gemini/, '제미나이 구글'], [/Gemma/, '젬마 구글'], [/Llama/, '라마 메타'], [/Mistral|Ministral|Codestral|Pixtral/, '미스트랄'], [/Qwen/, '큐웬'], [/DeepSeek/, '딥시크'], [/Command|Aya/, '커맨드 코히어'], [/Phi/, '파이'], [/OpenRouter/, '오픈라우터'], [/NanoGPT/, '나노지피티'], [/Opus/, '오퍼스'], [/Kayra|Clio|Erato|Euterpe/, '노벨에이아이'], [/Vertex/, '버텍스'], [/Ollama|로컬/, '올라마 로컬']];
models.forEach((m) => { m.kw = KO_WORDS.filter(([re]) => re.test(m.name)).map((x) => x[1]).join(' '); });
const connections = [
  ['OpenAI', 'models.openaiKey', '오픈에이아이 챗지피티 지피티'], ['Anthropic', 'models.claudeKey', '앤트로픽 클로드'], ['Google AI Studio', 'models.googleKey', '구글 제미나이 젬마'], ['Vertex AI', 'models.vertexProject', '버텍스 구글'], ['AWS (Claude)', 'models.awsKey'], ['Mistral', 'models.mistralKey', '미스트랄'], ['Cohere', 'models.cohereKey', '코히어'],
  ['OpenRouter', 'models.openrouterKey', '오픈라우터'], ['NanoGPT', 'models.nanogptKey', '나노지피티'], ['Ollama', 'models.ollamaUrl', '올라마'], ['NovelAI', 'models.novelaiKey', '노벨에이아이'], ['리버스 프록시', 'models.proxyUrl'], ['Kobold', 'models.koboldUrl'], ['Horde', 'models.hordeKey'],
, ['ElevenLabs', 'models.elevenKey', '일레븐랩스 목소리'], ['VOICEVOX', 'models.voicevoxUrl', '보이스복스'], ['Fish Speech', 'models.fishUrl', '피시 스피치'], ['Stable Diffusion WebUI', 'models.webuiUrl', '스테이블 디퓨전 웹유아이'], ['ComfyUI', 'models.comfyUrl', '컴피유아이'], ['DeepL', 'models.deeplKey', '딥엘 번역'], ['DeepLX', 'models.deeplxUrl', '딥엘엑스'], ['WaveSpeed', 'models.waveKey', '웨이브스피드 이미지']].map(([name, row, kw]) => ({ id: 'c-' + row, name, en: name === '리버스 프록시' ? 'Reverse proxy' : name, row, kw }));

const personas = [['주노', '기본 페르소나'], ['미라', '여행 작가'], ['하루', '고등학생'], ['서연', '탐정'], ['카이', '모험가'], ['리나', '마법사'], ['도윤', '선생님'], ['에이다', '엔지니어'], ['니코', '해적 선장'], ['유진', '사서'], ['Alex', 'Test persona'], ['Mina', 'Reviewer']].map(([name, note], i) => ({ id: 'u' + (i + 1), name, note }));
const plugins = [['Count Words', '단어 수를 세어 줘요'], ['자동 번역 보조', '번역 결과를 다듬어요'], ['Dice Roller', '주사위를 굴려요'], ['감정 표시기', '감정을 아이콘으로 보여요'], ['채팅 내보내기', '채팅을 파일로 저장해요'], ['로어북 정리', '로어북 항목을 정리해요'], ['날씨 정보', '현재 날씨를 알려 줘요'], ['퀵 리플라이', '자주 쓰는 답을 빠르게 보내요'], ['스토리 타임라인', '이야기 흐름을 표로 보여요'], ['Markdown Helper', 'Markdown 서식을 도와요'], ['배경 음악', '분위기에 맞는 음악을 틀어요'], ['토큰 계산기', '토큰 수를 미리 보여요'], ['프롬프트 린터', '프롬프트의 문제를 찾아요'], ['캐릭터 갤러리', '캐릭터 이미지를 모아 보여요'], ['Pomodoro', '집중 시간을 재요']].map(([name, note], i) => ({ id: 'pl' + (i + 1), name, note, ver: '1.' + (i % 5) + '.0' }));
const modules = ['판타지 세계관 기본', '학교 일상 규칙', '주사위 규칙', 'SF 용어집', '감정 반응 세트', '요약 도우미', '나레이션 스타일', '전투 시스템', '호감도 시스템', '추리 단서 노트', '여행 일지', '요리 대결', '마법 학원', '사이버펑크 도시', '해양 모험', '중세 시장', '우주 정거장', '무협 문파', '동화 나레이터', '퀴즈 진행'].map((name, i) => ({ id: 'm' + (i + 1), name, note: '모듈 ' + (i + 1) }));

/* re-review round: reference rows for the service addresses that moved to 연결 (DS-014) */
sec('chatfeat.voice');
nv('chatfeat.refVoicevox', '연결: VOICEVOX', 'Connection: VOICEVOX', 'models.voicevoxUrl', { prov: 'VOICEVOX', nk: 'conn', syn: 'voicevox 보이스복스 주소 url' });
nv('chatfeat.refFish', '연결: Fish Speech', 'Connection: Fish Speech', 'models.fishUrl', { prov: 'Fish Speech', nk: 'conn', syn: 'fish speech 피시 스피치 주소 url' });
sec('chatfeat.imagegen');
nv('chatfeat.refWebui', '연결: Stable Diffusion WebUI', 'Connection: Stable Diffusion WebUI', 'models.webuiUrl', { prov: 'Stable Diffusion WebUI', nk: 'conn', syn: 'webui automatic1111 스테이블 디퓨전 주소 url' });
nv('chatfeat.refComfy', '연결: ComfyUI', 'Connection: ComfyUI', 'models.comfyUrl', { prov: 'ComfyUI', nk: 'conn', syn: 'comfyui 컴피유아이 주소 url' });

/* ---------------------------------------------------------------- review round: post-process (defaults, scope, moves, groups, dependencies, synonyms) */
// DS-011: every service key lives in 연결
const MOVE = { 'chatfeat.voicevoxUrl': 'models.voicevoxUrl', 'chatfeat.fishUrl': 'models.fishUrl', 'chatfeat.imgWebuiUrl': 'models.webuiUrl', 'chatfeat.imgComfyUrl': 'models.comfyUrl', 'chatfeat.elevenKey': 'models.elevenKey', 'chatfeat.trDeeplKey': 'models.deeplKey', 'chatfeat.trDeeplFree': 'models.deeplFree', 'chatfeat.trDeeplxUrl': 'models.deeplxUrl', 'chatfeat.trDeeplxToken': 'models.deeplxToken', 'chatfeat.imgWaveKey': 'models.waveKey' };
rows.forEach((r) => { if (MOVE[r.id]) { r.id = MOVE[r.id]; r.sec = 'models.connections'; r.page = 'models'; } });
// R-10 / DS-010: marker and reset only where today's code has a default (src/ts/storage/database.svelte.ts, line numbers in comments)
const REAL = { 'models.hideApiKey': true /* :565 */, 'models.dynamicRegistry': true /* :719 */, 'input.sendWithEnter': true /* :370 */, 'adv.imageCompress': true /* :375 */, 'display.animSpeed': 0.4 /* :403 */, 'adv.genTimes': 1 /* :454 */, 'adv.heightMode': 'normal' /* :473 */, 'adv.autoContinue': false /* :490 */, 'adv.autoContinueMin': 0 /* :491 */, 'display.lineHeight': 1.25 /* :552 */, 'adv.assetDiff': 4 /* :600 */, 'display.savingIcon': false /* :601 */, 'adv.cssError': true /* :624 */, 'display.hideImages': false /* :684 */, 'input.autoScroll': true /* :704 */, 'input.alwaysScroll': false /* :705 */, 'input.branchFolder': true /* :717 */, 'input.menuBottom': false /* :718 */, 'input.longPressEdit': false /* :732 */, 'display.lowPower': false /* new setting, SPEC 4 */ };
const REAL_V = { 'display.lineHeight': 1.5 };
rows.forEach((r) => { if (Object.prototype.hasOwnProperty.call(REAL, r.id)) { r.d = REAL[r.id]; r.v = Object.prototype.hasOwnProperty.call(REAL_V, r.id) ? REAL_V[r.id] : r.d; } else delete r.d; });
// R-12 / DS-012: device scope only on low power
rows.forEach((r) => { if (r.scope === 'device' && r.id !== 'display.lowPower') delete r.scope; });
// DS-013: providers; configured ones show, the rest collapse into "다른 서비스"
const CONN_G = { openaiKey: 'OpenAI', claudeKey: 'Anthropic', googleKey: 'Google AI Studio', vertexProject: 'Vertex AI', vertexEmail: 'Vertex AI', vertexKey: 'Vertex AI', vertexRegion: 'Vertex AI', awsKey: 'AWS', mistralKey: 'Mistral', cohereKey: 'Cohere', novelaiKey: 'NovelAI', naiAdventure: 'NovelAI', naiAppendName: 'NovelAI', novellistKey: 'NovelList', mancerKey: 'Mancer', openrouterKey: 'OpenRouter', orOrder: 'OpenRouter', orOnly: 'OpenRouter', orIgnore: 'OpenRouter', orFallback: 'OpenRouter', orMiddleOut: 'OpenRouter', nanogptKey: 'NanoGPT', nanogptSub: 'NanoGPT', ollamaUrl: 'Ollama', ollamaKey: 'Ollama', ollamaFormat: 'Ollama', proxyUrl: '리버스 프록시', proxyKey: '리버스 프록시', proxyModel: '리버스 프록시', proxyFormat: '리버스 프록시', proxyTokenizer: '리버스 프록시', oobaMode: '리버스 프록시', oobaChatMode: '리버스 프록시', oobaPrefix: '리버스 프록시', koboldUrl: 'Kobold', hordeKey: 'Horde', textgenUrl: 'textgen WebUI', elevenKey: 'ElevenLabs', voicevoxUrl: 'VOICEVOX', fishUrl: 'Fish Speech', webuiUrl: 'Stable Diffusion WebUI', comfyUrl: 'ComfyUI', deeplKey: 'DeepL', deeplFree: 'DeepL', deeplxUrl: 'DeepLX', deeplxToken: 'DeepLX', waveKey: 'WaveSpeed' };
const CONFIGURED = ['OpenAI', 'Anthropic', 'Google AI Studio'];
rows.forEach((r) => { if (r.sec === 'models.connections' && r.id.startsWith('models.')) { const g = CONN_G[r.id.slice(7)]; if (g) { r.g = g; if (!CONFIGURED.includes(g) && (r.type === 'secret' || r.type === 'text')) r.v = ''; if (CONFIGURED.includes(g) && r.type === 'secret' && !r.v) r.v = 'fake-key-0000-' + g.slice(0, 3).toLowerCase(); } } });
// R-09: a row can depend on another row (switch eq / select in)
const TTS_ANY = ['browser', 'elevenlabs', 'openai', 'voicevox', 'fish', 'vits'];
const IMG_ANY = ['webui', 'novelai', 'comfyui'];
const DEPS = {
  'adv.showDeprecatedTrigger': { id: 'adv.showUnrec', eq: true }, 'adv.easyPanel': { id: 'adv.proTools', eq: true },
  'models.memModel': { id: 'models.sepModels', eq: true }, 'models.transModel': { id: 'models.sepModels', eq: true }, 'models.emoModel': { id: 'models.sepModels', eq: true }, 'models.otherModel': { id: 'models.sepModels', eq: true },
  'models.jsonSchemaText': { id: 'models.jsonSchema', eq: true }, 'models.suggestPrompt': { id: 'models.autoSuggest', eq: true },
  'chatfeat.elevenVoice': { id: 'chatfeat.ttsEngine', in: ['elevenlabs'] }, 'chatfeat.refEleven': { id: 'chatfeat.ttsEngine', in: ['elevenlabs'] }, 'chatfeat.refOpenaiTts': { id: 'chatfeat.ttsEngine', in: ['openai'] }, 'chatfeat.openaiVoice': { id: 'chatfeat.ttsEngine', in: ['openai'] },
  'chatfeat.voicevoxUrl': { id: 'chatfeat.ttsEngine', in: ['voicevox'] }, 'chatfeat.voicevoxSpeaker': { id: 'chatfeat.ttsEngine', in: ['voicevox'] }, 'chatfeat.fishUrl': { id: 'chatfeat.ttsEngine', in: ['fish'] },
  'chatfeat.ttsSpeed': { id: 'chatfeat.ttsEngine', in: TTS_ANY }, 'chatfeat.ttsAuto': { id: 'chatfeat.ttsEngine', in: TTS_ANY }, 'chatfeat.ttsSplit': { id: 'chatfeat.ttsEngine', in: TTS_ANY }, 'chatfeat.ttsSkipCode': { id: 'chatfeat.ttsEngine', in: TTS_ANY },
  'chatfeat.memPreset': { id: 'chatfeat.memType', in: ['hypav3'] }, 'chatfeat.memRatio': { id: 'chatfeat.memType', in: ['supa', 'hanurai', 'hypav2', 'hypav3'] }, 'chatfeat.memChunk': { id: 'chatfeat.memType', in: ['supa', 'hypav2', 'hypav3'] }, 'chatfeat.memRecent': { id: 'chatfeat.memType', in: ['hypav2', 'hypav3'] }, 'chatfeat.memEmbed': { id: 'chatfeat.memType', in: ['hypav2', 'hypav3'] }, 'chatfeat.memSim': { id: 'chatfeat.memType', in: ['hypav3'] }, 'chatfeat.memAuto': { id: 'chatfeat.memType', in: ['hypav2', 'hypav3'] }, 'chatfeat.memPrompt': { id: 'chatfeat.memType', in: ['supa', 'hypav2', 'hypav3'] }, 'chatfeat.memRemovePunct': { id: 'chatfeat.memType', in: ['hypav2', 'hypav3'] },
  'chatfeat.emoPrompt': { id: 'chatfeat.emoMethod', in: ['llm'] }, 'chatfeat.emoDefault': { id: 'chatfeat.emoMethod', in: ['classify', 'llm'] }, 'chatfeat.emoShow': { id: 'chatfeat.emoMethod', in: ['classify', 'llm'] }, 'chatfeat.emoSize': { id: 'chatfeat.emoMethod', in: ['classify', 'llm'] }, 'chatfeat.emoCache': { id: 'chatfeat.emoMethod', in: ['classify', 'llm'] }, 'chatfeat.emoSticker': { id: 'chatfeat.emoMethod', in: ['classify', 'llm'] },
  'chatfeat.imgWebuiUrl': { id: 'chatfeat.imgProvider', in: ['webui'] }, 'chatfeat.imgSteps': { id: 'chatfeat.imgProvider', in: ['webui', 'novelai'] }, 'chatfeat.imgCfg': { id: 'chatfeat.imgProvider', in: ['webui', 'novelai'] }, 'chatfeat.imgSampler': { id: 'chatfeat.imgProvider', in: ['webui', 'novelai'] },
  'chatfeat.imgW': { id: 'chatfeat.imgProvider', in: IMG_ANY }, 'chatfeat.imgH': { id: 'chatfeat.imgProvider', in: IMG_ANY }, 'chatfeat.imgPositive': { id: 'chatfeat.imgProvider', in: IMG_ANY }, 'chatfeat.imgNegative': { id: 'chatfeat.imgProvider', in: IMG_ANY },
  'chatfeat.imgNaiModel': { id: 'chatfeat.imgProvider', in: ['novelai'] }, 'chatfeat.imgNaiSmea': { id: 'chatfeat.imgProvider', in: ['novelai'] }, 'chatfeat.refNai': { id: 'chatfeat.imgProvider', in: ['novelai'] },
  'chatfeat.imgComfyUrl': { id: 'chatfeat.imgProvider', in: ['comfyui'] }, 'chatfeat.imgComfyFlow': { id: 'chatfeat.imgProvider', in: ['comfyui'] },
  'chatfeat.imgOpenaiModel': { id: 'chatfeat.imgProvider', in: ['openai'] }, 'chatfeat.imgQuality': { id: 'chatfeat.imgProvider', in: ['openai'] }, 'chatfeat.refOpenaiImg': { id: 'chatfeat.imgProvider', in: ['openai'] }, 'chatfeat.refWave': { id: 'chatfeat.imgProvider', in: ['wavespeed'] },
  'chatfeat.imgStrength': { id: 'chatfeat.imgProvider', in: IMG_ANY }, 'chatfeat.imgSeed': { id: 'chatfeat.imgProvider', in: IMG_ANY }, 'chatfeat.imgAuto': { id: 'chatfeat.imgProvider', in: IMG_ANY.concat(['openai', 'wavespeed']) }, 'chatfeat.imgRefChar': { id: 'chatfeat.imgProvider', in: IMG_ANY.concat(['openai', 'wavespeed']) },
  'chatfeat.refVoicevox': { id: 'chatfeat.ttsEngine', in: ['voicevox'] }, 'chatfeat.refFish': { id: 'chatfeat.ttsEngine', in: ['fish'] }, 'chatfeat.refWebui': { id: 'chatfeat.imgProvider', in: ['webui'] }, 'chatfeat.refComfy': { id: 'chatfeat.imgProvider', in: ['comfyui'] },
  'chatfeat.refDeepl': { id: 'chatfeat.trType', in: ['deepl'] }, 'chatfeat.refDeeplx': { id: 'chatfeat.trType', in: ['deeplx'] }, 'chatfeat.trSource': { id: 'chatfeat.trType', in: ['google', 'bergamot'] }, 'chatfeat.trHtml': { id: 'chatfeat.trType', in: ['bergamot'] },
};
rows.forEach((r) => { if (DEPS[r.id]) r.dep = DEPS[r.id]; });
// R-03: everyday-word synonyms (KO first), appended to the synonym bag (rendered only as the single matched word)
const SYN_ADD = {
  'display.colorScheme': '다크 다크모드 어둡게 어두운 밝게 라이트 라이트모드 dark mode light', 'display.lowPower': '배터리 절전 성능 느림 느려요 버벅 렉 저사양 부드럽게 battery slow lag performance',
  'chatfeat.ttsEngine': '목소리 음성 소리 읽어주기 낭독 보이스 voice', 'display.zoom': '글자 글씨 폰트크기 크게 작게 font', 'display.font': '폰트 서체 글씨체', 'models.temperature': '창의성 창의적 무작위 무작위성 랜덤 randomness creativity',
  'models.mainModel': '모델 바꾸기 모델 변경 모델 선택 llm 엔진', 'models.hideApiKey': '키 가리기 키 숨김 보안 마스크 비밀', 'display.notification': '푸시 알림 알려주기', 'data.saveFull': '백업 내보내기 저장하기 복사본',
  'input.swipe': '밀기 스와이프 리롤 새 답변', 'models.openaiKey': '오픈에이아이 챗지피티 지피티 gpt', 'models.claudeKey': '앤트로픽 클로드 claude', 'models.googleKey': '구글 제미나이 젬마 gemini', 'models.vertexProject': '버텍스', 'models.mistralKey': '미스트랄', 'models.cohereKey': '코히어', 'models.openrouterKey': '오픈라우터', 'models.nanogptKey': '나노지피티', 'models.ollamaUrl': '올라마', 'models.novelaiKey': '노벨에이아이', 'models.elevenKey': '일레븐랩스', 'models.deeplKey': '딥엘', 'models.deeplxUrl': '딥엘엑스', 'models.koboldUrl': '코볼드', 'models.hordeKey': '호드', 'models.waveKey': '웨이브스피드',
  'display.theme': '모양 화면 스타일 레이아웃', 'adv.autoContinue': '이어쓰기 끊김', 'chatfeat.trClear': '캐시 삭제 비우기', 'data.cleanCold': '정리 청소 용량 공간 확보',
};
rows.forEach((r) => { if (SYN_ADD[r.id]) r.syn = (r.syn || '') + ' ' + SYN_ADD[r.id]; });
rows.forEach((r) => { if (r.id === 'display.textAreaText') r.ko = '입력창 텍스트 크기'; });
// stable order by section order (so ties follow the page order)
const secIdx = Object.fromEntries(SECTIONS.map((x, i) => [x.id, i]));
rows.sort((a, b) => secIdx[a.sec] - secIdx[b.sec]);

const PERSONA_EN = ['Default persona', 'Travel writer', 'High school student', 'Detective', 'Adventurer', 'Mage', 'Teacher', 'Engineer', 'Pirate captain', 'Librarian', 'Test persona', 'Reviewer'];
personas.forEach((p, i) => { p.noteEn = PERSONA_EN[i]; });
const PLUGIN_EN = ['Counts words', 'Polishes translations', 'Rolls dice', 'Shows emotions as icons', 'Exports the chat to a file', 'Tidies lorebook entries', 'Shows the current weather', 'Sends favourite replies fast', 'Shows the story timeline as a table', 'Helps with Markdown', 'Plays music to fit the mood', 'Shows token counts in advance', 'Finds problems in prompts', 'Shows character images in a gallery', 'Measures focus time'];
plugins.forEach((p, i) => { p.noteEn = PLUGIN_EN[i]; });
modules.forEach((m, i) => { m.noteEn = 'Module ' + (i + 1); });
// N-03: page aliases (old names and phrases) for pinning
const PAGE_AL = { models: '채팅 봇|채팅봇|모델 설정|프리셋 설정|chat bot|model settings', chatfeat: '다른 봇|기타 봇|other bots|auxiliary', display: '화면 설정|디스플레이 설정|display settings', input: '입력 설정|접근성 설정|accessibility settings', lang: '언어 설정|language settings', persona: '페르소나 설정', ext: '확장 기능|plugins and modules', data: '백업 & 파일|백업과 파일|backup and files', keys: '단축키 설정|핫키|hotkey', adv: '고급 설정|advanced settings' };
PAGES.forEach((p) => { p.al = PAGE_AL[p.id] || ''; });
// re-review round synonyms (fresh phrases with a real target)
const SYN3 = { 'display.colorScheme': '밤모드 night', 'models.hideApiKey': '비밀번호 password', 'models.maxResponse': '대답 답변 길이 length response', 'chatfeat.memType': '기억력 기억', 'chatfeat.ttsEngine': '소리 sound 읽어줘', 'input.sendWithEnter': '엔터로 줄바꿈', 'models.mainPrompt': '수정 편집', 'models.editBlocks': '수정', 'chatfeat.imgProvider': '그림 그리기', 'models.googleKey': '제미니', 'models.maxContext': '문맥', 'display.lowPower': '버벅임 발열 절약 뜨거워요', 'display.lineHeight': 'spacing', 'data.cleanCold': '지우기 비우기 delete erase remove', 'display.zoom': '큰 크게 bigger larger big' };
rows.forEach((r) => { if (SYN3[r.id]) r.syn = (r.syn || '') + ' ' + SYN3[r.id]; });
window.SS1_DATA = { PAGES, SECTIONS, rows, presets, models, connections, personas, plugins, modules };
})();
