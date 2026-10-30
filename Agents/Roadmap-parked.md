# Roadmap: parked tickets (2026-10-24)

Tickets the maintainer parked on 2026-10-24 (`MC-501`, `MC-504`; CHORE-353 by `MC-439`). A parked ticket is not in the open-tickets table of the [Roadmap](Roadmap.md) and is not a release blocker (`MC-501`), but it is not closed: a maintainer decision can bring it back. Entries are moved from the Roadmap with their text unchanged, apart from one dated "PARKED" status line at the top of each. Parking never overrides `MC-175`, `MC-223` or `MC-350`.

CHORE-02, CHORE-107 and CHORE-191 were un-parked on 2026-10-25 (`MC-508`) and are back in the Roadmap, each with a dated status line there. All three were then closed by lane G's batch 3 (merge `b37dc6223`; `MC-550` for CHORE-02) and moved to the closed archive in lane A records batch 14.

The UI-surface tickets that the UI overhaul will redo are to be parked into it (`MC-516`). Which exact tickets move here is not yet decided; the maintainer approves the list group by group (`MC-500`), so nothing is moved in batch 14.

Parked sub-items of tickets that stay open are not moved; they carry a "PARKED" status line in the Roadmap entry:

| Ticket | Parked sub-item | Authority |
|---|---|---|
| CHORE-12 | MOD-5, the module icon editor | `MC-501` group C |
| CHORE-16 | PG-4 remainder (wiki hand-off, custom key and model binding) | `MC-501` group D |
| CHORE-109 | the web stage (service worker over the stored files) | `MC-501` group F |
| CHORE-129 | the web/Node residual (size check before export) | `MC-501` group F |
| CHORE-200 | the Node boot-pass strike for an oversize cold unit | `MC-501` group A |
| Character list rework | S4-6 (arrow-key focus) and list windowing, parked to the UI overhaul | `MC-504` |
| A-lite storage rewrite | stage 5b (clean-up UI, quota path, prompt wording, orphan counter), parked behind CHORE-205's L3 and per-chat work | `MC-504` |

Parked entries follow, in the Roadmap's file order.

### CHORE-49 — The self-hosted Node server does not boot when opened over plain HTTP

**Status (2026-10-24, lane A records batch 10): PARKED (`MC-501`, group A).** Node-only. Can return on a maintainer decision.

**Status (2026-09-30):** filed under `MC-144` from ledger row 485. It is present upstream since
`v2026.3.330`. Not fixed and not scheduled.

- **Observed (scratch production build, headless Chrome 154; ledger row 485):**
  - opening the Node server at a plain-HTTP LAN address stops at "Cannot read properties of undefined
    (reading 'generateKey')" during "Loading Local Save File";
  - no `/api` request is sent;
  - on localhost the app boots to the password prompt (first run and save not run); HTTPS was not
    run.
- **Mechanism (traced):**
  - `AutoStorage` selects `NodeStorage` before any capability test.
  - `NodeStorage` signs every request with a client-generated ES256 key through `crypto.subtle`,
    which a non-secure context lacks.
  - `server.cjs` requires that JWT on `/api/read`, `/api/write`, `/api/remove` and `/api/list`.
  - Upstream `61996dd2` (2026-03-03, "change server.cjs to jwt based approch") introduced this. Before
    it, the client hashed the password through the server, with no client `crypto.subtle`.
- **Who is affected:** users who open the Node server over a LAN IP or VPN without HTTPS. The
  maintainer reports these are most of the "local plain HTTP" group (`MC-143` 1, `MC-002`). From
  source, such deployments should have worked on upstream up to `v2026.2.291` (traced, not run), so
  users migrating from those versions would see the boot error.
- **Constraints for the fix:**
  - it must not weaken authentication on HTTPS or localhost;
  - how much transport security a plain-HTTP deployment may give up is the maintainer's decision;
  - a plain-HTTP origin also lacks Web Locks, OPFS and `crypto.randomUUID`, so any code that the fix
    makes reachable there must not assume them. Memory stage 1's boot pass already archives nothing
    without them (Report 49, D1).
- **Effect on the manual clean-up (Report 50, deferred N4):** without `crypto.subtle`, the clean-up's
  fingerprint of the main file is sampled, so a same-length change in bytes the sample skips goes
  unnoticed. Fixing this ticket makes that residual reachable on the Node server. The Node revision
  gives an exact alternative for that case. The same residual exists today on a static web build
  served over plain HTTP (it boots and saves, ledger row 485), where there is no revision to compare.
- **Also needed by CHORE-109 Stage A (2026-10-07; `MC-226`, Report 61 section 4):** the Node asset route's read token is signed in the browser with `crypto.subtle`, which a plain-HTTP LAN page lacks. The fix for this ticket must also give the asset-read token a signer, or plain-HTTP LAN pages get no benefit from the asset route.

### CHORE-66 — The wiki's plugin pages describe the plugin-list behaviour from before CHORE-64

**Status (2026-10-24, lane A records batch 10): PARKED (`MC-501`, group D).** Can return on a maintainer decision. `docs/wiki` is the maintainer's lane.

**Status (2026-10-02):** open, **not scheduled**. Documentation. `docs/wiki/**` belongs to the Wiki session, so the
maintainer chose to record this as a ticket. The `48f00223` commit message says the pages are not part of that change.
The line numbers are those the Gate 2 reviewer found on 2026-10-02 (ledger row 620); they were re-verified by
`doc-verifier` on 2026-10-02.

- `docs/wiki/Plugin-Docs.md`, around line 82: describes an install by `setDatabase` as one confirmation per plugin,
  with the old rule.
- The same page, around line 126: says `setDatabase()` and `setDatabaseLite()` "have no consent prompt at all". That is
  still true of permission gating, but it is misleading now that plugin-list changes prompt.
