// BM25 retrieval primitives of the M2 experiment. The tokeniser and scorer are the M2 versions, unchanged:
// lowercase without NFKC, Hangul pieces as overlapping code-point bigrams ('bi') or whole words ('ws'),
// Latin pieces stemmed and stopword-filtered. They are not the spec 5.3 tokeniser.
export const STOP = new Set('a an the and or but if of to in on at by for with from as is are was were be been being it its this that these those i you he she we they them his her their my your our me him us not no do does did have has had will would can could should shall may might must so than then there here what which who whom whose when where why how'.split(' '));
export const stem = (w) => { if (w.endsWith("'s") || w.endsWith('’s')) w = w.slice(0, -2); if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1); return w; };
export function tok(text, mode = 'bi') {
  const out = [];
  for (const t of text.toLowerCase().split(/[^\p{L}\p{N}'’]+/u)) {
    if (!t) continue;
    if (/\p{Script=Hangul}/u.test(t)) {
      if (mode === 'ws') out.push(t);
      else { const cs = [...t]; if (cs.length === 1) out.push(cs[0]); else for (let i = 0; i < cs.length - 1; i++) out.push(cs[i] + cs[i + 1]); }
    } else {
      let w = t.replace(/^['’]+|['’]+$/g, ''); if (!w) continue;
      w = stem(w); if (w.length < 2 && !/\d/.test(w)) continue; if (STOP.has(w)) continue; out.push(w);
    }
  }
  return out;
}
export class BM25 {
  constructor(docs, mode, k1 = 1.2, b = 0.75) {
    this.mode = mode; this.k1 = k1; this.b = b; this.N = docs.length;
    this.post = new Map(); this.len = new Float64Array(this.N);
    docs.forEach((d, i) => {
      const toks = tok(d, mode); this.len[i] = toks.length;
      const tf = new Map(); for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
      for (const [t, c] of tf) { if (!this.post.has(t)) this.post.set(t, []); this.post.get(t).push([i, c]); }
    });
    this.avg = this.len.reduce((a, b) => a + b, 0) / this.N;
  }
  score(q) {
    const s = new Float64Array(this.N);
    for (const t of new Set(tok(q, this.mode))) {
      const p = this.post.get(t); if (!p) continue;
      const idf = Math.log(1 + (this.N - p.length + 0.5) / (p.length + 0.5));
      for (const [i, c] of p) s[i] += idf * c * (this.k1 + 1) / (c + this.k1 * (1 - this.b + this.b * this.len[i] / this.avg));
    }
    return s;
  }
}
export function rankOf(scores) {
  const n = scores.length, idx = Array.from({ length: n }, (_, i) => i);
  idx.sort((a, b) => scores[b] - scores[a] || a - b);
  const r = new Int32Array(n); idx.forEach((d, p) => { r[d] = p + 1; }); return r;
}
