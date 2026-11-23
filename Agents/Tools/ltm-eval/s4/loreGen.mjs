// Seeded synthetic lorebooks and turns for the S4 lore-recall usefulness gate (spec 9, plan A7). Nothing here touches the
// application: entries are built in the app's `loreBook` field set (addLorebook), and the decorated ones are shaped like
// convertExternalLorebook output (decorator lines, a newline, then the body). English and Korean; the Korean pools attach
// particles so bigram matching meets inflection.
//
// A lore set holds 100 x scale distractor pairs of topic entries, 50 x scale filler entries and 50 x scale entries that must
// never be recalled (an excluded decorator, selective, regex keys, constant, folder or a keyless entry). Each topic entry has
// a unique invented name as its key; no turn ever contains it.
import { josa, rng } from '../gen/lib.mjs';

export const STRATA = ['high', 'low', 'allude'];
export const ATTRS = ['kind', 'climate', 'material', 'ruler', 'creature', 'event'];
// Attributes a paraphrase can restate in other words; ruler names have no synonym.
const SYN_ATTRS = ['kind', 'climate', 'material', 'creature', 'event'];

const EN = {
  cast: { user: 'Elowen', char: 'Bram' },
  npcs: ['Tamsin', 'Rowan', 'Marek', 'Ysolde'],
  kinds: [['fortress', 'stronghold'], ['harbor', 'port'], ['monastery', 'abbey'], ['village', 'hamlet'], ['tower', 'spire'], ['bridge', 'crossing'], ['library', 'archive'], ['market', 'bazaar'], ['mine', 'quarry'], ['shrine', 'chapel'], ['lighthouse', 'beacon'], ['arena', 'colosseum']],
  climates: [['icy', 'frozen'], ['scorching', 'blazing'], ['swampy', 'boggy'], ['windswept', 'gusty'], ['volcanic', 'smoldering'], ['misty', 'foggy'], ['rainy', 'drenched'], ['snowbound', 'wintry'], ['sunbaked', 'parched'], ['stormy', 'tempestuous'], ['temperate', 'mild'], ['mountainous', 'alpine']],
  materials: [['marble', 'alabaster'], ['granite', 'bedrock'], ['timber', 'lumber'], ['brick', 'masonry'], ['bronze', 'copper'], ['iron', 'steel'], ['ivory', 'tusk'], ['coral', 'reef'], ['sandstone', 'clay'], ['basalt', 'slate'], ['obsidian', 'glass'], ['amber', 'resin'], ['jade', 'emerald'], ['limestone', 'chalk']],
  rulers: 'Aldric Berenice Corvin Daria Edric Fenna Garrick Halia Ivor Jessamy Kellan Lysandra Merrick Nerys Osric Perrin Quill Rhosyn Soren Thessaly Ulric Verity Wendric Xanthe Yorick Zelda Anselm Brienne Cadoc Delphine Eamon Fiora Gawain Hesper Isolde Jorund Katrin Leofric Morwen Nikolai Odalys Percival Raina Silas Talia Uriel Vesna Wulfric Yvaine Zephyr Alaric Bronwen Caspian Dorian Elspeth Faolan Gideon Hilda Idris Jocasta'.split(' '),
  creatures: 'wyverns salamanders owls hounds basilisks griffins wolves ravens serpents boars stags spiders lynxes badgers falcons hornets toads bats eels mantises scorpions panthers jackals vultures moths crows foxes otters hawks adders bears elk leeches herons mongooses newts cranes yaks gulls weasels'.split(' '),
  events: 'plague flood mutiny comet famine eclipse earthquake siege schism drought wildfire coup blizzard heresy locusts shipwreck treaty uprising meteor pestilence tsunami rebellion avalanche fever massacre exodus tournament wedding armistice coronation'.split(' '),
  creatureSyn: ['beasts', 'monsters', 'critters'],
  eventSyn: ['calamity', 'upheaval', 'disaster'],
  nameA: ['Kar', 'Vel', 'Mor', 'Thal', 'Brin', 'Os', 'Dra', 'Ful', 'Ghen', 'Sil', 'Tor', 'Wyn', 'Zan', 'Quel', 'Ash', 'Pel', 'Hav', 'Jor', 'Lun', 'Nem', 'Rav', 'Ske', 'Urd', 'Yar'],
  nameB: ['ven', 'dra', 'mir', 'tho', 'ska', 'lor', 'gan', 'bry', 'fel', 'nox', 'ria', 'sul', 'tam', 'vok', 'wen', 'zel'],
  nameC: ['hold', 'mere', 'gard', 'wick', 'dun', 'reach', 'fall', 'haven', 'crest', 'mark', 'ford', 'spire'],
  // Common vocabulary in two frequency tiers: A words are in a large share of the entries, B words in a few percent.
  nouns: [['road', 'rain', 'weather', 'night', 'morning', 'evening'], ['inn', 'coat', 'garden', 'kitchen', 'fire', 'lamp']],
  foods: [['bread', 'tea'], ['soup', 'cheese', 'apples']],
  adjs: [['long', 'cold', 'quiet', 'warm'], ['busy', 'narrow', 'bright']],
};