- `docs/wiki/Plugin-API-Reference.md`, around lines 88 to 89: says `setDatabaseLite` merges directly and that
  `setDatabase` confirms each new plugin.
- The same page, around line 178: calls `installPlugin` a thin wrapper of the `setDatabase` flow.
- **What the pages need to say:** the rule is `MC-163` 1 to 10 and the `48f00223` commit message. `plugins.md` and
  `risuai.d.ts` already describe the merge as a difference from upstream.
- **Related:** CHORE-64; `MC-163`; the Wiki session's lane (`docs/wiki/**`).

### CHORE-74 — The `.bin` export warns when the backup holds plugin data that upstream will not restore

**Status (2026-10-24, lane A records batch 10): PARKED (`MC-501`, group C).** Can return on a maintainer decision.

**Status (2026-10-20, `MC-322` 1): DEFERRED.** Stage 4b adds no warning; it stays later QOL work (`MC-177`). The earlier status follows.

**Status (2026-10-03):** open, **not scheduled**; **not a release item**: the maintainer said it should not be a release
blocker, because it is upstream behaviour, and that the warning is a later quality-of-life item (`MC-177` 1). This
replaces the Orchestrator's earlier reading of `MC-089` for this ticket. Type: a small UI change. Filed at the
maintainer's decision (`MC-176` 2: "Accept, warn at export"). Priority: LOW (`MC-176` 3).

- **What happens today:** upstream's `.bin` import restores a cold-storage unit only when it is an array or an object with
  a `character` or `message` key (upstream `isColdStorageBackupData`, the Orchestrator verified it in
  `src/ts/process/coldstorageData.ts` at `upstream/main` `f9728b14`). v3 plugin storage values of any other shape are lost
  there, and upstream's confirm calls them items that "could not be linked to a character". The fork's export carries
  them, so it is the fork -> upstream direction that loses them (ledger row 697; RUN, with the real code of both trees on
  a mocked web store). Upstream's own export shows an "incomplete backup" confirm for these units; the fork's export
  shows nothing for them.
- **Why it matters:** the compatibility invariant is a two-way `.bin` round trip (`MC-175`). The maintainer decided the
  loss is upstream's own limit and does not count against the invariant (`MC-176` 1), so the fork cannot remove it. The
  fork can tell the user.
- **Acceptance (the mechanism is non-normative):** when an export includes v3 plugin storage units that upstream would not
  restore, the user is told before or when the export finishes, in plain words: the plugin data will not come back if this
  file is loaded into upstream RisuAI, and it does in this app. The export bytes do not change. The new English string
  goes in with its call site; the translations go to `translator`. Gated as usual (`AGENTS.md` section 4).
- **Not in scope:** upstream's own export losses (B1, non-`.png` assets; B2), device-local stores, and an encrypted `.bin`
  (`MC-081`).
- **Related:** `MC-175`, `MC-176`, `MC-081`; CHORE-55 (the round-trip note under its stage 2b block); ledger row 697.

### CHORE-97 — Browser CORS for the Hugging Face router is unverified; a live check with a real Hugging Face TTS model is owed

**Status (2026-10-24, lane A records batch 10): PARKED (`MC-501`, group D).** Can return on a maintainer decision. Deferred earlier by `MC-221`.

**Status (2026-10-04, side session): DEFERRED by the maintainer (`MC-221`)**, like the native-speaker review (`MC-212`):
there is no working Hugging Face key. It stays open and unscheduled until one is available.

**Status (2026-10-03, UI session):** open, **not scheduled**. Type: verification.

- **What is unverified:** the new Huggingface request goes to `https://router.huggingface.co/hf-inference/models/${model}`
  from the browser. That `huggingface.js` builds this URL and returns a raw audio Blob is read from its source (ledger row
  835). Whether the router sends CORS headers that allow the call from a browser page, and whether any real model answers
  with audio there, has not been tested. All TTS tests mock the network.
- **What the ticket asks:** a live check by the maintainer with a real Hugging Face TTS model and key.
- **Related:** CHORE-15 TTS-1 and TTS-2; `MC-204` 1.

### CHORE-104 — The "kept file" message

**Status (2026-10-24, lane A records batch 10): PARKED (`MC-501`, group C).** Can return on a maintainer decision.

**Status (2026-10-06): open, not scheduled.** The records items list a "kept-file message" follow-up of the importer and hashing work without detail (TODO(evidence): the intended wording and where it shows are not in the evidence). Possibly the `backupFailedFileKept` text of `bc631526`.

### CHORE-105 — A Node chunked upload endpoint (optional)

**Status (2026-10-24, lane A records batch 10): PARKED (`MC-501`, group A).** Node-only and optional. Can return on a maintainer decision.

**Status (2026-10-06): open, optional, any time (`MC-225` 3).** Node-hosted imports keep the 100 MiB per-asset limit and have no chunk endpoint; `1e71c45c`'s message notes there is no chunk endpoint yet (CHORE-108). Whether Rust moves the bytes is decided after live numbers (`MC-225` 3).

### CHORE-108 — The web stage of piece saving

**Status (2026-10-24, lane A records batch 10): PARKED (`MC-501`, group F).** Can return on a maintainer decision.

