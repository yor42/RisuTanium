# Roadmap: parked tickets (2026-10-24)

Tickets the maintainer parked on 2026-10-24 (`MC-501`, `MC-504`). A parked ticket is not in the open-tickets table of the [Roadmap](Roadmap.md) and is not a release blocker (`MC-501`), but it is not closed: a maintainer decision can bring it back. Entries are moved from the Roadmap with their text unchanged, apart from one dated "PARKED" status line at the top of each. Parking never overrides `MC-175`, `MC-223` or `MC-350`.

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

### CHORE-02 — `toSave.chat` is dead plumbing in the encoder

**Status (2026-10-24, lane A records batch 10): PARKED (`MC-501`, group D).** Can return on a maintainer decision. If the plumbing is ever touched, the change needs `opus-reviewer` (save-adjacent).

`grep -n "toSave.chat\|RisuSaveType.CHAT" src/ts/storage/risuSave.ts` returns **nothing**. The
field is populated (`dbChangeEffects.svelte.ts:80-85`) and merged back on failed saves
(`globalApi.svelte.ts:620-623`), but the encoder never reads it to decide anything — chats persist
inside the whole-character `CHARACTER_WITH_CHAT` block, gated solely by `toSave.character`.

Consequence: leftover/aspirational plumbing for a per-chat granularity that was never wired up.
**Useful corollary: a CHORE-01 fix needs no parallel per-chat work.** Decide whether to wire it up
or delete it; do not leave it looking load-bearing. Low risk either way, but deleting it touches
`toSaveType`, so treat it as save-adjacent.

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

### CHORE-107 — `openWriter` belongs inside the `try`

**Status (2026-10-24, lane A records batch 10): PARKED (`MC-501`, group D).** Can return on a maintainer decision.

**Status (2026-10-06): open, not scheduled.** A follow-up named in the records items as "O2 openWriter inside the try" from the piece-by-piece hashing work (TODO(evidence): the file and the failure it prevents are not in the evidence).

### CHORE-108 — The web stage of piece saving

**Status (2026-10-24, lane A records batch 10): PARKED (`MC-501`, group F).** Can return on a maintainer decision.

**Status (2026-10-06): open, not scheduled** (`MC-225` 5: desktop and Android first, "web next stage"). On web and Node an asset is still read and saved whole (`1e71c45c`'s message: "Web and Node otherwise behave as before"); CHORE-105 is the Node endpoint.

### CHORE-135 — Sidebar Stage 4: the panel does not follow the finger

**Status (2026-10-24, lane A records batch 10): PARKED (`MC-501`, group C).** Can return on a maintainer decision.

**Status (2026-10-08): open; not scheduled.** Type: feature remainder. Stage 4 chose "Triggers now, follow later" (`MC-250` 6): the swipe triggers open and close, and a finger-following animation was left for later (Maybe-Later QOL-07 (c) remainder).

- **Note (scratch plan notes `sidebar-s4\plan-stage4.md`, session scratch):** the open and close animation is CSS keyframes on the panel's width, and the close waits for `animationend`; a finger-following version needs a transform-based panel, a `dragging` state and a store flip on release, and `animationSpeed` 0 needs an immediate path. Backdrop: see CHORE-136. These are the Stage 4 packet's reading, not re-traced for this entry.

### CHORE-140 — Rail: Home leaves 12 px hidden; verify smooth scroll-to-active into a closed folder

**Status (2026-10-24, lane A records batch 10): PARKED (`MC-501`, group C).** Can return on a maintainer decision.

**Status (2026-10-08): open.** Type: verification and bug, low. Stage 3 accepted that Home leaves 12 px hidden (`MC-249`). Scroll-to-active into a closed folder was fixed for instant jumps by Stage 5 amendment 2 (restore errors at or under 0.5 px on the Note 9); the smooth (near) case is uncovered and needs a check.

### CHORE-150 — A custom page colour near middle grey may give low button contrast on Android 15+

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

**Status (2026-10-24, lane A records batch 10): PARKED (`MC-501`, group C).** Can return on a maintainer decision.

**Status (2026-10-10): open; cosmetic; not planned.** Type: visual defect (Stage 1c).

- **Observed (`charlist\note9-2a.md` item 3; screenshot `46-media-row.png`, Card 0006):** in a List row with long plain text the clamp cuts the third line in the middle, and the toggle sits directly under the cut.
- **Cause as the coder recorded it (`stage1c-report.md`, "Clamp choice"):** the clamp is `max-h-18` (4.5rem, three 1.5rem lines) with `overflow-hidden` rather than `line-clamp`, because `line-clamp` over block children is unreliable across engines; the consequence stated there is "no ellipsis, and the last line can be cut mid-line".

### CHORE-172 — Trash tab flings show 13 to 17% janky frames on the Note 9

**Status (2026-10-24, lane A records batch 10): PARKED (`MC-501`, group D).** Can return on a maintainer decision.

**Status (2026-10-10): open; observation; cause UNCERTAIN; needs a larger trash to settle; not planned.** Type: performance, Android.

- **Observed (`charlist\note9-2a.md` check 3 and item 2):** Trash tab 17.05% janky over 475 frames (down) and 13.05% over 590 frames (up), p90 17 to 19 ms, against 3.9 to 5.3% in the other windowed lists; 7 to 12 rows with markdown and avatar thumbnails resolving on first mount. The sample is small (125 trashed rows, not 1000) and the cause is UNCERTAIN.
- **Needed:** a Trash with about 1000 rows on the phone (also listed as not observed in 2a and 2b), with recent trash times (the app purges trash older than 3 days at boot; `note9-2a.md` item 4).

### CHORE-173 — A zoom or font-scale change that does not resize the scroller is not picked up until the next resize

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

### CHORE-191 — English `chatParseFailed` now ends with a trailing ", "

**Status (2026-10-24, lane A records batch 10): PARKED (`MC-501`, group D).** Can return on a maintainer decision.

**Status (2026-10-21, upstream `61d0eb79a` merge close): open, not scheduled.** Cosmetic. Source: U0 Gate 2 finding O2. The chat parse-error alert now shows the stack once (the stack block of the alert), so the stack slot of `language.errors.chatParseFailed` is empty and the English text ends with ", ". Fixing it changes the key in all 7 locales (the translator owns the non-English files).

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

**Status (2026-10-25, lane A records batch 12): PARKED (`MC-505`).** The maintainer chose "180 + 352, park 179", which returns it from lane A's Android Back batch to parked. Can return on a maintainer decision.

**Status (2026-10-24, lane A records batch 10):** open; in the Android Back batch (`MC-501`, group F), which follows batch T.

**Status (2026-10-11): open; not planned; the browser half of the S4-2 Back decision (`MC-278` 4, D2).** Type: limitation (browser Back).

- **Decision (`MC-278` 4):** "Android app now, browser ticket (Recommended)": S4-2 hooks edit mode into the Android app's existing Back question (`window.__risuTaniumBack`, asked by `MainActivity`), not into browser history. The declined alternative was "Both now via browser history" (a history step while editing, which the question said has several timing pitfalls and adds history entries for the whole app).
- **Inferred, not run:** the question put to the maintainer states that in a phone browser Back is the browser's own navigation and does not close the sidebar today. `charlist\back-mechanism.md` (an `investigator` trace, not independently verified) read from source that only `MainActivity` asks the page Back hook, so a browser never asks it. Nothing was run in a phone browser. TODO(evidence).
- **Related, accepted limitation R5 (`charlist\s4-2b-change1-report.md`):** where a history entry exists, a second Back may go back in history.
- **Not decided:** the mechanism for browsers.
