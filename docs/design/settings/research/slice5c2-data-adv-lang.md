# Slice 5c-2 source discovery: 데이터·백업 (data), 고급 (adv), 언어 (lang), and adoption of the shared warning/progress pattern

Date 2026-10-28. Source read only, nothing run, no mockup opened. OBSERVED = read in code or design files; INFERRED = my reading, not executed. Anchors are `path:line`. Proposals live only in section 8; open questions in section 9; not-verified list in section 10.
Abbreviations: UST = `src/lib/Setting/Pages/UserSettings.svelte` (the app's "Backup & Files" page, `language.backupAndFiles`, Settings.svelte:119); SMS = `StorageMaintenanceSettings.svelte`; ADV = `src/ts/setting/advancedSettingsData.ts`; LNG = `src/ts/setting/languageSettingsData.svelte.ts`; BL = `src/ts/drive/backuplocal.ts`; IB = `src/ts/drive/internalBackup.ts`; DB = `src/ts/storage/database.svelte.ts`; EN = `src/lang/en.ts`; D1 = `docs/design/settings/data.js`; D5B/D5C1 = `data5b.js`/`data5c1.js`; PAT = `docs/design/patterns/`; WP = `PAT/WARNINGS_AND_PROGRESS.md`; INV = `PAT/research/inventory.md`.

## 0. Headline facts
1. OBSERVED: the app has no `.rtb` anywhere in `src/`. The only formats are `.bin` (local backup, picker `accept='.bin'`, BL:837; names `local-YYYYMMDD.bin` and `local-partial-YYYYMMDD.bin`, `backupFileName.ts:6-11`) and the internal snapshots `database/dbbackup-<ms/100>.bin` (IB:23; globalApi.svelte.ts:1836). The grep for `rtb` in `src` hits two files; the one I checked (globalApi.svelte.ts:2473) is the substring in "defaultProxyJobHeartbeatSec"; the other (`storageTabLocks.ts`) I did not open. `.rtb` is therefore a fork-engine feature described only in design documents (ENGINE_CHANGES.md:52, DECISIONS-settings.md:480-502, DD-228). The mockup needs a synthetic `.rtb` flow with nothing in this clone to source it from. `.risub` no longer appears under `docs/design/settings/` (grep: no match), so the DD-228 placeholder cleanup is done there; the demo still has no `.rtb` backup control (see 2.1).
2. OBSERVED: the restore does not "replace data" in one write. The file restore writes assets, cold-storage units and inlays into the store as it reads the file (BL:1123, 1149, 1152, 1195) and only later replaces the database (BL:1298). The app's own errors say so: "Some images or cold-storage entries may already have been added or replaced. Your current database was not changed." (EN:2034, 2039, 2043). So "the first write" for DD-224 is the first asset, long before the pattern's `replace` step. This is the biggest fit problem for the pattern (section 3.3, question 1).
3. OBSERVED: the file restore finishes with a full reload (`location.reload()` / `relaunch()`, BL:1386-1395; IB:382-390), after up to six awaited notices (BL:1339-1364). A result card in the same page cannot outlive the restore; the pattern's "restore result" has to show before the reload or be the last thing the app says.
4. OBSERVED: there is no "settings file" export/import. The mockup's `data.exportSettings` / `data.importSettings` (D1:332-333) have no app source. The app has a diagnostic: "Export Settings for Bug Report" (Advanced page, `SettingsExportButtons.svelte:36-76`), which strips about 35 named keys plus any key whose name contains `key`, `proxy` or `hypa`, adds `meta`, downloads `risuai-settings-report.json` and copies it to the clipboard. It is not importable.
5. OBSERVED: `data.persist` ("Ask the browser to keep storage") has no setting. The app calls `navigator.storage.persist()` itself, only in standalone/PWA display mode, once at boot (bootstrap.ts:503-508).
6. OBSERVED: the cold-storage switch lives on 고급 in the app (ADV:168, `archiveCharacters`, read as `!== false`, so ON by default), not on the backup page. D1 puts it on data with default false (D1:336).
7. OBSERVED: streaming optimisation (`streamingDisplayOptimizationMode`, ADV:145-161) is retired by DD-071 (DECISIONS.md:515-520: "the setting goes away"). `keepSessionAlive` is hidden on Android (ADV:71, `!isAndroidTransport()`).

## 1. Today in the app

### 1.1 Backup & Files page (UST, SMS): 8 items
Everything is a plain button wired to an `alertConfirm` chain; the page is one `h2` and eight buttons.

| Item (EN label) | Action / stored field | Confirms before | Takes effect / notes |
|---|---|---|---|
| Save Backup Locally | `SaveLocalBackup()` (UST:15-22; BL:344) | one: "Do you really want to save backup?" (UST:17, EN:1269) | full `.bin`, see 1.2 |
| Save Partial Backup Locally (Excluding Character Assets) | `SavePartialLocalBackup()` (UST:24-31; BL:544) | three in a row: the same one, then `partialBackupFirstConfirm` and `partialBackupSecondConfirm` (BL:546-557; EN:2030-2031, about 600 characters each, with warning emoji) | partial `.bin`, see 1.2. Inventory A-6 already names this the wall of text DD-220 replaces. |
| Load Backup Locally | `LoadLocalBackup()` (UST:33-43; BL:826) | `refuseBackupLoadWhileBusy()` first, then two: "All datas will be lost!" and "Do you really, really want...? All datas will be lost!" (EN:1270-1271) | restore from file, see 1.3. Copy overstates: the restore keeps what the file lacks for assets (additive) but replaces the database. |
| Load Internal Backup | `loadInternalBackup()` (UST:45-55; IB:178) | the same two confirms, then a list (alertSelect) whose first option is "Cancel", then the dates (IB:196-205) | restore from a numbered snapshot, see 1.4 |
| Clean Unused Archived Data and Assets | `cleanColdStorage()` -> `runManualCleanup()` (UST:57-64; coldstorage.svelte.ts:501) | `cleanColdStorageConfirm`: "permanently delete all unused archived (cold storage) data and all unused asset files, meaning images and audio that no character, module, persona or setting uses ... cannot be recovered" (EN:2189); then up to five more confirms for kept/leftover/older copies (manualCleanup.ts:489-497, 614) | irreversible; progress `coldStorageCleanupRemoving(done,total)`; no cancel (INV A-30). The label includes the assets; the mockup label "사용하지 않는 보관 데이터 정리" does not. |
| Export Save as Dataset | `exportAsDataset()` (UST:66-68; `exportAsDataset.ts:17`) | none | downloads `dataset.json`: one row per chat of every non-group character `{name, description, chats, lorebook}`; archived characters are read from cold storage one at a time, unreadable ones are named in the end notice; no progress at all (`withBusy('export')` only). |
| Asset Cache Integrity: "Warn on startup if a quick sample check finds corruption" | `checkCorruption`, boolean, default false (DB:627) | none | SMS:12; shown only `!isTauri` (SMS:9) |
| Verify Asset Cache Now | `verifyAssetIntegrity()` (SMS:13-17; `storageMaintenance.ts:55`) | only if mismatches are found: `assetIntegrityEvictConfirm(count)` (storageMaintenance.ts:105) | checks cached images/assets against their content hash, "Read-only unless you choose to remove a corrupted entry" (EN:2345); progress `assetIntegrityVerifyingProgress(done,total)` (:76-78); Cache API only, so `!isTauri` |

Items 7 and 8 are web/Node only (SMS hides them on Tauri). Android is the Tauri build here (`isTauri`), so Android has neither (INFERRED: Android reports `isTauri`; I did not trace `platform.ts`).

### 1.2 Backups: what is written
OBSERVED, `writeLocalBackup` (BL:348-532) and `writePartialLocalBackup` (BL:562-726):
- Order: gather cold-storage units and ask `confirmIncompleteColdStorageOperation` if some are missing (BL:351-355) -> open the writer (`LocalWriter.init`; Tauri: a save dialog; web: a download stream) (BL:357-362, globalApi.svelte.ts:3201-3218) -> assets -> inlays (full only) -> cold-storage units -> encode the database -> late cold units -> `database.risudat` written last -> `close()` (BL:488-491).
- Entries: named length-prefixed entries, each at most 4 GiB (u32 length; globalApi.svelte.ts:3227-3248, `BackupAssetTooLargeError` BL:191). The database is `db` with `account: undefined` (BL:67-95), so connection keys inside the database ARE in the file (DS-069 agrees: full backups keep keys). The warning copy "includes keys, do not share" (WP:351) has a real basis.
- Full: every key under `assets/` from the store listing (BL:413-415) + inlays + cold units + database. Partial: only referenced profile images (characters, user icon, persona icons, background, folder images, bot preset images), cold units, database; no emotion images, additional assets, VITS files, CC assets, and NO inlays (BL:582-634, EN:2050).
- Omits: the account; for upstream-bound use, the fork-only data (no list exists in `src`, INV A-41; DD-227 says Lane A will supply it, design uses a mock list).
- First write: web = the download stream opens at `init` (a helper page must answer within 10 s or the export falls back to memory, exportWriters.ts:223-266); Tauri = the file is created when the save dialog returns; cancelling the dialog returns false and the app shows `alertError('Failed')` (BL:359-362), which is a misleading message for a cancel (OBSERVED).
- Progress is text only, English, hard-coded: "Saving local Backup... (i / n)" for assets, "Saving local Backup Inlays... (done / total)", "Cold data (i / n)", "(Saving database)" (BL:427, 471, 476, 488). No bytes, no percent. INV A-17.
- Cancel: none. The only cancellable wait in the whole flow is "waiting for startup clean-up" in the internal-backup load (IB:243, INV A-20).
- Failure: `runExport` reports one of: nothing written, file deleted (Tauri), file kept (web stream or undeletable), plus a variant for an asset over 4 GiB (BL:267-324; `language.backupFailed*`). Missing assets are skipped and listed ("Backup Successful, but the following assets were missing and skipped", BL:496-528), as are inlays left out, late cold units, and an id-repair notice.
- Web memory: if the download helper is unavailable, the whole backup is built in memory first (`BlobDownloadWriter`, exportWriters.ts:162-190) and the app tells the person beforehand (`exportHeldInMemory`, :252). Size of a backup: not stated anywhere in the UI.

### 1.3 Restore from file (BL:826-1440)
Sequence, OBSERVED:
1. busy guard (BL:831), file picker `.bin`, read-only-page refusal (:847), busy guard again (:851).
2. Walk the file index with a "Checking local backup... (x.xx%)" wait (:865-874). Unreadable -> "The file could not be read. Nothing was imported." (:879). An encryption marker -> refuse (EN:2033); nothing written.
3. Node server only: oversized assets/inlays are named in a confirm "Continue without them?" (:892-919).
4. Non-Tauri: take the exclusive cross-tab lock within 2 s (`RESTORE_EXCLUSIVE_LOCK_TIMEOUT_MS`, :744, :929-950). Refused -> "Another tab ... Nothing was restored." If the browser has no Web Locks: a confirm to go on anyway (:931).
5. THE PASS (:989-1169), the first write: for each entry, assets are written to the store (overwriting same-named keys, `'unconditional'`; large ones streamed in slices on desktop), cold-storage units are written (`setColdStorageItem`), inlay parts are collected. Wait text "Loading local Backup... (x.xx%)". A file that changes while being read, or a marker found now, stops the pass with "Some images or cold-storage entries may already have been added or replaced. Your current database was not changed." (EN:2034, 2043).
6. After the pass: inlays written; database decoded (`salvageRisuSave` for the block format: damaged blocks are left out and a confirm lists them, :1223); cold-storage completeness confirm (:1241); character-id repair; `buildRestoreSet`; take `dbWriteLock`; busy guard once more at the flip (:1293); `replaceWithRestoredSet` (:1298) with results `not-happened | too-large | unsavable | unconfirmed | landed`.
7. Landed: `setDatabase`, up to five notices awaited (skipped names, too large, inlay reasons, id repair), "Success, Refreshing your app.", reload/relaunch (:1339-1395).
- Endings in the app: nothing restored (several messages), write failed (`restoreWriteFailed`), saved but could not reload (`restoreSavedReloadOrRestart`, :1405), unconfirmed (`saveDamagedUnconfirmed`, :1318: nothing may save from this page until a reload). These map onto the pattern's `dataState: same | partial | unknown`.
- Destructive effect: the database (characters, chats, presets, settings) is replaced as a whole. There is NO safety copy in the file path; the numbered snapshots the app writes itself (min every 5 minutes, globalApi.svelte.ts:771, 1836) are the only fallback, and the pattern's "make a safety copy" step has no counterpart in `LoadLocalBackup` (OBSERVED: no call to `keepCurrentState` in BL; it exists only in IB:146).
- Cancel: none. Cancel before the first write is possible for steps 1-4 only if the engine accepts an abort signal during the index walk (it takes none today; INFERRED small).
- Sizes: the walk and pass read the file through `file.slice` per entry (BL:1012, 1097), so memory use is about one entry plus, on web, whole-asset buffers (a streamed path exists only on desktop, `streamLargeAssets`, :985). Databases and cold units are decoded whole. No size is shown to the person.

### 1.4 Restore from internal snapshot (IB:178-414)
- Snapshots are written by the app itself (not by this page): at most one new snapshot per 5 minutes, named by time. This page only lists and loads them. How many are kept: not traced (pruning is in `getDbBackups`, globalApi.svelte.ts:2429-2438 area).
- List shown with `alertSelect`, plain dates (`toLocaleString`). No size, no character count.
- Safety copy: `keepCurrentState()` stores the current committed state as a new numbered snapshot first, so the load "can be undone from the same list" (IB:133-176, 325); if it cannot (damaged, absent, over the Node limit) a confirm says so: `restoreNoUndoCopyConfirm(reason)` (:326-332).
- Partial snapshot (a damaged block): salvage + confirm listing what is left out (:297-315).
- Locks, busy guards, endings, reload: as 1.3.
- Cancel: "Cancel" in the picker; while waiting for a startup clean-up the wait has a real Cancel (:243-248); afterwards none.

### 1.5 Advanced page (ADV): 62 settings + 3 custom components
Header `advancedSettings` (EN: "Advanced Settings") and a red warning "If you don't know what the option does, don't change it!" (EN:1158). Order is a flat list; the data file has no sections.

Gates (OBSERVED): `useExperimental` shows 5 rows (`googleClaudeTokenizing`, `automaticCachePoint`, `streamingDisplayOptimizationMode`, `useExperimentalGoogleTranslator`, `claudeRetrivalCaching`); `showUnrecommended` shows 3 (`chainOfThought`, `usePlainFetch`, `showDeprecatedTriggerV1`; `useChatSticker` on Display); `dynamicAssets` shows `dynamicAssetsEditDisplay`; `localNetworkMode` shows its timeout; `promptInfoInsideChat` shows `promptTextInfoInsideChat`. `showExperimental: true` on `openAIFlexProcessing`, `claudeBatching`, `personaNote` only adds a help icon ("experimental") and does NOT gate them (SettingCheck.svelte:36).
Platform: `requestLocation` only on plain web (`!isNodeServer && !isTauri`, ADV:109); `promptInfoInsideChat` + text variant only Node/Tauri (the web profile forces it off to keep the database small, DB:713-716); `keepSessionAlive` not on Android (ADV:71); an auto-fill note on cold storage refers to this page (EN `archiveCharactersNotice`).

| Group (proposed read) | Item (EN label, ADV line) | Field | Type / default / bounds | Notes |
|---|---|---|---|---|
| Lorebook | Lorebook Search Depth (:13) | `loreBookDepth` | number, 5 (DB:91), 0-20 | |
| | Lorebook Max Tokens (:18) | `loreBookToken` | number, 800 (DB:94), 0-4096 | |
| Prompt text | Additional Prompt (:28), Description prefix (:32), Emotion prompt (:35), Preset chain (:39) | `additionalPrompt`, `descriptionPrefix`, `emotionPrompt2`, `presetChain` | text; defaults 'The assistant must act as {{char}}...' (DB:106), 'description of {{char}}: ' (DB:109), '' (DB:216), '' | emotion prompt: D5B already moved it to chatfeat. `presetChain` is a prompt pipeline, not a plain text |
| Requests | Request Retrys when Fail (:45) | `requestRetrys` | number, 2 (DB:219), 0-20 | D3 moved it to models |
| | Generation Choices (:49) | `genTime` | number, 1 (DB:454), 0-4096 | label opaque; it is "replies at once" |
| | Asset Max Difference (:53) | `assetMaxDifference` | number, 4 (DB:600), no bounds | dynamic-assets tuning |
| | Vision Quality (:58) | `gptVisionQuality` | select low/high, 'low' (DB:438) | |
| | Request Location (:108) | `requestLocation` | '' / 'eu' / 'fedramp' | plain web only |
| | Auto Continue ("Anti-Incomplete Response") (:143), Remove Incomplete Response (:144), Auto-continue min tokens (:22) | `autoContinueChat`, `removeIncompleteResponse`, `autoContinueMinTokens` | bool false (DB:490); bool; number 0 (DB:491), min 0 | help warns: do not use with languages without punctuation |
| | Anti-Server Overload (:204) | `antiServerOverloads` | bool; migrated from `antiClaudeOverload` (DB:634) | |
| | Force Proxy Format as OpenAI (:124) | `forceProxyAsOpenAI` | bool | |
| | Force plain fetch (:234) | `usePlainFetch` | bool | gated showUnrecommended |
| | Autofill Request URL (:126) | `autofillRequestUrl` | bool, true (DB:426) | |
| | New OpenAI Handling (:162) | `newOAIHandle` | bool, true (DB:429) | not experimental-gated |
| | OpenAI flex (:205), Claude 1h caching (:206), Claude batching (:207), Persona note (:208) | bools | | experimental help icon only |
| | Tokenizer caching (:212), Aux model under model settings (:213), Disable separate-parameter change on preset change (:167), Dynamic model registry (:166, default true DB:719) | bools | | |
| | Local Network Mode (Experimental) (:128) + timeout (:136) | `localNetworkMode` false (DB:430), `localNetworkTimeoutSec` 600 (DB:434) | 30-3600 | gated by the mode, not by `useExperimental` |
| | Say-nothing input (:120) | `useSayNothing` | bool, true (DB:222) | "Input 'say nothing' when no string inputed" |
| Chat loading | Chat load initial/additional pages (:98, :102) | `chatLoadInitialPages`, `chatLoadAdditionalPages` | min 1; defaults 30 / 15 (chatLoadPages.ts:1-2) | unit is pages, not messages |
| Display tuning | Height Mode (:83) | `heightMode` | normal / percent / vh / dvh / svh / lvh, 'normal' (DB:473) | a viewport-unit workaround for mobile keyboards (INFERRED) |
| | Image Compression (:122) | `imageCompression` | bool, true (DB:375) | applies when exporting a character (help EN:556) |
| | Remove punctuation (hypa) (:186), Enable scroll to active character (:188, default true DB:645) | bools | | |
| | Legacy Media Findings (:125) | `legacyMediaFindings` | bool | "old method to find media assets" |
| | Realm direct open (:202), Dynamic Assets (:201) + edit display (:227) | bools | | |
| Storage | Archive characters at startup (:168) | `archiveCharacters`, `!== false` (ON by default) | getValue/setValue custom; turning OFF clears the archive memo | stays on this page in the app; belongs with storage |
| Developer | Enable Dev Tools (:187), Plugin Develop Mode (:214), Return CSS Error (:203, default true DB:624), Bookmark (:210), Simplified tool use (:211), Remember tool usage (:209, default true DB:680), Prompt info in chat (:192) + text (:196), Show Request Logs (diagnostic button) | | | |
| Experimental | Google Cloud tokenization (:172), Auto cache point (:176), Streaming display optimisation (:145, retired DD-071), New Google Translate (:218), Claude caching retrieval (:222) | | gated by `useExperimental` | |
| Unrecommended | Chain of thoughts (:181), Force plain fetch (:234), Show deprecated trigger V1 (:238) | | gated by `showUnrecommended` | |
| Switches | Show Unrecommended Settings (:121), Enable Experimental Features (:123) | `showUnrecommended` false (DB:228), `useExperimental` | | the two gates |
| Not-in-list | Keep Session Alive (:70) | `keepSessionAlive` | off / sound, normalised (DB:724) | not Android |
| Not-in-list | Allow all in file select (:165) | `allowAllExtentionFiles` | bool | |
| Not-in-list | New image handling (beta) (:164), No wait for translate (:163) | bools | | |
| Custom | Ban Character Set (BanCharacterSetSettings.svelte) | `banCharacterset: string[]` | 18 script toggles (Latn, Hani, Arab, Deva, Cyrl, Beng, Hira, Kana, Telu, Hang, Taml, Thai, Gujr, Knda, Ethi, Khmr, Grek, Hebr), each labelled with an `Intl.DisplayNames` script name and a sample glyph run | the mockup draws a free text field for it |
| Custom | Custom Models (CustomModelsSettings.svelte) | `customModels[]` | list editor with name, flags, reorder, delete (no confirm seen in the first 60 lines I read) | models page in the mockup design |
| Custom | Diagnostics (SettingsExportButtons) | | 3 buttons: Show Request Logs (`alertMd(getRequestLog())`), Show Statistics (`DBState.db.statics` table + disclaimer "after July 2024 ... may not be accurate"), Export Settings for Bug Report | see fact 4 |

(The table groups by my proposed reading so the list is short; the app itself shows one unbroken list in the order of ADV.) Count of ADV entries: 62 setting rows (checks, numbers, selects, texts, segmented) + 3 custom components.

Dead / misleading in the app (OBSERVED unless noted):
- `streamingDisplayOptimizationMode`: retired by DD-071 (fact 7). Its migration from `largeChatPerformanceMode` is at DB:709-710.
- `showDeprecatedTriggerV1`: the label says deprecated; a legacy flag (INFERRED, effect not traced).
- `useChatSticker` (Display) and `chainOfThought`: gated behind "unrecommended" with an "unrecommended" help.
- "Generation Choices" (`genTime`) bounds 0-4096 are nonsense for a count of replies; the mockup used 1-8 (invented).
- Labels that are jargon: "Height Mode", "Asset Max Difference", "Dynamic Model Registry", "Anti-Server Overload", "Legacy Media Findings", "Preset Chain".
- `localNetworkMode` is labelled "(Experimental)" but not gated.
- `heightMode`'s `vh/dvh/svh/lvh` are CSS jargon.

### 1.6 Language page (LNG): 18 items
| Item (EN) | Field | Type / default / options | Takes effect / notes |
|---|---|---|---|
| UI Language (:30) | `language` | select: de, en, ko, cn, zh-Hant, vi, es, "[Translate in your own language]" (`translang`) | `changeLanguage` after a 10 ms sleep (:74-75); sets `langState.changed` which shows a RED notice "Close the settings to take effect" (:80-88). "translang" opens an alertSelect to download `lang.json` for translators and then resets the language to en (:48-72). |
| Translator Language (:92) | `translator` | select: '' (disabled), ko, ru, zh, zh-TW*, fa*, ja, fr, es, pt, de, id, ms, uk (* Google only) | everything below is shown only when a translator is chosen |
| Translator Type (:118) | `translatorType` | google / deepl / "Ax. Model" (llm) / deeplX / bergamot ("Firefox") | |
| DeepL web warning (:137) | | header `webdeeplwarn` | shown for DeepL when `!isTauri` |
| DeepL key + free-key checkbox (:145, :154) | `deeplOptions.key`, `.freeApi` | text; bool | the mockup puts keys on the connections page (D5B:186-189) |
| DeepL X URL + token (:163, :172) | `deeplXOptions.url`, `.token` | text | same |
| LLM presets (:181) | `translatorPresets` | custom component `TranslatorPresetSettings` | D5B has the preset manager (slice5b.js:265) |
| Source Language (:188) | `translatorInputLanguage` | auto, en, zh, ja, ko, fr, es, de, ru | Google only |
| HTML translation (:210) | `htmlTranslation` | bool | bergamot only |
| Auto translation (:220), Combine (:229), Legacy (:239) | `autoTranslate`, `combineTranslation`, `legacyTranslation` | bools | |
| Translate before HTML formatting (:249), Auto-translate cached only (:259) | | bools | llm only |
| Export / Import / Clear translation cache (:270, :296, :347) | | buttons, llm only | export: `translation_cache.json` or "empty" notice; import: validates JSON object of string->string, one confirm, then "count / failed"; clear: one confirm, irreversible. D5B models these with Undo 10 s (S-53, S-54). |

The language page has no sections. `translang` is a translator-community feature (download `lang.json`); the mockup has no counterpart.

## 2. Today in the mockup

### 2.1 데이터·백업 (page `data`): 12 rows
Base D1:326-338 (11 rows) + `data.goCharOnImport` (D5C1:228, moved in by 5c-1). No data2..data5b file touches `data.*`. Buttons have only a `confirm` string and a simulated action; there is no progress, task or result flow for any of them (OBSERVED: no handler for `data.saveFull` etc. outside the generic button).

| Row | App source? | Verdict |
|---|---|---|
| `data.saveFull` "전체 백업 저장" (D1:327) | yes | no `.bin`/`.rtb` choice, no progress, no key notice |
| `data.savePartial` "일부만 백업" (D1:328) | yes | no included/excluded list |
| `data.loadLocal` (D1:329) | yes | one confirm "계속할까요?" with no counts; the app has two |
| `data.loadInternal` (D1:330) | yes | no list of snapshots |
| `data.exportDataset` (D1:331) | yes | |
| `data.exportSettings` / `data.importSettings` (D1:332-333) | NO. The app only has a bug-report export (fact 4) and no import. | INVENTED, misleading |
| `data.cleanCold` (D1:335) | yes | label omits "assets"; confirm text has no count/size (DD-229) |
| `data.coldStart` default false (D1:336) | yes, but on 고급, default ON | wrong page and wrong default |
| `data.integrity` "저장 공간 점검" (D1:337) | yes (web/Node only) | label hides that it checks the image cache; missing the startup toggle `checkCorruption` |
| `data.persist` default true (D1:338) | NO (fact 5) | INVENTED |
| `data.goCharOnImport` (D5C1:228) | yes, `goCharacterOnImport` (Realm import only) | belongs with import, fine |

Mockup invented: 3 (`exportSettings`, `importSettings`, `persist`). Mockup missing from the app page: no row, only (a) the `.rtb` options, (b) the safety-copy/undo copy, (c) the `checkCorruption` toggle, (d) the bug-report export (which sits on adv in the app). Missing app settings: 1 (`checkCorruption`) + 0 actions (all 6 buttons exist). `.risub` is gone from `docs/design/settings`, but no row or sheet shows `.rtb` yet.

### 2.2 고급 (page `adv`): about 51 rows
Counted by reading D1:349-409, 433-434 and the 5c-1 changes (legacyGui, mobileGuiBeta, lbBulk, lbLocal removed D5C1:80; retries moved to models D3:248; `proTools` became a nav row D5C1:234; `requestInfo`, `keepAlive` added D5C1:230-231).
Sections: 요청 (adv.request), 로어북, 메뉴에 보일 기능, 실험적 기능, 개발. Mismatches, OBSERVED vs the app:
| Mockup | App | 
|---|---|
| `adv.reqLocation` default / direct / server (D1:352) | `requestLocation` is '' / eu / fedramp, web only | INVENTED options |
| `adv.plainFetch` and `adv.cot`, `adv.showDeprecatedTrigger` shown ungated except trigger (`dep`) | gated by `showUnrecommended` (all three) |
| `adv.genTimes` 1-8 (D1:351) | 0-4096 | invented bound |
| `adv.lbDepth` 5, 0-100 / `adv.lbToken` 1000, 0-20000 (D1:370-371) | 5, 0-20 / 800, 0-4096 | wrong bounds/default |
| `adv.exp.localNet` timeout 60, 1-600 (D1:389) | 600, 30-3600 | wrong |
| `adv.chatLoadInitial/More` 20/20 "채팅 수" (D1:408-409) | 30/15 pages | wrong default and unit |
| `adv.heightMode` normal/percent (D1:407) | 6 options | missing 4 |
| `adv.banChars` a text field (D1:433) | 18 script toggles | wrong control |
| `adv.cssError` false, `adv.rememberTool` false (D1:402, 405) | true, true | wrong defaults |
| experimental gate wraps `newOai`, `newImage`, `allFiles`, `dynAssetsEdit`, `localNet` (D1:388-397) | only 5 are `useExperimental`-gated (1.5); `dynAssetsEdit` is gated by `dynamicAssets`; `localNetworkTimeout` by the mode | wrong gate |
| `adv.easyPanel` nav row (D1:434), `adv.proTools` nav (D5C1:234) | no `Easy panel` data in ADV; `enableRisuaiProTools` is on 입력·접근성 | design navigation, not a setting |
| `adv.keepAlive` 5c-1 (D5C1:231), `adv.requestInfo` | `keepSessionAlive` real; app's "requestInfoInsideChat" is on the Accessibility page; `promptInfoInsideChat` is separate (adv.promptInfo) | fine, but the two "info in chat" rows are easy to confuse |
App adv items with no mockup row: `presetChain`, `useSayNothing`, `legacyMediaFindings`, `autofillRequestUrl`, `disableSeperateParameterChangeOnPresetChange`, `archiveCharacters` (as `data.coldStart`), `removePunctuationHypa`, `enableScrollToActiveChar`, `promptTextInfoInsideChat`, `personaNote`, `auxModelUnderModelSettings`, `dynamicModelRegistry`, `CustomModels` editor, Show Request Logs, Show Statistics, Export Settings for Bug Report = 16 (plus `streamingDisplayOptimizationMode`, retired). Invented-or-mismatched rows: 11 (counting the table above minus the nav rows).

### 2.3 언어 (page `lang`): 12 rows + the 5b preset/cache panels
`lang.ui` (D1:302), then D5B:152-170: translator, type, source language, prompt (per LLM preset), max response, auto, combine, legacy, HTML, before-HTML, cached-only. Preset manager and cache export/import/clear are drawn by slice5b.js (:265, :605-617). D5B removed `lang.restartNote` (D5B:23).
- `lang.ui` is a select with 7 languages (D1:302) without `translang` and "only ko/en switch in this demo". The app also shows a red "Close the settings to take effect"; the demo re-renders instantly (slice1.js:772).
- Translator language list has 13 + off (D5B:153) vs the app's list; `zh-TW`, `fa` marked Google-only (matches).
- Missing/moved: DeepL key/free/URL/token (on the connections page; D5B:186-189), `translang`, the DeepL web warning (`webdeeplwarn`), the LLM `max response` is sourced (preset field) but the app's preset component was not read (see section 10).
- Invented: none found on the lang page. Missing app items: 2 (`translang`, deeplWebWarn).

## 3. The shared pattern and how Settings adopts it

### 3.1 What the pattern owns and the adopter owns
OBSERVED (`PAT/README.md:22-59`, `pattern.js:854-859`):
- Load order: `theme/nexus-tokens.css`, `theme/pattern-tokens.css`, `brand/nexus-mark.css`, `patterns/pattern.css`, `patterns/motion.css`, then the lane CSS; scripts `mockups/nexusMark.iife.js`, `patterns/pattern.js` (global `window.RisuPattern`). Settings loads its own CSS after.
- API: `createTask({kind, name, subtitle, background, steps:[{id,label,mark,counted,noun,cancel,write}]})`, `openTaskFlow(task, {warning, trigger, container, background:[appRoot]})`, task methods `start`, `progress(done,total)`, `step(id)`, `block('offline'|'other-tab'|'background')`, `unblock()`, `finish({counts,size,skipped:[{name,reason,detail}],leftOut:[{text}]})`, `fail({dataState:'same'|'unknown'|'partial', code})`, `requestCancel`, `settleCancel`, `retry`, `markWritten(n)`, `undoImport()`; `openWarning(def,{trigger,container,background})` (promise: 'confirm'|'secondary'|'cancel'), `banner(def, host)`, `showUndo({label,onUndo,untilText})` + `handle.end(text)`, `toasts.addTask(task,{reopen})`, `t`, `addStrings({ko,en})`, `setLang`.
- Warning definition: `{severity: notice|caution|confirm|danger|blocked, headline (36 KO / 60 EN, two lines allowed), consequences[] (3 shown, rest behind "그 밖에 N개 보기"), detail[], leftOut[], mock, ack, undoLine, actions:{cancel,secondary,primary}}`. A sheet without the actions it needs throws. Cancel takes first focus (DD-245).
- Tokens: `--pattern-*`, `--task-*`, `--warning-*` in `theme/pattern-tokens.css`; a lane aliases (`--settings-x: var(--pattern-x)`), never copies. Style by `data-pattern-severity`, `data-task-kind`, `data-task-state`, `data-step-state`, `data-has-skips`, `data-has-leftout`.
- Parts: critical (a pack can only set tokens): dialog shell, warning headline/consequences/actions/Cancel/primary/secondary/ack/undo line, task status/Cancel/bar/count/result/skipped list/left-out list/Retry/Close/Undo import. Reach tier: mark, title, steps, toast.
- The pattern owns: sheet and progress card, state machine, focus trap and return, `inert` of the page behind, Cancel-hide with reason line, toast hiding under a sheet (DD-244), the 250 ms arm guard, the 10 s undo line, reduced-motion/low-power. The adopter (Settings) owns: the trigger buttons, the copy per operation and its counts, the engine-or-mock that calls `task.*`, page state after the result (list refresh), the registry merge (`mergeRegistry` + `lintPattern`, with `--nexus-warning-rgb` stated in each theme pack), and the leave-out list (synthetic, marked `mock`, DD-227).
- Demo: `patterns/demo.html`, `demo.js` (scenarios: clean run, with skips, fails data unchanged, fails state unknown, pauses then continues, try Cancel).
- Checks recorded in README: 474/474 on the pattern suite (observed claim of the README, not rerun here). Not verified on a device.

### 3.2 Adoption steps for a Settings page (proposal, section 8 expands)
1. Add the five CSS files and two scripts to `settings/index.html`; alias in the Settings theme-tokens file.
2. Merge the registry fragment into the Settings registry (`mergeRegistry`) and re-run the Settings pack lint and contrast suites; add `--nexus-warning-rgb` to any pack that sets `--color-warning` directly.
3. Write one `openTaskFlow` call per data operation; the page keeps a `busy` flag so a second operation is refused (matches the app's `refuseBackupLoadWhileBusy`).
4. Move the Settings-only confirm copy into `RisuPattern.addStrings`.

### 3.3 Operation by operation
| Operation | Pattern call | Warning severity and content | Steps (pattern `steps`) | Cancel | Result / undo |
|---|---|---|---|---|---|
| Save a full backup | `openTaskFlow(kind:'backup')` | `caution` banner only when the profile has keys and fork-only data; otherwise straight to run. Consequence: "연결 키가 파일에 들어가요. 다른 사람에게 보내지 마세요" (WP:351). | 파일 준비, 이미지·에셋 담기 {n}/{m}, 인레이 {n}/{m} (app has this count), 보관 데이터 {n}/{m}, 데이터베이스 저장, 파일 확인 | before the save dialog returns / before the first entry (`write:true` on the first entry), hidden after with the reason line | `finish({counts,size,skipped,leftOut})`; no undo (it only creates a file) |
| Save a partial backup | same, `partial` | `confirm`: replaces the three chained confirms; consequences: what is included, "감정 이미지·추가 에셋·VITS·인레이 {n}개({size})는 빠져요" (WP:352-354) | 담을 항목 확인, 프로필 이미지 {n}/{m}, 보관 데이터, 데이터베이스 | same | result lists missing profile images |
| Export `.bin` | `warning` then task | `caution` sheet with `leftOut` (DD-251): headline ".bin에는 이 앱에서만 쓰는 데이터가 담기지 않아요", actions cancel / secondary "전체 보관용 .rtb로 내보내기" / primary "그래도 .bin으로 내보내기" (WP:204-212) | as full backup | as full | result repeats "이 파일에 담기지 않은 것" (mock list) |
| Export `.rtb` | task | none unless keys (backup keeps keys, DS-069); optional password is MC-698 (DECISIONS-settings.md:491), unresolved here | same steps; `.rtb` is a different engine path (not in `src`) | same | file name `.rtb` |
| Load backup from a file | `openTaskFlow(kind:'restore')` with `warning` | `danger`, Cancel focused, 250 ms guard, ack checkbox when there is no safety copy. Consequences: "캐릭터 {n}개, 채팅 {m}개가 파일의 내용으로 바뀌어요 (현재 {n'} / {m'})", "파일에 없는 이미지는 지금 것을 그대로 둬요", safety-copy line | 파일 확인 (walk), 다른 탭 확인, 이미지·에셋 담기 {n}/{m} (counted, `write` starts here, see question 1), 데이터 교체하기 (`cancel:false`, `write:true`), 저장 확인 | only in the first two steps; then hidden with "이 단계는 중간에 멈출 수 없어요"; restore stays in view (DD-252: no background) | `finish` with skipped list (invalidName, tooLarge, inlay reasons map to `invalid`/`large`/`notstored`), then the page reloads; `fail({dataState})` maps the app's endings (1.3). No Undo: only the app's own numbered snapshot is a way back. |
| Load an internal snapshot | same | same, plus the snapshot's date, character count; the safety copy line is real here (`keepCurrentState`, IB:146) | 스냅샷 확인, 다른 탭 확인, 안전 복사본 만들기, 데이터 교체하기, 저장 확인 | before 데이터 교체하기 | the safety copy appears in the list, so the card can say "방금 상태가 목록에 저장됐어요" |
| Dataset export | `openTaskFlow(kind:'export')` | none (additive file) | 보관소에서 읽기 {n}/{m}, 파일 만들기 | between characters (read-only; INFERRED safe) | result names unreadable archived characters (existing `coldStorageDatasetExportSkipped`) |
| Clean unused archived data and assets | `openWarning` then task | `danger`: "{n}개 파일, {size}를 지워요. 되돌릴 수 없어요" (DD-229); the engine's inventory gives counts (`leftover.length`), size not verified | 확인, 지우기 {n}/{m} | before the first delete only (WP:247) | no Undo ("되돌릴 수 없어요" copy is correct here: nothing is recoverable) |
| Verify asset cache | `openTaskFlow(kind:'scan')` | none | 읽기 {n}/{m}, 확인 | between batches | table of mismatches, then the existing evict confirm (`confirm`) |
| Export settings for bug report | direct download + clipboard | `notice` toast | none | n/a | says which key families were removed |
| Translation cache import / clear (lang) | already built in 5b (S-53, S-54) | | | | align to 10 s undo and say when undo ends (DD-223) |
| Undo import | `task.undoImport()` | | | | DD-225: for import kinds (character/preset/module import, not on this page except Realm go-to-character); feasibility in the app not verified. |

Pattern fit problems found while mapping (OBSERVED unless noted):
- Restore "first write" is the asset pass, not the database replace (fact 2). The demo steps put `write:true` on `replace` only (README:38-40), so Cancel would remain visible during the asset pass, where the app has already begun overwriting same-named assets. Copy would then say "Cancel" while data changes.
- The restore ends in a reload (fact 3).
- Web `.bin` backup streams through a helper page and can fall back to an in-memory build; the person is told only in an `alertNormalWait` (exportWriters.ts:252, :265), so the pattern needs a `notice` for it.
- The pattern's inventory item "slot take should be critical (S-25, DS-072)" and "되돌릴 수 없어요 stale copy (S-6, S-7)" are Models/Persona page issues; for this slice the equivalent is the cache clear copy (already fixed in 5b: "10초 안에는 되돌릴 수 있어요") and `data.cleanCold` (copy "되돌릴 수 없어요" is correct there; add counts and size). S-38 (5a purge lacks a confirm) is DD-229 work outside 5c-2.

## 4. 고급 page: classification (for the regroup)
OBSERVED sources are in 1.5. Proposed reading, not a decision:
- Developer/diagnostic (hidden unless developer mode or useExperimental): Dev Tools, Plugin Develop Mode, Return CSS Error, Show Request Logs, Show Statistics, Export Settings for Bug Report, prompt info in chat, request info in chat (moved here by 5c-1), Simplified tool use, Remember tool usage.
- Experimental (gate `useExperimental`, 5 rows): Google Cloud tokenization, Auto cache point, New Google Translate, Claude caching retrieval, plus `streamingDisplayOptimizationMode` which DD-071 retires.
- Unrecommended (gate `showUnrecommended`, 3 rows): Chain of thoughts, Force plain fetch, Show deprecated trigger V1.
- Dead or retired: streaming optimisation (retired); `moveInsteadOfCopyOnCMPConvert` was 5c-1's; no other fully dead ADV row found (effects of `showDeprecatedTriggerV1`, `disableSeperateParameterChangeOnPresetChange`, `legacyMediaFindings` not traced).
- Platform-only: `requestLocation` (plain web), `promptInfoInsideChat` and text (Node/Tauri), `keepSessionAlive` (not Android).
- Misplaced by function: request tuning (retries done), lorebook limits, chat load pages, image compression, height mode, cold storage -> storage, custom models, ban character set, Preset Chain, emotion prompt (moved), Additional Prompt/Description prefix (these are prompt text that live in presets in the new design: `additionalPrompt` is mocked with `scope:'preset'`, D1:358).
- Gate behaviour today: the two switches `showUnrecommended` and `useExperimental` are on this very page, so a person must find them to reveal the rest; the mockup keeps them in "메뉴에 보일 기능" (D1:381-382) and has an `exp` flag and a `dep` per row.

## 5. Device floor notes
- OBSERVED: a web backup is a stream through a service-worker helper (`/streamsaver/mitm.html`); on a plain-HTTP origin or when the helper does not answer in 10 s it is built in memory (exportWriters.ts:221-266). On a Note 9 (Android 10 WebView) the app is the Tauri build (INFERRED), which writes through the save dialog and Rust commands (`TauriWriter`, `readRangedPieces`, batched asset reads; BL:13, 414). Memory pressure is therefore highest on web/PWA exports and restores with large inlays/databases (databases and cold units are decoded whole, BL:1095-1134).
- Restore on web reads each entry with `file.slice(...).arrayBuffer()` (BL:1097), so peak memory is one entry (an asset can be hundreds of MB); streaming to the store in slices exists only when `streamLargeAssets` (desktop transport, BL:985). On a Raspberry Pi 3 (1 GB RAM, INFERRED browser) a large single asset in a restore is the likely failure; the app has no size preflight except the Node 413 limit (BL:892-919).
- Storage permission and pickers on Android: not traced. The save/open dialogs go through the Tauri dialog plugin; behaviour of scoped storage on Android 10 is UNKNOWN to me.
- Cross-tab lock: web only (Tauri is single-instance); `locksSupported === false` produces a confirm (BL:930). A Pi using Chromium has Web Locks.
- Low power: a 10+ minute backup keeps the page busy; the pattern's low-power mode (status mark kept, ring off) applies; do not add motion. Checks of the pattern report nothing measured on a device (README:125).
- The backup page has no size or free-space display. `warnIfStorageIsLow` exists for the snapshot writer (globalApi.svelte.ts:1833, quota via `navigator.storage.estimate`, :1790-1794), not for the local backup.

## 6. Plain-label problems (the "misleading" list)
Backup & Files (page title) -> 데이터·백업; "Load Backup Locally"/"Load Internal Backup" (restore replaces everything; "internal" is jargon for the app's own automatic snapshots); "Save Partial Backup Locally (Excluding Character Assets)" (includes profile images but excludes emotion/extra images, VITS and inlays); "Clean Unused Archived Data and Assets" (irreversible deletion of images/audio); "Export Save as Dataset" (chats only, per chat, not a save); "Asset Cache Integrity"/"Verify Asset Cache Now"; "Generation Choices", "Height Mode", "Asset Max Difference", "Anti-Server Overload", "Legacy Media Findings", "Dynamic Model Registry", "Preset Chain", "Ax. Model" (translation by an auxiliary model), "Firefox" (the on-device Bergamot engine), "Request Location".

## 7. Mockup-vs-app summary
| | App items | Mockup rows | Invented / mismatched | Missing |
|---|---|---|---|---|
| 데이터·백업 | 8 (6 actions, 1 toggle, 1 scan) | 12 | 3 invented (`exportSettings`, `importSettings`, `persist`); 3 mismatched (`coldStart` page/default, `integrity` label, `cleanCold` label/copy) | 1 setting (`checkCorruption`); `.rtb` flow and progress have no UI at all |
| 고급 | 62 settings + 3 custom components (65) | about 51 | 11 mismatched (bounds, defaults, options, gates; table 2.2); 1 invented option set (`reqLocation`); 2 design nav rows | 16 (list in 2.2) + 1 retired |
| 언어 | 18 | 12 + preset/cache panels | 0 | 2 (`translang`, DeepL web warning); 4 DeepL fields live on the connections page |

## 8. Design proposals (not decisions)
1. 데이터·백업 regroup: "백업 저장" (full `.bin`, partial, `.rtb`), "백업 불러오기" (from file, from app snapshot), "내보내기" (dataset, bug-report file moved from adv), "저장 공간" (clean, verify, startup check, cold storage toggle), and a "가져온 뒤" row (`goCharacterOnImport`). Remove `exportSettings`/`importSettings`/`persist`, or relabel the two as the bug-report export.
2. A single "backup file" control: choose format (`.rtb` full keep-everything recommended, `.bin` for other apps), then the pattern flow; the `.bin` caution sheet (DD-251) opens only when the mock leave-out list is non-empty.
3. Restore flows: one `danger` sheet each (replaces two confirms), counts and sizes of file vs current, safety-copy line truthful per source, then the pattern restore task with a wide-area "stay in view" and reload copy ("완료되면 앱이 다시 시작돼요").
4. Per-operation Cancel rules from section 3.3 table: ask the engine team (question 1) which step is the first write.
5. Delete confirms with count and size for 정리 (DD-229); same confirm shape for translation cache clear (done in 5b).
6. 고급 regroup: 요청 (retries moved), 채팅 불러오기, 로어북, 저장 공간, 개발자(including diagnostics and info-in-chat), 실험(5 gated), 권장하지 않음(3 gated). Two gate switches at the top of the page so the gated sections are discoverable. Remove the streaming row. Ban character set as 18 toggles in an accordion; Custom Models stays on the models page.
7. Real bounds and defaults from section 1.5; drop invented options; keep platform notes ("Android에서는 나오지 않아요").
8. 언어: UI language select incl. a "내 언어로 번역하기" row with the `lang.json` download (or drop it), the language-change notice as an inline line not a red box ("설정을 닫으면 바뀌어요"), and unchanged 5b translate rows.

## 9. Open product questions (recommendation first)
1. **Where does Cancel end for restore?** The app writes assets/cold units/inlays from the start of the pass (fact 2). Options: (a) Cancel only during the file check and tab check, hidden once the pass starts (honest to the engine; recommended); (b) engine change: stage assets into a temp area and only publish them with the database (large engine work); (c) keep the pattern's model (Cancel until `데이터 교체하기`), which would let a person cancel after assets were overwritten. Needs Lane A.
2. **`.rtb` and what it contains.** Nothing in this clone implements it. Options: (a) show one backup action with a format choice, `.rtb` default and keys included, optional password later (recommended); (b) two separate buttons; (c) hide `.rtb` until the engine exists. Also: does `.rtb` restore share the same task steps (assumed yes)?
3. **The leave-out list (DD-227).** Synthetic and marked mock until Lane A returns the present kinds. Confirm design keeps the mock label visible in the shipped mockup and that an empty list shows no sheet.
4. **Settings file export/import.** The app has only the bug-report export. Options: drop both rows and move the bug-report export to 고급 > 개발자 (recommended); keep a settings-only file as a new feature; relabel only.
5. **Persist storage.** No setting exists (fact 5). Options: remove the row (recommended); show a read-only status line "저장 공간 유지: 설정됨/안 됨" (new, needs engine read).
6. **Cold-storage switch page.** App: 고급. Options: move it to 데이터·백업 > 저장 공간 with default ON (recommended); keep on 고급.
7. **Where do the numbered snapshots show?** They are automatic. Options: a list with date, size, character count on the restore sheet (recommended; needs engine to return size/count); date only as today; hide them.
8. **Safety copy for the file restore.** The file path has none (only the snapshot path does). Options: ask the engine to write a snapshot first (like `keepCurrentState`; recommended); keep none and show the pattern's "no safety copy" acknowledgment (ack checkbox); drop the copy line.
9. **Realm "go to character after import".** Keep on 데이터·백업 under imports, or move to the library import settings. Recommend keep with its Realm-only description.
10. **Retired and dead rows on 고급.** Streaming optimisation: confirm removal (DD-071). Options for other legacy rows (`showDeprecatedTriggerV1`, `legacyMediaFindings`): keep under "권장하지 않음"; hide; ask the main session whether they are dead.
11. **Experimental gate.** Keep `useExperimental` and `showUnrecommended` as two hidden-section switches (recommended), merge into one "개발자 모드", or show all rows always with a tag.
12. **Diagnostics.** Show Request Logs, Statistics, bug-report export: one "문제 해결" group under 개발자 (recommended) or on 데이터·백업 > 내보내기.
13. **Language page.** Keep `translang` (community translation download) as a row, or drop it from the design (recommended: keep, rename "번역 파일 받기").
14. **Language-change notice.** The app needs a close-and-reopen to apply; the mockup applies instantly. Options: keep the app behaviour with a calm inline line (recommended, true to the app); re-render at once (needs engine change).
15. **Result after a restore.** The app reloads. Options: show the result card briefly then reload on "다시 시작" (recommended); reload automatically after the notices.

## 10. Not verified
Nothing was run; no mockup was opened; no rendered view. Not read: the `translator` presets component (`TranslatorPresetSettings.svelte`), the top of `CustomModelsSettings.svelte` beyond 60 lines (delete confirm), `storageTabLocks.ts` (the second `rtb` grep hit), `platform.ts` (whether Android reports `isTauri`), snapshot pruning in `getDbBackups`, `manualCleanup.ts` as a whole (the confirm list and whether the engine can state a total size), `coldstorage.svelte.ts` for what `confirmIncompleteColdStorageOperation` says, effects of several ADV flags (`showDeprecatedTriggerV1`, `legacyMediaFindings`, `disableSeperateParameterChangeOnPresetChange`), Tauri Android file picker behaviour and storage permission, the actual backup/restore sizes and peak memory on a Note 9 or Pi 3, and `MOTION_CONTRACT.md`, `pattern.css`, `demo.html` (I took their API and adoption from `patterns/README.md`, `pattern.js:854-859` and `demo.js`). The README's 474/474 pattern check count is its own claim.
