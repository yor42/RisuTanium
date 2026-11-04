# MVP refresh record: main f12ea30f9 (inferred) on the maintainer's phone (2026-11-03)

Status: RECORDED. Written by lane A in records batch 44 from the maintainer's statements (`MC-1063`) and the campaign records; the commit is INFERRED; nothing here was tested on this exact APK by lane A.

## The current MVP

- **Date:** 2026-11-03. The maintainer's times: built 11:01 PM KST, installed 11:04 PM KST.
- **Commit:** main `f12ea30f9` (INFERRED from the maintainer's words "current main"; main was `f12ea30f9`, committed 2026-11-03 22:56:19 KST, at the build time; no later commit existed).
- **APK sha256 (as typed by the maintainer, not recomputed):** `024c1ece0b3300dcc1e97183da27eaa6560e325bcb754aa5b2e812414cbd247c`
- **Install:** on the maintainer's phone (release-signed APK).
- **Not stated:** whether the pre-update `.bin` was exported first; whether counts matched after a relaunch (`MC-922` recorded both for the previous version).
- **Earlier baselines:** `MC-475` is the first baseline, main `f0e397aae`. `MC-922` is the previous MVP version, main `7928b5bb1`, installed 2026-10-31 7:50 PM KST.
- Decision: [MC-1063](Maintainer-Context.md#mc-1063--lane-a-2026-11-03-the-mvp-version-is-now-main-f12ea30f9-inferred-supersedes-mc-922-as-the-current-mvp-version-mc-475-stays-the-first-baseline) (MC-1063).

## What the refresh carries (the gates of `MC-979`, `MC-1039` and `MC-1051`)

| Gate | Status in this build | Commits | Evidence |
|---|---|---|---|
| CHORE-17 S0 to S2 | included | `515025346` | Roadmap CHORE-17 row. |
| Settings-return fix | stage 1 and stage 2 included; required by `MC-1039` | stage 1 `2eed2f84d`, stage 2 `1cdfb1a5b`, the rebuild-return scroll fix `bc383c59f` | Note 9 device checks: S4 (ledger rows 4875, 4881 to 4886) and the second part (rows 4891, 4893); accepted limitations L1 to L4 (`MC-1056`, `MC-1057`). |
| CHORE-396 | accepted and documented, not fixed (`MC-1023`) | none | the note in section "Known limit carried by this refresh" below (approved, `MC-1037`). |
| CHORE-624 net | included; gate met (`MC-1038`) | `031bfddf1`, `0af68d6e7` | Roadmap CHORE-624 row (device batch 39 cells A to D). |
| CHORE-623 rename | included (rode along, `MC-979`) | `621c220d2` | Roadmap CHORE-623 row. |
| CHORE-630 Svelte 5.57.3 | included; gate (`MC-1051`); COMPLETE | `461ac3e16` | the APK R device run counts (`MC-1059`); Roadmap CHORE-630 row. |
| Also in this build, not gates: CHORE-629 tool-round cap `2b4d242c9`; the German tool-loop wording `d10afabec`. | | | |

CHORE-205 is not a gate (`MC-1022`). The app code of this build differs from `bc383c59f` by one line (`src/lang/de.ts`); against the previous MVP `7928b5bb1` the app, package and Tauri files differ in 313 files (`git diff --stat`).

## Known limit carried by this refresh: CHORE-396 (`MC-1023`)

On Android, importing a large character card briefly uses more memory than the older build A1 did. On a Note 9, with one 41.9 MB card, n=3 per arm, the WebView backing store peaked at a median of 126.8 MiB, against 76.4 MiB on A1.

On this evidence the extra memory is garbage the browser can collect, not a leak. A forced garbage collection 6 s into the import dropped the backing store to about 42 MiB in 3 of 3 runs. It grew again afterwards, to 79.8-109.2 MiB, and it is gone about 30 s after the import.

What is not shown:
- **Peak memory:** whether peak process memory (PSS) returns to A1's level is INCONCLUSIVE.
- **No GC control on A1:** A1 was never measured with a forced collection, so this does not show that the gap between the builds alone is collectible.
- **Build mismatch:** the newer build was a measurement build, compared against a plain A1.
- **Unexplained early buffer:** why an extra file-sized buffer appears early in the import is INFERRED, not traced in source.
- **Other import paths:** only the Android character-picker route, with one .charx file, was measured. Other routes and file types were not.

No fix is planned. If imports on a low-memory phone start failing, reopen CHORE-396 with this evidence: b38\db38-t1v.

## Other limits and watch items

- **Scroll fix accepted limits (`MC-1056`, `MC-1057`):** L1 shorter content lands at the browser clamp and may load one more page; L2 a fully loaded chat scrolled within the first message's height of the very top lands lower; L3 rows with images that size after the text land lower near the top; L4 a message whose shown text changed during the visit can land the list lower near the top.
- **Idle-return drift watch item (`MC-1061`):** seen once, -3000 to -8943 on two idle returns in a long Note 9 session, not reproduced after a cold start. No work until it returns.

## Carry-forward and what was not checked

- `MC-350` applies: a storage-format change ships an automatic forward migration; data a build cannot read is kept, never overwritten.
- No device update-safety check was run for this refresh. A partial read-only source review ran on 2026-11-04 (batch 48, `MC-1067`); see section 'Update-safety review (2026-11-04)' below. `MC-922`'s check was source reading plus tests.
- The maintainer has not said whether he exported the pre-update `.bin`.
- Many storage-touching commits are in the range (for example CHORE-117 stage 2, CHORE-622, CHORE-616 S2).
- The device check the review lists was run in part (see 'Device check (2026-11-04, batch 50)' below); the not-covered list there applies.

## Update-safety review (2026-11-04)

Status: PARTIAL; overall UNKNOWN; unverified by a second reader. Source: `b40\updsafe\result.md` (`updsafe-rev2`, Codex gpt-6-sol medium, read-only; `updsafe-rev1` failed on directory readScope). Range `7928b5bb1` to `f12ea30f9`. Recorded in the ledger as row 4901 (`MC-1067`).

| Commit | Verdict (as reported) | Note |
|---|---|---|
| `1cdfb1a5b` | SAFE or SAFE WITH NOTE | no persisted format change in the storage diff |
| `0af68d6e7` | SAFE or SAFE WITH NOTE | hidden-page save ticks cut before commit and retried; commit still follows planning |
| `3606f8dab` | SAFE or SAFE WITH NOTE | in-memory timing probe |
| `6bff60aad` | SAFE or SAFE WITH NOTE | optional `fullWordAsciiBoundary` defaults off |
| `031bfddf1` | SAFE or SAFE WITH NOTE | yield and timing only |
| `621c220d2` | SAFE or SAFE WITH NOTE | no persisted brand key |
| `905719247` | SAFE or SAFE WITH NOTE | persona repair normalizes the selection and adds a default or buffer-derived persona; rewrites the saved list on a later save; usable entries kept, invalid entries dropped |
| `6f514e48e`, `4f986561d`, `f75d5e0c6` | SAFE or SAFE WITH NOTE (test-only) | test-only |
| `8c8211de2` | SAFE WITH NOTE, one-way change | Utility-mode presets use type-26 units and a task-presets requirement token; an older build rejects the unknown requirement as too new and boot enters read-only mode; a deliberate one-way store2 change; no evidence of an older-build overwrite on that path; `.bin` export omits Utility presets after confirmation |
| `444894bd8` | SAFE WITH NOTE, intentional saved-data deletion | CHORE-117 stage 2: folder references to absent characters and empty folders are pruned on save; deserves an on-device check for this profile |
| `5e574e1dc` | UNKNOWN | preset, lorebook and other harvest behavior cannot be fully reviewed from the permitted files; the supplied diff shows no persisted-format change |
| `515025346` | UNKNOWN | the plugin read implementation is outside the read scope; preservation of fields through plugin writes is not established |
| `5ac387c37`, `bebbe2e0d` | UNKNOWN | restore and file-handler lifecycle outside the read scope |
| `db8782d89` | UNKNOWN | merge, no separate hunk |

Not read: the Rust-backed storage, the actual APKs, the phone's data, and several import and UI callers. Device check listed by the review (not done): keep an independent copy of the phone's data (pre-update `.bin`); update the `7928b5bb1` profile in place; verify characters, chats, persona selection, folder order, presets, plugins and assets before and after a save and restart; exercise a restore/import collision; if Utility presets are created, verify the older APK opens that copy read-only without writing. Whether the pre-update `.bin` was exported is not stated (`MC-1063`).

### Device check (2026-11-04, batch 50)

Part of the device check listed above was run on phone 1 (Note 9, synthetic fixtures, throwaway keys): update in place from the OLD build (`7928b5bb1` profile; APK sha256 `E08266F32A9BFCEDD2D4ECCD0116DF878728D2234DF798684F3A4712810D40F4`, built with two generated glue files from the newer toolchain) to the NEW build (main `bc383c59f`, APK R sha256 `67F55B19AED14FFA503D7BC6C0334BF2C52D891732AFF682BC1DB398EA89284C`). Fixtures: `us-A.bin` sha256 `e6e13c33590da325721b68c7ff0ee135a271ddad0277584e1b5f1f06f318a4ec`; `us-B.bin` sha256 `49fe468b417669fdf5290b5873c78473896a72e42a1c4cdd0b580155b768688a`. Report: `%TEMP%\risu-b715\b40\updsafe-dev\run\result.md` (ledger row 4906). Status: VERIFIED in that run (the device report's own evidence; unverified by a second reader): in-place OLD to NEW lost no character, chat, asset, plugin, module or persona in either profile; the F2 persona repair (profile B, `selectedPersona` 7) errors on opening a chat in OLD, and NEW appends a persona, sets the selection to 2 and stays at 3 after a restart and a save; F1 folder pruning was NOT differentiated (OLD had already dropped the injected ghost id and the empty folder at import and boot; pruned members stayed pruned in NEW); after a NEW save `useStreaming` appears (undefined to false). The census is an in-app `.bin` export decoded on the PC.

Not covered: presets; the Utility one-way note (no older-build check of the read-only path); a restore collision; large data; the maintainer's pre-update `.bin` (still not stated, `MC-1063`). The partial source review above stays overall UNKNOWN. The check does not change the MVP status; the maintainer builds the APK.

## What this record does not claim

- Lane A did not recompute the APK hash.
- Lane A did not see the build log.
- Lane A did not run this APK on a device.
- The commit is inferred.
- The maintainer's checkout held uncommitted manifest and Cargo.toml edits at that time.
