# Live State

**This file is REWRITTEN each session, not appended to.** It holds only the current state. Do not
treat it as a log or history.
- For durable doctrine and constraints, see `Agents/Phase2-Handoff.md`.
- For what finished stages leave for later ones, see `Agents/Carry-Forward.md`.
- For the document index, see `Agents/README.md`.
- For maintainer decisions and context, see `Agents/Maintainer-Context.md`.

**Read this first after a context compaction.**

## Session date

2026-10-02.

## Branch and commit state

The branch is `fix/persistence-conflict-platform-hardening`. **It is pushed through `48f00223`** (`git status -sb` showed
the branch in step with its remote-tracking ref on 2026-10-02; the repository is now yor42/RisuTanium, `MC-164`).
The commits below were local when they were listed, and were pushed with it:
- `d25a02fb`: CHORE-47's fix;
- `bb3f9e7b`: CHORE-47's records;
- `ccf45c53`: the chat-switch memory fix;
- `211e7603`: the records of the memory stage 1 plan, its gates and the real-profile findings;
- `2b3dd636`: memory stage 1 step 1, the exclusive manual clean-up (Report 50);
- `bc09a9a1`: the step 1 records and the Roadmap's Phase 2 status note;
- `db49aeeb`: memory stage 1 step 2, the v2 stub and the shared restore (Report 51);
- `d199b07b`: the step 2 records;
- `64f23154`: the manual clean-up reads saves that never used plugin storage (the empty-`pluginStorage` decoder fix);
- `96772e97`: the stage 1 live-check records and CHORE-50;
- `bd57aa19`: memory stage 1 step 3a, plugin and MCP reads and writes of
  archived characters (Report 52);
- `0e054956`: the step 3a records and `MC-146`;
- `1b38b5d5`: memory stage 1 step 3b, groups, the Playground's restore, the dataset export, the
  asset-integrity check and the plugin documentation (Report 53);
- `b4942db4`: the step 3b records;
- `08e43e65`: CHORE-16 PG-1, every character list skips the Playground and `§temp` characters
  (Report 54);
- `10ce39a7`: the PG-1 records;
- `6ad13bac` and `449b10e3`: the Wiki session's commits (the Playground page; then plain Markdown
  links for Emotion Images and Return to Home, by its commit subject);
- `a6719e35`: memory stage 1 step 4, the backup carries every unit it needs and plugin storage of any
  shape (Report 55);
- `129e5a14`: the step 4 records;
- `5f1ecdf9`: every agent profile gets the `PowerShell` tool and a Shell section (the Git Bash `Bash`
  tool fails on every call in this environment, even after an app restart);
- `33545c2c`: memory stage 1 step 5a (the 10-day archiving and the plugin-storage migration are gone,
  the `archiveCharacters` setting, the restore trash rule);
- `1327bcde`: Report 37, the chat HTML and CSS security surface, written by the read-only Q&A session
  and committed at the maintainer's request (no `doc-verifier` pass has run on it);
- `756e8210`: the step 5a records, CHORE-52 and CHORE-53 (`MC-148` to `MC-150`, ledger rows 521-526);
- `448962f4`: memory stage 1 step 5b, Load Internal Backup writes the snapshot as the main save and
  reloads, instead of installing it in memory;
- `57235222`: the records of the reroll bugs, CHORE-54 to CHORE-58, `MC-151` and QOL-04 to QOL-09 (by its
  commit subject);
- `712a76ad`: the CI and Docker rework (`MC-154`; ledger rows 536 and 537). The release step's legal flag now
  reads the opt-in repository variable `VITE_RISU_LEGAL_CONFIGURED`, as `docker-build.yml` does (`MC-155`;
  replaced by `a6a27df5`);
- `38583d3b`: the desktop updater disable (`MC-154` 7; ledger rows 538 and 539);
- `9361ce1b`: the README rewrite for this fork, `MC-152` to `MC-155`, CHORE-59 and CHORE-60 (by its commit
  subject);
- `9b312962`: memory stage 1 step 5c, the boot archive pass (below);
- `696ba5de`: the fork's own Terms of Service and Privacy Policy linked from Settings (`MC-156`);
- `b84ae444`: the maintainer's own Terms of Service and Privacy Policy added to `docs/` (by its commit subject);
- `435a8723`: the records of step 5c, the Settings legal links, `MC-156` and ledger rows 541 to 550;
- `a6a27df5`: the legal flag on by default in every build (`MC-157`; ledger rows 552 to 554);
- `590c5995`: the wiki pages move from `wiki/` to `docs/wiki/` (ledger rows 555 to 557);
- `8918e309`: the maintainer's "update privacy policy" (`docs/Privacy-Policy.md`, by its commit subject);
- `9d41751b`: "docs(agents): point wiki references at docs/wiki/" (by its commit subject; not made by this
  session, most likely by the Wiki session after the maintainer told it about the move; every commit here carries
  the maintainer's git identity);
- `e8cf50de`: memory stage 1 step 5d-1, a character that cannot be archived is skipped, a save the archive
  cannot commit is refused, and a Node commit stays under the server's limit (`MC-158`; ledger rows 558 to 565);
- `fe7c3d1d`: "docs(agents): record MC-157 and MC-158, CHORE-61, step 5d-1 and ledger rows 551 to 569" (by its commit
  subject);
- `29bf2f24`: memory stage 1 step 5d-2a, the startup archive pass pauses on this device after two failed passes in a
  row (`MC-158` 1; ledger rows 569 to 574);
- `4d23b1b4`: memory stage 1 step 5d-2b, V2.1 plugins are turned off after the restore of every archived character
  dies twice in a row (`MC-158` 5; ledger rows 575 to 581);
- `3fca470e`: memory stage 1 step 5d-3, characters that upstream archived are filled in at startup even with
  archiving off (`MC-148`, `MC-158` 3; ledger rows 582 to 587);
- `e7d7f093`: memory stage 1 step 5d-4, an archived character or chat that cannot be read on this page, or whose copy
  may be damaged, gets its own message, and the README's two-device sentence (`MC-159`; ledger rows 588 to 596);
- `7cf6ac27`: "docs(agents): record MC-159, CHORE-62, steps 5d-2a to 5d-4 and ledger rows 570 to 599" (by its commit
  subject);
- `a7956237`: Report 56, the step 5 report;
- `197ed08b`: "docs(agents): record MC-160, CHORE-63 and ledger rows 600 to 605" (by its commit subject);
- `07ea1882`: CHORE-53 stage 53c, the chat message delete and its three-choice question (`MC-161`; ledger rows 611
  and 612);
- `98d13e7f`, `63860dfe` and `c9326b67`: the rebranding session's identity commits (by their commit subjects),
  merged below;
- `1ba98d45`: CHORE-53 stage 53a, keys and focus cannot reach the page behind a dialog that covers it (`MC-161`; ledger
  rows 607 to 609 and 614);
- `5747a7e1`: CHORE-53 stage 53b, a delete that asks first removes the entry that was clicked, or nothing (`MC-161`;
  ledger rows 610 and 613);
- `cfa4dfa0`: the merge of `chore/risutanium-identity` (CHORE-60 identity; `MC-162`);
- `8197f093`: "docs(agents): record MC-161, MC-162, CHORE-53 closed, CHORE-64 and ledger rows 606 to 617" (by its commit
  subject);
- `d722edea`: the maintainer's own "Update Privacy Policy and ToS" (by its commit subject);
- `82776b3b` and `94d7be86`: the Rebranding session's leftovers and logo assets, merged as `e768ef75` (CHORE-60;
  `MC-164`);
- `e9b70b8d`: the README names the fork Risutanium and shows its logo (CHORE-60);
- `33cafe18`: `docs/branding/`, the maintainer's logo sources and exports (`MC-164`);
- `4a7ed14d`: the maintainer's own repository URL update in the ToS and Privacy Policy (by its commit subject);
- `b745fc29`: the fork's links point at yor42/RisuTanium (`MC-164`);
- `48f00223`: CHORE-64, a write to the plugin list through `setDatabase` or `setDatabaseLite` never deletes plugins,
  and updates keep saved settings (`MC-163`; ledger rows 618 to 622). The commit title says "a plugin's write to the
  plugin list never deletes plugins", which is broader than its scope; the commit is pushed and not amended. The V2.1
  proxy route is CHORE-65;
- the records commit that follows `48f00223` and carries this file (MC-163, MC-164, CHORE-64 closed, CHORE-65 and CHORE-66, ledger rows 618 to 622);
- `d013e7cf`: CHORE-63 stage A and CHORE-40, the copy button writes the message text inside the tap and fetches
  nothing (`MC-165`; ledger rows 623 to 626). Local, not pushed;
- the records commit that follows `d013e7cf` and carries this file (MC-165, CHORE-40 closed, CHORE-63 stage A, CHORE-65
  low priority, ledger rows 623 to 626; `5a1fbf52`, by its commit subject);
- `7ca8f2a9`: CHORE-63 stage B, "Copy as card" in the message menu, built without fetching outside hosts (`MC-166`;
  ledger rows 627 to 632). Local, not pushed;
- the records commit that follows `7ca8f2a9` and carries this file (MC-166, CHORE-63 closed, CHORE-67, CHORE-68 and
  CHORE-69, ledger rows 627 to 632; `94fbdfd5`, by its commit subject). Local, not pushed;
- `71e75d9d`: CHORE-43 with CHORE-54, each chat keeps its own reroll history and edits are kept (`MC-168`, `MC-169`;
  ledger rows 634 and 637 to 641). Local, not pushed;
