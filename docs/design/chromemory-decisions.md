# Maintainer answers in the LTM spec session (MC IDs pending from lane A)

All via AskUserQuestion, 2026-11-20. Placeholders MC-LTM-1.. until lane A assigns IDs.

- MC-LTM-1, scope: "Search + optional notes (Recommended)". Stage 1 ships raw-log hybrid search alone; a later stage adds batched, off-turn note extraction (current-state facts with source links, editable, never replacing the log).
- MC-LTM-2, phone default retrieval: "Keyword default, vectors opt-in (Recommended)". Korean char-bigram keyword search works offline with no download; embedding model (local or API) is opt-in; default model stays with the CHORE-620 measurement.
- MC-LTM-3, lorebooks: "Chat + lore search". The engine may also surface lorebook entries their keywords missed. Lorebooks keep working exactly as today.
- MC-LTM-4, who-knows-what: "Reserve fields, decide later (Recommended)". Schema keeps visibility/known-by room; no UI or logic until a stronger-model test shows it works.

Round 2 (after challenge r1, 2026-11-20):
- MC-LTM-5, phone hybrid: "Worker first, then decide (Recommended)". A prerequisite ticket tries local embeddings off the UI thread on the phone WebView; works -> local hybrid on phones; fails -> phones get API embeddings only. Keyword search ships either way.
- MC-LTM-6, trimming and placement: "Keep per-message trim (Recommended)". Same trim as today; snippets go in the memory slot; no cache claim. Block trimming may be a later opt-in after cost is measured.
- MC-LTM-7, budget-cut lore: "No, only keyword misses (Recommended)". Recall only entries whose keywords did not match and nothing else blocked; lore budget and activation rules stay authoritative.
- MC-LTM-8, .bin engine setting: "'No memory' + warning (Recommended)". Export warning names the engine; upstream opens with memory off.

Round 3 (after challenge r2, 2026-11-20):
- MC-LTM-9, pins: "Drop pins (Recommended)". Users use always-active chat lore or the author's note; the engine stores nothing per chat until the notes stage.
- MC-LTM-10, recalled lore budget: "Only unused lore budget (Recommended)". Recall uses only the lore budget the keyword scan left free; nothing recalled on a turn where the scan cut entries.
- MC-LTM-11, message lengths (maintainer's own words, free text): "how about a script that analyzes the real .bin and only outputs histogram and other datas we need in json format?" -> spec P0 item: an aggregate-only analyzer over the maintainer's real .bin that emits a JSON of histograms and counts, no text, names, keys or settings fields.

Round 4 (after challenge r3 ACCEPT WITH CHANGES, 2026-11-20):
- MC-LTM-12, engine name (maintainer's own words): "How about ChroMemory? Wordplay of both Chromium(element) + Chronicle, and mixes well with xxMemory naming convention." -> name ChroMemory.
- MC-LTM-13, recalled-lore cap (maintainer's own words): "8000 cap is mostly outdated and recent guide recommends around 15000. I think we can have defined cap of 5000 by default and let user to increase it if needed." -> recall cap default 5,000 tokens, user-adjustable, still within the unused lore budget (MC-LTM-10).
- MC-LTM-14, notes on an existing long chat: "Start from now (Recommended)". Backfill only by a button that shows the call count first.
- MC-LTM-15, spec location: "docs/design/ (Recommended)". Commit still needs its own confirmation.

Round 5 (final approval, 2026-11-20):
- Spec r4 approved (maintainer's words): "Approve. add 'memory dashboard' menu where user can view detail of this chat's memory as a feature idea."
- MC-LTM-16, feature idea: a "Memory dashboard" menu showing the details of this chat's memory. Recorded in spec section 7 as an idea, not staged; needs its own sizing.
