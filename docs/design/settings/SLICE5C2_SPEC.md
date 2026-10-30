# Settings slice 5c-2: 데이터·백업, 고급 and 언어

Rev 1, 2026-10-28.

- **Decisions:** DS-176..DS-191 in [DECISIONS-settings.md](DECISIONS-settings.md); DS-101/DS-154 (full refine); DS-152 and DS-153 (scope).
- **Shared-pattern decisions:** DD-219..234, DD-244, DD-245, DD-251..257 and DD-229 in [../DECISIONS.md](../DECISIONS.md).
- **Research:** [research/slice5c2-data-adv-lang.md](research/slice5c2-data-adv-lang.md), cited below as **R**. Anchors (`BL:`, `IB:`, `ADV:`, `LNG:`, `DB:`, `WP:`) use R's abbreviations.
- **Builds on:** slices 1–5c-1.
- **Shared pattern:** [../patterns/README.md](../patterns/README.md), [WARNINGS_AND_PROGRESS.md](../patterns/WARNINGS_AND_PROGRESS.md), [MOTION_CONTRACT.md](../patterns/MOTION_CONTRACT.md), plus `pattern.js`, `pattern.css` and `demo.html`.

## 0. Decisions in force

- **DS-153:** 데이터·백업 warnings and every backup, restore, export and import progress run on the shared pattern (`RisuPattern`), not a Settings-only copy. DD-228: show `.bin` and the fork-only `.rtb`, never `.risub`.
- **DS-176 Cancel:** restore Cancel ends before the first write. That is the first asset write (R §1.3 step 5), not the database swap.
- **DS-177 Backup format:** one backup action with a format choice:
  - `.rtb` is the default and includes keys.
  - `.bin` is the RisuAI-compatible option, with the DD-227/DD-251 caution sheet.
  - Restore takes either format, with the same steps.
- **DS-178, DS-187 Settings file:** settings-file export and import is a **new feature**. The file holds app settings and preset choices only, never API keys or chats. Import shows what will change and has Undo.
- **DS-179:** the persist-storage row is removed.
- **DS-180:** the cold-storage switch moves to 데이터·백업 › 저장 공간, default on.
- **DS-181:** the snapshot list shows date, size and character count.
- **DS-182:** a file restore keeps a safety snapshot of the current data first (engine change), and the sheet says so.
- **DS-183:** the Realm go-to-character row stays on 데이터·백업 under imports.
- **DS-184 Retired rows:** streaming optimisation is removed. `showDeprecatedTriggerV1` and `legacyMediaFindings` go in a collapsed 권장하지 않음 group until main confirms whether they are dead.
- **DS-185:** keep the two gate switches (`useExperimental`, `showUnrecommended`), each revealing its own section.
- **DS-186:** diagnostics form one 문제 해결 group on 고급: request logs, statistics and the bug-report export.
- **DS-188:** `translang` is kept as "번역 파일 받기".
- **DS-189:** a language change applies after reopening. An inline line says so, with a reopen button.
- **DS-190:** after a restore, the result card shows what was restored, and 다시 시작 reloads.
- **DS-191:** the `.bin` leave-out list carries a visible mock label. An empty list shows no sheet.

## 1. Frozen files and where 5c-2 code lives

Main froze these until its combined lint commit lands:
- `themes/banana-cocoa.css`;
- `index.html`;
- `slice2.js`, `slice3.js`, `slice4.js`, `slice5a.js` and `slice5b.js`;
- `theme-tokens.css` (it is part of the same commit);
- the existing th registries.

**Do not edit them.** If something seems to need one, stop and report it, so the parent can ask main.

- **Pattern loading:** `slice5c2.html` loads the pattern's files in the order README gives: `theme/pattern-tokens.css`, `brand/nexus-mark.css`, `patterns/pattern.css` and `patterns/motion.css`, then the Settings CSS. After that come `mockups/nexusMark.iife.js` and `patterns/pattern.js`, then the Settings scripts. Do not copy any pattern file.
- **Token aliases:** they go in `slice5c2.css` (`--settings-x: var(--pattern-x)` style), not in `theme-tokens.css`.
- **Registry:** a new `checks/th5c2/registry5c2.mjs` extends the 5c-1 registry. It merges the pattern's registry fragment with `mergeRegistry` and adds `settable` for `--p5c2-*`, with floors and ceilings for its size tokens.
- **Banana Cocoa:** if `banana-cocoa.css` needs `--nexus-warning-rgb` or rules for the pattern parts, list them in the Build notes as a pending edit for main. Check how the pack looks without them; if the pattern's defaults read correctly, say so.

## 2. 데이터·백업 (`data`)

### 2.1 Groups

