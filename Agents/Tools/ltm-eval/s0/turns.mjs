// Turn-shaped queries. A turn is one user message appended to a chat: filler sentences up to a user-length target with a
// cue at a fixed relative position. Fact turns carry a cue for an answerable question, in two styles (ask, allude);
// no-fact turns carry an abstention cue or no cue at all. The query is the last 500 code points of the turn.
//
// Filler regimes are paired: the same chat, fact, style, length target and cue slot; only the filler sentences differ.
//   POOL      fresh draws from the chat's own generator filler and named filler (the primary regime);
//   DISJOINT  pseudo-words with df = 0 in the chat's whole corpus (the dilution-free bound);
//   SELF      filler copied from the chat's own newest message (adversarial diagnostic).
import { rng } from '../gen/lib.mjs';
import * as EN from '../gen/content_en.mjs';
import * as KO from '../gen/content_ko.mjs';
import { makeNamedFiller } from '../gen/build.mjs';
import { derivedSeeds } from './corpus.mjs';
import { tokenize } from './lexical.ts';
import * as TEN from './turns_en.mjs';
import * as TKO from './turns_ko.mjs';

export const TAIL_CHARS = 500;
export const STYLES = ['ask', 'allude'];
export const REGIMES = ['POOL', 'DISJOINT', 'SELF'];
export const OVERLAP_CAP = 1;            // per allude turn, in the units of the language
export const FUNCTION_DF_FRACTION = 0.05; // KO: a bigram in at least this share of the chat's messages is a function bigram
export const NOFACT_FILLER_ONLY = 20;
export const POOL_NAMED_RATE = 0.14;     // share of POOL sentences from the named filler (the corpus rate, about)

const MODS = { en: EN, ko: KO };
const TURNS = { en: TEN, ko: TKO };
const norm = (s) => s.normalize('NFKC').toLowerCase();

export const cpLen = (s) => Array.from(s).length;
// Last n code points: a surrogate pair at the cut stays whole.
export const tailOf = (text, n = TAIL_CHARS) => { const cs = Array.from(text); return cs.length <= n ? text : cs.slice(cs.length - n).join(''); };

const vocabMemo = new WeakMap();
// Chat vocabulary: token df over messages, the token and syllable sets, and the KO function-bigram test.
export function chatVocab(chat) {
  let v = vocabMemo.get(chat);
  if (v) return v;
  const df = new Map(), syllables = new Set();
  for (const m of chat.messages) {
    for (const t of new Set(tokenize(m.text))) df.set(t, (df.get(t) ?? 0) + 1);
    for (const c of norm(m.text)) if (/[가-힣]/.test(c)) syllables.add(c);
  }
  const n = chat.messages.length;
  v = { df, n, tokens: new Set(df.keys()), syllables, isFunction: (t) => (df.get(t) ?? 0) >= FUNCTION_DF_FRACTION * n };
  vocabMemo.set(chat, v);
  return v;
}

export const allKey = (q) => (q.category === 'invented_name' ? 'IN.' + q.key : q.key);

function spanTexts(chat, q) {
  return [...q.goldSpans, ...q.staleSpans].map((sp) => chat.messages[sp.msg].text.slice(sp.start, sp.end));
}

// overlap = |cue ∩ G - X| in the units of the language. G holds the tokens of every gold span (KU: new and stale spans);
// X holds the cast names and the fact's key entities.
//   EN: spec tokens (words).
//   KO: whitespace words (eojeol); a word counts 1 when at least one of its bigrams is in G, not in X and not a function
//       bigram, however many such bigrams it has. A word that starts with a cast name or entity counts 0 (name + particle).
// ratio = overlap / |cue - X| in the same units (the number of cue units that are not entity units).
export function overlap(chat, q, cue, entities) {
  const G = new Set(tokenize(spanTexts(chat, q).join(' ')));
  const names = [...(chat.nf?.cast ?? []), ...(chat.nf?.decoyCast ?? []), ...entities].map(norm);
  const X = new Set(tokenize(names.join(' ')));
  if (chat.lang === 'en') {
    const ct = new Set(tokenize(cue));
    const rest = [...ct].filter((t) => !X.has(t));
    const count = rest.filter((t) => G.has(t)).length;
    return { count, units: rest.length, ratio: rest.length ? count / rest.length : 0 };
  }
  const vocab = chatVocab(chat);
  let count = 0, units = 0;
  for (const w of norm(cue).split(/\s+/)) {
    const plain = w.replace(/[^\p{L}\p{N}]/gu, '');
    if (!plain || names.some((e) => e && plain.startsWith(e))) continue;
    const toks = tokenize(w);
    if (!toks.length || toks.every((t) => X.has(t))) continue;
    units++;
    if (toks.some((t) => G.has(t) && !X.has(t) && !vocab.isFunction(t))) count++;
  }
  return { count, units, ratio: units ? count / units : 0 };
}

// The allude guard is a per-turn cap: every turn must stay within it; a low mean is not the test.
export const capOk = (overlaps) => overlaps.every((o) => o.count <= OVERLAP_CAP);