**Status (2026-10-06): open, not scheduled** (`MC-225` 5: desktop and Android first, "web next stage"). On web and Node an asset is still read and saved whole (`1e71c45c`'s message: "Web and Node otherwise behave as before"); CHORE-105 is the Node endpoint.

### CHORE-135 — Sidebar Stage 4: the panel does not follow the finger

**Status (2026-10-30, lane A records batch 22): PARKED; CLOSES WHEN UI-S1 SHIPS (proposed disposition, `MC-892`).** The chat spec `docs/design/chat/SLICE1_SPEC.md` section 4 (lines 112 to 119: "Sidebar that follows the finger", a transform-based panel) replaces the old CSS-keyframe design; the verifier confirmed the spec lines (`%TEMP%\risu-b715\ui-audit\verify-inventories.md`, item 1). Nothing is implemented, so the ticket is not closed today. The backdrop half is also in the spec (line 115).

**Status (2026-10-24, lane A records batch 10): PARKED (`MC-501`, group C).** Can return on a maintainer decision.

**Status (2026-10-08): open; not scheduled.** Type: feature remainder. Stage 4 chose "Triggers now, follow later" (`MC-250` 6): the swipe triggers open and close, and a finger-following animation was left for later (Maybe-Later QOL-07 (c) remainder).

- **Note (scratch plan notes `sidebar-s4\plan-stage4.md`, session scratch):** the open and close animation is CSS keyframes on the panel's width, and the close waits for `animationend`; a finger-following version needs a transform-based panel, a `dragging` state and a store flip on release, and `animationSpeed` 0 needs an immediate path. Backdrop: see CHORE-136. These are the Stage 4 packet's reading, not re-traced for this entry.

### CHORE-140 — Rail: Home leaves 12 px hidden; verify smooth scroll-to-active into a closed folder

**Status (2026-10-30, lane A records batch 22): MOOT when UI-S1 ships (proposed disposition, `MC-892`).** `docs/design/chat/SLICE2_SPEC.md:46` replaces the avatar rail with a recent-characters strip (four or five avatars) plus "모든 캐릭터" linking to the Home library, so the rail-only problem disappears; the verifier confirmed the spec line (`%TEMP%\risu-b715\ui-audit\verify-inventories.md`, item 1). Nothing is implemented yet, so the ticket is not closed today.

**Status (2026-10-24, lane A records batch 10): PARKED (`MC-501`, group C).** Can return on a maintainer decision.

**Status (2026-10-08): open.** Type: verification and bug, low. Stage 3 accepted that Home leaves 12 px hidden (`MC-249`). Scroll-to-active into a closed folder was fixed for instant jumps by Stage 5 amendment 2 (restore errors at or under 0.5 px on the Note 9); the smooth (near) case is uncovered and needs a check.

### CHORE-150 — A custom page colour near middle grey may give low button contrast on Android 15+

**Status (2026-10-30, lane A records batch 22): STAYS PARKED; re-check when UI-S0 adds the `nexus` colour-scheme preset (proposed, `MC-892`).** Per the ticket inventory (`ui-audit\tickets\result.md`, AI-authored, not independently verified for this row) `docs/design/system-surfaces/android/SPEC.md` covers notifications only, so the preset's new page colours would be the first change to the inputs of this problem.

**Status (2026-10-24, lane A records batch 10): PARKED (`MC-501`, group D).** Can return on a maintainer decision.

**Status (2026-10-09): known limit; not tested.** Type: limitation, Android API 35 and above (`MC-253`).

- The navigation-bar rule uses the existing luminance split (0.179) to decide whether the scheme is light. The API 35 three-button icons are `#45464F` and `#C5C6D0`, not black and white, so a page colour just above the split in day mode gives about 2:1 against `#45464F` (Gate 1 amendment round 1 finding 7). The shipped schemes tested (`#282A36`, `#FFFFFF`, `#1A1A1A`) are far from the split. A custom colour near it was not tested.

### CHORE-151 — Untested limits of the Android bar and keyboard handling

**Status (2026-10-24, lane A records batch 10): PARKED (`MC-501`, group D).** Can return on a maintainer decision.

**Status (2026-10-09): open; not tested.** Type: verification (`MC-253`).

- The soft keyboard on API 30 to 34 (the only branch that uses the native IME inset without enforced edge-to-edge; source-reasoned only).
- The bars on Android 16 and above.
- 3-button behaviour on large screens with a persistent taskbar.
- Also not covered by device pass 2: the keyboard in gesture navigation (3-button only), a real finger (adb strokes only), and Note 9 day-mode bars (night mode left as found).

### CHORE-160 — Cancelling the export save dialog shows "Error: Failed"

**Status (2026-10-24, lane A records batch 10): PARKED (`MC-501`, group C).** Can return on a maintainer decision.

**Status (2026-10-09): open; observation; not compared with the earlier build.** Type: observation (error message on cancel), Android.

- **Observed (session scratch `device\note9\report.md`, Phase B smoke, Note 9, device pass 1):** the export chooser opens (`CREATE_DOCUMENT`); pressing Back shows an alert "Error: Failed"; the app stays responsive. The report notes "arm A not compared", so it is not known whether build A (`890f5f20`) does the same. The emulator pass did not run the cancel ("lorebook export succeeded, no save dialog, cancel NOT RUN").
- **Not established:** the code path that raises the message. TODO(evidence).

### CHORE-171 — A long plain-text List description clips its third line mid-glyph, with "Show more" directly under it

**Status (2026-10-30, lane A records batch 22): FOLDS INTO UI-S4 (`MC-892` answer 1).** The character library is part of UI-S4 Home; the library list view is designed there, so this ticket is re-checked against it. Still parked until UI-S4 is sized.

**Status (2026-10-24, lane A records batch 10): PARKED (`MC-501`, group C).** Can return on a maintainer decision.

**Status (2026-10-10): open; cosmetic; not planned.** Type: visual defect (Stage 1c).

- **Observed (`charlist\note9-2a.md` item 3; screenshot `46-media-row.png`, Card 0006):** in a List row with long plain text the clamp cuts the third line in the middle, and the toggle sits directly under the cut.
- **Cause as the coder recorded it (`stage1c-report.md`, "Clamp choice"):** the clamp is `max-h-18` (4.5rem, three 1.5rem lines) with `overflow-hidden` rather than `line-clamp`, because `line-clamp` over block children is unreliable across engines; the consequence stated there is "no ellipsis, and the last line can be cut mid-line".

### CHORE-172 — Trash tab flings show 13 to 17% janky frames on the Note 9

**Status (2026-10-30, lane A records batch 22): FOLDS INTO UI-S4, with 30-day retention (`MC-892` answers 1 and 5).** Home's Trash is designed (`docs/design/DECISIONS.md` DD-214, line 1275, aligned with Settings' 최근 삭제), but its list mounting model is not; the fling numbers below are a perf input for UI-S4 sizing. The maintainer fixed Trash retention at 30 days everywhere (DD-214 / S2-4), implemented in UI-S4; this replaces the 3-day boot purge this entry names. Still parked until UI-S4 is sized.