const KO = {
  cast: { user: '하린', char: '무영' },
  npcs: ['이서', '도윤', '서연', '지후'],
  kinds: [['요새', '성채'], ['항구', '선착장'], ['수도원', '성당'], ['마을', '촌락'], ['탑', '첨탑'], ['다리', '교량'], ['도서관', '서고'], ['시장', '장터'], ['광산', '채석장'], ['사당', '신전'], ['등대', '봉화대'], ['투기장', '경기장']],
  climates: [['얼음', '빙설'], ['사막', '모래벌'], ['늪지', '습지'], ['강풍', '돌풍'], ['화산', '분화구'], ['안개', '물안개'], ['장마', '폭우'], ['눈보라', '폭설'], ['무더위', '혹서'], ['폭풍', '태풍'], ['온화', '포근'], ['고산', '산악']],
  materials: [['대리석', '설화석'], ['화강암', '암반'], ['목재', '재목'], ['벽돌', '조적'], ['청동', '구리'], ['강철', '쇠붙이'], ['상아', '뿔'], ['산호', '암초'], ['사암', '점토'], ['현무암', '검은돌'], ['흑요석', '유리'], ['호박', '송진'], ['비취', '에메랄드'], ['석회암', '백악']],
  rulers: '아란 벨리아 카이런 다리아 에드릭 페나 가릭 할리아 이보르 제사 켈란 리산 메릭 네리스 오스릭 페린 퀼 로신 소렌 테살 울릭 베리 웬드 잔테 요릭 젤다 안셀 브리엔 카독 델핀 이몬 피오라 가웨인 헤스퍼 이졸데 요룬 카트린 레오 모르웬 니콜 오달 퍼시 라이나 사일 탈리아 우리엘 베스나 울프 이베인 제피르 알라릭 브론웬 카스피안 도리안 엘스펫 파올란 기디온 힐다 이드리스 조카'.split(' '),
  creatures: '와이번 도롱뇽 올빼미 사냥개 바실리스크 그리핀 늑대 까마귀 독사 멧돼지 사슴 거미 스라소니 오소리 매 말벌 두꺼비 박쥐 뱀장어 사마귀 전갈 퓨마 자칼 독수리 나방 갈까마귀 여우 수달 부엉이 살무사 곰 엘크 거머리 왜가리 몽구스 영원 두루미 야크 갈매기 족제비'.split(' '),
  events: '역병 홍수 반란 혜성 기근 일식 지진 포위전 분열 가뭄 산불 쿠데타 눈사태 이단 메뚜기떼 난파 조약 봉기 운석 전염병 해일 폭동 눈붕괴 열병 학살 대이동 무술대회 결혼식 휴전 대관식'.split(' '),
  creatureSyn: ['짐승', '괴물', '야수'],
  eventSyn: ['재앙', '격변', '참사'],
  nameA: ['카르', '벨', '모르', '탈', '브린', '오스', '드라', '풀', '젠', '실', '토르', '윈', '잔', '켈', '아쉬', '펠', '하브', '조르', '룬', '넴', '라브', '스케', '우르', '야르'],
  nameB: ['벤', '드라', '미르', '토', '스카', '로', '간', '브리', '펠', '녹스', '리아', '술', '탐', '보크', '웬', '젤'],
  nameC: ['홀드', '메어', '가드', '윅', '던', '리치', '폴', '헤이븐', '크레스트', '마크', '포드', '스파이어'],
  nouns: [['길', '비', '날씨', '밤', '아침', '저녁'], ['여관', '외투', '정원', '부엌', '불', '등불']],
  foods: [['빵', '차'], ['수프', '치즈', '사과']],
  adjs: [[['긴', '길다'], ['추운', '춥다'], ['조용한', '조용하다'], ['따뜻한', '따뜻하다']], [['바쁜', '바쁘다'], ['좁은', '좁다'], ['밝은', '밝다']]],
};