// ---- filler generators: (rr, state) -> one sentence ----
const CONS = 'bcdfghjklmnprstvz', VOW = 'aeiou';
function disjointGen(chat) {
  const v = chatVocab(chat);
  if (chat.lang === 'en') {
    const word = (rr) => {
      for (let k = 0; k < 200; k++) {
        let w = '';
        for (let s = 3 + rr.int(2); s > 0; s--) w += CONS[rr.int(CONS.length)] + VOW[rr.int(VOW.length)];
        if (!v.tokens.has(w)) return w;
      }
      throw new Error('disjoint word');
    };
    return (rr) => { const n = 4 + rr.int(6); const ws = []; for (let i = 0; i < n; i++) ws.push(word(rr)); return ws.join(' ') + '.'; };
  }
  const syl = (rr) => { for (let k = 0; k < 500; k++) { const c = String.fromCharCode(0xAC00 + rr.int(11172)); if (!v.syllables.has(c)) return c; } throw new Error('disjoint syllable'); };
  return (rr) => {
    const n = 3 + rr.int(4); const ws = [];
    for (let i = 0; i < n; i++) { let w = ''; for (let s = 2 + rr.int(3); s > 0; s--) w += syl(rr); ws.push(w); }
    return ws.join(' ') + '.';
  };
}

function poolGen(chat) {
  const mod = MODS[chat.lang];
  const pack = mod.packs[chat.packId];
  const P = { userName: pack.user, charName: pack.char };
  const named = makeNamedFiller(mod, chat.packId, chat.nf);
  return (rr) => {
    if (rr() < POOL_NAMED_RATE) return named(rr);
    const f = { W: rr.pick(pack.weather), P: rr.pick(pack.places), N: rr.pick(pack.npcs), O: rr.pick(pack.objs), G: rr.pick(mod.gestures), M: rr.pick(mod.moods), T: rr.pick(mod.topics) };
    return rr.pick(rr.pick([mod.react, mod.speech, mod.narr, mod.speech]))(P, f);
  };
}

function selfGen(chat) {
  const sents = chat.messages[chat.messages.length - 1].text.split(/(?<=[.!?…。"”])\s+/).filter(Boolean);
  let at = 0;
  return () => sents[at++ % sents.length];
}

const GEN = { POOL: poolGen, DISJOINT: disjointGen, SELF: selfGen };

const hash32 = (a, b, c) => (Math.imul(a ^ 0x9E3779B9, 2654435761) ^ Math.imul(b + 1, 40503) ^ Math.imul(c + 1, 2246822519)) >>> 0;

// Sentences until the joined length reaches the budget (no sentence for a budget of 0). A sentence holding the
// question's answer or stale answer is redrawn: no turn contains either.
function fillTo(budget, gen, rr, avoid) {
  if (budget <= 0) return '';
  const out = [];
  let len = 0;
  while (len < budget) {
    let s = gen(rr);
    for (let k = 0; k < 20 && avoid.some((a) => s.toLowerCase().includes(a)); k++) s = gen(rr);
    out.push(s);
    len += s.length + 1;
  }
  return out.join(' ');
}

// opts: { regime, profile, lenMode: 'hist' | number (a fixed filler length in characters, 0 for the cue alone) }
export function buildTurns(chat, opts) {
  const regime = opts.regime ?? 'POOL';
  const lenMode = opts.lenMode ?? 'hist';
  const T = TURNS[chat.lang];
  const mod = MODS[chat.lang];
  const r3 = rng(derivedSeeds(chat.seed).r3);
  const plan = [];
  for (const q of chat.questions) if (q.gold.length) for (const style of STYLES) plan.push({ kind: 'fact', q, style });
  for (const q of chat.questions) if (q.category === 'abstention') for (const style of STYLES) plan.push({ kind: 'nofact', q, style });
  for (let i = 0; i < NOFACT_FILLER_ONLY; i++) plan.push({ kind: 'nofact', q: null, style: null });
  // Regime-independent draws, in plan order.
  for (const p of plan) { p.len = opts.profile.sample(r3, 'user'); p.frac = r3(); p.g = r3.int(mod.gestures.length); }
  const gen = GEN[regime](chat);
  return plan.map((p, idx) => {
    const target = lenMode === 'hist' ? p.len : lenMode;
    let cue = null, entities = [];
    if (p.q) {
      if (p.style === 'ask') cue = T.askCue(p.q.paraphrase, chat.names.user, mod.gestures[p.g]);
      else { const a = T.ALLUDE[allKey(p.q)]; cue = a.t(p.q.slots); entities = a.e(p.q.slots).filter((x) => typeof x === 'string'); }
    }
    const rr = rng(hash32(chat.seed, idx, REGIMES.indexOf(regime)));
    const avoid = p.q ? [p.q.answer, p.q.staleAnswer].filter(Boolean).map((a) => a.toLowerCase()) : [];
    const rest = Math.max(0, target - (cue ? cue.length : 0));
    const pre = Math.floor(p.frac * rest);
    const prefix = fillTo(pre, gen, rr, avoid), suffix = fillTo(rest - pre, gen, rr, avoid);
    const parts = [prefix, cue, suffix].filter((x) => x);
    const text = parts.join(' ');
    const cueStart = cue ? (prefix ? prefix.length + 1 : 0) : -1;
    const query = tailOf(text);
    const turn = {
      idx, id: `${chat.id}:${idx}`, kind: p.kind, qid: p.q?.id ?? null, category: p.q?.category ?? null, style: p.style, regime,
      lenTarget: target, cueFrac: p.frac, cue, cueStart, cueEnd: cue ? cueStart + cue.length : -1, entities, prefix, suffix, text, query,
      cueInTail: cue ? cpLen(text) - cpLen(text.slice(0, cueStart)) <= TAIL_CHARS : null,
    };
    if (p.kind === 'fact') turn.overlap = overlap(chat, p.q, cue, entities);
    return turn;
  });
}