- the records commit that follows `71e75d9d` and carries this file (`MC-167` to `MC-169`, CHORE-43 and CHORE-54 closed,
  CHORE-55's scope rewritten, CHORE-70, ledger rows 633 to 641; `67e0aa31`, by its commit subject). Local, not pushed;
- `59881788`: CHORE-51 with CHORE-52, the cold-storage clean-up keeps archives that archived chats link, and a key that
  cannot be a file name is never read as missing (`MC-170`; ledger rows 642 to 657). Local, not pushed;
- the records commit that follows `59881788` and carries this file (`MC-170`, CHORE-51 and CHORE-52 closed, CHORE-71 to
  CHORE-73, ledger rows 642 to 657). Local, not pushed.

The commits since `1ce8abff` (`d013e7cf`, `5a1fbf52`, `7ca8f2a9`, `94fbdfd5`, `71e75d9d`, `67e0aa31` and `59881788`) are local
and not pushed (`git status -sb` showed the branch 7 commits ahead of `origin` on 2026-10-02, before the records commit
above); the records commit above will be local too.

`712a76ad` and `38583d3b` were committed at the maintainer's approval ("commit the finished side works.");
`9361ce1b` and `9b312962` at "commit the docs for now, and then 5c when ready."; `696ba5de` at "commit it, then
do the records."; `435a8723` at "commit the docs and start step 5d."; `a6a27df5` and `590c5995` at "commit it";
`e8cf50de` at "commit part 1, then start the part 2"; `fe7c3d1d` at "go ahead and commit the docs."; `29bf2f24` at
"commit part 2a and continue part 2b."; `4d23b1b4` at "commit part 2b, and start part 3"; `3fca470e` at "commit part
3 and start part 4"; `e7d7f093` at "commit part 4 and the records when ready"; the three CHORE-53 stages at "commit each
stage when ready." and the merge at "Merge after CHORE-53 commits (Recommended)" (`MC-161` 7 and 8) (the session log's quotes). The commits from `8197f093` on:
- `8197f093` at "add the maintainer decisions to the records when you commit".
- The merge `e768ef75` and the README `e9b70b8d` at "yes, let's merge the rebranding." That answered a question proposing the merge and the README commit.
- `33cafe18` at "commit the branding folder too, and push too if its safe to do so, as readme is public facing."
- `b745fc29` and `48f00223` were committed by the Orchestrator after their review gates, without a separate commit instruction. The maintainer then asked for each to be pushed: "push the link change for now, we can push chore 64 and other tasks separately." and "1. yes, push."
- `d013e7cf` at "commit stage A. and defer live check until we finish stage B." (`MC-165` 8).
- The records commit after `d013e7cf` under the standing instruction "add the maintainer decisions to the records when you commit" (`MC-161` 9).
- `7ca8f2a9` at "let's commit now and do live check after that." (`MC-166` 3).
- The records commit after `7ca8f2a9` under the same standing instruction (`MC-161` 9).
- `71e75d9d` at "looks good to me. go ahead and commit." (quoted in `MC-169`).
- The records commit after `71e75d9d` at "commit docs when ready, then pause so I can compact to clear up the context."
- `59881788` and the records commit after it at "Commit both (Recommended)", the maintainer's answer to the commit question
  (Q6, `MC-170` 7): one code commit with the fact-checked message, then a records commit. Nothing is pushed.
- The records commit `abdcef97` at "2. do the records". Push only at the maintainer's request. Everything through `48f00223`
is pushed (the local remote-tracking ref, 2026-10-02; it was `0a3fb2b0` on 2026-10-01).

The working tree holds only this records batch's edits to the `Agents/` documents (until they are committed). Report 56
(`Agents/Reports/56-memory-stage-1-step-5-boot-archive-pass.md`) is fact-checked and committed as `a7956237`.
`docs/` is tracked and holds the maintainer's own Terms of Service and Privacy Policy, which they write and commit
themselves, so a commit touching those two files is theirs (`MC-156`); agents do not edit them (`MC-155` 4). The
wiki pages are in `docs/wiki/`, the Wiki session's lane.

## Parallel sessions (2026-09-30)

Several sessions work **in this same checkout**:
- **"Main Campaign"** (this one) owns everything outside `docs/wiki/`, including the `Agents/` records.
- **"Wiki"** owns `docs/wiki/**` only. It writes nothing to `Agents/`; its findings, suspected bugs and
  questions go to the maintainer in its final report.
- **"Q&A"** is read-only. Its memory-footprint brief started the memory stages (`MC-130`), and it
  handed over the maintainer's real-profile measurement (ledger row 470).
- **"Fix Escape leaving a blocking alert unanswered"**, **"Fix Fullscreen setting error on web
  build"** and **"Fork rebranding exploration"** are idle or done; see Report 39/41 and ledger
  row 428.

**Next free numbers:** `MC-171` (`MC-170` is used), Report 57 (Report 56 is used), ledger row 658 and CHORE-74
(`CHORE-73` is used). Check the ledger's last row before taking one. `MC-114` and ledger rows 371-374 were reserved for W2c-a and left unused; nobody
should fill them.

**Rules for every session:**
- stage by explicit path only;
- never `git add -A`, `stash`, `reset`, `checkout -- <path>` or `restore` on another session's files;
- commit and push only at the maintainer's request.

## Current work

### Resume here (hand-off, 2026-10-02, memory stage 1: steps 1, 2, 3a, 3b, 4, 5a, 5b, 5c, 5d-1, 5d-2a, 5d-2b, 5d-3 and 5d-4 done)

1. **Memory-footprint stage 1 is planned and passed Gate 1** (Report 49, `MC-130` to `MC-145`,
   ledger rows 455-486). **Step 1 is done:** the exclusive manual clean-up (D11) and no startup asset
   sweep once a stub exists (D12), committed as `2b3dd636` (Report 50; Gate 2 approved at round 3,
   ledger rows 487-491). **Step 2 is done:** the v2 stub and the shared restore (D6, D7, D9 restore
   side), committed as `db49aeeb` (Report 51; Gate 2 approved at round 2, then one editorial
   round, ledger rows 494-497). **Step 3a is done:** plugin and MCP reads and writes of archived
   characters (the seam that reads a stub's unit as a copy, no-downgrade in the plugin setters, restore
   first in V3 `setChatToIndex` and the seven MCP write tools, the V2.1 restore-all in `loadPlugins`,
   and the two `MC-091` amendments), committed as the step 3a fix commit (`bd57aa19`; Report 52;
   Gate 2 by `opus-reviewer` approved at round 3 after two [REJECT] rounds, ledger rows 505-507;
   `MC-146`). **Step 3b is done:** groups (selecting a group restores its archived members, `addGroupChar`,
   `createNewChat`, and a group turn passes over a member that cannot be restored), the Playground's
   restore, `exportAsDataset`, `verifyAssetIntegrity` and the plugin documentation for `getDatabase` and
   the character and chat API, committed as the step 3b fix commit (`1b38b5d5`; Report 53; Gate 2 by
   `adversarial-reviewer`: round 1 [REJECT], rounds 2 and 3 [APPROVE], ledger rows 510-512; the
   plugin-docs fact-check is row 509). No live check of 3a or 3b was run. **Step 4 is done:** both local
   backups carry every unit the database they write refers to (chat and character archives that other
   archives point at, units named by the legacy "could not be loaded" error text, and V3 plugin storage of
   any shape, restored by a fork restore), with the character named in the prompt, no retained parsed
   `value`, and units first referenced during the asset copy carried too; committed as the step 4 fix
   commit (`a6719e35`; Report 55; Gate 1 by `adversarial-reviewer`, round 1 [REJECT], round 2
   [EDITORIAL], ledger row 518; Gate 2 by `opus-reviewer`, round 1 [REJECT], round 2 [EDITORIAL], row 519;
   the investigation is row 517 and the records fact-check row 520; `MC-147`). No live check was run.
   **Steps 5a, 5b, 5c, 5d-1, 5d-2a, 5d-2b, 5d-3 and 5d-4 are done** (`33545c2c`, `448962f4`, `9b312962`, `e8cf50de`,
   `29bf2f24`, `4d23b1b4`, `3fca470e`, `e7d7f093`; item 2). Steps 6 and 7 have no code yet.
   **CHORE-16 PG-1 is done:** every character-list view (the grid, the mobile list, the group-member
   picker and the previous/next hotkeys; the sidebar's order already skipped both when `checkCharOrder`
   adds ids) skips `§playground` and `§temp`, and opening the Playground clears its `trashTime` and marks
   the character for save (defence in depth); committed as the PG-1 fix commit (`08e43e65`; Report 54;
   Gate 2 by `adversarial-reviewer`, rounds 1 and 2 both `[EDITORIAL]`, corrections applied; ledger rows
   514-516: the survey, Gate 2, the records fact-check). No live check was run. PG-2, PG-3 and PG-4 stay
   open.
   - **Live check of steps 1 and 2 (ledger row 499):** the manual clean-up refused on a profile whose
     `pluginStorage` block is empty (row 500; upstream writes the same empty block). The decoder fix
     and its red-first tests are committed as `64f23154`. The fix passed its `opus-reviewer` gate
     (`[EDITORIAL]`, corrections applied; row 502) and was re-checked live on a scratch Node
     server; the manual clean-up then completed. CHORE-50
     (the first run of a new Node server fails until a reload) was filed from the same session.
   - The round-5 verdict was `[EDITORIAL]`. Its corrections were applied to the plan by the
     Orchestrator and not re-verified; Report 49's section 3 marks what was added after Gate 1.
   - Design:
     - characters are archived only by an exclusive boot pass;
     - an opened character stays loaded until the next page load;
     - an automatic idle reload releases what was opened (`MC-140`, `MC-141`);
     - there is no runtime archive engine (ledger row 475).
   - The working copy of the plan is in the session scratchpad (`memfoot/stage1c/plan.md`).
     Report 49 is the durable version.
2. **CHORE-53 is closed (2026-10-02; `07ea1882`, `1ba98d45`, `5747a7e1`; `MC-161`; Roadmap CHORE-53) and the
   rebranding identity is merged (`cfa4dfa0`; `MC-162`). CHORE-63 stage A is done and CHORE-40 is closed (2026-10-02;
   `d013e7cf`, local; `MC-165`; ledger rows 623 to 626). CHORE-63 is closed by stage B, `7ca8f2a9` (2026-10-02, local;
   `MC-166`; ledger rows 627 to 632), and its live check was run in a browser (Roadmap CHORE-63; Android not run).
   Stage C is now CHORE-68, not scheduled. CHORE-43 with CHORE-54 is closed (2026-10-02; `71e75d9d`, local; `MC-168` and
   `MC-169`; ledger rows 634 and 637 to 641; Roadmap CHORE-43 and CHORE-54), and its live check passed in a browser (not
   run: group chats, multi-candidate replies, inline errors, cold chats, auto mode, WebView2, WebKit, Android). The storage
   direction is recorded (`MC-167`; ledger rows 633, 635 and 636): CHORE-55 becomes one storage interface with three
   adapters and no bypasses, OPFS is no longer written and is read through, and the stages in the Roadmap's CHORE-55 entry
   are a planning basis, not a gated plan. CHORE-70 (startup installs a partly decoded save without trying a backup) is
   filed, not scheduled. CHORE-51 with CHORE-52 is closed (2026-10-02; `59881788`, local; `MC-170`; ledger rows 642 to
   657; Roadmap CHORE-51 and CHORE-52): the manual clean-up now follows references inside archived chats, a missing or
   corrupt archived chat is kept and the run carries on, a cold-storage key must be a safe file name, and a plugin save
   over an archive that something else links is refused (the guard reads live memory only). CHORE-71 to CHORE-73 are filed,
   not scheduled. Checks on the final tree, from the commit message: the suite 295 files, 6230 passed, 4 skipped; `pnpm
   check` 0 errors and 0 warnings; `pnpm build` ok. No live check is recorded. Next: CHORE-55 with stage 0 first, then
   CHORE-59, then memory steps 6 and 7, then CHORE-62, then CHORE-58 last** (work order below). **CHORE-64 is closed (2026-10-02; `48f00223`, pushed; `MC-163`; Roadmap CHORE-64; ledger
   rows 618 to 622):** a write to the plugin list through `setDatabase` or `setDatabaseLite` never deletes plugins, and
   updates keep saved settings. A V2.1 plugin can still delete or replace installed plugins through the live
   `getDatabase()` proxy with no prompt; that route is CHORE-65 (DATA LOSS (V2.1 proxy route)).
   Checks on the final tree, from its commit message: the suite 286 files, 5600 passed, 4 skipped; `pnpm check` 0
   errors and 0 warnings; `pnpm build` ok.
   **CHORE-65** (plugins read and change each other's saved arguments; V2.1 plugins edit the list through the live
   proxy; DATA LOSS on the proxy route) and **CHORE-66** (the wiki's plugin pages describe the previous behaviour) are filed from it, not
   scheduled. The repository is now yor42/RisuTanium (`MC-164`). Post-merge checks (check, suite,
   build) on `cfa4dfa0`: EXECUTED by the Orchestrator: `pnpm check` 0 errors and 0 warnings; `pnpm test` 284 files, 5413 passed, 4 skipped;
   `pnpm build` ok with `VITE_RISU_LEGAL_CONFIGURED=TRUE`. (The step 5 report, Report 56, is committed as `a7956237`;
   Report 49 section 3.4, step 5, is done.) Step
   5d was split into sub-steps (5d-1 to 5d-4, with 5d-2 as 5d-2a and 5d-2b), listed under "5d" below.
   - **CHORE-16 PG-1 is done** (Report 54). The Wiki session has committed the Playground page
     (now `docs/wiki/Playground.md`, `6ad13bac`) to match it. The Main Campaign session does not touch `docs/wiki/**`.
   - **A CI/Docker rework and the desktop updater disable are committed** (`712a76ad` and `38583d3b`;
     `MC-154`; ledger rows 536 to 539). The CI/Docker rework passed Gate 2 `[APPROVE]`; the updater disable
     passed `[EDITORIAL]` and its correction is applied. Neither has had a real run: no Docker build, no PR
     Check on GitHub, no desktop build or launch. The first manual run of PR Check is the first evidence that
     the checks are green on Linux. The rest of the release identity is **CHORE-60** (open, not scheduled, a
     release blocker). The maintainer's own Terms of Service and Privacy Policy are committed (`b84ae444`), the
     fork's own links to them are in Settings (`696ba5de`, `MC-156`), and the legal flag is on by default in
     every build from the repository (`a6a27df5`, `MC-157`, which supersedes `MC-155`'s "leave it unset").
     The links open GitHub pages that show GitHub's not-found page until the commits are pushed, so the CHORE-60
     blocker is not fully cleared. CHORE-35's missing upstream-service prompts are a CHORE-60 release condition
     (`MC-157` 4). The `origin/main` mirror that ran upstream's old workflows is
     deleted, with a stale unrelated branch; `origin` holds only this branch (CHORE-60, 2026-10-01).
   - **CHORE-51 is filed** (DATA LOSS; **closed 2026-10-02 by `59881788`**, see the start of this item; this bullet is the
     filing record): the manual clean-up's keep set never reads chat units, so
     a unit named only by error text inside a chat unit is deleted and that chat's Retry then fails. It
     predates step 4. The new pure `listInnerColdStorageKeys` in `coldstorageData.ts` is written so the
     clean-up can reuse it. It is now scheduled after step 5 and before step 6 (work order, 2026-10-01).
     A fix changes the clean-up's read cost and step 1's gated design.
   - **CHORE-52 is filed** (LOW, integrity hardening; **closed 2026-10-02 by `59881788`**; ledger row 521): cold-storage keys are not
     shape-checked before they reach a storage path, on all three backends. No traversal was found; the
     open question is key aliasing, which a shape check does not fix. Scheduled with CHORE-51, after
     step 5.
   - **CHORE-53 is filed** (DATA LOSS; **closed 2026-10-02**, see the start of this item; ledger row 523; `MC-150`): delete actions in several lists
     act on a stale target, and the Enter that answers a confirm also clicks the control behind it. The
     character trash case is fixed on the fork; the open defects are in the Roadmap. It is scheduled right
     after step 5, before CHORE-51 and CHORE-52 (`MC-150` 4).
   - **Step 5's scoping is recorded:** ledger row 522, `MC-148` (enriching upstream stubs) and `MC-149`
     (the four step 5 answers). Step 5 is split into four sub-steps, each with its own gates:
     - **5a, done** (`33545c2c`): the 10-day archiving and the plugin-storage migration are deleted;
       the checkbox binds the new root key `archiveCharacters` (absent and `true` mean on); the
       label and help text are new in all seven languages; at restore the stub's trash state wins for
       every stub (`MC-149` 4). Gate 1 `adversarial-reviewer` [APPROVE]; Gate 2 `opus-reviewer` round 1
       [EDITORIAL], round 2 [APPROVE]. Nothing archived until 5c (`9b312962`). Root `coldstorage` still gates the
       startup asset sweep and remote-block clean-up, with no UI (`MC-149` 2).
     - **5b, done** (`448962f4`): `loadInternalBackup` writes the snapshot and reloads, with
       `LoadLocalBackup`'s other-tab refusal. Gate 1 `adversarial-reviewer` round 1 [REJECT], round 2
       [EDITORIAL] (ledger row 527); Gate 2 `opus-reviewer` round 1 [REJECT], round 2 [APPROVE] (row 530).
     - **5c, done** (`9b312962`): the boot pass (exclusive hold, fenced commit, the one-time notice, the D1
       capability gate, `uuid` unit ids, an optional `enableRemoteSaving` encoder input, no commit when nothing
       changed, no pass on backup-fallback boots). Gate 1 `opus-reviewer`: round 1 `[REJECT]`, round 2
       `[EDITORIAL]` (ledger rows 534 and 535; the plan is `step5/5c/plan.md` in the session scratchpad,
       sections 8 to 10 hold the dispositions). Gate 2 `opus-reviewer`: round 1 `[REJECT]`, round 2
       `[EDITORIAL]` (ledger rows 541 to 544). The corrections: `test-warrior` wrote the B1 and B2 tests and the
       N1, N2 and N6 guards; `sonnet-coder` fixed B1 and the comments E2 to E4; the Orchestrator fixed E1 and N7
       (the commit message) and applied round 2's E5 to E7.
       - **Gate 2 round 1's two blockers:** on web a re-read that threw after a failed commit fell back to an
         automatic backup while the main file was intact (now the boot stops with the error and writes nothing,
         on web and on the Node server alike); the Node server's "a re-read that returns nothing stops the
         boot" rule had no test.
       - **Tests** (from the commit message and `full-test-r2.txt`): 151 new tests in eight files; against a
         placeholder pass module and HEAD's other files, 76 failed on their assertions and 52 guards passed;
         of the tests added during review, four (a web re-read that fails or finds nothing) failed on their
         assertions before the fix and the rest are guards. Full suite 239 files, 4077 passed, 4 skipped;
         `pnpm check` 0 errors and 0 warnings; the build was run. Scratchpad mutants of each gate and failure
         path are killed except two that the commit message names (a throwing variant of the `characters`-array
         gate, and the shared-chaId rule, whose removal costs one orphan unit and no data). **Not run:** Tauri,
         a real Node server, a browser's OPFS and Web Locks; no live check.
       - **The Orchestrator's own 5c calls** (a partial list; the step 5 report records the rest). Reported to
         the maintainer; not maintainer decisions:
         - the one-time notice shows only on a boot where archiving can actually run (a capable host, a
           main-file boot, a complete decode, `formatversion` 5 or higher, no enabled V2.1 plugin, not a stale
           account-sync profile, and `characters` and `botPresets` both arrays), and a boot where it cannot
           leaves the `archiveCharacters` key absent;
         - the exclusive-hold grant timeout is about 1 s (`HOLD_TIMEOUT_MS`, `bootArchivePass.ts:208`) instead
           of the 5 s default (`acquireExclusiveStorageMigrationLock`, `storageTabLocks.ts:283`), so a second
           tab skips the pass rather than waiting;
         - the optional `enableRemoteSaving` input on the save encoder's `init` is an `MC-091` amendment (a
           technical prerequisite for implementing the accepted pass safely: a remote-saving profile has to keep
           its remote blocks before the live database exists), to be recorded in the step 5 report.
       - **Step 6 dependency** (Gate 1 round 2 N5): a pass skipped after an idle reload (the short timeout, or
         another tab holding the lock) releases nothing, so step 6 must observe that the post-reload pass ran
         before it treats the reload as having released memory.
       - The step 5 report is Report 56 (`a7956237`, fact-checked); it records the Orchestrator's own implementation
         calls.
     - **5d, split into four sub-steps on 2026-10-01, and 5d-2 then into 5d-2a and 5d-2b** (the Orchestrator's
       calls, the first on the step 5d investigator's recommendation, ledger row 551, the second on the 5d-2
       investigator's, row 566; each sub-step has its own gates; the maintainer's five answers are `MC-158`, and the two
       for 5d-4 are `MC-159`):
       - **5d-1, done** (`e8cf50de`): a pre-write refusal for the inputs that make the commit fail on every boot
         (a `chaId` equal to one of the seven fixed block names, equal to another slot's after `String`, `__proto__`,
         over 255 UTF-8 bytes or not surviving UTF-8, a non-array `modules`, `plugins` or `loadouts`; an array
         slot is not eligible); skip-and-continue for one unwritable character (`MC-158` 2); the Node size rule
         (Report 49 D1). Gate 1 `opus-reviewer`: round 1 `[REJECT]`, round 2 `[REJECT]`, round 3 `[APPROVE]`
         (ledger row 558). Gate 2 `opus-reviewer`: `[EDITORIAL]`, corrections applied (row 563). Final tree: 248
         files, 4,157 passed, 4 skipped; `pnpm check` 0 errors and 0 warnings; the build was run (the commit
         message). **Not run:** Tauri, a real Node server, a browser's OPFS and Web Locks; no live check.
       - **5d-2a, done** (`29bf2f24`): the D18 pass breaker (`MC-158` 1, "Retry once, then pause"). Before the pass
         writes anything it records a start on this device (`localStorage`); a pass that succeeds clears it; two
         counted in a row pause archiving on this device, with one notice saying that turning "Archive characters at
         startup" off and on resumes it. Gate 1 (`opus-reviewer`): round 1 `[REJECT]` (F1 to F8: one success
         predicate, fail-closed tests, fixes to the red claims, a fixed check order, plus editorial points), round
         2 `[APPROVE]` (ledger row 569). Gate 2 (`opus-reviewer`): `[EDITORIAL]`, 32 of 32 mutants killed (row 574).
         Final tree: 252 files, 4,315 passed, 4 skipped; `pnpm check` 0 errors and 0 warnings; the build was run (the
         commit message). **Not run:** Tauri, a real Node server, a browser's OPFS and Web Locks, a whole-browser
         crash. Known limits (commit message): a pass whose commit reached the server but whose response was lost
         stays counted until a later pass succeeds; a crash within the browser's storage flush delay after the start
         record can lose it. The 5d-2 investigator is ledger row 566.
       - **5d-2b, done** (`4d23b1b4`): the V2.1 restore-all breaker (`MC-158` 5). A count kept on this device is
         raised before the restore reads its first character and reset when the restore ends; at 2 or more, with an
         enabled V2.1 plugin and at least one archived character, the app does not restore, turns every enabled
         V2.1 plugin off, names them in one notice and loads the other plugins. Turning a V2.1 plugin on in the plugin
         settings (the exported `togglePluginEnabled`), or a start with no enabled V2.1 plugin, clears the count. The
         count fails open, unlike the pass's. Gate 1 (`opus-reviewer`): round 1 `[REJECT]` (F1 to F9), round 2
         `[EDITORIAL]` (row 575). Gate 2 (`opus-reviewer`): round 1 `[EDITORIAL]` with 35 of 37 mutants killed, the
         two survivors then killed by one added and one tightened test; round 2 `[EDITORIAL]` (row 580). Final tree:
         254 files, 4,372 passed, 4 skipped; `pnpm check` 0 and 0; the build was run (the commit message). **Not
         run:** Tauri, a real Node server, a browser's OPFS, a real tab kill or out-of-memory. Known limits (commit
         message): the count is per device but the plugin's on/off is in the save, so turning it off reaches every
         device that shares the save; a restore running in another tab can count toward a trip; a page that dies
         after the restore is not counted.
       - **5d-3, done** (`3fca470e`): the `MC-148` enrichment of upstream-made stubs, which now also runs when
         `archiveCharacters` is false (`MC-158` 3). Gate 1 (`opus-reviewer`): rounds 1 and 2 `[REJECT]`, round 3
         `[EDITORIAL]` (row 583); Gate 2 (`opus-reviewer`): rounds 1 and 2 `[EDITORIAL]` (row 586). The 5d-3
         investigator found that the guard test pinning "archiving off writes nothing" in
         `bootArchivePass.gates.test.ts` does not flip (it uses a tree with no stub); the archiving-off row of an
         archiving test table became its own guard test instead (row 582). Final tree: 255 files, 4,660 passed, 4
         skipped; `pnpm check` 0 and 0; the build was run before the comment, string and test-only remediation and
         not re-run after it (the Orchestrator's log). **Not run:** Tauri, a real Node server, a browser's OPFS, a
         real tab kill or out-of-memory. Not measured: the first start that fills something in rewrites the whole
         save (commit message; Report 49 D20 and step 7).
       - **5d-4, done** (`e7d7f093`): the "unavailable" restore wording (`MC-159` 2) and the two-device note
         (`MC-159` 1). The reader keeps its `'error'` status and gains a kind (no storage on this page; a stored copy
         that cannot be decoded), and the restore messages and the chat notices choose their text by it, and a legacy
         chat's Retry button is hidden for both kinds; no consumer that keeps, skips, deletes or counts reads by it.
         Eight new keys in the seven languages. The README's "Saving across tabs and devices" bullet states the
         two-device consequence. Gate 1 (`adversarial-reviewer`): round 1 `[REJECT]`, round 2 `[EDITORIAL]` (row
         589). Gate 2 (`adversarial-reviewer`) round 1 `[EDITORIAL]` (E1 to E7 and O1 to O5; row 595): the red claim
         of 164 failing tests at the parent (109 on behaviour, 55 on missing exports) reproduced, and 47 of 50
         mutants were killed; m29 and m80 survive and m63 is not exercised by any test, and none changes behaviour.
         The remediation (the `test-warrior` and `sonnet-coder` runs, row 596) was checked in round 2,
         `[EDITORIAL]` (N1, N2 and N4 required, N3 optional; all applied). At the parent 162 of the new tests fail:
         107 on behaviour and 55 on missing functions (164, 109 and 55 before the remediation). Final tree: 261
         files, 4,956 passed, 4 skipped; `pnpm check` 0 and 0; the build was run. 14 round-2 mutants: all killed
         except `r2_m63b`, which is equivalent. **Not run:** a real plain-HTTP static build, a browser's Worker
         decode path (Vitest uses fflate's Node build), Firefox private mode, Safari, a real Node server for the
         README sentence. The fact-check of these records is ledger row 598; the records commit follows (the 5d-4
         commit message cites `MC-159`).       - **The Orchestrator's own 5d-1 calls** (not maintainer decisions; the records do not show that each was
         reported to the maintainer):
         - the 5d split into four sub-steps, and 5d-2 into 5d-2a and 5d-2b;
         - the Node limit is the number 104,857,600 bytes, kept in `server/node/bodyLimit.cjs` (which `server.cjs`
           uses for its three body parsers) and copied into the client's host binding, with a test that pins the
           two (no endpoint reports it);
         - the memo of skipped characters and of a too-large save lives in `localStorage` on the device (readable
           before the database is installed) and is written only after its notice has been posted, so a start that
           fails before the notice remembers nothing; turning the setting off, or any start that reads it as off,
           clears it;
         - a refusal of the first kind is silent apart from one console warning, because the user can do nothing in
           the app about a typed or fixed-name `chaId`;
         - no pre-write size prediction (Gate 1 round 1 F4): a too-large commit is caught when it is made, and the
           device memo stops later starts;
         - two failures in a row stop archiving for that start, and neither is remembered (an earlier isolated
           skip in the same start is), because `writeUnit` cannot tell one oversized unit from full storage or a
           dead server (Gate 1 round 1 F2);
         - **accepted limitation (J13):** two unwritable characters next to each other in the eligible order stop
           archiving at that point on every start; whether 5d-2's breaker counts such starts is 5d-2's decision.
       - **The Orchestrator's own 5d-2a, 5d-2b, 5d-3 and 5d-4 calls** (not maintainer decisions; the records do not
         show that each was reported to the maintainer; the first group answers the 5d-1 hand-off above):
         - 5d-2a: a pass counts as failed unless it archived at least one character or did not stop on two failures in
           a row, so a pass that only skipped single characters succeeds, and a stop on two failures that archived
           nothing counts, even if the key alone was committed (plan option (c); commit message); a refused main-file
           write, including a Node 409, and a commit over the Node limit count; a count that cannot be read, or a
           start record that cannot be written or read back, stops the pass for that start without writing (the
           unreadable-`localStorage` policy: fail closed), and a stored count that is not a whole number reads as
           paused; the paused notice is posted last, once, on the start whose own failure made the count two (or on a
           later start that never posted it); the count and the "told" record clear when the setting is turned off or a
           start reads it off, together with the skip and too-large records;
         - 5d-2b: only a restore that dies counts (one that throws does not, so the app opens and the plugin settings
           can be reached); every restore counts, not only the one at a start; the count is cleared by turning a V2.1
           plugin on in the plugin settings or by a start with no enabled V2.1 plugin, not by the switch-off (that
           reaches the save only with the next save); the count fails open (a count that cannot be read or written lets
           the restore run, with a warning), unlike the pass's; its key is separate from the pass's keys. **Disclosed,
           not closed:** the count is per device while the plugin's flag is in the save (Gate 1 round 1 F3, the
           commit message's known limits);
         - 5d-3: the fill-in has its own failure count outside the archive memo (`localStorage` key `stubEnrichStrikes`,
           which the archiving-off clear leaves alone), because that clear would erase an off-profile count at the next
           start (investigator R3); a filled-in placeholder never counts as a successful pass for the archive breaker;
           the fill-in runs before the archiving loop; the archived copy's trash time is never copied to the
           placeholder. **To report to the maintainer:**
           - **a silent stop:** after two failed or interrupted fill-in attempts in a row the fill-in stops on this
             device with a console warning and no notice. Only changing the archiving setting in Settings (either
             way) re-arms it; a setting changed by a restored backup or by another device leaves it stopped (commit
             message);
           - **two new web boot outcomes** that `MC-158` 3's option text did not describe: on the web, a profile with
             archiving off can now stop at start with an error, or fall back to a backup, if a failed fill-in save is
             followed by a save file that cannot be read back (commit message);
           - **English-only progress text:** the loading-screen text of the fill-in is English and avoids the word
             "Archiving" (the 5d-3 plan: no translation of it, by the precedent that the pass's own text is English);
           - on a shared Node save, a fill-in commit moves the save's revision, so another device with the app open
             stops saving on its next save (INFERRED, as in CHORE-62; the commit message calls this "the existing
             conflict prompt", which `MC-159` 3 corrects);
         - 5d-4: the damaged text says the copy "may be damaged" and that nothing was changed or deleted (the legacy-chat
           texts say the visible messages are unaffected instead), and does not say that retrying will not help; the
           no-storage text offers no remedy (opening the page over HTTPS opens a different origin). Both differ from
           `MC-159` 2's option text ("say it needs HTTPS or localhost"; "retrying will not help"). The HTTPS and retry
           points were told to the maintainer in chat while the plan was out for Gate 1 (the reviewer was dispatched at
           20:16:03Z, transcript line 182200; the chat message was sent at 20:16:16Z, line 182205);
           the eight new keys were first mentioned in a chat message at transcript line 182314 (20:28Z: "I drafted the
           English for the eight new messages"), and after the fact-check, at line 182782, the Orchestrator compared 8
           explicitly with the option's "about 4-6". "Damaged" is decided only by an fflate data
           error code in {0, 1, 2, 3, 6} or, at the JSON step only, a `SyntaxError`; a worker that cannot start, an
           out-of-memory error and any other failure stay a plain read error. A failure while merging a retried chat's
           side fields stays a plain error. The seven-language text is the Orchestrator's English plus `translator`'s
           versions.
         - **Told to the maintainer (5d-4):** the key count is 8, not the "about 4-6" in `MC-159` 2's option text. The
           eight were first mentioned at transcript line 182314, and the explicit comparison with "about 4-6" came at
           line 182782, after the fact-check.
       - **Filed from 5d-4:** CHORE-62 (on a Node server, another device's save makes this device stop saving until it
         reloads, and its edits since its last save are lost; `MC-159` 1 and 3). Placed after steps 6 and 7 and before
         CHORE-58; **approved by the maintainer** (`MC-160` 1; see the work order).
       - **Filed from 5d-1's Gate 1:** CHORE-61 (the save encoder silently loses presets, modules or a character
         when a `chaId` equals a fixed block name; observed at encoder level only; not in the work order).
     The plan working copies and gate records are in the session scratchpad (`step5/`); the step 5
     report records the Orchestrator's own implementation calls.
   - **The invariants the 5c tests were to pin** (the tests deleted in 5a pinned them for the old pass). Step
     5c is committed with 151 new tests in eight files; this record did not check each of the nine below against a
     named test (Gate 2 round 1 confirmed the first: a stub is built only from a read-back with status ok and an
     equal `chaId`):
     1. a stub is built from the unit as read back, not from the live character;
     2. a stub is never archived twice;
     3. list order is preserved around an archived slot;
     4. a trashed character or group writes no unit and stays full;
     5. the stub's single placeholder chat has an id;
     6. while any enabled V2.1 plugin exists, no character is archived (V2.0, V3 and disabled V2.1
        plugins do not block);
     7. one malformed character (a group without a member list, a non-string `creatorNotes`) never
        stops the pass;
     8. a pointer chat or legacy error-text chat inside an archived character is carried unchanged;
     9. test on both the Node-server and OPFS in-memory backends; neither says anything about Tauri.
     The two strings that were unused until 5c, `errors.coldStorageWriteFailed` and
     `errors.coldStorageVerifyFailed`, are removed (`9b312962`; no reference left in `src`, Grep 2026-10-01).
   - Step 5 lands before the idle reload (step 6). Step 6 has hang points for a backup-in-progress
     signal: the early `return`s of `SaveLocalBackup` and `SavePartialLocalBackup` and the `finally` of
     `LoadLocalBackup` (Report 55 section 7). Open follow-ups: step 1's in Report 50 section 6, step 2's
     in Report 51 section 6, step 3a's in Report 52 section 6, step 3b's in Report 53 section 6 and step
     4's in Report 55 sections 7 and 8 (among them: whether step 5's pass should enrich
     upstream-made stubs is a question for the maintainer at step 5; step 5 reuses
     `hasEnabledV21Plugin`, owned `loadInternalBackup` (5b: it now writes the main save and reloads), and
     owns the `§` exclusion from archiving).
3. **After stage 1** (`MC-145`):
   - the upstream-compatible inline-everything backup;
   - then archiving of modules that are not enabled;
   - then the rest of stage 2 (streamed backup);
   - stage 3 (the Node streamed write, CHORE-46) is re-measured first.
4. **Scratch tooling that stays useful:**
   - the synthetic generator's `real2` preset reproduces the maintainer's profile (ledger rows 476
     and 477);
   - the retainer measurement harness (rows 471 and 474);
   - the maintainer's read-only probe scripts (`shell-fields.cjs`, `profile-probe.cjs`,
     `chat-split.cjs`).

   All of these live in the session scratchpad, `memfoot/`.

