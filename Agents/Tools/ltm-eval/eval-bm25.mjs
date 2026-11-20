// BM25 half of the M2 retrieval analysis, ported without the embedding models.
// Library: evaluateBm25(datasetDir) -> { aggregates, tablesLines }.
// CLI: node eval-bm25.mjs <datasetDir> <outDir>  (writes tables.md and aggregates.json)
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { BM25, rankOf, tok } from './bm25.mjs';

const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const RETR = ['bm25', 'bm25ws'];
const GR = ['msg', 'win'], QS = ['q', 'qctx'], WD = ['orig', 'para'];
const LANGS = ['en', 'ko'];
const CATS = ['single_fact', 'knowledge_update', 'temporal', 'multi_message', 'invented_name'];
const RLABEL = (r) => r === 'bm25' ? 'BM25 (bigram)' : 'BM25 (whitespace words)';

export function evaluateBm25(dsDir) {
  const chats = {};
  for (const f of fs.readdirSync(dsDir).filter(f => f.endsWith('.json')).sort()) { const d = JSON.parse(fs.readFileSync(path.join(dsDir, f), 'utf8')); chats[d.meta.id] = d; }
  const recs = {};
  const push = (k, r) => { (recs[k] ||= []).push(r); };

  for (const [id, d] of Object.entries(chats)) {
    const msgs = d.messages.map(m => m.text);
    const wins = []; for (let i = 0; i < msgs.length; i += 3) wins.push(msgs.slice(i, i + 3).join('\n'));
    const lang = d.meta.language;
    for (const gr of GR) {
      const docs = gr === 'msg' ? msgs : wins;
      const toDoc = (i) => gr === 'msg' ? i : Math.floor(i / 3);
      const bm = new BM25(docs, 'bi'), bw = new BM25(docs, 'ws');
      d.questions.forEach((q) => {
        const goldDocs = [...new Set(q.gold_ids.map(toDoc))], staleDocs = [...new Set(q.stale_ids.map(toDoc))];
        for (let v = 0; v < 4; v++) {
          const qs = v % 2 === 1 ? 'qctx' : 'q', wd = v >= 2 ? 'para' : 'orig';
          const base = wd === 'orig' ? q.question : q.question_paraphrase;
          const text = qs === 'qctx' ? q.context_ids.map(i => msgs[i]).join('\n') + '\n' + base : base;
          const sb = bm.score(text), rb = rankOf(sb);
          const per = {};
          per.bm25 = { s: sb, r: rb };
          const swb = bw.score(text); per.bm25ws = { s: swb, r: rankOf(swb) };
          for (const [name, { s, r }] of Object.entries(per)) {
            const gr_ = goldDocs.map(g => r[g]);
            const rec = { chat: id, lang, qid: q.id, cat: q.category, key: q.key,
              best: gr_.length ? Math.min(...gr_) : null, worst: gr_.length ? Math.max(...gr_) : null,
              latest: gr_.length ? Math.min(...gr_) : null,
              stale: staleDocs.length ? Math.min(...staleDocs.map(g => r[g])) : null,
              tie: goldDocs.some(g => staleDocs.includes(g)),
              top1: Math.max(...s) };
            push(`${name}|${gr}|${qs}|${wd}`, rec);
          }
        }
      });
    }
  }

  const ans = (rs) => rs.filter(r => r.cat !== 'abstention');
  function agg(rs) {
    const a = ans(rs);
    return { n: a.length, r1: mean(a.map(r => r.best <= 1 ? 1 : 0)), r5: mean(a.map(r => r.best <= 5 ? 1 : 0)), r10: mean(a.map(r => r.best <= 10 ? 1 : 0)), mrr: mean(a.map(r => 1 / r.best)) };
  }
  const sel = (key, f = () => true) => (recs[key] || []).filter(f);
  const pct = (x) => (100 * x).toFixed(0);
  const f2 = (x) => x.toFixed(2);
  const out = [];
  const P = (s = '') => out.push(s);
  const table = (head, rows) => { P('| ' + head.join(' | ') + ' |'); P('|' + head.map((h, i) => i === 0 ? '---' : '---:').join('|') + '|'); for (const r of rows) P('| ' + r.join(' | ') + ' |'); P(); };

  // T1
  P('### T1. Overall retrieval, per-message index, query = question, original wording (answerable questions only)');
  P();
  {
    const rows = RETR.map(r => {
      const row = [RLABEL(r)];
      for (const L of LANGS) { const a = agg(sel(`${r}|msg|q|orig`, x => x.lang === L)); row.push(pct(a.r1), pct(a.r5), pct(a.r10), f2(a.mrr)); }
      return row;
    });
    P('Cells: R@1 / R@5 / R@10 in percent, MRR as 0-1. n = 68 answerable questions per language.');
    P();
    table(['Retriever', 'EN R@1', 'EN R@5', 'EN R@10', 'EN MRR', 'KO R@1', 'KO R@5', 'KO R@10', 'KO MRR'], rows);
  }
  // T2 per category
  for (const metric of ['r5', 'mrr']) {
    P(`### T2-${metric}. ${metric === 'r5' ? 'Recall@5 (percent)' : 'MRR (0-1)'} by category, per-message index, query = question, original wording`);
    P();
    for (const L of LANGS) {
      P(`**${L.toUpperCase()}** (n per category: ${CATS.map(c => c + '=' + agg(sel('bm25|msg|q|orig', x => x.lang === L && x.cat === c)).n).join(', ')})`);
      P();
      table(['Retriever', ...CATS, 'all'], RETR.map(r => [RLABEL(r), ...CATS.map(c => { const a = agg(sel(`${r}|msg|q|orig`, x => x.lang === L && x.cat === c)); return metric === 'r5' ? pct(a.r5) : f2(a.mrr); }), (() => { const a = agg(sel(`${r}|msg|q|orig`, x => x.lang === L)); return metric === 'r5' ? pct(a.r5) : f2(a.mrr); })()]));
    }
  }
  // T3 settings
  P('### T3. MRR under each setting (granularity / query / wording)');
  P();
  const SETS = []; for (const g of GR) for (const q of QS) for (const w of WD) SETS.push([g, q, w]);
  for (const L of LANGS) {
    P(`**${L.toUpperCase()}**`); P();
    table(['Retriever', ...SETS.map(s => s.join('/'))], RETR.map(r => [RLABEL(r), ...SETS.map(([g, q, w]) => f2(agg(sel(`${r}|${g}|${q}|${w}`, x => x.lang === L)).mrr))]));
  }
  P('### T3b. Recall@5 (percent) under each setting'); P();
  for (const L of LANGS) {
    P(`**${L.toUpperCase()}**`); P();
    table(['Retriever', ...SETS.map(s => s.join('/'))], RETR.map(r => [RLABEL(r), ...SETS.map(([g, q, w]) => pct(agg(sel(`${r}|${g}|${q}|${w}`, x => x.lang === L)).r5))]));
  }
  // T4 KU
  P('### T4. Knowledge update: latest value ranked above the stale value (per-message index, original wording)'); P();
  {
    const rows = RETR.map(r => {
      const row = [RLABEL(r)];
      for (const qs of QS) for (const L of LANGS) {
        const ks = sel(`${r}|msg|${qs}|orig`, x => x.lang === L && x.cat === 'knowledge_update');
        const above = ks.filter(x => x.latest < x.stale).length, top1stale = ks.filter(x => x.stale === 1).length, latestTop1 = ks.filter(x => x.latest === 1).length;
        row.push(`${above}/${ks.length} (L@1 ${latestTop1}, S@1 ${top1stale})`);
      }
      return row;
    });
    P('Cell: count of questions where the latest-value message outranks the stale-value message / total; L@1 = latest value ranked first, S@1 = stale value ranked first.'); P();
    table(['Retriever', 'q EN', 'q KO', 'q+ctx EN', 'q+ctx KO'], rows);
  }
  // T4b KU both retrieved
  P('### T4b. Knowledge update: both the latest and the stale message inside top-10 (per-message index, original wording)'); P();
  {
    const rows = RETR.map(r => { const row = [RLABEL(r)]; for (const L of LANGS) { const ks = sel(`${r}|msg|q|orig`, x => x.lang === L && x.cat === 'knowledge_update'); row.push(`${ks.filter(x => x.latest <= 10 && x.stale <= 10).length}/${ks.length}`, `${ks.filter(x => x.latest <= 5).length}/${ks.length}`); } return row; });
    P('Columns per language: both in top-10, latest in top-5.'); P();
    table(['Retriever', 'EN both@10', 'EN latest@5', 'KO both@10', 'KO latest@5'], rows);
  }
  // T5 multi-message all-gold coverage
  P('### T5. Multi-message: both gold messages inside top-k (per-message index, query = question, original wording)'); P();
  {
    const rows = RETR.map(r => {
      const row = [RLABEL(r)];
      for (const L of LANGS) { const ms = sel(`${r}|msg|q|orig`, x => x.lang === L && x.cat === 'multi_message'); for (const k of [10, 20]) row.push(`${ms.filter(x => x.worst <= k).length}/${ms.length}`); row.push(`${ms.filter(x => x.best <= 10).length}/${ms.length}`); }
      return row;
    });
    P('Columns: both gold in top-10, both in top-20, at least one in top-10.'); P();
    table(['Retriever', 'EN both@10', 'EN both@20', 'EN any@10', 'KO both@10', 'KO both@20', 'KO any@10'], rows);
  }
  // T6 abstention
  P('### T6. Abstention signal: top-1 score of answerable vs abstention questions (per-message index, query = question, original wording)'); P();
  {
    const rows = [];
    for (const r of ['bm25']) {
      const row = [RLABEL(r)];
      for (const L of LANGS) {
        const all = sel(`${r}|msg|q|orig`, x => x.lang === L);
        const A = all.filter(x => x.cat !== 'abstention').map(x => x.top1), B = all.filter(x => x.cat === 'abstention').map(x => x.top1);
        let w = 0; for (const a of A) for (const b of B) w += a > b ? 1 : a === b ? 0.5 : 0;
        row.push(f2(mean(A)), f2(mean(B)), f2(w / (A.length * B.length)));
      }
      rows.push(row);
    }
    P('For BM25 the score is the raw BM25 sum (not bounded); for embeddings it is the top cosine. AUC = chance that an answerable question has a higher top-1 score than an abstention question (0.5 = no signal). n_answerable=68, n_abstain=12 per language.'); P();
    table(['Retriever', 'EN mean(answerable)', 'EN mean(abstain)', 'EN AUC', 'KO mean(answerable)', 'KO mean(abstain)', 'KO AUC'], rows);
  }
  // T9 lexical overlap
  P('### T9. Lexical overlap between question and gold message(s): share of distinct question tokens (same tokeniser as BM25) that occur in a gold message'); P();
  {
    const rows = [];
    for (const L of LANGS) for (const w of ['orig', 'para']) {
      const vals = [];
      for (const d of Object.values(chats)) if (d.meta.language === L) for (const q of d.questions) {
        if (!q.gold_ids.length) continue;
        const qt = new Set(tok(w === 'orig' ? q.question : q.question_paraphrase));
        const gt = new Set(q.gold_ids.flatMap(i => tok(d.messages[i].text)));
        if (qt.size) vals.push([...qt].filter(t => gt.has(t)).length / qt.size);
      }
      rows.push([L.toUpperCase(), w, String(vals.length), f2(mean(vals))]);
    }
    table(['Lang', 'Wording', 'n', 'mean share of question tokens found in gold'], rows);
  }
  const aggregates = {};
  for (const k of Object.keys(recs)) for (const L of LANGS) aggregates[`${k}|${L}`] = agg(recs[k].filter(x => x.lang === L));
  return { aggregates, tablesLines: out };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [dsDir, outDir] = process.argv.slice(2);
  fs.mkdirSync(outDir, { recursive: true });
  const { aggregates, tablesLines } = evaluateBm25(dsDir);
  fs.writeFileSync(path.join(outDir, 'tables.md'), tablesLines.join('\n'), 'utf8');
  fs.writeFileSync(path.join(outDir, 'aggregates.json'), JSON.stringify(aggregates, null, 1));
  console.log('tables', tablesLines.length);
}
