# Report 61 — Asset display without loading: CHORE-109 Stages A and B, the CI test 32 fix and the `key.txt` untracking

**STATUS:** Stages A and B of CHORE-109 are on `main` and pushed: `bccf1a53` (Stage A, the Node asset route and URL display), `9ec38568` (Stage B, list thumbnails from a header read and the asset URL). Two small commits ride with them: `d019e66a` (the CI test 32 fix) and `f42cdad9` (stop tracking `src-tauri/key.txt`). **Stage C (a run on the Note 9) is done (2026-10-07): the asset URL, the canvas readback and the thumbnails pass; a Range request with a start above 0 fails on Android, so a video stalls after about 1 MB. That defect predates CHORE-109 (INFERRED from source) and is CHORE-115, which waits for a wry release containing the upstream fix (`MC-230`).**

This report is a dated snapshot, written on 2026-10-07 against `main` at `9ec38568`. It is the durable record of the questions, plans, gates, red and green evidence, live checks and residuals of this work; the commit messages hold the full text of what each commit changed.

**Evidence labels.** Each figure keeps the label its source gave: MEASURED (a run), INFERRED (reasoned from code or the browser's behaviour, not run), TRACED (read in source) and TODO(evidence) (the records items do not hold it). **Every measured figure below, except Stage C's (section 8), is from one Windows machine, an i9-13900KF, which is best-case hardware (`MC-003`, `MC-010`), and from synthetic data (`MC-131`). None is a claim about the Raspberry Pi 3 or mid-range phones.** Stage C's figures are from one Note 9 (Android 10, WebView 153, a debug build, single runs, synthetic fixtures; `MC-198` (a)).

**Sources** (the session scratchpad; not durable, so this report and ledger rows 1312 to 1334 are the durable record): `chore109/` (`packet.md`, `packet2.md`, `plan.md`, `plan-final-stageA.md`, `plan-stageB.md`, `plan-final-stageB.md`, `gate1/`, `gate2/`, `gate1B/`, `gate2B/`, `impl/`, `implB/`, `live/`, `commit-msg-A.txt`, `commit-msg-B.txt`, `brief-stageC.md`) and `ci-save32/` (`packet.md`, `fix/`, `commit-msg.txt`). Maintainer decisions are `MC-226` to `MC-228`.

## 1. Outcome at a glance

| # | Change | Commit | Plan gate | Code gate | Live result (MEASURED; row 5 is a Note 9, not best-case) | Ledger rows |
|---|---|---|---|---|---|---|
| 1 | CHORE-109 Stage A: the Node asset route and URL display | `bccf1a53` (171 files, +2263/-420) | Round 1 `[REJECT]`, round 2 `[EDITORIAL]` | Round 1 `[APPROVE]`, round 2 `[EDITORIAL]` | Image, video and background shown from `/api/asset/` URLs; no `/api/read` of an asset; Range gave 206 | 1312 to 1319 |
| 2 | CHORE-109 Stage B: list thumbnails from a header read and the asset URL | `9ec38568` (5 files, +1566/-47) | Round 1 `[REJECT]`, round 2 `[EDITORIAL]` | Round 1 `[EDITORIAL]`, round 2 `[EDITORIAL]` | PNG and JPEG thumbnailed from the URL; APNG, WebP and GIF skipped; one `/api/read` in total | 1320 to 1325 |
| 3 | CI test 32 fix | `d019e66a` (1 file, +15/-5) | none (test-only) | `[EDITORIAL]` | 20 of 20 alone, 3 of 3 whole file, local | 1326 to 1328 |
| 4 | Stop tracking `src-tauri/key.txt` | `f42cdad9` (2 files) | none | none | none | none |
| 5 | CHORE-109 Stage C (Note 9 live check; no code) | none (a check of `9ec38568`) | none | none | C1, C3, C4, C6 pass, C5 passes with caveats, **C2 (Range) fails** (section 8) | 1331, 1332 |

Reject streaks: each plan had at most one `[REJECT]` round in a row, so the three-round rule of AGENTS 1.2 was not reached and no `senior-advisor` escalation was made. Neither investigation escalated to `deep-investigator`.

## 2. The investigations behind CHORE-109

**Round 1 (row 1312, `investigator`, `chore109/packet.md`).** 155,810 tokens, 75 tool uses, about 5.0 min, no escalation. The Orchestrator re-checked `getFileSrc` (`globalApi.svelte.ts`) and the `navigator.serviceWorker` gate in `bootstrap.ts` and confirmed the main findings:
- **Desktop and Android already display assets by file URL.** `getFileSrc` on Tauri returns the store's `urlFor`, which is `convertFileSrc` of the file path, since `bf7f2cbf` (CHORE-55 stage 3) (TRACED). The Roadmap's "desktop and Android stage" of CHORE-109 was therefore a verification stage, not a build stage.
- **Web uses a service worker, but not over the stored files.** `getFileSrc` reads the whole asset into the page, posts it to the worker, which keeps a second copy in the Cache API and serves it at `/sw/img/<hex>` (TRACED). The worker never reads IndexedDB and has no Range handling.
- **The Node server had no URL route for an asset.** `/api/read` takes the key in a header and sends the whole file; an `<img src>` or `<video src>` cannot send that header (TRACED).
- The thumbnail generator reads the full bytes on every platform, including Tauri (TRACED), and inlays are not asset-store assets (a localforage store named `inlay`).

**Round 2 (row 1313, `investigator`, `chore109/packet2.md`).** 218,992 tokens, 99 tool uses, about 8.7 min, no escalation. The Orchestrator re-checked the token facts: the client sets `exp = iat + 5*60` (`nodeStorage.ts`, `createAuth`), the server's `isAuthorizedJwtHeader` only tests `exp < now`, and the server's `isHex()` accepts `__password` (`server.cjs`). Confirmed.

**Maintainer answers** are in `MC-226`: the Node route first; a token in the URL, then a scoped read token, then no expiry; grid thumbnails in scope; inlays dropped to a new ticket (CHORE-114); a route for all Node pages.

## 3. Stage A: the Node asset route (`bccf1a53`)

**Plan and Gate 1 (rows 1314, 1315).**
- Round 1 (`opus-reviewer`, 232,233 tokens, 84 tool uses, about 12.1 min) was `[REJECT]`. Blockers: B1 a translation cache keyed on HTML that holds the token (the Orchestrator verified at source that the `pretranslate` `ParseMarkdown` path embeds the `getFileSrcCached` URL); B2 a byte fallback pinning a data URL in an unbounded `fileSrcCache`; B3 cached URLs outliving a renewed token; B4 two JWT validators with tests guarding only one. It also raised M1 to M6 and L1 to L5. The Orchestrator separately found that the server has no revocation of known public keys except by editing the file.
- After round 1 the maintainer chose a token with no expiry (`MC-226` 4); the records items do not say how this bore on B3.
- Round 2 (the same reviewer, resumed; 252,512 tokens cumulative, 6 tool uses this round, about 2.0 min) was `[EDITORIAL]`: E1 stale text below Revision 2, E2 narrow the I12 clean-up to route-served keys, E3 reproducers must assert the auth refusal status. The Orchestrator applied all three in `plan-final-stageA.md` and closed each against the file. Optional O1 and O2 were folded in; O3 (Firefox) was not run.

**Implementation (row 1316, `sonnet-coder`).** 344,102 tokens, 200 tool uses, about 21.6 min, in worktree `RisuAI-assetroute` on `feat/asset-route`: 19 modified and 17 new files. Red: against the unchanged code plus inert stubs, 11 files and 100 tests failed. Deviations 1 to 6 are in the coder's hand-back (upper-case hex served; the clean-up in `routeCacheCleanup.ts`; an x.y fingerprint; `isPlainHttpFileSrc` unused; statuses; the stalled test using `/api/remove`). The coder's report write was refused for a subagent; the report is in its hand-back.

**Orchestrator pre-gate.** MEASURED: `CI=true` vitest 528 files, 10697 passed, 6 skipped; `pnpm check` 0 errors, 0 warnings; `pnpm build` ok; the trigger grep clean; line endings LF in the index and CRLF in the worktree, as on `main`.

**Gate 2 round 1 (row 1317, a fresh `opus-reviewer`).** `[APPROVE]`; 192,378 tokens, 63 tool uses, about 11.5 min. The reviewer ran `nodeAssetRoute.test.ts` against `main`'s unchanged `server.cjs`: 53 failed and 8 passed, so the I3 reproducers fail for the intended reason. F1 (outside the diff): a 0-byte untracked `src/ts/storage/tests/nodeAssetRoute.test.ts` had leaked into the main checkout at 06:29:13 from the Stage A coder; the Orchestrator deleted it (empty, untracked, ours). Optional O1 to O7: O1 label guards, O4 remove `isPlainHttpFileSrc` and O5 the final newline were taken; O2 and O3 went to the commit message; O6 (the immutable-cache trade-off) is disclosed there; O7 was the live check.

**Follow-ups (row 1318, the same coder, resumed).** Guard labels; `isPlainHttpFileSrc` removed, which dropped 137 dead mock entries across about 134 test files (the Orchestrator checked that every changed line in the sweep files only drops `isPlainHttpFileSrc`); a final newline. The coder ran the full suite: 528 files, 10695 passed, 6 skipped. The Orchestrator: `pnpm check` 0/0 and the build ok (`VITE_RISU_LEGAL_CONFIGURED=TRUE`). TODO(evidence): the follow-up run's token and tool-use figures are not in the records items.

**Gate 2 round 2 (row 1319, the same reviewer, resumed).** `[EDITORIAL]`; 230,591 tokens agent total, 24 tool uses this round, about 5.9 min. The sweep diff was accepted and the reviewer re-ran the full suite (528 files, 10695 passed, 6 skipped). Finding R2-1: with the `isPlainHttpFileSrc` mock removed, the `assetMarkupUrl` and `fileSrcCacheAv3` tests fail at load against the old parser (run through a scratch config with `HEAD`'s parser), so they no longer fail on their assertions there. The Orchestrator chose fix (b): keep the files and qualify the commit message (the 100-test red record predates the removal). The commit message was also corrected for C1 and C2 (secure context; CHORE-49), C-T1, C-T3, C-T4 (6 assertions and 4 from the decode helper), C-T5, C-L2, C-L6 and C7, with optional C10 and C17.

**What Stage A does** (from the commit message; read it for the full rules). The server streams an asset at `GET /api/asset/<hex of the key>` with `sendFile` (so Range gives 206), for keys under `assets/` only, behind an asset-read token (same signed format, `aud "asset-read"`, no expiry required), with its own rate limiter. `getFileSrc` returns that URL for an `assets/` key in a secure context (https or localhost), with the service worker on or off, and falls back to the byte path if the store cannot make the URL. Tauri and pure web pages are unchanged. One `verifyJwt` now backs `checkAuth` and the websocket check; both refuse any token with an `aud` claim and both now require a numeric `exp` (a token with no `exp` used to pass as never expiring; tokens from this client and from upstream always carry `exp` and never `aud`). No storage or format change; plugin `readImage`, export, `.bin` backup, LLM attachments, scripts, TTS and image generation still read bytes.

**Live check (Orchestrator, built-in pane).** A production build of the worktree, served by the worktree's `server.cjs` from `chore109/live/srv` on localhost:6011 (PID 52472, stopped afterwards); a synthetic 832x1216 PNG (894,880 B) and a 4 s canvas webm (126,724 B) saved through `__pluginApis__.saveAsset`; the webm got an `assets/<hash>.png` key, which is the O7 case. MEASURED, i9-13900KF, best case:
- Image, video and background URLs are `/api/asset/<hex>?risu-auth=...` (token 394 characters); the `alt` is the asset name; no `/sw/img/` request was made. A fetch-patched re-render of a newly added asset made no `/api/read` of any `assets/` key (only `blocks/head`).
- The route answered 200 `image/png` with `Accept-Ranges: bytes`, `private, max-age=31536000, immutable`, `nosniff` and a CSP `sandbox`; `Range: bytes=0-15` gave 206 `bytes 0-15/126724`; the `__password` hex gave 400; no token gave 401. Video seeks produced 206 requests.
- O7: the webm served as `image/png` with `nosniff` plays in Chromium (readyState 4, duration 3.87 s, seek ok).
- The same video and image URLs after a full reload (the token persisted).
- M3: with 8 videos playing, a save (`setChar`, then `/api/write`) completed in 759 ms. **Caveat:** the clip is 127 KB, so the streams did not hold connections; a long-video connection-cap test was not run. Firefox was not available. No heap snapshot was taken (no devtools in the pane); the evidence is the absence of asset reads.

**Commit.** The maintainer typed "yes. commit and merge. you can also prune the worktree after that." (`MC-227` 1). `bccf1a53` was committed on `feat/asset-route` by explicit path, `main` was fast-forwarded `f42cdad9..bccf1a53` and pushed, and the worktree `RisuAI-assetroute` and branch `feat/asset-route` were removed.

## 4. The plain-HTTP correction (the premise of the first question was wrong)

The investigator's packet (section 1) and the first `AskUserQuestion` said plain-HTTP LAN users take the data-URL path and would gain from Stage A. That missed CHORE-49 and `MC-144`: the Node server does not boot over plain HTTP at a LAN address at all, because `crypto.subtle` is undefined there and the auth token signing needs it. Consequences, as the commit message states them:
- Stage A today helps Node pages on https and on localhost, which were on the service-worker Cache copy.
- A plain-HTTP LAN page benefits only after CHORE-49 is fixed, and **that fix must also give the asset-read token a signer**, because without `crypto.subtle` the page cannot mint it. This is now noted in CHORE-49's Roadmap entry.
- The Orchestrator told the maintainer in the Stage A Gate 2 progress message on 2026-10-07 (it said it had wrongly claimed that plain-HTTP LAN users get data URLs, and that the Node server does not start over plain HTTP at a LAN address). The maintainer gave no separate answer; their next message was the Stage A commit approval (`MC-227` 1). This is not a maintainer decision on CHORE-49.

## 5. Stage B: list thumbnails (`9ec38568`)

**Plan and Gate 1 (rows 1320, 1321).** The maintainer typed "start planning stage B." (`MC-227` 2). The Orchestrator wrote `plan-stageB.md` (T1 to T9: pure web unchanged; URL decode on Node and Tauri with a `SecurityError` latch and a byte-path fallback; the Tauri URL path evidenced only by Stage C until run) after re-reading `avatarThumb.ts` on `bccf1a53`.
- Round 1 (a fresh `opus-reviewer`, 162,842 tokens, 42 tool uses, about 7.7 min): `[REJECT]`. B1: `getImageType` reports JPEG only with a trailing `FF D9` (the Orchestrator verified `imageType.ts`), so a 64 KiB JPEG prefix would get a persisted skip. M1: a CORS failure is a load error, not a `SecurityError`, so the latch never fires (wry 0.55.1 on Linux, schemes not CORS-enabled; INFERRED). M2: the whole-file test must be bytes equal to the total, plus the failed-read cases. M3: test seams (happy-dom `getContext` is null; a red run must not be a missing export). Also m1 to m5 and E1, E2.
- The Orchestrator decided the JPEG rule (`MC-227` dispositions) and wrote Plan Revision 2.
- Round 2 (the same reviewer, resumed; 178,598 tokens agent total, 4 tool uses, about 1.4 min): `[EDITORIAL]`. R2-1 the byte path must use the new classifier and its MIME type (plus a Node URL-failure JPEG test); R2-2 the JPEG rule is `FF D8 FF` or today's test, with an `FF D8` non-`FF` prefix undecided; R2-3 superseded text contradicted the revision. The Orchestrator wrote `plan-final-stageB.md` (supersedes `plan-stageB.md`), applied R2-1 to R2-3 and the optional T1 note, and closed each against the review. The plan was accepted.

**Implementation (row 1322, `sonnet-coder`).** After "yes, start the implementation" (`MC-227` 3): worktree `RisuAI-assetthumbs` on `feat/asset-thumbs` from `bccf1a53`. 192,138 tokens, 77 tool uses, about 13.0 min. 2 modified and 3 new files (`avatarThumb.ts`, `avatarThumb.test.ts`; `avatarThumbHeader.ts`, `avatarThumbGenerate.test.ts`, `avatarThumbHeader.test.ts`). Red (render seam only, before the change): 14 failed on behaviour and 6 guards passed. The commit message states this as 11 reproducers and 3 switch-off specifications failed, 6 guards passed, and that two tests added later in review have no recorded red run. Coder's full suite: 530 files, 10789 passed, 6 skipped; `pnpm check` 0/0. Open choices: `urlFor` through `getAppStore`; switch-off skips the header read; a null render has no fallback; the 64 KiB exact-200 rules.

**Orchestrator pre-gate.** `pnpm check` 0/0; build ok (`VITE_RISU_LEGAL_CONFIGURED=TRUE`); full suite `CI=true` 530 files, 10787 passed, 2 failed (5 s timeouts in `assetFacade.test.ts` and `assetPieceSave.test.ts`, files the diff does not touch, while the CI test 32 investigator ran vitest at the same time); a rerun of those two files passed 75 of 75. The trigger grep hit only the "major" brand false positives. The main checkout stayed clean.

**Gate 2 round 1 (row 1323, a fresh `opus-reviewer`).** `[EDITORIAL]`; 170,692 tokens, 47 tool uses, about 10.6 min. T1 to T9 hold; the import cycle was cleared; mutants 18 of 21 killed (the 3 survivors were O1 and O2). E1: the test-file header misclassified guards and specifications. The Orchestrator took E1, O1, O2, O3, and O4 as a T4 tightening (`MC-227` dispositions).

**Remediation (row 1324, the same coder, resumed).** 207,954 tokens agent total, 18 tool uses this round, about 1.5 min. E1 and O1 to O4 done; 7 files, 236 passed; `pnpm check` 0/0. Orchestrator: full suite 530 files, 10792 passed, 6 skipped; build ok; trigger grep clean.

**Gate 2 round 2 (row 1325, the same reviewer, resumed).** `[EDITORIAL]`; 191,279 tokens agent total, 10 tool uses this round, about 2.2 min. The remediation was verified; mutants M6, M21, M22 and the new M23 were killed; 146 of 146 tests passed. The commit message was corrected for C1 (the reproducer count: 11 reproducers and 3 specifications failed, 6 guards; two later tests have no red run) and C2 (its first paragraph), and gained two precisions (Tauri without the ranged transport keeps the whole read; switch-off skips the header read). The build was re-run after the remediation (`implB/build-2.txt`).

**What Stage B does** (from the commit message). On Node pages and on Tauri, the generator reads at most the first 64 KiB first and decodes a still from the asset's URL; pure web pages, and Tauri pages without the ranged transport, keep the whole read. One classifier answers null, animated, unknown type or still for a whole file, and may answer undecided for a prefix, which means a whole read. A PNG is decided by an `acTL` or an `IDAT`/`IEND` inside the prefix; a PNG whose pre-`IDAT` chunks run past 64 KiB is undecided. GIF stays animated. **One deliberate change on every platform:** a file that starts `FF D8 FF` is a still JPEG whether or not it ends `FF D9`, so a JPEG with trailing bytes gets a thumbnail instead of a skip record. Header reads: Node uses a `Range: bytes=0-65535` GET of the asset route; Tauri reads one 65536-byte piece through the ranged transport. If the URL path fails, the avatar is made through the byte path in the same task, and URL decode turns off for the page's life only when the byte path then decoded the same avatar. Thumbnail size, format and `THUMB_VERSION` are unchanged; no storage or format change.

**Live check (Orchestrator, built-in pane).** A production build of the worktree, served by its `server.cjs` from `chore109/live/srv` on localhost:6011 (PID 12628, stopped afterwards; the `dist` junction removed; the `risuThumb` IndexedDB deleted first). Synthetic avatars saved through `saveAsset`: a still PNG 832x1216 (855,366 B), a noisy JPEG 832x1216 (631,185 B), an APNG (245,745 B, with a 100 KiB `tEXt` chunk before `acTL`), a hand-built animated WebP (3,938 B; the VP8X animation flag is set but the file is malformed and the browser could not decode it) and a 1x1 GIF (42 B). MEASURED, i9-13900KF, best case:
- The PNG, the JPEG and the existing SynthChar PNG got `data:image/webp` thumbnails (168x246). The APNG, WebP and GIF got a skip record and display full-size from `/api/asset/`.
- Network: each avatar made one 206 header request; the stills made a 200 route GET (the URL decode); exactly one `/api/read` happened during thumbnailing, and its response was 245,745 B, the APNG (undecided, so a whole read, as planned). No `/api/read` of the PNG or the JPEG.

**Commit.** The maintainer typed "yes, commit and merge. prune the worktree too." (`MC-227` 4). `9ec38568` was committed on `feat/asset-thumbs` (5 files, by explicit path), rebased onto `main` `d019e66a` (the CI fix, a different file), `main` was fast-forwarded to `9ec38568` and pushed, and the worktree `RisuAI-assetthumbs` and its branch were removed. Checks recorded in the commit message: full suite 530 files, 10792 passed, 6 skipped; `pnpm check` clean; build succeeds.

## 6. The CI test 32 fix (`d019e66a`)

**Report.** On 2026-10-07 the maintainer reported the CI vitest failing and pasted a Copilot analysis (test 32 in `globalApi.saveSkip.svelte.test.ts`; it claimed the save loop forces a stale "Save mine") (`MC-228` 1).

**Observation (Orchestrator).** PR Check had failed on every push since `bc631526` (run 37432294390, 2026-10-06). The last green push was `1ce8abff` (2026-10-02), 123 commits earlier, and test 32 was the only failure in each run. Locally (Windows, `CI=true`, `bccf1a53`) the whole file passed 36 of 36, while `-t '32 \(R\)'` alone failed, so the failure depends on order or state.

**Investigation (row 1326, `investigator`).** 76,759 tokens, 28 tool uses, about 12.4 min, no escalation. A test-side race: the `alertSelect` mock answers "Save mine" instantly, so the correctly based second commit lands before the intermediate read. The Copilot premise is refuted: `commitSave` in `blockStore.ts` already compares the stored sequence number with the Save mine's `peerSeq` (the Orchestrator verified this at source). The race arrived with the test itself in `420a9b7b` (Stage 1c slice C); there is no product regression. The investigator did not reproduce an isolated-versus-whole-file pattern (intermittent both ways). Maintainer-Context holds no entry on "Save mine".

**Fix (row 1327, `test-warrior`).** 46,759 tokens, 16 tool uses, about 6.5 min, after the maintainer typed "commit the CI test fix once reviewed." (`MC-228` 2). The diff is 15 insertions and 5 deletions in test 32 only (CRLF kept): the first prompt is answered at once, and the second answer is held until the test has read the stored state. MEASURED locally with `CI=true`: 20 of 20 runs of test 32 alone, 3 of 3 runs of the whole file. A mutant of `blockStore.ts` that lets a stale Save mine through makes the test fail with "timed out waiting for the second prompt". `pnpm check` 0/0; the trigger grep was clean.

**Review (row 1328, `adversarial-reviewer`).** `[EDITORIAL]`; 68,529 tokens, 16 tool uses, about 1.7 min. The test change was accepted. In the commit message, "scratch copy" became "load-time mutant" (applied) and "sometimes locally" was kept as "on some local runs" (the Orchestrator observed a local failure of the isolated run, and the investigator's scratch "b", run 1, failed). The reviewer's claim about the Co-Authored-By model was rejected (the session attribution is Opus 5.5). Non-blocking: an unconsumed `mockImplementationOnce` could carry over, only in a failing run. `d019e66a` was committed on `main` and pushed (`bccf1a53..d019e66a`).

**CI result** (`gh run list --repo yor42/RisuAI`, Orchestrator, 2026-10-07; timestamps UTC): PR Check succeeded on `d019e66a` (created 2026-10-06T23:03:05Z) and on `9ec38568` (2026-10-06T23:11:51Z), and failed on `bccf1a53`, `f42cdad9`, `1e71c45c` and `64436cbd`.

## 7. Stopping tracking `src-tauri/key.txt` (`f42cdad9`)

The file came from upstream (`a1a38d5a`, "Add Python server setup and dependencies installation") and is a leftover of a local run of the Python server. The commit message states that nothing reads it: the bundle ships only `src-python/*` as resources (`tauri.conf.json`), so it was never packaged; the server started by `run_py_server` (`lib.rs`) runs `main:app`, which writes and reads its own `key.txt` next to the Python executable; and `run.py` writes one into its working directory each start. No other file in the repository refers to it. The commit removes it from the index and adds one line to `.gitignore` (2 files, 1 insertion, 1 deletion). This report does not open or describe the file's contents.

The maintainer approved the removal on 2026-10-07 and supplied the wording from memory, approximately and not as a verbatim quote (`MC-228` 3): "It came with the upstream. and I am not sure what it does. I just left it as is to not to break anything. you can remove it if it does nothing". **TODO(evidence):** whether any review or fact-check ran on `f42cdad9` is not in the records items.

## 8. Stage C: the Note 9 live check (2026-10-07)

The maintainer typed "start stage C" (`MC-227` 5). The Orchestrator wrote `chore109/brief-stageC.md` (C1 to C6: the asset URL, a Range 206, canvas readback, the thumbnail path per avatar, memory, logs; an `install -r` that keeps data; no `pm clear`, uninstall or settings change; counts only of the maintainer's data) and dispatched `perf-analyzer` on `main` at `9ec38568` (row 1331: 273,050 tokens, 157 tool uses, about 26.5 min, no escalation). The agent's report write was refused; the Orchestrator saved the hand-back as `chore109/stageC/report.md`.

**Hardware and build (disclosure, `MC-198` (a)).** One Samsung SM-N960N (Note 9), Android 10, WebView 153.0.8010.36; a **debug** aarch64 APK (314,879,143 B) built from `git archive HEAD` of `9ec38568` (source hash over `src`, `src-tauri/src` and `src-tauri/capabilities`, 1075 files, CRLF-normalised equal to `main`: `C506DBAE331C6C3991322119B1683F6654F9E73FBD0700DB7E546B961855C982`; tauri CLI 2.11.5; `Cargo.lock` with tauri 2.11.5; JDK 21; offline), installed with `adb install -r` (Success, same signature, data kept). All runs are single runs on a debug build, not a release build. Figures are MEASURED unless labelled INFERRED.

**Verdicts**

| Check | Verdict | One line |
|---|---|---|
| C1 asset URL | PASS (two notes) | The URL is `http://asset.localhost/<encoded path>`; 200; `Access-Control-Allow-Origin: http://tauri.localhost`; content type from the content. The chat avatar is a CSS background, not an `<img>`. `accept-ranges` appears only on Range responses (tauri `asset.rs`, by design). |
| C2 Range | **FAIL** | `bytes=0-15` and `bytes=0-` give a correct 206 (`0-` is capped at tauri's `MAX_LEN`, 1,024,000 B). Any Range with a start above 0 has a `Content-Length` short by exactly the start, or ends in `ERR_FAILED`. An mp4 stops after about 1 MB with `MEDIA_ERR_NETWORK` (logcat `PIPELINE_ERROR_READ`). |
| C3 canvas readback | PASS | A `crossOrigin` image reads back (226,10,0,255); without `crossOrigin` a `SecurityError`, as expected. |
| C4 thumbnails | PASS | See the table below. `urlDecodeOff` false is INFERRED (the hook is unreachable in a production build; no URL failure occurred). The fallback was not exercised. A control reload made 0 events. |
| C5 memory | PASS with caveats | See below. |
| C6 console and logcat | PASS for this stage | No scope refusal and no thumbnail warnings; only the mp4 Range `ERR_FAILED` entries. |

**C2 detail** (avatar, 108,887 B): `100-200` gave a 206 with the right header but `content-length` 1 (should be 101); `101-300` gave 99 (200); `1000-2000` gave 1 (1001); `50-` gave 108,787 (108,837); `100-100`, `1-1` and `100000-100100` gave "Failed to fetch"; `0-0`, `0-5` and `0-100` were correct. For the mp4 (6,292,294 B): `1024000-`, `1024000-1024100`, `2000000-2000100`, `3000000-` and `6292200-` all failed. In the video element the first request `bytes=0-` returned 206 with 1,024,000 B, then `bytes=1024000-` failed with `ERR_FAILED` about 15 times in 10 s; `error.code` 2; buffered 0.976 of 6 s. **The mechanism is INFERRED, not isolated:** tauri's `asset.rs` computes correct headers, and the Android WebView or wry layer appears to apply the start offset again to an already-ranged body. No discriminating experiment was run. The CHORE-115 investigation later traced the cause in source (see "After Stage C" below).

**Orchestrator note (pending item 30).** The perf-analyzer said Stage A routes Tauri video through the protocol. That is not supported: `getFileSrc` at `f42cdad9` (before Stage A) already returned `store.urlFor` or `convertFileSrc` on Tauri (packet section 1, since `bf7f2cbf`, CHORE-55 stage 3; Stage A added the Node route). **The Android Range defect predates CHORE-109** (INFERRED from source; the old build was not run). It is filed as CHORE-115 (`MC-229`).

**C4, per avatar** (synthetic fixtures; charx cards `c109c-a` to `e`):

| Avatar | File | Outcome (MEASURED) |
|---|---|---|
| a | PNG 832x1216, 108,887 B | URL path, no whole read; webp thumbnail 168x246 |
| b | JPEG 832x1216, 258,808 B | URL path, no whole read; webp thumbnail 168x246 |
| c | APNG 303,413 B (102,408 B `tEXt`, `acTL` at 102,474) | Header undecided; one whole read (303,469 B including a 56 B trailer); skip |
| d | animated WebP 81,916 B (libwebp_anim; decodes in desktop Chrome) | Header read only; skip |
| e | GIF 109,042 B | Header read only; skip |

Five header reads of 65,592 B each. Card `c109c-a` also held a 6,292,294 B `clip.mp4` (640x360, 6 s) and a 202,909 B `extra.png`.

**C5, memory** (single runs, MB; MEASURED):

| | app VmRSS before / peak / end | renderer VmRSS | app PSS | sandboxed PSS |
|---|---|---|---|---|
| list opened, 5 thumbnails generated | 289 / 367 / 353 | 232 / 246 / 243 | 226 / 299 / 260 | 151 / 161 / 157 |
| control, records stored | 292 / 377 / 352 | 236 / 240 / 238 | 230 / 303 / 264 | 150 / 153 / 151 |

No asset-sized `Uint8Array` or string was in the JS heap (heap 23.1 MB; the largest `ArrayBuffer`s were 131,076 B and 65,536 B). Opening the list added about 70 MB PSS in the app process with or without thumbnail generation (UI and WebView). Generation added about 10 MB of renderer PSS (two runs, no variance). **Caveats:** single runs on a debug build; the files are 0.1 to 0.3 MB, below noise; the native side (URL decode reads each whole avatar natively, with a 200 and the full content length) was not measured for a large avatar. **This shows no regression; it does not show a saving.**

**Device state.** Found: a previous debuggable build in the first-run state (welcome wizard) with 0 characters. **The agent passed the welcome wizard** (nickname "tester", "set up myself"), which is a persistent app-settings change. Left: `9ec38568` installed, 0 characters; the 7 asset files it created removed by exact name through `run-as`; its 5 `avatarThumb` records cleared; `/sdcard/Download/chore109c` and `cache/chore109c` removed; the `adb` forward removed. No `pm clear`, uninstall or settings change (only `KEYCODE_WAKEUP`).

**Deviations.** Importing from `/sdcard` failed with a permission error, so the fixtures were copied into the app cache through `run-as`. Repeated delete taps stacked confirm dialogs, so the delete script was limited to `c109c-` names. The agent made no repository edits or index operations; vite may have written gitignored cache under `main`'s `node_modules/.vite`.

**After Stage C.** The maintainer chose "Ticket + investigate (Recommended)" (`MC-229`): CHORE-115 was filed and an `investigator` was dispatched (row 1332: 93,222 tokens, 29 tool uses, about 3.7 min, no escalation).
- **Cause (TRACED in source; no device run):** tauri 2.11.5 `asset.rs` returns a correct ranged 206 and wry 0.55.1 passes the body through as a `ByteArrayInputStream`; Chromium's Android WebView stream loader then skips the request's Range start again on that already-ranged body, so `Content-Length` is N minus the start and a start at or past N fails. The C2 data points match (the investigator counts 12). The Chromium source read was `main`, not the WebView 153 tag (INFERRED that 153 matches). Ranges past 2 GiB also fail.
- **Upstream:** wry issue #1864 and PR #1865 (approved, unmerged), confirmed by the Orchestrator with `gh`. Not fixed in wry 0.57.0 or tauri 2.12.1. Desktop WebView2 is INFERRED unaffected (no run).
- **Options** (Roadmap CHORE-115 lists A to F): wait for upstream (A), a patched wry fork (B), a Blob URL stopgap (E); a repo-side Kotlin change was found not feasible (C, INFERRED), an own protocol handler was rejected for memory (D), and a local HTTP server is larger (F, M to L).
- **Decision:** "Wait for wry (Recommended)" (`MC-230`). No code; CHORE-115 stays open and is checked before the Android release; Android video stays broken until then.
- **Acceptance (the Orchestrator's proposal, not a maintainer decision):** the C2 fetches return the right length and the mp4 plays past 1 MB on the Note 9.

## 9. Residual risks and not checked

- **Firefox was not run** for Stage A's route (O3) or the media-type check (O7 is a Chromium result).
- **A long-video connection cap was not tested.** The Stage A live clip is 127 KB and streams did not hold connections (M3 caveat).
- **Linux and macOS asset-protocol CORS is unchecked.** On Tauri the Stage B URL decode sets `crossOrigin` to anonymous; a CORS failure is a load error and falls back to the byte path (wry 0.55.1 on Linux, INFERRED). Stage B's commit message says the same.
- **The Tauri URL path was run on one device only** (Stage C: a Note 9, Android 10, WebView 153, debug build; section 8). Windows, macOS, Linux and other Android devices are not covered. On Tauri the webview still reads the whole file into native memory when it decodes from the URL (commit message; Stage C saw each avatar read whole natively, 0.1 to 0.3 MB files).
- **Stage B's URL-failure fallback was not exercised on the device** (no URL failure occurred), and `urlDecodeOff` staying false is INFERRED, because the hook is unreachable in a production build.
- **A large avatar's native read was not measured** on the device; the Stage C avatars were 0.1 to 0.3 MB, below noise.
- **Android video stalls after about 1 MB** (C2; CHORE-115; section 8). It is not fixed by this work and stays broken until a wry release containing tauri-apps/wry#1865 (or an equivalent fix) arrives (`MC-230`); it is to be checked before the Android release. The cause is TRACED in source, with no device run of a fix, and the Chromium source read was `main`, not the WebView 153 tag.
- **Plain-HTTP LAN pages gain nothing yet** (section 4; CHORE-49 and `MC-144`).
- **Trade-offs disclosed in the Stage A commit message:** the asset URL, token included, can reach a translation provider inside pre-translate HTML, or another host through card HTML (the token reads assets only); a hash-named asset rewritten in place stays cached as immutable in a browser that already fetched it; on a Windows-hosted server, replacing a file while it streams fails with an error.
- **No heap snapshot** was taken for Stage A; the evidence is the absence of asset reads in the network log.
- **Best-case hardware, synthetic data.** All figures except Stage C's are one i9-13900KF (`MC-003`, `MC-010`) with synthetic assets (`MC-131`); Stage C's are single runs on one Note 9, debug build, with synthetic fixtures (`MC-198` (a)).
- **Inlays still do not reach the `.bin` backup or the Node server** (CHORE-114; `MC-226` 3).
- **The web stage** (a service worker over the stored files) was not built; it waits for CHORE-108 (`MC-226` 2).
- **The 200 MB per-asset policy limit** (`MC-187`) was not changed; `MC-225` 3 said it can rise once display and piece-by-piece saving both land. Whether it rises is not decided in these records items.

## 10. Maintainer decisions and open questions

Maintainer decisions are `MC-226` (the design answers), `MC-227` (go-aheads and approvals), `MC-228` (the CI fix and `key.txt`), `MC-229` (the Android video ticket) and `MC-230` (wait for wry). The compatibility invariant (`MC-175`) is untouched by this work: neither stage changes a storage or save format.

TODO(evidence) list for this report: the Stage A follow-up run's tokens (row 1318); any review of `f42cdad9` (section 7); the fact-check figures (ledger rows 1330, 1333 and 1334).
