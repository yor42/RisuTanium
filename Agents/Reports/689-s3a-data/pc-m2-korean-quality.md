# M2 + M4: synthetic roleplay memory evaluation set and retrieval quality of local embeddings, BM25 and hybrid

STATUS: COMPLETE (all 6 models loaded and ran; extra pooling and prefix runs done). Scratch only; no repository file was read for writing and nothing was written under C:\Projects\RisuAI. Base inspected read-only: main eedeb4c1a, `src/ts/process/memory/hypamemory.ts` (localModels) and `src/ts/process/transformers.ts` (runEmbedding).

## Summary

* Dataset (M4): 4 synthetic chats (2 EN, 2 KO), 640 to 900 messages each (3,100 messages), 160 questions (40 per chat, 6 categories). Location: `C:\Users\yor42\AppData\Local\Temp\risu-b715\ltm\m2\dataset\` with a README that documents the schema. Regenerate with `node gen\gen.mjs <outDir>`.
* All six local models load on Node (@huggingface/transformers 3.8.1, onnxruntime-node 1.21.0, dtype q8, CPU) with the app's exact call shape: feature-extraction pipeline, mean pooling, normalize, no task prefix. None failed.
* English: BM25 alone is a strong baseline on this set (MRR 0.91). Only bge-m3 (0.92) and BGE-m3-ko (0.91) match it; MiniLM 0.81, nomic 0.82, bge-small-en 0.78, multilingual MiniLM 0.58.
* Korean: only the two bge-m3 family models are usable (MRR 0.80 bge-m3, 0.87 BGE-m3-ko; recall@5 91% and 93%). The three English-only models are at chance (MRR 0.01 to 0.03). multilingual MiniLM is weak (MRR 0.26, recall@5 34%). BM25 with character bigrams matches the best embedding on this set (0.90); whitespace-word BM25 does not (0.62).
* Hybrid (BM25 + embedding, RRF k=60): the gain over the best single retriever is small on original-wording questions (EN +0.01 and +0.02 MRR; KO -0.02 and -0.01 because BM25 alone is already the best single retriever; all intervals include 0) and grows to +0.08 to +0.17 over BM25 once questions are paraphrased, because BM25 loses 0.09 (EN) and 0.20 (KO) while the bge-m3 models lose 0 to 0.05. Hybrid with an embedding that cannot read the language is worse than BM25 alone.
* Knowledge update is the weak spot of every retriever: the latest value outranks the stale value in only 50% to 86% of cases; the two are usually both retrieved (top-10) but order is not recency.

## Refuted or weakened premises

* "Appending the last 2 chat messages to the query helps recall" is REFUTED on this set: every retriever collapses (BM25 MRR 0.91 to 0.02; bge-m3 0.92 to 0.09; best is MiniLM EN at 0.30). Caveat: the two context messages here are unrelated filler by construction (they come from the tail of the chat, which holds no facts). This is a worst-case dilution measurement; on-topic recent messages would do better and were not measured.
* "Hybrid always helps" is REFUTED: with MiniLM, bge-small-en or nomic on Korean text the hybrid scores MRR 0.28 to 0.37, far below BM25 alone at 0.90; with the bge-m3 family on original wording the gain is within noise.
* "multilingual MiniLM covers Korean" is mostly REFUTED: recall@5 34% at message level and 7% at 3-message windows.
* "Per-3-message windows are at least as good as per-message" is REFUTED for dense models at these message lengths (about 60 words EN, 180 characters KO): bge-m3 EN 0.92 to 0.75, KO 0.80 to 0.48 (mean pooling dilutes the one planted sentence). BGE-m3-ko and BM25 hold up. Recall at window level also has 3x fewer candidates.

## 1. Dataset (M4)

Files in `m2\dataset\`: `chat-en1.json` (820 msgs, fantasy road story), `chat-en2.json` (640, harbor-city detective), `chat-ko1.json` (740, sageuk-style fantasy), `chat-ko2.json` (900, modern harbor-town cafe drama), `README.md` (schema, construction, limits). Generator: `m2\gen\gen.mjs` with `content_en.mjs`, `content_ko.mjs`, `lib.mjs` (seeded PRNG: same seed gives byte-identical files; checked by running it twice).

* Message length: mean 60 words (EN, range 16 to 127) and 178 characters (KO, range 65 to 356); alternating user and character turns.
* Per chat, 40 questions: 8 single_fact, 7 knowledge_update (old value 130 to 380 messages before the new one; gold = latest, stale ids recorded), 6 temporal (4 date lookups, 2 "which came first" with two dated events in either chat order), 6 multi_message (two evidence messages 100 to 400 apart, joined by a person or place name), 7 invented_name (3 later have non-defining mentions of the term), 6 abstention (a fact type never stated for a character who appears in the chat). Each question also has a paraphrased wording (entity names kept, other words changed) and two context message ids for the "question plus last 2 messages" query.
* Distractors: about one message in eight (80 to 113 per chat) carries a decoy sentence with the same template as a real fact but another character or invented word. The answer string of 8 to 11 questions per chat also occurs in some non-gold message (README field `answer_in_other_messages`).
* Korean: written as natural spoken and narrative Korean (반말 dialogue, 해라체 narration) with a final-consonant check for 은/는, 이/가, 을/를, 와/과, 로/으로, 이라. Not translated from English.
* Authoring limits seen on inspection: (a) fact templates share a pre-modern flavour (ships, inns, caravans, ranks) even in the modern chats en2 and ko2, where only the filler places and objects are modern; (b) filler sentences repeat with different slot values; (c) filler never names a character, so character names and invented words are near-unique keys, which favours BM25 (see section 5).

## 2. Method

* Environment: Node v24.19.0 on Windows 11, 13th Gen Intel Core i9-13900KF (24 logical cores), 63.8 GB RAM. All numbers are best-case hardware; the target is a Note 9. Models downloaded only from huggingface.co (cache in `m2\cache`); the app's own model host was not contacted.
* Embedding call (mirrors `runEmbeddingUntracked`): `pipeline('feature-extraction', model, {dtype:'q8'})`, `pooling:'mean', normalize:true`, no prefix, batches of 50 (the app's `embedDocuments` chunk). Models: MiniLM = Xenova/all-MiniLM-L6-v2, bgeSmallEn = Xenova/bge-small-en-v1.5, nomic = nomic-ai/nomic-embed-text-v1.5, multiMiniLM = Xenova/paraphrase-multilingual-MiniLM-L12-v2, bgem3 = Xenova/bge-m3, bgeM3Ko = HyperBlaze/BGE-m3-ko. Difference from the app: Node CPU (onnxruntime-node), not wasm or webgpu; same q8 weights. Tokenizer limits: 512 tokens (MiniLM, bge-small, multiMiniLM), 8,192 (nomic, bge-m3), 1,024 (BGE-m3-ko); per-message texts and English windows stay under these limits; Korean 3-message windows exceed 512 tokens under the English WordPiece vocabularies (about 214 tokens per message) and are truncated for MiniLM and bge-small, which is irrelevant because those models already fail on Korean.
* Indexes: per message (one document per message), and per 3-message window (non-overlapping, ids 3k to 3k+2). A window is a hit if it contains a gold message. Cosine similarity over normalised vectors (exact, no ANN).
* BM25: own implementation (Okapi, k1=1.2, b=0.75, idf = ln(1 + (N-df+0.5)/(df+0.5))). Tokenisation: lowercase, split on non-letters/digits. Latin tokens: small English stopword list, strip "'s" and a trailing "s" (no other stemming). Hangul tokens: character bigrams inside each whitespace-delimited word (single-character words kept as unigrams), so particles such as 은/는/이/가 only change the last bigram. Variant "BM25 (whitespace words)": same but Hangul words kept whole (no bigrams); it shows what the bigrams buy. No morphological analyser was used.
* Hybrid: reciprocal rank fusion, score = 1/(60 + rank_emb) + 1/(60 + rank_bm25), equal weight; BM25 contributes only for documents with a positive BM25 score. BM25 in the hybrid is the bigram variant.
* Query settings: `q` = the question text; `qctx` = the two context messages joined by newline, then the question. Wording: `orig` (author-written question) and `para` (paraphrase variant, all 160 questions).
* Metrics (answerable questions only: 34 per chat, 68 per language): recall@1/5/10 = any gold message in the top k; MRR = 1/rank of the best gold. Multi-message additionally "both gold in top-k". Knowledge update: latest-value message ranked above the stale-value message. Abstention: AUC of the top-1 score (answerable vs abstain). Small n: per-language totals n=68; per category n=12 to 16, so differences under about 0.1 to 0.15 are noise (a 95% bootstrap interval is given for the hybrid gain).
* Extra runs outside the brief: CLS pooling for bgeSmallEn, bgem3, bgeM3Ko (the sentence-transformers configs of BAAI/bge-m3 and BAAI/bge-small-en-v1.5 on huggingface.co set CLS pooling, while the app uses mean; HyperBlaze/BGE-m3-ko has no pooling config file, so its intended pooling is unknown here); nomic with its documented task prefixes (`search_document: `, `search_query: `), which the app does not add.

## 3. Results (default app-faithful settings unless stated)

### T1. Overall retrieval, per-message index, query = question, original wording (answerable questions only)

Cells: R@1 / R@5 / R@10 in percent, MRR as 0-1. n = 68 answerable questions per language.

| Retriever | EN R@1 | EN R@5 | EN R@10 | EN MRR | KO R@1 | KO R@5 | KO R@10 | KO MRR |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| BM25 (bigram) | 85 | 97 | 99 | 0.91 | 84 | 99 | 99 | 0.90 |
| BM25 (whitespace words) | 85 | 97 | 99 | 0.91 | 56 | 69 | 71 | 0.62 |
| MiniLM | 72 | 91 | 93 | 0.81 | 0 | 0 | 1 | 0.01 |
| bgeSmallEn | 69 | 91 | 91 | 0.78 | 1 | 3 | 6 | 0.03 |
| nomic | 75 | 88 | 91 | 0.82 | 0 | 1 | 1 | 0.01 |
| multiMiniLM | 47 | 72 | 76 | 0.58 | 18 | 34 | 38 | 0.26 |
| bgem3 | 85 | 99 | 99 | 0.92 | 71 | 91 | 91 | 0.80 |
| bgeM3Ko | 84 | 100 | 100 | 0.91 | 82 | 93 | 93 | 0.87 |
| MiniLM + BM25 (RRF) | 82 | 96 | 99 | 0.89 | 16 | 37 | 56 | 0.28 |
| bgeSmallEn + BM25 (RRF) | 85 | 97 | 99 | 0.91 | 22 | 46 | 71 | 0.37 |
| nomic + BM25 (RRF) | 85 | 96 | 97 | 0.89 | 12 | 51 | 71 | 0.31 |
| multiMiniLM + BM25 (RRF) | 74 | 93 | 97 | 0.82 | 49 | 75 | 94 | 0.61 |
| bgem3 + BM25 (RRF) | 88 | 99 | 99 | 0.93 | 82 | 94 | 96 | 0.88 |
| bgeM3Ko + BM25 (RRF) | 88 | 99 | 99 | 0.93 | 82 | 94 | 97 | 0.89 |

### T2-r5. Recall@5 (percent) by category, per-message index, query = question, original wording

**EN** (n per category: single_fact=16, knowledge_update=14, temporal=12, multi_message=12, invented_name=14)

| Retriever | single_fact | knowledge_update | temporal | multi_message | invented_name | all |
|---|---:|---:|---:|---:|---:|---:|
| BM25 (bigram) | 100 | 86 | 100 | 100 | 100 | 97 |
| BM25 (whitespace words) | 100 | 86 | 100 | 100 | 100 | 97 |
| MiniLM | 100 | 64 | 100 | 92 | 100 | 91 |
| bgeSmallEn | 88 | 79 | 100 | 92 | 100 | 91 |
| nomic | 81 | 64 | 100 | 100 | 100 | 88 |
| multiMiniLM | 69 | 57 | 92 | 67 | 79 | 72 |
| bgem3 | 100 | 93 | 100 | 100 | 100 | 99 |
| bgeM3Ko | 100 | 100 | 100 | 100 | 100 | 100 |
| MiniLM + BM25 (RRF) | 100 | 86 | 100 | 92 | 100 | 96 |
| bgeSmallEn + BM25 (RRF) | 100 | 86 | 100 | 100 | 100 | 97 |
| nomic + BM25 (RRF) | 94 | 86 | 100 | 100 | 100 | 96 |
| multiMiniLM + BM25 (RRF) | 88 | 86 | 92 | 100 | 100 | 93 |
| bgem3 + BM25 (RRF) | 100 | 93 | 100 | 100 | 100 | 99 |
| bgeM3Ko + BM25 (RRF) | 100 | 93 | 100 | 100 | 100 | 99 |

**KO** (n per category: single_fact=16, knowledge_update=14, temporal=12, multi_message=12, invented_name=14)

| Retriever | single_fact | knowledge_update | temporal | multi_message | invented_name | all |
|---|---:|---:|---:|---:|---:|---:|
| BM25 (bigram) | 100 | 93 | 100 | 100 | 100 | 99 |
| BM25 (whitespace words) | 50 | 79 | 75 | 67 | 79 | 69 |
| MiniLM | 0 | 0 | 0 | 0 | 0 | 0 |
| bgeSmallEn | 13 | 0 | 0 | 0 | 0 | 3 |
| nomic | 6 | 0 | 0 | 0 | 0 | 1 |
| multiMiniLM | 31 | 29 | 42 | 58 | 14 | 34 |
| bgem3 | 81 | 79 | 100 | 100 | 100 | 91 |
| bgeM3Ko | 81 | 86 | 100 | 100 | 100 | 93 |
| MiniLM + BM25 (RRF) | 31 | 29 | 33 | 58 | 36 | 37 |
| bgeSmallEn + BM25 (RRF) | 38 | 43 | 42 | 50 | 57 | 46 |
| nomic + BM25 (RRF) | 50 | 57 | 42 | 58 | 50 | 51 |
| multiMiniLM + BM25 (RRF) | 56 | 71 | 92 | 83 | 79 | 75 |
| bgem3 + BM25 (RRF) | 88 | 86 | 100 | 100 | 100 | 94 |
| bgeM3Ko + BM25 (RRF) | 88 | 86 | 100 | 100 | 100 | 94 |

### T2-mrr. MRR (0-1) by category, per-message index, query = question, original wording

**EN** (n per category: single_fact=16, knowledge_update=14, temporal=12, multi_message=12, invented_name=14)

| Retriever | single_fact | knowledge_update | temporal | multi_message | invented_name | all |
|---|---:|---:|---:|---:|---:|---:|
| BM25 (bigram) | 0.94 | 0.71 | 0.94 | 1.00 | 0.96 | 0.91 |
| BM25 (whitespace words) | 0.94 | 0.71 | 0.94 | 1.00 | 0.96 | 0.91 |
| MiniLM | 0.81 | 0.45 | 1.00 | 0.79 | 1.00 | 0.81 |
| bgeSmallEn | 0.72 | 0.51 | 0.96 | 0.72 | 1.00 | 0.78 |
| nomic | 0.76 | 0.51 | 1.00 | 0.84 | 1.00 | 0.82 |
| multiMiniLM | 0.60 | 0.38 | 0.70 | 0.53 | 0.68 | 0.58 |
| bgem3 | 0.90 | 0.86 | 1.00 | 0.92 | 0.93 | 0.92 |
| bgeM3Ko | 0.94 | 0.81 | 1.00 | 0.86 | 0.96 | 0.91 |
| MiniLM + BM25 (RRF) | 0.97 | 0.62 | 1.00 | 0.88 | 1.00 | 0.89 |
| bgeSmallEn + BM25 (RRF) | 0.97 | 0.64 | 1.00 | 0.94 | 1.00 | 0.91 |
| nomic + BM25 (RRF) | 0.90 | 0.59 | 1.00 | 1.00 | 1.00 | 0.89 |
| multiMiniLM + BM25 (RRF) | 0.75 | 0.64 | 0.92 | 0.82 | 1.00 | 0.82 |
| bgem3 + BM25 (RRF) | 0.94 | 0.73 | 1.00 | 1.00 | 1.00 | 0.93 |
| bgeM3Ko + BM25 (RRF) | 0.97 | 0.74 | 1.00 | 0.96 | 1.00 | 0.93 |

**KO** (n per category: single_fact=16, knowledge_update=14, temporal=12, multi_message=12, invented_name=14)

| Retriever | single_fact | knowledge_update | temporal | multi_message | invented_name | all |
|---|---:|---:|---:|---:|---:|---:|
| BM25 (bigram) | 0.89 | 0.77 | 0.96 | 0.90 | 1.00 | 0.90 |
| BM25 (whitespace words) | 0.39 | 0.64 | 0.71 | 0.67 | 0.74 | 0.62 |
| MiniLM | 0.00 | 0.00 | 0.00 | 0.02 | 0.00 | 0.01 |
| bgeSmallEn | 0.10 | 0.01 | 0.01 | 0.02 | 0.01 | 0.03 |
| nomic | 0.03 | 0.00 | 0.00 | 0.01 | 0.01 | 0.01 |
| multiMiniLM | 0.28 | 0.22 | 0.33 | 0.43 | 0.07 | 0.26 |
| bgem3 | 0.56 | 0.69 | 1.00 | 0.92 | 0.93 | 0.80 |
| bgeM3Ko | 0.77 | 0.75 | 0.93 | 0.94 | 0.96 | 0.87 |
| MiniLM + BM25 (RRF) | 0.19 | 0.25 | 0.30 | 0.41 | 0.30 | 0.28 |
| bgeSmallEn + BM25 (RRF) | 0.37 | 0.27 | 0.33 | 0.45 | 0.45 | 0.37 |
| nomic + BM25 (RRF) | 0.28 | 0.33 | 0.29 | 0.33 | 0.30 | 0.31 |
| multiMiniLM + BM25 (RRF) | 0.50 | 0.58 | 0.83 | 0.82 | 0.42 | 0.61 |
| bgem3 + BM25 (RRF) | 0.81 | 0.69 | 1.00 | 0.92 | 1.00 | 0.88 |
| bgeM3Ko + BM25 (RRF) | 0.82 | 0.68 | 1.00 | 0.96 | 1.00 | 0.89 |

### Setting comparison

### T3. MRR under each setting (granularity / query / wording)

**EN**

| Retriever | msg/q/orig | msg/q/para | msg/qctx/orig | msg/qctx/para | win/q/orig | win/q/para | win/qctx/orig | win/qctx/para |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| BM25 (bigram) | 0.91 | 0.82 | 0.02 | 0.03 | 0.91 | 0.84 | 0.09 | 0.09 |
| BM25 (whitespace words) | 0.91 | 0.82 | 0.02 | 0.03 | 0.91 | 0.84 | 0.09 | 0.09 |
| MiniLM | 0.81 | 0.74 | 0.30 | 0.19 | 0.65 | 0.60 | 0.21 | 0.17 |
| bgeSmallEn | 0.78 | 0.71 | 0.08 | 0.07 | 0.57 | 0.54 | 0.11 | 0.11 |
| nomic | 0.82 | 0.77 | 0.09 | 0.09 | 0.65 | 0.56 | 0.16 | 0.10 |
| multiMiniLM | 0.58 | 0.56 | 0.02 | 0.03 | 0.11 | 0.09 | 0.03 | 0.03 |
| bgem3 | 0.92 | 0.90 | 0.09 | 0.09 | 0.75 | 0.70 | 0.16 | 0.11 |
| bgeM3Ko | 0.91 | 0.91 | 0.04 | 0.07 | 0.89 | 0.91 | 0.13 | 0.13 |
| MiniLM + BM25 (RRF) | 0.89 | 0.84 | 0.06 | 0.05 | 0.85 | 0.81 | 0.12 | 0.11 |
| bgeSmallEn + BM25 (RRF) | 0.91 | 0.84 | 0.04 | 0.04 | 0.83 | 0.77 | 0.10 | 0.10 |
| nomic + BM25 (RRF) | 0.89 | 0.86 | 0.05 | 0.04 | 0.87 | 0.80 | 0.13 | 0.12 |
| multiMiniLM + BM25 (RRF) | 0.82 | 0.80 | 0.02 | 0.02 | 0.53 | 0.47 | 0.06 | 0.06 |
| bgem3 + BM25 (RRF) | 0.93 | 0.90 | 0.04 | 0.04 | 0.89 | 0.88 | 0.13 | 0.11 |
| bgeM3Ko + BM25 (RRF) | 0.93 | 0.93 | 0.03 | 0.04 | 0.91 | 0.91 | 0.10 | 0.11 |

**KO**

| Retriever | msg/q/orig | msg/q/para | msg/qctx/orig | msg/qctx/para | win/q/orig | win/q/para | win/qctx/orig | win/qctx/para |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| BM25 (bigram) | 0.90 | 0.70 | 0.02 | 0.01 | 0.89 | 0.71 | 0.09 | 0.06 |
| BM25 (whitespace words) | 0.62 | 0.43 | 0.01 | 0.01 | 0.62 | 0.45 | 0.05 | 0.03 |
| MiniLM | 0.01 | 0.01 | 0.03 | 0.02 | 0.02 | 0.04 | 0.02 | 0.02 |
| bgeSmallEn | 0.03 | 0.02 | 0.03 | 0.04 | 0.04 | 0.04 | 0.02 | 0.02 |
| nomic | 0.01 | 0.01 | 0.01 | 0.01 | 0.05 | 0.03 | 0.02 | 0.02 |
| multiMiniLM | 0.26 | 0.30 | 0.03 | 0.05 | 0.07 | 0.05 | 0.04 | 0.04 |
| bgem3 | 0.80 | 0.80 | 0.04 | 0.03 | 0.48 | 0.45 | 0.06 | 0.06 |
| bgeM3Ko | 0.87 | 0.82 | 0.02 | 0.03 | 0.79 | 0.73 | 0.07 | 0.08 |
| MiniLM + BM25 (RRF) | 0.28 | 0.21 | 0.04 | 0.03 | 0.31 | 0.22 | 0.04 | 0.04 |
| bgeSmallEn + BM25 (RRF) | 0.37 | 0.28 | 0.04 | 0.03 | 0.39 | 0.22 | 0.06 | 0.05 |
| nomic + BM25 (RRF) | 0.31 | 0.25 | 0.01 | 0.01 | 0.41 | 0.26 | 0.03 | 0.04 |
| multiMiniLM + BM25 (RRF) | 0.61 | 0.60 | 0.04 | 0.02 | 0.39 | 0.31 | 0.04 | 0.04 |
| bgem3 + BM25 (RRF) | 0.88 | 0.87 | 0.02 | 0.02 | 0.71 | 0.66 | 0.07 | 0.04 |
| bgeM3Ko + BM25 (RRF) | 0.89 | 0.86 | 0.02 | 0.02 | 0.87 | 0.84 | 0.08 | 0.07 |

### T3b. Recall@5 (percent) under each setting

**EN**

| Retriever | msg/q/orig | msg/q/para | msg/qctx/orig | msg/qctx/para | win/q/orig | win/q/para | win/qctx/orig | win/qctx/para |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| BM25 (bigram) | 97 | 97 | 1 | 3 | 97 | 96 | 13 | 16 |
| BM25 (whitespace words) | 97 | 97 | 1 | 3 | 97 | 96 | 13 | 16 |
| MiniLM | 91 | 84 | 35 | 22 | 74 | 71 | 32 | 26 |
| bgeSmallEn | 91 | 87 | 10 | 13 | 71 | 62 | 15 | 18 |
| nomic | 88 | 85 | 15 | 10 | 79 | 72 | 25 | 16 |
| multiMiniLM | 72 | 72 | 1 | 1 | 15 | 15 | 3 | 3 |
| bgem3 | 99 | 99 | 15 | 16 | 85 | 81 | 26 | 18 |
| bgeM3Ko | 100 | 100 | 6 | 12 | 99 | 97 | 19 | 22 |
| MiniLM + BM25 (RRF) | 96 | 94 | 10 | 7 | 94 | 90 | 26 | 18 |
| bgeSmallEn + BM25 (RRF) | 97 | 96 | 7 | 7 | 99 | 88 | 19 | 15 |
| nomic + BM25 (RRF) | 96 | 94 | 6 | 6 | 94 | 94 | 22 | 19 |
| multiMiniLM + BM25 (RRF) | 93 | 90 | 1 | 1 | 75 | 66 | 6 | 9 |
| bgem3 + BM25 (RRF) | 99 | 99 | 6 | 6 | 99 | 97 | 18 | 15 |
| bgeM3Ko + BM25 (RRF) | 99 | 99 | 4 | 4 | 99 | 99 | 13 | 15 |

**KO**

| Retriever | msg/q/orig | msg/q/para | msg/qctx/orig | msg/qctx/para | win/q/orig | win/q/para | win/qctx/orig | win/qctx/para |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| BM25 (bigram) | 99 | 85 | 1 | 1 | 99 | 87 | 10 | 9 |
| BM25 (whitespace words) | 69 | 53 | 0 | 0 | 72 | 53 | 6 | 4 |
| MiniLM | 0 | 0 | 3 | 1 | 1 | 3 | 1 | 1 |
| bgeSmallEn | 3 | 1 | 4 | 4 | 4 | 4 | 1 | 1 |
| nomic | 1 | 0 | 0 | 1 | 7 | 3 | 1 | 3 |
| multiMiniLM | 34 | 38 | 3 | 4 | 7 | 7 | 4 | 4 |
| bgem3 | 91 | 91 | 6 | 4 | 62 | 57 | 4 | 4 |
| bgeM3Ko | 93 | 93 | 1 | 3 | 91 | 87 | 10 | 10 |
| MiniLM + BM25 (RRF) | 37 | 32 | 4 | 4 | 49 | 31 | 3 | 3 |
| bgeSmallEn + BM25 (RRF) | 46 | 34 | 3 | 4 | 53 | 34 | 6 | 4 |
| nomic + BM25 (RRF) | 51 | 32 | 0 | 0 | 60 | 40 | 1 | 6 |
| multiMiniLM + BM25 (RRF) | 75 | 74 | 4 | 1 | 51 | 43 | 4 | 4 |
| bgem3 + BM25 (RRF) | 94 | 93 | 0 | 0 | 79 | 79 | 9 | 4 |
| bgeM3Ko + BM25 (RRF) | 94 | 94 | 0 | 0 | 96 | 91 | 10 | 10 |

### Knowledge update, multi-message and abstention

### T4. Knowledge update: latest value ranked above the stale value (per-message index, original wording)

Cell: count of questions where the latest-value message outranks the stale-value message / total; L@1 = latest value ranked first, S@1 = stale value ranked first.

| Retriever | q EN | q KO | q+ctx EN | q+ctx KO |
|---|---:|---:|---:|---:|
| BM25 (bigram) | 8/14 (L@1 8, S@1 4) | 10/14 (L@1 9, S@1 2) | 11/14 (L@1 0, S@1 0) | 7/14 (L@1 0, S@1 0) |
| BM25 (whitespace words) | 8/14 (L@1 8, S@1 4) | 7/14 (L@1 7, S@1 4) | 11/14 (L@1 0, S@1 0) | 8/14 (L@1 0, S@1 0) |
| MiniLM | 7/14 (L@1 4, S@1 3) | 8/14 (L@1 0, S@1 0) | 8/14 (L@1 3, S@1 2) | 5/14 (L@1 0, S@1 0) |
| bgeSmallEn | 7/14 (L@1 5, S@1 4) | 7/14 (L@1 0, S@1 0) | 8/14 (L@1 1, S@1 0) | 6/14 (L@1 0, S@1 0) |
| nomic | 7/14 (L@1 5, S@1 4) | 6/14 (L@1 0, S@1 1) | 7/14 (L@1 1, S@1 0) | 4/14 (L@1 0, S@1 0) |
| multiMiniLM | 9/14 (L@1 3, S@1 2) | 8/14 (L@1 2, S@1 3) | 9/14 (L@1 0, S@1 1) | 10/14 (L@1 0, S@1 0) |
| bgem3 | 12/14 (L@1 11, S@1 2) | 9/14 (L@1 8, S@1 2) | 8/14 (L@1 0, S@1 0) | 8/14 (L@1 0, S@1 0) |
| bgeM3Ko | 10/14 (L@1 9, S@1 4) | 9/14 (L@1 9, S@1 4) | 7/14 (L@1 0, S@1 0) | 8/14 (L@1 0, S@1 0) |
| MiniLM + BM25 (RRF) | 7/14 (L@1 5, S@1 6) | 9/14 (L@1 2, S@1 1) | 9/14 (L@1 0, S@1 0) | 6/14 (L@1 0, S@1 0) |
| bgeSmallEn + BM25 (RRF) | 6/14 (L@1 6, S@1 7) | 5/14 (L@1 1, S@1 2) | 9/14 (L@1 0, S@1 0) | 6/14 (L@1 0, S@1 0) |
| nomic + BM25 (RRF) | 7/14 (L@1 6, S@1 6) | 7/14 (L@1 2, S@1 4) | 8/14 (L@1 0, S@1 0) | 4/14 (L@1 0, S@1 0) |
| multiMiniLM + BM25 (RRF) | 9/14 (L@1 7, S@1 4) | 8/14 (L@1 6, S@1 4) | 10/14 (L@1 0, S@1 0) | 7/14 (L@1 0, S@1 0) |
| bgem3 + BM25 (RRF) | 8/14 (L@1 8, S@1 5) | 10/14 (L@1 8, S@1 3) | 9/14 (L@1 0, S@1 0) | 6/14 (L@1 0, S@1 0) |
| bgeM3Ko + BM25 (RRF) | 8/14 (L@1 8, S@1 5) | 9/14 (L@1 7, S@1 4) | 9/14 (L@1 0, S@1 0) | 8/14 (L@1 0, S@1 0) |

### T4b. Knowledge update: both the latest and the stale message inside top-10 (per-message index, original wording)

Columns per language: both in top-10, latest in top-5.

| Retriever | EN both@10 | EN latest@5 | KO both@10 | KO latest@5 |
|---|---:|---:|---:|---:|
| BM25 (bigram) | 12/14 | 12/14 | 10/14 | 13/14 |
| BM25 (whitespace words) | 12/14 | 12/14 | 8/14 | 11/14 |
| MiniLM | 8/14 | 9/14 | 0/14 | 0/14 |
| bgeSmallEn | 10/14 | 11/14 | 0/14 | 0/14 |
| nomic | 8/14 | 9/14 | 0/14 | 0/14 |
| multiMiniLM | 5/14 | 8/14 | 2/14 | 4/14 |
| bgem3 | 11/14 | 13/14 | 10/14 | 11/14 |
| bgeM3Ko | 13/14 | 14/14 | 11/14 | 12/14 |
| MiniLM + BM25 (RRF) | 13/14 | 12/14 | 4/14 | 4/14 |
| bgeSmallEn + BM25 (RRF) | 13/14 | 12/14 | 6/14 | 6/14 |
| nomic + BM25 (RRF) | 12/14 | 12/14 | 9/14 | 8/14 |
| multiMiniLM + BM25 (RRF) | 12/14 | 12/14 | 10/14 | 10/14 |
| bgem3 + BM25 (RRF) | 13/14 | 13/14 | 12/14 | 12/14 |
| bgeM3Ko + BM25 (RRF) | 13/14 | 13/14 | 12/14 | 12/14 |

### T5. Multi-message: both gold messages inside top-k (per-message index, query = question, original wording)

Columns: both gold in top-10, both in top-20, at least one in top-10.

| Retriever | EN both@10 | EN both@20 | EN any@10 | KO both@10 | KO both@20 | KO any@10 |
|---|---:|---:|---:|---:|---:|---:|
| BM25 (bigram) | 6/12 | 6/12 | 12/12 | 10/12 | 10/12 | 12/12 |
| BM25 (whitespace words) | 6/12 | 6/12 | 12/12 | 4/12 | 4/12 | 8/12 |
| MiniLM | 4/12 | 5/12 | 11/12 | 0/12 | 0/12 | 1/12 |
| bgeSmallEn | 5/12 | 7/12 | 11/12 | 0/12 | 0/12 | 1/12 |
| nomic | 6/12 | 8/12 | 12/12 | 0/12 | 0/12 | 0/12 |
| multiMiniLM | 4/12 | 4/12 | 8/12 | 1/12 | 2/12 | 7/12 |
| bgem3 | 8/12 | 9/12 | 12/12 | 8/12 | 11/12 | 12/12 |
| bgeM3Ko | 6/12 | 7/12 | 12/12 | 9/12 | 10/12 | 12/12 |
| MiniLM + BM25 (RRF) | 6/12 | 7/12 | 12/12 | 7/12 | 10/12 | 11/12 |
| bgeSmallEn + BM25 (RRF) | 7/12 | 8/12 | 12/12 | 4/12 | 8/12 | 10/12 |
| nomic + BM25 (RRF) | 7/12 | 8/12 | 12/12 | 6/12 | 8/12 | 9/12 |
| multiMiniLM + BM25 (RRF) | 7/12 | 9/12 | 12/12 | 9/12 | 10/12 | 12/12 |
| bgem3 + BM25 (RRF) | 8/12 | 9/12 | 12/12 | 10/12 | 11/12 | 12/12 |
| bgeM3Ko + BM25 (RRF) | 6/12 | 6/12 | 12/12 | 10/12 | 11/12 | 12/12 |

### T6. Abstention signal: top-1 score of answerable vs abstention questions (per-message index, query = question, original wording)

For BM25 the score is the raw BM25 sum (not bounded); for embeddings it is the top cosine. AUC = chance that an answerable question has a higher top-1 score than an abstention question (0.5 = no signal). n_answerable=68, n_abstain=12 per language.

| Retriever | EN mean(answerable) | EN mean(abstain) | EN AUC | KO mean(answerable) | KO mean(abstain) | KO AUC |
|---|---:|---:|---:|---:|---:|---:|
| BM25 (bigram) | 11.80 | 8.56 | 0.69 | 18.49 | 13.97 | 0.67 |
| MiniLM | 0.47 | 0.42 | 0.65 | 0.76 | 0.80 | 0.30 |
| bgeSmallEn | 0.59 | 0.56 | 0.68 | 0.82 | 0.84 | 0.27 |
| nomic | 0.63 | 0.61 | 0.63 | 0.84 | 0.86 | 0.27 |
| multiMiniLM | 0.43 | 0.45 | 0.46 | 0.51 | 0.49 | 0.53 |
| bgem3 | 0.75 | 0.74 | 0.70 | 0.75 | 0.74 | 0.62 |
| bgeM3Ko | 0.77 | 0.75 | 0.68 | 0.77 | 0.75 | 0.66 |

### Hybrid gain

### T7-orig. Hybrid gain: paired MRR difference with 95% bootstrap CI over questions (per-message index, query = question, orig wording)

| Model | Lang | MRR emb | MRR BM25 | MRR hybrid | hybrid - emb [95% CI] | hybrid - BM25 [95% CI] |
|---|---:|---:|---:|---:|---:|---:|
| MiniLM | EN | 0.81 | 0.91 | 0.89 | +0.09 [0.04, 0.13] | -0.01 [-0.07, 0.04] |
| MiniLM | KO | 0.01 | 0.90 | 0.28 | +0.28 [0.20, 0.36] | -0.62 [-0.70, -0.53] |
| bgeSmallEn | EN | 0.78 | 0.91 | 0.91 | +0.13 [0.07, 0.20] | +0.00 [-0.04, 0.04] |
| bgeSmallEn | KO | 0.03 | 0.90 | 0.37 | +0.34 [0.26, 0.42] | -0.53 [-0.63, -0.43] |
| nomic | EN | 0.82 | 0.91 | 0.89 | +0.08 [0.03, 0.13] | -0.02 [-0.07, 0.04] |
| nomic | KO | 0.01 | 0.90 | 0.31 | +0.30 [0.23, 0.37] | -0.59 [-0.68, -0.51] |
| multiMiniLM | EN | 0.58 | 0.91 | 0.82 | +0.25 [0.17, 0.33] | -0.09 [-0.16, -0.01] |
| multiMiniLM | KO | 0.26 | 0.90 | 0.61 | +0.35 [0.28, 0.44] | -0.29 [-0.38, -0.20] |
| bgem3 | EN | 0.92 | 0.91 | 0.93 | +0.01 [-0.03, 0.06] | +0.02 [-0.01, 0.06] |
| bgem3 | KO | 0.80 | 0.90 | 0.88 | +0.07 [0.02, 0.12] | -0.02 [-0.06, 0.01] |
| bgeM3Ko | EN | 0.91 | 0.91 | 0.93 | +0.02 [-0.02, 0.06] | +0.02 [-0.01, 0.06] |
| bgeM3Ko | KO | 0.87 | 0.90 | 0.89 | +0.02 [-0.02, 0.07] | -0.02 [-0.06, 0.02] |

### T7-para. Hybrid gain: paired MRR difference with 95% bootstrap CI over questions (per-message index, query = question, para wording)

| Model | Lang | MRR emb | MRR BM25 | MRR hybrid | hybrid - emb [95% CI] | hybrid - BM25 [95% CI] |
|---|---:|---:|---:|---:|---:|---:|
| MiniLM | EN | 0.74 | 0.82 | 0.84 | +0.10 [0.05, 0.15] | +0.02 [-0.06, 0.10] |
| MiniLM | KO | 0.01 | 0.70 | 0.21 | +0.21 [0.15, 0.28] | -0.49 [-0.58, -0.39] |
| bgeSmallEn | EN | 0.71 | 0.82 | 0.84 | +0.13 [0.07, 0.20] | +0.02 [-0.05, 0.10] |
| bgeSmallEn | KO | 0.02 | 0.70 | 0.28 | +0.26 [0.19, 0.34] | -0.42 [-0.53, -0.31] |
| nomic | EN | 0.77 | 0.82 | 0.86 | +0.08 [0.04, 0.14] | +0.04 [-0.03, 0.11] |
| nomic | KO | 0.01 | 0.70 | 0.25 | +0.24 [0.18, 0.30] | -0.46 [-0.54, -0.37] |
| multiMiniLM | EN | 0.56 | 0.82 | 0.80 | +0.24 [0.17, 0.31] | -0.02 [-0.10, 0.06] |
| multiMiniLM | KO | 0.30 | 0.70 | 0.60 | +0.31 [0.23, 0.39] | -0.10 [-0.20, 0.00] |
| bgem3 | EN | 0.90 | 0.82 | 0.90 | +0.01 [-0.04, 0.06] | +0.08 [0.03, 0.14] |
| bgem3 | KO | 0.80 | 0.70 | 0.87 | +0.07 [0.01, 0.12] | +0.17 [0.10, 0.23] |
| bgeM3Ko | EN | 0.91 | 0.82 | 0.93 | +0.02 [-0.04, 0.07] | +0.11 [0.05, 0.17] |
| bgeM3Ko | KO | 0.82 | 0.70 | 0.86 | +0.04 [-0.01, 0.09] | +0.16 [0.10, 0.23] |

## 4. Cost on this PC

Clean timing pass (`bench.mjs`: 100 consecutive messages per language, batch 50, 3 repetitions, minimum shown; machine otherwise shared with unrelated background processes; repetitions within a configuration agree within about 10% except Korean MiniLM at default threads. Unexplained: default threads are not faster than 1 thread for bgeSmallEn, nomic, bgem3 and bgeM3Ko in this Node build, so the thread columns say little about core scaling; an earlier uncontrolled pass gave different numbers (bench.json), which is why the repeated pass is used). "1 thr." = onnxruntime intra-op threads set to 1, a rough proxy for a slow core, not a Note 9 measurement. Index time for a whole chat is roughly ms/msg times message count. Vector memory is the raw float32 size; the app's storage format overhead was not measured.

| Model | dim | float32 per vector | float32 per 1,000 msgs | q8 ONNX file | load | EN ms/msg default thr. | EN ms/msg 1 thr. | KO ms/msg default thr. | KO ms/msg 1 thr. | mean tokens EN / KO |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| MiniLM | 384 | 1.5 KB | 1.5 MB | 22 MB | 0.1 s | 4.5 | 18.2 | 17.3 | 37 | 77 / 214 |
| bgeSmallEn | 384 | 1.5 KB | 1.5 MB | 32 MB | 0.2 s | 46.3 | 37.1 | 82.8 | 67.3 | 77 / 214 |
| nomic | 768 | 3.0 KB | 2.9 MB | 131 MB | 0.4 s | 102.5 | 89.3 | 182.4 | 169.4 | 77 / 214 |
| multiMiniLM | 384 | 1.5 KB | 1.5 MB | 113 MB | 0.7 s | 36.3 | 70.6 | 38.4 | 71.4 | 88 / 109 |
| bgem3 | 1024 | 4.0 KB | 3.9 MB | 543 MB | 1.2 s | 181 | 179.2 | 180.9 | 187.9 | 88 / 109 |
| bgeM3Ko | 1024 | 4.0 KB | 3.9 MB | 543 MB | 1.1 s | 165.9 | 178.5 | 178.6 | 189.8 | 88 / 109 |

Full chat indexing as actually run (3 to 4 model processes in parallel on the same PC, so these are inflated and shown only to give order of magnitude; peak RSS includes batch-50 padded activations and ONNX arena growth in Node and is not what a wasm or webgpu build would show):

| Model | EN chats as run (1,460 msgs), seconds | KO chats as run (1,640 msgs), seconds | peak RSS during the run |
|---|---:|---:|---:|
| MiniLM | 15 | 61 | 4282 MB |
| bgeSmallEn | 38 | 328 | 4269 MB |
| nomic | 424 | 1741 | 10655 MB |
| multiMiniLM | 264 | 252 | 3704 MB |
| bgem3 | 1537 | 1015 | 2904 MB |
| bgeM3Ko | 1504 | 991 | 4776 MB |

Extrapolation, not measurement: a Note 9 core is several times slower than one i9-13900KF core, and browser wasm adds more. bge-m3 at about 0.18 s per message here would plausibly be seconds per message on the phone, i.e. tens of minutes to index one 800-message chat; MiniLM-class models would be a fraction of a second per message. Treat this as a reason to measure on the device, not as a figure.

## 5. Findings

1. CONFIRMED (observation, with command evidence from `analyze.mjs`): Korean needs a multilingual model. MiniLM, bge-small-en and nomic score MRR 0.01 to 0.03 on Korean per-message retrieval, which is chance level for about 800 candidates. Usable for Korean: bgem3 (MRR 0.80, R@5 91%) and bgeM3Ko (0.87, R@5 93%); borderline: multiMiniLM (0.26, R@5 34%); its hybrid with BM25 (0.61) is better than itself but still below BM25 alone (0.90).
2. CONFIRMED: character-bigram BM25 is competitive with the best embeddings on this set (EN 0.91, KO 0.90) and costs nothing to index. Whitespace-word BM25 on Korean loses 0.28 MRR (0.90 to 0.62) because particles glue to the stem.
3. Lexical-overlap caveat (interpretation, supported by T9 and the paraphrase runs): the author-written questions reuse many words of the evidence sentence (68% of question tokens appear in the gold message in EN, 49% in KO bigrams), and a character name in the question is an almost unique key because filler never names anyone. That inflates BM25. With paraphrased wording the overlap falls to 40% and 28%, BM25 falls to MRR 0.82 (EN) and 0.70 (KO), and the bge-m3 models stay at 0.90 to 0.91 (EN) and 0.80 and 0.82 (KO). So the honest ranking for real chats, where users rarely quote the original text, favours the bge-m3 models and the hybrid over BM25 alone.
4. Hybrid gain size (T7): original wording, bge-m3 family, hybrid minus the best single retriever is +0.01 (bgem3) and +0.02 (bgeM3Ko) MRR in EN and -0.02 and -0.01 in KO (best single there is BM25 at 0.90; over the embedding alone it is +0.07 and +0.02); paraphrased wording, hybrid minus BM25 is +0.08 (bgem3 EN), +0.11 (bgeM3Ko EN), +0.17 and +0.16 (KO), CIs exclude 0; hybrid minus embedding stays within +0.01 to +0.07. The largest hybrid effect is on weak models in their own language (EN MiniLM, bge-small, nomic: +0.08 to +0.13 over the embedding alone, bringing them to BM25's level, not above it).
5. Knowledge update: the best latest-above-stale rate is 12/14 (bgem3 EN) and 13/14 (CLS bgem3 KO); most configurations sit at 6/14 to 10/14 (T4). Both versions are usually inside top-10 (bge-m3 family 10 to 13 of 14, T4b). Similarity ranking carries no recency; retrieving both and ordering by message position would be needed for the reader to choose, which this set cannot judge. Hybrid does not improve the order.
6. Multi-message: any gold in the top 10 is near 100% for BM25 and the bge-m3 family, but both evidence messages in the top 10 only 50% to 83% (T5); a second retrieval hop or larger k would be needed for full coverage.
7. Abstention: the top-1 score barely separates answerable from unanswerable questions (AUC 0.62 to 0.70 for BM25 and the useful models; T6). A fixed score threshold is not a reliable abstention test on this set.
8. Windows: dense models lose at 3-message windows (T3: bgem3 EN 0.92 to 0.75, KO 0.80 to 0.48; MiniLM 0.81 to 0.65; multiMiniLM 0.58 to 0.11) while BGE-m3-ko (0.91 to 0.89 EN, 0.87 to 0.79 KO) and BM25 hold; hybrid bgeM3Ko stays at 0.91 / 0.87. Windows reduce index size by 3x.
9. The query-with-recent-messages habit (qctx) is destructive when the recent messages are unrelated to the asked fact (T3, T3b). BM25 is hit hardest (query dominated by the context's high-frequency filler words); MiniLM suffers least. Not measured: on-topic context.
10. Extra A, pooling (UNCERTAIN as to cause, observed effect): with CLS pooling instead of the app's mean pooling, bgem3 goes from MRR 0.92 to 0.93 (EN) and 0.80 to 0.88 (KO), and its 3-message window MRR in KO from 0.48 to 0.74; bgeM3Ko from 0.91 to 0.94 (EN) and 0.87 to 0.94 (KO), KO R@1 82% to 93%. bgeSmallEn gets worse with CLS here (0.78 to 0.72 EN). The BGE-m3-ko author's pooling is not stated in the files that were available, so its gain is empirical only.

### CLS pooling runs: T1. Overall retrieval, per-message index, query = question, original wording (answerable questions only)

Cells: R@1 / R@5 / R@10 in percent, MRR as 0-1. n = 68 answerable questions per language.

| Retriever | EN R@1 | EN R@5 | EN R@10 | EN MRR | KO R@1 | KO R@5 | KO R@10 | KO MRR |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| BM25 (bigram) | 85 | 97 | 99 | 0.91 | 84 | 99 | 99 | 0.90 |
| BM25 (whitespace words) | 85 | 97 | 99 | 0.91 | 56 | 69 | 71 | 0.62 |
| bgeSmallEn | 62 | 87 | 90 | 0.72 | 1 | 3 | 6 | 0.03 |
| bgem3 | 88 | 99 | 99 | 0.93 | 82 | 93 | 96 | 0.88 |
| bgeM3Ko | 91 | 99 | 99 | 0.94 | 93 | 96 | 97 | 0.94 |
| bgeSmallEn + BM25 (RRF) | 79 | 97 | 99 | 0.88 | 21 | 49 | 66 | 0.35 |
| bgem3 + BM25 (RRF) | 88 | 97 | 99 | 0.93 | 87 | 99 | 99 | 0.91 |
| bgeM3Ko + BM25 (RRF) | 91 | 99 | 99 | 0.95 | 87 | 99 | 99 | 0.92 |

### CLS pooling runs: T3. MRR under each setting (granularity / query / wording)

**EN**

| Retriever | msg/q/orig | msg/q/para | msg/qctx/orig | msg/qctx/para | win/q/orig | win/q/para | win/qctx/orig | win/qctx/para |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| BM25 (bigram) | 0.91 | 0.82 | 0.02 | 0.03 | 0.91 | 0.84 | 0.09 | 0.09 |
| BM25 (whitespace words) | 0.91 | 0.82 | 0.02 | 0.03 | 0.91 | 0.84 | 0.09 | 0.09 |
| bgeSmallEn | 0.72 | 0.68 | 0.07 | 0.08 | 0.55 | 0.55 | 0.12 | 0.12 |
| bgem3 | 0.93 | 0.94 | 0.08 | 0.07 | 0.87 | 0.86 | 0.21 | 0.16 |
| bgeM3Ko | 0.94 | 0.96 | 0.04 | 0.05 | 0.91 | 0.94 | 0.16 | 0.16 |
| bgeSmallEn + BM25 (RRF) | 0.88 | 0.84 | 0.04 | 0.05 | 0.83 | 0.75 | 0.11 | 0.11 |
| bgem3 + BM25 (RRF) | 0.93 | 0.90 | 0.04 | 0.04 | 0.92 | 0.91 | 0.14 | 0.12 |
| bgeM3Ko + BM25 (RRF) | 0.95 | 0.92 | 0.03 | 0.03 | 0.92 | 0.93 | 0.11 | 0.11 |

**KO**

| Retriever | msg/q/orig | msg/q/para | msg/qctx/orig | msg/qctx/para | win/q/orig | win/q/para | win/qctx/orig | win/qctx/para |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| BM25 (bigram) | 0.90 | 0.70 | 0.02 | 0.01 | 0.89 | 0.71 | 0.09 | 0.06 |
| BM25 (whitespace words) | 0.62 | 0.43 | 0.01 | 0.01 | 0.62 | 0.45 | 0.05 | 0.03 |
| bgeSmallEn | 0.03 | 0.02 | 0.02 | 0.03 | 0.03 | 0.04 | 0.02 | 0.02 |
| bgem3 | 0.88 | 0.88 | 0.03 | 0.03 | 0.74 | 0.71 | 0.07 | 0.07 |
| bgeM3Ko | 0.94 | 0.94 | 0.02 | 0.03 | 0.86 | 0.86 | 0.08 | 0.08 |
| bgeSmallEn + BM25 (RRF) | 0.35 | 0.28 | 0.04 | 0.04 | 0.34 | 0.23 | 0.06 | 0.05 |
| bgem3 + BM25 (RRF) | 0.91 | 0.89 | 0.02 | 0.02 | 0.87 | 0.82 | 0.07 | 0.06 |
| bgeM3Ko + BM25 (RRF) | 0.92 | 0.87 | 0.02 | 0.02 | 0.90 | 0.88 | 0.09 | 0.08 |

11. Extra B, nomic with its documented prefixes: MRR 0.82 to 0.85 (EN), R@1 75% to 79%; Korean unchanged at chance. Small effect.

### nomic with search_document / search_query prefixes: T1. Overall retrieval, per-message index, query = question, original wording (answerable questions only)

Cells: R@1 / R@5 / R@10 in percent, MRR as 0-1. n = 68 answerable questions per language.

| Retriever | EN R@1 | EN R@5 | EN R@10 | EN MRR | KO R@1 | KO R@5 | KO R@10 | KO MRR |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| BM25 (bigram) | 85 | 97 | 99 | 0.91 | 84 | 99 | 99 | 0.90 |
| BM25 (whitespace words) | 85 | 97 | 99 | 0.91 | 56 | 69 | 71 | 0.62 |
| nomic | 79 | 91 | 97 | 0.85 | 0 | 3 | 6 | 0.02 |
| nomic + BM25 (RRF) | 87 | 97 | 99 | 0.91 | 18 | 56 | 74 | 0.37 |

## 6. Limits

* Synthetic and templated; question wording was written by the same author as the evidence and shares vocabulary (T9). The paraphrase variant reduces but does not remove it (entity names stay). A human-written or model-generated question set would be a stronger test.
* n is small: 68 answerable questions per language, 12 to 16 per category. Only the hybrid-gain table has confidence intervals; category-level differences below about 0.15 MRR should not be acted on.
* Context queries use unrelated filler context by construction; the result is a dilution worst case, not an estimate of the app's real behaviour.
* Retrieval only: no reader or answer grading, so answer quality for knowledge-update and temporal questions is not measured.
* Timing is from native onnxruntime-node on an i9 (best case); the app uses wasm or webgpu in the browser or Tauri webview, and the target is a Note 9. Peak memory numbers are Node RSS with batch 50 and are not transferable.
* One dataset draw per language pair; no repeated seeds.
* Windows measured only as non-overlapping 3-message blocks; overlapping windows were not tried.
* The brief's candidate "all local models in localModels" covers the six keys above; the GPU variants point at the same weights and were not run separately.

## 7. Artifacts (all under C:\Users\yor42\AppData\Local\Temp\risu-b715\ltm\m2\)

* `dataset\` chats and README (reusable). `gen\` generator.
* `node\`: `run.mjs` (embed), `analyze.mjs` (retrieval, tables), `bench.mjs` (timing), `build_result.mjs` (this file), `probe.mjs` (model load check). `node_modules` installed with npm in that folder only.
* `vec\`, `vec_cls\`, `vec_prefix\` raw float32 vectors and manifests (mean-pool app-faithful, CLS, nomic prefixed). `out\tables.md` (all tables, full), `out\aggregates.json`, `out_cls\`, `out_prefix\`. `bench.json` (first noisy timing pass, superseded), `bench2.json` (used above). `cache\` downloaded model files (about 1.5 GB). Logs: `run.log`, `probe.log`, `bench*.log`.
* Not modified: anything in C:\Projects\RisuAI.

## 8. Open items

* UNCERTAIN: whether the app's mean pooling for bge-m3 and bge-small-en is an oversight or intended; the observed effect (CLS better for bge-m3 family on Korean, worse for bge-small here) is from one synthetic set. Observation that would settle it: the same comparison on a human-written or real-chat question set (with consent) and on the device's wasm backend.
* UNCERTAIN: realistic recent-message context behaviour (needs on-topic context variants).
* UNCERTAIN: Note 9 index times and memory (needs a device run).
