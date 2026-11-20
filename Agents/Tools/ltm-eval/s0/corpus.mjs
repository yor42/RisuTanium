// Corpora of the S0 harness: M4 (the M4 generator mode, new seeds) and three named-filler (NF) corpora whose messages
// follow a length profile. An NF chat is a generated source chat (about as many source messages as the targets need)
// whose consecutive source messages are merged into N_out messages of the profile's lengths; gold ids, stale ids and
// plant spans are remapped to the merged messages.
import { rng } from '../gen/lib.mjs';
import * as EN from '../gen/content_en.mjs';
import * as KO from '../gen/content_ko.mjs';
import { buildChat, CHATS } from '../gen/build.mjs';
import { specProfile } from './profile.mjs';

export const SEEDS = { TUNE: 510001, GATE: 610001, GATE_R: 620001, FALLBACK: 710001, FALLBACK_R: 720001, CI: 910001 };
export const CORPORA = ['M4', 'NF-real', 'NF-specLong', 'NF-specShort'];
export const LANGS = ['en', 'ko'];
export const N_MIN = 640;        // smallest N in M4's validated configuration
export const NF_REAL_NOUT = 60;  // near the real maximum of messages per chat
export const NF_SPEC_NOUT = 2000;
export const RESERVE_BASE = 10000;
export const JOIN_PARAGRAPH_P = 0.5;

const MODS = { en: EN, ko: KO };

export const chatSeed = (drawSeed, corpusIdx, langIdx, i) => (drawSeed * 1009 + corpusIdx * 101 + langIdx * 17 + i) >>> 0;
// Derived stream seeds of one chat: r2 (named filler, inside the builder), r3 (turns), r4 (profile and merge).
export const derivedSeeds = (s) => ({ r2: (s ^ 0x5EED5EED) >>> 0, r3: (s ^ 0x3C3C3C3C) >>> 0, r4: (s ^ 0x4B4B4B4B) >>> 0 });

// No chat base seed of one family equals a base seed or a derived stream seed of another chat in any family, reserve
// indices included. extra: further draw seeds to include in the check.
export function assertSeedsDisjoint(extra = [], count = 60) {
  const families = [...Object.values(SEEDS), ...extra];
  const bases = new Map();   // base seed -> family index (a seed may repeat inside one family: paired cells)
  const derived = new Map(); // derived stream seed -> 'base/kind'
  families.forEach((fam, f) => {
    for (let c = 0; c < CORPORA.length; c++) for (let l = 0; l < LANGS.length; l++) {
      for (let i = 0; i < 2 * count; i++) {
        const idx = i < count ? i : RESERVE_BASE + (i - count);
        const s = chatSeed(fam, c, l, idx);
        if (bases.has(s) && bases.get(s) !== f) throw new Error(`seed collision: families ${bases.get(s)} and ${f} share chat seed ${s}`);
        bases.set(s, f);
        const d = derivedSeeds(s);
        for (const k of ['r2', 'r3', 'r4']) {
          const tag = s + '/' + k;
          if (derived.has(d[k]) && derived.get(d[k]) !== tag) throw new Error(`derived stream seed ${d[k]} is shared by ${tag} and ${derived.get(d[k])}`);
          derived.set(d[k], tag);
        }
      }
    }
  });
  for (const s of derived.keys()) if (bases.has(s)) throw new Error(`derived stream seed ${s} equals a chat base seed`);
}

const meanLenMemo = new Map();
// m_lang: mean source-message length of the M4 generator for the language (characters).
function meanSourceLength(lang) {
  if (!meanLenMemo.has(lang)) {
    const base = CHATS.find((c) => c.id.startsWith(lang));
    const d = buildChat({ ...base, mod: MODS[lang] });
    meanLenMemo.set(lang, d.messages.reduce((a, m) => a + m.text.length, 0) / d.messages.length);
  }
  return meanLenMemo.get(lang);
}

function profileFor(corpus, ctx) {
  if (corpus === 'NF-real') {
    if (!ctx.profiles?.real) throw new Error('NF-real needs a real profile');
    return ctx.profiles.real;
  }
  return specProfile(corpus === 'NF-specLong' ? 'long' : 'short');
}

function outputCount(corpus, ctx) {
  if (ctx.nOut) return ctx.nOut;
  return corpus === 'NF-real' ? NF_REAL_NOUT : NF_SPEC_NOUT;
}

// Remaps a built chat (messages of the source chat) onto output messages. owner[k] is the output index of source
// message k and base[k] the offset of its text inside that output.
function finish(built, spec, owner, base, outMessages, meta) {
  const names = { user: built.meta.user_name, char: built.meta.char_name };
  const messages = outMessages.map((m, id) => ({ id, role: m.role, text: m.text, ...(m.role === 'char' ? { name: names.char } : {}) }));
  const spansOf = (ids, factIndex) => {
    const out = [];
    for (const g of ids) for (const p of built.messages[g].plants ?? []) if (p.factIndex === factIndex) out.push({ msg: owner[g], start: base[g] + p.start, end: base[g] + p.end });
    return out;
  };
  const uniq = (a) => [...new Set(a)];
  const questions = built.questions.map((q) => {
    const goldSpans = spansOf(q.gold_ids, q.factIndex);
    const staleSpans = spansOf(q.stale_ids, q.factIndex);
    const gold = uniq(q.gold_ids.map((g) => owner[g]));
    const stale = uniq(q.stale_ids.map((g) => owner[g]));
    return {
      id: q.id, category: q.category, key: q.key, answer: q.answer, staleAnswer: q.stale_answer ?? null,
      paraphrase: q.question_paraphrase, slots: q.slots, term: q.term ?? null,
      gold, stale, goldSpans, staleSpans,
      mergedKU: q.category === 'knowledge_update' && stale.length > 0 && gold.includes(stale[0]),
    };
  });
  return { id: `${spec.corpus}-${spec.lang}-${spec.i}`, corpus: spec.corpus, lang: spec.lang, seed: meta.seed, i: spec.i, names, packId: meta.packId, nf: built.nf, meta, messages, questions };
}

