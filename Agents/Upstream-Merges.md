# Upstream merges — record of what came in from kwaroran/RisuAI

Every merge from `kwaroran/RisuAI` (upstream) into this fork gets an entry here. The fork stays upstream-compatible: a `.bin` moves in both directions, and upstream characters, modules, presets and plugins keep working (MC-175). This file records what each merge took, what it skipped and why, so the next merge does not have to rediscover it.

## Finding what is new next time

Name the last upstream commit this file says was merged. Then:

- `git log --no-merges <last upstream commit merged>..upstream/main` lists the new upstream commits.
- `git cherry -v main upstream/main <last upstream commit merged>` marks each one `+` (no patch-identical commit on `main`) or `-` (a patch-identical commit is on `main`).

`git cherry` over-reports. A hand port done from upstream's first-parent diff, or by hand, has a different patch, so `git cherry` shows it as `+` although it is already in the fork. The port's commit message carries a `(cherry picked from commit ...)` or `Ported from upstream commit ...` trailer. Search `main` for the upstream hash before treating a `+` as new:

`git log --grep=<first 8 characters of the upstream hash> main`

Upstream merges whole PRs, so the hash in a trailer is usually the PR's merge commit on upstream's first parent, not one of the PR's own commits. Compare by subject as well.

## Fork point

The fork's base is upstream `669b12ce` (2026-09-19, "feat: add Gemini 3.8 Flash model (#1615)"). The fork's first own commit is `f7e95130` (2026-09-19, "docs: add investigation baseline for perf, persistence, asset corruption, platform expansion"), whose parent is `669b12ce`.

## Hand ports before the first merge (2026-09-19 to 2026-09-28)

Between the fork point and the first merge, upstream changes were brought in by hand or by `git cherry-pick`. Upstream hashes below were checked against upstream's history with `git show`. Fork commits were checked on `main`. Extent is stated as the fork commit message states it.

| Upstream (PR, commit; its own commits) | Fork commit | Extent |
|---|---|---|
| #1555 `25001174` Svelte 5.56.8 (`b4787f15`) | `425080e6` (2026-09-27) "chore: update Svelte to 5.56.8" | Same version change. The fork's message says "Matches upstream 25001174". |
| #1620 `9546973a` Traditional Chinese (`6f91e86b`, `ba3cd32e`, `9f24c2e0`) | `f190d950` (2026-09-27) "i18n(zh-Hant): take upstream's improved Traditional Chinese" | Key by key, against base `669b12ce`. A key took upstream's value only if the English matched and the fork had not edited it: 1438 keys, 909 changed. 48 keys, 89 fork-only keys and the 34 keys the fork removed were kept as the fork had them. |
| #1629 `a66f81a8` asset: src through DOMPurify (`20c46e11`, `6ee8c3e7`) | `295c0fa7` (2026-09-28) "fix: keep asset: src on media elements through DOMPurify" | Cherry-picked from upstream's first-parent diff. The new test is upstream's, with two extra mock lines for the fork's imports. |
| #1553 `b544d744` Claude 5 Opus (`c8a37b75`, `37d96e34`) | `3482ef4f` (2026-09-28) "feat: add Claude 5 Opus and fix adaptive-only thinking mode" | Cherry-picked from the first-parent diff. The fork's message says the five files match upstream/main exactly. |
| #1604 `851e8ca5` Lua axLLM mode (`baac5410`) | `5064bc4c` (2026-09-28) "feat: allow Lua axLLM to use other aux models" | Cherry-picked from the first-parent diff. The hunk lands in the fork's `scriptings.ts` at an offset. |
| #1601 `e8c063c0` Monaco worker imports and Lua completion (`4e7733a0`) | `73edeb69` (2026-09-28) "fix: load Monaco workers through Vite worker imports; add Lua completion" | Cherry-picked from the first-parent diff. The fork's message says both files match upstream/main exactly. |
| #1570 `5f9e3cbe` loadout apply options (`11c278c6`) | `5c85cac7` (2026-09-28) "feat: persist loadout apply options" | Cherry-picked from the first-parent diff. |
| #1590 `7fd4b875` reroll snapshot clone (`0e56b763`) | `9213ebc2` (2026-09-28) "perf: clone only the new messages for the reroll snapshot" | Ported by hand. Upstream changed `DefaultChatScreen.svelte`. In the fork the line lives in `sendChatMain` in `composerActions.svelte.ts`. The fork added three tests. |
| #1573 `5537816a` plugin permission scoping (`69a56088`, `016d423b`, `27ea429f`, `e774d673`) | `0f38ac8c` (2026-09-28) "fix(plugins): scope permission decisions to the script and permission" | Ported by hand. `v3.svelte.ts` has fork changes, and upstream's `PluginPermission` type omits `'inlay'`, which the fork's `readInlay` checks. `pluginPermissionCache.ts` is upstream's with `'inlay'` added. |
| #1513 duplicate module creation (`3a19c2a5`) | `895c298e` (2026-09-19) "fix: Phase 0 quick fixes for asset corruption, save reliability, module editor" | Not a port. The fork fixed the same double push in `ModuleSettings.svelte` on its own, as one of nine Phase 0 fixes. The pairing with upstream's commit is from the merge commit message. |

The PR numbers in the first column are the ones in upstream's commit subjects, except #1513, which comes from the merge triage.

## 2026-10-06 — merge `534c5a66`

