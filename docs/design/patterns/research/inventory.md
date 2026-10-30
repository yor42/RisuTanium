# Inventory: warning, data-loss, restore, export/import and long-task surfaces

Input to [WARNINGS_AND_PROGRESS.md](../WARNINGS_AND_PROGRESS.md) (DD-219..222). Compiled 2026-10-28.

**Method and limits.** Static reading and grep of the working tree (uncommitted design files included) by four read-only search passes plus direct reads of the mockups. No page was opened in a browser, so every "does" column is source behaviour, not observed behaviour. Text lengths are approximate (about +-20%; Korean characters unless marked EN). Line numbers were true at compile time and will drift. Paths are relative to `docs/design/` unless they start with `src/`. Rows marked "gap" are the missing facts a DD-220 warning must name.

**Columns.** `crit` is whether the surface is `data-part-critical` today (DD-149); "implicit" means `autoCritical` marks it because it has a danger button or `data-drops-data`. `ask/undo` is whether the surface asks first, offers Undo only, or neither.

**Count: 202 rows** = 36 chat (C) + 59 Settings (S) + 48 Studio (T) + 18 mockups (M) + 41 app `src/` (A). About 110 of them are real warning surfaces (ask, banner, guard); the rest are Undo-only rows, status rows, demo-only rows and gaps, kept so the rollout map can see them.

---

## M. Mockups (`mockups/`, `home/`)

None of the `mockups/*.html` pages carries `data-part-critical` (grep: 0 hits); only `home/` does. That is a theming gap (DD-198 retrofit is still pending for these pages).

| id | where (file:line) | trigger | current text | crit | must say |
|---|---|---|---|---|---|
| M-1 | mockups/data-and-backups.html:220-241 | Restore review (file or internal snapshot) | 6-row `dl` (Source, Contents, Destination, Replacement scope, Safety copy, Other tabs) about 420 EN chars plus blocker sentence 150-200 EN; ack checkbox about 190 EN; button "Restore fixture" (danger) | no | counts (24 characters, 180 chats), what is replaced vs kept, safety copy yes/no with size, file name+date; Replacement scope text says "merge rules are OPEN" |
| M-2 | data-and-backups.html:243-250 (runRestore) | Restore running | Named steps (Checking the file, Making a safety copy, Replacing data, Saving); explicit "no percentage"; no Cancel; `aria-current=step` | no | step names exist; no counts, no mark, Cancel point OPEN |
| M-3 | data-and-backups.html:160-175, 263-283 | Restore endings: reload needed / nothing replaced / could not verify save / ack | each ending about 200-330 EN with "Known data state:" lead and Technical details disclosure | no | Already the best model of "lead with what is known"; reuse as the result card's first line |
| M-4 | data-and-backups.html:287-319 (exportFlow) | Export full / selected | Payload line, Excluded line "(proposed, to be confirmed)", file-name field, Prepare, "Preparing export" with "no percentage", Ready to save, Picker canceled, Export failed (+ Try again) | no | exclusions by name and count (MC-774 leave-out list), size, file name, step counts |
| M-5 | data-and-backups.html:355-360 | Cleanup confirm | "Clean up 12 files" (danger) + 2-3 sentences; "this view offers no undo" | no | the 12 files' total size, what "unused" means, names of the largest few |
| M-6 | data-and-backups.html:330-349 | Internal backups list / empty / list failed | list + restore review; failure says "does not mean there are no snapshots" | no | per snapshot: time, size, counts |
| M-7 | data-and-backups.html:222-226 | Restore blockers: busy, other tab, incompatible, unreadable | 100-220 EN each, `role=alert`, Check again / Choose another file | no | which tab/operation; version of the file vs app |
| M-8 | data-and-backups.html:157-159 | Export diagnostics | "Review before sharing. Automatic removal is not promised." + 3 included rows | no | included/excluded list is already counted-by-section |
| M-9 | data-and-backups.html:177-183 | Storage health (integrity result) | table + "Not examined: ..." | no | counts per severity; this is a result card, not a warning |
| M-10 | mockups/startup.html:110-120 | Boot notice / failed / storage-blocked card | message + help + 2 buttons (recovery link, Reload) | no | which store failed; where recovery link leads |
| M-11 | mockups/startup.html:83-94, 160-170, 196-222; boot/bootProgress.ts:6-96 | Boot progress (7 steps, counted library step, recovery from backup) | `role=progressbar`, step list, `bootAnnouncement` per step not per count, mark via `bootMarkStatus` | n/a | **The progress model DD-221 reuses** |
| M-12 | mockups/onboarding.html:456-487, 751-760 | First-run restore a backup (.bin): idle / running / failed / cancelled / ok | "Backup restored. 24 items were brought back." / "This file is not a RisuTanium or RisuAI backup, or a newer version made it. Nothing was changed..." | no | counts by kind; no step list |
| M-13 | mockups/onboarding.html:505, 568 | Finishing setup (mark `finishing`) | status only | no | n/a |
| M-14 | home/strings.js:27, 115; home/lib.js:127-133 | Move characters to 최근 삭제 | KO "{names}은(는) 라이브러리, 이어가기 목록, 동반자 후보에서 사라져요. 채팅도 함께 숨겨지고, 복원하면 돌아와요. 최근 삭제에 30일 동안 보관돼요." (about 85) | yes (`home-confirm`, lib.js:21) | chat count and message count hidden with them; 30 days (present); already close to DD-220 |
| M-15 | home/render.js:241-245, strings.js:32 | 최근 삭제 비우기 ({n}) | button `home-trash-empty` + scope line `home-trash-scope`; confirm text not sampled | yes (both parts) | n characters, m chats, total size, "cannot be undone" |
| M-16 | home/render.js:235-238 | Restore from 최근 삭제: restoring / failed (+ retry) | row state, `home-restore-error` role=alert | yes | which chats come back, why it failed |
| M-17 | home/render.js:252-264, strings.js:71 | Home run row: step n of N, Stop, Cancel wait, failed "제공자가 오류를 돌려줬어요..." | per-row `home-run-stop` | no | n of N is the one counted-progress model outside boot; keep |
| M-18 | home/tasks.js:2, 72-76 | Up to 3 runs per mode; 4th waits (DD-204) | queued/active/ended | no | queued = a state the task card needs (`waiting`) |

