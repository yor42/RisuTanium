# Note 9 run 2026-11-28e: D-LOCK, #909 and #710 b/c/d phone rows observed

Date 2026-11-28. Observations only; acceptance is for the owning sessions and lane A. Refs #149, #909, #710. Records: MC-4960 to MC-4964 in `Agents/mc/note9-run-e.md`. This note closes nothing.

## Setup

- Phone 1 (`29f3cde9193f7ece`), the only device session. Leases: `note9e-build` (android-build, released) and `note9e-phone` (note9, ports 6270-6309). The phone lease was released, but `workflow-device-reset.mjs end` stopped with exit 3, "no start baseline for this request and phone in the run folder": the start baseline sits in `%TEMP%\risu-note9-run-e\reset` and the end helper looked in `%TEMP%\risu-reset-note9e-phone`. The lease now reads `needsReset true, released-unchecked`; I did not copy or edit baselines by hand. The census still needs a check by lane A or the next device session.
- Source: current origin/main at build time, built with the run-d recipe in a scratch worktree (`node_modules` junction, only gitignored generated Android files copied in); install verdict pass, `debuggable=False`. The docs worktree base is origin/main `5fd4c130257b25b1c0359e27eeb7cf1490acddfc`; the exact build SHA is in `%TEMP%\risu-note9-run-e\build-out.txt` (not in the repository).
- Library: regenerated and pushed as `rd-rune.bin`, restored through Welcome > Restore a backup; the first launch showed leftover run-d data, so one `pm clear` ran before the restore. Character `LockHost`; presets A to F (E has a deliberately long name) with synthetic values.
- Preview switches: "Studio (preview)" ON and left ON. WebView DPR 2.625, viewport 411x773, touch. CDP via `adbg` forward to `webview_devtools_remote_<pid>` (local port 6270); taps by `input tap`.
- Radios: `net-status` is not allowed on the Note 9 profile, so Wi-Fi and mobile data were read with `settings get global wifi_on` and `mobile_data`: both 0 at the start and at the end. `reverse --list` empty at the start and the end; the forward was removed.
- Pushed or app-written files `rd-rune.bin` and `RisuTanium_presets.risup` were removed by exact name; the earlier `.bin` export (`local-20261128.bin`) was no longer present when I removed it. Raw outputs and screenshots: `%TEMP%\risu-note9-run-e\` (not in the repository).

## Rows

| Row | Result | Observation |
|---|---|---|
| D-LOCK-1, fallback lock then aux lock | OBSERVED | With the lock on, switching with Use in chats (A to B and back, several A/B cycles) kept the live fallback or aux models and the toast read "Kept the current: <names>"; the active preset's Advanced form shows the live value, not its slot's own, so fixture fallbacks were not visible on the active preset (explained by the lock note). Values were changed on the phone by the form, never by editing state. |
| D-LOCK-2, two store2 pages | NOT RUN | Needs two store2 pages, PC-first; not attempted from the phone. |
| D-LOCK-3, `.bin` export leave-out | OBSERVED, differs from the brief | The export showed a confirm dialog naming "(sampling, reasoning)" only, not a sheet listing "Preset field locks" with group names. The written `.bin` held no `presetFieldLocks`, while the aux and fallback flags travelled (decoded with `decodeDatabase`). The file was removed afterwards. |
| D-LOCK-4, Sampling and Reasoning locks | OBSERVED | With those locks on, a switch kept the live sampling and reasoning values and posted "Kept the current: ..." (screenshots). |
| D-LOCK-5, locks panel and Studio lock row | OBSERVED | Locks panel and the Studio lock row readable in screenshots; switch hit areas measured by CDP rects at least 44 px (exact rects in the raw outputs). |
| #909, preset sheet layout | OBSERVED | Manage presets sheet laid out as in the screenshots: New preset and Import, Select presets to export and New folder, folder section, "No folder" section, six rows with slot chip and "In chats" chip, long name truncated with an ellipsis, classic-editor note and button below. |
| #710 b, folder header | OBSERVED | Folder header (name, member count, menu) readable; the folder was named `째가` because the Korean IME turned typed `Work` into that text (see deviations). |
| #710 b, Move to folder list | OBSERVED | Row menu Move to folder list showed the folder and the no-folder choice; moving Preset C into the folder moved its row under the header. |
| #710 c, swap confirm | OBSERVED | Hotkey slot grid (1 to 9 and None); choosing slot 1 for D while A held it opened an inline confirm in the sheet: "Already used by “Preset A”", "Swapping gives “Preset A”: Preset slot 4", Swap and Cancel. Swap gave A slot 4 and D slot 1, and the toast "Preset slot changed" with Undo appeared over the sheet's bottom (hint text and the top of "Open in the classic editor"). |
| #710 c, Undo toast stacking and Undo | OBSERVED | The "Preset moved" and "Preset slot changed" toasts sit over the bottom of the sheet; an Undo tap made quickly gave "Change undone". One Undo tap made after the toast had expired hit "Open in the classic editor" underneath and opened the classic settings, which I closed. |
| #710 d, select mode | OBSERVED | Select presets to export showed All, Export 0 (disabled), Cancel and a checkbox per row. By CDP rects the visible checkbox is 16x16 css px inside a 44x44 hit wrapper. Ticking B and D gave "Export 2". |
| #710 d, export file save | OBSERVED | Export 2 opened the system save picker with `RisuTanium_presets.risup`; Save gave "Successfully exported and saved to the location you chose. API keys and endpoint URLs were left out." The file was 5828 bytes. Removed by name. |
| #710 d, import picker | OBSERVED | Import opened the system chooser; Back cancelled, the sheet stayed with six presets and nothing was added. |

## Not run

- D-LOCK-2 (two store2 pages).
- #710 d: row-menu Export of a single preset, Select all and an Import that completes; drag reorder needs a fine pointer and was skipped.
- Extras #883, #886, #822 gaps: not started.
- Later groups (Home group, packs and apply cost, #816, #885, #303) belong to their own sessions.

## Deviations and incidents

- `pm clear` once after the first launch showed leftover data.
- The reset end helper stopped for a missing start baseline in its run folder (see Setup); the lease is released with `needsReset true`.
- Korean IME turned `input text Work` into `째가`; the folder kept that name.
- `net-status` is not allowed on the profile; radios were read with `settings get global`.
- A stray tap once opened the classic Preset A "Toggle definitions" page, and a late Undo tap opened the classic settings; both were closed without changes. A system picker listed other files in Downloads; none were read or touched beyond my own.
- Several extra Use-in-chats switches beyond A to B to A. Test-made state left on the phone: folder `째가` holding Preset C, hotkey slots (D 1, A 4, B 2, C 3, E 5, F 6), new fallback and aux values, locks ON, "Studio (preview)" ON.
- The first export confirm for D-LOCK-3 did not list the lock group names the brief expected (see the row).
