/* Settings slice 4 (parameters) fixtures and copy. Synthetic; loaded after data.js, data2.js and data3.js, before slice2.js / slice3.js / slice4.js / slice1.js.
   Mutates window.SS1_DATA in place (rows, models, presets, connections) so slice 1 to 3 code keeps working on the same arrays, then publishes window.SS4_DATA.
   Everything is invented: keys are "fake-key-0000-...", hosts are *.invalid. Nothing here is read from or written to the real app.
   Sets (?set=): demo (default; any set name slices 1 to 3 know also gives this one), service (NovelAI / textgen / NovelList presets), over (a model whose limits the preset exceeds), empty (every value at its default).
   Units: rows hold DISPLAY units (temperature 0.00 to 2.00); SS4_DATA.toStored() gives the unit today's store uses (0 to 200), see SLICE4_SPEC section 2.3.
   Floor devices: no optional chaining, nullish coalescing, .at() or replaceAll in this file. */
(() => {
'use strict';
const D = window.SS1_DATA, D3 = window.SS3_DATA;
const Q = new URLSearchParams(location.search);
const SET4 = ['demo', 'service', 'over', 'empty'].includes(Q.get('set')) ? Q.get('set') : 'demo';
const rowOf = (id) => D.rows.find((r) => r.id === id);
const hasC = (id) => D3.CX.some((c) => c.id === id);

/* ------------------------------------------------------------------ groups (SLICE4_SPEC 2.1) */
const GROUPS = [
  { id: 'length', ko: '길이', en: 'Length' }, { id: 'random', ko: '무작위성', en: 'Randomness' }, { id: 'repeat', ko: '반복', en: 'Repetition' },
  { id: 'think', ko: '사고', en: 'Thinking' }, { id: 'other', ko: '기타', en: 'Other' },
];

/* ------------------------------------------------------------------ parameters. t.ko / t.en = [label, one plain sentence, "lower" phrase, "higher" phrase, longer help] */
const SEG_RE = [['minimal', '최소', 'Minimal'], ['low', '낮음', 'Low'], ['medium', '보통', 'Medium'], ['high', '높음', 'High'], ['xhigh', '최고', 'Max']];
const PARAMS = [
  { key: 'maxContext', id: 'models.maxContext', group: 'length', kind: 'number', api: 'max_context', min: 0, max: 2000000, step: 1, dec: 0, def: 16000, sendable: false, task: false, limit: 'ctx',
    hint: ['토큰 수를 직접 입력해요', 'Type a token count'],
    t: { ko: ['최대 컨텍스트', '모델에 보낼 수 있는 전체 길이예요 (토큰)', '', '', '프롬프트, 대화 기록, 기억을 모두 합친 길이의 한도예요. 모델이 받을 수 있는 길이보다 크게 두면 요청이 실패하거나 앞부분이 잘릴 수 있어요. 길게 두면 더 많은 대화를 기억하지만 시간과 비용이 늘어요.'],
         en: ['Max context', 'How much may be sent to the model (tokens)', '', '', 'The limit on prompt, chat history and memory taken together. Above what the model accepts, the request may fail or lose its beginning. A longer limit remembers more of the chat but costs more time and money.'] },
    syn: '최대 컨텍스트 문맥 길이 max context window tokens context size 토큰 maxContext 컨텍스트 크기' },
  { key: 'maxResponse', id: 'models.maxResponse', group: 'length', kind: 'number', api: 'max_tokens', min: 0, max: 2000000, step: 1, dec: 0, def: 1000, sendable: false, task: false, limit: 'out',
    hint: ['토큰 수를 직접 입력해요', 'Type a token count'],
    t: { ko: ['최대 응답', '한 번에 쓸 수 있는 답변 길이예요 (토큰)', '', '', '답변 하나가 이 길이를 넘기면 도중에 끊겨요. 짧게 두면 빠르고 저렴하고, 길게 두면 긴 장면도 한 번에 써요. 모델마다 낼 수 있는 길이가 달라서, 한도를 넘기면 모델의 최대치가 대신 쓰여요.'],
         en: ['Max response', 'How long one reply may be (tokens)', '', '', 'A reply that passes this length is cut off. A short limit is faster and cheaper; a long one can write a whole scene at once. Models differ in how much they can write, so past the limit the model\'s maximum is used instead.'] },
    syn: '최대 응답 응답 길이 답변 길이 max tokens max_tokens max_new_tokens maxOutputTokens max output response length 출력 길이 토큰' },
  { key: 'temperature', id: 'models.temperature', group: 'random', kind: 'slider', needs: 'temperature', api: 'temperature', min: 0, max: 2, step: 0.01, dec: 2, def: 1, sendable: true, defSent: true, scale: 100, task: true,
    t: { ko: ['온도', '답변이 얼마나 다양할지 정해요', '일관되고', '다양해요', '값이 낮을수록 프롬프트를 충실히 따르지만 기계적일 수 있고, 높을수록 창의적이지만 말이 흐트러질 수 있어요. 처음에는 1.00 근처로 두고, 답이 너무 들쭉날쭉하면 낮춰 보세요. 공급자에 따라 받는 범위가 달라서 1까지만 받는 곳도 있어요.'],
         en: ['Temperature', 'How varied replies are', 'steadier', 'more varied', 'A low value follows the prompt closely but can sound mechanical; a high value is more creative but can wander. Start near 1.00 and lower it if replies are too uneven. Providers accept different ranges; some stop at 1.'] },
    syn: '온도 temperature randomness 무작위성 창의성 창의적 랜덤 temp creativity' },
  { key: 'topP', id: 'models.topP', group: 'random', kind: 'slider', needs: 'top_p', api: 'top_p', min: 0, max: 1, step: 0.01, dec: 2, def: 1, sendable: true, defSent: true, task: true,
    t: { ko: ['Top P', '다음 단어를 고를 후보의 폭이에요', '안전한 단어만', '폭넓게', '확률이 높은 순서로 더해서 이 값이 될 때까지의 후보 안에서만 다음 단어를 골라요. 낮추면 무난한 단어만 쓰고, 1이면 모든 후보를 써요. 온도와 함께 크게 바꾸면 효과를 알기 어려우니 하나씩 바꿔요.'],
         en: ['Top P', 'How wide the pool of next words is', 'safe words only', 'wider', 'The next word is picked only from the likeliest candidates that add up to this value. Lower keeps to safe words; 1 uses every candidate. Change it and temperature one at a time so you can tell what each does.'] },
    syn: 'top p top_p nucleus sampling 누적 확률 샘플링' },
  { key: 'topK', id: 'models.topK', group: 'random', kind: 'slider', needs: 'top_k', api: 'top_k', min: 0, max: 100, step: 1, dec: 0, def: 0, sendable: true, defSent: true, task: true,
    t: { ko: ['Top K', '다음 단어 후보를 상위 몇 개로 줄여요', '무난하고', '다양해요', '0이면 후보를 줄이지 않아요. 값이 작을수록 가장 그럴듯한 단어만 쓰고, 크면 다양한 단어가 나와요. 이 값을 받지 않는 모델도 있어요.'],
         en: ['Top K', 'Keeps only the top few next-word candidates', 'plainer', 'more varied', '0 means no cut. A small value keeps only the likeliest words; a large one lets more variety through. Some models ignore it.'] },
    syn: 'top k top_k 후보 샘플링' },
  { key: 'minP', id: 'models.minP', group: 'random', kind: 'slider', needs: 'min_p', api: 'min_p', min: 0, max: 1, step: 0.01, dec: 2, def: 0, sendable: true, defSent: true, task: true,
    t: { ko: ['Min P', '가장 유력한 후보에 비해 너무 낮은 후보를 걸러요', '거르지 않고', '더 많이 걸러요', '가장 유력한 단어의 확률에 이 비율을 곱한 값보다 낮은 후보를 버려요. 0이면 끄는 것과 같아요. 로컬 모델에서 많이 써요.'],
         en: ['Min P', 'Drops candidates far less likely than the best one', 'filters nothing', 'filters more', 'Candidates less likely than the best word\'s probability times this ratio are dropped. 0 turns it off. Common with local models.'] },
    syn: 'min p min_p' },
  { key: 'topA', id: 'models.topA', group: 'random', kind: 'slider', needs: 'top_a', api: 'top_a', min: 0, max: 1, step: 0.01, dec: 2, def: 0, sendable: true, defSent: true, task: true,
    t: { ko: ['Top A', '유력한 후보가 뚜렷할수록 더 엄격하게 걸러요', '거르지 않고', '더 엄격해요', '가장 유력한 후보의 확률을 제곱한 값에 비례해 낮은 후보를 버려요. 0이면 끄는 것과 같아요.'],
         en: ['Top A', 'Filters harder when one candidate clearly leads', 'filters nothing', 'stricter', 'Candidates are dropped in proportion to the square of the best word\'s probability. 0 turns it off.'] },
    syn: 'top a top_a' },
  { key: 'repPenalty', id: 'models.repPenalty', group: 'repeat', kind: 'slider', needs: 'repetition_penalty', api: 'repetition_penalty', min: 0, max: 2, step: 0.01, dec: 2, def: 1, sendable: true, defSent: true, task: true,
    t: { ko: ['반복 억제', '같은 말을 되풀이하지 않게 해요', '덜 막고', '더 막아요', '이미 나온 단어가 다시 나올 확률을 낮춰요. 1이면 아무 영향이 없고, 클수록 더 강하게 막아요. 너무 크면 말이 어색해져요.'],
         en: ['Repetition penalty', 'Discourages repeating itself', 'allows more', 'blocks more', 'Lowers the chance of a word that already appeared. 1 changes nothing; larger values block harder. Too large makes the text awkward.'] },
    syn: '반복 억제 반복 패널티 repetition penalty repetition_penalty repeat 되풀이' },
  { key: 'freqPenalty', id: 'models.freqPenalty', group: 'repeat', kind: 'slider', needs: 'frequency_penalty', api: 'frequency_penalty', min: 0, max: 2, step: 0.01, dec: 2, def: 0, sendable: true, defSent: true, scale: 100, task: true,
    t: { ko: ['빈도 패널티', '자주 나온 단어일수록 덜 쓰게 해요', '되풀이를 허용하고', '더 줄여요', '단어가 나온 횟수에 비례해 점수를 깎아요. 같은 표현이 계속 나올 때 조금 올려 보세요. 0이면 끄는 것과 같아요.'],
         en: ['Frequency penalty', 'Uses words less the more they have appeared', 'allows repeats', 'cuts more', 'A word\'s score drops in proportion to how often it appeared. Raise it a little when the same phrase keeps coming back. 0 turns it off.'] },
    syn: '빈도 패널티 frequency penalty frequency_penalty frequence' },
  { key: 'presPenalty', id: 'models.presPenalty', group: 'repeat', kind: 'slider', needs: 'presence_penalty', api: 'presence_penalty', min: 0, max: 2, step: 0.01, dec: 2, def: 0, sendable: true, defSent: true, scale: 100, task: true,
    t: { ko: ['존재 패널티', '한 번이라도 나온 단어를 덜 쓰게 해요', '같은 주제에 머물고', '새 주제로 가요', '단어가 한 번이라도 나왔으면 같은 점수만큼 깎아요. 올리면 새로운 소재로 넘어가려는 경향이 커져요. 0이면 끄는 것과 같아요.'],
         en: ['Presence penalty', 'Uses words less once they have appeared', 'stays on topic', 'moves to new topics', 'A word that appeared even once loses the same amount of score. Raising it nudges the story toward new material. 0 turns it off.'] },
    syn: '존재 패널티 presence penalty presence_penalty presense 프리센스 패널티' },
  { key: 'reasoningEffort', id: 'models.reasoningEffort', group: 'think', kind: 'seg', needs: 'reasoning_effort', api: 'reasoning_effort', def: 'low', sendable: false, task: true, opts: SEG_RE, stored: { minimal: -1, low: 0, medium: 1, high: 2, xhigh: 3 },
    t: { ko: ['추론 수준', '답하기 전에 얼마나 깊이 생각할지 정해요', '빠르게', '깊게', '추론을 지원하는 모델이 답하기 전에 쓰는 생각의 양이에요. 높일수록 복잡한 문제에 강하지만 느리고 비용이 늘어요. 일상 대화에는 낮음이면 충분해요.'],
         en: ['Reasoning effort', 'How deeply it thinks before replying', 'faster', 'deeper', 'The amount of thinking a reasoning model does before it answers. Higher is better at hard problems but slower and costlier. Low is enough for everyday chat.'] },
    syn: '추론 수준 reasoning effort reasoning_effort thinking 생각 수준 추론' },
  { key: 'verbosity', id: 'models.verbosity', group: 'think', kind: 'seg', needs: 'verbosity', api: 'verbosity', def: 'medium', sendable: false, task: true, opts: [['low', '짧게', 'Short'], ['medium', '보통', 'Medium'], ['high', '길게', 'Long']], stored: { low: 0, medium: 1, high: 2 },
    t: { ko: ['답변 길이 성향', '답변을 얼마나 길게 쓰는 편인지 정해요', '짧게', '길게', '프롬프트를 바꾸지 않고 답변의 길이 경향만 조절해요. 최대 응답과 달리 답변을 자르지 않고, 모델이 쓰는 분량 자체를 바꿔요.'],
         en: ['Verbosity', 'How long its replies tend to be', 'shorter', 'longer', 'Changes how long replies tend to be without touching the prompt. Unlike max response it never cuts a reply; it changes how much the model chooses to write.'] },
    syn: '답변 길이 성향 verbosity 장황함 길이 성향' },
  { key: 'thinkingType', id: 'models.thinkingType', group: 'think', kind: 'seg', needs: 'thinking', reveal: 'claudeThinking', api: 'thinking.type', def: 'budget', sendable: false, task: true, opts: [['off', '끔', 'Off'], ['budget', '예산', 'Budget'], ['adaptive', '적응형', 'Adaptive']], stored: { off: 'off', budget: 'budget', adaptive: 'adaptive' },
    hint: ['끄면 바로 답하고, 예산이나 적응형이면 먼저 생각해요', 'Off answers at once; Budget and Adaptive think first'],
    t: { ko: ['사고 모드', '답하기 전에 생각하는 방식을 정해요', '', '', '예산은 생각에 쓸 토큰 수를 직접 정하고, 적응형은 모델이 질문에 맞춰 스스로 정해요. 적응형은 지원하는 Claude 모델에서만 동작해요.'],
         en: ['Thinking mode', 'How it thinks before replying', '', '', 'Budget lets you set how many tokens thinking may use; Adaptive lets the model decide per question. Adaptive works only on Claude models that support it.'] },
    syn: '사고 모드 thinking mode thinking type thinkingType claude extended thinking 사고 생각' },
  { key: 'thinkingTokens', id: 'models.thinkingTokens', group: 'think', kind: 'slider', needs: 'thinking', reveal: 'claudeThinking', api: 'thinking.budget_tokens', min: 0, max: 64000, step: 200, dec: 0, def: 4096, sendable: true, defSent: false, task: true,
    t: { ko: ['사고 토큰', '생각에 쓸 수 있는 토큰 수예요', '짧게 생각하고', '오래 생각해요', '사고 모드가 예산일 때만 쓰여요. 최대 응답보다 작아야 해요. 서비스 기본값을 쓰려면 보내기를 꺼요.'],
         en: ['Thinking tokens', 'How many tokens it may spend thinking', 'thinks briefly', 'thinks longer', 'Used only when thinking mode is Budget. Keep it smaller than the max response. Turn Send off to use the service default.'] },
    syn: '사고 토큰 thinking tokens thinkingTokens budget_tokens thinking budget 생각 예산' },
  { key: 'adaptiveEffort', id: 'models.adaptiveEffort', group: 'think', kind: 'seg', needs: 'thinking', reveal: 'claudeAdaptiveThinking', api: 'adaptive_thinking_effort', def: 'high', sendable: false, task: true, opts: [['low', '낮음', 'Low'], ['medium', '보통', 'Medium'], ['high', '높음', 'High'], ['max', '최대', 'Max']], stored: { low: 'low', medium: 'medium', high: 'high', max: 'max' },
    t: { ko: ['적응형 사고 수준', '적응형일 때 얼마나 깊이 생각할지 정해요', '가볍게', '깊게', '사고 모드가 적응형일 때만 쓰여요. 모델이 질문마다 생각의 양을 정하는데, 이 값은 그 상한의 성향을 알려 줘요.'],
         en: ['Adaptive thinking level', 'How deeply it thinks when the mode is Adaptive', 'lighter', 'deeper', 'Used only when thinking mode is Adaptive. The model decides per question; this tells it how far it may lean.'] },
    syn: '적응형 사고 수준 adaptive thinking effort adaptiveThinkingEffort' },
  { key: 'dsThinking', id: 'models.dsThinking', group: 'think', kind: 'seg', needs: 'ds_thinking', reveal: 'deepSeekThinkingToggle', api: 'deepseek_thinking_type', def: 'off', sendable: false, task: true, opts: [['off', '끔', 'Off'], ['enabled', '켬', 'On']], stored: { off: 'off', enabled: 'enabled' },
    hint: ['끄면 바로 답하고, 켜면 먼저 생각해요', 'Off answers at once; On thinks first'],
    t: { ko: ['DeepSeek 사고', 'DeepSeek 모델이 먼저 생각할지 정해요', '', '', '켜면 DeepSeek가 답하기 전에 생각해요. 생각하는 동안 시간이 더 걸려요.'],
         en: ['DeepSeek thinking', 'Whether a DeepSeek model thinks first', '', '', 'When on, DeepSeek thinks before it answers, which takes longer.'] },
    syn: 'deepseek 사고 딥시크 deepseek thinking type deepseekThinkingType' },
  { key: 'dsEffort', id: 'models.dsEffort', group: 'think', kind: 'seg', needs: 'ds_thinking', reveal: 'deepSeekThinkingToggle', api: 'deepseek_reasoning_effort', def: 'high', sendable: false, task: true, opts: [['high', '높음', 'High'], ['max', '최대', 'Max']], stored: { high: 'high', max: 'max' },
    t: { ko: ['DeepSeek 추론 수준', 'DeepSeek 사고의 깊이예요', '깊게', '가장 깊게', 'DeepSeek 사고가 켜져 있을 때만 쓰여요. 최대는 높음보다 오래 생각해요.'],
         en: ['DeepSeek reasoning effort', 'How deep DeepSeek thinking goes', 'deep', 'deepest', 'Used only when DeepSeek thinking is on. Max thinks longer than High.'] },
    syn: 'deepseek 추론 수준 딥시크 deepseek reasoning effort deepseekReasoningEffort' },
  { key: 'seed', id: 'models.seed', group: 'other', kind: 'number', needs: 'seed', api: 'seed', min: -1, max: 999999999, step: 1, dec: 0, def: -1, sendable: false, task: false, global: true, random: true,
    hint: ['무작위로 두려면 -1, 고정하려면 숫자를 넣어요', 'Use -1 for random, or type a number to fix it'],
    t: { ko: ['시드', '같은 값이면 비슷한 답이 나오게 해요', '', '', '시드를 고정하면 같은 입력에 비슷한 답을 얻기 쉬워요. 완전히 같다고 보장하진 않아요. 이 값은 모든 프리셋에 같이 적용돼요.'],
         en: ['Seed', 'Makes the same value give a similar reply', '', '', 'Fixing the seed makes similar replies likelier for the same input; it is not a guarantee of identical text. This value is shared by all presets.'] },
    syn: '시드 seed generationSeed random 무작위 고정 재현' },
];
const BYKEY = Object.fromEntries(PARAMS.map((p) => [p.key, p]));
const SENDABLE = PARAMS.filter((p) => p.sendable).map((p) => p.key);

/* ------------------------------------------------------------------ service samplers (SLICE4_SPEC 4; ranges and defaults are today's, research/slice4-params.md section 4) */
// f: field; kind slider | switch | text; t.ko / t.en = [label, sentence, lower, higher]; like: reuse that parameter's longer help; noDefault: today has none (shown as 보내기 off)
const SVC = {
  ooba: { id: 'ooba', provider: 'textgen', ko: 'textgen / Ooba', en: 'textgen / Ooba', stop: true, rows: [
    { f: 'repetition_penalty', kind: 'slider', min: 1, max: 1.5, step: 0.01, def: 1.15, like: 'repPenalty', t: { ko: ['반복 억제', '같은 말을 되풀이하지 않게 해요', '덜 막고', '더 막아요'], en: ['Repetition penalty', 'Discourages repeating itself', 'allows more', 'blocks more'] } },
    { f: 'length_penalty', kind: 'slider', min: -5, max: 5, step: 0.05, def: 1, help: ['답변 길이를 어느 쪽으로 기울일지 정해요. 1이면 기울이지 않고, 크면 긴 답 쪽, 작으면 짧은 답 쪽이에요.', 'Tilts replies toward longer or shorter. 1 is neutral; larger favours long replies, smaller favours short ones.'], t: { ko: ['길이 패널티', '답변 길이를 늘리거나 줄이는 쪽으로 기울여요', '짧은 답 쪽', '긴 답 쪽'], en: ['Length penalty', 'Tilts replies toward longer or shorter', 'shorter replies', 'longer replies'] } },
    { f: 'top_k', kind: 'slider', min: 0, max: 100, step: 1, def: 20, like: 'topK', t: { ko: ['Top K', '다음 단어 후보를 상위 몇 개로 줄여요', '무난하고', '다양해요'], en: ['Top K', 'Keeps only the top few next-word candidates', 'plainer', 'more varied'] } },
    { f: 'top_p', kind: 'slider', min: 0, max: 1, step: 0.01, def: 0.9, like: 'topP', t: { ko: ['Top P', '다음 단어를 고를 후보의 폭이에요', '안전한 단어만', '폭넓게'], en: ['Top P', 'How wide the pool of next words is', 'safe words only', 'wider'] } },
    { f: 'typical_p', kind: 'slider', min: 0, max: 1, step: 0.01, def: 1, help: ['평범하고 예상하기 쉬운 단어 쪽으로 후보를 좁혀요. 1이면 끄는 것과 같아요.', 'Narrows candidates toward typical, predictable words. 1 turns it off.'], t: { ko: ['Typical P', '평범한 단어 쪽으로 후보를 좁혀요', '좁히지 않고', '더 좁혀요'], en: ['Typical P', 'Narrows candidates toward typical words', 'narrows nothing', 'narrows more'] } },
    { f: 'top_a', kind: 'slider', min: 0, max: 1, step: 0.01, def: 0, like: 'topA', t: { ko: ['Top A', '유력한 후보가 뚜렷할수록 더 엄격하게 걸러요', '거르지 않고', '더 엄격해요'], en: ['Top A', 'Filters harder when one candidate clearly leads', 'filters nothing', 'stricter'] } },
    { f: 'no_repeat_ngram_size', kind: 'slider', min: 0, max: 20, step: 1, def: 0, help: ['같은 단어 묶음이 되풀이되지 않게 해요. 0이면 끄는 것과 같고, 클수록 긴 묶음까지 막아요.', 'Stops the same group of words from repeating. 0 turns it off; larger values block longer groups.'], t: { ko: ['반복 n-gram 금지 크기', '같은 단어 묶음이 되풀이되지 않게 해요', '제한 없이', '긴 묶음도 막아요'], en: ['No-repeat n-gram size', 'Stops the same word group from repeating', 'no limit', 'blocks longer groups'] } },
    { f: 'do_sample', kind: 'switch', def: true, help: ['끄면 가장 그럴듯한 단어만 골라서 답이 늘 같아요. 켜면 확률에 따라 골라요.', 'Off always picks the likeliest word, so replies repeat. On picks by probability.'], t: { ko: ['샘플링 사용', '확률에 따라 단어를 골라요', '끄면 늘 같은 답이고', '켜면 다양해요'], en: ['Use sampling', 'Picks words by probability', 'off repeats itself', 'on varies'] } },
    { f: 'add_bos_token', kind: 'switch', def: true, help: ['프롬프트 맨 앞에 시작 토큰을 붙여요. 모델이 시작 토큰을 기대하면 켜 두세요.', 'Puts a start token at the front of the prompt. Keep it on if the model expects one.'], t: { ko: ['시작 토큰 넣기', '프롬프트 맨 앞에 시작 토큰을 붙여요', '끄면 붙이지 않고', '켜면 붙여요'], en: ['Add start token', 'Puts a start token before the prompt', 'off adds none', 'on adds it'] } },
    { f: 'ban_eos_token', kind: 'switch', def: false, help: ['끝 토큰을 막아서 모델이 스스로 끝내지 못하게 해요. 최대 응답까지 계속 써요.', 'Blocks the end token so the model cannot stop by itself; it keeps writing up to the max response.'], t: { ko: ['끝 토큰 막기', '모델이 스스로 끝내지 못하게 해요', '끄면 알아서 끝내고', '켜면 계속 써요'], en: ['Ban end token', 'Stops the model from ending by itself', 'off lets it finish', 'on keeps writing'] } },
    { f: 'skip_special_tokens', kind: 'switch', def: true, help: ['출력에서 특수 토큰을 빼요. 보통 켜 두는 게 좋아요.', 'Leaves special tokens out of the output. Usually best left on.'], t: { ko: ['특수 토큰 건너뛰기', '출력에서 특수 토큰을 빼요', '끄면 그대로 보이고', '켜면 빼요'], en: ['Skip special tokens', 'Leaves special tokens out of the output', 'off shows them', 'on hides them'] } },
  ] },
  novelai: { id: 'novelai', provider: 'novelai', ko: 'NovelAI', en: 'NovelAI', rows: [
    { f: 'starter', kind: 'text', def: '', ph: '⁂', t: { ko: ['시작 문자열', '프롬프트 앞에 붙이는 문자열이에요', '', ''], en: ['Starter', 'Text put in front of the prompt', '', ''] }, help: ['각 이야기의 첫머리에 붙는 문자열이에요. 비워 두면 붙이지 않아요.', 'Text placed at the start of every story. Leave it empty to add nothing.'] },
    { f: 'seperator', kind: 'text', def: '', ph: ['줄바꿈', 'line break'], t: { ko: ['구분 문자열', '메시지 사이에 넣는 문자열이에요', '', ''], en: ['Separator', 'Text put between messages', '', ''] }, help: ['메시지와 메시지 사이를 나누는 문자열이에요. 비워 두면 줄바꿈을 써요.', 'Text that divides one message from the next. Empty uses a line break.'] },
    { f: 'topP', kind: 'slider', min: 0, max: 1, step: 0.01, def: 0.85, like: 'topP', t: { ko: ['Top P', '다음 단어를 고를 후보의 폭이에요', '안전한 단어만', '폭넓게'], en: ['Top P', 'How wide the pool of next words is', 'safe words only', 'wider'] } },
    { f: 'topK', kind: 'slider', min: 0, max: 100, step: 1, def: 12, like: 'topK', t: { ko: ['Top K', '다음 단어 후보를 상위 몇 개로 줄여요', '무난하고', '다양해요'], en: ['Top K', 'Keeps only the top few next-word candidates', 'plainer', 'more varied'] } },
    { f: 'topA', kind: 'slider', min: 0, max: 1, step: 0.01, def: 0.1, like: 'topA', t: { ko: ['Top A', '유력한 후보가 뚜렷할수록 더 엄격하게 걸러요', '거르지 않고', '더 엄격해요'], en: ['Top A', 'Filters harder when one candidate clearly leads', 'filters nothing', 'stricter'] } },
    { f: 'tailFreeSampling', kind: 'slider', min: 0, max: 1, step: 0.001, dec: 3, def: 0.915, help: ['확률이 낮은 꼬리 부분을 잘라내요. 1이면 끄는 것과 같고, 낮을수록 많이 잘라내요.', 'Trims the unlikely tail. 1 turns it off; lower trims more.'], t: { ko: ['Tail-free', '확률이 낮은 꼬리를 잘라내요', '많이 잘라내고', '거의 안 잘라내요'], en: ['Tail-free sampling', 'Trims the unlikely tail of candidates', 'trims more', 'trims almost nothing'] } },
    { f: 'typicalp', kind: 'slider', min: 0, max: 1, step: 0.01, def: 1, help: ['평범하고 예상하기 쉬운 단어 쪽으로 후보를 좁혀요. 1이면 끄는 것과 같아요.', 'Narrows candidates toward typical, predictable words. 1 turns it off.'], t: { ko: ['Typical P', '평범한 단어 쪽으로 후보를 좁혀요', '더 좁히고', '좁히지 않아요'], en: ['Typical P', 'Narrows candidates toward typical words', 'narrows more', 'narrows nothing'] } },
    { f: 'repetitionPenalty', kind: 'slider', min: 0, max: 3, step: 0.01, def: 2.8, like: 'repPenalty', t: { ko: ['반복 억제', '같은 말을 되풀이하지 않게 해요', '덜 막고', '더 막아요'], en: ['Repetition penalty', 'Discourages repeating itself', 'allows more', 'blocks more'] } },
    { f: 'repetitionPenaltyRange', kind: 'slider', min: 0, max: 8192, step: 1, def: 2048, help: ['반복을 따질 때 얼마나 최근까지 거슬러 올라갈지 정해요(토큰).', 'How far back, in tokens, repetition is checked.'], t: { ko: ['반복 억제 범위', '얼마나 최근까지 되풀이를 살필지 정해요', '가까운 부분만', '멀리까지'], en: ['Repetition penalty range', 'How far back repeats are checked', 'recent text only', 'further back'] } },
    { f: 'repetitionPenaltySlope', kind: 'slider', min: 0, max: 10, step: 0.01, def: 0.02, help: ['가까운 단어일수록 더 세게 막는 정도예요. 0이면 범위 안에서 똑같이 막아요.', 'How much nearer words are punished harder. 0 treats the whole range alike.'], t: { ko: ['반복 억제 기울기', '가까운 단어일수록 더 세게 막아요', '고르게', '가까울수록 세게'], en: ['Repetition penalty slope', 'Punishes nearer words harder', 'even', 'stronger when near'] } },
    { f: 'frequencyPenalty', kind: 'slider', min: 0, max: 2, step: 0.01, def: 0.03, like: 'freqPenalty', t: { ko: ['빈도 패널티', '자주 나온 단어일수록 덜 쓰게 해요', '되풀이를 허용하고', '더 줄여요'], en: ['Frequency penalty', 'Uses words less the more they have appeared', 'allows repeats', 'cuts more'] } },
    { f: 'presencePenalty', kind: 'slider', min: 0, max: 2, step: 0.01, def: 0, like: 'presPenalty', t: { ko: ['존재 패널티', '한 번이라도 나온 단어를 덜 쓰게 해요', '같은 주제에 머물고', '새 주제로 가요'], en: ['Presence penalty', 'Uses words less once they have appeared', 'stays on topic', 'moves to new topics'] } },
    { f: 'mirostat_lr', kind: 'slider', min: 0, max: 1, step: 0.01, def: null, v0: 0.1, help: ['Mirostat은 답의 ‘놀라움’ 수준을 목표에 맞춰 조절해요. 학습률은 얼마나 빨리 맞출지 정해요.', 'Mirostat steers how surprising the text is toward a target. The learning rate sets how fast it adjusts.'], t: { ko: ['Mirostat 학습률', '목표에 얼마나 빨리 맞출지 정해요', '천천히', '빠르게'], en: ['Mirostat learning rate', 'How fast it adjusts to the target', 'slower', 'faster'] } },
    { f: 'mirostat_tau', kind: 'slider', min: 0, max: 6, step: 0.01, def: null, v0: 5, help: ['Mirostat이 맞추려는 ‘놀라움’의 목표 수준이에요. 클수록 더 예측하기 어려운 글이 나와요.', 'The target level of surprise Mirostat aims for. Larger gives less predictable text.'], t: { ko: ['Mirostat 타우', '맞추려는 놀라움의 목표 수준이에요', '예측하기 쉽게', '예측하기 어렵게'], en: ['Mirostat tau', 'The surprise level it aims for', 'more predictable', 'less predictable'] } },
    { f: 'cfg_scale', kind: 'slider', min: 1, max: 3, step: 0.01, def: null, v0: 1.5, help: ['프롬프트를 얼마나 강하게 따를지 정해요. 1이면 보통이고, 클수록 더 강하게 따라요.', 'How strongly the prompt is followed. 1 is normal; larger follows it harder.'], t: { ko: ['CFG 배율', '프롬프트를 얼마나 강하게 따를지 정해요', '느슨하게', '엄격하게'], en: ['CFG scale', 'How strongly the prompt is followed', 'looser', 'stricter'] } },
  ] },
  novellist: { id: 'novellist', provider: 'novellist', ko: 'NovelList', en: 'NovelList', rows: [
    { f: 'top_p', kind: 'slider', min: 0, max: 2, step: 0.01, def: 0.7, like: 'topP', t: { ko: ['Top P', '다음 단어를 고를 후보의 폭이에요', '안전한 단어만', '폭넓게'], en: ['Top P', 'How wide the pool of next words is', 'safe words only', 'wider'] } },
    { f: 'rep_pen', kind: 'slider', min: 0, max: 2, step: 0.01, dec: 4, def: 1.0625, like: 'repPenalty', t: { ko: ['반복 억제', '같은 말을 되풀이하지 않게 해요', '덜 막고', '더 막아요'], en: ['Repetition penalty', 'Discourages repeating itself', 'allows more', 'blocks more'] } },
    { f: 'rep_pen_range', kind: 'slider', min: 0, max: 2048, step: 1, def: 1024, help: ['반복을 따질 때 얼마나 최근까지 거슬러 올라갈지 정해요(토큰).', 'How far back, in tokens, repetition is checked.'], t: { ko: ['반복 억제 범위', '얼마나 최근까지 되풀이를 살필지 정해요', '가까운 부분만', '멀리까지'], en: ['Repetition penalty range', 'How far back repeats are checked', 'recent text only', 'further back'] } },
    { f: 'rep_pen_slope', kind: 'slider', min: 0, max: 10, step: 0.1, def: 1.7, help: ['가까운 단어일수록 더 세게 막는 정도예요. 0이면 범위 안에서 똑같이 막아요.', 'How much nearer words are punished harder. 0 treats the whole range alike.'], t: { ko: ['반복 억제 기울기', '가까운 단어일수록 더 세게 막아요', '고르게', '가까울수록 세게'], en: ['Repetition penalty slope', 'Punishes nearer words harder', 'even', 'stronger when near'] } },
    { f: 'top_k', kind: 'slider', min: 1, max: 500, step: 1, def: 140, like: 'topK', t: { ko: ['Top K', '다음 단어 후보를 상위 몇 개로 줄여요', '무난하고', '다양해요'], en: ['Top K', 'Keeps only the top few next-word candidates', 'plainer', 'more varied'] } },
    { f: 'top_a', kind: 'slider', min: 0, max: 1, step: 0.01, def: 0.08, like: 'topA', t: { ko: ['Top A', '유력한 후보가 뚜렷할수록 더 엄격하게 걸러요', '거르지 않고', '더 엄격해요'], en: ['Top A', 'Filters harder when one candidate clearly leads', 'filters nothing', 'stricter'] } },
    { f: 'typical_p', kind: 'slider', min: 0, max: 1, step: 0.01, def: 1, help: ['평범하고 예상하기 쉬운 단어 쪽으로 후보를 좁혀요. 1이면 끄는 것과 같아요.', 'Narrows candidates toward typical, predictable words. 1 turns it off.'], t: { ko: ['Typical P', '평범한 단어 쪽으로 후보를 좁혀요', '더 좁히고', '좁히지 않아요'], en: ['Typical P', 'Narrows candidates toward typical words', 'narrows more', 'narrows nothing'] } },
  ] },
};
Object.keys(SVC).forEach((k) => SVC[k].rows.forEach((r) => { r.svc = k; r.id = 'models.svc.' + k + '.' + r.f; r.dec = r.dec === undefined ? (r.step && r.step < 0.01 ? 3 : r.step && r.step < 1 ? 2 : 0) : r.dec; }));

/* ------------------------------------------------------------------ the 24 custom flags (SLICE4_SPEC 5.3): [enum, group, ko name, ko line, en name, en line, reveals row key] */
const FLAG_GROUPS = [['input', '입력', 'Input'], ['output', '출력', 'Output'], ['format', '메시지 형식', 'Message format'], ['think', '사고', 'Thinking'], ['other', '기타', 'Other']];
const FLAGS24 = [
  ['hasImageInput', 'input', '이미지 입력', '이미지를 읽을 수 있어요', 'Image input', 'Can read images'], ['hasAudioInput', 'input', '음성 입력', '음성을 알아들어요', 'Audio input', 'Understands audio'], ['hasVideoInput', 'input', '영상 입력', '영상을 볼 수 있어요', 'Video input', 'Can watch video'],
  ['hasImageOutput', 'output', '이미지 생성', '이미지를 만들어 줘요', 'Image output', 'Can make images'], ['hasAudioOutput', 'output', '음성 출력', '음성으로 답해요', 'Audio output', 'Replies in audio'], ['hasStreaming', 'output', '스트리밍', '답변을 쓰는 대로 받아요', 'Streaming', 'Receives the reply as it is written'],
  ['hasPrefill', 'format', '답변 미리 채우기', '답변의 첫머리를 미리 채워 줄 수 있어요', 'Reply prefill', 'The start of the reply can be filled in'], ['hasCache', 'format', '프롬프트 캐시', '같은 앞부분을 다시 계산하지 않아요', 'Prompt caching', 'Does not recompute an unchanged start'],
  ['hasFullSystemPrompt', 'format', '시스템 프롬프트 전체', '시스템 프롬프트를 어디에나 둘 수 있어요', 'Full system prompt', 'System prompts can go anywhere'], ['hasFirstSystemPrompt', 'format', '첫 시스템 프롬프트', '맨 앞에 시스템 프롬프트를 하나 둘 수 있어요', 'First system prompt', 'One system prompt can go first'],
  ['requiresAlternateRole', 'format', '역할 번갈아 쓰기', '사용자와 모델 메시지가 번갈아 와야 해요', 'Alternating roles', 'User and model messages must alternate'], ['mustStartWithUserInput', 'format', '사용자 메시지로 시작', '첫 메시지가 사용자 메시지여야 해요', 'Starts with the user', 'The first message must be the user\'s'],
  ['OAICompletionTokens', 'format', 'max_completion_tokens 사용', '최대 응답을 새 이름으로 보내요', 'max_completion_tokens', 'Sends the max response under the newer name'], ['DeveloperRole', 'format', '개발자 역할', '시스템 대신 개발자 역할을 써요', 'Developer role', 'Uses the developer role instead of system'], ['deepSeekPrefix', 'format', 'DeepSeek 접두', 'DeepSeek의 접두 이어쓰기를 써요', 'DeepSeek prefix', 'Uses DeepSeek prefix continuation'],
  ['geminiThinking', 'think', 'Gemini 생각', 'Gemini의 생각 기능을 써요', 'Gemini thinking', 'Uses Gemini thinking'], ['claudeThinking', 'think', 'Claude 사고', 'Claude의 사고 기능을 써요', 'Claude thinking', 'Uses Claude thinking', ['thinkingType', 'thinkingTokens']], ['claudeAdaptiveThinking', 'think', 'Claude 적응형 사고', '모델이 생각의 양을 스스로 정해요', 'Claude adaptive thinking', 'The model decides how much to think', ['adaptiveEffort']],
  ['claudeXHighEffort', 'think', 'Claude 최고 수준 추론', '추론 수준에 ‘최고’를 더해요', 'Claude max effort', 'Adds "Max" to reasoning effort', ['reasoningEffort']], ['deepSeekThinkingInput', 'think', 'DeepSeek 생각 입력', '이전 생각 내용을 요청에 다시 실어요', 'DeepSeek thinking input', 'Sends earlier thinking back in the request'], ['deepSeekThinkingOutput', 'think', 'DeepSeek 생각 출력', '모델의 생각 내용을 따로 받아요', 'DeepSeek thinking output', 'Receives the thinking separately'],
  ['deepSeekThinkingToggle', 'think', 'DeepSeek 사고 켜고 끄기', '요청마다 사고를 켜고 끌 수 있어요', 'DeepSeek thinking toggle', 'Thinking can be switched per request', ['dsThinking', 'dsEffort']],
  ['geminiBlockOff', 'other', 'Gemini 차단 끄기', 'Gemini의 안전 차단 설정을 꺼요', 'Gemini block off', 'Turns off Gemini safety blocking'], ['noCivilIntegrity', 'other', '시민 무결성 항목 빼기', 'Gemini 요청에서 시민 무결성 항목을 빼요', 'No civic integrity', 'Leaves the civic integrity item out of Gemini requests'],
];
// the model's own state of each flag, from the synthetic catalog (data3.js model.flags and group)
function modelFlag(m, en) {
  if (!m) return false; const f = m.flags || [], g = m.g, id = String(m.base || m.id);
  switch (en) {
    case 'hasImageInput': return f.indexOf('vision') >= 0; case 'hasAudioInput': return f.indexOf('audioin') >= 0; case 'hasVideoInput': return f.indexOf('videoin') >= 0;
    case 'hasImageOutput': return f.indexOf('imgout') >= 0; case 'hasAudioOutput': return f.indexOf('audioout') >= 0; case 'hasStreaming': return f.indexOf('stream') >= 0;
    case 'hasPrefill': return f.indexOf('prefill') >= 0; case 'hasCache': return f.indexOf('cache') >= 0;
    case 'hasFullSystemPrompt': return f.indexOf('sysprompt') >= 0 && g !== 'claude'; case 'hasFirstSystemPrompt': return f.indexOf('sysprompt') >= 0;
    case 'requiresAlternateRole': return g === 'claude'; case 'mustStartWithUserInput': return g === 'gemini';
    case 'OAICompletionTokens': case 'DeveloperRole': return g === 'gpt5'; case 'deepSeekPrefix': return /deepseek/.test(id);
    case 'geminiThinking': return g === 'gemini' && f.indexOf('think') >= 0; case 'claudeThinking': return g === 'claude' && f.indexOf('think') >= 0;
    case 'claudeAdaptiveThinking': return g === 'claude' && /sonnet-45|opus-41|haiku-45/.test(id); case 'deepSeekThinkingInput': case 'deepSeekThinkingOutput': case 'deepSeekThinkingToggle': return /deepseek/.test(id);
    default: return false;
  }
}

/* ------------------------------------------------------------------ models: limits, markers (nothing here is a real model fact) */
D.models.forEach((m) => {
  if (m.g === 'local' || m.custom) m.noLimit = true;   // no output limit in the (synthetic) model data: DS-088 shows no warning
  const base = String(m.base || m.id), pr = (m.params || []).slice();
  if (/deepseek/.test(base) && pr.indexOf('ds_thinking') < 0) pr.push('ds_thinking');
  if (m.pid === 'novelai' && pr.indexOf('svc:novelai') < 0) pr.push('svc:novelai');
  if (m.pid === 'textgen' && pr.indexOf('svc:ooba') < 0) pr.push('svc:ooba');
  if (m.pid === 'novellist' && pr.indexOf('svc:novellist') < 0) pr.push('svc:novellist');
  m.params = pr;
});
const smallConn = hasC('c-company') ? 'c-company' : hasC('c-openrouter') ? 'c-openrouter' : null;
{ const m = D3.customM('small-4k', 'Small 4K', smallConn, 16384, [], 'openai'); m.maxOut = 4096; m.noLimit = false; m.params = ['temperature', 'top_p']; m.kw = 'small 4k 작은 모델 test 테스트'; }

/* ------------------------------------------------------------------ service fixtures (set=service): three more connections whose models use a service sampler block */
if (SET4 === 'service') {
  const T0 = D3.T0, ago = (min) => T0 - min * 60000;
  const mk = (o, key) => { const c = Object.assign({ url: '', format: 'openai', tokenizer: 'auto', region: 'global', project: '', email: '', ollamaFormat: 'native', sub: false, autoFetch: false, test: null, simForce: '', keyState: key ? 'set' : 'na', models: 0, kw: '' }, o); c.kw = (D3.PROV[c.provider].kw || '') + ' ' + c.name; D3.CX.push(c); return c; };
  const nai = mk({ id: 'c-nai', name: '내 NovelAI', provider: 'novelai', test: { res: 'ok', at: ago(7), n: 4, ms: 288 } }, 'x');
  mk({ id: 'c-textgen', name: '내 textgen', provider: 'textgen', url: 'http://textgen.invalid:5000', test: { res: 'ok', at: ago(12), n: 1, ms: 120 } }, '');
  mk({ id: 'c-novellist', name: '내 NovelList', provider: 'novellist', test: null }, 'x');
  D3.catalogOf('novelai').forEach((m) => { const k = D3.mkClone(m, nai); D.models.push(k); });
  const tg = D3.customM('textgen-llama-3', 'Llama 3 (textgen)', 'c-textgen', 8192, [], 'openai'); tg.params = ['temperature', 'top_p', 'top_k', 'min_p', 'top_a', 'repetition_penalty', 'seed', 'svc:ooba']; tg.pid = 'textgen'; tg.noLimit = true; tg.provEn = tg.prov = 'textgen WebUI';
  const nl = D3.customM('novellist-genesis', 'Genesis (NovelList)', 'c-novellist', 4096, [], 'openai'); nl.params = ['temperature', 'top_p', 'top_k', 'top_a', 'repetition_penalty', 'svc:novellist']; nl.pid = 'novellist'; nl.noLimit = true; nl.provEn = nl.prov = 'NovelList';
  D.models.forEach((m) => { if (m.pid === 'novelai' && (m.params || []).indexOf('svc:novelai') < 0) m.params = m.params.concat(['svc:novelai']); });
  D3.CX.forEach((c) => { c.models = D.models.filter((m) => m.conn === c.id).length; });
  const ot = D3.takeKeys; D3.takeKeys = function () { const k = ot(); k['c-nai'] = 'fake-key-0000-nai-7c21'; k['c-novellist'] = 'fake-key-0000-nl-90b4'; return k; };
}

/* ------------------------------------------------------------------ rows: the existing parameter rows are re-labelled and given the DS-087 defaults; new rows are added */
const syncCopy = (p) => { const r = rowOf(p.id); if (!r) return null; r.ko = p.t.ko[0]; r.en = p.t.en[0]; r.syn = ((r.syn || '') + ' ' + (p.syn || '') + ' ' + p.api).trim(); r.desc = p.t.ko[1] + '|' + p.t.en[1]; r.help = p.t.ko[4] + '|' + p.t.en[4]; r.d = p.def; r.v = p.def; return r; };
PARAMS.forEach((p) => {
  let r = syncCopy(p);
  if (!r) { r = { type: p.kind === 'seg' ? 'segmented' : p.kind === 'number' ? 'number' : 'slider', id: p.id, sec: 'models.params', page: 'models', ko: p.t.ko[0], en: p.t.en[0], scope: 'preset' }; D.rows.push(r); syncCopy(p); }
  r.sec = 'models.params'; r.page = 'models'; r.p4 = p.key; r.scope = p.global ? undefined : 'preset';
  if (p.kind === 'seg') { r.type = 'segmented'; r.opt = p.opts.map((o) => [o[0], o[1], o[2]]); } else if (p.kind === 'number') { r.type = 'number'; r.min = p.min; r.max = p.max; } else { r.type = 'slider'; r.min = p.min; r.max = p.max; r.step = p.step; }
  if (p.needs) r.needs = p.needs; else delete r.needs;
  if (p.global) r.global = true;
});
// 3.2 / 5.3: the support test lives in slice4.js; a getter keeps slice 1's own search test (unavail) in step with it
// shared rows that moved
['models.sepParams'].forEach((id) => { const r = rowOf(id); if (r) { r.type = 'note'; r.retired = true; r.replacedBy = 'models'; ['v', 'd', 'scope', 'desc'].forEach((k) => { delete r[k]; }); r.ko = '기능별 파라미터는 모델 페이지의 각 기능 아래에서 정해요'; r.en = 'Per-feature parameters are set under each feature on the Models page'; } });
{ const m = rowOf('models.moduleIntegration'); if (m) { m.type = 'text'; m.ko = '모듈 연동'; m.en = 'Module integration'; m.v = ''; m.d = ''; m.scope = 'preset'; m.desc = '프리셋에 연결할 모듈의 이름 공간을 쉼표로 이어요|Module namespaces linked to this preset, separated by commas'; m.help = '모듈 이름 공간을 쉼표로 이어 쓰면 이 프리셋에서만 그 모듈의 내용이 프롬프트에 들어가요. 모듈의 내용은 스튜디오에서 만들어요.|Write module namespaces separated by commas and only this preset includes their content in the prompt. Module content is made in Studio.'; m.syn = 'module integration moduleIntergration 모듈 통합 모듈 연동 네임스페이스 namespace'; delete m.icon; } }
// structured rows (bias, additional parameters, stop strings, custom flags) hold JSON text; slice4.js prints a summary for search results and undo messages
const jsonRow = (id, ko, en, syn, def, extra) => { let r = rowOf(id); const o = Object.assign({ type: 'select', ko, en, syn, v: def, d: def, opt: [], sec: 'models.params', page: 'models', scope: 'preset' }, extra || {}); if (!r) { r = { id }; D.rows.push(r); } ['icon', 'confirm', 'act'].forEach((k) => { delete r[k]; }); Object.assign(r, o); return r; };
jsonRow('models.bias', '편향', 'Bias', 'bias 바이어스 logit 확률 편향 logit_bias 금지어 단어 확률 tokenizer 토크나이저 어떤 말을 더 또는 덜', '[]', { desc: '특정 말이 나올 확률을 높이거나 낮춰요|Makes a word or phrase more or less likely', help: '글자와 숫자를 짝지어 그 말이 나올 확률을 바꿔요. 숫자는 -100(거의 안 나와요)부터 100(자주 나와요)까지예요. -101은 일부 모델에서 완전히 금지해요. 모델의 토크나이저와 다른 방식으로 글자를 나누면 효과가 없거나 엉뚱할 수 있어요.|Pair a text with a number to change how likely it is. The number runs from -100 (almost never) to 100 (often); -101 bans it on some models. If the model splits text differently from the tokenizer used here, the effect can be nil or wrong.' });
jsonRow('models.addParams', '추가 파라미터', 'Additional parameters', 'additional params additionalParams 추가 매개변수 요청 본문 헤더 header json extra body 추가 요청 항목', '[]', { desc: '요청에 직접 덧붙이는 항목이에요|Extra items added straight to the request', help: '키와 값을 적으면 요청에 그대로 덧붙여요. 종류에서 헤더(요청 머리글), JSON, 지우기(그 키를 빼요), 값(문자나 숫자)을 골라요. 모든 프리셋에 같이 적용돼요.|Enter a key and a value and they are added to the request as they are. Pick the type: Header, JSON, Remove (drops that key) or Value (text or number). Shared by all presets.', scope: undefined, global: true });
jsonRow('models.localStopStrings', '멈춤 문자열', 'Stop strings', 'stop strings localStopStrings 멈춤 문자열 중단 문자열 custom stop words stop sequences 멈추는 글자', '[]', { desc: '이 글자가 나오면 모델이 쓰기를 멈춰요|The model stops writing when one of these appears', help: '로컬 모델이 이 글자 중 하나를 쓰면 거기서 멈춰요. 모든 프리셋에 같이 적용돼요.|A local model stops as soon as it writes one of these. Shared by all presets.', scope: undefined, global: true, svc: 'ooba', needs: 'svc:ooba' });
jsonRow('models.customFlags', '모델 기능 직접 지정', 'Set model features yourself', 'custom flags customFlags 플래그 모델 플래그 기능 지정 기능 표시 ' + FLAGS24.map((f) => f[0]).join(' '), '', { desc: '모델이 지원하는 기능을 직접 정해요|Decide for yourself what the model supports' });
{ const r = jsonRow('models.enableCustomFlags', '모델 기능 직접 지정 사용', 'Use custom model features', 'enableCustomFlags custom flags 직접 지정', false); r.type = 'switch'; r.opt = undefined; }
{ const r = rowOf('models.modelTools'); if (r) { ['icon', 'act'].forEach((k) => { delete r[k]; }); Object.assign(r, { type: 'switch', ko: '도구: 검색', en: 'Tool: search', v: false, d: false, scope: 'preset', desc: '모델이 웹 검색 도구를 쓸 수 있게 해요|Lets the model use a web search tool', help: '모델이 웹 검색 도구를 쓸 수 있게 해요. 도구를 지원하는 모델에서만 동작해요.|Lets the model use a web search tool. It works only on models that support tools.', syn: 'tools model tools modelTools 도구 검색 함수 호출 search web 웹 검색 툴', needs: 'tools' }); } }
{ const r = rowOf('models.applyAddParamsAll'); if (r) { Object.assign(r, { ko: '모든 모델에 적용', en: 'Apply to all models', v: false, d: false, scope: undefined, global: true, desc: '켜면 추가 파라미터를 모든 모델의 요청에 덧붙여요|When on, additional parameters go into every model\'s requests' }); } }
// hidden send flags, one per sendable row, and per-service switches for the three NovelAI rows without a default
SENDABLE.forEach((k) => { const p = BYKEY[k]; D.rows.push({ type: 'switch', id: 'models.send.' + k, sec: 'models.params', page: 'models', ko: p.t.ko[0] + ': 보내기', en: p.t.en[0] + ': send', v: !!p.defSent, d: !!p.defSent, scope: 'preset', noIndex: true, p4send: k }); });
// service rows
Object.keys(SVC).forEach((k) => SVC[k].rows.forEach((s) => {
  const nd = s.def === null; const v0 = nd ? s.v0 : s.def;
  const r = { type: s.kind === 'switch' ? 'switch' : s.kind === 'text' ? 'text' : 'slider', id: s.id, sec: 'models.params', page: 'models', ko: s.t.ko[0], en: s.t.en[0], v: v0, d: nd ? undefined : v0, scope: 'preset', svc: k, p4svc: s.f, needs: 'svc:' + k, desc: s.t.ko[1] + '|' + s.t.en[1],
    syn: SVC[k].ko + ' ' + SVC[k].en + ' ' + s.f + ' ' + s.t.ko[0] + ' ' + s.t.en[0] + ' 이 서비스 전용 service sampler' };
  if (s.kind === 'slider') { r.min = s.min; r.max = s.max; r.step = s.step; }
  const hp = s.like ? [BYKEY[s.like].t.ko[4], BYKEY[s.like].t.en[4]] : s.help; if (hp) r.help = hp[0] + '|' + hp[1];
  D.rows.push(r);
  if (nd) D.rows.push({ type: 'switch', id: 'models.send.svc.' + k + '.' + s.f, sec: 'models.params', page: 'models', ko: s.t.ko[0] + ': 보내기', en: s.t.en[0] + ': send', v: false, d: false, scope: 'preset', noIndex: true, p4send: 'svc.' + k + '.' + s.f });
}));
D.PAGES.find((p) => p.id === 'models').later = undefined;   // slice 4 is this page: the "redesigned in a later step" banner goes
// NovelList: today's label reads "Reputation Penalty" (a mislabel of repetition); nothing to carry over

/* ------------------------------------------------------------------ per-task parameters (DS-082): one JSON row per task. {mode:'same'|'own', values:{key:value}, off:[keys not sent]} */
const TASKS = [['memory', 'models.memModel', '장기 기억', 'Long-term memory'], ['translate', 'models.transModel', '번역', 'Translation'], ['emotion', 'models.emoModel', '감정 이미지', 'Emotion images'], ['otherAx', 'models.otherModel', '기타', 'Other features']];
const TASK_KEYS = PARAMS.filter((p) => p.task).map((p) => p.key);
TASKS.forEach(([t, , ko, en]) => { const id = 'models.task.' + t; const def = JSON.stringify({ mode: 'same', values: {}, off: [] }); const r = jsonRow(id, ko + ' 매개변수', en + ' parameters', '', def, { desc: undefined }); r.noIndex = true; r.task = t; delete r.desc; });

/* ------------------------------------------------------------------ the sets */
const p1 = D.presets.find((p) => p.id === 'p1');
const setV = (p, id, v) => { p.vals[id] = v; };
const bias3 = JSON.stringify([['세라핀', 5], ['안녕하세요', -20], ['ERROR', -100]]);
const addParams2 = JSON.stringify([['top_logprobs', '5'], ['X-Debug-Trace', 'header::1']]);
const memCopy = (main, changes) => { const v = {}; TASK_KEYS.forEach((k) => { v[k] = k in main ? main[k] : BYKEY[k].def; }); return Object.assign(v, changes); };
if (SET4 === 'empty') {
  D.presets.forEach((p) => { delete p.vals['models.temperature']; delete p.vals['models.maxResponse']; });
} else {
  if (SET4 === 'over') { p1.model = 'small-4k'; setV(p1, 'models.maxResponse', 8000); setV(p1, 'models.maxContext', 32000); }
  else if (SET4 === 'service') { p1.model = 'c-nai::nai-erato'; const p2 = D.presets.find((p) => p.id === 'p2'), p3 = D.presets.find((p) => p.id === 'p3'); p2.model = 'textgen-llama-3'; p3.model = 'novellist-genesis'; setV(p1, 'models.svc.novelai.topK', 20); setV(p1, 'models.send.svc.novelai.mirostat_tau', true); setV(p2, 'models.svc.ooba.top_k', 40); }
  else { setV(p1, 'models.temperature', 1.2); setV(p1, 'models.send.topP', false); setV(p1, 'models.maxResponse', 8000); }
  setV(p1, 'models.bias', bias3);
  const mainVals = { temperature: p1.vals['models.temperature'] === undefined ? 1 : p1.vals['models.temperature'] };
  setV(p1, 'models.task.memory', JSON.stringify({ mode: 'own', values: memCopy(mainVals, { temperature: 0.6, topK: 40 }), off: ['topP', 'thinkingTokens'] }));
  setV(p1, 'models.task.translate', JSON.stringify({ mode: 'same', values: memCopy(mainVals, { temperature: 0.3, repPenalty: 1.1 }), off: ['thinkingTokens'] }));
  rowOf('models.addParams').v = addParams2; rowOf('models.addParams').d = '[]';
  rowOf('models.localStopStrings').v = JSON.stringify(['\n\n', '<|end|>']);
}
if (SET4 === 'empty') { rowOf('models.addParams').v = '[]'; rowOf('models.localStopStrings').v = '[]'; }

/* ------------------------------------------------------------------ conversions between today's store and the display (SLICE4_SPEC 2.3) */
const toStored = (key, v) => { const p = BYKEY[key]; if (!p) return v; if (p.scale) return Math.round(v * p.scale); if (p.stored && p.kind === 'seg') return p.stored[v]; return v; };
const fromStored = (key, v) => { const p = BYKEY[key]; if (!p) return v; if (p.scale) return v / p.scale; if (p.stored && p.kind === 'seg') { const k = Object.keys(p.stored).find((x) => p.stored[x] === v); return k === undefined ? p.def : k; } return v; };

window.SS4_DATA = { SET4, GROUPS, PARAMS, BYKEY, SENDABLE, SVC, FLAGS24, FLAG_GROUPS, TASKS, TASK_KEYS, modelFlag, toStored, fromStored, bias3, addParams2, SEG_RE };
})();