## Work order

1. **Memory stage 1** (Report 49), steps 5-7 (steps 1, 2, 3a, 3b and 4 are done, Reports 50-53 and 55),
   in this order:
   1. memory stage 1 step 5, the boot pass (the scoping is recorded: ledger row 522, `MC-148` and `MC-149`;
      5a, 5b, 5c, 5d-1, 5d-2a, 5d-2b, 5d-3 and 5d-4 are done, `33545c2c`, `448962f4`, `9b312962`, `e8cf50de`,
      `29bf2f24`, `4d23b1b4`, `3fca470e` and `e7d7f093`; the scoping is ledger row 551, `MC-158` and `MC-159`; the
      step 5 report is Report 56, `a7956237`);
   2. then **CHORE-53** (DATA LOSS: delete actions act on a stale target, and Enter clicks the control
      behind a confirm; ledger row 523; `MC-150` 4, the maintainer agreed to this position). **Done 2026-10-02**,
      as `1ba98d45`, `5747a7e1` and `07ea1882` (`MC-161`; ledger rows 606 to 616). Pushed;
   3. **CHORE-63** (copy button reliability: the message copy button can fail silently or paste its own card)
      **with CHORE-40** (the copy button fetches any http(s) URL). The maintainer chose "Right
      after CHORE-53", and the option text says it goes before CHORE-43 and CHORE-54 (`MC-160` 3). The default copy
      is plain text, with the card as a separate "copy as card" action (`MC-160` 3). Ledger row 600; no
      persistence code is touched. **The maintainer split the work (`MC-165` 6):**
      - **stage A is done** (2026-10-02, `d013e7cf`, local): plain copy written inside the tap, the `execCommand`
        fallback, a visible failure, the status text clears, the "..." menu reopens on one tap; it closes CHORE-40;
      - **stage B is done** (2026-10-02, `7ca8f2a9`, local): the "Copy as card" item in the message's "..." menu, with
        the contract the maintainer closed (`MC-165` 1, 2, 4 and 5: a menu item, outside images stay links with no
        fetch, app colours only, hidden text dropped; `MC-166` 1 and 2: a formula as its TeX source, a status that says
        when the card was simplified);
      - **stage C** (embedding the message's own local images with a byte budget) is now **CHORE-68**, open and not
        scheduled (`MC-166` 4);
      - **the live check was run** after stage B (2026-10-02, the maintainer's built-in pane; Roadmap CHORE-63). Not
        covered: an avatar, a plain copy during a pending card, a failure display, Android (Android cannot be run from
        here). **CHORE-63 is closed;**
   4. **CHORE-43** (unreroll can write one chat's reply into another) **with CHORE-54** (rerolling
      or going back through rerolls overwrites an edited reply with its generation-time copy). **Done 2026-10-02**,
      as `71e75d9d` (local; `MC-168` and `MC-169`; ledger rows 634 and 637 to 641; fixed in one change, as the
      Orchestrator recommended);
   5. **CHORE-51** (DATA LOSS) and **CHORE-52** (the unvalidated cold-storage key): **done 2026-10-02**, as `59881788` (local;
      `MC-170`; ledger rows 642 to 657). Then **CHORE-55**
      (rewritten by `MC-167`: one storage interface with three adapters and no bypasses; **stage 0, the atomic Tauri
      write, first**; the later stages are a planning basis and not yet gated) and then **CHORE-59** (Load Internal Backup
      offers to load the intact data of a partly damaged snapshot; `MC-152`; placement is the Orchestrator's choice), each
      its own change with its own gates. **Next: CHORE-55 with stage 0 first.** The maintainer
      asked on 2026-10-01 for CHORE-51 and CHORE-52 to be added to the work order; their position is
      the Orchestrator's choice. Neither depends on step 5 or step 6, and CHORE-51 is DATA LOSS, so it
      should not wait behind the idle reload and the measurements. CHORE-55 goes in this stretch by
      the maintainer's choice (`MC-151` 3, "With CHORE-51/52"), and the maintainer confirmed its place before steps 6 and 7
      and the order CHORE-43/54, then CHORE-51/52, then CHORE-55 with stage 0 first (a summary of `MC-167` 4);
   6. then steps 6 and 7 (they are built on the storage interface once it exists, `MC-167` 4);
   7. then **CHORE-62** (on a Node server, another device's save makes this device stop saving until it reloads, and
      its edits since its last save are lost; `MC-159` 1 and 3). The option text the maintainer selected says only
      "placed later in the work order"; the position after steps 6 and 7 and before CHORE-58 was the Orchestrator's,
      and **the maintainer approved it** (`MC-160` 1: "I approve the chore-62 placement");
   8. then **CHORE-58** (measure first): PNG character import copies its read buffer quadratically on
      large assets (ledger row 532). It is import performance, not data loss, so it goes last; the maintainer
      accepted the Orchestrator's recommended placement (`MC-151` 8). Its first task is a measurement on the
      real module or the live app.
   - **CHORE-16 PG-1 is done** (Report 54, commit `08e43e65`), the small fix the maintainer approved on
     2026-10-01 between step 3b and step 4. Every character-list view skips `§playground` and `§temp`, as
     `checkCharOrder` does, so the Playground's "assistant" character can no longer be opened or deleted
     from the grid or the mobile list. The Wiki session has updated `docs/wiki/Playground.md` (`6ad13bac`, made before the move from `wiki/`). PG-2,
     PG-3 and PG-4 are open.
2. **The inline-everything backup, then module archiving** (`MC-145`).
3. **The wiki's composer and send batch** (Wiki session; unblocked since W2 and W3 are done).
4. **CHORE-35's opt-in stage:** the remaining upstream-infrastructure features (`MC-092`). **It is also a CHORE-60
   release condition** (`MC-157` 4): the legal flag is on by default, so the missing upstream-service prompts must
   close before the first release. The maintainer chose to leave it at this position (`MC-157` 5).

Not placed in the sequence:
- **CHORE-41** (the edit-button bug): blocked on the maintainer's console output.
- **CHORE-45** (the script cache misses on a repeat send in a long chat): filed, not scheduled. It
  waits for the memory work.
- **CHORE-46** (the Node server's 100 MB body limit): re-measure after stage 1 (Report 49).
- **CHORE-48** (inlays are never backed up): waits for the maintainer's answer. The maintainer chose to plan inlays
  under the storage interface, in a later stage, together with it (`MC-167` 7).
- **CHORE-49** (the Node server does not boot over plain HTTP; `MC-144`): filed, not scheduled.
- **CHORE-60** (release identity: the desktop build still carries upstream's identity; the updater part is
  done and committed as `38583d3b`; the rest has no decision): open, not scheduled. It must close before the
  first release (`MC-089`). Its release blockers include the maintainer's own Terms of Service and Privacy
  Policy with the legal flag set: the documents are committed (`b84ae444`), the fork's own links to them are in
  Settings (`696ba5de`; they show GitHub's not-found page until the commits are pushed), and the flag is on by
  default in every build (`a6a27df5`; `MC-157`). **CHORE-35 closing is a release condition under this ticket**
  (`MC-157` 4).
  The 16 inherited upstream pre-releases and their tags were
  deleted by the maintainer on 2026-10-01; `origin` now has no release and no tag. **Progress (2026-10-02):** the
  leftovers and logos are merged (`e768ef75`), the README is done (`e9b70b8d`), and the repository is renamed to
  yor42/RisuTanium with its links updated (`b745fc29`; `MC-164`). One more leftover was relayed to the Rebranding
  session: the sidebar shows "Welcome to RisuAI!" with no character selected. The `isWeb` removal stays pending
  (`MC-162`).
- **CHORE-65** (plugins read and change each other's saved arguments; V2.1 plugins edit the plugin list directly
  through the live `getDatabase` proxy; `MC-163` 4 and 7) and **CHORE-66** (the wiki's plugin pages describe the
  behaviour from before CHORE-64; the Wiki session's lane): filed 2026-10-02, not scheduled. **CHORE-65 is low
  priority** by the maintainer's decision (`MC-165` 3).
- **CHORE-67** (existing tests that run DOMPurify under happy-dom may pass for the wrong reason; happy-dom 20.1.0
  stops DOMPurify after its first removal), **CHORE-68** (CHORE-63 stage C: embed the app's own images in the "Copy as
  card" card) and **CHORE-69** (the plain Copy button copies the thinking section and hidden blocks as raw markup):
  filed 2026-10-02 from CHORE-63 stage B, open, not scheduled (`MC-166` 6, 4 and 5).
- **CHORE-70** (startup installs a save that only partly decodes, without checking whether a backup is complete; the
  CHORE-59 family; decode RUN in ledger row 636): filed 2026-10-02, open, not scheduled (`MC-167` 9).
- **CHORE-71** (the plugin overwrite guard walks every chat in live memory on each in-place plugin `setItem` and keeps a
  proxy for each; about 16 to 70 MB on best-case hardware; LOW; `MC-170` 6), **CHORE-72** (a local backup restore writes an
  entry whose name does not match the cold-storage key pattern to `assets/<name>`; LOW; not traced) and **CHORE-73** (on a
  Windows desktop, a chat whose pointer names a unit in a missing `coldstorage` folder reads "unreadable" instead of
  "missing"; LOW): filed 2026-10-02 from CHORE-51 and CHORE-52, open, not scheduled.
- **CHORE-56** (under the beta mobile layout, a touch that ends on a button, input, select or textarea
  throws a TypeError in the swipe handler): suspected; TRACED, not run. The maintainer has not yet
  confirmed or placed it.
- **CHORE-57** (chat import offers `.txt` but has no `.txt` branch, so a picked `.txt` does nothing and
  says nothing): suspected, from reading; not run. **Low priority**, by the maintainer's decision
  (`MC-151` 7); no position in the order.
- **Follow-ups from the memory work** (Report 49, section 5):
  - switching to a chat whose cold-storage unit is missing still retains the previous chat's
    messages;
  - a rejected avatar image shows no icon.

`MC-089`: nothing ships until every open ticket clears.

## Open follow-ups, waiting on the maintainer

1. **A native-speaker check on the new translations.**
   - The translator suggested one for the German and Vietnamese `restoreNoLockWarningConfirm` (a
     data-loss warning) and the German `{{slot}}` phrasing.
   - For the manual clean-up (step 1), the translator flagged the consent and warning strings in
     every language; the maintainer accepted the Korean strings on 2026-09-30, so the native-speaker
     check remains for cn, zh-Hant, vi, de and es (Report 50 section 6).
   - Step 2 added one string, `coldStorageRestoreUnreadable`, to ko, cn, zh-Hant, vi, de and es. The
     reviewer checked the meaning; the native-speaker check is open for all six (Report 51 section 6).
   - Step 3a added four strings (`coldStorageNamedRestoreFailed`, `coldStorageNamedRestoreUnreadable`,
     `coldStoragePluginRestoreProgress`, `coldStoragePluginRestoreIncomplete`) to the same six
     languages. The reviewer checked the meaning. The translator's low-confidence notes: ko, the
     particle 을(를) after `${characterName}`; cn and zh-Hant, "N items left" (还剩 N 项 / 剩餘 N 項); vi,
     whether "đang được bật" reads as "the plugin is enabled", and "Chúng vẫn ở trạng thái lưu trữ";
     es, the file mixes tú and usted (Report 52 section 6).
   - Step 3b added four strings (`coldStorageGroupMembersNotLoaded`, `coldStorageDatasetExportSkipped`,
     `assetIntegrityReadingArchivedProgress`, `assetIntegrityReportArchivedNotChecked`) to the same six
     languages, with "first message" as the term (the maintainer's call, 2026-10-01). **The maintainer said
     on 2026-10-01 that the new Korean strings look fine.** The native-speaker check is open for cn,
     zh-Hant, vi, de and es. The round-1 reviewer noted that vi "tài sản" and es "activos" read slightly
     like "property" or "financial assets" but match those files' existing asset strings (Report 53
     section 6). The translator's low-confidence notes: ko, the 첫 메시지 wording (the maintainer said the Korean looks fine so far); cn, 初始消息
     (the file's `firstMessage` term) against 问候语 (used for `alternateGreetings`); zh-Hant, 開局訊息 may
     read slightly odd; vi, "nhóm trò chuyện" could read as "chat group" rather than "the group talks",
     and "chưa được kiểm tra tài sản" is clipped; de and es, "spricht" and "habla" are literal; es,
     "activos" in the report line reads stiff.
2. **CHORE-41's console output** (ledger rows 201-202 and 206): why the edit button stays dead across
   repeated clicks.
3. **The MC-091 workflow pilot:** evaluating it is the maintainer's.
4. **CHORE-48:** should a backup carry inlays?
5. **The member picker offers an upstream group placeholder** (pre-existing, found at step 3b's Gate 2
   round 3; Report 53 section 5): the picker lists `char.type !== 'group'`, and an upstream-made group
   placeholder is typed `'character'`, so it is offered, and picking it in `addGroupChar` now restores the
   group and adds it as a member of another group. The reviewer's smallest guard: treat a `ready` result
   of `type` `'group'` like `gone`. What the user should see is the maintainer's call.
6. **Report 48's leads:**
   - odd `risuext` extension names;
   - the "missing" wording;
   - a partial file after an entry of 4 GiB or more.
7. **A native-speaker check on the strings added by step 5c and the Settings legal links** (ko, cn, zh-Hant, vi,
   de, es). Step 5c added `archiveCharactersNotice` and `archiveCharactersStoppedNotice` and removed two unused
   error strings; `696ba5de` added `forkTermsOfService`, `forkPrivacyPolicy` and `forkLegalLinksLabel`. The
   reviewers read the translations as keeping the same meaning as English (Gate 2 round 1 of each, including
   "Nothing is deleted" in the notice). The 5c translator's low-confidence notes: ko uses 보관 (the toggle's existing term) and 기본 저장 데이터 for "main
   save"; de "im Haupt-Speicherstand" reads awkwardly (alternatives "in der Hauptspeicherdatei", "im regulären
   Speicherstand"); cn 主存档 and zh-Hant 主存檔 are unverified guesses; vi "bản lưu chính" is unverified; es "guardado
   principal" is unverified and uses tú, as the file's help.coldstorage does. The legal-links translator's only
   low-confidence string is forkLegalLinksLabel ("Legal documents") in all six languages; the two document names
   reuse each file's upstreamAgreement wording. Step 5d-1 (`e8cf50de`) reworded `archiveCharactersStoppedNotice` and
   added `archiveCharactersSkippedNotice` and `archiveCharactersTooLargeNotice` in all seven languages. The
   maintainer said on 2026-10-01 that the Korean strings look good, which closes the translator's ko particle note
   (을(를)). The translator's remaining low-confidence notes: cn and zh-Hant, "fully loaded" reads as a calque; vi,
   the phrasing of the too-large notice; de, a paraphrase. Gate 2 listed as optional that "These characters" reads
   oddly for one name; the records do not show a change. Step 5d-2a (`29bf2f24`) added `archiveCharactersPausedNotice`
   and step 5d-2b (`4d23b1b4`) added `v21PluginRestoreDisabledNotice`, each in all six languages; the reviewers
   checked the meaning, and the Orchestrator changed the ko "다시 시작하기 전까지는" to "재개하기 전까지는" (ambiguity), the
   de "Bis Sie es fortsetzen" (Gate 2) and the de "unterbrochen" (5d-2b). The 5d-2b translator's
   low-confidence notes are in the session transcript (line 173009; they concern the first-sentence wording that was later
   replaced, ledger row 579): ko "앱 시작이 … 끝나지 않아" is awkward but accurate; ko and zh-Hant "provider of a turned-off
   plugin" (꺼진 플러그인의 제공자, 已關閉外掛之供應商) is slightly formal; the cn clause is long; vi "việc khởi động ứng dụng đã không
   hoàn tất" is the clause it was least sure of; de split the English first sentence into two. **TODO(evidence):** the
   5d-2a translator's notes (`archiveCharactersPausedNotice`) were not found. Step 5d-4 adds eight keys (`e7d7f093`:
   `coldStorageRestoreUnavailable`, `coldStorageRestoreDamaged`, `coldStorageNamedRestoreUnavailable`,
   `coldStorageNamedRestoreDamaged`, `coldStorageChatUnavailable`, `coldStorageChatDamaged`,
   `coldStorageLegacyChatUnavailable`, `coldStorageLegacyChatDamaged`). The translator's low-confidence notes: ko 저장소
   and 보관된 사본; cn 纯 HTTP; zh-Hant 純 HTTP; vi "bộ nhớ"; es "sin cifrar"; de "einfachen". Gate 2 read all six
   translations as keeping "may be damaged" hedged, "nothing was changed", and no retry promise.
8. **Optional: a check of the Korean and Vietnamese strings from CHORE-63.** The Orchestrator offered the maintainer an
   optional review of them; it is the Orchestrator's offer, not a maintainer request. The strings are `copyFailed` (stage A) and `copyAsCard`,
   `copiedAsText` and `copiedSimpleCard` (stage B).
9. **Optional: a check of the Korean and German strings of `coldStorageCleanupChatUnreadable`** (added by `59881788`,
   CHORE-51). Optional, and not a maintainer request. The translator's low-confidence notes: ko, the
   particle chain, where "${source}에 있는 X의 채팅에서 연결된 보관된 채팅" may read better as "…의 채팅이 연결하는 보관된
   채팅"; de, a restructure, where "mit den Chats für X verknüpft" is the phrase to check. The other languages (cn,
   zh-Hant, vi, es) carry no low-confidence note from the translator.
Answered on 2026-10-01 and removed from this list:
- the internal backup load refuses a snapshot with a damaged or missing block as a whole (it was item 7). The
  maintainer wants an option to load the intact data (`MC-152`); filed as CHORE-59 and placed in the work
  order;
- whether the fork's own builds set `VITE_RISU_LEGAL_CONFIGURED` (it was item 8). Answered twice. `MC-155`: the
  flag stays unset until the maintainer's own Terms of Service and Privacy Policy exist. Then `MC-157`, after
  those documents were committed: the flag is on by default in every build from the repository, and CHORE-35's
  missing upstream-service prompts are a CHORE-60 release condition. The maintainer's answers do not mention the
  investigation of every request the fork sends to upstream's servers that the Orchestrator had offered.

**Wiki session hand-off (no edit to `docs/wiki/**` was made by this session).** Checked against source on 2026-10-01:
- `docs/wiki/Migrating-from-upstream.md` (the "In-place upgrades" section, and the earlier sentence about the same
  server folder or Docker volume) describes swapping an upstream Docker install for this fork on the same
  volume as a supported route (`MC-087` 1). The fork's default `docker-compose.yml` now uses its own project,
  container and volume names (`risuai-fork`, `risuai-fork-save`; `MC-153` 2), so an upstream Docker volume is
  opened in place only if the user points the compose file at it deliberately. The `save/` folder route on a
  Node server is not affected.
- `docs/wiki/Settings-Backup-and-Files.md`, the Load Internal Backup row, says it installs the restored database,
  shows "Loaded backup" and "does not reload the app". Since `448962f4`, `loadInternalBackup`
  (`src/ts/drive/internalBackup.ts:154-180`) writes the snapshot as the main save and reloads the page (or
  relaunches on Tauri). The Clean Unused Cold Storage row uses the old label; the English label is now "Clean
  Unused Archived Data and Assets" (`cleanColdStorage` in `src/lang/en.ts`), and the clean-up also deletes
  unused asset files and has more refusals (`src/ts/storage/manualCleanup.ts`, `currentRefusal`).
- `docs/wiki/Settings-Advanced.md`, the Cold Storage row, uses the old label, the root key `coldstorage` and the
  old default. Since `33545c2c` the checkbox is "Archive characters at startup" (`coldStorage` in `en.ts`),
  bound to `archiveCharacters` (absent or `true` means on; `src/ts/setting/advancedSettingsData.ts`, id
  `adv.coldstorage`). Since `9b312962` the boot pass reads it (`tree.archiveCharacters === false` stops the pass,
  `src/ts/storage/bootArchivePass.ts:475`, and `:479`; an absent key is written as `true` on a boot where the pass can run,
  with a one-time notice), so the row's old default and wording are stale in a second way.
- **A new fourth item (2026-10-02, `MC-158` 4 and `MC-159` 1): the two-device note for a Node server.** Please add it
  to the wiki page where you think it belongs; no wiki page mentions the two-device case or the stopped-saving
  state (the step 5d-4 investigator searched `docs/wiki` for those phrases on 2026-10-02; it named
  `Settings-Advanced.md`'s Cold Storage row and a Node-server mention as natural homes, which is your call). The
  facts to carry, TRACED in source and not run against a real server (the README states the same):
  - on a self-hosted Node server there is no prompt between devices. The tab prompt covers only tabs of the same
    browser;
  - when another device or browser saves first, the first device shows a message on its next save and **stops saving
    until the tab is reloaded**;
  - edits made on the first device since its last successful save are lost when it reloads;
  - opening the app on the other device can be enough to cause it, because startup archiving can save even when you
    edit nothing.

  The README's "Saving across tabs and devices" item (`README.md`, the bullet beginning "**Saving across tabs and
  devices.**") already says this; point at it for the wording. The README change is committed in `e7d7f093`. The Main Campaign never edits `docs/wiki/**`.

## Finished stages

One row per stage. The Report's STATUS block holds the outcome and the ledger rows hold the
dispatches; `Agents/Carry-Forward.md` holds what a stage left for later ones. Earlier stages
(Phase 0 to durable drafts) are in `Agents/Roadmap.md`.

| Stage | Report | Fix commit(s) | Records commit(s) | Ledger rows |
|---|---|---|---|---|
| W0, identity (`chatIds.ts`, `chatOrigin.ts`) | 24 | `d7505e2f` | `b50c8974` | 164-172, 176-177 |
| CHORE-28, duplicate `chaId` save guard | 26 | `2420d717` | `21668b28` | 178-184 |
| CHORE-34, multiuser removal | 27 | `911376cb` | `c225643b` | 185-189 |
| CHORE-33, RisuAccount removal (28A, 28B, 28C) | 25, 28 | `e1dd839c`, `87b974e5`, `d2653123`; follow-ups `58f37298`; comment sweeps `57d1596a`, `2f6ce6d3` | `4aa29913`, `fd13d930`, `877d233b`, `9cbe2901` | 173-175, 190-200, 203-205, 207-216, 218-222, 224-225, 228 |
| CHORE-39, OPFS migration | 30 | `37898465` | `9cbe2901` (plan), `b7b1fd00` | 223, 226-227, 229-231 |
| Removal stage (Drive, dead code, `risuaiAccountCached`, Patreon; `MC-093`) | 31 | `2af8d4fe`, `a9c29ba7`, `237ebba1` | `e8500372` | 232-241 |
| Upstream sync (Svelte 5.56.8, zh-Hant, `{{slot}}` help) | none | `425080e6`, `f190d950`, `0efc3d22`, `4cdb5ef1` | `80c9128a` | 244-245, 248 |
| CHORE-42, local restore with other tabs open | 32 | `ce6bc594` | `80c9128a`, `2cdfb2b5` | 242-243, 246-247, 249-252 |
| W1a, every write a trigger run makes | 33 | `13ed2e75` | `490bdec2` | 253-264 |
| W1b, the parser and the read side | 34 | `22db8dfe` | `790643ff` | 265-271 |
| Composer stage (S0 hotkeys, S1 actions, S2 per-chat drafts; CHORE-44 folded into S2) | 22 | `b05231c6`, `1bc5f288`, `67f17f1a` | `2177f7d2`, `9ce59e0d` | 157-158, 272-286, 288-300 |
| Vitest excludes `.claude/**` | none | `7b72b813` | `127f84d1`, `d4b0262d` | none |
| Upstream batch (`MC-101`) | none | `3482ef4f`, `73edeb69`, `295c0fa7`, `5064bc4c`, `5c85cac7`, `0f38ac8c`, `9213ebc2` | `679e7ff4` | 287, 301-304 |
| W2a, a send writes into the chat it started in | 35 | `ec65c200` | `650dd97f` | 305-318 |
| W2b-core, one generation at a time | 36 | `ac8cb3da` | `6940a7b3` | 319-333 |
| W2b-previews | 38 | `8f93d095` | `5e4a2bfd` | 334-347 |
| Escape on alerts, stage 1 | 39 | `6631f5e0` | `9dee3ea9` | 348-354 |
| W2c-a, scripts, Lua edit triggers and lorebook | 40 | `79c6e35e` | `4576d07e` | 355-370 |
| Escape on alerts, stage 2 | 41 | `c0b323b0` | `d848ecdf` | 375-381 |
| W2c-b, prompt parses, persona and summaries | 42 | `9d493c79` | `dd41a43d` | 382, 384-392 |
| W2c-c, the prompt's index tags and hidden messages | 43 | `d27a1ee4` | `1e8c64f1` | 393-403 |
| W2d-a, the `request` trigger and the prompt's names (CHORE-27) | 44 | `4c34172c` | `86c1e806` | 404-416 |
| W2d-b, the tool path, graph memory, `risuaccess`, `aiaccess`, four request bugs | 45 | `efd417b9` | `c67bffed` | 417-427 |
| Fullscreen on web (its own session and worktree) | none | `51e923eb` | `61b5a885` | 428 |
| W3, `/` commands, `/multisend` and Post File on their own chat; the command bugs | 46 | `e07d32fb` | `26d57bdc` | 429-443 |
| W2e, a delete warns about and stops the work in its chat; a backup load is refused while busy | 47 | `baf238e7` | `7d4bc4b0` | 444-454 |
| CHORE-47, a local backup includes non-`.png` assets | 48 | `d25a02fb` | `bb3f9e7b` | 461-467 |
| The chat-switch memory fix (the sender icon's `{#await}`; `MC-136` 4) | 49 (section 6) | `ccf45c53` | the records commit after `ccf45c53` | 471, 474, 483 |

Escape on alerts stage 2 and W2c-a were merged as `1d6fa16b`.

## Operational notes for this environment

- **Git Bash here fails on heredocs, and on single commands longer than about 230 characters.**
  Write scripts with the Write tool, or use PowerShell. Commit with `git commit -F <file>`.
- **Git Bash rewrites any argument that begins with `/`** (MSYS path conversion). `git grep
  '/kei'` reported no matches when there were five. Prefix such commands with
  `MSYS_NO_PATHCONV=1`, or drop the leading slash from the pattern.
- **Tool grants** (`^tools:` in `.claude/agents/*.md`, checked 2026-09-30):
  - `opus-reviewer`, `adversarial-reviewer`, `investigator` and `deep-investigator` hold `Write`, for
    scratchpad files only (in effect since 2026-09-25); `perf-analyzer` also holds `Write`;
  - `doc-writer`, `sonnet-coder`, `test-warrior` and `translator` hold `Write` and `Edit`;
  - `code-searcher`, `code-reader`, `doc-verifier` and `senior-advisor` have neither;
  - `code-reader`, `investigator` and `deep-investigator` also hold `Agent`.

  Check the file before a brief promises a tool.
- **Tell every agent** to run shell commands from the scratchpad, never from the repo root, and
  never to use globs in `mkdir` or `cp`.
- **Mutants:** build them from the current source each round, through a scratch Vitest config
  that aliases the module. When swapping in HEAD versions of files, serve every changed file,
  including the `./en` import.
- **`pnpm remove`/`add` backfill `libc:` metadata** into unrelated lockfile entries (pnpm
  10.34.1). Strip the added lines so the lockfile diff is only the intended change, then validate
  with `pnpm install --frozen-lockfile --offline`.
- **Line endings.** The `Agents/` documents are LF in the index. With `core.autocrlf=true`, a
  checkout that rewrites a file leaves it CRLF in the working tree. That is harmless to git, which
  normalises on commit, but normalise it back to LF when you edit. After any edit run
  `git ls-files --eol <file>`: it must say `w/lf`. Judge counts by `git diff --numstat` and git's
  "LF will be replaced" warnings, not by Git Bash `grep`/`od` counts, which misreported twice.
- **Source files that are CRLF in the working tree** (the index holds them as LF; `git ls-files --eol` shows `i/lf
  w/crlf`). No Agents file kept a list of these; this is the list, and it is not complete for the whole tree. Edit
  them with the Edit tool, never a PowerShell split (`MC-165` 7):
  - added by CHORE-43 with CHORE-54 (`71e75d9d`): `src/ts/process/composerActions.svelte.ts`,
    `src/ts/process/prereroll.ts`, `src/ts/process/index.svelte.ts` and `src/lib/ChatScreens/DefaultChatScreen.svelte`
    (checked with `git ls-files --eol` on 2026-10-02);
  - the same session's `src/ts/process/rerollHistory.ts` and its two new test files,
    `src/ts/process/tests/rerollHistory.svelte.test.ts` and `src/ts/process/tests/sendChatInlineError.svelte.test.ts`,
    are LF (`i/lf w/lf`);
  - also CRLF, from the same `git ls-files --eol` check: `src/lib/ChatScreens/Chat.svelte` (`MC-165` 7),
    `src/ts/process/coldstorage.svelte.ts` and `src/ts/drive/backuplocal.ts` (named in Report 55). The rest of the tree was
    not checked.

## Open items

- **Possibly still present:** `C:\Projects\scratch_investigator_tmp` (empty) and
  `Temp\claude\coldstorage.svelte.ts.bak`. The maintainer deleted `%TEMP%\qa1`.
- **Scratch trees with `node_modules` junctions.** Remove each junction with `cmd /c rmdir` before
  any recursive delete.
- **The `.gitignore` entry** for `Asset Cache/Community Mitigation_Webrowser Plugin/` names a path
  that no longer exists.
- **Card description contrast** (`text-textcolor2` on the home cards) measured 3.32:1 in a live check
  on 2026-09-23 (`fe90145e`), for one colour scheme. A maintainer decision; not raised.
- **The per-instance `matchMedia` listener in `Chat.svelte`.**
- **The sidebar is deferred** (`MC-071`).
- **"Backup & Files" still uses the old account tab's person icon** (`UserIcon` in
  `Settings.svelte`; cosmetic, not recorded elsewhere).

## Test suite

- **Step 5d-4's final tree (`e7d7f093`):** 261 files, 4,956 passed, 4 skipped; `pnpm check` 0 errors and 0 warnings;
  the build was run (`step5/5d4/full-*-r2.txt` in the session scratchpad). Before the Gate 2 remediation the tree was 261
  files, 4,955 passed. Gate 2 round 1's reviewer ran the 14 test files of the step against the working tree (588
  passed, 1 skipped) and against the parent's sources (164 failed, 424 passed), and `pnpm check` (0 and 0); round 2's
  reviewer ran 15 test files (637 passed, 1 skipped) and `pnpm check` (0 and 0).
- **Step 5d-3's final tree (`3fca470e`):** 255 files, 4,660 passed, 4 skipped; `pnpm check` 0 and 0 (the
  Orchestrator's runs after the remediation). The build was last run before the comment, string and test-only
  remediation. Against the parent, the pass test file failed 85 of 212 (commit message). Nothing was run on Tauri, a
  real Node server, a browser's OPFS, or a real tab kill.
- **Step 5d-2b's final tree (`4d23b1b4`):** 254 files, 4,372 passed, 4 skipped; `pnpm check` 0 and 0; the build was
  run on the first snapshot (254 files, 4,371 passed; the later changes were the notice's first sentence in seven
  languages and two tests). Against the parent, 39 of the 56 new tests failed. Nothing was run on Tauri, a real Node
  server, a browser's OPFS, or a real tab kill.
- **Step 5d-2a's final tree (`29bf2f24`):** 252 files, 4,315 passed, 4 skipped; `pnpm check` 0 and 0; the build was run
  (commit message and the Orchestrator's logs). Against the previous pass, 140 of the new tests failed. Nothing was
  run on Tauri, a real Node server, a browser's OPFS, Web Locks or a whole-browser crash.
- **Step 5d-1's final tree (`e8cf50de`):** 248 files, 4,157 passed, 4 skipped; `pnpm check` 0 errors and 0
  warnings; the build was run (the commit message and the Orchestrator's final run; Gate 2's reviewer read the
  outputs and re-ran the new test files, 213 of 213 passed on the working tree it reviewed). The Gate 2
  corrections touched comments, test titles, tests and the commit message; the final full run is the one in the
  commit message. Nothing was run on Tauri, a real Node server, or a browser's OPFS and Web Locks.
- **The legal flag default (`a6a27df5`):** 241 files, 4,086 passed, 4 skipped; `pnpm check` 0 errors and 0
  warnings; `pnpm build` ok; Gate 2's reviewer re-ran the suite on the same tree and got the same numbers. A
  default build and an opt-out build were compared (the opt-out build's main chunk is smaller, so the default
  build keeps the app). Not run: Docker, Compose, either workflow.
- **Step 5c's final tree (the step 5c fix commit, `9b312962`):** 239 files, 4,077 passed, 4 skipped; `pnpm check`
  0 errors and 0 warnings; the build was run (`full-test-r2.txt`, `full-check-r2.txt` and the commit message;
  Gate 2 round 2's reviewer re-ran the suite and `pnpm check` on the same tree and got the same numbers). Round
  2's corrections touched comments, test titles and the commit message. Nothing was run on Tauri, a real Node
  server, or a browser's OPFS and Web Locks.
- **The Settings legal links (`696ba5de`):** Gate 2 round 1's reviewer ran the two touched test files (6 passed)
  and `pnpm check` (0 and 0); the full-suite numbers for this commit are not recorded here. The app was run
  once (dev server, legal flag set for that run only; commit message): the footer renders on desktop and at 375 px,
  and the menu column stays 190.7 px with German labels.
- **Step 4's final tree (the step 4 fix commit, `a6719e35`):** 229 files, 3,876 passed, 4 skipped;
  `pnpm check` 0 errors and 0 warnings; `pnpm build` exit 0 (Report 55 section 4; run on the snapshot
  Gate 2 round 2 reviewed). Round 2's editorial corrections touched comments and test titles only, and
  the two new test files were re-run (109 passed); the full suite was not re-run after them.
- **CHORE-16 PG-1's final tree (the PG-1 fix commit, `08e43e65`):** 227 files, 3,767 passed, 4 skipped;
  `pnpm check` 0 errors and 0 warnings; `pnpm build` exit 0 (Report 54 section 4). The Gate 2 editorial
  fixes (three comments in round 1, two in round 2) touched comments only, and the full checks were not
  re-run after the round-2 rewordings.
- **Step 3b's final tree (the step 3b fix commit, `1b38b5d5`):** 222 files, 3,724 passed, 4 skipped;
  `pnpm check` 0 errors and 0 warnings; `pnpm build` exit 0 (ledger row 512; the Orchestrator ran all
  three on the final tree after Gate 2 round 3; they replace an earlier run of 3,723).
- **Step 3a's final tree (the step 3a fix commit, `bd57aa19`):** 216 files, 3,680 passed, 4 skipped;
  `pnpm build` exit 0 (ledger row 507; both on the snapshot Gate 2 approved); `pnpm check` 0 errors and
  0 warnings on the final tree, after the post-approval edits (`3a/gate/check-final.log`). The full suite
  and the build were not re-run after the editorial edits to two test headers and the commit message;
  the two edited test files were, 4 passed.
- **Step 2's final tree (`db49aeeb`):** 209 files, 3,559 passed, 4 skipped; `pnpm check` 0 errors;
  `pnpm build` exit 0 (ledger row 497; taken before the round-3 comment-only edits). Step 1's tree
  (`2b3dd636`) had 205 files, 3,436 passed, 4 skipped (row 490). The baseline before step 1 was W2e's
  `baf238e7`: 198 files, 3,269 passed, 4 skipped, 0 failed (row 452).
- `cargo check` last ran on the removal stage.
- Run the suite with plain `pnpm test` or `npx vitest run`. `vitest.config.ts` excludes
  `.claude/**` (`7b72b813`).

## How to live-check this app

- **OPFS is not offered on the Node server.** To live-check the OPFS switch, build as below, then
  serve `dist` with `pnpm run preview -- --port 4173 --strictPort` in the background and use a
  Chrome window at least about 1300 px wide (narrower windows hide the Settings menu behind the
  list button). Stop it by the PID listening on 4173. The localhost:4173 origin holds only
  throwaway test data.

- **Default method: the built-in pane, on a scratch Node server.** Observed 2026-10-01 (ledger row
  501).
  1. **Build for production.** Run `pnpm run build` with `$env:VITE_RISU_LEGAL_CONFIGURED='TRUE'`
     set for that one PowerShell command only. The maintainer approved this on 2026-09-25. Since `a6a27df5`
     (`MC-157`) `.env.production` sets the flag to `TRUE`, so a default build no longer needs the variable.
  2. **Start the scratch server.** `server/node/server.cjs` resolves `dist` and `save` from its
     working directory. Make a scratchpad folder holding a junction `dist` to the repo's `dist` and
     an empty `save`. Set `PORT=6011` and run `node C:\Projects\RisuAI\server\node\server.cjs` from
     that folder, as a background process. The repo's `save/` is not touched, so no backup or
     restore is needed.
  3. **Open the pane with `preview_start`** on the `risuai-prod-scratch` entry of
     `.claude/launch.json` (attach-only: `http://localhost:6011`, port 6011, no command). **Never use
     plain `navigate` for the first open.** A pane tab opened that way stops at "Checking Service
     Worker..." with "Failed to register a ServiceWorker ... An unknown error occurred when fetching
     the script"; the pane's network log shows no `sw.js` request, while `curl` gets `/sw.js` with
     200 `application/javascript`. A tab opened with `preview_start` registers the service worker
     and boots.
  4. **Reload with `navigate` and `force: true`.** The Node build's leave-site prompt blocks a
     plain reload; `force` passes it.
  5. **First run on an empty `save`:** the app asks "Set your password to security", and after the
     password is entered the boot stops with the alert "getItem Error" (CHORE-50, open). Reload,
     and enter the same password at "Input your password..."; it then boots. Keep the test
     password in the scratchpad, never in chat or in the docs.
  6. **`tabs_context` reports whether the pane is displayed.** In a displayed pane the page is
     `visible`, and `requestAnimationFrame` and `IntersectionObserver` callbacks fire.
  7. **Stop the server by the PID listening on 6011** and confirm the port is closed.
- **Model:** Echo needs no API key. In the model picker it sits under "For Developer" once "show
  unrecommended settings" is ticked.
- **Settings:** restore any setting you change, or use a fresh scratch `save` for the next check.
- **Network:** do not probe upstream services (`MC-081`).
- **A delayed model with no network:** register a probe with `__pluginApis__.addProvider(name, async
  (arg, abortSignal) => ...)` that records the call and its abort, then pick "Plugin Legacy" (behind
  "show unrecommended settings") and choose it in the plugin select; set the auxiliary model to Echo.
  A confirmation that must land during the wait goes in the same `browser_batch` as the send, and
  the delay must outlast every confirmation (W2e's first 10 s probe finished before the second one).
- **Seeding test data.** Use `globalThis.__pluginApis__.getChar()` / `setChar()` on the main page
  to set a field on the selected character; a fresh scratch `save` (or the `save/` restore, in the
  fallback) undoes it. **Never switch the model this way.** `setDatabaseLite` did not reach the send
  path, and a test message went to the profile's default provider (row 205). Use the model picker.

### Fallback: Claude in Chrome, against the repo's `save/`

Use it when the pane cannot do the check. Its caveats:
- **Start the server yourself.** Run `pnpm run runserver` (port 6001) as a background process, after
  the production build above.
  - Do not point the built-in pane at this server (no `preview_start` on it). It would open the app
    on the same server storage, making a second writer.
- **The Node server's data is `save/`** (gitignored). It is a near-empty throwaway, not the
  fixture.
  - Before the check, copy it to the scratchpad.
  - Afterwards, stop the server and restore it. Verify the restore by hash, and move any file the
    test created out rather than deleting it.
  - The `save/` restore also covers the Node server's settings.
- **Claude in Chrome opens its tab in the background**, so the page starts hidden. Ask the
  maintainer to bring that window and tab to the front before the first click.
- **The leave-site guard prompts on every reload of the Node build**, by design
  (`preload.beforeUnload.test.ts`). In Chrome a forced navigation does not get past it, and closing
  the tab hangs the tool.
  - Confirm the save reached `save/` (mtime and `__revisions.json`), then ask the maintainer to
    refresh or close the tab.
  - Close the tab before the server restarts, or it can write stale state back.
- **Stopping the server.** `TaskStop` on `pnpm run runserver` kills only the pnpm wrapper. The
  `node server/node/server.cjs` child keeps listening on port 6001. Stop it by PID, and confirm
  the port is closed before restoring `save/`.
- **A hidden Chrome window.** When `document.visibilityState` is `hidden`:
  - screenshots time out;
  - chained timers are throttled, so `waitAlert` loops can take up to about a minute.

  Page scripts still work. Clicks via `element.click()` and page reads were enough for 28B's and
  28C's checks.