// Decorators that keep an entry out of recall, with the argument shape the scan reads.
export const NEVER_DECORATORS = ['dont_activate', 'probability 30', 'activate_only_after 5', 'activate_only_every 3', 'keep_activate_after_match', 'dont_activate_after_match', 'position before_desc', 'depth 2', 'reverse_depth 2', 'role user', 'scan_depth 4', 'additional_keys storm', 'exclude_keys calm', 'end', 'inject_lore_extra'];
export const NEVER_COUNTS = { decorator: 14, selective: 8, regex: 8, constant: 8, folder: 6, whitespace: 6 };

const pack = (lang) => (lang === 'ko' ? KO : EN);
const article = (w) => (/^[aeiou]/i.test(w) ? 'an' : 'a');
const capital = (w) => w.charAt(0).toUpperCase() + w.slice(1);

function uniqueName(r, P, used) {
  for (;;) {
    const n = r.pick(P.nameA) + r.pick(P.nameB) + r.pick(P.nameC);
    const name = P === EN ? capital(n) : n;
    if (!used.has(name)) { used.add(name); return name; }
  }
}

function describe(lang, P, r, a, castMention) {
  const sentences = [];
  if (lang === 'ko') {
    sentences.push(`${josa(a.name, '은')} ${a.climate} 지대의 ${a.kind}이며, ${josa(a.material, '로')} 지어졌다.`);
    sentences.push(`${a.event} 이후에 세워졌고 ${josa(a.ruler, '이')} 다스린다.`);
    if (r.chance(0.7)) sentences.push(`${josa(a.creature, '이')} 주변을 떠돈다.`);
    if (castMention) sentences.push(`${castMention}도 하룻밤 머문 적이 있다.`);
    else if (r.chance(0.5)) sentences.push(`그곳의 ${josa(common(r, P.nouns), '은')} ${common(r, P.adjs)[1]}고 한다.`);
  } else {
    sentences.push(`${a.name} is ${article(a.climate)} ${a.climate} ${a.kind} built of ${a.material}.`);
    sentences.push(`It was founded after the ${a.event} and is ruled by ${a.ruler}.`);
    if (r.chance(0.7)) sentences.push(`${capital(a.creature)} roam the surrounding lands.`);
    if (castMention) sentences.push(`${castMention} once stayed there for a night.`);
    else if (r.chance(0.5)) sentences.push(`Travelers say the ${common(r, P.nouns)} there is ${common(r, P.adjs)}.`);
  }
  return sentences.join(' ');
}

// One common word: a tier B word with probability pB, else a tier A word. `used.b` records whether a tier B word was drawn.
function common(r, tiers, used = { b: false }, pB = 0.25) {
  const useB = r.chance(pB);
  if (useB) used.b = true;
  return r.pick(useB ? tiers[1] : tiers[0]);
}

function fillerText(lang, P, r) {
  const [n1, n2, n3] = [common(r, P.nouns), common(r, P.nouns), common(r, P.nouns)];
  if (lang === 'ko') {
    return `${josa(n1, '은')} ${common(r, P.adjs)[1]}. ${josa(n2, '이')} ${common(r, P.adjs)[1]}. 여행자들은 ${josa(common(r, P.foods), '을')} 나눠 먹고 ${n3} 이야기를 한다.`;
  }
  return `The ${n1} is ${common(r, P.adjs)} and the ${n2} is ${common(r, P.adjs)} in the ${n3}. Travelers rest and share ${common(r, P.foods)}.`;
}

const baseEntry = (key, comment, content) => ({ key, comment, content, mode: 'normal', insertorder: 100, alwaysActive: false, secondkey: '', selective: false });

