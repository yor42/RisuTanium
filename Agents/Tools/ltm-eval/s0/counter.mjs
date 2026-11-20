// Token counters for the S0 harness. The primary counter is the app default: gemini-3-flash-preview is a GoogleCloud
// model without googleClaudeTokenizing, whose count is transformers' GemmaTokenizer over public/token/llama/llama3.json
// (tokenizer.ts, gemmaTokenize). o200k is the sensitivity counter. Both load in plain Node from installed dependencies.
// A chat record costs its content tokens plus 3 (chatAdditonalTokens for non-gpt models); a char record also carries
// its name in 'name' mode: name tokens plus 1 (tokenizer.ts, index.svelte.ts). User records carry no name.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(fileURLToPath(new URL('../../../../', import.meta.url)));

// Probe sentences whose node-build counts the guard pins (llama3: 38 and 54, o200k: 37 and 56).
export const PROBE = {
  en: 'Ser Rowan handed the ferry boy three silver coins and spoke quietly. "If the sun sets before we cross, we are in trouble." Tamsin hugged the map case and nodded.',
  ko: '무영은 나룻배 소년에게 은화 세 닢을 건네며 낮게 말했다. "강을 건너기 전에 해가 지면 곤란하다." 이서는 지도 상자를 품에 안고 고개를 끄덕였다.',
};

const memoOf = (encodeLen) => {
  const memo = new Map();
  return (s) => {
    let v = memo.get(s);
    if (v === undefined) { v = encodeLen(s); memo.set(s, v); }
    return v;
  };
};

// A counter is { kind, len(text) }; len is memoised by text.
export async function loadCounter(kind = 'llama3') {
  if (kind === 'llama3') {
    const tf = await import('@huggingface/transformers');
    const json = JSON.parse(fs.readFileSync(path.join(REPO, 'public', 'token', 'llama', 'llama3.json'), 'utf8'));
    const tk = new tf.GemmaTokenizer(json, {});
    return { kind, len: memoOf((s) => tk.encode(s).length) };
  }
  if (kind === 'o200k') {
    const { Tiktoken } = await import('@dqbd/tiktoken');
    const o = JSON.parse(fs.readFileSync(path.join(REPO, 'src', 'etc', 'o200k_base.json'), 'utf8'));
    const enc = new Tiktoken(o.bpe_ranks, o.special_tokens, o.pat_str);
    return { kind, len: memoOf((s) => enc.encode(s).length) };
  }
  throw new Error('counter kind ' + kind);
}

// A deterministic counter for tests (default: one token per four characters, rounded up).
export function stubCounter(fn = (s) => Math.ceil(s.length / 4)) {
  return { kind: 'stub', len: memoOf(fn) };
}

export const CHAT_OVERHEAD = 3;

// Cost of one chat record. rec = { role, text, name? }; the name counts for char records only.
export function chatCost(counter, rec) {
  let c = counter.len(rec.text) + CHAT_OVERHEAD;
  if (rec.role === 'char' && rec.name) c += counter.len(rec.name) + 1;
  return c;
}