---

## C. Chat (`chat/`, slices 1-4, hooks1, toggles)

| id | file:line | where / trigger | text now | crit | does / loses | ask/undo | must say |
|---|---|---|---|---|---|---|---|
| C-1 | slice1.js:1291-1295, 1343-1375 | Delete one message | "Message deleted" + Undo, 6 s | no | removes message + alternatives; commits on Send/chat switch (silent, C-36) | undo | excerpt, alt count, expiry |
| C-2 | slice1.js:1296-1313 | Shift+Delete "this and after" | EN about 62: "{excerpt} and the {n} messages after it will be deleted" | yes | removes range, no undo | ask | n messages, rough size, "cannot be undone" |
| C-3 | slice1.js:1293-1310 | Delete while streaming | KO 30 / EN 75 "still writing, stop first" | yes | stops + removes partial | ask (+undo single) | partial length |
| C-4 | slice1.js:877-889 | Failed-reply card | about 65 EN, Fix / Try again | yes | no reply; retry in place | no ask | provider+model name, whether partial kept |
| C-5 | slice1.js:1378-1408 | Customize buttons > Restore defaults | hint 121 EN | no | resets pins app-wide | none | pins changed, undo |
| C-6 | slice1.js:1727, 1754; slice3.js:909; slice4.js:661 | Demo "Reset chat" | demo only | no | reloads | none | mark as demo; exclude |
| C-7 | slice1.js:892-903 | "Settings changed - Try again?" | about 29 EN | no | status row | dismiss | setting name |
| C-8 | slice1.js:779, 812; slice2.js:486-488 | Stop a reply | "Stopped" | no | keeps partial | none | "partial kept" |
| C-9 | slice2.js:585-597 | Delete chat | EN 37 'Delete "{chat}" and its {n} messages?' | yes | removes whole chat, no undo, toast after | ask, Cancel focused | size, bookmarks, "cannot be undone" |
| C-10 | slice2.js:593-601 | Delete chat while generating | button "Stop and delete", body unchanged | yes | stops job | ask | body line missing |
| C-11 | slice2.js:533-541 | Switch chat while reply writing (fallback) | 24 EN | yes | stops reply, partial kept | ask | chat name, progress |
| C-12 | slice2.js:697-704 | Chat toggle scope off | 44 EN + Undo 6 s | no | discards chat-local values | undo | count, names |
| C-13 | toggles.js:505-513 | same, toggles panel | same, Undo 10 s | no | same | undo | durations differ 6 vs 10 s |
| C-14 | toggles.js:490-491 | Toggle row Turn off / Use all-chats value | labels | no | resets | none | preview |
| C-15 | slice2.js:560, 729 | Export chat | toast "Exported (simulated)" | no | simulated | toast | file, format, size, progress |
| C-16 | slice2.js:838 | Export all chats | same toast | no | simulated | toast | count, size, steps |
| C-17 | slice2.js:838 | Import chat | "Imported (simulated)" | no | simulated; no preview or conflict | toast | source, counts, duplicates |
| C-18 | slice2.js:20, 48, 403-411 | Chat load / load fails | "Loading the chat..." / "Couldn't load the chat" | no | no progress | none | reason, draft safe? |
| C-19 | slice2.js:21-22, 63, 486-491, 527-528 | Background generation strip | "writing a reply", failed count, Stop | no | long task, no percent | Stop | elapsed, chat |
| C-20 | slice3.js:746-759 | Discard new group draft | "Discard this group?" 19 EN | yes | drops members, name | ask | member names/count |
| C-21 | slice3.js:553-575 | Remove group member | "Removed {name}" + Undo 6 s | no | queued turn lost | undo | queue info |
| C-22 | slice3.js:580-583 | Remove missing member | dangerous button, no confirm | implicit | removes | undo only | inconsistent with DD-149 spirit |
| C-23 | slice3.js:817-822 | Redo round (>1 reply) | EN 38 "Remove {n} replies and redo the round?" | yes | no undo | ask | speakers, "no undo" |
| C-24 | slice3.js:823 | Redo round (1 reply) | none | no | removes silently | none | gap |
| C-25 | slice3.js:825-832 | Regenerate an earlier reply | EN 70 "removes {n} later replies" | implicit | may stack C-23 | ask | one confirm only |
| C-26 | slice3.js:878-891 | Pending message "Take it back" | 38 EN | no | nothing lost | undo | small |
| C-27 | slice3.js:271-333 | Skipped member in a round | "Skipped {name}: couldn't load" | no | round continues | none | consequence |
| C-28 | slice3.js:25-55, 798 | Group characters loading / failed | 21 / 28 EN | no | no retry | none | which character |
| C-29 | slice3.js:434, 888 | Auto mode paused / ended | 25 KO | no | long task | none | rounds left |
| C-30 | slice4.js:628-632 | Discard edit | 24 EN | implicit | drops edit | ask | chars changed |
| C-31 | slice4.js:22, 38 | Search in long chat | "Searching..." | no | no progress or cancel | none | scanned n of m |
| C-32 | slice4.js:170 | Selection too long | 41 EN, once | no | partial selection | toast | counts |
| C-33 | hooks1.js:166-176 | Failed preset save before switch | 35 EN, 3 choices; "Undo the change" | yes | discards unsaved change | ask | fields; label says Undo but discards |
| C-34 | hooks1.js:141-152 | Inline failed-save row | 24 EN | no | discard with no confirm | none | same |
| C-35 | hooks1.js:177-184 | Preset/model switch toast + Undo 10 s | 20 | no | restores previous | undo | previous value |
| C-36 | slice2.js:358; slice1.js:1517 | Silent commit of pending undo | none | no | deletion becomes final | silent | say so |