/**
 * One lore set. `topic[i]` records an entry's attributes (verbatim words and synonym pools) for the turn builder; `never` is the
 * set of entry indexes that must never be recalled. `idless` strips every id (the build then hashes each entry); `equalLength`
 * pads every body to one length with trailing spaces (the worst case for the live lookup's length buckets).
 */
export function genLoreSet({ lang, seed, scale = 1, idless = false, equalLength = false }) {
  const P = pack(lang);
  const r = rng(seed);
  const used = new Set();
  const entries = [];
  const topic = [];
  const never = new Set();
  const castMention = () => (r.chance(0.25) ? r.pick([P.cast.user, P.cast.char, ...P.npcs]) : '');
  const entryId = (tag, n) => (idless || n % 2 === 1 ? undefined : `lore-${seed}-${tag}-${n}`);
  const pairs = 100 * scale;
  for (let p = 0; p < pairs; p++) {
    const kind = r.pick(P.kinds), climate = r.pick(P.climates);
    const shareMaterial = r.chance(0.5);
    const sharedMaterial = r.pick(P.materials);
    for (let side = 0; side < 2; side++) {
      const material = shareMaterial ? sharedMaterial : r.pick(P.materials);
      const a = { name: uniqueName(r, P, used), kind: kind[0], climate: climate[0], material: material[0], ruler: r.pick(P.rulers), creature: r.pick(P.creatures), event: r.pick(P.events) };
      const syn = { kind: [kind[1]], climate: [climate[1]], material: [material[1]], creature: P.creatureSyn, event: P.eventSyn };
      const e = baseEntry(a.name, a.name, describe(lang, P, r, a, castMention()));
      const n = entries.length;
      const id = entryId('t', n);
      if (id !== undefined) e.id = id;
      topic.push({ index: n, pair: p, attrs: a, syn });
      entries.push(e);
    }
  }
  const fillers = 50 * scale;
  for (let i = 0; i < fillers; i++) {
    const e = baseEntry(`${common(r, P.nouns)} talk ${i}`, `Common note ${i}`, fillerText(lang, P, r));
    const id = entryId('f', entries.length);
    if (id !== undefined) e.id = id;
    entries.push(e);
  }
  // Never-recall entries: each clones a topic entry's text under a fresh name, so it is tempting for the ranker.
  const kinds = [];
  for (const [k, c] of Object.entries(NEVER_COUNTS)) for (let i = 0; i < c * scale; i++) kinds.push(k);
  kinds.forEach((k, i) => {
    const src = r.pick(topic);
    const name = uniqueName(r, P, used);
    const body = describe(lang, P, r, { ...src.attrs, name }, '');
    const e = baseEntry(name, name, body);
    if (k === 'decorator') e.content = `@@${NEVER_DECORATORS[i % NEVER_DECORATORS.length]}\n${body}`;
    else if (k === 'selective') { e.selective = true; e.secondkey = common(r, P.nouns); }
    else if (k === 'regex') { e.useRegex = true; e.key = `/${name}/i`; }
    else if (k === 'constant') { e.mode = 'constant'; e.alwaysActive = true; }
    else if (k === 'folder') { e.mode = 'folder'; e.key = `folder:${seed}-${i}`; e.comment = 'New Folder'; e.content = ''; }
    else if (k === 'whitespace') e.key = [' ', ',', ' , ', ',,'][i % 4];
    const id = entryId('n', entries.length);
    if (id !== undefined) e.id = id;
    never.add(entries.length);
    entries.push(e);
  });
  if (equalLength) {
    const max = Math.max(...entries.map((e) => e.content.length));
    for (const e of entries) e.content += ' '.repeat(max - e.content.length);
  }
  return { lang, seed, entries, topic, never, cast: P.cast, decoratorOf: (e) => (e.content.startsWith('@@') ? e.content.slice(2).split('\n', 1)[0].split(' ', 1)[0] : null) };
}

const attach = (lang, r, w) => {
  if (lang !== 'ko') return w;
  switch (r.int(6)) {
    case 0: return josa(w, '이');
    case 1: return josa(w, '을');
    case 2: return josa(w, '로');
    case 3: return w + '에서';
    case 4: return w + '의';
    default: return w;
  }
};