Merge commit `534c5a66`, "Merge upstream/main (ea0871de) into main: Realm creator blocking". Parents: `97e44b2b` (the fork's `main`) and `ea0871de` (upstream/main, 2026-10-06, "feat: add RisuRealm creator blocking (#1544)").

**Upstream range:** `669b12ce..ea0871de`, 22 non-merge commits (`git rev-list --count --no-merges`). **Last upstream commit merged: `ea0871de`.**

**What the merge adds.** Three things are net new:

1. RisuRealm creator blocking (upstream #1544).
2. Gemini requests no longer send `role: 'function'` (upstream `d900d6bd`).
3. Four Traditional Chinese values from upstream's translation update that the fork had not already taken.

Everything else in the range was already in the fork, so the merge kept the fork's version.

### Disposition per upstream commit or group

| Upstream commit(s) | Disposition | Reason |
|---|---|---|
| `656cd3cf` "feat: add realm creator block persistence", `11166050` "feat: add realm creator blocking controls" (#1544) | TAKEN-ADAPTED | New feature. Upstream's `realmBlocking.ts` and its test, `RealmBlockedCreators.svelte`, and the `RealmMain`, `RealmPopUp` and `characterCards.ts` changes, with a new saved field `Database.blockedRealmCreators` (`{id, name}[]`, default `[]`). Same field name and shape as upstream, so a `.bin` carries it both ways. Changes for the fork are listed below. |
| `d900d6bd` "feat: remove role: function, gemini role function is removed. better to use no role." | TAKEN | New to the fork. Three sites in `google.ts`; the role type becomes optional (`role?`). |
| `6f91e86b`, `ba3cd32e`, `9f24c2e0` (#1620) and `ca1345fc` "fix: properly fix zh-Hant.ts" | ALREADY IN FORK (`f190d950`), plus four values TAKEN | `f190d950` took upstream's zh-Hant key by key. Four values still differed and were applied, with the 8 new Realm keys. `git log -S` on each value gives `6f91e86b` for all four; `ca1345fc` only removed a conflict-marker block that held an old duplicate `pluginV2Warning` line. |
| `a19bbb8f` "fix: restore inlay permission and use scoped permission getter in v3 plugin APIs" | ALREADY IN FORK (`0f38ac8c`) | The fork added `'inlay'` to `PluginPermission` and scoped the getters in `0f38ac8c`. Merge kept the fork's `v3.svelte.ts` in every conflicting hunk (6, as `git merge-tree` reproduces it). |
| `69a56088`, `016d423b`, `27ea429f`, `e774d673` (#1573) | ALREADY IN FORK (`0f38ac8c`) | Plugin permission scoping and denial. `pluginPermissionCache.ts` is blob-identical to upstream's (`07068c4b`). |
| `b4787f15` Svelte 5.56.8 (#1555) | ALREADY IN FORK (`425080e6`) | `package.json` was not in conflict. Svelte `^5.56.8` is identical on both sides. |
| `20c46e11`, `6ee8c3e7` (#1629) | ALREADY IN FORK (`295c0fa7`) | `assetSrcSanitize.test.ts`: the fork's version kept, because it has two extra mock lines that the fork's imports need. |
| `c8a37b75`, `37d96e34` (#1553) | ALREADY IN FORK (`3482ef4f`) | Claude 5 Opus and adaptive thinking. |
| `baac5410` (#1604) | ALREADY IN FORK (`5064bc4c`) | Lua axLLM modes. `scriptings.ts`: the fork's version kept (it keeps `subject:`). |
| `4e7733a0` (#1601) | ALREADY IN FORK (`73edeb69`) | Monaco worker imports. |
| `11c278c6` (#1570) | ALREADY IN FORK (`5c85cac7`) | Loadout apply options. |
| `0e56b763` (#1590) | ALREADY IN FORK (`9213ebc2`, `71e75d9d`) | The reroll snapshot already slices before cloning in `rerollHistory.ts`. `DefaultChatScreen.svelte` conflict: the fork's version kept, because `sendChatMain` moved to `composerActions`. |
| `3a19c2a5` (#1513) | ALREADY IN FORK (`895c298e`) | The fork has an equivalent fix. Upstream also relabels the button; the fork kept "Create module" (maintainer decision, below). `ModuleSettings.svelte`: the fork's version kept. |

No upstream commit was skipped whole. Parts of commits that were not taken:

- Upstream's `src/LiteMain.svelte` change (it only passes `creator:` to `downloadRisuHub`). The file stays deleted; the fork removed it as dead code in `2af8d4fe`.
- Upstream's `close` language key, in en and ko. It is used only by upstream's relabelled button.

### Conflicts and how each was resolved

- `pnpm-lock.yaml`: the fork's version. Both sides carry svelte 5.56.8 (12 entries each) and 55 `libc:` lines, so no install was needed.
- `src/LiteMain.svelte`: deleted (see above).
- `DefaultChatScreen.svelte`: the fork's version file unchanged (the upstream hunk targets `sendChatMain`, which the fork moved to `composerActions.svelte.ts`).
- `ModuleSettings.svelte`: the fork's version, which calls `closeEditor()`.
- `RealmMain.svelte`: the fork's imports plus the import of `RealmBlockedCreators.svelte`.
- `RealmPopUp.svelte`: the fork's icons plus `BanIcon`, no `TrashIcon`. The auto-merged `{#if openedData.creator && (DBState.db.account?.token...` line was edited to `{#if openedData.creator}`, because the fork's `Database` has no `account` field.
- `characterCards.ts`: four hunks. Imports: the fork's plus `filterBlockedRealmCards` and `isRealmCreatorBlocked`, without `readFile`, `onOpenUrl` and `AccountStorage`. Helpers: the fork's plus upstream's `fetchRealmInfo` and `canAccessRealmCreator`, placed before the fork's `getRealmInfo`. Result paths: the fork's, with `cards` filtered through `filterBlockedRealmCards` on both ok-returns. `downloadRealmCard`: `askUpstreamAgreement` first, then the creator check, and `creator?: string` added to its argument type.
- `assetSrcSanitize.test.ts`: the fork's version.
- `v3.svelte.ts`: the fork's version in every hunk (6, as `git merge-tree` reproduces it).
- `scriptings.ts`: the fork's version.
- `src/lang` en and ko: the fork's version, keeping its removal of `able` (`e2602d4d`; it conflicted only because upstream's `close` sits next to it) and without `close`. cn and es: the fork's version. All seven language files gain the 8 Realm keys (de and vi by auto-merge). zh-Hant: the fork's version whole, then the 8 Realm keys and 4 changed values from upstream added.
- `package.json` was not in conflict.

### Adaptations to the fork

- `downloadRealmCard` asks the upstream agreement (consent) before any request to Realm servers, including the new creator-info lookup.
- The popup's Block button shows for any card with a creator. The fork has no account token to compare against.
- The block confirmation uses `fillLang` with a `{creator}` placeholder, in all seven languages.
- `getRisuHub` keeps the fork's result type and filters blocked creators' cards from both response shapes.
- Realm shows its empty state when blocking removes the last card.
- `downloadRisuHub` without a creator (Import from URL or ID, and desktop Realm links) looks up the card's creator first. If that lookup fails, the download stops with an error, as upstream does.

### Maintainer decisions

- Take upstream's creator blocking.
- Keep the "Create module" label on the duplicate-module button; do not take upstream's `language.close` relabel. Both are the maintainer's answers in the session of 2026-10-06; they are recorded in `MC-224` of `Agents/Maintainer-Context.md`, together with the rule that every upstream merge is recorded in this file.

### Review

- Gate: `opus-reviewer`, two rounds.
- Round 1: `[REJECT]`, test only. The production behaviour was accepted. The no-creator success path (RealmMain "Import from URL or ID" and desktop deep links) had no test; a mutant that returns right after the info lookup survived all 11 `characterCards*.test.ts` files (313/313 pass). A second finding was editorial: the `risuSave.blockedRealmCreators.test.ts` tests had to be labelled as compatibility guards, because they pass before the change, and the file was untracked and had to be added.
- Round 2: `[APPROVE]`. Both findings closed. Over the `characterCards*.test.ts` files (11) plus `risuSave.blockedRealmCreators` (321 tests, all passing unmutated), the mutants fail: `stopAfterInfo` 2, `infoBeforeConsent` 4, `noListFilter` 2. Production code was unchanged since round 1, and the commit message was accurate on every claim checked.

### Checks (from the merge commit message)

Full suite (`CI=true`): 509 files, 10271 passed, 6 skipped. `pnpm check`: 0 errors, 0 warnings. `vite build`: ok. Tests added: consent before any Realm request on the download path, blocked-creator refusal, the no-creator download path (info lookup, then download; a lookup failure stops with an error), the Realm list filter, and compatibility guards that the new root field survives the save encoder. Upstream's `realmBlocking.test.ts` is unchanged.

### Follow-ups (optional items from the reviewers)

- The info lookup in the no-creator download path shows no wait text.
- The `?realm=` popup block does not refresh an open Realm list. Upstream behaves the same way.
- Round 2 noted a wrong "Guard:" label on the test "an unblocked creator resolved from the realm info proceeds to the download request" (it fails on the pre-merge `main`, so it is a feature test). The label was removed before the merge commit; `534c5a66` carries the corrected comment.

## 2026-10-09 — merge `6f9c0b98`

Merge commit `6f9c0b98`, "Merge upstream/main: keep-alive sound counts as audible in Chrome" (2026-10-09). Parents: `7921b287` (the fork's `main`) and `2a511a31` (upstream/main, "fix: make keep-alive sound count as audible in Chrome (#1640)"). This entry was written on 2026-10-11, after the fact, from the merge commit and `MC-254`.

**Upstream range:** `ea0871de..2a511a31`, 1 non-merge commit (`git rev-list --count --no-merges`). `2a511a31` is upstream's merge of the PR. **Last upstream commit merged: `2a511a31`.**

**What the merge adds.** Upstream's inaudible 20 Hz looped tone for the "Via Sound" keep-alive option, so that Chrome counts the sound as audible (new `src/ts/keepAliveAudio.ts`, plus changes in `src/App.svelte`), and the updated "Via Sound" help text in the language files.

### Disposition per upstream commit or group

| Upstream commit(s) | Disposition | Reason |
|---|---|---|
| `67e7b8cb` "fix: make keep-alive sound count as audible in Chrome" (#1640) | TAKEN | `keepAliveAudio.ts` and the `App.svelte` change came in. The merge touches those two files and the seven language files (`git show --stat 6f9c0b98`). |

Part of the commit that was not taken: upstream's `keepSessionAlivePip` and `keepSessionAliveSound` label keys. The merge message says they are unused and not carried over.

### Conflicts and how each was resolved

The conflicts were in six locale files: `cn`, `de`, `es`, `ko`, `vi` and `zh-Hant` (translator report, `merge\translator.md`). The Gate 2 review adds that they were unmerged (`UU`) until staged. No conflict in `App.svelte`, `keepAliveAudio.ts` or `en.ts` is recorded; the review found the `App.svelte` hunks identical to upstream's.

Resolution, from the translator report: in each file the fork's side was kept, and only the "Via Sound" bullet body of the `keepSessionAlive` help text was replaced with upstream's new translation, keeping the fork's bold labels (cn 通过声音, de Über Ton, es Por Sonido, ko 소리로 유지, vi Qua Âm thanh, zh-Hant 透過音訊). Upstream's top-level `keepSessionAlive`, `keepSessionAlivePip` and `keepSessionAliveSound` duplicates in cn/de/es/ko/vi were dropped. The fork already has a top-level `keepSessionAlive`, and the Pip and Sound keys are unreferenced outside `src/lang` and absent from `en.ts` (review point 1). In `zh-Hant` only the second line of the help string changed, and the fork's concatenation structure was kept. All six files stay CRLF with no BOM.

### Adaptations to the fork

- Korean: the option label `optViaSound` changed from "소리로 전달" to "소리로 유지" so that it matches the help bullet (`MC-254`).

### Maintainer decisions

- Korean label "소리로 유지", and the authorization to commit and push `6f9c0b98` after the Korean fix: `MC-254`. The commit was pushed (`origin/main` was at `6f9c0b98` when `MC-254` was written).
- Proper keep-alive work is deferred until Android boot time is fixed; only the upstream merge was done now: `MC-256` (see also `MC-255`).

### Review

Gate 2: `adversarial-reviewer`, verdict `[EDITORIAL]`, no substantive defects (`merge\review.md`, 2026-10-09). One review round is recorded. It was read-only (git diff, git grep, byte counts, part of `App.svelte`); no tests were run. It found:

- Every upstream change in `ea0871de..upstream/main` (9 files) is present, and the `App.svelte` hunks are identical to upstream's.
- The locale files have no conflict markers, are CRLF with no bare LF, and have one changed line each against `HEAD`. Bullet bodies equal upstream's translation and the labels are the fork's.
- `App.svelte`: imports fine, `send.mp3` still used elsewhere, the pause listener is added once, a `play()` rejection resets the flag, and the `'pip'` branch is empty (deferred).
- Editorial: whether the Tauri Android WebView shows a media notification is unverified, so the new help text's Android claim may overstate.
- Housekeeping: the Korean option label "소리로 전달" differed from the help text "소리로 유지"; the maintainer's decision (`MC-254`) later changed the label.

### Checks

The merge message states no results. The run logs in session scratch (`merge\test.txt`, `check.txt`, `build.txt`) come from a copy of the merge tree; the test run started at 08:30:55. Whether they cover the final Korean label change is not recorded.

- `pnpm test`: exit 1. 592 of 593 test files passed; 12139 tests passed, 1 failed, 6 skipped. The failure was a 5000 ms timeout in `src/ts/storage/tests/assetPieceSave.test.ts` ("saveAsset without crypto.subtle > reproducer: a plain-HTTP page gets the content-hash key"). MC-254 and ledger row 1551 track this timeout as CHORE-152.
- `pnpm check`: 0 errors, 0 warnings, exit 0.
- `pnpm build`: built, exit 0.

### Follow-ups

- The fork's own keep-alive rework (an Android foreground service only while a request, TTS or image job is in flight; save the partial reply on hide; remove the PiP mode) is deferred (`MC-256`).

## 2026-10-11 — merge of upstream/main `979dbc9d`

Merge commit: the commit that adds this section (`git log --grep=979dbc9d main`). Parents: the fork's `main` and `979dbc9d` (upstream/main, upstream's merge of PR #1532).

**Upstream range:** `2a511a31..979dbc9d`, 1 non-merge commit (`git rev-list --count --no-merges`): `4fa72fb5` "Fix searchMatch key mutation in regex lorebook" (PR #1532). `6e0277b3` and `979dbc9d` are upstream merge commits. **Last upstream commit merged: `979dbc9d`.**

**Why.** The maintainer typed, in the Orchestrator session of 2026-10-11: "upstream had 3 commits which seems like a bugfix. see if we can merge them." Of the three, one is a code change and two are merge commits. Asked by the Orchestrator, the maintainer chose to merge after the Grid coder finished, with a reproducer test and a fresh review.

**What the merge adds.** Regex lorebook keys activate. Before, a flagged key such as `/dragon/i` was rewritten to `/dragon` with its leading slash kept, so a regex lorebook key effectively never matched. A key with no flags (`/dragon/`) was skipped. Now each key is parsed as `/pattern/flags`, flags are limited to `dgimsuvy`, and a key that cannot be parsed or is not a valid regular expression makes that key list (primary or secondary) not match. The regex's `lastIndex` is reset; this is defensive only, because the regexes are rebuilt on each `searchMatch` call.

### Disposition per upstream commit or group

| Upstream commit(s) | Disposition | Reason |
|---|---|---|
| `4fa72fb5` "Fix searchMatch key mutation in regex lorebook" (#1532) | TAKEN | Auto-merged with no conflicts (`git merge --no-commit --no-ff upstream/main`). The staged diff is only the regex branch of `searchMatch` in `src/ts/process/lorebook.svelte.ts`. The fork's own `subject`, `promptView` and `snapshotSubject` code in that file is intact. |
| `6e0277b3`, `979dbc9d` | Upstream merge commits | No change of their own beyond the commit above. |

### Conflicts and how each was resolved

None. The merge applied cleanly.

### Persistence

Nothing persisted changes. The keys come from a `.split(',')` on a cloned entry, and `searchMatch` only reassigns its own local key list.

### Fork addition

`src/ts/process/tests/lorebookRegexKeys.svelte.test.ts`: 10 tests that drive the real `loadLoreBookV3Prompt`. Five are reproducers that fail on the pre-merge code ("expected +0 to be 1": the entry did not activate). Five are compatibility guards that pass before and after. One reproducer key was corrected from `/dragon/g` to `/dragon/gi`, because the test data only has "Dragon". That test fails on the old code through its slash handling; it does not observe the `lastIndex` reset. Source: `upstream-1532-test-report.md` (session scratch).

### Review

Gate 2: `adversarial-reviewer`, `[APPROVE]` (`gate2-upstream-1532.md`, session scratch). It confirmed that the staged diff is only the regex branch of `searchMatch`, that the merged test file passes 10/10, and that with the pre-merge source injected in memory 5 tests fail and 5 pass. It also confirmed the behaviour changes: flagless keys are valid, flags are limited to `dgimsuvy`, any key that is not of the form `/…/` or is an invalid regex makes the whole query false (the old code aborted only on the first key), and the key mutation is gone.

### Checks

Full checks, on the merged tree with the uncommitted Grid edit-mode work also present: `pnpm test` 667 of 668 files pass (13064 tests pass, 6 skipped); the 6 failures are all `src/lang/localeParity.test.ts`, from the Grid work's five new English keys not yet translated, not from this merge. `pnpm check`: 0 errors, 0 warnings. `pnpm build`: succeeds.

### Follow-ups

- Not fixed, and present in upstream too: `searchMatch` slices messages from `length - scanDepth` with no clamp. A scan depth larger than the message count gives a negative start and drops the oldest messages (for example 3 messages with depth 5 keeps only the last 2). This affects plain keys as well as regex keys.

## 2026-10-21 — merge of upstream/main `61d0eb79a`

Merge commit: `2862940fe` on `main` ("Merge feat/upstream-61d0: upstream 979dbc9d5..61d0eb79a"; pushed). Parents: `eb4c5580b` (`main`) and `2c42d9423` (the tip of the branch `feat/upstream-61d0`). The branch itself holds a no-fast-forward merge of upstream (`c68baaf15`, stage U0) and the fork's own commits for the later stages, so the upstream merge was taken in stages U0 to U5 on the branch and landed on `main` in one merge. `git merge-base 2862940fe 61d0eb79a` returns `61d0eb79a` (run 2026-10-21). `git diff --stat 2862940fe^1 2862940fe`: 85 files changed, 7150 insertions, 188 deletions.

**Upstream range:** `979dbc9d5..61d0eb79a`: 89 commits, 52 of them non-merge (`git rev-list --count` and `--no-merges`, run 2026-10-21). The triage counted 49 non-merge commits up to `e773240bf` (`upstream-e773240\triage.md`); the Gate 1 review counted three more up to `61d0eb79a` (`7ac7a204c`, `be4316961`, `536a25141`, the form-submission work). **Last upstream commit merged: `61d0eb79a`** ("feat: Prevent form submission, allow listening to it with Lua (#1083)"). The upstream clone `C:\Projects\RisuAI-upstream` was left detached at `61d0eb79a`.

**Why.** The triage ran on 2026-10-20 against `e773240bf` and the maintainer answered the open groups (`MC-324` 1 to 11): plugin storage reads both layouts, SaveKV passes through verbatim, onboarding is data fields only, the welcome redesign is skipped, and the Node write errors are taken, adapted. The triage and those answers were against `e773240bf`; the Gate 1 plan covers `979dbc9d5..61d0eb79a`. The decision to merge into `main` and push is `MC-331` 2.

**What the merge adds.** Routine upstream fixes (lorebook flags, hypa-v3 cache key, Lua `editDisplay` and `generateImage`, hotkeys, SafeElement and SafeLocalStorage plugin behaviour, form submission for Lua, Gemini model list changes). Upstream's plugin storage index (`_coldpluginIndex`) now imports and exports and is kept by the store2 old-data deletion and the manual cleanup. Upstream's SaveKV blocks are read and carried, and written back in upstream's format when present. The Node server reports write errors as JSON, with 413 and 507. Character onboarding data fields are carried and mapped on cards, with no UI.

### Disposition per upstream commit or group

Hashes are from the stage commit messages (`git log --format=%B 2862940fe^2`) and from `upstream-e773240\triage.md`; the triage's group labels (G1 to G7) are kept.

| Upstream commit(s) | Disposition | Reason / where |
|---|---|---|
| `9badb4c1d` lorebook flags per entry; `2787e06c2`, `b63119add`, `7df079660` hypa-v3 contextual cache key; `3eb42cb88` Lua `editDisplay` raw string; `71526fbc3` settings order; `8f587dfe8` `getCharacterByIndex` snapshot; `49d08fdab` guest iframe source check; `9499b8700` `risu-select` class; `f76fb63ab`, `c22c3d738`, `9d21f229e` SafeElement listeners and docs | TAKEN (clean) | U0 (`c68baaf15`). The hypa-v3 key change makes existing contextual embeddings miss once (triage; cache is in localforage, not in the save). |
| `855d9d45a` SafeLocalStorage | TAKEN in part | U0: `clear`/`key` binding and `length` only (V3 plugins could not call `clear()` or `key()`; red on `c428a0234` in the `v3SafeLocalStorage` test). Its restore and lister parts were already in the fork (Gate 1 A2). Its plugin storage layout is U3. |
| `30b41e62e`, `48ee4de32` persona note | TAKEN-ADAPTED | U0: the `personaNote` field and setting item dropped, three test fixture lines dropped, the fork key `language.settingsPage.personaNotePlaceholder` used. The upstream `personaNote` locale key is now unused in all 7 locales (closeout note A10). |
| `1dbdede59` Lua `generateImage` orientation | TAKEN-ADAPTED | U0: the fork's `withInFlight` wrapper and group-member guard kept; options pass through `generateAIImage`. |
| `4a95bf2b6` prefill flag | TAKEN-ADAPTED | U0: `cbs.ts` keeps the fork's `RunSubject` import. |
| `6a36a3f4e`, `7e58e0b11` hotkey | TAKEN-ADAPTED | U0: `isTypingTarget` taken, the fork's `if(!d){continue}` kept. |
| `0ff42a757`, `98fd43146` card export image fallback | TAKEN-ADAPTED | U0 and its remediation: the placeholder image only when the character has no image or the image is missing (O1 ruling); any other read error rejects. `openRealmUpload` kept. |
| `1f8180c14` chat parse error | TAKEN-ADAPTED | U0: passes an Error; the message still comes from `language.errors.chatParseFailed`. |
| `b32610c6d` Gemini models | TAKEN-ADAPTED | U0: duplicate `gemini-3.8-flash` dropped (triage defect); `modelStatus.registry.test.ts` adapted. It also hid `gemini-3.6-flash` from the recommended list, which broke two `ModelList` tests (U5). |
| `7ac7a204c`, `be4316961`, `536a25141` form trigger (`61d0eb79a` is its merge) | TAKEN-ADAPTED | U0: `risu-form` allowed in the message DOMPurify config; the form handler in `Chat.svelte` follows the fork's `beginWork` and origin path (no `setCurrentChat`, reload bump gated on `originStatus`), per Gate 1 A3; `onFormSubmit` added to the Lua branch only, not pyodide. |
| `d90a00fbc`, `6a7df3198`, `3cc8bfebe` Node write errors (G6) | TAKEN-ADAPTED | U1 (`aff3cfa67`, `693632e1e`): JSON write error in the shared `handleWrite` catch, 413 on `/api/write` and `/api/write-checked` (upstream: `/api/write` only), 507 on a full disk; client `NodeHttpError` and `NodeStorageWriteError`. Not taken: upstream's `path.resolve` containment check and file-path trim (the hex guard stands), its `setItem` HTML-stripping normaliser and `nodeStorage.test.ts`. |
| `450a598aa` character onboarding (G3) | TAKEN, data only | U2 (`41c18917e`): data fields and card mapping. The UI (`OnboardingModal`, `OnboardingEditor`, `onboarding.ts`) is SKIPPED until the UI revision (`MC-324`). |
| `68b5d032c` plugin storage index and `keepPluginStorageInternals` (G2) | TAKEN-ADAPTED | U3. The fork keeps its own layout; upstream's index is converted on import (S1 legacy-page import and export, S2b store2 resolve) and kept by old-data deletion (S2a) and manual cleanup (S3). `keepPluginStorageInternals` is adapted in A2 and extended to the store2 value entries and to V2 `pluginStorage.clear()` (shared cause, `MC-091`). Upstream's `pluginStorageStore.ts` is not taken. |
| `d36fccc6a` | TAKEN | U3 A2: `pluginStorage.getItem` snapshots only the requested value. |
| `dae3f6509` SaveKV (G1) | TAKEN-ADAPTED as pass-through | U4a reads type 12 `kv:<ns>` blocks into `upstreamKvBlocks`; U4b writes upstream's v0 block format when a kv namespace exists. Upstream's `saveKV.ts` API and `encodeRisuSave` are not taken. |
| `de29b0646`, `8effde3a0`, `9d95cb209` `setDatabaseLite` ignores `plugins` | SKIPPED | The fork merges `plugins` by name behind user prompts; pinned by `pluginListWrites.svelte.test.ts`. |
| `46ae531be`, `c13186606`, `2b7fc9362`, `f1655a613`, `c03162e04`, `2ae6a997f`, `c5c9a6ba1`, `19cf3fd09`, `8443e593a`, `0bed08467`, `b3ac6d1e6` welcome redesign (G4) | SKIPPED | `MC-324`: skipped; the fork edited `WelcomeRisu.svelte`. |
| `eeb8ef5f2` cancelAccountSync; `bde6c2460` runtime legal flag; `4160e3e14` PR template | SKIPPED | Account sync is removed (CHORE-33); the fork builds default the legal flag on; the template is upstream's contributor policy. |
| `fff2c7061` backup order; `f0b236a54` dynamic Google `internalID` | SKIPPED, already in the fork | Triage: `bootstrap.ts` already stops at the first loadable backup; the fork's model registry covers the Google ids. |
| `drive/drive.ts`, `drive/accounter.ts`, `storage/accountStorage.ts` hunks | Kept deleted | The fork deleted these (CHORE-33). |
| Upstream merge commits (`61d0eb79a` and the five "Merge branch 'main' into feat/form-submission" merges) | Upstream merge commits | No change of their own beyond the commits above. |

The U0 merge message listed some deferrals wrongly; `f31eaf819` corrected them (E3): `d36fccc6a` is deferred to U3; `450a598aa` is deferred to U2 apart from its UI; `d90a00fbc`, `6a7df3198` and `3cc8bfebe` are deferred to U1; and the reverted onboarding hunks also covered `CharConfig.svelte` and `stores.svelte.ts`.

### Conflicts and how each was resolved

`git merge-tree --write-tree --name-only` on `c428a0234` gave 38 conflict files: the triage's 37 (99 conflict hunks) plus `src/lib/ChatScreens/Chat.svelte` (Gate 1 re-check). The three account files were modify/delete conflicts. The recipe, from Gate 1 A1: for the persistence files (`risuSave`, `backuplocal`, `coldstorage`, `coldstorageData` and its test, `globalApi`, `bootstrap`, `autoStorage`, `nodeStorage`, `server.cjs`, `plugins.svelte.ts`) take the fork's side of the whole file, then re-apply each named routine hunk as an explicit edit, because resolving marker by marker would let upstream's unmarked SaveKV and index hunks survive. `v3.svelte.ts` and `risuai.d.ts` carry only the named routine hunks. All 7 locale files are the fork's. Upstream-only files for skipped or deferred groups were removed from the result (`saveKV.ts`, `pluginStorageStore.ts`, `onboarding.ts`, `OnboardingModal`, `OnboardingEditor`, `WelcomeBackground`, `nodeStorage.test.ts`), and the onboarding hunks that git applied without conflict (parser purify config, interfaces, card mapping, `CharConfig.svelte`, `stores.svelte.ts`) were reverted until U2.

### Persistence

- **Plugin storage index.** Fork layout kept (`_coldplugin[key]` = unit id, value at `pluginCustomStorage[unit id]` on a store2 page). Upstream's `_coldpluginIndex` is converted on import: large (`l`) entries keep their id, small (`s`) entries get minted uuid unit ids, the index wins over a `_coldplugin` value for the same key, trash and version are ignored, and the pointer is removed. A missing, unparsable or non-index unit is listed as incomplete and reaches the existing prompt. Inline-key precedence stays the fork's (`MC-324` 10). Export of a tree that still carries the pointer includes the index unit and its large units, or reports them through the incomplete-backup prompt. A store2 profile that still holds the index keeps it and its large units through old-data deletion (S2a), and manual cleanup keeps them (S3). This closes CHORE-186 (E5 inverted: before S2a the deletion removed the index and the large units).
- **SaveKV.** Block type 12 named `kv:<ns>` is JSON-parsed into the optional `upstreamKvBlocks` field (hidden from plugins, removed from the settings export, carried by store2). If the file has any `kv:` block, root's `upstreamKvBlocks` is discarded and the field holds only block-decoded namespaces (A7(d)). The `.bin` export writes upstream's `RISUSAVE\0` block format only when at least one namespace exists; otherwise the msgpack bytes are byte-identical to a tree without the field. In the block format the character blocks are named by `String(chaId)` and the root block comes last without the six list keys.
- **V2/V3 plugin writes** keep `_coldplugin`, `_coldpluginIndex` and, on a store2 page, the value entries the current map names.
- **Nothing else changes a persisted shape.** Onboarding adds optional fields with no default or migration.

### Fork additions

Pure modules `pluginStorageIndex.ts` (U3 S1) and `risuSaveV0.ts` (U4b); goldens `upstream-plugin-index.bin`, `upstream-plugin-index-missing.bin`, `upstream-kv.bin` and `upstream-kv-unreadable.bin` with a builder independent of the fork's writer; tests for each stage listed in the stage commit messages (for example `pluginStorageInternals.svelte.test.ts`, `risuSaveKv.test.ts`, `risuSaveV0.test.ts`, `manualCleanup.svelte.test.ts`, `binGoldens.test.ts`); the Node write fault fixture `nodeWriteFaults.cjs`; and the `ModelList` test fixtures moved to `gemini-flash-latest` (U5).

### Review

Gate 1: `opus-reviewer` `[APPROVE WITH AMENDMENTS]` (A1 to A9 binding, A10 detail), after a `senior-advisor` challenge of the G1/G2 plan (`upstream-e773240\g1-verdict.md`, `advisor-g1g2.md`). Gate 2 per stage, from `upstream-e773240\closeout-notes.md`; rounds are counted from those notes:

| Stage | Gate 2 | Peak streak |
|---|---|---|
| U0 (`c68baaf15`, `f31eaf819`, `76a36fac5`, `e49be4314`) | r1 `[REJECT]` (R1: the form engine test did not discriminate), r2 `[REJECT]` (F1: image read inside the try hid errors for `writeModuleCard` and `shareRealmCardData`; mechanism reset, the read moved back before the try as on `main`), r3 `[EDITORIAL]` (test label legend, applied by the orchestrator) | 2 |
| U1 (`aff3cfa67`, `693632e1e`) | r1 `[REJECT]` (F1: no-stack assertions were vacuous), r2 `[APPROVE]` | 1 |
| U2 (`41c18917e`) | `adversarial-reviewer` `[APPROVE]`, no findings (png and charx share `createBaseV3`: reasoned, not run end to end) | 0 |
| U3 S1 (`f6894f96d`, `b86b6df2d`) | `opus-reviewer` r1 `[EDITORIAL]` (README, applied) | 0 |
| U3 A2 (`a50298593`) | r1 `[REJECT]` (B1: store2 value entries at unit ids were unprotected; amended under `MC-091`), r2 `[EDITORIAL]` (two comments, applied) | 1 |
| U3 S2a (`40145cda0`) | `[APPROVE]` (E1 test labels applied) | 0 |
| U3 S2b (`cee2effb5`) | `[EDITORIAL]` (E1 comments, E2 test label; applied) | 0 |
| U3 S3 (`75a68bba0`) | `[APPROVE WITH CONDITIONS]` (C1 test gap, C2 header comment, C3 reason); conditions met, the orchestrator re-ran the three surviving mutants (`notCommitted` 2 fail, `notOlderCopies` 3 fail, `memoAnyPointer` 2 fail; 288/288 on the current code) | 0 |
| U4a (`28217226f`) | r1 `[REJECT]` (F1: the root-first merge broke "blocks win"; ruling: any `kv:` block present discards root's field), r2 fresh `[REJECT]` (tests decided only by the `__directory` flag; mechanism kept after reconsideration), r3 fresh `[APPROVE]` (`storeImportBoot` judged a flake, 3 of 3 alone) | 2 |
| U4b (`ba8fa93b3`) | r1 `[REJECT]` (F1: a numeric `chaId` with kv made every backup fail after streaming assets; ruling: write numeric ids as `String(chaId)`), r2 fresh `[APPROVE]` (targeted) | 1 |
| U5 (`2c42d9423`) | `adversarial-reviewer` `[APPROVE]` | 0 |

`[EDITORIAL]` neither counts nor breaks a streak. The streak never reached three, so no advisor escalation was needed. U4a r2 was the second consecutive `[REJECT]`; the mechanism was reconsidered and kept because the reviewer had verified source and order independence.

**Recorded mistake.** The message of `f31eaf819` says an image read error "fails the export through writeCharacterCard's alertError path; the image read now sits inside that try". That is wrong: with the read inside the try, `writeModuleCard` and `shareRealmCardData` showed success over an empty file or posted an empty buffer. `76a36fac5` corrected it by reading before the try, so the error rejects. The same masking already existed on `main` for other errors raised inside that try (CHORE-187).

### Checks

At `ba8fa93b3` (`upstream-e773240\u5\`): `pnpm check` 0 errors, 0 warnings; `pnpm build` exit 0; `pnpm test` 20097 passed, 23 skipped, 2 failed (`ModelList.source` and `ModelList.status`; deterministic, and they pass on `main`). Cause: upstream `b32610c6d` set `recommended: false` on the older Gemini models and the fixtures used `gemini-3.6-flash`. `2c42d9423` fixed the fixtures only (test-only); the four targeted files (the two `ModelList` files, `modelStatus.registry`, `modelStatus`) passed 82/82. The orchestrator did not rerun the full suite because only those two files changed. Flakes seen during the stages, each passing alone: `firstLife.test.ts` `EADDRINUSE` once under a directory run, `assetPieceSave.test.ts` a 5 s timeout under `pnpm check` load, `storeImportBoot` in U4a r3.

**PC round trip against upstream `61d0eb79a`** (`u5\rt\results.md`, synthetic small fixtures, one PC, single runs; `doc-verifier` 18 claims: 15 verified, 2 incomplete, 1 unverifiable, none wrong; corrections appended there). K1: kv blocks pass through the fork and come out in both directions. K2: the fork's block-format export imports into upstream. K3: a fork profile without kv exports as msgpack, byte-identical to the previous build's export. P1: upstream's `_coldpluginIndex` converts to the fork layout and the fork's export imports into upstream with the same plugin values. S1: stub-form export round-trips. All five passed on decoded data. Each fork import raised and accepted the known "Inline Alice, chat 3: missing" question, which the D10 fixture causes (D10 section 4). Limits: no 61d0 code writes kv (`saveKV.set` has no caller), so the K1 original was hand-built and re-emitted by upstream; kv values are JSON-equal, not byte-equal, because store2's `canonicalJson` sorts object keys at every level while entry and array order is kept (the maintainer accepted this, `MC-331` 1); no UI open check, no device, no oversize leg, no damaged-kv leg, and upstream's re-import of the fork's first export (A) was not run.

### Follow-ups

- **Open, maintainer's call (S2a I1, S3 R1):** upstream deletes a superseded plugin index unit about an hour after replacing it, so older upstream numbered backups often point at an absent index. Under A4 and A5 those profiles get no `coldstorage/` cleanup in store2 old-data deletion (fork-format keys are still deleted; no loss), and a snapshot or live tree that points at an index upstream already deleted makes every manual cleanup stop with "reload and try again", which a reload does not fix until the snapshot is pruned (indefinitely if live memory carries it). It fails closed, as A4 and A5 require. Whether a snapshot-only missing index should count as nothing to keep needs an A4 amendment. U3 S3 finding C3 also corrected the handback's reason: no path brings a pointer into live memory during a run. The maintainer answered on 2026-10-21 (`MC-333` 1): "Missing = nothing to keep (Recommended)"; implementation is pending.
- **Legacy boot paths (finding 12b):** the bootstrap, `bootBlockLoad`, internal backup and Node shared-folder paths can install a tree carrying `_coldpluginIndex` unconverted (`MC-324` 9 keeps general upstream-save boot out of scope). Then a fork plugin's newer `_coldplugin` value for a key the index also defines loses to the index on a `.bin` re-import. Residual for the maintainer.
- **Accepted limitations, U4a:** F-A an unresolvable REMOTE pointer to a KV block keeps root's value (no writer produces it; salvage lists it as a character); F-B the `m3RJ`, `m3P` and `m3Q` mutants survive on impossible inputs. Also: a corrupted type byte is undetectable without a directory; several roots keep the last root's value (not legitimate input).
- **Accepted limitations, U4b:** A the writer checks string ids only for non-empty (eight strings that `isUsableCharacterId` rejects pass, for example `__proto__`); the exporter's id repair (`exportCopyOf`, `characterTreeRepair`) guarantees usable ids before the writer runs. Info B: upstream's encoder orders integer-like ids first; the fork keeps list order. Not covered: browser `DecompressionStream`, and `LoadLocalBackup` of a block-format entry with numeric ids. The writer takes JSON-clean kv values only (U4b ruling U-2, documented there); a non-JSON value throws through the existing export failure.
- **U3 A2 residuals:** `key`/`keys`/`length` list the internals and, on a store2 page, unit ids (as upstream, and also after `clear()`); flat writes that name `_coldplugin` directly are not guarded; an array `pluginCustomStorage` becomes `{}`; `setDatabase(proxy)` always marks `pluginCustomStorage` dirty (extra save work, no loss); a pre-existing race in which a stale V2 write between the store2 value write and the mapping, across an await, drops the value (the same on the base); mutant `m4` survives. S2a O1: mutant `m14` survives (folded into S2b). Index-level incomplete items carry the slot key `_coldpluginIndex` and a minted id, so the prompt cannot name the plugin key and the page import's conflict retry asks twice.
- **Ticketed in the Roadmap:** CHORE-187 to CHORE-193 (writer-supplied export errors hidden, a warning text that is false for same-name assets, the double conflict prompt, the A2 residuals, the `chatParseFailed` trailing comma, the `addTTSPreprocessor` JSDoc, load-sensitive test flakes). CHORE-186 is fixed by U3.
- **U1 non-blocking:** the `handleWrite` catch has no `res.headersSent` guard (cannot happen today); optional test hardening O1 to O3 in `u1\g2r2-verdict.md`.
- **Base64 transport:** landed after this merge. `main` fast-forwarded to `cd49e8271` (merges `2862940fe` into `feat/b64-transport`, carries `ac5b4e105`; pushed). Final checks at `cd49e8271`: `pnpm check` 0/0, `pnpm build` ok, `pnpm test` 20108 passed, 1 failed (`assetPieceSave` "without crypto.subtle" 5 s timeout; 23/23 alone three times; CHORE-193).
- **Next merge:** use `git log --no-merges 61d0eb79a..upstream/main`.

## 2026-10-25 — merge of upstream/main `f50b5942e`

Folded in from lane C (merge `20b115207`, "Merge lane C: upstream sync to f50b5942e (CHORE-331)"; lane C's records `Lanes/lane-C-records.md`, CHORE-331, `MC-440`, `MC-441`, rows 3351 to 3360). The disposition table and the conflicts text are lane C's text word for word; the range line and the persistence note keep lane C's facts with their labels reformatted; lane C's draft line named a section with that table, so the sub-headings, the "Last upstream commit merged" sentence and the next-merge command are lane A's assembly of it. On lane C's branch `lane-c-upstream-1023` the merge is `a2f3fb07e`, after the regression test `b724e2cc2`, with a comment fix `936f3667c`; Gate 1 `[APPROVE WITH AMENDMENTS]` for f71029477 (row 3354); Gate 2 `[APPROVE]` (row 3356). Lane A's full run on the merged snapshot is `lanec-up-full` (ledger).

**Upstream range:** `git log 61d0eb79a..upstream/main`: 9 commits, 7 non-merge (`9aae5e631` and `74d96626a`, the #1598 PR merge, are merges). The message of `a2f3fb07e` says "8 non-merge"; that is wrong and is left unrewritten. `git merge-base a2f3fb07e upstream/main` returns `f50b5942e`. The net change to the fork is one line in `src/ts/process/scriptings.ts` (plus upstream's trailing space on the line above it, kept byte-identical to upstream). **Last upstream commit merged: `f50b5942e`.**

### Disposition per upstream commit or group

| Upstream commit | Disposition | Reason / evidence |
|---|---|---|
| `63399cbd4` fix: disable proxy in lua | TAKEN as is | `luaFactory.createEngine({injectObjects: true, enableProxy: false})`. In wasmoon 1.16.0 (installed) the proxy extension hands Lua a live JS object (its `__index` and `__newindex` read and write the object itself); with it off, objects reach Lua as table copies of their enumerable keys (wasmoon copies with `for...in`). Other script-visible effects, identical to upstream: `type()` of a returned object is `table`, not `userdata`; `pairs` over an array yields 1-based indices; `tostring` of a JS error drops the `Error: ` prefix; class instances lose their methods. Gate 2 found no fork code that depends on these. Regression test `scriptings.test.ts` "a Lua script cannot write to a host prototype through an object an API returns": `simpleLLM` returns `{success, result}`; Lua writes `reply.__proto__.risuLuaPolluted`. Red on `91fdaac2d` (`Object.prototype` gained the key), green after the merge; the same test guards that `reply.success` and `reply.result` still read in Lua. The fork and upstream declare the same 54 Lua API names. `src/ts/process` and `src/ts/parser` (208 files, 4490 tests) pass with the change (session output, not preserved). |
| `72d2bacd9`, `ae54b830e` (#1598, merged upstream as `74d96626a`) setDatabase plugin round trip | ALREADY COVERED (CHORE-64, `48f00223`) | The fork's `setDatabase` never assigns `plugins`: `writeSetterKeys` skips the key and the list goes through `planPluginListWrite`, which merges by name and updates in place after a prompt. Upstream's defect line `newDb[key] = await handlePluginInstallViaPlugin(newDb.plugins)` is on `48f00223^`. Proof by test: `pluginListWrites.svelte.test.ts` "S1 ... setDatabase leaves every plugin as it was" drives the real V3 wrapper into the shared setter and passes on `91fdaac2d`; a scratch mutant that re-adds upstream's pre-fix assignment after `writeSetterKeys` fails it (53 of 137 fail, S1 among them). Upstream's same-name-in-place update matches the fork's S2/S3 tests. V2.1 plugin scripts no longer run (`MC-349`, CHORE-206), and the V2 setters are immune anyway (S2/S3 V2 callers; Gate 2 probe: an unchanged round trip or `[]` removes nothing). Gate 2's mutant forcing the wipe inside the shared `writeSetterKeys` failed 107 of 137, S1 and S5 on both `setDatabase` and `setDatabaseLite`; an undefined live `plugins` with `{plugins: []}` neither throws nor prompts. |
| `f71029477` plugin storage migration before loading plugins | NOT APPLICABLE | Built on upstream's `PluginStorageStore`, which the fork did not take (10-21 merge, G2). Upstream already migrated legacy values into `_coldpluginIndex` at `61d0eb79a`, in the background from `makeColdData`; this commit only runs it before `loadPlugins` when plugins are installed. It changes no persisted layout, so the fork's import conversion of `_coldpluginIndex` still covers upstream's `.bin`. The fork reads plugin storage per access (`pluginColdStorage.ts`) and has no lazy or background migration for a loading plugin to race; the store2 conversion of an upstream index runs in `bootDispatch.ts` while the database loads, before `loadPlugins`. Closest analogue, unchanged by this commit and not fixed by an adapted port: residual 12b in the 10-21 merge record (`MC-324` 9), where legacy boot paths can install an unconverted `_coldpluginIndex`; that is a precedence problem, not a race. Gate 1 `[APPROVE WITH AMENDMENTS]` (row 3354). |
| `63d85f9be`, `02a83695d`, `f50b5942e` version bumps (2026.10.210, .211, .220) | Fork side kept | `src-tauri/tauri.conf.json`, `database.svelte.ts` and `version.json` keep `0.1.0` and `up2026.8.250` (`MC-162` 3). No earlier sync met an upstream version change (upstream was `2026.8.250` from the fork point through `61d0eb79a`), so there is no precedent; `appSubVer` and `version.json` then moved to `up2026.10.220` at the maintainer's instruction (`MC-440`, row 3359). |
| `9aae5e631` | Upstream merge commit | No change of its own. |

### Conflicts and how each was resolved

`tauri.conf.json`, `bootstrap.ts`, `plugins.svelte.ts`, `coldstorage.svelte.ts`, `database.svelte.ts`, `version.json`: the fork's side of the whole file. `pluginStorageStore.ts` (modify/delete): stays deleted. `scriptings.ts` merged cleanly.

### Persistence

Nothing changes a persisted shape. MC-175: a `.bin` moves as before in both directions; upstream Lua scripts now see the same table-copy behaviour as upstream.

### Follow-ups

- **Next merge:** use `git log --no-merges f50b5942e..upstream/main`.

## 2026-10-30 — merge of upstream/main `ea61945f9`

Merge commit: `9755ce9f7` ("Merge upstream ea61945f9: plugin sandbox and lifecycle fixes, plugin docs, up2026.10.292"). Parents: `00678a689` (`main`, the CHORE-552 merge) and `ea61945f9`. It was built on the branch `lane-a/upstream-ea61945`, and `main` fast-forwarded `00678a689..9755ce9f7` and was pushed (lane A handoff, 2026-10-30). `git merge-base HEAD ea61945f9` returns `ea61945f9038e0189807d075f55f4e66ab7e98bf` (run 2026-10-30; `git rev-parse 9755ce9f7^2` is the same hash). `git show --stat 9755ce9f7`: 10 files changed, 881 insertions, 33 deletions.

**Upstream range:** `f50b5942e..ea61945f9` (upstream v2026.10.292): 25 commits, 21 non-merge. The four merges (`88b1c3e76`, `26f47fc88` = PR #1536, `cca8aab50` = PR #1686, `eea01c2f1` = PR #1685) carry no change of their own (`git diff-tree --cc` on each returned no lines; `upstream-ea61945\verify.md`). `git log --oneline f50b5942e..ea61945f9` was re-run for this record and lists the 25 hashes used below. **Last upstream commit merged: `ea61945f9`.**

**Why.** The maintainer asked for a triage of the 25 new commits "for merge" (`MC-901`). The triage (`upstream-ea61945\triage.md`, `investigator`) and its `doc-verifier` check (`verify.md`, PASS WITH CORRECTIONS, descriptive fixes only, applied below) classified 13 commits as TAKE (the plugin sandbox and lifecycle fixes and their docs), left the rest skipped, already in the fork or open questions, and put four questions to the maintainer. The answers and the decision to merge into `main` and push are `MC-901`.

**What the merge adds.** V3 plugin lifecycle and bridge fixes: every V3 plugin is unloaded on a plugin reload (the fork skipped every second plugin because `loadV3Plugins` iterated the live array that `unloadV3Plugin` splices); a plugin's replacers are removed when it unloads; `SafeMutationObserver` payloads cross the iframe bridge intact and now expose removed nodes (`getRemovedNodes()`); instance registry entries are released when guest proxies are collected (batched, with monotonic host ids); and a released remote reference passed back as an argument now fails with "Instance not found or released" (before, the raw reference object reached the host function). Plus the matching `plugins.md` and `migrationGuide.md` examples, and the version suffix `up2026.10.292`. Behaviour notes from Gate 1: every enabled plugin is now restarted on each `loadPlugins()` (before, about half stayed running with a stale script; this matches upstream), and the released-reference throw only affects a plugin that passes back a reference it already released (the gate found no working plugin that depends on the old behaviour; MC-175).

**Mechanism.** `git merge -s ours --no-commit upstream/main` (tree = the fork), then the files that carry the taken changes were brought in by a 3-way file merge: `factory.ts`, `v3.svelte.ts`, `plugins.md` and `migrationGuide.md` (`git merge-file` with base `f50b5942e`, the fork as current side and `ea61945f9` as the other; exit 0 for all four, no markers), plus the one `getRemovedNodes()` hunk of `risuai.d.ts` added by hand, the suffix on three lines, and the two new test files. The merge-and-resolve route was not used because Gate 1 ran `git merge-tree --write-tree` in a scratch clone (merge base `f50b5942e`; 14 conflicted paths, 19 files differing from the fork) and found that four skipped changes auto-merge cleanly with no conflict marker, so resolving only the conflict markers would have kept them:

1. `src/ts/process/modules.ts`: `a0598d546` adds `delete module.mcp` in `readModule` and `delete importData.mcp` in `importModuleJson` (the triage had predicted these would not apply by context). They would strip module MCP data on import, against Q2 below.
2. `src/ts/plugins/apiV3/risuai.d.ts`: a clean hunk from `83eb7880b` adds a `setDatabase` plugins note ("only API 3.0 plugins that are new or whose script changed are applied ...") that contradicts the fork's own note (merge by name, prompts, update flow). The `setDatabaseLite` doc change conflicted.
3. `src-tauri/capabilities/migrated.json`: `41ea80377` removes the first `shell:allow-open` cleanly, a silent change to the fork's capability list (whether `shell:default` covers it was not verified).
4. `server/node/server.cjs`, `src/ts/storage/nodeStorage.ts` and `src/lang/{en,ko,zh-Hant}.ts`: about ten clean hunks in `server.cjs` (a second route-wrapper loop beside the fork's `asyncRoute`, `/hub-proxy` header and redirect additions merged into the fork's stricter `hubProxyFunc`, `login` additions, the `set_password` token check, `logSetupLink` calls), one in `nodeStorage.ts`, and non-conflict lang hunks.

The same review also found that the planned "merge, then cherry-pick the 13 commits" would double-apply G1 and G2 (Gate 1 F3), so one mechanism was chosen (condition C2).

### Disposition per upstream commit or group

Hashes are from `git log --oneline f50b5942e..ea61945f9` (re-run for this record) and `upstream-ea61945\triage.md`; the triage's group labels (G1 to G8) are kept. Counts: 8 + 5 taken, 1 already covered, 1 skipped, 3 open commits answered by the maintainer, 3 version bumps = 21 non-merge commits.

| Upstream commit(s) | Disposition | Reason / where |
|---|---|---|
| G1: `67cc80cf4` unload every V3 plugin on reload; `42fe0ee90` remove V3 replacers on unload; `8da6d954e` restore SafeMutationObserver payloads across the bridge; `39dbc3151` expose removed nodes; `0b4eb929b` auto-release instance registry entries when guest proxies are collected; `89efce436` monotonic ids; `bb49b30ca` reject released remote refs passed as arguments; `1309ee299` batch auto-release messages | TAKEN (8 commits) | `9755ce9f7`, files `factory.ts` and `v3.svelte.ts` (`risuai.d.ts` gets only the two-line `getRemovedNodes()` hunk of `39dbc3151`). The fork had the `loadV3Plugins` defect and no replacer unload callback (triage and Gate 1, read in source). Applied by 3-way file merge, diff equal to upstream's hunks (Gate 2 compared `git diff f50b5942e ea61945f9` with `git diff 00678a689 9755ce9f7` by eye for both files). |
| G2: `71983e768`, `3eb463078`, `dd585480d`, `385f6a5db`, `fc9eb42a2` plugin docs (SafeMutationObserver examples) | TAKEN (5 commits) | `9755ce9f7`, `plugins.md` and `src/ts/plugins/migrationGuide.md`; the filtered added/removed lines are byte-identical to upstream's (Gate 2: 51 changed lines). The fork had changed these files too (`plugins.md` +97/-24, `migrationGuide.md` +3/-3 against the merge base, `verify.md`) with no overlap. |
| G3: `83eb7880b` install-via-plugin confirm names the plugin and warns on replace | ALREADY IN FORK; hunks skipped | The fork's `handlePluginInstallViaPlugin` already names `{source}` and `{plugin}` in all 7 locales; a same-name plugin goes to the fork's version-checked update flow (`confirmUpdatePluginViaPlugin` and related; corrected by `verify.md`: it is not simply refused). Upstream's `replacing` branch reads `DBState.db.plugins` in a function the fork rewrote, and the `setDatabase` doc text it adds describes behaviour the fork's update flow does not have. Files touched upstream: `en.ts`, `zh-Hant.ts`, `risuai.d.ts`, `plugins.svelte.ts`. CHORE-64 already covers the `setDatabase` plugin round trip (10-25 record). |
| G7: `4b0aa2f7e` use a nonce in the Drive authentication flow | SKIPPED | Edits `src/ts/drive/drive.ts` (deleted in the fork with Drive removal, CHORE-33) and the `driveAuthInvalid` key in en/ko only. Modify/delete conflict resolved to stay deleted; the key is not added. |
| G5: `a0598d546` trim `mcp` data from modules on import | SKIPPED (Q2: keep the fork's behaviour) | The module's `mcp` is kept on import; a stdio entry runs only after command-specific consent (MC-873, MC-877; MC-175 for upstream modules). Silent auto-merge into `modules.ts` caught and reverted, see Mechanism item 1. |
| G6: `41ea80377` temporarily block stdio MCP | SKIPPED (Q3: keep the fork's stdio) | The fork's consent-gated stdio feature and its spawn allow-list stay as CHORE-552 left them; `migrated.json` resolves to the fork side. Upstream's own message says it is reworking stdio, so a later sync will probably touch the same lines. |
| G4: `f5c563110` Node magic link (five parts) | Items 1 to 3 ALREADY IN FORK; item 4 SKIPPED (Q1); item 5 DEFERRED to CHORE-589 | Items 1 to 3 (route wrapper, `/hub-proxy` hardening, `login` type guard): the fork has `asyncRoute`, the stricter `hubTargetURL`/`hubRequestHeaders`/`hubRedirectTarget`/`hubResponseHeaders` helpers and the guards (`verify.md`). Item 4 (one-time setup token in the server log, required by `/api/set_password`): the maintainer kept first-client-wins (Q1; MC-523, MC-191). Item 5 (500 on a failed password-file write) was left out so that `server.cjs` stays byte-identical to the fork, which proves no Node-auth change came in; the gap it points at is real and ticketed as CHORE-589. The new `nodeSetupLinkRequired` key is not added (it would also need all 7 locales). |
| G8: `da89a0dcb`, `f6bf8d82e`, `ea61945f9` version bumps (2026.10.220 to .290, .291, .292) | Fork side kept; suffix moved (Q4) | `appVer` and `tauri.conf.json` stay `0.1.0` (MC-162 3). `appSubVer` in `database.svelte.ts`, `version.json` (`0.1.0-up2026.10.292`) and README line 33 move to `up2026.10.292`. Q4 settles the open point of MC-440: the suffix moves on every sync, so the next merge moves it again. `git grep up2026.10.220` outside `Agents/` returns nothing (Gate 2 on `9755ce9f7`). The `tauri.conf.json` upstream side carries `productName "RisuAI"`, `identifier "co.aiclient.risu"` and the new version; none of it landed (app ID and key are fixed). |
| Upstream merge commits `88b1c3e76`, `26f47fc88`, `cca8aab50`, `eea01c2f1` | Upstream merge commits | No change of their own beyond the commits above. |

Triage corrections applied (from `verify.md`): the lang changes are en 4 keys (`confirmInstallPluginViaPlugin`, `confirmReplacePluginViaPlugin`, `driveAuthInvalid`, `nodeSetupLinkRequired`), ko 2 and zh-Hant 2, and upstream touches no cn, de, es or vi file. The fork line numbers in the triage's G1 section were stale (the conclusions did not change). The fork's `RELEASE_INSTANCE` and `beginChokePoint('pluginBridge')` hunks are 19 lines apart in `factory.ts` and merged without a conflict.

### Conflicts and how each was resolved

Because the commit was made with `-s ours`, it contains no conflict resolution as such; the list below is the Gate 1 simulation (`g1\mergetree.txt`) with the condition C1 rule that every skipped file ends as the fork's. The fork's side of the whole file: `server/node/server.cjs`, `src/ts/storage/nodeStorage.ts`, `src/ts/process/mcp/mcp.ts`, `src/ts/process/modules.ts`, `src/ts/characterCards.ts`, `src/ts/plugins/plugins.svelte.ts`, `src-tauri/capabilities/migrated.json`, `src-tauri/tauri.conf.json`, `src/lang/en.ts`, `src/lang/ko.ts`, `src/lang/zh-Hant.ts`, `src/ts/storage/database.svelte.ts` (then only `appSubVer = 'up2026.10.292'`) and `version.json` (then `0.1.0-up2026.10.292`). `src/ts/drive/drive.ts` stays deleted. `risuai.d.ts` is the fork's with only the two-line `getRemovedNodes()` hunk. `README.md` was not in the upstream range; line 33 was edited by hand for the suffix (MC-441). Mechanical proof, run by the coder and again by Gate 2 on `9755ce9f7`: `git diff 00678a689 9755ce9f7 -- src/lang server src-tauri src/ts/process src/ts/storage/nodeStorage.ts src/ts/characterCards.ts src/ts/plugins/plugins.svelte.ts` is empty, and `git diff --stat 00678a689 9755ce9f7` lists exactly the 10 files named above.

### Persistence

Nothing changes a persisted shape. No `.bin`, risuSave, bootstrap, backup, cold-storage or plugin-storage file is in the upstream range or in the merge diff (triage; Gate 2 diff). MC-175: upstream V3 plugins keep working; the only behaviour change a plugin can see is the released-reference error described above.

### Fork additions

Two test files, in the merge commit: `src/ts/plugins/apiV3/factory.bridge.test.ts` (11 tests, drives the real `SandboxHost` with synthetic `MessageEvent`s and evaluates the real guest script read from `iframe.srcdoc` against a fake `FinalizationRegistry` and a manual microtask queue) and `src/ts/plugins/apiV3/v3.lifecycle.svelte.test.ts` (6 tests). Gate 1 asked for R1 to R8 as regression reproducers and G-a to G-d as compatibility guards: R1 plugin reload unloads both plugins, R2 replacer removed on unload, R3 distinct ids with a constant `Math.random`, R4 batched `ids[]` release, R5 released reference throws and the chokepoint stays balanced, R6 removed nodes reach the guest (host and end to end), R7 callback arguments deserialize in the guest, R8 collected proxies release in one batched message. G-d is the existing `v3DeclarationDocs.test.ts`. Red on base: with `factory.ts` and `v3.svelte.ts` replaced by their `00678a689` versions in a scratch copy, 11 of the 17 new tests fail and 6 pass (the labelled guards; the coder's and Gate 2's runs agree). Condition M1 (a `readModule` test that `mcp` survives) was dropped because `modules.ts` is byte-identical to the fork and the empty-diff check above is its substitute.

### Review

Gate 1: `adversarial-reviewer` `[ACCEPT WITH CONDITIONS]` (`upstream-ea61945\g1\gate1-r1.md`; conditions C1 to C7: whole-file rule, one mechanism, the C3 diff check, the suffix, the tests, these records, and Gate 2 by `adversarial-reviewer` because no hunk touches persistence, save format, reactive database or asset caching). Findings: F1 to F3 substantive (plan: the silent inclusions and the double application, all fixed by the mechanism), F4 editorial triage statements (corrected above), F5 the `set_password` ordering (CHORE-589), F6 the late registration after unload (CHORE-590). Gate 2: `adversarial-reviewer` `[APPROVE]` in one round (`g2\gate2-r1.md`). It reran C3, confirmed the merge base and the suffix, ran R1 to R8 red on the base, and mutated the merged files one at a time: of 12 mutants, 10 were killed (dropping the registry registration, the replacer unload callback, the monotonic ids, the `serialize(arg)` call, the "Instance not found" throw, the `ids` loop, `deserializeResult`, the removed-nodes wiring, the held value and the microtask guard) and 2 survive: `WeakMap` replaced by `Map`, and dropping the `void proxy` pin. Both are garbage-collection lifetime properties that a fake `FinalizationRegistry` cannot observe; they are an editorial limitation, not a merge defect, and are folded into CHORE-590. The coder's own mutant (`[...v3PluginInstances]` back to the live array) failed R1, its companion and R2. An editor-reported TypeScript error in `v3.lifecycle.svelte.test.ts` did not reproduce (`pnpm check` 0 errors; the editor snapshot was stale; TODO(evidence): the editor's live diagnostics were not readable).

### Checks

Targeted, at `9755ce9f7` (Gate 2): `pnpm vitest run src/ts/plugins` 36 files, 652 tests passed; the two new files 17 passed; `pnpm check` 0 errors, 0 warnings; `tsc --noEmit` showed 10 errors in unrelated files and none in the new ones. Trial on the final snapshot (`%TEMP%\risu-b715\trial-up-wt` at `9755ce9f7`, lane A handoff 2026-10-30): 1204 test files, 27,685 passed, 0 failed; `pnpm check` 0/0; `trial-up-full\full.exit.txt`: `test1 exit 0`, `check exit 0`, `build exit 0`, `dist exit 0`; `full.test1.txt`: Test Files 1204 passed | 2 skipped (1206), Tests 27685 passed | 25 skipped (27710); `full.check.txt`: svelte-check found 0 errors and 0 warnings; `install.exit.txt`: install exit 0. Limits: nothing ran against a real iframe or browser (bridge tests use mocked windows in jsdom or happy-dom); `FinalizationRegistry` timing under the Android WebView was not exercised (Gate 1 notes the project's Note 9 WebView is 155 and the registry is already used elsewhere in the app); the garbage-collection pair is covered by a fake registry only.

### Follow-ups

- **CHORE-589** (open): Node `/api/set_password` assigns the in-memory password before `writeFileSync`. A failed write leaves memory set and the file empty, a retry answers 400 "already set", and a restart loses the password. Fix: write first, assign after, answer 500; add a `nodeAuth` route test; security reviewer. Source: Gate 1 F5 (and upstream `f5c563110` item 5).
- **CHORE-590** (open, optional hardening): `addRisuReplacer` and `addRisuChatListener` await a permission prompt and register the unload callback afterwards, so an unload while the prompt is open leaves a replacer pointing at a terminated iframe. No reproducer (Gate 1 F6; upstream has the same code). Also carries the Gate 2 editorial: the `WeakMap` and `void proxy` hunks have no pinning test.
- **Decisions:** `MC-901` (Q1 to Q4 and the merge confirmation). Ledger rows 4629 to 4631 (triage and verification; Gate 1, implementation and Gate 2; trial and merge `9755ce9f7`).
- **Next merge:** use `git log --no-merges ea61945f9..upstream/main`. Move the version suffix again (Q4) in `appSubVer`, `version.json` and README line 33.