Missing across the set: no confirm body states "cannot be undone"; undo windows are 6 s (slice1.js:1344, slice2.js:699, slice3.js:573) vs 10 s (toggles.js:509, hooks1.js:179/184).

---

## S. Settings (`settings/` slices 1-5b)

| id | file:line | where / trigger | text now | crit | does / loses | ask/undo | must say |
|---|---|---|---|---|---|---|---|
| S-1 | slice1.js:702-707 | Dialog shell | n/a | yes if any danger button | marking rule | - | criticality is opt-in per call |
| S-2 | data.js:329; slice1.js:724-727 | Load backup from file | KO 26 "지금 데이터가 백업 내용으로 바뀌어요. 계속할까요?" | yes | replaces all data | ask, OK = 확인 | file name/date/size, counts, keys, verb button |
| S-3 | data.js:330 | Load in-app backup | same 26 | yes | same | ask | which backup |
| S-4 | data.js:335 | Clean unused archived data | 30, "되돌릴 수 없어요" | yes | deletes assets | ask | count, MB |
| S-5 | data.js:327-333 | Full/partial backup, dataset export, settings export/import | none (toast simulated) | no | nothing | none | key-inclusion note; size; progress; replace vs merge |
| S-6 | data.js:216 | Clear translation cache (generic) | 19 "되돌릴 수 없어요" | yes | contradicts S-54 | ask | stale copy |
| S-7 | data.js:439 | Delete persona (generic) | 20 "되돌릴 수 없어요" | yes | contradicts S-40 | ask | stale copy |
| S-8 | data.js:270-271 | askRemoval / instantRemove settings | labels | no | instantRemove removes following messages | setting | count |
| S-9 | slice2.js:1115-1129 | Delete preset | title 14 + active note 45 + usage 20 | yes | removes with links; restorable | ask + Undo 10 s | 10 s + 30-day trash not stated |
| S-10 | slice2.js:1125-1128 | Bulk delete presets | 17 + up to 5 names | yes | as S-9 | ask + Undo | which becomes active |
| S-11 | slice2.js:1117-1119 | Last-preset guard | 35 | yes | blocks | block | fine |
| S-12 | slice2.js:352, 673-676 | Undo toast after delete | 15 | yes (kinds) | restores | undo 10 s | countdown |
| S-13 | slice2.js:1216-1228 | 최근 삭제 list | hint 45; "30일이 지나면 사라져요" | yes | restore / purge | restore no ask | days left per item |
| S-14 | slice2.js:1230-1233 | Purge from 최근 삭제 | 18 + 16 | yes | permanent | ask | undo steps removed |
| S-15 | slice2.js:701-706 | Restore from 최근 삭제 | toast 17 | no | puts back | none | fine |
| S-16 | slice2.js:1168-1169 | Restore points list | hint; cap 10 | yes | list | list | which settings differ |
| S-17 | slice2.js:1171-1175, 491-497 | Restore a point | 17 + 47 "지금과 다른 설정 {n}개가 바뀌어요" | yes | overwrites; keeps 복원 전 | ask + undo | names old to new |
| S-18 | slice2.js:1183-1212 | Import preview | caution 50 | yes | additive | ask | sizes |
| S-19 | slice2.js:1234-1236 | Bundle export | notes 14 + 22 | yes | writes file | ask | **no "keys excluded" line** (import has one) |
| S-20 | slice2.js:1273-1276 | Delete folder | 39 | yes | presets moved | ask + Undo | fine |
| S-21 | slice2.js:384-388 | Shared-lock off | 17 + 50 | yes | overwrites current values | ask | count + names |
| S-22 | slice2.js:434-442 | Failed save guard | 14 + 35 | yes | discard has no undo | ask | fields, reason |
| S-23 | slice2.js:1297 | Save status "저장 실패 - 다시 시도" | 12 | yes | status | - | reason |
| S-24 | slice2.js:1370, 1543; slice5a.js:148-150 | Key swap | one line | yes | swaps keys | ask + undo | - |
| S-25 | slice2.js:1141-1157 | Slot assign/move/swap | note | **no** (spec says critical) | moves key | ask | which preset loses key |
| S-26 | slice3.js:1046-1056 | Delete connection | 16 + users (5 names) + 70 hint | yes | removes models + key | ask + Undo | custom model count, key loss unconditional |
| S-27 | slice3.js:354-372 | Undo connection delete | 12 | yes | restores minus key | undo | say key not restored before click |
| S-28 | slice3.js:317-326, 1057-1060 | Clear connection key | 12 + 14 | yes | no undo | ask | which presets lose model |
| S-29 | slice3.js:393-398 | Delete custom model | toast only | no | removes | undo | ask? |
| S-30 | slice3.js:697-700 | Use unverified model | 21 | yes | sets model | ask | meaning |
| S-31 | slice3.js:534-1234 (many) | Connection warnings / fix marks | badges | yes | state | - | counts |
| S-32 | slice3.js:336-349, 874, 915 | Connection test (long) | "testing" + testcancel | on failure | sends request | Cancel exists | elapsed, cost |
| S-33 | slice4.js:655-677 | Replace logit-bias list | 14 + 45 EN | yes | replaces all | ask + undo | names of lost entries |
| S-34 | slice4.js:498-507 | Reset group to default | 18 + Undo | no | resets | undo | count |
| S-35 | slice4.js:416 | Remove extra parameter | button | no | removes | none traced | undo copy |
| S-36 | slice4.js:300-455, 689-738 | Parameter warnings, leave-out notes | variable | yes | state | - | counts |
| S-37 | slice5a.js:82-96 | 최근 삭제 (personas, plugins, modules) | session only | **no** | restore | none | retention contradicts S-13 |
| S-38 | slice5a.js:91-92 | Purge in that list | toast 4 s | no | permanent | **no ask** | inconsistent with S-14 |
| S-39 | slice5a.js:238-245 | Reset all shortcuts | 22 + 45 EN | yes | resets | ask + Undo | which chords |
| S-40 | slice5a.js:325-343 | Delete persona (asks only if chats linked) | 20 + 50 | yes when asked | unbinds chats | ask-if-linked | chat names |
| S-41 | slice5a.js:284, 327 | Last-persona guard | 15 | yes | blocks | block | - |
| S-42 | slice5a.js:478-486 | Delete plugin | 40 "데이터는 되돌리기로도 돌아오지 않을 수 있어요" | yes | removes code + settings | ask + Undo | size of saved data (O-3 open) |
| S-43 | slice5a.js:441, 511 | Plugin install banner + file picker | 37 | yes | runs code | ask | source, access |
| S-44 | slice5a.js:528-529 | Developer-mode import | menu | no | adds disabled stub | Undo | confirm |
| S-45 | slice5a.js:489-492 | Plugin settings file import | toast 12 | no | overwrites values | undo | old to new count |
| S-46 | slice5a.js:420-434 | Plugin update check (long) | status | yes | none | - | progress |
| S-47 | slice5a.js:707-717 | Delete module | 35 "캐릭터 N개 - 채팅 N개 - 프리셋 N개" | yes | removes + cleans refs | ask + Undo | names |
| S-48 | slice5a.js:749-772 | Import modules, duplicate | 35 | yes | replace overwrites | ask | replace should be danger |
| S-49 | data5a.js:215, 265 | Enable low-level module | 28 | yes | direct access | ask | which access |
| S-50 | slice5b.js:326-331 | Delete HypaV3/translation preset | 18 | yes | removes | ask + Undo | users count |
| S-51 | slice5b.js:374-378 | Change memory engine | toast 18 | no | rewrites 5 fields | undo | old to new |
| S-52 | slice5b.js:412-417 | Reset whole HypaV3 preset | toast | no | resets | undo | confirm |
| S-53 | slice5b.js:606-611 | Import translation cache | 17 | no | merges | ask + undo | counts |
| S-54 | slice5b.js:612-617 | Clear translation cache | 35 "10초 안에는 되돌릴 수 있어요" | yes | clears; 10 s undo | ask + undo | MB; countdown |
| S-55 | slice5b.js:347-351, 586, 631 | First-use local model download | 22 "약 {size}" | yes | downloads | none | **no progress, cancel, metered copy** |
| S-56 | slice5b.js:160-175 | Service test / model fetch (long) | timeout 30, warming 35 | yes | states run/ok/fail/cancel | Cancel | elapsed |
| S-57 | slice5b.js:794 | Remove LoRA | toast | no | removes | undo | - |
| S-58 | slice5b.js:725 | Reset one row | announce | no | resets | none | - |
| S-59 | slice5b.js:262 | Last HypaV3 preset guard | 15 | yes | blocks | block | - |