const EN_FRAMES = [
  (p) => `Do you remember the place with ${p}?`,
  (p) => `Tell me again about ${p}, please.`,
  (p) => `I keep thinking of ${p} from the old story.`,
  (p) => `Wasn't there something about ${p} nearby?`,
];
const KO_FRAMES = [
  (p) => `혹시 ${p} 이야기 기억나?`,
  (p) => `${p} 있었던 곳이 어디였지?`,
  (p) => `${p} 관련해서 다시 말해 줄래?`,
  (p) => `그러고 보니 ${p} 얘기가 떠올랐어.`,
];

/**
 * One paraphrase turn for `target` (an element of `set.topic`). `high` restates 2 to 3 attribute words verbatim, `low` one word
 * verbatim and the rest as synonyms, `allude` synonyms only. The target's key is never in the text. `verbatim` and `synonyms`
 * are the words used, so the caller can check overlap against the target's body with the real tokeniser.
 */
export function genParaphrase(set, r, stratum, target) {
  const lang = set.lang;
  const verbatimPool = ATTRS.map((a) => target.attrs[a]);
  const synPool = SYN_ATTRS.map((a) => r.pick(target.syn[a]));
  let verbatim = [], synonyms = [];
  if (stratum === 'high') {
    verbatim = r.shuffle(verbatimPool).slice(0, 2 + r.int(2));
  } else if (stratum === 'low') {
    const chosen = r.int(ATTRS.length);
    verbatim = [verbatimPool[chosen]];
    const rest = SYN_ATTRS.map((a, i) => ({ a, w: synPool[i] })).filter((x) => x.w !== undefined && target.attrs[x.a] !== verbatim[0]);
    synonyms = r.shuffle(rest).slice(0, 1 + r.int(2)).map((x) => x.w);
  } else {
    synonyms = r.shuffle(synPool).slice(0, 2 + r.int(2));
  }
  const words = r.shuffle([...verbatim, ...synonyms]);
  const phrase = words.map((w) => attach(lang, r, w)).join(lang === 'ko' ? ' ' : r.chance(0.5) ? ' and ' : ', ');
  const frames = lang === 'ko' ? KO_FRAMES : EN_FRAMES;
  return { text: r.pick(frames)(phrase), verbatim, synonyms };
}

/**
 * A chit-chat turn built from common words and the character names; no lore entry is about it. `tier` is 'common' when every
 * content word is a tier A word and 'mixed' when at least one is a tier B word (a word in only a few percent of the entries).
 */
export function genChitchat(set, r) {
  const P = pack(set.lang);
  const name = r.pick([P.cast.user, P.cast.char, ...P.npcs]);
  const used = { b: false };
  const w = (tiers) => common(r, tiers, used);
  let text;
  if (set.lang === 'ko') {
    text = r.pick([
      () => `${name}, 오늘 하루는 어땠어? ${w(P.adjs)[0]} ${w(P.nouns)} 얘기나 하자.`,
      () => `${josa(w(P.nouns), '은')} ${w(P.adjs)[1]}. ${name}, 같이 ${w(P.foods)} 먹을래?`,
      () => `${name}${r.chance(0.5) ? '아' : ''}, ${w(P.nouns)} 보면서 쉬자. ${josa(w(P.nouns), '이')} ${w(P.adjs)[1]}.`,
    ])();
  } else {
    text = r.pick([
      () => `How was your day, ${name}? The ${w(P.nouns)} is ${w(P.adjs)}, so let's talk about the ${w(P.nouns)}.`,
      () => `Let's share some ${w(P.foods)}, ${name}. The ${w(P.nouns)} looks ${w(P.adjs)} tonight.`,
      () => `${name}, I would like a quiet ${w(P.nouns)} and some ${w(P.foods)}. Everything feels ${w(P.adjs)}.`,
    ])();
  }
  return { text, tier: used.b ? 'mixed' : 'common' };
}
/** A seed for turn number `i` of one kind, so the first n turns of a list are a prefix of the first m > n. */
export const turnSeed = (seed, lang, kind, i) => (((seed * 1000003) ^ (lang === 'ko' ? 0x9e3779b1 : 0x85ebca6b) ^ (kind === 'para' ? 0x1b873593 : 0xc2b2ae35) ^ Math.imul(i + 1, 2654435761)) >>> 0);
