// Chat builder of the synthetic roleplay memory evaluation set. gen.mjs is the CLI around it.
// With every option off the draws and the output are exactly the original generator's (the committed sha256 pins that).
// Options (all opt-in, none changes a draw of the main stream):
//   namedFiller    a second stream r2 = rng(seed ^ 0x5EED5EED) inserts named sentences after the base sentences exist;
//   emitSlots      each question carries its slots;
//   emitPlantSpans each message carries plants: [{start, end, factIndex}] (UTF-16 offsets) and each question its factIndex.
import { rng } from './lib.mjs';
import * as NF_EN from './named_en.mjs';
import * as NF_KO from './named_ko.mjs';

export const CHATS = [
  { id: 'en1', pack: 'en1', seed: 1101, N: 820 },
  { id: 'en2', pack: 'en2', seed: 2202, N: 640 },
  { id: 'ko1', pack: 'ko1', seed: 3303, N: 740 },
  { id: 'ko2', pack: 'ko2', seed: 4404, N: 900 },
];
export const TAIL = 48; // last messages never hold facts or decoys; used as query context
export const NF_STREAM_XOR = 0x5EED5EED;

const NF_MODS = { en: NF_EN, ko: NF_KO };

// The base pool is onset x coda (120 Korean, 140 English terms), too few for a chat whose decoys alone ask for more
// invented terms than that. The spill pool is onset + middle + coda; a middle that is no onset and no coda start keeps
// every spill term free of any base term as a substring, so a base term never matches inside a spill term.
const SPILL_MID = {
  en: ['ar', 'el', 'ith', 'un', 'ae', 'ish', 'ov', 'yl'],
  ko: ['가', '타', '파', '후', '메', '소', '보', '쿠'],
};
const spillCache = new Map();
export function termSpill(mod) {
  if (!spillCache.has(mod.lang)) {
    const base = [];
    for (const o of mod.TERM.onset) for (const c of mod.TERM.coda) base.push(o + c);
    const out = [];
    for (const o of mod.TERM.onset) for (const m of SPILL_MID[mod.lang] ?? []) for (const c of mod.TERM.coda) {
      const t = o + m + c;
      if (!base.some((b) => t.includes(b))) out.push(t);
    }
    spillCache.set(mod.lang, out);
  }
  return spillCache.get(mod.lang);
}

// Named sentence factory. `nf` is the `nf` block a build emits; rr is any rng. Draws only from rr.
export function makeNamedFiller(mod, packId, nf) {
  const nfMod = NF_MODS[mod.lang];
  const pack = mod.packs[packId];
  const pools = mod.pools;
  const subjects = nf.subjects.length ? nf.subjects : nf.cast;
  const rest = [...nf.cast, ...nf.decoyCast];
  const sfByKey = new Map(mod.SF.map((t) => [t.key, t]));
  const realSF = new Set(nf.realSF);
  const pickName = (rr) => (rr.chance(0.7) ? rr.pick(subjects) : rr.pick(rest));
  const decoy = (rr) => {
    // A statement of a real fact key about a character that does not hold that fact: a decoy under a real name.
    const t = sfByKey.get(rr.pick(nf.sfKeys));
    const pool = [...nf.cast, ...nf.decoyCast].filter((n) => !realSF.has(t.key + '|' + n));
    const s = {};
    for (const [k, p] of Object.entries(t.slots)) {
      if (p === 'name') { let v; do { v = rr.pick(k === 'subj' ? pool : rest); } while (Object.values(s).includes(v)); s[k] = v; }
      else s[k] = rr.pick(pools[p]);
    }
    return t.stmt(s);
  };
  const coList = nfMod.co.filter((e) => e.pool !== 'term' || nf.terms.length);
  return (rr) => {
    const x = rr();
    if (x < 0.1) return decoy(rr);
    const n = pickName(rr);
    if (x < 0.5) return rr.pick(nfMod.presence)(n, rr.pick(mod.gestures), rr.pick(mod.moods), rr.pick(pack.places));
    const e = rr.pick(coList);
    return e.fn(n, e.pool === 'term' ? rr.pick(nf.terms) : rr.pick(pools[e.pool]));
  };
}