Discrepancies found: slot take not critical (S-25) against DS-072; bulk delete lacks active-preset note (S-10); 최근 삭제 retention differs (S-13 30 days vs S-37 session) against DS-024; purge asks in slice 2 but not slice 5a (S-14/S-38); stale "되돌릴 수 없어요" copy (S-6, S-7); generic confirm OK label is "확인", not a verb (S-2..4).

---

## T. Studio (`studio/` slices 1-4)

| id | file:line | where / trigger | text now | crit | does / loses | ask/undo | must say |
|---|---|---|---|---|---|---|---|
| T-1 | slice1.js:832-843 | Apply draft to live | 48 + warn 30 | yes | replaces live code; old kept device-only | ask | item name, line delta, warning codes |
| T-2 | slice1.js:850 | Applied toast + Undo 6 s | - | yes | - | undo | which version returns |
| T-3 | slice1.js:796 | Conflict banner | 22 | yes | none | - | what changed |
| T-4 | slice1.js:868-891 | Apply with changed base | 50, 4 choices | yes | drops/moves draft | ask | +/- counts |
| T-5 | slice1.js:798 | Draft store write fails | 37 | yes | may lose drafts | banner | how many drafts |
| T-6 | slice1.js:1291-1309 | Leave with failed/pending save | 28; "그냥 나가기" plain | yes | unsaved lost | ask | which items; danger style |
| T-7 | slice1.js:1310-1314 | Close Studio | none | no | drops delete-undo and 삭제한 항목 | silent | count + names |
| T-8 | slice1.js:1083-1095 | Restore point | 19 + 50; lists 8+4 | yes | reverts all, 1 undo | ask | exact counts |
| T-9 | slice1.js:1091-1094 | Per-item skip when changed elsewhere | 75 | yes | overwrites other device | ask | device, field |
| T-10 | slice1.js:537-549 | Delete live item (DD-100) | toast 12 + Undo 6 s | toast yes | removes item, draft, prior lists | undo only | attached data |
| T-11 | slice1.js:441-447 | History step revert | toast | toast yes | reverts | undo | steps count |
| T-12 | slice1.js:853-858 | Discard draft | toast 9; `discardOk` unused | yes | discards | undo only | size |
| T-13 | slice1.js:701-724 | Script mode switch | 42, stores list | banner yes | stores prior list | undo 5 s | SLICE1 spec says today's app confirms+wipes |
| T-14 | slice1.js:715-721 | Restore stored list ('aside') | toast | banner yes | overwrites draft | undo | which draft |
| T-15 | slice1.js:728-746 | Changed in other tab | 68 | yes | overwrites | undo | compare |
| T-16 | editor.js:1113-1122 | Replace all in code | announce | no | rewrites all | undo (Ctrl+Z) | count |
| T-17 | lte-focus.js:128-132 | Focus revert | toast 4 s, no action | button yes | reverts field | none | chars changed |
| T-18 | lte-focus.js:123-127 | Focus replace all | toast 3 s | no | replaces | owner undo | count |
| T-19 | lte-lists.js:151-158 | Delete greeting/example card | toast + Undo | yes | removes | undo | length |
| T-20 | lte-lists.js:178-183 | Paste many | preview 12 | no | appends | - | "adds N" |
| T-21 | tgb.js:305-321 | Delete toggle (group = subtree) | 12 + Undo | yes | removes rows | undo | child count |
| T-22 | tgb.js:467-476 | Delete select option | none | no | numbers shift | Ctrl+Z | saved values using it |
| T-23 | tgb.js:137-163 | Carry saved values after rename/reorder | 13 + 100 | yes | moves/overwrites | ask inline | no count by DD-114 |
| T-24 | tgb.js:777; tgb-view.js:179 | Group never closed | 32 | yes | none | fix | how many toggles fall in |
| T-25 | st4-basic.js:17-21 | Reveal private-licence content | 9 + 40 + 33 | yes | read-only reveal | ask | name, which surfaces |
| T-26 | st4-basic.js:10-14 | Private notice | 40 | no | status | - | - |
| T-27 | st4-adv.js:112-117 | Risky section warning | 42 | yes | static | - | named capability |
| T-28 | st4-adv.js:141-160 | Turn on risky flag | 15 + 52 + 29 | yes | writes flag | ask once (DD-165) | affected chats; OK button `btn solid` vs spec danger |
| T-29 | st4-adv.js:170-175 | Redo/history turning a flag on | same sheet | yes | applies | ask once/session | which step |
| T-30 | not mocked (SLICE4_SPEC:21, 361) | Import card with low-level access | none | n/a | - | spec says asks | unmocked |
| T-31 | st4-disp.js:38-64; st4-core.js:11 | Image import in flight (DD-191) | "가져오는 중 - {name}" role=status | no | adds files | no cancel | n of m, cancel |
| T-32 | st4-disp.js:42-57 | Import done (Studio open) | "{n}개 추가, {m}개 못 가져왔어요" + 보기 | toast yes | - | - | names and reasons of failed |
| T-33 | st4-disp.js:58; slice1.js:1073 | Import done, Studio closed (DD-196) | same + "Studio에서 보기" | yes | - | - | item name |
| T-34 | st4-disp.js:20-35 | Picker | 27 | no | none | - | unsupported types up front |
| T-35 | st4-disp.js:262-268 | Rejected files list + 닫기 | - | no | clears | none | count |
| T-36 | st4-disp.js:265-269; st4-core.js:290 | Store-failure rows; leaving clears them | 8 | no | silent drop | none | names |
| T-37 | st4-disp.js:88-95 | Delete emotion image | toast + Undo 6 s | yes | removes | undo | size |
| T-38 | st4-disp.js:88-95, 159 | Delete asset used in text | toast + Undo | yes | **breaks `{{image::name}}` uses silently** | undo | used-in count (DD-190 already scans) |
| T-39 | st4-disp.js:163-166 | Rename asset | inline note 18 | no | text not rewritten | - | good counted example |
| T-40 | st4-disp.js:239-244 | Delete portrait | 27 + Undo | yes | promotes next | undo | name |
| T-41 | st4-disp.js:229-236 | 바꾸기 on main | note | no | old main to alternates | - | name |
| T-42 | st4-disp.js:302 | 기본값으로 되돌리기 | 11 | no | overwrites field | none | preview |
| T-43 | st4-disp.js:293-300 | Display mode switch fills defaults | note | no | fills empty/default fields | 1 undo | field list |
| T-44 | st4-group.js:78-86 | Remove group member | 12 + Undo | yes | removes talk value | undo | values lost |
| T-45 | st4-adv.js:40-46 | Delete bias token | toast | yes | removes | undo | token+value |
| T-46 | st4-adv.js:74-81 | Apply module (copy) | 36 | no | would overwrite fields | - | which fields |
| T-47 | st4-adv.js:82-87 | Convert to module | toast + 열기 | yes (mislabel) | creates copy | - | - |
| T-48 | data4.js:100-102; data.js:64, 124 | No export/import UI in slices 1-4 | text only | n/a | - | - | **gap: card/lorebook import-export unmocked** |

