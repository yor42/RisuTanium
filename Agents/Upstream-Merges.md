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