**Status (2026-10-24, lane A records batch 10): PARKED (`MC-501`, group D).** Can return on a maintainer decision.

**Status (2026-10-10): open; observation; cause UNCERTAIN; needs a larger trash to settle; not planned.** Type: performance, Android.

- **Observed (`charlist\note9-2a.md` check 3 and item 2):** Trash tab 17.05% janky over 475 frames (down) and 13.05% over 590 frames (up), p90 17 to 19 ms, against 3.9 to 5.3% in the other windowed lists; 7 to 12 rows with markdown and avatar thumbnails resolving on first mount. The sample is small (125 trashed rows, not 1000) and the cause is UNCERTAIN.
- **Needed:** a Trash with about 1000 rows on the phone (also listed as not observed in 2a and 2b), with recent trash times (the app purges trash older than 3 days at boot; `note9-2a.md` item 4).

### CHORE-173 — A zoom or font-scale change that does not resize the scroller is not picked up until the next resize

**Status (2026-10-30, lane A records batch 22): FOLDS INTO UI-S4 (`MC-892` answer 1).** The library scroller is designed in UI-S4. Still parked until UI-S4 is sized.

**Status (2026-10-24, lane A records batch 10): PARKED (`MC-501`, group C).** Can return on a maintainer decision.

**Status (2026-10-10): open; low; not planned.** Type: suspected defect (Stage 2b grid), found in the r3 review.

- **Source:** the records brief of 2026-10-10 names it as the r3 review's finding 3 (low). The review text is not in the sources given. TODO(evidence).
- **Mechanism as far as the sources show (inference):** `stage2b-report.md` r3 D1 says the rem probe result is cached in `measuredRemPx` and "re-measured only at bind and on a size report of the scroller", so a change of the effective 1 rem that leaves the scroller's size unchanged is not seen until the next size report. Not tested.

### CHORE-175 — On a versioned (Node) store, a put that lands but whose response throws leaves `writeAcknowledged` in a loud stuck conflict until reload

**Status (2026-10-24, lane A records batch 10): PARKED (`MC-501`, group A).** Node-only. Can return on a maintainer decision.

**Status (2026-10-10): open; usability limitation, not data loss; recorded with the unload stage 1b-0 closeout; not planned.** Type: limitation (Node storage).

