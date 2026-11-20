// Deterministic generator for the synthetic roleplay memory evaluation set.
// Usage: node gen.mjs <outDir>
// The chat builder lives in build.mjs; this file is only the command-line wrapper around it.
import fs from 'node:fs';
import path from 'node:path';
import * as EN from './content_en.mjs';
import * as KO from './content_ko.mjs';
import { CHATS, buildChat } from './build.mjs';

const outDir = process.argv[2];
fs.mkdirSync(outDir, { recursive: true });

for (const base of CHATS) {
  const cfg = { ...base, mod: base.id.startsWith('en') ? EN : KO };
  const d = buildChat(cfg);
  fs.writeFileSync(path.join(outDir, `chat-${cfg.id}.json`), JSON.stringify(d, null, 1), 'utf8');
  const cats = {};
  for (const q of d.questions) cats[q.category] = (cats[q.category] || 0) + 1;
  console.log(cfg.id, JSON.stringify(d.meta), JSON.stringify(cats));
  const leaks = d.questions.filter(q => q.answer_in_other_messages > 0).length;
  console.log('  questions whose answer string also occurs in a non-gold message:', leaks);
}