export function buildChat(cfg, opts = {}) {
  const { mod, N } = cfg;
  const r = rng(cfg.seed);
  const r2 = opts.namedFiller ? rng((cfg.seed ^ NF_STREAM_XOR) >>> 0) : null;
  const pack = mod.packs[cfg.pack];
  const P = { userName: pack.user, charName: pack.char };
  const pools = mod.pools;

  // ---- slot pickers ----
  const nameShuffled = r.shuffle(pools.name);
  const cast = [pack.user, ...nameShuffled.slice(0, 15)];
  if (mod.lang === 'en') cast.splice(1, 0, pack.char.split(' ').pop());
  else cast.splice(1, 0, pack.char);
  const decoyCast = nameShuffled.slice(15, 31);
  const cursors = {};
  const shuffledPools = {};
  const termsUsed = new Set();
  // The 200 random tries are the original draw and stay first, so every chat that built before builds identically.
  // Only when they are exhausted (the pool is nearly spent: a decoy-heavy chat of thousands of messages) a term comes
  // from the spill pool, drawn from r among the unused ones.
  let spill = null;
  const spillTerm = () => {
    spill ||= termSpill(mod);
    const free = spill.filter((t) => !termsUsed.has(t) && !pools.name.includes(t));
    if (!free.length) throw new Error('terms');
    const t = r.pick(free);
    termsUsed.add(t);
    return t;
  };
  const nextTerm = () => { for (let k = 0; k < 200; k++) { const t = mod.makeTerm(r); if (!termsUsed.has(t) && !pools.name.includes(t)) { termsUsed.add(t); return t; } } return spillTerm(); };
  const take = (pool) => {
    if (!shuffledPools[pool]) { shuffledPools[pool] = r.shuffle(pools[pool]); cursors[pool] = 0; }
    const v = shuffledPools[pool][cursors[pool] % shuffledPools[pool].length];
    cursors[pool]++;
    return v;
  };
  const fill = (tpl, decoy) => {
    const s = {};
    const usedNames = new Set();
    for (const [k, pool] of Object.entries(tpl.slots)) {
      if (pool === 'name') {
        const src = decoy ? decoyCast : cast;
        let v; do { v = r.pick(src); } while (usedNames.has(v));
        usedNames.add(v); s[k] = v;
      } else if (pool === 'term') s[k] = nextTerm();
      else if (decoy || pool === 'month' || pool === 'count' || pool === 'day' || pool === 'weekday') s[k] = r.pick(pools[pool]);
      else s[k] = take(pool);
    }
    // KU / rent: ensure old != new
    if ('a' in s && 'b' in s && s.a === s.b) s.b = r.pick(pools[tpl.slots.b].filter(x => x !== s.a));
    return s;
  };

  // ---- choose templates ----
  const SFexcl = new Set(['hometown', 'profession', 'mentor']);
  const sfAll = r.shuffle(mod.SF);
  const sfReal = sfAll.filter(t => !SFexcl.has(t.key)).slice(0, 8);
  const kuAll = r.shuffle(mod.KU);
  const dropKey = r.pick(['job', 'residence']);
  const kuReal = kuAll.filter(t => t.key !== dropKey).slice(0, 7);
  const trdReal = r.shuffle(mod.TRD).slice(0, 4);
  const mmReal = r.shuffle(mod.MM).slice(0, 6);
  const inReal = r.shuffle(mod.IN).slice(0, 7);
  const conflict = { job: ['profession', 'mentor'], residence: ['hometown'] };
  const blocked = new Set(kuReal.flatMap(t => conflict[t.key] || []));
  const abTpls = mod.SF.filter(t => !sfReal.includes(t) && !blocked.has(t.key));
  if (abTpls.length < 6) throw new Error(cfg.id + ' abTpls ' + abTpls.length);
  const abReal = r.shuffle(abTpls).slice(0, 6);

  // ---- positions ----
  const lo = 8, hi = N - TAIL - 1;
  const planted = []; // positions of planted facts
  const taken = new Set();
  const ok = (p) => p >= lo && p <= hi && planted.every(q => Math.abs(q - p) >= 3);
  const alloc = (a = lo, b = hi) => { for (let k = 0; k < 5000; k++) { const p = a + r.int(b - a + 1); if (ok(p)) { planted.push(p); taken.add(p); return p; } } throw new Error('alloc'); };
  const allocPair = (gmin, gmax) => {
    for (let k = 0; k < 5000; k++) {
      const g = gmin + r.int(gmax - gmin + 1);
      const p1 = lo + r.int(hi - g - lo + 1);
      const p2 = p1 + g;
      if (ok(p1) && ok(p2) && Math.abs(p1 - p2) >= 3) { planted.push(p1, p2); taken.add(p1); taken.add(p2); return [p1, p2]; }
    }
    throw new Error('allocPair');
  };

  const plants = {}; // message id -> [sentences]
  const plantFacts = {}; // message id -> [index of the fact each sentence belongs to], read only by emitPlantSpans
  const addPlant = (id, text) => { (plants[id] ||= []).push(text); (plantFacts[id] ||= []).push(facts.length); };
  const facts = [];
  const questions = [];
  const withSlots = (s) => (opts.emitSlots ? { slots: { ...s } } : {});
  const withFact = () => (opts.emitPlantSpans ? { factIndex: facts.length - 1 } : {});
  const usedSubj = new Set();
  const noteSubj = (s) => { for (const [k, v] of Object.entries(s)) if (tplSubjKeys.has(k) && typeof v === 'string') usedSubj.add(v); };
  const tplSubjKeys = new Set(['subj']);
  const realSF = new Set(); // "key|subj"

  // SF
  for (const t of sfReal) {
    const s = fill(t, false); const id = alloc();
    addPlant(id, t.stmt(s)); noteSubj(s); realSF.add(t.key + '|' + s.subj);
    facts.push({ type: 'SF', key: t.key, ids: [id], answer: t.ans(s) });
    questions.push({ category: 'single_fact', question: t.q(s), question_paraphrase: t.qp(s), answer: t.ans(s), gold_ids: [id], stale_ids: [], key: t.key, ...withSlots(s), ...withFact() });
  }
  // KU
  for (const t of kuReal) {
    const s = fill(t, false); const [p1, p2] = allocPair(130, 380);
    addPlant(p1, t.oldS(s)); addPlant(p2, t.newS(s)); noteSubj(s);
    facts.push({ type: 'KU', key: t.key, ids: [p1, p2], old_answer: t.oldAns(s), answer: t.ans(s) });
    questions.push({ category: 'knowledge_update', question: t.q(s), question_paraphrase: t.qp(s), answer: t.ans(s), gold_ids: [p2], stale_ids: [p1], key: t.key, stale_answer: t.oldAns(s), ...withSlots(s), ...withFact() });
  }
  // temporal date lookup
  for (const t of trdReal) {
    const s = fill(t, false); const id = alloc();
    addPlant(id, t.stmt(s)); noteSubj(s);
    facts.push({ type: 'TR', key: t.key, ids: [id], answer: t.ans(s) });
    questions.push({ category: 'temporal', question: t.q(s), question_paraphrase: t.qp(s), answer: t.ans(s), gold_ids: [id], stale_ids: [], key: t.key, ...withSlots(s), ...withFact() });
  }
  // temporal order (two questions, each with two dated events; chat order random)
  {
    const evs = r.shuffle(pools.happening).slice(0, 4);
    for (let k = 0; k < 2; k++) {
      const [early, late] = [evs[k * 2], evs[k * 2 + 1]];
      const m1 = r.int(pools.month.length - 1), m2 = m1 + 1 + r.int(pools.month.length - 1 - m1);
      const d1 = r.pick(pools.day), d2 = r.pick(pools.day);
      const subj = r.pick(cast);
      const [pa, pb] = allocPair(60, 320);
      const earlyFirstInChat = r.chance(0.5);
      const idEarly = earlyFirstInChat ? pa : pb, idLate = earlyFirstInChat ? pb : pa;
      addPlant(idEarly, mod.TO.stmt(subj, early, d1, pools.month[m1]));
      addPlant(idLate, mod.TO.stmt(r.pick(cast), late, d2, pools.month[m2]));
      const askEarlyFirst = r.chance(0.5);
      const A = askEarlyFirst ? early : late, B = askEarlyFirst ? late : early;
      facts.push({ type: 'TO', key: 'order', ids: [idEarly, idLate], answer: early.noun });
      questions.push({ category: 'temporal', question: mod.TO.q(A, B), question_paraphrase: mod.TO.qp(A, B), answer: early.noun, gold_ids: [idEarly, idLate], stale_ids: [], key: 'order', ...withSlots({ A, B }), ...withFact() });
    }
  }
  // multi-message
  for (const t of mmReal) {
    const s = fill(t, false); const [p1, p2] = allocPair(100, 400);
    const aFirst = r.chance(0.5);
    const idA = aFirst ? p1 : p2, idB = aFirst ? p2 : p1;
    addPlant(idA, t.a(s)); addPlant(idB, t.b(s)); noteSubj(s);
    facts.push({ type: 'MM', key: t.key, ids: [idA, idB], answer: t.ans(s) });
    questions.push({ category: 'multi_message', question: t.q(s), question_paraphrase: t.qp(s), answer: t.ans(s), gold_ids: [idA, idB], stale_ids: [], key: t.key, ...withSlots(s), ...withFact() });
  }
  // invented-name lookup; a few terms get later incidental mentions (lexical distractors)
  let incCount = 0;
  const incNpcs = pack.npcs;
  for (const t of inReal) {
    const s = fill(t, false); const id = alloc();
    addPlant(id, t.stmt(s));
    facts.push({ type: 'IN', key: t.key, ids: [id], answer: t.ans(s), term: s.T });
    questions.push({ category: 'invented_name', question: t.q(s), question_paraphrase: t.qp(s), answer: t.ans(s), gold_ids: [id], stale_ids: [], key: t.key, term: s.T, ...withSlots(s), ...withFact() });
    if (incCount < 3 && id < hi - 80) {
      incCount++;
      const id2 = (() => { for (let k = 0; k < 5000; k++) { const p = id + 30 + r.int(hi - id - 30 + 1); if (ok(p)) { planted.push(p); taken.add(p); return p; } } throw new Error('inc'); })();
      addPlant(id2, mod.incidental(s.T, r.pick(incNpcs)));
      facts.push({ type: 'IN_MENTION', key: t.key, ids: [id2], term: s.T });
    }
  }
  // abstention: unused fact templates asked about a recurring character; the fact is never stated for them.
  const subjList = [...usedSubj];
  for (const t of abReal) {
    let s, tries = 0;
    do { s = fill(t, false); s.subj = r.pick(subjList); tries++; } while (realSF.has(t.key + '|' + s.subj) && tries < 100);
    // fix slot clashes (e.g. rival == subj)
    for (const [k, v] of Object.entries(s)) if (k !== 'subj' && t.slots[k] === 'name' && v === s.subj) s[k] = r.pick(decoyCast);
    questions.push({ category: 'abstention', question: t.q(s), question_paraphrase: t.qp(s), answer: null, gold_ids: [], stale_ids: [], key: t.key, ...withSlots(s) });
    facts.push({ type: 'AB', key: t.key, ids: [], subject: s.subj });
  }

  // decoys: same templates with other characters (never the same template+subject pair as a real fact)
  const decoyTarget = Math.round(N / 8);
  const decoyTpls = [...mod.SF, ...mod.SF, ...mod.IN];
  let decoys = 0;
  for (let k = 0; k < 20000 && decoys < decoyTarget; k++) {
    const p = lo + r.int(hi - lo + 1);
    if (taken.has(p)) continue;
    const t = r.pick(decoyTpls);
    const s = fill(t, true);
    taken.add(p); addPlant(p, t.stmt(s)); decoys++;
    facts.push({ type: 'DECOY', key: t.key, ids: [p] });
  }

  // ---- messages ----
  const nf = opts.namedFiller || opts.emitSlots || opts.emitPlantSpans
    ? { cast, decoyCast, subjects: [...usedSubj], terms: [...termsUsed], sfKeys: sfReal.map(t => t.key), realSF: [...realSF] }
    : null;
  const nfSentence = r2 ? makeNamedFiller(mod, cfg.pack, nf) : null;
  const mkF = () => ({ W: r.pick(pack.weather), P: r.pick(pack.places), N: r.pick(pack.npcs), O: r.pick(pack.objs), G: r.pick(mod.gestures), M: r.pick(mod.moods), T: r.pick(mod.topics) });
  const S = (arr) => r.pick(arr)(P, mkF());
  const messages = [];
  for (let i = 0; i < N; i++) {
    const role = i % 2 === 0 ? 'user' : 'char';
    const sents = role === 'user'
      ? [S(mod.react), S(mod.speech), ...(r.chance(0.5) ? [S(mod.narr)] : []), ...(r.chance(0.3) ? [S(mod.speech)] : [])]
      : [S(mod.narr), S(mod.speech), S(mod.narr), ...(r.chance(0.7) ? [S(mod.speech)] : []), ...(r.chance(0.5) ? [S(mod.narr)] : [])];
    const marks = sents.map(() => -1); // fact index of a planted sentence, -1 otherwise
    if (plants[i]) plants[i].forEach((ptxt, pi) => { const at = 1 + r.int(sents.length); sents.splice(at, 0, ptxt); marks.splice(at, 0, plantFacts[i][pi]); });
    if (r2) {
      for (let c = 0; c < 2; c++) {
        if (!r2.chance(c === 0 ? 0.6 : 0.15)) continue;
        const at = r2.int(sents.length + 1);
        sents.splice(at, 0, nfSentence(r2)); marks.splice(at, 0, -1);
      }
    }
    const msg = { id: i, role, text: sents.join(' ') };
    if (opts.emitPlantSpans) {
      const spans = [];
      let off = 0;
      sents.forEach((s, k) => { if (marks[k] >= 0) spans.push({ start: off, end: off + s.length, factIndex: marks[k] }); off += s.length + 1; });
      if (spans.length) msg.plants = spans;
    }
    messages.push(msg);
  }

  // ---- questions: finalize ids, query-context ids ----
  const qs = r.shuffle(questions).map((q, k) => {
    const c = hi + 2 + r.int(TAIL - 6);
    return { id: `${cfg.id}-q${String(k + 1).padStart(2, '0')}`, ...q, context_ids: [c, c + 1] };
  });

  // leakage: non-gold messages containing the answer string
  for (const q of qs) {
    if (q.answer == null) { q.answer_in_other_messages = null; continue; }
    const a = q.answer.toLowerCase();
    q.answer_in_other_messages = messages.filter(m => !q.gold_ids.includes(m.id) && !q.stale_ids.includes(m.id) && m.text.toLowerCase().includes(a)).length;
  }

  const words = messages.map(m => mod.lang === 'en' ? m.text.split(/\s+/).length : m.text.length);
  const out = {
    meta: { id: cfg.id, language: mod.lang, seed: cfg.seed, setting: pack.setting, message_count: N, user_name: pack.user, char_name: pack.char,
      length_unit: mod.lang === 'en' ? 'words' : 'characters', mean_length: +(words.reduce((a, b) => a + b, 0) / N).toFixed(1), min_length: Math.min(...words), max_length: Math.max(...words),
      decoy_messages: decoys, question_count: qs.length, generator: 'gen.mjs (deterministic; same seed gives byte-identical output)' },
    messages, questions: qs, facts,
  };
  if (nf) out.nf = nf;
  return out;
}
