# Backend/webview separation: feasibility synthesis (2026-11-28, read-only)

Source: workflow wf_f561c770-0e3 (6 investigators + 6 skeptics + synthesizer). The synthesizer could not write this file (hook), so lane A wrote it from its returned packet. Per-question reports in this folder: freeze.md, generation.md (importexport, architecture, evidence reports were not written to disk; their content is in the journal at C:\Users\yor42\.claude\projects\C--Projects-RisuAI\6fdab92e-bfb1-5c7d-aaa2-7412b4f54d55\subagents\workflows\wf_f561c770-0e3\journal.jsonl).

## 1. Verdict on the claim: PARTLY SUPPORTED
- Recorded (not re-run): the page freezes at hidden +60.0-60.1 s in 3 of 3 CHORE-202 runs (screen off; HOME with screen on; screen off whitelisted) with the dataSync foreground service active; the E1 onResume run still froze (n=1). One device: Note 9 phone 2, Android 10, WebView 155, debug build. Cause UNKNOWN, no fix. Screen-off is not the trigger; the page (renderer) freezes, not the process.
- Documented losses are few: a non-stream 512 KiB reply lost on force-stop while hidden (1 of 3); 68 of 88 characters after a recents swipe (accepted, MC-423). No recorded long frontier-model generation loss (absence of evidence, not proof).
- "Relies heavily on the webview": true for import/export, prompt building, output scripts, Lua, memory, tools and save. Outdated for the network socket and reply journal on eligible Android sends (MC-1451, PRs #141/#289/#296 merged): Rust streamed_fetch + reply_store, the page applies the reply on wake. Eligible = single-character, non-continue, no tools; streamed OpenAI chat/Responses/Anthropic/Google; non-stream OpenAI chat only. No recorded device proof that a hidden over-60 s owned reply completes.
- Unmitigated: page-driven import/export stalls at +60 s (loss needs a process kill, 2 h busy-token expiry or the Android 15 dataSync timeout; a killed export leaves a partial .bin); non-owned generation (group, continue, preview, tools, other providers, auxiliary calls); prompt-build and output-script/save phases; long unplugged screen-off.

## 2. Recommended staged path
- Stage 0, measurement only (Note 9 rows, not run): (a) pure-Rust owned streamed reply 5-10+ min with the page frozen, screen off (decisive); (b) over-60 s non-stream owned and non-owned (group) replies; (c) CPU wake-lock A/B with the dataSync service; (d) hidden export at 60 s and 5 min incl. partial-file state; (e) are Rust-to-page events queued or dropped; (f) does a native content-URI descriptor survive freeze and reload; (g) native SAF write rate; (h) unplugged screen-off 3-5 min; Android 15 dataSync onTimeout on emulator/device.
- Stage 1: if a cheap keep-alive works, ship it (option A, Tier 1; Tier 2 if a manifest permission is added); else widen native-owned replies only where Stage 0 shows loss (option B, Tier 2 per slice, additive parse.kind, no Rust format change).
- Stage 2: option C1 native asset copy/splice, export first, then import with the MC-326 resume ledger, only after (f). Tier 2 critical (asset lifecycle/GC, commit order, durability): opus-reviewer plus senior-advisor; .bin stays byte-identical, prompts stay in JS, commit key compare-and-write, store2 generation gate and 24 h sweep rule preserved; reuses MC-328 thin-native-task decision.
- Stage 3: do not start C2 (native DB decode/commit, XL), D (headless core, XL, breaks upstream plugins/Lua/ONNX, contradicts MC-1451) or E (full split, XXL).
- User-visible: more replies finish and save while hidden; long exports and asset copies finish screen-off; the commit tail (~7 min) still pauses when hidden but loses nothing.

## 3. Maintainer decisions
1. Product: import/export keep running screen-off (MC-326 item 4) or foreground-only (MC-345)? Rec: keep MC-345 unless Stage 0 (a) shows a native job survives.
2. Scope: extend native-owned replies beyond single-character chats? Rec: no for tool turns; decide group chats (MC-2325) after the over-60 s group-chat row.
3. Scope: headless/full pipeline port (D/E) out of scope? Rec: yes (MC-1451, MC-175).
4. Device: approve Note 9 rows incl. a wake-lock diagnostic build (Fold 7 untouched, Tab S9 asked). Rec: yes, Note 9 only.
5. Security: WAKE_LOCK or another foreground-service type if the A/B helps (MC-1501 declined a wake lock). Rec: diagnostic build first.
6. Persisted format: native import job resume journal; asset copy before the store2 commit (orphans/GC). Rec: journal as optimisation only, correctness from the byte-exact held judge, no .bin format change.
7. Semantic: native export snapshots the database before the assets. Rec: accept, document in the export notice.
8. Product: warn about and clean up a partial .bin after a killed export. Rec: add.

## 4. Corrections the verification made
- "Rust keeps running while the page is frozen" is INFERRED, not VERIFIED (no commands during the stall; MC-1435 had a native Stop fail at ~5m50s). Long hidden survival is a decision-critical UNKNOWN.
- "A freeze alone loses no data" for import/export is inference, not run; "only silent persisting failure" (partial export) dropped as unenumerated.
- "No resume state for import" UNSUPPORTED (MC-326 item 3 / MC-328 item 6 chose a resume check; implementation UNKNOWN).
- "No export_ commands in lib.rs" wrong: export_append_b64 exists.
- "No power-policy exemption helps" overstated: CPU wake lock, other FGS types, resumeTimers untested; Doze not excluded for long unplugged screen-off (only recorded power state was USB charging).
- Roadmap row 405 stale (S3 #296 merged). The 617/554 s vs 80 s screen-off figure is superseded by the freeze attribution.
- Lua/ONNX "requires porting", Node-sidecar-not-viable and WorkManager/separate-process-not-justified are UNSUPPORTED reasoning (Android's timeout docs list WorkManager/data-transfer as dataSync alternatives; unevaluated). Tier assignments are inference.
- AGENTS.md "pnpm hono:build" row is stale. Cargo.lock is untracked, so APK tauri/wry/tokio versions are unconfirmed (untracked copy: tauri 2.12.1, wry 0.57.1).

## 5. Remaining UNKNOWNs
Hidden over-60 s owned reply completion; freeze mechanism; Rust-to-frozen-page event queue vs drop and whether page JS runs while frozen; Rust read of a picked .bin and descriptor survival; hidden export behaviour and SAF partial-file deletion; whether MC-326 resume exists; reproduction on a release build, WebView 156, Android 14-16, other vendors; real long-generation loss (Agents/Handoffs and raw %TEMP% reports unread); import memory peak.