Open items from the Studio pass: `toastParts` (slice1.js:1062) marks every action toast `data-part-critical`, including non-undo "보기" toasts (T-32, T-33, T-47); closing Studio silently drops delete-undo (T-7).

---

## A. App source (`src/`, read-only reference)

Confirmed by reading `backuplocal.ts`, `alert.ts`, `characters.ts`, `characterCards.ts`, `bootstrap.ts`, `database.svelte.ts`, `exportAsDataset.ts`, parts of `storageMaintenance.ts` and `manualCleanup.ts`. Messages are language keys in `src/lang/*.ts`. **No `alertProgress` exists** (alert.ts): progress is `alertWait`/`alertStore.set({type:'wait'})` with counts written into text. Only `alertWait` with `onCancel` can be cancelled (AlertComp.svelte:345-348). `.bin` = the file name extension of local backups (`src/ts/drive/backupFileName.ts:6-10`: `local-YYYYMMDD.bin`, partial `local-partial-YYYYMMDD.bin`). The mockups call the same thing `.risub`; see open question Q10.

| id | file:line | what | alert type | counts / cancel | maps to |
|---|---|---|---|---|---|
| A-1 | src/ts/drive/backuplocal.ts:344-346 | SaveLocalBackup (full) wrapped in `withBusy('backupSave')` | alertWait | no cancel | M-4, S-5 |
| A-2 | backuplocal.ts:348-360 | writeLocalBackup start + cold-storage gate (`confirmIncompleteColdStorageOperation`, :353) | alertWait, confirm | none | backup confirm |
| A-3 | backuplocal.ts:471-488 | Inlays "(done / total)", cold data "(i / n)", "Saving database" | alertWait w/ counts | counts, no cancel | backup steps |
| A-4 | backuplocal.ts:517-530 | Result: `alertMd` notes (`backupInlaysLeftOut`, `backupInlaysOldStoreUnlisted`) else `alertNormal('Success')` | alertMd/alertNormal | - | **existing "left out" report** |
| A-5 | backuplocal.ts:313-322 | Asset failure during export | alertError (4 keys: too large / nothing written / file deleted / file kept) | - | failure states |
| A-6 | backuplocal.ts:544-559 | SavePartialLocalBackup: two chained confirms (`partialBackupFirstConfirm`, `...SecondConfirm`, about 400 cn chars each) | alertConfirm x2 | - | **the wall of text DD-220 replaces**; lists included/excluded image types |
| A-7 | backuplocal.ts:563, 722-724 | Partial save progress, result "Success" + `partialBackupInlaysNotIncluded` | alertWait/alertNormal | - | - |
| A-8 | backuplocal.ts:826-851; src/ts/drive/backupWorkGuard.ts:16-20 | LoadLocalBackup; refused when busy (`backupLoadWorkInProgress`) | file input `.bin`; alertError | - | M-7 |
| A-9 | backuplocal.ts:871, 997 | Reading backup | alertWait | text only | M-2 |
| A-10 | backuplocal.ts:879-901 | `backupFileUnreadable`, `encryptedBackupRefused` | alertError | - | M-7 |
| A-11 | backuplocal.ts:907-914 | Oversized asset/inlay confirms (names via `shownSkippedNames` :822) | alertConfirm x3 | skipped names | **skipped list** |
| A-12 | backuplocal.ts:929-945 | No-lock-support warning / checking other tabs / other tab refused | alertConfirm, alertWait, alertError | - | M-7 |
| A-13 | backuplocal.ts:1223; src/ts/drive/restoreReplace.ts:191 | `leftOutQuestion(leftOut)` before replace | alertConfirm | list | M-1 |
| A-14 | backuplocal.ts:1250-1311 | Refusals: `restoreNotHappenedNotice`, `restoreTooLargeBlock`, `restoreRefusedUnsavable`, repair refusals | alertError/Normal | - | M-3 |
| A-15 | backuplocal.ts:1342-1358 | Non-blocking notices with counts: assets skipped, too large, inlays invalid / not stored / too large | alertNormalWait x5 | **counts** | **skipped list in result card** |
| A-16 | backuplocal.ts:394, 1410 | `restoreSavedReloadOrRestart`, `restoreWriteFailed` | alert | - | M-3 |
| A-17 | backuplocal.ts (hard-coded English: "Saving local backup...", "Failed", "Success", "Failed, Is file corrupted?" :1203, :1438; internalBackup.ts "Loading backup...") | not localised | - | - | copy gap |
| A-18 | src/ts/drive/inlayBackupExport.ts:261; inlayBackupImport.ts:229 | inlay container write/restore | - | - | - |
| A-19 | src/ts/drive/internalBackup.ts:178-210 | loadInternalBackup: list via alertSelect; list failure `internalBackupListFailed` | alertSelect | - | M-6 |
| A-20 | internalBackup.ts:243 | `alertWait(internalBackupWaitingForCleanup, cancelWait)` | alertWait + cancel | only cancellable wait found | cancel precedent |
| A-21 | internalBackup.ts:260-328 | No-lock confirm; damage/offer; `restoreNoUndoCopyConfirm(reason)` | alertConfirm | - | M-1 safety copy |
| A-22 | internalBackup.ts:373-402 | Result keys: loaded / no copy / write failed / not rebuilt / copy failed / unreadable | alert | - | M-3 |
| A-23 | src/ts/storage/bootBlockLoad.ts:167-177 | Boot: save damaged; choose "Load the newest backup (saved DATE)" / "Stop and change nothing" | ctx.ui.choose/notify | date | M-10, M-11 |
| A-24 | bootBlockLoad.ts:360-365 | Partial-backup left-out lines (`internalBackupLeftOutPresets`...) | text | list | left-out model |
| A-25 | src/ts/bootstrap.ts:605-607 | boot ui adapter: notify, choose, confirm | alertNormalWait/Select/Confirm | - | M-10 |
| A-26 | bootstrap.ts:980-1019 | Lorebook corruption: report?, diagnostics, "reset lorebook?" (sets `v.lorebook = []`) | alertError, alertConfirm x2, alertMd | - | destructive reset |
| A-27 | bootstrap.ts:524, 529, 1045, 1157 | Nightly warning; repaired-entries toast; personas repaired; possible asset corruption | alertMd/toast | - | notices |
| A-28 | src/ts/storage/storageMaintenance.ts:31-109 | Asset integrity scan: progress, none found, evict confirm `assetIntegrityEvictConfirm(count)` | wait w/ counts, confirm | counts | M-9 |
| A-29 | src/ts/storage/manualCleanup.ts:489-497, 614, 960-965 | Cold-storage cleanup confirms (kept, leftover, copy, no-lock, other-device) | alertConfirm x5 | - | M-5 |
| A-30 | manualCleanup.ts:714, 841, 860, 917-921, 942-946 | Cleanup progress `coldStorageCleanupRemoving(done,total)`, partial/stopped, done, refusals | alertWait/Error/Normal | counts, no cancel | M-5 |
| A-31 | src/ts/storage/exportAsDataset.ts:17-58 | Dataset export (`withBusy('export')`); groups skipped; archived read from cold; success lists skipped names (`coldStorageDatasetExportSkipped`) | alertNormal | skipped names | **skipped list precedent** |
| A-32 | src/ts/characterCards.ts:1072-1093 | exportChar -> `alertCardExport()` format picker (png v3, ccv2 png, charx, charxJpeg, json, realm) | cardexport | - | export format pick |
| A-33 | characterCards.ts:180-214, 751-756, 2272 | importCharacter / drop import / Realm import | alertError | none | import progress |
| A-34 | src/ts/storage/database.svelte.ts:2355-2374, 2404 | downloadPreset clears secret fields (openAIKey, proxyKey, forceReplaceUrl(2), textgenWebUI URLs); importPreset | - | - | S-19 key-exclusion copy |
| A-35 | src/ts/process/modules.ts:48-52, 650; ModuleSettings.svelte:104-109 | exportModule (CharX recommended / risum legacy), importModule; `importModulesDone` toast | alertSelect, toast | - | S-47/48 |
| A-36 | src/ts/characters.ts:293-474, 616 | exportChat (JSON/HTML/TXT), exportAllChats, importChat | - | - | C-15..17 |
| A-37 | characters.ts:1259-1266; Chat.svelte:272 | Delete chat confirm (+ `onlyOneChat`); gated by `db.askRemoval` | alertConfirm | - | C-9 |
| A-38 | characters.ts:939-961; CharConfig.svelte:741-748; CharacterTrashList.svelte:43 | Remove character: **two** confirms; trash list permanent delete | alertConfirm x2 | - | M-14, M-15 |
| A-39 | LoreBookData.svelte:166, 190; RegexData.svelte:99; TriggerV1Data.svelte:49; characters.ts "emptyTrashCannotUndo" (:1045), `deleteFolderTrashConfirm` (:1133) | List/folder/trash deletes | alertConfirm | - | T-21 etc |
| A-40 | src/ts/process/coldRestoreAll.ts, update.ts, process/models/local.ts | Cold restore all, update, local-model download | alertWait w/ counts (per STATUS_INVENTORY.md:16) | counts, not opened | long-task surfaces (not read in detail) |
| A-41 | Not located: host Svelte component of SaveLocalBackup/LoadLocalBackup; `partialBackup*Confirm` EN text; `confirmIncompleteColdStorageOperation` text; `database.svelte.ts:2394` caller | - | - | - | gaps |

**What `.bin` leaves out (MC-774) in source.** Full `.bin` includes database, assets, cold storage and inlays; partial excludes emotion images, extra assets, VITS, CC assets, all other media and inlays (A-6, A-7). Presets scrub secrets (A-34). Search of `src/ts/drive` and `src/ts/storage` found **no list of fork-only data** (only a test file mentions "fork"), so the leave-out list for MC-774 must be built at export time from the design-side items in [ENGINE_CHANGES.md](../../ENGINE_CHANGES.md) and [settings/ENGINE_CHANGES.md](../../settings/ENGINE_CHANGES.md): typed failure record on messages (#1), chat-level jailbreak/memory fields (#4), deleted-member names (#10), member colour slots (#11), hide-names and reply-when-complete settings (#12), edit drafts and message-height cache (#15), plus the Settings-side fork-only stores. #18 (Studio device-local drafts) never leaves the device and is never in any export, so it is a footnote, not a leave-out. These are INFERRED from design docs; Lane A confirms.