export function drawChat(spec, ctx = {}) {
  const { drawSeed, corpus, lang, i } = spec;
  const corpusIdx = CORPORA.indexOf(corpus);
  const langIdx = LANGS.indexOf(lang);
  const seed = chatSeed(drawSeed, corpusIdx, langIdx, i);
  const mod = MODS[lang];
  const build = ctx.build ?? buildChat;
  const packId = `${lang}${1 + (i % 2)}`;
  const meta = { seed, packId, drawSeed, corpusIdx, langIdx };
  if (corpus === 'M4') {
    const N = lang === 'en' ? [820, 640][i % 2] : [740, 900][i % 2];
    const built = build({ id: packId, mod, pack: packId, seed, N }, { emitSlots: true, emitPlantSpans: true });
    const ident = built.messages.map((_, k) => k);
    Object.assign(meta, { Nsrc: N, Nout: N, factor: 1, floorFlag: false });
    return finish(built, spec, ident, ident.map(() => 0), built.messages, meta);
  }
  const profile = profileFor(corpus, ctx);
  const r4 = rng(derivedSeeds(seed).r4);
  const roleOf = (j) => (j % 2 === 0 ? 'user' : 'char');
  const targets = [];
  let sumT = 0;
  const target = () => { const t = profile.sample(r4, roleOf(targets.length)); targets.push(t); sumT += t; };
  const nOut0 = outputCount(corpus, ctx);
  for (let j = 0; j < nOut0; j++) target();
  const nSrc = Math.max(N_MIN, Math.ceil(sumT / meanSourceLength(lang)));
  const floorFlag = nSrc === N_MIN && Math.ceil(sumT / meanSourceLength(lang)) < N_MIN;
  const built = build({ id: packId, mod, pack: packId, seed, N: nSrc }, { namedFiller: true, emitSlots: true, emitPlantSpans: true });
  const src = built.messages;
  const S = src.reduce((a, m) => a + m.text.length, 0);
  // Source text beyond the targets' sum means more targets: N_out grows, the per-message distribution does not change.
  while (sumT < S && targets.length < nSrc) target();
  const nOut = targets.length;
  const factor = S / sumT;
  // First source message of each output: by the cumulative scaled target, kept strictly increasing so no output is empty.
  const mid = []; { let acc = 0; for (const m of src) { mid.push(acc + m.text.length / 2); acc += m.text.length; } }
  const first = [0];
  let cumT = 0, k = 0;
  for (let j = 1; j < nOut; j++) {
    cumT += targets[j - 1] * factor;
    while (k < nSrc && mid[k] < cumT) k++;
    first.push(Math.max(first[j - 1] + 1, Math.min(k, nSrc - (nOut - j))));
  }
  const owner = new Array(nSrc), base = new Array(nSrc), out = [];
  for (let j = 0; j < nOut; j++) {
    const end = j + 1 < nOut ? first[j + 1] : nSrc;
    let text = '';
    for (let s = first[j]; s < end; s++) {
      if (s > first[j]) text += ctx.joinAll ?? (r4() < JOIN_PARAGRAPH_P ? '\n\n' : ' ');
      owner[s] = j; base[s] = text.length; text += src[s].text;
    }
    out.push({ role: roleOf(j), text });
  }
  Object.assign(meta, { Nsrc: nSrc, Nout: nOut, factor, floorFlag, targetSum: sumT, sourceChars: S });
  return finish(built, spec, owner, base, out, meta);
}

const NON_LENGTH = (e) => e instanceof Error && (e.message === 'terms' || / abTpls /.test(e.message));

// A throw that is not a length throw (terms, abTpls) is replaced by the first unused index of the reserve sequence
// (RESERVE_BASE + i, then + 1 per try) and reported. A length throw (position allocation) at N >= N_MIN is a defect.
export function drawWithReserve(spec, ctx = {}) {
  const replacements = [];
  for (let t = 0; t < 50; t++) {
    const idx = t === 0 ? spec.i : RESERVE_BASE + spec.i + (t - 1);
    try {
      return { chat: drawChat({ ...spec, i: idx }, ctx), replacements, requestedIndex: spec.i };
    } catch (e) {
      if (!NON_LENGTH(e)) throw e;
      replacements.push({ index: idx, reason: e.message });
    }
  }
  throw new Error('generator: no usable reserve index for ' + spec.i);
}

// One chat per cell, synthetic profiles only, so S1 can commit what it builds. NF chats use N_out = 300.
export function ciSubset() {
  const chats = [];
  for (const lang of LANGS) for (const corpus of ['M4', 'NF-specLong']) {
    chats.push(drawChat({ drawSeed: SEEDS.CI, corpus, lang, i: 0 }, { nOut: 300 }));
  }
  return chats;
}