1. **백업:**
   - **백업 만들기**, the one action (DS-177). It opens a small sheet with three choices:
     - 형식: `.rtb` (권장 · 이 앱의 모든 데이터와 연결 키) or `.bin` (RisuAI와 호환).
     - 범위: 전체 or 일부 (캐릭터 에셋 제외; the app's partial backup).
     - 시작, which starts the task.
   - **불러오기:**
     - 파일에서 불러오기 (`.rtb` or `.bin`).
     - 자동 스냅샷에서 불러오기, which opens the snapshot list (DS-181).
2. **내보내기·가져오기:**
   - **데이터셋으로 내보내기** (`exportAsDataset`).
   - **설정 파일 내보내기 / 가져오기**, a new feature tagged `새 기능` (DS-178, DS-187).
   - **Realm에서 가져온 뒤 캐릭터로 이동** (`goCharacterOnImport`; help: Realm import only).
3. **저장 공간:**
   - **오래된 캐릭터 보관하기** (`archiveCharacters`, default on, moved from 고급, DS-180). Help: what archiving does. Turning it off clears the archive memo (R §1.5), so the off switch shows an inline line saying so.
   - **쓰지 않는 보관 데이터와 파일 정리** (`cleanColdStorage`).
   - **이미지 캐시 점검** (`verifyAssetIntegrity`) and **시작할 때 손상 확인** (`checkCorruption`, default off). Both are web and Node only: on the `desktop-app` and `android` fixtures, show a note instead.

Removed: invented `data.persist` (DS-179) and the invented old export/import rows. They are replaced by the new tagged feature.

### 2.2 Operations on the pattern (R §3.3 is the map; use it)

One `RisuPattern.openTaskFlow` per operation. The page keeps a `busy` flag: a second operation while one runs is refused with a notice (the app's `refuseBackupLoadWhileBusy`).

| Operation | Warning | Steps (`write:true` on the first writing step) | Cancel | Result |
|---|---|---|---|---|
| `.rtb` backup | `caution` when the profile has keys: "연결 키가 파일에 들어가요. 다른 사람에게 보내지 마세요" | 파일 준비 → 이미지·에셋 {n}/{m} → 인레이 {n}/{m} → 보관 데이터 {n}/{m} → 데이터베이스 저장 | Until the file opens (the first write), then hidden with the pattern's reason line | Size, counts and skipped assets, from the app's skip list |
| `.bin` backup | `caution` with `leftOut` (DD-251) and `mock: true` (DS-191). Headline ".bin에는 이 앱에서만 쓰는 데이터가 담기지 않아요". Actions: cancel / secondary "`.rtb`로 만들기" / primary "그래도 .bin으로" | as `.rtb` | as `.rtb` | Repeats "이 파일에 담기지 않은 것" |
| Partial backup | `confirm` listing what is included and left out, replacing the app's three confirms | 담을 항목 확인 → 프로필 이미지 {n}/{m} → 보관 데이터 → 데이터베이스 | as above | Lists missing profile images |
| Restore from file | `danger`, Cancel focused, the 250 ms guard. Consequences: "캐릭터 {n}개, 채팅 {m}개가 파일 내용으로 바뀌어요 (지금 {n'} / {m'})"; "파일에 없는 이미지는 지금 것을 그대로 둬요"; "바꾸기 전에 지금 상태를 자동 스냅샷으로 남겨요" (DS-182) | 파일 확인 → 다른 탭 확인 → 안전 스냅샷 만들기 → **이미지·보관 데이터 쓰기 (`write:true`)** → 데이터 교체하기 → 저장 확인 | Only during 파일 확인 and 다른 탭 확인 (DS-176) | DS-190: the result card (counts and notices), then 다시 시작 (simulated reload) |
| Restore from snapshot | `danger` as above, with the snapshot's date, size and character count | 스냅샷 확인 → 다른 탭 확인 → 안전 스냅샷 만들기 → 데이터 교체하기 (`write`) → 저장 확인 | Before 데이터 교체하기 | As above; the card says "방금 상태가 목록에 저장됐어요" |
| Dataset export | none | 보관소에서 읽기 {n}/{m} → 파일 만들기 | Between characters | Names unreadable archived characters |
| Clean unused data | `danger` (DD-229): "파일 {n}개, {size}를 지워요. 되돌릴 수 없어요". This copy is true here | 확인 → 지우기 {n}/{m} | Before the first delete only | No Undo |
| Verify image cache | none | 읽기 {n}/{m} → 확인 | Between batches | A mismatch table, then a `confirm` to evict them |
| Settings file export | `notice`: "연결 키와 채팅은 담기지 않아요" | Short, or no task: a direct simulated download plus a toast | n/a | The file name |
| Settings file import | `confirm` with a change summary: "설정 {n}개가 바뀌어요" and the first 3 names, plus "그 밖에 N개 보기" | 파일 확인 → 적용 | Before 적용 | Grouped 가져오기 되돌리기 for 10 s from the result (DD-225); toast until-line as in DD-223/DS-166 |
| Snapshot list (DS-181) | Not a warning | A list sheet: date (relative and absolute), size and character count. Selecting one leads to the restore flow | | |

- **Blocks:** use the pattern's blocks. `other-tab` applies when another tab holds the lock, and `offline` doesn't apply. The fixture `failing` exercises:
  - a write failure with the data unchanged;
  - a state-unknown failure after the first write, with the pattern's `fail({dataState:'unknown'})` copy;
  - an asset over 4 GiB, which is skipped and named;
  - a damaged-block salvage `confirm` (R §1.3 step 6).
- **Web memory notice:** when the download helper is missing, the backup is built in memory first. Show a `notice` before the run (R §1.2) on the `web-memory` fixture.
- **Sizes and counts:** synthetic, from the fixture. Mark estimates as estimates.

## 3. 고급 (`adv`)

The page header keeps a calm warning ("뭘 하는지 모르면 바꾸지 마세요" style, plain), not red. Groups, from R §1.5 and §4:

1. **요청:** generation choices (`genTime`, relabelled "한 번에 받을 답 수"; keep the app's bounds but say what it is), vision quality, request location (plain web only), auto-continue and its min tokens, remove incomplete response, anti-server overload, force OpenAI proxy format, autofill request URL, new OpenAI handling, say-nothing input, local network mode and its timeout (labelled experimental but not gated, as in the app), and the experimental-help bools from R.
2. **로어북:** search depth (0–20, default 5) and max tokens (0–4096, default 800).
3. **채팅 불러오기:** initial and additional pages (min 1, defaults 30/15; the unit is pages).
4. **화면 조정:** height mode (plain labels; the `vh` and other units explained in help), image compression on export, scroll to active character, dynamic assets and their edit display, realm direct open.
5. **프롬프트 글:** additional prompt, description prefix and preset chain. `emotionPrompt2` moved to 감정 이미지 in 5b; search finds it there.
6. **문제 해결 (DS-186):**
   - request logs (a simulated sheet), statistics (a simulated table with the app's accuracy note), and the bug-report export (says which key families are removed);
   - dev tools, plugin develop mode, return CSS error, prompt info in chat (Node/Tauri only) and request info in chat;
   - simplified tool use and remember tool usage;
   - keep session alive (not Android; help corrected in 5c-1);
   - allow all file types.
7. **기능 공개 (DS-185):** the two gate switches. Each reveals its own collapsed section below it:
   - **실험적 기능:** Google Cloud tokenizing, auto cache point, new Google Translate, Claude caching retrieval. Streaming optimisation is removed (DS-184).
   - **권장하지 않음:** chain of thought, force plain fetch, deprecated trigger v1 and legacy media findings (DS-184).
8. **Custom components:**
   - **글자 종류 막기** (`banCharacterset`): 18 script toggles with localised names, as in the app.
   - **사용자 모델** (`customModels`): a list with add, rename, reorder and delete. Delete gets an Undo toast (DD-223) instead of the app's unconfirmed delete. If slice 3 already designs custom models on 모델, link there instead and say which.

Every row uses its real field, default and bounds from R §1.5. R §2.2 lists the mockup's wrong values; replace them.

## 4. 언어 (`lang`)

- **앱 언어 (`language`):** de, en, ko, cn, zh-Hant, vi and es, with native names.
  - Choosing one shows the calm inline line "설정을 닫았다가 다시 열면 바뀌어요" and a 다시 열기 button (DS-189). The button simulates a reopen; in the mockup that applies `lang`.
  - Keep the mockup's own `?lang=` demo control working.
- **번역 파일 받기 (`translang`):** a row with help text (download a community `lang.json`) and a simulated download.
- **번역:** 5b's design stays as built. Add the two missing items from R §2.3:
  - the DeepL web warning, when DeepL is chosen on web;
  - the source language row (Google only), if 5b lacks it.
  
  Do not change 5b's files.

## 5. Keyboard, motion, accessibility

- The pattern owns focus, `inert`, the arm guard, reduced motion and low power. Settings must not override them.
- Triggers return focus as the pattern specifies.
- The format and scope choices are radio groups.
- The snapshot list is a listbox, or a list of buttons with full accessible names (date, size and count).
- Check 360 and 1280, KO and EN, `?reduced=1` and `?lowpower=1`.

## 6. Integration map (Lane A)

The builder writes "Engine items" at the end of this spec. They must cover:

- the `.rtb` format (new: contents, keys included, restore path);
- the `.bin` leave-out list (DD-227, supplied by Lane A);
- an abort signal for the restore index walk;
- the safety snapshot before a file restore (DS-182);
- snapshot size and count (DS-181);
- the restore result before the reload (DS-190);
- settings-file export and import (new; format and contents, DS-187);
- the progress events replacing the English hard-coded wait text (R §1.2);
- `archiveCharacters` moving pages;
- persist removed;
- the 고급 regroup and relabels;
- streaming removed;
- the two legacy rows pending confirmation;
- `customModels` delete with undo;
- the language-change line;
- the pattern adoption (files, registry merge, `--nexus-warning-rgb` in packs).

## 7. The mockup

### 7.1 Files

- `slice5c2.html`, `slice5c2.css` (`--p5c2-*` and the pattern aliases), `slice5c2.js` (hooks on `SS1_EXT`, loaded after `slice5c1.js`) and `data5c2.js` (rows, copy and fixtures).
- `checks/ss5c2/**` and `checks/th5c2/**`, plus the `run.mjs` suites `ss5c2` and `th5c2`.
- Do not change `index.html`'s target. The parent asks main to point it at `slice5c2.html` after the commit lands.

### 7.2 Fixtures (`?set=`)

| Set | Contents |
|---|---|
| `demo` | Keys present; 3 snapshots; 120 characters and 2,400 chats (synthetic); archiving on. |
| `failing` | The failures listed in §2.2. |
| `other-tab` | The restore lock is held. |
| `web-memory` | The download helper is missing. |
| `desktop-app` | Tauri desktop: no image-cache rows. |
| `android` | Tauri Android: no image-cache rows; keep session alive hidden. |
| `empty` | No snapshots; nothing to clean. |
| `experimental` | Both gates on. |

### 7.3 States (`?state=`)

- **da-:** `da-backup-sheet`, `da-bin-caution`, `da-rtb-run`, `da-run-cancel-hidden`, `da-backup-done`, `da-partial-confirm`, `da-restore-warning`, `da-restore-run`, `da-restore-unknown`, `da-restore-done`, `da-snapshots`, `da-clean-confirm`, `da-verify-table`, `da-settings-import`, `da-settings-undo`, `da-busy-refused`, `da-archive-off`.
- **ad-:** `ad-groups`, `ad-experimental`, `ad-unrecommended`, `ad-diagnostics-logs`, `ad-diagnostics-stats`, `ad-custom-models-undo`, `ad-banchars`.
- **la-:** `la-change-pending`, `la-translang`, `la-deepl-web`.
- **se-:** `se-persist-none`, `se-streaming-none`, `se-archive-moved`, `se-emotionprompt`.

### 7.4 Checks

- **ss5c2:**
  - every row's field, default, bounds and visibility against R;
  - every state;
  - each operation's warning severity, steps, Cancel visibility at each step (the restore Cancel hides at the first write), result and undo;
  - the busy refusal, keyboard, 360 and 1280, KO and EN, reduced motion and low power;
  - no console errors;
  - no `.risub` anywhere.
- **th5c2:** parts and critical names (including the pattern's critical parts), the merged registry, floors and ceilings, default look.
- **Regression, one at a time:** ss1–ss5b, ss5c1, hr, th, th4, th5a, th5b and th5c1. Do not run the pattern's own suite; it isn't ours. You may read its checks for reuse.
- Use distinct `--tag`s and logs in `checks/logs/5c2-*.log`. Run at most 3 Chrome workers. Leave no processes.

## 8. Korean copy

Filled by the builder from `data5c2.js` (generated by `checks/ss5c2/_gen-copy.mjs`; a function key is shown with `{1}`, `{2}` ... for its arguments). The table covers every label, explanation, warning, consequence, failure and empty state of the page copy; the pattern's own strings (the five severities, the steps, the results, the undo line) come from `patterns/pattern.js`; this slice adds its own with `RisuPattern.addStrings` (the second table) and overrides two of the pattern's (`task.done.import`, `task.undone.summary`, whose pattern copy says "추가" / "added", which is wrong for a settings import). `koen` reads the table back and compares it with the code in both languages. The catalogue's labels, descriptions and help of the new rows (`data5c2.js`) are in the rows themselves (`ko`, `en`, `desc`, `help` as `한국어|English` pairs) and are not repeated here.

- Use 첫 메시지, never "greeting". No `.risub` anywhere (DD-228).
- Pattern strings come from the pattern. Headlines keep the pattern's target of 36 characters in Korean and 60 in English (DD-257); `koen` measures every headline this slice defines.

| Key | 한국어 | English |
|---|---|---|
| `title` | 설정 슬라이스 5c-2 · 데이터·백업, 고급, 언어 목업 | Settings slice 5c-2 · Data & backup, Advanced and Language mockup |
| `cancel` | 취소 | Cancel |
| `close` | 닫기 | Close |
| `later` | 나중에 | Later |
| `newTag` | 새 기능 | New |
| `newTagTitle` | 앱에 없던 새 기능이에요 (제안) | A new feature the app did not have (proposal) |
| `relMin` | {1}분 전 | {1} min ago |
| `relHour` | {1}시간 전 | {1} h ago |
| `relDay` | {1}일 전 | {1} d ago |
| `archived` | 보관됨 | archived |
| `damagedBlock` | 손상 | damaged |
| `bkT` | 백업 만들기 | Make a backup |
| `bkFmt` | 형식 | Format |
| `bkRtb` | .rtb · 권장 | .rtb · recommended |
| `bkRtbD` | 이 앱의 모든 데이터와 연결 키가 들어가요 | Everything in this app, including connection keys |
| `bkBin` | .bin | .bin |
| `bkBinD` | RisuAI와 호환돼요 | Compatible with RisuAI |
| `bkScope` | 범위 | What to include |
| `bkFull` | 전체 | Everything |
| `bkFullD` | 캐릭터 에셋까지 모두 · 약 {1} (추정) | Including character assets · about {1} (estimate) |
| `bkPart` | 일부 | Part |
| `bkPartD` | 캐릭터 에셋 제외 · 약 {1} (추정) | Without character assets · about {1} (estimate) |
| `bkStart` | 시작 | Start |
| `bkSub` | 캐릭터 {1}개 · 채팅 {2}개 · 약 {3} (추정) | {1} characters · {2} chats · about {3} (estimate) |
| `bkCounts` | 캐릭터 {1}개, 채팅 {2}개, 프리셋 {3}개 | {1} characters, {2} chats, {3} presets |
| `wKeysH` | 연결 키가 파일에 들어가요. 다른 사람에게 보내지 마세요 | Connection keys go into the file. Do not send it to anyone |
| `wKeysC` | 연결 {1}개의 키가 이 파일에 담겨요 | The keys of {1} connections are saved in this file |
| `wMemH` | 이 기기에서는 파일을 메모리에서 먼저 만들어요 | On this device the file is built in memory first |
| `wMemC1` | 다 만든 뒤에 한 번에 저장돼요 | It is saved all at once when it is finished |
| `wMemC2` | 파일이 클수록 메모리를 많이 써요 (약 {1}, 추정) | A bigger file uses more memory (about {1}, estimate) |
| `wBinH` | .bin에는 이 앱에서만 쓰는 데이터가 담기지 않아요 | The .bin leaves out data only this app uses |
| `wBinD1` | 전체를 담으려면 .rtb로 만드세요. | To keep everything, make an .rtb. |
| `wBinD2` | 연결 키는 .bin에도 들어가요. 파일을 다른 사람에게 보내지 마세요. | Connection keys are in the .bin too. Do not send the file to anyone. |
| `wBinSecondary` | .rtb로 만들기 | Make an .rtb instead |
| `wBinPrimary` | 그래도 .bin으로 | Make the .bin anyway |
| `lo_chatFields` | 채팅 {1}개의 채팅별 탈옥·기억 문구는 빠져요 | Per-chat jailbreak and memory text of {1} chats is left out |
| `lo_members` | 삭제된 멤버 이름 {1}개는 빠져요 | {1} deleted-member names are left out |
| `lo_failures` | 실패 기록과 편집 초안 {1}개는 빠져요 | {1} failure records and edit drafts are left out |
| `lo_reading` | 읽기 설정 {1}개는 빠져요 | {1} reading settings are left out |
| `lo_sort` | 채팅 정렬 기록 {1}개는 빠져요 | {1} chat sort records are left out |
| `wPartH` | 일부만 백업해요 | Back up part of your data |
| `wPartC1` | 프로필 이미지 {1}개와 보관 데이터 {2}개, 데이터베이스는 담겨요 | {1} profile images, {2} archived items and the database are included |
| `wPartC2` | 감정 이미지·추가 에셋·VITS 파일·인레이 등 파일 {1}개(약 {2})는 빠져요 | {1} files (about {2}) such as emotion images, extra assets, VITS files and inlays are left out |
| `wPartD1` | 빠진 파일은 지금 기기에 그대로 있어요. | The files left out stay on this device. |
| `wPartD2` | 다른 기기에서 복원하면 빠진 이미지는 없어요. | Restoring on another device will not have the missing images. |
| `wPartGo` | 일부만 백업하기 | Back up part |
| `rfT` | 백업 파일 고르기 | Choose a backup file |
| `rfHint` | .rtb나 .bin 파일을 골라요 (모의 파일 목록) | Pick an .rtb or .bin file (a made-up file list) |
| `rfOk` | 이 파일 열기 | Open this file |
| `rfOkLine` | {1} · 캐릭터 {2}개, 채팅 {3}개가 들어 있어요 | {1} · holds {2} characters and {3} chats |
| `fileBad_notBackup` | 백업 파일이 아니에요. .rtb나 .bin 파일을 골라 주세요 | This is not a backup file. Pick an .rtb or .bin file |
| `fileBad_unreadable` | 파일을 읽을 수 없어요. 아무것도 바뀌지 않았어요 | The file could not be read. Nothing was changed |
| `fileBad_encrypted` | 암호화된 백업은 불러올 수 없어요. 아무것도 바뀌지 않았어요 | An encrypted backup cannot be restored. Nothing was changed |
| `fileBad_notSettings` | 설정 파일이 아니에요 | This is not a settings file |
| `fileBad_hasKeys` | 연결 키가 들어 있어서 가져오지 않아요 | It holds connection keys, so it is not imported |
| `wSalvH` | 백업 파일의 일부가 손상됐어요 | Part of the backup file is damaged |
| `wSalvC1` | 손상된 블록 {1}개는 빼고 복원해요 | {1} damaged blocks are left out of the restore |
| `wSalvC2` | 채팅 {1}개는 복원되지 않아요 | {1} chats will not be restored |
| `wSalvC3` | 나머지는 정상이에요 | The rest is fine |
| `wSalvGo` | 손상된 부분 빼고 계속 | Continue without the damaged part |
| `wRfH` | 백업 파일로 지금 데이터를 바꿔요 | Replace current data with this backup |
| `wRfC1` | 캐릭터 {1}개, 채팅 {2}개가 파일 내용으로 바뀌어요 (지금 {3}개 / {4}개) | {1} characters and {2} chats are replaced with the file’s (now {3} / {4}) |
| `wRfC2` | 파일에 없는 이미지는 지금 것을 그대로 둬요 | Images that are not in the file stay as they are |
| `wRfC2n` | 파일에 없는 이미지 {1}개(약 {2})는 지금 것을 그대로 둬요 | {1} images (about {2}) that are not in the file stay as they are |
| `wRfC3` | 바꾸기 전에 지금 상태를 자동 스냅샷으로 남겨요 | Your current state is saved as an automatic snapshot first |
| `wRfD1` | 파일: {1} · {2} 저장 | File: {1} · saved {2} |
| `wRfD2` | 이미지와 보관 데이터를 쓰기 시작한 뒤에는 멈출 수 없어요. | Once images and archived data start being written, it cannot be stopped. |
| `wRfD3rtb` | .rtb 파일이라 연결 키도 함께 복원돼요. | This is an .rtb file, so connection keys are restored too. |
| `wRfD3bin` | .bin 파일에는 이 앱에서만 쓰는 데이터가 없을 수 있어요. | A .bin file may not hold the data only this app uses. |
| `wRfGo` | 교체하기 | Replace |
| `rfSub` | {1} · 캐릭터 {2}개 · 채팅 {3}개 | {1} · {2} characters · {3} chats |
| `rfCounts` | 캐릭터 {1}개, 채팅 {2}개를 불러왔어요 | Restored {1} characters and {2} chats |
| `rfSafetyKept` | 바꾸기 전 상태는 자동 스냅샷에 남겼어요 | The state before the replace is kept as an automatic snapshot |
| `rsSub` | {1} 스냅샷 · {2} · 캐릭터 {3}개 | {1} snapshot · {2} · {3} characters |
| `rsSafetyKept` | 방금 상태가 목록에 저장됐어요 | The state just before is saved in the list |
| `wRsH` | 자동 스냅샷으로 지금 데이터를 바꿔요 | Replace current data with this snapshot |
| `wRsC1` | 스냅샷: {1} · {2} · 캐릭터 {3}개 | Snapshot: {1} · {2} · {3} characters |
| `wRsC2` | 캐릭터 {1}개가 스냅샷 내용으로 바뀌어요 (지금 {2}개) | {1} characters are replaced with the snapshot’s (now {2}) |
| `wRsC3` | 바꾸기 전에 지금 상태를 자동 스냅샷으로 남겨요 | Your current state is saved as an automatic snapshot first |
| `wRsD1` | 데이터 교체하기 단계부터는 멈출 수 없어요. | It cannot be stopped from the Replacing data step on. |
| `restart` | 다시 시작 | Restart |
| `rbH` | 복원이 끝났어요. 다시 시작하면 바뀐 데이터가 보여요 | The restore is done. Restart to see the restored data |
| `rbS` | 다시 시작하기 전까지는 이 화면에 이전 데이터가 보일 수 있어요 | Until you restart, this screen may still show the old data |
| `rbUnknownH` | 저장이 끝났는지 확인하지 못했어요 | Could not confirm that the save finished |
| `rbUnknownS` | 다시 시작해서 데이터가 맞는지 확인하세요 | Restart, then check that your data looks right |
| `restartDone` | 다시 시작했어요 (모의) | Restarted (simulated) |
| `restartDoneSub` | 바뀐 데이터가 보여요 | The restored data is shown |
| `lockStill` | 아직 다른 탭이 열려 있어요 | Another tab is still open |
| `snT` | 자동 스냅샷 | Automatic snapshots |
| `snHint` | 앱이 자동으로 남긴 시점이에요. 하나를 고르면 먼저 무엇이 바뀌는지 보여 드려요 | Points the app saved by itself. Pick one to see what would change first |
| `snNone` | 아직 자동 스냅샷이 없어요. 앱을 쓰는 동안 자동으로 남겨요 (5분에 한 번까지) | No automatic snapshots yet. The app saves them while you use it (at most once every 5 minutes) |
| `snChars` | 캐릭터 {1}개 | {1} characters |
| `snSafety` | 복원 전 상태 | Before a restore |
| `snPickOf` | {1}, 이 시점으로 불러오기 | {1}, restore this point |
| `snDesc` | 앱이 자동으로 남긴 시점 {1}개 중에서 골라요 | Choose from {1} points the app saved |
| `snDescNone` | 아직 없어요 | None yet |
| `snTrail` | {1}개 | {1} |
| `dsSub` | 채팅 {1}개를 캐릭터별로 담아요 | {1} chats, grouped by character |
| `dsCounts` | 캐릭터 {1}개, 채팅 {2}개 | {1} characters, {2} chats |
| `wSeH` | 설정 파일에는 앱 설정과 프리셋 선택만 담겨요 | A settings file holds app settings and preset choices only |
| `wSeC` | 연결 키와 채팅은 담기지 않아요 | Connection keys and chats are not included |
| `seDone` | 설정 파일을 내보냈어요 | Settings file exported |
| `seNoKeys` | 연결 키와 채팅은 담기지 않았어요 | Connection keys and chats are not included |
| `siT` | 설정 파일 고르기 | Choose a settings file |
| `siHint` | 앱 설정과 프리셋 선택이 든 파일을 골라요 (모의 파일 목록) | Pick a file with app settings and preset choices (a made-up file list) |
| `siOk` | 이 파일 열기 | Open this file |
| `siMeta` | 설정 {1}개 | {1} settings |
| `siOkLine` | {1} · 바뀌는 설정 {2}개 | {1} · {2} settings would change |
| `wSiH` | 설정 {1}개가 바뀌어요 | {1} settings change |
| `siLine` | {1}: {2} → {3} | {1}: {2} → {3} |
| `wSiD1` | 연결 키와 채팅은 바뀌지 않아요. | Connection keys and chats are not changed. |
| `wSiD2` | 가져온 뒤 10초 안에 한 번에 되돌릴 수 있어요. | You can undo the whole import within 10 seconds. |
| `wSiGo` | 가져오기 | Import |
| `siSub` | 바뀔 설정 {1}개 | {1} settings will change |
| `siCounts` | {1} · 설정 {2}개 | {1} · {2} settings |
| `siUndone` | 가져온 설정을 되돌렸어요 | The imported settings were put back |
| `siToast` | 설정 {1}개를 바꿨어요 | Changed {1} settings |
| `archOff` | 끄면 보관 메모가 지워져요 | Turning this off clears the archive memo |
| `cleanName` | 쓰지 않는 파일 정리 | Clean unused files |
| `wClH` | 쓰지 않는 파일 {1}개를 지워요 | Delete {1} unused files |
| `wClC1` | 파일 {1}개, {2}를 지워요. 되돌릴 수 없어요 | Deletes {1} files, {2}. This can’t be undone |
| `wClC2` | 어떤 캐릭터·모듈·페르소나·설정도 쓰지 않는 이미지와 오디오, 보관 데이터만 지워요 | Only images, audio and archived data that no character, module, persona or setting uses |
| `wClD1` | 첫 파일을 지우기 전까지만 취소할 수 있어요. | You can cancel only before the first file is deleted. |
| `wClGo` | 지우기 | Delete |
| `clSub` | 파일 {1}개 · {2} | {1} files · {2} |
| `clCounts` | 파일 {1}개, {2}를 지웠어요 | Deleted {1} files, {2} |
| `cleanDesc` | 지울 수 있는 파일 {1}개 · {2}. 되돌릴 수 없어요 | {1} files you can delete · {2}. This can’t be undone |
| `cleanDescNone` | 지울 것이 없어요 | Nothing to delete |
| `cleanNoneT` | 지울 것이 없어요 | Nothing to delete |
| `verifyName` | 이미지 캐시 | the image cache |
| `vfSub` | 이미지와 파일 {1}개 확인 | {1} images and files checked |
| `vfCounts` | {1}개 확인 · 손상 {2}개 | {1} checked · {2} corrupted |
| `mmT` | 손상된 항목 | Corrupted items |
| `mmHint` | 내용이 저장된 값과 다른 항목 {1}개를 찾았어요 | {1} items do not match what was stored |
| `mmName` | 이름 | Name |
| `mmSize` | 크기 | Size |
| `mmState` | 상태 | State |
| `mmDiff` | 내용이 달라요 | Contents differ |
| `mmGo` | 캐시에서 지우기 | Remove from the cache |
| `wEvH` | 손상된 항목 {1}개를 캐시에서 지워요 | Remove {1} corrupted items from the cache |
| `wEvC1` | 항목 {1}개, {2}를 캐시에서 지워요 | Removes {1} items, {2}, from the cache |
| `wEvC2` | 지운 항목은 캐시에서만 사라져요 | Removed items disappear from the cache only |
| `wEvGo` | 캐시에서 지우기 | Remove from the cache |
| `evDone` | 손상된 항목 {1}개를 캐시에서 지웠어요 | Removed {1} corrupted items from the cache |
| `evDoneS` | 다시 점검해서 확인할 수 있어요 | You can check again to confirm |
| `noCacheDesktop` | 데스크톱 앱에서는 이미지 캐시 점검과 시작할 때 손상 확인이 나오지 않아요 | The desktop app does not show the image cache check or the startup corruption check |
| `noCacheAndroid` | Android 앱에서는 이미지 캐시 점검과 시작할 때 손상 확인이 나오지 않아요 | The Android app does not show the image cache check or the startup corruption check |
| `busyT` | 다른 작업이 아직 돌고 있어요 | Another task is still running |
| `busyS` | 끝난 뒤에 다시 눌러 주세요 | Try again when it is done |
| `clampRange` | 값은 {1}에서 {2}까지예요 | The value is {1} to {2} |
| `clampMin` | 값은 {1} 이상이어야 해요 | The value has to be {1} or more |
| `advCalm` | 뭘 하는지 모르면 바꾸지 마세요. | If you don't know what an option does, don't change it. |
| `reqA` | 요청 보내는 방식 | How requests are sent |
| `reqB` | 모델과 캐시 | Models and caches |
| `reqC` | 아직 실험 중인 항목 | Still experimental |
| `noteReqLoc` | 요청 지역은 웹 브라우저에서만 나와요 | The request region is only shown in a web browser |
| `noteInfo` | 채팅에 프롬프트 정보 보이기는 데스크톱 앱과 서버판에서만 나와요 | Prompt info in the chat is only shown in the desktop app and the server build |
| `noteKeep` | 세션 유지는 Android에서는 나오지 않아요 | Keep session alive is not shown on Android |
| `emoMoved` | 감정 프롬프트는 대화 기능 › 감정 이미지에 있어요 | The emotion prompt is under Chat features › Emotion images |
| `gateExp` | 네 가지 · 아직 다듬는 중이에요 | Four items · still being refined |
| `gateUnrec` | 네 가지 · 권장하지 않거나 더 이상 쓰지 않을 수 있어요 | Four items · not recommended, or perhaps no longer used |
| `banDesc` | 체크한 문자 종류의 글자는 쓰지 않게 해요 | Characters of the checked script types are not used |
| `banCount` | {1}개 종류를 막고 있어요 | {1} script types banned |
| `cmDesc` | 직접 추가한 모델은 모델·프리셋의 ‘연결’에서 더하고 고치고 지워요 | Custom models are added, edited and deleted under “Connections” in Models and presets |
| `cmGo` | 연결 열기 | Open Connections |
| `logT` | 요청 기록 | Request logs |
| `logHint` | 최근 요청이에요 (가상 기록) | Recent requests (a made-up log) |
| `logRetry` | 재시도 | retry |
| `stT` | 사용 통계 | Usage statistics |
| `stMonth` | 달 | Month |
| `stReq` | 요청 | Requests |
| `stTok` | 토큰 | Tokens |
| `stNote` | 2024년 7월 이후의 수치는 정확하지 않을 수 있어요 | Figures after July 2024 may not be accurate |
| `bgT` | 문제 신고용 설정 내보내기 | Export settings for a bug report |
| `bgBody` | 아래 항목을 뺀 설정을 파일로 만들고 클립보드에 복사해요 | Makes a file of your settings without the items below and copies it to the clipboard |
| `bgC1` | 이름에 key, proxy, hypa가 들어간 설정은 모두 빼요 | Every setting whose name contains key, proxy or hypa is left out |
| `bgC2` | 그 밖에 연결 키나 주소 같은 민감한 항목 약 35개도 빼요 | About 35 other sensitive items, such as connection keys and addresses, are left out too |
| `bgC3` | 채팅과 캐릭터 내용은 들어가지 않아요 | Chats and character contents are not included |
| `bgGo` | 내보내기 | Export |
| `bgDone` | 설정을 내보냈어요 | Settings exported |
| `bgDoneS` | risuai-settings-report.json · 클립보드에도 복사했어요 (모의) | risuai-settings-report.json · also copied to the clipboard (simulated) |
| `langPending` | 설정을 닫았다가 다시 열면 바뀌어요 | It changes when you close Settings and open them again |
| `langReopen` | 다시 열기 | Reopen |
| `langDone` | {1}(으)로 바꿨어요 | Changed to {1} |
| `langDemoOnly` | {1}을(를) 골랐어요. 이 목업은 한국어와 English만 보여 줘요 | You chose {1}. This mockup only shows Korean and English |
| `tlDone` | lang.json을 받았어요 (모의) | Got lang.json (simulated) |
| `tlDoneS` | 번역할 때 쓰는 파일이에요 | The file you translate |
| `demo5c2` | 슬라이스 5c-2 | Slice 5c-2 |
| `demoSet` | 데이터 세트 | Data set |
| `demoNext` | 다음 실행 결과 | Next run result |
| `demoLock` | 다른 탭이 열려 있음 | Another tab is open |
| `demoState` | 상태 (5c-2) | State (5c-2) |
| `demoGo` | 열기 | Open |
| `set_demo` | 기본 | Default |
| `set_failing` | 실패 | Failing |
| `set_other-tab` | 다른 탭 열림 | Other tab open |
| `set_web-memory` | 메모리로 만들기 | Built in memory |
| `set_desktop-app` | 데스크톱 앱 | Desktop app |
| `set_android` | Android | Android |
| `set_empty` | 비어 있음 | Empty |
| `set_experimental` | 실험 기능 켬 | Experimental on |
| `next_default` | 세트에 맞게 | As the set says |
| `next_ok` | 정상 | Clean run |
| `next_skips` | 건너뜀 있음 | With skips |
| `next_over4g` | 4 GiB 넘는 파일 | An asset over 4 GiB |
| `next_fail` | 실패 (데이터 그대로) | Fails (data unchanged) |
| `next_unknown` | 실패 (상태 불명) | Fails (state unknown) |

**Strings added to the pattern (`RisuPattern.addStrings`)**

| Key | 한국어 | English |
|---|---|---|
| `p2.step.prep` | 파일 준비 | Preparing the file |
| `p2.step.assets` | 이미지·에셋 담기 | Adding images and assets |
| `p2.step.inlays` | 인레이 담기 | Adding inlays |
| `p2.step.cold` | 보관 데이터 담기 | Adding archived data |
| `p2.step.db` | 데이터베이스 저장 | Saving the database |
| `p2.step.review` | 담을 항목 확인 | Checking what to include |
| `p2.step.profile` | 프로필 이미지 담기 | Adding profile images |
| `p2.step.check` | 파일 확인 | Checking the file |
| `p2.step.tabs` | 다른 탭 확인 | Checking other tabs |
| `p2.step.safety` | 안전 스냅샷 만들기 | Making a safety snapshot |
| `p2.step.write` | 이미지·보관 데이터 쓰기 | Writing images and archived data |
| `p2.step.replace` | 데이터 교체하기 | Replacing data |
| `p2.step.verify` | 저장 확인 | Verifying the save |
| `p2.step.snapcheck` | 스냅샷 확인 | Checking the snapshot |
| `p2.step.read` | 보관소에서 읽기 | Reading from the archive |
| `p2.step.build` | 파일 만들기 | Building the file |
| `p2.step.confirm` | 확인 | Checking |
| `p2.step.delete` | 지우기 | Deleting |
| `p2.step.scan` | 읽기 | Reading |
| `p2.step.compare` | 확인 | Comparing |
| `p2.step.sfile` | 파일 확인 | Checking the file |
| `p2.step.apply` | 적용 | Applying |
| `p2.noun.asset` | 이미지·에셋 | Images and assets |
| `p2.noun.inlay` | 인레이 | Inlays |
| `p2.noun.cold` | 보관 항목 | Archived |
| `p2.noun.profile` | 프로필 이미지 | Profile images |
| `p2.noun.char` | 캐릭터 | Characters |
| `p2.noun.file` | 파일 | Files |
| `p2.noun.setting` | 설정 | Settings |
| `task.title.scan` | {name} 점검하는 중 | Checking {name} |
| `task.titleDone.scan` | {name} 점검 | Check {name} |
| `task.done.scan` | 점검을 마쳤어요 | Check finished |
| `task.failed.scan` | 점검을 마치지 못했어요 | Check stopped |
| `task.title.clean` | 쓰지 않는 파일 정리하는 중 | Cleaning unused files |
| `task.titleDone.clean` | 쓰지 않는 파일 정리 | Clean unused files |
| `task.done.clean` | 정리를 마쳤어요 | Cleanup finished |
| `task.failed.clean` | 정리를 마치지 못했어요 | Cleanup stopped |
| `task.done.import` | 설정 {n}개를 바꿨어요 | Changed {n} settings |
| `task.undone.summary` | 바꿨던 설정 {n}개를 원래대로 돌렸어요 | Put the {n} changed settings back |

## 9. Design defaults to confirm (for review)

- One backup sheet carries both the format and the scope choice.
- The restore steps add a visible "안전 스냅샷 만들기" step.
- Settings-file export needs no task card.
- 고급's calm header replaces the red warning.
- The gate sections are collapsed under their switches.

## 10. Open questions

None from the review yet. The build raised these (recommendation first; none is a product decision):

- **O-1 (`.bin` restore and the app-only data):** a restore replaces the database as a whole (R 1.3), so data only this app uses may be lost when the file is a `.bin`. The sheet says only "`.bin` 파일에는 이 앱에서만 쓰는 데이터가 없을 수 있어요". Lane A should say whether the restore keeps the current app-only data (recommended: keep, and say so) or drops it, and the sheet should then say it plainly.
- **O-2 (custom models):** slice 3 already designs custom models under 연결 (DS-048, DS-049: add, edit, delete with Undo) but has no reorder. §3 asked for add, rename, reorder and delete here; the build links to slice 3 and draws nothing twice. Add reorder in slice 3, or drop it.
- **O-3 (restart):** DS-190 says the result card has 다시 시작. The pattern's result card has only Close (and Retry, Undo import), so the build puts the button into the card's action row from Settings (DOM insertion, part `settings-restart`) and keeps the same button in a page banner if the card is closed. Proposal for the pattern's owner: result actions the lane can add (`task.finish({ actions: [...] })`).
- **O-4 (a secondary answer in `openTaskFlow`):** `openTaskFlow` mounts the progress card after a secondary answer ("`.rtb`로 만들기"), but `openWarning` closes the sheet on that answer, so the card appears in a closing dialog and vanishes. The build drops that card and opens a new `.rtb` flow once the sheet is gone. Proposal: a `keepOpen` for the secondary answer, or an `onSecondary` hook.
- **O-5 (import copy):** the pattern's import strings say "추가" / "added". A settings import changes values. The build overrides two keys; the pattern should take per-task copy.
- **O-6 (damaged blocks):** the app finds damaged blocks after the image pass (R 1.3 step 6), when Cancel is already gone and the pattern cannot ask a question mid-run (DD-230: a question is a confirm step). The build asks before the run (picking a file that has damaged blocks opens the salvage confirm first). That needs the engine to decode the database ahead of the first write (Engine item 5c2-5).
- **O-7 (bounds):** a typed value outside a number field's bounds is pulled to the nearest bound and announced ("값은 0에서 20까지예요"). §3 says "keep the app's bounds"; whether the app clamps or ignores is not traced. Confirm.
- **O-8 (Banana Cocoa):** the shipped pack did not state three tokens the pattern needs; the pack was edited (Build notes).
- **O-9 (`.bin` and keys):** R 1.2 says the `.bin` database also holds the connection keys; the `.bin` sheet's detail says so ("연결 키는 .bin에도 들어가요"), while DS-177 describes `.rtb` as the one with keys. Confirm the wording.

## Build notes (builder, 2026-10-28)

What was built, and where it differs from the text above. DS-152, DS-153 and DS-176 to DS-191 are honoured; the deviations and the assumptions are listed here and in `checks/builder-checks-ss5c2.md`.

- **Files:** `slice5c2.html` (loads slices 1 to 5c-1 and the pattern's files in the README's order), `slice5c2.css` (5 `--p5c2-*` tokens, two aliases and two pattern stacking tokens), `slice5c2.js` (hooks on `SS1_EXT`, loaded after `slice5c1.js`), `data5c2.js` (rows, 8 fixture sets, the mock store and files, about 205 copy keys and 39 pattern strings). `slice1.js` and `slice5c1.js` are not edited; no frozen file is edited (see the pending edits below).
- **Store first (DS-067):** the compound state (snapshots, the restart state, the ban list, the language choice, the clean-up inventory, the cache result, the lock) is `window.SS5C2_DATA.ST`; every page reads it by id at render time. The rows are slice 1's catalogue rows (`data5c2.js` replaces the invented `data.*` and `adv.*` rows with the real fields of R 1.5; the ids other slices use are kept).
- **The pattern:** one `RisuPattern.openTaskFlow` per operation (backup, restore from a file, restore from a snapshot, dataset export, clean-up, cache check, settings import); the page keeps a `busy` flag. The mock engine is a timer plan per operation (`run` and `runPlan` in `slice5c2.js`): a step list, a count per counted step, a failure or a skip per scenario, a hold for the checks. `?speed=` scales the engine's waits only. Nothing touches storage, files, the clipboard or the network; the downloads are blobs.
- **Scenarios:** `?set=failing` makes the full backup skip an asset over 4 GiB (named), the partial backup fail on a write with the data unchanged, the file restore end with the state unknown, the snapshot restore fail at 데이터 교체하기 and the clean-up and dataset export fail or skip; the demo panel's "다음 실행 결과" overrides the next run on any set.
- **States:** 31, in the names of §7.3. `?state=` runs one; `__ss5c2.runState` runs another after load; `__ss5c2Ready` holds the state name.
- **Assumptions the builder made** (not decided by a DS entry), for the review:
  - **Safety snapshot (DS-182):** the file restore has a visible 안전 스냅샷 만들기 step; it adds the snapshot to the list (tagged 복원 전 상태) and the result says so. Cancel ends at 다른 탭 확인 for a file (DS-176) and at 안전 스냅샷 만들기 for a snapshot (the table says "before 데이터 교체하기"): the file's safety step already follows the check steps and the snapshot's does not write images.
  - **Backup format sheet (§9):** one sheet carries format and scope; the keys caution is a pattern banner inside it (caution = banner, DD-230), not a second sheet; the web-memory notice sits in the same place. The `.bin` caution is the pattern's sheet with three actions. A partial `.bin` shows the `.bin` caution with the partial line first (no extra sheet).
  - **`.bin` sheet detail:** "연결 키는 .bin에도 들어가요" (R 1.2) and the leave-out list marked `가상 목록 (mock)` (DS-191); an empty list would show no sheet (not exercised: the mock list is never empty).
  - **Clean-up (DD-229):** the failure fixture fails before the first file is deleted, so "지금 데이터는 바뀌지 않았어요" is true. A partial failure after deletions is not drawn (the pattern's partial copy says "추가된 N개", which is wrong for deletions).
  - **Cache check:** the result card closes into a table sheet (a real table) and then a confirm to evict; evicting only removes from the cache.
  - **Settings file:** the content is every non-secret setting of the earlier pages except the Models page's (connections, models, presets). The import's seven made-up changes are real rows of 5c-1, so Undo has something to put back. After the card is closed with Undo still open, the pattern's undo toast carries the rest of the window.
  - **고급:** headers use plain h3 sub-heads inside 요청 (how requests are sent / models and caches / still experimental); `adv.proTools` and `adv.easyPanel` (5c-1's navigation rows) stay in 기능 공개; `adv.bookmark` is placed in 문제 해결 and its description is the builder's (the research lists it under Developer without a description); `adv.removePunctuationHypa` is in 요청.
  - **Gates:** the sections appear only with their switch, collapsed; a search hit on a row of a closed gate opens the section with slice 1's explanation of why the row is not there (the gate rows have no default and no reset, as the app has none).
  - **Bounds:** a typed value outside a field's bounds is pulled to the nearest bound and announced (O-7). The two chat-load fields and the auto-continue and asset fields have no maximum (R lists none); no maximum is written to the field.
  - **언어:** slice 5b already has the DeepL web warning and the source language row for Google (R 2.3 listed them as missing from the older mockup); nothing was added to 5b. Choosing a language the mockup cannot draw (anything but 한국어 and English) is accepted and says so after the reopen.
  - **Streaming:** `models.streaming` (reply streaming, Models page) is a different setting from the retired streaming display optimisation; the `se-streaming-none` state searches the source key.
  - **Phone and tablet:** Settings' own toast is lifted (class `p5c2-lift`, token `--p5c2-lift`) while the pattern's task chip shows, so neither covers the other (layout check `W-toasts`).
  - **Stacking:** the pattern's layer is raised to 97 and its toast stack to 98 (Settings' toast is 96, menus 90, README §8); both are inside the registry's 40-100 and 40-101.
- **Pattern findings** (the pattern files were read, not edited): O-3, O-4 and O-5 above; and two layers open at once make the two focus traps ping-pong until the stack overflows (not reachable in the UI, because the page behind a sheet is inert; reachable only from script).
- **Banana Cocoa (edited, after main's commit 83793d3 unfroze it).** Without three lines the pattern's defaults did not read correctly on its white sheet: `--nexus-warning-rgb` was not stated (the caution and skipped-list edges fell to 1.44:1 and 1.33:1 on the sheet and the toast), and `--pattern-on-accent` and `--pattern-on-danger` were not stated (the labels of 교체하기, 지우기 and the confirm buttons fell to 2.85:1 and 3.50:1). `themes/banana-cocoa.css` now states `--nexus-warning-rgb: 138 90 0; --pattern-on-accent: #ffffff; --pattern-on-danger: #ffffff;` (the values of the pattern's own probe). No part rule for the 14 new parts was needed. Origin Navy needed nothing. The th5c2 runs still add the same three lines as a stylesheet (`pending5c2`, now redundant) and `TH5C2-L-banana-shipped` records the earlier state.
- **Edits to unfrozen files (only these):** (1) `settings/themes/banana-cocoa.css`: the three lines above. (2) `settings/checks/th/packlint-settings.mjs`: `SETTINGS_SETTABLE` gains `/^--pattern-[a-z0-9-]+$/` and `/^--(task|warning)-[a-z0-9-]+$/`, so a Settings pack may state the pattern's role tokens (the fail-closed lint refused `--pattern-on-accent` in every earlier registry once Banana Cocoa stated it); the pattern's floors, ceilings and supplement are not applied there (merging them rejected the existing light-pack fixture of the th suite) and run in `checks/th5c2/registry5c2.mjs`. `index.html` is untouched: its target stays `slice5c1.html`, so the hr check `E-source` (target equals the newest slice file) fails until main moves it after acceptance. Nothing else outside the new 5c-2 files was edited.
- **Still for main (lifts, not needed for the mockup to work):**
  1. `settings/checks/th/packlint-settings.mjs` (and the registries): lift the part lists, `MINIMUMS5C2` and `MAXIMUMS5C2` from `checks/th5c2/registry5c2.mjs`, and merge the pattern fragment once with `mergeRegistry`. `registry5c2.mjs` already does the merge on top of the unchanged registries.
  2. `settings/theme-tokens.css`: merge the five `--p5c2-*` tokens, the two `--settings-warn-edge*` aliases and the two stacking tokens from `slice5c2.css`.
  3. `settings/index.html`: point at `slice5c2.html` after acceptance, and add the pattern's four stylesheets and two scripts in the README's order.

### Integration notes

- **Pattern adoption:** load `theme/pattern-tokens.css`, `brand/nexus-mark.css`, `patterns/pattern.css`, `patterns/motion.css` after `theme/nexus-tokens.css` and before the Settings CSS; `mockups/nexusMark.iife.js` and `patterns/pattern.js` before the Settings scripts. Alias, do not copy: `slice5c2.css` shows how. Pass `background: [settings root, origin]` to every `openTaskFlow` and `openWarning` (the page behind must be inert), and keep `html[lang]` current (`RisuPattern.lang` reads it).
- **Busy flag:** one per page; an operation requested while another runs shows a notice and starts nothing (the app's `refuseBackupLoadWhileBusy`).
- **Restart:** the card's 다시 시작 and the page banner call the same function; the engine reloads or relaunches after the restore notices (the mock only applies the restored counts).
- **Key reveal and toasts:** unchanged from 5c-1. The toast lift is a class, not a style.
- **Registry:** see the lifts above. The 14 new names are 4 critical, 0 safe, 10 reach; the pattern's names come with the merge.
- **Search:** the new rows carry their source keys as hidden terms; the retired rows (persist, streaming optimisation) are not in the catalogue.

### Engine items

- **5c2-1 (`.rtb`, new):** a new backup format `.rtb`: the whole profile including connection keys and the fork-only data, restorable by the same restore path as a `.bin` (same steps). Optional password is MC-698, unresolved. Default format of the backup sheet; file names `risu-backup-YYYYMMDD.rtb` and `risu-partial-YYYYMMDD.rtb` (the `.bin` names stay `local-YYYYMMDD.bin` and `local-partial-YYYYMMDD.bin`).
- **5c2-2 (`.bin` leave-out list, DD-227, DD-251):** Lane A supplies the kinds of fork-only data present, with counts, for the `.bin` sheet and the export result; the mock list (chat fields, deleted members, failure records and drafts, reading settings, sort records) is marked 가상 목록 until then. Also: what a `.bin` restore does to app-only data (O-1) and whether the `.bin` keeps the keys (O-9).
- **5c2-3 (abort for the restore walk, DS-176):** an abort signal for the restore's index walk and tab-lock wait, so Cancel can end the run before the first asset is written (R 1.3 steps 1 to 4). After the first asset write there is no cancel (the app overwrites same-named assets from then on).
- **5c2-4 (safety snapshot, DS-182):** a file restore writes a snapshot of the current committed state first, like the snapshot path's `keepCurrentState`; if it cannot (damaged, absent, over the Node limit) the sheet must say so and ask for the pattern's acknowledgment instead of the line "바꾸기 전에 지금 상태를 자동 스냅샷으로 남겨요".
- **5c2-5 (decode before the first write, O-6):** decode the database and find damaged blocks (`salvageRisuSave`) before the first asset write, so the salvage question comes while Cancel works.
- **5c2-6 (snapshot size and count, DS-181):** the snapshot list returns each snapshot's time, size and character count (and a flag for the ones a restore made); pruning is not traced.
- **5c2-7 (restore result before the reload, DS-190):** the engine returns the restore's result (counts, skipped names, notices) and waits for 다시 시작 before `location.reload()` / `relaunch()`; today the notices are awaited and the reload is automatic. When the save cannot be confirmed (`saveDamagedUnconfirmed`) nothing may save from the page until the reload: the banner says so.
- **5c2-8 (settings file, new, DS-178, DS-187):** export and import of a file with the app settings and the preset choices, never keys or chats; the import returns the list of changes (name, old value, new value) before it applies, and applies them as one undoable group for 10 seconds (DD-225). Name `risu-settings-YYYYMMDD.json`. The bug-report export (`risuai-settings-report.json`) stays and is reached from 고급.
- **5c2-9 (progress events):** replace the hard-coded English wait text of backup and restore ("Saving local Backup... (i / n)", "Loading local Backup... (x.xx%)") with structured events: step id and counts (assets, inlays, cold units, database), so the pattern's task can drive the card (R 1.2, inventory A-17).
- **5c2-10 (`archiveCharacters`, DS-180):** the field moves from 고급 to 데이터·백업 › 저장 공간, default on (`!== false`); turning it off clears the archive memo (the page says so).
- **5c2-11 (persist removed, DS-179):** there is no `persist` setting; the app calls `navigator.storage.persist()` itself in standalone display mode.
- **5c2-12 (고급 regroup and relabels):** the groups of §3; relabels: `genTime` "한 번에 받을 답 수" (bounds 0-4096), `heightMode` "화면 높이 계산 방식" (six options in plain words), `antiServerOverloads`, `legacyMediaFindings`, `dynamicModelRegistry` and the other jargon labels in `data5c2.js`; platform notes (`requestLocation` plain web only, `promptInfoInsideChat` Node and Tauri only, `keepSessionAlive` not Android).
- **5c2-13 (streaming removed, DS-184):** `streamingDisplayOptimizationMode` is not shown (DD-071); the migration from `largeChatPerformanceMode` stays.
- **5c2-14 (legacy rows):** `showDeprecatedTriggerV1` and `legacyMediaFindings` sit in the collapsed 권장하지 않음 group until main confirms whether they are dead; their help says "이미 쓰지 않는 항목일 수 있어요".
- **5c2-15 (custom models):** custom models are edited under 연결 (slice 3, DS-048); delete has an Undo (DS-049). Reorder is not designed anywhere (O-2).
- **5c2-16 (language change, DS-189):** the language applies after the app is reopened (as today); the line says so and the button reopens. `translang` stays ("번역 파일 받기": download `lang.json` and reset the language to English).
- **5c2-17 (pattern adoption):** the four stylesheets and two scripts, `RisuPattern.addStrings` for the Settings keys, the registry merge and `--nexus-warning-rgb` in packs (pending edits above).
- **5c2-18 (diagnostics):** request logs (`getRequestLog()` as a sheet), statistics (`DBState.db.statics` as a table with the accuracy note) and the bug-report export (which strips about 35 named keys and every key containing `key`, `proxy` or `hypa`) are reached from 문제 해결.
- **5c2-19 (bounds):** `genTime` 0-4096, `loreBookDepth` 0-20, `loreBookToken` 0-4096, `localNetworkTimeoutSec` 30-3600 and the minimums of the chat-load pages and the auto-continue tokens; whether the app clamps or ignores out-of-range values is not traced (O-7).

## Appendix: Parts (theme readiness, DD-142 to DD-161)

Filled by the builder (2026-10-28) from `slice5c2.js`; `checks/th5c2/parts.mjs` reads this table and fails if the pages carry a Settings name that is not listed here or in the slice 1 to 5c-1 appendices, if an element carrying a name does not match the Selector, if a main element class carries no part, or if a new name is never seen. The pattern's own parts (`pattern-*`) are documented in `patterns/checks/registry.mjs` (critical and reach lists) and are not repeated here; `parts.mjs` fails if the page shows a `pattern-*` name that registry does not know.

| Part | Selector | Notes |
|---|---|---|
| `settings-backup-choice` | `fieldset.p5c2-choices` | a radio group of the backup sheet (형식, 범위); reach |
| `settings-backup-option` | `label.p5c2-opt` | one option card (radio, name, one line); `data-current` (chosen); reach |
| `settings-snapshot-list` | `ul.p5c2-snaps` | the list of automatic snapshots (a list of buttons); reach |
| `settings-snapshot-item` | `button.p5c2-snap` | one snapshot (date, age, size, character count; accessible name with all four); reach |
| `settings-restart` | `[data-p5c2="restart"]` | the 다시 시작 button, in the restart banner and in the pattern's result card (DS-190); **critical** |
| `settings-restart-banner` | `p.p5c2-restart` | the page banner after a restore or an unconfirmed save ("복원이 끝났어요 ..." / "저장이 끝났는지 확인하지 못했어요"); role=status; **critical** |
| `settings-gate-section` | `details.p5c2-gate` | the collapsed section under a gate switch (실험적 기능, 권장하지 않음); reach |
| `settings-ban-grid` | `fieldset.p5c2-ban` | the group of 18 script checkboxes with its legend and live count; reach |
| `settings-ban-option` | `label.p5c2-banopt` | one script (checkbox, name, sample); `data-current` (ticked); reach |
| `settings-lang-pending` | `p.p5c2-langnote` | the line "설정을 닫았다가 다시 열면 바뀌어요" (role=status), only while a language waits; **critical** |
| `settings-lang-reopen` | `button.p5c2-reopen` | the 다시 열기 button of that line; **critical** |
| `settings-mismatch-table` | `table.p5c2-table` | the table of corrupted cache items (caption, scoped headers); reach |
| `settings-stats-table` | `table.p5c2-table` | the usage statistics table (caption, scoped headers); reach |
| `settings-log` | `pre.p5c2-log` | the request log block (focusable, scrolls); reach |

Critical in this slice (`data-part-critical`):
- the one way to the restored data (`settings-restart`, `settings-restart-banner`), so a restore that needs a restart says so and offers it;
- the line that says a language is waiting for the reopen and its button (`settings-lang-pending`, `settings-lang-reopen`);
- every protected part of the pattern (the consequences, the actions, Cancel and its reason, the bar, the result, the skipped list, Retry, Close, Undo import, the undo line); Settings' frame and classes strip none of them (`TH5C2-P-pattern-keeps-critical-mark`).

Why there is no safe leaf: the cards, lists, tables and the log hold the only way to choose, or the only record of what a decision is about; a pack may restyle them, not hide them. The pattern's decorative parts (mark, title, steps, chip) are reach tier in the pattern's registry.

State attributes: `data-current` (mirrored by `theme.js` from `.cur`) on the chosen backup option and the ticked scripts; the pattern's own `data-pattern-severity`, `data-task-state`, `data-step-state` and `data-has-leftout` are styled by the pattern.

New role tokens (declared at the top of `slice5c2.css`, read only through `var()`; the main session merges them into `theme-tokens.css`): `--p5c2-bar` (the edge bar of a chosen option and a ticked script, 4px, floor 2px, ceiling 12px), `--p5c2-snap-max` (the tallest the snapshot list gets before it scrolls, 18rem, floor 128px, ceiling 480px), `--p5c2-log-max` (the tallest the request log gets, 14rem, floor 96px, ceiling 480px), `--p5c2-ban-min` (the narrowest a script option gets, 10rem, floor 96px, ceiling 240px), `--p5c2-lift` (how far Settings' toast rises while the pattern's task chip shows on a phone or tablet, 5.5rem, floor 32px, ceiling 240px). Two aliases of the pattern's tokens, `--settings-warn-edge-width` (the pattern's edge width) and `--settings-warn-edge` (its caution edge), give the restart banner the pattern's caution edge; two pattern tokens are set here on purpose, `--pattern-z-layer` (97) and `--pattern-z-toast` (98), because Settings' toast (96) and menus (90) sit above the pattern's default 60.

The pack registry (`checks/th/packlint-settings.mjs`) is left as it was; `checks/th5c2/registry5c2.mjs` extends the 5c-1 registry with the 14 names (4 critical, 0 safe, 10 reach), the floors and ceilings of the five `--p5c2-*` tokens, a copy of the three-line `full()` helper, and then merges the pattern's registry fragment with `mergeRegistry` (`lintPattern` for a pack). Tests: `checks/th5c2/lint.mjs`.