- **Observed (the Orchestrator's follow-up record `archdefault\records-followup.md`; the 1b-0 review text is not saved):** on a versioned store (the Node server), a put that reaches the server but whose response throws leaves `writeAcknowledged` in a stuck conflict: it is loud (the save is refused as a conflict), not silent, and it lasts until the page is reloaded. No data loss is recorded.
- **Related, from the pre-1b verification and plan section G3:** the stage 1b-0 rule covers the delete outcomes of cleanup; G3 describes the 'conflict' outcome as matching `writeAcknowledged`'s throw handling (null bytes, version kept). That this put path is outside the 1b-0 rule is an inference from reading those records, not tested.
- **Not established:** a reproduction, the exact trigger and any repair. TODO(evidence).

### CHORE-41 — Bug: the edit button on earlier messages sometimes opens no editor

**Status (2026-10-25, lane A records batch 12): PARKED (`MC-540` 3).** The maintainer answered "Not seen lately" to lane G; lane G did not work it. Low priority (`MC-199` 1). Can return on a maintainer decision or report.

**Status (2026-10-24, lane A records batch 10):** open; assigned to lane G's parity batch with CHORE-45 and CHORE-178 (`MC-503`). The premise in `MC-199` 1 (revisit after the Android Tauri build works) may now be satisfied (MVP installed, `MC-475`); the revisit still waits for the maintainer's report.

**Status (2026-10-06, Main Campaign): open, LOW PRIORITY (`MC-199` 1).** The maintainer now thinks it may not be a fault in this app: a WebView that simply stopped responding because everything else was overloading the browser on the 36 GB upstream profile. It is revisited only on their report, after the Android Tauri build works fully; no reproduction attempt is queued. Android's logcat captures the WebView console (`Tauri/Console`), which can be used if it recurs there.

**Status (2026-10-04, side session): still open.** The hand-off listed it in Batch B; the maintainer chose not to take it in
the side session ("Skip CHORE-41", `MC-219` 3). Nothing changed. It is still blocked on the console output below.

**Status (2026-09-26):** filed from the maintainer's bug report (`MC-090`) and two follow-up
investigations, ledger rows 201, 202 and 206. Not fixed. Blocked on the maintainer's console
output (below).

- **Mechanism found (TRACED, ledger row 201, RUN on upstream `main` and this fork's HEAD):**
  `Chats.svelte` does not render messages with `{#each}`; it mounts one `Chat` per visible message
  by hand, keyed by a 32-bit hash of the message's `data`, `chatId`, index, portrait flag,
  `disabled` and `ReloadChatPointer[index]`. `editMode` is plain local `$state` in `Chat.svelte`.
  Whenever that hash changes for the message being edited, the instance is unmounted and
  remounted, silently dropping the open editor with no error and a normal-looking button. This is
  present in both upstream and this fork. The maintainer's supplied plugins (ledger row 202) were
  ruled out as the trigger — none indexes messages or bumps the pointer that changes the hash.
- **Still open: why the button stays dead across repeated clicks, not just once.** Ledger row 206
  found a likely cause — a synchronous error thrown while building the `{#if editMode}` branch is
  caught by nothing: there is no `<svelte:boundary>` anywhere in `src/`, upstream or this fork, so
  the throw aborts that message's flush and every retry on a stable trigger replays it. The throw
  site itself is not found. **Needs the maintainer's console output** at the moment of a failed
  click, and whether the pencil icon flashes blue on the failed open.
- **The report's build:** upstream's hosted site, risuai.xyz, on a roughly 36 GB `.bin` save
  (`MC-090`); all data stored locally, no account sync. Whether the same triggers occur at this
  fork's likely scale is unconfirmed.

### CHORE-179 — Phone-browser Back closes neither the sidebar nor Grid edit mode

**Status (2026-10-30, lane A records batch 22): STAYS PARKED; the Back mechanism is decided at UI-S4 sizing (`MC-892` answer 3).** One mechanism for all new screens and Android is one of that batch's questions. A recorded tension: `docs/design/DECISIONS.md` DD-207 (line 1268) has Home's hub and Trash push history entries, while `MC-278` item 4 (below) chose the app-level Back hook over history entries for the Android sidebar and edit mode and declined "Both now via browser history". The verifier read this as a mechanism tension, not a reopened declined alternative, because DD-207 is a different surface (`%TEMP%\risu-b715\ui-audit\verify-inventories.md`, item 2).

**Status (2026-10-25, lane A records batch 12): PARKED (`MC-505`).** The maintainer chose "180 + 352, park 179", which returns it from lane A's Android Back batch to parked. Can return on a maintainer decision.

**Status (2026-10-24, lane A records batch 10):** open; in the Android Back batch (`MC-501`, group F), which follows batch T.

**Status (2026-10-11): open; not planned; the browser half of the S4-2 Back decision (`MC-278` 4, D2).** Type: limitation (browser Back).

- **Decision (`MC-278` 4):** "Android app now, browser ticket (Recommended)": S4-2 hooks edit mode into the Android app's existing Back question (`window.__risuTaniumBack`, asked by `MainActivity`), not into browser history. The declined alternative was "Both now via browser history" (a history step while editing, which the question said has several timing pitfalls and adds history entries for the whole app).
- **Inferred, not run:** the question put to the maintainer states that in a phone browser Back is the browser's own navigation and does not close the sidebar today. `charlist\back-mechanism.md` (an `investigator` trace, not independently verified) read from source that only `MainActivity` asks the page Back hook, so a browser never asks it. Nothing was run in a phone browser. TODO(evidence).
- **Related, accepted limitation R5 (`charlist\s4-2b-change1-report.md`):** where a history entry exists, a second Back may go back in history.
- **Not decided:** the mechanism for browsers.

### CHORE-353 — The write-scope guard refuses only the Edit and Write tools, so a shell write can change a repository file outside its grant (MC-457 1)

**Status (2026-10-25, lane A records batch 13): PARKED (`MC-439`, `MC-457` 1).** Lane C's batch Q sized it and the maintainer chose "Keep rules, record facts (Recommended)": no tooling change, the interim rules stay, and the sizing facts go to the ticket. The Roadmap listed it in the open table until this batch; it moves here because `MC-439` says it stays parked. Can return on a maintainer decision, and `MC-457` 1 revisits it if a similar shell write recurs.

**Folded in from lane C's records (merge `4fb1e3cbb`), 2026-10-25, lane A records batch 13.**

**Status (2026-10-24, lane C cloud batch Q): sized; stays parked (`MC-439`, `MC-457` 1); no tooling change.** Rows 3341 and 3342.

- **Corrected premise (EXECUTED and TRACED; rechecked by the orchestrator, row 3342):** in the Linux cloud container the guard does not run at all. There is no `pwsh` or `powershell`. The hooks in `.claude/settings.json` are PowerShell (`guard-write.ps1` requires 7.0), and `Get-GuardPath` in `write-guard-common.ps1` accepts only Windows drive paths. So cloud lanes work on the written rules alone. On Windows the one write hook is `PreToolUse` with matcher `Write|Edit`; every agent profile, read-only roles included, also holds a shell tool. `docs/workflow/ownership.md` already states that the hook is not a filesystem sandbox.
- **Options sized (scratch `q\c353\result.md`):**
  - (a) A before/after tree comparison on shell calls can only flag, not undo. Cost: about 15 ms for `git ls-files -m -o` plus hashing the changed files on this tree; Windows cost UNVERIFIED. It cannot catch a file changed and restored inside one command, which is the shape of the incident that raised this ticket (rows 3558 and 3559).
  - (b) One worktree per coder contains a stray write rather than preventing it, and replaces the single-writer rule.
  - (c) Per-grant read-only file attributes are the only real prevention, and the largest design.
  - (d) The interim rules, already in force.
- **For lane A:** the guard configuration assumes `C:\Projects\RisuAI` and PowerShell 7, so a cloud coder's grant is doctrine only. Revisit if a similar shell write recurs (`MC-457` 1).

**Status (2026-10-24, lane A records batch 10):** open; in batch Q with CHORE-240 and CHORE-185, run by lane C (cloud).

**Status (2026-10-22, lane A): open, ticketed, not scheduled (`MC-457` 1).** The maintainer: "let's ticket this for now and revisit this if similar things happen again." Source: lane E's CHORE-181 Gate 2 remediation (ledger row 3558). The coder ran its mutants by text-replacing worktree files with PowerShell and restoring them, including `alertPrompts.ts`, which was outside its grant; the write guard did not refuse it. Lane E's hash check found that file equal to the reviewed copy (row 3559).

- The interim rules stand: no temporary repository edits by any tool, mutants on scratch copies only, and a hash check after any "restored" hand-back.
- Deferred, not made now: (a) a hook that compares the working tree before and after each shell command and flags writes outside the grant; (b) one worktree per coder. Revisit both if a similar shell write recurs.

## Parked into the UI overhaul (2026-10-25, lane A records batch 14; `MC-517`, `MC-516`)

The maintainer parked CHORE-154, 155, 170, 177, 05 and 111 into the UI overhaul in the decision sweep ("Chat render: 154, 155", "Grid/list: 170, 177", "Wording: 05, 111"). CHORE-351, 68 and 92 were offered and NOT parked; they stay open in the Roadmap. CHORE-05's entry is about 480 lines and stays in the [Roadmap](Roadmap.md) with its PARKED line (not moved byte for byte); the other five are moved below with their text unchanged.

- **CHORE-05 — Translation coverage: much of the UI is English-only.** PARKED (`MC-517`, `MC-516`); the entry stays in the Roadmap; its table row was removed. See its PARKED line there. Not a release blocker (`MC-501`); can return on a maintainer decision. **Batch 22 (2026-10-30):** proposed to fold into UI-S1 to UI-S4, each surface shipping its strings through the translator (`MC-058`, `MC-892`); see the Roadmap entry.

**Batch 22 (2026-10-30, `MC-890`, `MC-892`, `MC-893`):** the UI overhaul now has an epic and stage tickets UI-S0 to UI-S6 in the [Roadmap](Roadmap.md). The dated status lines added below record each parked ticket's proposed disposition; nothing here is closed, and the one change of parking is `MC-893` (CHORE-154 items 1 to 4 unparked).

### CHORE-111 — Native-speaker review of the Stage 1c, `.bin` and importer strings

**Status (2026-10-30, lane A records batch 22): FOLDS INTO UI-S2 (proposed disposition, `MC-892`).** The data-and-backups page (DS-176 to DS-191) rewrites these strings; the review follows the rewritten strings. Still parked.

**Status (2026-10-25, lane A records batch 14): PARKED into the UI overhaul (`MC-517`, `MC-516`).** The overhaul rewrites the strings. Can return on a maintainer decision.

**Status (2026-10-06): open, low priority, the same deferral as CHORE-05 (`MC-212`).** The translators flagged low-confidence wording in the strings added by these changes: the lists in Report 59 section 8 (Stage 1c slices, QOL-06) and the `.bin` speed change (cn and zh-Hant "saved as it is made", vi, de and es "download helper", de "Kaltlager"), the bounded-IPC messages (ko 이(가) and 에셋, es "tú mismo" gender, vi stiffness, cn and zh-Hant, de "Asset") and the importer strings (the de, vi and es asset term; ko 이(가)).

### CHORE-154 — Output-identical cheap fixes in the chat parse pipeline

**Status (2026-10-30, lane A records batch 22): ITEMS 1 TO 4 UNPARKED as standing engine work (`MC-893`, amends `MC-517` for those items); item 5 stays parked into UI-S1.** Items 1 to 4 live in `parser.svelte.ts` and `scripts.ts`, which the chat spec keeps (`docs/design/chat/SLICE4_SPEC.md` keeps the display pipeline), so "the overhaul rebuilds chat rendering" does not hold for them. The open ticket is tracked in the [Roadmap](Roadmap.md) (table row CHORE-154 and the batch 22 section); the item text below stays here unchanged. Item 5 (the `RegexData` OUT-field bump) is re-decided at UI-S3 sizing: no spec text removes its writer.

**Status (2026-10-25, lane A records batch 14): PARKED into the UI overhaul (`MC-517`, `MC-516`).** The overhaul rebuilds chat rendering. Can return on a maintainer decision.

**Status (2026-10-09): open; queued after the windowing items.** Type: performance, low risk by design. Each sub-item needs its own differential test proving the output is unchanged.

1. **CBS fast path (packet F13 and F5).** Skip `risuChatParser` when the text has no `{{`, no `{#` and no `<user>`, `<char>` or `<bot>` (matched case-insensitively). **Two conditions (verification):** the guard must run after the `callStack` check at `parser.svelte.ts:1675-1679` (a reused argument with `callStack` 20 returns "ERROR: Call stack limit reached" even for plain text), and the tag test must be case-insensitive (the parser uses `/gi` at `:1704`; "Hi <USER>" would differ under a case-sensitive guard). The caller that benefits most is `executeScript` (`scripts.ts:470-472`), which re-parses after every plain regex script whether or not it matched; do not skip on "the regex did not match". **Executed by the verifier:** a differential test over 102,599 random brace-free inputs, with the real parser lines extracted and the matchers stubbed to throw: 0 differences, 0 matcher calls (`verify_fastpath.ts`, session scratch; the inputs were brace-free, so inputs with `{` that is not `{{`/`{#` were not covered by that run). Model cost on the i9: 0.007, 0.023, 0.096 ms per pass at 1, 5, 20 KB; per message with 150 scripts and 5 KB the packet's loop model gives 3.9 ms (a lower bound for brace-free text).
2. **Memoize the CSS decode and build the selector processor once per call (F4).** `decodeStyleContent` (`parser.svelte.ts:1008-1032`) decodes, CBS-parses, CSS-parses and stringifies the style of every message on every parse, and `:974` builds a new selector processor inside the selector loop. Memoize by the post-CBS CSS text, successes only, with the `returnCSSError` fallback outside the cache; do not deduplicate the per-message `<style>` elements (that would change the DOM and cascade order). Model cost: 0.52, 1.85, 7.6 ms per decode at 10, 50, 200 rules.
3. **`getClosestMatch` caching (F9 as corrected).** Neither successes nor misses are cached for the looked-up name: it writes `assetPaths[closest]` under the real asset's key (`parser.svelte.ts:657-660`), never under the queried name. A cache keyed by character id and name, cleared in `resetAssetsCache`, gives identical output while assets are unchanged. Model cost per missed name: 0.18, 0.79, 2.98 ms at 50, 300, 1000 assets. Coordinate with CHORE-157 (the same lines).
4. **Dynamic-asset setup before the match scan (F8).** With `dynamicAssets` and `dynamicAssetsEditDisplay` on, `scripts.ts:525-564` builds a `HypaProcesser` and adds every asset name (one awaited IndexedDB read each, then an O(n^2) filter) before checking whether any tag needs fuzzy resolution. It also runs for `editoutput`, so per streamed chunk under mode `'off'` (verification). Move the setup after the match scan; the output is unchanged when no tag needs resolution.
5. **Every keystroke in a regex OUT field bumps `ReloadGUIPointer` (N4).** `RegexData.svelte:130-131` (the `onInput` of the OUT field) re-parses the whole window and wipes the script cache on each keystroke; the comment and type fields bump at `:114` and `:118`. Related to CHORE-155.

### CHORE-155 — The full chat re-renders on every `ReloadGUIPointer` bump

**Status (2026-10-30, lane A records batch 22): STAYS PARKED; becomes an explicit UI-S1 acceptance criterion (proposed disposition, `MC-892`).** The consumer side is replaced by `docs/design/chat/SLICE4_SPEC.md` (a stream tick touches only the streaming message, line 87); the writer side is only partly replaced (the sidebar and chat-list writers go with the chat spec, the `RegexData` and `ModuleSettings` writers belong to UI-S3, the engine writers in `modules.ts`, `scriptings.ts`, `triggers.ts` and `changeChatTo` are untouched). The UI-S1 plan needs a stated rule for how a bump reaches the mounted messages without remounting. Related: CHORE-556 (merged `becdc37f9`) fixed the blank chat body while modules load; its Note 9 check covered that case only (0 content-to-empty transitions in 5 of 5 runs; other bump writers were not covered).

**Status (2026-10-25, lane A records batch 14): PARKED into the UI overhaul (`MC-517`, `MC-516`).** The overhaul rebuilds chat rendering. Can return on a maintainer decision.

**Status (2026-10-09): open; queued after the windowing items; builds on CHORE-04 and Report 19** (`Agents/Reports/19-chat-list-window-plan.md`, sections 2.4 and 9.4 already list several bump sources).

- **Mechanism (verified, with the correction):** each `Chat` subscribes to `ReloadGUIPointer` (`Chat.svelte:744-746`) and re-runs its display parse, and the pointer is in the `{#key}` at `Chat.svelte:1026/:1042`, so one bump remounts every windowed `ChatBody`. The packet's "no parse/render cache anywhere" is wrong (`processScriptCache` exists, `scripts.ts:185-200, 264-270`), but each bump also calls `resetScriptCache()` and `ReloadChatPointer.set({})` (`stores.svelte.ts:188-191`), so the window re-parse is a guaranteed script-cache miss and `Chats`' effect re-runs.
- **Writers (verification, non-test, COMPLETE: 20 sites in 8 files):** `SideChatList.svelte` 144, 160, 217, 241, 317, 337, 416, 471; `ModuleChatMenu.svelte` 95, 109; `ModuleSettings.svelte` 39, 45; `RegexData.svelte` 114, 118, 131; `globalApi.svelte.ts` 4229 (`changeChatTo`); `modules.ts` 786; `scriptings.ts` 449; `triggers.ts` 2575, 3010 (fires only when a value actually changes). `ChatList.svelte` imports the pointer but never writes it.
- **Packet's smallest correction (not separately verified):** memoize only the pure tail (markdown plus sanitize, keyed by the exact input string and the settings it reads); a full `ParseMarkdown` cache is not safe (Lua, triggers, variables and random make it impure).
- **Lower-priority related costs, listed here by the writer's choice** (F11 and F10 follow the bump; F6 and F7 are triggered by re-parses and effect runs, not only by bumps, so they are listed as separate lower-priority sub-items and are not claimed to be bump costs; each fix carries medium equivalence risk per the packet):
  - F11: `BackgroundDom.svelte:15-19` re-parses the background and recreates its DOM (animations, video, audio) on every bump.
  - F10: the `customHTML` theme parses the theme HTML per message (`Chat.svelte:759-768, 1555`); a theme `<style>` becomes one `<style>` per message. Cost not measured.
  - F6: on any re-parse of a live `ChatBody`, the `{#await}` pending branch sanitizes and injects the previous result, then the resolved branch does it again (`ChatBody.svelte:279-283`; Svelte 5.56.8 destroys and recreates the branch). Animated assets may restart (inferred).
  - F7: every `Chats` effect run hashes every windowed message's text and forces a layout (`Chats.svelte:83-85, 104-113, 189-197, 212-214`). Model: 0.11 ms (30 x 1 KB) to 4.3 ms (600 x 5 KB) per run.

### CHORE-170 — Grid fling long tasks of up to 153 to 227 ms on the Note 9; try a smaller grid overscan after profiling

**Status (2026-10-30, lane A records batch 22): STAYS PARKED; Grid mounting and windowing are designed at UI-S4 sizing (`MC-892` answer 1).** The character library is part of UI-S4 Home (this supersedes DD-001's "not scheduled yet" line, `docs/design/DECISIONS.md:15`). No spec text states a library mounting model.

**Status (2026-10-25, lane A records batch 14): PARKED into the UI overhaul (`MC-517`, `MC-516`).** List windowing is already parked to the overhaul (`MC-504`). Can return on a maintainer decision.

**Status (2026-10-10): open; observation with a partial attribution; not planned.** Type: performance, Android (Note 9; the i9 desktop says nothing about this).

- **Observed (`charlist\note9-2b.md` D3 and the r3 recheck):** during 72 Grid flings the page recorded 83 long tasks, 16 of at least 100 ms, max 153 ms (the 2a List: 13 tasks, max 77 ms); after r3 59 tasks, 16 of at least 100 ms, max 155 ms. One DevTools trace of six flings (tracing overhead included): 17 main-thread tasks of at least 50 ms, 5 of at least 100 ms, max 227 ms; within those 17 tasks Commit was 22% and UpdateLayoutTree 22% of exclusive time, script 19%, and the three next-longest tasks (112 to 116 ms) were 49 to 88% Commit.
- **Reading (the perf-analyzer's, not independently verified):** the long tasks are mostly the browser's style recalculation and compositor commit after about 140 tile elements (about 28 rows of 5 at an overscan of one viewport each side) are inserted, with Svelte component creation about a fifth and one GC-heavy task. Blank frames were 0 of 8,207 by DOM measurement.
- **Proposal (the coder's, untested):** profile one fling first; if mounting dominates, try about 0.5 viewport of overscan for the grid only, accepting more blank edge at fast flings. `stage2b-report.md` "Overscan" says not to change it blind.

### CHORE-177 — Grid fling jank with every folder open on the Note 9 (the scroller's layer height; the browser re-fetches CSS background images when tiles are re-created)

**Status (2026-10-30, lane A records batch 22): STAYS PARKED; designed with the library at UI-S4 sizing (`MC-892` answer 1).** The compositor-layer finding below applies to any tall single scroller, so it carries to the new library as a design input.

**Status (2026-10-25, lane A records batch 14): PARKED into the UI overhaul (`MC-517`, `MC-516`).** Its earlier plan was to revisit it with the list-windowing work, which is parked to the overhaul (`MC-504`). Can return on a maintainer decision.

**Status (2026-10-10): open; not planned; to be revisited with the list-windowing perf work (the maintainer's "Ticket it, move on (Recommended)", `MC-275` 4).** Type: performance observation (Grid, Stage 3b).

- **Observed (MEASURED on the Note 9, SM-N960N, API 29, WebView Chrome 153, 1000 synthetic characters with 50 folders; `charlist\note9-3b.md` P4, `charlist\f2-trace.md`, `charlist\note9-3b34.md`):** with every folder open (919 tiles, 14,242 px) the instrumented pass measured 10.65% janky frames (718 of 6,741); the bare protocol (`adb` swipes, no page code during the flings) read 15 to 33% per run. Closed (325 tiles, 4,160 px) read 1.48% and with only the 150-member folder open (475 tiles, 6,153 px) 1.34%. In the trace, runs over 10% janky with a p50 under 10 ms ("moderate") occurred in 0 of 16 closed, 0 of 12 one-folder-open, 5 of 12 (600 tiles), 6 of 12 (750 tiles) and 28 of 43 all-open runs. A run is eight flings, so the "28 of 43 flings" and "0 of 12" in the question put to the maintainer count runs. The device also showed a separate "slow mode" (p50 10 ms or more, 38 to 57% janky) in some runs of every state; those runs are not in the moderate counts. After the avatar cache change (`c8a99472`) a 10-run re-measure gave all open 10.04% pooled (5 of 10 runs over 10%), one folder open 2.81% and closed 1.12% (`note9-3b34.md`); the S4-2 pass measured all open with edit mode off at 14.22% pooled, 5 of 10 runs over 10% (`note9-s4-2.md`). Ten runs per state cannot separate these figures from the earlier ones.
- **Mechanism, INFERRED and not proven (the trace report is not independently verified):** main-thread work per fling was the same open and closed; the lost time is in the compositor pipeline stage `SubmitToReceiveCompositorFrame` (17 to 18 ms at p90 in a bad run against 2.9 to 3.4 ms in a good run of the same content); tile-manager and GPU-thread pressure grows with the scroller's composited layer (941 x 37,386 device px open against 941 x 10,920 closed; "violates memory policy" tile events 2 to 32 closed, all open 191 to 198 (one folder open 35, 600 tiles 106, 750 tiles 150)). The trace measured these not to be the cause: page script, style recalculation, layout, row paint, the section tint, row churn, folder-picture tiles, layer count, `scrollTop` writes and avatar image churn (the jank stays with images hidden). It establishes no smallest correction.
- **Fold in (INFERRED, `note9-3b34.md`):** after the avatar cache change the app's own lookups are gone (0 late style writes against 652 to 904 per pass before), yet the browser still fetches the CSS background images again when tiles are re-created (about 730 requests per swipe run, 630 distinct, all open; css-initiated; closed about 2). The reading is Blink's image resource cache dropping the images, not shown; the request count before the change was not re-measured on a base build.
- **Evidence (session scratch, not in the repository):** `charlist\f2-trace.md`, `charlist\device-3b\f2\`, `charlist\note9-3b34.md`, `charlist\device-3b34\f2\`. TODO(evidence): copy the selected artifacts into `Agents/Evidence/CHORE-177/` with a README if they are to outlive the scratch directory.
- **Not established:** the cause, any fix, and whether a Pi 3 or a mid-range phone shows it. *(Records batch 15, 2026-10-27, `MC-690`: the Pi 3 is the floor for Node hosting only; for a frontend symptom like this one the realistic floor is the Note 9.)*

## Parked idea without a ticket (2026-10-27, lane A records batch 17; `MC-771`)

- **Remove tab parking (multi-session), a long-term idea, no ticket.** PARKED (`MC-771` 1). The maintainer was asked whether multi-session would be cheaper to implement along with the UI overhaul or could be parked and revisited later; the sizing answer was "Not now", and the decision followed (`MC-771`). Lane A's analysis is INFERRED, not independently verified: three layers, namely a per-entity save merge on compare-and-set loss, a live refresh of peer changes into other tabs' `DBState` (the costly one), and same-entity conflict rules; a single-writer lock would cover one browser only, not Node cross-device use. Revisit with the UI overhaul's screen-state rule (`MC-771` 2) and its engine-change list. Can return on a maintainer decision.
