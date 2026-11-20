# Maintainer answers in the LTM spec session (MC-2588 to MC-2603, MC-2656 to MC-2658)

All via AskUserQuestion, 2026-11-20. IDs assigned by lane A on 2026-11-20; drafts and reviews used placeholders MC-LTM-1 to MC-LTM-16 (MC-LTM-n = MC-(2587+n)).

- MC-2588, scope: "Search + optional notes (Recommended)". Stage 1 ships raw-log hybrid search alone; a later stage adds batched, off-turn note extraction (current-state facts with source links, editable, never replacing the log).
- MC-2589, phone default retrieval: "Keyword default, vectors opt-in (Recommended)". Korean char-bigram keyword search works offline with no download; embedding model (local or API) is opt-in; default model stays with the CHORE-620 measurement.
- MC-2590, lorebooks: "Chat + lore search". The engine may also surface lorebook entries their keywords missed. Lorebooks keep working exactly as today.
- MC-2591, who-knows-what: "Reserve fields, decide later (Recommended)". Schema keeps visibility/known-by room; no UI or logic until a stronger-model test shows it works.

Round 2 (after challenge r1, 2026-11-20):
- MC-2592, phone hybrid: "Worker first, then decide (Recommended)". A prerequisite ticket tries local embeddings off the UI thread on the phone WebView; works -> local hybrid on phones; fails -> phones get API embeddings only. Keyword search ships either way.
- MC-2593, trimming and placement: "Keep per-message trim (Recommended)". Same trim as today; snippets go in the memory slot; no cache claim. Block trimming may be a later opt-in after cost is measured.
- MC-2594, budget-cut lore: "No, only keyword misses (Recommended)". Recall only entries whose keywords did not match and nothing else blocked; lore budget and activation rules stay authoritative.
- MC-2595, .bin engine setting: "'No memory' + warning (Recommended)". Export warning names the engine; upstream opens with memory off.

Round 3 (after challenge r2, 2026-11-20):
- MC-2596, pins: "Drop pins (Recommended)". Users use always-active chat lore or the author's note; the engine stores nothing per chat until the notes stage.
- MC-2597, recalled lore budget: "Only unused lore budget (Recommended)". Recall uses only the lore budget the keyword scan left free; nothing recalled on a turn where the scan cut entries.
- MC-2598, message lengths (maintainer's own words, free text): "how about a script that analyzes the real .bin and only outputs histogram and other datas we need in json format?" -> spec P0 item: an aggregate-only analyzer over the maintainer's real .bin that emits a JSON of histograms and counts, no text, names, keys or settings fields.

Round 4 (after challenge r3 ACCEPT WITH CHANGES, 2026-11-20):
- MC-2599, engine name (maintainer's own words): "How about ChroMemory? Wordplay of both Chromium(element) + Chronicle, and mixes well with xxMemory naming convention." -> name ChroMemory.
- MC-2600, recalled-lore cap (maintainer's own words): "8000 cap is mostly outdated and recent guide recommends around 15000. I think we can have defined cap of 5000 by default and let user to increase it if needed." -> recall cap default 5,000 tokens, user-adjustable, still within the unused lore budget (MC-2597).
- MC-2601, notes on an existing long chat: "Start from now (Recommended)". Backfill only by a button that shows the call count first.
- MC-2602, spec location: "docs/design/ (Recommended)". Commit still needs its own confirmation.

Round 5 (final approval, 2026-11-20):
- Spec r4 approved (maintainer's words): "Approve. add 'memory dashboard' menu where user can view detail of this chat's memory as a feature idea."
- MC-2603, feature idea: a "Memory dashboard" menu showing the details of this chat's memory. Recorded in spec section 7 as an idea, not staged; needs its own sizing.

Round 6 (API-first embeddings, 2026-11-20; MC-2814 relayed by lane A: "local embedding should serve as a fallback and free default. not full blown main engine."):
- MC-2656, S3 order: "S3 API-first (Recommended)". S3 needs only S1 and an API embedding provider; S3a and CHORE-620 (MC-2136) decide only whether and which local fallback model phones are offered.
- MC-2657, provider unreachable: "Keyword-only until back (Recommended)". Offline, no key, quota or provider error -> that send uses keyword search only, the Memory panel shows vectors paused; no second local index.
- MC-2658, free default: "Keyword, local preselected (Recommended)". Keyword search stays the default (MC-2589 stands); turning vectors on without an API provider preselects the local model.
